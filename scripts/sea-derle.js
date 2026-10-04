'use strict'

// Telsiz sunucusunu Node.js tek dosya uygulaması (Single Executable Application, SEA) olarak
// derler. Çıktı: dist/telsiz-<sürüm>-<hedef>, Windows'ta sonuna .exe eklenir.
// Yöntem Node.js belgesindeki adımlardır (doc/api/single-executable-applications.md):
//   1. Sunucu kodu scripts/paketle.js ile tek bir CommonJS dosyasında toplanır.
//   2. public/ klasörü derleme anında taranır, her dosya 'public/<yol>' anahtarıyla varlık
//      (asset) olarak gömülür. Sürüm ve dosya listesi (boyut ve değişiklik zamanı)
//      telsiz-build.json varlığına yazılır, sunucu bunları src/runtime.js ile okur.
//   3. node --experimental-sea-config sea-config.json ile hazırlık blobu üretilir.
//   4. node ikilisi kopyalanır ve blob postject ile NODE_SEA_BLOB adıyla enjekte edilir.
// Blobu üreten node ile blobun enjekte edildiği ikili aynı sürüm olmalıdır. Varsayılan ikili
// derlemeyi çalıştıran node'un kendisidir. Başka bir hedef için (ör. linux-arm64) aynı sürümün o
// hedefe ait ikilisi --node-ikilisi ile verilir. Kod önbelleği ve anlık görüntü kapalıdır, Node.js
// belgesine göre çapraz derlemede kapalı olmaları gerekir. macOS desteklenmez.
// Kullanım:
//   node scripts/sea-derle.js [--hedef <hedef>] [--node-ikilisi <yol>] [--cikti <klasör>] [--hazirligi-koru]
// Hedefler: linux-x64, linux-arm64, windows-x64

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const { isBuiltin } = require('node:module')
const { bundle } = require('./paketle')
const runtime = require('../src/runtime')

const ROOT = path.join(__dirname, '..')
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'
const SEA_RESOURCE = 'NODE_SEA_BLOB'
const TARGETS = Object.freeze(['linux-x64', 'linux-arm64', 'windows-x64'])
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const HEADER_BYTES = 64 * 1024
const MAX_READ_ATTEMPTS = 3

class BuildError extends Error {}

// Derlemeyi çalıştıran sistemin hedef adı, desteklenmiyorsa null
function hostTarget (platform, arch) {
  const os = { linux: 'linux', win32: 'windows' }[platform || process.platform]
  const cpu = { x64: 'x64', arm64: 'arm64' }[arch || process.arch]
  const target = os && cpu ? os + '-' + cpu : null
  return TARGETS.includes(target) ? target : null
}

// İkili dosyanın başından biçimini ve mimarisini okur: 'linux-x64', 'linux-arm64',
// 'windows-x64', 'windows-arm64', 'macos' veya null
function detectTarget (buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 64) return null
  if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
    // ELF: 64 bit (EI_CLASS 2), küçük uçlu (EI_DATA 1), e_machine 18. baytta
    if (buf[4] !== 2 || buf[5] !== 1) return null
    const machine = buf.readUInt16LE(18)
    if (machine === 0x3e) return 'linux-x64'
    if (machine === 0xb7) return 'linux-arm64'
    return null
  }
  if (buf[0] === 0x4d && buf[1] === 0x5a) {
    // PE: MZ başlığındaki 0x3c konumu PE imzasını gösterir, ardından makine türü gelir
    const offset = buf.readUInt32LE(0x3c)
    if (offset + 6 > buf.length || buf.readUInt32LE(offset) !== 0x00004550) return null
    const machine = buf.readUInt16LE(offset + 4)
    if (machine === 0x8664) return 'windows-x64'
    if (machine === 0xaa64) return 'windows-arm64'
    return null
  }
  const magic = buf.readUInt32LE(0)
  if (magic === 0xfeedfacf || magic === 0xcffaedfe || magic === 0xcafebabe || magic === 0xbebafeca) return 'macos'
  return null
}

function readHeader (file) {
  const fd = fs.openSync(file, 'r')
  try {
    const buf = Buffer.alloc(HEADER_BYTES)
    const count = fs.readSync(fd, buf, 0, buf.length, 0)
    return buf.subarray(0, count)
  } finally {
    fs.closeSync(fd)
  }
}

function outputName (version, target) {
  return 'telsiz-' + version + '-server-' + target + (target.startsWith('windows-') ? '.exe' : '')
}

// public/ klasöründeki tüm dosyalar (alt klasörler dahil, sıralı). Nokta ile başlayan adlar
// (ör. .DS_Store) atlanır. Sembolik bağlantı ve SEA anahtarı olamayacak adlar hata verir.
// Sonuç: [{ rel, abs }]
function collectPublicFiles (publicDir) {
  const found = []
  const stack = ['']
  while (stack.length > 0) {
    const rel = stack.pop()
    const abs = path.join(publicDir, ...rel.split('/').filter(Boolean))
    const entries = fs.readdirSync(abs, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const child = rel ? rel + '/' + entry.name : entry.name
      if (entry.isSymbolicLink()) throw new BuildError('public/' + child + ' sembolik bağlantı. Gömülecek dosyalar gerçek dosya olmalıdır.')
      if (entry.isDirectory()) {
        stack.push(child)
      } else if (entry.isFile()) {
        if (!runtime.isAssetFile(child)) throw new BuildError('public/' + child + ' adı gömülemez. Dosya adları yalnızca harf, rakam, nokta, alt çizgi ve tire içermelidir.')
        found.push({ rel: child, abs: path.join(abs, entry.name) })
      }
    }
  }
  return found.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0))
}

// Dosyayı okur, okuma sırasında değişmediğinden emin olur (boyut aynı kalmalı).
// Sonuç: { data, mtime } (mtime: değişiklik zamanı, ms, tam sayı)
function readStable (file) {
  let attempt = 0
  while (attempt < MAX_READ_ATTEMPTS) {
    attempt++
    const before = fs.statSync(file)
    const data = fs.readFileSync(file)
    const after = fs.statSync(file)
    if (data.length === after.size && before.size === after.size && before.mtimeMs === after.mtimeMs) {
      return { data, mtime: Math.floor(after.mtimeMs) }
    }
  }
  throw new BuildError(file + ' derleme sırasında değişip duruyor, derlemeyi yeniden başlatın.')
}

// Gömülecek dosyaları hazırlık klasörüne kopyalar ve derleme bilgisini üretir.
// Sonuç: { assets: { anahtar: yol }, info, count, bytes }
function stageAssets (publicDir, stageDir, version, target) {
  const files = collectPublicFiles(publicDir)
  if (!files.some((f) => f.rel === 'index.html')) throw new BuildError('public/index.html bulunamadı.')
  const assets = {}
  const list = {}
  let bytes = 0
  for (const file of files) {
    const { data, mtime } = readStable(file.abs)
    const dest = path.join(stageDir, 'public', ...file.rel.split('/'))
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, data)
    assets[runtime.PUBLIC_PREFIX + file.rel] = dest
    list[file.rel] = { size: data.length, mtime }
    bytes += data.length
  }
  const info = { name: 'telsiz', version, node: process.version, target, files: list }
  const infoFile = path.join(stageDir, runtime.BUILD_ASSET)
  fs.writeFileSync(infoFile, JSON.stringify(info, null, 2) + '\n')
  // Sunucunun okuyacağı biçimde geçerli olduğu derlemede doğrulanır
  runtime.parseBuildInfo(fs.readFileSync(infoFile, 'utf8'))
  assets[runtime.BUILD_ASSET] = infoFile
  return { assets, info, count: files.length, bytes }
}

function readPackageVersion (root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (typeof pkg.version !== 'string' || !VERSION_RE.test(pkg.version)) throw new BuildError('package.json sürümü geçersiz: ' + String(pkg.version))
  return pkg.version
}

function loadPostject () {
  try {
    return require('postject')
  } catch (err) {
    throw new BuildError('postject paketi bulunamadı. Önce depo kökünde "npm ci" komutunu çalıştırın.')
  }
}

function sha256File (file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

// Derler. options: { root, target, nodeBinary, outDir, keepStage, log }
// Sonuç: { file, target, version, sha256, size, assets, assetBytes }
async function buildSea (options) {
  const o = options || {}
  const log = o.log || console.log
  const root = path.resolve(o.root || ROOT)
  if (!isBuiltin('node:sea')) {
    throw new BuildError('Bu Node.js sürümü (' + process.version + ') tek dosya uygulamasının varlık desteğini içermiyor. Node.js 20.12, 21.7 veya daha yenisi gerekir.')
  }
  const host = hostTarget()
  const target = o.target || host
  if (!target) throw new BuildError('Bu sistem (' + process.platform + '-' + process.arch + ') için derleme desteklenmiyor. Hedefler: ' + TARGETS.join(', '))
  if (!TARGETS.includes(target)) throw new BuildError('Bilinmeyen hedef: ' + target + '. Hedefler: ' + TARGETS.join(', '))
  const base = o.nodeBinary ? path.resolve(o.nodeBinary) : process.execPath
  if (!o.nodeBinary && target !== host) {
    throw new BuildError(target + ' hedefi için aynı Node.js sürümünün (' + process.version + ') o hedefe ait node ikilisi --node-ikilisi ile verilmelidir.')
  }
  const baseTarget = detectTarget(readHeader(base))
  if (baseTarget !== target) throw new BuildError(base + ' bir ' + target + ' node ikilisi değil (algılanan: ' + (baseTarget || 'bilinmiyor') + ').')
  const postject = loadPostject()
  const version = readPackageVersion(root)
  const outDir = path.resolve(o.outDir || path.join(root, 'dist'))
  const stageDir = path.join(outDir, 'sea-hazirlik-' + target)
  fs.rmSync(stageDir, { recursive: true, force: true })
  fs.mkdirSync(stageDir, { recursive: true })

  try {
    const bundled = bundle(path.join(root, 'server.js'), { root, banner: 'Telsiz ' + version + ' sunucusu, tek dosya uygulaması için paket' })
    const mainFile = path.join(stageDir, 'telsiz.cjs')
    fs.writeFileSync(mainFile, bundled.code)
    log('Paket: ' + bundled.modules.length + ' modül (' + bundled.modules.join(', ') + ')')

    const staged = stageAssets(path.join(root, 'public'), stageDir, version, target)
    log('Gömülen arayüz dosyaları: ' + staged.count + ' dosya, ' + staged.bytes + ' bayt')

    const blobFile = path.join(stageDir, 'sea-prep.blob')
    const configFile = path.join(stageDir, 'sea-config.json')
    const config = {
      main: mainFile,
      output: blobFile,
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      assets: staged.assets
    }
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n')
    const prep = spawnSync(process.execPath, ['--experimental-sea-config', configFile], { cwd: stageDir, encoding: 'utf8', windowsHide: true })
    if (prep.error || prep.status !== 0 || !fs.existsSync(blobFile)) {
      const detail = prep.error ? prep.error.message : (prep.stderr || prep.stdout || '').trim()
      throw new BuildError('hazırlık blobu üretilemedi: ' + detail)
    }
    const blob = fs.readFileSync(blobFile)

    fs.mkdirSync(outDir, { recursive: true })
    const outFile = path.join(outDir, outputName(version, target))
    fs.rmSync(outFile, { force: true })
    let injected
    try {
      fs.copyFileSync(base, outFile)
      fs.chmodSync(outFile, 0o755)
      await postject.inject(outFile, SEA_RESOURCE, blob, { sentinelFuse: SEA_FUSE })
      injected = fs.readFileSync(outFile)
      if (injected.indexOf(SEA_FUSE + ':1') === -1) throw new BuildError('enjeksiyon doğrulanamadı (' + SEA_FUSE + ':1 bulunamadı).')
    } catch (err) {
      // Yarım kalmış bir ikili geçerli sanılmasın
      fs.rmSync(outFile, { force: true })
      throw err
    }
    const sha256 = crypto.createHash('sha256').update(injected).digest('hex')
    return { file: outFile, target, version, sha256, size: injected.length, assets: staged.count, assetBytes: staged.bytes }
  } finally {
    if (!o.keepStage) fs.rmSync(stageDir, { recursive: true, force: true })
  }
}

const USAGE = [
  'Kullanım: node scripts/sea-derle.js [--hedef <hedef>] [--node-ikilisi <yol>] [--cikti <klasör>] [--hazirligi-koru]',
  '',
  'Telsiz sunucusunu tek dosya uygulaması olarak derler (Node.js SEA ve postject).',
  'Hedefler: ' + TARGETS.join(', ') + '. Varsayılan hedef bu sistemdir.',
  'Başka bir hedef için aynı Node.js sürümünün o hedefe ait node ikilisi --node-ikilisi ile verilir.',
  'Çıktı klasörü varsayılan olarak depo kökündeki dist klasörüdür.'
].join('\n')

function parseArgs (args) {
  const out = { target: null, nodeBinary: null, outDir: null, keepStage: false, help: false }
  const rest = args.slice()
  while (rest.length > 0) {
    const arg = rest.shift()
    const next = () => {
      if (rest.length === 0) throw new BuildError(arg + ' bir değer bekliyor.')
      return rest.shift()
    }
    if (arg === '--hedef') out.target = next()
    else if (arg === '--node-ikilisi') out.nodeBinary = next()
    else if (arg === '--cikti') out.outDir = next()
    else if (arg === '--hazirligi-koru') out.keepStage = true
    else if (arg === '-h' || arg === '--help' || arg === '--yardim') out.help = true
    else throw new BuildError('Tanınmayan argüman: ' + arg)
  }
  return out
}

async function main (argv) {
  let args
  try {
    args = parseArgs(argv.slice(2))
  } catch (err) {
    console.error(err.message)
    console.error(USAGE)
    return 2
  }
  if (args.help) {
    console.log(USAGE)
    return 0
  }
  try {
    const result = await buildSea(args)
    console.log('Derlendi: ' + result.file)
    console.log('Hedef: ' + result.target + ', sürüm: ' + result.version + ', boyut: ' + result.size + ' bayt')
    console.log('SHA-256: ' + result.sha256)
    return 0
  } catch (err) {
    console.error('Derleme başarısız: ' + (err instanceof BuildError ? err.message : (err && err.stack) || String(err)))
    return 1
  }
}

if (require.main === module) {
  main(process.argv).then((code) => {
    process.exitCode = code
  })
}

module.exports = {
  SEA_FUSE,
  TARGETS,
  BuildError,
  hostTarget,
  detectTarget,
  outputName,
  collectPublicFiles,
  stageAssets,
  sha256File,
  buildSea
}
