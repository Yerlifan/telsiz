'use strict'

// Paketlenmiş istemci dosyalarının beyaz listesi ve yanıtları. Kurallar sunucudaki beyaz listeyle
// (src/app.js) aynıdır, eşdeğerlik desktop/test/static-files.test.js içinde gerçek sunucuya karşı
// denetlenir. İki fark vardır: service worker (/sw.js) masaüstünde kullanılmaz ve
// /manifest.webmanifest (sunucunun ürettiği PWA bildirimi) yoktur, ikisi de 404 döner.
// Yol geçişi imkânsızdır: sabit yollar birebir eşleşir, klasör desenleri bölü, ters bölü, yüzde
// ve ardışık nokta içeremez. Dosyalar diskten değil, açılışta sha256 ile doğrulanmış bellekteki
// kopyadan sunulur (src/lib/integrity.js), bu yüzden büyük/küçük harf farkı da eşleşmez.

const { HTML_CSP, STATIC_CSP } = require('./csp')

const HTML_TYPE = 'text/html; charset=utf-8'
const JS_TYPE = 'text/javascript; charset=utf-8'
const TEXT_TYPE = 'text/plain; charset=utf-8'
const CSS_TYPE = 'text/css; charset=utf-8'

// Sunucunun her yanıta eklediği güvenlik başlıklarının aynısı (src/http-util.js)
const SECURITY_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)'
})

const FIXED = new Map()
function addFixed (urlPath, file, type, csp) {
  FIXED.set(urlPath, Object.freeze({ file, type, csp }))
}
addFixed('/', 'index.html', HTML_TYPE, HTML_CSP)
addFixed('/index.html', 'index.html', HTML_TYPE, HTML_CSP)
addFixed('/i18n.js', 'i18n.js', JS_TYPE, STATIC_CSP)
addFixed('/theme-init.js', 'theme-init.js', JS_TYPE, STATIC_CSP)
addFixed('/crypto.js', 'crypto.js', JS_TYPE, STATIC_CSP)
addFixed('/emoji.js', 'emoji.js', JS_TYPE, STATIC_CSP)
addFixed('/voice.js', 'voice.js', JS_TYPE, STATIC_CSP)
addFixed('/music.js', 'music.js', JS_TYPE, STATIC_CSP)
addFixed('/dj/youtube.js', 'dj/youtube.js', JS_TYPE, STATIC_CSP)
addFixed('/style.css', 'style.css', CSS_TYPE, STATIC_CSP)
addFixed('/favicon.svg', 'favicon.svg', 'image/svg+xml', STATIC_CSP)
addFixed('/icons/icon-192.png', 'icons/icon-192.png', 'image/png', STATIC_CSP)
addFixed('/icons/icon-512.png', 'icons/icon-512.png', 'image/png', STATIC_CSP)
addFixed('/icons/apple-touch-icon.png', 'icons/apple-touch-icon.png', 'image/png', STATIC_CSP)
addFixed('/vendor/nacl-fast.min.js', 'vendor/nacl-fast.min.js', JS_TYPE, STATIC_CSP)
addFixed('/vendor/TWEETNACL-LICENSE.txt', 'vendor/TWEETNACL-LICENSE.txt', TEXT_TYPE, STATIC_CSP)
addFixed('/vendor/scrypt.js', 'vendor/scrypt.js', JS_TYPE, STATIC_CSP)
addFixed('/vendor/SCRYPT-JS-LICENSE.txt', 'vendor/SCRYPT-JS-LICENSE.txt', TEXT_TYPE, STATIC_CSP)

// Desenle sunulan klasörler: yalnızca adı desene uyan, alt klasörü olmayan dosyalar
const DIRS = Object.freeze([
  { prefix: '/js/', dir: 'js', pattern: /^[0-9a-z-]+\.js$/, type: JS_TYPE },
  { prefix: '/css/', dir: 'css', pattern: /^[0-9a-z-]+\.css$/, type: CSS_TYPE },
  { prefix: '/css/skins/', dir: 'css/skins', pattern: /^[0-9a-z-]+\.css$/, type: CSS_TYPE },
  { prefix: '/fonts/', dir: 'fonts', pattern: /^[a-z0-9-]+\.woff2$/, type: 'font/woff2' },
  { prefix: '/fonts/', dir: 'fonts', pattern: /^[A-Za-z0-9-]+\.txt$/, type: TEXT_TYPE }
])
// Windows'ta aygıt adları (ör. con.js) dosya değil aygıt açar, sunucuyla aynı biçimde reddedilir
const WINDOWS_DEVICE_RE = /^(con|prn|aux|nul|com\d|lpt\d)\./i

// Yol için beyaz liste girdisi: { file, type, csp } veya null. pathname URL ayrıştırıcısından
// gelen ham (yüzde kodu çözülmemiş) yoldur, sorgu içermez.
function resolveStatic (pathname) {
  if (typeof pathname !== 'string') return null
  const fixed = FIXED.get(pathname)
  if (fixed) return fixed
  for (const def of DIRS) {
    if (!pathname.startsWith(def.prefix)) continue
    const name = pathname.slice(def.prefix.length)
    if (!def.pattern.test(name) || WINDOWS_DEVICE_RE.test(name)) continue
    return { file: def.dir + '/' + name, type: def.type, csp: STATIC_CSP }
  }
  return null
}

// public/ altındaki göreli dosya yolu (ör. "js/01-core.js") paketlenecek bir dosya mı?
// Yalnızca kendi adresiyle birebir aynı dosyaya çözülen yollar kabul edilir.
function isServableFile (rel) {
  if (typeof rel !== 'string' || rel === '' || rel.startsWith('/')) return false
  const entry = resolveStatic('/' + rel)
  return Boolean(entry) && entry.file === rel
}

function baseHeaders () {
  return Object.assign({}, SECURITY_HEADERS)
}

function textResponse (status, text, extra) {
  const headers = Object.assign(baseHeaders(), {
    'Content-Type': TEXT_TYPE,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': STATIC_CSP
  }, extra || {})
  return new Response(text, { status, headers })
}

// Paketlenmiş bir dosyanın yanıtı. files: Map<göreli yol, Buffer> (doğrulanmış dosyalar).
// Sıra sunucudakiyle aynıdır: beyaz listede olmayan yol 404, GET ve HEAD dışındaki yöntem 405,
// pakette bulunmayan dosya 404.
function staticResponse (method, pathname, files, notFoundText) {
  const notFound = notFoundText || 'Not found'
  const entry = resolveStatic(pathname)
  if (!entry) return textResponse(404, notFound)
  if (method !== 'GET' && method !== 'HEAD') return textResponse(405, 'Method not allowed', { Allow: 'GET, HEAD' })
  const data = files.get(entry.file)
  if (!data) return textResponse(404, notFound)
  const headers = Object.assign(baseHeaders(), {
    'Content-Type': entry.type,
    'Cache-Control': 'no-cache',
    'Content-Security-Policy': entry.csp,
    'Content-Length': String(data.length)
  })
  return new Response(method === 'HEAD' ? null : data, { status: 200, headers })
}

// Uygulamanın kendi küçük sayfalarının (sunucu adresi ekranı, ekran paylaşımı seçicisi) yanıtı.
// routes: Map<yol, { data: Buffer, type, csp }>, yalnızca birebir eşleşen yollar sunulur.
function pageResponse (method, pathname, routes, notFoundText) {
  const notFound = notFoundText || 'Not found'
  const route = routes.get(pathname)
  if (!route) return textResponse(404, notFound)
  if (method !== 'GET' && method !== 'HEAD') return textResponse(405, 'Method not allowed', { Allow: 'GET, HEAD' })
  const headers = Object.assign(baseHeaders(), {
    'Content-Type': route.type,
    'Cache-Control': 'no-store',
    'Content-Security-Policy': route.csp,
    'Content-Length': String(route.data.length)
  })
  return new Response(method === 'HEAD' ? null : route.data, { status: 200, headers })
}

module.exports = {
  HTML_TYPE,
  JS_TYPE,
  TEXT_TYPE,
  CSS_TYPE,
  SECURITY_HEADERS,
  resolveStatic,
  isServableFile,
  textResponse,
  staticResponse,
  pageResponse
}
