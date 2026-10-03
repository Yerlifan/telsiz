'use strict'

// Statik dosya kaynakları. Sunucu beyaz listedeki bir dosyayı her zaman bu arayüzle okur:
//   source.open(file) -> Promise<null | { size, mtimeMs, read(): Promise<Buffer>, close(): Promise }>
// file, beyaz listeden gelen ve bölü ile ayrılmış göreli bir yoldur (ör. 'js/01-core.js').
// Dosya yoksa null döner. Disk kaynağı public klasöründen, SEA kaynağı yürütülebilir dosyaya
// gömülü varlıklardan okur. Beyaz liste ve yol denetimleri kaynaktan önce (src/app.js),
// başlıklar ve CSP kaynaktan sonra (src/http-util.js) aynı kodla uygulandığı için iki durumda
// da birebir aynıdır. Kaynaklar ayrıca kendi içlerinde de yalnızca geçerli göreli yolları kabul eder.

const fs = require('node:fs')
const path = require('node:path')
const runtime = require('./runtime')

const MISSING_CODES = new Set(['ENOENT', 'EISDIR', 'ENOTDIR'])

function noop () {}

function closed () {
  return Promise.resolve()
}

// Dosya adı yalnızca büyük/küçük harf farkıyla eşleşiyorsa (Windows ve macOS dosya sistemleri
// harf duyarsızdır) dosya yok sayılır. Böylece her işletim sisteminde ve SEA içinde aynı adres
// aynı sonucu verir. Bağlantının hedef adı tamamen farklıysa ad olduğu gibi kabul edilir.
async function nameMatches (full) {
  let real
  try {
    real = await fs.promises.realpath(full)
  } catch (err) {
    return false
  }
  const want = path.basename(full)
  const got = path.basename(real)
  return got === want || got.toLowerCase() !== want.toLowerCase()
}

function createDiskSource (publicDir) {
  if (typeof publicDir !== 'string' || publicDir === '') throw new TypeError('createDiskSource: publicDir is required.')
  const root = path.resolve(publicDir)
  return {
    kind: 'disk',
    root,
    async open (file) {
      if (!runtime.isAssetFile(file)) return null
      const full = path.join(root, ...file.split('/'))
      let handle
      try {
        handle = await fs.promises.open(full, 'r')
      } catch (err) {
        if (err && MISSING_CODES.has(err.code)) return null
        throw err
      }
      try {
        const info = await handle.stat()
        if (!info.isFile() || !(await nameMatches(full))) {
          await handle.close().catch(noop)
          return null
        }
        return {
          size: info.size,
          mtimeMs: Math.floor(info.mtimeMs),
          read: () => handle.readFile(),
          close: () => handle.close()
        }
      } catch (err) {
        await handle.close().catch(noop)
        throw err
      }
    }
  }
}

// sea: node:sea modülü (veya testlerde aynı getAsset arayüzüne sahip bir nesne),
// files: Map<göreli yol, { size, mtime }> (derleme bilgisinden)
function createSeaSource (sea, files) {
  if (!sea || typeof sea.getAsset !== 'function') throw new TypeError('createSeaSource: a node:sea compatible object is required.')
  if (!(files instanceof Map)) throw new TypeError('createSeaSource: files must be a Map.')
  const cache = new Map()
  function load (file, meta) {
    let data = cache.get(file)
    if (!data) {
      data = Buffer.from(sea.getAsset(runtime.PUBLIC_PREFIX + file))
      if (data.length !== meta.size) throw new Error('Embedded file size does not match the build info: ' + file)
      cache.set(file, data)
    }
    return data
  }
  return {
    kind: 'sea',
    open (file) {
      if (!runtime.isAssetFile(file) || !files.has(file)) return Promise.resolve(null)
      const meta = files.get(file)
      return Promise.resolve({
        size: meta.size,
        mtimeMs: meta.mtime,
        read: () => new Promise((resolve) => resolve(load(file, meta))),
        close: closed
      })
    }
  }
}

// Varsayılan kaynak: publicDir verilmişse o klasör, verilmemişse SEA içinde gömülü dosyalar,
// değilse sunucu kodunun yanındaki public klasörü
function defaultSource (publicDir) {
  if (publicDir !== null && publicDir !== undefined) return createDiskSource(publicDir)
  const info = runtime.buildInfo()
  if (info) return createSeaSource(runtime.seaApi(), info.files)
  return createDiskSource(path.join(__dirname, '..', 'public'))
}

function isSource (value) {
  return Boolean(value) && typeof value === 'object' && typeof value.open === 'function'
}

module.exports = { createDiskSource, createSeaSource, defaultSource, isSource }
