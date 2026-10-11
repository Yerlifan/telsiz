'use strict'

// Hexball ağı (public/js/45-hexball-ag.js, window.TelsizHexballNet) testleri. Modül tarayıcıdaki gibi Node vm
// bağlamında, protokol çekirdeği (33), kural motoru (43) ve fizikle (44) birlikte yüklenir. Saat, zamanlayıcılar ve
// veri kanalı sahtedir: tek bir sahte saat bütün zamanlayıcıları ve ağ teslimlerini zaman sırasıyla çalıştırır, ağ
// gecikme, titreşim (yeniden sıralama) ve kaybı tohumlu xorshift32 ile üretir.
// Sınananlar: ikili iletilerin baytları ve gidiş dönüşü, sabit noktalı değerler, bozuk, eksik, fazla ve büyük
// iletilerin reddi, rastgele bozulmuş iletilerde çökmeme, el sıkışma (lobi ve maç kimliği, yineleme, 5 sn zaman
// aşımı, eski istemci, açılamayan bağ), ev sahibi döngüsü ve anlık görüntü hızı, uyarlanır hız, ev sahibinin kendi
// girdisinin bekletilmesi, girdi kısıtları (kişi, eş, yuva, onay, saniyede 120, eski seq, sarmal), oyuncu kısıtları
// (yalnız ev sahibi, eski tick, saniyede 60 girdi, vuruşun kaybolmaması), ara değerleme ve çizim saati, kayıp ve sıra
// dışı paket, maç kimliği değişimi, kısılan sekmede duraklama ve sürme, fizik olaylarının kişi kimliğine çevrilmesi.

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..')
const NET_PATH = path.join(ROOT, 'public', 'js', '45-hexball-ag.js')
const NET_SRC = fs.readFileSync(NET_PATH, 'utf8')

function readJs (name) {
  return fs.readFileSync(path.join(ROOT, 'public', 'js', name), 'utf8')
}

const DEPS = ['33-oyun-protokol.js', '43-hexball-kural.js', '44-hexball-fizik.js'].map((name) => ({ name: name, src: readJs(name) }))

function load () {
  const sandbox = vm.createContext({})
  sandbox.window = sandbox
  DEPS.forEach((d) => vm.runInContext(d.src, sandbox, { filename: d.name }))
  vm.runInContext(NET_SRC, sandbox, { filename: '45-hexball-ag.js' })
  return sandbox
}

const CTX = load()
const N = CTX.TelsizHexballNet
const P = CTX.TelsizHexballPhysics
const H = CTX.TelsizHexball

const EPOCH_A = '0123456789abcdef'
const EPOCH_B = 'fedcba9876543210'
const TICK_MS = 1000 / 60

function plain (x) {
  return x === undefined ? undefined : JSON.parse(JSON.stringify(x))
}

function same (actual, expected, message) {
  assert.deepEqual(plain(actual), plain(expected), message)
}

function bytes (buf) {
  return Array.from(new Uint8Array(buf))
}

function fromBytes (list) {
  return new Uint8Array(list).buffer
}

function xorshift (seed) {
  let x = (seed >>> 0) || 0x9e3779b9
  return () => {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return x / 4294967296
  }
}

// Sahte saat: zamanlayıcılar ve ağ teslimleri zaman sırasıyla (eşitse ekleme sırasıyla) çalışır
function makeClock () {
  const c = { t: 0, n: 0, q: [] }
  c.now = () => c.t
  c.at = (when, fn) => {
    c.n++
    c.q.push({ when: when, id: c.n, fn: fn })
    return c.n
  }
  c.cancel = (id) => {
    c.q = c.q.filter((x) => x.id !== id)
  }
  c.run = (until) => {
    let best = true
    while (best !== null) {
      best = null
      c.q.forEach((x) => {
        if (x.when <= until && (best === null || x.when < best.when || (x.when === best.when && x.id < best.id))) best = x
      })
      if (best === null) break
      c.q.splice(c.q.indexOf(best), 1)
      if (best.when > c.t) c.t = best.when
      best.fn()
    }
    if (until > c.t) c.t = until
  }
  c.step = (ms) => c.run(c.t + ms)
  return c
}

// Ev sahibi '1' (eş p1) ve oyuncular. players: gerçek oyuncu oturumları, manual: oturumu olmayan, iletilerini testin
// kendisinin gönderdiği eşler, old: kanalı açan ama hiç yanıt vermeyen eski istemciler. Varsayılan maç: ev sahibi
// yuva 0 Kırmızı, sonrakiler sırayla Mavi, Kırmızı...
function makeWorld (o) {
  const opt = Object.assign({ players: ['2'], manual: [], old: [], latency: 20, jitter: 0, loss: 0, seed: 1, openDelay: 30 }, o || {})
  const clock = makeClock()
  const rnd = xorshift(opt.seed)
  const ids = opt.players.concat(opt.manual, opt.old)
  const peerOf = (id) => 'p' + id
  const idOf = (pid) => pid.slice(1)
  const W = {
    clock: clock,
    lag: 0,
    full: {},
    filter: null,
    openCode: () => 'ok',
    opens: [],
    closed: [],
    hostEvents: [],
    hostSent: [],
    playerSent: {},
    playerEvents: {},
    inbox: {},
    lost: 0,
    errors: [],
    players: {},
    up: {},
    low: false
  }
  ids.forEach((id) => {
    W.inbox[id] = []
    W.playerSent[id] = []
    W.playerEvents[id] = []
  })

  function net (dir, id, msg, fn) {
    if (W.filter && W.filter(dir, id, msg) === false) {
      W.lost++
      return
    }
    if (opt.loss > 0 && rnd() < opt.loss) {
      W.lost++
      return
    }
    clock.at(clock.t + opt.latency + (opt.jitter > 0 ? rnd() * opt.jitter : 0), fn)
  }

  W.host = N.createHost({
    now: clock.now,
    setTimeout: (fn, ms) => clock.at(clock.t + ms + W.lag, fn),
    clearTimeout: clock.cancel,
    send: (pid, buf) => {
      const id = idOf(pid)
      const msg = plain(N.decode(buf))
      W.hostSent.push({ t: clock.t, to: id, msg: msg, size: buf.byteLength })
      if (!W.up[pid] || W.full[pid]) return false
      const copy = buf.slice(0)
      net('down', id, msg, () => {
        W.inbox[id].push({ t: clock.t, msg: msg })
        if (W.players[id]) W.players[id].onData('p1', '1', copy)
      })
      return true
    },
    openLink: (pid) => {
      W.opens.push({ t: clock.t, pid: pid })
      const code = W.openCode(pid)
      if (code === 'ok') clock.at(clock.t + opt.openDelay, () => W.linkOpen(idOf(pid)))
      if (code === 'open') W.up[pid] = true
      return code
    },
    closeLink: (pid) => {
      W.closed.push(pid)
      W.up[pid] = false
    },
    lowUplink: () => W.low,
    onEvent: (e) => W.hostEvents.push(Object.assign({ t: clock.t }, plain(e))),
    onError: (err) => W.errors.push(err)
  }, { me: '1' })

  W.linkOpen = (id) => {
    W.up[peerOf(id)] = true
    W.host.onVoiceEvent({ type: 'link-open', peerId: peerOf(id), userId: id })
    if (W.players[id]) W.players[id].onVoiceEvent({ type: 'link-open', peerId: 'p1', userId: '1' })
  }
  W.linkDown = (id, type) => {
    W.up[peerOf(id)] = false
    W.host.onVoiceEvent({ type: type, peerId: peerOf(id), userId: id })
    if (W.players[id]) W.players[id].onVoiceEvent({ type: type, peerId: 'p1', userId: '1' })
  }

  opt.players.forEach((id) => {
    W.players[id] = N.createPlayer({
      now: clock.now,
      setTimeout: (fn, ms) => clock.at(clock.t + ms, fn),
      clearTimeout: clock.cancel,
      send: (pid, buf) => {
        const msg = plain(N.decode(buf))
        W.playerSent[id].push({ t: clock.t, to: pid, msg: msg })
        if (!W.up[peerOf(id)]) return false
        const copy = buf.slice(0)
        net('up', id, msg, () => W.host.onData(peerOf(id), id, copy))
        return true
      },
      onEvent: (e) => W.playerEvents[id].push(Object.assign({ t: clock.t }, plain(e))),
      onError: (err) => W.errors.push(err)
    }, { hostId: '1', hostPeer: 'p1' })
  })

  W.toHost = (id, buf, userId) => W.host.onData(peerOf(id), userId === undefined ? id : userId, buf)
  W.matchPlayers = [{ id: '1', slot: 0, side: 'red' }].concat(opt.players.concat(opt.manual).map((id, i) => ({
    id: id, slot: i + 1, side: i % 2 === 0 ? 'blue' : 'red'
  })))
  W.start = (epoch, players, kick) => W.host.startMatch({
    epoch: epoch || EPOCH_A, rules: 'quick', kick: kick || 'red', players: players || W.matchPlayers
  })
  // manual eşin son HELLO'sunu onaylar
  W.ack = (id) => {
    const h = W.hellos(id).pop()
    W.toHost(id, N.encodeHelloAck({ epoch: h.epoch, slot: h.slot }))
    return h
  }
  W.hellos = (id) => W.inbox[id].filter((x) => x.msg && x.msg.type === 'hello').map((x) => x.msg)
  W.snaps = (id) => W.inbox[id].filter((x) => x.msg && x.msg.type === 'snap')
  W.sentTo = (id, type) => W.hostSent.filter((x) => x.to === id && x.msg && x.msg.type === type)
  W.linkEvents = (id) => W.hostEvents.filter((e) => e.e === 'link' && e.id === id).map((e) => e.state)
  W.slotOf = (n) => W.host.frame().players.filter((p) => p.slot === n)[0]
  W.host.setPeers(ids.map((id) => ({ id: id, peerId: peerOf(id) })))
  return W
}

function noErrors (W) {
  assert.equal(W.errors.length, 0, W.errors.map((e) => e && e.stack).join('\n'))
}

function input (seq, x, y, kick, lastTick) {
  return N.encodeInput({ seq: seq, lastTick: lastTick || 0, kick: Boolean(kick), x: x || 0, y: y || 0 })
}

function snapOf (tick, over) {
  return Object.assign({
    tick: tick,
    phase: 'play',
    remaining: 1000,
    score: { red: 0, blue: 0 },
    ackSeq: 0,
    ball: { x: 0, y: 0, vx: 0, vy: 0 },
    players: [{ slot: 0, x: -100, y: 0, vx: 0, vy: 0, kick: false }, { slot: 1, x: 100, y: 0, vx: 0, vy: 0, kick: false }]
  }, over || {})
}

describe('sözleşme', () => {
  test('modül dondurulmuş, biçim ve kısıt değerleri raporla aynı', () => {
    assert.ok(Object.isFrozen(N))
    assert.ok(Object.isFrozen(N.TYPES) && Object.isFrozen(N.PHASES) && Object.isFrozen(N.LINK_STATES))
    assert.equal(N.VERSION, 1)
    same(N.TYPES, { HELLO: 1, HELLO_ACK: 2, INPUT: 3, SNAP: 4 })
    assert.equal(N.HELLO_BYTES, 13)
    assert.equal(N.ACK_BYTES, 11)
    assert.equal(N.INPUT_BYTES, 11)
    assert.equal(N.SNAP_BASE, 22)
    assert.equal(N.SNAP_PER, 10)
    assert.equal(N.MAX_BYTES, 102)
    assert.equal(N.NO_SLOT, 255)
    assert.equal(N.POS_SCALE, 8)
    assert.equal(N.VEL_SCALE, 64)
    // Aşama kodlarının sırası fiziğinkiyle aynı
    same(N.PHASES, P.PHASES)
    same(N.LINK_STATES, ['none', 'waiting', 'ready', 'failed'])
    assert.equal(N.TICK_HZ, P.TICK_HZ)
    assert.equal(N.SNAP_HZ, 30)
    assert.equal(N.SNAP_HZ_LOW, 20)
    assert.equal(N.PAUSE_GAP_MS, 250)
    assert.equal(N.MAX_HOST_DELAY_MS, 80)
    assert.equal(N.MAX_INPUT_RATE, 120)
    assert.equal(N.HELLO_TIMEOUT_MS, 5000)
    assert.equal(N.BUFFER_SNAPS, 2)
    assert.equal(N.MAX_BUFFER_MS, 150)
    // En uzun maçın kalan süresi desisaniye olarak u16 alanına sığar
    assert.ok(P.MAX_SECS * 10 <= N.MAX_REMAINING && N.MAX_REMAINING <= 65535)
    // En büyük ileti voice.js oyun bağının sınırının altında
    const V = fs.readFileSync(path.join(ROOT, 'public', 'voice.js'), 'utf8')
    const m = /var MAX_GAME_DATA = (\d+)/.exec(V)
    assert.ok(m && N.MAX_BYTES <= Number(m[1]))
    // Oyuncu en çok saniyede 60 girdi gönderir, ev sahibi 120'ye kadar işler, voice.js 240'ın üstünü atar
    assert.ok(1000 / N.MIN_INPUT_MS <= N.MAX_INPUT_RATE)
    const r = /var GAME_DATA_RATE = (\d+)/.exec(V)
    assert.ok(r && N.MAX_INPUT_RATE < Number(r[1]))
  })

  test('saflık: saat, zamanlayıcı ve gönderim yalnızca env üzerinden, DOM ve rastgelelik yok, başka bir oyunun adı geçmiyor', () => {
    const code = NET_SRC.split('\n').map((line) => line.replace(/\/\/.*$/, '')).join('\n')
    const banned = [/Math\.random/, /\bDate\b/, /performance/, /(^|[^.\w'])setTimeout\b/, /(^|[^.\w'])clearTimeout\b/,
      /setInterval/, /requestAnimationFrame/, /\bdocument\b/, /navigator/, /\bvoice\b/, /structuredClone/, /\bfor\s*\(/,
      /\bconsole\b/]
    banned.forEach((re) => assert.ok(!re.test(code), String(re)))
    assert.ok(/window\.TelsizHexballNet = \(function \(P, H\) \{/.test(code))
    assert.ok(/\}\)\(window\.TelsizHexballPhysics, window\.TelsizHexball\)\s*$/.test(code))
    const name = new RegExp(String.fromCharCode(104, 97, 120, 98, 97, 108, 108), 'i')
    assert.ok(!name.test(NET_SRC), 'ağ kaynağı')
    assert.ok(!name.test(fs.readFileSync(__filename, 'utf8')), 'test dosyası')
  })
})

describe('kodlama ve çözme', () => {
  test('HELLO ve HELLO_ACK baytları ve gidiş dönüşü, lobi ve izleyici', () => {
    const h = N.encodeHello({ epoch: EPOCH_A, slot: 3, tickHz: 60, snapHz: 30 })
    same(bytes(h), [1, 1, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 3, 60, 30])
    same(N.decode(h), { type: 'hello', epoch: EPOCH_A, slot: 3, tickHz: 60, snapHz: 30 })
    const lobby = N.encodeHello({ epoch: null, slot: null, tickHz: 60, snapHz: 20 })
    same(bytes(lobby), [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 255, 60, 20])
    same(N.decode(lobby), { type: 'hello', epoch: null, slot: null, tickHz: 60, snapHz: 20 })
    const a = N.encodeHelloAck({ epoch: EPOCH_B, slot: 7 })
    same(bytes(a), [1, 2, 0xfe, 0xdc, 0xba, 0x98, 0x76, 0x54, 0x32, 0x10, 7])
    same(N.decode(a), { type: 'hello_ack', epoch: EPOCH_B, slot: 7 })
    same(N.decode(N.encodeHelloAck({ epoch: null, slot: null })), { type: 'hello_ack', epoch: null, slot: null })
  })

  test('INPUT baytları little endian, eksenler i8 ve sınırlı', () => {
    const b = N.encodeInput({ seq: 0x1234, lastTick: 0x89abcdef, kick: true, x: 1, y: -0.5 })
    same(bytes(b), [1, 3, 0x34, 0x12, 0xef, 0xcd, 0xab, 0x89, 1, 127, 0xc1])
    const d = N.decode(b)
    assert.equal(d.type, 'input')
    assert.equal(d.seq, 0x1234)
    assert.equal(d.lastTick, 0x89abcdef)
    assert.equal(d.kick, true)
    assert.equal(d.x, 1)
    assert.equal(d.y, -63 / 127)
    // Aralık dışı eksen sınıra çekilir, -128 baytı -1 olarak okunur
    same(bytes(N.encodeInput({ seq: 0, lastTick: 0, kick: false, x: 5, y: -9 })).slice(8), [0, 127, 129])
    const raw = bytes(b)
    raw[9] = 0x80
    assert.equal(N.decode(fromBytes(raw)).x, -1)
    const max = N.decode(N.encodeInput({ seq: 65535, lastTick: 4294967295, kick: false, x: 0, y: 0 }))
    assert.equal(max.seq, 65535)
    assert.equal(max.lastTick, 4294967295)
    assert.equal(max.kick, false)
  })

  test('SNAP: 8 oyuncuyla 102 bayt, sabit noktalı konum ve hız, gidiş dönüş', () => {
    const players = []
    let i = 0
    while (i < 8) {
      players.push({ slot: 7 - i, x: -300 + 75.125 * i, y: 12.5 - 3 * i, vx: 1.5 - i / 4, vy: -0.015625 * i, kick: i % 3 === 0 })
      i++
    }
    const s = {
      tick: 123456789,
      phase: 'goal',
      remaining: 1799,
      score: { red: 4, blue: 255 },
      ackSeq: 65000,
      ball: { x: 361.3, y: -12.06, vx: -15.99, vy: 0.01 },
      players: players
    }
    const b = N.encodeSnap(s)
    assert.equal(b.byteLength, 102)
    const raw = bytes(b)
    same(raw.slice(0, 2), [1, 4])
    same(raw.slice(2, 6), [0x15, 0xcd, 0x5b, 0x07])
    assert.equal(raw[6], 2)
    same(raw.slice(7, 9), [0x07, 0x07])
    same(raw.slice(9, 11), [4, 255])
    assert.equal(raw[21], 8)
    const d = N.decode(b)
    assert.equal(d.type, 'snap')
    assert.equal(d.tick, 123456789)
    assert.equal(d.phase, 'goal')
    assert.equal(d.remaining, 1799)
    same(d.score, { red: 4, blue: 255 })
    assert.equal(d.ackSeq, 65000)
    // Konum 1/8, hız 1/64 birime yuvarlanır
    same(d.ball, { x: Math.round(361.3 * 8) / 8, y: Math.round(-12.06 * 8) / 8, vx: Math.round(-15.99 * 64) / 64, vy: Math.round(0.01 * 64) / 64 })
    assert.equal(d.players.length, 8)
    d.players.forEach((p, k) => {
      const q = players[k]
      assert.equal(p.slot, q.slot)
      assert.ok(Math.abs(p.x - q.x) <= 1 / 16 && Math.abs(p.y - q.y) <= 1 / 16, 'konum')
      assert.ok(Math.abs(p.vx - q.vx) <= 1 / 128 && Math.abs(p.vy - q.vy) <= 1 / 128, 'hız')
      assert.equal(p.kick, q.kick)
    })
    // Çözülen değerler yeniden kodlanınca aynı baytlar çıkar
    same(bytes(N.encodeSnap(d)), raw)
    // Oyuncusuz anlık görüntü 22 bayt, her aşama kodlanır
    N.PHASES.forEach((ph, k) => {
      const e = N.encodeSnap(snapOf(0, { phase: ph, players: [] }))
      assert.equal(e.byteLength, 22)
      assert.equal(bytes(e)[6], k)
      assert.equal(N.decode(e).phase, ph)
    })
  })

  test('taşan sabit noktalı değer sınıra çekilir', () => {
    const d = N.decode(N.encodeSnap(snapOf(1, { ball: { x: 5000, y: -5000, vx: 1000, vy: -1000 }, players: [] })))
    same(d.ball, { x: 32767 / 8, y: -32768 / 8, vx: 32767 / 64, vy: -32768 / 64 })
  })

  test('kodlayıcılar hatalı alanda null döner', () => {
    const okHello = { epoch: EPOCH_A, slot: 0, tickHz: 60, snapHz: 30 }
    const badHello = [
      null, 'x', { epoch: 'ABCDEF0123456789', slot: 0, tickHz: 60, snapHz: 30 },
      { epoch: '0000000000000000', slot: 0, tickHz: 60, snapHz: 30 }, { epoch: EPOCH_A.slice(1), slot: 0, tickHz: 60, snapHz: 30 },
      { epoch: EPOCH_A, slot: 8, tickHz: 60, snapHz: 30 }, { epoch: EPOCH_A, slot: -1, tickHz: 60, snapHz: 30 },
      { epoch: EPOCH_A, slot: 0.5, tickHz: 60, snapHz: 30 }, { epoch: EPOCH_A, slot: 0, tickHz: 0, snapHz: 30 },
      { epoch: EPOCH_A, slot: 0, tickHz: 256, snapHz: 30 }, { epoch: EPOCH_A, slot: 0, tickHz: 60, snapHz: '30' }
    ]
    assert.ok(N.encodeHello(okHello))
    badHello.forEach((h, i) => assert.equal(N.encodeHello(h), null, 'hello ' + i))
    assert.equal(N.encodeHelloAck({ epoch: EPOCH_A, slot: 9 }), null)
    assert.equal(N.encodeHelloAck({ epoch: 7, slot: 0 }), null)
    const okInput = { seq: 1, lastTick: 2, kick: false, x: 0, y: 0 }
    assert.ok(N.encodeInput(okInput))
    const badInput = [
      { seq: 65536, lastTick: 0, kick: false, x: 0, y: 0 }, { seq: -1, lastTick: 0, kick: false, x: 0, y: 0 },
      { seq: 0, lastTick: 4294967296, kick: false, x: 0, y: 0 }, { seq: 0, lastTick: 0, kick: 1, x: 0, y: 0 },
      { seq: 0, lastTick: 0, kick: false, x: NaN, y: 0 }, { seq: 0, lastTick: 0, kick: false, x: 0, y: Infinity },
      { seq: 0, lastTick: 0, kick: false, x: '1', y: 0 }
    ]
    badInput.forEach((x, i) => assert.equal(N.encodeInput(x), null, 'input ' + i))
    const p = (slot) => ({ slot: slot, x: 0, y: 0, vx: 0, vy: 0, kick: false })
    const badSnap = [
      snapOf(-1), snapOf(4294967296), snapOf(1, { phase: 'teams' }), snapOf(1, { remaining: 60001 }),
      snapOf(1, { score: { red: 256, blue: 0 } }), snapOf(1, { score: { red: 0 } }), snapOf(1, { ackSeq: 65536 }),
      snapOf(1, { ball: { x: NaN, y: 0, vx: 0, vy: 0 } }), snapOf(1, { players: [p(0), p(0)] }),
      snapOf(1, { players: [p(8)] }), snapOf(1, { players: [0, 1, 2, 3, 4, 5, 6, 7, 0].map((s, i) => p(i % 8)) }),
      snapOf(1, { players: [{ slot: 0, x: 0, y: 0, vx: 0, vy: 0, kick: 0 }] }), snapOf(1, { players: null })
    ]
    badSnap.forEach((s, i) => assert.equal(N.encodeSnap(s), null, 'snap ' + i))
  })

  test('bozuk ve büyük ileti reddedilir', () => {
    const hello = bytes(N.encodeHello({ epoch: EPOCH_A, slot: 1, tickHz: 60, snapHz: 30 }))
    const ack = bytes(N.encodeHelloAck({ epoch: EPOCH_A, slot: 1 }))
    const inp = bytes(input(1, 0.5, 0.5, true, 9))
    const snap = bytes(N.encodeSnap(snapOf(5)))
    const bad = [
      null, undefined, 'abc', 42, [1, 1], {}, new ArrayBuffer(0), fromBytes([1]),
      // Sürüm ve tür
      fromBytes([0].concat(hello.slice(1))), fromBytes([2].concat(hello.slice(1))),
      fromBytes([1, 0].concat(hello.slice(2))), fromBytes([1, 5].concat(hello.slice(2))), fromBytes([1, 255].concat(hello.slice(2))),
      // Boy bir bayt eksik ya da fazla
      fromBytes(hello.slice(0, 12)), fromBytes(hello.concat([0])), fromBytes(ack.slice(0, 10)), fromBytes(ack.concat([0])),
      fromBytes(inp.slice(0, 10)), fromBytes(inp.concat([0])), fromBytes(snap.slice(0, snap.length - 1)),
      fromBytes(snap.concat([0])), fromBytes(snap.slice(0, 21)),
      // Büyük ileti: en büyük geçerli SNAP'ten uzun olan her şey
      fromBytes(snap.concat(new Array(103 - snap.length).fill(0))), new ArrayBuffer(512), new ArrayBuffer(4096)
    ]
    bad.forEach((b, i) => assert.equal(N.decode(b), null, 'bozuk ' + i))
    const field = (base, at, value) => {
      const out = base.slice()
      out[at] = value
      return fromBytes(out)
    }
    // Alanlar: yuva, adım hızı, anlık görüntü hızı, düğme bitleri, aşama, kalan süre, oyuncu sayısı, yuva, bayraklar
    const fields = [
      field(hello, 10, 8), field(hello, 10, 254), field(hello, 11, 30), field(hello, 12, 0), field(hello, 12, 61),
      field(ack, 10, 100), field(inp, 8, 2), field(inp, 8, 0x81), field(snap, 6, 5), field(snap, 21, 3)
    ]
    const over = snap.slice()
    over[7] = 0x61
    over[8] = 0xea
    fields.push(fromBytes(over))
    const s8 = bytes(N.encodeSnap(snapOf(5, { players: [] })))
    s8[21] = 9
    fields.push(fromBytes(s8.concat(new Array(80).fill(0))))
    fields.push(field(snap, 22, 8), field(snap, 32, 0), field(snap, 31, 2))
    fields.forEach((b, i) => assert.equal(N.decode(b), null, 'alan ' + i))
    // Sınırdaki geçerli değerler kabul edilir
    over[7] = 0x60
    assert.equal(N.decode(fromBytes(over)).remaining, 60000)
    assert.equal(N.decode(field(hello, 12, 60)).snapHz, 60)
  })

  test('ArrayBuffer görünümü ve başka bağlamın tamponu çözülür', () => {
    const b = bytes(N.encodeHelloAck({ epoch: EPOCH_A, slot: 2 }))
    const big = new Uint8Array(40)
    big.set(b, 7)
    same(N.decode(big.subarray(7, 7 + b.length)), { type: 'hello_ack', epoch: EPOCH_A, slot: 2 })
    same(N.decode(new DataView(big.buffer, 7, b.length)), { type: 'hello_ack', epoch: EPOCH_A, slot: 2 })
    same(N.decode(new Uint8Array(b).buffer), { type: 'hello_ack', epoch: EPOCH_A, slot: 2 })
    assert.equal(N.decode(big.subarray(7, 7 + b.length - 1)), null)
  })

  test('rastgele bozulmuş iletilerde çökme yok, geçerli çıkan ileti yeniden kodlanınca aynı içeriği verir', () => {
    const next = xorshift(2024)
    const bases = [
      bytes(N.encodeHello({ epoch: EPOCH_A, slot: 1, tickHz: 60, snapHz: 30 })),
      bytes(N.encodeHelloAck({ epoch: EPOCH_B, slot: null })),
      bytes(input(77, -0.3, 0.9, true, 1000)),
      bytes(N.encodeSnap(snapOf(99, { phase: 'kickoff' })))
    ]
    let valid = 0
    let k = 0
    while (k < 4000) {
      const base = bases[k % bases.length].slice()
      const flips = 1 + Math.floor(next() * 3)
      let f = 0
      while (f < flips) {
        base[Math.floor(next() * base.length)] = Math.floor(next() * 256)
        f++
      }
      if (next() < 0.1) base.length = Math.floor(next() * base.length)
      const d = N.decode(fromBytes(base))
      if (d) {
        valid++
        const enc = d.type === 'hello' ? N.encodeHello(d) : d.type === 'hello_ack' ? N.encodeHelloAck(d)
          : d.type === 'input' ? N.encodeInput(d) : N.encodeSnap(d)
        assert.ok(enc, 'yeniden kodlanır')
        same(N.decode(enc), d)
      }
      k++
    }
    assert.ok(valid > 100, 'geçerli kalan bozulmalar da sınandı')
  })

  test('seq karşılaştırması sarmalı tanır', () => {
    assert.equal(N.seqNewer(1, 0), true)
    assert.equal(N.seqNewer(0, 65535), true)
    assert.equal(N.seqNewer(10, 65530), true)
    assert.equal(N.seqNewer(0, 1), false)
    assert.equal(N.seqNewer(5, 5), false)
    assert.equal(N.seqNewer(32768, 0), false)
    assert.equal(N.seqNewer(32767, 0), true)
  })
})

describe('el sıkışma ve bağ', () => {
  test('lobide bağ açılır, HELLO lobi kimliğiyle gider, onayla hazır olur', () => {
    const W = makeWorld({ players: ['2', '3'] })
    W.clock.run(1000)
    same(W.host.links(), { 2: 'ready', 3: 'ready' })
    same(W.opens.map((x) => x.pid), ['p2', 'p3'])
    same(W.linkEvents('2'), ['waiting', 'ready'])
    const h = W.sentTo('2', 'hello')
    assert.equal(h.length, 1, 'onay gelince yinelenmez')
    same(h[0].msg, { type: 'hello', epoch: null, slot: null, tickHz: 60, snapHz: 30 })
    same(W.playerSent['2'].map((x) => x.msg), [{ type: 'hello_ack', epoch: null, slot: null }])
    same(plain(W.players['2'].state()).ready, true)
    assert.equal(W.players['2'].state().epoch, null)
    assert.equal(W.sentTo('2', 'snap').length, 0, 'maç yokken anlık görüntü yok')
    assert.equal(W.host.frame(), null)
    assert.equal(W.players['2'].frame(), null)
    noErrors(W)
  })

  test('maç başında el yeni kimlik ve yuvayla yeniden sıkışılır, sonra anlık görüntüler 30 Hz akar', () => {
    const W = makeWorld({ players: ['2', '3'] })
    W.clock.run(500)
    assert.equal(W.start(), true)
    same(W.host.links(), { 2: 'waiting', 3: 'waiting' })
    W.clock.run(600)
    same(W.host.links(), { 2: 'ready', 3: 'ready' })
    same(W.linkEvents('2'), ['waiting', 'ready', 'waiting', 'ready'])
    same(W.sentTo('2', 'hello').pop().msg, { type: 'hello', epoch: EPOCH_A, slot: 1, tickHz: 60, snapHz: 30 })
    same(W.sentTo('3', 'hello').pop().msg.slot, 2)
    same(W.playerEvents['2'].map((e) => [e.e, e.epoch, e.slot]), [['hello', null, null], ['hello', EPOCH_A, 1]])
    W.clock.run(2600)
    const snaps = W.sentTo('2', 'snap').filter((x) => x.t >= 1600)
    assert.ok(snaps.length >= 29 && snaps.length <= 31, 'saniyede ' + snaps.length)
    snaps.forEach((x) => assert.equal(x.size, 22 + 10 * 3))
    const ticks = snaps.map((x) => x.msg.tick)
    ticks.forEach((t, i) => {
      if (i) assert.equal(t - ticks[i - 1], 2, 'iki adımda bir')
    })
    const last = snaps[snaps.length - 1].msg
    assert.equal(last.phase, 'kickoff')
    assert.equal(last.remaining, 1800)
    same(last.players.map((p) => p.slot), [0, 1, 2])
    noErrors(W)
  })

  test('kayıp HELLO yinelenir, yinelenen HELLO aynı onayı alır ve olay üretmez', () => {
    const W = makeWorld({ players: ['2'] })
    let dropped = 0
    W.filter = (dir, id, msg) => {
      if (dir === 'down' && msg.type === 'hello' && dropped < 3) {
        dropped++
        return false
      }
      return true
    }
    W.clock.run(2000)
    assert.equal(W.host.links()['2'], 'ready')
    const h = W.sentTo('2', 'hello')
    assert.equal(h.length, 4)
    h.forEach((x, i) => {
      if (i) assert.ok(Math.abs(x.t - h[i - 1].t - 250) <= 17, 'yaklaşık 250 ms arayla')
    })
    // Aynı HELLO yeniden gelirse oyuncu yine onaylar ama yeni el sıkışma sayılmaz
    W.players['2'].onData('p1', '1', N.encodeHello({ epoch: null, slot: null, tickHz: 60, snapHz: 30 }))
    assert.equal(W.playerEvents['2'].filter((e) => e.e === 'hello').length, 1)
    assert.equal(W.playerSent['2'].filter((x) => x.msg.type === 'hello_ack').length, 2)
    noErrors(W)
  })

  test('eski istemci: kanal açılır ama onay gelmez, 5 sn sonra failed, geç onay kabul edilir', () => {
    const W = makeWorld({ players: [], old: ['4'] })
    W.clock.run(4900)
    assert.equal(W.host.links()['4'], 'waiting')
    const resent = W.sentTo('4', 'hello').length
    assert.ok(resent >= 18 && resent <= 20, 'bekleme sırasında 250 ms arayla: ' + resent)
    W.clock.run(5200)
    assert.equal(W.host.links()['4'], 'failed')
    same(W.linkEvents('4'), ['waiting', 'failed'])
    // failed iken saniyede bir HELLO
    const before = W.sentTo('4', 'hello').length
    W.clock.run(8200)
    const slow = W.sentTo('4', 'hello').length - before
    assert.ok(slow >= 2 && slow <= 4, 'saniyede bir: ' + slow)
    // Yanlış kimlik ya da yuvayla onay yok sayılır, doğrusu kabul edilir
    W.toHost('4', N.encodeHelloAck({ epoch: EPOCH_A, slot: null }))
    W.toHost('4', N.encodeHelloAck({ epoch: null, slot: 0 }))
    assert.equal(W.host.links()['4'], 'failed')
    W.toHost('4', N.encodeHelloAck({ epoch: null, slot: null }))
    assert.equal(W.host.links()['4'], 'ready')
    noErrors(W)

    // Arada maç başlaması 5 sn süresini uzatmaz, süre kanalın açılışından sayılır
    const M = makeWorld({ players: [], old: ['4'] })
    M.clock.run(4000)
    M.start(EPOCH_A, [{ id: '1', slot: 0, side: 'red' }, { id: '4', slot: 1, side: 'blue' }])
    M.clock.run(5100)
    assert.equal(M.host.links()['4'], 'failed')
    same(M.sentTo('4', 'hello').pop().msg.epoch, EPOCH_A)
    assert.equal(M.sentTo('4', 'snap').length, 0, 'onaylamayan eşe anlık görüntü gitmez')
    noErrors(M)
  })

  test('bağ açma kodları: not_ready yinelenir, blocked failed, open hemen el sıkışır, açılmayan ya da açılmaya başlamayan bağ 15 sn sonra failed', () => {
    const W = makeWorld({ players: ['2'] })
    W.openCode = () => 'not_ready'
    W.clock.run(3500)
    assert.equal(W.opens.length, 4, 'saniyede bir yeniden denenir')
    assert.equal(W.host.links()['2'], 'none')
    W.openCode = () => 'open'
    W.clock.run(4100)
    assert.equal(W.host.links()['2'], 'ready')
    noErrors(W)

    const B = makeWorld({ players: ['2'] })
    B.openCode = () => 'blocked'
    B.clock.run(5000)
    assert.equal(B.opens.length, 1)
    assert.equal(B.host.links()['2'], 'failed')
    // Yeni ses bağlantısı (peer-ready) bir kez daha dener
    B.openCode = () => 'ok'
    B.host.onVoiceEvent({ type: 'peer-ready', peerId: 'p2', userId: '2' })
    B.clock.run(6000)
    assert.equal(B.opens.length, 2)
    assert.equal(B.host.links()['2'], 'ready')
    noErrors(B)

    const S = makeWorld({ players: ['2'], openDelay: 1e9 })
    S.clock.run(14000)
    assert.equal(S.host.links()['2'], 'waiting')
    S.clock.run(16000)
    assert.equal(S.host.links()['2'], 'failed')
    noErrors(S)

    // Kanal hiç açılmaya başlayamazsa (ses bağlantısı hazır değil, eş yok) da 15 sn sonra failed olur, ses
    // bağlantısı hazır olunca (peer-ready) yeniden denenir
    for (const code of ['not_ready', 'no_peer', 'not_in_voice']) {
      const Z = makeWorld({ players: ['2'] })
      Z.openCode = () => code
      Z.clock.run(14900)
      assert.equal(Z.host.links()['2'], 'none', code)
      Z.clock.run(15100)
      assert.equal(Z.host.links()['2'], 'failed', code)
      same(Z.linkEvents('2'), ['failed'])
      const opens = Z.opens.length
      Z.clock.run(30000)
      assert.equal(Z.opens.length, opens, 'failed kendiliğinden yeniden denenmez: ' + code)
      Z.openCode = () => 'ok'
      Z.host.onVoiceEvent({ type: 'peer-ready', peerId: 'p2', userId: '2' })
      Z.clock.run(31000)
      assert.equal(Z.host.links()['2'], 'ready', code)
      noErrors(Z)
    }
    // Kanal kapanınca 15 sn yeniden sayılır
    const C = makeWorld({ players: ['2'] })
    C.clock.run(20000)
    assert.equal(C.host.links()['2'], 'ready')
    C.openCode = () => 'not_ready'
    C.linkDown('2', 'link-close')
    C.clock.run(34000)
    assert.equal(C.host.links()['2'], 'none')
    C.clock.run(35100)
    assert.equal(C.host.links()['2'], 'failed')
    noErrors(C)
  })

  test('kanal kapanınca none olur ve yeniden açılır, link-failed failed yapar, ses oturumu bitince hepsi none', () => {
    const W = makeWorld({ players: ['2', '3'] })
    W.clock.run(1000)
    W.linkDown('2', 'link-close')
    assert.equal(W.host.links()['2'], 'none')
    assert.equal(W.players['2'].state().ready, false)
    assert.equal(W.playerEvents['2'].pop().e, 'lost')
    W.clock.run(2500)
    assert.equal(W.opens.filter((x) => x.pid === 'p2').length, 2)
    assert.equal(W.host.links()['2'], 'ready')
    W.linkDown('3', 'link-failed')
    assert.equal(W.host.links()['3'], 'failed')
    W.clock.run(5000)
    assert.equal(W.opens.filter((x) => x.pid === 'p3').length, 1, 'failed kendiliğinden yeniden denenmez')
    W.host.onVoiceEvent({ type: 'reset' })
    same(W.host.links(), { 2: 'none', 3: 'none' })
    noErrors(W)
  })

  test('setPeers denetimi, listeden çıkan eşin bağı kapatılır', () => {
    const W = makeWorld({ players: ['2', '3'] })
    W.clock.run(1000)
    assert.equal(W.host.setPeers([{ id: '2', peerId: 'p2' }, { id: '2', peerId: 'p9' }]), false)
    assert.equal(W.host.setPeers([{ id: '2', peerId: 'p2' }, { id: '5', peerId: 'p2' }]), false)
    assert.equal(W.host.setPeers([{ id: '1', peerId: 'p1' }]), false)
    assert.equal(W.host.setPeers([{ id: '', peerId: 'p2' }]), false)
    assert.equal(W.host.setPeers([{ id: '2' }]), false)
    assert.equal(W.host.setPeers('p2'), false)
    same(W.host.links(), { 2: 'ready', 3: 'ready' }, 'hatalı liste bir şey değiştirmez')
    assert.equal(W.host.setPeers([{ id: '2', peerId: 'p2' }]), true)
    same(W.host.links(), { 2: 'ready' }, 'kalan eşin bağı korunur')
    same(W.closed, ['p3'])
    // Listede olmayan eşten gelen veri yok sayılır
    W.toHost('3', N.encodeHelloAck({ epoch: null, slot: null }))
    same(W.host.links(), { 2: 'ready' })
    noErrors(W)
  })
})

describe('ev sahibi döngüsü ve girdiler', () => {
  test('oyuncunun girdisi ev sahibindeki diskini hareket ettirir, diğer diskler durur', () => {
    const W = makeWorld({ players: ['2', '3'] })
    W.clock.run(200)
    W.start()
    W.clock.run(800)
    const y1 = W.slotOf(1).y
    const y2 = W.slotOf(2).y
    W.players['2'].setInput({ x: 0, y: -1, kick: false })
    W.clock.run(1800)
    assert.ok(W.slotOf(1).y < y1 - 50, 'yuva 1 yukarı gitti: ' + (W.slotOf(1).y - y1))
    assert.equal(W.slotOf(2).y, y2)
    // Öbür oyuncu da anlık görüntülerde görür
    const f = W.players['3'].frame()
    const seen = f.players.filter((p) => p.slot === 1)[0]
    assert.ok(seen.y < y1 - 30)
    assert.equal(f.me, 2)
    noErrors(W)
  })

  test('ackSeq oyuncunun işlenen son girdisi, gidiş dönüş iki yönde ölçülür', () => {
    const W = makeWorld({ players: ['2', '3'], latency: 25 })
    W.clock.run(200)
    W.start()
    W.clock.run(1000)
    let k = 0
    while (k < 20) {
      W.players['2'].setInput({ x: Math.sin(k), y: 0, kick: false })
      W.clock.step(40)
      k++
    }
    W.clock.step(200)
    const inputs = W.playerSent['2'].filter((x) => x.msg.type === 'input')
    // Her anlık görüntünün ackSeq değeri, gönderildiği ana kadar ev sahibine ulaşmış en yeni girdinin seq değeri
    const sent = W.sentTo('2', 'snap').filter((x) => x.t > 1000)
    assert.ok(sent.length > 20)
    sent.forEach((x) => {
      const before = inputs.filter((i) => i.t + 25 < x.t).map((i) => i.msg.seq)
      const upTo = inputs.filter((i) => i.t + 25 <= x.t).map((i) => i.msg.seq)
      const ok = [Math.max.apply(null, before), Math.max.apply(null, upTo)]
      assert.ok(ok.indexOf(x.msg.ackSeq) >= 0, x.msg.ackSeq + ' yerine ' + ok.join(' veya '))
    })
    // Oyuncu her anlık görüntüye girdiyle yanıt verir, ev sahibi gidiş dönüşü buradan ölçer (değişen girdi
    // anlık görüntüden sonra gittiği için ölçüm biraz büyüktür)
    const rtt = W.host.info().rtt
    assert.ok(rtt['2'] >= 49 && rtt['2'] <= 80, 'ev sahibi ölçümü: ' + rtt['2'])
    assert.ok(rtt['3'] >= 49 && rtt['3'] <= 55, 'yalnız yanıt veren oyuncu: ' + rtt['3'])
    const pr = W.players['2'].state().rtt
    assert.ok(pr >= 49 && pr <= 100, 'oyuncu ölçümü: ' + pr)
    // Girdi göndermeyen izleyici değil, yuvası olan oyuncunun ackSeq değeri artar
    assert.ok(W.snaps('3').every((x) => x.msg.ackSeq <= W.playerSent['3'].filter((y) => y.msg.type === 'input').length))
    noErrors(W)
  })

  test('ev sahibinin kendi girdisi ortalama gidiş dönüş kadar, en çok 80 ms bekletilir', () => {
    const W = makeWorld({ players: ['2', '3'], latency: 20 })
    W.clock.run(200)
    W.start()
    W.clock.run(2000)
    const delay = W.host.info().delay
    assert.ok(delay >= 39 && delay <= 50, 'gecikme ' + delay)
    const y0 = W.slotOf(0).y
    W.host.setInput({ x: 0, y: -1, kick: false })
    const t0 = W.clock.t
    W.clock.run(t0 + delay - 5)
    assert.equal(W.slotOf(0).y, y0, 'bekleme süresinde uygulanmaz')
    W.clock.run(t0 + delay + 40)
    assert.ok(W.slotOf(0).y < y0, 'süre dolunca uygulanır')
    noErrors(W)

    const F = makeWorld({ players: ['2'], latency: 100 })
    F.clock.run(200)
    F.start()
    F.clock.run(3000)
    assert.equal(F.host.info().delay, 80)
    noErrors(F)

    // Oyuncusu olmayan ev sahibi beklemez
    const A = makeWorld({ players: [] })
    A.start(EPOCH_A, [{ id: '1', slot: 0, side: 'red' }])
    A.clock.run(300)
    assert.equal(A.host.info().delay, 0)
    noErrors(A)
  })

  test('bekletmede kısa basılan vuruş kaybolmaz', () => {
    const A = makeWorld({ players: [] })
    A.start(EPOCH_A, [{ id: '1', slot: 0, side: 'red' }])
    A.clock.run(100)
    A.host.setInput({ x: 0, y: 0, kick: true })
    A.host.setInput({ x: 0, y: 0, kick: false })
    // Vuruş tutuluyor bayrağı bir adım boyunca görünür, sonra bırakılır
    const seen = []
    let k = 0
    while (k < 60) {
      A.clock.step(1)
      seen.push(A.slotOf(0).kick)
      k++
    }
    const on = seen.filter(Boolean).length
    assert.ok(on >= 15 && on <= 18, 'bir adım: ' + on)
    assert.equal(seen[seen.length - 1], false)
    noErrors(A)
  })

  test('girdi kısıtları: kişi, eş, yuva, onay, saniyede 120, eski seq ve sarmal', () => {
    const W = makeWorld({ players: [], manual: ['2', '3'] })
    W.clock.run(500)
    W.ack('2')
    W.ack('3')
    same(W.host.links(), { 2: 'ready', 3: 'ready' })
    // 3 izleyici: maçta yuvası yok
    W.start(EPOCH_A, [{ id: '1', slot: 0, side: 'red' }, { id: '2', slot: 1, side: 'blue' }])
    const y0 = W.slotOf(1).y
    // Onaydan önce gelen girdi işlenmez
    W.toHost('2', input(1, 0, -1))
    W.clock.step(300)
    assert.equal(W.slotOf(1).y, y0)
    W.clock.step(100)
    assert.equal(W.ack('2').slot, 1)
    assert.equal(W.ack('3').slot, null)
    W.clock.step(100)
    same(W.host.links(), { 2: 'ready', 3: 'ready' })
    const lastSnap = (id) => W.snaps(id)[W.snaps(id).length - 1].msg
    // Yanlış kişi kimliği ve bilinmeyen eş
    W.toHost('2', input(50, 0, -1), '3')
    W.host.onData('p9', '9', input(51, 0, -1))
    W.clock.step(100)
    assert.equal(lastSnap('2').ackSeq, 0)
    assert.equal(W.slotOf(1).y, y0)
    // İzleyicinin girdisi işlenmez, ackSeq artmaz
    W.toHost('3', input(7, 1, 0))
    W.clock.step(100)
    assert.equal(lastSnap('3').ackSeq, 0)
    // Saniyede en çok 120 girdi
    let s = 1
    while (s <= 200) {
      W.toHost('2', input(s, 0, s <= 120 ? -1 : 1))
      s++
    }
    W.clock.step(100)
    assert.equal(lastSnap('2').ackSeq, 120)
    W.clock.step(400)
    assert.ok(W.slotOf(1).y < y0, 'işlenen girdiler yukarı')
    W.clock.step(600)
    // Pencere yenilenince yeniden işlenir, eski seq atılır
    W.toHost('2', input(300, 0, 1))
    W.toHost('2', input(299, 0, -1))
    W.clock.step(100)
    assert.equal(lastSnap('2').ackSeq, 300)
    const ya = W.slotOf(1).y
    W.clock.step(500)
    assert.ok(W.slotOf(1).y > ya, 'seq 300 aşağı uygulandı, eski seq 299 atıldı')
    // Sarmal: seq yarım daireden az ilerledikçe yeni sayılır, 65535 ardından 0 gelir
    W.toHost('2', input(30000, 0, 0))
    W.toHost('2', input(60000, 0, 0))
    W.toHost('2', input(65535, 0, 0))
    W.clock.step(100)
    assert.equal(lastSnap('2').ackSeq, 65535)
    W.toHost('2', input(0, 0, 0))
    W.toHost('2', input(40000, 0, 0))
    W.clock.step(100)
    assert.equal(lastSnap('2').ackSeq, 0, '40000, 0 değerinden yarım daireden fazla ileride: eski sayılır')
    // Bozuk, büyük ve yanlış yöndeki iletiler bir şey değiştirmez
    W.toHost('2', new ArrayBuffer(600))
    W.toHost('2', fromBytes([1, 3, 1, 2]))
    W.toHost('2', N.encodeHello({ epoch: EPOCH_A, slot: 1, tickHz: 60, snapHz: 30 }))
    W.toHost('2', N.encodeSnap(snapOf(5)))
    W.toHost('2', 'girdi')
    W.clock.step(100)
    assert.equal(lastSnap('2').ackSeq, 0)
    same(W.host.links(), { 2: 'ready', 3: 'ready' })
    noErrors(W)
  })

  test('uyarlanır hız: gönderim tıkanınca 2 sn 20 Hz, düşük yükleme hızında herkese 20 Hz', () => {
    const W = makeWorld({ players: ['2', '3'] })
    W.clock.run(200)
    W.start()
    W.clock.run(1000)
    W.full.p2 = true
    W.clock.run(1100)
    W.full.p2 = false
    const count = (id, a, b) => W.sentTo(id, 'snap').filter((x) => x.t >= a && x.t < b).length
    W.clock.run(2200)
    const slow = count('2', 1200, 2200)
    assert.ok(slow >= 19 && slow <= 21, 'tıkanan eşe 20 Hz: ' + slow)
    const fast = count('3', 1200, 2200)
    assert.ok(fast >= 29 && fast <= 31, 'öbür eşe 30 Hz: ' + fast)
    W.clock.run(4500)
    const back = count('2', 3500, 4500)
    assert.ok(back >= 29 && back <= 31, 'süre dolunca 30 Hz: ' + back)
    W.low = true
    W.clock.run(6000)
    assert.ok(count('2', 5000, 6000) <= 21 && count('3', 5000, 6000) <= 21)
    W.host.endMatch()
    assert.equal(W.sentTo('2', 'hello').pop().msg.snapHz, 20, 'HELLO düşük hızı bildirir')
    noErrors(W)
  })

  test('fizik olayları kişi kimliği ve maç kimliğiyle bildirilir, gol tek kişiyle atılır', () => {
    const A = makeWorld({ players: [] })
    assert.equal(A.start(EPOCH_A, [{ id: '1', slot: 0, side: 'red' }]), true)
    A.clock.run(100)
    A.host.setInput({ x: 1, y: 0, kick: false })
    A.clock.run(8000)
    const ev = A.hostEvents.filter((e) => e.e !== 'link')
    assert.ok(ev.length >= 2)
    same(ev[0].e, 'play')
    same(ev[0].by, '1')
    const goal = ev.filter((e) => e.e === 'goal')[0]
    assert.ok(goal, 'gol oldu')
    assert.equal(goal.side, 'red')
    assert.equal(goal.by, '1')
    assert.equal(goal.epoch, EPOCH_A)
    assert.ok(Number.isInteger(goal.at) && goal.at >= 0 && goal.at < 10)
    // Kural motoruna giden hamle biçimine uyar
    assert.ok(H.validateMove({ t: 'goal', mt: 1, side: goal.side, by: goal.by, at: goal.at }))
    same(A.host.frame().score, { red: 1, blue: 0 })
    noErrors(A)
  })

  test('startMatch denetimi, aynı maç kimliği bir şey değiştirmez, ev sahibi izleyici olabilir', () => {
    const W = makeWorld({ players: ['2'] })
    W.clock.run(500)
    const ok = { epoch: EPOCH_A, rules: 'quick', kick: 'red', players: [{ id: '2', slot: 0, side: 'red' }] }
    const bad = [
      null, Object.assign({}, ok, { epoch: '0000000000000000' }), Object.assign({}, ok, { epoch: EPOCH_A.toUpperCase() }),
      Object.assign({}, ok, { rules: 'stack' }), Object.assign({}, ok, { kick: 'spec' }), Object.assign({}, ok, { players: [] }),
      Object.assign({}, ok, { players: [{ id: '2', slot: 0, side: 'spec' }] }),
      Object.assign({}, ok, { players: [{ id: '2', slot: 0, side: 'red' }, { id: '3', slot: 0, side: 'blue' }] }),
      Object.assign({}, ok, { players: [{ id: '2', slot: 0, side: 'red' }, { id: '2', slot: 1, side: 'blue' }] }),
      Object.assign({}, ok, { players: [{ id: '2', slot: 8, side: 'red' }] })
    ]
    bad.forEach((m, i) => assert.equal(W.host.startMatch(m), false, 'kötü ' + i))
    assert.equal(W.host.frame(), null)
    assert.equal(W.host.startMatch(ok), true)
    W.clock.run(1000)
    const hellos = W.sentTo('2', 'hello').length
    assert.equal(W.host.startMatch(ok), true)
    W.clock.run(1500)
    assert.equal(W.sentTo('2', 'hello').length, hellos, 'aynı maç için yeniden el sıkışılmaz')
    const f = W.host.frame()
    assert.equal(f.me, null, 'ev sahibi izleyici')
    W.host.setInput({ x: 1, y: 0, kick: true })
    W.clock.run(1700)
    same(Object.keys(f).sort(), Object.keys(W.players['2'].frame()).sort(), 'ev sahibi ve oyuncu çizim biçimi aynı')
    noErrors(W)
  })
})

describe('oyuncu', () => {
  function bare () {
    const clock = makeClock()
    const sent = []
    const events = []
    const pl = N.createPlayer({
      now: clock.now,
      setTimeout: (fn, ms) => clock.at(clock.t + ms, fn),
      clearTimeout: clock.cancel,
      send: (pid, buf) => {
        sent.push({ t: clock.t, to: pid, msg: plain(N.decode(buf)) })
        return true
      },
      onEvent: (e) => events.push(plain(e))
    }, { hostId: '1', hostPeer: 'p1' })
    const hello = (epoch, slot, snapHz) => N.encodeHello({ epoch: epoch, slot: slot, tickHz: 60, snapHz: snapHz || 30 })
    return { clock: clock, sent: sent, events: events, pl: pl, hello: hello }
  }

  test('yalnızca ev sahibinin eşinden HELLO ve SNAP alınır, SNAP el sıkışmadan önce atılır', () => {
    const B = bare()
    B.pl.onData('p1', '1', N.encodeSnap(snapOf(5)))
    assert.equal(B.pl.frame(), null)
    B.pl.onData('p9', '1', B.hello(EPOCH_A, 1))
    B.pl.onData('p1', '9', B.hello(EPOCH_A, 1))
    B.pl.onData('p1', 1, N.encodeHelloAck({ epoch: EPOCH_A, slot: 1 }))
    B.pl.onData('p1', '1', new ArrayBuffer(200))
    B.pl.onData('p1', '1', 'hello')
    assert.equal(B.sent.length, 0)
    assert.equal(B.pl.state().ready, false)
    // Kullanıcı kimliği sayı olarak da gelebilir
    B.pl.onData('p1', 1, B.hello(EPOCH_A, 1))
    same(B.sent.map((x) => x.msg), [{ type: 'hello_ack', epoch: EPOCH_A, slot: 1 }])
    same(B.events, [{ e: 'hello', epoch: EPOCH_A, slot: 1 }])
    B.pl.onData('p9', '1', N.encodeSnap(snapOf(5)))
    assert.equal(B.pl.frame(), null)
    B.pl.onData('p1', '1', N.encodeSnap(snapOf(5)))
    assert.ok(B.pl.frame())
  })

  test('eski ve yinelenen tick atılır, yeni maç kimliği tamponu boşaltır', () => {
    const B = bare()
    B.pl.onData('p1', '1', B.hello(EPOCH_A, 0))
    B.pl.onData('p1', '1', N.encodeSnap(snapOf(10)))
    B.clock.step(30)
    B.pl.onData('p1', '1', N.encodeSnap(snapOf(8, { phase: 'over' })))
    B.pl.onData('p1', '1', N.encodeSnap(snapOf(10, { phase: 'over' })))
    assert.equal(B.pl.state().tick, 10)
    B.pl.onData('p1', '1', N.encodeSnap(snapOf(12)))
    assert.equal(B.pl.state().tick, 12)
    assert.equal(B.pl.frame().phase, 'play', 'atılan iletinin aşaması görünmez')
    B.pl.onData('p1', '1', B.hello(EPOCH_B, 2))
    assert.equal(B.pl.frame(), null)
    assert.equal(B.pl.state().tick, -1)
    assert.equal(B.pl.state().slot, 2)
    // Lobi kimliğinde anlık görüntü alınmaz
    B.pl.onData('p1', '1', B.hello(null, null))
    B.pl.onData('p1', '1', N.encodeSnap(snapOf(20)))
    assert.equal(B.pl.frame(), null)
    same(B.events.map((e) => e.epoch), [EPOCH_A, EPOCH_B, null])
    // Ev sahibiyle bağ koparsa el sıkışma unutulur
    B.pl.onVoiceEvent({ type: 'link-close', peerId: 'p9', userId: '9' })
    assert.equal(B.pl.state().ready, true)
    B.pl.onVoiceEvent({ type: 'link-close', peerId: 'p1', userId: '1' })
    assert.equal(B.pl.state().ready, false)
    same(B.events.pop(), { e: 'lost' })
  })

  test('girdi saniyede en çok 60 kez gider, son değer kaybolmaz, kısa vuruş basılı ve bırakılmış iki girdiyle gider', () => {
    const B = bare()
    B.pl.setInput({ x: 1, y: 0, kick: false })
    assert.equal(B.sent.length, 0, 'el sıkışmadan önce girdi gitmez')
    B.pl.onData('p1', '1', B.hello(EPOCH_A, 3))
    B.sent.length = 0
    let k = 0
    while (k < 100) {
      B.pl.setInput({ x: (k % 21 - 10) / 10, y: 0, kick: false })
      B.clock.step(1)
      k++
    }
    B.pl.setInput({ x: 0.25, y: -0.5, kick: false })
    B.clock.step(50)
    const inputs = B.sent.filter((x) => x.msg.type === 'input')
    assert.ok(inputs.length >= 6 && inputs.length <= 8, 'gönderilen ' + inputs.length)
    inputs.forEach((x, i) => {
      if (i) assert.ok(x.t - inputs[i - 1].t >= 1000 / 60 - 1e-9)
      assert.equal(x.msg.seq, i)
      assert.equal(x.to, 'p1')
    })
    const last = inputs[inputs.length - 1].msg
    assert.ok(Math.abs(last.x - 0.25) < 0.01 && Math.abs(last.y + 0.5) < 0.01)
    B.sent.length = 0
    B.pl.setInput({ x: 0.25, y: -0.5, kick: true })
    B.pl.setInput({ x: 0.25, y: -0.5, kick: false })
    B.clock.step(100)
    same(B.sent.map((x) => x.msg.kick), [true, false])
    // Değişmeyen girdi gönderilmez
    B.pl.setInput({ x: 0.25, y: -0.5, kick: false })
    B.clock.step(100)
    assert.equal(B.sent.length, 2)
    // İzleyici girdi göndermez
    B.pl.onData('p1', '1', B.hello(EPOCH_A, null))
    B.sent.length = 0
    B.pl.setInput({ x: -1, y: 0, kick: true })
    B.pl.onData('p1', '1', N.encodeSnap(snapOf(3)))
    B.clock.step(100)
    same(B.sent.map((x) => x.msg.type), [])
  })

  test('ara değerleme: iki anlık görüntülük tampon, tick tekdüze artar, konum iki anlık görüntü arasında', () => {
    const W = makeWorld({ players: ['2', '3'], latency: 20 })
    W.clock.run(200)
    W.start()
    W.clock.run(700)
    W.players['2'].setInput({ x: 0, y: -1, kick: false })
    W.host.setInput({ x: 1, y: 0.3, kick: false })
    const pl = W.players['3']
    let prev = -Infinity
    let checked = 0
    let between = 0
    while (W.clock.t < 4000) {
      W.clock.step(16)
      const f = pl.frame()
      if (!f) continue
      assert.ok(f.tick >= prev, 'tick geri gitmez')
      prev = f.tick
      if (W.clock.t < 1500) continue
      // Çizim, ev sahibinin adımından tampon ve gecikme kadar geride
      const lag = W.host.info().tick - f.tick
      assert.ok(lag >= 3 && lag <= 9.5, 'geride ' + lag)
      const got = W.snaps('3').map((x) => x.msg)
      const a = got.filter((s) => s.tick <= f.tick).pop()
      const b = got.filter((s) => s.tick >= f.tick)[0]
      if (!a || !b) continue
      const d = f.players.filter((p) => p.slot === 1)[0]
      const ya = a.players.filter((p) => p.slot === 1)[0].y
      const yb = b.players.filter((p) => p.slot === 1)[0].y
      // Doğrusal ara değer: çizim tick'inin iki anlık görüntü arasındaki oranı
      const r = b.tick > a.tick ? (f.tick - a.tick) / (b.tick - a.tick) : 0
      assert.ok(Math.abs(d.y - (ya + (yb - ya) * r)) <= 1e-9, 'ara değer')
      if (r > 0.1 && r < 0.9 && Math.abs(yb - ya) > 0.5) between++
      checked++
    }
    assert.ok(checked > 100)
    assert.ok(between > 50, 'iki anlık görüntünün arasında çizilen kareler: ' + between)
    const st = pl.state()
    assert.ok(st.buffer >= 66 && st.buffer <= 80, 'tampon ' + st.buffer)
    noErrors(W)
  })

  test('kayıp ve sıra dışı paket: el sıkışma tamamlanır, eski paket atılır, çizim tutarlı kalır', () => {
    const W = makeWorld({ players: ['2', '3'], latency: 40, jitter: 60, loss: 0.2, seed: 99 })
    const order = []
    W.clock.run(3000)
    same(W.host.links(), { 2: 'ready', 3: 'ready' })
    W.start()
    W.clock.run(5000)
    same(W.host.links(), { 2: 'ready', 3: 'ready' })
    W.players['2'].setInput({ x: 0, y: -1, kick: false })
    W.host.setInput({ x: 1, y: 0, kick: true })
    const f0 = P.field('quick')
    let prev = -Infinity
    let frames = 0
    while (W.clock.t < 12000) {
      W.clock.step(16)
      const f = W.players['3'].frame()
      if (!f) continue
      frames++
      assert.ok(f.tick >= prev)
      prev = f.tick
      const all = f.players.concat([f.ball])
      all.forEach((d) => {
        assert.ok(isFinite(d.x) && isFinite(d.y))
        assert.ok(Math.abs(d.x) <= f0.hw + P.MARGIN + 1 && Math.abs(d.y) <= f0.hh + P.MARGIN + 1)
      })
      // Oyuncunun bildiği en yeni tick, ulaşan en yeni tick'e eşit: sonradan gelen eski paket geri götürmez
      const got = W.snaps('3').map((x) => x.msg.tick)
      assert.equal(W.players['3'].state().tick, Math.max.apply(null, got))
    }
    assert.ok(frames > 300)
    const ids = ['2', '3']
    ids.forEach((id) => {
      W.snaps(id).forEach((x, i, list) => {
        if (i && x.msg.tick < list[i - 1].msg.tick) order.push(id)
      })
    })
    assert.ok(order.length > 10, 'sıra dışı teslim oldu: ' + order.length)
    assert.ok(W.lost > 50, 'kayıp oldu: ' + W.lost)
    // Kayba rağmen oyuncunun girdisi ev sahibine ulaştı
    assert.ok(W.slotOf(1).y < -50)
    noErrors(W)
  })

  test('maç bitince son skorla son bir anlık görüntü gider, lobi kimliğiyle el sıkışılır, yeni maçta yuva değişebilir', () => {
    const W = makeWorld({ players: ['2', '3'] })
    W.clock.run(200)
    W.start()
    W.clock.run(1500)
    assert.ok(W.players['2'].frame())
    const before = W.hostSent.length
    assert.equal(W.host.endMatch(), true)
    assert.equal(W.host.endMatch(), false)
    assert.equal(W.host.frame(), null)
    // Maç kalkmadan önce onaylamış eşlere over aşamasıyla son anlık görüntü, ardından lobi HELLO'su gider
    for (const id of ['2', '3']) {
      const after = W.hostSent.slice(before).filter((x) => x.to === id).map((x) => x.msg.type + ':' + (x.msg.phase || x.msg.epoch))
      same(after, ['snap:over', 'hello:null'])
    }
    W.clock.run(2000)
    // Oyuncu lobiye döner ama masanın sonuç durumu gelene kadar son kareyi (kendi diskiyle) çizer
    const st = W.players['2'].state()
    assert.equal(st.epoch, null)
    assert.equal(st.ended, true)
    assert.equal(st.ready, true)
    const last = W.players['2'].frame()
    assert.equal(last.phase, 'over')
    assert.equal(last.me, 1)
    same(last.score, { red: 0, blue: 0 })
    // Lobide girdi gönderilmez
    const sent = W.playerSent['2'].filter((x) => x.msg.type === 'input').length
    W.players['2'].setInput({ x: 1, y: 0, kick: true })
    W.clock.step(100)
    assert.equal(W.playerSent['2'].filter((x) => x.msg.type === 'input').length, sent)
    const n = W.sentTo('2', 'snap').length
    W.clock.run(3000)
    assert.equal(W.sentTo('2', 'snap').length, n, 'maç yokken anlık görüntü yok')
    W.start(EPOCH_B, [{ id: '1', slot: 1, side: 'red' }, { id: '2', slot: 0, side: 'blue' }, { id: '3', slot: 2, side: 'blue' }])
    W.clock.run(4000)
    same(W.playerEvents['2'].map((e) => [e.epoch, e.slot]), [[null, null], [EPOCH_A, 1], [null, null], [EPOCH_B, 0]])
    assert.equal(W.players['2'].frame().me, 0)
    assert.equal(W.players['2'].state().ended, false)
    assert.equal(W.players['2'].frame().phase, 'kickoff', 'yeni maçta önceki maçın son karesi kalmaz')
    noErrors(W)
  })

  test('sırasız kanalda lobi HELLO\'su son anlık görüntüden önce gelirse son kare yine çizilir, girdi gitmez', () => {
    const W = makeWorld({ players: ['2'], latency: 20 })
    W.clock.run(200)
    W.start()
    W.clock.run(1000)
    // Son SNAP lobi HELLO'sundan sonra ulaşır
    let held = null
    W.filter = (dir, id, msg) => {
      if (dir === 'down' && msg.type === 'snap' && msg.phase === 'over' && !held) {
        held = msg
        return false
      }
      return true
    }
    W.host.endMatch()
    W.clock.step(100)
    W.filter = null
    assert.ok(held, 'son anlık görüntü tutuldu')
    assert.equal(W.players['2'].state().ended, true)
    assert.notEqual(W.players['2'].frame().phase, 'over')
    W.players['2'].onData('p1', '1', N.encodeSnap(held))
    assert.equal(W.players['2'].frame().phase, 'over')
    // Eski ya da aynı adımdaki anlık görüntü kareyi geri almaz
    W.players['2'].onData('p1', '1', N.encodeSnap(Object.assign({}, held, { tick: held.tick - 5, phase: 'play' })))
    assert.equal(W.players['2'].frame().phase, 'over')
    const inputs = W.playerSent['2'].filter((x) => x.msg.type === 'input').length
    W.clock.step(500)
    assert.equal(W.playerSent['2'].filter((x) => x.msg.type === 'input').length, inputs)
    // Bağ koparsa son kare de kalkar
    W.linkDown('2', 'link-close')
    assert.equal(W.players['2'].frame(), null)
    assert.equal(W.players['2'].state().ended, false)
    noErrors(W)
  })

  test('maç sürerken ayrılanın yuvası maçtan çıkar: disk dünyadan ve anlık görüntülerden kalkar, girdisi işlenmez', () => {
    const W = makeWorld({ players: ['2', '3'] })
    W.clock.run(200)
    W.start(EPOCH_A, [{ id: '1', slot: 0, side: 'red' }, { id: '2', slot: 1, side: 'blue' }, { id: '3', slot: 2, side: 'red' }])
    W.clock.run(1000)
    same(W.host.frame().players.map((p) => p.slot), [0, 1, 2])
    assert.equal(W.host.dropPlayer('9'), false, 'maçta olmayan kişi')
    assert.equal(W.host.dropPlayer('3'), true)
    assert.equal(W.host.dropPlayer('3'), false)
    same(W.host.frame().players.map((p) => p.slot), [0, 1])
    // Başlama vuruşu beklenirken Kırmızı'da kalan tek kişi tek kişilik dizilişe geçer
    same([W.slotOf(0).x, W.slotOf(0).y], [-180, 0])
    // Ayrılanın el sıkışması yuvasız yinelenir, girdisi işlenmez, oyuncuların karesinde iki disk kalır
    const hello = W.hellos('3').pop()
    W.clock.step(500)
    assert.equal(W.hellos('3').pop().slot, null)
    assert.equal(hello.slot, 2)
    W.toHost('3', input(500, -1, 0, true))
    W.clock.step(500)
    same(W.players['2'].frame().players.map((p) => p.slot), [0, 1])
    same(W.snaps('2').pop().msg.players.map((p) => p.slot), [0, 1])
    // Maç aynı kimlikle sürer, startMatch aynı kimlikle yeniden verilse de disk geri gelmez
    assert.equal(W.host.info().epoch, EPOCH_A)
    assert.equal(W.host.startMatch({ epoch: EPOCH_A, rules: 'quick', kick: 'red', players: [{ id: '1', slot: 0, side: 'red' }, { id: '2', slot: 1, side: 'blue' }, { id: '3', slot: 2, side: 'red' }] }), true)
    same(W.host.frame().players.map((p) => p.slot), [0, 1])
    // Ev sahibinin kendi yuvası da kalkabilir: girdisi yok sayılır, karede me null
    assert.equal(W.host.dropPlayer('1'), true)
    assert.equal(W.host.frame().me, null)
    W.host.setInput({ x: 1, y: 0, kick: false })
    W.clock.step(200)
    same(W.host.frame().players.map((p) => p.slot), [1])
    assert.equal(W.host.endMatch(), true)
    assert.equal(W.host.dropPlayer('2'), false, 'maç yokken')
    noErrors(W)
  })
})

describe('duraklama', () => {
  test('kısılan sekmede maç duraklar, oyuncular görür, saat ve konumlar durur, döngü düzelince sürer', () => {
    const W = makeWorld({ players: ['2'], latency: 20 })
    W.clock.run(200)
    W.start()
    W.clock.run(500)
    // Ev sahibi topa dokunur: oyun başlar, maç saati işler
    W.host.setInput({ x: 1, y: 0, kick: false })
    W.clock.run(4000)
    assert.ok(W.hostEvents.some((e) => e.e === 'play'))
    const r0 = W.host.frame().remaining
    assert.ok(r0 < 1800)
    W.lag = 1000
    W.clock.step(1100)
    const paused = W.hostEvents.filter((e) => e.e === 'paused')
    assert.equal(paused.length, 1)
    const f1 = W.host.frame()
    assert.equal(f1.phase, 'paused')
    assert.equal(f1.paused, true)
    const tick1 = W.host.info().tick
    W.clock.step(3000)
    const f2 = W.host.frame()
    same(f2.ball, f1.ball, 'konumlar durdu')
    same(f2.players, f1.players)
    assert.equal(f2.remaining, f1.remaining, 'maç saati durdu')
    assert.ok(W.host.info().tick - tick1 >= 170, 'tick gerçek zamanla ilerler')
    // Kısılmış döngünün her turunda oyuncuya duraklama anlık görüntüsü gider
    const during = W.snaps('2').filter((x) => x.t > paused[0].t)
    assert.ok(during.length >= 3 && during.every((x) => x.msg.phase === 'paused'))
    W.clock.step(100)
    const pf = W.players['2'].frame()
    assert.equal(pf.phase, 'paused')
    assert.equal(pf.paused, true)
    // Döngü düzelir: bekleyen kısılmış tur gelir (son uzun ara), ardından 500 ms düzenli işleyince maç sürer
    W.lag = 0
    const n0 = W.sentTo('2', 'snap').length
    while (W.sentTo('2', 'snap').length === n0) W.clock.step(1)
    const tr = W.sentTo('2', 'snap').pop().t
    W.clock.run(tr + 480)
    assert.equal(W.hostEvents.filter((e) => e.e === 'resumed').length, 0, 'henüz sürmedi')
    assert.equal(W.host.frame().phase, 'paused')
    W.clock.run(tr + 600)
    const resumed = W.hostEvents.filter((e) => e.e === 'resumed')
    assert.equal(resumed.length, 1)
    assert.ok(resumed[0].t - tr >= 500 && resumed[0].t - tr <= 520, 'sürme ' + (resumed[0].t - tr))
    assert.equal(W.host.frame().phase, 'play')
    W.clock.step(1000)
    assert.ok(W.host.frame().remaining < f1.remaining, 'saat yeniden işler')
    W.clock.step(200)
    assert.equal(W.players['2'].frame().paused, false)
    noErrors(W)
  })

  test('250 ms altındaki gecikme duraklatmaz, aradaki adımlar yetişir', () => {
    const W = makeWorld({ players: ['2'] })
    W.clock.run(200)
    W.start()
    W.clock.run(1000)
    W.lag = 183
    const t0 = W.host.info().tick
    const c0 = W.clock.t
    W.clock.step(2000)
    assert.equal(W.hostEvents.filter((e) => e.e === 'paused').length, 0)
    const ticks = W.host.info().tick - t0
    const expect = (W.clock.t - c0) / TICK_MS
    assert.ok(Math.abs(ticks - expect) <= 16, 'adımlar yetişti: ' + ticks + ' / ' + expect)
    W.lag = 240
    W.clock.step(1000)
    assert.equal(W.hostEvents.filter((e) => e.e === 'paused').length, 1, '250 ms aşılınca duraklar')
    noErrors(W)
  })

  test('bitmiş maç duraklamaz, dinleyici maçı bitirirse döngü bozulmaz, destroy zamanlayıcıları bırakır', () => {
    const A = makeWorld({ players: [] })
    A.start(EPOCH_A, [{ id: '1', slot: 0, side: 'red' }])
    let ended = 0
    A.hostEvents.push = function (e) {
      Array.prototype.push.call(this, e)
      if (e.e === 'goal') {
        ended++
        A.host.endMatch()
      }
      return this.length
    }
    A.clock.run(100)
    A.host.setInput({ x: 1, y: 0, kick: false })
    A.clock.run(8000)
    assert.equal(ended, 1)
    assert.equal(A.host.frame(), null)
    noErrors(A)
    A.host.destroy()
    A.host.destroy()
    A.clock.run(20000)
    assert.equal(A.clock.q.length, 0, 'bekleyen zamanlayıcı yok')
    A.host.onData('p2', '2', input(1, 0, 0))
    assert.equal(A.host.startMatch({ epoch: EPOCH_B, rules: 'quick', kick: 'red', players: [{ id: '1', slot: 0, side: 'red' }] }), false)
    noErrors(A)
  })
})
