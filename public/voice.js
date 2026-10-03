// Sesli sohbet istemcisi (window.VoiceClient)
// WebRTC tam örgü, yalnızca ses. Sinyaller grup anahtarıyla şifrelenir ve gönderen ile alıcı kimliğine bağlanır,
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
  var CONTEXT_CLOSE_DELAY_MS = 700
  var MAX_UNKNOWN = 50
  var MAX_CANDIDATES = 200
  var MAX_ROSTER = 64
  var MAX_SDP_CHARS = 15000
  var MAX_CANDIDATE_CHARS = 2000
  var MAX_SIGNAL_CHARS = 100000
  var MAX_STORED_USERS = 500
  var MAX_SEEN_PEERS = 256
  var MAX_SEEN_SIDS = 32
  var MAX_SERVER_TEXT = 500
  var SIGNAL_RETRIES = 3
  var STORAGE_KEY = 'telsiz.voice'
  var PEERS_KEY = 'telsiz.voice.peers'
  var ACTIONS = ['ptt', 'toggleMute', 'toggleDeafen']
  var MIC_FLAGS = ['echoCancellation', 'noiseSuppression', 'autoGainControl']
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

  function create (opts) {
    if (!opts || typeof opts.api !== 'function' || typeof opts.seal !== 'function' || typeof opts.open !== 'function') {
      throw new TypeError('VoiceClient.create: api, seal and open functions are required')
    }
    var api = opts.api
    var seal = opts.seal
    var open = opts.open
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : null
    var storage = opts.storage && typeof opts.storage === 'object' ? opts.storage : null
    var ctx = null
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
      // Bas konuş ve atamalar
      held: { key: false, mouse: false, pad: false, touch: false },
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
      stateDirty: false
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

    function callApi (method, path, body) {
      return new Promise(function (resolve, reject) {
        var r
        try {
          r = api(method, path, body)
        } catch (e) {
          reject(e)
          return
        }
        Promise.resolve(r).then(resolve, reject)
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
        copyMap(p.volumes, st.volumes, function (v) { return typeof v === 'number' && v >= 0 && v <= 1 })
        copyMap(p.localMutes, st.localMutes, function (v) { return v === true })
      }
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
      writeStored(PEERS_KEY, { volumes: st.volumes, localMutes: st.localMutes })
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
        outputVolume: s.outputVolume,
        sounds: s.sounds,
        bindings: copyBindings()
      }
    }

    // Geçersiz alanlar yok sayılır. Dönüş: hangi tür değişiklik olduğu
    function mergeSettings (partial) {
      var s = st.settings
      var out = { mic: false, device: false, bindings: false, mode: false }
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
      if (ch.mode || ch.bindings) releaseAll()
      if (ch.bindings) {
        st.padInit = true
        updateMouseGuard()
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

    function applyPeerAudio (peer) {
      var a = peer.audio
      var r = st.roster[peer.peerId]
      if (!a || !r) return
      try {
        a.volume = clamp(st.settings.outputVolume * volumeOf(r.userId), 0, 1)
      } catch (e) {}
      a.muted = st.deafened || st.localMutes[r.userId] === true
    }

    function applyAllAudio () {
      Object.keys(st.peers).forEach(function (pid) { applyPeerAudio(st.peers[pid]) })
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
          muted: r.muted,
          deafened: r.deafened
        }
      })
      var s = st.settings
      var thr = st.level === null ? (s.vadAuto ? null : s.vadThreshold) : currentThreshold()
      var code = st.errorCode || (anyFailed() ? 'connect_failed' : null)
      return {
        channelId: st.channelId,
        joining: st.joining,
        muted: st.muted || st.deafened,
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
        ptt: { enabled: s.inputMode === 'ptt', active: st.pttActive },
        selfSpeaking: st.selfSpeaking,
        inputLevel: st.inputLevel,
        errorCode: code,
        serverError: st.errorCode ? st.serverError : null,
        autoplayBlocked: st.autoplayBlocked,
        peers: peers
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

    // Giriş hattı: kaynak -> analizör (algılama) ve kaynak -> gecikme -> kapı -> hedef (eşlere giden iz)
    function ensurePipe () {
      var c = ensureContext()
      if (st.pipe && st.pipe.ctx === c && c) return st.pipe
      destroyPipe()
      if (!c) return null
      var pipe = { ctx: c, analyser: null, delay: null, gain: null, dest: null, track: null, source: null, ok: false, target: null, fbuf: null, bbuf: null }
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
      disconnectNodes([p.source, p.analyser, p.delay, p.gain, p.dest])
      try {
        if (p.track) p.track.stop()
      } catch (e) {}
    }

    // Cihaz değişiminde yalnızca kaynak düğümü değişir, eşlerdeki iz aynı kalır
    function connectSource (local) {
      var pipe = st.pipe
      if (!pipe || !local) return
      var src = null
      try {
        src = pipe.ctx.createMediaStreamSource(local.srcStream)
        if (pipe.analyser) src.connect(pipe.analyser)
        if (pipe.ok) src.connect(pipe.delay)
      } catch (e) {
        if (src) disconnectNodes([src])
        src = null
      }
      var old = pipe.source
      pipe.source = src
      if (old) disconnectNodes([old])
    }

    function desiredMode () {
      if (!st.local) return null
      var p = st.pipe
      return p && p.ok && p.source && p.ctx.state === 'running' ? 'pipe' : 'raw'
    }

    function updateMode () {
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
      if (!st.local || st.muted || st.deafened) return false
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
      var live = !st.muted && !st.deafened
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

    function playTone (kind, other) {
      if (!st.settings.sounds || !ctx || ctx.state !== 'running') return
      if (other && st.deafened) return
      var freqs = kind === 'join' ? [523.25, 659.25] : [659.25, 523.25]
      var peak = other ? 0.08 : 0.12
      var t0 = ctx.currentTime + 0.02
      var c = ctx
      freqs.forEach(function (f, i) {
        var start = t0 + i * 0.12
        try {
          var osc = c.createOscillator()
          var gain = c.createGain()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(f, start)
          gain.gain.setValueAtTime(0, start)
          gain.gain.linearRampToValueAtTime(peak, start + 0.02)
          gain.gain.linearRampToValueAtTime(0, start + 0.11)
          osc.connect(gain)
          gain.connect(c.destination)
          osc.onended = function () {
            disconnectNodes([osc, gain])
          }
          osc.start(start)
          osc.stop(start + 0.12)
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
      st.held = { key: false, mouse: false, pad: false, touch: false }
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

    // Bas konuş: kaynaklar (klavye, fare, oyun kolu, dokunmatik düğme) ayrı izlenir
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
      if (!st.held.key && !st.held.mouse && !st.held.pad && !st.held.touch) setPttActive(false)
    }

    // Odak kaybında basılı her şey bırakılmış sayılır (gecikme uygulanmaz)
    function releaseAll () {
      st.held = { key: false, mouse: false, pad: false, touch: false }
      st.pttActive = false
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
      releaseAll()
    }

    function onVisibility () {
      if (document.visibilityState === 'visible') {
        requestWakeLock()
      } else {
        releaseAll()
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

    function closePeer (peer) {
      if (!peer || peer.closed) return
      peer.closed = true
      clearPeerTimer(peer)
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
      if (st.peers[peer.peerId] === peer) delete st.peers[peer.peerId]
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
        source: null,
        analyser: null,
        fbuf: null,
        bbuf: null,
        lastLoud: 0,
        speaking: false,
        status: 'connecting',
        lastState: 'new',
        restarted: false,
        waited: false,
        timer: null,
        candidates: [],
        outbox: [],
        localReady: false,
        outN: 0,
        closed: false
      }
      st.peers[pid] = peer
      st.roster[pid].noOffer = false
      try {
        peer.sender = pc.addTrack(track, stream)
      } catch (e) {
        closePeer(peer)
        return null
      }
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

    function onRemoteTrack (peer, e) {
      if (peer.closed || !e || !e.track || e.track.kind !== 'audio') return
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

    async function sendOffer (peer, restart) {
      if (peer.closed) return
      peer.localReady = false
      var offer = await peer.pc.createOffer(restart ? { iceRestart: true } : {})
      if (peer.closed) return
      await peer.pc.setLocalDescription(offer)
      if (peer.closed) return
      sendSignal(peer, { type: 'offer', sdp: peer.pc.localDescription.sdp })
      flushOutbox(peer)
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
        if (peer && peer.sid === sid && peer.initiator) return
        if (peer && peer.sid !== sid) {
          // Karşı taraf yeni bir bağlantı başlattı: eskisini kapat, bu kez yanıtlayan ol
          closePeer(peer)
          peer = null
        }
        if (!peer) peer = createPeer(from, false, sid)
        if (!peer) return
        peer.localReady = false
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp })
        if (peer.closed) return
        await addQueuedCandidates(peer)
        if (peer.closed) return
        var answer = await peer.pc.createAnswer()
        if (peer.closed) return
        await peer.pc.setLocalDescription(answer)
        if (peer.closed) return
        sendSignal(peer, { type: 'answer', sdp: peer.pc.localDescription.sdp })
        flushOutbox(peer)
      } else if (d.type === 'answer') {
        if (!peer || peer.sid !== sid || !peer.initiator) return
        if (typeof d.sdp !== 'string' || !d.sdp || d.sdp.length > MAX_SDP_CHARS) return
        if (peer.pc.signalingState !== 'have-local-offer') return
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp })
        if (peer.closed) return
        await addQueuedCandidates(peer)
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
    function sendSignal (peer, d) {
      if (!st.inVoice || !st.myPeerId || peer.closed) return
      var pid = peer.peerId
      peer.outN++
      d.sid = peer.sid
      d.n = peer.outN
      var data = null
      try {
        data = seal({ v: 1, from: st.myPeerId, to: pid, d: d })
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
      }).catch(noop)
    }

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
      if (status >= 200 && status < 300) return
      if ((status === 0 || status === 429 || status >= 500) && attempt < SIGNAL_RETRIES) {
        await delay(1000 * Math.pow(2, attempt))
        return postSignal(gen, pid, data, attempt + 1)
      }
    }

    // Gelen sinyal: çöz, etkin anahtar ve from/to bağlamasını denetle (sunucu yönlendirmeyi değiştiremez)
    function verify (from, data) {
      if (!st.myPeerId || from === st.myPeerId) return null
      var res = null
      try {
        res = open(data)
      } catch (e) {
        return null
      }
      if (!res || res.ok !== true || !res.value || typeof res.value !== 'object') return null
      if (!st.kid || res.kid !== st.kid) {
        st.kid = probeKid()
        if (!st.kid || res.kid !== st.kid) return null
      }
      var v = res.value
      if (v.v !== 1 || v.from !== from || v.to !== st.myPeerId) return null
      var d = v.d
      if (!d || typeof d !== 'object') return null
      if (d.type !== 'offer' && d.type !== 'answer' && d.type !== 'candidate') return null
      if (typeof d.sid !== 'string' || !SID_RE.test(d.sid)) return null
      if (typeof d.n !== 'number' || d.n < 1 || d.n > 1e9 || Math.floor(d.n) !== d.n) return null
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

    // Kadro (meta)
    function parseMember (m) {
      if (!m || typeof m !== 'object' || !isPeerId(m.peerId)) return null
      var uid = normId(m.userId)
      if (uid === null) return null
      if (st.myUserId !== null && uid === st.myUserId) return null
      return { peerId: m.peerId, userId: uid, muted: m.muted === true, deafened: m.deafened === true }
    }

    function addMembers (list) {
      if (!Array.isArray(list)) return
      var now = Date.now()
      list.slice(0, MAX_ROSTER).forEach(function (m) {
        var e = parseMember(m)
        if (!e || e.peerId === st.myPeerId) return
        st.roster[e.peerId] = { userId: e.userId, muted: e.muted, deafened: e.deafened, since: now, noOffer: false }
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
      })
      st.roster = next
      applyAllAudio()
      if (now - st.joinedAt > OTHER_TONE_QUIET_MS) {
        if (added) playTone('join', true)
        else if (removed) playTone('leave', true)
      }
      processUnknown()
      emit()
    }

    function handleMeta (meta, me) {
      if (me && typeof me === 'object') {
        var uid = normId(me.id)
        if (uid !== null) st.myUserId = uid
      }
      if (!meta || typeof meta !== 'object') return
      st.lastMeta = meta
      if (st.inVoice) applyRoster(meta)
    }

    function onGraceEnd () {
      st.graceTimer = null
      if (st.inVoice && !st.seenSelf && st.lastMeta) applyRoster(st.lastMeta)
    }

    function dropped () {
      teardownLocal(true)
      st.errorCode = 'kicked'
      st.serverError = null
      emit()
    }

    // Oturum temizliği: bağlantılar, kuyruklar ve kadro (yerel mikrofon korunur)
    function resetSession () {
      Object.keys(st.peers).forEach(function (pid) { closePeer(st.peers[pid]) })
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

    function join (channelId) {
      var cid = normId(channelId)
      if (cid === null) return Promise.reject(makeError('bad_channel'))
      if (st.channelId !== null && String(st.channelId) === cid) {
        if (st.joining && st.joinPromise) return st.joinPromise
        if (st.inVoice) return Promise.resolve()
      }
      var sup = support()
      if (!sup.ok) return failEarly(sup.reason)
      st.kid = probeKid()
      if (!st.kid) return failEarly('no_key')
      // Ses bağlamı kullanıcı etkileşimi sırasında oluşturulur veya sürdürülür
      ensureContext()
      var p = doJoin(channelId)
      st.joinPromise = p
      var clear = function () {
        if (st.joinPromise === p) st.joinPromise = null
      }
      p.then(clear, clear)
      return p
    }

    async function doJoin (channelId) {
      st.gen++
      var gen = st.gen
      var moving = st.inVoice
      resetSession()
      st.inVoice = false
      st.joining = true
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
      playTone('join', false)
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
      var body = { muted: st.muted || st.deafened, deafened: st.deafened }
      callApi('POST', '/api/voice/state', body).then(noop, noop).then(function () {
        st.statePosting = false
        var again = st.stateDirty || gen !== st.gen
        st.stateDirty = false
        if (again && st.inVoice) postState()
      })
    }

    function setMuted (value) {
      var v = !!value
      if (!v && st.deafened) {
        // Discord davranışı: sağırken mikrofonu açmak sağırlaştırmayı da kaldırır
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
      n = clamp(n, 0, 1)
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
      Object.keys(st.peers).forEach(function (pid) {
        var a = st.peers[pid].audio
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
      pttDown: function () { pttPress('touch') },
      pttUp: function () { pttRelease('touch') },
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
      unlockAudio: unlockAudio
    }
  }

  return { create: create, support: support, bindingLabel: bindingLabel, defaultSettings: defaultSettings }
})()
