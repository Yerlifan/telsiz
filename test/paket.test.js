'use strict'

// npm paketi: package.json alanları (ad, sürüm, açıklama, anahtar sözcükler, bin, files,
// publishConfig, depo adresleri), server.js'in çalıştırılabilir giriş satırı ve npm pack
// içeriği (yalnızca çalışma zamanı dosyaları, testler, betikler, belgeler ve veri yok).

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const ROOT = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const REPO = 'https://github.com/Yerlifan/telsiz'

// npm komutu: npm run ile çalışırken npm_execpath, yoksa kabuk üzerinden npm
function npm (args) {
  const execPath = process.env.npm_execpath
  const options = { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true }
  if (execPath && /\.c?js$/.test(execPath)) return spawnSync(process.execPath, [execPath].concat(args), options)
  return spawnSync('npm', args, Object.assign({ shell: process.platform === 'win32' }, options))
}

describe('package.json', () => {
  it('paket bilgileri', () => {
    assert.equal(pkg.name, 'telsiz')
    assert.equal(pkg.version, '2.2.0')
    assert.equal(pkg.private, undefined)
    assert.equal(pkg.description, 'Kendi sunucunuzda çalışan, uçtan uca şifreli, açık kaynak yazılı ve sesli iletişim sistemi.')
    assert.deepEqual(pkg.keywords, ['telsiz', 'chat', 'voice-chat', 'e2ee', 'end-to-end-encryption', 'webrtc', 'self-hosted', 'pwa', 'privacy', 'open-source'])
    assert.equal(pkg.license, 'MIT')
    assert.equal(pkg.author, 'Burak Aslancan Pak')
    assert.deepEqual(pkg.bin, { telsiz: 'server.js' })
    assert.deepEqual(pkg.files, ['server.js', 'src/', 'public/', 'LICENSE', 'README.md', 'README.en.md', 'SECURITY.md'])
    assert.deepEqual(pkg.publishConfig, { access: 'public', provenance: true })
    assert.equal(pkg.homepage, REPO + '#readme')
    assert.deepEqual(pkg.bugs, { url: REPO + '/issues' })
    assert.deepEqual(pkg.repository, { type: 'git', url: 'git+' + REPO + '.git' })
    assert.equal(pkg.engines.node, '>=20')
    // Çalışma zamanı bağımlılığı yoktur, geliştirme araçlarının sürümleri sabittir
    assert.equal(pkg.dependencies, undefined)
    for (const name of Object.keys(pkg.devDependencies)) assert.match(pkg.devDependencies[name], /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/, name)
    assert.equal(pkg.devDependencies.postject, '1.0.0-alpha.6')
  })

  it('kilit dosyası package.json ile uyumlu', () => {
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'))
    assert.equal(lock.name, pkg.name)
    assert.equal(lock.version, pkg.version)
    const root = lock.packages['']
    assert.equal(root.name, pkg.name)
    assert.deepEqual(root.bin, pkg.bin)
    assert.deepEqual(root.devDependencies, pkg.devDependencies)
    assert.equal(root.dependencies, undefined)
    for (const name of Object.keys(pkg.devDependencies)) {
      assert.equal(lock.packages['node_modules/' + name].version, pkg.devDependencies[name], name)
    }
  })

  it('server.js npx ile çalıştırılabilir: ilk satır #!/usr/bin/env node, LF satır sonu', () => {
    const text = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8')
    assert.ok(text.startsWith('#!/usr/bin/env node\n\'use strict\'\n'))
    assert.ok(!text.includes('\r'))
  })
})

describe('npm pack içeriği', () => {
  it('yalnızca çalışma zamanı dosyaları pakete girer', (t) => {
    const result = npm(['pack', '--dry-run', '--json', '--ignore-scripts'])
    if (result.error || (result.status !== 0 && /not found|ENOENT|not recognized/i.test(String(result.stderr) + String(result.error)))) {
      t.skip('npm bulunamadı')
      return
    }
    assert.equal(result.status, 0, result.stderr)
    const list = JSON.parse(result.stdout.slice(result.stdout.indexOf('[')))
    assert.equal(list.length, 1)
    assert.equal(list[0].name, 'telsiz')
    assert.equal(list[0].version, pkg.version)
    const files = list[0].files.map((f) => f.path).sort()
    const allowed = /^(server\.js|package\.json|LICENSE|README(\.en)?\.md|SECURITY\.md|src\/[a-z0-9-]+\.js|public\/.+)$/
    for (const file of files) assert.match(file, allowed, file)
    for (const required of ['server.js', 'package.json', 'LICENSE', 'src/app.js', 'src/store.js', 'src/runtime.js', 'src/static-source.js', 'src/env-file.js', 'public/index.html', 'public/vendor/nacl-fast.min.js']) {
      assert.ok(files.includes(required), required)
    }
    // public/ altındaki her dosya pakette (arayüz dosyaları sabit listeyle yazılmaz)
    const { collectPublicFiles } = require('../scripts/sea-derle')
    for (const file of collectPublicFiles(path.join(ROOT, 'public'))) assert.ok(files.includes('public/' + file.rel), file.rel)
    for (const forbidden of [/^test\//, /^scripts\//, /^docs\//, /^e2e\//, /^desktop\//, /^deploy\//, /^\.github\//, /^dist\//, /^veri\//, /node_modules/, /\.bat$/, /\.sh$/, /^Dockerfile$/]) {
      assert.ok(!files.some((f) => forbidden.test(f)), String(forbidden))
    }
    const bin = list[0].files.find((f) => f.path === 'server.js')
    assert.ok(bin)
  })
})
