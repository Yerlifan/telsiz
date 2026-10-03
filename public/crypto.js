'use strict'

// Uçtan uca şifreleme yardımcıları (window.E2EE).
// Kriptografik ilkel olarak yalnızca TweetNaCl-js kullanılır: nacl.secretbox (XSalsa20-Poly1305),
// nacl.hash (SHA-512) ve nacl.randomBytes. Bu dosyada kodlama, biçim ve anahtarlık işleri vardır.
// Anahtarlar ve düz metinler hiçbir zaman loglanmaz ve ağa gönderilmez.

var E2EE = (function (root) {
  const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
  const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
  const SECRET_BYTES = 16
  const CODE_DATA_CHARS = 26
  const CODE_CHARS = 28
  const KEY_BYTES = 32
  const NONCE_BYTES = 24
  const RING_KEY = 'sohbet.keys'
  const LABEL_CHECK = 'sohbet-e2ee-v1/check'
  const LABEL_ENC = 'sohbet-e2ee-v1/enc'
  const LABEL_KID = 'sohbet-e2ee-v1/kid'
  const KID_RE = /^[0-9a-f]{16}$/
  const ENVELOPE_RE = /^1\.([0-9a-f]{16})\.([A-Za-z0-9_-]{32})\.([A-Za-z0-9_-]{24,})$/
  const FORMATTED_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){6}$/
  const SEPARATOR_RE = /^[\s\-\u2010-\u2015\u2212]$/
  const MAX_CODE_INPUT = 2048
  const MAX_FILE_NAME = 120
  const MAX_FILE_EXT = 20
  const FILE_NAME_STRIP_RE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff\/\\:*?"<>|]/g
  const FILE_NAME_EDGE_RE = /^[.\s]+|[.\s]+$/g
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
    map['\u0131'] = 1
    map['\u0130'] = 1
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

  function lib () {
    if (naclRef) return naclRef
    const n = root.nacl
    if (!n || typeof n.secretbox !== 'function' || typeof n.secretbox.open !== 'function' ||
        typeof n.hash !== 'function' || typeof n.randomBytes !== 'function') {
      throw new Error('Şifreleme kütüphanesi yüklenemedi.')
    }
    naclRef = n
    return n
  }

  // Bayt girdisini bu ortamın Uint8Array görünümüne çevirir (kopyalamadan).
  function asBytes (x) {
    if (x instanceof Uint8Array) return x
    if (x instanceof ArrayBuffer || toStr.call(x) === '[object ArrayBuffer]') return new Uint8Array(x)
    if (x && ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength)
    throw new TypeError('Bayt dizisi (Uint8Array veya ArrayBuffer) bekleniyor.')
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
  const PROBE_TEXT = '\u015f\ud83d\ude00'
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
    if (typeof str !== 'string') throw new TypeError('Metin bekleniyor.')
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
    if (v < 0) throw new Error('Geçersiz base64url karakteri.')
    return v
  }

  function b64decode (str) {
    if (typeof str !== 'string') throw new TypeError('base64url metni bekleniyor.')
    const n = str.length
    const rest = n % 4
    if (rest === 1) throw new Error('Geçersiz base64url uzunluğu.')
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
      if ((b & 15) !== 0) throw new Error('Geçersiz base64url sonu.')
      out[p] = (a << 2) | (b >>> 4)
    } else if (rest === 3) {
      const a = b64value(str, i)
      const b = b64value(str, i + 1)
      const c = b64value(str, i + 2)
      if ((c & 3) !== 0) throw new Error('Geçersiz base64url sonu.')
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

  // Sağlama: SHA-512(utf8('sohbet-e2ee-v1/check') || sır) çıktısının ilk 10 biti, iki base32 karakteri.
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

  function keyError (detail) {
    return new Error('Anahtar hatalı. ' + detail)
  }

  function parseKeyCode (str) {
    if (typeof str !== 'string' || str.length > MAX_CODE_INPUT) {
      throw keyError('Lütfen 28 karakterlik anahtar kodunu girin.')
    }
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
      if (v === undefined) throw keyError('Kodda geçersiz bir karakter var.')
      vals.push(v)
      if (vals.length > CODE_CHARS) throw keyError('Kod 28 karakterden oluşmalı.')
    }
    if (vals.length === 0) throw keyError('Lütfen 28 karakterlik anahtar kodunu girin.')
    if (vals.length !== CODE_CHARS) throw keyError('Kod 28 karakterden oluşmalı.')
    const secret = base32DecodeSecret(vals)
    if (!secret) throw keyError('Kodda yazım hatası var, lütfen kontrol edin.')
    const given = CODE_ALPHABET[vals[CODE_DATA_CHARS]] + CODE_ALPHABET[vals[CODE_DATA_CHARS + 1]]
    if (!sameString(checksumChars(secret), given)) {
      secret.fill(0)
      throw keyError('Kodda yazım hatası var, lütfen kontrol edin.')
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
    if (!available()) throw new Error('Bu tarayıcıda güvenli rastgele sayı üreteci yok.')
    const secret = lib().randomBytes(SECRET_BYTES)
    const code = formatCode(secret)
    secret.fill(0)
    return code
  }

  // Anahtarlık: localStorage['sohbet.keys']. Depolama yoksa veya yazılamıyorsa bellekte tutulur.
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
      const ls = root.localStorage
      if (!ls) throw new Error('Depolama yok.')
      raw = ls.getItem(RING_KEY)
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
    if (obj === null || typeof obj !== 'object') throw new TypeError('Şifrelenecek değer bir nesne olmalı.')
    const key = keyFor(kid)
    if (!key) throw new Error('Bu şifreleme anahtarı anahtarlıkta yok.')
    const json = JSON.stringify(obj)
    const n = lib()
    const nonce = n.randomBytes(NONCE_BYTES)
    const box = n.secretbox(utf8Encode(json), nonce, key)
    const envelope = '1.' + kid + '.' + b64encode(nonce) + '.' + b64encode(box)
    if (!ENVELOPE_RE.test(envelope)) throw new Error('Zarf oluşturulamadı.')
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
    const key = n.randomBytes(KEY_BYTES)
    const nonce = n.randomBytes(NONCE_BYTES)
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

  // Dosya adı temizliği (Ek A1). Bidi ve biçim karakterleri, yol ve Windows'ta yasak karakterler silinir.
  // Baştaki ve sondaki nokta/boşluklar kırpılır (Windows sondakileri sessizce attığından uzantı gizlenemesin).
  function sanitizeFileName (str) {
    if (typeof str !== 'string') return 'dosya'
    let name = str
    try {
      name = name.normalize('NFC')
    } catch (e) {
      name = str
    }
    name = name.replace(FILE_NAME_STRIP_RE, '').replace(FILE_NAME_EDGE_RE, '')
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
    name = cps.join('').replace(FILE_NAME_EDGE_RE, '')
    return name.length > 0 ? name : 'dosya'
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
    utf8: Object.freeze({ encode: utf8Encode, decode: utf8Decode })
  })
})(typeof self !== 'undefined' ? self : this)
