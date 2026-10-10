'use strict'

// Arkadaşlık isteği (gönderme, rozet, kabul) ve özel mesaj (iki yönlü, uçtan uca şifreli). Özel konuşmanın
// başlangıcında oda simgesi yerine karşı tarafın avatarı görünür.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { w: null, deniz: null, ece: null, dmId: null }
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []))

const DENIZ_DM = 'Ece, bu yalnızca ikimizin arasında 5512'
const ECE_DM = 'Tamam Deniz, özelden yanıtlıyorum 6623'

// Kişisel girişler üst çubuğun ortasındadır (#top-dm, #top-friends), rozet gizliyse boş döner
function personalMark (key) {
  const b = document.querySelector('#top-personal .top-personal-button[data-station="' + key + '"] .station-mark')
  return b && !b.hidden ? b.textContent : ''
}

async function openFriends (page) {
  await page.click('#top-friends')
  await page.waitForFunction(() => currentViewMode() === 'home' && !document.getElementById('home-view').hidden)
}

before(async () => {
  W.w = await h.setupWorld({ slot: 2 })
  W.deniz = await W.w.pageFor('deniz')
  W.ece = await W.w.pageFor('ece', { extra: { 'telsiz.skin': 'turkuaz', 'telsiz.scheme': 'light' } })
})

after(async () => {
  if (W.w) await W.w.close()
})

test('arkadaşlık isteği: kullanıcı adıyla gönderilir, karşı tarafta rozet ve bekleyen satır', async () => {
  const { deniz, ece } = W
  await openFriends(deniz)
  if (await deniz.evaluate(() => Boolean(document.getElementById('home-tab-add')) && getComputedStyle(document.getElementById('home-tab-add')).display !== 'none')) {
    await deniz.click('#home-tab-add')
  }
  await deniz.waitForSelector('#friend-add-name')
  // Arkadaş Ekle kutusunun tek görünen ipucu yer tutucudur (etiket yalnızca ekran okuyucuya görünür)
  assert.equal(await deniz.getAttribute('#friend-add-name', 'placeholder'), 'Kullanıcı adı giriniz')
  await deniz.fill('#friend-add-name', 'ece')
  await deniz.click('#friend-add-submit')
  await deniz.waitForFunction(() => /^Ece kişisine arkadaşlık isteği gönderildi/.test(document.getElementById('friend-add-msg').textContent))
  await ece.waitForFunction(personalMark, 'friends', { timeout: h.LONG })
  assert.equal(await ece.evaluate(personalMark, 'friends'), '1')
  await openFriends(ece)
  await ece.click('#home-tab-pending')
  await ece.waitForSelector('.friend-row[data-kind="incoming"][data-user-id="' + W.w.P.deniz.id + '"]')
})

test('istek kabul edilir, iki tarafta arkadaş listesinde görünür', async () => {
  const { deniz, ece } = W
  await ece.click('.friend-row[data-user-id="' + W.w.P.deniz.id + '"] .act-accept')
  await ece.click('#home-tab-all')
  await ece.waitForSelector('.friend-row[data-kind="friend"][data-user-id="' + W.w.P.deniz.id + '"]')
  await deniz.click('#home-tab-all')
  await deniz.waitForSelector('.friend-row[data-kind="friend"][data-user-id="' + W.w.P.ece.id + '"]', { timeout: h.LONG })
  await ece.waitForFunction(() => document.getElementById('top-friends-mark').hidden)
})

test('özel mesaj: arkadaş satırından açılır, başlangıçta karşı tarafın avatarı görünür', async () => {
  const { deniz } = W
  await deniz.click('.friend-row[data-user-id="' + W.w.P.ece.id + '"] .act-message')
  await deniz.waitForSelector('#dm-header:not([hidden]) .dm-header-name')
  assert.equal(await deniz.getAttribute('#app-view', 'data-view'), 'dm')
  assert.equal(await deniz.textContent('#dm-header .dm-header-handle'), '@ece')
  await deniz.waitForFunction(() => !document.getElementById('composer-input').disabled, null, { timeout: h.LONG })
  W.dmId = await deniz.evaluate(() => String(state.channelId))
  const start = await deniz.evaluate(() => {
    const box = document.querySelector('#channel-start .channel-start-icon')
    return {
      dm: document.getElementById('channel-start').classList.contains('is-dm'),
      avatar: Boolean(box.querySelector('.channel-start-avatar')),
      glyph: Array.from(box.querySelectorAll('use')).map((u) => u.getAttribute('href')),
      title: document.getElementById('channel-start-title').textContent
    }
  })
  assert.equal(start.dm, true)
  assert.equal(start.avatar, true, 'başlangıçta karşı tarafın avatarı')
  assert.ok(start.glyph.indexOf('#i-hash') === -1 && start.glyph.indexOf('#i-speaker') === -1, 'oda simgesi yok: ' + start.glyph.join(','))
  assert.equal(start.title, 'Ece ile özel mesajlar')
})

test('özel mesaj iki yönlü: Özel istasyonunda rozet, iki tarafta görünür', async () => {
  const { deniz, ece } = W
  await deniz.fill('#composer-input', DENIZ_DM)
  await deniz.keyboard.press('Enter')
  await ece.waitForFunction((id) => {
    const s = document.getElementById('top-dm-mark')
    return s && !s.hidden && s.textContent === '1'
  }, W.dmId, { timeout: h.LONG })
  // Üst çubuktaki Özel mesajlar düğmesi son özel konuşmayı açar
  await ece.click('#top-dm')
  await ece.waitForFunction((id) => currentViewMode() === 'dm' && String(state.channelId) === String(id), W.dmId)
  await ece.waitForFunction((text) => Array.from(document.querySelectorAll('#message-list .msg-text')).some((n) => n.textContent === text), DENIZ_DM, { timeout: h.LONG })
  await ece.waitForFunction(() => !document.getElementById('composer-input').disabled)
  const startEce = await ece.evaluate(() => Boolean(document.querySelector('#channel-start.is-dm .channel-start-avatar')))
  assert.equal(startEce, true, 'karşı tarafta da avatar')
  await ece.fill('#composer-input', ECE_DM)
  await ece.keyboard.press('Enter')
  await deniz.waitForFunction((text) => Array.from(document.querySelectorAll('#message-list .msg-text')).some((n) => n.textContent === text), ECE_DM, { timeout: h.LONG })
})

test('özel mesajlar sunucuda düz metin olarak saklanmaz', async () => {
  const res = await W.w.call('GET', '/api/messages?channel=' + W.dmId + '&limit=10', null, W.w.P.deniz.token)
  assert.equal(res.status, 200)
  const bodies = res.data.messages.map((m) => m.body)
  assert.equal(bodies.length, 2)
  await h.until(() => {
    const all = Buffer.concat(h.readDataDir(W.w.srv.dataDir).map((f) => f.data)).toString('utf8')
    return bodies.every((b) => all.indexOf(b) !== -1)
  }, h.LONG, 'zarflar diske yazıldı')
  for (const f of h.readDataDir(W.w.srv.dataDir)) {
    for (const plain of [DENIZ_DM, ECE_DM, 'ikimizin arasında', 'özelden yanıtlıyorum']) {
      assert.equal(f.data.indexOf(Buffer.from(plain, 'utf8')), -1, f.file + ' içinde düz metin: ' + plain)
    }
  }
})

test('telefon 390: özel mesaj ve arkadaşlar görünümünde yatay taşma yok', async () => {
  const page = W.ece
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForFunction(() => window.innerWidth === 390)
  assert.ok(await h.overflowX(page) <= 0, 'özel mesajda yatay taşma')
  await openFriends(page)
  assert.ok(await h.overflowX(page) <= 0, 'arkadaşlarda yatay taşma')
  await page.setViewportSize({ width: 1440, height: 900 })
})

// Kenar belirteçleri (--live-edge, --danger-edge) her temada tanımlıdır. Tanımsız belirteç border kısaltmasını
// geçersiz kılıyor ve kenar hiç çizilmiyordu (Arcade ve Turkuaz): kamera göstergesi (tehlike kenarı) ve paylaşım
// bildirimi (canlı kenarı) her tema ve modda ölçülür.
test('kamera göstergesinin ve paylaşım bildiriminin kenarı her tema ve modda çizilir', async () => {
  const result = await W.deniz.evaluate(() => {
    const root = document.documentElement
    const before = { skin: root.getAttribute('data-skin'), scheme: root.getAttribute('data-scheme') }
    const cam = document.getElementById('radio-cam-live')
    const notice = document.createElement('div')
    notice.className = 'cast-notice'
    notice.hidden = true
    document.body.appendChild(notice)
    const schemes = ['dark', 'light']
    const out = []
    window.TelsizTheme.skins.forEach((skin) => {
      schemes.forEach((scheme) => {
        root.setAttribute('data-skin', skin)
        root.setAttribute('data-scheme', scheme)
        const a = getComputedStyle(cam)
        const b = getComputedStyle(notice)
        out.push({ skin, scheme, cam: a.borderTopStyle, camWidth: parseFloat(a.borderTopWidth), camColor: a.borderTopColor, notice: b.borderTopStyle, noticeWidth: parseFloat(b.borderTopWidth) })
      })
    })
    notice.remove()
    root.setAttribute('data-skin', before.skin)
    root.setAttribute('data-scheme', before.scheme)
    return out
  })
  assert.ok(result.length >= 6, 'en az üç tema ve iki mod')
  for (const r of result) {
    assert.equal(r.cam, 'solid', r.skin + ' ' + r.scheme + ' kamera göstergesi kenarı')
    assert.ok(r.camWidth > 0, r.skin + ' ' + r.scheme + ' kamera göstergesi kenar kalınlığı')
    assert.equal(r.notice, 'solid', r.skin + ' ' + r.scheme + ' paylaşım bildirimi kenarı')
    assert.ok(r.noticeWidth > 0, r.skin + ' ' + r.scheme + ' paylaşım bildirimi kenar kalınlığı')
  }
  // Her tema kendi kenar tonunu verir
  const color = (skin, scheme) => result.find((r) => r.skin === skin && r.scheme === scheme).camColor
  assert.notEqual(color('arcade', 'dark'), color('turkuaz', 'dark'))
  assert.notEqual(color('arcade', 'dark'), color('arcade', 'light'))
})

test('konsol ve sunucu günlüğü temiz', async () => {
  h.assertCleanConsole(W.w.logs, W.w.srv.errors)
})
