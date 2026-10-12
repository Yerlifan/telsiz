'use strict'

// Telsiz DJ başlangıç eşitlemesi (istek 13): iki kullanıcı aynı ses odasında, A /çal ile YouTube parçası
// ekler. YouTube gömmesi page.route ile yerel sahte oynatıcıya (sahte-youtube.js) yönlendirilir, gerçek
// YouTube'a erişilmez. Sahte oynatıcının sesinin ilk başladığı an iki istemcide aynı saatle ölçülür ve en çok
// 250 ms ayrı olmalıdır. Arka plandaki sekme benzetilir (requestAnimationFrame çalışmaz, visibilityState
// hidden): oynatıcı alanı yine de en az 200x200 çizilir, köşeye alınır ve parça A ile birlikte başlar. Rıza
// vermemiş üye odaya katılınca kısa bildirim ve telsiz kartında Yükle düğmeli kalıcı bir uyarı görür. Arka
// plandaki sekmede iki dosya parçası art arda aynı ses öğesinde çalar, kilit ekranının başlığı (Media Session)
// parçayı izler ve gizlilik ayarı kapalıyken boşalır. Kilit ekranının ve medya tuşlarının Duraklat ve Oynat
// işleyicileri yalnızca bu cihazı bekletir (oda çalmaya devam eder), köşedeki oynatıcının çubuğu bekletmeyi
// gösterir ve düğmesi odayı duraklatmadan bekletmeyi kaldırır, bekletme ses odasından çıkınca kalkar.
// Kendiliğinden biten parçanın adı karttaki son işlem satırında ve Bildirimler kaydında kalır. Kalıcı çerçeve
// (istek 13, ikinci aşama): sonraki YouTube parçası aynı çerçevede hazırlanır (yeni çerçeve kurulmaz, sekmede
// açılan sahte oynatıcı sayısı 1 kalır), iki istemci yine en çok 250 ms farkla başlar, parçanın adı yeni videodan
// gelir. Rıza geri alınınca çerçeve kalkar, yeniden verilince yeni çerçeve kurulur.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const h = require('./yardimci')

// Sahte oynatıcıya sesin başladığı anları video kimliğiyle kaydeden ek (aynı makinedeki iki sayfa aynı saati
// okur, kalıcı çerçevede aynı belge birden çok videoyu çalar)
const FAKE_JS = fs.readFileSync(path.join(__dirname, 'sahte-youtube.js'), 'utf8') +
  '\n;(function () { var F = window.FAKE; F.playLog = []; F.audio.addEventListener("playing", function () { F.playLog.push({ id: F.videoId, at: Date.now() }) }) })()\n'
const YT_HOST_RE = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|googlevideo\.com|doubleclick\.net|google\.com|gstatic\.com|googleapis\.com)(:\d+)?\//i
const EMBED_HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#111"><script src="/fake/embed.js"></script></body></html>'
const CONSENT = { 'telsiz.djYoutubeConsent': '1' }
const SYNC_MS = 250

const W = { w: null, A: null, B: null, lobi: null }
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []), { browsers: ['chromium'], reason: 'sahte medya aygıtı yalnızca Chromium bayraklarıyla' })

function routeYouTube () {
  return async (context) => {
    await context.route(YT_HOST_RE, async (route) => {
      const url = new URL(route.request().url())
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

// Sahte oynatıcısında videoId hazırlanmış çerçeve. Kalıcı çerçevenin adresi ilk videonun kimliğini taşır, bu
// yüzden çerçeve adresine göre değil sahte oynatıcının o anki videosuna göre bulunur.
async function fakeFrame (page, videoId) {
  for (const f of page.frames()) {
    if (!f.url().startsWith('https://www.youtube-nocookie.com/embed/')) continue
    try {
      if (await f.evaluate(() => (window.FAKE ? window.FAKE.videoId : null)) === videoId) return f
    } catch (err) {
      // Çerçeve kapanıyor
    }
  }
  return null
}

// videoId videosunun sesi n. kez başladığında sayfanın saatiyle o an (ms)
async function nthPlay (page, videoId, n, label) {
  return h.until(async () => {
    const frame = await fakeFrame(page, videoId)
    if (!frame) return null
    try {
      return await frame.evaluate((a) => {
        const list = window.FAKE.playLog.filter((x) => x.id === a.id)
        return list.length >= a.n ? list[a.n - 1].at : null
      }, { id: videoId, n })
    } catch (err) {
      return null
    }
  }, h.LONG, label)
}

// videoId videosunun sesi ilk başladığında sayfanın saatiyle o an (ms)
function firstPlay (page, videoId, label) {
  return nthPlay(page, videoId, 1, label)
}

async function addTrack (page, videoId) {
  await page.fill('#composer-input', '/çal https://youtu.be/' + videoId)
  await page.keyboard.press('Enter')
}

// Sahte oynatıcı çalıyor (videoId parçası) veya duraklatıldı
async function fakePaused (page, videoId, paused, label) {
  await h.until(async () => {
    const frame = await fakeFrame(page, videoId)
    if (!frame) return false
    try {
      return await frame.evaluate((p) => Boolean(window.FAKE) && window.FAKE.audio.paused === p && (p || window.FAKE.state === 1), paused)
    } catch (err) {
      return false
    }
  }, h.LONG, label)
}

// Çalan parçayı durdurur, sıradaki eklemede oturum yeniden başlar
async function stopMusic (page) {
  await page.fill('#composer-input', '/dur')
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => !dj.engine.queue().current, null, { timeout: h.LONG })
}

before(async () => {
  if (test.skipped) return
  W.w = await h.setupWorld({ slot: 39 })
  W.lobi = W.w.room('Lobi')
  W.A = await W.w.pageFor('deniz', { route: routeYouTube(), extra: CONSENT })
  W.B = await W.w.pageFor('ece', { route: routeYouTube(), extra: CONSENT })
})

after(async () => {
  if (W.w) await W.w.close()
})

test('iki istemci YouTube parçasını en çok 250 ms farkla başlatır, duyuru 8 saniye içinde parçanın adını taşır', async () => {
  const { A, B } = W
  for (const page of [A, B]) await h.joinVoice(page, W.lobi.id)
  // B'nin gördüğü bütün DJ duyuru metinleri kaydedilir
  await B.evaluate(() => {
    window.e2eNotices = []
    new MutationObserver(() => {
      document.querySelectorAll('#message-list .msg-dj-text').forEach((n) => {
        if (window.e2eNotices.indexOf(n.textContent) === -1) window.e2eNotices.push(n.textContent)
      })
    }).observe(document.getElementById('message-list'), { childList: true, subtree: true, characterData: true })
  })
  const t0 = Date.now()
  await addTrack(A, 'D120aaaaaaa')
  const a = await firstPlay(A, 'D120aaaaaaa', 'A başladı')
  const b = await firstPlay(B, 'D120aaaaaaa', 'B başladı')
  assert.ok(Math.abs(a - b) <= SYNC_MS, 'başlangıç farkı ' + (b - a) + ' ms')
  // Oynatıcılar adı hemen bildirir: duyuru adsız gitmez, adla gider
  await B.waitForFunction(() => window.e2eNotices.indexOf('Telsiz DJ kuyruğuna ekledi: Fake video D120aaaaaaa') !== -1, null, { timeout: h.LONG })
  assert.ok(Date.now() - t0 < 8000 + 2000, 'duyuru ' + (Date.now() - t0) + ' ms sonra geldi')
  assert.deepEqual(await B.evaluate(() => window.e2eNotices), ['Telsiz DJ kuyruğuna ekledi: Fake video D120aaaaaaa'])
})

test('devam ettirme de başlangıç payıyla çapalanır, iki istemci birlikte sürdürür', async () => {
  const { A, B } = W
  await B.click('#dj .dj-toggle')
  for (const page of [A, B]) {
    await h.until(async () => {
      const frame = await fakeFrame(page, 'D120aaaaaaa')
      if (!frame) return false
      try {
        return await frame.evaluate(() => Boolean(window.FAKE) && window.FAKE.audio.paused)
      } catch (err) {
        return false
      }
    }, h.LONG, 'duraklatıldı')
  }
  await A.click('#dj .dj-toggle')
  const a = await nthPlay(A, 'D120aaaaaaa', 2, 'A sürdürdü')
  const b = await nthPlay(B, 'D120aaaaaaa', 2, 'B sürdürdü')
  assert.ok(Math.abs(a - b) <= SYNC_MS, 'sürdürme farkı ' + (b - a) + ' ms')
})

test('kalıcı çerçeve: sonraki YouTube parçası aynı çerçevede hazırlanır, iki istemci yine 250 ms içinde başlar, rıza geri alınınca çerçeve kalkar', async () => {
  const { A, B } = W
  const VID1 = 'D120aaaaaaa'
  const VID2 = 'D120ccccccc'
  // Çerçeveler işaretlenir (yeniden yüklenen veya yeni kurulan çerçevede işaret olmaz), oynatıcı alanına
  // eklenen çerçeveler sayılır
  for (const page of [A, B]) {
    await fakePaused(page, VID1, false, 'ilk parça çalıyor')
    await (await fakeFrame(page, VID1)).evaluate(() => {
      window.e2eMark = 'kalici'
    })
    await page.evaluate(() => {
      window.e2eFramesAdded = 0
      new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => {
        if (n.nodeName === 'IFRAME') window.e2eFramesAdded++
      }))).observe(document.querySelector('#dj .dj-yt'), { childList: true, subtree: true })
    })
  }
  await addTrack(A, VID2)
  await A.waitForFunction((v) => dj.engine.queue().queue.some((t) => t.videoId === v), VID2, { timeout: h.LONG })
  await A.evaluate(() => dj.engine.skip())
  const a = await firstPlay(A, VID2, 'A ikinci parçayı başlattı')
  const b = await firstPlay(B, VID2, 'B ikinci parçayı başlattı')
  assert.ok(Math.abs(a - b) <= SYNC_MS, 'ikinci parçada başlangıç farkı ' + (b - a) + ' ms')
  for (const page of [A, B]) {
    const frame = await fakeFrame(page, VID2)
    const info = await frame.evaluate(() => ({
      mark: window.e2eMark || null,
      total: window.FAKE.framesTotal,
      switches: window.FAKE.switches.slice(),
      cue: window.FAKE.received.indexOf('cueVideoById') !== -1,
      path: location.pathname
    }))
    assert.deepEqual(info, { mark: 'kalici', total: 1, switches: [VID2], cue: true, path: '/embed/' + VID1 })
    assert.deepEqual(await page.evaluate(() => ({
      frames: document.querySelectorAll('#dj .dj-yt iframe').length,
      added: window.e2eFramesAdded
    })), { frames: 1, added: 0 })
    // Parçanın adı ve süresi yeni videodan gelir (önceki videonun bilgisi yeni parçaya yazılmaz)
    await page.waitForFunction((v) => {
      const s = dj.engine.snapshot().session
      return s && s.current && s.current.videoId === v && s.current.title === 'Fake video ' + v && s.durationMs === 120000
    }, VID2, { timeout: h.LONG })
  }
  // Rıza geri alınınca çerçeve kalkar, oda çalmaya devam eder
  await B.evaluate(() => dj.engine.setConsent(false))
  await B.waitForFunction(() => document.querySelectorAll('#dj iframe').length === 0, null, { timeout: h.LONG })
  await h.sleep(1000)
  assert.equal(await A.evaluate(() => dj.engine.snapshot().session.playing), true, 'oda çalmaya devam ediyor')
  await fakePaused(A, VID2, false, 'A çalmaya devam ediyor')
  // Yeniden izin verince yeni çerçeve kurulur ve parça ortak konumdan çalar
  await B.evaluate(() => dj.engine.setConsent(true))
  await fakePaused(B, VID2, false, 'izin verince B yeniden dinliyor')
  const again = await (await fakeFrame(B, VID2)).evaluate(() => ({ mark: window.e2eMark || null, total: window.FAKE.framesTotal, path: location.pathname }))
  assert.deepEqual(again, { mark: null, total: 2, path: '/embed/' + VID2 })
})

test('kilit ekranı ve medya tuşları yalnızca bu cihazı bekletir, uyarıdan ve Oynat ile sürer, bekletme odadan çıkınca kalkar', async () => {
  const { A, B } = W
  const VID = 'D120ccccccc'
  await fakePaused(B, VID, false, 'B çalıyor')
  // İşleyiciler kaydedilirken yakalanır: gizlilik ayarı kapatılıp açılınca işleyiciler yeniden kaydedilir
  await B.evaluate(() => localStorage.setItem('telsiz.djMediaSession', '0'))
  await B.waitForFunction(() => navigator.mediaSession.metadata === null)
  await B.evaluate(() => {
    window.e2eMedia = {}
    const ms = navigator.mediaSession
    const set = ms.setActionHandler.bind(ms)
    ms.setActionHandler = (action, fn) => {
      window.e2eMedia[action] = fn
      return set(action, fn)
    }
    localStorage.removeItem('telsiz.djMediaSession')
  })
  await B.waitForFunction(() => typeof window.e2eMedia.play === 'function' && typeof window.e2eMedia.pause === 'function' && navigator.mediaSession.playbackState === 'playing', null, { timeout: h.LONG })
  const holds = (page) => page.evaluate(() => dj.engine.snapshot().player.localHold)
  // Duraklat: yalnızca bu cihaz bekler, odanın durumu değişmez, A dinlemeye devam eder
  await B.evaluate(() => window.e2eMedia.pause())
  await fakePaused(B, VID, true, 'B duraklatıldı')
  const held = await B.evaluate(() => {
    const action = document.querySelector('#dj .dj-alert-action')
    return {
      holds: dj.engine.snapshot().player.localHold,
      playing: dj.engine.snapshot().session.playing,
      action: action.hidden ? null : action.getAttribute('data-action'),
      label: action.textContent,
      text: document.querySelector('#dj .dj-alert-text').textContent,
      state: navigator.mediaSession.playbackState
    }
  })
  assert.deepEqual(held, {
    holds: ['media'],
    playing: true,
    action: 'media',
    label: 'Yeniden Eşitle',
    text: 'Müzik bu cihazda tarayıcı, işletim sistemi veya medya tuşlarıyla durduruldu. Odadaki diğer kişiler dinlemeye devam ediyor.',
    state: 'paused'
  })
  await h.sleep(1500)
  assert.equal(await A.evaluate(() => dj.engine.snapshot().session.playing), true, 'oda çalmaya devam ediyor')
  await fakePaused(A, VID, false, 'A çalmaya devam ediyor')
  // Uyarıdaki Yeniden Eşitle bekletmeyi kaldırır
  await B.click('#dj .dj-alert-action')
  await B.waitForFunction(() => dj.engine.snapshot().player.localHold.length === 0)
  await fakePaused(B, VID, false, 'Yeniden Eşitle ile çalıyor')
  // Oynat da bekletmeyi kaldırır
  await B.evaluate(() => window.e2eMedia.pause())
  await B.waitForFunction(() => dj.engine.snapshot().player.localHold.indexOf('media') !== -1)
  await B.evaluate(() => window.e2eMedia.play())
  await B.waitForFunction(() => dj.engine.snapshot().player.localHold.length === 0)
  await fakePaused(B, VID, false, 'Oynat ile çalıyor')
  // Köşedeki oynatıcıda (Ayarlar açık) kartın uyarı satırı görünmez: çubuk bekletmeyi söner lamba ve Bu Cihazda
  // Devam Et düğmesiyle gösterir, düğme odayı duraklatmadan yalnızca bekletmeyi kaldırır
  await B.evaluate(() => openSettings())
  await B.waitForFunction(() => document.getElementById('dj').classList.contains('is-docked'), null, { timeout: h.LONG })
  const dockToggle = () => B.evaluate(() => ({
    label: document.querySelector('#dj .dj-dock-toggle').getAttribute('aria-label'),
    held: document.querySelector('#dj .dj-dock').classList.contains('is-held')
  }))
  assert.deepEqual(await dockToggle(), { label: 'Duraklat', held: false })
  await B.evaluate(() => window.e2eMedia.pause())
  await fakePaused(B, VID, true, 'köşedeyken B duraklatıldı')
  await B.waitForFunction(() => document.querySelector('#dj .dj-dock').classList.contains('is-held'))
  assert.deepEqual(await dockToggle(), { label: 'Bu Cihazda Devam Et', held: true })
  await B.click('#dj .dj-dock-toggle')
  await B.waitForFunction(() => dj.engine.snapshot().player.localHold.length === 0)
  await fakePaused(B, VID, false, 'çubuğun düğmesiyle çalıyor')
  await h.sleep(1500)
  assert.equal(await A.evaluate(() => dj.engine.snapshot().session.playing), true, 'oda duraklatılmadı')
  await fakePaused(A, VID, false, 'A çalmaya devam ediyor')
  assert.deepEqual(await dockToggle(), { label: 'Duraklat', held: false })
  await B.evaluate(() => closeSettings())
  await B.waitForFunction(() => !document.getElementById('dj').classList.contains('is-docked'), null, { timeout: h.LONG })
  // Bekletme ses odasında kalır: odadan çıkınca kalkar, yeniden katılınca müzik bu cihazda da çalar
  await B.evaluate(() => window.e2eMedia.pause())
  await B.waitForFunction(() => dj.engine.snapshot().player.localHold.indexOf('media') !== -1)
  await B.evaluate(() => leaveVoice())
  await B.waitForFunction(() => dj.voiceRoom === null && navigator.mediaSession.metadata === null, null, { timeout: h.LONG })
  assert.deepEqual(await holds(B), [], 'odadan çıkınca bekletme yok')
  await h.joinVoice(B, W.lobi.id)
  await fakePaused(B, VID, false, 'yeniden katılınca çalıyor')
  assert.deepEqual(await holds(B), [])
  assert.equal(await B.evaluate(() => navigator.mediaSession.playbackState), 'playing')
})

test('arka plandaki sekme: oynatıcı alanı köşeye çizilir, parça A ile birlikte başlar', async () => {
  const { A, B } = W
  await stopMusic(A)
  await B.waitForFunction(() => !dj.engine.queue().current, null, { timeout: h.LONG })
  // Dar pencerede kart sayfa kipindedir ve sayfa kapalıdır: oynatıcı yalnızca köşede görünebilir
  await B.setViewportSize({ width: 1100, height: 800 })
  await B.waitForFunction(() => {
    const d = document.getElementById('dj')
    return d.classList.contains('is-sheet-mode') && d.hidden && document.querySelector('#dj .dj-yt').hidden
  })
  // Arka plandaki sekme benzetimi: requestAnimationFrame hiç çalışmaz, sayfa gizli görünür. Benzetimden önce
  // istenmiş bir kare varsa o da çalışıp biter, parça ondan sonra eklenir.
  await B.evaluate(() => {
    window.e2eRaf = window.requestAnimationFrame
    window.e2eRafQueue = []
    window.requestAnimationFrame = (fn) => {
      window.e2eRafQueue.push(fn)
      return 0
    }
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await h.sleep(500)
  await addTrack(A, 'D120bbbbbbb')
  const a = await firstPlay(A, 'D120bbbbbbb', 'A başladı')
  const b = await firstPlay(B, 'D120bbbbbbb', 'gizli B başladı')
  assert.ok(Math.abs(a - b) <= SYNC_MS, 'başlangıç farkı ' + (b - a) + ' ms')
  const info = await B.evaluate(() => {
    const f = document.querySelector('#dj .dj-yt iframe.dj-youtube-frame')
    const r = f.getBoundingClientRect()
    return {
      docked: document.getElementById('dj').classList.contains('is-docked'),
      w: r.width,
      h: r.height,
      inView: r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
      hidden: dj.engine.snapshot().player.hidden,
      // Benzetim gerçekten sürüyor: kare isteklerinin hiçbiri çalışmadı
      rafWaiting: window.e2eRafQueue.length > 0
    }
  })
  assert.equal(info.docked, true, 'köşede')
  assert.ok(info.w >= 200 && info.h >= 200, 'çerçeve en az 200x200: ' + info.w + 'x' + info.h)
  assert.equal(info.inView, true, 'görünüm alanında')
  assert.equal(info.hidden, false, 'motor oynatıcıyı görünür sayıyor')
  assert.equal(info.rafWaiting, true, 'requestAnimationFrame bekletildi')
  // Sayfa yeniden görünür olur, bekleyen kareler çalışır
  await B.evaluate(() => {
    delete document.visibilityState
    delete document.hidden
    window.requestAnimationFrame = window.e2eRaf
    const queue = window.e2eRafQueue
    window.e2eRafQueue = []
    queue.forEach((fn) => window.requestAnimationFrame(fn))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await B.setViewportSize({ width: 1440, height: 900 })
})

test('rıza vermemiş üye odaya katılınca kısa bildirim ve telsiz kartında kalıcı uyarı çıkar, Yükle ile dinler', async () => {
  const C = await W.w.pageFor('mert', { route: routeYouTube() })
  await C.evaluate(() => {
    window.e2eToasts = []
    new MutationObserver(() => {
      if (!el.toast.hidden) window.e2eToasts.push(el.toast.textContent)
    }).observe(el.toast, { childList: true, characterData: true, subtree: true, attributes: true })
  })
  await h.joinVoice(C, W.lobi.id)
  const warn = 'Bu ses odasında Telsiz DJ YouTube parçası çalıyor. Dinlemek için oynatıcıyı yükleyin.'
  // Geniş ekranda kart sütunda rıza sorusunu gösterir: telsiz kartında uyarı yinelenmez, kısa bildirim yine çıkar
  await C.waitForFunction(() => !document.querySelector('#dj .dj-consent').hidden, null, { timeout: h.LONG })
  await C.waitForFunction((text) => window.e2eToasts.indexOf(text) !== -1, warn, { timeout: h.LONG })
  assert.equal(await C.evaluate(() => {
    const row = document.querySelector('#radio-tuned .radio-dj-consent')
    return !row || row.hidden
  }), true, 'kart soruyorken telsiz kartında uyarı yok')
  // Dar pencerede kart kapalı sayfadadır: uyarı telsiz kartında kalır. Görünüm alanı değişince window.innerWidth
  // hemen yeni değeri verir, resize olayı ise sonraki çizim karesinde gelir (setViewportSize ondan önce döner). DJ'nin
  // kare beklemeyen çizimleri (yarım saniyelik denetim, motor olayları) sayfa kipini innerWidth ile seçip uyarıyı bu
  // arada açabilir, telsiz kartı ise sağ sütuna yalnızca resize olayında taşınır (12-init.js onResize, placeRadio). O
  // ana dek kart 1280 pikselin altında gizli olan sol sütundadır. Bu yüzden düzen sınıfının da güncellenmesi beklenir
  // (onResize onu kartı taşımadan hemen önce yazar).
  await C.setViewportSize({ width: 1100, height: 800 })
  await C.waitForFunction(() => {
    const row = document.querySelector('#radio-tuned .radio-dj-consent')
    return el.appView.getAttribute('data-layout') === layoutClass() && row && !row.hidden
  }, null, { timeout: h.LONG })
  const row = await C.evaluate(() => ({
    text: document.querySelector('#radio-tuned .radio-dj-consent-text').textContent,
    accept: document.querySelector('#radio-tuned .radio-dj-consent-accept').textContent,
    decline: document.querySelector('#radio-tuned .radio-dj-consent-decline').textContent,
    frames: document.querySelectorAll('#dj iframe').length
  }))
  assert.deepEqual(row, { text: warn, accept: 'YouTube Oynatıcısını Yükle', decline: 'Hayır, Yükleme', frames: 0 })
  assert.equal(await h.reachable(C, '#radio-tuned .radio-dj-consent-accept'), true, 'Yükle düğmesine ulaşılabilir')
  assert.ok(await h.overflowX(C) <= 0, 'yatay taşma')
  await C.click('#radio-tuned .radio-dj-consent-accept')
  await C.waitForFunction(() => localStorage.getItem('telsiz.djYoutubeConsent') === '1' && document.querySelector('#radio-tuned .radio-dj-consent').hidden, null, { timeout: h.LONG })
  await h.until(async () => {
    const frame = await fakeFrame(C, 'D120bbbbbbb')
    if (!frame) return false
    try {
      return await frame.evaluate(() => Boolean(window.FAKE) && window.FAKE.state === 1 && !window.FAKE.audio.paused)
    } catch (err) {
      return false
    }
  }, h.LONG, 'C dinliyor')
  await C.evaluate(() => leaveVoice())
})

test('arka planda iki dosya parçası art arda aynı ses öğesinde çalar, kilit ekranında parça adı görünür', async () => {
  const { A } = W
  const genel = W.w.room('genel')
  const E = W.w.E
  const files = []
  for (const name of ['bir.wav', 'iki.wav']) {
    const wav = h.makeWav(3, 8000)
    const enc = E.encryptFile(new Uint8Array(wav))
    const up = await W.w.call('POST', '/api/uploads', null, W.w.P.deniz.token, Buffer.from(enc.box))
    assert.equal(up.status, 200)
    files.push({ u: up.data.id, k: enc.key, n: enc.nonce, kind: 'file', name: name, m: 'audio/wav', s: wav.length })
  }
  for (const f of files) await W.w.say('deniz', genel, f.name, [f], [f.u])
  await A.evaluate((id) => selectChannel(id, {}), genel.id)
  await A.waitForFunction(() => document.querySelectorAll('#message-list .dj-play-file').length >= 2, null, { timeout: h.LONG })
  const buttons = await A.$$('#message-list .dj-play-file')
  for (const b of buttons.slice(-2)) {
    await b.click()
    await h.sleep(400)
  }
  await A.waitForFunction(() => dj.engine.queue().queue.length === 2, null, { timeout: h.LONG })
  // Arka plandaki sekme benzetimi ve sesi başlayan blob öğelerinin kaydı
  await A.evaluate(() => {
    window.e2eRaf = window.requestAnimationFrame
    window.requestAnimationFrame = () => 0
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
    window.e2ePlayed = []
    window.e2eTitles = []
    const play = HTMLMediaElement.prototype.play
    HTMLMediaElement.prototype.play = function () {
      if (String(this.src).indexOf('blob:') === 0 && window.e2ePlayed.indexOf(this) === -1) window.e2ePlayed.push(this)
      return play.apply(this, arguments)
    }
    setInterval(() => {
      const m = navigator.mediaSession.metadata
      const title = m ? m.title : null
      if (window.e2eTitles[window.e2eTitles.length - 1] !== title) window.e2eTitles.push(title)
    }, 100)
    dj.engine.skip()
  })
  await A.waitForFunction(() => {
    const s = dj.engine.snapshot()
    return s.session && s.session.current && s.session.current.title === 'iki.wav' && s.player.kind === 'file' && s.player.status === 'playing'
  }, null, { timeout: h.LONG })
  const r = await A.evaluate(() => ({
    elements: window.e2ePlayed.length,
    titles: window.e2eTitles.filter((x) => x === 'bir.wav' || x === 'iki.wav'),
    artist: navigator.mediaSession.metadata.artist,
    state: navigator.mediaSession.playbackState
  }))
  assert.deepEqual(r, { elements: 1, titles: ['bir.wav', 'iki.wav'], artist: 'Telsiz DJ · Lobi', state: 'playing' })
  // Gizlilik ayarı kapalıyken parça adı işletim sistemine verilmez
  await A.evaluate(() => localStorage.setItem('telsiz.djMediaSession', '0'))
  await A.waitForFunction(() => navigator.mediaSession.metadata === null)
  await A.evaluate(() => localStorage.removeItem('telsiz.djMediaSession'))
  await A.waitForFunction(() => navigator.mediaSession.metadata && navigator.mediaSession.metadata.title === 'iki.wav')
  await A.evaluate(() => {
    delete document.visibilityState
    delete document.hidden
    window.requestAnimationFrame = window.e2eRaf
    document.dispatchEvent(new Event('visibilitychange'))
  })
})

test('kendiliğinden biten YouTube parçasının adı karttaki son işlem satırında ve Bildirimler kaydında kalır', async () => {
  const { A, B } = W
  const VID = 'D006aaaaaaa'
  const me = await A.evaluate(() => userDisplayName(state.me.id))
  // Önceki parça durdurulur, yeni parça boş oturuma eklenir (altı saniyelik sahte video)
  await A.evaluate(() => (dj.engine.queue().current ? dj.engine.stop() : null))
  await B.waitForFunction(() => !dj.engine.queue().current, null, { timeout: h.LONG })
  await addTrack(A, VID)
  await fakePaused(B, VID, false, 'B çalıyor')
  const line = me + ' kuyruğa ekledi: Fake video ' + VID
  const record = me + ' Telsiz DJ kuyruğuna ekledi: Fake video ' + VID
  await B.waitForFunction((text) => document.querySelector('#dj .dj-last').textContent === text, line, { timeout: h.LONG })
  const id = await (await B.waitForFunction((text) => {
    const li = Array.from(document.querySelectorAll('#activity .activity-item.is-dj')).filter((n) => n.querySelector('.activity-text').textContent === text)[0]
    return li ? li.getAttribute('data-activity-id') : null
  }, record, { timeout: h.LONG })).jsonValue()
  // Parçayı yalnızca B dinler: bittiğini B kendisi yazar, kendi işlemi için bildirim almaz, satır ekleme
  // bildiriminde kalır
  await A.evaluate(() => leaveVoice())
  await B.waitForFunction(() => !dj.engine.queue().current, null, { timeout: h.LONG })
  await h.sleep(500)
  const after = await B.evaluate((aid) => ({
    last: document.querySelector('#dj .dj-last').textContent,
    record: document.querySelector('#activity .activity-item[data-activity-id="' + aid + '"] .activity-text').textContent
  }), id)
  assert.deepEqual(after, { last: line, record: record })
})

// İki istemci aynı anda yazınca sunucu sürüm denetimi (CAS) birini 409 ile reddeder, motor yeni durumla
// yeniden dener. Bu protokolün parçasıdır, tarayıcı yanıtı "Failed to load resource" olarak yazar.
const casConflict = (l) => l.type === 'error' && /status of 409/.test(l.text) && /\/api\/music\/state/.test(l.url)

test('konsol ve sunucu günlüğü temiz', async () => {
  h.assertCleanConsole(W.w.logs, W.w.srv.errors, [casConflict])
})
