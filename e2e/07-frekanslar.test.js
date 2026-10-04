'use strict'

// Frekanslar (web): iki ayrı Telsiz sunucusu iki ayrı köken, yani iki frekanstır. Üst çubuktaki frekans
// adından açılan menü, Frekans ekle (adres doğrulaması), listeden çıkarma, klavye ile gezinme ve Esc,
// başka frekansı seçince sekmenin o kökene gitmesi, listenin adresin # parçasıyla taşınıp karşı kökende
// yerel listeye eklenmesi ve parçanın adresten silinmesi, telefon genişliğinde menü. Konsol temiz olmalıdır.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const h = require('./yardimci')

const W = { w: null, other: null, page: null, ctx: null }
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []))

// Oturum yalnızca ilk frekansın kökeninde açılır (ikinci sunucuda hesap yoktur, kurulum ekranı görünür)
const initScript = (v) => {
  if (window.location.port !== v.port || sessionStorage.getItem('e2e.init')) return
  localStorage.setItem('telsiz.token', v.token)
  localStorage.setItem('telsiz.identity.' + v.id, v.identity)
  localStorage.setItem('telsiz.skin', 'arcade')
  localStorage.setItem('telsiz.scheme', 'dark')
  sessionStorage.setItem('e2e.init', '1')
}

async function openMenu (page) {
  // Önceki adımdan açık kalan menü veya pencere önce kapatılır (düğme menüyü açıp kapatır)
  if (await page.evaluate(() => !document.getElementById('frekans-menu').hidden || Boolean(document.querySelector('#dialog-root .app-dialog')))) {
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.getElementById('frekans-menu').hidden && !document.querySelector('#dialog-root .app-dialog'))
  }
  await page.click('#frekans-button')
  await page.waitForSelector('#frekans-menu:not([hidden]) .frekans-item')
}

before(async () => {
  W.w = await h.setupWorld({ slot: 7 })
  W.other = await h.startServer(null, 8)
  const p = W.w.P.deniz
  const context = await W.w.tb.browser.newContext({ locale: 'tr-TR', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await context.addInitScript(initScript, { port: String(W.w.port), token: p.token, id: p.id, identity: p.identity })
  W.ctx = context
  W.page = await context.newPage()
  W.page.setDefaultTimeout(h.SHORT)
  W.page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') W.w.logs.push({ label: 'frekans', type: m.type(), text: m.text() })
  })
  W.page.on('pageerror', (e) => W.w.logs.push({ label: 'frekans', type: 'pageerror', text: e.message }))
  W.w.pages.push({ label: 'frekans', page: W.page })
  await W.page.goto(W.w.base + '/#anahtar=' + encodeURIComponent(W.w.keyCode))
  await W.page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  await W.page.waitForSelector('#band-track .station[data-station]', { timeout: h.LONG })
})

after(async () => {
  try {
    if (W.w) await W.w.close()
  } finally {
    if (W.other) {
      await new Promise((resolve) => W.other.server.close(resolve))
      fs.rmSync(W.other.dataDir, { recursive: true, force: true })
    }
  }
})

test('frekans adı menüyü açar: açık frekans başta ve işaretli, Esc kapatır, odak düğmeye döner', async () => {
  const page = W.page
  // Ad ve üye sayısı sunucu bilgisi ve meta gelince yazılır
  await page.waitForFunction(() => document.getElementById('frekans-button').getAttribute('aria-label') === 'Kankalar frekansı. Frekansları göster')
  await page.waitForFunction(() => {
    const n = document.querySelector('#server-meta .server-members')
    return n && n.textContent === 'Frekans · 3 üye'
  })
  await openMenu(page)
  assert.equal(await page.getAttribute('#frekans-button', 'aria-expanded'), 'true')
  // Odak bir sonraki çizim karesinde açık frekansa gider (02-state-dom.js openLayer)
  await page.waitForFunction(() => document.activeElement && document.activeElement.getAttribute('aria-checked') === 'true')
  const r = await page.evaluate(() => ({
    items: Array.from(document.querySelectorAll('#frekans-menu .frekans-item')).map((b) => ({ origin: b.getAttribute('data-frekans'), checked: b.getAttribute('aria-checked'), name: b.querySelector('.frekans-item-name').textContent })),
    focus: document.activeElement.getAttribute('data-frekans'),
    removable: document.querySelectorAll('#frekans-menu .frekans-remove').length
  }))
  assert.deepEqual(r, { items: [{ origin: W.w.base, checked: 'true', name: 'Kankalar' }], focus: W.w.base, removable: 0 })
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => document.activeElement.id), 'frekans-add')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.getElementById('frekans-menu').hidden && document.activeElement.id === 'frekans-button')
  assert.equal(await page.getAttribute('#frekans-button', 'aria-expanded'), 'false')
})

test('Frekans ekle: geçersiz adres reddedilir, geçerli adres listeye eklenir, listeden çıkarma onay ister', async () => {
  const page = W.page
  await openMenu(page)
  await page.click('#frekans-add')
  await page.waitForSelector('#frekans-add-input')
  await page.waitForFunction(() => document.activeElement.id === 'frekans-add-input')
  for (const pair of [['http://kotu.ornek.com', 'http:// yalnızca'], ['https://a.com/yol', 'Yalnızca frekansın ana adresini'], [W.w.base, 'zaten listede']]) {
    await page.fill('#frekans-add-input', pair[0])
    await page.click('#frekans-add-submit')
    await page.waitForFunction((text) => {
      const m = document.getElementById('frekans-add-error')
      return !m.hidden && m.textContent.indexOf(text) !== -1
    }, pair[1])
  }
  await page.fill('#frekans-add-input', W.other.base + '/')
  await page.click('#frekans-add-submit')
  await page.waitForFunction(() => !document.getElementById('frekans-add-input'))
  // İkinci, sonradan çıkarılacak bir frekans
  await openMenu(page)
  await page.click('#frekans-add')
  await page.waitForSelector('#frekans-add-input')
  await page.fill('#frekans-add-input', 'cikacak.ornek.com')
  await page.click('#frekans-add-submit')
  await page.waitForFunction(() => !document.getElementById('frekans-add-input'))
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('telsiz.frekanslar')))
  assert.deepEqual(stored, [{ origin: W.other.base, name: null }, { origin: 'https://cikacak.ornek.com', name: null }])
  await openMenu(page)
  const hosts = await page.evaluate(() => Array.from(document.querySelectorAll('#frekans-menu .frekans-item .frekans-item-name')).map((n) => n.textContent))
  assert.deepEqual(hosts, ['Kankalar', W.other.base.replace('http://', ''), 'cikacak.ornek.com'])
  await page.click('#frekans-menu .frekans-remove[data-frekans-remove="https://cikacak.ornek.com"]')
  await page.waitForSelector('#frekans-remove-confirm')
  // Tarayıcıda başka kökenin verisi silinemez: veri silme seçeneği yalnızca masaüstünde
  assert.equal(await page.$('#frekans-remove-clear'), null)
  await page.click('#frekans-remove-cancel')
  await page.waitForFunction(() => !document.getElementById('frekans-remove-confirm'))
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('telsiz.frekanslar')))).length, 2, 'vazgeçince silinmez')
  await openMenu(page)
  await page.click('#frekans-menu .frekans-remove[data-frekans-remove="https://cikacak.ornek.com"]')
  await page.click('#frekans-remove-confirm')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('telsiz.frekanslar')).length === 1)
})

test('telefon 390: menü ekrana sığar, yatay taşma yok', async () => {
  const page = W.page
  await page.setViewportSize({ width: 390, height: 844 })
  await openMenu(page)
  const box = await page.evaluate(() => {
    const r = document.getElementById('frekans-menu').getBoundingClientRect()
    return { left: r.left, right: r.right, bottom: r.bottom, vw: window.innerWidth, vh: window.innerHeight }
  })
  assert.ok(box.left >= 0 && box.right <= box.vw && box.bottom <= box.vh, JSON.stringify(box))
  assert.ok(await h.overflowX(page) <= 0)
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('başka frekans seçilince sekme o kökene gider, liste parçayla taşınır ve parça adresten silinir', async () => {
  const page = W.page
  await openMenu(page)
  await Promise.all([
    page.waitForURL((url) => url.origin === W.other.base),
    page.click('#frekans-menu .frekans-item[data-frekans="' + W.other.base + '"]')
  ])
  // İkinci sunucuda hesap yok: kurulum ekranı görünür, parça açılışta okunur
  await page.waitForSelector('#setup-card:not([hidden])', { timeout: h.LONG })
  const r = await page.evaluate(() => ({ hash: window.location.hash, href: window.location.href, list: JSON.parse(localStorage.getItem('telsiz.frekanslar')) }))
  assert.equal(r.hash, '')
  assert.equal(r.href, W.other.base + '/')
  assert.deepEqual(r.list, [{ origin: W.w.base, name: 'Kankalar' }])
  // Davet bağlantısının parçaları frekans listesiyle birlikte de çalışır
  const list = Buffer.from(JSON.stringify({ v: 1, f: [['https://yeni.ornek.com', 'Yeni']] })).toString('base64url')
  // Aynı adrese yalnızca # değişikliğiyle gitmek sayfayı yeniden yüklemez, önce boş sayfaya gidilir
  await page.goto('about:blank')
  await page.goto(W.other.base + '/#davet=KOD-42&frekanslar=' + list)
  await page.waitForSelector('#setup-card:not([hidden])', { timeout: h.LONG })
  const s = await page.evaluate(() => ({ hash: window.location.hash, invite: sessionStorage.getItem('telsiz.invite'), list: JSON.parse(localStorage.getItem('telsiz.frekanslar')) }))
  assert.deepEqual(s, { hash: '', invite: 'KOD-42', list: [{ origin: W.w.base, name: 'Kankalar' }, { origin: 'https://yeni.ornek.com', name: 'Yeni' }] })
})

test('konsol ve sunucu günlükleri temiz', async () => {
  h.assertCleanConsole(W.w.logs, W.w.srv.errors)
  assert.deepEqual(W.other.errors, [])
})
