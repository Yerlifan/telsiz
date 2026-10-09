'use strict'

// Uçtan uca testlerin ortak düzeneği. Bu dosya bir test dosyası değildir (adı .test.js ile bitmez).
// Her test dosyası kendi sunucusunu (src/app.js createChatServer, gerçek public/ klasörü, geçici veri
// klasörü) ve kendi Chromium örneğini başlatır, bitince ikisini de kapatıp veri klasörünü siler.
// Hesaplar hız için Node tarafında açılır: istemciyle aynı scrypt türetmesi, public/crypto.js ile gerçek
// kimlik anahtarı çifti, grup anahtarı, şifreli profil ve kimlik bağlaması. Kurulum ve davetle kayıt akışı
// ayrıca 01-kurulum.test.js içinde tarayıcıdan sınanır.
//
// Ortam değişkenleri:
//   TELSIZ_E2E_BROWSER    chromium (varsayılan), firefox veya webkit. Sahte mikrofon ve ekran yakalama
//                         gerektiren dosyalar yalnızca Chromium'da çalışır, diğerlerinde atlandı olarak görünür
//   TELSIZ_E2E_CHROMIUM   Chromium yürütülebilir dosyası (Playwright kendi kurulumunu bulamıyorsa)
//   TELSIZ_E2E_PORT_BASE  Sunucu portları bu sayıdan başlar (verilmezse işletim sistemi boş port seçer)
//   TELSIZ_E2E_HEADED     1 ise tarayıcı görünür açılır (yerel hata ayıklama)
//
// Düşen testte açık sayfaların ekran görüntüsü depo kökündeki e2e-sonuclar/ altına yazılır, iş akışı bu
// klasörü yükler.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const http = require('node:http')
const crypto = require('node:crypto')
const { test } = require('node:test')
const playwright = require('playwright')
const { createChatServer } = require('../src/app')

const ROOT = path.join(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT, 'public')
const RESULTS_DIR = path.join(ROOT, 'e2e-sonuclar')
const SETUP_CODE = 'ABCDE-FGHJK'
const SHORT = 10000
const LONG = 30000
const TEST_TIMEOUT = 180000
// Yerel geliştirme ortamındaki sabit Chromium yolu, yalnızca varsa ve Playwright kendi kurulumunu
// bulamazsa kullanılır (CI'da npx playwright install ile gelen kurulum bulunur)
const LOCAL_CHROMIUM = '/opt/pw-browsers/chromium'
const BROWSERS = ['chromium', 'firefox', 'webkit']
const BROWSER = process.env.TELSIZ_E2E_BROWSER || 'chromium'
if (!BROWSERS.includes(BROWSER)) throw new Error('TELSIZ_E2E_BROWSER chromium, firefox veya webkit olmalıdır: ' + BROWSER)
// Sahte mikrofon: Chromium'da bayraklarla, Firefox'ta tercihlerle. WebKit'te yoktur, ses odasına katılma adımları atlanır.
const FAKE_MIC = BROWSER !== 'webkit'
const MIC_BROWSERS = ['chromium', 'firefox']

// Konsolda beklenen ve hata sayılmayan iletiler (düzenli ifadeler). Sunucu artık
// "Permissions-Policy: camera=(self)" gönderdiği için (src/http-util.js, ses odasında kamera) Chromium'un
// sahte aygıt yoklamasındaki "Permissions policy violation: camera" iletisi de beklenmez, liste boştur.
const BENIGN_CONSOLE = []

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Playwright'ın kendi Chromium kurulumu yoksa ortam değişkeni veya yerel sabit yol denenir.
// extraArgs: dosyaya özgü ek bayraklar (ör. sahte mikrofonun çalacağı WAV dosyası)
function chromiumLaunchOptions (extraArgs) {
  const args = [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--auto-select-desktop-capture-source=Entire screen',
    '--autoplay-policy=no-user-gesture-required'
  ].concat(extraArgs || [])
  const options = { headless: process.env.TELSIZ_E2E_HEADED !== '1', args }
  const fromEnv = process.env.TELSIZ_E2E_CHROMIUM
  if (fromEnv) {
    options.executablePath = fromEnv
    return options
  }
  let own = ''
  try {
    own = playwright.chromium.executablePath()
  } catch (err) {
    own = ''
  }
  if (own && fs.existsSync(own)) {
    // Tam Chromium derlemesi yeni başsız kipte açılır (başsız kabuk ekran yakalamayı desteklemez)
    options.channel = 'chromium'
    return options
  }
  if (fs.existsSync(LOCAL_CHROMIUM)) options.executablePath = LOCAL_CHROMIUM
  return options
}

// Firefox sahte mikrofonu ve izin istemini tercihlerle açar, WebKit için ek seçenek gerekmez.
// chromiumArgs yalnızca Chromium'a verilir.
function launchOptions (chromiumArgs) {
  if (BROWSER === 'chromium') return chromiumLaunchOptions(chromiumArgs)
  const options = { headless: process.env.TELSIZ_E2E_HEADED !== '1' }
  if (BROWSER === 'firefox') {
    options.firefoxUserPrefs = {
      'media.navigator.streams.fake': true,
      'media.navigator.permission.disabled': true,
      'media.autoplay.default': 0,
      'media.autoplay.block-webaudio': false
    }
  }
  return options
}

// Her test dosyası kendi yuvasını (slot) verir, böylece sabit port aralığında dosyalar çakışmaz
function portFor (slot) {
  const base = Number(process.env.TELSIZ_E2E_PORT_BASE) || 0
  return base ? base + (slot || 0) : 0
}

// Node tarafında istemciyle aynı public/crypto.js (TweetNaCl ile)
function loadE2EE () {
  const store = new Map()
  const sandbox = {
    crypto: crypto.webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)) },
      removeItem: (k) => { store.delete(k) }
    },
    console
  }
  sandbox.self = sandbox
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'vendor', 'nacl-fast.min.js'), 'utf8'), sandbox)
  vm.runInContext(fs.readFileSync(path.join(PUBLIC_DIR, 'crypto.js'), 'utf8'), sandbox)
  return { E: vm.runInContext('E2EE', sandbox), store }
}

function subKey (label, master) {
  return crypto.createHash('sha512').update(Buffer.from(label, 'utf8')).update(master).digest().subarray(0, 32)
}

// JSON veya ham gövdeli HTTP isteği
function call (port, method, urlPath, body, token, binary) {
  return new Promise((resolve, reject) => {
    let data = null
    if (binary) data = Buffer.from(binary)
    else if (body !== undefined && body !== null) data = Buffer.from(JSON.stringify(body))
    const headers = { 'content-type': binary ? 'application/octet-stream' : 'application/json' }
    if (token) headers['x-token'] = token
    if (data) headers['content-length'] = String(data.length)
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, agent: false }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const buf = Buffer.concat(chunks)
        let json = null
        try {
          json = JSON.parse(buf.toString('utf8'))
        } catch (err) {
          json = null
        }
        resolve({ status: res.statusCode, data: json, buf })
      })
    })
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

function listen (server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve(server.address().port)
    })
  })
}

// Sunucuyu başlatır. Sunucu günlüğünün hata satırları toplanır, kapanışta boş olmaları beklenir.
async function startServer (options, slot) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-e2e-'))
  const errors = []
  const log = { info () {}, warn () {}, error (text) { errors.push(String(text)) } }
  const server = await createChatServer(Object.assign({
    dataDir,
    publicDir: PUBLIC_DIR,
    setupCode: SETUP_CODE,
    scryptN: 1024,
    pollTimeoutMs: 5000,
    graceMs: 4000,
    iceServers: [],
    authLimit: 100000,
    loginFailLimit: 100000,
    messageLimit: 100000,
    uploadLimit: 100000,
    adminLimit: 100000,
    signalLimit: 100000,
    voiceLimit: 100000,
    friendRequestLimit: 100000,
    typingLimit: 100000,
    musicLimit: 100000,
    log
  }, options || {}))
  const port = await listen(server, portFor(slot))
  return { server, port, base: 'http://127.0.0.1:' + port, dataDir, errors }
}

// Node tarafında hesap: istemciyle aynı türetme (scrypt, SHA-512 alan ayrımı) ve gerçek anahtar çifti
async function createAccount (srv, crypt, name, password, codeField, code) {
  const kdf = { salt: crypto.randomBytes(16).toString('base64url'), N: 65536, r: 8, p: 1 }
  const master = crypto.scryptSync(Buffer.from(password.normalize('NFC'), 'utf8'), Buffer.from(kdf.salt, 'base64url'), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 128 * 1024 * 1024 })
  const pair = crypt.E.identity.generate()
  const wrappedKey = crypt.E.identity.wrap(pair.secretKey, new Uint8Array(subKey('telsiz-wrap-v1', master)))
  const body = { name, authKey: subKey('telsiz-auth-v1', master).toString('hex'), kdf, publicKey: pair.publicKey, wrappedKey }
  body[codeField] = code
  const res = await call(srv.port, 'POST', '/api/register', body)
  if (res.status !== 200) throw new Error('kayıt başarısız: ' + name + ' ' + JSON.stringify(res.data))
  crypt.E.identity.save(res.data.user.id, pair)
  return {
    name,
    password,
    token: res.data.token,
    id: res.data.user.id,
    publicKey: pair.publicKey,
    secretKey: pair.secretKey,
    identity: crypt.store.get('telsiz.identity.' + res.data.user.id)
  }
}

// Sayfanın konsol hatalarını, uyarılarını ve yakalanmamış hatalarını toplar
function watchPage (page, label, sink) {
  page.on('console', (m) => {
    const type = m.type()
    if (type !== 'error' && type !== 'warning') return
    const text = m.text()
    if (BENIGN_CONSOLE.some((re) => re.test(text))) return
    const where = m.location()
    sink.push({ label, type, text, url: where && where.url ? where.url : '' })
  })
  page.on('pageerror', (e) => sink.push({ label, type: 'pageerror', text: e.message + '\n' + (e.stack || '') }))
}

const initScript = (v) => {
  if (sessionStorage.getItem('e2e.init')) return
  if (v.token) localStorage.setItem('telsiz.token', v.token)
  if (v.identity) localStorage.setItem('telsiz.identity.' + v.id, v.identity)
  Object.keys(v.extra).forEach((k) => localStorage.setItem(k, v.extra[k]))
  sessionStorage.setItem('e2e.init', '1')
}

// Tarayıcıyı başlatır, sayfaları izler, düşen testte ekran görüntüsü alır.
// opts.chromiumArgs: Chromium'a verilecek ek bayraklar
async function openBrowser (opts) {
  const browser = await playwright[BROWSER].launch(launchOptions(opts && opts.chromiumArgs))
  const logs = []
  const pages = []
  return {
    browser,
    logs,
    pages,
    // Yeni bağlam ve sayfa. opts: viewport, locale, extra (localStorage), mobile, route (bağlam yönlendirmesi)
    async newPage (label, opts) {
      const o = opts || {}
      const ctxOptions = { locale: o.locale || 'tr-TR', viewport: o.viewport || { width: 1440, height: 900 }, deviceScaleFactor: 1 }
      if (o.mobile) Object.assign(ctxOptions, { isMobile: true, hasTouch: true })
      const context = await browser.newContext(ctxOptions)
      if (o.route) await o.route(context)
      if (o.person || o.extra) {
        const p = o.person || {}
        await context.addInitScript(initScript, { token: p.token || null, id: p.id || null, identity: p.identity || null, extra: o.extra || {} })
      }
      const page = await context.newPage()
      page.setDefaultTimeout(SHORT)
      domReadyGoto(page)
      watchPage(page, label, logs)
      pages.push({ label, page })
      return page
    },
    async close () {
      await browser.close()
    }
  }
}

// page.goto varsayılan olarak load yerine domcontentloaded bekler. Uygulamada load olayına bağlı iş yoktur, testler
// sayfanın hazır olduğunu zaten beklenen öğelerle doğrular. Açıkça waitUntil verilen çağrılar değişmez.
//
// Firefox'ta sayfanın ilk http gezinmesinden önce aynı kökendeki FIREFOX_WARMUP_PATH açılır. Sunucu her yanıtta
// Cross-Origin-Opener-Policy: same-origin gönderir, bu yüzden about:blank belgesinden uygulamaya ilk geçiş tarama
// bağlamını (BrowsingContext) yenisiyle değiştirir. Playwright 1.63'ün Firefox sürücüsü (Juggler) bu geçişte CI
// ölçümlerinde yaklaşık 200 sayfada bir Page.navigationCommitted olayını yayımlamaz: yeni bağlamın boş ilk belgesi
// bekleyen gezinme kimliğini tüketir (FrameTree.js satır 251 ve 273), ilk belge olduğu için de commit olayı bastırılır
// (PageAgent.js satır 312). Belge yüklenir, ama Playwright gezinmeyi bitmemiş sayar, goto ve sonraki bütün tıklamalar
// "navigation to finish" bekleyerek zaman aşımına uğrar. Isınmadan sonra testin kendi gezinmesi aynı tarama bağlamında
// kalır. Isınmanın kendi commit olayı beklenmez, belgenin hazır olduğu sayfanın içinden okunur, yeni gezinme bekleyen
// eski gezinmenin yerini alır. /sw.js uygulamayı çalıştırmaz ve CSP'si (img-src 'self') Firefox'un kendi /favicon.ico
// isteğini konsola hata yazdırmadan geçirir.
const FIREFOX_WARMUP_PATH = '/sw.js'

async function firefoxWarmup (page, target) {
  await page.evaluate((url) => { window.location.replace(url) }, target)
  await page.waitForFunction((url) => window.location.href === url && document.readyState === 'complete', target, { timeout: LONG })
}

function domReadyGoto (page) {
  const goto = page.goto.bind(page)
  let warmedUp = BROWSER !== 'firefox'
  page.goto = async (url, options) => {
    if (!warmedUp && /^https?:\/\//.test(String(url))) {
      warmedUp = true
      await firefoxWarmup(page, new URL(url).origin + FIREFOX_WARMUP_PATH)
    }
    return goto(url, Object.assign({ waitUntil: 'domcontentloaded' }, options || {}))
  }
  return page
}

function safeName (text) {
  return String(text).toLowerCase().replace(/[^a-z0-9çğıöşü]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}

async function failureShots (pages, file, name) {
  try {
    fs.mkdirSync(RESULTS_DIR, { recursive: true })
  } catch (err) {
    return
  }
  for (const entry of pages) {
    if (entry.page.isClosed()) continue
    const target = path.join(RESULTS_DIR, safeName(path.basename(file, '.test.js')) + '--' + safeName(name) + '--' + safeName(entry.label) + '.png')
    try {
      await entry.page.screenshot({ path: target, timeout: 5000 })
    } catch (err) {
      // Kapanmış veya yanıt vermeyen sayfanın görüntüsü alınamaz
    }
  }
}

// node:test test() sarmalayıcısı: düşen testte açık sayfaların ekran görüntüsünü yazar.
// getPages: o anda açık sayfaları veren işlev (dünya henüz kurulmamışsa boş dizi)
// opts.browsers: dosyanın çalıştığı tarayıcılar (verilmezse hepsi), diğerlerinde testler nedeniyle atlanır
// opts.reason: atlama nedeni. Tek bir test de aynı seçenekleri üçüncü bağımsız değişken olarak alır.
function skipReason (o) {
  return o && o.browsers && !o.browsers.includes(BROWSER) ? (o.reason || 'bu tarayıcıda çalışmaz') + ' (' + BROWSER + ')' : false
}

function makeTest (file, getPages, opts) {
  const skip = skipReason(opts)
  function e2eTest (name, fn, testOpts) {
    test(name, { timeout: TEST_TIMEOUT, skip: skip || skipReason(testOpts) }, async (t) => {
      try {
        await fn(t)
      } catch (err) {
        await failureShots(getPages(), file, name)
        throw err
      }
    })
  }
  // Atlanan dosyada before() sunucu ve tarayıcı kurmaz
  e2eTest.skipped = skip !== false
  return e2eTest
}

// Sunucu, Node tarafı hesaplar ve örnek odalar. Kişiler: deniz (sahip), ece, mert ve opts.extraPeople.
// opts.slot: TELSIZ_E2E_PORT_BASE verilmişse bu dosyanın port yuvası. opts.chromiumArgs: Chromium'a ek bayraklar.
// Odalar: genel, oyun-gecesi, fotograflar (yazı), Lobi, Oyun (ses).
// Uygulama hazır olduktan sonra load olayı SLOW_LOAD_MS içinde gelmezse sayfanın durumu ve tamamlanmamış
// kaynaklar (resim, biçem, yazı tipi) TAP açıklaması olarak yazılır. Test bu yüzden düşmez.
const SLOW_LOAD_MS = 10000
async function slowLoad (page, label) {
  try {
    await page.waitForFunction(() => document.readyState === 'complete', null, { timeout: SLOW_LOAD_MS })
  } catch (err) {
    const info = await page.evaluate(() => ({
      readyState: document.readyState,
      fonts: document.fonts ? document.fonts.status : '',
      images: Array.from(document.images).filter((img) => !img.complete).map((img) => img.currentSrc || img.src).slice(0, 10),
      styles: Array.from(document.querySelectorAll('link[rel="stylesheet"]')).filter((l) => !l.sheet).map((l) => l.href).slice(0, 10),
      done: performance.getEntriesByType('resource').length
    })).catch((e) => ({ error: String(e && e.message) }))
    console.log('# yavaş yükleme (' + BROWSER + ', ' + label + '): ' + JSON.stringify(info))
  }
}

async function setupWorld (opts) {
  const o = opts || {}
  const srv = await startServer(o.server, o.slot)
  const crypt = loadE2EE()
  const E = crypt.E
  const keyCode = E.generateKeyCode()
  const kid = E.keyring.add(keyCode)
  const owner = await createAccount(srv, crypt, 'deniz', 'parola-deniz-1', 'setupCode', SETUP_CODE)
  await call(srv.port, 'POST', '/api/settings', { activeKid: kid }, owner.token)
  await call(srv.port, 'POST', '/api/settings', { serverName: 'Kankalar' }, owner.token)
  const invite = (await call(srv.port, 'GET', '/api/state', null, owner.token)).data.inviteCode
  const P = { deniz: owner }
  const names = Object.assign({ deniz: 'Deniz', ece: 'Ece', mert: 'Mert' }, o.extraPeople || {})
  for (const name of Object.keys(names)) {
    if (!P[name]) P[name] = await createAccount(srv, crypt, name, 'parola-' + name + '-1', 'inviteCode', invite)
  }
  let color = 0
  for (const name of Object.keys(names)) {
    const p = P[name]
    const env = E.sealJson(kid, { v: 1, u: p.id, displayName: names[name], statusText: '', bio: '', color: color++, avatar: null })
    await call(srv.port, 'POST', '/api/me/profile', { profile: env, avatarUploadId: null }, p.token)
    await call(srv.port, 'POST', '/api/me/identity', { identity: E.identity.sealBinding(kid, p.id, p.publicKey) }, p.token)
  }
  const meta0 = (await call(srv.port, 'GET', '/api/state', null, owner.token)).data.meta
  const byPos = (type) => meta0.channels.filter((c) => c.type === type).sort((a, b) => a.position - b.position)[0]
  const firstText = byPos('text')
  const firstVoice = byPos('voice')
  if (firstText && firstText.name !== 'genel') await call(srv.port, 'POST', '/api/channels/update', { id: firstText.id, name: 'genel' }, owner.token)
  if (firstVoice && firstVoice.name !== 'Lobi') await call(srv.port, 'POST', '/api/channels/update', { id: firstVoice.id, name: 'Lobi' }, owner.token)
  for (const c of [['oyun-gecesi', 'text'], ['fotograflar', 'text'], ['Oyun', 'voice']].concat(o.extraRooms || [])) {
    await call(srv.port, 'POST', '/api/channels/create', { name: c[0], type: c[1] }, owner.token)
  }
  const meta = (await call(srv.port, 'GET', '/api/state', null, owner.token)).data.meta
  const room = (name) => {
    const found = meta.channels.filter((c) => c.name === name)[0]
    if (!found) throw new Error('oda yok: ' + name)
    return found
  }
  const say = async (who, channel, text, files, uploads) => {
    const p = P[who]
    const res = await call(srv.port, 'POST', '/api/messages', { channelId: channel.id, body: E.sealJson(kid, { v: 1, a: p.id, c: channel.id, t: text, f: files || [] }), uploads: uploads || [] }, p.token)
    if (res.status !== 200) throw new Error('mesaj gönderilemedi: ' + who + ' ' + res.status + ' ' + JSON.stringify(res.data))
    return res.data.message
  }
  const tb = await openBrowser({ chromiumArgs: o.chromiumArgs })
  // Kişi için oturum açık sayfa: anahtar adres parçasıyla eklenir, uygulama ve bant beklenir
  const pageFor = async (who, opts2) => {
    const o2 = opts2 || {}
    const page = await tb.newPage(o2.label || who, Object.assign({}, o2, { person: P[who], extra: Object.assign({ 'telsiz.skin': 'arcade', 'telsiz.scheme': 'dark' }, o2.extra || {}) }))
    // Sayfanın hazır olduğu uygulama görünümü ve bant ile beklenir, pencerenin load olayı beklenmez (uygulamada
    // load olayına bağlı iş yok). Uygulama hazır olduktan sonra load gecikirse bekleyen kaynaklar test çıktısına
    // yazılır (slowLoad). Firefox'ta ilk gezinmenin commit olayının kaybolması domReadyGoto içinde önlenir.
    await page.goto(srv.base + '/#anahtar=' + encodeURIComponent(keyCode), { timeout: LONG, waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#app-view:not([hidden])', { timeout: LONG })
    await page.waitForSelector('#band-track .station[data-station]', { timeout: LONG })
    await slowLoad(page, o2.label || who)
    return page
  }
  const close = async () => {
    try {
      await tb.close()
    } finally {
      await new Promise((resolve) => srv.server.close(resolve))
      fs.rmSync(srv.dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
    }
  }
  return {
    srv,
    port: srv.port,
    base: srv.base,
    E,
    kid,
    keyCode,
    invite,
    P,
    names,
    meta,
    room,
    say,
    tb,
    logs: tb.logs,
    pages: tb.pages,
    pageFor,
    close,
    call: (method, urlPath, body, token, binary) => call(srv.port, method, urlPath, body, token, binary)
  }
}

// Konsol hatası, uyarısı, sayfa hatası ve sunucu hata günlüğü yok. allow: ayrıca kabul edilen girdiler
// (girdiyi alıp true dönen işlevler)
function assertCleanConsole (logs, serverErrors, allow) {
  const extra = allow || []
  const bad = logs.filter((l) => !extra.some((fn) => fn(l)))
  assert.deepEqual(bad, [], 'konsol veya sayfa hatası')
  if (serverErrors) assert.deepEqual(serverErrors, [], 'sunucu hata günlüğü')
}

// Veri klasöründeki tüm dosyaların içeriği (düz metin aramaları için)
function readDataDir (dir) {
  const out = []
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile()) out.push({ file: full, data: fs.readFileSync(full) })
    }
  }
  return out
}

// Koşul doğru olana kadar Node tarafında bekler (sayfa dışı durumlar için)
async function until (fn, timeout, label) {
  const end = Date.now() + (timeout || SHORT)
  while (true) {
    const value = await fn()
    if (value) return value
    if (Date.now() > end) throw new Error('zaman aşımı: ' + (label || 'koşul'))
    await sleep(100)
  }
}

// Sayfada yatay taşma (piksel). 0 veya daha küçükse taşma yoktur. Ölçü ilk kapsayıcı bloğa (clientWidth) göredir:
// telefon öykünmesinde (mobile: true) içerik taşınca window.innerWidth (yerleşim görünümü) içerikle birlikte
// genişler, scrollWidth - innerWidth bu yüzden taşmayı hiç göremez. Masaüstünde de aynı ölçü geçerlidir.
function overflowX (page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}

// Öğe bütünüyle görünür alanda ve ortasında üstünde başka öğe yok (fareyle ve dokunarak ulaşılabilir)
function reachable (page, sel) {
  return page.evaluate((s) => {
    const n = document.querySelector(s)
    if (!n || !n.getClientRects().length) return false
    const b = n.getBoundingClientRect()
    if (b.left < 0 || b.right > document.documentElement.clientWidth || b.top < 0 || b.bottom > window.innerHeight) return false
    const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
    return Boolean(hit && hit.closest(s))
  }, sel)
}

// İstasyonu görünür alana getirip tıklar (taşan bantta)
async function clickStation (page, key) {
  await page.evaluate((k) => {
    const n = document.querySelector('#band-track .station[data-station="' + k + '"]')
    if (n && typeof bandReveal === 'function') bandReveal(n, false)
  }, key)
  await page.click('#band-track .station[data-station="' + key + '"]')
}

// Ses odasına katılır ve telsiz kartının bağlanmasını bekler. Geniş ekranda kapalı telsiz kartı küçüktür,
// ses odaları sağdaki İstasyonlar listesinden seçilir, daha dar ekranda kartın Katıl düğmesi kullanılır.
async function joinVoice (page, channelId) {
  const joinSel = '#voice-channels .radio-join[data-channel-id="' + channelId + '"]'
  const visible = await page.evaluate((sel) => {
    const n = document.querySelector(sel)
    return Boolean(n && n.getClientRects().length)
  }, joinSel)
  await page.click(visible ? joinSel : '#inbox-list .room-row[data-station="voice-' + channelId + '"]')
  await page.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'on', null, { timeout: LONG })
}

// Örnek ses dosyası (WAV, 440 Hz)
function makeWav (seconds, rate) {
  const n = Math.round(seconds * rate)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  let i = 0
  while (i < n) {
    const fade = Math.min(1, i / 200, (n - i) / 200)
    buf.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / rate) * 5000 * fade), 44 + i * 2)
    i += 1
  }
  return buf
}

module.exports = {
  BROWSER,
  domReadyGoto,
  FAKE_MIC,
  MIC_BROWSERS,
  ROOT,
  PUBLIC_DIR,
  RESULTS_DIR,
  SETUP_CODE,
  SHORT,
  LONG,
  sleep,
  call,
  loadE2EE,
  createAccount,
  startServer,
  openBrowser,
  setupWorld,
  makeTest,
  assertCleanConsole,
  readDataDir,
  until,
  overflowX,
  reachable,
  clickStation,
  joinVoice,
  makeWav
}
