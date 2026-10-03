'use strict'

const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')

const NICK_MIN = 2
const NICK_MAX = 20
const ROOM_MAX = 40
const DEFAULT_ROOM = 'Sohbet'
const MAX_WAITERS_PER_SESSION = 2

const NICK_PATTERN = /^[\p{L}\p{N}_. -]+$/u
const TEXT_STRIP_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

const CONTENT_SECURITY_POLICY = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"

const DEFAULT_OPTIONS = {
  room: DEFAULT_ROOM,
  password: '',
  pollTimeoutMs: 25000,
  graceMs: 15000,
  sweepIntervalMs: 5000,
  historyLimit: 200,
  maxMessageLength: 1000,
  maxSessions: 300,
  joinLimit: 10,
  joinWindowMs: 60000,
  sendLimit: 5,
  sendWindowMs: 5000,
  maxBodyBytes: 16384,
  publicDir: path.join(__dirname, 'public')
}

const ERROR_MESSAGES = {
  bad_request: 'İstek okunamadı.',
  too_large: 'İstek çok büyük.',
  not_found: 'İstenen adres bulunamadı.',
  method_not_allowed: 'Bu adres bu istek yöntemini desteklemiyor.',
  invalid_nick: 'Takma ad 2 ile 20 karakter arasında olmalı ve yalnızca harf, rakam, boşluk, nokta, alt çizgi veya kısa çizgi içermeli.',
  wrong_password: 'Oda şifresi hatalı.',
  nick_taken: 'Bu takma ad şu anda kullanımda.',
  invalid_token: 'Oturum bulunamadı, lütfen yeniden katıl.',
  room_full: 'Oda dolu, lütfen daha sonra tekrar dene.',
  server_error: 'Sunucuda beklenmeyen bir hata oluştu.'
}
const JOIN_RATE_MESSAGE = 'Çok fazla deneme yapıldı, bir dakika sonra tekrar dene.'
const SEND_RATE_MESSAGE = 'Çok hızlı mesaj gönderiyorsun, biraz bekle.'

// Yalnızca bu beyaz listedeki yollar diskten sunulur, genel dosya sunumu yoktur.
const STATIC_ROUTES = new Map()
STATIC_ROUTES.set('/', { file: 'index.html', type: 'text/html; charset=utf-8', html: true })
STATIC_ROUTES.set('/index.html', { file: 'index.html', type: 'text/html; charset=utf-8', html: true })
STATIC_ROUTES.set('/app.js', { file: 'app.js', type: 'text/javascript; charset=utf-8', html: false })
STATIC_ROUTES.set('/style.css', { file: 'style.css', type: 'text/css; charset=utf-8', html: false })
STATIC_ROUTES.set('/favicon.svg', { file: 'favicon.svg', type: 'image/svg+xml', html: false })

function resolveOptions (options) {
  const config = Object.assign({}, DEFAULT_OPTIONS)
  const given = options || {}
  for (const key of Object.keys(given)) {
    if (given[key] !== undefined) config[key] = given[key]
  }
  return config
}

function codePointLength (value) {
  return Array.from(value).length
}

function cleanRoomName (value) {
  const text = typeof value === 'string' ? value.replace(/\p{C}/gu, '').replace(/\s+/g, ' ').trim() : ''
  const short = Array.from(text).slice(0, ROOM_MAX).join('').trim()
  return short === '' ? DEFAULT_ROOM : short
}

function cleanNick (value) {
  if (typeof value !== 'string') return null
  const nick = value.normalize('NFC').replace(/\p{C}/gu, '').replace(/\s+/g, ' ').trim()
  const length = codePointLength(nick)
  if (length < NICK_MIN || length > NICK_MAX) return null
  if (!NICK_PATTERN.test(nick)) return null
  return nick
}

function cleanText (value, maxLength) {
  if (typeof value !== 'string') return null
  const text = value.replace(/\r\n?/g, '\n').replace(TEXT_STRIP_PATTERN, '').trim()
  const length = codePointLength(text)
  if (length < 1 || length > maxLength) return null
  return text
}

function parseSince (raw, lastId) {
  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(value, lastId)
}

function parseJsonObject (text) {
  const source = text.replace(/^\uFEFF/, '')
  if (source.trim() === '') return {}
  try {
    const value = JSON.parse(source)
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value
  } catch (err) {
    return null
  }
  return null
}

function clientIp (req) {
  const remote = req.socket.remoteAddress || ''
  if (LOOPBACK_ADDRESSES.has(remote)) {
    const cf = req.headers['cf-connecting-ip']
    if (typeof cf === 'string' && cf.trim() !== '') return cf.trim()
    const forwarded = req.headers['x-forwarded-for']
    if (typeof forwarded === 'string') {
      const first = forwarded.split(',')[0].trim()
      if (first !== '') return first
    }
  }
  return remote
}

// Kayan pencere sayacı: izin verilirse zamanı kaydeder ve true döner.
function takeSlot (times, limit, windowMs, now) {
  while (times.length > 0 && now - times[0] >= windowMs) times.shift()
  if (times.length >= limit) return false
  times.push(now)
  return true
}

function sha256 (value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest()
}

function readBody (req, limit) {
  return new Promise(resolve => {
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > limit) {
      req.resume()
      resolve({ tooLarge: true })
      return
    }
    const chunks = []
    let size = 0
    let tooLarge = false
    req.on('data', chunk => {
      if (tooLarge) return
      size += chunk.length
      if (size > limit) {
        // Fazlası okunup atılır, bağlantı canlı kalır.
        tooLarge = true
        chunks.length = 0
        resolve({ tooLarge: true })
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!tooLarge) resolve({ text: Buffer.concat(chunks).toString('utf8') })
    })
    req.on('error', () => resolve(null))
  })
}

function setSecurityHeaders (res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
}

function sendText (res, status, text) {
  if (res.headersSent || res.writableEnded) return
  const body = Buffer.from(text, 'utf8')
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Content-Length', body.length)
  res.end(body)
}

function createChatServer (options) {
  const config = resolveOptions(options)
  const room = cleanRoomName(config.room)
  const password = typeof config.password === 'string' ? config.password : String(config.password || '')
  const passwordRequired = password !== ''
  const passwordHash = sha256(password)
  const pollTimeoutMs = config.pollTimeoutMs
  const graceMs = config.graceMs
  const historyLimit = config.historyLimit
  const maxMessageLength = config.maxMessageLength
  const invalidTextMessage = `Mesaj boş olamaz ve ${maxMessageLength} karakteri geçemez.`

  const history = []
  const sessions = new Map()
  const joinAttempts = new Map()
  let nextId = 1
  let closing = false
  let sweepTimer = null

  function currentLastId () {
    return nextId - 1
  }

  function onlineUsers () {
    const users = []
    for (const session of sessions.values()) {
      if (session.online) users.push(session.nick)
    }
    return users.sort((a, b) => a.localeCompare(b, 'tr'))
  }

  function messagesSince (since) {
    return history.filter(message => message.id > since)
  }

  function sendJson (res, status, data) {
    if (res.headersSent || res.writableEnded) return false
    const body = Buffer.from(JSON.stringify(data), 'utf8')
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Length', body.length)
    if (closing) res.setHeader('Connection', 'close')
    res.end(body)
    return true
  }

  function sendError (res, status, code, message) {
    return sendJson(res, status, { error: message || ERROR_MESSAGES[code], code })
  }

  function pollPayload (messages) {
    return { messages, users: onlineUsers(), lastId: currentLastId() }
  }

  function statePayload (session) {
    return {
      token: session.token,
      nick: session.nick,
      room,
      lastId: currentLastId(),
      messages: history.slice(),
      users: onlineUsers()
    }
  }

  function removeWaiter (waiter) {
    const list = waiter.session.waiters
    const index = list.indexOf(waiter)
    if (index !== -1) list.splice(index, 1)
  }

  // Her bekleyen poll tam bir kez sonlanır: yanıtla, zaman aşımıyla ya da istemci kapanmasıyla.
  function finishWaiter (waiter, messages) {
    if (waiter.done) return
    waiter.done = true
    clearTimeout(waiter.timer)
    removeWaiter(waiter)
    waiter.session.lastSeen = Date.now()
    sendJson(waiter.res, 200, pollPayload(messages))
  }

  function allWaiters () {
    const pending = []
    for (const session of sessions.values()) {
      for (const waiter of session.waiters) pending.push(waiter)
    }
    return pending
  }

  function wakeWaiters () {
    for (const waiter of allWaiters()) finishWaiter(waiter, messagesSince(waiter.since))
  }

  function closeSessionWaiters (session) {
    for (const waiter of session.waiters.slice()) finishWaiter(waiter, [])
  }

  function addMessage (type, nick, text) {
    const message = { id: nextId, type, nick, text, ts: Date.now() }
    nextId += 1
    history.push(message)
    if (history.length > historyLimit) history.splice(0, history.length - historyLimit)
    wakeWaiters()
    return message
  }

  function announceJoin (session) {
    addMessage('system', session.nick, `${session.nick} sohbete katıldı`)
  }

  function announceLeave (session) {
    addMessage('system', session.nick, `${session.nick} sohbetten ayrıldı`)
  }

  function isActive (session, now) {
    return session.waiters.length > 0 || now - session.lastSeen < pollTimeoutMs + graceMs
  }

  function markOnline (session) {
    if (session.online) return
    session.online = true
    announceJoin(session)
  }

  function removeSession (session) {
    sessions.delete(session.token)
    session.online = false
    closeSessionWaiters(session)
  }

  function findSession (token) {
    if (typeof token !== 'string' || token === '') return null
    return sessions.get(token) || null
  }

  function findSessionByKey (key) {
    for (const session of sessions.values()) {
      if (session.key === key) return session
    }
    return null
  }

  function evictOldestOffline () {
    let oldest = null
    for (const session of sessions.values()) {
      if (session.online) continue
      if (oldest === null || session.lastSeen < oldest.lastSeen) oldest = session
    }
    if (oldest === null) return false
    removeSession(oldest)
    return true
  }

  function allowJoinAttempt (ip, now) {
    let times = joinAttempts.get(ip)
    if (!times) {
      times = []
      joinAttempts.set(ip, times)
    }
    return takeSlot(times, config.joinLimit, config.joinWindowMs, now)
  }

  function sweep () {
    const now = Date.now()
    for (const session of sessions.values()) {
      if (session.online && !isActive(session, now)) {
        session.online = false
        announceLeave(session)
      }
    }
    for (const [ip, times] of joinAttempts) {
      if (times.length === 0 || now - times[times.length - 1] >= config.joinWindowMs) joinAttempts.delete(ip)
    }
  }

  function handleInfo (req, res) {
    sendJson(res, 200, {
      room,
      passwordRequired,
      maxMessageLength,
      nickMin: NICK_MIN,
      nickMax: NICK_MAX
    })
  }

  function handleJoin (req, res, body) {
    const now = Date.now()
    if (!allowJoinAttempt(clientIp(req), now)) return sendError(res, 429, 'rate_limited', JOIN_RATE_MESSAGE)
    if (passwordRequired) {
      const given = typeof body.password === 'string' ? body.password : ''
      if (!crypto.timingSafeEqual(sha256(given), passwordHash)) return sendError(res, 401, 'wrong_password')
    }
    const nick = cleanNick(body.nick)
    if (nick === null) return sendError(res, 400, 'invalid_nick')
    const key = nick.toLocaleLowerCase('tr-TR')
    const existing = findSessionByKey(key)
    if (existing) {
      if (existing.online) return sendError(res, 409, 'nick_taken')
      removeSession(existing)
    }
    if (sessions.size >= config.maxSessions && !evictOldestOffline()) return sendError(res, 503, 'room_full')
    const session = {
      token: crypto.randomBytes(24).toString('base64url'),
      nick,
      key,
      online: true,
      lastSeen: now,
      waiters: [],
      sendTimes: []
    }
    sessions.set(session.token, session)
    announceJoin(session)
    sendJson(res, 200, statePayload(session))
  }

  function handleResume (req, res, body) {
    if (!allowJoinAttempt(clientIp(req), Date.now())) return sendError(res, 429, 'rate_limited', JOIN_RATE_MESSAGE)
    const session = findSession(body.token)
    if (!session) return sendError(res, 401, 'invalid_token')
    session.lastSeen = Date.now()
    markOnline(session)
    sendJson(res, 200, statePayload(session))
  }

  function handlePoll (req, res, query) {
    const session = findSession(req.headers['x-token'])
    if (!session) return sendError(res, 401, 'invalid_token')
    const since = parseSince(query.get('since'), currentLastId())
    session.lastSeen = Date.now()
    markOnline(session)
    const ready = messagesSince(since)
    if (ready.length > 0 || closing) return sendJson(res, 200, pollPayload(ready))

    if (session.waiters.length >= MAX_WAITERS_PER_SESSION) finishWaiter(session.waiters[0], [])
    const waiter = { session, since, res, timer: null, done: false }
    waiter.timer = setTimeout(() => finishWaiter(waiter, []), pollTimeoutMs)
    session.waiters.push(waiter)
    res.on('close', () => {
      if (waiter.done) return
      waiter.done = true
      clearTimeout(waiter.timer)
      removeWaiter(waiter)
      waiter.session.lastSeen = Date.now()
    })
  }

  function handleSend (req, res, body) {
    const session = findSession(req.headers['x-token'])
    if (!session) return sendError(res, 401, 'invalid_token')
    const now = Date.now()
    session.lastSeen = now
    markOnline(session)
    const text = cleanText(body.text, maxMessageLength)
    if (text === null) return sendError(res, 400, 'invalid_text', invalidTextMessage)
    if (!takeSlot(session.sendTimes, config.sendLimit, config.sendWindowMs, now)) return sendError(res, 429, 'rate_limited', SEND_RATE_MESSAGE)
    const message = addMessage('chat', session.nick, text)
    sendJson(res, 200, { ok: true, id: message.id })
  }

  function handleLeave (req, res) {
    const session = findSession(req.headers['x-token'])
    if (!session) return sendError(res, 401, 'invalid_token')
    const wasOnline = session.online
    removeSession(session)
    if (wasOnline) announceLeave(session)
    sendJson(res, 200, { ok: true })
  }

  const apiRoutes = new Map()
  apiRoutes.set('/api/info', { method: 'GET', handler: handleInfo })
  apiRoutes.set('/api/join', { method: 'POST', handler: handleJoin })
  apiRoutes.set('/api/resume', { method: 'POST', handler: handleResume })
  apiRoutes.set('/api/poll', { method: 'GET', handler: handlePoll })
  apiRoutes.set('/api/send', { method: 'POST', handler: handleSend })
  apiRoutes.set('/api/leave', { method: 'POST', handler: handleLeave })

  function handleFailure (res, err) {
    console.error('Beklenmeyen sunucu hatası:', err)
    if (!res.headersSent && !res.writableEnded) sendError(res, 500, 'server_error')
  }

  function handleApi (req, res, pathname, query) {
    const route = apiRoutes.get(pathname)
    if (!route) return sendError(res, 404, 'not_found')
    if (req.method !== route.method) {
      res.setHeader('Allow', route.method)
      return sendError(res, 405, 'method_not_allowed')
    }
    if (route.method === 'GET') return route.handler(req, res, query)
    readBody(req, config.maxBodyBytes).then(result => {
      if (result === null) return
      if (result.tooLarge) return sendError(res, 413, 'too_large')
      const body = parseJsonObject(result.text)
      if (body === null) return sendError(res, 400, 'bad_request')
      route.handler(req, res, body)
    }).catch(err => handleFailure(res, err))
  }

  function serveStatic (req, res, pathname) {
    const entry = STATIC_ROUTES.get(pathname)
    if (!entry) return sendText(res, 404, 'Sayfa bulunamadı.')
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD')
      return sendText(res, 405, 'Bu istek yöntemi desteklenmiyor.')
    }
    fs.readFile(path.join(config.publicDir, entry.file), (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') sendText(res, 404, 'Sayfa bulunamadı.')
        else sendText(res, 500, 'Dosya okunamadı.')
        return
      }
      if (res.headersSent || res.writableEnded) return
      res.statusCode = 200
      res.setHeader('Content-Type', entry.type)
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Content-Length', data.length)
      if (entry.html) res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
      if (req.method === 'HEAD') res.end()
      else res.end(data)
    })
  }

  function handleRequest (req, res) {
    setSecurityHeaders(res)
    const rawUrl = typeof req.url === 'string' ? req.url : '/'
    const queryIndex = rawUrl.indexOf('?')
    const pathname = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex)
    const query = new URLSearchParams(queryIndex === -1 ? '' : rawUrl.slice(queryIndex + 1))
    if (pathname === '/api' || pathname.startsWith('/api/')) return handleApi(req, res, pathname, query)
    serveStatic(req, res, pathname)
  }

  const server = http.createServer((req, res) => {
    try {
      handleRequest(req, res)
    } catch (err) {
      handleFailure(res, err)
    }
  })

  function stopSweep () {
    if (sweepTimer !== null) {
      clearInterval(sweepTimer)
      sweepTimer = null
    }
  }

  function shutdown () {
    closing = true
    stopSweep()
    for (const waiter of allWaiters()) finishWaiter(waiter, [])
  }

  server.on('listening', () => {
    stopSweep()
    closing = false
    sweepTimer = setInterval(sweep, config.sweepIntervalMs)
    sweepTimer.unref()
  })
  server.on('close', shutdown)

  // 'close' olayı ancak tüm bağlantılar bitince gelir, bu yüzden bekleyen poll'lar close() çağrısında sonlandırılır.
  const closeServer = server.close
  server.close = function close (callback) {
    shutdown()
    return closeServer.call(this, callback)
  }

  return server
}

function lanAddresses () {
  const result = []
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const address of interfaces[name] || []) {
      const isIPv4 = address.family === 'IPv4' || address.family === 4
      if (isIPv4 && !address.internal) result.push(address.address)
    }
  }
  return result
}

function printBanner (room, passwordSet, host, port) {
  const lines = []
  lines.push('PS5 + PC Sohbet sunucusu çalışıyor.')
  lines.push(`Oda adı: ${room}`)
  if (passwordSet) {
    lines.push('Oda şifresi: belirlendi.')
  } else {
    lines.push('Oda şifresi: yok.')
    lines.push('Uyarı: Sohbet internete açılacaksa ODA_SIFRESI ortam değişkeni ile bir oda şifresi belirlemeniz önerilir.')
  }
  lines.push('')
  lines.push('Erişim adresleri:')
  if (host === '0.0.0.0' || host === '::') {
    lines.push(`  Bu bilgisayardan: http://localhost:${port}`)
    const addresses = lanAddresses()
    if (addresses.length === 0) lines.push('  Aynı ağdaki cihazlar için ağ adresi bulunamadı.')
    for (const address of addresses) lines.push(`  Aynı ağdaki cihazlardan: http://${address}:${port}`)
  } else {
    const shown = host.includes(':') ? `[${host}]` : host
    lines.push(`  http://${shown}:${port}`)
  }
  lines.push('')
  lines.push(`İnternet üzerinden erişim için tunel.bat dosyasını çalıştırın veya şu komutu kullanın: cloudflared tunnel --url http://localhost:${port}`)
  lines.push('Sunucuyu durdurmak için Ctrl+C tuşlarına basın.')
  console.log(lines.join('\n'))
}

function start () {
  const env = process.env
  const rawPort = typeof env.PORT === 'string' ? env.PORT.trim() : ''
  const port = rawPort === '' ? 3000 : Number(rawPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`PORT değeri geçersiz: "${env.PORT}". 1 ile 65535 arasında bir sayı girin.`)
    process.exit(1)
  }
  const host = typeof env.HOST === 'string' && env.HOST.trim() !== '' ? env.HOST.trim() : '0.0.0.0'
  const room = cleanRoomName(env.ODA_ADI)
  const password = env.ODA_SIFRESI || ''
  const server = createChatServer({ room, password })

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Hata: ${port} numaralı bağlantı noktası zaten kullanımda. Sunucu başka bir pencerede çalışıyor olabilir. O pencereyi kapatın veya PORT ortam değişkeni ile başka bir bağlantı noktası seçin.`)
    } else if (err.code === 'EACCES') {
      console.error(`Hata: ${port} numaralı bağlantı noktasını açma izni yok. 1024 üzerinde bir PORT değeri deneyin.`)
    } else {
      console.error(`Hata: Sunucu başlatılamadı (${err.message}).`)
    }
    process.exit(1)
  })

  server.listen(port, host, () => {
    printBanner(room, password !== '', host, server.address().port)
  })

  let stopping = false
  function stop () {
    if (stopping) process.exit(0)
    stopping = true
    console.log('Sunucu kapatılıyor...')
    server.close(() => process.exit(0))
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections()
    const force = setTimeout(() => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections()
      process.exit(0)
    }, 2000)
    force.unref()
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

module.exports = { createChatServer }

if (require.main === module) start()
