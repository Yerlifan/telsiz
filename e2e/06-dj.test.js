'use strict'

// Telsiz DJ: iki kullanıcı ses odasında. /çal ile YouTube parçası eklenir, rıza kartı iki istemcide görünür ve
// rızadan önce YouTube alan adlarına hiçbir istek gitmez. YouTube gömmesi page.route ile yerel sahte oynatıcıya
// (sahte-youtube.js) yönlendirilir, gerçek YouTube'a erişilmez. Duraklat ve devam iki istemcide eşitlenir,
// bantta nota işareti ve telsiz kartında "DJ çalıyor" satırı görünür, mesajdaki ses dosyası kuyruğa eklenip
// iki istemcide çalar. Ayarlar açıkken ve dar ekranda DJ sayfası kapalıyken YouTube oynatıcısı köşeye alınır
// (en az 200x200, üstünde hiçbir şey yok) ve müzik ses odasından ayrılana kadar çalmaya devam eder.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const h = require('./yardimci')

const FAKE_JS = fs.readFileSync(path.join(__dirname, 'sahte-youtube.js'), 'utf8')
const YT_HOST_RE = /^https?:\/\/([a-z0-9-]+\.)*(youtube\.com|youtube-nocookie\.com|youtu\.be|ytimg\.com|googlevideo\.com|doubleclick\.net|google\.com|gstatic\.com|googleapis\.com)(:\d+)?\//i
const EMBED_HTML = '<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#111"><script src="/fake/embed.js"></script></body></html>'

const W = { w: null, A: null, B: null, lobi: null, genel: null, yt: { deniz: [], ece: [] } }
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
  W.w = await h.setupWorld({ slot: 5 })
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
  assert.equal(await A.inputValue('#composer-input'), '')
  const sent = await A.evaluate(() => Array.from(document.querySelectorAll('#message-list .msg-text')).some((n) => n.textContent.indexOf('/çal') !== -1))
  assert.equal(sent, false, 'komut metni mesaj olarak gösterilmedi')
  // Duyuru komutun yazıldığı yazı odasında iki istemcide de görünür
  const roomA = await A.evaluate(() => String(state.channelId))
  const me = await A.evaluate(() => userDisplayName(state.me.id))
  assert.equal(await B.evaluate(() => String(state.channelId)), roomA)
  for (const page of [A, B]) {
    await page.waitForFunction(() => document.querySelector('#message-list .msg-dj'), null, { timeout: h.LONG })
    const notice = await page.evaluate(() => {
      const n = document.querySelector('#message-list .msg-dj')
      const msg = n.closest('.msg')
      return { text: n.querySelector('.msg-dj-text').textContent, href: n.querySelector('.msg-dj-link').href, rel: n.querySelector('.msg-dj-link').rel, author: msg.querySelector('.msg-author').textContent, editable: Boolean(msg.querySelector('.msg-quick:not(.msg-action-danger)')) }
    })
    assert.deepEqual(notice, { text: 'Telsiz DJ kuyruğuna bir YouTube parçası ekledi.', href: 'https://www.youtube.com/watch?v=D120aaaaaaa', rel: 'noopener noreferrer', author: me, editable: false })
  }
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

// İki istemci aynı anda yazınca sunucu sürüm denetimi (CAS) birini 409 ile reddeder, motor yeni durumla
// yeniden dener. Bu protokolün parçasıdır, tarayıcı yanıtı "Failed to load resource" olarak yazar.
const casConflict = (l) => l.type === 'error' && /status of 409/.test(l.text) && /\/api\/music\/state/.test(l.url)

test('konsol ve sunucu günlüğü temiz', async () => {
  h.assertCleanConsole(W.w.logs, W.w.srv.errors, [casConflict])
})
