'use strict'

// Sahte YouTube gömülü oynatıcısı (yalnızca uçtan uca testler için, 06-dj.test.js). Playwright page.route ile
// https://www.youtube-nocookie.com/embed/<kimlik> isteklerine verilir, gerçek YouTube'a erişim yoktur.
//
// Taklit edilen yüzey: resmi IFrame Player API'nin (widgetapi) gömülü oynatıcıyla konuştuğu JSON dizesi
// postMessage iletileri. Bu ileti biçimi Google tarafından BELGELENMEMİŞTİR, açık kaynak oynatıcıların
// (vidstack 1.12, vime 5.4, youtube-iframe-ctrl 1.0) kullandığı biçim esas alınmıştır:
//   ana sayfa -> çerçeve: {"event":"listening","id":N,"channel":"widget"}
//                         {"event":"command","func":"playVideo"|"pauseVideo"|"seekTo"|"setVolume"|"mute"|
//                          "unMute"|"addEventListener"|"cueVideoById"|"loadVideoById","args":[...],"id":N,
//                          "channel":"widget"}
//   çerçeve -> ana sayfa: initialDelivery, onReady, infoDelivery { playerState, currentTime, duration,
//                         videoData: { title }, volume, muted }, onStateChange (info: durum), onError (info: kod)
// Belgelenmiş anlamlar (IFrame Player API başvurusu): durum kodları -1, 0, 1, 2, 3, 5, hata kodları 2, 5,
// 100, 101, 150, seekTo(saniye, allowSeekAhead), setVolume(0-100), origin ve enablejsapi parametreleri,
// onAutoplayBlocked olayı (tarayıcı betikle başlatılan oynatmayı engelleyince) ve seekTo davranışı: "If the
// player is paused when the function is called, it will remain paused. If the function is called from another
// state (playing, video cued, etc.), the player will play the video."
// Oynatma gerçek bir <audio> öğesiyle yapılır (tarayıcının kendiliğinden oynatma kuralı gerçekten uygulanır).
// Kimlik kuralları: D + üç basamak = süre saniyesi (D006... altı saniye), EMBEDOFF150 = gömmeye kapalı,
// L ile başlayan kimlik = yavaş ağ: her oynatma ve atlama 2,5 sn yükler (durum 3, konum ilerlemez).
// Kalıcı çerçeve (istek 13, ikinci aşama): cueVideoById aynı belgede yeni videoyu hazırlar (durum 5, ses
// başlamaz), loadVideoById hazırlayıp oynatır. İki komut da kimliği dizge olarak veya { videoId, startSeconds }
// nesnesiyle alır, çerçevenin adresi değişmez. Değişimden sonra önce yeni durum, ardından yeni videonun bilgisi
// (süre, ad, kimlik) gönderilir. F.framesTotal bu sekmede açılan sahte oynatıcı belgelerinin sayısıdır (aynı
// kökendeki çerçeveler sessionStorage'ı paylaşır), F.switches hazırlanan videoların kimlikleridir.

window.FAKE_INIT = (function () {
  const params = new URLSearchParams(location.search)
  const originParam = params.get('origin')
  const targetOrigin = originParam || '*'
  const FRAMES_KEY = 'sahteYoutubeCerceve'
  // Videoya ait bilgiler (cueVideoById ve loadVideoById ile değişir)
  let videoId = ''
  let duration = 120
  let embedOff = false
  let loadMs = 0
  let title = ''
  let loadTimer = null
  const subs = []
  let state = -1
  let widgetId = null
  let listening = false
  let ticker = null
  const F = window.FAKE = { videoId, originParam, enablejsapi: params.get('enablejsapi'), received: [], sent: [], subs, rejected: [], plays: 0, blocked: 0, errorsSent: 0, autoplayBlockedSent: 0, seeks: 0, everPlayed: false, playedAt: [], switches: [] }

  function useVideo (id) {
    const m = /^D(\d{3})/.exec(id)
    videoId = id
    duration = m ? Number(m[1]) : 120
    embedOff = id === 'EMBEDOFF150'
    loadMs = /^L/.test(id) ? 2500 : 0
    title = 'Fake video ' + id
    F.videoId = id
  }
  useVideo(location.pathname.split('/').pop())
  try {
    sessionStorage.setItem(FRAMES_KEY, String(Number(sessionStorage.getItem(FRAMES_KEY) || '0') + 1))
  } catch (err) {
    // Depolama yoksa sayaç tutulmaz
  }
  Object.defineProperty(F, 'framesTotal', {
    get: () => {
      try {
        return Number(sessionStorage.getItem(FRAMES_KEY) || '0')
      } catch (err) {
        return null
      }
    }
  })

  function wav (seconds, rate) {
    const n = Math.round(seconds * rate)
    const buf = new ArrayBuffer(44 + n * 2)
    const v = new DataView(buf)
    const str = (o, s) => {
      Array.prototype.forEach.call(s, (ch, i) => v.setUint8(o + i, ch.charCodeAt(0)))
    }
    str(0, 'RIFF')
    v.setUint32(4, 36 + n * 2, true)
    str(8, 'WAVE')
    str(12, 'fmt ')
    v.setUint32(16, 16, true)
    v.setUint16(20, 1, true)
    v.setUint16(22, 1, true)
    v.setUint32(24, rate, true)
    v.setUint32(28, rate * 2, true)
    v.setUint16(32, 2, true)
    v.setUint16(34, 16, true)
    str(36, 'data')
    v.setUint32(40, n * 2, true)
    let i = 0
    while (i < n) {
      v.setInt16(44 + i * 2, Math.round(Math.sin(i * 2 * Math.PI * 330 / rate) * 1500), true)
      i += 1
    }
    return new Blob([buf], { type: 'audio/wav' })
  }

  const audio = document.createElement('audio')
  audio.preload = 'auto'
  audio.src = URL.createObjectURL(wav(duration, 8000))
  document.body.appendChild(audio)
  F.audio = audio
  const label = document.createElement('div')
  label.textContent = title
  document.body.appendChild(label)

  function post (msg) {
    msg.id = widgetId
    msg.channel = 'widget'
    F.sent.push(msg.event)
    parent.postMessage(JSON.stringify(msg), targetOrigin)
  }

  function info () {
    return { playerState: state, currentTime: audio.currentTime, duration, videoData: { title, video_id: videoId }, volume: Math.round(audio.volume * 100), muted: audio.muted }
  }

  function setState (s) {
    if (s === state) return
    state = s
    F.state = s
    if (subs.indexOf('onStateChange') !== -1) post({ event: 'onStateChange', info: s })
    post({ event: 'infoDelivery', info: { playerState: s, currentTime: audio.currentTime } })
    clearInterval(ticker)
    if (s === 1) {
      ticker = setInterval(() => post({ event: 'infoDelivery', info: { currentTime: audio.currentTime, playerState: state } }), 250)
    }
  }
  F.setState = setState

  function sendError (code) {
    if (subs.indexOf('onError') === -1) return
    F.errorsSent++
    post({ event: 'onError', info: code })
  }

  audio.addEventListener('ended', () => setState(0))
  audio.addEventListener('playing', () => {
    F.everPlayed = true
    F.playedAt.push(audio.currentTime)
  })

  // Aynı belgede başka bir video: ses öğesinin kaynağı değişir, play doğruysa hemen oynatılır
  function switchVideo (args, play) {
    const a0 = args[0]
    const id = typeof a0 === 'string' ? a0 : (a0 && typeof a0.videoId === 'string' ? a0.videoId : null)
    const start = typeof a0 === 'string' ? args[1] : (a0 ? a0.startSeconds : 0)
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(id)) return
    clearTimeout(loadTimer)
    audio.pause()
    useVideo(id)
    F.switches.push(id)
    audio.src = URL.createObjectURL(wav(duration, 8000))
    audio.currentTime = typeof start === 'number' && start > 0 ? Math.min(duration, start) : 0
    label.textContent = title
    // Durum aynı kalsa da değişim bildirilir
    state = null
    setState(play ? -1 : 5)
    post({ event: 'infoDelivery', info: info() })
    if (embedOff) {
      sendError(150)
      return
    }
    if (play) startPlayback()
  }

  // Oynatmayı başlatır: yavaş kimlikte önce yükler (durum 3). Engellenirse onAutoplayBlocked gönderilir.
  function startPlayback () {
    clearTimeout(loadTimer)
    const go = () => {
      audio.play().then(() => setState(1), (err) => {
        F.blocked++
        if (err && err.name === 'NotAllowedError' && subs.indexOf('onAutoplayBlocked') !== -1) {
          F.autoplayBlockedSent++
          post({ event: 'onAutoplayBlocked' })
        }
      })
    }
    if (loadMs > 0) {
      audio.pause()
      setState(3)
      loadTimer = setTimeout(go, loadMs)
    } else {
      go()
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== parent) return
    if (originParam && e.origin !== originParam) {
      F.rejected.push(e.origin)
      return
    }
    let msg
    try {
      msg = JSON.parse(e.data)
    } catch (err) {
      return
    }
    F.received.push(msg.event === 'command' ? msg.func : msg.event)
    if (msg.event === 'listening') {
      if (!listening) {
        listening = true
        widgetId = msg.id
        post({ event: 'initialDelivery', info: info() })
        post({ event: 'onReady' })
        post({ event: 'infoDelivery', info: info() })
      }
      return
    }
    if (msg.event !== 'command') return
    const a = Array.isArray(msg.args) ? msg.args : []
    switch (msg.func) {
      case 'addEventListener':
        if (subs.indexOf(a[0]) === -1) subs.push(a[0])
        if (a[0] === 'onError' && embedOff) sendError(150)
        break
      case 'playVideo':
        F.plays++
        F.uaAtPlay = navigator.userActivation ? navigator.userActivation.hasBeenActive : null
        if (embedOff) {
          sendError(150)
          break
        }
        if (state !== 1 && state !== 3) startPlayback()
        break
      case 'pauseVideo':
        clearTimeout(loadTimer)
        audio.pause()
        setState(2)
        break
      case 'seekTo':
        F.seeks++
        if (typeof a[0] === 'number') audio.currentTime = Math.max(0, Math.min(duration, a[0]))
        post({ event: 'infoDelivery', info: { currentTime: audio.currentTime } })
        // Duraklatılmış oynatıcı duraklatılmış kalır, başka her durumda oynatma başlar (yavaşta yeniden yükler)
        if (state !== 2 && !embedOff && (state !== 1 || loadMs > 0)) startPlayback()
        break
      case 'setVolume':
        if (typeof a[0] === 'number') audio.volume = Math.max(0, Math.min(100, a[0])) / 100
        break
      case 'mute':
        audio.muted = true
        break
      case 'unMute':
        audio.muted = false
        break
      case 'cueVideoById':
        switchVideo(a, false)
        break
      case 'loadVideoById':
        switchVideo(a, true)
        break
      default:
        break
    }
  })
})()
