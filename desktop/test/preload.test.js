'use strict'

// Ön yükleme betikleri: sayfaya açılan API, sabit IPC kanalları ve src/lib/channels.js eşliği.
// Betikler sahte electron modülüyle vm içinde çalıştırılır. Ana süreçteki sertleştirmeler de
// kaynak üzerinden denetlenir (asıl davranış e2e/duman.test.js içinde gerçek Electron ile).

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const channels = require('../src/lib/channels')

const SRC = path.join(__dirname, '..', 'src')

function loadPreload (file, argv) {
  const exposed = {}
  const invoked = []
  const sent = []
  const listeners = {}
  const windowListeners = {}
  const electron = {
    contextBridge: {
      exposeInMainWorld (name, api) {
        exposed[name] = api
      }
    },
    ipcRenderer: {
      invoke (channel, ...args) {
        invoked.push([channel].concat(args))
        return Promise.resolve('ok')
      },
      send (channel, ...args) {
        sent.push([channel].concat(args))
      },
      on (channel, fn) {
        listeners[channel] = fn
      }
    }
  }
  const sandbox = {
    require: (name) => {
      if (name !== 'electron') throw new Error('unexpected require: ' + name)
      return electron
    },
    process: { argv: argv || [], platform: 'linux' },
    window: {
      addEventListener (type, fn, capture) {
        windowListeners[type] = { fn, capture }
      }
    },
    Date
  }
  vm.runInNewContext(fs.readFileSync(path.join(SRC, file), 'utf8'), sandbox, { filename: file })
  return { exposed, invoked, sent, listeners, windowListeners }
}

test('uygulama ön yüklemesi yalnızca dar API açar ve kanallar sabittir', async () => {
  const p = loadPreload('preload.js', ['electron', '--telsiz-version=2.0.0'])
  assert.deepEqual(Object.keys(p.exposed), ['telsizDesktop', 'telsizArkaPlan'])
  const api = p.exposed.telsizDesktop
  assert.deepEqual(Object.keys(api).sort(), ['addFrequency', 'changeServer', 'getServer', 'getSettings', 'listFrequencies', 'onPttHold', 'onShortcut', 'platform', 'removeFrequency', 'setCloseToTray', 'setFrequencyName', 'setPtt', 'setShortcuts', 'setVoiceActive', 'switchFrequency', 'titleBar', 'updates', 'version'])
  assert.deepEqual(Object.keys(api.updates).sort(), ['checkNow', 'getState', 'install', 'onState', 'openRelease', 'setEnabled'])
  assert.equal(api.version, '2.0.0')
  assert.equal(api.platform, 'linux')
  await api.getServer()
  await api.changeServer()
  await api.getSettings()
  await api.setShortcuts({ toggleMute: 'F9' })
  await api.setCloseToTray(true)
  await api.setCloseToTray('evet')
  assert.deepEqual(p.invoked, [
    [channels.CHANNELS.getServer],
    [channels.CHANNELS.changeServer],
    [channels.CHANNELS.getSettings],
    [channels.CHANNELS.setShortcuts, { toggleMute: 'F9' }],
    [channels.CHANNELS.setCloseToTray, true],
    [channels.CHANNELS.setCloseToTray, null]
  ])
  // Frekans çağrıları: türü yanlış girdiler ana sürece güvenli varsayılanla gider
  p.invoked.length = 0
  await api.listFrequencies('fazla')
  await api.switchFrequency('https://b.com')
  await api.switchFrequency({ toString: () => 'https://kotu.com' })
  await api.addFrequency(1)
  await api.removeFrequency('https://b.com', true)
  await api.removeFrequency('https://b.com', 'evet')
  await api.removeFrequency(5)
  await api.setFrequencyName('Kankalar')
  await api.setFrequencyName(['x'])
  assert.deepEqual(p.invoked, [
    [channels.CHANNELS.listFrequencies],
    [channels.CHANNELS.switchFrequency, 'https://b.com'],
    [channels.CHANNELS.switchFrequency, ''],
    [channels.CHANNELS.addFrequency],
    [channels.CHANNELS.removeFrequency, 'https://b.com', true],
    [channels.CHANNELS.removeFrequency, 'https://b.com', false],
    [channels.CHANNELS.removeFrequency, '', false],
    [channels.CHANNELS.setFrequencyName, 'Kankalar'],
    [channels.CHANNELS.setFrequencyName, '']
  ])
  const got = []
  const off = api.onShortcut((action) => got.push(action))
  assert.equal(typeof api.onShortcut('x'), 'function')
  const fire = p.listeners[channels.CHANNELS.shortcut]
  fire({ sender: 'gizli' }, 'toggleMute')
  fire({}, 'kotu')
  fire({}, { toString: () => 'toggleMute' })
  fire({}, 'toggleDeafen')
  fire({}, 'pttToggle')
  // Basılı tut olayları kısayol kanalından gelemez
  fire({}, 'start')
  off()
  fire({}, 'toggleMute')
  assert.deepEqual(got, ['toggleMute', 'toggleDeafen', 'pttToggle'])
})

test('başlık şeridi API: bilgi süzülür, renkler kısaltılır, menü isteği yalnızca tam sayı ve sonlu konumla gider', async () => {
  const p = loadPreload('preload.js', ['electron'])
  const api = p.exposed.telsizDesktop.titleBar
  assert.deepEqual(Object.keys(api).sort(), ['getInfo', 'onFullscreen', 'openMenu', 'setColors'])
  api.setColors('#0f1015', '#f2f1f8')
  api.setColors('#0f1015ffffff', { toString: () => '#ffffff' })
  const plain = (value) => JSON.parse(JSON.stringify(value))
  assert.deepEqual(plain(p.sent), [
    [channels.CHANNELS.titleBarColors, { color: '#0f1015', symbolColor: '#f2f1f8' }],
    [channels.CHANNELS.titleBarColors, { color: '#0f1015', symbolColor: '' }]
  ])
  await api.openMenu(1, 12.5, 32)
  await api.openMenu('1', NaN, Infinity)
  assert.deepEqual(plain(await api.getInfo()), { enabled: false, fullscreen: false, label: '', menus: [] })
  assert.deepEqual(plain(p.invoked), [
    [channels.CHANNELS.titleBarMenu, 1, 12.5, 32],
    [channels.CHANNELS.titleBarMenu, -1, -1, -1],
    [channels.CHANNELS.titleBarInfo]
  ])
  // Tam ekran olayı yalnızca true veya false ile iletilir, olay nesnesi verilmez
  const got = []
  const off = api.onFullscreen((value) => got.push(value))
  assert.equal(typeof api.onFullscreen('x'), 'function')
  const fire = p.listeners[channels.CHANNELS.titleBarFullscreen]
  fire({ sender: 'gizli' }, true)
  fire({}, 'evet')
  fire({}, 1)
  fire({}, false)
  off()
  fire({}, true)
  assert.deepEqual(got, [true, false])
})

test('bas konuş API: ayar alanları süzülür, ses odası durumu yalnızca true veya false, kanca olayları yalnızca start ve end', async () => {
  const p = loadPreload('preload.js', [])
  const api = p.exposed.telsizDesktop
  await api.setPtt({ mode: 'hold', holdKey: 'V', keycode: 47, fazla: { kotu: 1 } })
  await api.setPtt({ mode: 'toggle', holdKey: null })
  await api.setPtt({ mode: 'kanca', holdKey: 5 })
  await api.setPtt({ mode: 'hold' })
  await api.setPtt('hold')
  await api.setPtt(null)
  const plain = (value) => JSON.parse(JSON.stringify(value))
  assert.deepEqual(plain(p.invoked), [
    [channels.CHANNELS.setPtt, { mode: 'hold', holdKey: 'V' }],
    [channels.CHANNELS.setPtt, { mode: 'toggle', holdKey: null }],
    [channels.CHANNELS.setPtt, { mode: '', holdKey: false }],
    [channels.CHANNELS.setPtt, { mode: 'hold', holdKey: null }],
    [channels.CHANNELS.setPtt, { mode: '', holdKey: null }],
    [channels.CHANNELS.setPtt, { mode: '', holdKey: null }]
  ])
  api.setVoiceActive(true)
  api.setVoiceActive('evet')
  api.setVoiceActive({ channelId: 'x' })
  api.setVoiceActive(false)
  assert.deepEqual(p.sent, [
    [channels.CHANNELS.pttVoice, true],
    [channels.CHANNELS.pttVoice, false],
    [channels.CHANNELS.pttVoice, false],
    [channels.CHANNELS.pttVoice, false]
  ])
  const got = []
  const off = api.onPttHold(function () {
    got.push(Array.from(arguments))
  })
  assert.equal(typeof api.onPttHold('x'), 'function')
  const fire = p.listeners[channels.CHANNELS.pttHold]
  fire({ sender: 'gizli' }, 'start')
  fire({}, { keycode: 47 })
  fire({}, 47)
  fire({}, 'toggleMute')
  fire({}, 'end', { keycode: 47 })
  // Bir işleyicinin hatası diğerlerini durdurmaz
  const offBad = api.onPttHold(() => {
    throw new Error('sayfa hatası')
  })
  fire({}, 'start')
  offBad()
  off()
  fire({}, 'end')
  assert.deepEqual(got, [['start'], ['end'], ['start']])
})

test('güncelleme API: girdiler ve ana süreçten gelen durum doğrulanır', async () => {
  const p = loadPreload('preload.js', [])
  const api = p.exposed.telsizDesktop.updates
  await api.getState('fazla')
  await api.checkNow({ url: 'https://kotu.com' })
  await api.install('C:\\kotu.exe')
  await api.setEnabled(true)
  await api.setEnabled('evet')
  await api.openRelease('https://kotu.com')
  assert.deepEqual(p.invoked, [
    [channels.CHANNELS.updatesGet],
    [channels.CHANNELS.updatesCheck],
    [channels.CHANNELS.updatesInstall],
    [channels.CHANNELS.updatesSetAuto, true],
    [channels.CHANNELS.updatesSetAuto, null],
    [channels.CHANNELS.updatesOpenRelease]
  ])
  // Sahte ipcRenderer 'ok' döndürür: sonuç yine de güvenli biçime getirilir
  // vm içindeki nesnelerin prototipi farklıdır, karşılaştırma JSON kopyasıyla yapılır
  const plain = (value) => JSON.parse(JSON.stringify(value))
  assert.deepEqual(plain(await api.checkNow()), { ok: false })
  assert.deepEqual(plain(await api.getState()), { enabled: false, mode: 'notify', kind: 'other', current: '', status: 'idle', version: null, percent: null, lastCheckAt: null, error: null, canInstall: false })
  const got = []
  const off = api.onState((value) => got.push(value))
  assert.equal(typeof api.onState(5), 'function')
  const fire = p.listeners[channels.CHANNELS.updatesState]
  fire({ sender: 'gizli' }, { enabled: true, mode: 'auto', kind: 'nsis', current: '2.0.1', status: 'downloaded', version: '2.1.0', url: 'https://kotu.com', percent: 100, lastCheckAt: 5, error: null, canInstall: true, fazla: 'x' })
  fire({}, { enabled: 'evet', mode: 'kotu', kind: '<b>', current: '<script>', status: 'kotu', version: '2.1.0<', percent: 101.5, lastCheckAt: -1, error: 'kotu', canInstall: 1 })
  fire({}, null)
  off()
  fire({}, { status: 'checking' })
  assert.deepEqual(plain(got), [
    { enabled: true, mode: 'auto', kind: 'nsis', current: '2.0.1', status: 'downloaded', version: '2.1.0', percent: 100, lastCheckAt: 5, error: null, canInstall: true },
    { enabled: false, mode: 'notify', kind: 'other', current: '', status: 'idle', version: null, percent: null, lastCheckAt: null, error: null, canInstall: false },
    { enabled: false, mode: 'notify', kind: 'other', current: '', status: 'idle', version: null, percent: null, lastCheckAt: null, error: null, canInstall: false }
  ])
})

test('ön yüklemedeki güncelleme değerleri src/lib/updates.js ile aynıdır', () => {
  const updates = require('../src/lib/updates')
  const preload = fs.readFileSync(path.join(SRC, 'preload.js'), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(preload.includes("const UPDATE_STATUSES = ['" + updates.STATUSES.join("', '") + "']"))
  assert.ok(preload.includes("const UPDATE_ERRORS = ['" + updates.ERROR_CODES.join("', '") + "']"))
  for (const kind of ['nsis', 'appimage', 'portable', 'deb', 'dev', 'other']) assert.ok(preload.includes("'" + kind + "'"), kind)
})

test('uygulama ön yüklemesi yalnızca gerçek kullanıcı girişini bildirir', () => {
  const p = loadPreload('preload.js', [])
  assert.equal(p.exposed.telsizDesktop.version, '')
  assert.equal(p.windowListeners.pointerdown.capture, true)
  assert.equal(p.windowListeners.keydown.capture, true)
  p.windowListeners.keydown.fn({ isTrusted: false })
  assert.deepEqual(p.sent, [])
  p.windowListeners.pointerdown.fn({ isTrusted: true })
  p.windowListeners.keydown.fn({ isTrusted: true })
  assert.deepEqual(p.sent, [[channels.CHANNELS.userActivation]])
})

test('sürüm argümanı doğrulanır', () => {
  assert.equal(loadPreload('preload.js', ['--telsiz-version=2.0.0-beta.1']).exposed.telsizDesktop.version, '2.0.0-beta.1')
  assert.equal(loadPreload('preload.js', ['--telsiz-version=<b>']).exposed.telsizDesktop.version, '')
})

test('arka plan nesnesi: uygulama penceresinde yalnızca durum okuma ve abonelik, durum süzülür', async () => {
  const p = loadPreload('preload.js', ['--telsiz-version=2.0.0'])
  const bg = p.exposed.telsizArkaPlan
  assert.deepEqual(Object.keys(bg).sort(), ['background', 'getState', 'onState'])
  assert.equal(bg.background, false)
  await bg.getState()
  assert.deepEqual(p.invoked, [[channels.CHANNELS.bgGet]])
  const got = []
  const off = bg.onState((data) => got.push(data))
  assert.equal(typeof bg.onState(5), 'function')
  const fire = p.listeners[channels.CHANNELS.bgState]
  fire({ sender: 'gizli' }, {
    items: [
      { origin: 'https://a.com', active: false, state: 'ok', unread: 3, mention: 1, online: true, onlineUsers: 4, gizli: 'x', icon: 'data:image/png;base64,iVBORw0KGgo=' },
      { origin: 'javascript:alert(1)', state: 'ok', unread: 1 },
      { origin: 'https://b.com:8443', state: 'kotu', unread: -2, mention: 1.5, online: 'evet', icon: 'data:image/svg+xml;base64,PHN2Zz4=' },
      null
    ]
  })
  fire({}, 'bozuk')
  off()
  fire({}, { items: [{ origin: 'https://c.com', state: 'ok' }] })
  assert.deepEqual(JSON.parse(JSON.stringify(got)), [
    {
      items: [
        { origin: 'https://a.com', active: false, state: 'ok', unread: 3, mention: 1, online: true, onlineUsers: 4, icon: 'data:image/png;base64,iVBORw0KGgo=' },
        { origin: 'https://b.com:8443', active: false, state: null, unread: 0, mention: 0, online: null, onlineUsers: null, icon: null }
      ]
    },
    { items: [] }
  ])
})

test('arka plan penceresi: yalnızca ana sürecin argümanıyla, rapor bilinen alanlarla kopyalanır', async () => {
  const p = loadPreload('preload.js', ['--telsiz-version=2.0.0', '--telsiz-background=https://b.ornek.com:8443'])
  const bg = p.exposed.telsizArkaPlan
  assert.deepEqual(Object.keys(bg).sort(), ['background', 'open', 'origin', 'report'])
  assert.equal(bg.background, true)
  assert.equal(bg.origin, 'https://b.ornek.com:8443')
  bg.report({ origin: 'https://b.ornek.com:8443', state: 'ok', unread: 2, mention: 1, online: true, lastError: null, name: 'Bee', onlineUsers: 3, fazla: { kotu: 1 } })
  bg.report('bozuk')
  bg.report({ unread: '5', mention: -1, online: 'evet', state: 7 })
  await bg.open('https://kotu.com')
  assert.deepEqual(JSON.parse(JSON.stringify(p.sent)), [
    [channels.CHANNELS.bgReport, { origin: 'https://b.ornek.com:8443', state: 'ok', unread: 2, mention: 1, online: true, lastError: null, name: 'Bee', onlineUsers: 3 }],
    [channels.CHANNELS.bgReport, { origin: '', state: '', unread: null, mention: null, online: null, lastError: null, name: null, onlineUsers: null }],
    [channels.CHANNELS.bgReport, { origin: '', state: '', unread: null, mention: null, online: null, lastError: null, name: null, onlineUsers: null }]
  ])
  assert.deepEqual(p.invoked, [[channels.CHANNELS.bgOpen]])
  // Biçime uymayan köken: pencere yine arka plan kipindedir ama köken boştur (ana süreç raporu reddeder)
  const odd = loadPreload('preload.js', ['--telsiz-background=https://a.com/yol?x'])
  assert.equal(odd.exposed.telsizArkaPlan.background, true)
  assert.equal(odd.exposed.telsizArkaPlan.origin, '')
  assert.equal(loadPreload('preload.js', ['--telsiz-background=http://[::1]:4800']).exposed.telsizArkaPlan.origin, 'http://[::1]:4800')
})

test('sunucu adresi ve seçici ön yüklemeleri', async () => {
  const c = loadPreload('connect-preload.js')
  assert.deepEqual(Object.keys(c.exposed.telsizConnect).sort(), ['cancel', 'init', 'submit'])
  await c.exposed.telsizConnect.submit({ kotu: 1 }, 'evet')
  await c.exposed.telsizConnect.submit('https://a.com', true)
  assert.deepEqual(c.invoked, [[channels.CHANNELS.connectSubmit, '', false], [channels.CHANNELS.connectSubmit, 'https://a.com', true]])
  const s = loadPreload('picker-preload.js')
  assert.deepEqual(Object.keys(s.exposed.telsizPicker).sort(), ['cancel', 'choose', 'init'])
  await s.exposed.telsizPicker.choose(5, 1)
  await s.exposed.telsizPicker.choose('screen:0:0', true)
  assert.deepEqual(s.invoked, [[channels.CHANNELS.pickerChoose, '', false], [channels.CHANNELS.pickerChoose, 'screen:0:0', true]])
})

test('ön yüklemelerdeki sabitler src/lib/channels.js ile aynıdır', () => {
  for (const file of ['preload.js', 'connect-preload.js', 'picker-preload.js']) {
    const text = fs.readFileSync(path.join(SRC, file), 'utf8').replace(/\r\n/g, '\n')
    for (const match of text.matchAll(/(\w+): '(telsiz:[a-z-]+)'/g)) {
      assert.equal(channels.CHANNELS[match[1]], match[2], file + ' ' + match[1])
    }
  }
  const preload = fs.readFileSync(path.join(SRC, 'preload.js'), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(preload.includes("const ACTIONS = ['" + channels.ACTIONS.join("', '") + "']"))
  assert.ok(preload.includes("const HOLD_PHASES = ['" + channels.HOLD_PHASES.join("', '") + "']"))
  assert.ok(preload.includes("const PTT_MODES = ['" + require('../src/lib/shortcuts').PTT_MODES.join("', '") + "']"))
  assert.ok(preload.includes("const VERSION_ARG = '" + channels.VERSION_ARG + "'"))
  assert.ok(preload.includes("const BACKGROUND_ARG = '" + channels.BACKGROUND_ARG + "'"))
})

test('ana süreç sertleştirmeleri kaynakta bulunur', () => {
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8').replace(/\r\n/g, '\n')
  for (const needle of [
    'contextIsolation: true', 'sandbox: true', 'nodeIntegration: false', 'webSecurity: true',
    'allowRunningInsecureContent: false', 'spellcheck: false', 'webviewTag: false', 'devTools: IS_DEV',
    'app.enableSandbox()', "'will-attach-webview'", 'setWindowOpenHandler', "'will-navigate'",
    "'will-frame-navigate'", "'will-redirect'", 'setPermissionRequestHandler', 'setPermissionCheckHandler',
    'setDisplayMediaRequestHandler', 'setDevicePermissionHandler', "'certificate-error'", 'callback(false)',
    "'select-client-certificate'", 'requestSingleInstanceLock', 'registerSchemesAsPrivileged'
  ]) assert.ok(main.includes(needle), needle)
  assert.doesNotMatch(main, /bypassCSP|nodeIntegration: true|contextIsolation: false|sandbox: false|webSecurity: false/)
  // Şema ayrıcalıkları: service worker ve CSP atlatma yok
  const privileges = /privileges: (\{[^}]*\})/.exec(main)[1]
  assert.equal(privileges, '{ standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }')
  // Her IPC işleyicisi göndereni denetler
  const handlers = main.match(/ipcMain\.(handle|on)\(CHANNELS\.\w+, \([^)]*\) => \{\n\s+(requireSender|if \(senderIs)/g) || []
  const total = main.match(/ipcMain\.(handle|on)\(/g) || []
  assert.equal(handlers.length, total.length)
  assert.ok(total.length >= 22)
  // Güncelleme ve bas konuş kanallarının hepsi uygulama penceresine bağlıdır
  assert.match(main, /ipcMain\.on\(CHANNELS\.pttVoice, \(event, value\) => \{\n\s+if \(senderIs\(event, 'app'\) && typeof value === 'boolean'\)/)
  for (const name of ['updatesGet', 'updatesCheck', 'updatesInstall', 'updatesSetAuto', 'updatesOpenRelease', 'setPtt']) {
    assert.match(main, new RegExp('ipcMain\\.handle\\(CHANNELS\\.' + name + ', \\([^)]*\\) => \\{\\n\\s+requireSender\\(event, \'app\'\\)'), name)
  }
  // Sürüm sayfası yalnızca doğrulanmış adresle açılır, electron-updater yalnızca gerektiğinde yüklenir
  assert.ok(main.includes('updates.isReleasePageUrl(url)'))
  assert.ok(main.includes("loadUpdater: () => require('electron-updater').autoUpdater"))
  assert.doesNotMatch(main, /^const .*require\('electron-updater'\)/m)
})
