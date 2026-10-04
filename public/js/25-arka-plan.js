'use strict'

// Masaüstünün arka plan penceresi (yalnızca masaüstü uygulamasında, desktop/src/lib/background.js).
// Ana süreç, açık olmayan her kayıtlı frekans için (en son kullanılan en fazla 8 frekans) o frekansın kendi
// oturum bölümünde gizli ve hafif bir pencere açar. Pencerede aynı uygulama paketi aynı ön yükleme betiği,
// korumalı alan ve CSP ile çalışır. Arka plan kipini yalnızca ana süreç açabilir: ön yükleme betiği bayrağı
// ana sürecin verdiği süreç argümanından okur ve yalnızca o zaman window.telsizArkaPlan nesnesini
// background: true ile verir, sayfa içeriği bunu değiştiremez.
//
// Arka plan kipinde istemci (bgStart, 12-init.js start yerine çağırır):
// - Arayüzü çizmez, ses, ekran paylaşımı, Telsiz DJ ve mesaj sesi hiç başlatılmaz (ses motoru oluşturulmaz,
//   uygulama ekranı açılmaz). Ana süreç ayrıca pencerenin sesini kapatır, görselleri ve YouTube çerçevesini
//   engeller ve mikrofon iznini reddeder.
// - O frekansın bu cihazda kayıtlı oturumuyla (yerel depodaki telsiz.token) /api/state ve long-poll
//   döngüsünü çalıştırır. Oturum yoksa veya geçersizse "giriş gerekli" bildirir ve durur, oturum bilgisine
//   dokunmaz.
// - Okunmamış ve anma sayılarını normal istemcinin kuralıyla sayar: açılışta son okunandan sonraki mesajlar
//   (oda ve özel konuşma başına son 50 mesaja kadar, 04-meta.js scanUnread ve 15-dm.js scanDmUnread ile
//   aynı), sonra poll ile gelen her yeni mesaj. Anma tespiti için mesaj bu cihazdaki anahtarla çözülür
//   (18-mentions.js messageMentionsMe). Engellenen kişilerin anmaları sayılmaz. Toplam okunmamış: odalar ve
//   özel mesajlar, anma: sizi anan mesajlar ve özel mesajlar (24-frekans.js frekansOwnCounts ile aynı kural).
//   Son okunan bilgisini hiçbir zaman yazmaz.
// - Durumu ({ origin, state, unread, mention, online, lastError, name, onlineUsers }) en fazla saniyede bir
//   telsizArkaPlan.report ile ana sürece bildirir. Ana süreç göndereni ve her alanı doğrular.
// - O frekansta masaüstü bildirimleri açıksa (Ayarlar > Bildirimler, bildirim düzeyi ve Rahatsız etmeyin
//   kuralı) sizi anan mesaj ve özel mesaj için sessiz bir sistem bildirimi gösterir. Bildirime basınca ana
//   süreç o frekansa geçer (telsizArkaPlan.open).
// Sayılar oturuma özeldir: uygulama yeniden açılınca açılış taraması son okunandan yeniden sayar.

const BG_REPORT_GAP_MS = 1000
const BG_RETRY_MAX_MS = 60000
const BG_OPEN_GAP_MS = 2000

const bgState = {
  started: false,
  gen: 0,
  desktop: null,
  origin: '',
  status: 'starting',
  online: null,
  lastError: null,
  failures: 0,
  dm: Object.create(null),
  activePoll: null,
  reportTimer: 0,
  lastSentAt: 0,
  lastPayload: '',
  lastOpen: 0
}

function bgModeActive () {
  const d = window.telsizArkaPlan
  return Boolean(d && typeof d === 'object' && d.background === true && typeof d.report === 'function')
}

function bgCount (value) {
  const n = Number(value)
  return isFinite(n) && n > 0 ? Math.floor(n) : 0
}

// Toplamlar: odalar (yazı odaları) ve özel konuşmalar. Özel mesajlar anma rozetinde de sayılır.
function bgCounts () {
  let unread = 0
  let mention = 0
  const rooms = Object.create(null)
  textChannels().forEach((c) => {
    rooms[String(c.id)] = true
    unread += bgCount(state.unread[c.id])
    mention += mentionCount(c.id)
  })
  Object.keys(state.unread).forEach((id) => {
    if (rooms[id]) return
    if (!bgState.dm[id] && !(typeof isDmChannel === 'function' && isDmChannel(id))) return
    const n = bgCount(state.unread[id])
    unread += n
    mention += n
  })
  return { unread: unread, mention: mention }
}

function bgOnlineUsers () {
  if (!state.meta) return null
  try {
    return typeof onlineCount === 'function' ? onlineCount() : null
  } catch (err) {
    return null
  }
}

function bgPayload () {
  const counts = bgCounts()
  const ok = bgState.status === 'ok'
  return {
    origin: bgState.origin,
    state: bgState.status,
    unread: ok ? counts.unread : 0,
    mention: ok ? counts.mention : 0,
    online: bgState.online,
    lastError: bgState.lastError,
    name: typeof state.serverName === 'string' && state.info ? state.serverName : null,
    onlineUsers: ok ? bgOnlineUsers() : null
  }
}

function bgSend () {
  clearTimeout(bgState.reportTimer)
  bgState.reportTimer = 0
  let payload = null
  try {
    payload = bgPayload()
  } catch (err) {
    window.console.error(err)
    return
  }
  const text = JSON.stringify(payload)
  if (text === bgState.lastPayload) return
  bgState.lastPayload = text
  bgState.lastSentAt = Date.now()
  try {
    bgState.desktop.report(payload)
  } catch (err) {
    // Ana süreç kapanıyor olabilir
  }
}

// Sayılar değişince en fazla saniyede bir bildirilir, durum değişince hemen
function bgReport (now) {
  if (now) {
    bgSend()
    return
  }
  if (bgState.reportTimer) return
  const gap = Math.max(0, BG_REPORT_GAP_MS - (Date.now() - bgState.lastSentAt))
  bgState.reportTimer = setTimeout(bgSend, gap)
}

function bgSetStatus (status, lastError, online) {
  bgState.status = status
  bgState.lastError = lastError || null
  if (online === true || online === false) bgState.online = online
  bgReport(true)
}

function bgStopPoll () {
  bgState.gen += 1
  const pending = bgState.activePoll
  bgState.activePoll = null
  if (pending && typeof pending.abort === 'function') pending.abort()
}

// Oturum yok veya geçersiz: "giriş gerekli" bildirilir ve döngü durur. Oturum bilgisi silinmez (frekans
// açıldığında normal istemci kendisi karar verir).
function bgNeedsLogin (code) {
  bgStopPoll()
  state.token = ''
  bgSetStatus('login', code || 'session', true)
}

function bgRetryDelay (failures) {
  return Math.min(BG_RETRY_MAX_MS, Math.pow(2, Math.max(0, failures - 1)) * 2000)
}

function bgUnreachable (gen) {
  bgState.failures += 1
  bgSetStatus('offline', 'unreachable', false)
  const delay = bgRetryDelay(bgState.failures)
  setTimeout(() => {
    if (gen === bgState.gen) bgBoot()
  }, delay)
}

function bgAuthFailed (res) {
  const code = res && res.data && typeof res.data.code === 'string' ? res.data.code : ''
  if (res && res.status === 401) return 'session'
  if (res && res.status === 403 && code === 'banned') return 'banned'
  return ''
}

// /api/state yanıtı: arayüz çizilmeden normal istemcinin kullandığı durum alanları doldurulur
function bgApplyState (data) {
  state.me = { id: data.me.id, name: String(data.me.name || ''), role: data.me.role, status: typeof data.me.status === 'string' ? data.me.status : 'online' }
  state.boot = String(data.boot || '')
  state.seq = Number(data.seq) || 0
  state.metaVersion = Number(data.metaVersion) || 0
  state.sigSeq = Number(data.sigSeq) || 0
  setServerKeys(data.keys)
  if (typeof setFormerUsers === 'function') setFormerUsers(data.formerUsers)
  if (data.meta) applyMeta(data.meta, true)
  socialApplyState(data)
}

function bgResetCounts () {
  state.unread = Object.create(null)
  state.mentions = Object.create(null)
  bgState.dm = Object.create(null)
  state.lastRead = storeGetJson(userKey('read'), {})
  if (typeof decryptCache === 'object' && decryptCache && typeof decryptCache.clear === 'function') decryptCache.clear()
}

// Açılış taraması (04-meta.js scanUnread ve 15-dm.js scanDmUnread ile aynı kural, arayüz çizilmez)
async function bgScan (gen) {
  const me = state.me
  const fetchPage = async (id) => {
    const res = await request('GET', '/api/messages?channel=' + encodeURIComponent(id) + '&limit=' + PAGE_SIZE)
    if (gen !== bgState.gen) return null
    if (bgAuthFailed(res)) {
      bgNeedsLogin(bgAuthFailed(res))
      return null
    }
    return res.status === 200 && res.data && Array.isArray(res.data.messages) ? res.data.messages : []
  }
  for (const c of textChannels()) {
    if (gen !== bgState.gen) return
    const messages = await fetchPage(c.id)
    if (messages === null) return
    const lastRead = Number(state.lastRead[c.id]) || 0
    const unread = messages.filter((m) => Number(m.id) > lastRead && !sameId(m.authorId, me.id))
    if (unread.length > bgCount(state.unread[c.id])) state.unread[c.id] = unread.length
    const mentions = unread.filter((m) => !isBlocked(m.authorId) && messageMentionsMe(m)).length
    if (mentions > mentionCount(c.id)) state.mentions[c.id] = mentions
    bgReport(false)
  }
  for (const d of dmEntries().slice()) {
    if (gen !== bgState.gen) return
    const lastRead = Number(state.lastRead[d.id]) || 0
    if (d.lastMessageId === null || d.lastMessageId === undefined || Number(d.lastMessageId) <= lastRead) continue
    const messages = await fetchPage(d.id)
    if (messages === null) return
    const count = messages.filter((m) => Number(m.id) > lastRead && !sameId(m.authorId, me.id)).length
    bgState.dm[String(d.id)] = true
    if (count > bgCount(state.unread[d.id])) state.unread[d.id] = count
    bgReport(false)
  }
}

async function bgBoot () {
  bgStopPoll()
  const gen = bgState.gen
  const info = await request('GET', '/api/info', { token: '' })
  if (gen !== bgState.gen) return
  if (info.status !== 200 || !info.data) {
    bgUnreachable(gen)
    return
  }
  applyInfo(info.data)
  bgState.online = true
  if (info.data.setupRequired === true) {
    bgNeedsLogin('session')
    return
  }
  const token = storeGet(KEYS.token)
  if (!token) {
    bgNeedsLogin('session')
    return
  }
  state.token = token
  const res = await request('GET', '/api/state')
  if (gen !== bgState.gen) return
  if (bgAuthFailed(res)) {
    bgNeedsLogin(bgAuthFailed(res))
    return
  }
  if (res.status !== 200 || !res.data || !res.data.me) {
    bgUnreachable(gen)
    return
  }
  bgState.failures = 0
  bgApplyState(res.data)
  bgResetCounts()
  bgSetStatus('ok', hasActiveKey() ? null : 'no_key', true)
  await bgScan(gen)
  if (gen !== bgState.gen) return
  bgReport(false)
  bgPoll(gen)
}

// Long-poll döngüsü (05-poll.js pollLoop ile aynı sorgu, yazıyor ve müzik izlenmez: tv ve muv gönderilmez,
// sunucu poll'u bunlar için uyandırmaz)
async function bgPoll (gen) {
  let failures = 0
  while (gen === bgState.gen && state.token) {
    const path = '/api/poll?since=' + encodeURIComponent(state.seq) +
      '&mv=' + encodeURIComponent(state.metaVersion) +
      '&pmv=' + encodeURIComponent(socialPmv()) +
      '&sig=' + encodeURIComponent(state.sigSeq) +
      '&boot=' + encodeURIComponent(state.boot)
    const pending = request('GET', path, { timeout: POLL_TIMEOUT_MS })
    bgState.activePoll = pending
    const res = await pending
    if (gen !== bgState.gen) return
    bgState.activePoll = null
    if (res.status === 200 && res.data) {
      failures = 0
      if (bgState.status !== 'ok' || bgState.online !== true) bgSetStatus('ok', hasActiveKey() ? null : 'no_key', true)
      try {
        bgHandlePoll(res.data, gen)
      } catch (err) {
        window.console.error(err)
      }
      continue
    }
    if (bgAuthFailed(res)) {
      bgNeedsLogin(bgAuthFailed(res))
      return
    }
    failures += 1
    if (failures >= 2 && bgState.status !== 'offline') bgSetStatus('offline', 'unreachable', false)
    await wait(bgRetryDelay(failures))
  }
}

function bgApplyPrivate (p, pmv) {
  socialState.priv = normalizePrivate(p)
  if (typeof pmv === 'number') socialState.pmv = pmv
  if (state.me && socialState.priv.status) state.me.status = socialState.priv.status
}

function bgSignals (signals) {
  if (!Array.isArray(signals)) return
  signals.forEach((s) => {
    if (s && typeof s.seq === 'number' && s.seq > state.sigSeq) state.sigSeq = s.seq
  })
}

function bgHandlePoll (data, gen) {
  const bootChanged = typeof data.boot === 'string' && data.boot !== state.boot
  if (bootChanged || data.resync === true) {
    if (bootChanged) state.sigSeq = 0
    state.boot = String(data.boot || state.boot)
    state.seq = Number(data.seq) || 0
    state.metaVersion = Number(data.metaVersion) || 0
    if (data.meta) applyMeta(data.meta, true)
    if (data.private) bgApplyPrivate(data.private, Number(data.pmv) || 0)
    bgSignals(data.signals)
    // Olay kaybı olmuş olabilir: sayılar son okunandan yeniden sayılır
    bgResetCounts()
    bgScan(gen).then(() => bgReport(false))
    return
  }
  if (data.meta) {
    state.metaVersion = Number(data.metaVersion) || state.metaVersion
    applyMeta(data.meta, true)
    bgReport(false)
  }
  if (data.private) bgApplyPrivate(data.private, Number(data.pmv) || 0)
  const events = Array.isArray(data.events) ? data.events : []
  events.forEach((ev) => {
    if (!ev || typeof ev !== 'object' || ev.type !== 'msg' || !ev.message) return
    try {
      bgOnMessage(ev.message)
    } catch (err) {
      window.console.error(err)
    }
  })
  if (typeof data.seq === 'number' && data.seq >= 0) state.seq = data.seq
  bgSignals(data.signals)
}

// Yeni mesaj: kendi mesajım sayılmaz. Özel mesaj okunmamış ve anma toplamına, odadaki mesaj okunmamışa,
// beni anıyorsa (engellenen kişi değilse) anmaya eklenir.
function bgOnMessage (message) {
  if (!state.me || sameId(message.authorId, state.me.id)) return
  const id = message.channelId
  const dm = isDmMessage(message)
  state.unread[id] = bgCount(state.unread[id]) + 1
  let personal = dm
  if (dm) {
    bgState.dm[String(id)] = true
  } else if (!isBlocked(message.authorId) && messageMentionsMe(message)) {
    state.mentions[id] = mentionCount(id) + 1
    personal = true
  }
  bgReport(false)
  if (personal) bgNotify(message, dm)
}

// Sessiz sistem bildirimi: o frekansın bildirim ayarı (açık ve izinli, düzey, Rahatsız etmeyin) geçerlidir
function bgNotify (message, dm) {
  if (typeof notificationsAllowedNow !== 'function' || !notificationsAllowedNow()) return
  if (typeof messageAlertAllowed === 'function' && !messageAlertAllowed(message)) return
  const result = decryptMessage(message)
  let text = ''
  if (result.state === 'ok') {
    text = result.text ? cpSlice(result.text, 100) : (result.files && result.files.length ? t(result.files[0].kind === 'image' ? 'notify.photo' : 'notify.file') : '')
  } else {
    text = t('notify.encrypted')
  }
  const name = userDisplayName(message.authorId)
  const title = dm ? name + ' · ' + state.serverName : state.serverName
  const body = dm ? text : t('notify.body', { name: name, text: text })
  try {
    const n = new window.Notification(title, { body: body, tag: 'telsiz-bg-' + message.channelId, silent: true })
    n.onclick = () => {
      n.close()
      const now = Date.now()
      if (now - bgState.lastOpen < BG_OPEN_GAP_MS) return
      bgState.lastOpen = now
      if (typeof bgState.desktop.open === 'function') Promise.resolve(bgState.desktop.open()).catch(() => {})
    }
  } catch (err) {
    // Bildirim gösterilemedi
  }
}

function bgStart () {
  if (bgState.started) return
  bgState.started = true
  const d = window.telsizArkaPlan
  bgState.desktop = d
  bgState.origin = typeof d.origin === 'string' ? d.origin : ''
  state.inApp = false
  if (!cryptoReady()) {
    bgSetStatus('error', 'crypto', null)
    return
  }
  bgReport(true)
  bgBoot().catch((err) => {
    window.console.error(err)
    bgSetStatus('error', 'error', null)
  })
}
