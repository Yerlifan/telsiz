'use strict'

// Kalıcılık katmanı.
// state.json atomik yazılır, mesajlar kanal başına JSONL günlüğünde, yüklemeler uploads/<id>.bin dosyalarında tutulur.
// Mesaj gövdeleri sunucu için opak E2EE zarflarıdır, bu katman içeriklerini hiçbir zaman loglamaz.
// İşletmecinin göreceği hata ve uyarı metinleri lang seçeneğindeki dilde üretilir (varsayılan tr).

const fs = require('node:fs')
const path = require('node:path')
const i18n = require('./i18n')

// Testlerin Windows hatalarını taklit edebilmesi için fs.promises üyeleri her çağrıda bu nesneden okunur.
const fsp = fs.promises

const STATE_VERSION = 2
const STATE_FILE = 'state.json'
const LOCK_FILE = '.kilit'
const MESSAGES_DIR = 'messages'
const UPLOADS_DIR = 'uploads'
const UPLOAD_ID_RE = /^[0-9a-f]{32}$/
const UPLOAD_BIN_RE = /^([0-9a-f]{32})\.bin$/
const CHANNEL_FILE_RE = /^(\d{1,16})\.jsonl$/
const SAVE_DELAY_MS = 200
const RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])
const FS_RETRIES = 3
const FS_RETRY_DELAY_MS = 50
const COMPACT_RATIO = 0.3
const DEFAULT_MAX_PER_CHANNEL = 20000
// Tüm kanallardaki toplam mesaj sınırı (bellek koruması), aşılınca en büyük kanalların en eskileri düşer
const DEFAULT_MAX_TOTAL = 500000
const DEFAULT_COMPACT_MIN_LINES = 1000
const DEFAULT_LIST_LIMIT = 50
const MAX_LINE_BYTES = 16 * 1024 * 1024
const MAX_RETRY_DELAY_MS = 5000
const DIR_MODE = 0o700
const FILE_MODE = 0o600
const ARRAY_FIELDS = ['users', 'sessions', 'channels', 'uploads']
const COUNTER_FIELDS = ['user', 'channel', 'message']
const DEFAULT_LANG = 'tr'

class StoreError extends Error {
  constructor (message, code, cause) {
    super(message)
    this.name = 'StoreError'
    this.code = code || 'store_error'
    if (cause !== undefined) this.cause = cause
  }
}

function noop () {}

function hasOwn (obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

function isPlainObject (value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isId (value) {
  return Number.isSafeInteger(value) && value >= 0
}

function posInt (value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function delay (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function unrefTimer (timer) {
  if (timer && typeof timer.unref === 'function') timer.unref()
  return timer
}

function retryDelay (failures) {
  return Math.min(MAX_RETRY_DELAY_MS, 100 * Math.pow(2, Math.min(failures, 6)))
}

function errText (err, lang) {
  if (!err) return i18n.t(lang, 'store.unknownError')
  if (err.code && err.message) return err.code + ' (' + err.message + ')'
  return String(err.message || err)
}

function ioError (err, lang) {
  if (err instanceof StoreError) return err
  return new StoreError(i18n.t(lang, 'store.ioError', { error: errText(err, lang) }), 'io', err)
}

function makeLogger (log) {
  if (log === null || log === false) return { info: noop, warn: noop, error: noop }
  const target = log || console
  function pick (name) {
    let fn = noop
    if (typeof target[name] === 'function') fn = target[name]
    else if (typeof target.log === 'function') fn = target.log
    return (text) => {
      try {
        fn.call(target, text)
      } catch (err) {
        // log hatası kalıcılığı etkilememeli
      }
    }
  }
  return { info: pick('info'), warn: pick('warn'), error: pick('error') }
}

// Windows'ta virüs tarayıcısı veya dizin oluşturucu dosyayı kısa süre kilitleyebilir.
// EPERM, EBUSY ve EACCES hatalarında işlem 50 ms arayla 3 kez daha denenir.
async function retryFs (fn) {
  let attempt = 0
  while (true) {
    try {
      return await fn()
    } catch (err) {
      if (!err || !RETRY_CODES.has(err.code) || attempt >= FS_RETRIES) throw err
      attempt++
      await delay(FS_RETRY_DELAY_MS)
    }
  }
}

function renameRetry (from, to) {
  return retryFs(() => fsp.rename(from, to))
}

// Dosyayı siler, yoksa sessizce false döner.
async function unlinkQuiet (file) {
  try {
    await retryFs(() => fsp.unlink(file))
    return true
  } catch (err) {
    if (err && err.code === 'ENOENT') return false
    throw err
  }
}

async function fsyncDir (dir) {
  if (process.platform === 'win32') return
  let handle = null
  try {
    handle = await fsp.open(dir, 'r')
    await handle.sync()
  } catch (err) {
    // bazı dosya sistemleri klasör fsync desteklemez
  } finally {
    if (handle) await handle.close().catch(noop)
  }
}

async function writeFileDurable (file, data, flags) {
  const handle = await fsp.open(file, flags || 'w', FILE_MODE)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
}

// Önce <dosya>.tmp yazılır ve diske zorlanır, sonra tek adımda yerine taşınır.
async function atomicWrite (file, data) {
  const tmp = file + '.tmp'
  try {
    await writeFileDurable(tmp, data)
    await renameRetry(tmp, file)
  } catch (err) {
    await unlinkQuiet(tmp).catch(noop)
    throw err
  }
  await fsyncDir(path.dirname(file))
}

function isPidAlive (pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 0x7fffffff) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return Boolean(err && err.code === 'EPERM')
  }
}

// Kilit dosyasının durumunu okur (CLI ve openStore kullanır). Hiçbir şey yazmaz.
function lockInfo (dir) {
  const file = path.join(path.resolve(String(dir)), LOCK_FILE)
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return { path: file, exists: false, pid: null, alive: false }
    throw err
  }
  const match = /^\s*(\d{1,10})\s*$/.exec(text)
  const pid = match ? Number(match[1]) : null
  return { path: file, exists: true, pid, alive: pid !== null && isPidAlive(pid) }
}

// Boş durum iskeleti. Sunucu adı burada kullanılmaz, uygulama ilk durumu kendi değerleriyle oluşturur.
function emptyState () {
  return {
    version: STATE_VERSION,
    serverName: 'Telsiz',
    inviteCode: null,
    activeKid: null,
    counters: { user: 0, channel: 0, message: 0 },
    users: [],
    sessions: [],
    channels: [],
    uploads: []
  }
}

// Eksik alanları iskeletle tamamlar (nesnenin kendisini değiştirir), yapı geçersizse null döner.
function normalizeState (raw) {
  if (!isPlainObject(raw) || raw.version !== STATE_VERSION) return null
  const base = emptyState()
  for (const key of Object.keys(base)) {
    if (!hasOwn(raw, key) || raw[key] === undefined) raw[key] = base[key]
  }
  if (typeof raw.serverName !== 'string') return null
  if (raw.inviteCode !== null && typeof raw.inviteCode !== 'string') return null
  if (raw.activeKid !== null && typeof raw.activeKid !== 'string') return null
  if (!isPlainObject(raw.counters)) return null
  for (const key of COUNTER_FIELDS) {
    if (!hasOwn(raw.counters, key) || raw.counters[key] === undefined) raw.counters[key] = 0
    if (!isId(raw.counters[key])) return null
  }
  for (const key of ARRAY_FIELDS) {
    if (!Array.isArray(raw[key]) || !raw[key].every(isPlainObject)) return null
  }
  return raw
}

async function readStateFile (file, lang) {
  let text
  try {
    text = await fsp.readFile(file, 'utf8')
  } catch (err) {
    if (err && err.code === 'ENOENT') return { kind: 'missing' }
    throw ioError(err, lang)
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1)
  let raw
  try {
    raw = JSON.parse(text)
  } catch (err) {
    return { kind: 'corrupt' }
  }
  if (isPlainObject(raw) && typeof raw.version === 'number' && raw.version !== STATE_VERSION) {
    return { kind: 'version', version: raw.version }
  }
  const state = normalizeState(raw)
  return state ? { kind: 'ok', state } : { kind: 'corrupt' }
}

function versionError (version, lang) {
  return new StoreError(i18n.t(lang, 'store.versionMismatch', { version }), 'version')
}

// Mesaj nesnesini doğrular ve yalnızca tanımlı alanlarla yeni bir kopya döner, geçersizse null.
function cleanMessage (m) {
  if (!isPlainObject(m)) return null
  if (!isId(m.id) || !isId(m.channelId) || !isId(m.authorId)) return null
  if (typeof m.body !== 'string') return null
  if (typeof m.createdAt !== 'number' || !Number.isFinite(m.createdAt)) return null
  const editedAt = m.editedAt === undefined || m.editedAt === null ? null : m.editedAt
  if (editedAt !== null && (typeof editedAt !== 'number' || !Number.isFinite(editedAt))) return null
  const uploads = m.uploads === undefined || m.uploads === null ? [] : m.uploads
  if (!Array.isArray(uploads)) return null
  for (const id of uploads) {
    if (typeof id !== 'string' || !UPLOAD_ID_RE.test(id)) return null
  }
  return {
    id: m.id,
    channelId: m.channelId,
    authorId: m.authorId,
    body: m.body,
    createdAt: m.createdAt,
    editedAt,
    uploads: uploads.slice()
  }
}

function copyMessage (m) {
  return {
    id: m.id,
    channelId: m.channelId,
    authorId: m.authorId,
    body: m.body,
    createdAt: m.createdAt,
    editedAt: m.editedAt,
    uploads: m.uploads.slice()
  }
}

function addLine (m) {
  return JSON.stringify({ op: 'add', m }) + '\n'
}

// Artan id sıralı listede id'si verilen değerden küçük olmayan ilk konum.
function lowerBound (list, id) {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (list[mid].id < id) lo = mid + 1
    else hi = mid
  }
  return lo
}

// Dosyayı akışla satır satır okur. Son satır satır sonu olmadan bitiyorsa true döner.
// Aşırı uzun satırlar bellek tüketmemek için null olarak bildirilir.
async function scanLines (file, onLine) {
  const stream = fs.createReadStream(file)
  let parts = []
  let partsLength = 0
  let skipping = false
  for await (const chunk of stream) {
    let start = 0
    let nl = chunk.indexOf(10)
    while (nl !== -1) {
      if (skipping) {
        skipping = false
        onLine(null)
      } else if (parts.length > 0) {
        parts.push(chunk.subarray(start, nl))
        onLine(Buffer.concat(parts).toString('utf8'))
        parts = []
        partsLength = 0
      } else {
        onLine(chunk.toString('utf8', start, nl))
      }
      start = nl + 1
      nl = chunk.indexOf(10, start)
    }
    if (start < chunk.length && !skipping) {
      parts.push(chunk.subarray(start))
      partsLength += chunk.length - start
      if (partsLength > MAX_LINE_BYTES) {
        parts = []
        partsLength = 0
        skipping = true
      }
    }
  }
  if (skipping) {
    onLine(null)
    return true
  }
  if (parts.length > 0) {
    onLine(Buffer.concat(parts).toString('utf8'))
    return true
  }
  return false
}

async function openStore (options) {
  const opts = isPlainObject(options) ? options : {}
  if (typeof opts.dir !== 'string' || opts.dir === '') throw new TypeError('openStore: the dir option is required.')
  const dir = path.resolve(opts.dir)
  const lang = i18n.LANGS.includes(opts.lang) ? opts.lang : DEFAULT_LANG
  const maxPerChannel = posInt(opts.maxMessagesPerChannel, DEFAULT_MAX_PER_CHANNEL)
  const maxTotal = posInt(opts.maxTotalMessages, DEFAULT_MAX_TOTAL)
  const compactMinLines = posInt(opts.compactMinLines, DEFAULT_COMPACT_MIN_LINES)
  const log = makeLogger(opts.log)

  const statePath = path.join(dir, STATE_FILE)
  const bakPath = statePath + '.bak'
  const lockPath = path.join(dir, LOCK_FILE)
  const messagesDir = path.join(dir, MESSAGES_DIR)
  const uploadsDir = path.join(dir, UPLOADS_DIR)

  const channels = new Map()
  const index = new Map()
  const activeUploads = new Map()
  const uploadOps = new Set()
  let maxMessageIdSeen = 0
  let maxChannelIdSeen = 0
  let closing = false
  let closed = false
  let closePromise = null
  // Diskteki state.json'ın geçerli olduğu biliniyorsa yazmadan önce .bak'a kopyalanır.
  // Bozuk dosya yedekten kurtarıldıysa iyi .bak bozuk içerikle ezilmesin diye false olur.
  let mainFileGood = true

  let stateSeq = 0
  let stateDone = 0
  let stateTimer = null
  let stateRunning = false
  let stateFailures = 0
  let stateWaiters = []

  // 1. Salt okuma: kilit, durum ve mesaj dosyaları. Bu aşamada hiçbir dosyaya yazılmaz.
  let lock
  try {
    lock = lockInfo(dir)
  } catch (err) {
    throw ioError(err, lang)
  }
  if (lock.alive && lock.pid !== process.pid) {
    throw new StoreError(i18n.t(lang, 'store.locked', { pid: lock.pid, file: lockPath }), 'locked')
  }

  let initialState = null
  let recoveredCorrupt = false
  const main = await readStateFile(statePath, lang)
  if (main.kind === 'ok') {
    initialState = main.state
  } else if (main.kind === 'version') {
    throw versionError(main.version, lang)
  } else {
    const bak = await readStateFile(bakPath, lang)
    if (bak.kind === 'version') throw versionError(bak.version, lang)
    if (main.kind === 'missing') {
      if (bak.kind === 'ok') {
        initialState = bak.state
        log.warn(i18n.t(lang, 'store.recoveredMissing', { file: STATE_FILE, backup: STATE_FILE + '.bak' }))
      } else if (bak.kind === 'corrupt') {
        throw new StoreError(i18n.t(lang, 'store.missingBackupCorrupt', { file: statePath, backup: bakPath }), 'corrupt')
      }
    } else {
      if (bak.kind !== 'ok') {
        throw new StoreError(i18n.t(lang, 'store.corrupt', { file: statePath, backup: bakPath }), 'corrupt')
      }
      initialState = bak.state
      recoveredCorrupt = true
      mainFileGood = false
    }
  }

  const api = {
    dir,
    state: initialState,
    initState,
    saveState,
    flushState,
    flush,
    close,
    listMessages,
    listAround,
    getMessage,
    addMessage,
    editMessage,
    deleteMessage,
    deleteChannelMessages,
    uploadPath,
    writeUpload,
    removeUpload,
    uploadsBytes,
    createUploadWriteStream,
    commitUpload,
    discardUpload
  }

  let messageFiles = []
  try {
    messageFiles = await fsp.readdir(messagesDir)
  } catch (err) {
    if (!err || err.code !== 'ENOENT') throw ioError(err, lang)
  }
  const staleTemps = []
  const channelFiles = []
  for (const name of messageFiles) {
    if (name.endsWith('.jsonl.tmp')) {
      staleTemps.push(path.join(messagesDir, name))
      continue
    }
    const match = CHANNEL_FILE_RE.exec(name)
    if (!match) continue
    const channelId = Number(match[1])
    if (!Number.isSafeInteger(channelId) || String(channelId) !== match[1]) {
      log.warn(i18n.t(lang, 'store.badChannelFile', { file: MESSAGES_DIR + '/' + name }))
      continue
    }
    channelFiles.push(channelId)
  }
  channelFiles.sort((a, b) => a - b)
  for (const channelId of channelFiles) {
    try {
      await loadChannelFile(channelId)
    } catch (err) {
      throw ioError(err, lang)
    }
  }
  // Toplam sınır açılışta yalnızca bellekte uygulanır. Diskteki veri değişmediği sürece her açılışta
  // aynı mesajlar düşer, düşen yüklemeleri uzlaştırma siler, oran aşılırsa dosyalar sıkıştırılır.
  trimTotal(false)

  // 2. Yazma aşaması: klasörler, kilit, temizlik, uzlaştırma ve sıkıştırma.
  try {
    await fsp.mkdir(dir, { recursive: true, mode: DIR_MODE })
    await fsp.mkdir(messagesDir, { recursive: true, mode: DIR_MODE })
    await fsp.mkdir(uploadsDir, { recursive: true, mode: DIR_MODE })
    await acquireLock()
  } catch (err) {
    if (err instanceof StoreError) throw err
    throw ioError(err, lang)
  }

  try {
    if (recoveredCorrupt) {
      const copyName = STATE_FILE + '.bozuk-' + Date.now()
      await fsp.copyFile(statePath, path.join(dir, copyName))
      log.warn(i18n.t(lang, 'store.recoveredCorrupt', { file: STATE_FILE, backup: STATE_FILE + '.bak', copy: copyName }))
    }
    for (const file of staleTemps) {
      await unlinkQuiet(file).catch((err) => log.warn(i18n.t(lang, 'store.tempRemoveFailed', { error: errText(err, lang) })))
    }
    await removeStaleUploadTemps()
    if (api.state && await reconcile()) saveState()
    const jobs = []
    for (const ch of channels.values()) {
      if (ch.lines > 0 && (ch.lines - ch.list.length) / ch.lines > COMPACT_RATIO) {
        requestCompact(ch)
        jobs.push(waitChannel(ch).catch((err) => log.error(i18n.t(lang, 'store.compactFailed', { file: ch.id + '.jsonl', error: errText(err, lang) }))))
      }
    }
    await Promise.all(jobs)
  } catch (err) {
    closed = true
    clearTimers()
    await releaseLock()
    throw ioError(err, lang)
  }

  return api

  // ---------------------------------------------------------------- mesaj günlükleri

  function makeChannel (channelId) {
    return {
      id: channelId,
      file: path.join(messagesDir, channelId + '.jsonl'),
      list: [],
      lines: 0,
      pending: [],
      queuedSeq: 0,
      doneSeq: 0,
      removeSeq: 0,
      gen: 0,
      running: false,
      compactWanted: false,
      removeWanted: false,
      needsNewline: false,
      failures: 0,
      retryTimer: null,
      waiters: []
    }
  }

  function getChannel (channelId, create) {
    let ch = channels.get(channelId)
    if (!ch && create) {
      ch = makeChannel(channelId)
      channels.set(channelId, ch)
      if (channelId > maxChannelIdSeen) maxChannelIdSeen = channelId
    }
    return ch || null
  }

  function noteId (id) {
    if (id > maxMessageIdSeen) maxMessageIdSeen = id
  }

  async function loadChannelFile (channelId) {
    const ch = getChannel(channelId, true)
    const live = new Map()
    const seen = new Set()
    let bad = 0
    let lines = 0
    const partial = await scanLines(ch.file, (text) => {
      if (text === null) {
        lines++
        bad++
        return
      }
      const trimmed = text.trim()
      if (trimmed === '') return
      lines++
      let rec
      try {
        rec = JSON.parse(trimmed)
      } catch (err) {
        bad++
        return
      }
      if (!applyRecord(rec, channelId, live, seen)) bad++
    })
    const list = Array.from(live.values()).sort((a, b) => a.id - b.id)
    const kept = []
    let duplicates = 0
    for (const m of list) {
      if (index.has(m.id)) {
        duplicates++
        continue
      }
      kept.push(m)
    }
    if (kept.length > maxPerChannel) kept.splice(0, kept.length - maxPerChannel)
    for (const m of kept) index.set(m.id, m)
    ch.list = kept
    ch.lines = lines
    ch.needsNewline = partial
    const fileName = MESSAGES_DIR + '/' + channelId + '.jsonl'
    if (bad > 0) log.warn(i18n.t(lang, 'store.badLines', { file: fileName, count: bad }))
    if (duplicates > 0) log.warn(i18n.t(lang, 'store.duplicateMessages', { file: fileName, count: duplicates }))
  }

  function applyRecord (rec, channelId, live, seen) {
    if (!isPlainObject(rec)) return false
    if (rec.op === 'add') {
      const m = cleanMessage(rec.m)
      if (!m || m.channelId !== channelId) return false
      noteId(m.id)
      // id'ler hiçbir zaman yeniden kullanılmaz, aynı id ikinci kez görülürse yinelenen kayıttır
      if (seen.has(m.id)) return true
      seen.add(m.id)
      live.set(m.id, m)
      return true
    }
    if (rec.op === 'edit') {
      if (!isId(rec.id) || typeof rec.body !== 'string') return false
      if (rec.editedAt !== null && (typeof rec.editedAt !== 'number' || !Number.isFinite(rec.editedAt))) return false
      noteId(rec.id)
      const m = live.get(rec.id)
      if (m) {
        m.body = rec.body
        m.editedAt = rec.editedAt
      }
      return true
    }
    if (rec.op === 'del') {
      if (!isId(rec.id)) return false
      noteId(rec.id)
      live.delete(rec.id)
      return true
    }
    return false
  }

  function enqueue (ch, record) {
    ch.pending.push(JSON.stringify(record) + '\n')
    ch.lines++
    ch.queuedSeq++
  }

  function requestCompact (ch) {
    if (ch.compactWanted || ch.removeWanted) return
    ch.compactWanted = true
    ch.queuedSeq++
  }

  function maybeCompact (ch) {
    if (ch.lines < compactMinLines) return
    if ((ch.lines - ch.list.length) / ch.lines > COMPACT_RATIO) requestCompact(ch)
  }

  function kick (ch) {
    if (ch.running || ch.retryTimer) return
    runChannel(ch).catch((err) => log.error(i18n.t(lang, 'store.queueError', { error: errText(err, lang) })))
  }

  function finishChannel (ch, seq) {
    if (seq > ch.doneSeq) ch.doneSeq = seq
    ch.failures = 0
    if (ch.waiters.length === 0) return
    const rest = []
    for (const w of ch.waiters) {
      if (w.target <= ch.doneSeq) w.resolve()
      else rest.push(w)
    }
    ch.waiters = rest
  }

  function failChannel (ch, err) {
    ch.failures++
    if (ch.failures === 1 || ch.failures % 20 === 0) {
      log.error(i18n.t(lang, 'store.messageWriteFailed', { file: MESSAGES_DIR + '/' + ch.id + '.jsonl', error: errText(err, lang) }))
    }
    const failure = new StoreError(i18n.t(lang, 'store.messagesWriteError', { error: errText(err, lang) }), 'write_failed', err)
    const waiters = ch.waiters
    ch.waiters = []
    for (const w of waiters) w.reject(failure)
    if (!closed && !ch.retryTimer) {
      ch.retryTimer = unrefTimer(setTimeout(() => {
        ch.retryTimer = null
        kick(ch)
      }, retryDelay(ch.failures)))
    }
  }

  // Kanal başına tek yazıcı: sırasıyla dosya silme, sıkıştırma ve bekleyen satırların eklenmesi.
  async function runChannel (ch) {
    if (ch.running) return
    ch.running = true
    try {
      while (ch.removeWanted || ch.compactWanted || ch.pending.length > 0) {
        if (ch.removeWanted) {
          const seq = ch.removeSeq
          ch.removeWanted = false
          try {
            await unlinkQuiet(ch.file)
            await unlinkQuiet(ch.file + '.tmp')
          } catch (err) {
            ch.removeWanted = true
            failChannel(ch, err)
            return
          }
          ch.needsNewline = false
          finishChannel(ch, seq)
          continue
        }
        if (ch.compactWanted) {
          // Anlık görüntü bellekteki son durumu içerir, bu yüzden bekleyen satırlar da onun parçasıdır.
          ch.compactWanted = false
          const seq = ch.queuedSeq
          const gen = ch.gen
          const taken = ch.pending
          ch.pending = []
          const linesBefore = ch.lines
          const snapshotLines = ch.list.length
          const text = ch.list.map(addLine).join('')
          ch.lines = snapshotLines
          try {
            await atomicWrite(ch.file, text)
          } catch (err) {
            if (ch.gen === gen) {
              ch.pending = taken.concat(ch.pending)
              ch.lines = linesBefore + (ch.lines - snapshotLines)
              ch.compactWanted = true
            }
            failChannel(ch, err)
            return
          }
          if (ch.gen === gen) ch.needsNewline = false
          finishChannel(ch, seq)
          continue
        }
        const seq = ch.queuedSeq
        const gen = ch.gen
        const batch = ch.pending
        ch.pending = []
        // Önceki yazım yarım kaldıysa yeni satır onunla birleşmesin diye önce satır sonu eklenir.
        const text = (ch.needsNewline ? '\n' : '') + batch.join('')
        try {
          await retryFs(() => fsp.appendFile(ch.file, text, { mode: FILE_MODE }))
        } catch (err) {
          if (ch.gen === gen) {
            ch.pending = batch.concat(ch.pending)
            ch.needsNewline = true
          }
          failChannel(ch, err)
          return
        }
        if (ch.gen === gen) ch.needsNewline = false
        finishChannel(ch, seq)
      }
    } finally {
      ch.running = false
    }
  }

  function waitChannel (ch) {
    const target = ch.queuedSeq
    if (ch.doneSeq >= target) return Promise.resolve()
    return new Promise((resolve, reject) => {
      ch.waiters.push({ target, resolve, reject })
      if (ch.retryTimer) {
        clearTimeout(ch.retryTimer)
        ch.retryTimer = null
      }
      kick(ch)
    })
  }

  // ---------------------------------------------------------------- durum (state.json)

  function initState (initial) {
    assertOpen()
    if (api.state) throw new StoreError('initState: the state is already loaded.', 'state_exists')
    let st
    if (initial === undefined || initial === null) {
      st = emptyState()
    } else if (isPlainObject(initial)) {
      st = initial
      if (!hasOwn(st, 'version') || st.version === undefined) st.version = STATE_VERSION
    } else {
      throw new TypeError('initState: the initial state must be an object.')
    }
    if (!normalizeState(st)) throw new TypeError('initState: the initial state has an invalid structure.')
    if (st.counters.message < maxMessageIdSeen) st.counters.message = maxMessageIdSeen
    if (st.counters.channel < maxChannelIdSeen) st.counters.channel = maxChannelIdSeen
    api.state = st
    saveState()
    return st
  }

  function saveState () {
    if (closed || !api.state) return
    stateSeq++
    if (!stateRunning && !stateTimer) stateTimer = unrefTimer(setTimeout(onStateTimer, SAVE_DELAY_MS))
  }

  function onStateTimer () {
    stateTimer = null
    runState().catch((err) => log.error(i18n.t(lang, 'store.stateWriteError', { error: errText(err, lang) })))
  }

  async function writeStateFile (text) {
    const tmp = statePath + '.tmp'
    try {
      await writeFileDurable(tmp, text)
      if (mainFileGood) {
        try {
          await retryFs(() => fsp.copyFile(statePath, bakPath))
        } catch (err) {
          if (!err || err.code !== 'ENOENT') log.warn(i18n.t(lang, 'store.backupUpdateFailed', { backup: STATE_FILE + '.bak', error: errText(err, lang) }))
        }
      }
      await renameRetry(tmp, statePath)
    } catch (err) {
      await unlinkQuiet(tmp).catch(noop)
      throw err
    }
    mainFileGood = true
    await fsyncDir(dir)
  }

  async function runState () {
    if (stateRunning) return
    stateRunning = true
    try {
      while (stateDone < stateSeq) {
        const seq = stateSeq
        if (api.state) {
          try {
            await writeStateFile(JSON.stringify(api.state, null, 2) + '\n')
          } catch (err) {
            failState(err)
            return
          }
        }
        finishState(seq)
        if (stateDone < stateSeq && stateWaiters.length === 0) {
          // Yazım sırasında yeni değişiklik geldi, yeniden 200 ms toplanır.
          if (!stateTimer && !closed) stateTimer = unrefTimer(setTimeout(onStateTimer, SAVE_DELAY_MS))
          return
        }
      }
    } finally {
      stateRunning = false
    }
  }

  function finishState (seq) {
    if (seq > stateDone) stateDone = seq
    stateFailures = 0
    if (stateWaiters.length === 0) return
    const rest = []
    for (const w of stateWaiters) {
      if (w.target <= stateDone) w.resolve()
      else rest.push(w)
    }
    stateWaiters = rest
  }

  function failState (err) {
    stateFailures++
    if (stateFailures === 1 || stateFailures % 20 === 0) {
      log.error(i18n.t(lang, 'store.stateFileWriteFailed', { file: STATE_FILE, error: errText(err, lang) }))
    }
    const failure = new StoreError(i18n.t(lang, 'store.stateWriteFailed', { error: errText(err, lang) }), 'write_failed', err)
    const waiters = stateWaiters
    stateWaiters = []
    for (const w of waiters) w.reject(failure)
    if (!closed && !stateTimer) stateTimer = unrefTimer(setTimeout(onStateTimer, retryDelay(stateFailures)))
  }

  function waitState () {
    const target = stateSeq
    if (stateDone >= target) return Promise.resolve()
    return new Promise((resolve, reject) => {
      stateWaiters.push({ target, resolve, reject })
      if (stateTimer) {
        clearTimeout(stateTimer)
        stateTimer = null
      }
      if (!stateRunning) runState().catch(noop)
    })
  }

  // Çağrı anına kadar yapılmış durum değişikliklerinin state.json'a atomik yazılıp diske
  // zorlanmasını (fsync) bekler. Bekleyen 200 ms'lik zamanlayıcı beklenmez, yazım hemen başlar.
  // Aynı anda bekleyen bütün çağıranlar ortak yazımı paylaşır: sürmekte olan yazım bitince
  // en fazla bir yazım daha yapılır. Yazım başarısız olursa hata fırlatır, değişiklik bellekte
  // kalır ve yeniden deneme döngüsü onu daha sonra yazar. Kapanmış store'da 'closed' hatası verir.
  function flushState () {
    if (closed) return Promise.reject(new StoreError(i18n.t(lang, 'store.closed'), 'closed'))
    if (!api.state) return Promise.resolve()
    return waitState()
  }

  // Çağrı anına kadar planlanmış tüm yazımları (durum, mesaj kuyrukları, yüklemeler) bekler.
  async function flush () {
    if (closed) return
    const waits = [waitState()]
    for (const ch of channels.values()) waits.push(waitChannel(ch))
    for (const op of uploadOps) waits.push(op.then(noop, noop))
    const results = await Promise.allSettled(waits)
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
    }
  }

  function clearTimers () {
    if (stateTimer) {
      clearTimeout(stateTimer)
      stateTimer = null
    }
    for (const ch of channels.values()) {
      if (ch.retryTimer) {
        clearTimeout(ch.retryTimer)
        ch.retryTimer = null
      }
    }
  }

  // Kilit dosyası 'wx' bayrağıyla, yani yalnız yoksa oluşturulur. Aynı anda açılan iki
  // süreçten yalnız biri kazanır, kaybeden 'locked' hatası alır. Bayat kilit (ölü veya
  // okunamayan PID) önce benzersiz bir ada taşınır. Taşınan dosyada arada başka bir sürecin
  // aldığı canlı kilit çıkarsa geri konur ve açılış reddedilir.
  async function acquireLock () {
    const line = process.pid + '\n'
    for (const attempt of [0, 1, 2]) {
      try {
        await createLockFile(line)
        return
      } catch (err) {
        if (!err || err.code !== 'EEXIST') throw err
      }
      const info = lockInfo(dir)
      if (!info.exists) continue
      if (info.pid === process.pid) {
        await fsp.writeFile(lockPath, line, { mode: FILE_MODE })
        return
      }
      if (info.alive) throw lockedError(info.pid)
      const aside = lockPath + '.' + process.pid + '.' + Date.now() + '.' + attempt
      try {
        await fsp.rename(lockPath, aside)
      } catch (err) {
        if (err && err.code === 'ENOENT') continue
        throw err
      }
      const moved = await fsp.readFile(aside, 'utf8').catch(() => '')
      const match = /^\s*(\d{1,10})\s*$/.exec(moved)
      const movedPid = match ? Number(match[1]) : null
      if (movedPid !== null && movedPid !== process.pid && isPidAlive(movedPid)) {
        await fsp.link(aside, lockPath).catch(noop)
        await unlinkQuiet(aside).catch(noop)
        throw lockedError(movedPid)
      }
      await unlinkQuiet(aside).catch(noop)
    }
    const last = lockInfo(dir)
    throw lockedError(last.pid)
  }

  // PID önce geçici dosyaya yazılır, sonra sabit bağlantıyla kilit adına bağlanır. Bağlantı
  // ad varsa EEXIST ile başarısız olur, böylece kilit dosyası hiçbir an boş görünmez (boş
  // görünen kilit başka bir süreçte bayat sanılabilirdi). Sabit bağlantıyı desteklemeyen
  // dosya sistemlerinde 'wx' bayrağıyla oluşturmaya dönülür.
  async function createLockFile (line) {
    const tmp = lockPath + '.' + process.pid + '.yeni'
    await fsp.writeFile(tmp, line, { mode: FILE_MODE })
    try {
      await fsp.link(tmp, lockPath)
    } catch (err) {
      if (err && (err.code === 'EPERM' || err.code === 'ENOTSUP' || err.code === 'ENOSYS' || err.code === 'EXDEV')) {
        await fsp.writeFile(lockPath, line, { mode: FILE_MODE, flag: 'wx' })
      } else {
        throw err
      }
    } finally {
      await unlinkQuiet(tmp).catch(noop)
    }
  }

  function lockedError (pid) {
    return new StoreError(i18n.t(lang, 'store.locked', { pid, file: lockPath }), 'locked')
  }

  async function releaseLock () {
    try {
      const text = await fsp.readFile(lockPath, 'utf8')
      if (text.trim() === String(process.pid)) await unlinkQuiet(lockPath)
    } catch (err) {
      if (!err || err.code !== 'ENOENT') log.warn(i18n.t(lang, 'store.lockRemoveFailed', { error: errText(err, lang) }))
    }
  }

  function close () {
    if (closePromise) return closePromise
    closing = true
    closePromise = closeNow()
    return closePromise
  }

  async function closeNow () {
    const discards = []
    for (const id of Array.from(activeUploads.keys())) discards.push(discardUpload(id).catch(noop))
    await Promise.all(discards)
    let failure = null
    try {
      // Kapanış sırasında gelen son saveState çağrıları da yazılsın.
      let rounds = 0
      while (rounds < 5) {
        await flush()
        rounds++
        if (stateDone >= stateSeq) break
      }
    } catch (err) {
      failure = err
    }
    closed = true
    clearTimers()
    await releaseLock()
    if (failure) throw failure
  }

  function assertOpen () {
    if (closing || closed) throw new StoreError(i18n.t(lang, 'store.closed'), 'closed')
  }

  // ---------------------------------------------------------------- mesaj işlemleri

  function listMessages (channelId, options) {
    const ch = isId(channelId) ? channels.get(channelId) : null
    if (!ch) return { messages: [], hasMore: false }
    const o = isPlainObject(options) ? options : {}
    const limit = Number.isSafeInteger(o.limit) && o.limit > 0 ? o.limit : DEFAULT_LIST_LIMIT
    let end = ch.list.length
    if (typeof o.before === 'number' && !Number.isNaN(o.before)) end = lowerBound(ch.list, o.before)
    const start = Math.max(0, end - limit)
    return { messages: ch.list.slice(start, end).map(copyMessage), hasMore: start > 0 }
  }

  // Verilen kimliğin etrafındaki sayfa: mesajdan önce limit/2 (aşağı yuvarlanır) eski mesaj, mesajın
  // kendisi ve kalan yeni mesajlar. Kimlik bu kanalda yoksa aynı konum (kimliği ondan büyük ilk mesaj)
  // esas alınır. Kanalın başına veya sonuna yakınsa pencere öbür yöne kayar, sayfa yine limit kadardır.
  function listAround (channelId, options) {
    const ch = isId(channelId) ? channels.get(channelId) : null
    if (!ch) return { messages: [], hasMore: false, hasNewer: false }
    const o = isPlainObject(options) ? options : {}
    const limit = Number.isSafeInteger(o.limit) && o.limit > 0 ? o.limit : DEFAULT_LIST_LIMIT
    const list = ch.list
    const at = typeof o.around === 'number' && !Number.isNaN(o.around) ? lowerBound(list, o.around) : list.length
    const end = Math.min(list.length, Math.max(0, at - Math.floor(limit / 2)) + limit)
    const start = Math.max(0, end - limit)
    return { messages: list.slice(start, end).map(copyMessage), hasMore: start > 0, hasNewer: end < list.length }
  }

  function getMessage (id) {
    const m = isId(id) ? index.get(id) : undefined
    return m ? copyMessage(m) : null
  }

  function addMessage (message) {
    assertOpen()
    const m = cleanMessage(message)
    if (!m) throw new TypeError('addMessage: invalid message object.')
    if (index.has(m.id)) throw new StoreError('addMessage: this message id is already in use.', 'duplicate_id')
    const ch = getChannel(m.channelId, true)
    const list = ch.list
    if (list.length === 0 || list[list.length - 1].id < m.id) list.push(m)
    else list.splice(lowerBound(list, m.id), 0, m)
    index.set(m.id, m)
    noteId(m.id)
    enqueue(ch, { op: 'add', m })
    const dropped = []
    if (list.length > maxPerChannel) {
      const removed = list.splice(0, list.length - maxPerChannel)
      for (const old of removed) {
        index.delete(old.id)
        dropped.push(copyMessage(old))
      }
    }
    maybeCompact(ch)
    kick(ch)
    for (const old of trimTotal(true)) dropped.push(old)
    return dropped
  }

  // Toplam mesaj sayısı sınırı aşıldıysa en çok mesajı olan kanallardan en eski mesajları düşürür
  // (kanallar aynı seviyeye inene kadar, eşitlikte en eski mesajı daha eski olan kanal önce).
  // Kanal başına sınırdaki gibi mesaj listeden ve dizinden çıkar, dosya oran aşılınca sıkıştırılır.
  // Çalışırken düşen her mesaj için günlüğe silme kaydı da eklenir, böylece yeniden açılışta
  // kanallar arasındaki seçim farklı çıksa bile düşen mesaj geri gelmez. Düşen mesajlar döner.
  function trimTotal (persist) {
    let excess = index.size - maxTotal
    if (excess <= 0) return []
    const list = []
    for (const ch of channels.values()) {
      if (ch.list.length > 0) list.push(ch)
    }
    const before = (a, b) => b.list.length - a.list.length || a.list[0].id - b.list[0].id
    const cuts = new Map()
    if (excess === 1) {
      // Sınırdayken her yeni mesajda olan durum: sıralamadan en büyük kanal bulunur
      let best = list[0]
      for (const ch of list) {
        if (before(ch, best) < 0) best = ch
      }
      cuts.set(best, 1)
      excess = 0
    } else {
      list.sort(before)
    }
    let group = 1
    let level = list[0].list.length
    while (excess > 0) {
      while (group < list.length && list[group].list.length >= level) group++
      const next = group < list.length ? list[group].list.length : 0
      const room = (level - next) * group
      if (room >= excess) {
        const even = Math.floor(excess / group)
        const extra = excess % group
        list.slice(0, group).forEach((ch, i) => {
          const target = level - even - (i < extra ? 1 : 0)
          cuts.set(ch, ch.list.length - target)
        })
        excess = 0
      } else {
        excess -= room
        level = next
      }
    }
    const dropped = []
    for (const [ch, count] of cuts) {
      if (count <= 0) continue
      const removed = ch.list.splice(0, count)
      for (const old of removed) {
        index.delete(old.id)
        if (!persist) continue
        dropped.push(copyMessage(old))
        enqueue(ch, { op: 'del', id: old.id })
      }
      if (persist) {
        maybeCompact(ch)
        kick(ch)
      }
    }
    return dropped
  }

  function editMessage (id, body, editedAt) {
    assertOpen()
    const m = isId(id) ? index.get(id) : undefined
    if (!m) return null
    if (typeof body !== 'string') throw new TypeError('editMessage: body must be a string.')
    let at = editedAt
    if (at === undefined) at = Date.now()
    if (at !== null && (typeof at !== 'number' || !Number.isFinite(at))) throw new TypeError('editMessage: editedAt must be a number.')
    const ch = getChannel(m.channelId, true)
    m.body = body
    m.editedAt = at
    enqueue(ch, { op: 'edit', id: m.id, body, editedAt: at })
    maybeCompact(ch)
    kick(ch)
    return copyMessage(m)
  }

  function deleteMessage (id) {
    assertOpen()
    const m = isId(id) ? index.get(id) : undefined
    if (!m) return null
    const ch = getChannel(m.channelId, true)
    const pos = lowerBound(ch.list, m.id)
    if (pos < ch.list.length && ch.list[pos].id === m.id) ch.list.splice(pos, 1)
    index.delete(m.id)
    enqueue(ch, { op: 'del', id: m.id })
    maybeCompact(ch)
    kick(ch)
    return copyMessage(m)
  }

  function deleteChannelMessages (channelId) {
    assertOpen()
    const ch = isId(channelId) ? channels.get(channelId) : null
    if (!ch) return []
    const removed = ch.list
    ch.list = []
    for (const m of removed) index.delete(m.id)
    ch.gen++
    ch.pending = []
    ch.compactWanted = false
    ch.removeWanted = true
    ch.queuedSeq++
    ch.removeSeq = ch.queuedSeq
    ch.lines = 0
    kick(ch)
    return removed.map(copyMessage)
  }

  // ---------------------------------------------------------------- yüklemeler

  function checkUploadId (id) {
    if (typeof id !== 'string' || !UPLOAD_ID_RE.test(id)) throw new StoreError('Invalid upload id.', 'bad_upload_id')
    return id
  }

  function uploadPath (id) {
    return path.join(uploadsDir, checkUploadId(id) + '.bin')
  }

  function uploadTmpPath (id) {
    return path.join(uploadsDir, checkUploadId(id) + '.tmp')
  }

  function track (promise) {
    uploadOps.add(promise)
    const done = () => {
      uploadOps.delete(promise)
    }
    promise.then(done, done)
    return promise
  }

  // Var olan bir yüklemenin üzerine asla yazılmaz.
  async function moveIntoPlace (tmp, dest) {
    let exists = true
    try {
      await fsp.lstat(dest)
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err
      exists = false
    }
    if (exists) throw new StoreError('This upload id is already in use.', 'upload_exists')
    await renameRetry(tmp, dest)
  }

  async function syncFile (file) {
    const handle = await fsp.open(file, 'r+')
    try {
      await handle.sync()
      const info = await handle.stat()
      return info.size
    } finally {
      await handle.close()
    }
  }

  async function writeUpload (id, data) {
    const tmp = uploadTmpPath(id)
    const dest = uploadPath(id)
    assertOpen()
    if (!(data instanceof Uint8Array)) throw new TypeError('writeUpload: data must be a Buffer or Uint8Array.')
    if (activeUploads.has(id)) throw new StoreError('This upload is already in progress.', 'upload_busy')
    return track(writeUploadNow(tmp, dest, data))
  }

  async function writeUploadNow (tmp, dest, data) {
    let created = false
    try {
      const handle = await fsp.open(tmp, 'wx', FILE_MODE)
      created = true
      try {
        await handle.writeFile(data)
        await handle.sync()
      } finally {
        await handle.close()
      }
      await moveIntoPlace(tmp, dest)
    } catch (err) {
      if (created) await unlinkQuiet(tmp).catch(noop)
      throw err
    }
  }

  async function removeUpload (id) {
    const dest = uploadPath(id)
    await track(unlinkQuiet(dest))
  }

  function uploadsBytes () {
    const st = api.state
    if (!st || !Array.isArray(st.uploads)) return 0
    let total = 0
    for (const rec of st.uploads) {
      if (rec && typeof rec.size === 'number' && Number.isFinite(rec.size) && rec.size > 0) total += rec.size
    }
    return total
  }

  // Yükleme <id>.tmp dosyasına akışla yazılır, commitUpload ile <id>.bin olur.
  function createUploadWriteStream (id) {
    const tmp = uploadTmpPath(id)
    assertOpen()
    if (activeUploads.has(id)) throw new StoreError('This upload is already in progress.', 'upload_busy')
    const ws = fs.createWriteStream(tmp, { flags: 'wx', mode: FILE_MODE })
    const entry = { ws, error: null, closed: false, closedPromise: null }
    entry.closedPromise = new Promise((resolve) => {
      ws.once('close', () => {
        entry.closed = true
        resolve()
      })
    })
    // Dinleyicisiz bir 'error' olayı süreci düşürmesin, hata commitUpload'da raporlanır.
    ws.on('error', (err) => {
      if (!entry.error) entry.error = err
    })
    activeUploads.set(id, entry)
    return ws
  }

  async function commitUpload (id) {
    const tmp = uploadTmpPath(id)
    const dest = uploadPath(id)
    const entry = activeUploads.get(id)
    if (!entry) throw new StoreError('Upload not found.', 'upload_missing')
    if (!entry.error && !entry.ws.writableEnded) throw new StoreError('The upload is not finished yet.', 'upload_unfinished')
    activeUploads.delete(id)
    return track(commitNow(entry, tmp, dest))
  }

  async function commitNow (entry, tmp, dest) {
    try {
      await entry.closedPromise
      if (entry.error) throw entry.error
      const size = await syncFile(tmp)
      await moveIntoPlace(tmp, dest)
      return size
    } catch (err) {
      await unlinkQuiet(tmp).catch(noop)
      throw err
    }
  }

  async function discardUpload (id) {
    const tmp = uploadTmpPath(id)
    const entry = activeUploads.get(id)
    if (entry) activeUploads.delete(id)
    await track(discardNow(entry, tmp))
  }

  async function discardNow (entry, tmp) {
    if (entry) {
      if (!entry.ws.destroyed) entry.ws.destroy()
      await entry.closedPromise
    }
    await unlinkQuiet(tmp)
  }

  async function removeStaleUploadTemps () {
    let names = []
    try {
      names = await fsp.readdir(uploadsDir)
    } catch (err) {
      return
    }
    let removed = 0
    for (const name of names) {
      if (!name.endsWith('.tmp')) continue
      try {
        if (await unlinkQuiet(path.join(uploadsDir, name))) removed++
      } catch (err) {
        log.warn(i18n.t(lang, 'store.partialUploadRemoveFailed', { error: errText(err, lang) }))
      }
    }
    if (removed > 0) log.info(i18n.t(lang, 'store.partialUploadsRemoved', { count: removed }))
  }

  // ---------------------------------------------------------------- açılış uzlaştırması

  // state.json en fazla 200 ms geride kalabilir, mesaj günlükleri ise hemen yazılır.
  // Çökme sonrası sayaçları ve yükleme kayıtlarını diskteki mesajlarla tutarlı hale getirir.
  async function reconcile () {
    const st = api.state
    let changed = false
    if (st.counters.message < maxMessageIdSeen) {
      log.warn(i18n.t(lang, 'store.messageCounterRaised', { value: maxMessageIdSeen }))
      st.counters.message = maxMessageIdSeen
      changed = true
    }
    if (st.counters.channel < maxChannelIdSeen) {
      log.warn(i18n.t(lang, 'store.channelCounterRaised', { value: maxChannelIdSeen }))
      st.counters.channel = maxChannelIdSeen
      changed = true
    }

    const records = new Map()
    for (const rec of st.uploads) {
      if (typeof rec.id === 'string' && UPLOAD_ID_RE.test(rec.id)) records.set(rec.id, rec)
    }
    let bound = 0
    let restored = 0
    for (const m of index.values()) {
      for (const uid of m.uploads) {
        const rec = records.get(uid)
        if (rec) {
          if (rec.messageId === null || rec.messageId === undefined) {
            rec.messageId = m.id
            bound++
          }
          continue
        }
        let size = null
        try {
          const info = await fsp.stat(path.join(uploadsDir, uid + '.bin'))
          if (info.isFile()) size = info.size
        } catch (err) {
          // dosya yoksa kayıt oluşturulmaz
        }
        if (size === null) continue
        const created = { id: uid, size, uploaderId: m.authorId, createdAt: m.createdAt, messageId: m.id }
        st.uploads.push(created)
        records.set(uid, created)
        restored++
      }
    }

    // Mesajı artık bulunmayan bağlı yüklemeler erişilemez (çözme anahtarı yalnızca mesajdaydı).
    // Yalnızca sayısal messageId'ler değerlendirilir, beklenmeyen biçimdeki kayıtlara dokunulmaz.
    const dead = []
    const keep = []
    for (const rec of st.uploads) {
      if (!isId(rec.messageId) || index.has(rec.messageId)) {
        keep.push(rec)
        continue
      }
      dead.push(rec)
      if (records.get(rec.id) === rec) records.delete(rec.id)
    }
    if (dead.length > 0) {
      // Dizi kimliği korunur, çağıran aynı diziye başvuruyor olabilir.
      st.uploads.length = 0
      for (const rec of keep) st.uploads.push(rec)
    }
    for (const rec of dead) {
      if (typeof rec.id !== 'string' || !UPLOAD_ID_RE.test(rec.id) || records.has(rec.id)) continue
      await unlinkQuiet(path.join(uploadsDir, rec.id + '.bin')).catch((err) => log.warn(i18n.t(lang, 'store.uploadRemoveFailed', { error: errText(err, lang) })))
    }

    // Kaydı olmayan yükleme dosyaları (kayıt diske yazılmadan önce çökme) silinir.
    // Durumda hiç yükleme kaydı yoksa temkinli davranılır ve dosyalara dokunulmaz.
    let strays = 0
    let names = []
    if (records.size > 0) {
      try {
        names = await fsp.readdir(uploadsDir)
      } catch (err) {
        names = []
      }
    }
    for (const name of names) {
      const match = UPLOAD_BIN_RE.exec(name)
      if (!match || records.has(match[1])) continue
      try {
        if (await unlinkQuiet(path.join(uploadsDir, name))) strays++
      } catch (err) {
        log.warn(i18n.t(lang, 'store.strayRemoveFailed', { error: errText(err, lang) }))
      }
    }

    if (bound > 0 || restored > 0 || dead.length > 0) {
      log.warn(i18n.t(lang, 'store.uploadsReconciled', { bound, restored, removed: dead.length }))
      changed = true
    }
    if (strays > 0) log.warn(i18n.t(lang, 'store.straysRemoved', { count: strays }))
    return changed
  }
}

module.exports = { openStore, StoreError, emptyState, lockInfo }
