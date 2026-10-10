'use strict'

// Tema belirteçleri (public/css/tokens.css) testleri. Her tema (theme-init.js içindeki tema listesi) ve
// mod (koyu, açık) bileşiminde kök öğede geçerli olan belirteçler CSS kademesiyle hesaplanır: :root ile
// başlayan kurallar özgüllük ve kaynak sırasıyla uygulanır, var() başvuruları çözülür. @media içindeki
// kurallar renk tanımlamadığı için dışarıda kalır. Kenar belirteçleri (--live-edge, --danger-edge) ortak
// CSS'te geri dönüş değeri olmadan kullanılır. Tanımsız kalırsa border kısaltması geçersiz sayılır ve kenar
// hiç çizilmez, bu yüzden her bileşimde tanımlı olmaları ve bileşen kenarı için 3:1 kontrast vermeleri
// denetlenir. Gerçek tarayıcıdaki sonuç e2e/03-sosyal.test.js içinde ölçülür.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const PUB = path.join(__dirname, '..', 'public')
const TOKENS = fs.readFileSync(path.join(PUB, 'css', 'tokens.css'), 'utf8')
const SCHEMES = ['dark', 'light']
const EDGES = [['--live-edge', '--live-bg'], ['--danger-edge', '--danger-bg']]
// Bileşenlerin üzerinde durduğu yüzeyler, docs/TASARIM.md kontrast tablosuyla aynı küme
const SURFACES = ['--bg', '--surface-1', '--surface-2', '--surface-3', '--surface-alt', '--surface-sunken', '--surface-hover', '--surface-active', '--surface-float']

// theme-init.js küçük bir tarayıcı taklidinde çalıştırılır, tema listesi window.TelsizTheme.skins olur
function loadSkins () {
  const root = { setAttribute () {}, style: { setProperty () {} }, classList: { add () {} } }
  const storage = { getItem: () => null, setItem () {} }
  const sandbox = { document: { documentElement: root }, localStorage: storage }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.join(PUB, 'theme-init.js'), 'utf8'), sandbox, { filename: 'theme-init.js' })
  return sandbox.window.TelsizTheme.skins.slice()
}

// Yorumları çıkarır, kuralları { selectors, decls, body, order, inAt } olarak döndürür. @media ve @supports
// gibi @ kurallarının içindeki kurallar inAt ile işaretlenir, kademe hesabı yalnızca en üst düzeyi kullanır.
function parseRules (css) {
  const rules = []
  const walkText = (text, inAt) => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      if (open === -1) break
      const prelude = text.slice(i, open).trim()
      let depth = 1
      let j = open + 1
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++
        else if (text[j] === '}') depth--
        j++
      }
      const body = text.slice(open + 1, j - 1)
      if (prelude.charAt(0) === '@') {
        walkText(body, true)
      } else {
        const decls = {}
        for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) decls[m[1]] = m[2].trim()
        rules.push({ selectors: prelude.split(',').map((s) => s.trim()), decls, body, order: rules.length, inAt })
      }
      i = j
    }
  }
  walkText(css.replace(/\/\*[\s\S]*?\*\//g, ''), false)
  return rules
}

// Seçici kök öğeye uyuyorsa özgüllüğünü (öznitelik sayısı ve :root), uymuyorsa -1 döndürür
function rootSpecificity (selector, attrs) {
  const m = /^:root((?:\[[\w-]+="[^"]*"\])*)$/.exec(selector)
  if (!m) return -1
  let count = 1
  for (const a of m[1].matchAll(/\[([\w-]+)="([^"]*)"\]/g)) {
    if (attrs[a[1]] !== a[2]) return -1
    count++
  }
  return count
}

function cascade (rules, attrs) {
  const applied = []
  for (const rule of rules) {
    if (rule.inAt) continue
    const spec = Math.max.apply(null, rule.selectors.map((s) => rootSpecificity(s, attrs)))
    if (spec >= 0) applied.push({ spec, rule })
  }
  applied.sort((a, b) => a.spec - b.spec || a.rule.order - b.rule.order)
  const vars = {}
  for (const item of applied) Object.assign(vars, item.rule.decls)
  return vars
}

// var() başvurularını çözer, çözülemezse null
function resolve (vars, name, depth) {
  if ((depth || 0) > 20 || vars[name] === undefined) return null
  const value = vars[name]
  const ref = /^var\((--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(value)
  if (!ref) return value
  const inner = resolve(vars, ref[1], (depth || 0) + 1)
  if (inner !== null) return inner
  return ref[2] === undefined ? null : ref[2].trim()
}

// Belirtecin bir temanın kendi bloklarında (yalnızca :root olmayan, data-skin içeren) açıkça yazıldığını denetler
function ownDecl (rules, skin, scheme, name) {
  return rules.some((rule) => rule.decls[name] !== undefined && rule.selectors.some((s) => {
    return s.indexOf('[data-skin="' + skin + '"]') !== -1 && rootSpecificity(s, { 'data-skin': skin, 'data-scheme': scheme }) >= 0
  }))
}

function parseColor (value) {
  const v = String(value).trim()
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v)
  if (m) {
    const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 }
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v)
  if (m) return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) }
  return null
}

// Yarı saydam rengi zeminin üstüne bindirir
function over (fg, bg) {
  if (fg.a >= 1) return fg
  return { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 }
}

// WCAG 2.x göreli parlaklık ve kontrast oranı
function luminance (c) {
  const ch = (x) => {
    const s = x / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b)
}

function contrast (a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

const RULES = parseRules(TOKENS)
const SKINS = loadSkins()

function combos () {
  const out = []
  for (const skin of SKINS) {
    for (const scheme of SCHEMES) out.push({ skin, scheme, vars: cascade(RULES, { 'data-skin': skin, 'data-scheme': scheme }) })
  }
  return out
}

test('tema listesi okunur ve her tema için tokens.css içinde koyu ve açık blok var', () => {
  assert.ok(SKINS.length >= 3, 'en az üç tema')
  assert.ok(SKINS.indexOf('arcade') !== -1)
  for (const skin of SKINS) {
    for (const scheme of SCHEMES) {
      const has = RULES.some((rule) => rule.selectors.indexOf(':root[data-skin="' + skin + '"][data-scheme="' + scheme + '"]') !== -1)
      assert.ok(has, skin + ' ' + scheme + ' bloğu')
    }
  }
})

test('kenar belirteçleri (--live-edge, --danger-edge) her tema ve modda çözülür ve temanın kendi bloğunda yazılıdır', () => {
  for (const c of combos()) {
    for (const pair of EDGES) {
      const value = resolve(c.vars, pair[0])
      assert.ok(value !== null, c.skin + ' ' + c.scheme + ': ' + pair[0] + ' tanımsız')
      assert.ok(parseColor(value), c.skin + ' ' + c.scheme + ': ' + pair[0] + ' renk değil: ' + value)
      // Eksik belirteç Arcade koyunun :root değerine düşer, açık modda yanlış ton verir
      assert.ok(ownDecl(RULES, c.skin, c.scheme, pair[0]), c.skin + ' ' + c.scheme + ': ' + pair[0] + ' temanın kendi bloğunda yok')
    }
  }
})

test('kenar belirteçleri her yüzeyde ve kendi saydam zemininde en az 3:1 kontrast verir', () => {
  for (const c of combos()) {
    const color = (name) => {
      const parsed = parseColor(resolve(c.vars, name))
      assert.ok(parsed, c.skin + ' ' + c.scheme + ': ' + name + ' renk değil')
      return parsed
    }
    const bg = color('--bg')
    const surfaces = SURFACES.map((name) => over(color(name), bg))
    for (const pair of EDGES) {
      const edge = color(pair[0])
      const backs = surfaces.concat(surfaces.map((s) => over(color(pair[1]), s)))
      const lowest = Math.min.apply(null, backs.map((b) => contrast(edge, b)))
      assert.ok(lowest >= 3, c.skin + ' ' + c.scheme + ': ' + pair[0] + ' en düşük kontrast ' + lowest.toFixed(2))
    }
  }
})

test('ortak CSS ve tema dosyalarında geri dönüşsüz kullanılan her belirteç ilgili tema ve modlarda çözülür', () => {
  // Bulgu A'nın sınıfı: yalnızca bir temada tanımlı belirteç ortak CSS'te var(--x) olarak, geri dönüş değeri
  // olmadan kullanılırsa öteki temalarda bildirim geçersiz olur. Bir temaya bağlı kurallar (seçicilerin hepsi
  // data-skin içerir) yalnızca o temada aranır. tokens.css dışında tanımlanan bileşen değişkenleri atlanır.
  const defined = new Set()
  RULES.forEach((rule) => Object.keys(rule.decls).forEach((name) => defined.add(name)))
  const all = combos()
  const dir = path.join(PUB, 'css')
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => path.join(dir, f))
    .concat(fs.readdirSync(path.join(dir, 'skins')).filter((f) => f.endsWith('.css')).map((f) => path.join(dir, 'skins', f)))
  let checked = 0
  for (const file of files) {
    for (const rule of parseRules(fs.readFileSync(file, 'utf8'))) {
      const skins = rule.selectors.map((s) => {
        const m = /\[data-skin="([\w-]+)"\]/.exec(s)
        return m ? m[1] : null
      })
      const scoped = skins.every((skin) => skin !== null)
      const targets = scoped ? all.filter((c) => skins.indexOf(c.skin) !== -1) : all
      for (const m of rule.body.matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        if (!defined.has(m[1])) continue
        checked++
        for (const c of targets) {
          assert.ok(resolve(c.vars, m[1]) !== null, path.basename(file) + ' ' + rule.selectors.join(', ') + ': ' + m[1] + ' ' + c.skin + ' ' + c.scheme + ' içinde tanımsız')
        }
      }
    }
  }
  assert.ok(checked > 100, 'en az 100 belirteç kullanımı denetlenmeli: ' + checked)
})

test('kademe yardımcısı: özgül blok genel bloğu ezer, uymayan öznitelik uygulanmaz, var() geri dönüşü çalışır', () => {
  const rules = parseRules([
    ':root { --a: #000; --c: var(--b, #111); }',
    '@media (min-width: 10px) { :root { --a: #222; } }',
    ':root[data-skin="x"][data-scheme="light"] { --a: #fff; }',
    ':root[data-skin="x"] { --a: #333; }',
    ':root[data-skin="y"] { --b: var(--a); }'
  ].join('\n'))
  assert.equal(rules.length, 5)
  assert.ok(rules[1].inAt)
  const light = cascade(rules, { 'data-skin': 'x', 'data-scheme': 'light' })
  assert.equal(light['--a'], '#fff')
  assert.equal(resolve(light, '--c'), '#111')
  const dark = cascade(rules, { 'data-skin': 'x', 'data-scheme': 'dark' })
  assert.equal(dark['--a'], '#333')
  const y = cascade(rules, { 'data-skin': 'y', 'data-scheme': 'dark' })
  assert.equal(resolve(y, '--c'), '#000')
  assert.ok(contrast(parseColor('#000'), parseColor('#fff')) > 20.9)
  assert.equal(Math.round(contrast(parseColor('#777'), parseColor('#fff')) * 100) / 100, 4.48)
})
