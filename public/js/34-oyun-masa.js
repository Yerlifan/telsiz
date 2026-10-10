'use strict'

// Oyun masası yöneticisi (window.TelsizGameDesk). DOM, saat ve sözlük kullanmaz: zaman env.now(), ağ env.send,
// anahtarlar env.keys ile gelir. 36-oyun.js ortamı kurar, ses olaylarını onVoiceEvent ile iletir ve masa etkinken
// tick() çağrısını 250 ms'de bir yapar. Yıldız düzeni: kurpiyer tek otoritedir, oyuncular yalnızca kurpiyerle konuşur.
// - Kurpiyer: masa, koltuklar, davetler, uygulamanın tam durumu ve gönderim kuyruğu. Koltuk başına en çok bir ileti
//   uçuştadır, arada gelen değişiklikler koltuğu yalnızca kirli işaretler ve sonraki gönderim en yeni durumu taşır.
//   Koltuğa özel yanıtlar ve sync yanıtları kısılır, 429 sonrası geri çekilir, boştaki koltuğa tazeleme gider.
// - Oyuncu: davet, katılım, bekleyen hamle (aynı seq ile yeniden gönderim), sürüm kuralı ve canlılık.
// Oyun kuralları uygulamadadır (env.apps, ör. TelsizRenk) ve genel sözleşmeyle çağrılır. İleti biçimleri, bağ
// denetimi ve sayaç kuralları TelsizGame (33-oyun-protokol.js) içindedir. Her yöntem eşzamanlıdır, değişiklikten
// sonra gönderim kuyruğu boşaltılır, bildirimler (env.onNotice) ve env.onChange en dışta bir kez çağrılır.

window.TelsizGameDesk = (function (G) {
  const TIMES = Object.freeze({
    JOIN_TIMEOUT_MS: 10000,
    ACK_RESEND_MS: 10000,
    SLOW_MS: 8000,
    KEEPALIVE_MS: 15000,
    SILENT_SYNC_MS: 25000,
    SYNC_MIN_MS: 10000,
    SILENT_END_MS: 45000,
    SEAT_REPLY_MIN_MS: 1000,
    SYNC_REPLY_MIN_MS: 5000,
    PLAIN_REPLY_MIN_MS: 5000,
    HOLD_JOIN_MS: 10000,
    AWAY_MS: 60000,
    BACKOFF_MS: Object.freeze([2000, 4000, 8000, 16000, 30000]),
    INVITE_NOTIFY_MIN_MS: 30000,
    INVITE_RESEND_MS: 15000,
    SELF_DELAY_MS: 300
  })
  const BACKOFF = TIMES.BACKOFF_MS
  // Kurpiyere gelen iç ileti türleri. Oyuncuya gelen tek iç tür state'tir.
  const DEALER_KINDS = ['join', 'act', 'sync', 'leave']
  // Kurpiyerin kendi sıra dışı hamleleri ağdan gelen hamlelerle eşit yarışsın diye gecikmeli işlenir
  const DELAYED_MOVES = ['last', 'catch']
  // Masa yöneticisinin kendi hata kodları (uygulama kodlarına ek): send, locked, join_timeout
  const ERRORS = ['send', 'locked', 'join_timeout']

  function noop () {}

  function hasOwn (obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key)
  }

  // Uygulamanın fırlattığı hata kodu. Kodsuz hata bad_move sayılır.
  function errCode (e) {
    return e && G.isCode(e.code) ? e.code : 'bad_move'
  }

  function copyAck (a) {
    return a.ok ? { seq: a.seq, ok: true } : { seq: a.seq, ok: false, code: a.code }
  }

  function create (env) {
    // Masa kaydı: kurpiyerde role 'dealer', oyuncuda role 'player'. Masa Kur ekranı (yerel) ayrı tutulur.
    let T = null
    let setup = null
    // Odadaki her kurpiyerin son geçerli daveti ve masa kimliğinin ilk davetteki kurpiyeri
    let seen = {}
    let owners = {}
    // Kurpiyer başına reddedilen davetin ni değeri: aynı davetin kopyası yeniden gösterilmez
    let declined = {}
    // Masadan ayrılan sayfanın son leave iletisi: kurpiyer beni oturtmaya devam ederse yeniden gider
    let left = null
    // Kişi başına son düz yanıt (reject, close gone, çıkarılma bildirimi) ve son davet bildirimi
    let plainAt = {}
    let notifyAt = {}
    let error = null
    let newEvents = []
    let runEvents = []
    let notices = []
    let depth = 0
    let rev = 0
    let sig = ''
    let lastTurn = false

    function now () {
      return env.now()
    }

    function myId () {
      const id = env.me()
      const s = id === null || id === undefined ? '' : String(id)
      return G.isId(s) ? s : null
    }

    function chan () {
      const c = env.channel()
      const s = c === null || c === undefined ? '' : String(c)
      return G.isChannel(s) ? s : null
    }

    function appOf (id) {
      const apps = env.apps || {}
      return G.isApp(id) && hasOwn(apps, id) && apps[id] ? apps[id] : null
    }

    function keysFor (uid) {
      const k = env.keys(uid)
      return k && typeof k === 'object' ? k : { ok: false, reason: 'gone' }
    }

    // Anahtar sorunu: null veya neden (locked, blocked, gone, loading, unverified, changed)
    function keyProblem (uid) {
      const k = keysFor(uid)
      return k.ok === true ? null : String(k.reason || 'gone')
    }

    function locked () {
      if (typeof env.locked === 'function') return Boolean(env.locked())
      const me = myId()
      return me !== null && keyProblem(me) === 'locked'
    }

    function blocked (uid) {
      return Boolean(env.isBlocked(uid))
    }

    function dealing () {
      return T !== null && T.role === 'dealer'
    }

    function playing () {
      return T !== null && T.role === 'player' && T.ended === null
    }

    function notice (kind, data) {
      notices.push([kind, data === undefined ? null : data])
    }

    function fault (code) {
      error = code
      notice('error', code)
    }

    function send (peerId, p, done) {
      if (typeof p !== 'string' || typeof peerId !== 'string' || !peerId) return 'bad_message'
      const code = env.send(peerId, p, done || noop)
      return typeof code === 'string' ? code : 'bad_message'
    }

    function plainMsg (k, g, ch, extra) {
      return Object.assign({ v: G.VERSION, ctx: G.CTX, k: k, g: g, ch: ch }, extra)
    }

    function sendPlain (peerId, obj, done) {
      const p = G.encodePlain(obj)
      return p ? send(peerId, p, done) : 'bad_message'
    }

    // Düz yanıt kısması: kişi başına PLAIN_REPLY_MIN_MS aralıkla bir yanıt
    function plainAllowed (uid) {
      const at = plainAt[uid]
      if (at !== undefined && now() - at < TIMES.PLAIN_REPLY_MIN_MS) return false
      plainAt[uid] = now()
      return true
    }

    // Odadakiler (kendim hariç): geçerli ve benzersiz { userId, peerId }
    function roomPeers () {
      const me = myId()
      const list = env.roomPeers()
      const items = Array.isArray(list) ? list : []
      const out = []
      const ids = {}
      items.forEach((x) => {
        const uid = x && x.userId !== undefined && x.userId !== null ? String(x.userId) : ''
        if (!G.isId(uid) || uid === me || ids[uid] || typeof x.peerId !== 'string' || !x.peerId) return
        ids[uid] = true
        out.push({ userId: uid, peerId: x.peerId })
      })
      return out
    }

    function limits (A) {
      return { min: Math.max(2, A.MIN_PLAYERS), max: Math.min(G.MAX_SEATS, A.MAX_PLAYERS) }
    }

    // ----- Kurpiyer: koltuklar ve sürüm -----

    function seatOf (uid) {
      return T.seats.find((s) => s.id === uid) || null
    }

    function seatIds () {
      return T.seats.map((s) => s.id)
    }

    function newSeat (uid, peerId, ni) {
      return {
        id: uid,
        peerId: peerId,
        ni: ni,
        keyIssue: null,
        offline: false,
        sendErr: false,
        dirty: true,
        onlySelf: false,
        inflight: false,
        syncWant: false,
        lastSendAt: null,
        lastReplyAt: null,
        lastSyncReplyAt: null,
        backoffIdx: 0,
        retryAt: 0,
        ack: { seq: T.lastSeq[uid] || 0, ok: true }
      }
    }

    function markAll (seat) {
      seat.dirty = true
      seat.onlySelf = false
    }

    // Yalnızca bu koltuğa özel yanıt: zaten bekleyen tam gönderim varsa ona katılır
    function markSelf (seat) {
      if (seat.dirty) return
      seat.dirty = true
      seat.onlySelf = true
    }

    // Masa sürümü artar ve bütün koltuklar kirlenir
    function bump () {
      T.r++
      T.seats.forEach(markAll)
    }

    function trackTurn () {
      const id = T.game && T.ph === 'play' ? T.A.turnOf(T.game) : null
      if (id !== T.turnId) {
        T.turnId = id
        T.turnSince = now()
      }
    }

    // "Uzakta": sırası AWAY_MS süresini aşan koltuk
    function awayList () {
      if (T.ph !== 'play' || T.turnId === null || now() - T.turnSince <= TIMES.AWAY_MS) return []
      return seatOf(T.turnId) ? [T.turnId] : []
    }

    function stamp (list) {
      const items = Array.isArray(list) ? list : []
      const out = []
      items.forEach((ev) => {
        if (!G.isPlain(ev) || !G.isCode(ev.e)) return
        const item = { r: T.r }
        Object.keys(ev).forEach((key) => {
          if (key !== 'r') item[key] = ev[key]
        })
        out.push(item)
      })
      return out
    }

    // Uygulamanın döndürdüğü yeni durum: sürüm artar, olaylar yeni sürümle damgalanır, bütün koltuklar kirlenir
    function applyChange (res, actor) {
      if (actor !== null && actor === T.turnId) T.turnSince = now()
      T.game = res.state
      T.r++
      const stamped = stamp(res.events)
      T.events = T.events.concat(stamped).slice(-G.MAX_EVENTS)
      runEvents = runEvents.concat(stamped)
      if (T.ph === 'play' && T.A.isOver(T.game)) T.ph = 'over'
      trackTurn()
      T.away = awayList()
      T.seats.forEach(markAll)
    }

    function bodyFor (uid, ack, view, withMine) {
      return {
        ph: T.ph,
        app: T.app,
        rules: T.rules,
        seats: seatIds(),
        rd: T.rd,
        ack: copyAck(ack),
        view: view,
        mine: view !== null && withMine ? T.A.privateView(T.game, uid) : null,
        ev: T.events.slice(-G.MAX_EVENTS),
        away: T.away.slice()
      }
    }

    function publicNow () {
      return T.game && T.ph !== 'lobby' ? T.A.publicView(T.game) : null
    }

    function stateMsg (uid, ni, b) {
      return { v: G.VERSION, ctx: G.CTX, k: 'state', g: T.g, ch: T.ch, from: T.dealer, to: uid, r: T.r, ni: ni, b: b }
    }

    // Kurpiyerin gördüğü anahtar sorunu davette yalnızca INVITE_KEYS içindeyse gider. reuse: aynı kişiye aynı
    // bağlantıdan giden önceki davetin ni değeri korunur (Başlat'la yarışan join reject started alsın).
    function sendInvite (uid, peerId, reuse) {
      if (blocked(uid)) return
      const reason = keyProblem(uid)
      if (reason === 'blocked') return
      const prev = T.invites[uid]
      let ni = reuse && prev && prev.peerId === peerId ? prev.ni : null
      if (ni === null) {
        try {
          ni = G.randomHex16(env.rng)
        } catch (e) {
          fault(errCode(e))
          return
        }
      }
      const keep = Boolean(prev) && (prev.status === 'declined' || prev.status === 'cannot')
      const inv = {
        ni: ni,
        peerId: peerId,
        status: keep ? prev.status : 'waiting',
        key: keep ? prev.key : null,
        at: now(),
        sent: false,
        resend: true
      }
      T.invites[uid] = inv
      const table = T
      const code = sendPlain(peerId, plainMsg('invite', T.g, T.ch, {
        app: T.app,
        dealer: T.dealer,
        ph: T.ph,
        rules: T.rules,
        seats: seatIds(),
        max: T.max,
        ni: ni,
        key: G.INVITE_KEYS.indexOf(reason) >= 0 ? reason : null
      }), (res) => {
        run(() => {
          if (T === table && T.invites[uid] === inv && res !== true) inv.sent = false
        })
      })
      inv.sent = code === 'ok'
    }

    function inviteUnseated (reuse) {
      roomPeers().forEach((x) => {
        if (!seatOf(x.userId)) sendInvite(x.userId, x.peerId, reuse)
      })
    }

    // Koltuklara ve davet edilenlere düz close (kişi başına bir kez)
    function closeAll (why) {
      const msg = plainMsg('close', T.g, T.ch, { why: why })
      const done = {}
      const to = (peerId) => {
        if (!peerId || done[peerId]) return
        done[peerId] = true
        sendPlain(peerId, msg)
      }
      T.seats.forEach((s) => {
        if (s.id !== T.dealer) to(s.peerId)
      })
      Object.keys(T.invites).forEach((uid) => to(T.invites[uid].peerId))
    }

    // Kimlik kilitlendi: masa yerelde kapanır, hâlâ seste isem oyunculara düz close gider
    function lockClose () {
      if (chan()) closeAll('dealer')
      T = null
      notice('ended', { reason: 'keys' })
    }

    // Koltuk kaldırma (leave, peer-leave, removeSeat). Kurpiyerin koltuğu (seats[0]) kaldırılmaz. Oyun durumu
    // varsa (play ve over) uygulama koltuğu siler, böylece koltuk sırası görünümle aynı kalır.
    function dropSeat (uid, why) {
      const k = T.seats.findIndex((s) => s.id === uid)
      if (k <= 0) return false
      if (T.game) {
        let res = null
        try {
          res = T.A.removePlayer(T.game, uid, env.rng)
        } catch (e) {
          fault(errCode(e))
          closeAll('dealer')
          T = null
          return false
        }
        T.seats.splice(k, 1)
        applyChange(res, null)
      } else {
        T.seats.splice(k, 1)
        bump()
      }
      delete T.held[uid]
      if (why !== 'removed') notice('left', { id: uid, why: why })
      return true
    }

    // Çıkarılan oyuncuya son durum: koltuklarda o yok ve eli boş (TelsizGame.isRemovalBody)
    function sendFarewell (uid) {
      const rec = T.removed[uid]
      const keys = keysFor(uid)
      if (!rec || keys.ok !== true) return
      const b = bodyFor(uid, { seq: T.lastSeq[uid] || 0, ok: true }, publicNow(), false)
      const p = G.sealInner(env.dm, stateMsg(uid, rec.ni, b), keys.pk, keys.sk)
      if (p) send(rec.peerId, p)
    }

    function sendFault (seat) {
      if (seat.sendErr) return
      seat.sendErr = true
      fault('send')
    }

    // 4.10.1 boşaltma: her kirli koltuk için tek uçuş, geri çekilme ve kısma kurallarıyla tam durum
    function dealerFlush () {
      if (!dealing()) return
      const t = now()
      let view
      T.seats.forEach((seat) => {
        if (seat.id === T.dealer) {
          seat.dirty = false
          return
        }
        if (seat.syncWant) {
          // Zaten gidecek bir durum sync yanıtının yerine geçer
          if (seat.dirty) {
            seat.syncWant = false
          } else if (seat.lastSyncReplyAt === null || t - seat.lastSyncReplyAt >= TIMES.SYNC_REPLY_MIN_MS) {
            seat.syncWant = false
            seat.lastSyncReplyAt = t
            markSelf(seat)
          }
        }
        if (!seat.dirty || seat.inflight || t < seat.retryAt) return
        if (seat.onlySelf && seat.lastReplyAt !== null && t - seat.lastReplyAt < TIMES.SEAT_REPLY_MIN_MS) return
        const keys = keysFor(seat.id)
        if (keys.ok !== true) {
          seat.keyIssue = String(keys.reason || 'gone')
          return
        }
        seat.keyIssue = null
        if (view === undefined) view = publicNow()
        const p = G.sealInner(env.dm, stateMsg(seat.id, seat.ni, bodyFor(seat.id, seat.ack, view, true)), keys.pk, keys.sk)
        if (!p) {
          seat.dirty = false
          sendFault(seat)
          return
        }
        const reply = seat.onlySelf
        const table = T
        const code = send(seat.peerId, p, (res) => {
          run(() => seatDone(table, seat, res))
        })
        if (code === 'ok') {
          seat.inflight = true
          seat.dirty = false
          seat.onlySelf = false
          seat.offline = false
          seat.syncWant = false
          // Koltuğa özel yanıt (sync yanıtı, reddedilen hamle) tazeleme sayılmaz: sessiz koltuğa KEEPALIVE_MS
          // aralığı yanıtlardan bağımsız sürer (SILENT_END_MS iki tazeleme ve iki sync kaybını karşılar)
          if (reply) seat.lastReplyAt = t
          else seat.lastSendAt = t
        } else {
          // Kirli kalır: bağlantı bekleniyorsa peer-ready, değilse kısa bir bekleme sonrası yeniden denenir
          seat.offline = code === 'not_ready' || code === 'no_peer'
          seat.retryAt = t + BACKOFF[0]
        }
      })
    }

    function seatDone (table, seat, res) {
      if (T !== table || T.seats.indexOf(seat) < 0) return
      seat.inflight = false
      if (res === true) {
        seat.backoffIdx = 0
        seat.sendErr = false
        return
      }
      // 403: kendi oturumum seste değil, ardından reset gelir. 400: yazılım hatası, kirli kalmaz.
      if (res === 403) return
      if (res === 400) {
        sendFault(seat)
        return
      }
      seat.dirty = true
      if (res === 404) {
        // Alıcı artık etkin değil: peer-ready ya da peer-leave beklenir, uzun aralıkla yeniden denenir
        seat.offline = true
        seat.retryAt = now() + BACKOFF[BACKOFF.length - 1]
        return
      }
      seat.retryAt = now() + BACKOFF[Math.min(seat.backoffIdx, BACKOFF.length - 1)]
      seat.backoffIdx++
    }

    // ----- Kurpiyer: gelen iletiler -----

    function onDealerInner (peerId, uid, x) {
      if (!dealing() || x.g !== T.g) {
        // Kendimde olmayan masa: kurpiyer sayfayı yenilediyse oyuncular sonsuza kadar beklemesin
        if (!blocked(uid) && plainAllowed(uid)) sendPlain(peerId, plainMsg('close', x.g, x.ch, { why: 'gone' }))
        return
      }
      if (blocked(uid)) return
      if (x.k === 'join') {
        dealerJoin(peerId, uid, x)
        return
      }
      const seat = seatOf(uid)
      if (!seat || seat.peerId !== peerId) {
        // Kurpiyerin çıkardığı kişi yazmaya devam ederse son durum (kısmalı) yeniden gider
        if (!seat && x.k !== 'leave' && T.removed[uid] && T.removed[uid].peerId === peerId && plainAllowed(uid)) sendFarewell(uid)
        return
      }
      const order = G.seqOrder(T.lastSeq[uid] || 0, x.seq)
      if (order === 'old') return
      if (order === 'repeat') {
        if (x.k === 'sync') seat.syncWant = true
        else markSelf(seat)
        return
      }
      T.lastSeq[uid] = x.seq
      // Bu bağlantıdaki sayfa masayı tutuyor: yeniden bağlanma davetinin yinelenmesine gerek yok
      if (T.invites[uid]) T.invites[uid].resend = false
      if (x.k === 'leave') {
        dropSeat(uid, 'leave')
        return
      }
      if (x.k === 'sync') {
        seat.ack = { seq: x.seq, ok: true }
        seat.syncWant = true
        return
      }
      dealerAct(seat, x)
    }

    function dealerJoin (peerId, uid, x) {
      const inv = T.invites[uid]
      if (!inv || x.ni !== inv.ni || x.app !== T.app) return
      let seat = seatOf(uid)
      if (seat) {
        // Geri dönüş (yenilenmiş sayfa): koltuk yeni bağlantıya ve yeni davet değerine geçer
        seat.peerId = peerId
        seat.ni = x.ni
        seat.keyIssue = null
        seat.offline = false
        seat.retryAt = 0
        delete T.invites[uid]
        markAll(seat)
        return
      }
      if (T.ph !== 'lobby') {
        if (plainAllowed(uid)) sendPlain(peerId, plainMsg('reject', T.g, T.ch, { why: 'started' }))
        return
      }
      if (T.seats.length >= T.max) {
        inv.status = 'full'
        if (plainAllowed(uid)) sendPlain(peerId, plainMsg('reject', T.g, T.ch, { why: 'full' }))
        return
      }
      seat = newSeat(uid, peerId, x.ni)
      T.seats.push(seat)
      delete T.invites[uid]
      delete T.removed[uid]
      bump()
      notice('joined', { id: uid })
    }

    // 4.8 adım 4: hamle sonucu yalnızca bu koltuğa (ret) ya da bütün masaya (kabul) gider
    function dealerAct (seat, x) {
      let code = null
      let res = null
      if (T.ph !== 'play') {
        code = 'game_over'
      } else if (x.rd !== T.rd) {
        code = 'stale'
      } else {
        const move = T.A.validateMove(x.b)
        if (!move) {
          code = 'bad_move'
        } else {
          try {
            res = T.A.applyMove(T.game, seat.id, move, env.rng)
          } catch (e) {
            code = errCode(e)
          }
        }
      }
      if (code !== null) {
        seat.ack = { seq: x.seq, ok: false, code: code }
        markSelf(seat)
        return
      }
      seat.ack = { seq: x.seq, ok: true }
      applyChange(res, seat.id)
    }

    function onDecline (peerId, uid, x) {
      if (!dealing() || x.g !== T.g || T.ph !== 'lobby' || blocked(uid)) return
      const inv = T.invites[uid]
      if (!inv || inv.ni !== x.ni) return
      inv.status = x.why === 'user' ? 'declined' : 'cannot'
      inv.key = x.key
      notice('declined', { id: uid, why: x.why, key: x.key })
    }

    function selfAct (move) {
      const m = T.A.validateMove(move)
      if (!m) {
        fault('bad_move')
        return false
      }
      let res = null
      try {
        res = T.A.applyMove(T.game, T.dealer, m, env.rng)
      } catch (e) {
        fault(errCode(e))
        return false
      }
      error = null
      applyChange(res, T.dealer)
      return true
    }

    function dealerTick () {
      if (locked()) {
        lockClose()
        return
      }
      const t = now()
      Object.keys(T.held).forEach((uid) => {
        if (t - T.held[uid].at > TIMES.HOLD_JOIN_MS) delete T.held[uid]
      })
      while (dealing() && T.selfQueue.length && T.selfQueue[0].due <= t) {
        const item = T.selfQueue.shift()
        if (T.ph === 'play') selfAct(item.move)
      }
      if (!dealing()) return
      // Kaybolan davet aynı ni ile yeniden gider: lobide oturmamış ve yanıt vermemiş kişiye, her aşamada da yeniden
      // bağlanıp henüz dönmemiş koltuğa (yenilenmiş sayfa)
      roomPeers().forEach((x) => {
        const inv = T.invites[x.userId]
        if (!inv || !inv.resend || inv.status !== 'waiting' || inv.peerId !== x.peerId || t - inv.at < TIMES.INVITE_RESEND_MS) return
        if (T.ph === 'lobby' || seatOf(x.userId)) sendInvite(x.userId, x.peerId, true)
      })
      if (!dealing()) return
      // Canlılık: KEEPALIVE_MS boyunca hiçbir şey gitmemiş koltuğa son durum yeniden gider
      T.seats.forEach((s) => {
        if (s.id === T.dealer || s.dirty || s.inflight) return
        if (s.lastSendAt === null || t - s.lastSendAt > TIMES.KEEPALIVE_MS) markAll(s)
      })
      if (T.ph === 'play') {
        trackTurn()
        const away = awayList()
        if (away.join(',') !== T.away.join(',')) {
          T.away = away
          bump()
        }
      }
    }

    // ----- Oyuncu -----

    function offerStage (offer) {
      if (offer.seats.indexOf(myId()) >= 0) return 'rejoin'
      return offer.ph === 'lobby' ? 'invited' : 'busy'
    }

    function bestOffer () {
      let best = null
      Object.keys(seen).forEach((d) => {
        const o = seen[d]
        if (!best || o.at > best.at) best = o
      })
      return best
    }

    function newPlayer (offer, stage) {
      return {
        role: 'player',
        stage: stage,
        app: offer.app,
        A: appOf(offer.app),
        g: offer.g,
        ch: offer.ch,
        dealer: offer.dealer,
        dealerPeer: offer.peerId,
        inv: offer,
        ni: null,
        joinAt: 0,
        joinWanted: false,
        keyDeclined: false,
        lastR: 0,
        lastAckSeq: 0,
        mySeq: 0,
        lastSeenEvR: 0,
        b: null,
        view: null,
        mine: null,
        pending: null,
        lastStateAt: 0,
        lastSyncAt: null,
        syncing: false,
        syncSeq: 0,
        want: null,
        sentKind: null,
        inflight: false,
        retryAt: 0,
        backoffIdx: 0,
        rejected: null,
        ended: null
      }
    }

    function notifyInvite (offer, stage) {
      const at = notifyAt[offer.dealer]
      if (at !== undefined && now() - at < TIMES.INVITE_NOTIFY_MIN_MS) return
      notifyAt[offer.dealer] = now()
      notice('invite', { dealer: offer.dealer, app: offer.app, ph: offer.ph, rules: offer.rules, rejoin: stage === 'rejoin' })
    }

    function adopt (offer, notify) {
      const stage = offerStage(offer)
      T = newPlayer(offer, stage)
      if (notify && stage !== 'busy') notifyInvite(offer, stage)
    }

    // Katılmadan kapanan davet: varsa başka bir saklı davet gösterilir
    function dropOffer () {
      T = null
      const next = bestOffer()
      if (next) adopt(next, false)
    }

    function endPlayer (reason) {
      const o = seen[T.dealer]
      if (o && o.g === T.g) delete seen[T.dealer]
      T.stage = 'ended'
      T.ended = reason
      T.pending = null
      T.want = null
      notice('ended', { reason: reason })
    }

    function onInvite (peerId, uid, x) {
      if (!appOf(x.app) || blocked(uid)) return
      if (hasOwn(owners, x.g) && owners[x.g] !== uid) return
      owners[x.g] = uid
      const offer = {
        app: x.app,
        g: x.g,
        ch: x.ch,
        dealer: uid,
        peerId: peerId,
        ph: x.ph,
        rules: x.rules,
        seats: x.seats.slice(),
        max: x.max,
        ni: x.ni,
        key: x.key,
        at: now()
      }
      seen[uid] = offer
      if (T === null && x.ph === 'lobby' && declined[uid] === x.ni) {
        // Reddedilen davetin kopyası: yeniden gösterilmez, ret kurpiyere yeniden bildirilir (kaybolmuş olabilir)
        sendPlain(peerId, plainMsg('decline', x.g, x.ch, { ni: x.ni, why: 'user', key: null }))
        return
      }
      // Tek masa kuralı: davet gelince Masa Kur ekranı kapanır
      setup = null
      if (T === null) {
        adopt(offer, true)
        return
      }
      if (dealing()) {
        // 4.12: lobideki kurpiyer oyundaki masaya ya da kimliği küçük olan lobiye yer verir
        if (T.ph === 'lobby' && (x.ph !== 'lobby' || x.g < T.g)) {
          closeAll('superseded')
          adopt(offer, true)
        }
        return
      }
      if (playing() && T.g === x.g && T.dealer === uid) refreshInvite(offer)
    }

    // Aynı masanın yeni daveti (yeniden bağlanma, aşama değişimi, yeni ni)
    function refreshInvite (offer) {
      T.inv = offer
      if (T.stage === 'seated') return
      T.dealerPeer = offer.peerId
      if (T.stage === 'joining') {
        T.ni = offer.ni
        T.joinAt = now()
        T.want = 'join'
        return
      }
      if (T.stage === 'rejected') return
      const before = T.stage
      T.stage = offerStage(offer)
      T.keyDeclined = false
      if (T.stage !== before && T.stage !== 'busy') notifyInvite(offer, T.stage)
    }

    function onReject (peerId, uid, x) {
      if (!playing() || T.stage !== 'joining') return
      if (uid !== T.dealer || peerId !== T.dealerPeer || x.g !== T.g) return
      T.stage = 'rejected'
      T.rejected = x.why
      T.want = null
    }

    function onClose (peerId, uid, x) {
      const offer = seen[uid]
      const stored = Boolean(offer) && offer.g === x.g
      if (stored) delete seen[uid]
      if (!playing() || T.g !== x.g || T.dealer !== uid) return
      if (T.stage === 'joining' || T.stage === 'seated') {
        if (peerId !== T.dealerPeer) return
        endPlayer(x.why === 'dealer' ? 'closed' : x.why === 'superseded' ? 'superseded' : 'dealer_left')
        return
      }
      if (stored || peerId === T.dealerPeer) dropOffer()
    }

    function sendLeave (rec, keys) {
      const msg = { v: G.VERSION, ctx: G.CTX, k: 'leave', g: rec.g, ch: rec.ch, from: myId(), to: rec.dealer, seq: rec.seq }
      const p = G.sealInner(env.dm, msg, keys.pk, keys.sk)
      if (p) send(rec.peerId, p)
    }

    // Masadan ayrılma: iç leave gider ve saklanır (kaybolursa kurpiyerin durumu geldikçe yinelenir)
    function leaveTable () {
      const keys = keysFor(T.dealer)
      if (keys.ok !== true) return
      T.mySeq++
      left = { g: T.g, ch: T.ch, dealer: T.dealer, peerId: T.dealerPeer, ni: T.ni, seq: T.mySeq, at: now() }
      sendLeave(left, keys)
    }

    // Ayrıldığım masanın kurpiyeri beni hâlâ oturtuyor: leave kaybolmuş, yeniden gider (en sık PLAIN_REPLY_MIN_MS
    // aralıkla). Kurpiyerin sayacı benimkine yetiştiyse (sayacı sıfırdan başlayan yenilenmiş sayfa) leave onu geçer.
    // Dönüş: ileti bu kayıtla ilgiliydi.
    function onLeftState (peerId, uid, x) {
      const rec = left
      if (!rec || x.g !== rec.g || uid !== rec.dealer || peerId !== rec.peerId || x.ni !== rec.ni) return false
      if (playing() && T.g === x.g) return false
      const b = x.b
      if (!Array.isArray(b.seats) || b.seats.indexOf(myId()) < 0 || !G.isPlain(b.ack) || !G.isCount(b.ack.seq)) return true
      const keys = keysFor(rec.dealer)
      if (now() - rec.at < TIMES.PLAIN_REPLY_MIN_MS || keys.ok !== true) return true
      rec.seq = Math.max(rec.seq, b.ack.seq + 1)
      rec.at = now()
      sendLeave(rec, keys)
      return true
    }

    function innerMsg (k, extra) {
      return Object.assign({ v: G.VERSION, ctx: G.CTX, k: k, g: T.g, ch: T.ch, from: myId(), to: T.dealer }, extra)
    }

    // Durum kabul edilen aşamalar: katılırken, masadayken ve zaman aşımına uğramış katılımın geç gelen yanıtında
    // (kurpiyer oturttu ama yanıt kayboldu, tazeleme yeniden getirir)
    function stateWanted () {
      if (T.stage === 'joining' || T.stage === 'seated') return true
      return T.ni !== null && (T.stage === 'invited' || T.stage === 'rejoin' || T.stage === 'busy')
    }

    function onState (peerId, uid, x) {
      if (!playing() || !stateWanted()) return
      if (uid !== T.dealer || peerId !== T.dealerPeer || x.g !== T.g || x.ni !== T.ni) return
      const me = myId()
      const ctx = { dealer: T.dealer, me: me, r: x.r, app: T.app, rules: T.A.RULES }
      if (G.isRemovalBody(x.b, ctx)) {
        if (G.acceptState(T.lastR, T.lastAckSeq, x.r, x.b.ack.seq)) endPlayer('removed')
        return
      }
      const b = G.validStateBody(x.b, ctx)
      if (!b) return
      let view = null
      let mine = null
      if (b.view !== null) {
        view = T.A.validateView(b.view, b.seats)
        mine = view && b.mine !== null ? T.A.validatePrivate(b.mine, view, me) : null
        if (!view || !mine) return
      }
      if (!G.acceptState(T.lastR, T.lastAckSeq, x.r, b.ack.seq)) {
        // Aynı sürümün tazelemesi yalnızca canlılık sayılır
        if (x.r === T.lastR && b.ack.seq === T.lastAckSeq) {
          T.lastStateAt = now()
          T.syncing = false
        }
        return
      }
      const first = T.stage !== 'seated'
      T.stage = 'seated'
      T.lastR = x.r
      T.lastAckSeq = b.ack.seq
      T.mySeq = Math.max(T.mySeq, b.ack.seq)
      T.b = b
      T.view = view
      T.mine = mine
      T.lastStateAt = now()
      T.syncing = false
      if (T.want === 'join') T.want = null
      if (T.pending && b.ack.seq >= T.pending.seq) {
        if (b.ack.seq === T.pending.seq && !b.ack.ok) fault(b.ack.code)
        else if (b.ack.seq === T.pending.seq) error = null
        T.pending = null
        if (T.want === 'act') T.want = null
      }
      const fresh = b.ev.filter((e) => e.r > T.lastSeenEvR)
      if (fresh.length) {
        T.lastSeenEvR = fresh[fresh.length - 1].r
        // İlk durumdaki eski olaylar duyurulmaz
        if (!first) runEvents = runEvents.concat(fresh)
      }
    }

    // Oyuncunun gönderimi: tek alıcı (kurpiyer), tek uçuş. want: join | act | sync.
    // Bekleyen hamle varken sync gönderilmez, yalnızca aynı act aynı seq ile yeniden gider (4.9)
    function want (kind) {
      const k = kind === 'sync' && T.pending ? 'act' : kind
      if (k === 'sync') {
        if (T.want === 'sync' || (T.inflight && T.sentKind === 'sync')) return
        T.mySeq++
        T.syncSeq = T.mySeq
        T.syncing = true
      }
      T.want = k
    }

    function playerFlush () {
      if (!playing() || !T.want || T.inflight || now() < T.retryAt) return
      const kind = T.want
      let extra = null
      if (kind === 'join') {
        if (T.stage !== 'joining') {
          T.want = null
          return
        }
        extra = { app: T.app, ni: T.ni }
      } else if (kind === 'act') {
        if (!T.pending) {
          T.want = null
          return
        }
        extra = { seq: T.pending.seq, rd: T.pending.rd, b: T.pending.b }
      } else {
        extra = { seq: T.syncSeq }
      }
      const keys = keysFor(T.dealer)
      if (keys.ok !== true) {
        keyTrouble(keys.reason)
        return
      }
      const p = G.sealInner(env.dm, innerMsg(kind, extra), keys.pk, keys.sk)
      if (!p) {
        T.want = null
        fault('send')
        return
      }
      const table = T
      const code = send(T.dealerPeer, p, (res) => {
        run(() => playerDone(table, kind, res))
      })
      if (code === 'ok') {
        T.inflight = true
        T.sentKind = kind
        T.want = null
        if (kind === 'act') T.pending.sentAt = now()
        if (kind === 'sync') T.lastSyncAt = now()
      } else {
        T.retryAt = now() + BACKOFF[0]
      }
    }

    function playerDone (table, kind, res) {
      if (T !== table || !playing()) return
      T.inflight = false
      if (res === true) {
        T.backoffIdx = 0
        return
      }
      if (res === 403) return
      if (res === 400) {
        fault('send')
        return
      }
      if (!T.want) T.want = kind
      T.retryAt = now() + BACKOFF[Math.min(T.backoffIdx, BACKOFF.length - 1)]
      T.backoffIdx++
    }

    // Kurpiyerin anahtarı kullanılamıyor: yükleniyorsa beklenir, katılırken davete dönülür, masada masa biter
    function keyTrouble (reason) {
      if (reason === 'loading') return
      if (T.stage === 'joining') {
        T.stage = offerStage(T.inv)
        T.want = null
      } else if (T.stage === 'seated') {
        endPlayer('keys')
      }
    }

    function sendDecline (why, key) {
      sendPlain(T.dealerPeer, plainMsg('decline', T.g, T.ch, { ni: T.inv.ni, why: why, key: key }))
    }

    function playerTick () {
      const t = now()
      if (T.stage === 'joining' && t - T.joinAt > TIMES.JOIN_TIMEOUT_MS) {
        T.stage = offerStage(T.inv)
        T.want = null
        fault('join_timeout')
        return
      }
      if (T.stage !== 'seated') return
      const quiet = t - T.lastStateAt
      if (quiet > TIMES.SILENT_END_MS) {
        endPlayer('dealer_lost')
        // Kurpiyer yaşıyor ama durumları ulaşmıyorsa koltuğum oyunu bekletmesin
        leaveTable()
        return
      }
      if (T.pending) {
        if (T.pending.sentAt !== null && t - T.pending.sentAt >= TIMES.ACK_RESEND_MS && !T.inflight) want('act')
      } else if (quiet > TIMES.SILENT_SYNC_MS && (T.lastSyncAt === null || t - T.lastSyncAt >= TIMES.SYNC_MIN_MS)) {
        want('sync')
      }
    }

    // ----- Ses olayları -----

    function onMessage (peerId, uid, p) {
      if (typeof p !== 'string') return
      if (p.charAt(0) === '{') {
        const x = G.parsePlain(p, { ch: chan(), from: uid })
        if (!x) return
        if (x.k === 'invite') onInvite(peerId, uid, x)
        else if (x.k === 'decline') onDecline(peerId, uid, x)
        else if (x.k === 'reject') onReject(peerId, uid, x)
        else onClose(peerId, uid, x)
        return
      }
      if (p.indexOf('2.') !== 0) return
      const keys = keysFor(uid)
      if (keys.ok !== true) {
        const reason = String(keys.reason || 'gone')
        if (dealing()) {
          // Profil yüklenince recheck ile yeniden işlenir (kişi başına bir ileti)
          if (reason === 'loading') {
            T.held[uid] = { p: p, peerId: peerId, at: now() }
            return
          }
          const seat = seatOf(uid)
          if (seat && reason !== 'blocked') seat.keyIssue = reason
        } else if (playing() && uid === T.dealer && peerId === T.dealerPeer) {
          keyTrouble(reason)
        }
        return
      }
      const opened = G.openInner(env.dm, p, keys.pk, keys.sk)
      const x = opened && G.checkInner(opened, { ch: chan(), from: uid, to: myId() })
      if (!x) return
      if (DEALER_KINDS.indexOf(x.k) >= 0) onDealerInner(peerId, uid, x)
      else if (x.k === 'state' && !onLeftState(peerId, uid, x)) onState(peerId, uid, x)
    }

    function onPeerReady (peerId, uid) {
      if (dealing()) {
        if (blocked(uid)) return
        // Koltuktaki kişiye önce davet (yenilenmiş sayfa için yeni ni), sonra durum gider
        sendInvite(uid, peerId, false)
        const seat = seatOf(uid)
        if (seat) {
          markAll(seat)
          seat.retryAt = 0
          if (seat.peerId === peerId) seat.offline = false
        }
        return
      }
      if (!playing() || peerId !== T.dealerPeer) return
      T.retryAt = 0
      if (T.stage === 'joining') want('join')
      else if (T.stage === 'seated') want('sync')
    }

    function onPeerLeave (peerId, uid) {
      Object.keys(seen).forEach((d) => {
        if (seen[d].peerId === peerId) delete seen[d]
      })
      if (dealing()) {
        const seat = seatOf(uid)
        if (seat && seat.peerId === peerId) dropSeat(uid, 'gone')
        if (!dealing()) return
        if (T.invites[uid] && T.invites[uid].peerId === peerId) delete T.invites[uid]
        if (T.held[uid] && T.held[uid].peerId === peerId) delete T.held[uid]
        return
      }
      if (!playing() || peerId !== T.dealerPeer) return
      if (T.stage === 'joining' || T.stage === 'seated') endPlayer('dealer_left')
      else dropOffer()
    }

    function onReset () {
      const had = (T !== null && (T.role === 'dealer' || T.ended === null)) || setup !== null
      T = null
      setup = null
      seen = {}
      owners = {}
      declined = {}
      left = null
      plainAt = {}
      error = null
      newEvents = []
      if (had) notice('ended', { reason: 'reset' })
    }

    function onVoiceEvent (evt) {
      if (!G.isPlain(evt) || typeof evt.type !== 'string') return
      if (evt.type === 'reset') {
        onReset()
        return
      }
      // Özel aramada ya da seste değilken oyun olayları atılır
      if (env.isPrivate() || !chan() || !myId()) return
      const uid = evt.userId === undefined || evt.userId === null ? '' : String(evt.userId)
      if (typeof evt.peerId !== 'string' || !evt.peerId || !G.isId(uid) || uid === myId()) return
      if (evt.type === 'message') onMessage(evt.peerId, uid, evt.p)
      else if (evt.type === 'peer-ready') onPeerReady(evt.peerId, uid)
      else if (evt.type === 'peer-leave') onPeerLeave(evt.peerId, uid)
    }

    function onTick () {
      if (dealing()) dealerTick()
      else if (playing()) playerTick()
    }

    function onRecheck () {
      if (dealing()) {
        if (locked()) {
          lockClose()
          return
        }
        Object.keys(T.held).forEach((uid) => {
          const h = dealing() ? T.held[uid] : null
          const reason = h ? keyProblem(uid) : 'loading'
          if (reason === 'loading') return
          delete T.held[uid]
          if (reason === null) onMessage(h.peerId, uid, h.p)
        })
        if (!dealing()) return
        T.seats.forEach((s) => {
          if (s.keyIssue) markAll(s)
        })
        return
      }
      if (!playing()) return
      const reason = keyProblem(T.dealer)
      if (reason !== null) {
        keyTrouble(reason)
        return
      }
      if (T.joinWanted && (T.stage === 'invited' || T.stage === 'rejoin')) doJoin()
    }

    // ----- Yöntemler -----

    function doOpenSetup (app) {
      if (dealing() || playing() || bestOffer()) return false
      const A = appOf(app)
      if (!A || !chan() || !myId() || env.isPrivate()) return false
      T = null
      setup = { app: app, rules: A.DEFAULT_RULES }
      return true
    }

    function doCancelSetup () {
      if (!setup) return false
      setup = null
      return true
    }

    function doOpenTable (rules) {
      if (!setup) return false
      const A = appOf(setup.app)
      const ch = chan()
      const me = myId()
      if (!A || !ch || !me || env.isPrivate()) return false
      if (locked()) {
        fault('locked')
        return false
      }
      let g = null
      try {
        g = G.randomHex16(env.rng)
      } catch (e) {
        fault(errCode(e))
        return false
      }
      const lim = limits(A)
      T = {
        role: 'dealer',
        app: setup.app,
        A: A,
        g: g,
        ch: ch,
        dealer: me,
        ph: 'lobby',
        rules: A.RULES.indexOf(rules) >= 0 ? rules : setup.rules,
        rd: 0,
        r: 1,
        min: lim.min,
        max: lim.max,
        seats: [],
        lastSeq: {},
        invites: {},
        held: {},
        removed: {},
        game: null,
        events: [],
        selfQueue: [],
        away: [],
        turnId: null,
        turnSince: 0
      }
      setup = null
      error = null
      T.seats.push(newSeat(me, null, null))
      inviteUnseated(false)
      return true
    }

    function doSetRules (rules) {
      if (setup) {
        const A = appOf(setup.app)
        if (!A || A.RULES.indexOf(rules) < 0) return false
        setup.rules = rules
        return true
      }
      if (!dealing() || T.ph !== 'lobby' || T.A.RULES.indexOf(rules) < 0) return false
      if (T.rules === rules) return true
      T.rules = rules
      bump()
      return true
    }

    function doStart () {
      if (!dealing() || T.ph !== 'lobby') return false
      const n = T.seats.length
      if (n < T.min || n > T.max || T.rd >= G.MAX_ROUND) return false
      const rd = T.rd + 1
      let res = null
      try {
        res = T.A.newGame({ rules: T.rules, players: seatIds(), dealSeat: (rd - 1) % n }, env.rng)
      } catch (e) {
        fault(errCode(e))
        return false
      }
      T.rd = rd
      T.ph = 'play'
      T.events = []
      T.selfQueue = []
      T.turnId = null
      error = null
      applyChange(res, null)
      inviteUnseated(true)
      return true
    }

    function doEndGame () {
      if (!dealing() || T.ph !== 'play') return false
      let res = null
      try {
        res = T.A.endGame(T.game)
      } catch (e) {
        fault(errCode(e))
        return false
      }
      applyChange(res, null)
      return true
    }

    function doNewRound () {
      if (!dealing() || T.ph !== 'over') return false
      T.ph = 'lobby'
      T.game = null
      T.events = []
      T.selfQueue = []
      T.away = []
      T.turnId = null
      bump()
      inviteUnseated(false)
      return true
    }

    function doCloseTable () {
      if (setup) {
        setup = null
        return true
      }
      if (!dealing()) return false
      closeAll('dealer')
      T = null
      return true
    }

    function doRemoveSeat (uid) {
      const id = uid === undefined || uid === null ? '' : String(uid)
      if (!dealing() || id === T.dealer) return false
      const seat = seatOf(id)
      if (!seat) return false
      T.removed[id] = { ni: seat.ni, peerId: seat.peerId }
      if (!dropSeat(id, 'removed')) return false
      // Son durum hemen gider, kişiden gelen sonraki iletilere yanıt düz yanıt kısmasına tabidir
      plainAt[id] = now()
      sendFarewell(id)
      return true
    }

    function doJoin () {
      if (!playing() || (T.stage !== 'invited' && T.stage !== 'rejoin')) return false
      const reason = keyProblem(T.dealer)
      if (reason !== null) {
        if (reason === 'loading') {
          T.joinWanted = true
        } else if (!T.keyDeclined && G.DECLINE_KEYS.indexOf(reason) >= 0) {
          // Anahtar sorunu kurpiyerin lobi çipine bir kez bildirilir
          T.keyDeclined = true
          if (T.inv.ph === 'lobby') sendDecline('keys', reason)
        }
        return false
      }
      if (T.inv.key !== null && T.inv.key !== 'loading') return false
      T.joinWanted = false
      delete declined[T.dealer]
      T.stage = 'joining'
      T.ni = T.inv.ni
      T.joinAt = now()
      error = null
      want('join')
      return true
    }

    function doDecline () {
      if (!playing() || (T.stage !== 'invited' && T.stage !== 'rejoin' && T.stage !== 'busy')) return false
      if (T.stage === 'invited' && T.inv.ph === 'lobby') {
        sendDecline('user', null)
        declined[T.dealer] = T.inv.ni
      }
      // Saklı davet kalır, Masaya Bak ile yeniden açılabilir
      T = null
      return true
    }

    function doOpenInvite () {
      if (T !== null || setup !== null) return false
      const offer = bestOffer()
      if (!offer) return false
      adopt(offer, false)
      return true
    }

    function doLeave () {
      if (!playing() || (T.stage !== 'joining' && T.stage !== 'seated')) return false
      leaveTable()
      const o = seen[T.dealer]
      if (o && o.g === T.g) delete seen[T.dealer]
      T = null
      return true
    }

    function doAct (move) {
      if (dealing()) {
        if (T.ph !== 'play') return false
        if (G.isPlain(move) && DELAYED_MOVES.indexOf(move.t) >= 0) {
          T.selfQueue.push({ move: move, due: now() + TIMES.SELF_DELAY_MS })
          return true
        }
        return selfAct(move)
      }
      if (!playing() || T.stage !== 'seated' || !T.b || T.b.ph !== 'play' || T.pending) return false
      const m = T.A.validateMove(move)
      if (!m) {
        fault('bad_move')
        return false
      }
      T.mySeq++
      T.pending = { seq: T.mySeq, rd: T.b.rd, b: m, at: now(), sentAt: null }
      error = null
      want('act')
      return true
    }

    function doDismiss () {
      error = null
      if (T !== null && T.role === 'player' && T.ended !== null) {
        const why = T.ended
        T = null
        // superseded ile kapanan masanın ardından saklı davet gösterilir
        if (why === 'superseded' && bestOffer()) adopt(bestOffer(), false)
        return true
      }
      if (playing() && T.stage === 'rejected') {
        const why = T.rejected
        T.rejected = null
        if (why === 'full') T.stage = offerStage(T.inv)
        else T = null
        return true
      }
      return true
    }

    // ----- Görünüm modeli (6.1) -----

    function roomList () {
      return roomPeers().map((x) => {
        const uid = x.userId
        const seat = dealing() ? seatOf(uid) : null
        const inv = dealing() ? T.invites[uid] : undefined
        let status = null
        let key = null
        if (seat) {
          key = seat.keyIssue
          if (seat.keyIssue) status = 'keys'
          else if (seat.offline) status = 'offline'
          else if (T.away.indexOf(uid) >= 0) status = 'away'
          else status = 'joined'
        } else if (blocked(uid)) {
          status = 'blocked'
        } else if (inv && (inv.status === 'declined' || inv.status === 'cannot' || inv.status === 'full')) {
          status = inv.status
          key = inv.status === 'cannot' ? inv.key : null
        } else {
          key = keyProblem(uid)
          if (key === 'blocked') {
            status = 'blocked'
            key = null
          } else if (key !== null) {
            status = 'keys'
          } else if (inv) {
            status = inv.sent ? 'waiting' : 'offline'
          }
        }
        return { id: uid, status: status, key: key }
      })
    }

    function inviteModel (o) {
      return { dealer: o.dealer, app: o.app, ph: o.ph, rules: o.rules, seats: o.seats.slice(), key: o.key, myKey: keyProblem(o.dealer) }
    }

    function buildModel () {
      const me = myId()
      const m = {
        rev: 0,
        role: 'none',
        stage: 'none',
        app: null,
        g: null,
        dealer: null,
        me: me,
        rules: null,
        rd: 0,
        min: 0,
        max: 0,
        seats: [],
        room: [],
        invite: null,
        pending: null,
        slow: false,
        syncing: false,
        view: null,
        mine: null,
        legal: null,
        ack: null,
        events: [],
        newEvents: newEvents,
        ended: null,
        rejected: null,
        error: error,
        locked: locked()
      }
      if (setup) {
        const A = appOf(setup.app)
        const lim = A ? limits(A) : { min: 0, max: 0 }
        m.role = 'dealer'
        m.stage = 'setup'
        m.app = setup.app
        m.dealer = me
        m.rules = setup.rules
        m.min = lim.min
        m.max = lim.max
        m.room = roomList()
        return m
      }
      if (T === null) {
        const offer = bestOffer()
        if (offer) m.invite = inviteModel(offer)
        return m
      }
      m.app = T.app
      m.g = T.g
      m.dealer = T.dealer
      if (dealing()) {
        m.role = 'dealer'
        m.stage = T.ph
        m.rules = T.rules
        m.rd = T.rd
        m.min = T.min
        m.max = T.max
        m.seats = T.seats.map((s) => ({ id: s.id, away: T.away.indexOf(s.id) >= 0, offline: s.offline, keyIssue: s.keyIssue }))
        m.room = roomList()
        m.events = T.events
        if (T.game && T.ph !== 'lobby') {
          m.view = T.A.publicView(T.game)
          m.mine = T.A.privateView(T.game, T.dealer)
          m.legal = T.A.legalMoves(m.view, m.mine, T.dealer)
        }
        return m
      }
      const lim = limits(T.A)
      m.role = 'player'
      m.stage = T.ended !== null ? 'ended' : T.stage === 'seated' ? T.b.ph : T.stage
      m.rules = T.b ? T.b.rules : T.inv.rules
      m.rd = T.b ? T.b.rd : 0
      m.min = lim.min
      m.max = lim.max
      m.invite = inviteModel(T.inv)
      m.ended = T.ended !== null ? { reason: T.ended } : null
      m.rejected = T.stage === 'rejected' && T.ended === null ? { why: T.rejected } : null
      if (T.b && T.ended === null) {
        const away = T.b.away
        m.seats = T.b.seats.map((id) => ({ id: id, away: away.indexOf(id) >= 0, offline: false, keyIssue: null }))
        m.ack = T.b.ack
        m.events = T.b.ev
        m.view = T.view
        m.mine = T.mine
        if (T.view) m.legal = T.A.legalMoves(T.view, T.mine, me)
      }
      if (T.pending) {
        m.pending = { seq: T.pending.seq, at: T.pending.at }
        m.slow = now() - T.pending.at > TIMES.SLOW_MS
      }
      m.syncing = T.syncing
      return m
    }

    function model () {
      const m = JSON.parse(JSON.stringify(buildModel()))
      m.rev = rev
      return m
    }

    // En dıştaki çağrının sonunda: kuyruk boşaltılır, model değiştiyse rev artar, bildirimler ve onChange gider
    function settle () {
      if (dealing()) dealerFlush()
      else playerFlush()
      if (runEvents.length) {
        newEvents = runEvents
        notice('events', runEvents)
        runEvents = []
      }
      const text = JSON.stringify(buildModel())
      const m = JSON.parse(text)
      const turn = Boolean(m.legal && m.legal.turn)
      if (turn && !lastTurn) notice('turn', null)
      lastTurn = turn
      const changed = text !== sig
      if (changed) {
        sig = text
        rev++
      }
      const list = notices
      notices = []
      let err = null
      list.forEach((n) => {
        try {
          env.onNotice(n[0], n[1] === null ? null : JSON.parse(JSON.stringify(n[1])))
        } catch (e) {
          if (err === null) err = e
        }
      })
      if (changed) {
        try {
          env.onChange()
        } catch (e) {
          if (err === null) err = e
        }
      }
      if (err !== null) throw err
    }

    function run (fn) {
      depth++
      let out
      try {
        out = fn()
      } finally {
        depth--
      }
      if (depth === 0) settle()
      return out
    }

    return Object.freeze({
      onVoiceEvent: (evt) => run(() => onVoiceEvent(evt)),
      tick: () => run(onTick),
      recheck: () => run(onRecheck),
      openSetup: (app) => run(() => doOpenSetup(app)),
      cancelSetup: () => run(doCancelSetup),
      openTable: (rules) => run(() => doOpenTable(rules)),
      setRules: (rules) => run(() => doSetRules(rules)),
      start: () => run(doStart),
      endGame: () => run(doEndGame),
      newRound: () => run(doNewRound),
      closeTable: () => run(doCloseTable),
      removeSeat: (uid) => run(() => doRemoveSeat(uid)),
      join: () => run(doJoin),
      decline: () => run(doDecline),
      openInvite: () => run(doOpenInvite),
      leave: () => run(doLeave),
      act: (move) => run(() => doAct(move)),
      dismiss: () => run(doDismiss),
      model: model
    })
  }

  return Object.freeze({
    TIMES: TIMES,
    DELAYED_MOVES: Object.freeze(DELAYED_MOVES.slice()),
    ERRORS: Object.freeze(ERRORS.slice()),
    create: create
  })
})(window.TelsizGame)
