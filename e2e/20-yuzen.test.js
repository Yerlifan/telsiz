'use strict'

// Yüzen pencere (istek 7), Chromium'un belge resim içinde resim penceresiyle (documentPictureInPicture). Deniz ve
// Mert Lobi'ye katılır. Telsiz kartının araç satırında Yüzen Pencere düğmesi görünür. Mert kamerasını açar, Deniz
// düğmeye basar: yüzen pencerede Mert'in kutusunda görüntü gerçekten oynar, pencere uygulamanın temasını ve simge
// kümesini taşır, kontroller Mikrofon, Uygulamaya Dön ve Kapat'tır (Ayrıl yok). Mert kamerasını kapatınca kutusu
// avatara döner, Mert konuşunca (sahte mikrofonun bipleri) avatarının çevresinde canlı renkli halka yanar. Yüzen
// penceredeki Mikrofon düğmesi Deniz'in mikrofonunu kapatıp açar. Kapat'a basınca pencere kapanır ve 'float-'
// önekli görüntü öğeleri bırakılır. Belge resim içinde resim yokken görüntü yedeği (tuval akışı) açılır.
// Ayarlar > Ses ve Görüntü'deki anahtar telsiz.floatAuto değerini yazar.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { w: null, deniz: null, mert: null, lobi: null }
// Sahte kamera, mikrofon ve belge resim içinde resim yalnızca Chromium'da doğrulandı
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []), { browsers: ['chromium'], reason: 'sahte medya aygıtı ve belge resim içinde resim yalnızca Chromium\'da' })

// Yüzen belgede sorgu: fn(doc, arg) sayfada yüzen belgeyle çalışır, belge yoksa null döner
function inFloat (page, fn, arg) {
  const value = JSON.stringify(arg === undefined ? null : arg)
  return page.evaluate('(() => { const pip = window.documentPictureInPicture ? window.documentPictureInPicture.window : null; if (!pip) return null; return (' + fn.toString() + ')(pip.document, ' + value + ') })()')
}

function waitFloat (page, fn, arg, label) {
  return h.until(async () => {
    const value = await inFloat(page, fn, arg)
    return value || null
  }, h.LONG, label)
}

before(async () => {
  if (test.skipped) return
  W.w = await h.setupWorld({ slot: 29 })
  W.lobi = W.w.room('Lobi')
  W.deniz = await W.w.pageFor('deniz')
  W.mert = await W.w.pageFor('mert')
})

after(async () => {
  if (W.w) await W.w.close()
})

test('ses odasında araç satırında Yüzen Pencere düğmesi görünür, odadan önce görünmez', async () => {
  const { deniz, mert } = W
  assert.equal(await deniz.$('#radio-float'), null)
  await h.joinVoice(mert, W.lobi.id)
  await h.joinVoice(deniz, W.lobi.id)
  for (const page of [deniz, mert]) {
    await page.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 2, null, { timeout: h.LONG })
  }
  await deniz.waitForSelector('#radio-tools #radio-float')
  const r = await deniz.evaluate(() => {
    const b = document.getElementById('radio-float')
    const tools = Array.from(document.getElementById('radio-tools').children)
    return {
      label: b.getAttribute('aria-label'),
      title: b.title,
      pressed: b.getAttribute('aria-pressed'),
      beforeDj: tools.indexOf(b) < tools.indexOf(document.querySelector('#radio-tools .crew-dj')),
      mode: floatMode()
    }
  })
  assert.deepEqual(r, { label: 'Ses odasını yüzen pencerede aç', title: 'Yüzen Pencere', pressed: 'false', beforeDj: true, mode: 'document' })
})

test('yüzen pencerede Mert\'in kamerası oynar, tema ve kontroller gelir', async () => {
  const { deniz, mert } = W
  const mertId = String(W.w.P.mert.id)
  await mert.click('#btn-camera')
  await deniz.waitForFunction((id) => Boolean(document.querySelector('#radio-crew .crew-item[data-user-id="' + id + '"] .crew-avatar.has-camera')), mertId, { timeout: h.LONG })
  await deniz.click('#radio-float')
  await deniz.waitForFunction(() => Boolean(window.documentPictureInPicture.window), null, { timeout: h.LONG })
  // Görüntü ilk kare olayıyla (loadeddata, playing) görünür olur (is-ready), olay oynatmadan biraz sonra gelebilir
  const playing = await waitFloat(deniz, (doc, id) => {
    const v = doc.querySelector('.float-tile.is-cam[data-user-id="' + id + '"] video.cam-video')
    return v && v.readyState >= 2 && v.videoWidth > 0 && !v.paused && v.classList.contains('is-ready') ? { w: v.videoWidth, opacity: getComputedStyle(v).opacity } : null
  }, mertId, 'Mert\'in görüntüsü yüzen pencerede oynar')
  assert.ok(playing.w > 0)
  assert.equal(playing.opacity, '1')
  // Stil dosyaları yüklenene kadar yüzen belgenin gövdesi görünmez, yüklenince gösterilir
  await waitFloat(deniz, (doc) => doc.body.style.visibility !== 'hidden' && getComputedStyle(doc.body).visibility === 'visible', null, 'stil dosyaları yüklenince içerik görünür')
  const view = await inFloat(deniz, (doc) => {
    const frame = doc.querySelector('.float-tile.is-cam .float-frame')
    return {
      kind: doc.body.getAttribute('data-kind'),
      skin: doc.documentElement.getAttribute('data-skin'),
      scheme: doc.documentElement.getAttribute('data-scheme'),
      title: doc.title,
      head: doc.querySelector('.float-title').textContent,
      radius: getComputedStyle(frame).borderTopLeftRadius,
      controls: Array.from(doc.querySelectorAll('.float-controls button')).map((b) => b.getAttribute('aria-label') || b.textContent),
      icon: Boolean(doc.querySelector('symbol#i-mic')),
      strip: Array.from(doc.querySelectorAll('.float-strip .float-tile')).map((n) => n.classList.contains('is-self')),
      // Yerleşim: kontroller pencerenin içinde, kamera kutusu görünür boyutta, yatay taşma yok
      fits: doc.querySelector('.float-controls').getBoundingClientRect().bottom <= doc.defaultView.innerHeight + 1,
      size: [doc.defaultView.innerWidth, doc.defaultView.innerHeight, Math.round(doc.querySelector('.float-controls').getBoundingClientRect().bottom)],
      frameH: Math.round(frame.getBoundingClientRect().height),
      overflow: doc.documentElement.scrollWidth - doc.documentElement.clientWidth
    }
  })
  assert.equal(view.kind, 'cams')
  assert.deepEqual([view.skin, view.scheme], ['arcade', 'dark'])
  assert.equal(view.title, 'Lobi · Telsiz')
  assert.equal(view.head, 'Lobi')
  assert.notEqual(view.radius, '0px', 'stil dosyaları yüklendi')
  assert.deepEqual(view.controls, ['Mikrofonu kapat', 'Uygulamaya Dön', 'Yüzen Pencereyi Kapat'])
  assert.equal(view.icon, true, 'simge kümesi kopyalandı ' + JSON.stringify(view))
  // Kamerası kapalı Deniz (siz) altta şeritte
  assert.deepEqual(view.strip, [true])
  assert.equal(view.fits, true, 'kontroller pencerenin içinde ' + JSON.stringify(view))
  assert.ok(view.frameH >= 60, 'kamera kutusu ' + view.frameH)
  assert.ok(view.overflow <= 0, 'yatay taşma ' + view.overflow)
  assert.equal(await deniz.getAttribute('#radio-float', 'aria-pressed'), 'true')
  assert.equal(await deniz.getAttribute('#radio-float', 'aria-label'), 'Yüzen Pencereyi Kapat')
})

test('Mert kamerasını kapatınca kutusu avatara döner, konuşunca halka yanar', async () => {
  const { deniz, mert } = W
  const mertId = String(W.w.P.mert.id)
  await mert.click('#btn-camera')
  await waitFloat(deniz, (doc, id) => {
    const tile = doc.querySelector('.float-tile[data-user-id="' + id + '"]')
    return tile && !tile.classList.contains('is-cam') && doc.body.getAttribute('data-kind') === 'avatars' && !doc.querySelector('video')
  }, mertId, 'Mert\'in kutusu avatara döner')
  // Sahte mikrofon aralıklı bip verir: konuşma halkası açılıp kapanır. Sınıf ve gölge aynı anda okunur.
  const ring = await waitFloat(deniz, (doc, id) => {
    const tile = doc.querySelector('.float-tile.is-speaking[data-user-id="' + id + '"]')
    if (!tile) return null
    const face = tile.querySelector('.avatar-face')
    const shadow = getComputedStyle(face).boxShadow
    return shadow && shadow !== 'none' ? { shadow, name: getComputedStyle(tile.querySelector('.float-name')).color } : null
  }, mertId, 'Mert konuşunca halka yanar')
  const live = await deniz.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--live)'
    document.body.appendChild(probe)
    const color = getComputedStyle(probe).color
    probe.remove()
    return color
  })
  assert.ok(ring.shadow.indexOf(live) !== -1, ring.shadow + ' / ' + live)
  assert.equal(ring.name, live)
})

test('yüzen penceredeki Mikrofon düğmesi mikrofonu kapatıp açar', async () => {
  const { deniz } = W
  await deniz.evaluate(() => window.documentPictureInPicture.window.document.querySelector('.float-mic').click())
  await deniz.waitForFunction(() => snap().muted === true, null, { timeout: h.LONG })
  await waitFloat(deniz, (doc) => {
    const b = doc.querySelector('.float-mic')
    return b.getAttribute('aria-pressed') === 'true' && b.classList.contains('is-off') && b.querySelector('use').getAttribute('href') === '#i-mic-off'
  }, null, 'mikrofon düğmesi kapalı görünür')
  await deniz.evaluate(() => window.documentPictureInPicture.window.document.querySelector('.float-mic').click())
  await deniz.waitForFunction(() => snap().muted === false, null, { timeout: h.LONG })
})

test('Kapat\'a basınca pencere kapanır ve float- görüntü öğeleri bırakılır', async () => {
  const { deniz, mert } = W
  // Kamera yeniden açılır: kapanışta bırakılacak bir görüntü öğesi olsun
  await mert.click('#btn-camera')
  await waitFloat(deniz, (doc) => Boolean(doc.querySelector('.float-tile.is-cam video')), null, 'kamera kutusu geri gelir')
  assert.ok(await deniz.evaluate(() => Array.from(cameraVideos.keys()).filter((k) => k.indexOf('float-') === 0).length) > 0)
  await deniz.evaluate(() => window.documentPictureInPicture.window.document.querySelector('.float-close').click())
  await deniz.waitForFunction(() => !window.documentPictureInPicture.window && !floatIsOpen(), null, { timeout: h.LONG })
  const left = await deniz.evaluate(() => ({
    videos: Array.from(cameraVideos.keys()).filter((k) => k.indexOf('float-') === 0).length,
    pressed: document.getElementById('radio-float').getAttribute('aria-pressed')
  }))
  assert.deepEqual(left, { videos: 0, pressed: 'false' })
  await mert.click('#btn-camera')
})

// Safari ve Android Chrome'daki yedek: belge resim içinde resim yokken kutular bir tuvale çizilir, tuvalin akışı
// görüntü resim içinde resim olarak açılır. Chromium'da belge API'si gizlenerek sınanır.
test('görüntü yedeği: belge resim içinde resim yokken tuval akışı resim içinde resim olarak açılır', async () => {
  const { deniz } = W
  await deniz.evaluate(() => {
    window.__dpip = window.documentPictureInPicture
    Object.defineProperty(window, 'documentPictureInPicture', { value: undefined, configurable: true })
  })
  try {
    assert.equal(await deniz.evaluate(() => floatMode()), 'video')
    await deniz.click('#radio-float')
    await deniz.waitForFunction(() => {
      const v = document.pictureInPictureElement
      return Boolean(v && v.classList.contains('float-pip-video') && floatState.mode === 'video')
    }, null, { timeout: h.LONG })
    // Tuval boş değil: kutular çizildi (kamera görüntüsü veya avatar)
    const drawn = await deniz.waitForFunction(() => {
      const c = document.querySelector('.float-pip-source canvas')
      if (!c) return null
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
      const colors = new Set()
      let i = 0
      while (i < d.length) {
        colors.add(d[i] + ',' + d[i + 1] + ',' + d[i + 2])
        i += 4 * 97
      }
      return colors.size > 3 ? { w: c.width, h: c.height } : null
    }, null, { timeout: h.LONG })
    assert.deepEqual(await drawn.jsonValue(), { w: 480, h: 270 })
    assert.equal(await deniz.getAttribute('#radio-float', 'aria-pressed'), 'true')
    // Düğme yeniden basılınca resim içinde resim kapanır, kaynak öğeler bırakılır
    await deniz.click('#radio-float')
    await deniz.waitForFunction(() => !document.pictureInPictureElement && !floatIsOpen() && !document.querySelector('.float-pip-source'), null, { timeout: h.LONG })
    assert.equal(await deniz.evaluate(() => Array.from(cameraVideos.keys()).filter((k) => k.indexOf('float-') === 0).length), 0)
  } finally {
    await deniz.evaluate(() => {
      Object.defineProperty(window, 'documentPictureInPicture', { value: window.__dpip, configurable: true })
    })
  }
})

test('Ayarlar > Ses ve Görüntü: Yüzen Pencere anahtarı telsiz.floatAuto değerini yazar', async () => {
  const { deniz } = W
  await deniz.evaluate(() => openSettings('voice'))
  await deniz.waitForSelector('#set-float-auto')
  const r = await deniz.evaluate(() => ({
    checked: document.getElementById('set-float-auto').checked,
    title: document.getElementById('set-float-section-title').textContent,
    hint: document.getElementById('set-float-auto-hint').textContent
  }))
  assert.deepEqual(r, { checked: true, title: 'Yüzen Pencere', hint: 'Chrome ve Edge\'de ses odasındayken başka sekmeye geçince açılır. Tarayıcı simge durumuna küçültülünce kendiliğinden açılmaz, Yüzen Pencere düğmesini kullanın.' })
  await deniz.click('#set-float-auto')
  assert.equal(await deniz.evaluate(() => localStorage.getItem('telsiz.floatAuto')), 'off')
  await deniz.click('#set-float-auto')
  assert.equal(await deniz.evaluate(() => localStorage.getItem('telsiz.floatAuto')), 'on')
  await deniz.keyboard.press('Escape')
  await deniz.waitForFunction(() => !isSettingsOpen())
})

test('sesten ayrılınca düğme kalkar, konsol ve sunucu günlüğü temiz', async () => {
  const { deniz } = W
  await deniz.click('#voice-leave')
  await deniz.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
  assert.equal(await deniz.$('#radio-float'), null)
  h.assertCleanConsole(W.w.logs, W.w.srv.errors)
})
