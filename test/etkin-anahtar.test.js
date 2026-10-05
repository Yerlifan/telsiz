'use strict'

// Etkin grup anahtarı yalnızca ileri gider (public/js/03-auth.js activeKid): bu cihazda yerine yenisi geçen bir
// anahtara sunucu veya yönetici geri dönerse istemci onunla şifrelemez. Kayıt yeniden yüklemede ve aynı kökendeki
// başka sekmelerde de geçerlidir. Modüller tarayıcıdaki gibi ortak bir genel ortamda Node vm bağlamında yüklenir.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const nodeCrypto = require('node:crypto')

const PUB = path.join(__dirname, '..', 'public')
const FILES = ['vendor/nacl-fast.min.js', 'vendor/scrypt.js', 'i18n.js', 'crypto.js', 'js/01-core.js', 'js/02-state-dom.js', 'js/03-auth.js']
const SOURCES = FILES.map((file) => ({ file, code: fs.readFileSync(path.join(PUB, file), 'utf8') }))

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

// Aynı depoyu paylaşan bağlamlar aynı kökendeki sekmeler veya yeniden yüklenen sayfa gibidir
function load (storage) {
  const sandbox = vm.createContext({})
  sandbox.self = sandbox
  sandbox.window = sandbox
  sandbox.setTimeout = setTimeout
  sandbox.clearTimeout = clearTimeout
  sandbox.crypto = nodeCrypto.webcrypto
  sandbox.TextEncoder = TextEncoder
  sandbox.TextDecoder = TextDecoder
  sandbox.localStorage = storage
  sandbox.sessionStorage = makeStorage()
  sandbox.navigator = { languages: ['tr-TR'], language: 'tr-TR', userAgent: 'node' }
  sandbox.document = { documentElement: { lang: 'tr' }, readyState: 'loading', hidden: false, title: 'Telsiz', addEventListener () {} }
  sandbox.location = { origin: 'https://kankalar.ornek.com', hash: '', pathname: '/', search: '' }
  sandbox.history = { replaceState () {} }
  sandbox.console = { warn () {}, log () {}, error () {} }
  for (const src of SOURCES) vm.runInContext(src.code, sandbox, { filename: src.file })
  const run = (code) => vm.runInContext(code, sandbox)
  const setKid = (kid) => {
    sandbox.__kid = kid
    run('state.meta = { activeKid: __kid }')
  }
  return { sandbox, run, setKid }
}

test('etkin anahtar geri çevrilince eski anahtarla şifrelenmez, yeni anahtar durumu düzeltir', () => {
  const storage = makeStorage()
  const { run, setKid } = load(storage)
  const k1 = run('window.E2EE.keyring.add(window.E2EE.generateKeyCode())')
  const k2 = run('window.E2EE.keyring.add(window.E2EE.generateKeyCode())')
  setKid(k1)
  assert.equal(run('activeKid()'), k1)
  assert.equal(run('hasActiveKey()'), true)
  // Sahip yeni anahtar oluşturdu (ör. bir üyeyi attıktan sonra)
  setKid(k2)
  assert.equal(run('activeKid()'), k2)
  assert.equal(run('activeKidRolledBack()'), false)
  // Sunucu veya yönetici etkin anahtarı eski anahtara geri çevirir: anahtarlıkta olsa da şifrelenmez
  setKid(k1)
  assert.equal(run('activeKid()'), null)
  assert.equal(run('hasActiveKey()'), false)
  assert.equal(run('activeKidRolledBack()'), true)
  assert.throws(() => run('window.E2EE.sealJson(activeKid(), { v: 1 })'))
  // Eski anahtar geçmişi okumak için anahtarlıkta kalır
  assert.equal(run('window.E2EE.keyring.has(' + JSON.stringify(k1) + ')'), true)
  // Yeniden yüklenen sayfa da geri dönüşü reddeder
  const again = load(storage)
  again.setKid(k1)
  assert.equal(again.run('activeKid()'), null)
  // Yeni bir anahtar ileri gider ve gönderme yeniden açılır
  const k3 = again.run('window.E2EE.keyring.add(window.E2EE.generateKeyCode())')
  again.setKid(k3)
  assert.equal(again.run('activeKid()'), k3)
  assert.equal(again.run('hasActiveKey()'), true)
  again.setKid(k2)
  assert.equal(again.run('activeKid()'), null)
})

test('aynı kökendeki başka sekme yeni anahtarı görünce bu sekme de eski anahtara dönmez', () => {
  const storage = makeStorage()
  const a = load(storage)
  const b = load(storage)
  const k1 = a.run('window.E2EE.keyring.add(window.E2EE.generateKeyCode())')
  const k2 = a.run('window.E2EE.keyring.add(window.E2EE.generateKeyCode())')
  a.setKid(k1)
  assert.equal(a.run('activeKid()'), k1)
  b.setKid(k2)
  assert.equal(b.run('activeKid()'), k2)
  // a sekmesi k2'yi henüz görmedi, sunucu ona yine k1 bildirir
  a.setKid(k1)
  assert.equal(a.run('activeKid()'), null)
})

test('bozuk kayıt yok sayılır, anahtar yoksa etkin anahtar da yoktur', () => {
  const storage = makeStorage()
  storage.setItem('telsiz.keys.retired', '{bozuk')
  const { run, setKid } = load(storage)
  setKid(null)
  assert.equal(run('activeKid()'), null)
  assert.equal(run('activeKidRolledBack()'), false)
  setKid('kısa')
  assert.equal(run('activeKid()'), null)
  const k1 = run('window.E2EE.keyring.add(window.E2EE.generateKeyCode())')
  setKid(k1)
  assert.equal(run('activeKid()'), k1)
  assert.deepEqual(JSON.parse(storage.getItem('telsiz.keys.retired')), { last: k1, retired: [] })
})

test('cihazda olmayan bir kid gerçek anahtarı emekliye ayırmaz, gönderme kapanmaz', () => {
  const storage = makeStorage()
  const { run, setKid } = load(storage)
  const k1 = run('window.E2EE.keyring.add(window.E2EE.generateKeyCode())')
  setKid(k1)
  assert.equal(run('activeKid()'), k1)
  // Sunucu veya yönetici önce kimsede olmayan uydurma bir kid, ardından gerçek anahtarı bildirir
  setKid('0123456789abcdef')
  assert.equal(run('activeKid()'), '0123456789abcdef')
  assert.equal(run('hasActiveKey()'), false)
  assert.equal(run('activeKidRolledBack()'), false)
  setKid(k1)
  assert.equal(run('activeKid()'), k1)
  assert.equal(run('hasActiveKey()'), true)
  assert.equal(run('activeKidRolledBack()'), false)
  assert.deepEqual(JSON.parse(storage.getItem('telsiz.keys.retired')), { last: k1, retired: [] })
  // Yeniden yüklenen sayfada da gerçek anahtar etkin kalır
  const again = load(storage)
  again.setKid(k1)
  assert.equal(again.run('activeKid()'), k1)
  assert.equal(again.run('hasActiveKey()'), true)
})

test('anahtarlıkta doğrulanmayan bir kayıt da öncekinin yerine geçmez', () => {
  const storage = makeStorage()
  const { run, setKid } = load(storage)
  const k1 = run('window.E2EE.keyring.add(window.E2EE.generateKeyCode())')
  setKid(k1)
  assert.equal(run('activeKid()'), k1)
  // Anahtarlığa başka bir anahtarın kodu uydurma bir kid altında yazılmış olsun: kod bu kid'i vermez
  const ring = JSON.parse(storage.getItem('telsiz.keys'))
  ring.keys.fedcba9876543210 = ring.keys[k1]
  storage.setItem('telsiz.keys', JSON.stringify(ring))
  setKid('fedcba9876543210')
  assert.equal(run('hasActiveKey()'), false)
  setKid(k1)
  assert.equal(run('activeKid()'), k1)
  assert.equal(run('hasActiveKey()'), true)
})

test('henüz cihazda olmayan yeni anahtar eklenince ileri gidilir, eskiye dönüş reddedilir', () => {
  const storage = makeStorage()
  const { run, setKid } = load(storage)
  const k1 = run('window.E2EE.keyring.add(window.E2EE.generateKeyCode())')
  setKid(k1)
  assert.equal(run('activeKid()'), k1)
  // Sahip yeni anahtar oluşturdu, üye onu henüz eklemedi: etkin anahtar o olur ama gönderme anahtar gelene dek kapalıdır
  const code2 = run('window.E2EE.generateKeyCode()')
  const k2 = run('window.E2EE.parseKeyCode(' + JSON.stringify(code2) + ').kid')
  setKid(k2)
  assert.equal(run('activeKid()'), k2)
  assert.equal(run('hasActiveKey()'), false)
  assert.equal(run('activeKidRolledBack()'), false)
  // Üye yeni anahtarı ekler: eski anahtar emekliye ayrılır
  assert.equal(run('window.E2EE.keyring.add(' + JSON.stringify(code2) + ')'), k2)
  assert.equal(run('activeKid()'), k2)
  assert.equal(run('hasActiveKey()'), true)
  assert.deepEqual(JSON.parse(storage.getItem('telsiz.keys.retired')), { last: k2, retired: [k1] })
  setKid(k1)
  assert.equal(run('activeKid()'), null)
  assert.equal(run('activeKidRolledBack()'), true)
})
