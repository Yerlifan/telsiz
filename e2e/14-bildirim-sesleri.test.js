'use strict'

// Sesli bildirimler (public/js/31-sesler.js) gerçek tarayıcıda. Deniz, Mert ve Ece'nin
// sayfasında window.TelsizSesler.play sarmalanır, çalınan ses türleri kaydedilir (asıl çalma yolu da çalışır).
// - Ses odasına katılma ve ayrılma: kişinin kendisinde ve odadaki diğer kişide join ve leave
// - Ekran yayını: oda kurulduktan sonra başlayan paylaşımda izleyicide share, zaten süren paylaşımın
//   duyurusunda (sonradan katılan kişi) ses yok
// - Özel mesaj: sayfa açıkken başka bir konuşmadayken gelen özel mesajda dm
// - Arkadaşlık isteği: yeni gelen istekte friend
// - Ses odasından düşme: yetkili kişi odadan çıkarınca çıkarılan kişide drop (leave değil)
// - Ayarlar > Bildirimler: düzey kaydırıcısı (varsayılan %40, kaydedilir) ve altı dinleme düğmesi
// - Ses odası sesleri ayarı kapalıyken katılma sesi çalmaz

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { w: null, deniz: null, mert: null, ece: null, lobi: null }
// Ses odası ve ekran paylaşımı sahte medya aygıtı ister, bu yalnızca Chromium bayraklarıyla verilir (05-ses-yayin gibi)
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []), { browsers: ['chromium'], reason: 'sahte mikrofon ve ekran yakalama yalnızca Chromium bayraklarıyla' })

before(async () => {
  if (test.skipped) return
  W.w = await h.setupWorld({ slot: 19 })
  W.lobi = W.w.room('Lobi')
  W.deniz = await W.w.pageFor('deniz')
  W.mert = await W.w.pageFor('mert')
  W.ece = await W.w.pageFor('ece')
  for (const page of [W.deniz, W.mert, W.ece]) {
    await page.evaluate(() => {
      window.__sesler = []
      const api = window.TelsizSesler
      const play = api.play
      api.play = function (kind, opts) {
        window.__sesler.push({ kind: kind, test: Boolean(opts && opts.test) })
        return play.apply(this, arguments)
      }
    })
  }
})

after(async () => {
  if (W.w) await W.w.close()
})

const kinds = (page) => page.evaluate(() => window.__sesler.filter((s) => !s.test).map((s) => s.kind))
const clear = (page) => page.evaluate(() => {
  window.__sesler.length = 0
})
const waitKind = (page, kind) => page.waitForFunction((k) => window.__sesler.some((s) => s.kind === k && !s.test), kind, { timeout: h.LONG })

test('ses modülü yüklü: yedi ses, 2 saniye, varsayılan düzey %40', async () => {
  const r = await W.deniz.evaluate(() => ({
    kinds: window.TelsizSesler.KINDS,
    duration: window.TelsizSesler.DURATION,
    volume: window.TelsizSesler.getVolume()
  }))
  assert.deepEqual(r, { kinds: ['join', 'leave', 'share', 'dm', 'friend', 'drop', 'ring'], duration: 2, volume: 40 })
})

test('ses odasına katılma: kişinin kendisinde ve odadakinde katılma sesi', async () => {
  const { deniz, mert } = W
  await h.joinVoice(deniz, W.lobi.id)
  await waitKind(deniz, 'join')
  // Başkalarının katılma sesi kişi odaya girdikten kısa bir süre sonra başlar (OTHER_TONE_QUIET_MS)
  await h.sleep(2000)
  await clear(deniz)
  await h.joinVoice(mert, W.lobi.id)
  await waitKind(mert, 'join')
  await waitKind(deniz, 'join')
  for (const page of [deniz, mert]) {
    await page.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 2, null, { timeout: h.LONG })
  }
})

test('ekran yayını başlayınca izleyicide yayın sesi çalar', async () => {
  const { deniz, mert } = W
  // Bağlantı kurulduktan hemen sonra gelen duyuru süregelen paylaşım sayılır (SHARE_FRESH_MS)
  await h.sleep(4500)
  await clear(deniz)
  await mert.click('#btn-screen')
  await mert.waitForSelector('#cast-dialog:not([hidden]) .cast-dialog-panel')
  await mert.click('#cast-dialog .cast-primary')
  await mert.waitForSelector('#cast[data-mode="own"]:not([hidden])', { timeout: h.LONG })
  await waitKind(deniz, 'share')
  assert.deepEqual((await kinds(mert)).filter((k) => k === 'share'), [], 'paylaşan kişide yayın sesi yok')
})

test('zaten süren ekran yayınına sonradan katılan kişide yayın sesi çalmaz', async () => {
  const { deniz, ece } = W
  await clear(ece)
  await h.joinVoice(ece, W.lobi.id)
  await waitKind(ece, 'join')
  // Paylaşım duyurusu geldi: Ece'nin Bildirimler listesinde Mert'in paylaşımı görünür
  await ece.waitForSelector('#activity:not([hidden]) .activity-item.is-share', { timeout: h.LONG })
  await h.sleep(1500)
  assert.deepEqual((await kinds(ece)).filter((k) => k === 'share'), [], 'süregelen paylaşımda yayın sesi yok')
  await ece.click('#voice-leave')
  await ece.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
  await deniz.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 2, null, { timeout: h.LONG })
})

test('özel mesaj: başka konuşmadayken gelen özel mesajda özel mesaj sesi', async () => {
  const { deniz, ece } = W
  await clear(deniz)
  await ece.evaluate((id) => openDmWith(id), String(W.w.P.deniz.id))
  await ece.waitForSelector('#dm-header:not([hidden]) .dm-header-name', { timeout: h.LONG })
  await ece.waitForFunction(() => !document.getElementById('composer-input').disabled, null, { timeout: h.LONG })
  await ece.fill('#composer-input', 'Yayına birazdan katılıyorum')
  await ece.keyboard.press('Enter')
  await waitKind(deniz, 'dm')
  assert.deepEqual((await kinds(deniz)).filter((k) => k === 'dm'), ['dm'])
})

test('arkadaşlık isteği gelince arkadaşlık sesi çalar', async () => {
  const { deniz } = W
  await clear(deniz)
  const res = await W.w.call('POST', '/api/friends/request', { name: 'deniz' }, W.w.P.mert.token)
  assert.equal(res.status, 200)
  await waitKind(deniz, 'friend')
})

test('ses odasından ayrılınca odadakinde ayrılma sesi', async () => {
  const { deniz, mert } = W
  await clear(deniz)
  await clear(mert)
  await mert.click('#voice-leave')
  await mert.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
  await waitKind(mert, 'leave')
  await waitKind(deniz, 'leave')
})

test('yetkili kişi odadan çıkarınca çıkarılan kişide düşme sesi çalar, ayrılma sesi çalmaz', async () => {
  const { deniz, mert } = W
  await h.joinVoice(mert, W.lobi.id)
  await mert.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 2, null, { timeout: h.LONG })
  await clear(mert)
  const res = await W.w.call('POST', '/api/voice/moderate', { userId: W.w.P.mert.id, action: 'disconnect' }, W.w.P.deniz.token)
  assert.equal(res.status, 200)
  await waitKind(mert, 'drop')
  await mert.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
  assert.deepEqual(await kinds(mert), ['drop'])
  await deniz.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 1, null, { timeout: h.LONG })
})

test('Ayarlar > Bildirimler: düzey kaydırıcısı kaydedilir, altı dinleme düğmesi sesleri çalar', async () => {
  const { deniz } = W
  await deniz.evaluate(() => openSettings('notifications'))
  await deniz.waitForSelector('#settings-page[data-cat="notifications"] #set-notify-volume')
  const ui = await deniz.evaluate(() => ({
    value: document.getElementById('set-notify-volume').value,
    label: document.getElementById('set-notify-volume-value').textContent.replace(/\s/g, ''),
    previews: Array.from(document.querySelectorAll('#set-sound-previews button')).map((b) => ({ id: b.id, text: b.textContent.trim() }))
  }))
  assert.equal(ui.value, '40')
  assert.equal(ui.label, '%40')
  assert.deepEqual(ui.previews, [
    { id: 'set-sound-preview-join', text: 'Katılma' },
    { id: 'set-sound-preview-leave', text: 'Ayrılma' },
    { id: 'set-sound-preview-share', text: 'Ekran Yayını' },
    { id: 'set-sound-preview-dm', text: 'Özel Mesaj' },
    { id: 'set-sound-preview-friend', text: 'Arkadaşlık İsteği' },
    { id: 'set-sound-preview-drop', text: 'Odadan Düşme' }
  ])
  await deniz.evaluate(() => {
    const input = document.getElementById('set-notify-volume')
    input.value = '70'
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  assert.equal(await deniz.evaluate(() => [localStorage.getItem('telsiz.notifyVolume'), window.TelsizSesler.getVolume(), document.getElementById('set-notify-volume-value').textContent.replace(/\s/g, '')].join(' ')), '70 70 %70')
  await clear(deniz)
  for (const kind of ['join', 'leave', 'share', 'dm', 'friend', 'drop']) await deniz.click('#set-sound-preview-' + kind)
  assert.deepEqual(await deniz.evaluate(() => window.__sesler.filter((s) => s.test).map((s) => s.kind)), ['join', 'leave', 'share', 'dm', 'friend', 'drop'])
  assert.equal(await deniz.evaluate(() => document.getElementById('set-sound-msg').hidden), true, 'hata iletisi yok')
  await deniz.keyboard.press('Escape')
  await deniz.waitForSelector('#settings-view', { state: 'hidden' })
})

test('Ses odası sesleri kapalıyken katılma sesi çalmaz', async () => {
  const { deniz, mert } = W
  await deniz.evaluate(() => applyVoiceSettings({ sounds: false }))
  await clear(deniz)
  await h.joinVoice(mert, W.lobi.id)
  await deniz.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 2, null, { timeout: h.LONG })
  await h.sleep(1500)
  assert.deepEqual(await kinds(deniz), [])
  await deniz.evaluate(() => applyVoiceSettings({ sounds: true }))
})

test('konsol ve sunucu günlüğü temiz', async () => {
  const { deniz, mert } = W
  for (const page of [mert, deniz]) {
    await page.click('#voice-leave')
    await page.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
  }
  // Odadan çıkarılan kişinin veya ona giden yoldaki son sinyal sunucudan 403 (artık odada değil) ya da 404
  // (alıcı odada yok) alabilir: çıkarılma anındaki beklenen yarış
  h.assertCleanConsole(W.w.logs, W.w.srv.errors, [(l) => /\/api\/voice\/signal$/.test(l.url || '') && /status of 40[34]/.test(l.text || '')])
})
