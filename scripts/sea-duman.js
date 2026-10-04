'use strict'

// Tek dosya uygulaması (SEA) olarak derlenmiş Telsiz sunucusunun duman testi.
// İkili geçici bir klasöre kopyalanır, yanına bir telsiz.env yazılır ve başka bir çalışma
// klasöründen başlatılır. Denetlenenler:
//   - banner: kurulum kodu, sürüm, sunucu adı (telsiz.env'den), veri klasörünün tam yolu
//     (ikilinin yanındaki veri klasörü), telsiz.env uyarıları ve ortam değişkeninin önceliği
//   - /api/info 200 ve gömülü sürüm, arayüz dosyaları (index.html, bir /js/ modülü, CSS,
//     yazı tipi, simge) 200 ve diskteki public/ dosyalarıyla bayt bayt aynı, güvenlik başlıkları
//     ve CSP, ETag ile 304, HEAD
//   - yol geçişi ve beyaz liste dışı denemeleri 404
//   - kurulum koduyla sahip hesabı, düzgün kapanış, sifre-sifirla ve reset-password komutları
//   - bağlantı noktası doluyken etkileşimsiz konsolda Enter beklemeden çıkış kodu 1
// Kullanım: node scripts/sea-duman.js <ikili> [--port <port>] [--onek <program veya argüman>]...
// --onek ile verilenler ikilinin önüne eklenir (ör. başka mimari için qemu-aarch64-static -L <kök>).

const fs = require('node:fs')
const os = require('node:os')
const net = require('node:net')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const util = require('../src/http-util')
const { SETTING_GROUPS } = require('../server.js')

const ROOT = path.join(__dirname, '..')
const PUBLIC_DIR = path.join(ROOT, 'public')
const DEFAULT_PORT = 4220
const BANNER_TIMEOUT_MS = 120000
const REQUEST_TIMEOUT_MS = 20000
const EXIT_TIMEOUT_MS = 60000
const CODE_RE = /Kurulum kodu: ([0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5})\./
const OWNER = 'duman.sahip'
const SYSTEM_LANG_VARS = ['LANG', 'LC_ALL', 'LC_MESSAGES']

class SmokeError extends Error {}

function check (condition, message, detail) {
  if (!condition) throw new SmokeError(message + (detail === undefined ? '' : '\n' + detail))
  console.log('tamam: ' + message)
}

// Alt sürecin ortamı: Telsiz ayarları ve sistem dil değişkenleri temizlenir, verilenler eklenir
function childEnv (extra) {
  const env = Object.assign({}, process.env)
  for (const group of SETTING_GROUPS) {
    for (const name of group) delete env[name]
  }
  for (const name of SYSTEM_LANG_VARS) delete env[name]
  return Object.assign(env, { DIL: 'tr' }, extra || {})
}

// İkiliyi (ve varsa önekini) başlatır. Çıktılar birikir, waitFor ile beklenir.
function launch (prefix, exe, args, env, cwd) {
  const command = prefix.length > 0 ? prefix[0] : exe
  const argv = prefix.length > 0 ? prefix.slice(1).concat([exe], args) : args
  const child = spawn(command, argv, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const proc = { child, stdout: '', stderr: '', code: undefined, exited: null }
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (d) => {
    proc.stdout += d
  })
  child.stderr.on('data', (d) => {
    proc.stderr += d
  })
  proc.exited = new Promise((resolve) => {
    child.on('error', (err) => {
      proc.stderr += '\n[başlatılamadı] ' + err.message
      proc.code = null
      resolve(null)
    })
    child.on('close', (code, signal) => {
      proc.code = code === null ? signal : code
      resolve(proc.code)
    })
  })
  return proc
}

// Çıktıda yol geçiyor mu. Windows'ta yollar harf duyarsızdır.
function hasPath (text, prefix, file) {
  if (text.includes(prefix + file)) return true
  return process.platform === 'win32' && text.toLowerCase().includes((prefix + file).toLowerCase())
}

function output (proc) {
  return '--- stdout ---\n' + proc.stdout + '\n--- stderr ---\n' + proc.stderr
}

function delay (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor (proc, predicate, timeoutMs, label) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    if (predicate(proc)) return
    if (proc.code !== undefined) throw new SmokeError(label + ': süreç beklenmedik biçimde sonlandı (' + proc.code + ').\n' + output(proc))
    await delay(100)
  }
  throw new SmokeError(label + ': ' + timeoutMs + ' ms içinde gerçekleşmedi.\n' + output(proc))
}

async function waitExit (proc, timeoutMs, label) {
  let timer = null
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve('zaman aşımı'), timeoutMs)
  })
  const result = await Promise.race([proc.exited, timeout])
  clearTimeout(timer)
  if (result === 'zaman aşımı') {
    proc.child.kill('SIGKILL')
    throw new SmokeError(label + ': süreç ' + timeoutMs + ' ms içinde kapanmadı.\n' + output(proc))
  }
  return proc.code
}

async function run (prefix, exe, args, env, cwd, label) {
  const proc = launch(prefix, exe, args, env, cwd)
  await waitExit(proc, EXIT_TIMEOUT_MS, label)
  return proc
}

function request (port, method, urlPath, opts) {
  const o = opts || {}
  return new Promise((resolve, reject) => {
    const body = o.body === undefined ? null : Buffer.from(JSON.stringify(o.body), 'utf8')
    const headers = Object.assign({}, o.headers || {})
    if (body) {
      headers['Content-Type'] = 'application/json'
      headers['Content-Length'] = body.length
    }
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, timeout: REQUEST_TIMEOUT_MS }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buffer: Buffer.concat(chunks) }))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('istek zaman aşımına uğradı: ' + method + ' ' + urlPath)))
    req.on('error', reject)
    req.end(body)
  })
}

function jsonOf (res) {
  try {
    return JSON.parse(res.buffer.toString('utf8'))
  } catch (err) {
    return null
  }
}

// Desene uyan ilk dosya (ör. ilk /js/ modülü), dosya listesi sabit yazılmaz
function firstFile (dir, pattern) {
  const names = fs.readdirSync(path.join(PUBLIC_DIR, dir)).filter((name) => pattern.test(name)).sort()
  if (names.length === 0) throw new SmokeError('public/' + dir + ' altında ' + pattern + ' desenine uyan dosya yok.')
  return dir + '/' + names[0]
}

function b64url (bytes) {
  return crypto.randomBytes(bytes).toString('base64url')
}

function assertSecurityHeaders (res, label) {
  const expected = {
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-resource-policy': 'same-origin',
    'permissions-policy': 'camera=(), geolocation=(), microphone=(self)'
  }
  for (const name of Object.keys(expected)) {
    if (res.headers[name] !== expected[name]) throw new SmokeError(label + ': ' + name + ' başlığı beklenen değerde değil (' + res.headers[name] + ').')
  }
  if (Object.keys(res.headers).some((name) => name.startsWith('access-control-'))) throw new SmokeError(label + ': CORS başlığı gönderilmemeli.')
}

function removeDir (dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  } catch (err) {
    console.error('uyarı: geçici klasör silinemedi: ' + dir + ' (' + err.message + ')')
  }
}

async function checkServer (port, version) {
  const info = await request(port, 'GET', '/api/info')
  const data = jsonOf(info)
  check(info.status === 200 && data !== null, '/api/info 200 döndü', info.status + ' ' + info.buffer.toString('utf8'))
  check(data.version === version, 'gömülü sürüm package.json ile aynı (' + version + ')', JSON.stringify(data))
  check(data.serverName === 'Duman Testi', 'sunucu adı telsiz.env dosyasından okundu', JSON.stringify(data))
  check(data.setupRequired === true, 'kurulum bekleniyor')
  check(data.limits && data.limits.uploadMaxBytes === 7 * 1024 * 1024 + 16, 'ortam değişkeni (MAKS_YUKLEME_MB) telsiz.env dosyasındaki takma addan (MAX_UPLOAD_MB) önceliklidir', JSON.stringify(data.limits))
  assertSecurityHeaders(info, '/api/info')

  const files = [
    { url: '/', file: 'index.html', type: 'text/html; charset=utf-8', csp: util.HTML_CSP },
    { url: '/index.html', file: 'index.html', type: 'text/html; charset=utf-8', csp: util.HTML_CSP },
    { url: '/' + firstFile('js', /^[0-9a-z-]+\.js$/), type: 'text/javascript; charset=utf-8', csp: util.API_CSP },
    { url: '/' + firstFile('css', /^[0-9a-z-]+\.css$/), type: 'text/css; charset=utf-8', csp: util.API_CSP },
    { url: '/' + firstFile('fonts', /^[a-z0-9-]+\.woff2$/), type: 'font/woff2', csp: util.API_CSP },
    { url: '/favicon.svg', type: 'image/svg+xml', csp: util.API_CSP },
    { url: '/vendor/nacl-fast.min.js', type: 'text/javascript; charset=utf-8', csp: util.API_CSP },
    { url: '/sw.js', type: 'text/javascript; charset=utf-8', csp: util.HTML_CSP }
  ]
  for (const item of files) {
    const rel = item.file || item.url.slice(1)
    const res = await request(port, 'GET', item.url)
    const disk = fs.readFileSync(path.join(PUBLIC_DIR, ...rel.split('/')))
    check(res.status === 200, 'GET ' + item.url + ' 200', String(res.status))
    check(res.headers['content-type'] === item.type, 'GET ' + item.url + ' türü ' + item.type, res.headers['content-type'])
    check(res.headers['content-security-policy'] === item.csp, 'GET ' + item.url + ' CSP doğru', res.headers['content-security-policy'])
    check(res.headers['cache-control'] === 'no-cache', 'GET ' + item.url + ' Cache-Control: no-cache')
    check(res.buffer.equals(disk), 'GET ' + item.url + ' gövdesi public/' + rel + ' ile bayt bayt aynı', res.buffer.length + ' / ' + disk.length)
    assertSecurityHeaders(res, item.url)
  }

  const html = await request(port, 'GET', '/')
  const etag = html.headers.etag
  check(typeof etag === 'string' && /^W\/"[0-9a-f]+-[0-9a-f]+"$/.test(etag), 'ETag üretildi', String(etag))
  const cached = await request(port, 'GET', '/', { headers: { 'If-None-Match': etag } })
  check(cached.status === 304 && cached.buffer.length === 0, 'If-None-Match ile 304', String(cached.status))
  const head = await request(port, 'HEAD', '/index.html')
  check(head.status === 200 && head.buffer.length === 0 && head.headers['content-length'] === String(html.buffer.length), 'HEAD /index.html gövdesiz ve doğru uzunlukta')
  const post = await request(port, 'POST', '/index.html', { body: {} })
  check(post.status === 405 && post.headers.allow === 'GET, HEAD', 'POST /index.html 405')
  const manifest = await request(port, 'GET', '/manifest.webmanifest')
  check(manifest.status === 200 && jsonOf(manifest) && jsonOf(manifest).name === 'Duman Testi', 'dinamik manifest sunucu adını içerir')

  const attempts = [
    '/../server.js',
    '/%2e%2e/server.js',
    '/%2E%2E/package.json',
    '/vendor/../server.js',
    '/js/../server.js',
    '/js/..%2fserver.js',
    '/js/%2e%2e/index.html',
    '/js/..\\server.js',
    '/css/../../telsiz.env',
    '/fonts/../telsiz-build.json',
    '/telsiz-build.json',
    '/public/index.html',
    '/telsiz.env',
    '/veri/state.json',
    '/server.js',
    '/package.json',
    '/js/yok.js',
    '/JS/' + path.basename(firstFile('js', /^[0-9a-z-]+\.js$/)),
    '/INDEX.HTML'
  ]
  // Lisans dosyasının adı yalnızca büyük/küçük harf farkıyla istenirse bulunmaz (her sistemde aynı)
  const license = path.basename(firstFile('fonts', /^[A-Za-z0-9-]+\.txt$/))
  if (license.toLowerCase() !== license) attempts.push('/fonts/' + license.toLowerCase())
  for (const attempt of attempts) {
    const res = await request(port, 'GET', attempt)
    check(res.status === 404, 'GET ' + attempt + ' 404 (beyaz liste ve yol geçişi koruması)', String(res.status))
  }
}

async function registerOwner (port, code) {
  const body = {
    name: OWNER,
    authKey: crypto.randomBytes(32).toString('hex'),
    kdf: { salt: b64url(16), N: 16384, r: 8, p: 1 },
    publicKey: b64url(32),
    wrappedKey: '1w.' + b64url(24) + '.' + b64url(48),
    setupCode: code
  }
  const res = await request(port, 'POST', '/api/register', { body, headers: { 'Accept-Language': 'tr' } })
  const data = jsonOf(res)
  check(res.status === 200 && data && typeof data.token === 'string', 'kurulum koduyla sahip hesabı oluşturuldu', res.status + ' ' + res.buffer.toString('utf8'))
  const again = await request(port, 'POST', '/api/register', { body: Object.assign({}, body, { name: 'ikinci.kisi' }) })
  check(again.status === 403, 'kurulum kodu ikinci kez kullanılamaz', String(again.status))
}

async function waitForFile (file, text, timeoutMs) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      if (fs.readFileSync(file, 'utf8').includes(text)) return true
    } catch (err) {
      // Dosya henüz yazılmadı
    }
    await delay(100)
  }
  return false
}

function occupyPort (port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

async function smoke (binary, options) {
  const o = options || {}
  const port = o.port || DEFAULT_PORT
  const prefix = o.prefix || []
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
  const source = path.resolve(binary)
  if (!fs.existsSync(source)) throw new SmokeError('İkili bulunamadı: ' + source)

  // Windows'ta geçici klasör kısa adla (8.3) gelebilir, ikilinin göreceği yolla karşılaştırmak için
  // gerçek uzun yol kullanılır
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-duman-')))
  const elsewhere = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-duman-cwd-')))
  let proc = null
  try {
    const exe = path.join(dir, path.basename(source))
    fs.copyFileSync(source, exe)
    fs.chmodSync(exe, 0o755)
    const envFile = path.join(dir, 'telsiz.env')
    fs.writeFileSync(envFile, [
      '# Duman testi ayarları',
      'SUNUCU_ADI = "Duman Testi"',
      'PORT=' + port,
      'HOST=127.0.0.1',
      'MAX_UPLOAD_MB=5',
      'BILINMEYEN_AYAR=1',
      ''
    ].join('\r\n'))
    const env = childEnv({ MAKS_YUKLEME_MB: '7' })
    const dataDir = path.join(dir, 'veri')

    proc = launch(prefix, exe, [], env, elsewhere)
    await waitFor(proc, (p) => CODE_RE.test(p.stdout) && p.stdout.includes('Ctrl+C'), BANNER_TIMEOUT_MS, 'banner')
    const code = CODE_RE.exec(proc.stdout)[1]
    check(true, 'banner kurulum kodunu gösterdi (' + code + ')')
    check(hasPath(proc.stdout, 'Veri klasörü: ', dataDir), 'veri klasörü ikilinin yanındaki veri klasörü ve tam yolu gösterildi', output(proc))
    check(proc.stdout.includes('Sürüm: ' + version), 'banner sürümü gösterdi', output(proc))
    check(proc.stdout.includes('Sunucu adı: Duman Testi'), 'banner telsiz.env dosyasındaki sunucu adını gösterdi', output(proc))
    check(hasPath(proc.stdout, 'Ayarlar şu dosyadan okundu: ', envFile), 'telsiz.env okundu', output(proc))
    check(proc.stderr.includes('"BILINMEYEN_AYAR" bilinen bir ayar adı değil'), 'bilinmeyen ayar adı için uyarı verildi', output(proc))
    check(proc.stdout.includes('MAX_UPLOAD_MB ortam değişkeni olarak da tanımlı'), 'ortam değişkeni varken dosyadaki değerin kullanılmadığı bildirildi', output(proc))
    check(!proc.stdout.includes('tunel.bat') && !proc.stdout.includes('tunel.sh'), 'tek dosya uygulamasında tünel betiği yerine komut önerildi')

    await checkServer(port, version)
    await registerOwner(port, code)
    check(await waitForFile(path.join(dataDir, 'state.json'), '"' + OWNER + '"', 15000), 'hesap veri klasörüne yazıldı')

    if (process.platform === 'win32') {
      // Windows'ta POSIX sinyali yoktur, süreç doğrudan sonlandırılır
      proc.child.kill()
      await waitExit(proc, EXIT_TIMEOUT_MS, 'kapanış')
      check(true, 'sunucu durduruldu')
    } else {
      proc.child.kill('SIGINT')
      const exitCode = await waitExit(proc, EXIT_TIMEOUT_MS, 'kapanış')
      check(exitCode === 0 && proc.stdout.includes('Sunucu kapatıldı.'), 'SIGINT ile düzgün kapanış', output(proc))
      check(!fs.existsSync(path.join(dataDir, '.kilit')), 'kilit dosyası kaldırıldı')
    }
    proc = null

    const reset = await run(prefix, exe, ['sifre-sifirla', OWNER], env, elsewhere, 'sifre-sifirla')
    check(reset.code === 0 && /Geçici parola: [A-Za-z0-9]{12}/.test(reset.stdout), 'sifre-sifirla geçici parola üretti', output(reset))
    const missing = await run(prefix, exe, ['reset-password', 'hayalet'], Object.assign({}, env, { DIL: 'en' }), elsewhere, 'reset-password')
    check(missing.code === 1 && missing.stderr.includes('no user named "hayalet"'), 'reset-password olmayan kullanıcıda çıkış kodu 1 (İngilizce)', output(missing))
    const usage = await run(prefix, exe, ['bilinmeyen-komut'], env, elsewhere, 'kullanım')
    check(usage.code === 1 && usage.stderr.includes('  ' + path.basename(exe) + ' sifre-sifirla <kullanıcı adı>'), 'kullanım metni ikilinin adını gösterdi', output(usage))

    const blocker = await occupyPort(port)
    try {
      const busy = await run(prefix, exe, [], env, elsewhere, 'dolu bağlantı noktası')
      check(busy.code === 1 && busy.stderr.includes(port + ' numaralı bağlantı noktası zaten kullanımda'), 'bağlantı noktası doluyken çıkış kodu 1 ve etkileşimsiz konsolda Enter beklenmedi', output(busy))
      check(!busy.stderr.includes('Enter'), 'etkileşimsiz konsolda Enter istenmedi', output(busy))
    } finally {
      await new Promise((resolve) => blocker.close(resolve))
    }
    console.log('Duman testi başarılı: ' + source)
  } finally {
    if (proc && proc.code === undefined) {
      proc.child.kill('SIGKILL')
      await waitExit(proc, EXIT_TIMEOUT_MS, 'temizlik').catch(() => {})
    }
    removeDir(dir)
    removeDir(elsewhere)
  }
}

function parseArgs (args) {
  const out = { binary: null, port: DEFAULT_PORT, prefix: [] }
  const rest = args.slice()
  while (rest.length > 0) {
    const arg = rest.shift()
    if (arg === '--port' || arg === '--onek') {
      if (rest.length === 0) throw new SmokeError(arg + ' bir değer bekliyor.')
      const value = rest.shift()
      if (arg === '--onek') {
        out.prefix.push(value)
      } else {
        out.port = Number(value)
        if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) throw new SmokeError('Geçersiz bağlantı noktası: ' + value)
      }
    } else if (arg.startsWith('-')) {
      throw new SmokeError('Tanınmayan argüman: ' + arg)
    } else if (out.binary === null) {
      out.binary = arg
    } else {
      throw new SmokeError('Yalnızca bir ikili verilebilir.')
    }
  }
  if (out.binary === null) throw new SmokeError('Kullanım: node scripts/sea-duman.js <ikili> [--port <port>] [--onek <program veya argüman>]...')
  return out
}

async function main (argv) {
  try {
    const args = parseArgs(argv.slice(2))
    await smoke(args.binary, args)
    return 0
  } catch (err) {
    console.error('Duman testi başarısız: ' + (err instanceof SmokeError ? err.message : (err && err.stack) || String(err)))
    return 1
  }
}

if (require.main === module) {
  main(process.argv).then((code) => {
    process.exitCode = code
  })
}

module.exports = { smoke, SmokeError }
