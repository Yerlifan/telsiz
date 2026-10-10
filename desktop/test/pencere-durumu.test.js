'use strict'

// Pencere durumu kanalı (telsiz:window-state): ana süreçteki olay eşlemesi (src/lib/window-state.js), ön
// yükleme betiğinin beyaz listesi ve ana süreçteki gönderen denetimi. Gerçek Electron ile davranış
// e2e/duman.test.js içinde denetlenir.

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
        return Promise.resolve('ok')
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
  return { exposed, invoked, listeners }
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
  // Dinlenmeyen olaylar hiçbir şey göndermez
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
