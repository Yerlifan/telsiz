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
  assert.deepEqual(Object.keys(p.exposed), ['telsizDesktop'])
  const api = p.exposed.telsizDesktop
  assert.deepEqual(Object.keys(api).sort(), ['changeServer', 'getServer', 'getSettings', 'onShortcut', 'platform', 'setCloseToTray', 'setShortcuts', 'version'])
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
  const got = []
  const off = api.onShortcut((action) => got.push(action))
  assert.equal(typeof api.onShortcut('x'), 'function')
  const fire = p.listeners[channels.CHANNELS.shortcut]
  fire({ sender: 'gizli' }, 'toggleMute')
  fire({}, 'kotu')
  fire({}, { toString: () => 'toggleMute' })
  fire({}, 'toggleDeafen')
  off()
  fire({}, 'toggleMute')
  assert.deepEqual(got, ['toggleMute', 'toggleDeafen'])
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
    const text = fs.readFileSync(path.join(SRC, file), 'utf8')
    for (const match of text.matchAll(/(\w+): '(telsiz:[a-z-]+)'/g)) {
      assert.equal(channels.CHANNELS[match[1]], match[2], file + ' ' + match[1])
    }
  }
  const preload = fs.readFileSync(path.join(SRC, 'preload.js'), 'utf8')
  assert.ok(preload.includes("const ACTIONS = ['" + channels.ACTIONS.join("', '") + "']"))
  assert.ok(preload.includes("const VERSION_ARG = '" + channels.VERSION_ARG + "'"))
})

test('ana süreç sertleştirmeleri kaynakta bulunur', () => {
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8')
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
  assert.ok(total.length >= 12)
})
