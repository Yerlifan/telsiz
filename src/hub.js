'use strict'

// Gerçek zamanlı merkez: varlık ve durum, olay halkası, meta sürümü, kişiye özel meta sürümleri, bekleyen long-poll istekleri, ses kadroları, ses sinyal kuyrukları ve yazıyor durumu.
// Her olay bir hedef kitle taşır: null tüm üyeler, dizi yalnızca o kullanıcı kimlikleri demektir.
// Hedef kitlede olmayan bir kullanıcının poll yanıtına olay hiçbir zaman girmez.
// Görünmez durumdaki kullanıcı başkalarına çevrimdışı görünür, çevrimiçi olup olmadığı meta
// sürümünün değişmesinden de anlaşılmaz.
// Yazıyor durumu kanal başına geçicidir (yazan kimliği ve bitiş zamanı), süresi dolunca kendiliğinden
// düşer. Olaylar gibi bir hedef kitlesi vardır, kişiye özel tv sürümüyle izlenir ve değişince yalnızca
// görünümü değişen kullanıcıların bekleyenleri uyanır. Engel ilişkisi olan iki kullanıcı birbirinin
// yazıyor bilgisini görmez.
// Telsiz DJ müzik durumları (src/music.js) müzik sürümüyle (muv) izlenir: muv sorgusu veren poll, sürüm
// değişince uyanır ve tam müzik haritasını alır. muv vermeyen poll müziği izlemiyor sayılır (harita yalnızca
// resync yanıtında gelir). Her yanıtta sunucu zamanı (now) ve güncel muv bulunur, istemciler saat farkını
// now ile kestirir.
// Tüm veriler bellektedir. Sunucu yeniden başlayınca bootId değişir ve istemciler resync alır.

const crypto = require('node:crypto')

const MAX_EVENTS_PER_POLL = 500
const MAX_SIGNALS_PER_POLL = 100
const MAX_SIGNAL_QUEUE = 200

function randomHex (bytes) {
  return crypto.randomBytes(bytes).toString('hex')
}

// Sorgu parametresindeki negatif olmayan tamsayı, geçersizse null
function parseCounter (value) {
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) return null
  return Number(value)
}

function memberView (rt) {
  return { userId: rt.userId, peerId: rt.peerId, muted: rt.muted, deafened: rt.deafened }
}

function visibleTo (item, userId) {
  return inAudience(item.audience, userId)
}

function inAudience (audience, userId) {
  return audience === null || audience.includes(userId)
}

// options: { pollTimeoutMs, graceMs, eventBufferSize, maxWaitersPerSession, typingTtlMs,
//   getBase: () => ({ serverName, serverIcon, activeKid, channels, users: [{ id, name, role, pv, status }], music }),
//   music: { version: () => muv, map: () => ({ '<oda>': kayıt }) } (verilmezse müzik yok),
//   getPrivate: (userId) => kişiye özel meta, isHidden: (userId) => görünmez mi,
//   canSeeTyping: (viewerId, typerId) => yazıyor bilgisini görebilir mi,
//   send: (res, status, payload) => void }
function createHub (options) {
  const pollTimeoutMs = options.pollTimeoutMs
  const graceMs = options.graceMs
  const eventBufferSize = options.eventBufferSize
  const maxWaitersPerSession = options.maxWaitersPerSession
  const typingTtlMs = options.typingTtlMs
  const getBase = options.getBase
  const getPrivate = options.getPrivate
  const isHidden = typeof options.isHidden === 'function' ? options.isHidden : () => false
  const canSeeTyping = typeof options.canSeeTyping === 'function' ? options.canSeeTyping : () => true
  const send = options.send
  const music = options.music && typeof options.music.version === 'function' ? options.music : { version: () => 1, map: () => ({}) }
  const bootId = randomHex(8)

  let seq = 0
  // Öğeler: { seq, audience: null | [userId], event }
  const ring = []
  let metaVersion = 1
  // Kişiye özel meta sürümleri (kayıt yoksa 1)
  const privateVersions = new Map()
  let metaCache = null
  let voiceCounter = 0
  let wakeHandle = null
  let closed = false
  // Yazıyor durumu: kanal kimliği -> { audience: null | [userId], users: Map(userId -> bitiş zamanı) }
  const typing = new Map()
  // Kişiye özel yazıyor sürümleri (kayıt yoksa 1)
  const typingVersions = new Map()
  let typingTimer = null

  // Oturum çalışma zamanı verisi, token karmasına göre
  const sessions = new Map()
  const byPeer = new Map()
  const byUser = new Map()
  const waiters = new Set()

  // ---------------------------------------------------------------- varlık

  function isActive (rt, now) {
    return rt.waiters.length > 0 || now - rt.lastSeen < pollTimeoutMs + graceMs
  }

  function isUserOnline (userId) {
    const set = byUser.get(userId)
    if (!set) return false
    for (const rt of set) {
      if (rt.active) return true
    }
    return false
  }

  function newPeerId () {
    let id = randomHex(8)
    while (byPeer.has(id)) id = randomHex(8)
    return id
  }

  // Kimliği doğrulanmış her istekte çağrılır, oturumu etkin yapar.
  function touch (hash, userId, now) {
    let rt = sessions.get(hash)
    if (!rt) {
      rt = {
        hash,
        userId,
        lastSeen: now,
        active: false,
        waiters: [],
        peerId: null,
        voiceChannelId: null,
        voiceSince: 0,
        muted: false,
        deafened: false,
        signals: [],
        sigSeq: 0
      }
      sessions.set(hash, rt)
      let set = byUser.get(userId)
      if (!set) {
        set = new Set()
        byUser.set(userId, set)
      }
      set.add(rt)
    }
    rt.lastSeen = now
    if (!rt.active) {
      const wasOnline = isUserOnline(userId)
      rt.active = true
      rt.peerId = newPeerId()
      byPeer.set(rt.peerId, rt)
      if (!wasOnline && !isHidden(userId)) bumpMeta()
    }
    return rt
  }

  function runtime (hash) {
    return sessions.get(hash) || null
  }

  function clearVoice (rt) {
    if (rt.voiceChannelId === null) return false
    rt.voiceChannelId = null
    rt.muted = false
    rt.deafened = false
    rt.signals = []
    return true
  }

  // Çevrimdışına düşen oturum sesten sessizce çıkarılır, sinyal kuyruğu boşaltılır.
  function deactivate (rt) {
    const wasOnline = isUserOnline(rt.userId)
    rt.active = false
    if (rt.peerId !== null && byPeer.get(rt.peerId) === rt) byPeer.delete(rt.peerId)
    rt.signals = []
    let changed = clearVoice(rt)
    if (wasOnline && !isUserOnline(rt.userId) && !isHidden(rt.userId)) changed = true
    if (changed) bumpMeta()
  }

  // reply(res): oturumun bekleyen poll'larına gönderilecek hata yanıtı
  function removeSession (hash, reply) {
    const rt = sessions.get(hash)
    if (!rt) return
    for (const w of rt.waiters.slice()) finishWaiterWith(w, reply)
    const wasOnline = isUserOnline(rt.userId)
    const wasInVoice = clearVoice(rt)
    sessions.delete(hash)
    if (rt.peerId !== null && byPeer.get(rt.peerId) === rt) byPeer.delete(rt.peerId)
    rt.active = false
    const set = byUser.get(rt.userId)
    if (set) {
      set.delete(rt)
      if (set.size === 0) {
        byUser.delete(rt.userId)
        // Hiç oturumu kalmayan kullanıcı (çıkış, sunucu engeli, hesap silme) artık yazmıyordur
        clearTypingUser(rt.userId)
      }
    }
    if (wasInVoice || (wasOnline !== isUserOnline(rt.userId) && !isHidden(rt.userId))) bumpMeta()
  }

  function sweep (now) {
    for (const rt of sessions.values()) {
      if (rt.active && !isActive(rt, now)) deactivate(rt)
    }
  }

  // ---------------------------------------------------------------- meta ve olaylar

  function bumpMeta () {
    metaVersion++
    metaCache = null
    scheduleWake()
  }

  function meta () {
    if (metaCache) return metaCache
    const base = getBase()
    const voice = {}
    for (const ch of base.channels) {
      if (ch.type === 'voice') voice[String(ch.id)] = []
    }
    const members = []
    for (const rt of sessions.values()) {
      if (rt.voiceChannelId !== null) members.push(rt)
    }
    members.sort((a, b) => a.voiceSince - b.voiceSince)
    for (const rt of members) {
      const list = voice[String(rt.voiceChannelId)]
      if (list) list.push(memberView(rt))
    }
    metaCache = {
      serverName: base.serverName,
      serverIcon: base.serverIcon === undefined ? null : base.serverIcon,
      activeKid: base.activeKid,
      channels: base.channels,
      users: base.users.map(presenceView),
      voice,
      music: base.music
    }
    return metaCache
  }

  // Başkalarına gösterilen kullanıcı: görünmez veya çevrimdışıysa online false ve status 'offline'
  function presenceView (u) {
    const online = u.status !== 'invisible' && isUserOnline(u.id)
    return { id: u.id, name: u.name, role: u.role, online, status: online ? u.status : 'offline', pv: u.pv }
  }

  // audience: null (tüm üyeler) veya olayı görebilecek kullanıcı kimlikleri
  function emit (event, audience) {
    seq++
    const stored = Object.assign({ seq }, event)
    ring.push({ seq, audience: Array.isArray(audience) ? audience.slice() : null, event: stored })
    if (ring.length > eventBufferSize) ring.splice(0, ring.length - eventBufferSize)
    scheduleWake()
    return stored
  }

  function privateVersion (userId) {
    return privateVersions.get(userId) || 1
  }

  // Yalnızca bu kullanıcının bekleyenleri yeni kişiye özel metayı alır.
  function bumpPrivate (userId) {
    privateVersions.set(userId, privateVersion(userId) + 1)
    scheduleWake()
  }

  // ---------------------------------------------------------------- yazıyor durumu

  function typingVersion (userId) {
    return typingVersions.get(userId) || 1
  }

  function bumpTyping (userId) {
    typingVersions.set(userId, typingVersion(userId) + 1)
    scheduleWake()
  }

  // Yazanın durumu değişince görünümü değişen kullanıcılar: kitledeki diğer kullanıcılar, yazanla
  // engel ilişkisi olanlar hariç. Yazı kanalının kitlesi oturumu olan tüm kullanıcılardır (oturumu
  // olmayan kullanıcı tv değerini ancak oturum açınca alır).
  function typingChanged (audience, typerId) {
    const viewers = audience === null ? Array.from(byUser.keys()) : audience
    for (const viewerId of viewers) {
      if (viewerId !== typerId && canSeeTyping(viewerId, typerId)) bumpTyping(viewerId)
    }
  }

  // on: true yazıyor (süre yenilenir), false yazmayı bıraktı. Görünüm değiştiyse true döner.
  // Süre yenilemesi görünümü değiştirmez, kimse uyanmaz.
  function setTyping (channelId, audience, userId, on, now) {
    let entry = typing.get(channelId)
    if (!on) {
      if (!entry || !entry.users.delete(userId)) return false
      if (entry.users.size === 0) typing.delete(channelId)
      typingChanged(entry.audience, userId)
      return true
    }
    if (!entry) {
      entry = { audience: Array.isArray(audience) ? audience.slice() : null, users: new Map() }
      typing.set(channelId, entry)
    }
    const known = entry.users.has(userId)
    entry.users.set(userId, now + typingTtlMs)
    scheduleTypingExpiry()
    if (known) return false
    typingChanged(entry.audience, userId)
    return true
  }

  // Silinen kanalın yazanları düşer.
  function clearTypingChannel (channelId) {
    const entry = typing.get(channelId)
    if (!entry) return
    typing.delete(channelId)
    for (const userId of entry.users.keys()) typingChanged(entry.audience, userId)
  }

  function clearTypingUser (userId) {
    for (const [channelId, entry] of typing) {
      if (!entry.users.delete(userId)) continue
      if (entry.users.size === 0) typing.delete(channelId)
      typingChanged(entry.audience, userId)
    }
  }

  // Kullanıcının görebildiği yazanlar: { '<kanal>': [userId] } (yazmaya başlama sırasıyla).
  // Yalnızca kitlesinde olduğu kanallar, kendisi ve engel ilişkisi olduğu kişiler hariç.
  function typingOf (userId) {
    const out = {}
    for (const [channelId, entry] of typing) {
      if (!inAudience(entry.audience, userId)) continue
      const list = []
      for (const typerId of entry.users.keys()) {
        if (typerId !== userId && canSeeTyping(userId, typerId)) list.push(typerId)
      }
      if (list.length > 0) out[String(channelId)] = list
    }
    return out
  }

  function typesFor (typerId, viewerId) {
    for (const entry of typing.values()) {
      if (entry.users.has(typerId) && inAudience(entry.audience, viewerId)) return true
    }
    return false
  }

  // İki kullanıcı arasındaki engel ilişkisi değişti: birbirlerinin yazıyor görünümü yenilenir.
  function typingPairChanged (a, b) {
    if (typesFor(b, a)) bumpTyping(a)
    if (typesFor(a, b)) bumpTyping(b)
  }

  // Bitiş zamanları ekleme sırasıyla artar (süre sabit), zamanlayıcı her zaman en erken bitişe kurulur.
  function scheduleTypingExpiry () {
    if (typingTimer !== null || closed) return
    let next = Infinity
    for (const entry of typing.values()) {
      for (const at of entry.users.values()) {
        if (at < next) next = at
      }
    }
    if (next === Infinity) return
    typingTimer = setTimeout(expireTyping, Math.max(1, next - Date.now()))
    if (typeof typingTimer.unref === 'function') typingTimer.unref()
  }

  function expireTyping () {
    typingTimer = null
    const now = Date.now()
    for (const [channelId, entry] of typing) {
      for (const [userId, at] of entry.users) {
        if (at > now) continue
        entry.users.delete(userId)
        typingChanged(entry.audience, userId)
      }
      if (entry.users.size === 0) typing.delete(channelId)
    }
    scheduleTypingExpiry()
  }

  function typingCount () {
    let n = 0
    for (const entry of typing.values()) n += entry.users.size
    return n
  }

  // ---------------------------------------------------------------- long-poll

  function outOfRange (since) {
    if (since > seq) return true
    if (since === seq) return false
    return ring.length === 0 || ring[0].seq > since + 1
  }

  function pendingSignals (rt, sigFloor) {
    const out = []
    for (const s of rt.signals) {
      if (s.seq <= sigFloor) continue
      out.push(s)
      if (out.length >= MAX_SIGNALS_PER_POLL) break
    }
    return out
  }

  function resyncPayload (rt, sigFloor) {
    return {
      boot: bootId,
      resync: true,
      seq,
      metaVersion,
      meta: meta(),
      pmv: privateVersion(rt.userId),
      private: getPrivate(rt.userId),
      tv: typingVersion(rt.userId),
      typing: typingOf(rt.userId),
      muv: music.version(),
      music: music.map(),
      now: Date.now(),
      events: [],
      signals: pendingSignals(rt, sigFloor)
    }
  }

  function emptyPayload (rt) {
    return { boot: bootId, seq, metaVersion, pmv: privateVersion(rt.userId), tv: typingVersion(rt.userId), muv: music.version(), now: Date.now(), events: [], signals: [] }
  }

  // q: { since, mv, pmv, tv, muv, sigFloor }. Hazır veri yoksa null döner.
  // tv verilmeyen poll yazıyor bilgisini, muv verilmeyen poll müzik durumunu izlemiyor sayılır (ikisi de
  // yalnızca resync yanıtında gelir).
  // Yanıttaki seq: en fazla 500 görünür olay döndüyse sonuncusunun seq'i, aksi halde güncel seq
  // (kullanıcının göremediği olaylar atlanır, istemci kaldığı yerden devam eder).
  function readyPayload (rt, q) {
    if (outOfRange(q.since)) return resyncPayload(rt, q.sigFloor)
    const events = []
    let lastSeq = seq
    if (q.since < seq) {
      let i = q.since + 1 - ring[0].seq
      while (i < ring.length && events.length < MAX_EVENTS_PER_POLL) {
        if (visibleTo(ring[i], rt.userId)) events.push(ring[i].event)
        i++
      }
      if (i < ring.length) lastSeq = ring[i - 1].seq
      // Taranan olayların hiçbiri görünür değilse bekleyen bunları bir daha taramaz
      if (events.length === 0) q.since = seq
    }
    const sendMeta = q.mv !== metaVersion
    const pmv = privateVersion(rt.userId)
    const sendPrivate = q.pmv !== pmv
    const tv = typingVersion(rt.userId)
    const sendTyping = q.tv !== null && q.tv !== tv
    const muv = music.version()
    const sendMusic = q.muv !== null && q.muv !== muv
    const signals = pendingSignals(rt, q.sigFloor)
    if (events.length === 0 && !sendMeta && !sendPrivate && !sendTyping && !sendMusic && signals.length === 0) return null
    const payload = { boot: bootId, seq: lastSeq, metaVersion, pmv, tv, muv, now: Date.now(), events, signals }
    if (sendMeta) payload.meta = meta()
    if (sendPrivate) payload.private = getPrivate(rt.userId)
    if (sendTyping) payload.typing = typingOf(rt.userId)
    if (sendMusic) payload.music = music.map()
    return payload
  }

  function removeWaiter (w) {
    waiters.delete(w)
    const list = w.rt.waiters
    const index = list.indexOf(w)
    if (index !== -1) list.splice(index, 1)
  }

  // Her bekleyen tam bir kez sonlanır: veriyle, zaman aşımıyla, istemcinin kapatmasıyla veya hata yanıtıyla.
  function finishWaiter (w, ready) {
    if (w.done) return
    w.done = true
    clearTimeout(w.timer)
    removeWaiter(w)
    w.rt.lastSeen = Date.now()
    const payload = ready || readyPayload(w.rt, w) || emptyPayload(w.rt)
    send(w.res, 200, payload)
  }

  function finishWaiterWith (w, reply) {
    if (w.done) return
    w.done = true
    clearTimeout(w.timer)
    removeWaiter(w)
    try {
      reply(w.res)
    } catch (err) {
      // yanıt yazılamadıysa bağlantı zaten kapanmıştır
    }
  }

  function scheduleWake () {
    if (wakeHandle !== null || closed) return
    wakeHandle = setImmediate(runWake)
  }

  // Aynı işlemdeki değişiklikler tek yanıtta toplansın diye uyandırma bir sonraki turda yapılır.
  function runWake () {
    wakeHandle = null
    for (const w of Array.from(waiters)) {
      if (w.done) continue
      const ready = readyPayload(w.rt, w)
      if (ready !== null) finishWaiter(w, ready)
    }
  }

  // params: { since, mv, pmv, tv, muv, sig, boot } (sorgu dizgeleri)
  function poll (rt, params, res) {
    const now = Date.now()
    rt.lastSeen = now
    const bootOk = params.boot === bootId
    const since = parseCounter(params.since)
    const mv = parseCounter(params.mv)
    const pmv = parseCounter(params.pmv)
    const tv = parseCounter(params.tv)
    const muv = parseCounter(params.muv)
    const sig = parseCounter(params.sig)
    // Sinyal onayı yalnızca aynı açılışın sıra numaraları için geçerlidir
    let sigFloor = 0
    if (bootOk && sig !== null && sig <= rt.sigSeq) {
      sigFloor = sig
      if (rt.signals.length > 0 && rt.signals[0].seq <= sig) rt.signals = rt.signals.filter((s) => s.seq > sig)
    }
    if (!bootOk || since === null) {
      send(res, 200, resyncPayload(rt, sigFloor))
      return
    }
    const q = { since, mv, pmv, tv, muv, sigFloor }
    const ready = readyPayload(rt, q)
    if (ready || closed) {
      send(res, 200, ready || emptyPayload(rt))
      return
    }
    if (res.writableEnded || res.destroyed) return
    while (rt.waiters.length >= maxWaitersPerSession) finishWaiter(rt.waiters[0])
    const w = { rt, since: q.since, mv, pmv, tv, muv, sigFloor, res, timer: null, done: false }
    w.timer = setTimeout(() => finishWaiter(w), pollTimeoutMs)
    if (typeof w.timer.unref === 'function') w.timer.unref()
    rt.waiters.push(w)
    waiters.add(w)
    res.on('close', () => {
      if (w.done) return
      w.done = true
      clearTimeout(w.timer)
      removeWaiter(w)
      rt.lastSeen = Date.now()
    })
  }

  // ---------------------------------------------------------------- ses

  // Kanal doluysa null, değilse kendisi hariç mevcut üyeleri döner.
  // Ses üyeliği kullanıcı başınadır: kullanıcının başka oturumu seste ise oradan çıkarılır.
  function voiceJoin (rt, channelId, maxMembers) {
    const others = []
    for (const o of sessions.values()) {
      if (o.voiceChannelId === channelId && o.userId !== rt.userId) others.push(o)
    }
    if (others.length >= maxMembers) return null
    const own = byUser.get(rt.userId)
    if (own) {
      for (const o of own) {
        if (o !== rt) clearVoice(o)
      }
    }
    if (rt.voiceChannelId !== channelId) {
      clearVoice(rt)
      rt.voiceChannelId = channelId
      rt.voiceSince = ++voiceCounter
    }
    bumpMeta()
    others.sort((a, b) => a.voiceSince - b.voiceSince)
    return others.map(memberView)
  }

  function voiceLeave (rt) {
    if (!clearVoice(rt)) return false
    bumpMeta()
    return true
  }

  function setVoiceState (rt, muted, deafened) {
    const changed = rt.muted !== muted || rt.deafened !== deafened
    rt.muted = muted
    rt.deafened = deafened
    if (changed && rt.voiceChannelId !== null) bumpMeta()
  }

  // Kullanıcının herhangi bir oturumu bu ses kanalında mı (ses üyeliği kullanıcı başınadır)
  function userInVoice (userId, channelId) {
    const set = byUser.get(userId)
    if (!set) return false
    for (const rt of set) {
      if (rt.voiceChannelId === channelId) return true
    }
    return false
  }

  // Ses kanalında en az bir oturum var mı
  function voiceOccupied (channelId) {
    for (const rt of sessions.values()) {
      if (rt.voiceChannelId === channelId) return true
    }
    return false
  }

  // Müzik durumu değişti: muv izleyen bekleyenler uyanır
  function bumpMusic () {
    scheduleWake()
  }

  // Silinen ses kanalının üyelerini çıkarır.
  function kickVoiceChannel (channelId) {
    let changed = false
    for (const rt of sessions.values()) {
      if (rt.voiceChannelId === channelId && clearVoice(rt)) changed = true
    }
    if (changed) bumpMeta()
  }

  // Sonuç: 'ok' | 'not_in_voice' | 'peer_not_found'
  function signal (from, toPeerId, data) {
    if (from.voiceChannelId === null) return 'not_in_voice'
    const to = byPeer.get(toPeerId)
    if (!to || to === from || !to.active || to.voiceChannelId !== from.voiceChannelId) return 'peer_not_found'
    to.sigSeq++
    to.signals.push({ seq: to.sigSeq, from: from.peerId, data })
    if (to.signals.length > MAX_SIGNAL_QUEUE) to.signals.splice(0, to.signals.length - MAX_SIGNAL_QUEUE)
    scheduleWake()
    return 'ok'
  }

  // ---------------------------------------------------------------- kapanış

  // Bekleyen tüm poll'ları (varsa hazır veriyle, yoksa boş) yanıtlar.
  function close () {
    closed = true
    if (wakeHandle !== null) {
      clearImmediate(wakeHandle)
      wakeHandle = null
    }
    if (typingTimer !== null) {
      clearTimeout(typingTimer)
      typingTimer = null
    }
    for (const w of Array.from(waiters)) finishWaiter(w)
  }

  function stats () {
    let active = 0
    for (const rt of sessions.values()) {
      if (rt.active) active++
    }
    return { waiters: waiters.size, sessions: sessions.size, activeSessions: active, seq, metaVersion, events: ring.length, typing: typingCount() }
  }

  return {
    bootId,
    getSeq: () => seq,
    getMetaVersion: () => metaVersion,
    meta,
    privateVersion,
    bumpPrivate,
    typingVersion,
    typingOf,
    setTyping,
    clearTypingChannel,
    clearTypingUser,
    typingPairChanged,
    touch,
    runtime,
    removeSession,
    sweep,
    bumpMeta,
    emit,
    poll,
    voiceJoin,
    voiceLeave,
    setVoiceState,
    kickVoiceChannel,
    userInVoice,
    voiceOccupied,
    bumpMusic,
    signal,
    isUserOnline,
    close,
    stats
  }
}

module.exports = { createHub }
