'use strict'

// Profiller: /api/profiles ile toplu çekme ve (id, pv) önbelleği, grup anahtarıyla şifreli profil
// zarfının çözülüp doğrulanması, profil resimleri (indirme, çözme, blob URL önbelleği), kişisel
// anahtarın kimlik bağlamasıyla doğrulanması ve ilk görüşte sabitlenmesi, görsel yardımcılar
// (görünen ad, @kullanıcı adı, avatar bilgisi, durum), ortak pencere yardımcısı, profil kartı,
// durum menüsü ve kendi profilini kaydetme.

const PROFILE_BATCH = 100
const PROFILE_FETCH_DELAY_MS = 30
const PROFILE_NAME_MAX = 32
const PROFILE_STATUS_MAX = 128
const PROFILE_BIO_MAX = 190
const PROFILE_COLORS = 8
const AVATAR_EDGE = 256
const AVATAR_JPEG_QUALITY = 0.9
const AVATAR_TYPES = ['image/png', 'image/jpeg']
const STATUS_CHOICES = ['online', 'idle', 'dnd', 'invisible']
const SHOWN_STATUSES = ['online', 'idle', 'dnd', 'offline']

const profileState = {
  entries: new Map(),
  avatars: new Map(),
  formerUsers: new Map(),
  queue: new Set(),
  timer: 0,
  fetching: false,
  gen: 0,
  renderQueued: false,
  changed: new Set(),
  cardUserId: null,
  cardTrigger: null,
  metaIds: null
}

// Önbellek

function profilesReset () {
  profileState.gen += 1
  clearTimeout(profileState.timer)
  profileState.queue.clear()
  profileState.changed.clear()
  profileState.entries = new Map()
  profileState.formerUsers = new Map()
  profileState.metaIds = null
  profileState.fetching = false
  profileState.avatars.forEach((entry) => {
    revokeLater(entry.url)
  })
  profileState.avatars = new Map()
}

function revokeLater (url) {
  if (!url) return
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url)
    } catch (err) {
      // Zaten bırakılmış
    }
  }, REVOKE_DELAY_MS)
}

async function refreshFormerUsers () {
  const gen = profileState.gen
  const res = await api('GET', '/api/state')
  if (gen !== profileState.gen || res.status !== 200 || !res.data) return
  setFormerUsers(res.data.formerUsers)
  if (!state.inApp) return
  refreshAllMessages()
  socialRender()
}

// Sunucudan engellenen hesapların adları (eski mesajlarında gösterilir)
function setFormerUsers (list) {
  profileState.formerUsers = new Map()
  if (!Array.isArray(list)) return
  list.forEach((u) => {
    if (u && u.id !== undefined && typeof u.name === 'string') profileState.formerUsers.set(String(u.id), u.name)
  })
}

function profileRecord (userId) {
  if (userId === null || userId === undefined) return null
  return profileState.entries.get(String(userId)) || null
}

function metaUser (userId) {
  const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
  return users.filter((u) => u && sameId(u.id, userId))[0] || null
}

// Meta'daki pv değişen kullanıcıların profilleri kuyruğa alınır. Listeden düşen kullanıcı varsa
// (hesap silindi veya sunucudan engellendi) engellenenlerin adları yeniden alınır.
function profilesOnMeta () {
  const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
  const ids = new Set(users.map((u) => String(u && u.id)))
  const before = profileState.metaIds
  profileState.metaIds = ids
  if (before && Array.from(before).some((id) => !ids.has(id))) refreshFormerUsers()
  users.forEach((u) => {
    if (!u || u.id === undefined) return
    const rec = profileRecord(u.id)
    const pv = typeof u.pv === 'number' ? u.pv : 0
    if (!rec || rec.pv !== pv) profileState.queue.add(String(u.id))
  })
  scheduleProfileFetch()
}

// Meta dışında kalabilecek kişiler (özel mesaj, arkadaşlık listeleri) için de profil istenir
function profilesEnsure (ids) {
  if (!Array.isArray(ids)) return
  ids.forEach((id) => {
    if (id === null || id === undefined) return
    if (!profileRecord(id)) profileState.queue.add(String(id))
  })
  scheduleProfileFetch()
}

function profilesRefetch (ids) {
  ids.forEach((id) => {
    profileState.queue.add(String(id))
  })
  scheduleProfileFetch()
}

function scheduleProfileFetch () {
  if (!profileState.queue.size || profileState.fetching || !state.token) return
  clearTimeout(profileState.timer)
  profileState.timer = setTimeout(fetchProfiles, PROFILE_FETCH_DELAY_MS)
}

async function fetchProfiles () {
  if (profileState.fetching || !profileState.queue.size || !state.token) return
  profileState.fetching = true
  const gen = profileState.gen
  try {
    while (profileState.queue.size && gen === profileState.gen) {
      const batch = Array.from(profileState.queue).slice(0, PROFILE_BATCH)
      batch.forEach((id) => {
        profileState.queue.delete(id)
      })
      const ids = batch.filter((id) => /^[1-9][0-9]{0,15}$/.test(id))
      if (!ids.length) continue
      const res = await api('GET', '/api/profiles?ids=' + ids.join(','))
      if (gen !== profileState.gen) return
      if (res.status !== 200 || !res.data || !Array.isArray(res.data.profiles)) break
      const seen = new Set()
      res.data.profiles.forEach((entry) => {
        if (!entry || entry.id === undefined) return
        seen.add(String(entry.id))
        storeProfileEntry(entry)
      })
      ids.forEach((id) => {
        if (seen.has(id)) return
        // Silinmiş veya sunucudan engellenmiş: yeniden istenmesin
        const old = profileRecord(id)
        if (old && old.missing) return
        profileState.entries.set(id, { id: id, pv: -1, missing: true, raw: null, profile: null, publicKey: null, identity: null, avatarUploadId: null, keyState: 'none' })
        profileState.changed.add(id)
      })
      queueProfileRender()
    }
  } finally {
    if (gen === profileState.gen) profileState.fetching = false
  }
  if (gen === profileState.gen && profileState.queue.size) scheduleProfileFetch()
}

function storeProfileEntry (entry) {
  const id = String(entry.id)
  const old = profileRecord(id)
  const rec = {
    id: id,
    pv: typeof entry.pv === 'number' ? entry.pv : 0,
    missing: false,
    raw: typeof entry.profile === 'string' ? entry.profile : null,
    avatarUploadId: typeof entry.avatarUploadId === 'string' && UPLOAD_ID_RE.test(entry.avatarUploadId) ? entry.avatarUploadId : null,
    publicKey: typeof entry.publicKey === 'string' ? entry.publicKey : null,
    identity: typeof entry.identity === 'string' ? entry.identity : null,
    profile: null,
    keyState: 'none',
    keyKid: null
  }
  decodeProfile(rec)
  verifyProfileKey(rec)
  profileState.entries.set(id, rec)
  const oldAvatar = old && old.profile && old.profile.avatar ? old.profile.avatar.u : null
  const newAvatar = rec.profile && rec.profile.avatar ? rec.profile.avatar.u : null
  if (oldAvatar && oldAvatar !== newAvatar) dropAvatar(oldAvatar)
  if (rec.profile && rec.profile.avatar) loadAvatar(rec)
  profileState.changed.add(id)
}

// Grup anahtarı değişince (eklendi, etkin anahtar değişti) profiller yeniden çözülür ve doğrulanır
function profilesRecheck () {
  profileState.entries.forEach((rec) => {
    if (rec.missing) return
    decodeProfile(rec)
    verifyProfileKey(rec)
    if (rec.profile && rec.profile.avatar) loadAvatar(rec)
    profileState.changed.add(rec.id)
  })
  queueProfileRender()
}

function cleanLine (value, max) {
  if (typeof value !== 'string') return ''
  return cpSliceExact(normalizeName(value), max)
}

function cpSliceExact (text, max) {
  const cps = codePoints(text)
  return cps.length > max ? cps.slice(0, max).join('') : text
}

function cleanBio (value) {
  if (typeof value !== 'string') return ''
  let text = value
  try {
    text = text.normalize('NFC')
  } catch (err) {
    // normalize yoksa olduğu gibi
  }
  text = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\n{3,}/g, '\n\n').trim()
  return cpSliceExact(text, PROFILE_BIO_MAX)
}

function cleanColor (value) {
  return typeof value === 'number' && Math.floor(value) === value && value >= 0 && value < PROFILE_COLORS ? value : null
}

function cleanAvatarRef (value, rec) {
  if (!value || typeof value !== 'object') return null
  if (typeof value.u !== 'string' || !UPLOAD_ID_RE.test(value.u) || value.u !== rec.avatarUploadId) return null
  if (typeof value.k !== 'string' || !B64URL_RE.test(value.k) || typeof value.n !== 'string' || !B64URL_RE.test(value.n)) return null
  const mime = typeof value.m === 'string' ? value.m : ''
  if (AVATAR_TYPES.indexOf(mime) === -1) return null
  return { u: value.u, k: value.k, n: value.n, m: mime }
}

// Profil zarfı grup anahtarıyla açılır, u alanı kişinin kimliği olmalıdır (sunucu profilleri
// kullanıcılar arasında değiştiremez). Açılamayan profil yok sayılır.
function decodeProfile (rec) {
  rec.profile = null
  if (!rec.raw || !cryptoReady()) return
  let opened = null
  try {
    opened = window.E2EE.openJson(rec.raw)
  } catch (err) {
    opened = null
  }
  if (!opened || opened.ok !== true) return
  const v = opened.value
  if (!v || typeof v !== 'object' || v.v !== 1 || !sameId(v.u, rec.id)) return
  rec.profile = {
    displayName: cleanLine(v.displayName, PROFILE_NAME_MAX),
    statusText: cleanLine(v.statusText, PROFILE_STATUS_MAX),
    bio: cleanBio(v.bio),
    color: cleanColor(v.color),
    avatar: cleanAvatarRef(v.avatar, rec)
  }
}

// Kişisel anahtar ancak grup anahtarıyla açılan kimlik bağlaması kişinin kimliğini ve sunucudaki
// açık anahtarı taşıyorsa kullanılır. Doğrulanan anahtar ilk görüşte sabitlenir.
function verifyProfileKey (rec) {
  rec.keyState = 'none'
  rec.keyKid = null
  if (!rec.publicKey || !cryptoReady()) return
  if (!rec.identity) {
    rec.keyState = 'unverified'
    return
  }
  let check = null
  try {
    check = window.E2EE.identity.verifyBinding(rec.identity, rec.id, rec.publicKey)
  } catch (err) {
    check = null
  }
  if (!check || check.ok !== true) {
    rec.keyState = 'unverified'
    return
  }
  rec.keyState = 'ok'
  rec.keyKid = check.kid
  if (state.me && !sameId(rec.id, state.me.id)) {
    try {
      window.E2EE.pins.observe(state.me.id, rec.id, rec.publicKey)
    } catch (err) {
      window.console.error(err)
    }
  }
}

// Profil resimleri: indirilir, çözülür, içerik türü doğrulanır ve blob URL olarak saklanır

function loadAvatar (rec) {
  const ref = rec.profile && rec.profile.avatar
  if (!ref) return
  const existing = profileState.avatars.get(ref.u)
  if (existing) return
  const entry = { url: '', state: 'loading' }
  profileState.avatars.set(ref.u, entry)
  const gen = profileState.gen
  downloadPlain({ u: ref.u, k: ref.k, n: ref.n }, null).then((res) => {
    if (gen !== profileState.gen || profileState.avatars.get(ref.u) !== entry) return
    if (!res.ok) {
      entry.state = 'failed'
      return
    }
    const sniffed = window.E2EE.sniffImage(res.bytes)
    if (!sniffed || AVATAR_TYPES.indexOf(sniffed) === -1 || sniffed !== ref.m) {
      entry.state = 'failed'
      return
    }
    entry.url = URL.createObjectURL(new Blob([res.bytes], { type: sniffed }))
    entry.state = 'ok'
    profileState.changed.add(rec.id)
    queueProfileRender()
  })
}

function dropAvatar (uploadId) {
  const entry = profileState.avatars.get(uploadId)
  if (!entry) return
  profileState.avatars.delete(uploadId)
  revokeLater(entry.url)
}

function avatarUrlOf (userId) {
  const profile = activeProfile(userId)
  const ref = profile ? profile.avatar : null
  if (!ref) return null
  const entry = profileState.avatars.get(ref.u)
  return entry && entry.state === 'ok' ? entry.url : null
}

// Profil değişince görünür bölgeler bir sonraki karede yeniden çizilir
function queueProfileRender () {
  if (profileState.renderQueued) return
  profileState.renderQueued = true
  nextFrame(() => {
    profileState.renderQueued = false
    const changed = new Set(profileState.changed)
    profileState.changed.clear()
    if (!changed.size || !state.inApp) return
    profilesChanged(changed)
  })
}

function profilesChanged (changed) {
  renderMembers()
  renderUserPanel()
  renderVoiceAll()
  if (state.messages.some((m) => changed.has(String(m.authorId)))) refreshAllMessages()
  socialRender()
  if (profileState.cardUserId !== null && changed.has(String(profileState.cardUserId))) refreshProfileCard()
  if (isDmChannel(state.channelId)) {
    const partner = dmPartner(state.channelId)
    if (partner !== null && changed.has(String(partner))) {
      decryptCache.clear()
      refreshAllMessages()
    }
  }
}

// Görsel yardımcılar (tema tarafındaki çizim fonksiyonları da kullanır)

// Kullanıcı adı: meta veya sunucudan engellenenler listesi. İkisinde de yoksa hesap silinmiştir.
function userBaseName (userId) {
  const user = metaUser(userId)
  if (user && user.name) return String(user.name)
  const former = profileState.formerUsers.get(String(userId))
  if (former) return former
  return ''
}

// Görünen ad yalnızca listedeki (silinmemiş ve engellenmemiş) kullanıcılar için kullanılır
function activeProfile (userId) {
  if (!metaUser(userId)) return null
  const rec = profileRecord(userId)
  return rec && !rec.missing && rec.profile ? rec.profile : null
}

function userDisplayName (userId) {
  const profile = activeProfile(userId)
  if (profile && profile.displayName) return profile.displayName
  return userBaseName(userId) || t('profile.deletedUser')
}

function userHandle (userId) {
  const name = userBaseName(userId)
  return name ? '@' + name : ''
}

function userColorIndex (userId) {
  const profile = activeProfile(userId)
  if (profile && profile.color !== null) return profile.color
  const n = Number(avatarClass(userId).slice('avatar-c'.length))
  return isFinite(n) ? n : 0
}

function userAvatarInfo (userId) {
  return { initial: initial(userDisplayName(userId)), colorIndex: userColorIndex(userId), blobUrl: avatarUrlOf(userId) }
}

function myChosenStatus () {
  const status = state.me && typeof state.me.status === 'string' ? state.me.status : 'online'
  return STATUS_CHOICES.indexOf(status) !== -1 ? status : 'online'
}

function userStatus (userId) {
  if (state.me && sameId(userId, state.me.id)) {
    const mine = myChosenStatus()
    return mine === 'invisible' ? 'offline' : mine
  }
  const user = metaUser(userId)
  if (!user) return 'offline'
  if (typeof user.status === 'string' && SHOWN_STATUSES.indexOf(user.status) !== -1) return user.status
  return user.online === true ? 'online' : 'offline'
}

function statusLabel (status) {
  if (status === 'idle') return t('status.idle')
  if (status === 'dnd') return t('status.dnd')
  if (status === 'invisible') return t('status.invisible')
  if (status === 'offline') return t('status.offline')
  return t('status.online')
}

function userStatusText (userId) {
  const profile = activeProfile(userId)
  return profile ? profile.statusText : ''
}

// Avatar öğesi: tema yardımcısı avatar(userId, size) varsa o, yoksa baş harf ve renkli yedek
function personAvatar (userId, size) {
  if (typeof avatar === 'function' && avatar.length <= 2) {
    try {
      const node = avatar(userId, size)
      if (node) return node
    } catch (err) {
      window.console.error(err)
    }
  }
  const info = userAvatarInfo(userId)
  const span = h('span', 'avatar avatar-c' + info.colorIndex + (size === 'lg' || size === 'xl' ? ' avatar-large' : size === 'sm' ? ' avatar-small' : ''))
  span.setAttribute('aria-hidden', 'true')
  span.setAttribute('data-status', userStatus(userId))
  if (info.blobUrl) {
    const img = h('img', 'avatar-img')
    img.alt = ''
    img.src = info.blobUrl
    span.appendChild(img)
  } else {
    span.textContent = info.initial
  }
  return span
}

function statusDot (status) {
  const dot = h('span', 'status-dot')
  dot.setAttribute('data-status', status)
  dot.setAttribute('aria-hidden', 'true')
  return dot
}

// Ad veya avatar gibi satır içi öğeye profil kartı açma davranışı ekler (düğme rolüyle)
function makeUserLink (node, userId) {
  node.classList.add('user-link')
  node.setAttribute('role', 'button')
  node.tabIndex = 0
  node.setAttribute('aria-haspopup', 'dialog')
  node.setAttribute('data-user-id', String(userId))
  node.addEventListener('click', (e) => {
    e.stopPropagation()
    openProfileCard(userId, node)
  })
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openProfileCard(userId, node)
    }
  })
  return node
}

// Ortak pencere (#dialog-root): güvenlik numarası ve kimlik açma pencereleri.
// opts: { name, titleKey, titleParams, trigger, build(body, close) -> ilk odak, onClose(reason) }

let dialogSeq = 0

function openAppDialog (opts) {
  const root = byId('dialog-root')
  if (!root) return null
  const existing = findLayer('app-dialog')
  if (existing) closeLayer(existing, false)
  dialogSeq += 1
  const titleId = 'app-dialog-title-' + dialogSeq
  const backdrop = h('div', 'modal app-dialog-backdrop')
  backdrop.setAttribute('data-dialog', opts.name || '')
  const dialog = h('div', 'modal-dialog app-dialog')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', titleId)
  dialog.id = (opts.name || 'app') + '-dialog'
  const head = h('div', 'app-dialog-head')
  const title = h('h2', 'section-heading app-dialog-title', t(opts.titleKey, opts.titleParams))
  title.id = titleId
  head.appendChild(title)
  const closeBtn = button('icon-button app-dialog-close', '', 'i-close', t('common.close'))
  head.appendChild(closeBtn)
  dialog.appendChild(head)
  const body = h('div', 'app-dialog-body')
  dialog.appendChild(body)
  backdrop.appendChild(dialog)
  let reason = 'dismiss'
  let layer = null
  const close = (why) => {
    reason = why || 'dismiss'
    if (layer) closeLayer(layer, true)
  }
  const first = opts.build(body, close)
  clear(root)
  root.appendChild(backdrop)
  root.hidden = false
  closeBtn.addEventListener('click', () => {
    close('dismiss')
  })
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close('dismiss')
  })
  layer = {
    name: 'app-dialog',
    el: dialog,
    trigger: opts.trigger || null,
    level: 3,
    trap: true,
    initialFocus: () => first || closeBtn,
    onClose: () => {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop)
      if (!root.firstChild) root.hidden = true
      if (typeof opts.onClose === 'function') opts.onClose(reason)
    }
  }
  openLayer(layer)
  return { close: close, body: body }
}

function closeAppDialog () {
  const layer = findLayer('app-dialog')
  if (layer) closeLayer(layer, false)
}

// Profil kartı (#profile-card)

function openProfileCard (userId, anchorEl) {
  const card = byId('profile-card')
  if (!card || userId === null || userId === undefined) return
  const existing = findLayer('profile-card')
  if (existing) {
    const same = sameId(profileState.cardUserId, userId)
    closeLayer(existing, false)
    if (same) return
  }
  closeStatusMenu()
  profileState.cardUserId = userId
  profileState.cardTrigger = anchorEl || null
  profilesEnsure([userId])
  buildProfileCard(card, userId)
  card.hidden = false
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-labelledby', 'profile-card-name')
  if (anchorEl) positionPopup(card, anchorEl)
  openLayer({
    name: 'profile-card',
    el: card,
    trigger: anchorEl || null,
    level: 2,
    outside: true,
    trap: true,
    onClose: () => {
      card.hidden = true
      clear(card)
      profileState.cardUserId = null
      profileState.cardTrigger = null
    }
  })
}

function closeProfileCard () {
  const layer = findLayer('profile-card')
  if (layer) closeLayer(layer, false)
}

function refreshProfileCard () {
  const card = byId('profile-card')
  if (!card || profileState.cardUserId === null || card.hidden) return
  const focusKey = activeFocusKey(card)
  buildProfileCard(card, profileState.cardUserId)
  restoreFocusKey(card, focusKey)
}

function buildProfileCard (card, userId) {
  clear(card)
  const profile = activeProfile(userId)
  const self = Boolean(state.me && sameId(userId, state.me.id))
  const status = userStatus(userId)
  card.classList.toggle('is-own', self)
  card.setAttribute('data-user-id', String(userId))
  const band = h('div', 'profile-card-band')
  band.setAttribute('data-color', String(userColorIndex(userId)))
  card.appendChild(band)
  const head = h('div', 'profile-card-head')
  const av = h('span', 'avatar-wrap profile-card-avatar')
  av.setAttribute('data-status', status)
  av.appendChild(personAvatar(userId, 'xl'))
  head.appendChild(av)
  card.appendChild(head)
  const body = h('div', 'profile-card-body')
  const name = h('h2', 'profile-card-name', userDisplayName(userId))
  name.id = 'profile-card-name'
  body.appendChild(name)
  const handle = userHandle(userId)
  if (handle) body.appendChild(h('p', 'profile-card-handle', handle))
  const user = metaUser(userId)
  const badge = user ? roleBadge(user.role) : null
  if (badge) body.appendChild(badge)
  const statusRow = h('p', 'profile-card-status')
  statusRow.setAttribute('data-status', status)
  statusRow.appendChild(statusDot(status))
  statusRow.appendChild(h('span', 'profile-card-status-label', statusLabel(self ? myChosenStatus() : status)))
  if (profile && profile.statusText) {
    statusRow.appendChild(h('span', 'profile-card-status-text', profile.statusText))
  }
  body.appendChild(statusRow)
  if (profile && profile.bio) {
    const section = h('div', 'profile-card-section')
    section.appendChild(h('h3', 'profile-card-label', t('profile.about')))
    section.appendChild(h('p', 'profile-card-bio', profile.bio))
    body.appendChild(section)
  }
  if (!self && isBlocked(userId)) body.appendChild(h('p', 'profile-card-note hint', t('social.blockedNote')))
  if (!self) {
    const voiceSection = buildCardVoice(userId)
    if (voiceSection) body.appendChild(voiceSection)
  }
  body.appendChild(buildCardActions(userId, self))
  card.appendChild(body)
}

// Kişi aynı ses kanalındaysa ses seviyesi ve yerel susturma
function buildCardVoice (userId) {
  if (!voice) return null
  const s = snap()
  const peer = s.peers ? s.peers[String(userId)] : null
  if (!s.channelId || !peer) return null
  const section = h('div', 'profile-card-section profile-card-voice')
  const value = peerVolumeValue(userId)
  const label = h('label', 'label')
  label.setAttribute('for', 'profile-card-volume')
  label.appendChild(h('span', '', t('peer.volume')))
  label.appendChild(document.createTextNode(' '))
  const valueText = h('span', 'profile-card-volume-value', formatPercent(value))
  label.appendChild(valueText)
  section.appendChild(label)
  const range = h('input', 'range')
  range.id = 'profile-card-volume'
  range.type = 'range'
  range.min = '0'
  range.max = '100'
  range.step = '1'
  range.value = String(value)
  range.setAttribute('data-focus-key', 'card-volume')
  const onRange = () => {
    const v = Math.max(0, Math.min(100, Math.round(Number(range.value) || 0)))
    valueText.textContent = formatPercent(v)
    const stored = storeGetJson(KEYS.peerVolume, {})
    stored[String(userId)] = v
    storeSetJson(KEYS.peerVolume, stored)
    try {
      voice.setPeerVolume(voiceUserArg(userId), v / 100)
    } catch (err) {
      // Eş bağlı değil, değer saklandı
    }
  }
  range.addEventListener('input', onRange)
  range.addEventListener('change', onRange)
  section.appendChild(range)
  const muted = Boolean(peer.localMute)
  const mute = button('button button-secondary button-small profile-card-mute', t(muted ? 'peer.unmute' : 'peer.mute'))
  mute.setAttribute('aria-pressed', muted ? 'true' : 'false')
  mute.setAttribute('data-focus-key', 'card-mute')
  mute.addEventListener('click', () => {
    voice.setPeerLocalMute(voiceUserArg(userId), !muted)
    nextFrame(refreshProfileCard)
  })
  section.appendChild(mute)
  return section
}

function cardButton (className, key, focusKey, handler) {
  const b = button('button button-small ' + className, t(key))
  b.setAttribute('data-focus-key', focusKey)
  b.addEventListener('click', handler)
  return b
}

function buildCardActions (userId, self) {
  const actions = h('div', 'profile-card-actions')
  if (self) {
    actions.appendChild(cardButton('button-secondary card-status', 'status.change', 'card-status', () => {
      const trigger = profileState.cardTrigger
      closeProfileCard()
      openStatusMenu(trigger || el.meAvatar)
    }))
    actions.appendChild(cardButton('button-secondary card-edit', 'profile.edit', 'card-edit', () => {
      closeProfileCard()
      openProfileEditor()
    }))
    return actions
  }
  const deleted = !metaUser(userId) && !profileState.formerUsers.has(String(userId))
  if (deleted) return actions
  const blocked = isBlocked(userId)
  if (!blocked) {
    if (isFriend(userId)) {
      actions.appendChild(cardButton('button-secondary card-unfriend', 'social.removeFriend', 'card-unfriend', () => {
        removeFriend(userId)
      }))
    } else if (hasIncoming(userId)) {
      actions.appendChild(cardButton('card-accept', 'social.accept', 'card-accept', () => {
        acceptFriend(userId)
      }))
    } else if (hasOutgoing(userId)) {
      const sent = cardButton('button-secondary card-sent', 'social.requestSent', 'card-sent', () => {})
      sent.disabled = true
      actions.appendChild(sent)
    } else {
      actions.appendChild(cardButton('card-add', 'social.addFriend', 'card-add', () => {
        sendFriendRequest({ userId: userId })
      }))
    }
    actions.appendChild(cardButton('card-message', 'social.message', 'card-message', () => {
      closeProfileCard()
      openDmWith(userId)
    }))
  }
  actions.appendChild(cardButton(blocked ? 'button-secondary card-unblock' : 'button-danger card-block', blocked ? 'social.unblock' : 'social.block', 'card-block', () => {
    if (blocked) unblockUser(userId)
    else blockUser(userId)
  }))
  return actions
}

// Profil düzenleme sayfası ayarlar görünümündedir. O görünüm yoksa hesap sekmesi açılır.
function openProfileEditor () {
  if (typeof openSettings === 'function') openSettings('profile', el.meButton)
}

// Avatar menüsü (#status-menu, KONSEPT 6.8): üst çubuktaki avatar çipinden açılır. Baş kısım (avatar, ad,
// @kullanıcı adı ve rol), durum seçenekleri, özel durum, profil düzenleme, ayarlar, görünüm, dil ve çıkış.
// Ayarlara giriş tektir ve her ekranda aynı yerdedir.

function openStatusMenu (anchorEl) {
  const menu = byId('status-menu')
  if (!menu || !state.me) return
  const existing = findLayer('status-menu')
  if (existing) {
    closeLayer(existing, false)
    return
  }
  closeProfileCard()
  buildStatusMenu(menu)
  menu.classList.add('avatar-menu')
  menu.hidden = false
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', t('layout.statusMenu', { name: userDisplayName(state.me.id) }))
  if (anchorEl) {
    positionPopup(menu, anchorEl)
    anchorEl.setAttribute('aria-expanded', 'true')
  }
  openLayer({
    name: 'status-menu',
    el: menu,
    trigger: anchorEl || null,
    level: 2,
    outside: true,
    closeOnFocusOut: true,
    initialFocus: () => menu.querySelector('[aria-checked="true"]') || menu.querySelector('button'),
    onClose: () => {
      menu.hidden = true
      clear(menu)
      if (anchorEl) anchorEl.setAttribute('aria-expanded', 'false')
    }
  })
}

function closeStatusMenu () {
  const layer = findLayer('status-menu')
  if (layer) closeLayer(layer, false)
}

function buildStatusMenu (menu) {
  clear(menu)
  const head = h('div', 'menu-head')
  head.appendChild(personAvatar(state.me.id, 'lg'))
  const headText = h('span', 'menu-head-text')
  headText.appendChild(h('span', 'menu-head-name', userDisplayName(state.me.id)))
  const handle = userHandle(state.me.id)
  headText.appendChild(h('span', 'menu-head-sub', handle ? t('top.menuHandle', { handle: handle, role: roleLabel(state.me.role) }) : roleLabel(state.me.role)))
  head.appendChild(headText)
  menu.appendChild(head)
  // Durum seçenekleri tek seçimli bir grup: seçili olanda onay işareti
  const current = myChosenStatus()
  const group = h('div', 'avatar-menu-statuses')
  group.setAttribute('role', 'group')
  group.setAttribute('aria-label', t('status.menuLabel'))
  STATUS_CHOICES.forEach((status) => {
    const item = h('button', 'menu-item status-option')
    item.type = 'button'
    item.setAttribute('role', 'menuitemradio')
    item.setAttribute('aria-checked', status === current ? 'true' : 'false')
    item.setAttribute('data-status', status)
    item.appendChild(statusDot(status === 'invisible' ? 'offline' : status))
    const text = h('span', 'status-option-text')
    text.appendChild(h('span', 'status-option-label', statusLabel(status)))
    if (status === 'dnd' || status === 'invisible') {
      text.appendChild(h('span', 'status-option-hint', t(status === 'dnd' ? 'status.dndHint' : 'status.invisibleHint')))
    }
    item.appendChild(text)
    if (status === current) item.appendChild(icon('i-check', 'avatar-menu-check'))
    item.addEventListener('click', () => {
      closeStatusMenu()
      setMyStatus(status)
    })
    group.appendChild(item)
  })
  menu.appendChild(group)
  const custom = h('button', 'menu-item status-custom')
  custom.type = 'button'
  custom.setAttribute('role', 'menuitem')
  custom.appendChild(icon('i-edit'))
  custom.appendChild(h('span', 'menu-entry-label', t('status.custom')))
  custom.addEventListener('click', () => {
    const layer = findLayer('status-menu')
    const trigger = layer ? layer.trigger : null
    closeStatusMenu()
    openCustomStatusDialog(trigger)
  })
  menu.appendChild(custom)
  menu.appendChild(menuSeparator())
  const edit = h('button', 'menu-item status-edit-profile')
  edit.type = 'button'
  edit.setAttribute('role', 'menuitem')
  edit.appendChild(icon('i-user'))
  edit.appendChild(h('span', 'menu-entry-label', t('profile.edit')))
  edit.addEventListener('click', () => {
    closeStatusMenu()
    openProfileEditor()
  })
  menu.appendChild(edit)
  const theme = window.TelsizTheme && typeof window.TelsizTheme.get === 'function' ? window.TelsizTheme.get() : null
  const skin = theme && theme.skin ? theme.skin : 'arcade'
  const scheme = theme && theme.resolvedScheme === 'light' ? 'light' : 'dark'
  menu.appendChild(menuEntry('menu-settings', 'i-gear', t('settings.title'), t('top.menuSettingsSub'), () => {
    openSettings(null, el.meButton)
  }))
  menu.appendChild(menuEntry('menu-appearance', 'i-palette', t('top.menuAppearance'), t('top.menuAppearanceSub', { skin: t('theme.skin.' + skin), scheme: t('theme.scheme.' + scheme) }), () => {
    openSettings('appearance', el.meButton)
  }))
  menu.appendChild(menuEntry('menu-language', 'i-globe', t('settings.appearance.language'), t('top.langName'), () => {
    openSettings('appearance', el.meButton)
  }))
  menu.appendChild(menuSeparator())
  const out = menuEntry('menu-logout', 'i-logout', t('auth.logout'), '', () => {
    logout()
  })
  out.classList.add('menu-danger')
  menu.appendChild(out)
  menu.addEventListener('keydown', onPopupMenuKey)
}

function menuSeparator () {
  const sep = h('div', 'menu-separator')
  sep.setAttribute('role', 'separator')
  return sep
}

// Avatar menüsünün gezinme öğesi: simge, ad ve isteğe bağlı sağda kısa bilgi
function menuEntry (id, iconName, label, end, handler) {
  const item = h('button', 'menu-item menu-entry')
  item.type = 'button'
  item.id = id
  item.setAttribute('role', 'menuitem')
  item.appendChild(icon(iconName))
  item.appendChild(h('span', 'menu-entry-label', label))
  if (end) item.appendChild(h('span', 'menu-entry-end', end))
  item.addEventListener('click', () => {
    closeStatusMenu()
    handler()
  })
  return item
}

// Açılır menülerde ok tuşlarıyla gezinme
function onPopupMenuKey (e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
  e.preventDefault()
  const items = focusables(e.currentTarget)
  if (!items.length) return
  let i = items.indexOf(document.activeElement)
  if (e.key === 'ArrowDown') i = (i + 1) % items.length
  else if (e.key === 'ArrowUp') i = (i - 1 + items.length) % items.length
  else if (e.key === 'Home') i = 0
  else i = items.length - 1
  focusNode(items[i])
}

async function setMyStatus (status) {
  if (!state.me || STATUS_CHOICES.indexOf(status) === -1) return
  const before = myChosenStatus()
  if (before === status) return
  state.me.status = status
  renderUserPanel()
  renderMembers()
  const res = await api('POST', '/api/me/status', { status: status })
  if (res.status === 200) {
    if (socialState.priv) socialState.priv.status = status
    return
  }
  if (state.me) state.me.status = before
  renderUserPanel()
  renderMembers()
  toast(() => errorText(res, t('status.failed')), 'error')
}

// Kayıttan sonraki isteğe bağlı profil adımı: görünen ad. Profil grup anahtarıyla şifrelendiği için
// yalnızca anahtar bu cihazdayken sorulur, sonradan Ayarlar > Profil'den değiştirilebilir.
function openProfileStep () {
  if (!state.me || !hasActiveKey()) return
  openAppDialog({
    name: 'profile-step',
    titleKey: 'profile.stepTitle',
    build: (body, close) => {
      body.appendChild(h('p', 'lead', t('profile.stepLead')))
      const form = h('form', 'form profile-step-form')
      form.id = 'profile-step-form'
      form.noValidate = true
      const label = h('label', 'label', t('profile.displayName'))
      label.setAttribute('for', 'profile-step-name')
      const input = h('input', 'input')
      input.id = 'profile-step-name'
      input.type = 'text'
      input.maxLength = PROFILE_NAME_MAX * 2
      input.autocomplete = 'nickname'
      input.setAttribute('placeholder', t('profile.displayNamePlaceholder'))
      form.appendChild(label)
      form.appendChild(input)
      form.appendChild(h('p', 'hint', t('profile.stepHint', { name: userHandle(state.me.id) })))
      const msg = h('p', 'form-error')
      msg.id = 'profile-step-error'
      msg.setAttribute('role', 'alert')
      msg.hidden = true
      form.appendChild(msg)
      const row = h('div', 'row dialog-actions')
      const save = button('button', t('common.save'))
      save.type = 'submit'
      save.id = 'profile-step-save'
      const skip = button('button button-secondary', t('profile.stepSkip'))
      skip.id = 'profile-step-skip'
      skip.addEventListener('click', () => {
        close('skip')
      })
      row.appendChild(save)
      row.appendChild(skip)
      form.appendChild(row)
      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        if (form.classList.contains('is-busy')) return
        const name = cleanLine(input.value, 1000)
        if (!name) {
          close('skip')
          return
        }
        setFormBusy(form, true)
        const result = await saveProfile({ displayName: name, statusText: '', bio: '', color: null })
        setFormBusy(form, false)
        if (!result.ok) {
          setMsg(msg, result.error, 'error')
          focusNode(input)
          return
        }
        close('done')
        toast(() => t('profile.stepSaved'), 'ok')
      })
      body.appendChild(form)
      return input
    }
  })
}

// Özel durum metni (ör. "Valorant oynuyor"): profilin diğer alanları korunarak kaydedilir
function openCustomStatusDialog (trigger) {
  if (!state.me) return
  const rec = profileRecord(state.me.id)
  const current = rec && rec.profile ? rec.profile : null
  openAppDialog({
    name: 'custom-status',
    titleKey: 'status.customTitle',
    trigger: trigger,
    build: (body, close) => {
      const form = h('form', 'form custom-status-form')
      form.id = 'custom-status-form'
      form.noValidate = true
      const label = h('label', 'label', t('status.customLabel'))
      label.setAttribute('for', 'custom-status-input')
      const input = h('input', 'input')
      input.id = 'custom-status-input'
      input.type = 'text'
      input.maxLength = PROFILE_STATUS_MAX
      input.setAttribute('placeholder', t('status.customPlaceholder'))
      input.value = current ? current.statusText : ''
      form.appendChild(label)
      form.appendChild(input)
      form.appendChild(h('p', 'hint', t('status.customHint', { max: PROFILE_STATUS_MAX })))
      const msg = h('p', 'form-error')
      msg.id = 'custom-status-error'
      msg.setAttribute('role', 'alert')
      msg.hidden = true
      form.appendChild(msg)
      const row = h('div', 'row dialog-actions')
      const save = button('button', t('common.save'))
      save.type = 'submit'
      save.id = 'custom-status-save'
      const clearBtn = button('button button-secondary', t('status.customClear'))
      clearBtn.id = 'custom-status-clear'
      row.appendChild(save)
      row.appendChild(clearBtn)
      form.appendChild(row)
      const store = async (text) => {
        if (form.classList.contains('is-busy')) return
        setFormBusy(form, true)
        const latest = profileRecord(state.me.id)
        const base = latest && latest.profile ? latest.profile : current
        const result = await saveProfile({
          displayName: base ? base.displayName : '',
          statusText: text,
          bio: base ? base.bio : '',
          color: base ? base.color : null
        })
        setFormBusy(form, false)
        if (!result.ok) {
          setMsg(msg, result.error, 'error')
          return
        }
        close('done')
        toast(() => t('status.customSaved'), 'ok')
      }
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        store(input.value)
      })
      clearBtn.addEventListener('click', () => {
        input.value = ''
        store('')
      })
      body.appendChild(form)
      return input
    }
  })
}

// Kendi profilini kaydetme. avatarFile: undefined (değişmez), null (kaldırılır) veya resim dosyası.
// Görünen ad, durum metni ve hakkımda grup anahtarıyla şifrelenir, profil resmi kare kırpılıp
// 256x256 boyutunda yeniden kodlanır (üst veri silinir) ve kendi dosya anahtarıyla şifrelenir.
async function saveProfile (input) {
  const data = input || {}
  if (!state.me) return { ok: false, error: () => t('profile.saveFailed') }
  const kid = activeKid()
  if (!kid || !hasActiveKey()) return { ok: false, error: () => t('profile.needKey') }
  const displayName = cleanLine(data.displayName, 1000)
  const statusText = cleanLine(data.statusText, 1000)
  const bio = cleanBio(String(data.bio || '').slice(0, 4000))
  if (cpLength(displayName) > PROFILE_NAME_MAX) return { ok: false, error: () => t('profile.nameTooLong', { max: PROFILE_NAME_MAX }) }
  if (cpLength(statusText) > PROFILE_STATUS_MAX) return { ok: false, error: () => t('profile.statusTooLong', { max: PROFILE_STATUS_MAX }) }
  if (cpLength(String(data.bio || '').trim()) > PROFILE_BIO_MAX) return { ok: false, error: () => t('profile.bioTooLong', { max: PROFILE_BIO_MAX }) }
  const color = cleanColor(typeof data.color === 'number' ? data.color : null)
  const rec = profileRecord(state.me.id)
  let avatarRef = rec && rec.profile && rec.profile.avatar ? rec.profile.avatar : null
  let avatarUploadId = avatarRef ? avatarRef.u : null
  if (data.avatarFile === null) {
    avatarRef = null
    avatarUploadId = null
  } else if (data.avatarFile) {
    const made = await uploadAvatar(data.avatarFile)
    if (!made.ok) return made
    avatarRef = made.ref
    avatarUploadId = made.ref.u
  }
  const plain = { v: 1, u: Number(state.me.id), displayName: displayName, statusText: statusText, bio: bio, color: color, avatar: avatarRef ? { u: avatarRef.u, k: avatarRef.k, n: avatarRef.n, m: avatarRef.m, w: AVATAR_EDGE, h: AVATAR_EDGE } : null }
  let envelope = ''
  try {
    envelope = window.E2EE.sealJson(kid, plain)
  } catch (err) {
    return { ok: false, error: () => t('profile.saveFailed') }
  }
  const maxChars = state.info && state.info.limits && typeof state.info.limits.maxProfileChars === 'number' ? state.info.limits.maxProfileChars : 6000
  if (envelope.length > maxChars) return { ok: false, error: () => t('profile.tooLarge') }
  const res = await api('POST', '/api/me/profile', { profile: envelope, avatarUploadId: avatarUploadId })
  if (res.status !== 200) {
    return { ok: false, error: () => errorText(res, t('profile.saveFailed'), { rate_limited: t('profile.rateLimited') }) }
  }
  profilesRefetch([state.me.id])
  return { ok: true }
}

// Profil resmi: kare kırpma, 256x256, PNG kaynak PNG, diğerleri JPEG olarak yeniden kodlanır
async function uploadAvatar (file) {
  let encoded = null
  try {
    const bytes = await readBlobBytes(file)
    const sniffed = window.E2EE.sniffImage(bytes)
    const decoded = await decodeImage(bytes, sniffed || String(file.type || 'application/octet-stream'))
    if (!decoded) return { ok: false, error: () => t('profile.avatarInvalid') }
    try {
      encoded = await squareAvatar(decoded.image, sniffed === 'image/png' ? 'image/png' : 'image/jpeg')
    } finally {
      decoded.release()
    }
  } catch (err) {
    return { ok: false, error: errorProducer(err, () => t('profile.avatarInvalid')) }
  }
  if (!encoded) return { ok: false, error: () => t('profile.avatarInvalid') }
  const enc = window.E2EE.encryptFile(encoded.bytes)
  const res = await request('POST', '/api/uploads', { binary: enc.box, timeout: TRANSFER_TIMEOUT_MS })
  checkAuthFailure(res)
  if (res.status !== 200 || !res.data || typeof res.data.id !== 'string' || !UPLOAD_ID_RE.test(res.data.id)) {
    return { ok: false, error: () => errorText(res, t('profile.avatarUploadFailed'), { rate_limited: t('attach.rateLimited') }) }
  }
  return { ok: true, ref: { u: res.data.id, k: enc.key, n: enc.nonce, m: encoded.mime } }
}

async function squareAvatar (image, type) {
  const w0 = image.naturalWidth
  const h0 = image.naturalHeight
  const side = Math.min(w0, h0)
  if (!side) return null
  const sx = Math.floor((w0 - side) / 2)
  const sy = Math.floor((h0 - side) / 2)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_EDGE
  canvas.height = AVATAR_EDGE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, AVATAR_EDGE, AVATAR_EDGE)
  }
  ctx.imageSmoothingEnabled = true
  try {
    ctx.imageSmoothingQuality = 'high'
  } catch (err) {
    // Eski tarayıcı
  }
  ctx.drawImage(image, sx, sy, side, side, 0, 0, AVATAR_EDGE, AVATAR_EDGE)
  const bytes = await canvasToBytes(canvas, type, type === 'image/jpeg' ? AVATAR_JPEG_QUALITY : undefined)
  canvas.width = 1
  canvas.height = 1
  const actual = window.E2EE.sniffImage(bytes)
  if (!actual || AVATAR_TYPES.indexOf(actual) === -1) return null
  return { bytes: bytes, mime: actual }
}
