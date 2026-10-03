'use strict'

// Sohbet v2 istemcisi.
// PS5 tarayıcısı da desteklendiği için yalnızca ES2017 sözdizimi, XMLHttpRequest ve
// HTTP long-polling kullanılır. DOM yalnızca createElement ve textContent ile kurulur.
// Kod tek bir blok içinde durur, böylece genel ad alanına değişken eklenmez.

{
  const API_TIMEOUT_MS = 20000
  const POLL_TIMEOUT_MS = 35000
  const TRANSFER_TIMEOUT_MS = 15 * 60 * 1000
  const INFO_RETRY_MS = 3000
  const GROUP_WINDOW_MS = 5 * 60 * 1000
  const STICK_PX = 150
  const PAGE_SIZE = 50
  const MAX_RENDERED = 600
  const TRIM_TO = 500
  const IMAGE_CACHE_MAX = 100
  const IMAGE_BOX_MAX = 360
  const PHOTO_MAX_EDGE = 2560
  const JPEG_QUALITY = 0.85
  const UPLOAD_RETRY_MAX = 3
  const UPLOAD_RETRY_MS = 2000
  const UPLOAD_PARALLEL = 2
  const IMAGE_PARALLEL = 3
  const TOAST_MS = 5000
  const RECENT_EMOJI_MAX = 24
  const COUNTER_FROM = 1800
  const REVOKE_DELAY_MS = 60000
  const SVG_NS = 'http://www.w3.org/2000/svg'
  const XLINK_NS = 'http://www.w3.org/1999/xlink'
  const UPLOAD_ID_RE = /^[0-9a-f]{32}$/
  const KID_RE = /^[0-9a-f]{16}$/
  const B64URL_RE = /^[A-Za-z0-9_-]+$/
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
  const IMAGE_EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
  const EXEC_EXT = ['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'pif', 'ps1', 'psm1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'hta', 'jar', 'apk', 'appx', 'msix', 'sh', 'command', 'app', 'dmg', 'pkg', 'lnk', 'reg', 'cpl', 'dll', 'iso', 'img']
  const FILE_KINDS = {
    doc: ['pdf', 'doc', 'docx', 'odt', 'rtf', 'txt', 'md', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'epub', 'pages', 'numbers', 'key'],
    archive: ['zip', 'rar', '7z', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'cab'],
    audio: ['mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'opus', 'wma', 'mid', 'midi'],
    video: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'm4v', 'wmv', 'flv', '3gp', 'mpg', 'mpeg'],
    code: ['js', 'mjs', 'ts', 'py', 'java', 'c', 'cpp', 'h', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'html', 'htm', 'css', 'json', 'xml', 'yml', 'yaml', 'toml', 'ini', 'sh', 'bat', 'cmd', 'ps1', 'sql', 'lua', 'kt', 'swift', 'log'],
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic', 'heif', 'tif', 'tiff', 'ico', 'avif']
  }
  const FILE_ICONS = { doc: 'i-file-doc', archive: 'i-file-archive', audio: 'i-file-audio', video: 'i-file-video', code: 'i-file-code', image: 'i-file-image', other: 'i-file' }
  const AVATAR_COLORS = 8
  const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık']
  const DAYS = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']

  const KEYS = {
    token: 'sohbet.token',
    recentEmoji: 'sohbet.emoji.recent',
    notify: 'sohbet.notify',
    peerVolume: 'sohbet.peerVolume',
    mic: 'sohbet.mic',
    invite: 'sohbet.invite'
  }

  const TEXT = {
    connecting: 'Bağlanılıyor...',
    unreachable: 'Sunucuya ulaşılamadı.',
    unreachableRetry: 'Sunucuya ulaşılamadı. Yeniden deneniyor...',
    reconnecting: 'Bağlantı koptu, yeniden deneniyor...',
    sessionEnded: 'Oturum sona erdi, lütfen yeniden giriş yapın.',
    banned: 'Bu hesap engellendi.',
    noCrypto: 'Şifreleme bileşeni yüklenemedi veya bu tarayıcı güvenli rastgele sayı üretemiyor. Sayfayı yenileyin.',
    noKeyMessage: '[Şifreli mesaj, anahtar yok]',
    unverified: 'Doğrulanamayan mesaj',
    badFormat: 'Mesaj biçimi tanınmadı',
    keyNeeded: 'Mesaj göndermek için şifreleme anahtarı gerekli',
    noActiveKey: 'Sunucuda henüz şifreleme anahtarı yok. Sahip veya yönetici anahtar oluşturmalı.',
    edited: '(düzenlendi)',
    execBadge: 'Çalıştırılabilir dosya',
    execConfirm: 'Bu dosya cihazınızda program çalıştırabilir. Yalnızca gönderene güveniyorsanız indirin.',
    imageFailed: 'Resim açılamadı',
    photoFailed: 'Fotoğraf işlenemedi.',
    unknownUser: 'Bilinmeyen kullanıcı',
    voiceInsecure: 'Sesli sohbet yalnızca https:// ile başlayan adreste çalışır. Tünel adresini kullanın.',
    voiceUnsupported: 'Bu tarayıcı sesli sohbeti desteklemiyor. PS5\'teysen telefonunun tarayıcısından katılabilirsin.',
    voiceNoKey: 'Sesli sohbet için şifreleme anahtarı gerekli.',
    voiceFailedPeer: 'Ses bağlantısı kurulamadı',
    copied: 'Kopyalandı.',
    copyFailed: 'Kopyalanamadı. Metni seçip elle kopyalayın.'
  }

  const ROLE_LABELS = { owner: 'sahip', admin: 'yönetici', member: 'üye' }

  // Kalıcı depolama. localStorage veya sessionStorage kullanılamazsa bellekte devam edilir.

  const memoryStore = { local: Object.create(null), session: Object.create(null) }

  function storageArea (kind) {
    return kind === 'session' ? window.sessionStorage : window.localStorage
  }

  function storeGet (key, kind) {
    const k = kind || 'local'
    try {
      const value = storageArea(k).getItem(key)
      if (typeof value === 'string') return value
    } catch (err) {
      // Depolama kapalı, bellekteki kopyaya bakılır
    }
    const mem = memoryStore[k][key]
    return typeof mem === 'string' ? mem : null
  }

  function storeSet (key, value, kind) {
    const k = kind || 'local'
    memoryStore[k][key] = String(value)
    try {
      storageArea(k).setItem(key, String(value))
    } catch (err) {
      // Değer yalnızca bellekte kalır
    }
  }

  function storeRemove (key, kind) {
    const k = kind || 'local'
    delete memoryStore[k][key]
    try {
      storageArea(k).removeItem(key)
    } catch (err) {
      // Bellekteki kopya zaten silindi
    }
  }

  function storeGetJson (key, fallback) {
    const raw = storeGet(key)
    if (!raw) return fallback
    try {
      const value = JSON.parse(raw)
      return value && typeof value === 'object' ? value : fallback
    } catch (err) {
      return fallback
    }
  }

  function storeSetJson (key, value) {
    try {
      storeSet(key, JSON.stringify(value))
    } catch (err) {
      // Serileştirilemeyen değer yazılmaz
    }
  }

  // Sunucu istekleri. Dönen Promise reddedilmez, ağ hatası, zaman aşımı ve
  // iptalde status 0 olur. Promise üzerinde abort() bulunur.

  function parseJson (text) {
    if (typeof text !== 'string' || text === '') return null
    try {
      const value = JSON.parse(text)
      return value && typeof value === 'object' ? value : null
    } catch (err) {
      return null
    }
  }

  function bufferToText (buffer) {
    try {
      if (!buffer || !buffer.byteLength) return ''
      return window.E2EE.utf8.decode(new Uint8Array(buffer))
    } catch (err) {
      return ''
    }
  }

  function abortXhr (xhr) {
    if (!xhr) return
    try {
      xhr.abort()
    } catch (err) {
      // İstek zaten bitmiş olabilir
    }
  }

  function request (method, path, options) {
    const opts = options || {}
    const timeoutMs = opts.timeout || API_TIMEOUT_MS
    let xhr = null
    const promise = new Promise((resolve) => {
      let settled = false
      let backupTimer = 0
      const settle = (status, data, aborted) => {
        if (settled) return
        settled = true
        clearTimeout(backupTimer)
        resolve({ status: status, data: data, aborted: aborted === true })
      }
      try {
        xhr = new XMLHttpRequest()
        xhr.open(method, path, true)
        try {
          xhr.timeout = timeoutMs
        } catch (err) {
          // Yedek zamanlayıcı devreye girer
        }
        if (opts.responseType) xhr.responseType = opts.responseType
        const token = opts.token === undefined ? state.token : opts.token
        if (token) xhr.setRequestHeader('X-Token', token)
        let payload = null
        if (opts.binary) {
          xhr.setRequestHeader('Content-Type', 'application/octet-stream')
          payload = opts.binary
        } else if (method !== 'GET') {
          xhr.setRequestHeader('Content-Type', 'application/json')
          payload = JSON.stringify(opts.body || {})
        }
        if (typeof opts.onProgress === 'function') {
          xhr.onprogress = (e) => {
            opts.onProgress(e)
          }
        }
        if (typeof opts.onUploadProgress === 'function' && xhr.upload) {
          xhr.upload.onprogress = (e) => {
            opts.onUploadProgress(e)
          }
        }
        xhr.onload = () => {
          let data = null
          if (opts.responseType === 'arraybuffer') {
            if (xhr.status === 200) {
              data = xhr.response instanceof ArrayBuffer ? xhr.response : null
            } else {
              data = parseJson(bufferToText(xhr.response))
            }
          } else {
            data = parseJson(xhr.responseText)
          }
          settle(xhr.status, data)
        }
        xhr.onerror = () => {
          settle(0, null)
        }
        xhr.ontimeout = () => {
          settle(0, null)
        }
        xhr.onabort = () => {
          settle(0, null, true)
        }
        backupTimer = setTimeout(() => {
          abortXhr(xhr)
          settle(0, null)
        }, timeoutMs + 3000)
        xhr.send(payload)
      } catch (err) {
        settle(0, null)
      }
    })
    promise.abort = () => {
      abortXhr(xhr)
    }
    return promise
  }

  // Oturumlu istek. 401 ve engelleme yanıtları ortak olarak ele alınır.
  function api (method, path, body, options) {
    const opts = Object.assign({}, options || {})
    if (body !== undefined && body !== null) opts.body = body
    const pending = request(method, path, opts)
    const out = pending.then((res) => {
      checkAuthFailure(res)
      return res
    })
    out.abort = pending.abort
    return out
  }

  function checkAuthFailure (res) {
    if (!state.token || !res) return
    const code = res.data && typeof res.data.code === 'string' ? res.data.code : ''
    if (res.status === 401 && code !== 'bad_credentials') {
      handleSessionLost('expired')
    } else if (res.status === 403 && code === 'banned') {
      handleSessionLost('banned')
    }
  }

  function errorText (res, fallback) {
    if (res && res.data && typeof res.data.error === 'string' && res.data.error) return res.data.error
    if (!res || res.status === 0) return TEXT.unreachable
    return fallback
  }

  // Genel yardımcılar

  function wait (ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  function sameId (a, b) {
    if (a === null || a === undefined || b === null || b === undefined) return false
    return String(a) === String(b)
  }

  function codePoints (text) {
    return Array.from(typeof text === 'string' ? text : '')
  }

  function cpLength (text) {
    return codePoints(text).length
  }

  function cpSlice (text, max) {
    const cps = codePoints(text)
    return cps.length > max ? cps.slice(0, max).join('') + '...' : cps.join('')
  }

  function normalizeName (value) {
    let text = String(value || '')
    try {
      text = text.normalize('NFC')
    } catch (err) {
      // normalize yoksa olduğu gibi
    }
    return text.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim()
  }

  function pad2 (n) {
    return n < 10 ? '0' + n : String(n)
  }

  function toDate (ts) {
    const date = new Date(typeof ts === 'number' ? ts : Number(ts) || 0)
    return isNaN(date.getTime()) ? new Date(0) : date
  }

  function sameDay (a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  }

  function formatClock (date) {
    return pad2(date.getHours()) + ':' + pad2(date.getMinutes())
  }

  function formatShort (ts) {
    const date = toDate(ts)
    if (sameDay(date, new Date())) return formatClock(date)
    return pad2(date.getDate()) + '.' + pad2(date.getMonth() + 1) + '.' + date.getFullYear() + ' ' + formatClock(date)
  }

  function formatLong (ts) {
    const date = toDate(ts)
    return date.getDate() + ' ' + MONTHS[date.getMonth()] + ' ' + date.getFullYear() + ' ' + DAYS[date.getDay()] + ' ' + formatClock(date)
  }

  function formatSize (bytes) {
    const n = Number(bytes) || 0
    if (n < 1024) return n + ' bayt'
    if (n < 1024 * 1024) return Math.max(1, Math.round(n / 1024)) + ' KB'
    const units = n < 1024 * 1024 * 1024 ? ['MB', 1024 * 1024] : ['GB', 1024 * 1024 * 1024]
    const value = n / units[1]
    const text = value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace('.', ',').replace(/,0$/, '')
    return text + ' ' + units[0]
  }

  function fileExt (name) {
    const text = String(name || '')
    const dot = text.lastIndexOf('.')
    if (dot <= 0 || dot === text.length - 1) return ''
    return text.slice(dot + 1).toLowerCase()
  }

  function replaceExt (name, ext) {
    const text = String(name || '')
    const dot = text.lastIndexOf('.')
    const base = dot > 0 ? text.slice(0, dot) : text
    return (base || 'fotograf') + '.' + ext
  }

  function fileKind (name) {
    const ext = fileExt(name)
    const kinds = Object.keys(FILE_KINDS)
    const found = kinds.filter((k) => FILE_KINDS[k].indexOf(ext) !== -1)
    return found.length ? found[0] : 'other'
  }

  function isExecutable (name) {
    return EXEC_EXT.indexOf(fileExt(name)) !== -1
  }

  // Dosya adı temizliği (Ek A1). crypto.js sağlıyorsa onunki kullanılır.
  function cleanFileName (value) {
    const e2ee = window.E2EE
    if (e2ee && typeof e2ee.sanitizeFileName === 'function') {
      try {
        return e2ee.sanitizeFileName(String(value || ''))
      } catch (err) {
        // Yerel yedek kullanılır
      }
    }
    let name = String(value || '')
    try {
      name = name.normalize('NFC')
    } catch (err) {
      // normalize yoksa olduğu gibi
    }
    name = name.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff\/\\:*?"<>|]/g, '').replace(/^[.\s]+/, '').replace(/[.\s]+$/, '')
    let cps = Array.from(name)
    if (cps.length > 120) {
      const dot = cps.lastIndexOf('.')
      const extLen = dot > 0 ? cps.length - dot : 0
      cps = extLen >= 2 && extLen <= 17 ? cps.slice(0, 120 - extLen).concat(cps.slice(dot)) : cps.slice(0, 120)
    }
    name = cps.join('')
    return name || 'dosya'
  }

  function avatarClass (userId) {
    const text = String(userId === undefined || userId === null ? '' : userId)
    let n = Number(text)
    if (!isFinite(n) || text === '') {
      n = 0
      codePoints(text).forEach((ch) => {
        n = (n * 31 + ch.codePointAt(0)) % 2147483647
      })
    }
    return 'avatar-c' + (Math.abs(Math.floor(n)) % AVATAR_COLORS)
  }

  function initial (name) {
    const cps = codePoints(String(name || '?').trim())
    return cps.length ? cps[0].toLocaleUpperCase('tr-TR') : '?'
  }

  function isIos () {
    const ua = navigator.userAgent || ''
    return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  }

  function isStandalone () {
    try {
      if (navigator.standalone === true) return true
      return Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
    } catch (err) {
      return false
    }
  }

  function isNarrow () {
    return window.innerWidth < 760
  }

  function isWide () {
    return window.innerWidth >= 1000
  }

  function isConnected (node) {
    if (!node) return false
    if (typeof node.isConnected === 'boolean') return node.isConnected
    return document.documentElement.contains(node)
  }

  function nextFrame (fn) {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(fn)
    } else {
      setTimeout(fn, 16)
    }
  }

  function readBlobBytes (blob) {
    return new Promise((resolve, reject) => {
      try {
        const reader = new FileReader()
        reader.onload = () => {
          resolve(new Uint8Array(reader.result))
        }
        reader.onerror = () => {
          reject(new Error('Dosya okunamadı.'))
        }
        reader.readAsArrayBuffer(blob)
      } catch (err) {
        reject(err)
      }
    })
  }

  function cryptoReady () {
    try {
      return Boolean(window.E2EE && typeof window.E2EE.available === 'function' && window.E2EE.available())
    } catch (err) {
      return false
    }
  }

  // Uygulama durumu

  const state = {
    info: null,
    serverName: 'Sohbet',
    limits: {
      nameMin: 2,
      nameMax: 20,
      passwordMin: 8,
      passwordMax: 128,
      messageMaxChars: 2000,
      maxBodyChars: 24000,
      uploadMaxBytes: 25 * 1024 * 1024 + 16,
      maxUploadsPerMessage: 10,
      channelNameMax: 30
    },
    token: '',
    me: null,
    boot: '',
    seq: 0,
    metaVersion: 0,
    sigSeq: 0,
    meta: null,
    inviteCode: null,
    bannedUsers: null,
    users: new Map(),
    inApp: false,
    keySkipped: false,
    afterInvite: null,
    channelId: null,
    messages: [],
    nodes: new Map(),
    hasMore: false,
    loading: false,
    loadGen: 0,
    loadingOlder: false,
    pendingEvents: [],
    unread: Object.create(null),
    lastRead: Object.create(null),
    hiddenUnread: 0,
    pollGen: 0,
    activePoll: null,
    connLost: false,
    attachments: [],
    attachSeq: 0,
    activeUploads: 0,
    sending: false,
    editingId: null,
    menuMessageId: null,
    voiceSnap: null,
    voiceKey: '',
    installPrompt: null,
    sessionLost: false
  }

  let voice = null
  const el = {}

  function byId (id) {
    return document.getElementById(id)
  }

  const ELEMENT_IDS = [
    'toast', 'boot-view', 'boot-text', 'boot-retry',
    'auth-view', 'auth-server-name', 'auth-notice',
    'setup-card', 'setup-form', 'setup-name', 'setup-password', 'setup-password2', 'setup-code', 'setup-error', 'setup-submit',
    'invite-card', 'invite-link', 'invite-key', 'invite-copy-link', 'invite-copy-key', 'invite-continue',
    'login-card', 'auth-tab-login', 'auth-tab-register', 'login-form', 'login-name', 'login-password', 'login-error', 'login-submit',
    'register-form', 'register-name', 'register-password', 'register-password2', 'register-invite', 'register-error', 'register-submit',
    'key-card', 'key-intro', 'key-form', 'key-input', 'key-error', 'key-add', 'key-generate-wrap', 'key-generate', 'key-skip', 'key-logout',
    'app-view', 'conn-banner', 'sidebar', 'sidebar-close', 'server-name', 'text-channels', 'voice-channels',
    'voice-panel', 'voice-panel-status', 'voice-panel-channel', 'voice-leave', 'voice-error', 'voice-unlock', 'ptt-button',
    'user-panel', 'me-avatar', 'me-name', 'me-status', 'btn-mute', 'btn-deafen', 'btn-settings',
    'main', 'btn-open-channels', 'channel-title', 'key-state', 'btn-open-members',
    'voice-strip', 'voice-strip-text', 'voice-strip-leave',
    'messages', 'channel-start', 'channel-start-title', 'load-older-wrap', 'load-older', 'message-list', 'messages-status', 'messages-retry-wrap', 'messages-retry',
    'composer', 'attach-list', 'photo-note', 'composer-hint', 'composer-hint-text', 'composer-hint-action',
    'composer-form', 'btn-photo', 'btn-file', 'composer-input', 'btn-emoji', 'btn-send', 'char-counter', 'file-photo', 'file-any',
    'emoji-picker', 'emoji-tabs', 'emoji-title', 'emoji-grid', 'drop-overlay',
    'members', 'members-close', 'members-online-title', 'members-online', 'members-offline-title', 'members-offline', 'drawer-backdrop',
    'msg-menu', 'msg-menu-edit', 'msg-menu-delete',
    'peer-popover', 'peer-name', 'peer-volume', 'peer-volume-value', 'peer-mute', 'peer-note',
    'viewer', 'viewer-name', 'viewer-download', 'viewer-close', 'viewer-stage', 'viewer-img',
    'settings-modal', 'settings-tabs', 'settings-close',
    'settings-tab-account', 'settings-tab-voice', 'settings-tab-crypto', 'settings-tab-server', 'settings-tab-members',
    'settings-panel-account', 'settings-panel-voice', 'settings-panel-crypto', 'settings-panel-server', 'settings-panel-members',
    'set-avatar', 'set-name', 'set-role', 'set-password-form', 'set-old-password', 'set-new-password', 'set-new-password2', 'set-password-msg', 'set-password-submit',
    'set-notify', 'set-notify-msg', 'set-install-wrap', 'set-install', 'set-ios-hint', 'set-logout',
    'set-voice-support', 'set-mic', 'set-mic-refresh', 'set-ptt', 'set-ptt-key', 'set-ptt-change', 'set-ptt-msg', 'set-level-bar', 'set-level-note',
    'set-keyring', 'set-key-form', 'set-key-input', 'set-key-add', 'set-key-msg', 'set-active-wrap', 'set-active-missing', 'set-active-row', 'set-active-key',
    'set-key-show', 'set-key-copy', 'set-invite-copy', 'set-key-admin', 'set-key-generate', 'set-new-invite-wrap', 'set-new-invite', 'set-new-invite-copy',
    'set-server-form', 'set-server-name', 'set-server-save', 'set-server-msg', 'set-invite-code', 'set-invite-show', 'set-invite-rotate', 'set-invite-msg',
    'set-channel-form', 'set-channel-name', 'set-channel-type', 'set-channel-create', 'set-channel-msg', 'set-text-channels', 'set-voice-channels',
    'set-members-msg', 'set-temp-wrap', 'set-temp-label', 'set-temp-password', 'set-temp-copy', 'set-members-list', 'set-banned-wrap', 'set-banned-list'
  ]

  function camel (id) {
    return id.replace(/-([a-z0-9])/g, (m, c) => c.toUpperCase())
  }

  function cacheElements () {
    ELEMENT_IDS.forEach((id) => {
      el[camel(id)] = byId(id)
    })
  }

  // DOM yardımcıları (yalnızca createElement ve textContent)

  function h (tag, className, text) {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined && text !== null) node.textContent = String(text)
    return node
  }

  function icon (name, extraClass) {
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('class', 'icon' + (extraClass ? ' ' + extraClass : ''))
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('focusable', 'false')
    const use = document.createElementNS(SVG_NS, 'use')
    use.setAttribute('href', '#' + name)
    use.setAttributeNS(XLINK_NS, 'xlink:href', '#' + name)
    svg.appendChild(use)
    return svg
  }

  function setIcon (target, name) {
    const use = target.querySelector('use')
    if (!use) return
    use.setAttribute('href', '#' + name)
    use.setAttributeNS(XLINK_NS, 'xlink:href', '#' + name)
  }

  function button (className, text, iconName, label) {
    const b = h('button', className)
    b.type = 'button'
    if (iconName) b.appendChild(icon(iconName))
    if (text) b.appendChild(h('span', 'button-text', text))
    if (label) {
      b.setAttribute('aria-label', label)
      b.title = label
    }
    return b
  }

  function clear (node) {
    while (node && node.firstChild) node.removeChild(node.firstChild)
  }

  function setMsg (node, text, kind) {
    if (!node) return
    node.textContent = text || ''
    node.hidden = !text
    node.classList.toggle('is-error', kind === 'error')
    node.classList.toggle('is-ok', kind === 'ok')
  }

  function avatar (userId, name, extraClass) {
    const span = h('span', 'avatar ' + avatarClass(userId) + (extraClass ? ' ' + extraClass : ''), initial(name))
    span.setAttribute('aria-hidden', 'true')
    return span
  }

  function roleBadge (role) {
    if (role !== 'owner' && role !== 'admin') return null
    return h('span', 'badge badge-' + role, ROLE_LABELS[role])
  }

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

  function focusables (root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter((node) => {
      if (node.closest('[hidden]')) return false
      if (node.getAttribute('aria-hidden') === 'true') return false
      return node.offsetWidth > 0 || node.offsetHeight > 0 || node === document.activeElement
    })
  }

  function focusNode (node) {
    if (!node) return
    try {
      node.focus({ preventScroll: false })
    } catch (err) {
      try {
        node.focus()
      } catch (err2) {
        // Odaklanamayan öğe
      }
    }
  }

  // Katman yığını: modal, çekmece, emoji seçici, menü, açılır panel ve görüntüleyici.
  // Açılınca ilk öğeye odaklanır, kapanınca odak tetikleyiciye döner, Esc en üsttekini kapatır.

  const layers = []

  function openLayer (layer) {
    closeLayersAbove(layer.level || 0)
    layers.push(layer)
    if (layer.focus !== false) {
      nextFrame(() => {
        if (layers.indexOf(layer) === -1) return
        const target = layer.initialFocus ? layer.initialFocus() : focusables(layer.el)[0]
        focusNode(target || layer.el)
      })
    }
  }

  function closeLayer (layer, restoreFocus) {
    const index = layers.indexOf(layer)
    if (index === -1) return
    layers.splice(index, 1)
    try {
      layer.onClose()
    } catch (err) {
      window.console.error(err)
    }
    if (restoreFocus !== false) {
      const target = liveTrigger(layer.trigger)
      if (target && !target.closest('[hidden]')) focusNode(target)
    }
  }

  // Tetikleyici yeniden çizildiyse aynı odak anahtarını taşıyan yeni öğe kullanılır.
  function liveTrigger (trigger) {
    if (!trigger) return null
    if (isConnected(trigger)) return trigger
    const key = trigger.getAttribute('data-focus-key')
    if (!key) return null
    return Array.from(document.querySelectorAll('[data-focus-key]')).filter((node) => node.getAttribute('data-focus-key') === key)[0] || null
  }

  function closeLayersAbove (level) {
    layers.slice().reverse().forEach((layer) => {
      if ((layer.level || 0) >= level) closeLayer(layer, false)
    })
  }

  function closeAllLayers () {
    layers.slice().reverse().forEach((layer) => {
      closeLayer(layer, false)
    })
  }

  function topLayer () {
    return layers.length ? layers[layers.length - 1] : null
  }

  function findLayer (name) {
    const found = layers.filter((layer) => layer.name === name)
    return found.length ? found[0] : null
  }

  function onLayerKeydown (e) {
    const layer = topLayer()
    if (!layer) return
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (e.defaultPrevented) return
      e.preventDefault()
      closeLayer(layer, true)
      return
    }
    if (e.key === 'Tab' && layer.trap) {
      const items = focusables(layer.el)
      if (!items.length) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (!layer.el.contains(active)) {
        e.preventDefault()
        focusNode(first)
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        focusNode(last)
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        focusNode(first)
      }
    }
  }

  function onLayerPointerDown (e) {
    const layer = topLayer()
    if (!layer || !layer.outside) return
    const target = e.target
    if (layer.el.contains(target)) return
    if (layer.trigger && layer.trigger.contains(target)) return
    closeLayer(layer, false)
  }

  function onLayerFocusIn (e) {
    const layer = topLayer()
    if (!layer || !layer.closeOnFocusOut) return
    if (layer.el.contains(e.target)) return
    if (layer.trigger && layer.trigger.contains(e.target)) return
    closeLayer(layer, false)
  }

  // Bildirim şeridi

  let toastTimer = 0

  function toast (text, kind, ms) {
    if (!text) return
    clearTimeout(toastTimer)
    el.toast.textContent = text
    el.toast.className = 'toast' + (kind === 'error' ? ' toast-error' : kind === 'ok' ? ' toast-ok' : '')
    el.toast.hidden = false
    toastTimer = setTimeout(() => {
      el.toast.hidden = true
    }, ms || TOAST_MS)
  }

  // Panoya kopyalama. Güvenli bağlam yoksa execCommand yedeği.

  function fallbackCopy (text) {
    const active = document.activeElement
    const helper = h('textarea', 'clipboard-helper')
    helper.value = text
    helper.setAttribute('readonly', '')
    document.body.appendChild(helper)
    let ok = false
    try {
      helper.select()
      helper.setSelectionRange(0, text.length)
      ok = document.execCommand('copy')
    } catch (err) {
      ok = false
    }
    document.body.removeChild(helper)
    if (active && typeof active.focus === 'function') focusNode(active)
    return ok
  }

  function copyText (text) {
    if (navigator.clipboard && window.isSecureContext && typeof navigator.clipboard.writeText === 'function') {
      return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text))
    }
    return Promise.resolve(fallbackCopy(text))
  }

  function copyWithToast (text) {
    copyText(text).then((ok) => {
      toast(ok ? TEXT.copied : TEXT.copyFailed, ok ? 'ok' : 'error')
    })
  }

  function selectAll (input) {
    try {
      input.focus()
      input.select()
    } catch (err) {
      // Seçim desteklenmiyor
    }
  }

  // Görünümler

  function showView (name) {
    el.bootView.hidden = name !== 'boot'
    el.authView.hidden = name !== 'auth'
    el.appView.hidden = name !== 'app'
    document.body.classList.toggle('in-app', name === 'app')
  }

  function showBoot (text, canRetry) {
    showView('boot')
    el.bootText.textContent = text || TEXT.connecting
    el.bootRetry.hidden = !canRetry
  }

  const AUTH_CARDS = ['setup', 'invite', 'login', 'key']

  function showAuthCard (name, notice) {
    showView('auth')
    AUTH_CARDS.forEach((card) => {
      el[card + 'Card'].hidden = card !== name
    })
    setMsg(el.authNotice, notice || '', 'error')
    el.authServerName.textContent = state.serverName
    document.title = state.serverName
  }

  function setFormBusy (form, busy) {
    Array.from(form.querySelectorAll('button, input')).forEach((node) => {
      node.disabled = busy
    })
    form.classList.toggle('is-busy', busy)
  }

  // Adresteki #davet= ve #anahtar= parçaları (5.2 adım 1)

  function parseFragment (text) {
    const out = Object.create(null)
    String(text || '').split('&').forEach((part) => {
      const eq = part.indexOf('=')
      if (eq <= 0) return
      const key = part.slice(0, eq)
      let value = part.slice(eq + 1)
      try {
        value = decodeURIComponent(value.replace(/\+/g, ' '))
      } catch (err) {
        // Kodlanmamış değer olduğu gibi kullanılır
      }
      out[key] = value
    })
    return out
  }

  function readFragment () {
    const hash = window.location.hash || ''
    if (hash.length < 2) return
    const params = parseFragment(hash.slice(1))
    let touched = false
    if (typeof params.davet === 'string') {
      touched = true
      const code = params.davet.trim()
      if (code) storeSet(KEYS.invite, code, 'session')
    }
    if (typeof params.anahtar === 'string') {
      touched = true
      if (cryptoReady()) {
        try {
          window.E2EE.keyring.add(params.anahtar)
          state.fragmentNotice = { kind: 'ok', text: 'Şifreleme anahtarı bu cihaza eklendi.' }
        } catch (err) {
          state.fragmentNotice = { kind: 'error', text: 'Bağlantıdaki şifreleme anahtarı hatalı. ' + (err && err.message ? err.message : '') }
        }
      }
    }
    if (touched) {
      try {
        window.history.replaceState(null, document.title, window.location.pathname + window.location.search)
      } catch (err) {
        window.location.hash = ''
      }
    }
  }

  function showFragmentNotice () {
    const notice = state.fragmentNotice
    if (!notice) return
    state.fragmentNotice = null
    toast(notice.text, notice.kind, notice.kind === 'error' ? 10000 : TOAST_MS)
  }

  // Açılış

  function applyInfo (info) {
    state.info = info
    if (typeof info.serverName === 'string' && info.serverName) state.serverName = info.serverName
    const limits = info.limits && typeof info.limits === 'object' ? info.limits : {}
    Object.keys(state.limits).forEach((key) => {
      const value = limits[key]
      if (typeof value === 'number' && isFinite(value) && value > 0) state.limits[key] = value
    })
    document.title = state.serverName
  }

  async function loadInfo () {
    showBoot(TEXT.connecting, false)
    const res = await request('GET', '/api/info', { token: '' })
    if (res.status !== 200 || !res.data) {
      showBoot(TEXT.unreachableRetry, true)
      setTimeout(() => {
        if (!el.bootView.hidden) loadInfo()
      }, INFO_RETRY_MS)
      return
    }
    applyInfo(res.data)
    if (res.data.setupRequired === true) {
      showSetup()
      return
    }
    const saved = storeGet(KEYS.token)
    if (saved) {
      state.token = saved
      await resumeSession()
      return
    }
    showLogin('')
  }

  async function resumeSession () {
    showBoot(TEXT.connecting, false)
    const res = await request('GET', '/api/state')
    if (res.status === 200 && res.data && res.data.me) {
      startSession(res.data)
      return
    }
    if (res.status === 401) {
      clearToken()
      showLogin(TEXT.sessionEnded)
      return
    }
    if (res.status === 403 && res.data && res.data.code === 'banned') {
      clearToken()
      showLogin(TEXT.banned)
      return
    }
    showBoot(errorText(res, TEXT.unreachable), true)
  }

  function setToken (token) {
    state.token = token
    state.sessionLost = false
    storeSet(KEYS.token, token)
  }

  function clearToken () {
    state.token = ''
    storeRemove(KEYS.token)
  }

  // Kurulum ekranı (sahip hesabı)

  function showSetup () {
    showAuthCard('setup')
    focusNode(el.setupName)
  }

  function validateNameAndPassword (name, password, password2) {
    const len = cpLength(name)
    if (len < state.limits.nameMin || len > state.limits.nameMax) {
      return 'Kullanıcı adı ' + state.limits.nameMin + ' ile ' + state.limits.nameMax + ' karakter arasında olmalı.'
    }
    const plen = cpLength(password)
    if (plen < state.limits.passwordMin || plen > state.limits.passwordMax) {
      return 'Parola ' + state.limits.passwordMin + ' ile ' + state.limits.passwordMax + ' karakter arasında olmalı.'
    }
    if (password2 !== undefined && password !== password2) return 'Parolalar aynı değil.'
    return ''
  }

  async function submitSetup (e) {
    e.preventDefault()
    if (el.setupForm.classList.contains('is-busy')) return
    const name = normalizeName(el.setupName.value)
    const password = el.setupPassword.value
    const code = el.setupCode.value.trim()
    const problem = validateNameAndPassword(name, password, el.setupPassword2.value) || (code ? '' : 'Kurulum kodunu girin.')
    if (problem) {
      setMsg(el.setupError, problem, 'error')
      return
    }
    if (!cryptoReady()) {
      setMsg(el.setupError, TEXT.noCrypto, 'error')
      return
    }
    setMsg(el.setupError, '')
    setFormBusy(el.setupForm, true)
    const res = await request('POST', '/api/register', { token: '', body: { name: name, password: password, setupCode: code } })
    if (res.status !== 200 || !res.data || typeof res.data.token !== 'string') {
      setFormBusy(el.setupForm, false)
      setMsg(el.setupError, errorText(res, 'Kurulum tamamlanamadı.'), 'error')
      return
    }
    setToken(res.data.token)
    el.setupPassword.value = ''
    el.setupPassword2.value = ''
    const created = await createGroupKey()
    const st = await api('GET', '/api/state')
    setFormBusy(el.setupForm, false)
    if (st.status !== 200 || !st.data || !st.data.me) {
      setMsg(el.setupError, errorText(st, 'Sunucu durumu alınamadı.'), 'error')
      return
    }
    if (!created.ok) {
      startSession(st.data)
      toast(created.error, 'error', 10000)
      return
    }
    showInvite(st.data.inviteCode, created.code, () => {
      startSession(st.data)
    })
  }

  // Yeni grup anahtarı üretir, anahtarlığa ekler ve sunucuda etkin anahtar kimliğini ayarlar.
  async function createGroupKey () {
    let code = ''
    let kid = ''
    try {
      code = window.E2EE.generateKeyCode()
      kid = window.E2EE.keyring.add(code)
    } catch (err) {
      return { ok: false, error: 'Şifreleme anahtarı oluşturulamadı.' }
    }
    const res = await api('POST', '/api/settings', { activeKid: kid })
    if (res.status !== 200) {
      return { ok: false, error: errorText(res, 'Etkin anahtar sunucuya bildirilemedi.'), code: code, kid: kid }
    }
    if (state.meta) state.meta.activeKid = kid
    return { ok: true, code: code, kid: kid }
  }

  function inviteLink (inviteCode, keyCode) {
    const origin = window.location.origin || (window.location.protocol + '//' + window.location.host)
    const parts = []
    if (inviteCode) parts.push('davet=' + encodeURIComponent(inviteCode))
    if (keyCode) parts.push('anahtar=' + encodeURIComponent(keyCode))
    return origin + '/#' + parts.join('&')
  }

  // Davet ekranı

  function showInvite (inviteCode, keyCode, next) {
    state.afterInvite = next
    el.inviteLink.value = inviteLink(inviteCode, keyCode)
    el.inviteKey.value = keyCode
    showAuthCard('invite')
    focusNode(el.inviteCopyLink)
  }

  function continueFromInvite () {
    const next = state.afterInvite
    state.afterInvite = null
    el.inviteLink.value = ''
    el.inviteKey.value = ''
    if (typeof next === 'function') next()
  }

  // Giriş ve kayıt ekranı

  function showLogin (notice) {
    const invite = storeGet(KEYS.invite, 'session')
    if (invite && !el.registerInvite.value) el.registerInvite.value = invite
    showAuthCard('login', notice)
    selectAuthTab(invite ? 'register' : 'login', false)
    focusNode(invite ? el.registerName : el.loginName)
  }

  function selectAuthTab (name, focusTab) {
    const login = name === 'login'
    el.authTabLogin.setAttribute('aria-selected', login ? 'true' : 'false')
    el.authTabRegister.setAttribute('aria-selected', login ? 'false' : 'true')
    el.authTabLogin.tabIndex = login ? 0 : -1
    el.authTabRegister.tabIndex = login ? -1 : 0
    el.loginForm.hidden = !login
    el.registerForm.hidden = login
    if (focusTab) focusNode(login ? el.authTabLogin : el.authTabRegister)
  }

  function onAuthTabKey (e) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      const loginSelected = el.authTabLogin.getAttribute('aria-selected') === 'true'
      selectAuthTab(loginSelected ? 'register' : 'login', true)
    }
  }

  async function submitLogin (e) {
    e.preventDefault()
    if (el.loginForm.classList.contains('is-busy')) return
    const name = normalizeName(el.loginName.value)
    const password = el.loginPassword.value
    if (!name || !password) {
      setMsg(el.loginError, 'Kullanıcı adı ve parolayı girin.', 'error')
      return
    }
    setMsg(el.loginError, '')
    setFormBusy(el.loginForm, true)
    const res = await request('POST', '/api/login', { token: '', body: { name: name, password: password } })
    setFormBusy(el.loginForm, false)
    if (res.status === 200 && res.data && typeof res.data.token === 'string') {
      el.loginPassword.value = ''
      setToken(res.data.token)
      await resumeSession()
      return
    }
    setMsg(el.loginError, errorText(res, 'Giriş yapılamadı.'), 'error')
  }

  async function submitRegister (e) {
    e.preventDefault()
    if (el.registerForm.classList.contains('is-busy')) return
    const name = normalizeName(el.registerName.value)
    const password = el.registerPassword.value
    const invite = el.registerInvite.value.trim()
    const problem = validateNameAndPassword(name, password, el.registerPassword2.value) || (invite ? '' : 'Davet kodunu girin.')
    if (problem) {
      setMsg(el.registerError, problem, 'error')
      return
    }
    setMsg(el.registerError, '')
    setFormBusy(el.registerForm, true)
    const res = await request('POST', '/api/register', { token: '', body: { name: name, password: password, inviteCode: invite } })
    setFormBusy(el.registerForm, false)
    if (res.status === 200 && res.data && typeof res.data.token === 'string') {
      el.registerPassword.value = ''
      el.registerPassword2.value = ''
      storeRemove(KEYS.invite, 'session')
      setToken(res.data.token)
      await resumeSession()
      return
    }
    setMsg(el.registerError, errorText(res, 'Kayıt olunamadı.'), 'error')
  }

  // Anahtar ekranı (5.2 adım 5)

  function isAdmin () {
    return Boolean(state.me && (state.me.role === 'owner' || state.me.role === 'admin'))
  }

  function isOwner () {
    return Boolean(state.me && state.me.role === 'owner')
  }

  function activeKid () {
    const kid = state.meta ? state.meta.activeKid : null
    return typeof kid === 'string' && KID_RE.test(kid) ? kid : null
  }

  function hasActiveKey () {
    const kid = activeKid()
    if (!kid || !cryptoReady()) return false
    try {
      return window.E2EE.keyring.has(kid)
    } catch (err) {
      return false
    }
  }

  function showKeyScreen () {
    const noActive = !activeKid()
    el.keyIntro.textContent = noActive && !isAdmin()
      ? 'Bu sunucudaki mesajlar uçtan uca şifreli. Sunucuda henüz etkin bir şifreleme anahtarı yok. Elinizde bir anahtar varsa girebilir veya anahtar olmadan devam edebilirsiniz.'
      : 'Bu sunucudaki mesajlar uçtan uca şifreli. Okuyup yazabilmek için şifreleme anahtarını girin.'
    el.keyGenerateWrap.hidden = !(noActive && isAdmin())
    setMsg(el.keyError, '')
    el.keyInput.value = ''
    showAuthCard('key')
    focusNode(el.keyInput)
  }

  function submitKey (e) {
    e.preventDefault()
    const value = el.keyInput.value.trim()
    if (!value) {
      setMsg(el.keyError, 'Lütfen 28 karakterlik anahtar kodunu girin.', 'error')
      return
    }
    let kid = ''
    try {
      kid = window.E2EE.keyring.add(value)
    } catch (err) {
      setMsg(el.keyError, err && err.message ? err.message : 'Anahtar hatalı.', 'error')
      return
    }
    el.keyInput.value = ''
    const active = activeKid()
    if (active && kid !== active) {
      setMsg(el.keyError, 'Anahtar eklendi ama bu sunucunun etkin anahtarı değil. Eski mesajları okumak için saklandı. Etkin anahtarı girin veya anahtar olmadan devam edin.', 'error')
      return
    }
    toast('Şifreleme anahtarı eklendi.', 'ok')
    openApp()
  }

  async function generateFromKeyScreen () {
    if (!isAdmin()) return
    el.keyGenerate.disabled = true
    const created = await createGroupKey()
    el.keyGenerate.disabled = false
    if (!created.ok) {
      setMsg(el.keyError, created.error, 'error')
      return
    }
    showInvite(state.inviteCode, created.code, () => {
      openApp()
    })
  }

  function skipKey () {
    state.keySkipped = true
    openApp()
  }

  // Oturum yaşam döngüsü

  function applyStateData (data) {
    state.me = { id: data.me.id, name: String(data.me.name || ''), role: data.me.role }
    state.boot = String(data.boot || '')
    state.seq = Number(data.seq) || 0
    state.metaVersion = Number(data.metaVersion) || 0
    state.sigSeq = Number(data.sigSeq) || 0
    state.inviteCode = typeof data.inviteCode === 'string' ? data.inviteCode : null
    state.bannedUsers = Array.isArray(data.bannedUsers) ? data.bannedUsers : state.bannedUsers
    if (data.meta) applyMeta(data.meta, true)
  }

  function startSession (data) {
    state.sessionLost = false
    applyStateData(data)
    state.lastRead = storeGetJson(userKey('read'), {})
    if (!hasActiveKey() && !state.keySkipped) {
      showKeyScreen()
      showFragmentNotice()
      return
    }
    openApp()
  }

  function userKey (name) {
    return 'sohbet.' + name + '.' + (state.me ? state.me.id : '')
  }

  function handleSessionLost (reason) {
    if (state.sessionLost) return
    state.sessionLost = true
    stopPoll()
    if (voice) {
      try {
        voice.teardown()
      } catch (err) {
        // Yerel kapatma hatası önemsiz
      }
    }
    clearToken()
    resetAppState()
    showLogin(reason === 'banned' ? TEXT.banned : TEXT.sessionEnded)
  }

  async function logout () {
    const token = state.token
    stopPoll()
    if (voice) {
      try {
        const current = voice.snapshot()
        if (current && current.channelId) {
          await Promise.race([voice.leave(), wait(3000)])
        } else {
          voice.teardown()
        }
      } catch (err) {
        // Ses kapatma hatası önemsiz
      }
    }
    if (token) {
      await request('POST', '/api/logout', { token: token, timeout: 5000 })
    }
    state.sessionLost = true
    clearToken()
    resetAppState()
    showLogin('')
  }

  function resetAppState () {
    closeAllLayers()
    state.inApp = false
    state.me = null
    state.meta = null
    state.inviteCode = null
    state.bannedUsers = null
    state.users = new Map()
    state.channelId = null
    state.messages = []
    state.nodes = new Map()
    state.unread = Object.create(null)
    state.hiddenUnread = 0
    state.keySkipped = false
    state.connLost = false
    state.editingId = null
    state.voiceKey = ''
    clearAttachments()
    decryptCache.clear()
    clear(el.messageList)
    clear(el.textChannels)
    clear(el.voiceChannels)
    clear(el.membersOnline)
    clear(el.membersOffline)
    el.composerInput.value = ''
    el.connBanner.hidden = true
    updateTitle()
  }

  // Uygulama ekranı

  function openApp () {
    state.inApp = true
    showView('app')
    renderServerName()
    renderChannels()
    renderMembers()
    renderUserPanel()
    renderVoiceAll()
    const remembered = storeGet(userKey('channel'))
    const channels = textChannels()
    const pick = channels.filter((c) => sameId(c.id, remembered))[0] || channels[0]
    if (pick) {
      selectChannel(pick.id, { force: true, focus: isWide() })
    } else {
      renderChannelHeader()
      renderComposerState()
    }
    startPoll()
    showFragmentNotice()
    scanUnread()
  }

  function channelsOf (type) {
    const list = state.meta && Array.isArray(state.meta.channels) ? state.meta.channels : []
    return list.filter((c) => c && c.type === type).sort((a, b) => (a.position || 0) - (b.position || 0))
  }

  function textChannels () {
    return channelsOf('text')
  }

  function voiceChannels () {
    return channelsOf('voice')
  }

  function findChannel (id) {
    const list = state.meta && Array.isArray(state.meta.channels) ? state.meta.channels : []
    return list.filter((c) => sameId(c.id, id))[0] || null
  }

  function userName (id) {
    const user = state.users.get(String(id))
    return user ? user.name : TEXT.unknownUser
  }

  function userRole (id) {
    const user = state.users.get(String(id))
    return user ? user.role : 'member'
  }

  // Meta uygulama: kanallar, üyeler, ses kadroları, roller (5.3)

  function applyMeta (meta, isInitial) {
    if (!meta || typeof meta !== 'object') return
    const prevKid = state.meta ? state.meta.activeKid : undefined
    const prevRole = state.me ? state.me.role : null
    state.meta = meta
    if (typeof meta.serverName === 'string' && meta.serverName) state.serverName = meta.serverName
    const users = Array.isArray(meta.users) ? meta.users : []
    users.forEach((u) => {
      if (u && u.id !== undefined) state.users.set(String(u.id), { id: u.id, name: String(u.name || ''), role: u.role, online: u.online === true })
    })
    if (state.me) {
      const mine = users.filter((u) => sameId(u.id, state.me.id))[0]
      if (mine) {
        state.me.role = mine.role
        state.me.name = String(mine.name || state.me.name)
      }
    }
    if (voice) {
      try {
        voice.handleMeta(meta, state.me)
      } catch (err) {
        window.console.error(err)
      }
    }
    if (isInitial || !state.inApp) return
    renderServerName()
    renderChannels()
    renderMembers()
    renderUserPanel()
    renderVoiceAll()
    const current = findChannel(state.channelId)
    if (!current || current.type !== 'text') {
      const first = textChannels()[0]
      if (first) {
        selectChannel(first.id, { force: true })
      } else {
        state.channelId = null
        renderChannelHeader()
      }
    } else {
      renderChannelHeader()
    }
    if (prevKid !== meta.activeKid || prevRole !== (state.me ? state.me.role : null)) {
      renderComposerState()
      refreshAllMessages()
    }
    refreshSettings()
  }

  function renderServerName () {
    el.serverName.textContent = state.serverName
    el.authServerName.textContent = state.serverName
    updateTitle()
  }

  function updateTitle () {
    const name = state.serverName || 'Sohbet'
    document.title = document.hidden && state.hiddenUnread > 0 ? '(' + state.hiddenUnread + ') ' + name : name
  }

  // Kanal listesi

  function renderChannels () {
    const focusKey = activeFocusKey(el.textChannels)
    clear(el.textChannels)
    textChannels().forEach((c) => {
      const li = h('li', 'channel-row')
      const b = h('button', 'channel-item')
      b.type = 'button'
      b.setAttribute('data-channel-id', String(c.id))
      b.setAttribute('data-focus-key', 'text-' + c.id)
      b.appendChild(icon('i-hash', 'channel-icon'))
      b.appendChild(h('span', 'channel-name', c.name))
      const count = state.unread[c.id] || 0
      const current = sameId(c.id, state.channelId)
      if (current) b.setAttribute('aria-current', 'page')
      if (count > 0 && !current) {
        b.classList.add('is-unread')
        const badge = h('span', 'unread-badge', count > 99 ? '99+' : String(count))
        b.appendChild(badge)
        b.setAttribute('aria-label', c.name + ', ' + count + ' okunmamış mesaj')
      }
      b.addEventListener('click', () => {
        selectChannel(c.id, { focus: true })
      })
      li.appendChild(b)
      el.textChannels.appendChild(li)
    })
    restoreFocusKey(el.textChannels, focusKey)
  }

  function activeFocusKey (container) {
    const active = document.activeElement
    if (!active || !container.contains(active)) return null
    return active.getAttribute('data-focus-key')
  }

  function restoreFocusKey (container, key) {
    if (!key) return
    const found = Array.from(container.querySelectorAll('[data-focus-key]')).filter((node) => node.getAttribute('data-focus-key') === key)[0]
    if (found) focusNode(found)
  }

  // Üye listesi (sağ sütun)

  function renderMembers () {
    const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users.slice() : []
    const online = users.filter((u) => u.online === true)
    const offline = users.filter((u) => u.online !== true)
    el.membersOnlineTitle.textContent = 'Çevrimiçi (' + online.length + ')'
    el.membersOfflineTitle.textContent = 'Çevrimdışı (' + offline.length + ')'
    fillMemberList(el.membersOnline, online, true)
    fillMemberList(el.membersOffline, offline, false)
  }

  function fillMemberList (list, users, online) {
    clear(list)
    users.forEach((u) => {
      const li = h('li', 'member' + (online ? ' is-online' : ' is-offline'))
      const av = h('span', 'avatar-wrap')
      av.appendChild(avatar(u.id, u.name))
      av.appendChild(h('span', 'presence-dot' + (online ? ' is-online' : '')))
      li.appendChild(av)
      const name = h('span', 'member-name', u.name)
      li.appendChild(name)
      if (state.me && sameId(u.id, state.me.id)) li.appendChild(h('span', 'member-you', '(sen)'))
      const badge = roleBadge(u.role)
      if (badge) li.appendChild(badge)
      list.appendChild(li)
    })
  }

  // Kanal başlığı ve yazma alanı durumu

  function renderChannelHeader () {
    const ch = findChannel(state.channelId)
    el.channelTitle.textContent = ch ? ch.name : ''
    el.channelStartTitle.textContent = ch ? '#' + ch.name + ' kanalına hoş geldin' : ''
    const hint = isNarrow() ? ' kanalına yaz' : ' kanalına mesaj gönder'
    el.composerInput.setAttribute('placeholder', ch ? '#' + ch.name + hint : 'Kanal seçin')
    const keyOk = hasActiveKey()
    el.keyState.hidden = keyOk
    el.keyState.textContent = keyOk ? '' : 'Anahtar yok'
  }

  function renderComposerState () {
    const ch = findChannel(state.channelId)
    const keyOk = hasActiveKey()
    const enabled = Boolean(ch) && keyOk
    el.composerInput.disabled = !enabled
    el.btnPhoto.disabled = !enabled
    el.btnFile.disabled = !enabled
    el.btnEmoji.disabled = !enabled
    if (!keyOk) {
      el.composerHint.hidden = false
      el.composerHintText.textContent = activeKid() ? TEXT.keyNeeded : TEXT.noActiveKey
      el.composerHintAction.hidden = Boolean(!activeKid() && !isAdmin())
      el.composerHintAction.textContent = activeKid() ? 'Anahtar ekle' : 'Anahtar oluştur'
    } else {
      el.composerHint.hidden = true
    }
    renderChannelHeader()
    updateSendState()
  }

  // Okunmamış sayaçlar

  function markRead () {
    if (!state.channelId || document.hidden) return
    const last = state.messages.length ? state.messages[state.messages.length - 1].id : null
    if (last !== null && last !== undefined) {
      const prev = Number(state.lastRead[state.channelId]) || 0
      if (Number(last) > prev) {
        state.lastRead[state.channelId] = last
        storeSetJson(userKey('read'), state.lastRead)
      }
    }
    if (state.unread[state.channelId]) {
      state.unread[state.channelId] = 0
      renderChannels()
    }
  }

  // Açılışta diğer yazı kanallarındaki okunmamış mesajları sayar (son 50 mesaja kadar).
  async function scanUnread () {
    const me = state.me
    const list = textChannels().filter((c) => !sameId(c.id, state.channelId))
    for (const c of list) {
      if (!state.inApp || state.me !== me) return
      const res = await api('GET', '/api/messages?channel=' + encodeURIComponent(c.id) + '&limit=' + PAGE_SIZE)
      if (res.status !== 200 || !res.data || !Array.isArray(res.data.messages)) continue
      const lastRead = Number(state.lastRead[c.id]) || 0
      const count = res.data.messages.filter((m) => Number(m.id) > lastRead && !sameId(m.authorId, me.id)).length
      if (!sameId(c.id, state.channelId) && count > (state.unread[c.id] || 0)) {
        state.unread[c.id] = count
      }
    }
    if (state.inApp && state.me === me) renderChannels()
  }

  // Kanal seçimi

  function selectChannel (id, opts) {
    const options = opts || {}
    const ch = findChannel(id)
    if (!ch || ch.type !== 'text') return
    closeDrawers()
    if (sameId(state.channelId, ch.id) && !options.force) {
      if (options.focus && !isNarrow()) focusNode(el.composerInput)
      return
    }
    cancelEdit()
    closeMessageMenu()
    state.channelId = ch.id
    storeSet(userKey('channel'), String(ch.id))
    state.unread[ch.id] = 0
    renderChannels()
    renderChannelHeader()
    renderComposerState()
    loadChannel()
    if (options.focus && isWide() && !el.composerInput.disabled) focusNode(el.composerInput)
  }

  // Long-poll döngüsü (5.3). Her başlatmada nesil sayacı artar,
  // eski döngüler bir sonraki adımda sessizce sonlanır.

  function startPoll () {
    stopPoll()
    pollLoop(state.pollGen)
  }

  function stopPoll () {
    state.pollGen += 1
    const pending = state.activePoll
    state.activePoll = null
    if (pending) pending.abort()
  }

  function setConnLost (lost) {
    if (state.connLost === lost) return
    state.connLost = lost
    el.connBanner.hidden = !lost
  }

  function retryDelay (failures) {
    return Math.min(10, Math.pow(2, failures - 1)) * 1000
  }

  async function pollLoop (generation) {
    let failures = 0
    while (generation === state.pollGen && state.token) {
      const path = '/api/poll?since=' + encodeURIComponent(state.seq) +
        '&mv=' + encodeURIComponent(state.metaVersion) +
        '&sig=' + encodeURIComponent(state.sigSeq) +
        '&boot=' + encodeURIComponent(state.boot)
      const pending = api('GET', path, null, { timeout: POLL_TIMEOUT_MS })
      state.activePoll = pending
      const res = await pending
      if (generation !== state.pollGen) return
      state.activePoll = null
      if (res.status === 200 && res.data) {
        failures = 0
        setConnLost(false)
        try {
          handlePoll(res.data)
        } catch (err) {
          // Beklenmeyen bir çizim hatası döngüyü durdurmamalı
          window.console.error(err)
        }
        continue
      }
      if (res.status === 401 || (res.status === 403 && res.data && res.data.code === 'banned')) return
      failures += 1
      setConnLost(true)
      await wait(retryDelay(failures))
    }
  }

  function handlePoll (data) {
    const bootChanged = typeof data.boot === 'string' && data.boot !== state.boot
    if (bootChanged || data.resync === true) {
      if (bootChanged) state.sigSeq = 0
      state.boot = String(data.boot || state.boot)
      state.seq = Number(data.seq) || 0
      state.metaVersion = Number(data.metaVersion) || 0
      if (data.meta) applyMeta(data.meta, false)
      handleSignals(data.signals)
      if (state.channelId) loadChannel()
      return
    }
    if (data.meta) {
      state.metaVersion = Number(data.metaVersion) || state.metaVersion
      applyMeta(data.meta, false)
    }
    const events = Array.isArray(data.events) ? data.events : []
    events.forEach((ev) => {
      if (!ev || typeof ev !== 'object') return
      try {
        applyEvent(ev)
      } catch (err) {
        window.console.error(err)
      }
    })
    if (typeof data.seq === 'number' && data.seq >= 0) state.seq = data.seq
    handleSignals(data.signals)
  }

  function handleSignals (signals) {
    if (!Array.isArray(signals) || !signals.length) return
    let max = state.sigSeq
    signals.forEach((s) => {
      if (s && typeof s.seq === 'number' && s.seq > max) max = s.seq
    })
    state.sigSeq = max
    if (voice) {
      try {
        voice.handleSignals(signals)
      } catch (err) {
        window.console.error(err)
      }
    }
  }

  function applyEvent (ev) {
    const inCurrent = sameId(ev.channelId, state.channelId)
    if (inCurrent && state.loading) {
      state.pendingEvents.push(ev)
      return
    }
    if (ev.type === 'msg' && ev.message) {
      onIncomingMessage(ev.message, inCurrent)
    } else if (ev.type === 'edit' && ev.message) {
      if (inCurrent) replaceMessage(ev.message)
    } else if (ev.type === 'del') {
      if (inCurrent) removeMessage(ev.messageId)
    }
  }

  function onIncomingMessage (message, inCurrent) {
    const mine = state.me && sameId(message.authorId, state.me.id)
    if (inCurrent) {
      insertMessage(message, { own: mine })
      if (!document.hidden) markRead()
    } else if (!mine) {
      state.unread[message.channelId] = (state.unread[message.channelId] || 0) + 1
      renderChannels()
    }
    if (!mine && document.hidden) {
      state.hiddenUnread += 1
      updateTitle()
      notifyMessage(message)
    }
  }

  // Masaüstü bildirimi (5.5). Varsayılan kapalı, ayarlardan açılır.

  function notificationsEnabled () {
    return storeGet(KEYS.notify) === '1' && typeof window.Notification === 'function' && window.Notification.permission === 'granted'
  }

  function notifyMessage (message) {
    if (!notificationsEnabled()) return
    const result = decryptMessage(message)
    let text = ''
    if (result.state === 'ok') {
      text = result.text ? cpSlice(result.text, 100) : (result.files.length ? (result.files[0].kind === 'image' ? '[Fotoğraf]' : '[Dosya]') : '')
    } else if (result.state === 'no_key') {
      text = 'Şifreli mesaj'
    } else {
      return
    }
    const body = userName(message.authorId) + ': ' + text
    const title = state.serverName
    try {
      const n = new window.Notification(title, { body: body, tag: 'sohbet-' + message.channelId })
      n.onclick = () => {
        try {
          window.focus()
        } catch (err) {
          // Pencere öne alınamadı
        }
        if (findChannel(message.channelId)) selectChannel(message.channelId, {})
        n.close()
      }
    } catch (err) {
      // Bazı mobil tarayıcılar yalnızca service worker üzerinden bildirim gösterir
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then((reg) => {
          if (reg && typeof reg.showNotification === 'function') reg.showNotification(title, { body: body, tag: 'sohbet-' + message.channelId })
        }).catch(() => {})
      }
    }
  }

  function onVisibilityChange () {
    if (document.hidden) return
    state.hiddenUnread = 0
    updateTitle()
    if (state.inApp) {
      markRead()
      if (state.connLost) startPoll()
    }
  }

  // Mesaj çözme (4.4 ve Ek A1). Sonuçlar mesaj gövdesine göre önbelleğe alınır.

  const decryptCache = new Map()

  function decryptMessage (m) {
    const cached = decryptCache.get(String(m.id))
    if (cached && cached.body === m.body) return cached.result
    let result = { state: 'no_key' }
    if (cryptoReady()) {
      let opened = null
      try {
        opened = window.E2EE.openJson(m.body)
      } catch (err) {
        opened = { ok: false, reason: 'bad_data' }
      }
      if (!opened || opened.ok !== true) {
        const reason = opened ? opened.reason : 'bad_data'
        result = { state: reason === 'no_key' ? 'no_key' : reason === 'bad_format' ? 'bad_format' : 'unverified' }
      } else {
        const v = opened.value
        if (!v || typeof v !== 'object' || v.v !== 1 || !sameId(v.a, m.authorId) || !sameId(v.c, m.channelId)) {
          result = { state: 'unverified' }
        } else {
          result = { state: 'ok', text: typeof v.t === 'string' ? v.t : '', files: normalizeFiles(v.f, m) }
        }
      }
    }
    decryptCache.set(String(m.id), { body: m.body, result: result })
    return result
  }

  function normalizeFiles (list, m) {
    if (!Array.isArray(list)) return []
    const allowed = Array.isArray(m.uploads) ? m.uploads.map(String) : null
    const out = []
    list.slice(0, 20).forEach((f) => {
      if (!f || typeof f !== 'object') return
      if (typeof f.u !== 'string' || !UPLOAD_ID_RE.test(f.u)) return
      if (allowed && allowed.indexOf(f.u) === -1) return
      if (typeof f.k !== 'string' || !B64URL_RE.test(f.k) || typeof f.n !== 'string' || !B64URL_RE.test(f.n)) return
      const mime = typeof f.m === 'string' ? f.m.slice(0, 100) : ''
      let kind = f.kind === 'image' || f.kind === 'file' ? f.kind : null
      if (!kind) kind = IMAGE_TYPES.indexOf(mime) !== -1 ? 'image' : 'file'
      const dim = (value) => (typeof value === 'number' && isFinite(value) && value > 0 && value < 100000 ? Math.round(value) : 0)
      out.push({
        u: f.u,
        k: f.k,
        n: f.n,
        kind: kind,
        name: cleanFileName(typeof f.name === 'string' ? f.name : ''),
        m: mime,
        s: typeof f.s === 'number' && f.s >= 0 ? f.s : 0,
        w: dim(f.w),
        h: dim(f.h)
      })
    })
    return out
  }

  // Yalnızca emojiden oluşan mesaj algılama (Ek A3 madde 4). \p{} kullanılmaz.

  // Başlangıç ve bitiş çiftleri halinde düz liste
  const EMOJI_RANGES = [
    0x1f000, 0x1faff, 0x2600, 0x27bf, 0x2300, 0x23ff, 0x2b00, 0x2bff,
    0x3030, 0x3030, 0x303d, 0x303d, 0x3297, 0x3297, 0x3299, 0x3299,
    0x00a9, 0x00a9, 0x00ae, 0x00ae, 0x203c, 0x203c, 0x2049, 0x2049,
    0x2122, 0x2122, 0x2139, 0x2139, 0x2194, 0x21aa, 0xfe0f, 0xfe0f,
    0x200d, 0x200d, 0x20e3, 0x20e3, 0xe0020, 0xe007f
  ]

  function inEmojiRange (cp) {
    let i = 0
    while (i < EMOJI_RANGES.length) {
      if (cp >= EMOJI_RANGES[i] && cp <= EMOJI_RANGES[i + 1]) return true
      i += 2
    }
    return false
  }

  function emojiCount (text) {
    const cps = codePoints(text).map((ch) => ch.codePointAt(0))
    let count = 0
    let joinNext = false
    let riOpen = false
    let i = 0
    while (i < cps.length) {
      const cp = cps[i]
      if (cp === 0x20 || cp === 0x0a || cp === 0x0d || cp === 0x09 || cp === 0xa0) {
        joinNext = false
        riOpen = false
        i += 1
        continue
      }
      if ((cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a) {
        if (cps[i + 1] === 0xfe0f && cps[i + 2] === 0x20e3) {
          count += 1
          i += 3
          continue
        }
        return 0
      }
      if (!inEmojiRange(cp)) return 0
      i += 1
      if (cp === 0xfe0f || cp === 0x20e3 || (cp >= 0xe0020 && cp <= 0xe007f) || (cp >= 0x1f3fb && cp <= 0x1f3ff)) continue
      if (cp === 0x200d) {
        joinNext = true
        continue
      }
      if (joinNext) {
        joinNext = false
        continue
      }
      if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
        if (riOpen) {
          riOpen = false
          continue
        }
        riOpen = true
        count += 1
        continue
      }
      riOpen = false
      count += 1
    }
    return count
  }

  function isJumbo (text) {
    const n = emojiCount(text)
    return n >= 1 && n <= 27
  }

  // Mesaj düğümü

  function canEdit (m) {
    return Boolean(state.me && sameId(m.authorId, state.me.id))
  }

  function canDelete (m) {
    return canEdit(m) || isAdmin()
  }

  function buildMessageNode (m) {
    const node = h('div', 'msg')
    node.setAttribute('data-id', String(m.id))
    const mine = state.me && sameId(m.authorId, state.me.id)
    if (mine) node.classList.add('msg-own')
    const name = userName(m.authorId)
    const role = userRole(m.authorId)

    const gutter = h('div', 'msg-gutter')
    gutter.appendChild(avatar(m.authorId, name, 'msg-avatar'))
    const hoverTime = h('span', 'msg-hover-time', formatClock(toDate(m.createdAt)))
    hoverTime.setAttribute('aria-hidden', 'true')
    hoverTime.title = formatLong(m.createdAt)
    gutter.appendChild(hoverTime)
    node.appendChild(gutter)

    const content = h('div', 'msg-content')
    const head = h('div', 'msg-head')
    const author = h('span', 'msg-author', name)
    head.appendChild(author)
    const badge = roleBadge(role)
    if (badge) head.appendChild(badge)
    const time = h('span', 'msg-time', formatShort(m.createdAt))
    time.title = formatLong(m.createdAt)
    head.appendChild(time)
    content.appendChild(head)
    const sr = h('span', 'sr-only msg-sr', name + ', ' + formatShort(m.createdAt) + ': ')
    content.appendChild(sr)

    const result = decryptMessage(m)
    const body = h('div', 'msg-body')
    if (result.state === 'ok') {
      if (result.text) {
        const text = h('div', 'msg-text', result.text)
        if (isJumbo(result.text)) text.classList.add('jumbo')
        body.appendChild(text)
      }
      if (result.files.length) body.appendChild(buildAttachments(result.files, m))
    } else {
      const notice = result.state === 'no_key' ? TEXT.noKeyMessage : result.state === 'bad_format' ? TEXT.badFormat : TEXT.unverified
      const text = h('div', 'msg-text msg-notice')
      text.appendChild(icon(result.state === 'no_key' ? 'i-lock' : 'i-alert'))
      text.appendChild(h('span', '', notice))
      body.appendChild(text)
    }
    if (m.editedAt) {
      const edited = h('span', 'msg-edited', TEXT.edited)
      edited.title = 'Düzenlendi: ' + formatLong(m.editedAt)
      const target = body.querySelector('.msg-text') || body
      target.appendChild(document.createTextNode(' '))
      target.appendChild(edited)
    }
    content.appendChild(body)
    node.appendChild(content)

    if (canEdit(m) || canDelete(m)) {
      const actions = h('div', 'msg-actions')
      if (canEdit(m) && result.state === 'ok') {
        const edit = button('msg-action msg-quick', '', 'i-edit', 'Düzenle')
        edit.tabIndex = -1
        edit.addEventListener('click', () => {
          startEdit(m.id)
        })
        actions.appendChild(edit)
      }
      if (canDelete(m)) {
        const del = button('msg-action msg-quick msg-action-danger', '', 'i-trash', 'Sil')
        del.tabIndex = -1
        del.addEventListener('click', () => {
          confirmDelete(m.id)
        })
        actions.appendChild(del)
      }
      const more = button('msg-action msg-more', '', 'i-more', 'Mesaj eylemleri')
      more.setAttribute('aria-haspopup', 'menu')
      more.setAttribute('aria-expanded', 'false')
      more.addEventListener('click', () => {
        openMessageMenu(m.id, more)
      })
      actions.appendChild(more)
      node.appendChild(actions)
    }
    return node
  }

  // Gruplama: aynı yazar, 5 dakika içinde ve aynı gün ise başlıksız devam eder.
  function startsGroup (m, prev) {
    if (!prev) return true
    if (!sameId(prev.authorId, m.authorId)) return true
    const a = Number(prev.createdAt) || 0
    const b = Number(m.createdAt) || 0
    if (b - a > GROUP_WINDOW_MS || b < a) return true
    return !sameDay(toDate(a), toDate(b))
  }

  function regroup () {
    let prev = null
    state.messages.forEach((m) => {
      const node = state.nodes.get(String(m.id))
      if (node) node.classList.toggle('msg-first', startsGroup(m, prev))
      prev = m
    })
  }

  function validMessage (m) {
    return Boolean(m && typeof m === 'object' && m.id !== undefined && m.id !== null && typeof m.body === 'string')
  }

  function indexOfMessage (id) {
    const key = String(id)
    let i = state.messages.length - 1
    while (i >= 0) {
      if (String(state.messages[i].id) === key) return i
      i -= 1
    }
    return -1
  }

  function renderAllMessages () {
    clear(el.messageList)
    state.nodes = new Map()
    const frag = document.createDocumentFragment()
    state.messages.forEach((m) => {
      const node = buildMessageNode(m)
      state.nodes.set(String(m.id), node)
      frag.appendChild(node)
    })
    el.messageList.appendChild(frag)
    regroup()
    renderListChrome()
  }

  function renderListChrome () {
    el.loadOlderWrap.hidden = !state.hasMore || state.loading
    el.channelStart.hidden = state.hasMore || state.loading || !state.channelId
  }

  function refreshAllMessages () {
    if (!state.inApp || state.loading) return
    const stick = isNearBottom()
    const top = el.messages.scrollTop
    decryptCache.clear()
    cancelEdit()
    renderAllMessages()
    if (stick) scrollToBottom()
    else el.messages.scrollTop = top
  }

  function insertMessage (m, opts) {
    if (!validMessage(m) || !sameId(m.channelId, state.channelId)) return
    const options = opts || {}
    if (indexOfMessage(m.id) !== -1) {
      replaceMessage(m)
      return
    }
    const stick = isNearBottom()
    let index = state.messages.length
    while (index > 0 && Number(state.messages[index - 1].id) > Number(m.id)) index -= 1
    state.messages.splice(index, 0, m)
    const node = buildMessageNode(m)
    state.nodes.set(String(m.id), node)
    const next = state.messages[index + 1]
    const nextNode = next ? state.nodes.get(String(next.id)) : null
    el.messageList.insertBefore(node, nextNode || null)
    regroup()
    renderListChrome()
    if (options.own || stick) {
      trimRendered()
      scrollToBottom()
    }
  }

  function replaceMessage (m) {
    if (!validMessage(m)) return
    const index = indexOfMessage(m.id)
    if (index === -1) return
    if (sameId(state.editingId, m.id)) state.editingId = null
    state.messages[index] = m
    decryptCache.delete(String(m.id))
    const old = state.nodes.get(String(m.id))
    const node = buildMessageNode(m)
    state.nodes.set(String(m.id), node)
    if (old && old.parentNode) {
      const hadFocus = old.contains(document.activeElement)
      old.parentNode.replaceChild(node, old)
      if (hadFocus) {
        const more = node.querySelector('.msg-more')
        if (more) focusNode(more)
      }
    }
    regroup()
  }

  function removeMessage (id) {
    const index = indexOfMessage(id)
    if (index === -1) return
    if (sameId(state.editingId, id)) state.editingId = null
    if (sameId(state.menuMessageId, id)) closeMessageMenu()
    state.messages.splice(index, 1)
    decryptCache.delete(String(id))
    const node = state.nodes.get(String(id))
    state.nodes.delete(String(id))
    if (node && node.parentNode) {
      const hadFocus = node.contains(document.activeElement)
      node.parentNode.removeChild(node)
      if (hadFocus) focusNode(el.messages)
    }
    regroup()
  }

  // Görüntülenen mesaj sayısını sınırlar. En eskiler düşer, sonra yeniden yüklenebilir.
  function trimRendered () {
    if (state.messages.length <= MAX_RENDERED) return
    const drop = state.messages.length - TRIM_TO
    const removed = state.messages.splice(0, drop)
    removed.forEach((m) => {
      const node = state.nodes.get(String(m.id))
      state.nodes.delete(String(m.id))
      decryptCache.delete(String(m.id))
      if (node && node.parentNode) node.parentNode.removeChild(node)
    })
    state.hasMore = true
    regroup()
    renderListChrome()
  }

  // Kaydırma. Kullanıcı alttaysa düzen değişikliklerinde (şerit, ekler, pencere boyutu) altta kalınır.

  let stickBottom = true

  function isNearBottom () {
    const box = el.messages
    return box.scrollHeight - box.scrollTop - box.clientHeight <= STICK_PX
  }

  function scrollToBottom () {
    el.messages.scrollTop = el.messages.scrollHeight
    stickBottom = true
  }

  function onMessagesScroll () {
    stickBottom = isNearBottom()
  }

  function keepBottom () {
    if (stickBottom && state.inApp) scrollToBottom()
  }

  function observeMessagesSize () {
    if (typeof window.ResizeObserver !== 'function') return
    try {
      const observer = new window.ResizeObserver(keepBottom)
      observer.observe(el.messages)
    } catch (err) {
      // Pencere boyutu olayı yedek olarak kullanılır
    }
  }

  // Kanal mesajlarını yükleme ve sayfalama

  async function loadChannel () {
    const channelId = state.channelId
    if (!channelId) return
    state.loadGen += 1
    const gen = state.loadGen
    state.loading = true
    state.pendingEvents = []
    state.messages = []
    state.hasMore = false
    state.nodes = new Map()
    decryptCache.clear()
    state.editingId = null
    clear(el.messageList)
    el.messagesRetryWrap.hidden = true
    setMsg(el.messagesStatus, 'Mesajlar yükleniyor...')
    renderListChrome()
    const res = await api('GET', '/api/messages?channel=' + encodeURIComponent(channelId) + '&limit=' + PAGE_SIZE)
    if (gen !== state.loadGen || !sameId(channelId, state.channelId)) return
    state.loading = false
    if (res.status !== 200 || !res.data || !Array.isArray(res.data.messages)) {
      setMsg(el.messagesStatus, errorText(res, 'Mesajlar yüklenemedi.'), 'error')
      el.messagesRetryWrap.hidden = false
      state.pendingEvents = []
      renderListChrome()
      el.channelStart.hidden = true
      return
    }
    setMsg(el.messagesStatus, '')
    state.messages = res.data.messages.filter(validMessage).sort((a, b) => Number(a.id) - Number(b.id))
    state.hasMore = res.data.hasMore === true
    const pending = state.pendingEvents
    state.pendingEvents = []
    pending.forEach((ev) => {
      if (ev.type === 'msg' && ev.message && indexOfMessage(ev.message.id) === -1) {
        const last = state.messages[state.messages.length - 1]
        if (!last || Number(ev.message.id) > Number(last.id)) state.messages.push(ev.message)
      } else if (ev.type === 'edit' && ev.message) {
        const i = indexOfMessage(ev.message.id)
        if (i !== -1) state.messages[i] = ev.message
      } else if (ev.type === 'del') {
        const i = indexOfMessage(ev.messageId)
        if (i !== -1) state.messages.splice(i, 1)
      }
    })
    renderAllMessages()
    scrollToBottom()
    markRead()
  }

  async function loadOlder () {
    if (state.loadingOlder || !state.hasMore || state.loading || !state.messages.length) return
    const channelId = state.channelId
    const gen = state.loadGen
    const first = state.messages[0]
    state.loadingOlder = true
    el.loadOlder.disabled = true
    el.loadOlder.textContent = 'Yükleniyor...'
    const res = await api('GET', '/api/messages?channel=' + encodeURIComponent(channelId) + '&before=' + encodeURIComponent(first.id) + '&limit=' + PAGE_SIZE)
    state.loadingOlder = false
    el.loadOlder.disabled = false
    el.loadOlder.textContent = 'Daha eski mesajları yükle'
    if (gen !== state.loadGen || !sameId(channelId, state.channelId)) return
    if (res.status !== 200 || !res.data || !Array.isArray(res.data.messages)) {
      toast(errorText(res, 'Eski mesajlar yüklenemedi.'), 'error')
      return
    }
    const older = res.data.messages.filter((m) => validMessage(m) && Number(m.id) < Number(first.id) && indexOfMessage(m.id) === -1)
      .sort((a, b) => Number(a.id) - Number(b.id))
    state.hasMore = res.data.hasMore === true
    const box = el.messages
    const before = box.scrollHeight - box.scrollTop
    const frag = document.createDocumentFragment()
    older.forEach((m) => {
      const node = buildMessageNode(m)
      state.nodes.set(String(m.id), node)
      frag.appendChild(node)
    })
    state.messages = older.concat(state.messages)
    el.messageList.insertBefore(frag, el.messageList.firstChild)
    regroup()
    renderListChrome()
    box.scrollTop = box.scrollHeight - before
    if (!state.hasMore) focusNode(el.messages)
  }

  // Mesaj eylemleri menüsü

  function openMessageMenu (id, trigger) {
    const m = state.messages[indexOfMessage(id)]
    if (!m) return
    const existing = findLayer('msg-menu')
    if (existing) {
      const same = sameId(state.menuMessageId, id)
      closeLayer(existing, false)
      if (same) return
    }
    const result = decryptMessage(m)
    el.msgMenuEdit.hidden = !(canEdit(m) && result.state === 'ok')
    el.msgMenuDelete.hidden = !canDelete(m)
    state.menuMessageId = m.id
    el.msgMenu.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    positionPopup(el.msgMenu, trigger)
    openLayer({
      name: 'msg-menu',
      el: el.msgMenu,
      trigger: trigger,
      level: 2,
      outside: true,
      closeOnFocusOut: true,
      onClose: () => {
        el.msgMenu.hidden = true
        trigger.setAttribute('aria-expanded', 'false')
        state.menuMessageId = null
      }
    })
  }

  function closeMessageMenu () {
    const layer = findLayer('msg-menu')
    if (layer) closeLayer(layer, false)
  }

  function onMenuKey (e) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
    e.preventDefault()
    const items = focusables(el.msgMenu)
    if (!items.length) return
    let i = items.indexOf(document.activeElement)
    if (e.key === 'ArrowDown') i = (i + 1) % items.length
    else if (e.key === 'ArrowUp') i = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') i = 0
    else i = items.length - 1
    focusNode(items[i])
  }

  // Açılır öğeyi tetikleyicinin yanına, görünür alan içinde konumlandırır.
  function positionPopup (popup, anchor) {
    const rect = anchor.getBoundingClientRect()
    popup.style.left = '0px'
    popup.style.top = '0px'
    const pw = popup.offsetWidth
    const ph = popup.offsetHeight
    const vw = window.innerWidth
    const vh = window.innerHeight
    let left = rect.right - pw
    if (left < 8) left = 8
    if (left + pw > vw - 8) left = Math.max(8, vw - 8 - pw)
    let top = rect.bottom + 6
    if (top + ph > vh - 8) top = rect.top - ph - 6
    if (top < 8) top = 8
    popup.style.left = Math.round(left) + 'px'
    popup.style.top = Math.round(top) + 'px'
  }

  // Düzenleme (yerinde textarea, Enter kaydeder, Esc iptal)

  function startEdit (id) {
    closeMessageMenu()
    if (!hasActiveKey()) {
      toast(TEXT.keyNeeded, 'error')
      return
    }
    cancelEdit()
    const m = state.messages[indexOfMessage(id)]
    if (!m || !canEdit(m)) return
    const result = decryptMessage(m)
    if (result.state !== 'ok') return
    const node = state.nodes.get(String(m.id))
    if (!node) return
    state.editingId = m.id
    node.classList.add('msg-editing')
    const body = node.querySelector('.msg-body')
    const textNode = body.querySelector('.msg-text')
    if (textNode) textNode.hidden = true
    const box = h('div', 'edit-box')
    const label = h('label', 'sr-only', 'Mesajı düzenle')
    const inputId = 'edit-input-' + m.id
    label.setAttribute('for', inputId)
    const ta = h('textarea', 'edit-input')
    ta.id = inputId
    ta.value = result.text
    ta.rows = 2
    ta.setAttribute('enterkeyhint', 'done')
    const hint = h('p', 'edit-hint', 'Enter kaydeder, Esc iptal eder.')
    const row = h('div', 'edit-actions')
    const save = button('button button-small', 'Kaydet')
    const cancel = button('button button-small button-secondary', 'İptal')
    save.addEventListener('click', () => {
      saveEdit(m.id, ta)
    })
    cancel.addEventListener('click', () => {
      cancelEdit(true)
    })
    ta.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        saveEdit(m.id, ta)
      } else if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault()
        e.stopPropagation()
        cancelEdit(true)
      }
    })
    ta.addEventListener('input', () => {
      autoGrow(ta, 10)
    })
    row.appendChild(save)
    row.appendChild(cancel)
    box.appendChild(label)
    box.appendChild(ta)
    box.appendChild(hint)
    box.appendChild(row)
    body.insertBefore(box, body.firstChild)
    autoGrow(ta, 10)
    focusNode(ta)
    try {
      ta.setSelectionRange(ta.value.length, ta.value.length)
    } catch (err) {
      // Seçim desteklenmiyor
    }
  }

  function cancelEdit (refocus) {
    const id = state.editingId
    if (id === null || id === undefined) return
    state.editingId = null
    const m = state.messages[indexOfMessage(id)]
    if (m) {
      replaceMessage(m)
      if (refocus) {
        const node = state.nodes.get(String(id))
        const more = node ? node.querySelector('.msg-more') : null
        focusNode(more || el.composerInput)
      }
    }
  }

  async function saveEdit (id, ta) {
    const m = state.messages[indexOfMessage(id)]
    if (!m || ta.disabled) return
    const result = decryptMessage(m)
    if (result.state !== 'ok') return
    const text = ta.value.trim()
    if (!text && !result.files.length) {
      toast('Mesaj boş olamaz. Silmek için Sil seçeneğini kullanın.', 'error')
      return
    }
    if (cpLength(text) > state.limits.messageMaxChars) {
      toast('Mesaj en fazla ' + state.limits.messageMaxChars + ' karakter olabilir.', 'error')
      return
    }
    if (text === result.text) {
      cancelEdit(true)
      return
    }
    let body = ''
    try {
      body = window.E2EE.sealJson(activeKid(), { v: 1, a: state.me.id, c: m.channelId, t: text, f: filesForSeal(result.files) })
    } catch (err) {
      toast('Mesaj şifrelenemedi.', 'error')
      return
    }
    ta.disabled = true
    const res = await api('POST', '/api/messages/edit', { id: m.id, body: body })
    ta.disabled = false
    if (res.status === 200 && res.data && res.data.message) {
      state.editingId = null
      replaceMessage(res.data.message)
      const node = state.nodes.get(String(id))
      const more = node ? node.querySelector('.msg-more') : null
      focusNode(more || el.composerInput)
      return
    }
    toast(errorText(res, 'Mesaj düzenlenemedi.'), 'error')
    focusNode(ta)
  }

  function filesForSeal (files) {
    return files.map((f) => {
      const out = { u: f.u, k: f.k, n: f.n, kind: f.kind, name: f.name, m: f.m, s: f.s }
      if (f.w) out.w = f.w
      if (f.h) out.h = f.h
      return out
    })
  }

  async function confirmDelete (id) {
    closeMessageMenu()
    const m = state.messages[indexOfMessage(id)]
    if (!m || !canDelete(m)) return
    if (!window.confirm('Bu mesaj silinsin mi? Bu işlem geri alınamaz.')) return
    const res = await api('POST', '/api/messages/delete', { id: m.id })
    if (res.status === 200) {
      removeMessage(m.id)
      return
    }
    toast(errorText(res, 'Mesaj silinemedi.'), 'error')
  }

  function editLastOwnMessage () {
    let i = state.messages.length - 1
    while (i >= 0) {
      const m = state.messages[i]
      if (canEdit(m) && decryptMessage(m).state === 'ok') {
        startEdit(m.id)
        const node = state.nodes.get(String(m.id))
        if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
        return true
      }
      i -= 1
    }
    return false
  }

  // Mesajdaki ekler: satır içi resimler ve dosya kartları (5.6, Ek A1)

  function buildAttachments (files, m) {
    const wrap = h('div', 'msg-attachments')
    files.forEach((f) => {
      wrap.appendChild(f.kind === 'image' ? buildImageBox(f, m) : buildFileCard(f))
    })
    return wrap
  }

  function fitBox (w, h0) {
    if (!w || !h0) return { w: 240, h: 180 }
    const scale = Math.min(1, IMAGE_BOX_MAX / w, IMAGE_BOX_MAX / h0)
    return { w: Math.max(48, Math.round(w * scale)), h: Math.max(48, Math.round(h0 * scale)) }
  }

  // Kutu genişliği w/h ile ayrılır, yükseklik dolgu oranıyla korunur (dar ekranda da oran bozulmaz).
  function sizeImageBox (box, w, h0) {
    const size = fitBox(w, h0)
    box.style.width = size.w + 'px'
    const ratio = box.querySelector('.msg-image-ratio')
    if (ratio) ratio.style.paddingTop = ((size.h / size.w) * 100).toFixed(3) + '%'
  }

  function setImageOverlay (box, iconName, text) {
    const old = box.querySelector('.msg-image-overlay')
    if (old) box.removeChild(old)
    if (!text) return
    const overlay = h('span', 'msg-image-overlay')
    if (iconName) overlay.appendChild(icon(iconName))
    overlay.appendChild(h('span', 'msg-image-status', text))
    box.appendChild(overlay)
  }

  function buildImageBox (f, m) {
    const box = h('button', 'msg-image is-loading')
    box.type = 'button'
    box.setAttribute('aria-label', 'Resmi büyüt: ' + f.name)
    box.appendChild(h('span', 'msg-image-ratio'))
    sizeImageBox(box, f.w, f.h)
    setImageOverlay(box, null, 'Resim yükleniyor...')
    box.disabled = true
    box.addEventListener('click', () => {
      const entry = imageCache.get(f.u)
      if (entry) openViewer(f, entry, box)
    })
    queueImage(f, box, m)
    return box
  }

  // Resim indirme kuyruğu ve blob URL önbelleği (en fazla 100, LRU)

  const imageCache = new Map()
  const imageInflight = new Map()
  const imageQueue = []
  let imageActive = 0

  function cacheGet (id) {
    const entry = imageCache.get(id)
    if (!entry) return null
    imageCache.delete(id)
    imageCache.set(id, entry)
    return entry
  }

  function cachePut (id, entry) {
    imageCache.set(id, entry)
    while (imageCache.size > IMAGE_CACHE_MAX) {
      const oldest = imageCache.keys().next().value
      const old = imageCache.get(oldest)
      imageCache.delete(oldest)
      if (old && old.url) {
        try {
          URL.revokeObjectURL(old.url)
        } catch (err) {
          // Zaten bırakılmış
        }
      }
    }
  }

  function queueImage (f, box, m) {
    const cached = cacheGet(f.u)
    if (cached) {
      showImage(f, box, cached)
      return
    }
    imageQueue.push({ f: f, box: box, m: m })
    // Kutu henüz DOM'a eklenmedi, kuyruk bir sonraki turda işlenir
    setTimeout(pumpImages, 0)
  }

  function pumpImages () {
    while (imageActive < IMAGE_PARALLEL && imageQueue.length) {
      const job = imageQueue.shift()
      if (!isConnected(job.box)) continue
      imageActive += 1
      fetchImage(job.f).then((result) => {
        imageActive -= 1
        applyImageResult(job, result)
        pumpImages()
      })
    }
  }

  function fetchImage (f) {
    const cached = cacheGet(f.u)
    if (cached) return Promise.resolve({ ok: true, entry: cached })
    if (imageInflight.has(f.u)) return imageInflight.get(f.u)
    const job = downloadPlain(f, null).then((res) => {
      imageInflight.delete(f.u)
      if (!res.ok) return res
      const sniffed = window.E2EE.sniffImage(res.bytes)
      if (!sniffed || IMAGE_TYPES.indexOf(sniffed) === -1 || sniffed !== f.m) return { ok: false, notImage: true }
      const blob = new Blob([res.bytes], { type: sniffed })
      const entry = { url: URL.createObjectURL(blob), blob: blob, mime: sniffed }
      cachePut(f.u, entry)
      return { ok: true, entry: entry }
    })
    imageInflight.set(f.u, job)
    return job
  }

  function applyImageResult (job, result) {
    if (!isConnected(job.box)) return
    if (result.ok) {
      showImage(job.f, job.box, result.entry)
    } else if (result.notImage) {
      const card = buildFileCard(job.f)
      if (job.box.parentNode) job.box.parentNode.replaceChild(card, job.box)
    } else {
      job.box.classList.remove('is-loading')
      job.box.classList.add('is-failed')
      setImageOverlay(job.box, 'i-alert', TEXT.imageFailed)
      job.box.setAttribute('aria-label', TEXT.imageFailed + ': ' + job.f.name)
    }
  }

  function showImage (f, box, entry) {
    const stick = isNearBottom()
    const img = h('img', 'msg-image-img')
    img.alt = f.name
    img.addEventListener('load', () => {
      box.classList.remove('is-loading')
      setImageOverlay(box, null, '')
      if (!f.w || !f.h) sizeImageBox(box, img.naturalWidth, img.naturalHeight)
      if (stick) scrollToBottom()
    })
    img.addEventListener('error', () => {
      box.classList.remove('is-loading')
      box.classList.add('is-failed')
      if (img.parentNode) img.parentNode.removeChild(img)
      setImageOverlay(box, 'i-alert', TEXT.imageFailed)
    })
    img.src = entry.url
    box.appendChild(img)
    box.disabled = false
  }

  // Şifreli dosyayı indirip çözer. Yanıt { ok, bytes } veya { ok: false, error }.
  async function downloadPlain (f, onProgress) {
    const res = await api('GET', '/api/uploads/' + f.u, null, {
      responseType: 'arraybuffer',
      timeout: TRANSFER_TIMEOUT_MS,
      onProgress: onProgress
    })
    if (res.status !== 200 || !(res.data instanceof ArrayBuffer)) {
      return { ok: false, error: res.status === 404 ? 'Dosya sunucuda bulunamadı.' : errorText(res, 'Dosya indirilemedi.') }
    }
    let plain = null
    try {
      plain = window.E2EE.decryptFile(new Uint8Array(res.data), f.k, f.n)
    } catch (err) {
      plain = null
    }
    if (!plain) return { ok: false, error: 'Dosya çözülemedi. Veri bozuk veya anahtar hatalı.' }
    return { ok: true, bytes: plain }
  }

  // Güvenli kaydetme: blob türü her zaman application/octet-stream, yeni sekme yok.
  function saveBytes (data, name) {
    const blob = new Blob([data], { type: 'application/octet-stream' })
    const url = URL.createObjectURL(blob)
    const a = h('a', 'download-helper')
    a.href = url
    a.download = name || 'dosya'
    a.rel = 'noopener'
    document.body.appendChild(a)
    try {
      a.click()
    } finally {
      document.body.removeChild(a)
    }
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url)
      } catch (err) {
        // Zaten bırakılmış
      }
    }, REVOKE_DELAY_MS)
  }

  // Dosya kartı (Ek A1 madde 2..4)

  function buildFileCard (f) {
    const card = h('button', 'file-card')
    card.type = 'button'
    const exec = isExecutable(f.name)
    const sizeText = formatSize(f.s)
    card.setAttribute('aria-label', 'İndir: ' + f.name + ', ' + sizeText + (exec ? ', ' + TEXT.execBadge : ''))
    card.appendChild(icon(FILE_ICONS[fileKind(f.name)] || 'i-file', 'file-card-icon'))
    const info = h('span', 'file-card-info')
    info.appendChild(h('span', 'file-card-name', f.name))
    const meta = h('span', 'file-card-meta', sizeText)
    info.appendChild(meta)
    if (exec) {
      const warn = h('span', 'file-card-warn')
      warn.appendChild(icon('i-alert'))
      warn.appendChild(h('span', '', TEXT.execBadge))
      info.appendChild(warn)
    }
    card.appendChild(info)
    const action = h('span', 'file-card-action')
    action.appendChild(icon('i-download'))
    const label = h('span', 'file-card-label', 'İndir')
    action.appendChild(label)
    card.appendChild(action)
    card.addEventListener('click', () => {
      downloadFileCard(f, card, label)
    })
    return card
  }

  async function downloadFileCard (f, card, label) {
    if (card.getAttribute('aria-busy') === 'true') return
    if (isExecutable(f.name) && !window.confirm(TEXT.execConfirm)) return
    card.setAttribute('aria-busy', 'true')
    card.classList.add('is-busy')
    label.textContent = '%0'
    const res = await downloadPlain(f, (e) => {
      if (e && e.lengthComputable && e.total > 0) label.textContent = '%' + Math.min(100, Math.round((e.loaded / e.total) * 100))
    })
    card.removeAttribute('aria-busy')
    card.classList.remove('is-busy')
    label.textContent = 'İndir'
    if (!res.ok) {
      toast(res.error, 'error')
      return
    }
    saveBytes(res.bytes, f.name)
  }

  // Tam ekran resim görüntüleyici

  let viewerFile = null

  function openViewer (f, entry, trigger) {
    viewerFile = { f: f, entry: entry }
    el.viewerName.textContent = f.name
    el.viewerImg.alt = f.name
    el.viewerImg.src = entry.url
    el.viewer.hidden = false
    openLayer({
      name: 'viewer',
      el: el.viewer,
      trigger: trigger,
      level: 3,
      trap: true,
      initialFocus: () => el.viewerClose,
      onClose: () => {
        el.viewer.hidden = true
        el.viewerImg.removeAttribute('src')
        viewerFile = null
      }
    })
  }

  function downloadFromViewer () {
    if (!viewerFile) return
    const f = viewerFile.f
    const ext = IMAGE_EXT[viewerFile.entry.mime] || 'bin'
    saveBytes(viewerFile.entry.blob, 'resim-' + f.u.slice(0, 8) + '.' + ext)
  }

  // Yazma alanı (5.6, Ek A2)

  function autoGrow (ta, maxRows) {
    if (!ta.value) {
      // Boşken yer tutucu metni yüksekliği etkilemesin
      ta.style.height = ''
      ta.style.overflowY = 'hidden'
      return
    }
    const style = window.getComputedStyle(ta)
    const line = parseFloat(style.lineHeight) || 20
    const pad = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0)
    const border = (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
    ta.style.height = 'auto'
    const max = line * maxRows + pad + border
    const next = Math.min(max, ta.scrollHeight + border)
    ta.style.height = Math.ceil(next) + 'px'
    ta.style.overflowY = ta.scrollHeight + border > max ? 'auto' : 'hidden'
  }

  function onComposerInput () {
    autoGrow(el.composerInput, 6)
    keepBottom()
    updateCounter()
    updateSendState()
  }

  function updateCounter () {
    const len = cpLength(el.composerInput.value)
    const max = state.limits.messageMaxChars
    if (len >= COUNTER_FROM) {
      el.charCounter.hidden = false
      el.charCounter.textContent = (max - len) < 0 ? 'Sınır ' + (len - max) + ' karakter aşıldı' : 'Kalan: ' + (max - len)
      el.charCounter.classList.toggle('is-error', len > max)
    } else {
      el.charCounter.hidden = true
    }
  }

  function pendingUploads () {
    return state.attachments.filter((a) => a.status !== 'done' && a.status !== 'error').length
  }

  function canSend () {
    if (!state.channelId || !hasActiveKey() || state.sending) return false
    const len = cpLength(el.composerInput.value.trim())
    if (len > state.limits.messageMaxChars) return false
    if (pendingUploads() > 0) return false
    if (state.attachments.some((a) => a.status === 'error')) return false
    return len > 0 || state.attachments.some((a) => a.status === 'done')
  }

  function updateSendState () {
    el.btnSend.disabled = !canSend()
    const uploading = pendingUploads()
    el.btnSend.title = uploading ? 'Yüklemeler bitince gönderilebilir' : 'Gönder'
  }

  function onComposerKeydown (e) {
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
      return
    }
    if (e.key === 'ArrowUp' && el.composerInput.value === '' && !state.attachments.length) {
      if (editLastOwnMessage()) e.preventDefault()
    }
  }

  async function sendMessage () {
    if (state.sending) return
    const channelId = state.channelId
    const raw = el.composerInput.value
    const text = raw.trim()
    if (pendingUploads() > 0) {
      toast('Yüklemeler bitince gönderebilirsiniz.')
      return
    }
    if (state.attachments.some((a) => a.status === 'error')) {
      toast('Yüklenemeyen ekleri kaldırın.', 'error')
      return
    }
    const ready = state.attachments.filter((a) => a.status === 'done')
    if (!text && !ready.length) return
    if (cpLength(text) > state.limits.messageMaxChars) {
      toast('Mesaj en fazla ' + state.limits.messageMaxChars + ' karakter olabilir.', 'error')
      return
    }
    if (!channelId || !hasActiveKey()) {
      toast(TEXT.keyNeeded, 'error')
      return
    }
    const files = ready.map((a) => {
      const f = { u: a.uploadId, k: a.key, n: a.nonce, kind: a.kind, name: a.name, m: a.mime, s: a.size }
      if (a.w) f.w = a.w
      if (a.h) f.h = a.h
      return f
    })
    let body = ''
    try {
      body = window.E2EE.sealJson(activeKid(), { v: 1, a: state.me.id, c: channelId, t: text, f: files })
    } catch (err) {
      toast('Mesaj şifrelenemedi.', 'error')
      return
    }
    if (body.length > state.limits.maxBodyChars) {
      toast('Mesaj çok uzun.', 'error')
      return
    }
    state.sending = true
    updateSendState()
    const payload = { channelId: channelId, body: body }
    if (ready.length) payload.uploads = ready.map((a) => a.uploadId)
    const res = await api('POST', '/api/messages', payload)
    state.sending = false
    if (res.status === 200 && res.data && res.data.message) {
      if (el.composerInput.value === raw) el.composerInput.value = ''
      ready.forEach((a) => {
        removeAttachment(a, true)
      })
      onComposerInput()
      if (sameId(channelId, state.channelId)) {
        insertMessage(res.data.message, { own: true })
        markRead()
      }
      return
    }
    updateSendState()
    toast(errorText(res, 'Mesaj gönderilemedi.'), 'error')
  }

  // Ek ekleme: Fotoğraf ve Dosya düğmeleri, yapıştırma, sürükle-bırak

  function addFiles (fileList, mode) {
    const files = Array.from(fileList || [])
    if (!files.length) return
    if (!hasActiveKey() || !state.channelId) {
      toast(TEXT.keyNeeded, 'error')
      return
    }
    const max = state.limits.maxUploadsPerMessage
    let skipped = 0
    files.forEach((file) => {
      if (state.attachments.length >= max) {
        skipped += 1
        return
      }
      const photo = mode === 'photo' || (mode === 'auto' && /^image\//i.test(file.type || ''))
      state.attachSeq += 1
      const att = {
        id: state.attachSeq,
        file: file,
        photo: photo,
        name: cleanFileName(file.name || (photo ? 'fotograf' : 'dosya')),
        status: 'processing',
        progress: 0,
        kind: 'file',
        mime: '',
        size: file.size || 0,
        w: 0,
        h: 0,
        previewUrl: '',
        box: null,
        key: '',
        nonce: '',
        uploadId: '',
        xhr: null,
        error: '',
        removed: false
      }
      state.attachments.push(att)
      processAttachment(att)
    })
    if (skipped) toast('Bir mesajda en fazla ' + max + ' ek gönderilebilir.', 'error')
    renderAttachments()
    updateSendState()
  }

  async function processAttachment (att) {
    try {
      const bytes = await readBlobBytes(att.file)
      if (att.removed) return
      let out = { bytes: bytes, kind: 'file', mime: (att.file.type || 'application/octet-stream').slice(0, 100), w: 0, h: 0, name: att.name }
      if (att.photo) out = await processPhoto(bytes, att)
      if (att.removed) return
      if (out.bytes.length + 16 > state.limits.uploadMaxBytes) {
        throw new Error('Dosya çok büyük. En fazla ' + formatSize(state.limits.uploadMaxBytes - 16) + ' gönderilebilir.')
      }
      att.kind = out.kind
      att.mime = out.mime
      att.size = out.bytes.length
      att.w = out.w
      att.h = out.h
      att.name = out.name
      if (out.kind === 'image' && IMAGE_TYPES.indexOf(out.mime) !== -1) {
        att.previewUrl = URL.createObjectURL(new Blob([out.bytes], { type: out.mime }))
      }
      att.status = 'encrypting'
      renderAttachments()
      await wait(0)
      if (att.removed) return
      const enc = window.E2EE.encryptFile(out.bytes)
      att.box = enc.box
      att.key = enc.key
      att.nonce = enc.nonce
      att.status = 'queued'
      renderAttachments()
      pumpUploads()
    } catch (err) {
      if (att.removed) return
      att.status = 'error'
      att.error = err && err.message ? err.message : 'Dosya hazırlanamadı.'
      renderAttachments()
      updateSendState()
    }
  }

  // Fotoğraf işleme (Ek A2): GIF olduğu gibi, diğerleri canvas ile yeniden kodlanır.
  // Yeniden kodlama EXIF ve konum dahil tüm üst veriyi siler.
  async function processPhoto (bytes, att) {
    const sniffed = window.E2EE.sniffImage(bytes)
    const declared = String(att.file.type || '').toLowerCase()
    if (sniffed === 'image/gif') {
      const dims = await decodeImage(bytes, 'image/gif')
      if (dims) dims.release()
      return { bytes: bytes, kind: 'image', mime: 'image/gif', w: dims ? dims.w : 0, h: dims ? dims.h : 0, name: att.name }
    }
    const decodeType = sniffed || (declared.indexOf('image/') === 0 ? declared : 'application/octet-stream')
    const decoded = await decodeImage(bytes, decodeType)
    if (!decoded) {
      return { bytes: bytes, kind: 'file', mime: (declared || 'application/octet-stream').slice(0, 100), w: 0, h: 0, name: att.name }
    }
    const wantPng = sniffed === 'image/png'
    let encoded = null
    try {
      encoded = await reencode(decoded.image, wantPng ? 'image/png' : 'image/jpeg')
    } catch (err) {
      encoded = null
    }
    decoded.release()
    if (encoded) {
      const ext = IMAGE_EXT[encoded.mime] || 'jpg'
      return { bytes: encoded.bytes, kind: 'image', mime: encoded.mime, w: encoded.w, h: encoded.h, name: cleanFileName(replaceExt(att.name, ext)) }
    }
    // Canvas başarısız: JPEG ve diğerleri özgün gönderilmez, konum bilgisi sızabilir
    if (sniffed === 'image/png' || sniffed === 'image/webp') {
      return { bytes: bytes, kind: 'image', mime: sniffed, w: decoded.w, h: decoded.h, name: att.name }
    }
    throw new Error(TEXT.photoFailed)
  }

  function decodeImage (bytes, type) {
    return new Promise((resolve) => {
      let url = ''
      let done = false
      const img = new Image()
      const release = () => {
        if (url) {
          try {
            URL.revokeObjectURL(url)
          } catch (err) {
            // Zaten bırakılmış
          }
          url = ''
        }
      }
      const finish = (ok) => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (ok && img.naturalWidth > 0 && img.naturalHeight > 0) {
          resolve({ image: img, w: img.naturalWidth, h: img.naturalHeight, release: release })
        } else {
          release()
          resolve(null)
        }
      }
      const timer = setTimeout(() => {
        finish(false)
      }, 30000)
      img.onload = () => {
        finish(true)
      }
      img.onerror = () => {
        finish(false)
      }
      try {
        url = URL.createObjectURL(new Blob([bytes], { type: type }))
        img.src = url
      } catch (err) {
        finish(false)
      }
    })
  }

  function canvasToBytes (canvas, type, quality) {
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob === 'function') {
        try {
          canvas.toBlob((blob) => {
            if (!blob) {
              reject(new Error('toBlob başarısız'))
              return
            }
            readBlobBytes(blob).then(resolve, reject)
          }, type, quality)
          return
        } catch (err) {
          reject(err)
          return
        }
      }
      try {
        const dataUrl = canvas.toDataURL(type, quality)
        const comma = dataUrl.indexOf(',')
        const bin = window.atob(dataUrl.slice(comma + 1))
        const out = new Uint8Array(bin.length)
        let i = 0
        while (i < bin.length) {
          out[i] = bin.charCodeAt(i)
          i += 1
        }
        resolve(out)
      } catch (err) {
        reject(err)
      }
    })
  }

  async function reencode (image, type) {
    const w0 = image.naturalWidth
    const h0 = image.naturalHeight
    const scale = Math.min(1, PHOTO_MAX_EDGE / Math.max(w0, h0))
    const w = Math.max(1, Math.round(w0 * scale))
    const hh = Math.max(1, Math.round(h0 * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = hh
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas yok')
    if (type === 'image/jpeg') {
      // Saydam alanlar JPEG'de siyah görünmesin
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, hh)
    }
    ctx.drawImage(image, 0, 0, w, hh)
    const bytes = await canvasToBytes(canvas, type, type === 'image/jpeg' ? JPEG_QUALITY : undefined)
    const actual = window.E2EE.sniffImage(bytes)
    if (!actual || IMAGE_TYPES.indexOf(actual) === -1) throw new Error('Kodlama başarısız')
    canvas.width = 1
    canvas.height = 1
    return { bytes: bytes, mime: actual, w: w, h: hh }
  }

  // Yükleme kuyruğu: en fazla iki eşzamanlı yükleme, 503'te 2 sn arayla 3 kez yeniden deneme.

  function pumpUploads () {
    while (state.activeUploads < UPLOAD_PARALLEL) {
      const next = state.attachments.filter((a) => a.status === 'queued')[0]
      if (!next) return
      runUpload(next)
    }
  }

  async function runUpload (att) {
    state.activeUploads += 1
    att.status = 'uploading'
    att.progress = 0
    renderAttachments()
    let tries = 0
    while (!att.removed) {
      const pending = request('POST', '/api/uploads', {
        binary: att.box,
        timeout: TRANSFER_TIMEOUT_MS,
        onUploadProgress: (e) => {
          if (e && e.lengthComputable && e.total > 0) {
            att.progress = e.loaded / e.total
            updateChipProgress(att)
          }
        }
      })
      att.xhr = pending
      const res = await pending
      att.xhr = null
      if (att.removed) break
      if (res.status === 200 && res.data && typeof res.data.id === 'string' && UPLOAD_ID_RE.test(res.data.id)) {
        att.uploadId = res.data.id
        att.status = 'done'
        att.progress = 1
        att.box = null
        break
      }
      if (res.status === 503 && tries < UPLOAD_RETRY_MAX) {
        tries += 1
        att.status = 'retry'
        att.error = errorText(res, 'Sunucu meşgul.')
        renderAttachments()
        await wait(UPLOAD_RETRY_MS)
        if (att.removed) break
        att.status = 'uploading'
        att.progress = 0
        renderAttachments()
        continue
      }
      checkAuthFailure(res)
      att.status = 'error'
      att.error = errorText(res, 'Yükleme başarısız.')
      break
    }
    state.activeUploads -= 1
    renderAttachments()
    updateSendState()
    pumpUploads()
  }

  function removeAttachment (att, keepFocus) {
    att.removed = true
    if (att.xhr) att.xhr.abort()
    if (att.previewUrl) {
      try {
        URL.revokeObjectURL(att.previewUrl)
      } catch (err) {
        // Zaten bırakılmış
      }
    }
    att.box = null
    state.attachments = state.attachments.filter((a) => a !== att)
    renderAttachments()
    updateSendState()
    if (!keepFocus) focusNode(el.composerInput.disabled ? el.btnFile : el.composerInput)
  }

  function clearAttachments () {
    state.attachments.slice().forEach((att) => {
      removeAttachment(att, true)
    })
  }

  // Ek çipleri

  const STATUS_TEXT = {
    processing: 'Hazırlanıyor...',
    encrypting: 'Şifreleniyor...',
    queued: 'Sırada',
    uploading: 'Yükleniyor',
    retry: 'Sunucu meşgul, yeniden denenecek',
    done: 'Hazır',
    error: 'Hata'
  }

  function renderAttachments () {
    const list = el.attachList
    const focusKey = activeFocusKey(list)
    clear(list)
    state.attachments.forEach((att) => {
      const li = h('li', 'chip chip-' + att.status)
      li.setAttribute('data-attach-id', String(att.id))
      if (att.previewUrl) {
        const img = h('img', 'chip-preview')
        img.alt = ''
        img.src = att.previewUrl
        li.appendChild(img)
      } else {
        li.appendChild(icon(att.photo && att.status === 'processing' ? 'i-image' : (FILE_ICONS[fileKind(att.name)] || 'i-file'), 'chip-icon'))
      }
      const info = h('span', 'chip-info')
      info.appendChild(h('span', 'chip-name', att.name))
      const meta = h('span', 'chip-meta')
      let status = STATUS_TEXT[att.status] || ''
      if (att.status === 'uploading') status += ' %' + Math.round(att.progress * 100)
      if (att.status === 'error') status = att.error || status
      meta.textContent = formatSize(att.size) + ' · ' + status
      info.appendChild(meta)
      const bar = h('span', 'chip-bar')
      const fill = h('span', 'chip-bar-fill')
      fill.style.width = Math.round((att.status === 'done' ? 1 : att.progress) * 100) + '%'
      bar.appendChild(fill)
      info.appendChild(bar)
      li.appendChild(info)
      const remove = button('icon-button chip-remove', '', 'i-close', 'Kaldır: ' + att.name)
      remove.setAttribute('data-focus-key', 'remove-' + att.id)
      remove.addEventListener('click', () => {
        removeAttachment(att, false)
      })
      li.appendChild(remove)
      list.appendChild(li)
    })
    list.hidden = state.attachments.length === 0
    el.photoNote.hidden = !state.attachments.some((a) => a.photo)
    restoreFocusKey(list, focusKey)
    keepBottom()
  }

  function updateChipProgress (att) {
    const li = Array.from(el.attachList.children).filter((node) => node.getAttribute('data-attach-id') === String(att.id))[0]
    if (!li) return
    const fill = li.querySelector('.chip-bar-fill')
    const meta = li.querySelector('.chip-meta')
    const pct = Math.round(att.progress * 100)
    if (fill) fill.style.width = pct + '%'
    if (meta) meta.textContent = formatSize(att.size) + ' · ' + STATUS_TEXT.uploading + ' %' + pct
  }

  // Yapıştırma ve sürükle-bırak

  function onPaste (e) {
    const data = e.clipboardData
    if (!data) return
    let files = Array.from(data.files || [])
    if (!files.length && data.items) {
      files = Array.from(data.items).filter((item) => item.kind === 'file').map((item) => item.getAsFile()).filter(Boolean)
    }
    if (!files.length) return
    e.preventDefault()
    addFiles(files, 'auto')
  }

  let dragDepth = 0

  function hasDraggedFiles (e) {
    const types = e.dataTransfer && e.dataTransfer.types ? Array.from(e.dataTransfer.types) : []
    return types.indexOf('Files') !== -1
  }

  function onDragEnter (e) {
    if (!hasDraggedFiles(e)) return
    e.preventDefault()
    dragDepth += 1
    if (hasActiveKey() && state.channelId) el.dropOverlay.hidden = false
  }

  function onDragOver (e) {
    if (!hasDraggedFiles(e)) return
    e.preventDefault()
    try {
      e.dataTransfer.dropEffect = 'copy'
    } catch (err) {
      // Bazı tarayıcılarda salt okunur
    }
  }

  function onDragLeave (e) {
    if (!hasDraggedFiles(e)) return
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) el.dropOverlay.hidden = true
  }

  function onDrop (e) {
    if (!hasDraggedFiles(e)) return
    e.preventDefault()
    dragDepth = 0
    el.dropOverlay.hidden = true
    addFiles(e.dataTransfer.files, 'auto')
  }

  // Emoji seçici (Ek A3)

  let emojiBuilt = false

  function emojiData () {
    const data = Array.isArray(window.EMOJI_DATA) ? window.EMOJI_DATA : []
    return data.filter((c) => c && typeof c.key === 'string' && typeof c.list === 'string')
  }

  function recentEmoji () {
    const raw = storeGet(KEYS.recentEmoji)
    if (!raw) return []
    try {
      const list = JSON.parse(raw)
      return Array.isArray(list) ? list.filter((e) => typeof e === 'string' && e.length > 0 && e.length <= 32).slice(0, RECENT_EMOJI_MAX) : []
    } catch (err) {
      return []
    }
  }

  function rememberEmoji (emoji) {
    const list = recentEmoji().filter((e) => e !== emoji)
    list.unshift(emoji)
    storeSet(KEYS.recentEmoji, JSON.stringify(list.slice(0, RECENT_EMOJI_MAX)))
  }

  function emojiCategories () {
    const cats = [{ key: 'recent', label: 'Son kullanılanlar', items: recentEmoji(), tabIcon: null }]
    emojiData().forEach((c) => {
      const items = c.list.split(' ').filter(Boolean)
      cats.push({ key: c.key, label: String(c.label || c.key), items: items, tabIcon: items[0] || '?' })
    })
    return cats
  }

  function buildEmojiTabs () {
    clear(el.emojiTabs)
    emojiCategories().forEach((c) => {
      const tab = h('button', 'emoji-tab')
      tab.type = 'button'
      tab.setAttribute('role', 'tab')
      tab.setAttribute('data-category', c.key)
      tab.setAttribute('aria-label', c.label)
      tab.title = c.label
      tab.setAttribute('aria-controls', 'emoji-grid')
      if (c.tabIcon) {
        tab.appendChild(h('span', 'emoji-glyph', c.tabIcon))
      } else {
        tab.appendChild(h('span', 'emoji-glyph', '🕘'))
      }
      tab.addEventListener('click', () => {
        selectEmojiCategory(c.key, false, true)
      })
      el.emojiTabs.appendChild(tab)
    })
    emojiBuilt = true
  }

  function selectEmojiCategory (key, focusTab, explicit) {
    const cats = emojiCategories()
    let cat = cats.filter((c) => c.key === key)[0] || cats[0]
    if (!explicit && cat.key === 'recent' && !cat.items.length && cats.length > 1) cat = cats[1]
    Array.from(el.emojiTabs.children).forEach((tab) => {
      const selected = tab.getAttribute('data-category') === cat.key
      tab.setAttribute('aria-selected', selected ? 'true' : 'false')
      tab.tabIndex = selected ? 0 : -1
      if (selected && focusTab) focusNode(tab)
    })
    el.emojiTitle.textContent = cat.label
    clear(el.emojiGrid)
    if (!cat.items.length) {
      el.emojiGrid.appendChild(h('p', 'emoji-empty', 'Henüz emoji kullanılmadı.'))
      return
    }
    const frag = document.createDocumentFragment()
    cat.items.forEach((emoji) => {
      const b = h('button', 'emoji-button', emoji)
      b.type = 'button'
      b.setAttribute('aria-label', emoji)
      b.setAttribute('data-emoji', emoji)
      frag.appendChild(b)
    })
    el.emojiGrid.appendChild(frag)
    el.emojiGrid.scrollTop = 0
  }

  function openEmojiPicker () {
    if (el.btnEmoji.disabled) return
    const existing = findLayer('emoji')
    if (existing) {
      closeLayer(existing, true)
      return
    }
    if (!emojiBuilt) buildEmojiTabs()
    const first = recentEmoji().length ? 'recent' : (emojiData()[0] ? emojiData()[0].key : 'recent')
    selectEmojiCategory(first, false)
    el.emojiPicker.hidden = false
    el.emojiPicker.classList.toggle('is-sheet', isNarrow())
    el.btnEmoji.setAttribute('aria-expanded', 'true')
    openLayer({
      name: 'emoji',
      el: el.emojiPicker,
      trigger: el.btnEmoji,
      level: 1,
      outside: true,
      trap: true,
      initialFocus: () => el.emojiGrid.querySelector('.emoji-button') || el.emojiTabs.querySelector('[aria-selected="true"]'),
      onClose: () => {
        el.emojiPicker.hidden = true
        el.btnEmoji.setAttribute('aria-expanded', 'false')
      }
    })
  }

  function insertAtCursor (ta, text) {
    const value = ta.value
    const from = typeof ta.selectionStart === 'number' ? ta.selectionStart : value.length
    const to = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : value.length
    ta.value = value.slice(0, from) + text + value.slice(to)
    const pos = from + text.length
    try {
      ta.setSelectionRange(pos, pos)
    } catch (err) {
      // Seçim desteklenmiyor
    }
    onComposerInput()
  }

  function onEmojiGridClick (e) {
    const target = e.target && e.target.closest ? e.target.closest('.emoji-button') : null
    if (!target) return
    const emoji = target.getAttribute('data-emoji')
    if (!emoji) return
    insertAtCursor(el.composerInput, emoji)
    rememberEmoji(emoji)
    if (e.shiftKey) return
    const layer = findLayer('emoji')
    if (layer) closeLayer(layer, false)
    focusNode(el.composerInput)
  }

  function gridColumns (buttons) {
    if (!buttons.length) return 1
    const top = buttons[0].offsetTop
    let cols = 0
    buttons.some((b) => {
      if (b.offsetTop !== top) return true
      cols += 1
      return false
    })
    return Math.max(1, cols)
  }

  function onEmojiGridKey (e) {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']
    if (keys.indexOf(e.key) === -1) return
    const buttons = Array.from(el.emojiGrid.querySelectorAll('.emoji-button'))
    const i = buttons.indexOf(document.activeElement)
    if (i === -1) return
    e.preventDefault()
    const cols = gridColumns(buttons)
    let next = i
    if (e.key === 'ArrowLeft') next = i - 1
    else if (e.key === 'ArrowRight') next = i + 1
    else if (e.key === 'ArrowUp') next = i - cols
    else if (e.key === 'ArrowDown') next = i + cols
    else if (e.key === 'Home') next = 0
    else next = buttons.length - 1
    if (next < 0) {
      const tab = el.emojiTabs.querySelector('[aria-selected="true"]')
      focusNode(tab)
      return
    }
    focusNode(buttons[Math.min(buttons.length - 1, next)])
  }

  function onEmojiTabsKey (e) {
    const tabs = Array.from(el.emojiTabs.children)
    const i = tabs.indexOf(document.activeElement)
    if (i === -1) return
    let next = -1
    if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusNode(el.emojiGrid.querySelector('.emoji-button'))
      return
    }
    if (next === -1) return
    e.preventDefault()
    selectEmojiCategory(tabs[next].getAttribute('data-category'), true, true)
  }

  // Ses arayüzü (5.8). Bağlantı mantığı voice.js içindeki VoiceClient'tadır.

  function createVoice () {
    const factory = window.VoiceClient
    if (!factory || typeof factory.create !== 'function') return
    try {
      voice = factory.create({
        api: (method, path, body) => api(method, path, body === undefined ? null : body),
        seal: (obj) => window.E2EE.sealJson(activeKid(), obj),
        open: (envelope) => window.E2EE.openJson(envelope),
        onChange: onVoiceChange,
        storage: {
          get: (key) => storeGet(key),
          set: (key, value) => {
            storeSet(key, value)
          }
        }
      })
    } catch (err) {
      window.console.error(err)
      voice = null
      return
    }
    const mic = storeGet(KEYS.mic)
    if (mic) {
      try {
        voice.setInputDevice(mic)
      } catch (err) {
        // Cihaz daha sonra seçilebilir
      }
    }
    try {
      state.voiceSnap = voice.snapshot()
    } catch (err) {
      state.voiceSnap = null
    }
  }

  function snap () {
    return state.voiceSnap || { channelId: null, joining: false, muted: false, deafened: false, ptt: { enabled: false, code: 'KeyV', active: false }, selfSpeaking: false, inputLevel: 0, error: null, autoplayBlocked: false, peers: {} }
  }

  let voiceRenderQueued = false
  let lastVoiceError = null

  function onVoiceChange (snapshot) {
    state.voiceSnap = snapshot || null
    const err = snapshot && snapshot.error ? snapshot.error : null
    if (err && err !== lastVoiceError) toast(err, 'error', 8000)
    lastVoiceError = err
    if (voiceRenderQueued) return
    voiceRenderQueued = true
    nextFrame(() => {
      voiceRenderQueued = false
      if (!state.inApp) return
      const key = voiceStructureKey()
      if (key !== state.voiceKey) {
        renderVoiceAll()
      } else {
        updateVoiceLive()
      }
    })
  }

  function voiceStructureKey () {
    const s = snap()
    const peers = s.peers || {}
    const peerKey = Object.keys(peers).sort().map((id) => id + ':' + peers[id].status + ':' + (peers[id].localMute ? 1 : 0)).join(',')
    const roster = state.meta && state.meta.voice ? JSON.stringify(state.meta.voice) : ''
    const channels = voiceChannels().map((c) => c.id + ':' + c.name).join(',')
    return [s.channelId, s.joining, s.muted, s.deafened, s.error, s.autoplayBlocked, s.ptt && s.ptt.enabled, s.ptt && s.ptt.code, peerKey, roster, channels].join('|')
  }

  function renderVoiceAll () {
    state.voiceKey = voiceStructureKey()
    renderVoiceChannels()
    renderVoicePanel()
    renderUserPanel()
    updateVoiceLive()
    if (isSettingsTab('voice')) renderSettingsVoice()
  }

  function voiceRoster (channelId) {
    const roster = state.meta && state.meta.voice ? state.meta.voice[channelId] || state.meta.voice[String(channelId)] : null
    return Array.isArray(roster) ? roster : []
  }

  function renderVoiceChannels () {
    const focusKey = activeFocusKey(el.voiceChannels)
    const s = snap()
    clear(el.voiceChannels)
    voiceChannels().forEach((c) => {
      const li = h('li', 'channel-row voice-row')
      const roster = voiceRoster(c.id)
      const joined = sameId(s.channelId, c.id)
      const b = h('button', 'channel-item voice-channel' + (joined ? ' is-joined' : ''))
      b.type = 'button'
      b.setAttribute('data-channel-id', String(c.id))
      b.setAttribute('data-focus-key', 'voice-' + c.id)
      b.appendChild(icon('i-speaker', 'channel-icon'))
      b.appendChild(h('span', 'channel-name', c.name))
      if (roster.length) b.appendChild(h('span', 'voice-count', roster.length + '/8'))
      let label = c.name + ' ses kanalı, ' + roster.length + ' kişi'
      if (joined) label += ', bağlısın'
      else label += ', katılmak için seç'
      b.setAttribute('aria-label', label)
      if (joined) b.setAttribute('aria-current', 'true')
      b.addEventListener('click', () => {
        joinVoice(c.id)
      })
      li.appendChild(b)
      if (roster.length) {
        const ul = h('ul', 'voice-members')
        ul.setAttribute('aria-label', c.name + ' kanalındakiler')
        roster.forEach((entry) => {
          ul.appendChild(buildVoiceMember(entry, joined))
        })
        li.appendChild(ul)
      }
      el.voiceChannels.appendChild(li)
    })
    restoreFocusKey(el.voiceChannels, focusKey)
  }

  function buildVoiceMember (entry, sameChannel) {
    const s = snap()
    const self = state.me && sameId(entry.userId, state.me.id)
    const name = userName(entry.userId)
    const peer = s.peers ? s.peers[String(entry.userId)] : null
    const muted = self ? s.muted : entry.muted === true
    const deafened = self ? s.deafened : entry.deafened === true
    const li = h('li', 'voice-member')
    li.setAttribute('data-user-id', String(entry.userId))
    const inner = h(self ? 'div' : 'button', 'voice-member-inner')
    if (!self) {
      inner.type = 'button'
      inner.setAttribute('data-focus-key', 'vm-' + entry.userId)
      inner.setAttribute('aria-haspopup', 'dialog')
      inner.addEventListener('click', () => {
        openPeerPopover(entry.userId, inner, sameChannel)
      })
    }
    const av = avatar(entry.userId, name, 'avatar-small')
    inner.appendChild(av)
    inner.appendChild(h('span', 'voice-member-name', name + (self ? ' (sen)' : '')))
    const states = []
    if (!self && sameChannel && peer && peer.status === 'failed') {
      const warn = h('span', 'voice-flag voice-flag-error')
      warn.appendChild(icon('i-alert'))
      warn.title = TEXT.voiceFailedPeer
      inner.appendChild(warn)
      states.push(TEXT.voiceFailedPeer)
    }
    if (!self && peer && peer.localMute) states.push('yerel olarak susturuldu')
    if (muted) {
      const m = h('span', 'voice-flag')
      m.appendChild(icon('i-mic-off'))
      m.title = 'Mikrofonu kapalı'
      inner.appendChild(m)
      states.push('mikrofonu kapalı')
    }
    if (deafened) {
      const d = h('span', 'voice-flag')
      d.appendChild(icon('i-headphones-off'))
      d.title = 'Sağırlaştırılmış'
      inner.appendChild(d)
      states.push('sağırlaştırılmış')
    }
    const label = name + (self ? ' (sen)' : '') + (states.length ? ', ' + states.join(', ') : '')
    inner.setAttribute('aria-label', self ? label : label + ', ses ayarları')
    li.appendChild(inner)
    return li
  }

  // Konuşma halkası ve giriş seviyesi gibi sık değişen göstergeler
  function updateVoiceLive () {
    const s = snap()
    Array.from(el.voiceChannels.querySelectorAll('.voice-member')).forEach((li) => {
      const userId = li.getAttribute('data-user-id')
      const channelLi = li.closest('.voice-row')
      const channelButton = channelLi ? channelLi.querySelector('.voice-channel') : null
      const sameChannel = channelButton && sameId(channelButton.getAttribute('data-channel-id'), s.channelId)
      let speaking = false
      if (sameChannel) {
        if (state.me && sameId(userId, state.me.id)) speaking = s.selfSpeaking === true
        else speaking = Boolean(s.peers && s.peers[userId] && s.peers[userId].speaking)
      }
      li.classList.toggle('is-speaking', speaking)
    })
    el.meAvatar.classList.toggle('is-speaking', Boolean(s.channelId && s.selfSpeaking))
    if (isSettingsTab('voice')) updateLevelMeter()
    const pttActive = Boolean(s.ptt && s.ptt.active)
    el.pttButton.classList.toggle('is-active', pttActive)
    el.pttButton.textContent = pttActive ? 'Konuşuyorsun' : 'Bas konuş'
  }

  function renderVoicePanel () {
    const s = snap()
    const ch = s.channelId ? findChannel(s.channelId) : null
    const inVoice = Boolean(s.channelId)
    el.voicePanel.hidden = !inVoice && !s.joining
    const chName = ch ? ch.name : ''
    el.voicePanelStatus.textContent = s.joining ? 'Bağlanıyor...' : inVoice ? 'Ses bağlı: ' + chName : 'Ses bağlı değil'
    el.voicePanelStatus.classList.toggle('is-connected', inVoice && !s.joining)
    el.voicePanelChannel.textContent = s.joining ? chName : ''
    el.voicePanelChannel.hidden = !s.joining
    el.voiceLeave.hidden = !inVoice && !s.joining
    setMsg(el.voiceError, s.error || '', 'error')
    el.voiceUnlock.hidden = !(inVoice && s.autoplayBlocked)
    el.pttButton.hidden = !(inVoice && s.ptt && s.ptt.enabled)
    el.voiceStrip.hidden = !inVoice
    el.voiceStripText.textContent = 'Seste: ' + (ch ? ch.name : '')
  }

  function renderUserPanel () {
    if (!state.me) return
    const s = snap()
    el.meName.textContent = state.me.name
    el.meAvatar.textContent = initial(state.me.name)
    el.meAvatar.className = 'avatar ' + avatarClass(state.me.id)
    const ch = s.channelId ? findChannel(s.channelId) : null
    el.meStatus.textContent = s.joining ? 'Sese bağlanıyor...' : ch ? 'Seste: ' + ch.name : 'Çevrimiçi'
    el.btnMute.setAttribute('aria-pressed', s.muted ? 'true' : 'false')
    setIcon(el.btnMute, s.muted ? 'i-mic-off' : 'i-mic')
    el.btnMute.classList.toggle('is-off', Boolean(s.muted))
    el.btnDeafen.setAttribute('aria-pressed', s.deafened ? 'true' : 'false')
    setIcon(el.btnDeafen, s.deafened ? 'i-headphones-off' : 'i-headphones')
    el.btnDeafen.classList.toggle('is-off', Boolean(s.deafened))
  }

  function voiceSupportProblem () {
    if (!voice) return TEXT.voiceUnsupported
    let support = null
    try {
      support = voice.support()
    } catch (err) {
      support = { ok: false, reason: 'unsupported' }
    }
    if (!support || !support.ok) return support && support.reason === 'insecure' ? TEXT.voiceInsecure : TEXT.voiceUnsupported
    if (!hasActiveKey()) return TEXT.voiceNoKey
    return ''
  }

  function joinVoice (channelId) {
    const problem = voiceSupportProblem()
    if (problem) {
      toast(problem, 'error', 9000)
      return
    }
    const s = snap()
    if (sameId(s.channelId, channelId) || s.joining) return
    closeDrawers()
    let pending = null
    try {
      pending = voice.join(channelId)
    } catch (err) {
      toast(err && err.message ? err.message : 'Sesli sohbete katılınamadı.', 'error')
      return
    }
    Promise.resolve(pending).then(() => {}, (err) => {
      toast(err && err.message ? err.message : 'Sesli sohbete katılınamadı.', 'error', 8000)
    })
  }

  function leaveVoice () {
    if (!voice) return
    Promise.resolve(voice.leave()).catch(() => {})
  }

  function toggleMute () {
    if (!voice) {
      toast(TEXT.voiceUnsupported, 'error')
      return
    }
    const s = snap()
    if (s.deafened) {
      // Sağırken mikrofonu açmak sağırlaştırmayı da kaldırır (Discord davranışı)
      voice.setDeafened(false)
      voice.setMuted(false)
      return
    }
    voice.setMuted(!s.muted)
  }

  function toggleDeafen () {
    if (!voice) {
      toast(TEXT.voiceUnsupported, 'error')
      return
    }
    voice.setDeafened(!snap().deafened)
  }

  // Bas-konuş butonu (dokunmatik ve fare, basılı tutulduğu sürece)

  function bindPttButton () {
    const down = (e) => {
      if (e && e.cancelable) e.preventDefault()
      if (voice) voice.pttDown()
    }
    const up = () => {
      if (voice) voice.pttUp()
    }
    if (window.PointerEvent) {
      el.pttButton.addEventListener('pointerdown', (e) => {
        try {
          el.pttButton.setPointerCapture(e.pointerId)
        } catch (err) {
          // Yakalama desteklenmiyor
        }
        down(e)
      })
      el.pttButton.addEventListener('pointerup', up)
      el.pttButton.addEventListener('pointercancel', up)
      el.pttButton.addEventListener('lostpointercapture', up)
    } else {
      el.pttButton.addEventListener('mousedown', down)
      el.pttButton.addEventListener('mouseup', up)
      el.pttButton.addEventListener('mouseleave', up)
      el.pttButton.addEventListener('touchstart', down)
      el.pttButton.addEventListener('touchend', up)
      el.pttButton.addEventListener('touchcancel', up)
    }
    el.pttButton.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
        e.preventDefault()
        down(null)
      }
    })
    el.pttButton.addEventListener('keyup', (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        up()
      }
    })
    el.pttButton.addEventListener('blur', up)
    el.pttButton.addEventListener('contextmenu', (e) => {
      e.preventDefault()
    })
  }

  // Ses kanalındaki kişi için yerel ses seviyesi ve susturma

  let popoverUserId = null

  // Kişi ses seviyesi voice.js tarafından kullanıcı kimliğine göre saklanır. Kişi aynı kanalda
  // değilken gösterim için yerel kopya da tutulur.
  function peerVolumeValue (userId) {
    const s = snap()
    const peer = s.peers ? s.peers[String(userId)] : null
    if (peer && typeof peer.volume === 'number') return Math.round(Math.max(0, Math.min(1, peer.volume)) * 100)
    const stored = storeGetJson(KEYS.peerVolume, {})
    const value = stored[String(userId)]
    return typeof value === 'number' && value >= 0 && value <= 100 ? value : 100
  }

  function openPeerPopover (userId, trigger, sameChannel) {
    const existing = findLayer('peer')
    if (existing) {
      const same = sameId(popoverUserId, userId)
      closeLayer(existing, false)
      if (same) return
    }
    popoverUserId = userId
    el.peerName.textContent = userName(userId)
    const value = peerVolumeValue(userId)
    el.peerVolume.value = String(value)
    el.peerVolumeValue.textContent = '%' + value
    renderPeerMute()
    setMsg(el.peerNote, sameChannel ? '' : 'Ayarlar bu kişiyle aynı ses kanalına katıldığında uygulanır.')
    el.peerPopover.hidden = false
    positionPopup(el.peerPopover, trigger)
    openLayer({
      name: 'peer',
      el: el.peerPopover,
      trigger: trigger,
      level: 2,
      outside: true,
      trap: true,
      initialFocus: () => el.peerVolume,
      onClose: () => {
        el.peerPopover.hidden = true
        popoverUserId = null
      }
    })
  }

  function voiceUserArg (userId) {
    return isNaN(Number(userId)) ? userId : Number(userId)
  }

  function renderPeerMute () {
    const s = snap()
    const peer = s.peers ? s.peers[String(popoverUserId)] : null
    const muted = Boolean(peer && peer.localMute)
    el.peerMute.setAttribute('aria-pressed', muted ? 'true' : 'false')
    el.peerMute.textContent = muted ? 'Susturmayı kaldır' : 'Sustur'
    el.peerMute.disabled = !peer
  }

  function onPeerVolumeInput () {
    if (popoverUserId === null) return
    const value = Math.max(0, Math.min(100, Math.round(Number(el.peerVolume.value) || 0)))
    el.peerVolumeValue.textContent = '%' + value
    const stored = storeGetJson(KEYS.peerVolume, {})
    stored[String(popoverUserId)] = value
    storeSetJson(KEYS.peerVolume, stored)
    if (voice) {
      try {
        voice.setPeerVolume(voiceUserArg(popoverUserId), value / 100)
      } catch (err) {
        // Eş bağlı değil, değer saklandı
      }
    }
  }

  function onPeerMuteClick () {
    if (popoverUserId === null || !voice) return
    const s = snap()
    const peer = s.peers ? s.peers[String(popoverUserId)] : null
    if (!peer) return
    voice.setPeerLocalMute(voiceUserArg(popoverUserId), !peer.localMute)
    nextFrame(renderPeerMute)
  }

  // Ayarlar penceresi (5.7)

  const SETTINGS_TABS = ['account', 'voice', 'crypto', 'server', 'members']
  let settingsTab = 'account'
  let capturingPtt = false

  function tabEl (name) {
    return el['settingsTab' + name.charAt(0).toUpperCase() + name.slice(1)]
  }

  function panelEl (name) {
    return el['settingsPanel' + name.charAt(0).toUpperCase() + name.slice(1)]
  }

  function visibleTabs () {
    return SETTINGS_TABS.filter((name) => (name === 'server' || name === 'members') ? isAdmin() : true)
  }

  function isSettingsOpen () {
    return Boolean(findLayer('settings'))
  }

  function isSettingsTab (name) {
    return isSettingsOpen() && settingsTab === name
  }

  function openSettings (tab, trigger) {
    if (!state.inApp) return
    closeDrawers()
    const existing = findLayer('settings')
    if (existing) {
      selectSettingsTab(tab || settingsTab, true)
      return
    }
    el.settingsModal.hidden = false
    document.body.classList.add('modal-open')
    selectSettingsTab(tab || 'account', false)
    openLayer({
      name: 'settings',
      el: el.settingsModal,
      trigger: trigger || el.btnSettings,
      level: 1,
      trap: true,
      initialFocus: () => tabEl(settingsTab),
      onClose: () => {
        el.settingsModal.hidden = true
        document.body.classList.remove('modal-open')
        capturingPtt = false
        setKeyVisible(false)
        setInviteVisible(false)
        el.setNewInviteWrap.hidden = true
        el.setNewInvite.value = ''
        el.setTempWrap.hidden = true
        el.setTempPassword.textContent = ''
        el.setOldPassword.value = ''
        el.setNewPassword.value = ''
        el.setNewPassword2.value = ''
      }
    })
    if (isAdmin()) refreshInviteCode()
  }

  function selectSettingsTab (name, focusTab) {
    const tabs = visibleTabs()
    const target = tabs.indexOf(name) !== -1 ? name : 'account'
    settingsTab = target
    SETTINGS_TABS.forEach((n) => {
      const tab = tabEl(n)
      const panel = panelEl(n)
      const allowed = tabs.indexOf(n) !== -1
      tab.hidden = !allowed
      const selected = n === target
      tab.setAttribute('aria-selected', selected ? 'true' : 'false')
      tab.tabIndex = selected ? 0 : -1
      panel.hidden = !selected
    })
    renderSettingsPanel(target)
    if (target === 'voice') fillMicList()
    if (focusTab) focusNode(tabEl(target))
  }

  function onSettingsTabsKey (e) {
    const tabs = visibleTabs()
    const i = tabs.indexOf(settingsTab)
    let next = -1
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % tabs.length
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    if (next === -1) return
    e.preventDefault()
    selectSettingsTab(tabs[next], true)
  }

  function renderSettingsPanel (name) {
    if (name === 'account') renderSettingsAccount()
    else if (name === 'voice') renderSettingsVoice()
    else if (name === 'crypto') renderSettingsCrypto()
    else if (name === 'server') renderSettingsServer()
    else if (name === 'members') renderSettingsMembers()
  }

  // Meta değişince açık ayarlar yeniden çizilir, yetkisi kalmayan sekme kapanır.
  function refreshSettings () {
    if (!isSettingsOpen()) return
    if (visibleTabs().indexOf(settingsTab) === -1) {
      selectSettingsTab('account', true)
      return
    }
    SETTINGS_TABS.forEach((n) => {
      tabEl(n).hidden = visibleTabs().indexOf(n) === -1
    })
    const panel = panelEl(settingsTab)
    const active = document.activeElement
    if (panel.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
      if (settingsTab === 'members') renderSettingsMembers()
      if (settingsTab === 'server') renderServerChannels()
      return
    }
    renderSettingsPanel(settingsTab)
  }

  // Hesap

  function renderSettingsAccount () {
    if (!state.me) return
    el.setAvatar.textContent = initial(state.me.name)
    el.setAvatar.className = 'avatar avatar-large ' + avatarClass(state.me.id)
    el.setName.textContent = state.me.name
    el.setRole.textContent = 'Rol: ' + (ROLE_LABELS[state.me.role] || state.me.role)
    el.setNotify.checked = notificationsEnabled()
    el.setInstallWrap.hidden = !state.installPrompt
    el.setIosHint.hidden = !(isIos() && !isStandalone())
  }

  async function submitPasswordChange (e) {
    e.preventDefault()
    const oldPassword = el.setOldPassword.value
    const newPassword = el.setNewPassword.value
    if (!oldPassword) {
      setMsg(el.setPasswordMsg, 'Mevcut parolayı girin.', 'error')
      return
    }
    const plen = cpLength(newPassword)
    if (plen < state.limits.passwordMin || plen > state.limits.passwordMax) {
      setMsg(el.setPasswordMsg, 'Yeni parola ' + state.limits.passwordMin + ' ile ' + state.limits.passwordMax + ' karakter arasında olmalı.', 'error')
      return
    }
    if (newPassword !== el.setNewPassword2.value) {
      setMsg(el.setPasswordMsg, 'Yeni parolalar aynı değil.', 'error')
      return
    }
    el.setPasswordSubmit.disabled = true
    const res = await api('POST', '/api/me/password', { oldPassword: oldPassword, newPassword: newPassword })
    el.setPasswordSubmit.disabled = false
    if (res.status === 200) {
      el.setOldPassword.value = ''
      el.setNewPassword.value = ''
      el.setNewPassword2.value = ''
      setMsg(el.setPasswordMsg, 'Parola değiştirildi. Diğer cihazlardaki oturumlar kapatıldı.', 'ok')
      return
    }
    setMsg(el.setPasswordMsg, errorText(res, 'Parola değiştirilemedi.'), 'error')
  }

  function onNotifyChange () {
    if (!el.setNotify.checked) {
      storeSet(KEYS.notify, '0')
      setMsg(el.setNotifyMsg, '')
      return
    }
    const N = window.Notification
    if (typeof N !== 'function') {
      el.setNotify.checked = false
      setMsg(el.setNotifyMsg, 'Bu tarayıcı bildirimleri desteklemiyor.', 'error')
      return
    }
    const done = (permission) => {
      if (permission === 'granted') {
        storeSet(KEYS.notify, '1')
        el.setNotify.checked = true
        setMsg(el.setNotifyMsg, 'Bildirimler açıldı.', 'ok')
      } else {
        storeSet(KEYS.notify, '0')
        el.setNotify.checked = false
        setMsg(el.setNotifyMsg, 'Bildirim izni verilmedi. Tarayıcı ayarlarından izin verebilirsiniz.', 'error')
      }
    }
    if (N.permission === 'granted') {
      done('granted')
      return
    }
    try {
      const result = N.requestPermission(done)
      if (result && typeof result.then === 'function') result.then(done, () => done('denied'))
    } catch (err) {
      done('denied')
    }
  }

  async function installApp () {
    const prompt = state.installPrompt
    if (!prompt) return
    state.installPrompt = null
    el.setInstallWrap.hidden = true
    try {
      prompt.prompt()
      await prompt.userChoice
    } catch (err) {
      // Kullanıcı vazgeçti
    }
  }

  // Ses

  function keyName (code) {
    if (!code) return 'Yok'
    const names = {
      Space: 'Boşluk',
      ShiftLeft: 'Sol Shift',
      ShiftRight: 'Sağ Shift',
      ControlLeft: 'Sol Ctrl',
      ControlRight: 'Sağ Ctrl',
      AltLeft: 'Sol Alt',
      AltRight: 'Sağ Alt (AltGr)',
      MetaLeft: 'Sol Windows',
      MetaRight: 'Sağ Windows',
      CapsLock: 'Caps Lock',
      Tab: 'Tab',
      Backquote: '`',
      Enter: 'Enter',
      Backspace: 'Geri',
      Insert: 'Insert',
      Delete: 'Delete',
      Home: 'Home',
      End: 'End',
      PageUp: 'Page Up',
      PageDown: 'Page Down',
      ArrowUp: 'Yukarı ok',
      ArrowDown: 'Aşağı ok',
      ArrowLeft: 'Sol ok',
      ArrowRight: 'Sağ ok'
    }
    if (names[code]) return names[code]
    if (/^Key[A-Z]$/.test(code)) return code.slice(3)
    if (/^Digit[0-9]$/.test(code)) return code.slice(5)
    if (/^Numpad/.test(code)) return 'Sayı tuşu ' + code.slice(6)
    if (/^F[0-9]{1,2}$/.test(code)) return code
    if (/^Mouse/.test(code)) return 'Fare ' + code.slice(5)
    return code
  }

  function renderSettingsVoice () {
    const problem = voice ? voiceSupportProblem() : TEXT.voiceUnsupported
    setMsg(el.setVoiceSupport, problem && problem !== TEXT.voiceNoKey ? problem : '', 'error')
    const s = snap()
    const ptt = s.ptt || { enabled: false, code: 'KeyV' }
    el.setPtt.checked = Boolean(ptt.enabled)
    el.setPtt.disabled = !voice
    el.setPttChange.disabled = !voice
    el.setMic.disabled = !voice
    el.setMicRefresh.disabled = !voice
    if (!capturingPtt) el.setPttKey.textContent = keyName(ptt.code || 'KeyV')
    updateLevelMeter()
  }

  function updateLevelMeter () {
    const s = snap()
    const level = s.channelId ? Math.max(0, Math.min(1, Number(s.inputLevel) || 0)) : 0
    el.setLevelBar.style.width = Math.round(level * 100) + '%'
    el.setLevelBar.classList.toggle('is-speaking', Boolean(s.selfSpeaking))
    el.setLevelNote.textContent = s.channelId ? 'Konuşurken çubuk yeşile döner.' : 'Seviye yalnızca ses kanalındayken gösterilir.'
  }

  async function fillMicList () {
    if (!voice) return
    let devices = []
    try {
      devices = await voice.listInputDevices()
    } catch (err) {
      devices = []
    }
    const current = storeGet(KEYS.mic) || ''
    clear(el.setMic)
    const def = h('option', '', 'Varsayılan mikrofon')
    def.value = ''
    el.setMic.appendChild(def)
    let n = 0
    const list = Array.isArray(devices) ? devices : []
    list.forEach((d) => {
      if (!d || typeof d.deviceId !== 'string' || d.deviceId === '' || d.deviceId === 'default') return
      n += 1
      const opt = h('option', '', d.label ? d.label : 'Mikrofon ' + n)
      opt.value = d.deviceId
      el.setMic.appendChild(opt)
    })
    el.setMic.value = current
    if (el.setMic.value !== current) el.setMic.value = ''
  }

  function onMicChange () {
    const id = el.setMic.value
    storeSet(KEYS.mic, id)
    if (!voice) return
    Promise.resolve(voice.setInputDevice(id)).catch((err) => {
      toast(err && err.message ? err.message : 'Mikrofon değiştirilemedi.', 'error')
    })
  }

  function onPttToggle () {
    if (!voice) return
    const s = snap()
    voice.setPushToTalk({ enabled: el.setPtt.checked, code: (s.ptt && s.ptt.code) || 'KeyV' })
  }

  function startPttCapture () {
    if (!voice) return
    capturingPtt = true
    el.setPttKey.textContent = '...'
    setMsg(el.setPttMsg, 'Yeni tuşa basın. Vazgeçmek için Esc.')
  }

  // Bas-konuş tuşu yakalama, diğer tuş işleyicilerinden önce çalışır.
  function onCaptureKeydown (e) {
    if (!capturingPtt) return
    e.preventDefault()
    e.stopPropagation()
    capturingPtt = false
    const s = snap()
    if (e.key === 'Escape' || e.key === 'Esc' || !e.code) {
      setMsg(el.setPttMsg, '')
      el.setPttKey.textContent = keyName((s.ptt && s.ptt.code) || 'KeyV')
      return
    }
    voice.setPushToTalk({ enabled: Boolean(s.ptt && s.ptt.enabled), code: e.code })
    el.setPttKey.textContent = keyName(e.code)
    setMsg(el.setPttMsg, 'Bas-konuş tuşu: ' + keyName(e.code), 'ok')
  }

  // Şifreleme

  function setKeyVisible (visible) {
    el.setKeyShow.setAttribute('aria-pressed', visible ? 'true' : 'false')
    el.setKeyShow.textContent = visible ? 'Gizle' : 'Göster'
    const entry = activeKeyEntry()
    el.setActiveKey.textContent = visible && entry ? entry.code : 'Gizli'
    el.setActiveKey.classList.toggle('secret-visible', Boolean(visible && entry))
  }

  function activeKeyEntry () {
    const kid = activeKid()
    if (!kid || !cryptoReady()) return null
    try {
      return window.E2EE.keyring.list().filter((k) => k.kid === kid)[0] || null
    } catch (err) {
      return null
    }
  }

  function renderSettingsCrypto () {
    clear(el.setKeyring)
    let keys = []
    try {
      keys = cryptoReady() ? window.E2EE.keyring.list() : []
    } catch (err) {
      keys = []
    }
    const kid = activeKid()
    if (!keys.length) {
      el.setKeyring.appendChild(h('li', 'empty-row', 'Bu cihazda kayıtlı anahtar yok.'))
    }
    keys.forEach((k) => {
      const li = h('li', 'list-row')
      const info = h('span', 'list-main')
      info.appendChild(icon('i-key'))
      info.appendChild(h('code', 'kid', k.kid.slice(0, 8)))
      if (k.kid === kid) info.appendChild(h('span', 'badge badge-active', 'etkin'))
      if (k.added) info.appendChild(h('span', 'list-sub', 'Eklendi: ' + formatShort(k.added)))
      li.appendChild(info)
      const remove = button('button button-small button-ghost', 'Kaldır', null, 'Anahtarı kaldır: ' + k.kid.slice(0, 8))
      remove.addEventListener('click', () => {
        const warn = k.kid === kid
          ? 'Bu, sunucunun etkin anahtarı. Kaldırırsanız bu cihazda mesaj okuyamaz ve gönderemezsiniz. Kaldırılsın mı?'
          : 'Bu anahtarla şifrelenmiş eski mesajlar bu cihazda okunamaz hale gelir. Kaldırılsın mı?'
        if (!window.confirm(warn)) return
        window.E2EE.keyring.remove(k.kid)
        afterKeyringChange()
      })
      li.appendChild(remove)
      el.setKeyring.appendChild(li)
    })
    const entry = activeKeyEntry()
    el.setActiveRow.hidden = !entry
    el.setInviteCopy.hidden = !entry
    setMsg(el.setActiveMissing, entry ? '' : (kid ? 'Etkin anahtar (' + kid.slice(0, 8) + ') bu cihazda yok. Anahtarı yukarıdan ekleyin.' : 'Sunucuda henüz etkin anahtar yok.'))
    setKeyVisible(el.setKeyShow.getAttribute('aria-pressed') === 'true')
    el.setKeyAdmin.hidden = !isAdmin()
    el.setKeyGenerate.textContent = kid ? 'Yeni anahtar oluştur' : 'Anahtar oluştur'
  }

  function afterKeyringChange () {
    renderSettingsCrypto()
    renderComposerState()
    refreshAllMessages()
    renderVoiceAll()
  }

  function submitSettingsKey (e) {
    e.preventDefault()
    const value = el.setKeyInput.value.trim()
    if (!value) {
      setMsg(el.setKeyMsg, 'Anahtar kodunu girin.', 'error')
      return
    }
    try {
      const kid = window.E2EE.keyring.add(value)
      el.setKeyInput.value = ''
      setMsg(el.setKeyMsg, kid === activeKid() ? 'Etkin anahtar eklendi.' : 'Anahtar eklendi (' + kid.slice(0, 8) + ').', 'ok')
    } catch (err) {
      setMsg(el.setKeyMsg, err && err.message ? err.message : 'Anahtar hatalı.', 'error')
      return
    }
    afterKeyringChange()
  }

  function copyInviteLink () {
    const entry = activeKeyEntry()
    if (!entry) return
    const link = isAdmin() && state.inviteCode ? inviteLink(state.inviteCode, entry.code) : inviteLink(null, entry.code)
    copyWithToast(link)
  }

  async function generateNewKey () {
    if (!isAdmin()) return
    const hadKey = Boolean(activeKid())
    if (hadKey && !window.confirm('Yeni anahtar yalnızca bundan sonraki mesajları korur. Herkese yeni davet bağlantısını göndermeniz gerekir. Eski anahtarı silmeyin, eski mesajlar onunla okunur. Devam edilsin mi?')) return
    el.setKeyGenerate.disabled = true
    const created = await createGroupKey()
    el.setKeyGenerate.disabled = false
    if (!created.ok) {
      setMsg(el.setKeyMsg, created.error, 'error')
      return
    }
    await refreshInviteCode()
    el.setNewInvite.value = inviteLink(state.inviteCode, created.code)
    el.setNewInviteWrap.hidden = false
    setMsg(el.setKeyMsg, 'Yeni anahtar etkinleştirildi. Davet bağlantısını herkese gönderin.', 'ok')
    afterKeyringChange()
    focusNode(el.setNewInviteCopy)
  }

  // Sunucu

  async function refreshInviteCode () {
    if (!isAdmin()) return
    const res = await api('GET', '/api/state')
    if (res.status === 200 && res.data) {
      state.inviteCode = typeof res.data.inviteCode === 'string' ? res.data.inviteCode : null
      if (Array.isArray(res.data.bannedUsers)) state.bannedUsers = res.data.bannedUsers
      if (isSettingsTab('server')) setInviteVisible(el.setInviteShow.getAttribute('aria-pressed') === 'true')
      if (isSettingsTab('members')) renderSettingsMembers()
    }
  }

  function setInviteVisible (visible) {
    el.setInviteShow.setAttribute('aria-pressed', visible ? 'true' : 'false')
    el.setInviteShow.textContent = visible ? 'Gizle' : 'Göster'
    el.setInviteCode.textContent = visible ? (state.inviteCode || 'Alınamadı') : 'Gizli'
    el.setInviteCode.classList.toggle('secret-visible', visible)
  }

  function renderSettingsServer () {
    el.setServerName.value = state.serverName
    el.setServerName.disabled = !isOwner()
    el.setServerSave.hidden = !isOwner()
    setInviteVisible(el.setInviteShow.getAttribute('aria-pressed') === 'true')
    renderServerChannels()
  }

  function renderServerChannels () {
    fillChannelAdmin(el.setTextChannels, textChannels())
    fillChannelAdmin(el.setVoiceChannels, voiceChannels())
  }

  function fillChannelAdmin (list, channels) {
    const focusKey = activeFocusKey(list)
    clear(list)
    channels.forEach((c, i) => {
      const li = h('li', 'list-row channel-admin-row')
      const main = h('span', 'list-main')
      main.appendChild(icon(c.type === 'voice' ? 'i-speaker' : 'i-hash'))
      main.appendChild(h('span', 'list-name', c.name))
      li.appendChild(main)
      const actions = h('span', 'row-actions')
      const up = button('icon-button', '', 'i-up', c.name + ' yukarı taşı')
      up.disabled = i === 0
      up.setAttribute('data-focus-key', 'up-' + c.id)
      up.addEventListener('click', () => {
        moveChannel(c, -1)
      })
      const down = button('icon-button', '', 'i-down', c.name + ' aşağı taşı')
      down.disabled = i === channels.length - 1
      down.setAttribute('data-focus-key', 'down-' + c.id)
      down.addEventListener('click', () => {
        moveChannel(c, 1)
      })
      const rename = button('button button-small button-secondary', 'Yeniden adlandır', null, c.name + ' kanalını yeniden adlandır')
      rename.setAttribute('data-focus-key', 'rename-' + c.id)
      rename.addEventListener('click', () => {
        startRename(li, c)
      })
      const del = button('button button-small button-danger', 'Sil', null, c.name + ' kanalını sil')
      del.setAttribute('data-focus-key', 'del-' + c.id)
      del.addEventListener('click', () => {
        deleteChannel(c)
      })
      actions.appendChild(up)
      actions.appendChild(down)
      actions.appendChild(rename)
      actions.appendChild(del)
      li.appendChild(actions)
      list.appendChild(li)
    })
    restoreFocusKey(list, focusKey)
  }

  function startRename (li, c) {
    clear(li)
    const form = h('form', 'row rename-form')
    form.noValidate = true
    const label = h('label', 'sr-only', 'Yeni ad')
    const input = h('input', 'input')
    input.type = 'text'
    input.id = 'rename-' + c.id
    label.setAttribute('for', input.id)
    input.maxLength = state.limits.channelNameMax
    input.value = c.name
    const save = button('button button-small', 'Kaydet')
    save.type = 'submit'
    const cancel = button('button button-small button-secondary', 'İptal')
    cancel.addEventListener('click', () => {
      renderServerChannels()
    })
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' || e.key === 'Esc') {
        e.preventDefault()
        e.stopPropagation()
        renderServerChannels()
      }
    })
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const name = normalizeName(input.value)
      if (!name) return
      save.disabled = true
      const res = await api('POST', '/api/channels/update', { id: c.id, name: name })
      save.disabled = false
      if (res.status === 200) {
        setMsg(el.setChannelMsg, 'Kanal yeniden adlandırıldı.', 'ok')
        renderServerChannels()
        return
      }
      setMsg(el.setChannelMsg, errorText(res, 'Kanal yeniden adlandırılamadı.'), 'error')
    })
    form.appendChild(label)
    form.appendChild(input)
    form.appendChild(save)
    form.appendChild(cancel)
    li.appendChild(form)
    focusNode(input)
    input.select()
  }

  async function moveChannel (c, delta) {
    const same = channelsOf(c.type)
    const index = same.indexOf(c)
    const target = index + delta
    if (index === -1 || target < 0 || target >= same.length) return
    const res = await api('POST', '/api/channels/update', { id: c.id, position: target })
    if (res.status !== 200) {
      setMsg(el.setChannelMsg, errorText(res, 'Kanal taşınamadı.'), 'error')
      return
    }
    if (res.data && res.data.channel && state.meta) {
      // Meta gelene kadar yerel sıra güncellenir
      const others = same.filter((x) => x !== c)
      others.splice(target, 0, c)
      others.forEach((x, i) => {
        x.position = i
      })
      renderServerChannels()
      renderChannels()
      renderVoiceAll()
    }
  }

  async function deleteChannel (c) {
    const text = c.type === 'voice'
      ? c.name + ' ses kanalı silinsin mi? İçindeki kişiler sesten çıkarılır.'
      : '#' + c.name + ' kanalı ve tüm mesajları, dosyaları kalıcı olarak silinsin mi?'
    if (!window.confirm(text)) return
    const res = await api('POST', '/api/channels/delete', { id: c.id })
    if (res.status === 200) {
      setMsg(el.setChannelMsg, 'Kanal silindi.', 'ok')
      return
    }
    setMsg(el.setChannelMsg, errorText(res, 'Kanal silinemedi.'), 'error')
  }

  async function submitChannelCreate (e) {
    e.preventDefault()
    const name = normalizeName(el.setChannelName.value)
    const type = el.setChannelType.value === 'voice' ? 'voice' : 'text'
    if (!name) {
      setMsg(el.setChannelMsg, 'Kanal adını girin.', 'error')
      return
    }
    el.setChannelCreate.disabled = true
    const res = await api('POST', '/api/channels/create', { name: name, type: type })
    el.setChannelCreate.disabled = false
    if (res.status === 200) {
      el.setChannelName.value = ''
      setMsg(el.setChannelMsg, (type === 'voice' ? 'Ses' : 'Yazı') + ' kanalı oluşturuldu.', 'ok')
      return
    }
    setMsg(el.setChannelMsg, errorText(res, 'Kanal oluşturulamadı.'), 'error')
  }

  async function submitServerName (e) {
    e.preventDefault()
    if (!isOwner()) return
    const name = normalizeName(el.setServerName.value)
    if (!name) {
      setMsg(el.setServerMsg, 'Sunucu adını girin.', 'error')
      return
    }
    el.setServerSave.disabled = true
    const res = await api('POST', '/api/settings', { serverName: name })
    el.setServerSave.disabled = false
    if (res.status === 200) {
      setMsg(el.setServerMsg, 'Sunucu adı kaydedildi.', 'ok')
      return
    }
    setMsg(el.setServerMsg, errorText(res, 'Sunucu adı kaydedilemedi.'), 'error')
  }

  async function rotateInvite () {
    if (!window.confirm('Davet kodu yenilensin mi? Eski davet bağlantılarıyla artık kayıt olunamaz.')) return
    el.setInviteRotate.disabled = true
    const res = await api('POST', '/api/invite/rotate')
    el.setInviteRotate.disabled = false
    if (res.status === 200 && res.data && typeof res.data.inviteCode === 'string') {
      state.inviteCode = res.data.inviteCode
      setInviteVisible(true)
      setMsg(el.setInviteMsg, 'Davet kodu yenilendi. Yeni davet bağlantısını Şifreleme sekmesinden kopyalayabilirsiniz.', 'ok')
      return
    }
    setMsg(el.setInviteMsg, errorText(res, 'Davet kodu yenilenemedi.'), 'error')
  }

  // Üyeler

  function renderSettingsMembers () {
    const list = el.setMembersList
    const focusKey = activeFocusKey(list)
    clear(list)
    const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
    users.forEach((u) => {
      list.appendChild(buildMemberAdminRow(u, false))
    })
    restoreFocusKey(list, focusKey)
    const banned = bannedList()
    el.setBannedWrap.hidden = !banned.length
    const bFocus = activeFocusKey(el.setBannedList)
    clear(el.setBannedList)
    banned.forEach((u) => {
      el.setBannedList.appendChild(buildMemberAdminRow(u, true))
    })
    restoreFocusKey(el.setBannedList, bFocus)
  }

  // Engellenenler meta'da yer almaz. Sunucu /api/state içinde bannedUsers verirse o, yoksa
  // bu oturumda bilinen ama meta'dan düşen kullanıcılar listelenir.
  function bannedList () {
    const present = new Set((state.meta && Array.isArray(state.meta.users) ? state.meta.users : []).map((u) => String(u.id)))
    const out = new Map()
    if (Array.isArray(state.bannedUsers)) {
      state.bannedUsers.forEach((u) => {
        if (u && u.id !== undefined && !present.has(String(u.id))) out.set(String(u.id), { id: u.id, name: String(u.name || userName(u.id)), role: u.role || 'member' })
      })
    }
    state.users.forEach((u, id) => {
      if (!present.has(id) && !out.has(id)) out.set(id, { id: u.id, name: u.name, role: u.role })
    })
    return Array.from(out.values())
  }

  function buildMemberAdminRow (u, banned) {
    const li = h('li', 'list-row member-row')
    li.setAttribute('data-user-id', String(u.id))
    const main = h('span', 'list-main')
    const av = h('span', 'avatar-wrap')
    av.appendChild(avatar(u.id, u.name))
    if (!banned) av.appendChild(h('span', 'presence-dot' + (u.online ? ' is-online' : '')))
    main.appendChild(av)
    const text = h('span', 'list-text')
    text.appendChild(h('span', 'list-name', u.name + (state.me && sameId(u.id, state.me.id) ? ' (sen)' : '')))
    const sub = banned ? 'engellendi' : (ROLE_LABELS[u.role] || u.role) + ', ' + (u.online ? 'çevrimiçi' : 'çevrimdışı')
    text.appendChild(h('span', 'list-sub', sub))
    main.appendChild(text)
    li.appendChild(main)
    const actions = h('span', 'row-actions')
    const self = state.me && sameId(u.id, state.me.id)
    const owner = isOwner()
    if (!banned && owner && !self && u.role !== 'owner') {
      const promote = u.role === 'admin'
      const roleBtn = button('button button-small button-secondary act-role', promote ? 'Üye yap' : 'Yönetici yap')
      roleBtn.setAttribute('data-focus-key', 'role-' + u.id)
      roleBtn.addEventListener('click', () => {
        setUserRole(u, promote ? 'member' : 'admin')
      })
      actions.appendChild(roleBtn)
    }
    const canBan = !self && u.role !== 'owner' && (owner || u.role === 'member')
    if (canBan) {
      const banBtn = button('button button-small ' + (banned ? 'button-secondary' : 'button-danger') + ' act-ban', banned ? 'Engeli kaldır' : 'Engelle')
      banBtn.setAttribute('data-focus-key', 'ban-' + u.id)
      banBtn.addEventListener('click', () => {
        setUserBan(u, !banned)
      })
      actions.appendChild(banBtn)
    }
    if (owner && !self && !banned) {
      const reset = button('button button-small button-ghost act-reset', 'Parola sıfırla')
      reset.setAttribute('data-focus-key', 'reset-' + u.id)
      reset.addEventListener('click', () => {
        resetUserPassword(u)
      })
      actions.appendChild(reset)
    }
    li.appendChild(actions)
    return li
  }

  async function setUserRole (u, role) {
    const res = await api('POST', '/api/users/role', { userId: u.id, role: role })
    if (res.status === 200) {
      setMsg(el.setMembersMsg, u.name + (role === 'admin' ? ' artık yönetici.' : ' artık üye.'), 'ok')
      return
    }
    setMsg(el.setMembersMsg, errorText(res, 'Rol değiştirilemedi.'), 'error')
  }

  async function setUserBan (u, banned) {
    if (banned && !window.confirm(u.name + ' engellensin mi? Tüm oturumları kapatılır ve giriş yapamaz.')) return
    const res = await api('POST', '/api/users/ban', { userId: u.id, banned: banned })
    if (res.status === 200) {
      if (Array.isArray(state.bannedUsers)) {
        state.bannedUsers = banned ? state.bannedUsers.concat([{ id: u.id, name: u.name }]) : state.bannedUsers.filter((b) => !sameId(b.id, u.id))
      }
      if (!banned) state.users.delete(String(u.id))
      setMsg(el.setMembersMsg, u.name + (banned ? ' engellendi.' : ' için engel kaldırıldı.'), 'ok')
      renderSettingsMembers()
      return
    }
    setMsg(el.setMembersMsg, errorText(res, 'İşlem yapılamadı.'), 'error')
  }

  async function resetUserPassword (u) {
    if (!window.confirm(u.name + ' için parola sıfırlansın mı? Kişinin tüm oturumları kapanır.')) return
    const res = await api('POST', '/api/users/reset-password', { userId: u.id })
    if (res.status === 200 && res.data && typeof res.data.tempPassword === 'string') {
      el.setTempLabel.textContent = u.name + ' için geçici parola:'
      el.setTempPassword.textContent = res.data.tempPassword
      el.setTempWrap.hidden = false
      setMsg(el.setMembersMsg, '')
      focusNode(el.setTempCopy)
      return
    }
    setMsg(el.setMembersMsg, errorText(res, 'Parola sıfırlanamadı.'), 'error')
  }

  // Çekmeceler: dar ekranda kanallar (sol) ve üyeler (sağ), orta genişlikte üyeler katmanı (5.4)

  function openDrawer (side, trigger) {
    const isChannels = side === 'channels'
    if (isChannels && !isNarrow()) return
    if (!isChannels && isWide()) return
    const name = 'drawer-' + side
    const existing = findLayer(name)
    if (existing) {
      closeLayer(existing, true)
      return
    }
    closeDrawers()
    const panel = isChannels ? el.sidebar : el.members
    el.appView.classList.add(isChannels ? 'show-channels' : 'show-members')
    el.drawerBackdrop.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'true')
    openLayer({
      name: name,
      el: panel,
      trigger: trigger,
      level: 1,
      trap: true,
      onClose: () => {
        el.appView.classList.remove(isChannels ? 'show-channels' : 'show-members')
        trigger.setAttribute('aria-expanded', 'false')
        panel.removeAttribute('role')
        panel.removeAttribute('aria-modal')
        if (!findLayer('drawer-channels') && !findLayer('drawer-members')) el.drawerBackdrop.hidden = true
      }
    })
  }

  function closeDrawers () {
    const names = ['drawer-channels', 'drawer-members']
    names.forEach((name) => {
      const layer = findLayer(name)
      if (layer) closeLayer(layer, false)
    })
    el.drawerBackdrop.hidden = true
  }

  function onBackdropClick () {
    const layer = findLayer('drawer-channels') || findLayer('drawer-members')
    if (layer) closeLayer(layer, true)
  }

  let lastLayoutClass = ''

  function onResize () {
    autoGrow(el.composerInput, 6)
    keepBottom()
    const cls = isNarrow() ? 'narrow' : isWide() ? 'wide' : 'medium'
    if (cls === lastLayoutClass) return
    lastLayoutClass = cls
    if (state.inApp) renderChannelHeader()
    closeDrawers()
    const picker = findLayer('emoji')
    if (picker) closeLayer(picker, false)
    closeMessageMenu()
    const peer = findLayer('peer')
    if (peer) closeLayer(peer, false)
  }

  // PWA (5.9)

  function registerServiceWorker () {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return
    try {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
    } catch (err) {
      // Service worker desteklenmiyor
    }
  }

  function onBeforeInstallPrompt (e) {
    e.preventDefault()
    state.installPrompt = e
    if (isSettingsTab('account')) renderSettingsAccount()
  }

  function onAppInstalled () {
    state.installPrompt = null
    if (isSettingsTab('account')) renderSettingsAccount()
    toast('Uygulama yüklendi.', 'ok')
  }

  // Olay bağlama

  function on (node, type, handler, options) {
    if (node) node.addEventListener(type, handler, options || false)
  }

  function bindEvents () {
    on(el.bootRetry, 'click', () => {
      if (!cryptoReady()) window.location.reload()
      else if (state.token) resumeSession()
      else loadInfo()
    })
    on(el.setupForm, 'submit', submitSetup)
    on(el.inviteCopyLink, 'click', () => {
      copyWithToast(el.inviteLink.value)
    })
    on(el.inviteCopyKey, 'click', () => {
      copyWithToast(el.inviteKey.value)
    })
    on(el.inviteLink, 'focus', () => {
      selectAll(el.inviteLink)
    })
    on(el.inviteKey, 'focus', () => {
      selectAll(el.inviteKey)
    })
    on(el.inviteContinue, 'click', continueFromInvite)
    on(el.authTabLogin, 'click', () => {
      selectAuthTab('login', false)
    })
    on(el.authTabRegister, 'click', () => {
      selectAuthTab('register', false)
    })
    on(el.authTabLogin, 'keydown', onAuthTabKey)
    on(el.authTabRegister, 'keydown', onAuthTabKey)
    on(el.loginForm, 'submit', submitLogin)
    on(el.registerForm, 'submit', submitRegister)
    on(el.keyForm, 'submit', submitKey)
    on(el.keyGenerate, 'click', generateFromKeyScreen)
    on(el.keySkip, 'click', skipKey)
    on(el.keyLogout, 'click', logout)

    on(el.btnOpenChannels, 'click', () => {
      openDrawer('channels', el.btnOpenChannels)
    })
    on(el.btnOpenMembers, 'click', () => {
      openDrawer('members', el.btnOpenMembers)
    })
    on(el.sidebarClose, 'click', closeDrawerFromButton)
    on(el.membersClose, 'click', closeDrawerFromButton)
    on(el.drawerBackdrop, 'click', onBackdropClick)

    on(el.btnMute, 'click', toggleMute)
    on(el.btnDeafen, 'click', toggleDeafen)
    on(el.btnSettings, 'click', () => {
      openSettings('account', el.btnSettings)
    })
    on(el.voiceLeave, 'click', leaveVoice)
    on(el.voiceStripLeave, 'click', leaveVoice)
    on(el.voiceUnlock, 'click', () => {
      if (voice) voice.unlockAudio()
    })
    bindPttButton()
    on(el.peerVolume, 'input', onPeerVolumeInput)
    on(el.peerVolume, 'change', onPeerVolumeInput)
    on(el.peerMute, 'click', onPeerMuteClick)

    on(el.loadOlder, 'click', loadOlder)
    on(el.messages, 'scroll', onMessagesScroll)
    on(el.messagesRetry, 'click', loadChannel)
    on(el.msgMenu, 'keydown', onMenuKey)
    on(el.msgMenuEdit, 'click', () => {
      if (state.menuMessageId !== null) startEdit(state.menuMessageId)
    })
    on(el.msgMenuDelete, 'click', () => {
      if (state.menuMessageId !== null) confirmDelete(state.menuMessageId)
    })

    on(el.composerForm, 'submit', (e) => {
      e.preventDefault()
      sendMessage()
    })
    on(el.composerInput, 'input', onComposerInput)
    on(el.composerInput, 'keydown', onComposerKeydown)
    on(el.composerInput, 'paste', onPaste)
    on(el.composerHintAction, 'click', () => {
      if (activeKid()) openSettings('crypto', el.composerHintAction)
      else if (isAdmin()) openSettings('crypto', el.composerHintAction)
    })
    on(el.btnPhoto, 'click', () => {
      el.filePhoto.value = ''
      el.filePhoto.click()
    })
    on(el.btnFile, 'click', () => {
      el.fileAny.value = ''
      el.fileAny.click()
    })
    on(el.filePhoto, 'change', () => {
      addFiles(el.filePhoto.files, 'photo')
      el.filePhoto.value = ''
      focusNode(el.composerInput)
    })
    on(el.fileAny, 'change', () => {
      addFiles(el.fileAny.files, 'file')
      el.fileAny.value = ''
      focusNode(el.composerInput)
    })
    on(el.btnEmoji, 'click', openEmojiPicker)
    on(el.emojiGrid, 'click', onEmojiGridClick)
    on(el.emojiGrid, 'keydown', onEmojiGridKey)
    on(el.emojiTabs, 'keydown', onEmojiTabsKey)
    on(el.main, 'dragenter', onDragEnter)
    on(el.main, 'dragover', onDragOver)
    on(el.main, 'dragleave', onDragLeave)
    on(el.main, 'drop', onDrop)

    on(el.viewerClose, 'click', () => {
      const layer = findLayer('viewer')
      if (layer) closeLayer(layer, true)
    })
    on(el.viewerDownload, 'click', downloadFromViewer)
    on(el.viewerStage, 'click', (e) => {
      if (e.target === el.viewerStage) {
        const layer = findLayer('viewer')
        if (layer) closeLayer(layer, true)
      }
    })

    on(el.settingsClose, 'click', () => {
      const layer = findLayer('settings')
      if (layer) closeLayer(layer, true)
    })
    on(el.settingsModal, 'click', (e) => {
      if (e.target === el.settingsModal) {
        const layer = findLayer('settings')
        if (layer) closeLayer(layer, true)
      }
    })
    SETTINGS_TABS.forEach((name) => {
      on(tabEl(name), 'click', () => {
        selectSettingsTab(name, false)
      })
    })
    on(el.settingsTabs, 'keydown', onSettingsTabsKey)
    on(el.setPasswordForm, 'submit', submitPasswordChange)
    on(el.setNotify, 'change', onNotifyChange)
    on(el.setInstall, 'click', installApp)
    on(el.setLogout, 'click', logout)
    on(el.setMic, 'change', onMicChange)
    on(el.setMicRefresh, 'click', fillMicList)
    on(el.setPtt, 'change', onPttToggle)
    on(el.setPttChange, 'click', startPttCapture)
    on(el.setKeyForm, 'submit', submitSettingsKey)
    on(el.setKeyShow, 'click', () => {
      setKeyVisible(el.setKeyShow.getAttribute('aria-pressed') !== 'true')
    })
    on(el.setKeyCopy, 'click', () => {
      const entry = activeKeyEntry()
      if (entry) copyWithToast(entry.code)
    })
    on(el.setInviteCopy, 'click', copyInviteLink)
    on(el.setKeyGenerate, 'click', generateNewKey)
    on(el.setNewInviteCopy, 'click', () => {
      copyWithToast(el.setNewInvite.value)
    })
    on(el.setServerForm, 'submit', submitServerName)
    on(el.setInviteShow, 'click', () => {
      setInviteVisible(el.setInviteShow.getAttribute('aria-pressed') !== 'true')
    })
    on(el.setInviteRotate, 'click', rotateInvite)
    on(el.setChannelForm, 'submit', submitChannelCreate)
    on(el.setTempCopy, 'click', () => {
      copyWithToast(el.setTempPassword.textContent)
    })

    on(document, 'keydown', onCaptureKeydown, true)
    on(document, 'keydown', onLayerKeydown)
    on(document, 'mousedown', onLayerPointerDown, true)
    on(document, 'touchstart', onLayerPointerDown, { capture: true, passive: true })
    on(document, 'focusin', onLayerFocusIn)
    on(document, 'visibilitychange', onVisibilityChange)
    on(window, 'resize', onResize)
    on(window, 'online', () => {
      if (state.inApp && state.connLost) startPoll()
    })
    on(window, 'beforeinstallprompt', onBeforeInstallPrompt)
    on(window, 'appinstalled', onAppInstalled)
    // Pencereye bırakılan dosyalar tarayıcıda açılmasın
    on(window, 'dragover', (e) => {
      if (hasDraggedFiles(e)) e.preventDefault()
    })
    on(window, 'drop', (e) => {
      if (hasDraggedFiles(e)) e.preventDefault()
    })
  }

  function closeDrawerFromButton () {
    const layer = findLayer('drawer-channels') || findLayer('drawer-members')
    if (layer) closeLayer(layer, true)
  }

  function start () {
    cacheElements()
    bindEvents()
    observeMessagesSize()
    onResize()
    registerServiceWorker()
    if (!cryptoReady()) {
      showBoot(TEXT.noCrypto, true)
      el.bootRetry.textContent = 'Sayfayı yenile'
      return
    }
    createVoice()
    readFragment()
    loadInfo()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start)
  } else {
    start()
  }
}
