'use strict'

// public/crypto.js (window.E2EE) testleri. Dosyalar tarayıcıdaki gibi Node vm bağlamında yüklenir.
// Bilinen yanıt vektörleri Python hashlib ve ayrı bir base32 gerçeklemesiyle bağımsız hesaplanmış,
// tek vektör ayrıca openssl dgst -sha512 ile denetlenmiştir.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const nodeCrypto = require('node:crypto')

const ROOT = path.join(__dirname, '..')
const NACL_PATH = path.join(ROOT, 'public', 'vendor', 'nacl-fast.min.js')
const NACL_SRC = fs.readFileSync(NACL_PATH, 'utf8')
const E2EE_SRC = fs.readFileSync(path.join(ROOT, 'public', 'crypto.js'), 'utf8')
// scrypt-js 3.0.1 (Ek F2.1), tarayıcıdaki gibi global scrypt olarak yüklenir.
const SCRYPT_PATH = path.join(ROOT, 'public', 'vendor', 'scrypt.js')
const SCRYPT_SRC = fs.readFileSync(SCRYPT_PATH, 'utf8')
const SCRYPT_SHA256 = '544292934136527d60acc9e337d8c7b953f412e81314aa551a12d4230afd449d'
// Bağımsız denetimler için kütüphanenin ana bağlamdaki ayrı bir kopyası.
const refNacl = require(NACL_PATH)

// acorn geliştirme bağımlılığıdır (npm ci ile kurulur). Yoksa yalnızca kaynak tarama testi atlanır.
let acorn = null
try {
  acorn = require('acorn')
} catch (e) {
  acorn = null
}

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const SERVER_ENVELOPE_RE = /^1\.[0-9a-f]{16}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{24,}$/
const CODE_FORMAT_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/
const RING_KEY = 'telsiz.keys'
const LABEL_CHECK = 'telsiz-e2ee-v1/check'
const LABEL_ENC = 'telsiz-e2ee-v1/enc'
const LABEL_KID = 'telsiz-e2ee-v1/kid'
// Ek F etiketleri, depolama önekleri ve sunucu desenleri
const LABEL_AUTH = 'telsiz-auth-v1'
const LABEL_WRAP = 'telsiz-wrap-v1'
const LABEL_SAFETY = 'telsiz-safety-v1'
const IDENTITY_PREFIX = 'telsiz.identity.'
const PINS_PREFIX = 'telsiz.pins.'
const WRAPPED_RE = /^1w\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{60,70}$/
const DM_SERVER_RE = /^2\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{24,}$/
// Ek F10 ortak türetme vektörü: Node crypto.scryptSync, scrypt-js 3.0.1 ve Python hashlib.scrypt ile
// bağımsız olarak doğrulandı. Sunucu testleri de aynı değerleri kullanır.
const F10 = {
  password: 'Parola-Örnek 1',
  saltHex: '000102030405060708090a0b0c0d0e0f',
  salt: 'AAECAwQFBgcICQoLDA0ODw',
  master: '85a938adac85194b58a6154560b1349e3109149f45a5bc687f04a3d84ff1dbf6',
  authKey: 'ddfe2a33db778dcc5ab649cabff09f25e8b1a4aa32d62d4b36ac75e591245595',
  wrapKey: 'fdb8d3c6f1cf1ab6e1fdecef82533767ee48e009c6f4a870b35241e002cf5dc9'
}
const KDF_F10 = Object.freeze({ salt: F10.salt, N: 16384, r: 8, p: 1 })
const KEY_CODES =['empty', 'bad_length', 'bad_char', 'bad_padding', 'bad_checksum']
// Türkçeye özgü harfler: istemci kodunun dize sabitlerinde ve hata mesajlarında bulunmamalı.
const TURKISH_LETTERS = /[çğıİöşüÇĞÖŞÜ]/
const TECH_MESSAGE_RE = /^[\x20-\x7e]+$/

// Hata nesnesi beklenen kodu taşımalı, mesajı İngilizce teknik metin olmalı ve girdiyi içermemeli.
function assertCoded (err, code, input) {
  assert.equal(err.code, code, 'kod ' + err.code + ' / beklenen ' + code)
  assert.match(err.message, TECH_MESSAGE_RE)
  assert.doesNotMatch(err.message, TURKISH_LETTERS)
  if (typeof input === 'string' && input.replace(/[\s-]/g, '').length >= 4) {
    assert.ok(!err.message.includes(input.replace(/[\s-]/g, '').slice(0, 4)), 'mesaj girdiyi içermemeli')
  }
}

function codeIs (code, input) {
  return (err) => {
    assertCoded(err, code, input)
    return true
  }
}

const KEY_ERROR = (err) => {
  assert.ok(KEY_CODES.includes(err.code), String(err.code))
  assertCoded(err, err.code)
  return true
}

// Python: hashlib.sha512 ve int tabanlı base32 ile hesaplandı (telsiz-e2ee-v1 etiketleri).
const VECTORS = [
  {
    secret: '000102030405060708090a0b0c0d0e0f',
    code: '000G-40R4-0M30-E209-185G-R38E-1W6C',
    kid: '0ca8d7d2262c6177',
    enc: '72cb6a34da09ad7a137309185e7a76a5bb955103167a0c9761078eeec09699d3'
  },
  {
    secret: '00000000000000000000000000000000',
    code: '0000-0000-0000-0000-0000-0000-00KD',
    kid: 'fbb2e8ba85298c4c',
    enc: '6b04b7847833e7209a97cbc9c2796ee19e335567a3877dc0e26538f1da7b544c'
  },
  {
    secret: 'ffffffffffffffffffffffffffffffff',
    code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZWC0',
    kid: '28e5c50bb7f8dba9',
    enc: '0178c798d5ad07630a2ef3f1f75ee348418350c6320d9fc1d414a22f17e67197'
  },
  {
    secret: '8f3a0c11d2e4b5a69788796a5b4c3d2e',
    code: 'HWX0-R4EJ-WJTT-D5W8-F5N5-PK1X-5R08',
    kid: 'aa5a7807b8681f8e',
    enc: 'fd105e28c131439e689da36485bfd9929ceb3caca08536e46cc83bcfe610e8fb'
  }
]

const cp = (...points) => String.fromCodePoint(...points)
const TURKCE = 'Çalışma planı: şğıİçöü ÇĞÖŞÜ, "tırnak" ve \\ ters bölü'
const EMOJI = cp(0x1f44b, 0x1f3fd) + ' ' + cp(0x1f1f9, 0x1f1f7) + ' ' +
  cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467) + ' ' + cp(0x1f600) + ' ' + cp(0x2764, 0xfe0f)

function times (n) {
  return Array.from({ length: n }, (_, i) => i)
}

function hexOf (x) {
  return Buffer.from(x.buffer, x.byteOffset, x.byteLength).toString('hex')
}

function isU8 (x) {
  return Object.prototype.toString.call(x) === '[object Uint8Array]'
}

function plain (x) {
  return JSON.parse(JSON.stringify(x))
}

function isTight (x) {
  return x.byteOffset === 0 && x.byteLength === x.buffer.byteLength
}

// Tekrarlanabilir sınama verisi için tohumlu xorshift32.
function seeded (seed) {
  let x = seed >>> 0
  return function next () {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return x
  }
}

function seededBytes (rand, n) {
  const out = Buffer.alloc(n)
  for (const i of times(n)) out[i] = rand() & 255
  return out
}

function makeStorage (initial) {
  const map = new Map(Object.entries(initial || {}))
  return {
    map,
    getItem (k) {
      return map.has(k) ? map.get(k) : null
    },
    setItem (k, v) {
      map.set(k, String(v))
    },
    removeItem (k) {
      map.delete(k)
    }
  }
}

// getRandomValues çağrılarını sırayla verilen baytlarla yanıtlar, kuyruk bitince gerçek üretece döner.
function queuedCrypto (queue) {
  return {
    getRandomValues (arr) {
      const next = queue.shift()
      if (next === undefined) return nodeCrypto.webcrypto.getRandomValues(arr)
      if (next.length !== arr.length) throw new Error('Beklenmeyen uzunluk: ' + arr.length)
      arr.set(next)
      return arr
    }
  }
}

// Node 22.8 ve sonrasında sıradan global nesneli bağlam kullanılır. Bağlamlaştırılmış nesnede her global
// arama araya giren bir kancadan geçer ve X25519 işlemleri yaklaşık 15 kat yavaşlar. Eski sürümlerde klasik yol.
const DONT_CONTEXTIFY = vm.constants ? vm.constants.DONT_CONTEXTIFY : undefined

function newSandbox () {
  return DONT_CONTEXTIFY ? vm.createContext(DONT_CONTEXTIFY) : vm.createContext({})
}

// Seçenekler: crypto, TextEncoder, TextDecoder, storage, nacl: false (yüklenmez),
// scrypt: false (yüklenmez) veya sahte nesne, timers: 'browser' (yalnızca setTimeout, tarayıcıdaki gibi).
function load (opts = {}) {
  const sandbox = newSandbox()
  sandbox.self = sandbox
  sandbox.window = sandbox
  // scrypt-js parçalar arasında setImmediate (yoksa setTimeout) ile olay döngüsüne döner.
  sandbox.setTimeout = setTimeout
  if (opts.timers !== 'browser') sandbox.setImmediate = setImmediate
  if (opts.crypto !== null) sandbox.crypto = opts.crypto || nodeCrypto.webcrypto
  if (opts.TextEncoder) sandbox.TextEncoder = opts.TextEncoder
  if (opts.TextDecoder) sandbox.TextDecoder = opts.TextDecoder
  if (opts.storage === 'throw') {
    Object.defineProperty(sandbox, 'localStorage', {
      get () {
        throw new Error('SecurityError')
      }
    })
  } else if (opts.storage !== null) {
    sandbox.localStorage = opts.storage || makeStorage()
  }
  if (opts.nacl !== false) vm.runInContext(NACL_SRC, sandbox, { filename: 'nacl-fast.min.js' })
  if (opts.scrypt && typeof opts.scrypt === 'object') {
    sandbox.scrypt = opts.scrypt
  } else if (opts.scrypt !== false) {
    vm.runInContext(SCRYPT_SRC, sandbox, { filename: 'scrypt.js' })
  }
  vm.runInContext(E2EE_SRC, sandbox, { filename: 'crypto.js' })
  return sandbox
}

function loadNative (counts) {
  class SpyEncoder extends TextEncoder {
    encode (s) {
      if (counts) counts.enc++
      return super.encode(s)
    }
  }
  class SpyDecoder extends TextDecoder {
    decode (b) {
      if (counts) counts.dec++
      return super.decode(b)
    }
  }
  return load({ TextEncoder: SpyEncoder, TextDecoder: SpyDecoder })
}

function sha512 (label, secret) {
  return nodeCrypto.createHash('sha512').update(Buffer.from(label, 'utf8')).update(Buffer.from(secret)).digest()
}

function refChecksum (secret) {
  const h = sha512(LABEL_CHECK, secret)
  const v = (h[0] << 2) | (h[1] >> 6)
  return ALPHABET[v >> 5] + ALPHABET[v & 31]
}

// BigInt ile bağımsız kodlama: 128 bit sola 2 kaydırılır, 26 adet 5 bitlik grup.
function refEncodeCode (secret) {
  const n = BigInt('0x' + Buffer.from(secret).toString('hex')) << 2n
  let data = ''
  for (const i of times(26)) data += ALPHABET[Number((n >> BigInt(5 * (25 - i))) & 31n)]
  return (data + refChecksum(secret)).match(/.{4}/g).join('-')
}

// Bağımsız çözme: { secret } veya reddetme nedeni { reason: 'bad_length'|'bad_char'|'bad_padding'|'bad_checksum' }.
// Girdi yalnızca büyük harf Crockford alfabesi ve tire içermelidir (eşlemeler ayrı testte).
function refDecodeDetail (code) {
  const chars = code.replace(/-/g, '')
  if (chars.length !== 28) return { reason: 'bad_length' }
  let n = 0n
  for (const c of chars) {
    if (ALPHABET.indexOf(c) < 0) return { reason: 'bad_char' }
  }
  for (const c of chars.slice(0, 26)) n = (n << 5n) | BigInt(ALPHABET.indexOf(c))
  if ((n & 3n) !== 0n) return { reason: 'bad_padding' }
  const secret = Buffer.from((n >> 2n).toString(16).padStart(32, '0'), 'hex')
  return refChecksum(secret) === chars.slice(26) ? { secret } : { reason: 'bad_checksum' }
}

// Bağımsız çözme: kabul ederse sırrı, etmezse null döner.
function refDecodeCode (code) {
  return refDecodeDetail(code).secret || null
}

function refKid (secret) {
  return sha512(LABEL_KID, secret).subarray(0, 8).toString('hex')
}

function refEncKey (secret) {
  return sha512(LABEL_ENC, secret).subarray(0, 32)
}

function splitEnvelope (env) {
  const parts = env.split('.')
  return {
    version: parts[0],
    kid: parts[1],
    nonce: Buffer.from(parts[2], 'base64url'),
    box: Buffer.from(parts[3], 'base64url'),
    nonceText: parts[2],
    boxText: parts[3]
  }
}

function buildEnvelope (kid, nonce, box) {
  return '1.' + kid + '.' + Buffer.from(nonce).toString('base64url') + '.' + Buffer.from(box).toString('base64url')
}

function withKey (vector, opts) {
  const ctx = load(opts)
  const kid = ctx.E2EE.keyring.add(vector.code)
  assert.equal(kid, vector.kid)
  return ctx
}

describe('E2EE: yükleme ve arayüz', () => {
  it('window.E2EE tam olarak belgelenen arayüzü sunar ve dondurulmuştur', () => {
    const ctx = load()
    assert.equal(ctx.window.E2EE, ctx.E2EE)
    assert.deepEqual(Object.keys(ctx.E2EE).sort(), [
      'available', 'b64url', 'decryptFile', 'dm', 'encryptFile', 'fingerprint', 'generateKeyCode', 'identity',
      'kdf', 'keyring', 'openJson', 'parseKeyCode', 'pins', 'safetyNumber', 'sanitizeFileName', 'sealJson',
      'sniffImage', 'utf8'
    ])
    assert.deepEqual(Object.keys(ctx.E2EE.keyring).sort(), ['add', 'has', 'list', 'remove'])
    assert.deepEqual(Object.keys(ctx.E2EE.b64url).sort(), ['decode', 'encode'])
    assert.deepEqual(Object.keys(ctx.E2EE.utf8).sort(), ['decode', 'encode'])
    assert.deepEqual(Object.keys(ctx.E2EE.kdf).sort(), ['derive', 'needsUpgrade', 'newParams'])
    assert.deepEqual(Object.keys(ctx.E2EE.identity).sort(), [
      'clear', 'generate', 'load', 'save', 'sealBinding', 'unwrap', 'verifyBinding', 'wrap'
    ])
    assert.deepEqual(Object.keys(ctx.E2EE.dm).sort(), ['open', 'seal'])
    assert.deepEqual(Object.keys(ctx.E2EE.pins).sort(), ['accept', 'get', 'knownKeys', 'observe', 'setVerified'])
    const E = ctx.E2EE
    for (const obj of [E, E.keyring, E.b64url, E.utf8, E.kdf, E.identity, E.dm, E.pins]) assert.ok(Object.isFrozen(obj))
  })

  it('available(): nacl ve rastgele sayı üreteci varsa true', () => {
    assert.equal(load().E2EE.available(), true)
  })

  it('rastgele sayı üreteci yoksa available() false, şifreleme reddedilir ama çözme çalışır', () => {
    const v = VECTORS[0]
    const env = withKey(v).E2EE.sealJson(v.kid, { v: 1, t: 'merhaba' })
    const ctx = load({ crypto: null })
    assert.equal(ctx.E2EE.available(), false)
    assert.throws(() => ctx.E2EE.generateKeyCode(), codeIs('no_random'))
    assert.equal(ctx.E2EE.keyring.add(v.code), v.kid)
    assert.throws(() => ctx.E2EE.sealJson(v.kid, { v: 1 }), codeIs('no_random'))
    assert.throws(() => ctx.E2EE.encryptFile(new Uint8Array(4)), codeIs('no_random'))
    const opened = ctx.E2EE.openJson(env)
    assert.equal(opened.ok, true)
    assert.equal(opened.value.t, 'merhaba')
  })

  it('takılı kalmış (hep aynı bayt veren) üreteçte available() false', () => {
    const ctx = load({ crypto: { getRandomValues: (a) => a.fill(0) } })
    assert.equal(ctx.E2EE.available(), false)
    assert.throws(() => ctx.E2EE.generateKeyCode(), codeIs('no_random'))
  })

  it('nacl yüklenemezse available() false, işlemler no_library kodu verir ve anahtarlık verisi silinmez', () => {
    const v = VECTORS[0]
    const raw = JSON.stringify({ keys: { [v.kid]: v.code }, added: { [v.kid]: 5 } })
    const storage = makeStorage({ [RING_KEY]: raw })
    const ctx = load({ storage, nacl: false })
    assert.equal(ctx.E2EE.available(), false)
    assert.deepEqual(plain(ctx.E2EE.keyring.list()), [])
    assert.equal(ctx.E2EE.keyring.has(v.kid), false)
    assert.throws(() => ctx.E2EE.keyring.add(v.code), codeIs('no_library'))
    assert.throws(() => ctx.E2EE.parseKeyCode(v.code), codeIs('no_library'))
    assert.throws(() => ctx.E2EE.generateKeyCode(), codeIs('no_library'))
    assert.throws(() => ctx.E2EE.sealJson(v.kid, { v: 1 }), codeIs('no_library'))
    assert.throws(() => ctx.E2EE.encryptFile(new Uint8Array(4)), codeIs('no_library'))
    // Kütüphane olmadan da biçim hataları kendi koduyla bildirilir.
    assert.throws(() => ctx.E2EE.keyring.add('U' + v.code.slice(1)), codeIs('bad_char'))
    assert.deepEqual(plain(ctx.E2EE.openJson('1.' + v.kid + '.' + 'A'.repeat(32) + '.' + 'A'.repeat(24))), { ok: false, reason: 'no_key' })
    assert.equal(ctx.E2EE.decryptFile(new Uint8Array(20), 'A'.repeat(43), 'A'.repeat(32)), null)
    ctx.E2EE.keyring.remove('ffffffffffffffff')
    assert.deepEqual(JSON.parse(storage.map.get(RING_KEY)), JSON.parse(raw))
    assert.equal(ctx.E2EE.sniffImage(new Uint8Array([0xff, 0xd8, 0xff])), 'image/jpeg')
  })

  it('kaynak yalnızca izin verilen nacl ilkellerini kullanır', () => {
    assert.doesNotMatch(E2EE_SRC, /Math\.random/)
    assert.doesNotMatch(E2EE_SRC, /setPRNG|lowlevel|scalarMult|\.sign\b|crypto\.subtle/)
    assert.doesNotMatch(E2EE_SRC, /console\./)
    // nacl.box yalnızca kimlik anahtarı ve özel mesajlar için: keyPair, before ve secretbox eşdeğeri after/open.after.
    assert.doesNotMatch(E2EE_SRC, /\.box\(|\.box\.open\(/)
    const uses = new Set(E2EE_SRC.match(/\.box\.[A-Za-z]+(\.[A-Za-z]+)?/g))
    assert.deepEqual([...uses].sort(), [
      '.box.after', '.box.before', '.box.keyPair', '.box.keyPair.fromSecretKey', '.box.open.after'
    ])
  })

  it('alan ayrımı etiketleri ve depolama anahtarı Telsiz adını taşır', () => {
    // Satır sonu varsayımı yok (Windows'ta dosya CRLF ile çekilebilir).
    const lines = E2EE_SRC.split(/\r?\n/)
    const extra = [LABEL_AUTH, LABEL_WRAP, LABEL_SAFETY, 'telsiz-dm-cache-v1', IDENTITY_PREFIX, PINS_PREFIX]
    for (const label of [LABEL_CHECK, LABEL_ENC, LABEL_KID, RING_KEY].concat(extra)) {
      assert.equal(lines.filter((line) => line.endsWith(" = '" + label + "'")).length, 1, label)
    }
    assert.doesNotMatch(E2EE_SRC, /sohbet/i)
  })

  it('kaynakta kullanıcıya görünen metin yok: dize ve şablon sabitlerinde Türkçeye özgü harf bulunmaz', { skip: acorn ? false : 'acorn kurulu değil' }, () => {
    const found = []
    let strings = 0
    const tokens = acorn.tokenizer(E2EE_SRC, { ecmaVersion: 2017, sourceType: 'script', locations: true })
    for (const t of tokens) {
      if (t.type !== acorn.tokTypes.string && t.type !== acorn.tokTypes.template) continue
      strings++
      if (TURKISH_LETTERS.test(String(t.value))) found.push(t.loc.start.line + ': ' + JSON.stringify(t.value))
    }
    assert.ok(strings > 20, 'dize sabitleri bulunmalı')
    assert.deepEqual(found, [])
  })

  it('genel arayüzden fırlatılan her hata bir kod ve İngilizce teknik mesaj taşır', () => {
    const v = VECTORS[0]
    const ctx = withKey(v)
    const E = ctx.E2EE
    const cases = [
      [() => E.parseKeyCode(''), 'empty'],
      [() => E.parseKeyCode(null), 'empty'],
      [() => E.parseKeyCode('ABCD'), 'bad_length'],
      [() => E.parseKeyCode('U'.repeat(28)), 'bad_char'],
      [() => E.keyring.add(v.code.slice(0, -1) + (v.code.endsWith('0') ? '1' : '0')), 'bad_checksum'],
      [() => E.sealJson('0000000000000000', { v: 1 }), 'no_key'],
      [() => E.sealJson(v.kid, 'metin'), 'bad_type'],
      [() => E.b64url.decode('A'), 'bad_base64'],
      [() => E.b64url.decode('AA=='), 'bad_base64'],
      [() => E.b64url.decode('AB'), 'bad_base64'],
      [() => E.b64url.decode(null), 'bad_type'],
      [() => E.b64url.encode('metin'), 'bad_type'],
      [() => E.utf8.encode(5), 'bad_type'],
      [() => E.utf8.decode('metin'), 'bad_type'],
      [() => E.encryptFile([1, 2]), 'bad_type']
    ]
    for (const [fn, code] of cases) assert.throws(fn, codeIs(code))
  })
})

describe('E2EE: anahtar kodu', () => {
  it('bağımsız BigInt gerçeklemesi Python vektörleriyle uyumlu (test referansının kendisi)', () => {
    for (const v of VECTORS) {
      assert.equal(refEncodeCode(Buffer.from(v.secret, 'hex')), v.code)
      assert.equal(refDecodeCode(v.code).toString('hex'), v.secret)
      assert.equal(refKid(Buffer.from(v.secret, 'hex')), v.kid)
      assert.equal(refEncKey(Buffer.from(v.secret, 'hex')).toString('hex'), v.enc)
    }
  })

  it('bilinen yanıt vektörleri: parseKeyCode sırrı, biçimli kodu ve kid değerini verir', () => {
    const ctx = load()
    for (const v of VECTORS) {
      const r = ctx.E2EE.parseKeyCode(v.code)
      assert.ok(isU8(r.secret))
      assert.equal(r.secret.length, 16)
      assert.equal(hexOf(r.secret), v.secret)
      assert.equal(r.code, v.code)
      assert.equal(r.kid, v.kid)
    }
  })

  it('bilinen yanıt vektörleri: generateKeyCode üreteçten gelen 16 baytı doğru kodlar', () => {
    for (const v of VECTORS) {
      const queue = [nodeCrypto.randomBytes(16), nodeCrypto.randomBytes(16), Buffer.from(v.secret, 'hex')]
      const ctx = load({ crypto: queuedCrypto(queue) })
      assert.equal(ctx.E2EE.generateKeyCode(), v.code)
      assert.equal(queue.length, 0)
    }
  })

  it('rastgele sırlarda kodlama ve çözme bağımsız gerçeklemeyle bit bit aynı', () => {
    const rand = seeded(0x5eed1234)
    const ctx = load()
    for (const i of times(300)) {
      const secret = i < 16 ? Buffer.alloc(16, 1 << (i % 8)) : seededBytes(rand, 16)
      const code = refEncodeCode(secret)
      const r = ctx.E2EE.parseKeyCode(code)
      assert.equal(hexOf(r.secret), secret.toString('hex'))
      assert.equal(r.code, code)
      assert.equal(r.kid, refKid(secret))
    }
    times(40).forEach(() => {
      const secret = seededBytes(rand, 16)
      const gen = load({ crypto: queuedCrypto([seededBytes(rand, 16), seededBytes(rand, 16), secret]) })
      assert.equal(gen.E2EE.generateKeyCode(), refEncodeCode(secret))
    })
  })

  it('üretilen kod biçimi: 28 karakter, 4lü 7 grup, Crockford alfabesi, dolgu bitleri sıfır', () => {
    const ctx = load()
    const seen = new Set()
    for (const i of times(200)) {
      const code = ctx.E2EE.generateKeyCode()
      assert.match(code, CODE_FORMAT_RE, 'deneme ' + i)
      const raw = code.replace(/-/g, '')
      assert.equal(raw.length, 28)
      assert.equal(ALPHABET.indexOf(raw[25]) & 3, 0)
      assert.ok(refDecodeCode(code))
      const r = ctx.E2EE.parseKeyCode(code)
      assert.equal(r.code, code)
      assert.match(r.kid, /^[0-9a-f]{16}$/)
      seen.add(code)
    }
    assert.equal(seen.size, 200)
  })

  it('çözme: büyük/küçük harf, boşluk ve tire yok sayılır, O -> 0, I/L -> 1', () => {
    const ctx = load()
    const v = VECTORS[0]
    const raw = v.code.replace(/-/g, '')
    const variants = [
      v.code.toLowerCase(),
      raw,
      raw.toLowerCase(),
      '  ' + raw.match(/.{1,3}/g).join(' ') + '\n',
      raw.split('').join('-'),
      v.code.replace(/0/g, 'O'),
      v.code.replace(/0/g, 'o'),
      v.code.replace(/1/g, 'I'),
      v.code.replace(/1/g, 'i'),
      v.code.replace(/1/g, 'L'),
      v.code.replace(/1/g, 'l'),
      v.code.replace(/1/g, cp(0x131)),
      v.code.replace(/1/g, cp(0x130)),
      v.code.replace(/-/g, cp(0x2013)),
      v.code.replace(/-/g, cp(0x2014)),
      v.code.replace(/-/g, cp(0x2212)),
      v.code.replace(/-/g, cp(0xa0)),
      v.code.replace(/-/g, '\t'),
      'https://ornek.trycloudflare.com/#davet=ABCDE-FGHJK&anahtar=' + v.code,
      'https://ornek.trycloudflare.com/#anahtar=' + v.code.toLowerCase() + '&davet=ABCDE-FGHJK'
    ]
    for (const s of variants) {
      const r = ctx.E2EE.parseKeyCode(s)
      assert.equal(r.kid, v.kid, JSON.stringify(s))
      assert.equal(r.code, v.code)
    }
  })

  it('U ve alfabe dışı karakterler reddedilir', () => {
    const ctx = load()
    const v = VECTORS[3]
    const bad = ['U', 'u', '*', '#', '.', '_', '=', cp(0xdf), 'Ş', cp(0x1f600), '\u0000', cp(0xff10)]
    for (const ch of bad) {
      const s = v.code.slice(0, 5) + ch + v.code.slice(6)
      assert.throws(() => ctx.E2EE.parseKeyCode(s), codeIs('bad_char', s), JSON.stringify(ch))
      assert.throws(() => ctx.E2EE.keyring.add(s), codeIs('bad_char', s), JSON.stringify(ch))
    }
    // U hiçbir değere eşlenmez: sıfır vektöründe 0 yerine U yazmak sağlamayı tutturamaz.
    const zero = VECTORS[1].code
    for (const u of ['U', 'u']) {
      assert.throws(() => ctx.E2EE.parseKeyCode(u + zero.slice(1)), codeIs('bad_char'))
    }
  })

  it('uzunluk ve tür hataları kodla reddedilir, hata metni girilen kodu içermez', () => {
    const ctx = load()
    const v = VECTORS[3]
    const raw = v.code.replace(/-/g, '')
    const cases = [
      ['', 'empty'], ['   ', 'empty'], ['----', 'empty'], [' - \t\n', 'empty'],
      ['https://ornek.trycloudflare.com/#davet=ABCDE-FGHJK&anahtar=', 'empty'],
      [null, 'empty'], [undefined, 'empty'], [42, 'empty'], [{}, 'empty'], [['a'], 'empty'],
      [raw.slice(0, 27), 'bad_length'], [raw + '0', 'bad_length'], [raw + raw, 'bad_length'], ['ABCD', 'bad_length'],
      ['0'.repeat(2049), 'bad_length'], ['x'.repeat(5000), 'bad_length'], ['x'.repeat(100), 'bad_length'], ['u'.repeat(100), 'bad_char'],
      [raw.slice(0, 27) + 'Z', 'bad_checksum']
    ]
    for (const [s, code] of cases) {
      assert.throws(() => ctx.E2EE.parseKeyCode(s), codeIs(code, typeof s === 'string' ? s : null), String(s).slice(0, 40))
      assert.throws(() => ctx.E2EE.keyring.add(s), KEY_ERROR)
    }
    // Uzunluk sınırı tam 2048 karakter: ayırıcılarla dolu ama geçerli kod kabul edilir.
    const padded = ' '.repeat(2048 - v.code.length) + v.code
    assert.equal(padded.length, 2048)
    assert.equal(ctx.E2EE.parseKeyCode(padded).kid, v.kid)
    assert.throws(() => ctx.E2EE.parseKeyCode(' ' + padded), codeIs('bad_length'))
    assert.throws(() => ctx.E2EE.parseKeyCode(' '.repeat(5000) + v.code), codeIs('bad_length'))
    try {
      ctx.E2EE.parseKeyCode(raw.slice(0, 27) + 'Z')
      assert.fail('hata bekleniyordu')
    } catch (e) {
      assert.equal(e.code, 'bad_checksum')
      assert.ok(!e.message.includes(raw.slice(0, 8)))
      assert.ok(!e.message.includes(raw.slice(20)))
      assert.deepEqual(Object.keys(e).sort(), ['code'])
    }
  })

  it('yazım hatası yakalama: her konumda her tek karakter değişikliği bağımsız referansla aynı sonucu verir', () => {
    const ctx = load()
    let total = 0
    let detected = 0
    for (const v of VECTORS) {
      const raw = v.code.replace(/-/g, '')
      for (const pos of times(28)) {
        for (const alt of ALPHABET) {
          if (alt === raw[pos]) continue
          const changed = raw.slice(0, pos) + alt + raw.slice(pos + 1)
          const detail = refDecodeDetail(changed)
          const expected = detail.secret || null
          let got = null
          try {
            got = ctx.E2EE.parseKeyCode(changed)
          } catch (e) {
            assert.equal(e.code, detail.reason, changed)
          }
          total++
          if (expected === null) {
            assert.equal(got, null, 'kabul edilmemeliydi: ' + changed)
            detected++
          } else {
            assert.ok(got, 'kabul edilmeliydi: ' + changed)
            assert.equal(hexOf(got.secret), expected.toString('hex'))
            assert.notEqual(got.kid, v.kid)
          }
          if (pos >= 26) assert.equal(got, null, 'sağlama karakteri değişikliği her zaman yakalanır')
        }
      }
    }
    assert.ok(detected / total > 0.99, 'yakalama oranı ' + detected + '/' + total)
  })

  it('yazım hatası yakalama: komşu karakterlerin yer değiştirmesi bağımsız referansla aynı sonucu verir', () => {
    const ctx = load()
    const rand = seeded(77)
    let total = 0
    let detected = 0
    for (const i of times(60)) {
      const secret = i < VECTORS.length ? Buffer.from(VECTORS[i].secret, 'hex') : seededBytes(rand, 16)
      const raw = refEncodeCode(secret).replace(/-/g, '')
      for (const pos of times(27)) {
        if (raw[pos] === raw[pos + 1]) continue
        const swapped = raw.slice(0, pos) + raw[pos + 1] + raw[pos] + raw.slice(pos + 2)
        const detail = refDecodeDetail(swapped)
        let ok = true
        try {
          ctx.E2EE.parseKeyCode(swapped)
        } catch (e) {
          ok = false
          assert.equal(e.code, detail.reason, swapped)
        }
        assert.equal(ok, Boolean(detail.secret), swapped)
        total++
        if (!ok) detected++
      }
    }
    assert.ok(detected / total > 0.99, 'yakalama oranı ' + detected + '/' + total)
  })

  it('son veri karakterinin dolgu bitleri sıfır değilse kod reddedilir (sır aynı kalsa bile)', () => {
    const ctx = load()
    const v = VECTORS[1]
    const raw = v.code.replace(/-/g, '')
    for (const alt of ['1', '2', '3']) {
      const changed = raw.slice(0, 25) + alt + raw.slice(26)
      assert.equal(refDecodeDetail(changed).reason, 'bad_padding')
      assert.throws(() => ctx.E2EE.parseKeyCode(changed), codeIs('bad_padding', changed))
      assert.throws(() => ctx.E2EE.keyring.add(changed), codeIs('bad_padding', changed))
    }
    // Dolgusu sıfır ama sağlaması tutmayan kod bad_checksum verir (iki kod ayırt edilir).
    const wrongCheck = raw.slice(0, 26) + (raw[26] === 'Z' ? 'Y' : 'Z') + raw[27]
    assert.equal(refDecodeDetail(wrongCheck).reason, 'bad_checksum')
    assert.throws(() => ctx.E2EE.parseKeyCode(wrongCheck), codeIs('bad_checksum', wrongCheck))
    assert.equal(ctx.E2EE.parseKeyCode(raw.slice(0, 25) + '0' + raw.slice(26)).kid, v.kid)
  })

  it('kid deterministik, bağlamdan bağımsız ve alan ayrımlı türetilir', () => {
    const a = load()
    const b = loadNative()
    for (const v of VECTORS) {
      const secret = Buffer.from(v.secret, 'hex')
      assert.equal(a.E2EE.parseKeyCode(v.code).kid, b.E2EE.parseKeyCode(v.code.toLowerCase()).kid)
      assert.equal(a.E2EE.parseKeyCode(v.code).kid, refKid(secret))
      assert.notEqual(v.kid, sha512(LABEL_ENC, secret).subarray(0, 8).toString('hex'))
      assert.notEqual(v.kid, sha512(LABEL_CHECK, secret).subarray(0, 8).toString('hex'))
      assert.notEqual(v.kid, nodeCrypto.createHash('sha512').update(secret).digest().subarray(0, 8).toString('hex'))
    }
    assert.equal(new Set(VECTORS.map((v) => v.kid)).size, VECTORS.length)
  })
})

describe('E2EE: anahtarlık', () => {
  it('add/has/list/remove ve localStorage biçimi', () => {
    const storage = makeStorage()
    const ctx = load({ storage })
    const v = VECTORS[0]
    const w = VECTORS[3]
    const before = Date.now()
    assert.equal(ctx.E2EE.keyring.add(v.code.toLowerCase().replace(/-/g, ' ')), v.kid)
    assert.equal(ctx.E2EE.keyring.add(w.code), w.kid)
    const after = Date.now()
    assert.equal(ctx.E2EE.keyring.has(v.kid), true)
    assert.equal(ctx.E2EE.keyring.has(w.kid), true)
    assert.equal(ctx.E2EE.keyring.has('0000000000000000'), false)
    assert.equal(ctx.E2EE.keyring.has(null), false)
    assert.deepEqual([...storage.map.keys()], [RING_KEY])
    const stored = JSON.parse(storage.map.get(RING_KEY))
    assert.deepEqual(Object.keys(stored).sort(), ['added', 'keys'])
    assert.deepEqual(stored.keys, { [v.kid]: v.code, [w.kid]: w.code })
    for (const kid of [v.kid, w.kid]) assert.ok(stored.added[kid] >= before && stored.added[kid] <= after)
    const list = plain(ctx.E2EE.keyring.list())
    assert.deepEqual(list.map((e) => e.kid).sort(), [v.kid, w.kid].sort())
    for (const e of list) {
      assert.deepEqual(Object.keys(e).sort(), ['added', 'code', 'kid'])
      assert.equal(e.code, e.kid === v.kid ? v.code : w.code)
      assert.equal(typeof e.added, 'number')
    }
    ctx.E2EE.keyring.remove(v.kid)
    assert.equal(ctx.E2EE.keyring.has(v.kid), false)
    assert.deepEqual(JSON.parse(storage.map.get(RING_KEY)).keys, { [w.kid]: w.code })
    assert.deepEqual(plain(ctx.E2EE.keyring.list()).map((e) => e.kid), [w.kid])
  })

  it('aynı anahtarı yeniden eklemek eklenme zamanını değiştirmez, hatalı kod anahtarlığı değiştirmez', () => {
    const storage = makeStorage()
    const ctx = load({ storage })
    const v = VECTORS[2]
    ctx.E2EE.keyring.add(v.code)
    const first = storage.map.get(RING_KEY)
    ctx.E2EE.keyring.add(v.code.toLowerCase())
    assert.equal(storage.map.get(RING_KEY), first)
    assert.throws(() => ctx.E2EE.keyring.add('ABCD'), codeIs('bad_length'))
    assert.throws(() => ctx.E2EE.keyring.add(''), codeIs('empty'))
    assert.throws(() => ctx.E2EE.keyring.add(v.code.slice(0, -1) + (v.code.endsWith('0') ? '1' : '0')), codeIs('bad_checksum'))
    assert.equal(storage.map.get(RING_KEY), first)
  })

  it('anahtarlık sayfa yenilemesinden sonra (aynı depolama) kalır ve diğer sekmenin değişikliğini görür', () => {
    const storage = makeStorage()
    const v = VECTORS[0]
    const w = VECTORS[1]
    const a = load({ storage })
    a.E2EE.keyring.add(v.code)
    const b = load({ storage })
    assert.equal(b.E2EE.keyring.has(v.kid), true)
    b.E2EE.keyring.add(w.code)
    assert.equal(a.E2EE.keyring.has(w.kid), true)
    b.E2EE.keyring.remove(v.kid)
    assert.equal(a.E2EE.keyring.has(v.kid), false)
  })

  it('kod ile kid uyuşmayan veya bozuk kayıtlar kullanılmaz', () => {
    const v = VECTORS[0]
    const w = VECTORS[3]
    const tampered = JSON.stringify({ keys: { [v.kid]: w.code, ffffffffffffffff: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ' }, added: {} })
    const env = withKey(v).E2EE.sealJson(v.kid, { v: 1, t: 'gizli' })
    const ctx = load({ storage: makeStorage({ [RING_KEY]: tampered }) })
    assert.equal(ctx.E2EE.keyring.has(v.kid), false)
    assert.equal(ctx.E2EE.keyring.has(w.kid), false)
    assert.equal(ctx.E2EE.keyring.has('ffffffffffffffff'), false)
    assert.deepEqual(plain(ctx.E2EE.keyring.list()), [])
    assert.deepEqual(plain(ctx.E2EE.openJson(env)), { ok: false, reason: 'no_key' })
    assert.throws(() => ctx.E2EE.sealJson(v.kid, { v: 1 }))
  })

  it('bozuk depolama içeriği çökertmez ve prototip kirletmez', () => {
    const raws = [
      'bozuk json', 'null', '42', '[]', '"metin"', '{"keys":null}', '{"keys":[1,2]}',
      '{"keys":{"__proto__":{"kirli":1},"constructor":"x"},"added":{"__proto__":{"kirli":2}}}'
    ]
    for (const raw of raws) {
      const ctx = load({ storage: makeStorage({ [RING_KEY]: raw }) })
      assert.deepEqual(plain(ctx.E2EE.keyring.list()), [], raw)
      assert.equal(vm.runInContext('({}).kirli', ctx), undefined)
      assert.equal(ctx.E2EE.keyring.add(VECTORS[0].code), VECTORS[0].kid)
      assert.equal(ctx.E2EE.keyring.has(VECTORS[0].kid), true)
    }
  })

  it('localStorage yoksa veya erişim hata verirse anahtarlık bellekte çalışır', () => {
    const v = VECTORS[0]
    for (const storage of [null, 'throw']) {
      const ctx = load({ storage })
      assert.equal(ctx.E2EE.keyring.add(v.code), v.kid)
      assert.equal(ctx.E2EE.keyring.has(v.kid), true)
      assert.equal(plain(ctx.E2EE.keyring.list()).length, 1)
      const opened = ctx.E2EE.openJson(ctx.E2EE.sealJson(v.kid, { v: 1, t: 'bellek' }))
      assert.equal(opened.value.t, 'bellek')
      ctx.E2EE.keyring.remove(v.kid)
      assert.equal(ctx.E2EE.keyring.has(v.kid), false)
    }
  })

  it('setItem hata verirse (kota, gizli mod) eski ve yeni anahtarlar bellekte korunur', () => {
    const v = VECTORS[0]
    const w = VECTORS[3]
    const storage = makeStorage({ [RING_KEY]: JSON.stringify({ keys: { [v.kid]: v.code }, added: { [v.kid]: 7 } }) })
    storage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    const ctx = load({ storage })
    assert.equal(ctx.E2EE.keyring.add(w.code), w.kid)
    assert.equal(ctx.E2EE.keyring.has(v.kid), true)
    assert.equal(ctx.E2EE.keyring.has(w.kid), true)
    assert.equal(plain(ctx.E2EE.keyring.list()).length, 2)
    assert.equal(ctx.E2EE.openJson(ctx.E2EE.sealJson(w.kid, { v: 1 })).ok, true)
    // Depolama dışarıdan değişse bile yazılamamış anahtar kaybolmaz.
    storage.map.set(RING_KEY, JSON.stringify({ keys: {}, added: {} }))
    assert.equal(ctx.E2EE.keyring.has(w.kid), true)
    assert.equal(ctx.E2EE.keyring.has(v.kid), true)
  })
})

describe('E2EE: zarf', () => {
  it('sealJson sunucu desenine uyan zarf üretir ve openJson geri açar', () => {
    const v = VECTORS[3]
    const ctx = withKey(v)
    const obj = { v: 1, a: 7, c: 3, t: TURKCE + ' ' + EMOJI, f: [{ u: 'a'.repeat(32), kind: 'file', name: 'rapor.pdf', s: 10 }] }
    const env = ctx.E2EE.sealJson(v.kid, obj)
    assert.equal(typeof env, 'string')
    assert.match(env, SERVER_ENVELOPE_RE)
    const parts = splitEnvelope(env)
    assert.equal(parts.version, '1')
    assert.equal(parts.kid, v.kid)
    assert.equal(parts.nonceText.length, 32)
    assert.equal(parts.nonce.length, 24)
    assert.ok(!env.includes('='))
    assert.equal(parts.box.length, Buffer.byteLength(JSON.stringify(obj), 'utf8') + 16)
    const opened = ctx.E2EE.openJson(env)
    assert.equal(opened.ok, true)
    assert.equal(opened.kid, v.kid)
    assert.deepEqual(plain(opened.value), obj)
    assert.deepEqual(Object.keys(opened).sort(), ['kid', 'ok', 'value'])
  })

  it('bağımsız doğrulama: zarf SHA-512(enc etiketi || sır) ilk 32 baytıyla XSalsa20-Poly1305 olarak açılır', () => {
    for (const v of VECTORS) {
      const ctx = withKey(v)
      const obj = { v: 1, t: 'bağımsız ' + v.kid }
      const parts = splitEnvelope(ctx.E2EE.sealJson(v.kid, obj))
      const secret = Buffer.from(v.secret, 'hex')
      const opened = refNacl.secretbox.open(new Uint8Array(parts.box), new Uint8Array(parts.nonce), new Uint8Array(refEncKey(secret)))
      assert.ok(opened)
      assert.deepEqual(JSON.parse(Buffer.from(opened).toString('utf8')), obj)
      // Diğer etiketlerle veya etiketsiz türetilen anahtarlar açamaz (alan ayrımı).
      for (const wrong of [
        sha512(LABEL_KID, secret).subarray(0, 32),
        sha512(LABEL_CHECK, secret).subarray(0, 32),
        nodeCrypto.createHash('sha512').update(secret).digest().subarray(0, 32),
        sha512(LABEL_ENC, secret).subarray(32, 64)
      ]) {
        assert.equal(refNacl.secretbox.open(new Uint8Array(parts.box), new Uint8Array(parts.nonce), new Uint8Array(wrong)), null)
      }
    }
  })

  it('bağımsız olarak oluşturulan zarf openJson ile açılır (birlikte çalışabilirlik)', () => {
    const v = VECTORS[0]
    const ctx = withKey(v)
    const obj = { v: 1, from: 'abc', to: 'def', d: { type: 'offer', sdp: 'v=0\r\n' } }
    const nonce = nodeCrypto.randomBytes(24)
    const box = refNacl.secretbox(new Uint8Array(Buffer.from(JSON.stringify(obj), 'utf8')), new Uint8Array(nonce), new Uint8Array(refEncKey(Buffer.from(v.secret, 'hex'))))
    const opened = ctx.E2EE.openJson(buildEnvelope(v.kid, nonce, box))
    assert.equal(opened.ok, true)
    assert.deepEqual(plain(opened.value), obj)
  })

  it('nonce her şifrelemede rastgele üreteçten gelir ve tekrar etmez', () => {
    const v = VECTORS[0]
    const ctx = withKey(v)
    const nonces = new Set()
    const boxes = new Set()
    times(300).forEach(() => {
      const parts = splitEnvelope(ctx.E2EE.sealJson(v.kid, { v: 1, t: 'aynı metin' }))
      nonces.add(parts.nonceText)
      boxes.add(parts.boxText)
    })
    assert.equal(nonces.size, 300)
    assert.equal(boxes.size, 300)
    const fixed = nodeCrypto.randomBytes(24)
    const queue = [fixed]
    const stub = withKey(v, { crypto: queuedCrypto(queue) })
    const parts = splitEnvelope(stub.E2EE.sealJson(v.kid, { v: 1 }))
    assert.equal(queue.length, 0)
    assert.equal(parts.nonce.toString('hex'), fixed.toString('hex'))
  })

  it('nonce veya şifreli metinde tek bit değişikliğinde zarf açılmaz', () => {
    const v = VECTORS[3]
    const ctx = withKey(v)
    const env = ctx.E2EE.sealJson(v.kid, { v: 1, a: 1, c: 1, t: 'bit' })
    const parts = splitEnvelope(env)
    let checked = 0
    for (const which of ['nonce', 'box']) {
      const src = parts[which]
      for (const bit of times(src.length * 8)) {
        const copy = Buffer.from(src)
        copy[bit >> 3] ^= 1 << (bit & 7)
        const tampered = which === 'nonce' ? buildEnvelope(v.kid, copy, parts.box) : buildEnvelope(v.kid, parts.nonce, copy)
        assert.deepEqual(plain(ctx.E2EE.openJson(tampered)), { ok: false, reason: 'bad_data' })
        checked++
      }
    }
    assert.ok(checked > 400)
    assert.equal(ctx.E2EE.openJson(env).ok, true)
  })

  it('zarf metninde herhangi bir karakter değişikliği asla geçerli açılmaz', () => {
    const v = VECTORS[1]
    const ctx = withKey(v)
    const env = ctx.E2EE.sealJson(v.kid, { v: 1, t: 'karakter' })
    const start = 2 + 16 + 1
    for (const pos of times(env.length - start)) {
      const i = start + pos
      if (env[i] === '.') continue
      for (const alt of B64_CHARS) {
        if (alt === env[i]) continue
        const r = ctx.E2EE.openJson(env.slice(0, i) + alt + env.slice(i + 1))
        assert.equal(r.ok, false)
        assert.ok(r.reason === 'bad_data' || r.reason === 'bad_format', r.reason)
      }
    }
  })

  it('yanlış anahtar: başka bir anahtarın kid değeriyle gelen zarf bad_data verir', () => {
    const v = VECTORS[0]
    const w = VECTORS[3]
    const ctx = withKey(v)
    ctx.E2EE.keyring.add(w.code)
    const env = ctx.E2EE.sealJson(v.kid, { v: 1, t: 'x' })
    const swapped = '1.' + w.kid + env.slice(2 + 16)
    assert.deepEqual(plain(ctx.E2EE.openJson(swapped)), { ok: false, reason: 'bad_data' })
    const other = withKey(w)
    const env2 = other.E2EE.sealJson(w.kid, { v: 1, t: 'y' })
    assert.equal(ctx.E2EE.openJson(env2).value.t, 'y')
  })

  it('bilinmeyen kid: no_key', () => {
    const v = VECTORS[0]
    const env = withKey(v).E2EE.sealJson(v.kid, { v: 1, t: 'x' })
    const ctx = load()
    assert.deepEqual(plain(ctx.E2EE.openJson(env)), { ok: false, reason: 'no_key' })
    ctx.E2EE.keyring.add(VECTORS[2].code)
    assert.deepEqual(plain(ctx.E2EE.openJson(env)), { ok: false, reason: 'no_key' })
    ctx.E2EE.keyring.add(v.code)
    assert.equal(ctx.E2EE.openJson(env).ok, true)
    ctx.E2EE.keyring.remove(v.kid)
    assert.deepEqual(plain(ctx.E2EE.openJson(env)), { ok: false, reason: 'no_key' })
  })

  it('biçimsiz zarflar bad_format verir ve hiçbir girdi istisna fırlatmaz', () => {
    const v = VECTORS[0]
    const ctx = withKey(v)
    const env = ctx.E2EE.sealJson(v.kid, { v: 1, t: 'biçim' })
    const p = env.split('.')
    const bad = [
      null, undefined, 42, {}, [], '', '1', '1.' + v.kid, env + '.', env + '=', env + '\n', ' ' + env,
      '2' + env.slice(1), '1.' + v.kid.toUpperCase() + '.' + p[2] + '.' + p[3],
      '1.' + v.kid.slice(1) + '.' + p[2] + '.' + p[3],
      '1.' + v.kid + '.' + p[2].slice(1) + '.' + p[3],
      '1.' + v.kid + '.' + p[2] + 'A.' + p[3],
      '1.' + v.kid + '.' + p[2] + '.' + p[3].slice(0, 23),
      '1.' + v.kid + '.' + p[2] + '.+' + p[3].slice(1),
      '1.' + v.kid + '.' + p[2].slice(0, -1) + '/.' + p[3],
      '1.' + v.kid + '.' + p[2] + '.' + p[3] + '==',
      '1.' + v.kid + '.' + p[2] + '.' + p[3].slice(0, -1) + '/',
      '1.' + v.kid + '.' + p[2] + '.' + 'A'.repeat(25)
    ]
    for (const b of bad) {
      const r = ctx.E2EE.openJson(b)
      assert.equal(r.ok, false, String(b))
      assert.equal(r.reason, 'bad_format', String(b))
    }
    // 'A' x 26: geçerli biçim ama doğrulanamayan veri.
    assert.deepEqual(plain(ctx.E2EE.openJson('1.' + v.kid + '.' + p[2] + '.' + 'A'.repeat(26))), { ok: false, reason: 'bad_data' })
  })

  it('base64url sonunda sıfır olmayan artık bitler (aynı baytlara çözülse bile) reddedilir', () => {
    const v = VECTORS[0]
    const ctx = withKey(v)
    let env = ''
    let len = 0
    for (const i of times(20)) {
      env = ctx.E2EE.sealJson(v.kid, { v: 1, t: 'x'.repeat(i) })
      len = env.split('.')[3].length
      if (len % 4 !== 0) break
    }
    assert.notEqual(len % 4, 0)
    const last = env[env.length - 1]
    const idx = B64_CHARS.indexOf(last)
    const alt = B64_CHARS[idx ^ 1]
    const sameBytes = Buffer.from(env.slice(0, -1) + alt, 'base64url').equals(Buffer.from(env, 'base64url'))
    assert.ok(sameBytes, 'Node gevşek çözüyor, aynı baytlar beklenir')
    assert.deepEqual(plain(ctx.E2EE.openJson(env.slice(0, -1) + alt)), { ok: false, reason: 'bad_format' })
  })

  it('sealJson hataları: bilinmeyen kid, geçersiz kid, nesne olmayan değer', () => {
    const v = VECTORS[0]
    const ctx = withKey(v)
    assert.throws(() => ctx.E2EE.sealJson('0000000000000000', { v: 1 }), codeIs('no_key'))
    assert.throws(() => ctx.E2EE.sealJson(null, { v: 1 }), codeIs('no_key'))
    assert.throws(() => ctx.E2EE.sealJson(v.kid.toUpperCase(), { v: 1 }), codeIs('no_key'))
    for (const value of [null, undefined, 5, 'metin', true]) {
      assert.throws(() => ctx.E2EE.sealJson(v.kid, value), { name: 'TypeError', code: 'bad_type' })
    }
    assert.match(ctx.E2EE.sealJson(v.kid, {}), SERVER_ENVELOPE_RE)
    assert.match(ctx.E2EE.sealJson(v.kid, []), SERVER_ENVELOPE_RE)
  })

  it('JSON olmayan veya UTF-8 olmayan doğrulanmış içerik bad_data verir', () => {
    const v = VECTORS[0]
    const ctx = withKey(v)
    const key = new Uint8Array(refEncKey(Buffer.from(v.secret, 'hex')))
    for (const content of [Buffer.from('bu json değil'), Buffer.from([0xff, 0xfe, 0xfd, 0x7b])]) {
      const nonce = nodeCrypto.randomBytes(24)
      const box = refNacl.secretbox(new Uint8Array(content), new Uint8Array(nonce), key)
      assert.deepEqual(plain(ctx.E2EE.openJson(buildEnvelope(v.kid, nonce, box))), { ok: false, reason: 'bad_data' })
    }
  })

  it('en kötü olağan mesaj (2000 emoji, 10 ek, 120 karakterlik adlar) sunucunun 24000 karakter sınırına sığar', () => {
    const v = VECTORS[0]
    const ctx = withKey(v)
    const name = cp(0x1f600).repeat(116) + '.jpeg'
    const f = times(10).map(() => ({
      u: 'f'.repeat(32), k: 'k'.repeat(43), n: 'n'.repeat(32), kind: 'image',
      name: ctx.E2EE.sanitizeFileName(name), m: 'x'.repeat(100), s: 26214400, w: 2560, h: 2560
    }))
    const env = ctx.E2EE.sealJson(v.kid, { v: 1, a: 999999, c: 999999, t: cp(0x1f600).repeat(2000), f })
    assert.match(env, SERVER_ENVELOPE_RE)
    assert.ok(env.length <= 24000, 'uzunluk ' + env.length)
  })

  it('davet akışı: bir bağlamda üretilen kodu ekleyen diğer bağlam mesajları okur', () => {
    const owner = load()
    const code = owner.E2EE.generateKeyCode()
    const kid = owner.E2EE.keyring.add(code)
    const friend = loadNative()
    assert.equal(friend.E2EE.keyring.add(code.toLowerCase()), kid)
    const env = owner.E2EE.sealJson(kid, { v: 1, t: TURKCE })
    assert.equal(friend.E2EE.openJson(env).value.t, TURKCE)
    const back = friend.E2EE.sealJson(kid, { v: 1, t: EMOJI })
    assert.equal(owner.E2EE.openJson(back).value.t, EMOJI)
  })
})

describe('E2EE: dosyalar', () => {
  it('encryptFile/decryptFile gidiş-dönüş, boyutlar ve bağımsız doğrulama', () => {
    const ctx = load()
    const rand = seeded(99)
    for (const size of [0, 1, 15, 16, 17, 31, 32, 33, 1000, 65536, 65537, 1048576 + 3]) {
      const data = seededBytes(rand, size)
      const r = ctx.E2EE.encryptFile(data)
      assert.deepEqual(Object.keys(r).sort(), ['box', 'key', 'nonce'])
      assert.ok(isU8(r.box))
      assert.ok(isTight(r.box), 'box kendi arabelleğinin tamamı olmalı')
      assert.equal(r.box.length, size + 16)
      assert.equal(r.key.length, 43)
      assert.equal(r.nonce.length, 32)
      assert.equal(Buffer.from(r.key, 'base64url').length, 32)
      assert.equal(Buffer.from(r.nonce, 'base64url').length, 24)
      const out = ctx.E2EE.decryptFile(r.box, r.key, r.nonce)
      assert.ok(isU8(out))
      assert.ok(isTight(out))
      assert.equal(hexOf(out), data.toString('hex'))
      const ref = refNacl.secretbox.open(new Uint8Array(r.box), new Uint8Array(Buffer.from(r.nonce, 'base64url')), new Uint8Array(Buffer.from(r.key, 'base64url')))
      assert.equal(Buffer.from(ref).toString('hex'), data.toString('hex'))
    }
  })

  it('her dosya kendi rastgele anahtarı ve nonce değeriyle şifrelenir', () => {
    const ctx = load()
    const keys = new Set()
    const nonces = new Set()
    times(100).forEach(() => {
      const r = ctx.E2EE.encryptFile(new Uint8Array(8))
      keys.add(r.key)
      nonces.add(r.nonce)
    })
    assert.equal(keys.size, 100)
    assert.equal(nonces.size, 100)
    const key = nodeCrypto.randomBytes(32)
    const nonce = nodeCrypto.randomBytes(24)
    const queue = [key, nonce]
    const stub = load({ crypto: queuedCrypto(queue) })
    const r = stub.E2EE.encryptFile(new Uint8Array([1, 2, 3]))
    assert.equal(queue.length, 0)
    assert.equal(r.key, key.toString('base64url'))
    assert.equal(r.nonce, nonce.toString('base64url'))
  })

  it('farklı bayt girdileri kabul edilir: ArrayBuffer, Buffer, DataView, kaydırılmış görünüm', () => {
    const ctx = load()
    const base = Buffer.from('0123456789abcdef', 'utf8')
    const ab = new ArrayBuffer(6)
    new Uint8Array(ab).set([1, 2, 3, 4, 5, 6])
    const view = new Uint8Array(base.buffer, base.byteOffset + 4, 5)
    const cases = [
      { input: ab, expected: '010203040506' },
      { input: base, expected: base.toString('hex') },
      { input: new DataView(ab, 1, 3), expected: '020304' },
      { input: view, expected: Buffer.from(view).toString('hex') },
      { input: vm.runInContext('new Uint8Array([9, 8, 7])', ctx), expected: '090807' }
    ]
    for (const { input, expected } of cases) {
      const r = ctx.E2EE.encryptFile(input)
      assert.equal(hexOf(ctx.E2EE.decryptFile(r.box, r.key, r.nonce)), expected)
      assert.equal(hexOf(ctx.E2EE.decryptFile(r.box.buffer, r.key, r.nonce)), expected)
    }
    assert.throws(() => ctx.E2EE.encryptFile('metin'), { name: 'TypeError', code: 'bad_type' })
    assert.throws(() => ctx.E2EE.encryptFile(null), { name: 'TypeError', code: 'bad_type' })
    assert.throws(() => ctx.E2EE.encryptFile([1, 2, 3]), { name: 'TypeError', code: 'bad_type' })
  })

  it('decryptFile hatalı girdide null döner, istisna fırlatmaz', () => {
    const ctx = load()
    const r = ctx.E2EE.encryptFile(Buffer.from('gizli dosya içeriği'))
    const other = ctx.E2EE.encryptFile(Buffer.from('başka'))
    const flipped = Buffer.from(r.box)
    flipped[flipped.length - 1] ^= 0x80
    const flippedMac = Buffer.from(r.box)
    flippedMac[0] ^= 1
    const c = (box, key, nonce) => ({ box, key, nonce })
    const cases = [
      c(r.box, other.key, r.nonce),
      c(r.box, r.key, other.nonce),
      c(flipped, r.key, r.nonce),
      c(flippedMac, r.key, r.nonce),
      c(r.box.subarray(0, 15), r.key, r.nonce),
      c(new Uint8Array(0), r.key, r.nonce),
      c(r.box, r.key.slice(0, -1), r.nonce),
      c(r.box, r.key + 'A', r.nonce),
      c(r.box, r.key + '=', r.nonce),
      c(r.box, r.key, r.nonce.slice(0, 31)),
      c(r.box, '+' + r.key.slice(1), r.nonce),
      c(r.box, r.key, r.nonce.slice(0, -1) + '/'),
      c(r.box, null, r.nonce),
      c(r.box, r.key, undefined),
      c('metin', r.key, r.nonce),
      c(null, r.key, r.nonce)
    ]
    for (const { box, key, nonce } of cases) {
      assert.equal(ctx.E2EE.decryptFile(box, key, nonce), null)
    }
    assert.equal(Buffer.from(ctx.E2EE.decryptFile(r.box, r.key, r.nonce)).toString('utf8'), 'gizli dosya içeriği')
  })
})

describe('E2EE: sniffImage', () => {
  it('dört resim türünü sihirli baytlarından tanır', () => {
    const ctx = load()
    const s = ctx.E2EE.sniffImage
    assert.equal(s(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')), 'image/png')
    assert.equal(s(Buffer.from('89504e470d0a1a0a', 'hex')), 'image/png')
    assert.equal(s(Buffer.from('ffd8ffe000104a464946', 'hex')), 'image/jpeg')
    assert.equal(s(Buffer.from('ffd8ff', 'hex')), 'image/jpeg')
    assert.equal(s(Buffer.from('GIF87a\x01\x00', 'latin1')), 'image/gif')
    assert.equal(s(Buffer.from('GIF89a', 'latin1')), 'image/gif')
    assert.equal(s(Buffer.from('RIFF\x24\x00\x00\x00WEBPVP8 ', 'latin1')), 'image/webp')
    assert.equal(s(Buffer.from('RIFFxxxxWEBP', 'latin1')), 'image/webp')
    assert.equal(s(new Uint8Array(Buffer.from('89504e470d0a1a0a', 'hex')).buffer), 'image/png')
    assert.equal(s(vm.runInContext('new Uint8Array([0xff, 0xd8, 0xff, 0xdb]).buffer', ctx)), 'image/jpeg')
    assert.equal(s(new DataView(new Uint8Array(Buffer.from('00474946383961', 'hex')).buffer, 1)), 'image/gif')
  })

  it('eksik, benzer veya başka türler null', () => {
    const ctx = load()
    const s = ctx.E2EE.sniffImage
    const nulls = [
      Buffer.from('89504e470d0a1a', 'hex'),
      Buffer.from('89504e470d0a1a0b', 'hex'),
      Buffer.from('ffd8', 'hex'),
      Buffer.from('ffd9ff', 'hex'),
      Buffer.from('GIF88a', 'latin1'),
      Buffer.from('GIF89', 'latin1'),
      Buffer.from('gif89a', 'latin1'),
      Buffer.from('RIFFxxxxWEB', 'latin1'),
      Buffer.from('RIFFxxxxWAVEfmt ', 'latin1'),
      Buffer.from('xxxxxxxxWEBP', 'latin1'),
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>', 'utf8'),
      Buffer.from('<?xml version="1.0"?><svg/>', 'utf8'),
      Buffer.from('%PDF-1.7', 'latin1'),
      Buffer.from('BM', 'latin1'),
      Buffer.alloc(0),
      new Uint8Array(100)
    ]
    for (const b of nulls) assert.equal(s(b), null, b.toString('hex'))
    for (const x of [null, undefined, 'GIF89a', 42, {}, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]]) assert.equal(s(x), null)
  })
})

describe('E2EE: base64url', () => {
  it('sınır durumları: boş, 1-3 bayt, tüm bayt değerleri, dolgusuz ve URL güvenli', () => {
    const ctx = load()
    const b = ctx.E2EE.b64url
    assert.equal(b.encode(new Uint8Array(0)), '')
    assert.equal(b.decode('').length, 0)
    assert.equal(b.encode(new Uint8Array([0])), 'AA')
    assert.equal(b.encode(new Uint8Array([0, 0])), 'AAA')
    assert.equal(b.encode(new Uint8Array([0, 0, 0])), 'AAAA')
    assert.equal(b.encode(new Uint8Array([0xff])), '_w')
    assert.equal(b.encode(new Uint8Array([0xff, 0xff])), '__8')
    assert.equal(b.encode(new Uint8Array([0xfb, 0xff])), '-_8')
    assert.equal(hexOf(b.decode('_w')), 'ff')
    assert.equal(hexOf(b.decode('__8')), 'ffff')
    assert.equal(hexOf(b.decode('-_8')), 'fbff')
    const all = Buffer.from(times(256))
    const enc = b.encode(all)
    assert.equal(enc, all.toString('base64url'))
    assert.doesNotMatch(enc, /[=+/]/)
    assert.equal(hexOf(b.decode(enc)), all.toString('hex'))
    assert.ok(isU8(b.decode(enc)))
    assert.equal(b.encode(all.buffer.slice(all.byteOffset, all.byteOffset + 256)), enc)
  })

  it('rastgele uzunluklarda Node base64url ile birebir aynı', () => {
    const ctx = load()
    const rand = seeded(4242)
    for (const n of times(130)) {
      const data = seededBytes(rand, n)
      const enc = ctx.E2EE.b64url.encode(data)
      assert.equal(enc, data.toString('base64url'))
      assert.equal(hexOf(ctx.E2EE.b64url.decode(enc)), data.toString('hex'))
    }
    const big = seededBytes(rand, 200003)
    const enc = ctx.E2EE.b64url.encode(big)
    assert.equal(enc, big.toString('base64url'))
    assert.equal(hexOf(ctx.E2EE.b64url.decode(enc)), big.toString('hex'))
  })

  it('çözme katıdır: dolgu, standart base64 karakterleri, boşluk, yanlış uzunluk ve artık bitler reddedilir', () => {
    const ctx = load()
    const d = ctx.E2EE.b64url.decode
    for (const s of ['A', 'AAAAA', 'AA==', 'AAA=', 'AA=A', 'a+b/', '++++', '////', 'AB C', ' AAA', 'AAA\n', 'ş', 'AAA' + cp(0x1f600), 'AB', 'AAB', '_x', '__9']) {
      assert.throws(() => d(s), codeIs('bad_base64'), JSON.stringify(s))
    }
    for (const x of [null, undefined, 5, {}, new Uint8Array(2)]) assert.throws(() => d(x), { name: 'TypeError', code: 'bad_type' })
    assert.throws(() => ctx.E2EE.b64url.encode('metin'), { name: 'TypeError', code: 'bad_type' })
  })
})

describe('E2EE: UTF-8', () => {
  const WELL_FORMED = [
    '', 'a', 'Merhaba', TURKCE, EMOJI, TURKCE + EMOJI + '\n\t\r\u0000',
    cp(0x7f), cp(0x80), cp(0x7ff), cp(0x800), cp(0xd7ff), cp(0xe000), cp(0xffff), cp(0x10000), cp(0x10ffff),
    cp(0xfeff) + 'BOM korunur', cp(0xfeff), 'şğüöçıİ'.repeat(300)
  ]
  const LONE = [
    String.fromCharCode(0xd800), String.fromCharCode(0xdc00), 'a' + String.fromCharCode(0xd83d),
    String.fromCharCode(0xdc00, 0xd800), String.fromCharCode(0xd800, 0xd800, 0xdc00), 'x' + String.fromCharCode(0xdfff) + 'y'
  ]

  it('Türkçe ve emoji gidiş-dönüş: TextEncoder olan ve olmayan (yedek) ortamda aynı baytlar', () => {
    const counts = { enc: 0, dec: 0 }
    const native = loadNative(counts)
    // Yükleme sırasındaki doğruluk yoklaması sayılmaz, yalnızca gerçek kullanım ölçülür.
    counts.enc = 0
    counts.dec = 0
    const fallback = load()
    assert.equal(vm.runInContext('typeof TextEncoder', fallback), 'undefined')
    assert.equal(vm.runInContext('typeof TextDecoder', fallback), 'undefined')
    for (const s of WELL_FORMED) {
      const expected = Buffer.from(s, 'utf8').toString('hex')
      for (const ctx of [native, fallback]) {
        const bytes = ctx.E2EE.utf8.encode(s)
        assert.ok(isU8(bytes))
        assert.equal(hexOf(bytes), expected, JSON.stringify(s).slice(0, 40))
        assert.equal(ctx.E2EE.utf8.decode(bytes), s)
        assert.equal(ctx.E2EE.utf8.decode(Buffer.from(s, 'utf8')), s)
      }
    }
    assert.ok(counts.enc > 0, 'yerel TextEncoder kullanılmalı')
    assert.ok(counts.dec > 0, 'yerel TextDecoder kullanılmalı')
    assert.equal(hexOf(fallback.E2EE.utf8.encode('ş')), 'c59f')
    assert.equal(hexOf(fallback.E2EE.utf8.encode(cp(0x1f1f9, 0x1f1f7))), 'f09f87b9f09f87b7')
    assert.equal(fallback.E2EE.utf8.decode(new Uint8Array([0xc4, 0xb0, 0xc4, 0xb1])), 'İı')
  })

  it('yedek kodlayıcı tek başına kalmış vekil karakterleri TextEncoder gibi U+FFFD yapar', () => {
    const fallback = load()
    const te = new TextEncoder()
    for (const s of LONE) assert.equal(hexOf(fallback.E2EE.utf8.encode(s)), Buffer.from(te.encode(s)).toString('hex'))
    const rand = seeded(2024)
    const pool = [0x41, 0xe7, 0x15f, 0x7ff, 0x800, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xfeff, 0xffff]
    for (const i of times(1500)) {
      const units = times(rand() % 12).map(() => (rand() & 1) ? pool[rand() % pool.length] : rand() & 0xffff)
      const s = String.fromCharCode(...units)
      assert.equal(hexOf(fallback.E2EE.utf8.encode(s)), Buffer.from(te.encode(s)).toString('hex'), 'deneme ' + i)
    }
  })

  it('yedek çözücü hatalı dizilerde WHATWG TextDecoder ile birebir aynı sonucu verir', () => {
    const fallback = load()
    const native = loadNative()
    const td = new TextDecoder('utf-8', { ignoreBOM: true })
    const edge = [
      'c080', 'c1bf', 'e08080', 'e09fbf', 'e0a080', 'eda080', 'ed9fbf', 'f0808080', 'f08fbfbf', 'f0908080',
      'f48fbfbf', 'f4908080', 'f5808080', 'ff', 'feff', '80', 'bf41', 'e282', 'e28241', 'f09f98', 'f09f4180',
      'efbbbf', 'efbbbf41', 'c5', '41c5', 'c5c59f', 'eda080edb080', 'f4', 'e0a0'
    ]
    for (const hex of edge) {
      const bytes = new Uint8Array(Buffer.from(hex, 'hex'))
      const expected = td.decode(bytes)
      assert.equal(fallback.E2EE.utf8.decode(bytes), expected, hex)
      assert.equal(native.E2EE.utf8.decode(bytes), expected)
    }
    const rand = seeded(31337)
    const special = [0x00, 0x41, 0x7f, 0x80, 0x8f, 0x90, 0x9f, 0xa0, 0xbf, 0xc0, 0xc1, 0xc2, 0xdf, 0xe0, 0xed, 0xef, 0xf0, 0xf4, 0xf5, 0xff]
    for (const i of times(4000)) {
      const bytes = new Uint8Array(times(rand() % 14).map(() => (rand() % 3 === 0) ? rand() & 255 : special[rand() % special.length]))
      assert.equal(fallback.E2EE.utf8.decode(bytes), td.decode(bytes), 'deneme ' + i + ' ' + Buffer.from(bytes).toString('hex'))
    }
  })

  it('yedek uzun metinlerde (parça sınırları ve vekil çiftleri) doğru çalışır', () => {
    const fallback = load()
    const unit = 'ş' + cp(0x1f600) + 'a' + cp(0x1f1f9, 0x1f1f7) + 'İ'
    for (const prefix of ['', 'x', 'xy']) {
      const s = prefix + unit.repeat(6000)
      const bytes = fallback.E2EE.utf8.encode(s)
      assert.equal(hexOf(bytes), Buffer.from(s, 'utf8').toString('hex'))
      assert.equal(fallback.E2EE.utf8.decode(bytes), s)
    }
  })

  it('bozuk TextEncoder/TextDecoder algılanır ve yedek kullanılır', () => {
    class BrokenEncoder {
      encode () {
        return new Uint8Array([1, 2, 3])
      }
    }
    class BrokenDecoder {
      decode () {
        return 'bozuk'
      }
    }
    const ctx = load({ TextEncoder: BrokenEncoder, TextDecoder: BrokenDecoder })
    assert.equal(hexOf(ctx.E2EE.utf8.encode('ş' + cp(0x1f600))), 'c59ff09f9880')
    assert.equal(ctx.E2EE.utf8.decode(Buffer.from('Gün aydın ' + EMOJI, 'utf8')), 'Gün aydın ' + EMOJI)
    const v = VECTORS[0]
    ctx.E2EE.keyring.add(v.code)
    assert.equal(ctx.E2EE.openJson(ctx.E2EE.sealJson(v.kid, { t: TURKCE })).value.t, TURKCE)
  })

  it('yerel ve yedek ortamlar arasında zarflar birbirini açar (Türkçe ve emoji)', () => {
    const v = VECTORS[2]
    const native = withKey(v, { TextEncoder, TextDecoder })
    const fallback = withKey(v)
    for (const t of [TURKCE, EMOJI, TURKCE + EMOJI, cp(0xfeff) + 'baştaki BOM']) {
      assert.equal(fallback.E2EE.openJson(native.E2EE.sealJson(v.kid, { v: 1, t })).value.t, t)
      assert.equal(native.E2EE.openJson(fallback.E2EE.sealJson(v.kid, { v: 1, t })).value.t, t)
    }
  })

  it('utf8 tür hataları', () => {
    const ctx = load()
    for (const x of [null, undefined, 5, {}, new Uint8Array(1)]) assert.throws(() => ctx.E2EE.utf8.encode(x), { name: 'TypeError', code: 'bad_type' })
    for (const x of [null, undefined, 'metin', 5, [65]]) assert.throws(() => ctx.E2EE.utf8.decode(x), { name: 'TypeError', code: 'bad_type' })
    assert.equal(ctx.E2EE.utf8.decode(new Uint8Array([0x61, 0x62]).buffer), 'ab')
  })
})

describe('E2EE: sanitizeFileName', () => {
  const f = (s) => load().E2EE.sanitizeFileName(s)
  const ctx = load()
  const san = ctx.E2EE.sanitizeFileName

  it('olağan adlar korunur', () => {
    for (const name of ['rapor.pdf', 'Çalışma Planı - Ağustos.xlsx', 'ödev (son hali).docx', 'a', 'arşiv.tar.gz', cp(0x1f600) + ' tatil.jpg']) {
      assert.equal(san(name), name)
    }
    assert.equal(f('foto.png'), 'foto.png')
  })

  it('NFC normalleştirmesi uygulanır', () => {
    assert.equal(san('s' + cp(0x327) + 'eker.txt'), cp(0x15f) + 'eker.txt')
    assert.equal(san('I' + cp(0x307) + 'zmir.txt'), cp(0x130) + 'zmir.txt')
  })

  it('kontrol, biçim ve yön (bidi) karakterleri silinir', () => {
    const ranges = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]]
    for (const [lo, hi] of ranges) {
      for (const c of times(hi - lo + 1).map((i) => lo + i)) {
        assert.equal(san('a' + String.fromCharCode(c) + 'b.txt'), 'ab.txt', c.toString(16))
      }
    }
    assert.equal(san('resim' + cp(0x202e) + 'gpj.exe'), 'resimgpj.exe')
    assert.equal(san('belge' + cp(0x2067) + 'fdp.scr' + cp(0x2069)), 'belgefdp.scr')
    assert.equal(san('a' + cp(0x61c) + 'b'), 'ab')
    assert.equal(san('a' + cp(0x2028) + 'b' + cp(0x2029) + 'c'), 'abc')
    assert.equal(san('aile' + cp(0x1f468, 0x200d, 0x1f469) + '.png'), 'aile' + cp(0x1f468, 0x1f469) + '.png')
  })

  it('yol ve Windows için yasak karakterler silinir', () => {
    assert.equal(san('../../etc/passwd'), 'etcpasswd')
    assert.equal(san('..\\..\\windows\\system32\\cmd.exe'), 'windowssystem32cmd.exe')
    assert.equal(san('C:\\Users\\a\\b.txt'), 'CUsersab.txt')
    assert.equal(san('a/b\\c:d*e?f"g<h>i|j.txt'), 'abcdefghij.txt')
    assert.equal(san('dosya.txt:gizli'), 'dosya.txtgizli')
  })

  it('baştaki ve sondaki nokta ile boşluklar kırpılır, boş kalırsa varsayılan ad file', () => {
    assert.equal(san('  .gizli'), 'gizli')
    assert.equal(san('...rapor.pdf'), 'rapor.pdf')
    assert.equal(san('virus.exe. . '), 'virus.exe')
    assert.equal(san('foto.exe ' + cp(0xa0)), 'foto.exe')
    assert.equal(san(' . ' + cp(0x200b) + ' .'), 'file')
    for (const x of ['', '.', '..', '...', '   ', '<>:"/\\|?*', cp(0x202e), null, undefined, 42, {}]) {
      assert.equal(san(x), 'file', JSON.stringify(x))
      assert.equal(san(x, undefined), 'file', JSON.stringify(x))
    }
  })

  it('uzun nokta ve boşluk dizisi içeren ad doğrusal zamanda temizlenir (karesel düzenli ifade yok)', () => {
    // Saldırganın seçtiği ek adı her görüntüleyende çözülür: eski /[.\s]+$/ bu girdide saniyeler sürüyordu
    const evil = 'a' + '. '.repeat(40000) + 'a'
    const started = Date.now()
    const out = san(evil)
    const took = Date.now() - started
    assert.ok(took < 1000, 'süre: ' + took + ' ms')
    assert.equal(Array.from(out).length, 120)
    // Son noktadan sonrası ('. a') uzantı sayılır ve korunur
    assert.equal(out, 'a' + '. '.repeat(58) + '. a')
    assert.equal(san(' .' + ' .'.repeat(40000) + 'b' + '. '.repeat(40000)), 'b')
    assert.equal(san('\t' + cp(0x3000) + 'rapor.pdf' + cp(0x2029) + cp(0x205f) + ' .'), 'rapor.pdf')
  })

  it('boş kalan adda ikinci parametredeki yedek ad (arayüz dilindeki karşılık) kullanılır', () => {
    for (const x of ['', '..', ' . ', '<>|', cp(0x202e), null, undefined, 42]) {
      assert.equal(san(x, 'dosya'), 'dosya', JSON.stringify(x))
      assert.equal(san(x, 'file'), 'file')
      assert.equal(san(x, 'Belge ' + cp(0x1f4c4)), 'Belge ' + cp(0x1f4c4))
    }
    // Ad temizlenebiliyorsa yedek kullanılmaz.
    assert.equal(san('rapor.pdf', 'dosya'), 'rapor.pdf')
    assert.equal(san(' .a. ', 'dosya'), 'a')
    // Yedek ad da aynı temizlikten geçer, o da boş kalırsa veya metin değilse file döner.
    assert.equal(san('', '../' + cp(0x202e) + 'yedek.txt '), 'yedek.txt')
    assert.equal(san('', 'a'.repeat(200) + '.bin'), 'a'.repeat(116) + '.bin')
    for (const fb of ['', '.', ' ', '/\\', cp(0x200b), null, 42, {}, ['dosya']]) {
      assert.equal(san('', fb), 'file', JSON.stringify(fb))
    }
    // Sonuç kararlıdır: aynı yedekle yeniden temizlemek aynı adı verir.
    for (const fb of ['dosya', ' .yedek. ', 'x'.repeat(130)]) {
      const once = san('', fb)
      assert.equal(san(once, fb), once)
      assert.equal(san(once), once)
    }
  })

  it('en fazla 120 kod noktası, uzantı korunarak kısaltılır', () => {
    const long = 'a'.repeat(200) + '.pdf'
    const r1 = san(long)
    assert.equal(Array.from(r1).length, 120)
    assert.equal(r1, 'a'.repeat(116) + '.pdf')
    const emoji = cp(0x1f600).repeat(200) + '.png'
    const r2 = san(emoji)
    assert.equal(Array.from(r2).length, 120)
    assert.equal(r2, cp(0x1f600).repeat(116) + '.png')
    assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(r2), 'yarım vekil olmamalı')
    assert.equal(san('a'.repeat(120)), 'a'.repeat(120))
    assert.equal(san('a'.repeat(121)), 'a'.repeat(120))
    assert.equal(san('a'.repeat(116) + '.pdf'), 'a'.repeat(116) + '.pdf')
    assert.equal(san('b'.repeat(200) + '.' + 'x'.repeat(20)), 'b'.repeat(99) + '.' + 'x'.repeat(20))
    assert.equal(san('b'.repeat(200) + '.' + 'x'.repeat(21)), ('b'.repeat(200) + '.' + 'x'.repeat(21)).slice(0, 120))
    assert.equal(san('c'.repeat(150) + '. '), 'c'.repeat(120))
    assert.equal(san('d'.repeat(119) + ' .' + 'e'.repeat(30)), ('d'.repeat(119) + ' .').slice(0, 120).replace(/[ .]+$/, ''))
  })

  it('tek başına kalmış vekil karakterleri U+FFFD olur ve sonuç kararlıdır (iki kez temizlemek aynı)', () => {
    assert.equal(san('a' + String.fromCharCode(0xd800) + 'b.txt'), 'a' + cp(0xfffd) + 'b.txt')
    const nasty = [
      '  ..' + cp(0x202e) + 'x'.repeat(300) + '.exe . ', 'a'.repeat(119) + '. b', cp(0xfeff) + '.' + cp(0x200b) + '.git',
      'ş'.repeat(130) + '.' + 'ğ'.repeat(5), '\\\\sunucu\\pay\\dosya.txt', 'a' + String.fromCharCode(0xdc00)
    ]
    for (const s of nasty) {
      const once = san(s)
      assert.equal(san(once), once, JSON.stringify(s).slice(0, 40))
      assert.ok(Array.from(once).length <= 120)
      assert.doesNotMatch(once, /^[.\s]|[.\s]$/)
      assert.doesNotMatch(once, /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff/\\:*?"<>|]/)
    }
  })
})

// ===== Ek F: parola türetme, kimlik anahtarları, özel mesajlar, güvenlik numarası ve sabitleme =====

function b64 (bytes) {
  return Buffer.from(bytes).toString('base64url')
}

function u8 (text) {
  return new Uint8Array(Buffer.from(text, 'base64url'))
}

// Node crypto.scryptSync ile bağımsız master ve etiketli türetmeler.
function refMaster (password, saltBytes, N) {
  const pw = Buffer.from(password.normalize('NFC'), 'utf8')
  return nodeCrypto.scryptSync(pw, saltBytes, 32, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 })
}

function refKeys (master) {
  return {
    authKey: sha512(LABEL_AUTH, master).subarray(0, 32).toString('hex'),
    wrapKey: sha512(LABEL_WRAP, master).subarray(0, 32).toString('hex')
  }
}

// Ana bağlamdaki ayrı nacl kopyasıyla üretilen deterministik anahtar çifti.
function pair (seed) {
  const sk = nodeCrypto.createHash('sha256').update('telsiz-test/' + seed).digest()
  const kp = refNacl.box.keyPair.fromSecretKey(new Uint8Array(sk))
  return { publicKey: b64(kp.publicKey), secretKey: new Uint8Array(kp.secretKey), pkBytes: kp.publicKey }
}

// BigInt ile bağımsız güvenlik numarası: çiftler id'ye göre sıralanır, 8 bayt büyük endian id.
function refSafety (idA, pkA, idB, pkB) {
  const parties = [[BigInt(idA), Buffer.from(pkA, 'base64url')], [BigInt(idB), Buffer.from(pkB, 'base64url')]]
  parties.sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : Buffer.compare(x[1], y[1])))
  const parts = [Buffer.from(LABEL_SAFETY, 'utf8')]
  for (const [id, pk] of parties) {
    const b = Buffer.alloc(8)
    b.writeBigUInt64BE(id)
    parts.push(b, pk)
  }
  const h = nodeCrypto.createHash('sha512').update(Buffer.concat(parts)).digest()
  return times(12).map((g) => String(BigInt('0x' + h.subarray(g * 5, g * 5 + 5).toString('hex')) % 100000n).padStart(5, '0')).join(' ')
}

function refFingerprint (pk) {
  const h = nodeCrypto.createHash('sha512').update(Buffer.from(pk, 'base64url')).digest('hex').slice(0, 20)
  return h.match(/.{4}/g).join(' ')
}

// X25519 düşük mertebeli noktaları (libsodium listesi) ve en üst biti 1 olan eşdeğerleri.
const LOW_ORDER = [
  '0000000000000000000000000000000000000000000000000000000000000000',
  '0100000000000000000000000000000000000000000000000000000000000000',
  'e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800',
  '5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157',
  'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  'eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f'
].flatMap((h) => {
  const b = Buffer.from(h, 'hex')
  const high = Buffer.from(b)
  high[31] |= 0x80
  return [b.toString('base64url'), high.toString('base64url')]
})

// Biçimi geçerli, sabit bir açık anahtar (hata kodu testleri için).
const K_DUMMY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'

// Çağrıları kaydeden sahte scrypt: gerçek türetmeyi Node ile yapar (hızlı), parametreleri ve bellek temizliğini denetletir.
function spyScrypt (master) {
  const calls = []
  return {
    calls,
    scrypt (password, salt, N, r, p, dkLen, progress) {
      const call = { password: Buffer.from(password), salt: Buffer.from(salt), N, r, p, dkLen, passwordRef: password }
      calls.push(call)
      progress(0)
      progress(0.5)
      progress(1)
      const out = master ? Buffer.from(master, 'hex') : nodeCrypto.scryptSync(call.password, call.salt, dkLen, { N, r, p, maxmem: 256 * 1024 * 1024 })
      call.master = new Uint8Array(out)
      return Promise.resolve(call.master)
    }
  }
}

describe('E2EE: scrypt-js kütüphanesi (Ek F2.1)', () => {
  it('public/vendor/scrypt.js scrypt-js 3.0.1 ile birebir aynıdır ve global scrypt olarak yüklenir', () => {
    const hash = nodeCrypto.createHash('sha256').update(fs.readFileSync(SCRYPT_PATH)).digest('hex')
    assert.equal(hash, SCRYPT_SHA256)
    const ctx = load()
    assert.equal(typeof ctx.scrypt.scrypt, 'function')
    assert.equal(typeof ctx.scrypt.syncScrypt, 'function')
  })

  it('rastgele 5 parola ve tuzda scrypt-js çıktısı Node crypto.scryptSync ile birebir aynı (N=1024, uzun parola dahil)', async () => {
    const ctx = load()
    const rand = seeded(0xc0ffee)
    for (const len of [1, 14, 64, 65, 150]) {
      const pw = seededBytes(rand, len)
      const salt = seededBytes(rand, 16)
      const got = await ctx.scrypt.scrypt(pw, salt, 1024, 8, 1, 32)
      assert.equal(hexOf(got), nodeCrypto.scryptSync(pw, salt, 32, { N: 1024, r: 8, p: 1 }).toString('hex'), 'uzunluk ' + len)
    }
  })
})

describe('E2EE: parola türetme (kdf)', () => {
  it('F10 test vektörünün kendisi: Node scryptSync master ve etiketli SHA-512 türetmeleri', () => {
    const master = refMaster(F10.password, Buffer.from(F10.saltHex, 'hex'), 16384)
    assert.equal(master.toString('hex'), F10.master)
    assert.deepEqual(refKeys(master), { authKey: F10.authKey, wrapKey: F10.wrapKey })
    assert.equal(Buffer.from(F10.salt, 'base64url').toString('hex'), F10.saltHex)
    assert.equal(F10.password, F10.password.normalize('NFC'))
  })

  it('F10: derive gerçek scrypt-js ile authKey ve wrapKey değerlerini birebir verir (tarayıcı gibi yalnızca setTimeout)', async () => {
    const ctx = load({ timers: 'browser' })
    assert.equal(vm.runInContext('typeof setImmediate', ctx), 'undefined')
    const r = await ctx.E2EE.kdf.derive(F10.password, KDF_F10)
    assert.deepEqual(Object.keys(r).sort(), ['authKey', 'wrapKey'])
    assert.equal(r.authKey, F10.authKey)
    assert.ok(isU8(r.wrapKey))
    assert.ok(isTight(r.wrapKey))
    assert.equal(r.wrapKey.length, 32)
    assert.equal(hexOf(r.wrapKey), F10.wrapKey)
  })

  it('F10 master üzerinden: authKey ve wrapKey yalnızca kendi etiketleriyle türetilir (alan ayrımı)', async () => {
    const spy = spyScrypt(F10.master)
    const r = await load({ scrypt: spy }).E2EE.kdf.derive(F10.password, KDF_F10)
    assert.equal(r.authKey, F10.authKey)
    assert.equal(hexOf(r.wrapKey), F10.wrapKey)
    const master = Buffer.from(F10.master, 'hex')
    const others = [
      master.toString('hex'),
      sha512(LABEL_WRAP, master).subarray(0, 32).toString('hex'),
      sha512(LABEL_AUTH, master).subarray(32, 64).toString('hex'),
      nodeCrypto.createHash('sha512').update(master).digest().subarray(0, 32).toString('hex'),
      sha512(LABEL_ENC, master).subarray(0, 32).toString('hex')
    ]
    assert.ok(!others.includes(r.authKey))
    assert.ok(!others.slice(0, 1).concat(sha512(LABEL_AUTH, master).subarray(0, 32).toString('hex')).includes(hexOf(r.wrapKey)))
    assert.notEqual(r.authKey, hexOf(r.wrapKey))
  })

  it('parola NFC ile normalleştirilir: ayrışık (NFD) yazım aynı anahtarları verir', async () => {
    const nfd = F10.password.normalize('NFD')
    assert.notEqual(nfd, F10.password)
    const r = await load().E2EE.kdf.derive(nfd, KDF_F10)
    assert.equal(r.authKey, F10.authKey)
    assert.equal(hexOf(r.wrapKey), F10.wrapKey)
  })

  it('rastgele 5 parola ve tuzda gerçek N=16384 ile derive, Node crypto.scryptSync türetmesiyle birebir aynı', async () => {
    const ctx = loadNative()
    const rand = seeded(0x7e1512)
    const extras = ['şifre', cp(0x1f600), 'İıĞğ' + cp(0x307), ' ', 'u'.repeat(150)]
    for (const i of times(5)) {
      const password = seededBytes(rand, 9).toString('base64') + extras[i]
      const salt = seededBytes(rand, 16)
      const r = await ctx.E2EE.kdf.derive(password, { salt: salt.toString('base64url'), N: 16384, r: 8, p: 1 })
      const ref = refKeys(refMaster(password, salt, 16384))
      assert.equal(r.authKey, ref.authKey, 'deneme ' + i)
      assert.equal(hexOf(r.wrapKey), ref.wrapKey, 'deneme ' + i)
    }
  })

  it('N=32768 ve N=65536 kabul edilir ve gerçek scrypt-js ile Node türetmesiyle aynı sonucu verir', async () => {
    const ctx = load()
    for (const N of [32768, 65536]) {
      const salt = nodeCrypto.randomBytes(16)
      const r = await ctx.E2EE.kdf.derive('Uzun parola ' + N, { salt: salt.toString('base64url'), N, r: 8, p: 1 })
      const ref = refKeys(refMaster('Uzun parola ' + N, salt, N))
      assert.equal(r.authKey, ref.authKey)
      assert.equal(hexOf(r.wrapKey), ref.wrapKey)
    }
  })

  it('scrypt çağrısı: NFC UTF-8 parola baytları, tuz baytları, N, r 8, p 1, dkLen 32, ardından parola ve master bellekte sıfırlanır', async () => {
    const spy = spyScrypt()
    const ctx = load({ scrypt: spy })
    const rand = seeded(5150)
    // U+FB01 (fi bağı) NFC'de korunur, NFKC olsaydı 'fi' olurdu: normalleştirme biçimi de denetlenir.
    const passwords = ['Parola-O' + cp(0x308) + 'rnek 1', TURKCE + cp(0xfb01), EMOJI, seededBytes(rand, 30).toString('hex')]
    for (const N of [16384, 32768, 65536]) {
      for (const password of passwords) {
        const salt = seededBytes(rand, 16)
        const progress = []
        const r = await ctx.E2EE.kdf.derive(password, { salt: salt.toString('base64url'), N, r: 8, p: 1 }, (x) => progress.push(x))
        const call = spy.calls[spy.calls.length - 1]
        assert.equal(call.password.toString('hex'), Buffer.from(password.normalize('NFC'), 'utf8').toString('hex'))
        assert.equal(call.salt.toString('hex'), salt.toString('hex'))
        assert.deepEqual([call.N, call.r, call.p, call.dkLen], [N, 8, 1, 32])
        assert.deepEqual(progress, [0, 0.5, 1])
        const ref = refKeys(refMaster(password, salt, N))
        assert.equal(r.authKey, ref.authKey)
        assert.equal(hexOf(r.wrapKey), ref.wrapKey)
        assert.ok(call.passwordRef.every((b) => b === 0), 'parola baytları sıfırlanmalı')
        assert.ok(call.master.every((b) => b === 0), 'master sıfırlanmalı')
      }
    }
    assert.equal(spy.calls.length, 12)
  })

  it('kdf doğrulaması: yalnızca N 16384/32768/65536, r 8, p 1 ve 16 baytlık kanonik tuz, aksi halde bad_kdf (Promise reddi)', async () => {
    const spy = spyScrypt(F10.master)
    const ctx = load({ scrypt: spy })
    const salt15 = Buffer.alloc(15, 1).toString('base64url')
    const salt17 = Buffer.alloc(17, 1).toString('base64url')
    const bad = [
      null, undefined, 5, 'kdf', [], [F10.salt, 16384, 8, 1], {},
      { ...KDF_F10, N: 1024 }, { ...KDF_F10, N: 8192 }, { ...KDF_F10, N: 131072 }, { ...KDF_F10, N: '16384' },
      { ...KDF_F10, N: 16384.5 }, { ...KDF_F10, N: undefined }, { ...KDF_F10, r: 16 }, { ...KDF_F10, r: '8' },
      { ...KDF_F10, r: 1 }, { ...KDF_F10, p: 2 }, { ...KDF_F10, p: 0 }, { ...KDF_F10, p: undefined },
      { ...KDF_F10, salt: salt15 }, { ...KDF_F10, salt: salt17 }, { ...KDF_F10, salt: F10.salt + '==' },
      { ...KDF_F10, salt: F10.salt.slice(0, -1) + 'x' }, { ...KDF_F10, salt: '+' + F10.salt.slice(1) },
      { ...KDF_F10, salt: F10.salt.slice(1) + 'AA' }, { ...KDF_F10, salt: null }, { ...KDF_F10, salt: undefined },
      { ...KDF_F10, salt: Buffer.from(F10.saltHex, 'hex') }, { ...KDF_F10, salt: F10.saltHex }
    ]
    for (const kdf of bad) {
      const p = ctx.E2EE.kdf.derive('parola123', kdf)
      assert.equal(typeof p.then, 'function', 'senkron hata değil Promise reddi beklenir')
      await assert.rejects(p, codeIs('bad_kdf'), JSON.stringify(kdf))
    }
    for (const pw of [null, undefined, 5, {}, ['parola123'], new Uint8Array(9)]) {
      await assert.rejects(ctx.E2EE.kdf.derive(pw, KDF_F10), (err) => err.name === 'TypeError' && codeIs('bad_type')(err))
    }
    assert.equal(spy.calls.length, 0, 'geçersiz girdide scrypt hiç çağrılmaz')
    for (const N of [16384, 32768, 65536]) {
      assert.equal((await ctx.E2EE.kdf.derive('parola123', { ...KDF_F10, N })).authKey, F10.authKey)
    }
    assert.equal(spy.calls.length, 3)
  })

  it('kütüphane yoksa no_library, scrypt hatası veya hatalı çıktı kdf_failed olarak reddedilir', async () => {
    const pw = 'parola123'
    await assert.rejects(load({ scrypt: false }).E2EE.kdf.derive(pw, KDF_F10), codeIs('no_library'))
    await assert.rejects(load({ scrypt: { scrypt: 5 } }).E2EE.kdf.derive(pw, KDF_F10), codeIs('no_library'))
    await assert.rejects(load({ nacl: false }).E2EE.kdf.derive(pw, KDF_F10), codeIs('no_library'))
    const failing = { scrypt: () => Promise.reject(new Error('cancelled')) }
    await assert.rejects(load({ scrypt: failing }).E2EE.kdf.derive(pw, KDF_F10), codeIs('kdf_failed'))
    const throwing = {
      scrypt: () => {
        throw new Error('N must be power of 2')
      }
    }
    await assert.rejects(load({ scrypt: throwing }).E2EE.kdf.derive(pw, KDF_F10), codeIs('kdf_failed'))
    const short = { scrypt: () => Promise.resolve(new Uint8Array(16)) }
    await assert.rejects(load({ scrypt: short }).E2EE.kdf.derive(pw, KDF_F10), codeIs('kdf_failed'))
    for (const value of ['master', null, undefined, [1, 2, 3], {}]) {
      const notBytes = { scrypt: () => Promise.resolve(value) }
      await assert.rejects(load({ scrypt: notBytes }).E2EE.kdf.derive(pw, KDF_F10), codeIs('kdf_failed'))
    }
  })

  it('ilerleme: 0 ile başlar, azalmadan 1 ile biter, geri çağrının hatası veya true dönmesi türetmeyi durdurmaz', async () => {
    const ctx = load()
    const seen = []
    const r = await ctx.E2EE.kdf.derive(F10.password, KDF_F10, (x) => {
      seen.push(x)
      return true
    })
    assert.equal(r.authKey, F10.authKey)
    assert.ok(seen.length > 10)
    assert.equal(seen[0], 0)
    assert.equal(seen[seen.length - 1], 1)
    for (const i of times(seen.length - 1)) assert.ok(seen[i + 1] >= seen[i])
    for (const x of seen) assert.ok(x >= 0 && x <= 1)
    let calls = 0
    const r2 = await ctx.E2EE.kdf.derive(F10.password, KDF_F10, () => {
      calls++
      throw new Error('arayüz hatası')
    })
    assert.equal(r2.authKey, F10.authKey)
    assert.ok(calls > 10)
    const spyCtx = load({ scrypt: spyScrypt(F10.master) })
    for (const notFn of [undefined, null, 'fonksiyon değil', {}]) {
      assert.equal((await spyCtx.E2EE.kdf.derive(F10.password, KDF_F10, notFn)).authKey, F10.authKey)
    }
  })

  it('needsUpgrade: yalnızca geçerli ve varsayılandan zayıf ayar yükseltilir', () => {
    const ctx = load()
    assert.equal(ctx.E2EE.kdf.needsUpgrade(KDF_F10), true)
    assert.equal(ctx.E2EE.kdf.needsUpgrade({ ...KDF_F10, N: 32768 }), true)
    assert.equal(ctx.E2EE.kdf.needsUpgrade({ ...KDF_F10, N: 65536 }), false)
    for (const bad of [null, undefined, {}, { ...KDF_F10, N: 8192 }, { ...KDF_F10, r: 16 }, { ...KDF_F10, salt: 'kisa' }]) {
      assert.equal(ctx.E2EE.kdf.needsUpgrade(bad), false)
    }
  })

  it('newParams: 16 rastgele baytlık tuz, N 65536, r 8, p 1, derive tarafından kabul edilir', async () => {
    const ctx = load({ scrypt: spyScrypt(F10.master) })
    const seen = new Set()
    for (const i of times(50)) {
      const k = ctx.E2EE.kdf.newParams()
      assert.deepEqual(Object.keys(k).sort(), ['N', 'p', 'r', 'salt'])
      assert.deepEqual([k.N, k.r, k.p], [65536, 8, 1])
      assert.match(k.salt, /^[A-Za-z0-9_-]{22}$/)
      assert.equal(Buffer.from(k.salt, 'base64url').length, 16)
      assert.equal(Buffer.from(k.salt, 'base64url').toString('base64url'), k.salt)
      seen.add(k.salt)
      if (i < 3) assert.equal((await ctx.E2EE.kdf.derive('parola123', k)).authKey, F10.authKey)
    }
    assert.equal(seen.size, 50)
    const salt = nodeCrypto.randomBytes(16)
    const queue = [nodeCrypto.randomBytes(16), nodeCrypto.randomBytes(16), salt]
    const stub = load({ crypto: queuedCrypto(queue) })
    assert.equal(stub.E2EE.kdf.newParams().salt, salt.toString('base64url'))
    assert.equal(queue.length, 0)
    assert.throws(() => load({ crypto: null }).E2EE.kdf.newParams(), codeIs('no_random'))
    assert.throws(() => load({ crypto: { getRandomValues: (a) => a.fill(7) } }).E2EE.kdf.newParams(), codeIs('no_random'))
    assert.throws(() => load({ nacl: false }).E2EE.kdf.newParams(), codeIs('no_library'))
  })
})

describe('E2EE: kimlik anahtarı (X25519) ve sarma', () => {
  it('generate: nacl.box anahtar çifti, açık anahtar 43 karakter base64url, gizli anahtar 32 bayt', () => {
    const ctx = load()
    const seen = new Set()
    for (const i of times(20)) {
      const k = ctx.E2EE.identity.generate()
      assert.deepEqual(Object.keys(k).sort(), ['publicKey', 'secretKey'])
      assert.match(k.publicKey, /^[A-Za-z0-9_-]{43}$/)
      assert.ok(isU8(k.secretKey))
      assert.ok(isTight(k.secretKey))
      assert.equal(k.secretKey.length, 32)
      assert.equal(b64(refNacl.box.keyPair.fromSecretKey(new Uint8Array(k.secretKey)).publicKey), k.publicKey, 'deneme ' + i)
      seen.add(k.publicKey)
    }
    assert.equal(seen.size, 20)
    const sk = nodeCrypto.randomBytes(32)
    const queue = [nodeCrypto.randomBytes(16), nodeCrypto.randomBytes(16), sk]
    const stub = load({ crypto: queuedCrypto(queue) })
    const k = stub.E2EE.identity.generate()
    assert.equal(queue.length, 0)
    assert.equal(hexOf(k.secretKey), sk.toString('hex'))
    assert.equal(k.publicKey, b64(refNacl.box.keyPair.fromSecretKey(new Uint8Array(sk)).publicKey))
    assert.throws(() => load({ crypto: null }).E2EE.identity.generate(), codeIs('no_random'))
    assert.throws(() => load({ crypto: { getRandomValues: (a) => a.fill(0) } }).E2EE.identity.generate(), codeIs('no_random'))
    assert.throws(() => load({ nacl: false }).E2EE.identity.generate(), codeIs('no_library'))
  })

  it('wrap: sunucu desenine uyan 1w. biçimi, bağımsız secretbox ile açılır, nonce rastgele', () => {
    const ctx = load()
    const k = ctx.E2EE.identity.generate()
    const wk = new Uint8Array(Buffer.from(F10.wrapKey, 'hex'))
    const w = ctx.E2EE.identity.wrap(k.secretKey, wk)
    assert.match(w, WRAPPED_RE)
    const [prefix, nonceText, boxText] = w.split('.')
    assert.equal(prefix, '1w')
    assert.equal(nonceText.length, 32)
    assert.equal(boxText.length, 64)
    const opened = refNacl.secretbox.open(u8(boxText), u8(nonceText), wk)
    assert.equal(hexOf(opened), hexOf(k.secretKey))
    const nonces = new Set(times(100).map(() => ctx.E2EE.identity.wrap(k.secretKey, wk).split('.')[1]))
    assert.equal(nonces.size, 100)
    const nonce = nodeCrypto.randomBytes(24)
    const queue = [nonce]
    const stub = load({ crypto: queuedCrypto(queue) })
    assert.equal(stub.E2EE.identity.wrap(k.secretKey, wk).split('.')[1], nonce.toString('base64url'))
    assert.equal(queue.length, 0)
    assert.throws(() => load({ crypto: null }).E2EE.identity.wrap(k.secretKey, wk), codeIs('no_random'))
    for (const bad of [null, undefined, 'anahtar', b64(wk), new Uint8Array(31), new Uint8Array(33), [1, 2, 3], {}]) {
      assert.throws(() => ctx.E2EE.identity.wrap(bad, wk), codeIs('bad_key'))
      assert.throws(() => ctx.E2EE.identity.wrap(k.secretKey, bad), codeIs('bad_key'))
    }
  })

  it('unwrap: doğru anahtarla gizli anahtarı verir, yanlış anahtar, tek bit bozulma, başka uzunluk ve biçim hatasında null', () => {
    const ctx = load()
    const k = ctx.E2EE.identity.generate()
    const wk = new Uint8Array(Buffer.from(F10.wrapKey, 'hex'))
    const w = ctx.E2EE.identity.wrap(k.secretKey, wk)
    const out = ctx.E2EE.identity.unwrap(w, wk)
    assert.ok(isU8(out))
    assert.ok(isTight(out))
    assert.equal(hexOf(out), hexOf(k.secretKey))
    assert.equal(hexOf(ctx.E2EE.identity.unwrap(w, wk.buffer)), hexOf(k.secretKey))
    const wrong = Buffer.from(wk)
    wrong[31] ^= 0x80
    for (const key of [new Uint8Array(wrong), new Uint8Array(32), nodeCrypto.randomBytes(32), null, 'anahtar', new Uint8Array(31)]) {
      assert.equal(ctx.E2EE.identity.unwrap(w, key), null)
    }
    const [, nonceText, boxText] = w.split('.')
    let checked = 0
    for (const which of ['nonce', 'box']) {
      const src = Buffer.from(which === 'nonce' ? nonceText : boxText, 'base64url')
      for (const bit of times(src.length * 8)) {
        const copy = Buffer.from(src)
        copy[bit >> 3] ^= 1 << (bit & 7)
        const t = which === 'nonce' ? '1w.' + b64(copy) + '.' + boxText : '1w.' + nonceText + '.' + b64(copy)
        assert.equal(ctx.E2EE.identity.unwrap(t, wk), null)
        checked++
      }
    }
    assert.equal(checked, (24 + 48) * 8)
    // Biçime uyan ama 32 bayt olmayan sarılmış içerik (46 ve 50 bayt kutu) kabul edilmez.
    for (const size of [30, 34]) {
      const nonce = new Uint8Array(nodeCrypto.randomBytes(24))
      const t = '1w.' + b64(nonce) + '.' + b64(refNacl.secretbox(new Uint8Array(size), nonce, wk))
      assert.match(t, WRAPPED_RE)
      assert.equal(ctx.E2EE.identity.unwrap(t, wk), null, String(size))
    }
    const bad = [
      null, undefined, 5, {}, '', '1w.', w + '.', w + '=', ' ' + w, w + '\n', '1W' + w.slice(2), '2w' + w.slice(2),
      '1w.' + nonceText.slice(1) + '.' + boxText, '1w.' + nonceText + 'A.' + boxText, '1w.' + nonceText + '.' + boxText.slice(0, 59),
      '1w.' + nonceText + '.' + boxText + 'A'.repeat(7), '1w.' + nonceText + '.+' + boxText.slice(1), '1w-' + w.slice(3)
    ]
    for (const b of bad) assert.equal(ctx.E2EE.identity.unwrap(b, wk), null, String(b))
  })

  it('unwrap üçüncü parametreyle açılan gizli anahtarın verilen açık anahtara ait olduğunu da denetler', () => {
    const ctx = load()
    const k = ctx.E2EE.identity.generate()
    const other = ctx.E2EE.identity.generate()
    const wk = nodeCrypto.randomBytes(32)
    const w = ctx.E2EE.identity.wrap(k.secretKey, wk)
    assert.equal(hexOf(ctx.E2EE.identity.unwrap(w, wk, k.publicKey)), hexOf(k.secretKey))
    for (const pk of [other.publicKey, 'bozuk', k.publicKey.slice(1), k.publicKey + 'A', 5]) {
      assert.equal(ctx.E2EE.identity.unwrap(w, wk, pk), null, String(pk))
    }
    assert.equal(hexOf(ctx.E2EE.identity.unwrap(w, wk, null)), hexOf(k.secretKey))
  })

  it('hesap akışı: paroladan türetilen anahtarla sarılan kimlik başka cihazda aynı parolayla açılır, yanlış parolayla açılmaz', async () => {
    const device1 = load()
    const params = device1.E2EE.kdf.newParams()
    const k1 = await device1.E2EE.kdf.derive('Gizli parola 1', params)
    const id = device1.E2EE.identity.generate()
    const wrapped = device1.E2EE.identity.wrap(id.secretKey, k1.wrapKey)
    const device2 = loadNative()
    const k2 = await device2.E2EE.kdf.derive('Gizli parola 1', JSON.parse(JSON.stringify(params)))
    assert.equal(k2.authKey, k1.authKey)
    assert.equal(hexOf(device2.E2EE.identity.unwrap(wrapped, k2.wrapKey, id.publicKey)), hexOf(id.secretKey))
    const k3 = await device2.E2EE.kdf.derive('Gizli parola 2', params)
    assert.notEqual(k3.authKey, k1.authKey)
    assert.equal(device2.E2EE.identity.unwrap(wrapped, k3.wrapKey), null)
    // Parola değişince aynı gizli anahtar yeni parolanın anahtarıyla yeniden sarılır.
    const rewrapped = device2.E2EE.identity.wrap(device2.E2EE.identity.unwrap(wrapped, k2.wrapKey), k3.wrapKey)
    assert.equal(hexOf(device1.E2EE.identity.unwrap(rewrapped, k3.wrapKey, id.publicKey)), hexOf(id.secretKey))
    assert.equal(device1.E2EE.identity.unwrap(rewrapped, k1.wrapKey), null)
  })
})

describe('E2EE: kimlik anahtarının cihazda saklanması', () => {
  it('save/load/clear: localStorage anahtarı telsiz.identity.<userId>, değer { publicKey, secretKey } base64url', () => {
    const storage = makeStorage()
    const ctx = load({ storage })
    const k = ctx.E2EE.identity.generate()
    assert.equal(ctx.E2EE.identity.save(7, k), true)
    assert.deepEqual([...storage.map.keys()], [IDENTITY_PREFIX + '7'])
    const stored = JSON.parse(storage.map.get(IDENTITY_PREFIX + '7'))
    assert.deepEqual(stored, { publicKey: k.publicKey, secretKey: b64(k.secretKey) })
    const loaded = ctx.E2EE.identity.load(7)
    assert.deepEqual(Object.keys(loaded).sort(), ['publicKey', 'secretKey'])
    assert.equal(loaded.publicKey, k.publicKey)
    assert.ok(isU8(loaded.secretKey))
    assert.equal(hexOf(loaded.secretKey), hexOf(k.secretKey))
    // Her load yeni bir kopya verir, çağıranın sıfırlaması saklanan anahtarı bozmaz.
    loaded.secretKey.fill(0)
    assert.equal(hexOf(ctx.E2EE.identity.load(7).secretKey), hexOf(k.secretKey))
    assert.equal(ctx.E2EE.identity.load('7').publicKey, k.publicKey)
    assert.equal(ctx.E2EE.identity.load(8), null)
    const other = load({ storage })
    assert.equal(other.E2EE.identity.load(7).publicKey, k.publicKey)
    ctx.E2EE.identity.clear(7)
    assert.equal(storage.map.size, 0)
    assert.equal(ctx.E2EE.identity.load(7), null)
    assert.equal(other.E2EE.identity.load(7), null)
  })

  it('save geçersiz kullanıcıyı ve uyuşmayan anahtar çiftini reddeder, load bozuk kayıtta null döner', () => {
    const storage = makeStorage()
    const ctx = load({ storage })
    const k = ctx.E2EE.identity.generate()
    const other = ctx.E2EE.identity.generate()
    for (const id of [0, -1, 1.5, NaN, Infinity, 2 ** 53, '007', '', '1e3', ' 7', 'abc', null, undefined, {}, [7]]) {
      assert.throws(() => ctx.E2EE.identity.save(id, k), codeIs('bad_user'), String(id))
      assert.equal(ctx.E2EE.identity.load(id), null)
    }
    const keysCases = [
      null, undefined, 5, {}, { publicKey: k.publicKey }, { secretKey: k.secretKey },
      { publicKey: other.publicKey, secretKey: k.secretKey }, { publicKey: k.publicKey, secretKey: b64(k.secretKey) },
      { publicKey: k.publicKey, secretKey: k.secretKey.subarray(0, 31) }, { publicKey: k.publicKey + 'A', secretKey: k.secretKey }
    ]
    for (const keys of keysCases) assert.throws(() => ctx.E2EE.identity.save(7, keys), codeIs('bad_key'))
    assert.equal(storage.map.size, 0)
    const sk = b64(k.secretKey)
    const corrupt = [
      'bozuk', 'null', '[]', '{}', '"metin"', JSON.stringify({ publicKey: k.publicKey }),
      JSON.stringify({ publicKey: other.publicKey, secretKey: sk }), JSON.stringify({ publicKey: k.publicKey, secretKey: sk.slice(1) }),
      JSON.stringify({ publicKey: k.publicKey, secretKey: sk + '=' }), JSON.stringify({ publicKey: 5, secretKey: sk }),
      JSON.stringify({ publicKey: k.publicKey, secretKey: b64(other.secretKey) })
    ]
    for (const raw of corrupt) {
      const c = load({ storage: makeStorage({ [IDENTITY_PREFIX + '7']: raw }) })
      assert.equal(c.E2EE.identity.load(7), null, raw)
    }
    const c = load({ storage: makeStorage({ [IDENTITY_PREFIX + '7']: JSON.stringify({ publicKey: k.publicKey, secretKey: sk }) }) })
    assert.equal(hexOf(c.E2EE.identity.load(7).secretKey), hexOf(k.secretKey))
  })

  it('localStorage yoksa, erişim hata verirse veya yazılamazsa kimlik bellekte tutulur, silme her durumda geçerlidir', () => {
    for (const storage of [null, 'throw']) {
      const ctx = load({ storage })
      const k = ctx.E2EE.identity.generate()
      assert.equal(ctx.E2EE.identity.save(3, k), false)
      assert.equal(hexOf(ctx.E2EE.identity.load(3).secretKey), hexOf(k.secretKey))
      ctx.E2EE.identity.clear(3)
      assert.equal(ctx.E2EE.identity.load(3), null)
    }
    const quota = makeStorage()
    quota.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    const ctx = load({ storage: quota })
    const k = ctx.E2EE.identity.generate()
    assert.equal(ctx.E2EE.identity.save(4, k), false)
    assert.equal(quota.map.size, 0)
    assert.equal(ctx.E2EE.identity.load(4).publicKey, k.publicKey)
    // Kaldırma hata verse de bu oturumda kimlik silinmiş sayılır.
    const stuck = makeStorage()
    const c2 = load({ storage: stuck })
    assert.equal(c2.E2EE.identity.save(5, k), true)
    stuck.removeItem = () => {
      throw new Error('SecurityError')
    }
    c2.E2EE.identity.clear(5)
    assert.equal(c2.E2EE.identity.load(5), null)
    // Yeniden kaydetmek mümkündür.
    assert.equal(c2.E2EE.identity.save(5, k), true)
    assert.equal(c2.E2EE.identity.load(5).publicKey, k.publicKey)
  })
})

describe('E2EE: kimlik bağlama (Ek F3)', () => {
  it('sealBinding grup anahtarıyla { v: 1, u, pk } zarfı üretir, verifyBinding doğrular ve mühürleyen kid değerini döner', () => {
    const v = VECTORS[0]
    const ctx = withKey(v)
    const k = pair('ali')
    const env = ctx.E2EE.identity.sealBinding(v.kid, 12, k.publicKey)
    assert.match(env, SERVER_ENVELOPE_RE)
    assert.ok(env.length <= 2000)
    const parts = splitEnvelope(env)
    const opened = refNacl.secretbox.open(new Uint8Array(parts.box), new Uint8Array(parts.nonce), new Uint8Array(refEncKey(Buffer.from(v.secret, 'hex'))))
    assert.deepEqual(JSON.parse(Buffer.from(opened).toString('utf8')), { v: 1, u: 12, pk: k.publicKey })
    assert.deepEqual(plain(ctx.E2EE.identity.verifyBinding(env, 12, k.publicKey)), { ok: true, kid: v.kid })
    assert.deepEqual(plain(ctx.E2EE.identity.verifyBinding(env, '12', k.publicKey)), { ok: true, kid: v.kid })
    const friend = withKey(v, { TextEncoder, TextDecoder })
    assert.deepEqual(plain(friend.E2EE.identity.verifyBinding(env, 12, k.publicKey)), { ok: true, kid: v.kid })
    const env2 = ctx.E2EE.identity.sealBinding(v.kid, '12', k.publicKey)
    assert.equal(ctx.E2EE.openJson(env2).value.u, 12)
  })

  it('yanlış kullanıcı, yanlış açık anahtar, yanlış veya bilinmeyen kid ve bozuk zarf reddedilir', () => {
    const v = VECTORS[0]
    const w = VECTORS[3]
    const ctx = withKey(v)
    ctx.E2EE.keyring.add(w.code)
    const k = pair('ali')
    const m = pair('mallory')
    const vb = (...args) => plain(ctx.E2EE.identity.verifyBinding(...args))
    const env = ctx.E2EE.identity.sealBinding(v.kid, 12, k.publicKey)
    assert.deepEqual(vb(env, 13, k.publicKey), { ok: false, reason: 'wrong_user' })
    assert.deepEqual(vb(env, 12, m.publicKey), { ok: false, reason: 'wrong_key' })
    // Sunucu başka bir kullanıcının geçerli bağlamasını bu kullanıcıya veremez.
    const envM = ctx.E2EE.identity.sealBinding(v.kid, 13, m.publicKey)
    assert.deepEqual(vb(envM, 12, m.publicKey), { ok: false, reason: 'wrong_user' })
    // Anahtarlıktaki başka bir anahtarın kid değeri yazılmış zarf doğrulanamaz.
    assert.deepEqual(vb('1.' + w.kid + env.slice(18), 12, k.publicKey), { ok: false, reason: 'bad_data' })
    // Anahtarlıkta olmayan anahtarla mühürlenmiş bağlama.
    const stranger = withKey(VECTORS[2])
    const envX = stranger.E2EE.identity.sealBinding(VECTORS[2].kid, 12, k.publicKey)
    assert.deepEqual(vb(envX, 12, k.publicKey), { ok: false, reason: 'no_key' })
    // Etkin olmayan (eski) bir anahtarla mühürlenmiş bağlama geçerlidir ama kid değeri ayırt edilir.
    assert.deepEqual(vb(ctx.E2EE.identity.sealBinding(w.kid, 12, k.publicKey), 12, k.publicKey), { ok: true, kid: w.kid })
    const parts = splitEnvelope(env)
    for (const bit of [0, 7, 100, parts.box.length * 8 - 1]) {
      const copy = Buffer.from(parts.box)
      copy[bit >> 3] ^= 1 << (bit & 7)
      assert.deepEqual(vb(buildEnvelope(v.kid, parts.nonce, copy), 12, k.publicKey), { ok: false, reason: 'bad_data' })
    }
    for (const b of [null, undefined, 5, {}, '', 'x', env + '.', '2' + env.slice(1), env.slice(0, 40)]) {
      assert.deepEqual(vb(b, 12, k.publicKey), { ok: false, reason: 'bad_format' })
    }
    for (const id of [0, null, undefined, 'x', 12.5]) assert.deepEqual(vb(env, id, k.publicKey), { ok: false, reason: 'wrong_user' })
    for (const pk of [null, undefined, 'bozuk', k.publicKey.slice(1), k.pkBytes]) {
      assert.deepEqual(vb(env, 12, pk), { ok: false, reason: 'wrong_key' })
    }
  })

  it('içerik biçimi { v: 1, u: sayı, pk: metin } değilse bad_value', () => {
    const v = VECTORS[0]
    const ctx = withKey(v)
    const k = pair('ali')
    const values = [
      { v: 2, u: 12, pk: k.publicKey }, { u: 12, pk: k.publicKey }, { v: '1', u: 12, pk: k.publicKey },
      { v: 1, u: '12', pk: k.publicKey }, { v: 1, pk: k.publicKey }, { v: 1, u: 12 }, { v: 1, u: 12, pk: 5 }, []
    ]
    for (const value of values) {
      const env = ctx.E2EE.sealJson(v.kid, value)
      assert.deepEqual(plain(ctx.E2EE.identity.verifyBinding(env, 12, k.publicKey)), { ok: false, reason: 'bad_value' }, JSON.stringify(value))
    }
    const key = new Uint8Array(refEncKey(Buffer.from(v.secret, 'hex')))
    // Kutunun en az 18 bayt olması için kısa JSON değerleri boşlukla uzatılır (zarf deseni en az 24 karakter).
    for (const json of ['null', '   5', '"metin"', 'true']) {
      const nonce = nodeCrypto.randomBytes(24)
      const box = refNacl.secretbox(new Uint8Array(Buffer.from(json)), new Uint8Array(nonce), key)
      assert.deepEqual(plain(ctx.E2EE.identity.verifyBinding(buildEnvelope(v.kid, nonce, box), 12, k.publicKey)), { ok: false, reason: 'bad_value' })
    }
  })

  it('sealBinding hataları: geçersiz kullanıcı bad_user, geçersiz açık anahtar bad_key, anahtarlıkta olmayan kid no_key', () => {
    const v = VECTORS[0]
    const ctx = withKey(v)
    const k = pair('ali')
    for (const id of [0, -3, 'x', null, 1.5]) assert.throws(() => ctx.E2EE.identity.sealBinding(v.kid, id, k.publicKey), codeIs('bad_user'))
    for (const pk of [null, 'x', k.publicKey.slice(1), k.publicKey + 'A', k.pkBytes]) {
      assert.throws(() => ctx.E2EE.identity.sealBinding(v.kid, 12, pk), codeIs('bad_key'))
    }
    assert.throws(() => ctx.E2EE.identity.sealBinding('0000000000000000', 12, k.publicKey), codeIs('no_key'))
  })
})

describe('E2EE: özel mesajlar (Ek F5.6)', () => {
  const OBJ = { v: 1, a: 1, c: 9, t: TURKCE + ' ' + EMOJI, f: [{ u: 'a'.repeat(32), kind: 'file', name: 'rapor.pdf', s: 10 }] }

  it('seal/open iki yönde: alıcı gönderenin açık anahtarıyla, gönderen kendi mesajını alıcının açık anahtarıyla açar', () => {
    const ali = load()
    const veli = loadNative()
    const a = pair('ali')
    const b = pair('veli')
    const env = ali.E2EE.dm.seal(OBJ, b.publicKey, a.secretKey)
    assert.match(env, DM_SERVER_RE)
    const [prefix, nonceText, boxText] = env.split('.')
    assert.equal(prefix, '2')
    assert.equal(nonceText.length, 32)
    assert.equal(Buffer.from(boxText, 'base64url').length, Buffer.byteLength(JSON.stringify(OBJ), 'utf8') + 16)
    const r1 = veli.E2EE.dm.open(env, [a.publicKey], b.secretKey)
    assert.deepEqual(Object.keys(r1).sort(), ['ok', 'pk', 'value'])
    assert.deepEqual(plain(r1), { ok: true, value: OBJ, pk: a.publicKey })
    assert.deepEqual(plain(ali.E2EE.dm.open(env, [b.publicKey], a.secretKey)), { ok: true, value: OBJ, pk: b.publicKey })
    const back = veli.E2EE.dm.seal({ v: 1, t: 'yanıt' }, a.publicKey, b.secretKey)
    assert.equal(ali.E2EE.dm.open(back, [b.publicKey], a.secretKey).value.t, 'yanıt')
    assert.equal(veli.E2EE.dm.open(back, [a.publicKey], b.secretKey).value.t, 'yanıt')
    assert.equal(veli.E2EE.dm.open(env, a.publicKey, b.secretKey).ok, true)
    assert.match(ali.E2EE.dm.seal({}, b.publicKey, a.secretKey), DM_SERVER_RE)
    assert.match(ali.E2EE.dm.seal([], b.publicKey, a.secretKey), DM_SERVER_RE)
  })

  it('bağımsız doğrulama: zarf nacl.box ile açılır, nacl.box ile üretilen zarf dm.open ile açılır', () => {
    const ctx = load()
    const a = pair('ali')
    const b = pair('veli')
    const env = ctx.E2EE.dm.seal(OBJ, b.publicKey, a.secretKey)
    const [, nonceText, boxText] = env.split('.')
    const opened = refNacl.box.open(u8(boxText), u8(nonceText), a.pkBytes, b.secretKey)
    assert.deepEqual(JSON.parse(Buffer.from(opened).toString('utf8')), OBJ)
    assert.equal(refNacl.box.open(u8(boxText), u8(nonceText), a.pkBytes, pair('ayse').secretKey), null)
    const nonce = new Uint8Array(nodeCrypto.randomBytes(24))
    const box = refNacl.box(new Uint8Array(Buffer.from(JSON.stringify(OBJ), 'utf8')), nonce, b.pkBytes, a.secretKey)
    const env2 = '2.' + b64(nonce) + '.' + b64(box)
    assert.deepEqual(plain(ctx.E2EE.dm.open(env2, [a.publicKey], b.secretKey)), { ok: true, value: OBJ, pk: a.publicKey })
  })

  it('nonce her şifrelemede rastgele üreteçten gelir ve tekrar etmez', () => {
    const ctx = load()
    const a = pair('ali')
    const b = pair('veli')
    const nonces = new Set(times(200).map(() => ctx.E2EE.dm.seal({ t: 'aynı' }, b.publicKey, a.secretKey).split('.')[1]))
    assert.equal(nonces.size, 200)
    const fixed = nodeCrypto.randomBytes(24)
    const queue = [fixed]
    const stub = load({ crypto: queuedCrypto(queue) })
    assert.equal(stub.E2EE.dm.seal({ t: 'x' }, b.publicKey, a.secretKey).split('.')[1], fixed.toString('base64url'))
    assert.equal(queue.length, 0)
    // Üreteç yoksa gönderme reddedilir ama okuma çalışır.
    const noRng = load({ crypto: null })
    assert.throws(() => noRng.E2EE.dm.seal({ t: 'x' }, b.publicKey, a.secretKey), codeIs('no_random'))
    const env = ctx.E2EE.dm.seal({ t: 'okunur' }, b.publicKey, a.secretKey)
    assert.equal(noRng.E2EE.dm.open(env, [a.publicKey], b.secretKey).value.t, 'okunur')
  })

  it('üçüncü kişinin anahtarıyla açılmaz', () => {
    const ctx = load()
    const a = pair('ali')
    const b = pair('veli')
    const c = pair('ayse')
    const env = ctx.E2EE.dm.seal(OBJ, b.publicKey, a.secretKey)
    for (const cands of [[a.publicKey], [b.publicKey], [c.publicKey], [a.publicKey, b.publicKey, c.publicKey]]) {
      assert.deepEqual(plain(ctx.E2EE.dm.open(env, cands, c.secretKey)), { ok: false, reason: 'no_key' })
    }
    assert.deepEqual(plain(ctx.E2EE.dm.open(env, [c.publicKey], b.secretKey)), { ok: false, reason: 'no_key' })
    assert.deepEqual(plain(ctx.E2EE.dm.open(env, [], b.secretKey)), { ok: false, reason: 'no_key' })
    // Üçüncü kişi kendi anahtarıyla, alıcının açık anahtarına mühürlese de gönderen gibi görünemez.
    const forged = ctx.E2EE.dm.seal({ v: 1, t: 'sahte' }, b.publicKey, c.secretKey)
    assert.deepEqual(plain(ctx.E2EE.dm.open(forged, [a.publicKey], b.secretKey)), { ok: false, reason: 'no_key' })
  })

  it('aday listesinde eski anahtar: anahtarı değişen kişinin eski mesajı eski anahtarla açılır', () => {
    const ctx = load()
    const a1 = pair('ali-eski')
    const a2 = pair('ali-yeni')
    const b = pair('veli')
    const oldMsg = ctx.E2EE.dm.seal({ v: 1, t: 'eski' }, b.publicKey, a1.secretKey)
    const newMsg = ctx.E2EE.dm.seal({ v: 1, t: 'yeni' }, b.publicKey, a2.secretKey)
    const cands = [a2.publicKey, a1.publicKey]
    assert.deepEqual(plain(ctx.E2EE.dm.open(oldMsg, cands, b.secretKey)), { ok: true, value: { v: 1, t: 'eski' }, pk: a1.publicKey })
    assert.deepEqual(plain(ctx.E2EE.dm.open(newMsg, cands, b.secretKey)), { ok: true, value: { v: 1, t: 'yeni' }, pk: a2.publicKey })
    assert.deepEqual(plain(ctx.E2EE.dm.open(oldMsg, [a2.publicKey], b.secretKey)), { ok: false, reason: 'no_key' })
    // Geçersiz, tekrarlanan ve düşük mertebeli adaylar atlanır.
    const noisy = ['bozuk', null, 5, {}, a1.publicKey.slice(1), a1.pkBytes, a2.publicKey, a2.publicKey].concat(LOW_ORDER, [a1.publicKey])
    assert.deepEqual(plain(ctx.E2EE.dm.open(oldMsg, noisy, b.secretKey)), { ok: true, value: { v: 1, t: 'eski' }, pk: a1.publicKey })
  })

  it('nonce veya şifreli metinde tek bit değişikliğinde açılmaz', () => {
    const ctx = load()
    const a = pair('ali')
    const b = pair('veli')
    const env = ctx.E2EE.dm.seal({ v: 1, a: 1, c: 2, t: 'bit' }, b.publicKey, a.secretKey)
    const [, nonceText, boxText] = env.split('.')
    let checked = 0
    for (const which of ['nonce', 'box']) {
      const src = Buffer.from(which === 'nonce' ? nonceText : boxText, 'base64url')
      for (const bit of times(src.length * 8)) {
        const copy = Buffer.from(src)
        copy[bit >> 3] ^= 1 << (bit & 7)
        const t = which === 'nonce' ? '2.' + b64(copy) + '.' + boxText : '2.' + nonceText + '.' + b64(copy)
        const r = ctx.E2EE.dm.open(t, [a.publicKey], b.secretKey)
        assert.equal(r.ok, false)
        assert.equal(r.reason, 'no_key')
        checked++
      }
    }
    assert.ok(checked > 400)
    assert.equal(ctx.E2EE.dm.open(env, [a.publicKey], b.secretKey).ok, true)
  })

  it('biçim hataları bad_format, doğrulanmış ama JSON olmayan içerik bad_data, hiçbir girdi istisna fırlatmaz', () => {
    const ctx = load()
    const a = pair('ali')
    const b = pair('veli')
    let env = ''
    for (const i of times(10)) {
      env = ctx.E2EE.dm.seal({ t: 'x'.repeat(i) }, b.publicKey, a.secretKey)
      if (env.split('.')[2].length % 4 !== 0) break
    }
    const [, n, bx] = env.split('.')
    const last = B64_CHARS.indexOf(bx[bx.length - 1])
    const bad = [
      null, undefined, 42, {}, [], '', '2', '2.', '2..', env + '.', env + '=', env + '\n', ' ' + env, '1' + env.slice(1),
      '2.' + n.slice(1) + '.' + bx, '2.' + n + 'A.' + bx, '2.' + n + '.' + bx.slice(0, 23), '2.' + n + '.+' + bx.slice(1),
      '2.' + n + '.' + bx.slice(0, -1) + B64_CHARS[last ^ 1], '2.' + n.slice(0, -1) + '/.' + bx, '2:' + n + '.' + bx
    ]
    for (const x of bad) assert.deepEqual(plain(ctx.E2EE.dm.open(x, [a.publicKey], b.secretKey)), { ok: false, reason: 'bad_format' }, String(x))
    for (const content of [Buffer.from('bu json değil'), Buffer.from([0xff, 0xfe, 0xfd, 0x7b]), Buffer.alloc(0)]) {
      const nonce = new Uint8Array(nodeCrypto.randomBytes(24))
      const box = refNacl.box(new Uint8Array(content), nonce, b.pkBytes, a.secretKey)
      const t = '2.' + b64(nonce) + '.' + b64(box)
      if (!DM_SERVER_RE.test(t)) continue
      assert.deepEqual(plain(ctx.E2EE.dm.open(t, [a.publicKey], b.secretKey)), { ok: false, reason: 'bad_data' })
    }
    for (const sk of [null, undefined, 'anahtar', new Uint8Array(31), b64(b.secretKey), {}]) {
      assert.deepEqual(plain(ctx.E2EE.dm.open(env, [a.publicKey], sk)), { ok: false, reason: 'no_key' })
    }
    for (const cands of [null, undefined, 5, {}, new Set([a.publicKey])]) {
      assert.deepEqual(plain(ctx.E2EE.dm.open(env, cands, b.secretKey)), { ok: false, reason: 'no_key' })
    }
    assert.equal(load({ nacl: false }).E2EE.dm.open(env, [a.publicKey], b.secretKey).reason, 'no_key')
  })

  it('seal hataları: nesne olmayan değer bad_type, geçersiz veya düşük mertebeli açık anahtar ve geçersiz gizli anahtar bad_key', () => {
    const ctx = load()
    const a = pair('ali')
    const b = pair('veli')
    for (const value of [null, undefined, 5, 'metin', true]) {
      assert.throws(() => ctx.E2EE.dm.seal(value, b.publicKey, a.secretKey), { name: 'TypeError', code: 'bad_type' })
    }
    for (const pk of [null, undefined, '', 'x', b.publicKey.slice(1), b.publicKey + 'A', b.pkBytes, '+' + b.publicKey.slice(1)].concat(LOW_ORDER)) {
      assert.throws(() => ctx.E2EE.dm.seal({ t: 'x' }, pk, a.secretKey), codeIs('bad_key'), String(pk))
    }
    for (const sk of [null, undefined, 'x', new Uint8Array(31), b64(a.secretKey), [1, 2]]) {
      assert.throws(() => ctx.E2EE.dm.seal({ t: 'x' }, b.publicKey, sk), codeIs('bad_key'))
    }
    assert.throws(() => load({ nacl: false }).E2EE.dm.seal({ t: 'x' }, b.publicKey, a.secretKey), codeIs('no_library'))
  })

  it('düşük mertebeli açık anahtar: herkesçe bilinen sabit anahtarla üretilmiş zarf açılmaz', () => {
    const ctx = load()
    const b = pair('veli')
    const weak = refNacl.box.before(new Uint8Array(32), b.secretKey)
    for (const pk of LOW_ORDER) {
      // Bu sabit, alıcının gizli anahtarından bağımsızdır, saldırgan da hesaplayabilir.
      assert.equal(hexOf(refNacl.box.before(u8(pk), pair('baska').secretKey)), hexOf(weak))
      const nonce = new Uint8Array(nodeCrypto.randomBytes(24))
      const box = refNacl.secretbox(new Uint8Array(Buffer.from('{"v":1,"t":"sahte"}')), nonce, weak)
      const env = '2.' + b64(nonce) + '.' + b64(box)
      assert.deepEqual(plain(ctx.E2EE.dm.open(env, [pk], b.secretKey)), { ok: false, reason: 'no_key' })
    }
  })

  it('ortak anahtar önbelleği: aynı çift için box.before bir kez, gizli anahtarlar karışmaz, sınırlıdır, identity.clear ile boşalır', () => {
    const ctx = load()
    let before = 0
    const realBefore = ctx.nacl.box.before
    ctx.nacl.box.before = function (pk, sk) {
      before++
      return realBefore(pk, sk)
    }
    const a = pair('ali')
    const b = pair('veli')
    const c = pair('ayse')
    const env = ctx.E2EE.dm.seal(OBJ, b.publicKey, a.secretKey)
    const warm = before
    assert.ok(warm >= 1)
    times(5).forEach(() => ctx.E2EE.dm.seal(OBJ, b.publicKey, a.secretKey))
    assert.equal(before, warm, 'aynı çift önbellekten gelir')
    assert.equal(ctx.E2EE.dm.open(env, [a.publicKey], b.secretKey).ok, true)
    assert.equal(before, warm + 1)
    assert.equal(ctx.E2EE.dm.open(env, [a.publicKey], b.secretKey).ok, true)
    assert.equal(before, warm + 1)
    // Aynı açık anahtar başka bir gizli anahtarla önbellekteki ortak anahtarı kullanamaz.
    assert.deepEqual(plain(ctx.E2EE.dm.open(env, [a.publicKey], c.secretKey)), { ok: false, reason: 'no_key' })
    assert.equal(before, warm + 2)
    const altered = new Uint8Array(b.secretKey)
    altered[5] ^= 1
    assert.deepEqual(plain(ctx.E2EE.dm.open(env, [a.publicKey], altered)), { ok: false, reason: 'no_key' })
    // Önbellek sınırı (64) aşılınca da sonuçlar doğru kalır: her turda iki yeni çift (seal ve open) eklenir.
    for (const i of times(40)) {
      const p = pair('kisi-' + i)
      const e = ctx.E2EE.dm.seal({ i }, p.publicKey, a.secretKey)
      assert.equal(ctx.E2EE.dm.open(e, [a.publicKey], p.secretKey).value.i, i)
    }
    const afterMany = before
    assert.equal(ctx.E2EE.dm.open(env, [a.publicKey], b.secretKey).ok, true)
    assert.equal(before, afterMany + 1, 'eski girdi sınır nedeniyle düşmüş olmalı')
    assert.equal(ctx.E2EE.dm.open(env, [a.publicKey], b.secretKey).ok, true)
    assert.equal(before, afterMany + 1)
    ctx.E2EE.identity.clear(1)
    assert.equal(ctx.E2EE.dm.open(env, [a.publicKey], b.secretKey).ok, true)
    assert.equal(before, afterMany + 2, 'identity.clear önbelleği boşaltır')
  })

  it('en kötü olağan özel mesaj (2000 emoji, 10 ek) sunucunun 24000 karakter sınırına sığar', () => {
    const ctx = load()
    const a = pair('ali')
    const b = pair('veli')
    const f = times(10).map(() => ({
      u: 'f'.repeat(32), k: 'k'.repeat(43), n: 'n'.repeat(32), kind: 'image',
      name: ctx.E2EE.sanitizeFileName(cp(0x1f600).repeat(116) + '.jpeg'), m: 'x'.repeat(100), s: 26214400, w: 2560, h: 2560
    }))
    const env = ctx.E2EE.dm.seal({ v: 1, a: 999999, c: 999999, t: cp(0x1f600).repeat(2000), f }, b.publicKey, a.secretKey)
    assert.match(env, DM_SERVER_RE)
    assert.ok(env.length <= 24000, 'uzunluk ' + env.length)
  })
})

describe('E2EE: güvenlik numarası ve parmak izi (Ek F3.5, F3.6)', () => {
  const PK_A = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8'
  const PK_B = 'ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8'
  const SAFETY_RE = /^[0-9]{5}( [0-9]{5}){11}$/

  it('bilinen yanıt vektörleri (Python hashlib ile bağımsız hesaplandı)', () => {
    const E = load().E2EE
    const expected = '69531 47329 75921 52586 41347 03108 32589 64552 51836 38022 87840 29250'
    assert.equal(refSafety(7, PK_A, 42, PK_B), expected)
    assert.equal(E.safetyNumber(7, PK_A, 42, PK_B), expected)
    assert.equal(E.safetyNumber(42, PK_B, 7, PK_A), expected)
    const big = '92672 04065 79752 75525 21659 93415 53649 40773 77687 36162 71025 31886'
    assert.equal(E.safetyNumber(2 ** 40 + 3, PK_A, Number.MAX_SAFE_INTEGER, PK_B), big)
    assert.equal(E.safetyNumber(String(Number.MAX_SAFE_INTEGER), PK_B, String(2 ** 40 + 3), PK_A), big)
    assert.equal(E.fingerprint(PK_A), '3d94 eea4 9c58 0aef 8169')
    assert.equal(E.fingerprint(PK_B), '887a f58a 3620 2e05 c4c1')
  })

  it('iki tarafta aynı (simetrik), deterministik, 12 grup 5 rakam ve bağımsız BigInt gerçeklemesiyle aynı', () => {
    const a = load()
    const b = loadNative()
    const rand = seeded(0x5afe)
    for (const i of times(60)) {
      const idA = i < 20 ? 1 + (rand() % 1000) : rand() * 2097152 + (rand() & 0x1fffff)
      const idB = i % 7 === 0 ? idA : 1 + (rand() % 100000)
      const pkA = b64(seededBytes(rand, 32))
      const pkB = b64(seededBytes(rand, 32))
      const sn = a.E2EE.safetyNumber(idA, pkA, idB, pkB)
      assert.match(sn, SAFETY_RE)
      assert.equal(sn, b.E2EE.safetyNumber(idB, pkB, idA, pkA))
      assert.equal(sn, a.E2EE.safetyNumber(idA, pkA, idB, pkB))
      assert.equal(sn, refSafety(idA, pkA, idB, pkB), 'deneme ' + i)
    }
  })

  it('kimliklerden veya açık anahtarlardan biri değişince numara değişir', () => {
    const E = load().E2EE
    const base = E.safetyNumber(7, PK_A, 42, PK_B)
    const flipped = Buffer.from(PK_B, 'base64url')
    flipped[31] ^= 1
    const variants = [
      E.safetyNumber(8, PK_A, 42, PK_B), E.safetyNumber(7, PK_A, 43, PK_B), E.safetyNumber(7, PK_B, 42, PK_A),
      E.safetyNumber(7, PK_A, 42, b64(flipped)), E.safetyNumber(7, PK_A, 7, PK_B)
    ]
    // Kimlikler pk ile birlikte sıralanır: çiftlerin sırası değil hangi kimliğin hangi anahtara ait olduğu önemlidir.
    assert.equal(E.safetyNumber(42, PK_A, 7, PK_B), E.safetyNumber(7, PK_B, 42, PK_A))
    for (const v of variants) assert.notEqual(v, base)
    assert.equal(new Set(variants).size, variants.length)
  })

  it('geçersiz girdiler: kullanıcı bad_user, açık anahtar bad_key', () => {
    const E = load().E2EE
    for (const id of [0, -1, 1.5, NaN, 2 ** 53, '007', 'x', null, undefined]) {
      assert.throws(() => E.safetyNumber(id, PK_A, 42, PK_B), codeIs('bad_user'))
      assert.throws(() => E.safetyNumber(7, PK_A, id, PK_B), codeIs('bad_user'))
    }
    for (const pk of [null, '', 'x', PK_A.slice(1), PK_A + 'A', '+' + PK_A.slice(1), Buffer.from(PK_A, 'base64url')]) {
      assert.throws(() => E.safetyNumber(7, pk, 42, PK_B), codeIs('bad_key'))
      assert.throws(() => E.safetyNumber(7, PK_A, 42, pk), codeIs('bad_key'))
      assert.throws(() => E.fingerprint(pk), codeIs('bad_key'))
    }
    assert.throws(() => load({ nacl: false }).E2EE.fingerprint(PK_A), codeIs('no_library'))
  })

  it('fingerprint: açık anahtarın SHA-512 özetinin ilk 20 hex karakteri, 4lü gruplar', () => {
    const E = load().E2EE
    const rand = seeded(616)
    for (const i of times(50)) {
      const pk = b64(seededBytes(rand, 32))
      const fp = E.fingerprint(pk)
      assert.match(fp, /^[0-9a-f]{4}( [0-9a-f]{4}){4}$/)
      assert.equal(fp, refFingerprint(pk), 'deneme ' + i)
    }
    const k = E.identity.generate()
    assert.equal(E.fingerprint(k.publicKey), loadNative().E2EE.fingerprint(k.publicKey))
  })
})

describe('E2EE: ilk görüşte sabitleme (pins, Ek F3.4)', () => {
  const K1 = pair('k1').publicKey
  const K2 = pair('k2').publicKey
  const K3 = pair('k3').publicKey

  it('durum makinesi: new, same, changed (kabul edilene kadar), accept, setVerified ve depolama biçimi', () => {
    const storage = makeStorage()
    const ctx = load({ storage })
    const P = ctx.E2EE.pins
    const t0 = Date.now()
    assert.deepEqual(plain(P.observe(1, 2, K1)), { status: 'new', verified: false, keys: [K1] })
    const t1 = Date.now()
    assert.deepEqual([...storage.map.keys()], [PINS_PREFIX + '1'])
    const stored = JSON.parse(storage.map.get(PINS_PREFIX + '1'))
    assert.deepEqual(Object.keys(stored), ['2'])
    assert.deepEqual(Object.keys(stored['2']).sort(), ['changed', 'keys', 'verified'])
    assert.equal(stored['2'].verified, false)
    assert.equal(stored['2'].changed, false)
    assert.equal(stored['2'].keys.length, 1)
    assert.equal(stored['2'].keys[0].pk, K1)
    assert.ok(stored['2'].keys[0].firstSeen >= t0 && stored['2'].keys[0].firstSeen <= t1)
    assert.deepEqual(plain(P.observe(1, 2, K1)), { status: 'same', verified: false, keys: [K1] })
    assert.equal(P.setVerified(1, 2, true).verified, true)
    assert.deepEqual(plain(P.observe(1, 2, K1)), { status: 'same', verified: true, keys: [K1] })
    // Anahtar değişti: doğrulama düşer, kabul edilene kadar durum changed kalır (yenilemeden sonra da).
    assert.deepEqual(plain(P.observe(1, 2, K2)), { status: 'changed', verified: false, keys: [K2, K1] })
    assert.deepEqual(plain(P.observe(1, 2, K2)), { status: 'changed', verified: false, keys: [K2, K1] })
    const reloaded = load({ storage })
    assert.deepEqual(plain(reloaded.E2EE.pins.observe(1, 2, K2)), { status: 'changed', verified: false, keys: [K2, K1] })
    assert.equal(reloaded.E2EE.pins.get(1, 2).status, 'changed')
    const accepted = plain(P.accept(1, 2))
    assert.equal(accepted.status, 'same')
    assert.equal(accepted.verified, false)
    assert.deepEqual(accepted.keys, [K2, K1])
    assert.deepEqual(plain(P.observe(1, 2, K2)), { status: 'same', verified: false, keys: [K2, K1] })
    assert.deepEqual(plain(reloaded.E2EE.pins.knownKeys(1, 2)), [K2, K1])
    // Eski anahtara dönüş de bir değişikliktir, ilk görülme zamanı korunur.
    const firstSeenK1 = plain(P.get(1, 2)).entries[1].firstSeen
    assert.deepEqual(plain(P.observe(1, 2, K1)), { status: 'changed', verified: false, keys: [K1, K2] })
    assert.equal(plain(P.get(1, 2)).entries[0].firstSeen, firstSeenK1)
    // Doğrulandı olarak işaretlemek bekleyen değişikliği de kabul eder.
    const ver = plain(P.setVerified(1, 2, true))
    assert.deepEqual([ver.status, ver.verified], ['same', true])
    const unver = plain(P.setVerified(1, 2, false))
    assert.deepEqual([unver.status, unver.verified], ['same', false])
    assert.deepEqual(plain(P.observe(1, 2, K3)), { status: 'changed', verified: false, keys: [K3, K1, K2] })
    // setVerified(false) bekleyen değişikliği kabul etmez.
    assert.equal(P.setVerified(1, 2, false).status, 'changed')
    assert.equal(P.setVerified(1, 2, 'evet').verified, false)
    const view = plain(P.get(1, 2))
    assert.deepEqual(Object.keys(view).sort(), ['entries', 'keys', 'status', 'verified'])
    assert.deepEqual(view.entries.map((e) => e.pk), [K3, K1, K2])
    for (const e of view.entries) assert.equal(typeof e.firstSeen, 'number')
  })

  it('sahipler (myId) ve kişiler birbirinden ayrıdır, bilinmeyen kişide null ve boş liste', () => {
    const storage = makeStorage()
    const P = load({ storage }).E2EE.pins
    assert.equal(P.observe(1, 2, K1).status, 'new')
    assert.equal(P.observe(1, 3, K2).status, 'new')
    assert.equal(P.observe(5, 2, K2).status, 'new')
    assert.equal(P.observe('1', '2', K1).status, 'same')
    assert.deepEqual([...storage.map.keys()].sort(), [PINS_PREFIX + '1', PINS_PREFIX + '5'])
    assert.deepEqual(plain(P.knownKeys(1, 2)), [K1])
    assert.deepEqual(plain(P.knownKeys(5, 2)), [K2])
    assert.deepEqual(plain(P.knownKeys(1, 9)), [])
    assert.equal(P.get(1, 9), null)
    assert.equal(P.accept(1, 9), null)
    assert.equal(P.setVerified(1, 9, true), null)
    assert.equal(storage.map.get(PINS_PREFIX + '9'), undefined)
  })

  it('geçersiz girdiler kodla reddedilir', () => {
    const P = load().E2EE.pins
    for (const id of [0, -1, 1.5, 'x', '007', null, undefined, {}]) {
      assert.throws(() => P.observe(id, 2, K1), codeIs('bad_user'))
      assert.throws(() => P.observe(1, id, K1), codeIs('bad_user'))
      for (const fn of [P.accept, P.knownKeys, P.get]) assert.throws(() => fn(1, id), codeIs('bad_user'))
      assert.throws(() => P.setVerified(id, 2, true), codeIs('bad_user'))
    }
    for (const pk of [null, '', 'x', K1.slice(1), K1 + 'A', Buffer.from(K1, 'base64url')]) {
      assert.throws(() => P.observe(1, 2, pk), codeIs('bad_key'))
    }
    assert.equal(P.get(1, 2), null)
  })

  it('bozuk depolama çökertmez, geçersiz kayıtlar atlanır, tutarsız doğrulama düzeltilir ve prototip kirlenmez', () => {
    const raws = [
      'bozuk json', 'null', '42', '[]', '"metin"', '{"2":null}', '{"2":{"keys":"x"}}', '{"2":{"keys":[]}}',
      '{"2":{"keys":[{"pk":"bozuk"}]}}', '{"__proto__":{"kirli":1},"constructor":{"keys":[]}}',
      JSON.stringify({ '02': { keys: [{ pk: K1, firstSeen: 1 }], verified: true, changed: false } })
    ]
    for (const raw of raws) {
      const ctx = load({ storage: makeStorage({ [PINS_PREFIX + '1']: raw }) })
      assert.equal(ctx.E2EE.pins.get(1, 2), null, raw)
      assert.equal(vm.runInContext('({}).kirli', ctx), undefined)
      assert.equal(ctx.E2EE.pins.observe(1, 2, K1).status, 'new')
    }
    const messy = {
      2: { keys: [{ pk: K2, firstSeen: 'dün' }, 'x', { pk: K1, firstSeen: 5 }, { pk: K2, firstSeen: 9 }], verified: true, changed: true }
    }
    const ctx = load({ storage: makeStorage({ [PINS_PREFIX + '1']: JSON.stringify(messy) }) })
    assert.deepEqual(plain(ctx.E2EE.pins.get(1, 2)), {
      status: 'changed', verified: false, keys: [K2, K1], entries: [{ pk: K2, firstSeen: 0 }, { pk: K1, firstSeen: 5 }]
    })
  })

  it('depolama yoksa veya yazılamazsa sabitlemeler bellekte çalışır', () => {
    for (const storage of [null, 'throw']) {
      const P = load({ storage }).E2EE.pins
      assert.equal(P.observe(1, 2, K1).status, 'new')
      assert.equal(P.observe(1, 2, K1).status, 'same')
      assert.equal(P.observe(1, 2, K2).status, 'changed')
      assert.equal(P.accept(1, 2).status, 'same')
      assert.deepEqual(plain(P.knownKeys(1, 2)), [K2, K1])
    }
    const quota = makeStorage()
    quota.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    const P = load({ storage: quota }).E2EE.pins
    assert.equal(P.observe(1, 2, K1).status, 'new')
    assert.equal(P.observe(1, 2, K2).status, 'changed')
    assert.equal(P.observe(1, 2, K2).status, 'changed')
    assert.equal(quota.map.size, 0)
  })

  it('anahtar listesi sınırlıdır: en fazla 32 anahtar, en yeni önce', () => {
    const P = load().E2EE.pins
    const keys = times(40).map((i) => pair('cok-' + i).publicKey)
    for (const k of keys) P.observe(1, 2, k)
    const known = plain(P.knownKeys(1, 2))
    assert.equal(known.length, 32)
    assert.deepEqual(known, keys.slice(8).reverse())
  })
})

describe('E2EE: Ek F hata kodları', () => {
  it('nacl yüklü ama nacl.box yoksa kimlik ve özel mesaj işlemleri no_library verir, grup zarfları çalışmaya devam eder', () => {
    const v = VECTORS[0]
    const ctx = withKey(v)
    ctx.nacl.box = undefined
    const a = pair('ali')
    const b = pair('veli')
    assert.throws(() => ctx.E2EE.identity.generate(), codeIs('no_library'))
    assert.throws(() => ctx.E2EE.dm.seal({ t: 'x' }, b.publicKey, a.secretKey), codeIs('no_library'))
    assert.throws(() => ctx.E2EE.identity.save(1, a), codeIs('no_library'))
    assert.equal(ctx.E2EE.identity.load(1), null)
    const env = load().E2EE.dm.seal({ t: 'x' }, b.publicKey, a.secretKey)
    assert.deepEqual(plain(ctx.E2EE.dm.open(env, [a.publicKey], b.secretKey)), { ok: false, reason: 'no_key' })
    assert.equal(ctx.E2EE.openJson(ctx.E2EE.sealJson(v.kid, { t: 'grup' })).value.t, 'grup')
  })

  it('Ek F işlevlerinden fırlatılan her hata bir kod ve İngilizce teknik mesaj taşır, girdiyi içermez', () => {
    const v = VECTORS[0]
    const ctx = withKey(v)
    const E = ctx.E2EE
    const secretText = 'gizlibilgi'
    const cases = [
      [() => E.identity.wrap(secretText, new Uint8Array(32)), 'bad_key'],
      [() => E.identity.save(secretText, {}), 'bad_user'],
      [() => E.identity.sealBinding(v.kid, 1, secretText), 'bad_key'],
      [() => E.dm.seal({ t: secretText }, secretText, new Uint8Array(32)), 'bad_key'],
      [() => E.dm.seal(secretText, K_DUMMY, new Uint8Array(32)), 'bad_type'],
      [() => E.safetyNumber(secretText, K_DUMMY, 2, K_DUMMY), 'bad_user'],
      [() => E.fingerprint(secretText), 'bad_key'],
      [() => E.pins.observe(1, 2, secretText), 'bad_key']
    ]
    for (const [fn, code] of cases) {
      assert.throws(fn, (err) => {
        assertCoded(err, code)
        assert.ok(!err.message.includes(secretText))
        return true
      })
    }
  })
})

