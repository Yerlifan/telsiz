'use strict'

// Frekans tanıtımı (public/js/26-tanitim.js, public/css/tanitim.css, index.html #tanitim): sayfanın ne zaman
// gösterileceği, komut metinleri, bağlantı adresleri ve güvenli bağlantı öznitelikleri, service worker kabuğu,
// iki dilde metinler ve CSS kuralları. Tarayıcıdaki akış e2e/08-tanitim.test.js içinde sınanır.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const PUB = path.join(__dirname, '..', 'public')
const SOURCE = fs.readFileSync(path.join(PUB, 'js', '26-tanitim.js'), 'utf8')
const HTML = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
const CSS = fs.readFileSync(path.join(PUB, 'css', 'tanitim.css'), 'utf8')

// 26-tanitim.js tek başına, küçük bir genel ortamla yüklenir
function load (opts) {
  const o = opts || {}
  const local = Object.assign({}, o.local)
  const session = Object.assign({}, o.session)
  const sandbox = {
    window: o.desktop ? { telsizDesktop: {} } : {},
    state: Object.assign({ serverName: 'Kankalar', info: null }, o.state),
    KEYS: { invite: 'telsiz.invite' },
    storeGet: (key, kind) => {
      const area = kind === 'session' ? session : local
      return Object.prototype.hasOwnProperty.call(area, key) ? area[key] : null
    },
    storeSet: (key, value) => { local[key] = String(value) },
    byId: (id) => (id === 'tanitim' && o.page !== false ? {} : null),
    t: (key) => (key === 'landing.guide.domain' ? 'alanadin.com' : key)
  }
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox, { filename: '26-tanitim.js' })
  return { run: (code) => vm.runInContext(code, sandbox), local }
}

test('tanıtım yalnızca bağlantısız, davetsiz, masaüstü dışı ve ilk ziyarette gösterilir', () => {
  assert.equal(load().run('tanitimShouldShow()'), true)
  assert.equal(load({ desktop: true }).run('tanitimShouldShow()'), false, 'masaüstü uygulaması')
  assert.equal(load({ state: { fragmentSeen: true } }).run('tanitimShouldShow()'), false, 'adres parçası (#davet, #anahtar, #frekanslar)')
  assert.equal(load({ session: { 'telsiz.invite': 'ABCDE-FGHJK' } }).run('tanitimShouldShow()'), false, 'bekleyen davet kodu')
  assert.equal(load({ local: { 'telsiz.tanitim.gecildi': '1' } }).run('tanitimShouldShow()'), false, 'daha önce giriş yapıldı')
  assert.equal(load({ page: false }).run('tanitimShouldShow()'), false, 'sayfada bölüm yoksa')
  const w = load()
  w.run('tanitimRemember()')
  assert.equal(w.local['telsiz.tanitim.gecildi'], '1')
  assert.equal(w.run('tanitimShouldShow()'), false)
})

test('komut şablonundaki alan adı yeri dile göre dolar', () => {
  const w = load()
  assert.equal(w.run("tanitimCommandText('nslookup {domain}')"), 'nslookup alanadin.com')
  assert.equal(w.run("tanitimCommandText('npx telsiz')"), 'npx telsiz')
})

test('index.html: bağlantılar doğru adreste, yeni sekmede ve noopener noreferrer ile açılır', () => {
  const links = {
    'tanitim-download': 'https://github.com/Yerlifan/telsiz/releases/latest',
    'tanitim-docs': 'https://github.com/Yerlifan/telsiz#readme',
    'tanitim-guide-link': 'https://github.com/Yerlifan/telsiz/blob/main/docs/KURULUM.md#vps-ve-alan-ad%C4%B1yla-ad%C4%B1m-ad%C4%B1m',
    'tanitim-source': 'https://github.com/Yerlifan/telsiz'
  }
  for (const id of Object.keys(links)) {
    const m = new RegExp('<a id="' + id + '"[^>]*>').exec(HTML)
    assert.ok(m, id)
    assert.ok(m[0].indexOf('href="' + links[id] + '"') !== -1, id + ' adresi')
    assert.ok(m[0].indexOf('target="_blank"') !== -1, id + ' yeni sekme')
    assert.ok(m[0].indexOf('rel="noopener noreferrer"') !== -1, id + ' rel')
  }
  // Her dış bağlantı aynı kurala uyar
  const all = HTML.match(/<a [^>]*target="_blank"[^>]*>/g) || []
  assert.ok(all.length >= 4)
  for (const a of all) assert.ok(a.indexOf('rel="noopener noreferrer"') !== -1, a)
  // Komutlar depodaki gerçek dosyalarla tutarlı
  const compose = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'docker-compose.yml'), 'utf8')
  assert.ok(compose.indexOf('TELSIZ_ALAN_ADI') !== -1 && compose.indexOf('- caddy') !== -1)
  for (const cmd of ['npx telsiz', 'TELSIZ_ALAN_ADI={domain} docker compose -f deploy/docker-compose.yml --profile caddy up -d', 'docker compose -f deploy/docker-compose.yml logs telsiz']) {
    assert.ok(HTML.indexOf('data-cmd="' + cmd + '"') !== -1, cmd)
  }
  // Rehber bağlantısındaki çapa KURULUM.md başlığına karşılık gelir
  const kurulum = fs.readFileSync(path.join(__dirname, '..', 'docs', 'KURULUM.md'), 'utf8')
  assert.ok(/^## VPS ve alan adıyla adım adım$/m.test(kurulum))
  const deployment = fs.readFileSync(path.join(__dirname, '..', 'docs', 'DEPLOYMENT.md'), 'utf8')
  assert.ok(/^## Step by step with a VPS and a domain$/m.test(deployment))
  // Betik ve stil etiketleri, service worker kabuğu
  assert.ok(HTML.indexOf('<script src="/js/26-tanitim.js" defer></script>') > HTML.indexOf('<script src="/js/24-frekans.js" defer></script>'))
  assert.ok(HTML.indexOf('href="/css/tanitim.css"') < HTML.indexOf('href="/css/skins/arcade.css"'))
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8')
  assert.ok(sw.indexOf("'/js/26-tanitim.js'") !== -1 && sw.indexOf("'/css/tanitim.css'") !== -1)
  // İngilizce arayüzde belge bağlantıları İngilizce eşlere gider
  assert.ok(SOURCE.indexOf('https://github.com/Yerlifan/telsiz/blob/main/docs/DEPLOYMENT.md#step-by-step-with-a-vps-and-a-domain') !== -1)
  assert.ok(SOURCE.indexOf('https://github.com/Yerlifan/telsiz/blob/main/README.en.md') !== -1)
  // Tanıtım metni yalnızca textContent ile yazılır
  assert.ok(/tanitimEl\.about\.textContent = about/.test(SOURCE))
})

test('iki dilde metinler ve abartısız güvenlik dili', () => {
  const sandbox = { window: {}, localStorage: { getItem () { return null }, setItem () {} }, navigator: { language: 'tr-TR', languages: ['tr-TR'] }, document: { documentElement: { setAttribute () {} } } }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.join(PUB, 'i18n.js'), 'utf8'), sandbox)
  const I18N = sandbox.I18N
  I18N.setLang('tr')
  assert.equal(I18N.t('landing.login'), 'Giriş yap')
  assert.equal(I18N.t('landing.join'), 'Davetin varsa katıl')
  assert.equal(I18N.t('landing.back'), 'Telsiz\'i tanı')
  assert.equal(I18N.t('landing.version', { version: '2.0.1' }), 'Telsiz 2.0.1')
  const tr = []
  const en = []
  const keys = ['landing.whatLead', 'landing.feature.e2eTitle', 'landing.feature.e2eText', 'landing.joinNote', 'landing.desktopText', 'landing.guide.step4Text', 'settings.general.aboutHint']
  keys.forEach((k) => tr.push(I18N.t(k)))
  I18N.setLang('en')
  assert.equal(I18N.t('landing.login'), 'Sign in')
  assert.equal(I18N.t('landing.guide.domain'), 'example.com')
  keys.forEach((k) => en.push(I18N.t(k)))
  for (const text of tr.concat(en)) {
    assert.ok(!/kırılamaz|%100|unbreakable|100%|military|askeri/i.test(text), text)
  }
  assert.ok(en.every((text, i) => text !== tr[i]))
})

test('tanitim.css: yasak özellik ve renk değeri yok, hareket azaltma tercihine uyar', () => {
  const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(!/display:\s*grid|(^|[\s;{])gap\s*:|clamp\(|:is\(|:where\(|aspect-ratio|(^|[\s;{])inset\s*:/.test(body), 'yasak özellik yok')
  assert.deepEqual(body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) || [], [], 'renkler yalnızca var(--...) ile')
  assert.ok(/@media \(prefers-reduced-motion: no-preference\)[\s\S]*tanitim-tune/.test(body))
})
