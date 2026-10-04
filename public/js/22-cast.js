'use strict'

// Ekran paylaşımı arayüzü (Ek L1, KONSEPT 7): paylaşım başlatma penceresi (#cast-dialog), yayın sahnesi
// (#cast: kendi önizlemen veya izlediğin paylaşım), sahne açıkken daraltılmış sohbet şeridi, odada biri
// paylaşmaya başlayınca bildirim ve üst çubuktaki yayında çipi (#top-cast).
//
// Motor public/voice.js içindeki VoiceClient'tır (sözleşme: scratchpad/screen-share-interface.json). Motor
// metin üretmez, durum ve hata kodlarını bildirir. Metinler i18n'deki screen.* (motorun) ve cast.* (bu
// dosyanın) anahtarlarındandır. Olaylar 10-voice.js createVoice içinde castOnScreenEvent'e iletilir, durum
// her olayda voice.snapshot().screen üzerinden yeniden okunur (castSync).
//
// Durum öznitelikleri (diğer bileşenler için sözleşme, K7.2):
// - body[data-cast="live"]: yayın sahnesi görünür (izleme veya kendi paylaşımının önizlemesi). Bu sırada
//   DJ kartı (#dj) kendi sütununda durmaz, kadrodaki "Telsiz DJ" öğesinden açılan sayfaya iner (23-dj.js).
//   Sahne kapanınca öznitelik kaldırılır.
// - body[data-cast-chat="open" | "closed"]: sahne açıkken sohbetin açık mı daraltılmış mı olduğu. Kamera
//   ızgarasında sohbet varsayılan olarak açıktır (son mesajlar sahnenin altında görünür).
// - body[data-cast-mode="watch" | "own" | "cams"]: #cast[data-mode] ile aynı. Kamera ızgarasında sağ sütun
//   (İstasyonlar) gizlenmez, sahne yalnızca konuşma sütununu kaplar (frekans.css).
// - #cast[data-mode="watch" | "own" | "cams"]: sahnenin kipi. cams: odadaki kameraların ızgarası (telsiz
//   kartındaki Büyüt düğmesi açar, kamera kalmayınca kendiliğinden kapanır). İzlenen bir ekran paylaşımı
//   ızgaranın, ızgara kendi paylaşımının önizlemesinin önüne geçer.
// - .cast-screen[data-fit="contain" | "cover"]: Sığdır ve Doldur seçimi. İzlenen paylaşım ve kamera ızgarası
//   ayrı seçim tutar (paylaşımda varsayılan Sığdır, kameralarda Doldur).
//
// Konsol ve televizyon: bütün denetimler odaklanabilir düğmedir, İzle denince odak Tam ekran düğmesine
// gider. Tam ekran katman yığınına 'cast-full' adıyla girer, kolun daire düğmesi (21-band.js padPoll) ve
// Esc tam ekrandan çıkar.

const CAST_FIT_KEY = 'telsiz.castFit'
const CAM_FIT_KEY = 'telsiz.camFit'
const CAST_QUALITY_KEY = 'telsiz.screenQuality'
const CAST_NOTICE_MS = 20000
const CAST_REWATCH_MS = 20000
const CAST_PRESETS = ['720p15', '720p30', '1080p15', '1080p30']
const CAST_HINTS = ['motion', 'detail']
const CAST_DEFAULT = { preset: '720p15', hint: 'detail', audio: false }
// Bu kodlar startScreenShare'in reddiyle gelir ve pencerede gösterilir (aynı kodun 'error' olayı yok sayılır)
const CAST_START_ERRORS = ['screen_unsupported', 'insecure', 'unsupported', 'not_in_voice', 'screen_busy', 'screen_denied', 'screen_gesture', 'screen_not_found', 'screen_failed']

const castState = {
  watching: null,
  chatOpen: null,
  fit: 'contain',
  camFit: 'cover',
  full: false,
  pseudoFull: false,
  dialog: null,
  notice: null,
  rewatch: null,
  nodes: null,
  observer: null,
  dockQueued: false,
  topKey: '',
  pickKey: '',
  viewersKey: '',
  // Kameralar ızgarası açık mı ve son çizilen ızgaranın anahtarı
  cams: false,
  camsKey: '',
  bound: false
}

// Motor yardımcıları

function castSnapshot () {
  if (!voice || typeof voice.snapshot !== 'function') return null
  try {
    return voice.snapshot()
  } catch (err) {
    return null
  }
}

function castScreen (s) {
  const snapshot = s || castSnapshot()
  return snapshot && snapshot.screen && typeof snapshot.screen === 'object' ? snapshot.screen : null
}

function castCall (name, args) {
  if (!voice || typeof voice[name] !== 'function') return 'unsupported'
  try {
    return voice[name].apply(voice, args || [])
  } catch (err) {
    return err && typeof err.code === 'string' ? err.code : 'screen_failed'
  }
}

function castErrorText (code) {
  if (!code) return ''
  if (hasText('screen.errors.' + code)) return t('screen.errors.' + code)
  return t('screen.errors.screen_failed')
}

function castName (userId) {
  return shownName(userId)
}

function castRoomName (channelId) {
  const channels = state.meta && Array.isArray(state.meta.channels) ? state.meta.channels : []
  const found = channels.filter((c) => sameId(c.id, channelId))[0]
  return found && found.name ? String(found.name) : ''
}

// "720p15" -> { res: '720p', fps: '15' }
function castPresetParts (id) {
  const m = /^(\d+)p(\d+)$/.exec(String(id || ''))
  return m ? { res: m[1] + 'p', fps: formatNumber(Number(m[2])) } : { res: String(id || ''), fps: '' }
}

function castPresetShort (id) {
  const p = castPresetParts(id)
  return p.fps ? p.res + ' · ' + p.fps : p.res
}

function castQualityLine (preset, hint) {
  const p = castPresetParts(preset)
  const hintText = CAST_HINTS.indexOf(hint) !== -1 ? t('screen.hint.' + hint) : ''
  if (!p.fps) return hintText
  return t('cast.qualityLine', { res: p.res, fps: p.fps, hint: hintText })
}

// Paylaşım varsayılanları: Ayarlar'daki telsiz.screenQuality (11-settings.js screenQuality), yoksa motorun
// cihaz varsayılanı. Ses her zaman motorun varsayılanından gelir (kapalı).
function castDefaults () {
  let base = null
  if (voice && typeof voice.screenSettings === 'function') {
    try {
      base = voice.screenSettings()
    } catch (err) {
      base = null
    }
  }
  let q = null
  if (typeof screenQuality === 'function') {
    try {
      q = screenQuality()
    } catch (err) {
      q = null
    }
  }
  const pick = (key, list) => {
    if (q && list.indexOf(q[key]) !== -1) return q[key]
    if (base && list.indexOf(base[key]) !== -1) return base[key]
    return CAST_DEFAULT[key]
  }
  return { preset: pick('preset', CAST_PRESETS), hint: pick('hint', CAST_HINTS), audio: Boolean(base && base.audio === true) }
}

// Başarılı bir başlatma veya kalite değişikliğinden sonra seçim yeni varsayılan olur
function castRememberQuality (preset, hint) {
  const key = typeof SETTINGS_KEYS === 'object' && SETTINGS_KEYS && SETTINGS_KEYS.screenQuality ? SETTINGS_KEYS.screenQuality : CAST_QUALITY_KEY
  storeSetJson(key, { hint: hint, preset: preset })
  castCall('setScreenSettings', [{ preset: preset, hint: hint }])
}

// Motor olayları (10-voice.js createVoice -> onScreenEvent)

// Yeni başlayan ekran yayını sesli bildirim verir (31-sesler.js). Zaten süren bir paylaşımın duyurusu (ses
// odasına yeni girildi, bağlantı yenilendi) evt.fresh false gelir ve sessiz geçer. Ses odası sesleri ayarı
// kapalıysa veya sağırlaştırılmışken çalmaz.
function castPlayShareSound (evt) {
  if (!evt.fresh || !voice || !window.TelsizSesler) return
  const settings = typeof voice.settings === 'function' ? voice.settings() : null
  if (settings && settings.sounds === false) return
  if (snap().deafened) return
  window.TelsizSesler.play('share')
}

function castOnScreenEvent (evt) {
  if (!evt || typeof evt.type !== 'string') return
  const uid = evt.userId === null || evt.userId === undefined ? null : String(evt.userId)
  if (evt.type === 'share-start') {
    castPlayShareSound(evt)
    // Bildirimler listesine (28-bildirim.js) yazılır, liste ekrandaysa sağ üstteki bildirim açılmaz
    const listed = typeof activityShare === 'function'
    if (listed) activityShare(uid, true)
    const back = castState.rewatch
    castState.rewatch = null
    if (back && back.userId === uid && Date.now() - back.at < CAST_REWATCH_MS && !castState.watching) {
      castWatch(uid, false)
      return
    }
    if (castState.watching !== uid && !(listed && activityShown())) castShowNotice(uid)
  } else if (evt.type === 'share-stop') {
    if (typeof activityShare === 'function') activityShare(uid, false)
    if (castState.notice && castState.notice.userId === uid) castHideNotice()
    if (castState.watching === uid) {
      castState.watching = null
      if (evt.reason === 'reconnect') {
        castState.rewatch = { userId: uid, at: Date.now() }
      } else {
        toast(() => t('screen.stoppedUser', { name: castName(uid) }), '', 6000)
      }
    }
  } else if (evt.type === 'local-stop') {
    if (evt.reason === 'ended') toast(() => t('screen.stoppedSelf'), '', 6000)
    const quality = castState.dialog && castState.dialog.mode === 'quality'
    if (quality) castCloseDialog(false)
  } else if (evt.type === 'error') {
    castOnError(evt.code, uid)
  }
  castSync()
}

function castOnError (code, uid) {
  if (!code || code === 'cancelled') return
  if (CAST_START_ERRORS.indexOf(code) !== -1 && uid === null) {
    // Başlatma hatası: pencere açıksa orada gösterilir (startScreenShare reddi), değilse bildirim
    if (!castState.dialog) toast(() => castErrorText(code), 'error', 8000)
    return
  }
  if (code === 'screen_watch_failed' && castState.watching === uid) return
  toast(() => castErrorText(code), code === 'screen_audio_limited' ? '' : 'error', 8000)
}

// Bütün görünümü motorun güncel durumundan çizer
function castSync () {
  if (!el.cast) return
  const s = castSnapshot()
  const sc = castScreen(s)
  const inVoice = Boolean(s && s.channelId && sc)
  const remote = inVoice && sc.remote && typeof sc.remote === 'object' ? sc.remote : {}
  if (castState.watching && !remote[castState.watching]) castState.watching = null
  if (!inVoice) {
    if (typeof activityClearShares === 'function') activityClearShares()
    castState.watching = null
    castState.rewatch = null
    castHideNotice()
  } else if (castState.notice && !remote[castState.notice.userId]) {
    castHideNotice()
  }
  const sharing = inVoice && sc.state === 'live'
  const camCount = inVoice && typeof cameraStreams === 'function' ? Object.keys(cameraStreams(s)).length : 0
  if (castState.cams && camCount === 0) castState.cams = false
  const mode = castState.watching ? 'watch' : castState.cams ? 'cams' : sharing ? 'own' : null
  castRenderTop(sc, remote, sharing)
  castRenderStage(mode, sc, remote)
  if (castState.dialog) castRenderDialogState()
}

// Üst çubuk çipi (#top-cast): yalnızca kendi paylaşımın sürerken "Ekranınız yayında · Durdur" (başka
// istasyona geçilse de görünür). Başkasının paylaşımı üst çubukta gösterilmez, telsiz kartının kadrosundaki
// Yayına katıl düğmesi (10-voice.js buildVoiceMember) ve Bildirimler listesinden izlenir.

function castRemoteIds (remote) {
  return Object.keys(remote).sort()
}

function castRenderTop (sc, remote, sharing) {
  const box = el.topCast
  if (!box) return
  const key = [sharing ? 1 : 0, window.I18N ? window.I18N.lang : ''].join('|')
  if (key === castState.topKey) return
  castState.topKey = key
  const hadFocus = box.contains(document.activeElement)
  clear(box)
  if (sharing) {
    const own = h('div', 'top-cast-chip is-own')
    const led = h('span', 'cast-led is-rec')
    led.setAttribute('aria-hidden', 'true')
    own.appendChild(led)
    setLive(own.appendChild(h('span', 'top-cast-text')), () => t('cast.ownChip'))
    const stop = h('button', 'top-cast-stop')
    stop.type = 'button'
    stop.setAttribute('data-focus-key', 'cast-top-stop')
    stop.appendChild(icon('i-stop'))
    setLive(stop.appendChild(h('span', 'top-cast-stop-text')), () => t('cast.stopShort'))
    stop.setAttribute('aria-label', t('screen.stop'))
    stop.addEventListener('click', castStopShare)
    own.appendChild(stop)
    box.appendChild(own)
  }
  box.hidden = !box.firstChild
  if (hadFocus) focusNode(box.querySelector('button'))
}

// Bildirim: "Ece ekranını paylaşıyor." ve İzle

function castShowNotice (userId) {
  if (!userId || !el.appView) return
  castHideNotice()
  const node = h('div', 'cast-notice')
  node.setAttribute('role', 'status')
  node.setAttribute('aria-live', 'polite')
  node.appendChild(avatar(userId, 'sm', 'cast-notice-avatar'))
  const text = h('span', 'cast-notice-text')
  setLive(text, () => t('screen.notify', { name: castName(userId) }))
  node.appendChild(text)
  const watch = button('button cast-notice-watch', t('screen.watch'), 'i-eye')
  watch.addEventListener('click', () => {
    castWatch(userId, true)
  })
  node.appendChild(watch)
  const close = button('icon-button cast-notice-close', '', 'i-close', t('common.close'))
  close.addEventListener('click', () => {
    castHideNotice()
  })
  node.appendChild(close)
  el.appView.appendChild(node)
  const timer = setTimeout(() => {
    if (castState.notice && castState.notice.node === node) castHideNotice()
  }, CAST_NOTICE_MS)
  castState.notice = { userId: userId, node: node, timer: timer }
}

function castHideNotice () {
  const n = castState.notice
  if (!n) return
  castState.notice = null
  clearTimeout(n.timer)
  const hadFocus = n.node.contains(document.activeElement)
  if (n.node.parentNode) n.node.parentNode.removeChild(n.node)
  if (hadFocus) focusNode(el.topCast && !el.topCast.hidden ? el.topCast.querySelector('button') : el.composerInput)
}

// İzleme

function castWatch (userId, moveFocus) {
  if (!userId) return
  const previous = castState.watching
  const err = castCall('watchScreen', [userId])
  if (err) {
    toast(() => castErrorText(err), 'error', 6000)
    castSync()
    return
  }
  if (previous && previous !== userId) castCall('unwatchScreen', [previous])
  castState.watching = userId
  if (castState.notice && castState.notice.userId === userId) castHideNotice()
  castSync()
  if (moveFocus && castState.nodes) focusNode(castState.nodes.full)
}

function castUnwatch () {
  const userId = castState.watching
  if (!userId) return
  const hadFocus = el.cast.contains(document.activeElement)
  castCall('unwatchScreen', [userId])
  castState.watching = null
  castSync()
  if (hadFocus) castFocusAfterClose()
}

function castStopShare () {
  const hadFocus = el.cast.contains(document.activeElement) || (el.topCast && el.topCast.contains(document.activeElement))
  castCall('stopScreenShare')
  castSync()
  if (hadFocus && !castVisible()) castFocusAfterClose()
}

// Kameralar ızgarası (telsiz kartındaki Büyüt düğmesi)
function castCamsOpen () {
  return castState.cams && castVisible() && el.cast.getAttribute('data-mode') === 'cams'
}

function castToggleCams () {
  const open = castCamsOpen()
  castState.cams = !open
  if (!open && castState.watching) {
    castCall('unwatchScreen', [castState.watching])
    castState.watching = null
  }
  castSync()
  if (typeof renderVoiceAll === 'function') renderVoiceAll()
  if (!open && castState.nodes && castCamsOpen()) focusNode(castState.nodes.camsClose)
}

function castCloseCams () {
  const hadFocus = el.cast.contains(document.activeElement)
  castState.cams = false
  castSync()
  if (typeof renderVoiceAll === 'function') renderVoiceAll()
  if (hadFocus) {
    const tile = byId('radio-cams')
    if (tile && !tile.closest('[hidden]') && tile.getClientRects().length) focusNode(tile)
    else castFocusAfterClose()
  }
}

function castVisible () {
  return Boolean(el.cast && !el.cast.hidden)
}

function castFocusAfterClose () {
  if (el.btnScreen && !el.btnScreen.closest('[hidden]')) focusNode(el.btnScreen)
  else if (el.composerInput && !el.composerInput.disabled) focusNode(el.composerInput)
}

// Yayın sahnesi (#cast)

function castBuildStage () {
  if (castState.nodes) return castState.nodes
  const n = {}
  const root = el.cast
  clear(root)
  n.panel = h('div', 'cast-panel')
  const head = h('header', 'cast-head')
  n.pick = h('div', 'cast-pick')
  n.pick.setAttribute('role', 'group')
  setLiveAttr(n.pick, 'aria-label', () => t('cast.pickLabel'))
  head.appendChild(n.pick)
  n.rec = h('span', 'cast-rec')
  n.rec.setAttribute('aria-hidden', 'true')
  n.rec.appendChild(h('span', 'cast-led is-rec'))
  head.appendChild(n.rec)
  const titles = h('div', 'cast-titles')
  n.title = h('h2', 'cast-title')
  n.title.id = 'cast-title'
  n.sub = h('p', 'cast-sub')
  titles.appendChild(n.title)
  titles.appendChild(n.sub)
  head.appendChild(titles)
  n.viewers = h('span', 'cast-viewers')
  n.viewers.setAttribute('aria-live', 'polite')
  n.viewersStack = h('span', 'cast-viewers-stack')
  n.viewersStack.setAttribute('aria-hidden', 'true')
  n.viewersText = h('span', 'cast-viewers-text')
  n.viewers.appendChild(icon('i-eye'))
  n.viewers.appendChild(n.viewersStack)
  n.viewers.appendChild(n.viewersText)
  head.appendChild(n.viewers)
  n.fitGroup = h('div', 'cast-fit')
  n.fitGroup.setAttribute('role', 'group')
  setLiveAttr(n.fitGroup, 'aria-label', () => t('cast.layoutLabel'))
  n.fitContain = castHeadButton('cast-fit-button', 'i-fit', () => t('screen.fit'))
  n.fitCover = castHeadButton('cast-fit-button', 'i-expand', () => t('screen.fill'))
  n.fitContain.addEventListener('click', () => {
    castSetFit('contain')
  })
  n.fitCover.addEventListener('click', () => {
    castSetFit('cover')
  })
  n.fitGroup.appendChild(n.fitContain)
  n.fitGroup.appendChild(n.fitCover)
  head.appendChild(n.fitGroup)
  n.full = castHeadButton('cast-full', 'i-expand', () => t(castState.full ? 'screen.exitFullscreen' : 'screen.fullscreen'))
  n.full.setAttribute('data-focus-key', 'cast-full')
  n.full.addEventListener('click', castToggleFull)
  head.appendChild(n.full)
  n.quality = castHeadButton('cast-quality', 'i-gear', () => t('cast.quality'))
  n.quality.setAttribute('aria-haspopup', 'dialog')
  n.quality.setAttribute('aria-controls', 'cast-dialog')
  n.quality.addEventListener('click', () => {
    openCastDialog(n.quality, 'quality')
  })
  head.appendChild(n.quality)
  n.unwatch = castHeadButton('cast-unwatch is-danger', 'i-screen-off', () => t('screen.unwatch'))
  n.unwatch.addEventListener('click', castUnwatch)
  head.appendChild(n.unwatch)
  n.stop = castHeadButton('cast-stop is-stop', 'i-stop', () => t('screen.stop'))
  n.stop.setAttribute('data-focus-key', 'cast-stop')
  n.stop.addEventListener('click', castStopShare)
  head.appendChild(n.stop)
  n.camsClose = castHeadButton('cast-cams-close', 'i-close', () => t('camera.gridClose'))
  n.camsClose.setAttribute('data-focus-key', 'cast-cams-close')
  n.camsClose.addEventListener('click', castCloseCams)
  head.appendChild(n.camsClose)
  n.panel.appendChild(head)

  n.screen = h('div', 'cast-screen')
  n.video = h('video', 'cast-video')
  n.video.muted = true
  n.video.defaultMuted = true
  n.video.autoplay = true
  n.video.playsInline = true
  n.video.setAttribute('muted', '')
  n.video.setAttribute('playsinline', '')
  n.video.setAttribute('autoplay', '')
  n.video.setAttribute('disablepictureinpicture', '')
  n.screen.appendChild(n.video)
  n.waiting = h('div', 'cast-state is-waiting')
  n.waiting.setAttribute('role', 'status')
  n.waiting.appendChild(h('span', 'cast-skeleton'))
  n.waitingText = h('p', 'cast-state-text')
  n.waiting.appendChild(n.waitingText)
  n.screen.appendChild(n.waiting)
  n.failed = h('div', 'cast-state is-failed')
  n.failed.setAttribute('role', 'alert')
  n.failed.appendChild(icon('i-alert', 'cast-state-icon'))
  n.failedTitle = h('p', 'cast-state-title')
  n.failedText = h('p', 'cast-state-text')
  n.failed.appendChild(n.failedTitle)
  n.failed.appendChild(n.failedText)
  n.retry = button('button cast-retry', '', 'i-signal')
  n.retryText = h('span', 'button-text')
  n.retry.appendChild(n.retryText)
  n.retry.addEventListener('click', () => {
    if (castState.watching) castWatch(castState.watching, true)
  })
  n.failed.appendChild(n.retry)
  n.screen.appendChild(n.failed)
  n.tag = h('span', 'cast-tag')
  n.tag.setAttribute('aria-hidden', 'true')
  n.tagLed = h('span', 'cast-led is-rec')
  n.tagText = h('span', 'cast-tag-text')
  n.tag.appendChild(n.tagLed)
  n.tag.appendChild(n.tagText)
  n.screen.appendChild(n.tag)
  // Kameralar ızgarası (cams kipi): her kamera yumuşak köşeli bir kutu, altında ad, konuşan kişide hale
  n.cams = h('div', 'cast-cams')
  n.cams.hidden = true
  n.screen.appendChild(n.cams)
  n.panel.appendChild(n.screen)

  n.foot = h('div', 'cast-foot')
  n.mute = h('button', 'cast-mute')
  n.mute.type = 'button'
  n.mute.appendChild(icon('i-speaker'))
  n.mute.addEventListener('click', castToggleMute)
  n.foot.appendChild(n.mute)
  n.volumeLabel = h('label', 'cast-volume-label')
  n.volumeLabel.setAttribute('for', 'cast-volume')
  n.foot.appendChild(n.volumeLabel)
  n.volume = h('input', 'range cast-volume')
  n.volume.id = 'cast-volume'
  n.volume.type = 'range'
  n.volume.min = '0'
  n.volume.max = '100'
  n.volume.step = '5'
  n.volume.addEventListener('input', castOnVolume)
  n.volume.addEventListener('change', castOnVolume)
  n.foot.appendChild(n.volume)
  n.volumeValue = h('span', 'cast-volume-value')
  n.volumeValue.setAttribute('aria-hidden', 'true')
  n.foot.appendChild(n.volumeValue)
  n.volumeNote = h('p', 'cast-volume-note')
  n.foot.appendChild(n.volumeNote)
  n.panel.appendChild(n.foot)
  root.appendChild(n.panel)

  // Daraltılmış sohbet şeridi: oda adı, son mesaj, yazıyor bilgisi, Sohbeti aç
  n.dock = h('div', 'cast-dock')
  n.dock.setAttribute('role', 'group')
  setLiveAttr(n.dock, 'aria-label', () => t('cast.dockLabel'))
  n.dockIcon = icon('i-text', 'cast-dock-icon')
  n.dock.appendChild(n.dockIcon)
  n.dockTitle = h('span', 'cast-dock-title')
  n.dock.appendChild(n.dockTitle)
  n.dockLast = h('span', 'cast-dock-last')
  n.dock.appendChild(n.dockLast)
  n.dockTyping = h('span', 'cast-dock-typing')
  n.dock.appendChild(n.dockTyping)
  n.dockToggle = h('button', 'cast-dock-toggle')
  n.dockToggle.type = 'button'
  n.dockToggle.setAttribute('aria-controls', 'main')
  n.dockToggle.appendChild(icon('i-chat'))
  n.dockToggleText = h('span', 'cast-dock-toggle-text')
  n.dockToggle.appendChild(n.dockToggleText)
  n.dockToggle.addEventListener('click', castToggleChat)
  n.dock.appendChild(n.dockToggle)
  root.appendChild(n.dock)

  castState.nodes = n
  try {
    const fit = storeGet(CAST_FIT_KEY)
    castState.fit = fit === 'cover' ? 'cover' : 'contain'
  } catch (err) {
    castState.fit = 'contain'
  }
  try {
    castState.camFit = storeGet(CAM_FIT_KEY) === 'contain' ? 'contain' : 'cover'
  } catch (err) {
    castState.camFit = 'cover'
  }
  return n
}

// Dil değişince yeniden üretilen öznitelik (setLive yalnız metin içindir, bu yüzden gizli bir metin düğümü
// yerine öznitelik her çizimde yenilenir)
function setLiveAttr (node, name, producer) {
  node.setAttribute(name, textOf(producer))
  node.castAttr = { name: name, producer: producer }
}

function castRefreshAttrs (root) {
  Array.from(root.querySelectorAll('*')).concat([root]).forEach((node) => {
    if (node.castAttr) node.setAttribute(node.castAttr.name, textOf(node.castAttr.producer))
  })
}

function castHeadButton (className, iconName, producer) {
  const b = h('button', 'cast-button ' + className)
  b.type = 'button'
  b.appendChild(icon(iconName))
  const label = h('span', 'cast-button-label')
  setLive(label, producer)
  b.appendChild(label)
  b.castLabel = producer
  return b
}

function castRenderStage (mode, sc, remote) {
  const root = el.cast
  if (!mode) {
    if (!root.hidden) castCloseStage()
    return
  }
  const n = castBuildStage()
  const opening = root.hidden
  root.hidden = false
  root.setAttribute('data-mode', mode)
  document.body.setAttribute('data-cast', 'live')
  document.body.setAttribute('data-cast-mode', mode)
  castApplyChat()
  castRefreshAttrs(root)
  castRenderPick(sc, remote, mode)
  const own = mode === 'own'
  const cams = mode === 'cams'
  const fit = cams ? castState.camFit : castState.fit
  n.screen.setAttribute('data-fit', fit)
  n.fitContain.setAttribute('aria-pressed', fit === 'contain' ? 'true' : 'false')
  n.fitCover.setAttribute('aria-pressed', fit === 'cover' ? 'true' : 'false')
  setLive(n.full.querySelector('.cast-button-label'), n.full.castLabel)
  setIcon(n.full, castState.full ? 'i-close' : 'i-expand')
  n.panel.classList.toggle('is-own', own)
  n.panel.classList.toggle('is-cams', cams)
  n.rec.hidden = !own
  n.viewers.hidden = !own
  n.quality.hidden = !own
  n.stop.hidden = !own
  n.fitGroup.hidden = own
  n.unwatch.hidden = own || cams
  n.full.hidden = own
  n.foot.hidden = own || cams
  n.camsClose.hidden = !cams
  n.cams.hidden = !cams
  n.video.hidden = cams
  if (!cams && castState.camsKey) {
    castState.camsKey = ''
    clear(n.cams)
    if (typeof pruneCameraVideos === 'function') pruneCameraVideos('grid-', {})
  }
  if (cams) {
    castRenderCams(n)
  } else if (own) {
    castRenderOwn(n, sc)
  } else {
    castRenderWatch(n, remote[castState.watching] || null, castState.watching)
  }
  if (opening) {
    castObserve(true)
    castRenderDock()
  }
}

// Kameralar ızgarası: kadro sırasıyla, sütun ve satır sayısı kamera sayısından (1, 2x1, 2x2, 3x2, 3x3, 4x3)
function castRenderCams (n) {
  const s = castSnapshot() || snap()
  const streams = typeof cameraStreams === 'function' ? cameraStreams(s) : {}
  const ids = voiceRoster(s.channelId).map((entry) => String(entry.userId)).filter((id) => Boolean(streams[id]))
  n.panel.setAttribute('aria-labelledby', 'cast-title')
  setLive(n.title, () => t('camera.gridTitle'))
  n.sub.textContent = [castRoomName(s.channelId), t('radio.cameras', { count: ids.length })].filter(Boolean).join(' · ')
  castBindVideo(n, null)
  n.waiting.hidden = true
  n.failed.hidden = true
  n.tag.hidden = true
  const cols = ids.length <= 1 ? 1 : ids.length <= 4 ? 2 : ids.length <= 9 ? 3 : 4
  const rows = Math.max(1, Math.ceil(ids.length / cols))
  n.cams.setAttribute('data-cols', String(cols))
  n.cams.setAttribute('data-rows', String(rows))
  const key = [ids.map((id) => id + '=' + streams[id].stream.id).join(','), window.I18N ? window.I18N.lang : ''].join('|')
  if (key === castState.camsKey) return
  castState.camsKey = key
  clear(n.cams)
  const keep = {}
  const sp = typeof speakingIn === 'function' ? speakingIn : () => false
  ids.forEach((id) => {
    const self = streams[id].self
    const tile = h('div', 'cam-tile' + (self ? ' is-self' : ''))
    tile.setAttribute('data-user-id', id)
    tile.setAttribute('role', 'img')
    tile.setAttribute('aria-label', self ? t('camera.tileSelf') : t('camera.tileUser', { name: castName(id) }))
    tile.classList.toggle('is-speaking', Boolean(sp(s, id)))
    const frame = h('div', 'cam-tile-frame')
    frame.appendChild(avatar(id, 'lg', 'cam-tile-avatar'))
    frame.appendChild(cameraVideoFor('grid-' + id, streams[id].stream, self))
    frame.appendChild(h('span', 'cam-tile-name', self ? t('cast.you') : castName(id)))
    tile.appendChild(frame)
    n.cams.appendChild(tile)
    keep['grid-' + id] = true
  })
  pruneCameraVideos('grid-', keep)
}

function castRenderOwn (n, sc) {
  n.panel.setAttribute('aria-labelledby', 'cast-title')
  setLive(n.title, () => t('cast.ownTitle'))
  const parts = [castQualityLine(sc.preset, sc.hint), t(sc.audio ? 'cast.audioOn' : 'cast.audioOff')].filter(Boolean)
  n.sub.textContent = parts.join(' · ')
  const viewers = Array.isArray(sc.viewers) ? sc.viewers.map(String) : []
  const count = typeof sc.viewerCount === 'number' ? sc.viewerCount : viewers.length
  setLive(n.viewersText, () => (count ? t('screen.viewers', { count: count }) : t('screen.noViewers')))
  n.viewers.classList.toggle('is-empty', !count)
  const vkey = viewers.join(',')
  if (vkey !== castState.viewersKey) {
    castState.viewersKey = vkey
    clear(n.viewersStack)
    viewers.slice(0, 4).forEach((id) => {
      n.viewersStack.appendChild(avatar(id, 'xs'))
    })
  }
  castBindVideo(n, sc.preview || null)
  n.waiting.hidden = Boolean(sc.preview)
  setLive(n.waitingText, () => t('screen.waiting'))
  n.failed.hidden = true
  n.tagLed.hidden = true
  setLive(n.tagText, () => t('cast.preview'))
  n.tag.hidden = false
  n.video.setAttribute('aria-label', t('cast.preview'))
}

function castRenderWatch (n, rs, userId) {
  n.panel.setAttribute('aria-labelledby', 'cast-title')
  const name = castName(userId)
  setLive(n.title, () => t('screen.sharingUser', { name: castName(userId) }))
  n.sub.textContent = rs ? castQualityLine(rs.preset, rs.hint) : ''
  const status = rs ? rs.status : 'requested'
  let stream = rs && rs.stream ? rs.stream : null
  if (!stream && rs && rs.watching) {
    const got = castCall('getScreenStream', [userId])
    stream = got && typeof got === 'object' ? got : null
  }
  const live = status === 'live' && Boolean(stream)
  castBindVideo(n, live || status === 'requested' ? stream : null)
  n.waiting.hidden = live || status === 'failed'
  setLive(n.waitingText, () => t('screen.waiting'))
  n.failed.hidden = status !== 'failed'
  setLive(n.failedTitle, () => t('cast.failedTitle'))
  setLive(n.failedText, () => t('screen.errors.screen_watch_failed'))
  setLive(n.retryText, () => t('screen.retry'))
  n.tagLed.hidden = !live
  setLive(n.tagText, () => (live ? t('cast.liveTag', { name: castName(userId) }) : t('screen.status.' + (status === 'failed' ? 'failed' : 'requested'))))
  n.tag.hidden = false
  n.video.setAttribute('aria-label', t('cast.videoLabel', { name: name }))
  // Paylaşım sesi: kişisel seviye ve susturma (mikrofon sesinden bağımsız)
  const volume = rs && typeof rs.volume === 'number' ? Math.round(rs.volume * 100) : 100
  const muted = Boolean(rs && rs.muted)
  if (document.activeElement !== n.volume) n.volume.value = String(volume)
  n.volume.disabled = !(rs && rs.audio)
  n.volume.setAttribute('aria-valuetext', formatPercent(volume))
  n.volumeValue.textContent = formatPercent(volume)
  setLive(n.volumeLabel, () => t('screen.volume'))
  n.mute.disabled = !(rs && rs.audio)
  n.mute.setAttribute('aria-pressed', muted ? 'true' : 'false')
  n.mute.setAttribute('aria-label', t(muted ? 'screen.unmute' : 'screen.mute'))
  n.mute.title = t(muted ? 'screen.unmute' : 'screen.mute')
  setIcon(n.mute, muted ? 'i-headphones-off' : 'i-speaker')
  setLive(n.volumeNote, () => (rs && rs.audio ? t('cast.volumeNote') : t('cast.noAudio', { name: castName(userId) })))
  n.foot.classList.toggle('is-silent', !(rs && rs.audio))
}

function castBindVideo (n, stream) {
  const v = n.video
  if (v.srcObject !== stream) {
    try {
      v.srcObject = stream
    } catch (err) {
      v.srcObject = null
    }
  }
  if (stream && v.paused) {
    const p = v.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  }
}

// Paylaşan seçici: odadaki her paylaşım bir düğme (ve paylaşıyorsan "Siz"). Seçili olan aria-pressed.
function castRenderPick (sc, remote, mode) {
  const n = castState.nodes
  const ids = castRemoteIds(remote)
  const sharing = sc && sc.state === 'live'
  const items = ids.slice()
  if (sharing) items.push('self')
  const selected = mode === 'own' ? 'self' : castState.watching
  const key = [items.join(','), selected, window.I18N ? window.I18N.lang : ''].join('|')
  n.pick.hidden = items.length < 2
  if (key === castState.pickKey) return
  castState.pickKey = key
  const focused = n.pick.contains(document.activeElement) ? document.activeElement.getAttribute('data-cast-user') : null
  clear(n.pick)
  items.forEach((id) => {
    const self = id === 'self'
    const chip = h('button', 'cast-chip')
    chip.type = 'button'
    chip.setAttribute('data-cast-user', id)
    chip.setAttribute('aria-pressed', id === selected ? 'true' : 'false')
    chip.appendChild(avatar(self && state.me ? state.me.id : id, 'xs', 'cast-chip-avatar'))
    chip.appendChild(h('span', 'cast-chip-name', self ? t('cast.you') : castName(id)))
    chip.title = self ? t('cast.ownTitle') : t('screen.sharingUser', { name: castName(id) })
    chip.addEventListener('click', () => {
      if (self) {
        const was = castState.watching
        if (was) castCall('unwatchScreen', [was])
        castState.watching = null
        castSync()
      } else if (castState.watching !== id) {
        castWatch(id, false)
      }
      const again = castState.nodes.pick.querySelector('[data-cast-user="' + id + '"]')
      focusNode(again)
    })
    n.pick.appendChild(chip)
  })
  if (focused) focusNode(n.pick.querySelector('[data-cast-user="' + focused + '"]'))
}

function castCloseStage () {
  const root = el.cast
  const hadFocus = root.contains(document.activeElement)
  if (castState.full) castExitFull(false)
  root.hidden = true
  root.removeAttribute('data-mode')
  document.body.removeAttribute('data-cast')
  document.body.removeAttribute('data-cast-mode')
  document.body.removeAttribute('data-cast-chat')
  castState.chatOpen = null
  castState.pickKey = ''
  castState.viewersKey = ''
  castObserve(false)
  if (castState.nodes) {
    castBindVideo(castState.nodes, null)
    clear(castState.nodes.viewersStack)
    clear(castState.nodes.cams)
  }
  castState.camsKey = ''
  if (typeof pruneCameraVideos === 'function') pruneCameraVideos('grid-', {})
  if (hadFocus) castFocusAfterClose()
}

// Seçim sahnenin o anki kipine yazılır: kamera ızgarasında kameralara, izlenen paylaşımda paylaşıma
function castSetFit (fit) {
  const value = fit === 'cover' ? 'cover' : 'contain'
  if (el.cast && el.cast.getAttribute('data-mode') === 'cams') {
    castState.camFit = value
    storeSet(CAM_FIT_KEY, value)
  } else {
    castState.fit = value
    storeSet(CAST_FIT_KEY, value)
  }
  castSync()
}

function castOnVolume () {
  const n = castState.nodes
  if (!n || !castState.watching) return
  const value = Math.max(0, Math.min(100, Number(n.volume.value) || 0))
  castCall('setScreenVolume', [castState.watching, value / 100])
  n.volume.setAttribute('aria-valuetext', formatPercent(value))
  n.volumeValue.textContent = formatPercent(value)
}

function castToggleMute () {
  if (!castState.watching) return
  const sc = castScreen()
  const rs = sc && sc.remote ? sc.remote[castState.watching] : null
  castCall('setScreenMuted', [castState.watching, !(rs && rs.muted)])
  castSync()
}

// Sohbet şeridi: geniş ekranda sahne açılınca sohbet daraltılır, telefonda açık kalır

function castChatOpen () {
  if (castState.chatOpen !== null) return castState.chatOpen
  return isNarrow() || (el.cast && el.cast.getAttribute('data-mode') === 'cams')
}

function castApplyChat () {
  const open = castChatOpen()
  document.body.setAttribute('data-cast-chat', open ? 'open' : 'closed')
  const n = castState.nodes
  if (!n) return
  n.dockToggle.setAttribute('aria-expanded', open ? 'true' : 'false')
  setLive(n.dockToggleText, () => t(castChatOpen() ? 'cast.chatClose' : 'cast.chatOpen'))
}

function castToggleChat () {
  castState.chatOpen = !castChatOpen()
  castApplyChat()
  if (castState.chatOpen && typeof keepBottom === 'function') nextFrame(keepBottom)
}

function castObserve (on) {
  if (typeof MutationObserver !== 'function') return
  if (!on) {
    if (castState.observer) castState.observer.disconnect()
    castState.observer = null
    return
  }
  if (castState.observer) return
  const obs = new MutationObserver(castQueueDock)
  const watchNode = (node, opts) => {
    if (node) obs.observe(node, opts)
  }
  watchNode(el.messageList, { childList: true, subtree: true, characterData: true })
  watchNode(el.typingLine, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] })
  watchNode(el.channelTitle, { childList: true, subtree: true, characterData: true })
  watchNode(el.searchPanel, { attributes: true, attributeFilter: ['hidden'] })
  watchNode(el.appView, { attributes: true, attributeFilter: ['data-view'] })
  castState.observer = obs
}

function castQueueDock () {
  if (castState.dockQueued) return
  castState.dockQueued = true
  nextFrame(() => {
    castState.dockQueued = false
    castRenderDock()
  })
}

function castLastMessage () {
  const list = Array.isArray(state.messages) ? state.messages : []
  let i = list.length - 1
  while (i >= 0) {
    const m = list[i]
    i -= 1
    if (!m || m.deleted) continue
    if (typeof isFoldedMessage === 'function' && isFoldedMessage(m)) continue
    return m
  }
  return null
}

function castRenderDock () {
  const n = castState.nodes
  if (!n || el.cast.hidden) return
  // Arama paneli konuşma sütununda açılır, daraltılmışken görünsün diye sohbet açılır
  if (el.searchPanel && !el.searchPanel.hidden && !castChatOpen()) {
    castState.chatOpen = true
    castApplyChat()
  }
  const view = el.appView ? el.appView.getAttribute('data-view') : 'channel'
  setIcon(n.dockIcon, view === 'dm' ? 'i-chat' : view === 'home' ? 'i-users' : 'i-text')
  const title = el.channelTitle ? el.channelTitle.textContent : ''
  if (title) n.dockTitle.textContent = title
  else setLive(n.dockTitle, () => t('cast.chat'))
  clear(n.dockLast)
  const m = view === 'home' ? null : castLastMessage()
  if (m) {
    let text = ''
    let mention = false
    let result = null
    try {
      result = typeof decryptMessage === 'function' ? decryptMessage(m) : null
    } catch (err) {
      result = null
    }
    if (result && result.state === 'ok') {
      text = result.text ? String(result.text).replace(/\s+/g, ' ') : result.files && result.files.length ? t('cast.lastFile') : ''
      if (typeof messageMentionsMe === 'function') {
        try {
          mention = messageMentionsMe(m, result.text || '')
        } catch (err) {
          mention = false
        }
      }
    } else {
      text = t('cast.lastLocked')
    }
    if (mention) {
      const badge = h('span', 'cast-dock-mention', '@')
      badge.title = t('cast.mentioned')
      badge.setAttribute('aria-label', t('cast.mentioned'))
      n.dockLast.appendChild(badge)
    }
    n.dockLast.appendChild(h('span', 'cast-dock-author', castName(m.authorId) + ': '))
    n.dockLast.appendChild(document.createTextNode(cpSlice(text, 160)))
  } else if (view !== 'home') {
    n.dockLast.appendChild(document.createTextNode(t('cast.noMessages')))
  }
  const typing = el.typingLine && !el.typingLine.hidden ? el.typingLine.textContent.replace(/\s+/g, ' ').trim() : ''
  n.dockTyping.textContent = typing
  n.dockTyping.hidden = !typing
}

// Tam ekran: yayın paneli (başlık, görüntü ve ses satırı) tam ekran olur. Fullscreen API yoksa veya reddedilirse
// panel sayfayı kaplar (is-full). Katman yığınında 'cast-full': Esc ve kolun daire düğmesi çıkar.

function castFullElement () {
  return document.fullscreenElement || document.webkitFullscreenElement || null
}

function castToggleFull () {
  const n = castState.nodes
  if (!n) return
  if (castState.full) {
    const layer = findLayer('cast-full')
    if (layer) closeLayer(layer, true)
    else castExitFull(true)
    return
  }
  castState.full = true
  const target = n.panel
  const request = target.requestFullscreen || target.webkitRequestFullscreen
  const pseudo = () => {
    if (!castState.full) return
    castState.pseudoFull = true
    n.panel.classList.add('is-full')
    castSync()
  }
  if (typeof request === 'function') {
    try {
      const p = request.call(target)
      if (p && typeof p.catch === 'function') p.catch(pseudo)
    } catch (err) {
      pseudo()
    }
  } else {
    pseudo()
  }
  openLayer({
    name: 'cast-full',
    el: n.panel,
    trigger: n.full,
    level: 1,
    focus: false,
    onClose: () => {
      castExitFull(true)
    }
  })
  castSync()
  focusNode(n.full)
}

// Tam ekrandan çıkar. Katman hâlâ yığındaysa onClose çağrılmadan çıkarılır (Esc ve daire düğmesi katmanı
// closeLayer ile kapatır, o yol buraya katman çoktan çıkarılmış olarak gelir). sync false ise çizim yapılmaz.
function castExitFull (sync) {
  if (!castState.full) return
  castState.full = false
  castState.pseudoFull = false
  const n = castState.nodes
  if (n) n.panel.classList.remove('is-full')
  if (castFullElement()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen
    if (typeof exit === 'function') {
      try {
        const p = exit.call(document)
        if (p && typeof p.catch === 'function') p.catch(() => {})
      } catch (err) {
        // Tam ekrandan çıkılamadı
      }
    }
  }
  const layer = findLayer('cast-full')
  if (layer) layers.splice(layers.indexOf(layer), 1)
  if (sync !== false) castSync()
}

function castOnFullChange () {
  if (castState.full && !castState.pseudoFull && !castFullElement()) castExitFull(true)
}

// Paylaşım başlatma penceresi (#cast-dialog). Kaynak seçimi tarayıcıya aittir, pencere öncelik, çözünürlük
// ve kare hızı ile "Sesi de paylaş" seçeneklerini sunar. Paylaşım sürerken aynı pencere kalite kipinde açılır
// (ses seçeneği yok, Kaynağı değiştir ve Uygula).

function openCastDialog (trigger, kind) {
  const root = el.castDialog
  if (!root || !state.inApp) return
  if (castState.dialog) castCloseDialog(false)
  const sc = castScreen()
  const mode = kind === 'quality' && sc && sc.state === 'live' ? 'quality' : 'start'
  const defaults = castDefaults()
  const d = {
    mode: mode,
    preset: mode === 'quality' && CAST_PRESETS.indexOf(sc.preset) !== -1 ? sc.preset : defaults.preset,
    hint: mode === 'quality' && CAST_HINTS.indexOf(sc.hint) !== -1 ? sc.hint : defaults.hint,
    audio: defaults.audio,
    busy: false,
    error: null,
    trigger: trigger || null,
    nodes: {}
  }
  castState.dialog = d
  clear(root)
  const panel = castBuildDialog(d)
  root.appendChild(panel)
  root.setAttribute('aria-labelledby', 'cast-dialog-title')
  root.hidden = false
  if (trigger) trigger.setAttribute('aria-expanded', 'true')
  d.layer = {
    name: 'cast-dialog',
    el: root,
    trigger: trigger || null,
    level: 3,
    trap: true,
    initialFocus: () => (d.nodes.primary && !d.nodes.primary.disabled ? d.nodes.primary : d.nodes.close),
    onClose: () => {
      if (castState.dialog === d) castState.dialog = null
      root.hidden = true
      clear(root)
      if (d.trigger) d.trigger.setAttribute('aria-expanded', 'false')
    }
  }
  castRenderDialogState()
  openLayer(d.layer)
}

function castCloseDialog (restoreFocus) {
  const d = castState.dialog
  if (!d) return
  if (d.layer && findLayer('cast-dialog') === d.layer) closeLayer(d.layer, restoreFocus !== false)
  else if (d.layer) d.layer.onClose()
}

function castBuildDialog (d) {
  const n = d.nodes
  const panel = h('div', 'cast-dialog-panel')
  panel.addEventListener('mousedown', (e) => {
    e.stopPropagation()
  })
  const head = h('header', 'cast-dialog-head')
  const mark = h('span', 'cast-dialog-mark')
  mark.setAttribute('aria-hidden', 'true')
  mark.appendChild(icon(d.mode === 'quality' ? 'i-gear' : 'i-screen'))
  head.appendChild(mark)
  const titles = h('div', 'cast-dialog-titles')
  const title = h('h2', 'cast-dialog-title', t(d.mode === 'quality' ? 'cast.qualityTitle' : 'cast.dialogTitle'))
  title.id = 'cast-dialog-title'
  titles.appendChild(title)
  const s = castSnapshot()
  const room = s && s.channelId ? castRoomName(s.channelId) : ''
  const subText = d.mode === 'quality' ? t('cast.qualitySub') : room ? t('cast.dialogSub', { room: room }) : t('cast.dialogSubNoRoom')
  const sub = h('p', 'cast-dialog-sub', subText)
  sub.id = 'cast-dialog-sub'
  titles.appendChild(sub)
  head.appendChild(titles)
  n.close = button('icon-button cast-dialog-close', '', 'i-close', t('common.close'))
  n.close.addEventListener('click', () => {
    castCloseDialog(true)
  })
  head.appendChild(n.close)
  panel.appendChild(head)

  const body = h('div', 'cast-dialog-body')
  const hintTitle = h('h3', 'cast-dialog-h', t('screen.hintLabel'))
  hintTitle.id = 'cast-hint-title'
  body.appendChild(hintTitle)
  n.hints = castChoiceGroup('cast-choices', 'cast-hint-title', CAST_HINTS.map((id) => ({
    value: id,
    label: t('screen.hint.' + id),
    hint: t('screen.hint.' + id + 'Hint')
  })), d.hint, (value) => {
    d.hint = value
  }, 'cast-choice')
  body.appendChild(n.hints)
  const presetTitle = h('h3', 'cast-dialog-h', t('screen.quality'))
  presetTitle.id = 'cast-preset-title'
  body.appendChild(presetTitle)
  n.presets = castChoiceGroup('cast-presets', 'cast-preset-title', CAST_PRESETS.map((id) => ({
    value: id,
    label: castPresetShort(id),
    aria: t('screen.preset.' + id)
  })), d.preset, (value) => {
    d.preset = value
  }, 'cast-preset')
  body.appendChild(n.presets)
  body.appendChild(h('p', 'cast-dialog-hint', t('cast.presetHint', { label: castPresetShort(CAST_DEFAULT.preset) })))
  if (d.mode === 'start') {
    n.audio = h('button', 'cast-switch-row')
    n.audio.type = 'button'
    n.audio.setAttribute('role', 'switch')
    n.audio.setAttribute('aria-checked', d.audio ? 'true' : 'false')
    const txt = h('span', 'cast-switch-text')
    txt.appendChild(h('b', 'cast-switch-label', t('screen.audio')))
    txt.appendChild(h('span', 'cast-switch-hint', t('cast.audioHint')))
    n.audio.appendChild(txt)
    const knob = h('span', 'cast-switch')
    knob.setAttribute('aria-hidden', 'true')
    knob.appendChild(h('i', 'cast-switch-knob'))
    n.audio.appendChild(knob)
    n.audio.addEventListener('click', () => {
      d.audio = !d.audio
      n.audio.setAttribute('aria-checked', d.audio ? 'true' : 'false')
    })
    body.appendChild(n.audio)
  }
  const note = h('p', 'cast-dialog-note')
  note.appendChild(icon('i-lock'))
  note.appendChild(h('span', '', t('cast.privacy')))
  body.appendChild(note)
  n.status = h('p', 'cast-dialog-status')
  n.status.setAttribute('role', 'status')
  n.status.setAttribute('aria-live', 'polite')
  n.status.hidden = true
  body.appendChild(n.status)
  panel.appendChild(body)

  const foot = h('footer', 'cast-dialog-foot')
  if (d.mode === 'quality') {
    n.source = button('button button-secondary cast-source', t('screen.changeSource'), 'i-screen')
    n.source.addEventListener('click', castStart)
    foot.appendChild(n.source)
  }
  const cancel = button('button button-secondary cast-cancel', t('common.cancel'))
  cancel.addEventListener('click', () => {
    castCloseDialog(true)
  })
  foot.appendChild(cancel)
  n.primary = button('button cast-primary', t(d.mode === 'quality' ? 'cast.apply' : 'cast.start'), d.mode === 'quality' ? 'i-check' : 'i-screen')
  n.primary.addEventListener('click', d.mode === 'quality' ? castApplyQuality : castStart)
  foot.appendChild(n.primary)
  panel.appendChild(foot)

  // Örtüye basınca pencere kapanır (seçici açıkken değil)
  el.castDialog.onmousedown = (e) => {
    if (e.target === el.castDialog && castState.dialog === d && !d.busy) castCloseDialog(true)
  }
  return panel
}

// Seçim grubu: role=radio düğmeleri. Hepsi odaklanabilir (kolun yön tuşlarıyla gezinme bozulmasın), sol ve
// sağ ok seçimi gruptaki komşuya taşır.
function castChoiceGroup (className, labelledBy, options, current, onPick, itemClass) {
  const group = h('div', className)
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-labelledby', labelledBy)
  const items = []
  const select = (value, focus) => {
    items.forEach((b) => {
      const on = b.getAttribute('data-value') === value
      b.setAttribute('aria-checked', on ? 'true' : 'false')
      if (on && focus) focusNode(b)
    })
    onPick(value)
  }
  options.forEach((opt) => {
    const b = h('button', itemClass)
    b.type = 'button'
    b.setAttribute('role', 'radio')
    b.setAttribute('data-value', opt.value)
    b.setAttribute('aria-checked', opt.value === current ? 'true' : 'false')
    if (opt.aria) b.setAttribute('aria-label', opt.aria)
    const dot = h('span', itemClass + '-dot')
    dot.setAttribute('aria-hidden', 'true')
    b.appendChild(dot)
    const txt = h('span', itemClass + '-text')
    txt.appendChild(h('b', itemClass + '-label', opt.label))
    if (opt.hint) txt.appendChild(h('span', itemClass + '-hint', opt.hint))
    b.appendChild(txt)
    b.addEventListener('click', () => {
      if (castState.dialog && castState.dialog.busy) return
      select(opt.value, false)
    })
    b.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      const index = items.indexOf(b) + (e.key === 'ArrowRight' ? 1 : -1)
      if (index < 0 || index >= items.length) return
      e.preventDefault()
      if (castState.dialog && castState.dialog.busy) return
      select(items[index].getAttribute('data-value'), true)
    })
    items.push(b)
    group.appendChild(b)
  })
  return group
}

function castRenderDialogState () {
  const d = castState.dialog
  if (!d) return
  const n = d.nodes
  const s = castSnapshot()
  const sc = castScreen(s)
  let blocker = null
  if (!sc || !sc.canShare) blocker = sc && sc.reason ? sc.reason : 'screen_unsupported'
  else if (!s.channelId) blocker = 'not_in_voice'
  if (d.mode === 'quality' && !(sc && sc.state === 'live') && !d.busy) {
    castCloseDialog(false)
    return
  }
  let text = ''
  let kind = ''
  if (d.busy) {
    text = t(d.mode === 'quality' && !d.sourcing ? 'cast.applying' : 'cast.starting')
  } else if (blocker) {
    text = blocker === 'screen_unsupported' ? t('screen.unsupported') : castErrorText(blocker)
    kind = 'error'
  } else if (d.error) {
    text = castErrorText(d.error)
    kind = 'error'
  }
  n.status.textContent = text
  n.status.hidden = !text
  n.status.classList.toggle('is-error', kind === 'error')
  n.status.setAttribute('role', kind === 'error' ? 'alert' : 'status')
  n.primary.disabled = Boolean(d.busy || blocker)
  if (n.source) n.source.disabled = Boolean(d.busy || blocker)
  if (n.audio) n.audio.disabled = Boolean(d.busy)
  Array.from(el.castDialog.querySelectorAll('[role="radio"]')).forEach((b) => {
    b.setAttribute('aria-disabled', d.busy ? 'true' : 'false')
  })
}

// Başlatma (ve kalite kipinde kaynak değişimi). startScreenShare kullanıcı hareketi içinde, ilk await'ten
// önce eşzamanlı çağrılır.
function castStart () {
  const d = castState.dialog
  if (!d || d.busy) return
  const opts = { preset: d.preset, hint: d.hint }
  if (d.mode === 'start') opts.audio = d.audio
  let job = null
  if (!voice || typeof voice.startScreenShare !== 'function') {
    job = Promise.reject(Object.assign(new Error('screen'), { code: 'screen_unsupported' }))
  } else {
    try {
      job = Promise.resolve(voice.startScreenShare(opts))
    } catch (err) {
      job = Promise.reject(err)
    }
  }
  d.busy = true
  d.sourcing = d.mode === 'quality'
  d.error = null
  castRenderDialogState()
  job.then((res) => {
    d.busy = false
    castRememberQuality(opts.preset, opts.hint)
    if (castState.dialog === d) castCloseDialog(false)
    if (opts.audio && res && res.audio === false) toast(() => t('screen.audioMissing'), '', 8000)
    castSync()
    const n = castState.nodes
    if (n && !el.cast.hidden && !n.stop.hidden) focusNode(n.stop)
    else if (d.trigger) focusNode(liveTrigger(d.trigger))
  }, (err) => {
    d.busy = false
    const code = err && typeof err.code === 'string' ? err.code : 'screen_failed'
    if (castState.dialog !== d) {
      if (code !== 'cancelled') toast(() => castErrorText(code), 'error', 8000)
      return
    }
    d.error = code === 'cancelled' ? null : code
    castRenderDialogState()
    if (d.nodes.primary && !d.nodes.primary.disabled) focusNode(d.nodes.primary)
  })
}

function castApplyQuality () {
  const d = castState.dialog
  if (!d || d.busy || d.mode !== 'quality') return
  const preset = d.preset
  const hint = d.hint
  let job = null
  if (!voice || typeof voice.setScreenQuality !== 'function') {
    job = Promise.resolve('no_share')
  } else {
    try {
      job = Promise.resolve(voice.setScreenQuality({ preset: preset, hint: hint }))
    } catch (err) {
      job = Promise.resolve('screen_failed')
    }
  }
  d.busy = true
  d.sourcing = false
  castRenderDialogState()
  job.then((code) => {
    d.busy = false
    if (code) {
      d.error = code
      castRenderDialogState()
      return
    }
    castRememberQuality(preset, hint)
    castCloseDialog(true)
    castSync()
  })
}

// Bağlama: çekirdek (12-init.js) bindEvents'i değiştirmeden, uygulama açıldığında bir kez

function castInit () {
  if (castState.bound) return
  castState.bound = true
  document.addEventListener('fullscreenchange', castOnFullChange)
  document.addEventListener('webkitfullscreenchange', castOnFullChange)
  // Telefon ve geniş düzen arasında geçince sohbet yeniden düzenin varsayılanına döner
  let narrow = isNarrow()
  window.addEventListener('resize', () => {
    const now = isNarrow()
    if (now !== narrow) castState.chatOpen = null
    narrow = now
    if (castVisible()) castApplyChat()
  })
  // Dil değişince (i18n html lang özniteliğini günceller) setLive dışındaki metinler yeniden çizilir
  if (typeof MutationObserver === 'function') {
    new MutationObserver(() => {
      castState.topKey = ''
      castState.pickKey = ''
      if (state.inApp) castSync()
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  }
}

if (document.readyState === 'complete') {
  castInit()
} else {
  document.addEventListener('DOMContentLoaded', castInit)
}
