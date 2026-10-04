'use strict'

// Frekans fotoğrafı (ana süreçte): açık olmayan frekansların fotoğrafı bantta gösterilmek üzere burada
// indirilir ve doğrulanır. Sunucu fotoğrafın karmasını GET /api/info yanıtında (serverIcon) verir, arka plan
// yöneticisi (src/lib/background.js) yoklamada karmayı öğrenir ve yalnızca karma değişince indirir.
//
// Kurallar:
// - Adres her zaman <köken>/api/server-icon?v=<karma>, köken kayıtlı ve doğrulanmış frekanstır.
// - Yönlendirme izlenmez, çerez ve önbellek kullanılmaz, süre sınırı vardır.
// - Gövde en fazla MAX_ICON_BYTES bayt okunur (sunucunun varsayılan sınırı, profil resmiyle aynı).
// - Tür dosya imzasından bulunur (yalnızca PNG, JPEG, WebP, SVG asla) ve yanıtın Content-Type başlığıyla
//   aynı olmalıdır. İçeriğin sha256 karması istenen karmayla tutmalıdır.
// - Sonuç yalnızca data:image/<tür>;base64,... adresidir, uygulama penceresine bu adres gider (CSP img-src
//   data: izin verir, pencere sunucuya doğrudan bağlanmaz).
// Electron'a bağımlı değildir: istek işlevi dışarıdan verilir, Node ile test edilir (desktop/test/sunucu-foto.test.js).

const crypto = require('node:crypto')
const { isValidOrigin } = require('./server-url')

const ICON_HASH_RE = /^[0-9a-f]{32}$/
const MAX_ICON_BYTES = 1024 * 1024 + 16
const ICON_TIMEOUT_MS = 10000
const ICON_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp'])
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex')
const DATA_URL_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
// Base64 ile büyüyen en büyük data: adresi
const MAX_DATA_URL = 'data:image/jpeg;base64,'.length + Math.ceil(MAX_ICON_BYTES / 3) * 4

function isIconHash (value) {
  return typeof value === 'string' && ICON_HASH_RE.test(value)
}

// Dosya imzasından tür: image/png, image/jpeg, image/webp veya null (sunucudaki imageType ile aynı)
function detectType (data) {
  if (!Buffer.isBuffer(data) || data.length < 16) return null
  if (data.length >= 24 && data.subarray(0, 8).equals(PNG_SIGNATURE) && data.toString('latin1', 12, 16) === 'IHDR') return 'image/png'
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP' && /^VP8[ LX]$/.test(data.toString('latin1', 12, 16))) return 'image/webp'
  return null
}

function hashOf (data) {
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32)
}

function mediaType (value) {
  return typeof value === 'string' ? value.split(';')[0].trim().toLowerCase() : ''
}

// Doğrulanmış data: adresi veya null. declaredType: yanıtın Content-Type başlığı, hash: beklenen karma.
function toDataUrl (data, declaredType, hash) {
  if (!Buffer.isBuffer(data) || data.length === 0 || data.length > MAX_ICON_BYTES) return null
  const type = detectType(data)
  if (!type || !ICON_TYPES.includes(type) || mediaType(declaredType) !== type) return null
  if (!isIconHash(hash) || hashOf(data) !== hash) return null
  return 'data:' + type + ';base64,' + data.toString('base64')
}

// Uygulama penceresine gidecek değerin son denetimi
function isDataUrl (value) {
  return typeof value === 'string' && value.length <= MAX_DATA_URL && DATA_URL_RE.test(value)
}

async function readBytes (response, max) {
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  try {
    while (true) {
      const step = await reader.read()
      if (step.done) break
      size += step.value.byteLength
      if (size > max) {
        await reader.cancel().catch(() => {})
        return null
      }
      chunks.push(Buffer.from(step.value))
    }
  } catch (err) {
    return null
  }
  return Buffer.concat(chunks, size)
}

// Fotoğrafı indirir ve doğrular. fetchFn: (url, init) => Promise<Response>. Sonuç data: adresi veya null.
async function fetchIcon (fetchFn, origin, hash, options) {
  if (typeof fetchFn !== 'function' || !isValidOrigin(origin) || !isIconHash(hash)) return null
  const opts = options || {}
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || ICON_TIMEOUT_MS)
  try {
    let response
    try {
      response = await fetchFn(origin + '/api/server-icon?v=' + hash, {
        method: 'GET',
        headers: { accept: ICON_TYPES.join(', ') },
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal
      })
    } catch (err) {
      return null
    }
    const declared = response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-type') : null
    const length = response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-length') : null
    if (response.status !== 200 || !ICON_TYPES.includes(mediaType(declared)) || (typeof length === 'string' && /^\d+$/.test(length) && Number(length) > MAX_ICON_BYTES)) {
      if (response.body) await response.body.cancel().catch(() => {})
      return null
    }
    const data = await readBytes(response, MAX_ICON_BYTES)
    return data ? toDataUrl(data, declared, hash) : null
  } finally {
    clearTimeout(timer)
  }
}

module.exports = {
  ICON_HASH_RE,
  MAX_ICON_BYTES,
  MAX_DATA_URL,
  ICON_TYPES,
  isIconHash,
  detectType,
  toDataUrl,
  isDataUrl,
  fetchIcon
}
