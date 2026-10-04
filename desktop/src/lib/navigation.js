'use strict'

// Gezinme ve yeni pencere kararları. Electron'a bağımlı değildir.
// Uygulama penceresi yalnızca telsiz://app/ belgesinde kalabilir, sunucu adresi penceresi yalnızca
// telsiz://baglan/ belgesinde, ekran paylaşımı seçicisi yalnızca telsiz://secici/ belgesinde.
// Diğer her gezinme engellenir. Uygulama penceresindeki https:// bağlantılar (ör. mesajdaki bir
// bağlantı) kullanıcının varsayılan tarayıcısında açılır, başka hiçbir şema dışarı verilmez.
// Yeni pencere hiçbir zaman açılmaz.

const { SCHEME, APP_HOST, CONNECT_HOST, PICKER_HOST } = require('./channels')

const MAX_EXTERNAL_URL = 2048
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

module.exports = { MAX_EXTERNAL_URL, originOf, isExternalUrl, decideNavigation, decideWindowOpen }
