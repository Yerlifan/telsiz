'use strict'

// Frekanslar: her Telsiz sunucusu bir frekanstır, kişi birden çok frekansa katılabilir. Üstteki frekans
// bandı (#band, 04-meta.js renderBand çizer, 21-band.js etkileşimi yönetir) katılınan frekansları dizer:
// her istasyon bir frekanstır (ad, alt satırda adres veya çevrimiçi sayısı, durum noktası, okunmamış ve
// anma rozeti). İbre açık frekanstadır, başka bir istasyonu ayarlamak o frekansa geçer. Bandın + düğmesi
// Frekans ekle, Tümü düğmesi Frekanslar sayfasını (#frekans-sheet) açar. Yazı ve ses odaları bantta değil,
// sağdaki İstasyonlar listesindedir (04-meta.js renderInbox).
// Üst çubuğun solundaki frekans adı (#frekans-button) küçük bir menü açar (#frekans-menu): açık frekansın
// bilgisi, Tüm frekanslar, Frekans ekle ve frekans ayarlarına kısayollar. Menü katman yığınını kullanır
// (02-state-dom.js): ok tuşları, Home ve End gezer, Esc ve kolun daire düğmesi kapatır.
//
// Durum noktası: açık (ibrenin olduğu frekans), çevrimiçi, çevrimdışı, giriş gerekli veya bilinmiyor.
// Okunmamış rozeti açık frekansta odaların ve özel mesajların toplamıdır (ayarlı oda hariç), anma rozeti
// sizi anan mesajlar ile özel mesajların toplamıdır (frekansOwnCounts).
//
// İki çalışma biçimi vardır:
// - Masaüstü uygulaması (20-desktop.js window.telsizDesktop): liste ana süreçte tutulur ve doğrulanır,
//   geçişte uygulama penceresi o frekansın oturum bölümüyle yeniden açılır (her frekansın girişi ayrı
//   korunur). Frekans ekle masaüstünün adres penceresini açar. Ana süreç açık olmayan frekansların
//   durumunu (sunucuya erişilebilirlik, arka plan penceresinin saydığı okunmamış ve anma sayıları,
//   25-arka-plan.js) window.telsizArkaPlan.onState ile bildirir, bant bunları gösterir.
// - Tarayıcı ve PWA: tarayıcı her kökeni yalıttığı için bu sayfa başka frekansların sunucusuna bağlanamaz
//   (CSP connect-src 'self'). Bu yüzden diğer frekansların durumu ve sayıları gösterilmez (istasyonun
//   ipucu ve erişilebilir adı nedenini söyler). Liste yalnızca bu tarayıcıda, bu kökenin yerel deposunda
//   tutulur ('telsiz.frekanslar'), açık frekansın banttaki yeri 'telsiz.frekanslar.konum' içindedir.
//   Başka bir frekans seçilince sekme o adrese gider (location.assign) ve liste bant sırasıyla adresin
//   # parçasında taşınır: #frekanslar=<base64url JSON>. Karşı köken açılışta parçayı okur (03-auth.js
//   readFragment), her öğeyi sıkı biçimde doğrular, kendi listesine ekler ve parçayı adresten siler.
//   Yerel listedeki her frekans gelen listede de varsa sıra gelen listeye uyar, böylece bant her kökende
//   aynı sırada kalır ve L1 ile R1 frekanslar arasında döngüsel gezer. Parçada yalnızca adresler ve
//   görünen adlar vardır, hiçbir anahtar veya oturum bilgisi yoktur. Davet bağlantısının #davet= ve
//   #anahtar= parçalarıyla çakışmaz (ayrı ad, base64url & ve = içermez).
//
// Adres kuralları masaüstüyle aynıdır (desktop/src/lib/server-url.js): yalnızca https://, tek istisna bu
// bilgisayardaki sunucu (http://localhost ve http://127.0.0.1). Kullanıcı adı, parola, yol, sorgu ve #
// bulunamaz. Saklanan değer normalleştirilmiş kökendir.

const FREKANS_STORAGE_KEY = 'telsiz.frekanslar'
const FREKANS_POSITION_KEY = 'telsiz.frekanslar.konum'
const FREKANS_FRAGMENT_KEY = 'frekanslar'
const FREKANS_MAX_ITEMS = 30
const FREKANS_MAX_NAME = 100
const FREKANS_MAX_INPUT = 300
const FREKANS_MAX_FRAGMENT = 8000
const FREKANS_LOOPBACK = ['localhost', '127.0.0.1']
// Masaüstünde arka planda sayılan en fazla frekans sayısı (desktop/src/lib/background.js MAX_WINDOWS ile aynı)
const FREKANS_BG_MAX = 8
const FREKANS_STATUSES = ['open', 'online', 'offline', 'login', 'unknown']
const FREKANS_BG_STATES = ['ok', 'login', 'offline', 'error', 'starting']
const FREKANS_MAX_COUNT = 100000

const frekansState = {
  bound: false,
  reportedName: null,
  // Masaüstü: ana süreçten gelen liste ({ origin, name, host, active, order }), yüklenene kadar null
  desktopItems: null,
  loading: false,
  // Masaüstü: açık olmayan frekansların ana süreçten gelen durumu, kökene göre
  bg: Object.create(null),
  bgBound: false,
  // Tarayıcı: yerel listenin önbelleği (her çizimde depodan okunmaz), null ise okunur
  webList: null
}

// ------------------------------------------------------------------ doğrulama ve liste

function frekansUnsafeCode (code) {
  return code <= 0x1f || code === 0x7f || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) || code === 0xfeff
}

// Kullanıcının yazdığı adresi doğrular. Şema yazılmamışsa https:// varsayılır.
// Sonuç: { ok: true, origin } veya { ok: false, code } (code: invalid, too_long, insecure, credentials, path)
function frekansParseAddress (input) {
  if (typeof input !== 'string') return { ok: false, code: 'invalid' }
  const text = input.trim()
  if (text === '') return { ok: false, code: 'invalid' }
  if (text.length > FREKANS_MAX_INPUT) return { ok: false, code: 'too_long' }
  let i = 0
  while (i < text.length) {
    const code = text.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f || code === 0x5c || frekansUnsafeCode(code)) return { ok: false, code: 'invalid' }
    i += 1
  }
  const candidate = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text) ? text : 'https://' + text
  let url = null
  try {
    url = new URL(candidate)
  } catch (err) {
    return { ok: false, code: 'invalid' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, code: 'invalid' }
  if (url.hostname === '') return { ok: false, code: 'invalid' }
  if (url.protocol === 'http:' && FREKANS_LOOPBACK.indexOf(url.hostname) === -1) return { ok: false, code: 'insecure' }
  if (url.username !== '' || url.password !== '') return { ok: false, code: 'credentials' }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return { ok: false, code: 'path' }
  // Ayrıştırıcının sildiği parçalar da reddedilir (yalnızca ? veya # ile biten adresler, /%2e%2e/ gibi yollar)
  const rest = candidate.slice(candidate.indexOf('//') + 2)
  const cut = rest.search(/[/?#]/)
  if (cut !== -1 && rest.slice(cut) !== '/') return { ok: false, code: 'path' }
  return { ok: true, origin: url.protocol + '//' + url.host }
}

// Saklanmış veya parçadan gelen kökenin hâlâ geçerli ve normalleştirilmiş olup olmadığı
function frekansValidOrigin (value) {
  if (typeof value !== 'string') return false
  const parsed = frekansParseAddress(value)
  return parsed.ok && parsed.origin === value
}

// Görünen ad tek satır, en fazla FREKANS_MAX_NAME karakter. Geçersizse null.
function frekansCleanName (value) {
  if (typeof value !== 'string') return null
  let out = ''
  let i = 0
  while (i < value.length) {
    out += frekansUnsafeCode(value.charCodeAt(i)) ? ' ' : value.charAt(i)
    i += 1
  }
  out = out.replace(/\s+/g, ' ').trim()
  if (out === '' || out.length > FREKANS_MAX_NAME) return null
  return out
}

// Liste doğrulaması: geçerli köken, yinelenen yok, en fazla FREKANS_MAX_ITEMS öğe. exclude: listeye
// alınmayacak köken (bu sayfanın kendi kökeni).
function frekansSanitizeList (raw, exclude) {
  const out = []
  if (!Array.isArray(raw)) return out
  const seen = {}
  raw.forEach((item) => {
    if (out.length >= FREKANS_MAX_ITEMS || !item || typeof item !== 'object' || Array.isArray(item)) return
    const origin = item.origin
    if (!frekansValidOrigin(origin) || origin === exclude || Object.prototype.hasOwnProperty.call(seen, origin)) return
    seen[origin] = true
    out.push({ origin: origin, name: frekansCleanName(item.name) })
  })
  return out
}

// Gelen listeyi yerel listeye ekler. Yerelde zaten olan frekansın adı korunur (başka bir kökenden gelen
// ad yerel adı ezemez), yeni frekanslar gelen adla eklenir. Sonuç yeni bir dizidir.
function frekansMergeLists (local, incoming, exclude) {
  const out = frekansSanitizeList(local, exclude)
  const known = {}
  out.forEach((item) => {
    known[item.origin] = true
  })
  frekansSanitizeList(incoming, exclude).forEach((item) => {
    if (out.length >= FREKANS_MAX_ITEMS || Object.prototype.hasOwnProperty.call(known, item.origin)) return
    known[item.origin] = true
    out.push(item)
  })
  return out
}

function frekansHost (origin) {
  try {
    return new URL(origin).host
  } catch (err) {
    return String(origin || '')
  }
}

function frekansDisplayName (item) {
  return item && item.name ? item.name : frekansHost(item ? item.origin : '')
}

// ------------------------------------------------------------------ adres parçası (base64url JSON)

function frekansToBase64Url (text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  let i = 0
  while (i < bytes.length) {
    bin += String.fromCharCode(bytes[i])
    i += 1
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function frekansFromBase64Url (text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) return null
  let b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  let bin = ''
  try {
    bin = atob(b64)
  } catch (err) {
    return null
  }
  const bytes = new Uint8Array(bin.length)
  let i = 0
  while (i < bin.length) {
    bytes[i] = bin.charCodeAt(i)
    i += 1
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch (err) {
    return null
  }
}

// Liste parçaya yazılır: { v: 1, f: [[köken, ad veya null], ...] }. Yalnızca adres ve ad taşınır.
function frekansEncodeList (list) {
  const items = frekansSanitizeList(list, null).map((item) => [item.origin, item.name])
  let text = frekansToBase64Url(JSON.stringify({ v: 1, f: items }))
  // Çok uzunsa sondan kısaltılır (adres çubuğu sınırları)
  while (text.length > FREKANS_MAX_FRAGMENT && items.length > 1) {
    items.pop()
    text = frekansToBase64Url(JSON.stringify({ v: 1, f: items }))
  }
  return text
}

// Parçadaki listeyi çözer, her öğeyi doğrular. Bozuk veya beklenmeyen biçimde boş dizi döner.
function frekansDecodeList (text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > FREKANS_MAX_FRAGMENT) return []
  const json = frekansFromBase64Url(text)
  if (json === null) return []
  let data = null
  try {
    data = JSON.parse(json)
  } catch (err) {
    return []
  }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.v !== 1 || !Array.isArray(data.f)) return []
  const raw = []
  data.f.slice(0, FREKANS_MAX_ITEMS * 2).forEach((pair) => {
    if (!Array.isArray(pair) || pair.length < 1 || pair.length > 2) return
    if (pair[1] !== undefined && pair[1] !== null && typeof pair[1] !== 'string') return
    raw.push({ origin: pair[0], name: pair[1] })
  })
  return frekansSanitizeList(raw, null)
}

// ------------------------------------------------------------------ tarayıcıdaki liste

function frekansSelfOrigin () {
  try {
    return window.location.origin
  } catch (err) {
    return ''
  }
}

function frekansReadLocal () {
  let raw = null
  try {
    raw = window.localStorage.getItem(FREKANS_STORAGE_KEY)
  } catch (err) {
    raw = null
  }
  if (!raw || raw.length > 64 * 1024) return []
  try {
    return frekansSanitizeList(JSON.parse(raw), frekansSelfOrigin())
  } catch (err) {
    return []
  }
}

function frekansWriteLocal (list) {
  const clean = frekansSanitizeList(list, frekansSelfOrigin())
  try {
    window.localStorage.setItem(FREKANS_STORAGE_KEY, JSON.stringify(clean))
  } catch (err) {
    // Depolama kapalı veya dolu: liste bu oturumla sınırlı kalır
  }
  frekansState.webList = clean
  frekansChanged()
  return clean
}

// Açık frekansın banttaki yeri (0 en başta). Geçersiz veya yoksa 0.
function frekansReadPosition () {
  let raw = null
  try {
    raw = window.localStorage.getItem(FREKANS_POSITION_KEY)
  } catch (err) {
    raw = null
  }
  const n = Number(raw)
  return raw !== null && isFinite(n) && n >= 0 && n <= FREKANS_MAX_ITEMS ? Math.floor(n) : 0
}

function frekansWritePosition (index) {
  try {
    window.localStorage.setItem(FREKANS_POSITION_KEY, String(Math.max(0, Math.min(FREKANS_MAX_ITEMS, Math.floor(index) || 0))))
  } catch (err) {
    // Depolama kapalı: sıra bu oturumla sınırlı kalır
  }
}

// 03-auth.js readFragment çağırır: #frekanslar= parçasındaki listeyi yerel listeye ekler. Yerel listedeki
// her frekans gelen listede de varsa sıra gelen listeye uyar ve bu frekansın yeri saklanır.
function frekansMergeFragment (value) {
  if (frekansDesktop()) return 0
  const incoming = frekansDecodeList(value)
  if (!incoming.length) return 0
  const self = frekansSelfOrigin()
  const before = frekansReadLocal()
  const merged = frekansMergeLists(before, incoming, self)
  const order = incoming.map((item) => item.origin)
  const selfIndex = order.indexOf(self)
  const covered = before.every((item) => order.indexOf(item.origin) !== -1)
  if (covered && selfIndex !== -1) {
    const rest = order.filter((origin) => origin !== self)
    merged.sort((a, b) => rest.indexOf(a.origin) - rest.indexOf(b.origin))
    frekansWritePosition(selfIndex)
  }
  frekansWriteLocal(merged)
  return merged.length - before.length
}

// Tarayıcıda bant sırası: yerel liste ve açık frekans saklanan yerinde
function frekansWebItems () {
  const self = frekansSelfOrigin()
  if (!frekansState.webList) frekansState.webList = frekansReadLocal()
  const items = frekansState.webList.map((item) => ({ origin: item.origin, name: item.name, host: frekansHost(item.origin), active: false }))
  const pos = Math.min(frekansReadPosition(), items.length)
  items.splice(pos, 0, { origin: self, name: frekansCleanName(state.serverName), host: frekansHost(self), active: true })
  items.forEach((item, i) => {
    item.order = i
  })
  return items
}

// ------------------------------------------------------------------ masaüstü

function frekansDesktop () {
  const d = window.telsizDesktop
  if (typeof bgModeActive === 'function' && bgModeActive()) return null
  return d && typeof d === 'object' && typeof d.listFrequencies === 'function' ? d : null
}

// Masaüstünde açık olmayan frekansların durumu için ön yükleme betiğinin verdiği nesne
function frekansBackgroundApi () {
  const a = window.telsizArkaPlan
  return frekansDesktop() && a && typeof a === 'object' && a.background === false ? a : null
}

// Sunucunun adı öğrenilince (03-auth.js applyInfo, 04-meta.js renderServerName) masaüstüne bildirilir
function frekansNoteName (name) {
  const d = frekansDesktop()
  if (!d || typeof d.setFrequencyName !== 'function' || !state.info) return
  const clean = frekansCleanName(name)
  if (!clean || clean === frekansState.reportedName) return
  frekansState.reportedName = clean
  Promise.resolve(d.setFrequencyName(clean)).catch(() => {})
}

// Ana süreçten gelen listeyi doğrular: [{ origin, name, host, active, order }], kayıt sırasıyla
function frekansDesktopList (data) {
  const items = data && Array.isArray(data.items) ? data.items : []
  return items.filter((item) => item && frekansValidOrigin(item.origin)).map((item, i) => ({
    origin: item.origin,
    name: item.active === true ? (frekansCleanName(state.serverName) || frekansCleanName(item.name)) : frekansCleanName(item.name),
    host: frekansHost(item.origin),
    active: item.active === true,
    order: typeof item.order === 'number' && isFinite(item.order) && item.order >= 0 ? Math.floor(item.order) : i
  }))
}

// Kayıtlı frekanslar: [{ origin, name, host, active, order }]. Masaüstünde ana süreçten okunur ve bant
// için saklanır, tarayıcıda yerel listeden üretilir.
function frekansLoadItems () {
  const d = frekansDesktop()
  if (d) {
    return Promise.resolve(d.listFrequencies()).then((data) => {
      const items = frekansDesktopList(data)
      frekansState.desktopItems = items
      return items
    }, () => frekansState.desktopItems || [])
  }
  return Promise.resolve(frekansWebItems())
}

// Masaüstünde listeyi yeniden okur ve bandı yeniler
function frekansRefresh () {
  if (!frekansDesktop() || frekansState.loading) return
  frekansState.loading = true
  frekansLoadItems().then(() => {
    frekansState.loading = false
    frekansChanged()
  }, () => {
    frekansState.loading = false
  })
}

// Liste veya durum değişince bant, Tümü sayfası ve menü yeniden çizilir
function frekansChanged () {
  if (typeof state === 'undefined' || !state.inApp || typeof renderBand !== 'function') return
  renderBand()
}

function frekansCount (value) {
  return typeof value === 'number' && isFinite(value) && value >= 0 ? Math.min(FREKANS_MAX_COUNT, Math.floor(value)) : 0
}

// Ana süreçten gelen arka plan durumu (ön yükleme betiği zaten süzer, burada yeniden doğrulanır):
// { items: [{ origin, state, unread, mention, online, onlineUsers }] } -> kökene göre harita
function frekansCleanBackground (data) {
  const out = Object.create(null)
  const items = data && Array.isArray(data.items) ? data.items.slice(0, 60) : []
  items.forEach((item) => {
    if (!item || typeof item !== 'object' || !frekansValidOrigin(item.origin)) return
    out[item.origin] = {
      state: FREKANS_BG_STATES.indexOf(item.state) !== -1 ? item.state : null,
      unread: frekansCount(item.unread),
      mention: frekansCount(item.mention),
      online: item.online === true ? true : (item.online === false ? false : null),
      onlineUsers: typeof item.onlineUsers === 'number' ? frekansCount(item.onlineUsers) : null
    }
  })
  return out
}

function frekansApplyBackground (data) {
  frekansState.bg = frekansCleanBackground(data)
  frekansChanged()
}

// Masaüstünde ana sürecin arka plan durumuna abone olunur (bir kez)
function frekansListenBackground () {
  const a = frekansBackgroundApi()
  if (!a || frekansState.bgBound) return
  frekansState.bgBound = true
  if (typeof a.onState === 'function') a.onState(frekansApplyBackground)
  if (typeof a.getState === 'function') {
    Promise.resolve(a.getState()).then(frekansApplyBackground, () => {})
  }
}

// ------------------------------------------------------------------ bant modeli

// Açık frekansın sayıları: odaların okunmamışları (ayarlı oda hariç) ve özel mesajlar; anma rozeti sizi
// anan mesajlar ile özel mesajların toplamıdır. Arka plan penceresi aynı kuralı kullanır (25-arka-plan.js).
function frekansOwnCounts () {
  let unread = 0
  let mention = 0
  const tunedRoom = typeof currentViewMode === 'function' && currentViewMode() === 'channel' ? state.channelId : null
  if (typeof textChannels === 'function') {
    textChannels().forEach((c) => {
      if (tunedRoom !== null && tunedRoom !== undefined && sameId(c.id, tunedRoom)) return
      unread += Number(state.unread[c.id]) || 0
      if (typeof mentionCount === 'function') mention += mentionCount(c.id)
    })
  }
  const dm = typeof bandDmUnread === 'function' ? bandDmUnread() : 0
  unread += dm
  mention += dm
  const online = state.meta && typeof onlineCount === 'function' ? onlineCount() : null
  return { unread: unread, mention: mention, online: online }
}

// Durum noktası: open (açık frekans), online, offline, login (giriş gerekli), unknown. Tarayıcıda diğer
// frekansların durumu bilinemez.
function frekansStatusOf (item, report, desktop) {
  if (item && item.active) return 'open'
  if (!desktop || !report) return 'unknown'
  if (report.state === 'login') return 'login'
  if (report.online === true) return 'online'
  if (report.online === false || report.state === 'offline') return 'offline'
  return 'unknown'
}

// Bandın, Tümü sayfasının ve testlerin kullandığı saf model. items: kayıtlı frekanslar, ctx: { desktop,
// bg (kökene göre arka plan durumu), own (açık frekansın sayıları) }. Sonuç bant sırasıyla istasyonlardır.
function frekansBandModel (items, ctx) {
  const c = ctx || {}
  const desktop = Boolean(c.desktop)
  const bg = c.bg || {}
  const own = c.own || { unread: 0, mention: 0, online: null }
  const list = (Array.isArray(items) ? items : []).filter((item) => item && typeof item === 'object')
  const indexed = list.map((item, i) => ({ item: item, i: i }))
  indexed.sort((a, b) => {
    const oa = typeof a.item.order === 'number' ? a.item.order : a.i
    const ob = typeof b.item.order === 'number' ? b.item.order : b.i
    return oa === ob ? a.i - b.i : oa - ob
  })
  return indexed.map((entry) => {
    const item = entry.item
    const active = item.active === true
    const name = frekansDisplayName(item)
    const host = item.host || frekansHost(item.origin)
    const report = !active && desktop && item.origin && Object.prototype.hasOwnProperty.call(bg, item.origin) ? bg[item.origin] : null
    const status = frekansStatusOf(item, report, desktop)
    let unread = 0
    let mention = 0
    let known = false
    if (active) {
      unread = frekansCount(own.unread)
      mention = frekansCount(own.mention)
      known = true
    } else if (report && report.state === 'ok') {
      unread = frekansCount(report.unread)
      mention = frekansCount(report.mention)
      known = true
    }
    let sub = host
    if (status === 'open') sub = typeof own.online === 'number' ? t('bant.openSub', { count: own.online }) : t('bant.status.open')
    else if (status === 'login' || status === 'offline') sub = t('bant.status.' + status)
    else if (status === 'online' && report && typeof report.onlineUsers === 'number') sub = t('bant.onlineSub', { count: report.onlineUsers })
    // Adı bilinmeyen frekansta ad zaten adrestir, alt satır tekrarlamaz
    if (sub === name) sub = t('bant.switchSub')
    const parts = [name, t('bant.status.' + status)]
    const hidden = !desktop && !active
    if (hidden) parts.push(t('bant.webHiddenShort'))
    if (known && unread > 0) parts.push(t('bant.unreadPart', { count: unread }))
    if (known && mention > 0) parts.push(t('bant.mentionPart', { count: mention }))
    return {
      key: item.origin || 'self',
      origin: item.origin || '',
      name: name,
      host: host,
      status: FREKANS_STATUSES.indexOf(status) !== -1 ? status : 'unknown',
      unread: unread,
      mention: mention,
      known: known,
      tuned: active,
      hidden: hidden,
      sub: sub,
      label: parts.join(', '),
      title: hidden ? t('bant.webHidden') : host
    }
  })
}

// Bantta şu an gösterilecek frekanslar. Masaüstünde liste henüz gelmediyse yalnızca açık frekans.
function frekansCurrentItems () {
  const d = frekansDesktop()
  if (!d) return frekansWebItems()
  if (frekansState.desktopItems && frekansState.desktopItems.length) {
    return frekansState.desktopItems.map((item) => Object.assign({}, item, item.active ? { name: frekansCleanName(state.serverName) || item.name } : {}))
  }
  return [{ origin: '', name: frekansCleanName(state.serverName), host: '', active: true, order: 0 }]
}

function frekansStations () {
  return frekansBandModel(frekansCurrentItems(), { desktop: Boolean(frekansDesktop()), bg: frekansState.bg, own: frekansOwnCounts() })
}

// Çizim anahtarı: değişmeyen istasyon yeniden çizilmez
function frekansStationKey (st) {
  return [st.key, st.name, st.sub, st.status, st.unread, st.mention, st.tuned ? 1 : 0, st.label].join(':')
}

function frekansDot (status) {
  const dot = h('span', 'frekans-dot is-' + status)
  dot.setAttribute('aria-hidden', 'true')
  return dot
}

// Rozetler: anma köşede (@sayı), okunmamış satır içinde
function frekansMarks (node, st, inline) {
  if (!st.known) return
  if (st.unread > 0) {
    const mark = h('span', 'station-mark mark-unread frekans-unread', countText(st.unread))
    mark.setAttribute('aria-hidden', 'true')
    node.appendChild(mark)
  }
  if (st.mention > 0) {
    const mark = h('span', 'station-mark mark-mention' + (inline ? '' : ' frekans-mention'), '@' + countText(st.mention))
    mark.setAttribute('aria-hidden', 'true')
    node.appendChild(mark)
  }
}

// Banttaki frekans istasyonu (04-meta.js renderBand)
function frekansBuildStation (st) {
  const b = h('button', 'station station-frekans is-' + st.status)
  b.type = 'button'
  b.setAttribute('data-station', st.key)
  b.setAttribute('data-kind', 'frekans')
  b.setAttribute('data-focus-key', 'station-' + st.key)
  b.setAttribute('aria-label', st.label)
  b.title = st.title
  b.tabIndex = -1
  if (st.tuned) {
    b.classList.add('is-tuned')
    b.setAttribute('aria-current', 'page')
    b.appendChild(buildNeedle())
  }
  if (st.known && (st.unread > 0 || st.mention > 0)) b.classList.add('is-unread')
  if (st.known && st.mention > 0) b.classList.add('is-mentioned')
  const em = frekansEmblem(st.name)
  em.classList.add('station-emblem')
  em.appendChild(frekansDot(st.status))
  b.appendChild(em)
  const text = h('span', 'station-body')
  text.appendChild(h('span', 'station-name', st.name))
  const meta = h('span', 'station-meta')
  meta.appendChild(h('span', 'station-sub', st.sub))
  text.appendChild(meta)
  b.appendChild(text)
  frekansMarks(b, st, false)
  return b
}

// ------------------------------------------------------------------ geçiş, ekleme, çıkarma

function frekansSwitch (origin) {
  const d = frekansDesktop()
  if (d) {
    Promise.resolve(d.switchFrequency(origin)).then((res) => {
      if (!res || !res.ok) toast(() => t('frekans.failed'), 'error')
    }, () => toast(() => t('frekans.failed'), 'error'))
    return
  }
  if (!frekansValidOrigin(origin) || origin === frekansSelfOrigin()) return
  // Karşı köken listeyi bant sırasıyla parçadan alır: bu frekans (adıyla) ve diğer kayıtlı frekanslar
  const list = frekansWebItems().map((item) => ({ origin: item.origin, name: item.name }))
  const target = origin + '/#' + FREKANS_FRAGMENT_KEY + '=' + frekansEncodeList(list)
  try {
    window.location.assign(target)
  } catch (err) {
    toast(() => t('frekans.failed'), 'error')
  }
}

// Bant, Tümü sayfası ve kolun L1 ve R1 düğmeleri bunu çağırır. Açık frekans seçilirse bir şey olmaz. Ses
// odasındayken geçiş bağlantıyı keseceği için önce onay istenir.
function frekansTune (key, trigger) {
  if (!state.inApp || !key || key === 'self') return false
  const item = frekansCurrentItems().filter((entry) => entry.origin === key)[0]
  if (!item || item.active) return false
  const inVoice = typeof snap === 'function' && Boolean(snap().channelId)
  if (!inVoice) {
    frekansSwitch(item.origin)
    return true
  }
  const name = frekansDisplayName(item)
  openAppDialog({
    name: 'frekans-voice',
    titleKey: 'bant.voiceTitle',
    trigger: trigger || null,
    build: (body, close) => {
      body.appendChild(h('p', 'lead', t('frekans.voiceNote')))
      const row = h('div', 'row dialog-actions')
      const go = button('button', t('bant.voiceConfirm', { name: name }))
      go.id = 'frekans-voice-confirm'
      const cancel = button('button button-secondary', t('common.cancel'))
      cancel.id = 'frekans-voice-cancel'
      row.appendChild(go)
      row.appendChild(cancel)
      body.appendChild(row)
      cancel.addEventListener('click', () => close('dismiss'))
      go.addEventListener('click', () => {
        close('done')
        frekansSwitch(item.origin)
      })
      return cancel
    }
  })
  return true
}

function frekansAdd (trigger) {
  const d = frekansDesktop()
  if (d) {
    Promise.resolve(d.addFrequency()).catch(() => {})
    return
  }
  openAppDialog({
    name: 'frekans-add',
    titleKey: 'frekans.add',
    trigger: trigger,
    build: (body, close) => {
      const form = h('form', 'form frekans-add-form')
      form.id = 'frekans-add-form'
      form.noValidate = true
      form.appendChild(h('p', 'lead', t('frekans.addLead')))
      const label = h('label', 'label', t('frekans.addressLabel'))
      label.setAttribute('for', 'frekans-add-input')
      const input = h('input', 'input')
      input.id = 'frekans-add-input'
      input.type = 'text'
      input.setAttribute('inputmode', 'url')
      input.setAttribute('autocomplete', 'url')
      input.setAttribute('autocapitalize', 'off')
      input.setAttribute('spellcheck', 'false')
      input.maxLength = FREKANS_MAX_INPUT
      input.setAttribute('placeholder', 'https://')
      input.setAttribute('aria-describedby', 'frekans-add-hint frekans-add-error')
      const hint = h('p', 'hint', t('frekans.addressHint'))
      hint.id = 'frekans-add-hint'
      const msg = h('p', 'form-error')
      msg.id = 'frekans-add-error'
      msg.setAttribute('role', 'alert')
      msg.hidden = true
      const row = h('div', 'row dialog-actions')
      const save = button('button', t('frekans.addSubmit'))
      save.type = 'submit'
      save.id = 'frekans-add-submit'
      row.appendChild(save)
      form.appendChild(label)
      form.appendChild(input)
      form.appendChild(hint)
      form.appendChild(msg)
      form.appendChild(row)
      const fail = (text) => {
        msg.textContent = text
        msg.hidden = false
        input.setAttribute('aria-invalid', 'true')
        focusNode(input)
      }
      input.addEventListener('input', () => {
        msg.hidden = true
        input.removeAttribute('aria-invalid')
      })
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const parsed = frekansParseAddress(input.value)
        if (!parsed.ok) {
          fail(t('frekans.error.' + parsed.code))
          return
        }
        const list = frekansReadLocal()
        if (parsed.origin === frekansSelfOrigin() || list.some((item) => item.origin === parsed.origin)) {
          fail(t('frekans.exists'))
          return
        }
        if (list.length >= FREKANS_MAX_ITEMS) {
          fail(t('frekans.error.full', { max: FREKANS_MAX_ITEMS }))
          return
        }
        list.push({ origin: parsed.origin, name: null })
        frekansWriteLocal(list)
        close('saved')
        const host = frekansHost(parsed.origin)
        toast(() => t('frekans.added', { name: host }), 'ok')
      })
      body.appendChild(form)
      return input
    }
  })
}

function frekansRemove (item, trigger) {
  const d = frekansDesktop()
  const name = frekansDisplayName(item)
  openAppDialog({
    name: 'frekans-remove',
    titleKey: 'frekans.removeTitle',
    trigger: trigger,
    build: (body, close) => {
      body.appendChild(h('p', 'lead', t('frekans.removeText', { name: name, host: item.host })))
      let clearBox = null
      if (d && item.active) body.appendChild(h('p', 'hint', t('frekans.removeActiveNote')))
      if (d) {
        // Masaüstünde oturum verisi yalnızca açıkça seçilirse silinir, varsayılan korumaktır
        const wrap = h('label', 'check frekans-remove-clear')
        clearBox = h('input')
        clearBox.type = 'checkbox'
        clearBox.id = 'frekans-remove-clear'
        clearBox.checked = false
        wrap.appendChild(clearBox)
        wrap.appendChild(h('span', null, t('frekans.removeClear')))
        body.appendChild(wrap)
        body.appendChild(h('p', 'hint', t('frekans.removeClearHint')))
      }
      const row = h('div', 'row dialog-actions')
      const confirm = button('button button-danger', t('frekans.removeConfirm'))
      confirm.id = 'frekans-remove-confirm'
      const cancel = button('button button-secondary', t('common.cancel'))
      cancel.id = 'frekans-remove-cancel'
      row.appendChild(confirm)
      row.appendChild(cancel)
      body.appendChild(row)
      cancel.addEventListener('click', () => close('dismiss'))
      confirm.addEventListener('click', () => {
        if (d) {
          confirm.disabled = true
          Promise.resolve(d.removeFrequency(item.origin, Boolean(clearBox && clearBox.checked))).then((res) => {
            close('done')
            if (res && res.ok) {
              toast(() => t('frekans.removed', { name: name }), 'ok')
              frekansRefresh()
            } else {
              toast(() => t('frekans.failed'), 'error')
            }
          }, () => {
            close('done')
            toast(() => t('frekans.failed'), 'error')
          })
          return
        }
        frekansWriteLocal(frekansReadLocal().filter((entry) => entry.origin !== item.origin))
        close('done')
        toast(() => t('frekans.removed', { name: name }), 'ok')
      })
      return cancel
    }
  })
}


// ------------------------------------------------------------------ Frekanslar sayfası (Tümü)

// Bandın Tümü düğmesiyle açılan sayfa (#frekans-sheet, 12-init.js openSheet): her frekans büyük bir satırdır
// (durum, alt satır, okunmamış ve anma rozeti), açık frekans işaretlidir. Satıra basmak o frekansa geçer,
// satırın yanındaki düğme listeden çıkarır. Altta Frekans ekle ve çalışma biçimine göre bir not.
let frekansSheetKey = ''

function frekansSheetRow (st) {
  const li = h('li', 'frekans-sheet-li')
  const b = h('button', 'sheet-row frekans-sheet-row is-' + st.status)
  b.type = 'button'
  b.setAttribute('data-frekans', st.key)
  b.setAttribute('data-focus-key', 'frekans-sheet-' + st.key)
  b.setAttribute('aria-label', st.label)
  b.title = st.title
  if (st.tuned) {
    b.classList.add('is-current')
    b.setAttribute('aria-current', 'page')
  }
  const em = frekansEmblem(st.name)
  em.appendChild(frekansDot(st.status))
  b.appendChild(em)
  const text = h('span', 'sheet-row-body')
  text.appendChild(h('span', 'sheet-row-name', st.name))
  // Alt satır: durum veya çevrimiçi sayısı ve adres (adres zaten alt satırsa tekrarlanmaz)
  text.appendChild(h('span', 'sheet-row-sub', st.host && st.sub !== st.host ? st.sub + ' · ' + st.host : st.sub))
  b.appendChild(text)
  frekansMarks(b, st, true)
  if (st.tuned) b.appendChild(icon('i-check', 'sheet-row-check'))
  li.appendChild(b)
  const desktop = Boolean(frekansDesktop())
  // Tarayıcıda açık frekans listeden çıkarılamaz (bu sayfanın kendisidir)
  if (st.origin && (desktop || !st.tuned)) {
    const remove = h('button', 'icon-button frekans-remove')
    remove.type = 'button'
    remove.setAttribute('data-frekans-remove', st.origin)
    const label = t('frekans.removeLabel', { name: st.name })
    remove.setAttribute('aria-label', label)
    remove.title = label
    remove.appendChild(icon('i-close'))
    li.appendChild(remove)
  }
  return li
}

function frekansRenderSheet (stations) {
  const list = byId('frekans-sheet-list')
  if (!list) return
  const desktop = Boolean(frekansDesktop())
  const inVoice = typeof snap === 'function' && Boolean(snap().channelId)
  const key = [window.I18N ? window.I18N.lang : '', desktop ? 1 : 0, inVoice ? 1 : 0].concat(stations.map(frekansStationKey)).join('#')
  if (key === frekansSheetKey && list.childNodes.length) return
  frekansSheetKey = key
  const focusKey = typeof activeFocusKey === 'function' ? activeFocusKey(list) : null
  clear(list)
  list.appendChild(h('p', 'hint frekans-sheet-lead', t('bant.sheetLead')))
  const ul = h('ul', 'sheet-list frekans-sheet-list')
  ul.setAttribute('aria-label', t('frekans.title'))
  stations.forEach((st) => {
    ul.appendChild(frekansSheetRow(st))
  })
  list.appendChild(ul)
  if (inVoice && stations.length > 1) list.appendChild(h('p', 'hint frekans-note', t('frekans.voiceNote')))
  if (desktop && stations.length > 1) list.appendChild(h('p', 'hint frekans-note', t('bant.bgNote', { max: FREKANS_BG_MAX })))
  if (!desktop && stations.length > 1) list.appendChild(h('p', 'hint frekans-note', t('bant.webHidden')))
  if (typeof restoreFocusKey === 'function') restoreFocusKey(list, focusKey)
}

function onFrekansSheetClick (e) {
  const target = e.target && e.target.closest ? e.target : null
  if (!target) return
  const remove = target.closest('[data-frekans-remove]')
  if (remove && e.currentTarget.contains(remove)) {
    const origin = remove.getAttribute('data-frekans-remove')
    const item = frekansCurrentItems().filter((entry) => entry.origin === origin)[0]
    if (!item) return
    frekansRemove({ origin: item.origin, name: item.name, host: frekansHost(item.origin), active: item.active }, byId('band-all'))
    return
  }
  const row = target.closest('[data-frekans]')
  if (!row || !e.currentTarget.contains(row)) return
  const key = row.getAttribute('data-frekans')
  if (row.getAttribute('aria-current') === 'page') {
    if (typeof closeSheets === 'function') closeSheets()
    return
  }
  // Ses odasındayken onay penceresi açılır, sayfa onun altında açık kalır
  if (frekansTune(key, byId('band-all')) && !findLayer('app-dialog') && typeof closeSheets === 'function') closeSheets()
}

// Sayfadaki satırlar arasında yukarı ve aşağı ok, Home ve End
function onFrekansSheetKey (e) {
  const keys = ['ArrowDown', 'ArrowUp', 'Down', 'Up', 'Home', 'End']
  if (keys.indexOf(e.key) === -1) return
  const rows = Array.from(e.currentTarget.querySelectorAll('.frekans-sheet-row, .frekans-remove'))
  const i = rows.indexOf(document.activeElement)
  if (i === -1 || !rows.length) return
  e.preventDefault()
  let next = i
  if (e.key === 'ArrowDown' || e.key === 'Down') next = Math.min(rows.length - 1, i + 1)
  else if (e.key === 'ArrowUp' || e.key === 'Up') next = Math.max(0, i - 1)
  else if (e.key === 'Home') next = 0
  else next = rows.length - 1
  focusNode(rows[next])
}

// ------------------------------------------------------------------ menü

function frekansCloseMenu () {
  const layer = findLayer('frekans-menu')
  if (layer) closeLayer(layer, false)
}

// Menü üst çubuktaki düğmenin altında, solda açılır ve görünür alanda kalır
function frekansPositionMenu (menu, anchor) {
  const rect = anchor.getBoundingClientRect()
  menu.style.left = '0px'
  menu.style.top = '0px'
  const pw = menu.offsetWidth
  const ph = menu.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = rect.left
  if (left + pw > vw - 8) left = Math.max(8, vw - 8 - pw)
  if (left < 8) left = 8
  let top = rect.bottom + 6
  if (top + ph > vh - 8) top = Math.max(8, vh - 8 - ph)
  menu.style.left = Math.round(left) + 'px'
  menu.style.top = Math.round(top) + 'px'
}

function frekansEmblem (name) {
  const em = h('span', 'frekans-emblem', initial(name))
  em.setAttribute('aria-hidden', 'true')
  return em
}

function frekansMenuEntry (id, iconName, label, sub, handler) {
  const item = h('button', 'menu-item menu-entry frekans-entry')
  item.type = 'button'
  item.id = id
  item.setAttribute('role', 'menuitem')
  item.appendChild(icon(iconName))
  const text = h('span', 'frekans-item-text')
  text.appendChild(h('span', 'frekans-item-name', label))
  if (sub) text.appendChild(h('span', 'frekans-item-sub', sub))
  item.appendChild(text)
  item.addEventListener('click', () => {
    frekansCloseMenu()
    handler()
  })
  return item
}

// Menü: açık frekansın bilgisi (ad, adres, üye ve çevrimiçi sayısı) ve kısayollar. Frekans listesi bantta ve
// Tümü sayfasındadır, menü onu tekrarlamaz.
function frekansBuildMenu (menu, anchor) {
  clear(menu)
  const current = frekansStations().filter((st) => st.tuned)[0]
  const name = current ? current.name : (state.serverName || t('app.name'))
  const head = h('div', 'frekans-menu-head')
  head.appendChild(frekansEmblem(name))
  const text = h('span', 'frekans-item-text')
  text.appendChild(h('span', 'frekans-item-name', name))
  const users = typeof metaUsers === 'function' ? metaUsers().length : 0
  const online = typeof onlineCount === 'function' ? onlineCount() : 0
  const host = current && current.host ? current.host + ' · ' : ''
  text.appendChild(h('span', 'frekans-item-sub', host + t('bant.menuMembers', { count: users, online: online })))
  head.appendChild(text)
  menu.appendChild(head)
  menu.appendChild(menuSeparator())
  const count = frekansCurrentItems().length
  menu.appendChild(frekansMenuEntry('frekans-menu-all', 'i-radio', t('bant.menuAll'), t('bant.menuCount', { count: count }), () => {
    openSheet('frekans', anchor)
  }))
  menu.appendChild(frekansMenuEntry('frekans-add', 'i-plus', t('frekans.add'), t('frekans.addSub'), () => {
    frekansAdd(anchor)
  }))
  menu.appendChild(menuSeparator())
  if (typeof isAdmin === 'function' && isAdmin()) {
    menu.appendChild(frekansMenuEntry('frekans-menu-settings', 'i-server', t('bant.menuSettings'), '', () => {
      openSettings('general', anchor)
    }))
    menu.appendChild(frekansMenuEntry('frekans-menu-invite', 'i-user-plus', t('bant.menuInvite'), '', () => {
      openSettings('invite', anchor)
    }))
  }
  menu.appendChild(frekansMenuEntry('frekans-menu-keys', 'i-key', t('band.keys'), '', () => {
    openSettings('privacy', anchor)
  }))
  menu.addEventListener('keydown', onPopupMenuKey)
}

function frekansOpenMenu (anchor) {
  const menu = byId('frekans-menu')
  if (!menu || !state.inApp) return
  const existing = findLayer('frekans-menu')
  if (existing) {
    closeLayer(existing, false)
    return
  }
  frekansBuildMenu(menu, anchor)
  menu.hidden = false
  if (anchor) {
    frekansPositionMenu(menu, anchor)
    anchor.setAttribute('aria-expanded', 'true')
  }
  openLayer({
    name: 'frekans-menu',
    el: menu,
    trigger: anchor || null,
    level: 2,
    outside: true,
    closeOnFocusOut: true,
    initialFocus: () => menu.querySelector('button'),
    onClose: () => {
      menu.hidden = true
      menu.removeEventListener('keydown', onPopupMenuKey)
      clear(menu)
      if (anchor) anchor.setAttribute('aria-expanded', 'false')
    }
  })
}

// Üst çubuktaki düğmenin erişilebilir adı (04-meta.js renderServerName çağırır)
function frekansRenderButton () {
  const b = byId('frekans-button')
  if (!b) return
  b.setAttribute('aria-label', t('frekans.buttonLabel', { name: state.serverName || t('app.name') }))
}

function frekansInit () {
  if (frekansState.bound) return
  const b = byId('frekans-button')
  if (!b) return
  frekansState.bound = true
  b.addEventListener('click', () => {
    frekansOpenMenu(b)
  })
  const sheet = byId('frekans-sheet-list')
  if (sheet) {
    sheet.addEventListener('click', onFrekansSheetClick)
    sheet.addEventListener('keydown', onFrekansSheetKey)
  }
  const add = byId('frekans-sheet-add')
  if (add) {
    add.addEventListener('click', () => {
      frekansAdd(add)
    })
  }
  // Başka sekmede değişen liste (aynı köken) bu sekmenin bandına da yansır
  window.addEventListener('storage', (e) => {
    if (!e || (e.key !== FREKANS_STORAGE_KEY && e.key !== FREKANS_POSITION_KEY && e.key !== null)) return
    frekansState.webList = null
    frekansChanged()
  })
}

// Uygulama ekranı açılınca (04-meta.js openApp): masaüstünde liste ve arka plan durumu yüklenir
function frekansOnOpen () {
  frekansState.webList = null
  frekansListenBackground()
  frekansRefresh()
}

window.TelsizFrekans = {
  parseAddress: frekansParseAddress,
  validOrigin: frekansValidOrigin,
  cleanName: frekansCleanName,
  sanitizeList: frekansSanitizeList,
  mergeLists: frekansMergeLists,
  encodeList: frekansEncodeList,
  decodeList: frekansDecodeList,
  mergeFragment: frekansMergeFragment,
  readLocal: frekansReadLocal,
  bandModel: frekansBandModel,
  statusOf: frekansStatusOf,
  cleanBackground: frekansCleanBackground,
  open: frekansOpenMenu
}
