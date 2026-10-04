'use strict'

// Frekans tanıtımı: oturum açmamış ziyaretçi frekansın adresini açınca önce tanıtım sayfasını görür (frekans adı,
// sahibin tanıtım metni, indirme ve kurulum bağlantıları). Giriş yap giriş kartını açar, "Telsiz'i tanı" geri
// döner. Davet bağlantısı, frekans listesi parçası ve kurulmamış sunucu tanıtımı atlar, giriş yapmış tarayıcı da
// sonraki açılışlarda doğrudan giriş kartını görür.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const ABOUT = 'İlk Telsiz frekansı.\nYaratıcısı Burak Aslancan Pak.'
const VERSION = require('../package.json').version

const W = { w: null, other: null }
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []))

before(async () => {
  W.w = await h.setupWorld({ slot: 9 })
  W.other = await h.startServer(null, 10)
  const res = await W.w.call('POST', '/api/settings', { about: '  ' + ABOUT + '  ' }, W.w.P.deniz.token)
  assert.equal(res.status, 200)
})

after(async () => {
  try {
    if (W.w) await W.w.close()
  } finally {
    if (W.other) {
      await new Promise((resolve) => W.other.server.close(resolve))
      require('node:fs').rmSync(W.other.dataDir, { recursive: true, force: true })
    }
  }
})

function visitor (label, opts) {
  return W.w.tb.newPage(label, Object.assign({ extra: { 'telsiz.skin': 'arcade', 'telsiz.scheme': 'dark' } }, opts || {}))
}

test('oturumsuz ziyaretçi tanıtım sayfasını görür: frekans adı, tanıtım metni, bağlantılar ve sürüm', async () => {
  const page = await visitor('ziyaretci')
  W.page = page
  await page.goto(W.w.base + '/')
  await page.waitForSelector('#tanitim:not([hidden])', { timeout: h.LONG })
  const r = await page.evaluate(() => {
    const link = (id) => {
      const a = document.getElementById(id)
      return { href: a.getAttribute('href'), target: a.getAttribute('target'), rel: a.getAttribute('rel') }
    }
    return {
      name: document.getElementById('tanitim-name').textContent,
      about: document.getElementById('tanitim-about').textContent,
      aboutVisible: !document.getElementById('tanitim-about-wrap').hidden,
      aboutLines: document.getElementById('tanitim-about').getClientRects().length > 0 && document.getElementById('tanitim-about').offsetHeight > 30,
      host: document.getElementById('tanitim-host').textContent,
      version: document.getElementById('tanitim-version').textContent,
      title: document.title,
      loginHidden: document.getElementById('login-card').hidden,
      stageHidden: document.querySelector('#auth-view .auth-stage').hidden,
      card: document.getElementById('auth-view').getAttribute('data-card'),
      download: link('tanitim-download'),
      docs: link('tanitim-docs'),
      guide: link('tanitim-guide-link'),
      source: link('tanitim-source'),
      desktopCard: !document.getElementById('tanitim-desktop').hidden,
      commands: Array.from(document.querySelectorAll('#tanitim .tanitim-cmd-text')).map((n) => n.textContent)
    }
  })
  assert.equal(r.name, 'Kankalar')
  assert.equal(r.about, ABOUT)
  assert.ok(r.aboutVisible && r.aboutLines, 'tanıtım metni iki satır görünür')
  assert.equal(r.host, new URL(W.w.base).host)
  assert.equal(r.version, 'Telsiz ' + VERSION)
  assert.equal(r.title, 'Kankalar')
  assert.equal(r.loginHidden, true)
  assert.equal(r.stageHidden, true)
  assert.equal(r.card, 'tanitim')
  assert.deepEqual(r.download, { href: 'https://github.com/Yerlifan/telsiz/releases/latest', target: '_blank', rel: 'noopener noreferrer' })
  assert.deepEqual(r.docs, { href: 'https://github.com/Yerlifan/telsiz#readme', target: '_blank', rel: 'noopener noreferrer' })
  assert.deepEqual(r.guide, { href: 'https://github.com/Yerlifan/telsiz/blob/main/docs/KURULUM.md#vps-ve-alan-ad%C4%B1yla-ad%C4%B1m-ad%C4%B1m', target: '_blank', rel: 'noopener noreferrer' })
  assert.deepEqual(r.source, { href: 'https://github.com/Yerlifan/telsiz', target: '_blank', rel: 'noopener noreferrer' })
  assert.equal(r.desktopCard, true)
  assert.ok(r.commands.indexOf('npx telsiz') !== -1)
  assert.ok(r.commands.indexOf('TELSIZ_ALAN_ADI=alanadin.com docker compose -f deploy/docker-compose.yml --profile caddy up -d') !== -1, r.commands.join(' | '))
  // Kurulum rehberi açılır bölümdür
  assert.equal(await page.evaluate(() => document.getElementById('tanitim-guide').open), false)
  await page.click('#tanitim-guide summary')
  assert.equal(await page.evaluate(() => document.getElementById('tanitim-guide').open), true)
})

test('Kopyala düğmesi komutu panoya yazar', async () => {
  const page = W.page
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: W.w.base })
  await page.click('#tanitim-get .tanitim-card .tanitim-cmd-copy')
  await page.waitForFunction(() => !document.getElementById('toast').hidden && document.getElementById('toast').textContent === 'Kopyalandı.')
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'npx telsiz')
})

test('Giriş yap giriş kartını açar, Telsiz\'i tanı geri döner, Davetin varsa katıl yalnızca davetle kaydı anlatır', async () => {
  const page = W.page
  await page.click('#tanitim-login')
  await page.waitForSelector('#login-card:not([hidden])')
  const a = await page.evaluate(() => ({
    tanitim: document.getElementById('tanitim').hidden,
    stage: document.querySelector('#auth-view .auth-stage').hidden,
    focus: document.activeElement && document.activeElement.id,
    back: !document.getElementById('tanitim-back').hidden,
    loginForm: !document.getElementById('login-form').hidden
  }))
  assert.deepEqual(a, { tanitim: true, stage: false, focus: 'login-name', back: true, loginForm: true })
  await page.click('#tanitim-back')
  await page.waitForSelector('#tanitim:not([hidden])')
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'tanitim-login')
  assert.equal(await page.evaluate(() => document.getElementById('login-card').offsetParent), null, 'giriş kartı görünmez')
  // Davetin varsa katıl: açıklama açılır, açık kayıt sunulmaz
  await page.click('#tanitim-join')
  await page.waitForSelector('#tanitim-join-note:not([hidden])')
  assert.equal(await page.getAttribute('#tanitim-join', 'aria-expanded'), 'true')
  assert.match(await page.textContent('#tanitim-join-note'), /davet bağlantısı/)
  await page.click('#tanitim-join-code')
  await page.waitForSelector('#register-form:not([hidden])')
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'register-name')
  assert.ok(await page.evaluate(() => document.getElementById('register-invite').required), 'kayıt davet kodu ister')
})

test('davet bağlantısı ve frekans listesi parçası tanıtımı atlar', async () => {
  const page = await visitor('davetli')
  await page.goto(W.w.base + '/#davet=' + encodeURIComponent(W.w.invite))
  await page.waitForSelector('#register-form:not([hidden])', { timeout: h.LONG })
  assert.equal(await page.evaluate(() => document.getElementById('tanitim').hidden), true)
  assert.equal(await page.inputValue('#register-invite'), W.w.invite)
  const list = Buffer.from(JSON.stringify({ v: 1, f: [['https://yeni.ornek.com', 'Yeni']] })).toString('base64url')
  const other = await visitor('frekans-gecisi')
  await other.goto(W.w.base + '/#frekanslar=' + list)
  await other.waitForSelector('#login-card:not([hidden])', { timeout: h.LONG })
  assert.equal(await other.evaluate(() => document.getElementById('tanitim').hidden), true)
  await other.context().close()
  await page.context().close()
})

test('kurulmamış sunucu tanıtım yerine kurulum kartını gösterir', async () => {
  const page = await visitor('kurulum')
  await page.goto(W.other.base + '/')
  await page.waitForSelector('#setup-card:not([hidden])', { timeout: h.LONG })
  assert.equal(await page.evaluate(() => document.getElementById('tanitim').hidden), true)
  assert.equal(await page.evaluate(() => document.getElementById('tanitim-back').hidden), true)
  await page.context().close()
})

test('giriş yapmış tarayıcı tanıtımı görmez, oturum bitince doğrudan giriş kartı açılır', async () => {
  const page = await W.w.pageFor('ece')
  assert.equal(await page.evaluate(() => localStorage.getItem('telsiz.tanitim.gecildi')), '1')
  assert.equal(await page.evaluate(() => document.getElementById('tanitim').hidden), true)
  await page.evaluate(() => localStorage.removeItem('telsiz.token'))
  await page.goto(W.w.base + '/')
  await page.waitForSelector('#login-card:not([hidden])', { timeout: h.LONG })
  assert.equal(await page.evaluate(() => document.getElementById('tanitim').hidden), true)
  // Telsiz'i tanı her zaman açar
  await page.click('#tanitim-back')
  await page.waitForSelector('#tanitim:not([hidden])')
  await page.context().close()
})

test('390 genişlikte yatay taşma yok, düğmeler klavyeyle erişilir, dil değişince metin ve bağlantılar değişir', async () => {
  const page = await visitor('telefon', { viewport: { width: 390, height: 844 }, mobile: true, extra: { 'telsiz.skin': 'gece', 'telsiz.scheme': 'light' } })
  await page.goto(W.w.base + '/')
  await page.waitForSelector('#tanitim:not([hidden])', { timeout: h.LONG })
  assert.ok(await h.overflowX(page) <= 0, 'kapalı rehberle taşma yok')
  await page.click('#tanitim-guide summary')
  await page.click('#tanitim-join')
  assert.ok(await h.overflowX(page) <= 0, 'açık rehberle taşma yok')
  const wide = await page.evaluate(() => Array.from(document.querySelectorAll('#tanitim *')).filter((n) => {
    const r = n.getBoundingClientRect()
    return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1)
  }).map((n) => n.className))
  assert.deepEqual(wide, [])
  // Klavye: sekme sırası birincil düğmeye ulaşır
  await page.focus('#auth-scheme')
  let reached = false
  let steps = 0
  while (!reached && steps < 12) {
    await page.keyboard.press('Tab')
    reached = await page.evaluate(() => document.activeElement && document.activeElement.id === 'tanitim-login')
    steps += 1
  }
  assert.ok(reached, 'Giriş yap sekmeyle odaklanır')
  // İngilizce
  await page.click('#auth-lang [data-lang="en"]')
  await page.waitForFunction(() => document.querySelector('#tanitim-login span').textContent === 'Sign in')
  const en = await page.evaluate(() => ({
    title: document.getElementById('tanitim-what-title').textContent,
    cmd: Array.from(document.querySelectorAll('#tanitim .tanitim-cmd-text')).map((n) => n.textContent).filter((t) => t.indexOf('nslookup') === 0)[0],
    copy: document.querySelector('#tanitim .tanitim-cmd-copy-text').textContent
  }))
  assert.deepEqual(en, { title: 'What is Telsiz?', cmd: 'nslookup example.com', copy: 'Copy' })
  // Bağlantı adresi tıklanınca dile göre güncellenir (gezinme testte engellenir, dış siteye gidilmez)
  await page.evaluate(() => document.addEventListener('click', (e) => e.preventDefault(), { once: true }))
  await page.click('#tanitim-guide-link')
  assert.equal(await page.getAttribute('#tanitim-guide-link', 'href'), 'https://github.com/Yerlifan/telsiz/blob/main/docs/DEPLOYMENT.md#step-by-step-with-a-vps-and-a-domain')
  assert.equal(page.context().pages().length, 1)
  await page.context().close()
})

test('konsol ve sunucu günlükleri temiz', async () => {
  h.assertCleanConsole(W.w.logs, W.w.srv.errors)
  assert.deepEqual(W.other.errors, [])
})
