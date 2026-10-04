'use strict'

// Masaüstü derlemesinin hazırlığı (Ek J2.2):
// 1. Masaüstü sürümünün kök paket sürümüyle aynı olduğu denetlenir.
// 2. public/ klasöründen yalnızca beyaz listeye uyan dosyalar (src/lib/static-files.js, sunucudaki
//    listeyle aynı kurallar, service worker hariç) birebir desktop/app/ altına kopyalanır.
//    Sembolik bağlantılar ve normal dosya olmayan girdiler hiç izlenmez.
// 3. Kopyalanan her dosyanın sha256 değeri ve boyutu desktop/app/butunluk.json bildirimine yazılır
//    ve kopya, uygulamanın açılışta yaptığı doğrulamayla hemen yeniden denetlenir.
// 4. Simgeler Arcade logosundan üretilir (scripts/simge.js).
// Kullanım: node scripts/hazirla.js

const fs = require('node:fs')
const path = require('node:path')
const staticFiles = require('../src/lib/static-files')
const integrity = require('../src/lib/integrity')
const simge = require('./simge')

const DESKTOP_DIR = path.join(__dirname, '..')
const ROOT_DIR = path.join(DESKTOP_DIR, '..')

// Klasördeki normal dosyaların bölü ile ayrılmış göreli yolları (sıralı)
function listRegularFiles (dir) {
  const found = []
  const stack = ['']
  while (stack.length > 0) {
    const rel = stack.pop()
    for (const entry of fs.readdirSync(path.join(dir, ...rel.split('/').filter(Boolean)), { withFileTypes: true })) {
      const child = rel ? rel + '/' + entry.name : entry.name
      if (entry.isDirectory()) stack.push(child)
      else if (entry.isFile()) found.push(child)
    }
  }
  return found.sort()
}

function readVersion (file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (typeof data.version !== 'string' || data.version === '') throw new Error('No version in ' + file)
  return data.version
}

function checkVersions (rootDir, desktopDir) {
  const root = readVersion(path.join(rootDir, 'package.json'))
  const desktop = readVersion(path.join(desktopDir, 'package.json'))
  if (root !== desktop) {
    throw new Error('desktop/package.json sürümü (' + desktop + ') kök package.json sürümüyle (' + root + ') aynı olmalıdır.')
  }
  return root
}

// public klasörünü appDir altına kopyalar ve bütünlük bildirimini yazar.
// Sonuç: { copied: [göreli yol], skipped: [göreli yol], manifest }
function prepareApp (publicDir, appDir) {
  fs.rmSync(appDir, { recursive: true, force: true })
  fs.mkdirSync(appDir, { recursive: true })
  const copied = []
  const skipped = []
  const entries = []
  for (const rel of listRegularFiles(publicDir)) {
    if (!staticFiles.isServableFile(rel)) {
      skipped.push(rel)
      continue
    }
    const data = fs.readFileSync(path.join(publicDir, ...rel.split('/')))
    const target = path.join(appDir, ...rel.split('/'))
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, data)
    entries.push({ file: rel, data })
    copied.push(rel)
  }
  if (!copied.includes('index.html')) throw new Error('public/index.html bulunamadı.')
  const manifest = integrity.buildManifest(entries)
  fs.writeFileSync(path.join(appDir, integrity.MANIFEST_NAME), JSON.stringify(manifest, null, 2) + '\n')
  // Uygulamanın açılışta yaptığı doğrulamanın aynısı
  integrity.loadVerifiedFiles(appDir)
  return { copied, skipped, manifest }
}

function main () {
  const version = checkVersions(ROOT_DIR, DESKTOP_DIR)
  const result = prepareApp(path.join(ROOT_DIR, 'public'), path.join(DESKTOP_DIR, 'app'))
  console.log('Telsiz ' + version + ': ' + result.copied.length + ' istemci dosyası desktop/app/ altına kopyalandı ve doğrulandı.')
  if (result.skipped.length > 0) console.log('Beyaz listede olmadığı için paketlenmeyenler: ' + result.skipped.join(', '))
  const icons = simge.generateIcons(fs.readFileSync(path.join(ROOT_DIR, 'public', 'favicon.svg'), 'utf8'), path.join(DESKTOP_DIR, 'build'))
  console.log(icons.length + ' simge dosyası desktop/build/ altına üretildi.')
  return 0
}

if (require.main === module) {
  try {
    process.exitCode = main()
  } catch (err) {
    console.error('Hazırlık başarısız: ' + err.message)
    process.exitCode = 1
  }
}

module.exports = { listRegularFiles, checkVersions, prepareApp }
