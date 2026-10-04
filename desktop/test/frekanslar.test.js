'use strict'

// Çok frekanslı masaüstü: kayıtlı frekans listesi (src/lib/frequencies.js), eski tek sunucu ayarından
// geçiş (src/lib/settings-store.js) ve ana sürecin frekans denetleyicisi (IPC işleyicilerinin
// doğrulaması, geçiş, ekleme, çıkarma, ad bildirimi).

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const freq = require('../src/lib/frequencies')
const settingsStore = require('../src/lib/settings-store')

const A = 'https://a.ornek.com'
const B = 'https://b.ornek.com:8443'
const L = 'http://localhost:4800'

function tempDir (label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-frekans-' + label + '-'))
}

test('liste doğrulaması: geçersiz, yinelenen ve fazla öğeler atılır', () => {
  const list = freq.sanitizeList([
    { origin: A, name: '  Kankalar  ', lastUsed: 5 },
    { origin: A, name: 'yineleme' },
    { origin: 'http://kotu.com' },
    { origin: 'https://a.ornek.com/' },
    { origin: 'https://user:pw@c.com' },
    { origin: B, name: 'x'.repeat(201), lastUsed: -3 },
    { origin: L, name: 'Satır\nsonu' + String.fromCharCode(0x202e), lastUsed: 'dün' },
    null,
    'https://d.com',
    [A]
  ])
  assert.deepEqual(list, [
    { origin: A, name: 'Kankalar', lastUsed: 5 },
    { origin: B, name: null, lastUsed: 0 },
    { origin: L, name: 'Satır sonu', lastUsed: 0 }
  ])
  assert.deepEqual(freq.sanitizeList('x'), [])
  const many = Array.from({ length: 60 }, (_, i) => ({ origin: 'https://f' + i + '.com' }))
  assert.equal(freq.sanitizeList(many).length, freq.MAX_FREQUENCIES)
  assert.equal(freq.cleanName('   '), null)
  assert.equal(freq.cleanName(5), null)
})

test('ekleme, güncelleme, çıkarma ve sıradaki frekans', () => {
  let list = freq.upsert([], A, { name: 'A', lastUsed: 10 })
  list = freq.upsert(list, B, { lastUsed: 20 })
  list = freq.upsert(list, A, { name: '' })
  assert.deepEqual(list, [{ origin: A, name: 'A', lastUsed: 10 }, { origin: B, name: null, lastUsed: 20 }])
  list = freq.upsert(list, B, { name: 'Bee' })
  assert.equal(list[1].name, 'Bee')
  assert.deepEqual(freq.upsert(list, 'javascript:alert(1)', { name: 'x' }), list)
  assert.equal(freq.pickNext(list), B)
  assert.equal(freq.pickNext(freq.remove(list, B)), A)
  assert.equal(freq.pickNext([]), null)
  // Liste doluyken en uzun süredir kullanılmayan çıkar
  let full = Array.from({ length: freq.MAX_FREQUENCIES }, (_, i) => ({ origin: 'https://f' + i + '.com', lastUsed: i + 1 }))
  full = freq.upsert(full, A, { lastUsed: 999 })
  assert.equal(full.length, freq.MAX_FREQUENCIES)
  assert.ok(!freq.has(full, 'https://f0.com'))
  assert.ok(freq.has(full, A))
})

test('sayfaya verilen liste: etkin frekans başta, ad yoksa ana bilgisayar', () => {
  const list = [{ origin: A, name: 'A', lastUsed: 1 }, { origin: B, name: null, lastUsed: 2 }]
  const out = freq.publicList(B, list)
  assert.equal(out.active, B)
  assert.deepEqual(out.items, [
    { origin: B, name: null, host: 'b.ornek.com:8443', active: true },
    { origin: A, name: 'A', host: 'a.ornek.com', active: false }
  ])
  assert.equal(freq.displayName(out.items[0]), 'b.ornek.com:8443')
  assert.equal(freq.displayName(out.items[1]), 'A')
  assert.equal(freq.publicList('kotu', list).active, null)
})

test('ayar geçişi: biçim 1 dosyasındaki sunucu adresi listeye eklenir, veri kaybolmaz', () => {
  const root = tempDir('gecis')
  try {
    const file = path.join(root, settingsStore.FILE_NAME)
    fs.writeFileSync(file, JSON.stringify({ version: 1, server: A, closeToTray: true, shortcuts: { toggleMute: 'F9', toggleDeafen: null } }))
    const loaded = settingsStore.load(file)
    assert.equal(loaded.server, A)
    assert.deepEqual(loaded.frequencies, [{ origin: A, name: null, lastUsed: 0 }])
    assert.equal(loaded.closeToTray, true)
    assert.equal(loaded.shortcuts.toggleMute, 'F9')
    // Yazılan dosya biçim 2'dir ve yeniden okununca aynıdır
    const saved = settingsStore.save(file, loaded)
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).version, 2)
    assert.deepEqual(settingsStore.load(file), saved)
    // Etkin frekans geçersizse en son kullanılan seçilir
    fs.writeFileSync(file, JSON.stringify({ version: 2, server: 'http://kotu.com', frequencies: [{ origin: A, lastUsed: 3 }, { origin: B, lastUsed: 7 }] }))
    assert.equal(settingsStore.load(file).server, B)
    // Etkin frekans listede yoksa eklenir
    fs.writeFileSync(file, JSON.stringify({ version: 2, server: L, frequencies: [{ origin: A }] }))
    assert.deepEqual(settingsStore.load(file).frequencies.map((f) => f.origin), [A, L])
    // Boş ayar
    fs.writeFileSync(file, JSON.stringify({ version: 2, frequencies: 'x' }))
    assert.deepEqual(settingsStore.load(file), settingsStore.defaults())
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

// Ana süreç yerine sahte bağımlılıklarla denetleyici
function makeController (initial, windowOrigin) {
  const calls = []
  const deferred = []
  let settings = settingsStore.sanitize(initial)
  const control = freq.createController({
    settings: () => settings,
    persist: () => {
      settings = settingsStore.sanitize(settings)
      calls.push(['persist'])
    },
    windowOrigin: () => windowOrigin,
    apply: (origin) => calls.push(['apply', origin]),
    closeToConnect: () => calls.push(['connect']),
    clearData: (origin) => calls.push(['clear', origin]),
    defer: (fn) => deferred.push(fn),
    now: () => 1000
  })
  const flush = () => {
    while (deferred.length) deferred.shift()()
  }
  return { control, calls, flush, get settings () { return settings } }
}

test('denetleyici: geçiş yalnızca listedeki geçerli kökene', () => {
  const c = makeController({ server: A, frequencies: [{ origin: A, name: 'A', lastUsed: 1 }, { origin: B, lastUsed: 2 }] }, A)
  for (const bad of ['', 'https://yok.com', 'http://kotu.com', 'https://a.ornek.com/', 5, null, { origin: B }, 'x'.repeat(2000), 'javascript:alert(1)']) {
    assert.deepEqual(c.control.switchTo(bad), { ok: false, code: 'unknown' }, String(bad))
  }
  assert.deepEqual(c.calls, [])
  assert.deepEqual(c.control.switchTo(B), { ok: true, origin: B })
  // Pencere değişikliği yanıt gittikten sonra
  assert.deepEqual(c.calls, [['persist']])
  c.flush()
  assert.deepEqual(c.calls, [['persist'], ['apply', B]])
  assert.equal(c.settings.server, B)
  assert.equal(c.settings.frequencies.find((f) => f.origin === B).lastUsed, 1000)
  assert.equal(c.control.list().items[0].origin, B)
})

test('denetleyici: ekleme listeye yazar ve etkin yapar', () => {
  const c = makeController({ server: A }, A)
  assert.deepEqual(c.control.added('http://kotu.com', 'x'), { ok: false, code: 'invalid' })
  assert.deepEqual(c.control.added(L, 'Yerel'), { ok: true, origin: L })
  c.flush()
  assert.equal(c.settings.server, L)
  assert.deepEqual(c.settings.frequencies, [{ origin: A, name: null, lastUsed: 0 }, { origin: L, name: 'Yerel', lastUsed: 1000 }])
  assert.deepEqual(c.calls, [['persist'], ['apply', L]])
})

test('denetleyici: çıkarma, veri silme yalnızca açık onayla, son frekans adres penceresini açar', () => {
  const c = makeController({ server: A, frequencies: [{ origin: A, lastUsed: 5 }, { origin: B, lastUsed: 9 }, { origin: L, lastUsed: 1 }] }, A)
  assert.deepEqual(c.control.remove(B, 'evet'), { ok: false, code: 'invalid' })
  assert.deepEqual(c.control.remove(B), { ok: false, code: 'invalid' })
  assert.deepEqual(c.control.remove('https://yok.com', false), { ok: false, code: 'unknown' })
  // Etkin olmayan, veri korunur
  assert.deepEqual(c.control.remove(L, false), { ok: true, active: A })
  c.flush()
  assert.deepEqual(c.calls, [['persist']])
  // Etkin olan, veri silinir, en son kullanılana geçilir
  assert.deepEqual(c.control.remove(A, true), { ok: true, active: B })
  c.flush()
  assert.deepEqual(c.calls.slice(1), [['persist'], ['apply', B], ['clear', A]])
  // Son frekans
  assert.deepEqual(c.control.remove(B, false), { ok: true, active: null })
  c.flush()
  assert.deepEqual(c.calls.slice(4), [['persist'], ['connect']])
  assert.equal(c.settings.server, null)
  assert.deepEqual(c.settings.frequencies, [])
})

test('denetleyici: ad bildirimi yalnızca pencerenin kendi frekansına', () => {
  const c = makeController({ server: A, frequencies: [{ origin: A }, { origin: B }] }, A)
  assert.deepEqual(c.control.setName(5), { ok: false, code: 'invalid' })
  assert.deepEqual(c.control.setName('  '), { ok: false, code: 'invalid' })
  assert.deepEqual(c.control.setName('x'.repeat(1001)), { ok: false, code: 'invalid' })
  assert.deepEqual(c.control.setName('Kankalar'), { ok: true, changed: true })
  assert.deepEqual(c.control.setName('Kankalar'), { ok: true, changed: false })
  assert.equal(c.settings.frequencies[0].name, 'Kankalar')
  assert.equal(c.settings.frequencies[1].name, null)
  // Pencere listede olmayan bir frekanstaysa yazılmaz
  const d = makeController({ server: A }, 'https://yok.com')
  assert.deepEqual(d.control.setName('X'), { ok: false, code: 'invalid' })
  const e = makeController({ server: A }, null)
  assert.deepEqual(e.control.setName('X'), { ok: false, code: 'invalid' })
})

test('ana süreç frekans işleyicileri göndereni denetler ve denetleyiciye gider', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n')
  for (const name of ['listFrequencies', 'switchFrequency', 'addFrequency', 'removeFrequency', 'setFrequencyName']) {
    const re = new RegExp('ipcMain\\.handle\\(CHANNELS\\.' + name + ', \\([^)]*\\) => \\{\\n\\s+requireSender\\(event, \'app\'\\)')
    assert.match(main, re, name)
  }
  assert.ok(main.includes('frequencyControl.remove(origin, clearData)'))
  assert.ok(main.includes('frequencyControl.switchTo(origin)'))
  assert.ok(main.includes('frequencyControl.setName(name)'))
})
