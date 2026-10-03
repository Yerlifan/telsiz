'use strict'

// Toplayıcı (scripts/paketle.js): göreli require ve node: yerleşik modülleri tek dosyada toplar,
// desteklenmeyen her kullanımda hata verir. Üretilen paket node ile çalıştırılarak CommonJS
// davranışı (exports, module.exports, döngüsel bağımlılık, önbellek, require.main, __dirname)
// doğrulanır. Gerçek sunucu kodunun da toplanabildiği ve paketin çalıştığı denetlenir.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { bundle, BundleError } = require('../scripts/paketle')

const ROOT = path.join(__dirname, '..')

function project (t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-paket-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  for (const name of Object.keys(files)) {
    const file = path.join(dir, ...name.split('/'))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, files[name])
  }
  return dir
}

function lines (...rows) {
  return rows.join('\n') + '\n'
}

// Paketi bir dosyaya yazar ve node ile çalıştırır
function runBundle (dir, code, args) {
  const out = path.join(dir, 'cikti', 'paket.cjs')
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, code)
  return spawnSync(process.execPath, [out].concat(args || []), { encoding: 'utf8', cwd: dir })
}

function rejects (t, files, pattern, entry) {
  const dir = project(t, files)
  assert.throws(() => bundle(path.join(dir, entry || 'giris.js')), (err) => {
    assert.ok(err instanceof BundleError, String(err))
    assert.match(err.message, pattern)
    return true
  })
}

describe('toplayıcı: desteklenen kullanımlar', () => {
  it('göreli modüller, yerleşik modüller, döngüsel bağımlılık, önbellek, require.main ve __dirname', (t) => {
    const dir = project(t, {
      'giris.js': lines(
        '#!/usr/bin/env node',
        '\'use strict\'',
        'const path = require(\'node:path\')',
        'const a = require(\'./lib/a\')',
        'const again = require(\'./lib/a.js\')',
        'const klasor = require(\'./lib/klasor\')',
        'const sablon = require(`./lib/b`)',
        'console.log(JSON.stringify({',
        '  a: a.ad, b: a.b(), ayni: a === again, klasor: klasor.ad, sablon: sablon.ad,',
        '  ana: require.main === module, altAna: a.anaMi, dongu: sablon.aGorulen,',
        '  dirname: path.relative(path.join(__dirname, \'..\'), a.dirname).split(path.sep).join(\'/\'),',
        '  filename: path.basename(a.filename), arguman: process.argv[2] || null,',
        '  strict: (function () { return this })() === undefined',
        '}))'
      ),
      'lib/a.js': lines(
        '\'use strict\'',
        'exports.ad = \'a\'',
        'const b = require(\'./b\')',
        'exports.b = () => b.ad',
        'exports.anaMi = require.main === module',
        'exports.dirname = __dirname',
        'exports.filename = __filename'
      ),
      'lib/b.js': lines(
        '\'use strict\'',
        '// Döngü: a yüklenirken b, a\'nın o ana kadarki dışa aktarımlarını görür',
        'const a = require(\'./a\')',
        'module.exports = { ad: \'b\', aGorulen: a.ad }'
      ),
      'lib/klasor/index.js': 'module.exports = { ad: \'klasor\' }\n'
    })
    const result = bundle(path.join(dir, 'giris.js'))
    assert.deepEqual(result.modules, ['giris.js', 'lib/a.js', 'lib/b.js', 'lib/klasor/index.js'])
    assert.deepEqual(result.builtins, ['node:path'])
    assert.equal(result.entry, 'giris.js')
    assert.ok(!result.code.includes('#!/usr/bin/env node'))
    // Aynı girdi her zaman aynı paketi üretir
    assert.equal(bundle(path.join(dir, 'giris.js')).code, result.code)
    const run = runBundle(dir, result.code, ['deneme'])
    assert.equal(run.status, 0, run.stderr)
    assert.deepEqual(JSON.parse(run.stdout), {
      a: 'a',
      b: 'b',
      ayni: true,
      klasor: 'klasor',
      sablon: 'b',
      ana: true,
      altAna: false,
      dongu: 'a',
      dirname: 'cikti/lib',
      filename: 'a.js',
      arguman: 'deneme',
      strict: true
    })
  })

  it('gerçek sunucu kodu toplanır: server.js ve src/*.js, yalnızca node: modülleri, paket çalışır', (t) => {
    const result = bundle(path.join(ROOT, 'server.js'), { root: ROOT, banner: 'deneme' })
    assert.equal(result.entry, 'server.js')
    assert.equal(result.modules[0], 'server.js')
    for (const id of result.modules.slice(1)) assert.match(id, /^src\/[a-z0-9-]+\.js$/)
    for (const name of ['src/app.js', 'src/store.js', 'src/runtime.js', 'src/static-source.js', 'src/env-file.js']) {
      assert.ok(result.modules.includes(name), name)
    }
    assert.ok(result.builtins.every((b) => b.startsWith('node:')))
    assert.ok(result.builtins.includes('node:sea'))
    const dir = project(t, {})
    const usage = runBundle(dir, result.code, ['bilinmeyen-komut'])
    assert.equal(usage.status, 1)
    assert.match(usage.stderr, /sifre-sifirla/)
    assert.match(usage.stderr, /reset-password/)
  })
})

describe('toplayıcı: desteklenmeyen kullanımlar hata verir', () => {
  it('öneksiz yerleşik modül ve paket adı', (t) => {
    rejects(t, { 'giris.js': 'require(\'fs\')\n' }, /giris\.js:1: "fs" yerine "node:fs" yazın/)
    rejects(t, { 'giris.js': 'require(\'acorn\')\n' }, /"acorn" desteklenmez/)
    rejects(t, { 'giris.js': 'require(\'node:olmayan\')\n' }, /bilinen bir Node\.js yerleşik modülü değil/)
    rejects(t, { 'giris.js': 'require(\'/mutlak/yol.js\')\n' }, /desteklenmez/)
  })

  it('değişkenle, birden çok argümanla veya şablon ifadesiyle require', (t) => {
    rejects(t, { 'giris.js': 'const ad = \'./a\'\nrequire(ad)\n' }, /giris\.js:2: require yalnızca tek bir sabit dizeyle/)
    rejects(t, { 'giris.js': 'require(\'./a\', 1)\n', 'a.js': '' }, /tek bir sabit dizeyle/)
    rejects(t, { 'giris.js': 'const x = \'a\'\nrequire(`./${x}`)\n' }, /tek bir sabit dizeyle/)
    rejects(t, { 'giris.js': 'require()\n' }, /tek bir sabit dizeyle/)
  })

  it('require ve module özellikleri, require değer olarak', (t) => {
    rejects(t, { 'giris.js': 'require.resolve(\'./a\')\n' }, /require\.resolve desteklenmez/)
    rejects(t, { 'giris.js': 'delete require.cache[\'x\']\n' }, /require\.cache desteklenmez/)
    rejects(t, { 'giris.js': 'const r = require\n' }, /doğrudan çağrılabilir/)
    rejects(t, { 'giris.js': 'const o = { require }\n' }, /doğrudan çağrılabilir/)
    rejects(t, { 'giris.js': 'module.require(\'./a\')\n' }, /module\.require desteklenmez/)
    rejects(t, { 'giris.js': 'console.log(module.paths)\n' }, /module\.paths desteklenmez/)
    rejects(t, { 'giris.js': 'const m = module\n' }, /module yalnızca/)
  })

  it('ES modülleri ve import()', (t) => {
    rejects(t, { 'giris.js': 'import fs from \'node:fs\'\n' }, /ayrıştırılamadı.*Yalnızca CommonJS/)
    rejects(t, { 'giris.js': 'import(\'./a.js\')\n' }, /import\(\) desteklenmez/)
    rejects(t, { 'giris.js': 'console.log(import.meta)\n' }, /ayrıştırılamadı|import\.meta desteklenmez/)
  })

  it('JSON, başka uzantılar, bulunamayan dosya ve kök klasör dışı', (t) => {
    rejects(t, { 'giris.js': 'require(\'./veri.json\')\n', 'veri.json': '{}' }, /JSON dosyaları desteklenmez/)
    rejects(t, { 'giris.js': 'require(\'./eklenti.node\')\n' }, /yalnızca \.js ve \.cjs/)
    rejects(t, { 'giris.js': 'require(\'./yok\')\n' }, /"\.\/yok" bulunamadı/)
    rejects(t, { 'alt/giris.js': 'require(\'../disarida\')\n', 'disarida.js': '' }, /kök klasörün .* dışında/, 'alt/giris.js')
    rejects(t, { 'giris.js': 'require(\'./a\')\n', 'a.js': 'require(\'fs\')\n' }, /a\.js:1: "fs" yerine "node:fs"/)
  })

  it('komut satırı: yanlış kullanım 2, hata 1, başarı 0', (t) => {
    const script = path.join(ROOT, 'scripts', 'paketle.js')
    const usage = spawnSync(process.execPath, [script], { encoding: 'utf8' })
    assert.equal(usage.status, 2)
    assert.match(usage.stderr, /Kullanım/)
    const dir = project(t, { 'giris.js': 'require(\'fs\')\n', 'iyi.js': 'console.log(require(\'node:os\').EOL.length)\n' })
    const bad = spawnSync(process.execPath, [script, path.join(dir, 'giris.js'), path.join(dir, 'out.cjs')], { encoding: 'utf8' })
    assert.equal(bad.status, 1)
    assert.match(bad.stderr, /Paketleme başarısız/)
    assert.ok(!fs.existsSync(path.join(dir, 'out.cjs')))
    const good = spawnSync(process.execPath, [script, path.join(dir, 'iyi.js'), path.join(dir, 'out', 'iyi.cjs')], { encoding: 'utf8' })
    assert.equal(good.status, 0, good.stderr)
    const run = spawnSync(process.execPath, [path.join(dir, 'out', 'iyi.cjs')], { encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr)
    assert.match(run.stdout, /^[12]\n$/)
  })
})
