'use strict'

// Ses arayüzü: VoiceClient bağlantısı, ses hata kodlarının çevirisi, ses kanalları ve kadrolar, kullanıcı
// paneli, bas konuş düğmesi ve kişi paneli.

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
    peers: {}
  }
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

function onVoiceChange (snapshot) {
  state.voiceSnap = snapshot || null
  const code = snapshot && snapshot.errorCode ? snapshot.errorCode : null
  const server = snapshot && snapshot.serverError ? snapshot.serverError : ''
  if (code && code !== lastVoiceError) toast(() => voiceErrorText(code, server), 'error', 8000)
  lastVoiceError = code
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
  return [s.channelId, s.joining, s.muted, s.deafened, s.errorCode, s.autoplayBlocked, s.inputMode, s.ptt && s.ptt.enabled, peerKey, roster, channels].join('|')
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
    const roster = voiceRoster(c.id)
    const joined = sameId(s.channelId, c.id)
    const li = h('li', 'channel-row voice-row' + (joined ? ' is-joined' : ''))
    const b = h('button', 'channel-item voice-channel' + (joined ? ' is-joined' : ''))
    b.type = 'button'
    b.setAttribute('data-channel-id', String(c.id))
    b.setAttribute('data-focus-key', 'voice-' + c.id)
    b.appendChild(channelFreqNode(c.id))
    b.appendChild(icon('i-speaker', 'channel-icon'))
    b.appendChild(h('span', 'channel-name', c.name))
    if (roster.length) b.appendChild(h('span', 'voice-count', roster.length + '/8'))
    b.setAttribute('aria-label', t(joined ? 'voice.channelJoined' : 'voice.channelJoin', { name: c.name, count: roster.length }))
    if (joined) b.setAttribute('aria-current', 'true')
    b.addEventListener('click', () => {
      joinVoice(c.id)
    })
    li.appendChild(b)
    if (roster.length) {
      const ul = h('ul', 'voice-members')
      ul.setAttribute('aria-label', t('voice.channelMembers', { name: c.name }))
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
  const name = shownName(entry.userId)
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
  const av = avatar(entry.userId, 'sm')
  av.removeAttribute('data-status')
  inner.appendChild(av)
  const labelName = self ? t('voice.selfName', { name: name }) : name
  inner.appendChild(h('span', 'voice-member-name', labelName))
  const states = []
  if (!self && sameChannel && peer && peer.status === 'failed') {
    const warn = h('span', 'voice-flag voice-flag-error')
    warn.appendChild(icon('i-alert'))
    warn.title = t('voice.peerFailed')
    inner.appendChild(warn)
    states.push(t('voice.peerFailed'))
  }
  if (!self && peer && peer.localMute) states.push(t('voice.localMuted'))
  if (muted) {
    const m = h('span', 'voice-flag')
    m.appendChild(icon('i-mic-off'))
    m.title = t('voice.mutedTitle')
    inner.appendChild(m)
    states.push(t('voice.mutedState'))
  }
  if (deafened) {
    const d = h('span', 'voice-flag')
    d.appendChild(icon('i-headphones-off'))
    d.title = t('voice.deafenedTitle')
    inner.appendChild(d)
    states.push(t('voice.deafenedState'))
  }
  const label = states.length ? t('voice.memberStates', { name: labelName, states: states.join(', ') }) : labelName
  inner.setAttribute('aria-label', self ? label : t('voice.memberSettings', { label: label }))
  li.appendChild(inner)
  return li
}

// Konuşma halesi ve giriş seviyesi gibi sık değişen göstergeler
function speakingIn (s, userId) {
  if (!s.channelId) return false
  if (state.me && sameId(userId, state.me.id)) return s.selfSpeaking === true
  return Boolean(s.peers && s.peers[String(userId)] && s.peers[String(userId)].speaking)
}

function updateVoiceLive () {
  const s = snap()
  Array.from(el.voiceChannels.querySelectorAll('.voice-member')).forEach((li) => {
    const userId = li.getAttribute('data-user-id')
    const channelLi = li.closest('.voice-row')
    const channelButton = channelLi ? channelLi.querySelector('.voice-channel') : null
    const sameChannel = channelButton && sameId(channelButton.getAttribute('data-channel-id'), s.channelId)
    li.classList.toggle('is-speaking', Boolean(sameChannel && speakingIn(s, userId)))
  })
  // Üye listesinde de aynı kanaldaki konuşan kişi işaretlenir
  if (el.members) {
    Array.from(el.members.querySelectorAll('.member[data-user-id]')).forEach((row) => {
      const userId = row.getAttribute('data-user-id')
      const inMyChannel = s.channelId && voiceRoster(s.channelId).some((entry) => sameId(entry.userId, userId))
      row.classList.toggle('is-speaking', Boolean(inMyChannel && speakingIn(s, userId)))
    })
  }
  el.meAvatar.classList.toggle('is-speaking', Boolean(s.channelId && s.selfSpeaking))
  if (typeof isSettingsTab === 'function' && isSettingsTab('voice') && typeof updateLevelMeter === 'function') updateLevelMeter()
  const pttActive = Boolean(s.ptt && s.ptt.active)
  const label = t(pttActive ? 'voice.talking' : 'voice.pushToTalk')
  el.pttButton.classList.toggle('is-active', pttActive)
  el.pttButton.setAttribute('aria-pressed', pttActive ? 'true' : 'false')
  if (el.pttLabel) el.pttLabel.textContent = label
  if (el.voiceStripPtt) {
    el.voiceStripPtt.classList.toggle('is-active', pttActive)
    el.voiceStripPtt.setAttribute('aria-pressed', pttActive ? 'true' : 'false')
  }
  if (el.voiceStripPttLabel) el.voiceStripPttLabel.textContent = label
}

function renderVoicePanel () {
  const s = snap()
  const ch = s.channelId ? findChannel(s.channelId) : null
  const inVoice = Boolean(s.channelId)
  el.voicePanel.hidden = !inVoice && !s.joining
  const chName = ch ? ch.name : ''
  el.voicePanelStatus.textContent = s.joining ? t('voice.connecting') : inVoice ? t('voice.connectedTo', { name: chName }) : t('voice.notConnected')
  el.voicePanelStatus.classList.toggle('is-connected', inVoice && !s.joining)
  el.voicePanelChannel.textContent = s.joining ? chName : ''
  el.voicePanelChannel.hidden = !s.joining
  el.voiceLeave.hidden = !inVoice && !s.joining
  setMsg(el.voiceError, s.errorCode ? voiceErrorText(s.errorCode, s.serverError) : '', 'error')
  el.voiceUnlock.hidden = !(inVoice && s.autoplayBlocked)
  el.pttButton.hidden = !(inVoice && s.ptt && s.ptt.enabled)
  if (el.voiceStripPtt) el.voiceStripPtt.hidden = el.pttButton.hidden
  if (el.pttKey) el.pttKey.textContent = pttKeyCap()
  el.voiceStrip.hidden = !inVoice
  el.voiceStripText.textContent = t('voice.inChannel', { name: ch ? ch.name : '' })
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

// Kullanıcı panelindeki durum satırı: seste ise kanal, değilse özel durum metni veya durum
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

function renderUserPanel () {
  if (!state.me) return
  const s = snap()
  el.meName.textContent = shownName(state.me.id)
  fillAvatar(el.meAvatar, state.me.id, 'md')
  el.meAvatar.classList.toggle('is-speaking', Boolean(s.channelId && s.selfSpeaking))
  el.meStatus.textContent = myStatusLine(s)
  if (el.meButton) {
    el.meButton.setAttribute('aria-label', t('layout.statusMenu', { name: shownName(state.me.id) }))
    el.meButton.title = t('layout.statusMenu', { name: shownName(state.me.id) })
  }
  el.btnMute.setAttribute('aria-pressed', s.muted ? 'true' : 'false')
  setIcon(el.btnMute, s.muted ? 'i-mic-off' : 'i-mic')
  el.btnMute.classList.toggle('is-off', Boolean(s.muted))
  el.btnDeafen.setAttribute('aria-pressed', s.deafened ? 'true' : 'false')
  setIcon(el.btnDeafen, s.deafened ? 'i-headphones-off' : 'i-headphones')
  el.btnDeafen.classList.toggle('is-off', Boolean(s.deafened))
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

function toggleMute () {
  if (!voice) {
    toast(() => t('errors.unsupported'), 'error')
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
    toast(() => t('errors.unsupported'), 'error')
    return
  }
  voice.setDeafened(!snap().deafened)
}

// Bas-konuş butonu (dokunmatik ve fare, basılı tutulduğu sürece)

function bindPttButton () {
  bindPttTarget(el.pttButton)
  bindPttTarget(el.voiceStripPtt)
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
  el.peerName.textContent = shownName(userId)
  const value = peerVolumeValue(userId)
  el.peerVolume.value = String(value)
  el.peerVolumeValue.textContent = formatPercent(value)
  renderPeerMute()
  setMsg(el.peerNote, sameChannel ? '' : () => t('peer.note'))
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
  el.peerMute.textContent = t(muted ? 'peer.unmute' : 'peer.mute')
  el.peerMute.disabled = !peer
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
