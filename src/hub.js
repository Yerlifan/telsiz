'use strict'

// Gerçek zamanlı merkez (SPEC-V2 3.6 ve 3.8): varlık, olay halkası, meta sürümü,
// bekleyen long-poll istekleri, ses kadroları ve ses sinyal kuyrukları.
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

// options: { pollTimeoutMs, graceMs, eventBufferSize, maxWaitersPerSession,
//   getBase: () => ({ serverName, activeKid, channels, users }), send: (res, status, payload) => void }
function createHub (options) {
  const pollTimeoutMs = options.pollTimeoutMs
  const graceMs = options.graceMs
  const eventBufferSize = options.eventBufferSize
  const maxWaitersPerSession = options.maxWaitersPerSession
  const getBase = options.getBase
  const send = options.send
  const bootId = randomHex(8)

  let seq = 0
  const ring = []
  let metaVersion = 1
  let metaCache = null
  let voiceCounter = 0
  let wakeHandle = null
  let closed = false

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
      if (!wasOnline) bumpMeta()
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
    if (wasOnline && !isUserOnline(rt.userId)) changed = true
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
      if (set.size === 0) byUser.delete(rt.userId)
    }
    if (wasInVoice || wasOnline !== isUserOnline(rt.userId)) bumpMeta()
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
      activeKid: base.activeKid,
      channels: base.channels,
      users: base.users.map((u) => ({ id: u.id, name: u.name, role: u.role, online: isUserOnline(u.id) })),
      voice
    }
    return metaCache
  }

  function emit (event) {
    seq++
    const stored = Object.assign({ seq }, event)
    ring.push(stored)
    if (ring.length > eventBufferSize) ring.splice(0, ring.length - eventBufferSize)
    scheduleWake()
    return stored
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
      events: [],
      signals: pendingSignals(rt, sigFloor)
    }
  }

  function emptyPayload () {
    return { boot: bootId, seq, metaVersion, events: [], signals: [] }
  }

  // Hazır veri yoksa null döner.
  function readyPayload (rt, since, mv, sigFloor) {
    if (outOfRange(since)) return resyncPayload(rt, sigFloor)
    let events = []
    if (since < seq) {
      const start = since + 1 - ring[0].seq
      events = ring.slice(start, start + MAX_EVENTS_PER_POLL)
    }
    const sendMeta = mv !== metaVersion
    const signals = pendingSignals(rt, sigFloor)
    if (events.length === 0 && !sendMeta && signals.length === 0) return null
    const payload = {
      boot: bootId,
      seq: events.length > 0 ? events[events.length - 1].seq : seq,
      metaVersion,
      events,
      signals
    }
    if (sendMeta) payload.meta = meta()
    return payload
  }

  function removeWaiter (w) {
    waiters.delete(w)
    const list = w.rt.waiters
    const index = list.indexOf(w)
    if (index !== -1) list.splice(index, 1)
  }

  // Her bekleyen tam bir kez sonlanır: veriyle, zaman aşımıyla, istemcinin kapatmasıyla veya hata yanıtıyla.
  function finishWaiter (w) {
    if (w.done) return
    w.done = true
    clearTimeout(w.timer)
    removeWaiter(w)
    w.rt.lastSeen = Date.now()
    const payload = readyPayload(w.rt, w.since, w.mv, w.sigFloor) || emptyPayload()
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
      if (readyPayload(w.rt, w.since, w.mv, w.sigFloor) !== null) finishWaiter(w)
    }
  }

  // params: { since, mv, sig, boot } (sorgu dizgeleri)
  function poll (rt, params, res) {
    const now = Date.now()
    rt.lastSeen = now
    const bootOk = params.boot === bootId
    const since = parseCounter(params.since)
    const mv = parseCounter(params.mv)
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
    const ready = readyPayload(rt, since, mv, sigFloor)
    if (ready || closed) {
      send(res, 200, ready || emptyPayload())
      return
    }
    if (res.writableEnded || res.destroyed) return
    while (rt.waiters.length >= maxWaitersPerSession) finishWaiter(rt.waiters[0])
    const w = { rt, since, mv, sigFloor, res, timer: null, done: false }
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
    for (const w of Array.from(waiters)) finishWaiter(w)
  }

  function stats () {
    let active = 0
    for (const rt of sessions.values()) {
      if (rt.active) active++
    }
    return { waiters: waiters.size, sessions: sessions.size, activeSessions: active, seq, metaVersion, events: ring.length }
  }

  return {
    bootId,
    getSeq: () => seq,
    getMetaVersion: () => metaVersion,
    meta,
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
    signal,
    isUserOnline,
    close,
    stats
  }
}

module.exports = { createHub }
