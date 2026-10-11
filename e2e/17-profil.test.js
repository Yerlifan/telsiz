'use strict'

// Profil eşitlemesi (istek 3) ve profil kartı düzeni (istek 9). Bu dosyayı G6 kurar, kapak fotoğrafı (G7) genişletir.
// - Deniz Lobi'de kamerasını açar, Ece kameraları büyütür. Deniz Ayarlar > Profil'den görünen adını ve profil
//   resmini değiştirir: Ece'de kameralar ızgarası, Bildirimler listesi, kadro, Çevrimiçi listesi ve mesaj yazarı
//   SHORT süresi içinde güncel ad ve resmi gösterir. Ece Deniz'in kişi ses kartını ve profil kartını açıkken Deniz
//   adını yeniden değiştirir, iki kartın başlığı da güncellenir.
// - Ece'nin ilk /api/profiles isteği bağlantı hatasıyla düşer: ad yine SHORT içinde gelir. İlk profil resmi indirmesi
//   düşer: resim 10 saniyelik yeniden denemeyle gelir.
// - Deniz'in Telsiz DJ'ye eklediği parça Ece'nin kuyruğunda bekler, Deniz ve Ece ekranlarını paylaşır, Deniz Ece'nin
//   paylaşımını izler. Deniz adını ve resmini değiştirince Ece'de kuyruktaki ekleyen adı, paylaşan seçicisindeki ad ve
//   izleyici yığınındaki avatar güncellenir. Bildirimler listesindeki İzle düğmesi odaktayken liste güncellenir, odak
//   aynı düğmede kalır.
// - Kart düzeni üç temada (Arcade, Gece, Turkuaz): ad avatarın sağında, rol rozeti adla aynı satırda, @kullanıcı
//   adı adın altında. Üye kartında soluk "Üye" rozeti, özel rolü olan üyede iki rozet. Avatar menüsünde rol adın
//   yanında, Ayarlar önizlemesinde özel rol rozeti. 360 piksel genişlikte yatay taşma yok, kart büyük yazı boyutunda
//   da ekrana sığar. 18rem'den dar kartta ad, rol ve @kullanıcı adı avatarın altına kayar. 32 karakterlik uzun adda ad
//   avatarın sağında kalır, rol rozeti adın altındaki satıra geçer.
// - Kapak fotoğrafı (istek 8, G7): Deniz Ayarlar > Profil'den kapak seçer, iki önizlemede görünür ve kaydedilir. Ece'de
//   kapak kart açılmadan indirilmez, kart açılınca bir kez iner ve üç temada bandın içinde, banda binen avatarın altında
//   görünür. Kapak 1200x400 JPEG'dir ve kaynağın ortasından 3:1 kırpılmıştır. Veri klasöründe yalnızca şifreli kapak
//   vardır, düz JPEG baytları hiçbir dosyada yoktur. Kapağı bilmeyen eski bir istemcinin kaydı kapağı kaldırır ve dosya
//   silinir. İngilizce arayüzde kapak seçilir ve Remove Cover ile kaldırılır, Ece'nin açık kartındaki kapak da kalkar.
// - Konsol ve sunucu günlüğü temiz (bilerek düşürülen isteklerin ve Telsiz DJ sürüm çakışmasının (409) hataları dışında)
// Kapak testleri ve konsol denetimi üç tarayıcıda da çalışır. Kamera, ekran paylaşımı, düşürülen istekler ve kart düzeni
// testleri yalnızca Chromium'da çalışır, diğer tarayıcılarda nedeni yazılarak atlanır.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const h = require('./yardimci')

const W = { w: null, deniz: null, ece: null, lobi: null, genel: null }
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []))
// Yalnızca Chromium'da çalışan testler. Sahte kamera ve ekran yakalama Chromium bayraklarıyla sağlanır (10-kamera.test.js
// ve 14-bildirim-sesleri.test.js ile aynı gerekçe). Bilerek düşürülen isteğin konsol iletisi Chromium'un ağ hatası
// metnine göre ayıklanır. Kart düzeni ölçümleri yalnızca Chromium'da doğrulandı.
const ONLY_CHROMIUM = {
  camera: { browsers: ['chromium'], reason: 'sahte kamera yalnızca Chromium bayraklarıyla doğrulandı' },
  aborted: { browsers: ['chromium'], reason: 'düşürülen isteğin konsol iletisi yalnızca Chromium için ayıklanır' },
  layout: { browsers: ['chromium'], reason: 'kart düzeni ölçümleri yalnızca Chromium\'da doğrulandı' },
  screen: { browsers: ['chromium'], reason: 'ekran yakalama yalnızca Chromium bayraklarıyla' }
}

// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')
const SKINS = ['arcade', 'gece', 'turkuaz']

const crewSel = (id) => '#radio-crew .crew-item[data-user-id="' + id + '"]'

// PNG yazımı için CRC-32 (zlib.crc32 her Node.js 20 sürümünde yok)
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  let n = 0
  while (n < 256) {
    let c = n
    let k = 0
    while (k < 8) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      k++
    }
    table[n] = c
    n++
  }
  return table
})()

function crc32 (buf) {
  let c = -1
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function pngChunk (type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

// Kare PNG: üst üçte biri kırmızı, ortası yeşil, altı mavi. Ortadan alınan 3:1 bölge tam olarak yeşil şerittir.
function stripesPng (size) {
  const row = 1 + size * 3
  const raw = Buffer.alloc(row * size)
  const colors = [[220, 30, 30], [30, 200, 60], [30, 60, 220]]
  let y = 0
  while (y < size) {
    const rgb = colors[Math.floor(y * 3 / size)]
    let x = 0
    while (x < size) {
      raw.set(rgb, y * row + 1 + x * 3)
      x++
    }
    y++
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
}

// Kişinin profil kaydındaki kapak yükleme kimliği (yoksa null)
function coverIdOf (page, id) {
  return page.evaluate((d) => {
    const rec = profileRecord(d)
    return rec && rec.profile && rec.profile.cover ? rec.profile.cover.u : null
  }, id)
}

// Açık profil kartındaki kapak: boyutlar, bandı doldurup doldurmadığı, avatarın kapağın üstünde kalıp kalmadığı ve
// kapağın üç noktasındaki renk (ortadan 3:1 kırpma yeşil şeridi verir)
function cardCoverLook (page) {
  return page.evaluate(() => {
    const card = document.getElementById('profile-card')
    const band = card.querySelector('.profile-card-band')
    const img = band.querySelector('img.profile-card-cover')
    const av = card.querySelector('.profile-card-avatar .avatar')
    const b = band.getBoundingClientRect()
    const i = img.getBoundingClientRect()
    const a = av.getBoundingClientRect()
    const onTop = document.elementFromPoint(a.left + a.width / 2, a.top + 3)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0)
    // Tek okuma: art arda getImageData çağrıları Chromium'da konsola uyarı yazar
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
    const at = (x, y) => Array.from(data.slice((y * canvas.width + x) * 4, (y * canvas.width + x) * 4 + 3))
    return {
      w: img.naturalWidth,
      h: img.naturalHeight,
      fills: Math.abs(i.width - b.width) <= 1 && Math.abs(i.height - b.height) <= 1 && Math.abs(i.top - b.top) <= 1,
      overlap: a.top < b.bottom,
      avatarOnTop: Boolean(onTop && av.contains(onTop)),
      samples: [at(12, 12), at(600, 200), at(1188, 388)]
    }
  })
}

// Deniz'in profilini Node tarafında yazar (görünen ad ve isteğe bağlı profil resmi)
async function writeProfile (displayName, avatar) {
  const w = W.w
  const p = w.P.deniz
  const plain = { v: 1, u: p.id, displayName, statusText: '', bio: '', color: 0, avatar: avatar || null }
  const res = await w.call('POST', '/api/me/profile', { profile: w.E.sealJson(w.kid, plain), avatarUploadId: avatar ? avatar.u : null }, p.token)
  assert.equal(res.status, 200, JSON.stringify(res.data))
}

// Şifreli profil resmi yükler, profil zarfına girecek başvuruyu döner
async function uploadAvatar () {
  const w = W.w
  const enc = w.E.encryptFile(new Uint8Array(PNG))
  const res = await w.call('POST', '/api/uploads', null, w.P.deniz.token, Buffer.from(enc.box))
  assert.equal(res.status, 200, JSON.stringify(res.data))
  return { u: res.data.id, k: enc.key, n: enc.nonce, m: 'image/png', w: 256, h: 256 }
}

// Bir kişinin Ece'nin sayfasındaki yüzeylerde görünen adı ve resmi
function surfaces (page, id) {
  return page.evaluate((d) => {
    const one = (sel) => document.querySelector(sel)
    const txt = (sel) => (one(sel) ? one(sel).textContent : null)
    const img = (sel) => Boolean(one(sel) && one(sel).querySelector('img.avatar-img'))
    return {
      tile: txt('.cam-tile[data-user-id="' + d + '"] .cam-tile-name'),
      tileImg: img('.cam-tile[data-user-id="' + d + '"] .cam-tile-avatar'),
      activity: txt('#activity-list li[data-user-id="' + d + '"] .activity-text'),
      activityImg: img('#activity-list li[data-user-id="' + d + '"] .activity-avatar'),
      crew: txt('#radio-crew .crew-item[data-user-id="' + d + '"] .crew-name'),
      crewImg: img('#radio-crew .crew-item[data-user-id="' + d + '"] .crew-avatar'),
      member: txt('#members .member[data-user-id="' + d + '"] .member-name'),
      author: txt('.msg[data-author-id="' + d + '"] .msg-author')
    }
  }, id)
}

// Profil kimliği öğelerinin konumları: avatar, ad, @kullanıcı adı ve rozetler (sel: kimliği içeren kök)
function identityGeometry (page, sel) {
  return page.evaluate((root) => {
    const box = document.querySelector(root)
    const r = (n) => n.getBoundingClientRect()
    const av = r(box.querySelector('.profile-identity > :first-child'))
    const name = r(box.querySelector('.profile-identity-name'))
    const handle = box.querySelector('.profile-identity-handle')
    const hr = handle ? r(handle) : null
    return {
      avLeft: av.left,
      avRight: av.right,
      avBottom: av.bottom,
      nameLeft: name.left,
      nameRight: name.right,
      nameTop: name.top,
      nameMid: (name.top + name.bottom) / 2,
      nameBottom: name.bottom,
      handle: handle ? handle.textContent : null,
      handleLeft: hr ? hr.left : null,
      handleTop: hr ? hr.top : null,
      badges: Array.from(box.querySelectorAll('.profile-identity-badges .badge')).map((b) => ({
        text: b.textContent,
        cls: b.className,
        left: r(b).left,
        top: r(b).top,
        bottom: r(b).bottom,
        mid: (r(b).top + r(b).bottom) / 2
      }))
    }
  }, sel)
}

// Ad avatarın sağında, ilk rozet adla aynı satırda ve sağında, @kullanıcı adı adın altında
function assertIdentity (g, label, badges, handle) {
  assert.ok(g.nameLeft > g.avRight, label + ': ad avatarın sağında (' + g.nameLeft + ' > ' + g.avRight + ')')
  assert.deepEqual(g.badges.map((b) => b.text), badges, label + ': rozetler')
  if (g.badges.length) {
    assert.ok(Math.abs(g.badges[0].mid - g.nameMid) <= 4, label + ': rozet adla aynı satırda (' + g.badges[0].mid + ' ~ ' + g.nameMid + ')')
    assert.ok(g.badges[0].left >= g.nameRight, label + ': rozet adın yanında')
  }
  assert.equal(g.handle, handle, label + ': @kullanıcı adı')
  assert.ok(g.handleTop >= g.nameBottom - 1, label + ': @kullanıcı adı adın altında')
  assert.ok(Math.abs(g.handleLeft - g.nameLeft) <= 1, label + ': ad ve @kullanıcı adı aynı sütunda')
}

// Ses dosyası mesajı: Deniz genel odasına gönderir, Telsiz DJ'de çalınabilir. Parça testin sonuna kadar sürer.
async function sayAudio (name) {
  const w = W.w
  const wav = h.makeWav(120, 8000)
  const enc = w.E.encryptFile(new Uint8Array(wav))
  const up = await w.call('POST', '/api/uploads', null, w.P.deniz.token, Buffer.from(enc.box))
  assert.equal(up.status, 200, JSON.stringify(up.data))
  await w.say('deniz', W.genel, name, [{ u: up.data.id, k: enc.key, n: enc.nonce, kind: 'file', name: name + '.wav', m: 'audio/wav', s: wav.length }], [up.data.id])
}

// Telsiz kartının Ekran düğmesi ve paylaşım penceresiyle ekran paylaşımı başlar
async function shareScreen (page) {
  await page.click('#btn-screen')
  await page.waitForSelector('#cast-dialog:not([hidden]) .cast-dialog-panel')
  await page.click('#cast-dialog .cast-primary')
  await page.waitForSelector('#cast[data-mode="own"]:not([hidden])', { timeout: h.LONG })
}

async function openCard (page, id) {
  await page.evaluate((d) => openProfileCard(d, document.getElementById('me-button')), id)
  await page.waitForSelector('#profile-card:not([hidden]) .profile-identity-name')
}

async function closeCard (page) {
  await page.keyboard.press('Escape')
  await page.waitForSelector('#profile-card', { state: 'hidden' })
}

before(async () => {
  if (test.skipped) return
  W.w = await h.setupWorld({ slot: 23 })
  W.lobi = W.w.room('Lobi')
  W.genel = W.w.room('genel')
  await W.w.say('deniz', W.genel, 'Merhaba, ben Deniz')
  W.ece = await W.w.pageFor('ece')
  W.deniz = await W.w.pageFor('deniz')
})

after(async () => {
  if (W.w) await W.w.close()
})

test('profil değişikliği kameralar ızgarasına, Bildirimler listesine, kişi ses kartına ve profil kartına yansır', async () => {
  const { deniz, ece } = W
  const D = W.w.P.deniz.id
  // Ece önce katılır, Deniz'in katılması Ece'nin Bildirimler listesine düşer
  await h.joinVoice(ece, W.lobi.id)
  await h.joinVoice(deniz, W.lobi.id)
  for (const p of [deniz, ece]) await p.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 2, null, { timeout: h.LONG })
  await deniz.click('#btn-camera')
  await ece.waitForSelector(crewSel(D) + '.has-camera', { timeout: h.LONG })
  await ece.waitForSelector('#radio-cams:not([hidden])', { timeout: h.LONG })
  await ece.click('#radio-cams')
  await ece.waitForSelector('.cam-tile[data-user-id="' + D + '"]', { timeout: h.LONG })
  await ece.waitForFunction((d) => Boolean(document.querySelector('#activity-list li[data-user-id="' + d + '"]')), D, { timeout: h.LONG })
  const before0 = await surfaces(ece, D)
  assert.equal(before0.tile, 'Deniz')
  assert.equal(before0.tileImg, false)
  assert.match(before0.activity, /^Deniz,/)

  // Deniz Ayarlar > Profil'den görünen adını ve profil resmini değiştirir
  await deniz.evaluate(() => openSettings('profile'))
  await deniz.waitForSelector('#set-display-name')
  await deniz.fill('#set-display-name', 'Deniz Yeni')
  await deniz.setInputFiles('#set-avatar-file', { name: 'deniz.png', mimeType: 'image/png', buffer: PNG })
  await deniz.waitForFunction(() => !document.getElementById('set-profile-save').disabled && document.getElementById('set-avatar-msg').classList.contains('is-ok'), null, { timeout: h.LONG })
  await deniz.click('#set-profile-save')
  await deniz.waitForFunction((d) => {
    const rec = profileRecord(d)
    return Boolean(rec && rec.profile && rec.profile.displayName === 'Deniz Yeni' && rec.profile.avatar)
  }, D, { timeout: h.LONG })
  await deniz.keyboard.press('Escape')
  await deniz.waitForSelector('#settings-view', { state: 'hidden' })

  // Ece'de bütün yüzeyler SHORT içinde güncel ad ve resmi gösterir
  await ece.waitForFunction((d) => {
    const q = (sel) => document.querySelector(sel)
    const hasImg = (sel) => Boolean(q(sel) && q(sel).querySelector('img.avatar-img'))
    const tile = q('.cam-tile[data-user-id="' + d + '"] .cam-tile-name')
    const act = q('#activity-list li[data-user-id="' + d + '"] .activity-text')
    return Boolean(tile && tile.textContent === 'Deniz Yeni' && hasImg('.cam-tile[data-user-id="' + d + '"] .cam-tile-avatar') &&
      act && act.textContent.indexOf('Deniz Yeni,') === 0 && hasImg('#activity-list li[data-user-id="' + d + '"] .activity-avatar'))
  }, D, { timeout: h.SHORT })
  const after1 = await surfaces(ece, D)
  assert.equal(after1.crew, 'Deniz Yeni')
  assert.equal(after1.crewImg, true)
  assert.equal(after1.member, 'Deniz Yeni')
  assert.equal(after1.author, 'Deniz Yeni')

  // Izgara kapanır. Ece Deniz'in kişi ses kartını açar, Deniz adını yeniden değiştirir: kartın başlığı güncellenir
  await ece.click('#cast .cast-cams-close')
  await ece.waitForSelector('#cast', { state: 'hidden' })
  await ece.click(crewSel(D) + ' .crew-button')
  await ece.waitForSelector('#peer-popover:not([hidden])')
  assert.equal(await ece.textContent('#peer-name'), 'Deniz Yeni')
  await deniz.evaluate(() => saveProfile({ displayName: 'Deniz Üç', statusText: '', bio: '', color: 0 }))
  await ece.waitForFunction(() => document.getElementById('peer-name').textContent === 'Deniz Üç', null, { timeout: h.SHORT })
  await ece.keyboard.press('Escape')
  await ece.waitForSelector('#peer-popover', { state: 'hidden' })

  // Açık profil kartı da güncellenir
  await ece.evaluate((d) => openProfileCard(d, document.querySelector('#members .member[data-user-id="' + d + '"]')), D)
  await ece.waitForSelector('#profile-card:not([hidden])')
  assert.equal(await ece.textContent('#profile-card-name'), 'Deniz Üç')
  await deniz.evaluate(() => saveProfile({ displayName: 'Deniz Dört', statusText: '', bio: '', color: 0 }))
  await ece.waitForFunction(() => document.getElementById('profile-card-name').textContent === 'Deniz Dört', null, { timeout: h.SHORT })
  await ece.keyboard.press('Escape')
  await ece.waitForSelector('#profile-card', { state: 'hidden' })
  await deniz.click('#btn-camera')
  await ece.waitForSelector(crewSel(D) + '.has-camera', { state: 'detached', timeout: h.LONG })
}, ONLY_CHROMIUM.camera)

test('düşen profil isteği ve profil resmi indirmesi yeniden denenir', async () => {
  const { ece } = W
  const D = W.w.P.deniz.id
  // Deniz'in kimliğini içeren ilk /api/profiles isteği bağlantı hatasıyla düşer
  const mine = new RegExp('[?&]ids=([0-9]+,)*' + D + '(,|$)')
  let profileAborts = 0
  await ece.route('**/api/profiles?*', (route) => {
    if (profileAborts === 0 && mine.test(route.request().url())) {
      profileAborts++
      return route.abort('connectionreset')
    }
    return route.continue()
  })
  const t0 = Date.now()
  await writeProfile('Deniz Beş', null)
  await ece.waitForFunction((d) => {
    const n = document.querySelector('#members .member[data-user-id="' + d + '"] .member-name')
    return Boolean(n && n.textContent === 'Deniz Beş')
  }, D, { timeout: h.SHORT })
  assert.equal(profileAborts, 1, 'ilk istek düşürüldü')
  assert.ok(Date.now() - t0 >= 1500, 'ad yeniden denemeyle geldi')
  await ece.unroute('**/api/profiles?*')

  // İlk profil resmi indirmesi düşer, 10 saniye sonraki deneme resmi getirir
  const avatar = await uploadAvatar()
  let uploadAborts = 0
  await ece.route('**/api/uploads/' + avatar.u, (route) => {
    if (uploadAborts === 0) {
      uploadAborts++
      return route.abort('connectionreset')
    }
    return route.continue()
  })
  await writeProfile('Deniz Altı', avatar)
  await ece.waitForFunction((d) => {
    const n = document.querySelector('#members .member[data-user-id="' + d + '"] .member-name')
    return Boolean(n && n.textContent === 'Deniz Altı')
  }, D, { timeout: h.SHORT })
  await ece.waitForFunction((u) => {
    const entry = profileState.avatars.get(u)
    return Boolean(entry && entry.state === 'failed' && entry.tries === 1)
  }, avatar.u, { timeout: h.SHORT })
  assert.equal(uploadAborts, 1)
  await ece.waitForFunction((d) => Boolean(document.querySelector('#members .member[data-user-id="' + d + '"] img.avatar-img')), D, { timeout: h.LONG })
  await ece.unroute('**/api/uploads/' + avatar.u)
}, ONLY_CHROMIUM.aborted)

test('kart düzeni üç temada: ad avatarın sağında, rol adın yanında, üyede Üye rozeti, özel rol de görünür', async () => {
  const { ece } = W
  const P = W.w.P
  // Ece'ye özel rol verilir: kartında, avatar menüsünde ve Ayarlar önizlemesinde iki rozet
  let res = await W.w.call('POST', '/api/roles/create', { name: 'Moderatör', color: 'green', perms: [] }, P.deniz.token)
  assert.equal(res.status, 200, JSON.stringify(res.data))
  res = await W.w.call('POST', '/api/users/custom-role', { userId: P.ece.id, roleId: res.data.role.id }, P.deniz.token)
  assert.equal(res.status, 200, JSON.stringify(res.data))
  await ece.waitForFunction((d) => Boolean(document.querySelector('#members .member[data-user-id="' + d + '"] .badge-custom')), P.ece.id, { timeout: h.LONG })
  const people = [
    ['deniz', ['Sahip']],
    ['mert', ['Üye']],
    ['ece', ['Üye', 'Moderatör']]
  ]
  for (const skin of SKINS) {
    await ece.evaluate((s) => window.TelsizTheme.set({ skin: s }), skin)
    for (const [who, badges] of people) {
      await openCard(ece, P[who].id)
      const g = await identityGeometry(ece, '#profile-card')
      assertIdentity(g, skin + ' ' + who, badges, '@' + who)
      if (who === 'mert') assert.equal(g.badges[0].cls, 'badge badge-member', 'soluk Üye rozeti')
      await closeCard(ece)
    }
    // Avatar menüsü: rol ve özel rol adın yanında, altında @kullanıcı adı
    await ece.click('#me-button')
    await ece.waitForSelector('#status-menu:not([hidden]) .menu-head')
    assertIdentity(await identityGeometry(ece, '#status-menu .menu-head'), skin + ' avatar menüsü', ['Üye', 'Moderatör'], '@ece')
    await ece.keyboard.press('Escape')
    await ece.waitForSelector('#status-menu', { state: 'hidden' })
  }
  // Ayarlar > Hesabım önizlemesi: kartla aynı düzen ve rozetler
  await ece.evaluate(() => openSettings('account'))
  await ece.waitForSelector('#set-account-preview .profile-identity-name')
  assertIdentity(await identityGeometry(ece, '#set-account-preview'), 'önizleme', ['Üye', 'Moderatör'], '@ece')
  await ece.keyboard.press('Escape')
  await ece.waitForSelector('#settings-view', { state: 'hidden' })
  // 360 piksel genişlikte kart ekrana sığar, düzen aynı kalır, sayfada yatay taşma yok
  await ece.evaluate(() => window.TelsizTheme.set({ skin: 'arcade' }))
  await ece.setViewportSize({ width: 360, height: 780 })
  await openCard(ece, P.deniz.id)
  assertIdentity(await identityGeometry(ece, '#profile-card'), '360 deniz', ['Sahip'], '@deniz')
  const fits = await ece.evaluate(() => {
    const b = document.getElementById('profile-card').getBoundingClientRect()
    return b.left >= 0 && b.right <= document.documentElement.clientWidth
  })
  assert.ok(fits, 'kart 360 piksele sığar')
  assert.ok(await h.overflowX(ece) <= 0, 'yatay taşma yok')
  await closeCard(ece)
  // Büyük yazı boyutunda (18 piksel) kart ekran genişliğine yaklaşır, yine de kenarlardan taşmaz. Ad avatarın sağında
  // kalır (rozet sığmazsa alt satıra kayabilir)
  await ece.evaluate(() => window.TelsizTheme.set({ fontSize: 'large' }))
  await openCard(ece, P.deniz.id)
  const large = await identityGeometry(ece, '#profile-card')
  assert.ok(large.nameLeft > large.avRight, '360 büyük yazı: ad avatarın sağında')
  const fitsLarge = await ece.evaluate(() => {
    const b = document.getElementById('profile-card').getBoundingClientRect()
    return b.left >= 0 && b.right <= document.documentElement.clientWidth
  })
  assert.ok(fitsLarge, 'büyük yazıda kart 360 piksele sığar')
  await closeCard(ece)
  await ece.evaluate(() => window.TelsizTheme.set({ fontSize: 'auto' }))
  await ece.setViewportSize({ width: 1440, height: 900 })
}, ONLY_CHROMIUM.layout)

test('kart 18rem\'den darsa ad ve rol avatarın altına kayar, uzun adda rozet adın altındaki satıra geçer', async () => {
  const { ece } = W
  const P = W.w.P
  await ece.evaluate(() => window.TelsizTheme.set({ skin: 'arcade' }))
  // Dar kart (16rem): ad, Sahip rozeti ve @kullanıcı adı avatarın altında, avatarla aynı sol kenarda. Rozet adla aynı
  // satırda kalır, kartta yatay taşma yok
  await openCard(ece, P.deniz.id)
  await ece.evaluate(() => {
    document.getElementById('profile-card').style.width = '16rem'
  })
  const narrow = await identityGeometry(ece, '#profile-card')
  assert.ok(narrow.nameTop >= narrow.avBottom - 1, 'dar kart: ad avatarın altında (' + narrow.nameTop + ' >= ' + narrow.avBottom + ')')
  assert.ok(Math.abs(narrow.nameLeft - narrow.avLeft) <= 1, 'dar kart: ad avatarla aynı sol kenarda (' + narrow.nameLeft + ' ~ ' + narrow.avLeft + ')')
  assert.deepEqual(narrow.badges.map((b) => b.text), ['Sahip'], 'dar kart: rozet')
  assert.ok(Math.abs(narrow.badges[0].mid - narrow.nameMid) <= 4, 'dar kart: rozet adla aynı satırda')
  assert.ok(narrow.handleTop >= narrow.nameBottom - 1 && Math.abs(narrow.handleLeft - narrow.nameLeft) <= 1, 'dar kart: @kullanıcı adı adın altında')
  const spill = await ece.evaluate(() => {
    const card = document.getElementById('profile-card')
    return card.scrollWidth - card.clientWidth
  })
  assert.ok(spill <= 0, 'dar kartta yatay taşma yok (' + spill + ')')
  await ece.evaluate(() => {
    document.getElementById('profile-card').style.width = ''
  })
  await closeCard(ece)

  // Mert'in görünen adı 32 karakter ve boşluklu: ad avatarın sağında kalıp satırlara bölünür, Üye rozeti adın
  // altındaki satırda adın sol kenarından başlar, @kullanıcı adı rozetin altında
  const w = W.w
  const long = 'Mehmet Ertuğrul Kaan Yıldırımkan'
  assert.equal(long.length, 32)
  const setMert = async (displayName) => {
    const plain = { v: 1, u: P.mert.id, displayName, statusText: '', bio: '', color: 2, avatar: null }
    const res = await w.call('POST', '/api/me/profile', { profile: w.E.sealJson(w.kid, plain), avatarUploadId: null }, P.mert.token)
    assert.equal(res.status, 200, JSON.stringify(res.data))
    await ece.waitForFunction((a) => userDisplayName(a.id) === a.name, { id: P.mert.id, name: displayName }, { timeout: h.SHORT })
  }
  await setMert(long)
  await openCard(ece, P.mert.id)
  const g = await identityGeometry(ece, '#profile-card')
  assert.ok(g.nameLeft > g.avRight, 'uzun ad avatarın sağında (' + g.nameLeft + ' > ' + g.avRight + ')')
  assert.deepEqual(g.badges.map((b) => b.text), ['Üye'], 'uzun ad: rozet')
  assert.ok(g.badges[0].top >= g.nameBottom - 1, 'uzun ad: rozet adın altındaki satırda (' + g.badges[0].top + ' >= ' + g.nameBottom + ')')
  assert.ok(Math.abs(g.badges[0].left - g.nameLeft) <= 1, 'uzun ad: rozet adın sol kenarından başlar (' + g.badges[0].left + ' ~ ' + g.nameLeft + ')')
  assert.equal(g.handle, '@mert')
  assert.ok(g.handleTop >= g.badges[0].bottom - 1, 'uzun ad: @kullanıcı adı rozetin altında')
  await closeCard(ece)
  await setMert('Mert')
}, ONLY_CHROMIUM.layout)

test('profil değişikliği Telsiz DJ kuyruğuna, paylaşan seçicisine ve izleyici yığınına yansır, Bildirimler odağı korur', async () => {
  const { deniz, ece } = W
  const D = W.w.P.deniz.id
  const E = W.w.P.ece.id
  // Deniz genel odasındaki iki ses dosyasını Telsiz DJ'de çalar: ilki çalar, ikincisi kuyrukta bekler
  await sayAudio('birinci-parca')
  await sayAudio('ikinci-parca')
  await deniz.evaluate((id) => selectChannel(id, {}), W.genel.id)
  await deniz.waitForFunction(() => document.querySelectorAll('#message-list .dj-play-file').length === 2, null, { timeout: h.LONG })
  const plays = await deniz.$$('#message-list .dj-play-file')
  await plays[0].click()
  await deniz.waitForFunction(() => {
    const s = dj.engine.snapshot()
    return Boolean(s.session && s.session.current)
  }, null, { timeout: h.LONG })
  await plays[1].click()
  const queueBy = '#dj .dj-queue .dj-queue-item .dj-queue-by'
  const byName = (name) => ece.waitForFunction((a) => {
    const rows = document.querySelectorAll(a.sel)
    return rows.length === 1 && rows[0].textContent.endsWith('ekleyen: ' + a.name)
  }, { sel: queueBy, name }, { timeout: h.LONG })
  await byName('Deniz Altı')
  // Deniz adını değiştirir (resmi kalkar): Ece'nin kuyruğundaki ekleyen adı güncellenir
  await writeProfile('Deniz Yedi', null)
  await byName('Deniz Yedi')

  // Deniz paylaşır. Ece'nin Bildirimler listesindeki İzle düğmesi odaktayken Deniz adını değiştirir: liste güncellenir,
  // odak aynı kaydın İzle düğmesinde kalır
  await shareScreen(deniz)
  const shareRow = '#activity-list li.is-share[data-user-id="' + D + '"]'
  await ece.waitForSelector(shareRow + ' .activity-watch', { timeout: h.LONG })
  await ece.focus(shareRow + ' .activity-watch')
  await writeProfile('Deniz Sekiz', null)
  await ece.waitForFunction((sel) => {
    const n = document.querySelector(sel + ' .activity-text')
    return Boolean(n && n.textContent.startsWith('Deniz Sekiz '))
  }, shareRow, { timeout: h.SHORT })
  const focus = await ece.evaluate(() => {
    const a = document.activeElement
    const li = a ? a.closest('li') : null
    return { watch: Boolean(a && a.classList.contains('activity-watch')), user: li ? li.getAttribute('data-user-id') : null, kind: li ? li.classList.contains('is-share') : null }
  })
  assert.deepEqual(focus, { watch: true, user: String(D), kind: true }, 'odak İzle düğmesinde kalır')

  // Ece de paylaşır: sahnesindeki paylaşan seçicisinde Deniz ve Siz düğmeleri. Deniz Ece'nin paylaşımını izler, Ece'nin
  // izleyici yığınında Deniz'in avatarı (resimsiz) görünür
  await shareScreen(ece)
  const chip = '#cast .cast-pick:not([hidden]) .cast-chip[data-cast-user="' + D + '"]'
  await ece.waitForSelector(chip, { timeout: h.LONG })
  assert.equal(await ece.textContent(chip + ' .cast-chip-name'), 'Deniz Sekiz')
  const eceChip = '#cast .cast-pick:not([hidden]) .cast-chip[data-cast-user="' + E + '"]'
  await deniz.waitForSelector(eceChip, { timeout: h.LONG })
  await deniz.click(eceChip)
  await deniz.waitForSelector('#cast[data-mode="watch"]:not([hidden])', { timeout: h.LONG })
  const viewer = '#cast .cast-viewers-stack .avatar[data-user-id="' + D + '"]'
  await ece.waitForSelector(viewer, { timeout: h.LONG })
  assert.equal(await ece.$(viewer + ' img.avatar-img'), null, 'Deniz\'in resmi yok')
  // Deniz adını ve resmini değiştirir: seçicideki ad ve avatar, izleyici yığınındaki avatar güncellenir
  const avatar = await uploadAvatar()
  await writeProfile('Deniz Dokuz', avatar)
  await ece.waitForFunction((a) => {
    const name = document.querySelector(a.chip + ' .cast-chip-name')
    return Boolean(name && name.textContent === 'Deniz Dokuz' && document.querySelector(a.chip + ' img.avatar-img') && document.querySelector(a.viewer + ' img.avatar-img'))
  }, { chip, viewer }, { timeout: h.SHORT })

  // Paylaşımlar durur, iki sahne de kapanır
  for (const p of [deniz, ece]) await p.evaluate(() => document.getElementById('btn-screen').click())
  for (const p of [deniz, ece]) await p.waitForFunction(() => document.getElementById('cast').hidden, null, { timeout: h.LONG })
}, ONLY_CHROMIUM.screen)

test('kapak fotoğrafı Ayarlar > Profil\'den yüklenir, yalnızca kart açılınca iner, diskte düz baytı yok, eski istemcinin kaydı kapağı kaldırır', async () => {
  const { deniz, ece } = W
  const w = W.w
  const D = w.P.deniz.id
  // Ece'nin yükleme indirmeleri kaydedilir (kapağın ne zaman indiği için)
  const downloads = []
  ece.on('request', (req) => {
    const m = /\/api\/uploads\/([0-9a-f]{32})$/.exec(req.url())
    if (m) downloads.push(m[1])
  })

  // Deniz kapak seçer: bant önizlemesinde ve profil kartı önizlemesinde görünür, kaydeder
  await deniz.evaluate(() => openSettings('profile'))
  await deniz.waitForSelector('#set-cover-pick')
  assert.equal(await deniz.textContent('#set-cover-title'), 'Kapak fotoğrafı')
  await deniz.setInputFiles('#set-cover-file', { name: 'kapak.png', mimeType: 'image/png', buffer: stripesPng(900) })
  await deniz.waitForFunction(() => document.getElementById('set-cover-msg').classList.contains('is-ok') && !document.getElementById('set-profile-save').disabled, null, { timeout: h.LONG })
  assert.equal(await deniz.textContent('#set-cover-msg'), 'Kapak hazır, kaydedince yüklenir.')
  for (const sel of ['#set-cover-preview', '#set-profile-card']) assert.ok(await deniz.$(sel + ' .profile-card-band.has-cover img.profile-card-cover'), sel)
  await deniz.click('#set-profile-save')
  await deniz.waitForFunction((d) => {
    const rec = profileRecord(d)
    return Boolean(rec && rec.profile && rec.profile.cover)
  }, D, { timeout: h.LONG })
  const coverId = await coverIdOf(deniz, D)
  // Sunucudaki kapak Deniz'in cihazında çözülür ve önizlemede yerel kopyanın yerini alır
  await deniz.waitForFunction((u) => {
    const entry = profileState.covers.get(u)
    const img = document.querySelector('#set-profile-card img.profile-card-cover')
    return Boolean(entry && entry.state === 'ok' && img && img.src === entry.url)
  }, coverId, { timeout: h.LONG })
  await deniz.keyboard.press('Escape')
  await deniz.waitForSelector('#settings-view', { state: 'hidden' })

  // Ece profili alır ama kartı açmadan kapak indirilmez
  await ece.waitForFunction((a) => {
    const rec = profileRecord(a.d)
    return Boolean(rec && rec.profile && rec.profile.cover && rec.profile.cover.u === a.u)
  }, { d: D, u: coverId }, { timeout: h.SHORT })
  await h.sleep(500)
  assert.equal(downloads.filter((u) => u === coverId).length, 0, 'kart açılmadan kapak indirilmez')

  // Kart açılınca kapak bir kez iner. Üç temada bandı doldurur, avatar kapağın üstündedir, kırpma ortadan 3:1'dir.
  for (const skin of SKINS) {
    await ece.evaluate((s) => window.TelsizTheme.set({ skin: s }), skin)
    await openCard(ece, D)
    await ece.waitForFunction(() => {
      const img = document.querySelector('#profile-card .profile-card-band.has-cover img.profile-card-cover')
      return Boolean(img && img.complete && img.naturalWidth > 0)
    }, null, { timeout: h.SHORT })
    const look = await cardCoverLook(ece)
    assert.deepEqual([look.w, look.h], [1200, 400], skin + ': 1200x400')
    assert.ok(look.fills, skin + ': kapak bandı doldurur')
    assert.ok(look.overlap && look.avatarOnTop, skin + ': avatar banda biner ve kapağın üstünde kalır')
    for (const [r, g, b] of look.samples) assert.ok(g > 150 && r < 90 && b < 110, skin + ': ortadaki yeşil şerit ' + [r, g, b])
    await closeCard(ece)
  }
  assert.equal(downloads.filter((u) => u === coverId).length, 1, 'kapak bir kez indirilir')
  await ece.evaluate(() => window.TelsizTheme.set({ skin: 'arcade' }))

  // Veri klasöründe yalnızca şifreli kapak: dosya profildeki anahtarla çözülür, düz JPEG baytları hiçbir dosyada yok
  const ref = await ece.evaluate((d) => {
    const c = profileRecord(d).profile.cover
    return { k: c.k, n: c.n, m: c.m }
  }, D)
  assert.equal(ref.m, 'image/jpeg')
  const files = h.readDataDir(w.srv.dataDir)
  const stored = files.find((f) => path.basename(f.file) === coverId + '.bin')
  assert.ok(stored, 'şifreli kapak dosyası')
  const plain = Buffer.from(w.E.decryptFile(new Uint8Array(stored.data), ref.k, ref.n))
  assert.deepEqual(Array.from(plain.subarray(0, 3)), [0xff, 0xd8, 0xff], 'kapak JPEG')
  assert.equal(stored.data.length, plain.length + 16)
  assert.ok(plain.length <= 1024 * 1024, 'kapak 1 MB sınırında')
  for (const f of files) {
    for (const at of [0, Math.floor(plain.length / 2), plain.length - 64]) {
      assert.equal(f.data.indexOf(plain.subarray(at, at + 64)), -1, f.file + ' içinde düz kapak baytları')
    }
  }

  // Kapağı bilmeyen eski istemci profili kaydeder (zarfta kapak yok, coverUploadId gönderilmez): sunucu kapağı kaldırır,
  // Ece'nin kartında kapak görünmez, dosya silinir
  await writeProfile('Deniz On', null)
  await ece.waitForFunction((d) => {
    const rec = profileRecord(d)
    return Boolean(rec && rec.profile && rec.profile.displayName === 'Deniz On' && !rec.profile.cover && !rec.coverUploadId)
  }, D, { timeout: h.SHORT })
  await openCard(ece, D)
  assert.equal(await ece.$('#profile-card .profile-card-band.has-cover'), null)
  assert.ok(await ece.$('#profile-card .profile-card-band'))
  await closeCard(ece)
  await h.until(() => !fs.existsSync(stored.file), h.SHORT, 'eski kapak silindi')
})

test('İngilizce arayüzde kapak seçilir ve Remove Cover ile kaldırılır, açık karttaki kapak da kalkar', async () => {
  const { deniz, ece } = W
  const D = W.w.P.deniz.id
  await deniz.evaluate(() => openSettings('appearance'))
  await deniz.waitForSelector('#set-lang')
  await deniz.selectOption('#set-lang', 'en')
  await deniz.waitForFunction(() => document.documentElement.lang === 'en')
  await deniz.evaluate(() => showSettingsCat('profile', 'title'))
  await deniz.waitForSelector('#set-cover-pick')
  const labels = await deniz.evaluate(() => [
    document.getElementById('set-cover-title').textContent,
    document.querySelector('#set-cover-pick .button-text').textContent,
    document.querySelector('#set-cover-remove .button-text').textContent
  ])
  assert.deepEqual(labels, ['Cover photo', 'Choose Cover', 'Remove Cover'])
  await deniz.setInputFiles('#set-cover-file', { name: 'cover.png', mimeType: 'image/png', buffer: stripesPng(600) })
  await deniz.waitForFunction(() => document.getElementById('set-cover-msg').classList.contains('is-ok'), null, { timeout: h.LONG })
  assert.equal(await deniz.textContent('#set-cover-msg'), 'Cover ready. It uploads when you save.')
  await deniz.click('#set-profile-save')
  await deniz.waitForFunction((d) => {
    const rec = profileRecord(d)
    return Boolean(rec && rec.profile && rec.profile.cover)
  }, D, { timeout: h.LONG })
  const coverId = await coverIdOf(deniz, D)

  // Ece kartı açık tutar, kapak görünür. Deniz kapağı kaldırıp kaydeder: açık karttaki kapak kalkar.
  await ece.waitForFunction((a) => {
    const rec = profileRecord(a.d)
    return Boolean(rec && rec.profile && rec.profile.cover && rec.profile.cover.u === a.u)
  }, { d: D, u: coverId }, { timeout: h.SHORT })
  await openCard(ece, D)
  await ece.waitForSelector('#profile-card .profile-card-band.has-cover img.profile-card-cover', { timeout: h.SHORT })
  await deniz.click('#set-cover-remove')
  assert.equal(await deniz.textContent('#set-cover-msg'), 'The cover is removed when you save.')
  assert.equal(await deniz.$('#set-profile-card .profile-card-band.has-cover'), null)
  await deniz.click('#set-profile-save')
  await deniz.waitForFunction((d) => {
    const rec = profileRecord(d)
    return Boolean(rec && rec.profile && !rec.profile.cover)
  }, D, { timeout: h.LONG })
  await ece.waitForFunction(() => !document.querySelector('#profile-card .profile-card-band.has-cover') && Boolean(document.querySelector('#profile-card .profile-card-band')), null, { timeout: h.SHORT })
  await closeCard(ece)
  await h.until(() => !fs.existsSync(path.join(W.w.srv.dataDir, 'uploads', coverId + '.bin')), h.SHORT, 'kaldırılan kapak silindi')

  // Arayüz Türkçeye döner
  await deniz.evaluate(() => showSettingsCat('appearance', 'title'))
  await deniz.waitForSelector('#set-lang')
  await deniz.selectOption('#set-lang', 'tr')
  await deniz.waitForFunction(() => document.documentElement.lang === 'tr')
  await deniz.keyboard.press('Escape')
  await deniz.waitForSelector('#settings-view', { state: 'hidden' })
})

test('konsol ve sunucu günlüğü temiz', async () => {
  // Bilerek düşürülen istekler (route.abort) Ece'nin konsoluna ağ hatası olarak yazılır, beklenen bir durumdur
  const aborted = (l) => l.label === 'ece' && l.type === 'error' && /ERR_CONNECTION_RESET/.test(l.text) && /\/api\/(profiles|uploads)/.test(l.url)
  // İki istemci Telsiz DJ durumunu aynı anda yazınca sunucu sürüm denetimi (CAS) birini 409 ile reddeder, motor yeni
  // durumla yeniden dener (06-dj.test.js ile aynı gerekçe). Tarayıcı yanıtı "Failed to load resource" olarak yazar.
  const casConflict = (l) => l.type === 'error' && /status of 409/.test(l.text) && /\/api\/music\/state$/.test(l.url)
  h.assertCleanConsole(W.w.logs, W.w.srv.errors, [aborted, casConflict])
})
