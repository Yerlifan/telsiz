'use strict'

// Hexball ağı (window.TelsizHexballNet). DOM ve sözlük kullanmaz, kullanıcıya görünen metin üretmez. Saat,
// zamanlayıcı ve gönderim dışarıdan (env) verilir. Gerçek zamanlı veri masa yöneticisinden geçmez, ev sahibi ile her
// koltuk arasındaki oyun veri kanalıyla (voice.js openGameLink, sendGameData, onGameData) gider.
// İletiler ikilidir (little endian), ilk bayt sürüm (1), ikinci bayt türdür:
// - HELLO (E -> O, 13 bayt): maç kimliği (8 bayt, lobide sıfır), yuva u8 (izleyicide 255), tickHz u8, snapHz u8
// - HELLO_ACK (O -> E, 11 bayt): aldığı HELLO'nun maç kimliği ve yuvası
// - INPUT (O -> E, 11 bayt): seq u16, lastTick u32 (aldığı en yeni anlık görüntü), düğmeler u8 (bit0 vuruş),
//   ax i8, ay i8 (-127 ile 127)
// - SNAP (E -> O, 22 + 10n bayt, en çok 102): tick u32, aşama u8 (kickoff, play, goal, paused, over), kalan süre u16
//   (desisaniye), skor 2 x u8 (Kırmızı, Mavi), ackSeq u16 (alıcının işlenen son girdisi), top x, y, vx, vy i16,
//   n u8, n kez (yuva u8, x, y, vx, vy i16, bayraklar u8 (bit0 vuruş tutuluyor))
// Konum 1/8 birim, hız 1/64 birim/adım sabit noktalıdır. Boyu, sürümü, türü ya da bir alanı tutmayan ileti atılır.
// Ev sahibi otoriterdir (createHost): fiziği (44-hexball-fizik.js) setTimeout zinciri ve env.now() biriktiricisiyle
// 60 Hz yürütür, oyunculara 30 Hz (gönderim tıkanınca ya da env.lowUplink() doğruyken 20 Hz) anlık görüntü gönderir.
// İki döngü arası 250 ms'yi aşarsa (arka planda kısılan sekme) maç duraklar, döngü 500 ms düzenli işleyince sürer.
// Ev sahibinin kendi girdisi oyuncuların ortalama gidiş dönüş süresi kadar, en çok 80 ms bekletilir.
// El sıkışma: kanal açılınca ev sahibi HELLO gönderir ve HELLO_ACK gelene kadar 250 ms'de bir yineler. Kanal
// açıldıktan sonra 5 sn içinde hiç HELLO_ACK gelmezse bağ "failed" olur (eski istemci). Her maç başında ve sonunda
// yeni maç kimliğiyle el yeniden sıkışılır, onaylamayan eşe anlık görüntü gitmez ve girdisi işlenmez.
// Denetimler: ev sahibi yalnızca masadaki kişinin bu kişiye ait eş kimliğinden (setPeers) gelen ve maçta yuvası
// olan kişinin girdisini işler, eş başına saniyede en çok 120 girdi, eski seq atılır, eksenler sınırlanır. Oyuncu
// yalnızca ev sahibinin eşinden gelen HELLO ve SNAP iletilerini alır, en yeni tick'ten eski olan SNAP atılır.
// Oyuncu (createPlayer) iki anlık görüntülük tamponla (30 Hz'de yaklaşık 66 ms) ara değer bulur, tampon titreşime
// göre en çok 150 ms'ye uzar. İstemci tahmini yoktur.

window.TelsizHexballNet = (function (P, H) {
  const VERSION = 1
  const TYPES = Object.freeze({ HELLO: 1, HELLO_ACK: 2, INPUT: 3, SNAP: 4 })
  const HELLO_BYTES = 13
  const ACK_BYTES = 11
  const INPUT_BYTES = 11
  const SNAP_BASE = 22
  const SNAP_PER = 10
  const MAX_SLOTS = 8
  const MAX_BYTES = SNAP_BASE + MAX_SLOTS * SNAP_PER
  const NO_SLOT = 255
  // Aşamaların ileti sırası sabittir (fizikteki PHASES ile aynı küme)
  const PHASES = ['kickoff', 'play', 'goal', 'paused', 'over']
  // Lobide (maç yokken) HELLO'daki maç kimliği. Kural motorunun ürettiği kimlik bu olamaz (startMatch reddeder).
  const LOBBY_EPOCH = '0000000000000000'
  const HEX16_RE = /^[0-9a-f]{16}$/
  const POS_SCALE = 8
  const VEL_SCALE = 64
  const AXIS_SCALE = 127
  const MAX_TICK = 4294967295
  const MAX_SEQ = 65535
  // Kalan süre desisaniye: en uzun maç (fizikte MAX_SECS) buna sığar
  const MAX_REMAINING = 60000
  const TICK_HZ = P.TICK_HZ
  const TICK_MS = 1000 / TICK_HZ
  const SNAP_HZ = 30
  const SNAP_HZ_LOW = 20
  // Ev sahibi döngüsü
  const PAUSE_GAP_MS = 250
  const RESUME_MS = 500
  const MAX_CATCHUP = 16
  const IDLE_LOOP_MS = 250
  const MAX_HOST_DELAY_MS = 80
  const MAX_LOCAL_QUEUE = 128
  // Gönderim tıkanınca (sendGameData false) o eşe bu süre boyunca düşük hızda gönderilir
  const SLOW_HOLD_MS = 2000
  // Bağ ve el sıkışma
  const HELLO_RESEND_MS = 250
  const HELLO_TIMEOUT_MS = 5000
  const OPEN_TIMEOUT_MS = 15000
  const LINK_RETRY_MS = 1000
  const LINK_STATES = ['none', 'waiting', 'ready', 'failed']
  // Girdi
  const MAX_INPUT_RATE = 120
  const MIN_INPUT_MS = 1000 / 60
  // Gidiş dönüş ölçümü (ms) için tutulan son anlık görüntü ve girdi sayısı
  const RTT_RING = 64
  const MAX_RTT_MS = 5000
  // Ara değerleme
  const BUFFER_SNAPS = 2
  const MAX_BUFFER_MS = 150
  const KEEP_SNAPS = 8
  const RESYNC_TICKS = 20
  const CORRECT_MS = 250
  const MAX_FRAME_GAP_MS = 250
  const TELEPORT_PAD = 2

  // ----- Küçük yardımcılar -----

  function fail (code) {
    const err = new Error(code)
    err.code = code
    return err
  }

  function hasOwn (obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key)
  }

  function isPlain (x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x)
  }

  function isInt (n, min, max) {
    return Number.isInteger(n) && n >= min && n <= max
  }

  function isNum (n) {
    return typeof n === 'number' && isFinite(n)
  }

  function isKey (s) {
    return typeof s === 'string' && s.length > 0 && s.length <= 64
  }

  function isEpoch (e) {
    return typeof e === 'string' && HEX16_RE.test(e) && e !== LOBBY_EPOCH
  }

  function slotOk (s) {
    return s === null || isInt(s, 0, MAX_SLOTS - 1)
  }

  function clampUnit (n) {
    return n < -1 ? -1 : n > 1 ? 1 : n
  }

  // a, b'den sonra mı (u16 seq, sarmalı)
  function seqNewer (a, b) {
    const d = (a - b) & MAX_SEQ
    return d > 0 && d < 32768
  }

  // Sabit noktalı i16 (taşan değer sınıra çekilir)
  function fixed (v, scale) {
    const n = Math.round(v * scale)
    if (!isFinite(n)) return 0
    return n < -32768 ? -32768 : n > 32767 ? 32767 : n
  }

  function axisOut (v) {
    return Math.round(clampUnit(v) * AXIS_SCALE)
  }

  function axisIn (n) {
    return clampUnit(n / AXIS_SCALE)
  }

  function viewOf (data) {
    if (Object.prototype.toString.call(data) === '[object ArrayBuffer]') return new DataView(data)
    if (ArrayBuffer.isView(data)) return new DataView(data.buffer, data.byteOffset, data.byteLength)
    return null
  }

  function writeEpoch (dv, off, epoch) {
    const hex = epoch === null ? LOBBY_EPOCH : epoch
    let i = 0
    while (i < 8) {
      dv.setUint8(off + i, parseInt(hex.substr(i * 2, 2), 16))
      i++
    }
  }

  function readEpoch (dv, off) {
    let hex = ''
    let i = 0
    while (i < 8) {
      const b = dv.getUint8(off + i)
      hex += (b < 16 ? '0' : '') + b.toString(16)
      i++
    }
    return hex === LOBBY_EPOCH ? null : hex
  }

  function header (size, type) {
    const buf = new ArrayBuffer(size)
    const dv = new DataView(buf)
    dv.setUint8(0, VERSION)
    dv.setUint8(1, type)
    return { buf: buf, dv: dv }
  }

  // ----- Kodlayıcılar (hatalı alan varsa null) -----

  // h: { epoch: 16 hex veya null (lobi), slot: 0-7 veya null (izleyici), tickHz, snapHz }
  function encodeHello (h) {
    if (!isPlain(h) || !(h.epoch === null || isEpoch(h.epoch)) || !slotOk(h.slot)) return null
    if (!isInt(h.tickHz, 1, 255) || !isInt(h.snapHz, 1, 255)) return null
    const o = header(HELLO_BYTES, TYPES.HELLO)
    writeEpoch(o.dv, 2, h.epoch)
    o.dv.setUint8(10, h.slot === null ? NO_SLOT : h.slot)
    o.dv.setUint8(11, h.tickHz)
    o.dv.setUint8(12, h.snapHz)
    return o.buf
  }

  // a: { epoch, slot } (aldığı HELLO'daki değerler)
  function encodeHelloAck (a) {
    if (!isPlain(a) || !(a.epoch === null || isEpoch(a.epoch)) || !slotOk(a.slot)) return null
    const o = header(ACK_BYTES, TYPES.HELLO_ACK)
    writeEpoch(o.dv, 2, a.epoch)
    o.dv.setUint8(10, a.slot === null ? NO_SLOT : a.slot)
    return o.buf
  }

  // i: { seq: 0-65535, lastTick: u32, kick: boolean, x, y: [-1, 1] aralığına çekilir }
  function encodeInput (i) {
    if (!isPlain(i) || !isInt(i.seq, 0, MAX_SEQ) || !isInt(i.lastTick, 0, MAX_TICK)) return null
    if (typeof i.kick !== 'boolean' || !isNum(i.x) || !isNum(i.y)) return null
    const o = header(INPUT_BYTES, TYPES.INPUT)
    o.dv.setUint16(2, i.seq, true)
    o.dv.setUint32(4, i.lastTick, true)
    o.dv.setUint8(8, i.kick ? 1 : 0)
    o.dv.setInt8(9, axisOut(i.x))
    o.dv.setInt8(10, axisOut(i.y))
    return o.buf
  }

  function discOk (d) {
    return isPlain(d) && isNum(d.x) && isNum(d.y) && isNum(d.vx) && isNum(d.vy)
  }

  function writeDisc (dv, off, d) {
    dv.setInt16(off, fixed(d.x, POS_SCALE), true)
    dv.setInt16(off + 2, fixed(d.y, POS_SCALE), true)
    dv.setInt16(off + 4, fixed(d.vx, VEL_SCALE), true)
    dv.setInt16(off + 6, fixed(d.vy, VEL_SCALE), true)
  }

  function readDisc (dv, off) {
    return {
      x: dv.getInt16(off, true) / POS_SCALE,
      y: dv.getInt16(off + 2, true) / POS_SCALE,
      vx: dv.getInt16(off + 4, true) / VEL_SCALE,
      vy: dv.getInt16(off + 6, true) / VEL_SCALE
    }
  }

  // s: { tick, phase, remaining (ds), score: { red, blue }, ackSeq, ball: { x, y, vx, vy },
  //      players: [{ slot, x, y, vx, vy, kick }] }
  function encodeSnap (s) {
    if (!isPlain(s) || !isInt(s.tick, 0, MAX_TICK) || PHASES.indexOf(s.phase) < 0) return null
    if (!isInt(s.remaining, 0, MAX_REMAINING) || !isInt(s.ackSeq, 0, MAX_SEQ) || !discOk(s.ball)) return null
    if (!isPlain(s.score) || !isInt(s.score.red, 0, 255) || !isInt(s.score.blue, 0, 255)) return null
    const ps = s.players
    if (!Array.isArray(ps) || ps.length > MAX_SLOTS) return null
    const seen = []
    const ok = ps.every((p) => {
      if (!discOk(p) || !isInt(p.slot, 0, MAX_SLOTS - 1) || typeof p.kick !== 'boolean' || seen.indexOf(p.slot) >= 0) return false
      seen.push(p.slot)
      return true
    })
    if (!ok) return null
    const o = header(SNAP_BASE + SNAP_PER * ps.length, TYPES.SNAP)
    const dv = o.dv
    dv.setUint32(2, s.tick, true)
    dv.setUint8(6, PHASES.indexOf(s.phase))
    dv.setUint16(7, s.remaining, true)
    dv.setUint8(9, s.score.red)
    dv.setUint8(10, s.score.blue)
    dv.setUint16(11, s.ackSeq, true)
    writeDisc(dv, 13, s.ball)
    dv.setUint8(21, ps.length)
    ps.forEach((p, i) => {
      const off = SNAP_BASE + SNAP_PER * i
      dv.setUint8(off, p.slot)
      writeDisc(dv, off + 1, p)
      dv.setUint8(off + 9, p.kick ? 1 : 0)
    })
    return o.buf
  }

  // ----- Çözücü -----

  function readSlot (dv, off) {
    const s = dv.getUint8(off)
    if (s === NO_SLOT) return null
    return s < MAX_SLOTS ? s : undefined
  }

  function decodeHello (dv) {
    if (dv.byteLength !== HELLO_BYTES) return null
    const slot = readSlot(dv, 10)
    const tickHz = dv.getUint8(11)
    const snapHz = dv.getUint8(12)
    if (slot === undefined || tickHz !== TICK_HZ || snapHz < 1 || snapHz > TICK_HZ) return null
    return { type: 'hello', epoch: readEpoch(dv, 2), slot: slot, tickHz: tickHz, snapHz: snapHz }
  }

  function decodeAck (dv) {
    if (dv.byteLength !== ACK_BYTES) return null
    const slot = readSlot(dv, 10)
    if (slot === undefined) return null
    return { type: 'hello_ack', epoch: readEpoch(dv, 2), slot: slot }
  }

  function decodeInput (dv) {
    if (dv.byteLength !== INPUT_BYTES) return null
    const buttons = dv.getUint8(8)
    if (buttons > 1) return null
    return {
      type: 'input',
      seq: dv.getUint16(2, true),
      lastTick: dv.getUint32(4, true),
      kick: buttons === 1,
      x: axisIn(dv.getInt8(9)),
      y: axisIn(dv.getInt8(10))
    }
  }

  function decodeSnap (dv) {
    if (dv.byteLength < SNAP_BASE) return null
    const n = dv.getUint8(21)
    if (n > MAX_SLOTS || dv.byteLength !== SNAP_BASE + SNAP_PER * n) return null
    const phase = dv.getUint8(6)
    const remaining = dv.getUint16(7, true)
    if (phase >= PHASES.length || remaining > MAX_REMAINING) return null
    const players = []
    const seen = []
    let i = 0
    while (i < n) {
      const off = SNAP_BASE + SNAP_PER * i
      const slot = dv.getUint8(off)
      const flags = dv.getUint8(off + 9)
      if (slot >= MAX_SLOTS || seen.indexOf(slot) >= 0 || flags > 1) return null
      seen.push(slot)
      const d = readDisc(dv, off + 1)
      players.push({ slot: slot, x: d.x, y: d.y, vx: d.vx, vy: d.vy, kick: flags === 1 })
      i++
    }
    return {
      type: 'snap',
      tick: dv.getUint32(2, true),
      phase: PHASES[phase],
      remaining: remaining,
      score: { red: dv.getUint8(9), blue: dv.getUint8(10) },
      ackSeq: dv.getUint16(11, true),
      ball: readDisc(dv, 13),
      players: players
    }
  }

  // ArrayBuffer veya görünümü. Dönüş: { type: 'hello' | 'hello_ack' | 'input' | 'snap', ... } veya null
  function decode (data) {
    const dv = viewOf(data)
    if (!dv || dv.byteLength < 2 || dv.byteLength > MAX_BYTES || dv.getUint8(0) !== VERSION) return null
    const type = dv.getUint8(1)
    if (type === TYPES.HELLO) return decodeHello(dv)
    if (type === TYPES.HELLO_ACK) return decodeAck(dv)
    if (type === TYPES.INPUT) return decodeInput(dv)
    if (type === TYPES.SNAP) return decodeSnap(dv)
    return null
  }

  // ----- Ortak oturum yardımcıları -----

  function checkEnv (env) {
    const need = ['now', 'setTimeout', 'clearTimeout', 'send']
    if (!isPlain(env) || !need.every((k) => typeof env[k] === 'function')) throw fail('bad_env')
  }

  function reporter (env) {
    return function (err) {
      if (typeof env.onError !== 'function') return
      try {
        env.onError(err)
      } catch (e) {}
    }
  }

  function emitter (env, report) {
    return function (evt) {
      if (typeof env.onEvent !== 'function') return
      try {
        env.onEvent(evt)
      } catch (err) {
        report(err)
      }
    }
  }

  function sender (env, report) {
    return function (peerId, buf) {
      if (!buf) return false
      try {
        return env.send(peerId, buf) === true
      } catch (err) {
        report(err)
        return false
      }
    }
  }

  function copyDisc (d) {
    return { x: d.x, y: d.y, vx: d.vx, vy: d.vy }
  }

  // Ara değer: iki anlık görüntü arasında dt adımda olanaksız uzaklık (başlama vuruşu dizilişi gibi) atlamadır,
  // o zaman ara değer bulunmaz
  function blendDisc (a, b, f, dt, maxStep) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lim = dt * maxStep + TELEPORT_PAD
    if (dx * dx + dy * dy > lim * lim) return copyDisc(f < 1 ? a : b)
    return {
      x: a.x + dx * f,
      y: a.y + dy * f,
      vx: a.vx + (b.vx - a.vx) * f,
      vy: a.vy + (b.vy - a.vy) * f
    }
  }

  // ----- Ev sahibi -----

  // env: now() ms (performance.now), setTimeout, clearTimeout, send(peerId, ArrayBuffer) -> boolean (sendGameData),
  // isteğe bağlı openLink(peerId) -> openGameLink kodu, closeLink(peerId), lowUplink() -> boolean,
  // onEvent(olay), onError(hata). opts: { me } ev sahibinin kullanıcı kimliği.
  // Olaylar: { e: 'link', id, peerId, state: none | waiting | ready | failed }, { e: 'paused' }, { e: 'resumed' },
  // fizik olayları maç kimliğiyle ve yuva yerine kişi kimliğiyle: { e: 'play', epoch, by },
  // { e: 'goal', epoch, side, by, at }, { e: 'time', epoch }, { e: 'golden', epoch }, { e: 'over', epoch, winner, why },
  // { e: 'kickoff', epoch, kick }. Ev sahibinin arayüzü goal ve time olaylarını kural motoruna hamle olarak gönderir.
  function createHost (env, opts) {
    checkEnv(env)
    if (!isPlain(opts) || !isKey(opts.me)) throw fail('bad_options')
    const me = opts.me
    const report = reporter(env)
    const emit = emitter(env, report)
    const send = sender(env, report)
    // peerId -> kayıt. link: none | opening | waiting | ready | failed (opening dışarıya waiting görünür)
    let peers = {}
    let match = null
    let netTick = 0
    let timer = null
    let lastLoop = 0
    let acc = 0
    let lagPaused = false
    let steadySince = 0
    let local = { x: 0, y: 0, kick: false }
    let localQueue = []
    let localLatch = false
    let sentAt = []
    let destroyed = false

    function now () {
      return env.now()
    }

    function newPeer (id, peerId) {
      return {
        id: id,
        peerId: peerId,
        link: 'none',
        chan: false,
        since: 0,
        tried: -Infinity,
        helloAt: -Infinity,
        helloEpoch: undefined,
        helloSlot: undefined,
        everReady: false,
        seq: -1,
        inp: { x: 0, y: 0, kick: false },
        kickLatch: false,
        win: 0,
        n: 0,
        rtt: null,
        slowUntil: -Infinity,
        nextSnap: 0
      }
    }

    function outward (link) {
      return link === 'opening' ? 'waiting' : link
    }

    function setLink (r, link) {
      const before = outward(r.link)
      r.link = link
      if (outward(link) !== before) emit({ e: 'link', id: r.id, peerId: r.peerId, state: outward(link) })
    }

    function slotOf (id) {
      return match && hasOwn(match.slots, id) ? match.slots[id] : null
    }

    function epochNow () {
      return match ? match.epoch : null
    }

    function rateFor (r, t) {
      let low = false
      if (typeof env.lowUplink === 'function') {
        try {
          low = env.lowUplink() === true
        } catch (err) {
          report(err)
        }
      }
      return low || t < r.slowUntil ? SNAP_HZ_LOW : SNAP_HZ
    }

    function resetInput (r) {
      r.seq = -1
      r.inp = { x: 0, y: 0, kick: false }
      r.kickLatch = false
      r.nextSnap = 0
    }

    function sendHello (r, t) {
      const slot = slotOf(r.id)
      r.helloAt = t
      r.helloEpoch = epochNow()
      r.helloSlot = slot
      send(r.peerId, encodeHello({ epoch: r.helloEpoch, slot: slot, tickHz: TICK_HZ, snapHz: rateFor(r, t) }))
    }

    function linkOpened (r, t) {
      r.chan = true
      r.since = t
      resetInput(r)
      setLink(r, 'waiting')
      sendHello(r, t)
    }

    function linkLost (r, link) {
      r.chan = false
      r.tried = now()
      resetInput(r)
      setLink(r, link)
    }

    function tryOpen (r, t) {
      r.tried = t
      if (typeof env.openLink !== 'function') return
      let code = null
      try {
        code = env.openLink(r.peerId)
      } catch (err) {
        report(err)
        return
      }
      if (code === 'open') linkOpened(r, t)
      else if (code === 'ok') {
        r.since = t
        setLink(r, 'opening')
      } else if (code === 'blocked' || code === 'unsupported' || code === 'private') setLink(r, 'failed')
    }

    // Bağ bakımı: kanalı olmayan eşe yeniden açma, el sıkışma yinelemesi ve zaman aşımları. Hiç onaylamamış eş
    // kanal açıldıktan 5 sn sonra failed olur, kanalı açık failed eşe saniyede bir HELLO gider (geç onay kabul edilir).
    function maintain (t) {
      Object.keys(peers).forEach((pid) => {
        const r = peers[pid]
        if (r.link === 'none') {
          if (t - r.tried >= LINK_RETRY_MS) tryOpen(r, t)
        } else if (r.link === 'opening') {
          if (t - r.since > OPEN_TIMEOUT_MS) setLink(r, 'failed')
        } else if (r.link === 'waiting') {
          if (!r.everReady && t - r.since > HELLO_TIMEOUT_MS) setLink(r, 'failed')
          else if (t - r.helloAt >= HELLO_RESEND_MS) sendHello(r, t)
        } else if (r.link === 'failed' && r.chan && t - r.helloAt >= LINK_RETRY_MS) {
          sendHello(r, t)
        }
      })
    }

    // Maç yokken döngü bir sonraki bağ işinin zamanında uyanır (en geç IDLE_LOOP_MS sonra)
    function nextDue (t) {
      let due = t + IDLE_LOOP_MS
      Object.keys(peers).forEach((pid) => {
        const r = peers[pid]
        let at = Infinity
        if (r.link === 'none') at = r.tried + LINK_RETRY_MS
        else if (r.link === 'opening') at = r.since + OPEN_TIMEOUT_MS
        else if (r.link === 'waiting') at = Math.min(r.helloAt + HELLO_RESEND_MS, r.everReady ? Infinity : r.since + HELLO_TIMEOUT_MS)
        else if (r.link === 'failed' && r.chan) at = r.helloAt + LINK_RETRY_MS
        if (at < due) due = at
      })
      return Math.max(1, Math.ceil(due - t))
    }

    // Maç kimliği değişti: kanalı açık eşlerle el yeniden sıkışılır. Hiç onaylamamış eşin 5 sn süresi kanalın
    // açılışından sayılmaya devam eder.
    function rehello (t) {
      Object.keys(peers).forEach((pid) => {
        const r = peers[pid]
        resetInput(r)
        if (!r.chan) return
        if (r.link === 'ready') setLink(r, 'waiting')
        sendHello(r, t)
      })
    }

    function hostDelay () {
      let sum = 0
      let n = 0
      Object.keys(peers).forEach((pid) => {
        const r = peers[pid]
        if (r.link === 'ready' && r.rtt !== null && slotOf(r.id) !== null) {
          sum += r.rtt
          n++
        }
      })
      return n ? Math.min(MAX_HOST_DELAY_MS, sum / n) : 0
    }

    // Ev sahibinin bekletilen girdisi: süresi dolanlar sırayla uygulanır, aradaki vuruş kaybolmaz
    function applyLocal (t) {
      const due = t - hostDelay()
      while (localQueue.length && localQueue[0].at <= due) {
        const q = localQueue.shift()
        local = q.inp
        if (q.inp.kick) localLatch = true
      }
    }

    function mapEvent (m, e) {
      const ep = m.epoch
      const idOf = (slot) => (slot === null || slot === undefined || !hasOwn(m.ids, slot) ? null : m.ids[slot])
      if (e.e === 'play') return { e: 'play', epoch: ep, by: idOf(e.by) }
      if (e.e === 'goal') return { e: 'goal', epoch: ep, side: e.side, by: idOf(e.by), at: e.at }
      if (e.e === 'over') return { e: 'over', epoch: ep, winner: e.winner, why: e.why }
      if (e.e === 'kickoff') return { e: 'kickoff', epoch: ep, kick: e.kick }
      return { e: e.e, epoch: ep }
    }

    // Olay dinleyicisi maçı bitirebilir ya da yenisini başlatabilir, adım kendi maçıyla tamamlanır
    function stepOnce (t) {
      const m = match
      applyLocal(t)
      const inputs = {}
      Object.keys(peers).forEach((pid) => {
        const r = peers[pid]
        const slot = slotOf(r.id)
        if (slot === null || r.link !== 'ready') return
        inputs[slot] = { x: r.inp.x, y: r.inp.y, kick: r.inp.kick || r.kickLatch }
        r.kickLatch = false
      })
      if (m.self !== null) {
        inputs[m.self] = { x: local.x, y: local.y, kick: local.kick || localLatch }
        localLatch = false
      }
      const ev = P.step(m.world, inputs)
      netTick = netTick >= MAX_TICK ? 0 : netTick + 1
      ev.forEach((e) => emit(mapEvent(m, e)))
    }

    function snapOf (ackSeq) {
      const w = match.world
      return {
        tick: netTick,
        phase: w.phase,
        remaining: Math.min(MAX_REMAINING, Math.ceil(P.remaining(w) * 10 / TICK_HZ)),
        score: { red: Math.min(255, w.score.red), blue: Math.min(255, w.score.blue) },
        ackSeq: ackSeq,
        ball: copyDisc(w.ball),
        players: w.players.map((p) => ({ slot: p.slot, x: p.x, y: p.y, vx: p.vx, vy: p.vy, kick: p.kick }))
      }
    }

    // Onaylamış eşlere anlık görüntü: her eşe kendi hızında (30 ya da 20 Hz) ve kendi ackSeq değeriyle. Uzun aradan
    // sonraki döngüde (force) hıza bakılmadan gönderilir: kısılan sekmede oyuncular duraklamayı böyle görür.
    function sendSnaps (t, force) {
      sentAt[netTick % RTT_RING] = { tick: netTick, at: t }
      Object.keys(peers).forEach((pid) => {
        const r = peers[pid]
        if (r.link !== 'ready') return
        if (!force && netTick < r.nextSnap) return
        r.nextSnap = netTick + TICK_HZ / rateFor(r, t)
        if (!send(pid, encodeSnap(snapOf(r.seq < 0 ? 0 : r.seq)))) r.slowUntil = t + SLOW_HOLD_MS
      })
    }

    // Biriktiricili sabit adım. İki döngü arası PAUSE_GAP_MS'yi aşarsa geçen süre adımlanmaz, maç duraklar ve tick
    // gerçek zamanla aynı kalsın diye ileri alınır. Döngü RESUME_MS boyunca düzenli işleyince maç sürer.
    function runMatch (t) {
      const gap = t - lastLoop
      lastLoop = t
      const big = gap > PAUSE_GAP_MS
      if (big) {
        acc = 0
        steadySince = t
        netTick = Math.min(MAX_TICK, netTick + Math.floor(gap / TICK_MS))
        if (!lagPaused && P.pause(match.world)) {
          lagPaused = true
          emit({ e: 'paused' })
        }
      } else {
        acc += gap
        if (lagPaused && t - steadySince >= RESUME_MS) {
          lagPaused = false
          P.resume(match.world)
          emit({ e: 'resumed' })
        }
      }
      let n = 0
      while (acc >= TICK_MS && n < MAX_CATCHUP && match) {
        stepOnce(t)
        acc -= TICK_MS
        n++
      }
      if (acc >= TICK_MS) acc = 0
      if (match && (n > 0 || big)) sendSnaps(t, big)
    }

    function schedule (ms) {
      if (destroyed) return
      if (timer !== null) env.clearTimeout(timer)
      timer = env.setTimeout(loop, ms)
    }

    function loop () {
      timer = null
      if (destroyed) return
      const t = now()
      try {
        maintain(t)
        if (match) runMatch(t)
        else lastLoop = t
      } catch (err) {
        report(err)
      }
      schedule(match ? Math.max(1, Math.ceil(TICK_MS - acc)) : nextDue(t))
    }

    // Masadaki kişiler (ev sahibi hariç): [{ id, peerId }]. Listede olmayanın bağı bırakılır (closeLink).
    // Dönüş: liste geçerli mi
    function setPeers (list) {
      if (destroyed || !Array.isArray(list)) return false
      const ids = []
      const pids = []
      const ok = list.every((x) => {
        if (!isPlain(x) || !isKey(x.id) || !isKey(x.peerId) || x.id === me) return false
        if (ids.indexOf(x.id) >= 0 || pids.indexOf(x.peerId) >= 0) return false
        ids.push(x.id)
        pids.push(x.peerId)
        return true
      })
      if (!ok) return false
      const next = {}
      let added = false
      list.forEach((x) => {
        const old = peers[x.peerId]
        if (old && old.id === x.id) next[x.peerId] = old
        else {
          next[x.peerId] = newPeer(x.id, x.peerId)
          added = true
        }
      })
      Object.keys(peers).forEach((pid) => {
        const r = peers[pid]
        if (next[pid] === r || (!r.chan && r.link !== 'opening') || typeof env.closeLink !== 'function') return
        try {
          env.closeLink(pid)
        } catch (err) {
          report(err)
        }
      })
      peers = next
      if (added) schedule(0)
      return true
    }

    // Maçı başlatır. m: { epoch (kural motorunun maç kimliği), rules, kick, players: [{ id, slot, side }] } (takımdaki
    // kişiler, ev sahibi de olabilir). Süre ve gol sınırı kural motorundan (43) gelir. Aynı maç kimliği yeniden
    // verilirse bir şey değişmez. Dönüş: maç başladı veya zaten sürüyordu
    function startMatch (m) {
      if (destroyed || !isPlain(m) || !isEpoch(m.epoch) || P.RULES.indexOf(m.rules) < 0) return false
      if (P.TEAMS.indexOf(m.kick) < 0 || !Array.isArray(m.players)) return false
      if (match && match.epoch === m.epoch) return true
      const slots = {}
      const ids = {}
      const ok = m.players.every((p) => {
        if (!isPlain(p) || !isKey(p.id) || hasOwn(slots, p.id) || !isInt(p.slot, 0, MAX_SLOTS - 1)) return false
        if (hasOwn(ids, p.slot) || P.TEAMS.indexOf(p.side) < 0) return false
        slots[p.id] = p.slot
        ids[p.slot] = p.id
        return true
      })
      if (!ok) return false
      let world = null
      try {
        world = P.createWorld({
          rules: m.rules,
          secs: H.PRESETS[m.rules].secs,
          goals: H.goalLimit(m.rules),
          kick: m.kick,
          players: m.players.map((p) => ({ slot: p.slot, side: p.side }))
        })
      } catch (err) {
        return false
      }
      const t = now()
      match = { epoch: m.epoch, slots: slots, ids: ids, self: hasOwn(slots, me) ? slots[me] : null, world: world }
      lastLoop = t
      acc = 0
      lagPaused = false
      local = { x: 0, y: 0, kick: false }
      localQueue = []
      localLatch = false
      rehello(t)
      schedule(0)
      return true
    }

    // Maç bitti ya da kaldırıldı (sonuç, lobi, masa kapandı): dünya bırakılır, el lobi kimliğiyle sıkışılır
    function endMatch () {
      if (destroyed || !match) return false
      match = null
      lagPaused = false
      localQueue = []
      rehello(now())
      schedule(0)
      return true
    }

    // Ev sahibinin kendi girdisi { x, y, kick }. Maçta yuvası yoksa yok sayılır.
    function setInput (raw) {
      if (destroyed || !match || match.self === null) return
      localQueue.push({ at: now(), inp: P.normalizeInput(raw) })
      if (localQueue.length > MAX_LOCAL_QUEUE) localQueue.shift()
    }

    function handleInput (r, msg, t) {
      if (r.link !== 'ready' || slotOf(r.id) === null) return
      if (t - r.win >= 1000 || t < r.win) {
        r.win = t
        r.n = 0
      }
      r.n++
      if (r.n > MAX_INPUT_RATE) return
      if (r.seq >= 0 && !seqNewer(msg.seq, r.seq)) return
      r.seq = msg.seq
      r.inp = P.normalizeInput({ x: msg.x, y: msg.y, kick: msg.kick })
      if (msg.kick) r.kickLatch = true
      const s = sentAt[msg.lastTick % RTT_RING]
      if (s && s.tick === msg.lastTick) {
        const d = t - s.at
        if (d >= 0 && d <= MAX_RTT_MS) r.rtt = r.rtt === null ? d : r.rtt + (d - r.rtt) / 8
      }
    }

    // Oyun veri kanalından gelen veri (36-oyun.js onData). Yalnızca kaydı olan eşten ve o eşin kişisinden.
    function onData (peerId, userId, data) {
      if (destroyed || !hasOwn(peers, peerId)) return
      const r = peers[peerId]
      if (String(userId) !== r.id) return
      const msg = decode(data)
      if (!msg) return
      if (msg.type === 'input') handleInput(r, msg, now())
      else if (msg.type === 'hello_ack') {
        if (!r.chan || r.link === 'ready' || msg.epoch !== r.helloEpoch || msg.slot !== r.helloSlot) return
        if (msg.epoch !== epochNow() || msg.slot !== slotOf(r.id)) return
        r.everReady = true
        resetInput(r)
        setLink(r, 'ready')
      }
    }

    // Ses motorunun oyun olayları: link-open, link-close, link-failed, peer-ready, peer-leave, reset
    function onVoiceEvent (evt) {
      if (destroyed || !isPlain(evt)) return
      if (evt.type === 'reset') {
        Object.keys(peers).forEach((pid) => linkLost(peers[pid], 'none'))
        return
      }
      if (!hasOwn(peers, evt.peerId)) return
      const r = peers[evt.peerId]
      if (evt.userId !== undefined && String(evt.userId) !== r.id) return
      const t = now()
      if (evt.type === 'link-open') {
        if (r.link !== 'waiting' && r.link !== 'ready') linkOpened(r, t)
      } else if (evt.type === 'link-close' || evt.type === 'peer-leave') {
        linkLost(r, 'none')
      } else if (evt.type === 'link-failed') {
        linkLost(r, 'failed')
      } else if (evt.type === 'peer-ready') {
        if (r.link === 'failed' && !r.chan) {
          r.tried = -Infinity
          setLink(r, 'none')
        }
        schedule(0)
      }
    }

    // Kişi kimliği -> none | waiting | ready | failed
    function links () {
      const out = {}
      Object.keys(peers).forEach((pid) => {
        out[peers[pid].id] = outward(peers[pid].link)
      })
      return out
    }

    // Çizim için dünyanın durumu (ara değer yok, ev sahibi fiziği kendisi yürütür) veya maç yoksa null
    function frame () {
      if (!match) return null
      const s = snapOf(0)
      return {
        tick: s.tick,
        phase: s.phase,
        remaining: s.remaining,
        score: s.score,
        ball: s.ball,
        players: s.players,
        me: match.self,
        paused: lagPaused
      }
    }

    function info () {
      const rtt = {}
      Object.keys(peers).forEach((pid) => {
        rtt[peers[pid].id] = peers[pid].rtt
      })
      return { tick: netTick, epoch: epochNow(), delay: hostDelay(), paused: lagPaused, rtt: rtt }
    }

    function destroy () {
      if (destroyed) return
      destroyed = true
      if (timer !== null) env.clearTimeout(timer)
      timer = null
      match = null
      peers = {}
      sentAt = []
    }

    schedule(0)

    return Object.freeze({
      setPeers: setPeers,
      startMatch: startMatch,
      endMatch: endMatch,
      setInput: setInput,
      onData: onData,
      onVoiceEvent: onVoiceEvent,
      links: links,
      frame: frame,
      info: info,
      destroy: destroy
    })
  }

  // ----- Oyuncu -----

  // env: now(), setTimeout, clearTimeout, send(peerId, ArrayBuffer) -> boolean, isteğe bağlı onEvent, onError.
  // opts: { hostId, hostPeer } ev sahibinin kullanıcı ve eş kimliği (setHost ile değişebilir).
  // Olaylar: { e: 'hello', epoch, slot } yeni maç kimliğiyle el sıkışıldı (lobide epoch null), { e: 'lost' } ev
  // sahibiyle bağ koptu.
  function createPlayer (env, opts) {
    checkEnv(env)
    if (!isPlain(opts) || !isKey(opts.hostId) || !isKey(opts.hostPeer)) throw fail('bad_options')
    const report = reporter(env)
    const emit = emitter(env, report)
    const send = sender(env, report)
    let hostId = opts.hostId
    let hostPeer = opts.hostPeer
    let hello = false
    let epoch = null
    let slot = null
    let snaps = []
    let lastTick = -1
    let interval = TICK_HZ / SNAP_HZ
    let jitter = 0
    let rt = null
    let lastFrame = 0
    let seq = 0
    let sentSeq = []
    let rtt = null
    let inp = { x: 0, y: 0, kick: false }
    let kickPending = false
    let dirty = false
    let lastSent = -Infinity
    let timer = null
    let destroyed = false

    function now () {
      return env.now()
    }

    function clearTimer () {
      if (timer !== null) env.clearTimeout(timer)
      timer = null
    }

    function resetMatch () {
      snaps = []
      lastTick = -1
      jitter = 0
      rt = null
      seq = 0
      sentSeq = []
      rtt = null
      kickPending = false
      dirty = false
      clearTimer()
    }

    function lose () {
      const had = hello
      hello = false
      epoch = null
      slot = null
      resetMatch()
      if (had) emit({ e: 'lost' })
    }

    function canSend () {
      return hello && epoch !== null && slot !== null
    }

    function sendInput (t) {
      clearTimer()
      if (!canSend()) return
      const kick = inp.kick || kickPending
      send(hostPeer, encodeInput({ seq: seq, lastTick: lastTick < 0 ? 0 : lastTick, kick: kick, x: inp.x, y: inp.y }))
      sentSeq[seq % RTT_RING] = { seq: seq, at: t }
      seq = (seq + 1) & MAX_SEQ
      lastSent = t
      // Gönderilmeden bırakılan vuruş bir kez basılı gitti, bırakılış ayrıca gönderilir
      dirty = kickPending && !inp.kick
      kickPending = false
      if (dirty) later(t)
    }

    function later (t) {
      if (timer !== null) return
      timer = env.setTimeout(() => {
        timer = null
        if (destroyed || !dirty) return
        trySend(now())
      }, Math.max(1, Math.ceil(lastSent + MIN_INPUT_MS - t)))
    }

    // Girdi değişince hemen, ama en çok saniyede 60 kez gönderilir
    function trySend (t) {
      if (!canSend()) return
      if (t - lastSent >= MIN_INPUT_MS) sendInput(t)
      else later(t)
    }

    function onHello (msg) {
      if (!hello || msg.epoch !== epoch || msg.slot !== slot) {
        hello = true
        epoch = msg.epoch
        slot = msg.slot
        resetMatch()
        interval = TICK_HZ / msg.snapHz
        emit({ e: 'hello', epoch: epoch, slot: slot })
      }
      send(hostPeer, encodeHelloAck({ epoch: msg.epoch, slot: msg.slot }))
    }

    function onSnap (msg, t) {
      if (!hello || epoch === null || msg.tick <= lastTick) return
      const prev = snaps.length ? snaps[snaps.length - 1] : null
      if (prev) {
        const dt = msg.tick - prev.tick
        if (dt <= TICK_HZ) {
          interval += (dt - interval) / 8
          jitter += (Math.abs(t - prev.at - dt * TICK_MS) - jitter) / 8
        }
      }
      msg.at = t
      snaps.push(msg)
      if (snaps.length > KEEP_SNAPS) snaps.shift()
      lastTick = msg.tick
      const s = sentSeq[msg.ackSeq % RTT_RING]
      if (s && s.seq === msg.ackSeq) {
        const d = t - s.at
        if (d >= 0 && d <= MAX_RTT_MS) rtt = rtt === null ? d : rtt + (d - rtt) / 8
      }
      // Her anlık görüntüye girdiyle yanıt: kayıp girdi yinelenir, ev sahibi gidiş dönüşü ölçer
      if (canSend() && t - lastSent >= MIN_INPUT_MS) sendInput(t)
    }

    // Oyun veri kanalından gelen veri. Yalnızca ev sahibinin eşinden.
    function onData (peerId, userId, data) {
      if (destroyed || peerId !== hostPeer || String(userId) !== hostId) return
      const msg = decode(data)
      if (!msg) return
      if (msg.type === 'hello') onHello(msg)
      else if (msg.type === 'snap') onSnap(msg, now())
    }

    function onVoiceEvent (evt) {
      if (destroyed || !isPlain(evt)) return
      if (evt.type === 'reset') return lose()
      if (evt.peerId !== hostPeer) return
      if (evt.type === 'link-close' || evt.type === 'link-failed' || evt.type === 'peer-leave') lose()
    }

    // Ev sahibinin eşi değişti (ör. yeniden bağlandı)
    function setHost (id, peerId) {
      if (destroyed || !isKey(id) || !isKey(peerId)) return false
      if (id === hostId && peerId === hostPeer) return true
      hostId = id
      hostPeer = peerId
      lose()
      return true
    }

    // Yerel girdi { x, y, kick }
    function setInput (raw) {
      if (destroyed) return
      const n = P.normalizeInput(raw)
      if (n.x === inp.x && n.y === inp.y && n.kick === inp.kick) return
      if (n.kick && !inp.kick) kickPending = true
      inp = n
      dirty = true
      trySend(now())
    }

    function bufferTicks () {
      const base = BUFFER_SNAPS * interval
      return Math.min(MAX_BUFFER_MS / TICK_MS, base + 2 * jitter / TICK_MS)
    }

    // Çizim saati (tick): yerel zamanla ilerler, en yeni anlık görüntünün varışına göre tampon kadar geriden
    // yumuşakça düzeltilir. Fark çok büyükse (duraklama, uzun kayıp, sekme gizliydi) doğrudan atlanır.
    function advance (t) {
      const newest = snaps[snaps.length - 1]
      const target = newest.tick + (t - newest.at) / TICK_MS - bufferTicks()
      const gap = t - lastFrame
      if (rt === null || gap > MAX_FRAME_GAP_MS || gap < 0 || Math.abs(target - rt) > RESYNC_TICKS) {
        rt = target
      } else {
        const prev = rt
        rt += gap / TICK_MS
        rt += (target - rt) * Math.min(1, gap / CORRECT_MS)
        if (rt < prev) rt = prev
      }
      lastFrame = t
    }

    // Çizim için ara değerli durum veya henüz anlık görüntü yoksa null. Biçim ev sahibinin frame() çıktısıyla aynı.
    function frame (at) {
      if (destroyed || !snaps.length) return null
      const t = typeof at === 'number' ? at : now()
      advance(t)
      const first = snaps[0]
      const newest = snaps[snaps.length - 1]
      const k = rt > newest.tick ? newest.tick : rt < first.tick ? first.tick : rt
      let i = snaps.length - 1
      while (i > 0 && snaps[i].tick > k) i--
      const a = snaps[i]
      const b = i + 1 < snaps.length ? snaps[i + 1] : a
      const dt = b.tick - a.tick
      const f = dt > 0 ? (k - a.tick) / dt : 0
      const pick = f < 0.5 ? a : b
      const players = pick.players.map((pb) => {
        const pa = a.players.filter((x) => x.slot === pb.slot)[0]
        const qb = b.players.filter((x) => x.slot === pb.slot)[0]
        const d = pa && qb ? blendDisc(pa, qb, f, dt, P.MAX_PLAYER_SPEED) : copyDisc(pb)
        return { slot: pb.slot, x: d.x, y: d.y, vx: d.vx, vy: d.vy, kick: pb.kick }
      })
      return {
        tick: k,
        phase: a.phase,
        remaining: a.remaining,
        score: { red: a.score.red, blue: a.score.blue },
        ball: blendDisc(a.ball, b.ball, f, dt, P.MAX_BALL_SPEED),
        players: players,
        me: slot,
        paused: a.phase === 'paused'
      }
    }

    // age: en yeni anlık görüntüden bu yana geçen ms (yoksa null), rtt: girdinin onayına kadar geçen ms (EWMA)
    function state () {
      const t = now()
      return {
        ready: hello,
        epoch: epoch,
        slot: slot,
        tick: lastTick,
        age: snaps.length ? t - snaps[snaps.length - 1].at : null,
        rtt: rtt,
        buffer: snaps.length ? bufferTicks() * TICK_MS : null
      }
    }

    function destroy () {
      if (destroyed) return
      destroyed = true
      clearTimer()
      snaps = []
    }

    return Object.freeze({
      setHost: setHost,
      setInput: setInput,
      onData: onData,
      onVoiceEvent: onVoiceEvent,
      frame: frame,
      state: state,
      destroy: destroy
    })
  }

  return Object.freeze({
    VERSION: VERSION,
    TYPES: TYPES,
    PHASES: Object.freeze(PHASES.slice()),
    LINK_STATES: Object.freeze(LINK_STATES.slice()),
    HELLO_BYTES: HELLO_BYTES,
    ACK_BYTES: ACK_BYTES,
    INPUT_BYTES: INPUT_BYTES,
    SNAP_BASE: SNAP_BASE,
    SNAP_PER: SNAP_PER,
    MAX_BYTES: MAX_BYTES,
    NO_SLOT: NO_SLOT,
    POS_SCALE: POS_SCALE,
    VEL_SCALE: VEL_SCALE,
    AXIS_SCALE: AXIS_SCALE,
    MAX_REMAINING: MAX_REMAINING,
    TICK_HZ: TICK_HZ,
    SNAP_HZ: SNAP_HZ,
    SNAP_HZ_LOW: SNAP_HZ_LOW,
    PAUSE_GAP_MS: PAUSE_GAP_MS,
    RESUME_MS: RESUME_MS,
    MAX_HOST_DELAY_MS: MAX_HOST_DELAY_MS,
    MAX_INPUT_RATE: MAX_INPUT_RATE,
    MIN_INPUT_MS: MIN_INPUT_MS,
    HELLO_RESEND_MS: HELLO_RESEND_MS,
    HELLO_TIMEOUT_MS: HELLO_TIMEOUT_MS,
    OPEN_TIMEOUT_MS: OPEN_TIMEOUT_MS,
    LINK_RETRY_MS: LINK_RETRY_MS,
    SLOW_HOLD_MS: SLOW_HOLD_MS,
    BUFFER_SNAPS: BUFFER_SNAPS,
    MAX_BUFFER_MS: MAX_BUFFER_MS,
    encodeHello: encodeHello,
    encodeHelloAck: encodeHelloAck,
    encodeInput: encodeInput,
    encodeSnap: encodeSnap,
    decode: decode,
    seqNewer: seqNewer,
    createHost: createHost,
    createPlayer: createPlayer
  })
})(window.TelsizHexballPhysics, window.TelsizHexball)
