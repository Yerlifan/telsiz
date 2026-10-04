'use strict'

// Özel roller ve ses odası denetimi. Sahip Deniz Ayarlar > Roller'den Moderatör rolünü oluşturur, Ses odasını
// denetle iznini açar ve rolü Ayarlar > Üyeler'den Ece'ye verir. Rol Yayındakiler listesinde rozet olarak
// görünür. Ece ve Mert Lobi'ye katılır: Ece'nin Mert için açtığı kişi ses kartında Ses odası denetimi bölümü
// vardır, Mert'in Ece için açtığında yoktur. Ece Mert'i herkes için susturur: Mert'in mikrofon düğmesi
// "Herkes için susturuldu" der ve mikrofonunu açamaz, Ece'nin kadrosunda Mert'in rozeti değişir. Susturma
// kaldırılınca Mert'in kendi durumu geri gelir. Ece Mert'i odadan çıkarınca Mert'in telsizi kapanır.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { w: null, deniz: null, ece: null, mert: null, lobi: null, role: null }
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []), { browsers: h.MIC_BROWSERS, reason: 'sahte mikrofon yok' })

const crewSel = (id) => '#radio-crew .crew-item[data-user-id="' + id + '"]'

async function metaOf () {
  return (await W.w.call('GET', '/api/state', null, W.w.P.deniz.token)).data.meta
}

function userIn (meta, id) {
  return meta.users.filter((u) => u.id === id)[0]
}

before(async () => {
  if (test.skipped) return
  W.w = await h.setupWorld({ slot: 15 })
  W.lobi = W.w.room('Lobi')
  W.deniz = await W.w.pageFor('deniz')
  W.ece = await W.w.pageFor('ece')
  W.mert = await W.w.pageFor('mert')
  // Odadan çıkarma onay ister
  W.ece.on('dialog', (d) => d.accept())
})

after(async () => {
  if (W.w) await W.w.close()
})

test('sahip Roller sayfasında rol oluşturur, izin açar ve rolü Üyeler sayfasından verir', async () => {
  const { deniz } = W
  const eceId = W.w.P.ece.id
  await deniz.evaluate(() => openSettings('roles'))
  await deniz.waitForSelector('#settings-page[data-cat="roles"]')
  assert.equal(await deniz.textContent('#settings-page-title'), 'Roller')
  await deniz.fill('#set-role-name', 'Moderatör')
  await deniz.click('#set-role-create')
  await deniz.waitForSelector('#set-roles-list .role-admin-row[data-role-id]', { timeout: h.LONG })
  const roleId = Number(await deniz.getAttribute('#set-roles-list .role-admin-row[data-role-id]', 'data-role-id'))
  W.role = roleId
  assert.equal(await deniz.textContent('#set-roles-list .role-admin-row .list-name'), 'Moderatör')
  // İzin anahtarı (role=switch onay kutusu)
  await deniz.click('#set-role-' + roleId + '-voice')
  await h.until(async () => {
    const meta = await metaOf()
    const role = meta.roles.filter((r) => r.id === roleId)[0]
    return role && role.perms.join(',') === 'voice'
  }, h.LONG, 'izin sunucuya yazılmadı')
  // Üyeler sayfasında Ece'ye rol verilir
  await deniz.evaluate(() => showSettingsCat('members', 'title'))
  await deniz.waitForSelector('#set-custom-role-' + eceId)
  await deniz.selectOption('#set-custom-role-' + eceId, String(roleId))
  await h.until(async () => userIn(await metaOf(), eceId).roleId === roleId, h.LONG, 'rol verilmedi')
  await deniz.waitForFunction((id) => {
    const sub = document.querySelector('#set-members-list .member-row[data-user-id="' + id + '"] .list-sub')
    return Boolean(sub && sub.textContent.indexOf('Moderatör') !== -1)
  }, eceId, { timeout: h.LONG })
  await deniz.keyboard.press('Escape')
  await deniz.waitForSelector('#settings-view', { state: 'hidden' })
  // Yayındakiler listesinde rozet
  await deniz.waitForFunction((id) => {
    const badge = document.querySelector('#members .member[data-user-id="' + id + '"] .badge-custom')
    return Boolean(badge && badge.textContent === 'Moderatör')
  }, eceId, { timeout: h.LONG })
})

test('moderatör ses odasında birini herkes için susturur, susturmayı kaldırır ve odadan çıkarır', async () => {
  const { ece, mert } = W
  const eceId = W.w.P.ece.id
  const mertId = W.w.P.mert.id
  await h.joinVoice(mert, W.lobi.id)
  await h.joinVoice(ece, W.lobi.id)
  for (const page of [ece, mert]) {
    await page.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 2, null, { timeout: h.LONG })
  }
  // İzni olmayan Mert'in Ece için açtığı kartta denetim bölümü yok
  await mert.click(crewSel(eceId) + ' .crew-button')
  await mert.waitForSelector('#peer-popover:not([hidden])')
  assert.equal(await mert.isHidden('#peer-mod'), true)
  await mert.keyboard.press('Escape')
  await mert.waitForSelector('#peer-popover', { state: 'hidden' })
  // Ece'nin Mert için açtığı kartta denetim bölümü var
  await ece.click(crewSel(mertId) + ' .crew-button')
  await ece.waitForSelector('#peer-popover:not([hidden]) #peer-mod:not([hidden])')
  assert.equal(await ece.textContent('#peer-server-mute'), 'Herkes için sustur')
  await ece.click('#peer-server-mute')
  await mert.waitForFunction(() => document.getElementById('btn-mute-state').textContent === 'Herkes için susturuldu', null, { timeout: h.LONG })
  assert.equal(await mert.getAttribute('#btn-mute', 'aria-pressed'), 'true')
  // Mikrofonunu açmaya çalışınca açılmaz ve açıklama görünür
  await mert.click('#btn-mute')
  await mert.waitForFunction(() => /Herkes için susturuldunuz/.test(document.getElementById('toast').textContent), null, { timeout: h.LONG })
  assert.equal(await mert.evaluate(() => snap().serverMuted), true)
  await ece.waitForSelector(crewSel(mertId) + ' .crew-badge.is-server-muted', { timeout: h.LONG })
  await ece.waitForFunction(() => document.getElementById('peer-server-mute').textContent === 'Herkes için susturmayı kaldır', null, { timeout: h.LONG })
  // Susturma kalkınca Mert'in kendi tercihi (mikrofon açık) geri gelir
  await ece.click('#peer-server-mute')
  await mert.waitForFunction(() => document.getElementById('btn-mute-state').textContent !== 'Herkes için susturuldu', null, { timeout: h.LONG })
  assert.equal(await mert.evaluate(() => snap().serverMuted), false)
  await ece.waitForSelector(crewSel(mertId) + ' .crew-badge.is-server-muted', { state: 'detached', timeout: h.LONG })
  // Odadan çıkarma: Mert'in telsizi kapanır, Ece'nin kadrosunda yalnızca kendisi kalır
  await ece.click('#peer-disconnect')
  await mert.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') !== 'on', null, { timeout: h.LONG })
  await ece.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 1, null, { timeout: h.LONG })
  const meta = await metaOf()
  assert.deepEqual((meta.voice[String(W.lobi.id)] || []).map((m) => m.userId), [eceId])
})
