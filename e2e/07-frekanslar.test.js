'use strict'

// Frekanslar (web): iki ayrı Telsiz sunucusu iki ayrı köken, yani iki frekanstır. Üstteki bant katılınan
// frekansları dizer. Bandın + düğmesiyle Frekans ekle (adres doğrulaması), Frekanslar sayfasında listeden
// çıkarma, frekans adındaki menünün bilgi ve kısayolları, bantta başka frekansı seçince sekmenin o kökene
// gitmesi, listenin bant sırasıyla adresin # parçasında taşınıp karşı kökende yerel listeye eklenmesi ve
// parçanın adresten silinmesi, dönüşte sıranın korunması, telefon genişliği. Ayrıca masaüstünün arka plan
// penceresinde çalışan istemci kipi (public/js/25-arka-plan.js) tarayıcıda sahte telsizArkaPlan nesnesiyle
// sınanır: arayüz açılmadan okunmamış ve anma sayıları raporlanır, geçersiz oturumda "giriş gerekli"
// bildirilir ve oturum bilgisine dokunulmaz. Konsol temiz olmalıdır.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const h = require('./yardimci')

const W = { w: null, other: null, otherOwner: null, page: null, ctx: null, bg: null }
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []))

// Oturum her kökende o sunucunun hesabıyla açılır (port kökeni ayırır). İlk yüklemede bir kez yazılır.
const initScript = (v) => {
  // about:blank gibi kökensiz sayfalarda depolama yoktur
  if (window.location.protocol !== 'http:' || sessionStorage.getItem('e2e.init')) return
  const p = v.ports[window.location.port]
  if (p) {
    localStorage.setItem('telsiz.token', p.token)
    localStorage.setItem('telsiz.identity.' + p.id, p.identity)
  }
  localStorage.setItem('telsiz.skin', 'arcade')
  localStorage.setItem('telsiz.scheme', 'dark')
  sessionStorage.setItem('e2e.init', '1')
}

// Masaüstünün arka plan penceresindeki ön yükleme nesnesinin yerine: yalnızca ?arka-plan adresinde
const bgInitScript = (v) => {
  if (window.location.search !== '?arka-plan') return
  window.__raporlar = []
  window.__acilis = 0
  window.telsizArkaPlan = Object.freeze({
    background: true,
    origin: v.origin,
    report: (r) => {
      window.__raporlar.push(JSON.parse(JSON.stringify(r)))
    },
    open: () => {
      window.__acilis += 1
      return Promise.resolve({ ok: true })
    }
  })
}

const bandKeys = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#band-track .station[data-station]')).map((n) => [n.getAttribute('data-station'), n.classList.contains('is-tuned')]))

async function closeLayers (page) {
  if (await page.evaluate(() => !document.getElementById('frekans-menu').hidden || Boolean(document.querySelector('#dialog-root .app-dialog')) || !document.getElementById('frekans-sheet').hidden)) {
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.getElementById('frekans-menu').hidden && !document.querySelector('#dialog-root .app-dialog') && document.getElementById('frekans-sheet').hidden)
  }
}

async function openMenu (page) {
  await closeLayers(page)
  await page.click('#frekans-button')
  await page.waitForSelector('#frekans-menu:not([hidden]) .frekans-entry')
}

async function addFrekans (page, address, errorText) {
  await closeLayers(page)
  await page.click('#band-add')
  await page.waitForSelector('#frekans-add-input')
  await page.waitForFunction(() => document.activeElement.id === 'frekans-add-input')
  await page.fill('#frekans-add-input', address)
  await page.click('#frekans-add-submit')
  if (errorText) {
    await page.waitForFunction((text) => {
      const m = document.getElementById('frekans-add-error')
      return !m.hidden && m.textContent.indexOf(text) !== -1
    }, errorText)
    return
  }
  await page.waitForFunction(() => !document.getElementById('frekans-add-input'))
}

before(async () => {
  W.w = await h.setupWorld({ slot: 7 })
  W.other = await h.startServer(null, 8)
  // İkinci frekansta da Deniz'in hesabı var (anahtarsız): bant orada da görünür
  const crypt = h.loadE2EE()
  W.otherOwner = await h.createAccount(W.other, crypt, 'deniz', 'parola-deniz-2', 'setupCode', h.SETUP_CODE)
  await h.call(W.other.port, 'POST', '/api/settings', { serverName: 'Oyun Gecesi' }, W.otherOwner.token)
  const p = W.w.P.deniz
  const o = W.otherOwner
  const ports = {}
  ports[String(W.w.port)] = { token: p.token, id: p.id, identity: p.identity }
  ports[String(W.other.port)] = { token: o.token, id: o.id, identity: o.identity }
  const context = await W.w.tb.browser.newContext({ locale: 'tr-TR', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await context.addInitScript(initScript, { ports })
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

test('frekans adı menüsü: açık frekansın bilgisi ve kısayollar, oklar gezer, Esc kapatır, odak düğmeye döner', async () => {
  const page = W.page
  await page.waitForFunction(() => document.getElementById('frekans-button').getAttribute('aria-label') === 'Kankalar frekansı. Frekansları göster')
  await page.waitForFunction(() => {
    const n = document.querySelector('#server-meta .server-members')
    return n && n.textContent === 'Frekans · 3 üye'
  })
  await openMenu(page)
  assert.equal(await page.getAttribute('#frekans-button', 'aria-expanded'), 'true')
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'frekans-menu-all')
  const r = await page.evaluate(() => ({
    name: document.querySelector('#frekans-menu .frekans-menu-head .frekans-item-name').textContent,
    sub: document.querySelector('#frekans-menu .frekans-menu-head .frekans-item-sub').textContent,
    entries: Array.from(document.querySelectorAll('#frekans-menu .frekans-entry')).map((b) => b.id),
    list: document.querySelectorAll('#frekans-menu [data-frekans]').length
  }))
  assert.equal(r.name, 'Kankalar')
  assert.match(r.sub, /^127\.0\.0\.1:\d+ · 3 üye · \d çevrimiçi$/)
  assert.deepEqual(r.entries, ['frekans-menu-all', 'frekans-add', 'frekans-menu-settings', 'frekans-menu-invite', 'frekans-menu-keys'])
  assert.equal(r.list, 0, 'menü frekans listesini tekrarlamaz (bant ve Tümü sayfası)')
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => document.activeElement.id), 'frekans-add')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.getElementById('frekans-menu').hidden && document.activeElement.id === 'frekans-button')
  assert.equal(await page.getAttribute('#frekans-button', 'aria-expanded'), 'false')
  // Tüm frekanslar Frekanslar sayfasını açar
  await openMenu(page)
  await page.click('#frekans-menu-all')
  await page.waitForSelector('#frekans-sheet:not([hidden]) .frekans-sheet-row[aria-current="page"]')
  await page.keyboard.press('Escape')
  await page.waitForSelector('#frekans-sheet', { state: 'hidden' })
})

test('bandın + düğmesi Frekans ekle: geçersiz adres reddedilir, eklenen frekans bantta görünür, sayfadan çıkarılır', async () => {
  const page = W.page
  await addFrekans(page, 'http://kotu.ornek.com', 'http:// yalnızca')
  await page.fill('#frekans-add-input', 'https://a.com/yol')
  await page.click('#frekans-add-submit')
  await page.waitForFunction(() => document.getElementById('frekans-add-error').textContent.indexOf('Yalnızca frekansın ana adresini') !== -1)
  await page.fill('#frekans-add-input', W.w.base)
  await page.click('#frekans-add-submit')
  await page.waitForFunction(() => document.getElementById('frekans-add-error').textContent.indexOf('zaten listede') !== -1)
  await page.fill('#frekans-add-input', W.other.base + '/')
  await page.click('#frekans-add-submit')
  await page.waitForFunction(() => !document.getElementById('frekans-add-input'))
  await addFrekans(page, 'cikacak.ornek.com')
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('telsiz.frekanslar')))
  assert.deepEqual(stored, [{ origin: W.other.base, name: null }, { origin: 'https://cikacak.ornek.com', name: null }])
  assert.deepEqual(await bandKeys(page), [[W.w.base, true], [W.other.base, false], ['https://cikacak.ornek.com', false]])
  const other = await page.evaluate((o) => {
    const n = document.querySelector('#band-track .station[data-station="' + o + '"]')
    return { name: n.querySelector('.station-name').textContent, sub: n.querySelector('.station-sub').textContent, dot: n.querySelector('.frekans-dot').className, marks: n.querySelectorAll('.station-mark').length }
  }, W.other.base)
  assert.deepEqual(other, { name: W.other.base.replace('http://', ''), sub: 'geçmek için seçin', dot: 'frekans-dot is-unknown', marks: 0 })
  // Frekanslar sayfasında çıkarma onay ister, tarayıcıda veri silme seçeneği yoktur
  await page.click('#band-all')
  await page.waitForSelector('#frekans-sheet:not([hidden])')
  await page.click('#frekans-sheet-list .frekans-remove[data-frekans-remove="https://cikacak.ornek.com"]')
  await page.waitForSelector('#frekans-remove-confirm')
  assert.equal(await page.$('#frekans-remove-clear'), null)
  await page.click('#frekans-remove-cancel')
  await page.waitForFunction(() => !document.getElementById('frekans-remove-confirm'))
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem('telsiz.frekanslar')))).length, 2, 'vazgeçince silinmez')
  await page.click('#frekans-sheet-list .frekans-remove[data-frekans-remove="https://cikacak.ornek.com"]')
  await page.click('#frekans-remove-confirm')
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('telsiz.frekanslar')).length === 1)
  await page.waitForFunction(() => document.querySelectorAll('#band-track .station[data-station]').length === 2)
  await closeLayers(page)
})

test('telefon 390: menü ekrana sığar, bant ve Frekanslar sayfası yatay taşmaz', async () => {
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
  await page.click('#band-all')
  await page.waitForSelector('#frekans-sheet:not([hidden])')
  assert.ok(await h.overflowX(page) <= 0)
  await page.keyboard.press('Escape')
  await page.waitForSelector('#frekans-sheet', { state: 'hidden' })
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('bantta başka frekansı seçmek o sunucuya geçer, liste parçayla taşınır, dönüşte sıra korunur', async () => {
  const page = W.page
  await Promise.all([
    page.waitForURL((url) => url.origin === W.other.base, { timeout: h.LONG }),
    h.clickStation(page, W.other.base)
  ])
  // İkinci sunucuda grup anahtarı yok: anahtar ekranı atlanır, uygulama ve bant açılır
  await page.waitForSelector('#key-card:not([hidden]) #key-skip, #app-view:not([hidden])', { timeout: h.LONG })
  if (await page.$('#key-card:not([hidden])')) await page.click('#key-skip')
  await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  await page.waitForFunction(() => document.querySelectorAll('#band-track .station[data-station]').length === 2, null, { timeout: h.LONG })
  const r = await page.evaluate(() => ({
    hash: window.location.hash,
    href: window.location.href,
    list: JSON.parse(localStorage.getItem('telsiz.frekanslar')),
    pos: localStorage.getItem('telsiz.frekanslar.konum'),
    names: Array.from(document.querySelectorAll('#band-track .station .station-name')).map((n) => n.textContent)
  }))
  assert.equal(r.hash, '')
  assert.equal(r.href, W.other.base + '/')
  assert.deepEqual(r.list, [{ origin: W.w.base, name: 'Kankalar' }])
  assert.equal(r.pos, '1', 'bu frekans bantta ikinci sırada')
  assert.deepEqual(await bandKeys(page), [[W.w.base, false], [W.other.base, true]], 'bant sırası her kökende aynı')
  assert.deepEqual(r.names, ['Kankalar', 'Oyun Gecesi'])
  // Önceki frekans düğmesi geri döner
  assert.equal(await page.getAttribute('#band-prev', 'aria-label'), 'Önceki frekans: Kankalar')
  await Promise.all([
    page.waitForURL((url) => url.origin === W.w.base, { timeout: h.LONG }),
    page.click('#band-prev')
  ])
  await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  await page.waitForFunction(() => document.querySelectorAll('#band-track .station[data-station]').length === 2, null, { timeout: h.LONG })
  assert.deepEqual(await bandKeys(page), [[W.w.base, true], [W.other.base, false]])
  assert.equal(await page.evaluate(() => window.location.hash), '')
  // Davet bağlantısının parçaları frekans listesiyle birlikte de çalışır
  const list = Buffer.from(JSON.stringify({ v: 1, f: [['https://yeni.ornek.com', 'Yeni']] })).toString('base64url')
  await page.goto('about:blank')
  await page.goto(W.other.base + '/#davet=KOD-42&frekanslar=' + list)
  await page.waitForSelector('#key-card:not([hidden]), #app-view:not([hidden])', { timeout: h.LONG })
  const s = await page.evaluate(() => ({ hash: window.location.hash, invite: sessionStorage.getItem('telsiz.invite'), list: JSON.parse(localStorage.getItem('telsiz.frekanslar')) }))
  assert.deepEqual(s, { hash: '', invite: 'KOD-42', list: [{ origin: W.w.base, name: 'Kankalar' }, { origin: 'https://yeni.ornek.com', name: 'Yeni' }] })
})

test('arka plan kipi: arayüz açılmadan okunmamış ve anma sayıları raporlanır', async () => {
  const p = W.w.P.deniz
  const ports = {}
  ports[String(W.w.port)] = { token: p.token, id: p.id, identity: p.identity }
  const context = await W.w.tb.browser.newContext({ locale: 'tr-TR', viewport: { width: 800, height: 600 }, deviceScaleFactor: 1 })
  await context.addInitScript(initScript, { ports })
  await context.addInitScript(bgInitScript, { origin: W.w.base })
  const page = await context.newPage()
  page.setDefaultTimeout(h.SHORT)
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') W.w.logs.push({ label: 'arka-plan', type: m.type(), text: m.text() })
  })
  page.on('pageerror', (e) => W.w.logs.push({ label: 'arka-plan', type: 'pageerror', text: e.message }))
  W.w.pages.push({ label: 'arka-plan', page })
  W.bg = page
  // Önce normal açılış: anahtar bu kökenin anahtarlığına eklenir (genel odası okunur)
  await page.goto(W.w.base + '/#anahtar=' + encodeURIComponent(W.w.keyCode))
  await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  await page.waitForFunction(() => !state.loading && state.channelId !== null)
  const R = { genel: W.w.room('genel'), gece: W.w.room('oyun-gecesi'), foto: W.w.room('fotograflar') }
  // Açılış taraması bunu sayar
  await W.w.say('ece', R.gece, 'arka plan açılmadan önce')
  await page.goto(W.w.base + '/?arka-plan')
  await page.waitForFunction(() => window.__raporlar && window.__raporlar.some((r) => r.state === 'ok'), null, { timeout: h.LONG })
  await page.waitForFunction(() => window.__raporlar[window.__raporlar.length - 1].unread === 1, null, { timeout: h.LONG })
  // Poll ile gelen mesajlar: biri oda mesajı, biri anma, biri kendi mesajım (sayılmaz)
  await W.w.say('ece', R.genel, 'merhaba')
  await W.w.say('mert', R.foto, '@deniz bu kareye bak')
  await W.w.say('deniz', R.genel, 'kendi mesajım')
  await page.waitForFunction(() => {
    const r = window.__raporlar[window.__raporlar.length - 1]
    return r.unread === 3 && r.mention === 1
  }, null, { timeout: h.LONG })
  const r = await page.evaluate(() => ({
    last: window.__raporlar[window.__raporlar.length - 1],
    first: window.__raporlar[0],
    count: window.__raporlar.length,
    app: document.getElementById('app-view').hidden,
    inApp: state.inApp,
    voice: voice === null,
    band: document.querySelectorAll('#band-track .station[data-station]').length,
    read: localStorage.getItem('telsiz.read.' + state.me.id)
  }))
  assert.deepEqual(r.last, { origin: W.w.base, state: 'ok', unread: 3, mention: 1, online: true, lastError: null, name: 'Kankalar', onlineUsers: r.last.onlineUsers })
  assert.ok(typeof r.last.onlineUsers === 'number' && r.last.onlineUsers >= 1)
  assert.deepEqual([r.first.state, r.first.origin], ['starting', W.w.base])
  assert.ok(r.count < 15, 'raporlar seyreltilir: ' + r.count)
  assert.deepEqual([r.app, r.inApp, r.voice, r.band], [true, false, true, 0], 'arayüz ve ses başlatılmaz')
  const lastRead = JSON.parse(r.read || '{}')
  assert.equal(lastRead[R.foto.id], undefined, 'arka plan son okunanı yazmaz')
})

test('arka plan kipi: geçersiz oturumda giriş gerekli bildirilir, oturum bilgisine dokunulmaz', async () => {
  const page = W.bg
  await page.evaluate(() => localStorage.setItem('telsiz.token', 'gecersiz-oturum'))
  await page.reload()
  await page.waitForFunction(() => window.__raporlar && window.__raporlar.some((r) => r.state === 'login'), null, { timeout: h.LONG })
  const r = await page.evaluate(() => ({ last: window.__raporlar[window.__raporlar.length - 1], token: localStorage.getItem('telsiz.token'), app: document.getElementById('app-view').hidden, auth: document.getElementById('auth-view').hidden }))
  assert.deepEqual(r.last, { origin: W.w.base, state: 'login', unread: 0, mention: 0, online: true, lastError: 'session', name: 'Kankalar', onlineUsers: null })
  assert.equal(r.token, 'gecersiz-oturum', 'oturum bilgisi silinmez')
  assert.deepEqual([r.app, r.auth], [true, true], 'giriş ekranı da açılmaz')
  // Döngü durmuştur: yeni rapor gelmez
  const n = await page.evaluate(() => window.__raporlar.length)
  await page.waitForTimeout(1500)
  assert.equal(await page.evaluate(() => window.__raporlar.length), n)
})

test('konsol ve sunucu günlükleri temiz', async () => {
  // Geçersiz oturum denemesindeki 401 yanıtını tarayıcı kendisi konsola yazar (beklenen)
  h.assertCleanConsole(W.w.logs, W.w.srv.errors, [(e) => e.label === 'arka-plan' && /status of 401/.test(e.text)])
  assert.deepEqual(W.other.errors, [])
})
