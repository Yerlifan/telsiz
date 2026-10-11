'use strict'

// Ayarlar: avatar menüsünden Görünüm, tema ve mod (koyu, açık) değişimi ve yeniden yüklemede korunması, dilin
// Türkçeden İngilizceye geçmesi (arayüz metinleri değişir, eksik anahtar uyarısı ve ekranda anahtar adı görünmez).
// Temalar (istek 11): on tema kartının her biri tıklanınca tema ve zemin değişir, kartlar Telsiz Temaları ve
// Erişilebilirlik gruplarındadır, açıklama yalnızca seçili kartta görünür, seçim yeniden yüklemede korunur. Her tema
// ve modda 1440 ve 390 piksel genişlikte yatay taşma yoktur ve Gönder düğmesinde tek bir simge görünür (telefonda
// etiket gizlenince düğmenin tek işareti). Sistem yüksek karşıtlık istiyorsa (prefers-contrast: more veya
// forced-colors: active öykünmesi) saklı tema yokken ilk açılışta Yüksek Kontrast seçilir, saklı tema önce gelir.

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

test('her tema kartı tıklanınca tema ve zemin değişir, kartlar gruplu, seçim yeniden yüklemede korunur', async () => {
  const page = W.page
  const skins = await page.evaluate(() => window.TelsizTheme.skins.slice())
  assert.equal(skins.length, 10, 'on tema')
  await openAppearance(page)
  const groups = await page.evaluate(() => Array.from(document.querySelectorAll('#set-skin-section .settings-theme-group')).map((g) => ({
    id: g.getAttribute('data-skin-group'),
    title: document.getElementById(g.getAttribute('aria-labelledby')).textContent,
    skins: Array.from(g.querySelectorAll('label[data-skin-choice]')).map((n) => n.getAttribute('data-skin-choice'))
  })))
  assert.deepEqual(groups.map((g) => [g.id, g.title]), [['radio', 'Telsiz Temaları'], ['access', 'Erişilebilirlik']])
  assert.deepEqual(groups[1].skins, ['kontrast'])
  assert.deepEqual(groups[0].skins.concat(groups[1].skins).sort(), skins.slice().sort())
  const backgrounds = {}
  for (const skin of skins) {
    await page.click('label[for="set-skin-' + skin + '"]')
    await page.waitForFunction((s) => document.documentElement.getAttribute('data-skin') === s, skin)
    const r = await page.evaluate((s) => {
      const visibleHints = Array.from(document.querySelectorAll('#set-skin-section .settings-theme-hint')).filter((n) => n.getClientRects().length > 0).map((n) => n.id)
      return {
        bg: getComputedStyle(document.body).backgroundColor,
        checked: document.getElementById('set-skin-' + s).checked,
        selected: document.querySelector('label[data-skin-choice="' + s + '"]').classList.contains('is-selected'),
        hints: visibleHints,
        describedBy: Array.from(document.querySelectorAll('input[name="set-skin"]')).every((n) => document.getElementById(n.getAttribute('aria-describedby')))
      }
    }, skin)
    assert.equal(r.checked, true, skin + ' seçili')
    assert.equal(r.selected, true, skin + ' kartı işaretli')
    assert.deepEqual(r.hints, ['set-skin-' + skin + '-hint'], skin + ': açıklama yalnızca seçili kartta görünür')
    assert.equal(r.describedBy, true, 'her kartın açıklaması aria-describedby ile bağlı')
    backgrounds[skin] = r.bg
  }
  assert.equal(new Set(Object.values(backgrounds)).size, skins.length, 'her temanın zemini farklı: ' + JSON.stringify(backgrounds))
  await page.click('label[for="set-skin-saha"]')
  await page.waitForFunction(() => document.documentElement.getAttribute('data-skin') === 'saha')
  await closeSettings(page)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-skin')), 'saha', 'seçim yeniden yüklemede korunur')
})

test('her tema ve modda 1440 ve 390 piksel genişlikte yatay taşma yok, Gönder düğmesinde tek simge görünür', async () => {
  const page = W.page
  await page.waitForSelector('#band-track .station[data-station]', { timeout: h.LONG })
  const skins = await page.evaluate(() => window.TelsizTheme.skins.slice())
  const problems = []
  for (const size of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size)
    for (const skin of skins) {
      for (const scheme of ['dark', 'light']) {
        await page.evaluate((a) => window.TelsizTheme.set({ skin: a[0], scheme: a[1] }), [skin, scheme])
        await page.waitForFunction((a) => document.documentElement.getAttribute('data-skin') === a[0] && document.documentElement.getAttribute('data-scheme') === a[1], [skin, scheme])
        const overflow = await h.overflowX(page)
        if (overflow > 0) problems.push(size.width + ' ' + skin + ' ' + scheme + ': yatay taşma ' + overflow)
        const icons = await page.evaluate(() => Array.from(document.querySelectorAll('#btn-send .icon')).filter((n) => n.getClientRects().length > 0 && n.getBoundingClientRect().width > 0).length)
        if (icons !== 1) problems.push(size.width + ' ' + skin + ' ' + scheme + ': Gönder düğmesinde görünen simge ' + icons)
      }
    }
    // Görünüm sayfası da taşmaz
    await openAppearance(page)
    const settingsOverflow = await h.overflowX(page)
    if (settingsOverflow > 0) problems.push(size.width + ' ayarlar: yatay taşma ' + settingsOverflow)
    await closeSettings(page)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  assert.deepEqual(problems, [])
})

test('sistem yüksek karşıtlık istiyorsa saklı tema yokken ilk açılışta Yüksek Kontrast seçilir', async () => {
  const page = W.page
  const reload = async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
    return page.evaluate(() => document.documentElement.getAttribute('data-skin'))
  }
  // Öykünme olmadan saklı tema yoksa varsayılan Arcade
  await page.evaluate(() => localStorage.removeItem('telsiz.skin'))
  assert.equal(await reload(), 'arcade')
  await page.emulateMedia({ contrast: 'more' })
  assert.equal(await page.evaluate(() => matchMedia('(prefers-contrast: more)').matches), true, 'prefers-contrast öykünmesi çalışır')
  assert.equal(await reload(), 'kontrast', 'prefers-contrast: more')
  assert.equal(await page.evaluate(() => localStorage.getItem('telsiz.skin')), null, 'otomatik seçim saklanmaz')
  await page.emulateMedia({ contrast: null, forcedColors: 'active' })
  assert.equal(await reload(), 'kontrast', 'forced-colors: active')
  // Saklı tema sistem ayarının önüne geçer
  await page.emulateMedia({ contrast: 'more', forcedColors: null })
  await page.evaluate(() => localStorage.setItem('telsiz.skin', 'gece'))
  assert.equal(await reload(), 'gece')
  await page.emulateMedia({ contrast: null, forcedColors: null })
  await page.evaluate(() => window.TelsizTheme.set({ skin: 'turkuaz', scheme: 'light' }))
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
