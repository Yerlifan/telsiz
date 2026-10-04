'use strict'

// Ses arayüzü: VoiceClient bağlantısı, ses hata kodlarının çevirisi, telsiz kartı (#radio, KONSEPT 6.6),
// üst çubuktaki avatar çipi ve kişi ses ayarı katmanı. Bandın ses istasyonlarını 04-meta.js renderBand çizer.
//
// Telsiz kartının durumu #radio[data-state] özniteliğindedir: off (ses odasında değil), joining
// (bağlanıyor), on (bağlı). Kapalıyken ekranda ses odaları ve Katıl düğmeleri (#voice-channels) ile
// atanan tuş ipucu (#radio-hint), bağlanırken ve bağlıyken oda adı, kadro (#radio-crew: yumuşak kare
// avatarlar, konuşanın halesi, susturma, sağırlaştırma ve ekran işaretleri) ve konuşma satırı
// (#radio-talk) görünür. Altında Bas konuş (#ptt-button) veya ses etkinliği modunda seviye çubuğu
// (#radio-vad) ve beş düğmeli sıra (#radio-row: Mikrofon, Sağırlaştır, Ekran, Kamera, Ayrıl) durur.
// Kamerası açık kişinin kadro öğesi aynı yumuşak kare biçimde canlı görüntüye döner (kendi görüntünüz
// aynalı), kamera açıkken düğme sırasının üstünde her zaman görünen bir "Kameranız açık" satırı durur.
// Odada kamera varsa kadronun altındaki araç satırında (#radio-tools, Telsiz DJ düğmesinden önce) Büyüt
// düğmesi (#radio-cams) durur, kameraları yayın sahnesinde ızgara olarak açar (22-cast.js).

// Ses arayüzü (5.8, Ek D1). Bağlantı mantığı voice.js içindeki VoiceClient'tadır. voice.js metin
// üretmez, hata ve durumları kodla bildirir (snapshot.errorCode, Error.code), metinler burada çevrilir.

function createVoice () {
  const factory = window.VoiceClient
  if (!factory || typeof factory.create !== 'function') return
  try {
    voice = factory.create({
      api: (method, path, body) => api(method, path, body === undefined ? null : body),
      seal: (obj) => window.E2EE.sealJson(activeKid(), obj),
      open: (envelope) => window.E2EE.openJson(envelope),
      onChange: onVoiceChange,
      // Ekran paylaşımı olayları (bildirim, sahne) 22-cast.js arayüzüne gider
      onScreenEvent: (evt) => {
        if (typeof castOnScreenEvent === 'function') castOnScreenEvent(evt)
      },
      // Kamera olayları: bir kişiye kamera gönderilemedi (bağlantı anlaşması)
      onCameraEvent: (evt) => {
        if (!evt || evt.type !== 'error' || !evt.code) return
        const name = evt.userId !== null && evt.userId !== undefined ? shownName(evt.userId) : ''
        toast(() => (name ? t('camera.errors.negotiationUser', { name: name }) : cameraErrorText(evt.code, '')), '', 8000)
      },
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
  try {
    state.voiceSnap = voice.snapshot()
  } catch (err) {
    state.voiceSnap = null
  }
}

function snap () {
  return state.voiceSnap || {
    channelId: null,
    joining: false,
    muted: false,
    deafened: false,
    inputMode: 'vad',
    gateOpen: false,
    level: null,
    threshold: null,
    noiseFloor: null,
    vadAuto: true,
    bindings: null,
    testing: false,
    capturing: false,
    ptt: { enabled: false, active: false },
    selfSpeaking: false,
    inputLevel: 0,
    errorCode: null,
    serverError: null,
    autoplayBlocked: false,
    peers: {},
    camera: { canUse: false, reason: null, state: 'off', preview: null, errorCode: null }
  }
}

// Kamera hata kodunun metni: t('camera.errors.' + kod), yoksa sunucunun metni, o da yoksa genel metin
function cameraErrorText (code, serverText) {
  if (!code) return ''
  if (hasText('camera.errors.' + code)) return t('camera.errors.' + code, { max: voiceServerSettings().maxCameras })
  if (serverText) return String(serverText)
  return t('camera.errors.camera_failed')
}

// Ses hata kodunun metni: önce t('errors.' + kod), yoksa sunucunun metni, o da yoksa genel metin
function voiceErrorText (code, serverText) {
  if (!code) return ''
  if (hasText('errors.' + code)) return t('errors.' + code)
  if (serverText) return String(serverText)
  return t('errors.join_failed')
}

function voiceErrorOf (err) {
  const code = err && typeof err.code === 'string' ? err.code : 'join_failed'
  const server = err && typeof err.serverMessage === 'string' ? err.serverMessage : ''
  return () => voiceErrorText(code, server)
}

let voiceRenderQueued = false
let lastVoiceError = null
let lastCameraError = null
// Son katılma denemesinin odası: hata satırındaki "Tekrar dene" bu odaya yeniden katılır
let radioLastChannel = null

function onVoiceChange (snapshot) {
  state.voiceSnap = snapshot || null
  const code = snapshot && snapshot.errorCode ? snapshot.errorCode : null
  const server = snapshot && snapshot.serverError ? snapshot.serverError : ''
  if (code && code !== lastVoiceError) toast(() => voiceErrorText(code, server), 'error', 8000)
  lastVoiceError = code
  const camCode = snapshot && snapshot.camera && snapshot.camera.errorCode ? snapshot.camera.errorCode : null
  if (camCode && camCode !== lastCameraError) toast(() => cameraErrorText(camCode, ''), camCode === 'camera_limit' || camCode === 'camera_moderated' ? '' : 'error', 8000)
  lastCameraError = camCode
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

// Yapı anahtarı: bu değerlerden biri değişince telsiz kartı ve bant yeniden çizilir. Konuşma, giriş
// seviyesi ve bas konuş basılı durumu gibi sık değişenler updateVoiceLive ile güncellenir.
function voiceStructureKey () {
  const s = snap()
  const peers = s.peers || {}
  const peerKey = Object.keys(peers).sort().map((id) => id + ':' + peers[id].status + ':' + (peers[id].localMute ? 1 : 0) + ':' + (peers[id].sharing ? 1 : 0)).join(',')
  const roster = state.meta && state.meta.voice ? JSON.stringify(state.meta.voice) : ''
  const channels = voiceChannels().map((c) => c.id + ':' + c.name).join(',')
  const sc = radioScreen(s)
  const screenKey = [sc.canShare ? 1 : 0, sc.reason || '', sc.state, sc.starting ? 1 : 0].join(':')
  const cam = radioCamera(s)
  const streams = cameraStreams(s)
  const camKey = [cam.canUse ? 1 : 0, cam.state, camerasAllowed() ? 1 : 0].concat(Object.keys(streams).sort().map((id) => id + '=' + streams[id].stream.id)).join(':')
  return [s.channelId, s.joining, s.muted, s.deafened, s.errorCode, s.autoplayBlocked, s.inputMode, s.ptt && s.ptt.enabled, peerKey, roster, channels, screenKey, camKey].join('|')
}

function renderVoiceAll () {
  const before = document.activeElement
  const focusInRadio = Boolean(el.radio && before && before !== document.body && el.radio.contains(before))
  state.voiceKey = voiceStructureKey()
  renderBand()
  renderVoiceChannels()
  renderVoicePanel()
  renderUserPanel()
  updateVoiceLive()
  if (focusInRadio) radioKeepFocus()
  if (popoverUserId !== null && findLayer('peer')) renderPeerMute()
  if (typeof settingsOnVoice === 'function') settingsOnVoice()
  // Kameralar ızgarası yayın sahnesindedir, kamera değişince sahne de güncellenir
  if (typeof castSync === 'function') castSync()
}

function voiceRoster (channelId) {
  const roster = state.meta && state.meta.voice ? state.meta.voice[channelId] || state.meta.voice[String(channelId)] : null
  return Array.isArray(roster) ? roster : []
}

// Ekran paylaşımı durumu: anlık görüntüde (snapshot.screen) varsa o, yoksa motorun statik özellik
// algılaması (VoiceClient.screenSupport). Paylaşım arayüzü 22-cast.js'tedir, kart yalnızca düğmeyi çizer.
function radioScreen (s) {
  if (s && s.screen && typeof s.screen === 'object') return s.screen
  let support = null
  const factory = window.VoiceClient
  if (factory && typeof factory.screenSupport === 'function') {
    try {
      support = factory.screenSupport()
    } catch (err) {
      support = null
    }
  }
  return {
    canShare: Boolean(support && support.share),
    canWatch: Boolean(support && support.watch),
    reason: support ? support.reason : 'screen_unsupported',
    state: 'idle',
    starting: false,
    viewers: [],
    viewerCount: 0,
    remote: {}
  }
}

// Paylaşamayan cihazda düğmenin altında yazan neden (motor sözleşmesi: screen.errors.<kod>, cihaz
// desteği yoksa screen.unsupported)
function screenReasonText (reason) {
  if (!reason || reason === 'screen_unsupported') return t('screen.unsupported')
  if (hasText('screen.errors.' + reason)) return t('screen.errors.' + reason)
  return t('screen.unsupported')
}

// Kapalı telsizin ekranı: ses odaları, kişi sayısı ve Katıl düğmesi
function renderVoiceChannels () {
  if (!el.voiceChannels) return
  const focusKey = activeFocusKey(el.voiceChannels)
  clear(el.voiceChannels)
  voiceChannels().forEach((c) => {
    const roster = voiceRoster(c.id)
    const li = h('li', 'radio-channel' + (roster.length ? ' is-busy' : ''))
    li.setAttribute('data-channel-id', String(c.id))
    li.appendChild(icon('i-speaker', 'radio-channel-icon'))
    const text = h('span', 'radio-channel-text')
    text.appendChild(h('span', 'radio-channel-name', c.name))
    const sub = h('span', 'radio-channel-sub', roster.length ? t('band.voicePeople', { count: roster.length }) : t('band.voiceEmpty'))
    sub.id = 'radio-channel-sub-' + c.id
    text.appendChild(sub)
    li.appendChild(text)
    const join = h('button', 'button button-small radio-join' + (roster.length ? '' : ' button-secondary'), t('radio.join'))
    join.type = 'button'
    join.setAttribute('data-channel-id', String(c.id))
    join.setAttribute('data-focus-key', 'voice-' + c.id)
    join.setAttribute('aria-label', t('radio.joinLabel', { name: c.name }))
    join.setAttribute('aria-describedby', sub.id)
    join.addEventListener('click', () => {
      joinVoice(c.id)
    })
    li.appendChild(join)
    el.voiceChannels.appendChild(li)
  })
  restoreFocusKey(el.voiceChannels, focusKey)
}

// Kamera durumu: anlık görüntüde (snapshot.camera) varsa o, yoksa motorun özellik algılaması
function radioCamera (s) {
  if (s && s.camera && typeof s.camera === 'object') return s.camera
  let support = null
  const factory = window.VoiceClient
  if (factory && typeof factory.cameraSupport === 'function') {
    try {
      support = factory.cameraSupport()
    } catch (err) {
      support = null
    }
  }
  return { canUse: Boolean(support && support.ok), reason: support ? support.reason : 'camera_unsupported', state: 'off', preview: null, errorCode: null }
}

// Sahibin ses odası ayarı (meta.voiceSettings: { capacity, cameras, maxCameras })
function voiceServerSettings () {
  const v = state.meta && state.meta.voiceSettings && typeof state.meta.voiceSettings === 'object' ? state.meta.voiceSettings : null
  return {
    capacity: v && typeof v.capacity === 'number' ? v.capacity : 8,
    cameras: !v || v.cameras !== false,
    maxCameras: v && typeof v.maxCameras === 'number' ? v.maxCameras : 4
  }
}

function camerasAllowed () {
  return voiceServerSettings().cameras
}

// Bağlı olduğum odada görüntüsü gelen kameralar: { kullanıcı: { stream, self } }. Kendi kameram yerel
// önizlemedir, diğerleri sunucunun açık dediği ve görüntüsü bağlantıdan gelen kameralardır.
function cameraStreams (s) {
  const out = {}
  if (!s || !s.channelId || s.joining) return out
  const cam = radioCamera(s)
  voiceRoster(s.channelId).forEach((entry) => {
    const id = String(entry.userId)
    if (state.me && sameId(entry.userId, state.me.id)) {
      if (cam.state === 'on' && cam.preview) out[id] = { stream: cam.preview, self: true }
      return
    }
    const peer = s.peers ? s.peers[id] : null
    if (peer && peer.camera && peer.camStream && entry.camera === true) out[id] = { stream: peer.camStream, self: false }
  })
  return out
}

// Kamera görüntü öğeleri yer ve kişi başına saklanır, kadro yeniden çizilince görüntü baştan başlamaz.
// Görüntü ilk kare gelince görünür (is-ready), o zamana kadar altındaki avatar görünür.
const cameraVideos = new Map()

function cameraVideoFor (key, stream, self) {
  let v = cameraVideos.get(key)
  if (!v) {
    v = h('video', 'cam-video')
    v.muted = true
    v.defaultMuted = true
    v.autoplay = true
    v.playsInline = true
    v.setAttribute('muted', '')
    v.setAttribute('playsinline', '')
    v.setAttribute('autoplay', '')
    v.setAttribute('disablepictureinpicture', '')
    v.setAttribute('aria-hidden', 'true')
    const ready = () => {
      v.classList.add('is-ready')
    }
    v.addEventListener('loadeddata', ready)
    v.addEventListener('playing', ready)
    cameraVideos.set(key, v)
  }
  v.classList.toggle('is-mirrored', Boolean(self))
  if (v.srcObject !== stream) {
    v.classList.remove('is-ready')
    try {
      v.srcObject = stream
    } catch (err) {
      v.srcObject = null
    }
  }
  if (v.readyState >= 2) v.classList.add('is-ready')
  if (v.paused) {
    const p = v.play()
    if (p && typeof p.catch === 'function') p.catch(() => {})
  }
  return v
}

// Artık kullanılmayan görüntü öğeleri bırakılır (prefix: 'crew-' veya 'grid-')
function pruneCameraVideos (prefix, keep) {
  Array.from(cameraVideos.keys()).forEach((key) => {
    if (key.indexOf(prefix) !== 0 || keep[key]) return
    const v = cameraVideos.get(key)
    cameraVideos.delete(key)
    try {
      v.srcObject = null
    } catch (err) {
      // Öğe zaten bırakıldı
    }
    if (v.parentNode) v.parentNode.removeChild(v)
  })
}

// Kadro öğesinin erişilebilir adı için gereken bilgiler (konuşma durumu updateVoiceLive ile değişir)
const crewInfo = new WeakMap()

// Kadro öğesi: 44 px yumuşak kare avatar, köşede susturma, sağırlaştırma veya bağlantı hatası işareti,
// paylaşırken karşı köşede ekran işareti, altında ad. Başkasının öğesi kişi ses ayarı katmanını açar.
function buildVoiceMember (entry, sameChannel, streams) {
  const s = snap()
  const userId = entry.userId
  const self = Boolean(state.me && sameId(userId, state.me.id))
  const name = shownName(userId)
  const peer = s.peers ? s.peers[String(userId)] : null
  const muted = self ? s.muted : entry.muted === true
  const deafened = self ? s.deafened : entry.deafened === true
  const rec = metaRecordOf(userId)
  const serverMuted = self ? Boolean(s.serverMuted) : Boolean(rec && rec.voiceMuted)
  const sharing = self ? radioScreen(s).state === 'live' : Boolean(peer && peer.sharing)
  const failed = Boolean(!self && sameChannel && peer && peer.status === 'failed')
  const cam = sameChannel && streams ? streams[String(userId)] || null : null
  const li = h('li', 'crew-item' + (self ? ' is-self' : '') + (muted ? ' is-muted' : '') + (deafened ? ' is-deafened' : '') + (sharing ? ' is-sharing' : '') + (cam ? ' has-camera' : ''))
  li.setAttribute('data-user-id', String(userId))
  const inner = h(self ? 'div' : 'button', 'crew-button')
  if (!self) {
    inner.type = 'button'
    inner.setAttribute('data-focus-key', 'crew-' + userId)
    inner.setAttribute('aria-haspopup', 'dialog')
    // Kadro yeniden çizildiğinde açık kişi ses ayarı katmanının tetikleyicisi açık kalır
    if (popoverUserId !== null && sameId(popoverUserId, userId) && findLayer('peer')) inner.setAttribute('aria-expanded', 'true')
    inner.addEventListener('click', () => {
      openPeerPopover(userId, inner, sameChannel)
    })
  }
  const av = avatar(userId, 'md')
  av.removeAttribute('data-status')
  av.classList.add('crew-avatar')
  if (cam) {
    av.classList.add('has-camera')
    av.appendChild(cameraVideoFor('crew-' + userId, cam.stream, cam.self))
  }
  const badge = crewBadge(failed, deafened, muted, serverMuted)
  if (badge) av.appendChild(badge)
  if (sharing) {
    const screen = h('span', 'crew-badge is-screen')
    screen.appendChild(icon('i-screen'))
    av.appendChild(screen)
  }
  inner.appendChild(av)
  const labelName = self ? t('radio.selfName', { name: name }) : name
  inner.appendChild(h('span', 'crew-name', labelName))
  const states = []
  if (failed) states.push(t('voice.peerFailed'))
  if (!self && peer && peer.localMute) states.push(t('voice.localMuted'))
  if (deafened) states.push(t('voice.deafenedState'))
  else if (serverMuted) states.push(t('voice.serverMuted'))
  else if (muted) states.push(t('voice.mutedState'))
  if (sharing) states.push(t(self ? 'radio.stateSelfSharing' : 'radio.stateSharing'))
  if (cam) states.push(t(self ? 'radio.stateSelfCamera' : 'radio.stateCamera'))
  crewInfo.set(li, { labelName: labelName, states: states, self: self })
  li.appendChild(inner)
  // Ekran paylaşan kişinin öğesinde, üstüne gelince veya odaklanınca (dokunmatik ekranda her zaman) Yayına
  // katıl düğmesi (radio.css .crew-watch). İzlerken basmak sahneyi o paylaşıma getirir.
  if (sharing && !self && sameChannel) {
    const watch = button('crew-watch', t('radio.watchShare'), 'i-eye', t('cast.watchLabel', { name: name }))
    watch.setAttribute('data-focus-key', 'crew-watch-' + userId)
    watch.addEventListener('click', () => {
      if (typeof castWatch === 'function') castWatch(String(userId), true)
    })
    li.appendChild(watch)
  }
  setCrewSpeaking(li, Boolean(sameChannel && speakingIn(s, userId)), true)
  return li
}

function crewBadge (failed, deafened, muted, serverMuted) {
  let name = null
  let title = ''
  let kind = ''
  if (failed) {
    name = 'i-alert'
    title = t('voice.peerFailed')
    kind = ' is-error'
  } else if (deafened) {
    name = 'i-headphones-off'
    title = t('voice.deafenedTitle')
  } else if (serverMuted) {
    name = 'i-mic-off'
    title = t('voice.serverMutedTitle')
    kind = ' is-server-muted'
  } else if (muted) {
    name = 'i-mic-off'
    title = t('voice.mutedTitle')
  }
  if (!name) return null
  const badge = h('span', 'crew-badge' + kind)
  badge.title = title
  badge.appendChild(icon(name))
  return badge
}

// Konuşma halesi ve erişilebilir ad ("Mert, konuşuyor, mikrofonu kapalı, ses ayarları")
function setCrewSpeaking (li, speaking, force) {
  if (!force && li.classList.contains('is-speaking') === speaking) return
  li.classList.toggle('is-speaking', speaking)
  const info = crewInfo.get(li)
  const inner = li.querySelector('.crew-button')
  if (!info || !inner) return
  const parts = (speaking ? [t('radio.stateSpeaking')] : []).concat(info.states)
  const label = parts.length ? t('voice.memberStates', { name: info.labelName, states: parts.join(', ') }) : info.labelName
  inner.setAttribute('aria-label', info.self ? label : t('voice.memberSettings', { label: label }))
}

function renderCrew (s) {
  if (!el.radioCrew) return
  const focusKey = activeFocusKey(el.radioCrew)
  clear(el.radioCrew)
  const streams = cameraStreams(s)
  const keep = {}
  if (s.channelId) {
    voiceRoster(s.channelId).forEach((entry) => {
      if (streams[String(entry.userId)]) keep['crew-' + entry.userId] = true
      el.radioCrew.appendChild(buildVoiceMember(entry, true, streams))
    })
  }
  pruneCameraVideos('crew-', keep)
  renderRadioCams(Object.keys(streams).length)
  restoreFocusKey(el.radioCrew, focusKey)
}

// Araç satırındaki Büyüt düğmesi: kameraları yayın sahnesinde ızgara olarak açar veya kapatır. Odada kamera
// yokken kaldırılır. Düğme bir kez üretilir ve yerinde güncellenir (odak korunur), satırın başında durur.
function renderRadioCams (count) {
  const box = el.radioTools
  if (!box) return
  let b = byId('radio-cams')
  if (!count) {
    if (b && b.parentNode) b.parentNode.removeChild(b)
    return
  }
  if (!b) {
    b = h('button', 'radio-tool cams-tool')
    b.type = 'button'
    b.id = 'radio-cams'
    b.setAttribute('data-focus-key', 'tool-cams')
    b.setAttribute('aria-controls', 'cast')
    b.appendChild(icon('i-grid', 'radio-tool-icon'))
    const name = h('span', 'radio-tool-label')
    name.id = 'radio-cams-text'
    b.appendChild(name)
    b.appendChild(h('span', 'radio-tool-count'))
    b.addEventListener('click', () => {
      if (typeof castToggleCams === 'function') castToggleCams()
    })
  }
  if (b.parentNode !== box || box.firstElementChild !== b) box.insertBefore(b, box.firstElementChild)
  const open = typeof castCamsOpen === 'function' && castCamsOpen()
  b.setAttribute('aria-expanded', open ? 'true' : 'false')
  b.setAttribute('aria-label', t(open ? 'camera.gridCloseLabel' : 'camera.gridOpenLabel') + ', ' + t('radio.cameras', { count: count }))
  b.querySelector('.radio-tool-label').textContent = t(open ? 'camera.gridClose' : 'camera.gridOpen')
  b.querySelector('.radio-tool-count').textContent = String(count)
}

// Konuşma halesi ve giriş seviyesi gibi sık değişen göstergeler
function speakingIn (s, userId) {
  if (!s.channelId) return false
  if (state.me && sameId(userId, state.me.id)) return s.selfSpeaking === true
  return Boolean(s.peers && s.peers[String(userId)] && s.peers[String(userId)].speaking)
}

// Konuşma satırı: "Mert konuşuyor", "Mert ve Ece konuşuyor", "3 kişi konuşuyor", "Konuşuyorsunuz"
function radioTalkText (s) {
  const names = []
  let selfTalking = false
  voiceRoster(s.channelId).forEach((entry) => {
    if (!speakingIn(s, entry.userId)) return
    if (state.me && sameId(entry.userId, state.me.id)) selfTalking = true
    else names.push(shownName(entry.userId))
  })
  if (names.length === 1) return t('radio.talkOne', { name: names[0] })
  if (names.length === 2) return t('radio.talkTwo', { first: names[0], second: names[1] })
  if (names.length > 2) return t('radio.talkMany', { count: names.length })
  if (selfTalking || (s.channelId && s.selfSpeaking)) return t('radio.talkSelf')
  return ''
}

// Konuşma satırının sağı: kendi paylaşımımın izleyicileri, odadaki paylaşımlar veya konuşma modu
function radioModeText (s) {
  const sc = radioScreen(s)
  if (sc.state === 'live') return sc.viewerCount ? t('radio.viewers', { count: sc.viewerCount }) : t('screen.noViewers')
  const shares = sc.remote ? Object.keys(sc.remote).length : 0
  if (shares) return t('radio.screens', { count: shares })
  const cams = Object.keys(cameraStreams(s)).length
  if (cams) return t('radio.cameras', { count: cams })
  return t(s.ptt && s.ptt.enabled ? 'radio.modePtt' : 'radio.modeVad')
}

function setText (node, text) {
  if (node && node.textContent !== text) node.textContent = text
}

function updateVoiceLive () {
  const s = snap()
  if (el.radioCrew) {
    Array.from(el.radioCrew.querySelectorAll('.crew-item')).forEach((li) => {
      setCrewSpeaking(li, speakingIn(s, li.getAttribute('data-user-id')), false)
    })
  }
  if (el.radioTalk && s.channelId && !s.joining) {
    const talk = radioTalkText(s)
    setText(el.radioTalkText, talk || t('radio.talkNone'))
    el.radioTalk.classList.toggle('is-quiet', !talk)
    setText(el.radioMode, radioModeText(s))
  }
  // Çevrimiçi sayfasında da aynı odadaki konuşan kişi işaretlenir
  if (el.members) {
    Array.from(el.members.querySelectorAll('.member[data-user-id]')).forEach((row) => {
      const userId = row.getAttribute('data-user-id')
      const inMyChannel = s.channelId && voiceRoster(s.channelId).some((entry) => sameId(entry.userId, userId))
      row.classList.toggle('is-speaking', Boolean(inMyChannel && speakingIn(s, userId)))
    })
  }
  if (el.meAvatar) el.meAvatar.classList.toggle('is-speaking', Boolean(s.channelId && s.selfSpeaking))
  // Kameralar ızgarasındaki konuşan kişi
  if (el.cast && !el.cast.hidden) {
    Array.from(el.cast.querySelectorAll('.cam-tile[data-user-id]')).forEach((tile) => {
      tile.classList.toggle('is-speaking', speakingIn(s, tile.getAttribute('data-user-id')))
    })
  }
  updateBandLive()
  if (typeof updateLevelMeter === 'function') updateLevelMeter()
  // Ses etkinliği modunda Bas konuş yerindeki seviye çubuğu
  if (el.radioVadBar) {
    const open = Boolean(s.channelId && !s.joining && !s.muted)
    const level = open && typeof s.inputLevel === 'number' ? Math.max(0, Math.min(1, s.inputLevel)) : 0
    el.radioVadBar.style.width = Math.round(level * 100) + '%'
    el.radioVad.classList.toggle('is-open', Boolean(open && s.gateOpen))
  }
  const pttActive = Boolean(s.ptt && s.ptt.active)
  el.pttButton.classList.toggle('is-active', pttActive)
  el.pttButton.setAttribute('aria-pressed', pttActive ? 'true' : 'false')
  if (el.pttLabel) setText(el.pttLabel, t(pttActive ? 'voice.talking' : 'voice.pushToTalk'))
}

// Telsiz kartı: başlık (LED ve durum), ekran, hata satırı, ipucu, Bas konuş veya seviye çubuğu ve
// düğme sırası. Mikrofon ve sağırlaştırma düğmelerinin durumu renderUserPanel'dedir.
function renderVoicePanel () {
  const s = snap()
  const inVoice = Boolean(s.channelId)
  const joining = Boolean(s.joining)
  const live = inVoice || joining
  const connected = inVoice && !joining
  const ch = s.channelId ? findChannel(s.channelId) : null
  const chName = ch ? ch.name : ''
  const radioState = joining ? 'joining' : inVoice ? 'on' : 'off'
  if (el.radio) {
    el.radio.setAttribute('data-state', radioState)
    el.radio.setAttribute('aria-busy', joining ? 'true' : 'false')
  }
  setText(el.radioState, t(radioState === 'on' ? 'radio.on' : radioState === 'joining' ? 'radio.joining' : 'radio.off'))
  // Kapalı: ses odaları listesi, destek uyarısı ve tuş ipucu
  const problem = live ? null : voiceSupportCode()
  el.radioPick.hidden = live
  el.voiceChannels.hidden = live
  setMsg(el.radioSupport, problem ? voiceErrorText(problem, '') : '')
  renderRadioHint(live || Boolean(problem), s)
  // Bağlanırken ve bağlıyken: oda adı, kişi sayısı, kadro ve konuşma satırı
  el.radioTuned.hidden = !live
  setText(el.radioRoom, chName)
  const count = inVoice ? voiceRoster(s.channelId).length : 0
  setText(el.radioRoomMeta, joining ? t('voice.connecting') : connected ? t('radio.roomMeta', { count: count }) : '')
  renderCrew(s)
  el.radioTalk.hidden = !connected
  // Ekran okuyucu için durum satırı
  setText(el.voicePanelStatus, joining ? t('voice.connecting') : connected ? t('voice.connectedTo', { name: chName }) : '')
  // Hata ve Tekrar dene
  const errText = s.errorCode ? voiceErrorText(s.errorCode, s.serverError) : ''
  setMsg(el.voiceError, errText, 'error')
  el.voiceRetry.hidden = !(errText && !joining && (s.channelId || radioLastChannel) && s.errorCode !== 'kicked')
  el.radioError.hidden = !errText
  // Ses paneli: ses kilidi, Bas konuş veya ses etkinliği çubuğu, düğme sırası
  el.voicePanel.hidden = !live
  const pttMode = Boolean(s.ptt && s.ptt.enabled)
  el.voiceUnlock.hidden = !(connected && s.autoplayBlocked)
  el.pttButton.hidden = !(connected && pttMode && !s.autoplayBlocked)
  el.radioVad.hidden = !(connected && !pttMode && !s.autoplayBlocked)
  setText(el.radioVadState, t(s.muted ? 'radio.vadMuted' : 'radio.vadHint'))
  const key = pttKeyCap()
  setText(el.pttKey, key)
  if (key) {
    el.pttKey.title = t('radio.pttKey', { key: key })
  } else {
    el.pttKey.removeAttribute('title')
  }
  if (key.length === 1) {
    el.pttButton.setAttribute('aria-keyshortcuts', key)
  } else {
    el.pttButton.removeAttribute('aria-keyshortcuts')
  }
  renderScreenButton(s)
  renderCameraButton(s)
  el.voiceLeave.hidden = !live
  el.voiceLeave.setAttribute('aria-label', connected && chName ? t('radio.leaveLabel', { name: chName }) : t('voice.disconnect'))
  setText(el.voiceLeaveState, chName)
}

// Kapalı telsizin alt satırı: katılınca ne olacağı ve bas konuş modunda atanan tuş
function renderRadioHint (hide, s) {
  if (!el.radioHint) return
  clear(el.radioHint)
  if (hide) {
    el.radioHint.hidden = true
    return
  }
  const ptt = s.inputMode === 'ptt'
  el.radioHint.appendChild(document.createTextNode(t(ptt ? 'radio.hintPtt' : 'radio.hintVad')))
  const key = ptt ? pttKeyCap() : ''
  if (key) {
    el.radioHint.appendChild(document.createTextNode(' ' + t('radio.hintKey') + ' '))
    el.radioHint.appendChild(h('kbd', 'kbd', key))
  }
  el.radioHint.hidden = false
}

// Ekran düğmesi: paylaşamayan cihazda görünür ama devre dışı ve nedeni altında yazılı; paylaşabilen
// cihazda paylaşım başlatma penceresini açar (22-cast.js openCastDialog), yayındayken paylaşımı durdurur.
function renderScreenButton (s) {
  const b = el.btnScreen
  if (!b) return
  const sc = radioScreen(s)
  const canShare = Boolean(sc.canShare)
  const sharing = sc.state === 'live'
  const usable = canShare && Boolean(s.channelId) && !s.joining
  b.classList.toggle('is-live', sharing)
  b.classList.toggle('is-disabled', !usable)
  if (usable) {
    b.removeAttribute('aria-disabled')
  } else {
    b.setAttribute('aria-disabled', 'true')
  }
  setIcon(b, canShare ? 'i-screen' : 'i-screen-off')
  setText(el.btnScreenState, !canShare ? t('radio.screenOff') : sc.starting ? t('radio.screenStarting') : sharing ? t('radio.screenLive') : t('radio.screenShare'))
  b.setAttribute('aria-label', t(sharing ? 'screen.stop' : 'screen.share'))
  if (sharing) {
    b.removeAttribute('aria-haspopup')
  } else {
    b.setAttribute('aria-haspopup', 'dialog')
  }
  setMsg(el.radioScreenNote, canShare ? '' : screenReasonText(sc.reason))
  if (canShare) {
    b.removeAttribute('aria-describedby')
  } else {
    b.setAttribute('aria-describedby', 'radio-screen-note')
  }
}

// Kamera düğmesi: kapalıyken açar, açıkken kapatır. Cihaz desteklemiyorsa veya sahip kameraları
// kapattıysa görünür ama devre dışıdır, nedeni altında yazar. Kamera açıkken düğme sırasının üstünde
// "Kameranız açık" satırı (#radio-cam-live) her düzende görünür.
function renderCameraButton (s) {
  const b = el.btnCamera
  if (!b) return
  const cam = radioCamera(s)
  const allowed = camerasAllowed()
  const on = cam.state === 'on'
  const starting = cam.state === 'starting'
  const connected = Boolean(s.channelId) && !s.joining
  const usable = Boolean(cam.canUse) && allowed && connected
  b.classList.toggle('is-live', on)
  b.classList.toggle('is-disabled', !usable && !on)
  b.setAttribute('aria-pressed', on ? 'true' : 'false')
  if (usable || on) {
    b.removeAttribute('aria-disabled')
  } else {
    b.setAttribute('aria-disabled', 'true')
  }
  setIcon(b, cam.canUse && allowed ? 'i-camera' : 'i-camera-off')
  let stateText = t('radio.cameraOff')
  if (!cam.canUse) stateText = t('radio.cameraNone')
  else if (!allowed && !on) stateText = t('radio.cameraBlocked')
  else if (starting) stateText = t('radio.cameraStarting')
  else if (on) stateText = t('radio.cameraOn')
  setText(el.btnCameraState, stateText)
  b.setAttribute('aria-label', t(on ? 'camera.stop' : 'camera.start'))
  let note = ''
  if (!cam.canUse) note = cameraErrorText(cam.reason || 'camera_unsupported', '')
  else if (!allowed) note = t('camera.errors.camera_disabled')
  setMsg(el.radioCameraNote, connected ? note : '')
  if (note && connected) {
    b.setAttribute('aria-describedby', 'radio-camera-note')
  } else {
    b.removeAttribute('aria-describedby')
  }
  if (el.radioCamLive) {
    el.radioCamLive.hidden = !(on && connected)
    setText(el.radioCamLiveText, t('camera.liveSelf'))
  }
}

function onCameraButton () {
  if (!voice || typeof voice.startCamera !== 'function') return
  const s = snap()
  const cam = radioCamera(s)
  if (!s.channelId || s.joining || cam.state === 'starting') return
  if (cam.state === 'on') {
    voice.stopCamera()
    return
  }
  if (!cam.canUse) {
    toast(() => cameraErrorText(cam.reason || 'camera_unsupported', ''), 'error', 8000)
    return
  }
  if (!camerasAllowed()) {
    toast(() => t('camera.errors.camera_disabled'), 'error', 8000)
    return
  }
  // Hata snapshot.camera.errorCode ile bildirilir (onVoiceChange gösterir), burada yalnızca yakalanır
  Promise.resolve(voice.startCamera()).catch(() => {})
}

function onScreenButton () {
  const s = snap()
  const sc = radioScreen(s)
  if (!sc.canShare || !s.channelId || s.joining || sc.starting) return
  if (sc.state === 'live') {
    if (voice && typeof voice.stopScreenShare === 'function') voice.stopScreenShare()
    return
  }
  // Paylaşım başlatma penceresi 22-cast.js'tedir (kullanıcı hareketi içinde çağrılır)
  if (typeof openCastDialog === 'function') openCastDialog(el.btnScreen)
}

// Kart yeniden çizilince odak gizlenen bir öğede kaldıysa kartın anlamlı denetimine taşınır
// (katılınca Bas konuş veya Mikrofon, ayrılınca ilk Katıl düğmesi)
function radioKeepFocus () {
  const now = document.activeElement
  const lost = !now || now === document.body || Boolean(now.closest('[hidden]')) || !now.getClientRects().length
  if (!lost) return
  const s = snap()
  let target = null
  if (s.channelId || s.joining) target = el.pttButton.hidden ? el.btnMute : el.pttButton
  else target = el.voiceChannels.querySelector('.radio-join')
  if (target) focusNode(target)
}

// Bas konuş tuşunun kısa gösterimi (tuş kapağı): harf ve rakamlar tek karakter, diğerleri ad
function pttKeyCap () {
  if (!voice || typeof voice.settings !== 'function') return ''
  let binding = null
  try {
    const settings = voice.settings()
    binding = settings && settings.bindings ? settings.bindings.ptt : null
  } catch (err) {
    binding = null
  }
  if (!binding) return ''
  if (binding.type === 'key' && typeof binding.code === 'string') {
    const m = /^(?:Key|Digit)([A-Z0-9])$/.exec(binding.code)
    if (m) return m[1]
  }
  try {
    return String(voice.bindingLabel(binding, t) || '')
  } catch (err) {
    return ''
  }
}

// Üst çubuktaki avatar çipinin durum satırı: seste ise oda, değilse özel durum metni veya durum
function myStatusLine (s) {
  const ch = s.channelId ? findChannel(s.channelId) : null
  if (s.joining) return t('voice.joining')
  if (ch) return t('voice.inChannel', { name: ch.name })
  const chosen = state.me && typeof state.me.status === 'string' ? state.me.status : 'online'
  if (typeof userStatusText === 'function') {
    try {
      const custom = userStatusText(state.me.id)
      if (custom) return String(custom)
    } catch (err) {
      // Profil modülü hazır değil
    }
  }
  if (chosen === 'idle') return t('layout.status.idle')
  if (chosen === 'dnd') return t('layout.status.dnd')
  if (chosen === 'invisible') return t('layout.status.invisible')
  return t('user.online')
}

// Avatar çipi (#me-button) ve telsiz kartındaki mikrofon ve sağırlaştırma düğmeleri
function renderUserPanel () {
  if (!state.me) return
  const s = snap()
  const myName = shownName(state.me.id)
  if (el.meName) el.meName.textContent = myName
  if (el.meAvatar) {
    fillAvatar(el.meAvatar, state.me.id, 'sm')
    el.meAvatar.classList.toggle('is-speaking', Boolean(s.channelId && s.selfSpeaking))
  }
  if (el.meStatus) el.meStatus.textContent = myStatusLine(s)
  if (el.meButton) {
    el.meButton.setAttribute('aria-label', t('layout.statusMenu', { name: myName }))
    el.meButton.title = t('layout.statusMenu', { name: myName })
  }
  el.btnMute.setAttribute('aria-pressed', s.muted ? 'true' : 'false')
  setIcon(el.btnMute, s.muted ? 'i-mic-off' : 'i-mic')
  el.btnMute.classList.toggle('is-off', Boolean(s.muted))
  setText(el.btnMuteState, t(s.serverMuted ? 'voice.serverMutedTitle' : s.muted ? 'radio.micOff' : 'radio.micOn'))
  el.btnDeafen.setAttribute('aria-pressed', s.deafened ? 'true' : 'false')
  setIcon(el.btnDeafen, s.deafened ? 'i-headphones-off' : 'i-headphones')
  el.btnDeafen.classList.toggle('is-off', Boolean(s.deafened))
  setText(el.btnDeafenState, t(s.deafened ? 'radio.deafened' : 'radio.hearing'))
}

// Sesli sohbet kullanılamıyorsa hata kodu (insecure, unsupported, no_key), kullanılabiliyorsa null
function voiceSupportCode () {
  if (!voice) return 'unsupported'
  let support = null
  try {
    support = voice.support()
  } catch (err) {
    support = { ok: false, reason: 'unsupported' }
  }
  if (!support || !support.ok) return support && support.reason === 'insecure' ? 'insecure' : 'unsupported'
  if (!hasActiveKey()) return 'no_key'
  return null
}

function joinVoice (channelId) {
  const problem = voiceSupportCode()
  if (problem) {
    toast(() => voiceErrorText(problem, ''), 'error', 9000)
    return
  }
  const s = snap()
  if (sameId(s.channelId, channelId) || s.joining) return
  closeDrawers()
  radioLastChannel = channelId
  let pending = null
  try {
    pending = voice.join(channelId)
  } catch (err) {
    toast(voiceErrorOf(err), 'error')
    return
  }
  Promise.resolve(pending).then(() => {}, (err) => {
    toast(voiceErrorOf(err), 'error', 8000)
  })
}

function leaveVoice () {
  if (!voice) return
  Promise.resolve(voice.leave()).catch(() => {})
}

// Hata satırındaki Tekrar dene: bağlıyken bağlantı yeniden kurulur, değilken son odaya yeniden katılınır
function retryVoice () {
  if (!voice) return
  const s = snap()
  const target = s.channelId || radioLastChannel
  if (!target || s.joining) return
  const rejoin = () => {
    try {
      state.voiceSnap = voice.snapshot()
    } catch (err) {
      // Son bilinen durum kullanılır
    }
    joinVoice(target)
  }
  if (s.channelId) {
    Promise.resolve(voice.leave()).catch(() => {}).then(rejoin)
  } else {
    rejoin()
  }
}

function toggleMute () {
  if (!voice) {
    toast(() => t('errors.unsupported'), 'error')
    return
  }
  const s = snap()
  if (s.serverMuted) {
    // Herkes için susturulan kişi mikrofonunu açamaz
    toast(() => t('voice.serverMutedSelf'), 'error')
    return
  }
  if (s.deafened) {
    // Sağırken mikrofonu açmak sağırlaştırmayı da kaldırır
    voice.setDeafened(false)
    voice.setMuted(false)
    return
  }
  voice.setMuted(!s.muted)
}

function toggleDeafen () {
  if (!voice) {
    toast(() => t('errors.unsupported'), 'error')
    return
  }
  voice.setDeafened(!snap().deafened)
}

// Bas-konuş butonu (dokunmatik ve fare, basılı tutulduğu sürece) ve telsiz kartının diğer düğmeleri
// (12-init.js bindEvents bu işlevi çağırır; mikrofon, sağırlaştırma ve ayrılma orada bağlanır)

function bindPttButton () {
  bindPttTarget(el.pttButton)
  if (el.btnScreen) el.btnScreen.addEventListener('click', onScreenButton)
  if (el.btnCamera) el.btnCamera.addEventListener('click', onCameraButton)
  if (el.voiceRetry) el.voiceRetry.addEventListener('click', retryVoice)
}

function bindPttTarget (target) {
  if (!target) return
  const down = (e) => {
    if (e && e.cancelable) e.preventDefault()
    if (voice) voice.pttDown()
  }
  const up = () => {
    if (voice) voice.pttUp()
  }
  if (window.PointerEvent) {
    target.addEventListener('pointerdown', (e) => {
      try {
        target.setPointerCapture(e.pointerId)
      } catch (err) {
        // Yakalama desteklenmiyor
      }
      down(e)
    })
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
    target.addEventListener('lostpointercapture', up)
  } else {
    target.addEventListener('mousedown', down)
    target.addEventListener('mouseup', up)
    target.addEventListener('mouseleave', up)
    target.addEventListener('touchstart', down)
    target.addEventListener('touchend', up)
    target.addEventListener('touchcancel', up)
  }
  target.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault()
      down(null)
    }
  })
  target.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      up()
    }
  })
  target.addEventListener('blur', up)
  target.addEventListener('contextmenu', (e) => {
    e.preventDefault()
  })
}

// Ses odasındaki kişi için yerel ses seviyesi ve susturma (kadro öğesinden açılır)

let popoverUserId = null

// Kişi ses seviyesi voice.js tarafından kullanıcı kimliğine göre saklanır. Kişi aynı odada
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
  el.peerName.textContent = shownName(userId)
  const value = peerVolumeValue(userId)
  el.peerVolume.value = String(value)
  el.peerVolumeValue.textContent = formatPercent(value)
  renderPeerMute()
  if (el.peerModMsg) setMsg(el.peerModMsg, '')
  setMsg(el.peerNote, sameChannel ? '' : () => t('peer.note'))
  el.peerPopover.hidden = false
  positionPopup(el.peerPopover, trigger)
  if (trigger) trigger.setAttribute('aria-expanded', 'true')
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
      if (trigger) trigger.setAttribute('aria-expanded', 'false')
      const current = trigger ? liveTrigger(trigger) : null
      if (current) current.setAttribute('aria-expanded', 'false')
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
  el.peerMute.textContent = t(muted ? 'peer.unmute' : 'peer.mute')
  el.peerMute.disabled = !peer
  renderPeerMod()
}

// Ses odası denetimi (izinli ve kişiden üst rütbedeyse): herkes için susturma, kamerasını kapatma (yalnızca kamerası
// açıkken) ve odadan çıkarma
function renderPeerMod () {
  if (!el.peerMod) return
  const uid = popoverUserId
  const can = uid !== null && hasPerm('voice') && outranksUser(uid)
  el.peerMod.hidden = !can
  if (!can) return
  const rec = metaRecordOf(uid)
  const muted = Boolean(rec && rec.voiceMuted)
  el.peerServerMute.textContent = t(muted ? 'peer.serverUnmute' : 'peer.serverMute')
  el.peerServerMute.setAttribute('aria-pressed', muted ? 'true' : 'false')
  if (el.peerCameraOff) el.peerCameraOff.hidden = !userCameraOn(uid)
  el.peerDisconnect.disabled = !voiceChannelOf(uid)
}

const VOICE_MOD_OK_KEYS = { mute: 'peer.serverMutedOk', unmute: 'peer.serverUnmutedOk', 'camera-off': 'peer.cameraOffOk', disconnect: 'peer.disconnectedOk' }

// Herkes için susturma, kamerasını kapatma ve odadan çıkarma isteği (kişi ses kartından ve profil kartından)
async function moderateVoice (userId, action, msgEl, button) {
  const name = shownName(userId)
  if (action === 'disconnect' && !window.confirm(t('peer.disconnectConfirm', { name: name }))) return false
  if (button) button.disabled = true
  const res = await api('POST', '/api/voice/moderate', { userId: voiceUserArg(userId), action: action })
  if (button && isConnected(button)) button.disabled = false
  const okKey = VOICE_MOD_OK_KEYS[action] || 'peer.disconnectedOk'
  if (res.status === 200) {
    if (msgEl) setMsg(msgEl, () => t(okKey, { name: name }), 'ok')
    else toast(() => t(okKey, { name: name }), 'ok')
    return true
  }
  if (msgEl) setMsg(msgEl, () => errorText(res, t('peer.moderationFailed')), 'error')
  else toast(() => errorText(res, t('peer.moderationFailed')), 'error')
  return false
}

function onPeerServerMuteClick () {
  if (popoverUserId === null) return
  const uid = popoverUserId
  const rec = metaRecordOf(uid)
  moderateVoice(uid, rec && rec.voiceMuted ? 'unmute' : 'mute', el.peerModMsg, el.peerServerMute)
}

function onPeerDisconnectClick () {
  if (popoverUserId === null) return
  moderateVoice(popoverUserId, 'disconnect', el.peerModMsg, el.peerDisconnect)
}

// İstek sürerken düğme devre dışı kalır ve odak düşer. Başarıda düğme metayla gizleneceği için odak susturma
// düğmesine, hatada düğmenin kendisine döner.
async function onPeerCameraOffClick () {
  if (popoverUserId === null) return
  const hadFocus = document.activeElement === el.peerCameraOff
  const done = await moderateVoice(popoverUserId, 'camera-off', el.peerModMsg, el.peerCameraOff)
  if (hadFocus && findLayer('peer')) focusNode(done ? el.peerServerMute : el.peerCameraOff)
}

function onPeerVolumeInput () {
  if (popoverUserId === null) return
  const value = Math.max(0, Math.min(100, Math.round(Number(el.peerVolume.value) || 0)))
  el.peerVolumeValue.textContent = formatPercent(value)
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
