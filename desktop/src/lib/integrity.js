'use strict'

// Paketlenmiş istemci dosyalarının bütünlük bildirimi (manifest). Derleme sırasında
// (scripts/hazirla.js) public/ klasöründen beyaz listeye uyan dosyalar desktop/app/ altına
// kopyalanır ve her birinin sha256 değeri ile boyutu butunluk.json dosyasına yazılır.
// Uygulama açılışta bildirimdeki her dosyayı okur, boyutunu ve sha256 değerini doğrular ve
// dosyaları yalnızca bu doğrulanmış bellek kopyasından sunar. Tek bir dosya eksik, fazla
// büyük veya farklıysa uygulama açılmaz. Bildirimdeki adlar da beyaz listeye uymak zorundadır,
// böylece değiştirilmiş bir bildirim uygulama klasörü dışından dosya okutamaz.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { isServableFile } = require('./static-files')

const MANIFEST_NAME = 'butunluk.json'
const MANIFEST_VERSION = 1
const MAX_MANIFEST_BYTES = 1024 * 1024
const MAX_FILE_BYTES = 32 * 1024 * 1024
const MAX_FILES = 2000
const SHA256_RE = /^[0-9a-f]{64}$/

class IntegrityError extends Error {
  constructor (message, files) {
    super(message)
    this.name = 'IntegrityError'
    this.files = files || []
  }
}

function sha256 (data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

// entries: [{ file, data }] -> bildirim nesnesi (adlar sıralı, deterministik)
function buildManifest (entries) {
  const files = {}
  const sorted = entries.slice().sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0))
  for (const entry of sorted) {
    if (!isServableFile(entry.file)) throw new IntegrityError('Not a whitelisted file: ' + entry.file, [entry.file])
    files[entry.file] = { sha256: sha256(entry.data), size: entry.data.length }
  }
  return { version: MANIFEST_VERSION, files }
}

function parseManifest (text) {
  let data
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new IntegrityError('The integrity manifest is not valid JSON.', [MANIFEST_NAME])
  }
  if (!data || typeof data !== 'object' || data.version !== MANIFEST_VERSION || !data.files || typeof data.files !== 'object') {
    throw new IntegrityError('The integrity manifest has an unknown format.', [MANIFEST_NAME])
  }
  const names = Object.keys(data.files)
  if (names.length === 0 || names.length > MAX_FILES) throw new IntegrityError('The integrity manifest has an invalid file count.', [MANIFEST_NAME])
  const bad = []
  for (const name of names) {
    const item = data.files[name]
    const valid = isServableFile(name) && item && typeof item === 'object' && typeof item.sha256 === 'string' &&
      SHA256_RE.test(item.sha256) && Number.isSafeInteger(item.size) && item.size >= 0 && item.size <= MAX_FILE_BYTES
    if (!valid) bad.push(name)
  }
  if (bad.length > 0) throw new IntegrityError('The integrity manifest has invalid entries.', bad)
  return data
}

// appDir içindeki dosyaları bildirime göre okur ve doğrular. Sonuç: Map<göreli yol, Buffer>.
// Hata varsa IntegrityError (files: sorunlu dosyalar) fırlatır.
function loadVerifiedFiles (appDir) {
  const manifestPath = path.join(appDir, MANIFEST_NAME)
  let text
  try {
    const stat = fs.statSync(manifestPath)
    if (!stat.isFile() || stat.size > MAX_MANIFEST_BYTES) throw new Error('size')
    text = fs.readFileSync(manifestPath, 'utf8')
  } catch (err) {
    throw new IntegrityError('The integrity manifest could not be read.', [MANIFEST_NAME])
  }
  const manifest = parseManifest(text)
  const files = new Map()
  const bad = []
  for (const name of Object.keys(manifest.files)) {
    const item = manifest.files[name]
    let data = null
    try {
      data = fs.readFileSync(path.join(appDir, ...name.split('/')))
    } catch (err) {
      data = null
    }
    if (!data || data.length !== item.size || sha256(data) !== item.sha256) {
      bad.push(name)
      continue
    }
    files.set(name, data)
  }
  if (bad.length > 0) throw new IntegrityError('Application files failed the integrity check.', bad)
  if (!files.has('index.html')) throw new IntegrityError('index.html is missing from the integrity manifest.', ['index.html'])
  return files
}

module.exports = {
  MANIFEST_NAME,
  MANIFEST_VERSION,
  IntegrityError,
  sha256,
  buildManifest,
  parseManifest,
  loadVerifiedFiles
}
