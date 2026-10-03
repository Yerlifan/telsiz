'use strict'

// HTTP yardımcıları: güvenlik başlıkları, JSON ve metin yanıtları, sınırlı gövde okuma,
// adres ayrıştırma ve beyaz listedeki statik dosyaların sunumu (SPEC-V2 3.7 ve 3.9).

const fs = require('node:fs')

const HTML_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
const API_CSP = "default-src 'none'; frame-ancestors 'none'"
const DOWNLOAD_CSP = "default-src 'none'; sandbox"

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)'
}

function noop () {}

function setSecurityHeaders (res) {
  for (const name of Object.keys(SECURITY_HEADERS)) res.setHeader(name, SECURITY_HEADERS[name])
}

function canRespond (res) {
  return Boolean(res) && !res.headersSent && !res.writableEnded && !res.destroyed
}

// Gövdeli bir isteğin gövdesi henüz tamamen okunmadıysa bağlantı yanıttan sonra kapatılır.
// Böylece Node.js kalan (belki çok büyük) gövdeyi okumaya çalışmaz.
// Gövdesiz isteklerde (GET gibi) bağlantı açık kalır.
function closeIfUnread (res) {
  const req = res.req
  if (req && !req.complete && expectsBody(req)) res.setHeader('Connection', 'close')
}

function expectsBody (req) {
  if (req.headers['transfer-encoding'] !== undefined) return true
  if (req.headers['content-length'] === undefined) return false
  const declared = contentLength(req)
  return declared === null || declared > 0
}

function applyHeaders (res, headers) {
  if (!headers) return
  for (const name of Object.keys(headers)) res.setHeader(name, headers[name])
}

// opts.drain: okunmamış gövde bağlantı açık kalarak Node.js tarafından okunup atılır
// (yalnızca boyutu bilinen ve sınırlı gövdeler için, istemci yanıtı güvenle alsın diye).
function sendJson (res, status, data, headers, opts) {
  if (!canRespond(res)) return false
  const body = Buffer.from(JSON.stringify(data), 'utf8')
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', API_CSP)
  res.setHeader('Content-Length', body.length)
  applyHeaders(res, headers)
  if (!opts || !opts.drain) closeIfUnread(res)
  res.end(body)
  return true
}

function sendText (res, status, text, headers) {
  if (!canRespond(res)) return false
  const body = Buffer.from(text, 'utf8')
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', API_CSP)
  res.setHeader('Content-Length', body.length)
  applyHeaders(res, headers)
  closeIfUnread(res)
  if (res.req && res.req.method === 'HEAD') res.end()
  else res.end(body)
  return true
}

// Content-Length başlığı geçerli bir sayıysa onu, yoksa null döner.
function contentLength (req) {
  const raw = req.headers['content-length']
  if (typeof raw !== 'string' || !/^\d{1,15}$/.test(raw)) return null
  return Number(raw)
}

// Gövdeyi en fazla limit bayta kadar okur.
// Sonuç: { text } | { tooLarge: true } | { aborted: true }
function readBody (req, limit) {
  return new Promise((resolve) => {
    const declared = contentLength(req)
    if (declared !== null && declared > limit) {
      resolve({ tooLarge: true })
      return
    }
    const chunks = []
    let size = 0
    let done = false
    function finish (value) {
      if (done) return
      done = true
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onError)
      req.removeListener('close', onClose)
      resolve(value)
    }
    function onData (chunk) {
      size += chunk.length
      if (size > limit) {
        chunks.length = 0
        req.pause()
        finish({ tooLarge: true })
        return
      }
      chunks.push(chunk)
    }
    function onEnd () {
      finish({ text: Buffer.concat(chunks, size).toString('utf8') })
    }
    function onError () {
      finish({ aborted: true })
    }
    function onClose () {
      if (!req.complete) finish({ aborted: true })
    }
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
    req.on('close', onClose)
  })
}

// Gövde boşsa boş nesne, nesne değilse veya bozuksa null döner (Content-Type'a bakılmaz).
function parseJsonObject (text) {
  const source = typeof text === 'string' ? text.replace(/^\uFEFF/, '') : ''
  if (source.trim() === '') return {}
  let value
  try {
    value = JSON.parse(source)
  } catch (err) {
    return null
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return value
}

function splitUrl (rawUrl) {
  const url = typeof rawUrl === 'string' ? rawUrl : '/'
  const q = url.indexOf('?')
  const pathname = q === -1 ? url : url.slice(0, q)
  let query
  try {
    query = new URLSearchParams(q === -1 ? '' : url.slice(q + 1))
  } catch (err) {
    query = new URLSearchParams('')
  }
  return { pathname, query }
}

function etagMatches (header, etag) {
  if (typeof header !== 'string' || header === '') return false
  return header.split(',').some((part) => part.trim() === etag || part.trim() === '*')
}

// Beyaz listedeki bir dosyayı sunar. entry: { type, csp }
async function serveFile (req, res, file, entry) {
  let handle = null
  try {
    try {
      handle = await fs.promises.open(file, 'r')
    } catch (err) {
      if (err && (err.code === 'ENOENT' || err.code === 'EISDIR' || err.code === 'ENOTDIR')) {
        sendText(res, 404, 'Sayfa bulunamadı.')
        return
      }
      throw err
    }
    const info = await handle.stat()
    if (!info.isFile()) {
      sendText(res, 404, 'Sayfa bulunamadı.')
      return
    }
    const etag = 'W/"' + info.size.toString(16) + '-' + Math.floor(info.mtimeMs).toString(16) + '"'
    if (!canRespond(res)) return
    res.setHeader('Content-Type', entry.type)
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('ETag', etag)
    res.setHeader('Content-Security-Policy', entry.csp)
    if (etagMatches(req.headers['if-none-match'], etag)) {
      res.statusCode = 304
      res.end()
      return
    }
    const data = await handle.readFile()
    if (!canRespond(res)) return
    res.statusCode = 200
    res.setHeader('Content-Length', data.length)
    if (req.method === 'HEAD') res.end()
    else res.end(data)
  } finally {
    if (handle) await handle.close().catch(noop)
  }
}

module.exports = {
  HTML_CSP,
  API_CSP,
  DOWNLOAD_CSP,
  setSecurityHeaders,
  canRespond,
  sendJson,
  sendText,
  contentLength,
  readBody,
  parseJsonObject,
  splitUrl,
  serveFile
}
