'use strict'

// Kayıtlı frekans listesi. Her Telsiz sunucusu bir frekanstır, uygulama birden çok frekansı (adres ve
// görünen ad) hatırlar ve kullanıcı aralarında geçiş yapar. Oturum bilgisi bu listede tutulmaz: her
// frekans kendi oturum bölümünü (partition) kullanır (src/main.js partitionFor), bu yüzden bir
// frekanstan diğerine geçmek o frekansın girişini kaybettirmez.
// Bu modül saf liste işlemlerini (doğrulama, ekleme, çıkarma, ad güncelleme, sıralama, eski tek sunucu
// ayarından geçiş) ve ana sürecin IPC işleyicilerinin kullandığı denetleyiciyi (createController) içerir.
// Denetleyici pencere, oturum ve ayar dosyası işlemlerini dışarıdan alır. Electron'a bağımlı değildir,
// Node ile test edilir.

const { isValidOrigin } = require('./server-url')

const MAX_FREQUENCIES = 50
const MAX_NAME = 200
// IPC ile gelen dizelerin üst sınırı (doğrulamadan önce)
const MAX_INPUT = 1000
// Görünen ad tek satırdır: denetim karakterleri, satır sonları ve yön işaretleri atılır
function unsafeCode (code) {
  return code <= 0x1f || code === 0x7f || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069) || code === 0xfeff
}

// Sunucunun bildirdiği adı saklanabilir biçime getirir, geçersizse null
function cleanName (value) {
  if (typeof value !== 'string') return null
  const text = Array.from(value, (ch) => (unsafeCode(ch.charCodeAt(0)) ? ' ' : ch)).join('').replace(/\s+/g, ' ').trim()
  if (text === '' || text.length > MAX_NAME) return null
  return text
}

function cleanTime (value) {
  return typeof value === 'number' && isFinite(value) && value > 0 ? Math.floor(value) : 0
}

// Ayar dosyasından okunan listeyi doğrular: geçerli ve normalleştirilmiş köken, yinelenen yok, en
// fazla MAX_FREQUENCIES öğe. Sonuç her zaman yeni bir dizidir.
function sanitizeList (raw) {
  const out = []
  if (!Array.isArray(raw)) return out
  const seen = new Set()
  for (const item of raw) {
    if (out.length >= MAX_FREQUENCIES) break
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    if (!isValidOrigin(item.origin) || seen.has(item.origin)) continue
    seen.add(item.origin)
    out.push({ origin: item.origin, name: cleanName(item.name), lastUsed: cleanTime(item.lastUsed) })
  }
  return out
}

function indexOf (list, origin) {
  let i = 0
  while (i < list.length) {
    if (list[i].origin === origin) return i
    i += 1
  }
  return -1
}

function has (list, origin) {
  return indexOf(list, origin) !== -1
}

// Frekansı ekler veya günceller. fields: { name, lastUsed } (verilmeyen alan değişmez).
// Liste doluysa en uzun süredir kullanılmayan (etkin olmayan) öğe çıkarılır.
function upsert (list, origin, fields) {
  if (!isValidOrigin(origin)) return sanitizeList(list)
  const next = sanitizeList(list)
  const f = fields || {}
  const i = indexOf(next, origin)
  const entry = i === -1 ? { origin, name: null, lastUsed: 0 } : Object.assign({}, next[i])
  if (Object.prototype.hasOwnProperty.call(f, 'name')) {
    const name = cleanName(f.name)
    if (name) entry.name = name
  }
  if (Object.prototype.hasOwnProperty.call(f, 'lastUsed')) entry.lastUsed = cleanTime(f.lastUsed)
  if (i === -1) {
    if (next.length >= MAX_FREQUENCIES) {
      let oldest = 0
      let j = 1
      while (j < next.length) {
        if (next[j].lastUsed < next[oldest].lastUsed) oldest = j
        j += 1
      }
      next.splice(oldest, 1)
    }
    next.push(entry)
  } else {
    next[i] = entry
  }
  return next
}

function remove (list, origin) {
  return sanitizeList(list).filter((item) => item.origin !== origin)
}

// Çıkarılan etkin frekansın yerine geçecek frekans: en son kullanılan, eşitlikte listede önce gelen
function pickNext (list) {
  let best = null
  for (const item of sanitizeList(list)) {
    if (!best || item.lastUsed > best.lastUsed) best = item
  }
  return best ? best.origin : null
}

function hostOf (origin) {
  try {
    return new URL(origin).host
  } catch (err) {
    return origin
  }
}

// Ayarların frekans bölümünü tutarlı hâle getirir (eski sürümden geçiş dahil):
// - eski tek sunucu ayarı (server) listede yoksa listeye eklenir, hiçbir veri kaybolmaz
// - etkin frekans geçersizse ve liste boş değilse en son kullanılan frekans etkin olur
// Sonuç: { server, frequencies }
function normalize (server, frequencies) {
  let list = sanitizeList(frequencies)
  let active = isValidOrigin(server) ? server : null
  if (active && !has(list, active)) list = upsert(list, active, {})
  if (!active) active = pickNext(list)
  return { server: active, frequencies: list }
}

// Sayfaya verilen liste: etkin frekans başta, diğerleri kayıt sırasıyla. Oturum bilgisi içermez.
function publicList (server, frequencies) {
  const list = sanitizeList(frequencies)
  const items = list.map((item) => ({
    origin: item.origin,
    name: item.name,
    host: hostOf(item.origin),
    active: item.origin === server
  }))
  items.sort((a, b) => (a.active === b.active ? 0 : (a.active ? -1 : 1)))
  return { active: isValidOrigin(server) ? server : null, items }
}

// Menü ve tepsi için görünen ad: sunucunun adı, yoksa ana bilgisayar adı
function displayName (item) {
  return item && item.name ? item.name : hostOf(item ? item.origin : '')
}

// Ana sürecin frekans işlemleri. Sayfadan gelen her değer burada yeniden doğrulanır: köken dize,
// uzunluğu sınırlı, server-url.js kurallarına göre geçerli (https veya bu bilgisayar) ve listede kayıtlı
// olmalıdır. Pencere değişiklikleri IPC yanıtı gittikten sonra yapılır (deps.defer).
// deps: {
//   settings(): güncel ayar nesnesi ({ server, frequencies, ... }), her çağrıda yeniden okunur
//   persist(): ayarları yazar ve menüleri yeniler
//   windowOrigin(): uygulama penceresinin açık olduğu frekans (ad bildirimi yalnızca onun için)
//   apply(origin): uygulama penceresini o frekansla açar
//   closeToConnect(): son frekans çıkarılınca uygulama penceresini kapatıp adres penceresini açar
//   clearData(origin): o frekansın oturum verisini siler
//   defer(fn), now()
// }
function createController (deps) {
  const settings = () => deps.settings()

  function listed (origin) {
    return typeof origin === 'string' && origin.length <= MAX_INPUT && isValidOrigin(origin) && has(settings().frequencies, origin)
  }

  function list () {
    const current = settings()
    return publicList(current.server, current.frequencies)
  }

  // Bağlantı penceresinde denetlenmiş yeni frekans: listeye eklenir (varsa güncellenir) ve etkin olur
  function added (origin, name) {
    if (!isValidOrigin(origin)) return { ok: false, code: 'invalid' }
    const current = settings()
    current.frequencies = upsert(current.frequencies, origin, { name, lastUsed: deps.now() })
    current.server = origin
    deps.persist()
    deps.defer(() => deps.apply(origin))
    return { ok: true, origin }
  }

  function switchTo (origin) {
    if (!listed(origin)) return { ok: false, code: 'unknown' }
    const current = settings()
    current.frequencies = upsert(current.frequencies, origin, { lastUsed: deps.now() })
    current.server = origin
    deps.persist()
    deps.defer(() => deps.apply(origin))
    return { ok: true, origin }
  }

  // Etkin frekans çıkarılırsa en son kullanılan diğer frekansa geçilir, liste boşalırsa adres penceresi
  // açılır. Oturum verisi yalnızca clearData === true ise silinir.
  function removeOne (origin, clearData) {
    if (typeof clearData !== 'boolean') return { ok: false, code: 'invalid' }
    if (!listed(origin)) return { ok: false, code: 'unknown' }
    const current = settings()
    const wasActive = current.server === origin
    current.frequencies = remove(current.frequencies, origin)
    const next = wasActive ? pickNext(current.frequencies) : current.server
    current.server = next
    deps.persist()
    deps.defer(() => {
      if (wasActive && next) deps.apply(next)
      else if (wasActive) deps.closeToConnect()
      if (clearData) deps.clearData(origin)
    })
    return { ok: true, active: next }
  }

  // Sayfanın sunucudan öğrendiği ad yalnızca pencerenin kendi frekansına yazılır
  function setName (name) {
    if (typeof name !== 'string' || name.length > MAX_INPUT) return { ok: false, code: 'invalid' }
    const clean = cleanName(name)
    const origin = deps.windowOrigin()
    if (!clean || !listed(origin)) return { ok: false, code: 'invalid' }
    const current = settings()
    const entry = current.frequencies.find((item) => item.origin === origin)
    if (entry && entry.name === clean) return { ok: true, changed: false }
    current.frequencies = upsert(current.frequencies, origin, { name: clean })
    deps.persist()
    return { ok: true, changed: true }
  }

  return { list, added, switchTo, remove: removeOne, setName }
}

module.exports = {
  MAX_FREQUENCIES,
  MAX_NAME,
  MAX_INPUT,
  createController,
  cleanName,
  sanitizeList,
  has,
  upsert,
  remove,
  pickNext,
  hostOf,
  normalize,
  publicList,
  displayName
}
