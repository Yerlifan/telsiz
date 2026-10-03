'use strict'

// telsiz.env: tek dosya olarak çalışan sunucunun (telsiz.exe ve Linux ikilisi) yanındaki, not
// defteri gibi bir düzenleyiciyle değiştirilebilen ayar dosyası. Her satırda AD=değer yazılır,
// # ile başlayan satırlar yorumdur. Değerin çevresindeki boşluklar ve eşleşen tek veya çift
// tırnaklar atılır, başka bir işlem yapılmaz (satır sonu yorumu yoktur, # değerin parçasıdır).
// Yalnızca bilinen ayar adları okunur, bilinmeyenler uyarıyla yok sayılır. Bir ayarın Türkçe adı
// veya İngilizce takma adı ortam değişkeni olarak tanımlıysa dosyadaki değer kullanılmaz.
// Dosya en fazla MAX_ENV_FILE_BYTES bayt olabilir. Bu modülde kullanıcıya görünen metin yoktur,
// uyarılar kod olarak döner ve server.js tarafından konsol dilinde yazılır.

const fs = require('node:fs')

const ENV_FILE_NAME = 'telsiz.env'
const MAX_ENV_FILE_BYTES = 16 * 1024
const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

class EnvFileError extends Error {
  constructor (code, detail) {
    super('telsiz.env: ' + code + (detail ? ' (' + detail + ')' : ''))
    this.name = 'EnvFileError'
    this.code = code
    this.detail = detail || ''
  }
}

// Dosyayı en fazla MAX_ENV_FILE_BYTES bayta kadar okur. Dosya yoksa null döner.
// Okunamıyorsa EnvFileError('unreadable'), sınırdan büyükse EnvFileError('tooLarge') fırlatır.
function readEnvFile (file) {
  let fd
  try {
    fd = fs.openSync(file, 'r')
  } catch (err) {
    if (err && err.code === 'ENOENT') return null
    throw new EnvFileError('unreadable', err && err.code ? err.code : String(err))
  }
  try {
    let info
    try {
      info = fs.fstatSync(fd)
    } catch (err) {
      throw new EnvFileError('unreadable', err && err.code ? err.code : String(err))
    }
    if (!info.isFile()) throw new EnvFileError('unreadable', 'EISDIR')
    const buf = Buffer.alloc(MAX_ENV_FILE_BYTES + 1)
    let total = 0
    while (total < buf.length) {
      let count
      try {
        count = fs.readSync(fd, buf, total, buf.length - total, null)
      } catch (err) {
        throw new EnvFileError('unreadable', err && err.code ? err.code : String(err))
      }
      if (count === 0) break
      total += count
    }
    if (total > MAX_ENV_FILE_BYTES) throw new EnvFileError('tooLarge', String(MAX_ENV_FILE_BYTES))
    return buf.subarray(0, total).toString('utf8')
  } finally {
    fs.closeSync(fd)
  }
}

function groupMap (groups) {
  const map = new Map()
  for (const group of groups) {
    for (const name of group) map.set(name, group)
  }
  return map
}

// Metni ayrıştırır. groups: ayar adı grupları (her grup bir ayarın Türkçe adı ve İngilizce
// takma adı, ör. ['VERI_KLASORU', 'DATA_DIR']). Adlar büyük harfe çevrilerek karşılaştırılır.
// Sonuç: { values: Map<AD, değer>, warnings: [{ kind, line, key }] }
// kind: 'malformed' (AD=değer biçiminde değil), 'unknown' (bilinmeyen ad), 'duplicate' (aynı ad
// yeniden yazılmış, son değer geçerli)
function parseEnvFile (text, groups) {
  const known = groupMap(groups)
  const values = new Map()
  const warnings = []
  const source = typeof text === 'string' ? text.replace(/^\uFEFF/, '') : ''
  source.split(/\r\n|\r|\n/).forEach((raw, index) => {
    const line = index + 1
    const content = raw.trim()
    if (content === '' || content.startsWith('#')) return
    const eq = content.indexOf('=')
    const rawKey = eq > 0 ? content.slice(0, eq).trim() : ''
    if (!KEY_RE.test(rawKey)) {
      warnings.push({ kind: 'malformed', line, key: '' })
      return
    }
    const key = rawKey.toUpperCase()
    if (!known.has(key)) {
      warnings.push({ kind: 'unknown', line, key: rawKey })
      return
    }
    let value = content.slice(eq + 1).trim()
    const quote = value[0]
    if (value.length >= 2 && (quote === '"' || quote === '\'') && value[value.length - 1] === quote) value = value.slice(1, -1)
    if (value.includes('\0')) {
      warnings.push({ kind: 'malformed', line, key: '' })
      return
    }
    if (values.has(key)) warnings.push({ kind: 'duplicate', line, key })
    values.set(key, value)
  })
  return { values, warnings }
}

// Dosyadaki değerleri ortama yazar. Ayarın adlarından herhangi biri ortamda tanımlıysa dosyadaki
// değer kullanılmaz (ortam değişkeni her zaman önceliklidir). env genellikle process.env'dir,
// Windows'ta ad karşılaştırması harf duyarsız olduğu için kopyası değil kendisi kullanılır.
// Sonuç: { applied: [AD], skipped: [AD] }
function applyEnvFile (env, parsed, groups) {
  const known = groupMap(groups)
  // Ortamda önceden tanımlı adlar, dosyadan yazılanlar sonraki satırları etkilemesin diye baştan alınır
  const defined = new Set()
  for (const entry of parsed.values) {
    for (const name of known.get(entry[0]) || [entry[0]]) {
      if (env[name] !== undefined) defined.add(name)
    }
  }
  const applied = []
  const skipped = []
  for (const entry of parsed.values) {
    const key = entry[0]
    const group = known.get(key) || [key]
    if (group.some((name) => defined.has(name))) {
      skipped.push(key)
      continue
    }
    env[key] = entry[1]
    applied.push(key)
  }
  return { applied, skipped }
}

module.exports = {
  ENV_FILE_NAME,
  MAX_ENV_FILE_BYTES,
  EnvFileError,
  readEnvFile,
  parseEnvFile,
  applyEnvFile
}
