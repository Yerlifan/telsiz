'use strict'

// Yüzen pencere (istek 7 ve 16): ses odasındayken (özel mesaj araması dahil) uygulama görünmüyorsa odadaki
// kameralar ya da profil fotoğrafları her zaman üstte kalan küçük bir pencerede görünür. Kamerası açık kişiler
// büyük kutularda, kamerası kapalı olanlar altta küçük avatar şeridinde durur, konuşan kişinin çevresinde canlı
// renkli halka yanar. Kamera yoksa yalnızca avatarlar görünür. İzlenen bir ekran paylaşımı varsa pencere o
// yayını gösterir. Kendi ekranını paylaşan kişinin penceresi odayı ve "Ekranınız yayında · Durdur" satırını
// gösterir (kendi ekranının önizlemesi ayna etkisi yaratırdı).
//
// Pencerenin yolu (floatMode, sırayla denenir):
// - 'desktop': masaüstü uygulaması (window.telsizDesktop.float). Electron 44'te belge resim içinde resim var
//   görünür ama açtığı pencere görünmez, bu yüzden önce denetlenir. Sayfa ana süreçten tek kullanımlık bir ad alır
//   ve window.open('about:blank', ad) çağırır, ana süreç her zaman üstte kalan çerçevesiz bir pencere verir
//   (desktop/src/lib/float-window.js). Pencere simge durumuna küçültülünce veya tepsiye gizlenince kendiliğinden
//   açılır, pencere geri gelince kapanır (telsizDesktop.onWindowState, ayar telsiz.floatAuto).
// - 'document': belge resim içinde resim (documentPictureInPicture, Chrome ve Edge 116, Firefox masaüstü 151).
//   Yüzen Pencere düğmesiyle açılır. Chrome ve Edge ses odasındaki sekmeden başka sekmeye geçilince de
//   kendiliğinden açar (navigator.mediaSession 'enterpictureinpicture' eylemi, ayar telsiz.floatAuto). Tarayıcı
//   simge durumuna küçültülünce kendiliğinden açılmaz.
// - 'video': görüntü resim içinde resim yedeği (Safari, Android Chrome). Kutular 480x270 bir tuvale saniyede 15
//   kare çizilir, tuvalin akışı bir görüntü öğesinde resim içinde resim olarak açılır. Pencerede düğme yoktur,
//   mikrofon işletim sisteminin medya denetimlerinden açılıp kapanabilir (togglemicrophone). İzlenen ekran
//   paylaşımında yayının kendi görüntü öğesi açılır.
//
// Pencerenin içeriğini bu sayfanın betiği çizer: düğümler bu sayfada üretilir ve yüzen belgeye eklenir, akışlar
// aynı süreçte paylaşılır. Uygulama penceresi gizliyken onun çizim döngüsü (requestAnimationFrame) durur, bu
// yüzden çizim yüzen belgenin kendi döngüsüyle yapılır. Ses kancaları (10-voice.js voiceHook): 'change' her ses
// anlık görüntüsünde çizimi zamanlar, 'render' telsiz kartı yeniden çizilince araç satırındaki Yüzen Pencere
// düğmesini günceller. Görüntü öğeleri 'float-' önekiyle tutulur (cameraVideoFor), kapanınca bırakılır.
// Biçem: açan sayfanın stil dosyaları ve kök öznitelikleri (tema, renk düzeni, yazı boyutu) kopyalanır. Satır içi
// stil yoktur (CSP), görünüm public/css/yuzen.css içindedir.
//
// Kontroller: Mikrofon, Uygulamaya Dön, Kapat. Ayrıl düğmesi bilerek yoktur (kazara basılabilir).
// Sunucuya hiçbir şey gitmez. Ayar yalnızca bu cihazda: telsiz.floatAuto ('off' kapalı, varsayılan açık).

const FLOAT_MAX_CAMS = 4
const FLOAT_MAX_AVATARS = 8
const FLOAT_DOC_SIZE = { width: 340, height: 240 }
const FLOAT_VIDEO_W = 480
const FLOAT_VIDEO_H = 270
const FLOAT_VIDEO_FPS = 15
// Yüzen belgenin çizim döngüsü çalışmazsa (pencere henüz gösterilmedi) çizim bu süre sonra yapılır
const FLOAT_FALLBACK_MS = 250
// Masaüstü penceresinin kapanması pagehide ile gelmezse açık olup olmadığı bu aralıkla denetlenir
const FLOAT_WATCH_MS = 1000
// Yüzen belgenin stil dosyaları en çok bu süre beklenir, sonra içerik yine de gösterilir
const FLOAT_STYLE_WAIT_MS = 3000
// Kök öğeden yüzen belgeye kopyalanan öznitelikler (theme-init.js)
const FLOAT_ROOT_ATTRS = ['lang', 'dir', 'data-skin', 'data-scheme', 'data-font-size', 'data-compact', 'data-reduce-motion']

const floatState = {
  started: false,
  // Açık pencere: yol ('desktop' | 'document' | 'video'), açılış nedeni ('auto' | 'button' | 'share-own' |
  // 'share'), pencere ve belgesi (desktop ve document yollarında)
  mode: null,
  reason: null,
  win: null,
  doc: null,
  nodes: null,
  key: '',
  queued: false,
  opening: false,
  watchTimer: 0,
  // Görüntü yedeği: tuval, çizim bağlamı, kaynak görüntü öğesi ve zamanlayıcı
  video: null,
  // İzlenen yayın için yüzen belgedeki görüntü öğesi
  shareVideo: null,
  // Masaüstünde pencerenin son durumu ('minimized' | 'restored' | 'hidden' | 'shown')
  windowState: null,
  // Tarayıcıda otomatik açılış işleyicisi kayıtlı mı, eylem desteklenmiyor mu
  msBound: false,
  msUnsupported: false,
  // Video yedeğinde mikrofon eylemi kayıtlı mı
  msMic: false,
  // Avatar resimleri (tuvale çizim için), adres başına
  images: Object.create(null)
}

// ------------------------------------------------------------------ yol ve ayar

function floatBgMode () {
  return typeof bgModeActive === 'function' && bgModeActive()
}

// Bu cihazda yüzen pencerenin yolu: 'desktop', 'document', 'video' veya null (desteklenmiyor)
function floatMode () {
  const d = window.telsizDesktop
  if (d && d.float && typeof d.float.arm === 'function') return 'desktop'
  const dpip = window.documentPictureInPicture
  if (dpip && typeof dpip.requestWindow === 'function') return 'document'
  const V = window.HTMLVideoElement
  const C = window.HTMLCanvasElement
  if (document.pictureInPictureEnabled === true && V && C && typeof V.prototype.requestPictureInPicture === 'function' && typeof C.prototype.captureStream === 'function') return 'video'
  return null
}

// Ayar (11-settings.js floatAutoEnabled): simge durumunda, tepsiye gizlenince veya sekme değişince açılsın mı
function floatAutoOn () {
  return typeof floatAutoEnabled === 'function' ? floatAutoEnabled() : true
}

function floatInRoom (s) {
  return Boolean(s && s.channelId !== null && s.channelId !== undefined && s.channelId !== '')
}

function floatIsOpen () {
  return floatState.mode !== null
}

// ------------------------------------------------------------------ plan (saf)

// floatPlan girdisi: o anki ses durumundan toplanır
function floatInput () {
  const s = snap()
  const room = floatInRoom(s)
  const me = state.me ? String(state.me.id) : null
  const roster = room ? voiceRoster(s.channelId).map((entry) => String(entry.userId)) : []
  const streams = room && typeof cameraStreams === 'function' ? cameraStreams(s) : {}
  const cams = {}
  Object.keys(streams).forEach((id) => {
    cams[id] = streams[id].stream && streams[id].stream.id ? String(streams[id].stream.id) : '1'
  })
  const sc = room && typeof radioScreen === 'function' ? radioScreen(s) : null
  const remote = sc && sc.remote && typeof sc.remote === 'object' ? sc.remote : {}
  const watched = typeof castState === 'object' && castState && castState.watching ? String(castState.watching) : null
  return {
    room,
    me,
    roster,
    cams,
    speaking: roster.filter((id) => typeof speakingIn === 'function' && speakingIn(s, id)),
    watching: watched && remote[watched] ? watched : null,
    sharing: Boolean(sc && sc.state === 'live')
  }
}

// Yüzen pencerede ne görünür. Girdi: { room, me, roster: [kimlik], cams: { kimlik: akış kimliği }, speaking:
// [kimlik], watching: izlenen paylaşımın sahibi veya null, sharing: kendi paylaşımım sürüyor mu }.
// Çıktı: { kind: 'share' | 'cams' | 'avatars', tiles: [{ id, cam, self, speaking }], more, sharing, watching }.
// Kural: izlenen paylaşım varsa yalnızca o (share). Kamera varsa en fazla 4 kamera kutusu, kamerası kapalı kişiler
// en fazla 8 avatarlık şeritte (cams). Kamera yoksa en fazla 8 avatar (avatars). Kendiniz her zaman sondasınız.
// Gösterilemeyen kişi sayısı more'dadır ("+N kişi").
function floatPlan (s) {
  const o = s || {}
  const roster = Array.isArray(o.roster) ? o.roster.map(String) : []
  const cams = o.cams && typeof o.cams === 'object' ? o.cams : {}
  const speaking = Array.isArray(o.speaking) ? o.speaking.map(String) : []
  const me = o.me === null || o.me === undefined ? null : String(o.me)
  const tile = (id) => ({ id, cam: Object.prototype.hasOwnProperty.call(cams, id), self: id === me, speaking: speaking.indexOf(id) !== -1 })
  const plan = { kind: 'avatars', tiles: [], more: 0, sharing: o.room === true && o.sharing === true, watching: null }
  if (o.room !== true) return plan
  if (o.watching && roster.indexOf(String(o.watching)) !== -1) {
    plan.kind = 'share'
    plan.watching = String(o.watching)
    plan.tiles = [tile(plan.watching)]
    return plan
  }
  const unique = roster.filter((id, i) => roster.indexOf(id) === i)
  const ordered = unique.filter((id) => id !== me).concat(unique.filter((id) => id === me))
  const camIds = ordered.filter((id) => Object.prototype.hasOwnProperty.call(cams, id))
  if (camIds.length) {
    const shownCams = camIds.slice(0, FLOAT_MAX_CAMS)
    const rest = ordered.filter((id) => camIds.indexOf(id) === -1)
    const shownAvatars = rest.slice(0, FLOAT_MAX_AVATARS)
    plan.kind = 'cams'
    plan.tiles = shownCams.concat(shownAvatars).map(tile)
    plan.more = camIds.length - shownCams.length + rest.length - shownAvatars.length
    return plan
  }
  const shown = ordered.slice(0, FLOAT_MAX_AVATARS)
  plan.tiles = shown.map(tile)
  plan.more = ordered.length - shown.length
  return plan
}

// ------------------------------------------------------------------ açma ve kapama

// reason: 'auto' (simge durumu, tepsi, sekme değişimi), 'button' (Yüzen Pencere düğmesi), 'share-own' (kendi
// yayınının başlığı), 'share' (izlenen yayının başlığı). Dönen Promise pencere açılınca true, açılamazsa false.
function floatOpen (reason) {
  const why = typeof reason === 'string' ? reason : 'button'
  const manual = why !== 'auto'
  if (floatIsOpen()) {
    floatState.reason = manual ? why : floatState.reason
    floatSchedule()
    return Promise.resolve(true)
  }
  if (floatState.opening || floatBgMode()) return Promise.resolve(false)
  if (!floatInRoom(snap())) return Promise.resolve(false)
  const mode = floatMode()
  if (!mode) {
    if (manual) toast(() => t('float.unsupported'), 'error', 6000)
    return Promise.resolve(false)
  }
  floatState.opening = true
  let pending
  try {
    if (mode === 'desktop') pending = floatOpenDesktop(why)
    else if (mode === 'document') pending = window.documentPictureInPicture.requestWindow({ width: FLOAT_DOC_SIZE.width, height: FLOAT_DOC_SIZE.height })
    else pending = floatOpenVideo(why)
  } catch (err) {
    pending = Promise.reject(err)
  }
  return Promise.resolve(pending).then((win) => {
    floatState.opening = false
    if (mode === 'video') return Boolean(win)
    if (!win) throw new Error('float_failed')
    floatAttach(win, mode, why)
    return true
  }).catch(() => {
    floatState.opening = false
    if (manual) toast(() => t('float.failed'), 'error', 6000)
    floatRenderTool()
    return false
  })
}

// Kendiliğinden açılışta ad beklenirken uygulama penceresi geri gelmiş olabilir (küçültülüp hemen geri yüklendi):
// pencere hiç açılmaz, kullanılmayan ad ana süreçte kendiliğinden geçersiz olur
function floatOpenDesktop (reason) {
  return window.telsizDesktop.float.arm().then((name) => {
    if (!name) return null
    if (reason === 'auto' && !floatAppAway()) return null
    return window.open('about:blank', name)
  })
}

// Masaüstünde uygulama penceresi simge durumunda veya tepsiye gizli mi (telsizDesktop.onWindowState son değeri)
function floatAppAway () {
  return floatState.windowState === 'minimized' || floatState.windowState === 'hidden'
}

function floatClose (reason) {
  if (!floatIsOpen()) return
  const mode = floatState.mode
  const win = floatState.win
  floatCleanup(reason || 'button')
  if (mode === 'video') {
    try {
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {})
    } catch (err) {
      // Pencere zaten kapandı
    }
    return
  }
  try {
    if (win && !win.closed) win.close()
  } catch (err) {
    // Pencere zaten kapandı
  }
}

function floatToggle (reason) {
  if (floatIsOpen()) floatClose('button')
  else floatOpen(reason || 'button')
}

// Pencere kapandı (Kapat düğmesi, tarayıcının kendi düğmesi, odadan ayrılma, uygulamaya dönüş): görüntü öğeleri
// ve zamanlayıcılar bırakılır
function floatCleanup () {
  if (!floatIsOpen()) return
  const v = floatState.video
  floatState.mode = null
  floatState.reason = null
  floatState.win = null
  floatState.doc = null
  floatState.nodes = null
  floatState.key = ''
  floatState.queued = false
  if (floatState.watchTimer) clearInterval(floatState.watchTimer)
  floatState.watchTimer = 0
  if (floatState.shareVideo) {
    try {
      floatState.shareVideo.srcObject = null
    } catch (err) {
      // Öğe zaten bırakıldı
    }
    floatState.shareVideo = null
  }
  if (v) {
    floatState.video = null
    clearInterval(v.timer)
    if (v.own) {
      // İzlenen yayının görüntü öğesi sahnede kalır, resim içinde resim izni geri kapanır
      v.video.setAttribute('disablepictureinpicture', '')
    } else {
      try {
        v.video.srcObject = null
      } catch (err) {
        // Öğe zaten bırakıldı
      }
      if (v.holder.parentNode) v.holder.parentNode.removeChild(v.holder)
    }
  }
  floatMediaMic(false)
  if (typeof pruneCameraVideos === 'function') pruneCameraVideos('float-', {})
  floatRenderTool()
}

// ------------------------------------------------------------------ yüzen belge (desktop ve document)

function floatAttach (win, mode, reason) {
  floatState.mode = mode
  floatState.reason = reason
  floatState.win = win
  floatState.doc = win.document
  floatState.key = ''
  floatPrepareDoc(win.document, mode)
  win.addEventListener('pagehide', () => {
    if (floatState.win === win) floatCleanup('closed')
  })
  win.document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') floatClose('key')
  })
  // Masaüstünde pencereyi ana süreç de kapatabilir (uygulama penceresi kapanınca), kapanış yedek olarak izlenir
  floatState.watchTimer = setInterval(() => {
    if (floatState.win === win && win.closed) floatCleanup('closed')
  }, FLOAT_WATCH_MS)
  floatRenderNow()
  floatRenderTool()
}

// Belgeye açan sayfanın stil dosyaları, kök öznitelikleri ve simge kümesi kopyalanır. Stil dosyaları yüklenene kadar
// (en çok FLOAT_STYLE_WAIT_MS) gövde görünmez, böylece biçemsiz içerik bir an bile görünmez. Gizleme satır içi stil
// özniteliği değil CSSOM ile yapılır (CSP).
function floatPrepareDoc (doc, mode) {
  const root = doc.documentElement
  floatCopyRoot(root)
  const head = doc.head || root.appendChild(doc.createElement('head'))
  const body = doc.body || root.appendChild(doc.createElement('body'))
  body.className = 'float-body'
  body.setAttribute('data-mode', mode)
  body.style.setProperty('visibility', 'hidden')
  let waiting = 0
  let timer = 0
  const reveal = () => {
    if (waiting > 0) return
    clearTimeout(timer)
    body.style.removeProperty('visibility')
  }
  Array.from(document.querySelectorAll('link[rel="stylesheet"]')).forEach((link) => {
    const copy = doc.createElement('link')
    copy.rel = 'stylesheet'
    copy.href = link.href
    waiting++
    const done = () => {
      copy.removeEventListener('load', done)
      copy.removeEventListener('error', done)
      waiting--
      reveal()
    }
    copy.addEventListener('load', done)
    copy.addEventListener('error', done)
    head.appendChild(copy)
  })
  timer = setTimeout(() => {
    waiting = 0
    reveal()
  }, FLOAT_STYLE_WAIT_MS)
  reveal()
  const sprite = floatSprite()
  if (sprite) body.appendChild(doc.importNode(sprite, true))
}

function floatCopyRoot (root) {
  const src = document.documentElement
  FLOAT_ROOT_ATTRS.forEach((name) => {
    const value = src.getAttribute(name)
    if (value === null) root.removeAttribute(name)
    else root.setAttribute(name, value)
  })
  // Elle ayarlanan yazı boyutu (theme-init.js --font-px): satır içi stil özniteliği değil CSSOM ile yazılır
  const px = src.style ? src.style.getPropertyValue('--font-px') : ''
  if (root.style) {
    if (px) root.style.setProperty('--font-px', px)
    else root.style.removeProperty('--font-px')
  }
}

// Simge kümesi (index.html başındaki gizli svg): yüzen belgedeki <use href="#..."> bunlara bakar
function floatSprite () {
  const symbol = document.querySelector('svg symbol[id^="i-"]')
  return symbol ? symbol.closest('svg') : null
}

// Çizim yüzen belgenin kendi döngüsüyle zamanlanır, döngü çalışmazsa kısa bir gecikmeyle yapılır
function floatSchedule () {
  if (!floatState.win || floatState.queued) return
  floatState.queued = true
  const run = () => {
    if (!floatState.queued) return
    floatState.queued = false
    floatRenderNow()
  }
  try {
    floatState.win.requestAnimationFrame(run)
  } catch (err) {
    // Pencere kapanıyor
  }
  setTimeout(run, FLOAT_FALLBACK_MS)
}

function floatRoomName (s) {
  if (s.private) {
    const me = state.me ? String(state.me.id) : null
    const other = voiceRoster(s.channelId).map((entry) => String(entry.userId)).filter((id) => id !== me)[0]
    return other ? shownName(other) : ''
  }
  return typeof castRoomName === 'function' ? castRoomName(s.channelId) : ''
}

// Yapı anahtarı: değişince pencerenin içi yeniden kurulur, değişmezse yalnızca konuşma halkası ve mikrofon güncellenir
function floatKey (plan, s, input) {
  const root = document.documentElement
  const avatars = plan.tiles.map((tile) => {
    const info = typeof avatarInfoFor === 'function' ? avatarInfoFor(tile.id) : null
    return tile.id + ':' + (tile.cam ? 1 : 0) + ':' + shownName(tile.id) + ':' + (info && info.blobUrl ? info.blobUrl : '')
  })
  const camKey = Object.keys(input.cams).sort().map((id) => id + '=' + input.cams[id]).join(',')
  return [plan.kind, avatars.join(','), plan.more, plan.sharing ? 1 : 0, plan.watching || '', camKey, floatRoomName(s), window.I18N ? window.I18N.lang : '', root.getAttribute('data-skin'), root.getAttribute('data-scheme'), root.getAttribute('data-font-size')].join('|')
}

function floatRenderNow () {
  const doc = floatState.doc
  if (!doc || floatState.mode === 'video') return
  const s = snap()
  if (!floatInRoom(s)) {
    floatClose('left')
    return
  }
  const input = floatInput()
  const plan = floatPlan(input)
  const key = floatKey(plan, s, input)
  if (key !== floatState.key || !floatState.nodes) {
    floatState.key = key
    floatBuild(doc, plan, s)
  }
  floatLive(plan, s)
}

function floatButton (className, iconName, label) {
  const b = h('button', 'float-button ' + className)
  b.type = 'button'
  b.appendChild(icon(iconName))
  b.setAttribute('aria-label', label)
  b.title = label
  return b
}

function floatPlay (v) {
  if (!v || !v.paused) return
  try {
    const p = v.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  } catch (err) {
    // Oynatılamayan öğe ilk karesini bekler
  }
}

function floatBuild (doc, plan, s) {
  floatCopyRoot(doc.documentElement)
  const body = doc.body
  const keepSprite = body.querySelector('svg')
  Array.from(body.childNodes).forEach((node) => {
    if (node !== keepSprite) body.removeChild(node)
  })
  body.setAttribute('data-kind', plan.kind)
  const n = {}
  doc.title = t('float.title', { room: floatRoomName(s) || 'Telsiz' })

  const head = h('header', 'float-head')
  const led = h('span', 'cast-led is-live')
  led.setAttribute('aria-hidden', 'true')
  head.appendChild(led)
  n.title = h('span', 'float-title', floatRoomName(s))
  head.appendChild(n.title)
  body.appendChild(head)

  if (plan.sharing) {
    const bar = h('div', 'float-share-bar')
    bar.setAttribute('role', 'status')
    const rec = h('span', 'cast-led is-rec')
    rec.setAttribute('aria-hidden', 'true')
    bar.appendChild(rec)
    bar.appendChild(h('span', 'float-share-text', t('cast.ownChip')))
    const stop = h('button', 'float-share-stop')
    stop.type = 'button'
    stop.appendChild(icon('i-stop'))
    stop.appendChild(h('span', 'float-share-stop-text', t('cast.stopShort')))
    stop.setAttribute('aria-label', t('screen.stop'))
    stop.addEventListener('click', () => {
      if (typeof castStopShare === 'function') castStopShare()
    })
    bar.appendChild(stop)
    body.appendChild(bar)
  }

  const stage = h('div', 'float-stage')
  const keep = {}
  if (plan.kind === 'share') {
    floatBuildShare(stage, plan, s)
  } else {
    // İzlenen yayın bitti veya bırakıldı: yayının görüntü öğesi bırakılır
    if (floatState.shareVideo) {
      try {
        floatState.shareVideo.srcObject = null
      } catch (err) {
        // Öğe zaten bırakıldı
      }
      floatState.shareVideo = null
    }
    const streams = typeof cameraStreams === 'function' ? cameraStreams(s) : {}
    const big = h('div', 'float-cams')
    const strip = h('div', plan.kind === 'cams' ? 'float-strip' : 'float-avatars')
    plan.tiles.forEach((tile) => {
      if (tile.cam && streams[tile.id]) {
        const node = h('div', 'float-tile is-cam' + (tile.self ? ' is-self' : ''))
        node.setAttribute('data-user-id', tile.id)
        const frame = h('div', 'float-frame')
        const av = avatar(tile.id, 'lg', 'float-avatar')
        av.removeAttribute('data-status')
        frame.appendChild(av)
        const v = cameraVideoFor('float-' + tile.id, streams[tile.id].stream, streams[tile.id].self)
        frame.appendChild(v)
        keep['float-' + tile.id] = true
        node.appendChild(frame)
        node.appendChild(h('span', 'float-name', tile.self ? t('cast.you') : shownName(tile.id)))
        big.appendChild(node)
      } else {
        const node = h('div', 'float-tile' + (tile.self ? ' is-self' : ''))
        node.setAttribute('data-user-id', tile.id)
        const av = avatar(tile.id, plan.kind === 'cams' ? 'sm' : 'lg', 'float-avatar')
        av.removeAttribute('data-status')
        node.appendChild(av)
        node.appendChild(h('span', 'float-name', tile.self ? t('cast.you') : shownName(tile.id)))
        strip.appendChild(node)
      }
    })
    big.setAttribute('data-count', String(big.childNodes.length))
    if (big.firstChild) stage.appendChild(big)
    if (plan.more > 0) strip.appendChild(h('span', 'float-more', t('float.more', { count: plan.more })))
    if (strip.firstChild) stage.appendChild(strip)
  }
  body.appendChild(stage)
  if (typeof pruneCameraVideos === 'function') pruneCameraVideos('float-', keep)
  Array.from(stage.querySelectorAll('video')).forEach(floatPlay)

  const controls = h('div', 'float-controls')
  n.mic = floatButton('float-mic', 'i-mic', t('user.mute'))
  n.mic.addEventListener('click', () => {
    if (typeof toggleMute === 'function') toggleMute()
  })
  controls.appendChild(n.mic)
  const back = h('button', 'float-button float-back')
  back.type = 'button'
  back.appendChild(icon('i-back'))
  back.appendChild(h('span', 'float-button-text', t('float.backToApp')))
  back.addEventListener('click', floatBackToApp)
  controls.appendChild(back)
  const close = floatButton('float-close', 'i-close', t('float.close'))
  close.addEventListener('click', () => {
    floatClose('button')
  })
  controls.appendChild(close)
  body.appendChild(controls)
  floatState.nodes = n
}

// İzlenen yayın: yayının akışı yüzen belgedeki kendi görüntü öğesinde oynar
function floatBuildShare (stage, plan, s) {
  const box = h('div', 'float-share')
  let v = floatState.shareVideo
  if (!v) {
    v = h('video', 'float-share-video')
    v.muted = true
    v.autoplay = true
    v.playsInline = true
    v.setAttribute('muted', '')
    v.setAttribute('playsinline', '')
    floatState.shareVideo = v
  }
  v.setAttribute('aria-label', t('screen.sharingUser', { name: shownName(plan.watching) }))
  floatBindShare(v, floatShareStream(s, plan.watching))
  box.appendChild(v)
  box.appendChild(h('span', 'float-name', t('screen.sharingUser', { name: shownName(plan.watching) })))
  stage.appendChild(box)
}

// Yayının akışı görüntü öğesine bağlanır. Akış pencere açıldıktan sonra da gelebilir (İzle'ye yeni basıldı, yayın
// henüz 'requested' aşamasında veya bağlantı yenilendi) ve yenisiyle değişebilir: her çizimde yeniden denetlenir.
function floatBindShare (v, stream) {
  if (v.srcObject !== stream) {
    try {
      v.srcObject = stream
    } catch (err) {
      v.srcObject = null
    }
  }
  if (stream) floatPlay(v)
}

function floatShareStream (s, userId) {
  const sc = typeof radioScreen === 'function' ? radioScreen(s) : null
  const rs = sc && sc.remote ? sc.remote[userId] : null
  if (rs && rs.stream) return rs.stream
  if (typeof castCall === 'function') {
    const got = castCall('getScreenStream', [userId])
    if (got && typeof got === 'object') return got
  }
  return null
}

// Sık değişenler: izlenen yayının akışı, konuşma halkası, mikrofon düğmesi, oda adı
function floatLive (plan, s) {
  const doc = floatState.doc
  const n = floatState.nodes
  if (!doc || !n) return
  if (plan.kind === 'share' && floatState.shareVideo) floatBindShare(floatState.shareVideo, floatShareStream(s, plan.watching))
  const speaking = {}
  plan.tiles.forEach((tile) => {
    speaking[tile.id] = tile.speaking
  })
  Array.from(doc.querySelectorAll('.float-tile[data-user-id]')).forEach((node) => {
    node.classList.toggle('is-speaking', Boolean(speaking[node.getAttribute('data-user-id')]))
  })
  const muted = Boolean(s.muted)
  n.mic.setAttribute('aria-pressed', muted ? 'true' : 'false')
  n.mic.classList.toggle('is-off', muted)
  setIcon(n.mic, muted ? 'i-mic-off' : 'i-mic')
  const room = floatRoomName(s)
  if (n.title.textContent !== room) n.title.textContent = room
}

// Uygulamaya Dön: masaüstünde uygulama penceresi öne gelir, tarayıcıda sekmeye dönülmeye çalışılır. Pencere kapanır.
function floatBackToApp () {
  const d = window.telsizDesktop
  if (d && d.float && typeof d.float.showMain === 'function') {
    d.float.showMain().catch(() => false)
  } else {
    try {
      window.focus()
    } catch (err) {
      // Tarayıcı izin vermedi
    }
  }
  floatClose('back')
}

// ------------------------------------------------------------------ görüntü yedeği (video)

// Tuvalden üretilen akış bir görüntü öğesinde resim içinde resim olarak açılır. İzlenen yayında yayının kendi
// görüntü öğesi açılır, sahnede duran öğenin disablePictureInPicture özniteliği istekten hemen önce kaldırılır.
function floatOpenVideo (reason) {
  const plan = floatPlan(floatInput())
  if (plan.kind === 'share') {
    const stageVideo = typeof castState === 'object' && castState && castState.nodes ? castState.nodes.video : null
    if (stageVideo && stageVideo.srcObject) return floatRequestVideo(stageVideo, true, reason)
  }
  const holder = h('div', 'float-pip-source')
  holder.setAttribute('aria-hidden', 'true')
  const canvas = h('canvas', 'float-pip-canvas')
  canvas.width = FLOAT_VIDEO_W
  canvas.height = FLOAT_VIDEO_H
  const video = h('video', 'float-pip-video')
  video.muted = true
  video.playsInline = true
  video.setAttribute('muted', '')
  video.setAttribute('playsinline', '')
  holder.appendChild(canvas)
  holder.appendChild(video)
  document.body.appendChild(holder)
  const g = canvas.getContext('2d')
  const v = { canvas, g, video, holder, timer: 0, own: false, tiles: [] }
  floatState.video = v
  floatDrawCanvas()
  video.srcObject = canvas.captureStream(FLOAT_VIDEO_FPS)
  v.timer = setInterval(floatDrawCanvas, Math.round(1000 / FLOAT_VIDEO_FPS))
  return floatRequestVideo(video, false, reason).catch((err) => {
    // İstek reddedildi (kullanıcı hareketi yok, tarayıcı izin vermedi): tuval ve zamanlayıcı bırakılır
    if (floatState.video === v) floatState.video = null
    clearInterval(v.timer)
    try {
      video.srcObject = null
    } catch (err2) {
      // Öğe zaten bırakıldı
    }
    if (holder.parentNode) holder.parentNode.removeChild(holder)
    if (typeof pruneCameraVideos === 'function') pruneCameraVideos('float-', {})
    throw err
  })
}

function floatRequestVideo (video, own, reason) {
  if (own) {
    video.removeAttribute('disablepictureinpicture')
    video.disablePictureInPicture = false
    floatState.video = { video, holder: null, timer: 0, own: true }
  }
  const p = video.play()
  return Promise.resolve(p).catch(() => {}).then(() => video.requestPictureInPicture()).then(() => {
    floatState.mode = 'video'
    floatState.reason = reason
    const onLeave = () => {
      video.removeEventListener('leavepictureinpicture', onLeave)
      if (floatState.mode === 'video') floatCleanup('closed')
    }
    video.addEventListener('leavepictureinpicture', onLeave)
    floatMediaMic(true)
    floatRenderTool()
    return true
  }, (err) => {
    if (own) {
      video.setAttribute('disablepictureinpicture', '')
      floatState.video = null
    }
    throw err
  })
}

// Video yedeğinde pencerede düğme yoktur: mikrofon işletim sisteminin medya denetimlerinden açılıp kapanır
function floatMediaMic (on) {
  const ms = navigator.mediaSession
  if (!ms || typeof ms.setActionHandler !== 'function' || floatState.msMic === on) return
  try {
    ms.setActionHandler('togglemicrophone', on ? () => {
      if (typeof toggleMute === 'function') toggleMute()
    } : null)
    floatState.msMic = on
    if (on) floatMediaMicState()
  } catch (err) {
    floatState.msMic = false
  }
}

function floatMediaMicState () {
  const ms = navigator.mediaSession
  if (!floatState.msMic || !ms || typeof ms.setMicrophoneActive !== 'function') return
  try {
    ms.setMicrophoneActive(!snap().muted)
  } catch (err) {
    // Desteklenmiyor
  }
}

function floatCss (name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name)
  return value && value.trim() ? value.trim() : fallback
}

function floatRoundRect (g, x, y, w, h2, r) {
  const rad = Math.max(0, Math.min(r, w / 2, h2 / 2))
  g.beginPath()
  g.moveTo(x + rad, y)
  g.arcTo(x + w, y, x + w, y + h2, rad)
  g.arcTo(x + w, y + h2, x, y + h2, rad)
  g.arcTo(x, y + h2, x, y, rad)
  g.arcTo(x, y, x + w, y, rad)
  g.closePath()
}

function floatImage (url) {
  let img = floatState.images[url]
  if (!img) {
    img = new Image()
    img.src = url
    floatState.images[url] = img
  }
  return img.complete && img.naturalWidth > 0 ? img : null
}

function floatDrawAvatar (g, id, x, y, size, colors) {
  const info = avatarInfoFor(id)
  floatRoundRect(g, x, y, size, size, size * 0.28)
  g.save()
  g.clip()
  const img = info.blobUrl ? floatImage(info.blobUrl) : null
  if (img) {
    g.drawImage(img, x, y, size, size)
  } else {
    g.fillStyle = floatCss('--av-' + info.colorIndex, colors.surface)
    g.fillRect(x, y, size, size)
    g.fillStyle = floatCss('--av-fg-' + info.colorIndex, floatCss('--av-fg', colors.text))
    g.font = '700 ' + Math.round(size * 0.42) + 'px sans-serif'
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    g.fillText(info.initial || '', x + size / 2, y + size / 2)
  }
  g.restore()
}

function floatDrawName (g, text, x, y, w, colors) {
  g.font = '600 13px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'top'
  g.fillStyle = colors.text
  let label = String(text)
  while (label.length > 1 && g.measureText(label).width > w) label = label.slice(0, -2) + '…'
  g.fillText(label, x + w / 2, y)
}

// Tuvale bir kare: kamera kutuları üstte, avatarlar altta veya ortada, konuşanın çevresinde halka
function floatDrawCanvas () {
  const v = floatState.video
  if (!v || v.own) return
  const g = v.g
  const W = FLOAT_VIDEO_W
  const H = FLOAT_VIDEO_H
  const s = snap()
  const plan = floatPlan(floatInput())
  const colors = { bg: floatCss('--bg', '#0f1015'), surface: floatCss('--surface-2', '#1d1e27'), text: floatCss('--text', '#f2f1f8'), live: floatCss('--live', '#45db9c'), danger: floatCss('--danger', '#ff8796') }
  g.fillStyle = colors.bg
  g.fillRect(0, 0, W, H)
  let top = 0
  if (plan.sharing) {
    g.fillStyle = colors.danger
    g.beginPath()
    g.arc(16, 16, 5, 0, Math.PI * 2)
    g.fill()
    g.font = '600 14px sans-serif'
    g.textAlign = 'left'
    g.textBaseline = 'middle'
    g.fillStyle = colors.text
    g.fillText(t('cast.ownChip'), 28, 16)
    top = 32
  }
  const streams = typeof cameraStreams === 'function' ? cameraStreams(s) : {}
  const camTiles = plan.tiles.filter((tile) => tile.cam && streams[tile.id])
  const avatars = plan.tiles.filter((tile) => !(tile.cam && streams[tile.id]))
  const keep = {}
  if (camTiles.length) {
    const stripH = avatars.length || plan.more ? 64 : 0
    const areaH = H - top - stripH
    const cols = camTiles.length === 1 ? 1 : 2
    const rows = Math.ceil(camTiles.length / cols)
    const cw = W / cols
    const ch = areaH / rows
    camTiles.forEach((tile, i) => {
      const x = (i % cols) * cw + 4
      const y = top + Math.floor(i / cols) * ch + 4
      const w = cw - 8
      const hh = ch - 8
      const el2 = cameraVideoFor('float-' + tile.id, streams[tile.id].stream, streams[tile.id].self)
      keep['float-' + tile.id] = true
      if (el2.parentNode !== v.holder) v.holder.appendChild(el2)
      floatPlay(el2)
      floatRoundRect(g, x, y, w, hh, 10)
      g.save()
      g.clip()
      g.fillStyle = colors.surface
      g.fillRect(x, y, w, hh)
      if (el2.readyState >= 2 && el2.videoWidth > 0) {
        const scale = Math.max(w / el2.videoWidth, hh / el2.videoHeight)
        const dw = el2.videoWidth * scale
        const dh = el2.videoHeight * scale
        g.drawImage(el2, x + (w - dw) / 2, y + (hh - dh) / 2, dw, dh)
      } else {
        const size = Math.min(w, hh) * 0.5
        floatDrawAvatar(g, tile.id, x + (w - size) / 2, y + (hh - size) / 2, size, colors)
      }
      g.restore()
      if (tile.speaking) {
        g.lineWidth = 4
        g.strokeStyle = colors.live
        floatRoundRect(g, x, y, w, hh, 10)
        g.stroke()
      }
    })
    top += areaH
  }
  if (avatars.length || plan.more) {
    const size = camTiles.length ? 36 : 56
    const gapX = camTiles.length ? 10 : 14
    const per = avatars.length + (plan.more ? 1 : 0)
    const rowW = Math.min(W, per * (size + gapX))
    let x = (W - rowW) / 2 + gapX / 2
    const rowsAvail = camTiles.length ? 1 : 2
    const perRow = Math.max(1, Math.ceil(per / rowsAvail))
    const lineH = size + 22
    const startY = camTiles.length ? top + 6 : top + Math.max(6, (H - top - rowsAvail * lineH) / 2)
    avatars.forEach((tile, i) => {
      const row = Math.floor(i / perRow)
      const col = i % perRow
      const rowCount = Math.min(perRow, per - row * perRow)
      const rowWidth = rowCount * (size + gapX)
      x = (W - rowWidth) / 2 + gapX / 2 + col * (size + gapX)
      const y = startY + row * lineH
      if (tile.speaking) {
        g.lineWidth = 4
        g.strokeStyle = colors.live
        floatRoundRect(g, x - 4, y - 4, size + 8, size + 8, (size + 8) * 0.28)
        g.stroke()
      }
      floatDrawAvatar(g, tile.id, x, y, size, colors)
      if (!camTiles.length) floatDrawName(g, tile.self ? t('cast.you') : shownName(tile.id), x - gapX / 2, y + size + 4, size + gapX, colors)
    })
    if (plan.more) {
      g.font = '600 14px sans-serif'
      g.textAlign = 'right'
      g.textBaseline = 'bottom'
      g.fillStyle = colors.text
      g.fillText(t('float.more', { count: plan.more }), W - 10, H - 8)
    }
  }
  if (typeof pruneCameraVideos === 'function') pruneCameraVideos('float-', keep)
  floatMediaMicState()
  if (!floatInRoom(s) && floatState.mode === 'video') floatClose('left')
}

// ------------------------------------------------------------------ araç satırındaki düğme

// Yüzen Pencere düğmesi telsiz kartının araç satırında (#radio-tools) Oyun düğmesinden (yoksa Telsiz DJ
// düğmesinden) hemen önce durur: sıra Büyüt, Yüzen Pencere, Oyun, Telsiz DJ. Oyun düğmesi (36-oyun.js
// gameRenderTool) kendini Telsiz DJ'nin hemen önüne koyar, iki düğme aynı yeri isteseydi her çizimde yer
// değiştirir ve odaktaki düğme odağı kaybederdi. Ses odasında değilken veya bu cihazda yüzen pencere yokken
// kaldırılır. Basınca açar, açıksa kapatır.
function floatRenderTool () {
  const box = el.radioTools
  if (!box) return
  let b = byId('radio-float')
  const show = floatInRoom(snap()) && floatMode() !== null && !floatBgMode()
  // Satır düğme eklenince de sarılabilir (radio.css .radio-tools): Büyüt ve Telsiz DJ'nin adı kesilmez
  if (!show) {
    if (b && b.parentNode) b.parentNode.removeChild(b)
    return
  }
  if (!b) {
    b = h('button', 'radio-tool float-tool')
    b.type = 'button'
    b.id = 'radio-float'
    b.setAttribute('data-focus-key', 'tool-float')
    b.appendChild(icon('i-pip', 'radio-tool-icon'))
    b.addEventListener('click', () => {
      floatToggle('button')
    })
  }
  const game = byId('radio-game')
  const next = game && game.parentNode === box ? game : box.querySelector('.crew-dj')
  if (b.parentNode !== box || (next && b.nextElementSibling !== next)) box.insertBefore(b, next || null)
  const open = floatIsOpen()
  const label = open ? t('float.close') : t('float.openLabel')
  b.setAttribute('aria-pressed', open ? 'true' : 'false')
  b.setAttribute('aria-label', label)
  b.title = open ? t('float.close') : t('float.open')
}

// ------------------------------------------------------------------ olaylar

// Ses kancası 'change': her ses anlık görüntüsünde (uygulama gizliyken de) yüzen belge yeniden çizilir, odadan
// çıkınca pencere kapanır, tarayıcıdaki otomatik açılış işleyicisi güncellenir
function floatOnVoice (snapshot) {
  floatSyncMediaSession(snapshot)
  if (!floatIsOpen()) return
  if (!floatInRoom(snapshot)) {
    floatClose('left')
    return
  }
  if (floatState.mode === 'video') floatMediaMicState()
  else floatSchedule()
}

// Ses kancası 'render': telsiz kartı yeniden çizildi (kadro, kameralar, adlar)
function floatRender () {
  floatRenderTool()
  if (floatIsOpen() && floatState.mode !== 'video') floatSchedule()
}

// Masaüstü: pencere simge durumuna küçültülünce veya tepsiye gizlenince açılır, geri gelince kendiliğinden
// açılmış pencere kapanır (elle açılan pencere açık kalır)
function floatOnWindowState (value) {
  floatState.windowState = value
  if (floatAppAway()) {
    if (floatAutoOn() && floatInRoom(snap()) && !floatIsOpen()) floatOpen('auto')
  } else if (value === 'restored' || value === 'shown') {
    if (floatIsOpen() && floatState.reason === 'auto') floatClose('restore')
  }
}

// Tarayıcı (Chrome, Edge): ses odasındayken ve ayar açıkken başka sekmeye geçilince yüzen pencere kendiliğinden
// açılır. Tarayıcı bu eylemi kullanıcı hareketi olmadan çağırır, sekme yeniden görünür olunca pencereyi kapatır.
function floatSyncMediaSession (snapshot) {
  const ms = navigator.mediaSession
  if (floatState.msUnsupported || !ms || typeof ms.setActionHandler !== 'function') return
  const want = floatMode() === 'document' && floatAutoOn() && floatInRoom(snapshot || snap())
  if (want === floatState.msBound) return
  try {
    ms.setActionHandler('enterpictureinpicture', want ? () => {
      floatOpen('auto')
    } : null)
    floatState.msBound = want
  } catch (err) {
    // Bu tarayıcıda eylem yok
    floatState.msUnsupported = true
    floatState.msBound = false
  }
}

// Ayar değişti (11-settings.js)
function floatSettingsChanged () {
  floatSyncMediaSession(snap())
}

function floatStart () {
  if (floatState.started || floatBgMode()) return
  floatState.started = true
  if (typeof voiceHook === 'function') {
    voiceHook('change', floatOnVoice)
    voiceHook('render', floatRender)
  }
  const d = window.telsizDesktop
  if (d && typeof d.onWindowState === 'function') d.onWindowState(floatOnWindowState)
  // Sekme yeniden görünür olunca kendiliğinden açılmış belge penceresi kapanır (tarayıcı da kapatır)
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && floatIsOpen() && floatState.reason === 'auto' && floatState.mode === 'document') floatClose('visible')
  })
  window.addEventListener('pagehide', () => {
    floatClose('unload')
  })
}

floatStart()
