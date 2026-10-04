'use strict'

// Masaüstü uygulamasının duman testi (Playwright _electron, Linux'ta xvfb altında).
// Yerel bir Telsiz sunucusu başlatılır, uygulama boş bir kullanıcı verisi klasörüyle açılır,
// sunucu adresi ekranından adres girilir ve şunlar doğrulanır:
// - giriş ekranı paketlenmiş koddan gelir (sunucu hiçbir statik dosya isteği almaz)
// - kayıt, mesaj, long-poll, yükleme ve indirme API'ları ana süreçteki vekil üzerinden çalışır,
//   X-Token ve Accept-Language iletilir
// - sayfada Node.js yoktur, yalnızca dar telsizDesktop API'si vardır, CSP satır içi betiği ve
//   sunucuya doğrudan bağlantıyı engeller, service worker kaydedilemez
// - şema dışı gezinme ve yeni pencere engellenir, https bağlantılar dış tarayıcıya verilir
// - izinler: mikrofon var, kamera ve kullanıcı girişsiz ekran yakalama yok
// - ekran paylaşımı seçicisi gerçek kullanıcı girişiyle açılır, seçim ve vazgeçme çalışır
// - genel kısayol olayları yalnızca izinli eylemlerle sayfaya ulaşır
//
// Varsayılan olarak geliştirme düzenindeki uygulama (node_modules/electron ile desktop/) açılır.
// TELSIZ_UYGULAMA ortam değişkeni paketlenmiş yürütülebilir dosyayı gösterirse (ör.
// dist/linux-unpacked/telsiz-masaustu) test onunla yapılır. Önce npm run hazirla çalıştırılmalıdır.
// Kullanım: npm run test:duman (Linux'ta: xvfb-run -a npm run test:duman)

const { test, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { _electron: electron } = require('playwright')
const { createChatServer } = require('../../src/app')
const yardimci = require('../../test/server-yardimci')
const { listenInRange, sleep } = require('../test/yardimci')

const DESKTOP_DIR = path.join(__dirname, '..')
const RESULTS_DIR = path.join(DESKTOP_DIR, 'duman-sonuclar')
const TIMEOUT = 30000

const ctx = { server: null, port: 0, root: null, app: null, page: null, requests: [], token: null, channelId: null }

async function waitFor (check, label, timeout) {
  const end = Date.now() + (timeout || TIMEOUT)
  while (Date.now() < end) {
    const value = await check()
    if (value) return value
    await sleep(50)
  }
  throw new Error('Timed out: ' + label)
}

// Sayfadan XMLHttpRequest (istemcinin kullandığı yol) ile istek
function xhr (page, method, url, opts) {
  return page.evaluate((args) => new Promise((resolve) => {
    const o = args.opts || {}
    const x = new XMLHttpRequest()
    x.open(args.method, args.url)
    if (o.token) x.setRequestHeader('X-Token', o.token)
    if (o.lang) x.setRequestHeader('Accept-Language', o.lang)
    let body = null
    if (o.json !== undefined) {
      x.setRequestHeader('Content-Type', 'application/json')
      body = JSON.stringify(o.json)
    }
    x.onload = () => {
      let data = null
      try {
        data = JSON.parse(x.responseText)
      } catch (err) {
        data = null
      }
      resolve({ status: x.status, text: x.responseText, data, type: x.getResponseHeader('content-type'), csp: x.getResponseHeader('content-security-policy') })
    }
    x.onerror = () => resolve({ status: 0, error: true })
    x.send(body)
  }), { method, url, opts })
}

// Sunucuya doğrudan (vekilsiz) istek, long-poll testinde karşı tarafı oynamak için
function direct (method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body))
    const headers = { 'content-type': 'application/json' }
    if (token) headers['x-token'] = token
    if (payload) headers['content-length'] = String(payload.length)
    const req = http.request({ host: '127.0.0.1', port: ctx.port, method, path: urlPath, headers, agent: false }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') }))
    })
    req.on('error', reject)
    req.end(payload)
  })
}

function launchOptions (userDataDir) {
  const packaged = process.env.TELSIZ_UYGULAMA
  const common = ['--user-data-dir=' + userDataDir, '--use-fake-device-for-media-stream', '--lang=tr']
  const executablePath = packaged ? path.resolve(packaged) : require(path.join(DESKTOP_DIR, 'node_modules', 'electron'))
  return {
    executablePath,
    args: packaged ? common : [DESKTOP_DIR].concat(common),
    // Linux'ta Playwright varsayılan olarak --no-sandbox ekler, uygulama korumalı alanla denenmelidir
    chromiumSandbox: true,
    env: Object.assign({}, process.env, { ELECTRON_ENABLE_LOGGING: '1' }),
    timeout: 60000
  }
}

async function windowWithUrl (prefix) {
  return waitFor(() => ctx.app.windows().find((page) => page.url().startsWith(prefix)), 'window ' + prefix)
}

before(async () => {
  ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-duman-'))
  ctx.server = await createChatServer({
    dataDir: path.join(ctx.root, 'veri'),
    setupCode: yardimci.SETUP_CODE,
    scryptN: 1024,
    pollTimeoutMs: 8000,
    authLimit: 100000,
    messageLimit: 100000,
    uploadLimit: 100000,
    log: null
  })
  ctx.server.on('request', (req) => {
    ctx.requests.push(req.method + ' ' + String(req.url).split('?')[0])
  })
  ctx.port = await listenInRange(ctx.server)
  const userData = path.join(ctx.root, 'kullanici-verisi')
  fs.mkdirSync(userData, { recursive: true })
  ctx.app = await electron.launch(launchOptions(userData))
  ctx.app.process().stderr.on('data', (chunk) => {
    const text = String(chunk)
    if (/\[telsiz\]/.test(text)) process.stderr.write(text)
  })
})

after(async () => {
  if (ctx.app) {
    if (process.exitCode && ctx.page) {
      fs.mkdirSync(RESULTS_DIR, { recursive: true })
      await ctx.page.screenshot({ path: path.join(RESULTS_DIR, 'uygulama.png') }).catch(() => {})
    }
    await ctx.app.close().catch(() => {})
  }
  if (ctx.server) await new Promise((resolve) => ctx.server.close(() => resolve()))
  if (ctx.root) fs.rmSync(ctx.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
})

test('ilk açılışta sunucu adresi ekranı gelir, adres doğrulanır ve uygulama açılır', { timeout: 90000 }, async () => {
  const connect = await windowWithUrl('telsiz://baglan/')
  await connect.waitForSelector('#submit:not(:empty)')
  assert.deepEqual(await connect.evaluate(() => Object.keys(window.telsizConnect).sort()), ['cancel', 'init', 'submit'])
  assert.equal(await connect.evaluate(() => typeof window.require + typeof window.process), 'undefinedundefined')
  assert.equal(await connect.isHidden('#cancel'), true)

  // Uzak http adresi reddedilir
  await connect.fill('#address', 'http://ornek.com')
  await connect.click('#submit')
  await connect.waitForSelector('#status.is-error')

  const opened = ctx.app.waitForEvent('window', { predicate: (page) => page.url().startsWith('telsiz://app/'), timeout: TIMEOUT }).catch(() => null)
  await connect.fill('#address', 'http://127.0.0.1:' + ctx.port)
  await connect.click('#submit')
  ctx.page = (await opened) || await windowWithUrl('telsiz://app/')
  await ctx.page.waitForLoadState('domcontentloaded')
  assert.equal(ctx.page.url(), 'telsiz://app/')
  await waitFor(() => ctx.requests.includes('GET /api/info') && ctx.requests.filter((r) => r === 'GET /api/info').length >= 2, 'GET /api/info from the app')
  await waitFor(() => ctx.page.evaluate(() => Boolean(window.I18N) && typeof window.I18N.t === 'function'), 'bundled i18n.js')
})

test('arayüz paketlenmiş koddan gelir, sunucu statik dosya isteği almaz', async () => {
  const statics = ctx.requests.filter((r) => !/^[A-Z]+ \/api(\/|$)/.test(r))
  assert.deepEqual(statics, [])
  const index = await xhr(ctx.page, 'GET', '/index.html')
  assert.equal(index.status, 200)
  assert.match(index.csp, /connect-src 'self'/)
  for (const blocked of ['/sw.js', '/manifest.webmanifest', '/butunluk.json', '/js/../../package.json', '/src/main.js', '/%2e%2e/package.json']) {
    assert.equal((await xhr(ctx.page, 'GET', blocked)).status, 404, blocked)
  }
})

test('sayfada Node.js yoktur, yalnızca dar masaüstü API vardır', async () => {
  const page = ctx.page
  assert.equal(await page.evaluate(() => [typeof window.require, typeof window.process, typeof window.module, typeof window.Buffer].join()), 'undefined,undefined,undefined,undefined')
  assert.deepEqual(await page.evaluate(() => Object.keys(window.telsizDesktop).sort()), ['changeServer', 'getServer', 'getSettings', 'onShortcut', 'platform', 'setCloseToTray', 'setShortcuts', 'version'])
  assert.equal(await page.evaluate(() => window.telsizDesktop.getServer()), 'http://127.0.0.1:' + ctx.port)
  assert.match(await page.evaluate(() => window.telsizDesktop.version), /^\d+\.\d+\.\d+/)
  // Paketlenmiş uygulamada geliştirici araçları açılamaz
  const packaged = await ctx.app.evaluate(({ app }) => app.isPackaged)
  if (packaged) {
    const devtools = await ctx.app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('telsiz://app/'))
      win.webContents.openDevTools({ mode: 'detach' })
      await new Promise((resolve) => setTimeout(resolve, 1000))
      return win.webContents.isDevToolsOpened()
    })
    assert.equal(devtools, false)
  }
})

test('kayıt, mesaj, long-poll, yükleme ve indirme vekil üzerinden çalışır', { timeout: 60000 }, async () => {
  const page = ctx.page
  const info = await xhr(page, 'GET', '/api/info')
  assert.equal(info.status, 200)
  assert.equal(info.data.setupRequired, true)
  assert.match(info.csp, /sandbox/)

  const register = await xhr(page, 'POST', '/api/register', { json: yardimci.registerBody('kurucu', { setupCode: yardimci.SETUP_CODE }) })
  assert.equal(register.status, 200, register.text)
  ctx.token = register.data.token
  assert.equal(typeof ctx.token, 'string')

  assert.equal((await xhr(page, 'GET', '/api/state')).status, 401)
  const state = await xhr(page, 'GET', '/api/state', { token: ctx.token })
  assert.equal(state.status, 200)
  const channel = state.data.meta.channels.find((c) => c.type === 'text')
  ctx.channelId = channel.id

  const sent = await xhr(page, 'POST', '/api/messages', { token: ctx.token, json: { channelId: ctx.channelId, body: yardimci.envelope() } })
  assert.equal(sent.status, 200, sent.text)
  const list = await xhr(page, 'GET', '/api/messages?channel=' + ctx.channelId, { token: ctx.token })
  assert.equal(list.status, 200)
  assert.ok(list.data.messages.some((m) => m.id === sent.data.message.id))

  // Accept-Language iletilir: aynı hata iki dilde farklı metinle döner
  const trError = await xhr(page, 'POST', '/api/messages', { token: ctx.token, lang: 'tr', json: { channelId: ctx.channelId, body: 'x' } })
  const enError = await xhr(page, 'POST', '/api/messages', { token: ctx.token, lang: 'en', json: { channelId: ctx.channelId, body: 'x' } })
  assert.equal(trError.status, 400)
  assert.equal(enError.status, 400)
  assert.notEqual(trError.data.error, enError.data.error)

  // Long-poll: sayfa bekler, başka bir istemci (doğrudan sunucuya) mesaj gönderir
  const st = state.data
  const pollUrl = '/api/poll?since=' + st.seq + '&mv=' + st.metaVersion + '&pmv=' + st.pmv + '&tv=' + st.tv + '&sig=' + st.sigSeq + '&boot=' + st.boot
  const pending = xhr(page, 'GET', pollUrl, { token: ctx.token })
  await sleep(500)
  const other = await direct('POST', '/api/messages', ctx.token, { channelId: ctx.channelId, body: yardimci.envelope() })
  assert.equal(other.status, 200)
  const polled = await pending
  assert.equal(polled.status, 200, polled.text)
  assert.ok(JSON.stringify(polled.data).includes(String(other.data.message.id)))

  // Yükleme ve indirme (ikili gövde iki yönde de akış olarak geçer)
  const roundTrip = await page.evaluate((token) => new Promise((resolve) => {
    const size = 300 * 1024 + 17
    const bytes = new Uint8Array(size)
    for (const i of bytes.keys()) bytes[i] = (i * 31 + 7) & 0xff
    const up = new XMLHttpRequest()
    up.open('POST', '/api/uploads')
    up.setRequestHeader('X-Token', token)
    up.setRequestHeader('Content-Type', 'application/octet-stream')
    up.onload = () => {
      const result = JSON.parse(up.responseText)
      const down = new XMLHttpRequest()
      down.open('GET', '/api/uploads/' + result.id)
      down.setRequestHeader('X-Token', token)
      down.responseType = 'arraybuffer'
      let computable = false
      down.onprogress = (e) => {
        if (e.lengthComputable) computable = true
      }
      down.onload = () => {
        const got = new Uint8Array(down.response)
        const same = got.length === size && got.every((b, i) => b === bytes[i])
        resolve({ upload: up.status, size: result.size, download: down.status, same, computable, type: down.getResponseHeader('content-type') })
      }
      down.onerror = () => resolve({ error: 'download' })
      down.send()
    }
    up.onerror = () => resolve({ error: 'upload' })
    up.send(bytes)
  }), ctx.token)
  assert.equal(roundTrip.upload, 200)
  assert.equal(roundTrip.size, 300 * 1024 + 17)
  assert.equal(roundTrip.download, 200)
  assert.equal(roundTrip.same, true)
  assert.equal(roundTrip.computable, true)
  assert.equal(roundTrip.type, 'application/octet-stream')
})

test('CSP satır içi betiği ve sunucuya doğrudan bağlantıyı engeller, service worker yok', async () => {
  const page = ctx.page
  const inline = await page.evaluate(() => {
    const s = document.createElement('script')
    s.textContent = 'window.__satirIci = 1'
    document.body.appendChild(s)
    return window.__satirIci === undefined
  })
  assert.equal(inline, true)
  const directXhr = await xhr(page, 'GET', 'http://127.0.0.1:' + ctx.port + '/api/info')
  assert.equal(directXhr.status, 0)
  const sw = await page.evaluate(() => {
    if (!navigator.serviceWorker) return 'none'
    return navigator.serviceWorker.register('/sw.js').then(() => 'registered', () => 'rejected')
  })
  assert.notEqual(sw, 'registered')
})

test('şema dışı gezinme ve yeni pencere engellenir, https bağlantılar dış tarayıcıya gider', async () => {
  const page = ctx.page
  await ctx.app.evaluate(({ shell }) => {
    global.__acilanlar = []
    shell.openExternal = (url) => {
      global.__acilanlar.push(url)
      return Promise.resolve()
    }
  })
  const before = ctx.app.windows().length
  for (const target of ['http://127.0.0.1:' + ctx.port + '/', 'file:///etc/passwd', '/api/info', 'telsiz://baglan/', 'javascript:void(0)']) {
    await page.evaluate((url) => {
      window.location.href = url
    }, target).catch(() => {})
    await sleep(400)
    assert.equal(page.url(), 'telsiz://app/', target)
  }
  assert.equal(await page.evaluate(() => window.open('http://ornek.com/') === null), true)
  await page.evaluate(() => window.open('https://ornek.com/a'))
  // Ana süreç dış açmaları yarım saniyede bire sınırlar
  await sleep(700)
  await page.evaluate(() => {
    window.location.href = 'https://ornek.com/b'
  }).catch(() => {})
  await sleep(500)
  assert.equal(page.url(), 'telsiz://app/')
  assert.equal(ctx.app.windows().length, before)
  const opened = await ctx.app.evaluate(() => global.__acilanlar)
  assert.deepEqual(opened, ['https://ornek.com/a', 'https://ornek.com/b'])
})

test('izinler: mikrofon var, kamera ve kullanıcı girişsiz ekran yakalama yok', async () => {
  const page = ctx.page
  const gum = (constraints) => page.evaluate((c) => navigator.mediaDevices.getUserMedia(c).then((s) => {
    s.getTracks().forEach((track) => track.stop())
    return 'ok'
  }, (e) => e.name), constraints)
  assert.equal(await gum({ audio: true }), 'ok')
  assert.equal(await gum({ video: true }), 'NotAllowedError')
  // Eski masaüstü yakalama yolu seçicisiz ekran yakalayamaz
  assert.equal(await gum({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop' } } }), 'NotAllowedError')
  assert.equal(await page.evaluate(() => window.Notification.permission), 'granted')
  const geo = await page.evaluate(() => navigator.permissions.query({ name: 'geolocation' }).then((r) => r.state, (e) => e.name))
  assert.notEqual(geo, 'granted')
})

test('ekran paylaşımı seçicisi kullanıcı girişiyle açılır, vazgeçme ve seçim çalışır', { timeout: 60000 }, async (t) => {
  const page = ctx.page
  const sources = await ctx.app.evaluate(({ desktopCapturer }) => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }).then((list) => list.length, () => 0))
  if (sources === 0) {
    t.skip('Bu ortamda desktopCapturer ekran kaynağı vermiyor')
    return
  }
  const share = () => page.evaluate(() => navigator.mediaDevices.getDisplayMedia({ video: true, audio: false }).then((s) => {
    const labels = s.getVideoTracks().map((track) => track.kind)
    s.getTracks().forEach((track) => track.stop())
    return labels.join()
  }, (e) => 'rejected:' + e.name))

  // Vazgeç
  await page.mouse.click(5, 5)
  let pickerOpened = ctx.app.waitForEvent('window', { predicate: (p) => p.url().startsWith('telsiz://secici/'), timeout: TIMEOUT })
  let result = share()
  let picker = await pickerOpened
  await picker.waitForSelector('#cancel:not(:empty)')
  assert.deepEqual(await picker.evaluate(() => Object.keys(window.telsizPicker).sort()), ['cancel', 'choose', 'init'])
  await picker.click('#cancel')
  assert.match(await result, /^rejected:/)

  // Seç ve paylaş
  await page.mouse.click(5, 5)
  pickerOpened = ctx.app.waitForEvent('window', { predicate: (p) => p.url().startsWith('telsiz://secici/'), timeout: TIMEOUT })
  result = share()
  picker = await pickerOpened
  await picker.waitForSelector('.source')
  // Sunulmayan bir kimlik ana süreçte reddedilir
  assert.deepEqual(await picker.evaluate(() => window.telsizPicker.choose('screen:999999:0', false)), { ok: false })
  await picker.click('.source')
  await picker.click('#share')
  const shared = await result
  // Windows test makinesinin masaüstü oturumu yakalama aygıtını açamayabilir: seçim ve izin
  // akışı yine doğrulanmış olur, aygıt hatası kabul edilir. Linux'ta (xvfb) yakalama gerçekten çalışır.
  if (process.platform === 'win32' && shared === 'rejected:NotReadableError') return
  assert.equal(shared, 'video')
})

test('genel kısayol ayarları doğrulanır, olaylar yalnızca izinli eylemlerle gelir', async () => {
  const page = ctx.page
  assert.deepEqual(await page.evaluate(() => window.telsizDesktop.setShortcuts({ toggleMute: 'A' })), { ok: false, code: 'invalid' })
  assert.deepEqual(await page.evaluate(() => window.telsizDesktop.setShortcuts({ toggleMute: 'Ctrl+Shift+F11', toggleDeafen: 'Ctrl+Shift+F11' })), { ok: false, code: 'duplicate' })
  assert.deepEqual(await page.evaluate(() => window.telsizDesktop.setShortcuts({ evil: 'F9' })), { ok: false, code: 'invalid' })
  const saved = await page.evaluate(() => window.telsizDesktop.setShortcuts({ toggleMute: 'ctrl+shift+f11', toggleDeafen: null }))
  assert.equal(saved.ok, true)
  assert.equal(saved.shortcuts.toggleMute, 'CommandOrControl+Shift+F11')
  assert.equal(saved.shortcuts.toggleDeafen, null)
  assert.equal(typeof saved.registered.toggleMute, 'boolean')
  assert.deepEqual(await page.evaluate(() => window.telsizDesktop.setCloseToTray('evet')), { ok: false, code: 'invalid' })

  await page.evaluate(() => {
    window.__kisayollar = []
    window.telsizDesktop.onShortcut((action) => window.__kisayollar.push(action))
  })
  await ctx.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('telsiz://app/'))
    win.webContents.send('telsiz:shortcut', 'evil')
    win.webContents.send('telsiz:shortcut', 'toggleDeafen')
  })
  await waitFor(() => page.evaluate(() => window.__kisayollar.length > 0), 'shortcut event')
  assert.deepEqual(await page.evaluate(() => window.__kisayollar), ['toggleDeafen'])
})

test('web tarafı (js/20-desktop.js) masaüstünde etkinleşir ve ayar bölümünü çizer', async () => {
  const page = ctx.page
  const loaded = await page.evaluate(() => Boolean(window.TelsizDesktopUI))
  if (!loaded) await page.addScriptTag({ url: '/js/20-desktop.js' })
  const result = await page.evaluate(async () => {
    const ui = window.TelsizDesktopUI
    const box = document.createElement('div')
    document.body.appendChild(box)
    const rendered = ui.renderShortcutSettings(box)
    await new Promise((resolve) => setTimeout(resolve, 300))
    const app = document.createElement('div')
    document.body.appendChild(app)
    const renderedApp = ui.renderAppSettings(app)
    await new Promise((resolve) => setTimeout(resolve, 300))
    return { active: ui.active, rendered, renderedApp, buttons: box.querySelectorAll('button').length, keys: Array.from(box.querySelectorAll('kbd')).map((k) => k.textContent), appButtons: app.querySelectorAll('button').length, desktopAttr: document.documentElement.getAttribute('data-desktop') }
  })
  assert.equal(result.active, true)
  assert.equal(result.rendered, true)
  assert.equal(result.renderedApp, true)
  assert.ok(result.buttons >= 4)
  assert.ok(result.keys.includes('Ctrl+Shift+F11'))
  assert.ok(result.appButtons >= 1)
  assert.equal(result.desktopAttr, '1')
})

test('sayfanın ürettiği blob dosyası kaydedilebilir, başka indirmeler engellenir', async () => {
  const target = path.join(ctx.root, 'indirilen.bin')
  await ctx.app.evaluate(({ BrowserWindow }, file) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('telsiz://app/'))
    global.__indirmeler = []
    win.webContents.session.on('will-download', (event, item) => {
      global.__indirmeler.push({ url: item.getURL(), prevented: event.defaultPrevented })
      if (!event.defaultPrevented) item.setSavePath(file)
    })
  }, target)
  await ctx.page.evaluate(() => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'application/octet-stream' }))
    a.download = 'deneme.bin'
    document.body.appendChild(a)
    a.click()
    a.remove()
  })
  await waitFor(() => fs.existsSync(target) && fs.statSync(target).size === 4, 'blob download saved')
  await ctx.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('telsiz://app/'))
    win.webContents.downloadURL('http://127.0.0.1:1/dosya.exe')
  })
  await waitFor(() => ctx.app.evaluate(() => global.__indirmeler.length >= 2), 'second download event')
  const list = await ctx.app.evaluate(() => global.__indirmeler)
  assert.match(list[0].url, /^blob:telsiz:\/\/app\//)
  assert.equal(list[0].prevented, false)
  assert.equal(list[1].prevented, true)
})

test('menüden sunucu adresi değiştirme penceresi açılır ve vazgeçilebilir', async () => {
  const opened = ctx.app.waitForEvent('window', { predicate: (p) => p.url().startsWith('telsiz://baglan/'), timeout: TIMEOUT })
  await ctx.page.evaluate(() => window.telsizDesktop.changeServer())
  const connect = await opened
  await connect.waitForSelector('#cancel:not([hidden])')
  assert.equal(await connect.inputValue('#address'), 'http://127.0.0.1:' + ctx.port)
  const closed = connect.waitForEvent('close', { timeout: TIMEOUT })
  await connect.evaluate(() => document.getElementById('cancel').click()).catch(() => {})
  await closed
  assert.equal(ctx.page.url(), 'telsiz://app/')
})
