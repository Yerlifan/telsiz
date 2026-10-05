'use strict'

// Özel mesaj araması (public/js/32-arama.js, sunucuda src/calls.js) gerçek tarayıcıda. Deniz ile Ece arkadaştır,
// Mert ikisinin de arkadaşı değildir ve yalnızca sunucu isteğiyle (tarayıcısız) üçüncü kişi olarak sınanır.
// Deniz ve Ece'nin sayfasında window.TelsizSesler.play sarmalanır, çalınan ses türleri kaydedilir.
// - Başlık düğmeleri: arkadaşla etkin, arkadaş olmayanla devre dışı ve nedeni yazar
// - Sesli arama: gelen arama kartı ve zil, kabul, iki tarafta etkin arama, iki kutu ve avatar, aramada yazışma,
//   telsiz kartının özel arama kipi
// - Aramada karşı tarafın kamerası: arayanda karşı tarafın kutusunda oynayan görüntü
// - Arayan kapatınca aranan tarafta "Arama sona erdi", iki tarafta arama bölümü kalkar, mikrofon bırakılır
// - Reddetme: arayanda "Arama cevaplanmadı", aranan tarafta zil durur
// - Üçüncü kişi çalan aramanın odasına katılamaz (404) ve herkese açık metada aramanın odası görünmez
// - 390 piksel genişlikte etkin aramada yatay taşma yok
// - Konsol ve sunucu günlüğü temiz

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { w: null, deniz: null, ece: null, dmId: null }
// Arama sahte mikrofon ve kamera ister, bunlar yalnızca Chromium bayraklarıyla verilir (05-ses-yayin gibi)
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []), { browsers: ['chromium'], reason: 'sahte mikrofon ve kamera yalnızca Chromium bayraklarıyla' })

const NOT_FRIENDS = 'Yalnızca arkadaşlarınızı arayabilirsiniz.'
const ENDED = 'Arama sona erdi.'
const UNANSWERED = 'Arama cevaplanmadı.'

before(async () => {
  if (test.skipped) return
  // Zil süresi kısaltılır: reddedilmeyen bir arama testin geri kalanını uzun süre etkilemez
  W.w = await h.setupWorld({ slot: 20, server: { callRingMs: 20000 } })
  const P = W.w.P
  let res = await W.w.call('POST', '/api/friends/request', { name: 'ece' }, P.deniz.token)
  assert.equal(res.status, 200, JSON.stringify(res.data))
  res = await W.w.call('POST', '/api/friends/accept', { userId: P.deniz.id }, P.ece.token)
  assert.equal(res.status, 200, JSON.stringify(res.data))
  W.deniz = await W.w.pageFor('deniz')
  W.ece = await W.w.pageFor('ece')
  for (const page of [W.deniz, W.ece]) {
    await page.evaluate(() => {
      // Alınan mikrofon akışları kaydedilir: arama bitince izlerinin durdurulduğu (mikrofonun bırakıldığı) denetlenir
      window.__mikrofon = []
      const md = navigator.mediaDevices
      const gum = md.getUserMedia.bind(md)
      md.getUserMedia = function (constraints) {
        return gum(constraints).then((stream) => {
          if (constraints && constraints.audio) window.__mikrofon.push(stream)
          return stream
        })
      }
      window.__sesler = []
      const api = window.TelsizSesler
      const play = api.play
      api.play = function (kind, opts) {
        window.__sesler.push(kind)
        return play.apply(this, arguments)
      }
    })
  }
})

after(async () => {
  if (W.w) await W.w.close()
})

const ringCount = (page) => page.evaluate(() => window.__sesler.filter((k) => k === 'ring').length)
const waitToast = (page, text) => page.waitForFunction((t) => {
  const n = document.getElementById('toast')
  return Boolean(n && !n.hidden && n.textContent.trim() === t)
}, text, { timeout: h.LONG })
const waitPhase = (page, phase) => page.waitForSelector('#dm-call:not([hidden])[data-phase="' + phase + '"]', { timeout: h.LONG })
const waitCallGone = (page) => page.waitForSelector('#dm-call', { state: 'hidden', timeout: h.LONG })
// Ses motoru odadan tamamen çıktı, alınan bütün mikrofon izleri durduruldu ve telsiz kartı kapalı
const waitVoiceOff = (page) => page.waitForFunction(() => {
  const s = voice.snapshot()
  const radio = document.getElementById('radio')
  const micLive = window.__mikrofon.some((stream) => stream.getAudioTracks().some((tr) => tr.readyState !== 'ended'))
  return s.channelId === null && !s.joining && !s.private && !s.capturing && !micLive &&
    radio.getAttribute('data-state') === 'off' && !radio.classList.contains('is-call')
}, null, { timeout: h.LONG })
// Başlıktaki iki arama düğmesi yeniden kullanılabilir (önceki arama özel görünümden kalktı)
const waitCallable = (page) => page.waitForFunction(() => ['dm-call-voice', 'dm-call-video'].every((id) => {
  const b = document.getElementById(id)
  return b && !b.classList.contains('is-disabled') && !b.hasAttribute('aria-disabled')
}), null, { timeout: h.LONG })
const nextFrames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const headerButtons = (page) => page.evaluate(() => ['dm-call-voice', 'dm-call-video'].map((id) => {
  const b = document.getElementById(id)
  return { disabled: b.classList.contains('is-disabled'), aria: b.getAttribute('aria-disabled'), title: b.title, label: b.getAttribute('aria-label') }
}))

test('başlık düğmeleri: arkadaş olmayanla nedeniyle devre dışı, arkadaşla etkin', async () => {
  const { ece } = W
  await ece.evaluate((id) => openDmWith(id), String(W.w.P.mert.id))
  await ece.waitForSelector('#dm-header:not([hidden]) #dm-call-voice', { timeout: h.LONG })
  await ece.waitForFunction(() => document.getElementById('dm-call-video').classList.contains('is-disabled'), null, { timeout: h.LONG })
  assert.deepEqual(await headerButtons(ece), [
    { disabled: true, aria: 'true', title: NOT_FRIENDS, label: 'Mert ile sesli arama başlat, kullanılamıyor: ' + NOT_FRIENDS },
    { disabled: true, aria: 'true', title: NOT_FRIENDS, label: 'Mert ile görüntülü arama başlat, kullanılamıyor: ' + NOT_FRIENDS }
  ])
  // Devre dışı düğmeye basmak arama başlatmaz, nedeni bildirir (aria-disabled düğmeye Playwright tıklamaz)
  await ece.evaluate(() => document.getElementById('dm-call-voice').click())
  await waitToast(ece, NOT_FRIENDS)
  assert.equal(await ece.evaluate(() => document.getElementById('dm-call').hidden && privateCall() === null), true)

  await ece.evaluate((id) => openDmWith(id), String(W.w.P.deniz.id))
  await ece.waitForSelector('#dm-header:not([hidden]) #dm-call-voice', { timeout: h.LONG })
  await ece.waitForFunction((id) => String(dmPartner(state.channelId)) === id, String(W.w.P.deniz.id), { timeout: h.LONG })
  await waitCallable(ece)
  assert.deepEqual(await headerButtons(ece), [
    { disabled: false, aria: null, title: 'Deniz ile sesli arama başlat', label: 'Deniz ile sesli arama başlat' },
    { disabled: false, aria: null, title: 'Deniz ile görüntülü arama başlat', label: 'Deniz ile görüntülü arama başlat' }
  ])
  W.dmId = await ece.evaluate(() => String(state.channelId))
})

test('sesli arama: zil, kabul, iki tarafta etkin arama, aramada yazışma, telsiz kartı özel arama kipinde', async () => {
  const { deniz, ece } = W
  // Kart, kişi bir alana yazmıyorsa odağı Kabul Et düğmesine taşır (yazma alanındaki odak alınmaz)
  await deniz.evaluate(() => {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
  })
  await ece.click('#dm-call-voice')
  await waitPhase(ece, 'calling')
  assert.equal((await ece.textContent('#dm-call-state')).trim(), 'Aranıyor')

  await deniz.waitForSelector('#call-incoming:not([hidden])', { timeout: h.LONG })
  const card = await deniz.evaluate(() => ({
    role: document.getElementById('call-incoming').getAttribute('role'),
    text: document.getElementById('call-incoming-text').textContent.trim(),
    focus: document.activeElement && document.activeElement.id
  }))
  assert.deepEqual(card, { role: 'alertdialog', text: 'Ece sizi arıyor', focus: 'call-incoming-accept' })
  await deniz.waitForFunction(() => window.__sesler.indexOf('ring') !== -1, null, { timeout: h.LONG })
  assert.equal(await ringCount(ece), 0, 'arayanda zil çalmaz')

  await deniz.click('#call-incoming-accept')
  await deniz.waitForSelector('#call-incoming', { state: 'hidden' })
  await waitPhase(deniz, 'active')
  await waitPhase(ece, 'active')
  // Kabulden sonra zil durur
  await deniz.waitForFunction(() => arama.ringTimer === 0, null, { timeout: h.LONG })

  for (const [page, self, partner] of [[deniz, W.w.P.deniz.id, W.w.P.ece.id], [ece, W.w.P.ece.id, W.w.P.deniz.id]]) {
    const tiles = await page.evaluate(() => Array.from(document.querySelectorAll('#dm-call .call-tile')).map((tile) => ({
      cls: tile.classList.contains('is-partner') ? 'partner' : tile.classList.contains('is-self') ? 'self' : '',
      user: tile.getAttribute('data-user-id'),
      avatar: Boolean(tile.querySelector('.call-tile-media .call-tile-avatar')) && tile.querySelector('.call-tile-avatar').getClientRects().length > 0
    })))
    assert.deepEqual(tiles, [
      { cls: 'partner', user: String(partner), avatar: true },
      { cls: 'self', user: String(self), avatar: true }
    ])
    // Yazışma aramanın altında kullanılabilir kalır
    const chat = await page.evaluate(() => {
      const visible = (id) => {
        const n = document.getElementById(id)
        return Boolean(n && !n.closest('[hidden]') && n.getClientRects().length)
      }
      return { messages: visible('messages'), composer: visible('composer-input'), enabled: !document.getElementById('composer-input').disabled }
    })
    assert.deepEqual(chat, { messages: true, composer: true, enabled: true })
    const radio = await page.evaluate(() => ({
      call: document.getElementById('radio').classList.contains('is-call'),
      state: document.getElementById('radio-state').textContent.trim(),
      engine: String(voice.snapshot().channelId) + ' ' + voice.snapshot().private,
      mic: window.__mikrofon.some((stream) => stream.getAudioTracks().some((tr) => tr.readyState === 'live'))
    }))
    assert.deepEqual(radio, { call: true, state: 'Özel Arama', engine: W.dmId + ' true', mic: true })
  }
  assert.equal(await deniz.evaluate(() => String(state.channelId)), W.dmId, 'kabul konuşmayı açar')

  const text = 'Aramadayken de yazabiliyorum'
  await ece.fill('#composer-input', text)
  await ece.keyboard.press('Enter')
  await deniz.waitForFunction((t) => Array.from(document.querySelectorAll('#message-list .msg-text')).some((n) => n.textContent === t), text, { timeout: h.LONG })
  assert.equal(await ece.getAttribute('#dm-call', 'data-phase'), 'active', 'mesaj aramayı etkilemez')
  assert.equal(await deniz.getAttribute('#dm-call', 'data-phase'), 'active')
})

test('aranan kamerasını açınca arayanda karşı tarafın kutusunda görüntü oynar', async () => {
  const { deniz, ece } = W
  await deniz.click('#dm-call-camera')
  await deniz.waitForSelector('#dm-call .call-tile.is-self.has-video .call-tile-media video.cam-video', { timeout: h.LONG })
  await ece.waitForSelector('#dm-call .call-tile.is-partner.has-video .call-tile-media video.cam-video', { timeout: h.LONG })
  await ece.waitForFunction(() => {
    const v = document.querySelector('#dm-call .call-tile.is-partner.has-video video.cam-video')
    return Boolean(v && !v.paused && v.readyState >= 2 && v.videoWidth > 0)
  }, null, { timeout: h.LONG })
  assert.equal(await ece.evaluate(() => document.querySelectorAll('#dm-call .call-tile.is-self.has-video').length), 0, 'arayanın kamerası kapalı')
  assert.equal(await deniz.getAttribute('#dm-call-camera', 'aria-pressed'), 'true')
})

test('arayan kapatınca aranan tarafta arama sona erer, iki tarafta mikrofon bırakılır', async () => {
  const { deniz, ece } = W
  await ece.click('#dm-call-hangup')
  await waitCallGone(ece)
  await waitCallGone(deniz)
  await waitToast(deniz, ENDED)
  for (const page of [deniz, ece]) await waitVoiceOff(page)
  assert.equal(await deniz.evaluate(() => voice.snapshot().camera.state), 'off', 'kamera kapandı')
  assert.equal(await deniz.evaluate(() => privateCall()), null)
  await waitCallable(ece)
})

test('reddetme: arayanda arama cevaplanmadı, aranan tarafta zil durur', async () => {
  const { deniz, ece } = W
  await deniz.evaluate(() => {
    window.__sesler.length = 0
  })
  await ece.click('#dm-call-video')
  await waitPhase(ece, 'calling')
  await deniz.waitForSelector('#call-incoming:not([hidden])', { timeout: h.LONG })
  assert.equal((await deniz.textContent('#call-incoming-text')).trim(), 'Ece sizi görüntülü arıyor')
  // Deniz konuşmayı açık tutuyor: gelen arama konuşmanın bölümünde de Kabul Et ve Reddet ile görünür
  await waitPhase(deniz, 'incoming')
  assert.deepEqual(await deniz.evaluate(() => ({
    accept: Boolean(document.getElementById('dm-call-accept')),
    decline: Boolean(document.getElementById('dm-call-decline')),
    state: document.getElementById('dm-call-state').textContent.trim()
  })), { accept: true, decline: true, state: 'Gelen görüntülü arama' })
  await deniz.waitForFunction(() => window.__sesler.indexOf('ring') !== -1, null, { timeout: h.LONG })

  await deniz.click('#call-incoming-decline')
  await deniz.waitForSelector('#call-incoming', { state: 'hidden' })
  await deniz.waitForFunction(() => arama.ringTimer === 0, null, { timeout: h.LONG })
  const rings = await ringCount(deniz)
  await waitCallGone(ece)
  await waitToast(ece, UNANSWERED)
  await waitVoiceOff(ece)
  await waitCallGone(deniz)
  // Zil yaklaşık 3 saniyede bir yinelenir (ARAMA_RING_EVERY_MS): bir aralıktan uzun süre yeni zil yok
  await h.sleep(3500)
  assert.equal(await ringCount(deniz), rings, 'zil durdu')
  assert.equal(await deniz.evaluate(() => voice.snapshot().channelId), null, 'reddeden odaya katılmadı')
  await waitCallable(ece)
})

test('üçüncü kişi çalan aramanın odasına katılamaz, oda herkese açık metada görünmez', async () => {
  const { deniz, ece } = W
  const mert = W.w.P.mert
  await ece.click('#dm-call-voice')
  await waitPhase(ece, 'calling')
  await deniz.waitForSelector('#call-incoming:not([hidden])', { timeout: h.LONG })
  // Arayan aramanın odasında beklerken (zil çalıyor)
  await ece.waitForFunction((id) => String(voice.snapshot().channelId) === id && voice.snapshot().private && !voice.snapshot().joining, W.dmId, { timeout: h.LONG })

  const join = await W.w.call('POST', '/api/voice/join', { channelId: Number(W.dmId) }, mert.token)
  assert.equal(join.status, 404, JSON.stringify(join.data))
  assert.equal(join.data.code, 'channel_not_found')
  const st = await W.w.call('GET', '/api/state', null, mert.token)
  assert.equal(st.status, 200)
  assert.equal(Object.prototype.hasOwnProperty.call(st.data.meta.voice || {}, W.dmId), false, 'üçüncü kişinin metasında aramanın odası yok')
  assert.equal(st.data.private.call, null, 'üçüncü kişinin özel görünümünde arama yok')
  // Çağrı hâlâ çalıyor: üçüncü kişinin denemesi aramayı bozmadı
  assert.equal(await ece.getAttribute('#dm-call', 'data-phase'), 'calling')

  // Arayan zil sırasında iptal eder: aranan taraftaki kart kalkar
  await ece.click('#dm-call-hangup')
  await waitCallGone(ece)
  await deniz.waitForSelector('#call-incoming', { state: 'hidden', timeout: h.LONG })
  await waitCallGone(deniz)
  await deniz.waitForFunction(() => arama.ringTimer === 0, null, { timeout: h.LONG })
  await waitVoiceOff(ece)
  await waitCallable(ece)
})

test('390 piksel genişlikte etkin aramada yatay taşma yok', async () => {
  const { deniz, ece } = W
  await ece.click('#dm-call-voice')
  await deniz.waitForSelector('#call-incoming:not([hidden])', { timeout: h.LONG })
  await deniz.click('#call-incoming-accept')
  await waitPhase(deniz, 'active')
  await waitPhase(ece, 'active')
  for (const page of [deniz, ece]) {
    await page.setViewportSize({ width: 390, height: 844 })
    await nextFrames(page)
    await waitPhase(page, 'active')
    assert.ok(await h.overflowX(page) <= 0, 'yatay taşma yok: ' + await h.overflowX(page))
    const box = await page.evaluate(() => {
      const ids = ['dm-call-mute', 'dm-call-camera', 'dm-call-hangup']
      return ids.map((id) => {
        const r = document.getElementById(id).getBoundingClientRect()
        return r.width > 0 && r.left >= 0 && r.right <= window.innerWidth
      }).concat(Array.from(document.querySelectorAll('#dm-call .call-tile')).map((tile) => {
        const r = tile.getBoundingClientRect()
        return r.width > 0 && r.left >= 0 && r.right <= window.innerWidth
      }))
    })
    assert.deepEqual(box, [true, true, true, true, true], 'denetimler ve kutular ekranda')
  }
  // Aranan kapatır: arama etkin olduğu için arayanda da "Arama sona erdi" yazar
  await deniz.click('#dm-call-hangup')
  await waitCallGone(ece)
  await waitToast(ece, ENDED)
  for (const page of [deniz, ece]) {
    await waitVoiceOff(page)
    await page.setViewportSize({ width: 1440, height: 900 })
  }
})

test('konsol ve sunucu günlüğü temiz', async () => {
  h.assertCleanConsole(W.w.logs, W.w.srv.errors)
})
