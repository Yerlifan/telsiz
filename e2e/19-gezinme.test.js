'use strict'

// Yazı kanallarında ve sohbetlerde gezinme (istek 17). Bu dosyayı G2 kurar, gezinme işleri (G9, G10) genişletir.
// G2, taslak ve ek sızıntısı (S1, public/js/08-composer.js): bir konuşmanın yazma alanındaki metin ve ek başka
// bir konuşmaya geçince orada görünmez ve gönderilemez, geri dönünce yerinde durur.
// - 1440 genişlikte arayüz düğmeleriyle: özel mesajda metin ve fotoğraf, genel odasına geçiş, yazma alanı boş ve
//   Gönder pasif, Enter mesaj göndermez. Geri dönünce taslak ve ek yerinde, gönderilen özel mesaj genel odasına
//   düşmez
// - İki yazı odası arasında aynı kural
// - Beş genişlikte (360, 412, 768, 1024, 1440) özel mesaj ile oda arasında taslak sızmaz, yatay taşma 0
// - Arkadaşlar görünümünde yazma alanı gizli ve boş, özel konuşmaya dönünce taslak ve ek yerinde (showHome)
// - Taslakta süresi dolmak üzere olan ek konuşmaya dönülünce yeniden yüklenir, sunucunun tanımadığı ek
//   (bad_uploads) gönderimde yeniden yüklenir ve mesaj yeni ekle gider
// - Kişi engellenince o kişiyle özel konuşmanın bekleyen taslağı ve eki silinir
// - Konsol ve sunucu günlüğü temiz (bad_uploads denemesinin beklenen 400 yanıtı dışında)

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { w: null, deniz: null, dmEce: null, dmMert: null }
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []))

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const WIDTHS = [360, 412, 768, 1024, 1440]

// Kişi, Deniz ile arkadaş olur, özel konuşmayı açar ve bir mesaj gönderir (özel konuşma Deniz'in listesine girer)
async function dmWith (who, text) {
  const w = W.w
  const p = w.P[who]
  let res = await w.call('POST', '/api/friends/request', { name: 'deniz' }, p.token)
  assert.equal(res.status, 200, JSON.stringify(res.data))
  res = await w.call('POST', '/api/friends/accept', { userId: p.id }, w.P.deniz.token)
  assert.equal(res.status, 200, JSON.stringify(res.data))
  res = await w.call('POST', '/api/dms/open', { userId: w.P.deniz.id }, p.token)
  assert.equal(res.status, 200, JSON.stringify(res.data))
  const dmId = res.data.dm.id
  const body = w.E.dm.seal({ v: 1, a: p.id, c: dmId, t: text, f: [] }, w.P.deniz.publicKey, p.secretKey)
  res = await w.call('POST', '/api/messages', { channelId: dmId, body, uploads: [] }, p.token)
  assert.equal(res.status, 200, JSON.stringify(res.data))
  return dmId
}

before(async () => {
  W.w = await h.setupWorld({ slot: 27 })
  W.dmEce = await dmWith('ece', 'Merhaba Deniz')
  W.deniz = await W.w.pageFor('deniz')
  await W.deniz.waitForFunction((id) => Boolean(dmEntry(id)), W.dmEce, { timeout: h.LONG })
})

after(async () => {
  if (W.w) await W.w.close()
})

// Yazma alanının görünen durumu: metin, ek çipleri, Gönder düğmesi
function composerView (page) {
  return page.evaluate(() => {
    const list = document.getElementById('attach-list')
    return {
      text: document.getElementById('composer-input').value,
      chips: list.hidden ? [] : Array.from(list.querySelectorAll('.chip .chip-name')).map((n) => n.textContent),
      send: !document.getElementById('btn-send').disabled
    }
  })
}

// Konuşma açıldı ve yüklendi, yazma alanı kullanılabilir
function waitConversation (page, view, id) {
  return page.waitForFunction((a) => currentViewMode() === a.view && String(state.channelId) === String(a.id) && !state.loading &&
    !document.getElementById('composer-input').disabled, { view, id }, { timeout: h.LONG })
}

// Fotoğraf eklenir ve şifreli yüklemesi biter
async function attachPhoto (page, name) {
  await page.setInputFiles('#file-photo', { name, mimeType: 'image/png', buffer: PNG })
  await page.waitForFunction((n) => {
    const chips = Array.from(document.querySelectorAll('#attach-list .chip'))
    return chips.every((c) => c.classList.contains('chip-done')) && chips.some((c) => c.querySelector('.chip-name').textContent === n)
  }, name, { timeout: h.LONG })
}

async function openRoomRow (page, id) {
  await page.click('#inbox-list .room-row[data-station="text-' + id + '"]')
  await waitConversation(page, 'channel', id)
}

async function openRoom (page, id) {
  await page.evaluate((x) => selectChannel(x, { focus: true }), id)
  await waitConversation(page, 'channel', id)
}

async function openDm (page, id) {
  await page.evaluate((x) => showDm(x, { focus: true }), id)
  await waitConversation(page, 'dm', id)
}

// Açık konuşmanın taslağı ve ekleri temizlenir
async function clearComposer (page) {
  while (await page.locator('#attach-list .chip-remove').count()) {
    await page.locator('#attach-list .chip-remove').first().click()
  }
  await page.fill('#composer-input', '')
}

async function messagesIn (channelId) {
  const res = await W.w.call('GET', '/api/messages?channel=' + channelId + '&limit=50', null, W.w.P.deniz.token)
  assert.equal(res.status, 200)
  return res.data.messages
}

test('1440: özel mesajdaki metin ve fotoğraf genel odasına taşınmaz, geri dönünce yerinde durur', async () => {
  const page = W.deniz
  const genel = W.w.room('genel').id
  await page.click('#top-dm')
  await waitConversation(page, 'dm', W.dmEce)
  await page.fill('#composer-input', 'OZEL: yalnızca Ece görmeli 4417')
  await attachPhoto(page, 'ozel-foto.png')
  assert.deepEqual(await composerView(page), { text: 'OZEL: yalnızca Ece görmeli 4417', chips: ['ozel-foto.png'], send: true })

  await openRoomRow(page, genel)
  assert.deepEqual(await composerView(page), { text: '', chips: [], send: false })
  assert.equal(await page.evaluate(() => document.getElementById('photo-note').hidden), true, 'fotoğraf notu gizli')
  // Boş yazma alanında Enter mesaj göndermez, özel konuşmanın eki genel odasına gitmez
  await page.focus('#composer-input')
  await page.keyboard.press('Enter')
  await h.sleep(300)
  assert.equal((await messagesIn(genel)).length, 0, 'genel odasına mesaj gitmedi')

  await page.click('#top-dm')
  await waitConversation(page, 'dm', W.dmEce)
  assert.deepEqual(await composerView(page), { text: 'OZEL: yalnızca Ece görmeli 4417', chips: ['ozel-foto.png'], send: true })
  await page.click('#btn-send')
  await page.waitForFunction(() => document.getElementById('composer-input').value === '' && document.getElementById('attach-list').hidden, null, { timeout: h.LONG })
  const dmMessages = await messagesIn(W.dmEce)
  const sent = dmMessages[dmMessages.length - 1]
  assert.deepEqual([dmMessages.length, sent.authorId, sent.uploads.length], [2, W.w.P.deniz.id, 1], 'özel mesaj ekiyle gönderildi')
  assert.equal((await messagesIn(genel)).length, 0, 'genel odasına mesaj gitmedi')

  await openRoomRow(page, genel)
  assert.deepEqual(await composerView(page), { text: '', chips: [], send: false })
})

test('iki oda arasında taslak ve ek kendi odasında kalır', async () => {
  const page = W.deniz
  const genel = W.w.room('genel').id
  const oyun = W.w.room('oyun-gecesi').id
  await openRoomRow(page, genel)
  await page.fill('#composer-input', 'genel için taslak')
  await attachPhoto(page, 'genel.png')
  await openRoomRow(page, oyun)
  assert.deepEqual(await composerView(page), { text: '', chips: [], send: false })
  await page.fill('#composer-input', 'oyun gecesi için taslak')
  await openRoomRow(page, genel)
  assert.deepEqual(await composerView(page), { text: 'genel için taslak', chips: ['genel.png'], send: true })
  await openRoomRow(page, oyun)
  assert.deepEqual(await composerView(page), { text: 'oyun gecesi için taslak', chips: [], send: true })
  await clearComposer(page)
  await openRoomRow(page, genel)
  await clearComposer(page)
  assert.deepEqual(await composerView(page), { text: '', chips: [], send: false })
  assert.equal(await page.evaluate(() => state.attachments.length + composerDrafts.size), 0)
})

test('beş genişlikte özel mesaj ile oda arasında taslak sızmaz, yatay taşma yok', async () => {
  const page = W.deniz
  const genel = W.w.room('genel').id
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 760 ? 780 : 900 })
    await page.waitForFunction((x) => document.documentElement.clientWidth === x && el.appView.getAttribute('data-layout') === layoutClass(), width)
    await openDm(page, W.dmEce)
    const text = 'OZEL ' + width + ': yalnızca Ece görmeli'
    await page.fill('#composer-input', text)
    await attachPhoto(page, 'ozel-' + width + '.png')
    assert.ok(await h.overflowX(page) <= 0, width + ' genişlikte özel mesajda yatay taşma')

    await openRoom(page, genel)
    assert.deepEqual(await composerView(page), { text: '', chips: [], send: false }, width + ' genişlikte genel odası')
    assert.ok(await h.overflowX(page) <= 0, width + ' genişlikte genel odasında yatay taşma')

    await openDm(page, W.dmEce)
    assert.deepEqual(await composerView(page), { text, chips: ['ozel-' + width + '.png'], send: true }, width + ' genişlikte özel mesaja dönüş')
    await clearComposer(page)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForFunction(() => document.documentElement.clientWidth === 1440 && el.appView.getAttribute('data-layout') === layoutClass())
  assert.equal((await messagesIn(genel)).length, 0, 'genel odasına mesaj gitmedi')
})

test('Arkadaşlar görünümünde yazma alanı gizli ve boş, özel konuşmaya dönünce taslak ve ek yerinde', async () => {
  const page = W.deniz
  const text = 'OZEL: Arkadaşlar görünümüne taşınmamalı'
  const key = 'd:' + W.dmEce
  await page.click('#top-dm')
  await waitConversation(page, 'dm', W.dmEce)
  await page.fill('#composer-input', text)
  await attachPhoto(page, 'arkadaslar.png')
  await page.click('#top-friends')
  await page.waitForFunction(() => currentViewMode() === 'home' && !document.getElementById('home-view').hidden, null, { timeout: h.LONG })
  assert.equal(await page.evaluate(() => document.getElementById('composer').hidden), true, 'yazma alanı gizli')
  assert.deepEqual(await composerView(page), { text: '', chips: [], send: false })
  assert.deepEqual(await page.evaluate((k) => [composerKey(), composerDrafts.get(k).text, state.attachments.map((a) => a.convKey)], key),
    ['', text, [key]], 'taslak ve ek özel konuşmanın anahtarında')
  await page.click('#top-dm')
  await waitConversation(page, 'dm', W.dmEce)
  assert.deepEqual(await composerView(page), { text, chips: ['arkadaslar.png'], send: true })
  await clearComposer(page)
})

test('taslakta süresi dolan ek yeniden yüklenir, sunucunun tanımadığı ek gönderimde yeniden yüklenir', async () => {
  const page = W.deniz
  const genel = W.w.room('genel').id
  const fotograflar = W.w.room('fotograflar').id
  const ZERO = '0'.repeat(32)
  // Yükleme 46 dakika önce yapılmış gibi: sunucu mesaja bağlanmayan yüklemeyi bir saatte siler
  await openDm(page, W.dmEce)
  await page.fill('#composer-input', 'OZEL: bekleyen ek')
  await attachPhoto(page, 'bekleyen.png')
  const first = await page.evaluate(() => {
    const att = composerAttachments()[0]
    att.uploadedAt = Date.now() - 46 * 60 * 1000
    return att.uploadId
  })
  await openRoomRow(page, genel)
  await page.click('#top-dm')
  await waitConversation(page, 'dm', W.dmEce)
  const second = await (await page.waitForFunction((id) => {
    const a = composerAttachments()[0]
    return a && a.status === 'done' && a.uploadId !== id ? a.uploadId : null
  }, first, { timeout: h.LONG })).jsonValue()
  assert.match(second, /^[0-9a-f]{32}$/)
  assert.deepEqual(await composerView(page), { text: 'OZEL: bekleyen ek', chips: ['bekleyen.png'], send: true })
  const before = (await messagesIn(W.dmEce)).length
  await page.click('#btn-send')
  await page.waitForFunction(() => document.getElementById('composer-input').value === '' && document.getElementById('attach-list').hidden, null, { timeout: h.LONG })
  let list = await messagesIn(W.dmEce)
  assert.deepEqual([list.length, list[list.length - 1].uploads], [before + 1, [second]], 'özel mesaj yeniden yüklenen ekle gitti')

  // Sunucunun sildiği yükleme: kimlik sunucuda yok, gönderim 400 bad_uploads alır
  await openRoomRow(page, fotograflar)
  await page.fill('#composer-input', 'sunucu eki tanımıyor')
  await attachPhoto(page, 'silinen.png')
  await page.evaluate((z) => {
    composerAttachments()[0].uploadId = z
  }, ZERO)
  await page.click('#btn-send')
  const third = await (await page.waitForFunction((z) => {
    const a = composerAttachments()[0]
    return a && a.status === 'done' && a.uploadId !== z ? a.uploadId : null
  }, ZERO, { timeout: h.LONG })).jsonValue()
  assert.deepEqual(await composerView(page), { text: 'sunucu eki tanımıyor', chips: ['silinen.png'], send: true }, 'metin ve ek yerinde')
  assert.equal((await messagesIn(fotograflar)).length, 0, 'ilk gönderim reddedildi')
  await page.click('#btn-send')
  await page.waitForFunction(() => document.getElementById('composer-input').value === '' && document.getElementById('attach-list').hidden, null, { timeout: h.LONG })
  list = await messagesIn(fotograflar)
  assert.deepEqual([list.length, list[0].uploads], [1, [third]], 'mesaj yeniden yüklenen ekle gitti')
})

test('kişi engellenince o kişiyle özel konuşmanın taslağı ve eki silinir', async () => {
  const page = W.deniz
  const genel = W.w.room('genel').id
  W.dmMert = await dmWith('mert', 'Selam Deniz')
  await page.waitForFunction((id) => Boolean(dmEntry(id)), W.dmMert, { timeout: h.LONG })
  await openDm(page, W.dmMert)
  await page.fill('#composer-input', 'Mert için taslak')
  await attachPhoto(page, 'mert.png')
  await openRoom(page, genel)
  const key = 'd:' + W.dmMert
  assert.deepEqual(await page.evaluate((k) => [composerDrafts.has(k), state.attachments.filter((a) => a.convKey === k).length], key), [true, 1])
  // Engelleme başka bir cihazdan yapılır, sayfa kişiye özel metayı poll ile alır
  const res = await W.w.call('POST', '/api/blocks/add', { userId: W.w.P.mert.id }, W.w.P.deniz.token)
  assert.equal(res.status, 200, JSON.stringify(res.data))
  await page.waitForFunction((k) => !composerDrafts.has(k) && !state.attachments.some((a) => a.convKey === k), key, { timeout: h.LONG })
  assert.deepEqual(await composerView(page), { text: '', chips: [], send: false })
  const back = await W.w.call('POST', '/api/blocks/remove', { userId: W.w.P.mert.id }, W.w.P.deniz.token)
  assert.equal(back.status, 200, JSON.stringify(back.data))
  await page.waitForFunction((id) => !isBlocked(id), W.w.P.mert.id, { timeout: h.LONG })
  await openDm(page, W.dmMert)
  assert.deepEqual(await composerView(page), { text: '', chips: [], send: false })
})

test('konsol ve sunucu günlüğü temiz', async () => {
  // Sunucunun tanımadığı ekle yapılan gönderim denemesi (yukarıda) beklenen bir 400 yanıtı alır
  const badUploads = (e) => e.type === 'error' && /status of 400/.test(e.text) && /\/api\/messages$/.test(e.url)
  h.assertCleanConsole(W.w.logs, W.w.srv.errors, [badUploads])
})
