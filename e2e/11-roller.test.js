'use strict'

// Özel roller ve ses odası denetimi. Sahip Deniz Ayarlar > Roller'den Moderatör rolünü oluşturur, Ses odasını
// denetle iznini açar ve rolü Ayarlar > Üyeler'den Ece'ye verir. Rol Çevrimiçi listesinde rozet olarak
// görünür. Ece ve Mert Lobi'ye katılır: Ece'nin Mert için açtığı kişi ses kartında Ses odası denetimi bölümü
// vardır, Mert'in Ece için açtığında yoktur. Ece Mert'i herkes için susturur: Mert'in mikrofon düğmesi
// "Herkes için susturuldu" der ve mikrofonunu açamaz, Ece'nin kadrosunda Mert'in rozeti değişir. Susturma
// kaldırılınca Mert'in kendi durumu geri gelir. Ece Mert'i odadan çıkarınca Mert'in telsizi kapanır. İçerik şikâyeti:
// Mert Ece'nin genel odadaki mesajını notla bildirir, Deniz'in açık Üyeler sayfasındaki Şikâyetler listesine şikâyet
// kendiliğinden gelir, not ve mesaj metni çözülmüş görünür, Deniz çözüldü işaretler. Not sunucuda düz metin değildir.
// Mert Ece'yi profil kartından bildirir ve Ece'nin iki özel mesajını bildirir: kutu işaretlenmezse mesaj metni
// şikâyete girmez, işaretlenirse girer. Sonunda Deniz Mert'i Üyeler sayfasından frekanstan atar: onay sorulur,
// Mert listeden düşer ve Mert'in uygulaması giriş ekranında frekanstan çıkarıldığını yazar.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { w: null, deniz: null, ece: null, mert: null, lobi: null, role: null }
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []), { browsers: h.MIC_BROWSERS, reason: 'sahte mikrofon yok' })

const crewSel = (id) => '#radio-crew .crew-item[data-user-id="' + id + '"]'
const REPORTED_TEXT = 'Ucuz takipçi satıyorum, hemen yazın'
const REPORT_NOTE = 'Odada sürekli reklam yapıyor'
const DM_FIRST = 'Bu ilk özel mesaj bildirilir ama metni eklenmez'
const DM_SECOND = 'Bu ikinci özel mesajın metni şikâyete eklenir'

async function reportsOf () {
  return (await W.w.call('GET', '/api/reports', null, W.w.P.deniz.token)).data.reports
}

// Mesajın araç çubuğundaki Mesajı Bildir düğmesiyle şikâyet penceresini açar
async function openMessageReport (page, messageId) {
  const node = '#message-list .msg[data-id="' + messageId + '"]'
  await page.waitForSelector(node, { timeout: h.LONG })
  await page.hover(node)
  await page.click(node + ' .msg-report')
  await page.waitForSelector('#report-dialog #report-form')
}

// Pencereyi gönderir, onay bildirimini bekler
async function sendReport (page) {
  await page.click('#report-send')
  await page.waitForSelector('#report-dialog', { state: 'detached', timeout: h.LONG })
  await page.waitForFunction(() => /frekans sahibine ve yöneticilere iletildi/.test(document.getElementById('toast').textContent), null, { timeout: h.LONG })
}

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
  // Çevrimiçi listesinde rozet
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
  assert.equal(await ece.textContent('#peer-server-mute'), 'Herkes İçin Sustur')
  await ece.click('#peer-server-mute')
  await mert.waitForFunction(() => document.getElementById('btn-mute-state').textContent === 'Herkes İçin Susturuldu', null, { timeout: h.LONG })
  assert.equal(await mert.getAttribute('#btn-mute', 'aria-pressed'), 'true')
  // Mikrofonunu açmaya çalışınca açılmaz ve açıklama görünür
  await mert.click('#btn-mute')
  await mert.waitForFunction(() => /Herkes için susturuldunuz/.test(document.getElementById('toast').textContent), null, { timeout: h.LONG })
  assert.equal(await mert.evaluate(() => snap().serverMuted), true)
  await ece.waitForSelector(crewSel(mertId) + ' .crew-badge.is-server-muted', { timeout: h.LONG })
  await ece.waitForFunction(() => document.getElementById('peer-server-mute').textContent === 'Herkes İçin Susturmayı Kaldır', null, { timeout: h.LONG })
  // Susturma kalkınca Mert'in kendi tercihi (mikrofon açık) geri gelir
  await ece.click('#peer-server-mute')
  await mert.waitForFunction(() => document.getElementById('btn-mute-state').textContent !== 'Herkes İçin Susturuldu', null, { timeout: h.LONG })
  assert.equal(await mert.evaluate(() => snap().serverMuted), false)
  await ece.waitForSelector(crewSel(mertId) + ' .crew-badge.is-server-muted', { state: 'detached', timeout: h.LONG })
  // Odadan çıkarma: Mert'in telsizi kapanır, Ece'nin kadrosunda yalnızca kendisi kalır
  await ece.click('#peer-disconnect')
  await mert.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') !== 'on', null, { timeout: h.LONG })
  await ece.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 1, null, { timeout: h.LONG })
  const meta = await metaOf()
  assert.deepEqual((meta.voice[String(W.lobi.id)] || []).map((m) => m.userId), [eceId])
})

test('üye mesajı bildirir, sahibin açık Şikâyetler listesine gelir, not çözülür ve sahip çözer', async () => {
  const { deniz, mert } = W
  const eceId = W.w.P.ece.id
  const genel = W.w.room('genel')
  // Sahip Üyeler sayfasını önceden açar: liste boş
  await deniz.evaluate(() => openSettings('members'))
  await deniz.waitForSelector('#set-reports-section:not([hidden])')
  assert.equal(await deniz.textContent('#set-reports-section-title'), 'Şikâyetler')
  await deniz.waitForFunction(() => document.getElementById('set-reports-count').textContent === '0 açık şikâyet', null, { timeout: h.LONG })
  assert.equal(await deniz.textContent('#set-reports-list .empty-row'), 'Açık şikâyet yok.')

  const m = await W.w.say('ece', genel, REPORTED_TEXT)
  await mert.evaluate((id) => selectChannel(id, {}), genel.id)
  // Kendi mesajında Bildir yoktur
  const own = await W.w.say('mert', genel, 'Benim mesajım')
  await mert.waitForSelector('#message-list .msg[data-id="' + own.id + '"]', { timeout: h.LONG })
  assert.equal(await mert.$('#message-list .msg[data-id="' + own.id + '"] .msg-report'), null)
  await openMessageReport(mert, m.id)
  assert.equal(await mert.textContent('#report-dialog .app-dialog-title'), 'Mesajı Bildir')
  assert.equal(await mert.textContent('#report-quote'), REPORTED_TEXT)
  // Yazı odasında metin kendiliğinden eklenir, kutu yoktur
  assert.equal(await mert.$('#report-attach'), null)
  // Neden seçilmeden gönderilmez
  await mert.click('#report-send')
  await mert.waitForFunction(() => document.getElementById('report-error').textContent === 'Lütfen bir neden seçin.')
  await mert.selectOption('#report-reason', 'spam')
  await mert.fill('#report-note', REPORT_NOTE)
  await sendReport(mert)

  const [r] = await reportsOf()
  assert.equal(r.kind, 'message')
  assert.equal(r.reason, 'spam')
  assert.equal(r.reporterId, W.w.P.mert.id)
  assert.equal(r.targetUserId, eceId)
  assert.equal(r.messageId, m.id)
  assert.equal(r.dm, false)
  assert.ok(/^1\./.test(r.note), 'not mühürlü zarf')
  // Not ve alıntı sunucuda düz metin olarak bulunmaz
  for (const f of h.readDataDir(W.w.srv.dataDir)) {
    assert.equal(f.data.indexOf(Buffer.from(REPORT_NOTE, 'utf8')), -1, f.file + ' içinde düz metin not')
  }

  // Sahibin açık listesine kendiliğinden gelir (özel görünümdeki açık şikâyet sayısı)
  const row = '#set-reports-list .report-row[data-report-id="' + r.id + '"]'
  await deniz.waitForSelector(row, { timeout: h.LONG })
  assert.equal(await deniz.textContent('#set-reports-count'), '1 açık şikâyet')
  assert.equal(await deniz.textContent(row + ' .list-name'), 'Ece adlı kişinin mesajı')
  assert.match(await deniz.textContent(row + ' .list-sub'), /^İstenmeyen içerik · Bildiren: Mert · /)
  assert.equal(await deniz.textContent(row + ' .report-note-line'), 'Not: ' + REPORT_NOTE)
  assert.equal(await deniz.textContent(row + ' .report-quote-line'), 'Bildirenin eklediği mesaj metni: ' + REPORTED_TEXT)
  assert.equal(await deniz.textContent(row + ' .act-report-go'), 'Mesaja Git')
  assert.equal(await deniz.textContent(row + ' .act-report-resolve'), 'Çözüldü İşaretle')
  await deniz.click(row + ' .act-report-resolve')
  await deniz.waitForSelector('#set-reports-done-list .report-row[data-report-id="' + r.id + '"]', { timeout: h.LONG })
  await deniz.waitForFunction(() => /çözüldü olarak işaretlendi/.test(document.getElementById('set-reports-msg').textContent))
  assert.equal(await deniz.textContent('#set-reports-count'), '0 açık şikâyet')
  assert.match(await deniz.textContent('#set-reports-done-list .report-row .list-sub:nth-child(3)'), /^Çözen: Deniz · /)
  assert.equal((await reportsOf())[0].resolvedBy, W.w.P.deniz.id)
  await deniz.keyboard.press('Escape')
  await deniz.waitForSelector('#settings-view', { state: 'hidden' })
})

test('kişi profil kartından, özel mesaj ise metin yalnızca kutu işaretlenince eklenerek bildirilir', async () => {
  const { ece, mert } = W
  const eceId = W.w.P.ece.id
  const mertId = W.w.P.mert.id
  // Profil kartında Kişiyi Bildir
  await mert.click('#message-list .msg[data-author-id="' + eceId + '"] .msg-author')
  await mert.waitForSelector('#profile-card:not([hidden]) .card-report')
  assert.equal(await mert.textContent('#profile-card .card-report'), 'Kişiyi Bildir')
  await mert.click('#profile-card .card-report')
  await mert.waitForSelector('#report-dialog #report-form')
  assert.equal(await mert.textContent('#report-dialog .app-dialog-title'), 'Kişiyi Bildir')
  assert.equal(await mert.$('#report-quote'), null)
  await mert.selectOption('#report-reason', 'harassment')
  await sendReport(mert)
  let reports = await reportsOf()
  assert.deepEqual([reports[0].kind, reports[0].targetUserId, reports[0].reason, reports[0].note], ['user', eceId, 'harassment', null])

  // Ece Mert'e iki özel mesaj yazar
  await ece.evaluate((id) => openDmWith(id), mertId)
  await ece.waitForFunction(() => currentViewMode() === 'dm' && !document.getElementById('composer-input').disabled, null, { timeout: h.LONG })
  for (const text of [DM_FIRST, DM_SECOND]) {
    await ece.fill('#composer-input', text)
    await ece.keyboard.press('Enter')
    await ece.waitForFunction((t) => Array.from(document.querySelectorAll('#message-list .msg-text')).some((n) => n.textContent === t), text, { timeout: h.LONG })
  }
  await mert.evaluate((id) => openDmWith(id), eceId)
  await mert.waitForFunction(() => currentViewMode() === 'dm', null, { timeout: h.LONG })
  const idOf = (text) => mert.waitForFunction((t) => {
    const n = Array.from(document.querySelectorAll('#message-list .msg')).filter((x) => x.querySelector('.msg-text') && x.querySelector('.msg-text').textContent === t)[0]
    return n ? Number(n.getAttribute('data-id')) : 0
  }, text, { timeout: h.LONG }).then((handle) => handle.jsonValue())
  const first = await idOf(DM_FIRST)
  const second = await idOf(DM_SECOND)

  // Kutu işaretlenmezse mesaj metni şikâyete girmez (not da boşsa not hiç gönderilmez)
  await openMessageReport(mert, first)
  assert.equal(await mert.textContent('#report-quote'), DM_FIRST)
  assert.equal(await mert.isChecked('#report-attach'), false)
  assert.match(await mert.textContent('#report-attach-hint'), /uçtan uca şifrelidir/)
  await mert.selectOption('#report-reason', 'other')
  await sendReport(mert)
  reports = await reportsOf()
  assert.deepEqual([reports[0].kind, reports[0].messageId, reports[0].dm, reports[0].note], ['message', first, true, null])

  // Kutu işaretlenince metin mühürlü notla gider
  await openMessageReport(mert, second)
  await mert.check('#report-attach')
  await mert.selectOption('#report-reason', 'harassment')
  await sendReport(mert)
  reports = await reportsOf()
  assert.equal(reports[0].messageId, second)
  assert.ok(/^1\./.test(reports[0].note))
  for (const f of h.readDataDir(W.w.srv.dataDir)) {
    assert.equal(f.data.indexOf(Buffer.from(DM_SECOND, 'utf8')), -1, f.file + ' içinde düz metin alıntı')
  }

  // Sahip listede özel mesaj şikâyetini görür: alıntı çözülür, Mesaja Git yoktur
  const { deniz } = W
  await deniz.evaluate(() => openSettings('members'))
  const row = '#set-reports-list .report-row[data-report-id="' + reports[0].id + '"]'
  await deniz.waitForSelector(row, { timeout: h.LONG })
  assert.equal(await deniz.textContent(row + ' .list-name'), 'Ece adlı kişinin özel mesajı')
  assert.equal(await deniz.textContent(row + ' .report-quote-line'), 'Bildirenin eklediği mesaj metni: ' + DM_SECOND)
  assert.equal(await deniz.$(row + ' .act-report-go'), null)
  const firstRow = '#set-reports-list .report-row[data-report-id="' + reports[1].id + '"]'
  assert.equal(await deniz.$(firstRow + ' .report-quote-line'), null)
  assert.equal(await deniz.textContent('#set-reports-count'), '3 açık şikâyet')
  await deniz.keyboard.press('Escape')
  await deniz.waitForSelector('#settings-view', { state: 'hidden' })
  // Ece'nin sayfası özel konuşmadan çıkar, Mert'inki genel odaya döner
  await ece.evaluate((id) => selectChannel(id, {}), W.w.room('genel').id)
  await mert.evaluate((id) => selectChannel(id, {}), W.w.room('genel').id)
})

test('sahip Üyeler sayfasından Mert\'i frekanstan atar, Mert\'in uygulaması frekanstan çıkarıldığını söyler', async () => {
  const { deniz, mert } = W
  const mertId = W.w.P.mert.id
  await deniz.evaluate(() => openSettings('members'))
  const kickSel = '#set-members-list .member-row[data-user-id="' + mertId + '"] .act-kick'
  await deniz.waitForSelector(kickSel)
  assert.equal(await deniz.textContent(kickSel), 'Frekanstan At')
  // Atma onay ister
  const asked = new Promise((resolve) => {
    deniz.once('dialog', (d) => {
      resolve(d.message())
      d.accept()
    })
  })
  await deniz.click(kickSel)
  assert.match(await asked, /frekanstan atılsın mı\?/)
  await deniz.waitForSelector('#set-members-list .member-row[data-user-id="' + mertId + '"]', { state: 'detached', timeout: h.LONG })
  await deniz.waitForFunction(() => /frekanstan atıldı/.test(document.getElementById('set-members-msg').textContent), null, { timeout: h.LONG })
  // Mert'in bekleyen poll'u 401 kicked alır: giriş ekranı açılır ve neden yazar
  await mert.waitForFunction(() => /Frekanstan çıkarıldınız/.test(document.getElementById('auth-notice').textContent), null, { timeout: h.LONG })
  assert.equal(await mert.isHidden('#auth-notice'), false)
  const meta = await metaOf()
  assert.equal(meta.users.some((u) => u.id === mertId), false)
  await deniz.keyboard.press('Escape')
})
