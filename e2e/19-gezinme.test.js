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
// G9, tarayıcı geçmişi (S2, public/js/38-gezinme.js):
// - 1440: iki oda ve özel mesaj geçişinden sonra geri tuşu sırasıyla döner, ileri tuşu çalışır, adres değişmez
// - Telefon 360: İstasyonlar sayfası, arama ve ayarlar geri tuşuyla kapanır, Esc ile kapanan sayfanın kaydı geri alınır
// - 768x700: sayfa açıkken geri tuşu sayfayı kapatır, sayfadan seçilen odanın kaydı sayfanın kaydının yerine yazılır
// - Kaydı olmayan katman (1440 durum menüsü, 360 emoji seçici) açıkken geri tuşu yalnızca onu kapatır (inceleme düzeltmesi)
// G9, okunmamış ayracı, şerit ve kapsül (S3, S4):
// - 40 okunmamışlı odada ayraç ilk okunmamışın önünde ve görünür alanda, şerit sayıyı gösterir, sayaç ancak en alta
//   inilince düşer, Okunmamışa Git ayracı geri getirir
// - Yukarıdayken gelen mesajda kaydırma olmaz, kapsül "Aşağıda 1 yeni mesaj" der, son okunan değişmez, kapsüle
//   basınca en alta inilir ve okundu sayılır (üstünde kısa bildirim dururken de)
// - Telefon 360: 120 okunmamışta konuşma son okunanın çevresiyle (around) yüklenir, Okundu İşaretle hepsini okur, En
//   Yeni Mesajlara Dön son okunanın çevresine geri dönmez
// G9, Özel mesajlar grubu ve görünümün hatırlanması (S5, S12):
// - 1440, 1024, 768 ve 360 genişlikte grup İstasyonlar listesinde, okunmamış konuşma önce. 1280 px altında Özel
//   düğmesi İstasyonlar sayfasını okunmamış konuşmada açar, geniş ekranda okunmamışı olan en yeni konuşmayı açar.
//   Özel mesaj görünümünde Oda bilgisi düğmesi yalnızca sayfada kart (Bildirimler) varken görünür. Hiç özel
//   konuşması olmayan kişide Özel düğmesi açılır pencere olarak duyurulmaz, Arkadaşlar görünümünü açar
// - Özel mesajdayken ve Arkadaşlar görünümündeyken sayfa yenilenince aynı görünüme dönülür
// G9 inceleme düzeltmeleri:
// - Uygulama açılırken açılan oda (80 okunmamış, son okunanın çevresi ve en yeni sayfa birleşik sayılır) ve sayfa
//   yenilenince geri gelen özel konuşma (40 okunmamış): şerit sayısı doğru, alta inmeden çıkınca rozet ve sayaç kalır
// - Açık katman yokken durum menüsünden Çıkış Yap ve oturumun düşmesi geçmişi kök kayda sarar, giriş ekranında tek
//   geri basış uygulamadan çıkar, yeniden girişte uygulamada kalınır
// G10, konum ve önbellek (S6):
// - Ortasına kaydırılan konuşmaya dönülünce liste önbellekten çizilir: iskelet ve yükleniyor durumu yok, ilk görünen
//   mesaj ve kayması korunur, tek istek (en yeni sayfa) liste çizildikten sonra gider. Uzaktayken gelen mesaj önbelleğe
//   eklenir ve kapsülde sayılır, olay alımı dururken gelen mesaj arka plandaki en yeni sayfayla eklenir (geri tuşuyla
//   dönüşte de), mesaj bir kez çizilir. 120 okunmamış testi önbellekte olmayan konuşmayı sınar.
// G10, eski mesajların kendiliğinden yüklenmesi (S7): en alttayken yüklenmez, en üste yaklaşınca (düğme 800 piksel
//   yakında) daha eski sayfa düğmeye basmadan gelir, önceki ilk mesaj görünür alanda ve odak yazma alanında kalır,
//   odanın başına gelince düğme kalkar. IntersectionObserver olmayan tarayıcıda kaydırma 400 pikselin altına inince
//   yükler. İstek başarısız olunca (sunucu 500) kaydırmayı sürdürmek yeni istek ve bildirim üretmez, düğme yeniden
//   dener ve başarılı olunca kendiliğinden yükleme sürer (inceleme düzeltmesi).
// G10, orta genişlik ve dar başlık (S8, S9): 768x1024, 900x800, 1024x768 ve 1200x900 boyutlarında İstasyonlar kartı
//   telsiz kartının üstünde ve Özel mesajlar grubuyla, İstasyonlar düğmesi gizli, çok alçak ekranda (1024x700) kart
//   gizli ve düğme görünür. Ses odasında uzayan telsiz kartı listeye iki satırlık yer bırakmayınca kart gizlenir ve düğme
//   görünür, yer açılınca kart en az iki satırla geri gelir (inceleme düzeltmesi). Özel mesaj başlığında 1024 ile 1280
//   px arasında ad en az 80 piksel, düğmeler çakışmaz ve başlıktan taşmaz, 1440 genişlikte düğme yazıları görünür.
// G10, kısayollar (S10): Alt+Aşağı ve Alt+Yukarı İstasyonlar listesinin sırasıyla (yazı odaları, özel konuşmalar)
//   konuşma değiştirir ve uçlarda başa döner, odak yazma alanında kalır. Alt+Shift+Aşağı önce anması olan odaya, sonra
//   okunmamış odaya gider, okunmamış kalmayınca konuşma değişmez. Bas konuş Alt tuşuna atanınca kısayol çalışmaz. Esc
//   açık katmanı (emoji seçici) kapatırken kaydırmaz, katman yokken okundu sayıp en alta iner. Ctrl+K panelinde Odalar
//   ve Kişiler bölümü oda adını (Türkçe harfler ve büyük harf duyarsız) ve özel konuşmanın görünen adını bulur, aşağı
//   ok ve Enter konuşmayı açar, eşleşme yoksa bölüm gizlidir. Rehber kartında üç kısayol satırı var.
// G10, küçük düzeltmeler (S11, S13, S14, S15): uygulama kapalıyken 60 mesaj gelen odanın rozeti açılışta "50+" ve
//   erişilebilir adı "en az 50 okunmamış", oda açılınca şerit 60 der ve alta inmeden çıkınca rozet ve ad 60 olur. Telefonda (dokunmatik, 360) kapalı telsiz kartı 44
//   piksellik Ses Odaları düğmesidir ve İstasyonlar sayfasını ses odalarında açar, üst çubuğun düğmeleri ve satırlar en
//   az 44 piksel yüksekliktedir (412 genişlikte genişlik de), sayfa tutamaçtan 40 piksel sürüklenince yerine döner,
//   120 piksel sürüklenince kapanır ve odak açan düğmeye döner, tutamaç tutulurken ikinci parmağın hareketi ve kalkışı
//   sayfayı kaydırmaz ve kapatmaz (inceleme düzeltmesi), ses odasına bağlıyken düğme gizlidir.
// - Konsol ve sunucu günlüğü temiz (bad_uploads denemesinin beklenen 400 yanıtı ve eski sayfa isteğine bilerek verilen
//   500 yanıtı dışında)

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
  // Selin'in hiç özel konuşması yoktur (Özel Mesajlar düğmesi testi)
  W.w = await h.setupWorld({ slot: 27, extraRooms: [['sohbet', 'text'], ['kalabalik', 'text'], ['arsiv', 'text'], ['eski', 'text']], extraPeople: { selin: 'Selin' } })
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

// G9 (S2): tarayıcı geçmişi. Konuşmalar arayüz düğmeleriyle açılır (kişinin eylemi), geri tuşu sırasıyla döner.

// Geçmişin o anki kaydı ve adres
function historyNow (page) {
  return page.evaluate(() => {
    const s = window.history.state && window.history.state.telsiz
    return { view: s ? (s.overlay ? 'overlay:' + s.overlay : s.view) : null, id: s && s.id !== undefined ? s.id : null, d: s ? s.d : null, href: window.location.href }
  })
}

async function setWidth (page, width, height) {
  await page.setViewportSize({ width, height: height || (width < 760 ? 780 : 900) })
  await page.waitForFunction((x) => document.documentElement.clientWidth === x && el.appView.getAttribute('data-layout') === layoutClass(), width)
}

// Geçmiş işlemleri bitti: kuyruk boş, beklenen popstate yok
function navIdle (page) {
  return page.waitForFunction(() => !navState.waiting && !navState.ops.length && !navState.scheduled)
}

// Kişinin geri tuşu
async function goBack (page) {
  await page.goBack({ waitUntil: 'commit' })
  await navIdle(page)
}

test('geri tuşu: oda, oda ve özel mesaj geçişlerinden sonra sırasıyla döner, adres değişmez', async () => {
  const page = W.deniz
  const genel = W.w.room('genel').id
  const oyun = W.w.room('oyun-gecesi').id
  await setWidth(page, 1440)
  const href = (await historyNow(page)).href
  assert.doesNotMatch(href, /#/, 'adreste # bölümü yok')
  await openRoomRow(page, genel)
  await openRoomRow(page, oyun)
  await page.click('#top-dm')
  await page.waitForFunction(() => currentViewMode() === 'dm' && !state.loading, null, { timeout: h.LONG })
  const dmId = await page.evaluate(() => String(state.channelId))
  await navIdle(page)
  const top = await historyNow(page)
  assert.deepEqual([top.view, String(top.id), top.href], ['dm', dmId, href])
  await goBack(page)
  await waitConversation(page, 'channel', oyun)
  assert.deepEqual(await historyNow(page), { view: 'channel', id: String(oyun), d: top.d - 1, href })
  await goBack(page)
  await waitConversation(page, 'channel', genel)
  assert.equal((await historyNow(page)).d, top.d - 2)
  // İleri tuşu da çalışır, yeni geçiş ileri kayıtları siler
  await page.goForward({ waitUntil: 'commit' })
  await waitConversation(page, 'channel', oyun)
  await navIdle(page)
  await openRoomRow(page, genel)
  await navIdle(page)
  assert.deepEqual(await historyNow(page), { view: 'channel', id: String(genel), d: top.d, href })
})

test('telefon 360: İstasyonlar sayfası, arama ve ayarlar geri tuşuyla kapanır, konuşma değişmez', async () => {
  const page = W.deniz
  const genel = W.w.room('genel').id
  await setWidth(page, 360)
  await openRoom(page, genel)
  await navIdle(page)
  const base = await historyNow(page)
  await page.click('#btn-rooms')
  await page.waitForSelector('#stations-sheet:not([hidden])')
  await navIdle(page)
  assert.equal((await historyNow(page)).view, 'overlay:sheet-stations')
  await goBack(page)
  await page.waitForSelector('#stations-sheet', { state: 'hidden' })
  assert.deepEqual(await historyNow(page), base)

  await page.click('#btn-search')
  await page.waitForSelector('#search-panel:not([hidden])')
  await navIdle(page)
  assert.equal((await historyNow(page)).view, 'overlay:search')
  await goBack(page)
  await page.waitForSelector('#search-panel', { state: 'hidden' })
  assert.deepEqual(await historyNow(page), base)

  await page.focus('#composer-input')
  await page.keyboard.press('Control+Comma')
  await page.waitForFunction(() => isSettingsOpen())
  await navIdle(page)
  assert.equal((await historyNow(page)).view, 'overlay:settings')
  await goBack(page)
  await page.waitForFunction(() => !isSettingsOpen())
  assert.deepEqual(await historyNow(page), base)
  await waitConversation(page, 'channel', genel)

  // Esc ile kapanan sayfanın kaydı geri alınır: geri tuşu sayfayı değil önceki konuşmayı gösterir
  await page.click('#btn-rooms')
  await page.waitForSelector('#stations-sheet:not([hidden])')
  await page.keyboard.press('Escape')
  await page.waitForSelector('#stations-sheet', { state: 'hidden' })
  await navIdle(page)
  assert.deepEqual(await historyNow(page), base)
  assert.ok(await h.overflowX(page) <= 0, '360 genişlikte yatay taşma')
})

test('768: İstasyonlar sayfası açıkken geri tuşu sayfayı kapatır, sayfadaki oda satırı sayfanın kaydını değiştirir', async () => {
  const page = W.deniz
  const genel = W.w.room('genel').id
  const foto = W.w.room('fotograflar').id
  // Alçak ekran: İstasyonlar kartı gizli, odalar İstasyonlar düğmesiyle sayfada açılır (G10 S8, daha yüksek ekranda
  // kart telsiz kartının üstündedir)
  await setWidth(page, 768, 700)
  await openRoom(page, genel)
  await navIdle(page)
  const base = await historyNow(page)
  await page.click('#btn-rooms')
  await page.waitForSelector('#stations-sheet:not([hidden])')
  await navIdle(page)
  await goBack(page)
  await page.waitForSelector('#stations-sheet', { state: 'hidden' })
  assert.deepEqual(await historyNow(page), base)
  await waitConversation(page, 'channel', genel)
  // Sayfadan oda seçmek: sayfa kapanır, odanın kaydı sayfanın kaydının yerine yazılır
  await page.click('#btn-rooms')
  await page.waitForSelector('#stations-sheet:not([hidden])')
  await navIdle(page)
  await page.click('#stations-list .room-row[data-station="text-' + foto + '"]')
  await waitConversation(page, 'channel', foto)
  await navIdle(page)
  assert.deepEqual(await historyNow(page), { view: 'channel', id: String(foto), d: base.d + 1, href: base.href })
  await goBack(page)
  await waitConversation(page, 'channel', genel)
  await setWidth(page, 1440)
})

test('geri tuşu: kaydı olmayan katman açıkken (durum menüsü, telefonda emoji seçici) yalnızca katman kapanır, konuşma değişmez', async () => {
  const page = W.deniz
  const genel = W.w.room('genel').id
  const oyun = W.w.room('oyun-gecesi').id
  await setWidth(page, 1440)
  await openRoomRow(page, genel)
  await openRoomRow(page, oyun)
  await navIdle(page)
  const base = await historyNow(page)
  await page.click('#me-button')
  await page.waitForFunction(() => Boolean(findLayer('status-menu')))
  await goBack(page)
  await page.waitForFunction(() => !findLayer('status-menu'))
  await waitConversation(page, 'channel', oyun)
  assert.deepEqual(await historyNow(page), base, 'geçmiş eski yerinde')
  await setWidth(page, 360)
  await page.click('#btn-emoji')
  await page.waitForSelector('#emoji-picker:not([hidden])')
  await goBack(page)
  await page.waitForSelector('#emoji-picker', { state: 'hidden' })
  await waitConversation(page, 'channel', oyun)
  assert.deepEqual(await historyNow(page), base)
  // Katman kalmayınca geri tuşu önceki konuşmaya döner
  await goBack(page)
  await waitConversation(page, 'channel', genel)
  await setWidth(page, 1440)
})

// G9 (S3, S4): okunmamış ayracı, şerit, okundu kuralı ve yeni mesaj kapsülü

function unreadView (page, roomId) {
  return page.evaluate((id) => {
    const box = document.getElementById('messages').getBoundingClientRect()
    const divider = document.querySelector('#message-list .unread-divider')
    const r = divider ? divider.getBoundingClientRect() : null
    const next = divider ? divider.nextElementSibling : null
    const bar = document.getElementById('unread-bar')
    return {
      divider: Boolean(divider),
      dividerText: divider ? divider.textContent : '',
      inView: Boolean(r && r.top >= box.top && r.bottom <= box.bottom),
      upperHalf: Boolean(r && r.top - box.top <= box.height / 2),
      firstUnread: next ? next.getAttribute('data-id') : null,
      firstGroup: Boolean(next && next.classList.contains('msg-first')),
      bar: Boolean(bar && !bar.hidden),
      barText: bar && !bar.hidden ? bar.querySelector('.unread-bar-count').textContent : '',
      unread: Number(state.unread[id]) || 0,
      lastRead: Number(state.lastRead[id]) || 0,
      atBottom: isNearBottom()
    }
  }, roomId)
}

// Ece odaya n mesaj yazar, sayfa olayları alır (Deniz başka odadayken sayaç artar)
async function eceSays (roomName, n, label) {
  const room = W.w.room(roomName)
  const out = []
  let i = 0
  while (i < n) {
    out.push(await W.w.say('ece', room, label + ' ' + (i + 1)))
    i += 1
  }
  return out
}

test('ayraç: ilk okunmamış mesaj görünür alanda, şerit sayıyı gösterir, sayaç ancak alta inilince düşer', async () => {
  const page = W.deniz
  const sohbet = W.w.room('sohbet').id
  const genel = W.w.room('genel').id
  await setWidth(page, 1440)
  const first = (await eceSays('sohbet', 1, 'ilk'))[0]
  await openRoomRow(page, sohbet)
  await page.waitForFunction((a) => Number(state.lastRead[a.id]) === a.last, { id: sohbet, last: first.id })
  await openRoomRow(page, genel)
  const sent = await eceSays('sohbet', 40, 'okunmamış')
  await page.waitForFunction((id) => state.unread[id] === 40, sohbet, { timeout: h.LONG })
  await openRoomRow(page, sohbet)
  await page.waitForSelector('#message-list .unread-divider')
  let v = await unreadView(page, sohbet)
  assert.deepEqual([v.divider, v.dividerText, v.inView, v.upperHalf, v.firstUnread, v.firstGroup], [true, 'Yeni mesajlar', true, true, String(sent[0].id), true])
  assert.deepEqual([v.bar, v.barText, v.atBottom], [true, '40 yeni mesaj', false])
  assert.deepEqual([v.unread, v.lastRead], [40, first.id], 'odaya girmek okundu saymaz')
  // Okunmamışa Git ayracı yeniden görünür alana getirir
  await page.evaluate(() => {
    el.messages.scrollTop = 0
  })
  await page.click('#unread-bar-jump')
  v = await unreadView(page, sohbet)
  assert.deepEqual([v.inView, v.unread], [true, 40])
  // En alta inilince okundu sayılır: sayaç düşer, şerit kalkar, ayraç kalır
  await page.evaluate(() => {
    el.messages.scrollTop = el.messages.scrollHeight
  })
  await page.waitForFunction((id) => !state.unread[id], sohbet)
  v = await unreadView(page, sohbet)
  assert.deepEqual([v.unread, v.lastRead, v.bar, v.divider], [0, sent[39].id, false, true])
})

test('yukarıdayken gelen mesaj: kaydırılmaz, kapsül "1 yeni mesaj" der ve okundu sayılmaz', async () => {
  const page = W.deniz
  const sohbet = W.w.room('sohbet').id
  await waitConversation(page, 'channel', sohbet)
  const before = await unreadView(page, sohbet)
  await page.evaluate(() => {
    el.messages.scrollTop = 0
  })
  await page.waitForFunction(() => !isNearBottom())
  const msg = (await eceSays('sohbet', 1, 'yukarıdayken'))[0]
  await page.waitForFunction((id) => state.nodes.has(String(id)), msg.id, { timeout: h.LONG })
  await page.waitForSelector('#new-below:not([hidden])')
  const capsule = await page.evaluate(() => ({
    text: document.querySelector('#new-below-button .button-text').textContent,
    top: el.messages.scrollTop,
    reach: document.getElementById('new-below-button').getBoundingClientRect().bottom <= document.getElementById('messages').getBoundingClientRect().bottom
  }))
  assert.deepEqual(capsule, { text: 'Aşağıda 1 yeni mesaj', top: 0, reach: true })
  let v = await unreadView(page, sohbet)
  assert.deepEqual([v.lastRead, v.unread], [before.lastRead, 1], 'yukarıdayken okundu sayılmadı')
  // Aynı yerde duran kısa bildirim kapsüle basmayı engellemez
  await page.evaluate(() => toast('Kapsülün üstünde kısa bildirim'))
  await page.click('#new-below-button')
  await page.waitForFunction((id) => !state.unread[id], sohbet)
  v = await unreadView(page, sohbet)
  assert.deepEqual([v.lastRead, v.atBottom], [msg.id, true])
  assert.equal(await page.evaluate(() => document.getElementById('new-below').hidden), true, 'kapsül kalktı')
})

test('telefon 360: 120 okunmamışta konuşma son okunanın çevresiyle yüklenir, Okundu İşaretle hepsini okur, En Yeni Mesajlara Dön en yeni sayfayı açar', async () => {
  const page = W.deniz
  const kalabalik = W.w.room('kalabalik').id
  const genel = W.w.room('genel').id
  await setWidth(page, 360)
  const first = (await eceSays('kalabalik', 1, 'ilk'))[0]
  await openRoom(page, kalabalik)
  await page.waitForFunction((a) => Number(state.lastRead[a.id]) === a.last, { id: kalabalik, last: first.id })
  await openRoom(page, genel)
  const sent = await eceSays('kalabalik', 120, 'kalabalık')
  await page.waitForFunction((id) => state.unread[id] === 120, kalabalik, { timeout: h.LONG })
  // Bu test önbellekte olmayan konuşmanın yüklenmesini sınar: önbellekteki konuşma sunucuya sormadan çizilir (G10 S6,
  // aşağıdaki dönüş testi)
  await page.evaluate(() => navCacheClear())
  const requests = []
  const onRequest = (req) => {
    if (req.url().indexOf('/api/messages?channel=' + kalabalik) !== -1) requests.push(req.url().replace(/^.*\?/, ''))
  }
  page.on('request', onRequest)
  await openRoom(page, kalabalik)
  page.off('request', onRequest)
  await page.waitForSelector('#message-list .unread-divider')
  assert.deepEqual(requests, ['channel=' + kalabalik + '&limit=50', 'channel=' + kalabalik + '&around=' + first.id + '&limit=100'])
  const v = await unreadView(page, kalabalik)
  assert.deepEqual([v.firstUnread, v.inView, v.bar, v.barText, v.unread], [String(sent[0].id), true, true, '120 yeni mesaj', 120])
  assert.equal(await page.evaluate(() => state.hasNewer), true, 'daha yeni mesajlar aşağı inildikçe yüklenir')
  assert.ok(await h.overflowX(page) <= 0, '360 genişlikte şerit açıkken yatay taşma')
  await page.click('#unread-bar-read')
  await page.waitForFunction((id) => !state.unread[id] && document.getElementById('unread-bar').hidden, kalabalik)
  assert.equal(await page.evaluate((id) => Number(state.lastRead[id]), kalabalik), sent[119].id, 'en yeni mesaj okundu')

  // En Yeni Mesajlara Dön son okunanın çevresine geri dönmez: en yeni sayfa açılır, en altta olunduğu için okundu sayılır
  await openRoom(page, genel)
  const more = await eceSays('kalabalik', 60, 'yeni tur')
  await page.waitForFunction((id) => state.unread[id] === 60, kalabalik, { timeout: h.LONG })
  await page.evaluate(() => navCacheClear())
  await openRoom(page, kalabalik)
  await page.waitForSelector('#message-list .unread-divider')
  assert.equal(await page.evaluate(() => state.hasNewer), true, 'son okunanın çevresi yüklendi')
  requests.length = 0
  page.on('request', onRequest)
  await page.click('#search-jump-latest')
  await page.waitForFunction((a) => !state.loading && !state.hasNewer && String(state.messages[state.messages.length - 1].id) === String(a.last) && !state.unread[a.id],
    { id: kalabalik, last: more[59].id }, { timeout: h.LONG })
  page.off('request', onRequest)
  assert.deepEqual(requests, ['channel=' + kalabalik + '&limit=50'])
  assert.deepEqual(await page.evaluate((id) => [Boolean(document.querySelector('#message-list .unread-divider')), document.getElementById('unread-bar').hidden, Number(state.lastRead[id])], kalabalik),
    [false, true, more[59].id])
  await setWidth(page, 1440)
})

// G9 (S5, S12): Özel mesajlar grubu, Özel düğmesi ve görünümün hatırlanması

// Kişi Deniz'e özel mesaj gönderir
async function dmSay (who, dmId, text) {
  const w = W.w
  const p = w.P[who]
  const body = w.E.dm.seal({ v: 1, a: p.id, c: dmId, t: text, f: [] }, w.P.deniz.publicKey, p.secretKey)
  const res = await w.call('POST', '/api/messages', { channelId: dmId, body, uploads: [] }, p.token)
  assert.equal(res.status, 200, JSON.stringify(res.data))
  return res.data.message
}

// Listedeki Özel mesajlar grubu: başlık ve satırlar (konuşma kimliği, rozet)
function dmGroupIn (page, listId) {
  return page.evaluate((id) => {
    const list = document.getElementById(id)
    const title = list.querySelector('#' + (id === 'inbox-list' ? 'rooms-title-dm' : 'sheet-rooms-title-dm'))
    const rows = Array.from(list.querySelectorAll('.room-row-dm')).map((b) => {
      const mark = b.querySelector('.station-mark')
      return [b.getAttribute('data-dm-id'), mark ? mark.textContent : '']
    })
    return { title: title ? title.textContent : null, shown: Boolean(title && title.getClientRects().length), rows }
  }, listId)
}

test('özel mesajlar grubu: İstasyonlar listesinde okunmamış önce, 1280 px altında Özel düğmesi sayfayı grupta açar', async () => {
  const page = W.deniz
  const genel = W.w.room('genel').id
  await setWidth(page, 1440)
  // Son açılan özel konuşma Ece, okunmamış olan Mert
  await openDm(page, W.dmEce)
  await openRoom(page, genel)
  await dmSay('mert', W.dmMert, 'Deniz, akşam görüşelim mi?')
  await page.waitForFunction((id) => state.unread[id] === 1, W.dmMert, { timeout: h.LONG })
  await page.waitForFunction(() => document.querySelectorAll('#inbox-list .room-row-dm').length === 2)
  assert.deepEqual(await dmGroupIn(page, 'inbox-list'), { title: 'Özel mesajlar', shown: true, rows: [[String(W.dmMert), '1'], [String(W.dmEce), '']] })
  assert.equal(await page.getAttribute('#top-dm', 'aria-haspopup'), null, 'geniş ekranda Özel düğmesi konuşma açar')

  for (const width of [1024, 768, 360]) {
    await setWidth(page, width, width < 760 ? 780 : 768)
    assert.equal(await page.getAttribute('#top-dm', 'aria-haspopup'), 'dialog', width + ' genişlikte Özel düğmesi sayfa açar')
    await page.click('#top-dm')
    await page.waitForSelector('#stations-sheet:not([hidden])')
    await page.waitForFunction((id) => document.activeElement && document.activeElement.getAttribute('data-dm-id') === String(id), W.dmMert)
    const g = await dmGroupIn(page, 'stations-list')
    assert.deepEqual(g, { title: 'Özel mesajlar', shown: true, rows: [[String(W.dmMert), '1'], [String(W.dmEce), '']] }, width + ' genişlikte grup')
    assert.equal(await page.getAttribute('#top-dm', 'aria-expanded'), 'true')
    assert.ok(await h.overflowX(page) <= 0, width + ' genişlikte sayfa açıkken yatay taşma')
    assert.equal(await page.evaluate(() => currentViewMode()), 'channel', 'Özel düğmesi konuşma açmadı')
    await page.keyboard.press('Escape')
    await page.waitForSelector('#stations-sheet', { state: 'hidden' })
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'top-dm')
  }
  // Telefonda satıra basmak konuşmayı açar, sayfa kapanır, Oda bilgisi düğmesi özel mesajda yoktur. Odak sayfa
  // açıldıktan sonra satıra geçer, Enter odak satırdayken basılır.
  await page.click('#top-dm')
  await page.waitForSelector('#stations-sheet:not([hidden])')
  await page.waitForFunction((id) => document.activeElement && document.activeElement.getAttribute('data-dm-id') === String(id), W.dmMert)
  await page.keyboard.press('Enter')
  await waitConversation(page, 'dm', W.dmMert)
  await page.waitForSelector('#stations-sheet', { state: 'hidden' })
  assert.equal(await page.evaluate(() => document.getElementById('btn-room-info').getClientRects().length), 0, 'özel mesajda Oda bilgisi düğmesi yok')
  // Sayfada gösterilecek kart varsa (Bildirimler: Ece ses odasına katıldı) Oda bilgisi düğmesi görünür ve sayfa kartı açar
  const lobi = W.w.room('Lobi').id
  let res = await W.w.call('POST', '/api/voice/join', { channelId: lobi }, W.w.P.ece.token)
  assert.equal(res.status, 200, JSON.stringify(res.data))
  await page.waitForSelector('#activity:not([hidden])', { state: 'attached', timeout: h.LONG })
  await page.waitForFunction(() => document.getElementById('btn-room-info').getClientRects().length > 0)
  await page.click('#btn-room-info')
  await page.waitForFunction(() => Boolean(findLayer('sheet-info')))
  assert.equal(await page.evaluate(() => document.getElementById('activity').getClientRects().length > 0), true, 'sayfada Bildirimler kartı')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => !findLayer('sheet-info'))
  res = await W.w.call('POST', '/api/voice/leave', { channelId: lobi }, W.w.P.ece.token)
  assert.equal(res.status, 200, JSON.stringify(res.data))
  await page.evaluate(() => {
    el.messages.scrollTop = el.messages.scrollHeight
  })
  await page.waitForFunction((id) => !state.unread[id], W.dmMert)

  // Geniş ekranda Özel düğmesi okunmamışı olan en yeni konuşmayı açar (son açılan Ece olsa da)
  await setWidth(page, 1440)
  await openDm(page, W.dmEce)
  await openRoom(page, genel)
  await dmSay('mert', W.dmMert, 'Cevap bekliyorum')
  await page.waitForFunction((id) => state.unread[id] === 1, W.dmMert, { timeout: h.LONG })
  await page.click('#top-dm')
  await waitConversation(page, 'dm', W.dmMert)
  assert.equal(await page.evaluate(() => document.getElementById('stations-sheet').hidden), true)
})

test('Özel Mesajlar düğmesi: hiç özel konuşma yokken açılır pencere olarak duyurulmaz, basınca Arkadaşlar açılır', async () => {
  const page = await W.w.pageFor('selin', { viewport: { width: 360, height: 780 } })
  await page.waitForFunction(() => currentViewMode() === 'channel' && !state.loading, null, { timeout: h.LONG })
  assert.equal(await page.evaluate(() => bandDmEntries().length), 0)
  assert.deepEqual([await page.getAttribute('#top-dm', 'aria-haspopup'), await page.getAttribute('#top-dm', 'aria-expanded')], [null, null])
  await page.click('#top-dm')
  await page.waitForFunction(() => currentViewMode() === 'home' && !document.getElementById('home-view').hidden)
  assert.equal(await page.evaluate(() => document.getElementById('stations-sheet').hidden), true, 'sayfa açılmadı')
  assert.deepEqual([await page.getAttribute('#top-dm', 'aria-haspopup'), await page.getAttribute('#top-dm', 'aria-expanded')], [null, null])
})

test('görünüm: özel mesajdayken ve Arkadaşlar görünümündeyken sayfa yenilenince aynı görünüme dönülür', async () => {
  const page = W.deniz
  const genel = W.w.room('genel').id
  await setWidth(page, 1440)
  await openDm(page, W.dmMert)
  const reload = async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
    await page.waitForSelector('#band-track .station[data-station]', { timeout: h.LONG })
  }
  await reload()
  await waitConversation(page, 'dm', W.dmMert)
  await navIdle(page)
  assert.deepEqual(await page.evaluate(() => [window.history.state.telsiz.view, window.history.state.telsiz.d, document.getElementById('dm-header').hidden]), ['dm', 0, false])

  await page.click('#top-friends')
  await page.waitForFunction(() => currentViewMode() === 'home' && !document.getElementById('home-view').hidden)
  await reload()
  await page.waitForFunction(() => currentViewMode() === 'home' && !document.getElementById('home-view').hidden && document.getElementById('composer').hidden, null, { timeout: h.LONG })
  assert.equal(await page.getAttribute('#top-friends', 'aria-current'), 'page')

  await openRoomRow(page, genel)
  await reload()
  await waitConversation(page, 'channel', genel)
})

// G9 inceleme düzeltmeleri: uygulama açılırken açılan konuşmanın okunmamışları sayılır (scanUnread ve scanDmUnread
// açık konuşmayı atlar)

test('açılış: uygulama açılırken açılan oda ve özel konuşmanın okunmamışları sayılır, alta inmeden çıkınca rozet kalır', async () => {
  const page = W.deniz
  const kalabalik = W.w.room('kalabalik').id
  const genel = W.w.room('genel').id
  await setWidth(page, 1440)
  // Uygulama kapalıyken gelen mesajlar: olay alımı durur, mesajlar gelir, sayfa yeniden yüklenir (son görünüm
  // hatırlanır)
  const away = () => page.evaluate(() => stopPoll())
  const reopen = async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
    await page.waitForSelector('#band-track .station[data-station]', { timeout: h.LONG })
  }
  const readToEnd = async (id) => {
    await page.evaluate(() => {
      el.messages.scrollTop = el.messages.scrollHeight
    })
    const last = await page.evaluate(() => Number(state.messages[state.messages.length - 1].id))
    await page.waitForFunction((a) => Number(state.lastRead[a.id]) === a.last, { id, last })
    return last
  }

  // Son açılan oda kalabalık, sonuna kadar okundu. Uygulama kapalıyken 80 mesaj gelir: en yeni sayfa (50) ilk okunmamışı
  // içermez, konuşma son okunanın çevresiyle açılır, sayı iki sayfanın birleşiminden çıkar
  await openRoom(page, kalabalik)
  const roomRead = await readToEnd(kalabalik)
  await away()
  const sent = await eceSays('kalabalik', 80, 'kapalıyken')
  await reopen()
  await waitConversation(page, 'channel', kalabalik)
  await page.waitForSelector('#message-list .unread-divider')
  let v = await unreadView(page, kalabalik)
  assert.deepEqual([v.firstUnread, v.bar, v.barText, v.unread, v.lastRead, v.atBottom], [String(sent[0].id), true, '80 yeni mesaj', 80, roomRead, false])
  assert.equal(await page.evaluate(() => state.hasNewer), true, 'son okunanın çevresi yüklendi')
  // Alta inmeden başka odaya geçilince odanın rozeti ve sayacı kalır, son okunan değişmez
  await openRoomRow(page, genel)
  const row = await page.evaluate((id) => {
    const b = document.querySelector('#inbox-list .room-row[data-station="text-' + id + '"]')
    const mark = b.querySelector('.station-mark')
    return { mark: mark ? mark.textContent : '', label: b.getAttribute('aria-label') }
  }, kalabalik)
  assert.equal(row.mark, '80')
  assert.match(row.label, /80/)
  v = await unreadView(page, kalabalik)
  assert.deepEqual([v.unread, v.lastRead], [80, roomRead])

  // Sayfa yenilenince geri gelen özel konuşma: 40 okunmamış, alta inmeden Arkadaşlar görünümüne geçilince Özel
  // mesajlar grubunda ve Özel Mesajlar düğmesinde rozet kalır
  await openDm(page, W.dmMert)
  const dmRead = await readToEnd(W.dmMert)
  await away()
  let i = 0
  while (i < 40) {
    await dmSay('mert', W.dmMert, 'Kapalıyken yazdım ' + (i + 1))
    i += 1
  }
  await reopen()
  await waitConversation(page, 'dm', W.dmMert)
  await page.waitForSelector('#message-list .unread-divider')
  v = await unreadView(page, W.dmMert)
  assert.deepEqual([v.bar, v.barText, v.unread, v.lastRead, v.atBottom], [true, '40 yeni mesaj', 40, dmRead, false])
  await openRoomRow(page, genel)
  const g = await dmGroupIn(page, 'inbox-list')
  assert.deepEqual(g.rows.filter((r) => r[0] === String(W.dmMert)), [[String(W.dmMert), '40']])
  assert.equal(await page.evaluate(() => document.getElementById('top-dm-mark').textContent), '40')
  v = await unreadView(page, W.dmMert)
  assert.deepEqual([v.unread, v.lastRead], [40, dmRead])
})

// G9 inceleme düzeltmeleri: oturum kapanınca geçmiş, açık katman olmasa da kök kayda geri sarılır

// Giriş ekranından arayüzle giriş, uygulama ve bant beklenir
async function uiLogin (page, name, password) {
  await page.fill('#login-name', name)
  await page.fill('#login-password', password)
  await page.click('#login-submit')
  await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  await page.waitForSelector('#band-track .station[data-station]', { timeout: h.LONG })
}

test('çıkış: açık katman yokken Çıkış Yap ve oturum düşmesi geçmişi köke sarar, giriş ekranında geri tuşu uygulamadan çıkar', async () => {
  // Sekmede uygulamadan önce başka bir belge vardır (sorgulu adres), uygulamadan çıkmak o belgeye dönmektir
  const page = await W.w.tb.newPage('mert', { person: W.w.P.mert, extra: { 'telsiz.skin': 'arcade', 'telsiz.scheme': 'dark' } })
  const before = W.w.base + '/?onceki=1'
  await page.goto(before, { timeout: h.LONG })
  await page.goto(W.w.base + '/#anahtar=' + encodeURIComponent(W.w.keyCode), { timeout: h.LONG })
  await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  await page.waitForSelector('#band-track .station[data-station]', { timeout: h.LONG })
  const rooms = ['oyun-gecesi', 'fotograflar', 'genel'].map((name) => W.w.room(name).id)
  const walk = async () => {
    await navIdle(page)
    const start = await historyNow(page)
    for (const id of rooms) await openRoomRow(page, id)
    await navIdle(page)
    assert.equal((await historyNow(page)).d, start.d + 3)
    return start
  }
  const loggedOut = async () => {
    await page.waitForSelector('#login-card:not([hidden])', { timeout: h.LONG })
    await navIdle(page)
    return page.evaluate(() => ({ on: navState.on, d: window.history.state && window.history.state.telsiz ? window.history.state.telsiz.d : null }))
  }
  // Durum menüsünden Çıkış Yap: menü kapanırken kişi henüz uygulamadadır, çıkışta açık katman yoktur
  await walk()
  await page.click('#me-button')
  await page.click('#menu-logout')
  assert.deepEqual(await loggedOut(), { on: false, d: 0 }, 'çıkışta kök kayda sarıldı')
  // Giriş ekranında tek geri basış uygulamadan çıkar
  await page.goBack({ waitUntil: 'commit' })
  await page.waitForURL(before)
  await page.goForward({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#login-card:not([hidden])', { timeout: h.LONG })
  await uiLogin(page, 'mert', 'parola-mert-1')
  await navIdle(page)
  assert.equal((await historyNow(page)).d, 0)

  // Oturum düşmesi (ör. başka cihazdan kapatıldı): yeniden girişte uygulamada kalınır, geçmiş kökten başlar
  await walk()
  await page.evaluate(() => handleSessionLost('sessionEnded'))
  assert.deepEqual(await loggedOut(), { on: false, d: 0 }, 'oturum düşünce kök kayda sarıldı')
  await uiLogin(page, 'mert', 'parola-mert-1')
  await navIdle(page)
  const now = await historyNow(page)
  assert.equal(now.d, 0)
  assert.ok(now.href.indexOf(W.w.base + '/') === 0 && now.href !== before, 'uygulamadan çıkılmadı')
  await page.goBack({ waitUntil: 'commit' })
  await page.waitForURL(before)
})

// G10 (S6): konum ve önbellek. Konuşmaya dönülünce liste önbellekten, iskeletsiz ve sunucuya sormadan çizilir.

// Görünür alandaki ilk mesaj ve görünür alanın üstüne uzaklığı
function firstVisible (page) {
  return page.evaluate(() => {
    const top = el.messages.getBoundingClientRect().top
    const node = Array.from(document.querySelectorAll('#message-list .msg[data-id]')).filter((n) => n.getBoundingClientRect().bottom > top + 1)[0]
    return node ? { id: node.getAttribute('data-id'), offset: Math.round(node.getBoundingClientRect().top - top) } : null
  })
}

// Aynı mesaj görünür alanın üstünde aynı yerde (alt piksel yuvarlaması için 1 piksel pay)
function assertSameSpot (actual, expected, message) {
  assert.ok(actual && expected && actual.id === expected.id && Math.abs(actual.offset - expected.offset) <= 1, (message || 'konum') + ': ' + JSON.stringify([actual, expected]))
}

// Sayfadaki /api/messages istekleri: isteğin açıldığı anda listede çizili mesaj sayısı, yükleniyor durumu ve iskelet
async function watchMessageRequests (page) {
  await page.evaluate(() => {
    window.testRequests = []
    if (window.testOpenHooked) return
    window.testOpenHooked = true
    const open = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function (method, url) {
      if (String(url).indexOf('/api/messages?') !== -1) {
        window.testRequests.push({ query: String(url).replace(/^.*\?/, ''), nodes: state.nodes.size, loading: state.loading, skeleton: el.messages.classList.contains('is-loading') })
      }
      return open.apply(this, arguments)
    }
  })
}

// Konum değişmeyene kadar beklenir (kaydırma olayları ve kendiliğinden yükleme biter)
async function settledFirstVisible (page) {
  let prev = null
  let i = 0
  while (i < 20) {
    await h.sleep(150)
    const now = await firstVisible(page)
    if (prev && now && prev.id === now.id && prev.offset === now.offset) return now
    prev = now
    i += 1
  }
  return prev
}

test('dönüş: konuşma önbellekten çizilir, ilk görünen mesaj korunur, istek çizimden sonra gider, kaçırılan mesaj eklenir', async () => {
  const page = W.deniz
  const arsiv = W.w.room('arsiv')
  const genel = W.w.room('genel').id
  await setWidth(page, 1440)
  let i = 0
  while (i < 130) {
    await W.w.say('selin', arsiv, 'arşiv ' + (i + 1))
    i += 1
  }
  await openRoomRow(page, arsiv.id)
  // Odanın bütün mesajları yüklenir, kişi ortaya kaydırır: ne en üstte ne en altta
  while (await page.evaluate(() => state.hasMore)) {
    await page.evaluate(() => loadOlder())
    await page.waitForFunction(() => !state.loadingOlder)
  }
  assert.equal(await page.evaluate(() => state.messages.length), 130)
  await page.evaluate(() => {
    el.messages.scrollTop = Math.round((el.messages.scrollHeight - el.messages.clientHeight) / 2)
  })
  await page.waitForFunction(() => !isNearBottom())
  const before = await settledFirstVisible(page)
  const loaded = await page.evaluate(() => state.messages.length)
  await openRoomRow(page, genel)
  // Uzaktayken gelen mesaj olay alımıyla önbelleğe de eklenir
  const late = await W.w.say('ece', arsiv, 'uzaktayken yazdım')
  await page.waitForFunction((a) => {
    const entry = navCache.map.get(String(a.id))
    return Boolean(entry && entry.messages.some((m) => String(m.id) === String(a.m)))
  }, { id: arsiv.id, m: late.id }, { timeout: h.LONG })
  await watchMessageRequests(page)
  await page.click('#inbox-list .room-row[data-station="text-' + arsiv.id + '"]')
  // Tıklamanın hemen ardından: liste çizili, yükleniyor ve iskelet yok
  const now = await page.evaluate(() => ({ view: currentViewMode(), id: String(state.channelId), nodes: state.nodes.size, loading: state.loading, skeleton: el.messages.classList.contains('is-loading') }))
  assert.deepEqual(now, { view: 'channel', id: String(arsiv.id), nodes: loaded + 1, loading: false, skeleton: false })
  assertSameSpot(await firstVisible(page), before, 'ilk görünen mesaj ve kayması korundu')
  // Tek istek: en yeni sayfa, liste çizildikten sonra
  const ofRoom = async () => (await page.evaluate(() => window.testRequests)).filter((r) => r.query.indexOf('channel=' + arsiv.id + '&') === 0)
  await page.waitForFunction(() => window.testRequests.length > 0)
  await h.sleep(300)
  assert.deepEqual(await ofRoom(), [{ query: 'channel=' + arsiv.id + '&limit=50', nodes: loaded + 1, loading: false, skeleton: false }])
  await page.waitForSelector('#new-below:not([hidden])')
  assert.equal(await page.evaluate(() => document.querySelector('#new-below-button .button-text').textContent), 'Aşağıda 1 yeni mesaj')
  assertSameSpot(await firstVisible(page), before, 'arka plandaki yenileme konumu değiştirmedi')

  // Olay alımı dururken gelen mesaj önbellekte yoktur, geri tuşuyla dönülünce arka plandaki en yeni sayfayla eklenir
  await openRoomRow(page, genel)
  await page.evaluate(() => stopPoll())
  const missed = await W.w.say('ece', arsiv, 'olay kaçtı')
  await watchMessageRequests(page)
  await goBack(page)
  await waitConversation(page, 'channel', arsiv.id)
  await page.waitForFunction((id) => state.nodes.has(String(id)), missed.id, { timeout: h.LONG })
  const back = await ofRoom()
  assert.equal(back.length, 1)
  assert.deepEqual([back[0].query, back[0].nodes > 0, back[0].loading, back[0].skeleton], ['channel=' + arsiv.id + '&limit=50', true, false, false])
  assertSameSpot(await firstVisible(page), before, 'geri tuşuyla dönüş')
  await page.waitForFunction(() => document.querySelector('#new-below-button .button-text').textContent === 'Aşağıda 2 yeni mesaj')
  await page.evaluate(() => startPoll())
  await page.click('#new-below-button')
  await page.waitForFunction((a) => !state.unread[a.id] && Number(state.lastRead[a.id]) === a.last, { id: arsiv.id, last: missed.id })
  assert.equal(await page.evaluate((id) => document.querySelectorAll('#message-list .msg[data-id="' + id + '"]').length, missed.id), 1, 'mesaj bir kez çizildi')
})

// G10 (S7): eski mesajların kendiliğinden yüklenmesi

test('eski mesajlar: en üste yaklaşınca düğmeye basmadan yüklenir, görünen mesaj yerinde ve odak yazma alanında kalır', async () => {
  const page = W.deniz
  const eski = W.w.room('eski')
  await setWidth(page, 1440)
  let i = 0
  while (i < 120) {
    await W.w.say('selin', eski, 'eski ' + (i + 1))
    i += 1
  }
  await openRoomRow(page, eski.id)
  assert.deepEqual(await page.evaluate(() => [state.messages.length, state.hasMore]), [50, true])
  await page.focus('#composer-input')
  await h.sleep(300)
  assert.equal(await page.evaluate(() => state.messages.length), 50, 'en alttayken yüklenmez')
  // En üste yaklaşmak yeter: düğme görünür alanın 800 piksel yakınında. Görünür alandaki ilk mesaj kaydırmayla aynı
  // görevde ölçülür (kaydırma olayından önce).
  const before = await page.evaluate(() => {
    el.messages.scrollTop = 300
    const top = el.messages.getBoundingClientRect().top
    const node = Array.from(document.querySelectorAll('#message-list .msg[data-id]')).filter((n) => n.getBoundingClientRect().bottom > top + 1)[0]
    return { id: node.getAttribute('data-id'), offset: Math.round(node.getBoundingClientRect().top - top) }
  })
  await page.waitForFunction(() => state.messages.length === 100 && !state.loadingOlder, null, { timeout: h.LONG })
  assertSameSpot(await firstVisible(page), before, 'görünen mesaj yerinde')
  assert.deepEqual(await page.evaluate(() => [document.activeElement.id, document.getElementById('load-older-wrap').hidden]), ['composer-input', false], 'odak yazma alanında, düğme yerinde')
  await page.evaluate(() => {
    el.messages.scrollTop = 0
  })
  await page.waitForFunction(() => state.messages.length === 120 && !state.hasMore && !state.loadingOlder, null, { timeout: h.LONG })
  assert.deepEqual(await page.evaluate(() => [document.getElementById('channel-start').hidden, document.getElementById('load-older-wrap').hidden, document.activeElement.id]), [false, true, 'composer-input'])
})

test('eski mesajlar: IntersectionObserver olmayan tarayıcıda kaydırma en üste yaklaşınca yükler', async () => {
  const noObserver = async (context) => {
    await context.addInitScript(() => {
      delete window.IntersectionObserver
    })
  }
  const page = await W.w.pageFor('ece', { route: noObserver, viewport: { width: 1024, height: 700 } })
  const eski = W.w.room('eski')
  assert.equal(await page.evaluate(() => typeof window.IntersectionObserver), 'undefined')
  await openRoom(page, eski.id)
  assert.deepEqual(await page.evaluate(() => [state.messages.length, state.hasMore]), [50, true])
  // 400 pikselden uzakta yüklenmez, yakında yüklenir
  await page.evaluate(() => {
    el.messages.scrollTop = 600
  })
  await h.sleep(400)
  assert.equal(await page.evaluate(() => state.messages.length), 50)
  await page.evaluate(() => {
    el.messages.scrollTop = 100
  })
  await page.waitForFunction(() => state.messages.length === 100 && !state.loadingOlder, null, { timeout: h.LONG })
  await page.close()
})

test('eski mesajlar: istek başarısız olunca kendiliğinden yükleme durur, hata bir kez bildirilir, düğme yeniden dener', async () => {
  const page = await W.w.pageFor('ece', { label: 'eski-hata', viewport: { width: 1024, height: 700 } })
  const eski = W.w.room('eski')
  // Daha eski sayfa istekleri sayfanın api katmanında sayılır ve önce sunucu hatasıyla (500) yanıtlanır. Ağ
  // yönlendirmesi (page.route) WebKit'te bu istekleri yakalamadı (CI'da istek sayısı 0 kalırken 120 mesaj sunucudan
  // yüklendi), hata bu yüzden her tarayıcıda aynı yoldan sayfada üretilir. Sayaçlar oda açılmadan kurulur: açılışla
  // ilk kaydırma arasında kendiliğinden giden bir istek de sayılır (oda açılışının ilk sayfa isteğinde before= yoktur).
  await page.evaluate(() => {
    window.testOlder = { count: 0, failing: true }
    const realApi = window.api
    window.api = function (method, path) {
      if (method === 'GET' && /^\/api\/messages\?.*before=/.test(String(path))) {
        window.testOlder.count += 1
        if (window.testOlder.failing) {
          const failed = Promise.resolve({ status: 500, data: { error: 'server' }, aborted: false })
          failed.abort = function () {}
          return failed
        }
      }
      return realApi.apply(this, arguments)
    }
    window.testToasts = 0
    const show = window.toast
    window.toast = function () {
      window.testToasts += 1
      return show.apply(this, arguments)
    }
  })
  const olderCount = () => page.evaluate(() => window.testOlder.count)
  await openRoom(page, eski.id)
  assert.deepEqual(await page.evaluate(() => [state.messages.length, state.hasMore]), [50, true])
  await page.evaluate(() => {
    el.messages.scrollTop = 300
  })
  try {
    await page.waitForFunction(() => window.testToasts === 1 && !state.loadingOlder, null, { timeout: h.LONG })
  } catch (err) {
    const now = await page.evaluate(() => JSON.stringify({ scrollTop: el.messages.scrollTop, scrollHeight: el.messages.scrollHeight, clientHeight: el.messages.clientHeight, messages: state.messages.length, hasMore: state.hasMore, loadingOlder: state.loadingOlder, toasts: window.testToasts, older: window.testOlder.count }))
    throw new Error('hata bildirimi bir kez gösterilmedi: ' + now)
  }
  assert.equal(await olderCount(), 1, 'en üste yaklaşınca bir eski sayfa isteği gider')
  // Kişi en üste yakınken kaydırmayı sürdürür: yeni istek ve yeni bildirim yok, düğme yerinde
  let k = 0
  while (k < 20) {
    await page.evaluate((y) => {
      el.messages.scrollTop = y
    }, 300 - k * 10)
    await h.sleep(30)
    k += 1
  }
  await h.sleep(300)
  assert.equal(await olderCount(), 1, 'başarısız istekten sonra kendiliğinden istek gitmez')
  assert.deepEqual(await page.evaluate(() => [window.testToasts, state.messages.length, document.getElementById('load-older-wrap').hidden]), [1, 50, false])
  // Düğme yeniden dener, başarılı olunca kendiliğinden yükleme sürer
  await page.evaluate(() => {
    window.testOlder.failing = false
  })
  await page.click('#load-older')
  await page.waitForFunction(() => state.messages.length >= 100 && !state.loadingOlder, null, { timeout: h.LONG })
  await page.evaluate(() => {
    el.messages.scrollTop = 0
  })
  await page.waitForFunction(() => state.messages.length === 120 && !state.hasMore && !state.loadingOlder, null, { timeout: h.LONG })
  assert.deepEqual([await olderCount(), await page.evaluate(() => window.testToasts)], [3, 1])
  await page.close()
})

// G10 (S8, S9): orta genişlikte İstasyonlar kartı ve dar özel mesaj başlığı

test('orta genişlik: İstasyonlar kartı telsiz kartının üstünde, Özel mesajlar grubuyla, çok alçak ekranda ve telsiz kartı yer bırakmayınca gizli', async () => {
  const page = W.deniz
  const layout = () => page.evaluate(() => {
    const inbox = document.getElementById('inbox').getBoundingClientRect()
    const radio = document.getElementById('radio').getBoundingClientRect()
    return {
      inbox: inbox.height > 0,
      above: inbox.bottom <= radio.top,
      rows: document.querySelectorAll('#inbox-list .room-row').length > 0,
      dmGroup: Boolean(document.getElementById('rooms-title-dm')),
      button: document.getElementById('btn-rooms').getClientRects().length > 0
    }
  })
  for (const size of [[768, 1024], [900, 800], [1024, 768], [1200, 900]]) {
    await setWidth(page, size[0], size[1])
    assert.deepEqual(await layout(), { inbox: true, above: true, rows: true, dmGroup: true, button: false }, size.join('x'))
    assert.ok(await h.overflowX(page) <= 0, size.join('x') + ' yatay taşma')
  }
  // Çok alçak ekranda kart gizlenir, odalar İstasyonlar düğmesiyle açılır
  await setWidth(page, 1024, 700)
  const low = await layout()
  assert.deepEqual([low.inbox, low.button], [false, true])
  // Ses odasında telsiz kartı uzar: kartta başlık ve iki satırlık liste yeri (13rem) kalmayınca kart gizlenir ve
  // İstasyonlar düğmesi görünür, yer açılınca kart geri gelir. Yükseklikler telsiz kartının ölçüsünden hesaplanır ve
  // 720 pikselden alçak ekran kuralının dışında kalır (inceleme düzeltmesi).
  if (h.FAKE_MIC) {
    await page.bringToFront()
    await setWidth(page, 1024, 900)
    await h.joinVoice(page, W.w.room('Lobi').id)
    const cramped = () => page.evaluate(() => {
      const list = document.getElementById('inbox-list')
      const row = list.querySelector('.room-row')
      return {
        inbox: document.getElementById('inbox').getClientRects().length > 0,
        button: document.getElementById('btn-rooms').getClientRects().length > 0,
        list: list.clientHeight,
        row: row ? row.offsetHeight : 0
      }
    })
    const sizes = await page.evaluate(() => {
      const rem = parseFloat(window.getComputedStyle(document.documentElement).fontSize)
      const extra = window.innerHeight - el.sideRight.clientHeight
      return { tight: Math.round(el.radio.offsetHeight + extra + 13 * rem - 25), roomy: Math.round(el.radio.offsetHeight + extra + 13 * rem + 40) }
    })
    assert.ok(sizes.tight > 730, 'telsiz kartı yeterince uzun: ' + JSON.stringify(sizes))
    await setWidth(page, 1024, sizes.tight)
    await page.waitForFunction(() => el.appView.classList.contains('is-inbox-cramped'))
    assert.deepEqual(await cramped().then((v) => [v.inbox, v.button]), [false, true], '1024x' + sizes.tight + ' ses odasında')
    await setWidth(page, 1024, sizes.roomy)
    await page.waitForFunction(() => !el.appView.classList.contains('is-inbox-cramped'))
    const roomy = await cramped()
    assert.deepEqual([roomy.inbox, roomy.button], [true, false], '1024x' + sizes.roomy + ' ses odasında')
    assert.ok(roomy.list >= 2 * roomy.row, 'listede en az iki satır görünür: ' + JSON.stringify(roomy))
    await page.click('#voice-leave')
    await page.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
  }
  await setWidth(page, 1440)
})

test('dar özel mesaj başlığı: 1024 ile 1280 px arasında ad en az 80 piksel görünür, düğmeler simgeye döner ve çakışmaz', async () => {
  const page = W.deniz
  const head = () => page.evaluate(() => {
    const header = document.getElementById('dm-header')
    const name = header.querySelector('.dm-header-name').getBoundingClientRect()
    const items = Array.from(header.children).concat([document.getElementById('btn-room-info')]).filter((n) => n.getClientRects().length).map((n) => n.getBoundingClientRect())
    let overlap = false
    items.forEach((a, i) => {
      items.slice(i + 1).forEach((b) => {
        if (a.right > b.left + 1 && b.right > a.left + 1) overlap = true
      })
    })
    const room = header.parentNode.getBoundingClientRect()
    return {
      name: Math.round(name.width),
      tight: header.classList.contains('is-tight'),
      overlap,
      inside: items.every((r) => r.right <= room.right + 1),
      labels: Array.from(header.querySelectorAll('button, [role="button"]')).every((b) => Boolean(b.getAttribute('aria-label')))
    }
  })
  await setWidth(page, 1440)
  await openDm(page, W.dmEce)
  const wide = await head()
  assert.equal(wide.tight, false, '1440 genişlikte düğme yazıları görünür')
  for (const width of [1024, 1100, 1200, 1280]) {
    await setWidth(page, width)
    await page.waitForFunction(() => document.getElementById('dm-header').clientWidth > 0)
    await h.sleep(100)
    const v = await head()
    assert.ok(v.name >= 80, width + ' genişlikte ad ' + v.name + ' piksel')
    assert.deepEqual([v.overlap, v.inside, v.labels], [false, true, true], width + ' genişlikte başlık')
  }
  await setWidth(page, 1440)
})

// G10 (S10): kısayollar ve Ctrl+K'de odalar ve kişiler

test('kısayollar: Alt+ok önceki ve sonraki konuşma, Alt+Shift+ok sıradaki okunmamış (anma önce), Esc okundu sayıp en alta iner', async () => {
  const page = W.deniz
  const genel = W.w.room('genel').id
  await setWidth(page, 1440)
  await openRoomRow(page, genel)
  const order = await page.evaluate(() => navConvList().map((c) => c.key))
  assert.equal(order[0], 'c:' + genel)
  assert.ok(order.indexOf('d:' + W.dmEce) !== -1 && order.indexOf('d:' + W.dmMert) !== -1, 'özel konuşmalar sırada')
  await page.focus('#composer-input')
  await page.keyboard.press('Alt+ArrowDown')
  await waitConversation(page, 'channel', order[1].slice(2))
  assert.equal(await page.evaluate(() => document.activeElement.id), 'composer-input')
  await page.keyboard.press('Alt+ArrowUp')
  await waitConversation(page, 'channel', genel)
  // Yukarı en baştan sona döner (son konuşma bir özel konuşma)
  await page.keyboard.press('Alt+ArrowUp')
  await waitConversation(page, 'dm', order[order.length - 1].slice(2))
  await page.keyboard.press('Alt+ArrowDown')
  await waitConversation(page, 'channel', genel)

  // Okunmamış: önceki testlerden kalan sayaçlar sıfırlanır, sonra oyun-gecesi'nde düz mesaj, sohbet'te anma gelir.
  // Alt+Shift+Aşağı önce anmaya, sonra okunmamışa gider
  await page.evaluate(() => {
    Object.keys(state.unread).forEach((id) => {
      state.unread[id] = 0
    })
    state.mentions = Object.create(null)
    renderBand()
  })
  const oyun = W.w.room('oyun-gecesi').id
  const sohbet = W.w.room('sohbet').id
  await W.w.say('ece', W.w.room('oyun-gecesi'), 'akşam oyun var mı')
  await W.w.say('ece', W.w.room('sohbet'), '@deniz bakar mısın')
  await page.waitForFunction((a) => state.unread[a.oyun] === 1 && mentionCount(a.sohbet) === 1, { oyun, sohbet }, { timeout: h.LONG })
  await page.keyboard.press('Alt+Shift+ArrowDown')
  await waitConversation(page, 'channel', sohbet)
  await page.waitForFunction((id) => !state.unread[id], sohbet)
  await page.keyboard.press('Alt+Shift+ArrowDown')
  await waitConversation(page, 'channel', oyun)
  await page.waitForFunction((id) => !state.unread[id], oyun)
  // Okunmamış kalmayınca konuşma değişmez
  await page.keyboard.press('Alt+Shift+ArrowDown')
  await h.sleep(300)
  await waitConversation(page, 'channel', oyun)

  // Bas konuş Alt tuşuna atanmışsa kısayol çalışmaz
  await page.evaluate(() => voice.setSettings({ bindings: { ptt: { type: 'key', code: 'AltLeft' } } }))
  await page.keyboard.press('Alt+ArrowDown')
  await h.sleep(300)
  await waitConversation(page, 'channel', oyun)
  await page.evaluate(() => voice.setSettings({ bindings: { ptt: { type: 'key', code: 'KeyV' } } }))

  // Esc: açık katman varken yalnızca katman kapanır, yokken okundu sayılır ve en alta inilir
  const arsiv = W.w.room('arsiv').id
  await openRoomRow(page, arsiv)
  await page.evaluate(() => {
    el.messages.scrollTop = 0
  })
  await page.waitForFunction(() => !isNearBottom())
  await page.focus('#composer-input')
  await page.click('#btn-emoji')
  await page.waitForSelector('#emoji-picker:not([hidden])')
  await page.keyboard.press('Escape')
  await page.waitForSelector('#emoji-picker', { state: 'hidden' })
  assert.equal(await page.evaluate(() => isNearBottom()), false, 'katman kapanırken kaydırılmadı')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => isNearBottom())
  assert.equal(await page.evaluate((id) => Number(state.lastRead[id]) === Number(state.messages[state.messages.length - 1].id), arsiv), true)
})

test('Ctrl+K: Odalar ve Kişiler bölümünde oda ve özel konuşma adı eşleşir, seçilen konuşma açılır, rehberde kısayollar', async () => {
  const page = W.deniz
  const foto = W.w.room('fotograflar').id
  await setWidth(page, 1440)
  await page.focus('#messages')
  await page.keyboard.press('Control+k')
  await page.waitForSelector('#search-panel:not([hidden])')
  await page.fill('#search-input', 'FOTOĞ')
  await page.waitForSelector('#search-quick:not([hidden])')
  const quick = await page.evaluate(() => ({
    title: document.getElementById('search-quick-title').textContent,
    items: Array.from(document.querySelectorAll('#search-quick-list .search-quick-item')).map((b) => [b.getAttribute('data-quick-kind'), b.querySelector('.search-quick-name').textContent, b.getAttribute('aria-label')])
  }))
  assert.deepEqual(quick, { title: 'Odalar ve Kişiler', items: [['channel', 'fotograflar', 'fotograflar aç']] })
  // Kişi: özel konuşmanın görünen adı
  await page.fill('#search-input', 'ece')
  await page.waitForFunction(() => Array.from(document.querySelectorAll('#search-quick-list .search-quick-item')).some((b) => b.getAttribute('data-quick-kind') === 'dm'))
  assert.equal(await page.evaluate(() => document.querySelector('#search-quick-list .search-quick-item[data-quick-kind="dm"]').getAttribute('aria-label')), 'Ece ile özel mesaj aç')
  // Klavyeyle: aşağı ok ilk sonuca, Enter açar
  await page.fill('#search-input', 'fotog')
  await page.waitForSelector('#search-quick-list .search-quick-item[data-quick-id="' + foto + '"]')
  await page.focus('#search-input')
  await page.keyboard.press('ArrowDown')
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-quick-id')), String(foto))
  await page.keyboard.press('Enter')
  await waitConversation(page, 'channel', foto)
  await page.waitForSelector('#search-panel', { state: 'hidden' })
  // Eşleşme yoksa bölüm gizli
  await page.focus('#messages')
  await page.keyboard.press('Control+k')
  await page.waitForSelector('#search-panel:not([hidden])')
  await page.fill('#search-input', 'xyzq')
  await page.waitForFunction(() => document.getElementById('search-quick').hidden)
  await page.keyboard.press('Escape')
  await page.waitForSelector('#search-panel', { state: 'hidden' })
  // Rehber kartında kısayol satırları
  await page.click('#band-help')
  await page.waitForSelector('#hints-card:not([hidden])')
  const hints = await page.evaluate(() => Array.from(document.querySelectorAll('#hints-card .hints-conv')).map((n) => n.textContent))
  assert.deepEqual(hints, ['Alt + Yukarı/Aşağı: önceki veya sonraki konuşma', 'Alt + Shift + Yukarı/Aşağı: sonraki okunmamış', 'Esc: okundu işaretle ve en alta in'])
  await page.keyboard.press('Escape')
  await page.waitForSelector('#hints-card', { state: 'hidden' })
})

// G10 (S11, S13, S14, S15): okunmamış alt sınırı, telefonda Ses Odaları düğmesi, dokunma hedefleri, sayfayı sürükleyerek
// kapatma

test('okunmamış alt sınırı: açılışta sayılan sayfa doluysa rozet "50+", oda açılınca kesin sayı', async () => {
  const page = W.deniz
  const arsiv = W.w.room('arsiv')
  const genel = W.w.room('genel').id
  await setWidth(page, 1440)
  await openRoomRow(page, genel)
  // Uygulama kapalıyken 60 mesaj gelir, açılışta yalnızca en yeni sayfa (50) sayılır
  await page.evaluate(() => stopPoll())
  let i = 0
  while (i < 60) {
    await W.w.say('selin', arsiv, 'uzun ara ' + (i + 1))
    i += 1
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  await waitConversation(page, 'channel', genel)
  const mark = (id) => page.evaluate((x) => {
    const b = document.querySelector('#inbox-list .room-row[data-station="text-' + x + '"]')
    const m = b ? b.querySelector('.station-mark') : null
    return m ? m.textContent : ''
  }, id)
  await page.waitForFunction((x) => {
    const b = document.querySelector('#inbox-list .room-row[data-station="text-' + x + '"] .station-mark')
    return Boolean(b && b.textContent === '50+')
  }, arsiv.id, { timeout: h.LONG })
  assert.equal(await page.evaluate((x) => state.unread[x], arsiv.id), 50)
  // Erişilebilir ad da alt sınırı söyler (inceleme düzeltmesi)
  const rowLabel = (id) => page.getAttribute('#inbox-list .room-row[data-station="text-' + id + '"]', 'aria-label')
  assert.equal(await rowLabel(arsiv.id), 'arsiv, yazı odası, en az 50 okunmamış')
  // Oda açılınca okunmamışlar iki sayfadan sayılır, alta inmeden çıkınca rozet kesin sayıdır
  await openRoomRow(page, arsiv.id)
  await page.waitForSelector('#message-list .unread-divider')
  assert.equal(await page.evaluate(() => document.querySelector('#unread-bar .unread-bar-count').textContent), '60 yeni mesaj')
  await openRoomRow(page, genel)
  assert.equal(await mark(arsiv.id), '60')
  assert.equal(await rowLabel(arsiv.id), 'arsiv, yazı odası, 60 okunmamış')
  assert.ok(await h.overflowX(page) <= 0, 'yatay taşma')
})

test('telefon: kapalı telsiz kartı Ses Odaları düğmesi, dokunma hedefleri en az 44 piksel, sayfa tutamaçtan sürüklenince kapanır', async () => {
  const page = await W.w.pageFor('ece', { viewport: { width: 360, height: 780 }, mobile: true })
  assert.equal(await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches), true)
  const pick = await page.evaluate(() => {
    const b = document.getElementById('radio-pick-button')
    const r = b.getBoundingClientRect()
    return { shown: b.getClientRects().length > 0, height: r.height, text: b.textContent.trim(), radio: Math.round(document.getElementById('radio').getBoundingClientRect().height), textShown: document.getElementById('radio-pick').getClientRects().length > 0 }
  })
  assert.deepEqual([pick.shown, pick.text, pick.textShown], [true, 'Ses Odaları', false])
  assert.ok(pick.height >= 43.5, 'Ses Odaları düğmesi ' + pick.height + ' piksel')
  assert.ok(pick.radio <= 72, 'kapalı telsiz kartı ' + pick.radio + ' piksel')
  // Üst çubuğun düğmeleri en az 44 piksel yükseklikte
  const heights = await page.evaluate(() => Array.from(document.querySelectorAll('.top-bar button')).filter((b) => b.getClientRects().length).map((b) => b.getBoundingClientRect().height))
  assert.ok(heights.length >= 5 && heights.every((x) => x >= 43.5), 'üst düğmeler: ' + heights.join(','))
  assert.ok(await h.overflowX(page) <= 0, '360 genişlikte yatay taşma')
  // Ses Odaları düğmesi İstasyonlar sayfasını ses odalarında açar, satırlar en az 44 piksel
  await page.click('#radio-pick-button')
  await page.waitForSelector('#stations-sheet:not([hidden])')
  await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('room-row-voice'))
  assert.equal(await page.getAttribute('#radio-pick-button', 'aria-expanded'), 'true')
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('#stations-list .room-row')).map((b) => b.getBoundingClientRect().height))
  assert.ok(rows.length > 3 && rows.every((x) => x >= 43.5), 'satırlar: ' + rows.join(','))
  await page.keyboard.press('Escape')
  await page.waitForSelector('#stations-sheet', { state: 'hidden' })
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'radio-pick-button')

  // Tutamaç: az sürüklenince sayfa yerine döner, 80 pikselden çok sürüklenince kapanır
  const drag = async (dy) => {
    const box = await page.locator('#stations-sheet .sheet-handle').boundingBox()
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await page.mouse.move(x, y)
    await page.mouse.down()
    await page.mouse.move(x, y + dy / 2)
    await page.mouse.move(x, y + dy)
    const moved = await page.evaluate(() => document.getElementById('stations-sheet').style.transform)
    await page.mouse.up()
    return moved
  }
  await page.click('#btn-rooms')
  await page.waitForSelector('#stations-sheet:not([hidden])')
  await h.sleep(400)
  assert.equal(await drag(40), 'translateY(40px)', 'sayfa parmağı izler')
  await h.sleep(200)
  assert.deepEqual(await page.evaluate(() => [document.getElementById('stations-sheet').hidden, document.getElementById('stations-sheet').style.transform]), [false, ''])
  // Tutamaç tutulurken ikinci parmak listeye dokunup kayar ve kalkar: sayfa kaymaz ve kapanmaz, yalnızca tutamaçtaki
  // parmak izlenir (inceleme düzeltmesi)
  const twoFingers = await page.evaluate(() => {
    const sheet = document.getElementById('stations-sheet')
    const handle = sheet.querySelector('.sheet-handle').getBoundingClientRect()
    const row = sheet.querySelector('#stations-list .room-row').getBoundingClientRect()
    const x = handle.left + handle.width / 2
    const y = handle.top + handle.height / 2
    const send = (type, id, target, cy) => {
      target.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 21, button: type === 'pointermove' ? -1 : 0, clientX: x, clientY: cy, bubbles: true, cancelable: true }))
    }
    const list = sheet.querySelector('#stations-list .room-row')
    send('pointerdown', 21, sheet.querySelector('.sheet-handle'), y)
    send('pointerdown', 22, list, row.top + 10)
    send('pointermove', 22, list, row.top + 20)
    const other = sheet.style.transform
    send('pointerup', 22, list, row.top + 20)
    const afterOther = [sheet.hidden, sheet.style.transform]
    send('pointermove', 21, sheet.querySelector('.sheet-handle'), y + 30)
    const own = sheet.style.transform
    send('pointerup', 21, sheet.querySelector('.sheet-handle'), y + 30)
    return { other, afterOther, own, end: [sheet.hidden, sheet.style.transform, sheet.classList.contains('is-dragging')] }
  })
  assert.deepEqual(twoFingers, { other: '', afterOther: [false, ''], own: 'translateY(30px)', end: [false, '', false] })
  await drag(120)
  await page.waitForSelector('#stations-sheet', { state: 'hidden' })
  await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'btn-rooms')
  // Kartın düğmesi ses odasına bağlıyken gizlidir
  if (h.FAKE_MIC) {
    await page.click('#radio-pick-button')
    await page.waitForSelector('#stations-sheet:not([hidden])')
    await page.click('#stations-list .room-row-voice')
    await page.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'on', null, { timeout: h.LONG })
    assert.equal(await page.evaluate(() => document.getElementById('radio-pick-button').getClientRects().length), 0)
    await page.click('#voice-leave')
    await page.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
  }
  // 320 piksellik telefonda özel mesaj başlığı taşmaz, Profil düğmesi ekranın içindedir (inceleme düzeltmesi)
  await page.setViewportSize({ width: 320, height: 640 })
  await page.waitForFunction(() => window.innerWidth === 320)
  await openDm(page, W.dmEce)
  await h.sleep(150)
  const dmHead = await page.evaluate(() => {
    const header = document.getElementById('dm-header')
    const buttons = Array.from(header.querySelectorAll('button')).concat([document.getElementById('btn-room-info')]).filter((b) => b.getClientRects().length)
    return {
      over: header.scrollWidth - header.clientWidth,
      right: Math.max.apply(null, buttons.map((b) => b.getBoundingClientRect().right)),
      width: document.documentElement.clientWidth,
      name: Math.round(header.querySelector('.dm-header-name').getBoundingClientRect().width)
    }
  })
  assert.ok(dmHead.over <= 0, '320 genişlikte özel mesaj başlığı ' + dmHead.over + ' piksel taşıyor')
  assert.ok(dmHead.right <= dmHead.width, '320 genişlikte başlığın düğmeleri ekranın içinde: ' + dmHead.right)
  assert.ok(await h.overflowX(page) <= 0, '320 genişlikte yatay taşma')
  // Daha geniş telefonda üst çubuğun düğmeleri en az 44 piksel genişlikte de
  await page.setViewportSize({ width: 412, height: 860 })
  await page.waitForFunction(() => window.innerWidth === 412)
  const widths = await page.evaluate(() => Array.from(document.querySelectorAll('.top-bar .top-chip, .top-bar .top-personal-button')).filter((b) => b.getClientRects().length).map((b) => b.getBoundingClientRect().width))
  assert.ok(widths.length >= 4 && widths.every((x) => x >= 43.5), 'üst düğme genişlikleri: ' + widths.join(','))
  assert.ok(await h.overflowX(page) <= 0, '412 genişlikte yatay taşma')
  await page.close()
})

test('konsol ve sunucu günlüğü temiz', async () => {
  // Sunucunun tanımadığı ekle yapılan gönderim denemesi (yukarıda) beklenen bir 400 yanıtı alır
  const badUploads = (e) => e.type === 'error' && /status of 400/.test(e.text) && /\/api\/messages$/.test(e.url)
  // Eski mesajlar testinde daha eski sayfa isteği bilerek 500 yanıtı alır
  const olderFailed = (e) => e.label === 'eski-hata' && e.type === 'error' && /status of 500/.test(e.text) && /before=/.test(e.url)
  h.assertCleanConsole(W.w.logs, W.w.srv.errors, [badUploads, olderFailed])
})
