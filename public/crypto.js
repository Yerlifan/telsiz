'use strict'

// Uçtan uca şifreleme yardımcıları (window.E2EE).
// Kriptografik ilkel olarak yalnızca TweetNaCl-js kullanılır: nacl.secretbox (XSalsa20-Poly1305),
// nacl.hash (SHA-512), nacl.randomBytes ve özel mesajlar için nacl.box (X25519 ile ortak anahtar).
// Paroladan anahtar türetme scrypt-js ile yapılır (global scrypt). Bu dosyada kodlama, biçim,
// anahtarlık, kimlik anahtarı ve sabitleme işleri vardır.
// Anahtarlar ve düz metinler hiçbir zaman loglanmaz. Ağa yalnızca sarılmış (şifreli) özel anahtar,
// açık anahtar ve paroladan türetilen kimlik doğrulama anahtarı (authKey) gider.
// Bu dosyada kullanıcıya görünen metin yoktur. Hatalar Error.code ile (ör. 'bad_checksum'),
// openJson sonuçları reason ile bildirilir, arayüz bunları seçili dile çevirir.
// Error.message yalnızca geliştiriciler için İngilizce teknik açıklamadır ve girdiyi içermez.

var E2EE = (function (root) {
  const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const SECRET_BYTES = 16
  const CODE_DATA_CHARS = 26
  const CODE_CHARS = 28
  const KEY_BYTES = 32
  const NONCE_BYTES = 24
  const RING_KEY = 'telsiz.keys'
  const LABEL_CHECK = 'telsiz-e2ee-v1/check'
  const LABEL_ENC = 'telsiz-e2ee-v1/enc'
  const LABEL_KID = 'telsiz-e2ee-v1/kid'
  const KID_RE = /^[0-9a-f]{16}$/
  const ENVELOPE_RE = /^1\.([0-9a-f]{16})\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{24,})$/
  const FORMATTED_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/
  const SEPARATOR_RE = /^[\s\-\u2010-\u2015\u2212]$/
  const MAX_CODE_INPUT = 2048
  const MAX_FILE_NAME = 120
  const MAX_FILE_EXT = 20
  const DEFAULT_FILE_NAME = 'file'
  const FILE_NAME_STRIP_RE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff\/\\:*?"<>|]/g
  // Baştaki ve sondaki nokta ile boşluklar karakter karakter kırpılır (trimFileNameEdges). Sonda bağlı bir düzenli ifade
  // ([.\s]+$) uzun nokta ve boşluk dizilerinde karesel zaman alır.
  const FILE_NAME_EDGE_CHAR_RE = /^[.\s]$/
  // Ek F: parola türetme, kişisel kimlik anahtarları, özel mesajlar ve sabitleme
  const KDF_LABEL_AUTH = 'telsiz-auth-v1'
  const KDF_LABEL_WRAP = 'telsiz-wrap-v1'
  const SAFETY_LABEL = 'telsiz-safety-v1'
  const DM_CACHE_LABEL = 'telsiz-dm-cache-v1'
  const IDENTITY_PREFIX = 'telsiz.identity.'
  const PINS_PREFIX = 'telsiz.pins.'
  const KDF_N_VALUES = [16384, 32768, 65536]
  const KDF_DEFAULT_N = 16384
  const KDF_R = 8
  const KDF_P = 1
  const KDF_SALT_BYTES = 16
  const BOX_KEY_BYTES = 32
  const MAC_BYTES = 16
  const WRAPPED_RE = /^1w\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{60,70})$/
  const DM_ENVELOPE_RE = /^2\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{24,})$/
  const PUBLIC_KEY_RE = /^[A-Za-z0-9_-]{43}$/
  const USER_ID_RE = /^[1-9][0-9]{0,15}$/
  const DM_CACHE_MAX = 64
  const DM_MAX_CANDIDATES = 64
  const PIN_KEYS_MAX = 32
  const SAFETY_GROUPS = 12
  const FINGERPRINT_BYTES = 10
  const toStr = Object.prototype.toString

  // Crockford base32 çözme tablosu: büyük/küçük harf duyarsız, O -> 0, I ve L -> 1, U geçersiz.
  const CODE_LOOKUP = (function () {
    const map = Object.create(null)
    let i = 0
    while (i < CODE_ALPHABET.length) {
      const ch = CODE_ALPHABET[i]
      map[ch] = i
      map[ch.toLowerCase()] = i
      i++
    }
    map.O = 0
    map.o = 0
    map.I = 1
    map.i = 1
    map.L = 1
    map.l = 1
    // Türkçe klavyedeki noktasız ı ve noktalı İ de 1 sayılır.
    map[String.fromCharCode(0x131)] = 1
    map[String.fromCharCode(0x130)] = 1
    return map
  })()

  const B64_LOOKUP = (function () {
    const table = new Int16Array(128).fill(-1)
    let i = 0
    while (i < B64_ALPHABET.length) {
      table[B64_ALPHABET.charCodeAt(i)] = i
      i++
    }
    return table
  })()

  let naclRef = null

  // Fırlatılan her hata makine tarafından okunabilir bir kod taşır.
  function fail (code, message, Ctor) {
    const err = new (Ctor || Error)(message)
    err.code = code
    return err
  }

  function lib () {
    if (naclRef) return naclRef
    const n = root.nacl
    if (!n || typeof n.secretbox !== 'function' || typeof n.secretbox.open !== 'function' ||
        typeof n.hash !== 'function' || typeof n.randomBytes !== 'function') {
      throw fail('no_library', 'Encryption library (nacl) is not available.')
    }
    naclRef = n
    return n
  }

  // nacl.randomBytes, güvenli rastgele sayı üreteci yoksa kodsuz bir hata fırlatır, burada koda çevrilir.
  function random (count) {
    const n = lib()
    try {
      return n.randomBytes(count)
    } catch (e) {
      throw fail('no_random', 'No secure random number generator is available.')
    }
  }

  // Bayt girdisini bu ortamın Uint8Array görünümüne çevirir (kopyalamadan).
  function asBytes (x) {
    if (x instanceof Uint8Array) return x
    if (x instanceof ArrayBuffer || toStr.call(x) === '[object ArrayBuffer]') return new Uint8Array(x)
    if (x && ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength)
    throw fail('bad_type', 'Expected a Uint8Array, ArrayBuffer or ArrayBuffer view.', TypeError)
  }

  // Görünüm kendi arabelleğinin tamamı değilse sıkı bir kopya döner (box.buffer güvenle kullanılabilsin).
  function tight (view) {
    if (view.byteOffset === 0 && view.byteLength === view.buffer.byteLength) return view
    return view.slice()
  }

  function sameString (a, b) {
    if (a.length !== b.length) return false
    let diff = 0
    let i = 0
    while (i < a.length) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
      i++
    }
    return diff === 0
  }

  function hex (bytes) {
    let out = ''
    let i = 0
    while (i < bytes.length) {
      out += (bytes[i] < 16 ? '0' : '') + bytes[i].toString(16)
      i++
    }
    return out
  }

  // UTF-8: TextEncoder/TextDecoder varsa ve doğru çalışıyorsa onlar, yoksa WHATWG ile aynı sonucu veren yedek.
  const PROBE_TEXT = String.fromCharCode(0x015f, 0xd83d, 0xde00)
  const PROBE_BYTES = [0xc5, 0x9f, 0xf0, 0x9f, 0x98, 0x80]

  const nativeEncoder = (function () {
    try {
      if (typeof root.TextEncoder !== 'function') return null
      const enc = new root.TextEncoder()
      const out = enc.encode(PROBE_TEXT)
      if (out.length !== PROBE_BYTES.length) return null
      let i = 0
      while (i < out.length) {
        if (out[i] !== PROBE_BYTES[i]) return null
        i++
      }
      const lone = enc.encode('\ud800')
      if (lone.length !== 3 || lone[0] !== 0xef || lone[1] !== 0xbf || lone[2] !== 0xbd) return null
      return enc
    } catch (e) {
      return null
    }
  })()

  const nativeDecoder = (function () {
    try {
      if (typeof root.TextDecoder !== 'function') return null
      const dec = new root.TextDecoder('utf-8', { ignoreBOM: true })
      if (dec.decode(new Uint8Array(PROBE_BYTES)) !== PROBE_TEXT) return null
      if (dec.decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41, 0xff])) !== '\ufeffA\ufffd') return null
      return dec
    } catch (e) {
      return null
    }
  })()

  function utf8EncodeFallback (str) {
    const n = str.length
    const out = new Uint8Array(n * 3)
    let p = 0
    let i = 0
    while (i < n) {
      let c = str.charCodeAt(i)
      i++
      if (c >= 0xd800 && c <= 0xdbff) {
        const d = i < n ? str.charCodeAt(i) : 0
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00)
          i++
        } else {
          c = 0xfffd
        }
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        c = 0xfffd
      }
      if (c < 0x80) {
        out[p++] = c
      } else if (c < 0x800) {
        out[p++] = 0xc0 | (c >>> 6)
        out[p++] = 0x80 | (c & 0x3f)
      } else if (c < 0x10000) {
        out[p++] = 0xe0 | (c >>> 12)
        out[p++] = 0x80 | ((c >>> 6) & 0x3f)
        out[p++] = 0x80 | (c & 0x3f)
      } else {
        out[p++] = 0xf0 | (c >>> 18)
        out[p++] = 0x80 | ((c >>> 12) & 0x3f)
        out[p++] = 0x80 | ((c >>> 6) & 0x3f)
        out[p++] = 0x80 | (c & 0x3f)
      }
    }
    return out.slice(0, p)
  }

  function pushCodePoint (units, cp) {
    if (cp > 0xffff) {
      const v = cp - 0x10000
      units.push(0xd800 + (v >>> 10), 0xdc00 + (v & 0x3ff))
    } else {
      units.push(cp)
    }
  }

  // WHATWG UTF-8 çözücüsü (hatalı dizilerde U+FFFD, BOM korunur).
  function utf8DecodeFallback (bytes) {
    const units = []
    let out = ''
    let needed = 0
    let seen = 0
    let cp = 0
    let lower = 0x80
    let upper = 0xbf
    let i = 0
    while (i < bytes.length) {
      const b = bytes[i]
      if (needed === 0) {
        i++
        if (b <= 0x7f) {
          units.push(b)
        } else if (b >= 0xc2 && b <= 0xdf) {
          needed = 1
          cp = b & 0x1f
        } else if (b >= 0xe0 && b <= 0xef) {
          if (b === 0xe0) lower = 0xa0
          if (b === 0xed) upper = 0x9f
          needed = 2
          cp = b & 0x0f
        } else if (b >= 0xf0 && b <= 0xf4) {
          if (b === 0xf0) lower = 0x90
          if (b === 0xf4) upper = 0x8f
          needed = 3
          cp = b & 0x07
        } else {
          units.push(0xfffd)
        }
      } else if (b < lower || b > upper) {
        // Beklenmeyen bayt: yarım dizi U+FFFD olur, bayt baştan yeniden işlenir.
        needed = 0
        seen = 0
        cp = 0
        lower = 0x80
        upper = 0xbf
        units.push(0xfffd)
      } else {
        i++
        lower = 0x80
        upper = 0xbf
        cp = (cp << 6) | (b & 0x3f)
        seen++
        if (seen === needed) {
          pushCodePoint(units, cp)
          needed = 0
          seen = 0
          cp = 0
        }
      }
      if (units.length >= 8192) {
        out += String.fromCharCode.apply(null, units)
        units.length = 0
      }
    }
    if (needed !== 0) units.push(0xfffd)
    return out + String.fromCharCode.apply(null, units)
  }

  function utf8Encode (str) {
    if (typeof str !== 'string') throw fail('bad_type', 'Expected a string.', TypeError)
    if (nativeEncoder) return asBytes(nativeEncoder.encode(str))
    return utf8EncodeFallback(str)
  }

  function utf8Decode (input) {
    const bytes = asBytes(input)
    if (nativeDecoder) return nativeDecoder.decode(bytes)
    return utf8DecodeFallback(bytes)
  }

  // base64url (RFC 4648 bölüm 5), dolgusuz. Çözme katıdır: dolgu, yabancı karakter ve sıfır olmayan artık bitler reddedilir.
  function b64encode (input) {
    const bytes = asBytes(input)
    const n = bytes.length
    const parts = []
    let chunk = ''
    let i = 0
    while (i + 3 <= n) {
      const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
      chunk += B64_ALPHABET[v >>> 18] + B64_ALPHABET[(v >>> 12) & 63] +
        B64_ALPHABET[(v >>> 6) & 63] + B64_ALPHABET[v & 63]
      i += 3
      if (chunk.length >= 32768) {
        parts.push(chunk)
        chunk = ''
      }
    }
    if (n - i === 1) {
      const v = bytes[i] << 16
      chunk += B64_ALPHABET[v >>> 18] + B64_ALPHABET[(v >>> 12) & 63]
    } else if (n - i === 2) {
      const v = (bytes[i] << 16) | (bytes[i + 1] << 8)
      chunk += B64_ALPHABET[v >>> 18] + B64_ALPHABET[(v >>> 12) & 63] + B64_ALPHABET[(v >>> 6) & 63]
    }
    parts.push(chunk)
    return parts.join('')
  }

  function b64value (str, i) {
    const c = str.charCodeAt(i)
    const v = c < 128 ? B64_LOOKUP[c] : -1
    if (v < 0) throw fail('bad_base64', 'Invalid base64url character.')
    return v
  }

  function b64decode (str) {
    if (typeof str !== 'string') throw fail('bad_type', 'Expected a base64url string.', TypeError)
    const n = str.length
    const rest = n % 4
    if (rest === 1) throw fail('bad_base64', 'Invalid base64url length.')
    const out = new Uint8Array(Math.floor(n / 4) * 3 + (rest === 0 ? 0 : rest - 1))
    let i = 0
    let p = 0
    while (i + 4 <= n) {
      const v = (b64value(str, i) << 18) | (b64value(str, i + 1) << 12) | (b64value(str, i + 2) << 6) |
        b64value(str, i + 3)
      out[p++] = v >>> 16
      out[p++] = (v >>> 8) & 255
      out[p++] = v & 255
      i += 4
    }
    if (rest === 2) {
      const a = b64value(str, i)
      const b = b64value(str, i + 1)
      if ((b & 15) !== 0) throw fail('bad_base64', 'Non-zero trailing bits in base64url.')
      out[p] = (a << 2) | (b >>> 4)
    } else if (rest === 3) {
      const a = b64value(str, i)
      const b = b64value(str, i + 1)
      const c = b64value(str, i + 2)
      if ((c & 3) !== 0) throw fail('bad_base64', 'Non-zero trailing bits in base64url.')
      out[p] = (a << 2) | (b >>> 4)
      out[p + 1] = ((b & 15) << 4) | (c >>> 2)
    }
    return out
  }

  // Alan ayrımlı türetme: SHA-512(utf8(etiket) || sır).
  function labeledHash (label, secret) {
    const prefix = utf8Encode(label)
    const buf = new Uint8Array(prefix.length + secret.length)
    buf.set(prefix, 0)
    buf.set(secret, prefix.length)
    const h = lib().hash(buf)
    buf.fill(0)
    return h
  }

  function deriveKid (secret) {
    const h = labeledHash(LABEL_KID, secret)
    const kid = hex(h.subarray(0, 8))
    h.fill(0)
    return kid
  }

  function deriveEncKey (secret) {
    const h = labeledHash(LABEL_ENC, secret)
    const key = h.slice(0, KEY_BYTES)
    h.fill(0)
    return key
  }

  // Sağlama: SHA-512(utf8('telsiz-e2ee-v1/check') || sır) çıktısının ilk 10 biti, iki base32 karakteri.
  function checksumChars (secret) {
    const h = labeledHash(LABEL_CHECK, secret)
    const v = (h[0] << 2) | (h[1] >>> 6)
    h.fill(0)
    return CODE_ALPHABET[v >>> 5] + CODE_ALPHABET[v & 31]
  }

  // Bitler en anlamlıdan başlayarak 5'erli okunur, son karakterin eksik bitleri sıfırla doldurulur.
  function base32Encode (bytes) {
    let out = ''
    let buffer = 0
    let bits = 0
    let i = 0
    while (i < bytes.length) {
      buffer = (buffer << 8) | bytes[i]
      bits += 8
      while (bits >= 5) {
        bits -= 5
        out += CODE_ALPHABET[(buffer >>> bits) & 31]
      }
      buffer &= (1 << bits) - 1
      i++
    }
    if (bits > 0) out += CODE_ALPHABET[(buffer << (5 - bits)) & 31]
    return out
  }

  // 26 karakterlik veriyi 16 bayta çevirir. Dolgu bitleri sıfır değilse null döner.
  function base32DecodeSecret (vals) {
    const out = new Uint8Array(SECRET_BYTES)
    let buffer = 0
    let bits = 0
    let p = 0
    let i = 0
    while (i < CODE_DATA_CHARS) {
      buffer = (buffer << 5) | vals[i]
      bits += 5
      if (bits >= 8) {
        bits -= 8
        out[p++] = (buffer >>> bits) & 255
      }
      buffer &= (1 << bits) - 1
      i++
    }
    if (p !== SECRET_BYTES || buffer !== 0) {
      out.fill(0)
      return null
    }
    return out
  }

  function formatCode (secret) {
    const raw = base32Encode(secret) + checksumChars(secret)
    const groups = []
    let i = 0
    while (i < raw.length) {
      groups.push(raw.slice(i, i + 4))
      i += 4
    }
    return groups.join('-')
  }

  // Anahtar kodu hata kodları: empty, bad_length, bad_char, bad_padding, bad_checksum.
  // Mesaj sabittir, kullanıcının girdiği koddan hiçbir parça içermez.
  function keyError (code, detail) {
    return fail(code, 'Invalid key code: ' + detail)
  }

  function parseKeyCode (str) {
    if (typeof str !== 'string') throw keyError('empty', 'no key code was given.')
    if (str.length > MAX_CODE_INPUT) throw keyError('bad_length', 'the key code must have 28 characters.')
    let text = str
    // Davet bağlantısının tamamı yapıştırılırsa yalnızca anahtar kısmı alınır.
    const linkIndex = text.indexOf('anahtar=')
    if (linkIndex !== -1) {
      text = text.slice(linkIndex + 8)
      const amp = text.indexOf('&')
      if (amp !== -1) text = text.slice(0, amp)
    }
    const vals = []
    let i = 0
    while (i < text.length) {
      const ch = text[i]
      i++
      if (SEPARATOR_RE.test(ch)) continue
      const v = CODE_LOOKUP[ch]
      if (v === undefined) throw keyError('bad_char', 'the key code contains an invalid character.')
      vals.push(v)
      if (vals.length > CODE_CHARS) throw keyError('bad_length', 'the key code must have 28 characters.')
    }
    if (vals.length === 0) throw keyError('empty', 'no key code was given.')
    if (vals.length !== CODE_CHARS) throw keyError('bad_length', 'the key code must have 28 characters.')
    const secret = base32DecodeSecret(vals)
    if (!secret) throw keyError('bad_padding', 'the padding bits of the last data character are not zero.')
    const given = CODE_ALPHABET[vals[CODE_DATA_CHARS]] + CODE_ALPHABET[vals[CODE_DATA_CHARS + 1]]
    let expected
    try {
      expected = checksumChars(secret)
    } catch (e) {
      secret.fill(0)
      throw e
    }
    if (!sameString(expected, given)) {
      secret.fill(0)
      throw keyError('bad_checksum', 'the checksum does not match.')
    }
    return { secret: secret, code: formatCode(secret), kid: deriveKid(secret) }
  }

  function available () {
    try {
      const n = lib()
      const a = n.randomBytes(SECRET_BYTES)
      const b = n.randomBytes(SECRET_BYTES)
      if (!(a instanceof Uint8Array) || a.length !== SECRET_BYTES || b.length !== SECRET_BYTES) return false
      let same = true
      let i = 0
      while (i < SECRET_BYTES) {
        if (a[i] !== b[i]) same = false
        i++
      }
      return !same
    } catch (e) {
      return false
    }
  }

  function generateKeyCode () {
    lib()
    if (!available()) throw fail('no_random', 'No working secure random number generator is available.')
    const secret = random(SECRET_BYTES)
    const code = formatCode(secret)
    secret.fill(0)
    return code
  }

  // Anahtarlık: localStorage['telsiz.keys']. Depolama yoksa veya yazılamıyorsa bellekte tutulur.
  function emptyRing () {
    return { keys: Object.create(null), added: Object.create(null) }
  }

  function copyRing (ring) {
    const out = emptyRing()
    Object.keys(ring.keys).forEach(function (kid) {
      out.keys[kid] = ring.keys[kid]
      out.added[kid] = ring.added[kid] || 0
    })
    return out
  }

  function parseRing (raw) {
    const ring = emptyRing()
    if (typeof raw !== 'string') return ring
    let data
    try {
      data = JSON.parse(raw)
    } catch (e) {
      return ring
    }
    if (!data || typeof data !== 'object' || !data.keys || typeof data.keys !== 'object') return ring
    const added = data.added && typeof data.added === 'object' ? data.added : {}
    Object.keys(data.keys).forEach(function (kid) {
      const code = data.keys[kid]
      if (!KID_RE.test(kid) || typeof code !== 'string' || !FORMATTED_CODE_RE.test(code)) return
      const ms = Object.prototype.hasOwnProperty.call(added, kid) ? added[kid] : 0
      ring.keys[kid] = code
      ring.added[kid] = typeof ms === 'number' && isFinite(ms) && ms > 0 ? ms : 0
    })
    return ring
  }

  let ringMem = emptyRing()
  let ringRaw = null
  let storageOk = true
  const verified = Object.create(null)

  function readRing () {
    if (!storageOk) return ringMem
    let raw = null
    try {
      // localStorage yoksa (null veya undefined) getItem çağrısı da hata verir ve bellek kullanılır.
      raw = root.localStorage.getItem(RING_KEY)
    } catch (e) {
      storageOk = false
      return ringMem
    }
    if (typeof raw !== 'string') raw = null
    if (raw !== ringRaw) {
      ringMem = parseRing(raw)
      ringRaw = raw
    }
    return ringMem
  }

  function writeRing (ring) {
    ringMem = ring
    if (!storageOk) return
    const raw = JSON.stringify({ keys: ring.keys, added: ring.added })
    try {
      root.localStorage.setItem(RING_KEY, raw)
      ringRaw = raw
    } catch (e) {
      storageOk = false
    }
  }

  // kid için şifreleme anahtarı. Kayıtlı kod doğrulanır ve gerçekten bu kid'i vermelidir.
  function keyFor (kid) {
    if (typeof kid !== 'string' || !KID_RE.test(kid)) return null
    const code = readRing().keys[kid]
    if (typeof code !== 'string') return null
    const hit = verified[kid]
    if (hit && hit.code === code) return hit.key
    let parsed
    try {
      parsed = parseKeyCode(code)
    } catch (e) {
      return null
    }
    if (parsed.kid !== kid) {
      parsed.secret.fill(0)
      return null
    }
    const key = deriveEncKey(parsed.secret)
    parsed.secret.fill(0)
    verified[kid] = { code: code, key: key }
    return key
  }

  const keyring = {
    list: function () {
      const ring = readRing()
      return Object.keys(ring.keys)
        .filter(function (kid) { return keyFor(kid) !== null })
        .map(function (kid) { return { kid: kid, code: ring.keys[kid], added: ring.added[kid] || 0 } })
        .sort(function (a, b) { return a.added - b.added || (a.kid < b.kid ? -1 : a.kid > b.kid ? 1 : 0) })
    },
    add: function (code) {
      const parsed = parseKeyCode(code)
      parsed.secret.fill(0)
      const ring = copyRing(readRing())
      const previous = ring.keys[parsed.kid]
      ring.keys[parsed.kid] = parsed.code
      if (previous !== parsed.code || !ring.added[parsed.kid]) ring.added[parsed.kid] = Date.now()
      writeRing(ring)
      return parsed.kid
    },
    has: function (kid) {
      return keyFor(kid) !== null
    },
    remove: function (kid) {
      if (typeof kid !== 'string') return
      const ring = copyRing(readRing())
      delete ring.keys[kid]
      delete ring.added[kid]
      delete verified[kid]
      writeRing(ring)
    }
  }

  // Zarf: '1.' + kid + '.' + b64url(nonce24) + '.' + b64url(secretbox(düz metin, nonce, encKey)).
  function sealJson (kid, obj) {
    if (obj === null || typeof obj !== 'object') throw fail('bad_type', 'The value to seal must be an object.', TypeError)
    const n = lib()
    const key = keyFor(kid)
    if (!key) throw fail('no_key', 'The key is not in the keyring.')
    const json = JSON.stringify(obj)
    const nonce = random(NONCE_BYTES)
    const box = n.secretbox(utf8Encode(json), nonce, key)
    const envelope = '1.' + kid + '.' + b64encode(nonce) + '.' + b64encode(box)
    if (!ENVELOPE_RE.test(envelope)) throw fail('seal_failed', 'The envelope could not be built.')
    return envelope
  }

  function failure (reason) {
    return { ok: false, reason: reason }
  }

  function openJson (envelope) {
    if (typeof envelope !== 'string') return failure('bad_format')
    const m = ENVELOPE_RE.exec(envelope)
    if (!m) return failure('bad_format')
    let nonce
    let box
    try {
      nonce = b64decode(m[2])
      box = b64decode(m[3])
    } catch (e) {
      return failure('bad_format')
    }
    if (nonce.length !== NONCE_BYTES) return failure('bad_format')
    const key = keyFor(m[1])
    if (!key) return failure('no_key')
    let value
    try {
      const plain = lib().secretbox.open(box, nonce, key)
      if (!plain) return failure('bad_data')
      value = JSON.parse(utf8Decode(plain))
    } catch (e) {
      return failure('bad_data')
    }
    return { ok: true, kid: m[1], value: value }
  }

  // Her dosya kendi rastgele anahtarı ve nonce'u ile şifrelenir.
  function encryptFile (bytes) {
    const data = asBytes(bytes)
    const n = lib()
    const key = random(KEY_BYTES)
    const nonce = random(NONCE_BYTES)
    const box = tight(n.secretbox(data, nonce, key))
    const result = { box: box, key: b64encode(key), nonce: b64encode(nonce) }
    key.fill(0)
    return result
  }

  function decryptFile (box, keyB64, nonceB64) {
    try {
      const key = b64decode(keyB64)
      const nonce = b64decode(nonceB64)
      if (key.length !== KEY_BYTES || nonce.length !== NONCE_BYTES) return null
      const plain = lib().secretbox.open(asBytes(box), nonce, key)
      key.fill(0)
      return plain ? tight(plain) : null
    } catch (e) {
      return null
    }
  }

  function startsWith (bytes, sig) {
    if (bytes.length < sig.length) return false
    let i = 0
    while (i < sig.length) {
      if (bytes[i] !== sig[i]) return false
      i++
    }
    return true
  }

  const SIG_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const SIG_JPEG = [0xff, 0xd8, 0xff]
  const SIG_GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]
  const SIG_GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61]
  const SIG_RIFF = [0x52, 0x49, 0x46, 0x46]
  const SIG_WEBP = [0x57, 0x45, 0x42, 0x50]

  function sniffImage (input) {
    let b
    try {
      b = asBytes(input)
    } catch (e) {
      return null
    }
    if (startsWith(b, SIG_PNG)) return 'image/png'
    if (startsWith(b, SIG_JPEG)) return 'image/jpeg'
    if (startsWith(b, SIG_GIF87) || startsWith(b, SIG_GIF89)) return 'image/gif'
    if (b.length >= 12 && startsWith(b, SIG_RIFF) && startsWith(b.subarray(8, 12), SIG_WEBP)) return 'image/webp'
    return null
  }

  // Dosya adı temizliği. Bidi ve biçim karakterleri, yol ve Windows'ta yasak karakterler silinir.
  // Baştaki ve sondaki nokta/boşluklar kırpılır (Windows sondakileri sessizce attığından uzantı gizlenemesin).
  // Sonuç boş kalırsa çağıranın verdiği yedek ad (arayüz dilindeki karşılık) aynı temizlikten geçirilip
  // kullanılır. Yedek verilmezse veya o da boş kalırsa 'file' döner.
  function sanitizeFileName (str, fallback) {
    const name = typeof str === 'string' ? cleanFileName(str) : ''
    if (name.length > 0) return name
    const alt = typeof fallback === 'string' ? cleanFileName(fallback) : ''
    return alt.length > 0 ? alt : DEFAULT_FILE_NAME
  }

  // Temizlenmiş adı döner, hiçbir şey kalmazsa boş dize.
  function cleanFileName (str) {
    let name = str
    try {
      name = name.normalize('NFC')
    } catch (e) {
      name = str
    }
    name = trimFileNameEdges(name.replace(FILE_NAME_STRIP_RE, ''))
    let cps = Array.from(name).map(function (ch) {
      const c = ch.charCodeAt(0)
      return ch.length === 1 && c >= 0xd800 && c <= 0xdfff ? '\ufffd' : ch
    })
    if (cps.length > MAX_FILE_NAME) {
      const dot = cps.lastIndexOf('.')
      const extLen = dot > 0 ? cps.length - dot : 0
      if (extLen >= 2 && extLen <= MAX_FILE_EXT + 1) {
        cps = cps.slice(0, MAX_FILE_NAME - extLen).concat(cps.slice(dot))
      } else {
        cps = cps.slice(0, MAX_FILE_NAME)
      }
    }
    return trimFileNameEdges(cps.join(''))
  }

  // Doğrusal zamanda kırpar. \s'nin bütün karakterleri tek UTF-16 birimidir.
  function trimFileNameEdges (name) {
    let start = 0
    let end = name.length
    while (start < end && FILE_NAME_EDGE_CHAR_RE.test(name.charAt(start))) start += 1
    while (end > start && FILE_NAME_EDGE_CHAR_RE.test(name.charAt(end - 1))) end -= 1
    return name.slice(start, end)
  }

  // ===== Ek F: parola türetme, kimlik anahtarları, özel mesajlar ve sabitleme =====

  // Özel mesajlar için nacl.box parçaları (box.after ve box.open.after secretbox ile aynıdır).
  function boxLib () {
    const n = lib()
    const b = n.box
    if (!b || typeof b.before !== 'function' || typeof b.after !== 'function' || !b.open ||
        typeof b.open.after !== 'function' || typeof b.keyPair !== 'function' ||
        typeof b.keyPair.fromSecretKey !== 'function') {
      throw fail('no_library', 'Encryption library (nacl.box) is not available.')
    }
    return n
  }

  function scryptLib () {
    const s = root.scrypt
    if (!s || typeof s.scrypt !== 'function') {
      throw fail('no_library', 'Key derivation library (scrypt) is not available.')
    }
    return s
  }

  // Sabit zamanlı bayt karşılaştırması.
  function sameBytes (a, b) {
    if (a.length !== b.length) return false
    let diff = 0
    let i = 0
    while (i < a.length) {
      diff |= a[i] ^ b[i]
      i++
    }
    return diff === 0
  }

  // Kullanıcı kimliği: pozitif güvenli tamsayı veya onun kanonik ondalık yazımı. Kanonik metin, geçersizse null.
  function userIdText (value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? String(value) : null
    if (typeof value === 'string' && USER_ID_RE.test(value) && Number.isSafeInteger(Number(value))) return value
    return null
  }

  // Açık anahtar: dolgusuz kanonik base64url, 32 bayt (43 karakter). Baytlar, geçersizse null.
  function publicKeyBytes (value) {
    if (typeof value !== 'string' || !PUBLIC_KEY_RE.test(value)) return null
    try {
      const bytes = b64decode(value)
      return bytes.length === BOX_KEY_BYTES ? bytes : null
    } catch (e) {
      return null
    }
  }

  // Gizli anahtar veya sarma anahtarı: 32 baytlık Uint8Array (veya ArrayBuffer görünümü). Geçersizse null.
  function keyBytes (value) {
    let bytes
    try {
      bytes = asBytes(value)
    } catch (e) {
      return null
    }
    return bytes.length === BOX_KEY_BYTES ? bytes : null
  }

  // Gizli anahtardan hesaplanan açık anahtar verilen açık anahtarla aynı mı.
  function keyPairMatches (publicKey, secretKey) {
    const expected = publicKeyBytes(publicKey)
    if (!expected) return false
    const pair = boxLib().box.keyPair.fromSecretKey(secretKey)
    const ok = sameBytes(pair.publicKey, expected)
    pair.secretKey.fill(0)
    return ok
  }

  // Ek F2: yalnızca N 16384/32768/65536, r 8, p 1 ve 16 baytlık tuz kabul edilir.
  // Her alan bir kez okunur. Sonuç { salt: baytlar, N }, geçersizse null.
  function kdfParams (kdf) {
    if (!kdf || typeof kdf !== 'object' || Array.isArray(kdf)) return null
    const n = kdf.N
    const text = kdf.salt
    if (KDF_N_VALUES.indexOf(n) === -1 || kdf.r !== KDF_R || kdf.p !== KDF_P) return null
    if (typeof text !== 'string' || text.length !== 22) return null
    try {
      const salt = b64decode(text)
      return salt.length === KDF_SALT_BYTES ? { salt: salt, N: n } : null
    } catch (e) {
      return null
    }
  }

  function kdfNewParams () {
    lib()
    if (!available()) throw fail('no_random', 'No working secure random number generator is available.')
    return { salt: b64encode(random(KDF_SALT_BYTES)), N: KDF_DEFAULT_N, r: KDF_R, p: KDF_P }
  }

  // master = scrypt(utf8(NFC(parola)), tuz, N, 8, 1, 32)
  // authKey = hex(SHA-512(utf8('telsiz-auth-v1') || master) ilk 32 bayt), sunucuya gider
  // wrapKey = SHA-512(utf8('telsiz-wrap-v1') || master) ilk 32 bayt, cihazda kalır
  // onProgress(oran) 0..1 arası çağrılır. Hata fırlatması veya dönüş değeri türetmeyi etkilemez.
  function kdfDerive (password, kdf, onProgress) {
    let pw = null
    let master = null
    return new Promise(function (resolve) {
      if (typeof password !== 'string') throw fail('bad_type', 'The password must be a string.', TypeError)
      const params = kdfParams(kdf)
      if (!params) throw fail('bad_kdf', 'Unsupported key derivation parameters.')
      lib()
      const s = scryptLib()
      let normalized
      try {
        normalized = password.normalize('NFC')
      } catch (e) {
        throw fail('unsupported', 'Unicode normalization is not available.')
      }
      pw = utf8Encode(normalized)
      const progress = function (value) {
        if (typeof onProgress !== 'function') return
        try {
          onProgress(value)
        } catch (e) {
          // Arayüzdeki ilerleme hatası türetmeyi durdurmaz.
        }
      }
      resolve(s.scrypt(pw, params.salt, params.N, KDF_R, KDF_P, BOX_KEY_BYTES, progress))
    }).then(function (out) {
      try {
        master = asBytes(out)
      } catch (e) {
        throw fail('kdf_failed', 'Key derivation failed.')
      }
      if (master.length !== BOX_KEY_BYTES) throw fail('kdf_failed', 'Key derivation failed.')
      const auth = labeledHash(KDF_LABEL_AUTH, master)
      const wrap = labeledHash(KDF_LABEL_WRAP, master)
      const result = { authKey: hex(auth.subarray(0, BOX_KEY_BYTES)), wrapKey: wrap.slice(0, BOX_KEY_BYTES) }
      auth.fill(0)
      wrap.fill(0)
      return result
    }).then(function (result) {
      if (pw) pw.fill(0)
      if (master) master.fill(0)
      return result
    }, function (err) {
      if (pw) pw.fill(0)
      if (master) master.fill(0)
      if (err && typeof err.code === 'string') throw err
      throw fail('kdf_failed', 'Key derivation failed.')
    })
  }

  // ----- Kimlik anahtarı (X25519) -----

  function identityGenerate () {
    const n = boxLib()
    if (!available()) throw fail('no_random', 'No working secure random number generator is available.')
    let pair
    try {
      pair = n.box.keyPair()
    } catch (e) {
      throw fail('no_random', 'No secure random number generator is available.')
    }
    return { publicKey: b64encode(pair.publicKey), secretKey: tight(pair.secretKey) }
  }

  // '1w.' + b64url(nonce24) + '.' + b64url(secretbox(gizli anahtar, nonce, wrapKey))
  function identityWrap (secretKey, wrapKey) {
    const n = lib()
    const sk = keyBytes(secretKey)
    if (!sk) throw fail('bad_key', 'The secret key must have 32 bytes.')
    const wk = keyBytes(wrapKey)
    if (!wk) throw fail('bad_key', 'The wrapping key must have 32 bytes.')
    const nonce = random(NONCE_BYTES)
    const wrapped = '1w.' + b64encode(nonce) + '.' + b64encode(n.secretbox(sk, nonce, wk))
    if (!WRAPPED_RE.test(wrapped)) throw fail('seal_failed', 'The wrapped key could not be built.')
    return wrapped
  }

  // Açılamazsa null döner, hata fırlatmaz. publicKey verilirse açılan gizli anahtarın ona ait olduğu da denetlenir.
  function identityUnwrap (wrapped, wrapKey, publicKey) {
    try {
      if (typeof wrapped !== 'string') return null
      const m = WRAPPED_RE.exec(wrapped)
      const wk = keyBytes(wrapKey)
      if (!m || !wk) return null
      const nonce = b64decode(m[1])
      const box = b64decode(m[2])
      if (nonce.length !== NONCE_BYTES || box.length !== BOX_KEY_BYTES + MAC_BYTES) return null
      const plain = lib().secretbox.open(box, nonce, wk)
      if (!plain || plain.length !== BOX_KEY_BYTES) return null
      const sk = tight(plain)
      if (publicKey !== undefined && publicKey !== null && !keyPairMatches(publicKey, sk)) {
        sk.fill(0)
        return null
      }
      return sk
    } catch (e) {
      return null
    }
  }

  // Kimlik ve sabitleme kayıtları için depolama: localStorage, erişilemez veya yazılamazsa bellek.
  // Bellekteki kayıt (yazılamamış değer veya silinmiş işareti olarak null) depolamadakinden önce gelir.
  const memStore = Object.create(null)

  function storeGet (key) {
    if (key in memStore) return memStore[key]
    try {
      const raw = root.localStorage.getItem(key)
      return typeof raw === 'string' ? raw : null
    } catch (e) {
      return null
    }
  }

  function storeSet (key, raw) {
    memStore[key] = raw
    try {
      root.localStorage.setItem(key, raw)
      delete memStore[key]
      return true
    } catch (e) {
      return false
    }
  }

  function storeRemove (key) {
    memStore[key] = null
    try {
      root.localStorage.removeItem(key)
      delete memStore[key]
    } catch (e) {
      // Silinemeyen kayıt bu oturumda silinmiş sayılır.
    }
  }

  // localStorage['telsiz.identity.<userId>'] = { publicKey, secretKey } (b64url). Kalıcı yazıldıysa true döner.
  function identitySave (userId, keys) {
    const id = userIdText(userId)
    if (!id) throw fail('bad_user', 'Invalid user id.')
    const sk = keys && typeof keys === 'object' ? keyBytes(keys.secretKey) : null
    if (!sk || !keyPairMatches(keys.publicKey, sk)) throw fail('bad_key', 'The key pair is invalid.')
    return storeSet(IDENTITY_PREFIX + id, JSON.stringify({ publicKey: keys.publicKey, secretKey: b64encode(sk) }))
  }

  function identityLoad (userId) {
    const id = userIdText(userId)
    if (!id) return null
    const raw = storeGet(IDENTITY_PREFIX + id)
    if (typeof raw !== 'string') return null
    try {
      const data = JSON.parse(raw)
      if (!data || typeof data !== 'object' || typeof data.secretKey !== 'string') return null
      const sk = b64decode(data.secretKey)
      if (sk.length !== BOX_KEY_BYTES || !keyPairMatches(data.publicKey, sk)) {
        sk.fill(0)
        return null
      }
      return { publicKey: data.publicKey, secretKey: sk }
    } catch (e) {
      return null
    }
  }

  // Çıkışta çağrılır: kayıt silinir ve özel mesaj ortak anahtar önbelleği sıfırlanır.
  function identityClear (userId) {
    const id = userIdText(userId)
    if (id) storeRemove(IDENTITY_PREFIX + id)
    clearDmCache()
  }

  // Ek F3: kimlik bağlama zarfı, grup anahtarıyla { v: 1, u: userId, pk: publicKey }.
  function sealBinding (kid, userId, publicKey) {
    const id = userIdText(userId)
    if (!id) throw fail('bad_user', 'Invalid user id.')
    if (!publicKeyBytes(publicKey)) throw fail('bad_key', 'Invalid public key.')
    return sealJson(kid, { v: 1, u: Number(id), pk: publicKey })
  }

  // Sonuç: { ok: true, kid } veya { ok: false, reason }. reason: bad_format, no_key, bad_data (zarf),
  // bad_value (içerik biçimi), wrong_user (u başka kişi), wrong_key (pk sunucudaki açık anahtar değil).
  function verifyBinding (envelope, userId, publicKey) {
    const opened = openJson(envelope)
    if (!opened.ok) return failure(opened.reason)
    const value = opened.value
    if (!value || typeof value !== 'object' || value.v !== 1 || typeof value.u !== 'number' ||
        typeof value.pk !== 'string') return failure('bad_value')
    const id = userIdText(userId)
    if (!id || userIdText(value.u) !== id) return failure('wrong_user')
    if (!publicKeyBytes(publicKey) || !sameString(value.pk, publicKey)) return failure('wrong_key')
    return { ok: true, kid: opened.kid }
  }

  // ----- Özel mesajlar (Ek F5.6) -----

  // box.before sonuçları için sınırlı (LRU) önbellek. Anahtar, karşı açık anahtar ile gizli anahtarın etiketli
  // SHA-512 özetidir, gizli anahtarın kendisi saklanmaz. Ortak anahtarlar dışarı verilmez.
  const dmCache = new Map()
  let weakShared = null

  function clearDmCache () {
    dmCache.forEach(function (key) {
      key.fill(0)
    })
    dmCache.clear()
  }

  // Düşük mertebeli bir açık anahtarla X25519 sonucu sıfırdır ve box.before herkesçe bilinen sabit bir
  // anahtar verir. Bu sabit sıfır açık anahtarla bir kez hesaplanır, böyle anahtarlar reddedilir.
  function weakKey (n) {
    if (!weakShared) {
      const sk = new Uint8Array(BOX_KEY_BYTES)
      sk[0] = 1
      weakShared = n.box.before(new Uint8Array(BOX_KEY_BYTES), sk)
    }
    return weakShared
  }

  // Ortak anahtar veya kullanılamaz (düşük mertebeli) açık anahtarda null.
  function sharedKey (theirPk, mySk) {
    const n = boxLib()
    const buf = new Uint8Array(BOX_KEY_BYTES * 2)
    buf.set(theirPk, 0)
    buf.set(mySk, BOX_KEY_BYTES)
    const h = labeledHash(DM_CACHE_LABEL, buf)
    buf.fill(0)
    const id = hex(h.subarray(0, BOX_KEY_BYTES))
    h.fill(0)
    const hit = dmCache.get(id)
    if (hit) {
      dmCache.delete(id)
      dmCache.set(id, hit)
      return hit
    }
    const key = n.box.before(theirPk, mySk)
    if (sameBytes(key, weakKey(n))) {
      key.fill(0)
      return null
    }
    dmCache.set(id, key)
    if (dmCache.size > DM_CACHE_MAX) {
      const oldest = dmCache.keys().next().value
      dmCache.get(oldest).fill(0)
      dmCache.delete(oldest)
    }
    return key
  }

  // '2.' + b64url(nonce24) + '.' + b64url(box.after(düz metin, nonce, box.before(karşıPk, benimSk)))
  function dmSeal (obj, theirPublicKey, mySecretKey) {
    if (obj === null || typeof obj !== 'object') throw fail('bad_type', 'The value to seal must be an object.', TypeError)
    const n = boxLib()
    const pk = publicKeyBytes(theirPublicKey)
    if (!pk) throw fail('bad_key', 'Invalid public key.')
    const sk = keyBytes(mySecretKey)
    if (!sk) throw fail('bad_key', 'The secret key must have 32 bytes.')
    const key = sharedKey(pk, sk)
    if (!key) throw fail('bad_key', 'The public key cannot be used.')
    const nonce = random(NONCE_BYTES)
    const box = n.box.after(utf8Encode(JSON.stringify(obj)), nonce, key)
    const envelope = '2.' + b64encode(nonce) + '.' + b64encode(box)
    if (!DM_ENVELOPE_RE.test(envelope)) throw fail('seal_failed', 'The envelope could not be built.')
    return envelope
  }

  // Adaylar sırayla (karşı tarafın en yeni anahtarından eskiye) denenir. Sonuç: { ok: true, value, pk } veya
  // { ok: false, reason }: bad_format (biçim), no_key (hiçbir aday açamadı), bad_data (açıldı ama JSON değil).
  function dmOpen (envelope, candidatePublicKeys, mySecretKey) {
    if (typeof envelope !== 'string') return failure('bad_format')
    const m = DM_ENVELOPE_RE.exec(envelope)
    if (!m) return failure('bad_format')
    let nonce
    let box
    try {
      nonce = b64decode(m[1])
      box = b64decode(m[2])
    } catch (e) {
      return failure('bad_format')
    }
    if (nonce.length !== NONCE_BYTES) return failure('bad_format')
    const list = typeof candidatePublicKeys === 'string' ? [candidatePublicKeys] : candidatePublicKeys
    const sk = keyBytes(mySecretKey)
    if (!Array.isArray(list) || !sk) return failure('no_key')
    let n
    try {
      n = boxLib()
    } catch (e) {
      return failure('no_key')
    }
    const tried = Object.create(null)
    let i = 0
    while (i < list.length && i < DM_MAX_CANDIDATES) {
      const candidate = list[i]
      i++
      const pk = publicKeyBytes(candidate)
      if (!pk || tried[candidate]) continue
      tried[candidate] = true
      const key = sharedKey(pk, sk)
      const plain = key ? n.box.open.after(box, nonce, key) : null
      if (!plain) continue
      let value
      try {
        value = JSON.parse(utf8Decode(plain))
      } catch (e) {
        return failure('bad_data')
      }
      return { ok: true, value: value, pk: candidate }
    }
    return failure('no_key')
  }

  // ----- Güvenlik numarası ve parmak izi (Ek F3.5, F3.6) -----

  // Kimliğin 8 baytlık büyük endian gösterimi.
  function idBytes (text) {
    const out = new Uint8Array(8)
    let v = Number(text)
    let i = 7
    while (i >= 0) {
      out[i] = v % 256
      v = Math.floor(v / 256)
      i--
    }
    return out
  }

  function safetyParty (userId, publicKey) {
    const id = userIdText(userId)
    if (!id) throw fail('bad_user', 'Invalid user id.')
    const pk = publicKeyBytes(publicKey)
    if (!pk) throw fail('bad_key', 'Invalid public key.')
    return { num: Number(id), id: idBytes(id), pk: pk }
  }

  function compareBytes (a, b) {
    let i = 0
    while (i < a.length) {
      if (a[i] !== b[i]) return a[i] - b[i]
      i++
    }
    return 0
  }

  // (id, pk) çiftleri id'ye göre sıralanır: SHA-512(utf8('telsiz-safety-v1') || id1 || pk1 || id2 || pk2).
  // İlk 60 baytın her 5 baytı (büyük endian) 100000 moduyla 5 rakam verir, 12 grup boşlukla ayrılır.
  function safetyNumber (idA, pkA, idB, pkB) {
    const a = safetyParty(idA, pkA)
    const b = safetyParty(idB, pkB)
    const aFirst = a.num !== b.num ? a.num < b.num : compareBytes(a.pk, b.pk) <= 0
    const first = aFirst ? a : b
    const second = aFirst ? b : a
    const data = new Uint8Array(80)
    data.set(first.id, 0)
    data.set(first.pk, 8)
    data.set(second.id, 40)
    data.set(second.pk, 48)
    const h = labeledHash(SAFETY_LABEL, data)
    const groups = []
    let g = 0
    while (g < SAFETY_GROUPS) {
      const o = g * 5
      const v = h[o] * 4294967296 + ((h[o + 1] << 24) >>> 0) + (h[o + 2] << 16) + (h[o + 3] << 8) + h[o + 4]
      groups.push(String(v % 100000).padStart(5, '0'))
      g++
    }
    return groups.join(' ')
  }

  // Açık anahtarın SHA-512 özetinin ilk 10 baytı: 20 hex, 4'lü gruplar boşlukla ayrılır.
  function fingerprint (publicKey) {
    const pk = publicKeyBytes(publicKey)
    if (!pk) throw fail('bad_key', 'Invalid public key.')
    const text = hex(lib().hash(pk).subarray(0, FINGERPRINT_BYTES))
    const groups = []
    let i = 0
    while (i < text.length) {
      groups.push(text.slice(i, i + 4))
      i += 4
    }
    return groups.join(' ')
  }

  // ----- İlk görüşte sabitleme (Ek F3.4) -----
  // localStorage['telsiz.pins.<benimId>'] = { "<userId>": { keys: [{ pk, firstSeen }], verified, changed } }
  // keys en yeniden eskiye sıralıdır. changed, anahtar değiştiğinde true olur ve kullanıcı kabul edene kadar kalır.

  function cleanPin (rec) {
    if (!rec || typeof rec !== 'object' || !Array.isArray(rec.keys)) return null
    const keys = []
    const seen = Object.create(null)
    rec.keys.forEach(function (k) {
      if (keys.length >= PIN_KEYS_MAX || !k || typeof k !== 'object' || !publicKeyBytes(k.pk) || seen[k.pk]) return
      seen[k.pk] = true
      const t = k.firstSeen
      keys.push({ pk: k.pk, firstSeen: typeof t === 'number' && isFinite(t) && t > 0 ? t : 0 })
    })
    if (keys.length === 0) return null
    const changed = rec.changed === true
    return { keys: keys, verified: rec.verified === true && !changed, changed: changed }
  }

  function readPins (myText) {
    const pins = Object.create(null)
    const raw = storeGet(PINS_PREFIX + myText)
    if (typeof raw !== 'string') return pins
    let data
    try {
      data = JSON.parse(raw)
    } catch (e) {
      return pins
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return pins
    Object.keys(data).forEach(function (uid) {
      const rec = userIdText(uid) === uid ? cleanPin(data[uid]) : null
      if (rec) pins[uid] = rec
    })
    return pins
  }

  function pinsContext (myId, userId) {
    const my = userIdText(myId)
    const uid = userIdText(userId)
    if (!my || !uid) throw fail('bad_user', 'Invalid user id.')
    const pins = readPins(my)
    return { my: my, uid: uid, pins: pins, rec: pins[uid] || null }
  }

  function writePins (ctx) {
    storeSet(PINS_PREFIX + ctx.my, JSON.stringify(ctx.pins))
  }

  function pinKeys (rec) {
    return rec.keys.map(function (k) {
      return k.pk
    })
  }

  function pinView (rec) {
    return {
      status: rec.changed ? 'changed' : 'same',
      verified: rec.verified,
      keys: pinKeys(rec),
      entries: rec.keys.map(function (k) {
        return { pk: k.pk, firstSeen: k.firstSeen }
      })
    }
  }

  // Sonuç: { status: 'new'|'same'|'changed', verified, keys: [pk, ...] (en yeni önce) }.
  // İlk anahtar kendiliğinden sabitlenir. Farklı (yeni veya daha önce görülmüş eski) bir anahtar en başa alınır,
  // verified false olur ve durum accept çağrılana kadar 'changed' kalır.
  function pinsObserve (myId, userId, publicKey) {
    const ctx = pinsContext(myId, userId)
    if (!publicKeyBytes(publicKey)) throw fail('bad_key', 'Invalid public key.')
    let rec = ctx.rec
    let status
    if (!rec) {
      rec = { keys: [{ pk: publicKey, firstSeen: Date.now() }], verified: false, changed: false }
      ctx.pins[ctx.uid] = rec
      writePins(ctx)
      status = 'new'
    } else if (rec.keys[0].pk === publicKey) {
      status = rec.changed ? 'changed' : 'same'
    } else {
      const old = rec.keys.filter(function (k) {
        return k.pk === publicKey
      })[0]
      const rest = rec.keys.filter(function (k) {
        return k.pk !== publicKey
      })
      rec.keys = [{ pk: publicKey, firstSeen: old ? old.firstSeen : Date.now() }].concat(rest).slice(0, PIN_KEYS_MAX)
      rec.verified = false
      rec.changed = true
      writePins(ctx)
      status = 'changed'
    }
    return { status: status, verified: rec.verified, keys: pinKeys(rec) }
  }

  // Kullanıcı yeni anahtarı kabul etti: 'changed' durumu kalkar, verified false kalır.
  function pinsAccept (myId, userId) {
    const ctx = pinsContext(myId, userId)
    if (!ctx.rec) return null
    if (ctx.rec.changed) {
      ctx.rec.changed = false
      writePins(ctx)
    }
    return pinView(ctx.rec)
  }

  // Güvenlik numarası karşılaştırıldı: doğrulama mevcut anahtar içindir, true olunca bekleyen değişiklik de kabul edilir.
  function pinsSetVerified (myId, userId, value) {
    const ctx = pinsContext(myId, userId)
    if (!ctx.rec) return null
    ctx.rec.verified = value === true
    if (ctx.rec.verified) ctx.rec.changed = false
    writePins(ctx)
    return pinView(ctx.rec)
  }

  function pinsKnownKeys (myId, userId) {
    const ctx = pinsContext(myId, userId)
    return ctx.rec ? pinKeys(ctx.rec) : []
  }

  function pinsGet (myId, userId) {
    const ctx = pinsContext(myId, userId)
    return ctx.rec ? pinView(ctx.rec) : null
  }

  return Object.freeze({
    available: available,
    generateKeyCode: generateKeyCode,
    parseKeyCode: parseKeyCode,
    keyring: Object.freeze(keyring),
    sealJson: sealJson,
    openJson: openJson,
    encryptFile: encryptFile,
    decryptFile: decryptFile,
    sniffImage: sniffImage,
    sanitizeFileName: sanitizeFileName,
    b64url: Object.freeze({ encode: b64encode, decode: b64decode }),
    utf8: Object.freeze({ encode: utf8Encode, decode: utf8Decode }),
    kdf: Object.freeze({ newParams: kdfNewParams, derive: kdfDerive }),
    identity: Object.freeze({
      generate: identityGenerate,
      wrap: identityWrap,
      unwrap: identityUnwrap,
      save: identitySave,
      load: identityLoad,
      clear: identityClear,
      sealBinding: sealBinding,
      verifyBinding: verifyBinding
    }),
    dm: Object.freeze({ seal: dmSeal, open: dmOpen }),
    safetyNumber: safetyNumber,
    fingerprint: fingerprint,
    pins: Object.freeze({
      observe: pinsObserve,
      accept: pinsAccept,
      setVerified: pinsSetVerified,
      knownKeys: pinsKnownKeys,
      get: pinsGet
    })
  })
})(typeof self !== 'undefined' ? self : this)
