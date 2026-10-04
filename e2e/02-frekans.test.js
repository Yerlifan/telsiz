'use strict'

// Frekans düzeni: geniş ekran yerleşimi (bant katılınan frekansları dizer, solda telsiz kartı ve oda bilgisi,
// sağda İstasyonlar listesi: yazı ve ses odaları, Oda ekle başlıkta, ortada geniş konuşma sütunu, üst çubuğun
// ortasında kişisel düğmeler), bantta frekanslar arasında gezinme (yön tuşları, Home, End, uç düğmeleri,
// tekerlek, tıklama ve ibre sürükleme ile başka frekansa geçiş, ses odasındayken onay), rehber açılır
// penceresi, Frekanslar sayfası (Tümü), sağ sütun görünmediğinde İstasyonlar düğmesi ve sayfası (900 ve
// 390 genişlikte), arama, anma rozeti ve anma listesi, yazıyor göstergesi, telefon genişliğinde yatay taşma
// olmaması. Tarayıcıda diğer frekanslar ayrı köken olduğu için durumları ve sayıları gösterilmez.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { w: null, deniz: null, ece: null, R: {}, K: {}, F: [] }
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []))

const waitChannel = (page, id) => page.waitForFunction((cid) => String(state.channelId) === String(cid), id)
const tunedKey = (page) => page.evaluate(() => {
  const n = document.querySelector('#band-track .station.is-tuned')
  return n ? n.getAttribute('data-station') : ''
})
const focusKey = (page) => page.evaluate(() => document.activeElement.getAttribute('data-station'))

// Bantta yeterli frekans: kayıtlı liste bu kökenin yerel deposuna yazılır (başka frekansların sunucusu
// yoktur, geçiş isteği aşağıdaki yönlendirmeyle küçük bir sayfaya gider)
const FREKANS_COUNT = 10
const fakeOrigin = (i) => 'https://f' + i + '.ornek.com'

async function seedFrekanslar (page) {
  await page.evaluate((list) => {
    localStorage.setItem('telsiz.frekanslar', JSON.stringify(list))
    localStorage.setItem('telsiz.frekanslar.konum', '0')
    frekansState.webList = null
    renderBand()
  }, W.F)
  await page.waitForFunction((n) => document.querySelectorAll('#band-track .station[data-station]').length === n, FREKANS_COUNT + 1)
}

// Başka frekansa geçiş sekmeyi o kökene götürür: adres ve # parçası denetlenir, sonra uygulamaya dönülür
async function expectSwitch (page, origin, action) {
  await Promise.all([page.waitForURL((url) => url.origin === origin, { timeout: h.LONG }), action()])
  const url = new URL(page.url())
  assert.match(url.hash, /^#frekanslar=[A-Za-z0-9_-]+$/)
  const decoded = JSON.parse(Buffer.from(url.hash.slice('#frekanslar='.length), 'base64url').toString('utf8'))
  assert.equal(decoded.v, 1)
  assert.equal(decoded.f[0][0], W.w.base, 'açık frekans bant sırasıyla başta ve adıyla')
  assert.equal(decoded.f[0][1], 'Kankalar')
  assert.equal(decoded.f.length, FREKANS_COUNT + 1)
  await page.goto(W.w.base + '/')
  await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  await page.waitForFunction((n) => document.querySelectorAll('#band-track .station[data-station]').length === n, FREKANS_COUNT + 1, { timeout: h.LONG })
}

before(async () => {
  const extraRooms = ['film-gecesi', 'kodlama', 'haberler'].map((n) => [n, 'text'])
  W.w = await h.setupWorld({ slot: 1, extraRooms })
  const w = W.w
  for (const name of ['genel', 'oyun-gecesi', 'fotograflar', 'Lobi']) W.R[name] = w.room(name)
  W.K = { genel: 'text-' + W.R.genel.id, gece: 'text-' + W.R['oyun-gecesi'].id, foto: 'text-' + W.R.fotograflar.id, lobi: 'voice-' + W.R.Lobi.id }
  W.F = Array.from({ length: FREKANS_COUNT }, (_, i) => ({ origin: fakeOrigin(i + 1), name: 'Frekans ' + (i + 1) }))
  await w.say('ece', W.R.genel, 'Kelebek etkisi diye bir film vardı')
  await w.say('mert', W.R.genel, 'Akşam dokuzda Lobi?')
  W.deniz = await w.pageFor('deniz')
  W.ece = await w.pageFor('ece')
  // Başka frekansların adresleri küçük bir sayfaya yönlendirilir
  await W.deniz.context().route('https://*.ornek.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><title>başka frekans</title><p>başka frekans</p>' }))
  await seedFrekanslar(W.deniz)
})

after(async () => {
  if (W.w) await W.w.close()
})

test('geniş düzen: bant frekansları dizer, odalar sağdaki İstasyonlar listesinde, Oda ekle başlıkta', async () => {
  const page = W.deniz
  const r = await page.evaluate(() => {
    const box = (id) => document.getElementById(id).getBoundingClientRect()
    const band = box('band')
    const convo = box('main')
    const radio = box('radio')
    const room = box('room-card')
    const info = box('info-col')
    const right = box('side-right')
    const stations = Array.from(document.querySelectorAll('#band-track .station[data-station]'))
    return {
      bandH: Math.round(band.height),
      groups: Array.from(document.querySelectorAll('#band-track .band-group-label')).map((n) => n.textContent),
      kinds: stations.map((n) => n.getAttribute('data-kind')).filter((k, i, a) => a.indexOf(k) === i),
      roomsInBand: Boolean(document.querySelector('#band-track [data-station^="text-"], #band-track [data-station^="voice-"], #band-track [data-station="dm"]')),
      tuned: Array.from(document.querySelectorAll('#band-track .station.is-tuned')).map((n) => [n.getAttribute('data-station'), n.getAttribute('aria-current'), Boolean(n.querySelector('.needle'))]),
      firstName: stations[0].querySelector('.station-name').textContent,
      firstLabel: stations[0].getAttribute('aria-label'),
      otherLabel: stations[1].getAttribute('aria-label'),
      otherTitle: stations[1].title,
      otherDot: stations[1].querySelector('.frekans-dot').className,
      tunedDot: stations[0].querySelector('.frekans-dot').className,
      radioLeft: Boolean(document.getElementById('info-col').contains(document.getElementById('radio'))),
      roomHidden: room.width === 0 && room.height === 0,
      radioAtBottom: Math.abs(info.bottom - radio.bottom) < 4 || radio.bottom > info.bottom - 24,
      convoW: Math.round(convo.width),
      rightW: Math.round(right.width),
      stationRows: Array.from(document.querySelectorAll('#inbox-list .room-row')).length,
      minStationH: Math.min.apply(null, stations.map((n) => n.getBoundingClientRect().height)),
      rootPx: parseFloat(getComputedStyle(document.documentElement).fontSize),
      personal: Array.from(document.querySelectorAll('#top-personal .top-personal-button')).map((b) => b.getAttribute('data-station')),
      inboxTitle: document.getElementById('inbox-title').textContent,
      inboxAdd: [document.getElementById('inbox-add').hidden, document.getElementById('inbox-add').getAttribute('aria-label')],
      roomsButton: document.getElementById('btn-rooms').getClientRects().length,
      bandAdd: [document.getElementById('band-add').hidden, document.getElementById('band-add').getAttribute('aria-label')]
    }
  })
  assert.ok(r.bandH <= 76, 'bant tek satır: ' + r.bandH)
  // Dokunma hedefi 2.75rem: 16 piksel kökte 44, varsayılan 15 piksel kökte 41,25 piksel
  assert.equal(r.rootPx, 15)
  assert.ok(r.minStationH >= 2.75 * r.rootPx - 0.5, 'istasyon dokunma hedefi en az 2.75rem: ' + r.minStationH)
  assert.deepEqual(r.groups, ['Frekanslar'])
  assert.deepEqual(r.kinds, ['frekans'])
  assert.equal(r.roomsInBand, false, 'bantta oda yok')
  assert.deepEqual(r.tuned, [[W.w.base, 'page', true]], 'ibre açık frekansta')
  assert.equal(r.firstName, 'Kankalar')
  assert.equal(r.firstLabel, 'Kankalar, açık frekans')
  assert.equal(r.otherLabel, 'Frekans 1, durumu bilinmiyor, durumu ve sayıları yalnızca açıkken görünür')
  assert.match(r.otherTitle, /ayrı bir sitedir/)
  assert.match(r.tunedDot, /is-open/)
  assert.match(r.otherDot, /is-unknown/)
  assert.deepEqual(r.personal, ['dm', 'friends'])
  assert.equal(r.radioLeft, true, 'telsiz kartı sol sütunda')
  assert.equal(r.roomHidden, true, 'ayarlı istasyon kartı geniş ekranda gösterilmez')
  assert.ok(r.radioAtBottom, 'telsiz kartı sütunun altında')
  assert.ok(r.convoW >= 720, 'sohbet sütunu geniş: ' + r.convoW)
  assert.ok(r.rightW <= 280, 'sağ sütun dar: ' + r.rightW)
  assert.equal(r.inboxTitle, 'İstasyonlar')
  assert.deepEqual(r.inboxAdd, [false, 'Oda ekle'], 'sahip için Oda ekle başlıkta')
  assert.equal(r.roomsButton, 0, 'geniş ekranda İstasyonlar düğmesi gizli')
  assert.deepEqual(r.bandAdd, [false, 'Frekans ekle'], 'bandın + düğmesi Frekans ekle')
  assert.ok(r.stationRows >= 9, 'İstasyonlar listesinde yazı ve ses odaları')
  // Üye için Oda ekle görünmez
  assert.equal(await W.ece.evaluate(() => document.getElementById('inbox-add').hidden), true)
})

test('İstasyonlar listesi: ayarlı oda işaretli, ok tuşları gezer, satır odaya geçer, Oda ekle ayarları açar', async () => {
  const page = W.deniz
  await page.evaluate((id) => selectChannel(id, {}), W.R.genel.id)
  await waitChannel(page, W.R.genel.id)
  await page.waitForFunction((k) => document.querySelector('#inbox-list .room-row[aria-current="page"]').getAttribute('data-station') === k, W.K.genel)
  await page.focus('#inbox-list .room-row[data-station="' + W.K.genel + '"]')
  await page.keyboard.press('ArrowDown')
  const next = await focusKey(page)
  assert.ok(next && next !== W.K.genel, 'aşağı ok sonraki satır')
  await page.keyboard.press('End')
  assert.match(await focusKey(page), /^voice-/)
  await page.keyboard.press('Home')
  assert.equal(await focusKey(page), W.K.genel)
  await page.click('#inbox-list .room-row[data-station="' + W.K.gece + '"]')
  await waitChannel(page, W.R['oyun-gecesi'].id)
  assert.equal(await page.getAttribute('#inbox-list .room-row[data-station="' + W.K.gece + '"]', 'aria-current'), 'page')
  assert.equal(await tunedKey(page), W.w.base, 'oda değişince ibre frekansta kalır')
  const voiceRow = await page.evaluate((k) => {
    const b = document.querySelector('#inbox-list .room-row[data-station="' + k + '"]')
    return { sub: b.querySelector('.room-row-sub').textContent, label: b.getAttribute('aria-label') }
  }, W.K.lobi)
  assert.equal(voiceRow.sub, 'boş')
  assert.ok(/Lobi/.test(voiceRow.label))
  await page.click('#inbox-add')
  await page.waitForSelector('#settings-view:not([hidden])')
  await page.keyboard.press('Escape')
  await page.waitForSelector('#settings-view', { state: 'hidden' })
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
  const text = await page.textContent('#hints-card')
  assert.ok(/Fare/.test(text) && /frekans değişmez/.test(text), text)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.getElementById('hints-card').hidden && document.activeElement && document.activeElement.id === 'band-help')
})

test('yön tuşları frekanslar arasında odağı gezdirir, geçiş yapmaz, Home ve End uçlara gider', async () => {
  const page = W.deniz
  await page.focus('#band-track .station.is-tuned')
  await page.keyboard.press('ArrowRight')
  assert.equal(await focusKey(page), fakeOrigin(1))
  assert.equal(page.url().indexOf(W.w.base), 0, 'ok tuşu geçiş yapmaz')
  const roving = await page.evaluate(() => Array.from(document.querySelectorAll('#band-track .station')).filter((n) => n.tabIndex === 0).length)
  assert.equal(roving, 1, 'bantta tek sekme durağı')
  await page.keyboard.press('ArrowLeft')
  assert.equal(await focusKey(page), W.w.base)
  // Açık frekansı Enter ile ayarlamak bir şey yapmaz
  await page.keyboard.press('Enter')
  await page.waitForTimeout(200)
  assert.equal(new URL(page.url()).origin, W.w.base)
  await page.keyboard.press('End')
  const end = await page.evaluate(() => {
    const a = document.activeElement
    const tr = document.getElementById('band-track').getBoundingClientRect()
    const rr = a.getBoundingClientRect()
    return { key: a.getAttribute('data-station'), inView: rr.left >= tr.left - 1 && rr.right <= tr.right + 1 }
  })
  assert.deepEqual(end, { key: fakeOrigin(FREKANS_COUNT), inView: true })
  await page.keyboard.press('Home')
  assert.equal(await focusKey(page), W.w.base)
  assert.equal(await tunedKey(page), W.w.base, 'Home ve End ayarlamaz')
})

test('uç düğmelerinin adı hedef frekansı söyler, sonraki frekans düğmesi geçiş yapar', async () => {
  const page = W.deniz
  assert.equal(await page.getAttribute('#band-next', 'aria-label'), 'Sonraki frekans: Frekans 1')
  assert.equal(await page.getAttribute('#band-prev', 'aria-label'), 'Önceki frekans: Frekans ' + FREKANS_COUNT)
  await expectSwitch(page, fakeOrigin(1), () => page.click('#band-next'))
})

test('tekerlek taşan bandı yatay kaydırır, frekans değişmez', async () => {
  const page = W.deniz
  const before = await page.evaluate(() => ({ over: el.bandTrack.scrollWidth > el.bandTrack.clientWidth }))
  assert.ok(before.over, '1440 genişlikte bant taşıyor olmalı')
  await page.evaluate(() => { el.bandTrack.scrollLeft = 0 })
  const tb = await page.locator('#band-track').boundingBox()
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height - 20)
  await page.mouse.wheel(0, 240)
  await page.waitForFunction(() => el.bandTrack.scrollLeft > 0)
  const after = await page.evaluate(() => ({ tuned: document.querySelector('#band-track .station.is-tuned').getAttribute('data-station'), pageY: document.scrollingElement.scrollTop }))
  assert.equal(after.tuned, W.w.base)
  assert.equal(new URL(page.url()).origin, W.w.base, 'tekerlek frekans değiştirmez')
  assert.equal(after.pageY, 0, 'sayfa dikey kaymaz')
})

test('başka frekansa tıklamak ve ibreyi sürükleyip bırakmak o frekansa geçer', async () => {
  const page = W.deniz
  await expectSwitch(page, fakeOrigin(2), () => h.clickStation(page, fakeOrigin(2)))
  // İbre topuzundan tutulup ikinci frekansın üstüne bırakılır
  const target = fakeOrigin(1)
  const geo = await page.evaluate((k) => {
    el.bandTrack.scrollLeft = 0
    const needle = document.querySelector('#band-track .station.is-tuned .needle').getBoundingClientRect()
    const st = document.querySelector('#band-track .station[data-station="' + k + '"]').getBoundingClientRect()
    // Topuzun ortası (ibrenin üst kenarı çevresinde)
    return { x: needle.left + needle.width / 2, y: needle.top + 4, tx: st.left + st.width / 2 }
  }, target)
  await expectSwitch(page, target, async () => {
    await page.mouse.move(geo.x, geo.y)
    await page.mouse.down()
    await page.mouse.move(geo.x + 30, geo.y, { steps: 3 })
    await page.mouse.move(geo.tx, geo.y, { steps: 8 })
    await page.mouse.up()
  })
})

test('ses odasındayken frekans değiştirmek onay ister, vazgeçince geçilmez', async () => {
  const page = W.deniz
  await h.joinVoice(page, W.R.Lobi.id)
  await page.waitForFunction((id) => {
    const row = document.querySelector('#inbox-list .room-row[data-channel-id="' + id + '"]')
    return row && row.classList.contains('is-connected')
  }, W.R.Lobi.id, { timeout: h.LONG })
  await h.clickStation(page, fakeOrigin(3))
  await page.waitForSelector('#frekans-voice-dialog')
  assert.match(await page.textContent('#frekans-voice-dialog'), /ses bağlantınız kesilir/)
  assert.equal(await page.textContent('#frekans-voice-confirm'), 'Frekans 3 frekansına geç')
  await page.click('#frekans-voice-cancel')
  await page.waitForFunction(() => !document.getElementById('frekans-voice-dialog'))
  assert.equal(new URL(page.url()).origin, W.w.base)
  await page.click('#voice-leave')
  await page.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
}, { browsers: h.MIC_BROWSERS, reason: 'sahte mikrofon yok' })

test('Tümü Frekanslar sayfasını açar: açık frekans işaretli, satırlar, Esc kapatır ve odak düğmeye döner', async () => {
  const page = W.deniz
  await page.click('#band-all')
  await page.waitForFunction(() => !document.getElementById('frekans-sheet').hidden && document.getElementById('frekans-sheet').contains(document.activeElement))
  assert.equal(await page.getAttribute('#band-all', 'aria-expanded'), 'true')
  const r = await page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('#frekans-sheet-list .frekans-sheet-row')).map((n) => [n.getAttribute('data-frekans'), n.getAttribute('aria-current')]),
    focus: document.activeElement.getAttribute('data-frekans'),
    removable: document.querySelectorAll('#frekans-sheet-list .frekans-remove').length,
    add: document.getElementById('frekans-sheet-add').textContent,
    note: document.querySelector('#frekans-sheet-list .frekans-note').textContent
  }))
  assert.equal(r.rows.length, FREKANS_COUNT + 1)
  assert.deepEqual(r.rows[0], [W.w.base, 'page'])
  assert.equal(r.focus, W.w.base, 'odak açık frekansta')
  assert.equal(r.removable, FREKANS_COUNT, 'tarayıcıda açık frekans listeden çıkarılamaz')
  assert.equal(r.add, 'Frekans ekle')
  assert.match(r.note, /ayrı bir sitedir/)
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-frekans-remove') || document.activeElement.getAttribute('data-frekans')), fakeOrigin(1))
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.getElementById('frekans-sheet').hidden && document.activeElement && document.activeElement.id === 'band-all')
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

test('anma: başka odadaki @ad İstasyonlar satırında @1 ve banttaki açık frekansta sayılır, açınca silinir', async () => {
  const page = W.deniz
  await page.evaluate((id) => selectChannel(id, {}), W.R.genel.id)
  await waitChannel(page, W.R.genel.id)
  await W.w.say('ece', W.R.fotograflar, '@deniz bu kareye bak')
  await page.waitForFunction((k) => {
    const m = document.querySelector('#inbox-list .room-row[data-station="' + k + '"] .mark-mention')
    return m && m.textContent === '@1'
  }, W.K.foto, { timeout: h.LONG })
  assert.equal(await page.getAttribute('#inbox-list .room-row[data-station="' + W.K.foto + '"]', 'aria-label'), 'fotograflar, yazı odası, 1 anma')
  const band = await page.evaluate(() => {
    const n = document.querySelector('#band-track .station.is-tuned')
    return { label: n.getAttribute('aria-label'), mention: (n.querySelector('.frekans-mention') || {}).textContent }
  })
  assert.equal(band.mention, '@1')
  assert.match(band.label, /^Kankalar, açık frekans, \d+ okunmamış, 1 anma$/)
  await page.click('#inbox-list .room-row[data-station="' + W.K.foto + '"]')
  await waitChannel(page, W.R.fotograflar.id)
  await page.waitForFunction((k) => !document.querySelector('#inbox-list .room-row[data-station="' + k + '"] .station-mark') && !document.querySelector('#band-track .station.is-tuned .frekans-mention'), W.K.foto)
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

test('900 genişlik: telsiz kartı sağ sütunda, İstasyonlar düğmesi odaları yan sayfada açar', async () => {
  const page = W.deniz
  await page.setViewportSize({ width: 1100, height: 900 })
  await page.waitForFunction(() => document.getElementById('side-right').contains(document.getElementById('radio')))
  await page.setViewportSize({ width: 900, height: 800 })
  // Düzen değişince açık sayfalar kapanır (12-init.js onResize): yeni düzen uygulanana kadar beklenir
  await page.waitForFunction(() => window.innerWidth === 900 && el.appView.getAttribute('data-layout') === layoutClass())
  assert.ok(await h.overflowX(page) <= 0, '900 genişlikte yatay taşma')
  const shown = await page.evaluate(() => ({ button: document.getElementById('btn-rooms').getClientRects().length > 0, inbox: document.getElementById('inbox').getClientRects().length > 0 }))
  assert.deepEqual(shown, { button: true, inbox: false })
  await page.focus('#btn-rooms')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !document.getElementById('stations-sheet').hidden && document.getElementById('stations-sheet').contains(document.activeElement))
  const r = await page.evaluate(() => {
    const box = document.getElementById('stations-sheet').getBoundingClientRect()
    return {
      right: Math.round(window.innerWidth - box.right),
      width: Math.round(box.width),
      focus: document.activeElement.getAttribute('data-station'),
      add: !document.getElementById('rooms-sheet-add').hidden,
      title: document.getElementById('stations-sheet-title').textContent,
      expanded: document.getElementById('btn-rooms').getAttribute('aria-expanded')
    }
  })
  assert.ok(r.right <= 16 && r.width < 900, 'yan sayfa sağda: ' + JSON.stringify(r))
  assert.equal(r.focus, W.K.genel, 'odak ayarlı odada')
  assert.deepEqual([r.add, r.title, r.expanded], [true, 'İstasyonlar', 'true'])
  assert.ok(await h.overflowX(page) <= 0, 'sayfa açıkken yatay taşma')
  await page.keyboard.press('ArrowDown')
  const target = await focusKey(page)
  await page.keyboard.press('Enter')
  await page.waitForFunction((k) => document.getElementById('stations-sheet').hidden && 'text-' + state.channelId === k, target)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForFunction(() => document.getElementById('radio-slot').contains(document.getElementById('radio')))
})

test('telefon 390: yatay taşma yok, İstasyonlar ve Frekanslar alt sayfa, ses odası satırı katılır', async () => {
  const page = W.deniz
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => window.innerWidth === 390 && el.appView.getAttribute('data-layout') === layoutClass())
  assert.ok(await h.overflowX(page) <= 0, 'ana görünümde yatay taşma')
  await page.click('#btn-rooms')
  await page.waitForSelector('#stations-sheet:not([hidden])')
  await page.waitForFunction(() => {
    const r = document.getElementById('stations-sheet').getBoundingClientRect()
    return Math.round(r.left) === 0 && Math.round(r.width) === 390 && Math.round(window.innerHeight - r.bottom) === 0
  })
  assert.ok(await h.overflowX(page) <= 0, 'İstasyonlar açıkken yatay taşma')
  // Ses odası satırı odaya katılır ve sayfa kapanır (sahte mikrofonu olmayan WebKit'te sayfa kapatılır)
  if (h.FAKE_MIC) {
    await page.click('#stations-list .room-row[data-station="' + W.K.lobi + '"]')
    await page.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'on' && document.getElementById('stations-sheet').hidden, null, { timeout: h.LONG })
    await page.click('#voice-leave')
    await page.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
  } else {
    await page.keyboard.press('Escape')
    await page.waitForSelector('#stations-sheet', { state: 'hidden' })
  }
  await page.click('#band-all')
  await page.waitForSelector('#frekans-sheet:not([hidden])')
  await page.waitForFunction(() => {
    const r = document.getElementById('frekans-sheet').getBoundingClientRect()
    return Math.round(r.left) === 0 && Math.round(r.width) === 390
  })
  assert.ok(await h.overflowX(page) <= 0, 'Frekanslar açıkken yatay taşma')
  await page.keyboard.press('Escape')
  await page.waitForSelector('#frekans-sheet', { state: 'hidden' })
  await page.click('#btn-search')
  await page.waitForSelector('#search-panel:not([hidden])')
  assert.ok(await h.overflowX(page) <= 0, 'arama açıkken yatay taşma')
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1440, height: 900 })
})

test('konsol ve sunucu günlüğü temiz', async () => {
  h.assertCleanConsole(W.w.logs, W.w.srv.errors)
})
