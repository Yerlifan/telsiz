// Sesli sohbet istemcisi (window.VoiceClient)
// WebRTC tam örgü, yalnızca ses. Sinyaller grup anahtarıyla şifrelenir ve gönderen ile alıcı kimliğine bağlanır,
// böylece sunucu bağlantı kurulumuna müdahale edemez. Ağ erişimi yalnızca dışarıdan verilen api fonksiyonuyla yapılır.
window.VoiceClient = (function () {
  'use strict'

  var THRESHOLD = 0.02
  var HOLD_MS = 250
  var TICK_MS = 100
  // Analiz penceresi yaklaşık bir ölçüm aralığını (100 ms) kapsar, kısa sesler kaçmaz
  var FFT_SIZE = 4096
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
  var SIGNAL_RETRIES = 3
  var STORAGE_KEY = 'sohbet.voice'
  var DEFAULT_PTT_CODE = 'KeyV'
  var ID_RE = /^[A-Za-z0-9_-]{1,64}$/
  var SID_RE = /^[0-9a-f]{16}$/
  var KID_RE = /^[0-9a-f]{16}$/
  var KEY_CODE_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/
  var ICE_URL_RE = /^(stun|stuns|turn|turns):/i

  var MSG = {
    insecure: 'Sesli sohbet yalnızca https:// ile başlayan adreste çalışır. Tünel adresini kullanın.',
    unsupported: 'Bu tarayıcı sesli sohbeti desteklemiyor. PS5\'teysen telefonunun tarayıcısından katılabilirsin.',
    noKey: 'Sesli sohbet için şifreleme anahtarı gerekli.',
    permission: 'Mikrofon izni verilmedi.',
    notFound: 'Mikrofon bulunamadı.',
    mic: 'Mikrofon açılamadı.',
    joinFailed: 'Ses kanalına katılınamadı.',
    connFailed: 'Bazı kişilerle ses bağlantısı kurulamadı. Ağınız doğrudan bağlantıya izin vermiyor olabilir, TURN sunucusu gerekebilir.',
    dropped: 'Sesli bağlantı kesildi, yeniden katılabilirsin.'
  }

  function noop () {}

  function makeError (message, code) {
    var e = new Error(message)
    e.code = code || 'error'
    return e
  }

  function support () {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return { ok: false, reason: 'unsupported' }
    if (window.isSecureContext === false) return { ok: false, reason: 'insecure' }
    var md = navigator.mediaDevices
    if (!window.RTCPeerConnection || !md || typeof md.getUserMedia !== 'function') return { ok: false, reason: 'unsupported' }
    return { ok: true, reason: null }
  }

  function supportMessage (reason) {
    return reason === 'insecure' ? MSG.insecure : MSG.unsupported
  }

  function micErrorMessage (e) {
    var name = e && e.name
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return MSG.permission
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return MSG.notFound
    return MSG.mic
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

  // Analizörden RMS (0..1)
  function readLevel (node) {
    var an = node && node.analyser
    if (!an) return 0
    var n = an.fftSize
    var sum = 0
    var i = 0
    var v = 0
    if (typeof an.getFloatTimeDomainData === 'function') {
      if (!node.fbuf || node.fbuf.length !== n) node.fbuf = new Float32Array(n)
      an.getFloatTimeDomainData(node.fbuf)
      while (i < n) {
        v = node.fbuf[i]
        sum += v * v
        i++
      }
    } else {
      if (!node.bbuf || node.bbuf.length !== n) node.bbuf = new Uint8Array(n)
      an.getByteTimeDomainData(node.bbuf)
      while (i < n) {
        v = (node.bbuf[i] - 128) / 128
        sum += v * v
        i++
      }
    }
    return Math.sqrt(sum / n)
  }

  function create (opts) {
    if (!opts || typeof opts.api !== 'function' || typeof opts.seal !== 'function' || typeof opts.open !== 'function') {
      throw new TypeError('VoiceClient.create: api, seal ve open fonksiyonları gerekli.')
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
      ptt: { enabled: false, code: DEFAULT_PTT_CODE, active: false },
      deviceId: '',
      deviceJob: Promise.resolve(),
      volumes: Object.create(null),
      localMutes: Object.create(null),
      selfSpeaking: false,
      inputLevel: 0,
      error: null,
      autoplayBlocked: false,
      local: null,
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

    // Ayarlar (bas-konuş, cihaz, kişi bazlı ses)
    function loadSettings () {
      var obj = null
      if (storage && typeof storage.get === 'function') {
        try {
          obj = storage.get(STORAGE_KEY)
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
      if (!obj || typeof obj !== 'object') return
      if (obj.ptt && typeof obj.ptt === 'object') {
        if (typeof obj.ptt.enabled === 'boolean') st.ptt.enabled = obj.ptt.enabled
        if (typeof obj.ptt.code === 'string' && KEY_CODE_RE.test(obj.ptt.code)) st.ptt.code = obj.ptt.code
      }
      if (typeof obj.deviceId === 'string' && obj.deviceId.length <= 512) st.deviceId = obj.deviceId
      copyMap(obj.volumes, st.volumes, function (v) { return typeof v === 'number' && v >= 0 && v <= 1 })
      copyMap(obj.localMutes, st.localMutes, function (v) { return v === true })
    }

    function copyMap (src, dst, ok) {
      if (!src || typeof src !== 'object') return
      Object.keys(src).slice(0, MAX_STORED_USERS).forEach(function (k) {
        if (normId(k) === k && ok(src[k])) dst[k] = src[k]
      })
    }

    function saveSettings () {
      if (!storage || typeof storage.set !== 'function') return
      var data = {
        ptt: { enabled: st.ptt.enabled, code: st.ptt.code },
        deviceId: st.deviceId,
        volumes: st.volumes,
        localMutes: st.localMutes
      }
      try {
        storage.set(STORAGE_KEY, JSON.stringify(data))
      } catch (e) {}
    }

    function volumeOf (uid) {
      var v = st.volumes[uid]
      return typeof v === 'number' ? v : 1
    }

    function micOpen () {
      return !st.muted && !st.deafened && (!st.ptt.enabled || st.ptt.active)
    }

    function applyTrack () {
      if (st.local && st.local.track) st.local.track.enabled = micOpen()
    }

    function applyPeerAudio (peer) {
      var a = peer.audio
      var r = st.roster[peer.peerId]
      if (!a || !r) return
      try {
        a.volume = volumeOf(r.userId)
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
      return {
        channelId: st.channelId,
        joining: st.joining,
        muted: st.muted || st.deafened,
        deafened: st.deafened,
        ptt: { enabled: st.ptt.enabled, code: st.ptt.code, active: st.ptt.active },
        selfSpeaking: st.selfSpeaking,
        inputLevel: st.inputLevel,
        error: st.error || (anyFailed() ? MSG.connFailed : null),
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

    // Ses bağlamı ve analizörler
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
      if (!ctx) return
      st.closeTimer = setTimeout(function () {
        st.closeTimer = null
        if (!ctx || st.inVoice || st.joining) return
        var c = ctx
        ctx = null
        try {
          var p = c.close()
          if (p && typeof p.catch === 'function') p.catch(noop)
        } catch (e) {}
      }, CONTEXT_CLOSE_DELAY_MS)
    }

    function attachAnalyser (node, stream) {
      detachAnalyser(node)
      if (!ctx || !stream || ctx.state === 'closed') return
      try {
        var source = ctx.createMediaStreamSource(stream)
        var analyser = ctx.createAnalyser()
        analyser.fftSize = FFT_SIZE
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
      try {
        if (node.source) node.source.disconnect()
      } catch (e) {}
      try {
        if (node.analyser) node.analyser.disconnect()
      } catch (e) {}
      node.source = null
      node.analyser = null
      node.lastLoud = 0
    }

    function playTone (kind, other) {
      if (!ctx || ctx.state !== 'running') return
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
            try {
              osc.disconnect()
              gain.disconnect()
            } catch (e) {}
          }
          osc.start(start)
          osc.stop(start + 0.12)
        } catch (e) {}
      })
    }

    function tick () {
      var now = Date.now()
      var changed = false
      var local = st.local
      if (local) {
        var rms = readLevel(local)
        if (rms > THRESHOLD) local.lastLoud = now
        // Giriş seviyesi 0.05 adımlarla bildirilir (en fazla ölçüm aralığı sıklığında)
        var level = Math.round(Math.min(1, rms * 4) * 20) / 20
        if (level !== st.inputLevel) {
          st.inputLevel = level
          changed = true
        }
        var selfNow = !!local.analyser && micOpen() && now - local.lastLoud < HOLD_MS
        if (selfNow !== st.selfSpeaking) {
          st.selfSpeaking = selfNow
          changed = true
        }
      }
      Object.keys(st.peers).forEach(function (pid) {
        var p = st.peers[pid]
        if (readLevel(p) > THRESHOLD) p.lastLoud = now
        var s = !!p.analyser && now - p.lastLoud < HOLD_MS
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
    async function getMic (deviceId, allowFallback) {
      var md = navigator.mediaDevices
      var audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      if (deviceId) audio.deviceId = { exact: deviceId }
      try {
        return await md.getUserMedia({ audio: audio, video: false })
      } catch (e) {
        var n = e && e.name
        if (!deviceId || !allowFallback || (n !== 'OverconstrainedError' && n !== 'NotFoundError')) throw e
        delete audio.deviceId
        return md.getUserMedia({ audio: audio, video: false })
      }
    }

    function makeLocal (stream) {
      var tracks = stream.getAudioTracks()
      if (!tracks.length) throw makeError(MSG.notFound, 'mic')
      var track = tracks[0]
      var clone = null
      try {
        clone = track.clone()
      } catch (e) {
        clone = null
      }
      // Seviye ölçümü klon iz üzerinden yapılır, böylece susturulmuşken de giriş seviyesi görünür
      return {
        stream: stream,
        track: track,
        analysisTrack: clone,
        analysisStream: new MediaStream([clone || track]),
        source: null,
        analyser: null,
        lastLoud: 0,
        fbuf: null,
        bbuf: null
      }
    }

    function stopLocal (local) {
      if (!local) return
      detachAnalyser(local)
      try {
        local.track.stop()
      } catch (e) {}
      try {
        if (local.analysisTrack) local.analysisTrack.stop()
      } catch (e) {}
      stopStream(local.stream)
    }

    // Klavye, odak ve görünürlük dinleyicileri (yalnızca seste iken)
    function onKeyDown (e) {
      if (!st.ptt.enabled || !e || e.code !== st.ptt.code || e.repeat) return
      if (isEditable(e.target)) return
      setPttActive(true)
    }

    function onKeyUp (e) {
      if (!st.ptt.enabled || !e || e.code !== st.ptt.code) return
      setPttActive(false)
    }

    function onBlur () {
      setPttActive(false)
    }

    function onVisibility () {
      if (document.visibilityState === 'visible') {
        requestWakeLock()
      } else {
        setPttActive(false)
      }
    }

    function addListeners () {
      if (listening) return
      listening = true
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('keyup', onKeyUp)
      window.addEventListener('blur', onBlur)
      document.addEventListener('visibilitychange', onVisibility)
    }

    function removeListeners () {
      if (!listening) return
      listening = false
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
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
        peer.sender = pc.addTrack(st.local.track, st.local.stream)
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
        st.error = MSG.noKey
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
      st.error = MSG.dropped
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

    // Tam yerel kapatma: izler durur, ses öğeleri ve kap kaldırılır, analizörler ve zamanlayıcılar temizlenir
    function teardownLocal (withSound) {
      var wasIn = st.inVoice
      st.gen++
      resetSession()
      if (st.local) {
        stopLocal(st.local)
        st.local = null
      }
      stopTick()
      removeListeners()
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
      st.ptt.active = false
      st.selfSpeaking = false
      st.inputLevel = 0
      st.autoplayBlocked = false
      if (withSound && wasIn) playTone('leave', false)
      scheduleContextClose()
      emit()
    }

    function failEarly (msg, code) {
      st.error = msg
      emit()
      return Promise.reject(makeError(msg, code))
    }

    function join (channelId) {
      var cid = normId(channelId)
      if (cid === null) return Promise.reject(makeError(MSG.joinFailed, 'bad_channel'))
      if (st.channelId !== null && String(st.channelId) === cid) {
        if (st.joining && st.joinPromise) return st.joinPromise
        if (st.inVoice) return Promise.resolve()
      }
      var sup = support()
      if (!sup.ok) return failEarly(supportMessage(sup.reason), sup.reason)
      st.kid = probeKid()
      if (!st.kid) return failEarly(MSG.noKey, 'no_key')
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
      st.error = null
      st.lastSigSeq = 0
      st.myPeerId = null
      st.autoplayBlocked = false
      emit()
      if (st.leavePromise) await st.leavePromise
      if (st.joinRequest) await st.joinRequest.then(noop, noop)
      if (gen !== st.gen) return
      var usedDevice = st.deviceId
      if (!st.local) {
        var stream = null
        try {
          stream = await getMic(st.deviceId, true)
        } catch (e) {
          if (gen !== st.gen) return
          var micMsg = micErrorMessage(e)
          teardownLocal(false)
          st.error = micMsg
          emit()
          throw makeError(micMsg, 'mic')
        }
        if (gen !== st.gen) {
          stopStream(stream)
          return
        }
        try {
          st.local = makeLocal(stream)
        } catch (e) {
          stopStream(stream)
          teardownLocal(false)
          st.error = MSG.notFound
          emit()
          throw makeError(MSG.notFound, 'mic')
        }
      }
      applyTrack()
      attachAnalyser(st.local, st.local.analysisStream)
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
        var text = data && typeof data.error === 'string' && data.error ? data.error : MSG.joinFailed
        var code = data && typeof data.code === 'string' ? data.code : 'join_failed'
        teardownLocal(false)
        st.error = text
        emit()
        if (moving) callApi('POST', '/api/voice/leave', {}).catch(noop)
        throw makeError(text, code)
      }
      st.myPeerId = data.peerId
      st.iceServers = sanitizeIce(data.iceServers)
      st.joining = false
      st.inVoice = true
      st.joinedAt = Date.now()
      st.seenSelf = false
      addMembers(data.members)
      var initial = Object.keys(st.roster)
      startTick()
      addListeners()
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
      if (st.deviceId !== usedDevice) setInputDevice(st.deviceId).catch(noop)
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
      st.error = null
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
      st.error = null
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
      applyTrack()
      postState()
      emit()
    }

    function setDeafened (value) {
      st.deafened = !!value
      applyAllAudio()
      applyTrack()
      postState()
      emit()
    }

    function setPeerVolume (userId, volume) {
      var uid = normId(userId)
      var n = Number(volume)
      if (uid === null || !isFinite(n)) return
      n = Math.max(0, Math.min(1, n))
      if (n === 1) {
        delete st.volumes[uid]
      } else if (uid in st.volumes || Object.keys(st.volumes).length < MAX_STORED_USERS) {
        st.volumes[uid] = n
      }
      saveSettings()
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
      saveSettings()
      applyAllAudio()
      emit()
    }

    function setPushToTalk (cfg) {
      if (!cfg || typeof cfg !== 'object') return
      if (typeof cfg.enabled === 'boolean') st.ptt.enabled = cfg.enabled
      if (typeof cfg.code === 'string' && KEY_CODE_RE.test(cfg.code)) st.ptt.code = cfg.code
      st.ptt.active = false
      saveSettings()
      applyTrack()
      emit()
    }

    function setPttActive (value) {
      var v = !!value
      if (v && !st.ptt.enabled) return
      if (st.ptt.active === v) return
      st.ptt.active = v
      applyTrack()
      emit()
    }

    function listInputDevices () {
      var md = navigator.mediaDevices
      if (!md || typeof md.enumerateDevices !== 'function') return Promise.resolve([])
      return md.enumerateDevices().then(function (list) {
        var n = 0
        return list.filter(function (d) { return d.kind === 'audioinput' }).map(function (d) {
          n++
          return { deviceId: d.deviceId, label: d.label || 'Mikrofon ' + n }
        })
      }, function () {
        return []
      })
    }

    function setInputDevice (deviceId) {
      var id = typeof deviceId === 'string' && deviceId.length <= 512 ? deviceId : ''
      st.deviceId = id
      saveSettings()
      var job = st.deviceJob.then(function () { return switchDevice(id) })
      st.deviceJob = job.then(noop, noop)
      return job
    }

    async function switchDevice (id) {
      if (!st.inVoice || !st.local || st.deviceId !== id) return
      var gen = st.gen
      var stream = null
      try {
        stream = await getMic(id, false)
      } catch (e) {
        throw makeError(micErrorMessage(e), 'mic')
      }
      if (gen !== st.gen || !st.inVoice || !st.local) {
        stopStream(stream)
        return
      }
      var next = null
      try {
        next = makeLocal(stream)
      } catch (e) {
        stopStream(stream)
        throw e
      }
      var old = st.local
      st.local = next
      applyTrack()
      var jobs = []
      Object.keys(st.peers).forEach(function (pid) {
        var sender = st.peers[pid].sender
        if (sender && typeof sender.replaceTrack === 'function') jobs.push(sender.replaceTrack(next.track).then(noop, noop))
      })
      await Promise.all(jobs)
      stopLocal(old)
      if (gen !== st.gen || st.local !== next) return
      attachAnalyser(next, next.analysisStream)
      emit()
    }

    // Otomatik oynatma engeli: kullanıcı etkileşimiyle çağrılır
    function unlockAudio () {
      var jobs = []
      if (st.inVoice || st.joining) {
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
        if (ok && st.local && !st.local.analyser) attachAnalyser(st.local, st.local.analysisStream)
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
      setPushToTalk: setPushToTalk,
      pttDown: function () { setPttActive(true) },
      pttUp: function () { setPttActive(false) },
      listInputDevices: listInputDevices,
      setInputDevice: setInputDevice,
      handleSignals: handleSignals,
      handleMeta: handleMeta,
      teardown: teardown,
      snapshot: snapshot,
      unlockAudio: unlockAudio
    }
  }

  return { create: create, support: support }
})()
