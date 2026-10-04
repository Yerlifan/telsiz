'use strict'

// Masaüstü ayarları: etkin frekans (sunucu adresi), kayıtlı frekans listesi, kapatınca tepsiye
// küçültme, genel kısayollar ve güncellemelerin otomatik denetimi (autoUpdate, varsayılan açık).
// Uygulama verisi klasöründe (Electron app.getPath('userData')) ayarlar.json olarak saklanır.
// Dosya her okunuşta doğrulanır, geçersiz alanlar varsayılan değere döner. Yazma atomiktir
// (geçici dosya ve yeniden adlandırma), böylece yarım kalan bir yazma ayarları bozmaz.
// Electron'a bağımlı değildir.
// Biçim 1 yalnızca tek bir sunucu adresi (server) tutuyordu. Biçim 2 aynı alanı etkin frekans olarak
// korur ve frekans listesini (frequencies) ekler. Biçim 1 dosyası okunurken adres listeye eklenir
// (src/lib/frequencies.js normalize), oturum bölümleri zaten kökene göre olduğu için girişler korunur.

const fs = require('node:fs')
const path = require('node:path')
const { isValidOrigin } = require('./server-url')
const { validateShortcutMap, emptyMap } = require('./shortcuts')
const frequencies = require('./frequencies')

const FILE_NAME = 'ayarlar.json'
const FORMAT_VERSION = 2
const MAX_BYTES = 64 * 1024

function defaults () {
  return { server: null, frequencies: [], closeToTray: false, shortcuts: emptyMap(), autoUpdate: true }
}

// Okunan nesneden geçerli ayarları çıkarır
function sanitize (raw) {
  const out = defaults()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  const list = frequencies.normalize(isValidOrigin(raw.server) ? raw.server : null, raw.frequencies)
  out.server = list.server
  out.frequencies = list.frequencies
  if (typeof raw.closeToTray === 'boolean') out.closeToTray = raw.closeToTray
  // Alan yoksa (eski ayar dosyası) varsayılan açık kalır, yalnızca açıkça false kapatır
  if (typeof raw.autoUpdate === 'boolean') out.autoUpdate = raw.autoUpdate
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
