'use strict'

// Güncelleme bilgi dosyalarının (latest.yml ve latest-linux.yml) denetimi.
// electron-updater GitHub sürümünden bu dosyaları indirir ve içlerinde adı geçen paketi
// (Windows kurucusu veya AppImage) aynı sürümün dosyaları arasında arar. Dosya adı tutmazsa
// güncelleme 404 hatasıyla düşer, sha512 tutmazsa indirilen dosya reddedilir. Bu betik derlemeden
// sonra (desktop.yml) ve yayın klasörü toplandıktan sonra (release.yml) şunları doğrular:
// - istenen bilgi dosyaları vardır, sürümleri beklenen sürümdür
// - adı geçen her dosya aynı klasördedir (yalnızca dosya adı, klasör yolu yok), boyutu ve sha512
//   değeri tutar
// - Windows kurucusunun fark indirmesi için .blockmap dosyası yanındadır
// Bağımlılığı yoktur (yalnızca electron-builder'ın yazdığı basit YAML biçimi okunur).
// Kullanım: node scripts/guncelleme-dosyalari.js <klasör> [--version 2.0.1] [--require latest.yml,latest-linux.yml]

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const INFO_FILES = ['latest.yml', 'latest-linux.yml']
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/

function unquote (value) {
  const text = value.trim()
  if (text.length >= 2 && ((text[0] === '\'' && text[text.length - 1] === '\'') || (text[0] === '"' && text[text.length - 1] === '"'))) return text.slice(1, -1)
  return text
}

// electron-builder'ın güncelleme bilgisi: { version, files: [{ url, sha512, size }], path, sha512 }
function parseUpdateInfo (text) {
  const info = { version: null, files: [], path: null, sha512: null }
  let current = null
  for (const raw of String(text).replace(/\r\n/g, '\n').split('\n')) {
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue
    const item = /^\s+-\s+url:\s*(.+)$/.exec(raw)
    if (item) {
      current = { url: unquote(item[1]), sha512: null, size: null }
      info.files.push(current)
      continue
    }
    const nested = /^\s{2,}(sha512|size|blockMapSize|isAdminRightsRequired):\s*(.+)$/.exec(raw)
    if (nested && current) {
      if (nested[1] === 'sha512') current.sha512 = unquote(nested[2])
      if (nested[1] === 'size') current.size = Number(unquote(nested[2]))
      continue
    }
    const top = /^([A-Za-z0-9]+):\s*(.*)$/.exec(raw)
    if (top) {
      current = null
      if (top[1] === 'version') info.version = unquote(top[2])
      if (top[1] === 'path') info.path = unquote(top[2])
      if (top[1] === 'sha512') info.sha512 = unquote(top[2])
    }
  }
  return info
}

function sha512Base64 (file) {
  return crypto.createHash('sha512').update(fs.readFileSync(file)).digest('base64')
}

// Bir klasördeki güncelleme bilgi dosyalarını denetler. Sonuç: { errors: [metin], referenced: [dosya adı] }
function verifyDir (dir, options) {
  const opts = options || {}
  const errors = []
  const referenced = []
  const required = opts.require || []
  for (const name of required) {
    if (!INFO_FILES.includes(name)) errors.push('Bilinmeyen güncelleme bilgi dosyası: ' + name)
    else if (!fs.existsSync(path.join(dir, name))) errors.push('Eksik güncelleme bilgi dosyası: ' + name)
  }
  for (const name of INFO_FILES) {
    const file = path.join(dir, name)
    if (!fs.existsSync(file)) continue
    const info = parseUpdateInfo(fs.readFileSync(file, 'utf8'))
    if (opts.version && info.version !== opts.version) errors.push(name + ': sürüm ' + info.version + ', beklenen ' + opts.version)
    if (info.files.length === 0) errors.push(name + ': dosya listesi boş')
    if (info.path !== null && !info.files.some((entry) => entry.url === info.path)) errors.push(name + ': path (' + info.path + ') dosya listesinde yok')
    for (const entry of info.files) {
      if (!SAFE_NAME.test(entry.url)) {
        errors.push(name + ': geçersiz dosya adı ' + JSON.stringify(entry.url))
        continue
      }
      referenced.push(entry.url)
      const target = path.join(dir, entry.url)
      if (!fs.existsSync(target)) {
        errors.push(name + ': adı geçen dosya yok: ' + entry.url)
        continue
      }
      if (entry.size !== null && fs.statSync(target).size !== entry.size) errors.push(name + ': boyut tutmuyor: ' + entry.url)
      if (!entry.sha512 || sha512Base64(target) !== entry.sha512) errors.push(name + ': sha512 tutmuyor: ' + entry.url)
      if (entry.url.endsWith('.exe')) {
        referenced.push(entry.url + '.blockmap')
        if (!fs.existsSync(target + '.blockmap')) errors.push(name + ': fark indirmesi dosyası yok: ' + entry.url + '.blockmap')
      }
    }
  }
  return { errors, referenced: Array.from(new Set(referenced)).sort() }
}

function parseArgs (argv) {
  const out = { dir: null, version: null, require: [] }
  const args = argv.slice()
  while (args.length > 0) {
    const arg = args.shift()
    if (arg === '--version') out.version = args.shift() || null
    else if (arg === '--require') out.require = String(args.shift() || '').split(',').filter(Boolean)
    else if (!out.dir) out.dir = arg
  }
  return out
}

function main (argv) {
  const args = parseArgs(argv)
  if (!args.dir) {
    console.error('Kullanım: node scripts/guncelleme-dosyalari.js <klasör> [--version 2.0.1] [--require latest.yml,latest-linux.yml]')
    return 2
  }
  const result = verifyDir(args.dir, { version: args.version, require: args.require })
  for (const error of result.errors) console.error('::error::' + error)
  if (result.errors.length > 0) return 1
  console.log('Güncelleme bilgi dosyaları doğru. Adı geçen dosyalar: ' + result.referenced.join(', '))
  return 0
}

if (require.main === module) process.exitCode = main(process.argv.slice(2))

module.exports = { INFO_FILES, parseUpdateInfo, verifyDir, parseArgs, main }
