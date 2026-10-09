'use strict'

// Oyun protokolü çekirdeği (window.TelsizGame). Saf yardımcılardır: DOM, ağ, saat ve sözlük kullanılmaz,
// kullanıcıya görünen metin üretilmez. Ses odasındaki oyun iletisi voice.js 'game' sinyalinin p yükünde gider ve
// iki biçimi vardır:
// - '{' ile başlayan düz JSON: invite, decline, reject, close (yalnızca davet, ret ve kapanış)
// - '2.' ile başlayan iç zarf (E2EE.dm, iki kişinin kimlik anahtarlarıyla mühürlü): join, act, sync, leave, state
// Her türün biçimi ve alan kümesi sabittir, yanlış biçimde gelen ileti atılır. İç zarftaki ctx, k, g, ch, from ve
// to alanları iletiyi türe, masaya, odaya ve kişi çiftine bağlar. ni (davet değeri), seq (kişi sayacı), rd (el
// numarası) ve r (masa sürümü) eski iletinin yeniden oynatılmasını önler.
// Burada ayrıca sayaç kuralları, state gövdesinin genel denetimi ve rastgelelik yardımcıları vardır. Hatalar
// err.code ile verilir (throw fail(kod)). 34-oyun-masa.js ve oyun uygulamaları (35-renk-kural.js) bu nesneyi
// yüklenirken bağlar.

window.TelsizGame = (function () {
  const VERSION = 1
  const CTX = 'game'
  const MAX_SEATS = 8
  // voice.js MAX_GAME_CHARS ve GAME_TEXT_RE ile aynı: p en çok bu kadar yazdırılabilir ASCII karakterdir
  const MAX_P = 11000
  const TEXT_RE = /^[ -~]+$/
  // state.b.ev listesinin en çok uzunluğu
  const MAX_EVENTS = 8
  const MAX_ROUND = 1000000
  const MAX_COUNT = 1000000000
  const ID_RE = /^[1-9][0-9]{0,15}$/
  const CH_RE = /^[A-Za-z0-9_-]{1,64}$/
  const HEX16_RE = /^[0-9a-f]{16}$/
  const APP_RE = /^[a-z]{1,16}$/
  // Kural seti, olay ve hata kodu: i18n anahtarının son parçası olabilecek biçim (ör. wild4_has_color)
  const CODE_RE = /^[a-z][a-z0-9_]{0,31}$/
  // byteSource bu kadar baytlık parçalar ister, randomBelow en çok bu kadar ardışık değeri reddeder
  const CHUNK = 64
  const MAX_REJECTS = 1000
  const MAX_RANGE = 65536

  const PHASES = ['lobby', 'play', 'over']
  // Anahtar nedenleri (15-dm.js dmSendState), arayüz game.reason.<neden>
  const KEY_REASONS = ['locked', 'blocked', 'gone', 'loading', 'unverified', 'changed']
  // invite.key: kurpiyerin bu alıcı için gördüğü anahtar sorunu, arayüz game.reason.peer_<neden>
  const INVITE_KEYS = ['unverified', 'changed', 'gone', 'loading']
  // decline.key: oyuncunun kurpiyer için gördüğü anahtar sorunu ('blocked' hiçbir zaman gönderilmez)
  const DECLINE_KEYS = ['locked', 'unverified', 'changed', 'loading', 'gone']
  const DECLINE_WHY = ['user', 'keys']
  const REJECT_WHY = ['full', 'started', 'closed', 'keys']
  const CLOSE_WHY = ['dealer', 'superseded', 'gone']
  const END_REASONS = ['dealer_left', 'closed', 'superseded', 'dealer_lost', 'removed', 'keys', 'reset']
  // Lobi çipleri (yalnızca kurpiyerde), arayüz game.status.<durum>
  const STATUSES = ['dealer', 'waiting', 'joined', 'declined', 'cannot', 'blocked', 'full', 'away', 'offline', 'keys']
  // Masa düzeyindeki hamle sonuçları (ack.code), uygulamaların ERRORS listesinde de bulunur
  const DESK_ERRORS = ['game_over', 'stale', 'bad_move']
  // Rol tablosu: her rolün kabul ettiği türler, gerisi sessizce atılır
  const RECEIVES = {
    dealer: ['decline', 'join', 'act', 'sync', 'leave'],
    player: ['invite', 'reject', 'close', 'state']
  }

  // Türe göre alan kümeleri. Hepsi zorunludur, fazlası reddedilir.
  const PLAIN_BASE = ['v', 'ctx', 'k', 'g', 'ch']
  const PLAIN_KEYS = {
    invite: PLAIN_BASE.concat(['app', 'dealer', 'ph', 'rules', 'seats', 'max', 'ni', 'key']),
    decline: PLAIN_BASE.concat(['ni', 'why', 'key']),
    reject: PLAIN_BASE.concat(['why']),
    close: PLAIN_BASE.concat(['why'])
  }
  const BASE = PLAIN_BASE.concat(['from', 'to'])
  const INNER_KEYS = {
    join: BASE.concat(['app', 'ni']),
    act: BASE.concat(['seq', 'rd', 'b']),
    sync: BASE.concat(['seq']),
    leave: BASE.concat(['seq']),
    state: BASE.concat(['r', 'ni', 'b'])
  }
  const BODY_KEYS = ['ph', 'app', 'rules', 'seats', 'rd', 'ack', 'view', 'mine', 'ev', 'away']
  const ACK_KEYS = ['seq', 'ok']
  const ACK_FAIL_KEYS = ['seq', 'ok', 'code']

  function hasOwn (obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key)
  }

  function fail (code) {
    const err = new Error(code)
    err.code = code
    return err
  }

  // JSON nesnesi (dizi ve null değil). Başka bir bağlamdan gelebilir, ön örnek denetlenmez.
  function isPlain (x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x)
  }

  function onlyKeys (obj, keys) {
    return Object.keys(obj).every((key) => keys.indexOf(key) >= 0)
  }

  // Alan kümesi tam olarak keys: fazla ve eksik alan yok
  function exactKeys (obj, keys) {
    return onlyKeys(obj, keys) && keys.every((key) => hasOwn(obj, key))
  }

  function isId (v) {
    return typeof v === 'string' && ID_RE.test(v)
  }

  function isHex16 (v) {
    return typeof v === 'string' && HEX16_RE.test(v)
  }

  function isChannel (v) {
    return typeof v === 'string' && CH_RE.test(v)
  }

  function isApp (v) {
    return typeof v === 'string' && APP_RE.test(v)
  }

  function isCode (v) {
    return typeof v === 'string' && CODE_RE.test(v)
  }

  function isCount (n) {
    return Number.isInteger(n) && n >= 0 && n <= MAX_COUNT
  }

  function isRound (n) {
    return isCount(n) && n <= MAX_ROUND
  }

  function oneOf (v, list) {
    return typeof v === 'string' && list.indexOf(v) >= 0
  }

  // min ile max arası uzunlukta, benzersiz kimliklerden oluşan liste
  function idList (list, min, max) {
    if (!Array.isArray(list) || list.length < min || list.length > max) return false
    return list.every((id, i) => isId(id) && list.indexOf(id) === i)
  }

  // ----- Düz iletiler -----

  function validInvite (x) {
    if (!isApp(x.app) || !isId(x.dealer) || !oneOf(x.ph, PHASES) || !isCode(x.rules) || !isHex16(x.ni)) return null
    if (!Number.isInteger(x.max) || x.max < 2 || x.max > MAX_SEATS) return null
    if (!idList(x.seats, 1, x.max) || x.seats[0] !== x.dealer) return null
    return x.key === null || oneOf(x.key, INVITE_KEYS) ? x : null
  }

  // Düz iletinin bağlamsız biçimi. Dönüş: ileti veya null.
  function validPlain (x) {
    if (!isPlain(x) || typeof x.k !== 'string' || !hasOwn(PLAIN_KEYS, x.k)) return null
    if (x.v !== VERSION || x.ctx !== CTX || !exactKeys(x, PLAIN_KEYS[x.k])) return null
    if (!isHex16(x.g) || !isChannel(x.ch)) return null
    if (x.k === 'invite') return validInvite(x)
    if (x.k === 'decline') {
      if (!isHex16(x.ni) || !oneOf(x.why, DECLINE_WHY)) return null
      // Anahtar sorunu yalnızca why 'keys' ile ve her zaman birlikte gelir
      const keyOk = x.why === 'keys' ? oneOf(x.key, DECLINE_KEYS) : x.key === null
      return keyOk ? x : null
    }
    return oneOf(x.why, x.k === 'reject' ? REJECT_WHY : CLOSE_WHY) ? x : null
  }

  // Bağ denetimi: expect = { ch, from }. ch benim odam, davette dealer gönderenin kadrodaki kimliği.
  function checkPlain (x, expect) {
    if (!x || !expect || x.ch !== expect.ch) return null
    if (x.k === 'invite' && x.dealer !== expect.from) return null
    return x
  }

  // p: '{' ile başlayan düz JSON. expect verilirse checkPlain de uygulanır. Dönüş: ileti veya null.
  function parsePlain (p, expect) {
    if (typeof p !== 'string' || p.charAt(0) !== '{' || p.length > MAX_P || !TEXT_RE.test(p)) return null
    let x = null
    try {
      x = JSON.parse(p)
    } catch (e) {
      return null
    }
    x = validPlain(x)
    return x && expect !== undefined ? checkPlain(x, expect) : x
  }

  // Gönderilecek düz ileti: yalnızca yazdırılabilir ASCII ve en çok MAX_P karakter, değilse null
  function encodePlain (obj) {
    if (!isPlain(obj)) return null
    let text = null
    try {
      text = JSON.stringify(obj)
    } catch (e) {
      return null
    }
    return typeof text === 'string' && text.length <= MAX_P && TEXT_RE.test(text) ? text : null
  }

  // ----- İç zarf -----

  // Mühürleme. Sonuç MAX_P sınırını aşarsa veya mühürlenemezse null.
  function sealInner (dm, obj, pk, sk) {
    let env = null
    try {
      env = dm.seal(obj, pk, sk)
    } catch (e) {
      return null
    }
    return typeof env === 'string' && env.length <= MAX_P ? env : null
  }

  // Açma: yalnızca verilen tek açık anahtar denenir (karşı tarafın güncel doğrulanmış anahtarı)
  function openInner (dm, p, pk, sk) {
    if (typeof p !== 'string' || p.indexOf('2.') !== 0 || p.length > MAX_P) return null
    let res = null
    try {
      res = dm.open(p, [pk], sk)
    } catch (e) {
      return null
    }
    const x = res && res.ok === true ? res.value : null
    return isPlain(x) && x.v === VERSION && x.ctx === CTX && typeof x.k === 'string' ? x : null
  }

  // Bağ denetimi: tür alan kümesi, masa, oda, gönderen ve alıcı. expect = { ch, from, to, g? }
  function checkInner (x, expect) {
    if (!isPlain(x) || !expect || typeof x.k !== 'string' || !hasOwn(INNER_KEYS, x.k)) return null
    if (x.v !== VERSION || x.ctx !== CTX || !exactKeys(x, INNER_KEYS[x.k])) return null
    if (!isHex16(x.g) || !isChannel(x.ch) || !isId(x.from) || !isId(x.to)) return null
    if (x.ch !== expect.ch || x.from !== expect.from || x.to !== expect.to) return null
    if (expect.g !== undefined && x.g !== expect.g) return null
    if (hasOwn(x, 'seq') && !(isCount(x.seq) && x.seq >= 1)) return null
    if (hasOwn(x, 'rd') && !isRound(x.rd)) return null
    if (hasOwn(x, 'r') && !(isCount(x.r) && x.r >= 1)) return null
    if (hasOwn(x, 'ni') && !isHex16(x.ni)) return null
    if (hasOwn(x, 'app') && !isApp(x.app)) return null
    if (hasOwn(x, 'b') && !isPlain(x.b)) return null
    return x
  }

  // ----- Sürümler ve sayaçlar -----

  // Kişi sayacı: yeni, tekrar (sonuç yeniden gönderilir) veya eski (atılır)
  function seqOrder (last, seq) {
    if (seq > last) return 'new'
    return seq === last ? 'repeat' : 'old'
  }

  // Oyuncu tarafı: daha eski sürüm atılır, aynı sürüm yalnızca daha yeni bir sayaç sonucu taşıyorsa alınır
  function acceptState (lastR, lastAckSeq, r, ackSeq) {
    if (r > lastR) return true
    return r === lastR && ackSeq > lastAckSeq
  }

  // ----- state gövdesi -----

  // ack: { seq, ok: true } veya { seq, ok: false, code }
  function validAck (a) {
    if (!isPlain(a) || !isCount(a.seq) || typeof a.ok !== 'boolean') return false
    if (a.ok) return exactKeys(a, ACK_KEYS)
    return exactKeys(a, ACK_FAIL_KEYS) && isCode(a.code)
  }

  // ev: en çok MAX_EVENTS olay, her biri { r, e, ... }. r azalmaz ve masa sürümünü aşmaz.
  function validEvents (ev, r) {
    if (!Array.isArray(ev) || ev.length > MAX_EVENTS) return false
    let prev = 1
    return ev.every((item) => {
      if (!isPlain(item) || !isCount(item.r) || item.r < prev || item.r > r || !isCode(item.e)) return false
      prev = item.r
      return true
    })
  }

  // Kişinin koltukta olup olmadığı dışındaki bütün genel denetimler. ctx = { dealer, me, r, app?, rules? }
  function bodyOk (b, ctx) {
    if (!isPlain(b) || !isPlain(ctx) || !exactKeys(b, BODY_KEYS)) return false
    if (!isId(ctx.dealer) || !isId(ctx.me) || !isCount(ctx.r) || ctx.r < 1) return false
    if (!oneOf(b.ph, PHASES) || !isApp(b.app) || !isCode(b.rules) || !isRound(b.rd)) return false
    if (ctx.app !== undefined && b.app !== ctx.app) return false
    if (Array.isArray(ctx.rules) && ctx.rules.indexOf(b.rules) < 0) return false
    // İlk lobide el numarası 0, Başlat ile artar
    if (b.ph !== 'lobby' && b.rd < 1) return false
    if (!idList(b.seats, 1, MAX_SEATS) || b.seats[0] !== ctx.dealer) return false
    if (!validAck(b.ack)) return false
    if ((b.ph === 'lobby') !== (b.view === null)) return false
    if (b.view !== null && !isPlain(b.view)) return false
    if (b.mine !== null && (b.view === null || !isPlain(b.mine))) return false
    if (!validEvents(b.ev, ctx.r)) return false
    if (!idList(b.away, 0, b.seats.length)) return false
    return b.away.every((id) => b.seats.indexOf(id) >= 0)
  }

  // Genel state.b denetimi, ardından uygulamanın validateView ve validatePrivate işlevleri çağrılır.
  // Ben koltukta değilsem bu bir durum değil, "çıkarıldım" bilgisidir (isRemovalBody). Dönüş: b veya null.
  function validStateBody (b, ctx) {
    return bodyOk(b, ctx) && b.seats.indexOf(ctx.me) >= 0 ? b : null
  }

  // Koltuklarda ben yokum ve elim gelmedi: kurpiyer beni masadan çıkardı
  function isRemovalBody (b, ctx) {
    return bodyOk(b, ctx) && b.seats.indexOf(ctx.me) < 0 && b.mine === null
  }

  // ----- Rastgelelik -----

  // rng(n): n baytlık dizi benzeri (Uint8Array veya dizi). Başka bir bağlamdan gelebilir, instanceof kullanılmaz.
  // Hata fırlatırsa no_random, uzunluk veya bayt değeri yanlışsa bad_random. Sonuç kendi kopyasıdır.
  function readBytes (rng, n) {
    let got = null
    try {
      got = rng(n)
    } catch (e) {
      throw fail('no_random')
    }
    if (!got || typeof got !== 'object' || got.length !== n) throw fail('bad_random')
    const out = []
    let i = 0
    while (i < n) {
      const v = got[i]
      if (!Number.isInteger(v) || v < 0 || v > 255) throw fail('bad_random')
      out.push(v)
      i++
    }
    return out
  }

  // Bayt akışı: next() sıradaki baytı verir, rng'den CHUNK baytlık parçalar ister
  function byteSource (rng) {
    let buf = []
    let pos = 0
    return function next () {
      if (pos >= buf.length) {
        buf = readBytes(rng, CHUNK)
        pos = 0
      }
      const v = buf[pos]
      pos++
      return v
    }
  }

  // [0, m) aralığında yansız tamsayı (reddetmeli örnekleme). 1 <= m <= 65536. m 256'yı aşarsa iki bayt
  // (büyük uçlu) okunur. Uzayın m'ye bölünmeyen artığı reddedilir.
  function randomBelow (next, m) {
    if (!Number.isInteger(m) || m < 1 || m > MAX_RANGE) throw fail('bad_random')
    const wide = m > 256
    const space = wide ? MAX_RANGE : 256
    const limit = space - space % m
    let tries = 0
    while (tries < MAX_REJECTS) {
      const v = wide ? next() * 256 + next() : next()
      if (v < limit) return v % m
      tries++
    }
    throw fail('bad_random')
  }

  // Fisher-Yates (Durstenfeld). Girdiyi değiştirmez, yeni dizi döner.
  function shuffle (list, rng) {
    const next = byteSource(rng)
    const out = list.slice()
    let i = out.length - 1
    while (i > 0) {
      const j = randomBelow(next, i + 1)
      const tmp = out[i]
      out[i] = out[j]
      out[j] = tmp
      i--
    }
    return out
  }

  // 8 rastgele bayttan 16 onaltılık karakter (masa kimliği g ve davet değeri ni)
  function randomHex16 (rng) {
    return readBytes(rng, 8).map((v) => (v < 16 ? '0' : '') + v.toString(16)).join('')
  }

  // Halkada from koltuğundan dir yönünde steps adım ötesi
  function ring (n, from, dir, steps) {
    return ((from + dir * steps) % n + n) % n
  }

  function frozenMap (obj) {
    const out = {}
    Object.keys(obj).forEach((key) => {
      out[key] = Object.freeze(obj[key].slice())
    })
    return Object.freeze(out)
  }

  return Object.freeze({
    VERSION: VERSION,
    CTX: CTX,
    MAX_SEATS: MAX_SEATS,
    MAX_P: MAX_P,
    MAX_EVENTS: MAX_EVENTS,
    MAX_ROUND: MAX_ROUND,
    PHASES: Object.freeze(PHASES.slice()),
    KEY_REASONS: Object.freeze(KEY_REASONS.slice()),
    INVITE_KEYS: Object.freeze(INVITE_KEYS.slice()),
    DECLINE_KEYS: Object.freeze(DECLINE_KEYS.slice()),
    DECLINE_WHY: Object.freeze(DECLINE_WHY.slice()),
    REJECT_WHY: Object.freeze(REJECT_WHY.slice()),
    CLOSE_WHY: Object.freeze(CLOSE_WHY.slice()),
    END_REASONS: Object.freeze(END_REASONS.slice()),
    STATUSES: Object.freeze(STATUSES.slice()),
    DESK_ERRORS: Object.freeze(DESK_ERRORS.slice()),
    RECEIVES: frozenMap(RECEIVES),
    PLAIN_KEYS: frozenMap(PLAIN_KEYS),
    INNER_KEYS: frozenMap(INNER_KEYS),
    BODY_KEYS: Object.freeze(BODY_KEYS.slice()),
    fail: fail,
    isPlain: isPlain,
    onlyKeys: onlyKeys,
    exactKeys: exactKeys,
    isId: isId,
    isHex16: isHex16,
    isChannel: isChannel,
    isApp: isApp,
    isCode: isCode,
    isCount: isCount,
    validPlain: validPlain,
    checkPlain: checkPlain,
    parsePlain: parsePlain,
    encodePlain: encodePlain,
    sealInner: sealInner,
    openInner: openInner,
    checkInner: checkInner,
    seqOrder: seqOrder,
    acceptState: acceptState,
    validStateBody: validStateBody,
    isRemovalBody: isRemovalBody,
    byteSource: byteSource,
    randomBelow: randomBelow,
    shuffle: shuffle,
    randomHex16: randomHex16,
    ring: ring
  })
})()
