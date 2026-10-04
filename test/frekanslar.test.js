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
  assert.deepEqual(items, [
    { origin: 'https://b.com', name: 'Kankalar', host: 'b.com', active: true },
    { origin: 'https://a.com', name: 'A', host: 'a.com', active: false }
  ])
  // Ad yalnızca sunucu bilgisi geldikten sonra ve değişince bildirilir
  page.run("frekansNoteName('Kankalar')")
  page.run("state.info = { serverName: 'Kankalar' }")
  page.run("frekansNoteName('Kankalar')")
  page.run("frekansNoteName('Kankalar')")
  page.run("frekansNoteName('Yeni ad')")
  assert.deepEqual(calls, ['list', 'name:Kankalar', 'name:Yeni ad'])
})
