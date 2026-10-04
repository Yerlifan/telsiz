'use strict'

// Sürüm notları (scripts/surum-notlari.js): CHANGELOG bölümünün çıkarılması ve depodaki
// CHANGELOG.md ile CHANGELOG.en.md dosyalarında package.json sürümünün bölümünün bulunması.
// Sürüm iş akışı (release.yml) GitHub Release notlarını bu betikle üretir.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { extractSection, releaseNotes } = require('../scripts/surum-notlari')

const ROOT = path.join(__dirname, '..')
const SCRIPT = path.join(ROOT, 'scripts', 'surum-notlari.js')

function lines (...rows) {
  return rows.join('\n') + '\n'
}

describe('sürüm notları', () => {
  it('bölüm başlıktan bir sonraki ## başlığına kadar alınır, kod blokları içindeki başlıklar sayılmaz', () => {
    const text = lines(
      '# Değişiklik günlüğü',
      '',
      '## [2.1.0] - 2026-11-01',
      '',
      '- Yeni özellik',
      '',
      '## [2.0.0-beta.1]',
      '',
      '- Deneme',
      '',
      '## [2.0.0] - 2026-10-03',
      '',
      '### Özellikler',
      '',
      '- Bir',
      '```md',
      '## Bu başlık değil',
      '```',
      '- İki',
      '',
      '## 1.0.0',
      '',
      '- Eski'
    )
    assert.equal(extractSection(text, '2.0.0'), lines('### Özellikler', '', '- Bir', '```md', '## Bu başlık değil', '```', '- İki').trim())
    assert.equal(extractSection(text, '2.1.0'), '- Yeni özellik')
    assert.equal(extractSection(text, '2.0.0-beta.1'), '- Deneme')
    assert.equal(extractSection(text, '1.0.0'), '- Eski')
    assert.equal(extractSection(text, '2.0'), null)
    assert.equal(extractSection(text, '3.0.0'), null)
    assert.equal(extractSection(lines('## 4.0.0', '', '## 3.0.0'), '4.0.0'), null)
    assert.equal(extractSection('## 5.0.0\r\n\r\nSatır\r\n', '5.0.0'), 'Satır')
  })

  it('iki dilin bölümleri ayırıcıyla birleştirilir, biri eksikse hata verir', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-notlar-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), lines('# Günlük', '', '## [1.2.3]', '', 'Türkçe not'))
    fs.writeFileSync(path.join(dir, 'CHANGELOG.en.md'), lines('# Changelog', '', '## [1.2.3]', '', 'English note'))
    assert.deepEqual(releaseNotes(dir, '1.2.3'), { notes: 'Türkçe not\n\n---\n\nEnglish note\n' })
    assert.match(releaseNotes(dir, '1.2.4').error, /CHANGELOG\.md dosyasında 1\.2\.4/)
    fs.writeFileSync(path.join(dir, 'CHANGELOG.en.md'), lines('# Changelog', '', '## [1.2.3]', ''))
    assert.match(releaseNotes(dir, '1.2.3').error, /CHANGELOG\.en\.md dosyasında 1\.2\.3 sürümünün bölümü yok veya boş/)
    fs.rmSync(path.join(dir, 'CHANGELOG.en.md'))
    assert.match(releaseNotes(dir, '1.2.3').error, /CHANGELOG\.en\.md okunamadı/)
  })

  it('depodaki CHANGELOG dosyalarında package.json sürümünün bölümü iki dilde de var', () => {
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
    const result = spawnSync(process.execPath, [SCRIPT, version], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    const parts = result.stdout.split('\n\n---\n\n')
    assert.equal(parts.length, 2)
    // İki dildeki alt başlık ve madde sayıları eşit
    const count = (text, re) => (text.match(re) || []).length
    assert.equal(count(parts[0], /^### /gm), count(parts[1], /^### /gm))
    assert.equal(count(parts[0], /^- /gm), count(parts[1], /^- /gm))
    assert.ok(count(parts[0], /^- /gm) > 0)
    const usage = spawnSync(process.execPath, [SCRIPT, 'v2'], { encoding: 'utf8' })
    assert.equal(usage.status, 2)
  })
})
