'use strict'

// Otomatik boşta (public/js/40-bosta.js, src/hub.js) gerçek tarayıcıda. Ece'nin sayfasında sayfa açılmadan önce
// Playwright saati kurulur (page.clock.install, saat doğal akar), hareketsizlik page.clock.fastForward ile ileri
// alınır. Deniz'in sayfası gerçek saatle çalışır ve Ece'yi Çevrimiçi listesinde izler.
// - 10 dakika ileri alınınca Deniz Ece'yi Boşta görür, Ece kendi durumunu "Boşta (otomatik)" görür ve elle seçtiği
//   durum Çevrimiçi kalır. Ece sayfaya tıklayınca Deniz onu yeniden Çevrimiçi görür.
// - Ses odasındayken boşta olunmaz (sahte mikrofon yalnızca Chromium bayraklarıyla)
// - Ayarlar > Gizlilik: anahtar kapalıyken hiç boşta olunmaz, 5 dakika seçilince 5 dakikada boşa geçilir
// - Konsol ve sunucu günlüğü temiz

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { w: null, deniz: null, ece: null, eceId: null, lobi: null }
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []))

// Kişinin Deniz'in Çevrimiçi listesindeki durumu (ses odasındaysa ses odası grubunda)
function memberStatus (id) {
  const row = document.querySelector('#members .member[data-user-id="' + id + '"]')
  return row ? row.getAttribute('data-status') : null
}

async function seenAs (status) {
  await W.deniz.waitForFunction((a) => {
    const row = document.querySelector('#members .member[data-user-id="' + a.id + '"]')
    return Boolean(row) && row.getAttribute('data-status') === a.status
  }, { id: W.eceId, status }, { timeout: h.LONG })
}

// Sayfanın etkileşimsiz bir yerine (konuşma başlığı) tıklanır
async function touch (page) {
  await page.click('#channel-title', { force: true })
}

// Saati kurulmuş sayfa: anahtar adres parçasıyla eklenir, uygulama ve bant beklenir (yardimci.js pageFor gibi)
async function clockPage (who) {
  const w = W.w
  const page = await w.tb.newPage(who, { person: w.P[who], extra: { 'telsiz.skin': 'arcade', 'telsiz.scheme': 'dark' } })
  await page.clock.install()
  await page.goto(w.base + '/#anahtar=' + encodeURIComponent(w.keyCode), { timeout: h.LONG, waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  await page.waitForSelector('#band-track .station[data-station]', { timeout: h.LONG })
  return page
}

async function openPrivacy (page) {
  await page.evaluate(() => openSettings('privacy', null))
  await page.waitForSelector('#settings-view:not([hidden]) #set-auto-idle', { state: 'attached' })
}

async function closeSettings (page) {
  await page.keyboard.press('Escape')
  await page.waitForSelector('#settings-view', { state: 'hidden' })
}

before(async () => {
  W.w = await h.setupWorld({ slot: 25 })
  W.eceId = W.w.P.ece.id
  W.lobi = W.w.room('Lobi')
  W.deniz = await W.w.pageFor('deniz')
  W.ece = await clockPage('ece')
})

after(async () => {
  if (W.w) await W.w.close()
})

test('10 dakika hareketsiz kalınca Deniz Ece\'yi Boşta görür, Ece tıklayınca geri döner', async () => {
  const { ece } = W
  await seenAs('online')
  assert.equal(await ece.evaluate(() => idlePollParam()), '0')
  await ece.clock.fastForward('09:00')
  assert.equal(await ece.evaluate(() => idlePollParam()), '0', '9 dakika yetmez')
  await ece.clock.fastForward('01:30')
  await ece.waitForFunction(() => idlePollParam() === '1')
  await seenAs('idle')
  // Ece kendi durumunu "Boşta (otomatik)" görür, seçtiği durum Çevrimiçi kalır
  await ece.waitForFunction(() => document.getElementById('me-status').textContent === 'Boşta (otomatik)', null, { timeout: h.LONG })
  assert.equal(await ece.evaluate(() => myChosenStatus()), 'online')
  assert.equal(await ece.getAttribute('#me-avatar', 'data-status'), 'idle')
  // Tıklayınca hemen geri döner
  await touch(ece)
  assert.equal(await ece.evaluate(() => idlePollParam()), '0')
  await seenAs('online')
  await ece.waitForFunction(() => document.getElementById('me-status').textContent !== 'Boşta (otomatik)')
})

test('ses odasındayken boşta olunmaz', async () => {
  const { ece } = W
  await h.joinVoice(ece, W.lobi.id)
  await ece.clock.fastForward('15:00')
  await h.sleep(1500)
  assert.equal(await ece.evaluate(() => idlePollParam()), '0')
  assert.equal(await W.deniz.evaluate(memberStatus, W.eceId), 'online')
  // Ses odasından çıkınca (çıkış bir tıklamadır) süre yeniden başlar
  await ece.click('#voice-leave')
  await ece.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') !== 'on', null, { timeout: h.LONG })
  assert.equal(await ece.evaluate(() => idlePollParam()), '0')
  await ece.clock.fastForward('10:30')
  await ece.waitForFunction(() => idlePollParam() === '1')
  await seenAs('idle')
  // Klavye de girdidir
  await ece.keyboard.press('Shift')
  await seenAs('online')
}, { browsers: ['chromium'], reason: 'sahte mikrofon yalnızca Chromium bayraklarıyla' })

test('ayar kapalıyken boşta olunmaz, 5 dakika seçilince 5 dakikada boşa geçilir', async () => {
  const { ece } = W
  await openPrivacy(ece)
  assert.equal(await ece.isChecked('#set-auto-idle'), true)
  assert.equal(await ece.inputValue('#set-auto-idle-minutes'), '10')
  assert.equal(await ece.textContent('#set-idle-section-title'), 'Otomatik Boşta')
  await ece.click('#set-auto-idle')
  assert.equal(await ece.evaluate(() => localStorage.getItem('telsiz.autoIdle')), '0')
  assert.equal(await ece.isDisabled('#set-auto-idle-minutes'), true)
  await closeSettings(ece)
  await ece.clock.fastForward('30:00')
  await h.sleep(1500)
  assert.equal(await ece.evaluate(() => idlePollParam()), '0')
  assert.equal(await W.deniz.evaluate(memberStatus, W.eceId), 'online')

  await openPrivacy(ece)
  await ece.click('#set-auto-idle')
  await ece.selectOption('#set-auto-idle-minutes', '5')
  assert.equal(await ece.evaluate(() => [localStorage.getItem('telsiz.autoIdle'), localStorage.getItem('telsiz.autoIdleMinutes')].join(',')), '1,5')
  await closeSettings(ece)
  await ece.clock.fastForward('04:00')
  assert.equal(await ece.evaluate(() => idlePollParam()), '0', '4 dakika yetmez')
  await ece.clock.fastForward('01:30')
  await ece.waitForFunction(() => idlePollParam() === '1')
  await seenAs('idle')
  await touch(ece)
  await seenAs('online')
})

test('konsol ve sunucu günlüğü temiz', async () => {
  h.assertCleanConsole(W.w.logs, W.w.srv.errors)
})
