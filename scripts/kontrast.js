'use strict'

// Tema belirteçlerinin WCAG 2.x kontrast ölçümü (docs/TASARIM.md, "Erişilebilirlik ve kontrast").
// public/css/tokens.css içindeki kurallar CSS kademesiyle çözülür: kök öğeye (:root) uyan kurallar özgüllük ve
// kaynak sırasıyla uygulanır, var() başvuruları çözülür. @media ve @supports içindeki kurallar renk tanımlamadığı
// için dışarıda kalır. Her tema (theme-init.js listesi) ve mod (koyu, açık) bileşiminde her rolün en düşük oranı
// dokuz yüzeyin hepsinde (üzerine gelme ve seçili zeminler dahil) ölçülür, yarı saydam zeminler altlarındaki
// yüzeyle birleştirilir. Eşikler: metin 4.5:1, Yüksek Kontrast temasında 7:1, arayüz bileşeni 3:1.
// test/tema.test.js eşikleri bu modülle denetler. Komut satırında kontrast tablosunu Markdown olarak yazar:
//   node scripts/kontrast.js        Türkçe tablo (docs/TASARIM.md)
//   node scripts/kontrast.js --en   İngilizce tablo (docs/DESIGN.md)

const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const PUB = path.join(__dirname, '..', 'public')
const SCHEMES = ['dark', 'light']
// Bileşenlerin üzerinde durduğu yüzeyler
const SURFACES = ['--bg', '--surface-1', '--surface-2', '--surface-3', '--surface-alt', '--surface-sunken', '--surface-hover', '--surface-active', '--surface-float']
// Özel rol renkleri (rozet yazısı) ve telsiz kartı düğmelerinin tonları (simge ve kenar)
const ROLE_COLORS = ['red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink']
const TONES = ['camera', 'mic', 'deafen', 'screen']
// Metin rollerinde 7:1 (WCAG AAA) isteyen temalar
const AAA_SKINS = ['kontrast']
const THRESHOLD = { text: 4.5, textAAA: 7, component: 3 }

// theme-init.js küçük bir tarayıcı taklidinde çalıştırılır, tema listesi window.TelsizTheme.skins olur
function loadSkins (pub) {
  const root = { setAttribute () {}, style: { setProperty () {} }, classList: { add () {} } }
  const storage = { getItem: () => null, setItem () {} }
  const sandbox = { document: { documentElement: root }, localStorage: storage }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.join(pub || PUB, 'theme-init.js'), 'utf8'), sandbox, { filename: 'theme-init.js' })
  return Array.from(sandbox.window.TelsizTheme.skins)
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

// Bir tema ve mod bileşimindeki rollerin en düşük oranları. Her kayıt { id, kind, tr, en, value } biçimindedir,
// kind 'text' (metin) veya 'component' (arayüz bileşeni) olur. Renk olmayan veya çözülemeyen belirteçte hata atar.
function measure (vars) {
  const color = (name) => {
    const value = resolve(vars, name)
    const parsed = value === null ? null : parseColor(value)
    if (!parsed) throw new Error(name + ' renk değil: ' + value)
    return parsed
  }
  const has = (name) => resolve(vars, name) !== null
  const bg = color('--bg')
  const surfaces = SURFACES.map((name) => over(color(name), bg))
  const lowest = (fg, backs) => Math.min.apply(null, backs.map((b) => contrast(fg, b)))
  const onAll = (name) => lowest(color(name), surfaces)
  const tinted = (name) => surfaces.map((s) => over(color(name), s))
  const out = []
  const add = (id, kind, tr, en, value) => out.push({ id, kind, tr, en, value })
  add('text', 'text', 'Ana metin', 'Primary text', onAll('--text'))
  add('text-2', 'text', 'İkincil metin', 'Secondary text', onAll('--text-2'))
  add('text-3', 'text', 'Soluk metin', 'Muted text', onAll('--text-3'))
  add('accent-text', 'text', 'Vurgu metni', 'Accent text', onAll('--accent-text'))
  add('accent-2-text', 'text', 'İkinci vurgu metni', 'Second accent text', onAll('--accent-2-text'))
  add('link', 'text', 'Bağlantı', 'Link', onAll('--link'))
  add('live', 'text', 'Canlı', 'Live', Math.min(onAll('--live'), lowest(color('--live'), tinted('--live-bg')), lowest(color('--live'), tinted('--speaking-bg'))))
  add('danger', 'text', 'Tehlike metni', 'Danger text', Math.min(onAll('--danger'), lowest(color('--danger'), tinted('--danger-bg'))))
  add('warn', 'text', 'Uyarı metni', 'Warning text', Math.min(onAll('--warn'), lowest(color('--warn'), tinted('--warn-bg'))))
  add('mention', 'text', 'Anma metni', 'Mention text', lowest(color('--mention-text'), tinted('--mention-bg')))
  add('on-accent', 'text', 'Vurgu dolgusu üstü metin', 'Text on accent fill', contrast(color('--on-accent'), color('--accent')))
  add('on-accent-fill', 'text', 'Dolgu düğme yazısı', 'Filled button text', Math.min(contrast(color('--on-accent-fill'), color('--accent-fill-a')), contrast(color('--on-accent-fill'), color('--accent-fill-b'))))
  add('on-attention', 'text', 'Dikkat rozeti metni', 'Attention badge text', contrast(color('--on-attention'), color('--attention')))
  add('on-danger', 'text', 'Tehlike dolgusu üstü metin', 'Text on danger fill', contrast(color('--on-danger'), color('--danger-fill')))
  const avatars = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => contrast(has('--av-fg-' + i) ? color('--av-fg-' + i) : color('--av-fg'), color('--av-' + i)))
  add('avatar', 'text', 'Avatar baş harfi', 'Avatar initial', Math.min.apply(null, avatars))
  add('avatar-offline', 'text', 'Çevrimdışı avatar baş harfi', 'Offline avatar initial', contrast(has('--av-offline-fg') ? color('--av-offline-fg') : color('--av-fg'), color('--av-offline')))
  add('roles', 'text', 'Rol renkleri', 'Role colors', Math.min.apply(null, ROLE_COLORS.map((c) => onAll('--role-' + c))))
  add('edge', 'component', 'Girdi ve kart kenarı', 'Input and card border', onAll('--edge'))
  add('focus', 'component', 'Odak çerçevesi', 'Focus ring', onAll('--focus'))
  add('ok', 'component', 'Durum: çevrimiçi', 'Status: online', onAll('--ok'))
  add('idle', 'component', 'Durum: boşta', 'Status: idle', onAll('--idle'))
  add('dnd', 'component', 'Durum: rahatsız etmeyin', 'Status: do not disturb', onAll('--dnd'))
  add('offline', 'component', 'Durum: çevrimdışı', 'Status: offline', onAll('--offline'))
  add('fill-a', 'component', 'Dolgu', 'Fill', onAll('--accent-fill-a'))
  add('fill-b', 'component', 'Dolgu ikinci uç', 'Fill second stop', onAll('--accent-fill-b'))
  add('live-edge', 'component', 'Canlı kenarı', 'Live border', Math.min(onAll('--live-edge'), lowest(color('--live-edge'), tinted('--live-bg'))))
  add('danger-edge', 'component', 'Tehlike kenarı', 'Danger border', Math.min(onAll('--danger-edge'), lowest(color('--danger-edge'), tinted('--danger-bg'))))
  add('tones', 'component', 'Telsiz kartı düğme tonları', 'Radio card button tones', Math.min.apply(null, TONES.map((tone) => onAll('--tone-' + tone))))
  return out
}

function threshold (skin, kind) {
  if (kind === 'component') return THRESHOLD.component
  return AAA_SKINS.indexOf(skin) !== -1 ? THRESHOLD.textAAA : THRESHOLD.text
}

// Her tema ve mod bileşimi: { skin, scheme, vars, results }
function combos (css, skins) {
  const rules = parseRules(css)
  const out = []
  for (const skin of skins) {
    for (const scheme of SCHEMES) {
      const vars = cascade(rules, { 'data-skin': skin, 'data-scheme': scheme })
      out.push({ skin, scheme, vars, results: measure(vars) })
    }
  }
  return out
}

// Kontrast tablosu: satırlar tema ve mod, sütunlar ana roller ile en düşük metin ve bileşen rolü
function table (list, lang, names) {
  const en = lang === 'en'
  const head = en
    ? ['Theme and mode', 'Primary text', 'Secondary text', 'Muted text', 'Role colors', 'Lowest text role', 'Lowest component']
    : ['Tema ve mod', 'Ana metin', 'İkincil metin', 'Soluk metin', 'Rol renkleri', 'En düşük metin rolü', 'En düşük bileşen']
  const fmt = (v) => (Math.floor(v * 100) / 100).toFixed(2)
  const lines = ['| ' + head.join(' | ') + ' |', '|' + head.map(() => ' --- |').join('')]
  for (const c of list) {
    const by = (id) => c.results.find((r) => r.id === id).value
    const low = (kind) => c.results.filter((r) => r.kind === kind).reduce((a, b) => (b.value < a.value ? b : a))
    const lt = low('text')
    const lc = low('component')
    const name = (names && names[c.skin]) || c.skin
    const mode = en ? (c.scheme === 'dark' ? 'dark' : 'light') : (c.scheme === 'dark' ? 'koyu' : 'açık')
    lines.push('| ' + [name + ' ' + mode, fmt(by('text')), fmt(by('text-2')), fmt(by('text-3')), fmt(by('roles')), fmt(lt.value) + ' (' + (en ? lt.en : lt.tr) + ')', fmt(lc.value) + ' (' + (en ? lc.en : lc.tr) + ')'].join(' | ') + ' |')
  }
  return lines.join('\n')
}

module.exports = { SCHEMES, SURFACES, ROLE_COLORS, TONES, AAA_SKINS, THRESHOLD, loadSkins, parseRules, rootSpecificity, cascade, resolve, ownDecl, parseColor, over, luminance, contrast, measure, threshold, combos, table }

if (require.main === module) {
  const lang = process.argv.indexOf('--en') !== -1 ? 'en' : 'tr'
  const css = fs.readFileSync(path.join(PUB, 'css', 'tokens.css'), 'utf8')
  // Tema adları i18n sözlüğünden (theme.skin.<id>)
  const i18n = fs.readFileSync(path.join(PUB, 'i18n.js'), 'utf8')
  const dict = i18n.indexOf('const en = {') === -1 ? i18n : (lang === 'en' ? i18n.slice(i18n.indexOf('const en = {')) : i18n.slice(0, i18n.indexOf('const en = {')))
  const names = {}
  for (const m of dict.matchAll(/'theme\.skin\.([\w-]+)':\s*'([^']*)'/g)) if (!names[m[1]]) names[m[1]] = m[2]
  const list = combos(css, loadSkins(PUB))
  process.stdout.write(table(list, lang, names) + '\n')
  let below = 0
  for (const c of list) for (const r of c.results) if (r.value < threshold(c.skin, r.kind)) below++
  process.stdout.write('\n' + (lang === 'en' ? 'Pairs below threshold: ' : 'Eşik altındaki çift: ') + below + '\n')
  process.exitCode = below ? 1 : 0
}
