'use strict'

// Ayarlar: avatar menüsünden Görünüm, tema (arcade, gece, turkuaz) ve mod (koyu, açık) değişimi ve
// yeniden yüklemede korunması, dilin Türkçeden İngilizceye geçmesi (arayüz metinleri değişir, eksik
// anahtar uyarısı ve ekranda anahtar adı görünmez).

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { w: null, page: null }
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []))

// Görünür metinde i18n anahtarına benzeyen parçalar (ör. "band.allTitle", "radio.state.off")
function keyLikeTokens () {
  const text = document.body.innerText
  const found = text.match(/\b[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*){1,4}\b/g) || []
  return found.filter((s) => !/^\d/.test(s))
}

async function openAppearance (page) {
  await page.click('#me-button')
  await page.waitForSelector('#status-menu:not([hidden]) #menu-appearance')
  await page.click('#menu-appearance')
  await page.waitForSelector('#settings-view:not([hidden]) #set-skin-gece', { state: 'attached' })
}

async function closeSettings (page) {
  await page.keyboard.press('Escape')
  await page.waitForSelector('#settings-view', { state: 'hidden' })
}

before(async () => {
  W.w = await h.setupWorld({ slot: 3 })
  W.page = await W.w.pageFor('deniz')
})

after(async () => {
  if (W.w) await W.w.close()
})

test('Görünüm sayfası avatar menüsünden açılır, tema ve mod değişir', async () => {
  const page = W.page
  await openAppearance(page)
  const before = await page.evaluate(() => ({ skin: document.documentElement.getAttribute('data-skin'), scheme: document.documentElement.getAttribute('data-scheme'), bg: getComputedStyle(document.body).backgroundColor }))
  assert.deepEqual([before.skin, before.scheme], ['arcade', 'dark'])
  await page.click('label[for="set-skin-gece"]')
  await page.waitForFunction(() => document.documentElement.getAttribute('data-skin') === 'gece')
  await page.click('label[for="set-scheme-light"]')
  await page.waitForFunction(() => document.documentElement.getAttribute('data-scheme') === 'light')
  const after = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, checked: document.getElementById('set-skin-gece').checked }))
  assert.notEqual(after.bg, before.bg, 'zemin rengi değişti')
  assert.equal(after.checked, true)
  await page.click('label[for="set-skin-turkuaz"]')
  await page.waitForFunction(() => document.documentElement.getAttribute('data-skin') === 'turkuaz')
  await closeSettings(page)
})

test('tema ve mod yeniden yüklemede korunur', async () => {
  const page = W.page
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  const r = await page.evaluate(() => [document.documentElement.getAttribute('data-skin'), document.documentElement.getAttribute('data-scheme')])
  assert.deepEqual(r, ['turkuaz', 'light'])
})

test('dil Türkçeden İngilizceye geçer, arayüz metinleri değişir', async () => {
  const page = W.page
  await page.waitForSelector('#band-track .station[data-station]', { timeout: h.LONG })
  const tr = await page.evaluate(() => ({ groups: Array.from(document.querySelectorAll('#band-track .band-group-label')).map((n) => n.textContent), rooms: Array.from(document.querySelectorAll('#inbox-list .rooms-group-title')).map((n) => n.textContent), radio: document.getElementById('radio-state').textContent, placeholder: document.getElementById('composer-input').getAttribute('placeholder') }))
  assert.deepEqual(tr.groups, ['Frekanslar'])
  assert.deepEqual(tr.rooms, ['Yazı odaları', 'Ses odaları'])
  await openAppearance(page)
  await page.selectOption('#set-lang', 'en')
  await page.waitForFunction(() => document.documentElement.lang === 'en')
  const heading = await page.evaluate(() => document.getElementById('set-skin-section-title').textContent)
  assert.ok(!/[çğıİöşüÇĞÖŞÜ]/.test(heading), 'ayarlar başlığı İngilizce: ' + heading)
  await closeSettings(page)
  const en = await page.evaluate(() => ({
    groups: Array.from(document.querySelectorAll('#band-track .band-group-label')).map((n) => n.textContent),
    rooms: Array.from(document.querySelectorAll('#inbox-list .rooms-group-title')).map((n) => n.textContent),
    station: document.querySelector('#band-track .station.is-tuned').getAttribute('aria-label'),
    radio: document.getElementById('radio-state').textContent,
    all: document.querySelector('.band-all-text').textContent,
    inbox: document.getElementById('inbox-title').textContent,
    placeholder: document.getElementById('composer-input').getAttribute('placeholder')
  }))
  assert.deepEqual(en.groups, ['Frequencies'])
  assert.deepEqual(en.rooms, ['Text rooms', 'Voice rooms'])
  assert.match(en.station, /, Open Frequency/)
  assert.deepEqual([en.radio, en.all, en.inbox], ['Radio · off', 'All', 'Stations'])
  assert.notEqual(en.placeholder, tr.placeholder, 'yazma alanı yer tutucusu çevrildi')
})

test('İngilizce arayüzde Türkçe kalıntı ve anahtar adı yok', async () => {
  const page = W.page
  const leftovers = await page.evaluate(() => {
    const out = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let n = walker.nextNode()
    while (n) {
      const p = n.parentElement
      if (p && p.getClientRects().length && !p.closest('[hidden]') && !p.closest('[lang]:not(html)') && /[çğıİöşüÇĞÖŞÜ]/.test(n.textContent)) out.push(n.textContent.trim())
      n = walker.nextNode()
    }
    return out
  })
  assert.deepEqual(leftovers, [], 'görünür Türkçe metin')
  assert.deepEqual(await page.evaluate(keyLikeTokens), [], 'ekranda i18n anahtarı')
  // Ayarlar, Frekanslar (Tümü) ve İstasyonlar sayfaları da İngilizce
  await page.click('#band-all')
  await page.waitForSelector('#frekans-sheet:not([hidden])')
  assert.deepEqual(await page.evaluate(keyLikeTokens), [], 'Frekanslar sayfasında i18n anahtarı')
  await page.keyboard.press('Escape')
  await page.waitForSelector('#frekans-sheet', { state: 'hidden' })
  await page.evaluate(() => openSheet('stations', null))
  await page.waitForSelector('#stations-sheet:not([hidden])')
  assert.deepEqual(await page.evaluate(keyLikeTokens), [], 'İstasyonlar sayfasında i18n anahtarı')
  await page.keyboard.press('Escape')
  await page.waitForSelector('#stations-sheet', { state: 'hidden' })
  await page.evaluate(() => openSettings('account', null))
  await page.waitForSelector('#settings-view:not([hidden])')
  assert.deepEqual(await page.evaluate(keyLikeTokens), [], 'ayarlarda i18n anahtarı')
  await closeSettings(page)
})

test('konsol ve sunucu günlüğü temiz (eksik i18n anahtarı uyarısı yok)', async () => {
  h.assertCleanConsole(W.w.logs, W.w.srv.errors)
})
