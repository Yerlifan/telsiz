'use strict'

// telsiz://app/api/* isteklerinin yapılandırılmış sunucuya iletilmesi (ana süreçte çalışır).
// Electron'a bağımlı değildir: istek işlevi (Electron'da session.fetch, testlerde Node fetch)
// dışarıdan verilir, böylece iletme mantığı gerçek bir Telsiz sunucusuna karşı Node ile test edilir.
//
// Güvenlik kuralları:
// - Hedef her zaman ayarlardaki sunucu kökenidir, sayfa başka bir adrese istek yaptıramaz.
// - Yalnızca GET, HEAD ve POST, yalnızca telsiz://app kökeninden başlatılan ve belge gezinmesi
//   olmayan istekler iletilir.
// - İstekten yalnızca X-Token, Content-Type ve Accept-Language başlıkları (değerleri doğrulanarak)
//   geçer. Çerez, Origin, Referer ve diğer başlıklar gönderilmez.
// - Yanıttan yalnızca istemcinin ihtiyaç duyduğu başlıklar geçer. İçerik türü JSON, ikili veya
//   düz metin değilse ikili sayılır, her yanıta betik çalıştırmayı engelleyen bir CSP eklenir.
//   Content-Encoding ve sıkıştırmalı yanıtın Content-Length değeri geçmez (istek işlevi gövdeyi
//   zaten açar).
// - Yönlendirmeler izlenmez (redirect: 'error'), çerez ve önbellek kullanılmaz.
// - Yanıt başlıkları gelene kadar süre sınırı vardır, gövde akış olarak iletilir (long-poll,
//   yüklemeler ve indirmeler). Sayfa indirmeyi iptal ederse sunucuya giden istek de kesilir.
// - Ağ hatasında tarayıcıdakiyle aynı biçimde ağ hatası döner (XMLHttpRequest durum kodu 0).

const { APP_ORIGIN } = require('./channels')
const { SECURITY_HEADERS } = require('./static-files')
const { API_CSP } = require('./csp')

const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST'])
const NULL_BODY_STATUS = new Set([101, 204, 205, 304])
const MAX_URL_LENGTH = 8192
const HEADER_TIMEOUT_MS = 2 * 60 * 1000
// Yüklemede yanıt, gövdenin tamamı gönderildikten sonra gelir (sunucunun istek süresi sınırı 15 dk)
const UPLOAD_HEADER_TIMEOUT_MS = 15 * 60 * 1000
// Sunucunun izin verdiği en büyük yükleme (MAKS_YUKLEME_MB en fazla 1024) ve şifreleme payı
const MAX_REQUEST_BYTES = 1025 * 1024 * 1024

const TOKEN_RE = /^[\x21-\x7e]{1,512}$/
const CONTENT_TYPE_RE = /^(application\/json|application\/octet-stream)(\s*;\s*charset=[A-Za-z0-9._-]{1,40})?$/i
const ACCEPT_LANGUAGE_RE = /^[A-Za-z0-9*,;=. -]{1,200}$/
const RESPONSE_TYPES = new Set(['application/json', 'application/octet-stream', 'text/plain'])
const PASS_RESPONSE_HEADERS = [['retry-after', 'Retry-After'], ['content-disposition', 'Content-Disposition'], ['allow', 'Allow']]
const HEADER_VALUE_RE = /^[\x20-\x7e]{0,1000}$/

function isApiPath (pathname) {
  return pathname === '/api' || (typeof pathname === 'string' && pathname.startsWith('/api/'))
}

// Sunucudaki hedef adres. url: isteğin ayrıştırılmış adresi (telsiz://app/api/...).
// Yol ve sorgu olduğu gibi (yüzde kodlarıyla) korunur, köken her zaman ayarlardaki sunucudur.
function targetUrl (origin, url) {
  if (!url || !isApiPath(url.pathname)) return null
  const target = origin + url.pathname + url.search
  if (target.length > MAX_URL_LENGTH) return null
  return target
}

function headerGetter (headers) {
  if (headers && typeof headers.get === 'function') return (name) => headers.get(name)
  const lower = {}
  for (const key of Object.keys(headers || {})) lower[key.toLowerCase()] = headers[key]
  return (name) => (Object.prototype.hasOwnProperty.call(lower, name) ? lower[name] : null)
}

// İstekten sunucuya geçen başlıklar (geçersiz değerler hiç gönderilmez)
function requestHeaders (headers) {
  const get = headerGetter(headers)
  const out = {}
  const token = get('x-token')
  if (typeof token === 'string' && TOKEN_RE.test(token)) out['x-token'] = token
  const type = get('content-type')
  if (typeof type === 'string' && CONTENT_TYPE_RE.test(type.trim())) out['content-type'] = type.trim()
  const lang = get('accept-language')
  if (typeof lang === 'string' && ACCEPT_LANGUAGE_RE.test(lang.trim())) out['accept-language'] = lang.trim()
  return out
}

function mediaType (value) {
  if (typeof value !== 'string') return ''
  return value.split(';')[0].trim().toLowerCase()
}

// Sunucu yanıtından sayfaya geçen başlıklar
function responseHeaders (headers) {
  const get = headerGetter(headers)
  const out = Object.assign({}, SECURITY_HEADERS)
  const type = get('content-type')
  const media = mediaType(type)
  out['Content-Type'] = RESPONSE_TYPES.has(media) && HEADER_VALUE_RE.test(type) ? type : 'application/octet-stream'
  for (const pair of PASS_RESPONSE_HEADERS) {
    const value = get(pair[0])
    if (typeof value === 'string' && HEADER_VALUE_RE.test(value)) out[pair[1]] = value
  }
  const cache = get('cache-control')
  out['Cache-Control'] = typeof cache === 'string' && HEADER_VALUE_RE.test(cache) && cache !== '' ? cache : 'no-store'
  // Uzunluk yalnızca gövde sıkıştırılmamışsa doğrudur (indirme ilerlemesi bu değeri kullanır)
  const encoding = get('content-encoding')
  const length = get('content-length')
  const identity = encoding === null || encoding === undefined || encoding.trim().toLowerCase() === 'identity'
  if (identity && typeof length === 'string' && /^\d{1,15}$/.test(length)) out['Content-Length'] = length
  out['Content-Security-Policy'] = API_CSP
  return out
}

// Yanıt başlıkları için beklenecek en uzun süre. opts: { headerTimeoutMs, uploadHeaderTimeoutMs }
function headerTimeout (method, pathname, opts) {
  const o = opts || {}
  if (method === 'POST' && pathname === '/api/uploads') return o.uploadHeaderTimeoutMs || UPLOAD_HEADER_TIMEOUT_MS
  return o.headerTimeoutMs || HEADER_TIMEOUT_MS
}

function jsonResponse (status, code, message, extra) {
  const headers = Object.assign({}, SECURITY_HEADERS, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': API_CSP
  }, extra || {})
  return new Response(JSON.stringify({ error: message, code }), { status, headers })
}

// İstek gövdesini en fazla max bayt geçirecek biçimde sınırlar
function limitBody (body, max) {
  let total = 0
  return body.pipeThrough(new TransformStream({
    transform (chunk, controller) {
      total += chunk.byteLength
      if (total > max) {
        controller.error(new Error('request_too_large'))
        return
      }
      controller.enqueue(chunk)
    }
  }))
}

// Sunucu yanıt gövdesini sayfaya akış olarak geçirir. Sayfa okumayı bırakırsa (iptal) sunucuya
// giden istek de kesilir.
function relayBody (body, controller) {
  const reader = body.getReader()
  return new ReadableStream({
    async pull (stream) {
      let step
      try {
        step = await reader.read()
      } catch (err) {
        stream.error(err)
        return
      }
      if (step.done) stream.close()
      else stream.enqueue(step.value)
    },
    cancel (reason) {
      controller.abort()
      return reader.cancel(reason).catch(() => {})
    }
  })
}

// Vekil işlevi üretir. options:
//   origin: sunucu kökeni (ör. https://telsiz.ornek.com), çağıran doğrulamış olmalıdır
//   fetch: (url, init) => Promise<Response>
//   expectedInitiator: isteği başlatan kökenin beklenen değeri (varsayılan telsiz://app)
//   maxRequestBytes, headerTimeoutMs, uploadHeaderTimeoutMs: testler için
// Dönen işlev: async (request, url) => Response. request: { method, url, headers, body,
// initiatorOrigin, mode } (Electron protocol.handle isteği), url: ayrıştırılmış istek adresi.
function createApiProxy (options) {
  const origin = options.origin
  const fetchFn = options.fetch
  const expectedInitiator = options.expectedInitiator || APP_ORIGIN
  const maxRequestBytes = options.maxRequestBytes || MAX_REQUEST_BYTES
  if (typeof origin !== 'string' || typeof fetchFn !== 'function') throw new TypeError('createApiProxy: origin and fetch are required.')

  return async function proxyRequest (request, parsedUrl) {
    const url = parsedUrl || new URL(request.url)
    const method = String(request.method || 'GET').toUpperCase()
    if (request.initiatorOrigin !== expectedInitiator || request.mode === 'navigate') {
      return jsonResponse(403, 'forbidden', 'Forbidden')
    }
    if (!ALLOWED_METHODS.has(method)) {
      return jsonResponse(405, 'method_not_allowed', 'Method not allowed', { Allow: 'GET, HEAD, POST' })
    }
    const target = targetUrl(origin, url)
    if (!target) return jsonResponse(414, 'uri_too_long', 'URI too long')

    const controller = new AbortController()
    const timeoutMs = headerTimeout(method, url.pathname, options)
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onAbort = () => controller.abort()
    if (request.signal && typeof request.signal.addEventListener === 'function') {
      request.signal.addEventListener('abort', onAbort, { once: true })
    }
    const init = {
      method,
      headers: requestHeaders(request.headers),
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal
    }
    if (method === 'POST' && request.body) {
      init.body = limitBody(request.body, maxRequestBytes)
      init.duplex = 'half'
    }
    let upstream
    try {
      upstream = await fetchFn(target, init)
    } catch (err) {
      return Response.error()
    } finally {
      clearTimeout(timer)
    }
    const headers = responseHeaders(upstream.headers)
    const empty = method === 'HEAD' || NULL_BODY_STATUS.has(upstream.status) || !upstream.body
    if (empty && upstream.body) await upstream.body.cancel().catch(() => {})
    try {
      return new Response(empty ? null : relayBody(upstream.body, controller), { status: upstream.status, headers })
    } catch (err) {
      // Geçersiz durum kodu (200-599 dışı)
      controller.abort()
      return Response.error()
    }
  }
}

module.exports = {
  ALLOWED_METHODS,
  MAX_URL_LENGTH,
  MAX_REQUEST_BYTES,
  HEADER_TIMEOUT_MS,
  UPLOAD_HEADER_TIMEOUT_MS,
  isApiPath,
  targetUrl,
  requestHeaders,
  responseHeaders,
  headerTimeout,
  jsonResponse,
  limitBody,
  createApiProxy
}
