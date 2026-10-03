'use strict'

// Uygulama durumu, öğe önbelleği, DOM yardımcıları, dil değişince yeniden çevrilen metinler (setLive),
// katman yığını, bildirim şeridi ve panoya kopyalama.

// Uygulama durumu

const state = {
  info: null,
  serverName: 'Telsiz',
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
  sessionLost: false,
  fragmentNotice: null,
  // Orta alanın görünümü: 'channel', 'dm' veya 'home' (#app-view[data-view], 15-dm.js yönetir)
  view: 'channel',
  // Kanal başına beni anan okunmamış mesaj sayısı (anma rozeti, Ek H3.5)
  mentions: Object.create(null)
}

let voice = null
const el = {}

function byId (id) {
  return document.getElementById(id)
}

const ELEMENT_IDS = [
  'toast', 'boot-view', 'boot-text', 'boot-retry',
  'auth-view', 'auth-server-name', 'auth-notice', 'auth-lang',
  'setup-card', 'setup-form', 'setup-name', 'setup-password', 'setup-password2', 'setup-code', 'setup-error', 'setup-submit',
  'invite-card', 'invite-link', 'invite-key', 'invite-copy-link', 'invite-copy-key', 'invite-continue',
  'login-card', 'auth-tab-login', 'auth-tab-register', 'login-form', 'login-name', 'login-password', 'login-error', 'login-submit',
  'register-form', 'register-name', 'register-password', 'register-password2', 'register-invite', 'register-error', 'register-submit',
  'key-card', 'key-intro', 'key-form', 'key-input', 'key-error', 'key-add', 'key-generate-wrap', 'key-generate', 'key-skip', 'key-logout',
  'auth-scheme',
  'app-view', 'conn-banner', 'sidebar', 'sidebar-close', 'server-name', 'server-emblem', 'server-meta', 'text-channels', 'voice-channels',
  'home-entry', 'dm-section', 'dm-list',
  'voice-panel', 'voice-panel-status', 'voice-panel-channel', 'voice-leave', 'voice-error', 'voice-unlock', 'ptt-button', 'ptt-label', 'ptt-key',
  'user-panel', 'me-button', 'me-avatar', 'me-name', 'me-status', 'btn-mute', 'btn-deafen', 'btn-settings',
  'main', 'btn-open-channels', 'channel-title', 'dm-header', 'key-state', 'btn-search', 'btn-open-members',
  'search-panel', 'home-view', 'key-warning', 'typing-line', 'mention-popover',
  'voice-strip', 'voice-strip-text', 'voice-strip-ptt', 'voice-strip-ptt-label', 'voice-strip-leave',
  'messages', 'channel-start', 'channel-start-title', 'load-older-wrap', 'load-older', 'message-list', 'messages-status', 'messages-retry-wrap', 'messages-retry',
  'composer', 'attach-list', 'photo-note', 'composer-hint', 'composer-hint-text', 'composer-hint-action',
  'composer-form', 'btn-photo', 'btn-file', 'composer-input', 'btn-emoji', 'btn-send', 'char-counter', 'file-photo', 'file-any',
  'emoji-picker', 'emoji-tabs', 'emoji-title', 'emoji-grid', 'drop-overlay',
  'members', 'members-count', 'members-close', 'members-online-title', 'members-online', 'members-offline-title', 'members-offline', 'drawer-backdrop',
  'msg-menu', 'msg-menu-edit', 'msg-menu-delete',
  'peer-popover', 'peer-name', 'peer-volume', 'peer-volume-value', 'peer-mute', 'peer-note',
  'profile-card', 'status-menu', 'dialog-root',
  'viewer', 'viewer-name', 'viewer-download', 'viewer-close', 'viewer-stage', 'viewer-img',
  'settings-modal', 'settings-tabs', 'settings-close',
  'settings-tab-account', 'settings-tab-voice', 'settings-tab-crypto', 'settings-tab-server', 'settings-tab-members',
  'settings-panel-account', 'settings-panel-voice', 'settings-panel-crypto', 'settings-panel-server', 'settings-panel-members',
  'set-avatar', 'set-name', 'set-role', 'set-password-form', 'set-old-password', 'set-new-password', 'set-new-password2', 'set-password-msg', 'set-password-submit',
  'set-notify', 'set-notify-msg', 'set-install-wrap', 'set-install', 'set-ios-hint', 'set-lang', 'set-logout',
  'set-voice-support', 'set-mic', 'set-mic-refresh', 'set-mode-vad', 'set-mode-ptt',
  'set-vad-wrap', 'set-vad-auto', 'set-vad-threshold', 'set-vad-threshold-value',
  'set-ptt-wrap', 'set-ptt-key', 'set-ptt-change', 'set-ptt-msg', 'set-ptt-release', 'set-ptt-release-value',
  'set-level-bar', 'set-level-threshold', 'set-level-note',
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

// Dil değişince yeniden çevrilecek metinler: öğe ve metni üreten fonksiyon
const liveTexts = new Map()

// Öğenin metnini ayarlar. Değer fonksiyonsa (() => t('...')) dil değişince yeniden üretilir.
function setLive (node, value) {
  if (!node) return ''
  const text = textOf(value)
  node.textContent = text
  if (typeof value === 'function') liveTexts.set(node, value)
  else liveTexts.delete(node)
  return text
}

function refreshLiveTexts () {
  liveTexts.forEach((producer, node) => {
    if (!isConnected(node)) {
      liveTexts.delete(node)
      return
    }
    node.textContent = textOf(producer)
  })
}

function setMsg (node, value, kind) {
  if (!node) return
  const text = setLive(node, value || '')
  node.hidden = !text
  node.classList.toggle('is-error', kind === 'error')
  node.classList.toggle('is-ok', kind === 'ok')
}

// Kişi bilgisi yardımcıları: 13-profile.js'teki görünen ad, durum ve avatar bilgisi varsa onlar,
// yoksa meta listesindeki kullanıcı adı ve baş harf kullanılır (sözleşme 2).

function shownName (userId) {
  if (typeof userDisplayName === 'function') {
    try {
      const name = userDisplayName(userId)
      if (name) return String(name)
    } catch (err) {
      // Profil modülü hazır değil
    }
  }
  const user = state.users.get(String(userId))
  return user && user.name ? user.name : t('users.unknown')
}

function shownHandle (userId) {
  if (typeof userHandle === 'function') {
    try {
      return String(userHandle(userId) || '')
    } catch (err) {
      return ''
    }
  }
  const user = state.users.get(String(userId))
  return user && user.name ? '@' + user.name : ''
}

const SHOWN_STATUS = ['online', 'idle', 'dnd', 'offline']

function shownStatus (userId) {
  let status = null
  if (typeof userStatus === 'function') {
    try {
      status = userStatus(userId)
    } catch (err) {
      status = null
    }
  }
  if (SHOWN_STATUS.indexOf(status) === -1) {
    const user = state.users.get(String(userId))
    status = user && typeof user.status === 'string' && SHOWN_STATUS.indexOf(user.status) !== -1 ? user.status : user && user.online ? 'online' : 'offline'
  }
  return status
}

function avatarInfoFor (userId, fallbackName) {
  let info = null
  if (typeof userAvatarInfo === 'function') {
    try {
      info = userAvatarInfo(userId)
    } catch (err) {
      info = null
    }
  }
  const index = info && Number(info.colorIndex) >= 0 && Number(info.colorIndex) <= 7 ? Math.floor(Number(info.colorIndex)) : Number(avatarClass(userId).slice(8)) || 0
  const letter = info && info.initial ? String(info.initial) : initial(fallbackName || shownName(userId))
  const url = info && typeof info.blobUrl === 'string' && info.blobUrl.indexOf('blob:') === 0 ? info.blobUrl : null
  return { initial: letter, colorIndex: index, blobUrl: url }
}

const AVATAR_SIZES = ['xs', 'sm', 'md', 'lg', 'xl']

// Avatar: avatar(userId, size). size 'xs' | 'sm' | 'md' (varsayılan) | 'lg' | 'xl'.
// Biçim (kartuş, daire, sekizgen) temadan, durum işareti data-status özniteliğinden gelir.
// Eski çağrı biçimi avatar(userId, ad, ekSınıf) de çalışır, üçüncü bağımsız değişken ek sınıftır.
function avatar (userId, size) {
  const extraClass = arguments.length > 2 ? arguments[2] : ''
  const sized = AVATAR_SIZES.indexOf(size) !== -1
  const fallbackName = !sized && typeof size === 'string' ? size : ''
  const span = h('span', 'avatar')
  span.setAttribute('aria-hidden', 'true')
  fillAvatar(span, userId, sized ? size : 'md', fallbackName)
  if (extraClass) String(extraClass).split(' ').filter(Boolean).forEach((c) => span.classList.add(c))
  return span
}

// Var olan bir avatar öğesini (ör. #me-avatar) yeniden çizer
function fillAvatar (node, userId, size, fallbackName) {
  if (!node) return node
  const info = avatarInfoFor(userId, fallbackName)
  const keep = Array.from(node.classList).filter((c) => c !== 'avatar' && c !== 'has-face' && !/^avatar-(c[0-9]|xs|sm|md|lg|xl)$/.test(c))
  node.className = ['avatar', 'has-face', 'avatar-c' + info.colorIndex, 'avatar-' + (AVATAR_SIZES.indexOf(size) !== -1 ? size : 'md')].concat(keep).join(' ')
  node.setAttribute('data-user-id', String(userId))
  node.setAttribute('data-status', shownStatus(userId))
  clear(node)
  const face = h('span', 'avatar-face')
  if (info.blobUrl) {
    const img = h('img', 'avatar-img')
    img.alt = ''
    img.src = info.blobUrl
    face.appendChild(img)
  } else {
    face.textContent = info.initial
  }
  node.appendChild(face)
  return node
}

function roleBadge (role) {
  if (role !== 'owner' && role !== 'admin') return null
  return h('span', 'badge badge-' + role, roleLabel(role))
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

// Metin dize veya dil değişince yeniden üretilen fonksiyon olabilir
function toast (text, kind, ms) {
  if (!text || !textOf(text)) return
  clearTimeout(toastTimer)
  setLive(el.toast, text)
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
    toast(() => t(ok ? 'clipboard.copied' : 'clipboard.failed'), ok ? 'ok' : 'error')
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
