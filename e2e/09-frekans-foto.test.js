'use strict'

// Frekans fotoğrafı: sahip Ayarlar > Genel'deki Frekans fotoğrafı bölümünden resim seçer, istemci resmi kare
// kırpıp 256x256 boyutuna küçültür ve yükler. Fotoğraf üst çubuğun solundaki frekans düğmesinde, frekans
// menüsünde, bandın açık frekans istasyonunda, Frekanslar sayfasında, giriş ekranında ve tanıtım sayfasında
// baş harfin yerine görünür, açık başka oturumlara canlı yansır. Fotoğraf yüklenemezse ve kaldırılınca baş
// harf görünür. Tarayıcıda diğer frekansların istasyonunda baş harf kalır, masaüstünde (sahte ön yükleme
// nesneleriyle) ana sürecin gönderdiği data: adresi gösterilir. Konsol temiz olmalıdır.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const zlib = require('node:zlib')
const crypto = require('node:crypto')
const h = require('./yardimci')

const W = { w: null }
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []))

function crc32 (buf) {
  let c = 0xffffffff
  for (const byte of buf) {
    c ^= byte
    let k = 8
    while (k-- > 0) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  return (c ^ 0xffffffff) >>> 0
}

function chunk (type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

// Gerçek bir PNG: sol yarısı birinci, sağ yarısı ikinci renk (kare kırpma ortadan yapılır)
function makePng (w, hgt, left, right) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(hgt, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.alloc(1 + w * 3)
  let x = 0
  while (x < w) {
    const c = x < w / 2 ? left : right
    row[1 + x * 3] = c[0]
    row[2 + x * 3] = c[1]
    row[3 + x * 3] = c[2]
    x += 1
  }
  const raw = Buffer.concat(Array.from({ length: hgt }, () => row))
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

const PHOTO = makePng(480, 300, [230, 60, 90], [40, 120, 230])
const OTHER_ICON = 'data:image/png;base64,' + makePng(64, 64, [20, 180, 90], [20, 180, 90]).toString('base64')
const OTHER = 'https://diger.ornek.com'
const THIRD = 'https://ucuncu.ornek.com'

before(async () => {
  W.w = await h.setupWorld({ slot: 11 })
  // Mert yönetici: fotoğrafı görür ama değiştiremez
  const res = await W.w.call('POST', '/api/users/role', { userId: W.w.P.mert.id, role: 'admin' }, W.w.P.deniz.token)
  assert.equal(res.status, 200)
})

after(async () => {
  if (W.w) await W.w.close()
})

async function infoIcon () {
  return (await W.w.call('GET', '/api/info')).data.serverIcon
}

// Amblemin durumu: fotoğraf öğesi, yüklenip yüklenmediği, baş harfin görünürlüğü
function emblemState (page, selector) {
  return page.evaluate((sel) => {
    const em = document.querySelector(sel)
    if (!em) return null
    const img = em.querySelector('img.frekans-photo')
    const letter = em.querySelector('.emblem-letter')
    return {
      photo: Boolean(img),
      src: img ? img.getAttribute('src') : null,
      loaded: Boolean(img && img.complete && img.naturalWidth > 0),
      natural: img ? img.naturalWidth : 0,
      hasClass: em.classList.contains('has-photo'),
      letter: letter ? letter.textContent : null,
      letterVisible: Boolean(letter && window.getComputedStyle(letter).visibility === 'visible')
    }
  }, selector)
}

function waitPhoto (page, selector, src) {
  return page.waitForFunction((args) => {
    const em = document.querySelector(args[0])
    const img = em && em.querySelector('img.frekans-photo')
    return Boolean(img && img.complete && img.naturalWidth > 0 && (!args[1] || img.getAttribute('src') === args[1]))
  }, [selector, src || null], { timeout: h.LONG })
}

function waitLetter (page, selector) {
  return page.waitForFunction((sel) => {
    const em = document.querySelector(sel)
    return Boolean(em && !em.querySelector('img.frekans-photo') && !em.classList.contains('has-photo'))
  }, selector, { timeout: h.LONG })
}

async function openGeneral (page) {
  await page.evaluate(() => openSettings('general', null))
  await page.waitForSelector('#set-photo-section', { timeout: h.LONG })
}

async function closeSettingsView (page) {
  await page.evaluate(() => {
    if (typeof closeSettings === 'function') closeSettings()
  })
}

test('fotoğraf yokken amblemler baş harftir, sahip Ayarlar\'dan fotoğraf seçer, bant ve üst çubuk gösterir', async () => {
  const page = await W.w.pageFor('deniz')
  W.owner = page
  W.ece = await W.w.pageFor('ece')
  assert.equal(await infoIcon(), null)
  const top = await emblemState(page, '#server-emblem')
  assert.deepEqual([top.photo, top.letter, top.letterVisible], [false, 'K', true])
  const station = await emblemState(page, '#band-track .station.is-tuned .station-emblem')
  assert.deepEqual([station.photo, station.letter], [false, 'K'])

  await openGeneral(page)
  const before = await page.evaluate(() => ({
    pick: !document.getElementById('set-photo-pick').hidden,
    remove: !document.getElementById('set-photo-remove').hidden,
    ownerOnly: !document.getElementById('set-photo-owner-only').hidden,
    hint: document.getElementById('set-photo-hint').textContent
  }))
  assert.deepEqual([before.pick, before.remove, before.ownerOnly], [true, false, false])
  assert.match(before.hint, /herkese açıktır ve şifrelenmez/)
  assert.equal((await emblemState(page, '#set-photo-preview .frekans-emblem')).photo, false)

  await page.setInputFiles('#set-photo-file', { name: 'frekans.png', mimeType: 'image/png', buffer: PHOTO })
  await page.waitForFunction(() => document.getElementById('set-photo-msg').textContent === 'Frekans fotoğrafı kaydedildi.', null, { timeout: h.LONG })
  const hash = await infoIcon()
  assert.match(hash, /^[0-9a-f]{32}$/)
  const src = '/api/server-icon?v=' + hash
  W.src = src
  // Sunucudaki fotoğraf istemcinin kırptığı 256x256 PNG'dir
  const served = await W.w.call('GET', src)
  assert.equal(served.status, 200)
  assert.equal(served.buf.subarray(1, 4).toString('latin1'), 'PNG')
  assert.deepEqual([served.buf.readUInt32BE(16), served.buf.readUInt32BE(20)], [256, 256])
  assert.equal(crypto.createHash('sha256').update(served.buf).digest('hex').slice(0, 32), hash)

  await waitPhoto(page, '#set-photo-preview .frekans-emblem', src)
  assert.equal(await page.evaluate(() => !document.getElementById('set-photo-remove').hidden), true)
  await closeSettingsView(page)
  await waitPhoto(page, '#server-emblem', src)
  const after = await emblemState(page, '#server-emblem')
  assert.deepEqual([after.hasClass, after.letterVisible, after.natural], [true, false, 256])
  await waitPhoto(page, '#band-track .station.is-tuned .station-emblem', src)
  // Sekme simgesi de fotoğraftır
  assert.equal(await page.evaluate(() => document.querySelector('link[rel="icon"]').getAttribute('href')), src)
})

test('açık başka oturum fotoğrafı canlı alır: üst çubuk, menü ve Frekanslar sayfası', async () => {
  const page = W.ece
  await waitPhoto(page, '#server-emblem', W.src)
  await waitPhoto(page, '#band-track .station.is-tuned .station-emblem', W.src)
  await page.click('#frekans-button')
  await page.waitForSelector('#frekans-menu:not([hidden]) .frekans-menu-head')
  await waitPhoto(page, '#frekans-menu .frekans-menu-head .frekans-emblem', W.src)
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.getElementById('frekans-menu').hidden)
  await page.evaluate(() => openSheet('frekans', null))
  await page.waitForSelector('#frekans-sheet:not([hidden]) .frekans-sheet-row')
  await waitPhoto(page, '#frekans-sheet .frekans-sheet-row.is-current .frekans-emblem', W.src)
  await page.keyboard.press('Escape')
})

test('yönetici fotoğrafı görür ama değiştiremez, sunucu da reddeder', async () => {
  const page = await W.w.pageFor('mert')
  await openGeneral(page)
  const r = await page.evaluate(() => ({
    pick: !document.getElementById('set-photo-pick').hidden,
    remove: !document.getElementById('set-photo-remove').hidden,
    ownerOnly: !document.getElementById('set-photo-owner-only').hidden
  }))
  assert.deepEqual(r, { pick: false, remove: false, ownerOnly: true })
  await waitPhoto(page, '#set-photo-preview .frekans-emblem', W.src)
  const denied = await W.w.call('POST', '/api/server-icon/delete', {}, W.w.P.mert.token)
  assert.equal(denied.status, 403)
  await closeSettingsView(page)
})

test('fotoğraf yüklenemezse baş harf görünür (yedek)', async () => {
  const page = await W.w.tb.newPage('yuklenemez', {
    person: W.w.P.ece,
    extra: { 'telsiz.skin': 'gece', 'telsiz.scheme': 'light' },
    route: (context) => context.route('**/api/server-icon*', (route) => route.fulfill({ status: 500, contentType: 'text/plain', body: 'x' }))
  })
  await page.goto(W.w.base + '/#anahtar=' + encodeURIComponent(W.w.keyCode))
  await page.waitForSelector('#band-track .station[data-station]', { timeout: h.LONG })
  await waitLetter(page, '#server-emblem')
  await waitLetter(page, '#band-track .station.is-tuned .station-emblem')
  const top = await emblemState(page, '#server-emblem')
  assert.deepEqual([top.letter, top.letterVisible], ['K', true])
  // Yüklenemeyen adres yeniden denenmez: sekme simgesi Telsiz simgesine döner
  assert.equal(await page.evaluate(() => document.querySelector('link[rel="icon"]').getAttribute('href')), '/favicon.svg')
  await page.close()
})

test('tanıtım sayfası ve giriş ekranı fotoğrafı gösterir', async () => {
  const page = await W.w.tb.newPage('ziyaretci', { extra: { 'telsiz.skin': 'arcade', 'telsiz.scheme': 'dark' } })
  W.visitor = page
  await page.goto(W.w.base + '/')
  await page.waitForSelector('#tanitim:not([hidden])', { timeout: h.LONG })
  await page.waitForFunction((src) => {
    const img = document.getElementById('tanitim-photo')
    return !img.hidden && img.getAttribute('src') === src && img.complete && img.naturalWidth === 256
  }, W.src, { timeout: h.LONG })
  assert.equal(await page.evaluate(() => document.getElementById('tanitim-ident').classList.contains('has-photo')), true)
  await page.click('#tanitim-login')
  await page.waitForSelector('#login-card:not([hidden])')
  await page.waitForFunction((src) => {
    const img = document.getElementById('auth-server-icon')
    return !img.hidden && img.getAttribute('src') === src && img.complete && img.naturalWidth === 256 && img.getClientRects().length > 0
  }, W.src, { timeout: h.LONG })
  assert.equal(await page.evaluate(() => document.querySelector('.auth-dial').classList.contains('has-photo')), true)
})

test('tarayıcıda diğer frekansların istasyonunda baş harf kalır', async () => {
  const page = W.owner
  await page.evaluate((list) => {
    localStorage.setItem('telsiz.frekanslar', JSON.stringify(list))
    frekansState.webList = null
    frekansChanged()
  }, [{ origin: OTHER, name: 'Diğer' }])
  await page.waitForSelector('#band-track .station[data-station="' + OTHER + '"]')
  const other = await emblemState(page, '#band-track .station[data-station="' + OTHER + '"] .station-emblem')
  assert.deepEqual([other.photo, other.letter], [false, 'D'])
  await waitPhoto(page, '#band-track .station.is-tuned .station-emblem', W.src)
  await page.evaluate(() => {
    localStorage.removeItem('telsiz.frekanslar')
    frekansState.webList = null
    frekansChanged()
  })
})

// Masaüstünün ön yükleme nesnelerinin yerine: frekans listesi ve ana sürecin gönderdiği arka plan durumu
const desktopInit = (v) => {
  window.telsizDesktop = Object.freeze({
    listFrequencies: () => Promise.resolve({ items: v.items }),
    setFrequencyName: () => Promise.resolve({ ok: true }),
    switchFrequency: () => Promise.resolve({ ok: true }),
    addFrequency: () => Promise.resolve({ ok: true }),
    removeFrequency: () => Promise.resolve({ ok: true })
  })
  window.telsizArkaPlan = Object.freeze({
    background: false,
    getState: () => Promise.resolve(v.state),
    onState: () => () => {}
  })
}

test('masaüstünde diğer frekansın fotoğrafı ana süreçten data: adresiyle gelir, bozuk adres reddedilir', async () => {
  const items = [
    { origin: W.w.base, name: 'Kankalar', active: true, order: 0 },
    { origin: OTHER, name: 'Diğer', active: false, order: 1 },
    { origin: THIRD, name: 'Üçüncü', active: false, order: 2 }
  ]
  const state = {
    items: [
      { origin: OTHER, active: false, state: 'ok', unread: 2, mention: 0, online: true, onlineUsers: 3, icon: OTHER_ICON },
      { origin: THIRD, active: false, state: 'ok', unread: 0, mention: 0, online: true, onlineUsers: 1, icon: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }
    ]
  }
  const page = await W.w.tb.newPage('masaustu', {
    person: W.w.P.deniz,
    extra: { 'telsiz.skin': 'turkuaz', 'telsiz.scheme': 'dark' },
    route: (context) => context.addInitScript(desktopInit, { items, state })
  })
  await page.goto(W.w.base + '/#anahtar=' + encodeURIComponent(W.w.keyCode))
  await page.waitForSelector('#band-track .station[data-station="' + OTHER + '"]', { timeout: h.LONG })
  await waitPhoto(page, '#band-track .station[data-station="' + OTHER + '"] .station-emblem', OTHER_ICON)
  const third = await emblemState(page, '#band-track .station[data-station="' + THIRD + '"] .station-emblem')
  assert.deepEqual([third.photo, third.letter], [false, 'Ü'])
  await waitPhoto(page, '#band-track .station.is-tuned .station-emblem', W.src)
  // Durum noktası fotoğrafın üstünde kalır
  assert.equal(await page.evaluate((o) => Boolean(document.querySelector('#band-track .station[data-station="' + o + '"] .station-emblem img.frekans-photo ~ .frekans-dot')), OTHER), true)
  await page.close()
})

test('geçersiz dosya reddedilir, fotoğraf kaldırılınca her yerde baş harfe dönülür', async () => {
  const page = W.owner
  await openGeneral(page)
  await page.setInputFiles('#set-photo-file', { name: 'not.png', mimeType: 'image/png', buffer: Buffer.from('bu bir resim degil') })
  await page.waitForFunction(() => /resim olarak açılamadı/.test(document.getElementById('set-photo-msg').textContent), null, { timeout: h.LONG })
  assert.equal(await infoIcon(), W.src.slice(-32))
  await page.click('#set-photo-remove')
  await page.waitForFunction(() => document.getElementById('set-photo-msg').textContent === 'Frekans fotoğrafı kaldırıldı.', null, { timeout: h.LONG })
  assert.equal(await infoIcon(), null)
  await waitLetter(page, '#set-photo-preview .frekans-emblem')
  assert.equal(await page.evaluate(() => document.getElementById('set-photo-remove').hidden), true)
  await closeSettingsView(page)
  await waitLetter(page, '#server-emblem')
  await waitLetter(page, '#band-track .station.is-tuned .station-emblem')
  await waitLetter(W.ece, '#server-emblem')
  await waitLetter(W.ece, '#band-track .station.is-tuned .station-emblem')
  assert.equal(await page.evaluate(() => document.querySelector('link[rel="icon"]').getAttribute('href')), '/favicon.svg')
  assert.equal((await W.w.call('GET', W.src)).status, 404)
})

test('telefon 390: bant ve ayarlar bölümü yatay taşmaz', async () => {
  // Fotoğraf yeniden yüklenir (Node tarafından, istemcinin ürettiği biçimde)
  const res = await W.w.call('POST', '/api/server-icon', null, W.w.P.deniz.token, makePng(256, 256, [230, 60, 90], [40, 120, 230]))
  assert.equal(res.status, 200)
  const page = await W.w.pageFor('deniz', { label: 'telefon', viewport: { width: 390, height: 844 }, mobile: true })
  const src = '/api/server-icon?v=' + res.data.serverIcon
  await waitPhoto(page, '#server-emblem', src)
  await waitPhoto(page, '#band-track .station.is-tuned .station-emblem', src)
  assert.ok(await h.overflowX(page) <= 0)
  await openGeneral(page)
  await waitPhoto(page, '#set-photo-preview .frekans-emblem', src)
  assert.ok(await h.overflowX(page) <= 0)
  await closeSettingsView(page)
})

test('konsol ve sunucu günlükleri temiz', async () => {
  // Yüklenemeyen fotoğraf sayfası bilerek 500 alır
  h.assertCleanConsole(W.w.logs, W.w.srv.errors, [(l) => l.label === 'yuklenemez' && /Failed to load resource/.test(l.text)])
})
