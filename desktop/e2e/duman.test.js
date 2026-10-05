'use strict'

// Masaüstü uygulamasının duman testi (Playwright _electron, Linux'ta xvfb altında).
// Yerel bir Telsiz sunucusu başlatılır, uygulama boş bir kullanıcı verisi klasörüyle açılır,
// frekans (sunucu) adresi ekranından adres girilir ve şunlar doğrulanır:
// - giriş ekranı paketlenmiş koddan gelir (sunucu hiçbir statik dosya isteği almaz)
// - kayıt, mesaj, long-poll, yükleme ve indirme API'ları ana süreçteki vekil üzerinden çalışır,
//   X-Token ve Accept-Language iletilir
// - sayfada Node.js yoktur, yalnızca dar telsizDesktop API'si vardır, CSP satır içi betiği ve
//   sunucuya doğrudan bağlantıyı engeller, service worker kaydedilemez
// - şema dışı gezinme ve yeni pencere engellenir, https bağlantılar dış tarayıcıya verilir
// - izinler: mikrofon ve kamera var (ses odasında kamera), kullanıcı girişsiz ekran yakalama yok
// - tam ekran: ana çerçevedeki öğe kullanıcı hareketiyle tam ekran olur (yayın sahnesinin Tam ekran düğmesi)
// - başlık şeridi (Windows ve Linux): pencere düğmeleri kaplamada, renkleri temadan gelir, şeritteki menü
//   düğmeleri uygulama menüsünü açar, tam ekranda şerit kalkar
// - ekran paylaşımı seçicisi gerçek kullanıcı girişiyle açılır, seçim ve vazgeçme çalışır
// - genel kısayol olayları yalnızca izinli eylemlerle sayfaya ulaşır
// - bas konuş: pttToggle kısayolu kaydedilir, basılı tut olayları yalnızca 'start' ve 'end' ile gelir,
//   yerel modül paketlenmiş derlemede asar dışındadır, tuş kancası yalnızca ses odasındayken çalışır
//
// Varsayılan olarak geliştirme düzenindeki uygulama (node_modules/electron ile desktop/) açılır.
// TELSIZ_UYGULAMA ortam değişkeni paketlenmiş yürütülebilir dosyayı gösterirse (ör.
// dist/linux-unpacked/telsiz-masaustu) test onunla yapılır. Önce npm run hazirla çalıştırılmalıdır.
// Kullanım: npm run test:duman (Linux'ta: xvfb-run -a npm run test:duman)
//
// Tanı: uygulama TELSIZ_TANI_GUNLUGU ile açılır (src/lib/diagnostics.js), ana süreç açılış
// adımlarını bir dosyaya yazar ve açılışı durduran hatayı engelleyici kutu yerine günlükle bildirir.
// Bir test düşerse duman-sonuclar/ altına şunlar yazılır: ana süreç günlüğü (ana-surec.log),
// uygulamanın stdout ve stderr çıktısı (uygulama-cikisi.log), başlatma hatası ve Playwright çağrı
// günlüğü (baslatma-hatasi.txt) ve açık pencerelerin ekran görüntüleri. DEBUG=pw:protocol ve
// DEBUG_FILE verilirse Playwright protokol günlüğünü o dosyaya yazar (iş akışı bunu duman-sonuclar/
// altına yönlendirir). Başlatma uzarsa zaman aşımından önce yanıtı gelmemiş Playwright istekleri,
// protokol günlüğünün son satırları, tarayıcının ve Node.js denetleyicisinin hedef listeleri ve
// Windows'ta süreç ve pencere durumu ile masaüstü görüntüsü alınır, iş günlüğüne de yazılır
// (baslatma-durumu.txt, baslatma-ekrani.png).

const { test: nodeTest, before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const { execFile } = require('node:child_process')

const DESKTOP_DIR = path.join(__dirname, '..')
const RESULTS_DIR = path.join(DESKTOP_DIR, 'duman-sonuclar')
const TIMEOUT = 30000
const LAUNCH_TIMEOUT = 60000
// Başlatma bu süreyi aşarsa (zaman aşımından önce) uygulamanın durumu kaydedilir
const LAUNCH_SNAPSHOT_MS = 45000
const DIAG_ENV = 'TELSIZ_TANI_GUNLUGU'
const MAX_OUTPUT_CHARS = 4 * 1024 * 1024

// Playwright DEBUG_FILE akışını yüklenirken açar, klasör yoksa akış hata verip testi düşürürdü
if (process.env.DEBUG_FILE) fs.mkdirSync(path.dirname(path.resolve(process.env.DEBUG_FILE)), { recursive: true })

const { _electron: electron } = require('playwright')
const { createChatServer } = require('../../src/app')
const yardimci = require('../../test/server-yardimci')
const { listenInRange, sleep } = require('../test/yardimci')

const ctx = { server: null, port: 0, root: null, app: null, page: null, requests: [], token: null, channelId: null, failed: false, launchError: null, diagFile: null, output: [], outputChars: 0, snapshot: null }

// node:test sonucu after() içinde okunamaz: düşen testler burada işaretlenir
function test (name, options, fn) {
  const body = typeof options === 'function' ? options : fn
  const opts = typeof options === 'function' ? {} : options
  return nodeTest(name, opts, async (t) => {
    try {
      return await body(t)
    } catch (err) {
      ctx.failed = true
      throw err
    }
  })
}

function recordOutput (stream, chunk) {
  if (ctx.outputChars > MAX_OUTPUT_CHARS) return
  const text = String(chunk)
  ctx.outputChars += text.length
  ctx.output.push('[' + stream + '] ' + text)
}

// Windows'ta uygulama süreçlerinin pencere başlıkları, yanıt durumu ve masaüstü görüntüsü.
// Engelleyici bir hata kutusu veya yanıt vermeyen bir süreç bu kayıtta görünür.
function windowsSnapshot (imageFile) {
  const script = [
    "$ErrorActionPreference = 'Continue'",
    "Get-Process | Where-Object { $_.ProcessName -like 'Telsiz*' } | Select-Object Id, ProcessName, MainWindowTitle, Responding, StartTime | Format-Table -AutoSize | Out-String -Width 300",
    'try {',
    '  Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
    '  $b = [System.Windows.Forms.SystemInformation]::VirtualScreen',
    '  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
    '  $g = [System.Drawing.Graphics]::FromImage($bmp)',
    '  $g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)',
    '  $bmp.Save($env:TELSIZ_EKRAN, [System.Drawing.Imaging.ImageFormat]::Png)',
    "  'ekran goruntusu: ' + $env:TELSIZ_EKRAN",
    "} catch { 'ekran goruntusu alinamadi: ' + $_.Exception.Message }"
  ].join('\n')
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: Object.assign({}, process.env, { TELSIZ_EKRAN: imageFile }),
      timeout: 15000,
      windowsHide: true
    }, (err, stdout, stderr) => {
      resolve([stdout, stderr, err ? 'hata: ' + err.message : ''].filter(Boolean).join('\n'))
    })
  })
}

// Playwright protokol günlüğünden (DEBUG_FILE) yanıtı gelmemiş istekler. Node.js denetleyicisi ve
// Chromium bağlantısı kimlikleri ayrı ayrı 1'den sayar: oturumsuz Runtime.* istekleri ana sürecin
// Node.js denetleyicisine, diğer oturumsuz istekler tarayıcı köküne gider. Oturumsuz bir yanıt aynı
// kimlikli en eski bekleyen isteğe eşlenir (her iki bağlantıda aynı kimlik aynı anda nadiren bekler).
function pendingRequests (text) {
  const pending = []
  for (const line of text.split(/\r?\n/)) {
    const send = /pw:protocol SEND \S+ \{"id":(\d+),"method":"([^"]+)"/.exec(line)
    const session = /"sessionId":"([0-9A-Fa-f]+)"/.exec(line)
    if (send) {
      const target = session ? 'oturum ' + session[1].slice(0, 8) : (send[2].startsWith('Runtime.') ? 'node' : 'tarayici')
      pending.push({ id: send[1], method: send[2], target, session: session ? session[1] : null, time: line.slice(0, 24) })
      continue
    }
    const recv = /pw:protocol \S+ RECV \{"id":(\d+),/.exec(line)
    if (!recv) continue
    const index = pending.findIndex((p) => p.id === recv[1] && p.session === (session ? session[1] : null))
    if (index !== -1) pending.splice(index, 1)
  }
  return pending
}

// Bağlanılan sayfa hedefleri ve her birinde ilk gezinmenin (Page.frameNavigated) görülüp
// görülmediği. Playwright başlatmayı bitirmek için her sayfada ilk gerçek gezinmenin işlenmesini
// bekler (FrameSession._initialize), bekleyen istek yokken takılma bu olayın gelmemesidir.
function attachedPages (text) {
  const pages = new Map()
  for (const line of text.split(/\r?\n/)) {
    const attached = /"method":"Target\.attachedToTarget","params":\{"sessionId":"([0-9A-Fa-f]+)","targetInfo":\{"targetId":"[0-9A-Fa-f]+","type":"([a-z_]+)","title":"[^"]*","url":"([^"]*)"/.exec(line)
    if (attached) {
      pages.set(attached[1], { session: attached[1].slice(0, 8), type: attached[2], url: attached[3], frameTreeUrl: null, navigated: [] })
      continue
    }
    const session = /"sessionId":"([0-9A-Fa-f]+)"/.exec(line)
    const page = session ? pages.get(session[1]) : null
    if (!page) continue
    const tree = /RECV \{"id":\d+,"result":\{"frameTree":\{"frame":\{"id":"[0-9A-Fa-f]+","loaderId":"[0-9A-Fa-f]+","url":"([^"]*)"/.exec(line)
    if (tree && page.frameTreeUrl === null) page.frameTreeUrl = tree[1]
    const nav = /"method":"Page\.frameNavigated","params":\{"frame":\{"id":"[0-9A-Fa-f]+",(?:"parentId":"[0-9A-Fa-f]+",)?"loaderId":"[0-9A-Fa-f]+","url":"([^"]*)"/.exec(line)
    if (nav) page.navigated.push(nav[1])
  }
  return Array.from(pages.values())
}

function devtoolsPorts (text) {
  const node = /Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(text)
  const browser = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(text)
  return { node: node ? Number(node[1]) : null, browser: browser ? Number(browser[1]) : null }
}

function getJson (port, urlPath) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: urlPath, agent: false, timeout: 5000 }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').slice(0, 20000)))
    })
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', (err) => resolve('hata: ' + err.message))
  })
}

// Protokol günlüğünün özeti: bekleyen istekler ve son satırlar (her satır kısaltılır)
function protocolSummary (lineCount) {
  const file = process.env.DEBUG_FILE ? path.resolve(process.env.DEBUG_FILE) : null
  if (!file || !fs.existsSync(file)) return { text: 'Playwright protokol günlüğü yok (DEBUG=pw:protocol ve DEBUG_FILE verilmedi)', log: '' }
  const log = fs.readFileSync(file, 'utf8')
  const pending = pendingRequests(log)
  const pages = attachedPages(log)
  const lines = log.split(/\r?\n/).filter(Boolean).slice(-lineCount).map((l) => l.length > 400 ? l.slice(0, 400) + ' ...' : l)
  return {
    log,
    text: [
      'Yanıtı gelmemiş Playwright istekleri (' + pending.length + '):',
      ...pending.map((p) => '  ' + p.time + ' ' + p.target + ' #' + p.id + ' ' + p.method),
      'Bağlanılan hedefler (' + pages.length + '):',
      ...pages.map((p) => '  oturum ' + p.session + ' ' + p.type + ' ' + JSON.stringify(p.url) + ', getFrameTree adresi ' + JSON.stringify(p.frameTreeUrl) + ', Page.frameNavigated: ' + (p.navigated.length > 0 ? JSON.stringify(p.navigated) : 'yok')),
      'Protokol günlüğünün son ' + lines.length + ' satırı:',
      ...lines.map((l) => '  ' + l)
    ].join('\n')
  }
}

// Başlatma uzadığında (zaman aşımından önce) uygulamanın durumu: bekleyen protokol istekleri,
// tarayıcının ve Node.js denetleyicisinin kendi HTTP uç noktalarından hedef listesi, Windows'ta
// süreç ve pencere durumu. Sonuç iş günlüğüne de yazılır (artifact indirilemeyen ortamlar için).
async function launchProbe () {
  const parts = []
  const summary = protocolSummary(150)
  parts.push(summary.text)
  const ports = devtoolsPorts(summary.log)
  if (ports.browser) {
    parts.push('Tarayıcı /json/version: ' + await getJson(ports.browser, '/json/version'))
    parts.push('Tarayıcı /json/list: ' + await getJson(ports.browser, '/json/list'))
  }
  if (ports.node) parts.push('Node.js denetleyicisi /json/list: ' + await getJson(ports.node, '/json/list'))
  if (process.platform === 'win32') parts.push(await windowsSnapshot(path.join(RESULTS_DIR, 'baslatma-ekrani.png')))
  const text = parts.join('\n\n')
  process.stderr.write('\n===== duman testi: başlatma durumu =====\n' + text + '\n===== son =====\n')
  return text
}

// Başarısızlıkta teşhis dosyalarını duman-sonuclar/ altına yazar
async function writeResults () {
  fs.mkdirSync(RESULTS_DIR, { recursive: true })
  const write = (name, text) => {
    try {
      fs.writeFileSync(path.join(RESULTS_DIR, name), text)
    } catch (err) {
      process.stderr.write('duman-sonuclar/' + name + ' yazılamadı: ' + err.message + '\n')
    }
  }
  if (ctx.launchError) write('baslatma-hatasi.txt', String(ctx.launchError.stack || ctx.launchError.message || ctx.launchError) + '\n')
  // Başlatma, durum kaydı alınmadan düştüyse protokol özeti iş günlüğüne yazılır
  if (ctx.launchError && !ctx.snapshot) process.stderr.write('\n===== duman testi: protokol özeti =====\n' + protocolSummary(80).text + '\n===== son =====\n')
  if (ctx.snapshot) write('baslatma-durumu.txt', ctx.snapshot + '\n')
  if (ctx.output.length > 0) write('uygulama-cikisi.log', ctx.output.join(''))
  if (ctx.diagFile && fs.existsSync(ctx.diagFile)) {
    try {
      fs.copyFileSync(ctx.diagFile, path.join(RESULTS_DIR, 'ana-surec.log'))
    } catch (err) {
      process.stderr.write('ana süreç günlüğü kopyalanamadı: ' + err.message + '\n')
    }
  }
  // Açık her pencerenin ekran görüntüsü (ör. pencere-1-baglan.png, pencere-2-app.png)
  const pages = ctx.app ? ctx.app.windows() : []
  for (const [index, page] of pages.entries()) {
    let host = 'pencere'
    try {
      host = new URL(page.url()).host.replace(/[^0-9a-z-]/gi, '_') || host
    } catch (err) {
      host = 'pencere'
    }
    await page.screenshot({ path: path.join(RESULTS_DIR, 'pencere-' + (index + 1) + '-' + host + '.png'), timeout: 10000 }).catch(() => {})
  }
}

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

function launchOptions (userDataDir, diagFile) {
  const packaged = process.env.TELSIZ_UYGULAMA
  const common = ['--user-data-dir=' + userDataDir, '--use-fake-device-for-media-stream', '--lang=tr']
  const executablePath = packaged ? path.resolve(packaged) : require(path.join(DESKTOP_DIR, 'node_modules', 'electron'))
  return {
    executablePath,
    args: packaged ? common : [DESKTOP_DIR].concat(common),
    // Linux'ta Playwright varsayılan olarak --no-sandbox ekler, uygulama korumalı alanla denenmelidir
    chromiumSandbox: true,
    // TELSIZ_PLAYWRIGHT: ilk pencere Playwright bağlandıktan sonra açılır (src/lib/automation.js),
    // aksi halde bağlanma ilk gezinmenin ortasına denk gelince başlatma sonsuza dek bekleyebilir
    env: Object.assign({}, process.env, { ELECTRON_ENABLE_LOGGING: '1', [DIAG_ENV]: diagFile, TELSIZ_PLAYWRIGHT: '1' }),
    timeout: LAUNCH_TIMEOUT
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
  ctx.diagFile = path.join(ctx.root, 'ana-surec.log')
  let snapshotRun = null
  const snapshotTimer = setTimeout(() => {
    fs.mkdirSync(RESULTS_DIR, { recursive: true })
    snapshotRun = launchProbe().then((text) => {
      ctx.snapshot = text
    }, (err) => {
      ctx.snapshot = 'durum alınamadı: ' + err.message
    })
  }, LAUNCH_SNAPSHOT_MS)
  try {
    ctx.app = await electron.launch(launchOptions(userData, ctx.diagFile))
  } catch (err) {
    ctx.failed = true
    ctx.launchError = err
    throw err
  } finally {
    clearTimeout(snapshotTimer)
    // Zaman aşımından önce başlamış durum kaydının bitmesi beklenir (hiçbir zaman reddedilmez)
    if (snapshotRun) await snapshotRun
  }
  ctx.app.process().stdout.on('data', (chunk) => recordOutput('out', chunk))
  ctx.app.process().stderr.on('data', (chunk) => {
    recordOutput('err', chunk)
    const text = String(chunk)
    if (/\[telsiz\]/.test(text)) process.stderr.write(text)
  })
})

after(async () => {
  if (ctx.failed) await writeResults()
  if (ctx.app) await ctx.app.close().catch(() => {})
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
  assert.deepEqual(await page.evaluate(() => Object.keys(window.telsizDesktop).sort()), ['addFrequency', 'changeServer', 'getServer', 'getSettings', 'listFrequencies', 'onPttHold', 'onShortcut', 'platform', 'removeFrequency', 'setCloseToTray', 'setFrequencyName', 'setPtt', 'setShortcuts', 'setVoiceActive', 'switchFrequency', 'titleBar', 'updates', 'version'])
  assert.deepEqual(await page.evaluate(() => Object.keys(window.telsizDesktop.updates).sort()), ['checkNow', 'getState', 'install', 'onState', 'openRelease', 'setEnabled'])
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

  // Long-poll: sayfa bekler, başka bir istemci (doğrudan sunucuya) mesaj gönderir. Bekleme yukarıda
  // gönderilen mesajdan sonraki güncel sıradan başlar (eski sıra poll'u o mesajla hemen döndürürdü).
  // Poll başka bir değişiklikle (ör. meta veya kişiye özel sürüm) de dönebilir: mesaj olayı gelene
  // kadar yanıttaki sıra ve sürümlerle süre sınırlı olarak yinelenir.
  const fresh = await xhr(page, 'GET', '/api/state', { token: ctx.token })
  assert.equal(fresh.status, 200)
  const cursor = { since: fresh.data.seq, mv: fresh.data.metaVersion, pmv: fresh.data.pmv, tv: fresh.data.tv, sig: fresh.data.sigSeq }
  const poll = () => xhr(page, 'GET', '/api/poll?since=' + cursor.since + '&mv=' + cursor.mv + '&pmv=' + cursor.pmv + '&tv=' + cursor.tv + '&sig=' + cursor.sig + '&boot=' + fresh.data.boot, { token: ctx.token })
  const pending = poll()
  await sleep(500)
  const other = await direct('POST', '/api/messages', ctx.token, { channelId: ctx.channelId, body: yardimci.envelope() })
  assert.equal(other.status, 200)
  const otherId = other.data.message.id
  const pollDeadline = Date.now() + TIMEOUT
  let polled = await pending
  while (true) {
    assert.equal(polled.status, 200, polled.text)
    assert.equal(polled.data.boot, fresh.data.boot)
    assert.notEqual(polled.data.resync, true, polled.text)
    if (polled.data.events.some((e) => e.type === 'msg' && e.message && e.message.id === otherId)) break
    assert.ok(Date.now() < pollDeadline, 'the message event did not arrive through the long-poll: ' + polled.text)
    cursor.since = polled.data.seq
    cursor.mv = polled.data.metaVersion
    cursor.pmv = polled.data.pmv
    cursor.tv = polled.data.tv
    for (const signal of polled.data.signals) cursor.sig = Math.max(cursor.sig, signal.seq)
    polled = await poll()
  }

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

test('gelişmiş gürültü engelleme: AudioWorklet modülü ve RNNoise wasm paketten yüklenir, CSP derlemeye izin verir', async () => {
  const page = ctx.page
  const index = await xhr(page, 'GET', '/index.html')
  assert.match(index.csp, /script-src 'self' 'wasm-unsafe-eval';/)
  const r = await page.evaluate(async () => {
    const ac = new AudioContext()
    try {
      await ac.audioWorklet.addModule('/rnnoise-worklet.js')
      const loaded = await new Promise((resolve, reject) => {
        const x = new XMLHttpRequest()
        x.open('GET', '/vendor/rnnoise/rnnoise.wasm')
        x.responseType = 'arraybuffer'
        x.onload = () => resolve({ status: x.status, type: x.getResponseHeader('content-type'), bytes: x.response })
        x.onerror = () => reject(new Error('xhr'))
        x.send()
      })
      const node = new AudioWorkletNode(ac, 'telsiz-rnnoise', { outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit', processorOptions: { wasm: loaded.bytes } })
      const message = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ type: 'timeout' }), 10000)
        node.port.onmessage = (e) => {
          clearTimeout(timer)
          resolve(e.data)
        }
      })
      node.port.postMessage('destroy')
      return { status: loaded.status, type: loaded.type, size: loaded.bytes.byteLength, message }
    } finally {
      await ac.close()
    }
  })
  assert.deepEqual([r.status, r.type, r.size, r.message.type], [200, 'application/wasm', 152656, 'ready'])
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

test('izinler: mikrofon ve kamera var (ses odasında kamera), kullanıcı girişsiz ekran yakalama yok', async () => {
  const page = ctx.page
  const gum = (constraints) => page.evaluate((c) => navigator.mediaDevices.getUserMedia(c).then((s) => {
    s.getTracks().forEach((track) => track.stop())
    return 'ok'
  }, (e) => e.name), constraints)
  assert.equal(await gum({ audio: true }), 'ok')
  // Kamera uygulamanın kendi ana çerçevesine verilir (permissions.js, yalnızca audio ve video istekleri)
  assert.equal(await gum({ video: true }), 'ok')
  assert.equal(await gum({ audio: true, video: true }), 'ok')
  // Eski masaüstü yakalama yolu seçicisiz ekran yakalayamaz
  assert.equal(await gum({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop' } } }), 'NotAllowedError')
  assert.equal(await page.evaluate(() => window.Notification.permission), 'granted')
  const geo = await page.evaluate(() => navigator.permissions.query({ name: 'geolocation' }).then((r) => r.state, (e) => e.name))
  assert.notEqual(geo, 'granted')
})

test('tam ekran: ana çerçevedeki öğe kullanıcı hareketiyle tam ekran olur ve çıkar', async () => {
  const page = ctx.page
  // Yayın sahnesinin Tam ekran düğmesi gibi tıklamayla requestFullscreen çağıran geçici bir düğme
  await page.evaluate(() => {
    const b = document.createElement('button')
    b.id = 'duman-tam-ekran'
    b.type = 'button'
    b.textContent = 'Tam ekran'
    b.style.position = 'fixed'
    b.style.left = '0'
    b.style.top = '0'
    b.style.width = '40px'
    b.style.height = '40px'
    b.style.zIndex = '2147483647'
    window.__tamEkran = null
    b.addEventListener('click', () => {
      b.requestFullscreen().then(() => {
        window.__tamEkran = 'ok'
      }, (e) => {
        window.__tamEkran = e.name
      })
    })
    document.body.appendChild(b)
  })
  // Ekran seçicisi testindeki gibi fareyle gerçek kullanıcı girişi
  await page.mouse.click(20, 20)
  await page.waitForFunction(() => window.__tamEkran !== null, null, { timeout: TIMEOUT })
  assert.equal(await page.evaluate(() => window.__tamEkran), 'ok')
  assert.equal(await page.evaluate(() => document.fullscreenElement && document.fullscreenElement.id), 'duman-tam-ekran')
  const windowFull = () => ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().some((w) => w.isFullScreen()))
  await page.evaluate(() => document.exitFullscreen())
  await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: TIMEOUT })
  // Sonraki testler normal pencereyle sürsün: pencerenin de tam ekrandan çıkması beklenir
  const until = Date.now() + TIMEOUT
  while (await windowFull()) {
    if (Date.now() > until) throw new Error('pencere tam ekrandan çıkmadı')
    await sleep(100)
  }
  await page.evaluate(() => document.getElementById('duman-tam-ekran').remove())
})

test('başlık şeridi: pencere düğmeleri kaplamada, renk temadan gelir, menüler açılır, tam ekranda şerit kalkar', { timeout: 60000 }, async (t) => {
  if (process.platform !== 'win32' && process.platform !== 'linux') {
    t.skip('kaplama yalnızca Windows ve Linux için')
    return
  }
  const page = ctx.page
  const layout = () => page.evaluate(() => {
    const bar = document.getElementById('titlebar')
    // Görünen ana görünüm (duman testinde kurulum ekranı açık kalır)
    const top = ['app-view', 'auth-view', 'boot-view'].map((id) => document.getElementById(id)).find((node) => node && !node.hidden)
    const o = navigator.windowControlsOverlay
    return {
      cls: document.documentElement.classList.contains('has-titlebar'),
      bar: bar ? Math.round(bar.getBoundingClientRect().height) : null,
      top: top ? Math.round(top.getBoundingClientRect().top) : null,
      overlay: Boolean(o && o.visible),
      menus: bar ? Array.from(bar.querySelectorAll('.titlebar-menu')).map((b) => b.textContent) : [],
      title: bar ? bar.querySelector('.titlebar-title').textContent : null,
      docTitle: document.title
    }
  })
  await page.waitForFunction(() => document.querySelector('#titlebar .titlebar-menu'), null, { timeout: TIMEOUT })
  const normal = await layout()
  assert.equal(normal.cls, true)
  assert.equal(normal.overlay, true, 'pencere denetimleri kaplaması görünür')
  assert.equal(normal.bar, 32, 'şerit kaplama yüksekliğinde')
  assert.equal(normal.top, 32, 'görünüm şeridin altından başlar')
  // Menü etiketleri uygulama menüsünün üst düzey bölümleridir (dil sistem dilinden seçilir: Telsiz, Düzen veya
  // Edit, Görünüm veya View, Yardım veya Help)
  const appMenus = await ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.filter((item) => item.submenu).map((item) => item.label))
  assert.equal(appMenus.length, 4)
  assert.deepEqual(normal.menus, appMenus)
  assert.equal(normal.title, normal.docTitle)
  const menuState = await ctx.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter((w) => w.isVisible()).map((w) => w.isMenuBarVisible()))
  assert.ok(menuState.every((visible) => visible === false), 'yerel menü çubuğu gizli')

  // Renk: sayfanın zemini ve metin rengi ana sürece gider (tanı günlüğü), tema değişince yenilenir
  const colorsOf = () => page.evaluate(() => {
    const hex = (v) => '#' + v.match(/\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
    const s = getComputedStyle(document.body)
    return { color: hex(s.backgroundColor), symbolColor: hex(s.color) }
  })
  const logged = (colors) => fs.readFileSync(ctx.diagFile, 'utf8').split('\n').some((line) => line.includes('title-bar-colors') && line.includes(colors.color) && line.includes(colors.symbolColor))
  const before = await page.evaluate(() => window.TelsizTheme.get().scheme)
  await page.evaluate(() => window.TelsizTheme.set({ scheme: 'dark' }))
  const dark = await colorsOf()
  await waitFor(() => logged(dark), 'koyu tema renkleri', TIMEOUT)
  await page.evaluate(() => window.TelsizTheme.set({ scheme: 'light' }))
  const light = await colorsOf()
  assert.notEqual(light.color, dark.color)
  await waitFor(() => logged(light), 'açık tema renkleri', TIMEOUT)
  await page.evaluate((scheme) => window.TelsizTheme.set({ scheme }), before)

  // Menü: geçersiz istek reddedilir, geçerli istek menüyü açar ve kapanınca true döner
  assert.equal(await page.evaluate(() => window.telsizDesktop.titleBar.openMenu(99, 10, 32)), false)
  assert.equal(await page.evaluate(() => window.telsizDesktop.titleBar.openMenu(0, -5, 32)), false)
  // Şeritteki düğme menüyü açar (aria-expanded true), menü kapanınca false olur
  await page.evaluate(() => document.querySelector('#titlebar .titlebar-menu').click())
  assert.equal(await page.evaluate(() => document.querySelector('#titlebar .titlebar-menu').getAttribute('aria-expanded')), 'true')
  await sleep(500)
  await ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[0].submenu.closePopup())
  await page.waitForFunction(() => document.querySelector('#titlebar .titlebar-menu').getAttribute('aria-expanded') === 'false', null, { timeout: TIMEOUT })
  // API doğrudan: menü kapanınca söz true ile çözülür
  await page.evaluate(() => {
    window.__menu = null
    window.telsizDesktop.titleBar.openMenu(1, 60, 32).then((v) => {
      window.__menu = v
    })
  })
  await sleep(500)
  await ctx.app.evaluate(({ Menu }) => Menu.getApplicationMenu().items[1].submenu.closePopup())
  await page.waitForFunction(() => window.__menu !== null, null, { timeout: TIMEOUT })
  assert.equal(await page.evaluate(() => window.__menu), true)

  // Tam ekranda kaplama ve şerit kalkar, sayfa en üstten başlar. Çıkınca geri gelir.
  const setFull = (on) => ctx.app.evaluate(({ BrowserWindow }, value) => {
    BrowserWindow.getAllWindows().filter((w) => w.isVisible()).forEach((w) => w.setFullScreen(value))
  }, on)
  // Kaplamanın kendi durumu (görünür mü) platforma göre değişebildiği için yalnızca günlüğe yazılır
  let last = null
  const settle = (check, label) => waitFor(async () => {
    last = await layout()
    return check(last)
  }, label, TIMEOUT).catch((err) => {
    throw new Error(err.message + ': ' + JSON.stringify(last))
  })
  await setFull(true)
  await settle((l) => l.bar === 0 && l.top === 0 && !l.cls, 'tam ekranda şerit kalkar')
  console.log('başlık şeridi tam ekranda: ' + JSON.stringify(last))
  await setFull(false)
  await settle((l) => l.bar === 32 && l.top === 32 && l.cls && l.overlay, 'tam ekrandan çıkınca şerit gelir')
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

  // Seçici düğmeye basılınca kendini kapatır. Pencere tıklamanın tamamlanması beklenirken kapanabilir, bu durumda
  // Playwright tıklamayı hata sayar. Kapanmayı ayrıca bekleriz, kapanma kaynaklı tıklama hatası beklenen sonuçtur.
  const clickAndClose = async (win, selector) => {
    const closed = win.waitForEvent('close', { timeout: TIMEOUT })
    await win.click(selector, { noWaitAfter: true }).catch((err) => {
      if (!/closed/i.test(String(err && err.message))) throw err
    })
    await closed
  }

  // Vazgeç
  await page.mouse.click(5, 5)
  let pickerOpened = ctx.app.waitForEvent('window', { predicate: (p) => p.url().startsWith('telsiz://secici/'), timeout: TIMEOUT })
  let result = share()
  let picker = await pickerOpened
  await picker.waitForSelector('#cancel:not(:empty)')
  assert.deepEqual(await picker.evaluate(() => Object.keys(window.telsizPicker).sort()), ['cancel', 'choose', 'init'])
  await clickAndClose(picker, '#cancel')
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
  await clickAndClose(picker, '#share')
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

// Bas konuş arka planda: bas aç, bas kapat genel kısayolu (pttToggle) ve isteğe bağlı basılı tut tuş kancası.
// Gerçek tuş olayı üretilmez: kısayolun kaydı, sayfaya yalnızca izinli olayların ulaşması, ayar doğrulaması,
// paketlenmiş derlemede yerel modülün asar dışına açılması ve kancanın yalnızca ses odasındayken çalışması denetlenir.
test('bas konuş: pttToggle kısayolu kaydedilir, sayfaya yalnızca izinli olaylar gelir, kanca yalnızca ses odasında çalışır', { timeout: 60000 }, async (t) => {
  const page = ctx.page
  const accelerator = 'CommandOrControl+Shift+F12'
  const before = await page.evaluate(() => window.telsizDesktop.getSettings())
  // Varsayılan: bas aç, bas kapat, tuş yok
  assert.deepEqual(before.ptt, { mode: 'toggle', holdKey: null })
  assert.equal(typeof before.pttHook.available, 'boolean')
  assert.equal(before.pttHook.running, false)
  const saved = await page.evaluate(() => window.telsizDesktop.setShortcuts({ toggleMute: 'ctrl+shift+f11', toggleDeafen: null, pttToggle: 'ctrl+shift+f12' }))
  assert.equal(saved.ok, true)
  assert.equal(saved.shortcuts.pttToggle, accelerator)
  const registered = await ctx.app.evaluate(({ globalShortcut }, value) => globalShortcut.isRegistered(value), accelerator)
  assert.equal(saved.registered.pttToggle, registered)
  // Linux'ta (xvfb, X11) genel kısayol gerçekten kaydedilir
  if (process.platform === 'linux') assert.equal(registered, true)
  assert.deepEqual(await page.evaluate(() => window.telsizDesktop.setShortcuts({ pttToggle: 'V' })), { ok: false, code: 'invalid' })

  await page.evaluate(() => {
    window.__basKonus = { shortcuts: [], hold: [] }
    window.telsizDesktop.onShortcut((action) => window.__basKonus.shortcuts.push(action))
    window.telsizDesktop.onPttHold((phase) => window.__basKonus.hold.push(phase))
  })
  await ctx.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('telsiz://app/'))
    win.webContents.send('telsiz:shortcut', 'pttToggle')
    win.webContents.send('telsiz:ptt-hold', 'evil')
    win.webContents.send('telsiz:ptt-hold', { keycode: 47 })
    win.webContents.send('telsiz:ptt-hold', 47)
    win.webContents.send('telsiz:ptt-hold', 'start')
    win.webContents.send('telsiz:shortcut', 'start')
    win.webContents.send('telsiz:ptt-hold', 'end')
  })
  await waitFor(() => page.evaluate(() => window.__basKonus.hold.length >= 2 && window.__basKonus.shortcuts.length >= 1), 'push to talk events')
  assert.deepEqual(await page.evaluate(() => window.__basKonus), { shortcuts: ['pttToggle'], hold: ['start', 'end'] })

  // Ayar doğrulaması ana süreçte yapılır
  assert.deepEqual(await page.evaluate(() => window.telsizDesktop.setPtt({ mode: 'kanca' })), { ok: false, code: 'invalid' })
  assert.deepEqual(await page.evaluate(() => window.telsizDesktop.setPtt({ mode: 'hold', holdKey: 'VolumeUp' })), { ok: false, code: 'invalid' })
  // Basılı tut tuşu Mikrofonu aç/kapat kısayoluyla (Ctrl+Shift+F11) birlikte tetiklenirdi
  assert.deepEqual(await page.evaluate(() => window.telsizDesktop.setPtt({ mode: 'hold', holdKey: 'F11' })), { ok: false, code: 'duplicate' })

  // Paketlenmiş derlemede yerel modül asar dışındadır (electron-builder.json asarUnpack)
  const packaged = await ctx.app.evaluate(({ app }) => app.isPackaged)
  if (packaged) {
    const resources = await ctx.app.evaluate(() => process.resourcesPath)
    const native = path.join(resources, 'app.asar.unpacked', 'node_modules', 'uiohook-napi', 'prebuilds', process.platform + '-' + process.arch, 'uiohook-napi.node')
    assert.ok(fs.existsSync(native), native)
  }

  const hold = await page.evaluate(() => window.telsizDesktop.setPtt({ mode: 'hold', holdKey: 'F13' }))
  if (!hold.ok) {
    // Modül bu makinede yüklenemiyorsa ayar değişmez ve neden bildirilir, uygulama çalışmaya devam eder
    assert.equal(hold.code, 'unavailable')
    assert.equal(hold.pttHook.available, false)
    assert.deepEqual(hold.ptt, { mode: 'toggle', holdKey: null })
    t.diagnostic('tuş kancası bu ortamda kullanılamıyor: ' + hold.pttHook.reason)
    return
  }
  assert.deepEqual(hold.ptt, { mode: 'hold', holdKey: 'F13' })
  // Basılı tut kipinde bas aç, bas kapat kısayolu kaydedilmez, ses odasında değilken kanca çalışmaz
  assert.equal(hold.registered.pttToggle, null)
  assert.equal(await ctx.app.evaluate(({ globalShortcut }, value) => globalShortcut.isRegistered(value), accelerator), false)
  assert.equal(hold.pttHook.running, false)
  const hookState = () => page.evaluate(() => window.telsizDesktop.getSettings().then((s) => s.pttHook))
  await page.evaluate(() => window.telsizDesktop.setVoiceActive(true))
  const started = await waitFor(async () => {
    const s = await hookState()
    return s.running || s.error ? s : null
  }, 'key hook start')
  if (started.error) {
    t.diagnostic('tuş kancası bu ortamda başlatılamadı: ' + started.error)
  } else {
    assert.equal(started.running, true)
    await page.evaluate(() => window.telsizDesktop.setVoiceActive(false))
    await waitFor(async () => (await hookState()).running === false, 'key hook stop when leaving the voice room')
    // Ses odasındayken ayar kapanınca da durur
    await page.evaluate(() => window.telsizDesktop.setVoiceActive(true))
    await waitFor(async () => (await hookState()).running === true, 'key hook start again')
  }
  const back = await page.evaluate(() => window.telsizDesktop.setPtt({ mode: 'toggle', holdKey: 'F13' }))
  assert.equal(back.ok, true)
  assert.equal(back.pttHook.running, false)
  assert.equal(back.registered.pttToggle, registered)
  await page.evaluate(() => window.telsizDesktop.setVoiceActive(false))
})

// Gözetimsiz çalıştırmada zamanlanmış denetim yoktur, burada GitHub'a hiçbir istek gönderilmez
test('güncelleme durumu: varsayılan açık, gözetimsizde denetim yapılmaz, girdiler doğrulanır', async () => {
  const page = ctx.page
  const state = await page.evaluate(() => window.telsizDesktop.updates.getState())
  assert.equal(state.enabled, true)
  assert.equal(state.status, 'idle')
  assert.equal(state.lastCheckAt, null)
  assert.match(state.current, /^\d+\.\d+\.\d+/)
  const packaged = await ctx.app.evaluate(({ app }) => app.isPackaged)
  // Paketlenmemiş veya kurulmamış (linux-unpacked) uygulama yalnızca bildirim kipindedir
  if (!packaged || process.platform === 'linux') assert.equal(state.mode, 'notify')
  assert.deepEqual(await page.evaluate(() => window.telsizDesktop.updates.install()), { ok: false, code: 'not_ready' })
  assert.deepEqual(await page.evaluate(() => window.telsizDesktop.updates.openRelease()), { ok: false, code: 'unavailable' })
  const off = await page.evaluate(() => window.telsizDesktop.updates.setEnabled(false))
  assert.equal(off.ok, true)
  assert.equal(off.state.enabled, false)
  assert.deepEqual(await page.evaluate(() => window.telsizDesktop.updates.checkNow()), { ok: false, code: 'disabled' })
  const on = await page.evaluate(() => window.telsizDesktop.updates.setEnabled(true))
  assert.equal(on.state.enabled, true)
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
    return { active: ui.active, rendered, renderedApp, buttons: box.querySelectorAll('button').length, keys: Array.from(box.querySelectorAll('kbd')).map((k) => k.textContent), appButtons: app.querySelectorAll('button').length, desktopAttr: document.documentElement.getAttribute('data-desktop'), updateCheck: Boolean(app.querySelector('[data-desktop-update="check"]')), updateAuto: Boolean(app.querySelector('[data-desktop-update="auto"]')) }
  })
  assert.equal(result.active, true)
  assert.equal(result.rendered, true)
  assert.equal(result.renderedApp, true)
  assert.ok(result.buttons >= 4)
  assert.ok(result.keys.includes('Ctrl+Shift+F11'))
  assert.ok(result.appButtons >= 2)
  assert.equal(result.updateCheck, true)
  assert.equal(result.updateAuto, true)
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

test('frekans listesi: ilk sunucu listede ve etkin, Frekans ekle penceresi boş açılır ve vazgeçilebilir', async () => {
  const origin = 'http://127.0.0.1:' + ctx.port
  const list = await ctx.page.evaluate(() => window.telsizDesktop.listFrequencies())
  assert.equal(list.active, origin)
  assert.deepEqual(list.items.map((item) => [item.origin, item.active]), [[origin, true]])
  assert.deepEqual(await ctx.page.evaluate(() => window.telsizDesktop.switchFrequency('https://listede-yok.ornek.com')), { ok: false, code: 'unknown' })
  assert.deepEqual(await ctx.page.evaluate(() => window.telsizDesktop.removeFrequency('https://listede-yok.ornek.com', false)), { ok: false, code: 'unknown' })
  const opened = ctx.app.waitForEvent('window', { predicate: (p) => p.url().startsWith('telsiz://baglan/'), timeout: TIMEOUT })
  await ctx.page.evaluate(() => window.telsizDesktop.addFrequency())
  const connect = await opened
  await connect.waitForSelector('#cancel:not([hidden])')
  // Ekleme kipinde alan boştur, şu anki frekans bilgi satırında yazar
  assert.equal(await connect.inputValue('#address'), '')
  assert.match(await connect.textContent('#current'), new RegExp('127\\.0\\.0\\.1:' + ctx.port))
  const closed = connect.waitForEvent('close', { timeout: TIMEOUT })
  await connect.evaluate(() => document.getElementById('cancel').click()).catch(() => {})
  await closed
  assert.equal(ctx.page.url(), 'telsiz://app/')
})
