'use strict'

// Oyun protokolü çekirdeği (public/js/33-oyun-protokol.js, window.TelsizGame) testleri. Her cihaz kendi Node vm
// bağlamıdır ve tarayıcıdaki gibi gerçek TweetNaCl, public/crypto.js ve protokol dosyasını yükler. Kimlik
// anahtarları E2EE.identity.generate() ile üretilir. İç zarfın gidiş dönüşü, gizlilik, yansıtma, bağ alanları,
// özel mesajla karışmama, sayaç kuralları, düz ileti doğrulayıcıları, state gövdesi, rastgelelik ve boyut sınanır.
// Ayrıca index.html ve sw.js bağlantıları ile voice.js oyun sinyalinin sınırı ve metin deseniyle uyum denetlenir.

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const nodeCrypto = require('node:crypto')

const ROOT = path.join(__dirname, '..')
const NACL_SRC = fs.readFileSync(path.join(ROOT, 'public', 'vendor', 'nacl-fast.min.js'), 'utf8')
const E2EE_SRC = fs.readFileSync(path.join(ROOT, 'public', 'crypto.js'), 'utf8')
const GAME_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', '33-oyun-protokol.js'), 'utf8')

// Bir "cihaz": kendi vm bağlamı ve yüklü betikler
function loadDevice (opts) {
  const o = opts || {}
  const sandbox = vm.createContext({})
  sandbox.self = sandbox
  sandbox.window = sandbox
  sandbox.crypto = nodeCrypto.webcrypto
  sandbox.console = { log () {}, warn () {}, error () {} }
  if (o.crypto !== false) {
    vm.runInContext(NACL_SRC, sandbox, { filename: 'nacl-fast.min.js' })
    vm.runInContext(E2EE_SRC, sandbox, { filename: 'crypto.js' })
  }
  vm.runInContext(GAME_SRC, sandbox, { filename: '33-oyun-protokol.js' })
  return sandbox
}

// vm bağlamındaki nesnelerin ön örnekleri farklıdır, karşılaştırma JSON kopyasıyla yapılır
function same (actual, expected, message) {
  const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))
  assert.deepEqual(plain(actual), plain(expected), message)
}

function copy (x) {
  return JSON.parse(JSON.stringify(x))
}

// Kişi: kendi cihazı ve kimlik anahtarı. uid kadrodaki userId'dir (dize).
function person (uid) {
  const dev = loadDevice()
  const pair = dev.E2EE.identity.generate()
  return { uid, G: dev.TelsizGame, dm: dev.E2EE.dm, pk: pair.publicKey, sk: pair.secretKey }
}

const K = person('5')
const B = person('12')
const C = person('7')
const G = K.G

const CH = '3'
const GID = '00ff00ff00ff00ff'
const NI = '0123456789abcdef'

// a kişisinin b kişisine mühürlediği zarf
function seal (a, b, obj) {
  return a.G.sealInner(a.dm, obj, b.pk, a.sk)
}

// b kişisinin cihazında a kişisinden gelen zarfın açılması
function openAt (b, a, p) {
  return b.G.openInner(b.dm, p, a.pk, b.sk)
}

function expectFor (from, to, g) {
  const e = { ch: CH, from: from.uid, to: to.uid }
  if (g !== undefined) e.g = g
  return e
}

function inner (k, from, to, extra) {
  return Object.assign({ v: 1, ctx: 'game', k, g: GID, ch: CH, from: from.uid, to: to.uid }, extra)
}

function lobbyBody (extra) {
  return Object.assign({
    ph: 'lobby',
    app: 'renk',
    rules: 'official',
    seats: ['5', '12'],
    rd: 0,
    ack: { seq: 0, ok: true },
    view: null,
    mine: null,
    ev: [],
    away: []
  }, extra)
}

function playBody (extra) {
  return Object.assign({
    ph: 'play',
    app: 'renk',
    rules: 'stack',
    seats: ['5', '12', '7'],
    rd: 1,
    ack: { seq: 2, ok: false, code: 'not_your_turn' },
    view: { v: 1, top: 'R1', color: 'R' },
    mine: { cards: ['R5', 'WW'], drawn: null },
    ev: [{ r: 3, e: 'play', p: '5', c: 'R1', col: 'R' }, { r: 4, e: 'draw', p: '12', n: 1 }],
    away: ['7']
  }, extra)
}

const BODY_CTX = { dealer: '5', me: '12', r: 5 }

// Örnek iç iletiler: [ad, gönderen, alıcı, nesne]
function samples () {
  return [
    ['join', B, K, inner('join', B, K, { app: 'renk', ni: NI })],
    ['act', B, K, inner('act', B, K, { seq: 4, rd: 1, b: { t: 'play', c: 'R5', step: 7 } })],
    ['sync', B, K, inner('sync', B, K, { seq: 5 })],
    ['leave', B, K, inner('leave', B, K, { seq: 6 })],
    ['state', K, B, inner('state', K, B, { r: 5, ni: NI, b: playBody() })]
  ]
}

// Her zaman aynı bayt dizisini döngüyle veren kaynak (düz Array)
function fixed (bytes) {
  let i = 0
  return (n) => {
    const out = []
    while (out.length < n) {
      out.push(bytes[i % bytes.length])
      i++
    }
    return out
  }
}

// xorshift32 ile belirlenimci kaynak (düz Array)
function seeded (seed) {
  let x = (seed >>> 0) || 1
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

function throwsCode (fn, code) {
  assert.throws(fn, (err) => err && err.code === code)
}

describe('iç zarf (gerçek nacl ve crypto.js)', () => {
  test('sealInner ve openInner gidiş dönüşü, checkInner bütün türleri kabul eder', () => {
    for (const [k, from, to, obj] of samples()) {
      const p = seal(from, to, obj)
      assert.equal(typeof p, 'string', k)
      assert.match(p, /^2\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{24,}$/, k)
      assert.ok(p.length <= G.MAX_P, k)
      const x = openAt(to, from, p)
      same(x, obj, k)
      assert.ok(to.G.checkInner(x, expectFor(from, to)), k)
      assert.ok(to.G.checkInner(x, expectFor(from, to, GID)), k)
    }
  })

  test('C, B için mühürlenmiş durumu açamaz', () => {
    const obj = inner('state', K, B, { r: 5, ni: NI, b: playBody() })
    const p = seal(K, B, obj)
    assert.equal(openAt(C, K, p), null)
    assert.equal(openAt(C, B, p), null)
    // Alıcı da yanlış gönderen anahtarıyla açamaz
    assert.equal(openAt(B, C, p), null)
    assert.ok(openAt(B, K, p))
  })

  test('yansıtma: kurpiyerin zarfı kendisinde açılır ama gönderen bağı reddeder', () => {
    const obj = inner('state', K, B, { r: 5, ni: NI, b: playBody() })
    const p = seal(K, B, obj)
    // Ortak anahtar iki yönde aynıdır, kurpiyer B'nin açık anahtarıyla kendi zarfını açabilir
    const x = openAt(K, B, p)
    same(x, obj)
    assert.equal(K.G.checkInner(x, expectFor(B, K)), null)
    // Oyuncunun act zarfı oyuncuya geri yollanırsa da reddedilir
    const act = inner('act', B, K, { seq: 1, rd: 1, b: { t: 'draw', step: 0 } })
    const q = seal(B, K, act)
    const y = openAt(B, K, q)
    same(y, act)
    assert.equal(B.G.checkInner(y, expectFor(K, B)), null)
  })

  test('bağ alanları: farklı masa, oda, gönderen veya alıcı reddedilir', () => {
    const base = inner('act', B, K, { seq: 3, rd: 2, b: { t: 'draw', step: 1 } })
    const check = (obj, expect) => K.G.checkInner(openAt(K, B, seal(B, K, obj)), expect || expectFor(B, K, GID))
    assert.ok(check(base))
    assert.equal(check(base, expectFor(B, K, 'ffffffffffffffff')), null)
    assert.equal(check(Object.assign({}, base, { g: 'ffffffffffffffff' })), null)
    assert.equal(check(Object.assign({}, base, { g: '00FF00FF00FF00FF' }), expectFor(B, K)), null)
    assert.equal(check(Object.assign({}, base, { g: 'abc' }), expectFor(B, K)), null)
    assert.equal(check(Object.assign({}, base, { ch: '4' })), null)
    assert.equal(check(Object.assign({}, base, { ch: 3 })), null)
    assert.equal(check(Object.assign({}, base, { from: '7' })), null)
    assert.equal(check(Object.assign({}, base, { from: 12 })), null)
    assert.equal(check(Object.assign({}, base, { to: '7' })), null)
    assert.equal(check(base, { ch: CH, from: '7', to: '5' }), null)
  })

  test('fazla alan, eksik alan, yanlış ctx ve sürüm reddedilir', () => {
    const base = inner('act', B, K, { seq: 3, rd: 2, b: { t: 'draw', step: 1 } })
    const openK = (obj) => openAt(K, B, seal(B, K, obj))
    const check = (obj) => K.G.checkInner(openK(obj), expectFor(B, K))
    assert.equal(check(Object.assign({}, base, { x: 1 })), null)
    assert.equal(check(Object.assign({}, base, { a: '12' })), null)
    for (const key of Object.keys(base)) {
      const missing = Object.assign({}, base)
      delete missing[key]
      assert.equal(check(missing), null, key)
    }
    assert.equal(openK(Object.assign({}, base, { ctx: 'dm' })), null)
    assert.equal(openK(Object.assign({}, base, { ctx: undefined })), null)
    assert.equal(openK(Object.assign({}, base, { v: 2 })), null)
    assert.equal(openK(Object.assign({}, base, { k: 5 })), null)
    // Bilinmeyen ve prototip adlı türler hata fırlatmadan reddedilir
    for (const k of ['move', 'invite', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      assert.equal(K.G.checkInner(Object.assign({}, base, { k }), expectFor(B, K)), null, k)
    }
    assert.equal(K.G.checkInner(null, expectFor(B, K)), null)
    assert.equal(K.G.checkInner(base, null), null)
    // Türün alan kümesi: act alanları sync içinde fazladır
    assert.equal(check(Object.assign({}, base, { k: 'sync' })), null)
  })

  test('alan değerleri denetlenir', () => {
    const check = (obj, from, to) => to.G.checkInner(openAt(to, from, seal(from, to, obj)), expectFor(from, to))
    const act = (extra) => inner('act', B, K, Object.assign({ seq: 3, rd: 2, b: { t: 'draw', step: 1 } }, extra))
    for (const seq of [0, -1, 1.5, '3', null, 1e9 + 1]) assert.equal(check(act({ seq }), B, K), null, String(seq))
    assert.ok(check(act({ seq: 1e9 }), B, K))
    for (const rd of [-1, 1000001, '2', null]) assert.equal(check(act({ rd }), B, K), null, String(rd))
    assert.ok(check(act({ rd: 0 }), B, K))
    for (const b of [null, [], 'x', 5]) assert.equal(check(act({ b }), B, K), null, JSON.stringify(b))
    const state = (extra) => inner('state', K, B, Object.assign({ r: 5, ni: NI, b: playBody() }, extra))
    assert.ok(check(state({}), K, B))
    for (const r of [0, -1, 2.5, '5']) assert.equal(check(state({ r }), K, B), null, String(r))
    for (const ni of ['0123456789ABCDEF', '0123', 7, null]) assert.equal(check(state({ ni }), K, B), null, String(ni))
    const join = (extra) => inner('join', B, K, Object.assign({ app: 'renk', ni: NI }, extra))
    assert.ok(check(join({}), B, K))
    for (const app of ['Renk', 'renk1', '', 'a'.repeat(17), null]) assert.equal(check(join({ app }), B, K), null, String(app))
    // Kimlik biçimi: yalnızca sıfırla başlamayan en çok 16 haneli dize
    const bad = inner('sync', B, K, { seq: 1, from: '012' })
    assert.equal(K.G.checkInner(bad, { ch: CH, from: '012', to: K.uid }), null)
  })

  test('openInner ve sealInner hata durumlarında null döner', () => {
    const obj = inner('sync', B, K, { seq: 1 })
    const p = seal(B, K, obj)
    assert.equal(G.openInner(K.dm, 5, B.pk, K.sk), null)
    assert.equal(G.openInner(K.dm, '{"v":1}', B.pk, K.sk), null)
    assert.equal(G.openInner(K.dm, '2.abc', B.pk, K.sk), null)
    assert.equal(G.openInner(K.dm, p + 'A'.repeat(G.MAX_P), B.pk, K.sk), null)
    assert.equal(K.G.openInner(K.dm, p, 'bozuk', K.sk), null)
    assert.equal(K.G.openInner(K.dm, p, B.pk, null), null)
    const throwing = { seal () { throw new Error('x') }, open () { throw new Error('x') } }
    assert.equal(G.openInner(throwing, p, B.pk, K.sk), null)
    assert.equal(G.sealInner(throwing, obj, K.pk, B.sk), null)
    const odd = { seal: () => 5, open: () => ({ ok: true, value: [1] }) }
    assert.equal(G.sealInner(odd, obj, K.pk, B.sk), null)
    assert.equal(G.openInner(odd, p, B.pk, K.sk), null)
    // Mühürlenemeyen anahtar ve sınırı aşan zarf
    assert.equal(B.G.sealInner(B.dm, obj, 'bozuk', B.sk), null)
    const big = inner('act', B, K, { seq: 1, rd: 1, b: { pad: 'x'.repeat(G.MAX_P) } })
    assert.equal(seal(B, K, big), null)
  })
})

describe('özel mesajla karışmama', () => {
  // 15-dm.js özel mesaj kabulünün çekirdeği: v.v === 1, sameId(v.a, yazar), sameId(v.c, oda)
  function dmAccepts (v, authorId, channelId) {
    const sameId = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b)
    return Boolean(v && typeof v === 'object' && v.v === 1 && sameId(v.a, authorId) && sameId(v.c, channelId))
  }

  test('özel mesaj düz metni oyun iletisi olarak açılmaz', () => {
    const text = { v: 1, a: '5', c: '9', t: 'x' }
    const p = K.dm.seal(text, B.pk, K.sk)
    assert.equal(openAt(B, K, p), null)
    // ctx eklense bile tür ve alan kümesi tutmaz
    const withCtx = K.dm.seal({ v: 1, ctx: 'game', a: '5', c: '9', t: 'x' }, B.pk, K.sk)
    assert.equal(openAt(B, K, withCtx), null)
    const mixed = inner('sync', K, B, { seq: 1, a: '5', c: '9' })
    assert.equal(B.G.checkInner(openAt(B, K, seal(K, B, mixed)), expectFor(K, B)), null)
  })

  test('oyun düz metninde a ve c alanı yoktur, özel mesaj denetiminden geçmez', () => {
    for (const k of Object.keys(G.INNER_KEYS)) {
      assert.equal(G.INNER_KEYS[k].indexOf('a'), -1, k)
      assert.equal(G.INNER_KEYS[k].indexOf('c'), -1, k)
    }
    for (const [k, from, to, obj] of samples()) {
      const res = to.dm.open(seal(from, to, obj), [from.pk], to.sk)
      assert.equal(res.ok, true, k)
      assert.equal(Object.prototype.hasOwnProperty.call(res.value, 'a'), false, k)
      assert.equal(Object.prototype.hasOwnProperty.call(res.value, 'c'), false, k)
      assert.equal(dmAccepts(res.value, from.uid, CH), false, k)
    }
  })
})

describe('sürümler ve sayaçlar', () => {
  test('seqOrder tablosu', () => {
    const rows = [[0, 1, 'new'], [3, 5, 'new'], [3, 4, 'new'], [3, 3, 'repeat'], [0, 0, 'repeat'], [3, 2, 'old'], [9, 1, 'old']]
    for (const [last, seq, want] of rows) assert.equal(G.seqOrder(last, seq), want, last + ' ' + seq)
  })

  test('acceptState tablosu', () => {
    const rows = [
      [5, 2, 6, 0, true],
      [5, 2, 9, 9, true],
      [5, 2, 5, 3, true],
      [5, 2, 5, 2, false],
      [5, 2, 5, 1, false],
      [5, 2, 4, 9, false],
      [0, 0, 1, 0, true]
    ]
    for (const [lastR, lastAck, r, ack, want] of rows) {
      assert.equal(G.acceptState(lastR, lastAck, r, ack), want, [lastR, lastAck, r, ack].join(' '))
    }
  })
})

describe('düz iletiler', () => {
  const plain = (k, extra) => Object.assign({ v: 1, ctx: 'game', k, g: GID, ch: CH }, extra)
  const invite = (extra) => plain('invite', Object.assign({
    app: 'renk', dealer: '5', ph: 'lobby', rules: 'official', seats: ['5', '12'], max: 8, ni: NI, key: null
  }, extra))
  const valid = (x) => G.validPlain(copy(x)) !== null

  test('invite kabul ve red durumları', () => {
    assert.ok(valid(invite()))
    for (const ph of ['lobby', 'play', 'over']) assert.ok(valid(invite({ ph })), ph)
    for (const key of ['unverified', 'changed', 'gone', 'loading']) assert.ok(valid(invite({ key })), key)
    assert.ok(valid(invite({ seats: ['5'] })))
    assert.ok(valid(invite({ max: 2, seats: ['5', '12'] })))
    assert.ok(valid(invite({ seats: ['5', '12', '7', '8', '9', '10', '11', '1234567890123456'] })))
    const bad = [
      { seats: ['12', '5'] },
      { seats: ['12'] },
      { max: 9 },
      { max: 1, seats: ['5'] },
      { max: 2, seats: ['5', '12', '7'] },
      { max: 8.5 },
      { seats: [] },
      { seats: ['5', '5'] },
      { seats: ['5', 12] },
      { seats: '5' },
      { dealer: 5, seats: [5] },
      { dealer: '05', seats: ['05'] },
      { key: 'blocked' },
      { key: 'locked' },
      { key: '' },
      { ph: 'dealing' },
      { ni: 'xyz' },
      { app: 'Renk' },
      { rules: 'Official' },
      { rules: '' },
      { g: GID.toUpperCase() },
      { ch: 'a b' },
      { ch: 'c'.repeat(65) },
      { ch: 3 },
      { v: 2 },
      { ctx: 'dm' },
      { extra: true }
    ]
    for (const extra of bad) assert.equal(valid(invite(extra)), false, JSON.stringify(extra))
    for (const key of Object.keys(invite())) {
      const missing = invite()
      delete missing[key]
      assert.equal(valid(missing), false, key)
    }
  })

  test('checkPlain oda ve kurpiyer bağını denetler', () => {
    const x = G.validPlain(copy(invite()))
    assert.ok(G.checkPlain(x, { ch: CH, from: '5' }))
    assert.equal(G.checkPlain(x, { ch: '4', from: '5' }), null)
    assert.equal(G.checkPlain(x, { ch: CH, from: '12' }), null)
    const r = G.validPlain(copy(plain('reject', { why: 'full' })))
    assert.ok(G.checkPlain(r, { ch: CH, from: '5' }))
    assert.equal(G.checkPlain(r, { ch: '4', from: '5' }), null)
    assert.equal(G.checkPlain(null, { ch: CH }), null)
  })

  test('decline kabul ve red durumları', () => {
    const decline = (extra) => plain('decline', Object.assign({ ni: NI, why: 'user', key: null }, extra))
    assert.ok(valid(decline()))
    for (const key of ['locked', 'unverified', 'changed', 'loading', 'gone']) {
      assert.ok(valid(decline({ why: 'keys', key })), key)
    }
    const bad = [
      { why: 'keys', key: null },
      { why: 'keys', key: 'blocked' },
      { why: 'user', key: 'loading' },
      { why: 'busy' },
      { ni: 'abc' },
      { seq: 1 }
    ]
    for (const extra of bad) assert.equal(valid(decline(extra)), false, JSON.stringify(extra))
  })

  test('reject ve close kabul ve red durumları', () => {
    for (const why of ['full', 'started', 'closed', 'keys']) assert.ok(valid(plain('reject', { why })), why)
    for (const why of ['dealer', 'superseded', 'gone']) assert.ok(valid(plain('close', { why })), why)
    assert.equal(valid(plain('reject', { why: 'gone' })), false)
    assert.equal(valid(plain('close', { why: 'full' })), false)
    assert.equal(valid(plain('close', { why: 'dealer', ni: NI })), false)
    assert.equal(valid(plain('close', {})), false)
    for (const k of ['state', 'join', 'act', 'constructor', '__proto__', 'toString']) {
      assert.equal(valid(plain(k, { why: 'full' })), false, k)
    }
    assert.equal(G.validPlain(null), null)
    assert.equal(G.validPlain([]), null)
  })

  test('parsePlain biçimi ve bağı denetler', () => {
    const text = JSON.stringify(invite())
    same(G.parsePlain(text), invite())
    same(G.parsePlain(text, { ch: CH, from: '5' }), invite())
    assert.equal(G.parsePlain(text, { ch: CH, from: '7' }), null)
    assert.equal(G.parsePlain(text, null), null)
    assert.equal(G.parsePlain(' ' + text), null)
    assert.equal(G.parsePlain('2.' + text), null)
    assert.equal(G.parsePlain('{"v":1'), null)
    assert.equal(G.parsePlain('[1]'), null)
    assert.equal(G.parsePlain(JSON.stringify(invite({ rules: 'resmî' }))), null)
    assert.equal(G.parsePlain(text.slice(0, -1) + ',"pad":"' + 'x'.repeat(G.MAX_P) + '"}'), null)
    assert.equal(G.parsePlain('{"__proto__":{"k":"close"},"v":1}'), null)
    assert.equal(G.parsePlain(5), null)
  })

  test('encodePlain yalnızca yazdırılabilir ASCII ve sınır içi çıktı verir', () => {
    const x = invite()
    assert.equal(G.encodePlain(x), JSON.stringify(x))
    assert.equal(G.encodePlain(invite({ rules: 'şans' })), null)
    assert.equal(G.encodePlain({ t: 'café' }), null)
    // JSON kaçışı ASCII'dir
    assert.equal(G.encodePlain({ t: 'a\nb' }), '{"t":"a\\nb"}')
    const pad = (n) => ({ p: 'x'.repeat(n - 8) })
    assert.equal(G.encodePlain(pad(G.MAX_P)).length, G.MAX_P)
    assert.equal(G.encodePlain(pad(G.MAX_P + 1)), null)
    const loop = {}
    loop.self = loop
    assert.equal(G.encodePlain(loop), null)
    assert.equal(G.encodePlain('x'), null)
    assert.equal(G.encodePlain([1]), null)
    assert.equal(G.encodePlain(null), null)
  })
})

describe('state gövdesi', () => {
  const ok = (b, ctx) => G.validStateBody(copy(b), ctx || BODY_CTX) !== null

  test('geçerli gövdeler kabul edilir', () => {
    assert.ok(ok(lobbyBody()))
    assert.ok(ok(playBody()))
    assert.ok(ok(playBody({ ph: 'over', ack: { seq: 0, ok: true }, ev: [], away: [] })))
    assert.ok(ok(lobbyBody({ rd: 3 })))
    assert.ok(ok(playBody({ ev: [{ r: 5, e: 'end' }] })))
    assert.ok(ok(playBody({ ack: { seq: 3, ok: false, code: 'wild4_has_color' } })))
    assert.ok(ok(playBody(), { dealer: '5', me: '12', r: 5, app: 'renk', rules: ['official', 'stack'] }))
    const b = playBody()
    assert.equal(G.validStateBody(b, BODY_CTX), b)
  })

  test('aşama ile görünüm uyuşmazsa reddedilir', () => {
    assert.equal(ok(lobbyBody({ view: { v: 1 } })), false)
    assert.equal(ok(lobbyBody({ mine: { cards: [] } })), false)
    assert.equal(ok(playBody({ view: null, mine: null })), false)
    assert.equal(ok(playBody({ view: [] })), false)
    assert.equal(ok(playBody({ mine: 'R5' })), false)
    assert.equal(ok(playBody({ rd: 0 })), false)
    assert.equal(ok(playBody({ ph: 'dealing' })), false)
  })

  test('olaylar, alanlar ve kimlikler denetlenir', () => {
    const bad = [
      playBody({ ev: [{ r: 6, e: 'play' }] }),
      playBody({ ev: [{ r: 0, e: 'play' }] }),
      playBody({ ev: [{ r: 4, e: 'play' }, { r: 3, e: 'draw' }] }),
      playBody({ ev: [{ r: 4 }] }),
      playBody({ ev: [{ r: 4, e: 'Play' }] }),
      playBody({ ev: [[4, 'play']] }),
      playBody({ ev: new Array(9).fill({ r: 1, e: 'draw' }) }),
      playBody({ away: ['9'] }),
      playBody({ away: ['7', '7'] }),
      playBody({ seats: ['12', '5'] }),
      playBody({ seats: ['5', '12', '12'] }),
      playBody({ seats: ['5', '12', '1', '2', '3', '4', '6', '7', '8'] }),
      playBody({ ack: { seq: 1, ok: true, code: 'stale' } }),
      playBody({ ack: { seq: 1, ok: false } }),
      playBody({ ack: { seq: 1, ok: false, code: 'Stale' } }),
      playBody({ ack: { seq: -1, ok: true } }),
      playBody({ ack: { seq: 1, ok: 1 } }),
      playBody({ app: 'Renk' }),
      playBody({ rules: 7 }),
      playBody({ rd: 1000001 }),
      playBody({ extra: 1 })
    ]
    for (const b of bad) assert.equal(ok(b), false, JSON.stringify(b))
    const noAway = playBody()
    delete noAway.away
    assert.equal(ok(noAway), false)
    assert.equal(ok(playBody(), { dealer: '5', me: '12', r: 5, app: 'other' }), false)
    assert.equal(ok(playBody(), { dealer: '5', me: '12', r: 5, rules: ['official'] }), false)
    assert.equal(ok(playBody(), { dealer: '5', me: '12' }), false)
    assert.equal(ok(playBody(), { dealer: '12', me: '12', r: 5 }), false)
    assert.equal(G.validStateBody(null, BODY_CTX), null)
    assert.equal(G.validStateBody(playBody(), null), null)
  })

  test('koltukta olmayan kişi için gövde durum değil, çıkarıldım bilgisidir', () => {
    const removed = playBody({ seats: ['5', '7'], mine: null, away: [] })
    assert.equal(G.validStateBody(copy(removed), BODY_CTX), null)
    assert.equal(G.isRemovalBody(copy(removed), BODY_CTX), true)
    assert.equal(G.isRemovalBody(copy(lobbyBody({ seats: ['5'] })), BODY_CTX), true)
    assert.equal(G.isRemovalBody(copy(playBody()), BODY_CTX), false)
    assert.equal(G.isRemovalBody(copy(playBody({ seats: ['5', '7'], away: [] })), BODY_CTX), false)
    assert.equal(G.isRemovalBody(copy(removed), { dealer: '5', me: '12', r: 1 }), false)
  })
})

describe('rastgelelik', () => {
  test('reddetmeli örnekleme bilinen değerleri verir', () => {
    assert.equal(G.randomBelow(G.byteSource(fixed([255, 4])), 3), 1)
    assert.equal(G.randomBelow(G.byteSource(fixed([216, 215])), 108), 107)
    // 256'dan büyük aralıkta iki bayt büyük uçlu okunur
    assert.equal(G.randomBelow(G.byteSource(fixed([1, 2])), 300), 258)
    assert.equal(G.randomBelow(G.byteSource(fixed([255, 255, 0, 7])), 65535), 7)
    assert.equal(G.randomBelow(G.byteSource(fixed([9])), 1), 0)
  })

  test('bozuk kaynak bad_random, hata fırlatan kaynak no_random verir', () => {
    throwsCode(() => G.randomBelow(G.byteSource(fixed([255])), 3), 'bad_random')
    throwsCode(() => G.randomBelow(G.byteSource(fixed([255])), 108), 'bad_random')
    throwsCode(() => G.byteSource(() => { throw new Error('x') })(), 'no_random')
    throwsCode(() => G.byteSource(null)(), 'no_random')
    throwsCode(() => G.byteSource(() => [1, 2])(), 'bad_random')
    throwsCode(() => G.byteSource(() => null)(), 'bad_random')
    throwsCode(() => G.byteSource(() => 'x'.repeat(64))(), 'bad_random')
    for (const v of [256, -1, 1.5, '7', null]) {
      throwsCode(() => G.byteSource((n) => new Array(n).fill(v))(), 'bad_random')
    }
    for (const m of [0, 65537, 1.5, '3', NaN]) {
      throwsCode(() => G.randomBelow(G.byteSource(fixed([1])), m), 'bad_random')
    }
    throwsCode(() => G.shuffle([1, 2, 3], () => { throw new Error('x') }), 'no_random')
    throwsCode(() => G.randomHex16(() => { throw new Error('x') }), 'no_random')
    throwsCode(() => G.randomHex16(() => [1, 2, 3]), 'bad_random')
  })

  test('Node Uint8Array ve gerçek nacl kaynağı kabul edilir', () => {
    const v = G.randomBelow(G.byteSource((n) => new Uint8Array(n).fill(7)), 5)
    assert.equal(v, 2)
    assert.equal(typeof G.randomBelow(G.byteSource((n) => nodeCrypto.randomBytes(n)), 108), 'number')
    const dev = loadDevice()
    const deck = Array.from({ length: 108 }, (v, i) => i)
    const out = dev.TelsizGame.shuffle(deck, (n) => dev.nacl.randomBytes(n))
    same(out.slice().sort((a, b) => a - b), deck)
  })

  test('shuffle girdiyi değiştirmez ve aynı çoklu kümeyi verir', () => {
    const list = ['R1', 'R1', 'WW', 'B5', 'G0', 'YD', 'WF', 'WF']
    const before = list.slice()
    const out = G.shuffle(list, seeded(7))
    assert.deepEqual(list, before)
    assert.notEqual(out, list)
    same(out.slice().sort(), before.slice().sort())
    // Aynı kaynakla aynı sonuç
    same(G.shuffle(list, seeded(7)), out)
    same(G.shuffle([], seeded(1)), [])
    same(G.shuffle(['x'], seeded(1)), ['x'])
  })

  test('3 öğenin 6 permütasyonu tekdüze dağılır (ki-kare)', () => {
    const rng = seeded(42)
    const counts = {}
    const runs = 60000
    let left = runs
    while (left > 0) {
      const key = G.shuffle([0, 1, 2], rng).join('')
      counts[key] = (counts[key] || 0) + 1
      left--
    }
    assert.equal(Object.keys(counts).length, 6)
    const expected = runs / 6
    let chi = 0
    for (const key of Object.keys(counts)) chi += (counts[key] - expected) * (counts[key] - expected) / expected
    assert.ok(chi < 25, 'ki-kare ' + chi)
  })

  test('randomHex16 ve ring', () => {
    assert.equal(G.randomHex16(fixed([0, 15, 16, 255, 1, 2, 160, 10])), '000f10ff0102a00a')
    assert.match(G.randomHex16((n) => nodeCrypto.randomBytes(n)), /^[0-9a-f]{16}$/)
    assert.equal(G.ring(4, 3, 1, 1), 0)
    assert.equal(G.ring(4, 0, -1, 1), 3)
    assert.equal(G.ring(3, 1, -1, 5), 2)
    assert.equal(G.ring(5, 2, 1, 2), 4)
    assert.equal(G.ring(2, 1, 1, 2), 1)
  })
})

describe('boyut', () => {
  test('8 kişilik, en büyük el 60 kartlık durumun mühürlenmiş p değeri sınırın altında kalır', () => {
    const ids = ['1000000000000001', '1000000000000002', '1000000000000003', '1000000000000004',
      '1000000000000005', '1000000000000006', '1000000000000007', '1000000000000008']
    const cards = new Array(60).fill('WF')
    const hands = [60, 7, 7, 7, 7, 7, 6, 4]
    const view = {
      v: 1,
      rules: 'stack',
      seats: ids.map((id, i) => ({ id, n: hands[i] })),
      turn: ids[3],
      dir: -1,
      top: 'WF',
      color: 'B',
      deck: 0,
      discard: 3,
      phase: 'play',
      pending: { k: 'F', n: 100 },
      last: { p: ids[2], safe: false },
      step: 999999,
      result: { reason: 'out', winner: ids[0], total: 99999, ranks: ids.map((id, i) => ({ id, n: 108, points: 9999, rank: i + 1 })) }
    }
    const ev = ids.map((id, i) => ({ r: 999999990 + i, e: 'pending_dropped', p: id, by: ids[7 - i], n: 108, want: 108, why: 'stack', late: true }))
    assert.equal(ev.length, G.MAX_EVENTS)
    const b = {
      ph: 'play',
      app: 'renk',
      rules: 'stack',
      seats: ids,
      rd: 1000000,
      ack: { seq: 1000000000, ok: false, code: 'wild4_has_color' },
      view,
      mine: { cards, drawn: 'WF' },
      ev,
      away: ids.slice()
    }
    const dealer = { uid: ids[0], G: K.G, dm: K.dm, pk: K.pk, sk: K.sk }
    const player = { uid: ids[1], G: B.G, dm: B.dm, pk: B.pk, sk: B.sk }
    const ch = 'c'.repeat(64)
    const obj = { v: 1, ctx: 'game', k: 'state', g: GID, ch, from: dealer.uid, to: player.uid, r: 1000000000, ni: NI, b }
    const p = seal(dealer, player, obj)
    assert.equal(typeof p, 'string')
    assert.ok(p.length < G.MAX_P, 'p ' + p.length)
    assert.match(p, /^[ -~]+$/)
    const x = openAt(player, dealer, p)
    assert.ok(player.G.checkInner(x, { ch, from: dealer.uid, to: player.uid }))
    assert.ok(player.G.validStateBody(x.b, { dealer: dealer.uid, me: player.uid, r: x.r }))
  })
})

describe('modül', () => {
  test('saf yüklenir, saat, DOM ve sözlük kullanmaz', () => {
    const dev = loadDevice({ crypto: false })
    assert.equal(typeof dev.TelsizGame, 'object')
    assert.equal(dev.TelsizGame.VERSION, 1)
    const code = GAME_SRC.replace(/^\s*\/\/.*$/gm, '')
    for (const word of ['document', 'XMLHttpRequest', 'Math.random', 'Date', 'setTimeout', 'setInterval', 'localStorage', 'navigator']) {
      assert.equal(code.indexOf(word), -1, word)
    }
    assert.doesNotMatch(code, /(^|[^A-Za-z0-9_$.])t\(/)
  })

  test('dışa açılan nesne ve listeler dondurulmuştur', () => {
    assert.ok(Object.isFrozen(G))
    for (const key of ['PHASES', 'KEY_REASONS', 'INVITE_KEYS', 'DECLINE_KEYS', 'DECLINE_WHY', 'REJECT_WHY', 'CLOSE_WHY',
      'END_REASONS', 'STATUSES', 'DESK_ERRORS', 'BODY_KEYS']) {
      assert.ok(Object.isFrozen(G[key]), key)
    }
    for (const map of ['RECEIVES', 'PLAIN_KEYS', 'INNER_KEYS']) {
      assert.ok(Object.isFrozen(G[map]), map)
      for (const k of Object.keys(G[map])) assert.ok(Object.isFrozen(G[map][k]), map + '.' + k)
    }
  })

  test('sabitler ve rol tablosu tutarlıdır', () => {
    assert.equal(G.MAX_SEATS, 8)
    assert.equal(G.MAX_P, 11000)
    assert.equal(G.MAX_EVENTS, 8)
    assert.equal(G.CTX, 'game')
    const plainKinds = Object.keys(G.PLAIN_KEYS).sort()
    const innerKinds = Object.keys(G.INNER_KEYS).sort()
    same(plainKinds, ['close', 'decline', 'invite', 'reject'])
    same(innerKinds, ['act', 'join', 'leave', 'state', 'sync'])
    const all = G.RECEIVES.dealer.concat(G.RECEIVES.player).sort()
    same(all, plainKinds.concat(innerKinds).sort())
    for (const k of G.RECEIVES.dealer) assert.equal(G.RECEIVES.player.indexOf(k), -1, k)
    // Anahtar sorunu kodları dmSendState nedenlerinin alt kümesidir, 'blocked' karşı tarafa gönderilmez
    for (const k of G.INVITE_KEYS.concat(G.DECLINE_KEYS)) assert.ok(G.KEY_REASONS.indexOf(k) >= 0, k)
    assert.equal(G.INVITE_KEYS.indexOf('blocked'), -1)
    assert.equal(G.DECLINE_KEYS.indexOf('blocked'), -1)
    // Her kod i18n anahtarına dönüşebilecek biçimdedir
    const lists = ['PHASES', 'KEY_REASONS', 'INVITE_KEYS', 'DECLINE_KEYS', 'DECLINE_WHY', 'REJECT_WHY', 'CLOSE_WHY',
      'END_REASONS', 'STATUSES', 'DESK_ERRORS']
    for (const key of lists) {
      for (const code of G[key]) assert.match(code, /^[a-z][a-z0-9_]{0,31}$/, key + ' ' + code)
    }
  })
})

// Oyun modülleri index.html ve sw.js içinde 32-arama.js satırından sonra, numara sırasıyla bulunur. Bu denetim
// arayüz adımında test/oyun-arayuz.test.js dosyasına taşınır.
const GAME_MODULES = ['33-oyun-protokol.js', '34-oyun-masa.js', '35-renk-kural.js']

// voice.js'i saf doğrulayıcısı için yükler (ses motoru kurulmaz)
function loadVoiceUtils () {
  const noop = () => {}
  const win = { isSecureContext: true, addEventListener: noop, removeEventListener: noop, setTimeout, clearTimeout }
  win.window = win
  win.console = { log: noop, warn: noop, error: noop }
  win.navigator = { mediaDevices: { getUserMedia: () => Promise.reject(new Error('yok')) } }
  win.document = { visibilityState: 'visible', documentElement: { lang: 'tr' } }
  vm.createContext(win)
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'public', 'voice.js'), 'utf8'), win, { filename: 'voice.js' })
  return win.VoiceClient.gameUtils
}

describe('bağlantılar ve taşıma', () => {
  test('index.html ve sw.js oyun modüllerini 32-arama.js satırından sonra sırayla bir kez yükler', () => {
    const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8')
    const sw = fs.readFileSync(path.join(ROOT, 'public', 'sw.js'), 'utf8')
    const count = (text, part) => text.split(part).length - 1
    let prevHtml = html.indexOf('<script src="/js/32-arama.js" defer></script>')
    let prevSw = sw.indexOf("'/js/32-arama.js',")
    assert.ok(prevHtml > 0 && prevSw > 0)
    for (const name of GAME_MODULES) {
      const tag = '<script src="/js/' + name + '" defer></script>'
      const entry = "'/js/" + name + "',"
      assert.equal(count(html, tag), 1, 'index.html ' + name)
      assert.equal(count(sw, entry), 1, 'sw.js ' + name)
      assert.ok(html.indexOf(tag) > prevHtml, 'index.html sırası ' + name)
      assert.ok(sw.indexOf(entry) > prevSw, 'sw.js sırası ' + name)
      prevHtml = html.indexOf(tag)
      prevSw = sw.indexOf(entry)
    }
    assert.ok(prevHtml < html.indexOf('</head>'))
  })

  test('çekirdeğin p sınırı ve metin deseni voice.js oyun sinyaliyle aynıdır', () => {
    const utils = loadVoiceUtils()
    assert.equal(utils.maxChars, G.MAX_P)
    const literal = (src, name) => {
      const m = new RegExp('(?:var|const) ' + name + ' = /(.+)/([a-z]*)\\r?\\n').exec(src)
      assert.ok(m, name)
      return new RegExp(m[1], m[2])
    }
    const voiceSrc = fs.readFileSync(path.join(ROOT, 'public', 'voice.js'), 'utf8')
    assert.equal(literal(GAME_SRC, 'TEXT_RE').source, literal(voiceSrc, 'GAME_TEXT_RE').source)
    const re = literal(GAME_SRC, 'TEXT_RE')
    const signal = (p) => utils.validateSignal({ type: 'game', sid: '0123456789abcdef', n: 1, p }) !== null
    let code = 0
    while (code < 0x180) {
      const ch = String.fromCharCode(code)
      assert.equal(signal('{' + ch + '}'), re.test('{' + ch + '}'), 'karakter ' + code)
      code++
    }
    assert.equal(signal('x'.repeat(G.MAX_P)), true)
    assert.equal(signal('x'.repeat(G.MAX_P + 1)), false)
    // encodePlain çıktısı ve mühürlü zarf taşımadan geçer
    assert.equal(signal(G.encodePlain({ v: 1, k: 'close', why: 'gone' })), true)
    assert.equal(signal(seal(K, B, inner('sync', B, K, { seq: 1 }))), true)
  })
})
