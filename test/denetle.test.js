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

const { runChecks, NACL_PATH, SCRYPT_PATH, SCRYPT_SHA256 } = require('../scripts/denetle.js')

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
    'README.en.md': lines('# Title', '', 'Prose uses commas.'),
    'baslat.bat': '@echo off\r\nchcp 65001 >nul\r\nREM Türkçe açıklama\r\nnode server.js\r\n',
    'public/icons/icon.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xe2, 0x80, 0x94, 0x3b]),
    'public/vendor/ek.js': 'var a = 1; el.innerHTML = "\u2014\u200b"\n'
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

function at (rule, ...lineNumbers) {
  return lineNumbers.map((line) => ({ line, rule }))
}

function hasGit () {
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' })
  return !git.error && git.status === 0
}

function gitRunner (dir) {
  return (...args) => {
    const result = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 0, 'git ' + args.join(' ') + ': ' + result.stderr)
  }
}

// İki dilli sözlük dosyaları. entries: { anahtar: [tr, en] }
function dictionaryBody (entries, index) {
  const rows = Object.keys(entries).map((key) => '  ' + JSON.stringify(key) + ': ' + JSON.stringify(entries[key][index]))
  return '{\n' + rows.join(',\n') + '\n}'
}

function clientDictionary (entries) {
  return lines(
    '\'use strict\'',
    'var tr = ' + dictionaryBody(entries, 0),
    'var en = ' + dictionaryBody(entries, 1),
    'window.I18N = { messages: { tr: tr, en: en } }'
  )
}

function serverDictionary (entries) {
  return lines(
    '\'use strict\'',
    'const tr = ' + dictionaryBody(entries, 0),
    'const en = ' + dictionaryBody(entries, 1),
    'module.exports = { messages: { tr, en } }'
  )
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

test('Dockerfile, .dockerignore ve deploy/ dosyaları metin kurallarıyla denetlenir', (t) => {
  const violations = check(t, {
    'Dockerfile': lines('FROM node:22-alpine', '# açıklama \u2014 burada', 'CMD ["node", "server.js"]'),
    '.dockerignore': lines('node_modules', '# \u2013 not'),
    'deploy/Caddyfile': lines('ornek.com {', '\treverse_proxy 127.0.0.1:3000 # \u2014', '}'),
    'deploy/nginx.conf': lines('server {', '    listen 80;', '    client_max_body_size 30m;', '}'),
    'deploy/telsiz.service': lines('[Service]', 'ExecStart=/usr/bin/node server.js', '# \u2013 açıklama'),
    'deploy/docker-compose.yml': lines('services:', '  telsiz:', '    image: telsiz # yerel\u200b')
  })
  assert.deepEqual(of(violations, 'Dockerfile'), at('dash', 2))
  assert.deepEqual(of(violations, '.dockerignore'), at('dash', 2))
  assert.deepEqual(of(violations, 'deploy/Caddyfile'), at('dash', 2))
  assert.deepEqual(of(violations, 'deploy/telsiz.service'), at('dash', 3))
  assert.deepEqual(of(violations, 'deploy/docker-compose.yml'), at('invisible', 3))
  // Yapılandırma dosyalarındaki noktalı virgül sözdiziminin parçasıdır, ihlal sayılmaz
  assert.deepEqual(of(violations, 'deploy/nginx.conf'), [])
  assert.equal(violations.length, 5)
})

test('görünmez ve biçim karakterleri tüm metin dosyalarında yakalanır, kaçış dizileri serbesttir', (t) => {
  const violations = check(t, {
    'docs/notlar.txt': lines('temiz satır', 'sıfır\u200bgenişlik', 'bölünmez\u00a0boşluk ve yön \u202e işareti'),
    'src/a.js': lines('const s = \'gizli\u2066\'', 'const ok = \'\\u200b kaçış serbest\'', 'module.exports = { s, ok }'),
    'src/bom.js': '\ufeff' + lines('module.exports = 1'),
    'Dockerfile': lines('FROM node:22-alpine', '# açıklama\u2028devam'),
    'deploy/nginx.conf': lines('server {', '    listen 80;\u2029', '}'),
    '.github/workflows/ci.yml': lines('name: CI', 'on: push\u200d'),
    'README.md': lines('# Başlık', '', 'Metin\u200e burada.', 'Diğer\u200f\u202a\u2069 yön.'),
    'yerel.bat': '\ufeff@echo off\r\nREM satır\u200c\r\n'
  })
  assert.deepEqual(of(violations, 'docs/notlar.txt'), at('invisible', 2, 3))
  assert.match(messageAt(violations, 'docs/notlar.txt', 2), /U\+200B \(sıfır genişlikli karakter\) sütun 6/)
  assert.match(messageAt(violations, 'docs/notlar.txt', 3), /U\+00A0 \(bölünmez boşluk\) sütun 9, U\+202E \(yön gömme veya geçersiz kılma\) sütun 24/)
  assert.deepEqual(of(violations, 'src/a.js'), at('invisible', 1))
  assert.match(messageAt(violations, 'src/a.js', 1), /U\+2066 \(yön yalıtımı\)/)
  assert.deepEqual(of(violations, 'src/bom.js'), at('invisible', 1))
  assert.match(messageAt(violations, 'src/bom.js', 1), /U\+FEFF \(BOM/)
  assert.deepEqual(of(violations, 'Dockerfile'), at('invisible', 2))
  assert.match(messageAt(violations, 'Dockerfile', 2), /U\+2028 \(satır ayırıcı\)/)
  assert.deepEqual(of(violations, 'deploy/nginx.conf'), at('invisible', 2))
  assert.match(messageAt(violations, 'deploy/nginx.conf', 2), /U\+2029 \(paragraf ayırıcı\)/)
  assert.deepEqual(of(violations, '.github/workflows/ci.yml'), at('invisible', 2))
  assert.deepEqual(of(violations, 'README.md'), at('invisible', 3, 4))
  assert.match(messageAt(violations, 'README.md', 4), /U\+200F .*U\+202A .*U\+2069/)
  // Windows betiğinin başındaki BOM yalnızca "bom" kuralıyla bir kez bildirilir
  assert.deepEqual(of(violations, 'yerel.bat'), [{ line: 1, rule: 'bom' }, { line: 2, rule: 'invisible' }])
  assert.equal(violations.length, 11)
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

test('public/js/*.js, theme-init.js ve i18n.js istemci kurallarına tabidir', (t) => {
  const violations = check(t, {
    'public/js/panel.js': lines('var a = b ?? c'),
    'public/js/ui.js': lines('var el = document.createElement(\'div\')', 'el.innerHTML = \'x\''),
    'public/js/liste.js': lines('var x = a', '[1, 2].forEach(f)'),
    'public/theme-init.js': lines(
      'try {',
      '  document.documentElement.setAttribute(\'data-theme\', localStorage.getItem(\'telsiz.theme\'))',
      '} catch {',
      '}'
    ),
    'public/i18n.js': lines(
      '\'use strict\'',
      'var tr = { a: \'A\' }',
      'var en = { a: \'A\' }',
      'window.I18N = { messages: { tr: tr, en: en }, has: function (k) { return Object.hasOwn(tr, k) } }'
    )
  })
  assert.deepEqual(of(violations, 'public/js/panel.js'), at('syntax', 1))
  assert.match(messageAt(violations, 'public/js/panel.js', 1), /ES2017/)
  assert.deepEqual(of(violations, 'public/js/ui.js'), at('banned', 2))
  assert.deepEqual(of(violations, 'public/js/liste.js'), at('lineStart', 2))
  assert.deepEqual(of(violations, 'public/theme-init.js'), at('syntax', 3))
  assert.deepEqual(of(violations, 'public/i18n.js'), at('banned', 4))
  assert.equal(violations.length, 5)
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

test('scrypt-js kopyası yalnızca varsa denetlenir ve birebir aynı olmalıdır', (t) => {
  // Temiz örnekte scrypt.js yok, bu bir ihlal değildir (nacl ise zorunludur)
  assert.deepEqual(of(check(t), SCRYPT_PATH), [])

  const changed = check(t, { [SCRYPT_PATH]: '"use strict";\n(function (root) {})(this);\n' })
  assert.deepEqual(of(changed, SCRYPT_PATH), at('vendor', 1))
  assert.match(messageAt(changed, SCRYPT_PATH, 1), /sha256.*scrypt-js 3\.0\.1/)
  assert.equal(changed.length, 1)

  // Depoda kopya varsa denetleyicideki değerle aynı olmalıdır
  const repoCopy = path.join(ROOT, ...SCRYPT_PATH.split('/'))
  if (!fs.existsSync(repoCopy)) {
    t.diagnostic(SCRYPT_PATH + ' henüz depoda yok, birebir kopya denetimi atlandı')
    return
  }
  const copy = fs.readFileSync(repoCopy)
  assert.equal(require('node:crypto').createHash('sha256').update(copy).digest('hex'), SCRYPT_SHA256)
  assert.deepEqual(check(t, { [SCRYPT_PATH]: copy }), [])
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

test('i18n-parity: eksik anahtar, boş değer, parametre farkı, çoğul eşi ve yinelenen anahtar', (t) => {
  const violations = check(t, {
    'public/i18n.js': lines(
      '\'use strict\'',
      'var tr = {',
      '  \'login.title\': \'Giriş yap\',',
      '  \'members.online_one\': \'{count} kişi\',',
      '  \'members.online_other\': \'{count} kişi\',',
      '  welcome: \'Hoş geldin {name}\',',
      '  \'only.tr\': \'Yalnızca Türkçe\',',
      '  blank: \'Dolu\',',
      '  dup: \'bir\',',
      '  dup: \'iki\',',
      '  lonely_one: \'tek\',',
      '  nested: { deep: { key: \'İç içe {x}\' } }',
      '}',
      'var en = {',
      '  \'login.title\': \'Sign in\',',
      '  \'members.online_one\': \'{count} person\',',
      '  \'members.online_other\': \'{count} people\',',
      '  welcome: \'Welcome {user}\',',
      '  \'only.en\': \'English only\',',
      '  blank: \'  \',',
      '  dup: \'one\',',
      '  lonely_one: \'single\',',
      '  \'nested.deep.key\': \'Nested {x}\'',
      '}',
      'window.I18N = { messages: { tr: tr, en: en } }'
    )
  })
  assert.deepEqual(of(violations, 'public/i18n.js'), at('i18n-parity', 7, 10, 11, 18, 19, 20, 22))
  assert.match(messageAt(violations, 'public/i18n.js', 7), /'only\.tr' anahtarı tr sözlüğünde var, en sözlüğünde yok/)
  assert.match(messageAt(violations, 'public/i18n.js', 10), /'dup' anahtarı birden fazla/)
  assert.match(messageAt(violations, 'public/i18n.js', 11), /çoğul eşi 'lonely_other'/)
  assert.match(messageAt(violations, 'public/i18n.js', 18), /tr \{name\}, en \{user\}/)
  assert.match(messageAt(violations, 'public/i18n.js', 19), /'only\.en' anahtarı en sözlüğünde var, tr sözlüğünde yok/)
  assert.match(messageAt(violations, 'public/i18n.js', 20), /'blank' anahtarının değeri boş/)
  assert.equal(violations.length, 7)
})

test('i18n sözlükleri farklı biçimlerde okunur, okunamayan girdiler ve eksik sözlük bildirilir', (t) => {
  const readable = check(t, {
    'src/i18n.js': lines(
      '\'use strict\'',
      'const common = { \'app.name\': \'Telsiz\' }',
      'const messages = {',
      '  tr: Object.freeze({ ...common, errors: { bad: \'Hatalı {field}\' }, [\'a\' + \'.b\']: `Şablon` }),',
      '  en: { ...common, \'errors.bad\': \'Invalid {field}\', \'a.b\': \'Template\' }',
      '}',
      'function t (lang, key) { return (messages[lang] || messages.en)[key] || key }',
      'module.exports = { messages, t }'
    ),
    'public/i18n.js': clientDictionary({ 'a.b': ['A', 'A'] })
  })
  assert.deepEqual(readable, [])

  const broken = check(t, {
    'src/i18n.js': lines(
      '\'use strict\'',
      'const tr = { a: \'A\', b: getText(), [key]: \'C\', ...other }',
      'const en = { a: \'A\', get b () { return \'B\' } }',
      'module.exports = { tr, en }'
    ),
    'public/i18n.js': lines('\'use strict\'', 'window.I18N = { t: function (key) { return key } }')
  })
  assert.deepEqual(of(broken, 'src/i18n.js'), at('i18n-parity', 2, 2, 2, 3))
  assert.deepEqual(of(broken, 'public/i18n.js'), at('i18n-parity', 1))
  assert.match(messageAt(broken, 'public/i18n.js', 1), /tr ve en sözlükleri bulunamadı/)
  const messages = broken.filter((v) => v.file === 'src/i18n.js').map((v) => v.message).sort()
  assert.match(messages.join('\n'), /'b' anahtarının değeri sabit bir dize değil/)
  assert.match(messages.join('\n'), /anahtarı sabit olmayan/)
  assert.match(messages.join('\n'), /yayılım/)
  assert.match(messages.join('\n'), /'b' bir yöntem veya erişimci/)
  assert.equal(broken.length, 5)
})

test('i18n-hardcoded: sözlük varsa istemci ve sunucu kodunda Türkçe sabit metin yakalanır', (t) => {
  const code = {
    'public/app.js': lines(
      '\'use strict\'',
      '// Yorumda Türkçe serbest: çğıöşü',
      'var title = \'Giriş yap\'',
      'var tpl = `Hoş ${title} geldin`',
      'var re = /[çğ]/',
      'var key = \'login.title\'',
      'var ok = \'Login\'',
      'var esc = \'\\u015fifre\''
    ),
    'public/js/panel.js': lines('var label = \'Çıkış\''),
    'src/app.js': lines('const msg = \'Kullanıcı bulunamadı\'', 'module.exports = { msg }'),
    'src/alt/yardimci.js': lines('module.exports = \'Doğrulandı\''),
    'server.js': lines('console.log(\'Sunucu çalışıyor\')'),
    'scripts/arac.js': lines('console.log(\'Türkçe çıktı\')'),
    'test/a.test.js': lines('const beklenen = \'Giriş yap\'', 'module.exports = beklenen')
  }
  // Sözlük dosyaları yokken kural atlanır
  assert.deepEqual(check(t, code), [])

  const violations = check(t, Object.assign({}, code, {
    'public/i18n.js': clientDictionary({ 'login.title': ['Giriş yap', 'Sign in'] }),
    'src/i18n.js': serverDictionary({ 'errors.bad': ['Hatalı istek', 'Bad request'] })
  }))
  assert.deepEqual(of(violations, 'public/app.js'), at('i18n-hardcoded', 3, 4, 8))
  assert.match(messageAt(violations, 'public/app.js', 3), /"Giriş yap"/)
  assert.deepEqual(of(violations, 'public/js/panel.js'), at('i18n-hardcoded', 1))
  assert.deepEqual(of(violations, 'src/app.js'), at('i18n-hardcoded', 1))
  assert.deepEqual(of(violations, 'src/alt/yardimci.js'), at('i18n-hardcoded', 1))
  assert.deepEqual(of(violations, 'public/i18n.js'), [])
  assert.deepEqual(of(violations, 'src/i18n.js'), [])
  assert.equal(violations.length, 6)
})

test('i18n-keys: t() çağrıları ve data-i18n öznitelikleri sözlükte aranır', (t) => {
  const violations = check(t, {
    'public/i18n.js': clientDictionary({
      'login.title': ['Giriş', 'Sign in'],
      'members.online_one': ['{count} kişi', '{count} person'],
      'members.online_other': ['{count} kişi', '{count} people'],
      'errors.bad_code': ['Kod hatalı', 'Invalid code'],
      'a.b': ['A', 'A'],
      'c.d': ['C', 'C']
    }),
    'public/app.js': lines(
      '\'use strict\'',
      'var t = window.I18N.t',
      't(\'login.title\')',
      't(\'missing.key\')',
      'window.I18N.t(\'members.online\', { count: 2 })',
      'I18N.t(\'also.missing\')',
      't(\'errors.\' + code)',
      't(\'nope.\' + code)',
      't(`errors.${code}`)',
      't(flag ? \'a.b\' : \'c.missing\')',
      't(dynamic)',
      'obj.t = \'not.a.call\'',
      't(name || \'c.d\')'
    ),
    'public/index.html': lines(
      '<!doctype html>',
      '<html lang="tr">',
      '<head><meta charset="utf-8"><title>Telsiz</title></head>',
      '<body>',
      '<h1 data-i18n="login.title">Giriş</h1>',
      '<input data-i18n-placeholder="missing.placeholder">',
      '<button data-i18n-aria-label="members.online" data-i18n-title=\'a.b\'>x</button>',
      '<p data-i18n="">boş</p>',
      '<!-- <p data-i18n="yorum.icinde"></p> -->',
      '</body>',
      '</html>'
    ),
    'src/i18n.js': serverDictionary({ 'errors.bad': ['Hatalı', 'Bad'], 'banner.ready': ['Hazır', 'Ready'] }),
    'src/app.js': lines(
      'const i18n = require(\'./i18n\')',
      'function f (lang, code) {',
      '  const a = i18n.t(lang, \'errors.bad\')',
      '  const b = i18n.t(lang, \'errors.yok\')',
      '  const c = i18n.t(lang, \'errors.\' + code)',
      '  const d = i18n.t(lang, \'x.\' + code)',
      '  return [a, b, c, d]',
      '}',
      'module.exports = { f }'
    ),
    'server.js': lines(
      'const { t } = require(\'./src/i18n\')',
      'console.log(t(\'tr\', \'banner.ready\'))',
      'console.log(t(\'en\', \'banner.yok\'))'
    )
  })
  assert.deepEqual(of(violations, 'public/app.js'), at('i18n-keys', 4, 6, 8, 10))
  assert.match(messageAt(violations, 'public/app.js', 4), /'missing\.key' anahtarı public\/i18n\.js sözlüğünde yok/)
  assert.match(messageAt(violations, 'public/app.js', 8), /'nope\.' önekiyle/)
  assert.match(messageAt(violations, 'public/app.js', 10), /'c\.missing'/)
  assert.deepEqual(of(violations, 'public/index.html'), at('i18n-keys', 6, 8))
  assert.match(messageAt(violations, 'public/index.html', 6), /data-i18n-placeholder özniteliğindeki 'missing\.placeholder'/)
  assert.match(messageAt(violations, 'public/index.html', 8), /boş/)
  assert.deepEqual(of(violations, 'src/app.js'), at('i18n-keys', 4, 6))
  assert.match(messageAt(violations, 'src/app.js', 4), /src\/i18n\.js/)
  assert.deepEqual(of(violations, 'server.js'), at('i18n-keys', 3))
  assert.equal(violations.length, 9)
})

test('belge eşliği: Türkçe ve İngilizce belgeler birlikte bulunur ve "## " başlık sayıları eşittir', (t) => {
  const violations = check(t, {
    'README.md': lines('# Telsiz', '', '## Kurulum', '', '```md', '## kod bloğundaki başlık sayılmaz', '```', '', '## Lisans'),
    'README.en.md': lines('# Telsiz', '', '## Setup', '', '### Alt başlık sayılmaz', '', '## License'),
    'CONTRIBUTING.md': lines('# Katkı', '', '## Kurallar'),
    'docs/ARCHITECTURE.md': lines('# Architecture'),
    'docs/KURULUM.md': lines('# Kurulum', '## Bir', '## İki', '## Üç'),
    'docs/DEPLOYMENT.md': lines('# Deployment', '## One', '#### Detail', '## Two'),
    'docs/TASARIM.md': lines('# Tasarım', '## Temalar'),
    'docs/DESIGN.md': lines('# Design', '  ## Themes')
  })
  assert.deepEqual(of(violations, 'README.md'), [])
  assert.deepEqual(of(violations, 'README.en.md'), [])
  assert.deepEqual(of(violations, 'CONTRIBUTING.md'), at('doc-parity', 1))
  assert.match(messageAt(violations, 'CONTRIBUTING.md', 1), /CONTRIBUTING\.en\.md bulunamadı/)
  assert.deepEqual(of(violations, 'docs/ARCHITECTURE.md'), at('doc-parity', 1))
  assert.match(messageAt(violations, 'docs/ARCHITECTURE.md', 1), /docs\/MIMARI\.md bulunamadı/)
  assert.deepEqual(of(violations, 'docs/DEPLOYMENT.md'), at('doc-parity', 1))
  assert.match(messageAt(violations, 'docs/DEPLOYMENT.md', 1), /\(2\) Türkçe eşi docs\/KURULUM\.md ile \(3\)/)
  assert.equal(violations.length, 3)

  const missing = check(t, { 'README.en.md': null })
  assert.deepEqual(of(missing, 'README.md'), at('doc-parity', 1))
  assert.match(messageAt(missing, 'README.md', 1), /README\.en\.md bulunamadı/)
  assert.equal(missing.length, 1)
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
  if (!hasGit()) {
    t.skip('git bulunamadı')
    return
  }
  const dir = makeProject(t, {
    'src/izlenen.js': 'const a = 1;\n',
    'src/yeni.js': 'const b = 2;\n',
    'veri/atla.js': 'const c = 3;\n'
  })
  const run = gitRunner(dir)
  run('init', '-q')
  run('add', 'src/izlenen.js')
  const violations = runChecks(dir).violations
  assert.deepEqual(violations.map((v) => v.file), ['src/izlenen.js', 'src/yeni.js'])
})

test('git\'te izlenip diskten silinen veya tarama sırasında kaybolan dosyalar çökmeden atlanır', (t) => {
  if (!hasGit()) {
    t.skip('git bulunamadı')
    return
  }
  const dir = makeProject(t, {
    'src/silinecek.js': 'const a = 1;\n',
    'docs/silinecek.md': 'Burada; noktalı virgül var.\n'
  })
  const run = gitRunner(dir)
  run('init', '-q')
  run('add', '-A')
  fs.rmSync(path.join(dir, 'src', 'silinecek.js'))
  fs.rmSync(path.join(dir, 'docs'), { recursive: true })
  assert.deepEqual(runChecks(dir).violations, [])

  // Klasörün yerini aynı adlı bir dosya almışsa izlenen yol ENOTDIR verir
  fs.writeFileSync(path.join(dir, 'docs'), 'artık bir dosya\n')
  assert.deepEqual(runChecks(dir).violations, [])

  // Listeleme ile okuma arasında silinen dosyalar (paralel düzenleme) sessizce atlanır
  const listed = runChecks(dir, { files: ['src/yok.js', 'docs/silinecek.md', 'server.js', 'public/vendor/ek.js'] })
  assert.deepEqual(listed.violations, [])
  assert.equal(listed.scanned, 1)

  const cli = spawnSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8' })
  assert.equal(cli.status, 0, cli.stdout + cli.stderr)
  assert.match(cli.stdout, /ihlal bulunmadı/)
})

test('komut satırı: hedef klasör parametresi, çıktı biçimi ve çıkış kodları', (t) => {
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' })

  const clean = run(makeProject(t))
  assert.equal(clean.status, 0, clean.stdout + clean.stderr)
  assert.match(clean.stdout, /ihlal bulunmadı/)

  const dirty = run(makeProject(t, {
    'src/a.js': lines('const a = 1', 'const b = 2;'),
    'docs/b.txt': lines('gizli\u200bkarakter')
  }))
  assert.equal(dirty.status, 1, dirty.stdout + dirty.stderr)
  assert.match(dirty.stdout, /^src\/a\.js:2: noktalı virgül/m)
  assert.match(dirty.stdout, /^docs\/b\.txt:1: görünmez veya biçim karakteri var: U\+200B/m)
  assert.match(dirty.stdout, /Denetim başarısız: 2 ihlal, 2 dosyada/)
  assert.match(dirty.stdout, /görünmez karakter: 1/)

  const missing = run(path.join(os.tmpdir(), 'denetle-olmayan-dizin-' + process.pid))
  assert.equal(missing.status, 2)
  assert.match(missing.stderr, /Klasör bulunamadı/)

  const help = run('--yardim')
  assert.equal(help.status, 0)
  assert.match(help.stdout, /Kullanım/)
})

// Kabuk betiği örneği: POSIX sh, noktalı virgül sözdiziminin parçasıdır ve serbesttir
const SHELL_SCRIPT = lines('#!/bin/sh', '# Türkçe açıklama', 'set -eu', 'if [ -n "${PORT:-}" ]; then echo "$PORT"; fi', 'exec node server.js "$@"')

function writeExecutable (dir, rel, content) {
  const file = path.join(dir, ...rel.split('/'))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content)
  fs.chmodSync(file, 0o755)
}

test('kabuk betiklerinde BOM, LF olmayan satır sonu, tire ve görünmez karakter yakalanır', (t) => {
  const dir = makeProject(t)
  writeExecutable(dir, 'iyi.sh', SHELL_SCRIPT)
  writeExecutable(dir, 'bom.sh', '\ufeff' + SHELL_SCRIPT)
  writeExecutable(dir, 'crlf.sh', '#!/bin/sh\r\nset -eu\r\necho tamam\n')
  writeExecutable(dir, 'cr.sh', '#!/bin/sh\nset -eu\recho tamam\n')
  writeExecutable(dir, 'tire.sh', lines('#!/bin/sh', '# açıklama \u2014 burada', 'echo "\u2013"', 'echo "a\u200bb"'))
  const violations = runChecks(dir).violations
  assert.deepEqual(of(violations, 'iyi.sh'), [])
  assert.deepEqual(of(violations, 'bom.sh'), [{ line: 1, rule: 'bom' }])
  assert.match(messageAt(violations, 'bom.sh', 1), /Kabuk betikleri BOM olmadan/)
  assert.deepEqual(of(violations, 'crlf.sh'), [{ line: 1, rule: 'eol' }])
  assert.match(messageAt(violations, 'crlf.sh', 1), /^2 satırda satır sonu LF değil/)
  assert.deepEqual(of(violations, 'cr.sh'), [{ line: 2, rule: 'eol' }])
  assert.deepEqual(of(violations, 'tire.sh'), [{ line: 2, rule: 'dash' }, { line: 3, rule: 'dash' }, { line: 4, rule: 'invisible' }])
  assert.equal(violations.length, 6)
})

test('kabuk betikleri git\'te 100755 kipinde, git dışında çalıştırma izniyle bulunmalıdır', (t) => {
  if (process.platform !== 'win32') {
    // Git dışında (klasör taraması) dosyanın çalıştırma izni denetlenir
    const plain = makeProject(t, { 'izinsiz.sh': SHELL_SCRIPT })
    writeExecutable(plain, 'izinli.sh', SHELL_SCRIPT)
    const walked = runChecks(plain).violations
    assert.deepEqual(of(walked, 'izinsiz.sh'), [{ line: 1, rule: 'mode' }])
    assert.match(messageAt(walked, 'izinsiz.sh', 1), /chmod \+x izinsiz\.sh/)
    assert.deepEqual(of(walked, 'izinli.sh'), [])
  }
  if (!hasGit()) {
    t.skip('git bulunamadı')
    return
  }
  const dir = makeProject(t, { 'normal.sh': SHELL_SCRIPT, 'alt/calisir.sh': SHELL_SCRIPT })
  const run = gitRunner(dir)
  run('init', '-q')
  run('-c', 'core.fileMode=false', 'add', 'normal.sh', 'alt/calisir.sh')
  run('update-index', '--chmod=-x', 'normal.sh')
  run('update-index', '--chmod=+x', 'alt/calisir.sh')
  if (process.platform !== 'win32') fs.chmodSync(path.join(dir, 'normal.sh'), 0o755)
  const violations = runChecks(dir).violations
  // git'te izlenen dosyada dosya sisteminin izni değil, git'teki kip belirleyicidir
  assert.deepEqual(of(violations, 'normal.sh'), [{ line: 1, rule: 'mode' }])
  assert.match(messageAt(violations, 'normal.sh', 1), /git'teki dosya kipi 100644\. .*git update-index --chmod=\+x normal\.sh/)
  assert.deepEqual(of(violations, 'alt/calisir.sh'), [])
  assert.equal(violations.length, 1)
})

test('masaüstü uygulaması: JavaScript ve JSON metin ve noktalı virgülsüz yazım kurallarıyla denetlenir', (t) => {
  const violations = check(t, {
    'desktop/package.json': lines('{', '  "name": "telsiz-masaustu",', '  "description": "Masaüstü \u2014 uygulaması"', '}'),
    'desktop/electron-builder.json': lines('{', '  "appId": "x",', '}'),
    'desktop/src/main.js': lines(
      '\'use strict\'',
      'const { app } = require(\'electron\')',
      'const ayar = globalThis.structuredClone({ a: 1 })',
      'const adres = ayar?.a ?? 0',
      'fetch(\'https://ornek.com\').then((r) => r.ok)',
      'document.body.innerHTML = \'\'',
      'app.whenReady().then(() => adres);'
    ),
    'desktop/src/preload.mjs': lines('import { contextBridge } from \'electron\'', 'contextBridge.exposeInMainWorld(\'telsizDesktop\', {})', '[1, 2].forEach(String)'),
    'desktop/README.md': lines('# Masaüstü', '', 'Derleme; paketleme.'),
    'desktop/README.en.md': lines('# Desktop', '', 'Build and packaging.'),
    // Üretilen dosyalar denetlenmez
    'desktop/app/vendor/x.js': 'var a = 1;\n',
    'desktop/app/index.html': '<script>alert(1)</script>\n',
    'desktop/dist/main.js': 'var b = 2; \u2014\n',
    'desktop/node_modules/electron/index.js': 'var c = 3;\n',
    'dist/telsiz.cjs': 'var d = 4;\n'
  })
  assert.deepEqual(of(violations, 'desktop/package.json'), at('dash', 3))
  assert.deepEqual(of(violations, 'desktop/electron-builder.json'), at('json', 3))
  assert.match(messageAt(violations, 'desktop/electron-builder.json', 3), /^JSON ayrıştırılamadı/)
  // Ana süreç kodu Node.js ve Electron kodudur: güncel sözdizimi ve tarayıcıda yasak adlar serbest
  assert.deepEqual(of(violations, 'desktop/src/main.js'), at('semicolon', 7))
  assert.deepEqual(of(violations, 'desktop/src/preload.mjs'), at('lineStart', 3))
  assert.deepEqual(of(violations, 'desktop/README.md'), at('prose', 3))
  assert.ok(!violations.some((v) => /^(desktop\/(app|dist|node_modules)|dist)\//.test(v.file)), JSON.stringify(violations))
  assert.equal(violations.length, 5)
})

test('JSON dosyaları geçerli JSON olmalıdır', (t) => {
  const violations = check(t, {
    'package.json': lines('{', '  "name": "deneme",', '  "private": true,', '}'),
    'ayarlar/iyi.json': lines('[1, 2, {"a": null}]'),
    'ayarlar/bos.json': ''
  })
  assert.deepEqual(of(violations, 'package.json'), at('json', 4))
  assert.deepEqual(of(violations, 'ayarlar/iyi.json'), [])
  assert.deepEqual(of(violations, 'ayarlar/bos.json'), at('json', 1))
  assert.equal(violations.length, 2)
})

test('CHANGELOG.md ve CHANGELOG.en.md belge eşliği kuralına tabidir', (t) => {
  const missing = check(t, { 'CHANGELOG.md': lines('# Değişiklikler', '', '## 2.0.0', '', 'İlk sürüm.') })
  assert.deepEqual(of(missing, 'CHANGELOG.md'), at('doc-parity', 1))
  assert.match(messageAt(missing, 'CHANGELOG.md', 1), /CHANGELOG\.en\.md bulunamadı/)
  const uneven = check(t, {
    'CHANGELOG.md': lines('# Değişiklikler', '', '## 2.0.0', '', '## 1.0.0'),
    'CHANGELOG.en.md': lines('# Changelog', '', '## 2.0.0')
  })
  assert.deepEqual(of(uneven, 'CHANGELOG.en.md'), at('doc-parity', 1))
  const paired = check(t, {
    'CHANGELOG.md': lines('# Değişiklikler', '', '## 2.0.0'),
    'CHANGELOG.en.md': lines('# Changelog', '', '## 2.0.0')
  })
  assert.deepEqual(paired, [])
})
