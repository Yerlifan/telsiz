'use strict'

// Bir klasördeki *.test.js dosyalarını bulup node --test ile çalıştırır.
// Neden gerekli: "node --test test/" yalnızca Node.js 20'de çalışır, Node.js 22 ve
// sonrasında klasör adı modül sanılır. Glob kalıbını da Node.js 20 kendisi açmaz ve
// Windows komut satırı da açmaz. Bu betik tüm sürümlerde ve işletim sistemlerinde
// aynı dosya listesini verir.
// Kullanım: node scripts/test-calistir.js <klasör> [node --test seçenekleri]

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const TEST_FILE = /\.test\.(c|m)?js$/

function collectTestFiles (dir) {
  const found = []
  const stack = [dir]
  while (stack.length > 0) {
    const current = stack.pop()
    const entries = fs.readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.isFile() && TEST_FILE.test(entry.name)) found.push(full)
    }
  }
  return found.sort()
}

function main () {
  const args = process.argv.slice(2)
  const target = args.find((arg) => !arg.startsWith('-'))
  const options = args.filter((arg) => arg.startsWith('-'))
  if (!target) {
    console.error('Kullanım: node scripts/test-calistir.js <klasör> [node --test seçenekleri]')
    return 2
  }
  const dir = path.resolve(target)
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    console.error('Test klasörü bulunamadı: ' + target)
    return 1
  }
  // Node.js 22 ve sonrası argümanları glob kalıbı olarak okur, Windows'ta ters bölü
  // kaçış karakteri sayılabileceği için yollar düz bölüyle verilir
  const files = collectTestFiles(dir).map((file) => path.relative(process.cwd(), file).split(path.sep).join('/'))
  if (files.length === 0) {
    console.error('Test dosyası bulunamadı (' + target + ' altında *.test.js yok).')
    return 1
  }
  const result = spawnSync(process.execPath, ['--test'].concat(options, files), { stdio: 'inherit' })
  if (result.error) {
    console.error('Testler başlatılamadı: ' + result.error.message)
    return 1
  }
  return typeof result.status === 'number' ? result.status : 1
}

process.exitCode = main()
