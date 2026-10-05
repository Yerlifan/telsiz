'use strict'

// Davet koduyla kayıt olan ve şifreleme anahtarını girmeyen kişi (tablet boyutu, dokunmatik). Tanıtım
// sayfasından kayıt formuna geçer, kayıttan sonra anahtar ekranı açılır, "Anahtar olmadan devam et" ile
// uygulamaya girer ve anahtar ekranına geri dönmez: oturum yeniden yüklenmez, /api/state tekrar tekrar
// istenmez. Sayfa yeniden açılınca anahtar ekranı yine sorulur ve yine geçilebilir.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { srv: null, tb: null, page: null, invite: '', stateCalls: 0 }
const test = h.makeTest(__filename, () => (W.tb ? W.tb.pages : []))

function visibleIds (page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#boot-view, #auth-view, #app-view, #key-card, #login-card, #register-form'))
    .filter((n) => !n.hidden && n.getClientRects().length > 0)
    .map((n) => n.id))
}

// Anahtar ekranındaki "Anahtar olmadan devam et" ile uygulamaya girilir, sonra birkaç saniye boyunca anahtar
// ekranı geri gelmez ve oturum durumu yeniden istenmez
async function skipAndStay (page) {
  await page.waitForSelector('#key-card:not([hidden]) #key-skip', { timeout: h.LONG })
  await page.click('#key-skip')
  await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  const before = W.stateCalls
  for (const step of [1, 2, 3, 4, 5, 6]) {
    await h.sleep(500)
    const ids = await visibleIds(page)
    assert.ok(ids.indexOf('app-view') !== -1, step + '. denetimde uygulama ekranı açık kalmalı: ' + ids.join(','))
    assert.equal(ids.indexOf('key-card'), -1, step + '. denetimde anahtar ekranı geri gelmemeli')
  }
  assert.equal(W.stateCalls, before, 'oturum durumu yeniden istenmemeli')
  // Anahtarsız uygulama: yazma alanında anahtar uyarısı
  await page.waitForSelector('#composer-hint:not([hidden])', { timeout: h.LONG })
}

before(async () => {
  if (test.skipped) return
  W.srv = await h.startServer(null, 16)
  const crypt = h.loadE2EE()
  const kid = crypt.E.keyring.add(crypt.E.generateKeyCode())
  const owner = await h.createAccount(W.srv, crypt, 'deniz', 'parola-deniz-1', 'setupCode', h.SETUP_CODE)
  await h.call(W.srv.port, 'POST', '/api/settings', { activeKid: kid }, owner.token)
  W.invite = (await h.call(W.srv.port, 'GET', '/api/state', null, owner.token)).data.inviteCode
  W.tb = await h.openBrowser()
  W.page = await W.tb.newPage('tablet', { viewport: { width: 820, height: 1180 }, mobile: true })
  W.page.on('request', (r) => {
    if (r.method() === 'GET' && new URL(r.url()).pathname === '/api/state') W.stateCalls++
  })
})

after(async () => {
  if (W.tb) await W.tb.close()
  if (W.srv) await new Promise((resolve) => W.srv.server.close(resolve))
})

test('davet koduyla kayıt, anahtar girmeden devam: uygulama açılır ve anahtar ekranına geri dönülmez', async () => {
  const page = W.page
  await page.goto(W.srv.base + '/', { timeout: h.LONG })
  await page.waitForSelector('#tanitim-login', { timeout: h.LONG })
  await page.click('#tanitim-login')
  await page.click('#auth-tab-register')
  await page.waitForSelector('#register-form:not([hidden])')
  await page.fill('#register-name', 'ece')
  await page.fill('#register-password', 'parola-ece-123')
  await page.fill('#register-password2', 'parola-ece-123')
  await page.fill('#register-invite', W.invite)
  await page.click('#register-submit')
  await skipAndStay(page)
})

test('sayfa yeniden açılınca anahtar yine sorulur ve yine geçilir', async () => {
  const page = W.page
  await page.reload({ timeout: h.LONG, waitUntil: 'domcontentloaded' })
  await skipAndStay(page)
})
