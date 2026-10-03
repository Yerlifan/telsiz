'use strict'

// Telsiz sunucusunun giriş noktası: ortam değişkenleri, "sifre-sifirla" komutu,
// başlatma, banner ve düzgün kapanış (SPEC-V2 3.1 ve 3.2).
// Kullanım:
//   node server.js
//   node server.js sifre-sifirla <kullanıcı adı>

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { createChatServer } = require('./src/app')
const { openStore, StoreError, lockInfo } = require('./src/store')
const auth = require('./src/auth')

const PRODUCT_NAME = 'Telsiz'
const DEFAULT_PORT = 3000
const DEFAULT_HOST = '0.0.0.0'
const DEFAULT_UPLOAD_MB = 25
const DEFAULT_QUOTA_MB = 2048
const DEFAULT_STUN = 'stun:stun.l.google.com:19302'
const SHUTDOWN_LIMIT_MS = 3000
const CLI_SCRYPT_N = 16384
const MB = 1024 * 1024

class ConfigError extends Error {}

function noop () {}

function envText (env, name) {
  const value = env[name]
  return typeof value === 'string' ? value.trim() : ''
}

function parsePort (raw) {
  if (raw === '') return DEFAULT_PORT
  const port = /^\d{1,5}$/.test(raw) ? Number(raw) : NaN
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError('PORT değeri geçersiz: "' + raw + '". 1 ile 65535 arasında bir sayı girin.')
  }
  return port
}

function parseMegabytes (raw, name, fallback, max) {
  if (raw === '') return fallback
  const value = /^\d+(\.\d+)?$/.test(raw) ? Number(raw) : NaN
  if (!Number.isFinite(value) || value <= 0 || value > max) {
    throw new ConfigError(name + ' değeri geçersiz: "' + raw + '". 0 ile ' + max + ' arasında bir sayı (MB) girin.')
  }
  return value
}

function parseUrlList (raw, name, prefixes) {
  const list = raw.split(',').map((s) => s.trim()).filter((s) => s !== '')
  for (const url of list) {
    const lower = url.toLowerCase()
    if (url.length > 512 || !prefixes.some((p) => lower.startsWith(p))) {
      throw new ConfigError(name + ' değeri geçersiz: "' + url + '". Adres ' + prefixes.join(' veya ') + ' ile başlamalıdır.')
    }
  }
  return list
}

function dataDirFromEnv (env) {
  const raw = envText(env, 'VERI_KLASORU')
  return raw === '' ? path.join(__dirname, 'veri') : path.resolve(raw)
}

// Ortam değişkenlerini okur ve doğrular. Hatalıysa ConfigError fırlatır.
function readConfig (env) {
  const port = parsePort(envText(env, 'PORT'))
  const host = envText(env, 'HOST') || DEFAULT_HOST
  const rawName = envText(env, 'SUNUCU_ADI')
  let serverName = PRODUCT_NAME
  if (rawName !== '') {
    serverName = auth.cleanServerName(rawName)
    if (serverName === null) throw new ConfigError('SUNUCU_ADI değeri geçersiz. Sunucu adı 1 ile 40 karakter arasında olmalıdır.')
  }
  const uploadMb = parseMegabytes(envText(env, 'MAKS_YUKLEME_MB'), 'MAKS_YUKLEME_MB', DEFAULT_UPLOAD_MB, 1024)
  const quotaMb = parseMegabytes(envText(env, 'YUKLEME_KOTASI_MB'), 'YUKLEME_KOTASI_MB', DEFAULT_QUOTA_MB, 1048576)
  const uploadMaxBytes = Math.floor(uploadMb * MB) + 16
  const uploadQuotaBytes = Math.floor(quotaMb * MB)
  if (uploadQuotaBytes < uploadMaxBytes) {
    throw new ConfigError('YUKLEME_KOTASI_MB, MAKS_YUKLEME_MB değerinden küçük olamaz.')
  }

  const iceServers = []
  const stunRaw = env.STUN_URL === undefined ? DEFAULT_STUN : String(env.STUN_URL).trim()
  const stun = parseUrlList(stunRaw, 'STUN_URL', ['stun:', 'stuns:'])
  if (stun.length > 0) iceServers.push({ urls: stun.length === 1 ? stun[0] : stun })
  const turn = parseUrlList(envText(env, 'TURN_URL'), 'TURN_URL', ['turn:', 'turns:'])
  if (turn.length > 0) {
    const entry = { urls: turn.length === 1 ? turn[0] : turn }
    const user = typeof env.TURN_KULLANICI === 'string' ? env.TURN_KULLANICI : ''
    const secret = typeof env.TURN_SIFRE === 'string' ? env.TURN_SIFRE : ''
    if (user !== '') entry.username = user
    if (secret !== '') entry.credential = secret
    iceServers.push(entry)
  }

  return {
    port,
    host,
    serverName,
    dataDir: dataDirFromEnv(env),
    uploadMaxBytes,
    uploadQuotaBytes,
    iceServers,
    turnEnabled: turn.length > 0
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
  const lines = []
  lines.push(PRODUCT_NAME + ' sunucusu çalışıyor.')
  lines.push('Sunucu adı: ' + server.serverName)
  lines.push('Veri klasörü: ' + server.dataDir)
  const code = server.setupCode
  if (code) {
    const bar = '='.repeat(72)
    lines.push('')
    lines.push(bar)
    lines.push('Kurulum kodu: ' + code.toUpperCase() + '. Tarayıcıda açıp sahip hesabını bu kodla oluşturun.')
    lines.push('Kod yalnızca sahip hesabı oluşturulana kadar geçerlidir ve her başlatmada yenilenir.')
    lines.push(bar)
  }
  lines.push('')
  lines.push('Erişim adresleri:')
  if (config.host === '0.0.0.0' || config.host === '::') {
    lines.push('  Bu bilgisayardan: http://localhost:' + port)
    const addresses = lanAddresses()
    if (addresses.length === 0) lines.push('  Aynı ağdaki cihazlar için ağ adresi bulunamadı.')
    for (const address of addresses) lines.push('  Aynı ağdaki cihazlardan: http://' + address + ':' + port)
  } else {
    const shown = config.host.includes(':') ? '[' + config.host + ']' : config.host
    lines.push('  http://' + shown + ':' + port)
  }
  lines.push('')
  lines.push('Sesli sohbet ve uygulama olarak yükleme (PWA) için adresin https:// ile başlaması gerekir.')
  lines.push('Aynı ağdaki http adreslerinde bunlar çalışmaz, yalnızca bu bilgisayarda http://localhost:' + port + ' adresinde çalışır.')
  lines.push('İnternetten https ile erişim için tunel.bat dosyasını çalıştırın veya şu komutu kullanın: cloudflared tunnel --url http://localhost:' + port)
  if (config.turnEnabled) lines.push('TURN sunucusu: etkin.')
  else lines.push('TURN sunucusu: tanımlı değil. Bazı ağlarda sesli sohbet için TURN gerekebilir (TURN_URL ayarı).')
  lines.push('')
  lines.push('Sunucuyu durdurmak için Ctrl+C tuşlarına basın.')
  console.log(lines.join('\n'))
}

function listenError (err, port) {
  if (err && err.code === 'EADDRINUSE') {
    return 'Hata: ' + port + ' numaralı bağlantı noktası zaten kullanımda. Sunucu başka bir pencerede çalışıyor olabilir. O pencereyi kapatın veya PORT ortam değişkeniyle başka bir bağlantı noktası seçin.'
  }
  if (err && err.code === 'EACCES') {
    return 'Hata: ' + port + ' numaralı bağlantı noktasını açma izni yok. 1024 üzerinde bir PORT değeri deneyin.'
  }
  if (err && err.code === 'EADDRNOTAVAIL') {
    return 'Hata: HOST değerindeki adres bu bilgisayarda bulunamadı. HOST ayarını kaldırın veya doğru bir adres girin.'
  }
  return 'Hata: Sunucu başlatılamadı (' + (err && err.message ? err.message : String(err)) + ').'
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
      console.error('Hata: ' + err.message)
      return 1
    }
    throw err
  }

  let server
  try {
    server = await createChatServer({
      dataDir: config.dataDir,
      serverName: config.serverName,
      uploadMaxBytes: config.uploadMaxBytes,
      uploadQuotaBytes: config.uploadQuotaBytes,
      iceServers: config.iceServers,
      log: console
    })
  } catch (err) {
    if (err instanceof StoreError) {
      console.error('Hata: ' + err.message)
      return 1
    }
    throw err
  }

  // Beklenmeyen bir hata tek bir isteği etkiler, süreci düşürmez
  process.on('unhandledRejection', (reason) => {
    console.error('Yakalanmamış Promise reddi: ' + (reason && reason.stack ? reason.stack : String(reason)))
  })
  process.on('uncaughtException', (err) => {
    console.error('Yakalanmamış hata: ' + (err && err.stack ? err.stack : String(err)))
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
    console.error(listenError(err, config.port))
    await closeServer(server)
    return 1
  }
  server.on('error', (err) => {
    console.error('Sunucu hatası: ' + (err && err.message ? err.message : String(err)))
  })

  printBanner(server, config, server.address().port)

  let stopping = false
  function stop () {
    if (stopping) {
      console.log('Sunucu hemen kapatılıyor.')
      process.exit(1)
    }
    stopping = true
    console.log('Sunucu kapatılıyor...')
    const force = setTimeout(() => {
      console.error('Kapanış ' + (SHUTDOWN_LIMIT_MS / 1000) + ' saniye içinde tamamlanamadı, süreç sonlandırılıyor.')
      process.exit(1)
    }, SHUTDOWN_LIMIT_MS)
    force.unref()
    server.close((err) => {
      if (err) {
        console.error('Kapanış sırasında veriler diske yazılamadı: ' + (err.message || String(err)))
        process.exit(1)
      }
      console.log('Sunucu kapatıldı.')
      process.exit(0)
    })
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
  if (process.platform === 'win32') process.on('SIGBREAK', stop)
  return null
}

// ---------------------------------------------------------------- sifre-sifirla komutu

const QUIET_LOG = { info: noop, warn: (text) => console.error(text), error: (text) => console.error(text) }

async function resetPasswordCli (args) {
  const rawName = args.join(' ').trim()
  if (rawName === '') {
    console.error('Kullanım: node server.js sifre-sifirla <kullanıcı adı>')
    return 1
  }
  const dir = dataDirFromEnv(process.env)
  let lock
  try {
    lock = lockInfo(dir)
  } catch (err) {
    console.error('Hata: Veri klasörüne erişilemedi: ' + dir)
    return 1
  }
  if (lock.alive && lock.pid !== process.pid) {
    console.error('Hata: Sunucu şu anda çalışıyor (PID ' + lock.pid + '). Çalışan sunucu, bu komutun yaptığı değişikliği kendi verisiyle ezer.')
    console.error('Önce sunucu penceresinde Ctrl+C ile sunucuyu durdurun, sonra komutu yeniden çalıştırın.')
    return 1
  }
  const stateFile = path.join(dir, 'state.json')
  if (!fs.existsSync(stateFile) && !fs.existsSync(stateFile + '.bak')) {
    console.error('Hata: Veri klasöründe kayıtlı hesap bulunamadı: ' + dir)
    console.error('VERI_KLASORU ayarı kullanıyorsanız komuttan önce aynı değeri verin.')
    return 1
  }

  let store
  try {
    store = await openStore({ dir, log: QUIET_LOG })
  } catch (err) {
    console.error('Hata: ' + (err instanceof StoreError ? err.message : 'Veri klasörü açılamadı (' + err.message + ').'))
    return 1
  }
  try {
    const state = store.state
    const name = auth.cleanName(rawName)
    const key = name === null ? null : auth.nameKey(name)
    const user = state && key !== null
      ? state.users.find((u) => u && typeof u.name === 'string' && auth.nameKey(u.name) === key)
      : null
    if (!user) {
      console.error('Hata: "' + rawName + '" adlı kullanıcı bulunamadı.')
      return 1
    }
    const tempPassword = auth.generateTempPassword()
    user.passHash = await auth.hashPassword(tempPassword, CLI_SCRYPT_N)
    const before = state.sessions.length
    state.sessions = state.sessions.filter((s) => !s || s.userId !== user.id)
    store.saveState()
    await store.close()
    console.log('"' + user.name + '" hesabının parolası sıfırlandı.')
    console.log('Geçici parola: ' + tempPassword)
    console.log('Hesabın ' + (before - state.sessions.length) + ' açık oturumu kapatıldı.')
    console.log('Bu parolayla giriş yaptıktan sonra Ayarlar penceresinin Hesap sekmesinden yeni bir parola belirleyin.')
    return 0
  } catch (err) {
    console.error('Hata: Parola sıfırlanamadı (' + (err && err.message ? err.message : String(err)) + ').')
    return 1
  } finally {
    await store.close().catch(noop)
  }
}

function printUsage () {
  console.error('Kullanım:')
  console.error('  node server.js                              sunucuyu başlatır')
  console.error('  node server.js sifre-sifirla <kullanıcı adı>   sunucu kapalıyken bir hesabın parolasını sıfırlar')
}

async function main (argv) {
  const args = argv.slice(2)
  if (args.length === 0) return start()
  if (args[0] === 'sifre-sifirla') return resetPasswordCli(args.slice(1))
  printUsage()
  return 1
}

module.exports = { createChatServer, readConfig }

if (require.main === module) {
  main(process.argv).then((code) => {
    if (typeof code === 'number') process.exitCode = code
  }, (err) => {
    console.error('Hata: ' + (err && err.stack ? err.stack : String(err)))
    process.exitCode = 1
  })
}
