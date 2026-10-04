'use strict'

// Telsiz DJ: iki kullanıcı ses odasında. /çal ile YouTube parçası eklenir, rıza kartı iki istemcide görünür ve
// rızadan önce YouTube alan adlarına hiçbir istek gitmez. YouTube gömmesi page.route ile yerel sahte oynatıcıya
// (sahte-youtube.js) yönlendirilir, gerçek YouTube'a erişilmez. Duraklat ve devam iki istemcide eşitlenir,
// bantta nota işareti ve telsiz kartında "DJ çalıyor" satırı görünür, mesajdaki ses dosyası kuyruğa eklenip
// iki istemcide çalar.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const h = require('./yardimci')

const FAKE_JS = fs.readFileSync(path.join(__dirname, 'sahte-youtube.js'), 'utf8')
const YT_HOST_RE = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|googlevideo\.com|doubleclick\.net|google\.com|gstatic\.com|googleapis\.com)(:\d+)?\//i
const EMBED_HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#111"><script src="/fake/embed.js"></script></body></html>'

const W = { w: null, A: null, B: null, lobi: null, genel: null, yt: { deniz: [], ece: [] } }
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []))

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
    return await frame.evaluate(() => ({ state: window.FAKE.state, id: window.FAKE.videoId, paused: window.FAKE.audio.paused }))
  } catch (err) {
    return null
  }
}

before(async () => {
  W.w = await h.setupWorld({ slot: 5 })
  W.lobi = W.w.room('Lobi')
  W.genel = W.w.room('genel')
  W.A = await W.w.pageFor('deniz', { route: routeYouTube('deniz') })
  W.B = await W.w.pageFor('ece', { route: routeYouTube('ece') })
})

after(async () => {
  if (W.w) await W.w.close()
})

test('ses odasında kadronun sonunda Telsiz DJ öğesi, boş DJ sütun açmaz ve yan sayfada açılır', async () => {
  for (const page of [W.A, W.B]) await h.joinVoice(page, W.lobi.id)
  for (const page of [W.A, W.B]) {
    await page.waitForFunction(() => document.querySelector('#radio-crew .crew-dj'), null, { timeout: h.LONG })
    await page.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item').length === 3, null, { timeout: h.LONG })
  }
  const r = await W.A.evaluate(() => ({
    hidden: document.getElementById('dj').hidden,
    col: document.getElementById('app-view').getAttribute('data-dj-col'),
    crew: document.querySelector('#radio-crew .crew-dj .crew-name').textContent,
    last: document.getElementById('radio-crew').lastElementChild.classList.contains('crew-dj'),
    infoInline: isInfoInline(),
    infoCol: document.getElementById('info-col').getBoundingClientRect().width > 0
  }))
  // Boş DJ ayrı sütun açmaz, sol bilgi sütunu yerinde kalır
  assert.deepEqual(r, { hidden: true, col: 'off', crew: 'Telsiz DJ', last: true, infoInline: true, infoCol: true })
  await W.A.click('#radio-crew .crew-dj button')
  await W.A.waitForFunction(() => {
    const d = document.getElementById('dj')
    return !d.hidden && d.classList.contains('is-open') && d.getAttribute('role') === 'dialog'
  })
  assert.equal(await W.A.textContent('#dj .dj-empty-title'), 'Henüz parça yok')
  await W.A.keyboard.press('Escape')
  await W.A.waitForFunction(() => document.getElementById('dj').hidden)
})

test('/çal ile YouTube parçası: komut mesaj olarak gitmez, rıza kartı çıkar, YouTube\'a istek yok', async () => {
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
  assert.equal(await A.inputValue('#composer-input'), '')
  const sent = await A.evaluate(() => Array.from(document.querySelectorAll('#message-list .msg-text')).some((n) => n.textContent.indexOf('/çal') !== -1))
  assert.equal(sent, false, 'komut mesaj olarak gönderilmedi')
  for (const page of [A, B]) await page.waitForFunction(() => !document.querySelector('#dj .dj-consent').hidden, null, { timeout: h.LONG })
  // Parça gelince kart sağ sütundaki İstasyonlar listesinin yerini alır, sol sütun (telsiz kartı) yerinde kalır
  const col = await A.evaluate(() => ({ col: document.getElementById('app-view').getAttribute('data-dj-col'), sheet: document.getElementById('dj').classList.contains('is-sheet-mode'), infoInline: isInfoInline(), infoCol: document.getElementById('info-col').getBoundingClientRect().width > 0, right: document.getElementById('side-right').getBoundingClientRect().width, dj: document.getElementById('dj').getBoundingClientRect().width > 0 }))
  assert.deepEqual(col, { col: 'on', sheet: false, infoInline: true, infoCol: true, right: 0, dj: true })
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
})

test('duraklat ve devam iki istemcide eşitlenir', async () => {
  const { A, B } = W
  await B.click('#dj .dj-toggle')
  await A.waitForFunction(() => {
    const s = dj.engine.snapshot()
    return s.session && s.session.playing === false && document.querySelector('#dj .dj-toggle').textContent === 'Devam et'
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

test('mesajdaki ses dosyası DJ\'de çal ile kuyruğa eklenir, atlayınca iki istemcide dosya çalar', async () => {
  const { A, B } = W
  const E = W.w.E
  const wav = h.makeWav(6, 22050)
  const enc = E.encryptFile(new Uint8Array(wav))
  const up = await W.w.call('POST', '/api/uploads', null, W.w.P.mert.token, Buffer.from(enc.box))
  assert.equal(up.status, 200)
  await W.w.say('mert', W.genel, 'lobi teması', [{ u: up.data.id, k: enc.key, n: enc.nonce, kind: 'file', name: 'lobi-temasi.wav', m: 'audio/wav', s: wav.length }], [up.data.id])
  await B.evaluate((id) => selectChannel(id, {}), W.genel.id)
  await B.waitForSelector('#message-list .dj-play-file', { timeout: h.LONG })
  assert.equal(await B.textContent('#message-list .dj-play-file'), 'DJ\'de çal')
  await B.click('#message-list .dj-play-file')
  await A.waitForFunction(() => document.querySelectorAll('#dj .dj-queue .dj-queue-item').length === 1 && /lobi-temasi/.test(document.querySelector('#dj .dj-queue-name').textContent), null, { timeout: h.LONG })
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

test('telefon 390: DJ alt sayfası tam genişlik, yatay taşma yok', async () => {
  const { B } = W
  await B.setViewportSize({ width: 390, height: 844 })
  await B.waitForFunction(() => document.getElementById('dj').classList.contains('is-sheet-mode'))
  await B.click('#radio-crew .crew-dj button')
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

// İki istemci aynı anda yazınca sunucu sürüm denetimi (CAS) birini 409 ile reddeder, motor yeni durumla
// yeniden dener. Bu protokolün parçasıdır, tarayıcı yanıtı "Failed to load resource" olarak yazar.
const casConflict = (l) => l.type === 'error' && /status of 409/.test(l.text) && /\/api\/music\/state/.test(l.url)

test('konsol ve sunucu günlüğü temiz', async () => {
  h.assertCleanConsole(W.w.logs, W.w.srv.errors, [casConflict])
})
