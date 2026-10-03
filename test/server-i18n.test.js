'use strict'

// Sunucunun dil desteği: Accept-Language seçimi, sözlük eşliği, parametreler, hata metninin
// dile göre değişip kodun aynı kalması, konsol dili seçimi, günlük ve ilk kurulum dili,
// kaynak dosyalarda sözlük dışı Türkçe metin kalmaması.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const i18n = require('../src/i18n')
const h = require('./server-yardimci')

const ROOT = path.join(__dirname, '..')
const TURKISH_LETTERS = /[çğıİöşüÇĞÖŞÜ]/
const PARAM_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g
// Görünmez ve yön denetim karakterleri, uzun ve kısa tire
const FORBIDDEN_CHARS = /[\u00a0\u200b-\u200f\u2013\u2014\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/

function paramsOf (text) {
  return Array.from(text.matchAll(PARAM_RE), (m) => m[1]).sort()
}

function readSource (rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8')
}

function sourceFiles () {
  const files = ['server.js']
  for (const name of fs.readdirSync(path.join(ROOT, 'src'))) {
    if (name.endsWith('.js')) files.push(path.join('src', name))
  }
  return files
}

describe('Accept-Language ile dil seçimi', () => {
  it('pickLang: tr önceliği varsa tr, yoksa en', () => {
    const cases = [
      { input: undefined, lang: 'en' },
      { input: null, lang: 'en' },
      { input: '', lang: 'en' },
      { input: '*', lang: 'en' },
      { input: 'tr', lang: 'tr' },
      { input: 'TR', lang: 'tr' },
      { input: 'tr-TR', lang: 'tr' },
      { input: 'tr-tr,tr;q=0.9', lang: 'tr' },
      { input: 'en-US', lang: 'en' },
      { input: 'en-US,en;q=0.9', lang: 'en' },
      { input: 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7', lang: 'tr' },
      { input: 'en-US,en;q=0.9,tr;q=0.8', lang: 'en' },
      { input: 'en;q=0.5, tr;q=0.8', lang: 'tr' },
      { input: 'tr;q=0.3, en;q=0.4', lang: 'en' },
      { input: 'de-DE, tr;q=0.5', lang: 'tr' },
      { input: 'de-DE, fr;q=0.9', lang: 'en' },
      { input: 'tr;q=0, en;q=0.1', lang: 'en' },
      { input: 'tr;q=0', lang: 'en' },
      { input: 'en, tr', lang: 'en' },
      { input: 'tr, en', lang: 'tr' },
      { input: ' tr ; q = 0.7 , en ; q = 0.6', lang: 'tr' },
      { input: 'tr;q=abc', lang: 'en' },
      { input: 'tr;q=1.5', lang: 'en' },
      { input: 'tr;level=1', lang: 'tr' },
      { input: 'trk', lang: 'en' },
      { input: 'entr', lang: 'en' },
      { input: 'tr_TR', lang: 'tr' },
      { input: ['tr'], lang: 'en' },
      { input: 42, lang: 'en' }
    ]
    for (const { input, lang } of cases) {
      assert.equal(i18n.pickLang(input), lang, JSON.stringify(input))
    }
    // Çok uzun başlık işlemciyi yormaz, yalnızca baştaki kısım değerlendirilir
    const long = 'de;q=0.1,'.repeat(5000) + 'tr'
    assert.equal(i18n.pickLang(long), 'en')
    assert.equal(i18n.pickLang('tr,' + 'x'.repeat(100000)), 'tr')
  })

  it('normalizeLang: yerel ayar biçimleri', () => {
    assert.equal(i18n.normalizeLang('tr_TR.UTF-8'), 'tr')
    assert.equal(i18n.normalizeLang('tr.UTF-8'), 'tr')
    assert.equal(i18n.normalizeLang('en_US.UTF-8'), 'en')
    assert.equal(i18n.normalizeLang(' EN '), 'en')
    assert.equal(i18n.normalizeLang('C.UTF-8'), null)
    assert.equal(i18n.normalizeLang('POSIX'), null)
    assert.equal(i18n.normalizeLang('de'), null)
    assert.equal(i18n.normalizeLang(undefined), null)
  })
})

describe('konsol dili', () => {
  it('DIL, TELSIZ_LANG, LC_ALL, LC_MESSAGES, LANG ve Intl sırası', () => {
    const cases = [
      { env: { DIL: 'tr' }, locale: 'en-US', lang: 'tr' },
      { env: { DIL: 'en' }, locale: 'tr-TR', lang: 'en' },
      { env: { DIL: 'tr', TELSIZ_LANG: 'en' }, locale: 'en-US', lang: 'tr' },
      { env: { TELSIZ_LANG: 'tr' }, locale: 'en-US', lang: 'tr' },
      { env: { TELSIZ_LANG: 'en', LANG: 'tr_TR.UTF-8' }, locale: 'tr-TR', lang: 'en' },
      { env: { DIL: 'fr', TELSIZ_LANG: 'tr' }, locale: 'en-US', lang: 'tr' },
      { env: { DIL: 'fr' }, locale: 'tr-TR', lang: 'tr' },
      { env: { LANG: 'tr_TR.UTF-8' }, locale: 'en-US', lang: 'tr' },
      { env: { LANG: 'en_US.UTF-8' }, locale: 'tr-TR', lang: 'en' },
      { env: { LANG: 'C.UTF-8' }, locale: 'tr-TR', lang: 'en' },
      { env: { LC_ALL: 'tr_TR.UTF-8', LANG: 'en_US.UTF-8' }, locale: 'en-US', lang: 'tr' },
      { env: { LC_ALL: 'en_US.UTF-8', LC_MESSAGES: 'tr_TR.UTF-8' }, locale: 'tr-TR', lang: 'en' },
      { env: { LC_MESSAGES: 'tr_TR.UTF-8', LANG: 'en_US.UTF-8' }, locale: 'en-US', lang: 'tr' },
      { env: { LC_ALL: '  ', LANG: 'tr_TR' }, locale: 'en-US', lang: 'tr' },
      { env: {}, locale: 'tr-TR', lang: 'tr' },
      { env: {}, locale: 'en-US', lang: 'en' },
      { env: {}, locale: '', lang: 'en' },
      { env: {}, locale: 'de-DE', lang: 'en' }
    ]
    for (const { env, locale, lang } of cases) {
      assert.equal(i18n.consoleLang(env, locale), lang, JSON.stringify(env) + ' ' + locale)
    }
    assert.ok(['tr', 'en'].includes(i18n.consoleLang({})))
    assert.equal(typeof i18n.systemLocale(), 'string')
  })
})

describe('sözlükler', () => {
  it('tr ve en anahtar kümeleri, parametre adları birebir aynı, değerler dolu ve temiz', () => {
    const tr = i18n.keys('tr')
    const en = i18n.keys('en')
    assert.ok(tr.length > 100)
    assert.deepEqual(tr.slice().sort(), en.slice().sort())
    for (const key of tr) {
      const trText = i18n.t('tr', key)
      const enText = i18n.t('en', key)
      assert.ok(trText.trim() !== '' && enText.trim() !== '', key)
      assert.deepEqual(paramsOf(trText), paramsOf(enText), key)
      assert.ok(!FORBIDDEN_CHARS.test(trText) && !FORBIDDEN_CHARS.test(enText), key)
      assert.ok(!trText.includes(';') && !enText.includes(';'), key)
      assert.ok(!TURKISH_LETTERS.test(enText), key + ': ' + enText)
      assert.ok(/^[a-z]+\.[A-Za-z0-9_]+$/.test(key), key)
    }
  })

  it('t: parametreler yerleştirilir, eksikler olduğu gibi kalır, bilinmeyen anahtar kendisini döner', () => {
    assert.equal(i18n.t('tr', 'detail.uploadTooLarge', { mb: 25 }), 'Dosya çok büyük. En fazla 25 MB yüklenebilir.')
    assert.equal(i18n.t('en', 'detail.uploadTooLarge', { mb: 25 }), 'The file is too large. The maximum size is 25 MB.')
    assert.equal(i18n.t('en', 'detail.uploadTooLarge'), 'The file is too large. The maximum size is {mb} MB.')
    assert.equal(i18n.t('en', 'detail.uploadTooLarge', { other: 1 }), 'The file is too large. The maximum size is {mb} MB.')
    // Değerler yorumlanmaz, yalnızca metin olarak eklenir
    assert.equal(i18n.t('en', 'cli.userNotFound', { name: '{name}$&' }), 'Error: no user named "{name}$&" was found.')
    assert.equal(i18n.t('en', 'cli.userNotFound', Object.create({ name: 'miras' })), 'Error: no user named "{name}" was found.')
    assert.equal(i18n.t('de', 'errors.bad_request'), i18n.t('en', 'errors.bad_request'))
    const unknown = ['yok', 'anahtar'].join('.')
    assert.equal(i18n.t('tr', unknown), unknown)
    assert.equal(i18n.has('tr', 'errors.bad_request'), true)
    assert.equal(i18n.has('tr', unknown), false)
    assert.equal(i18n.has('de', 'errors.bad_request'), false)
  })

  it('kaynakta kullanılan tüm hata kodları ve sözlük anahtarları iki dilde de var', () => {
    const app = readSource('src/app.js')
    const codes = new Set()
    for (const m of app.matchAll(/\bfail\(ctx, \d{3}, '([a-z_]+)'/g)) codes.add(m[1])
    for (const m of app.matchAll(/\bfailEarly\(req, res, \d{3}, '([a-z_]+)'/g)) codes.add(m[1])
    for (const m of app.matchAll(/errorBody\([a-zA-Z.()]+, '([a-z_]+)'\)/g)) codes.add(m[1])
    const social = /const SOCIAL_STATUS = \{([^}]+)\}/.exec(app)
    for (const m of social[1].matchAll(/([a-z_]+): \d{3}/g)) codes.add(m[1])
    assert.ok(codes.size > 40, String(codes.size))
    for (const code of codes) {
      for (const lang of i18n.LANGS) assert.ok(i18n.has(lang, 'errors.' + code), lang + ' errors.' + code)
    }
    let literal = 0
    for (const rel of sourceFiles()) {
      if (rel === path.join('src', 'i18n.js')) continue
      const text = readSource(rel)
      for (const m of text.matchAll(/'((?:errors|detail|http|defaults|log|store|config|console|cli|envfile)\.[A-Za-z0-9_]+)'/g)) {
        literal++
        for (const lang of i18n.LANGS) assert.ok(i18n.has(lang, m[1]), rel + ': ' + lang + ' ' + m[1])
      }
    }
    assert.ok(literal > 80, String(literal))
  })

  it('src/ altında (i18n.js hariç) dize ve şablon sabitlerinde Türkçeye özgü harf yok', (t) => {
    let acorn
    try {
      acorn = require('acorn')
    } catch (err) {
      t.skip('acorn kurulu değil')
      return
    }
    for (const rel of sourceFiles()) {
      if (rel === path.join('src', 'i18n.js') || !rel.startsWith('src')) continue
      const ast = acorn.parse(readSource(rel), { ecmaVersion: 'latest', sourceType: 'script', locations: true })
      const found = []
      const walk = (node) => {
        if (!node || typeof node.type !== 'string') return
        if (node.type === 'Literal' && typeof node.value === 'string' && TURKISH_LETTERS.test(node.value)) found.push(node.loc.start.line)
        if (node.type === 'TemplateElement' && TURKISH_LETTERS.test(node.value.raw)) found.push(node.loc.start.line)
        for (const key of Object.keys(node)) {
          const value = node[key]
          if (Array.isArray(value)) value.forEach(walk)
          else if (value && typeof value.type === 'string') walk(value)
        }
      }
      walk(ast)
      assert.deepEqual(found, [], rel)
    }
  })
})

describe('API hata metinleri isteğin dilinde, kod aynı', () => {
  it('Accept-Language yoksa İngilizce, tr ise Türkçe', async () => {
    // Kurulum ve üç hatalı kayıt denemesi sınırı doldurur, sonraki giriş denemesi 429 alır
    const ctx = await h.startServer({ authLimit: 4 })
    try {
      const owner = await h.setupOwner(ctx)
      const TR = { 'accept-language': 'tr-TR,tr;q=0.9' }
      const EN = { 'accept-language': 'en-GB' }
      const pairs = [
        {
          send: (headers) => h.request(ctx, 'GET', '/api/state', { headers }),
          status: 401,
          code: 'invalid_token',
          en: 'Your session has ended. Please sign in again.',
          tr: 'Oturumunuz sona erdi. Lütfen yeniden giriş yapın.'
        },
        {
          send: (headers) => h.request(ctx, 'GET', '/api/yok', { headers }),
          status: 404,
          code: 'not_found',
          en: 'The requested address was not found.',
          tr: 'İstenen adres bulunamadı.'
        },
        {
          send: (headers) => h.request(ctx, 'GET', '/api/login', { headers }),
          status: 405,
          code: 'method_not_allowed',
          en: 'This address does not support this request method.',
          tr: 'Bu adres bu istek yöntemini desteklemiyor.'
        },
        {
          send: (headers) => h.request(ctx, 'POST', '/api/messages', { headers, token: owner.token, body: '{bozuk' }),
          status: 400,
          code: 'bad_request',
          en: 'The request is invalid.',
          tr: 'İstek geçersiz.'
        },
        {
          send: (headers) => h.request(ctx, 'POST', '/api/me/status', { headers, token: owner.token, body: { status: 'uyuyor' } }),
          status: 400,
          code: 'bad_status',
          en: 'The status is invalid. Choose online, idle, do not disturb or invisible.',
          tr: 'Durum geçersiz. Çevrimiçi, boşta, rahatsız etmeyin veya görünmez seçilebilir.'
        },
        {
          send: (headers) => h.request(ctx, 'POST', '/api/users/role', { headers, token: owner.token, body: { userId: owner.user.id, role: 'admin' } }),
          status: 403,
          code: 'forbidden',
          en: 'The role of the server owner cannot be changed.',
          tr: 'Sahibin rolü değiştirilemez.'
        },
        {
          send: (headers) => h.request(ctx, 'POST', '/api/register', { headers, body: h.registerBody('yeni', { inviteCode: 'ZZZZZ-ZZZZZ' }) }),
          status: 403,
          code: 'bad_code',
          en: 'The invite code is incorrect.',
          tr: 'Davet kodu hatalı.'
        }
      ]
      for (const { send, status, code, en, tr } of pairs) {
        for (const { headers, text } of [{ headers: undefined, text: en }, { headers: EN, text: en }, { headers: TR, text: tr }]) {
          const res = await send(headers)
          h.expectStatus(res, status, code)
          assert.equal(res.data.error, text, code + ' ' + JSON.stringify(headers))
        }
      }
      // Hız sınırı ayrıntılı metni (kayıt denemeleri bu IP için sınırı doldurdu)
      const limited = await h.request(ctx, 'POST', '/api/login', { headers: TR, body: { name: 'sahip', authKey: h.authKeyFor('x') } })
      h.expectStatus(limited, 429, 'rate_limited')
      assert.equal(limited.data.error, 'Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.')
      const limitedEn = await h.request(ctx, 'POST', '/api/login', { body: { name: 'sahip', authKey: h.authKeyFor('x') } })
      assert.equal(limitedEn.data.error, 'Too many attempts. Please try again in a few minutes.')
    } finally {
      await ctx.cleanup()
    }
  })

  it('parametreli metin: yükleme sınırı MB değeri', async () => {
    const ctx = await h.startServer({ uploadMaxBytes: 1024 * 1024 + 16 })
    try {
      const owner = await h.setupOwner(ctx)
      const big = crypto.randomBytes(1024 * 1024 + 17)
      const tr = await h.request(ctx, 'POST', '/api/uploads', { token: owner.token, raw: big, headers: { 'accept-language': 'tr' } })
      h.expectStatus(tr, 413, 'too_large')
      assert.equal(tr.data.error, 'Dosya çok büyük. En fazla 1 MB yüklenebilir.')
      const en = await h.request(ctx, 'POST', '/api/uploads', { token: owner.token, raw: big })
      h.expectStatus(en, 413, 'too_large')
      assert.equal(en.data.error, 'The file is too large. The maximum size is 1 MB.')
    } finally {
      await ctx.cleanup()
    }
  })

  it('bekleyen poll, oturum başka yerden kapatılınca kendi isteğinin dilinde 401 alır', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const second = await h.login(ctx, 'sahip')
      h.expectStatus(second, 200)
      const st = await h.stateOf(ctx, second.data.token)
      const url = '/api/poll?since=' + st.seq + '&mv=' + st.metaVersion + '&pmv=' + st.pmv + '&sig=0&boot=' + st.boot
      const waiting = h.nextRequest(ctx.server, '/api/poll')
      const pending = h.request(ctx, 'GET', url, { token: second.data.token, headers: { 'accept-language': 'tr' } })
      await waiting
      h.expectStatus(await h.post(ctx, '/api/me/sessions/revoke', owner.token, { others: true }), 200)
      const res = await pending
      h.expectStatus(res, 401, 'invalid_token')
      assert.equal(res.data.error, 'Oturumunuz sona erdi. Lütfen yeniden giriş yapın.')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('günlük ve ilk kurulum dili (lang seçeneği)', () => {
  it('lang: en ile ilk kanallar ve günlükler İngilizce, varsayılan tr', async () => {
    const en = await h.startServer({ lang: 'en' })
    try {
      const owner = await h.setupOwner(en)
      const st = await h.stateOf(en, owner.token)
      assert.deepEqual(st.meta.channels.map((c) => c.name), ['general', 'gaming', 'Voice 1', 'Voice 2'])
      assert.ok(en.log.lines.info.includes('The owner account was created. The setup code is no longer valid.'))
    } finally {
      await en.cleanup()
    }
    const tr = await h.startServer()
    try {
      const owner = await h.setupOwner(tr)
      const st = await h.stateOf(tr, owner.token)
      assert.deepEqual(st.meta.channels.map((c) => c.name), ['genel', 'oyun', 'Ses 1', 'Ses 2'])
      assert.ok(tr.log.lines.info.includes('Sahip hesabı oluşturuldu. Kurulum kodu artık geçersiz.'))
    } finally {
      await tr.cleanup()
    }
    const { createChatServer } = require('../src/app')
    await assert.rejects(createChatServer({ dataDir: 'x', lang: 'de' }), TypeError)
  })

  it('bozuk veri dosyası hatası lang diline göre, kod aynı', async () => {
    const { createChatServer } = require('../src/app')
    const root = h.makeRoot()
    try {
      const dataDir = path.join(root, 'veri')
      fs.mkdirSync(dataDir, { recursive: true })
      fs.writeFileSync(path.join(dataDir, 'state.json'), '{bozuk')
      const corruptEn = (err) => err.code === 'corrupt' && /^The data file is corrupt: /.test(err.message)
      const corruptTr = (err) => err.code === 'corrupt' && /^Veri dosyası bozuk: /.test(err.message)
      await assert.rejects(createChatServer({ dataDir, scryptN: 1024, log: null, lang: 'en' }), corruptEn)
      await assert.rejects(createChatServer({ dataDir, scryptN: 1024, log: null }), corruptTr)
      assert.deepEqual(fs.readdirSync(dataDir), ['state.json'])
    } finally {
      h.removeRoot(root)
    }
  })
})
