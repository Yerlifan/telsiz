'use strict'

// Telsiz DJ istemci motoru (window.TelsizMusic, SPEC-V2 Ek L2).
// Ses odası başına tek müzik oturumu: çalan parça, kuyruk, çalıyor/duraklatıldı ve çapa (sunucu zamanı ve
// konum). Oturum durumu grup anahtarıyla şifreli bir zarf olarak sunucuda tutulur, sunucu yalnızca sürüm,
// zaman ve zarf boyutunu görür. Düz metin { v, ctx: 'music', room } alanlarıyla oda kimliğine ve müzik
// bağlamına bağlanır, çözülen durum katı biçimde doğrulanır. Güncellemeler sürüm karşılaştırmalı
// (compare-and-swap) yapılır, çakışmada güncel durum alınıp işlem yeniden uygulanır. İşlemler kimlikle
// tanımlıdır ve yeniden uygulandığında etkisizdir (aynı parçadan ikinci geçiş, ikinci ekleme olmaz).
// Çalınıp geçilen veya çıkarılan parçaların kimlikleri durumda sınırlı bir listede (gone) tutulur, böylece
// yanıtı kaybolan bir eklemenin yeniden denenmesi o arada geçilmiş parçayı geri getirmez.
// Her cihaz müziği kendi oynatıcısında çalar: YouTube parçaları public/dj/youtube.js bağdaştırıcısıyla
// (yalnızca rıza verilmişse), dosya parçaları çözülüp blob adresiyle <audio> öğesinde.
// Bu dosyada kullanıcıya görünen metin yoktur. Hatalar ve bildirimler kodla verilir, arayüz bunları
// 'music.errors.<kod>' ve 'music.notice.<işlem>' anahtarlarıyla çevirir.

var TelsizMusic = (function (root) {
  const VERSION = 1
  const CONTEXT = 'music'
  const MAX_QUEUE = 100
  // Geçilen veya çıkarılan parça kimliklerinin listesi. /dur bir seferde 101 parça çıkarabilir, sınır bunu
  // karşılar. Liste yalnızca yeniden denenen eklemenin (en fazla birkaç on saniye) tanınması içindir.
  const MAX_GONE = 128
  const MAX_TITLE = 120
  // En kötü durum (101 parça, 120 dört baytlık karakterli adlar, en büyük sayılar, dolu gone listesi)
  // yaklaşık 105000 karakterdir
  const MAX_ENV_CHARS = 131072
  const MAX_DURATION_MS = 86400000
  const MAX_TIME_MS = 8640000000000000
  const MAX_FILE_BYTES = 2147483647
  const DRIFT_LIMIT_MS = 1500
  const SEEK_COOLDOWN_MS = 3000
  // Art arda başarısız düzeltmelerde bekleme ikiye katlanır, en fazla bu kadar olur
  const SEEK_BACKOFF_MAX_MS = 30000
  // Oynatıcı atlamadan veya başlatmadan sonra bu kadar süre kesintisiz çalınca sapma ölçülür
  const SETTLE_MS = 1000
  // Atlama gecikmesi telafisi (oynatıcının yüklenip çalmaya başlaması) en fazla bu kadar olur
  const MAX_SEEK_LEAD_MS = 5000
  // Bu kadar süreden uzun yükleniyorsa (BUFFERING) oynatma yeniden denenir
  const BUFFER_STALL_MS = 10000
  const START_LEAD_MS = 1500
  const MAX_LEAD_MS = 5000
  const END_GRACE_MS = 2500
  const EARLY_END_MS = 5000
  // Süresi bilinmeyen parça bu kadar süre ortak olarak çaldığı hâlde hiçbir cihaz süresini bildirmediyse
  // (odada parçayı çalabilen kimse yok) ve arkasında kuyruk varsa geçilir
  const UNPLAYED_SKIP_MS = 120000
  const TICK_MS = 500
  const POSITION_EVENT_MS = 1000
  const CAS_ATTEMPTS = 6
  const NETWORK_RETRIES = 2
  const PLAY_RETRY_MS = 3000
  const OWN_PAUSE_MS = 2000
  const REQUEST_DEDUPE_MS = 5000
  const CLOCK_WINDOW_MS = 600000
  const CLOCK_MAX_SAMPLES = 32
  const FILE_CACHE_MAX = 3
  // Geçici indirme hatasından (ağ, 408, 429, 5xx) sonra yeniden deneme beklemeleri, son değer tekrarlanır
  const FILE_RETRY_MS = [2000, 5000, 10000, 20000, 30000]
  // Yanıt vermeyen YouTube oynatıcısı en fazla bu beklemelerle yeniden kurulur
  const YT_REBUILD_MS = [10000, 30000, 60000]
  const TRANSFER_TIMEOUT_MS = 15 * 60 * 1000
  const API_TIMEOUT_MS = 20000
  const DEFAULT_VOLUME = 0.5
  const STORAGE_PREFIX = 'telsiz.music.'
  // YouTube oynatıcısı izni Ayarlar > Gizlilik ile ortak anahtardadır (public/js/11-settings.js):
  // '1' verildi, '0' reddedildi, anahtarın olmaması sorulmadı. Başka her değer verilmedi sayılır.
  const KEY_CONSENT = 'telsiz.djYoutubeConsent'
  const KEY_VOLUME = STORAGE_PREFIX + 'volume'
  const KEY_MUTED = STORAGE_PREFIX + 'muted'
  const STATE_PATH = '/api/music/state'
  const UPLOAD_PATH = '/api/uploads/'

  const ID_RE = /^[0-9a-f]{16}$/
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/
  const UPLOAD_ID_RE = /^[0-9a-f]{32}$/
  const FILE_KEY_RE = /^[A-Za-z0-9_-]{43}$/
  const FILE_NONCE_RE = /^[A-Za-z0-9_-]{32}$/
  const ENVELOPE_RE = /^1\.[0-9a-f]{16}\.[A-Za-z0-9_-]{32}\.[A-Za-z0-9_-]{24,}$/
  const ROOM_KEY_RE = /^[1-9][0-9]{0,15}$/
  const CODE_RE = /^[a-z0-9_]{1,40}$/
  const UNSAFE_TEXT_RE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/
  const UNSAFE_TEXT_G = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g

  const STATE_KEYS = ['v', 'ctx', 'room', 'sid', 'seq', 'current', 'queue', 'gone', 'playing', 'anchorAt', 'anchorPos', 'last']
  const YT_TRACK_KEYS = ['id', 'type', 'videoId', 'title', 'addedBy', 'duration']
  const FILE_TRACK_KEYS = ['id', 'type', 'file', 'title', 'addedBy', 'duration']
  const FILE_KEYS = ['u', 'k', 'n', 'm', 's']
  const LAST_REQUIRED = ['op', 'by']
  const LAST_OPTIONAL = ['id', 'title', 'code']
  const OPS = ['add', 'remove', 'move', 'skip', 'end', 'error_skip', 'pause', 'resume', 'stop', 'annotate', 'purge_youtube']

  // Tarayıcıların çalabildiği ses biçimleri (kanonik MIME) ve eşdeğer adlar
  const AUDIO_TYPES = ['audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/flac']
  const AUDIO_ALIASES = {
    'audio/mp3': 'audio/mpeg',
    'audio/mpeg3': 'audio/mpeg',
    'audio/x-mpeg': 'audio/mpeg',
    'audio/x-mp3': 'audio/mpeg',
    'audio/opus': 'audio/ogg',
    'application/ogg': 'audio/ogg',
    'audio/x-wav': 'audio/wav',
    'audio/wave': 'audio/wav',
    'audio/vnd.wave': 'audio/wav',
    'audio/x-pn-wav': 'audio/wav',
    'audio/x-m4a': 'audio/mp4',
    'audio/m4a': 'audio/mp4',
    'audio/aacp': 'audio/aac',
    'audio/x-aac': 'audio/aac',
    'audio/x-flac': 'audio/flac'
  }
  const AUDIO_EXTENSIONS = {
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg',
    oga: 'audio/ogg',
    opus: 'audio/ogg',
    wav: 'audio/wav',
    weba: 'audio/webm',
    webm: 'audio/webm',
    m4a: 'audio/mp4',
    mp4: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac'
  }

  // YouTube bağlantı biçimleri (Ek L2.2). Oynatma listesi ve arama desteklenmez.
  const WATCH_HOSTS = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']
  const NOCOOKIE_HOSTS = ['youtube-nocookie.com', 'www.youtube-nocookie.com']

  // Komut adları (Ek L2.8). Türkçe adlardaki c-çengeli kaynakta kaçışla yazılır.
  const C_CEDILLA = String.fromCharCode(0xe7)
  const COMMANDS = {
    play: ['/' + C_CEDILLA + 'al', '/play', '/cal'],
    skip: ['/ge' + C_CEDILLA, '/skip', '/gec'],
    pause: ['/duraklat', '/pause'],
    resume: ['/devam', '/resume'],
    queue: ['/kuyruk', '/queue'],
    stop: ['/dur', '/stop']
  }

  // YouTube oynatıcı hata kodları (IFrame Player API belgesi): 2, 5, 100, 101, 150.
  // Videonun kendisinden kaynaklanan hatalarda parça herkes için geçilir.
  const YT_ERRORS = { 2: 'yt_bad_request', 5: 'yt_html5', 100: 'yt_not_found', 101: 'yt_embed_blocked', 150: 'yt_embed_blocked' }
  const YT_SKIP_CODES = ['yt_bad_request', 'yt_not_found', 'yt_embed_blocked']
  // IFrame Player API durum kodları (belgelenmiş): 2 duraklatıldı, 3 yükleniyor
  const YT_PAUSED = 2
  const YT_BUFFERING = 3

  const toStr = Object.prototype.toString

  // ------------------------------------------------------------ küçük yardımcılar

  function fail (code, message) {
    const err = new Error(message || code)
    err.code = code
    return err
  }

  function isObj (value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && toStr.call(value) === '[object Object]'
  }

  function hasOwn (object, key) {
    return Object.prototype.hasOwnProperty.call(object, key)
  }

  function isSafeInt (value, min, max) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
  }

  function isFiniteNumber (value) {
    return typeof value === 'number' && isFinite(value)
  }

  // Nesnenin anahtarları yalnızca izin verilenlerden oluşmalı ve zorunluların hepsini içermelidir
  function keysOk (object, required, optional) {
    const keys = Object.keys(object)
    const allowed = (key) => required.indexOf(key) !== -1 || (Boolean(optional) && optional.indexOf(key) !== -1)
    return keys.every(allowed) && required.every((key) => hasOwn(object, key))
  }

  function codePointLength (text) {
    let count = 0
    let i = 0
    while (i < text.length) {
      const c = text.charCodeAt(i)
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
        const d = text.charCodeAt(i + 1)
        if (d >= 0xdc00 && d <= 0xdfff) i++
      }
      count++
      i++
    }
    return count
  }

  function hasLoneSurrogate (text) {
    let i = 0
    while (i < text.length) {
      const c = text.charCodeAt(i)
      if (c >= 0xd800 && c <= 0xdbff) {
        const d = i + 1 < text.length ? text.charCodeAt(i + 1) : 0
        if (d < 0xdc00 || d > 0xdfff) return true
        i++
      } else if (c >= 0xdc00 && c <= 0xdfff) {
        return true
      }
      i++
    }
    return false
  }

  // Gösterilecek kısa metin: NFC, denetim ve yön karakterleri boşluğa, boşluklar teke, en fazla max kod noktası
  function cleanText (value, max) {
    if (typeof value !== 'string') return ''
    let text = value
    try {
      text = text.normalize('NFC')
    } catch (e) {
      text = value
    }
    text = text.replace(UNSAFE_TEXT_G, ' ').replace(/\s+/g, ' ').trim()
    const out = []
    let i = 0
    while (i < text.length && out.length < max) {
      const c = text.charCodeAt(i)
      const d = i + 1 < text.length ? text.charCodeAt(i + 1) : 0
      if (c >= 0xd800 && c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff) {
        out.push(text.slice(i, i + 2))
        i += 2
      } else {
        out.push(c >= 0xd800 && c <= 0xdfff ? '\ufffd' : text.charAt(i))
        i++
      }
    }
    return out.join('').trim()
  }

  function validText (value, max) {
    return typeof value === 'string' && !UNSAFE_TEXT_RE.test(value) && !hasLoneSurrogate(value) && codePointLength(value) <= max
  }

  function sameId (a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return false
    return String(a) === String(b)
  }

  function toRoomId (value) {
    if (typeof value === 'number' && isSafeInt(value, 1, Number.MAX_SAFE_INTEGER)) return value
    if (typeof value === 'string' && ROOM_KEY_RE.test(value)) {
      const n = Number(value)
      return Number.isSafeInteger(n) ? n : null
    }
    return null
  }

  function toUserId (value) {
    return toRoomId(value)
  }

  // ------------------------------------------------------------ YouTube bağlantısı ve komutlar

  function queryParam (query, name) {
    if (!query) return null
    const parts = query.split('&')
    for (const part of parts) {
      const eq = part.indexOf('=')
      const rawKey = eq === -1 ? part : part.slice(0, eq)
      let key = rawKey
      let value = eq === -1 ? '' : part.slice(eq + 1)
      try {
        key = decodeURIComponent(rawKey)
        value = decodeURIComponent(value)
      } catch (e) {
        continue
      }
      if (key === name) return value
    }
    return null
  }

  // Bağlantıdan video kimliği. Sonuç { videoId } veya null. Kimlik kesin [A-Za-z0-9_-]{11} desenindedir.
  function parseYouTubeUrl (input) {
    if (typeof input !== 'string') return null
    const text = input.trim()
    if (text.length === 0 || text.length > 2048 || /[\s\u0000-\u001f\u007f]/.test(text)) return null
    const m = /^(?:(https?):\/\/)?([^/?#]+)([^?#]*)(\?[^#]*)?(#.*)?$/i.exec(text)
    if (!m) return null
    const host = m[2].toLowerCase()
    if (host.indexOf('@') !== -1 || host.indexOf(':') !== -1) return null
    const path = m[3] || ''
    const query = m[4] ? m[4].slice(1) : ''
    let id = null
    if (host === 'youtu.be') {
      const p = /^\/([A-Za-z0-9_-]{11})\/?$/.exec(path)
      id = p ? p[1] : null
    } else if (WATCH_HOSTS.indexOf(host) !== -1) {
      if (/^\/watch\/?$/.test(path)) {
        id = queryParam(query, 'v')
      } else if (host !== 'music.youtube.com') {
        const p = /^\/(?:shorts|embed)\/([A-Za-z0-9_-]{11})\/?$/.exec(path)
        id = p ? p[1] : null
      }
    } else if (NOCOOKIE_HOSTS.indexOf(host) !== -1) {
      const p = /^\/embed\/([A-Za-z0-9_-]{11})\/?$/.exec(path)
      id = p ? p[1] : null
    }
    return typeof id === 'string' && VIDEO_ID_RE.test(id) ? { videoId: id } : null
  }

  // Komut ayrıştırıcı. DJ komutu değilse null, değilse { name, arg, videoId?, error? }.
  // name: play, skip, pause, resume, queue, stop. play için arg boşsa videoId null olur (ekli dosya beklenir).
  function parseCommand (input) {
    if (typeof input !== 'string') return null
    let text = input
    try {
      text = text.normalize('NFC')
    } catch (e) {
      text = input
    }
    text = text.trim()
    if (text.charAt(0) !== '/') return null
    const m = /^(\/\S+)(?:\s+([\s\S]*))?$/.exec(text)
    if (!m) return null
    const word = m[1].replace(/[\u0130\u0131]/g, 'i').toLowerCase()
    let name = null
    const names = Object.keys(COMMANDS)
    for (const candidate of names) {
      if (name === null && COMMANDS[candidate].indexOf(word) !== -1) name = candidate
    }
    if (name === null) return null
    const arg = (m[2] || '').trim()
    const out = { name: name, arg: arg }
    if (name === 'play') {
      if (arg === '') {
        out.videoId = null
      } else {
        const yt = parseYouTubeUrl(arg)
        if (yt) out.videoId = yt.videoId
        else out.error = 'bad_url'
      }
    }
    return out
  }

  // ------------------------------------------------------------ ses dosyası türleri

  function normalizeAudioType (mime, name) {
    let m = typeof mime === 'string' ? mime.toLowerCase().split(';')[0].trim() : ''
    if (hasOwn(AUDIO_ALIASES, m)) m = AUDIO_ALIASES[m]
    if (AUDIO_TYPES.indexOf(m) !== -1) return m
    if (typeof name === 'string') {
      const dot = name.lastIndexOf('.')
      const ext = dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
      if (hasOwn(AUDIO_EXTENSIONS, ext)) return AUDIO_EXTENSIONS[ext]
    }
    return null
  }

  function startsWithBytes (bytes, offset, sig) {
    if (bytes.length < offset + sig.length) return false
    return sig.every((value, i) => bytes[offset + i] === value)
  }

  // Sihirli baytlara göre ses türü (kanonik MIME) veya null
  function sniffAudio (input) {
    let b = null
    if (input instanceof Uint8Array) b = input
    else if (input && toStr.call(input) === '[object ArrayBuffer]') b = new Uint8Array(input)
    else if (input && ArrayBuffer.isView(input)) b = new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    if (!b || b.length < 4) return null
    if (startsWithBytes(b, 0, [0x52, 0x49, 0x46, 0x46]) && startsWithBytes(b, 8, [0x57, 0x41, 0x56, 0x45])) return 'audio/wav'
    if (startsWithBytes(b, 0, [0x4f, 0x67, 0x67, 0x53])) return 'audio/ogg'
    if (startsWithBytes(b, 0, [0x66, 0x4c, 0x61, 0x43])) return 'audio/flac'
    if (startsWithBytes(b, 0, [0x1a, 0x45, 0xdf, 0xa3])) return 'audio/webm'
    if (startsWithBytes(b, 4, [0x66, 0x74, 0x79, 0x70])) return 'audio/mp4'
    if (startsWithBytes(b, 0, [0x49, 0x44, 0x33])) return 'audio/mpeg'
    if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) {
      // Katman bitleri 00 ise ADTS (AAC), değilse MPEG ses çerçevesi
      return (b[1] & 0x06) === 0 ? 'audio/aac' : 'audio/mpeg'
    }
    return null
  }

  // ------------------------------------------------------------ durum doğrulama

  function validFile (f) {
    if (!isObj(f) || !keysOk(f, FILE_KEYS)) return false
    if (typeof f.u !== 'string' || !UPLOAD_ID_RE.test(f.u)) return false
    if (typeof f.k !== 'string' || !FILE_KEY_RE.test(f.k)) return false
    if (typeof f.n !== 'string' || !FILE_NONCE_RE.test(f.n)) return false
    if (typeof f.m !== 'string' || AUDIO_TYPES.indexOf(f.m) === -1) return false
    return isSafeInt(f.s, 1, MAX_FILE_BYTES)
  }

  function validTrack (t) {
    if (!isObj(t)) return false
    if (t.type === 'youtube') {
      if (!keysOk(t, YT_TRACK_KEYS)) return false
      if (typeof t.videoId !== 'string' || !VIDEO_ID_RE.test(t.videoId)) return false
    } else if (t.type === 'file') {
      if (!keysOk(t, FILE_TRACK_KEYS)) return false
      if (!validFile(t.file)) return false
    } else {
      return false
    }
    if (typeof t.id !== 'string' || !ID_RE.test(t.id)) return false
    if (!validText(t.title, MAX_TITLE)) return false
    if (!isSafeInt(t.addedBy, 1, Number.MAX_SAFE_INTEGER)) return false
    return isSafeInt(t.duration, 0, MAX_DURATION_MS)
  }

  function validLast (l) {
    if (l === null) return true
    if (!isObj(l) || !keysOk(l, LAST_REQUIRED, LAST_OPTIONAL)) return false
    if (OPS.indexOf(l.op) === -1) return false
    if (!isSafeInt(l.by, 1, Number.MAX_SAFE_INTEGER)) return false
    if (hasOwn(l, 'id') && (typeof l.id !== 'string' || !ID_RE.test(l.id))) return false
    if (hasOwn(l, 'title') && !validText(l.title, MAX_TITLE)) return false
    if (hasOwn(l, 'code') && (typeof l.code !== 'string' || !CODE_RE.test(l.code))) return false
    return true
  }

  function cloneTrack (t) {
    const out = { id: t.id, type: t.type }
    if (t.type === 'youtube') out.videoId = t.videoId
    else out.file = { u: t.file.u, k: t.file.k, n: t.file.n, m: t.file.m, s: t.file.s }
    out.title = t.title
    out.addedBy = t.addedBy
    out.duration = t.duration
    return out
  }

  function cloneLast (l) {
    if (l === null) return null
    const out = { op: l.op, by: l.by }
    if (hasOwn(l, 'id')) out.id = l.id
    if (hasOwn(l, 'title')) out.title = l.title
    if (hasOwn(l, 'code')) out.code = l.code
    return out
  }

  function cloneState (s) {
    return {
      v: s.v,
      ctx: s.ctx,
      room: s.room,
      sid: s.sid,
      seq: s.seq,
      current: s.current ? cloneTrack(s.current) : null,
      queue: s.queue.map(cloneTrack),
      gone: s.gone.slice(),
      playing: s.playing,
      anchorAt: s.anchorAt,
      anchorPos: s.anchorPos,
      last: cloneLast(s.last)
    }
  }

  // Çözülmüş düz metnin katı doğrulaması. Sonuç { ok: true, state } (yalnızca bilinen alanlarla yeni nesne)
  // veya { ok: false, reason }. room beklenen oda kimliğidir (bağlam bağlama).
  function validateState (value, room) {
    const bad = (reason) => ({ ok: false, reason: reason })
    if (!isObj(value)) return bad('not_object')
    if (!keysOk(value, STATE_KEYS)) return bad('keys')
    if (value.v !== VERSION) return bad('version')
    if (value.ctx !== CONTEXT) return bad('context')
    if (!isSafeInt(value.room, 1, Number.MAX_SAFE_INTEGER) || value.room !== room) return bad('room')
    if (typeof value.sid !== 'string' || !ID_RE.test(value.sid)) return bad('sid')
    if (!isSafeInt(value.seq, 1, Number.MAX_SAFE_INTEGER)) return bad('seq')
    if (typeof value.playing !== 'boolean') return bad('playing')
    if (!isSafeInt(value.anchorAt, 0, MAX_TIME_MS)) return bad('anchor_at')
    if (!isSafeInt(value.anchorPos, 0, MAX_DURATION_MS)) return bad('anchor_pos')
    if (value.current !== null && !validTrack(value.current)) return bad('current')
    if (!Array.isArray(value.queue) || value.queue.length > MAX_QUEUE) return bad('queue')
    if (!value.queue.every(validTrack)) return bad('queue')
    if (value.current === null && (value.queue.length > 0 || value.playing)) return bad('empty_session')
    const ids = {}
    const all = value.current ? [value.current].concat(value.queue) : value.queue
    for (const t of all) {
      if (ids[t.id] === true) return bad('duplicate_id')
      ids[t.id] = true
    }
    // gone: geçilen veya çıkarılan parça kimlikleri. Benzersizdir ve çalan ya da sıradaki bir parçayla çakışmaz.
    if (!Array.isArray(value.gone) || value.gone.length > MAX_GONE) return bad('gone')
    for (const id of value.gone) {
      if (typeof id !== 'string' || !ID_RE.test(id) || ids[id] === true) return bad('gone')
      ids[id] = true
    }
    if (!validLast(value.last)) return bad('last')
    return { ok: true, state: cloneState(value) }
  }

  // Ortak konum (ms): çapa konumu + (sunucu şimdi - çapa zamanı), süre biliniyorsa onunla sınırlı
  function positionAt (state, serverNow) {
    if (!state || !state.current) return 0
    let pos = state.anchorPos
    if (state.playing && isFiniteNumber(serverNow)) pos += Math.max(0, serverNow - state.anchorAt)
    const d = state.current.duration
    if (d > 0 && pos > d) pos = d
    return Math.max(0, Math.round(pos))
  }

  // ------------------------------------------------------------ işlemler (saf)

  function findTrack (s, id) {
    if (!s) return null
    if (s.current && s.current.id === id) return s.current
    return s.queue.find((t) => t.id === id) || null
  }

  // Oturumdan çıkan parçaların kimlikleri gone listesine eklenir (en eskiler düşer)
  function bury (s, tracks) {
    tracks.forEach((t) => {
      if (s.gone.indexOf(t.id) === -1) s.gone.push(t.id)
    })
    if (s.gone.length > MAX_GONE) s.gone = s.gone.slice(s.gone.length - MAX_GONE)
  }

  // Sıradaki parçaya geçer. Duraklatılmış oturum duraklatılmış kalır, yeni parça kısa bir başlangıç
  // payıyla (herkesin yüklemesi için) çapalanır.
  function advance (s, now) {
    if (s.current) bury(s, [s.current])
    const next = s.queue.length > 0 ? s.queue.shift() : null
    s.current = next
    s.anchorPos = 0
    s.anchorAt = next && s.playing ? now + START_LEAD_MS : now
    if (!next) s.playing = false
  }

  function lastOf (op, by, track, code) {
    const out = { op: op, by: by }
    if (track) {
      out.id = track.id
      out.title = track.title
    }
    if (code) out.code = code
    return out
  }

  // İşlemi uygular. Sonuç yeni durum, etkisizse null. ctx: { room, me, now (sunucu ms), newSid() }.
  // Kuyruk doluysa 'queue_full' kodlu hata fırlatır.
  function applyOp (prev, op, ctx) {
    if (!isObj(op) || OPS.indexOf(op.type) === -1) throw fail('bad_op')
    const now = Math.max(0, Math.round(ctx.now))
    const me = ctx.me
    const s = prev ? cloneState(prev) : null
    let last = null
    if (op.type === 'add') {
      if (!validTrack(op.track)) throw fail('bad_track')
      const base = s || {
        v: VERSION,
        ctx: CONTEXT,
        room: ctx.room,
        sid: ctx.newSid(),
        seq: 0,
        current: null,
        queue: [],
        gone: [],
        playing: false,
        anchorAt: now,
        anchorPos: 0,
        last: null
      }
      // Aynı kimlik zaten oturumda veya oturumdan çıkmışsa ekleme daha önce uygulanmıştır (yanıtı
      // kaybolan isteğin yeniden denenmesi): etkisizdir
      if (findTrack(base, op.track.id) || base.gone.indexOf(op.track.id) !== -1) return null
      if (!base.current) {
        base.current = cloneTrack(op.track)
        base.playing = true
        base.anchorAt = now + START_LEAD_MS
        base.anchorPos = 0
      } else {
        if (base.queue.length >= MAX_QUEUE) throw fail('queue_full')
        base.queue.push(cloneTrack(op.track))
      }
      base.seq += 1
      base.last = lastOf('add', me, op.track)
      return base
    }
    if (!s) return null
    if (op.type === 'skip' || op.type === 'end' || op.type === 'error_skip') {
      if (!s.current || s.current.id !== op.id) return null
      last = lastOf(op.type, me, s.current, op.type === 'error_skip' && typeof op.code === 'string' && CODE_RE.test(op.code) ? op.code : null)
      advance(s, now)
    } else if (op.type === 'remove') {
      if (s.current && s.current.id === op.id) {
        last = lastOf('remove', me, s.current)
        advance(s, now)
      } else {
        const idx = s.queue.findIndex((t) => t.id === op.id)
        if (idx === -1) return null
        last = lastOf('remove', me, s.queue[idx])
        bury(s, s.queue.splice(idx, 1))
      }
    } else if (op.type === 'move') {
      const idx = s.queue.findIndex((t) => t.id === op.id)
      if (idx === -1 || !isSafeInt(op.to, 0, Number.MAX_SAFE_INTEGER)) return null
      const to = Math.min(op.to, s.queue.length - 1)
      if (to === idx) return null
      const item = s.queue.splice(idx, 1)[0]
      s.queue.splice(to, 0, item)
      last = lastOf('move', me, item)
    } else if (op.type === 'pause') {
      if (!s.current || !s.playing) return null
      s.anchorPos = positionAt(s, now)
      s.anchorAt = now
      s.playing = false
      last = lastOf('pause', me, s.current)
    } else if (op.type === 'resume') {
      if (!s.current || s.playing) return null
      s.anchorAt = now
      s.playing = true
      last = lastOf('resume', me, s.current)
    } else if (op.type === 'stop') {
      if (!s.current && s.queue.length === 0) return null
      bury(s, (s.current ? [s.current] : []).concat(s.queue))
      s.current = null
      s.queue = []
      s.playing = false
      s.anchorAt = now
      s.anchorPos = 0
      last = lastOf('stop', me, null)
    } else if (op.type === 'annotate') {
      const t = findTrack(s, op.id)
      if (!t) return null
      let changed = false
      if (t.title === '' && typeof op.title === 'string') {
        const title = cleanText(op.title, MAX_TITLE)
        if (title !== '') {
          t.title = title
          changed = true
        }
      }
      if (t.duration === 0 && isSafeInt(op.duration, 1, MAX_DURATION_MS)) {
        t.duration = op.duration
        changed = true
      }
      if (!changed) return null
      last = lastOf('annotate', me, t)
    } else if (op.type === 'purge_youtube') {
      const before = s.queue.length
      bury(s, s.queue.filter((t) => t.type === 'youtube'))
      s.queue = s.queue.filter((t) => t.type !== 'youtube')
      let changed = s.queue.length !== before
      if (s.current && s.current.type === 'youtube') {
        advance(s, now)
        changed = true
      }
      if (!changed) return null
      last = lastOf('purge_youtube', me, null)
    }
    s.seq += 1
    s.last = last
    return s
  }

  // ------------------------------------------------------------ sunucu saat farkı

  // Her yanıt bir örnektir: istek yerel t0'da gönderildi, yanıt t1'de alındı, sunucu zamanı now.
  // Gerçek fark [now - t1, now - t0] aralığındadır. Kayan penceredeki aralıkların kesişimi kullanılır,
  // kestirim kesişimin ortası, hata payı yarı genişliğidir. Kesişim boşalırsa (yerel saat atladı)
  // pencere en yeni örneğe sıfırlanır. t0 bilinmiyorsa (uzun bekleyen poll) yalnızca alt sınır eklenir.
  function createClock (options) {
    const opts = options || {}
    const localNow = typeof opts.now === 'function' ? opts.now : defaultNow
    let samples = []
    let lower = -Infinity
    let upper = Infinity
    function recompute () {
      lower = -Infinity
      upper = Infinity
      for (const item of samples) {
        if (item.lower > lower) lower = item.lower
        if (item.upper < upper) upper = item.upper
      }
    }
    function sample (t0, t1, serverNow) {
      if (!isFiniteNumber(t1) || !isFiniteNumber(serverNow) || serverNow <= 0) return false
      const lo = serverNow - t1
      const hi = isFiniteNumber(t0) && t0 <= t1 ? serverNow - t0 : Infinity
      samples.push({ lower: lo, upper: hi, at: t1 })
      samples = samples.filter((s) => t1 - s.at <= CLOCK_WINDOW_MS)
      if (samples.length > CLOCK_MAX_SAMPLES) samples = samples.slice(samples.length - CLOCK_MAX_SAMPLES)
      recompute()
      if (lower > upper) {
        samples = [samples[samples.length - 1]]
        recompute()
      }
      return true
    }
    function offset () {
      if (samples.length === 0) return 0
      if (upper === Infinity) return lower
      return (lower + upper) / 2
    }
    function uncertainty () {
      if (samples.length === 0 || upper === Infinity) return Infinity
      return (upper - lower) / 2
    }
    return {
      sample: sample,
      offset: offset,
      uncertainty: uncertainty,
      synced: () => samples.length > 0,
      serverNow: () => localNow() + offset(),
      reset: () => {
        samples = []
        recompute()
      }
    }
  }

  function defaultNow () {
    if (root.performance && typeof root.performance.now === 'function' && typeof root.performance.timeOrigin === 'number') {
      return root.performance.timeOrigin + root.performance.now()
    }
    return Date.now()
  }

  // ------------------------------------------------------------ cihazda saklama

  // Varsayılan saklama: localStorage. Bellekteki kopya yalnızca localStorage'a erişilemediğinde veya o anahtarın
  // yazımı başarısız olduğunda kullanılır. Böylece Ayarlar > Gizlilik'in veya başka bir sekmenin
  // localStorage.removeItem ile yaptığı geri alma görülür (bellekteki eski değer onu gölgelemez).
  function makeStorage (custom) {
    if (custom && typeof custom.get === 'function' && typeof custom.set === 'function') return custom
    const mem = Object.create(null)
    const memOnly = Object.create(null)
    return {
      get: function (key) {
        if (memOnly[key] !== true) {
          try {
            return root.localStorage.getItem(key)
          } catch (e) {
            // Depolama yoksa bellekteki değer
          }
        }
        return hasOwn(mem, key) ? mem[key] : null
      },
      set: function (key, value) {
        mem[key] = String(value)
        try {
          root.localStorage.setItem(key, String(value))
          delete memOnly[key]
        } catch (e) {
          // Yalnızca bellekte kalır
          memOnly[key] = true
        }
      },
      remove: function (key) {
        delete mem[key]
        delete memOnly[key]
        try {
          root.localStorage.removeItem(key)
        } catch (e) {
          // Yoksa sessiz
        }
      }
    }
  }

  function randomHex (bytes) {
    let buf = null
    const c = root.crypto
    if (c && typeof c.getRandomValues === 'function') {
      buf = new Uint8Array(bytes)
      c.getRandomValues(buf)
    } else if (root.nacl && typeof root.nacl.randomBytes === 'function') {
      buf = root.nacl.randomBytes(bytes)
    } else {
      throw fail('no_random')
    }
    let out = ''
    buf.forEach((byte) => {
      out += (byte < 16 ? '0' : '') + byte.toString(16)
    })
    return out
  }

  // ------------------------------------------------------------ HTTP taşıması (Ek L2.10)

  // api(method, path, body, options) -> Promise<{ status, data }> biçiminde istek işlevi. Uygulamanın
  // api() yardımcısı (public/js/01-core.js) verilebilir. Verilmezse X-Token ile kendi XHR yardımcısı.
  function createHttpTransport (options) {
    const opts = options || {}
    const api = typeof opts.api === 'function' ? opts.api : xhrApi(opts)
    const settle = (pending) => Promise.resolve(pending).then((res) => ({
      status: res && typeof res.status === 'number' ? res.status : 0,
      data: res ? res.data : null
    }), () => ({ status: 0, data: null }))
    return Object.freeze({
      postState: function (body) {
        return settle(api('POST', STATE_PATH, { channelId: body.channelId, expect: body.expect, env: body.env }, { timeout: API_TIMEOUT_MS }))
      },
      // Dönen Promise üzerinde abort() vardır (istek iptal edilir, sonuç status 0 olur). api() yardımcısı
      // abort() vermiyorsa iptal etkisizdir.
      download: function (uploadId, dl) {
        if (typeof uploadId !== 'string' || !UPLOAD_ID_RE.test(uploadId)) return Promise.resolve({ status: 0, data: null })
        const pending = api('GET', UPLOAD_PATH + uploadId, null, {
          responseType: 'arraybuffer',
          timeout: TRANSFER_TIMEOUT_MS,
          onProgress: dl && typeof dl.onProgress === 'function' ? dl.onProgress : undefined
        })
        const out = settle(pending)
        out.abort = () => {
          if (pending && typeof pending.abort === 'function') {
            try {
              pending.abort()
            } catch (e) {
              // İstek zaten bitmiş
            }
          }
        }
        return out
      }
    })
  }

  function parseJsonText (text) {
    if (typeof text !== 'string' || text === '') return null
    try {
      return JSON.parse(text)
    } catch (e) {
      return null
    }
  }

  function bufferText (buf) {
    try {
      return root.E2EE.utf8.decode(new Uint8Array(buf))
    } catch (e) {
      return ''
    }
  }

  function xhrApi (opts) {
    const token = typeof opts.token === 'function' ? opts.token : () => null
    return function (method, path, body, ropts) {
      const ro = ropts || {}
      let xhr = null
      const out = new Promise((resolve) => {
        try {
          xhr = new root.XMLHttpRequest()
          xhr.open(method, path, true)
          xhr.timeout = ro.timeout || API_TIMEOUT_MS
          if (ro.responseType) xhr.responseType = ro.responseType
          const tok = token()
          if (tok) xhr.setRequestHeader('X-Token', tok)
          let payload = null
          if (method !== 'GET') {
            xhr.setRequestHeader('Content-Type', 'application/json')
            payload = JSON.stringify(body || {})
          }
          if (typeof ro.onProgress === 'function') xhr.onprogress = ro.onProgress
          xhr.onload = () => {
            let data = null
            if (ro.responseType === 'arraybuffer') {
              data = xhr.status === 200 ? xhr.response : parseJsonText(bufferText(xhr.response))
            } else {
              data = parseJsonText(xhr.responseText)
            }
            resolve({ status: xhr.status, data: data })
          }
          xhr.onerror = () => resolve({ status: 0, data: null })
          xhr.ontimeout = () => resolve({ status: 0, data: null })
          xhr.onabort = () => resolve({ status: 0, data: null })
          xhr.send(payload)
        } catch (e) {
          resolve({ status: 0, data: null })
        }
      })
      out.abort = () => {
        try {
          if (xhr) xhr.abort()
        } catch (e) {
          // İstek zaten bitmiş
        }
      }
      return out
    }
  }

  // ------------------------------------------------------------ <audio> bağdaştırıcısı

  // Çözülmüş dosyayı çalar. src her zaman URL.createObjectURL ile üretilmiş blob adresidir.
  function createAudioPlayer (env, track, url, hooks) {
    const audio = env.createAudio()
    let ready = false
    let destroyed = false
    audio.preload = 'auto'
    const on = (name, fn) => audio.addEventListener(name, fn)
    on('loadedmetadata', () => {
      if (destroyed) return
      if (isFiniteNumber(audio.duration) && audio.duration > 0) hooks.duration(Math.round(audio.duration * 1000))
    })
    on('canplay', () => {
      if (destroyed || ready) return
      ready = true
      hooks.ready()
    })
    on('ended', () => {
      if (!destroyed) hooks.ended()
    })
    on('error', () => {
      if (!destroyed) hooks.error('file_media_error')
    })
    on('pause', () => {
      if (!destroyed && !audio.ended) hooks.paused()
    })
    on('play', () => {
      if (!destroyed) hooks.played()
    })
    audio.src = url
    return {
      kind: 'file',
      trackId: track.id,
      url: url,
      ready: () => ready,
      playing: () => !audio.paused && !audio.ended,
      // Yerel blob adresinden çalınır, oynatma isteği bekleyen bir yükleme durumu izlenmez
      buffering: () => false,
      // <audio> öğesinde konum değiştirmek oynatmayı başlatmaz
      canSeekPaused: () => true,
      durationMs: () => (isFiniteNumber(audio.duration) && audio.duration > 0 ? Math.round(audio.duration * 1000) : 0),
      position: () => (ready && isFiniteNumber(audio.currentTime) ? Math.round(audio.currentTime * 1000) : null),
      play: function () {
        let result
        try {
          result = audio.play()
        } catch (e) {
          return Promise.resolve(e && e.name === 'NotAllowedError' ? 'blocked' : 'error')
        }
        if (!result || typeof result.then !== 'function') return Promise.resolve('ok')
        return result.then(() => 'ok', (e) => (e && e.name === 'NotAllowedError' ? 'blocked' : (e && e.name === 'AbortError' ? 'aborted' : 'error')))
      },
      pause: function () {
        try {
          audio.pause()
        } catch (e) {
          // Zaten durmuş
        }
      },
      seek: function (ms) {
        try {
          audio.currentTime = Math.max(0, ms) / 1000
        } catch (e) {
          // Henüz konumlanamıyor, sonraki eşitlemede yeniden denenir
        }
      },
      setVolume: function (v) {
        audio.volume = Math.max(0, Math.min(1, v))
      },
      setMuted: function (m) {
        audio.muted = m === true
      },
      visible: () => true,
      element: () => audio,
      destroy: function () {
        destroyed = true
        try {
          audio.pause()
        } catch (e) {
          // Yoksa sessiz
        }
        try {
          audio.removeAttribute('src')
          audio.load()
        } catch (e) {
          // Yoksa sessiz
        }
      }
    }
  }

  // ------------------------------------------------------------ motor

  // options:
  //   transport      { postState({ channelId, expect, env }), download(uploadId, { onProgress }) } (zorunlu)
  //   seal(obj)      -> zarf. Varsayılan: E2EE.sealJson(meta.activeKid, obj)
  //   open(env)      -> { ok, value } | { ok: false, reason }. Varsayılan: E2EE.openJson
  //   me()           -> kendi kullanıcı kimliği (sayı). handleMeta(meta, myId) ile de verilir.
  //   storage        { get, set, remove } (varsayılan: try/catch'li localStorage, yoksa bellek)
  //   now()          yerel tekdüze saat (ms). youtube: TelsizYouTube benzeri nesne (varsayılan window.TelsizYouTube)
  //   decryptFile(box, key, nonce) -> Uint8Array | null (varsayılan E2EE.decryptFile)
  //   createAudio(), createObjectURL(blob), revokeObjectURL(url), makeBlob(bytes, type), canPlayType(type)
  //   timers { setTimeout, clearTimeout, setInterval, clearInterval }, randomHex(bytes), t(key) (çerçeve başlığı için)
  //   probeVolume()  -> bool: bu cihazda <audio>.volume ayarlanabiliyor mu (varsayılan: deneme öğesiyle ölçülür)
  function create (options) {
    const opts = options || {}
    if (!opts.transport || typeof opts.transport.postState !== 'function') throw fail('bad_transport', 'A transport with postState is required.')
    const transport = opts.transport
    const now = typeof opts.now === 'function' ? opts.now : defaultNow
    const timers = opts.timers || {
      setTimeout: (fn, ms) => root.setTimeout(fn, ms),
      clearTimeout: (id) => root.clearTimeout(id),
      setInterval: (fn, ms) => root.setInterval(fn, ms),
      clearInterval: (id) => root.clearInterval(id)
    }
    const storage = makeStorage(opts.storage)
    const hex = typeof opts.randomHex === 'function' ? opts.randomHex : randomHex
    const clock = createClock({ now: now })
    const env = {
      createAudio: typeof opts.createAudio === 'function' ? opts.createAudio : () => root.document.createElement('audio'),
      createObjectURL: typeof opts.createObjectURL === 'function' ? opts.createObjectURL : (blob) => root.URL.createObjectURL(blob),
      revokeObjectURL: typeof opts.revokeObjectURL === 'function' ? opts.revokeObjectURL : (url) => root.URL.revokeObjectURL(url),
      makeBlob: typeof opts.makeBlob === 'function' ? opts.makeBlob : (bytes, type) => new root.Blob([bytes], { type: type }),
      canPlayType: typeof opts.canPlayType === 'function' ? opts.canPlayType : defaultCanPlayType,
      decryptFile: typeof opts.decryptFile === 'function' ? opts.decryptFile : (box, k, n) => root.E2EE.decryptFile(box, k, n),
      probeVolume: typeof opts.probeVolume === 'function' ? opts.probeVolume : defaultProbeVolume
    }

    let myId = null
    let activeKid = null
    let settings = { supported: false, enabled: false, youtube: false }
    let metaRoom = null
    let deviceRoom = null
    let lastBoot = null
    let muv = 0
    const rooms = new Map()
    const marks = new Map()
    // Odanın son geçerli durumu: parça alanlarının değişmezliği buna göre denetlenir (araya giren geçersiz bir
    // kayıt karşılaştırmayı atlatamaz)
    const goodStates = new Map()
    const listeners = Object.create(null)
    const recent = new Map()
    // Çözülmüş dosyaların blob adresleri (anahtar: yükleme kimliği ve dosya anahtarı) ve süren indirmeler
    const fileCache = new Map()
    const loads = new Map()
    // Atlama gecikmesi telafisi (ms), oynatıcı türüne göre öğrenilir ve parçalar arasında korunur
    const seekLead = { youtube: 0, file: 0 }
    const seekLeadSamples = { youtube: 0, file: 0 }
    // Oynatıcı kurtarma (indirme yeniden denemesi, yanıt vermeyen YouTube oynatıcısının yeniden kurulması)
    const recovery = { trackId: null, attempts: 0, handle: null }
    let volumeSupport = null
    // Çözülemeyen dosyası bir kez yeniden indirilen son parça
    let decryptRetried = null
    let host = null
    let player = null
    let tickHandle = null
    let leadHandle = null
    let lastPositionEvent = 0
    let chain = Promise.resolve()
    let pending = 0
    let destroyed = false
    let consentAskedFor = null
    let lastSignature = ''
    let lastTrackKey = ''
    let lastConsent = null
    const local = {
      status: 'idle',
      blocked: null,
      needsTap: false,
      // hold: bu cihazda oynatıcı ortak durumdan bağımsız durdu. holdReason: 'player' (sayfa görünürken
      // YouTube oynatıcısının kendi denetimleriyle) veya 'device' (tarayıcı, işletim sistemi, medya tuşları).
      // holdHidden: duraklama sayfa görünmezken oldu, sayfa yeniden görünür olunca kendiliğinden eşitlenir.
      hold: false,
      holdReason: null,
      holdHidden: false,
      error: null,
      // failed: oynatıcı kalıcı bir hata bildirdi, yeniden oynatma denenmez (resync() yeniden kurar)
      failed: false,
      hidden: false,
      lastPlayAttempt: -Infinity,
      lastSeek: -Infinity,
      ownPauseUntil: -Infinity,
      // playPendingSince: oynatma isteğinin sonucu bekleniyor. bufferingSince: oynatıcı yükleniyor.
      // awaitSettle/settleSince/seekIssuedAt: motorun atlamasından sonra oynatıcının oturması bekleniyor.
      playPendingSince: null,
      bufferingSince: null,
      awaitSettle: false,
      settleSince: null,
      seekIssuedAt: null,
      settleAfterCorrection: false,
      seekFails: 0,
      positionMs: null,
      driftMs: null,
      corrections: 0,
      loadingTrack: null,
      ended: false
    }

    function me () {
      if (typeof opts.me === 'function') {
        const id = toUserId(opts.me())
        if (id !== null) return id
      }
      return myId
    }

    function seal (obj) {
      if (typeof opts.seal === 'function') return opts.seal(obj)
      if (!root.E2EE || typeof activeKid !== 'string') throw fail('no_key')
      return root.E2EE.sealJson(activeKid, obj)
    }

    function open (envelope) {
      try {
        if (typeof opts.open === 'function') return opts.open(envelope)
        if (!root.E2EE) return { ok: false, reason: 'no_key' }
        return root.E2EE.openJson(envelope)
      } catch (e) {
        return { ok: false, reason: 'bad_data' }
      }
    }

    function canSeal () {
      if (typeof opts.canSeal === 'function') return opts.canSeal() === true
      if (typeof opts.seal === 'function') return true
      return Boolean(root.E2EE) && typeof activeKid === 'string' && root.E2EE.keyring.has(activeKid)
    }

    // ---------------------------------------------------------- olaylar

    function on (name, fn) {
      if (typeof fn !== 'function') return () => {}
      if (!listeners[name]) listeners[name] = []
      listeners[name].push(fn)
      return () => {
        const list = listeners[name] || []
        const i = list.indexOf(fn)
        if (i !== -1) list.splice(i, 1)
      }
    }

    function emit (name, payload) {
      const list = (listeners[name] || []).slice()
      for (const fn of list) {
        try {
          fn(payload)
        } catch (e) {
          if (root.console && typeof root.console.error === 'function') root.console.error(e)
        }
      }
    }

    function emitError (code, trackId, isLocal) {
      emit('error', { code: code, trackId: trackId || null, local: isLocal !== false })
    }

    function trackView (t) {
      if (!t) return null
      const out = { id: t.id, type: t.type, title: t.title, addedBy: t.addedBy, durationMs: t.duration }
      if (t.type === 'youtube') out.videoId = t.videoId
      else out.file = { uploadId: t.file.u, mime: t.file.m, size: t.file.s }
      return out
    }

    function roomState (room) {
      const rec = room === null ? null : rooms.get(room)
      if (!rec || (rec.status !== 'ok' && rec.status !== 'replay')) return null
      return rec.state
    }

    function controlRoom () {
      return deviceRoom !== null ? deviceRoom : metaRoom
    }

    function snapshot () {
      const room = controlRoom()
      const rec = room === null ? null : rooms.get(room)
      const st = roomState(room)
      const t = clock.serverNow()
      return {
        supported: settings.supported,
        enabled: settings.enabled,
        youtubeEnabled: settings.youtube,
        room: room,
        listening: deviceRoom !== null && settings.enabled && player !== null,
        consent: consentValue(),
        volume: volumeValue(),
        volumeSupported: volumeSupported(),
        muted: mutedValue(),
        sessionStatus: rec ? rec.status : 'none',
        session: st
          ? {
              v: rec.v,
              current: trackView(st.current),
              queue: st.queue.map(trackView),
              playing: st.playing,
              positionMs: positionAt(st, t),
              durationMs: st.current ? st.current.duration : 0,
              startsInMs: st.playing && st.current ? Math.max(0, Math.round(st.anchorAt - t)) : 0,
              last: cloneLast(st.last)
            }
          : null,
        player: {
          kind: player ? player.kind : null,
          trackId: player ? player.trackId : null,
          status: local.status,
          blocked: local.blocked,
          needsTap: local.needsTap,
          hold: local.hold,
          holdReason: local.hold ? local.holdReason : null,
          hidden: local.hidden,
          error: local.error,
          positionMs: local.positionMs,
          driftMs: local.driftMs,
          corrections: local.corrections
        },
        clock: { offsetMs: Math.round(clock.offset()), uncertaintyMs: clock.uncertainty() === Infinity ? null : Math.round(clock.uncertainty()), synced: clock.synced() },
        busy: pending > 0
      }
    }

    // Herhangi bir ses odasının müzik oturumu (kadroda "Telsiz DJ" öğesi için, odada olmayanlar da görür)
    function roomView (roomId) {
      const room = toRoomId(roomId)
      const rec = room === null ? null : rooms.get(room)
      if (!rec) return null
      const st = roomState(room)
      return {
        room: room,
        status: rec.status,
        v: rec.v,
        current: st ? trackView(st.current) : null,
        queueLength: st ? st.queue.length : 0,
        playing: st ? st.playing : false,
        positionMs: st ? positionAt(st, clock.serverNow()) : 0
      }
    }

    function activeRooms () {
      return Array.from(rooms.keys()).map(roomView).filter((view) => view !== null && view.current !== null)
    }

    function signature () {
      const room = controlRoom()
      const rec = room === null ? null : rooms.get(room)
      return [settings.supported, settings.enabled, settings.youtube, room, deviceRoom, rec ? rec.v : 0, rec ? rec.status : '',
        player ? player.trackId : '', local.status, local.blocked, local.needsTap, local.hold, local.holdReason, local.hidden, local.error,
        consentValue(), volumeValue(), mutedValue(), pending > 0].join('|')
    }

    function changed () {
      const sig = signature()
      if (sig === lastSignature) return
      lastSignature = sig
      emit('change', snapshot())
    }

    // ---------------------------------------------------------- cihaz ayarları

    function consentValue () {
      const v = storage.get(KEY_CONSENT)
      if (v === '1') return 'granted'
      return v === null ? 'unset' : 'denied'
    }

    function volumeValue () {
      const raw = storage.get(KEY_VOLUME)
      const n = raw === null ? NaN : Number(raw)
      return isFinite(n) && n >= 0 && n <= 1 ? n : DEFAULT_VOLUME
    }

    function mutedValue () {
      return storage.get(KEY_MUTED) === '1'
    }

    // Bazı platformlarda (iOS) ses öğesinin volume özelliği JavaScript'ten ayarlanamaz, ses yalnızca cihazın
    // tuşlarıyla değişir. Bu durumda arayüz ses kaydırıcısını göstermez, susturma çalışmaya devam eder.
    function volumeSupported () {
      if (volumeSupport === null) {
        let ok = true
        try {
          ok = env.probeVolume() !== false
        } catch (e) {
          ok = true
        }
        volumeSupport = ok
      }
      return volumeSupport
    }

    function applyAudioSettings () {
      if (!player) return
      player.setVolume(volumeValue())
      player.setMuted(mutedValue())
    }

    function setConsent (granted) {
      if (granted === true) storage.set(KEY_CONSENT, '1')
      else if (granted === false) storage.set(KEY_CONSENT, '0')
      else storage.remove(KEY_CONSENT)
      consentAskedFor = null
      reconcile()
      changed()
    }

    function setVolume (value) {
      const n = Number(value)
      if (!isFinite(n)) return
      storage.set(KEY_VOLUME, String(Math.max(0, Math.min(1, n))))
      applyAudioSettings()
      changed()
    }

    function setMuted (value) {
      storage.set(KEY_MUTED, value === true ? '1' : '0')
      applyAudioSettings()
      changed()
    }

    // ---------------------------------------------------------- sunucudan gelen durum

    // Önceki durumda bilinen bir parçanın değişmez alanları (tür, kaynak, ekleyen) aynı kalmalıdır. Başlık
    // yalnızca boşsa, süre yalnızca bilinmiyorsa (0) doldurulabilir (annotate).
    function tracksConsistent (prevState, st) {
      const known = {}
      const all = (prevState.current ? [prevState.current] : []).concat(prevState.queue)
      all.forEach((t) => {
        known[t.id] = t
      })
      const next = (st.current ? [st.current] : []).concat(st.queue)
      return next.every((t) => {
        const old = hasOwn(known, t.id) ? known[t.id] : null
        if (!old) return true
        if (old.type !== t.type || old.addedBy !== t.addedBy) return false
        if (t.type === 'youtube' && old.videoId !== t.videoId) return false
        if (t.type === 'file' && FILE_KEYS.some((k) => old.file[k] !== t.file[k])) return false
        if (old.title !== '' && old.title !== t.title) return false
        return old.duration === 0 || old.duration === t.duration
      })
    }

    // by: sunucunun bu sürümü yazan oturumdan bildirdiği kullanıcı kimliği (Ek L2.10 sözleşmesi). Şifreli
    // durumdaki last.by bununla aynı olmalıdır, son işlem eklemeyse eklenen parçanın addedBy alanı da. Grup
    // anahtarını bilen bir oda üyesi işlemi başkasının adına yazamaz.
    function decode (envelope, room, at, previous, by) {
      const opened = open(envelope)
      if (!opened || opened.ok !== true) {
        return { status: opened && opened.reason === 'no_key' ? 'no_key' : 'invalid', state: null, reason: opened ? opened.reason : 'bad_data' }
      }
      const res = validateState(opened.value, room)
      if (!res.ok) return { status: 'invalid', state: null, reason: res.reason }
      const st = res.state
      if (by === null || st.last === null || st.last.by !== by) return { status: 'invalid', state: null, reason: 'author' }
      if (st.last.op === 'add') {
        const added = findTrack(st, st.last.id)
        if (!added || added.addedBy !== by) return { status: 'invalid', state: null, reason: 'author' }
      }
      const prevState = previous && (previous.status === 'ok' || previous.status === 'replay') ? previous.state : null
      // Yazanın saat kestirimi bozuksa çapa zamanı sunucunun kabul zamanından fazla ileride olamaz
      if (at > 0 && st.anchorAt > at + MAX_LEAD_MS) st.anchorAt = at + MAX_LEAD_MS
      const mark = marks.get(room)
      if (mark && mark.sid === st.sid && st.seq <= mark.seq) {
        // Eski bir durum yeniden oynatıldı: gösterilen durum korunur, sürüm benimsenir ki sonraki yazım düzeltsin
        return { status: 'replay', state: prevState, reason: 'replay' }
      }
      const good = goodStates.get(room) || null
      if (good && !tracksConsistent(good, st)) return { status: 'invalid', state: null, reason: 'track_changed' }
      return { status: 'ok', state: st }
    }

    function updateMark (room, st) {
      const mark = marks.get(room)
      if (!mark || mark.sid !== st.sid || st.seq > mark.seq) marks.set(room, { sid: st.sid, seq: st.seq })
    }

    // raw: { v, at, by, env } veya null (odada durum yok). timing: { t0 } poll'un gönderilme zamanı.
    function acceptRecord (room, raw, timing, own) {
      const prev = rooms.get(room) || null
      if (raw === null) {
        if (!prev) return false
        if (timing && isFiniteNumber(timing.t0) && prev.receivedAt > timing.t0) return false
        rooms.delete(room)
        afterRoomChange(room, prev, null)
        return true
      }
      if (!isObj(raw) || !isSafeInt(raw.v, 1, Number.MAX_SAFE_INTEGER)) return false
      if (prev && raw.v < prev.v) return false
      if (prev && raw.v === prev.v && raw.env === prev.env) return false
      const at = isSafeInt(raw.at, 0, MAX_TIME_MS) ? raw.at : 0
      let rec
      if (own) {
        // Okuyanların uyguladığı çapa sınırı kendi yazdığımız duruma da uygulanır ki herkes aynı konumu görsün
        if (at > 0 && own.anchorAt > at + MAX_LEAD_MS) own.anchorAt = at + MAX_LEAD_MS
        rec = { v: raw.v, at: at, env: raw.env, status: 'ok', state: own, receivedAt: now() }
      } else if (typeof raw.env !== 'string' || raw.env.length > MAX_ENV_CHARS || !ENVELOPE_RE.test(raw.env)) {
        rec = { v: raw.v, at: at, env: null, status: 'invalid', state: null, receivedAt: now() }
      } else {
        const d = decode(raw.env, room, at, prev, isSafeInt(raw.by, 1, Number.MAX_SAFE_INTEGER) ? raw.by : null)
        rec = { v: raw.v, at: at, env: raw.env, status: d.status, state: d.state, receivedAt: now() }
        if (d.status === 'invalid') emitError('invalid_state', null, false)
        if (d.status === 'replay') emitError('replay', null, false)
      }
      if (rec.status === 'ok') {
        updateMark(room, rec.state)
        goodStates.set(room, rec.state)
      }
      rooms.set(room, rec)
      afterRoomChange(room, prev, rec)
      return true
    }

    function afterRoomChange (room, prev, rec) {
      const prevState = prev && (prev.status === 'ok' || prev.status === 'replay') ? prev.state : null
      const st = rec && (rec.status === 'ok' || rec.status === 'replay') ? rec.state : null
      if (room === controlRoom()) {
        const prevId = prevState && prevState.current ? prevState.current.id : null
        const nextId = st && st.current ? st.current.id : null
        if (prevId !== nextId) emit('track', { room: room, track: st ? trackView(st.current) : null, previous: prevState ? trackView(prevState.current) : null })
        // Bildirim yalnızca başkasının yaptığı yeni bir işlem için verilir. Açıklama (annotate) parça adını
        // veya süresini dolduran kendiliğinden bir yazımdır, bildirilmez.
        if (rec && rec.status === 'ok' && st && st.last && st.last.op !== 'annotate' && (!prev || prev.v !== rec.v) &&
          !sameId(st.last.by, me()) && (!prevState || prevState.sid !== st.sid || st.seq > prevState.seq)) {
          emit('notice', { room: room, op: st.last.op, by: st.last.by, title: st.last.title || '', code: st.last.code || null, trackId: st.last.id || null })
        }
        maybePurge()
      }
      reconcile()
      changed()
    }

    // Poll yanıtı (veya resync) işlenir. timing: { t0, t1 } isteğin yerel gönderilme ve alınma zamanları.
    function ingest (payload, timing) {
      if (destroyed || !isObj(payload)) return
      const tm = isObj(timing) ? timing : null
      if (isFiniteNumber(payload.now)) clock.sample(tm ? tm.t0 : NaN, tm && isFiniteNumber(tm.t1) ? tm.t1 : now(), payload.now)
      if (typeof payload.boot === 'string' && payload.boot !== '') {
        if (lastBoot !== null && lastBoot !== payload.boot) reset()
        lastBoot = payload.boot
      }
      if (isObj(payload.music)) {
        const seen = {}
        const keys = Object.keys(payload.music)
        for (const key of keys) {
          const room = toRoomId(key)
          if (room === null) continue
          seen[room] = true
          acceptRecord(room, payload.music[key], tm, null)
        }
        Array.from(rooms.keys()).forEach((room) => {
          if (!seen[room]) acceptRecord(room, null, tm, null)
        })
      }
      if (isSafeInt(payload.muv, 0, Number.MAX_SAFE_INTEGER) && isObj(payload.music)) muv = payload.muv
      changed()
    }

    function pollParam () {
      return String(muv)
    }

    // Sunucu yeniden başladı: odaların durumu ve müzik sürümü sıfırlanır (tekrar oynatma işaretleri korunur)
    function reset () {
      rooms.clear()
      muv = 0
      reconcile()
      changed()
    }

    function handleMeta (meta, myUserId) {
      if (destroyed || !isObj(meta)) return
      const id = toUserId(myUserId)
      if (id !== null) myId = id
      if (typeof meta.activeKid === 'string' || meta.activeKid === null) activeKid = meta.activeKid
      const m = meta.music
      const supported = isObj(m)
      const enabled = supported && m.enabled !== false
      settings = { supported: supported, enabled: enabled, youtube: enabled && m.youtube !== false }
      let room = null
      if (isObj(meta.voice) && me() !== null) {
        const keys = Object.keys(meta.voice)
        for (const key of keys) {
          const list = meta.voice[key]
          if (room === null && Array.isArray(list) && list.some((x) => x && sameId(x.userId, me()))) room = toRoomId(key)
        }
      }
      metaRoom = room
      maybePurge()
      reconcile()
      restartTicker()
      changed()
    }

    function setVoiceRoom (roomId) {
      const room = roomId === null || roomId === undefined ? null : toRoomId(roomId)
      if (room === deviceRoom) return
      deviceRoom = room
      local.hold = false
      local.needsTap = false
      reconcile()
      restartTicker()
      changed()
    }

    // ---------------------------------------------------------- yazım (CAS)

    function sleep (ms) {
      return new Promise((resolve) => timers.setTimeout(resolve, ms))
    }

    function backoff (attempt) {
      return Math.min(1000, 40 * Math.pow(2, attempt)) + Math.floor(Math.random() * 60)
    }

    function opContext (room) {
      return { room: room, me: me(), now: clock.serverNow(), newSid: () => hex(8) }
    }

    function sealState (st) {
      let envelope
      try {
        envelope = seal(st)
      } catch (e) {
        throw fail(e && e.code === 'no_key' ? 'no_key' : 'seal_failed')
      }
      if (typeof envelope !== 'string' || !ENVELOPE_RE.test(envelope)) throw fail('seal_failed')
      if (envelope.length > MAX_ENV_CHARS) throw fail('state_too_large')
      return envelope
    }

    function statusCode (res) {
      const code = res.data && typeof res.data.code === 'string' ? res.data.code : ''
      if (res.status === 403) {
        if (code === 'dj_disabled' || code === 'not_in_voice') return code
        return 'forbidden'
      }
      if (res.status === 404) return code === 'channel_not_found' ? 'not_in_voice' : 'dj_unsupported'
      if (res.status === 413) return 'state_too_large'
      if (res.status === 429) return 'rate_limited'
      if (res.status === 401) return 'session_expired'
      return 'server'
    }

    // İşlem kuyruğu: yazımlar sırayla yapılır. Sonuç her zaman { ok: true, noop? } veya { ok: false, code }.
    function commit (op) {
      pending++
      changed()
      const run = chain.then(() => commitNow(op)).then((result) => result, (e) => ({ ok: false, code: e && e.code ? e.code : 'server' }))
      chain = run.then(() => {
        pending--
        changed()
      })
      return run
    }

    async function commitNow (op) {
      if (destroyed) return { ok: false, code: 'destroyed' }
      if (!settings.supported) return { ok: false, code: 'dj_unsupported' }
      if (!settings.enabled) return { ok: false, code: 'dj_disabled' }
      const room = controlRoom()
      if (room === null) return { ok: false, code: 'not_in_voice' }
      if (!canSeal()) return { ok: false, code: 'no_key' }
      let networkFailures = 0
      let attempt = 0
      while (attempt < CAS_ATTEMPTS) {
        attempt++
        const rec = rooms.get(room) || null
        if (rec && rec.status === 'no_key') return { ok: false, code: 'no_key' }
        const prev = rec && (rec.status === 'ok' || rec.status === 'replay') ? rec.state : null
        const expect = rec ? rec.v : 0
        let next
        try {
          next = applyOp(prev, op, opContext(room))
        } catch (e) {
          return { ok: false, code: e && e.code ? e.code : 'invalid_state' }
        }
        if (next === null) return { ok: true, noop: true }
        let envelope
        try {
          envelope = sealState(next)
        } catch (e) {
          return { ok: false, code: e.code }
        }
        const t0 = now()
        let res
        try {
          res = await transport.postState({ channelId: room, expect: expect, env: envelope })
        } catch (e) {
          res = { status: 0, data: null }
        }
        const t1 = now()
        if (!res || typeof res.status !== 'number') res = { status: 0, data: null }
        const data = isObj(res.data) ? res.data : null
        if (data && isFiniteNumber(data.now)) clock.sample(t0, t1, data.now)
        if (destroyed) return { ok: false, code: 'destroyed' }
        if (res.status === 200 && data && isSafeInt(data.v, 1, Number.MAX_SAFE_INTEGER)) {
          acceptRecord(room, { v: data.v, at: data.at, env: envelope }, null, next)
          return { ok: true }
        }
        if (res.status === 409 && data) {
          if (isSafeInt(data.v, 1, Number.MAX_SAFE_INTEGER) && typeof data.env === 'string') {
            acceptRecord(room, { v: data.v, at: data.at, by: data.by, env: data.env }, null, null)
          } else if (rec) {
            rooms.delete(room)
            afterRoomChange(room, rec, null)
          }
          await sleep(backoff(attempt))
          continue
        }
        if (res.status === 0 || res.status === 502 || res.status === 503 || res.status === 504) {
          networkFailures++
          if (networkFailures > NETWORK_RETRIES) return { ok: false, code: 'network' }
          await sleep(backoff(attempt + 2))
          continue
        }
        return { ok: false, code: statusCode(res) }
      }
      return { ok: false, code: 'conflict' }
    }

    // Aynı istek kısa süre içinde bir kez gönderilir (parça sonu, hata geçişi, açıklama)
    function once (key, fn) {
      const t = now()
      const at = recent.get(key)
      if (at !== undefined && t - at < REQUEST_DEDUPE_MS) return
      recent.set(key, t)
      if (recent.size > 200) {
        Array.from(recent.keys()).slice(0, 100).forEach((k) => recent.delete(k))
      }
      fn()
    }

    function inControlOf (room) {
      return room !== null && room === controlRoom() && settings.enabled
    }

    function requestEnd (room, trackId) {
      if (!inControlOf(room)) return
      once('end:' + trackId, () => {
        commit({ type: 'end', id: trackId })
      })
    }

    function requestErrorSkip (room, trackId, code) {
      if (!inControlOf(room)) return
      once('error:' + trackId, () => {
        commit({ type: 'error_skip', id: trackId, code: code })
      })
    }

    function requestAnnotate (room, trackId, fields) {
      if (!inControlOf(room)) return
      const st = roomState(room)
      const t = findTrack(st, trackId)
      if (!t) return
      const wantTitle = t.title === '' && typeof fields.title === 'string' && cleanText(fields.title, MAX_TITLE) !== ''
      const wantDuration = t.duration === 0 && isSafeInt(fields.duration, 1, MAX_DURATION_MS)
      if (!wantTitle && !wantDuration) return
      once('annotate:' + trackId + ':' + (wantTitle ? 't' : '') + (wantDuration ? 'd' : ''), () => {
        const op = { type: 'annotate', id: trackId }
        if (wantTitle) op.title = fields.title
        if (wantDuration) op.duration = fields.duration
        commit(op)
      })
    }

    function maybePurge () {
      const room = controlRoom()
      if (!settings.enabled || settings.youtube || room === null) return
      const st = roomState(room)
      if (!st) return
      const hasYt = (st.current && st.current.type === 'youtube') || st.queue.some((t) => t.type === 'youtube')
      if (!hasYt) return
      once('purge:' + room + ':' + st.seq, () => {
        commit({ type: 'purge_youtube' })
      })
    }

    // ---------------------------------------------------------- komutlar (genel API)

    function precheck (needYouTube) {
      if (!settings.supported) return 'dj_unsupported'
      if (!settings.enabled) return 'dj_disabled'
      if (needYouTube && !settings.youtube) return 'youtube_disabled'
      if (controlRoom() === null) return 'not_in_voice'
      if (!canSeal()) return 'no_key'
      if (me() === null) return 'not_signed_in'
      return null
    }

    function rejected (code) {
      return Promise.resolve({ ok: false, code: code })
    }

    function newTrackId () {
      try {
        const id = hex(8)
        return typeof id === 'string' && ID_RE.test(id) ? id : null
      } catch (e) {
        return null
      }
    }

    // input: YouTube bağlantısı veya 11 karakterlik kimlik. extra: { title }
    function addYouTube (input, extra) {
      let videoId = null
      if (typeof input === 'string' && VIDEO_ID_RE.test(input.trim())) videoId = input.trim()
      else {
        const parsed = parseYouTubeUrl(input)
        videoId = parsed ? parsed.videoId : null
      }
      if (!videoId) return rejected('bad_url')
      const err = precheck(true)
      if (err) return rejected(err)
      const ex = isObj(extra) ? extra : {}
      const id = newTrackId()
      if (!id) return rejected('no_random')
      const track = {
        id: id,
        type: 'youtube',
        videoId: videoId,
        title: cleanText(ex.title, MAX_TITLE),
        addedBy: me(),
        duration: isSafeInt(ex.durationMs, 1, MAX_DURATION_MS) ? ex.durationMs : 0
      }
      return commit({ type: 'add', track: track }).then((r) => (r.ok ? Object.assign({ trackId: track.id }, r) : r))
    }

    // Mesaj ekindeki dosya ({ u, k, n, m, s, name }). Dosya bir yazı kanalı mesajına bağlı olmalıdır ki
    // odadaki herkes indirebilsin (mevcut yükleme modeli). extra: { title, durationMs }
    function addFile (attachment, extra) {
      const f = isObj(attachment) ? attachment : {}
      const mime = normalizeAudioType(f.m, f.name)
      const ok = typeof f.u === 'string' && UPLOAD_ID_RE.test(f.u) && typeof f.k === 'string' && FILE_KEY_RE.test(f.k) &&
        typeof f.n === 'string' && FILE_NONCE_RE.test(f.n) && isSafeInt(f.s, 1, MAX_FILE_BYTES)
      if (!ok) return rejected('bad_file')
      if (!mime) return rejected('file_bad_type')
      if (env.canPlayType(mime) === '') return rejected('file_unsupported')
      const err = precheck(false)
      if (err) return rejected(err)
      const ex = isObj(extra) ? extra : {}
      const title = cleanText(typeof ex.title === 'string' ? ex.title : f.name, MAX_TITLE)
      const id = newTrackId()
      if (!id) return rejected('no_random')
      const track = {
        id: id,
        type: 'file',
        file: { u: f.u, k: f.k, n: f.n, m: mime, s: f.s },
        title: title,
        addedBy: me(),
        duration: isSafeInt(ex.durationMs, 1, MAX_DURATION_MS) ? ex.durationMs : 0
      }
      return commit({ type: 'add', track: track }).then((r) => (r.ok ? Object.assign({ trackId: track.id }, r) : r))
    }

    function currentState () {
      return roomState(controlRoom())
    }

    function simple (type, needCurrent) {
      const err = precheck(false)
      if (err) return rejected(err)
      const st = currentState()
      if (needCurrent && (!st || !st.current)) return rejected('nothing_playing')
      const op = { type: type }
      if (type === 'skip') op.id = st.current.id
      return commit(op)
    }

    function skip () {
      return simple('skip', true)
    }

    function pause () {
      return simple('pause', true)
    }

    // Ortak oturumu sürdürür. Bu cihazda yerel duraklatma (hold) varsa o da kaldırılır ve oynatıcı yeniden
    // eşitlenir. Ortak oturum zaten çalıyorsa sonuç noop yerine { ok: true, local: true } olur (müzik bu
    // cihazda devam etti, "zaten yapılmış" denmez).
    function resume () {
      const hadHold = local.hold && precheck(false) === null && Boolean(currentState() && currentState().current)
      if (hadHold) {
        clearHold()
        local.lastPlayAttempt = -Infinity
        local.lastSeek = -Infinity
        syncPlayer()
        changed()
      }
      return simple('resume', true).then((r) => (hadHold && r.ok && r.noop ? { ok: true, local: true } : r))
    }

    function stop () {
      const st = currentState()
      if (!precheck(false) && (!st || (!st.current && st.queue.length === 0))) return rejected('nothing_playing')
      return simple('stop', false)
    }

    function remove (trackId) {
      if (typeof trackId !== 'string' || !ID_RE.test(trackId)) return rejected('bad_track')
      const err = precheck(false)
      if (err) return rejected(err)
      return commit({ type: 'remove', id: trackId })
    }

    function move (trackId, toIndex) {
      if (typeof trackId !== 'string' || !ID_RE.test(trackId) || !isSafeInt(toIndex, 0, MAX_QUEUE)) return rejected('bad_track')
      const err = precheck(false)
      if (err) return rejected(err)
      return commit({ type: 'move', id: trackId, to: toIndex })
    }

    function queueView () {
      const st = currentState()
      return {
        current: st ? trackView(st.current) : null,
        queue: st ? st.queue.map(trackView) : [],
        playing: st ? st.playing : false,
        positionMs: st ? positionAt(st, clock.serverNow()) : 0
      }
    }

    // Yazılan metin bir DJ komutuysa uygular. DJ komutu değilse null döner (metin mesaj olarak gider).
    // ctx: { file } /çal ile birlikte gönderilen ses dosyası eki. Sonuç Promise<{ ok, code?, command, queue? }>.
    function runCommand (text, ctx) {
      const cmd = parseCommand(text)
      if (!cmd) return null
      const c = isObj(ctx) ? ctx : {}
      const tag = (p) => p.then((r) => Object.assign({ command: cmd.name }, r))
      if (cmd.error) return tag(rejected(cmd.error))
      if (cmd.name === 'play') {
        if (cmd.videoId) return tag(addYouTube(cmd.videoId))
        if (c.file) return tag(addFile(c.file))
        return tag(rejected('play_needs_source'))
      }
      if (cmd.name === 'queue') {
        if (!settings.supported) return tag(rejected('dj_unsupported'))
        if (!settings.enabled) return tag(rejected('dj_disabled'))
        if (controlRoom() === null) return tag(rejected('not_in_voice'))
        return tag(Promise.resolve({ ok: true, queue: queueView() }))
      }
      if (cmd.name === 'skip') return tag(skip())
      if (cmd.name === 'pause') return tag(pause())
      if (cmd.name === 'resume') return tag(resume())
      return tag(stop())
    }

    // ---------------------------------------------------------- oynatıcı yönetimi

    function youtubeApi () {
      if (opts.youtube) return opts.youtube
      return root.TelsizYouTube || null
    }

    function setStatus (status) {
      local.status = status
    }

    function pageHidden () {
      try {
        return Boolean(root.document) && root.document.visibilityState === 'hidden'
      } catch (e) {
        return false
      }
    }

    function clearHold () {
      local.hold = false
      local.holdReason = null
      local.holdHidden = false
    }

    function cancelRecovery () {
      if (recovery.handle !== null) timers.clearTimeout(recovery.handle)
      recovery.handle = null
    }

    // Kurtarma denemesi zamanlanır. Deneme sayısı parça başınadır (aynı parça yeniden kurulunca korunur).
    // repeatLast: beklemeler bitince son bekleme tekrarlanır, değilse deneme durur (sonuç false).
    function scheduleRecovery (trackId, delays, repeatLast, fn) {
      if (recovery.trackId !== trackId) {
        recovery.trackId = trackId
        recovery.attempts = 0
      }
      cancelRecovery()
      if (!repeatLast && recovery.attempts >= delays.length) return false
      const ms = delays[Math.min(recovery.attempts, delays.length - 1)]
      recovery.attempts++
      recovery.handle = timers.setTimeout(() => {
        recovery.handle = null
        if (!destroyed) fn()
      }, ms)
      return true
    }

    function stopPlayer () {
      timers.clearTimeout(leadHandle)
      leadHandle = null
      cancelRecovery()
      if (player) {
        const p = player
        player = null
        try {
          p.destroy()
        } catch (e) {
          // Yoksa sessiz
        }
        if (p.url) releaseUrl(p.url)
      }
      local.loadingTrack = null
      local.needsTap = false
      clearHold()
      local.hidden = false
      local.ended = false
      local.error = null
      local.failed = false
      local.positionMs = null
      local.driftMs = null
      local.lastPlayAttempt = -Infinity
      local.lastSeek = -Infinity
      local.playPendingSince = null
      local.bufferingSince = null
      local.awaitSettle = false
      local.settleSince = null
      local.seekIssuedAt = null
      local.seekFails = 0
      if (local.status !== 'blocked') setStatus('idle')
    }

    // Yanıt vermeyen YouTube oynatıcısı hâlâ hazır değilse baştan kurulur
    function rebuildIfStuck (trackId) {
      if (!player || player.trackId !== trackId || player.kind !== 'youtube' || player.ready() || local.error !== 'yt_unresponsive') return
      stopPlayer()
      reconcile()
      changed()
    }

    function hooksFor (room, track) {
      const alive = () => player && player.trackId === track.id
      return {
        ready: () => {
          if (!alive()) return
          // Geç de olsa hazır olan oynatıcı yanıt veriyor demektir
          if (local.error === 'yt_unresponsive') {
            local.error = null
            cancelRecovery()
          }
          setStatus('ready')
          applyAudioSettings()
          syncPlayer()
          changed()
        },
        ended: () => {
          if (!alive()) return
          const st = roomState(room)
          if (!st || !st.current || st.current.id !== track.id) return
          const pos = positionAt(st, clock.serverNow())
          const d = st.current.duration
          // Yerel oynatıcı erken bittiyse (bozuk atlama) ortak konum sona yakın olmalıdır
          if (d > 0 && pos < d - EARLY_END_MS) return
          // Parça bu cihazda bitti: geçiş gelene kadar yeniden başlatılmaz
          local.ended = true
          setStatus('ended')
          requestEnd(room, track.id)
          changed()
        },
        error: (code) => {
          if (!alive()) return
          const first = local.error !== code
          local.error = code
          setStatus('error')
          if (first) emitError(code, track.id, true)
          if (code === 'yt_unresponsive') {
            // Çerçeve kalır (geç de hazır olabilir), ayrıca sınırlı sayıda baştan kurulur
            scheduleRecovery(track.id, YT_REBUILD_MS, false, () => rebuildIfStuck(track.id))
          } else {
            // Kalıcı oynatıcı hatası: yeniden oynatma denenmez ve dokunma istenmez
            local.failed = true
            local.needsTap = false
            if (YT_SKIP_CODES.indexOf(code) !== -1) requestErrorSkip(room, track.id, code)
          }
          changed()
        },
        duration: (ms) => {
          if (alive()) requestAnnotate(room, track.id, { duration: ms })
        },
        title: (text) => {
          if (alive()) requestAnnotate(room, track.id, { title: text })
        },
        paused: () => {
          if (!alive()) return
          const st = roomState(room)
          if (st && st.playing && now() > local.ownPauseUntil && clock.serverNow() >= st.anchorAt) {
            // Oynatıcı bu motorun isteği olmadan durdu: ortak durum değişmez, bu cihaz zorlamaz. Sayfa
            // görünürken YouTube oynatıcısında durduran kişinin kendisidir. <audio> öğesi sayfada denetim
            // göstermez, onu tarayıcı, işletim sistemi veya medya tuşları durdurur.
            const hidden = pageHidden()
            local.hold = true
            local.holdReason = player.kind === 'youtube' && !hidden ? 'player' : 'device'
            local.holdHidden = hidden
            changed()
          }
        },
        played: () => {
          if (!alive()) return
          // Motorun atlama veya oynatma isteğinden çalmaya başlayana kadar geçen süre (YouTube'un yükleme süresi)
          if (local.seekIssuedAt !== null) {
            learnLead(player.kind, now() - local.seekIssuedAt)
            local.seekIssuedAt = null
          }
          clearHold()
          local.needsTap = false
          local.bufferingSince = null
          // Çalan oynatıcı hata durumunda değildir
          if (local.error !== null || local.failed) {
            local.error = null
            local.failed = false
            cancelRecovery()
          }
          changed()
        },
        blocked: () => {
          // Tarayıcı oynatmayı engelledi (YouTube onAutoplayBlocked)
          if (!alive() || local.failed) return
          if (!local.needsTap) {
            local.needsTap = true
            emit('tapneeded', { room: deviceRoom, trackId: track.id })
          }
          changed()
        }
      }
    }

    function startPlayer (room, track) {
      if (recovery.trackId !== track.id) {
        recovery.trackId = track.id
        recovery.attempts = 0
      }
      local.error = null
      local.failed = false
      local.corrections = 0
      if (track.type === 'youtube') {
        const YT = youtubeApi()
        if (!YT || typeof YT.create !== 'function') {
          local.error = 'yt_unavailable'
          setStatus('error')
          emitError('yt_unavailable', track.id, true)
          return
        }
        const hooks = hooksFor(room, track)
        let impl
        try {
          impl = YT.create({
            container: host,
            videoId: track.videoId,
            pageOrigin: root.location ? root.location.origin : '',
            lang: root.I18N && typeof root.I18N.lang === 'string' ? root.I18N.lang : '',
            title: typeof opts.t === 'function' ? opts.t('music.playerFrameTitle') : '',
            now: now,
            timers: timers,
            onEvent: (ev) => onYouTubeEvent(ev, hooks)
          })
        } catch (e) {
          local.error = 'yt_unavailable'
          setStatus('error')
          emitError('yt_unavailable', track.id, true)
          return
        }
        player = wrapYouTube(track, impl)
        setStatus('loading')
        return
      }
      beginFileLoad(room, track)
    }

    // Dosya parçası: yer tutucu oynatıcı kurulur, dosya indirilip çözülünce <audio> oynatıcısı gelir
    function beginFileLoad (room, track) {
      const key = fileCacheKey(track.file)
      player = {
        kind: 'file',
        trackId: track.id,
        loading: true,
        loadKey: key,
        ready: () => false,
        playing: () => false,
        buffering: () => false,
        canSeekPaused: () => true,
        durationMs: () => 0,
        position: () => null,
        play: () => Promise.resolve('error'),
        pause: () => {},
        seek: () => {},
        setVolume: () => {},
        setMuted: () => {},
        visible: () => true,
        destroy: () => {}
      }
      if (local.error === null) setStatus('loading')
      local.loadingTrack = track.id
      loadFile(track).then((result) => onFileLoaded(room, track, key, result))
    }

    function onFileLoaded (room, track, key, result) {
      if (destroyed || !player || player.trackId !== track.id || !player.loading || player.loadKey !== key) return
      if (!result.ok) {
        if (result.code === 'cancelled') {
          // İndirme bu oynatıcı istemeden önce bırakılmıştı: yeniden başlatılır
          beginFileLoad(room, track)
          return
        }
        if (result.code === 'file_decrypt_failed' && decryptRetried !== track.id) {
          // Bozuk bir indirme de çözülemez: önbelleğe alınmamış dosya bir kez daha indirilir
          decryptRetried = track.id
          beginFileLoad(room, track)
          return
        }
        const first = local.error !== result.code
        local.error = result.code
        setStatus('error')
        if (first) emitError(result.code, track.id, true)
        if (result.transient) {
          // Geçici hata (ağ, 408, 429, 5xx): parça çalarken artan beklemelerle yeniden denenir
          scheduleRecovery(track.id, FILE_RETRY_MS, true, () => {
            if (player && player.trackId === track.id && player.loading && player.loadKey === key) beginFileLoad(room, track)
          })
        } else if (result.code === 'file_bad_type' || result.code === 'file_decrypt_failed') {
          // Çözülen içerik (veya iki kez çözülemeyen dosya) her cihazda aynıdır, parça hiçbir cihazda
          // çalınamaz: herkes için geçilir. Cihaza veya kişiye özgü hatalarda (biçim desteği, indirme izni)
          // parça geçilmez.
          requestErrorSkip(room, track.id, result.code)
        }
        changed()
        return
      }
      player = createAudioPlayer(env, track, result.url, hooksFor(room, track))
      local.loadingTrack = null
      local.error = null
      cancelRecovery()
      setStatus('loading')
      applyAudioSettings()
      changed()
    }

    function onYouTubeEvent (ev, hooks) {
      if (!isObj(ev)) return
      if (ev.type === 'ready') hooks.ready()
      else if (ev.type === 'ended') hooks.ended()
      else if (ev.type === 'duration' && isFiniteNumber(ev.ms)) hooks.duration(Math.round(ev.ms))
      else if (ev.type === 'title' && typeof ev.text === 'string') hooks.title(ev.text)
      else if (ev.type === 'paused') hooks.paused()
      else if (ev.type === 'playing') hooks.played()
      else if (ev.type === 'blocked') hooks.blocked()
      else if (ev.type === 'error') hooks.error(hasOwn(YT_ERRORS, ev.code) ? YT_ERRORS[ev.code] : 'yt_player_error')
      else if (ev.type === 'unresponsive') hooks.error('yt_unresponsive')
    }

    function wrapYouTube (track, impl) {
      const ytState = () => (typeof impl.state === 'function' ? impl.state() : null)
      return {
        kind: 'youtube',
        trackId: track.id,
        ready: () => impl.ready(),
        playing: () => impl.playing(),
        buffering: () => ytState() === YT_BUFFERING,
        // IFrame Player API belgesi: seekTo duraklatılmış oynatıcıyı duraklatılmış bırakır, başka bir
        // durumdan (başlamamış, hazırlanmış, bitmiş) çağrılırsa videoyu oynatır
        canSeekPaused: () => ytState() === YT_PAUSED,
        durationMs: () => (typeof impl.durationMs === 'function' ? impl.durationMs() : 0),
        position: () => impl.position(),
        play: () => impl.play(),
        pause: () => impl.pause(),
        seek: (ms) => impl.seek(ms),
        setVolume: (v) => impl.setVolume(Math.round(Math.max(0, Math.min(1, v)) * 100)),
        setMuted: (m) => impl.setMuted(m === true),
        visible: () => impl.visible(),
        element: () => impl.element(),
        destroy: () => impl.destroy()
      }
    }

    // ---------------------------------------------------------- dosya önbelleği ve indirmeler

    function fileCacheKey (f) {
      return f.u + '.' + f.k
    }

    // Şu an çalınmak istenen dosyanın anahtarı (yalnızca yükleniyorsa)
    function wantedLoadKey () {
      return player && player.loading ? player.loadKey : null
    }

    // Blob adresi ne önbellekte ne de çalan oynatıcıda kullanılıyorsa bırakılır
    function releaseUrl (url) {
      if (!url || (player && player.url === url)) return
      let cached = false
      fileCache.forEach((entry) => {
        if (entry.url === url) cached = true
      })
      if (cached) return
      try {
        env.revokeObjectURL(url)
      } catch (e) {
        // Zaten bırakılmış
      }
    }

    function cacheGet (key) {
      const entry = fileCache.get(key)
      if (!entry) return null
      fileCache.delete(key)
      fileCache.set(key, entry)
      return entry
    }

    function cachePut (key, entry) {
      fileCache.set(key, entry)
      while (fileCache.size > FILE_CACHE_MAX) {
        const oldest = fileCache.keys().next().value
        const old = fileCache.get(oldest)
        fileCache.delete(oldest)
        // Çalan oynatıcının adresi önbellekten çıksa da oynatıcı kapanınca bırakılır (stopPlayer)
        if (old) releaseUrl(old.url)
      }
    }

    // Aynı dosyanın eşzamanlı istekleri tek indirmeyi paylaşır. Sonuç { ok, url } veya
    // { ok: false, code, transient? }. code 'cancelled': indirme bitince dosya artık istenmiyordu.
    function loadFile (track) {
      const f = track.file
      const key = fileCacheKey(f)
      const cached = cacheGet(key)
      if (cached) return Promise.resolve({ ok: true, url: cached.url })
      const running = loads.get(key)
      if (running) return running.promise
      if (typeof transport.download !== 'function') return Promise.resolve({ ok: false, code: 'file_unavailable', transient: false })
      const rec = { promise: null, req: null }
      try {
        rec.req = transport.download(f.u, {})
      } catch (e) {
        rec.req = null
      }
      rec.promise = Promise.resolve(rec.req).then((res) => res, () => null).then((res) => {
        if (loads.get(key) === rec) loads.delete(key)
        return finishLoad(key, f, res)
      })
      loads.set(key, rec)
      return rec.promise
    }

    function finishLoad (key, f, res) {
      // Geçilen parçanın dosyası çözülmez ve blob adresi üretilmez
      if (destroyed || wantedLoadKey() !== key) return { ok: false, code: 'cancelled' }
      if (!res || res.status !== 200 || !res.data || toStr.call(res.data) !== '[object ArrayBuffer]') {
        const status = res && typeof res.status === 'number' ? res.status : 0
        const transient = status === 0 || status === 408 || status === 429 || status >= 500
        return { ok: false, code: status === 0 ? 'network' : 'file_unavailable', transient: transient }
      }
      let plain = null
      try {
        plain = env.decryptFile(new Uint8Array(res.data), f.k, f.n)
      } catch (e) {
        plain = null
      }
      if (!plain) return { ok: false, code: 'file_decrypt_failed' }
      const sniffed = sniffAudio(plain)
      if (!sniffed) return { ok: false, code: 'file_bad_type' }
      if (env.canPlayType(sniffed) === '') return { ok: false, code: 'file_unsupported' }
      let url
      try {
        url = env.createObjectURL(env.makeBlob(plain, sniffed))
      } catch (e) {
        return { ok: false, code: 'file_media_error' }
      }
      cachePut(key, { url: url })
      return { ok: true, url: url }
    }

    // Artık istenmeyen indirmeler iptal edilir (taşıma abort() veriyorsa)
    function pruneLoads () {
      const want = destroyed ? null : wantedLoadKey()
      Array.from(loads.keys()).forEach((key) => {
        if (key === want) return
        const rec = loads.get(key)
        loads.delete(key)
        if (rec && rec.req && typeof rec.req.abort === 'function') {
          try {
            rec.req.abort()
          } catch (e) {
            // İstek zaten bitmiş
          }
        }
      })
    }

    // ---------------------------------------------------------- eşitleme

    function listenState () {
      return deviceRoom === null ? null : roomState(deviceRoom)
    }

    // İstenen oynatıcıyı belirler, gerekirse yenisini kurar ve eşitler
    function reconcile () {
      if (destroyed) return
      const room = deviceRoom
      const st = listenState()
      let want = null
      let blocked = null
      if (room !== null && st && st.current) {
        if (!settings.supported || !settings.enabled) {
          blocked = 'dj_disabled'
        } else if (st.current.type === 'youtube') {
          if (!settings.youtube) blocked = 'youtube_disabled'
          else if (consentValue() !== 'granted') blocked = 'consent'
          else if (!host) blocked = 'no_player_host'
          else want = st.current
        } else {
          want = st.current
        }
      } else if (room !== null && (!settings.supported || !settings.enabled)) {
        blocked = 'dj_disabled'
      }
      local.blocked = blocked
      if (blocked === 'consent' && consentValue() === 'unset' && consentAskedFor !== st.current.id) {
        consentAskedFor = st.current.id
        emit('consentneeded', { room: room, trackId: st.current.id })
      }
      if (!want) {
        stopPlayer()
        setStatus(blocked ? 'blocked' : 'idle')
        pruneLoads()
        return
      }
      if (!player || player.trackId !== want.id || player.kind !== want.type) {
        stopPlayer()
        startPlayer(room, want)
      }
      pruneLoads()
      syncPlayer()
    }

    function leadFor (kind) {
      return kind === 'youtube' ? seekLead.youtube : seekLead.file
    }

    // Ölçülen atlama gecikmesi sonraki atlamalarda telafi edilir (hedefin bu kadar ilerisine atlanır)
    function learnLead (kind, ms) {
      if (!isFiniteNumber(ms) || ms < 0 || ms > MAX_SEEK_LEAD_MS) return
      const k = kind === 'youtube' ? 'youtube' : 'file'
      seekLead[k] = seekLeadSamples[k] === 0 ? Math.round(ms) : Math.round((seekLead[k] + ms) / 2)
      seekLeadSamples[k]++
    }

    function seekCooldown () {
      return Math.min(SEEK_BACKOFF_MAX_MS, SEEK_COOLDOWN_MS * Math.pow(2, Math.min(local.seekFails, 4)))
    }

    // Çalması istenen konum: ortak konum + atlama gecikmesi telafisi, süre biliniyorsa onunla sınırlı
    function aimFor (st, target) {
      let aim = target + leadFor(player.kind)
      const d = st.current.duration
      if (d > 0 && aim > d) aim = d
      return aim
    }

    // Motorun kendi atlaması veya oynatma isteği: oynatıcı yeniden çalıp oturana kadar sapma ölçülmez.
    // correction: konum düzeltmesi (oturduktan sonra hâlâ sapma varsa başarısız sayılır, bekleme uzar).
    function markSeek (at, correction) {
      if (correction === true) local.lastSeek = at
      local.awaitSettle = true
      local.settleSince = null
      local.seekIssuedAt = at
      local.settleAfterCorrection = correction === true
    }

    function syncPlayer () {
      if (destroyed || !player || player.loading || !player.ready()) return
      const st = listenState()
      if (!st || !st.current || st.current.id !== player.trackId) return
      const t = clock.serverNow()
      const target = positionAt(st, t)
      const local0 = now()
      const pos = player.position()
      local.positionMs = pos
      local.driftMs = pos === null ? null : pos - target
      if (player.kind === 'youtube' && !player.visible()) {
        // Oynatıcı görünür değilse YouTube bu cihazda çalınmaz (gizli arka plan oynatımı yok)
        if (!local.hidden) {
          local.hidden = true
          changed()
        }
        if (player.playing()) {
          local.ownPauseUntil = local0 + OWN_PAUSE_MS
          player.pause()
        }
        setStatus('paused')
        return
      }
      if (local.hidden) {
        local.hidden = false
        local.lastPlayAttempt = -Infinity
        changed()
      }
      if (local.failed) {
        // Oynatıcı kalıcı bir hata bildirdi: oynatma yeniden denenmez (dokunmak bunu düzeltmez)
        setStatus('error')
        return
      }
      const started = st.playing && t >= st.anchorAt
      if (st.playing && !started) {
        timers.clearTimeout(leadHandle)
        leadHandle = timers.setTimeout(() => {
          leadHandle = null
          syncPlayer()
        }, Math.max(10, Math.ceil(st.anchorAt - t)))
      }
      if (started) {
        if (local.ended) return
        if (local.hold) {
          setStatus('paused')
          return
        }
        if (!player.playing()) {
          local.settleSince = null
          if (local.needsTap) return
          // Önceki oynatma isteğinin sonucu bekleniyor veya oynatıcı yükleniyor: yeniden atlanmaz
          if (local.playPendingSince !== null && local0 - local.playPendingSince < BUFFER_STALL_MS) return
          if (local.bufferingSince === null && player.buffering()) local.bufferingSince = local0
          if (local.bufferingSince !== null) {
            if (local0 - local.bufferingSince < BUFFER_STALL_MS) {
              setStatus('loading')
              return
            }
            // Yükleme takıldı: yeniden denenir
            local.bufferingSince = null
            local.lastPlayAttempt = -Infinity
          }
          if (local0 - local.lastPlayAttempt < PLAY_RETRY_MS) return
          local.lastPlayAttempt = local0
          const aim = aimFor(st, target)
          if (pos === null || Math.abs(pos - aim) > 250) player.seek(aim)
          markSeek(local0)
          local.playPendingSince = local0
          const trackId = player.trackId
          player.play().then((result) => {
            if (!player || player.trackId !== trackId) return
            local.playPendingSince = null
            if (local.failed) return
            if (result === 'blocked') {
              if (!local.needsTap) {
                local.needsTap = true
                emit('tapneeded', { room: deviceRoom, trackId: trackId })
              }
              changed()
            } else if (result === 'ok') {
              local.needsTap = false
              if (player.playing()) {
                // Başarılı oynatmadan sonra yeniden deneme beklemesi sıfırlanır (sonraki devam hemen uygulanır)
                local.lastPlayAttempt = -Infinity
                setStatus('playing')
              } else if (local.bufferingSince === null) {
                // İstek kabul edildi, oynatıcı hâlâ yükleniyor
                local.bufferingSince = now()
              }
              changed()
            }
          })
          return
        }
        local.bufferingSince = null
        setStatus('playing')
        if (local.awaitSettle) {
          if (local.settleSince === null) local.settleSince = local0
          if (local0 - local.settleSince < SETTLE_MS) return
          local.awaitSettle = false
          local.seekIssuedAt = null
          if (pos !== null) {
            if (Math.abs(pos - target) <= DRIFT_LIMIT_MS) local.seekFails = 0
            else if (local.settleAfterCorrection) local.seekFails++
          }
        }
        if (pos !== null && Math.abs(pos - target) > DRIFT_LIMIT_MS && local0 - local.lastSeek >= seekCooldown()) {
          local.corrections++
          player.seek(aimFor(st, target))
          markSeek(local0, true)
          // Atlamadan sonra oynatıcı kısa süre yüklenir: bu sırada yeniden atlanmaz ve oynatma istenmez
          // (oynatıcı yükleme durumunu bildirmese de)
          local.bufferingSince = local0
        }
        return
      }
      if (player.playing()) {
        local.ownPauseUntil = local0 + OWN_PAUSE_MS
        player.pause()
      }
      clearHold()
      setStatus('paused')
      // Duraklatılmış oturumda konum yalnızca atlama oynatmayı başlatmayacaksa düzeltilir
      if (pos !== null && Math.abs(pos - target) > DRIFT_LIMIT_MS && local0 - local.lastSeek >= SEEK_COOLDOWN_MS && player.canSeekPaused()) {
        local.lastSeek = local0
        player.seek(target)
      }
    }

    // Bu cihazda parçayı çalan hazır bir oynatıcı var mı
    function playingHere (trackId) {
      return deviceRoom !== null && deviceRoom === controlRoom() && Boolean(player) && player.trackId === trackId &&
        !player.loading && player.ready() && !local.failed
    }

    // Parça sonu yedeği: süre biliniyorsa ve ortak konum sonu geçtiyse odadaki her istemci geçişi ister
    // (oynatıcısı olmayanlar, örneğin YouTube rızası vermeyenler de). Sunucu CAS'ı tek geçişi garanti eder.
    // Süre bilinmiyorsa ve parça uzun süredir çaldığı hâlde hiçbir cihaz süresini bildirmediyse odada onu
    // çalabilen yoktur: arkasında kuyruk varsa, bu cihazda da çalmıyorsa herkes için geçilir (no_listener).
    function endFallback () {
      const room = controlRoom()
      const st = roomState(room)
      if (!st || !st.current || !st.playing) return
      const elapsed = st.anchorPos + (clock.serverNow() - st.anchorAt)
      const d = st.current.duration
      if (d > 0) {
        if (elapsed >= d + END_GRACE_MS) requestEnd(room, st.current.id)
        return
      }
      if (st.queue.length > 0 && elapsed >= UNPLAYED_SKIP_MS && !playingHere(st.current.id)) {
        requestErrorSkip(room, st.current.id, 'no_listener')
      }
    }

    // Bu cihazın oynatıcısı süreyi biliyor ama ortak durumda süre yoksa (açıklama yazımı başarısız olduysa)
    // açıklama yeniden istenir
    function retryAnnotate () {
      if (!player || player.loading || !player.ready()) return
      const st = listenState()
      if (!st || !st.current || st.current.id !== player.trackId || st.current.duration !== 0) return
      const ms = Math.round(player.durationMs())
      if (isSafeInt(ms, 1, MAX_DURATION_MS)) requestAnnotate(deviceRoom, player.trackId, { duration: ms })
    }

    // İzin Ayarlar > Gizlilik'ten veya başka bir sekmeden değişmiş olabilir
    function checkConsent () {
      const consentNow = consentValue()
      if (consentNow === lastConsent) return
      lastConsent = consentNow
      consentAskedFor = null
      reconcile()
      changed()
    }

    function tick () {
      if (destroyed) return
      checkConsent()
      syncPlayer()
      endFallback()
      retryAnnotate()
      const room = controlRoom()
      const st = roomState(room)
      const t = now()
      if (st && st.current && t - lastPositionEvent >= POSITION_EVENT_MS) {
        lastPositionEvent = t
        emit('position', { room: room, trackId: st.current.id, positionMs: positionAt(st, clock.serverNow()), durationMs: st.current.duration, playing: st.playing })
      }
      const key = player ? player.trackId + ':' + local.status : ''
      if (key !== lastTrackKey) {
        lastTrackKey = key
        changed()
      }
    }

    function restartTicker () {
      const want = !destroyed && controlRoom() !== null
      if (want && tickHandle === null) tickHandle = timers.setInterval(tick, TICK_MS)
      if (!want && tickHandle !== null) {
        timers.clearInterval(tickHandle)
        tickHandle = null
      }
    }

    // Başka bir sekmede localStorage değişti (aynı sekmede storage olayı gelmez, onu tick yakalar). İzin orada
    // geri alındıysa (anahtar silindi) ortak saklamanın bellekteki kopyası da silinir, yoksa eski değer
    // geri almayı gölgeler.
    function onStorage (ev) {
      if (destroyed || !ev || (ev.key !== KEY_CONSENT && ev.key !== null)) return
      let raw = null
      try {
        if (ev.storageArea && ev.storageArea !== root.localStorage) return
        raw = root.localStorage.getItem(KEY_CONSENT)
      } catch (e) {
        return
      }
      if (raw === null && storage.get(KEY_CONSENT) !== null && typeof storage.remove === 'function') storage.remove(KEY_CONSENT)
      checkConsent()
    }

    // Sayfa yeniden görünür oldu: duraklama sayfa görünmezken olduysa (arka plana geçiş, sistem) kendiliğinden
    // yeniden eşitlenir
    function onVisibility () {
      if (destroyed || pageHidden()) return
      if (local.hold && local.holdHidden) resync()
      else syncPlayer()
    }

    // Oynatıcı alanı: YouTube çerçevesi buraya eklenir. Alan en az 200x200 piksel ve görünür olmalıdır.
    function attachPlayer (container) {
      if (!container || typeof container.appendChild !== 'function') return
      if (host === container) return
      host = container
      if (player && player.kind === 'youtube') stopPlayer()
      reconcile()
      changed()
    }

    function detachPlayer () {
      host = null
      if (player && player.kind === 'youtube') stopPlayer()
      reconcile()
      changed()
    }

    // Kendiliğinden oynatma engellendiyse kullanıcı hareketi içinde çağrılır (play() eşzamanlı çağrılır)
    function unlock () {
      local.needsTap = false
      clearHold()
      local.lastPlayAttempt = -Infinity
      if (player && !player.loading && player.ready() && !local.failed) {
        const st = listenState()
        if (st && st.current && st.current.id === player.trackId && st.playing && clock.serverNow() >= st.anchorAt) {
          const at = now()
          local.lastPlayAttempt = at
          local.bufferingSince = null
          player.seek(aimFor(st, positionAt(st, clock.serverNow())))
          markSeek(at)
          local.playPendingSince = at
          const trackId = player.trackId
          player.play().then((result) => {
            if (!player || player.trackId !== trackId) return
            local.playPendingSince = null
            if (result === 'blocked') {
              local.needsTap = true
              emit('tapneeded', { room: deviceRoom, trackId: trackId })
            } else if (result === 'ok') {
              setStatus(player.playing() ? 'playing' : 'loading')
              if (!player.playing() && local.bufferingSince === null) local.bufferingSince = now()
            }
            changed()
          })
        }
      }
      changed()
    }

    // Yerel duraklatmayı (hold) kaldırır ve yeniden eşitler. Hata durumundaki oynatıcı (indirme hatası,
    // yanıt vermeyen veya hata bildiren YouTube oynatıcısı) baştan kurulur, dosya yeniden indirilir.
    function resync () {
      if (destroyed) return
      clearHold()
      local.lastSeek = -Infinity
      local.lastPlayAttempt = -Infinity
      local.playPendingSince = null
      local.bufferingSince = null
      local.seekFails = 0
      if (player && (local.error !== null || local.failed)) {
        recovery.attempts = 0
        stopPlayer()
      }
      reconcile()
      changed()
    }

    function destroy () {
      destroyed = true
      if (tickHandle !== null) timers.clearInterval(tickHandle)
      tickHandle = null
      stopPlayer()
      pruneLoads()
      fileCache.forEach((entry) => {
        try {
          env.revokeObjectURL(entry.url)
        } catch (e) {
          // Zaten bırakılmış
        }
      })
      fileCache.clear()
      try {
        if (typeof root.removeEventListener === 'function') root.removeEventListener('storage', onStorage)
        if (root.document && typeof root.document.removeEventListener === 'function') root.document.removeEventListener('visibilitychange', onVisibility)
      } catch (e) {
        // Yoksa sessiz
      }
      Object.keys(listeners).forEach((k) => {
        listeners[k] = []
      })
    }

    try {
      if (typeof root.addEventListener === 'function') root.addEventListener('storage', onStorage)
      if (root.document && typeof root.document.addEventListener === 'function') root.document.addEventListener('visibilitychange', onVisibility)
    } catch (e) {
      // Olay dinlenemiyorsa izin değişikliği tick ile, görünürlük eşitlemesi resync() ile yapılır
    }

    return Object.freeze({
      ingest: ingest,
      pollParam: pollParam,
      reset: reset,
      handleMeta: handleMeta,
      setVoiceRoom: setVoiceRoom,
      attachPlayer: attachPlayer,
      detachPlayer: detachPlayer,
      snapshot: snapshot,
      roomView: roomView,
      activeRooms: activeRooms,
      on: on,
      addYouTube: addYouTube,
      addFile: addFile,
      remove: remove,
      move: move,
      skip: skip,
      pause: pause,
      resume: resume,
      stop: stop,
      queue: queueView,
      runCommand: runCommand,
      consent: consentValue,
      setConsent: setConsent,
      setVolume: setVolume,
      setMuted: setMuted,
      unlock: unlock,
      resync: resync,
      serverNow: () => clock.serverNow(),
      destroy: destroy
    })
  }

  // iOS'ta HTMLMediaElement.volume yalnızca okunur (Apple: "The volume property is not settable in
  // JavaScript. Reading the volume property always returns 1."). Deneme öğesine yazılan değer geri
  // okunamıyorsa ses seviyesi bu cihazda ayarlanamaz.
  function defaultProbeVolume () {
    try {
      const a = root.document.createElement('audio')
      a.volume = 0.5
      return typeof a.volume !== 'number' || Math.abs(a.volume - 0.5) < 0.01
    } catch (e) {
      return true
    }
  }

  function defaultCanPlayType (type) {
    try {
      const a = root.document.createElement('audio')
      return typeof a.canPlayType === 'function' ? a.canPlayType(type) : 'maybe'
    } catch (e) {
      return 'maybe'
    }
  }

  // Mesajdaki dosya ekinin DJ'de çalınabilecek bir ses dosyası olup olmadığı ("DJ'de çal" düğmesi için)
  function isAudioAttachment (f) {
    if (!isObj(f) || f.kind === 'image') return false
    return normalizeAudioType(f.m, f.name) !== null
  }

  return Object.freeze({
    VERSION: VERSION,
    LIMITS: Object.freeze({
      maxQueue: MAX_QUEUE,
      maxTitle: MAX_TITLE,
      maxEnvChars: MAX_ENV_CHARS,
      driftLimitMs: DRIFT_LIMIT_MS,
      startLeadMs: START_LEAD_MS,
      endGraceMs: END_GRACE_MS,
      maxDurationMs: MAX_DURATION_MS
    }),
    AUDIO_TYPES: Object.freeze(AUDIO_TYPES.slice()),
    COMMANDS: Object.freeze(Object.keys(COMMANDS).reduce((acc, k) => {
      acc[k] = Object.freeze(COMMANDS[k].slice())
      return acc
    }, {})),
    create: create,
    createHttpTransport: createHttpTransport,
    createClock: createClock,
    parseYouTubeUrl: parseYouTubeUrl,
    parseCommand: parseCommand,
    validateState: validateState,
    positionAt: positionAt,
    applyOp: applyOp,
    sniffAudio: sniffAudio,
    normalizeAudioType: normalizeAudioType,
    isAudioAttachment: isAudioAttachment,
    cleanText: cleanText
  })
})(typeof self !== 'undefined' ? self : this)
