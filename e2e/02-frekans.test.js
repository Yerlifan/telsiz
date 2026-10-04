'use strict'

// Frekans düzeni: geniş ekran yerleşimi (tek satırlık bant, solda telsiz kartı ve oda bilgisi, sağda
// İstasyonlar listesi, ortada geniş konuşma sütunu, üst çubuğun ortasında kişisel düğmeler), bantta gezinme
// (tıklama, yön tuşları, Enter, tekerlek, uç düğmeleri), rehber açılır penceresi, Tümü sayfası, arama, anma
// rozeti ve anma listesi, yazıyor göstergesi, telefon genişliğinde yatay taşma olmaması.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { w: null, deniz: null, ece: null, R: {}, K: {} }
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []))

const tunedKey = (page) => page.evaluate(() => {
  const n = document.querySelector('#band-track .station.is-tuned')
  return n ? n.getAttribute('data-station') : ''
})

const waitChannel = (page, id) => page.waitForFunction((cid) => String(state.channelId) === String(cid), id)

before(async () => {
  // Bandın 1440 genişlikte taşması için yeterli oda
  const extraRooms = ['film-gecesi', 'kodlama', 'haberler', 'yemek-tarifleri', 'kitap-kulubu', 'spor'].map((n) => [n, 'text'])
  W.w = await h.setupWorld({ slot: 1, extraRooms })
  const w = W.w
  for (const name of ['genel', 'oyun-gecesi', 'fotograflar', 'spor', 'Lobi']) W.R[name] = w.room(name)
  W.K = { genel: 'text-' + W.R.genel.id, gece: 'text-' + W.R['oyun-gecesi'].id, foto: 'text-' + W.R.fotograflar.id, spor: 'text-' + W.R.spor.id, lobi: 'voice-' + W.R.Lobi.id }
  await w.say('ece', W.R.genel, 'Kelebek etkisi diye bir film vardı')
  await w.say('mert', W.R.genel, 'Akşam dokuzda Lobi?')
  W.deniz = await w.pageFor('deniz')
  W.ece = await w.pageFor('ece')
})

after(async () => {
  if (W.w) await W.w.close()
})

test('geniş düzen: tek satırlık bant, solda telsiz ve oda kartı, sağda İstasyonlar, ortada geniş sohbet', async () => {
  const page = W.deniz
  const r = await page.evaluate(() => {
    const box = (id) => document.getElementById(id).getBoundingClientRect()
    const band = box('band')
    const convo = box('main')
    const radio = box('radio')
    const room = box('room-card')
    const info = box('info-col')
    const right = box('side-right')
    return {
      bandH: Math.round(band.height),
      groups: Array.from(document.querySelectorAll('#band-track .band-group')).map((g) => g.classList.contains('band-group-personal') ? 'personal' : g.getAttribute('aria-label')),
      personalInBand: Boolean(document.querySelector('#band-track .station[data-station="dm"], #band-track .station[data-station="friends"]')),
      radioLeft: Boolean(document.getElementById('info-col').contains(document.getElementById('radio'))),
      radioAboveRoom: radio.bottom <= room.top + 1,
      roomAtBottom: Math.abs(info.bottom - room.bottom) < 4 || room.bottom > info.bottom - 24,
      convoW: Math.round(convo.width),
      rightW: Math.round(right.width),
      hints: Boolean(document.querySelector('#info-col .hints')),
      stationRows: Array.from(document.querySelectorAll('#inbox-list .room-row')).length,
      minStationH: Math.min.apply(null, Array.from(document.querySelectorAll('#band-track .station[data-station]')).map((n) => n.getBoundingClientRect().height)),
      personal: Array.from(document.querySelectorAll('#top-personal .top-personal-button')).map((b) => b.getAttribute('data-station')),
      inboxTitle: document.getElementById('inbox-title').textContent
    }
  })
  // Önceki iki satırlık bant (etiket, ölçek ve istasyon satırları) 120 px idi
  assert.ok(r.bandH <= 76, 'bant yüksekliği yaklaşık yarıya indi: ' + r.bandH)
  assert.ok(r.minStationH >= 44, 'istasyon dokunma hedefi en az 44 px: ' + r.minStationH)
  assert.deepEqual(r.groups, ['Yazı odaları', 'Ses odaları'])
  assert.equal(r.personalInBand, false)
  assert.deepEqual(r.personal, ['dm', 'friends'])
  assert.equal(r.radioLeft, true, 'telsiz kartı sol sütunda')
  assert.equal(r.radioAboveRoom, true, 'telsiz kartı oda kartının üstünde')
  assert.ok(r.roomAtBottom, 'oda kartı sütunun altında')
  // Önceki düzende 1440 genişlikte sohbet sütunu 656 px idi
  assert.ok(r.convoW >= 720, 'sohbet sütunu geniş: ' + r.convoW)
  assert.ok(r.rightW <= 280, 'sağ sütun dar: ' + r.rightW)
  assert.equal(r.hints, false, 'rehber kartı sol sütundan kalktı')
  assert.equal(r.inboxTitle, 'İstasyonlar')
  assert.ok(r.stationRows >= 10, 'İstasyonlar listesinde yazı ve ses odaları')
})

test('İstasyonlar listesi: ayarlı oda işaretli, ok tuşları gezer, satır odaya geçer', async () => {
  const page = W.deniz
  await page.evaluate((id) => selectChannel(id, {}), W.R.genel.id)
  await waitChannel(page, W.R.genel.id)
  await page.waitForFunction((k) => document.querySelector('#inbox-list .room-row[aria-current="page"]').getAttribute('data-station') === k, W.K.genel)
  await page.focus('#inbox-list .room-row[data-station="' + W.K.genel + '"]')
  await page.keyboard.press('ArrowDown')
  const next = await page.evaluate(() => document.activeElement.getAttribute('data-station'))
  assert.ok(next && next !== W.K.genel, 'aşağı ok sonraki satır')
  await page.keyboard.press('End')
  assert.match(await page.evaluate(() => document.activeElement.getAttribute('data-station')), /^voice-/)
  await page.keyboard.press('Home')
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-station')), W.K.genel)
  await page.click('#inbox-list .room-row[data-station="' + W.K.gece + '"]')
  await waitChannel(page, W.R['oyun-gecesi'].id)
  assert.equal(await tunedKey(page), W.K.gece)
  assert.equal(await page.getAttribute('#inbox-list .room-row[data-station="' + W.K.gece + '"]', 'aria-current'), 'page')
  const voiceRow = await page.evaluate((k) => {
    const b = document.querySelector('#inbox-list .room-row[data-station="' + k + '"]')
    return { sub: b.querySelector('.room-row-sub').textContent, label: b.getAttribute('aria-label') }
  }, W.K.lobi)
  assert.equal(voiceRow.sub, 'boş')
  assert.ok(/Lobi/.test(voiceRow.label))
})

test('üst çubuk: kişisel düğmeler Arkadaşlar ve Özel mesajları açar, rehber açılır penceresi Esc ile kapanır', async () => {
  const page = W.deniz
  await page.click('#top-friends')
  await page.waitForFunction(() => currentViewMode() === 'home' && document.getElementById('top-friends').getAttribute('aria-current') === 'page')
  await page.evaluate((id) => selectChannel(id, {}), W.R.genel.id)
  await waitChannel(page, W.R.genel.id)
  assert.equal(await page.getAttribute('#top-friends', 'aria-current'), null)
  await page.click('#band-help')
  await page.waitForFunction(() => !document.getElementById('hints-card').hidden && document.activeElement === document.getElementById('hints-card'))
  assert.equal(await page.getAttribute('#band-help', 'aria-expanded'), 'true')
  assert.ok(/Fare/.test(await page.textContent('#hints-card')))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.getElementById('hints-card').hidden && document.activeElement && document.activeElement.id === 'band-help')
  assert.equal(await page.getAttribute('#band-help', 'aria-expanded'), 'false')
})

test('orta genişlik: telsiz kartı sağ sütuna iner, geri genişleyince sola döner', async () => {
  const page = W.deniz
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.waitForFunction(() => document.getElementById('side-right').contains(document.getElementById('radio')))
  assert.ok(await page.evaluate(() => document.getElementById('radio').getBoundingClientRect().width > 0))
  await page.setViewportSize({ width: 900, height: 800 })
  assert.ok(await h.overflowX(page) <= 0, '900 genişlikte yatay taşma')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForFunction(() => document.getElementById('radio-slot').contains(document.getElementById('radio')))
})

test('bantta tıklama istasyonu ayarlar, ibre ve başlık taşınır', async () => {
  const page = W.deniz
  await h.clickStation(page, W.K.gece)
  await waitChannel(page, W.R['oyun-gecesi'].id)
  const r = await page.evaluate((k) => {
    const n = document.querySelector('#band-track .station[data-station="' + k + '"]')
    return { current: n.getAttribute('aria-current'), needle: Boolean(n.querySelector('.needle')), title: document.getElementById('channel-title').textContent, focus: document.activeElement === n, tuned: document.querySelectorAll('#band-track .station[aria-current]').length }
  }, W.K.gece)
  assert.deepEqual(r, { current: 'page', needle: true, title: 'oyun-gecesi', focus: true, tuned: 1 })
})

test('yön tuşları odağı gezdirir, Enter ayarlar, Home ve End uçlara gider', async () => {
  const page = W.deniz
  await page.evaluate((id) => selectChannel(id, {}), W.R.genel.id)
  await waitChannel(page, W.R.genel.id)
  await page.focus('#band-track .station.is-tuned')
  await page.keyboard.press('ArrowRight')
  const expected = await page.evaluate((k) => {
    const all = Array.from(document.querySelectorAll('#band-track .station[data-station]'))
    const i = all.indexOf(document.querySelector('#band-track .station[data-station="' + k + '"]'))
    return all[i + 1].getAttribute('data-station')
  }, W.K.genel)
  W.K.afterGenel = expected
  const next = await page.evaluate(() => document.activeElement.getAttribute('data-station'))
  assert.equal(next, expected)
  assert.equal(String(await page.evaluate(() => state.channelId)), String(W.R.genel.id), 'ok tuşu ayarlamaz')
  const roving = await page.evaluate(() => Array.from(document.querySelectorAll('#band-track .station')).filter((n) => n.tabIndex === 0).length)
  assert.equal(roving, 1, 'bantta tek sekme durağı')
  await page.keyboard.press('Enter')
  await page.waitForFunction((k) => document.querySelector('#band-track .station.is-tuned').getAttribute('data-station') === k, expected)
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-station')), expected, 'odak bantta kalır')
  await page.keyboard.press('ArrowLeft')
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-station')), W.K.genel)
  await page.keyboard.press('Home')
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-station')), W.K.genel, 'bant yazı odalarıyla başlar')
  await page.keyboard.press('End')
  const end = await page.evaluate(() => {
    const a = document.activeElement
    const tr = document.getElementById('band-track').getBoundingClientRect()
    const rr = a.getBoundingClientRect()
    return { kind: a.getAttribute('data-kind'), inView: rr.left >= tr.left - 1 && rr.right <= tr.right + 1 }
  })
  assert.deepEqual(end, { kind: 'voice', inView: true })
  assert.equal(await tunedKey(page), expected, 'Home ve End ayarlamaz')
})

test('uç düğmeleri sonraki ve önceki konuşma istasyonuna geçer', async () => {
  const page = W.deniz
  await page.evaluate((id) => selectChannel(id, {}), W.R.genel.id)
  await waitChannel(page, W.R.genel.id)
  const nextName = await page.evaluate((k) => document.querySelector('#band-track .station[data-station="' + k + '"] .station-name').textContent, W.K.afterGenel)
  assert.equal(await page.getAttribute('#band-next', 'aria-label'), 'Sonraki istasyon: ' + nextName)
  await page.click('#band-next')
  await page.waitForFunction((k) => document.querySelector('#band-track .station.is-tuned').getAttribute('data-station') === k, W.K.afterGenel)
  await page.click('#band-prev')
  await waitChannel(page, W.R.genel.id)
})

test('tekerlek taşan bandı yatay kaydırır, oda değişmez', async () => {
  const page = W.deniz
  const before = await page.evaluate(() => ({ over: el.bandTrack.scrollWidth > el.bandTrack.clientWidth, ch: String(state.channelId) }))
  assert.ok(before.over, '1440 genişlikte bant taşıyor olmalı')
  await page.evaluate(() => { el.bandTrack.scrollLeft = 0 })
  const tb = await page.locator('#band-track').boundingBox()
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height - 20)
  await page.mouse.wheel(0, 240)
  await page.waitForFunction(() => el.bandTrack.scrollLeft > 0)
  const after = await page.evaluate(() => ({ ch: String(state.channelId), tuned: document.querySelector('#band-track .station.is-tuned').getAttribute('data-station'), pageY: document.scrollingElement.scrollTop }))
  assert.equal(after.ch, before.ch, 'tekerlek oda değiştirmez')
  assert.equal(after.tuned, W.K.genel)
  assert.equal(after.pageY, 0, 'sayfa dikey kaymaz')
})

test('Tümü sayfası açılır, satır ayarlar, Esc kapatır ve odak düğmeye döner', async () => {
  const page = W.deniz
  await page.click('#band-all')
  await page.waitForFunction(() => !document.getElementById('stations-sheet').hidden && document.getElementById('stations-sheet').contains(document.activeElement))
  assert.equal(await page.getAttribute('#band-all', 'aria-expanded'), 'true')
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#stations-list .sheet-row[data-station]')).map((n) => n.getAttribute('data-station')))
  for (const key of [W.K.genel, W.K.gece, W.K.spor, W.K.lobi]) assert.ok(rows.indexOf(key) !== -1, 'Tümü içinde ' + key)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.getElementById('stations-sheet').hidden && document.activeElement && document.activeElement.id === 'band-all')
  await page.click('#band-all')
  await page.waitForSelector('#stations-sheet:not([hidden])')
  await page.click('#stations-list .sheet-row[data-station="' + W.K.spor + '"]')
  await page.waitForFunction((id) => String(state.channelId) === String(id) && document.getElementById('stations-sheet').hidden, W.R.spor.id)
  assert.equal(await tunedKey(page), W.K.spor)
})

test('arama mesajı bulur, sonuca gitmek odayı açar ve mesajı vurgular', async () => {
  const page = W.deniz
  await page.click('#btn-search')
  await page.waitForSelector('#search-panel:not([hidden]) #search-input')
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'search-input')
  await page.click('#search-scope [data-value="text"]')
  await page.fill('#search-input', 'kelebek')
  await page.waitForFunction(() => document.querySelectorAll('#search-results .search-result').length === 1 && !searchState.scanning, null, { timeout: h.LONG })
  const r = await page.evaluate(() => {
    const b = document.querySelector('#search-results .search-result')
    return { ch: b.querySelector('.search-result-channel').textContent, hit: b.querySelector('mark.search-hit').textContent }
  })
  assert.deepEqual(r, { ch: 'genel', hit: 'Kelebek' })
  await page.click('#search-results .search-result')
  await page.waitForFunction((id) => String(state.channelId) === String(id) && !state.loading && document.querySelector('#message-list .msg.is-highlighted') && document.getElementById('search-panel').hidden, W.R.genel.id, { timeout: h.LONG })
})

test('anma: başka odadaki @ad istasyonda @1 rozeti ve Gelenler satırı, açınca silinir', async () => {
  const page = W.deniz
  await page.evaluate((id) => selectChannel(id, {}), W.R.genel.id)
  await waitChannel(page, W.R.genel.id)
  await W.w.say('ece', W.R.fotograflar, '@deniz bu kareye bak')
  await page.waitForFunction((k) => {
    const m = document.querySelector('#band-track .station[data-station="' + k + '"] .mark-mention')
    return m && m.textContent === '@1'
  }, W.K.foto, { timeout: h.LONG })
  const label = await page.getAttribute('#band-track .station[data-station="' + W.K.foto + '"]', 'aria-label')
  assert.equal(label, 'fotograflar, yazı odası, 1 anma')
  await page.waitForFunction((k) => {
    const m = document.querySelector('#inbox-list .room-row[data-station="' + k + '"] .mark-mention')
    return m && m.textContent === '@1'
  }, W.K.foto)
  await page.click('#inbox-list .room-row[data-station="' + W.K.foto + '"]')
  await waitChannel(page, W.R.fotograflar.id)
  await page.waitForFunction((k) => !document.querySelector('#band-track .station[data-station="' + k + '"] .station-mark'), W.K.foto)
  await page.waitForSelector('#message-list .mention.mention-user.is-me')
  assert.equal(await page.textContent('#message-list .mention.is-me'), '@deniz', 'mesajda kendi anmam vurgulu')
})

test('anma listesi: @ yazınca açılır, seçim adı yazma alanına ekler', async () => {
  const page = W.deniz
  await page.click('#composer-input')
  await page.keyboard.type('@ec')
  await page.waitForFunction(() => !document.getElementById('mention-popover').hidden && document.querySelector('#mention-popover .mention-option'))
  const options = await page.evaluate(() => Array.from(document.querySelectorAll('#mention-popover .mention-option')).map((o) => o.getAttribute('data-user-id')))
  assert.deepEqual(options, [String(W.w.P.ece.id)])
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => document.getElementById('mention-popover').hidden)
  assert.equal(await page.inputValue('#composer-input'), '@ece ')
  await page.fill('#composer-input', '')
})

test('yazıyor göstergesi: karşı tarafta görünür, alan boşalınca kalkar', async () => {
  const { deniz, ece } = W
  await deniz.evaluate((id) => selectChannel(id, {}), W.R.genel.id)
  await ece.evaluate((id) => selectChannel(id, {}), W.R.genel.id)
  await waitChannel(deniz, W.R.genel.id)
  await waitChannel(ece, W.R.genel.id)
  await ece.click('#composer-input')
  await ece.keyboard.type('bir saniye yazıyorum')
  await deniz.waitForFunction(() => {
    const l = document.getElementById('typing-line')
    return !l.hidden && l.textContent === 'Ece yazıyor'
  }, null, { timeout: h.LONG })
  assert.equal(await ece.evaluate(() => document.getElementById('typing-line').hidden), true, 'kişi kendi yazıyor bilgisini görmez')
  await ece.fill('#composer-input', '')
  await deniz.waitForFunction(() => document.getElementById('typing-line').hidden, null, { timeout: h.LONG })
})

test('telefon 390: yatay taşma yok, Tümü alt sayfası tam genişlik', async () => {
  const page = W.deniz
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => el.appView.getAttribute('data-layout') === 'phone' || window.innerWidth === 390)
  assert.ok(await h.overflowX(page) <= 0, 'ana görünümde yatay taşma')
  await page.click('#band-all')
  await page.waitForSelector('#stations-sheet:not([hidden])')
  await page.waitForFunction(() => {
    const r = document.getElementById('stations-sheet').getBoundingClientRect()
    return Math.round(r.left) === 0 && Math.round(r.width) === 390 && Math.round(window.innerHeight - r.bottom) === 0
  })
  assert.ok(await h.overflowX(page) <= 0, 'Tümü açıkken yatay taşma')
  await page.keyboard.press('Escape')
  await page.waitForSelector('#stations-sheet', { state: 'hidden' })
  await page.click('#btn-search')
  await page.waitForSelector('#search-panel:not([hidden])')
  assert.ok(await h.overflowX(page) <= 0, 'arama açıkken yatay taşma')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('konsol ve sunucu günlüğü temiz', async () => {
  h.assertCleanConsole(W.w.logs, W.w.srv.errors)
})
