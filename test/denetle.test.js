'use strict'

// scripts/denetle.js birim testleri. Her test geçici bir klasörde örnek bir proje kurar,
// denetleyiciyi o klasör üzerinde çalıştırır ve ihlallerin dosya, satır ve kural olarak
// doğru bildirildiğini doğrular.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const { runChecks, NACL_PATH } = require('../scripts/denetle.js')

const ROOT = path.join(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'denetle.js')
const VENDOR = fs.readFileSync(path.join(ROOT, ...NACL_PATH.split('/')))

function lines (...rows) {
  return rows.join('\n') + '\n'
}

// Tüm kurallara uyan küçük bir proje. Testler bunun üzerine dosya ekler veya değiştirir.
function cleanFiles () {
  const files = {
    '.gitignore': lines('node_modules/', '*.log', 'veri/'),
    'package.json': lines('{', '  "name": "deneme",', '  "private": true', '}'),
    'server.js': lines(
      '\'use strict\'',
      'const http = require(\'node:http\')',
      'const server = http.createServer((req, res) => res.end(\'tamam; bitti\'))',
      'module.exports = { server }'
    ),
    'src/yardimci.js': lines(
      'const list = [',
      '  [1, 2],',
      '  [3, 4]',
      ']',
      'const total = sum(',
      '  (x) => x,',
      '  list',
      ')',
      'function sum (fn, rows) {',
      '  return rows.length + fn(0)',
      '}',
      'module.exports = { total }'
    ),
    'public/app.js': lines(
      '\'use strict\'',
      '// innerHTML, eval ve fetch yorum içinde geçebilir',
      'var notes = \'innerHTML; fetch; eval; document.write\'',
      'function load (url) {',
      '  return new Promise(function (resolve) {',
      '    var xhr = new XMLHttpRequest()',
      '    xhr.open(\'GET\', url)',
      '    xhr.onload = function () { resolve(xhr.responseText) }',
      '    xhr.send()',
      '  })',
      '}',
      'async function main () {',
      '  var text = await load(\'/api/info\')',
      '  var el = document.createElement(\'p\')',
      '  el.textContent = `${text} ${notes}`',
      '  document.body.appendChild(el)',
      '  return Object.entries({ a: 1 }).length',
      '}',
      'var isFn = main instanceof Function',
      'function replaceAll (s) { return s }',
      'main()'
    ),
    'public/sw.js': lines(
      'self.addEventListener(\'fetch\', function (event) {',
      '  event.respondWith(fetch(event.request))',
      '})'
    ),
    'public/style.css': lines('body { color: #fff; background: #000; }'),
    'public/index.html': lines(
      '<!doctype html>',
      '<html lang="tr">',
      '<head>',
      '<meta charset="utf-8">',
      '<title>Sohbet <deneme></title>',
      '<link rel="stylesheet" href="style.css">',
      '<script defer src="app.js"></script>',
      '</head>',
      '<body>',
      '<p title="onclick=1" data-online="evet">style= ve onclick= burada düz metindir</p>',
      '<!-- <script>yorum</script> <div style="x"> -->',
      '</body>',
      '</html>'
    ),
    'README.md': lines(
      '# Başlık',
      '',
      'Düzyazıda virgül kullanılır.',
      '',
      '```js',
      'const a = 1; const b = 2',
      '```',
      '',
      'Satır içi kodda `a; b` ve ``çift `ters` tırnak; içinde`` serbesttir.',
      '',
      '~~~',
      'tilde bloğu; serbest',
      '~~~'
    ),
    'baslat.bat': '@echo off\r\nchcp 65001 >nul\r\nREM Türkçe açıklama\r\nnode server.js\r\n',
    'public/icons/icon.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xe2, 0x80, 0x94, 0x3b]),
    'public/vendor/ek.js': 'var a = 1; el.innerHTML = "\u2014"\n'
  }
  files[NACL_PATH] = VENDOR
  return files
}

function writeProject (dir, files) {
  for (const name of Object.keys(files)) {
    if (files[name] === null) continue
    const full = path.join(dir, ...name.split('/'))
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, files[name])
  }
}

function makeProject (t, overrides) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'denetle-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  writeProject(dir, Object.assign(cleanFiles(), overrides || {}))
  return dir
}

function check (t, overrides) {
  return runChecks(makeProject(t, overrides)).violations
}

// Bir dosyanın ihlallerini satır ve kurala indirger, sıralı döndürür
function of (violations, file) {
  return violations
    .filter((v) => v.file === file)
    .map((v) => ({ line: v.line, rule: v.rule }))
    .sort((a, b) => a.line - b.line || (a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0))
}

function messageAt (violations, file, line) {
  const found = violations.find((v) => v.file === file && v.line === line)
  return found ? found.message : ''
}

test('temiz örnek projede ihlal bulunmaz', (t) => {
  const result = runChecks(makeProject(t))
  assert.deepEqual(result.violations, [])
  assert.ok(result.scanned >= 10, 'en az 10 metin dosyası taranmalı')
})

test('uzun ve kısa tire tüm metin dosyalarında yakalanır, ikili ve vendor dosyaları atlanır', (t) => {
  const violations = check(t, {
    'docs/notlar.txt': lines('birinci satır', 'ikinci \u2014 satır', 'üçüncü \u2013 satır'),
    'src/a.js': lines('// açıklama \u2013 burada', 'module.exports = 1')
  })
  assert.deepEqual(of(violations, 'docs/notlar.txt'), [{ line: 2, rule: 'dash' }, { line: 3, rule: 'dash' }])
  assert.deepEqual(of(violations, 'src/a.js'), [{ line: 1, rule: 'dash' }])
  assert.match(messageAt(violations, 'docs/notlar.txt', 2), /U\+2014/)
  assert.match(messageAt(violations, 'docs/notlar.txt', 3), /U\+2013/)
  assert.equal(violations.length, 3)
})

test('JavaScript dosyalarında noktalı virgül token olarak sayılır, dize ve yorumdakiler sayılmaz', (t) => {
  const violations = check(t, {
    'src/a.js': lines('const a = 1;', 'const s = \'a; b\' // yorum; burada', 'for (;;) break', 'module.exports = { a, s }'),
    'test/b.test.js': lines('let b = 1;'),
    'e2e/c.test.js': lines('let c = 1;'),
    'scripts/d.js': lines('let d = 1;'),
    'public/e.js': lines('var e = 1;')
  })
  assert.deepEqual(of(violations, 'src/a.js'), [{ line: 1, rule: 'semicolon' }, { line: 3, rule: 'semicolon' }])
  assert.match(messageAt(violations, 'src/a.js', 3), /sütun 6, 7/)
  for (const file of ['test/b.test.js', 'e2e/c.test.js', 'scripts/d.js', 'public/e.js']) {
    assert.deepEqual(of(violations, file), [{ line: 1, rule: 'semicolon' }], file)
  }
  assert.equal(violations.length, 6)
})

test('sunucu tarafında güncel sözdizimi ve ES modülleri kabul edilir, bozuk dosya bildirilir', (t) => {
  const violations = check(t, {
    'src/yeni.js': lines(
      'class A {',
      '  #x = 1',
      '  get x () { return this.#x }',
      '}',
      'const v = globalThis.a?.b ?? 0',
      'module.exports = { A, v }'
    ),
    'src/modul.mjs': lines('import fs from \'node:fs\'', 'export default fs'),
    'src/esm.js': lines('import path from \'node:path\'', 'export const sep = path.sep'),
    'scripts/cli.js': lines('#!/usr/bin/env node', 'if (process.argv.length > 9) return'),
    'src/bozuk.js': lines('const ok = 1', 'const = 2'),
    'src/esm-bozuk.js': lines('import fs from \'node:fs\'', 'export default fs', 'const = 3')
  })
  assert.deepEqual(violations.map((v) => v.file), ['src/bozuk.js', 'src/esm-bozuk.js'])
  assert.deepEqual(of(violations, 'src/bozuk.js'), [{ line: 2, rule: 'syntax' }])
  // ES modülündeki gerçek hata, betik denemesinin import hatası yerine bildirilir
  assert.deepEqual(of(violations, 'src/esm-bozuk.js'), [{ line: 3, rule: 'syntax' }])
})

test('istemci kodu ES2017 sözdizimiyle sınırlıdır', (t) => {
  const cases = {
    'public/a.js': ['var x = a?.b', 1],
    'public/b.js': ['var y = { ...z }', 1],
    'public/c.js': ['var r = /(?<=a)b/', 1],
    'public/d.js': ['var r = /\\p{L}/u', 1],
    'public/e.js': ['async function f (list) {\n  for await (const x of list) {}\n}', 2],
    'public/f.js': ['try { a() } catch { b() }', 1],
    'public/g.js': ['import x from \'./x.js\'', 1],
    'public/h.js': ['var n = 1_000', 1]
  }
  const overrides = {}
  for (const file of Object.keys(cases)) overrides[file] = cases[file][0] + '\n'
  const violations = check(t, overrides)
  for (const file of Object.keys(cases)) {
    assert.deepEqual(of(violations, file), [{ line: cases[file][1], rule: 'syntax' }], file)
    assert.match(messageAt(violations, file, cases[file][1]), /ES2017/)
  }
  assert.equal(violations.length, Object.keys(cases).length)
})

test('istemcide yasak kullanımlar sözdizimi ağacı üzerinden yakalanır', (t) => {
  const violations = check(t, {
    'public/app.js': lines(
      'el.innerHTML = \'x\'',
      'el[\'outerHTML\'] = \'y\'',
      'el.insertAdjacentHTML(\'beforeend\', s)',
      'var o = { \'innerHTML\': 1 }',
      'document.write(\'x\')',
      'eval(\'1\')',
      'var f = new Function(\'return 1\')',
      'Function(\'return 2\')()',
      'fetch(\'/api/info\')',
      'window.fetch(\'/api/info\')',
      's.replaceAll(\'a\', \'b\')',
      'var c = structuredClone(o)',
      'Object.hasOwn(o, \'a\')',
      'list.at(-1)',
      'var r = /\\p{L}/',
      '// innerHTML, eval ve fetch yorumda sayılmaz',
      'var s = \'innerHTML fetch eval document.write\'',
      'var ok = f instanceof Function',
      'var at = list[0]',
      'function replaceAll (a) { return a }'
    ),
    'public/sw.js': lines(
      'self.addEventListener(\'fetch\', function (event) {',
      '  event.respondWith(fetch(event.request))',
      '})',
      'document.body.innerHTML = \'\''
    )
  })
  const expected = Array.from({ length: 15 }, (unused, index) => ({ line: index + 1, rule: 'banned' }))
  assert.deepEqual(of(violations, 'public/app.js'), expected)
  assert.match(messageAt(violations, 'public/app.js', 1), /innerHTML/)
  assert.match(messageAt(violations, 'public/app.js', 9), /XMLHttpRequest/)
  assert.match(messageAt(violations, 'public/app.js', 14), /\.at\(\)/)
  assert.deepEqual(of(violations, 'public/sw.js'), [{ line: 4, rule: 'banned' }])
  assert.equal(violations.length, 16)
})

test('noktalı virgülsüz yazımda satır birleşmesi tehlikeleri yakalanır', (t) => {
  const violations = check(t, {
    'src/a.js': lines(
      'const a = b',
      '(function () {})()',
      'const c = d',
      '[0].forEach(f)',
      'const e = g',
      '`x`',
      'if (a) {',
      '}',
      '[c, e] = [e, c]',
      'module.exports = foo(',
      '  (x) => x,',
      '  [1, 2]',
      ')'
    ),
    'public/b.js': lines('(function () {', '  \'use strict\'', '})()')
  })
  assert.deepEqual(of(violations, 'src/a.js'), [
    { line: 2, rule: 'lineStart' },
    { line: 4, rule: 'lineStart' },
    { line: 6, rule: 'lineStart' },
    { line: 9, rule: 'lineStart' }
  ])
  assert.deepEqual(of(violations, 'public/b.js'), [{ line: 1, rule: 'lineStart' }])
  assert.equal(violations.length, 5)
})

test('üçüncü taraf şifreleme dosyasının sha256 değeri denetlenir', (t) => {
  const changed = check(t, { [NACL_PATH]: Buffer.concat([VENDOR, Buffer.from('\n')]) })
  assert.deepEqual(of(changed, NACL_PATH), [{ line: 1, rule: 'vendor' }])
  assert.match(messageAt(changed, NACL_PATH, 1), /sha256/)
  assert.equal(changed.length, 1)

  const missing = check(t, { [NACL_PATH]: null })
  assert.deepEqual(of(missing, NACL_PATH), [{ line: 1, rule: 'vendor' }])
  assert.match(messageAt(missing, NACL_PATH, 1), /bulunamadı/)
  assert.equal(missing.length, 1)
})

test('Windows betiklerinde BOM, CRLF olmayan satır sonu ve noktalı virgül yakalanır', (t) => {
  const violations = check(t, {
    'a.bat': '\ufeff@echo off\r\nREM açıklama\r\n',
    'b.bat': '@echo off\r\nREM bir\nREM iki\nnode server.js\r\n',
    'c.bat': '@echo off\r\nREM açıklama; devam\r\n'
  })
  assert.deepEqual(of(violations, 'a.bat'), [{ line: 1, rule: 'bom' }])
  assert.deepEqual(of(violations, 'b.bat'), [{ line: 2, rule: 'eol' }])
  assert.match(messageAt(violations, 'b.bat', 2), /^2 satırda/)
  assert.deepEqual(of(violations, 'c.bat'), [{ line: 2, rule: 'prose' }])
  assert.equal(violations.length, 3)
})

test('Markdown düzyazısındaki noktalı virgül yakalanır, kod blokları ve satır içi kod hariç tutulur', (t) => {
  const crlf = (...rows) => rows.join('\r\n') + '\r\n'
  const violations = check(t, {
    'docs/a.md': lines(
      '# Başlık',
      '',
      'Bu cümle; hatalı.',
      '',
      '`kod; serbest` ama bu; değil',
      '',
      '```',
      'blok; serbest',
      '```',
      '',
      'Çok satırlı `kod',
      'devamı;` sonu',
      '',
      'Kaçışlı \\` ters tırnak; sayılır'
    ),
    'docs/b.md': crlf('Satır bir', '', 'Satır üç; hatalı')
  })
  assert.deepEqual(of(violations, 'docs/a.md'), [
    { line: 3, rule: 'prose' },
    { line: 5, rule: 'prose' },
    { line: 14, rule: 'prose' }
  ])
  assert.deepEqual(of(violations, 'docs/b.md'), [{ line: 3, rule: 'prose' }])
  assert.equal(violations.length, 4)
})

test('HTML içinde satır içi betik, stil öğesi ve stil ile olay öznitelikleri yakalanır', (t) => {
  const violations = check(t, {
    'public/index.html': lines(
      '<!doctype html>',
      '<html><head>',
      '<style>body { color: red }</style>',
      '<script src="app.js"></script>',
      '<script>alert(1)</script>',
      '</head><body onload="x()">',
      '<div style="color: red">metin</div>',
      '<SCRIPT SRC="b.js">',
      '</SCRIPT>',
      '<button ONCLICK=\'y()\'>a</button>',
      '</body></html>'
    )
  })
  assert.deepEqual(of(violations, 'public/index.html'), [
    { line: 3, rule: 'html' },
    { line: 5, rule: 'html' },
    { line: 6, rule: 'html' },
    { line: 7, rule: 'html' },
    { line: 10, rule: 'html' }
  ])
  assert.equal(violations.length, 5)
})

test('klasör taramasında node_modules, .gitignore kapsamı ve vendor dışarıda kalır', (t) => {
  const violations = check(t, {
    'node_modules/paket/index.js': 'var a = 1;\n',
    'veri/notlar.md': 'Burada; noktalı virgül var.\n',
    'sunucu.log': 'uzun \u2014 tire\n',
    'public/vendor/ek.md': 'Burada; noktalı virgül var.\n'
  })
  assert.deepEqual(violations, [])
})

test('git deposunda izlenen ve .gitignore dışında kalan yeni dosyalar denetlenir', (t) => {
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' })
  if (git.error || git.status !== 0) {
    t.skip('git bulunamadı')
    return
  }
  const dir = makeProject(t, {
    'src/izlenen.js': 'const a = 1;\n',
    'src/yeni.js': 'const b = 2;\n',
    'veri/atla.js': 'const c = 3;\n'
  })
  const run = (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 0, 'git ' + args.join(' ') + ': ' + result.stderr)
  }
  run('init', '-q')
  run('add', 'src/izlenen.js')
  const violations = runChecks(dir).violations
  assert.deepEqual(violations.map((v) => v.file), ['src/izlenen.js', 'src/yeni.js'])
})

test('komut satırı: hedef klasör parametresi, çıktı biçimi ve çıkış kodları', (t) => {
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })

  const clean = run(makeProject(t))
  assert.equal(clean.status, 0, clean.stdout + clean.stderr)
  assert.match(clean.stdout, /ihlal bulunmadı/)

  const dirty = run(makeProject(t, { 'src/a.js': lines('const a = 1', 'const b = 2;') }))
  assert.equal(dirty.status, 1, dirty.stdout + dirty.stderr)
  assert.match(dirty.stdout, /^src\/a\.js:2: noktalı virgül/m)
  assert.match(dirty.stdout, /Denetim başarısız: 1 ihlal, 1 dosyada/)

  const missing = run(path.join(os.tmpdir(), 'denetle-olmayan-dizin-' + process.pid))
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /Klasör bulunamadı/)

  const help = run('--yardim')
  assert.equal(help.status, 0)
  assert.match(help.stdout, /Kullanım/)
})
