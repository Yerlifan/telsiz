'use strict'

// İlk kurulum ve davetle kayıt (tarayıcıda gerçek scrypt türetmesi ve anahtar üretimi), ardından iki yönlü
// uçtan uca şifreli yazışma. Sunucunun veri klasöründe mesajların düz metni bulunmamalıdır.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { srv: null, tb: null, owner: null, ece: null, link: '', keyCode: '' }
const test = h.makeTest(__filename, () => (W.tb ? W.tb.pages : []))

const OWNER_TEXT = 'Merhaba Ece, bu şifreli ilk mesaj ÇĞİÖŞÜ 7319'
const ECE_TEXT = 'Selam Deniz, şifreli yanıt geldi 4826'

async function lastTexts (page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#message-list .msg-text')).map((n) => n.textContent))
}

before(async () => {
  W.srv = await h.startServer({}, 0)
  W.tb = await h.openBrowser()
})

after(async () => {
  if (W.tb) await W.tb.close()
  if (W.srv) {
    await new Promise((resolve) => W.srv.server.close(resolve))
    require('node:fs').rmSync(W.srv.dataDir, { recursive: true, force: true })
  }
})

test('sahip kurulum formuyla hesabı açar, davet ekranı bağlantı ve anahtar verir', async () => {
  const page = await W.tb.newPage('sahip', { viewport: { width: 1440, height: 900 }, extra: { 'telsiz.skin': 'arcade', 'telsiz.scheme': 'dark' } })
  W.owner = page
  await page.goto(W.srv.base + '/')
  await page.waitForSelector('#setup-card:not([hidden])', { timeout: h.LONG })
  await page.fill('#setup-code', 'abcde fghjk')
  await page.fill('#setup-name', 'deniz')
  await page.fill('#setup-password', 'Deniz-Parola-2026')
  await page.fill('#setup-password2', 'Deniz-Parola-2026')
  await page.click('#setup-submit')
  await page.waitForSelector('#invite-card:not([hidden])', { timeout: h.LONG })
  W.link = await page.inputValue('#invite-link')
  W.keyCode = await page.inputValue('#invite-key')
  assert.match(W.link, /#davet=[^&]+&anahtar=/)
  assert.ok(W.keyCode.length > 10, 'grup anahtarı kodu')
  await page.click('#invite-continue')
  await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  await page.waitForSelector('#band-track .station.is-tuned[aria-current="page"]', { timeout: h.LONG })
})

test('ikinci kullanıcı davet bağlantısıyla kayıt olur ve görünen adını kaydeder', async () => {
  const page = await W.tb.newPage('ece', { viewport: { width: 1440, height: 900 }, extra: { 'telsiz.skin': 'gece', 'telsiz.scheme': 'light' } })
  W.ece = page
  await page.goto(W.link)
  await page.waitForSelector('#register-form:not([hidden])', { timeout: h.LONG })
  assert.ok((await page.inputValue('#register-invite')).length > 0, 'davet kodu forma geldi')
  await page.fill('#register-name', 'ece')
  await page.fill('#register-password', 'Ece-Parola-2026')
  await page.fill('#register-password2', 'Ece-Parola-2026')
  await page.click('#register-submit')
  await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  await page.waitForSelector('#profile-step-name', { timeout: h.LONG })
  await page.fill('#profile-step-name', 'Ece')
  await page.click('#profile-step-save')
  await page.waitForSelector('#profile-step-name', { state: 'detached' })
  await page.waitForFunction(() => document.getElementById('me-name').textContent === 'Ece')
  await page.waitForSelector('#band-track .station.is-tuned[aria-current="page"]')
})

test('iki yönlü şifreli mesaj: iki tarafta görünür', async () => {
  const { owner, ece } = W
  for (const page of [owner, ece]) {
    await page.waitForFunction(() => !document.getElementById('composer-input').disabled, null, { timeout: h.LONG })
  }
  const ownerRoom = await owner.evaluate(() => String(state.channelId))
  assert.equal(await ece.evaluate(() => String(state.channelId)), ownerRoom, 'iki taraf aynı odada başlar')
  await owner.fill('#composer-input', OWNER_TEXT)
  await owner.keyboard.press('Enter')
  await ece.waitForFunction((text) => Array.from(document.querySelectorAll('#message-list .msg-text')).some((n) => n.textContent === text), OWNER_TEXT, { timeout: h.LONG })
  await ece.fill('#composer-input', ECE_TEXT)
  await ece.keyboard.press('Enter')
  await owner.waitForFunction((text) => Array.from(document.querySelectorAll('#message-list .msg-text')).some((n) => n.textContent === text), ECE_TEXT, { timeout: h.LONG })
  const both = await lastTexts(owner)
  assert.ok(both.indexOf(OWNER_TEXT) !== -1 && both.indexOf(ECE_TEXT) !== -1, both.join(' | '))
  const author = await owner.evaluate((text) => {
    const node = Array.from(document.querySelectorAll('#message-list .msg')).filter((m) => {
      const t = m.querySelector('.msg-text')
      return t && t.textContent === text
    })[0]
    const group = node && node.closest('.msg-group')
    const name = (node && node.querySelector('.msg-author')) || (group && group.querySelector('.msg-author'))
    return name ? name.textContent : ''
  }, ECE_TEXT)
  assert.equal(author, 'Ece')
})

test('sunucunun veri klasöründe düz metin yok, yalnızca şifreli zarf var', async () => {
  const token = await W.owner.evaluate(() => localStorage.getItem('telsiz.token'))
  const channel = await W.owner.evaluate(() => String(state.channelId))
  const res = await h.call(W.srv.port, 'GET', '/api/messages?channel=' + channel + '&limit=50', null, token)
  assert.equal(res.status, 200)
  const bodies = res.data.messages.map((m) => m.body)
  assert.equal(bodies.length, 2)
  for (const body of bodies) assert.equal(typeof body, 'string')
  // Kalıcı yazım gecikmeli olabilir: iki zarf da diske düşene kadar beklenir
  await h.until(() => {
    const all = Buffer.concat(h.readDataDir(W.srv.dataDir).map((f) => f.data)).toString('utf8')
    return bodies.every((b) => all.indexOf(b) !== -1)
  }, h.LONG, 'zarflar diske yazıldı')
  for (const f of h.readDataDir(W.srv.dataDir)) {
    for (const plain of [OWNER_TEXT, ECE_TEXT, 'şifreli ilk mesaj', 'şifreli yanıt geldi']) {
      assert.equal(f.data.indexOf(Buffer.from(plain, 'utf8')), -1, f.file + ' içinde düz metin: ' + plain)
    }
  }
})

test('konsol ve sunucu günlüğü temiz', async () => {
  h.assertCleanConsole(W.tb.logs, W.srv.errors)
})
