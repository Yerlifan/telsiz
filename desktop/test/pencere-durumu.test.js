'use strict'

// Pencere durumu (telsiz:window-state) ve boşta süresi (telsiz:idle-seconds) kanalları: ana süreçteki olay
// eşlemesi ve değer süzme (src/lib/window-state.js), ön yükleme betiğinin beyaz listesi ve ana süreçteki
// gönderen denetimi. Gerçek Electron ile davranış e2e/duman.test.js içinde denetlenir.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { EventEmitter } = require('node:events')
const channels = require('../src/lib/channels')
const windowState = require('../src/lib/window-state')

const SRC = path.join(__dirname, '..', 'src')

// Ön yükleme betiğini sahte electron modülüyle çalıştırır (preload.test.js içindeki düzeneğin kısa hâli)
function loadPreload (argv) {
  const exposed = {}
  const invoked = []
  const replies = []
  const listeners = {}
  const electron = {
    contextBridge: {
      exposeInMainWorld (name, api) {
        exposed[name] = api
      }
    },
    ipcRenderer: {
      invoke (channel, ...args) {
        invoked.push([channel].concat(args))
        return Promise.resolve(replies.length > 0 ? replies.shift() : 'ok')
      },
      send () {},
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
    window: { addEventListener () {} },
    Date
  }
  vm.runInNewContext(fs.readFileSync(path.join(SRC, 'preload.js'), 'utf8'), sandbox, { filename: 'preload.js' })
  return { exposed, invoked, replies, listeners }
}

function readMain () {
  return fs.readFileSync(path.join(SRC, 'main.js'), 'utf8').replace(/\r\n/g, '\n')
}

function functionBody (source, signature) {
  const start = source.indexOf(signature)
  assert.ok(start !== -1, signature)
  return source.slice(start, source.indexOf('\n}\n', start))
}

test('olay eşlemesi: dört pencere olayı dört değere, diğer olaylar hiçbir değere', () => {
  assert.deepEqual(Array.from(windowState.STATES), ['minimized', 'restored', 'hidden', 'shown'])
  assert.deepEqual(Object.assign({}, windowState.EVENTS), { minimize: 'minimized', restore: 'restored', hide: 'hidden', show: 'shown' })
  assert.ok(Object.isFrozen(windowState.STATES))
  assert.ok(Object.isFrozen(windowState.EVENTS))
  for (const [name, value] of Object.entries(windowState.EVENTS)) assert.equal(windowState.stateForEvent(name), value)
  for (const name of ['close', 'closed', 'focus', 'blur', 'maximize', 'unmaximize', 'enter-full-screen', 'ready-to-show', 'minimized', 'toString', 'constructor', '__proto__', 'hasOwnProperty', '', null, undefined, 5, {}]) {
    assert.equal(windowState.stateForEvent(name), null, String(name))
  }
  for (const value of windowState.STATES) assert.equal(windowState.isState(value), true)
  for (const value of ['minimize', 'Hidden', 'shown ', 'maximized', '', null, undefined, 1, ['shown'], { toString: () => 'shown' }]) {
    assert.equal(windowState.isState(value), false, String(value))
  }
})

test('bildirici: pencere olaylarını değere çevirir, olay nesnesi gitmez, art arda aynı değer bir kez gider', () => {
  const win = new EventEmitter()
  const sent = []
  const reporter = windowState.watch(win, function () {
    sent.push(Array.from(arguments))
  })
  assert.equal(reporter.current(), null)
  win.emit('show', { gizli: 'olay' })
  win.emit('minimize', { preventDefault () {} })
  win.emit('minimize')
  win.emit('restore')
  win.emit('hide')
  // Eşlenmeyen olaylar hiçbir şey göndermez. Dönüş olayları (focus, enter-full-screen) yalnızca son değer
  // 'minimized' iken bir şey gönderebilir, burada son değer 'restored'.
  for (const name of ['focus', 'blur', 'close', 'closed', 'maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.emit(name)
  win.emit('show')
  assert.deepEqual(sent, [['shown'], ['minimized'], ['restored'], ['hidden'], ['shown']])
  assert.equal(reporter.current(), 'shown')
  // Tepsiden dönüş (showMain): show olayı geldiyse ikinci kez gönderilmez, gelmediyse gönderilir
  assert.equal(reporter.report('shown'), false)
  win.emit('hide')
  assert.equal(reporter.report('shown'), true)
  win.emit('show')
  assert.deepEqual(sent.slice(5), [['hidden'], ['shown']])
  // Elle bildirimde de yalnızca beyaz listedeki değerler kabul edilir
  for (const value of ['maximized', 'minimize', '', null, { toString: () => 'hidden' }, ['hidden']]) {
    assert.equal(reporter.report(value), false, String(value))
  }
  assert.equal(sent.length, 7)
  assert.equal(reporter.current(), 'shown')
})

// Windows'ta tam ekrandaki pencere simge durumundan dönünce Electron restore yerine yalnızca enter-full-screen
// gönderir (Electron 44.5.1, shell/browser/native_window_views_win.cc HandleSizeEvent). Sayfa yine 'restored'
// almalı, yoksa son değer 'minimized' kalır ve sonraki küçültme de yinelenen değer olarak süzülür.
test('bildirici: restore gelmeden simge durumundan dönüş (tam ekrana dönüş, focus) restored olarak bildirilir', () => {
  assert.deepEqual(Array.from(windowState.RETURN_EVENTS), ['enter-full-screen', 'focus'])
  assert.ok(Object.isFrozen(windowState.RETURN_EVENTS))
  const win = new EventEmitter()
  let minimized = false
  win.isMinimized = () => minimized
  const sent = []
  const reporter = windowState.watch(win, (value) => sent.push(value))
  win.emit('show')
  // Son değer 'minimized' değilken tam ekrana giriş ve odak hiçbir şey göndermez
  win.emit('enter-full-screen')
  win.emit('focus')
  assert.deepEqual(sent, ['shown'])
  // Tam ekrandaki pencere küçültülür. Simge durumundaki pencereye odak veya tam ekran olayı gelse de pencere hâlâ
  // simge durumunda olduğu için bir şey gönderilmez
  minimized = true
  win.emit('minimize')
  win.emit('focus')
  win.emit('enter-full-screen')
  assert.deepEqual(sent, ['shown', 'minimized'])
  // Görev çubuğundan veya Alt+Tab ile dönüş: restore olayı gelmez, yalnızca enter-full-screen gelir
  minimized = false
  win.emit('enter-full-screen')
  assert.deepEqual(sent, ['shown', 'minimized', 'restored'])
  assert.equal(reporter.current(), 'restored')
  // Ardından restore veya odak gelse de değer ikinci kez gönderilmez
  win.emit('restore')
  win.emit('focus')
  assert.deepEqual(sent, ['shown', 'minimized', 'restored'])
  // Sonraki küçültme yeniden bildirilir, restore gelmeyen dönüşü odak yakalar
  minimized = true
  win.emit('minimize')
  minimized = false
  win.emit('focus')
  win.emit('enter-full-screen')
  assert.deepEqual(sent, ['shown', 'minimized', 'restored', 'minimized', 'restored'])
  // Tepsiye gizlenen pencerede odak 'restored' göndermez, dönüşü show bildirir
  minimized = true
  win.emit('minimize')
  win.emit('hide')
  minimized = false
  win.emit('focus')
  win.emit('show')
  assert.deepEqual(sent.slice(5), ['minimized', 'hidden', 'shown'])
  // isMinimized yöntemi olmayan pencerede dönüş olayı simge durumundan çıkış sayılır
  const plain = new EventEmitter()
  const plainSent = []
  windowState.watch(plain, (value) => plainSent.push(value))
  plain.emit('minimize')
  plain.emit('enter-full-screen')
  assert.deepEqual(plainSent, ['minimized', 'restored'])
})

test('ön yükleme: yalnızca beyaz listedeki değer sayfaya ulaşır, birden çok dinleyici olur, abonelikten çıkılır', () => {
  const p = loadPreload(['--telsiz-version=2.0.0'])
  const api = p.exposed.telsizDesktop
  assert.equal(typeof api.onWindowState, 'function')
  assert.equal(typeof api.onWindowState('x'), 'function')
  assert.equal(typeof api.onWindowState(null), 'function')
  const a = []
  const b = []
  const offA = api.onWindowState((value) => a.push(value))
  const offB = api.onWindowState(function () {
    b.push(Array.from(arguments))
  })
  // Bir dinleyicinin hatası diğerlerini durdurmaz
  const offBad = api.onWindowState(() => {
    throw new Error('sayfa hatası')
  })
  const fire = p.listeners[channels.CHANNELS.windowState]
  assert.equal(typeof fire, 'function')
  fire({ sender: 'gizli' }, 'minimized')
  for (const value of ['maximized', 'Hidden', 'hidden ', 'minimize', '', null, undefined, 1, true, ['hidden'], { toString: () => 'hidden' }]) fire({}, value)
  fire({}, 'hidden', { gizli: 'fazla' })
  offA()
  fire({}, 'shown')
  offBad()
  offB()
  fire({}, 'restored')
  assert.deepEqual(a, ['minimized', 'hidden'])
  assert.deepEqual(b, [['minimized'], ['hidden'], ['shown']])
  // Kanal yalnızca dinlenir, sayfa ana sürece bu kanaldan bir şey gönderemez
  assert.deepEqual(p.invoked, [])
})

test('ön yüklemedeki pencere durumları src/lib/window-state.js ile aynıdır', () => {
  const preload = fs.readFileSync(path.join(SRC, 'preload.js'), 'utf8').replace(/\r\n/g, '\n')
  assert.ok(preload.includes("const WINDOW_STATES = ['" + windowState.STATES.join("', '") + "']"))
  assert.ok(preload.includes("windowState: '" + channels.CHANNELS.windowState + "'"))
  assert.equal(channels.CHANNELS.windowState, 'telsiz:window-state')
})

test('ana süreç: durum yalnızca uygulama penceresinin sayfasına gider, tepsiden dönüşte shown bildirilir', () => {
  const main = readMain()
  const open = functionBody(main, 'function openMainWindow () {')
  assert.match(open, /state\.windowStates\.set\(win, windowState\.watch\(win, \(value\) => \{\n\s+if \(!win\.isDestroyed\(\) && !win\.webContents\.isDestroyed\(\)\) win\.webContents\.send\(CHANNELS\.windowState, value\)\n\s+\}\)\)/)
  // Kanal başka hiçbir yerde kullanılmaz: arka plan, sunucu adresi ve seçici pencerelerine gitmez
  assert.equal((main.match(/CHANNELS\.windowState\b/g) || []).length, 1)
  assert.equal((main.match(/windowState\.watch\(/g) || []).length, 1)
  // Sayfa bu kanala yazamaz: ana süreçte dinleyicisi yoktur
  assert.doesNotMatch(main, /ipcMain\.(handle|on)\(CHANNELS\.windowState/)
  const show = functionBody(main, 'function showMain () {')
  assert.match(show, /win\.show\(\)\n\s+win\.focus\(\)\n[\s\S]*const reporter = state\.windowStates\.get\(win\)\n\s+if \(reporter\) reporter\.report\('shown'\)/)
  // Tepsiye kapatma pencereyi gizler (hide olayı 'hidden' olur)
  assert.match(open, /if \(state\.settings\.closeToTray && state\.tray\) \{\n\s+event\.preventDefault\(\)\n\s+win\.hide\(\)/)
})

// Ana sürece giden değerler ve beklenen tam saniye (süzme kuralı ön yüklemede ve ana süreçte aynı)
const IDLE_CASES = [
  [0, 0],
  [12, 12],
  [12.9, 12],
  [59.999, 59],
  [86400 * 30, 86400 * 30],
  [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  [-1, 0],
  [-0.5, 0],
  [NaN, 0],
  [Infinity, 0],
  [-Infinity, 0],
  [1e300, 0],
  ['30', 0],
  [null, 0],
  [undefined, 0],
  [true, 0],
  [{ valueOf: () => 30 }, 0],
  [[30], 0]
]

test('boşta süresi: değer negatif olmayan tam saniyeye getirilir, bilinmeyen süre 0', () => {
  for (const [raw, expected] of IDLE_CASES) assert.equal(windowState.cleanIdleSeconds(raw), expected, String(raw))
})

test('ön yükleme: idleSeconds uygulama ve arka plan nesnelerinde, sayfa argüman geçiremez, sonuç süzülür', async () => {
  const p = loadPreload(['--telsiz-version=2.0.0'])
  const api = p.exposed.telsizDesktop
  for (const [raw, expected] of IDLE_CASES) {
    p.replies.push(raw)
    assert.equal(await api.idleSeconds('fazla', { kotu: 1 }), expected, String(raw))
  }
  assert.deepEqual(p.invoked, IDLE_CASES.map(() => [channels.CHANNELS.idleSeconds]))
  // Uygulama penceresindeki arka plan nesnesi
  p.invoked.length = 0
  p.replies.push(42.7)
  assert.equal(await p.exposed.telsizArkaPlan.idleSeconds(), 42)
  assert.deepEqual(p.invoked, [[channels.CHANNELS.idleSeconds]])
  // Arka plan penceresi (ana sürecin argümanıyla)
  const bg = loadPreload(['--telsiz-version=2.0.0', '--telsiz-background=https://b.ornek.com'])
  assert.equal(bg.exposed.telsizArkaPlan.background, true)
  bg.replies.push(7)
  bg.replies.push('7')
  assert.equal(await bg.exposed.telsizArkaPlan.idleSeconds(), 7)
  assert.equal(await bg.exposed.telsizArkaPlan.idleSeconds(1), 0)
  assert.deepEqual(bg.invoked, [[channels.CHANNELS.idleSeconds], [channels.CHANNELS.idleSeconds]])
})

test('ana süreç: boşta süresi yalnızca uygulama ve arka plan pencerelerine açık, powerMonitor değeri süzülür', () => {
  const main = readMain()
  assert.match(main, /ipcMain\.handle\(CHANNELS\.idleSeconds, \(event\) => \{\n\s+requireSender\(event, 'app', 'background'\)\n\s+return systemIdleSeconds\(\)\n\s+\}\)/)
  assert.equal((main.match(/CHANNELS\.idleSeconds\b/g) || []).length, 1)
  const idle = functionBody(main, 'function systemIdleSeconds () {')
  assert.match(idle, /return windowState\.cleanIdleSeconds\(powerMonitor\.getSystemIdleTime\(\)\)/)
  assert.match(idle, /return 0\n\s+\}/)
  assert.equal((main.match(/powerMonitor\.\w+/g) || []).join(), 'powerMonitor.getSystemIdleTime')
})

test('gönderen denetimi: requireSender verilen bağlamlardan birini ister, başka pencereyi reddeder', () => {
  const main = readMain()
  const source = functionBody(main, 'function requireSender (event, ...contexts) {') + '\n}\n'
  // senderIs yerine bağlamı olaydan okuyan sahte işlev (asıl senderIs pencereyi, ana çerçeveyi ve kökeni denetler)
  const sandbox = { senderIs: (event, context) => event.context === context }
  vm.runInNewContext(source + 'this.requireSender = requireSender\n', sandbox)
  const { requireSender } = sandbox
  assert.doesNotThrow(() => requireSender({ context: 'app' }, 'app', 'background'))
  assert.doesNotThrow(() => requireSender({ context: 'background' }, 'app', 'background'))
  for (const context of ['connect', 'picker', 'float', undefined, null, '']) {
    assert.throws(() => requireSender({ context }, 'app', 'background'), /forbidden/, String(context))
  }
  assert.throws(() => requireSender({ context: 'background' }, 'app'), /forbidden/)
  assert.throws(() => requireSender({ context: 'app' }), /forbidden/, 'bağlam verilmezse her çağrı reddedilir')
})
