// Sesli sohbet istemcisi (window.VoiceClient)
// WebRTC tam örgü: ses, ekran paylaşımı ve kamera. Sinyaller grup anahtarıyla şifrelenir ve gönderen ile alıcı kimliğine bağlanır,
// böylece sunucu bağlantı kurulumuna müdahale edemez. Ağ erişimi yalnızca dışarıdan verilen api fonksiyonuyla yapılır.
// Mikrofon sesi WebAudio hattından geçer: algılama kolu (gecikmesiz analizör) ve ses kolu (ileri bakış gecikmesi,
// kapı kazancı, eşlere giden hedef iz). Bu dosya kullanıcıya görünen metin üretmez, hata ve durumlar kod olarak bildirilir.
window.VoiceClient = (function () {
  'use strict'

  // Uzak konuşma algılama (100 ms aralık)
  var REMOTE_THRESHOLD = 0.01
  var REMOTE_HOLD_MS = 250
  var REMOTE_FFT = 4096
  var REMOTE_EVERY = 5
  // Yerel ölçüm 20 ms aralıkla, analiz penceresi bir aralıktan biraz uzundur, kısa sesler kaçmaz
  var TICK_MS = 20
  var LOCAL_FFT = 1024
  var MIN_DB = -100
  var LOOKAHEAD_S = 0.05
  var GATE_OPEN_TC = 0.005
  var GATE_CLOSE_TC = 0.03
  var VAD_HOLD_MS = 300
  var FLOOR_WINDOW_MS = 3000
  var FLOOR_MARGIN_DB = 15
  var AUTO_MIN_DB = -70
  var AUTO_MAX_DB = -20
  var SMOOTHING = 0.3
  var LEVEL_EMIT_MS = 100
  var CAPTURE_TIMEOUT_MS = 10000
  var MAX_PADS = 8
  var MAX_PAD_BUTTON = 63
  var CONNECT_TIMEOUT_MS = 20000
  var NO_OFFER_TIMEOUT_MS = 30000
  var SELF_GRACE_MS = 15000
  var UNKNOWN_TTL_MS = 15000
  var OTHER_TONE_QUIET_MS = 1500
  // Bağlantı kurulduktan veya ses odasına girildikten sonra bu süre içinde gelen paylaşım duyurusu zaten süren
  // bir paylaşımdır (yeni başlamış sayılmaz, sesli bildirim çalmaz)
  var SHARE_FRESH_MS = 4000
  // Sayfanın bildirim sesleriyle çalınan türler (public/js/31-sesler.js): katılma, ayrılma, ses odasından düşme
  var NOTIFY_TONES = { join: true, leave: true, drop: true }
  // Kısa sesler (giriş ve çıkış sesleri ayarı): notalar (Hz), notalar arası süre (sn) ve düzey. Bas konuş ipuçları kısa ve tizdir,
  // katılma ve ayrılma seslerinden ayırt edilir.
  var TONES = {
    join: { freqs: [523.25, 659.25], step: 0.12, peak: 0.12 },
    leave: { freqs: [659.25, 523.25], step: 0.12, peak: 0.12 },
    pttOn: { freqs: [880, 1174.66], step: 0.06, peak: 0.1 },
    pttOff: { freqs: [1174.66, 880], step: 0.06, peak: 0.1 }
  }
  var CONTEXT_CLOSE_DELAY_MS = 700
  var MAX_UNKNOWN = 50
  var MAX_CANDIDATES = 200
  var MAX_ROSTER = 64
  // Görüntülü SDP sesliden büyüktür (Chromium 141: 3 m satırı yaklaşık 5000 karakter). Asıl üst sınır sunucunun
  // zarf sınırıdır (maxSignalChars), bu değer sunucu sınırı yükseltilirse darboğaz olmasın diye geniş tutulur.
  var MAX_SDP_CHARS = 30000
  var MAX_CANDIDATE_CHARS = 2000
  var MAX_SIGNAL_CHARS = 100000
  var MAX_STORED_USERS = 500
  // Kişi bazlı ses en fazla %200'dür (applyPeerAudio, yükseltme yolu)
  var PEER_VOLUME_MAX = 2
  // Yükseltilmiş sesin tepelerinde sert kırpılmayı yumuşatan sınırlayıcı (DynamicsCompressor): eşik dBFS, oran,
  // diz genişliği, saldırı ve bırakma saniye
  var BOOST_LIMITER = { threshold: -3, ratio: 20, knee: 0, attack: 0.003, release: 0.25 }
  // Kazanç değişince tıkırtı olmaması için hedef değere yaklaşma zaman sabiti (saniye)
  var BOOST_RAMP_S = 0.015
  var MAX_SEEN_PEERS = 256
  var MAX_SEEN_SIDS = 32
  var MAX_SERVER_TEXT = 500
  var SIGNAL_RETRIES = 3
  var STORAGE_KEY = 'telsiz.voice'
  var PEERS_KEY = 'telsiz.voice.peers'
  var SCREEN_KEY = 'telsiz.voice.screen'
  // Ekran paylaşımı (Ek L1)
  var NEGO_TIMEOUT_MS = 20000
  var MAX_NEGO_RETRIES = 2
  var WATCH_TIMEOUT_MS = 30000
  var FLOW_PROBE_MS = 400
  // Paylaşım sürerken sunucuya erişim denetimi: yanıt gelmeyen süre LINK_PROBE_MS'yi geçince yoklanır,
  // yoklamalar OFFLINE_STOP_MS boyunca başarısız olursa paylaşım durur
  var LINK_TICK_MS = 5000
  var LINK_PROBE_MS = 10000
  var OFFLINE_STOP_MS = 30000
  var SCREEN_KINDS = ['video', 'audio']
  var SCREEN_PRESET_IDS = ['720p15', '720p30', '1080p15', '1080p30']
  var SCREEN_PRESETS = {
    '720p15': { width: 1280, height: 720, frameRate: 15, maxBitrate: 1200000 },
    '720p30': { width: 1280, height: 720, frameRate: 30, maxBitrate: 2500000 },
    '1080p15': { width: 1920, height: 1080, frameRate: 15, maxBitrate: 2500000 },
    '1080p30': { width: 1920, height: 1080, frameRate: 30, maxBitrate: 4000000 }
  }
  var SCREEN_HINTS = ['motion', 'detail']
  var DEFAULT_SCREEN = { preset: '720p15', hint: 'detail', audio: false }
  // Ekran sinyallerinde izin verilen alanlar (sid ve n bütün sinyallerde ortaktır)
  var SCREEN_ON_KEYS = ['type', 'sid', 'n', 'on', 'id', 'audio', 'hint', 'preset']
  var SCREEN_OFF_KEYS = ['type', 'sid', 'n', 'on', 'id']
  var STOP_REASONS = ['user', 'ended', 'left', 'unload']
  // Ekran paylaşımı hata kodları (arayüz t('screen.errors.' + kod) ile çevirir). 'cancelled' gösterilmez:
  // yerini yeni bir istek aldı veya paylaşım seçici açıkken durduruldu.
  var SCREEN_ERRORS = ['screen_unsupported', 'insecure', 'unsupported', 'not_in_voice', 'screen_busy', 'screen_denied',
    'screen_gesture', 'screen_not_found', 'screen_failed', 'screen_negotiation_failed', 'screen_audio_limited', 'screen_watch_failed',
    'no_share']
  // Kamera: 640x360, 15 kare. Görüntü kişiler arasında doğrudan akar (DTLS-SRTP), sunucu yalnızca açık bilgisini
  // ve oda başına sınırı bilir (POST /api/voice/camera). Gönderim sınırı arayüzdeki öneri hesabının varsaydığı
  // yaklaşık 400 kbps'dir (public/js/28-kapasite.js CAMERA_KBPS).
  var CAMERA_SIZE = { width: 640, height: 360, frameRate: 15 }
  var CAMERA_ENCODING = { maxBitrate: 400000, maxFramerate: 15 }
  // Kamera değiştirirken getUserMedia beklemesi (ms). Bazı telefonlar ikinci kamera isteğini ilk kamera bırakılana
  // kadar yanıtsız bekletir: eski kamera açıkken yapılan istek kısa sürede yanıtlanmazsa eski kamera bırakılıp
  // yeniden denenir. Kamera bırakıldıktan sonraki istek daha uzun bekler, süre dolarsa değiştirme başarısız sayılır.
  var CAMERA_SWITCH_WAIT_MS = 2500
  var CAMERA_OPEN_WAIT_MS = 10000
  var CAMERA_KEYS = ['type', 'sid', 'n', 'on', 'mid']
  var CAMERA_STOP_REASONS = ['user', 'ended', 'left', 'server', 'disabled']
  // Kamera hata kodları (arayüz t('camera.errors.' + kod) ile çevirir). 'cancelled' gösterilmez.
  var CAMERA_ERRORS = ['camera_unsupported', 'insecure', 'not_in_voice', 'camera_denied', 'camera_not_found', 'camera_in_use',
    'camera_failed', 'camera_disabled', 'camera_limit', 'camera_lost', 'camera_negotiation_failed', 'camera_moderated']
  var MID_RE = /^[A-Za-z0-9_.{}~+-]{1,64}$/
  var UPLINK_MAX_KBPS = 10000000
  var ACTIONS = ['ptt', 'toggleMute', 'toggleDeafen']
  var MIC_FLAGS = ['echoCancellation', 'noiseSuppression', 'autoGainControl']
  // Gelişmiş gürültü engelleme (RNNoise): AudioWorklet işlemcisi ve WebAssembly derlemesi. İşlemci hazır
  // olduğunu RNNOISE_READY_MS içinde bildirmezse (bağlam çalışırken) RNNoise bu oturumda kullanılmaz.
  var RNNOISE_WORKLET_URL = '/rnnoise-worklet.js'
  var RNNOISE_WASM_URL = '/vendor/rnnoise/rnnoise.wasm'
  var RNNOISE_PROCESSOR = 'telsiz-rnnoise'
  var RNNOISE_LOAD_MS = 20000
  var RNNOISE_READY_MS = 15000
  var MOUSE_BITS = { 1: 4, 3: 8, 4: 16 }
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/
  var SID_RE = /^[0-9a-f]{16}$/
  var KID_RE = /^[0-9a-f]{16}$/
  var KEY_CODE_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/
  var CODE_RE = /^[a-z][a-z0-9_]{0,63}$/
  var ICE_URL_RE = /^(stun|stuns|turn|turns):/i
  var LAYOUT_RE = /^(Key[A-Z]|Digit[0-9]|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|IntlBackslash|IntlRo|IntlYen)$/

  // Adı dile göre değişen tuşlar: i18n anahtarı 'keys.<kod>', değer İngilizce yedek
  var KEY_NAMES = {
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backspace: 'Backspace',
    CapsLock: 'Caps Lock',
    ShiftLeft: 'Left Shift',
    ShiftRight: 'Right Shift',
    ControlLeft: 'Left Ctrl',
    ControlRight: 'Right Ctrl',
    AltLeft: 'Left Alt',
    AltRight: 'Right Alt',
    MetaLeft: 'Left Win/Cmd',
    MetaRight: 'Right Win/Cmd',
    ArrowUp: 'Up Arrow',
    ArrowDown: 'Down Arrow',
    ArrowLeft: 'Left Arrow',
    ArrowRight: 'Right Arrow',
    Insert: 'Insert',
    Delete: 'Delete',
    Home: 'Home',
    End: 'End',
    PageUp: 'Page Up',
    PageDown: 'Page Down',
    ContextMenu: 'Menu',
    Pause: 'Pause',
    ScrollLock: 'Scroll Lock',
    PrintScreen: 'Print Screen',
    NumLock: 'Num Lock',
    NumpadEnter: 'Numpad Enter'
  }
  // Dilden bağımsız simgeyle gösterilen tuşlar (klavye düzeni okunamazsa)
  var SYMBOL_KEYS = {
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: '\'',
    Comma: ',',
    Period: '.',
    Slash: '/',
    IntlBackslash: '<'
  }
  var NUMPAD_SYMBOLS = {
    NumpadAdd: '+',
    NumpadSubtract: '-',
    NumpadMultiply: '*',
    NumpadDivide: '/',
    NumpadDecimal: '.',
    NumpadEqual: '=',
    NumpadComma: ','
  }
  // bindingLabel için İngilizce yedek metinler (çeviri fonksiyonu yoksa veya anahtar sözlükte yoksa)
  var FALLBACK = {
    'bindings.none': 'Not set',
    'bindings.key': '{key} key',
    'bindings.mouseMiddle': 'Middle mouse button',
    'bindings.mouseSide': 'Mouse button {n}',
    'bindings.gamepad': 'Gamepad button {n}',
    'keys.numpad': 'Numpad {key}'
  }
  Object.keys(KEY_NAMES).forEach(function (code) {
    FALLBACK['keys.' + code] = KEY_NAMES[code]
  })

  function noop () {}

  function hasOwn (obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key)
  }

  function isNum (v) {
    return typeof v === 'number' && isFinite(v)
  }

  function clamp (v, lo, hi) {
    return Math.max(lo, Math.min(hi, v))
  }

  function round1 (v) {
    return typeof v === 'number' ? Math.round(v * 10) / 10 : null
  }

  // Hata nesneleri yalnızca kod taşır, metni arayüz çevirir. Sunucunun kendi açıklaması ayrıca saklanır.
  function makeError (code, serverMessage) {
    var e = new Error(code)
    e.code = code
    if (serverMessage) e.serverMessage = serverMessage
    return e
  }

  function support () {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return { ok: false, reason: 'unsupported' }
    if (window.isSecureContext === false) return { ok: false, reason: 'insecure' }
    var md = navigator.mediaDevices
    if (!window.RTCPeerConnection || !md || typeof md.getUserMedia !== 'function') return { ok: false, reason: 'unsupported' }
    return { ok: true, reason: null }
  }

  // RNNoise için AudioWorklet ve WebAssembly gerekir (bağlamın audioWorklet alanı ayrıca denetlenir)
  function rnnoiseSupport () {
    if (typeof window === 'undefined') return false
    var AC = window.AudioContext || window.webkitAudioContext
    var wasm = typeof WebAssembly === 'object' && WebAssembly ? WebAssembly : null
    return !!(AC && typeof window.AudioWorkletNode === 'function' && wasm && typeof wasm.instantiate === 'function' &&
      typeof window.XMLHttpRequest === 'function')
  }

  // RNNoise wasm baytları sayfa başına bir kez indirilir, indirme başarısız olursa sonraki denemede yeniden istenir
  var rnnoiseDownload = null

  function rnnoiseBytes () {
    if (rnnoiseDownload) return rnnoiseDownload
    var p = new Promise(function (resolve, reject) {
      var x = new window.XMLHttpRequest()
      var fail = function () { reject(makeError('rnnoise_failed')) }
      x.open('GET', RNNOISE_WASM_URL)
      x.responseType = 'arraybuffer'
      x.timeout = RNNOISE_LOAD_MS
      x.onload = function () {
        var buf = x.response
        if (x.status === 200 && buf && typeof buf.byteLength === 'number' && buf.byteLength > 0) resolve(buf)
        else fail()
      }
      x.onerror = fail
      x.ontimeout = fail
      x.onabort = fail
      x.send()
    })
    rnnoiseDownload = p
    p.then(noop, function () {
      if (rnnoiseDownload === p) rnnoiseDownload = null
    })
    return p
  }

  function micErrorCode (e) {
    if (e && typeof e.code === 'string' && /^mic_/.test(e.code)) return e.code
    var name = e && e.name
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'mic_denied'
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'mic_not_found'
    return 'mic_failed'
  }

  function defaultSettings () {
    return {
      inputDeviceId: null,
      inputMode: 'vad',
      vadAuto: true,
      vadThreshold: -50,
      pttReleaseMs: 200,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      rnnoise: true,
      outputVolume: 1,
      sounds: true,
      bindings: { ptt: { type: 'key', code: 'KeyV' }, toggleMute: null, toggleDeafen: null }
    }
  }

  // Atama biçimleri: { type: 'key', code }, { type: 'mouse', button: 1|3|4 }, { type: 'gamepad', button }
  function normBinding (b) {
    if (!b || typeof b !== 'object') return null
    if (b.type === 'key') {
      return typeof b.code === 'string' && KEY_CODE_RE.test(b.code) && b.code !== 'Escape' ? { type: 'key', code: b.code } : null
    }
    if (b.type === 'mouse') {
      return b.button === 1 || b.button === 3 || b.button === 4 ? { type: 'mouse', button: b.button } : null
    }
    if (b.type === 'gamepad') {
      var n = b.button
      return isNum(n) && n >= 0 && n <= MAX_PAD_BUTTON && Math.floor(n) === n ? { type: 'gamepad', button: n } : null
    }
    return null
  }

  function sameBinding (a, b) {
    if (!a || !b) return !a && !b
    return a.type === b.type && a.code === b.code && a.button === b.button
  }

  // Gösterim adları
  var layoutMap = null
  var layoutAsked = false

  // Klavye düzeni (destekleyen tarayıcılarda) harf ve simge tuşlarının gerçek karakterini verir
  function askLayout () {
    if (layoutAsked) return
    layoutAsked = true
    try {
      var kb = typeof navigator !== 'undefined' ? navigator.keyboard : null
      if (!kb || typeof kb.getLayoutMap !== 'function') return
      Promise.resolve(kb.getLayoutMap()).then(function (m) {
        if (m && typeof m.get === 'function') layoutMap = m
      }, noop)
    } catch (e) {}
  }

  function format (text, params) {
    return String(text).replace(/\{(\w+)\}/g, function (m, k) {
      return params && hasOwn(params, k) ? String(params[k]) : m
    })
  }

  function translator (t) {
    var fn = typeof t === 'function' ? t : null
    if (!fn && typeof window !== 'undefined' && window.I18N && typeof window.I18N.t === 'function') {
      var i18n = window.I18N
      fn = function (key, params) { return i18n.t(key, params) }
    }
    return function (key, params) {
      var s = null
      if (fn) {
        try {
          s = fn(key, params)
        } catch (e) {
          s = null
        }
      }
      if (typeof s !== 'string' || !s || s === key) s = format(hasOwn(FALLBACK, key) ? FALLBACK[key] : key, params)
      return s
    }
  }

  function upper (ch) {
    var lang = null
    try {
      lang = (window.I18N && typeof window.I18N.lang === 'string' && window.I18N.lang) || document.documentElement.lang || null
    } catch (e) {
      lang = null
    }
    try {
      return lang ? ch.toLocaleUpperCase(lang) : ch.toUpperCase()
    } catch (e) {
      return ch.toUpperCase()
    }
  }

  // Çağrılar t('...') biçimindedir, böylece denetleyici anahtarların sözlükte varlığını doğrular
  function keyName (code, t) {
    if (layoutMap && LAYOUT_RE.test(code)) {
      var ch = null
      try {
        ch = layoutMap.get(code)
      } catch (e) {
        ch = null
      }
      if (typeof ch === 'string' && ch.length === 1 && ch.trim()) return upper(ch)
    }
    if (/^Key[A-Z]$/.test(code)) return code.slice(3)
    if (/^Digit[0-9]$/.test(code)) return code.slice(5)
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
    if (/^Numpad[0-9]$/.test(code)) return t('keys.numpad', { key: code.slice(6) })
    if (hasOwn(NUMPAD_SYMBOLS, code)) return t('keys.numpad', { key: NUMPAD_SYMBOLS[code] })
    if (hasOwn(KEY_NAMES, code)) return t('keys.' + code)
    if (hasOwn(SYMBOL_KEYS, code)) return SYMBOL_KEYS[code]
    return code
  }

  // Atamanın gösterim adı: çeviri fonksiyonu verilmezse window.I18N.t, o da yoksa İngilizce yedek kullanılır
  function bindingLabel (binding, translate) {
    var t = translator(translate)
    var b = normBinding(binding)
    if (!b) return t('bindings.none')
    if (b.type === 'key') return t('bindings.key', { key: keyName(b.code, t) })
    if (b.type === 'mouse') return b.button === 1 ? t('bindings.mouseMiddle') : t('bindings.mouseSide', { n: b.button + 1 })
    return t('bindings.gamepad', { n: b.button })
  }

  // Kullanıcı, kanal ve eş kimlikleri: sayı veya kısa güvenli dizge, prototip anahtarları reddedilir
  function normId (v) {
    var s = ''
    if (typeof v === 'number' && isFinite(v)) s = String(v)
    else if (typeof v === 'string') s = v
    return ID_RE.test(s) && s !== '__proto__' ? s : null
  }

  function isPeerId (v) {
    return typeof v === 'string' && normId(v) === v
  }

  function randomHex (bytes) {
    var b = new Uint8Array(bytes)
    var c = window.crypto || window.msCrypto
    if (c && typeof c.getRandomValues === 'function') {
      c.getRandomValues(b)
    } else {
      var i = 0
      while (i < bytes) {
        b[i] = Math.floor(Math.random() * 256)
        i++
      }
    }
    return Array.prototype.map.call(b, function (x) {
      return (x < 16 ? '0' : '') + x.toString(16)
    }).join('')
  }

  // Zarf biçimi '1.<kid>.<nonce>.<kutu>' (bkz. crypto.js)
  function kidOf (envelope) {
    if (typeof envelope !== 'string') return null
    var parts = envelope.split('.')
    return parts.length >= 3 && parts[0] === '1' && KID_RE.test(parts[1]) ? parts[1] : null
  }

  function sanitizeIce (list) {
    if (!Array.isArray(list)) return []
    var out = []
    list.slice(0, 10).forEach(function (s) {
      if (!s || typeof s !== 'object') return
      var raw = Array.isArray(s.urls) ? s.urls : [s.urls]
      var urls = raw.filter(function (u) {
        return typeof u === 'string' && u.length <= 512 && ICE_URL_RE.test(u)
      })
      if (!urls.length) return
      var entry = { urls: urls }
      if (typeof s.username === 'string' && s.username.length <= 512) entry.username = s.username
      if (typeof s.credential === 'string' && s.credential.length <= 512) entry.credential = s.credential
      out.push(entry)
    })
    return out
  }

  function parseCandidate (c) {
    if (!c || typeof c !== 'object') return null
    if (typeof c.candidate !== 'string' || !c.candidate || c.candidate.length > MAX_CANDIDATE_CHARS) return null
    var mid = typeof c.sdpMid === 'string' && c.sdpMid.length <= 64 ? c.sdpMid : null
    var idx = c.sdpMLineIndex
    if (typeof idx !== 'number' || idx < 0 || idx > 63 || Math.floor(idx) !== idx) idx = null
    if (mid === null && idx === null) return null
    return { candidate: c.candidate, sdpMid: mid, sdpMLineIndex: idx }
  }

  function stopStream (stream) {
    if (!stream) return
    try {
      stream.getTracks().forEach(function (t) { t.stop() })
    } catch (e) {}
  }

  function isEditable (t) {
    if (!t || t.nodeType !== 1) return false
    if (t.isContentEditable) return true
    var tag = t.tagName
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
  }

  function iceToConn (s) {
    if (s === 'checking' || s === 'new') return 'connecting'
    if (s === 'completed') return 'connected'
    return s
  }

  // Analizörden RMS (0..1), tampon taşıyıcı nesnede tutulur
  function readRms (an, holder) {
    if (!an) return 0
    var n = an.fftSize
    var sum = 0
    var i = 0
    var v = 0
    try {
      if (typeof an.getFloatTimeDomainData === 'function') {
        if (!holder.fbuf || holder.fbuf.length !== n) holder.fbuf = new Float32Array(n)
        an.getFloatTimeDomainData(holder.fbuf)
        while (i < n) {
          v = holder.fbuf[i]
          sum += v * v
          i++
        }
      } else {
        if (!holder.bbuf || holder.bbuf.length !== n) holder.bbuf = new Uint8Array(n)
        an.getByteTimeDomainData(holder.bbuf)
        while (i < n) {
          v = (holder.bbuf[i] - 128) / 128
          sum += v * v
          i++
        }
      }
    } catch (e) {
      return 0
    }
    return Math.sqrt(sum / n)
  }

  // Oyun kolları: her biri için basılı düğme bayrakları
  function readPads () {
    var out = []
    var list = null
    try {
      list = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : null
    } catch (e) {
      list = null
    }
    if (!list) return out
    var i = 0
    while (i < list.length && i < MAX_PADS) {
      var pad = list[i]
      var flags = []
      if (pad && pad.connected !== false && pad.buttons) {
        var j = 0
        while (j < pad.buttons.length && j <= MAX_PAD_BUTTON) {
          var btn = pad.buttons[j]
          flags.push(typeof btn === 'number' ? btn > 0.5 : !!(btn && (btn.pressed || btn.value > 0.5)))
          j++
        }
      }
      out.push(flags)
      i++
    }
    return out
  }

  function stopEvent (e) {
    e.preventDefault()
    e.stopPropagation()
    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation()
  }

  // Ekran paylaşımı yardımcıları (saf fonksiyonlar, VoiceClient.screenUtils ile Node testlerine açılır)

  // Özellik algılama (tarayıcı adı tahmini yok). İzlemek için sesli sohbet desteği yeter, paylaşmak için
  // getDisplayMedia, addTrack, aktarıcı listesi ve replaceTrack gerekir.
  function screenSupport () {
    var base = support()
    if (!base.ok) return { share: false, watch: false, reason: base.reason }
    var md = navigator.mediaDevices
    var P = window.RTCPeerConnection
    var proto = P && P.prototype
    var S = window.RTCRtpSender
    var ok = !!(md && typeof md.getDisplayMedia === 'function' && proto && typeof proto.addTrack === 'function' &&
      typeof proto.getTransceivers === 'function' && S && S.prototype && typeof S.prototype.replaceTrack === 'function')
    return { share: ok, watch: true, reason: ok ? null : 'screen_unsupported' }
  }

  function screenPresets () {
    return SCREEN_PRESET_IDS.map(function (id) {
      var p = SCREEN_PRESETS[id]
      return { id: id, width: p.width, height: p.height, frameRate: p.frameRate, maxBitrate: p.maxBitrate }
    })
  }

  function screenDefaults () {
    return { preset: DEFAULT_SCREEN.preset, hint: DEFAULT_SCREEN.hint, audio: DEFAULT_SCREEN.audio }
  }

  // Paylaşım seçenekleri: geçersiz alanlar önce base'den, o da geçersizse varsayılandan alınır
  function screenOptions (opts, base) {
    var o = opts && typeof opts === 'object' ? opts : {}
    var b = base && typeof base === 'object' ? base : {}
    function pick (key, valid) {
      if (valid(o[key])) return o[key]
      if (valid(b[key])) return b[key]
      return DEFAULT_SCREEN[key]
    }
    return {
      preset: pick('preset', function (v) { return SCREEN_PRESET_IDS.indexOf(v) >= 0 }),
      hint: pick('hint', function (v) { return SCREEN_HINTS.indexOf(v) >= 0 }),
      audio: pick('audio', function (v) { return typeof v === 'boolean' })
    }
  }

  function presetOf (id) {
    return SCREEN_PRESETS[SCREEN_PRESET_IDS.indexOf(id) >= 0 ? id : DEFAULT_SCREEN.preset]
  }

  // RTCRtpSender.setParameters ile uygulanan kodlama sınırları
  function screenEncoding (presetId) {
    var p = presetOf(presetId)
    return { maxBitrate: p.maxBitrate, maxFramerate: p.frameRate }
  }

  // Yakalanan görüntü izine applyConstraints ile uygulanan sınırlar (getDisplayMedia min ve exact kabul etmez)
  function trackConstraints (presetId) {
    var p = presetOf(presetId)
    return { width: { max: p.width }, height: { max: p.height }, frameRate: { max: p.frameRate } }
  }

  // getDisplayMedia isteği. Tanımayan tarayıcılar ek alanları yok sayar. Ses isteğe bağlıdır, işleme kapalıdır
  // (müzik ve oyun sesi bozulmasın). Kendi sekmesi listede yer almaz (sonsuz yansıma olmasın). restrictOwnAudio
  // sistem sesinden Telsiz'in kendi çaldığı sesleri (konuşmalar, bildirimler, Telsiz DJ) çıkarır, böylece
  // dinleyenler kendi seslerini paylaşımdan geri duymaz. Masaüstü uygulamasında Electron bu istekle sistem sesi
  // yakalamasını uygulamanın kendi sesi hariç yakalamaya çevirir.
  function displayConstraints (opts) {
    var o = screenOptions(opts, null)
    var c = {
      video: trackConstraints(o.preset),
      audio: o.audio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, restrictOwnAudio: true } : false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'include'
    }
    if (o.audio) c.systemAudio = 'include'
    return c
  }

  // Ekran aktarıcılarının kodek listesi (setCodecPreferences). Görüntüde VP8, VP9 profil 0, AV1 profil 0, H.264
  // temel profil (packetization-mode=1) ve RTX kalır, diğer profiller ve FEC çıkarılır. Paylaşılan seste yalnız
  // Opus kalır. Amaç SDP'yi ve şifreli sinyal zarfını küçültmek (sunucunun maxSignalChars sınırı). Sıra
  // tarayıcının kendi sırasıdır.
  function keepScreenCodec (kind, codec) {
    if (!codec || typeof codec.mimeType !== 'string') return false
    var m = codec.mimeType.toLowerCase()
    var f = typeof codec.sdpFmtpLine === 'string' ? codec.sdpFmtpLine : ''
    if (kind === 'audio') return m === 'audio/opus'
    if (m === 'video/rtx' || m === 'video/vp8') return true
    if (m === 'video/vp9') return !/profile-id=[1-9]/.test(f)
    if (m === 'video/av1') return !/profile=[1-9]/.test(f)
    if (m === 'video/h264') return /packetization-mode=1/.test(f) && /profile-level-id=42(e0|00)/i.test(f)
    return false
  }

  function screenErrorCode (e) {
    if (e && typeof e.code === 'string' && /^screen_/.test(e.code)) return e.code
    var name = e && e.name
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'screen_denied'
    if (name === 'InvalidStateError') return 'screen_gesture'
    if (name === 'NotFoundError') return 'screen_not_found'
    if (name === 'TypeError' || name === 'NotSupportedError') return 'screen_unsupported'
    return 'screen_failed'
  }

  function onlyKeys (obj, allowed) {
    return Object.keys(obj).every(function (k) { return allowed.indexOf(k) >= 0 })
  }

  // Ekran sinyali doğrulaması (tür, alan kümesi, alan türleri ve değer kümeleri). sid ve n ortak doğrulamadadır.
  // Dönüş: normalleştirilmiş nesne veya null.
  //   { type: 'screen', on: true, id, audio, hint, preset }  paylaşım duyurusu veya güncellemesi
  //   { type: 'screen', on: false, id }                      paylaşım bitti
  //   { type: 'watch', on, id }                               izleme isteği veya bırakma
  function validScreenSignal (d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return null
    if (d.type !== 'screen' && d.type !== 'watch') return null
    if (typeof d.on !== 'boolean' || typeof d.id !== 'string' || !SID_RE.test(d.id)) return null
    if (d.type === 'watch') return onlyKeys(d, SCREEN_OFF_KEYS) ? { type: 'watch', on: d.on, id: d.id } : null
    if (!d.on) return onlyKeys(d, SCREEN_OFF_KEYS) ? { type: 'screen', on: false, id: d.id } : null
    if (!onlyKeys(d, SCREEN_ON_KEYS) || typeof d.audio !== 'boolean') return null
    if (SCREEN_HINTS.indexOf(d.hint) < 0 || SCREEN_PRESET_IDS.indexOf(d.preset) < 0) return null
    return { type: 'screen', on: true, id: d.id, audio: d.audio, hint: d.hint, preset: d.preset }
  }

  // Kamera desteği: sesli sohbet desteği, aktarıcı listesi ve replaceTrack (kamera izi mevcut bağlantılara eklenir)
  function cameraSupport () {
    var base = support()
    if (!base.ok) return { ok: false, reason: base.reason === 'insecure' ? 'insecure' : 'camera_unsupported' }
    var P = window.RTCPeerConnection
    var proto = P && P.prototype
    var S = window.RTCRtpSender
    var ok = !!(proto && typeof proto.addTrack === 'function' && typeof proto.getTransceivers === 'function' &&
      S && S.prototype && typeof S.prototype.replaceTrack === 'function')
    return { ok: ok, reason: ok ? null : 'camera_unsupported' }
  }

  // getUserMedia isteği (yalnızca görüntü, ses ayrı mikrofon hattındadır) ve izin alındıktan sonra izine
  // applyConstraints ile uygulanan sınırlar. opt: { facing: 'user' | 'environment', deviceId, exact }. Varsayılan
  // ön kameradır (telefonda arka kamera açılmasın), kamerası yönsüz bilgisayarda tercih yalnızca ipucudur.
  // exact: kamera değiştirirken istenen kamera yoksa istek reddedilir (aynı kamera yeniden açılmasın).
  function cameraConstraints (opt) {
    var o = opt || {}
    var video = { width: { ideal: CAMERA_SIZE.width }, height: { ideal: CAMERA_SIZE.height }, frameRate: { ideal: CAMERA_SIZE.frameRate, max: CAMERA_SIZE.frameRate } }
    if (typeof o.deviceId === 'string' && o.deviceId) {
      video.deviceId = o.exact ? { exact: o.deviceId } : { ideal: o.deviceId }
    } else {
      var facing = o.facing === 'environment' ? 'environment' : 'user'
      video.facingMode = o.exact ? { exact: facing } : { ideal: facing }
    }
    return { audio: false, video: video }
  }

  // İzin yönü: önce izin ayarı, sonra tek değerli yetenek, en son cihaz adı (Android "facing back" gibi).
  // Yalnızca 'user' ve 'environment' döner, bilinmiyorsa null (bilgisayar kamerası çoğunlukla yön bildirmez).
  function cameraFacingOf (settings, caps, label) {
    var f = settings && settings.facingMode
    if (f === 'user' || f === 'environment') return f
    var c = caps && caps.facingMode
    if (Array.isArray(c) && c.length === 1 && (c[0] === 'user' || c[0] === 'environment')) return c[0]
    var name = typeof label === 'string' ? label.toLowerCase() : ''
    if (/\b(back|rear|environment)\b/.test(name)) return 'environment'
    if (/\b(front|user)\b/.test(name)) return 'user'
    return null
  }

  // Kamera değiştirme denemeleri sırayla: yönü bilinen kamerada karşı yön, birden çok kamerada listedeki sıradaki
  // kamera. Yön isteği reddedilirse (cihaz yön bildirmiyor) sıradaki kamera denenir. Seçenek yoksa boş dizi.
  function cameraSwitchTargets (facing, deviceId, ids) {
    var list = Array.isArray(ids) ? ids.filter(function (id) { return typeof id === 'string' && id }) : []
    var out = []
    if (facing === 'user' || facing === 'environment') out.push({ facing: facing === 'user' ? 'environment' : 'user', exact: true })
    if (list.length >= 2) {
      var i = list.indexOf(deviceId)
      var next = list[(i + 1) % list.length]
      if (next !== deviceId) out.push({ deviceId: next, exact: true })
    }
    return out
  }

  function cameraTrackConstraints () {
    return { width: { ideal: CAMERA_SIZE.width, max: CAMERA_SIZE.width }, height: { ideal: CAMERA_SIZE.height, max: CAMERA_SIZE.height }, frameRate: { max: CAMERA_SIZE.frameRate } }
  }

  function cameraEncoding () {
    return { maxBitrate: CAMERA_ENCODING.maxBitrate, maxFramerate: CAMERA_ENCODING.maxFramerate }
  }

  function cameraErrorCode (e) {
    if (e && typeof e.code === 'string' && CAMERA_ERRORS.indexOf(e.code) >= 0) return e.code
    if (e && e.code === 'cancelled') return 'cancelled'
    var name = e && e.name
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'camera_denied'
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'camera_not_found'
    if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'camera_in_use'
    if (name === 'TypeError' || name === 'NotSupportedError') return 'camera_unsupported'
    return 'camera_failed'
  }

  // Kamera sinyali: hangi m satırının (mid) kameranın olduğunu karşı tarafa bildirir. Aktarıcılar ekran
  // paylaşımıyla ve iki yönde ortak kullanıldığı için alıcı görüntü izinin kamera mı ekran mı olduğunu buradan
  // anlar. Dönüş: { type: 'camera', on: true, mid } | { type: 'camera', on: false } veya null.
  function validCameraSignal (d) {
    if (!d || typeof d !== 'object' || Array.isArray(d) || d.type !== 'camera' || typeof d.on !== 'boolean') return null
    if (!onlyKeys(d, CAMERA_KEYS)) return null
    if (!d.on) return d.mid === undefined ? { type: 'camera', on: false } : null
    if (typeof d.mid !== 'string' || !MID_RE.test(d.mid)) return null
    return { type: 'camera', on: true, mid: d.mid }
  }

  // Yerel paylaşım durum makinesi: idle -> starting -> live -> idle.
  // live iken start kaynak değişimidir (live kalır), kaynak değişimi başarısız olursa paylaşım sürer.
  function shareStep (state, ev) {
    if (ev === 'stop' || ev === 'ended' || ev === 'leave') return 'idle'
    if (state === 'live') return 'live'
    if (state === 'starting') {
      if (ev === 'granted') return 'live'
      if (ev === 'failed') return 'idle'
      return 'starting'
    }
    return ev === 'start' ? 'starting' : 'idle'
  }

  // Uzak paylaşım durum makinesi (izleyici tarafı): none -> available -> requested -> live.
  // failed: istek süresinde görüntü gelmedi, yeniden izlemek mümkündür.
  function watchStep (state, ev) {
    if (ev === 'withdraw') return 'none'
    if (state === 'none' || !state) return ev === 'announce' ? 'available' : 'none'
    if (ev === 'unwatch') return 'available'
    if (ev === 'watch') return state === 'available' || state === 'failed' ? 'requested' : state
    if (ev === 'media') return state === 'requested' || state === 'failed' ? 'live' : state
    if (ev === 'nomedia') return state === 'live' ? 'requested' : state
    if (ev === 'timeout') return state === 'requested' ? 'failed' : state
    return state
  }

  function create (opts) {
    if (!opts || typeof opts.api !== 'function' || typeof opts.seal !== 'function' || typeof opts.open !== 'function') {
      throw new TypeError('VoiceClient.create: api, seal and open functions are required')
    }
    var api = opts.api
    var seal = opts.seal
    var open = opts.open
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : null
    var onScreenEvent = typeof opts.onScreenEvent === 'function' ? opts.onScreenEvent : null
    var onCameraEvent = typeof opts.onCameraEvent === 'function' ? opts.onCameraEvent : null
    var storage = opts.storage && typeof opts.storage === 'object' ? opts.storage : null
    var ctx = null
    var rnModule = null
    var seen = new Map()
    var emitScheduled = false
    var listening = false
    var mouseGuard = false
    var capListening = false
    var keySwallowing = false

    var st = {
      gen: 0,
      channelId: null,
      joining: false,
      inVoice: false,
      joinPromise: null,
      joinRequest: null,
      leavePromise: null,
      myPeerId: null,
      myUserId: null,
      kid: null,
      iceServers: [],
      muted: false,
      // Herkes için susturma (ses odası denetimi, meta.users[].voiceMuted): kendi mikrofonum kapalı tutulur,
      // susturulan diğer kişilerin sesi bu cihazda çalınmaz. st.muted kişinin kendi tercihidir, korunur.
      serverMuted: false,
      serverMutedUsers: Object.create(null),
      deafened: false,
      settings: defaultSettings(),
      volumes: Object.create(null),
      localMutes: Object.create(null),
      // Mikrofon katmanı: ses oturumu ve mikrofon testi ortak kullanır
      local: null,
      micPromise: null,
      micJob: Promise.resolve(),
      micGen: 0,
      pipe: null,
      mode: null,
      // RNNoise yüklenemedi veya işlerken hata verdi: bu sayfa oturumunda yeniden denenmez (ayar kapatılıp
      // açılırsa denenir), ses tarayıcının kendi işlemesiyle sürer
      rnFailed: false,
      testing: false,
      testPromise: null,
      // Ölçüm ve kapı
      level: null,
      smooth: null,
      noiseFloor: null,
      floorTimes: [],
      floorValues: [],
      vadOpen: false,
      lastAbove: 0,
      gate: false,
      selfSpeaking: false,
      inputLevel: 0,
      emittedLevel: null,
      emittedThreshold: null,
      levelEmitAt: 0,
      tickCount: 0,
      // Bas konuş ve atamalar. external: masaüstü uygulamasının genel bas konuş kısayolu veya tuş kancası
      held: noneHeld(),
      pttActive: false,
      pttTail: false,
      pttTimer: null,
      padPrev: {},
      padInit: true,
      rafId: 0,
      capture: null,
      swallowKey: null,
      swallowMouse: null,
      // Oturum
      errorCode: null,
      // Özel mesaj araması: sinyaller çiftin kişisel anahtarlarıyla şifrelenir (join seçeneği private.seal ve
      // private.open), grup anahtarı kullanılmaz, sunucu susturması uygulanmaz. Yalnızca katılım sürerken ve seste
      // dolu tutulur.
      privateCall: false,
      privateSeal: null,
      privateOpen: null,
      serverError: null,
      autoplayBlocked: false,
      peers: Object.create(null),
      roster: Object.create(null),
      ops: Object.create(null),
      sendQueues: Object.create(null),
      lastSigSeq: 0,
      unknown: [],
      lastMeta: null,
      seenSelf: false,
      joinedAt: 0,
      graceTimer: null,
      tickTimer: null,
      closeTimer: null,
      timers: new Set(),
      wakeLock: null,
      wakeLockPending: false,
      container: null,
      statePosting: false,
      stateDirty: false,
      // Ekran paylaşımı: yerel paylaşım (yalnızca canlıyken), seçici açıkken bekleyen istek, uzak paylaşımlar
      // (eş kimliğine göre), izlenmek istenen paylaşım kimlikleri, kişi bazlı paylaşım sesi ayarları
      screenSettings: screenDefaults(),
      share: null,
      shareState: 'idle',
      shareStarting: null,
      shareGen: 0,
      shareError: null,
      pageHideOn: false,
      remote: Object.create(null),
      watchWant: Object.create(null),
      // Bağlantı yenilenince yeniden istenecek izleme (eş kimliği -> paylaşım kimliği) ve zarf sınırı yüzünden
      // eşe gönderilen ekran içeriğinin kademesi (1: yalnız görüntü, 2: ekran yok), ses oturumu boyunca
      rewatch: Object.create(null),
      screenLimit: Object.create(null),
      screenVolumes: Object.create(null),
      screenMutes: Object.create(null),
      // Sunucudan son yanıt zamanı ve paylaşım sürerken erişim denetimi (bkz. startLinkWatch)
      serverAt: 0,
      linkTimer: null,
      linkProbe: null,
      // Kamera: yerel kamera (yalnızca canlıyken), açılırken bekleyen iş, sunucuya giden açık bilgisi kuyruğu,
      // metada kendi kameramızın açık görüldüğü (sunucu kapatırsa durdurmak için), zarf sınırı veya red yüzünden
      // kamera gönderilmeyen eşler. Kamera değiştirme: süren iş, birden çok kamera olup olmadığı, sayfa açıkken
      // hatırlanan son seçim (kamera kapatılıp açılınca aynı kamera istenir, ilk açılış ön kameradır), cihazın
      // aynı anda iki kamera açamadığı (öğrenilince eski kamera değiştirmenin başında bırakılır)
      camera: null,
      cameraStarting: null,
      cameraSwitching: null,
      cameraCanSwitch: false,
      cameraPick: null,
      cameraExclusive: false,
      cameraDevicesWatch: null,
      cameraGen: 0,
      cameraError: null,
      cameraPost: Promise.resolve(),
      cameraSeen: false,
      camBlocked: Object.create(null)
    }

    loadSettings()
    updateMouseGuard()
    askLayout()

    // Durum bildirimi: aynı görev içindeki değişiklikler tek çağrıda toplanır
    function emit () {
      if (emitScheduled || !onChange) return
      emitScheduled = true
      Promise.resolve().then(function () {
        emitScheduled = false
        var snap = snapshot()
        try {
          onChange(snap)
        } catch (e) {
          setTimeout(function () { throw e }, 0)
        }
      })
    }

    // Sunucudan gelen her HTTP yanıtı (durum kodu ne olursa olsun) sunucuya erişildiğinin kanıtıdır
    function callApi (method, path, body) {
      return new Promise(function (resolve, reject) {
        var r
        try {
          r = api(method, path, body)
        } catch (e) {
          reject(e)
          return
        }
        Promise.resolve(r).then(function (res) {
          if (res && typeof res.status === 'number' && res.status > 0) st.serverAt = Date.now()
          resolve(res)
        }, reject)
      })
    }

    function delay (ms) {
      return new Promise(function (resolve) {
        var id = setTimeout(function () {
          st.timers.delete(id)
          resolve()
        }, ms)
        st.timers.add(id)
      })
    }

    // Ayarlar: cihaza özel, storage içinde 'telsiz.voice', kişi bazlı ses ayarları 'telsiz.voice.peers'
    function readStored (key) {
      var obj = null
      if (storage && typeof storage.get === 'function') {
        try {
          obj = storage.get(key)
        } catch (e) {
          obj = null
        }
      }
      var tries = 0
      while (typeof obj === 'string' && tries < 2) {
        try {
          obj = JSON.parse(obj)
        } catch (e) {
          obj = null
        }
        tries++
      }
      return obj && typeof obj === 'object' ? obj : null
    }

    function writeStored (key, value) {
      if (!storage || typeof storage.set !== 'function') return
      try {
        storage.set(key, JSON.stringify(value))
      } catch (e) {}
    }

    function loadSettings () {
      var obj = readStored(STORAGE_KEY)
      if (obj) mergeSettings(obj)
      var p = readStored(PEERS_KEY)
      if (p) {
        copyMap(p.volumes, st.volumes, function (v) { return typeof v === 'number' && v >= 0 && v <= PEER_VOLUME_MAX })
        copyMap(p.localMutes, st.localMutes, function (v) { return v === true })
        copyMap(p.screenVolumes, st.screenVolumes, function (v) { return typeof v === 'number' && v >= 0 && v <= 1 })
      }
      st.screenSettings = screenOptions(readStored(SCREEN_KEY), null)
    }

    function copyMap (src, dst, ok) {
      if (!src || typeof src !== 'object') return
      Object.keys(src).slice(0, MAX_STORED_USERS).forEach(function (k) {
        if (normId(k) === k && ok(src[k])) dst[k] = src[k]
      })
    }

    function saveSettings () {
      writeStored(STORAGE_KEY, getSettings())
    }

    function savePeers () {
      writeStored(PEERS_KEY, { volumes: st.volumes, localMutes: st.localMutes, screenVolumes: st.screenVolumes })
    }

    function copyBindings () {
      var b = st.settings.bindings
      return { ptt: normBinding(b.ptt), toggleMute: normBinding(b.toggleMute), toggleDeafen: normBinding(b.toggleDeafen) }
    }

    function getSettings () {
      var s = st.settings
      return {
        inputDeviceId: s.inputDeviceId,
        inputMode: s.inputMode,
        vadAuto: s.vadAuto,
        vadThreshold: s.vadThreshold,
        pttReleaseMs: s.pttReleaseMs,
        echoCancellation: s.echoCancellation,
        noiseSuppression: s.noiseSuppression,
        autoGainControl: s.autoGainControl,
        rnnoise: s.rnnoise,
        outputVolume: s.outputVolume,
        sounds: s.sounds,
        bindings: copyBindings()
      }
    }

    // Geçersiz alanlar yok sayılır. Dönüş: hangi tür değişiklik olduğu
    function mergeSettings (partial) {
      var s = st.settings
      var out = { mic: false, device: false, bindings: false, mode: false, rnnoise: false }
      if (!partial || typeof partial !== 'object') return out
      if (hasOwn(partial, 'inputDeviceId')) {
        var d = partial.inputDeviceId
        var id = typeof d === 'string' && d.length <= 512 ? (d || null) : (d === null ? null : undefined)
        if (id !== undefined && id !== s.inputDeviceId) {
          s.inputDeviceId = id
          out.mic = true
          out.device = true
        }
      }
      if ((partial.inputMode === 'vad' || partial.inputMode === 'ptt') && partial.inputMode !== s.inputMode) {
        s.inputMode = partial.inputMode
        out.mode = true
      }
      if (typeof partial.vadAuto === 'boolean') s.vadAuto = partial.vadAuto
      if (isNum(partial.vadThreshold)) s.vadThreshold = clamp(partial.vadThreshold, MIN_DB, 0)
      if (isNum(partial.pttReleaseMs)) s.pttReleaseMs = Math.round(clamp(partial.pttReleaseMs, 0, 1000))
      MIC_FLAGS.forEach(function (k) {
        if (typeof partial[k] === 'boolean' && partial[k] !== s[k]) {
          s[k] = partial[k]
          out.mic = true
        }
      })
      // RNNoise mikrofonu yeniden almadan hattın içinde açılır ve kapanır (getUserMedia kısıtlarını değiştirmez)
      if (typeof partial.rnnoise === 'boolean' && partial.rnnoise !== s.rnnoise) {
        s.rnnoise = partial.rnnoise
        out.rnnoise = true
      }
      if (isNum(partial.outputVolume)) s.outputVolume = clamp(partial.outputVolume, 0, 1)
      if (typeof partial.sounds === 'boolean') s.sounds = partial.sounds
      var pb = partial.bindings
      if (pb && typeof pb === 'object') {
        ACTIONS.forEach(function (a) {
          if (!hasOwn(pb, a)) return
          var b = normBinding(pb[a])
          // Bas konuş temizlenemez, geçersiz atama yok sayılır
          if (!b && (a === 'ptt' || pb[a] !== null)) return
          if (sameBinding(b, s.bindings[a])) return
          s.bindings[a] = b
          out.bindings = true
          // Aynı düğme iki aç/kapa eylemine birden atanamaz
          if (b && a !== 'ptt') {
            var other = a === 'toggleMute' ? 'toggleDeafen' : 'toggleMute'
            if (sameBinding(b, s.bindings[other])) s.bindings[other] = null
          }
        })
      }
      return out
    }

    // Dönüş Promise<null | hata kodu>, asla reddedilmez
    function setSettings (partial) {
      var ch = mergeSettings(partial)
      saveSettings()
      // Mod değişince her kaynak bırakılır, yalnızca atamalar değişince masaüstü kaynağı açık kalır
      if (ch.mode) releaseAll(false)
      else if (ch.bindings) releaseAll(true)
      if (ch.bindings) {
        st.padInit = true
        updateMouseGuard()
      }
      if (ch.rnnoise) {
        // Kişi ayarı yeniden açarsa önceki hata unutulur ve yükleme yeniden denenir
        if (st.settings.rnnoise) st.rnFailed = false
        syncRnnoise()
      }
      updatePadPoll()
      applyAllAudio()
      updateGate(false)
      emit()
      if (!ch.mic || !st.local) return Promise.resolve(null)
      return queueReacquire(!ch.device).then(function () {
        return null
      }, function (e) {
        return e && typeof e.code === 'string' ? e.code : 'mic_failed'
      })
    }

    function volumeOf (uid) {
      var v = st.volumes[uid]
      return typeof v === 'number' ? v : 1
    }

    // Kişinin sesi: genel çıkış x kişi bazlı ses (en fazla %200), sağırlaştırma, yerel ve sunucu susturması.
    // Etkin düzey 1'e kadar ses öğesinin volume alanıyla uygulanır. Öğenin volume alanı en fazla 1 olduğu için
    // 1'in üstünde (ör. kişi %200, genel çıkış %100) o kişinin akışı ses bağlamında yükseltilir (ensureBoost):
    // kaynak -> kazanç -> sınırlayıcı -> hoparlör. Bu sırada ses öğesi sessiz olarak çalmaya devam eder, çünkü
    // Chromium uzak WebRTC akışını ses bağlamına yalnızca akış bir medya öğesine bağlıyken verir. Ses bağlamı
    // kurulamazsa düzey 1'de kalır. Etkin düzey 1'e inince yükseltme kaldırılır.
    function applyPeerAudio (peer) {
      var a = peer.audio
      var r = st.roster[peer.peerId]
      if (!a || !r) return
      var muted = st.deafened || st.localMutes[r.userId] === true || st.serverMutedUsers[r.userId] === true
      var level = clamp(st.settings.outputVolume * volumeOf(r.userId), 0, PEER_VOLUME_MAX)
      var boost = level > 1 ? ensureBoost(peer) : null
      if (!boost) dropBoost(peer)
      try {
        a.volume = Math.min(level, 1)
      } catch (e) {}
      a.muted = boost ? true : muted
      if (boost) setBoostGain(boost, muted ? 0 : level)
    }

    function ensureBoost (peer) {
      var stream = peer.stream
      var c = stream ? ensureContext() : null
      if (!c || c.state === 'closed' || typeof c.createGain !== 'function' || typeof c.createMediaStreamSource !== 'function') return null
      var b = peer.boost
      if (b && b.ctx === c && b.stream === stream) return b
      dropBoost(peer)
      var nodes = { ctx: c, stream: stream, source: null, gain: null, limiter: null }
      try {
        nodes.source = c.createMediaStreamSource(stream)
        nodes.gain = c.createGain()
        nodes.gain.gain.value = 0
        nodes.source.connect(nodes.gain)
        var last = nodes.gain
        if (typeof c.createDynamicsCompressor === 'function') {
          nodes.limiter = c.createDynamicsCompressor()
          Object.keys(BOOST_LIMITER).forEach(function (key) {
            if (nodes.limiter[key]) nodes.limiter[key].value = BOOST_LIMITER[key]
          })
          nodes.gain.connect(nodes.limiter)
          last = nodes.limiter
        }
        last.connect(c.destination)
      } catch (e) {
        disconnectNodes([nodes.source, nodes.gain, nodes.limiter])
        return null
      }
      peer.boost = nodes
      return nodes
    }

    function setBoostGain (boost, value) {
      var p = boost.gain.gain
      try {
        if (typeof p.setTargetAtTime === 'function') p.setTargetAtTime(value, boost.ctx.currentTime, BOOST_RAMP_S)
        else p.value = value
      } catch (e) {
        p.value = value
      }
    }

    function dropBoost (peer) {
      var b = peer.boost
      peer.boost = null
      if (b) disconnectNodes([b.source, b.gain, b.limiter])
    }

    function applyAllAudio () {
      Object.keys(st.peers).forEach(function (pid) { applyPeerAudio(st.peers[pid]) })
      Object.keys(st.remote).forEach(applyScreenAudio)
    }

    function screenVolumeOf (uid) {
      var v = st.screenVolumes[uid]
      return typeof v === 'number' ? v : 1
    }

    // Paylaşılan ses: genel çıkış x kişi bazlı paylaşım sesi, sağırlaştırma ve paylaşım susturması uygulanır.
    // Mikrofon sesinin kişi ayarlarından (ses seviyesi, yerel susturma) bağımsızdır.
    function applyScreenAudio (pid) {
      var rs = st.remote[pid]
      if (!rs || !rs.audioEl) return
      try {
        rs.audioEl.volume = clamp(st.settings.outputVolume * screenVolumeOf(rs.userId), 0, 1)
      } catch (e) {}
      rs.audioEl.muted = st.deafened || st.screenMutes[rs.userId] === true
    }

    function anyFailed () {
      return Object.keys(st.roster).some(function (pid) {
        return peerStatus(pid) === 'failed'
      })
    }

    function peerStatus (pid) {
      var p = st.peers[pid]
      if (p) return p.status
      var r = st.roster[pid]
      return r && r.noOffer ? 'failed' : 'connecting'
    }

    function snapshot () {
      var peers = {}
      Object.keys(st.roster).forEach(function (pid) {
        var r = st.roster[pid]
        var p = st.peers[pid]
        peers[r.userId] = {
          peerId: pid,
          status: peerStatus(pid),
          speaking: !!(p && p.speaking),
          volume: volumeOf(r.userId),
          localMute: st.localMutes[r.userId] === true,
          serverMuted: st.serverMutedUsers[r.userId] === true,
          muted: r.muted,
          deafened: r.deafened,
          sharing: !!st.remote[pid],
          camera: r.camera,
          camStream: r.camera ? remoteCamStream(p) : null
        }
      })
      var s = st.settings
      var thr = st.level === null ? (s.vadAuto ? null : s.vadThreshold) : currentThreshold()
      var code = st.errorCode || (anyFailed() ? 'connect_failed' : null)
      return {
        channelId: st.channelId,
        private: st.privateCall,
        joining: st.joining,
        muted: st.muted || st.deafened || st.serverMuted,
        serverMuted: st.serverMuted,
        deafened: st.deafened,
        inputMode: s.inputMode,
        gateOpen: st.gate,
        level: round1(st.level),
        threshold: round1(thr),
        noiseFloor: round1(st.noiseFloor),
        vadAuto: s.vadAuto,
        bindings: copyBindings(),
        testing: st.testing,
        capturing: !!st.capture,
        fallback: st.mode === 'raw',
        rnnoise: rnnoiseState(),
        ptt: { enabled: s.inputMode === 'ptt', active: st.pttActive, external: st.held.external },
        selfSpeaking: st.selfSpeaking,
        inputLevel: st.inputLevel,
        errorCode: code,
        serverError: st.errorCode ? st.serverError : null,
        autoplayBlocked: st.autoplayBlocked,
        peers: peers,
        screen: screenSnapshot(),
        camera: cameraSnapshot()
      }
    }

    function cameraSnapshot () {
      var sup = cameraSupport()
      var cam = st.camera
      return {
        canUse: sup.ok,
        reason: sup.reason,
        state: cam ? 'on' : st.cameraStarting ? 'starting' : 'off',
        preview: cam ? cam.preview : null,
        errorCode: st.cameraError,
        facing: cam ? cam.facing : null,
        canSwitch: !!cam && st.cameraCanSwitch,
        switching: !!cam && !!st.cameraSwitching
      }
    }

    // Ekran paylaşımı durumu: yerel paylaşım, izleyiciler ve uzak paylaşımlar (kullanıcı kimliğine göre)
    function screenSnapshot () {
      var sup = screenSupport()
      var sh = st.share
      var viewers = []
      if (sh) {
        Object.keys(st.peers).forEach(function (pid) {
          var p = st.peers[pid]
          var r = st.roster[pid]
          if (r && !p.closed && p.viewing === sh.id && viewers.indexOf(r.userId) < 0) viewers.push(r.userId)
        })
      }
      var remote = {}
      Object.keys(st.remote).forEach(function (pid) {
        var rs = st.remote[pid]
        if (!st.roster[pid]) return
        var watching = st.watchWant[pid] === rs.id
        remote[rs.userId] = {
          peerId: pid,
          id: rs.id,
          audio: rs.audio,
          hint: rs.hint,
          preset: rs.preset,
          watching: watching,
          status: rs.watch,
          stream: watching && rs.stream && rs.stream.getVideoTracks().length ? rs.stream : null,
          volume: screenVolumeOf(rs.userId),
          muted: st.screenMutes[rs.userId] === true
        }
      })
      return {
        canShare: sup.share,
        canWatch: sup.watch,
        reason: sup.reason,
        state: st.shareState,
        starting: !!st.shareStarting,
        id: sh ? sh.id : null,
        preset: sh ? sh.preset : null,
        hint: sh ? sh.hint : null,
        audio: !!(sh && sh.audio),
        preview: sh ? sh.preview : null,
        viewers: viewers,
        viewerCount: viewers.length,
        errorCode: st.shareError,
        remote: remote
      }
    }

    // Etkin anahtar kimliği: app.js'in seal fonksiyonunun ürettiği zarftan okunur
    function probeKid () {
      try {
        return kidOf(seal({ v: 1, probe: true }))
      } catch (e) {
        return null
      }
    }

    // Ses bağlamı
    function ensureContext () {
      if (st.closeTimer) {
        clearTimeout(st.closeTimer)
        st.closeTimer = null
      }
      var AC = window.AudioContext || window.webkitAudioContext
      if (!AC) return null
      if (!ctx || ctx.state === 'closed') {
        try {
          ctx = new AC()
        } catch (e) {
          ctx = null
          return null
        }
        var c = ctx
        // Bağlam askıya alınırsa (ör. iOS kesintisi) ham mikrofon izine, sürünce yeniden hatta geçilir
        c.onstatechange = function () {
          if (ctx === c && st.local) updateMode()
        }
      }
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        try {
          var p = ctx.resume()
          if (p && typeof p.catch === 'function') p.catch(noop)
        } catch (e) {}
      }
      return ctx
    }

    function scheduleContextClose () {
      if (st.closeTimer) clearTimeout(st.closeTimer)
      st.closeTimer = null
      if (!ctx) return
      st.closeTimer = setTimeout(function () {
        st.closeTimer = null
        if (!ctx || st.inVoice || st.joining || st.local || st.testing || st.micPromise) return
        destroyPipe()
        var c = ctx
        ctx = null
        try {
          c.onstatechange = null
          var p = c.close()
          if (p && typeof p.catch === 'function') p.catch(noop)
        } catch (e) {}
      }, CONTEXT_CLOSE_DELAY_MS)
    }

    // Giriş hattı: kaynak -> analizör (algılama) ve kaynak -> [RNNoise] -> gecikme -> kapı -> hedef (eşlere giden iz)
    function ensurePipe () {
      var c = ensureContext()
      if (st.pipe && st.pipe.ctx === c && c) return st.pipe
      destroyPipe()
      if (!c) return null
      var pipe = { ctx: c, analyser: null, delay: null, gain: null, dest: null, track: null, source: null, ok: false, target: null, fbuf: null, bbuf: null, rn: null, rnJob: null }
      try {
        pipe.analyser = c.createAnalyser()
        pipe.analyser.fftSize = LOCAL_FFT
      } catch (e) {
        pipe.analyser = null
      }
      try {
        if (typeof c.createMediaStreamDestination !== 'function') throw new Error('no_destination')
        pipe.delay = c.createDelay(1)
        pipe.delay.delayTime.value = LOOKAHEAD_S
        pipe.gain = c.createGain()
        pipe.gain.gain.value = 0
        pipe.dest = c.createMediaStreamDestination()
        try {
          pipe.dest.channelCount = 1
        } catch (e) {}
        pipe.delay.connect(pipe.gain)
        pipe.gain.connect(pipe.dest)
        pipe.track = pipe.dest.stream.getAudioTracks()[0] || null
        pipe.ok = !!pipe.track
      } catch (e) {
        pipe.ok = false
      }
      if (!pipe.ok) {
        disconnectNodes([pipe.delay, pipe.gain, pipe.dest])
        pipe.delay = null
        pipe.gain = null
        pipe.dest = null
        pipe.track = null
      }
      st.pipe = pipe
      return pipe
    }

    function disconnectNodes (list) {
      list.forEach(function (n) {
        if (!n) return
        try {
          n.disconnect()
        } catch (e) {}
      })
    }

    function destroyPipe () {
      var p = st.pipe
      st.pipe = null
      if (!p) return
      cancelRnnoiseJob(p)
      dropRnnoiseNode(p.rn)
      p.rn = null
      disconnectNodes([p.source, p.analyser, p.delay, p.gain, p.dest])
      try {
        if (p.track) p.track.stop()
      } catch (e) {}
    }

    // Ses kolunun girişi: hatta giren RNNoise düğümü, yoksa ileri bakış gecikmesi
    function audioInput (pipe) {
      return pipe.rn || pipe.delay
    }

    // Cihaz değişiminde yalnızca kaynak düğümü değişir, eşlerdeki iz aynı kalır
    function connectSource (local) {
      var pipe = st.pipe
      if (!pipe || !local) return
      var src = null
      try {
        src = pipe.ctx.createMediaStreamSource(local.srcStream)
        if (pipe.analyser) src.connect(pipe.analyser)
        if (pipe.ok) src.connect(audioInput(pipe))
      } catch (e) {
        if (src) disconnectNodes([src])
        src = null
      }
      var old = pipe.source
      pipe.source = src
      if (old) disconnectNodes([old])
    }

    // Gelişmiş gürültü engelleme (RNNoise, public/rnnoise-worklet.js). Düğüm yalnızca ses koluna, kaynak ile
    // ileri bakış gecikmesi arasına girer. Algılama kolu (analizör) kaynağı doğrudan ölçmeye devam eder, bu
    // yüzden ses etkinliği eşiği, gürültü tabanı ve seviye ölçer RNNoise'dan bağımsız olarak önceki gibi
    // çalışır. Kapı, susturma, sunucu susturması ve bas konuş gecikmeden sonraki kazanç düğümünde ve iz
    // üzerinde uygulandığı için değişmez. RNNoise'un eklediği yaklaşık 20 ms gecikme (çerçeve tamponu ve
    // RNNoise'un kendi çerçevesi) yalnızca ses kolunu geciktirir, kapı sesten biraz daha erken açılır. Bas
    // konuşta bırakma süresi 0 ise tuş bırakılınca konuşmanın son yaklaşık 70 ms'si (önceden 50 ms) kesilir.
    // Düğüm, işlemci wasm'ı derleyip 'ready' bildirdikten sonra hatta girer. O zamana kadar ve herhangi bir
    // hatada (AudioWorklet veya WebAssembly yok, modül veya wasm yüklenemedi, CSP derlemeyi engelledi,
    // işlemci hata verdi) kaynak gecikmeye doğrudan bağlı kalır, ses kesilmez ve hata gösterilmez.
    //
    // Tarayıcının gürültü bastırması (getUserMedia noiseSuppression) RNNoise açıkken kapatılmaz, kişinin
    // "Gürültü bastırma" ayarı olduğu gibi uygulanır. Karar ölçüme dayanır: Chromium 141'de sahte mikrofona
    // verilen 48 kHz sentetik sinyalde (ünlü dizisi, klavye tıkırtıları, pembe gürültü) tarayıcının gürültü
    // bastırması tek başına tıkırtıları yalnızca yaklaşık 6 dB azalttı. RNNoise tıkırtıları tarayıcınınki
    // açıkken 26 ile 29 dB, kapalıyken 22 ile 33 dB azalttı (üç ölçüm). Konuşma seviyesi iki durumda da
    // yaklaşık 1 dB düştü ve spektral bozulma (log spektral uzaklık) farkı ölçümden ölçüme değişimin içinde
    // kaldı (0,3 dB'den az). İkisi birlikteyken sabit gürültü tabanı yaklaşık 5 dB daha düşük kaldı. Ayrıca
    // RNNoise yüklenemezse veya işlerken hata verirse mikrofonu yeniden başlatmaya gerek kalmadan tarayıcının
    // kendi işlemesi zaten sürer ve algılama kolu aynı sinyali ölçmeye devam eder.
    function rnnoiseUsable () {
      return st.settings.rnnoise === true && !st.rnFailed && rnnoiseSupport()
    }

    // Arayüz için durum: 'off' (ayar kapalı), 'unavailable' (desteklenmiyor veya yüklenemedi, tarayıcının kendi
    // işlemesi sürer), 'loading', 'on' (ses RNNoise'dan geçiyor) veya 'idle' (mikrofon kullanılmıyor)
    function rnnoiseState () {
      if (st.settings.rnnoise !== true) return 'off'
      if (st.rnFailed || !rnnoiseSupport()) return 'unavailable'
      var p = st.pipe
      if (!st.local || !p) return 'idle'
      // WebAudio hattı kurulamadıysa ham iz gönderilir, RNNoise uygulanamaz
      if (!p.ok) return 'unavailable'
      if (p.rn && st.mode === 'pipe') return 'on'
      return p.rnJob ? 'loading' : 'idle'
    }

    // Hattı ayara uydurur: RNNoise isteniyorsa hazırlar, istenmiyorsa hattan çıkarır. Tekrar çağrılabilir.
    function syncRnnoise () {
      var pipe = st.pipe
      if (!pipe) return
      if (!pipe.ok || !st.local || !rnnoiseUsable()) {
        cancelRnnoiseJob(pipe)
        detachRnnoise(pipe)
        return
      }
      if (pipe.rn || pipe.rnJob) return
      var c = pipe.ctx
      if (!c.audioWorklet || typeof c.audioWorklet.addModule !== 'function') {
        rnnoiseFailed()
        return
      }
      var job = { node: null, cancelled: false, timer: null }
      pipe.rnJob = job
      Promise.all([rnnoiseModule(c), rnnoiseBytes()]).then(function (res) {
        if (job.cancelled) throw makeError('cancelled')
        return rnnoiseNode(c, res[1], job)
      }).then(function (node) {
        if (pipe.rnJob === job) pipe.rnJob = null
        if (job.cancelled || st.pipe !== pipe || !rnnoiseUsable()) {
          dropRnnoiseNode(node)
          return
        }
        attachRnnoise(pipe, node)
      }, function (e) {
        if (pipe.rnJob === job) pipe.rnJob = null
        if (job.cancelled || (e && e.code === 'cancelled')) return
        rnnoiseFailed()
      })
      emit()
    }

    // AudioWorklet modülü ses bağlamı başına bir kez yüklenir (rnModule: { ctx, promise })
    function rnnoiseModule (c) {
      if (rnModule && rnModule.ctx === c) return rnModule.promise
      var entry = { ctx: c, promise: null }
      entry.promise = Promise.resolve().then(function () {
        return c.audioWorklet.addModule(RNNOISE_WORKLET_URL)
      })
      entry.promise.then(noop, function () {
        if (rnModule === entry) rnModule = null
      })
      rnModule = entry
      return entry.promise
    }

    // İşlemci düğümünü kurar, işlemci wasm'ı derleyip 'ready' bildirince düğümle çözülür. Bağlam çalışırken
    // RNNOISE_READY_MS içinde yanıt gelmezse reddedilir, bağlam askıdayken beklenir.
    function rnnoiseNode (c, bytes, job) {
      return new Promise(function (resolve, reject) {
        var node = new window.AudioWorkletNode(c, RNNOISE_PROCESSOR, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
          channelCountMode: 'explicit',
          channelInterpretation: 'speakers',
          processorOptions: { wasm: bytes }
        })
        job.node = node
        var done = false
        var finish = function (ok) {
          if (done) return
          done = true
          if (job.timer) clearTimeout(job.timer)
          job.timer = null
          node.port.onmessage = null
          node.onprocessorerror = null
          if (ok) {
            resolve(node)
            return
          }
          dropRnnoiseNode(node)
          reject(makeError('rnnoise_failed'))
        }
        var startedAt = Date.now()
        var check = function () {
          job.timer = null
          if (done || job.cancelled) return
          if (c.state !== 'running') startedAt = Date.now()
          if (Date.now() - startedAt >= RNNOISE_READY_MS) {
            finish(false)
            return
          }
          job.timer = setTimeout(check, 1000)
        }
        node.port.onmessage = function (e) {
          var d = e ? e.data : null
          if (!d || typeof d !== 'object') return
          if (d.type === 'ready') finish(true)
          else if (d.type === 'error') finish(false)
        }
        node.onprocessorerror = function () { finish(false) }
        job.timer = setTimeout(check, 1000)
      })
    }

    // Hazır düğüm hatta girer: düğüm -> gecikme bağlanır, sonra kaynak gecikmeden düğüme taşınır
    function attachRnnoise (pipe, node) {
      try {
        node.connect(pipe.delay)
      } catch (e) {
        dropRnnoiseNode(node)
        rnnoiseFailed()
        return
      }
      if (!moveSource(pipe, pipe.delay, node)) {
        dropRnnoiseNode(node)
        rnnoiseFailed()
        return
      }
      pipe.rn = node
      // Hatta girdikten sonra işlemci hata verirse kaynak yeniden doğrudan gecikmeye bağlanır
      node.port.onmessage = function (e) {
        var d = e ? e.data : null
        if (d && d.type === 'error' && pipe.rn === node) rnnoiseFailed()
      }
      node.onprocessorerror = function () {
        if (pipe.rn === node) rnnoiseFailed()
      }
      emit()
    }

    function detachRnnoise (pipe) {
      var node = pipe.rn
      if (!node) return
      pipe.rn = null
      moveSource(pipe, node, pipe.delay)
      dropRnnoiseNode(node)
      emit()
    }

    // Kaynağın ses kolu bağlantısını from düğümünden to düğümüne taşır, analizör bağlantısı korunur.
    // Önce yeni bağlantı kurulur, bu yüzden ses hiçbir an kaynaksız kalmaz. Başarısızsa false döner.
    function moveSource (pipe, from, to) {
      var src = pipe.source
      if (!src) return true
      try {
        src.connect(to)
      } catch (e) {
        return false
      }
      try {
        src.disconnect(from)
      } catch (e) {
        // Belirli bir hedefi ayırmayı desteklemeyen tarayıcıda bağlantılar baştan kurulur
        try {
          src.disconnect()
          if (pipe.analyser) src.connect(pipe.analyser)
          src.connect(to)
        } catch (e2) {
          try {
            src.connect(from)
          } catch (e3) {}
          return false
        }
      }
      return true
    }

    function cancelRnnoiseJob (pipe) {
      var job = pipe.rnJob
      if (!job) return
      pipe.rnJob = null
      job.cancelled = true
      if (job.timer) clearTimeout(job.timer)
      job.timer = null
      if (job.node) dropRnnoiseNode(job.node)
    }

    function dropRnnoiseNode (node) {
      if (!node) return
      try {
        node.onprocessorerror = null
        node.port.onmessage = null
        node.port.postMessage('destroy')
      } catch (e) {}
      disconnectNodes([node])
    }

    // RNNoise bu sayfa oturumunda bırakılır, ses tarayıcının kendi işlemesiyle sürer
    function rnnoiseFailed () {
      st.rnFailed = true
      var pipe = st.pipe
      if (pipe) {
        cancelRnnoiseJob(pipe)
        detachRnnoise(pipe)
      }
      emit()
    }

    function desiredMode () {
      if (!st.local) return null
      var p = st.pipe
      return p && p.ok && p.source && p.ctx.state === 'running' ? 'pipe' : 'raw'
    }

    function updateMode () {
      syncRnnoise()
      var m = desiredMode()
      if (m === st.mode) return
      st.mode = m
      if (m) replaceSenders()
      updateGate(true)
      emit()
    }

    function sendTrack () {
      if (st.mode === 'pipe' && st.pipe && st.pipe.track) return st.pipe.track
      return st.local ? st.local.track : null
    }

    function sendStream () {
      if (st.mode === 'pipe' && st.pipe && st.pipe.dest) return st.pipe.dest.stream
      return st.local ? st.local.stream : null
    }

    // Yalnızca yedek modda veya mod değişiminde gerekir
    function replaceSenders () {
      var t = sendTrack()
      var jobs = []
      Object.keys(st.peers).forEach(function (pid) {
        var s = st.peers[pid].sender
        if (!t || !s || typeof s.replaceTrack !== 'function' || s.track === t) return
        try {
          jobs.push(Promise.resolve(s.replaceTrack(t)).then(noop, noop))
        } catch (e) {}
      })
      return Promise.all(jobs)
    }

    // Algılama, analizör çalışıyorsa ve kapı ölçülen sesi kesmiyorsa güvenilirdir
    function analysisOk () {
      var p = st.pipe
      if (!st.local || !p || !p.analyser || !p.source || p.ctx.state !== 'running') return false
      return st.mode === 'pipe' || !!st.local.clone
    }

    function currentThreshold () {
      var s = st.settings
      if (!s.vadAuto) return s.vadThreshold
      if (st.noiseFloor === null) return null
      return clamp(st.noiseFloor + FLOOR_MARGIN_DB, AUTO_MIN_DB, AUTO_MAX_DB)
    }

    function computeGate () {
      if (!st.local || st.muted || st.serverMuted || st.deafened) return false
      if (st.settings.inputMode === 'ptt') return st.pttActive || st.pttTail
      // Seviye ölçülemiyorsa ses etkinliği modu mikrofonu açık tutar
      if (!analysisOk()) return true
      return st.vadOpen
    }

    function setGain (pipe, target) {
      if (!pipe.gain || pipe.target === target) return
      pipe.target = target
      var p = pipe.gain.gain
      try {
        var now = pipe.ctx.currentTime
        p.cancelScheduledValues(now)
        p.setValueAtTime(p.value, now)
        p.setTargetAtTime(target, now, target > 0 ? GATE_OPEN_TC : GATE_CLOSE_TC)
      } catch (e) {
        try {
          p.value = target
        } catch (e2) {}
      }
    }

    function applyGate () {
      var local = st.local
      if (!local) return
      var live = !st.muted && !st.serverMuted && !st.deafened
      var pipe = st.pipe
      if (pipe && pipe.ok) {
        setGain(pipe, st.mode === 'pipe' && st.gate ? 1 : 0)
        // Mikrofon kapalıyken eşlere giden iz de tamamen kapatılır
        if (pipe.track) pipe.track.enabled = live
      }
      local.track.enabled = st.mode === 'raw' ? st.gate : true
    }

    function updateGate (force) {
      var g = computeGate()
      var changed = g !== st.gate
      st.gate = g
      if (changed || force) applyGate()
      // Yerel konuşma göstergesi kapının açık olmasıdır (ölçüm yapılamayan yedek modda mikrofon sürekli açıktır)
      if (g !== st.selfSpeaking) {
        st.selfSpeaking = g
        changed = true
      }
      if (changed) emit()
    }

    function resetMeasure () {
      st.level = null
      st.smooth = null
      st.noiseFloor = null
      st.floorTimes = []
      st.floorValues = []
      st.vadOpen = false
      st.lastAbove = 0
      st.inputLevel = 0
      st.emittedLevel = null
      st.emittedThreshold = null
    }

    // Seviye dBFS (20*log10(rms)), gürültü tabanı son 3 sn içindeki yumuşatılmış seviyelerin en düşüğü
    function measureLocal (now) {
      if (!analysisOk()) {
        if (st.level !== null) {
          resetMeasure()
          emit()
        }
        updateGate(false)
        return
      }
      var rms = readRms(st.pipe.analyser, st.pipe)
      var db = rms > 0 ? 20 * Math.log10(rms) : MIN_DB
      if (!(db >= MIN_DB)) db = MIN_DB
      if (db > 0) db = 0
      st.level = db
      st.smooth = st.smooth === null ? db : st.smooth + SMOOTHING * (db - st.smooth)
      st.floorTimes.push(now)
      st.floorValues.push(st.smooth)
      while (st.floorTimes.length && now - st.floorTimes[0] > FLOOR_WINDOW_MS) {
        st.floorTimes.shift()
        st.floorValues.shift()
      }
      st.noiseFloor = Math.min.apply(null, st.floorValues)
      var thr = currentThreshold()
      if (db > thr) {
        st.vadOpen = true
        st.lastAbove = now
      } else if (st.vadOpen && now - st.lastAbove >= VAD_HOLD_MS) {
        st.vadOpen = false
      }
      st.inputLevel = Math.round(Math.min(1, rms * 4) * 20) / 20
      updateGate(false)
      // Seviye bildirimleri en fazla 100 ms'de bir, 1 dB değişimde
      var rl = Math.round(db)
      var rt = Math.round(thr)
      if ((rl !== st.emittedLevel || rt !== st.emittedThreshold) && now - st.levelEmitAt >= LEVEL_EMIT_MS) {
        st.emittedLevel = rl
        st.emittedThreshold = rt
        st.levelEmitAt = now
        emit()
      }
    }

    function tick () {
      var now = Date.now()
      st.tickCount++
      if (st.local) measureLocal(now)
      if (st.tickCount % REMOTE_EVERY !== 0) return
      var changed = false
      Object.keys(st.peers).forEach(function (pid) {
        var p = st.peers[pid]
        if (readRms(p.analyser, p) > REMOTE_THRESHOLD) p.lastLoud = now
        var s = !!p.analyser && now - p.lastLoud < REMOTE_HOLD_MS
        if (s !== p.speaking) {
          p.speaking = s
          changed = true
        }
      })
      Object.keys(st.roster).forEach(function (pid) {
        var r = st.roster[pid]
        if (!st.peers[pid] && !r.noOffer && now - r.since > NO_OFFER_TIMEOUT_MS) {
          r.noOffer = true
          changed = true
        }
      })
      if (changed) emit()
    }

    function startTick () {
      if (!st.tickTimer) st.tickTimer = setInterval(tick, TICK_MS)
    }

    function stopTick () {
      if (st.tickTimer) clearInterval(st.tickTimer)
      st.tickTimer = null
    }

    // Uzak akış analizörleri (hedefe bağlanmaz)
    function attachAnalyser (node, stream) {
      detachAnalyser(node)
      if (!ctx || !stream || ctx.state === 'closed') return
      try {
        var source = ctx.createMediaStreamSource(stream)
        var analyser = ctx.createAnalyser()
        analyser.fftSize = REMOTE_FFT
        source.connect(analyser)
        node.source = source
        node.analyser = analyser
      } catch (e) {
        node.source = null
        node.analyser = null
      }
    }

    function detachAnalyser (node) {
      if (!node) return
      disconnectNodes([node.source, node.analyser])
      node.source = null
      node.analyser = null
      node.lastLoud = 0
    }

    // Katılma ve ayrılma sesleri ile bas konuşun kısa açılış ve kapanış ipucu (masaüstü genel kısayolu)
    // Katılma, ayrılma ve düşme sayfanın bildirim sesleriyle (window.TelsizSesler) ve sayfanın kendi ses bağlamında
    // çalar: 2 saniye sürer ve ses odasından çıkınca kapanan bu bağlamda yarıda kesilmez. Bas konuş ipuçları kısa
    // tonlardır ve bu bağlamda çalar. Ses odası sesleri ayarı kapalıysa hiçbiri çalmaz, sağırlaştırılmışken
    // başkalarının hareketleri sessizdir.
    function playTone (kind, other) {
      if (!st.settings.sounds) return
      if (other && st.deafened) return
      if (NOTIFY_TONES[kind]) {
        var sounds = typeof window !== 'undefined' ? window.TelsizSesler : null
        if (sounds && typeof sounds.play === 'function') {
          try {
            sounds.play(kind)
          } catch (e) {}
          return
        }
        if (kind === 'drop') kind = 'leave'
      }
      if (!ctx || ctx.state !== 'running') return
      var tone = TONES[kind]
      if (!tone) return
      var peak = other ? 0.08 : tone.peak
      var t0 = ctx.currentTime + 0.02
      var c = ctx
      tone.freqs.forEach(function (f, i) {
        var start = t0 + i * tone.step
        try {
          var osc = c.createOscillator()
          var gain = c.createGain()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(f, start)
          gain.gain.setValueAtTime(0, start)
          gain.gain.linearRampToValueAtTime(peak, start + 0.02)
          gain.gain.linearRampToValueAtTime(0, start + tone.step - 0.01)
          osc.connect(gain)
          gain.connect(c.destination)
          osc.onended = function () {
            disconnectNodes([osc, gain])
          }
          osc.start(start)
          osc.stop(start + tone.step)
        } catch (e) {}
      })
    }

    // Uzak ses öğeleri yalnızca bu gizli kabın içinde durur
    function ensureContainer () {
      if (st.container && st.container.parentNode) return st.container
      var div = document.createElement('div')
      div.hidden = true
      div.setAttribute('aria-hidden', 'true')
      div.setAttribute('data-voice-audio', '')
      var parent = document.body || document.documentElement
      parent.appendChild(div)
      st.container = div
      return div
    }

    function removeContainer () {
      var div = st.container
      st.container = null
      if (div && div.parentNode) div.parentNode.removeChild(div)
    }

    function playAudio (audio) {
      var p = null
      try {
        p = audio.play()
      } catch (e) {
        p = null
      }
      if (!p || typeof p.then !== 'function') return
      p.then(noop, function (err) {
        if (err && err.name === 'NotAllowedError' && st.inVoice && audio.parentNode) {
          st.autoplayBlocked = true
          emit()
        }
      })
    }

    function removeAudio (peer) {
      var a = peer.audio
      dropBoost(peer)
      peer.audio = null
      peer.stream = null
      if (!a) return
      try {
        a.pause()
      } catch (e) {}
      try {
        a.srcObject = null
      } catch (e) {}
      if (a.parentNode) a.parentNode.removeChild(a)
    }

    // Yerel mikrofon
    function micParams () {
      var s = st.settings
      return { deviceId: s.inputDeviceId, ec: s.echoCancellation, ns: s.noiseSuppression, agc: s.autoGainControl }
    }

    function paramsKey (p) {
      return [p.deviceId || '', p.ec, p.ns, p.agc].join('|')
    }

    async function getMic (p, allowFallback) {
      var md = navigator.mediaDevices
      var audio = { echoCancellation: p.ec, noiseSuppression: p.ns, autoGainControl: p.agc }
      if (p.deviceId) audio.deviceId = { exact: p.deviceId }
      try {
        return await md.getUserMedia({ audio: audio, video: false })
      } catch (e) {
        var n = e && e.name
        if (!p.deviceId || !allowFallback || (n !== 'OverconstrainedError' && n !== 'NotFoundError')) throw e
        delete audio.deviceId
        return md.getUserMedia({ audio: audio, video: false })
      }
    }

    function makeLocal (stream, params) {
      var tracks = stream.getAudioTracks()
      if (!tracks.length) throw makeError('mic_not_found')
      var track = tracks[0]
      var clone = null
      try {
        clone = track.clone()
      } catch (e) {
        clone = null
      }
      // Algılama klon iz üzerinden yapılır, yedek modda kapı ham izi kapatsa da seviye ölçülür
      return {
        stream: stream,
        track: track,
        clone: clone,
        srcStream: new MediaStream([clone || track]),
        params: params,
        ended: false
      }
    }

    function stopLocal (local) {
      if (!local) return
      try {
        local.track.onended = null
        local.track.stop()
      } catch (e) {}
      try {
        if (local.clone) local.clone.stop()
      } catch (e) {}
      stopStream(local.stream)
    }

    // Cihaz çıkarılırsa varsayılan cihaza geçilir
    function watchTrack (local) {
      local.track.onended = function () {
        if (st.local !== local) return
        local.ended = true
        queueReacquire(true).catch(function (e) {
          if (st.local !== local || !wantMic()) return
          st.errorCode = micErrorCode(e)
          emit()
        })
      }
    }

    function wantMic () {
      return st.joining || st.inVoice || st.testing
    }

    // Mikrofonu açar (ses oturumu ve test aynı izi paylaşır)
    function acquireMic () {
      if (st.local) return Promise.resolve(st.local)
      if (st.micPromise) return st.micPromise
      var gen = st.micGen
      var params = micParams()
      var p = getMic(params, true).then(function (stream) {
        if (gen !== st.micGen || !wantMic()) {
          stopStream(stream)
          throw makeError('cancelled')
        }
        var local = null
        try {
          local = makeLocal(stream, params)
        } catch (e) {
          stopStream(stream)
          throw e
        }
        st.local = local
        startMicUse(local)
        return local
      }, function (e) {
        throw makeError(micErrorCode(e))
      })
      st.micPromise = p
      var clear = function () {
        if (st.micPromise === p) st.micPromise = null
      }
      p.then(clear, clear)
      return p
    }

    function startMicUse (local) {
      ensurePipe()
      connectSource(local)
      watchTrack(local)
      st.mode = null
      resetMeasure()
      updateMode()
      startTick()
      addListeners()
      // Mikrofon açılırken ayarlar değiştiyse yeniden alınır
      if (paramsKey(local.params) !== paramsKey(micParams())) queueReacquire(true).catch(noop)
    }

    function releaseMicIfUnused () {
      if (wantMic()) return
      st.micGen++
      st.micPromise = null
      if (st.local) {
        stopLocal(st.local)
        st.local = null
      }
      destroyPipe()
      st.mode = null
      stopTick()
      removeListeners()
      clearPttTimer()
      st.held = noneHeld()
      st.pttActive = false
      st.pttTail = false
      st.gate = false
      st.selfSpeaking = false
      resetMeasure()
      scheduleContextClose()
    }

    function queueReacquire (allowFallback) {
      var job = st.micJob.then(function () { return reacquire(allowFallback) })
      st.micJob = job.then(noop, noop)
      return job
    }

    // Ayar veya cihaz değişince mikrofon yeniden alınır, bağlantılar kopmaz
    async function reacquire (allowFallback) {
      var local = st.local
      if (!local) return
      var params = micParams()
      if (!local.ended && paramsKey(params) === paramsKey(local.params)) return
      var gen = st.micGen
      var stream = null
      try {
        stream = await getMic(params, allowFallback)
      } catch (e) {
        throw makeError(micErrorCode(e))
      }
      if (gen !== st.micGen || st.local !== local) {
        stopStream(stream)
        return
      }
      var next = null
      try {
        next = makeLocal(stream, params)
      } catch (e) {
        stopStream(stream)
        throw e
      }
      st.local = next
      connectSource(next)
      watchTrack(next)
      if (st.mode === 'raw') await replaceSenders()
      stopLocal(local)
      if (st.local !== next) return
      updateMode()
      updateGate(true)
      emit()
    }

    // Bas konuş: kaynaklar (klavye, fare, oyun kolu, dokunmatik düğme, masaüstü uygulamasının genel
    // kısayolu veya tuş kancası) ayrı izlenir. Biri bırakılınca diğeri basılıysa konuşma sürer.
    function noneHeld () {
      return { key: false, mouse: false, pad: false, touch: false, external: false }
    }

    function anyHeld () {
      var h = st.held
      return h.key || h.mouse || h.pad || h.touch || h.external
    }

    function clearPttTimer () {
      if (st.pttTimer) clearTimeout(st.pttTimer)
      st.pttTimer = null
    }

    function setPttActive (v) {
      if (v === st.pttActive) return
      st.pttActive = v
      clearPttTimer()
      st.pttTail = false
      if (!v && st.gate && st.settings.pttReleaseMs > 0) {
        st.pttTail = true
        st.pttTimer = setTimeout(function () {
          st.pttTimer = null
          st.pttTail = false
          updateGate(false)
        }, st.settings.pttReleaseMs)
      }
      updateGate(false)
      emit()
    }

    function pttPress (src) {
      if (st.settings.inputMode !== 'ptt' || st.capture || st.held[src]) return
      st.held[src] = true
      setPttActive(true)
    }

    function pttRelease (src) {
      if (!st.held[src]) return
      st.held[src] = false
      if (!anyHeld()) setPttActive(false)
    }

    // Odak kaybında basılı her şey bırakılmış sayılır (gecikme uygulanmaz). keepExternal: pencere dışındaki
    // kaynak (masaüstü kısayolu veya tuş kancası) odak ve görünürlükten bağımsızdır, açık kalır.
    function releaseAll (keepExternal) {
      var external = keepExternal === true && st.held.external
      st.held = noneHeld()
      st.held.external = external
      st.pttActive = external
      clearPttTimer()
      st.pttTail = false
      updateGate(false)
      emit()
    }

    function toggleAction (a) {
      if (a === 'toggleMute') setMuted(!(st.muted || st.deafened))
      else if (a === 'toggleDeafen') setDeafened(!st.deafened)
    }

    // Etkin atama: bas konuş yalnızca kendi modunda, aynı düğme bas konuşa atanmışsa aç/kapa eylemi gölgede kalır
    function effective (a) {
      var b = st.settings.bindings[a]
      if (!b) return null
      var ptt = st.settings.inputMode === 'ptt'
      if (a === 'ptt') return ptt ? b : null
      return ptt && sameBinding(b, st.settings.bindings.ptt) ? null : b
    }

    function actionsFor (type, value) {
      return ACTIONS.filter(function (a) {
        var b = effective(a)
        return !!b && b.type === type && (type === 'key' ? b.code === value : b.button === value)
      })
    }

    function runActions (list, src) {
      list.forEach(function (a) {
        if (a === 'ptt') pttPress(src)
        else toggleAction(a)
      })
    }

    // Klavye (yalnızca seste veya mikrofon testinde)
    function onKeyDown (e) {
      if (!e || st.capture || e.repeat || isEditable(e.target)) return
      runActions(actionsFor('key', e.code), 'key')
    }

    function onKeyUp (e) {
      if (!e) return
      if (actionsFor('key', e.code).indexOf('ptt') >= 0) pttRelease('key')
    }

    // Fare: atanmış yan tuşlarda tarayıcının geri/ileri gezinmesi her zaman engellenir
    function boundMouse (button) {
      return ACTIONS.some(function (a) {
        var b = st.settings.bindings[a]
        return !!b && b.type === 'mouse' && b.button === button
      })
    }

    function guardMouse (e) {
      if (boundMouse(e.button) && (e.button !== 1 || listening)) e.preventDefault()
    }

    function onMouseDown (e) {
      if (!e) return
      if (st.swallowMouse !== null && st.swallowMouse !== e.button) {
        st.swallowMouse = null
        updateMouseGuard()
      }
      guardMouse(e)
      if (!listening || st.capture) return
      runActions(actionsFor('mouse', e.button), 'mouse')
    }

    function onMouseUp (e) {
      if (!e) return
      if (st.swallowMouse === e.button) {
        stopEvent(e)
        return
      }
      guardMouse(e)
      if (actionsFor('mouse', e.button).indexOf('ptt') >= 0) pttRelease('mouse')
    }

    function onAuxClick (e) {
      if (!e) return
      if (st.swallowMouse === e.button) {
        stopEvent(e)
        st.swallowMouse = null
        updateMouseGuard()
        return
      }
      guardMouse(e)
    }

    // Pencere dışında bırakılan tuş: hareket olayındaki düğme maskesinden anlaşılır
    function onMouseMove (e) {
      if (!st.held.mouse || !e || typeof e.buttons !== 'number') return
      var b = effective('ptt')
      if (!b || b.type !== 'mouse') return
      if (!(e.buttons & MOUSE_BITS[b.button])) pttRelease('mouse')
    }

    function updateMouseGuard () {
      if (typeof window === 'undefined') return
      var need = st.swallowMouse !== null || ACTIONS.some(function (a) {
        var b = st.settings.bindings[a]
        return !!b && b.type === 'mouse'
      })
      if (need === mouseGuard) return
      mouseGuard = need
      var fn = need ? 'addEventListener' : 'removeEventListener'
      window[fn]('mousedown', onMouseDown)
      window[fn]('mouseup', onMouseUp)
      window[fn]('auxclick', onAuxClick)
    }

    // Oyun kolu yoklaması: seste iken ve oyun kolu ataması varsa, sayfa görünürken
    function needPadPoll () {
      if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return false
      if (typeof window.requestAnimationFrame !== 'function') return false
      if (document.visibilityState === 'hidden') return false
      if (st.capture) return true
      return listening && ACTIONS.some(function (a) {
        var b = effective(a)
        return !!b && b.type === 'gamepad'
      })
    }

    function updatePadPoll () {
      var need = needPadPoll()
      if (need && !st.rafId) {
        st.padInit = true
        st.rafId = window.requestAnimationFrame(padFrame)
      } else if (!need && st.rafId) {
        window.cancelAnimationFrame(st.rafId)
        st.rafId = 0
      }
    }

    function padFrame () {
      st.rafId = 0
      if (!needPadPoll()) return
      var pads = readPads()
      if (st.capture) capturePads(pads)
      else pollActions(pads)
      if (!st.rafId && needPadPoll()) st.rafId = window.requestAnimationFrame(padFrame)
    }

    function pollActions (pads) {
      var init = st.padInit
      st.padInit = false
      ACTIONS.forEach(function (a) {
        var b = effective(a)
        var on = !!b && b.type === 'gamepad' && pads.some(function (f) { return f[b.button] === true })
        var prev = st.padPrev[a] === true
        st.padPrev[a] = on
        if (init || on === prev) return
        if (a === 'ptt') {
          if (on) pttPress('pad')
          else pttRelease('pad')
        } else if (on) {
          toggleAction(a)
        }
      })
    }

    // Yakalama başladığında basılı olan düğmeler, bırakılıp yeniden basılınca sayılır
    function capturePads (pads) {
      var base = st.capture.base
      var found = -1
      pads.forEach(function (flags, i) {
        if (!base[i]) base[i] = []
        flags.forEach(function (on, j) {
          if (on && !base[i][j]) {
            if (found < 0) found = j
          } else if (!on) {
            base[i][j] = false
          }
        })
      })
      if (found >= 0) finishCapture({ type: 'gamepad', button: found })
    }

    // Atama yakalama: sonraki klavye tuşu, fare orta/yan tuşu veya oyun kolu düğmesi. Esc veya 10 sn sonra null
    function captureBinding () {
      finishCapture(null)
      releaseAll()
      return new Promise(function (resolve) {
        var cap = { resolve: resolve, timer: null, base: readPads() }
        st.capture = cap
        cap.timer = setTimeout(function () {
          if (st.capture === cap) finishCapture(null)
        }, CAPTURE_TIMEOUT_MS)
        setCapListeners(true)
        updatePadPoll()
        emit()
      })
    }

    function cancelCapture () {
      finishCapture(null)
    }

    function finishCapture (result) {
      var cap = st.capture
      if (!cap) return
      st.capture = null
      clearTimeout(cap.timer)
      setCapListeners(false)
      updateMouseGuard()
      st.padInit = true
      updatePadPoll()
      emit()
      cap.resolve(result)
    }

    function setCapListeners (on) {
      if (on !== capListening) {
        capListening = on
        var fn = on ? 'addEventListener' : 'removeEventListener'
        window[fn]('keydown', onCapKeyDown, true)
        window[fn]('mousedown', onCapMouseDown, true)
      }
      updateKeySwallow()
    }

    // Yakalanan tuşun bırakılması da yutulur (ör. odaktaki düğmeyi Boşluk ile yeniden tetiklemesin)
    function updateKeySwallow () {
      var need = capListening || st.swallowKey !== null
      if (need === keySwallowing) return
      keySwallowing = need
      window[need ? 'addEventListener' : 'removeEventListener']('keyup', onCapKeyUp, true)
    }

    function onCapKeyDown (e) {
      if (!st.capture || !e) return
      var esc = e.code === 'Escape' || e.key === 'Escape' || e.key === 'Esc'
      if (!esc && isEditable(e.target)) return
      stopEvent(e)
      if (e.repeat) return
      var b = esc ? null : normBinding({ type: 'key', code: e.code })
      if (!esc && !b) return
      st.swallowKey = e.code || null
      finishCapture(b)
    }

    function onCapKeyUp (e) {
      if (!e) return
      if (st.swallowKey !== null && e.code === st.swallowKey) {
        stopEvent(e)
        st.swallowKey = null
        updateKeySwallow()
      } else if (st.capture && !isEditable(e.target)) {
        stopEvent(e)
      }
    }

    function onCapMouseDown (e) {
      if (!st.capture || !e) return
      var b = e.button
      if (b !== 1 && b !== 3 && b !== 4) return
      stopEvent(e)
      st.swallowMouse = b
      finishCapture({ type: 'mouse', button: b })
    }

    // Klavye, odak ve görünürlük dinleyicileri (mikrofon açıkken)
    function onBlur () {
      releaseAll(true)
    }

    function onVisibility () {
      if (document.visibilityState === 'visible') {
        requestWakeLock()
      } else {
        releaseAll(true)
      }
      updatePadPoll()
    }

    function addListeners () {
      if (listening) return
      listening = true
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('blur', onBlur)
      document.addEventListener('visibilitychange', onVisibility)
      updatePadPoll()
    }

    function removeListeners () {
      if (!listening) return
      listening = false
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      updatePadPoll()
    }

    function requestWakeLock () {
      if (!st.inVoice || st.wakeLock || st.wakeLockPending) return
      var wl = navigator.wakeLock
      if (!wl || typeof wl.request !== 'function') return
      if (document.visibilityState && document.visibilityState !== 'visible') return
      st.wakeLockPending = true
      var p
      try {
        p = Promise.resolve(wl.request('screen'))
      } catch (e) {
        p = Promise.reject(e)
      }
      p.then(function (lock) {
        st.wakeLockPending = false
        if (!lock) return
        if (!st.inVoice && !st.joining) {
          releaseLock(lock)
          return
        }
        st.wakeLock = lock
        if (typeof lock.addEventListener === 'function') {
          lock.addEventListener('release', function () {
            if (st.wakeLock === lock) st.wakeLock = null
          })
        }
      }, function () {
        st.wakeLockPending = false
      })
    }

    function releaseLock (lock) {
      try {
        var p = lock.release()
        if (p && typeof p.catch === 'function') p.catch(noop)
      } catch (e) {}
    }

    function releaseWakeLock () {
      var lock = st.wakeLock
      st.wakeLock = null
      if (lock) releaseLock(lock)
    }

    // Eş bağlantıları
    function clearPeerTimer (peer) {
      if (peer.timer) clearTimeout(peer.timer)
      peer.timer = null
    }

    function armTimer (peer) {
      clearPeerTimer(peer)
      peer.timer = setTimeout(function () {
        peer.timer = null
        if (!peer.closed && peer.status !== 'connected') handleFailure(peer)
      }, CONNECT_TIMEOUT_MS)
    }

    // Bağlantı kapanınca bu bağlantıya bağlı ekran paylaşımı durumu da biter: karşı tarafın paylaşımı
    // (izleyici tarafı) silinir, karşı taraf bizim paylaşımımızın izleyicisiyse izleyicilerden çıkar.
    // Yeni bir bağlantı kurulursa paylaşan taraf durumunu yeniden duyurur, izlemek yeniden istenir.
    function closePeer (peer, reason) {
      if (!peer || peer.closed) return
      peer.closed = true
      clearPeerTimer(peer)
      clearNegoTimer(peer)
      var pc = peer.pc
      pc.onicecandidate = null
      pc.ontrack = null
      pc.onconnectionstatechange = null
      pc.oniceconnectionstatechange = null
      try {
        pc.close()
      } catch (e) {}
      detachAnalyser(peer)
      removeAudio(peer)
      peer.candidates = []
      peer.outbox = []
      peer.speaking = false
      peer.scrT = { video: null, audio: null }
      peer.rx = { video: null, audio: null }
      peer.camT = null
      peer.camSent = null
      peer.camMid = null
      peer.camOn = false
      if (peer.camStream) setStreamTracks(peer.camStream, [])
      peer.camStream = null
      if (peer.viewing) {
        peer.viewing = null
        var r = st.roster[peer.peerId]
        if (r) screenEvent({ type: 'viewer-leave', userId: r.userId, peerId: peer.peerId })
      }
      if (st.peers[peer.peerId] === peer) {
        delete st.peers[peer.peerId]
        dropRemote(peer.peerId, reason || 'left')
      }
    }

    function createPeer (pid, initiator, sid) {
      if (!st.inVoice || !st.local || !st.roster[pid]) return null
      var track = sendTrack()
      var stream = sendStream()
      if (!track || !stream) return null
      var pc = null
      try {
        pc = new window.RTCPeerConnection({ iceServers: st.iceServers })
      } catch (e) {
        try {
          pc = new window.RTCPeerConnection({ iceServers: [] })
        } catch (e2) {
          return null
        }
      }
      var peer = {
        peerId: pid,
        sid: sid,
        initiator: initiator,
        pc: pc,
        sender: null,
        audio: null,
        stream: null,
        // Ses %100'ün üstündeyken yükseltme düğümleri (ensureBoost): { ctx, stream, source, gain, limiter }
        boost: null,
        source: null,
        analyser: null,
        fbuf: null,
        bbuf: null,
        lastLoud: 0,
        speaking: false,
        status: 'connecting',
        // Bağlantının son kurulduğu an (yeni başlayan paylaşımı süregelenden ayırmak için, SHARE_FRESH_MS)
        connectedAt: 0,
        lastState: 'new',
        restarted: false,
        waited: false,
        timer: null,
        candidates: [],
        outbox: [],
        localReady: false,
        outN: 0,
        closed: false,
        // Yeniden anlaşma (kibar/kaba eş): yanıtlayan kibardır, çakışmada kendi teklifini geri alır.
        // ready: ilk teklif ve yanıt tamamlandı. micT: mikrofon aktarıcısı (ekran izlerinden ayırmak için).
        // pending: yanıt bekleyen teklif { o, sdp, restart, resends }, o bağlantı başına artan teklif numarasıdır
        // ve yanıtta geri gelir (başka bir teklifin yanıtı bekleyen teklife uygulanmaz).
        polite: !initiator,
        ready: false,
        micT: null,
        micTrack: null,
        wantNego: false,
        restartWanted: false,
        offerNo: 0,
        pending: null,
        negoTimer: null,
        dirNego: 0,
        senderRefresh: false,
        // Ekran paylaşımı: viewing = bu eşin izlediği yerel paylaşım kimliği, scrT = ekran gönderim
        // aktarıcıları, rx = karşı tarafın ekran izleri, rejected = karşı tarafın bu bağlantıda reddettiği
        // ekran m satırı türleri (yeniden eklenmez)
        viewing: null,
        scrT: { video: null, audio: null },
        rx: { video: null, audio: null },
        rejected: { video: false, audio: false },
        // Kamera: camT = kamera gönderim aktarıcısı, camSent = karşı tarafa bildirilen kamera mid'i, camMid ve
        // camOn = karşı tarafın bildirdiği kamera mid'i ve açık mı, camStream = karşı tarafın kamera akışı,
        // camRejected = karşı taraf kamera m satırını reddetti (bu bağlantıda yeniden eklenmez)
        camT: null,
        camSent: null,
        camMid: null,
        camOn: false,
        camStream: null,
        camRejected: false
      }
      st.peers[pid] = peer
      st.roster[pid].noOffer = false
      try {
        peer.sender = pc.addTrack(track, stream)
      } catch (e) {
        closePeer(peer)
        return null
      }
      peer.micT = transceiverOf(pc, peer.sender)
      pc.onicecandidate = function (e) {
        if (peer.closed || !e || !e.candidate || !e.candidate.candidate) return
        var c = parseCandidate(e.candidate)
        if (!c) return
        if (!peer.localReady) {
          if (peer.outbox.length < MAX_CANDIDATES) peer.outbox.push(c)
          return
        }
        sendSignal(peer, { type: 'candidate', candidate: c })
      }
      pc.ontrack = function (e) { onRemoteTrack(peer, e) }
      pc.onconnectionstatechange = function () { onConnState(peer) }
      pc.oniceconnectionstatechange = function () { onConnState(peer) }
      armTimer(peer)
      emit()
      return peer
    }

    function flushOutbox (peer) {
      peer.localReady = true
      var list = peer.outbox
      peer.outbox = []
      list.forEach(function (c) {
        sendSignal(peer, { type: 'candidate', candidate: c })
      })
    }

    // Uzak izin rolü: mikrofon aktarıcısından gelen ses mikrofondur, diğer aktarıcılardan gelenler ekran
    // görüntüsü ve ekran sesidir. Aktarıcı bilgisi olmayan eski tarayıcılarda ilk uzak ses izi mikrofon sayılır.
    function trackRole (peer, e) {
      var kind = e.track.kind
      var t = e.transceiver || null
      if (t && peer.micT) {
        if (t === peer.micT) return kind === 'audio' ? 'mic' : null
        return kind === 'video' ? 'video' : (kind === 'audio' ? 'audio' : null)
      }
      if (kind === 'video') return 'video'
      if (kind !== 'audio') return null
      return !peer.micTrack || peer.micTrack === e.track ? 'mic' : 'audio'
    }

    function onRemoteTrack (peer, e) {
      if (peer.closed || !e || !e.track) return
      var role = trackRole(peer, e)
      if (role === 'video' && isCamTransceiver(peer, e.transceiver)) {
        emit()
        return
      }
      if (role === 'video' || role === 'audio') {
        onScreenTrack(peer, role, e.track)
        return
      }
      if (role !== 'mic') return
      peer.micTrack = e.track
      var stream = e.streams && e.streams[0] ? e.streams[0] : new MediaStream([e.track])
      peer.stream = stream
      var audio = peer.audio
      if (!audio) {
        audio = document.createElement('audio')
        audio.autoplay = true
        audio.setAttribute('playsinline', '')
        audio.playsInline = true
        ensureContainer().appendChild(audio)
        peer.audio = audio
      }
      audio.srcObject = stream
      applyPeerAudio(peer)
      playAudio(audio)
      attachAnalyser(peer, stream)
      emit()
    }

    function onConnState (peer) {
      if (peer.closed) return
      var pc = peer.pc
      var s = typeof pc.connectionState === 'string' ? pc.connectionState : iceToConn(pc.iceConnectionState)
      if (s === peer.lastState) return
      peer.lastState = s
      if (s === 'closed') return
      if (s === 'failed') {
        handleFailure(peer)
        return
      }
      if (s === 'connected') {
        clearPeerTimer(peer)
        peer.status = 'connected'
        peer.connectedAt = Date.now()
        peer.restarted = false
        peer.waited = false
      } else {
        peer.status = 'connecting'
        if (!peer.timer) armTimer(peer)
      }
      emit()
    }

    // Başlatıcı bir kez ICE yeniden başlatır, karşı taraf yeni teklif için bir süre daha bekler
    function handleFailure (peer) {
      if (peer.closed) return
      clearPeerTimer(peer)
      if (peer.initiator && !peer.restarted) {
        peer.restarted = true
        peer.status = 'connecting'
        armTimer(peer)
        runOp(peer.peerId, function () { return sendOffer(peer, true) })
      } else if (!peer.initiator && !peer.waited) {
        peer.waited = true
        peer.status = 'connecting'
        armTimer(peer)
      } else {
        peer.status = 'failed'
      }
      emit()
    }

    // Eş başına işlemler sıralı yürür (yerel teklif ve gelen sinyaller)
    function runOp (pid, fn) {
      var gen = st.gen
      var prev = st.ops[pid] || Promise.resolve()
      var next = prev.then(function () {
        if (gen !== st.gen) return
        return fn()
      }).catch(noop)
      st.ops[pid] = next
      return next
    }

    // Teklif: ilk bağlantı, ICE yeniden başlatma veya yeniden anlaşma (ekran izi ekleme). İlk anlaşmadan sonra
    // yalnızca kararlı durumda teklif edilir, bekleyen bir teklif varsa istek yanıt gelince yeniden değerlendirilir.
    // Eş başına işlemler runOp ile sıralı yürüdüğü için teklif hazırlanırken gelen sinyal araya giremez.
    async function sendOffer (peer, restart) {
      if (peer.closed) return
      var pc = peer.pc
      if (peer.ready && pc.signalingState !== 'stable') {
        if (restart) peer.restartWanted = true
        else peer.wantNego = true
        return
      }
      var doRestart = !!restart || peer.restartWanted
      peer.wantNego = false
      peer.restartWanted = false
      filterScreenCodecs(peer)
      var offer = await pc.createOffer(doRestart ? { iceRestart: true } : {})
      if (peer.closed) return
      if (peer.ready && pc.signalingState !== 'stable') {
        peer.wantNego = true
        if (doRestart) peer.restartWanted = true
        return
      }
      // Yeni teklifin adayları teklif gönderilene kadar bekletilir. Teklif uygulanamazsa mevcut
      // anlaşmanın bekletilen adayları gönderilir (aday akışı kilitlenmesin).
      peer.localReady = false
      try {
        await pc.setLocalDescription(offer)
      } catch (e) {
        if (peer.ready && !peer.closed) flushOutbox(peer)
        throw e
      }
      if (peer.closed) return
      peer.offerNo++
      var pend = { o: peer.offerNo, sdp: pc.localDescription.sdp, restart: doRestart, resends: 0 }
      peer.pending = pend
      sendSignal(peer, { type: 'offer', sdp: pend.sdp, o: pend.o }, peer.ready ? function (status) { offerRefused(peer, pend, status) } : null)
      flushOutbox(peer)
      if (peer.ready) armNegoTimer(peer, pend)
    }

    function offerNoOf (v) {
      return typeof v === 'number' && v >= 1 && v <= 1e9 && Math.floor(v) === v ? v : null
    }

    function clearNegoTimer (peer) {
      if (peer.negoTimer) clearTimeout(peer.negoTimer)
      peer.negoTimer = null
    }

    // Teklif hâlâ yanıt bekliyor mu. Teklif nesnesiyle izlenir: yeni ICE oturumu açan teklifin yerel tanımı
    // sonradan toplanan adaylarla büyüdüğü için (Chromium) SDP metni karşılaştırılamaz.
    function stillPending (peer, pend) {
      return !peer.closed && peer.pending === pend && peer.pc.signalingState === 'have-local-offer'
    }

    function armNegoTimer (peer, pend) {
      clearNegoTimer(peer)
      peer.negoTimer = setTimeout(function () {
        peer.negoTimer = null
        if (!peer.closed) runOp(peer.peerId, function () { return resendOffer(peer, pend) })
      }, NEGO_TIMEOUT_MS)
    }

    // Süresinde yanıtlanmayan teklif geri alınmaz: karşı taraf teklifi uygulamış ve yalnız yanıtı kaybolmuş
    // olabilir. Geri alınırsa iki tarafın m satırları ayrışır (Chromium geri alınan mid'i yeniden kullanmaz,
    // sonraki her teklif karşı tarafta m satırı sırası hatasıyla reddedilir) ve geri alma mikrofon göndericisini
    // de durdurur (bkz. rollback). Bunun yerine aynı teklif aynı numarayla yeniden gönderilir: teklifi almamış
    // taraf ilk kez, almış taraf yeniden uygular ve yanıtlar, geç gelen yanıt da bekleyen teklife uyar.
    // Teklif beklerken bağlantı mevcut anlaşmayla çalışmaya devam eder (mikrofon akar). Yanıt hiç gelmezse
    // MAX_NEGO_RETRIES yeniden gönderimden sonra izleyiciye paylaşım bırakılır, yeniden gönderim sürer.
    function resendOffer (peer, pend) {
      if (!stillPending(peer, pend)) return
      pend.resends++
      if (pend.resends === MAX_NEGO_RETRIES + 1) negoStalled(peer)
      sendSignal(peer, { type: 'offer', sdp: pend.sdp, o: pend.o }, function (status) { offerRefused(peer, pend, status) })
      armNegoTimer(peer, pend)
    }

    // Teklif iletilemedi. 400: sunucu zarfı reddetti (maxSignalChars), yeniden göndermek anlamsızdır, bağlantı
    // yeniden kurulur (bkz. tooLargeRebuild). Diğer hatalarda yeniden gönderim zamanlayıcısı sürer.
    function offerRefused (peer, pend, status) {
      if (status !== 400 || peer.closed) return
      runOp(peer.peerId, function () {
        if (stillPending(peer, pend)) tooLargeRebuild(peer, pend.sdp)
      })
    }

    // Geri alma yalnız çakışmada (kibar eş kendi teklifini) ve yarım kalmış uzak teklifte yapılır, ardından hemen
    // karşı teklif uygulanır. Chromium 141'de (ölçüldü, work-screenshare/probe-rollback*.js) yeni bir görüntü m
    // satırı ekleyen teklif geri alınınca mevcut göndericiler (mikrofon dahil) sonraki anlaşmalardan sonra da paket
    // göndermiyor. Geri almadan sonraki ilk tamamlanan anlaşmada izi olan göndericilere aynı iz yeniden verilir
    // (refreshSenders). Karşı teklif uygulanamazsa bağlantı yeniden kurulur (bkz. offerFailed).
    async function rollback (peer) {
      try {
        await peer.pc.setLocalDescription({ type: 'rollback' })
      } catch (e) {
        return false
      }
      peer.pending = null
      peer.senderRefresh = true
      return !peer.closed
    }

    // Geri almadan sonra tamamlanan ilk anlaşmada (yanıt uygulandı veya verildi) göndericiler yeniden bağlanır.
    // Geri almanın hemen ardından yapılırsa etkisizdir (ölçüldü), bu yüzden anlaşma sonuna bırakılır.
    async function refreshSenders (peer) {
      if (!peer.senderRefresh || peer.closed) return
      peer.senderRefresh = false
      var list = null
      try {
        list = typeof peer.pc.getSenders === 'function' ? peer.pc.getSenders() : null
      } catch (e) {
        list = null
      }
      if (!list) list = peer.sender ? [peer.sender] : []
      var i = 0
      while (i < list.length && !peer.closed) {
        var s = list[i]
        i++
        if (s && s.track && typeof s.replaceTrack === 'function') await replaceSender(s, s.track)
      }
    }

    // Teklif uzun süredir yanıtlanmıyor (ör. sinyal yolu kesik): bu izleyiciye paylaşım bırakılır, hata bildirilir.
    // Teklif beklemeye devam eder, yanıt gelirse bağlantı tutarlı biçimde sürer (izleyici yeniden isteyebilir).
    function negoStalled (peer) {
      if (!peer.viewing) return
      var r = st.roster[peer.peerId]
      peer.viewing = null
      if (r) {
        screenEvent({ type: 'viewer-leave', userId: r.userId, peerId: peer.peerId })
        screenEvent({ type: 'error', code: 'screen_negotiation_failed', userId: r.userId, peerId: peer.peerId })
      }
      emit()
    }

    // Kurulu bağlantıda karşı tarafın teklifi uygulanamadı (ör. tarayıcı görüntü m satırını işleyemiyor). İki
    // tarafın anlaşma durumu ayrıştığı için tutarlı tek yol bağlantıyı yeniden kurmaktır (bu taraf yeni sid ile
    // başlatır, mikrofon yeni bağlantıda sürer). Teklif yeni m satırı ekliyorsa izleme yeniden istenmez (aynı
    // teklif yeniden gelip bağlantı tekrar tekrar kurulmasın), izleme başarısız bildirilir.
    function offerFailed (peer, grew) {
      var pid = peer.peerId
      var rs = st.remote[pid]
      if (grew && rs && st.watchWant[pid] === rs.id) {
        delete st.watchWant[pid]
        screenEvent({ type: 'error', code: 'screen_watch_failed', userId: rs.userId, peerId: pid })
      }
      rebuildPeer(peer)
    }

    // Kurulu bağlantıda karşı tarafın yanıtı uygulanamadı. Teklif beklemede kalsa yeniden gönderilen aynı teklif
    // aynı yanıtı getirir ve anlaşma hiç tamamlanmaz. Bağlantı yalnız mikrofonla yeniden kurulur (mikrofon yeni
    // bağlantıda sürer). Teklif yeni m satırı ekliyorsa bu eşe ekran gönderilmez, yeniden kurulan bağlantıda
    // aynı hata tekrarlanıp bağlantı tekrar tekrar kurulmaz (screen_negotiation_failed).
    function answerFailed (peer, pend) {
      var pid = peer.peerId
      var rd = peer.pc.remoteDescription
      var before = rd && rd.sdp ? mlineCount(rd.sdp) : 0
      var r = st.roster[pid]
      var grew = !!pend && mlineCount(pend.sdp) > before
      if (grew && st.share && (st.screenLimit[pid] || 0) < 2) {
        st.screenLimit[pid] = 2
        if (r) screenEvent({ type: 'error', code: 'screen_negotiation_failed', userId: r.userId, peerId: pid })
      } else if (grew && st.camera && !st.camBlocked[pid]) {
        st.camBlocked[pid] = true
        if (r) cameraEvent('camera_negotiation_failed', r.userId)
      } else if (grew) {
        st.screenLimit[pid] = 2
      }
      rebuildPeer(peer)
    }

    function mlineCount (sdp) {
      return (String(sdp).match(/\r\nm=/g) || []).length
    }

    // Teklif sunucunun zarf sınırını aştı (karşı tarafa ulaşmadı). Teklif geri alınsa da eklediği aktarıcılar
    // bağlantıda kalır ve sonraki her teklifi (ICE yeniden başlatma dahil) büyütür, Chromium'da anlaşılmamış
    // aktarıcıyı durdurmak (stop) da sonraki anlaşmaları bozuyor (ölçüldü, work-screenshare/probe-stop.js). Bu
    // yüzden bağlantı yalnız mikrofonla yeniden kurulur (yeni sid, bu taraf başlatır) ve bu eşe gönderilecek ekran
    // içeriği bir kademe azaltılır: önce paylaşılan ses bırakılır (yalnız görüntü), o da sığmazsa bu eşe ekran
    // gönderilmez. İzleyen taraf aynı paylaşımı yeni bağlantıda kendiliğinden yeniden ister (rewatch).
    function tooLargeRebuild (peer, sdp) {
      var pid = peer.peerId
      var r = st.roster[pid]
      var mlines = mlineCount(sdp)
      var level = st.screenLimit[pid] || 0
      var sh = st.share
      var cam = !!(peer.camT && peer.camT.sender && peer.camT.sender.track)
      if (mlines > 1 && sh && level < 2) {
        // Paylaşılan ses varsa önce o bırakılır, yoksa doğrudan ekran kapatılır
        level = level < 1 && sh.audio && mlines > 2 ? 1 : 2
        st.screenLimit[pid] = level
        if (r) screenEvent({ type: 'error', code: level >= 2 ? 'screen_negotiation_failed' : 'screen_audio_limited', userId: r.userId, peerId: pid })
      } else if (mlines > 1 && cam) {
        // Ekran zaten gönderilmiyorsa bu eşe kamera da gönderilmez (yeniden kurulan bağlantı tekrar büyümesin)
        st.camBlocked[pid] = true
        if (r) cameraEvent('camera_negotiation_failed', r.userId)
      } else if (mlines > 1) {
        st.screenLimit[pid] = 2
      }
      rebuildPeer(peer)
    }

    // Bağlantıyı yeniden kurar: eskisi kapanır (ekran durumu temizlenir), bu taraf yeni sid ile teklif eder.
    // İzlenen paylaşım yeni bağlantıda yeniden istenir.
    function rebuildPeer (peer) {
      var pid = peer.peerId
      if (st.watchWant[pid]) st.rewatch[pid] = st.watchWant[pid]
      closePeer(peer, 'reconnect')
      if (st.inVoice && st.roster[pid]) startInitiator(pid)
    }

    // Kararlı duruma dönüldü (yanıt uygulandı, teklif yanıtlandı veya geri alındı): ilk anlaşmadan sonra
    // paylaşım durumu duyurulur, ekran göndericileri eşitlenir, bekleyen değişiklik varsa yeniden teklif edilir.
    async function afterStable (peer) {
      if (peer.closed || peer.pc.signalingState !== 'stable') return
      if (!peer.ready) {
        if (!peer.pc.remoteDescription || !peer.pc.localDescription) return
        peer.ready = true
        if (st.share) sendSignal(peer, announcement(st.share))
      }
      await syncSendersNow(peer)
    }

    function startInitiator (pid) {
      var peer = createPeer(pid, true, randomHex(8))
      if (!peer) return
      runOp(pid, function () { return sendOffer(peer, false) })
    }

    async function addQueuedCandidates (peer) {
      var list = peer.candidates
      peer.candidates = []
      var i = 0
      while (i < list.length && !peer.closed) {
        try {
          await peer.pc.addIceCandidate(list[i])
        } catch (e) {}
        i++
      }
    }

    async function processSignal (from, d) {
      if (!st.inVoice || !st.roster[from]) return
      if (typeof d.sid !== 'string' || !SID_RE.test(d.sid)) return
      var sid = d.sid
      var peer = st.peers[from] || null
      if (d.type === 'offer') {
        if (typeof d.sdp !== 'string' || !d.sdp || d.sdp.length > MAX_SDP_CHARS) return
        if (peer && peer.sid === sid) {
          // Aynı bağlantıda yeni teklif: ICE yeniden başlatma veya yeniden anlaşma. Başlatıcının ilk teklifi
          // yanıtlanmadan karşı taraf teklif edemez.
          if (peer.initiator && !peer.ready) return
          if (peer.pc.signalingState !== 'stable') {
            // Çakışma: kaba eş (başlatıcı) gelen teklifi yok sayar, kibar eş (yanıtlayan) kendi teklifini geri alır
            // ve karşı teklifi yanıtladıktan sonra kendi değişikliğini yeniden teklif eder. Yarım kalmış bir
            // uzak teklif (have-remote-offer, yanıt oluşturulamamış) her iki rolde de geri alınır.
            var glare = peer.pc.signalingState === 'have-local-offer'
            if (glare && !peer.polite) return
            var wasRestart = glare && !!peer.pending && peer.pending.restart
            clearNegoTimer(peer)
            if (!(await rollback(peer))) return
            peer.wantNego = true
            if (wasRestart) peer.restartWanted = true
          }
        } else if (peer) {
          // İki taraf aynı anda yeni bağlantı başlattıysa (ikisi de yanıt beklerken) eş kimliği küçük olanın
          // teklifi geçerlidir, öbür taraf kendi teklifini bırakıp yanıtlar
          if (peer.initiator && !peer.ready && peer.pc.signalingState === 'have-local-offer' && st.myPeerId < from) return
          // Karşı taraf yeni bir bağlantı başlattı: eskisini kapat, bu kez yanıtlayan ol. İzlenen paylaşım
          // yeni bağlantıda yeniden istenir.
          if (st.watchWant[from]) st.rewatch[from] = st.watchWant[from]
          closePeer(peer, 'reconnect')
          peer = null
        }
        if (!peer) peer = createPeer(from, false, sid)
        if (!peer) return
        // Kurulu bağlantıda (aynı sid, ilk anlaşma tamam) yeniden anlaşma veya ICE yeniden başlatma teklifi.
        // Aynı teklif yeniden gelebilir (yanıtı kaybolduysa), kararlı durumda yeniden uygulanır ve yanıtlanır.
        var established = peer.ready
        var before = established && peer.pc.remoteDescription ? mlineCount(peer.pc.remoteDescription.sdp) : 0
        peer.localReady = false
        try {
          await peer.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp })
          if (peer.closed) return
          prepareRemoteTransceivers(peer)
          await addQueuedCandidates(peer)
          if (peer.closed) return
          var answer = await peer.pc.createAnswer()
          if (peer.closed) return
          await peer.pc.setLocalDescription(answer)
        } catch (e) {
          if (established && !peer.closed) offerFailed(peer, mlineCount(d.sdp) > before)
          return
        }
        if (peer.closed) return
        // Yanıt teklifin numarasını taşır (karşı taraf başka bir teklifin yanıtını bekleyen teklife uygulamaz)
        var reply = { type: 'answer', sdp: peer.pc.localDescription.sdp }
        if (offerNoOf(d.o) !== null) reply.o = d.o
        sendSignal(peer, reply)
        flushOutbox(peer)
        await refreshSenders(peer)
        await afterStable(peer)
      } else if (d.type === 'answer') {
        if (!peer || peer.sid !== sid) return
        if (typeof d.sdp !== 'string' || !d.sdp || d.sdp.length > MAX_SDP_CHARS) return
        if (peer.pc.signalingState !== 'have-local-offer') return
        var ono = offerNoOf(d.o)
        if (ono !== null && peer.pending && ono !== peer.pending.o) return
        var pend = peer.pending
        try {
          await peer.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp })
        } catch (e) {
          if (peer.ready && !peer.closed) answerFailed(peer, pend)
          return
        }
        if (peer.closed) return
        peer.pending = null
        clearNegoTimer(peer)
        await addQueuedCandidates(peer)
        if (peer.closed) return
        await refreshSenders(peer)
        await afterStable(peer)
      } else if (d.type === 'screen' || d.type === 'watch') {
        if (!peer || peer.sid !== sid || !peer.ready) return
        var m = validScreenSignal(d)
        if (!m) return
        if (m.type === 'screen') onScreenSignal(peer, m)
        else await onWatchSignal(peer, m)
      } else if (d.type === 'camera') {
        if (!peer || peer.sid !== sid || !peer.ready) return
        var cm = validCameraSignal(d)
        if (cm) onCameraSignal(peer, cm)
      } else if (d.type === 'candidate') {
        if (!peer || peer.sid !== sid) return
        var c = parseCandidate(d.candidate)
        if (!c) return
        if (!peer.pc.remoteDescription) {
          if (peer.candidates.length < MAX_CANDIDATES) peer.candidates.push(c)
          return
        }
        try {
          await peer.pc.addIceCandidate(c)
        } catch (e) {}
      }
    }

    // Sinyal gönderimi: eş başına sıralı kuyruk, önceki POST bitmeden sonraki gönderilmez.
    // Her sinyal bağlantı kimliğini (sid) ve bağlantı başına artan sırayı (n) taşır, yeniden oynatma reddedilir.
    // onFail(status) (isteğe bağlı): yeniden denemelerden sonra da iletilemezse çağrılır. 400 sunucunun zarfı
    // reddettiği anlamına gelir (biçim her zaman geçerli olduğundan boyut sınırı, maxSignalChars).
    function sendSignal (peer, d, onFail) {
      if (!st.inVoice || !st.myPeerId || peer.closed) return
      var pid = peer.peerId
      peer.outN++
      d.sid = peer.sid
      d.n = peer.outN
      var data = null
      try {
        if (st.privateCall) {
          // Özel aramada düz metin konuşma kimliğini de bağlar (başka bir konuşmanın sinyali yeniden oynatılamaz)
          data = st.privateSeal({ v: 1, from: st.myPeerId, to: pid, c: String(st.channelId), d: d })
        } else {
          data = seal({ v: 1, from: st.myPeerId, to: pid, d: d })
        }
      } catch (e) {
        data = null
      }
      if (typeof data !== 'string') {
        st.errorCode = 'no_key'
        st.serverError = null
        emit()
        return
      }
      var gen = st.gen
      var prev = st.sendQueues[pid] || Promise.resolve()
      st.sendQueues[pid] = prev.then(function () {
        return postSignal(gen, pid, data, 0)
      }).then(function (res) {
        if (res !== true && res !== undefined && onFail && gen === st.gen) onFail(res)
      }).catch(noop)
    }

    // Dönüş: true iletildi, sayı iletilemedi (HTTP durumu, ağ hatasında 0), undefined oturum değişti
    async function postSignal (gen, pid, data, attempt) {
      if (gen !== st.gen) return
      var res = null
      try {
        res = await callApi('POST', '/api/voice/signal', { to: pid, data: data })
      } catch (e) {
        res = null
      }
      if (gen !== st.gen) return
      var status = res && typeof res.status === 'number' ? res.status : 0
      if (status >= 200 && status < 300) return true
      if ((status === 0 || status === 429 || status >= 500) && attempt < SIGNAL_RETRIES) {
        await delay(1000 * Math.pow(2, attempt))
        return postSignal(gen, pid, data, attempt + 1)
      }
      return status
    }

    // Gelen sinyal: çöz, etkin anahtar ve from/to bağlamasını denetle (sunucu yönlendirmeyi değiştiremez).
    // Özel aramada yalnızca private.open kullanılır (karşı tarafın şu anki doğrulanmış anahtarı), grup anahtarı
    // kimliği denetlenmez, düz metindeki konuşma kimliği bu aramanınki olmalıdır.
    function verify (from, data) {
      if (!st.myPeerId || from === st.myPeerId) return null
      var priv = st.privateCall
      var res = null
      try {
        res = priv ? st.privateOpen(data) : open(data)
      } catch (e) {
        return null
      }
      if (!res || res.ok !== true || !res.value || typeof res.value !== 'object') return null
      if (!priv && (!st.kid || res.kid !== st.kid)) {
        st.kid = probeKid()
        if (!st.kid || res.kid !== st.kid) return null
      }
      var v = res.value
      if (v.v !== 1 || v.from !== from || v.to !== st.myPeerId) return null
      if (priv && v.c !== String(st.channelId)) return null
      var d = v.d
      if (!d || typeof d !== 'object') return null
      var screenType = d.type === 'screen' || d.type === 'watch'
      var cameraType = d.type === 'camera'
      if (d.type !== 'offer' && d.type !== 'answer' && d.type !== 'candidate' && !screenType && !cameraType) return null
      if (typeof d.sid !== 'string' || !SID_RE.test(d.sid)) return null
      if (typeof d.n !== 'number' || d.n < 1 || d.n > 1e9 || Math.floor(d.n) !== d.n) return null
      // Ekran sinyalleri katı doğrulanır, geçersizi sıra numarası tüketmeden atılır
      if (screenType && !validScreenSignal(d)) return null
      if (cameraType && !validCameraSignal(d)) return null
      if (!fresh(from, d.sid, d.n)) return null
      return v
    }

    // Yeniden oynatma koruması: gönderen ve bağlantı başına görülen en büyük sıra, istemci ömrü boyunca tutulur
    function fresh (from, sid, n) {
      var m = seen.get(from)
      if (!m) {
        m = new Map()
        seen.set(from, m)
        if (seen.size > MAX_SEEN_PEERS) seen.delete(seen.keys().next().value)
      }
      var last = m.get(sid)
      if (last !== undefined && n <= last) return false
      m.delete(sid)
      m.set(sid, n)
      if (m.size > MAX_SEEN_SIDS) m.delete(m.keys().next().value)
      return true
    }

    function acceptSignal (from, data) {
      var v = verify(from, data)
      if (!v) return
      if (!st.roster[from]) {
        // Gönderen henüz kadroda görünmüyor: meta gelene kadar kısa süre beklet
        st.unknown.push({ from: from, d: v.d, time: Date.now() })
        if (st.unknown.length > MAX_UNKNOWN) st.unknown.shift()
        return
      }
      runOp(from, function () { return processSignal(from, v.d) })
    }

    function processUnknown () {
      if (!st.unknown.length) return
      var now = Date.now()
      var list = st.unknown
      st.unknown = []
      list.forEach(function (u) {
        if (now - u.time > UNKNOWN_TTL_MS) return
        if (st.roster[u.from]) {
          runOp(u.from, function () { return processSignal(u.from, u.d) })
        } else {
          st.unknown.push(u)
        }
      })
    }

    function handleSignals (signals) {
      if (!Array.isArray(signals) || !signals.length) return
      st.serverAt = Date.now()
      var list = signals.filter(function (s) {
        return s && typeof s === 'object' && typeof s.seq === 'number' && isFinite(s.seq)
      })
      list.sort(function (a, b) { return a.seq - b.seq })
      list.forEach(function (s) {
        if (s.seq <= st.lastSigSeq) return
        st.lastSigSeq = s.seq
        if (!isPeerId(s.from) || typeof s.data !== 'string' || s.data.length > MAX_SIGNAL_CHARS) return
        // Seste değilken veya katılım sürerken gelen sinyaller önceki ses oturumuna aittir, atılır
        if (!st.inVoice) return
        acceptSignal(s.from, s.data)
      })
    }

    // Ekran paylaşımı (Ek L1). Görüntü ve paylaşılan ses mevcut ses bağlantısına ek aktarıcılarla eklenir,
    // eşler arası DTLS-SRTP ile şifreli gider. Kim paylaşıyor ve kim izliyor bilgisi sunucuya yazılmaz, şifreli
    // sinyal mesajlarıyla ('screen', 'watch') taşınır. Bir bağlantıda en fazla üç m satırı olur: mikrofon,
    // ekran görüntüsü, ekran sesi. Aktarıcılar iki yönde de yeniden kullanılır, paylaşım bitince kaldırılmaz,
    // göndericiye boş iz verilir (veri gitmez). Böylece tekrar tekrar başlatıp durdurmak SDP'yi büyütmez.

    // Olaylar mikro görevde ve sırayla bildirilir, dinleyici hatası motoru bozmaz
    function screenEvent (evt) {
      if (!onScreenEvent) return
      Promise.resolve().then(function () {
        try {
          onScreenEvent(evt)
        } catch (e) {
          setTimeout(function () { throw e }, 0)
        }
      })
    }

    function transceiversOf (pc) {
      try {
        return pc && typeof pc.getTransceivers === 'function' ? pc.getTransceivers() : []
      } catch (e) {
        return []
      }
    }

    function transceiverOf (pc, sender) {
      if (!sender) return null
      var list = transceiversOf(pc)
      var i = 0
      while (i < list.length) {
        if (list[i].sender === sender) return list[i]
        i++
      }
      return null
    }

    function isStopped (t) {
      return t.stopped === true || t.direction === 'stopped' || t.currentDirection === 'stopped'
    }

    function sendsDir (d) {
      return d === 'sendrecv' || d === 'sendonly'
    }

    function kindOf (t) {
      return t.receiver && t.receiver.track ? t.receiver.track.kind : null
    }

    // İz taşıyan ama henüz anlaşılmamış (mid'i olmayan) aktarıcı varsa yeniden anlaşma gerekir
    function needsNegotiation (peer) {
      return transceiversOf(peer.pc).some(function (t) {
        return !isStopped(t) && t.mid === null && !!t.sender && !!t.sender.track
      })
    }

    // Karşı tarafın eklediği ekran aktarıcıları, bu cihaz da paylaşabiliyorsa yanıttan önce çift yönlü yapılır.
    // Bu cihaz sonradan paylaşırsa aynı m satırını yeniden anlaşmasız (replaceTrack) kullanır. İzi olmayan
    // gönderici veri göndermez.
    function prepareRemoteTransceivers (peer) {
      if (!peer.micT || !screenSupport().share) return
      transceiversOf(peer.pc).forEach(function (t) {
        if (t === peer.micT || isStopped(t) || t.direction !== 'recvonly') return
        try {
          t.direction = 'sendrecv'
        } catch (e) {}
      })
    }

    // Ekran izi için kullanılabilecek mevcut aktarıcı: mikrofon dışı, aynı türde, durdurulmamış, göndericisi boş
    // veya zaten bu izi taşıyan
    function adoptTransceiver (peer, kind, track) {
      if (!peer.micT) return null
      var list = transceiversOf(peer.pc)
      var i = 0
      while (i < list.length) {
        var t = list[i]
        i++
        if (t === peer.micT || isStopped(t) || kindOf(t) !== kind || !t.sender) continue
        if (t === peer.scrT.video || t === peer.scrT.audio || t === peer.camT) continue
        if (t.sender.track && t.sender.track !== track) continue
        return t
      }
      return null
    }

    // Kodek listesi yalnızca istenen kodeklerden en az biri varsa uygulanır, desteklenmezse sessizce geçilir
    function applyCodecPrefs (t, kind) {
      if (kind !== 'video' && kind !== 'audio') return
      try {
        var R = window.RTCRtpReceiver
        if (typeof t.setCodecPreferences !== 'function' || !R || typeof R.getCapabilities !== 'function') return
        var caps = R.getCapabilities(kind)
        var list = caps && caps.codecs ? caps.codecs.filter(function (c) { return keepScreenCodec(kind, c) }) : []
        var media = list.filter(function (c) { return !/\/rtx$/i.test(c.mimeType) })
        if (media.length) t.setCodecPreferences(list)
      } catch (e) {}
    }

    // Teklif öncesi bütün ekran aktarıcılarına (bu tarafın eklediği, karşı tarafın teklifiyle açılan ve
    // devralınan) kodek süzgeci uygulanır: teklifteki her ekran m satırı süzülmüş olur. Mikrofon süzülmez.
    // Yanıtlar teklifin kodeklerinin kesişimi olduğundan ayrıca süzülmez.
    function filterScreenCodecs (peer) {
      if (!peer.micT) return
      transceiversOf(peer.pc).forEach(function (t) {
        if (t !== peer.micT && !isStopped(t)) applyCodecPrefs(t, kindOf(t))
      })
    }

    // Karşı taraf bir ekran m satırını reddetti (yanıtta port 0, ör. ortak görüntü kodeki yok): aktarıcı durur.
    // Bu bağlantıda o tür bir daha eklenmez, yeniden eklemek aynı reddi ve sınırsız yeniden anlaşmayı getirir.
    // Görüntü reddedildiyse bu eşe ekran gönderilmez, ses reddedildiyse yalnız görüntü gider.
    function noteRejected (peer) {
      var r = st.roster[peer.peerId]
      if (peer.camT && isStopped(peer.camT)) {
        peer.camT = null
        peer.camSent = null
        if (!peer.camRejected) {
          peer.camRejected = true
          if (r) cameraEvent('camera_negotiation_failed', r.userId)
          emit()
        }
      }
      SCREEN_KINDS.forEach(function (kind) {
        var t = peer.scrT[kind]
        if (!t || !isStopped(t)) return
        peer.scrT[kind] = null
        if (peer.rejected[kind]) return
        peer.rejected[kind] = true
        if (kind === 'video' && peer.viewing) {
          peer.viewing = null
          if (r) screenEvent({ type: 'viewer-leave', userId: r.userId, peerId: peer.peerId })
        }
        if (r) screenEvent({ type: 'error', code: kind === 'video' ? 'screen_negotiation_failed' : 'screen_audio_limited', userId: r.userId, peerId: peer.peerId })
        emit()
      })
    }

    function replaceSender (sender, track) {
      try {
        return Promise.resolve(sender.replaceTrack(track)).then(function () { return true }, function () { return false })
      } catch (e) {
        return Promise.resolve(false)
      }
    }

    function canEncode (sender) {
      return !!sender && typeof sender.getParameters === 'function' && typeof sender.setParameters === 'function'
    }

    // getParameters, değiştir, setParameters. edit(e0) false dönerse değişiklik gerekmez.
    // Dönüş: Promise<boolean> (uygulandı veya zaten öyleydi)
    function editEncoding (sender, edit) {
      if (!canEncode(sender)) return Promise.resolve(false)
      var params = null
      try {
        params = sender.getParameters()
      } catch (e) {
        return Promise.resolve(false)
      }
      if (!params || !params.encodings || !params.encodings.length) return Promise.resolve(false)
      if (edit(params.encodings[0]) === false) return Promise.resolve(true)
      try {
        return Promise.resolve(sender.setParameters(params)).then(function () { return true }, function () { return false })
      } catch (e) {
        return Promise.resolve(false)
      }
    }

    // Kodlama sınırları (maxBitrate, maxFramerate) ve kodlamanın etkinliği. Desteklemeyen tarayıcıda sessizce
    // geçilir, maxFramerate reddedilirse yalnızca bit hızı uygulanır. Dönüş: Promise<boolean> (uygulandı mı)
    function setEncoding (sender, enc) {
      function attempt (withRate) {
        return editEncoding(sender, function (e0) {
          var same = e0.maxBitrate === enc.maxBitrate && (!withRate || e0.maxFramerate === enc.maxFramerate) && e0.active !== false
          if (same) return false
          e0.maxBitrate = enc.maxBitrate
          if (withRate) e0.maxFramerate = enc.maxFramerate
          e0.active = true
        })
      }
      return attempt(true).then(function (ok) {
        return ok || attempt(false)
      })
    }

    // İzleyici bırakınca görüntü kodlaması da kapatılır: izi olmayan etkin bir görüntü göndericisi Chromium'da
    // bant genişliği yoklaması için dolgu paketleri göndermeye devam ediyor (ölçüldü, kare yok ama bayt var).
    function deactivateEncoding (sender) {
      return editEncoding(sender, function (e0) {
        if (e0.active === false) return false
        e0.active = false
      })
    }

    function applyScreenParams (peer) {
      var sh = st.share
      var t = peer.scrT.video
      if (!sh || !t || peer.closed || t.mid === null || peer.pc.signalingState !== 'stable') return Promise.resolve(false)
      if (!t.sender || t.sender.track !== sh.video) return Promise.resolve(false)
      return setEncoding(t.sender, screenEncoding(sh.preset))
    }

    // Bu eşe gönderilen ekran izleri: yalnızca paylaşım canlıyken ve eş bu paylaşımı izlemek istediyse.
    // İzlemeyen eşe görüntü gönderilmez (aktarıcı hiç eklenmez veya göndericisi boş izdir). Eş işlemleri
    // içinde çağrılır (runOp), bağlantı başına sıralıdır.
    async function syncSendersNow (peer) {
      if (peer.closed) return
      noteRejected(peer)
      var sh = st.share
      var limit = st.screenLimit[peer.peerId] || 0
      var on = !!(sh && peer.ready && peer.viewing === sh.id && limit < 2 && !peer.rejected.video)
      var i = 0
      while (i < SCREEN_KINDS.length) {
        var kind = SCREEN_KINDS[i]
        i++
        var track = on && (kind === 'video' || (limit < 1 && !peer.rejected.audio)) ? sh[kind] : null
        var t = peer.scrT[kind]
        if (!track) {
          if (t && t.sender && t.sender.track) {
            await replaceSender(t.sender, null)
            if (kind === 'video' && t.mid !== null) await deactivateEncoding(t.sender)
          }
        } else {
          if (!t) t = adoptTransceiver(peer, kind, track)
          if (t) {
            peer.scrT[kind] = t
            if (!sendsDir(t.direction)) {
              try {
                t.direction = 'sendrecv'
                peer.wantNego = true
              } catch (e) {}
            } else if (t.currentDirection && !sendsDir(t.currentDirection) && peer.dirNego < MAX_NEGO_RETRIES) {
              // Son anlaşmada bu yönde gönderim kabul edilmemiş: gönderim yönüyle yeniden teklif edilir (sınırlı)
              peer.dirNego++
              peer.wantNego = true
            }
            if (t.sender.track !== track) await replaceSender(t.sender, track)
          } else {
            var sender = null
            try {
              sender = peer.pc.addTrack(track, sh.stream)
            } catch (e) {
              sender = null
            }
            peer.scrT[kind] = sender ? transceiverOf(peer.pc, sender) : null
            if (peer.scrT[kind]) applyCodecPrefs(peer.scrT[kind], kind)
          }
        }
        // Beklerken paylaşım değiştiyse sıradaki eşitleme işlemi son durumu uygular
        if (peer.closed || st.share !== sh) return
      }
      await syncCameraNow(peer)
      if (peer.closed) return
      await applyScreenParams(peer)
      if (peer.closed) return
      if (peer.ready && (peer.wantNego || peer.restartWanted || needsNegotiation(peer))) await sendOffer(peer, false)
      if (peer.closed) return
      await announceCamera(peer)
    }

    function syncScreenSenders (peer) {
      return runOp(peer.peerId, function () { return syncSendersNow(peer) })
    }

    function syncAllSenders () {
      return Promise.all(Object.keys(st.peers).map(function (pid) { return syncScreenSenders(st.peers[pid]) }))
    }

    function announcement (sh) {
      return { type: 'screen', on: true, id: sh.id, audio: !!sh.audio, hint: sh.hint, preset: sh.preset }
    }

    // Duyuru yalnızca ilk anlaşması tamamlanmış eşlere gider, diğerlerine anlaşma bitince gider (afterStable)
    function announceAll () {
      var sh = st.share
      if (!sh) return
      Object.keys(st.peers).forEach(function (pid) {
        var p = st.peers[pid]
        if (p.ready && !p.closed) sendSignal(p, announcement(sh))
      })
    }

    function setHint (track, hint) {
      try {
        if ('contentHint' in track) track.contentHint = hint
      } catch (e) {}
    }

    function applyTrackConstraints (track, presetId) {
      try {
        if (typeof track.applyConstraints !== 'function') return Promise.resolve(false)
        return Promise.resolve(track.applyConstraints(trackConstraints(presetId))).then(function () { return true }, function () { return false })
      } catch (e) {
        return Promise.resolve(false)
      }
    }

    function stopTrack (t) {
      try {
        t.stop()
      } catch (e) {}
    }

    // Seçici kullanıcı hareketi gerektirir: getDisplayMedia çağrısı ilk await'ten önce, eşzamanlı yapılır.
    // Kısıtlı isteği TypeError ile reddeden eski tarayıcılarda yalın istekle, ses yakalamayı hiç tanımayan
    // tarayıcılarda sessiz istekle denenir (TypeError seçici açılmadan döner, kullanıcı hareketi tükenmez).
    async function getDisplay (o) {
      var md = navigator.mediaDevices
      try {
        return await md.getDisplayMedia(displayConstraints(o))
      } catch (e) {
        if (!e || e.name !== 'TypeError') throw e
      }
      try {
        return await md.getDisplayMedia({ video: true, audio: !!o.audio })
      } catch (e2) {
        if (!o.audio || !e2 || e2.name !== 'TypeError') throw e2
      }
      return md.getDisplayMedia({ video: true })
    }

    // Bağlantı kopunca paylaşım kesin olarak durur (Ek L1.7). Sunucudan düşme normalde kendi kimliğini içermeyen
    // meta ile anlaşılır (dropped), ama çevrimdışıyken meta gelmez. Bu yüzden paylaşım sürerken sunucudan
    // LINK_PROBE_MS boyunca yanıt (meta, sinyal veya istek yanıtı) gelmezse sunucu yoklanır (durum bildirimi,
    // sunucuda değişiklik yapmaz). Bir yoklama başarısız olduğunda son yanıtın üzerinden OFFLINE_STOP_MS geçmişse
    // paylaşım durur ('left'). Karar yalnız başarısız yoklamayla verilir, arka plan sekmesinde kısılan
    // zamanlayıcılar paylaşımı yanlışlıkla durdurmaz.
    function startLinkWatch () {
      st.serverAt = Date.now()
      if (!st.linkTimer) st.linkTimer = setTimeout(linkTick, LINK_TICK_MS)
    }

    function stopLinkWatch () {
      if (st.linkTimer) clearTimeout(st.linkTimer)
      st.linkTimer = null
      st.linkProbe = null
    }

    function linkTick () {
      st.linkTimer = null
      if (!st.share || !st.inVoice) return
      if (!st.linkProbe && Date.now() - st.serverAt >= LINK_PROBE_MS) probeLink()
      st.linkTimer = setTimeout(linkTick, LINK_TICK_MS)
    }

    // Yoklama durum bildirimiyle (postState) aynı sırayla gider: ikisi aynı anda giderse önce gönderilen eski
    // değer sunucuya sonra varıp yeniyi ezebilirdi. Bildirim sürüyorsa yoklama sonraki adıma kalır (bildirimin
    // yanıtı da erişim kanıtıdır). Yanıt LINK_PROBE_MS içinde gelmezse yoklama başarısız sayılır ve sıra bırakılır:
    // askıda kalan istek (zaman aşımı olmayan api) ne denetimi ne de durum bildirimini durdurur. Süresi geçtikten
    // sonra yanıtlanan yoklama sunucuya eski değerle varmış olabilir, son durum yeniden bildirilir.
    function probeLink () {
      if (st.statePosting) return
      var probe = { gen: st.gen, timer: null, held: true }
      st.linkProbe = probe
      st.statePosting = true
      var release = function () {
        if (!probe.held) return false
        probe.held = false
        statePosted(probe.gen)
        return true
      }
      var finish = function (ok) {
        if (st.linkProbe !== probe) return
        st.linkProbe = null
        if (ok || probe.gen !== st.gen || !st.share) return
        if (Date.now() - st.serverAt >= OFFLINE_STOP_MS) stopShare('left', false)
      }
      probe.timer = setTimeout(function () {
        release()
        finish(false)
      }, LINK_PROBE_MS)
      var body = { muted: st.muted || st.serverMuted || st.deafened, deafened: st.deafened }
      callApi('POST', '/api/voice/state', body).then(function (res) {
        return !!res && typeof res.status === 'number' && res.status > 0
      }, function () {
        return false
      }).then(function (ok) {
        clearTimeout(probe.timer)
        if (!release() && probe.gen === st.gen) postState()
        finish(ok)
      })
    }

    function onPageHide () {
      if (st.share || st.shareStarting) stopShare('unload', false)
    }

    // Sekme kapanırken veya sayfadan ayrılırken yakalama kesin olarak durur
    function setPageHide (on) {
      if (on === st.pageHideOn || typeof window === 'undefined') return
      st.pageHideOn = on
      window[on ? 'addEventListener' : 'removeEventListener']('pagehide', onPageHide)
    }

    // Paylaşımı başlatır (Ayarlar'daki varsayılanlar opts ile ezilir). Paylaşım sürerken yeniden çağrılırsa
    // kaynak değişir (aynı paylaşım kimliği, izleyiciler korunur), seçim iptal edilirse eski paylaşım sürer.
    // Dönüş: Promise<{ id, audio }>, ret Error.code ile.
    function startScreenShare (opts) {
      var sup = screenSupport()
      if (!sup.share) return Promise.reject(makeError(sup.reason || 'screen_unsupported'))
      if (!st.inVoice) return Promise.reject(makeError('not_in_voice'))
      if (st.shareStarting) return Promise.reject(makeError('screen_busy'))
      var o = screenOptions(opts, st.screenSettings)
      var gen = st.gen
      var sgen = ++st.shareGen
      var job = getDisplay(o).then(function (stream) {
        if (gen !== st.gen || sgen !== st.shareGen || !st.inVoice) {
          stopStream(stream)
          throw makeError('cancelled')
        }
        return beginShare(stream, o)
      }, function (e) {
        throw makeError(screenErrorCode(e))
      })
      st.shareError = null
      st.shareState = shareStep(st.shareState, 'start')
      st.shareStarting = job
      setPageHide(true)
      emit()
      return job.then(function (res) {
        if (st.shareStarting === job) st.shareStarting = null
        emit()
        return res
      }, function (e) {
        if (st.shareStarting === job) {
          st.shareStarting = null
          st.shareState = shareStep(st.shareState, 'failed')
          if (!st.share) setPageHide(false)
          if (e.code !== 'cancelled') {
            st.shareError = e.code
            screenEvent({ type: 'error', code: e.code, userId: null, peerId: null })
          }
          emit()
        }
        throw e
      })
    }

    function beginShare (stream, o) {
      var video = stream.getVideoTracks()[0] || null
      if (!video || video.readyState === 'ended') {
        stopStream(stream)
        throw makeError('screen_failed')
      }
      var audio = o.audio ? (stream.getAudioTracks()[0] || null) : null
      stream.getTracks().forEach(function (t) {
        if (t !== video && t !== audio) stopTrack(t)
      })
      setHint(video, o.hint)
      applyTrackConstraints(video, o.preset)
      var old = st.share
      var share = {
        id: old ? old.id : randomHex(8),
        video: video,
        audio: audio,
        tracks: audio ? [video, audio] : [video],
        stream: new MediaStream(audio ? [video, audio] : [video]),
        preview: new MediaStream([video]),
        preset: o.preset,
        hint: o.hint,
        wantAudio: o.audio,
        onVideoEnded: null,
        onAudioEnded: null
      }
      // Tarayıcının kendi "paylaşımı durdur" çubuğu veya kapanan pencere görüntü izini bitirir
      share.onVideoEnded = function () {
        if (st.share === share) stopShare('ended', false)
      }
      // Yalnızca ses biterse paylaşım sessiz sürer
      share.onAudioEnded = function () {
        if (st.share !== share || !share.audio) return
        share.audio = null
        announceAll()
        syncAllSenders()
        emit()
      }
      video.addEventListener('ended', share.onVideoEnded)
      if (audio) audio.addEventListener('ended', share.onAudioEnded)
      st.share = share
      st.shareState = shareStep(st.shareState, 'granted')
      setPageHide(true)
      if (!old) startLinkWatch()
      announceAll()
      var synced = syncAllSenders()
      var info = { id: share.id, audio: !!audio, preset: share.preset, hint: share.hint }
      if (old) {
        // Kaynak değişimi: eski izler, göndericiler yeni izlere geçtikten sonra durdurulur
        synced.then(function () { releaseShare(old) })
        screenEvent(Object.assign({ type: 'local-update' }, info))
      } else {
        screenEvent(Object.assign({ type: 'local-start' }, info))
      }
      emit()
      return { id: share.id, audio: !!audio }
    }

    function releaseShare (sh) {
      try {
        sh.video.removeEventListener('ended', sh.onVideoEnded)
      } catch (e) {}
      sh.tracks.forEach(function (t) {
        try {
          t.removeEventListener('ended', sh.onAudioEnded)
        } catch (e) {}
        stopTrack(t)
      })
    }

    // Paylaşımı durdurur: yakalama hemen biter, eşlere 'screen' kapalı bildirilir, göndericiler boşaltılır.
    // silent: oturum kapanıyor (bağlantılar zaten kapatılacak), sinyal gönderilmez.
    function stopShare (reason, silent) {
      var why = STOP_REASONS.indexOf(reason) >= 0 ? reason : 'user'
      st.shareGen++
      var starting = !!st.shareStarting
      st.shareStarting = null
      var sh = st.share
      st.share = null
      st.shareState = shareStep(st.shareState, why === 'ended' ? 'ended' : 'stop')
      setPageHide(false)
      stopLinkWatch()
      if (!sh) {
        if (starting) emit()
        return
      }
      releaseShare(sh)
      Object.keys(st.peers).forEach(function (pid) {
        var p = st.peers[pid]
        p.viewing = null
        p.dirNego = 0
        if (!silent && p.ready && !p.closed) sendSignal(p, { type: 'screen', on: false, id: sh.id })
      })
      if (!silent) syncAllSenders()
      screenEvent({ type: 'local-stop', id: sh.id, reason: why })
      emit()
    }

    // Paylaşım sürerken kalite ve içerik ipucu değişimi. Dönüş: Promise<null | 'no_share'>, reddedilmez.
    function setScreenQuality (partial) {
      var sh = st.share
      if (!sh) return Promise.resolve('no_share')
      var p = partial && typeof partial === 'object' ? partial : {}
      var o = screenOptions({ preset: p.preset, hint: p.hint }, { preset: sh.preset, hint: sh.hint })
      if (o.preset === sh.preset && o.hint === sh.hint) return Promise.resolve(null)
      sh.preset = o.preset
      sh.hint = o.hint
      setHint(sh.video, sh.hint)
      var job = applyTrackConstraints(sh.video, sh.preset)
      announceAll()
      screenEvent({ type: 'local-update', id: sh.id, audio: !!sh.audio, preset: sh.preset, hint: sh.hint })
      emit()
      return Promise.all([job, syncAllSenders()]).then(function () { return null }, function () { return null })
    }

    function getScreenSettings () {
      var s = st.screenSettings
      return { preset: s.preset, hint: s.hint, audio: s.audio }
    }

    // Paylaşım varsayılanları (cihaza özel, 'telsiz.voice.screen'). Geçersiz alanlar yok sayılır.
    function setScreenSettings (partial) {
      st.screenSettings = screenOptions(partial, st.screenSettings)
      writeStored(SCREEN_KEY, getScreenSettings())
      emit()
      return getScreenSettings()
    }

    // İzleyici tarafı: paylaşım duyurusu, güncellemesi veya bitişi
    function onScreenSignal (peer, m) {
      var pid = peer.peerId
      var r = st.roster[pid]
      if (!r) return
      var rs = st.remote[pid]
      if (!m.on) {
        if (rs && rs.id === m.id) dropRemote(pid, 'stopped')
        return
      }
      if (rs && rs.id !== m.id) {
        dropRemote(pid, 'stopped')
        rs = null
      }
      var info = { userId: r.userId, peerId: pid, id: m.id, audio: m.audio, hint: m.hint, preset: m.preset }
      if (!rs) {
        rs = { id: m.id, userId: r.userId, audio: m.audio, hint: m.hint, preset: m.preset, watch: watchStep('none', 'announce'), stream: null, audioEl: null, audioTrack: null, watchTimer: null, flow: false, probe: null }
        st.remote[pid] = rs
        // Bağlantı yenilendiyse ve aynı paylaşım izleniyorduysa yeniden istenir
        var again = st.rewatch[pid] === m.id
        // fresh: paylaşım şimdi başladı (ses odasına yeni girilmedi, bağlantı yeni kurulmadı, yenileme değil)
        var nowMs = Date.now()
        info.fresh = !again && nowMs - st.joinedAt > SHARE_FRESH_MS && peer.connectedAt > 0 && nowMs - peer.connectedAt > SHARE_FRESH_MS
        screenEvent(Object.assign({ type: 'share-start' }, info))
        delete st.rewatch[pid]
        if (again) {
          watchPid(pid)
          return
        }
      } else if (rs.audio !== m.audio || rs.hint !== m.hint || rs.preset !== m.preset) {
        rs.audio = m.audio
        rs.hint = m.hint
        rs.preset = m.preset
        screenEvent(Object.assign({ type: 'share-update' }, info))
      }
      refreshRemote(pid)
    }

    // Paylaşan tarafı: izleme isteği veya bırakma. Eski bir paylaşım kimliği için gelen istek yok sayılır.
    async function onWatchSignal (peer, m) {
      var r = st.roster[peer.peerId]
      var sh = st.share
      if (!r) return
      if (m.on) {
        if (!sh || m.id !== sh.id) return
        if ((st.screenLimit[peer.peerId] || 0) >= 2 || peer.rejected.video) {
          // Zarf sınırı yüzünden (bkz. tooLargeRebuild) veya karşı taraf görüntü m satırını reddettiği için
          // (bkz. noteRejected) bu eşe ekran gönderilemiyor
          screenEvent({ type: 'error', code: 'screen_negotiation_failed', userId: r.userId, peerId: peer.peerId })
          return
        }
        if (peer.viewing !== sh.id) {
          peer.viewing = sh.id
          screenEvent({ type: 'viewer-join', userId: r.userId, peerId: peer.peerId })
          emit()
        }
      } else {
        if (!peer.viewing || peer.viewing !== m.id) return
        peer.viewing = null
        screenEvent({ type: 'viewer-leave', userId: r.userId, peerId: peer.peerId })
        emit()
      }
      await syncSendersNow(peer)
    }

    // Karşı tarafın ekran izi. Alıcı izi bağlantı boyunca kalır (paylaşım bitince de), bu yüzden olaylar o anki
    // uzak paylaşıma uygulanır. Görüntü izinin 'mute' olayı görüntünün kesildiğidir. 'unmute' akış kanıtı sayılmaz:
    // Chromium 141'de uzak görüntü izi 'track' olayından hemen sonra hiç paket gelmeden de 'unmute' oluyor
    // (ölçüldü), akış alıcı istatistiğiyle doğrulanır (probeFlow, refreshRemote başlatır).
    function onScreenTrack (peer, role, track) {
      if (peer.rx[role] === track) return
      peer.rx[role] = track
      var pid = peer.peerId
      var update = function (e) {
        if (st.peers[pid] !== peer || peer.rx[role] !== track) return
        var rs = st.remote[pid]
        if (rs && role === 'video' && e && e.type === 'mute' && st.watchWant[pid] === rs.id) rs.flow = false
        refreshRemote(pid)
      }
      try {
        track.addEventListener('unmute', update)
        track.addEventListener('mute', update)
        track.addEventListener('ended', update)
      } catch (e) {}
      refreshRemote(pid)
    }

    function receiverOf (peer, track) {
      var list = []
      try {
        list = typeof peer.pc.getReceivers === 'function' ? peer.pc.getReceivers() : []
      } catch (e) {
        list = []
      }
      var i = 0
      while (i < list.length) {
        if (list[i].track === track) return list[i]
        i++
      }
      return null
    }

    // Alınan görüntünün sayacı (çözülen kare, yoksa paket). İstatistik okunamazsa null. Alıcı istatistiği
    // (RTCRtpReceiver.getStats) olan tarayıcıda görüntü raporu ilk paketten önce yoktur, bu durumda 0 döner
    // (henüz görüntü yok). Yalnız eski bağlantı istatistiği olan tarayıcıda rapor yoksa null (okunamadı).
    function readFrames (peer, track) {
      var job = null
      var byReceiver = false
      try {
        var rc = receiverOf(peer, track)
        if (rc && typeof rc.getStats === 'function') {
          job = rc.getStats()
          byReceiver = true
        } else if (typeof peer.pc.getStats === 'function') {
          job = peer.pc.getStats(track)
        }
      } catch (e) {
        job = null
      }
      if (!job) return Promise.resolve(null)
      return Promise.resolve(job).then(function (rep) {
        var n = null
        rep.forEach(function (r) {
          if (r.type !== 'inbound-rtp' || (r.kind || r.mediaType) !== 'video') return
          var v = isNum(r.framesDecoded) ? r.framesDecoded : (isNum(r.packetsReceived) ? r.packetsReceived : null)
          if (v !== null) n = (n || 0) + v
        })
        return n === null && byReceiver ? 0 : n
      }, function () {
        return null
      })
    }

    function clearProbe (rs) {
      if (rs.probe) clearTimeout(rs.probe.timer)
      rs.probe = null
    }

    // Alıcı izi sessiz değilken görüntünün gerçekten geldiği alıcı istatistiğindeki artıştan anlaşılır (iz paket
    // gelmeden 'unmute' olabilir, önceki paylaşımdan kalan iz Chromium'da birkaç saniye sessize geçmeyebilir).
    // İstatistik okunamayan tarayıcıda izin sessiz olmaması yeterli sayılır. Yoklama iz sessize geçince durur
    // (refreshRemote), failed durumunda da sürer: görüntü sonradan gelirse durum live olur.
    function probeFlow (pid, rs) {
      clearProbe(rs)
      var probe = { timer: null, base: null, track: null }
      rs.probe = probe
      var active = function () {
        var peer = st.peers[pid]
        return rs.probe === probe && st.remote[pid] === rs && st.watchWant[pid] === rs.id && !!peer && !peer.closed
      }
      var step = function () {
        probe.timer = null
        if (!active()) {
          if (rs.probe === probe) rs.probe = null
          return
        }
        var peer = st.peers[pid]
        var vt = usableTrack(peer.rx.video)
        if (vt !== probe.track) {
          probe.track = vt
          probe.base = null
        }
        if (!vt) {
          probe.timer = setTimeout(step, FLOW_PROBE_MS)
          return
        }
        readFrames(peer, vt).then(function (n) {
          if (!active()) return
          if (n === null) {
            rs.probe = null
            rs.flow = !vt.muted
            refreshRemote(pid)
            return
          }
          if (probe.base !== null && n > probe.base) {
            rs.probe = null
            rs.flow = true
            refreshRemote(pid)
            return
          }
          if (probe.base === null || n < probe.base) probe.base = n
          probe.timer = setTimeout(step, FLOW_PROBE_MS)
        })
      }
      step()
    }

    function usableTrack (t) {
      return t && t.readyState !== 'ended' ? t : null
    }

    function setStreamTracks (stream, tracks) {
      try {
        stream.getTracks().forEach(function (t) {
          if (tracks.indexOf(t) < 0) stream.removeTrack(t)
        })
        tracks.forEach(function (t) {
          if (stream.getTracks().indexOf(t) < 0) stream.addTrack(t)
        })
      } catch (e) {}
    }

    function attachScreenAudio (rs, track) {
      if (rs.audioEl && rs.audioTrack === track) return
      var a = rs.audioEl
      if (!a) {
        a = document.createElement('audio')
        a.autoplay = true
        a.setAttribute('playsinline', '')
        a.playsInline = true
        a.setAttribute('data-screen-audio', '')
        ensureContainer().appendChild(a)
        rs.audioEl = a
      }
      rs.audioTrack = track
      a.srcObject = new MediaStream([track])
      playAudio(a)
    }

    function removeScreenAudio (rs) {
      var a = rs.audioEl
      rs.audioEl = null
      rs.audioTrack = null
      if (!a) return
      try {
        a.pause()
      } catch (e) {}
      try {
        a.srcObject = null
      } catch (e) {}
      if (a.parentNode) a.parentNode.removeChild(a)
    }

    // İzlenen paylaşımın görüntü akışı (yalnız görüntü izi) ve ayrı ses öğesi burada kurulur ve kaldırılır.
    // Durum: izlenmiyorsa available, görüntü karesi geliyorsa live, beklerken requested.
    function refreshRemote (pid) {
      var rs = st.remote[pid]
      if (!rs) return
      var peer = st.peers[pid]
      var linked = !!(peer && !peer.closed)
      var watching = st.watchWant[pid] === rs.id
      var vt = watching && linked ? usableTrack(peer.rx.video) : null
      var at = watching && linked && rs.audio ? usableTrack(peer.rx.audio) : null
      if (vt) {
        if (!rs.stream) rs.stream = new MediaStream()
        setStreamTracks(rs.stream, [vt])
      } else if (rs.stream) {
        setStreamTracks(rs.stream, [])
      }
      if (at) {
        attachScreenAudio(rs, at)
        applyScreenAudio(pid)
      } else {
        removeScreenAudio(rs)
      }
      if (!watching || !vt || vt.muted) {
        if (!watching) rs.flow = false
        clearProbe(rs)
      } else if (!rs.flow && !rs.probe) {
        probeFlow(pid, rs)
      }
      setWatch(pid, rs, watching ? (vt && rs.flow && !vt.muted ? 'media' : 'nomedia') : 'unwatch')
      emit()
    }

    // İzleme durumu geçişi (watchStep), değişince 'watch-state' olayı. Canlıya geçince bekleme süresi biter,
    // görüntü kesilince (live -> requested) yeniden başlar: süresinde gelmezse failed.
    function setWatch (pid, rs, ev) {
      var next = watchStep(rs.watch, ev)
      if (next === rs.watch) return
      var prev = rs.watch
      rs.watch = next
      if (next === 'live' || next === 'available') clearWatchTimer(rs)
      if (next === 'requested' && prev === 'live') armWatchTimer(pid, rs)
      screenEvent({ type: 'watch-state', userId: rs.userId, peerId: pid, id: rs.id, status: next })
      emit()
    }

    function clearWatchTimer (rs) {
      if (rs.watchTimer) clearTimeout(rs.watchTimer)
      rs.watchTimer = null
    }

    // İstekten sonra süresinde görüntü gelmezse durum failed olur (yeniden izlenebilir)
    function armWatchTimer (pid, rs) {
      clearWatchTimer(rs)
      rs.watchTimer = setTimeout(function () {
        rs.watchTimer = null
        if (st.remote[pid] !== rs || rs.watch !== 'requested') return
        clearProbe(rs)
        setWatch(pid, rs, 'timeout')
        screenEvent({ type: 'error', code: 'screen_watch_failed', userId: rs.userId, peerId: pid })
      }, WATCH_TIMEOUT_MS)
    }

    function dropRemote (pid, reason) {
      var rs = st.remote[pid]
      delete st.watchWant[pid]
      if (!rs) return
      delete st.remote[pid]
      clearWatchTimer(rs)
      clearProbe(rs)
      if (rs.stream) setStreamTracks(rs.stream, [])
      removeScreenAudio(rs)
      screenEvent({ type: 'share-stop', userId: rs.userId, peerId: pid, id: rs.id, reason: reason })
      emit()
    }

    function remotePidOf (userId) {
      var uid = normId(userId)
      if (uid === null) return null
      var found = null
      Object.keys(st.remote).forEach(function (pid) {
        if (!found && st.remote[pid].userId === uid && st.roster[pid]) found = pid
      })
      return found
    }

    // İzleme isteği. Dönüş: null veya hata kodu ('not_in_voice', 'no_share'). Birden çok paylaşım aynı anda
    // izlenebilir, hangisinin gösterileceğini arayüz seçer.
    function watchScreen (userId) {
      if (!st.inVoice) return 'not_in_voice'
      return watchPid(remotePidOf(userId))
    }

    function watchPid (pid) {
      var peer = pid ? st.peers[pid] : null
      if (!pid || !peer || peer.closed || !st.remote[pid]) return 'no_share'
      var rs = st.remote[pid]
      var again = st.watchWant[pid] === rs.id
      st.watchWant[pid] = rs.id
      if (!again || rs.watch !== 'live') {
        // Yeni istek: görüntünün geldiği istekten sonra yeniden doğrulanır
        rs.flow = false
        clearProbe(rs)
      }
      setWatch(pid, rs, 'watch')
      if (rs.watch === 'requested') armWatchTimer(pid, rs)
      if (!again || rs.watch !== 'live') sendSignal(peer, { type: 'watch', on: true, id: rs.id })
      refreshRemote(pid)
      return null
    }

    function unwatchScreen (userId) {
      if (!st.inVoice) return 'not_in_voice'
      var pid = remotePidOf(userId)
      if (!pid) return 'no_share'
      var rs = st.remote[pid]
      var peer = st.peers[pid]
      var was = st.watchWant[pid] === rs.id
      delete st.watchWant[pid]
      clearWatchTimer(rs)
      if (was && peer && !peer.closed) sendSignal(peer, { type: 'watch', on: false, id: rs.id })
      refreshRemote(pid)
      return null
    }

    function getScreenStream (userId) {
      var pid = remotePidOf(userId)
      if (!pid) return null
      var rs = st.remote[pid]
      return st.watchWant[pid] === rs.id && rs.stream && rs.stream.getVideoTracks().length ? rs.stream : null
    }

    function setScreenVolume (userId, volume) {
      var uid = normId(userId)
      var n = Number(volume)
      if (uid === null || !isFinite(n)) return
      n = clamp(n, 0, 1)
      if (n === 1) {
        delete st.screenVolumes[uid]
      } else if (uid in st.screenVolumes || Object.keys(st.screenVolumes).length < MAX_STORED_USERS) {
        st.screenVolumes[uid] = n
      }
      savePeers()
      applyAllAudio()
      emit()
    }

    function setScreenMuted (userId, value) {
      var uid = normId(userId)
      if (uid === null) return
      if (value) {
        if (uid in st.screenMutes || Object.keys(st.screenMutes).length < MAX_STORED_USERS) st.screenMutes[uid] = true
      } else {
        delete st.screenMutes[uid]
      }
      applyAllAudio()
      emit()
    }

    // Kamera. Yerel kamera izi ekran paylaşımı gibi mevcut ses bağlantılarına ek bir aktarıcıyla eklenir, ama
    // izlemek istenmesi beklenmez: kamera açıkken odadaki herkese gider. Hangi m satırının kamera olduğu şifreli
    // 'camera' sinyaliyle bildirilir (ekran ve kamera aktarıcıları ayrı tutulur, iki yönde ortak kullanılır).
    // Kameranın açık olduğu bilgisi sunucudan geçer (POST /api/voice/camera), sunucu oda başına sınırı ve sahibin
    // ayarını uygular. Kamera düğmeye basılmadan hiçbir zaman istenmez.

    function cameraEvent (code, userId) {
      if (!onCameraEvent) return
      Promise.resolve().then(function () {
        try {
          onCameraEvent({ type: 'error', code: code, userId: userId === undefined ? null : userId })
        } catch (e) {
          setTimeout(function () { throw e }, 0)
        }
      })
    }

    // Karşı tarafın kamera olarak bildirdiği aktarıcı mı
    function isCamTransceiver (peer, t) {
      return !!t && t !== peer.micT && peer.camMid !== null && t.mid === peer.camMid
    }

    function camReceiverTrack (peer) {
      if (!peer || peer.closed || peer.camMid === null) return null
      var list = transceiversOf(peer.pc)
      var i = 0
      while (i < list.length) {
        var t = list[i]
        i++
        if (isCamTransceiver(peer, t) && t.receiver && t.receiver.track && t.receiver.track.kind === 'video') return t.receiver.track
      }
      return null
    }

    // Kamera dışındaki uzak görüntü izi (ekran paylaşımı)
    function otherVideoTrack (peer) {
      var list = transceiversOf(peer.pc)
      var found = null
      list.forEach(function (t) {
        if (found || t === peer.micT || isCamTransceiver(peer, t) || isStopped(t)) return
        var tr = t.receiver && t.receiver.track
        if (tr && tr.kind === 'video' && tr.readyState !== 'ended') found = tr
      })
      return found
    }

    function remoteCamStream (peer) {
      if (!peer || peer.closed || !peer.camOn) return null
      var track = usableTrack(camReceiverTrack(peer))
      if (!track) return null
      if (!peer.camStream) peer.camStream = new MediaStream()
      setStreamTracks(peer.camStream, [track])
      return peer.camStream
    }

    function onCameraSignal (peer, m) {
      peer.camOn = m.on
      if (m.on) peer.camMid = m.mid
      // Kamera izi daha önce ekran izi sanıldıysa ekran izi düzeltilir
      var cam = camReceiverTrack(peer)
      if (cam && peer.rx.video === cam) {
        peer.rx.video = otherVideoTrack(peer)
        refreshRemote(peer.peerId)
      }
      emit()
    }

    // Kamera için kullanılabilecek mevcut aktarıcı: mikrofon ve ekran dışı, görüntü türünde, göndericisi boş
    function adoptCamTransceiver (peer, track) {
      if (!peer.micT) return null
      var list = transceiversOf(peer.pc)
      var i = 0
      while (i < list.length) {
        var t = list[i]
        i++
        if (t === peer.micT || t === peer.scrT.video || t === peer.scrT.audio || isStopped(t) || kindOf(t) !== 'video' || !t.sender) continue
        if (t.sender.track && t.sender.track !== track) continue
        return t
      }
      return null
    }

    // Bu eşe gönderilen kamera izi: kamera açıkken ve ilk anlaşma tamamlanmışken. Eş işlemleri içinde (runOp).
    async function syncCameraNow (peer) {
      var cam = st.camera
      var track = cam && peer.ready && !peer.camRejected && !st.camBlocked[peer.peerId] ? cam.track : null
      var t = peer.camT
      if (!track) {
        if (t && t.sender && t.sender.track) {
          await replaceSender(t.sender, null)
          if (t.mid !== null) await deactivateEncoding(t.sender)
        }
        return
      }
      if (!t) t = adoptCamTransceiver(peer, track)
      if (t) {
        peer.camT = t
        if (!sendsDir(t.direction)) {
          try {
            t.direction = 'sendrecv'
            peer.wantNego = true
          } catch (e) {}
        }
        if (t.sender.track !== track) await replaceSender(t.sender, track)
        return
      }
      var sender = null
      try {
        sender = peer.pc.addTrack(track, cam.stream)
      } catch (e) {
        sender = null
      }
      peer.camT = sender ? transceiverOf(peer.pc, sender) : null
      if (peer.camT) applyCodecPrefs(peer.camT, 'video')
    }

    // Anlaşma kararlıyken karşı tarafa kameranın mid'i (veya kapandığı) bildirilir, kodlama sınırı uygulanır
    async function announceCamera (peer) {
      if (peer.closed || !peer.ready || peer.pc.signalingState !== 'stable') return
      var cam = st.camera
      var t = peer.camT
      var live = !!(cam && t && t.mid !== null && t.sender && t.sender.track === cam.track && !isStopped(t))
      var want = live ? t.mid : null
      if (live) await setEncoding(t.sender, cameraEncoding())
      if (peer.closed || want === peer.camSent) return
      peer.camSent = want
      sendSignal(peer, want !== null ? { type: 'camera', on: true, mid: want } : { type: 'camera', on: false })
    }

    // Açık bilgisi sunucuya sırayla gider (açma ve kapatma birbirini geçmesin). Dönüş: { ok, code, text }
    function postCamera (on) {
      var job = st.cameraPost.then(function () {
        return callApi('POST', '/api/voice/camera', { on: on })
      }).then(function (res) {
        var data = res && res.data && typeof res.data === 'object' ? res.data : null
        var okStatus = !!res && typeof res.status === 'number' && res.status >= 200 && res.status < 300
        if (okStatus) return { ok: true, code: null, text: null }
        var code = data && typeof data.code === 'string' && CODE_RE.test(data.code) ? data.code : 'camera_failed'
        var text = data && typeof data.error === 'string' && data.error ? data.error.slice(0, MAX_SERVER_TEXT) : null
        return { ok: false, code: code, text: text }
      }, function () {
        return { ok: false, code: 'camera_failed', text: null }
      })
      st.cameraPost = job.then(noop, noop)
      return job
    }

    // İdeal kısıtları tanımayan tarayıcıda yalın istekle denenir
    async function getCamera () {
      var md = navigator.mediaDevices
      try {
        return await md.getUserMedia(cameraConstraints(st.cameraPick))
      } catch (e) {
        if (!e || (e.name !== 'TypeError' && e.name !== 'OverconstrainedError')) throw e
      }
      return md.getUserMedia({ audio: false, video: true })
    }

    // Kamerayı açar: önce sunucudan yer istenir (sınır doluysa kamera hiç açılmaz), sonra kamera istenir.
    // Dönüş: Promise<null>, ret Error.code ile (camera_limit, camera_disabled, camera_denied ...).
    function startCamera () {
      var sup = cameraSupport()
      if (!sup.ok) return Promise.reject(makeError(sup.reason))
      if (!st.inVoice) return Promise.reject(makeError('not_in_voice'))
      if (st.camera) return Promise.resolve(null)
      if (st.cameraStarting) return st.cameraStarting
      var gen = st.gen
      var cgen = ++st.cameraGen
      var stale = function () {
        return gen !== st.gen || cgen !== st.cameraGen || !st.inVoice
      }
      var job = (async function () {
        var res = await postCamera(true)
        if (stale()) throw makeError('cancelled')
        if (!res.ok) throw makeError(CAMERA_ERRORS.indexOf(res.code) >= 0 ? res.code : 'camera_failed', res.text)
        var stream = null
        try {
          stream = await getCamera()
        } catch (e) {
          if (!stale()) postCamera(false)
          throw makeError(cameraErrorCode(e))
        }
        if (stale()) {
          stopStream(stream)
          throw makeError('cancelled')
        }
        beginCamera(stream)
        return null
      })()
      st.cameraError = null
      st.cameraSeen = false
      st.cameraStarting = job
      emit()
      return job.then(function (v) {
        if (st.cameraStarting === job) st.cameraStarting = null
        emit()
        return v
      }, function (e) {
        if (st.cameraStarting === job) {
          st.cameraStarting = null
          if (e.code !== 'cancelled') st.cameraError = e.code
          emit()
        }
        throw e
      })
    }

    function beginCamera (stream) {
      var cam = cameraFrom(stream, null)
      if (!cam) {
        postCamera(false)
        throw makeError('camera_failed')
      }
      st.camera = cam
      syncAllSenders()
      watchCameraDevices()
      emit()
    }

    // Akıştaki görüntü izinden kamera kaydı. İz yoksa veya bitmişse null (akış bırakılır). asked: değiştirirken
    // istenen yön, iz yönünü bildirmezse o kabul edilir.
    function cameraFrom (stream, asked) {
      var track = stream.getVideoTracks()[0] || null
      stream.getTracks().forEach(function (t) {
        if (t !== track) stopTrack(t)
      })
      if (!track || track.readyState === 'ended') {
        if (track) stopTrack(track)
        return null
      }
      try {
        if ('contentHint' in track) track.contentHint = 'motion'
      } catch (e) {}
      try {
        if (typeof track.applyConstraints === 'function') Promise.resolve(track.applyConstraints(cameraTrackConstraints())).catch(noop)
      } catch (e) {}
      var settings = null
      var caps = null
      try {
        settings = typeof track.getSettings === 'function' ? track.getSettings() : null
      } catch (e) {}
      try {
        caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : null
      } catch (e) {}
      var facing = cameraFacingOf(settings, caps, track.label) || asked || null
      var deviceId = settings && typeof settings.deviceId === 'string' && settings.deviceId ? settings.deviceId : null
      var cam = { track: track, stream: new MediaStream([track]), preview: new MediaStream([track]), onEnded: null, facing: facing, deviceId: deviceId }
      // Kamera çıkarıldı veya başka uygulama aldı
      cam.onEnded = function () {
        if (st.camera !== cam) return
        st.cameraError = 'camera_lost'
        stopCamera('ended', false)
      }
      track.addEventListener('ended', cam.onEnded)
      return cam
    }

    // Bu cihazdaki kameraların kimlikleri (izin alındıktan sonra dolu gelir). Okunamazsa boş dizi.
    function cameraDeviceIds () {
      var md = navigator.mediaDevices
      if (!md || typeof md.enumerateDevices !== 'function') return Promise.resolve([])
      return Promise.resolve().then(function () {
        return md.enumerateDevices()
      }).then(function (list) {
        var ids = []
        if (list && typeof list.forEach === 'function') {
          list.forEach(function (d) {
            if (d && d.kind === 'videoinput' && typeof d.deviceId === 'string' && d.deviceId && ids.indexOf(d.deviceId) < 0) ids.push(d.deviceId)
          })
        }
        return ids
      }, function () {
        return []
      })
    }

    // Kamera değiştirme düğmesi yalnızca birden çok kamera varken görünür. Kamera açıkken cihaz takılıp
    // çıkarılınca yeniden sayılır.
    function refreshCameraDevices () {
      var cam = st.camera
      if (!cam) return Promise.resolve()
      return cameraDeviceIds().then(function (ids) {
        if (st.camera !== cam) return
        var can = ids.length >= 2
        if (can === st.cameraCanSwitch) return
        st.cameraCanSwitch = can
        emit()
      })
    }

    function watchCameraDevices () {
      refreshCameraDevices()
      var md = navigator.mediaDevices
      if (st.cameraDevicesWatch || !md || typeof md.addEventListener !== 'function') return
      st.cameraDevicesWatch = function () { refreshCameraDevices() }
      try {
        md.addEventListener('devicechange', st.cameraDevicesWatch)
      } catch (e) {
        st.cameraDevicesWatch = null
      }
    }

    function unwatchCameraDevices () {
      var fn = st.cameraDevicesWatch
      st.cameraDevicesWatch = null
      st.cameraCanSwitch = false
      if (!fn) return
      try {
        navigator.mediaDevices.removeEventListener('devicechange', fn)
      } catch (e) {}
    }

    // Süre sınırlı kamera isteği: süre dolarsa TimeoutError ile reddedilir, sonradan gelen akış bırakılır
    function cameraWithin (constraints, ms) {
      return new Promise(function (resolve, reject) {
        var settled = false
        var timer = setTimeout(function () {
          if (settled) return
          settled = true
          var e = new Error('camera timeout')
          e.name = 'TimeoutError'
          reject(e)
        }, ms)
        Promise.resolve().then(function () {
          return navigator.mediaDevices.getUserMedia(constraints)
        }).then(function (stream) {
          if (settled) {
            stopStream(stream)
            return
          }
          settled = true
          clearTimeout(timer)
          resolve(stream)
        }, function (e) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          reject(e)
        })
      })
    }

    // Değiştirirken yeni kamera eski kamera açıkken istenir (görüntü kesilmesin). Aynı anda iki kamerayı açamayan
    // cihazda (çoğu telefon) istek reddedilir veya yanıtsız kalır: eski kamera bırakılıp yeniden denenir,
    // cam.released bunu kaydeder. Böyle bir cihazda sonraki değiştirmeler eski kamerayı baştan bırakır
    // (st.cameraExclusive), her seferinde bekleme süresi dolmaz.
    async function openSwitchCamera (cam, opt) {
      if (!cam.released && !st.cameraExclusive) {
        try {
          return await cameraWithin(cameraConstraints(opt), CAMERA_SWITCH_WAIT_MS)
        } catch (e) {
          var name = e && e.name
          if (name !== 'NotReadableError' && name !== 'TrackStartError' && name !== 'AbortError' && name !== 'TimeoutError') throw e
        }
        st.cameraExclusive = true
      }
      if (!cam.released) {
        cam.released = true
        stopTrack(cam.track)
      }
      return cameraWithin(cameraConstraints(opt), CAMERA_OPEN_WAIT_MS)
    }

    // Ön ve arka kamera (bilgisayarda sıradaki kamera) arasında geçer. Eşlere giden iz yeni izle değiştirilir,
    // anlaşma gerekmez. Yeni kamera açılamazsa eski kamera sürer, eski kamera bırakılmışsa yeniden açılır, o da
    // açılamazsa kamera kapanır (camera_lost). Dönüş: Promise<null>, ret Error.code ile.
    function switchCamera () {
      var cam = st.camera
      if (!cam) return Promise.reject(makeError(st.cameraStarting ? 'cancelled' : 'camera_failed'))
      if (st.cameraSwitching) return st.cameraSwitching
      var gen = st.gen
      var cgen = st.cameraGen
      var stale = function () {
        return gen !== st.gen || cgen !== st.cameraGen || st.camera !== cam || !st.inVoice
      }
      var job = (async function () {
        var ids = await cameraDeviceIds()
        if (stale()) throw makeError('cancelled')
        var targets = cameraSwitchTargets(cam.facing, cam.deviceId, ids)
        if (!targets.length) throw makeError('camera_not_found')
        // Bırakılan eski iz 'ended' olayıyla kamerayı kapatmasın
        try {
          cam.track.removeEventListener('ended', cam.onEnded)
        } catch (e) {}
        var stream = null
        var used = null
        var err = null
        var i = 0
        while (i < targets.length && !stream) {
          try {
            stream = await openSwitchCamera(cam, targets[i])
            used = targets[i]
          } catch (e) {
            err = e
            var name = e && e.name
            if (stale() || (name !== 'OverconstrainedError' && name !== 'NotFoundError')) break
          }
          i++
        }
        if (stale()) {
          stopStream(stream)
          throw makeError('cancelled')
        }
        var next = stream ? cameraFrom(stream, used.facing || null) : null
        if (!next) {
          await restoreCamera(cam, stale)
          // Kamera bu arada kapandıysa (yeniden açılamadı veya kullanıcı kapattı) hata ayrıca bildirilmez
          if (gen !== st.gen || cgen !== st.cameraGen) throw makeError('cancelled')
          throw makeError(err ? cameraErrorCode(err) : 'camera_failed')
        }
        try {
          cam.track.removeEventListener('ended', cam.onEnded)
        } catch (e) {}
        stopTrack(cam.track)
        st.camera = next
        st.cameraPick = next.facing ? { facing: next.facing } : next.deviceId ? { deviceId: next.deviceId } : null
        syncAllSenders()
        refreshCameraDevices()
        return null
      })()
      var run = job.then(function (v) {
        done()
        return v
      }, function (e) {
        done()
        throw e
      })
      var done = function () {
        if (st.cameraSwitching !== run) return
        st.cameraSwitching = null
        emit()
      }
      st.cameraSwitching = run
      emit()
      return run
    }

    // Değiştirme başarısız: eski iz canlıysa olduğu gibi sürer, bırakılmışsa aynı kamera yeniden istenir
    async function restoreCamera (cam, stale) {
      if (!cam.released && cam.track.readyState !== 'ended') {
        cam.track.addEventListener('ended', cam.onEnded)
        return
      }
      var stream = null
      try {
        stream = await cameraWithin(cameraConstraints(cam.deviceId ? { deviceId: cam.deviceId } : { facing: cam.facing }), CAMERA_OPEN_WAIT_MS)
      } catch (e) {
        stream = null
      }
      if (stale()) {
        stopStream(stream)
        return
      }
      var again = stream ? cameraFrom(stream, cam.facing) : null
      if (!again) {
        st.cameraError = 'camera_lost'
        stopCamera('ended', false)
        return
      }
      st.camera = again
      syncAllSenders()
    }

    // Kamerayı kapatır. silent: oturum kapanıyor (sunucu ve eşler zaten bırakılıyor), istek ve sinyal gitmez.
    function stopCamera (reason, silent) {
      var why = CAMERA_STOP_REASONS.indexOf(reason) >= 0 ? reason : 'user'
      st.cameraGen++
      var starting = !!st.cameraStarting
      st.cameraStarting = null
      var cam = st.camera
      st.camera = null
      st.cameraSeen = false
      st.cameraSwitching = null
      unwatchCameraDevices()
      if (cam) {
        try {
          cam.track.removeEventListener('ended', cam.onEnded)
        } catch (e) {}
        stopTrack(cam.track)
      }
      if (!cam && !starting) return
      if (!silent && st.inVoice && why !== 'server' && why !== 'disabled') postCamera(false)
      if (!silent) syncAllSenders()
      emit()
    }

    // Metada kendi kameramız: sunucu kapattıysa (sahip kameraları kapattı veya ses odası denetimiyle kapatıldı) yerel
    // kamera da durur, açılmakta olan kamera iptal edilir. Açılıştan önce üretilmiş eski bir meta yanlışlıkla durdurmasın
    // diye kamera metada önce açık görülmüş olmalıdır. Sunucu açık bilgisini kamera istenmeden önce aldığı için bu meta
    // çoğunlukla kamera açılırken gelir, o da sayılır.
    function checkOwnCamera (meta, list) {
      if (!st.camera && !st.cameraStarting) return
      var settings = meta && meta.voiceSettings && typeof meta.voiceSettings === 'object' ? meta.voiceSettings : null
      if (settings && settings.cameras === false) {
        st.cameraError = 'camera_disabled'
        stopCamera('disabled', false)
        return
      }
      var mine = null
      list.forEach(function (m) {
        if (m && m.peerId === st.myPeerId) mine = m
      })
      if (!mine) return
      if (mine.camera === true) {
        st.cameraSeen = true
      } else if (st.cameraSeen) {
        st.cameraError = 'camera_moderated'
        stopCamera('server', false)
      }
    }

    // Bu cihazın bağlantılarında tarayıcının tahmin ettiği gönderim hızı (availableOutgoingBitrate, kbps). Yalnızca
    // bu cihazın kendi ölçümüdür, sunucuya veya başka birine gönderilmez. Ölçüm yoksa null.
    function uplinkEstimate () {
      var jobs = []
      Object.keys(st.peers).forEach(function (pid) {
        var p = st.peers[pid]
        if (p.closed || p.status !== 'connected' || typeof p.pc.getStats !== 'function') return
        try {
          jobs.push(Promise.resolve(p.pc.getStats()).then(function (rep) {
            var best = null
            rep.forEach(function (r) {
              if (r.type !== 'candidate-pair' || !isNum(r.availableOutgoingBitrate)) return
              if (r.nominated === false && r.selected !== true) return
              if (best === null || r.availableOutgoingBitrate > best) best = r.availableOutgoingBitrate
            })
            return best
          }, function () {
            return null
          }))
        } catch (e) {}
      })
      return Promise.all(jobs).then(function (list) {
        var best = null
        list.forEach(function (v) {
          if (v !== null && (best === null || v > best)) best = v
        })
        return best === null ? null : Math.min(UPLINK_MAX_KBPS, Math.round(best / 1000))
      })
    }

    // Kadro (meta)
    function parseMember (m) {
      if (!m || typeof m !== 'object' || !isPeerId(m.peerId)) return null
      var uid = normId(m.userId)
      if (uid === null) return null
      if (st.myUserId !== null && uid === st.myUserId) return null
      return { peerId: m.peerId, userId: uid, muted: m.muted === true, deafened: m.deafened === true, camera: m.camera === true }
    }

    function addMembers (list) {
      if (!Array.isArray(list)) return
      var now = Date.now()
      list.slice(0, MAX_ROSTER).forEach(function (m) {
        var e = parseMember(m)
        if (!e || e.peerId === st.myPeerId) return
        st.roster[e.peerId] = { userId: e.userId, muted: e.muted, deafened: e.deafened, camera: e.camera, since: now, noOffer: false }
      })
    }

    function applyRoster (meta) {
      if (!st.inVoice || !meta || typeof meta !== 'object') return
      var voice = meta.voice && typeof meta.voice === 'object' ? meta.voice : {}
      var list = voice[String(st.channelId)]
      if (!Array.isArray(list)) list = []
      list = list.slice(0, MAX_ROSTER)
      var selfIn = list.some(function (m) { return m && m.peerId === st.myPeerId })
      var now = Date.now()
      if (!selfIn) {
        // Katılmadan önce üretilmiş eski bir meta olabilir, kısa süre yok sayılır
        if (st.seenSelf || now - st.joinedAt > SELF_GRACE_MS) dropped()
        return
      }
      st.seenSelf = true
      checkOwnCamera(meta, list)
      var next = Object.create(null)
      var added = false
      var removed = false
      list.forEach(function (m) {
        var e = parseMember(m)
        if (!e || e.peerId === st.myPeerId) return
        var prev = st.roster[e.peerId]
        if (!prev) added = true
        next[e.peerId] = {
          userId: e.userId,
          muted: e.muted,
          deafened: e.deafened,
          camera: e.camera,
          since: prev ? prev.since : now,
          noOffer: prev ? prev.noOffer : false
        }
      })
      Object.keys(st.roster).forEach(function (pid) {
        if (next[pid]) return
        removed = true
        if (st.peers[pid]) closePeer(st.peers[pid])
        delete st.ops[pid]
        delete st.sendQueues[pid]
        delete st.rewatch[pid]
        delete st.screenLimit[pid]
        delete st.camBlocked[pid]
      })
      st.roster = next
      applyAllAudio()
      if (st.privateCall) {
        // Özel aramada kendi katılma sesi çalmadığından sessiz süre beklenmez: karşı tarafın katılması aramanın
        // bağlandığını bildirir, ayrılması aramayı bitirir (sunucu bu cihazı da çıkarır, bkz. dropped)
        if (added) playTone('join', true)
      } else if (now - st.joinedAt > OTHER_TONE_QUIET_MS) {
        if (added) playTone('join', true)
        else if (removed) playTone('leave', true)
      }
      processUnknown()
      emit()
    }

    // Herkes için susturulanlar metadaki kullanıcı kayıtlarından okunur
    function applyServerMutes (meta) {
      var next = Object.create(null)
      var users = Array.isArray(meta.users) ? meta.users.slice(0, MAX_STORED_USERS) : []
      users.forEach(function (u) {
        if (!u || typeof u !== 'object' || u.voiceMuted !== true) return
        var uid = normId(u.id)
        if (uid !== null) next[uid] = true
      })
      var self = st.myUserId !== null && next[st.myUserId] === true
      var before = Object.keys(st.serverMutedUsers).sort().join(',')
      var after = Object.keys(next).sort().join(',')
      if (before === after && self === st.serverMuted) return
      st.serverMutedUsers = next
      var selfChanged = self !== st.serverMuted
      st.serverMuted = self
      applyAllAudio()
      if (selfChanged) {
        updateGate(true)
        if (st.inVoice) postState()
      }
      emit()
    }

    function handleMeta (meta, me) {
      if (me && typeof me === 'object') {
        var uid = normId(me.id)
        if (uid !== null) st.myUserId = uid
      }
      if (!meta || typeof meta !== 'object') return
      st.serverAt = Date.now()
      st.lastMeta = meta
      // Hesap düzeyindeki sunucu susturması özel aramaya uzanmaz (aramadan çıkınca son metadan yeniden okunur)
      if (!st.privateCall) applyServerMutes(meta)
      if (st.inVoice) applyRoster(meta)
    }

    // Özel arama kipine giriş: işlevler saklanır, sunucu susturması kayıtları boşaltılır
    function beginPrivate (priv) {
      var wasMuted = st.serverMuted
      st.privateCall = true
      st.privateSeal = priv.seal
      st.privateOpen = priv.open
      st.serverMuted = false
      st.serverMutedUsers = Object.create(null)
      if (wasMuted) updateGate(true)
    }

    // Özel arama kipinden çıkış: işlevler bırakılır, sunucu susturması son metadan yeniden uygulanır
    function endPrivate () {
      if (!st.privateCall) return
      st.privateCall = false
      st.privateSeal = null
      st.privateOpen = null
      if (st.lastMeta) applyServerMutes(st.lastMeta)
    }

    function onGraceEnd () {
      st.graceTimer = null
      if (st.inVoice && !st.seenSelf && st.lastMeta) applyRoster(st.lastMeta)
    }

    // Sunucu ses odasından çıkardı veya bağlantı düştü: ayrılma sesi yerine düşme sesi çalar. Özel aramada
    // sunucunun çıkarması aramanın bittiği anlamına gelir (karşı taraf kapattı, reddetti veya zil süresi doldu):
    // ayrılma sesi çalar, hata kodu 'call_ended' olur.
    function dropped () {
      var wasIn = st.inVoice
      var wasPrivate = st.privateCall
      teardownLocal(false)
      if (wasIn) playTone(wasPrivate ? 'leave' : 'drop', false)
      st.errorCode = wasPrivate ? 'call_ended' : 'kicked'
      st.serverError = null
      emit()
    }

    // Oturum temizliği: bağlantılar, kuyruklar ve kadro (yerel mikrofon korunur)
    // Ses odasından çıkışta, oda değişiminde ve yerel kapatmada ekran paylaşımı da kesin olarak durur
    function resetSession () {
      stopShare('left', true)
      stopCamera('left', true)
      st.camBlocked = Object.create(null)
      Object.keys(st.peers).forEach(function (pid) { closePeer(st.peers[pid]) })
      Object.keys(st.remote).forEach(function (pid) { dropRemote(pid, 'left') })
      st.remote = Object.create(null)
      st.watchWant = Object.create(null)
      st.rewatch = Object.create(null)
      st.screenLimit = Object.create(null)
      st.peers = Object.create(null)
      st.roster = Object.create(null)
      st.ops = Object.create(null)
      st.sendQueues = Object.create(null)
      st.unknown = []
      st.seenSelf = false
      st.stateDirty = false
      if (st.graceTimer) {
        clearTimeout(st.graceTimer)
        st.graceTimer = null
      }
    }

    // Tam yerel kapatma: bağlantılar, ses öğeleri ve kap kaldırılır. Mikrofon testi sürmüyorsa
    // izler durur, hat düğümleri ve zamanlayıcılar temizlenir, ses bağlamı kısa süre sonra kapanır.
    function teardownLocal (withSound) {
      var wasIn = st.inVoice
      st.gen++
      resetSession()
      releaseWakeLock()
      removeContainer()
      st.timers.forEach(function (id) { clearTimeout(id) })
      st.timers.clear()
      st.inVoice = false
      st.joining = false
      st.channelId = null
      st.myPeerId = null
      st.joinPromise = null
      st.lastSigSeq = 0
      st.autoplayBlocked = false
      endPrivate()
      releaseMicIfUnused()
      if (withSound && wasIn) playTone('leave', false)
      scheduleContextClose()
      emit()
    }

    function failEarly (code) {
      st.errorCode = code
      st.serverError = null
      emit()
      return Promise.reject(makeError(code))
    }

    // opts.private (isteğe bağlı): özel mesaj araması için { seal(obj) -> string, open(str) -> { ok, value } }.
    // Verilirse sinyaller bu işlevlerle şifrelenir ve açılır, grup anahtarı gerekmez. Geçersiz verilirse grup
    // anahtarına düşülmez, katılım 'no_key' ile reddedilir.
    function join (channelId, opts) {
      var cid = normId(channelId)
      if (cid === null) return Promise.reject(makeError('bad_channel'))
      var priv = opts && typeof opts === 'object' && opts.private ? opts.private : null
      var privOk = !!priv && typeof priv === 'object' && typeof priv.seal === 'function' && typeof priv.open === 'function'
      if (st.channelId !== null && String(st.channelId) === cid && st.privateCall === privOk) {
        if (st.joining && st.joinPromise) return st.joinPromise
        if (st.inVoice) return Promise.resolve()
      }
      var sup = support()
      if (!sup.ok) return failEarly(sup.reason)
      if (priv !== null && !privOk) return failEarly('no_key')
      if (!privOk) {
        st.kid = probeKid()
        if (!st.kid) return failEarly('no_key')
      }
      // Ses bağlamı kullanıcı etkileşimi sırasında oluşturulur veya sürdürülür
      ensureContext()
      var p = doJoin(channelId, privOk ? { seal: priv.seal, open: priv.open } : null)
      st.joinPromise = p
      var clear = function () {
        if (st.joinPromise === p) st.joinPromise = null
      }
      p.then(clear, clear)
      return p
    }

    async function doJoin (channelId, priv) {
      st.gen++
      var gen = st.gen
      var moving = st.inVoice
      resetSession()
      st.inVoice = false
      st.joining = true
      if (priv) beginPrivate(priv)
      else endPrivate()
      st.channelId = channelId
      st.errorCode = null
      st.serverError = null
      st.lastSigSeq = 0
      st.myPeerId = null
      st.autoplayBlocked = false
      emit()
      if (st.leavePromise) await st.leavePromise
      if (st.joinRequest) await st.joinRequest.then(noop, noop)
      if (gen !== st.gen) return
      try {
        await acquireMic()
      } catch (e) {
        if (gen !== st.gen) return
        var micCode = micErrorCode(e)
        teardownLocal(false)
        st.errorCode = micCode
        emit()
        throw makeError(micCode)
      }
      if (gen !== st.gen) return
      var req = callApi('POST', '/api/voice/join', { channelId: channelId })
      st.joinRequest = req
      var res = null
      try {
        res = await req
      } catch (e) {
        res = null
      }
      if (st.joinRequest === req) st.joinRequest = null
      if (gen !== st.gen) return
      var data = res && res.data && typeof res.data === 'object' ? res.data : null
      var okStatus = res && typeof res.status === 'number' && res.status >= 200 && res.status < 300
      if (!okStatus || !data || !isPeerId(data.peerId)) {
        var code = data && typeof data.code === 'string' && CODE_RE.test(data.code) ? data.code : 'join_failed'
        var text = data && typeof data.error === 'string' && data.error ? data.error.slice(0, MAX_SERVER_TEXT) : null
        teardownLocal(false)
        st.errorCode = code
        st.serverError = text
        emit()
        if (moving) callApi('POST', '/api/voice/leave', {}).catch(noop)
        throw makeError(code, text)
      }
      st.myPeerId = data.peerId
      st.iceServers = sanitizeIce(data.iceServers)
      st.joining = false
      st.inVoice = true
      st.joinedAt = Date.now()
      st.seenSelf = false
      addMembers(data.members)
      var initial = Object.keys(st.roster)
      requestWakeLock()
      // Özel aramada kendi katılma sesi çalmaz (karşı taraf katılınca çalar, bkz. applyRoster)
      if (!st.privateCall) playTone('join', false)
      postState()
      st.graceTimer = setTimeout(onGraceEnd, SELF_GRACE_MS + 50)
      // Katılım sırasında gelen meta şimdi uygulanır
      if (st.lastMeta) applyRoster(st.lastMeta)
      if (!st.inVoice || gen !== st.gen) return
      initial.forEach(function (pid) {
        if (st.roster[pid]) startInitiator(pid)
      })
      emit()
    }

    async function postLeave (joinReq) {
      if (joinReq) await joinReq.then(noop, noop)
      try {
        await callApi('POST', '/api/voice/leave', {})
      } catch (e) {}
    }

    function leave () {
      if (!st.inVoice && !st.joining) return st.leavePromise || Promise.resolve()
      var joinReq = st.joinRequest
      teardownLocal(true)
      st.errorCode = null
      st.serverError = null
      emit()
      var p = postLeave(joinReq)
      st.leavePromise = p
      p.then(function () {
        if (st.leavePromise === p) st.leavePromise = null
      })
      return p
    }

    function teardown () {
      teardownLocal(false)
      st.errorCode = null
      st.serverError = null
      emit()
    }

    // Mikrofon testi: seste değilken de aynı hattı çalıştırır, eşlere ve hoparlöre hiçbir şey gitmez
    function startMicTest () {
      var sup = support()
      if (!sup.ok) return Promise.reject(makeError(sup.reason))
      ensureContext()
      if (st.testing) return st.testPromise || Promise.resolve()
      st.testing = true
      emit()
      var p = acquireMic().then(function () {
        emit()
      }, function (e) {
        if (e && e.code === 'cancelled') return
        if (st.testing) {
          st.testing = false
          releaseMicIfUnused()
          emit()
        }
        throw makeError(micErrorCode(e))
      })
      st.testPromise = p
      var clear = function () {
        if (st.testPromise === p) st.testPromise = null
      }
      p.then(clear, clear)
      return p
    }

    function stopMicTest () {
      if (!st.testing) return
      st.testing = false
      st.testPromise = null
      releaseMicIfUnused()
      emit()
    }

    // Sunucuya mikrofon ve kulaklık durumu, aynı anda tek istek, son durum kazanır
    function postState () {
      if (!st.inVoice) return
      if (st.statePosting) {
        st.stateDirty = true
        return
      }
      st.statePosting = true
      var gen = st.gen
      var body = { muted: st.muted || st.serverMuted || st.deafened, deafened: st.deafened }
      callApi('POST', '/api/voice/state', body).then(noop, noop).then(function () {
        statePosted(gen)
      })
    }

    // Durum isteği (bildirim veya erişim yoklaması) bitti: arada değişen durum veya yeni oturum yeniden bildirilir
    function statePosted (gen) {
      st.statePosting = false
      var again = st.stateDirty || gen !== st.gen
      st.stateDirty = false
      if (again && st.inVoice) postState()
    }

    function setMuted (value) {
      var v = !!value
      if (!v && st.deafened) {
        // Sağırken mikrofonu açmak sağırlaştırmayı da kaldırır (konuşmak isteyen duyabilmelidir)
        st.deafened = false
        applyAllAudio()
      }
      st.muted = v
      updateGate(true)
      postState()
      emit()
    }

    function setDeafened (value) {
      st.deafened = !!value
      applyAllAudio()
      updateGate(true)
      postState()
      emit()
    }

    function setPeerVolume (userId, volume) {
      var uid = normId(userId)
      var n = Number(volume)
      if (uid === null || !isFinite(n)) return
      n = clamp(n, 0, PEER_VOLUME_MAX)
      if (n === 1) {
        delete st.volumes[uid]
      } else if (uid in st.volumes || Object.keys(st.volumes).length < MAX_STORED_USERS) {
        st.volumes[uid] = n
      }
      savePeers()
      applyAllAudio()
      emit()
    }

    function setPeerLocalMute (userId, value) {
      var uid = normId(userId)
      if (uid === null) return
      if (value) {
        if (uid in st.localMutes || Object.keys(st.localMutes).length < MAX_STORED_USERS) st.localMutes[uid] = true
      } else {
        delete st.localMutes[uid]
      }
      savePeers()
      applyAllAudio()
      emit()
    }

    // Etiketi olmayan cihazlar için label boş döner, arayüz index ile ad üretir
    function listInputDevices () {
      var md = navigator.mediaDevices
      if (!md || typeof md.enumerateDevices !== 'function') return Promise.resolve([])
      return md.enumerateDevices().then(function (list) {
        var n = 0
        return list.filter(function (d) { return d.kind === 'audioinput' }).map(function (d) {
          n++
          return { deviceId: d.deviceId, label: typeof d.label === 'string' ? d.label : '', index: n }
        })
      }, function () {
        return []
      })
    }

    // Seste veya testte ise mikrofon yeniden alınır, hata kodla reddedilir
    function setInputDevice (deviceId) {
      var id = typeof deviceId === 'string' && deviceId && deviceId.length <= 512 ? deviceId : null
      if (id !== st.settings.inputDeviceId) {
        st.settings.inputDeviceId = id
        saveSettings()
        emit()
      }
      return queueReacquire(false)
    }

    // Otomatik oynatma engeli: kullanıcı etkileşimiyle çağrılır
    function unlockAudio () {
      var jobs = []
      if (st.inVoice || st.joining || st.testing) {
        ensureContext()
        if (ctx && typeof ctx.resume === 'function') {
          try {
            jobs.push(Promise.resolve(ctx.resume()))
          } catch (e) {}
        }
      }
      var els = Object.keys(st.peers).map(function (pid) { return st.peers[pid].audio })
      Object.keys(st.remote).forEach(function (pid) { els.push(st.remote[pid].audioEl) })
      els.forEach(function (a) {
        if (!a) return
        try {
          jobs.push(Promise.resolve(a.play()))
        } catch (e) {
          jobs.push(Promise.reject(e))
        }
      })
      return Promise.all(jobs.map(function (j) {
        return j.then(function () { return true }, function () { return false })
      })).then(function (results) {
        var ok = results.every(Boolean)
        if (ok) st.autoplayBlocked = false
        if (st.local) updateMode()
        Object.keys(st.peers).forEach(function (pid) {
          var p = st.peers[pid]
          if (ok && p.stream && !p.analyser) attachAnalyser(p, p.stream)
        })
        emit()
        return ok
      })
    }

    return {
      support: support,
      join: join,
      leave: leave,
      setMuted: setMuted,
      setDeafened: setDeafened,
      setPeerVolume: setPeerVolume,
      setPeerLocalMute: setPeerLocalMute,
      setSettings: setSettings,
      settings: getSettings,
      // Kaynak verilmezse ekrandaki Bas konuş düğmesi, 'external' masaüstü uygulamasının genel kısayolu veya tuş kancası
      pttDown: function (source) { pttPress(source === 'external' ? 'external' : 'touch') },
      pttUp: function (source) { pttRelease(source === 'external' ? 'external' : 'touch') },
      // Bas konuş açılış ve kapanış sesi ('pttOn', 'pttOff'), giriş ve çıkış sesleri ayarına (sounds) uyar
      playCue: function (kind) {
        if (kind === 'pttOn' || kind === 'pttOff') playTone(kind, false)
      },
      captureBinding: captureBinding,
      cancelCapture: cancelCapture,
      bindingLabel: bindingLabel,
      startMicTest: startMicTest,
      stopMicTest: stopMicTest,
      listInputDevices: listInputDevices,
      setInputDevice: setInputDevice,
      handleSignals: handleSignals,
      handleMeta: handleMeta,
      teardown: teardown,
      snapshot: snapshot,
      unlockAudio: unlockAudio,
      // Ekran paylaşımı (Ek L1)
      screenSupport: screenSupport,
      startScreenShare: startScreenShare,
      stopScreenShare: function () { stopShare('user', false) },
      setScreenQuality: setScreenQuality,
      screenSettings: getScreenSettings,
      setScreenSettings: setScreenSettings,
      watchScreen: watchScreen,
      unwatchScreen: unwatchScreen,
      getScreenStream: getScreenStream,
      setScreenVolume: setScreenVolume,
      setScreenMuted: setScreenMuted,
      // Kamera
      cameraSupport: cameraSupport,
      startCamera: startCamera,
      switchCamera: switchCamera,
      stopCamera: function () { stopCamera('user', false) },
      uplinkEstimate: uplinkEstimate
    }
  }

  return {
    create: create,
    support: support,
    bindingLabel: bindingLabel,
    defaultSettings: defaultSettings,
    screenSupport: screenSupport,
    screenPresets: screenPresets,
    screenDefaults: screenDefaults,
    cameraSupport: cameraSupport,
    cameraUtils: {
      errorCodes: CAMERA_ERRORS.slice(),
      size: { width: CAMERA_SIZE.width, height: CAMERA_SIZE.height, frameRate: CAMERA_SIZE.frameRate },
      constraints: cameraConstraints,
      facingOf: cameraFacingOf,
      switchTargets: cameraSwitchTargets,
      switchWaits: { first: CAMERA_SWITCH_WAIT_MS, open: CAMERA_OPEN_WAIT_MS },
      trackConstraints: cameraTrackConstraints,
      encoding: cameraEncoding,
      errorCode: cameraErrorCode,
      validateSignal: validCameraSignal
    },
    // Saf yardımcılar (Node testleri ve arayüz için, durum tutmaz)
    screenUtils: {
      errorCodes: SCREEN_ERRORS.slice(),
      stopReasons: STOP_REASONS.slice(),
      keepCodec: keepScreenCodec,
      options: screenOptions,
      encoding: screenEncoding,
      trackConstraints: trackConstraints,
      displayConstraints: displayConstraints,
      errorCode: screenErrorCode,
      validateSignal: validScreenSignal,
      shareStep: shareStep,
      watchStep: watchStep
    }
  }
})()
