'use strict'

// Arka plan sayımı: açık olmayan frekansların okunmamış ve anma sayıları ile sunucularının erişilebilirliği.
//
// Ana süreç, kayıtlı frekanslardan açık olmayanlar için (en son kullanılan en fazla MAX_WINDOWS frekans)
// o frekansın kendi oturum bölümünde gizli ve hafif bir pencere açar (src/main.js createBackgroundWindow).
// Pencerede aynı uygulama paketi, aynı ön yükleme betiği, korumalı alan ve CSP ile istemcinin arka plan kipi
// çalışır (public/js/25-arka-plan.js): o frekansın kayıtlı oturumuyla long-poll yapar, okunmamışları ve
// anmaları normal istemcinin kuralıyla sayar ve durumu telsiz:bg-report kanalıyla bildirir. Bu modül
// pencerelerin yaşam döngüsünü (üst sınır, geçişte takas, çökmede gecikmeli yeniden açma), raporların
// doğrulanmasını ve her frekans için GET <köken>/api/info erişilebilirlik yoklamasını (başarıda yaklaşık
// 60 saniyede bir, hatada katlanarak 10 dakikaya kadar seyrelen) yönetir. Yoklama üst sınırın dışında
// kalan frekanslar için de yapılır.
//
// Kurallar:
// - Açık frekansın (uygulama penceresi) arka plan penceresi olmaz. Geçişte hedef frekansın penceresi hemen
//   kapatılır, önceki frekansın penceresi START_DELAY_MS sonra açılır (eski pencere önce kapanır, aynı
//   oturumla iki istemci üst üste çalışmaz).
// - Pencereler STAGGER_MS arayla teker teker açılır.
// - Oturumu olmayan veya geçersiz frekans "login" bildirir: penceresi kapatılır ve kullanıcı o frekansı
//   açana kadar yeniden açılmaz.
// - Rapor yalnızca kayıtlı bir arka plan penceresinden gelebilir ve o pencerenin kökenini taşımalıdır, her
//   alan türü ve sınırıyla denetlenir. Bilinmeyen alan içeren rapor reddedilir.
// Sayılar oturuma özeldir: uygulama yeniden açılınca pencereler son okunandan yeniden sayar.
// Electron'a bağımlı değildir: pencere açma, yoklama, zamanlayıcılar ve bildirim dışarıdan verilir, Node
// ile test edilir (desktop/test/arka-plan.test.js).

const frequencies = require('./frequencies')
const { isValidOrigin } = require('./server-url')

const MAX_WINDOWS = 8
const START_DELAY_MS = 3000
const STAGGER_MS = 1500
const PROBE_INTERVAL_MS = 60000
const PROBE_MAX_MS = 10 * 60000
const PROBE_TIMEOUT_MS = 8000
const PROBE_STAGGER_MS = 500
const RESTART_DELAY_MS = 30000
const RESTART_MAX_MS = 10 * 60000
const PUSH_GAP_MS = 300
const MAX_COUNT = 100000
const MAX_USERS = 1000000
const STATES = Object.freeze(['ok', 'login', 'offline', 'error', 'starting'])
const ERRORS = Object.freeze(['session', 'banned', 'unreachable', 'no_key', 'crypto', 'error'])
const REPORT_KEYS = Object.freeze(['origin', 'state', 'unread', 'mention', 'online', 'lastError', 'name', 'onlineUsers'])

function isCount (value, max) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max
}

// Arka plan penceresinin raporunu doğrular. Sonuç temiz bir kopya veya null.
function validateReport (raw, expectedOrigin) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const keys = Object.keys(raw)
  if (keys.length > REPORT_KEYS.length || keys.some((key) => !REPORT_KEYS.includes(key))) return null
  if (typeof raw.origin !== 'string' || raw.origin.length > frequencies.MAX_INPUT || !isValidOrigin(raw.origin)) return null
  if (raw.origin !== expectedOrigin) return null
  if (!STATES.includes(raw.state)) return null
  if (!isCount(raw.unread, MAX_COUNT) || !isCount(raw.mention, MAX_COUNT)) return null
  if (raw.online !== true && raw.online !== false && raw.online !== null) return null
  if (raw.lastError !== null && !ERRORS.includes(raw.lastError)) return null
  let name = null
  if (raw.name !== undefined && raw.name !== null) {
    if (typeof raw.name !== 'string' || raw.name.length > frequencies.MAX_INPUT) return null
    name = frequencies.cleanName(raw.name)
  }
  let onlineUsers = null
  if (raw.onlineUsers !== undefined && raw.onlineUsers !== null) {
    if (!isCount(raw.onlineUsers, MAX_USERS)) return null
    onlineUsers = raw.onlineUsers
  }
  return {
    origin: raw.origin,
    state: raw.state,
    unread: raw.unread,
    mention: raw.mention,
    online: raw.online,
    lastError: raw.lastError,
    name,
    onlineUsers
  }
}

// Yoklama aralığı: başarıda PROBE_INTERVAL_MS, art arda her hatada iki katı, en fazla PROBE_MAX_MS
function probeDelay (failures) {
  const n = Number.isInteger(failures) && failures > 0 ? Math.min(failures, 16) : 0
  return Math.min(PROBE_MAX_MS, PROBE_INTERVAL_MS * Math.pow(2, n))
}

function restartDelay (failures) {
  const n = Number.isInteger(failures) && failures > 1 ? Math.min(failures - 1, 16) : 0
  return Math.min(RESTART_MAX_MS, RESTART_DELAY_MS * Math.pow(2, n))
}

// Arka plan penceresi açılacak frekanslar: açık olmayanlar, en son kullanılan önce, en fazla max
function pickTargets (list, active, max) {
  const limit = Number.isInteger(max) && max >= 0 ? max : MAX_WINDOWS
  return frequencies.sanitizeList(list)
    .map((item, i) => ({ item, i }))
    .filter((entry) => entry.item.origin !== active)
    .sort((a, b) => (b.item.lastUsed - a.item.lastUsed) || (a.i - b.i))
    .slice(0, limit)
    .map((entry) => entry.item.origin)
}

// deps: {
//   frequencies(): kayıtlı liste [{ origin, name, lastUsed }], her çağrıda yeniden okunur
//   active(): uygulama penceresinin açık olduğu frekans veya null
//   createWindow(origin): { id, destroy() } (id: pencerenin webContents kimliği)
//   probe(origin): Promise<boolean> (GET <köken>/api/info başarılı mı)
//   push(snapshot): durum uygulama penceresine gönderilir
//   setName(origin, name): arka plan penceresinin öğrendiği sunucu adı (isteğe bağlı)
//   setTimer(fn, ms), clearTimer(handle), now()
//   max: üst sınır (varsayılan MAX_WINDOWS)
// }
function createManager (deps) {
  const max = Number.isInteger(deps.max) && deps.max >= 0 ? deps.max : MAX_WINDOWS
  const entries = new Map()
  let running = false
  let syncTimer = null
  let pushTimer = null

  function entryOf (origin) {
    let entry = entries.get(origin)
    if (!entry) {
      entry = { origin, window: null, state: null, unread: 0, mention: 0, online: null, lastError: null, onlineUsers: null, probeFailures: 0, probeTimer: null, probing: false, restartFailures: 0, waitUntil: 0, blocked: false }
      entries.set(origin, entry)
    }
    return entry
  }

  function savedOrigins () {
    return frequencies.sanitizeList(deps.frequencies()).map((item) => item.origin)
  }

  function clearCounts (entry) {
    entry.state = null
    entry.unread = 0
    entry.mention = 0
    entry.lastError = null
    entry.onlineUsers = null
  }

  // Pencere bilerek kapatılır: önce kayıttan düşer, kapanma olayı yeniden açmayı tetiklemez
  function closeWindow (entry) {
    const win = entry.window
    entry.window = null
    if (!win) return
    try {
      win.destroy()
    } catch (err) {
      // Pencere zaten kapanmış
    }
  }

  function snapshot () {
    const active = deps.active()
    const items = savedOrigins().map((origin) => {
      const entry = entries.get(origin)
      const isActive = origin === active
      return {
        origin,
        active: isActive,
        background: Boolean(entry && entry.window),
        state: entry && !isActive ? entry.state : null,
        unread: entry && !isActive && entry.state === 'ok' ? entry.unread : 0,
        mention: entry && !isActive && entry.state === 'ok' ? entry.mention : 0,
        online: entry && !isActive ? entry.online : null,
        lastError: entry && !isActive ? entry.lastError : null,
        onlineUsers: entry && !isActive && entry.state === 'ok' ? entry.onlineUsers : null
      }
    })
    return { max, items }
  }

  function schedulePush () {
    if (pushTimer !== null) return
    pushTimer = deps.setTimer(() => {
      pushTimer = null
      deps.push(snapshot())
    }, PUSH_GAP_MS)
  }

  function scheduleSync (ms) {
    if (!running) return
    if (syncTimer !== null) deps.clearTimer(syncTimer)
    syncTimer = deps.setTimer(() => {
      syncTimer = null
      sync()
    }, ms)
  }

  function scheduleProbe (entry, ms) {
    if (entry.probeTimer !== null) deps.clearTimer(entry.probeTimer)
    entry.probeTimer = deps.setTimer(() => {
      entry.probeTimer = null
      runProbe(entry)
    }, ms)
  }

  function runProbe (entry) {
    if (!running || entry.probing) return
    if (!savedOrigins().includes(entry.origin) || entry.origin === deps.active()) return
    entry.probing = true
    Promise.resolve().then(() => deps.probe(entry.origin)).then((ok) => ok === true, () => false).then((ok) => {
      entry.probing = false
      if (!running || !entries.has(entry.origin)) return
      entry.probeFailures = ok ? 0 : entry.probeFailures + 1
      entry.online = ok
      schedulePush()
      scheduleProbe(entry, probeDelay(entry.probeFailures))
    })
  }

  // Kayıtlı liste ve açık frekansla pencereleri ve yoklamaları uzlaştırır. Her çağrıda en fazla bir pencere
  // açılır, açılacak başka pencere varsa STAGGER_MS sonra yeniden çağrılır.
  function sync () {
    if (!running) return
    const active = deps.active()
    const saved = savedOrigins()
    for (const [origin, entry] of entries) {
      if (saved.includes(origin)) continue
      closeWindow(entry)
      if (entry.probeTimer !== null) deps.clearTimer(entry.probeTimer)
      entries.delete(origin)
    }
    const targets = pickTargets(deps.frequencies(), active, max)
    let probeIndex = 0
    for (const origin of saved) {
      const entry = entryOf(origin)
      if (origin === active) {
        closeWindow(entry)
        continue
      }
      if (!targets.includes(origin) && entry.window) closeWindow(entry)
      if (entry.probeTimer === null && !entry.probing) {
        scheduleProbe(entry, probeIndex * PROBE_STAGGER_MS)
        probeIndex += 1
      }
    }
    const now = deps.now()
    let opened = false
    let pending = false
    let nextWait = 0
    for (const origin of targets) {
      const entry = entryOf(origin)
      if (entry.window || entry.blocked) continue
      if (entry.waitUntil > now) {
        nextWait = nextWait === 0 ? entry.waitUntil - now : Math.min(nextWait, entry.waitUntil - now)
        continue
      }
      if (opened) {
        pending = true
        continue
      }
      try {
        entry.window = deps.createWindow(origin)
        entry.state = 'starting'
        opened = true
      } catch (err) {
        entry.window = null
        entry.restartFailures += 1
        entry.waitUntil = now + restartDelay(entry.restartFailures)
      }
    }
    if (pending) scheduleSync(STAGGER_MS)
    else if (nextWait > 0) scheduleSync(nextWait)
    schedulePush()
  }

  // Uygulama penceresi bir frekansla açıldı (açılışta ve her geçişte)
  function setActive (origin) {
    running = true
    if (origin) {
      const entry = entryOf(origin)
      closeWindow(entry)
      clearCounts(entry)
      entry.blocked = false
      entry.restartFailures = 0
      entry.waitUntil = 0
    }
    schedulePush()
    scheduleSync(START_DELAY_MS)
  }

  // Liste değişti (ekleme, çıkarma)
  function listChanged () {
    if (!running) return
    scheduleSync(0)
  }

  function ownerOf (contentsId) {
    for (const entry of entries.values()) {
      if (entry.window && entry.window.id === contentsId) return entry.origin
    }
    return null
  }

  // Rapor: yalnızca kayıtlı pencereden ve doğrulanmış alanlarla. Sonuç true (kabul) veya false.
  function report (contentsId, raw) {
    const origin = ownerOf(contentsId)
    if (!origin) return false
    const clean = validateReport(raw, origin)
    if (!clean) return false
    const entry = entryOf(origin)
    entry.state = clean.state
    entry.unread = clean.unread
    entry.mention = clean.mention
    entry.lastError = clean.lastError
    entry.onlineUsers = clean.onlineUsers
    if (clean.online !== null) entry.online = clean.online
    if (clean.state === 'ok') entry.restartFailures = 0
    if (clean.name && typeof deps.setName === 'function') deps.setName(origin, clean.name)
    if (clean.state === 'login') {
      // Oturum yok: pencere kapatılır, kullanıcı frekansı açana kadar yeniden açılmaz
      entry.blocked = true
      closeWindow(entry)
    }
    schedulePush()
    return true
  }

  // Pencere beklenmedik biçimde kapandı (çökme): gecikmeli ve seyrelen yeniden açma
  function windowGone (contentsId) {
    for (const entry of entries.values()) {
      if (!entry.window || entry.window.id !== contentsId) continue
      entry.window = null
      entry.state = 'error'
      entry.lastError = 'error'
      entry.restartFailures += 1
      entry.waitUntil = deps.now() + restartDelay(entry.restartFailures)
      schedulePush()
      scheduleSync(entry.waitUntil - deps.now())
      return true
    }
    return false
  }

  // Uygulama kapanıyor veya uygulama penceresi kapandı: tüm pencereler ve zamanlayıcılar durur
  function stop () {
    running = false
    if (syncTimer !== null) deps.clearTimer(syncTimer)
    syncTimer = null
    if (pushTimer !== null) deps.clearTimer(pushTimer)
    pushTimer = null
    for (const entry of entries.values()) {
      closeWindow(entry)
      if (entry.probeTimer !== null) deps.clearTimer(entry.probeTimer)
      entry.probeTimer = null
    }
  }

  function windowCount () {
    let n = 0
    for (const entry of entries.values()) {
      if (entry.window) n += 1
    }
    return n
  }

  return { setActive, listChanged, sync, report, ownerOf, windowGone, snapshot, stop, windowCount, isRunning: () => running }
}

module.exports = {
  MAX_WINDOWS,
  START_DELAY_MS,
  STAGGER_MS,
  PROBE_INTERVAL_MS,
  PROBE_MAX_MS,
  PROBE_TIMEOUT_MS,
  RESTART_DELAY_MS,
  STATES,
  ERRORS,
  validateReport,
  probeDelay,
  restartDelay,
  pickTargets,
  createManager
}
