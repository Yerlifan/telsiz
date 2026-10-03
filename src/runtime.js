'use strict'

// Çalışma ortamı: sunucu Node.js tek dosya uygulaması (SEA, telsiz.exe gibi) olarak mı
// çalışıyor, sürümü nedir ve yürütülebilir dosyaya hangi arayüz dosyaları gömülü.
// SEA derlemesi scripts/sea-derle.js ile yapılır. Derleme, sürümü ve gömülü dosyaların
// listesini BUILD_ASSET adlı varlığa yazar, arayüz dosyaları 'public/<yol>' anahtarlarıyla
// gömülür. Normal çalışmada (node server.js, npx telsiz, Docker) sürüm package.json'dan okunur.

const fs = require('node:fs')
const path = require('node:path')

const BUILD_ASSET = 'telsiz-build.json'
const PUBLIC_PREFIX = 'public/'
const MAX_VERSION_CHARS = 64
const MAX_BUILD_FILES = 5000
// Gömülü dosya yolu: bölü ile ayrılmış, harf, rakam, nokta, alt çizgi ve tire içeren parçalar
const ASSET_FILE_RE = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/

let seaCache
let buildCache
let versionCache

// Göreli dosya yolu geçerli mi: boş parça, '.' ve '..' yok, ters bölü ve sürücü adı yok
function isAssetFile (file) {
  if (typeof file !== 'string' || file.length > 512 || !ASSET_FILE_RE.test(file)) return false
  return file.split('/').every((part) => part !== '.' && part !== '..')
}

// node:sea modülü yalnızca SEA içinde çalışılıyorsa döner, değilse null.
// Node.js 20.12 öncesinde node:sea yoktur, bu da SEA olmadığı anlamına gelir.
function seaApi () {
  if (seaCache !== undefined) return seaCache
  seaCache = null
  try {
    const sea = require('node:sea')
    if (sea && typeof sea.isSea === 'function' && sea.isSea()) seaCache = sea
  } catch (err) {
    seaCache = null
  }
  return seaCache
}

function isSea () {
  return seaApi() !== null
}

function isSafeCount (value) {
  return Number.isSafeInteger(value) && value >= 0
}

// Derleme bilgisini doğrular: { version, files: { 'index.html': { size, mtime } } }.
// Sonuç: { version, files: Map<yol, { size, mtime }> }. Bozuksa hata fırlatır.
function parseBuildInfo (text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch (err) {
    throw new Error('SEA build info is not valid JSON.')
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('SEA build info must be an object.')
  if (typeof raw.version !== 'string' || raw.version === '' || raw.version.length > MAX_VERSION_CHARS) {
    throw new Error('SEA build info has an invalid version.')
  }
  const list = raw.files
  if (list === null || typeof list !== 'object' || Array.isArray(list)) throw new Error('SEA build info has no file list.')
  const names = Object.keys(list)
  if (names.length > MAX_BUILD_FILES) throw new Error('SEA build info lists too many files.')
  const files = new Map()
  for (const name of names) {
    const meta = list[name]
    if (!isAssetFile(name) || meta === null || typeof meta !== 'object' || !isSafeCount(meta.size) || !isSafeCount(meta.mtime)) {
      throw new Error('SEA build info has an invalid file entry.')
    }
    files.set(name, { size: meta.size, mtime: meta.mtime })
  }
  return { version: raw.version, files }
}

// SEA içindeysek gömülü derleme bilgisi, değilsek null
function buildInfo () {
  if (buildCache !== undefined) return buildCache
  const sea = seaApi()
  buildCache = sea ? parseBuildInfo(sea.getAsset(BUILD_ASSET, 'utf8')) : null
  return buildCache
}

// package.json sürümü (npm paketi, Docker imajı ve depo kopyasında sunucu dosyalarının yanındadır)
function readPackageVersion () {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' && pkg.version !== '' && pkg.version.length <= MAX_VERSION_CHARS ? pkg.version : null
  } catch (err) {
    return null
  }
}

// Sunucu sürümü: SEA içinde derlemeye gömülen, değilse package.json'daki sürüm (okunamazsa null)
function version () {
  if (versionCache !== undefined) return versionCache
  const info = buildInfo()
  versionCache = info ? info.version : readPackageVersion()
  return versionCache
}

module.exports = {
  BUILD_ASSET,
  PUBLIC_PREFIX,
  isAssetFile,
  isSea,
  seaApi,
  parseBuildInfo,
  buildInfo,
  version
}
