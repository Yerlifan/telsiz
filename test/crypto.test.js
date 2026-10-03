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
const KEY_CODES = ['empty', 'bad_length', 'bad_char', 'bad_padding', 'bad_checksum']
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

function load (opts = {}) {
  const sandbox = {}
  sandbox.self = sandbox
  sandbox.window = sandbox
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
  vm.createContext(sandbox)
  if (opts.nacl !== false) vm.runInContext(NACL_SRC, sandbox, { filename: 'nacl-fast.min.js' })
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
      'available', 'b64url', 'decryptFile', 'encryptFile', 'generateKeyCode', 'keyring',
      'openJson', 'parseKeyCode', 'sanitizeFileName', 'sealJson', 'sniffImage', 'utf8'
    ])
    assert.deepEqual(Object.keys(ctx.E2EE.keyring).sort(), ['add', 'has', 'list', 'remove'])
    assert.deepEqual(Object.keys(ctx.E2EE.b64url).sort(), ['decode', 'encode'])
    assert.deepEqual(Object.keys(ctx.E2EE.utf8).sort(), ['decode', 'encode'])
    for (const obj of [ctx.E2EE, ctx.E2EE.keyring, ctx.E2EE.b64url, ctx.E2EE.utf8]) assert.ok(Object.isFrozen(obj))
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
    assert.doesNotMatch(E2EE_SRC, /setPRNG|lowlevel|scalarMult|\.sign\b|\.box\b|crypto\.subtle/)
    assert.doesNotMatch(E2EE_SRC, /console\./)
  })

  it('alan ayrımı etiketleri ve depolama anahtarı Telsiz adını taşır', () => {
    // Satır sonu varsayımı yok (Windows'ta dosya CRLF ile çekilebilir).
    const lines = E2EE_SRC.split(/\r?\n/)
    for (const label of [LABEL_CHECK, LABEL_ENC, LABEL_KID, RING_KEY]) {
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
