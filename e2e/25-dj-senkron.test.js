'use strict'

// Telsiz DJ başlangıç eşitlemesi (istek 13): iki kullanıcı aynı ses odasında, A /çal ile YouTube parçası
// ekler. YouTube gömmesi page.route ile yerel sahte oynatıcıya (sahte-youtube.js) yönlendirilir, gerçek
// YouTube'a erişilmez. Sahte oynatıcının sesinin ilk başladığı an iki istemcide aynı saatle ölçülür ve en çok
// 250 ms ayrı olmalıdır. Arka plandaki sekme benzetilir (requestAnimationFrame çalışmaz, visibilityState
// hidden): oynatıcı alanı yine de en az 200x200 çizilir, köşeye alınır ve parça A ile birlikte başlar. Rıza
// vermemiş üye odaya katılınca kısa bildirim ve telsiz kartında Yükle düğmeli kalıcı bir uyarı görür.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const h = require('./yardimci')

// Sahte oynatıcıya sesin başladığı anları kaydeden ek (aynı makinedeki iki sayfa aynı saati okur)
const FAKE_JS = fs.readFileSync(path.join(__dirname, 'sahte-youtube.js'), 'utf8') +
  '\n;(function () { var F = window.FAKE; F.playTimes = []; F.audio.addEventListener("playing", function () { if (!F.firstPlayAt) F.firstPlayAt = Date.now(); F.playTimes.push(Date.now()) }) })()\n'
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

function fakeFrame (page, videoId) {
  return page.frames().find((f) => f.url().startsWith('https://www.youtube-nocookie.com/embed/' + videoId))
}

// Sahte oynatıcının sesi ilk başladığında sayfanın saatiyle o an (ms), başlamadıysa null
async function firstPlay (page, videoId, label) {
  return h.until(async () => {
    const frame = fakeFrame(page, videoId)
    if (!frame) return null
    try {
      return await frame.evaluate(() => window.FAKE.firstPlayAt || null)
    } catch (err) {
      return null
    }
  }, h.LONG, label)
}

// Sahte oynatıcının sesi n. kez başladığında sayfanın saatiyle o an (ms)
async function nthPlay (page, videoId, n, label) {
  return h.until(async () => {
    const frame = fakeFrame(page, videoId)
    if (!frame) return null
    try {
      return await frame.evaluate((i) => window.FAKE.playTimes[i] || null, n - 1)
    } catch (err) {
      return null
    }
  }, h.LONG, label)
}

async function addTrack (page, videoId) {
  await page.fill('#composer-input', '/çal https://youtu.be/' + videoId)
  await page.keyboard.press('Enter')
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

test('iki istemci YouTube parçasını en çok 250 ms farkla başlatır', async () => {
  const { A, B } = W
  for (const page of [A, B]) await h.joinVoice(page, W.lobi.id)
  await addTrack(A, 'D120aaaaaaa')
  const a = await firstPlay(A, 'D120aaaaaaa', 'A başladı')
  const b = await firstPlay(B, 'D120aaaaaaa', 'B başladı')
  assert.ok(Math.abs(a - b) <= SYNC_MS, 'başlangıç farkı ' + (b - a) + ' ms')
})

test('devam ettirme de başlangıç payıyla çapalanır, iki istemci birlikte sürdürür', async () => {
  const { A, B } = W
  await B.click('#dj .dj-toggle')
  for (const page of [A, B]) {
    await h.until(async () => {
      const frame = fakeFrame(page, 'D120aaaaaaa')
      return frame && (await frame.evaluate(() => window.FAKE.audio.paused))
    }, h.LONG, 'duraklatıldı')
  }
  await A.click('#dj .dj-toggle')
  const a = await nthPlay(A, 'D120aaaaaaa', 2, 'A sürdürdü')
  const b = await nthPlay(B, 'D120aaaaaaa', 2, 'B sürdürdü')
  assert.ok(Math.abs(a - b) <= SYNC_MS, 'sürdürme farkı ' + (b - a) + ' ms')
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
  // Dar pencerede kart kapalı sayfadadır: uyarı telsiz kartında kalır
  await C.setViewportSize({ width: 1100, height: 800 })
  await C.waitForFunction(() => {
    const row = document.querySelector('#radio-tuned .radio-dj-consent')
    return row && !row.hidden
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
    const frame = fakeFrame(C, 'D120bbbbbbb')
    return frame && (await frame.evaluate(() => window.FAKE.state === 1 && !window.FAKE.audio.paused))
  }, h.LONG, 'C dinliyor')
  await C.evaluate(() => leaveVoice())
})

// İki istemci aynı anda yazınca sunucu sürüm denetimi (CAS) birini 409 ile reddeder, motor yeni durumla
// yeniden dener. Bu protokolün parçasıdır, tarayıcı yanıtı "Failed to load resource" olarak yazar.
const casConflict = (l) => l.type === 'error' && /status of 409/.test(l.text) && /\/api\/music\/state/.test(l.url)

test('konsol ve sunucu günlüğü temiz', async () => {
  h.assertCleanConsole(W.w.logs, W.w.srv.errors, [casConflict])
})
