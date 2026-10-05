#!/usr/bin/env node
'use strict'

// Telsiz sunucusunun giriş noktası: ortam değişkenleri, parola sıfırlama komutu, başlatma,
// banner ve düzgün kapanış.
// Kullanım:
//   node server.js                                 (npm ile kurulduysa: npx telsiz)
//   node server.js sifre-sifirla <kullanıcı adı>   (İngilizce adı: reset-password)
// Tek dosya olarak derlenmiş sunucuda (telsiz.exe, Linux ikilisi) komutlar aynıdır.
// Konsol dili DIL (TELSIZ_LANG) ortam değişkeninden, yoksa sistem yerel ayarından seçilir.
// Ortam değişkenlerinin Türkçe ve İngilizce adları vardır, ikisi birden verilirse Türkçe ad geçerlidir.
// Veri klasörü verilmezse çalışma klasöründeki veri klasörü, tek dosya olarak çalışırken
// yürütülebilir dosyanın yanındaki veri klasörü kullanılır. Tek dosya olarak çalışırken
// yanındaki telsiz.env dosyasındaki ayarlar da okunur (ortam değişkenleri önceliklidir).

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createChatServer } = require('./src/app')
const { openStore, StoreError, lockInfo } = require('./src/store')
const auth = require('./src/auth')
const i18n = require('./src/i18n')
const runtime = require('./src/runtime')
const envFile = require('./src/env-file')

const PRODUCT_NAME = 'Telsiz'
const DEFAULT_PORT = 3000
const DEFAULT_HOST = '0.0.0.0'
const DEFAULT_UPLOAD_MB = 25
const DEFAULT_QUOTA_MB = 2048
const DEFAULT_USER_QUOTA_MB = 512
const DEFAULT_MAX_TOTAL_MESSAGES = 500000
const MAX_TOTAL_MESSAGES_LIMIT = 100000000
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
  userQuotaMb: ['KULLANICI_YUKLEME_KOTASI_MB', 'USER_UPLOAD_QUOTA_MB'],
  maxTotalMessages: ['MAKS_TOPLAM_MESAJ', 'MAX_TOTAL_MESSAGES'],
  turnUser: ['TURN_KULLANICI', 'TURN_USERNAME'],
  turnSecret: ['TURN_SIFRE', 'TURN_PASSWORD'],
  trustedProxy: ['GUVENILIR_VEKIL', 'TRUSTED_PROXY'],
  lang: ['DIL', 'TELSIZ_LANG']
})

// telsiz.env dosyasında kabul edilen ayarlar. Her grup bir ayarın tüm adlarıdır.
const SETTING_GROUPS = Object.freeze([['PORT'], ['HOST'], ['STUN_URL'], ['TURN_URL']].concat(
  Object.keys(ENV_NAMES).map((key) => ENV_NAMES[key])
))

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

// Pozitif tam sayı ayarı (ör. toplam mesaj sınırı), boşsa varsayılan
function parseCount (picked, fallback, max, lang) {
  if (picked.value === '') return fallback
  const value = /^\d{1,15}$/.test(picked.value) ? Number(picked.value) : NaN
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    throw new ConfigError(i18n.t(lang, 'config.badCount', { name: picked.name, value: picked.value, max }))
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

// Varsayılan veri klasörü: tek dosya olarak çalışırken yürütülebilir dosyanın yanındaki, değilse
// çalışma klasöründeki veri klasörü (npm ile kurulduğunda node_modules içine yazılmaz)
function defaultDataDir () {
  if (runtime.isSea()) return path.join(path.dirname(process.execPath), 'veri')
  return path.join(process.cwd(), 'veri')
}

function dataDirFromEnv (env) {
  const raw = envPick(env, ENV_NAMES.dataDir).value
  return raw === '' ? defaultDataDir() : path.resolve(raw)
}

// npm paketi olarak mı kurulu (npx telsiz, npm install telsiz): sunucu dosyaları node_modules içinde
function installedFromNpm () {
  return __dirname.split(path.sep).includes('node_modules')
}

// Kullanım metinlerinde gösterilen komut: tek dosya uygulamasının adı, npm paketi olarak
// kurulduysa npx telsiz, değilse node server.js
function commandName () {
  if (runtime.isSea()) return path.basename(process.execPath)
  if (installedFromNpm()) return 'npx telsiz'
  return 'node server.js'
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
  // Kullanıcı başına kota verilmezse tek dosya sınırından küçük kalmaz (büyük MAKS_YUKLEME_MB kurulumları bozulmasın)
  const userQuota = envPick(env, ENV_NAMES.userQuotaMb)
  let userUploadQuotaBytes = Math.max(DEFAULT_USER_QUOTA_MB * MB, uploadMaxBytes)
  if (userQuota.value !== '') {
    userUploadQuotaBytes = Math.floor(parseMegabytes(userQuota, DEFAULT_USER_QUOTA_MB, 1048576, lang) * MB)
    if (userUploadQuotaBytes < uploadMaxBytes) {
      throw new ConfigError(i18n.t(lang, 'config.quotaTooSmall', { quota: userQuota.name, upload: upload.name }))
    }
  }
  const maxTotalMessages = parseCount(envPick(env, ENV_NAMES.maxTotalMessages), DEFAULT_MAX_TOTAL_MESSAGES, MAX_TOTAL_MESSAGES_LIMIT, lang)

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
    userUploadQuotaBytes,
    maxTotalMessages,
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

// İnternete https ile açma ipucu: depo kopyasında tunel.bat veya tunel.sh betiği, tek dosya
// uygulamasında ve npm paketinde (bu betikler yanlarında yoktur) yalnızca komut
function tunnelHint (lang, port) {
  const command = 'cloudflared tunnel --url http://localhost:' + port
  if (runtime.isSea() || installedFromNpm()) return i18n.t(lang, 'console.tunnelCommand', { command })
  const script = process.platform === 'win32' ? 'tunel.bat' : 'tunel.sh'
  return i18n.t(lang, 'console.tunnel', { script, command })
}

function printBanner (server, config, port) {
  const lang = config.lang
  const lines = []
  lines.push(i18n.t(lang, 'console.running', { product: PRODUCT_NAME }))
  const version = runtime.version()
  if (version) lines.push(i18n.t(lang, 'console.version', { version }))
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
  lines.push(tunnelHint(lang, port))
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
      userUploadQuotaBytes: config.userUploadQuotaBytes,
      maxTotalMessages: config.maxTotalMessages,
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
    console.error(i18n.t(lang, 'cli.usageReset', { command: commandName() }))
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
  // Kilit bu sürecin değilse ve canlıysa sunucu çalışıyordur (PID'in bu sürecinkiyle aynı olması, örneğin iki
  // konteynerde de PID 1, kilidi bu sürecin yapmaz, src/store.js readLock)
  if (lock.alive && !lock.mine) {
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
    user.credEpoch = creds.passHash
    user.kdf = creds.kdf
    user.publicKey = null
    user.wrappedKey = null
    user.identity = null
    // Yeni anahtar çifti yalnızca yeni parolayla birlikte kurulabilir (src/app.js applyCredentials)
    user.resetPending = true
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
  const command = commandName()
  console.error(i18n.t(lang, 'cli.usageTitle'))
  console.error(i18n.t(lang, 'cli.usageStart', { command }))
  console.error(i18n.t(lang, 'cli.usageStartNote'))
  console.error(i18n.t(lang, 'cli.usageResetLine', { command }))
  console.error(i18n.t(lang, 'cli.usageResetNote'))
  console.error(i18n.t(lang, 'cli.usageAliasLine', { command }))
  console.error(i18n.t(lang, 'cli.usageAliasNote'))
}

// ---------------------------------------------------------------- tek dosya uygulaması

// Tek dosya olarak çalışırken yürütülebilir dosyanın yanındaki telsiz.env dosyasını ortama ekler
// ve uyarıları konsol dilinde yazar. Dosya yoksa bir şey yapmaz. Okunamıyorsa veya çok büyükse
// ConfigError fırlatır, çünkü eksik okunan ayarlarla (ör. farklı bir veri klasörüyle) başlamak
// kullanıcıyı yanıltır.
function loadEnvFile (env) {
  const file = path.join(path.dirname(process.execPath), envFile.ENV_FILE_NAME)
  let text
  try {
    text = envFile.readEnvFile(file)
  } catch (err) {
    if (!(err instanceof envFile.EnvFileError)) throw err
    const lang = consoleLang(env)
    const key = err.code === 'tooLarge' ? 'envfile.tooLarge' : 'envfile.unreadable'
    throw new ConfigError(i18n.t(lang, key, { file, max: envFile.MAX_ENV_FILE_BYTES, error: err.detail }))
  }
  if (text === null) return
  const parsed = envFile.parseEnvFile(text, SETTING_GROUPS)
  const result = envFile.applyEnvFile(env, parsed, SETTING_GROUPS)
  const lang = consoleLang(env)
  console.log(i18n.t(lang, 'envfile.loaded', { file }))
  for (const warning of parsed.warnings) {
    console.error(i18n.t(lang, 'envfile.' + warning.kind, { file, line: warning.line, key: warning.key }))
  }
  for (const key of result.skipped) console.log(i18n.t(lang, 'envfile.skipped', { key }))
}

// Ölümcül başlatma hatasından sonra pencere hemen kapanmasın diye Enter beklenir. Yalnızca
// tek dosya uygulamasında ve etkileşimli konsolda (ör. çift tıklayınca açılan pencere).
function pausesOnFatal (sea, stdin, stdout) {
  return Boolean(sea && stdin && stdin.isTTY && stdout && stdout.isTTY)
}

function waitForEnter (lang) {
  return new Promise((resolve) => {
    const stdin = process.stdin
    let done = false
    const finish = () => {
      if (done) return
      done = true
      stdin.pause()
      resolve()
    }
    console.error('')
    console.error(i18n.t(lang, 'console.pressEnter'))
    stdin.once('data', finish)
    stdin.once('end', finish)
    stdin.once('error', finish)
    stdin.resume()
  })
}

async function main (argv) {
  const args = argv.slice(2)
  if (runtime.isSea()) loadEnvFile(process.env)
  if (args.length === 0) return start()
  if (args[0] === 'sifre-sifirla' || args[0] === 'reset-password') return resetPasswordCli(args.slice(1))
  printUsage()
  return 1
}

// Komutu çalıştırır. Sunucu başlatılamazsa (yapılandırma hatası, port dolu, bozuk veri) çıkış
// kodu 1 olur, tek dosya uygulamasının etkileşimli penceresinde önce Enter beklenir.
async function run (argv) {
  const starting = argv.length <= 2
  let code
  try {
    code = await main(argv)
  } catch (err) {
    const message = err instanceof ConfigError ? err.message : (err && err.stack ? err.stack : String(err))
    console.error(i18n.t(consoleLang(), 'console.errorPrefix', { message }))
    code = 1
  }
  if (typeof code !== 'number') return
  process.exitCode = code
  if (code !== 0 && starting && pausesOnFatal(runtime.isSea(), process.stdin, process.stdout)) {
    await waitForEnter(consoleLang())
    process.exit(code)
  }
}

module.exports = { createChatServer, readConfig, ENV_NAMES, SETTING_GROUPS, defaultDataDir, pausesOnFatal }

if (require.main === module) {
  if (runtime.isSea() && process.platform === 'win32') process.title = PRODUCT_NAME
  run(process.argv)
}
