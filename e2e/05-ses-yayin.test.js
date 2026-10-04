'use strict'

// Ses odası (sahte mikrofon) ve ekran paylaşımı (sahte ekran yakalama). İki kullanıcı Lobi'ye katılır,
// kadroda ikisi ve Telsiz DJ öğesi görünür, konuşma halesi avatar şeklini izler. Biri ekranını paylaşır,
// öteki bildirimi görüp izler (görüntü gerçekten oynar), paylaşım durdurulunca sahne kapanır.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { w: null, deniz: null, mert: null, lobi: null }
// Sahte mikrofon, ekran yakalama ve kendiliğinden oynatma Chromium bayraklarıyla sağlanır
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []), { browsers: ['chromium'], reason: 'sahte medya aygıtı yalnızca Chromium bayraklarıyla' })

const crewSel = (id) => '#radio-crew .crew-item[data-user-id="' + id + '"]'

before(async () => {
  if (test.skipped) return
  W.w = await h.setupWorld({ slot: 4 })
  W.lobi = W.w.room('Lobi')
  W.deniz = await W.w.pageFor('deniz')
  W.mert = await W.w.pageFor('mert')
})

after(async () => {
  if (W.w) await W.w.close()
})

test('kapalı telsiz kartı geniş ekranda sol sütunda küçüktür, ses odaları İstasyonlar listesindedir', async () => {
  const r = await W.deniz.evaluate(() => ({
    state: document.getElementById('radio').getAttribute('data-state'),
    led: document.getElementById('radio-state').textContent,
    joins: document.querySelectorAll('#voice-channels .radio-join').length,
    left: document.getElementById('radio-slot').contains(document.getElementById('radio')),
    roomsShown: document.getElementById('voice-channels').getClientRects().length > 0,
    voiceRows: document.querySelectorAll('#inbox-list .room-row-voice').length
  }))
  assert.deepEqual(r, { state: 'off', led: 'Telsiz · kapalı', joins: 3, left: true, roomsShown: false, voiceRows: 3 })
  // Daha dar ekranda kart sağ sütuna iner ve Katıl düğmelerini gösterir
  await W.deniz.setViewportSize({ width: 1100, height: 900 })
  await W.deniz.waitForFunction(() => document.getElementById('side-right').contains(document.getElementById('radio')) && document.getElementById('voice-channels').getClientRects().length > 0)
  await W.deniz.setViewportSize({ width: 1440, height: 900 })
  await W.deniz.waitForFunction(() => document.getElementById('radio-slot').contains(document.getElementById('radio')))
})

test('iki kullanıcı Lobi\'ye katılır, kadroda ikisi ve Telsiz DJ görünür', async () => {
  const { deniz, mert } = W
  await h.joinVoice(mert, W.lobi.id)
  await deniz.waitForFunction((id) => {
    const row = document.querySelector('#voice-channels .radio-channel[data-channel-id="' + id + '"]')
    return row && row.classList.contains('is-busy')
  }, W.lobi.id, { timeout: h.LONG })
  await h.joinVoice(deniz, W.lobi.id)
  for (const page of [deniz, mert]) {
    await page.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 2, null, { timeout: h.LONG })
  }
  const r = await deniz.evaluate(() => ({
    led: document.getElementById('radio-state').textContent,
    room: document.getElementById('radio-room').textContent,
    names: Array.from(document.querySelectorAll('#radio-crew .crew-item[data-user-id] .crew-name')).map((n) => n.textContent),
    all: document.querySelectorAll('#radio-crew .crew-item').length,
    dj: Boolean(document.querySelector('#radio-tools .crew-dj')),
    djLast: document.getElementById('radio-tools').lastElementChild.classList.contains('crew-dj'),
    // İki satırlı düğme sırası: Kamera, Mikrofon, Sağırlaştır, altında Ekran ve Ayrıl
    buttons: Array.from(document.querySelectorAll('#radio-row .radio-button')).map((b) => [b.id, Math.round(b.getBoundingClientRect().top)])
  }))
  assert.deepEqual([r.led, r.room], ['Telsiz · bağlı', 'Lobi'])
  assert.ok(r.names.indexOf('Deniz (siz)') !== -1 && r.names.indexOf('Mert') !== -1, r.names.join(','))
  // Kadroda iki kişi, altındaki araç satırının sonunda Telsiz DJ düğmesi (DJ sunucuda açıkken)
  assert.deepEqual([r.all, r.dj, r.djLast], [2, true, true])
  assert.deepEqual(r.buttons.map((b) => b[0]), ['btn-camera', 'btn-mute', 'btn-deafen', 'btn-screen', 'voice-leave'])
  assert.equal(new Set(r.buttons.slice(0, 3).map((b) => b[1])).size, 1, 'ilk üç düğme aynı satırda')
  assert.equal(r.buttons[3][1], r.buttons[4][1], 'Ekran ve Ayrıl aynı satırda')
  assert.ok(r.buttons[3][1] > r.buttons[0][1], 'Ekran ve Ayrıl ikinci satırda')
  // Mikrofon düğmesine sağ tık: Bas konuş ve Ses etkinliği seçimi
  await deniz.click('#btn-mute', { button: 'right' })
  await deniz.waitForSelector('#mic-menu:not([hidden]) .mic-menu-item[data-mode="ptt"]')
  assert.equal(await deniz.getAttribute('#mic-menu .mic-menu-item[data-mode="vad"]', 'aria-checked'), 'true')
  await deniz.click('#mic-menu .mic-menu-item[data-mode="ptt"]')
  await deniz.waitForFunction(() => snap().inputMode === 'ptt' && document.getElementById('mic-menu').hidden, null, { timeout: h.LONG })
  await deniz.click('#btn-mute', { button: 'right' })
  await deniz.click('#mic-menu .mic-menu-item[data-mode="vad"]')
  await deniz.waitForFunction(() => snap().inputMode === 'vad', null, { timeout: h.LONG })
  const station = await deniz.evaluate((id) => {
    const n = document.querySelector('#inbox-list .room-row[data-channel-id="' + id + '"]')
    const tuned = document.querySelector('#band-track .station.is-tuned')
    return { connected: n.classList.contains('is-connected'), current: n.getAttribute('aria-current'), band: tuned.getAttribute('data-kind') }
  }, W.lobi.id)
  assert.deepEqual(station, { connected: true, current: null, band: 'frekans' }, 'ses odası satırı bağlı, ibre frekansta kalır')
})

test('sahte mikrofonla konuşma halesi görünür ve avatarın yumuşak kare şeklini izler', async () => {
  const { deniz } = W
  const sel = crewSel(W.w.P.mert.id)
  // Chromium'un sahte mikrofonu aralıklı bip sesi verir, konuşma durumu açılıp kapanır. Sınıf ve etiket aynı
  // anda, konuşma sürerken okunur (ayrı okumada konuşma araya girip bitebilir).
  const handle = await deniz.waitForFunction((s) => {
    const item = document.querySelector(s)
    if (!item || !item.classList.contains('is-speaking')) return null
    const label = item.querySelector('.crew-button').getAttribute('aria-label')
    if (!/konuşuyor/.test(label)) return null
    const cs = getComputedStyle(item.querySelector('.crew-avatar'))
    return { radius: cs.borderTopLeftRadius, halo: cs.boxShadow, outline: cs.outlineStyle, label, talk: document.getElementById('radio-talk-text').textContent }
  }, sel, { timeout: h.LONG })
  const r = await handle.jsonValue()
  assert.ok(/konuşuyor/.test(r.label), r.label)
  assert.ok(r.halo !== 'none' || r.outline !== 'none', 'hale var')
  assert.notEqual(r.radius, '0px', 'avatar köşeleri yuvarlak')
  assert.notEqual(r.radius, '50%', 'avatar daire değil')
  // Kadro kaydırılabilir bir kaptır ve taşan çizimi kırpar. Halenin parıltısı kabın içinde kalmalı, yoksa
  // kırpılan parıltı avatarın dışında dik köşeli bir kutu gibi görünür (avatar şekli: --avatar-radius)
  const fit = await deniz.evaluate((s) => {
    const avatar = document.querySelector(s + ' .crew-avatar')
    const crew = document.getElementById('radio-crew')
    const shadow = getComputedStyle(avatar).boxShadow
    let extent = 0
    shadow.split(/,(?![^(]*\))/).forEach((part) => {
      const nums = (part.replace(/rgba?\([^)]*\)/, '').match(/-?[\d.]+px/g) || []).map(parseFloat)
      if (nums.length >= 3) extent = Math.max(extent, Math.abs(nums[0]) + Math.abs(nums[1]) + nums[2] + (nums[3] || 0))
    })
    const a = avatar.getBoundingClientRect()
    const c = crew.getBoundingClientRect()
    return { extent, top: a.top - extent - c.top, left: a.left - extent - c.left, bottom: c.bottom - (a.bottom + extent), clipX: getComputedStyle(crew).overflowX }
  }, sel)
  assert.ok(fit.extent > 0, 'hale gölgesi var')
  assert.ok(fit.top >= -0.5 && fit.left >= -0.5 && fit.bottom >= -0.5, 'hale kadronun kırpma alanına sığar: ' + JSON.stringify(fit))
})

test('ekran paylaşımı başlar: başlatma penceresi, sahne ve kendi önizleme oynar', async () => {
  const { deniz } = W
  await deniz.click('#btn-screen')
  await deniz.waitForSelector('#cast-dialog:not([hidden]) .cast-dialog-panel')
  assert.equal(await deniz.textContent('#cast-dialog-title'), 'Ekranı paylaş')
  await deniz.click('#cast-dialog .cast-primary')
  await deniz.waitForSelector('#cast[data-mode="own"]:not([hidden])', { timeout: h.LONG })
  await deniz.waitForFunction(() => {
    const v = document.querySelector('#cast .cast-video')
    return v && v.srcObject && v.videoWidth > 0
  }, null, { timeout: h.LONG })
  const r = await deniz.evaluate(() => ({ body: document.body.getAttribute('data-cast'), title: document.getElementById('cast-title').textContent, top: document.getElementById('top-cast').hidden }))
  assert.deepEqual(r, { body: 'live', title: 'Ekranınız paylaşılıyor', top: false })
})

test('izleyici bildirimi görür, İzle ile görüntü gerçekten oynar', async () => {
  const { deniz, mert } = W
  // Geniş ekranda bildirim sol sütundaki Bildirimler listesindedir, sağ üstte ayrıca açılmaz
  await mert.waitForSelector('#activity:not([hidden]) .activity-item.is-share', { timeout: h.LONG })
  assert.equal(await mert.textContent('#activity .activity-item.is-share .activity-text'), 'Deniz ekranını paylaşıyor')
  assert.equal(await mert.$('.cast-notice'), null)
  // Üst çubukta başkasının paylaşımı gösterilmez, kadroda paylaşan kişinin öğesinde Yayına katıl düğmesi vardır
  assert.equal(await mert.$('#top-cast .top-cast-chip'), null)
  const crewWatch = '#radio-crew .crew-item[data-user-id="' + W.w.P.deniz.id + '"] .crew-watch'
  await mert.waitForSelector(crewWatch, { state: 'attached', timeout: h.LONG })
  await mert.hover('#radio-crew .crew-item[data-user-id="' + W.w.P.deniz.id + '"] .crew-button')
  await mert.waitForFunction((sel) => getComputedStyle(document.querySelector(sel)).opacity === '1', crewWatch, { timeout: h.LONG })
  assert.equal(await mert.textContent(crewWatch), 'Yayına katıl')
  await mert.click('#activity .activity-watch')
  await mert.waitForSelector('#cast[data-mode="watch"]:not([hidden])')
  await mert.waitForFunction(() => {
    const v = document.querySelector('#cast .cast-video')
    return v && v.srcObject && v.videoWidth > 0 && v.currentTime > 0.3 && !v.paused
  }, null, { timeout: 45000 })
  const r = await mert.evaluate(() => ({ title: document.getElementById('cast-title').textContent, tag: document.querySelector('#cast .cast-tag').textContent, w: document.querySelector('#cast .cast-video').videoWidth }))
  assert.equal(r.title, 'Deniz ekranını paylaşıyor')
  assert.equal(r.tag, 'CANLI · Deniz')
  assert.ok(r.w > 0)
  await deniz.waitForFunction(() => document.querySelector('#cast .cast-viewers-text').textContent === '1 kişi izliyor', null, { timeout: h.LONG })
})

test('telefon 390: izleme sahnesinde yatay taşma yok', async () => {
  const { mert } = W
  await mert.setViewportSize({ width: 390, height: 844 })
  await mert.waitForFunction(() => window.innerWidth === 390)
  assert.ok(await h.overflowX(mert) <= 0, 'yatay taşma')
  await mert.setViewportSize({ width: 1440, height: 900 })
})

test('paylaşım durdurulur, izleyicide sahne kapanır ve bildirim gelir', async () => {
  const { deniz, mert } = W
  await deniz.click('#cast .cast-stop')
  await deniz.waitForFunction(() => document.getElementById('cast').hidden && !document.body.hasAttribute('data-cast') && document.getElementById('top-cast').hidden)
  await mert.waitForFunction(() => document.getElementById('cast').hidden && !document.body.hasAttribute('data-cast'), null, { timeout: h.LONG })
  await mert.waitForFunction(() => document.getElementById('toast').textContent === 'Deniz ekran paylaşımını bitirdi.')
})

test('sesten ayrılınca kart kapanır', async () => {
  const { deniz } = W
  await deniz.click('#voice-leave')
  await deniz.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
  await W.mert.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 1, null, { timeout: h.LONG })
})

test('konsol ve sunucu günlüğü temiz', async () => {
  h.assertCleanConsole(W.w.logs, W.w.srv.errors)
})
