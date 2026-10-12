'use strict'

// Telsiz DJ: iki kullanıcı ses odasında. /çal ile YouTube parçası eklenir, rıza kartı iki istemcide görünür ve
// rızadan önce YouTube alan adlarına hiçbir istek gitmez. Parça duyurusu parçanın adını taşır (ad sonradan
// gelirse ekleyenin duyurusu düzenlenir), "DJ'de çal" da dosyanın yazı odasına adıyla duyurulur, ses odasındaki
// diğer kişinin Bildirimler listesine kayıt düşer. YouTube gömmesi page.route ile yerel sahte oynatıcıya
// (sahte-youtube.js) yönlendirilir, gerçek YouTube'a erişilmez. Duraklat ve devam iki istemcide eşitlenir,
// bantta nota işareti ve telsiz kartında "DJ çalıyor" satırı görünür, mesajdaki ses dosyası kuyruğa eklenip
// iki istemcide çalar. Ayarlar açıkken ve dar ekranda DJ sayfası kapalıyken YouTube oynatıcısı köşeye alınır
// (en az 200x200, üstünde hiçbir şey yok) ve müzik ses odasından ayrılana kadar çalmaya devam eder. Köşedeki
// oynatıcı ses düğmelerini, Oda bilgisi düğmesini ve Ayarlar'ın satırlarını örtmez, oyun masasının renk seçicisi
// açıkken yerinde kalır, kısa pencerede de görünüm alanında kalır. DJ duyurusuna yalnızca ad ekleyen düzenleme
// "düzenlendi" etiketi almaz, mesajı duyuruya çeviren veya videosunu değiştiren düzenleme etiketle görünür.
// Şarkı adıyla arama (istek 5): sunucuya sahte arayıcı (youtubeSearch) verilir. Arama kapalıyken /çal şarkı adı
// açık bir hata ve kartta YouTube arama bağlantısı verir, açıkken ilk sonuç başlığıyla eklenir ve duyuru başlığı
// taşır. İstemciden YouTube'a arama isteği gitmez. Arama yapılamazsa, sonuç yoksa veya sunucu geneli sınır dolduysa
// kartta bağlantı çıkar, kişi başı sınır ve ağ hatası yalnızca açık metinle bildirilir, önce başlatılan aramanın
// yanıtı kartı değiştirmez. Arama sürerken başka bir ses odasına geçilirse bulunan parça hiçbir odaya eklenmez.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const h = require('./yardimci')

const FAKE_JS = fs.readFileSync(path.join(__dirname, 'sahte-youtube.js'), 'utf8')
const YT_HOST_RE = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|googlevideo\.com|doubleclick\.net|google\.com|gstatic\.com|googleapis\.com)(:\d+)?\//i
const EMBED_HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#111"><script src="/fake/embed.js"></script></body></html>'

const W = { w: null, A: null, B: null, lobi: null, genel: null, yt: { deniz: [], ece: [] }, searches: [] }

// Sunucunun YouTube araması yerine geçen sahte arayıcı: "lobi şarkısı" için iki sonuç verir, "arıza şarkısı"
// aramasında YouTube'a ulaşılamamış gibi hata verir (sunucu 502 search_failed döner), gerisinde sonuç yoktur
function fakeYouTubeSearch (query) {
  W.searches.push(query)
  if (query === 'arıza şarkısı') return Promise.reject(Object.assign(new Error('sahte arama hatası'), { code: 'search_failed' }))
  if (query !== 'lobi şarkısı') return Promise.resolve([])
  return Promise.resolve([
    { videoId: 'D120lobi001', title: 'Lobi Şarkısı (Resmi Video)', channel: 'Telsiz Kayıtları', durationS: 213 },
    { videoId: 'D120lobi002', title: 'Lobi Şarkısı (Canlı)', channel: 'Telsiz Kayıtları', durationS: 250 }
  ])
}
// Sahte mikrofon, ekran yakalama ve kendiliğinden oynatma Chromium bayraklarıyla sağlanır
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []), { browsers: ['chromium'], reason: 'sahte medya aygıtı yalnızca Chromium bayraklarıyla' })

// YouTube alan adlarına giden her istek kaydedilir. Yalnızca gömme sayfası ve sahte betik verilir, gerisi
// engellenir.
function routeYouTube (who) {
  return async (context) => {
    await context.route(YT_HOST_RE, async (route) => {
      const url = new URL(route.request().url())
      W.yt[who].push(url.href)
      if (url.hostname === 'www.youtube-nocookie.com' && /^\/embed\/[A-Za-z0-9_-]{11}$/.test(url.pathname)) {
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: EMBED_HTML })
        return
      }
      if (url.pathname === '/fake/embed.js') {
        await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: FAKE_JS })
        return
      }
      await route.abort()
    })
  }
}

async function fakeState (page) {
  const frame = page.frames().find((f) => f.url().startsWith('https://www.youtube-nocookie.com/embed/'))
  if (!frame) return null
  try {
    return await frame.evaluate(() => ({ state: window.FAKE.state, id: window.FAKE.videoId, paused: window.FAKE.audio.paused, mark: window.e2eMark || null }))
  } catch (err) {
    return null
  }
}

// Sahte oynatıcı çalıyor ve ses ilerliyor
async function fakePlaying (page, label) {
  await h.until(async () => {
    const st = await fakeState(page)
    return st && st.state === 1 && !st.paused
  }, h.LONG, label)
  const frame = page.frames().find((f) => f.url().startsWith('https://www.youtube-nocookie.com/embed/'))
  const t0 = await frame.evaluate(() => window.FAKE.audio.currentTime)
  await h.until(async () => (await frame.evaluate(() => window.FAKE.audio.currentTime)) > t0 + 0.3, h.SHORT, label + ' (ses ilerliyor)')
}

// Köşedeki oynatıcının ölçüleri: çerçeve, kutu ve çubuk, çerçevenin 3x3 noktasında en üstteki öğe
function dockInfo (page) {
  return page.evaluate(() => {
    const d = document.getElementById('dj')
    const f = document.querySelector('#dj .dj-yt iframe.dj-youtube-frame')
    const fr = f.getBoundingClientRect()
    const box = document.querySelector('#dj .dj-yt').getBoundingClientRect()
    const bar = document.querySelector('#dj .dj-dock').getBoundingClientRect()
    const hits = [0.1, 0.5, 0.9].every((fy) => [0.1, 0.5, 0.9].every((fx) => document.elementFromPoint(fr.left + fr.width * fx, fr.top + fr.height * fy) === f))
    const center = document.elementFromPoint(fr.left + fr.width / 2, fr.top + fr.height / 2) === f
    const s = dj.engine.snapshot()
    return {
      docked: d.classList.contains('is-docked') && !d.hidden,
      frameW: fr.width,
      frameH: fr.height,
      boxW: box.width,
      boxH: box.height,
      inView: fr.left >= 0 && fr.top >= 0 && fr.right <= window.innerWidth && fr.bottom <= window.innerHeight,
      barBelow: bar.height > 0 && bar.top >= box.bottom - 0.5 && bar.left < box.right && bar.right > box.left,
      barOutside: bar.top >= fr.bottom || bar.bottom <= fr.top || bar.left >= fr.right || bar.right <= fr.left,
      center: center,
      hits: hits,
      hidden: s.player.hidden,
      status: s.player.status,
      toggleLabel: document.querySelector('#dj .dj-dock-toggle').getAttribute('aria-label'),
      openLabel: document.querySelector('#dj .dj-dock-open').getAttribute('aria-label'),
      title: document.querySelector('#dj .dj-dock-title').textContent
    }
  })
}

function assertDocked (info) {
  assert.equal(info.docked, true, 'köşede')
  assert.ok(info.frameW >= 200 && info.frameH >= 200, 'çerçeve en az 200x200: ' + info.frameW + 'x' + info.frameH)
  assert.ok(info.boxW >= 200 && info.boxH >= 200, 'kutu en az 200x200')
  assert.equal(info.inView, true, 'çerçeve görünüm alanında')
  assert.equal(info.center, true, 'çerçevenin ortasında en üstteki öğe çerçeve')
  assert.equal(info.hits, true, 'çerçevenin 3x3 noktasında en üstteki öğe çerçeve')
  assert.equal(info.barBelow, true, 'çubuk kutunun altında')
  assert.equal(info.barOutside, true, 'çubuk çerçevenin dışında')
  assert.equal(info.hidden, false, 'motor oynatıcıyı görünür sayıyor')
}

before(async () => {
  if (test.skipped) return
  W.w = await h.setupWorld({ slot: 5, server: { youtubeSearch: fakeYouTubeSearch } })
  W.lobi = W.w.room('Lobi')
  W.genel = W.w.room('genel')
  W.A = await W.w.pageFor('deniz', { route: routeYouTube('deniz') })
  W.B = await W.w.pageFor('ece', { route: routeYouTube('ece') })
})

after(async () => {
  if (W.w) await W.w.close()
})

test('ses odasında kadronun altında Telsiz DJ düğmesi, boş DJ sütun açmaz ve yan sayfada açılır', async () => {
  for (const page of [W.A, W.B]) await h.joinVoice(page, W.lobi.id)
  for (const page of [W.A, W.B]) {
    await page.waitForFunction(() => document.querySelector('#radio-tools .crew-dj'), null, { timeout: h.LONG })
    await page.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item').length === 2, null, { timeout: h.LONG })
  }
  const r = await W.A.evaluate(() => ({
    hidden: document.getElementById('dj').hidden,
    col: document.getElementById('app-view').getAttribute('data-dj-col'),
    crew: document.querySelector('#radio-tools .crew-dj .dj-crew-name').textContent,
    last: document.getElementById('radio-tools').lastElementChild.classList.contains('crew-dj'),
    infoInline: isInfoInline(),
    infoCol: document.getElementById('info-col').getBoundingClientRect().width > 0
  }))
  // Boş DJ ayrı sütun açmaz, sol bilgi sütunu yerinde kalır
  assert.deepEqual(r, { hidden: true, col: 'off', crew: 'Telsiz DJ', last: true, infoInline: true, infoCol: true })
  await W.A.click('#radio-tools .crew-dj button')
  await W.A.waitForFunction(() => {
    const d = document.getElementById('dj')
    return !d.hidden && d.classList.contains('is-open') && d.getAttribute('role') === 'dialog'
  })
  assert.equal(await W.A.textContent('#dj .dj-empty-title'), 'Henüz parça yok')
  await W.A.keyboard.press('Escape')
  await W.A.waitForFunction(() => document.getElementById('dj').hidden)
})

test('/çal ile YouTube parçası: komut metni gitmez, yazı odasında DJ duyurusu çıkar, rıza kartı çıkar, YouTube\'a istek yok', async () => {
  const { A, B } = W
  // Bildirim kısa sürer ve hemen ardından rıza bildirimi gelebilir: gösterilen tüm metinler kaydedilir
  await A.evaluate(() => {
    window.e2eToasts = []
    new MutationObserver(() => {
      if (!el.toast.hidden) window.e2eToasts.push(el.toast.textContent)
    }).observe(el.toast, { childList: true, characterData: true, subtree: true, attributes: true })
  })
  await A.fill('#composer-input', '/çal https://youtu.be/D120aaaaaaa')
  await A.keyboard.press('Enter')
  await A.waitForFunction(() => window.e2eToasts.indexOf('Parça kuyruğa eklendi.') !== -1)
  // Kimse oynatıcıyı yüklemediği için parçanın adı bilinmez: duyuru en çok 8 saniye bekler. Sayfa bu sırada
  // kapanırsa (pagehide) bekleyen duyuru hemen adsız gider, bellekte kalıp kaybolmaz.
  const waiting = await A.evaluate(() => dj.titleWatch.filter((w) => !w.sent).length)
  assert.equal(waiting, 1, 'duyuru parçanın adını bekliyor')
  const hiddenAt = Date.now()
  await A.evaluate(() => window.dispatchEvent(new Event('pagehide')))
  assert.equal(await A.inputValue('#composer-input'), '')
  const sent = await A.evaluate(() => Array.from(document.querySelectorAll('#message-list .msg-text')).some((n) => n.textContent.indexOf('/çal') !== -1))
  assert.equal(sent, false, 'komut metni mesaj olarak gösterilmedi')
  // Duyuru komutun yazıldığı yazı odasında iki istemcide de görünür
  const roomA = await A.evaluate(() => String(state.channelId))
  const me = await A.evaluate(() => userDisplayName(state.me.id))
  assert.equal(await B.evaluate(() => String(state.channelId)), roomA)
  // Duyuru düzenlenemez. Mesajı Bildir (G16) yalnızca başkasının duyurusunda durur: araç çubuğunun düzenlenebilirlik
  // denetimi bu düğmeyi saymaz, varlığı ayrıca denetlenir
  for (const page of [A, B]) {
    await page.waitForFunction(() => document.querySelector('#message-list .msg-dj'), null, { timeout: h.LONG })
    const notice = await page.evaluate(() => {
      const n = document.querySelector('#message-list .msg-dj')
      const msg = n.closest('.msg')
      return { text: n.querySelector('.msg-dj-text').textContent, href: n.querySelector('.msg-dj-link').href, rel: n.querySelector('.msg-dj-link').rel, author: msg.querySelector('.msg-author').textContent, editable: Boolean(msg.querySelector('.msg-quick:not(.msg-action-danger):not(.msg-report)')), report: Boolean(msg.querySelector('.msg-quick.msg-report')) }
    })
    assert.deepEqual(notice, { text: 'Telsiz DJ kuyruğuna bir YouTube parçası ekledi.', href: 'https://www.youtube.com/watch?v=D120aaaaaaa', rel: 'noopener noreferrer', author: me, editable: false, report: page === B })
  }
  assert.ok(Date.now() - hiddenAt < 5000, 'duyuru sayfa kapanırken hemen gitti: ' + (Date.now() - hiddenAt) + ' ms')
  for (const page of [A, B]) await page.waitForFunction(() => !document.querySelector('#dj .dj-consent').hidden, null, { timeout: h.LONG })
  // Parça gelince kart sağ sütunda İstasyonlar listesinin altına yerleşir, liste görünür kalır, sol sütun
  // (telsiz kartı) yerinde kalır
  const col = await A.evaluate(() => {
    const djBox = document.getElementById('dj').getBoundingClientRect()
    const inbox = document.getElementById('inbox').getBoundingClientRect()
    return {
      col: document.getElementById('app-view').getAttribute('data-dj-col'),
      sheet: document.getElementById('dj').classList.contains('is-sheet-mode'),
      infoInline: isInfoInline(),
      infoCol: document.getElementById('info-col').getBoundingClientRect().width > 0,
      dj: djBox.width > 0,
      inbox: inbox.width > 0 && inbox.height >= 12 * parseFloat(getComputedStyle(document.documentElement).fontSize) - 1,
      // İstasyonlar listesi sağ sütunun üstünde, DJ kartı altında
      stacked: inbox.bottom <= djBox.top && Math.abs(djBox.left - inbox.left) < 2,
      rows: document.querySelectorAll('#inbox-list .room-row').length > 0,
      roomsButton: document.getElementById('btn-rooms').getClientRects().length > 0
    }
  })
  assert.deepEqual(col, { col: 'on', sheet: false, infoInline: true, infoCol: true, dj: true, inbox: true, stacked: true, rows: true, roomsButton: false })
  const consent = await B.evaluate(() => ({ title: document.querySelector('#dj .dj-consent-title').textContent, yt: document.querySelector('#dj .dj-yt').hidden, frames: document.querySelectorAll('iframe').length }))
  assert.deepEqual(consent, { title: 'YouTube oynatıcısı yüklensin mi?', yt: true, frames: 0 })
  assert.deepEqual(W.yt, { deniz: [], ece: [] }, 'rızadan önce YouTube alan adlarına istek gitmedi')
})

test('rızadan sonra sahte YouTube iki istemcide çalar, bantta nota ve kartta "DJ çalıyor"', async () => {
  const { A, B } = W
  for (const page of [A, B]) await page.click('#dj .dj-consent-accept')
  for (const page of [A, B]) {
    await page.waitForFunction(() => {
      const f = document.querySelector('#dj .dj-yt iframe.dj-youtube-frame')
      if (!f) return false
      const r = f.getBoundingClientRect()
      return r.width >= 200 && r.height >= 200
    }, null, { timeout: h.LONG })
    await h.until(async () => {
      const st = await fakeState(page)
      return st && st.state === 1 && !st.paused && st.id === 'D120aaaaaaa'
    }, h.LONG, 'sahte YouTube çalıyor')
  }
  assert.ok(W.yt.deniz.every((u) => /youtube-nocookie\.com/.test(u)), 'yalnızca youtube-nocookie: ' + W.yt.deniz.join(' '))
  await A.waitForFunction(() => dj.engine.snapshot().player.status === 'playing' && document.querySelector('#dj .dj-state').textContent === 'Çalıyor', null, { timeout: h.LONG })
  // DJ notası sağdaki İstasyonlar listesindeki ses odası satırında (bant yalnızca frekansları dizer)
  await A.waitForFunction((id) => {
    const st = document.querySelector('#inbox-list .room-row[data-channel-id="' + id + '"]')
    return st && st.querySelector('.room-row-dj') && /Telsiz DJ çalıyor/.test(st.getAttribute('aria-label'))
  }, W.lobi.id, { timeout: h.LONG })
  await A.waitForFunction(() => {
    const line = document.getElementById('radio-dj')
    return !line.hidden && /^DJ çalıyor: /.test(document.getElementById('radio-dj-text').textContent)
  }, null, { timeout: h.LONG })
  // Oynatıcı parçanın adını bildirdi: ekleyenin adsız giden duyurusu adla düzenlenir, DJ duyurusunda
  // "düzenlendi" etiketi yoktur. Karttaki son işlem satırı da adı kuyruktan canlı okur.
  const me = await A.evaluate(() => userDisplayName(state.me.id))
  for (const page of [A, B]) {
    await page.waitForFunction(() => {
      const n = document.querySelector('#message-list .msg-dj .msg-dj-text')
      return n && n.textContent === 'Telsiz DJ kuyruğuna ekledi: Fake video D120aaaaaaa'
    }, null, { timeout: h.LONG })
    const notice = await page.evaluate(() => {
      const msg = document.querySelector('#message-list .msg-dj').closest('.msg')
      return { author: msg.querySelector('.msg-author').textContent, edited: Boolean(msg.querySelector('.msg-edited')), link: msg.querySelector('.msg-dj-link').href }
    })
    assert.deepEqual(notice, { author: me, edited: false, link: 'https://www.youtube.com/watch?v=D120aaaaaaa' })
  }
  assert.equal(await B.textContent('#dj .dj-last'), me + ' kuyruğa ekledi: Fake video D120aaaaaaa')
  // Bildirimler listesinde de kayıt durur, parçanın adı sonradan gelince güncellenir
  await B.waitForFunction((name) => {
    const n = document.querySelector('#activity:not([hidden]) .activity-item.is-dj .activity-text')
    return n && n.textContent === name + ' Telsiz DJ kuyruğuna ekledi: Fake video D120aaaaaaa'
  }, me, { timeout: h.LONG })
})

test('"düzenlendi" etiketi: mesajı DJ duyurusuna çeviren veya duyurunun videosunu değiştiren düzenleme görünür', async () => {
  const { A, B } = W
  const room = await A.evaluate(() => state.channelId)
  // Yalnızca ad ekleyen düzenleme konuşmadan çıkıp dönünce de etiketsiz kalır (bu oturumda izlendi)
  const other = W.w.room('oyun-gecesi').id
  assert.equal(await B.evaluate((r) => sameId(state.channelId, r), room), true)
  await B.evaluate((id) => selectChannel(id, {}), other)
  await B.waitForFunction((id) => sameId(state.channelId, id) && !state.loading && !document.querySelector('#message-list .msg-dj'), other, { timeout: h.LONG })
  await B.evaluate((id) => selectChannel(id, {}), room)
  await B.waitForFunction((id) => sameId(state.channelId, id) && !state.loading && document.querySelector('#message-list .msg-dj'), room, { timeout: h.LONG })
  assert.equal(await B.evaluate(() => Boolean(document.querySelector('#message-list .msg-dj').closest('.msg').querySelector('.msg-edited'))), false)
  const labelled = async (page, id) => {
    await page.waitForFunction((x) => {
      const msg = document.querySelector('#message-list .msg[data-id="' + x + '"]')
      return Boolean(msg && msg.querySelector('.msg-dj') && msg.querySelector('.msg-edited'))
    }, id, { timeout: h.LONG })
  }
  // Değiştirilmiş istemci benzetimi: sıradan bir mesaj sonradan DJ duyurusuna çevrilir
  const plain = await A.evaluate((r) => postSideMessage(r, 'merhaba', null), room)
  await B.waitForFunction((x) => {
    const n = document.querySelector('#message-list .msg[data-id="' + x + '"] .msg-text')
    return n && n.textContent === 'merhaba'
  }, plain, { timeout: h.LONG })
  await A.evaluate((args) => editSideMessage(args[0], args[1], 'merhaba', { op: 'add', src: 'yt', vid: 'D120ccccccc', title: 'Başka bir şarkı' }), [room, plain])
  for (const page of [A, B]) await labelled(page, plain)
  // Gerçek bir duyurunun videosu sonradan değiştirilir
  const notice = await A.evaluate((r) => postSideMessage(r, '/çal https://youtu.be/D120ddddddd', { op: 'add', src: 'yt', vid: 'D120ddddddd' }), room)
  await B.waitForFunction((x) => {
    const msg = document.querySelector('#message-list .msg[data-id="' + x + '"]')
    return Boolean(msg && msg.querySelector('.msg-dj') && !msg.querySelector('.msg-edited'))
  }, notice, { timeout: h.LONG })
  await A.evaluate((args) => editSideMessage(args[0], args[1], '/çal https://youtu.be/D120ddddddd', { op: 'add', src: 'yt', vid: 'D120eeeeeee', title: 'Fake video D120ddddddd' }), [room, notice])
  for (const page of [A, B]) await labelled(page, notice)
  const link = await B.evaluate((x) => document.querySelector('#message-list .msg[data-id="' + x + '"] .msg-dj-link').href, notice)
  assert.equal(link, 'https://www.youtube.com/watch?v=D120eeeeeee')
})

test('duraklat ve devam iki istemcide eşitlenir', async () => {
  const { A, B } = W
  await B.click('#dj .dj-toggle')
  await A.waitForFunction(() => {
    const s = dj.engine.snapshot()
    return s.session && s.session.playing === false && document.querySelector('#dj .dj-toggle').textContent === 'Devam Et'
  }, null, { timeout: h.LONG })
  assert.equal(await A.textContent('#dj .dj-state'), 'Duraklatıldı')
  await h.until(async () => {
    const st = await fakeState(A)
    return st && st.paused
  }, h.LONG, 'A oynatıcısı duraklatıldı')
  await A.waitForFunction(() => document.getElementById('radio-dj').hidden, null, { timeout: h.LONG })
  await A.click('#dj .dj-toggle')
  await B.waitForFunction(() => {
    const s = dj.engine.snapshot()
    return s.session && s.session.playing === true
  }, null, { timeout: h.LONG })
  await h.until(async () => {
    const st = await fakeState(B)
    return st && st.state === 1 && !st.paused
  }, h.LONG, 'B oynatıcısı devam ediyor')
})

test('/çal şarkı adı: arama kapalıyken hata ve YouTube arama bağlantısı, açıkken ilk sonuç başlığıyla eklenir ve duyurulur', async () => {
  const { A, B } = W
  await A.evaluate(() => {
    window.e2eToasts = []
    new MutationObserver(() => {
      if (!el.toast.hidden) window.e2eToasts.push(el.toast.textContent)
    }).observe(el.toast, { childList: true, characterData: true, subtree: true, attributes: true })
  })
  const queueBefore = await A.evaluate(() => dj.engine.queue().queue.length)
  assert.equal(await A.evaluate(() => state.meta.music.search), false, 'arama varsayılan kapalı')
  await A.fill('#composer-input', '/çal lobi şarkısı')
  await A.keyboard.press('Enter')
  await A.waitForFunction(() => window.e2eToasts.indexOf('Şarkı adıyla arama bu sunucuda kapalı. YouTube bağlantısını yapıştırın.') !== -1, null, { timeout: h.LONG })
  await A.waitForFunction(() => !document.querySelector('#dj .dj-search').hidden && !document.querySelector('#dj .dj-search-link-row').hidden)
  const miss = await A.evaluate(() => {
    const a = document.querySelector('#dj .dj-search-link')
    return {
      text: document.querySelector('#dj .dj-search-text').textContent,
      link: a.textContent,
      href: a.getAttribute('href'),
      target: a.target,
      rel: a.rel,
      owner: document.querySelector('#dj .dj-search-owner').hidden ? '' : document.querySelector('#dj .dj-search-owner').textContent,
      composer: document.getElementById('composer-input').value,
      sent: Array.from(document.querySelectorAll('#message-list .msg-text')).some((n) => n.textContent.indexOf('lobi şarkısı') !== -1)
    }
  })
  assert.deepEqual(miss, {
    text: 'Parçayı YouTube\'da "lobi şarkısı" diye arayıp bağlantısını /çal ile ekleyebilirsiniz.',
    link: 'YouTube\'da Ara',
    href: 'https://www.youtube.com/results?search_query=lobi%20%C5%9Fark%C4%B1s%C4%B1',
    target: '_blank',
    rel: 'noopener noreferrer',
    owner: 'Şarkı adıyla aramayı Ayarlar > Genel > Müzik botu bölümünden açabilirsiniz.',
    composer: '',
    sent: false
  })
  assert.deepEqual(W.searches, [], 'arama kapalıyken sunucu aramadı')
  assert.equal(await A.evaluate(() => dj.engine.queue().queue.length), queueBefore)

  // Sahip aramayı Ayarlar > Genel'den açar: onay penceresi riskleri yeniden gösterir, İptal anahtarı kapalı bırakır
  await A.evaluate(() => openSettings('general'))
  await A.waitForSelector('#set-music-search', { timeout: h.LONG })
  assert.equal(await A.evaluate(() => document.getElementById('set-music-search').checked), false)
  await A.click('#set-music-search')
  await A.waitForSelector('#music-search-dialog', { timeout: h.LONG })
  // İlk odak İptal düğmesindedir
  await A.waitForFunction(() => document.activeElement && document.activeElement.id === 'music-search-cancel', null, { timeout: h.LONG })
  const dialog = await A.evaluate(() => ({
    title: document.querySelector('#music-search-dialog .app-dialog-title').textContent,
    confirm: document.getElementById('music-search-confirm').textContent,
    risk: document.querySelector('#music-search-dialog .lead').textContent.indexOf('Hizmet Şartları') !== -1
  }))
  assert.deepEqual(dialog, { title: 'Şarkı adıyla arama açılsın mı?', confirm: 'Riskleri Okudum, Aramayı Aç', risk: true })
  await A.click('#music-search-cancel')
  await A.waitForFunction(() => !document.getElementById('music-search-dialog'))
  assert.equal(await A.evaluate(() => document.getElementById('set-music-search').checked || state.meta.music.search), false)
  await A.click('#set-music-search')
  await A.click('#music-search-confirm')
  for (const page of [A, B]) await page.waitForFunction(() => state.meta.music.search === true, null, { timeout: h.LONG })
  assert.equal(await A.evaluate(() => document.getElementById('set-music-search').checked), true)
  // Arama açılınca karttaki "arama kapalı" satırı kalkar
  await A.waitForFunction(() => document.querySelector('#dj .dj-search').hidden, null, { timeout: h.LONG })
  await A.evaluate(() => closeSettings())
  await A.waitForFunction(() => !isSettingsOpen())
  // İlk sonuç başlığıyla kuyruğa eklenir, duyuru başlıkla hemen gider
  await A.fill('#composer-input', '/çal lobi şarkısı')
  await A.keyboard.press('Enter')
  await A.waitForFunction(() => window.e2eToasts.indexOf('Kuyruğa eklendi: Lobi Şarkısı (Resmi Video)') !== -1, null, { timeout: h.LONG })
  assert.ok(await A.evaluate(() => window.e2eToasts.indexOf('YouTube\'da aranıyor: lobi şarkısı') !== -1), 'aranıyor bildirimi')
  assert.deepEqual(W.searches, ['lobi şarkısı'])
  for (const page of [A, B]) {
    await page.waitForFunction(() => dj.engine.queue().queue.some((t) => t.videoId === 'D120lobi001' && t.title === 'Lobi Şarkısı (Resmi Video)'), null, { timeout: h.LONG })
    await page.waitForFunction(() => Array.from(document.querySelectorAll('#message-list .msg-dj-text')).some((n) => n.textContent === 'Telsiz DJ kuyruğuna ekledi: Lobi Şarkısı (Resmi Video)'), null, { timeout: h.LONG })
    const link = await page.evaluate(() => {
      const n = Array.from(document.querySelectorAll('#message-list .msg-dj-text')).filter((x) => x.textContent === 'Telsiz DJ kuyruğuna ekledi: Lobi Şarkısı (Resmi Video)')[0]
      return n.closest('.msg-dj').querySelector('.msg-dj-link').href
    })
    assert.equal(link, 'https://www.youtube.com/watch?v=D120lobi001')
  }
  assert.equal(await A.evaluate(() => document.querySelector('#dj .dj-search').hidden), true, 'arama satırı kalktı')
  assert.equal(await A.evaluate(() => dj.titleWatch.filter((w) => !w.sent).length), 0, 'duyuru başlığı beklemedi')
  // İstemciden YouTube'a arama isteği gitmedi (yalnızca gömülü oynatıcı adresleri)
  for (const who of ['deniz', 'ece']) {
    assert.ok(W.yt[who].every((u) => /^https:\/\/www\.youtube-nocookie\.com\//.test(u)), who + ': ' + W.yt[who].join(' '))
  }
  // Sonraki testler boş kuyrukla sürer: eklenen parça kuyruktan çıkarılır
  await A.evaluate(() => {
    const t = dj.engine.queue().queue.filter((x) => x.videoId === 'D120lobi001')[0]
    return dj.engine.remove(t.id)
  })
  for (const page of [A, B]) await page.waitForFunction((n) => dj.engine.queue().queue.length === n, queueBefore, { timeout: h.LONG })
})

// DJ kartındaki arama satırı: görünür mü, metni, YouTube'da Ara bağlantısı ve sahip açıklaması
function searchCard (page) {
  return page.evaluate(() => {
    const box = document.querySelector('#dj .dj-search')
    const row = document.querySelector('#dj .dj-search-link-row')
    return {
      shown: !box.hidden,
      text: box.hidden ? '' : document.querySelector('#dj .dj-search-text').textContent,
      href: box.hidden || row.hidden ? null : document.querySelector('#dj .dj-search-link').getAttribute('href'),
      owner: !box.hidden && !document.querySelector('#dj .dj-search-owner').hidden
    }
  })
}

// /çal ile arama yazılır ve verilen bildirim beklenir
async function searchAndToast (page, query, toastText) {
  await page.fill('#composer-input', '/çal ' + query)
  await page.keyboard.press('Enter')
  await page.waitForFunction((text) => window.e2eToasts.indexOf(text) !== -1, toastText, { timeout: h.LONG })
}

function searchPage (query) {
  return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query)
}

test('/çal şarkı adı hataları: arama yapılamazsa ve sonuç yoksa kartta bağlantı, sınır ve ağ hataları açık metinle, eski aramanın yanıtı kartı değiştirmez', async () => {
  const { A } = W
  assert.equal(await A.evaluate(() => state.meta.music.search), true, 'arama önceki testte açıldı')
  await A.evaluate(() => {
    window.e2eToasts = []
  })
  const queueBefore = await A.evaluate(() => dj.engine.queue().queue.length)
  const searchesBefore = W.searches.length

  // Sunucu YouTube'a ulaşamadı (502 search_failed): hata metni ve kartta YouTube'da Ara bağlantısı
  await searchAndToast(A, 'arıza şarkısı', 'YouTube araması şu anda yapılamadı. Biraz sonra yeniden deneyin ya da bağlantıyı yapıştırın.')
  await A.waitForFunction(() => !document.querySelector('#dj .dj-search-link-row').hidden, null, { timeout: h.LONG })
  assert.deepEqual(await searchCard(A), {
    shown: true,
    text: 'Parçayı YouTube\'da "arıza şarkısı" diye arayıp bağlantısını /çal ile ekleyebilirsiniz.',
    href: searchPage('arıza şarkısı'),
    owner: false
  })

  // Çalınabilir sonuç yok: sorguyu anan metin ve yeni sorgunun bağlantısı
  await searchAndToast(A, 'olmayan şarkı', '"olmayan şarkı" için çalınabilir bir sonuç bulunamadı.')
  await A.waitForFunction((href) => document.querySelector('#dj .dj-search-link').getAttribute('href') === href, searchPage('olmayan şarkı'), { timeout: h.LONG })
  assert.deepEqual(await searchCard(A), {
    shown: true,
    text: 'Parçayı YouTube\'da "olmayan şarkı" diye arayıp bağlantısını /çal ile ekleyebilirsiniz.',
    href: searchPage('olmayan şarkı'),
    owner: false
  })
  assert.deepEqual(W.searches.slice(searchesBefore), ['arıza şarkısı', 'olmayan şarkı'])

  // Sunucunun sınır yanıtları ve ağ hatası (yanıtlar bu sayfada taklit edilir)
  const fakeReplies = {
    'çok sık': { status: 429, body: { code: 'rate_limited', error: 'x' } },
    'günlük sınır': { status: 429, body: { code: 'search_daily_limit', error: 'x' } }
  }
  const held = {}
  await A.route('**/api/music/search', async (route) => {
    const q = JSON.parse(route.request().postData()).q
    if (q === 'kopuk bağlantı') {
      await route.abort()
      return
    }
    if (q === 'yavaş bir' || q === 'yavaş iki') {
      await new Promise((resolve) => {
        held[q] = resolve
      })
      const reply = held[q + ':reply']
      await route.fulfill({ status: reply.status, contentType: 'application/json', body: JSON.stringify(reply.body) })
      return
    }
    const fake = fakeReplies[q]
    await route.fulfill({ status: fake.status, contentType: 'application/json', body: JSON.stringify(fake.body) })
  })
  try {
    // Kullanıcı başına sınır: bağlantı gösterilmez (bir dakika sonra yeniden denenebilir)
    await searchAndToast(A, 'çok sık', 'Çok sık arama yapıldı. Bir dakika sonra yeniden deneyin.')
    await A.waitForFunction(() => document.querySelector('#dj .dj-search').hidden, null, { timeout: h.LONG })
    // Sunucu geneli 24 saatlik sınır: bağlantı gösterilir
    await searchAndToast(A, 'günlük sınır', 'Bu sunucunun son 24 saatlik arama sınırı doldu. YouTube bağlantısını yapıştırın.')
    await A.waitForFunction(() => !document.querySelector('#dj .dj-search-link-row').hidden, null, { timeout: h.LONG })
    assert.equal((await searchCard(A)).href, searchPage('günlük sınır'))
    // Sunucuya ulaşılamadı
    await searchAndToast(A, 'kopuk bağlantı', 'Sunucuya ulaşılamadı. Bağlantınızı kontrol edin.')
    await A.waitForFunction(() => document.querySelector('#dj .dj-search').hidden, null, { timeout: h.LONG })

    // Aynı anda iki arama: ilkinin yanıtı ikincinin "aranıyor" satırını kaldırmaz, kart son aramayı gösterir
    held['yavaş bir:reply'] = { status: 502, body: { code: 'search_failed', error: 'x' } }
    held['yavaş iki:reply'] = { status: 200, body: { results: [] } }
    await A.fill('#composer-input', '/çal yavaş bir')
    await A.keyboard.press('Enter')
    await A.fill('#composer-input', '/çal yavaş iki')
    await A.keyboard.press('Enter')
    await h.until(() => held['yavaş bir'] && held['yavaş iki'], h.LONG, 'iki arama da sunucuya gitti')
    await A.waitForFunction(() => document.querySelector('#dj .dj-search-text').textContent === 'YouTube\'da aranıyor: yavaş iki', null, { timeout: h.LONG })
    await A.evaluate(() => {
      window.e2eToasts = []
    })
    held['yavaş bir']()
    await A.waitForFunction(() => window.e2eToasts.indexOf('YouTube araması şu anda yapılamadı. Biraz sonra yeniden deneyin ya da bağlantıyı yapıştırın.') !== -1, null, { timeout: h.LONG })
    await h.sleep(200)
    assert.deepEqual(await searchCard(A), { shown: true, text: 'YouTube\'da aranıyor: yavaş iki', href: null, owner: false }, 'ilk aramanın hatası kartı değiştirmedi')
    held['yavaş iki']()
    await A.waitForFunction(() => window.e2eToasts.indexOf('"yavaş iki" için çalınabilir bir sonuç bulunamadı.') !== -1, null, { timeout: h.LONG })
    await A.waitForFunction(() => !document.querySelector('#dj .dj-search-link-row').hidden, null, { timeout: h.LONG })
    assert.deepEqual(await searchCard(A), {
      shown: true,
      text: 'Parçayı YouTube\'da "yavaş iki" diye arayıp bağlantısını /çal ile ekleyebilirsiniz.',
      href: searchPage('yavaş iki'),
      owner: false
    })
  } finally {
    await A.unroute('**/api/music/search')
  }
  assert.equal(await A.evaluate(() => dj.engine.queue().queue.length), queueBefore, 'kuyruk değişmedi')
  assert.deepEqual(W.searches.slice(searchesBefore), ['arıza şarkısı', 'olmayan şarkı'], 'taklit edilen yanıtlar sunucuya gitmedi')
  // Sonraki testler için kart temizlenir: başarılı arama satırı kaldırır (sonuç önbellekten gelir)
  await searchAndToast(A, 'lobi şarkısı', 'Kuyruğa eklendi: Lobi Şarkısı (Resmi Video)')
  await A.waitForFunction(() => document.querySelector('#dj .dj-search').hidden, null, { timeout: h.LONG })
  await A.evaluate(() => {
    const t = dj.engine.queue().queue.filter((x) => x.videoId === 'D120lobi001')[0]
    return dj.engine.remove(t.id)
  })
  for (const page of [A, W.B]) await page.waitForFunction((n) => dj.engine.queue().queue.length === n, queueBefore, { timeout: h.LONG })
})

test('Ayarlar açılınca YouTube oynatıcısı köşeye alınır, çalmaya devam eder, kapanınca yerine döner', async () => {
  const { A } = W
  await fakePlaying(A, 'A çalıyor')
  // Çerçeve yeniden yüklenirse bu işaret kaybolur
  const frame = A.frames().find((f) => f.url().startsWith('https://www.youtube-nocookie.com/embed/'))
  await frame.evaluate(() => {
    window.e2eMark = 'ilk'
  })
  await A.evaluate(() => openSettings())
  await A.waitForFunction(() => isSettingsOpen() && !document.getElementById('settings-view').hidden)
  await A.waitForFunction(() => document.getElementById('dj').classList.contains('is-docked'))
  await h.sleep(3000)
  await fakePlaying(A, 'Ayarlar açıkken çalıyor')
  const info = await dockInfo(A)
  assertDocked(info)
  assert.equal(info.status, 'playing')
  assert.equal(info.toggleLabel, 'Duraklat')
  assert.equal(info.openLabel, 'Telsiz DJ kartını aç')
  assert.equal(info.title, 'Fake video D120aaaaaaa')
  // Kısa bildirim köşedeki oynatıcının üstüne çıkar, çerçeveyi örtmez
  const toastFree = await A.evaluate(() => {
    toast(() => 'deneme', 'ok', 5000)
    const tr = el.toast.getBoundingClientRect()
    const box = document.querySelector('#dj .dj-yt').getBoundingClientRect()
    return !el.toast.hidden && tr.height > 0 && (tr.bottom <= box.top || tr.right <= box.left)
  })
  assert.equal(toastFree, true, 'kısa bildirim oynatıcının dışında')
  // Köşedeki oynatıcı odağı almaz, Ayarlar'ın odak tuzağı çalışır
  assert.equal(await A.evaluate(() => document.getElementById('settings-view').contains(document.activeElement)), true)
  await A.keyboard.press('Tab')
  assert.equal(await A.evaluate(() => document.getElementById('settings-view').contains(document.activeElement)), true)
  await A.keyboard.press('Escape')
  await A.waitForFunction(() => !isSettingsOpen())
  await A.waitForFunction(() => {
    const d = document.getElementById('dj')
    return !d.hidden && !d.classList.contains('is-docked') && document.getElementById('app-view').getAttribute('data-dj-col') === 'on'
  })
  const back = await A.evaluate(() => {
    const f = document.querySelector('#dj .dj-yt iframe.dj-youtube-frame')
    const r = f.getBoundingClientRect()
    const card = document.getElementById('dj-card').getBoundingClientRect()
    return { inCard: r.left >= card.left && r.right <= card.right && r.top >= card.top, center: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === f, bar: document.querySelector('#dj .dj-dock').getClientRects().length, stack: getComputedStyle(document.getElementById('app-view')).zIndex }
  })
  assert.deepEqual(back, { inCard: true, center: true, bar: 0, stack: '1' })
  await h.sleep(1000)
  await fakePlaying(A, 'Ayarlar kapanınca çalıyor')
  assert.equal((await fakeState(A)).mark, 'ilk', 'çerçeve yeniden yüklenmedi')
  // Kartın yanında açılan emoji seçici oynatıcıyı örtmez: kart yerinde kalır. Durum menüsü üstüne gelirse
  // oynatıcı köşeye alınır. İki durumda da müzik çalmaya devam eder.
  await A.click('#btn-emoji')
  await A.waitForFunction(() => Boolean(findLayer('emoji')))
  await h.sleep(1500)
  assert.deepEqual(await A.evaluate(() => ({ docked: dj.docked, hidden: dj.engine.snapshot().player.hidden })), { docked: false, hidden: false })
  await fakePlaying(A, 'emoji seçici açıkken çalıyor')
  await A.keyboard.press('Escape')
  await A.click('#me-button')
  await A.waitForFunction(() => Boolean(findLayer('status-menu')))
  await h.sleep(1500)
  assert.equal(await A.evaluate(() => dj.engine.snapshot().player.hidden), false)
  await fakePlaying(A, 'durum menüsü açıkken çalıyor')
  await A.keyboard.press('Escape')
  await A.waitForFunction(() => !findLayer('status-menu') && !dj.docked)
})

// Kurtarma kodu penceresi (41-kurtarma.js) "kaydettim" onayı olmadan kapanmaz (kilitli katman). Köşedeki oynatıcı
// pencerenin de üstünde durur: kartı açan düğmesi pencereyi ve Ayarlar'ı kapatmaz, odağı pencereye geri verir. Kartı
// gösteren öteki yol (djReveal: /kuyruk, arama sonucu, telsiz kartındaki Telsiz DJ düğmesi) telefonda DJ sayfasını
// açardı, sayfa açılışı da alttaki katmanları odağı geri vermeden kapattığı için pencereyi kapatırdı.
test('kurtarma kodu penceresi açıkken köşedeki oynatıcının kartı açan düğmesi ve DJ sayfası pencereyi kapatmaz', async () => {
  const { A } = W
  await A.evaluate(() => openSettings('account', null))
  await A.waitForSelector('#set-recovery-section')
  await A.waitForFunction(() => dj.docked === true, null, { timeout: h.LONG })
  await A.click('#set-recovery-create')
  await A.waitForSelector('#set-recovery-form:not([hidden])')
  await A.fill('#set-recovery-password', 'parola-deniz-1')
  await A.click('#set-recovery-submit')
  await A.waitForSelector('#recovery-code-dialog #recovery-dialog-code', { timeout: h.LONG })
  const open = () => A.evaluate(() => ({
    layers: layers.map((l) => l.name + (l.locked ? '(kilitli)' : '')),
    settings: isSettingsOpen(),
    focusIn: document.getElementById('recovery-code-dialog').contains(document.activeElement)
  }))
  const locked = { layers: ['settings', 'app-dialog(kilitli)'], settings: true, focusIn: true }
  assert.deepEqual(await open(), locked)
  assert.equal(await h.reachable(A, '#dj .dj-dock-open'), true, 'kartı açan düğme pencerenin üstünde, basılabilir')
  await A.click('#dj .dj-dock-open')
  await h.sleep(500)
  assert.deepEqual(await open(), locked, 'DJ kartını açan düğme pencereyi kapatmadı, odak pencerede')
  // Telefonda kart sayfada açılır: kendiliğinden gösterme (djReveal) sayfayı açmaz
  await A.setViewportSize({ width: 390, height: 844 })
  await A.waitForFunction(() => document.getElementById('dj').classList.contains('is-sheet-mode'))
  await A.evaluate(() => djReveal(null))
  await h.sleep(500)
  assert.deepEqual(await open(), locked, 'DJ sayfası açılmadı, pencere kapanmadı')
  await A.setViewportSize({ width: 1440, height: 900 })
  await A.waitForFunction(() => !document.getElementById('dj').classList.contains('is-sheet-mode'))
  // Onaydan sonra pencere kapanır, Ayarlar kapanınca oynatıcı yerine döner
  await A.check('#recovery-dialog-saved')
  await A.click('#recovery-dialog-continue')
  await A.waitForSelector('#recovery-code-dialog', { state: 'detached' })
  await A.keyboard.press('Escape')
  await A.waitForFunction(() => !isSettingsOpen())
  await A.waitForFunction(() => !dj.docked)
  await fakePlaying(A, 'pencere ve Ayarlar kapanınca çalıyor')
})

test('telefon 390: DJ sayfası kapalıyken oynatıcı köşede çalar, DJ\'yi aç sayfayı açar', async () => {
  const { A } = W
  await A.setViewportSize({ width: 390, height: 844 })
  await A.waitForFunction(() => {
    const d = document.getElementById('dj')
    return d.classList.contains('is-sheet-mode') && d.classList.contains('is-dock-only') && !d.classList.contains('is-open')
  })
  await h.sleep(2000)
  await fakePlaying(A, '390 köşede çalıyor')
  assertDocked(await dockInfo(A))
  assert.ok(await h.overflowX(A) <= 0, 'yatay taşma')
  // Kapalı sayfanın kartı görünmez ve odaklanamaz, yalnızca oynatıcı ve çubuğu görünür
  const card = await A.evaluate(() => ({
    vis: getComputedStyle(document.getElementById('dj-card')).visibility,
    dialog: document.getElementById('dj').getAttribute('role'),
    composerFree: document.querySelector('#dj .dj-dock').getBoundingClientRect().bottom <= document.getElementById('composer').getBoundingClientRect().top + 0.5
  }))
  assert.deepEqual(card, { vis: 'hidden', dialog: null, composerFree: true })
  await A.click('#dj .dj-dock-open')
  await A.waitForFunction(() => {
    const d = document.getElementById('dj')
    return d.classList.contains('is-open') && !d.classList.contains('is-docked') && d.getAttribute('role') === 'dialog'
  })
  await fakePlaying(A, 'DJ sayfasında çalıyor')
  await A.keyboard.press('Escape')
  await A.waitForFunction(() => document.getElementById('dj').classList.contains('is-dock-only'))
  await fakePlaying(A, 'sayfa kapanınca köşede çalıyor')
  assert.equal((await fakeState(A)).mark, 'ilk', 'çerçeve yeniden yüklenmedi')
  await A.setViewportSize({ width: 1440, height: 900 })
  await A.waitForFunction(() => !document.getElementById('dj').classList.contains('is-docked'))
})

const VOICE_BUTTONS = ['#btn-camera', '#btn-mute', '#btn-deafen', '#btn-screen', '#voice-leave', '#radio-tools .dj-crew-button']

// Köşedeki oynatıcının köşesi ve çerçevenin her köşeye yakınlığı
function dockCorner (page) {
  return page.evaluate(() => {
    const d = document.getElementById('dj')
    const r = document.querySelector('#dj .dj-float').getBoundingClientRect()
    const vw = document.documentElement.clientWidth
    const vh = window.innerHeight
    return { attr: d.getAttribute('data-dock'), left: r.left < vw / 2, top: r.top + r.height / 2 < vh / 2, stored: localStorage.getItem('telsiz.djDock') }
  })
}

test('1100x800: oynatıcı sağ üstte durur, Taşı köşeleri dolaşır, hiçbir köşede ses düğmelerini örtmez', async () => {
  const { A } = W
  await A.setViewportSize({ width: 1100, height: 800 })
  await A.waitForFunction(() => {
    const d = document.getElementById('dj')
    return d.classList.contains('is-dock-only') && d.getAttribute('data-dock') === 'tr'
  })
  await fakePlaying(A, '1100 sağ üstte çalıyor')
  assert.deepEqual(await dockCorner(A), { attr: 'tr', left: false, top: true, stored: null })
  const seen = []
  for (const expected of ['tr', 'br', 'bl', 'tl']) {
    if (expected !== 'tr') {
      await A.click('#dj .dj-dock-move')
      await A.waitForFunction((c) => document.getElementById('dj').getAttribute('data-dock') === c, expected)
      await h.sleep(300)
    }
    seen.push(expected)
    assertDocked(await dockInfo(A))
    for (const sel of VOICE_BUTTONS) assert.equal(await h.reachable(A, sel), true, expected + ' köşesinde ulaşılabilir: ' + sel)
    assert.equal(await h.reachable(A, '#composer-input'), true, expected + ' köşesinde yazma alanı ulaşılabilir')
  }
  assert.deepEqual(seen, ['tr', 'br', 'bl', 'tl'])
  // Taşı düğmesinin erişilebilir adı ve son köşe cihazda saklanır
  assert.equal(await A.getAttribute('#dj .dj-dock-move', 'aria-label'), 'Oynatıcıyı sonraki köşeye taşı')
  assert.equal(await A.evaluate(() => localStorage.getItem('telsiz.djDock')), 'tl')
  await fakePlaying(A, 'köşeler dolaşılınca çalıyor')
  assert.equal((await fakeState(A)).mark, 'ilk', 'çerçeve yeniden yüklenmedi')
  await A.click('#dj .dj-dock-move')
  await A.waitForFunction(() => document.getElementById('dj').getAttribute('data-dock') === 'tr')
})

// Renk masasındaki Joker renk seçicisi ('game-color', 37-renk.js renkOpenPicker) yayın panelinin içindeki bir
// katmandır, ana görünümü örtmez. Açıkken oynatıcı köşesini değiştirmez, telsiz kartının ses düğmelerine inmez.
// Oyun Seç sahneye alınır, seçiciyle aynı adda ve seçeneklerde bir katman masanın içinde açılır.
test('1100x800: oyun masasında renk seçici katmanı açıkken oynatıcı yerinde kalır, ses düğmeleri ulaşılabilir', async () => {
  const { A } = W
  await A.click('#radio-game')
  await A.waitForSelector('#cast[data-mode="game"]:not([hidden])')
  await h.sleep(300)
  const corner = await A.evaluate(() => document.getElementById('dj').getAttribute('data-dock'))
  await A.evaluate(() => {
    const node = h('div', 'renk-picker')
    const pick = h('button', 'renk-pick', 'R')
    pick.type = 'button'
    node.appendChild(pick)
    document.querySelector('#cast .cast-game').appendChild(node)
    window.__colorLayer = {
      name: 'game-color',
      el: node,
      level: 2,
      trap: true,
      outside: true,
      closeOnFocusOut: true,
      initialFocus: () => pick,
      onClose: () => {
        if (node.parentNode) node.parentNode.removeChild(node)
      }
    }
    openLayer(window.__colorLayer)
  })
  try {
    await h.sleep(600)
    const r = await A.evaluate(() => ({ top: topLayer().name, dock: document.getElementById('dj').getAttribute('data-dock') }))
    assert.deepEqual(r, { top: 'game-color', dock: corner })
    assertDocked(await dockInfo(A))
    for (const sel of VOICE_BUTTONS) assert.equal(await h.reachable(A, sel), true, 'renk seçici açıkken ulaşılabilir: ' + sel)
  } finally {
    await A.evaluate(() => closeLayer(window.__colorLayer, false))
  }
  await A.click('#cast [data-focus-key="game-choose-cancel"]')
  await A.waitForFunction(() => document.getElementById('cast').hidden)
  await A.waitForFunction(() => document.getElementById('dj').getAttribute('data-dock') === 'tr')
  await fakePlaying(A, 'oyun masası kapanınca çalıyor')
})

// Ayarlar'ın bir sayfasındaki her denetim ortasına kaydırılınca üstünde başka öğe yok (köşedeki oynatıcı
// örtmüyor). Ulaşılamayan denetimlerin kimlikleri döner.
function unreachableSettings (page) {
  return page.evaluate(() => {
    const main = document.querySelector('#settings-view .settings-main')
    const bad = []
    Array.from(main.querySelectorAll('button, input, select, textarea, a[href]')).filter((n) => n.getClientRects().length && !n.disabled).forEach((n) => {
      n.scrollIntoView({ block: 'center' })
      const b = n.getBoundingClientRect()
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
      const ok = hit && (n.contains(hit) || (n.labels && Array.from(n.labels).some((l) => l.contains(hit))))
      if (!ok) bad.push(n.id || n.className)
    })
    return bad
  })
}

test('1100x800: Ayarlar açıkken oynatıcı alt köşede durur, her satıra ulaşılır, Taşı alt köşeler arasında geçer', async () => {
  const { A } = W
  await A.evaluate(() => {
    storeRemove('telsiz.djDock')
    djRender()
  })
  await A.waitForFunction(() => document.getElementById('dj').getAttribute('data-dock') === 'tr')
  // Seçilen (varsayılan) köşe sağ üst: Ayarlar açıkken kutu aynı yandaki alt köşeye iner
  await A.evaluate(() => openSettings('keybinds'))
  await A.waitForFunction(() => isSettingsOpen() && document.getElementById('dj').getAttribute('data-dock') === 'br')
  for (const cat of ['keybinds', 'privacy', 'notifications', 'appearance', 'voice']) {
    await A.evaluate((c) => openSettings(c), cat)
    await A.waitForFunction((c) => settingsUi.cat === c, cat)
    await h.sleep(300)
    assert.deepEqual(await unreachableSettings(A), [], cat + ' sayfasında her denetime ulaşılır')
  }
  assertDocked(await dockInfo(A))
  await fakePlaying(A, 'Ayarlar açıkken alt köşede çalıyor')
  // Taşı yalnızca alt köşeler arasında geçer, seçilen köşe saklanır
  await A.click('#dj .dj-dock-move')
  await A.waitForFunction(() => document.getElementById('dj').getAttribute('data-dock') === 'bl')
  assert.equal(await A.evaluate(() => localStorage.getItem('telsiz.djDock')), 'bl')
  assert.deepEqual(await unreachableSettings(A), [], 'sol altta da her denetime ulaşılır')
  await A.click('#dj .dj-dock-move')
  await A.waitForFunction(() => document.getElementById('dj').getAttribute('data-dock') === 'br')
  assert.equal(await A.evaluate(() => localStorage.getItem('telsiz.djDock')), 'br')
  // Seçilen üst köşe Ayarlar kapanınca geri gelir
  await A.evaluate(() => {
    storeSet('telsiz.djDock', 'tl')
    djRender()
  })
  await A.waitForFunction(() => document.getElementById('dj').getAttribute('data-dock') === 'bl')
  await A.keyboard.press('Escape')
  await A.waitForFunction(() => !isSettingsOpen() && document.getElementById('dj').getAttribute('data-dock') === 'tl')
  await A.evaluate(() => {
    storeRemove('telsiz.djDock')
    djRender()
  })
  await A.waitForFunction(() => document.getElementById('dj').getAttribute('data-dock') === 'tr')
  assert.equal((await fakeState(A)).mark, 'ilk', 'çerçeve yeniden yüklenmedi')
})

test('orta genişlikte oynatıcı Oda bilgisi düğmesini ve ses düğmelerini örtmez, kısa pencerede görünüm alanında kalır', async () => {
  const { A } = W
  // Varsayılan köşe: sağ üstte yer varsa orası (sohbet başlığının altında), yoksa düğmeleri örtmeyen köşe
  for (const vp of [[800, 1000], [900, 700], [1000, 700], [760, 600]]) {
    await A.setViewportSize({ width: vp[0], height: vp[1] })
    await A.waitForFunction(() => document.getElementById('dj').classList.contains('is-dock-only'))
    await h.sleep(600)
    const corner = await A.evaluate(() => document.getElementById('dj').getAttribute('data-dock'))
    const where = vp.join('x') + ' ' + corner
    if (vp[0] === 800) assert.equal(corner, 'tr', where)
    assertDocked(await dockInfo(A))
    for (const sel of VOICE_BUTTONS.concat(['#btn-room-info', '#composer-input'])) assert.equal(await h.reachable(A, sel), true, where + ' köşesinde ulaşılabilir: ' + sel)
  }
  // Kısa pencerede kutu bandın üstüne çıkar, çerçeve kırpılmaz ve motor oynatıcıyı görünür sayar
  for (const vp of [[1100, 360], [1100, 320], [1100, 300]]) {
    await A.setViewportSize({ width: vp[0], height: vp[1] })
    for (const corner of [null, 'tl']) {
      await A.evaluate((c) => {
        if (c) storeSet('telsiz.djDock', c)
        else storeRemove('telsiz.djDock')
        djRender()
      }, corner)
      await h.sleep(600)
      const info = await dockInfo(A)
      assertDocked(info)
      assert.equal(info.status, 'playing', vp.join('x') + ' ' + corner + ' çalıyor')
    }
  }
  // Sonraki testler 1100x800 testinin bıraktığı seçimle (sağ üst) sürer
  await A.evaluate(() => storeSet('telsiz.djDock', 'tr'))
  await A.setViewportSize({ width: 1100, height: 800 })
  await A.waitForFunction(() => document.getElementById('dj').getAttribute('data-dock') === 'tr')
  await fakePlaying(A, 'kısa pencereden sonra çalıyor')
})

test('fareyle sürüklenen oynatıcı en yakın köşeye oturur, köşe yeniden yüklemeden sonra korunur', async () => {
  const { B } = W
  await B.setViewportSize({ width: 1100, height: 800 })
  await B.waitForFunction(() => document.getElementById('dj').classList.contains('is-dock-only'))
  const title = await B.evaluate(() => {
    const r = document.querySelector('#dj .dj-dock-title').getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
  await B.mouse.move(title.x, title.y)
  await B.mouse.down()
  await B.mouse.move(title.x - 300, title.y + 150, { steps: 6 })
  // Sürüklenirken kutu imleci izler ve görünüm alanında kalır
  const during = await B.evaluate(() => {
    const r = document.querySelector('#dj .dj-float').getBoundingClientRect()
    return { dragging: document.querySelector('#dj .dj-float').classList.contains('is-dragging'), inView: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight }
  })
  assert.deepEqual(during, { dragging: true, inView: true })
  await B.mouse.move(80, 700, { steps: 6 })
  await B.mouse.up()
  await B.waitForFunction(() => document.getElementById('dj').getAttribute('data-dock') === 'bl')
  assert.deepEqual(await dockCorner(B), { attr: 'bl', left: true, top: false, stored: 'bl' })
  assertDocked(await dockInfo(B))
  await B.reload({ waitUntil: 'domcontentloaded' })
  await B.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  await h.joinVoice(B, W.lobi.id)
  await B.waitForFunction(() => {
    const d = document.getElementById('dj')
    return d.classList.contains('is-docked') && d.getAttribute('data-dock') === 'bl'
  }, null, { timeout: h.LONG })
  await fakePlaying(B, 'yeniden yüklemeden sonra sol altta çalıyor')
  assertDocked(await dockInfo(B))
  await B.evaluate(() => localStorage.removeItem('telsiz.djDock'))
  await B.setViewportSize({ width: 1440, height: 900 })
  await B.waitForFunction(() => !document.getElementById('dj').classList.contains('is-docked'))
})

test('Küçült: YouTube yalnızca bu cihazda duraklar ve yalnızca çubuk kalır, Göster ile odayla eşitlenip sürer', async () => {
  const { A, B } = W
  await A.waitForFunction(() => document.getElementById('dj').classList.contains('is-dock-only'))
  await A.click('#dj .dj-dock-min')
  await A.waitForFunction(() => document.getElementById('dj').classList.contains('is-dock-min'))
  await h.until(async () => {
    const st = await fakeState(A)
    return st && st.paused
  }, h.LONG, 'A küçültülünce duraklar')
  const min = await A.evaluate(() => ({
    yt: document.querySelector('#dj .dj-yt').getClientRects().length,
    bar: document.querySelector('#dj .dj-dock').getBoundingClientRect().height > 0,
    label: document.querySelector('#dj .dj-dock-min').getAttribute('aria-label'),
    toggle: document.querySelector('#dj .dj-dock-toggle').getAttribute('aria-label'),
    held: document.querySelector('#dj .dj-dock').classList.contains('is-held'),
    holds: dj.engine.snapshot().player.localHold,
    playing: dj.engine.snapshot().session.playing
  }))
  assert.deepEqual(min, { yt: 0, bar: true, label: 'Göster', toggle: 'Bu Cihazda Devam Et', held: true, holds: ['minimized'], playing: true })
  // Odadaki diğer kişi dinlemeye devam eder
  await fakePlaying(B, 'B çalmaya devam ediyor')
  for (const sel of VOICE_BUTTONS) assert.equal(await h.reachable(A, sel), true, 'küçükken ulaşılabilir: ' + sel)
  await A.click('#dj .dj-dock-min')
  await A.waitForFunction(() => !document.getElementById('dj').classList.contains('is-dock-min') && dj.engine.snapshot().player.localHold.length === 0)
  await fakePlaying(A, 'Göster ile yeniden çalıyor')
  const drift = await A.evaluate(() => {
    const s = dj.engine.snapshot()
    return Math.abs(s.player.positionMs - s.session.positionMs)
  })
  assert.ok(drift <= 2500, 'odayla eşitlendi: ' + drift + ' ms')
  assertDocked(await dockInfo(A))
  // Küçükken çubuğun Bu Cihazda Devam Et düğmesi odayı duraklatmaz: oynatıcıyı açar ve bu cihazda sürdürür
  await A.click('#dj .dj-dock-min')
  await A.waitForFunction(() => document.getElementById('dj').classList.contains('is-dock-min') && dj.engine.snapshot().player.localHold.indexOf('minimized') !== -1)
  await A.click('#dj .dj-dock-toggle')
  await A.waitForFunction(() => !document.getElementById('dj').classList.contains('is-dock-min') && dj.engine.snapshot().player.localHold.length === 0)
  await fakePlaying(A, 'çubuğun düğmesiyle yeniden çalıyor')
  await h.sleep(1500)
  assert.equal(await B.evaluate(() => dj.engine.snapshot().session.playing), true, 'oda duraklatılmadı')
  await fakePlaying(B, 'B çalmaya devam ediyor')
  const back = await dockInfo(A)
  assertDocked(back)
  assert.equal(back.toggleLabel, 'Duraklat')
  await A.setViewportSize({ width: 1440, height: 900 })
  await A.waitForFunction(() => !document.getElementById('dj').classList.contains('is-docked'))
})

test('masaüstü: pencere simge durumuna küçültülünce YouTube bu cihazda duraklar, geri gelince odayla eşitlenip sürer', async () => {
  const { A, B } = W
  await fakePlaying(A, 'A çalıyor')
  // Masaüstü uygulamasının pencere durumu kanalı (20-desktop.js window.telsizDesktop.onWindowState) taklit edilir
  await A.evaluate(() => {
    window.telsizDesktop = {
      onWindowState (cb) {
        window.e2eWindowState = cb
        return () => {}
      }
    }
    djWatchWindowState()
  })
  await A.waitForFunction(() => {
    const n = document.querySelector('#dj .dj-bg-note')
    return n && !n.hidden && n.textContent === 'YouTube parçaları uygulama arka plandayken çalmaz, ses dosyaları çalar.'
  })
  await A.evaluate(() => window.e2eWindowState('minimized'))
  await h.until(async () => {
    const st = await fakeState(A)
    return st && st.paused
  }, h.LONG, 'küçültülünce duraklar')
  const away = await A.evaluate(() => ({ holds: dj.engine.snapshot().player.localHold, playing: dj.engine.snapshot().session.playing, alert: document.querySelector('#dj .dj-alert-text').textContent }))
  assert.deepEqual(away, { holds: ['window'], playing: true, alert: 'YouTube parçası pencere görünür olunca başlar.' })
  await fakePlaying(B, 'B çalmaya devam ediyor')
  await A.evaluate(() => window.e2eWindowState('restored'))
  await A.waitForFunction(() => dj.engine.snapshot().player.localHold.length === 0)
  await fakePlaying(A, 'geri gelince çalıyor')
  const drift = await A.evaluate(() => {
    const s = dj.engine.snapshot()
    return Math.abs(s.player.positionMs - s.session.positionMs)
  })
  assert.ok(drift <= 2500, 'odayla eşitlendi: ' + drift + ' ms')
  // Tepsiye gizleme ve tepsiden dönüş de aynı kuralı izler
  await A.evaluate(() => window.e2eWindowState('hidden'))
  await A.waitForFunction(() => dj.engine.snapshot().player.localHold.indexOf('window') !== -1)
  await A.evaluate(() => window.e2eWindowState('shown'))
  await A.waitForFunction(() => dj.engine.snapshot().player.localHold.length === 0)
  await fakePlaying(A, 'tepsiden dönünce çalıyor')
  await A.evaluate(() => {
    delete window.telsizDesktop
  })
})

test('Yüzen Oynatıcı: kart sütundayken de oynatıcı köşede, kart görünür kalır, kapatınca yerine döner', async () => {
  const { A } = W
  await A.waitForFunction(() => document.getElementById('app-view').getAttribute('data-dj-col') === 'on')
  assert.equal(await A.textContent('#dj .dj-float-switch .dj-mute-label'), 'Yüzen Oynatıcı')
  assert.equal(await A.getAttribute('#dj .dj-float-switch', 'aria-checked'), 'false')
  await A.click('#dj .dj-float-switch')
  await A.waitForFunction(() => {
    const d = document.getElementById('dj')
    return d.classList.contains('is-docked') && d.classList.contains('is-dock-float')
  })
  const info = await A.evaluate(() => ({
    checked: document.querySelector('#dj .dj-float-switch').getAttribute('aria-checked'),
    stored: localStorage.getItem('telsiz.djFloat'),
    cardVisible: getComputedStyle(document.getElementById('dj-card')).visibility,
    title: document.querySelector('#dj .dj-title').getClientRects().length > 0
  }))
  assert.deepEqual(info, { checked: 'true', stored: '1', cardVisible: 'visible', title: true })
  assertDocked(await dockInfo(A))
  await fakePlaying(A, 'yüzen oynatıcı çalıyor')
  await A.click('#dj .dj-float-switch')
  await A.waitForFunction(() => !document.getElementById('dj').classList.contains('is-docked'))
  assert.equal(await A.evaluate(() => localStorage.getItem('telsiz.djFloat')), '0')
  await fakePlaying(A, 'kart içinde çalıyor')
  assert.equal((await fakeState(A)).mark, 'ilk', 'çerçeve yeniden yüklenmedi')
})

test('mesajdaki ses dosyası DJ\'de çal ile kuyruğa eklenir, atlayınca iki istemcide dosya çalar', async () => {
  const { A, B } = W
  const E = W.w.E
  const wav = h.makeWav(25, 22050)
  const enc = E.encryptFile(new Uint8Array(wav))
  const up = await W.w.call('POST', '/api/uploads', null, W.w.P.mert.token, Buffer.from(enc.box))
  assert.equal(up.status, 200)
  await W.w.say('mert', W.genel, 'lobi teması', [{ u: up.data.id, k: enc.key, n: enc.nonce, kind: 'file', name: 'lobi-temasi.wav', m: 'audio/wav', s: wav.length }], [up.data.id])
  await B.evaluate((id) => selectChannel(id, {}), W.genel.id)
  await B.waitForSelector('#message-list .dj-play-file', { timeout: h.LONG })
  assert.equal(await B.textContent('#message-list .dj-play-file'), 'DJ\'de Çal')
  await B.click('#message-list .dj-play-file')
  await A.waitForFunction(() => document.querySelectorAll('#dj .dj-queue .dj-queue-item').length === 1 && /lobi-temasi/.test(document.querySelector('#dj .dj-queue-name').textContent), null, { timeout: h.LONG })
  // "DJ'de çal" dosyanın bulunduğu yazı odasına adıyla duyurulur
  await B.waitForFunction(() => Array.from(document.querySelectorAll('#message-list .msg-dj-text')).some((n) => n.textContent === 'Telsiz DJ kuyruğuna dosya ekledi: lobi-temasi.wav'), null, { timeout: h.LONG })
  // Duyuru eki olmayan bir mesajdır: kaynağı 'fileref', metni çevrilmiş tam duyurudur (bu kaynağı bilmeyen
  // eski istemci "Bu ses dosyası" yerine bu metni gösterir)
  const fileNotice = await B.evaluate(() => {
    const n = Array.from(document.querySelectorAll('#message-list .msg-dj-text')).filter((x) => x.textContent === 'Telsiz DJ kuyruğuna dosya ekledi: lobi-temasi.wav')[0]
    const msg = n.closest('.msg')
    const m = state.messages.filter((x) => String(x.id) === msg.getAttribute('data-id'))[0]
    const r = decryptMessage(m)
    return { author: msg.querySelector('.msg-author').textContent, link: Boolean(msg.querySelector('.msg-dj-link')), files: msg.querySelectorAll('.dj-play-file').length, src: r.dj.src, text: r.text }
  })
  assert.deepEqual(fileNotice, { author: 'Ece', link: false, files: 0, src: 'fileref', text: 'Telsiz DJ kuyruğuna dosya ekledi: lobi-temasi.wav' })
  await A.waitForFunction(() => Array.from(document.querySelectorAll('#activity .activity-item.is-dj .activity-text')).some((n) => n.textContent === 'Ece Telsiz DJ kuyruğuna ekledi: lobi-temasi.wav'), null, { timeout: h.LONG })
  await A.click('#dj .dj-skip')
  for (const page of [A, B]) {
    await page.waitForFunction(() => {
      const s = dj.engine.snapshot()
      return s.player.kind === 'file' && s.player.status === 'playing'
    }, null, { timeout: h.LONG })
  }
  const view = await A.evaluate(() => ({ wave: !document.querySelector('#dj .dj-wave').hidden, yt: document.querySelector('#dj .dj-yt').hidden, by: document.querySelector('#dj .dj-by').textContent }))
  assert.equal(view.wave, true)
  assert.equal(view.yt, true)
  assert.match(view.by, /ekleyen: Ece/)
  const fb = await fakeState(B)
  assert.ok(!fb || fb.paused, 'YouTube oynatıcısı dosya çalarken susar')
})

// Dosya parçasının görünürlük koşulu yoktur: Ayarlar açıkken ve dar ekranda sayfa kapalıyken de çalar, köşeye
// alınacak oynatıcı yoktur
test('ses dosyası Ayarlar açıkken ve telefonda DJ sayfası kapalıyken çalmaya devam eder', async () => {
  const { A } = W
  const filePos = () => A.evaluate(() => {
    const s = dj.engine.snapshot()
    return s.player.kind === 'file' && s.player.status === 'playing' && typeof s.player.positionMs === 'number' ? s.player.positionMs : -1
  })
  const advancing = async (label) => {
    const p0 = await filePos()
    assert.ok(p0 >= 0, label + ': dosya çalıyor')
    await h.until(async () => (await filePos()) > p0 + 500, h.SHORT, label)
  }
  await A.evaluate(() => openSettings())
  await A.waitForFunction(() => isSettingsOpen())
  await h.sleep(1500)
  await advancing('Ayarlar açıkken dosya')
  assert.equal(await A.evaluate(() => dj.docked), false)
  await A.evaluate(() => closeSettings())
  await A.setViewportSize({ width: 390, height: 844 })
  await A.waitForFunction(() => document.getElementById('dj').hidden && !dj.docked)
  await h.sleep(1000)
  await advancing('390 sayfa kapalıyken dosya')
  await A.setViewportSize({ width: 1440, height: 900 })
})

test('Yüzen Oynatıcı açıkken dosya parçası köşede dalga biçimi ve çubukla görünür, küçültünce yalnızca çubuk kalır ve çalmaya devam eder', async () => {
  const { A } = W
  const filePos = () => A.evaluate(() => {
    const s = dj.engine.snapshot()
    return s.player.kind === 'file' && s.player.status === 'playing' && typeof s.player.positionMs === 'number' ? s.player.positionMs : -1
  })
  const advancing = async (label) => {
    const p0 = await filePos()
    assert.ok(p0 >= 0, label + ': dosya çalıyor')
    await h.until(async () => (await filePos()) > p0 + 500, h.SHORT, label)
  }
  await A.click('#dj .dj-float-switch')
  await A.waitForFunction(() => document.getElementById('dj').classList.contains('is-docked'))
  const view = await A.evaluate(() => {
    const wave = document.querySelector('#dj .dj-wave').getBoundingClientRect()
    const bar = document.querySelector('#dj .dj-dock').getBoundingClientRect()
    return { wave: wave.height > 0, bar: bar.height > 0 && bar.top >= wave.bottom - 0.5, yt: document.querySelector('#dj .dj-yt').getClientRects().length, title: document.querySelector('#dj .dj-dock-title').textContent }
  })
  assert.deepEqual(view, { wave: true, bar: true, yt: 0, title: 'lobi-temasi.wav' })
  await A.click('#dj .dj-dock-min')
  await A.waitForFunction(() => document.getElementById('dj').classList.contains('is-dock-min'))
  assert.equal(await A.evaluate(() => document.querySelector('#dj .dj-wave').getClientRects().length), 0)
  assert.deepEqual(await A.evaluate(() => dj.engine.snapshot().player.localHold), [])
  await advancing('küçültülmüş dosya')
  await A.click('#dj .dj-dock-min')
  await A.click('#dj .dj-float-switch')
  await A.waitForFunction(() => !document.getElementById('dj').classList.contains('is-docked'))
})

test('telefon 390: DJ alt sayfası tam genişlik, yatay taşma yok', async () => {
  const { B } = W
  await B.setViewportSize({ width: 390, height: 844 })
  await B.waitForFunction(() => document.getElementById('dj').classList.contains('is-sheet-mode'))
  await B.click('#radio-tools .crew-dj button')
  await B.waitForFunction(() => {
    const d = document.getElementById('dj')
    if (d.hidden) return false
    const r = d.getBoundingClientRect()
    return Math.round(r.left) === 0 && Math.round(r.width) === 390 && Math.round(r.bottom) === window.innerHeight
  })
  assert.ok(await h.overflowX(B) <= 0, 'yatay taşma')
  await B.keyboard.press('Escape')
  await B.waitForFunction(() => document.getElementById('dj').hidden)
  await B.setViewportSize({ width: 1440, height: 900 })
})

test('ses odasından ayrılınca müzik durur ve köşedeki oynatıcı kalkar', async () => {
  const { A } = W
  await A.fill('#composer-input', '/çal https://youtu.be/D120bbbbbbb')
  await A.keyboard.press('Enter')
  // Dosya hâlâ çalıyorsa geçilir
  await h.until(async () => A.evaluate(() => {
    const q = dj.engine.queue()
    if (q.current && q.current.type === 'file') dj.engine.skip()
    return Boolean(q.current && q.current.type === 'youtube' && q.current.videoId === 'D120bbbbbbb')
  }), h.LONG, 'YouTube parçası çalıyor')
  await fakePlaying(A, 'ikinci YouTube parçası çalıyor')
  await A.evaluate(() => openSettings())
  await A.waitForFunction(() => document.getElementById('dj').classList.contains('is-docked'))
  await fakePlaying(A, 'Ayarlar açıkken çalıyor')
  await A.evaluate(() => leaveVoice())
  await A.waitForFunction(() => {
    const d = document.getElementById('dj')
    return d.hidden && !d.classList.contains('is-docked') && !document.body.classList.contains('has-dj-dock')
  }, null, { timeout: h.LONG })
  await h.until(async () => {
    const st = await fakeState(A)
    return !st || st.paused
  }, h.LONG, 'ayrılınca durdu')
  assert.equal(await A.evaluate(() => document.querySelectorAll('#dj .dj-yt iframe').length), 0, 'oynatıcı kaldırıldı')
  await A.evaluate(() => closeSettings())
})

test('/çal şarkı adı: arama sürerken başka bir ses odasına geçilirse parça hiçbir odaya eklenmez, "aranıyor" satırı yeni odada görünmez', async () => {
  const { A, B } = W
  const oyun = W.w.room('Oyun')
  assert.equal(await A.evaluate(() => state.meta.music.search), true, 'arama önceki testte açıldı')
  await h.joinVoice(A, W.lobi.id)
  await A.waitForFunction((id) => String(dj.voiceRoom) === String(id), W.lobi.id, { timeout: h.LONG })
  await A.evaluate(() => {
    window.e2eToasts = []
  })
  const searchesBefore = W.searches.length
  // Sunucunun yanıtı A kişisi oda değiştirene kadar bekletilir, sonra bir sonuçla verilir
  let release = null
  let sentRoom = null
  await A.route('**/api/music/search', async (route) => {
    sentRoom = JSON.parse(route.request().postData()).channelId
    await new Promise((resolve) => {
      release = resolve
    })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [{ videoId: 'D120oda0001', title: 'Oda Şarkısı', channel: 'Telsiz Kayıtları', durationS: 180 }] }) })
  })
  try {
    await A.fill('#composer-input', '/çal oda şarkısı')
    await A.keyboard.press('Enter')
    await h.until(() => release, h.LONG, 'arama sunucuya gitti')
    assert.equal(String(sentRoom), String(W.lobi.id), 'arama komutun verildiği odayla gitti')
    await A.waitForFunction(() => document.querySelector('#dj .dj-search-text').textContent === 'YouTube\'da aranıyor: oda şarkısı' && !document.querySelector('#dj .dj-search').hidden, null, { timeout: h.LONG })
    // A kişisi Oyun odasına geçer: yeni odanın kartında önceki odanın araması görünmez
    await h.joinVoice(A, oyun.id)
    await A.waitForFunction((id) => String(dj.voiceRoom) === String(id), oyun.id, { timeout: h.LONG })
    await A.waitForFunction(() => document.querySelector('#dj .dj-search').hidden, null, { timeout: h.LONG })
    release()
    await A.waitForFunction(() => window.e2eToasts.indexOf('Arama sürerken ses odası değişti. "oda şarkısı" kuyruğa eklenmedi.') !== -1, null, { timeout: h.LONG })
    await h.sleep(500)
  } finally {
    if (release) release()
    await A.unroute('**/api/music/search')
  }
  const has = () => dj.engine.queue().queue.concat(dj.engine.queue().current ? [dj.engine.queue().current] : []).some((t) => t.videoId === 'D120oda0001')
  assert.equal(await A.evaluate(has), false, 'Oyun odasının kuyruğuna eklenmedi')
  assert.equal(await B.evaluate(has), false, 'Lobi odasının kuyruğuna eklenmedi')
  assert.equal(await A.evaluate(() => window.e2eToasts.some((x) => x.indexOf('Oda Şarkısı') !== -1)), false, 'eklendi bildirimi yok')
  assert.equal(await A.evaluate(() => Array.from(document.querySelectorAll('#message-list .msg-dj-text')).some((n) => n.textContent.indexOf('Oda Şarkısı') !== -1)), false, 'duyuru gitmedi')
  assert.deepEqual(await searchCard(A), { shown: false, text: '', href: null, owner: false })
  assert.deepEqual(W.searches.slice(searchesBefore), [], 'taklit edilen yanıt sunucuya gitmedi')
  await A.evaluate(() => leaveVoice())
  await A.waitForFunction(() => dj.voiceRoom === null, null, { timeout: h.LONG })
})

// İki istemci aynı anda yazınca sunucu sürüm denetimi (CAS) birini 409 ile reddeder, motor yeni durumla
// yeniden dener. Bu protokolün parçasıdır, tarayıcı yanıtı "Failed to load resource" olarak yazar.
const casConflict = (l) => l.type === 'error' && /status of 409/.test(l.text) && /\/api\/music\/state/.test(l.url)
// Arama hataları testi sunucunun 502 ve 429 yanıtlarını ve kopan bağlantıyı bilerek oluşturur
const searchErrors = (l) => l.type === 'error' && /\/api\/music\/search$/.test(l.url || '') && /status of (429|502)|net::ERR_FAILED/.test(l.text)

test('konsol ve sunucu günlüğü temiz', async () => {
  h.assertCleanConsole(W.w.logs, W.w.srv.errors, [casConflict, searchErrors])
})
