'use strict'

// Oyun taşıması: public/voice.js içindeki genel 'game' sinyali. voice.js oyun yükünün (p) anlamını bilmez,
// yalnızca biçimini (yazdırılabilir ASCII, en çok 11000 karakter, alan kümesi type, sid, n, p) denetler, ilk
// anlaşması tamamlanmış bağlantıdan tek eşe iletir ve oyun modülüne olay bildirir (message, peer-ready,
// peer-leave, reset). Saf doğrulayıcı VoiceClient.gameUtils üzerinden, motor davranışı her istemcinin ayrı vm
// bağlamında gerçek voice.js çalıştırdığı sahte bir ses odasında (sahte sunucu, sahte WebRTC, belirlenimci saat)
// sınanır. Ayrıca public/js/10-voice.js bağlantısı denetlenir.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const PUB = path.join(__dirname, '..', 'public')
const VOICE = fs.readFileSync(path.join(PUB, 'voice.js'), 'utf8')
const VOICE_UI = fs.readFileSync(path.join(PUB, 'js', '10-voice.js'), 'utf8')
const KID = '0123456789abcdef'
const CH = '7'
const SID = 'fedcba9876543210'
const SDP = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\n'

function noop () {}

// vm bağlamında üretilen nesneleri bu bağlamın nesnelerine çevirir
function plain (v) {
  return JSON.parse(JSON.stringify(v))
}

function loadVoice () {
  const win = {
    isSecureContext: true,
    addEventListener: noop,
    removeEventListener: noop,
    setTimeout,
    clearTimeout,
    console: { log: noop, warn: noop, error: noop }
  }
  win.window = win
  win.navigator = { mediaDevices: { getUserMedia: () => Promise.reject(new Error('yok')) } }
  win.document = { visibilityState: 'visible', documentElement: { lang: 'tr' } }
  vm.createContext(win)
  vm.runInContext(VOICE, win, { filename: 'voice.js' })
  return win.VoiceClient
}

// İç zarf biçiminde örnek yük: '2.' + base64url(24 baytlık nonce) + '.' + base64url(kutu)
function innerSample () {
  return '2.' + Buffer.alloc(24, 7).toString('base64url') + '.' + Buffer.alloc(40, 9).toString('base64url')
}

// ---------------------------------------------------------------- Saf doğrulayıcı

test('oyun sinyali doğrulaması: geçerli düz JSON ve iç zarf yükü kabul edilir, dönüşte yalnız type ve p bulunur', () => {
  const VC = loadVoice()
  const v = VC.gameUtils.validateSignal
  assert.equal(typeof v, 'function')
  const ok = v({ type: 'game', sid: SID, n: 3, p: '{"v":1}' })
  assert.deepEqual(plain(ok), { type: 'game', p: '{"v":1}' })
  assert.deepEqual(Object.keys(ok), ['type', 'p'])
  const inner = innerSample()
  assert.equal(inner.length, 2 + 32 + 1 + 54)
  assert.deepEqual(plain(v({ type: 'game', sid: SID, n: 4, p: inner })), { type: 'game', p: inner })
  // sid ve n ortak doğrulamadadır, bu yüzden yalnız type ve p ile de geçerlidir
  assert.deepEqual(plain(v({ type: 'game', p: 'x' })), { type: 'game', p: 'x' })
  // Sınır: tam 11000 karakter ve yazdırılabilir ASCII'nin iki ucu
  assert.ok(v({ type: 'game', p: 'a'.repeat(11000) }))
  assert.ok(v({ type: 'game', p: ' ~' }))
  assert.equal(VC.gameUtils.maxChars, 11000)
})

test('oyun sinyali doğrulaması: fazla alan, boyut, karakter kümesi ve türler katı denetlenir', () => {
  const v = loadVoice().gameUtils.validateSignal
  const base = { type: 'game', sid: SID, n: 1, p: '{"v":1}' }
  const bad = [
    null, undefined, [], 'game', 5,
    Object.assign({}, base, { g: 'abc' }),
    Object.assign({}, base, { k: 1 }),
    Object.assign({}, base, { x: true }),
    Object.assign({}, base, { p: '' }),
    Object.assign({}, base, { p: 'a'.repeat(11001) }),
    Object.assign({}, base, { p: '{"v":1}\n' }),
    Object.assign({}, base, { p: '{"a":"ş"}' }),
    Object.assign({}, base, { p: '{"a":"é"}' }),
    Object.assign({}, base, { p: 'a\tb' }),
    Object.assign({}, base, { p: 'a\u007fb' }),
    Object.assign({}, base, { p: 12 }),
    Object.assign({}, base, { p: ['{}'] }),
    Object.assign({}, base, { p: null }),
    Object.assign({}, base, { p: undefined }),
    Object.assign({}, base, { type: 'camera' }),
    Object.assign({}, base, { type: 'Game' }),
    { sid: SID, n: 1, p: '{}' }
  ]
  bad.forEach((d, i) => assert.equal(v(d), null, 'geçersiz ' + i))
})

test('genel API: gameUtils statik, sendGame örnek yöntemi var', () => {
  const VC = loadVoice()
  assert.deepEqual(Object.keys(VC.gameUtils).sort(), ['maxChars', 'validateSignal'])
  const v = VC.create({ api: () => Promise.resolve({ status: 200, data: {} }), seal: () => '', open: () => null, storage: null })
  assert.equal(typeof v.sendGame, 'function')
  // Seste değilken hiçbir şey gönderilmez
  assert.equal(v.sendGame('peerB', '{"v":1}', noop), 'not_in_voice')
})

test('10-voice.js oyun olaylarını korumalı olarak 36-oyun.js işleyicisine iletir, renderVoiceAll gameRender çağırır', () => {
  assert.match(VOICE_UI, /onGameEvent: \(evt\) => \{\s*if \(typeof gameOnVoiceEvent === 'function'\) gameOnVoiceEvent\(evt\)\s*\}/)
  const start = VOICE_UI.indexOf('function renderVoiceAll ()')
  assert.ok(start >= 0)
  const body = VOICE_UI.slice(start, VOICE_UI.indexOf('\n}', start))
  assert.match(body, /if \(typeof gameRender === 'function'\) gameRender\(\)/)
  // voice.js oyun adını, kuralı veya oyun modülünün globallerini bilmez
  assert.ok(!/TelsizGame|TelsizRenk|gameOnVoiceEvent|gameRender/.test(VOICE))
})

// ---------------------------------------------------------------- Sahte ses odası

function makeClock () {
  let now = 1700000000000
  let seq = 0
  const timers = new Map()
  const errors = []
  function add (fn, ms, every) {
    seq++
    const d = Math.max(0, Number(ms) || 0)
    timers.set(seq, { id: seq, fn, at: now + d, every: every ? Math.max(1, d) : 0 })
    return seq
  }
  class FakeDate extends Date {
    constructor (...a) {
      if (a.length) super(...a)
      else super(now)
    }

    static now () {
      return now
    }
  }
  async function flush (turns) {
    let i = 0
    while (i < turns) {
      await new Promise((resolve) => setImmediate(resolve))
      i++
    }
  }
  return {
    Date: FakeDate,
    errors,
    now: () => now,
    setTimeout: (fn, ms) => add(fn, ms, false),
    clearTimeout: (id) => { timers.delete(id) },
    setInterval: (fn, ms) => add(fn, ms, true),
    clearInterval: (id) => { timers.delete(id) },
    async advance (ms) {
      const end = now + ms
      await flush(30)
      while (true) {
        let next = null
        timers.forEach((t) => {
          if (t.at <= end && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t
        })
        if (!next) break
        now = next.at
        if (next.every) next.at += next.every
        else timers.delete(next.id)
        try {
          next.fn()
        } catch (e) {
          errors.push(e)
        }
        // Mikrofon ölçüm döngüsü (20 ms) eşzamanlıdır, diğer zamanlayıcılardan sonra söz zincirleri tamamlanır
        await flush(next.every && next.every <= 50 ? 1 : 30)
      }
      now = end
      await flush(30)
    }
  }
}

// Bir ses odası: sahte sunucu (katılım, ayrılma, meta, sinyal yönlendirme) ve her istemci için ayrı vm bağlamında
// gerçek voice.js. Sonra katılan bağlantıyı başlatır. Sahte bağlantı anlaşmayı izler (stable, have-local-offer,
// have-remote-offer, geri alma), anlaşma tamamlanınca 10 ms sonra 'connected' olur. room.rule(kayıt) sinyal
// isteğine kural döndürebilir: { status } bu HTTP durumuyla yanıtlar (iletmez), { after } yanıtı ve iletimi geciktirir.
function makeRoom () {
  const clock = makeClock()
  const engines = {}
  const roster = []
  const pcs = []
  let rnd = 12345
  const room = { clock, engines, rule: null, log: [], sigSeq: 0 }

  function seal (obj) {
    return '1.' + KID + '.nonce.' + Buffer.from(JSON.stringify(obj)).toString('base64')
  }

  function open (env) {
    const parts = String(env).split('.')
    if (parts[0] !== '1' || parts[1] !== KID) return { ok: false }
    return { ok: true, kid: KID, value: JSON.parse(Buffer.from(parts[3], 'base64').toString()) }
  }

  function domErr (name) {
    return Object.assign(new Error(name), { name })
  }

  function makeTrack () {
    return { kind: 'audio', enabled: true, readyState: 'live', onended: null, stop: noop, clone: () => makeTrack() }
  }

  function pcClass (owner) {
    return class FakePC {
      constructor () {
        this.owner = owner
        this.closed = false
        this.signalingState = 'stable'
        this.connectionState = 'new'
        this.iceConnectionState = 'new'
        this.localDescription = null
        this.remoteDescription = null
        this.stable = { local: null, remote: null }
        this.senders = []
        this.onicecandidate = null
        this.ontrack = null
        this.onconnectionstatechange = null
        this.oniceconnectionstatechange = null
        pcs.push(this)
      }

      addTrack (track) {
        const s = {
          track,
          replaceTrack: (t) => {
            s.track = t || null
            return Promise.resolve()
          }
        }
        this.senders.push(s)
        return s
      }

      getTransceivers () {
        return []
      }

      getSenders () {
        return this.senders.slice()
      }

      createOffer () {
        if (this.closed) return Promise.reject(domErr('InvalidStateError'))
        return Promise.resolve({ type: 'offer', sdp: SDP })
      }

      createAnswer () {
        if (this.closed || this.signalingState !== 'have-remote-offer') return Promise.reject(domErr('InvalidStateError'))
        return Promise.resolve({ type: 'answer', sdp: SDP })
      }

      setLocalDescription (d) {
        if (this.closed) return Promise.reject(domErr('InvalidStateError'))
        if (d.type === 'rollback') {
          if (this.signalingState === 'stable') return Promise.reject(domErr('InvalidStateError'))
          this.localDescription = this.stable.local
          this.remoteDescription = this.stable.remote
          this.signalingState = 'stable'
          return Promise.resolve()
        }
        if (d.type === 'offer') {
          if (this.signalingState !== 'stable' && this.signalingState !== 'have-local-offer') return Promise.reject(domErr('InvalidStateError'))
          this.localDescription = { type: 'offer', sdp: d.sdp }
          this.signalingState = 'have-local-offer'
          return Promise.resolve()
        }
        if (this.signalingState !== 'have-remote-offer') return Promise.reject(domErr('InvalidStateError'))
        this.localDescription = { type: 'answer', sdp: d.sdp }
        this.finish()
        return Promise.resolve()
      }

      setRemoteDescription (d) {
        if (this.closed) return Promise.reject(domErr('InvalidStateError'))
        if (d.type === 'offer') {
          if (this.signalingState !== 'stable') return Promise.reject(domErr('InvalidStateError'))
          this.remoteDescription = { type: 'offer', sdp: d.sdp }
          this.signalingState = 'have-remote-offer'
          return Promise.resolve()
        }
        if (this.signalingState !== 'have-local-offer') return Promise.reject(domErr('InvalidStateError'))
        this.remoteDescription = { type: 'answer', sdp: d.sdp }
        this.finish()
        return Promise.resolve()
      }

      finish () {
        this.signalingState = 'stable'
        this.stable = { local: this.localDescription, remote: this.remoteDescription }
        clock.setTimeout(() => this.setConn('connected'), 10)
      }

      setConn (s) {
        if (this.closed || this.connectionState === s) return
        this.connectionState = s
        this.iceConnectionState = s
        if (this.onconnectionstatechange) this.onconnectionstatechange()
      }

      addIceCandidate () {
        return Promise.resolve()
      }

      close () {
        this.closed = true
        this.signalingState = 'closed'
        this.connectionState = 'closed'
      }
    }
  }

  function members () {
    return roster.map((m) => ({ peerId: m.peerId, userId: m.userId, muted: false, deafened: false }))
  }

  function pushMeta () {
    const list = members()
    Object.keys(engines).forEach((name) => {
      const e = engines[name]
      clock.setTimeout(() => e.voice.handleMeta({ voice: { [CH]: list } }, { id: e.userId }), 20)
    })
  }

  function engineByPeer (peerId) {
    return Object.keys(engines).map((k) => engines[k]).find((x) => x.peerId === peerId) || null
  }

  async function serverApi (e, method, url, body) {
    if (url === '/api/voice/join') {
      e.peerId = 'peer' + e.name + e.joins
      e.joins++
      const list = members()
      roster.push({ peerId: e.peerId, userId: e.userId })
      pushMeta()
      return { status: 200, data: { ok: true, peerId: e.peerId, members: list, iceServers: [] } }
    }
    if (url === '/api/voice/leave') {
      const i = roster.findIndex((m) => m.peerId === e.peerId)
      if (i >= 0) roster.splice(i, 1)
      pushMeta()
      return { status: 200, data: { ok: true } }
    }
    if (url === '/api/voice/signal') {
      const d = open(body.data).value.d
      const target = engineByPeer(body.to)
      const entry = { t: clock.now(), from: e.name, to: target ? target.name : null, d }
      room.log.push(entry)
      const rule = room.rule ? room.rule(entry) : null
      if (rule && typeof rule.after === 'number') await new Promise((resolve) => clock.setTimeout(resolve, rule.after))
      if (rule && typeof rule.status === 'number') return { status: rule.status, data: null }
      if (!target) return { status: 404, data: null }
      room.sigSeq++
      const sig = { seq: room.sigSeq, from: e.peerId, data: body.data }
      clock.setTimeout(() => target.voice.handleSignals([sig]), 20)
      return { status: 200, data: { ok: true } }
    }
    return { status: 200, data: { ok: true } }
  }

  // listen: false ise onGameEvent verilmez. throwing: dinleyici her olayı kaydettikten sonra hata fırlatır.
  room.add = function (name, opts) {
    const eo = opts || {}
    const win = {
      isSecureContext: true,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      Date: clock.Date,
      console: { log: noop, warn: noop, error: noop },
      addEventListener: noop,
      removeEventListener: noop,
      crypto: {
        getRandomValues (b) {
          let i = 0
          while (i < b.length) {
            rnd = (rnd * 1103515245 + 12345) % 2147483648
            b[i] = rnd % 256
            i++
          }
          return b
        }
      }
    }
    win.window = win
    win.document = { visibilityState: 'visible', documentElement: { lang: 'tr' }, addEventListener: noop, removeEventListener: noop }
    win.navigator = {
      mediaDevices: {
        getUserMedia: () => {
          const track = makeTrack()
          return Promise.resolve({ getAudioTracks: () => [track], getTracks: () => [track] })
        },
        enumerateDevices: () => Promise.resolve([])
      }
    }
    win.MediaStream = function (list) {
      this.list = list
    }
    win.RTCPeerConnection = pcClass(name)
    vm.createContext(win)
    vm.runInContext(VOICE, win, { filename: 'voice.js' })
    const e = { name, userId: String(Object.keys(engines).length + 1), peerId: null, joins: 1, events: [], noKey: false, throwing: !!eo.throwing }
    const create = {
      api: (m, p, b) => serverApi(e, m, p, b),
      seal: (obj) => {
        if (e.noKey) throw new Error('anahtar yok')
        return seal(obj)
      },
      open,
      storage: null
    }
    if (eo.listen !== false) {
      create.onGameEvent = (ev) => {
        e.events.push(Object.assign({ t: clock.now() }, plain(ev)))
        if (e.throwing) throw new Error('dinleyici hatası ' + ev.type)
      }
    }
    e.voice = win.VoiceClient.create(create)
    engines[name] = e
    return e
  }

  room.join = async function (name) {
    const e = engines[name]
    e.voice.handleMeta({ voice: {} }, { id: e.userId })
    const p = e.voice.join(CH)
    await clock.advance(100)
    await p
    await clock.advance(400)
  }

  // Sunucunun kişiyi odadan çıkarması: kadrodan silinir, herkese yeni meta gider
  room.serverDrop = function (name) {
    const e = engines[name]
    const i = roster.findIndex((m) => m.peerId === e.peerId)
    if (i >= 0) roster.splice(i, 1)
    pushMeta()
  }

  room.advance = (ms) => clock.advance(ms)
  room.openPcs = (name) => pcs.filter((pc) => pc.owner === name && !pc.closed)
  room.events = (name, type) => engines[name].events.filter((ev) => !type || ev.type === type)
  room.signals = (from, type) => room.log.filter((en) => en.from === from && (!type || en.d.type === type))
  // from'un to'ya gönderdiği son sinyalin bağlantı kimliği
  room.sidOf = function (from, to) {
    const list = room.log.filter((en) => en.from === from && en.to === to)
    return list.length ? list[list.length - 1].d.sid : null
  }

  // Sunucudan geçmiş gibi doğrudan teslim edilen sinyal (sahte veya eski sinyal denemeleri için)
  room.inject = function (to, from, d) {
    const a = engines[from]
    const b = engines[to]
    room.sigSeq++
    b.voice.handleSignals([{ seq: room.sigSeq, from: a.peerId, data: seal({ v: 1, from: a.peerId, to: b.peerId, d }) }])
  }

  room.leaveAll = async function () {
    Object.keys(engines).forEach((k) => {
      try {
        engines[k].voice.teardown()
      } catch (e) {}
    })
    await clock.advance(2000)
  }
  return room
}

// İki kişilik oda: A önce katılır (yanıtlayan), B sonra katılır (başlatıcı)
async function twoRoom (optsA, optsB) {
  const room = makeRoom()
  room.add('A', optsA)
  room.add('B', optsB)
  await room.join('A')
  await room.join('B')
  await room.advance(1500)
  return room
}

function messages (room, name) {
  return room.events(name, 'message').map((ev) => ({ peerId: ev.peerId, userId: ev.userId, p: ev.p }))
}

// ---------------------------------------------------------------- Motor

test('iki motor el sıkışınca her iki tarafta peer-ready bir kez gelir, kimlikler doğrudur, ICE yeniden başlatma yeni olay üretmez', async () => {
  const room = await twoRoom()
  const A = room.engines.A
  const B = room.engines.B
  assert.equal(A.voice.snapshot().peers[B.userId].status, 'connected')
  assert.deepEqual(room.events('A', 'peer-ready').map((ev) => [ev.peerId, ev.userId]), [[B.peerId, B.userId]])
  assert.deepEqual(room.events('B', 'peer-ready').map((ev) => [ev.peerId, ev.userId]), [[A.peerId, A.userId]])
  // Katılım başında oturum sıfırlanır (doJoin), bu reset ilk olaydır
  assert.equal(room.events('A')[0].type, 'reset')
  assert.equal(room.events('B')[0].type, 'reset')
  // Aynı bağlantıda (aynı sid) ICE yeniden başlatma: peer-ready yeniden gelmez
  const sid = room.sidOf('B', 'A')
  room.openPcs('A')[0].setConn('failed')
  room.openPcs('B')[0].setConn('failed')
  await room.advance(2000)
  assert.ok(room.signals('B', 'offer').length >= 2, 'yeniden başlatma teklifi gitmeli')
  assert.equal(room.sidOf('B', 'A'), sid)
  assert.equal(A.voice.snapshot().peers[B.userId].status, 'connected')
  await room.advance(30000)
  assert.equal(room.events('A', 'peer-ready').length, 1)
  assert.equal(room.events('B', 'peer-ready').length, 1)
  assert.equal(room.events('A', 'peer-leave').length, 0)
  assert.deepEqual(room.clock.errors.map(String), [])
  await room.leaveAll()
})

test('sendGame ok döner, karşı tarafa message olayı gelir, gönderene done(true) çağrılır, dış zarfta yalnız type, p, sid, n bulunur', async () => {
  const room = await twoRoom()
  const A = room.engines.A
  const B = room.engines.B
  const done = []
  const p1 = '{"v":1,"t":"invite"}'
  assert.equal(A.voice.sendGame(B.peerId, p1, (res) => done.push(res)), 'ok')
  // İç zarf biçimindeki yük de taşınır, done verilmeyebilir
  const p2 = innerSample()
  assert.equal(A.voice.sendGame(B.peerId, p2), 'ok')
  assert.equal(A.voice.sendGame(B.peerId, p2, 'işlev değil'), 'ok')
  assert.deepEqual(done, [])
  await room.advance(200)
  assert.deepEqual(done, [true])
  assert.deepEqual(messages(room, 'B'), [
    { peerId: A.peerId, userId: A.userId, p: p1 },
    { peerId: A.peerId, userId: A.userId, p: p2 },
    { peerId: A.peerId, userId: A.userId, p: p2 }
  ])
  const sent = room.signals('A', 'game')
  assert.equal(sent.length, 3)
  sent.forEach((en) => {
    assert.deepEqual(Object.keys(en.d).sort(), ['n', 'p', 'sid', 'type'])
    assert.equal(en.to, 'B')
    assert.equal(en.d.sid, room.sidOf('B', 'A'))
  })
  // Ters yön
  assert.equal(B.voice.sendGame(A.peerId, '{"v":1,"t":"join"}'), 'ok')
  await room.advance(200)
  assert.deepEqual(messages(room, 'A'), [{ peerId: B.peerId, userId: B.userId, p: '{"v":1,"t":"join"}' }])
  assert.deepEqual(room.clock.errors.map(String), [])
  await room.leaveAll()
})

test('sendGame dönüş kodları: not_in_voice, bad_message, no_peer, not_ready, no_key', async () => {
  const room = makeRoom()
  const A = room.add('A')
  const B = room.add('B')
  const C = room.add('C')
  assert.equal(A.voice.sendGame('peerB1', '{}'), 'not_in_voice')
  await room.join('A')
  // B katılır, teklif henüz yanıtlanmadan B'nin A bağlantısı hazır değildir
  B.voice.handleMeta({ voice: {} }, { id: B.userId })
  const joining = B.voice.join(CH)
  await room.clock.advance(1)
  await joining
  assert.ok(room.openPcs('B').length === 1, 'B bağlantıyı başlatmış olmalı')
  assert.equal(B.voice.sendGame(A.peerId, '{}'), 'not_ready')
  await room.advance(1500)
  assert.equal(B.voice.sendGame(A.peerId, '{}'), 'ok')
  // Biçim, kişiden önce denetlenir
  for (const p of ['', 'a'.repeat(11001), 'ş', 'a\nb', 7, null, undefined, {}]) {
    assert.equal(A.voice.sendGame(B.peerId, p), 'bad_message', JSON.stringify(p))
  }
  assert.equal(A.voice.sendGame('nobody', ''), 'bad_message')
  // Kadroda olmayan, geçersiz veya prototip adı taşıyan kimlik
  for (const id of ['peerZ9', '__proto__', 'constructor', '', 5, null, undefined, 'a b']) {
    assert.equal(A.voice.sendGame(id, '{}'), 'no_peer', String(id))
  }
  // C seste değil
  assert.equal(C.voice.sendGame(A.peerId, '{}'), 'not_in_voice')
  // Grup anahtarı yoksa mühürlenemez
  A.noKey = true
  assert.equal(A.voice.sendGame(B.peerId, '{}'), 'no_key')
  A.noKey = false
  await room.advance(200)
  assert.deepEqual(messages(room, 'A').map((m) => m.p), ['{}'])
  assert.deepEqual(messages(room, 'B'), [])
  await room.leaveAll()
})

test('fazla alanlı oyun sinyali atılır ve sıra numarasını tüketmez, aynı n ile gelen geçerli sinyal kabul edilir, tekrarı atılır', async () => {
  const room = await twoRoom()
  const sid = room.sidOf('B', 'A')
  const n = 500
  for (const extra of [{ g: 'abc' }, { k: 'x' }, { x: 1 }]) {
    room.inject('A', 'B', Object.assign({ type: 'game', sid, n, p: '{"v":1}' }, extra))
  }
  // Geçersiz yükler de sıra numarası tüketmeden atılır
  room.inject('A', 'B', { type: 'game', sid, n, p: '' })
  room.inject('A', 'B', { type: 'game', sid, n, p: 'ş' })
  room.inject('A', 'B', { type: 'game', sid, n, p: 3 })
  await room.advance(100)
  assert.deepEqual(messages(room, 'A'), [])
  room.inject('A', 'B', { type: 'game', sid, n, p: '{"v":2}' })
  await room.advance(100)
  assert.deepEqual(messages(room, 'A').map((m) => m.p), ['{"v":2}'])
  // Yeniden oynatma: aynı n ve daha küçük n atılır
  room.inject('A', 'B', { type: 'game', sid, n, p: '{"v":3}' })
  room.inject('A', 'B', { type: 'game', sid, n: n - 1, p: '{"v":4}' })
  await room.advance(100)
  assert.deepEqual(messages(room, 'A').map((m) => m.p), ['{"v":2}'])
  assert.deepEqual(room.clock.errors.map(String), [])
  await room.leaveAll()
})

test('bağlantı yeniden kurulunca yeni sid ve yeni peer-ready gelir, peer-leave gelmez, eski sid ile gelen oyun sinyali atılır', async () => {
  const room = await twoRoom()
  const A = room.engines.A
  const B = room.engines.B
  const oldSid = room.sidOf('B', 'A')
  // Kurulu bağlantıda ICE düşer, B'nin yeniden başlatma teklifini sunucu bir kez 400 ile reddeder: B bağlantıyı
  // yeni sid ile yeniden kurar (rebuildPeer), A yeni sid'li teklifi alınca eskisini kapatıp yanıtlar
  let refused = 0
  room.rule = (en) => {
    if (en.from === 'B' && en.d.type === 'offer' && refused === 0) {
      refused++
      return { status: 400 }
    }
    return null
  }
  room.openPcs('A')[0].setConn('failed')
  room.openPcs('B')[0].setConn('failed')
  await room.advance(3000)
  assert.equal(refused, 1)
  const newSid = room.sidOf('B', 'A')
  assert.ok(newSid && newSid !== oldSid, 'yeni sid')
  assert.equal(room.sidOf('A', 'B'), newSid)
  assert.deepEqual(room.events('A', 'peer-ready').map((ev) => [ev.peerId, ev.userId]), [[B.peerId, B.userId], [B.peerId, B.userId]])
  assert.deepEqual(room.events('B', 'peer-ready').map((ev) => [ev.peerId, ev.userId]), [[A.peerId, A.userId], [A.peerId, A.userId]])
  assert.equal(room.events('A', 'peer-leave').length, 0)
  assert.equal(room.events('B', 'peer-leave').length, 0)
  assert.equal(A.voice.snapshot().peers[B.userId].status, 'connected')
  // Eski bağlantının kimliğiyle (taze n) gelen oyun sinyali atılır
  room.inject('A', 'B', { type: 'game', sid: oldSid, n: 900, p: '{"eski":1}' })
  await room.advance(100)
  assert.deepEqual(messages(room, 'A'), [])
  // Yeni bağlantıdan gelen iletilir
  assert.equal(B.voice.sendGame(A.peerId, '{"yeni":1}'), 'ok')
  await room.advance(200)
  assert.deepEqual(messages(room, 'A').map((m) => m.p), ['{"yeni":1}'])
  assert.deepEqual(room.clock.errors.map(String), [])
  await room.leaveAll()
})

test('kişi metadan çıkınca peer-leave gelir, leave sonrası reset gelir, ayrılan tarafın oyun iletisi artık gitmez', async () => {
  const room = makeRoom()
  room.add('A')
  room.add('B')
  room.add('C')
  await room.join('A')
  await room.join('B')
  await room.join('C')
  await room.advance(1500)
  const A = room.engines.A
  const B = room.engines.B
  const C = room.engines.C
  assert.equal(room.events('A', 'peer-ready').length, 2)
  assert.equal(room.events('C', 'peer-ready').length, 2)
  // Sunucu B'yi çıkarır: A ve C'de peer-leave, B'de reset (düşme)
  const resetsB = room.events('B', 'reset').length
  room.serverDrop('B')
  await room.advance(500)
  assert.deepEqual(room.events('A', 'peer-leave').map((ev) => [ev.peerId, ev.userId]), [[B.peerId, B.userId]])
  assert.deepEqual(room.events('C', 'peer-leave').map((ev) => [ev.peerId, ev.userId]), [[B.peerId, B.userId]])
  assert.equal(room.events('B', 'reset').length, resetsB + 1)
  assert.equal(A.voice.sendGame(B.peerId, '{}'), 'no_peer')
  assert.equal(B.voice.sendGame(A.peerId, '{}'), 'not_in_voice')
  // C ayrılır: C'de reset, A'da peer-leave
  const resetsC = room.events('C', 'reset').length
  await C.voice.leave()
  await room.advance(500)
  assert.equal(room.events('C', 'reset').length, resetsC + 1)
  assert.deepEqual(room.events('A', 'peer-leave').map((ev) => ev.peerId), [B.peerId, C.peerId])
  assert.equal(C.voice.sendGame(A.peerId, '{}'), 'not_in_voice')
  assert.deepEqual(room.clock.errors.map(String), [])
  await room.leaveAll()
})

test('sunucu art arda 429 dönerse 1, 2 ve 4 sn sonraki denemelerden sonra done(429) bir kez çağrılır', async () => {
  const room = await twoRoom()
  const A = room.engines.A
  const B = room.engines.B
  room.rule = (en) => (en.d.type === 'game' ? { status: 429 } : null)
  const done = []
  assert.equal(A.voice.sendGame(B.peerId, '{"v":1}', (res) => done.push(res)), 'ok')
  await room.advance(10)
  assert.equal(room.signals('A', 'game').length, 1)
  await room.advance(1000)
  assert.equal(room.signals('A', 'game').length, 2)
  await room.advance(2000)
  assert.equal(room.signals('A', 'game').length, 3)
  assert.deepEqual(done, [])
  await room.advance(4000)
  assert.equal(room.signals('A', 'game').length, 4)
  assert.deepEqual(done, [429])
  await room.advance(10000)
  assert.deepEqual(done, [429])
  assert.equal(room.signals('A', 'game').length, 4)
  assert.deepEqual(messages(room, 'B'), [])
  // Kural kalkınca sonraki ileti gider
  room.rule = null
  assert.equal(A.voice.sendGame(B.peerId, '{"v":2}', (res) => done.push(res)), 'ok')
  await room.advance(200)
  assert.deepEqual(done, [429, true])
  assert.deepEqual(messages(room, 'B').map((m) => m.p), ['{"v":2}'])
  // Alıcı artık etkin değilse (404) yeniden denenmeden bildirilir
  room.rule = (en) => (en.d.type === 'game' ? { status: 404 } : null)
  assert.equal(A.voice.sendGame(B.peerId, '{"v":3}', (res) => done.push(res)), 'ok')
  await room.advance(200)
  assert.deepEqual(done, [429, true, 404])
  assert.deepEqual(room.clock.errors.map(String), [])
  await room.leaveAll()
})

test('oturum değişince uçuştaki iletinin done işlevi çağrılmaz, ardından reset gelir', async () => {
  const room = await twoRoom()
  const A = room.engines.A
  const B = room.engines.B
  room.rule = (en) => (en.d.type === 'game' ? { after: 5000 } : null)
  const done = []
  assert.equal(A.voice.sendGame(B.peerId, '{"v":1}', (res) => done.push(res)), 'ok')
  await room.advance(100)
  const resets = room.events('A', 'reset').length
  await A.voice.leave()
  await room.advance(100)
  assert.equal(room.events('A', 'reset').length, resets + 1)
  await room.advance(10000)
  assert.deepEqual(done, [])
  // Ayrılan kişi diğer tarafta peer-leave olur
  assert.deepEqual(room.events('B', 'peer-leave').map((ev) => ev.peerId), [A.peerId])
  // Yeniden katılınca yeni oturumda iletiler yine done ile bildirilir
  room.rule = null
  await room.join('A')
  await room.advance(1500)
  const peerB = room.events('A', 'peer-ready').filter((ev) => ev.peerId === B.peerId)
  assert.equal(peerB.length, 2)
  assert.equal(A.voice.sendGame(B.peerId, '{"v":2}', (res) => done.push(res)), 'ok')
  await room.advance(200)
  assert.deepEqual(done, [true])
  assert.deepEqual(room.clock.errors.map(String), [])
  await room.leaveAll()
})

test('dinleyici hata fırlatırsa motor çalışmaya devam eder, olaylar sırayla gelmeyi sürdürür, dinleyicisiz motor da çalışır', async () => {
  const room = await twoRoom({ listen: false }, { throwing: true })
  const A = room.engines.A
  const B = room.engines.B
  // B'nin dinleyicisi her olayda hata fırlatır, hatalar ayrı bir görevde yeniden fırlatılır (motoru bozmaz)
  assert.ok(room.clock.errors.length > 0)
  assert.ok(room.clock.errors.every((e) => /dinleyici hatası/.test(String(e))))
  assert.equal(room.events('B', 'peer-ready').length, 1)
  assert.equal(A.voice.sendGame(B.peerId, '{"v":1}'), 'ok')
  assert.equal(A.voice.sendGame(B.peerId, '{"v":2}'), 'ok')
  await room.advance(200)
  assert.deepEqual(messages(room, 'B').map((m) => m.p), ['{"v":1}', '{"v":2}'])
  // Ters yönde gönderim ve done işlevinin hatası da motoru bozmaz
  const before = room.clock.errors.length
  assert.equal(B.voice.sendGame(A.peerId, '{"v":3}', () => { throw new Error('done hatası') }), 'ok')
  await room.advance(200)
  assert.ok(room.clock.errors.slice(before).some((e) => /done hatası/.test(String(e))))
  assert.equal(B.voice.sendGame(A.peerId, '{"v":4}'), 'ok')
  await room.advance(200)
  assert.equal(room.signals('B', 'game').length, 2)
  assert.equal(B.voice.snapshot().peers[A.userId].status, 'connected')
  assert.deepEqual(A.events, [])
  await room.leaveAll()
})
