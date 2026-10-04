'use strict'

// İçerik güvenliği politikaları (CSP). Uygulama sayfası sunucudaki politikanın birebir aynısını
// alır (src/http-util.js HTML_CSP, eşitlik desktop/test/csp.test.js ile denetlenir). 'self'
// telsiz://app kökenidir: betikler, stiller ve yazı tipleri yalnızca paketlenmiş dosyalardan,
// istekler (connect-src) yalnızca telsiz://app/api/ vekilinden yapılabilir. Sayfa sunucuya
// doğrudan bağlanamaz, her istek ana süreçten geçer.

function serialize (directives) {
  return directives.map((entry) => entry[0] + ' ' + entry[1]).join('; ')
}

const HTML_DIRECTIVES = Object.freeze([
  ['default-src', "'self'"],
  ['script-src', "'self'"],
  ['style-src', "'self'"],
  ['font-src', "'self'"],
  ['img-src', "'self' blob: data:"],
  ['media-src', "'self' blob:"],
  ['connect-src', "'self'"],
  ['worker-src', "'self'"],
  ['manifest-src', "'self'"],
  ['object-src', "'none'"],
  ['base-uri', "'none'"],
  ['form-action', "'self'"],
  ['frame-ancestors', "'none'"],
  // Telsiz DJ: YouTube'un resmi gömülü oynatıcısı çapraz kökenli çerçeve olarak (sunucudaki HTML_CSP ile aynı)
  ['frame-src', 'https://www.youtube-nocookie.com']
])

// Uygulama sayfası (index.html)
const HTML_CSP = serialize(HTML_DIRECTIVES)

// Betik, stil, yazı tipi ve görsel gibi diğer paketlenmiş dosyalar (sunucudaki API_CSP ile aynı)
const STATIC_CSP = "default-src 'none'; frame-ancestors 'none'"

// Vekilden dönen /api/ yanıtları: belge olarak açılsalar bile hiçbir şey çalıştıramazlar
const API_CSP = "default-src 'none'; sandbox; frame-ancestors 'none'"

// Sunucu adresi ekranı: yalnızca kendi betiği, stili ve logosu, hiçbir ağ isteği yok
const CONNECT_CSP = serialize([
  ['default-src', "'none'"],
  ['script-src', "'self'"],
  ['style-src', "'self'"],
  ['img-src', "'self'"],
  ['connect-src', "'none'"],
  ['object-src', "'none'"],
  ['base-uri', "'none'"],
  ['form-action', "'none'"],
  ['frame-ancestors', "'none'"]
])

// Ekran paylaşımı seçicisi: küçük resimler data: adresi olarak gelir, başka hiçbir kaynak yok
const PICKER_CSP = serialize([
  ['default-src', "'none'"],
  ['script-src', "'self'"],
  ['style-src', "'self'"],
  ['img-src', "'self' data:"],
  ['connect-src', "'none'"],
  ['object-src', "'none'"],
  ['base-uri', "'none'"],
  ['form-action', "'none'"],
  ['frame-ancestors', "'none'"]
])

module.exports = { serialize, HTML_DIRECTIVES, HTML_CSP, STATIC_CSP, API_CSP, CONNECT_CSP, PICKER_CSP }
