'use strict'

// Ana süreç tanı günlüğü (src/lib/diagnostics.js) ve açılışı durduran hatanın bildirimi

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const diagnostics = require('../src/lib/diagnostics')

const SRC = path.join(__dirname, '..', 'src')

test('günlük yolu yalnızca mutlak bir yolsa kabul edilir', () => {
  const absolute = path.join(os.tmpdir(), 'tani.log')
  assert.equal(diagnostics.ENV_NAME, 'TELSIZ_TANI_GUNLUGU')
  assert.equal(diagnostics.logPathFrom({ TELSIZ_TANI_GUNLUGU: absolute }), absolute)
  assert.equal(diagnostics.logPathFrom({ TELSIZ_TANI_GUNLUGU: 'goreli/tani.log' }), null)
  assert.equal(diagnostics.logPathFrom({ TELSIZ_TANI_GUNLUGU: '' }), null)
  assert.equal(diagnostics.logPathFrom({}), null)
  assert.equal(diagnostics.logPathFrom(undefined), null)
})

test('değişken yoksa günlük kapalıdır ve hiçbir şey yazılmaz', () => {
  const calls = []
  const diag = diagnostics.createDiagnostics({ file: null, appendFile: () => calls.push('file'), writeErr: () => calls.push('err') })
  assert.equal(diag.enabled, false)
  diag.log('start', { a: 1 })
  assert.deepEqual(calls, [])
  assert.equal(diagnostics.fromEnv({}).enabled, false)
})

test('satırlar dosyaya ve hata akışına önek, zaman ve tek satırlık JSON ile yazılır', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-masaustu-tani-'))
  try {
    const file = path.join(dir, 'ana-surec.log')
    const errLines = []
    const diag = diagnostics.createDiagnostics({ file, writeErr: (text) => errLines.push(text), now: () => new Date(Date.UTC(2026, 0, 2, 3, 4, 5)) })
    assert.equal(diag.enabled, true)
    diag.log('ready')
    diag.log('window', { context: 'connect', contents: 3, ok: true, missing: undefined, text: 'a\nb' })
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    assert.deepEqual(lines, [
      '[telsiz-tani] 2026-01-02T03:04:05.000Z ready',
      '[telsiz-tani] 2026-01-02T03:04:05.000Z window {"context":"connect","contents":3,"ok":true,"missing":null,"text":"a\\nb"}',
      ''
    ])
    assert.deepEqual(errLines, [lines[0] + '\n', lines[1] + '\n'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('uzun değerler kısaltılır, hata nesnesinin yığını yazılır, yazma hatası uygulamayı durdurmaz', () => {
  const out = []
  const diag = diagnostics.createDiagnostics({
    file: path.join(os.tmpdir(), 'kullanilmaz.log'),
    appendFile: () => { throw new Error('disk dolu') },
    writeErr: (text) => out.push(text)
  })
  diag.log('uzun', { value: 'x'.repeat(diagnostics.MAX_VALUE_CHARS + 50) })
  const err = new Error('bozuk')
  diag.log('hata', { error: err })
  assert.equal(out.length, 2)
  const first = JSON.parse(out[0].slice(out[0].indexOf('{')))
  assert.equal(first.value, 'x'.repeat(diagnostics.MAX_VALUE_CHARS) + '...')
  const second = JSON.parse(out[1].slice(out[1].indexOf('{')))
  assert.match(second.error, /^Error: bozuk/)
  const silent = diagnostics.createDiagnostics({ file: '/x', appendFile: () => { throw new Error('a') }, writeErr: () => { throw new Error('b') } })
  assert.doesNotThrow(() => silent.log('sessiz'))
})

test('açılışı durduran hata hata akışına yazılır, hata kutusu yalnızca gözetimsiz çalıştırmada açılmaz', () => {
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8').replace(/\r\n/g, '\n')
  const body = /function showFatal \(err\) \{\n([\s\S]*?)\n\}\n/.exec(main)[1]
  assert.match(body, /logError\('fatal', /)
  assert.match(body, /if \(!diag\.enabled\) dialog\.showErrorBox\(t\('integrity\.title'\), t\('integrity\.body', \{ files \}\)\)/)
  assert.match(body, /app\.exit\(1\)/)
  // Engelleyici hata kutusu başka bir yerde koşulsuz çağrılmaz
  assert.equal((main.match(/dialog\.showErrorBox\(/g) || []).length, 1)
  assert.match(main, /const diag = diagnostics\.fromEnv\(process\.env\)/)
  // Electron'un yakalanmamış hata kutusunu kapatan işleyici yalnızca gözetimsiz çalıştırmada eklenir
  const guarded = /\nif \(diag\.enabled\) \{\n([\s\S]*?)\n\}\n/.exec(main)[1]
  assert.match(guarded, /process\.on\('uncaughtException', [\s\S]*app\.exit\(1\)/)
  assert.equal((main.match(/process\.on\('uncaughtException'/g) || []).length, 1)
})
