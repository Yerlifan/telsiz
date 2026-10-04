'use strict'

// Sunucu bilgileri: işlemci, yük ortalaması, bellek (kapsayıcıdaysa cgroup sınırı), veri klasörünün
// bulunduğu diskin boş ve toplam alanı, Node.js sürümü, platform ve süreç çalışma süresi.
// Ayarlardaki "Sunucu bilgileri" bölümü (GET /api/server-info, yalnızca sahip ve yöneticiler) bunları
// gösterir ve öneri bunlardan ipucu üretir. Okunamayan her bilgi null döner, hata fırlatılmaz.
// Dosya okuma ve statfs işlevleri testler için dışarıdan verilebilir.

const os = require('node:os')
const fs = require('node:fs')

// cgroup v2 ve v1 bellek sınırı dosyaları
const CGROUP_FILES = Object.freeze(['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes'])
// cgroup v1 sınırsız belleği çok büyük bir sayıyla yazar (ör. 9223372036854771712), bu eşiğin üstü sınırsızdır
const UNLIMITED_FLOOR = Math.pow(2, 60)
const CPU_MODEL_MAX = 120

// cgroup bellek sınırı metni: bayt sayısı, 'max' veya sınırsızı gösteren büyük sayı ise null
function parseCgroupLimit (text) {
  if (typeof text !== 'string') return null
  const value = text.trim()
  if (!/^\d{1,20}$/.test(value)) return null
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0 || n >= UNLIMITED_FLOOR) return null
  return n
}

function defaultReadFile (file) {
  return fs.promises.readFile(file, 'utf8')
}

// Kapsayıcının bellek sınırı (bayt) veya null. Önce cgroup v2, yoksa v1 dosyası okunur, hatalar yok sayılır.
async function cgroupMemoryLimit (readFile) {
  const read = typeof readFile === 'function' ? readFile : defaultReadFile
  for (const file of CGROUP_FILES) {
    let text = null
    try {
      text = await read(file)
    } catch (err) {
      continue
    }
    const n = parseCgroupLimit(String(text))
    if (n !== null) return n
  }
  return null
}

function defaultStatfs () {
  return fs.promises && typeof fs.promises.statfs === 'function' ? fs.promises.statfs : null
}

// Klasörün bulunduğu diskin { total, free } değeri (bayt, free kullanıcının kullanabileceği alan) veya null.
// fs.statfs Node.js 18.15 ile geldi, yoksa veya okunamazsa null döner. statfs null verilirse yok sayılır.
async function diskSpace (dir, statfs) {
  const fn = statfs === undefined ? defaultStatfs() : statfs
  if (typeof fn !== 'function') return null
  let st = null
  try {
    st = await fn(dir)
  } catch (err) {
    return null
  }
  if (!st || typeof st !== 'object') return null
  const bsize = Number(st.bsize)
  const total = Number(st.blocks) * bsize
  const free = Number(st.bavail) * bsize
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free) || free < 0) return null
  return { total, free: Math.min(free, total) }
}

function cpuInfo (osm) {
  let list = []
  try {
    list = osm.cpus() || []
  } catch (err) {
    list = []
  }
  let cores = list.length
  if (!cores && typeof osm.availableParallelism === 'function') {
    try {
      cores = osm.availableParallelism()
    } catch (err) {
      cores = 0
    }
  }
  const first = list[0]
  const model = first && typeof first.model === 'string' && first.model.trim() ? first.model.trim().replace(/\s+/g, ' ').slice(0, CPU_MODEL_MAX) : null
  // Windows yük ortalaması vermez (hep 0), bu durumda null
  let loadavg = null
  if (osm.platform() !== 'win32') {
    try {
      const avg = osm.loadavg()
      if (Array.isArray(avg) && avg.length === 3 && avg.every((v) => Number.isFinite(v) && v >= 0)) loadavg = avg.map((v) => Math.round(v * 100) / 100)
    } catch (err) {
      loadavg = null
    }
  }
  return { model, cores: Number.isSafeInteger(cores) && cores > 0 ? cores : null, loadavg }
}

// opts: { dataDir, readFile, statfs, os } (son üçü testler için)
async function collect (opts) {
  const o = opts || {}
  const osm = o.os || os
  const [cgroup, disk] = await Promise.all([cgroupMemoryLimit(o.readFile), diskSpace(o.dataDir, o.statfs)])
  let rss = null
  try {
    rss = process.memoryUsage().rss
  } catch (err) {
    rss = null
  }
  return {
    cpu: cpuInfo(osm),
    memory: { total: osm.totalmem(), free: osm.freemem(), cgroupLimit: cgroup, processRss: rss },
    disk,
    node: process.version,
    platform: osm.platform(),
    arch: osm.arch(),
    uptime: Math.floor(process.uptime())
  }
}

module.exports = { collect, cgroupMemoryLimit, diskSpace, parseCgroupLimit, CGROUP_FILES }
