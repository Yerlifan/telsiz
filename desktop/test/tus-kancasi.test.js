'use strict'

// Basılı tut tuş kancası: tuş adlarının uiohook-napi kodlarına eşlenmesi (src/lib/hook-keys.js) ve kancanın
// yaşam döngüsü (src/lib/ptt-hook.js). Yerel modül yüklenmez: UiohookKey tablosu paketin kendi
// dist/index.js dosyasından, node-gyp-build sahte bir işlevle değiştirilerek vm içinde okunur. Kanca sahte
// bir uIOhook nesnesiyle denenir. Gerçek modülün paketlenmiş uygulamada yüklendiği duman testinde denetlenir.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const hookKeys = require('../src/lib/hook-keys')
const pttHook = require('../src/lib/ptt-hook')
const shortcuts = require('../src/lib/shortcuts')

const DESKTOP_DIR = path.join(__dirname, '..')
const ROOT_DIR = path.join(DESKTOP_DIR, '..')
const UIOHOOK_DIR = path.join(DESKTOP_DIR, 'node_modules', 'uiohook-napi')

// Paketin UiohookKey tablosu, yerel modül yüklenmeden
function uiohookTable () {
  const file = path.join(UIOHOOK_DIR, 'dist', 'index.js')
  assert.ok(fs.existsSync(file), 'uiohook-napi kurulu değil (desktop/ içinde npm ci çalıştırın)')
  const sandbox = {
    exports: {},
    __dirname: path.dirname(file),
    require: (name) => {
      if (name === 'node-gyp-build') return () => ({ start () {}, stop () {}, keyTap () {} })
      if (name === 'events' || name === 'path') return require(name)
      throw new Error('unexpected require: ' + name)
    }
  }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file })
  return JSON.parse(JSON.stringify(sandbox.exports.UiohookKey))
}

const TABLE = uiohookTable()

// Sahte uIOhook: dinleyiciler, çağrılar ve olay üretimi
function fakeModule (opts) {
  const o = opts || {}
  const listeners = { keydown: new Set(), keyup: new Set() }
  const calls = []
  const uIOhook = {
    on (type, fn) {
      calls.push('on:' + type)
      listeners[type].add(fn)
    },
    removeListener (type, fn) {
      calls.push('off:' + type)
      listeners[type].delete(fn)
    },
    start () {
      calls.push('start')
      if (o.startError) throw new Error('UIOHOOK_ERROR_X_RECORD_NOT_FOUND')
    },
    stop () {
      calls.push('stop')
    }
  }
  const emit = (type, keycode, flags) => {
    const e = Object.assign({ type: type === 'keydown' ? 4 : 5, keycode, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }, flags || {})
    for (const fn of Array.from(listeners[type])) fn(e)
  }
  return { module: { uIOhook, UiohookKey: TABLE }, calls, emit, listeners }
}

function makeHook (opts) {
  const o = opts || {}
  const fake = fakeModule(o)
  const talks = []
  const logs = []
  let loads = 0
  const hook = pttHook.createPttHook({
    platform: o.platform || 'win32',
    env: o.env || {},
    load: () => {
      loads++
      if (o.loadError) throw new Error('No native build was found')
      return fake.module
    },
    onTalk: function () {
      talks.push(Array.from(arguments))
    },
    log: (label, err) => logs.push([label, err && err.message])
  })
  return { hook, fake, talks, logs, loads: () => loads }
}

test('eşlemedeki her alan paketin UiohookKey tablosunda vardır ve kodlar çakışmaz', () => {
  const owner = new Map()
  for (const [name, fields] of hookKeys.KEY_FIELDS) {
    for (const field of fields) {
      assert.ok(Number.isInteger(TABLE[field]) && TABLE[field] > 0, name + ' -> ' + field)
      const code = TABLE[field]
      assert.ok(!owner.has(code) || owner.get(code) === name, field + ' kodu hem ' + owner.get(code) + ' hem ' + name + ' için kullanılıyor')
      owner.set(code, name)
    }
  }
  for (const [name, modifier] of hookKeys.MODIFIER_FIELDS) {
    for (const field of modifier.fields) {
      assert.ok(Number.isInteger(TABLE[field]), name + ' -> ' + field)
      assert.ok(!owner.has(TABLE[field]), 'değiştirici kodu bir tuşla aynı: ' + field)
    }
  }
  // Harfler, rakamlar ve F1-F24 eksiksiz
  for (const key of ['A', 'Z', '0', '9', 'F1', 'F12', 'F24', 'num0', 'num9', 'Return', 'Space', '`']) assert.ok(hookKeys.isMappableKey(key), key)
  assert.equal(hookKeys.KEY_FIELDS.size, 26 + 10 + 24 + 42)
})

test('eşlenen her tuş basılı tut doğrulamasından geçer, ses ve medya tuşları ile Plus geçmez', () => {
  for (const name of hookKeys.KEY_FIELDS.keys()) assert.equal(shortcuts.normalizeHoldKey(name), name, name)
  for (const name of ['VolumeUp', 'VolumeDown', 'VolumeMute', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause', 'Plus']) {
    assert.equal(hookKeys.isMappableKey(name), false, name)
    assert.equal(shortcuts.normalizeHoldKey(name), null, name)
  }
})

test('web tarafının yakaladığı her tuş adı ya eşlenir ya da bilerek dışarıda kalır', () => {
  // public/js/20-desktop.js CODE_KEYS tablosu ve keyFromCode kalıpları (Key[A-Z], Digit[0-9], F1-F24, Numpad0-9)
  const source = fs.readFileSync(path.join(ROOT_DIR, 'public', 'js', '20-desktop.js'), 'utf8')
  const block = /const CODE_KEYS = \{([^}]*)\}/.exec(source)
  assert.ok(block, 'CODE_KEYS bulunamadı')
  const names = Array.from(block[1].matchAll(/:\s*'((?:\\.|[^'\\])*)'/g)).map((m) => m[1].replace(/\\(.)/g, '$1'))
  assert.ok(names.length >= 30)
  for (const i of Array.from({ length: 26 }, (_, n) => n)) names.push(String.fromCharCode(65 + i))
  for (const i of Array.from({ length: 10 }, (_, n) => n)) names.push(String(i), 'num' + i)
  for (const i of Array.from({ length: 24 }, (_, n) => n)) names.push('F' + (i + 1))
  const excluded = new Set(['VolumeUp', 'VolumeDown', 'VolumeMute', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause'])
  for (const name of names) {
    if (excluded.has(name)) continue
    assert.ok(hookKeys.isMappableKey(name), 'web tarafındaki ' + JSON.stringify(name) + ' tuşu kancada eşlenmiyor')
    assert.ok(hookKeys.resolveHoldKey(name, TABLE), name)
  }
})

test('basılı tut tuşu kodlara çevrilir', () => {
  assert.deepEqual(hookKeys.resolveHoldKey('V', TABLE), { codes: [TABLE.V], flags: [], releaseCodes: [] })
  assert.deepEqual(hookKeys.resolveHoldKey('CommandOrControl+Shift+F13', TABLE), {
    codes: [TABLE.F13],
    flags: ['ctrlKey', 'shiftKey'],
    releaseCodes: [TABLE.Ctrl, TABLE.CtrlRight, TABLE.Shift, TABLE.ShiftRight]
  })
  assert.deepEqual(hookKeys.resolveHoldKey('Super+num1', TABLE).codes, [TABLE.Numpad1, TABLE.NumpadEnd])
  assert.deepEqual(hookKeys.resolveHoldKey('Return', TABLE).codes, [TABLE.Enter, TABLE.NumpadEnter])
  assert.deepEqual(hookKeys.resolveHoldKey('Alt+`', TABLE).releaseCodes, [TABLE.Alt, TABLE.AltRight])
  for (const bad of ['', 'Plus', 'VolumeUp', 'Ctrl+V', 'CommandOrControl+CommandOrControl+V', 'AltGr+V', null, 5]) assert.equal(hookKeys.resolveHoldKey(bad, TABLE), null, String(bad))
  // Tablo eksik veya bozuksa (ör. paket değişti) tuş eşlenmez
  assert.equal(hookKeys.resolveHoldKey('V', {}), null)
  assert.equal(hookKeys.resolveHoldKey('V', { V: '47' }), null)
  assert.equal(hookKeys.resolveHoldKey('V', null), null)
  assert.equal(hookKeys.resolveHoldKey('CommandOrControl+V', { V: 47 }), null)
  assert.equal(hookKeys.resolveHoldKey('V', Object.create({ V: 47 })), null)
})

test('kanca kullanılabilirliği: desteklenmeyen platform ve X11 ekranı yokken modül yüklenmez', () => {
  const freebsd = makeHook({ platform: 'freebsd' })
  assert.deepEqual(freebsd.hook.check(), { available: false, reason: 'unsupported', running: false, error: null })
  freebsd.hook.update({ enabled: true, active: true, key: 'V' })
  assert.equal(freebsd.loads(), 0)
  const wayland = makeHook({ platform: 'linux', env: { XDG_SESSION_TYPE: 'wayland' } })
  assert.deepEqual(wayland.hook.availability(), { available: false, reason: 'no_display', running: false, error: null })
  wayland.hook.update({ enabled: true, active: true, key: 'V' })
  assert.equal(wayland.loads(), 0)
  assert.equal(wayland.hook.isRunning(), false)
  const x11 = makeHook({ platform: 'linux', env: { DISPLAY: ':0' } })
  assert.equal(x11.hook.availability().available, true)
  assert.equal(x11.loads(), 0, 'kullanılabilirlik sorgusu modülü yüklemez')
  assert.equal(x11.hook.check().available, true)
  assert.equal(x11.loads(), 1)
  assert.deepEqual(pttHook.REASONS, ['unsupported', 'no_display', 'load_failed'])
  assert.deepEqual(pttHook.ERRORS, ['start_failed'])
})

test('kanca yalnızca ayar açık, tuş atanmış ve ses odasındayken çalışır, modül gerekince yüklenir', () => {
  const h = makeHook()
  h.hook.update({ enabled: false, active: true, key: 'V' })
  h.hook.update({ enabled: true, active: false, key: 'V' })
  h.hook.update({ enabled: true, active: true, key: null })
  h.hook.update({ enabled: true, active: true, key: '' })
  h.hook.update(null)
  assert.equal(h.loads(), 0)
  assert.equal(h.hook.isRunning(), false)
  const status = h.hook.update({ enabled: true, active: true, key: 'V' })
  assert.deepEqual(status, { available: true, reason: null, running: true, error: null })
  assert.deepEqual(h.fake.calls, ['on:keydown', 'on:keyup', 'start'])
  // Aynı istek yeniden başlatmaz
  h.hook.update({ enabled: true, active: true, key: 'V' })
  assert.deepEqual(h.fake.calls, ['on:keydown', 'on:keyup', 'start'])
  // Odadan çıkınca durur ve dinleyiciler kaldırılır
  h.hook.update({ enabled: true, active: false, key: 'V' })
  assert.equal(h.hook.isRunning(), false)
  assert.deepEqual(h.fake.calls.slice(3), ['stop', 'off:keydown', 'off:keyup'])
  assert.equal(h.fake.listeners.keydown.size + h.fake.listeners.keyup.size, 0)
  // Tuş değişince kanca yeni tuşla yeniden başlar
  h.hook.update({ enabled: true, active: true, key: 'V' })
  h.hook.update({ enabled: true, active: true, key: 'B' })
  assert.equal(h.hook.isRunning(), true)
  assert.equal(h.fake.listeners.keydown.size, 1)
  h.fake.emit('keydown', TABLE.V)
  assert.deepEqual(h.talks, [])
  h.fake.emit('keydown', TABLE.B)
  assert.deepEqual(h.talks, [[true]])
  assert.equal(h.loads(), 1)
  h.hook.stop()
  assert.deepEqual(h.talks, [[true], [false]])
  assert.equal(h.hook.isRunning(), false)
})

test('yalnızca atanan tuş işlenir: basınca konuş başla, bırakınca konuş bitti, başka bilgi çıkmaz', () => {
  const h = makeHook()
  h.hook.update({ enabled: true, active: true, key: 'V' })
  // Diğer tuşlar hiçbir şey üretmez
  for (const code of [TABLE.A, TABLE.Space, TABLE.Enter, TABLE.Ctrl, 9999]) {
    h.fake.emit('keydown', code)
    h.fake.emit('keyup', code)
  }
  assert.deepEqual(h.talks, [])
  // Tuş tekrarı (basılı tutma) tek "konuş başla" üretir, fazladan değiştirici yok sayılır
  h.fake.emit('keydown', TABLE.V, { shiftKey: true })
  h.fake.emit('keydown', TABLE.V)
  h.fake.emit('keydown', TABLE.V)
  h.fake.emit('keyup', TABLE.A)
  assert.deepEqual(h.talks, [[true]])
  h.fake.emit('keyup', TABLE.V)
  h.fake.emit('keyup', TABLE.V)
  assert.deepEqual(h.talks, [[true], [false]])
  // Dışarıya yalnızca true veya false çıkar, olay nesnesi veya tuş kodu verilmez, günlük yazılmaz
  for (const args of h.talks) assert.ok(args.length === 1 && typeof args[0] === 'boolean')
  assert.deepEqual(h.logs, [])
  // Bozuk olaylar yok sayılır
  for (const fn of h.fake.listeners.keydown) {
    fn(null)
    fn({})
  }
  assert.deepEqual(h.talks, [[true], [false]])
})

test('değiştiricili tuş: değiştirici basılı değilse başlamaz, değiştirici bırakılınca biter', () => {
  const h = makeHook()
  h.hook.update({ enabled: true, active: true, key: 'CommandOrControl+F13' })
  h.fake.emit('keydown', TABLE.F13)
  assert.deepEqual(h.talks, [])
  h.fake.emit('keydown', TABLE.F13, { ctrlKey: true })
  assert.deepEqual(h.talks, [[true]])
  // Sağ Ctrl bırakılınca da biter
  h.fake.emit('keyup', TABLE.CtrlRight)
  assert.deepEqual(h.talks, [[true], [false]])
  h.fake.emit('keydown', TABLE.F13, { ctrlKey: true })
  h.fake.emit('keyup', TABLE.F13, { ctrlKey: true })
  assert.deepEqual(h.talks, [[true], [false], [true], [false]])
})

test('konuşurken kanca durursa konuş bitti bildirilir (tuş takılı kalmaz)', () => {
  const h = makeHook()
  h.hook.update({ enabled: true, active: true, key: 'V' })
  h.fake.emit('keydown', TABLE.V)
  h.hook.update({ enabled: false, active: true, key: 'V' })
  assert.deepEqual(h.talks, [[true], [false]])
  assert.equal(h.hook.isTalking(), false)
  // Durmuş kancanın eski dinleyicisi çağrılsa da bir şey üretmez
  h.fake.emit('keydown', TABLE.V)
  assert.deepEqual(h.talks, [[true], [false]])
})

test('modül yüklenemezse uygulama çökmez, seçenek nedeniyle kullanılamaz görünür', () => {
  const h = makeHook({ loadError: true })
  assert.equal(h.hook.availability().available, true)
  const status = h.hook.update({ enabled: true, active: true, key: 'V' })
  assert.deepEqual(status, { available: false, reason: 'load_failed', running: false, error: null })
  assert.deepEqual(h.hook.check(), status)
  h.hook.update({ enabled: false, active: true, key: 'V' })
  h.hook.update({ enabled: true, active: true, key: 'V' })
  assert.equal(h.loads(), 1, 'başarısız yükleme oturum boyunca yinelenmez')
  assert.deepEqual(h.logs, [['ptt hook load', 'No native build was found']])
  // Beklenmeyen biçimdeki modül de yüklenemedi sayılır
  const odd = pttHook.createPttHook({ platform: 'win32', load: () => ({ uIOhook: {} }) })
  assert.equal(odd.check().reason, 'load_failed')
})

test('kanca başlatılamazsa hata bildirilir, aynı istek yinelenmez, yeniden açınca denenir', () => {
  const h = makeHook({ startError: true })
  const status = h.hook.update({ enabled: true, active: true, key: 'V' })
  assert.deepEqual(status, { available: true, reason: null, running: false, error: 'start_failed' })
  assert.equal(h.fake.listeners.keydown.size, 0)
  h.hook.update({ enabled: true, active: true, key: 'V' })
  assert.equal(h.fake.calls.filter((c) => c === 'start').length, 1)
  h.hook.update({ enabled: true, active: false, key: 'V' })
  h.hook.update({ enabled: true, active: true, key: 'V' })
  assert.equal(h.fake.calls.filter((c) => c === 'start').length, 2)
  assert.deepEqual(h.logs.map((l) => l[0]), ['ptt hook start', 'ptt hook start'])
  assert.deepEqual(h.talks, [])
})

test('ana süreç modülü yalnızca gerekince yükler, tuş kodları sayfaya veya günlüğe gitmez', () => {
  const main = fs.readFileSync(path.join(DESKTOP_DIR, 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(main.includes("load: () => require('uiohook-napi')"))
  assert.doesNotMatch(main, /^const .*require\('uiohook-napi'\)/m)
  // Ana süreç olay nesnelerine hiç dokunmaz, sayfaya yalnızca HOLD_PHASES değerleri gider
  assert.doesNotMatch(main, /keycode/)
  assert.match(main, /webContents\.send\(CHANNELS\.pttHold, phase\)/)
  assert.match(main, /if \(!HOLD_PHASES\.includes\(phase\)\) return/)
  const lib = fs.readFileSync(path.join(DESKTOP_DIR, 'src', 'lib', 'ptt-hook.js'), 'utf8')
  // Olaydan yalnızca tuş kodu karşılaştırılır, hiçbir yere yazılmaz
  for (const line of lib.split('\n').filter((l) => /keycode/.test(l) && !/^\s*\/\//.test(l))) {
    assert.match(line, /\.includes\(e\.keycode\)/, line)
  }
  assert.doesNotMatch(lib, /console\./)
})
