'use strict'

// Frekans tanıtımı (about): sahibin yazdığı, herkese açık düz metin. Temizlik ve sınırlar (auth.cleanAbout),
// yalnızca sahibin değiştirebilmesi, GET /api/info yanıtında görünmesi, yeniden başlatmada korunması ve
// iki dilde hata metinleri sınanır.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const h = require('./server-yardimci')
const auth = require('../src/auth')
const i18n = require('../src/i18n')

describe('auth.cleanAbout', () => {
  it('kırpar, boşlukları tekler, satır sonlarını \\n yapar ve boş satırları sadeleştirir', () => {
    assert.equal(auth.cleanAbout('  İlk Telsiz frekansı.  '), 'İlk Telsiz frekansı.')
    assert.equal(auth.cleanAbout('a\t\t b'), 'a b')
    assert.equal(auth.cleanAbout('bir\r\niki\rüç'), 'bir\niki\nüç')
    assert.equal(auth.cleanAbout('\n\nbir\n\n\n\niki\n\n'), 'bir\n\niki')
    assert.equal(auth.cleanAbout('a\u0000b\u200bc\u202ed'), 'abcd')
    assert.equal(auth.cleanAbout(''), '')
    assert.equal(auth.cleanAbout('   \n  \n '), '')
    assert.equal(auth.cleanAbout('e\u0301'), '\u00e9')
  })

  it('600 kod noktası ve 6 satır sınırı, metin olmayan değer geçersiz', () => {
    assert.equal(auth.ABOUT_MAX, 600)
    assert.equal(auth.ABOUT_MAX_LINES, 6)
    assert.equal(auth.cleanAbout('ş'.repeat(600)), 'ş'.repeat(600))
    assert.equal(auth.cleanAbout('ş'.repeat(601)), null)
    // Emoji tek kod noktası sayılır
    assert.equal(auth.cleanAbout('\u{1F4FB}'.repeat(600)), '\u{1F4FB}'.repeat(600))
    assert.equal(auth.cleanAbout('1\n2\n3\n4\n5\n6'), '1\n2\n3\n4\n5\n6')
    assert.equal(auth.cleanAbout('1\n2\n3\n4\n5\n6\n7'), null)
    // Boş satır da satır sayılır, art arda boşlar teke indikten sonra sayılır
    assert.equal(auth.cleanAbout('1\n\n2\n\n3\n\n4'), null)
    assert.equal(auth.cleanAbout('1\n\n\n\n2'), '1\n\n2')
    assert.equal(auth.cleanAbout(' '.repeat(3000) + 'a'), 'a')
    assert.equal(auth.cleanAbout('a'.repeat(4001)), null)
    for (const bad of [null, 1, true, {}, [], undefined]) assert.equal(auth.cleanAbout(bad), null)
  })
})

describe('frekans tanıtımı ayarı', () => {
  it('yalnızca sahip yazar, GET /api/info herkese döner, sınırlar ve yeniden başlatma', async () => {
    let ctx = await h.startServer()
    try {
      let info = await h.get(ctx, '/api/info')
      assert.equal(info.data.about, '')
      assert.equal(info.data.limits.aboutMax, 600)
      assert.equal(info.data.limits.aboutMaxLines, 6)
      const owner = await h.setupOwner(ctx)
      const admin = await h.addUser(ctx, owner.token, 'yonetici')
      const member = await h.addUser(ctx, owner.token, 'uye')
      await h.makeAdmin(ctx, owner.token, admin.user.id)

      const text = '  İlk Telsiz frekansı.\r\nYaratıcısı Burak Aslancan Pak.  '
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { about: text }), 200)
      info = await h.get(ctx, '/api/info')
      assert.equal(info.data.about, 'İlk Telsiz frekansı.\nYaratıcısı Burak Aslancan Pak.')
      // Oturumsuz istek de aynı metni alır (tanıtım sayfası)
      assert.equal(info.status, 200)

      h.expectStatus(await h.post(ctx, '/api/settings', admin.token, { about: 'Yönetici' }), 403, 'forbidden')
      h.expectStatus(await h.post(ctx, '/api/settings', admin.token, { about: 'Yönetici', activeKid: null }), 403, 'forbidden')
      h.expectStatus(await h.post(ctx, '/api/settings', member.token, { about: 'Üye' }), 403, 'forbidden')
      h.expectStatus(await h.post(ctx, '/api/settings', null, { about: 'Kimsesiz' }), 401)
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { about: 'x'.repeat(601) }), 400, 'invalid_about')
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { about: '1\n2\n3\n4\n5\n6\n7' }), 400, 'invalid_about')
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { about: 42 }), 400, 'invalid_about')
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { about: null }), 400, 'invalid_about')
      // Geçersiz istekte hiçbir alan değişmez
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { serverName: 'Yeni', about: 'x'.repeat(601) }), 400, 'invalid_about')
      info = await h.get(ctx, '/api/info')
      assert.equal(info.data.serverName, 'Telsiz')
      assert.equal(info.data.about, 'İlk Telsiz frekansı.\nYaratıcısı Burak Aslancan Pak.')

      // Hata metni isteğin dilinde
      const en = await h.request(ctx, 'POST', '/api/settings', { token: admin.token, body: { about: 'x' }, headers: { 'accept-language': 'en' } })
      assert.equal(en.data.error, 'Only the owner can change the frequency introduction.')
      const tr = await h.request(ctx, 'POST', '/api/settings', { token: owner.token, body: { about: 'x'.repeat(700) }, headers: { 'accept-language': 'tr' } })
      assert.equal(tr.data.error, 'Frekans tanıtımı en fazla 600 karakter ve 6 satır olabilir.')

      // Ad ile birlikte kaydedilebilir, yeniden başlatmada korunur
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { serverName: 'Kankalar', about: 'Hoş geldin.' }), 200)
      ctx = await ctx.restart()
      info = await h.get(ctx, '/api/info')
      assert.equal(info.data.serverName, 'Kankalar')
      assert.equal(info.data.about, 'Hoş geldin.')

      // Boş metin tanıtımı kaldırır
      h.expectStatus(await h.post(ctx, '/api/settings', owner.token, { about: '   ' }), 200)
      assert.equal((await h.get(ctx, '/api/info')).data.about, '')
    } finally {
      await ctx.cleanup()
    }
  })

  it('durum dosyasında alan yoksa veya bozuksa boş metinle açılır', async () => {
    let ctx = await h.startServer()
    try {
      await h.setupOwner(ctx)
      await ctx.stop()
      const file = path.join(ctx.dataDir, 'state.json')
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      delete raw.about
      fs.writeFileSync(file, JSON.stringify(raw))
      ctx = await h.startServer({}, ctx.root)
      assert.equal((await h.get(ctx, '/api/info')).data.about, '')
      await ctx.stop()
      raw.about = 'a\n\n\n\nb\u0000'
      fs.writeFileSync(file, JSON.stringify(raw))
      ctx = await h.startServer({}, ctx.root)
      assert.equal((await h.get(ctx, '/api/info')).data.about, 'a\n\nb')
      await ctx.stop()
      raw.about = { kötü: true }
      fs.writeFileSync(file, JSON.stringify(raw))
      ctx = await h.startServer({}, ctx.root)
      assert.equal((await h.get(ctx, '/api/info')).data.about, '')
    } finally {
      await ctx.cleanup()
    }
  })

  it('iki dilde hata metinleri', () => {
    assert.equal(i18n.t('tr', 'errors.invalid_about'), 'Frekans tanıtımı en fazla 600 karakter ve 6 satır olabilir.')
    assert.equal(i18n.t('en', 'errors.invalid_about'), 'The frequency introduction can be at most 600 characters and 6 lines long.')
    assert.equal(i18n.t('tr', 'detail.aboutOwnerOnly'), 'Frekans tanıtımını yalnızca sahip değiştirebilir.')
    assert.equal(i18n.t('en', 'detail.aboutOwnerOnly'), 'Only the owner can change the frequency introduction.')
  })
})
