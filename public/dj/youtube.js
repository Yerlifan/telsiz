'use strict'

// Telsiz DJ YouTube bağdaştırıcısı (window.TelsizYouTube, SPEC-V2 Ek L2.3 ve L2.4 yol ii).
//
// YouTube'un resmi gömülü oynatıcısı ana sayfaya çapraz kökenli bir çerçeve olarak eklenir:
// https://www.youtube-nocookie.com/embed/<kimlik>?enablejsapi=1&origin=<uygulama kökeni>&...
// Google'ın kodu yalnızca o çerçevede, youtube-nocookie.com kökeninde çalışır. Uygulamanın kökeninde
// Google kodu çalışmaz: iframe_api ve widgetapi betikleri YÜKLENMEZ, ana sayfanın CSP'sinde script-src
// 'self' kalır, yalnızca frame-src https://www.youtube-nocookie.com eklenir.
//
// Neden yardımcı sayfa (yol i) değil: sandbox bayrakları iç içe çerçevelere kalıtılır. allow-same-origin
// olmadan çalışan opak kökenli bir yardımcının içindeki YouTube çerçevesi de opak kökenli olur, çerez ve
// depolama erişimi SecurityError verir (YouTube gömmelerinin bu durumda oynamadığı bilinen bir sorundur)
// ve opak kökenli belge HTTP Referer göndermez. YouTube gömülü oynatıcıyı kullanan istemcilerden kimlik
// için Referer ister, Referer yoksa oynatıcı 153 hatası verir. Ayrıntılar scratchpad/dj-interface.json.
//
// Çerçeveyle konuşma, resmi IFrame Player API'nin kendi içinde kullandığı JSON dizesi postMessage
// iletileriyle yapılır (listening, command, onReady, infoDelivery, onStateChange, onError). Bu ileti
// biçimi Google tarafından belgelenmemiştir, açık kaynak oynatıcılarda (vidstack, vime) yıllardır aynı
// biçimde kullanılır. Gelen her ileti köken (https://www.youtube-nocookie.com) ve kaynak (bu çerçevenin
// penceresi) ile denetlenir, katı biçimde doğrulanır. Giden iletiler yalnızca bu kökene gönderilir.
//
// Çerçevenin src adresi yalnızca kesin [A-Za-z0-9_-]{11} desenindeki video kimliğinden ve sabit
// parametrelerden kurulur. Bu dosyada kullanıcıya görünen metin yoktur, çerçeve başlığı çağırandan gelir.

var TelsizYouTube = (function (root) {
  const VERSION = 1
  const ORIGIN = 'https://www.youtube-nocookie.com'
  const EMBED_BASE = ORIGIN + '/embed/'
  const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/
  const PAGE_ORIGIN_RE = /^https?:\/\/(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::[0-9]{1,5})?$/
  const LANG_RE = /^[a-z]{2}$/
  const MIN_SIZE = 200
  const LISTEN_INTERVAL_MS = 250
  const READY_TIMEOUT_MS = 20000
  const PLAY_TIMEOUT_MS = 5000
  const MAX_MESSAGE_CHARS = 65536
  const MAX_TITLE_CHARS = 1000
  const MAX_SECONDS = 86400
  // allow-same-origin burada YouTube çerçevesinin kendi kökenini korur (çerçeve zaten çapraz kökenlidir,
  // ana sayfaya erişemez). Üst pencereyi yönlendirme, form ve indirme izinleri verilmez. Açılır pencere
  // izni yalnızca oynatıcıdaki "YouTube'da izle" bağlantısı içindir.
  const SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox'
  const ALLOW = 'autoplay; encrypted-media; picture-in-picture; fullscreen'
  const REFERRER_POLICY = 'strict-origin-when-cross-origin'
  const FRAME_CLASS = 'dj-youtube-frame'
  const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 }
  const KNOWN_STATES = [-1, 0, 1, 2, 3, 5]
  // onAutoplayBlocked (Kasım 2023'te eklendi, IFrame Player API başvurusunda belgeli): tarayıcı autoplay
  // parametresini veya betikle başlatılan oynatmayı (playVideo, loadVideoById...) engellediğinde gelir
  const LISTENED_EVENTS = ['onReady', 'onStateChange', 'onError', 'onAutoplayBlocked']
  const toStr = Object.prototype.toString
  let nextWidgetId = 1

  function fail (code, message) {
    const err = new Error(message || code)
    err.code = code
    return err
  }

  function isObj (value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) && toStr.call(value) === '[object Object]'
  }

  function isNum (value) {
    return typeof value === 'number' && isFinite(value)
  }

  function defaultNow () {
    if (root.performance && typeof root.performance.now === 'function' && typeof root.performance.timeOrigin === 'number') {
      return root.performance.timeOrigin + root.performance.now()
    }
    return Date.now()
  }

  // Gömülü oynatıcı adresi. Kimlik geçersizse 'bad_video_id' kodlu hata fırlatır. options: { pageOrigin,
  // lang, widgetId }. Kök yalnızca http veya https ise origin parametresi eklenir.
  function buildEmbedUrl (videoId, options) {
    if (typeof videoId !== 'string' || !VIDEO_ID_RE.test(videoId)) throw fail('bad_video_id')
    const o = options || {}
    const params = [['enablejsapi', '1'], ['autoplay', '0'], ['controls', '1'], ['playsinline', '1'], ['rel', '0'], ['iv_load_policy', '3'], ['fs', '1']]
    if (typeof o.pageOrigin === 'string' && PAGE_ORIGIN_RE.test(o.pageOrigin)) params.push(['origin', o.pageOrigin])
    if (typeof o.lang === 'string' && LANG_RE.test(o.lang)) params.push(['hl', o.lang])
    if (typeof o.widgetId === 'number' && Number.isSafeInteger(o.widgetId) && o.widgetId > 0) params.push(['widgetid', String(o.widgetId)])
    return EMBED_BASE + videoId + '?' + params.map((p) => p[0] + '=' + encodeURIComponent(p[1])).join('&')
  }

  // Gelen iletiyi çözer ve doğrular. Sonuç { event, info, id } veya null.
  function parseMessage (data) {
    let msg = data
    if (typeof data === 'string') {
      if (data.length === 0 || data.length > MAX_MESSAGE_CHARS) return null
      try {
        msg = JSON.parse(data)
      } catch (e) {
        return null
      }
    }
    if (!isObj(msg) || typeof msg.event !== 'string' || msg.event.length > 64) return null
    return { event: msg.event, info: msg.info, id: msg.id }
  }

  // options:
  //   container   oynatıcı alanı (appendChild). Alan en az 200x200 piksel ve görünür olmalıdır.
  //   videoId     kesin [A-Za-z0-9_-]{11}
  //   pageOrigin  uygulamanın kökeni (location.origin), lang ('tr' | 'en'), title (çerçeve başlığı)
  //   onEvent(ev) ev.type: ready, playing, paused, ended, duration (ms), title (text), error (code), unresponsive
  //   now(), timers { setTimeout, clearTimeout, setInterval, clearInterval }
  function create (options) {
    const opts = options || {}
    const container = opts.container
    if (!container || typeof container.appendChild !== 'function') throw fail('bad_container')
    if (typeof opts.videoId !== 'string' || !VIDEO_ID_RE.test(opts.videoId)) throw fail('bad_video_id')
    const doc = root.document
    const now = typeof opts.now === 'function' ? opts.now : defaultNow
    const timers = opts.timers || {
      setTimeout: (fn, ms) => root.setTimeout(fn, ms),
      clearTimeout: (id) => root.clearTimeout(id),
      setInterval: (fn, ms) => root.setInterval(fn, ms),
      clearInterval: (id) => root.clearInterval(id)
    }
    const onEvent = typeof opts.onEvent === 'function' ? opts.onEvent : () => {}
    const widgetId = nextWidgetId++
    const frame = doc.createElement('iframe')
    let destroyed = false
    let connected = false
    let ready = false
    let state = STATE.UNSTARTED
    let lastTimeMs = null
    let lastTimeAt = 0
    let durationMs = 0
    let durationSent = false
    let titleSent = false
    let volume = null
    let muted = null
    // Oynatıcının bildirdiği ses düzeyi (0..100) ve sessiz durumu (infoDelivery volume, muted)
    let reportedVolume = null
    let reportedMuted = null
    let listenHandle = null
    let readyHandle = null
    let waiters = []

    function emit (ev) {
      if (destroyed) return
      try {
        onEvent(ev)
      } catch (e) {
        if (root.console && typeof root.console.error === 'function') root.console.error(e)
      }
    }

    function send (msg) {
      if (destroyed) return false
      const win = frame.contentWindow
      if (!win) return false
      const payload = Object.assign({}, msg, { id: widgetId, channel: 'widget' })
      try {
        win.postMessage(JSON.stringify(payload), ORIGIN)
        return true
      } catch (e) {
        return false
      }
    }

    function command (func, args) {
      return send({ event: 'command', func: func, args: args || [] })
    }

    function stopListening () {
      if (listenHandle !== null) timers.clearInterval(listenHandle)
      listenHandle = null
    }

    function startListening () {
      stopListening()
      send({ event: 'listening' })
      listenHandle = timers.setInterval(() => {
        if (connected || destroyed) {
          stopListening()
          return
        }
        send({ event: 'listening' })
      }, LISTEN_INTERVAL_MS)
    }

    function settleWaiters (result) {
      const list = waiters
      waiters = []
      list.forEach((fn) => fn(result))
    }

    function setState (next) {
      if (KNOWN_STATES.indexOf(next) === -1 || next === state) return
      state = next
      if (next === STATE.PLAYING) {
        settleWaiters('ok')
        emit({ type: 'playing' })
      } else if (next === STATE.PAUSED) {
        emit({ type: 'paused' })
      } else if (next === STATE.ENDED) {
        if (durationMs > 0) {
          lastTimeMs = durationMs
          lastTimeAt = now()
        }
        emit({ type: 'ended' })
      }
    }

    function applyInfo (info) {
      if (!isObj(info)) return
      if (isNum(info.currentTime) && info.currentTime >= 0 && info.currentTime <= MAX_SECONDS) {
        lastTimeMs = Math.round(info.currentTime * 1000)
        lastTimeAt = now()
      }
      if (isNum(info.duration) && info.duration > 0 && info.duration <= MAX_SECONDS) {
        durationMs = Math.round(info.duration * 1000)
        if (!durationSent) {
          durationSent = true
          emit({ type: 'duration', ms: durationMs })
        }
      }
      if (isObj(info.videoData) && typeof info.videoData.title === 'string' && !titleSent) {
        const title = info.videoData.title.slice(0, MAX_TITLE_CHARS)
        if (title.trim() !== '') {
          titleSent = true
          emit({ type: 'title', text: title })
        }
      }
      if (typeof info.playerState === 'number') setState(info.playerState)
      // Ses düzeyi oynatıcının kendi denetimleriyle de değişebilir, değişiklik motora bildirilir
      let soundChanged = false
      if (isNum(info.volume) && info.volume >= 0 && info.volume <= 100 && Math.round(info.volume) !== reportedVolume) {
        reportedVolume = Math.round(info.volume)
        soundChanged = true
      }
      if (typeof info.muted === 'boolean' && info.muted !== reportedMuted) {
        reportedMuted = info.muted
        soundChanged = true
      }
      if (soundChanged && reportedVolume !== null) emit({ type: 'volume', volume: reportedVolume, muted: reportedMuted === true })
    }

    function becomeReady () {
      if (ready) return
      ready = true
      if (readyHandle !== null) timers.clearTimeout(readyHandle)
      readyHandle = null
      if (volume !== null) command('setVolume', [volume])
      if (muted !== null) command(muted ? 'mute' : 'unMute')
      emit({ type: 'ready' })
    }

    function onMessage (event) {
      if (destroyed || !event || event.origin !== ORIGIN || event.source !== frame.contentWindow) return
      const msg = parseMessage(event.data)
      if (!msg) return
      if (msg.id !== undefined && msg.id !== null && String(msg.id) !== String(widgetId)) return
      if (!connected) {
        connected = true
        stopListening()
        LISTENED_EVENTS.forEach((name) => command('addEventListener', [name]))
      }
      if (msg.event === 'onReady') {
        becomeReady()
      } else if (msg.event === 'initialDelivery' || msg.event === 'infoDelivery') {
        applyInfo(msg.info)
      } else if (msg.event === 'onStateChange') {
        if (typeof msg.info === 'number') setState(msg.info)
        else if (isObj(msg.info) && typeof msg.info.playerState === 'number') setState(msg.info.playerState)
      } else if (msg.event === 'onAutoplayBlocked') {
        // Bekleyen oynatma sözü hemen 'blocked' ile çözülür, motor "Dinlemek için dokunun" gösterir
        settleWaiters('blocked')
        emit({ type: 'blocked' })
      } else if (msg.event === 'onError') {
        const code = typeof msg.info === 'number' ? msg.info : (isObj(msg.info) && typeof msg.info.errorCode === 'number' ? msg.info.errorCode : null)
        if (code !== null && Number.isSafeInteger(code)) {
          settleWaiters('error')
          emit({ type: 'error', code: code })
        }
      }
    }

    function onLoad () {
      if (destroyed) return
      connected = false
      startListening()
    }

    frame.setAttribute('sandbox', SANDBOX)
    frame.setAttribute('allow', ALLOW)
    frame.setAttribute('referrerpolicy', REFERRER_POLICY)
    frame.setAttribute('width', '100%')
    frame.setAttribute('height', '100%')
    frame.setAttribute('title', typeof opts.title === 'string' ? opts.title : '')
    frame.className = FRAME_CLASS
    frame.addEventListener('load', onLoad)
    root.addEventListener('message', onMessage)
    frame.src = buildEmbedUrl(opts.videoId, { pageOrigin: opts.pageOrigin, lang: opts.lang, widgetId: widgetId })
    container.appendChild(frame)
    readyHandle = timers.setTimeout(() => {
      readyHandle = null
      if (!ready && !destroyed) emit({ type: 'unresponsive' })
    }, READY_TIMEOUT_MS)

    function position () {
      if (!ready || lastTimeMs === null) return null
      let pos = lastTimeMs
      if (state === STATE.PLAYING) pos += Math.max(0, now() - lastTimeAt)
      if (durationMs > 0 && pos > durationMs) pos = durationMs
      return Math.round(pos)
    }

    function play () {
      if (destroyed) return Promise.resolve('aborted')
      if (!ready) return Promise.resolve('error')
      command('playVideo')
      if (state === STATE.PLAYING) return Promise.resolve('ok')
      return new Promise((resolve) => {
        let done = false
        const finish = (result) => {
          if (done) return
          done = true
          timers.clearTimeout(handle)
          resolve(result)
        }
        // Engel önce belgelenmiş onAutoplayBlocked olayıyla bildirilir. Olay gelmezse (eski oynatıcı) yedek
        // olarak: oynatıcı süre dolduğunda hâlâ yükleniyorsa (BUFFERING) istek geçerli, değilse engellendi
        // sayılır.
        const handle = timers.setTimeout(() => {
          waiters = waiters.filter((w) => w !== finish)
          finish(state === STATE.BUFFERING ? 'ok' : 'blocked')
        }, PLAY_TIMEOUT_MS)
        waiters.push(finish)
      })
    }

    // Çerçevenin görünür olup olmadığı. YouTube API Hizmetleri politikaları: gömülü oynatıcının görünüm alanı en
    // az 200x200 piksel olur, önüne katman veya başka öğe konmaz, oynatıcı gizlenip arka planda çalınmaz.
    // Görünür sayılmaz: 200x200'den küçük, görünmez veya saydam (çerçeve ya da bir ata), clip-path, clip veya
    // maske uygulanmış, overflow: hidden ya da clip olan bir ata tarafından 200x200'ün altına kırpılmış,
    // kaydırılarak ulaşılamayacak bir yerde (ör. left: -10000px) olan veya görünüm alanındaki kısmı başka bir
    // öğeyle örtülmüş (ör. tam ekran Ayarlar katmanı) çerçeve. Sayfa ya da bir kaydırma kabı kaydırıldığı için
    // görünüm alanı dışında kalan çerçeve ve arka plandaki sekme duraklatılmaz: bu kişinin kendi gezinmesidir,
    // uygulama oynatıcıyı gizlemiş olmaz. Örtme denetimi elementFromPoint ile yapılır, pointer-events: none
    // olan bir katman bu yolla görülemez (uygulama oynatıcının üstüne böyle bir katman koymamalıdır).
    function visible () {
      if (destroyed || !frame.isConnected) return false
      try {
        return measureVisible()
      } catch (e) {
        return false
      }
    }

    function clippedByStyle (cs) {
      const clipPath = cs.clipPath || cs.webkitClipPath
      if (clipPath && clipPath !== 'none') return true
      if (cs.clip && cs.clip !== 'auto' && (cs.position === 'absolute' || cs.position === 'fixed')) return true
      const mask = cs.maskImage || cs.webkitMaskImage
      return Boolean(mask) && mask !== 'none'
    }

    function hardClips (value) {
      return value === 'hidden' || value === 'clip'
    }

    function measureVisible () {
      const rect = frame.getBoundingClientRect()
      if (!rect || rect.width < MIN_SIZE - 0.5 || rect.height < MIN_SIZE - 0.5) return false
      const hasCheck = typeof frame.checkVisibility === 'function'
      if (hasCheck && frame.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true, checkOpacity: true, checkVisibilityCSS: true }) !== true) return false
      // Hesaplanmış stil yoksa (ör. test ortamı) yalnızca boyut ve checkVisibility denetlenebilir
      if (typeof root.getComputedStyle !== 'function' || !doc || !doc.documentElement) return hasCheck
      const style = (el) => root.getComputedStyle(el)
      const docEl = doc.documentElement
      const body = doc.body || null
      const frameStyle = style(frame)
      if (!hasCheck && (frameStyle.visibility === 'hidden' || frameStyle.visibility === 'collapse' || Number(frameStyle.opacity) === 0)) return false
      if (clippedByStyle(frameStyle)) return false
      // hard: overflow hidden/clip atalarının ve görünüm alanının kesin kırpması (en az 200x200 kalmalı)
      // view: ek olarak kaydırma kaplarının kırpması (örtme denetiminde örnek noktalar buradan seçilir)
      // reach: kaydırarak getirilebileceği en dış kutu (iç kaydırma kabı çerçeveyi kendi görünür alanına getirebilir)
      const hard = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      const view = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      const reach = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }
      const rootStyle = style(docEl)
      const bodyStyle = body ? style(body) : null
      // html'in overflow değeri visible ise body'ninki görünüm alanına aktarılır
      const viewportStyle = rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible' && bodyStyle ? bodyStyle : rootStyle
      let el = frame.parentElement
      while (el) {
        const cs = el === body ? bodyStyle : (el === docEl ? rootStyle : style(el))
        if (!hasCheck && (Number(cs.opacity) === 0 || cs.display === 'none')) return false
        if (clippedByStyle(cs)) return false
        const isViewportSource = el === docEl || (el === body && viewportStyle === bodyStyle)
        if (!isViewportSource && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
          const r = el.getBoundingClientRect()
          const cl = r.left + el.clientLeft
          const ct = r.top + el.clientTop
          const cr = cl + el.clientWidth
          const cb = ct + el.clientHeight
          if (hardClips(cs.overflowX)) {
            hard.left = Math.max(hard.left, cl)
            hard.right = Math.min(hard.right, cr)
            reach.left = Math.max(reach.left, cl)
            reach.right = Math.min(reach.right, cr)
          } else if (cs.overflowX !== 'visible') {
            // Kaydırma kabının negatif tarafına kaydırılamaz
            if (reach.right - cl + el.scrollLeft <= 0) return false
            reach.left = cl
            reach.right = cr
          }
          if (hardClips(cs.overflowY)) {
            hard.top = Math.max(hard.top, ct)
            hard.bottom = Math.min(hard.bottom, cb)
            reach.top = Math.max(reach.top, ct)
            reach.bottom = Math.min(reach.bottom, cb)
          } else if (cs.overflowY !== 'visible') {
            if (reach.bottom - ct + el.scrollTop <= 0) return false
            reach.top = ct
            reach.bottom = cb
          }
          if (cs.overflowX !== 'visible') {
            view.left = Math.max(view.left, cl)
            view.right = Math.min(view.right, cr)
          }
          if (cs.overflowY !== 'visible') {
            view.top = Math.max(view.top, ct)
            view.bottom = Math.min(view.bottom, cb)
          }
        }
        el = el.parentElement
      }
      const vw = docEl.clientWidth || root.innerWidth || 0
      const vh = docEl.clientHeight || root.innerHeight || 0
      const scrollX = root.pageXOffset || 0
      const scrollY = root.pageYOffset || 0
      if (hardClips(viewportStyle.overflowX)) {
        hard.left = Math.max(hard.left, 0)
        hard.right = Math.min(hard.right, vw)
      } else if (reach.right + scrollX <= 0) {
        return false
      }
      if (hardClips(viewportStyle.overflowY)) {
        hard.top = Math.max(hard.top, 0)
        hard.bottom = Math.min(hard.bottom, vh)
      } else if (reach.bottom + scrollY <= 0) {
        return false
      }
      if (hard.right - hard.left < MIN_SIZE - 0.5 || hard.bottom - hard.top < MIN_SIZE - 0.5) return false
      // Örtme: görünüm alanındaki kısmın 3x3 noktasında en üstteki öğe çerçeve olmalıdır. Arka plandaki
      // sekmede ve görünüm alanı dışında kalan çerçevede denetlenmez.
      const left = Math.max(view.left, hard.left, 0)
      const right = Math.min(view.right, hard.right, vw)
      const top = Math.max(view.top, hard.top, 0)
      const bottom = Math.min(view.bottom, hard.bottom, vh)
      if (right - left < 1 || bottom - top < 1 || typeof doc.elementFromPoint !== 'function' || doc.visibilityState === 'hidden') return true
      const fractions = [0.1, 0.5, 0.9]
      return fractions.every((fy) => fractions.every((fx) => doc.elementFromPoint(left + (right - left) * fx, top + (bottom - top) * fy) === frame))
    }

    function destroy () {
      if (destroyed) return
      settleWaiters('aborted')
      destroyed = true
      stopListening()
      if (readyHandle !== null) timers.clearTimeout(readyHandle)
      readyHandle = null
      root.removeEventListener('message', onMessage)
      frame.removeEventListener('load', onLoad)
      if (frame.parentNode) frame.parentNode.removeChild(frame)
    }

    return Object.freeze({
      widgetId: widgetId,
      ready: () => ready,
      playing: () => state === STATE.PLAYING,
      state: () => state,
      position: position,
      durationMs: () => durationMs,
      play: play,
      pause: function () {
        if (ready) command('pauseVideo')
      },
      seek: function (ms) {
        if (!ready || !isNum(ms)) return
        const sec = Math.max(0, Math.min(MAX_SECONDS, ms / 1000))
        command('seekTo', [sec, true])
        lastTimeMs = Math.round(sec * 1000)
        lastTimeAt = now()
      },
      setVolume: function (value) {
        if (!isNum(value)) return
        volume = Math.max(0, Math.min(100, Math.round(value)))
        if (ready) command('setVolume', [volume])
      },
      setMuted: function (value) {
        muted = value === true
        if (ready) command(muted ? 'mute' : 'unMute')
      },
      visible: visible,
      element: () => frame,
      destroy: destroy
    })
  }

  return Object.freeze({
    VERSION: VERSION,
    ORIGIN: ORIGIN,
    SANDBOX: SANDBOX,
    ALLOW: ALLOW,
    REFERRER_POLICY: REFERRER_POLICY,
    FRAME_CLASS: FRAME_CLASS,
    MIN_SIZE: MIN_SIZE,
    STATE: Object.freeze(Object.assign({}, STATE)),
    buildEmbedUrl: buildEmbedUrl,
    parseMessage: parseMessage,
    create: create
  })
})(typeof self !== 'undefined' ? self : this)
