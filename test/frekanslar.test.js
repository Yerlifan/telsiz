'use strict'

// Web istemcisinde frekans listesi (public/js/24-frekans.js): adres doğrulaması, adres parçasına yazılan
// liste (#frekanslar=<base64url JSON>) ve geri çözülmesi, birleştirme kuralları, yerel depo ve
// 03-auth.js readFragment ile birlikte davet bağlantısının #davet= ve #anahtar= parçalarının bozulmaması.
// Modüller tarayıcıdaki gibi ortak bir genel ortamda Node vm bağlamında yüklenir.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const nodeCrypto = require('node:crypto')

const PUB = path.join(__dirname, '..', 'public')
const FILES = [
  'vendor/nacl-fast.min.js', 'vendor/scrypt.js', 'i18n.js', 'crypto.js',
  'js/01-core.js', 'js/02-state-dom.js', 'js/03-auth.js', 'js/24-frekans.js'
]
const SOURCES = FILES.map((file) => ({ file, code: fs.readFileSync(path.join(PUB, file), 'utf8') }))
const SELF = 'https://kankalar.ornek.com'
// vm bağlamından gelen nesneler başka bir gerçekliğe aittir, karşılaştırmadan önce düz nesneye çevrilir
const plain = (value) => JSON.parse(JSON.stringify(value))

function makeStorage () {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v))
    },
    removeItem: (k) => {
      map.delete(k)
    }
  }
}

function load (opts) {
  const o = opts || {}
  const sandbox = vm.createContext({})
  const replaced = []
  sandbox.self = sandbox
  sandbox.window = sandbox
  sandbox.setTimeout = setTimeout
  sandbox.clearTimeout = clearTimeout
  sandbox.crypto = nodeCrypto.webcrypto
  sandbox.URL = URL
  sandbox.TextEncoder = TextEncoder
  sandbox.TextDecoder = TextDecoder
  sandbox.btoa = btoa
  sandbox.atob = atob
  sandbox.localStorage = makeStorage()
  sandbox.sessionStorage = makeStorage()
  sandbox.navigator = { languages: ['tr-TR'], language: 'tr-TR', userAgent: 'node' }
  sandbox.document = { documentElement: { lang: 'tr' }, readyState: 'loading', hidden: false, title: 'Telsiz', addEventListener () {} }
  sandbox.location = { origin: o.origin || SELF, hash: o.hash || '', pathname: '/', search: '' }
  sandbox.history = { replaceState: (a, b, url) => replaced.push(url) }
  sandbox.console = { warn () {}, log () {}, error () {} }
  if (o.desktop) sandbox.telsizDesktop = o.desktop
  for (const src of SOURCES) vm.runInContext(src.code, sandbox, { filename: src.file })
  const run = (code) => vm.runInContext(code, sandbox)
  return { sandbox, run, F: sandbox.TelsizFrekans, replaced }
}

test('adres doğrulaması masaüstüyle aynı kurallar: https veya bu bilgisayar, kök adres', () => {
  const { F } = load()
  const ok = {
    'https://telsiz.ornek.com': 'https://telsiz.ornek.com',
    'telsiz.ornek.com': 'https://telsiz.ornek.com',
    'https://telsiz.ornek.com/': 'https://telsiz.ornek.com',
    'HTTPS://Telsiz.Ornek.COM:8443': 'https://telsiz.ornek.com:8443',
    'https://telsiz.ornek.com:443': 'https://telsiz.ornek.com',
    'http://localhost:4800': 'http://localhost:4800',
    'http://127.0.0.1:4801/': 'http://127.0.0.1:4801',
    '  https://a.com  ': 'https://a.com'
  }
  for (const input of Object.keys(ok)) assert.deepEqual(plain(F.parseAddress(input)), { ok: true, origin: ok[input] }, input)
  const bad = {
    '': 'invalid',
    'ftp://a.com': 'invalid',
    'javascript:alert(1)': 'invalid',
    'http://a.com': 'insecure',
    'http://192.168.1.5': 'insecure',
    'https://user:pw@a.com': 'credentials',
    'https://a.com/yol': 'path',
    'https://a.com/?x=1': 'path',
    'https://a.com/#davet=1': 'path',
    'https://a.com?': 'path',
    'https://a.com#': 'path',
    'https://a.com/%2e%2e/': 'path',
    'https://a .com': 'invalid',
    'https://a.com\\@b.com': 'invalid'
  }
  for (const input of Object.keys(bad)) assert.deepEqual(plain(F.parseAddress(input)), { ok: false, code: bad[input] }, input)
  assert.deepEqual(plain(F.parseAddress('https://' + 'a'.repeat(300) + '.com')), { ok: false, code: 'too_long' })
  assert.deepEqual(plain(F.parseAddress(5)), { ok: false, code: 'invalid' })
  assert.equal(F.validOrigin('https://a.com'), true)
  assert.equal(F.validOrigin('https://a.com/'), false)
  assert.equal(F.validOrigin('HTTPS://a.com'), false)
})

test('parça kodlaması: yalnızca adres ve ad, base64url, geri çözülür', () => {
  const { F } = load()
  const list = [
    { origin: 'https://a.com', name: 'Kankalar ğüşiöç 🎧', token: 'gizli', key: 'anahtar' },
    { origin: 'http://localhost:4800', name: null },
    { origin: 'https://b.com:8443' }
  ]
  const text = F.encodeList(list)
  assert.match(text, /^[A-Za-z0-9_-]+$/)
  assert.ok(!text.includes('=') && !text.includes('&'), 'davet parçasının ayırıcılarını içermez')
  const json = Buffer.from(text, 'base64url').toString('utf8')
  assert.ok(!json.includes('gizli') && !json.includes('anahtar'), 'parçada anahtar veya oturum yok')
  assert.deepEqual(JSON.parse(json), { v: 1, f: [['https://a.com', 'Kankalar ğüşiöç 🎧'], ['http://localhost:4800', null], ['https://b.com:8443', null]] })
  assert.deepEqual(JSON.parse(JSON.stringify(F.decodeList(text))), [
    { origin: 'https://a.com', name: 'Kankalar ğüşiöç 🎧' },
    { origin: 'http://localhost:4800', name: null },
    { origin: 'https://b.com:8443', name: null }
  ])
})

test('parça çözme: bozuk, büyük veya kurala uymayan her öğe atılır', () => {
  const { F } = load()
  const enc = (value) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  for (const bad of ['', '!!!', 'a', 'x'.repeat(9000), enc([['https://a.com']]), enc({ v: 2, f: [['https://a.com']] }), enc({ v: 1, f: 'x' }), Buffer.from('{bozuk').toString('base64url'), Buffer.from([0xff, 0xfe, 0x00]).toString('base64url')]) {
    assert.deepEqual(plain(F.decodeList(bad)), [], bad.slice(0, 20))
  }
  assert.deepEqual(plain(F.decodeList(5)), [])
  const mixed = enc({
    v: 1,
    f: [
      ['http://kotu.com', 'x'],
      ['https://a.com/yol', 'x'],
      ['javascript:alert(1)', 'x'],
      ['https://u:p@a.com', 'x'],
      ['https://a.com', { toString: () => 'x' }],
      ['https://a.com', 'Satır' + String.fromCharCode(10) + 'sonu' + String.fromCharCode(0x202e)],
      ['https://a.com', 'yineleme'],
      ['https://b.com', 'y'.repeat(101)],
      ['https://c.com', 'C', 'fazla'],
      'https://d.com',
      [5, 'x']
    ]
  })
  assert.deepEqual(JSON.parse(JSON.stringify(F.decodeList(mixed))), [
    { origin: 'https://a.com', name: 'Satır sonu' },
    { origin: 'https://b.com', name: null }
  ])
  const many = enc({ v: 1, f: Array.from({ length: 100 }, (_, i) => ['https://f' + i + '.com', null]) })
  assert.equal(F.decodeList(many).length, 30)
})

test('birleştirme: kendi köken alınmaz, yerel ad korunur, yeniler eklenir, en fazla 30', () => {
  const { F } = load()
  const local = [{ origin: 'https://a.com', name: 'Yerel ad' }, { origin: 'https://b.com', name: null }]
  const incoming = [{ origin: SELF, name: 'Ben' }, { origin: 'https://a.com', name: 'Sahte ad' }, { origin: 'https://b.com', name: 'B' }, { origin: 'https://c.com', name: 'C' }]
  assert.deepEqual(JSON.parse(JSON.stringify(F.mergeLists(local, incoming, SELF))), [
    { origin: 'https://a.com', name: 'Yerel ad' },
    { origin: 'https://b.com', name: null },
    { origin: 'https://c.com', name: 'C' }
  ])
  const big = Array.from({ length: 40 }, (_, i) => ({ origin: 'https://g' + i + '.com' }))
  assert.equal(F.mergeLists(local, big, SELF).length, 30)
})

test('birleştirme: başka bir frekansın adını taşıyan yeni frekans adsız eklenir (sahte istasyon tanıdık adla görünmez)', () => {
  const { F } = load()
  const local = [{ origin: 'https://ekip.com', name: 'Ekip' }]
  const incoming = [
    { origin: 'https://ekip-telsiz.com', name: 'ekip' },
    { origin: 'https://ekip2.com', name: 'ＥＫＩＰ' },
    { origin: 'https://x.com', name: 'X' },
    { origin: 'https://y.com', name: 'x' },
    { origin: 'https://ben-sahte.com', name: 'Kankalar' },
    { origin: 'https://z.com', name: 'Z' }
  ]
  assert.deepEqual(plain(F.mergeLists(local, incoming, SELF, ['Kankalar'])), [
    { origin: 'https://ekip.com', name: 'Ekip' },
    { origin: 'https://ekip-telsiz.com', name: null },
    { origin: 'https://ekip2.com', name: null },
    { origin: 'https://x.com', name: 'X' },
    { origin: 'https://y.com', name: null },
    { origin: 'https://ben-sahte.com', name: null },
    { origin: 'https://z.com', name: 'Z' }
  ])
})

test('birleştirme: bağlantıdaki ad yalnızca Latin ve Türkçe harf, rakam ve temel noktalamadan oluşabilir, benzer harfler tanıdık adı taklit edemez', () => {
  const { F } = load()
  const local = [{ origin: 'https://ekip.com', name: 'Kankalar' }]
  const incoming = [
    { origin: 'https://kiril.com', name: 'K\u0430nk\u0430l\u0430r' },
    { origin: 'https://buyuk-i.com', name: 'KankaIar' },
    { origin: 'https://gorunmez.com', name: 'Kan\u200bkalar' },
    { origin: 'https://aksan.com', name: 'Ka\u0301nkalar' },
    { origin: 'https://bosluk.com', name: 'Kanka lar.' },
    { origin: 'https://yunan.com', name: '\u03a4elsiz' },
    { origin: 'https://rakam.com', name: 'Te1siz' },
    { origin: 'https://cherokee.com', name: 'Tels\u13a5z' },
    { origin: 'https://lisu.com', name: '\ua4d4elsiz' },
    { origin: 'https://etiket.com', name: 'Tel\udb40\udd00siz' },
    { origin: 'https://unlem.com', name: 'Tels\u00a1z' },
    { origin: 'https://kucukbuyuk.com', name: 'Telsi\u1d22' },
    { origin: 'https://baska.com', name: 'Kardeşler' }
  ]
  assert.deepEqual(plain(F.mergeLists(local, incoming, SELF, ['Telsiz'])), [
    { origin: 'https://ekip.com', name: 'Kankalar' },
    { origin: 'https://kiril.com', name: null },
    { origin: 'https://buyuk-i.com', name: null },
    { origin: 'https://gorunmez.com', name: null },
    { origin: 'https://aksan.com', name: null },
    { origin: 'https://bosluk.com', name: null },
    { origin: 'https://yunan.com', name: null },
    { origin: 'https://rakam.com', name: null },
    { origin: 'https://cherokee.com', name: null },
    { origin: 'https://lisu.com', name: null },
    { origin: 'https://etiket.com', name: null },
    { origin: 'https://unlem.com', name: null },
    { origin: 'https://kucukbuyuk.com', name: null },
    { origin: 'https://baska.com', name: 'Kardeşler' }
  ])
})

test('readFragment: parçayla listeye eklenen frekanslar sessizce eklenmez, adresleriyle bildirilir', () => {
  const enc = (list) => Buffer.from(JSON.stringify({ v: 1, f: list })).toString('base64url')
  const page = load({ hash: '#frekanslar=' + enc([['https://ekip-telsiz.com', 'Ekip'], [SELF, 'Ben'], ['https://ekip.com', 'Ekip']]) })
  page.sandbox.localStorage.setItem('telsiz.frekanslar', JSON.stringify([{ origin: 'https://ekip.com', name: 'Ekip' }]))
  page.sandbox.localStorage.setItem('telsiz.frekanslar.konum', '1')
  page.run('readFragment()')
  // Sahte frekans adsız ve sona eklenir: parça sırayı değiştirip onu açık frekansın yanına koyamaz
  assert.deepEqual(JSON.parse(page.sandbox.localStorage.getItem('telsiz.frekanslar')), [{ origin: 'https://ekip.com', name: 'Ekip' }, { origin: 'https://ekip-telsiz.com', name: null }])
  assert.equal(page.sandbox.localStorage.getItem('telsiz.frekanslar.konum'), '1')
  assert.equal(page.run('state.fragmentNotice.kind'), 'ok')
  assert.match(page.run('state.fragmentNotice.text()'), /ekip-telsiz\.com/)
  // Yeni frekans yoksa bildirim de yok
  const known = load({ hash: '#frekanslar=' + enc([['https://ekip.com', 'Ekip'], [SELF, 'Ben']]) })
  known.sandbox.localStorage.setItem('telsiz.frekanslar', JSON.stringify([{ origin: 'https://ekip.com', name: 'Ekip' }]))
  known.run('readFragment()')
  assert.equal(known.run('state.fragmentNotice'), null)
  // Anahtar parçasının bildirimi korunur, frekans bildirimi ona eklenir
  const both = load({ hash: '#anahtar=bozuk&frekanslar=' + enc([['https://a.com', 'A']]) })
  both.run('readFragment()')
  assert.equal(both.run('state.fragmentNotice.kind'), 'error')
  const text = both.run('state.fragmentNotice.text()')
  assert.match(text, /a\.com/)
  assert.ok(text.indexOf(both.run("t('fragment.keyInvalid', { reason: '' })").slice(0, 10)) === 0, text)
  // Çok sayıda frekans: ilk beşi adıyla, gerisi sayıyla
  const many = load({ hash: '#frekanslar=' + enc(Array.from({ length: 7 }, (_, i) => ['https://g' + i + '.com', null])) })
  many.run('readFragment()')
  const manyText = many.run('state.fragmentNotice.text()')
  assert.match(manyText, /g4\.com/)
  assert.ok(manyText.indexOf('g5.com') === -1 && manyText.indexOf('2') !== -1, manyText)
})

test('readFragment: sunucunun adı parça okunduktan sonra öğrenilir, açık frekansın adını taşıyan yeni frekans adsız kalır', () => {
  const enc = (list) => Buffer.from(JSON.stringify({ v: 1, f: list })).toString('base64url')
  const page = load({ hash: '#frekanslar=' + enc([['https://evil.example', 'ｋａｎｋａ'], ['https://a.com', 'A']]) })
  page.sandbox.localStorage.setItem('telsiz.frekanslar', JSON.stringify([{ origin: 'https://eski.com', name: 'Eski' }]))
  // start: readFragment loadInfo'dan önce çalışır, state.serverName henüz varsayılan addır
  page.run('document.getElementById = () => null')
  page.run('readFragment()')
  assert.equal(page.run('state.serverName'), 'Telsiz')
  page.run("applyInfo({ serverName: 'Kanka' })")
  // Parçayla gelen sahte frekans açık frekansın adını alamaz, adresiyle görünür. Diğer adlar korunur.
  assert.deepEqual(JSON.parse(page.sandbox.localStorage.getItem('telsiz.frekanslar')), [
    { origin: 'https://eski.com', name: 'Eski' },
    { origin: 'https://evil.example', name: null },
    { origin: 'https://a.com', name: 'A' }
  ])
  assert.deepEqual(plain(page.F.readLocal()), JSON.parse(page.sandbox.localStorage.getItem('telsiz.frekanslar')))
  // Yerel listede kişinin kendi verdiği ad parça yoksa değişmez
  const plainPage = load()
  plainPage.run('document.getElementById = () => null')
  plainPage.sandbox.localStorage.setItem('telsiz.frekanslar', JSON.stringify([{ origin: 'https://eski.com', name: 'Kanka' }]))
  plainPage.run("applyInfo({ serverName: 'Kanka' })")
  assert.deepEqual(JSON.parse(plainPage.sandbox.localStorage.getItem('telsiz.frekanslar')), [{ origin: 'https://eski.com', name: 'Kanka' }])
})

test('readFragment: frekans listesi yerel depoya eklenir, davet ve anahtar parçaları çalışmaya devam eder', () => {
  const list = Buffer.from(JSON.stringify({ v: 1, f: [['https://a.com', 'A'], [SELF, 'Ben'], ['http://kotu.com', 'K']] })).toString('base64url')
  const page = load({ hash: '#davet=KOD-123&frekanslar=' + list })
  page.run('readFragment()')
  assert.equal(page.sandbox.sessionStorage.getItem('telsiz.invite'), 'KOD-123')
  assert.deepEqual(JSON.parse(page.sandbox.localStorage.getItem('telsiz.frekanslar')), [{ origin: 'https://a.com', name: 'A' }])
  assert.deepEqual(page.replaced, ['/'], 'parça adresten silindi')
  // Yalnızca frekans parçası
  const only = load({ hash: '#frekanslar=' + list })
  only.sandbox.localStorage.setItem('telsiz.frekanslar', JSON.stringify([{ origin: 'https://a.com', name: 'Yerel' }, { origin: 'https://z.com' }]))
  only.run('readFragment()')
  assert.deepEqual(JSON.parse(only.sandbox.localStorage.getItem('telsiz.frekanslar')), [{ origin: 'https://a.com', name: 'Yerel' }, { origin: 'https://z.com', name: null }])
  assert.deepEqual(only.replaced, ['/'])
  // Bozuk parça hiçbir şey eklemez ama adresten silinir
  const broken = load({ hash: '#frekanslar=%%%' })
  broken.run('readFragment()')
  assert.equal(broken.sandbox.localStorage.getItem('telsiz.frekanslar'), null)
  assert.deepEqual(broken.replaced, ['/'])
  // Frekans parçası olmayan davet bağlantısı eskisi gibi
  const invite = load({ hash: '#davet=ABC' })
  invite.run('readFragment()')
  assert.equal(invite.sandbox.sessionStorage.getItem('telsiz.invite'), 'ABC')
  assert.equal(invite.sandbox.localStorage.getItem('telsiz.frekanslar'), null)
})

test('yerel depo: bozuk veya kurala uymayan kayıtlar okunmaz, depo kapalıysa hata vermez', () => {
  const page = load()
  page.sandbox.localStorage.setItem('telsiz.frekanslar', '{bozuk')
  assert.equal(page.F.readLocal().length, 0)
  page.sandbox.localStorage.setItem('telsiz.frekanslar', JSON.stringify([{ origin: SELF }, { origin: 'https://a.com', name: 7 }, { origin: 'http://a.com' }]))
  assert.deepEqual(JSON.parse(JSON.stringify(page.F.readLocal())), [{ origin: 'https://a.com', name: null }])
  page.sandbox.localStorage.getItem = () => {
    throw new Error('kapalı')
  }
  page.sandbox.localStorage.setItem = () => {
    throw new Error('kapalı')
  }
  assert.deepEqual(plain(page.F.readLocal()), [])
  assert.equal(page.F.mergeFragment(Buffer.from(JSON.stringify({ v: 1, f: [['https://a.com', null]] })).toString('base64url')), 1)
})

test('masaüstünde liste ana süreçten gelir, parça yok sayılır', async () => {
  const calls = []
  const desktop = {
    listFrequencies: () => {
      calls.push('list')
      return Promise.resolve({ active: 'https://b.com', items: [{ origin: 'https://a.com', name: 'A', active: false }, { origin: 'https://b.com', name: 'B', active: true }, { origin: 'http://kotu.com', name: 'K' }] })
    },
    setFrequencyName: (name) => {
      calls.push('name:' + name)
      return Promise.resolve({ ok: true })
    }
  }
  const page = load({ desktop })
  assert.equal(page.F.mergeFragment(Buffer.from(JSON.stringify({ v: 1, f: [['https://a.com', null]] })).toString('base64url')), 0)
  page.run("state.serverName = 'Kankalar'")
  const items = JSON.parse(JSON.stringify(await page.run('frekansLoadItems()')))
  // Kayıt sırası korunur (order), bant bu sırayla dizer
  assert.deepEqual(items, [
    { origin: 'https://a.com', name: 'A', host: 'a.com', active: false, order: 0 },
    { origin: 'https://b.com', name: 'Kankalar', host: 'b.com', active: true, order: 1 }
  ])
  // Ad yalnızca sunucu bilgisi geldikten sonra ve değişince bildirilir
  page.run("frekansNoteName('Kankalar')")
  page.run("state.info = { serverName: 'Kankalar' }")
  page.run("frekansNoteName('Kankalar')")
  page.run("frekansNoteName('Kankalar')")
  page.run("frekansNoteName('Yeni ad')")
  assert.deepEqual(calls, ['list', 'name:Kankalar', 'name:Yeni ad'])
})

// ------------------------------------------------------------------ frekans bandı modeli

test('bant modeli: durum noktası, sayılar ve sıra (masaüstü)', () => {
  const page = load()
  const M = page.F
  const items = [
    { origin: 'https://c.com', name: null, host: 'c.com', active: false, order: 2 },
    { origin: 'https://a.com', name: 'Kankalar', host: 'a.com', active: true, order: 0 },
    { origin: 'https://b.com', name: 'Bee', host: 'b.com', active: false, order: 1 },
    { origin: 'https://d.com', name: 'Dee', host: 'd.com', active: false, order: 3 },
    { origin: 'https://e.com', name: 'Eee', host: 'e.com', active: false, order: 4 }
  ]
  const bgState = M.cleanBackground({
    items: [
      { origin: 'https://b.com', state: 'ok', unread: 7, mention: 2, online: true, onlineUsers: 3 },
      { origin: 'https://c.com', state: 'offline', unread: 5, mention: 1, online: false },
      { origin: 'https://d.com', state: 'login', unread: 0, mention: 0, online: true },
      { origin: 'javascript:alert(1)', state: 'ok', unread: 9 }
    ]
  })
  const model = plain(M.bandModel(items, { desktop: true, bg: bgState, own: { unread: 4, mention: 1, online: 2 } }))
  assert.deepEqual(model.map((st) => st.key), ['https://a.com', 'https://b.com', 'https://c.com', 'https://d.com', 'https://e.com'], 'kayıt sırası')
  assert.deepEqual(model.map((st) => st.status), ['open', 'online', 'offline', 'login', 'unknown'])
  assert.deepEqual(model.map((st) => [st.unread, st.mention, st.known]), [[4, 1, true], [7, 2, true], [0, 0, false], [0, 0, false], [0, 0, false]])
  assert.deepEqual(model.map((st) => st.sub), ['Açık · 2 Çevrimiçi', '3 Çevrimiçi', 'Sunucu Çevrimdışı', 'Giriş Gerekli', 'e.com'])
  assert.equal(model[0].tuned, true)
  assert.equal(model.filter((st) => st.tuned).length, 1)
  assert.equal(model[2].name, 'c.com', 'adı bilinmeyen frekansta adres')
  assert.equal(model[0].label, 'Kankalar, Açık Frekans, 4 okunmamış, 1 anma')
  assert.equal(model[1].label, 'Bee, Sunucu Çevrimiçi, 7 okunmamış, 2 anma')
  assert.equal(model[3].label, 'Dee, Giriş Gerekli')
  assert.equal(model[1].title, 'b.com')
  assert.equal(model[1].hidden, false)
})

test('bant modeli: tarayıcıda diğer frekansların durumu ve sayısı gösterilmez, nedeni söylenir', () => {
  const page = load()
  const items = [
    { origin: 'https://a.com', name: 'Kankalar', active: true, order: 1 },
    { origin: 'https://b.com', name: 'Bee', active: false, order: 0 }
  ]
  // Tarayıcıda arka plan durumu verilse bile kullanılmaz
  const bgState = page.F.cleanBackground({ items: [{ origin: 'https://b.com', state: 'ok', unread: 7, mention: 2, online: true }] })
  const model = plain(page.F.bandModel(items, { desktop: false, bg: bgState, own: { unread: 0, mention: 0, online: null } }))
  assert.deepEqual(model.map((st) => st.key), ['https://b.com', 'https://a.com'])
  assert.deepEqual(model.map((st) => st.status), ['unknown', 'open'])
  assert.deepEqual(model.map((st) => st.unread + st.mention), [0, 0])
  assert.equal(model[0].hidden, true)
  assert.match(model[0].label, /^Bee, Durumu Bilinmiyor, durumu ve sayıları yalnızca açıkken görünür$/)
  assert.match(model[0].title, /yalnızca açık frekans için görünür/)
  assert.equal(model[1].sub, 'Açık Frekans', 'çevrimiçi sayısı bilinmeden')
  assert.equal(model[1].label, 'Kankalar, Açık Frekans')
  // Sayılar sınırlanır, bozuk öğeler atılır
  const big = plain(page.F.bandModel([{ origin: 'https://a.com', active: true }, null, 'x'], { desktop: true, own: { unread: 5e9, mention: -3 } }))
  assert.equal(big.length, 1)
  assert.deepEqual([big[0].unread, big[0].mention], [100000, 0])
  assert.equal(page.F.statusOf({ active: false }, { state: 'error', online: null }, true), 'unknown')
  assert.equal(page.F.statusOf({ active: false }, { state: 'offline', online: null }, true), 'offline')
})

test('tarayıcıda bant sırası: parça yerel listeyi kapsıyorsa sıra ve bu frekansın yeri gelen listeye uyar', () => {
  const page = load()
  const enc = (list) => Buffer.from(JSON.stringify({ v: 1, f: list })).toString('base64url')
  // İlk gelişte yerel liste boş: sıra parçadan, bu frekans ikinci sırada
  page.F.mergeFragment(enc([['https://a.com', 'A'], [SELF, 'Ben'], ['https://c.com', null]]))
  assert.deepEqual(plain(page.F.readLocal()).map((i) => i.origin), ['https://a.com', 'https://c.com'])
  assert.equal(page.sandbox.localStorage.getItem('telsiz.frekanslar.konum'), '1')
  page.run("state.serverName = 'Ben'")
  const items = plain(page.run('frekansWebItems()'))
  assert.deepEqual(items.map((i) => [i.origin, i.active, i.order]), [['https://a.com', false, 0], [SELF, true, 1], ['https://c.com', false, 2]])
  // Geçişte parça bant sırasıyla yazılır
  assert.deepEqual(plain(page.F.decodeList(page.F.encodeList(page.run('frekansWebItems()')))).map((i) => i.origin), ['https://a.com', SELF, 'https://c.com'])
  // Yerelde parçada olmayan bir frekans varsa sıra korunur, yeniler sona eklenir
  page.F.mergeFragment(enc([['https://c.com', null], [SELF, 'Ben'], ['https://d.com', 'D']]))
  assert.deepEqual(plain(page.F.readLocal()).map((i) => i.origin), ['https://a.com', 'https://c.com', 'https://d.com'])
  assert.equal(page.sandbox.localStorage.getItem('telsiz.frekanslar.konum'), '1')
  // Bozuk konum değeri 0 sayılır
  page.sandbox.localStorage.setItem('telsiz.frekanslar.konum', 'kotu')
  page.run('frekansState.webList = null')
  assert.equal(plain(page.run('frekansWebItems()'))[0].origin, SELF)
})

test('frekans fotoğrafı: açık frekansın adresi, masaüstünden gelen data: adresinin doğrulaması, bant modeli', () => {
  const page = load()
  const F = page.F
  assert.equal(F.ownIconUrl(), null)
  page.run("state.serverIcon = '" + 'a'.repeat(32) + "'")
  assert.equal(F.ownIconUrl(), '/api/server-icon?v=' + 'a'.repeat(32))
  page.run("state.serverIcon = '../x'")
  assert.equal(F.ownIconUrl(), null, 'bozuk karma')
  const png = 'data:image/png;base64,iVBORw0KGgo='
  assert.equal(F.cleanIconData(png), png)
  assert.equal(F.cleanIconData('data:image/webp;base64,UklGRg=='), 'data:image/webp;base64,UklGRg==')
  for (const bad of ['data:image/svg+xml;base64,PHN2Zz4=', 'https://kotu.com/a.png', 'data:image/png;base64,a"b', 'javascript:alert(1)', null, 5, 'data:image/png;base64,' + 'A'.repeat(1400000)]) {
    assert.equal(F.cleanIconData(bad), null, String(bad).slice(0, 40))
  }
  const bg = F.cleanBackground({ items: [{ origin: 'https://b.com', state: 'ok', unread: 0, mention: 0, online: true, icon: png }, { origin: 'https://c.com', state: 'ok', icon: 'data:text/html;base64,PGI+' }] })
  assert.equal(bg['https://b.com'].icon, png)
  assert.equal(bg['https://c.com'].icon, null)
  const items = [
    { origin: 'https://a.com', name: 'A', active: true, order: 0 },
    { origin: 'https://b.com', name: 'B', active: false, order: 1 },
    { origin: 'https://c.com', name: 'C', active: false, order: 2 }
  ]
  const own = '/api/server-icon?v=' + 'b'.repeat(32)
  const desk = plain(F.bandModel(items, { desktop: true, bg, own: { unread: 0, mention: 0, online: 1 }, ownIcon: own }))
  assert.deepEqual(desk.map((st) => st.icon), [own, png, null])
  // Tarayıcıda diğer frekansların fotoğrafı yüklenemez (CSP img-src 'self'), yalnızca açık frekansınki
  const web = plain(F.bandModel(items, { desktop: false, bg, own: { unread: 0, mention: 0, online: 1 }, ownIcon: own }))
  assert.deepEqual(web.map((st) => st.icon), [own, null, null])
  assert.deepEqual(plain(F.bandModel(items, { desktop: true, bg })).map((st) => st.icon), [null, png, null])
})
