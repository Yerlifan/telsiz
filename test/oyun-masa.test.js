'use strict'

// Oyun masası yöneticisi (public/js/34-oyun-masa.js, window.TelsizGameDesk) testleri. Masa yöneticisi tarayıcıdaki
// gibi Node vm bağlamında, gerçek protokol çekirdeği (33) ve Renk kural motoruyla (35) birlikte yüklenir. Her kişi
// kendi masa yöneticisi ve sahte ortamıyla bir "cihaz"dır:
// - send iletiyi bir kuyruğa yazar, teslim ve done geri çağrısı testin elindedir.
// - keys bir tabloyla çalışır (kişi başına ok ya da neden), dm sahte zarftır ('2.' + base64(JSON) ve iki taraf).
//   Gerçek kripto test/oyun-protokol.test.js ve ağ benzetiminde sınanır.
// - now elle ilerletilir, rastgelelik tohumludur.
// Genelliği göstermek için yalnızca burada tanımlı küçük bir "sayaç" uygulaması kullanılır: her oyuncu sırayla
// {t:'add', step} gönderir, toplam 10 olunca el biter. Sıra dışı {t:'last'} ve {t:'catch', p} hamleleri kurpiyerin
// gecikmeli kendi hamlelerini sınamak içindir. Gerçek Renk ile de iki tam el oynanır.

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..')
const readJs = (name) => fs.readFileSync(path.join(ROOT, 'public', 'js', name), 'utf8')
const GAME_SRC = readJs('33-oyun-protokol.js')
const DESK_SRC = readJs('34-oyun-masa.js')
const RENK_SRC = readJs('35-renk-kural.js')

function loadContext () {
  const sandbox = vm.createContext({})
  sandbox.window = sandbox
  sandbox.self = sandbox
  vm.runInContext(GAME_SRC, sandbox, { filename: '33-oyun-protokol.js' })
  vm.runInContext(DESK_SRC, sandbox, { filename: '34-oyun-masa.js' })
  vm.runInContext(RENK_SRC, sandbox, { filename: '35-renk-kural.js' })
  return sandbox
}

const CTX = loadContext()
const G = CTX.TelsizGame
const DESK = CTX.TelsizGameDesk
const R = CTX.TelsizRenk
const TM = DESK.TIMES
const CH = '3'
const IDS = ['5', '12', '7', '30', '41', '8', '19', '2', '77']

// vm bağlamındaki nesnelerin ön örnekleri farklıdır, karşılaştırma JSON kopyasıyla yapılır
function same (actual, expected, message) {
  const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))
  assert.deepEqual(plain(actual), plain(expected), message)
}

function copy (x) {
  return JSON.parse(JSON.stringify(x))
}

// Sahte iç zarf: gönderenin gizli anahtarı ve alıcının açık anahtarı iki tarafı belirler. Gerçek kutu gibi simetrik:
// iki taraftan biri diğerinin açık anahtarıyla açabilir.
const fakeDm = {
  seal (obj, pk, sk) {
    if (typeof pk !== 'string' || typeof sk !== 'string') throw new Error('anahtar')
    return '2.' + Buffer.from(JSON.stringify({ a: sk.slice(3), b: pk.slice(3), m: obj })).toString('base64')
  },
  open (p, pks, sk) {
    let x = null
    try {
      x = JSON.parse(Buffer.from(p.slice(2), 'base64').toString('utf8'))
    } catch (e) {
      return { ok: false, reason: 'bad' }
    }
    const me = sk.slice(3)
    const other = pks[0].slice(3)
    const pair = (x.a === me && x.b === other) || (x.a === other && x.b === me)
    return pair ? { ok: true, value: x.m, pk: pks[0] } : { ok: false, reason: 'key' }
  }
}

function sealFrom (from, to, obj) {
  return fakeDm.seal(obj, 'pk:' + to.uid, 'sk:' + from.uid)
}

// Kuyruktaki iletinin çözümü: { plain, x }
function decode (p) {
  if (p.charAt(0) === '{') return { plain: true, x: JSON.parse(p) }
  return { plain: false, x: JSON.parse(Buffer.from(p.slice(2), 'base64').toString('utf8')).m }
}

function seeded (seed) {
  let x = (seed * 2654435761) >>> 0 || 1
  return (n) => {
    const out = []
    while (out.length < n) {
      x ^= x << 13
      x >>>= 0
      x ^= x >>> 17
      x ^= x << 5
      x >>>= 0
      out.push(x & 255)
    }
    return out
  }
}

function fail (code) {
  const e = new Error(code)
  e.code = code
  return e
}

// Yalnızca testte tanımlı "sayaç" uygulaması (5.1 sözleşmesi)
function counterApp () {
  const calls = { newGame: 0, applyMove: 0, removePlayer: 0, endGame: 0 }
  const seatOf = (s, id) => s.seats.findIndex((x) => x.id === id)
  return {
    id: 'sayac',
    VERSION: 1,
    MIN_PLAYERS: 2,
    MAX_PLAYERS: 8,
    RULES: ['bir', 'iki'],
    DEFAULT_RULES: 'bir',
    HIDDEN: false,
    ERRORS: ['bad_options', 'bad_random', 'bad_move', 'bad_player', 'game_over', 'not_your_turn', 'stale', 'not_catchable', 'self_catch'],
    EVENTS: ['start', 'add', 'last', 'caught', 'leave', 'end'],
    calls,
    newGame (o, rng) {
      calls.newGame++
      if (!o || !Array.isArray(o.players) || o.players.length < 2) throw fail('bad_options')
      const b = rng(1)
      if (!b || b.length !== 1) throw fail('bad_random')
      const state = {
        rules: o.rules,
        seats: o.players.map((id) => ({ id, secret: 'el' + id })),
        turn: o.dealSeat,
        total: 0,
        step: 0,
        over: false,
        safe: [],
        log: []
      }
      return { state, events: [{ e: 'start', p: o.players[o.dealSeat] }] }
    },
    validateMove (raw) {
      if (!raw || typeof raw !== 'object') return null
      const n = Object.keys(raw).length
      if (raw.t === 'add' && Number.isInteger(raw.step) && n === 2) return { t: 'add', step: raw.step }
      if (raw.t === 'last' && n === 1) return { t: 'last' }
      if (raw.t === 'catch' && typeof raw.p === 'string' && n === 2) return { t: 'catch', p: raw.p }
      return null
    },
    applyMove (state, id, move) {
      calls.applyMove++
      if (state.over) throw fail('game_over')
      const k = seatOf(state, id)
      if (k < 0) throw fail('bad_player')
      const s = copy(state)
      if (move.t === 'last') {
        s.safe.push(id)
        s.log.push('last:' + id)
        return { state: s, events: [{ e: 'last', p: id }] }
      }
      if (move.t === 'catch') {
        if (move.p === id) throw fail('self_catch')
        if (s.safe.indexOf(move.p) >= 0) throw fail('not_catchable')
        s.log.push('catch:' + id)
        return { state: s, events: [{ e: 'caught', p: move.p, by: id }] }
      }
      if (k !== s.turn) throw fail('not_your_turn')
      if (move.step !== s.step) throw fail('stale')
      s.total += s.rules === 'iki' ? 2 : 1
      s.step++
      s.turn = (s.turn + 1) % s.seats.length
      const events = [{ e: 'add', p: id, total: s.total }]
      if (s.total >= 10) {
        s.over = true
        events.push({ e: 'end', winner: id })
      }
      return { state: s, events }
    },
    removePlayer (state, id) {
      calls.removePlayer++
      const k = seatOf(state, id)
      if (k < 0) throw fail('bad_player')
      const s = copy(state)
      s.seats.splice(k, 1)
      const events = [{ e: 'leave', p: id }]
      if (!s.over && s.seats.length < 2) {
        s.over = true
        events.push({ e: 'end', winner: null })
      } else if (!s.over) {
        if (k < s.turn) s.turn--
        if (s.turn >= s.seats.length) s.turn = 0
      }
      return { state: s, events }
    },
    endGame (state) {
      calls.endGame++
      if (state.over) throw fail('game_over')
      const s = copy(state)
      s.over = true
      return { state: s, events: [{ e: 'end', winner: null }] }
    },
    isOver: (s) => s.over,
    turnOf: (s) => (s.over ? null : s.seats[s.turn].id),
    publicView: (s) => ({
      seats: s.seats.map((x) => x.id),
      turn: s.over ? null : s.seats[s.turn].id,
      total: s.total,
      step: s.step,
      over: s.over,
      log: s.log.slice()
    }),
    privateView (s, id) {
      const x = s.seats.find((y) => y.id === id)
      return x ? { secret: x.secret } : null
    },
    validateView (v, seatIds) {
      return v && Array.isArray(v.seats) && JSON.stringify(v.seats) === JSON.stringify(seatIds) ? v : null
    },
    validatePrivate (m, v, id) {
      return m && m.secret === 'el' + id ? m : null
    },
    legalMoves (v, m, id) {
      return { turn: !v.over && v.turn === id, step: v.step }
    }
  }
}

// ----- Sahte dünya: cihazlar, kuyruk ve saat -----

function makeWorld () {
  const w = { clock: 1000000, queue: [], devices: [], app: counterApp(), autoDone: true }
  w.byPeer = (peerId) => w.devices.find((d) => d.peerId === peerId)
  w.byUid = (uid) => w.devices.find((d) => d.uid === uid)
  w.add = (uid) => {
    const d = makeDevice(w, uid)
    w.devices.push(d)
    return d
  }
  // Tek iletiyi teslim eder: önce gönderenin done(true) çağrısı (autoDone), sonra alıcının message olayı
  w.deliverOne = (it) => {
    if (w.autoDone) it.done(true)
    const target = w.byPeer(it.to)
    if (target && target.inVoice) target.desk.onVoiceEvent({ type: 'message', peerId: it.from.peerId, userId: it.from.uid, p: it.p })
  }
  // Kuyruğu (teslimde doğan yenileri de) sırayla teslim eder. filter verilirse yalnızca eşleşenler.
  w.deliver = (filter) => {
    const next = () => w.queue.findIndex((it) => !filter || filter(it))
    let guard = 0
    let i = next()
    while (i >= 0) {
      w.deliverOne(w.queue.splice(i, 1)[0])
      guard++
      if (guard > 20000) throw new Error('teslim döngüsü')
      i = next()
    }
  }
  // Teslim etmeden çıkarır. done: sunucunun yanıtı (varsayılan true: iletildi ama yolda kayboldu)
  w.drop = (filter, done) => {
    const out = w.queue.filter((it) => !filter || filter(it))
    w.queue = w.queue.filter((it) => !out.includes(it))
    if (done !== null) out.forEach((it) => it.done(done === undefined ? true : done))
    return out
  }
  // Saati ms kadar 250 ms'lik adımlarla ilerletir, her adımda verilen cihazların tick() çağrılır
  w.advance = (ms, devs) => {
    const list = devs || w.devices
    let left = ms
    while (left > 0) {
      const step = Math.min(250, left)
      w.clock += step
      left -= step
      list.forEach((d) => d.desk.tick())
    }
  }
  w.ready = (at, who) => at.desk.onVoiceEvent({ type: 'peer-ready', peerId: who.peerId, userId: who.uid })
  w.left = (at, who) => at.desk.onVoiceEvent({ type: 'peer-leave', peerId: who.peerId, userId: who.uid })
  return w
}

function makeDevice (w, uid) {
  const d = {
    uid,
    peerId: 'peer-' + uid,
    inVoice: true,
    private: false,
    locked: false,
    keys: {},
    blocked: {},
    sendCode: null,
    notices: [],
    changes: 0,
    sent: []
  }
  d.env = {
    me: () => d.uid,
    channel: () => (d.inVoice ? CH : null),
    isPrivate: () => d.private,
    roomPeers: () => w.devices.filter((x) => x !== d && x.inVoice).map((x) => ({ userId: x.uid, peerId: x.peerId })),
    send: (peerId, p, done) => {
      const code = d.sendCode || 'ok'
      const dec = decode(p)
      const item = { from: d, to: peerId, p, done, plain: dec.plain, msg: dec.x, code, at: w.clock }
      d.sent.push(item)
      if (code === 'ok') w.queue.push(item)
      return code
    },
    keys: (other) => {
      if (d.locked) return { ok: false, reason: 'locked' }
      if (d.blocked[other]) return { ok: false, reason: 'blocked' }
      if (d.keys[other]) return { ok: false, reason: d.keys[other] }
      return { ok: true, pk: 'pk:' + other, sk: 'sk:' + d.uid }
    },
    dm: fakeDm,
    rng: seeded(Number(uid) + 11),
    now: () => w.clock,
    isBlocked: (other) => Boolean(d.blocked[other]),
    apps: { sayac: w.app, renk: R },
    locked: () => d.locked,
    onChange: () => {
      d.changes++
    },
    onNotice: (kind, data) => {
      d.notices.push({ kind, data })
    }
  }
  d.desk = DESK.create(d.env)
  d.m = () => d.desk.model()
  d.noticesOf = (kind) => d.notices.filter((n) => n.kind === kind)
  // Bu cihazın to cihazına gönderdiği k türündeki iletiler
  d.sentTo = (to, k) => d.sent.filter((it) => it.to === to.peerId && (!k || it.msg.k === k))
  d.lastTo = (to, k) => {
    const list = d.sentTo(to, k)
    return list.length ? list[list.length - 1] : null
  }
  // Sayfa yenilemesi: aynı peerId, yeni masa yöneticisi
  d.reload = () => {
    d.notices = []
    d.desk = DESK.create(d.env)
  }
  return d
}

function inject (to, from, p) {
  to.desk.onVoiceEvent({ type: 'message', peerId: from.peerId, userId: from.uid, p })
}

function innerObj (from, to, k, g, extra) {
  return Object.assign({ v: 1, ctx: 'game', k, g, ch: CH, from: from.uid, to: to.uid }, extra)
}

function plainText (obj) {
  return JSON.stringify(Object.assign({ v: 1, ctx: 'game', ch: CH }, obj))
}

// Kurpiyer (ilk kimlik) masayı açar, seat kadar oyuncu sırayla katılır
function table (opts) {
  const o = opts || {}
  const w = makeWorld()
  const ids = o.ids || IDS.slice(0, (o.players === undefined ? 2 : o.players) + 1)
  const devs = ids.map((id) => w.add(id))
  const K = devs[0]
  assert.equal(K.desk.openSetup(o.app || 'sayac'), true)
  assert.equal(K.desk.openTable(o.rules || (o.app === 'renk' ? 'official' : 'bir')), true)
  w.deliver()
  const seat = o.seat === undefined ? devs.length - 1 : o.seat
  devs.slice(1, 1 + seat).forEach((d) => {
    assert.equal(d.desk.join(), true, 'katılım ' + d.uid)
    w.deliver()
  })
  return { w, K, devs, P: devs.slice(1) }
}

function started (opts) {
  const t = table(opts)
  assert.equal(t.K.desk.start(), true)
  t.w.deliver()
  return t
}

// ----- Testler -----

describe('kurpiyer: masa açma ve davet', () => {
  test('openTable oda üyelerine alıcıya özel ni ile davet gönderir, engelli kişiye davet gitmez', () => {
    const w = makeWorld()
    const K = w.add('5')
    const B = w.add('12')
    const C = w.add('7')
    const D = w.add('30')
    K.blocked['7'] = true
    assert.equal(K.desk.openSetup('sayac'), true)
    const setup = K.m()
    assert.equal(setup.role, 'dealer')
    assert.equal(setup.stage, 'setup')
    assert.equal(setup.rules, 'bir')
    same(setup.room.map((x) => [x.id, x.status]), [['12', null], ['7', 'blocked'], ['30', null]])
    assert.equal(K.sent.length, 0, 'Masa Kur ekranı ileti göndermez')
    assert.equal(K.desk.openTable('iki'), true)
    const m = K.m()
    assert.equal(m.stage, 'lobby')
    assert.ok(G.isHex16(m.g))
    const invites = K.sent.filter((it) => it.plain && it.msg.k === 'invite')
    same(invites.map((it) => it.to), [B.peerId, D.peerId])
    assert.equal(K.sentTo(C).length, 0)
    const nis = invites.map((it) => it.msg.ni)
    assert.notEqual(nis[0], nis[1])
    for (const it of invites) {
      assert.ok(G.parsePlain(it.p, { ch: CH, from: '5' }), 'davet çekirdeğin denetiminden geçer')
      same([it.msg.g, it.msg.dealer, it.msg.ph, it.msg.rules, it.msg.seats, it.msg.max, it.msg.key, it.msg.app],
        [m.g, '5', 'lobby', 'iki', ['5'], 8, null, 'sayac'])
    }
    same(K.m().room.map((x) => [x.id, x.status]), [['12', 'waiting'], ['7', 'blocked'], ['30', 'waiting']])
    w.deliver()
    assert.equal(B.m().stage, 'invited')
    assert.equal(D.m().stage, 'invited')
    assert.equal(C.m().stage, 'none')
    same(B.m().invite, { dealer: '5', app: 'sayac', ph: 'lobby', rules: 'iki', seats: ['5'], key: null, myKey: null })
    assert.equal(B.noticesOf('invite').length, 1)
  })

  test('kendi kimliği kilitliyken masa açılmaz', () => {
    const w = makeWorld()
    const K = w.add('5')
    w.add('12')
    K.locked = true
    assert.equal(K.desk.openSetup('sayac'), true)
    assert.equal(K.m().locked, true)
    assert.equal(K.desk.openTable('bir'), false)
    assert.equal(K.m().stage, 'setup')
    assert.equal(K.m().error, 'locked')
    assert.equal(K.sent.length, 0)
  })

  test('davet anahtar sorununu taşır, kurpiyer davetten önce bilinmeyen uygulamayı açmaz', () => {
    const w = makeWorld()
    const K = w.add('5')
    const B = w.add('12')
    const C = w.add('7')
    K.keys['12'] = 'unverified'
    K.keys['7'] = 'locked'
    assert.equal(K.desk.openSetup('yok'), false)
    assert.equal(K.desk.openSetup('sayac'), true)
    assert.equal(K.desk.openTable('bir'), true)
    assert.equal(K.lastTo(B, 'invite').msg.key, 'unverified')
    assert.equal(K.lastTo(C, 'invite').msg.key, null, 'INVITE_KEYS dışındaki neden gönderilmez')
    w.deliver()
    // Kurpiyer bu oyuncuya mühürleyemez: Katıl yapılamaz
    assert.equal(B.desk.join(), false)
    assert.equal(B.m().stage, 'invited')
    same(B.m().invite.key, 'unverified')
  })
})

describe('kurpiyer: katılım', () => {
  test('doğru ni koltuk ekler ve r artar, yanlış, eski ve tekrarlanan join atılır', () => {
    const { w, K, P } = table({ players: 2, seat: 0 })
    const [B, C] = P
    const g = K.m().g
    assert.equal(B.desk.join(), true)
    assert.equal(B.m().stage, 'joining')
    w.deliver()
    same(K.m().seats.map((s) => s.id), ['5', '12'])
    const st = K.lastTo(B, 'state').msg
    assert.equal(st.r, 2)
    assert.equal(st.ni, B.sentTo(K, 'join')[0].msg.ni)
    same(st.b.seats, ['5', '12'])
    assert.equal(B.m().stage, 'lobby')
    same(B.m().seats.map((s) => s.id), ['5', '12'])
    assert.equal(K.noticesOf('joined').length, 1)
    const before = K.sent.length
    const rev = K.m().rev
    // Yanlış ni
    inject(K, C, sealFrom(C, K, innerObj(C, K, 'join', g, { app: 'sayac', ni: '0000000000000000' })))
    // Aynı join ikinci kez (yeniden oynatma)
    inject(K, B, B.sentTo(K, 'join')[0].p)
    // Başka uygulama
    const cni = K.lastTo(C, 'invite').msg.ni
    inject(K, C, sealFrom(C, K, innerObj(C, K, 'join', g, { app: 'renk', ni: cni })))
    assert.equal(K.sent.length, before)
    assert.equal(K.m().rev, rev)
    same(K.m().seats.map((s) => s.id), ['5', '12'])
    // Eski ni: yeniden bağlanmada C yeni davet alır, eski ni ile gelen join atılır
    w.ready(K, C)
    w.deliver()
    assert.notEqual(K.lastTo(C, 'invite').msg.ni, cni)
    inject(K, C, sealFrom(C, K, innerObj(C, K, 'join', g, { app: 'sayac', ni: cni })))
    same(K.m().seats.map((s) => s.id), ['5', '12'])
    assert.equal(C.desk.join(), true)
    w.deliver()
    same(K.m().seats.map((s) => s.id), ['5', '12', '7'])
    assert.equal(K.lastTo(C, 'state').msg.r, 3)
  })

  test('dokuzuncu kişi reject full alır, Başlat sonrası koltuğu olmayan reject started alır', () => {
    const { w, K, P } = table({ players: 8, seat: 7 })
    const ninth = P[7]
    assert.equal(K.m().seats.length, 8)
    assert.equal(ninth.desk.join(), true)
    w.deliver()
    assert.equal(K.lastTo(ninth, 'reject').msg.why, 'full')
    assert.equal(ninth.m().stage, 'rejected')
    same(ninth.m().rejected, { why: 'full' })
    assert.equal(K.m().room.find((x) => x.id === ninth.uid).status, 'full')
    // full sonrası Kapat: davet ekranına dönülür
    ninth.desk.dismiss()
    assert.equal(ninth.m().stage, 'invited')

    const t = table({ players: 2, seat: 1 })
    const C = t.P[1]
    assert.equal(C.desk.join(), true)
    assert.equal(t.K.desk.start(), true)
    // Başlat'la yarışan join, oyun davetinden önce ulaşsa da reject started alır
    t.w.deliver((it) => it.from === C)
    assert.equal(t.K.lastTo(C, 'reject').msg.why, 'started')
    t.w.deliver()
    assert.equal(C.m().stage, 'rejected')
    same(C.m().rejected, { why: 'started' })
    // Aynı kişiye 5 sn içinde ikinci reject gitmez
    assert.equal(t.K.sentTo(C, 'reject').length, 1)
    C.desk.dismiss()
    assert.equal(C.m().stage, 'none')
    assert.equal(C.m().invite.ph, 'play', 'saklı davet Oyun Sürüyor olarak kalır')
  })

  test('engelli kişiden gelen join yanıtsız kalır', () => {
    const { w, K, P } = table({ players: 1, seat: 0 })
    const B = P[0]
    K.blocked['12'] = true
    assert.equal(B.desk.join(), true)
    const before = K.sent.length
    w.deliver()
    assert.equal(K.sent.length, before)
    same(K.m().seats.map((s) => s.id), ['5'])
    assert.equal(K.m().room[0].status, 'blocked')
    w.advance(TM.JOIN_TIMEOUT_MS + 250, [B])
    assert.equal(B.m().stage, 'invited')
    assert.equal(B.m().error, 'join_timeout')
    // Engellenen kişinin bilinmeyen masa iletisine de yanıt verilmez
    inject(K, B, sealFrom(B, K, innerObj(B, K, 'sync', 'aaaaaaaaaaaaaaaa', { seq: 1 })))
    assert.equal(K.sent.length, before)
  })

  test('anahtarı loading olan kişinin join iletisi bekletilir, recheck sonrası işlenir, 10 sn sonra düşer', () => {
    const { w, K, P } = table({ players: 2, seat: 0 })
    const [B, C] = P
    K.keys['12'] = 'loading'
    K.keys['7'] = 'loading'
    assert.equal(B.desk.join(), true)
    w.deliver()
    same(K.m().seats.map((s) => s.id), ['5'])
    assert.equal(K.sentTo(B, 'state').length, 0)
    delete K.keys['12']
    K.desk.recheck()
    same(K.m().seats.map((s) => s.id), ['5', '12'])
    w.deliver()
    assert.equal(B.m().stage, 'lobby')
    // Süre dolunca sessizce düşer
    assert.equal(C.desk.join(), true)
    w.deliver()
    w.advance(TM.HOLD_JOIN_MS + 250, [K])
    delete K.keys['7']
    K.desk.recheck()
    same(K.m().seats.map((s) => s.id), ['5', '12'])
    assert.equal(K.sentTo(C, 'state').length, 0)
  })
})

describe('kurpiyer: gönderim kuyruğu', () => {
  test('tek uçuş: uçuştayken gelen üç değişiklik tek gönderime toplanır ve en yeni r değerini taşır', () => {
    const { w, K, P } = table({ players: 4, seat: 1 })
    const [B, C, D, E] = P
    w.autoDone = false
    const n0 = K.sentTo(B, 'state').length
    C.desk.join()
    w.deliver()
    assert.equal(K.sentTo(B, 'state').length, n0 + 1)
    const inflight = K.lastTo(B, 'state')
    D.desk.join()
    w.deliver()
    E.desk.join()
    w.deliver()
    K.desk.setRules('iki')
    assert.equal(K.sentTo(B, 'state').length, n0 + 1, 'uçuşta ileti varken koltuğa yeni ileti gitmez')
    inflight.done(true)
    assert.equal(K.sentTo(B, 'state').length, n0 + 2)
    const last = K.lastTo(B, 'state').msg
    assert.equal(inflight.msg.r, 3)
    assert.equal(last.r, 6, 'C, D ve E katıldı, kural değişti')
    same(last.b.seats, ['5', '12', '7', '30', '41'])
    assert.equal(last.b.rules, 'iki')
  })

  test('429 sonrası geri çekilme 2, 4 ve 8 sn, peer-ready beklemeyi sıfırlar', () => {
    const { w, K, P } = table({ players: 1 })
    const B = P[0]
    w.autoDone = false
    const states = () => K.sentTo(B, 'state')
    K.desk.setRules('iki')
    let n = states().length
    for (const wait of [2000, 4000, 8000]) {
      states()[n - 1].done(429)
      w.advance(wait - 1, [K])
      assert.equal(states().length, n, 'bekleme ' + wait)
      w.advance(1, [K])
      assert.equal(states().length, n + 1, 'yeniden deneme ' + wait)
      n++
    }
    states()[n - 1].done(429)
    w.advance(1000, [K])
    assert.equal(states().length, n)
    // Yeni bağlantı: önce davet, sonra beklemeden durum
    const sentBefore = K.sentTo(B).length
    w.ready(K, B)
    const after = K.sentTo(B).slice(sentBefore)
    same(after.map((it) => it.msg.k), ['invite', 'state'])
    states()[n].done(true)
    K.desk.setRules('bir')
    assert.equal(states().length, n + 2, 'başarıdan sonra geri çekilme sıfırlanır')
  })

  test('404 sonrası koltuk Bağlantı Bekleniyor olur, send not_ready dönerse peer-ready beklenir', () => {
    const { w, K, P } = table({ players: 1 })
    const B = P[0]
    w.autoDone = false
    K.desk.setRules('iki')
    K.lastTo(B, 'state').done(404)
    assert.equal(K.m().seats[1].offline, true)
    assert.equal(K.m().room[0].status, 'offline')
    K.sendCode = 'not_ready'
    w.ready(K, B)
    assert.equal(K.m().seats[1].offline, true)
    K.sendCode = null
    w.ready(K, B)
    assert.equal(K.m().seats[1].offline, false)
  })

  test('400 bir kez send hatası bildirir ve koltuk kirli kalmaz', () => {
    const { w, K, P } = table({ players: 1 })
    const B = P[0]
    w.autoDone = false
    K.desk.setRules('iki')
    const n = K.sentTo(B, 'state').length
    K.lastTo(B, 'state').done(400)
    w.advance(3000, [K])
    assert.equal(K.sentTo(B, 'state').length, n)
    same(K.noticesOf('error').map((x) => x.data), ['send'])
  })
})

describe('kurpiyer: hamleler ve sayaçlar', () => {
  test('reddedilen hamle yalnızca o koltuğa gider, 1 sn kısmalıdır, r değişmez', () => {
    const { w, K, P } = started({ players: 2 })
    const [B, C] = P
    assert.equal(K.m().view.turn, '5')
    const r0 = K.lastTo(B, 'state').msg.r
    const nB = K.sentTo(B, 'state').length
    const nC = K.sentTo(C, 'state').length
    assert.equal(B.desk.act({ t: 'add', step: 0 }), true)
    assert.ok(B.m().pending)
    w.deliver()
    assert.equal(K.sentTo(B, 'state').length, nB + 1)
    assert.equal(K.sentTo(C, 'state').length, nC)
    const reply = K.lastTo(B, 'state').msg
    assert.equal(reply.r, r0)
    same(reply.b.ack, { seq: 1, ok: false, code: 'not_your_turn' })
    assert.equal(B.m().pending, null)
    assert.equal(B.m().error, 'not_your_turn')
    same(B.noticesOf('error').map((x) => x.data), ['not_your_turn'])
    // İkinci reddedilen hamle 1 sn dolmadan yanıt almaz
    assert.equal(B.desk.act({ t: 'add', step: 0 }), true)
    w.deliver()
    assert.equal(K.sentTo(B, 'state').length, nB + 1)
    w.advance(TM.SEAT_REPLY_MIN_MS - 250, [K])
    assert.equal(K.sentTo(B, 'state').length, nB + 1)
    w.advance(250, [K])
    assert.equal(K.sentTo(B, 'state').length, nB + 2)
    same(K.lastTo(B, 'state').msg.b.ack, { seq: 2, ok: false, code: 'not_your_turn' })
    assert.equal(K.sentTo(C, 'state').length, nC)
  })

  test('seq: aynı sayaç yalnızca sonucu yeniden gönderir, eski sayaç atılır', () => {
    const { w, K, P } = started({ players: 2 })
    const [B, C] = P
    B.desk.act({ t: 'add', step: 0 })
    w.deliver()
    const oldP = B.lastTo(K, 'act').p
    w.advance(TM.SEAT_REPLY_MIN_MS, [])
    assert.equal(K.desk.act({ t: 'add', step: 0 }), true)
    w.deliver()
    assert.equal(B.m().view.turn, '12')
    assert.equal(B.desk.act({ t: 'add', step: 1 }), true)
    w.deliver()
    const okP = B.lastTo(K, 'act').p
    assert.equal(B.m().view.total, 2)
    const r = K.lastTo(B, 'state').msg.r
    const nB = K.sentTo(B, 'state').length
    const nC = K.sentTo(C, 'state').length
    const calls = w.app.calls.applyMove
    inject(K, B, okP)
    assert.equal(K.sentTo(B, 'state').length, nB + 1, 'tekrar: sonuç yeniden gider')
    assert.equal(K.sentTo(C, 'state').length, nC)
    assert.equal(K.lastTo(B, 'state').msg.r, r)
    same(K.lastTo(B, 'state').msg.b.ack, { seq: 2, ok: true })
    assert.equal(w.app.calls.applyMove, calls, 'hamle ikinci kez uygulanmaz')
    w.deliver()
    w.advance(TM.SEAT_REPLY_MIN_MS, [])
    inject(K, B, oldP)
    assert.equal(K.sentTo(B, 'state').length, nB + 1, 'eski sayaç atılır')
    assert.equal(K.m().view.total, 2)
  })

  test('sync 5 sn içinde en çok bir yanıt alır', () => {
    const { w, K, P } = table({ players: 1 })
    const B = P[0]
    const g = K.m().g
    const n = K.sentTo(B, 'state').length
    const sync = (seq) => inject(K, B, sealFrom(B, K, innerObj(B, K, 'sync', g, { seq })))
    sync(100)
    assert.equal(K.sentTo(B, 'state').length, n + 1)
    same(K.lastTo(B, 'state').msg.b.ack, { seq: 100, ok: true })
    w.deliver()
    w.advance(1000, [K])
    sync(101)
    w.advance(3750, [K])
    assert.equal(K.sentTo(B, 'state').length, n + 1)
    w.advance(250, [K])
    assert.equal(K.sentTo(B, 'state').length, n + 2)
    same(K.lastTo(B, 'state').msg.b.ack, { seq: 101, ok: true })
    // Tekrarlanan sync de aynı kısmaya tabidir
    w.deliver()
    sync(101)
    w.advance(1000, [K])
    assert.equal(K.sentTo(B, 'state').length, n + 2)
  })

  test('rd uyuşmazlığında stale, oyun dışında game_over, bozuk hamlede bad_move döner', () => {
    const { w, K, P } = started({ players: 1 })
    const B = P[0]
    const g = K.m().g
    const act = (seq, rd, b) => {
      w.advance(TM.SEAT_REPLY_MIN_MS, [])
      inject(K, B, sealFrom(B, K, innerObj(B, K, 'act', g, { seq, rd, b })))
      const ack = K.lastTo(B, 'state').msg.b.ack
      w.deliver()
      return ack
    }
    same(act(50, 0, { t: 'add', step: 0 }), { seq: 50, ok: false, code: 'stale' })
    same(act(51, 1, { t: 'add', step: 0, x: 1 }), { seq: 51, ok: false, code: 'bad_move' })
    K.desk.endGame()
    w.deliver()
    same(act(52, 1, { t: 'add', step: 0 }), { seq: 52, ok: false, code: 'game_over' })
  })

  test('kabul edilen hamle olayları r ile damgalar, oyuncular yalnızca yeni olayları duyar', () => {
    const { w, K, P } = started({ players: 2 })
    const [B, C] = P
    const r0 = K.lastTo(B, 'state').msg.r
    same(B.noticesOf('events').map((x) => x.data), [[{ r: r0, e: 'start', p: '5' }]])
    same(B.m().events.map((e) => e.e), ['start'])
    K.desk.act({ t: 'add', step: 0 })
    w.deliver()
    const ev = B.noticesOf('events')
    assert.equal(ev.length, 2)
    const r = K.lastTo(B, 'state').msg.r
    assert.equal(r, r0 + 1)
    same(ev[1].data, [{ r, e: 'add', p: '5', total: 1 }])
    same(B.m().newEvents, ev[1].data)
    same(B.m().events.map((e) => [e.r, e.e]), [[r0, 'start'], [r, 'add']])
    same(C.noticesOf('events')[1].data, ev[1].data)
    same(K.noticesOf('events').pop().data, ev[1].data)
    // Sıra bende: turn bildirimi bir kez
    assert.equal(B.noticesOf('turn').length, 1)
    assert.equal(C.noticesOf('turn').length, 0)
    assert.equal(B.m().legal.turn, true)
  })

  test('peer-leave koltuğu kaldırır, removePlayer çağrılır, 2 koltuğun altında aşama over olur', () => {
    const { w, K, P } = started({ players: 2 })
    const [B, C] = P
    const calls = w.app.calls.removePlayer
    w.left(K, C)
    assert.equal(w.app.calls.removePlayer, calls + 1)
    same(K.m().seats.map((s) => s.id), ['5', '12'])
    assert.equal(K.m().stage, 'play')
    same(K.noticesOf('left').map((x) => x.data), [{ id: '7', why: 'gone' }])
    w.deliver()
    same(B.m().seats.map((s) => s.id), ['5', '12'])
    same(B.m().view.seats, ['5', '12'])
    w.left(K, B)
    same(K.m().seats.map((s) => s.id), ['5'])
    assert.equal(K.m().stage, 'over')
    assert.equal(K.m().view.over, true)
  })

  test('removeSeat kişiyi çıkarır ve ona son durumu gönderir, oyuncu removed ile biter', () => {
    const { w, K, P } = started({ players: 2 })
    const [B, C] = P
    assert.equal(K.desk.removeSeat('5'), false, 'kurpiyer kendini çıkaramaz')
    assert.equal(K.desk.removeSeat('7'), true)
    const bye = K.lastTo(C, 'state').msg
    assert.ok(G.isRemovalBody(bye.b, { dealer: '5', me: '7', r: bye.r }))
    w.deliver()
    assert.equal(C.m().stage, 'ended')
    same(C.m().ended, { reason: 'removed' })
    same(B.m().seats.map((s) => s.id), ['5', '12'])
    assert.equal(K.noticesOf('left').length, 0, 'kurpiyerin kendi işlemi bildirilmez')
    // Çıkarılan sayfa hâlâ yazıyorsa (bildirim kaybolduysa) son durum kısmalı olarak yeniden gider
    const n = K.sentTo(C, 'state').length
    const g = K.m().g
    inject(K, C, sealFrom(C, K, innerObj(C, K, 'sync', g, { seq: 9 })))
    assert.equal(K.sentTo(C, 'state').length, n)
    w.advance(TM.PLAIN_REPLY_MIN_MS, [])
    inject(K, C, sealFrom(C, K, innerObj(C, K, 'sync', g, { seq: 10 })))
    assert.equal(K.sentTo(C, 'state').length, n + 1)
  })

  test('kurpiyerin kendi catch hamlesi 300 ms sonra işlenir, arada gelen last önce işlenir', () => {
    const { w, K, P } = started({ players: 2 })
    const B = P[0]
    assert.equal(K.desk.act({ t: 'catch', p: '12' }), true)
    same(K.m().view.log, [])
    assert.equal(B.desk.act({ t: 'last' }), true)
    w.deliver()
    same(K.m().view.log, ['last:12'])
    w.advance(TM.SELF_DELAY_MS - 50, [K])
    same(K.noticesOf('error'), [])
    w.advance(50, [K])
    same(K.m().view.log, ['last:12'], 'yakalama geç kaldı')
    same(K.noticesOf('error').map((x) => x.data), ['not_catchable'])
    // last gelmezse yakalama 300 ms sonra uygulanır
    assert.equal(K.desk.act({ t: 'catch', p: '7' }), true)
    w.advance(TM.SELF_DELAY_MS - 50, [K])
    same(K.m().view.log, ['last:12'])
    w.advance(50, [K])
    same(K.m().view.log, ['last:12', 'catch:5'])
    // Tur hamlesi gecikmesiz uygulanır
    assert.equal(K.desk.act({ t: 'add', step: 0 }), true)
    assert.equal(K.m().view.total, 1)
  })

  test('Oyunu Bitir, Yeni El ve kural seçimi', () => {
    const { w, K, P } = table({ players: 2, seat: 1 })
    const [B, C] = P
    assert.equal(K.desk.start(), true)
    w.deliver()
    assert.equal(C.m().stage, 'busy', 'oturmamış kişi Oyun Sürüyor görür')
    assert.equal(C.noticesOf('invite').length, 1, 'busy için bildirim gitmez')
    assert.equal(K.desk.setRules('iki'), false, 'kural yalnızca lobide değişir')
    assert.equal(K.desk.endGame(), true)
    w.deliver()
    assert.equal(K.m().stage, 'over')
    assert.equal(B.m().stage, 'over')
    assert.equal(K.desk.newRound(), true)
    w.deliver()
    assert.equal(K.m().stage, 'lobby')
    assert.equal(B.m().stage, 'lobby')
    assert.equal(B.m().view, null)
    assert.equal(C.m().stage, 'invited', 'Yeni El oturmamışları yeniden davet eder')
    assert.equal(K.desk.setRules('iki'), true)
    w.deliver()
    assert.equal(B.m().rules, 'iki')
    assert.equal(C.desk.join(), true)
    w.deliver()
    assert.equal(K.desk.start(), true)
    w.deliver()
    assert.equal(K.m().rd, 2)
    assert.equal(K.m().view.turn, '12', 'ikinci elde dağıtan bir sonraki koltuk')
    same(B.m().view.seats, ['5', '12', '7'])
  })

  test('kurpiyerin kimliği kilitlenince masa kapanır ve oyunculara düz close gider', () => {
    const { w, K, P } = table({ players: 2, seat: 1 })
    const [B, C] = P
    K.locked = true
    K.desk.tick()
    assert.equal(K.m().stage, 'none')
    same(K.noticesOf('ended').map((x) => x.data), [{ reason: 'keys' }])
    assert.equal(K.lastTo(B, 'close').msg.why, 'dealer')
    assert.equal(K.lastTo(C, 'close').msg.why, 'dealer')
    w.deliver()
    same(B.m().ended, { reason: 'closed' })
    assert.equal(C.m().stage, 'none', 'davet edilen kişinin daveti silinir')
    assert.equal(C.m().invite, null)
  })

  test('Masayı Kapat koltuklara ve davetlilere close dealer gönderir', () => {
    const { w, K, P } = table({ players: 2, seat: 1 })
    const [B, C] = P
    assert.equal(K.desk.closeTable(), true)
    assert.equal(K.m().stage, 'none')
    w.deliver()
    assert.equal(B.m().stage, 'ended')
    same(B.m().ended, { reason: 'closed' })
    assert.equal(C.m().stage, 'none')
    B.desk.dismiss()
    assert.equal(B.m().stage, 'none')
    assert.equal(B.m().invite, null)
    assert.equal(B.desk.openSetup('sayac'), true, 'saklı davet kalmadığı için masa kurulabilir')
  })
})

describe('kurpiyer: anahtar sorunları', () => {
  test('mühürlenemeyen koltuk Anahtar Sorunu olur ve ona ileti gitmez, recheck sonrası durum gider', () => {
    const { w, K, P } = table({ players: 2 })
    const [B, C] = P
    K.keys['12'] = 'changed'
    const nB = K.sentTo(B, 'state').length
    K.desk.setRules('iki')
    assert.equal(K.sentTo(B, 'state').length, nB)
    same(K.m().seats.map((s) => s.keyIssue), [null, 'changed', null])
    same(K.m().room.map((x) => [x.id, x.status, x.key]), [['12', 'keys', 'changed'], ['7', 'joined', null]])
    w.deliver()
    assert.equal(C.m().rules, 'iki')
    delete K.keys['12']
    K.desk.recheck()
    assert.equal(K.sentTo(B, 'state').length, nB + 1)
    same(K.m().seats.map((s) => s.keyIssue), [null, null, null])
    // Anahtar sorunlu koltuk çıkarılabilir
    K.keys['12'] = 'gone'
    assert.equal(K.desk.removeSeat('12'), true)
    same(K.m().seats.map((s) => s.id), ['5', '7'])
  })

  test('oyuncunun anahtar sorunu: Katıl yerine bir kez decline keys gider, kurpiyer Katılamaz görür', () => {
    const { w, K, P } = table({ players: 1, seat: 0 })
    const B = P[0]
    B.keys['5'] = 'unverified'
    assert.equal(B.desk.join(), false)
    assert.equal(B.desk.join(), false)
    assert.equal(B.sentTo(K, 'decline').length, 1)
    same(B.m().invite.myKey, 'unverified')
    w.deliver()
    same(K.m().room.map((x) => [x.status, x.key]), [['cannot', 'unverified']])
    same(K.noticesOf('declined').map((x) => x.data), [{ id: '12', why: 'keys', key: 'unverified' }])
    // loading: profil gelince recheck katılımı tamamlar
    B.keys['5'] = 'loading'
    assert.equal(B.desk.join(), false)
    assert.equal(B.m().stage, 'invited')
    delete B.keys['5']
    B.desk.recheck()
    assert.equal(B.m().stage, 'joining')
    w.deliver()
    assert.equal(B.m().stage, 'lobby')
  })

  test('oturan oyuncu kurpiyerin anahtarını kullanamazsa masa keys nedeniyle biter', () => {
    const { w, K, P } = table({ players: 1 })
    const B = P[0]
    B.keys['5'] = 'changed'
    K.desk.setRules('iki')
    w.deliver()
    same(B.m().ended, { reason: 'keys' })
    same(B.noticesOf('ended').map((x) => x.data), [{ reason: 'keys' }])
  })

  test('kurpiyerin anahtarı açamadığı iç ileti atılır, koltuktaysa sorun işaretlenir', () => {
    const { K, P } = table({ players: 1 })
    const B = P[0]
    K.keys['12'] = 'unverified'
    inject(K, B, sealFrom(B, K, innerObj(B, K, 'sync', K.m().g, { seq: 3 })))
    assert.equal(K.m().seats[1].keyIssue, 'unverified')
  })
})

describe('oyuncu', () => {
  test('kurpiyerin peerId değeri için peer-leave ve close gone dealer_left yapar, başkasının close iletisi atılır', () => {
    let t = table({ players: 2 })
    let [B, C] = t.P
    const g = t.K.m().g
    inject(B, C, plainText({ k: 'close', g, why: 'dealer' }))
    assert.equal(B.m().stage, 'lobby')
    t.w.left(B, t.K)
    same(B.m().ended, { reason: 'dealer_left' })
    t = table({ players: 2 })
    B = t.P[0]
    C = t.P[1]
    inject(B, t.K, plainText({ k: 'close', g: t.K.m().g, why: 'gone' }))
    same(B.m().ended, { reason: 'dealer_left' })
    inject(C, t.K, plainText({ k: 'close', g: t.K.m().g, why: 'superseded' }))
    same(C.m().ended, { reason: 'superseded' })
  })

  test('ni uyuşmayan durum atılır, eski r atılır, aynı r ile daha yeni ack kabul edilir', () => {
    const { K, P } = table({ players: 1 })
    const B = P[0]
    const base = K.lastTo(B, 'state').msg
    const send = (mut) => {
      const x = copy(base)
      mut(x)
      inject(B, K, sealFrom(K, B, x))
    }
    const rev = B.m().rev
    send((x) => {
      x.ni = '0123456789abcdef'
      x.r += 5
      x.b.rules = 'iki'
    })
    assert.equal(B.m().rev, rev, 'ni uyuşmazlığı')
    send((x) => {
      x.r += 5
      x.b.rules = 'iki'
    })
    assert.equal(B.m().rules, 'iki')
    send((x) => {
      x.r += 4
      x.b.rules = 'bir'
    })
    assert.equal(B.m().rules, 'iki', 'eski sürüm')
    send((x) => {
      x.r += 5
      x.b.rules = 'bir'
      x.b.ack = { seq: base.b.ack.seq + 1, ok: true }
    })
    assert.equal(B.m().rules, 'bir', 'aynı sürüm, daha yeni ack')
    // Bozuk gövde (koltuklarda kurpiyer başta değil) ve başka masa atılır
    send((x) => {
      x.r += 9
      x.b.seats = ['12', '5']
    })
    send((x) => {
      x.r += 9
      x.g = 'abababababababab'
    })
    // Kurpiyerin kimliği doğru ama bağlantısı farklı
    const x = copy(base)
    x.r += 9
    x.b.rules = 'iki'
    B.desk.onVoiceEvent({ type: 'message', peerId: 'peer-baska', userId: '5', p: sealFrom(K, B, x) })
    assert.equal(B.m().rules, 'bir')
    same(B.m().seats.map((s) => s.id), ['5', '12'])
  })

  test('bekleyen hamle varken sync gönderilmez, aynı seq yeniden gönderilir', () => {
    const { w, K, P } = started({ players: 2 })
    const B = P[0]
    K.desk.act({ t: 'add', step: 0 })
    w.deliver()
    assert.equal(B.desk.act({ t: 'add', step: 1 }), true)
    assert.equal(B.desk.act({ t: 'add', step: 1 }), false, 'aynı anda tek bekleyen hamle')
    w.drop((it) => it.from === B)
    assert.equal(B.m().slow, false)
    w.advance(TM.SLOW_MS + 250, [B])
    assert.equal(B.m().slow, true)
    for (const round of [1, 2, 3]) {
      w.advance(TM.ACK_RESEND_MS, [B])
      assert.equal(w.drop((it) => it.from === B).length, 1, 'yeniden gönderim ' + round)
    }
    // Kurpiyerle bağlantı yeniden kurulunca da sync değil aynı hamle gider
    w.ready(B, K)
    w.drop((it) => it.from === B)
    const kinds = B.sentTo(K).map((it) => it.msg.k)
    assert.equal(kinds.indexOf('sync'), -1)
    const acts = B.sentTo(K, 'act')
    assert.equal(acts.length, 5)
    for (const it of acts) assert.equal(it.msg.seq, acts[0].msg.seq)
    assert.equal(acts[1].at - acts[0].at, TM.ACK_RESEND_MS)
    // Kurpiyer hamleyi alınca bekleyen hamle sonuçlanır
    inject(K, B, acts[0].p)
    w.deliver()
    assert.equal(B.m().pending, null)
    assert.equal(B.m().view.total, 2)
  })

  test('canlılık: 25 sn sessizlikte sync, 45 sn sessizlikte dealer_lost, kurpiyer 15 sn boşta tazeleme yollar', () => {
    let t = table({ players: 1 })
    let B = t.P[0]
    let start = t.w.clock
    t.w.advance(TM.SILENT_SYNC_MS, [B])
    assert.equal(B.sentTo(t.K, 'sync').length, 0)
    t.w.advance(250, [B])
    const syncs = B.sentTo(t.K, 'sync')
    assert.equal(syncs.length, 1)
    assert.ok(syncs[0].at - start > TM.SILENT_SYNC_MS)
    assert.equal(B.m().syncing, true)
    t.w.drop((it) => it.from === B)
    t.w.advance(TM.SILENT_END_MS - TM.SILENT_SYNC_MS - 250, [B])
    assert.equal(B.m().stage, 'lobby')
    t.w.drop((it) => it.from === B)
    assert.equal(B.sentTo(t.K, 'sync').length, 2, 'SYNC_MIN_MS aralıkla ikinci sync')
    t.w.advance(250, [B])
    same(B.m().ended, { reason: 'dealer_lost' })

    t = table({ players: 1 })
    B = t.P[0]
    start = t.w.clock
    const n = t.K.sentTo(B, 'state').length
    t.w.advance(TM.KEEPALIVE_MS, [t.K])
    assert.equal(t.K.sentTo(B, 'state').length, n)
    t.w.advance(250, [t.K])
    assert.equal(t.K.sentTo(B, 'state').length, n + 1)
    const keep = t.K.lastTo(B, 'state').msg
    assert.equal(keep.r, t.K.sentTo(B, 'state')[n - 1].msg.r, 'tazeleme sürümü artırmaz')
    const rev = B.m().rev
    t.w.deliver()
    assert.equal(B.m().rev, rev, 'aynı sürüm modeli değiştirmez')
    t.w.advance(TM.SILENT_SYNC_MS - TM.KEEPALIVE_MS + 5000, [B])
    assert.equal(B.sentTo(t.K, 'sync').length, 0, 'tazeleme canlılık sayılır')
  })

  test('davetli oyuncu Reddet sonrası saklı daveti Masaya Bak ile yeniden açıp katılabilir', () => {
    const { w, K, P } = table({ players: 1, seat: 0 })
    const B = P[0]
    assert.equal(B.desk.decline(), true)
    assert.equal(B.m().stage, 'none')
    assert.equal(B.m().invite.dealer, '5')
    assert.equal(B.desk.openSetup('sayac'), false, 'saklı davet varken masa kurulamaz')
    w.deliver()
    same(K.m().room.map((x) => x.status), ['declined'])
    same(K.noticesOf('declined').map((x) => x.data), [{ id: '12', why: 'user', key: null }])
    assert.equal(B.desk.openInvite(), true)
    assert.equal(B.m().stage, 'invited')
    assert.equal(B.desk.join(), true)
    w.deliver()
    assert.equal(B.m().stage, 'lobby')
    // Ayrılma: iç leave gider, koltuk kalkar
    assert.equal(B.desk.leave(), true)
    assert.equal(B.m().stage, 'none')
    w.deliver()
    same(K.m().seats.map((s) => s.id), ['5'])
    same(K.noticesOf('left').map((x) => x.data), [{ id: '12', why: 'leave' }])
  })

  test('zaman aşımına uğrayan katılımın yanıtı kaybolduysa kurpiyerin tazelemesi oyuncuyu oturtur', () => {
    const { w, K, P } = table({ players: 1, seat: 0 })
    const B = P[0]
    B.desk.join()
    w.deliver((it) => it.from === B)
    same(K.m().seats.map((s) => s.id), ['5', '12'])
    w.drop((it) => it.from === K)
    w.advance(TM.JOIN_TIMEOUT_MS + 250, [B])
    assert.equal(B.m().stage, 'invited')
    w.advance(TM.KEEPALIVE_MS - TM.JOIN_TIMEOUT_MS, [K])
    assert.equal(K.sentTo(B, 'state').length, 2)
    w.deliver()
    assert.equal(B.m().stage, 'lobby')
    same(B.m().seats.map((s) => s.id), ['5', '12'])
  })

  test('başka bir kişinin reject iletisi ve katılma dışındaki reject atılır', () => {
    const { w, K, P } = table({ players: 2, seat: 0 })
    const [B, C] = P
    const g = K.m().g
    inject(B, K, plainText({ k: 'reject', g, why: 'full' }))
    assert.equal(B.m().stage, 'invited')
    B.desk.join()
    inject(B, C, plainText({ k: 'reject', g, why: 'full' }))
    assert.equal(B.m().stage, 'joining')
    w.deliver()
    assert.equal(B.m().stage, 'lobby')
  })

  test('kurpiyerin ikinci tarafı olmayan rol iletileri atılır', () => {
    const { w, K, P } = table({ players: 1 })
    const B = P[0]
    const g = K.m().g
    // Kurpiyere gelen state ve oyuncuya gelen act atılır
    const rev = K.m().rev
    inject(K, B, sealFrom(B, K, innerObj(B, K, 'state', g, { r: 50, ni: '0123456789abcdef', b: {} })))
    assert.equal(K.m().rev, rev)
    const n = B.sent.length
    inject(B, K, sealFrom(K, B, innerObj(K, B, 'decline', g, {})))
    inject(B, K, plainText({ k: 'decline', g, ni: '0123456789abcdef', why: 'user', key: null }))
    assert.equal(B.sent.length, n)
    w.deliver()
  })
})

describe('yeniden bağlanma ve bilinmeyen masa', () => {
  test('kurpiyer bilinmeyen g için gelen iç iletiye close gone ile yanıt verir, kişi başına 5 sn içinde bir kez', () => {
    const w = makeWorld()
    const K = w.add('5')
    const B = w.add('12')
    const g = 'aaaaaaaaaaaaaaaa'
    const sync = (seq) => inject(K, B, sealFrom(B, K, innerObj(B, K, 'sync', g, { seq })))
    sync(1)
    same(K.sentTo(B).map((it) => [it.msg.k, it.msg.g, it.msg.why]), [['close', g, 'gone']])
    sync(2)
    w.advance(TM.PLAIN_REPLY_MIN_MS - 250, [])
    sync(3)
    assert.equal(K.sentTo(B).length, 1)
    w.advance(250, [])
    sync(4)
    assert.equal(K.sentTo(B).length, 2)
  })

  test('kurpiyer sayfayı yenileyip dönerse oyuncu close gone alır ve dealer_left ile biter', () => {
    const { w, K, P } = started({ players: 1 })
    const B = P[0]
    K.reload()
    assert.equal(K.m().stage, 'none')
    w.ready(B, K)
    assert.equal(B.lastTo(K).msg.k, 'sync')
    w.deliver()
    same(B.m().ended, { reason: 'dealer_left' })
    // Bitiş ekranı kapatılınca oyuncu boşa döner
    B.desk.dismiss()
    assert.equal(B.m().stage, 'none')
  })

  test('peer-ready: koltuktakine önce davet, sonra durum, masası olan sayfa daveti yok sayar, yenilenmiş sayfa Oyuna Dön görür', () => {
    const { w, K, P } = started({ players: 2 })
    const [B, C] = P
    K.desk.act({ t: 'add', step: 0 })
    w.deliver()
    B.desk.act({ t: 'add', step: 1 })
    w.deliver()
    const n = K.sentTo(B).length
    w.ready(K, B)
    same(K.sentTo(B).slice(n).map((it) => it.msg.k), ['invite', 'state'])
    const inv = K.lastTo(B, 'invite').msg
    same([inv.ph, inv.seats], ['play', ['5', '12', '7']])
    w.deliver()
    assert.equal(B.m().stage, 'play', 'masası olan sayfa daveti yok sayar')
    assert.equal(B.noticesOf('invite').length, 1)
    // Sayfa yenilenir: aynı peerId, masa bilgisi yok
    B.reload()
    assert.equal(B.m().stage, 'none')
    const oldState = K.lastTo(B, 'state').p
    w.ready(K, B)
    w.deliver()
    assert.equal(B.m().stage, 'rejoin')
    assert.equal(B.noticesOf('invite')[0].data.rejoin, true)
    // Eski durum (yeniden oynatma) yeni sayfada ni yüzünden kabul edilmez
    inject(B, K, oldState)
    assert.equal(B.m().stage, 'rejoin')
    assert.equal(B.desk.join(), true)
    w.deliver()
    assert.equal(B.m().stage, 'play')
    same(B.m().view.total, 2)
    same(B.m().mine, { secret: 'el12' })
    same(B.m().ack, { seq: 1, ok: true })
    assert.equal(B.noticesOf('events').length, 0, 'geri dönüşteki eski olaylar duyurulmaz')
    // Sayaç ack.seq değerinden devam eder
    C.desk.act({ t: 'add', step: 2 })
    w.deliver()
    K.desk.act({ t: 'add', step: 3 })
    w.deliver()
    assert.equal(B.noticesOf('events').length, 2)
    assert.equal(B.desk.act({ t: 'add', step: 4 }), true)
    assert.equal(B.lastTo(K, 'act').msg.seq, 2)
    w.deliver()
    assert.equal(B.m().view.total, 5)
    assert.equal(B.m().error, null)
  })

  test('oyuncunun peer-ready olayında katılım ya da sync yeniden gider', () => {
    const { w, K, P } = table({ players: 2, seat: 1 })
    const [B, C] = P
    w.ready(B, K)
    assert.equal(B.lastTo(K).msg.k, 'sync')
    C.desk.join()
    w.drop((it) => it.from === C)
    w.ready(C, K)
    assert.equal(C.sentTo(K, 'join').length, 2)
    w.deliver()
    assert.equal(C.m().stage, 'lobby')
  })

  test('tazelik: eski leave ve act zarfı yeniden oynatılınca kişi masadan atılmaz', () => {
    const { w, K, P } = started({ players: 2 })
    const B = P[0]
    B.desk.act({ t: 'add', step: 0 })
    w.deliver()
    const oldAct = B.lastTo(K, 'act').p
    K.desk.act({ t: 'add', step: 0 })
    w.deliver()
    B.desk.leave()
    w.deliver()
    const oldLeave = B.lastTo(K, 'leave').p
    same(K.m().seats.map((s) => s.id), ['5', '7'])
    K.desk.endGame()
    K.desk.newRound()
    w.deliver()
    assert.equal(B.m().stage, 'invited')
    B.desk.join()
    w.deliver()
    same(K.m().seats.map((s) => s.id), ['5', '7', '12'])
    w.advance(TM.SEAT_REPLY_MIN_MS, [])
    const n = K.sentTo(B, 'state').length
    inject(K, B, oldLeave)
    inject(K, B, oldAct)
    same(K.m().seats.map((s) => s.id), ['5', '7', '12'])
    assert.equal(K.sentTo(B, 'state').length, n + 1, 'aynı seq: yalnızca sonuç yeniden gider')
    same(K.lastTo(B, 'state').msg.b.ack, { seq: 2, ok: true })
  })

  test('reset masayı siler ve ended reset bildirir', () => {
    const { K, P } = table({ players: 1 })
    const B = P[0]
    B.desk.onVoiceEvent({ type: 'reset' })
    K.desk.onVoiceEvent({ type: 'reset' })
    assert.equal(B.m().stage, 'none')
    assert.equal(K.m().stage, 'none')
    same(B.noticesOf('ended').map((x) => x.data), [{ reason: 'reset' }])
    same(K.noticesOf('ended').map((x) => x.data), [{ reason: 'reset' }])
  })
})

describe('tek masa, özel arama ve bildirimler', () => {
  test('iki lobi karşılaşınca küçük g kalır, kaybeden close superseded gönderir', () => {
    const w = makeWorld()
    const K = w.add('5')
    const C = w.add('7')
    const B = w.add('12')
    K.desk.openSetup('sayac')
    K.desk.openTable('bir')
    C.desk.openSetup('sayac')
    C.desk.openTable('bir')
    const win = K.m().g < C.m().g ? K : C
    const lose = win === K ? C : K
    w.deliver()
    assert.equal(win.m().role, 'dealer')
    assert.equal(win.m().stage, 'lobby')
    assert.equal(lose.m().role, 'player')
    assert.equal(lose.m().stage, 'invited')
    assert.equal(lose.m().invite.dealer, win.uid)
    same(lose.sent.filter((it) => it.msg.k === 'close').map((it) => [it.to, it.msg.why]).sort(),
      [[B.peerId, 'superseded'], [win.peerId, 'superseded']].sort())
    assert.equal(B.m().stage, 'invited')
    assert.equal(B.m().invite.dealer, win.uid)
    assert.equal(B.desk.join(), true)
    w.deliver()
    same(win.m().seats.map((s) => s.id), [win.uid, '12'])
  })

  test('oyundaki masa lobiye karşı kalır, oyundaki kurpiyer başka daveti yalnızca saklar', () => {
    const w = makeWorld()
    const K = w.add('5')
    const B = w.add('12')
    const C = w.add('7')
    C.inVoice = false
    K.desk.openSetup('sayac')
    K.desk.openTable('bir')
    w.deliver()
    B.desk.join()
    w.deliver()
    K.desk.start()
    w.deliver()
    C.inVoice = true
    assert.equal(C.desk.openSetup('sayac'), true)
    assert.equal(C.desk.openTable('bir'), true)
    w.ready(K, C)
    w.deliver()
    assert.equal(K.m().stage, 'play')
    assert.equal(C.m().role, 'player')
    assert.equal(C.m().stage, 'busy')
    same(C.sent.filter((it) => it.msg.k === 'close').map((it) => it.msg.why), ['superseded', 'superseded'])
    assert.equal(B.m().stage, 'play')
  })

  test('davet görmüş kişi masa kuramaz, Masa Kur ekranı gelen davetle kapanır', () => {
    const w = makeWorld()
    const K = w.add('5')
    const B = w.add('12')
    assert.equal(B.desk.openSetup('sayac'), true)
    K.desk.openSetup('sayac')
    K.desk.openTable('bir')
    w.deliver()
    assert.equal(B.m().stage, 'invited')
    B.desk.decline()
    assert.equal(B.desk.openSetup('sayac'), false)
    // Kurpiyer ayrılınca saklı davet silinir
    w.left(B, K)
    assert.equal(B.m().invite, null)
    assert.equal(B.desk.openSetup('sayac'), true)
  })

  test('özel aramada bütün oyun olayları atılır', () => {
    const w = makeWorld()
    const K = w.add('5')
    const B = w.add('12')
    B.private = true
    assert.equal(B.desk.openSetup('sayac'), false)
    K.desk.openSetup('sayac')
    K.desk.openTable('bir')
    w.deliver()
    assert.equal(B.m().stage, 'none')
    assert.equal(B.m().invite, null)
    w.ready(B, K)
    w.left(B, K)
    inject(B, K, sealFrom(K, B, innerObj(K, B, 'sync', K.m().g, { seq: 1 })))
    assert.equal(B.sent.length, 0)
    B.private = false
    w.ready(K, B)
    w.deliver()
    assert.equal(B.m().stage, 'invited')
    // Seste değilken de olaylar atılır
    B.inVoice = false
    B.desk.decline()
    w.ready(K, B)
    w.deliverOne(w.queue.shift())
    assert.equal(B.m().stage, 'none')
  })

  test('davet bildirimi aynı kurpiyerden 30 sn içinde en çok bir kez gelir', () => {
    const w = makeWorld()
    const K = w.add('5')
    const B = w.add('12')
    const reopen = () => {
      K.desk.closeTable()
      K.desk.openSetup('sayac')
      K.desk.openTable('bir')
      w.deliver()
    }
    K.desk.openSetup('sayac')
    K.desk.openTable('bir')
    w.deliver()
    assert.equal(B.noticesOf('invite').length, 1)
    reopen()
    assert.equal(B.m().stage, 'invited')
    assert.equal(B.noticesOf('invite').length, 1)
    w.advance(TM.INVITE_NOTIFY_MIN_MS - 250, [])
    reopen()
    assert.equal(B.noticesOf('invite').length, 1)
    w.advance(250, [])
    reopen()
    assert.equal(B.noticesOf('invite').length, 2)
  })

  test('engellenen kurpiyerin daveti gösterilmez', () => {
    const w = makeWorld()
    const K = w.add('5')
    const B = w.add('12')
    B.blocked['5'] = true
    K.desk.openSetup('sayac')
    K.desk.openTable('bir')
    w.deliver()
    assert.equal(B.m().stage, 'none')
    assert.equal(B.m().invite, null)
    assert.equal(B.notices.length, 0)
  })

  test('bir g ilk davetteki kurpiyere sabitlenir', () => {
    const { w, K, P } = table({ players: 2, seat: 0 })
    const [B, C] = P
    const inv = copy(K.lastTo(B, 'invite').msg)
    inv.dealer = '7'
    inv.seats = ['7']
    inject(B, C, JSON.stringify(inv))
    assert.equal(B.m().invite.dealer, '5')
    w.deliver()
  })
})

describe('görünüm modeli', () => {
  test('rev yalnızca değişiklikte artar, onChange yalnızca o zaman çağrılır', () => {
    const { w, K, P } = table({ players: 1 })
    const B = P[0]
    const rev = B.m().rev
    const changes = B.changes
    w.advance(1000, [B])
    assert.equal(B.m().rev, rev)
    assert.equal(B.changes, changes)
    K.desk.setRules('iki')
    w.deliver()
    assert.equal(B.m().rev, rev + 1)
    assert.equal(B.changes, changes + 1)
    // Model kopyadır: değiştirmek masayı etkilemez
    const m = B.m()
    m.seats.length = 0
    same(B.m().seats.map((s) => s.id), ['5', '12'])
  })

  test('kurpiyer modeli Uzakta çipini sırası 60 sn aşan koltukta gösterir ve oyunculara iletir', () => {
    const { w, K, P } = started({ players: 1 })
    const B = P[0]
    K.desk.act({ t: 'add', step: 0 })
    w.deliver()
    assert.equal(K.m().view.turn, '12')
    w.advance(TM.AWAY_MS, [K])
    w.deliver()
    same(K.m().seats.map((s) => s.away), [false, false])
    w.advance(250, [K])
    same(K.m().seats.map((s) => s.away), [false, true])
    assert.equal(K.m().room[0].status, 'away')
    w.deliver()
    same(B.m().seats.map((s) => s.away), [false, true])
    B.desk.act({ t: 'add', step: 1 })
    w.deliver()
    same(K.m().seats.map((s) => s.away), [false, false])
  })
})

// Renk: sıradaki oyuncunun modelinden basit bir hamle (oynanabilir ilk kart, yoksa çek ya da pas)
function renkMove (m) {
  const L = m.legal
  const step = m.view.step
  if (L.color) return { t: 'color', col: 'R', step }
  if (L.play.length) {
    const c = L.play[0]
    const mv = { t: 'play', c, step }
    if (c === 'WW' || c === 'WF') mv.col = 'G'
    if (m.mine.cards.length === 2) mv.last = true
    return mv
  }
  if (L.pass) return { t: 'pass', step }
  return { t: 'draw', step }
}

function playRenk (t) {
  const all = [t.K].concat(t.P)
  let moves = 0
  while (t.K.m().stage === 'play') {
    const km = t.K.m()
    const who = t.w.byUid(km.view.turn)
    const m = who.m()
    assert.equal(m.legal.turn, true)
    assert.equal(who.desk.act(renkMove(m)), true)
    t.w.deliver()
    assert.equal(who.m().error, null, 'hamle kabul edildi')
    const view = t.K.m().view
    for (const p of all) {
      const pm = p.m()
      same(pm.view, view, 'görünüm ' + p.uid)
      assert.equal(pm.mine.cards.length, view.seats.find((s) => s.id === p.uid).n)
    }
    moves++
    assert.ok(moves < 3000, 'el bitmeli')
  }
  return moves
}

describe('Renk ile', () => {
  test('üç kişi iki kural setinde birer el oynar, görünümler kurpiyerle aynıdır, eller yalnızca sahibine gider', () => {
    const t = started({ app: 'renk', players: 2, rules: 'official' })
    const [B, C] = t.P
    assert.equal(B.m().view.seats.length, 3)
    same(B.m().view.seats.map((s) => s.id), ['5', '12', '7'])
    assert.ok(playRenk(t) > 0)
    for (const d of [t.K, B, C]) {
      assert.equal(d.m().stage, 'over')
      assert.equal(d.m().view.result.reason, 'out')
    }
    // Hiçbir oyuncuya giden durumda başkasının eli yok
    for (const p of t.P) {
      for (const it of t.K.sentTo(p, 'state')) {
        if (it.msg.b.mine !== null) assert.equal(it.msg.b.mine.cards.length, it.msg.b.view.seats.find((s) => s.id === p.uid).n)
        const text = JSON.stringify(it.msg.b)
        assert.equal(text.indexOf('"hand"'), -1)
      }
    }
    // Bitmiş elde ayrılan oyuncu: koltuk sırası görünümle aynı kalır
    C.desk.leave()
    t.w.deliver()
    same(B.m().seats.map((s) => s.id), ['5', '12'])
    same(B.m().view.seats.map((s) => s.id), ['5', '12'])
    assert.equal(t.K.desk.newRound(), true)
    t.w.deliver()
    assert.equal(C.m().stage, 'invited')
    assert.equal(t.K.desk.setRules('stack'), true)
    C.desk.join()
    t.w.deliver()
    assert.equal(t.K.desk.start(), true)
    t.w.deliver()
    assert.equal(B.m().rules, 'stack')
    same(B.m().view.seats.map((s) => s.id), ['5', '12', '7'])
    assert.ok(playRenk(t) > 0)
    assert.equal(C.m().view.result.reason, 'out')
  })

  test('oyundan ayrılan oyuncunun kartları desteye döner, iki kişinin altında el too_few ile biter', () => {
    const t = started({ app: 'renk', players: 2, rules: 'official' })
    const [B, C] = t.P
    const deck = t.K.m().view.deck
    const cn = C.m().mine.cards.length
    C.desk.leave()
    t.w.deliver()
    assert.equal(t.K.m().view.deck, deck + cn)
    same(B.m().view.seats.map((s) => s.id), ['5', '12'])
    t.w.left(t.K, B)
    assert.equal(t.K.m().stage, 'over')
    assert.equal(t.K.m().view.result.reason, 'too_few')
    same(t.K.m().seats.map((s) => s.id), ['5'])
    // Tek koltuklu bitmiş masada Yeni El açılabilir, Başlat için iki kişi gerekir
    assert.equal(t.K.desk.newRound(), true)
    assert.equal(t.K.desk.start(), false)
  })
})

describe('modül', () => {
  test('saf yüklenir, saat, DOM, ağ ve sözlük kullanmaz', () => {
    const code = DESK_SRC.replace(/^\s*\/\/.*$/gm, '')
    for (const word of ['document', 'XMLHttpRequest', 'Math.random', 'Date', 'setTimeout', 'setInterval', 'localStorage',
      'navigator', 'nacl', 'E2EE', 'console']) {
      assert.equal(code.indexOf(word), -1, word)
    }
    assert.doesNotMatch(code, /(^|[^A-Za-z0-9_$.])t\(/)
    assert.ok(Object.isFrozen(DESK))
    assert.ok(Object.isFrozen(TM))
    assert.ok(Object.isFrozen(TM.BACKOFF_MS))
  })

  test('sabitler belgedeki değerlerdir', () => {
    same(TM, {
      JOIN_TIMEOUT_MS: 10000,
      ACK_RESEND_MS: 10000,
      SLOW_MS: 8000,
      KEEPALIVE_MS: 15000,
      SILENT_SYNC_MS: 25000,
      SYNC_MIN_MS: 10000,
      SILENT_END_MS: 45000,
      SEAT_REPLY_MIN_MS: 1000,
      SYNC_REPLY_MIN_MS: 5000,
      PLAIN_REPLY_MIN_MS: 5000,
      HOLD_JOIN_MS: 10000,
      AWAY_MS: 60000,
      BACKOFF_MS: [2000, 4000, 8000, 16000, 30000],
      INVITE_NOTIFY_MIN_MS: 30000,
      SELF_DELAY_MS: 300
    })
    same(DESK.DELAYED_MOVES, ['last', 'catch'])
    for (const code of DESK.ERRORS) assert.ok(G.isCode(code), code)
  })

  test('yöntemler ve görünüm modeli alanları', () => {
    const w = makeWorld()
    const K = w.add('5')
    same(Object.keys(K.desk).sort(), ['act', 'cancelSetup', 'closeTable', 'decline', 'dismiss', 'endGame', 'join', 'leave',
      'model', 'newRound', 'onVoiceEvent', 'openInvite', 'openSetup', 'openTable', 'recheck', 'removeSeat', 'setRules',
      'start', 'tick'].sort())
    same(Object.keys(K.m()).sort(), ['ack', 'app', 'dealer', 'ended', 'error', 'events', 'g', 'invite', 'legal', 'locked',
      'max', 'me', 'min', 'mine', 'newEvents', 'pending', 'rd', 'rejected', 'rev', 'role', 'room', 'rules', 'seats', 'slow',
      'stage', 'syncing', 'view'].sort())
    assert.equal(K.desk.cancelSetup(), false)
    K.desk.openSetup('renk')
    assert.equal(K.desk.setRules('stack'), true)
    assert.equal(K.m().rules, 'stack')
    same([K.m().min, K.m().max], [2, 8])
    assert.equal(K.desk.cancelSetup(), true)
    assert.equal(K.m().stage, 'none')
  })
})
