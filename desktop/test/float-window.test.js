'use strict'

// Yüzen pencere (src/lib/float-window.js): tek kullanımlık jeton, açma isteğinin koşulları, açanın çerçevesi,
// pencere seçenekleri ve konumun ekrana sığdırılması. Ana süreçteki bağlantı ve gerçek Electron davranışı
// e2e/duman.test.js içinde denetlenir.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fw = require('../src/lib/float-window')

function clock (start) {
  const c = { now: start || 1000 }
  c.fn = () => c.now
  return c
}

// Sıralı bayt üreteci: her çağrıda farklı jeton
function counter () {
  let n = 0
  return (size) => {
    n++
    return Buffer.alloc(size, n)
  }
}

test('jeton: biçim telsiz-yuzen-<32 onaltılık>, tek kullanımlık, yanlış ad harcamaz', () => {
  const c = clock()
  const gate = fw.createGate({ now: c.fn, random: counter() })
  const token = gate.arm()
  assert.match(token, /^telsiz-yuzen-[0-9a-f]{32}$/)
  assert.equal(fw.isToken(token), true)
  // Yanlış adlar jetonu harcamaz
  for (const name of ['', 'telsiz-yuzen-', token + '0', token.toUpperCase(), 'telsiz-yuzen-' + 'f'.repeat(32), null, undefined, 5, { toString: () => token }, [token]]) {
    assert.equal(gate.take(name), false, String(name))
  }
  assert.equal(gate.take(token), true)
  // İkinci kullanım reddedilir
  assert.equal(gate.take(token), false)
  // Jeton üretilmeden hiçbir ad kabul edilmez
  assert.equal(fw.createGate().take(token), false)
})

test('jeton: yaklaşık 3 saniye geçerli, yeni jeton eskisini geçersiz kılar', () => {
  assert.equal(fw.TOKEN_TTL_MS, 3000)
  const c = clock()
  const gate = fw.createGate({ now: c.fn, random: counter() })
  const first = gate.arm()
  c.now += fw.TOKEN_TTL_MS
  assert.equal(gate.take(first), true, 'süre sınırında hâlâ geçerli')
  const late = gate.arm()
  c.now += fw.TOKEN_TTL_MS + 1
  assert.equal(gate.take(late), false, 'süresi dolan jeton reddedilir')
  c.now += 10
  assert.equal(gate.take(late), false)
  const a = gate.arm()
  const b = gate.arm()
  assert.notEqual(a, b)
  assert.equal(gate.take(a), false, 'eski jeton geçersiz')
  assert.equal(gate.take(b), true)
  // Gerçek üreteçle iki jeton farklıdır
  const real = fw.createGate()
  assert.notEqual(real.arm(), real.arm())
})

test('açma isteği: yalnızca uygulama penceresinden, about:blank adresine, doğru jetonla, pencere yokken', () => {
  const gate = fw.createGate()
  const ok = (token) => ({ context: 'app', fromMain: true, url: 'about:blank', frameName: token, open: false })
  let token = gate.arm()
  const denied = [
    Object.assign(ok(token), { context: 'background' }),
    Object.assign(ok(token), { context: 'float' }),
    Object.assign(ok(token), { context: 'connect' }),
    Object.assign(ok(token), { context: undefined }),
    Object.assign(ok(token), { fromMain: false }),
    Object.assign(ok(token), { fromMain: 'true' }),
    Object.assign(ok(token), { url: 'about:blank#x' }),
    Object.assign(ok(token), { url: 'telsiz://app/' }),
    Object.assign(ok(token), { url: 'https://www.youtube.com/' }),
    Object.assign(ok(token), { url: '' }),
    Object.assign(ok(token), { open: true }),
    null
  ]
  for (const req of denied) assert.equal(fw.isFloatRequest(req, gate), false, JSON.stringify(req))
  // Koşulu tutmayan istekler jetonu harcamadı
  assert.equal(fw.isFloatRequest(ok(token), gate), true)
  assert.equal(fw.isFloatRequest(ok(token), gate), false, 'jeton tek kullanımlık')
  token = gate.arm()
  assert.equal(fw.isFloatRequest(ok('telsiz-yuzen-' + '0'.repeat(32)), gate), false)
  assert.equal(fw.isFloatRequest(ok(''), gate), false, 'jetonsuz window.open reddedilir')
  assert.equal(fw.isFloatRequest(ok(token), null), false)
  assert.equal(fw.isFloatRequest(ok(token), gate), true)
})

test('açanın çerçevesi: aynı nesne veya aynı süreç ve yönlendirme kimliği', () => {
  const main = { processId: 4, routingId: 1 }
  assert.equal(fw.sameFrame(main, main), true)
  assert.equal(fw.sameFrame({ processId: 4, routingId: 1 }, main), true)
  assert.equal(fw.sameFrame({ processId: 4, routingId: 2 }, main), false, 'alt çerçeve (YouTube oynatıcısı)')
  assert.equal(fw.sameFrame({ processId: 5, routingId: 1 }, main), false)
  assert.equal(fw.sameFrame({}, {}), false)
  assert.equal(fw.sameFrame(null, main), false)
  assert.equal(fw.sameFrame(main, null), false)
  assert.equal(fw.sameFrame(undefined, undefined), false)
})

test('seçenekler: gizli, çerçevesiz, her zaman üstte, görev çubuğunda yok, ön yükleme betiği yok', () => {
  const o = fw.options(null)
  assert.deepEqual(o, {
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    resizable: true,
    minWidth: 200,
    minHeight: 120,
    webPreferences: { preload: '' }
  })
  const withBounds = fw.options({ x: 10, y: 20, width: 300, height: 200 })
  assert.deepEqual([withBounds.x, withBounds.y, withBounds.width, withBounds.height], [10, 20, 300, 200])
  assert.equal(withBounds.webPreferences.preload, '')
  // Geçersiz konum seçeneklere girmez
  const bad = fw.options({ x: 1.5, y: 0, width: 300, height: 200 })
  assert.equal('x' in bad, false)
  // Her çağrı yeni nesne döner (Electron seçenek nesnesini değiştirebilir)
  assert.notEqual(fw.options(null).webPreferences, fw.options(null).webPreferences)
})

test('kayıtlı konum: tam sayı ve akıl sınırları içinde, değilse null', () => {
  assert.deepEqual(fw.validBounds({ x: -50, y: 0, width: 200, height: 120, fazla: 1 }), { x: -50, y: 0, width: 200, height: 120 })
  const bad = [
    null, undefined, 'x', [], [1, 2, 3, 4],
    { x: 0, y: 0, width: 199, height: 200 },
    { x: 0, y: 0, width: 300, height: 119 },
    { x: 0, y: 0, width: 10001, height: 200 },
    { x: 100001, y: 0, width: 300, height: 200 },
    { x: 0, y: -100001, width: 300, height: 200 },
    { x: 0.5, y: 0, width: 300, height: 200 },
    { x: '0', y: 0, width: 300, height: 200 },
    { x: 0, y: 0, width: NaN, height: 200 },
    { x: 0, y: 0, width: 300 }
  ]
  for (const raw of bad) assert.equal(fw.validBounds(raw), null, JSON.stringify(raw))
})

test('konum: kayıtlı pencere ekrandaysa korunur, değilse sağ alt köşe, her zaman tam sayı', () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 }
  assert.deepEqual(fw.cleanBounds({ x: 100, y: 100, width: 400, height: 300 }, area), { x: 100, y: 100, width: 400, height: 300 })
  // Varsayılan: sağ alt köşe, kenardan 16 piksel
  const def = fw.cleanBounds(null, area)
  assert.deepEqual(def, { x: 1920 - fw.DEFAULT_WIDTH - 16, y: 1040 - fw.DEFAULT_HEIGHT - 16, width: fw.DEFAULT_WIDTH, height: fw.DEFAULT_HEIGHT })
  // Ekranın dışına taşan veya başka ekranda kalan pencere sağ alt köşeye döner
  assert.deepEqual(fw.cleanBounds({ x: 1800, y: 100, width: 400, height: 300 }, area), def)
  assert.deepEqual(fw.cleanBounds({ x: -2000, y: 0, width: 400, height: 300 }, area), def)
  assert.deepEqual(fw.cleanBounds({ x: 0, y: 0, width: 1.5, height: 300 }, area), def)
  // İkinci ekran (negatif koordinatlar) ve kesirli çalışma alanı
  const left = { x: -1280, y: 0.4, width: 1280.6, height: 720.2 }
  assert.deepEqual(fw.cleanBounds({ x: -1200, y: 10, width: 300, height: 200 }, left), { x: -1200, y: 10, width: 300, height: 200 })
  const leftDef = fw.cleanBounds(null, left)
  assert.deepEqual(leftDef, { x: -1280 + 1280 - fw.DEFAULT_WIDTH - 16, y: 720 - fw.DEFAULT_HEIGHT - 16, width: fw.DEFAULT_WIDTH, height: fw.DEFAULT_HEIGHT })
  // Varsayılandan küçük ekranda pencere alana sığar, en küçük boyutun altına inmez
  assert.deepEqual(fw.cleanBounds(null, { x: 0, y: 0, width: 260, height: 150 }), { x: 0, y: 0, width: 260, height: 150 })
  assert.deepEqual(fw.cleanBounds(null, { x: 0, y: 0, width: 100, height: 100 }), { x: 0, y: 0, width: 200, height: 120 })
  // Çalışma alanı bilinmiyorsa varsayılan boyut kullanılır
  for (const bad of [null, {}, { x: 0, y: 0, width: 0, height: 100 }, { x: 'a', y: 0, width: 10, height: 10 }]) {
    const b = fw.cleanBounds(null, bad)
    assert.deepEqual([b.width, b.height], [fw.DEFAULT_WIDTH, fw.DEFAULT_HEIGHT], JSON.stringify(bad))
    assert.ok(Object.values(b).every(Number.isInteger))
  }
})
