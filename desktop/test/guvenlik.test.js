'use strict'

// Güvenlik denetiminde bulunan sorunların gerileme testleri (masaüstü).
// Alt çerçeve gezinmesi: önceki kural bütün alt çerçeveleri engelliyordu, bu yüzden Telsiz DJ'nin YouTube
// oynatıcısı (public/dj/youtube.js, çapraz kökenli çerçeve) masaüstünde hiç yüklenmiyordu (Electron 44.5.1
// ile will-frame-navigate olayının iframe src atamasında da geldiği doğrulandı). Yeni kural yalnızca uygulama
// penceresinin ana çerçevesinin doğrudan alt çerçevesinde https://www.youtube-nocookie.com kökenine izin verir.
// Açılır pencere: YouTube çerçevesi kullanıcı hareketi olmadan window.open çağırabildiği için (Electron 44.5.1
// ile doğrulandı) bu çerçeveden gelen dış açma istekleri yalnızca YouTube adreslerine gider.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const nav = require('../src/lib/navigation')
const csp = require('../src/lib/csp')

const SRC = path.join(__dirname, '..', 'src')

test('alt çerçeve: yalnızca uygulama penceresinde, doğrudan alt çerçevede YouTube oynatıcısı', () => {
  const embed = 'https://www.youtube-nocookie.com/embed/abcdefghijk?enablejsapi=1&origin=telsiz%3A%2F%2Fapp'
  assert.equal(nav.decideFrameNavigation(embed, 'app', 1), 'allow')
  assert.equal(nav.decideFrameNavigation('https://www.youtube-nocookie.com/', 'app', 1), 'allow')
  const denied = [
    // Başka bağlamlar ve derinlikler
    [embed, 'connect', 1],
    [embed, 'picker', 1],
    [embed, undefined, 1],
    [embed, 'app', 0],
    [embed, 'app', 2],
    [embed, 'app', -1],
    // Başka kökenler ve şemalar
    ['http://www.youtube-nocookie.com/embed/abcdefghijk', 'app', 1],
    ['https://www.youtube.com/embed/abcdefghijk', 'app', 1],
    ['https://youtube-nocookie.com/embed/abcdefghijk', 'app', 1],
    ['https://www.youtube-nocookie.com.evil.example/embed/x', 'app', 1],
    ['https://www.youtube-nocookie.com:8443/embed/x', 'app', 1],
    ['https://user:pass@www.youtube-nocookie.com/embed/x', 'app', 1],
    ['telsiz://app/', 'app', 1],
    ['telsiz://app/api/state', 'app', 1],
    ['data:text/html,x', 'app', 1],
    ['javascript:alert(1)', 'app', 1],
    ['blob:telsiz://app/1', 'app', 1],
    ['about:blank', 'app', 1],
    ['file:///etc/passwd', 'app', 1],
    ['https://www.youtube-nocookie.com/' + 'a'.repeat(nav.MAX_EXTERNAL_URL), 'app', 1],
    ['', 'app', 1],
    [null, 'app', 1]
  ]
  for (const [url, context, depth] of denied) {
    assert.equal(nav.decideFrameNavigation(url, context, depth), 'deny', String(url) + ' ' + context + ' ' + depth)
  }
})

test('alt çerçeve kökeni sayfanın CSP frame-src değeriyle aynı', () => {
  const frameSrc = csp.HTML_DIRECTIVES.find((entry) => entry[0] === 'frame-src')
  assert.deepEqual(frameSrc, ['frame-src', 'https://' + nav.YOUTUBE_FRAME_HOST])
})

test('ana süreç alt çerçeve gezinmesini ve yönlendirmesini bu kuralla denetler', () => {
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8').replace(/\r\n/g, '\n')
  const frameNav = /contents\.on\('will-frame-navigate', \(details\) => \{\n([\s\S]*?)\n {4}\}\)/.exec(main)
  assert.ok(frameNav, 'will-frame-navigate işleyicisi bulunmalı')
  assert.match(frameNav[1], /if \(details\.isMainFrame\) return/)
  assert.match(frameNav[1], /navigation\.decideFrameNavigation\(details\.url, contextOf\(contents\), frameDepth\(details\.frame\)\) !== 'allow'\) details\.preventDefault\(\)/)
  const redirect = /contents\.on\('will-redirect', \(details\) => \{\n([\s\S]*?)\n {4}\}\)/.exec(main)
  assert.ok(redirect, 'will-redirect işleyicisi bulunmalı')
  assert.match(redirect[1], /navigation\.decideFrameNavigation\(details\.url, context, frameDepth\(details\.frame\)\)/)
  assert.match(redirect[1], /if \(decision !== 'allow'\) details\.preventDefault\(\)/)
})

test('açılır pencere: YouTube çerçevesinden yalnızca YouTube adresleri dış tarayıcıya gider', () => {
  const yt = 'https://www.youtube-nocookie.com/'
  assert.equal(nav.decideAppWindowOpen('https://www.youtube.com/watch?v=abcdefghijk', yt), 'external')
  assert.equal(nav.decideAppWindowOpen('https://youtu.be/abcdefghijk', 'https://www.youtube-nocookie.com/embed/abcdefghijk'), 'external')
  for (const url of ['https://reklam.example/tikla', 'https://www.youtube.com.evil.example/', 'https://youtube-nocookie.com/', 'http://www.youtube.com/watch?v=x', 'javascript:alert(1)']) {
    assert.equal(nav.decideAppWindowOpen(url, yt), 'deny', url)
  }
  // Uygulamanın kendi bağlantıları (yönlendiren yok veya telsiz://app) önceki kurala uyar
  assert.equal(nav.decideAppWindowOpen('https://github.com/Yerlifan/telsiz', ''), 'external')
  assert.equal(nav.decideAppWindowOpen('https://ornek.com/a', 'telsiz://app/'), 'external')
  assert.equal(nav.decideAppWindowOpen('http://ornek.com/', ''), 'deny')
  assert.equal(nav.decideAppWindowOpen('file:///etc/passwd', ''), 'deny')
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(main, /contextOf\(contents\) === 'app' && navigation\.decideAppWindowOpen\(details\.url, referrer\) === 'external'\) openExternal\(details\.url\)/)
})

// Yüzen pencere (istek 7): yeni pencere kuralının tek istisnası. YouTube çerçevesi kullanıcı hareketi olmadan da
// window.open çağırabildiği için istisna tek kullanımlık ada, uygulama penceresine ve about:blank adresine bağlıdır,
// açan pencere açıldıktan sonra yeniden denetlenir (did-create-window içinde webContents.opener).

function functionBody (source, signature) {
  const start = source.indexOf(signature)
  assert.ok(start !== -1, signature)
  return source.slice(start, source.indexOf('\n}\n', start)) + '\n}\n'
}

test('yeni pencere: tek izin yüzen pencere isteğidir, diğer her istek reddedilir', () => {
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8').replace(/\r\n/g, '\n')
  const handler = /contents\.setWindowOpenHandler\(\(details\) => \{\n([\s\S]*?)\n {4}\}\)/.exec(main)
  assert.ok(handler, 'setWindowOpenHandler bulunmalı')
  const lines = handler[1].split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('//'))
  assert.equal(lines[0], "if (isFloatOpen(contents, details)) return { action: 'allow', overrideBrowserWindowOptions: floatOpenOptions() }")
  assert.equal(lines[lines.length - 1], "return { action: 'deny' }")
  assert.equal((main.match(/action: 'allow'/g) || []).length, 1, 'başka izin yolu yok')
  const isFloat = functionBody(main, 'function isFloatOpen (contents, details) {')
  assert.match(isFloat, /context: contextOf\(contents\),\n\s+fromMain: isAlive\(state\.mainWindow\) && state\.mainWindow\.webContents === contents,\n\s+url: details\.url,\n\s+frameName: details\.frameName,\n\s+open: isAlive\(state\.floatWindow\)\n\s+\}, state\.floatGate\)/)
  // Ad yalnızca uygulama penceresine verilir
  assert.match(main, /ipcMain\.handle\(CHANNELS\.floatArm, \(event\) => \{\n\s+requireSender\(event, 'app'\)\n\s+return state\.floatGate\.arm\(\)\n\s+\}\)/)
  assert.match(main, /ipcMain\.handle\(CHANNELS\.floatShowMain, \(event\) => \{\n\s+requireSender\(event, 'app'\)/)
  // Açan yalnızca uygulama penceresinin sayfasında denetlenir, sayfa yenilenince ve pencere kapanınca yüzen pencere kapanır
  assert.equal((main.match(/'did-create-window'/g) || []).length, 1)
  assert.match(main, /win\.webContents\.on\('did-create-window', \(child, details\) => onFloatCreated\(win, child, details\)\)/)
  assert.ok((main.match(/closeFloatWindow\(win\)/g) || []).length >= 3)
})

// onFloatCreated gerçek kaynağından sahte pencerelerle çalıştırılır
function loadFloatCreated () {
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8').replace(/\r\n/g, '\n')
  const source = functionBody(main, 'function onFloatCreated (win, child, details) {') + functionBody(main, 'function closeFloatWindow (owner) {')
  const persisted = []
  const sandbox = {
    state: { mainWindow: null, floatWindow: null, floatOwner: null, contexts: new Map(), settings: { floatBounds: null } },
    floatWindow: require('../src/lib/float-window'),
    isAlive: (win) => Boolean(win) && !win.destroyed,
    diag: { log () {} },
    persistSettings: () => persisted.push(JSON.stringify(sandbox.state.settings.floatBounds)),
    JSON
  }
  require('node:vm').runInNewContext(source + 'this.onFloatCreated = onFloatCreated\nthis.closeFloatWindow = closeFloatWindow\n', sandbox)
  return { sandbox, persisted }
}

function fakeWindow (id, opener) {
  const { EventEmitter } = require('node:events')
  const win = new EventEmitter()
  win.calls = []
  win.destroyed = false
  win.bounds = { x: 10, y: 20, width: 300, height: 200 }
  win.webContents = new EventEmitter()
  win.webContents.id = id
  win.webContents.opener = opener
  win.webContents.mainFrame = { processId: id, routingId: 1 }
  for (const name of ['setMenu', 'setAlwaysOnTop', 'setVisibleOnAllWorkspaces', 'setContentProtection', 'showInactive']) {
    win[name] = (...args) => win.calls.push([name].concat(args))
  }
  win.isDestroyed = () => win.destroyed
  win.getBounds = () => win.bounds
  win.destroy = () => {
    win.calls.push(['destroy'])
    win.destroyed = true
    win.emit('closed')
  }
  // Sayfanın window.close() çağrısında olduğu gibi close olayı gelmeden kapanır
  win.close = () => {
    win.calls.push(['close'])
    win.destroyed = true
    win.emit('closed')
  }
  return win
}

test('yüzen pencere açılınca: açan alt çerçeveyse veya ad yanlışsa yok edilir, doğruysa üstte ve korumalı gösterilir', () => {
  const { sandbox, persisted } = loadFloatCreated()
  const main = fakeWindow(1, null)
  sandbox.state.mainWindow = main
  const token = require('../src/lib/float-window').createGate().arm()
  // Açan YouTube oynatıcısının çerçevesi (aynı süreçte başka çerçeve)
  const fromFrame = fakeWindow(2, { processId: 1, routingId: 7 })
  sandbox.onFloatCreated(main, fromFrame, { frameName: token })
  assert.deepEqual(fromFrame.calls, [['destroy']])
  // Açan bilinmiyor, ad yanlış veya pencere eski uygulama penceresine ait
  const noOpener = fakeWindow(3, null)
  sandbox.onFloatCreated(main, noOpener, { frameName: token })
  assert.deepEqual(noOpener.calls, [['destroy']])
  const badName = fakeWindow(4, main.webContents.mainFrame)
  sandbox.onFloatCreated(main, badName, { frameName: '_blank' })
  assert.deepEqual(badName.calls, [['destroy']])
  const oldMain = fakeWindow(9, null)
  const stale = fakeWindow(5, oldMain.webContents.mainFrame)
  sandbox.onFloatCreated(oldMain, stale, { frameName: token })
  assert.deepEqual(stale.calls, [['destroy']])
  assert.equal(sandbox.state.contexts.size, 0)
  // Doğru açan: bağlam float, her zaman üstte, bütün masaüstlerinde, ekran yakalamasından korunur, odak almadan
  const child = fakeWindow(6, { processId: 1, routingId: 1 })
  sandbox.onFloatCreated(main, child, { frameName: token })
  assert.deepEqual(child.calls, [['setMenu', null], ['setAlwaysOnTop', true, 'floating'], ['setVisibleOnAllWorkspaces', true], ['setContentProtection', true], ['showInactive']])
  assert.equal(sandbox.state.contexts.get(6), 'float')
  assert.equal(sandbox.state.floatWindow, child)
  // İkinci pencere açılamaz
  const second = fakeWindow(7, { processId: 1, routingId: 1 })
  sandbox.onFloatCreated(main, second, { frameName: token })
  assert.deepEqual(second.calls, [['destroy']])
  // Başka uygulama penceresinin kapanması bu pencereyi kapatmaz, kendi açanı kapatır. Konum saklanır.
  sandbox.closeFloatWindow(oldMain)
  assert.equal(sandbox.state.floatWindow, child)
  // Taşınan pencerenin konumu tutulur
  child.bounds = { x: 1500, y: 800, width: 360, height: 250 }
  child.emit('move')
  sandbox.closeFloatWindow(main)
  assert.deepEqual(child.calls.slice(-1), [['close']])
  assert.equal(sandbox.state.floatWindow, null)
  assert.equal(sandbox.state.contexts.size, 0)
  assert.deepEqual(persisted, [JSON.stringify({ x: 1500, y: 800, width: 360, height: 250 })])
})
