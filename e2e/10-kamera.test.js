'use strict'

// Ses odasında kamera (sahte kamera) ve sahibin ses odası ayarları. Kamera düğmesi kapalı başlar ve
// basılmadan kamera istenmez. Mert kamerasını açar: kendi kutusu aynalı canlı görüntü, düğme sırasının
// üstünde "Kameranız açık" göstergesi, Deniz'in kadrosunda Mert'in avatarı canlı görüntü kutusuna döner ve
// Büyüt düğmesi kameraları yayın sahnesinde ızgara olarak açar (başlık düğmelerinin ipucu görünür etiketle
// aynıdır, tam ekrandan çıkış simgesi X değildir). Sahip kişi ses kartındaki Kamerasını kapat
// düğmesiyle Mert'in kamerasını kapatır: Mert'in kamerası durur, bildirim görür ve kamerasını yeniden açar.
// Sahip kamera sınırını 1'e indirince ikinci kamera sunucuda reddedilir ve kamera hiç istenmez. Sahip
// Ayarlar > Genel'den kapasite ve kamera sınırını değiştirir, kameraları kapatınca açık kamera kapanır.
// Sunucu bilgileri bölümü bilgileri, öneriyi ve ipuçlarını gösterir, Öneriyi uygula alanları doldurur.
// Telefonda beş kişilik ses odasında biri kamera açınca telsiz kartı yana taşmaz, Telsiz DJ görünür kalır.
// Ayrılınca kamera kapanır.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { w: null, deniz: null, mert: null, lobi: null }
// Sahte kamera ve mikrofon Chromium bayraklarıyla (--use-fake-device-for-media-stream) sağlanır. Firefox'un
// sahte kamerası bu ortamda doğrulanmadığı için dosya yalnızca Chromium'da çalışır.
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []), { browsers: ['chromium'], reason: 'sahte kamera yalnızca Chromium bayraklarıyla doğrulandı' })

const crewSel = (id) => '#radio-crew .crew-item[data-user-id="' + id + '"]'

// getUserMedia çağrılarını sayar (görüntü istenip istenmediği)
async function countCamera (page) {
  await page.evaluate(() => {
    const md = navigator.mediaDevices
    const orig = md.getUserMedia.bind(md)
    window.__camCalls = 0
    md.getUserMedia = (c) => {
      if (c && c.video) window.__camCalls++
      return orig(c)
    }
  })
}

function camCalls (page) {
  return page.evaluate(() => window.__camCalls)
}

// Kişinin kadro öğesinde gerçekten kare çizen görüntü var mı
function tileLive (page, userId) {
  return page.waitForFunction((sel) => {
    const v = document.querySelector(sel + ' .crew-avatar.has-camera video.cam-video')
    return Boolean(v && v.classList.contains('is-ready') && v.readyState >= 2 && v.videoWidth > 0 && !v.paused)
  }, crewSel(userId), { timeout: h.LONG })
}

async function metaCamera (userId) {
  const meta = (await W.w.call('GET', '/api/state', null, W.w.P.deniz.token)).data.meta
  const list = meta.voice[String(W.lobi.id)] || []
  const m = list.filter((x) => x.userId === userId)[0]
  return { camera: m ? m.camera : null, settings: meta.voiceSettings }
}

before(async () => {
  if (test.skipped) return
  // Can, Bora ve Ali telefonda beş kişilik ses odası sınaması içindir
  W.w = await h.setupWorld({ slot: 14, extraPeople: { can: 'Can', bora: 'Bora', ali: 'Ali' } })
  W.lobi = W.w.room('Lobi')
  W.deniz = await W.w.pageFor('deniz')
  W.mert = await W.w.pageFor('mert')
  await countCamera(W.deniz)
  await countCamera(W.mert)
})

after(async () => {
  if (W.w) await W.w.close()
})

test('kamera düğmesi kapalı başlar, ses odasına katılmak kamerayı istemez', async () => {
  const { deniz, mert } = W
  await h.joinVoice(mert, W.lobi.id)
  await h.joinVoice(deniz, W.lobi.id)
  for (const page of [deniz, mert]) {
    await page.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 2, null, { timeout: h.LONG })
  }
  const r = await mert.evaluate(() => {
    const b = document.getElementById('btn-camera')
    return {
      visible: b.getClientRects().length > 0,
      pressed: b.getAttribute('aria-pressed'),
      state: document.getElementById('btn-camera-state').textContent,
      label: b.getAttribute('aria-label'),
      live: document.getElementById('radio-cam-live').hidden,
      tiles: document.querySelectorAll('#radio-crew .has-camera').length
    }
  })
  assert.deepEqual(r, { visible: true, pressed: 'false', state: 'Kapalı', label: 'Kamerayı aç', live: true, tiles: 0 })
  assert.equal(await camCalls(mert), 0)
  assert.equal(await camCalls(deniz), 0)
})

test('kamera açılır, öteki kişi kadroda canlı görüntü kutusunu görür, kendi kutusu aynalıdır', async () => {
  const { deniz, mert } = W
  const mertId = W.w.P.mert.id
  await mert.click('#btn-camera')
  await mert.waitForFunction(() => document.getElementById('btn-camera').getAttribute('aria-pressed') === 'true', null, { timeout: h.LONG })
  await tileLive(mert, mertId)
  const own = await mert.evaluate((sel) => {
    const v = document.querySelector(sel + ' video.cam-video')
    const av = document.querySelector(sel + ' .crew-avatar')
    const live = document.getElementById('radio-cam-live')
    return {
      mirrored: v.classList.contains('is-mirrored'),
      transform: getComputedStyle(v).transform,
      radius: getComputedStyle(av).borderTopLeftRadius,
      liveShown: !live.hidden && live.getClientRects().length > 0,
      liveText: live.textContent,
      state: document.getElementById('btn-camera-state').textContent,
      label: document.querySelector(sel + ' .crew-button, ' + sel + ' div.crew-button').getAttribute('aria-label')
    }
  }, crewSel(mertId))
  assert.equal(own.mirrored, true)
  assert.match(own.transform, /^matrix\(-1/)
  // Kamerayı Çevir yalnızca birden çok kamera varken görünür (sahte kamera sayısı tarayıcıya göre değişir)
  const cameras = await mert.evaluate(async () => {
    const list = await navigator.mediaDevices.enumerateDevices()
    return list.filter((d) => d.kind === 'videoinput').length
  })
  await mert.waitForFunction((n) => document.getElementById('btn-camera-flip').hidden === (n < 2), cameras, { timeout: h.LONG })
  assert.notEqual(own.radius, '0px', 'görüntü kutusu yumuşak kare kalır')
  assert.equal(own.liveShown, true)
  assert.equal(own.liveText, 'Kameranız açık, odadaki herkes görüyor')
  assert.equal(own.state, 'Açık')
  assert.match(own.label, /kameranız açık/)
  assert.equal(await camCalls(mert), 1)
  // Deniz Mert'in görüntüsünü kadroda görür (aynalı değil)
  await tileLive(deniz, mertId)
  const other = await deniz.evaluate((sel) => {
    const v = document.querySelector(sel + ' video.cam-video')
    return { mirrored: v.classList.contains('is-mirrored'), w: v.videoWidth, h: v.videoHeight, label: document.querySelector(sel + ' .crew-button').getAttribute('aria-label') }
  }, crewSel(mertId))
  assert.equal(other.mirrored, false)
  assert.ok(other.w > 0 && other.w <= 640 && other.h <= 360, other.w + 'x' + other.h)
  assert.match(other.label, /kamerası açık/)
  assert.deepEqual(await metaCamera(mertId), { camera: true, settings: { capacity: 8, cameras: true, maxCameras: 4 } })
})

test('Büyüt düğmesi kameraları yayın sahnesinde ızgara olarak açar', async () => {
  const { deniz } = W
  await deniz.waitForSelector('#radio-cams:not([hidden])')
  assert.equal(await deniz.textContent('#radio-cams-text'), 'Büyüt')
  await deniz.click('#radio-cams')
  await deniz.waitForSelector('#cast[data-mode="cams"]:not([hidden])')
  await deniz.waitForFunction(() => {
    const v = document.querySelector('#cast .cam-tile video.cam-video')
    return Boolean(v && v.readyState >= 2 && v.videoWidth > 0)
  }, null, { timeout: h.LONG })
  const r = await deniz.evaluate(() => ({
    title: document.getElementById('cast-title').textContent,
    tiles: document.querySelectorAll('#cast .cam-tile').length,
    name: document.querySelector('#cast .cam-tile-name').textContent,
    body: document.body.getAttribute('data-cast'),
    expanded: document.getElementById('radio-cams').getAttribute('aria-expanded')
  }))
  assert.deepEqual(r, { title: 'Kameralar', tiles: 1, name: 'Mert', body: 'live', expanded: 'true' })
  assert.ok(await h.overflowX(deniz) <= 0)
  // Kamera ızgarasında sağ sütun (İstasyonlar) yerinde kalır, sohbet açıktır, Sığdır ve Doldur seçilebilir
  const fitOf = () => deniz.evaluate(() => getComputedStyle(document.querySelector('#cast .cam-tile video.cam-video')).objectFit)
  const layout = await deniz.evaluate(() => ({
    right: document.getElementById('side-right').getClientRects().length > 0,
    chat: document.body.getAttribute('data-cast-chat'),
    fit: document.querySelector('#cast .cast-fit').getClientRects().length > 0
  }))
  assert.deepEqual(layout, { right: true, chat: 'open', fit: true })
  assert.equal(await fitOf(), 'cover')
  await deniz.click('#cast .cast-fit .cast-fit-button:first-child')
  assert.equal(await fitOf(), 'contain')
  assert.deepEqual(await deniz.evaluate(() => [localStorage.getItem('telsiz.camFit'), localStorage.getItem('telsiz.castFit')]), ['contain', null])
  await deniz.click('#cast .cast-fit .cast-fit-button:last-child')
  assert.equal(await fitOf(), 'cover')
  // Başlık düğmelerinin ipucu görünür etiketle aynıdır (dar ekranda yalnızca simgedirler), tam ekrandan çıkış
  // simgesi Küçült'ün X'inden (i-close) ayrıdır
  const head = () => deniz.evaluate(() => Array.from(document.querySelectorAll('#cast .cast-head .cast-fit-button, #cast .cast-head .cast-full')).map((b) => [b.title, b.querySelector('.cast-button-label').textContent, b.querySelector('use').getAttribute('href')].join('|')))
  assert.deepEqual(await head(), ['Sığdır|Sığdır|#i-fit', 'Doldur|Doldur|#i-fill', 'Tam Ekran|Tam Ekran|#i-expand'])
  await deniz.click('#cast .cast-head .cast-full')
  await deniz.waitForFunction(() => castState.full)
  assert.equal((await head())[2], 'Tam Ekrandan Çık|Tam Ekrandan Çık|#i-compress')
  await deniz.click('#cast .cast-head .cast-full')
  await deniz.waitForFunction(() => !castState.full && !document.fullscreenElement)
  assert.equal((await head())[2], 'Tam Ekran|Tam Ekran|#i-expand')
  await deniz.click('#cast .cast-cams-close')
  await deniz.waitForSelector('#cast', { state: 'hidden' })
})

test('sahip kişi ses kartından Mert\'in kamerasını kapatır, Mert bildirim alır ve kamerasını yeniden açabilir', async () => {
  const { deniz, mert } = W
  const mertId = W.w.P.mert.id
  await deniz.click(crewSel(mertId) + ' .crew-button')
  await deniz.waitForSelector('#peer-popover:not([hidden]) #peer-mod:not([hidden]) #peer-camera-off:not([hidden])')
  assert.equal(await deniz.textContent('#peer-camera-off'), 'Kamerasını Kapat')
  await deniz.click('#peer-camera-off')
  await deniz.waitForFunction(() => /kamerası kapatıldı/.test(document.getElementById('peer-mod-msg').textContent), null, { timeout: h.LONG })
  await mert.waitForFunction(() => document.getElementById('btn-camera').getAttribute('aria-pressed') === 'false' && document.getElementById('radio-cam-live').hidden, null, { timeout: h.LONG })
  await mert.waitForFunction(() => document.getElementById('toast').textContent === 'Kameranız ses odası denetimiyle kapatıldı. Yeniden açabilirsiniz.', null, { timeout: h.LONG })
  assert.equal(await mert.evaluate(() => voice.snapshot().camera.state), 'off')
  // Kamerası kapanan kişide düğme gizlenir, odak kartta kalır
  await deniz.waitForSelector('#peer-camera-off', { state: 'hidden', timeout: h.LONG })
  assert.equal(await deniz.evaluate(() => document.getElementById('peer-popover').contains(document.activeElement)), true)
  await deniz.waitForFunction((sel) => !document.querySelector(sel + ' .has-camera'), crewSel(mertId), { timeout: h.LONG })
  assert.equal((await metaCamera(mertId)).camera, false)
  await deniz.keyboard.press('Escape')
  await deniz.waitForSelector('#peer-popover', { state: 'hidden' })
  // Kapatma tek seferliktir: Mert kamerasını yeniden açar
  await mert.click('#btn-camera')
  await mert.waitForFunction(() => document.getElementById('btn-camera').getAttribute('aria-pressed') === 'true', null, { timeout: h.LONG })
  await tileLive(deniz, mertId)
  assert.equal((await metaCamera(mertId)).camera, true)
})

test('kamera sınırı sunucuda uygulanır, sınır doluyken kamera hiç istenmez', async () => {
  const { deniz } = W
  const res = await W.w.call('POST', '/api/settings', { voice: { maxCameras: 1 } }, W.w.P.deniz.token)
  assert.equal(res.status, 200)
  await deniz.waitForFunction(() => state.meta && state.meta.voiceSettings && state.meta.voiceSettings.maxCameras === 1, null, { timeout: h.LONG })
  await deniz.click('#btn-camera')
  await deniz.waitForFunction(() => document.getElementById('toast').textContent === 'Bu ses odasında aynı anda en fazla 1 kamera açık olabilir.', null, { timeout: h.LONG })
  const r = await deniz.evaluate(() => ({ pressed: document.getElementById('btn-camera').getAttribute('aria-pressed'), live: document.getElementById('radio-cam-live').hidden }))
  assert.deepEqual(r, { pressed: 'false', live: true })
  assert.equal(await camCalls(deniz), 0)
  assert.equal((await metaCamera(W.w.P.deniz.id)).camera, false)
})

test('sahip Ayarlar > Genel bölümünden kapasite ve kamera sınırını değiştirir, kameraları kapatır', async () => {
  const { deniz, mert } = W
  await deniz.evaluate(() => openSettings('general', null))
  await deniz.waitForSelector('#settings-view:not([hidden]) #set-voice-limits-section')
  const before = await deniz.evaluate(() => ({
    title: document.getElementById('set-voice-limits-section-title').textContent,
    capacity: document.getElementById('set-voice-capacity').value,
    cameras: document.getElementById('set-voice-cameras').checked,
    max: document.getElementById('set-voice-max-cameras').value,
    ownerOnly: document.getElementById('set-voice-limits-owner-only').hidden
  }))
  assert.deepEqual(before, { title: 'Ses odaları ve kameralar', capacity: '8', cameras: true, max: '1', ownerOnly: true })
  // Geçersiz değer: kamera sınırı kapasiteden büyük
  await deniz.fill('#set-voice-capacity', '3')
  await deniz.fill('#set-voice-max-cameras', '5')
  await deniz.click('#set-voice-limits-save')
  await deniz.waitForFunction(() => document.getElementById('set-voice-limits-msg').textContent === 'Kamera sınırı 1 ile 3 arasında bir tam sayı olmalıdır.')
  await deniz.fill('#set-voice-capacity', '6')
  await deniz.fill('#set-voice-max-cameras', '2')
  await deniz.click('#set-voice-limits-save')
  await deniz.waitForFunction(() => document.getElementById('set-voice-limits-msg').textContent === 'Ses odası ayarları kaydedildi.', null, { timeout: h.LONG })
  assert.deepEqual((await metaCamera(W.w.P.mert.id)).settings, { capacity: 6, cameras: true, maxCameras: 2 })
  // Açık istemci (Mert) yeni ayarı metadan alır
  await mert.waitForFunction(() => state.meta.voiceSettings.capacity === 6 && state.meta.voiceSettings.maxCameras === 2, null, { timeout: h.LONG })
  // Kameralar kapatılınca Mert'in kamerası kapanır ve düğmesi devre dışı kalır
  await deniz.click('#set-voice-cameras')
  await deniz.click('#set-voice-limits-save')
  await deniz.waitForFunction(() => document.getElementById('set-voice-limits-msg').textContent === 'Ses odası ayarları kaydedildi.', null, { timeout: h.LONG })
  await mert.waitForFunction(() => document.getElementById('btn-camera').getAttribute('aria-pressed') === 'false' && document.getElementById('radio-cam-live').hidden, null, { timeout: h.LONG })
  await mert.waitForFunction(() => document.getElementById('toast').textContent === 'Kameralar bu frekansta kapalı.', null, { timeout: h.LONG })
  const m = await mert.evaluate(() => ({
    disabled: document.getElementById('btn-camera').getAttribute('aria-disabled'),
    state: document.getElementById('btn-camera-state').textContent,
    note: document.getElementById('radio-camera-note').textContent,
    tracks: voice.snapshot().camera.state
  }))
  assert.deepEqual(m, { disabled: 'true', state: 'Kapatıldı', note: 'Kameralar bu frekansta kapalı.', tracks: 'off' })
  await deniz.waitForFunction((sel) => !document.querySelector(sel + ' .has-camera'), crewSel(W.w.P.mert.id), { timeout: h.LONG })
  assert.equal((await metaCamera(W.w.P.mert.id)).camera, false)
})

test('sunucu bilgileri bölümü bilgileri, öneriyi ve ipuçlarını gösterir, öneri alanları doldurur', async () => {
  const { deniz } = W
  await deniz.waitForFunction(() => document.querySelectorAll('#set-server-facts .settings-fact').length >= 9, null, { timeout: h.LONG })
  const facts = await deniz.evaluate(() => Array.from(document.querySelectorAll('#set-server-facts .settings-fact-label')).map((n) => n.textContent))
  for (const label of ['İşlemci', 'Bellek', 'Disk (veri klasörü)', 'Yüklemeler', 'Mesajlar', 'TURN', 'Çalışma ortamı']) assert.ok(facts.indexOf(label) !== -1, label)
  const rec = await deniz.evaluate(() => ({
    upload: document.getElementById('set-rec-upload').value,
    items: Array.from(document.querySelectorAll('#set-rec-result .settings-rec-item')).map((n) => n.textContent),
    hints: document.querySelectorAll('#set-rec-hints .settings-rec-hint').length,
    intro: document.getElementById('set-rec-intro').textContent
  }))
  assert.equal(rec.upload, '5')
  assert.deepEqual(rec.items, ['Önerilen ses odası kapasitesi: 8 kişi', 'Önerilen kamera sınırı: 8 kamera'])
  assert.ok(rec.hints >= 1)
  assert.match(rec.intro, /tahmindir/)
  // 50 Mbps: kullanılabilir 35000 kbps, taban(35000 / 440) + 1 = 80, kapasite ve kamera 12'ye sıkıştırılır
  await deniz.fill('#set-rec-upload', '50')
  await deniz.waitForFunction(() => document.querySelector('#set-rec-result .settings-rec-item:nth-child(2)').textContent === 'Önerilen kamera sınırı: 12 kamera')
  await deniz.click('#set-rec-apply')
  const filled = await deniz.evaluate(() => ({
    capacity: document.getElementById('set-voice-capacity').value,
    max: document.getElementById('set-voice-max-cameras').value,
    cameras: document.getElementById('set-voice-cameras').checked,
    stored: localStorage.getItem('telsiz.uploadMbps')
  }))
  assert.deepEqual(filled, { capacity: '12', max: '12', cameras: true, stored: '50' })
  await deniz.click('#set-voice-limits-save')
  await deniz.waitForFunction(() => document.getElementById('set-voice-limits-msg').textContent === 'Ses odası ayarları kaydedildi.', null, { timeout: h.LONG })
  assert.deepEqual((await metaCamera(W.w.P.mert.id)).settings, { capacity: 12, cameras: true, maxCameras: 12 })
  assert.ok(await h.overflowX(deniz) <= 0)
  await deniz.keyboard.press('Escape')
  await deniz.waitForSelector('#settings-view', { state: 'hidden' })
})

test('kamera açıkken ekran paylaşımı ayrı izlenir, sonradan katılan kişi kamerayı görür', async () => {
  const { deniz, mert } = W
  const mertId = W.w.P.mert.id
  await mert.click('#btn-camera')
  await mert.waitForFunction(() => document.getElementById('btn-camera').getAttribute('aria-pressed') === 'true', null, { timeout: h.LONG })
  await tileLive(deniz, mertId)
  // Mert kamerası açıkken ekranını da paylaşır, Deniz izler: sahnedeki ekran ve kadrodaki kamera ayrı izlerdir
  await mert.click('#btn-screen')
  await mert.waitForSelector('#cast-dialog:not([hidden]) .cast-dialog-panel')
  await mert.click('#cast-dialog .cast-primary')
  await deniz.waitForSelector('#activity .activity-watch', { timeout: h.LONG })
  await deniz.click('#activity .activity-watch')
  await deniz.waitForSelector('#cast[data-mode="watch"]:not([hidden])')
  await deniz.waitForFunction(() => {
    const v = document.querySelector('#cast .cast-video')
    return v && v.srcObject && v.videoWidth > 0 && !v.paused
  }, null, { timeout: h.LONG })
  await tileLive(deniz, mertId)
  const tracks = await deniz.evaluate((sel) => {
    const screen = document.querySelector('#cast .cast-video').srcObject.getVideoTracks()[0]
    const cam = document.querySelector(sel + ' video.cam-video').srcObject.getVideoTracks()[0]
    return { different: screen.id !== cam.id, camW: document.querySelector(sel + ' video.cam-video').videoWidth }
  }, crewSel(mertId))
  assert.equal(tracks.different, true)
  assert.ok(tracks.camW > 0 && tracks.camW <= 640, String(tracks.camW))
  // Sonradan katılan Ece, Mert'in kamerasını kadroda canlı görür
  const ece = await W.w.pageFor('ece')
  await h.joinVoice(ece, W.lobi.id)
  await tileLive(ece, mertId)
  // Paylaşım bitince kamera sürer
  await mert.click('.top-cast-stop')
  await deniz.waitForSelector('#cast', { state: 'hidden', timeout: h.LONG })
  await tileLive(deniz, mertId)
  await ece.click('#voice-leave')
  await ece.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
})

test('telefon 360: beş kişilik ses odasında kamera açıkken telsiz kartı yana taşmaz, Telsiz DJ görünür', async () => {
  const { deniz, mert } = W
  // Mert'in kamerası önceki sınamadan açıktır. Can ve Bora masaüstünden, Ali telefondan katılır: kadro en geniş
  // halindedir, araç satırına Büyüt eklenince satır sığmazsa alt satıra iner
  assert.equal(await mert.getAttribute('#btn-camera', 'aria-pressed'), 'true')
  const extra = []
  for (const who of ['can', 'bora']) {
    const page = await W.w.pageFor(who)
    await h.joinVoice(page, W.lobi.id)
    extra.push(page)
  }
  const ali = await W.w.pageFor('ali', { viewport: { width: 360, height: 780 }, mobile: true })
  extra.push(ali)
  try {
    await ali.click('#btn-rooms')
    await ali.waitForSelector('#stations-sheet:not([hidden])')
    await ali.click('#stations-list .room-row[data-station="voice-' + W.lobi.id + '"]')
    await ali.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'on' && document.getElementById('stations-sheet').hidden, null, { timeout: h.LONG })
    await ali.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 5, null, { timeout: h.LONG })
    await ali.waitForSelector('#radio-tools #radio-cams', { timeout: h.LONG })
    await ali.waitForSelector('#radio-tools .dj-crew-button', { timeout: h.LONG })
    // Bildirim kutusu kartın üstüne binebilir, kaybolması beklenir
    await ali.waitForSelector('#toast', { state: 'hidden', timeout: h.LONG })
    const over = await h.overflowX(ali)
    assert.ok(over <= 0, 'telefonda yatay taşma: ' + over)
    assert.equal(await h.reachable(ali, '#radio-tools .dj-crew-button'), true, 'Telsiz DJ görünür alanda')
    assert.equal(await h.reachable(ali, '#radio-cams'), true, 'Büyüt görünür alanda')
  } finally {
    // Sınama düşse de sonraki sınamalar için oda iki kişiye döner
    for (const page of extra) {
      await page.evaluate(() => { if (document.getElementById('radio').getAttribute('data-state') !== 'off') leaveVoice() })
      await page.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
    }
  }
  await deniz.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 2, null, { timeout: h.LONG })
})

test('ses odasından ayrılınca kamera kapanır', async () => {
  const { deniz, mert } = W
  assert.equal(await mert.getAttribute('#btn-camera', 'aria-pressed'), 'true')
  await mert.click('#voice-leave')
  await mert.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
  const r = await mert.evaluate(() => ({ cam: voice.snapshot().camera.state, preview: voice.snapshot().camera.preview }))
  assert.deepEqual(r, { cam: 'off', preview: null })
  await deniz.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 1, null, { timeout: h.LONG })
  // Kamera sınırı sınamasındaki 409 yanıtı tarayıcı konsoluna ağ hatası olarak yazılır, beklenen bir durumdur
  h.assertCleanConsole(W.w.logs, W.w.srv.errors, [(l) => l.label === 'deniz' && /status of 409/.test(l.text) && /\/api\/voice\/camera$/.test(l.url)])
})
