'use strict'

// CHANGELOG.md (Türkçe) ve CHANGELOG.en.md (İngilizce) dosyalarından bir sürümün bölümünü
// çıkarır. GitHub Release notları bu çıktıdan oluşur: önce Türkçe bölüm, ayırıcı çizgi, sonra
// İngilizce bölüm. Bölüm, '## [2.0.0]' veya '## 2.0.0' ile başlayan başlıktan (başlığın
// devamında tarih olabilir) bir sonraki '## ' başlığına kadardır, başlığın kendisi alınmaz.
// Sürümün bölümü iki dosyanın birinde yoksa veya boşsa çıkış kodu 1 olur.
// Kullanım: node scripts/surum-notlari.js <sürüm> [klasör]

const fs = require('node:fs')
const path = require('node:path')

const FILES = [
  { file: 'CHANGELOG.md', label: 'Türkçe' },
  { file: 'CHANGELOG.en.md', label: 'English' }
]

function escapeRegex (text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Metinden sürümün bölüm gövdesini döner, bulunamazsa null. Kod blokları içindeki başlıklar sayılmaz.
function extractSection (text, version) {
  const heading = new RegExp('^##[ \\t]+\\[?' + escapeRegex(version) + '\\]?(?=$|[ \\t])')
  const lines = String(text).split(/\r\n|\r|\n/)
  const body = []
  let inside = false
  let fence = null
  for (const line of lines) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)
    if (marker) {
      if (fence === null) fence = marker[1]
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = null
    }
    if (fence === null && !marker && /^##[ \t]/.test(line)) {
      if (inside) break
      if (heading.test(line)) {
        inside = true
        continue
      }
    }
    if (inside) body.push(line)
  }
  if (!inside) return null
  const result = body.join('\n').trim()
  return result === '' ? null : result
}

// İki dildeki bölümleri birleştirir. Sonuç: { notes } veya { error }
function releaseNotes (dir, version) {
  const parts = []
  for (const item of FILES) {
    let text
    try {
      text = fs.readFileSync(path.join(dir, item.file), 'utf8')
    } catch (err) {
      return { error: item.file + ' okunamadı (' + (err.code || err.message) + ').' }
    }
    const section = extractSection(text, version)
    if (section === null) return { error: item.file + ' dosyasında ' + version + ' sürümünün bölümü yok veya boş.' }
    parts.push(section)
  }
  return { notes: parts.join('\n\n---\n\n') + '\n' }
}

function main (argv) {
  const args = argv.slice(2)
  if (args.length < 1 || args.length > 2 || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(args[0])) {
    console.error('Kullanım: node scripts/surum-notlari.js <sürüm> [klasör]')
    return 2
  }
  const result = releaseNotes(path.resolve(args[1] || path.join(__dirname, '..')), args[0])
  if (result.error) {
    console.error('Sürüm notları çıkarılamadı: ' + result.error)
    return 1
  }
  process.stdout.write(result.notes)
  return 0
}

if (require.main === module) process.exitCode = main(process.argv)

module.exports = { extractSection, releaseNotes }
