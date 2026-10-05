'use strict'

// Özel mesaj araması için ses motorunun özel kipi: public/voice.js join(channelId, { private: { seal, open } }).
// Sinyallerin çiftin kişisel anahtarlarıyla (private.seal) şifrelenmesi ve konuşma kimliğini (c) bağlaması, grup
// zarfının ve başka konuşmanın sinyalinin reddedilmesi, grup anahtarı kimliğinin denetlenmemesi, sunucu
// susturmasının uygulanmaması, sesler ve aramanın bitişi ('call_ended'). Motor Node vm bağlamında sahte tarayıcı
// nesneleri ve sahte sunucuyla yüklenir. Sunucu tarafı test/server-calls.test.js içindedir.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const VOICE = fs.readFileSync(path.join(__dirname, '..', 'public', 'voice.js'), 'utf8')

const KID = '0123456789abcdef'
const SID = 'fedcba9876543210'
const DM = '42'
const ROOM = '7'
const SDP = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'

function noop () {}

function b64 (obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64')
}

function unb64 (s) {
  return JSON.parse(Buffer.from(s, 'base64').toString())
}

// Grup zarfı ('1.<kid>.<nonce>.<kutu>') ve çiftin kişisel zarfı ('2.<kutu>') taklidi
function groupSeal (obj) {
  return '1.' + KID + '.nonce.' + b64(obj)
}

function groupOpen (env) {
  const parts = String(env).split('.')
  if (parts[0] !== '1' || parts[1] !== KID) return { ok: false }
  return { ok: true, kid: KID, value: unb64(parts[3]) }
}

function privSeal (obj) {
  return '2.' + b64(obj)
}

function privOpen (env) {
  const parts = String(env).split('.')
  if (parts.length !== 2 || parts[0] !== '2') return { ok: false }
  return { ok: true, value: unb64(parts[1]) }
}

function decode (env) {
  const parts = String(env).split('.')
  return parts[0] === '2' ? unb64(parts[1]) : unb64(parts[3])
}

async function flush () {
  let i = 0
  while (i < 30) {
    await new Promise((resolve) => setImmediate(resolve))
    i++
  }
}

// Sahte mikrofon ve sahte RTCPeerConnection ile motor. Zamanlayıcılar kaydedilir ama çalışmaz (testler zamandan
// bağımsızdır). opts: noGroupKey (grup anahtarı yok, seal hata verir), openNoKid (grup open sonucu kid taşımaz),
// members (katılım yanıtındaki diğer üyeler)
function loadEngine (opts) {
  const o = opts || {}
  const posts = []
  const tones = []
  const groupCalls = { seal: 0, open: 0 }
  function makeTrack () {
    return { kind: 'audio', enabled: true, readyState: 'live', onended: null, stop: noop, clone: () => makeTrack() }
  }
  const md = {
    getUserMedia: () => {
      const track = makeTrack()
      return Promise.resolve({ getAudioTracks: () => [track], getTracks: () => [track] })
    }
  }
  class FakePC {
    constructor () {
      this.signalingState = 'stable'
      this.connectionState = 'new'
      this.localDescription = null
      this.remoteDescription = null
    }

    addTrack (track) {
      return { track, replaceTrack: () => Promise.resolve() }
    }

    getTransceivers () {
      return []
    }

    getSenders () {
      return []
    }

    createOffer () {
      return Promise.resolve({ type: 'offer', sdp: SDP })
    }

    createAnswer () {
      return Promise.resolve({ type: 'answer', sdp: SDP })
    }

    setLocalDescription (d) {
      this.localDescription = d
      this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'
      return Promise.resolve()
    }

    setRemoteDescription (d) {
      this.remoteDescription = d
      this.signalingState = d.type === 'offer' ? 'have-remote-offer' : 'stable'
      return Promise.resolve()
    }

    addIceCandidate () {
      return Promise.resolve()
    }

    close () {
      this.signalingState = 'closed'
    }
  }
  const win = {
    isSecureContext: true,
    addEventListener: noop,
    removeEventListener: noop,
    setTimeout: () => 0,
    clearTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop,
    console: { log: noop, warn: noop, error: noop },
    TelsizSesler: { play: (kind) => tones.push(kind) }
  }
  win.window = win
  win.navigator = { mediaDevices: md }
  win.document = { visibilityState: 'visible', documentElement: { lang: 'tr' }, addEventListener: noop, removeEventListener: noop }
  win.RTCPeerConnection = FakePC
  win.MediaStream = function (list) {
    this.list = list
  }
  vm.createContext(win)
  vm.runInContext(VOICE, win, { filename: 'voice.js' })
  const voice = win.VoiceClient.create({
    api: (method, url, body) => {
      posts.push({ url, body: JSON.parse(JSON.stringify(body || {})) })
      if (url === '/api/voice/join') {
        return Promise.resolve({ status: 200, data: { ok: true, peerId: 'peerA', members: o.members || [], iceServers: [] } })
      }
      return Promise.resolve({ status: 200, data: { ok: true } })
    },
    seal: (obj) => {
      groupCalls.seal++
      if (o.noGroupKey) throw new Error('anahtar yok')
      return groupSeal(obj)
    },
    open: (env) => {
      groupCalls.open++
      const r = groupOpen(env)
      if (r.ok && o.openNoKid) delete r.kid
      return r
    },
    storage: null
  })
  voice.handleMeta({ voice: {} }, { id: '1' })
  const signals = () => posts.filter((p) => p.url === '/api/voice/signal')
  return { voice, posts, tones, groupCalls, signals }
}

const SELF = { peerId: 'peerA', userId: '1', muted: false, deafened: false }
const PARTNER = { peerId: 'peerB', userId: '2', muted: false, deafened: false }

function meta (channelId, list, users) {
  return { voice: { [channelId]: list }, users: users || [] }
}

function privateOpts () {
  return { private: { seal: privSeal, open: privOpen } }
}

// Karşı taraftan gelen teklif (handleSignals girdisi)
let seq = 0
function offerFrom (data) {
  seq++
  return [{ seq, from: 'peerB', data }]
}

function offerBody (extra) {
  return Object.assign({ v: 1, from: 'peerB', to: 'peerA', d: { type: 'offer', sdp: SDP, sid: SID, n: 1 } }, extra || {})
}

test('özel kipte grup anahtarı gerekmez, durum özel kipi bildirir', async () => {
  const e = loadEngine({ noGroupKey: true })
  await assert.rejects(e.voice.join(ROOM), (err) => err.code === 'no_key')
  assert.equal(e.voice.snapshot().private, false)
  await e.voice.join(DM, privateOpts())
  const snap = e.voice.snapshot()
  assert.equal(snap.private, true)
  assert.equal(snap.channelId, DM)
  assert.equal(snap.errorCode, null)
  assert.deepEqual(e.posts.filter((p) => p.url === '/api/voice/join').map((p) => p.body), [{ channelId: DM }])
  // Geçersiz özel işlevler verilirse grup anahtarına düşülmez
  const f = loadEngine()
  await assert.rejects(f.voice.join(DM, { private: { seal: privSeal } }), (err) => err.code === 'no_key')
  assert.equal(f.voice.snapshot().channelId, null)
  assert.equal(f.voice.snapshot().private, false)
  assert.equal(f.posts.filter((p) => p.url === '/api/voice/join').length, 0)
  e.voice.teardown()
})

test('özel kipte sinyal private.seal ile şifrelenir ve konuşma kimliğini bağlar, ses odasında değişmez', async () => {
  const e = loadEngine({ members: [PARTNER] })
  await e.voice.join(DM, privateOpts())
  await flush()
  const sent = e.signals()
  assert.equal(sent.length, 1)
  assert.equal(sent[0].body.to, 'peerB')
  assert.ok(sent[0].body.data.startsWith('2.'), sent[0].body.data)
  const v = decode(sent[0].body.data)
  assert.deepEqual(Object.keys(v), ['v', 'from', 'to', 'c', 'd'])
  assert.equal(v.c, DM)
  assert.equal(v.from, 'peerA')
  assert.equal(v.to, 'peerB')
  assert.equal(v.d.type, 'offer')
  assert.equal(e.groupCalls.seal, 0, 'grup anahtarı kullanılmaz')
  // Ayrılınca kip temizlenir, ses odasında grup zarfı eskisi gibi konuşma kimliği taşımaz
  await e.voice.leave()
  assert.equal(e.voice.snapshot().private, false)
  await e.voice.join(ROOM)
  await flush()
  const room = e.signals().slice(1)
  assert.equal(room.length, 1)
  assert.ok(room[0].body.data.startsWith('1.' + KID + '.'), room[0].body.data)
  assert.deepEqual(Object.keys(decode(room[0].body.data)), ['v', 'from', 'to', 'd'])
  assert.equal(e.voice.snapshot().private, false)
  e.voice.teardown()
})

test('özel kipte grup zarfı ve başka konuşmanın sinyali reddedilir, grup anahtarı kimliği denetlenmez', async () => {
  const e = loadEngine()
  await e.voice.join(DM, privateOpts())
  e.voice.handleMeta(meta(DM, [SELF, PARTNER]), { id: '1' })
  await flush()
  const answers = () => e.signals().filter((p) => decode(p.body.data).d.type === 'answer')
  // Grup anahtarıyla şifrelenmiş, içeriği doğru zarf (grup open kabul ederdi)
  e.voice.handleSignals(offerFrom(groupSeal(offerBody({ c: DM }))))
  await flush()
  assert.equal(answers().length, 0)
  assert.equal(e.groupCalls.open, 0, 'özel kipte grup open çağrılmaz')
  // Başka konuşmanın kimliği, kimliksiz ve sayı türünde kimlik
  for (const c of ['43', undefined, 42]) {
    e.voice.handleSignals(offerFrom(privSeal(offerBody(c === undefined ? {} : { c }))))
    await flush()
    assert.equal(answers().length, 0, String(c))
  }
  // Doğru kimlik: kabul edilir (open sonucu kid taşımaz), reddedilenler sıra numarası tüketmedi
  e.voice.handleSignals(offerFrom(privSeal(offerBody({ c: DM }))))
  await flush()
  const list = answers()
  assert.equal(list.length, 1)
  assert.ok(list[0].body.data.startsWith('2.'))
  assert.equal(decode(list[0].body.data).c, DM)
  // Yeniden oynatma koruması özel kipte de geçerlidir
  e.voice.handleSignals(offerFrom(privSeal(offerBody({ c: DM }))))
  await flush()
  assert.equal(answers().length, 1)
  e.voice.teardown()
})

test('ses odasında kid taşımayan zarf eskisi gibi reddedilir', async () => {
  const e = loadEngine({ openNoKid: true })
  await e.voice.join(ROOM)
  e.voice.handleMeta(meta(ROOM, [SELF, PARTNER]), { id: '1' })
  await flush()
  e.voice.handleSignals(offerFrom(groupSeal(offerBody())))
  await flush()
  assert.equal(e.signals().length, 0)
  const ok = loadEngine()
  await ok.voice.join(ROOM)
  ok.voice.handleMeta(meta(ROOM, [SELF, PARTNER]), { id: '1' })
  await flush()
  ok.voice.handleSignals(offerFrom(groupSeal(offerBody())))
  await flush()
  assert.deepEqual(ok.signals().map((p) => decode(p.body.data).d.type), ['answer'])
  e.voice.teardown()
  ok.voice.teardown()
})

test('sunucu susturması özel aramada uygulanmaz, aramadan çıkınca yeniden uygulanır', async () => {
  const e = loadEngine()
  const users = [{ id: '1', voiceMuted: true }, { id: '2', voiceMuted: true }]
  e.voice.handleMeta({ voice: {}, users }, { id: '1' })
  assert.equal(e.voice.snapshot().serverMuted, true)
  await e.voice.join(DM, privateOpts())
  await flush()
  assert.equal(e.voice.snapshot().serverMuted, false)
  assert.equal(e.voice.snapshot().muted, false)
  e.voice.handleMeta(meta(DM, [SELF, PARTNER], users), { id: '1' })
  await flush()
  const snap = e.voice.snapshot()
  assert.equal(snap.serverMuted, false)
  assert.equal(snap.muted, false)
  assert.equal(snap.peers['2'].serverMuted, false)
  const states = e.posts.filter((p) => p.url === '/api/voice/state').map((p) => p.body.muted)
  assert.ok(states.length > 0)
  assert.ok(states.every((m) => m === false), JSON.stringify(states))
  await e.voice.leave()
  assert.equal(e.voice.snapshot().serverMuted, true)
  // Ses odasında eskisi gibi uygulanır
  await e.voice.join(ROOM)
  e.voice.handleMeta(meta(ROOM, [SELF, PARTNER], users), { id: '1' })
  await flush()
  assert.equal(e.voice.snapshot().serverMuted, true)
  assert.equal(e.voice.snapshot().peers['2'].serverMuted, true)
  e.voice.teardown()
})

test('özel aramada sesler: kendi katılma sesi yok, karşı taraf katılınca katılma sesi, sunucu çıkarınca call_ended', async () => {
  const e = loadEngine()
  await e.voice.join(DM, privateOpts())
  e.voice.handleMeta(meta(DM, [SELF]), { id: '1' })
  await flush()
  assert.deepEqual(e.tones, [])
  // Karşı taraf hemen katılsa da (sessiz süre içinde) arama bağlandı sesi çalar
  e.voice.handleMeta(meta(DM, [SELF, PARTNER]), { id: '1' })
  await flush()
  assert.deepEqual(e.tones, ['join'])
  // Karşı tarafın ayrılması kadro değişiminden ses çalmaz
  e.voice.handleMeta(meta(DM, [SELF]), { id: '1' })
  await flush()
  assert.deepEqual(e.tones, ['join'])
  // Sunucu bu cihazı çıkardı: arama bitti
  e.voice.handleMeta(meta(DM, []), { id: '1' })
  await flush()
  assert.deepEqual(e.tones, ['join', 'leave'])
  const snap = e.voice.snapshot()
  assert.equal(snap.errorCode, 'call_ended')
  assert.equal(snap.private, false)
  assert.equal(snap.channelId, null)
  // Ses odasında eskisi gibi: kendi katılma sesi ve düşme sesi, hata kodu kicked
  const r = loadEngine()
  await r.voice.join(ROOM)
  r.voice.handleMeta(meta(ROOM, [SELF]), { id: '1' })
  await flush()
  assert.deepEqual(r.tones, ['join'])
  r.voice.handleMeta(meta(ROOM, []), { id: '1' })
  await flush()
  assert.deepEqual(r.tones, ['join', 'drop'])
  assert.equal(r.voice.snapshot().errorCode, 'kicked')
})

test('ses ayarı kapalıyken özel aramanın bitişi ses çalmaz', async () => {
  const e = loadEngine()
  await e.voice.setSettings({ sounds: false })
  await e.voice.join(DM, privateOpts())
  e.voice.handleMeta(meta(DM, [SELF, PARTNER]), { id: '1' })
  await flush()
  e.voice.handleMeta(meta(DM, []), { id: '1' })
  await flush()
  assert.deepEqual(e.tones, [])
  assert.equal(e.voice.snapshot().errorCode, 'call_ended')
})
