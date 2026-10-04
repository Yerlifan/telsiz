'use strict'

// Masaüstü ayarları: sunucu adresi, kapatınca tepsiye küçültme ve genel kısayollar.
// Uygulama verisi klasöründe (Electron app.getPath('userData')) ayarlar.json olarak saklanır.
// Dosya her okunuşta doğrulanır, geçersiz alanlar varsayılan değere döner. Yazma atomiktir
// (geçici dosya ve yeniden adlandırma), böylece yarım kalan bir yazma ayarları bozmaz.
// Electron'a bağımlı değildir.

const fs = require('node:fs')
const path = require('node:path')
const { isValidOrigin } = require('./server-url')
const { validateShortcutMap, emptyMap } = require('./shortcuts')

const FILE_NAME = 'ayarlar.json'
const FORMAT_VERSION = 1
const MAX_BYTES = 64 * 1024

function defaults () {
  return { server: null, closeToTray: false, shortcuts: emptyMap() }
}

// Okunan nesneden geçerli ayarları çıkarır
function sanitize (raw) {
  const out = defaults()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  if (isValidOrigin(raw.server)) out.server = raw.server
  if (typeof raw.closeToTray === 'boolean') out.closeToTray = raw.closeToTray
  if (raw.shortcuts && typeof raw.shortcuts === 'object') {
    const checked = validateShortcutMap(raw.shortcuts)
    if (checked.ok) out.shortcuts = checked.map
  }
  return out
}

function load (file) {
  try {
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > MAX_BYTES) return defaults()
    return sanitize(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (err) {
    return defaults()
  }
}

function save (file, settings) {
  const clean = sanitize(settings)
  const data = JSON.stringify(Object.assign({ version: FORMAT_VERSION }, clean), null, 2) + '\n'
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = file + '.' + process.pid + '.tmp'
  fs.writeFileSync(temp, data, { mode: 0o600 })
  try {
    fs.renameSync(temp, file)
  } catch (err) {
    try {
      fs.unlinkSync(temp)
    } catch (ignored) {
      // Geçici dosya zaten yok
    }
    throw err
  }
  return clean
}

module.exports = { FILE_NAME, FORMAT_VERSION, MAX_BYTES, defaults, sanitize, load, save }
