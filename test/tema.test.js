'use strict'

// Tema belirteçleri (public/css/tokens.css), tema kaydı ve temaya özgü süs dosyaları (public/css/skins/) testleri.
// Her tema (theme-init.js içindeki tema listesi) ve mod (koyu, açık) bileşiminde kök öğede geçerli olan belirteçler
// CSS kademesiyle hesaplanır (scripts/kontrast.js): :root ile başlayan kurallar özgüllük ve kaynak sırasıyla
// uygulanır, var() başvuruları çözülür. @media içindeki kurallar renk tanımlamadığı için dışarıda kalır.
// Denetlenenler:
// - her temanın üç bloğu var (biçim, koyu, açık) ve Arcade'in tanımladığı her belirteci kendi bloklarında yazar
//   (eksik belirteç Arcade koyu değerine düşer, açık modda yanlış ton verir)
// - WCAG 2.x kontrastı: metin 4.5:1, Yüksek Kontrast temasında 7:1, arayüz bileşeni 3:1, dokuz yüzeyin hepsinde
// - kenar belirteçleri (--live-edge, --danger-edge) ortak CSS'te geri dönüş değeri olmadan kullanılır. Tanımsız
//   kalırsa border kısaltması geçersiz sayılır ve kenar hiç çizilmez, gerçek tarayıcıdaki sonuç e2e/03-sosyal.test.js
//   içinde ölçülür
// - ton belirteçleri (--tone-*) her temada çözülür, telsiz kartı düğmeleri bunları kullanır
// - her tema index.html, sw.js, i18n ve önizleme renkleriyle kayıtlıdır, süs dosyası yalnızca kendi temasında
//   uygulanır ve eski WebKit kurallarına uyar

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const K = require('../scripts/kontrast.js')

const PUB = path.join(__dirname, '..', 'public')
const TOKENS = fs.readFileSync(path.join(PUB, 'css', 'tokens.css'), 'utf8')
const SCHEMES = K.SCHEMES
const EDGES = [['--live-edge', '--live-bg'], ['--danger-edge', '--danger-bg']]
const SURFACES = K.SURFACES
const { parseRules, rootSpecificity, cascade, resolve, ownDecl, parseColor, over, contrast } = K

const RULES = parseRules(TOKENS)
const SKINS = K.loadSkins(PUB)

function combos () {
  const out = []
  for (const skin of SKINS) {
    for (const scheme of SCHEMES) out.push({ skin, scheme, vars: cascade(RULES, { 'data-skin': skin, 'data-scheme': scheme }) })
  }
  return out
}

// i18n.js küçük bir tarayıcı taklidinde yüklenir, iki dilin sözlüğü döner
function loadMessages () {
  const sandbox = {
    console: { warn () {}, log () {}, error () {} },
    navigator: { languages: ['tr-TR'], language: 'tr-TR' },
    document: { documentElement: { lang: 'tr' } },
    localStorage: { getItem: () => null, setItem () {}, removeItem () {} }
  }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.join(PUB, 'i18n.js'), 'utf8'), sandbox, { filename: 'i18n.js' })
  return sandbox.window.I18N.messages
}

// Süs dosyasının kuralları: { selectors, body, atRules } (atRules içinde bulunduğu @ kurallarının başlıkları).
// @keyframes içindeki adımlar (0%, from) seçici değildir, atlanır.
function skinRules (css) {
  const out = []
  const walk = (text, atRules) => {
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
        if (!/keyframes/.test(prelude)) walk(body, atRules.concat([prelude]))
      } else {
        out.push({ selectors: prelude.split(',').map((s) => s.trim()), body, atRules })
      }
      i = j
    }
  }
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), [])
  return out
}

test('tema listesi okunur ve her tema için tokens.css içinde biçim, koyu ve açık blok var', () => {
  assert.ok(SKINS.length >= 3, 'en az üç tema')
  assert.equal(SKINS[0], 'arcade', 'varsayılan tema Arcade listenin başında')
  assert.equal(new Set(SKINS).size, SKINS.length, 'tema kimlikleri tekil')
  for (const skin of SKINS) {
    assert.ok(/^[a-z]+$/.test(skin), 'tema kimliği küçük harf: ' + skin)
    const own = RULES.some((rule) => rule.selectors.indexOf(':root[data-skin="' + skin + '"]') !== -1)
    assert.ok(own, skin + ' biçim bloğu')
    for (const scheme of SCHEMES) {
      const has = RULES.some((rule) => rule.selectors.indexOf(':root[data-skin="' + skin + '"][data-scheme="' + scheme + '"]') !== -1)
      assert.ok(has, skin + ' ' + scheme + ' bloğu')
    }
  }
})

test('Arcade biçim ve koyu bloğundaki her belirteç her temanın kendi bloklarında yazılıdır', () => {
  const arcade = RULES.filter((rule) => rule.selectors.indexOf(':root[data-skin="arcade"]') !== -1 || rule.selectors.indexOf(':root[data-skin="arcade"][data-scheme="dark"]') !== -1)
  const names = new Set()
  arcade.forEach((rule) => Object.keys(rule.decls).forEach((name) => names.add(name)))
  assert.ok(names.size > 80, 'Arcade belirteçleri okunur: ' + names.size)
  for (const skin of SKINS) {
    for (const scheme of SCHEMES) {
      const missing = Array.from(names).filter((name) => !ownDecl(RULES, skin, scheme, name))
      assert.deepEqual(missing, [], skin + ' ' + scheme + ' kendi bloklarında eksik belirteçler')
    }
  }
})

test('WCAG kontrastı: her tema ve modda metin 4.5:1 (Yüksek Kontrast 7:1) ve bileşen 3:1 eşiğini geçer', () => {
  const below = []
  let count = 0
  for (const c of combos()) {
    for (const r of K.measure(c.vars)) {
      count++
      const limit = K.threshold(c.skin, r.kind)
      if (!(r.value >= limit)) below.push(c.skin + ' ' + c.scheme + ': ' + r.tr + ' ' + r.value.toFixed(2) + ' < ' + limit)
    }
  }
  assert.deepEqual(below, [], 'eşik altındaki çiftler')
  assert.ok(count >= SKINS.length * 2 * 25, 'her bileşimde en az 25 rol ölçülür: ' + count)
})

test('kenar belirteçleri (--live-edge, --danger-edge) her tema ve modda çözülür ve temanın kendi bloğunda yazılıdır', () => {
  for (const c of combos()) {
    for (const pair of EDGES) {
      const value = resolve(c.vars, pair[0])
      assert.ok(value !== null, c.skin + ' ' + c.scheme + ': ' + pair[0] + ' tanımsız')
      assert.ok(parseColor(value), c.skin + ' ' + c.scheme + ': ' + pair[0] + ' renk değil: ' + value)
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

test('ton belirteçleri (--tone-*) her temada çözülür, varsayılanları rol renkleri, telsiz kartı düğmeleri bunları kullanır', () => {
  const defaults = { camera: 'blue', mic: 'green', deafen: 'purple', screen: 'orange' }
  const root = RULES.find((rule) => rule.selectors.length === 1 && rule.selectors[0] === ':root' && rule.decls['--tone-camera'] !== undefined)
  assert.ok(root, 'tonlar :root bloğunda')
  for (const tone of K.TONES) assert.equal(root.decls['--tone-' + tone], 'var(--role-' + defaults[tone] + ')', tone + ' varsayılanı')
  for (const c of combos()) {
    for (const tone of K.TONES) assert.ok(parseColor(resolve(c.vars, '--tone-' + tone)), c.skin + ' ' + c.scheme + ': --tone-' + tone)
  }
  const radio = fs.readFileSync(path.join(PUB, 'css', 'radio.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const tone of K.TONES) {
    const m = new RegExp('\\.radio-button\\.tone-' + tone + '\\s*\\{([^}]*)\\}').exec(radio)
    assert.ok(m, 'radio.css tone-' + tone + ' kuralı')
    assert.ok(m[1].indexOf('var(--tone-' + tone + ')') !== -1, 'tone-' + tone + ' ton belirtecini kullanır')
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

test('her tema kayıtlı: index.html bağlantısı, sw.js önbelleği, süs dosyası, i18n ad ve açıklaması, önizleme renkleri', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8')
  const components = fs.readFileSync(path.join(PUB, 'css', 'components.css'), 'utf8')
  const messages = loadMessages()
  const files = fs.readdirSync(path.join(PUB, 'css', 'skins')).filter((f) => f.endsWith('.css')).map((f) => f.replace(/\.css$/, '')).sort()
  assert.deepEqual(files, SKINS.slice().sort(), 'public/css/skins içindeki dosyalar tema listesiyle aynı')
  let lastLink = html.indexOf('href="/css/tanitim.css"')
  let lastSw = sw.indexOf("'/css/tanitim.css'")
  assert.ok(lastLink !== -1 && lastSw !== -1)
  for (const skin of SKINS) {
    const link = html.indexOf('<link rel="stylesheet" href="/css/skins/' + skin + '.css">')
    assert.ok(link > lastLink, skin + ' bağlantısı ortak stillerden ve önceki temadan sonra')
    lastLink = link
    const cached = sw.indexOf("'/css/skins/" + skin + ".css'")
    assert.ok(cached > lastSw, skin + ' sw.js önbellek listesinde, liste sırasıyla')
    lastSw = cached
    for (const lang of ['tr', 'en']) {
      for (const key of ['theme.skin.' + skin, 'theme.skinHint.' + skin]) {
        assert.equal(typeof messages[lang][key], 'string', lang + ': ' + key)
        assert.ok(messages[lang][key].length > 1, lang + ': ' + key + ' boş')
      }
    }
    for (const n of [1, 2, 3, 4]) {
      const re = new RegExp('\\.theme-swatch-' + skin + ' > span:nth-child\\(' + n + '\\) \\{ background-color: #[0-9a-f]{6}\\x3b \\}')
      assert.ok(re.test(components), skin + ' önizleme rengi ' + n)
    }
  }
})

test('süs dosyaları: her seçici kendi temasıyla başlar, yasaklı CSS yok, backdrop-filter yalnızca @supports içinde', () => {
  for (const skin of SKINS) {
    const css = fs.readFileSync(path.join(PUB, 'css', 'skins', skin + '.css'), 'utf8')
    const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
    const rules = skinRules(css)
    assert.ok(rules.length > 0, skin + ' süs kuralları')
    for (const rule of rules) {
      for (const selector of rule.selectors) {
        assert.ok(selector.indexOf(':root[data-skin="' + skin + '"]') === 0, skin + '.css seçicisi kendi temasıyla başlamalı: ' + selector)
      }
      // "backdrop-filter: none" süzgeci kaldırır, her yerde serbesttir
      const filters = Array.from(rule.body.matchAll(/(?:^|[\s\x3b{])(?:-webkit-)?backdrop-filter\s*:\s*([^\x3b}]+)/g), (m) => m[1].trim())
      if (filters.some((value) => value !== 'none')) {
        assert.ok(rule.atRules.some((at) => /^@supports/.test(at)), skin + '.css backdrop-filter @supports dışında: ' + rule.selectors.join(', '))
      }
    }
    assert.ok(!/conic-gradient/.test(body), skin + '.css conic-gradient kullanmaz')
    assert.ok(!/display\s*:\s*(inline-)?grid/.test(body), skin + '.css grid yok')
    assert.ok(!/(^|[\s\x3b{])(row-|column-)?gap\s*:/.test(body), skin + '.css gap yok')
    assert.ok(!/clamp\(|:is\(|:where\(|(^|[\s\x3b{])aspect-ratio\s*:|(^|[\s\x3b{])inset\s*:/.test(body), skin + '.css yasak özellik yok')
  }
})

// theme-init.js'i sahte depolama ve medya sorgularıyla çalıştırır. opts.stored: saklı anahtarlar, opts.media: doğru
// dönen medya sorguları
function bootTheme (opts) {
  const o = opts || {}
  const attrs = {}
  const store = Object.assign({}, o.stored || {})
  const root = { setAttribute (k, v) { attrs[k] = v }, style: { setProperty () {} }, classList: { add () {} } }
  const sandbox = {
    document: { documentElement: root },
    localStorage: { getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null), setItem (k, v) { store[k] = String(v) } },
    matchMedia: (q) => ({ matches: (o.media || []).indexOf(q) !== -1, addEventListener () {} })
  }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.join(PUB, 'theme-init.js'), 'utf8'), sandbox, { filename: 'theme-init.js' })
  return { theme: sandbox.window.TelsizTheme, attrs, store }
}

test('Yüksek Kontrast ilk açılışta: saklı tema yoksa ve sistem yüksek karşıtlık istiyorsa seçilir, saklanmaz', () => {
  const plain = bootTheme()
  assert.equal(plain.theme.get().skin, 'arcade', 'varsayılan Arcade')
  assert.equal(plain.theme.contrastSkin, 'kontrast')
  for (const query of ['(prefers-contrast: more)', '(forced-colors: active)']) {
    const r = bootTheme({ media: [query] })
    assert.equal(r.theme.get().skin, 'kontrast', query)
    assert.equal(r.attrs['data-skin'], 'kontrast', query + ' kök özniteliği')
    assert.equal(r.store['telsiz.skin'], undefined, query + ' seçim saklanmaz')
  }
  // Saklı tercih her zaman önce gelir
  const stored = bootTheme({ stored: { 'telsiz.skin': 'gece' }, media: ['(prefers-contrast: more)', '(forced-colors: active)'] })
  assert.equal(stored.theme.get().skin, 'gece')
  // Geçersiz saklı değer tercih sayılmaz
  const invalid = bootTheme({ stored: { 'telsiz.skin': 'yok' }, media: ['(prefers-contrast: more)'] })
  assert.equal(invalid.theme.get().skin, 'kontrast')
  // Kişinin seçtiği tema saklanır ve sonraki açılışta sistem ayarının önüne geçer
  const chosen = bootTheme({ media: ['(prefers-contrast: more)'] })
  chosen.theme.set({ skin: 'arcade' })
  assert.equal(chosen.store['telsiz.skin'], 'arcade')
  assert.equal(bootTheme({ stored: chosen.store, media: ['(prefers-contrast: more)'] }).theme.get().skin, 'arcade')
  // Kontrast teması tema listesinde ve Ayarlar'ın Erişilebilirlik grubunda
  assert.ok(SKINS.indexOf(plain.theme.contrastSkin) !== -1)
})

test('base.css zorlanmış renk kipinde seçili öğelere sistem vurgusu kenarı verir, kurallar sonraki dosyalara ezilmez', () => {
  const base = fs.readFileSync(path.join(PUB, 'css', 'base.css'), 'utf8')
  const rules = skinRules(base).filter((rule) => rule.atRules.indexOf('@media (forced-colors: active)') !== -1)
  assert.ok(rules.length > 0, 'forced-colors bölümü')
  const ruleOf = (selector) => {
    const found = rules.filter((rule) => rule.selectors.indexOf(selector) !== -1)
    assert.equal(found.length, 1, 'forced-colors bölümünde tek kural: ' + selector)
    return found[0].body
  }
  // base.css bileşen ve süs dosyalarından önce yüklenir. Aynı ya da daha özgül sonraki kurallar (ör. frekans.css
  // .station.is-tuned, radio.css .radio .radio-ptt, :root[data-skin] kuralları) ezmesin diye bildirimler !important.
  // Gerçek tarayıcıdaki sonuç e2e/04-ayarlar.test.js içinde her temada ölçülür.
  const selected = ['.station.is-tuned', '.room-row.is-current', '.dm-item[aria-current]', '.settings-cat[aria-current="page"]', '.settings-theme-card.is-selected', '.top-personal-button.is-current']
  for (const selector of selected) assert.match(ruleOf(selector), /border-color:\s*Highlight\s*!important/, selector + ' kenarı')
  for (const selector of ['.room-row.is-current::before', '.needle::after']) assert.match(ruleOf(selector), /background-color:\s*Highlight\s*!important/, selector)
  assert.match(ruleOf('.radio .radio-ptt'), /border:\s*2px solid ButtonText\s*!important/, 'Bas Konuş kenarı')
  assert.match(ruleOf(':focus-visible'), /outline-width:\s*4px\s*!important/, 'kalın odak çerçevesi')
  for (const selector of ['.avatar[data-status]::after', '.radio-led', '.unread-badge', '.theme-swatch > span']) assert.match(ruleOf(selector), /forced-color-adjust:\s*none/, selector + ' rengini korur')
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
  assert.equal(rootSpecificity(':root[data-skin="x"]', { 'data-skin': 'y' }), -1)
  assert.ok(contrast(parseColor('#000'), parseColor('#fff')) > 20.9)
  assert.equal(Math.round(contrast(parseColor('#777'), parseColor('#fff')) * 100) / 100, 4.48)
})

test('ölçüm yardımcısı: eşikler, yarı saydam zemin ve tablo biçimi', () => {
  assert.equal(K.threshold('arcade', 'text'), 4.5)
  assert.equal(K.threshold('kontrast', 'text'), 7)
  assert.equal(K.threshold('kontrast', 'component'), 3)
  // Yarı saydam beyaz siyah zeminin üstünde griye döner
  const mixed = over(parseColor('rgba(255, 255, 255, 0.5)'), parseColor('#000000'))
  assert.equal(Math.round(mixed.r), 128)
  const list = K.combos(TOKENS, ['arcade'])
  assert.equal(list.length, 2)
  const md = K.table(list, 'tr', { arcade: 'Arcade' }).split('\n')
  assert.equal(md.length, 4)
  assert.ok(/^\| Arcade koyu \| \d+\.\d\d \|/.test(md[2]), md[2])
  assert.ok(/^\| Arcade dark \|/.test(K.table(list, 'en', { arcade: 'Arcade' }).split('\n')[2]))
})
