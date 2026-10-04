'use strict'

// Gözetimsiz çalıştırmalar (duman testi, CI) için ana süreç tanı günlüğü.
// TELSIZ_TANI_GUNLUGU ortam değişkeni mutlak bir dosya yolu verirse ana süreç açılış adımlarını
// (tek örnek kilidi, ready, bütünlük denetimi, pencereler, sayfa yüklemeleri, alt süreç çökmeleri,
// yakalanmamış hatalar) hem bu dosyaya hem stderr'e "[telsiz-tani]" önekiyle yazar. Dosyaya
// eşzamanlı eklenir, böylece süreç takılsa veya öldürülse de son adım günlükte kalır. stderr
// satırları Playwright'ın başlatma çağrı günlüğünde de görünür.
// Değişken yoksa hiçbir şey yazılmaz. Değişken varken uygulama gözetimsiz çalışıyor sayılır:
// açılışı durduran hata engelleyici bir hata kutusuyla değil günlükle bildirilir (src/main.js).
// Günlüğe yalnızca uygulamanın kendi adresleri, olay adları ve hata metinleri yazılır, istek
// gövdesi, başlık veya oturum bilgisi yazılmaz. Electron'a bağımlı değildir.

const fs = require('node:fs')
const path = require('node:path')

const ENV_NAME = 'TELSIZ_TANI_GUNLUGU'
const PREFIX = '[telsiz-tani]'
const MAX_VALUE_CHARS = 500

// Ortamdan günlük dosyasının yolu: yalnızca mutlak yol kabul edilir, aksi halde null
function logPathFrom (env) {
  const value = env ? env[ENV_NAME] : undefined
  if (typeof value !== 'string' || value === '' || !path.isAbsolute(value)) return null
  return value
}

// Ayrıntı değerlerini tek satırlık, sınırlı uzunlukta JSON'a uygun biçime getirir
function sanitizeValue (value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Error) return sanitizeValue(value.stack || value.message)
  const text = String(value)
  return text.length > MAX_VALUE_CHARS ? text.slice(0, MAX_VALUE_CHARS) + '...' : text
}

function formatLine (date, event, details) {
  let line = PREFIX + ' ' + date.toISOString() + ' ' + String(event)
  if (details && typeof details === 'object') {
    const clean = {}
    for (const key of Object.keys(details)) clean[key] = sanitizeValue(details[key])
    line += ' ' + JSON.stringify(clean)
  }
  return line
}

// options: { file, appendFile(file, text), writeErr(text), now() }. file null ise günlük kapalıdır.
// Yazma hatası uygulamayı hiçbir zaman durdurmaz.
function createDiagnostics (options) {
  const file = options && options.file ? options.file : null
  const appendFile = options.appendFile || ((target, text) => fs.appendFileSync(target, text))
  const writeErr = options.writeErr || ((text) => process.stderr.write(text))
  const now = options.now || (() => new Date())
  function log (event, details) {
    if (!file) return
    const line = formatLine(now(), event, details) + '\n'
    try {
      appendFile(file, line)
    } catch (err) {
      // günlük dosyası yazılamıyorsa stderr yine de yazılır
    }
    try {
      writeErr(line)
    } catch (err) {
      // stderr kapalı olabilir
    }
  }
  return { enabled: Boolean(file), file, log }
}

function fromEnv (env) {
  return createDiagnostics({ file: logPathFrom(env) })
}

module.exports = {
  ENV_NAME,
  PREFIX,
  MAX_VALUE_CHARS,
  logPathFrom,
  formatLine,
  createDiagnostics,
  fromEnv
}
