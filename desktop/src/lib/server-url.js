'use strict'

// Sunucu adresinin doğrulanması ve normalleştirilmesi, /api/info yanıtının denetimi ve ana sürüm
// uyumu. Electron'a bağımlı değildir: istek işlevi (fetch) dışarıdan verilir, Node ile test edilir.
//
// Kurallar: yalnızca https:// adresleri kabul edilir. Tek istisna bu bilgisayardaki sunucudur
// (http://localhost ve http://127.0.0.1), bu trafik bilgisayardan çıkmaz. Adreste kullanıcı adı,
// parola, yol, sorgu veya # bulunamaz (Telsiz sunucusu her zaman kök adreste çalışır).
// Saklanan değer her zaman normalleştirilmiş kökendir (ör. https://telsiz.ornek.com:8443).

const MAX_INPUT_LENGTH = 300
const MAX_INFO_BYTES = 64 * 1024
const INFO_TIMEOUT_MS = 10000
const MAX_SERVER_NAME = 200
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1'])
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//
const CONTROL_RE = /[\x00-\x1f\x7f\\]/
const WHITESPACE_RE = /\s/
const CERT_ERROR_RE = /CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER/i

// Kullanıcının yazdığı adresi doğrular. Şema yazılmamışsa https:// varsayılır.
// Sonuç: { ok: true, origin, secure } veya { ok: false, code }.
// code: invalid, too_long, insecure, credentials, path
function parseServerUrl (input) {
  if (typeof input !== 'string') return { ok: false, code: 'invalid' }
  const text = input.trim()
  if (text === '') return { ok: false, code: 'invalid' }
  if (text.length > MAX_INPUT_LENGTH) return { ok: false, code: 'too_long' }
  if (WHITESPACE_RE.test(text) || CONTROL_RE.test(text)) return { ok: false, code: 'invalid' }
  const candidate = SCHEME_RE.test(text) ? text : 'https://' + text
  let url
  try {
    url = new URL(candidate)
  } catch (err) {
    return { ok: false, code: 'invalid' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, code: 'invalid' }
  if (url.hostname === '') return { ok: false, code: 'invalid' }
  if (url.protocol === 'http:' && !LOOPBACK_HOSTS.has(url.hostname)) return { ok: false, code: 'insecure' }
  if (url.username !== '' || url.password !== '') return { ok: false, code: 'credentials' }
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return { ok: false, code: 'path' }
  // Ayrıştırıcının sildiği parçalar da reddedilir: yalnızca ? veya # ile biten adresler ve
  // /%2e%2e/ gibi kök adrese indirgenen yollar. Ana bilgisayar adından sonra en fazla bir / olabilir.
  const rest = candidate.slice(candidate.indexOf('//') + 2)
  const cut = rest.search(/[/?#]/)
  if (cut !== -1 && rest.slice(cut) !== '/') return { ok: false, code: 'path' }
  return { ok: true, origin: url.protocol + '//' + url.host, secure: url.protocol === 'https:' }
}

// Ayar dosyasından okunan kökenin hâlâ geçerli ve normalleştirilmiş olup olmadığı
function isValidOrigin (value) {
  if (typeof value !== 'string') return false
  const parsed = parseServerUrl(value)
  return parsed.ok && parsed.origin === value
}

// /api/info yanıt gövdesi Telsiz sunucusuna mı ait? Geçerliyse { serverName, version, setupRequired }
function parseInfo (data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const name = data.serverName
  if (typeof name !== 'string' || name.trim() === '' || name.length > MAX_SERVER_NAME) return null
  if (typeof data.setupRequired !== 'boolean') return null
  if (!data.limits || typeof data.limits !== 'object' || Array.isArray(data.limits)) return null
  if (data.version !== undefined && data.version !== null && typeof data.version !== 'string') return null
  const version = typeof data.version === 'string' && data.version.length <= 64 ? data.version : null
  // Frekans fotoğrafının karması (src/lib/server-icon.js), geçersizse veya yoksa null
  const serverIcon = typeof data.serverIcon === 'string' && /^[0-9a-f]{32}$/.test(data.serverIcon) ? data.serverIcon : null
  return { serverName: name, version, setupRequired: data.setupRequired, serverIcon }
}

function majorOf (version) {
  if (typeof version !== 'string') return null
  const match = /^v?(\d{1,6})\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.+-]*)?$/.exec(version)
  return match ? Number(match[1]) : null
}

// Ana sürüm uyumu: { compatible, reason } reason: match, mismatch, unknown
function compareVersions (serverVersion, appVersion) {
  const server = majorOf(serverVersion)
  const own = majorOf(appVersion)
  if (server === null || own === null) return { compatible: false, reason: 'unknown' }
  return server === own ? { compatible: true, reason: 'match' } : { compatible: false, reason: 'mismatch' }
}

// Ağ hatasını kullanıcıya gösterilecek koda çevirir: certificate veya unreachable
function classifyNetworkError (err) {
  const parts = []
  let current = err
  let depth = 0
  while (current && depth < 4) {
    if (typeof current.code === 'string') parts.push(current.code)
    if (typeof current.message === 'string') parts.push(current.message)
    current = current.cause
    depth += 1
  }
  return CERT_ERROR_RE.test(parts.join(' ')) ? 'certificate' : 'unreachable'
}

// Yanıt gövdesini en fazla max bayta kadar okur, aşılırsa veya okunamazsa null döner
async function readLimited (response, max) {
  if (!response.body) return ''
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
  return Buffer.concat(chunks, size).toString('utf8')
}

// Sunucuyu denetler: GET <origin>/api/info. fetchFn: (url, init) => Promise<Response>.
// Sonuç: { ok: true, origin, serverName, serverIcon, version, compatible, reason }
// veya { ok: false, code } (code: timeout, certificate, unreachable, not_telsiz)
async function checkServer (fetchFn, origin, appVersion, options) {
  const opts = options || {}
  const timeoutMs = opts.timeoutMs || INFO_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response
    try {
      response = await fetchFn(origin + '/api/info', {
        method: 'GET',
        headers: { accept: 'application/json' },
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
        signal: controller.signal
      })
    } catch (err) {
      return { ok: false, code: controller.signal.aborted ? 'timeout' : classifyNetworkError(err) }
    }
    if (response.status !== 200) {
      if (response.body) await response.body.cancel().catch(() => {})
      return { ok: false, code: 'not_telsiz' }
    }
    const text = await readLimited(response, MAX_INFO_BYTES)
    if (text === null) return { ok: false, code: controller.signal.aborted ? 'timeout' : 'not_telsiz' }
    let data = null
    try {
      data = JSON.parse(text)
    } catch (err) {
      data = null
    }
    const info = parseInfo(data)
    if (!info) return { ok: false, code: 'not_telsiz' }
    const versions = compareVersions(info.version, appVersion)
    return {
      ok: true,
      origin,
      serverName: info.serverName,
      serverIcon: info.serverIcon,
      version: info.version,
      compatible: versions.compatible,
      reason: versions.reason
    }
  } finally {
    clearTimeout(timer)
  }
}

module.exports = {
  MAX_INPUT_LENGTH,
  MAX_INFO_BYTES,
  INFO_TIMEOUT_MS,
  parseServerUrl,
  isValidOrigin,
  parseInfo,
  majorOf,
  compareVersions,
  classifyNetworkError,
  readLimited,
  checkServer
}
