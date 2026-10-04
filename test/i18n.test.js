'use strict'

// İstemci dil desteği (public/i18n.js) testleri. Dosya Node vm bağlamında, tarayıcı genel
// nesnelerinin küçük taklitleriyle yüklenir: sözlük eşliği, dil seçimi ve kalıcılığı,
// parametreler, çoğul biçimler, statik metinlerin doldurulması ve biçimlendirme.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'i18n.js'), 'utf8')
const PARAM_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

// Yeni bir bağlamda i18n.js yükler. options: languages, stored, noIntl, noStorage
function load (options) {
  const opts = options || {}
  const store = new Map()
  if (opts.stored !== undefined) store.set('telsiz.lang', opts.stored)
  const warnings = []
  const localStorage = {
    getItem (key) {
      if (opts.noStorage) throw new Error('blocked')
      return store.has(key) ? store.get(key) : null
    },
    setItem (key, value) {
      if (opts.noStorage) throw new Error('blocked')
      store.set(key, String(value))
    },
    removeItem (key) {
      store.delete(key)
    }
  }
  const documentElement = { lang: 'tr' }
  const sandbox = {
    console: { warn: (...args) => warnings.push(args.join(' ')), log () {}, error () {} },
    navigator: { languages: opts.languages || [], language: (opts.languages || [])[0] || '' },
    document: { documentElement: documentElement },
    localStorage: localStorage
  }
  if (opts.noIntl) sandbox.Intl = undefined
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox, { filename: 'i18n.js' })
  return { I18N: sandbox.window.I18N, store: store, warnings: warnings, documentElement: documentElement }
}

function params (text) {
  return Array.from(new Set(Array.from(text.matchAll(PARAM_RE), (m) => m[1]))).sort()
}

// Intl çıktısındaki dar bölünmez boşluk gibi farkları yok sayar
function spaces (text) {
  return text.replace(/\s/g, ' ')
}

test('tr ve en sözlüklerinin anahtar kümeleri ve parametreleri aynı, değerler boş değil', () => {
  const { I18N } = load({ languages: ['tr-TR'] })
  const tr = I18N.messages.tr
  const en = I18N.messages.en
  const trKeys = Object.keys(tr).sort()
  const enKeys = Object.keys(en).sort()
  assert.deepStrictEqual(trKeys, enKeys)
  assert.ok(trKeys.length > 300, 'sözlükte beklenenden az anahtar var: ' + trKeys.length)
  for (const key of trKeys) {
    assert.strictEqual(typeof tr[key], 'string', key)
    assert.strictEqual(typeof en[key], 'string', key)
    assert.ok(tr[key].trim() !== '' && en[key].trim() !== '', 'boş değer: ' + key)
    assert.deepStrictEqual(params(tr[key]), params(en[key]), 'parametreler farklı: ' + key)
    assert.ok(/^[A-Za-z0-9_.]+$/.test(key), 'anahtar biçimi: ' + key)
    // Yazım kuralları İngilizce metinler için de geçerli: uzun ve kısa tire, noktalı virgül yok
    assert.ok(!/[\u2013\u2014;]/.test(tr[key] + en[key]), 'yasak karakter: ' + key)
  }
})

test('çoğul anahtarlar _one ve _other olarak iki dilde birlikte tanımlı', () => {
  const { I18N } = load({ languages: ['tr-TR'] })
  for (const lang of ['tr', 'en']) {
    const dict = I18N.messages[lang]
    for (const key of Object.keys(dict)) {
      const m = /^(.*)_(one|other)$/.exec(key)
      if (!m) continue
      const pair = m[1] + (m[2] === 'one' ? '_other' : '_one')
      assert.ok(Object.prototype.hasOwnProperty.call(dict, pair), lang + ': ' + key + ' eşi yok')
      assert.ok(!Object.prototype.hasOwnProperty.call(dict, m[1]), lang + ': ' + m[1] + ' hem düz hem çoğul tanımlı')
    }
  }
})

test('ses ve şifreleme modüllerinin önerdiği anahtarlar sözlükte var', () => {
  const { I18N } = load({ languages: ['tr-TR'] })
  const required = [
    'bindings.none', 'bindings.key', 'bindings.mouseMiddle', 'bindings.mouseSide', 'bindings.gamepad', 'keys.numpad', 'keys.Space',
    'errors.key.empty', 'errors.key.bad_length', 'errors.key.bad_char', 'errors.key.bad_padding', 'errors.key.bad_checksum',
    'errors.e2ee.no_key', 'errors.e2ee.bad_data', 'errors.mic_denied', 'errors.mic_not_found', 'errors.mic_failed',
    'errors.no_key', 'errors.insecure', 'errors.unsupported', 'errors.connect_failed', 'errors.kicked', 'errors.join_failed',
    'files.defaultName', 'settings.voice.micUnnamed'
  ]
  for (const key of required) assert.ok(I18N.has(key), key)
})

test('dil seçimi: kayıtlı seçim, tarayıcı dilleri ve İngilizce varsayılanı', () => {
  assert.strictEqual(load({ languages: ['tr-TR', 'en-US'] }).I18N.lang, 'tr')
  assert.strictEqual(load({ languages: ['tr'] }).I18N.lang, 'tr')
  assert.strictEqual(load({ languages: ['en-US'] }).I18N.lang, 'en')
  assert.strictEqual(load({ languages: ['de-DE', 'tr-TR'] }).I18N.lang, 'tr')
  assert.strictEqual(load({ languages: ['de-DE', 'fr-FR'] }).I18N.lang, 'en')
  assert.strictEqual(load({ languages: [] }).I18N.lang, 'en')
  assert.strictEqual(load({ languages: ['tr-TR'], stored: 'en' }).I18N.lang, 'en')
  assert.strictEqual(load({ languages: ['en-US'], stored: 'tr' }).I18N.lang, 'tr')
  assert.strictEqual(load({ languages: ['en-US'], stored: 'xx' }).I18N.lang, 'en')
  assert.strictEqual(load({ languages: ['tr-TR'], noStorage: true }).I18N.lang, 'tr')
  const loaded = load({ languages: ['en-US'] })
  assert.strictEqual(loaded.documentElement.lang, 'en')
})

test('setLang dili değiştirir, kalıcı yapar ve <html lang> değerini günceller', () => {
  const loaded = load({ languages: ['tr-TR'] })
  const I18N = loaded.I18N
  assert.strictEqual(loaded.store.has('telsiz.lang'), false, 'algılanan dil kaydedilmez')
  assert.strictEqual(I18N.setLang('en-US'), 'en')
  assert.strictEqual(I18N.lang, 'en')
  assert.strictEqual(loaded.store.get('telsiz.lang'), 'en')
  assert.strictEqual(loaded.documentElement.lang, 'en')
  assert.strictEqual(I18N.locale(), 'en-US')
  assert.strictEqual(I18N.t('auth.login'), 'Sign in')
  assert.strictEqual(I18N.setLang('de'), 'en', 'desteklenmeyen dil yok sayılır')
  assert.strictEqual(I18N.setLang('TR'), 'tr')
  assert.strictEqual(I18N.t('auth.login'), 'Giriş yap')
  const blocked = load({ languages: ['tr-TR'], noStorage: true })
  assert.strictEqual(blocked.I18N.setLang('en'), 'en', 'depolama yoksa da dil değişir')
})

test('t: parametre yerleştirme ve eksik parametre', () => {
  const { I18N } = load({ languages: ['tr-TR'] })
  assert.strictEqual(I18N.t('channel.welcome', { name: 'genel' }), 'genel odasının başlangıcı')
  assert.strictEqual(I18N.t('auth.nameLength', { min: 2, max: 20 }), 'Kullanıcı adı 2 ile 20 karakter arasında olmalı.')
  assert.strictEqual(I18N.t('channel.welcome'), '{name} odasının başlangıcı', 'parametre verilmezse yer tutucu kalır')
  assert.strictEqual(I18N.t('channel.welcome', { name: '<b>{x}</b>' }), '<b>{x}</b> odasının başlangıcı', 'değer olduğu gibi, yeniden işlenmeden yerleşir')
  I18N.setLang('en')
  assert.strictEqual(I18N.t('channel.welcome', { name: 'general' }), 'Start of general')
  assert.strictEqual(I18N.t('common.percent', { value: 40 }), '40%')
  I18N.setLang('tr')
  assert.strictEqual(I18N.t('common.percent', { value: 40 }), '%40')
})

test('t: çoğul biçim count değerine göre seçilir', () => {
  const { I18N } = load({ languages: ['en-US'] })
  assert.strictEqual(I18N.t('composer.counterLeft', { count: 1 }), '1 character left')
  assert.strictEqual(I18N.t('composer.counterLeft', { count: 150 }), '150 characters left')
  assert.strictEqual(I18N.t('composer.counterLeft', { count: 0 }), '0 characters left')
  assert.strictEqual(I18N.t('channels.unreadLabel', { name: 'general', count: 1 }), 'general, 1 unread message')
  assert.strictEqual(I18N.t('channels.unreadLabel', { name: 'general', count: 3 }), 'general, 3 unread messages')
  assert.ok(I18N.has('members.online'), 'yalnızca çoğul biçimi olan anahtar da var sayılır')
  I18N.setLang('tr')
  assert.strictEqual(I18N.t('composer.counterLeft', { count: 1 }), 'Kalan: 1')
  assert.strictEqual(I18N.t('composer.counterLeft', { count: 150 }), 'Kalan: 150')
  assert.strictEqual(I18N.t('members.online', { count: 2 }), 'Çevrimiçi (2)')
})

test('eksik anahtar: bir kez uyarı, öteki dil veya anahtarın kendisi', () => {
  const loaded = load({ languages: ['tr-TR'] })
  const I18N = loaded.I18N
  assert.strictEqual(I18N.has('yok.boyle.bir.anahtar'), false)
  assert.strictEqual(I18N.t('yok.boyle.bir.anahtar'), 'yok.boyle.bir.anahtar')
  assert.strictEqual(I18N.t('yok.boyle.bir.anahtar'), 'yok.boyle.bir.anahtar')
  assert.strictEqual(loaded.warnings.length, 1)
  assert.ok(/missing key "yok\.boyle\.bir\.anahtar"/.test(loaded.warnings[0]))
  assert.strictEqual(I18N.t('auth.login'), 'Giriş yap')
  assert.strictEqual(loaded.warnings.length, 1, 'var olan anahtar uyarı üretmez')
})

test('apply: data-i18n öznitelikleri metin, placeholder, aria-label ve title olarak doldurulur', () => {
  const { I18N } = load({ languages: ['en-US'] })
  const node = (attrs) => ({
    attrs: Object.assign({}, attrs),
    textContent: 'eski',
    getAttribute (name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null },
    setAttribute (name, value) { this.attrs[name] = String(value) },
    hasAttribute (name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) }
  })
  const text = node({ 'data-i18n': 'auth.login' })
  const input = node({ 'data-i18n-placeholder': 'settings.server.newChannel' })
  const both = node({ 'data-i18n-aria-label': 'user.mute', 'data-i18n-title': 'user.mute' })
  const all = [text, input, both]
  const root = {
    querySelectorAll (selector) {
      const attr = /^\[([a-z0-9-]+)\]$/.exec(selector)[1]
      return all.filter((n) => n.hasAttribute(attr))
    }
  }
  I18N.apply(root)
  assert.strictEqual(text.textContent, 'Sign in')
  assert.strictEqual(input.attrs.placeholder, 'New room name')
  assert.strictEqual(input.textContent, 'eski', 'yalnızca placeholder değişir')
  assert.strictEqual(both.attrs['aria-label'], 'Mute microphone')
  assert.strictEqual(both.attrs.title, 'Mute microphone')
  I18N.setLang('tr')
  I18N.apply(root)
  assert.strictEqual(text.textContent, 'Giriş yap')
  assert.strictEqual(both.attrs['aria-label'], 'Mikrofonu kapat')
})

test('formatSize: dile göre birim, ondalık ayırıcı ve çoğul', () => {
  const { I18N } = load({ languages: ['tr-TR'] })
  assert.strictEqual(I18N.formatSize(16), '16 bayt')
  assert.strictEqual(I18N.formatSize(1), '1 bayt')
  assert.strictEqual(I18N.formatSize(820 * 1024), '820 KB')
  assert.strictEqual(I18N.formatSize(100), '100 bayt')
  assert.strictEqual(I18N.formatSize(1500), '1 KB')
  assert.strictEqual(I18N.formatSize(1468006), '1,4 MB')
  assert.strictEqual(I18N.formatSize(2 * 1024 * 1024), '2 MB')
  assert.strictEqual(I18N.formatSize(150.4 * 1024 * 1024), '150 MB')
  assert.strictEqual(I18N.formatSize(2.5 * 1024 * 1024 * 1024), '2,5 GB')
  assert.strictEqual(I18N.formatSize(-5), '0 bayt')
  I18N.setLang('en')
  assert.strictEqual(I18N.formatSize(1), '1 byte')
  assert.strictEqual(I18N.formatSize(16), '16 bytes')
  assert.strictEqual(I18N.formatSize(1468006), '1.4 MB')
  assert.strictEqual(I18N.formatSize(2.5 * 1024 * 1024 * 1024), '2.5 GB')
})

test('formatDate ve formatTime: Intl ile dile göre tarih ve saat', () => {
  const { I18N } = load({ languages: ['tr-TR'] })
  const afternoon = new Date(2026, 9, 3, 14, 5).getTime()
  const morning = new Date(2026, 9, 3, 9, 5).getTime()
  assert.strictEqual(spaces(I18N.formatDate(afternoon, 'short')), '03.10.2026 14:05')
  assert.strictEqual(spaces(I18N.formatDate(afternoon)), '03.10.2026 14:05')
  assert.strictEqual(spaces(I18N.formatDate(afternoon, 'long')), '3 Ekim 2026 Cumartesi 14:05')
  assert.strictEqual(spaces(I18N.formatDate(afternoon, 'date')), '03.10.2026')
  assert.strictEqual(I18N.formatTime(morning), '09:05')
  I18N.setLang('en')
  assert.strictEqual(spaces(I18N.formatTime(morning)), '9:05 AM')
  assert.strictEqual(spaces(I18N.formatDate(afternoon, 'short')), '10/03/2026, 2:05 PM')
  assert.ok(/^Saturday, October 3, 2026/.test(spaces(I18N.formatDate(afternoon, 'long'))))
  assert.strictEqual(I18N.formatDate(NaN), '')
})

test('formatNumber: dile göre basamak ve ondalık ayırıcı', () => {
  const { I18N } = load({ languages: ['tr-TR'] })
  assert.strictEqual(I18N.formatNumber(1000), '1.000')
  assert.strictEqual(I18N.formatNumber(1.25, 1), '1,3')
  assert.strictEqual(I18N.formatNumber(-50), '-50')
  assert.strictEqual(I18N.formatNumber('abc'), 'abc')
  I18N.setLang('en')
  assert.strictEqual(I18N.formatNumber(1000), '1,000')
  assert.strictEqual(I18N.formatNumber(1.25, 1), '1.3')
})

test('Intl yoksa basit yedek biçimler ve çoğul kuralı kullanılır', () => {
  const { I18N } = load({ languages: ['tr-TR'], noIntl: true })
  const afternoon = new Date(2026, 9, 3, 14, 5).getTime()
  assert.strictEqual(I18N.formatDate(afternoon, 'short'), '03.10.2026 14:05')
  assert.strictEqual(I18N.formatTime(afternoon), '14:05')
  assert.strictEqual(I18N.formatSize(1468006), '1,4 MB')
  I18N.setLang('en')
  assert.strictEqual(I18N.formatDate(afternoon, 'short'), '10/03/2026 14:05')
  assert.strictEqual(I18N.formatSize(1468006), '1.4 MB')
  assert.strictEqual(I18N.t('size.bytes', { count: 1 }), '1 byte')
  assert.strictEqual(I18N.t('size.bytes', { count: 2 }), '2 bytes')
})
