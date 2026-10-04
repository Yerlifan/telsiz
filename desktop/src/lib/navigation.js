'use strict'

// Gezinme ve yeni pencere kararları. Electron'a bağımlı değildir.
// Uygulama penceresi yalnızca telsiz://app/ belgesinde kalabilir, sunucu adresi penceresi yalnızca
// telsiz://baglan/ belgesinde, ekran paylaşımı seçicisi yalnızca telsiz://secici/ belgesinde.
// Diğer her gezinme engellenir. Uygulama penceresindeki https:// bağlantılar (ör. mesajdaki bir
// bağlantı) kullanıcının varsayılan tarayıcısında açılır, başka hiçbir şema dışarı verilmez.
// Yeni pencere hiçbir zaman açılmaz. Alt çerçevelerde yalnızca Telsiz DJ'nin YouTube oynatıcısı açılabilir.

const { SCHEME, APP_HOST, CONNECT_HOST, PICKER_HOST } = require('./channels')

const MAX_EXTERNAL_URL = 2048
// Telsiz DJ YouTube oynatıcısının çerçeve kökeni (src/lib/csp.js frame-src ile aynı)
const YOUTUBE_FRAME_HOST = 'www.youtube-nocookie.com'
// YouTube oynatıcısı çerçevesinin dış tarayıcıda açtırabileceği adreslerin ana bilgisayarları
const YOUTUBE_LINK_HOSTS = new Set(['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'])
const DOCUMENT_PATHS = {
  app: new Set(['/', '/index.html']),
  connect: new Set(['/', '/baglan.html']),
  picker: new Set(['/', '/secici.html'])
}
const HOSTS = { app: APP_HOST, connect: CONNECT_HOST, picker: PICKER_HOST }

// Node'un URL nesnesi özel şemalarda origin değerini 'null' verir, köken burada hesaplanır.
// Desteklenen şemalar dışında null döner.
function originOf (value) {
  if (typeof value !== 'string' || value === '') return null
  let url
  try {
    url = new URL(value)
  } catch (err) {
    return null
  }
  if (url.protocol === SCHEME + ':' || url.protocol === 'https:' || url.protocol === 'http:') {
    if (url.host === '') return null
    return url.protocol + '//' + url.host
  }
  return null
}

// Dış tarayıcıda açılabilecek adres: yalnızca https, kullanıcı adı ve parola yok, uzunluk sınırlı
function isExternalUrl (value) {
  if (typeof value !== 'string' || value.length > MAX_EXTERNAL_URL) return false
  let url
  try {
    url = new URL(value)
  } catch (err) {
    return false
  }
  return url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === ''
}

// context: 'app', 'connect' veya 'picker' (bilinmeyen içerik için başka herhangi bir değer)
// Sonuç: 'allow' (aynı belgede kal), 'external' (tarayıcıda aç) veya 'deny'
function decideNavigation (value, context) {
  const paths = DOCUMENT_PATHS[context]
  if (paths && typeof value === 'string') {
    let url = null
    try {
      url = new URL(value)
    } catch (err) {
      url = null
    }
    if (url && url.protocol === SCHEME + ':' && url.host === HOSTS[context] && paths.has(url.pathname)) return 'allow'
  }
  return isExternalUrl(value) ? 'external' : 'deny'
}

// window.open ve target=_blank: yeni pencere açılmaz, https bağlantı tarayıcıya verilir
function decideWindowOpen (value) {
  return isExternalUrl(value) ? 'external' : 'deny'
}

// Uygulama penceresindeki window.open kararı, açanın yönlendiren adresiyle (details.referrer.url).
// YouTube oynatıcısı çerçevesi (Google'ın kodu) kullanıcı hareketi olmadan da pencere açabilir (Electron
// 44.5.1 ile doğrulandı). Bu çerçeveden gelen açma isteği yalnızca YouTube adreslerine ("YouTube'da izle")
// gider, reklam ve başka siteler dış tarayıcıda açılmaz. Yönlendiren adresi göndermeyen (noreferrer) açma
// isteğinin hangi çerçeveden geldiği bilinemez, decideWindowOpen kuralı uygulanır.
function decideAppWindowOpen (value, referrer) {
  if (decideWindowOpen(value) !== 'external') return 'deny'
  if (originOf(referrer) !== 'https://' + YOUTUBE_FRAME_HOST) return 'external'
  return YOUTUBE_LINK_HOSTS.has(new URL(value).hostname) ? 'external' : 'deny'
}

// Alt çerçeve gezinmesi (will-frame-navigate ve alt çerçevedeki will-redirect). Tek izin Telsiz DJ'nin
// YouTube oynatıcısıdır (public/dj/youtube.js): uygulama penceresinin ana çerçevesinin doğrudan alt
// çerçevesi, yalnızca https://www.youtube-nocookie.com kökenine (sayfanın CSP'sindeki frame-src ile aynı).
// YouTube çerçevesinin içindeki çerçeveler (ör. reklam çerçeveleri) ve diğer her alt çerçeve engellenir.
// depth: çerçevenin ana çerçeveye uzaklığı (doğrudan alt çerçeve 1). Sonuç: 'allow' veya 'deny'.
function decideFrameNavigation (value, context, depth) {
  if (context !== 'app' || depth !== 1 || typeof value !== 'string' || value.length > MAX_EXTERNAL_URL) return 'deny'
  let url
  try {
    url = new URL(value)
  } catch (err) {
    return 'deny'
  }
  if (url.username !== '' || url.password !== '') return 'deny'
  return url.protocol === 'https:' && url.host === YOUTUBE_FRAME_HOST ? 'allow' : 'deny'
}

module.exports = { MAX_EXTERNAL_URL, YOUTUBE_FRAME_HOST, YOUTUBE_LINK_HOSTS, originOf, isExternalUrl, decideNavigation, decideWindowOpen, decideAppWindowOpen, decideFrameNavigation }
