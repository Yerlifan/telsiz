'use strict'

// Telsiz sunucusunun giriş noktası: ortam değişkenleri, parola sıfırlama komutu, başlatma,
// banner ve düzgün kapanış.
// Kullanım:
//   node server.js
//   node server.js sifre-sifirla <kullanıcı adı>   (İngilizce adı: reset-password)
// Konsol dili DIL (TELSIZ_LANG) ortam değişkeninden, yoksa sistem yerel ayarından seçilir.
// Ortam değişkenlerinin Türkçe ve İngilizce adları vardır, ikisi birden verilirse Türkçe ad geçerlidir.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createChatServer } = require('./src/app')
const { openStore, StoreError, lockInfo } = require('./src/store')
const auth = require('./src/auth')
const i18n = require('./src/i18n')

const PRODUCT_NAME = 'Telsiz'
const DEFAULT_PORT = 3000
const DEFAULT_HOST = '0.0.0.0'
const DEFAULT_UPLOAD_MB = 25
const DEFAULT_QUOTA_MB = 2048
const DEFAULT_STUN = 'stun:stun.l.google.com:19302'
const SHUTDOWN_LIMIT_MS = 3000
const CLI_SCRYPT_N = 16384
const MB = 1024 * 1024

// Ortam değişkenlerinin Türkçe adları ve İngilizce takma adları
const ENV_NAMES = Object.freeze({
  serverName: ['SUNUCU_ADI', 'SERVER_NAME'],
  dataDir: ['VERI_KLASORU', 'DATA_DIR'],
  uploadMb: ['MAKS_YUKLEME_MB', 'MAX_UPLOAD_MB'],
  quotaMb: ['YUKLEME_KOTASI_MB', 'UPLOAD_QUOTA_MB'],
  turnUser: ['TURN_KULLANICI', 'TURN_USERNAME'],
  turnSecret: ['TURN_SIFRE', 'TURN_PASSWORD'],
  trustedProxy: ['GUVENILIR_VEKIL', 'TRUSTED_PROXY'],
  lang: ['DIL', 'TELSIZ_LANG']
})

// Hata metni yapılandırma okunurken zaten konsol dilinde üretilir
class ConfigError extends Error {}

function noop () {}

function envText (env, name) {
  const value = env[name]
  return typeof value === 'string' ? value.trim() : ''
}

// Türkçe ad doluysa o, değilse İngilizce takma ad. Hata metinlerinde kullanılan ad da döner.
function envPick (env, names) {
  for (const name of names) {
    const value = envText(env, name)
    if (value !== '') return { name, value }
  }
  return { name: names[0], value: '' }
}

// Boşluk dahil olduğu gibi okunan değerler (TURN parolası gibi) için
function envRawPick (env, names) {
  for (const name of names) {
    if (typeof env[name] === 'string' && env[name] !== '') return env[name]
  }
  return ''
}

function consoleLang (env) {
  return i18n.consoleLang(env || process.env)
}

function parsePort (raw, lang) {
  if (raw === '') return DEFAULT_PORT
  const port = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(i18n.t(lang, 'config.badPort', { name: 'PORT', value: raw }))
  }
  return port
}

function parseMegabytes (picked, fallback, max, lang) {
  if (picked.value === '') return fallback
  const value = /^\d+(\.\d+)?$/.test(picked.value) ? Number(picked.value) : NaN
  if (!Number.isFinite(value) || value <= 0 || value > max) {
    throw new ConfigError(i18n.t(lang, 'config.badMegabytes', { name: picked.name, value: picked.value, max }))
  }
  return value
}

function parseUrlList (raw, name, prefixes, lang) {
  const list = raw.split(',').map((s) => s.trim()).filter((s) => s !== '')
  for (const url of list) {
    const lower = url.toLowerCase()
    if (url.length > 512 || !prefixes.some((p) => lower.startsWith(p))) {
      const joined = prefixes.join(' ' + i18n.t(lang, 'config.or') + ' ')
      throw new ConfigError(i18n.t(lang, 'config.badUrl', { name, value: url, prefixes: joined }))
    }
  }
  return list
}

function dataDirFromEnv (env) {
  const raw = envPick(env, ENV_NAMES.dataDir).value
  return raw === '' ? path.join(__dirname, 'veri') : path.resolve(raw)
}

// Ortam değişkenlerini okur ve doğrular. Hatalıysa konsol dilinde metinli ConfigError fırlatır.
function readConfig (env) {
  const lang = consoleLang(env)
  const port = parsePort(envText(env, 'PORT'), lang)
  const host = envText(env, 'HOST') || DEFAULT_HOST
  const name = envPick(env, ENV_NAMES.serverName)
  let serverName = PRODUCT_NAME
  if (name.value !== '') {
    serverName = auth.cleanServerName(name.value)
    if (serverName === null) throw new ConfigError(i18n.t(lang, 'config.badServerName', { name: name.name }))
  }
  const upload = envPick(env, ENV_NAMES.uploadMb)
  const quota = envPick(env, ENV_NAMES.quotaMb)
  const uploadMb = parseMegabytes(upload, DEFAULT_UPLOAD_MB, 1024, lang)
  const quotaMb = parseMegabytes(quota, DEFAULT_QUOTA_MB, 1048576, lang)
  const uploadMaxBytes = Math.floor(uploadMb * MB) + 16
  const uploadQuotaBytes = Math.floor(quotaMb * MB)
  if (uploadQuotaBytes < uploadMaxBytes) {
    throw new ConfigError(i18n.t(lang, 'config.quotaTooSmall', { quota: quota.name, upload: upload.name }))
  }

  const iceServers = []
  const stunRaw = env.STUN_URL === undefined ? DEFAULT_STUN : String(env.STUN_URL).trim()
  const stun = parseUrlList(stunRaw, 'STUN_URL', ['stun:', 'stuns:'], lang)
  if (stun.length > 0) iceServers.push({ urls: stun.length === 1 ? stun[0] : stun })
  const turn = parseUrlList(envText(env, 'TURN_URL'), 'TURN_URL', ['turn:', 'turns:'], lang)
  if (turn.length > 0) {
    const entry = { urls: turn.length === 1 ? turn[0] : turn }
    const user = envRawPick(env, ENV_NAMES.turnUser)
    const secret = envRawPick(env, ENV_NAMES.turnSecret)
    if (user !== '') entry.username = user
    if (secret !== '') entry.credential = secret
    iceServers.push(entry)
  }

  const proxy = envPick(env, ENV_NAMES.trustedProxy)
  const trustedProxies = auth.parseTrustedProxies(proxy.value)
  if (trustedProxies === null) {
    throw new ConfigError(i18n.t(lang, 'config.badProxy', { name: proxy.name, value: proxy.value }))
  }

  return {
    lang,
    port,
    host,
    serverName,
    dataDir: dataDirFromEnv(env),
    uploadMaxBytes,
    uploadQuotaBytes,
    iceServers,
    turnEnabled: turn.length > 0,
    trustedProxies
  }
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

function printBanner (server, config, port) {
  const lang = config.lang
  const lines = []
  lines.push(i18n.t(lang, 'console.running', { product: PRODUCT_NAME }))
  lines.push(i18n.t(lang, 'console.serverName', { name: server.serverName }))
  lines.push(i18n.t(lang, 'console.dataDir', { dir: server.dataDir }))
  const code = server.setupCode
  if (code) {
    const bar = '='.repeat(72)
    lines.push('')
    lines.push(bar)
    lines.push(i18n.t(lang, 'console.setupCode', { code: code.toUpperCase() }))
    lines.push(i18n.t(lang, 'console.setupCodeNote'))
    lines.push(bar)
  }
  lines.push('')
  lines.push(i18n.t(lang, 'console.addresses'))
  if (config.host === '0.0.0.0' || config.host === '::') {
    lines.push(i18n.t(lang, 'console.local', { url: 'http://localhost:' + port }))
    const addresses = lanAddresses()
    if (addresses.length === 0) lines.push(i18n.t(lang, 'console.noLan'))
    for (const address of addresses) lines.push(i18n.t(lang, 'console.lan', { url: 'http://' + address + ':' + port }))
  } else {
    const shown = config.host.includes(':') ? '[' + config.host + ']' : config.host
    lines.push('  http://' + shown + ':' + port)
  }
  lines.push('')
  lines.push(i18n.t(lang, 'console.https'))
  lines.push(i18n.t(lang, 'console.httpLimits', { url: 'http://localhost:' + port }))
  lines.push(i18n.t(lang, 'console.tunnel', { command: 'cloudflared tunnel --url http://localhost:' + port }))
  lines.push(i18n.t(lang, config.turnEnabled ? 'console.turnOn' : 'console.turnOff'))
  const proxies = config.trustedProxies
  if (proxies.length !== 1 || proxies[0] !== 'loopback') lines.push(i18n.t(lang, 'console.proxy', { list: proxies.join(', ') }))
  lines.push('')
  lines.push(i18n.t(lang, 'console.stopHint'))
  console.log(lines.join('\n'))
}

function errorMessage (err) {
  return err && err.message ? err.message : String(err)
}

function listenError (err, port, lang) {
  if (err && err.code === 'EADDRINUSE') return i18n.t(lang, 'console.portInUse', { port })
  if (err && err.code === 'EACCES') return i18n.t(lang, 'console.portDenied', { port })
  if (err && err.code === 'EADDRNOTAVAIL') return i18n.t(lang, 'console.hostMissing')
  return i18n.t(lang, 'console.listenFailed', { error: errorMessage(err) })
}

function closeServer (server) {
  return new Promise((resolve) => {
    server.close((err) => resolve(err || null))
  })
}

async function start () {
  let config
  try {
    config = readConfig(process.env)
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(i18n.t(consoleLang(), 'console.errorPrefix', { message: err.message }))
      return 1
    }
    throw err
  }
  const lang = config.lang

  let server
  try {
    server = await createChatServer({
      dataDir: config.dataDir,
      serverName: config.serverName,
      uploadMaxBytes: config.uploadMaxBytes,
      uploadQuotaBytes: config.uploadQuotaBytes,
      iceServers: config.iceServers,
      trustedProxies: config.trustedProxies,
      lang,
      log: console
    })
  } catch (err) {
    if (err instanceof StoreError) {
      console.error(i18n.t(lang, 'console.errorPrefix', { message: err.message }))
      return 1
    }
    throw err
  }

  // Beklenmeyen bir hata tek bir isteği etkiler, süreci düşürmez
  process.on('unhandledRejection', (reason) => {
    console.error(i18n.t(lang, 'console.unhandledRejection', { error: reason && reason.stack ? reason.stack : String(reason) }))
  })
  process.on('uncaughtException', (err) => {
    console.error(i18n.t(lang, 'console.uncaughtException', { error: err && err.stack ? err.stack : String(err) }))
  })

  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(config.port, config.host, () => {
        server.removeListener('error', reject)
        resolve()
      })
    })
  } catch (err) {
    console.error(listenError(err, config.port, lang))
    await closeServer(server)
    return 1
  }
  server.on('error', (err) => {
    console.error(i18n.t(lang, 'console.serverError', { error: errorMessage(err) }))
  })

  printBanner(server, config, server.address().port)

  let stopping = false
  function stop () {
    if (stopping) {
      console.log(i18n.t(lang, 'console.stopNow'))
      process.exit(1)
    }
    stopping = true
    console.log(i18n.t(lang, 'console.stopping'))
    const force = setTimeout(() => {
      console.error(i18n.t(lang, 'console.stopTimeout', { seconds: SHUTDOWN_LIMIT_MS / 1000 }))
      process.exit(1)
    }, SHUTDOWN_LIMIT_MS)
    force.unref()
    server.close((err) => {
      if (err) {
        console.error(i18n.t(lang, 'console.flushFailed', { error: errorMessage(err) }))
        process.exit(1)
      }
      console.log(i18n.t(lang, 'console.stopped'))
      process.exit(0)
    })
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  if (process.platform === 'win32') process.on('SIGBREAK', stop)
  return null
}

// ---------------------------------------------------------------- parola sıfırlama komutu

const QUIET_LOG = { info: noop, warn: (text) => console.error(text), error: (text) => console.error(text) }

async function resetPasswordCli (args) {
  const lang = consoleLang()
  const rawName = args.join(' ').trim()
  if (rawName === '') {
    console.error(i18n.t(lang, 'cli.usageReset'))
    return 1
  }
  const dir = dataDirFromEnv(process.env)
  let lock
  try {
    lock = lockInfo(dir)
  } catch (err) {
    console.error(i18n.t(lang, 'cli.dataDirAccess', { dir }))
    return 1
  }
  if (lock.alive && lock.pid !== process.pid) {
    console.error(i18n.t(lang, 'cli.serverRunning', { pid: lock.pid }))
    console.error(i18n.t(lang, 'cli.stopFirst'))
    return 1
  }
  const stateFile = path.join(dir, 'state.json')
  if (!fs.existsSync(stateFile) && !fs.existsSync(stateFile + '.bak')) {
    console.error(i18n.t(lang, 'cli.noAccounts', { dir }))
    console.error(i18n.t(lang, 'cli.dataDirHint'))
    return 1
  }

  let store
  try {
    store = await openStore({ dir, log: QUIET_LOG, lang })
  } catch (err) {
    const message = err instanceof StoreError ? err.message : i18n.t(lang, 'cli.openFailed', { error: errorMessage(err) })
    console.error(i18n.t(lang, 'console.errorPrefix', { message }))
    return 1
  }
  try {
    const state = store.state
    const name = auth.cleanUsername(rawName)
    const user = state
      ? state.users.find((u) => u && u.deleted !== true && typeof u.name === 'string' && u.name !== '' && (u.name === rawName || u.name === name))
      : null
    if (!user) {
      console.error(i18n.t(lang, 'cli.userNotFound', { name: rawName }))
      return 1
    }
    // İstemciyle aynı türetme: geçici paroladan yeni tuzla authKey, sunucuda onun karması.
    // Kişisel anahtarlar silinir, kullanıcı sonraki girişte yeni anahtar çifti üretir.
    const creds = await auth.newCredentials(CLI_SCRYPT_N)
    user.passHash = creds.passHash
    user.kdf = creds.kdf
    user.publicKey = null
    user.wrappedKey = null
    user.identity = null
    user.pv = Number.isSafeInteger(user.pv) && user.pv >= 0 ? user.pv + 1 : 1
    const before = state.sessions.length
    state.sessions = state.sessions.filter((s) => !s || s.userId !== user.id)
    store.saveState()
    await store.close()
    console.log(i18n.t(lang, 'cli.resetDone', { name: user.name }))
    console.log(i18n.t(lang, 'cli.tempPassword', { password: creds.tempPassword }))
    console.log(i18n.t(lang, 'cli.sessionsClosed', { count: before - state.sessions.length }))
    console.log(i18n.t(lang, 'cli.keysReset'))
    console.log(i18n.t(lang, 'cli.changeHint'))
    return 0
  } catch (err) {
    console.error(i18n.t(lang, 'cli.resetFailed', { error: errorMessage(err) }))
    return 1
  } finally {
    await store.close().catch(noop)
  }
}

function printUsage () {
  const lang = consoleLang()
  console.error(i18n.t(lang, 'cli.usageTitle'))
  console.error(i18n.t(lang, 'cli.usageStart'))
  console.error(i18n.t(lang, 'cli.usageResetLine'))
  console.error(i18n.t(lang, 'cli.usageAliasLine'))
}

async function main (argv) {
  const args = argv.slice(2)
  if (args.length === 0) return start()
  if (args[0] === 'sifre-sifirla' || args[0] === 'reset-password') return resetPasswordCli(args.slice(1))
  printUsage()
  return 1
}

module.exports = { createChatServer, readConfig, ENV_NAMES }

if (require.main === module) {
  main(process.argv).then((code) => {
    if (typeof code === 'number') process.exitCode = code
  }, (err) => {
    console.error(i18n.t(consoleLang(), 'console.errorPrefix', { message: err && err.stack ? err.stack : String(err) }))
    process.exitCode = 1
  })
}
