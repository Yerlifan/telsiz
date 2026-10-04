'use strict'

// Uygulama ekranı, meta uygulama, üst çubuktaki sunucu kimliği ve Çevrimiçi şeridi, frekans bandının
// çizimi (katılınan frekanslar, istasyonları 24-frekans.js üretir), İstasyonlar listesi ve sayfası (yazı ve
// ses odaları), oda bilgisi kartı, Çevrimiçi sayfasındaki üye listesi, konuşma başlığı, okunmamış ve anma
// sayaçları ve oda seçimi (Ek K, Frekans düzeni). Bandın etkileşimi (tıklama, ibre sürükleme, klavye,
// tekerlek, kol) 21-band.js içindedir.

// Uygulama ekranı

function openApp () {
  state.inApp = true
  // Arama dizini, yazıyor ve anma durumları oturuma özeldir, her açılışta sıfırlanır
  chatPlusReset()
  showView('app')
  renderServerName()
  // Frekans listesi (masaüstünde ana süreçten) ve arka plan durumu yüklenir, gelince bant yenilenir
  if (typeof frekansOnOpen === 'function') frekansOnOpen()
  renderBand()
  renderMembers()
  renderUserPanel()
  renderVoiceAll()
  const remembered = storeGet(userKey('channel'))
  const channels = textChannels()
  const pick = channels.filter((c) => sameId(c.id, remembered))[0] || channels[0]
  if (pick) {
    selectChannel(pick.id, { force: true, focus: isWide() })
  } else {
    renderChannelHeader()
    renderComposerState()
  }
  startPoll()
  showFragmentNotice()
  scanUnread()
}

function chatPlusReset () {
  state.mentions = Object.create(null)
  state.hasNewer = false
  state.newWhileOlder = false
  state.pendingJump = null
  if (typeof searchReset === 'function') searchReset()
  if (typeof typingReset === 'function') typingReset()
  if (typeof mentionReset === 'function') mentionReset()
}

function channelsOf (type) {
  const list = state.meta && Array.isArray(state.meta.channels) ? state.meta.channels : []
  return list.filter((c) => c && c.type === type).sort((a, b) => (a.position || 0) - (b.position || 0))
}

function textChannels () {
  return channelsOf('text')
}

function voiceChannels () {
  return channelsOf('voice')
}

function findChannel (id) {
  const list = state.meta && Array.isArray(state.meta.channels) ? state.meta.channels : []
  return list.filter((c) => sameId(c.id, id))[0] || null
}

function userName (id) {
  const user = state.users.get(String(id))
  return user ? user.name : t('users.unknown')
}

function userRole (id) {
  const user = state.users.get(String(id))
  return user ? user.role : 'member'
}

// Orta alanın görünümü: 'channel', 'dm' veya 'home'. Kaynağı 14-social.js'teki conversationMode,
// o yoksa #app-view[data-view] özniteliği.
function currentViewMode () {
  let mode = null
  if (typeof conversationMode === 'function') {
    try {
      mode = conversationMode()
    } catch (err) {
      mode = null
    }
  } else if (el.appView) {
    mode = el.appView.getAttribute('data-view')
  }
  return mode === 'dm' || mode === 'home' ? mode : 'channel'
}

// Özel mesaj başlığı ve yazma alanı 15-dm.js tarafından çizilir
function refreshConversationChrome () {
  if (typeof dmRefreshChrome === 'function') {
    try {
      dmRefreshChrome()
    } catch (err) {
      window.console.error(err)
    }
  }
}

// Meta uygulama: odalar, üyeler, ses kadroları, roller (5.3)

// Anma rozetleri kullanıcı adlarına, @herkes kuralı yazarın rolüne bağlıdır: bunlar değişince mesajlar
// yeniden çizilir
function mentionUsersKey (meta) {
  const users = meta && Array.isArray(meta.users) ? meta.users : []
  return users.map((u) => (u ? u.id + ':' + u.name + ':' + u.role : '')).join('|')
}

function applyMeta (meta, isInitial) {
  if (!meta || typeof meta !== 'object') return
  const prevKid = state.meta ? state.meta.activeKid : undefined
  const prevRole = state.me ? state.me.role : null
  const prevPerms = state.me ? myPermsKey() : ''
  const prevUsersKey = mentionUsersKey(state.meta)
  state.meta = meta
  if (typeof meta.serverName === 'string' && meta.serverName) state.serverName = meta.serverName
  if (meta.serverIcon === null || (typeof meta.serverIcon === 'string' && /^[0-9a-f]{32}$/.test(meta.serverIcon))) state.serverIcon = meta.serverIcon
  const users = Array.isArray(meta.users) ? meta.users : []
  users.forEach((u) => {
    if (u && u.id !== undefined) {
      state.users.set(String(u.id), {
        id: u.id,
        name: String(u.name || ''),
        role: u.role,
        online: u.online === true,
        status: typeof u.status === 'string' ? u.status : (u.online === true ? 'online' : 'offline'),
        pv: Number(u.pv) || 0
      })
    }
  })
  if (state.me) {
    const mine = users.filter((u) => sameId(u.id, state.me.id))[0]
    if (mine) {
      state.me.role = mine.role
      state.me.name = String(mine.name || state.me.name)
    }
  }
  if (voice) {
    try {
      voice.handleMeta(meta, state.me)
    } catch (err) {
      window.console.error(err)
    }
  }
  // Ses odasına katılma ve ayrılma bildirimleri (28-bildirim.js)
  if (typeof activityOnMeta === 'function') activityOnMeta(meta)
  if (isInitial || !state.inApp) return
  renderServerName()
  renderBand()
  renderMembers()
  renderUserPanel()
  renderVoiceAll()
  const mode = currentViewMode()
  if (mode === 'channel') {
    const current = findChannel(state.channelId)
    if (!current || current.type !== 'text') {
      const first = textChannels()[0]
      if (first) {
        selectChannel(first.id, { force: true })
      } else {
        state.channelId = null
        renderChannelHeader()
      }
    } else {
      renderChannelHeader()
    }
  } else {
    refreshConversationChrome()
  }
  if (prevKid !== meta.activeKid || prevRole !== (state.me ? state.me.role : null) || prevPerms !== (state.me ? myPermsKey() : '')) {
    renderComposerState()
    refreshAllMessages()
  } else if (prevUsersKey !== mentionUsersKey(meta)) {
    refreshMentionMessages()
  }
  refreshSettings()
}

// Üst çubuktaki frekans kimliği (frekans değiştirici düğmesi, 24-frekans.js): amblem (frekans fotoğrafı,
// yoksa frekans adının baş harfi), ad ve aşağı ok, alt satırda "Frekans · üye sayısı" ve şifreleme notu

function renderServerEmblem () {
  const em = el.serverEmblem
  if (!em) return
  let letter = em.querySelector('.emblem-letter')
  if (!letter) {
    clear(em)
    letter = h('span', 'emblem-letter')
    em.appendChild(letter)
  }
  letter.textContent = initial(state.serverName)
  if (typeof frekansPhoto === 'function') frekansPhoto(em, frekansOwnIconUrl())
}

function renderServerName () {
  if (el.serverName) el.serverName.textContent = state.serverName
  if (el.authServerName) el.authServerName.textContent = state.serverName
  renderServerEmblem()
  if (typeof frekansRenderIdentity === 'function') frekansRenderIdentity()
  renderServerMeta()
  updateTitle()
  if (typeof frekansRenderButton === 'function') frekansRenderButton()
  if (typeof frekansNoteName === 'function') frekansNoteName(state.serverName)
}

function metaUsers () {
  return state.meta && Array.isArray(state.meta.users) ? state.meta.users.filter((u) => u && u.id !== undefined) : []
}

function onlineCount () {
  return metaUsers().filter((u) => shownStatus(u.id) !== 'offline').length
}

function renderServerMeta () {
  if (!el.serverMeta) return
  clear(el.serverMeta)
  el.serverMeta.appendChild(h('span', 'server-members', t('top.serverSub', { count: metaUsers().length })))
  el.serverMeta.appendChild(icon('i-lock'))
  el.serverMeta.appendChild(h('span', 'server-encrypted', t('top.encrypted')))
}

function updateTitle () {
  const name = state.serverName || t('app.name')
  document.title = document.hidden && state.hiddenUnread > 0 ? t('title.unread', { count: state.hiddenUnread, name: name }) : name
}

// Odanın frekansı: oda kimliğinden türetilir (87.5 ile 108.0 arası), yalnızca süstür ve ekran
// okuyuculardan gizlidir. İstasyonun alt satırında Gece temasında görünür.

function channelFreq (id) {
  const n = Math.abs(Math.floor(Number(id) || 0))
  return (87.5 + ((n * 37) % 206) / 10).toFixed(1)
}

function channelFreqNode (id) {
  const freq = h('span', 'channel-freq', channelFreq(id))
  freq.setAttribute('aria-hidden', 'true')
  return freq
}

function mentionCount (channelId) {
  const map = state.mentions || null
  const value = map ? Number(map[channelId] || map[String(channelId)]) : 0
  return isFinite(value) && value > 0 ? Math.floor(value) : 0
}

// Odaların modeli: üç grup, Kişisel (Özel ve Arkadaşlar, üst çubuğun ortasındaki düğmeler, renderTopPersonal),
// Yazı odaları ve Ses odaları (sağdaki İstasyonlar listesi ve İstasyonlar sayfası). Yazı odasına basmak onu
// ayarlar, ses odasına basmak o odaya katılır. Anahtarlar: 'dm', 'friends', 'text-<oda>', 'voice-<oda>'.
// Üstteki bant odaları değil frekansları dizer (renderBand, 24-frekans.js).

// Özel istasyonuna basınca açılacak son özel konuşma
let bandLastDm = null

function bandDmEntries () {
  if (typeof dmEntries !== 'function') return []
  try {
    return dmEntries().slice().sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
  } catch (err) {
    return []
  }
}

function bandIncomingCount () {
  if (typeof priv !== 'function' || !state.me) return 0
  try {
    return priv().incoming.length
  } catch (err) {
    return 0
  }
}

// Okunmamış özel mesaj sayısı (açık olan özel konuşma hariç)
function bandDmUnread () {
  const mode = currentViewMode()
  let total = 0
  bandDmEntries().forEach((d) => {
    if (mode === 'dm' && sameId(d.id, state.channelId)) return
    total += Number(state.unread[d.id]) || 0
  })
  return total
}

function tunedStationKey () {
  const mode = currentViewMode()
  if (mode === 'dm') return 'dm'
  if (mode === 'home') return 'friends'
  return state.channelId === null || state.channelId === undefined ? '' : 'text-' + state.channelId
}

function voiceSpeakingIn (channelId) {
  const s = snap()
  if (!s.channelId || !sameId(s.channelId, channelId)) return false
  if (s.selfSpeaking) return true
  const peers = s.peers || {}
  return Object.keys(peers).some((id) => peers[id] && peers[id].speaking)
}

function countText (n) {
  return n > 99 ? '99+' : String(n)
}

// Odaların veri modeli: gruplar ve istasyonlar. Çizimden bağımsızdır (İstasyonlar listesi ve sayfası, üst
// çubuktaki kişisel düğmeler ve İstasyonlar düğmesinin rozeti kullanır).
function bandModel () {
  const tuned = tunedStationKey()
  const s = snap()
  const dmUnread = bandDmUnread()
  const requests = bandIncomingCount()
  const personal = [
    {
      key: 'dm',
      kind: 'conv',
      type: 'dm',
      icon: 'i-chat',
      name: t('band.dm'),
      sub: t('band.dmSub'),
      unread: 0,
      mention: dmUnread,
      tuned: tuned === 'dm',
      label: dmUnread ? t('band.dmUnreadLabel', { count: dmUnread }) : t('band.dmLabel')
    },
    {
      key: 'friends',
      kind: 'conv',
      type: 'friends',
      icon: 'i-users',
      name: t('band.friends'),
      sub: requests ? t('band.requests', { count: requests }) : t('band.friendsSub'),
      unread: requests,
      mention: 0,
      tuned: tuned === 'friends',
      label: requests ? t('band.friendsRequestsLabel', { count: requests }) : t('band.friendsLabel')
    }
  ]
  const text = textChannels().map((c) => {
    const isTuned = tuned === 'text-' + c.id
    const unread = isTuned ? 0 : Number(state.unread[c.id]) || 0
    const mention = isTuned ? 0 : mentionCount(c.id)
    let label = t('band.textLabel', { name: c.name })
    if (mention) label = t('band.textMentionLabel', { name: c.name, count: mention })
    else if (unread) label = t('band.textUnreadLabel', { name: c.name, count: unread })
    return { key: 'text-' + c.id, kind: 'conv', type: 'text', id: c.id, icon: 'i-text', name: c.name, sub: t('band.textSub'), freq: channelFreq(c.id), unread: unread, mention: mention, tuned: isTuned, label: label }
  })
  const voices = voiceChannels().map((c) => {
    const roster = voiceRoster(c.id)
    const connected = sameId(s.channelId, c.id)
    const joining = Boolean(s.joining) && connected
    const count = roster.length
    let sub = t('band.voiceEmpty')
    let label = t('band.voiceJoinLabel', { name: c.name, count: count })
    if (joining) {
      sub = t('band.voiceJoining')
      label = t('band.voiceJoiningLabel', { name: c.name })
    } else if (connected) {
      sub = t('band.voiceConnected', { count: count })
      label = t('band.voiceConnectedLabel', { name: c.name, count: count })
    } else if (count) {
      sub = t('band.voicePeople', { count: count })
    }
    // Telsiz DJ bu odada çalıyorsa nota işareti (23-dj.js, KONSEPT 6.2)
    const djOn = typeof djPlayingIn === 'function' && djPlayingIn(c.id)
    if (djOn) label = label + ', ' + t('band.djPlaying')
    return {
      key: 'voice-' + c.id,
      kind: 'voice',
      type: 'voice',
      id: c.id,
      icon: 'i-speaker',
      name: c.name,
      sub: sub,
      freq: channelFreq(c.id),
      unread: 0,
      mention: 0,
      tuned: false,
      connected: connected && !joining,
      joining: joining,
      live: voiceSpeakingIn(c.id),
      dj: djOn,
      people: roster.map((entry) => entry.userId),
      // İstasyonlar listesinde odanın altında gösterilen kişiler ve durumları
      members: roster.map((entry) => ({ id: entry.userId, muted: entry.muted === true, deafened: entry.deafened === true, camera: entry.camera === true })),
      label: label
    }
  })
  return [
    { key: 'personal', label: t('band.groupPersonal'), stations: personal, empty: '' },
    { key: 'text', label: t('channels.text'), stations: text, empty: t('band.noRooms') },
    { key: 'voice', label: t('channels.voice'), stations: voices, empty: t('band.noRooms') }
  ]
}

function bandStations (model) {
  return (model || bandModel()).reduce((all, g) => all.concat(g.stations), [])
}

// İstasyonlar listesinde gösterilen gruplar: yalnızca yazı ve ses odaları
function bandGroups (model) {
  return (model || bandModel()).filter((g) => g.key !== 'personal')
}

function stationKeyOf (st) {
  return [st.key, st.name, st.sub, st.unread, st.mention, st.tuned ? 1 : 0, st.connected ? 1 : 0, st.joining ? 1 : 0, st.dj ? 1 : 0, (st.people || []).map((id) => {
    const info = avatarInfoFor(id)
    return id + '.' + info.colorIndex + '.' + info.initial + '.' + (info.blobUrl || '')
  }).join(','), (st.members || []).map((m) => [m.id, shownName(m.id), memberVoiceIcon(m), m.camera ? 1 : 0].join('.')).join(','), st.label].join(':')
}

// Ses odasındaki kişinin durum simgesi: sağırlaştırılmış, herkes için susturulmuş, mikrofonu kapalı veya yok
function memberVoiceIcon (m) {
  if (m.deafened) return 'deafened'
  const rec = typeof metaRecordOf === 'function' ? metaRecordOf(m.id) : null
  if (rec && rec.voiceMuted === true) return 'server-muted'
  return m.muted ? 'muted' : ''
}

const MEMBER_VOICE_ICONS = {
  deafened: ['i-headphones-off', 'voice.deafenedTitle'],
  'server-muted': ['i-mic-off', 'voice.serverMutedTitle'],
  muted: ['i-mic-off', 'voice.mutedTitle']
}

// Ses odası satırının altındaki kişi listesi: avatar, ad, susturma ve kamera simgesi. Konuşan kişi (yalnızca
// bağlı olunan odada bilinir) updateBandLive ile işaretlenir.
function buildRoomPeople (st) {
  const ul = h('ul', 'room-people')
  ul.setAttribute('aria-label', t('band.voiceMembersLabel', { name: st.name }))
  st.members.forEach((m) => {
    const voiceState = memberVoiceIcon(m)
    const li = h('li', 'room-person' + (voiceState ? ' is-' + voiceState : ''))
    li.setAttribute('data-user-id', String(m.id))
    li.appendChild(avatar(m.id, 'xs', 'room-person-avatar'))
    li.appendChild(h('span', 'room-person-name', shownName(m.id)))
    const marks = []
    if (voiceState) marks.push(MEMBER_VOICE_ICONS[voiceState])
    if (m.camera) marks.push(['i-camera', 'radio.stateCamera'])
    marks.forEach((mark) => {
      li.appendChild(icon(mark[0], 'room-person-state'))
      li.appendChild(h('span', 'sr-only', t(mark[1])))
    })
    ul.appendChild(li)
  })
  return ul
}

function buildStationMark (st) {
  if (st.mention > 0) {
    const mark = h('span', 'station-mark mark-mention', st.type === 'text' ? '@' + countText(st.mention) : countText(st.mention))
    mark.setAttribute('aria-hidden', 'true')
    return mark
  }
  if (st.unread > 0) {
    const mark = h('span', 'station-mark mark-unread', countText(st.unread))
    mark.setAttribute('aria-hidden', 'true')
    return mark
  }
  return null
}

function buildNeedle () {
  const needle = h('span', 'needle')
  needle.setAttribute('aria-hidden', 'true')
  needle.title = t('band.needleTitle')
  return needle
}

// Liste değişmediyse yeniden çizilmez: klavye odağı, gezici tabindex ve kaydırma konumu korunur
let bandRenderKey = ''

// Frekans bandı (KONSEPT 6.2, kullanıcı kararı 2026-10-04): bant katılınan frekansları dizer, her istasyon
// bir frekanstır (24-frekans.js frekansStations ve frekansBuildStation). İbre açık frekanstadır. Odalarla
// ilgili her şey (İstasyonlar listesi ve sayfası, kişisel düğmeler, oda kartı, İstasyonlar düğmesi) de
// buradan, oda olayları geldikçe yenilenir.
function renderBand () {
  if (!el.bandTrack) return
  // İbre sürüklenirken çizim bekletilir, sürükleme bitince 21-band.js yeniden çağırır
  if (typeof bandIsDragging === 'function' && bandIsDragging()) {
    if (typeof bandRenderLater === 'function') bandRenderLater()
    return
  }
  const all = bandModel()
  const rooms = bandGroups(all)
  if (currentViewMode() === 'dm' && state.channelId !== null && state.channelId !== undefined) bandLastDm = state.channelId
  const stations = typeof frekansStations === 'function' ? frekansStations() : []
  const tunedStation = stations.filter((st) => st.tuned)[0]
  const tuned = tunedStation ? tunedStation.key : ''
  const key = [window.I18N ? window.I18N.lang : '', tuned].concat(stations.map(frekansStationKey)).join('#')
  if (key !== bandRenderKey || !el.bandTrack.querySelector('.station[data-station]')) {
    bandRenderKey = key
    const focusKey = activeFocusKey(el.bandTrack)
    const scroll = el.bandTrack.scrollLeft
    clear(el.bandTrack)
    el.bandTrack.removeAttribute('aria-busy')
    const group = h('div', 'band-group band-group-frekans')
    group.setAttribute('role', 'group')
    group.setAttribute('aria-label', t('bant.group'))
    const label = h('span', 'band-group-label', t('bant.group'))
    label.setAttribute('aria-hidden', 'true')
    group.appendChild(label)
    stations.forEach((st) => {
      group.appendChild(frekansBuildStation(st))
    })
    el.bandTrack.appendChild(group)
    el.bandTrack.scrollLeft = scroll
    const nodes = Array.from(el.bandTrack.querySelectorAll('.station[data-station]'))
    const focusTarget = focusKey ? nodes.filter((n) => n.getAttribute('data-focus-key') === focusKey)[0] : null
    const rover = focusTarget || nodes.filter((n) => n.classList.contains('is-tuned'))[0] || nodes[0]
    if (rover) rover.tabIndex = 0
    if (focusTarget) focusNode(focusTarget)
  }
  if (typeof bandAfterRender === 'function') bandAfterRender(tuned)
  if (typeof frekansRenderSheet === 'function') frekansRenderSheet(stations)
  renderStationsSheet(rooms)
  renderInbox(rooms)
  renderRoomsButton(rooms)
  renderTopPersonal(all)
  renderRoomCard()
}

// Üst çubuğun ortasındaki kişisel düğmeler (#top-dm, #top-friends): okunmamış özel mesaj ve bekleyen
// arkadaşlık isteği rozetleri, açık görünümde aria-current
function renderTopPersonal (model) {
  const personal = (model || bandModel()).filter((g) => g.key === 'personal')[0]
  if (!personal) return
  personal.stations.forEach((st) => {
    const b = byId(st.key === 'dm' ? 'top-dm' : 'top-friends')
    const mark = byId(st.key === 'dm' ? 'top-dm-mark' : 'top-friends-mark')
    if (!b) return
    b.setAttribute('aria-label', st.label)
    b.title = st.label
    if (st.tuned) b.setAttribute('aria-current', 'page')
    else b.removeAttribute('aria-current')
    b.classList.toggle('is-current', st.tuned)
    const count = st.key === 'dm' ? st.mention : st.unread
    if (mark) {
      mark.hidden = !count
      mark.textContent = count ? countText(count) : ''
    }
  })
}

// Eski ad: diğer modüller oda listesi yerine bandı bu adla da yeniler
function renderChannels () {
  renderBand()
}

// Konuşan ses odasının nabzı (10-voice.js updateVoiceLive çağırır): İstasyonlar listesindeki ve sayfasındaki
// ses odası satırları
function updateBandLive () {
  const lists = [el.inboxList, el.stationsList]
  const s = typeof snap === 'function' ? snap() : null
  const speaking = typeof speakingIn === 'function' && s ? (id) => Boolean(speakingIn(s, id)) : () => false
  lists.forEach((list) => {
    if (!list) return
    Array.from(list.querySelectorAll('.room-row-voice')).forEach((b) => {
      b.classList.toggle('is-live', voiceSpeakingIn(b.getAttribute('data-channel-id')))
    })
    Array.from(list.querySelectorAll('.room-person')).forEach((p) => {
      p.classList.toggle('is-speaking', speaking(p.getAttribute('data-user-id')))
    })
  })
}

// İstasyonlar kartı (#inbox, sağ sütun) ve İstasyonlar sayfası (#stations-sheet, sağ sütun görünmediğinde
// İstasyonlar düğmesiyle açılır): yazı ve ses odalarının listesi. Her satırda oda adı, okunmamış ve anma
// rozeti, ses odasında kişi sayısı, konuşan göstergesi, Telsiz DJ notası ve bağlı olma durumu. Ayarlı oda
// işaretlidir (aria-current). Satıra basmak yazı odasını ayarlar, ses odasına katılır (21-band.js
// onStationRowClick). Yukarı ve aşağı ok, Home ve End satırlar arasında gezer (onRoomListKey). Oda ekle
// düğmesi (#inbox-add, #rooms-sheet-add) yalnızca oda yönetme izni olanlara (sahip, yönetici, izinli rol) görünür.
let inboxRenderKey = ''
let stationsRenderKey = ''

function buildRoomRow (st, prefix) {
  const li = h('li', 'room-li')
  const b = h('button', 'room-row room-row-' + st.type)
  b.type = 'button'
  b.setAttribute('data-station', st.key)
  b.setAttribute('data-focus-key', prefix + st.key)
  if (st.id !== undefined) b.setAttribute('data-channel-id', String(st.id))
  b.setAttribute('aria-label', st.label)
  if (st.tuned) {
    b.classList.add('is-current')
    b.setAttribute('aria-current', 'page')
  }
  if (st.unread > 0 || st.mention > 0) b.classList.add('is-unread')
  if (st.connected) b.classList.add('is-connected')
  if (st.joining) b.classList.add('is-joining')
  if (st.live) b.classList.add('is-live')
  b.appendChild(icon(st.icon, 'room-row-icon'))
  // Gece temasında odanın süs frekansı (diğer temalarda gizli)
  if (st.freq) b.appendChild(channelFreqNode(st.id))
  const text = h('span', 'room-row-body')
  text.appendChild(h('span', 'room-row-name', st.name))
  if (st.type === 'voice') text.appendChild(h('span', 'room-row-sub', st.sub))
  else if (st.tuned) text.appendChild(h('span', 'room-row-sub', t('band.tunedSub')))
  b.appendChild(text)
  if (st.type === 'voice') {
    if (st.dj) b.appendChild(icon('i-music', 'room-row-dj'))
    const pulse = h('span', 'room-row-live')
    pulse.setAttribute('aria-hidden', 'true')
    b.appendChild(pulse)
    if (st.people && st.people.length) {
      const count = h('span', 'room-row-count', String(st.people.length))
      count.setAttribute('aria-hidden', 'true')
      count.insertBefore(icon('i-user'), count.firstChild)
      b.appendChild(count)
    }
  }
  const mark = buildStationMark(st)
  if (mark) b.appendChild(mark)
  li.appendChild(b)
  if (st.type === 'voice' && st.members && st.members.length) li.appendChild(buildRoomPeople(st))
  return li
}

function roomsKey (groups) {
  return [window.I18N ? window.I18N.lang : ''].concat(groups.map((g) => g.key + '=' + g.label + '=' + g.stations.map((st) => stationKeyOf(st) + ':' + (st.live ? 1 : 0)).join('|'))).join('#')
}

// Oda listesini baştan çizer. idPrefix başlık kimliklerini, focusPrefix odak anahtarlarını ayırır.
function fillRoomList (list, groups, idPrefix, focusPrefix) {
  const focusKey = activeFocusKey(list)
  clear(list)
  groups.forEach((g) => {
    const titleId = idPrefix + g.key
    const title = h('h3', 'rooms-group-title', g.label)
    title.id = titleId
    list.appendChild(title)
    const ul = h('ul', 'rooms-list')
    ul.setAttribute('aria-labelledby', titleId)
    g.stations.forEach((st) => {
      ul.appendChild(buildRoomRow(st, focusPrefix))
    })
    if (!g.stations.length && g.empty) ul.appendChild(h('li', 'rooms-empty hint', g.empty))
    list.appendChild(ul)
  })
  restoreFocusKey(list, focusKey)
}

function renderInbox (groups) {
  const list = el.inboxList
  if (!list) return
  const add = byId('inbox-add')
  if (add) add.hidden = !(typeof hasPerm === 'function' && hasPerm('channels'))
  const key = roomsKey(groups)
  if (key === inboxRenderKey && list.childNodes.length) return
  inboxRenderKey = key
  fillRoomList(list, groups, 'rooms-title-', 'rooms-')
}

// İstasyonlar sayfası: sayfa kapalıyken de çizilir, açılınca hazırdır
function renderStationsSheet (groups) {
  const list = el.stationsList
  if (!list) return
  const add = byId('rooms-sheet-add')
  if (add) add.hidden = !(typeof hasPerm === 'function' && hasPerm('channels'))
  const key = roomsKey(groups)
  if (key === stationsRenderKey && list.childNodes.length) return
  stationsRenderKey = key
  fillRoomList(list, groups, 'sheet-rooms-title-', 'sheet-')
}

// İstasyonlar düğmesi (#btn-rooms, üst çubuk): sağ sütun görünmediğinde (frekans.css kesme noktaları) odaları
// sayfa olarak açar. Rozeti ayarlı oda dışındaki okunmamış toplamıdır, anma varsa anma sayısını gösterir.
function renderRoomsButton (groups) {
  const b = byId('btn-rooms')
  if (!b) return
  let unread = 0
  let mention = 0
  groups.forEach((g) => {
    g.stations.forEach((st) => {
      unread += st.unread || 0
      mention += st.mention || 0
    })
  })
  let label = t('rooms.buttonLabel')
  if (mention) label = t('rooms.buttonMentionLabel', { count: mention })
  else if (unread) label = t('rooms.buttonUnreadLabel', { count: unread })
  b.setAttribute('aria-label', label)
  b.title = label
  const mark = byId('btn-rooms-mark')
  if (!mark) return
  mark.hidden = !(unread || mention)
  mark.className = 'station-mark ' + (mention ? 'mark-mention' : 'mark-unread')
  mark.textContent = mention ? '@' + countText(mention) : (unread ? countText(unread) : '')
}

// İstasyonlar listesinde ve sayfasında ok tuşlarıyla gezinme
function onRoomListKey (e) {
  const keys = ['ArrowDown', 'ArrowUp', 'Down', 'Up', 'Home', 'End']
  if (keys.indexOf(e.key) === -1 || !e.currentTarget) return
  const rows = Array.from(e.currentTarget.querySelectorAll('.room-row'))
  const i = rows.indexOf(document.activeElement)
  if (i === -1 || !rows.length) return
  e.preventDefault()
  let next = i
  if (e.key === 'ArrowDown' || e.key === 'Down') next = Math.min(rows.length - 1, i + 1)
  else if (e.key === 'ArrowUp' || e.key === 'Up') next = Math.max(0, i - 1)
  else if (e.key === 'Home') next = 0
  else next = rows.length - 1
  focusNode(rows[next])
}

// Sol bilgi sütunundaki ayarlı istasyon kartı (KONSEPT 6.3)
function renderRoomCard () {
  if (!el.roomCard) return
  const ch = currentViewMode() === 'channel' ? findChannel(state.channelId) : null
  el.roomCard.hidden = !ch
  if (!ch) return
  el.roomCardName.textContent = ch.name
  el.roomCardText.textContent = t('band.roomText')
  const keyOk = typeof hasActiveKey === 'function' ? hasActiveKey() : true
  el.roomCardE2e.classList.toggle('is-ok', keyOk)
  el.roomCardE2e.classList.toggle('is-warn', !keyOk)
  el.roomCardE2eText.textContent = t(keyOk ? 'band.e2e' : 'header.noKey')
  el.roomCardMembers.textContent = t('band.roomMembers', { count: metaUsers().length, online: onlineCount() })
  el.roomCardManage.hidden = !(typeof hasPerm === 'function' && hasPerm('channels'))
}

function activeFocusKey (container) {
  const active = document.activeElement
  if (!active || !container || !container.contains(active)) return null
  return active.getAttribute('data-focus-key')
}

function restoreFocusKey (container, key) {
  if (!key || !container) return
  const found = Array.from(container.querySelectorAll('[data-focus-key]')).filter((node) => node.getAttribute('data-focus-key') === key)[0]
  if (found) focusNode(found)
}

// Çevrimiçi sayfası (#people-sheet, KONSEPT 6.7): ses odalarındakiler oda oda ("<oda> odasında · n", konuşuyor,
// mikrofonu kapalı, bas konuş modu), sonra çevrimiçi ve çevrimdışı kişiler. Satırda yumuşak kare avatar ve durum
// noktası, ad, alt satırda durum ve özel durum metni, sağda rol etiketi ve susturma işareti. Satıra basmak profil
// kartını açar (13-profile.js). Üst çubuktaki Çevrimiçi şeridi de burada çizilir. Konuşan kişinin halesi ve
// "konuşuyor" satırı 10-voice.js updateVoiceLive'ın .member.is-speaking sınıfıyla CSS'te gösterilir.

function voiceChannelOf (userId) {
  const rosters = state.meta && state.meta.voice ? state.meta.voice : null
  if (!rosters) return null
  const found = Object.keys(rosters).filter((id) => {
    const roster = rosters[id]
    return Array.isArray(roster) && roster.some((entry) => entry && sameId(entry.userId, userId))
  })[0]
  return found === undefined ? null : findChannel(found)
}

// Kişinin ses odasında kamerası açık mı (meta ses kadrolarındaki camera alanı)
function userCameraOn (userId) {
  const rosters = state.meta && state.meta.voice ? state.meta.voice : null
  if (!rosters) return false
  return Object.keys(rosters).some((id) => {
    const roster = rosters[id]
    return Array.isArray(roster) && roster.some((entry) => entry && sameId(entry.userId, userId) && entry.camera === true)
  })
}

// Çevrimiçi ve çevrimdışı satırlarının alt satırı: durum (boşta, rahatsız etmeyin, çevrimdışı) ve özel durum metni
function memberPresenceText (userId, status) {
  let custom = ''
  if (status !== 'offline' && typeof userStatusText === 'function') {
    try {
      custom = String(userStatusText(userId) || '')
    } catch (err) {
      custom = ''
    }
  }
  if (status === 'online') return custom
  const label = typeof statusLabel === 'function' ? statusLabel(status) : t('status.' + status)
  return custom ? t('people.statusWithText', { status: label, text: custom }) : label
}

// Ses odasındaki kişinin durumu: sağırlaştırılmış, mikrofonu kapalı, kendisi için bas konuş veya ses etkinliği modu,
// yerel susturma ya da bağlı. Kendi satırım bu cihazdaki ses durumundan, diğerleri sunucunun kadro bilgisinden.
function memberVoiceState (entry) {
  const v = entry.voice
  const s = snap()
  const self = Boolean(state.me && sameId(entry.user.id, state.me.id))
  const mine = self && sameId(s.channelId, v.channelId)
  const muted = mine ? s.muted === true : v.muted
  const deafened = mine ? s.deafened === true : v.deafened
  const rec = typeof metaRecordOf === 'function' ? metaRecordOf(entry.user.id) : null
  let text = t('people.voiceIdle')
  if (deafened) text = t('voice.deafenedState')
  else if (rec && rec.voiceMuted) text = t('voice.serverMuted')
  else if (muted) text = t('voice.mutedState')
  else if (mine) text = t(s.inputMode === 'ptt' ? 'people.pttMode' : 'people.vadMode')
  else if (!self && s.peers && s.peers[String(entry.user.id)] && s.peers[String(entry.user.id)].localMute) text = t('voice.localMuted')
  return { text: text, muted: muted, deafened: deafened }
}

// Ses odalarındaki kişiler bant sırasıyla oda oda gruplanır, her kişi yalnızca bir odada sayılır
function memberVoiceGroups (entries) {
  const index = new Map(entries.map((e) => [String(e.user.id), e]))
  const seen = new Set()
  const groups = []
  voiceChannels().forEach((c) => {
    const people = []
    voiceRoster(c.id).forEach((r) => {
      const key = r ? String(r.userId) : ''
      const e = index.get(key)
      if (!e || seen.has(key)) return
      seen.add(key)
      people.push({ user: e.user, status: e.status, name: e.name, voice: { channelId: c.id, muted: r.muted === true, deafened: r.deafened === true } })
    })
    if (people.length) groups.push({ channel: c, people: people })
  })
  return { groups: groups, seen: seen }
}

// Çevrimiçi sayfasının ses bölümü kabı ve alttaki not (ilk çizimde eklenir)
function membersExtras () {
  if (!el.members) return null
  let voiceBox = byId('members-voice')
  if (!voiceBox) {
    voiceBox = h('div', 'members-voice')
    voiceBox.id = 'members-voice'
    el.members.insertBefore(voiceBox, el.members.firstChild)
  }
  let note = byId('members-note')
  if (!note) {
    note = h('p', 'hint people-note')
    note.id = 'members-note'
    el.members.appendChild(note)
  }
  return { voiceBox: voiceBox, note: note }
}

let membersRenderKey = ''

function renderMembers () {
  if (!el.membersOnline || !el.membersOffline) return
  const focusKey = activeFocusKey(el.members)
  const users = metaUsers()
  const entries = users.map((u) => ({ user: u, status: shownStatus(u.id), name: shownName(u.id) }))
  const locale = window.I18N && typeof window.I18N.locale === 'function' ? window.I18N.locale() : undefined
  entries.sort((a, b) => {
    try {
      return a.name.localeCompare(b.name, locale)
    } catch (err) {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    }
  })
  const voiceInfo = memberVoiceGroups(entries)
  const voicePeople = voiceInfo.groups.reduce((all, g) => all.concat(g.people), [])
  const online = entries.filter((e) => e.status !== 'offline' && !voiceInfo.seen.has(String(e.user.id)))
  const offline = entries.filter((e) => e.status === 'offline' && !voiceInfo.seen.has(String(e.user.id)))
  el.membersOnlineTitle.textContent = t('people.onlineTitle', { count: online.length })
  el.membersOfflineTitle.textContent = t('people.offlineTitle', { count: offline.length })
  el.membersOnlineTitle.hidden = online.length === 0 && voicePeople.length > 0
  el.membersOfflineTitle.hidden = offline.length === 0
  if (el.membersCount) el.membersCount.textContent = formatNumber(entries.length)
  renderServerMeta()
  // Şeritte önce ses odalarındakiler, sonra diğer çevrimiçi kişiler
  renderLiveChip(voicePeople.filter((e) => e.status !== 'offline').concat(online))
  renderRoomCard()
  const extras = membersExtras()
  const key = [window.I18N ? window.I18N.lang : ''].concat(voiceInfo.groups.map((g) => g.channel.id + '=' + g.channel.name + '=' + g.people.map((e) => memberRowKey(e)).join(',')), online.map((e) => memberRowKey(e)), ['|'], offline.map((e) => memberRowKey(e))).join('|')
  if (key !== membersRenderKey || !el.membersOnline.childNodes.length) {
    membersRenderKey = key
    if (extras) {
      clear(extras.voiceBox)
      voiceInfo.groups.forEach((g) => {
        const titleId = 'members-voice-title-' + g.channel.id
        const title = h('h3', 'section-title members-voice-title', t('people.inRoom', { name: g.channel.name, count: g.people.length }))
        title.id = titleId
        extras.voiceBox.appendChild(title)
        const list = h('ul', 'member-list members-voice-list')
        list.setAttribute('aria-labelledby', titleId)
        list.setAttribute('data-channel-id', String(g.channel.id))
        fillMemberList(list, g.people)
        extras.voiceBox.appendChild(list)
      })
      extras.voiceBox.hidden = voiceInfo.groups.length === 0
      extras.note.textContent = t('people.note')
    }
    fillMemberList(el.membersOnline, online)
    fillMemberList(el.membersOffline, offline)
    restoreFocusKey(el.members, focusKey)
  }
  updateVoiceLive()
  // Görünen ad veya engel listesi değiştiyse yazıyor satırı da güncellenir
  if (typeof renderTypingLine === 'function') renderTypingLine()
}

// Üst çubuktaki Çevrimiçi şeridi (#live-chip): canlı noktası, en fazla dört çevrimiçi kişinin avatarı
// ve sayı. Basınca Çevrimiçi sayfası açılır (12-init.js).
let liveChipKey = ''

function renderLiveChip (online) {
  if (!el.liveChip || !el.liveStack) return
  const count = online.length
  const label = t('top.liveLabel', { count: count })
  el.liveChip.setAttribute('aria-label', label)
  el.liveChip.title = label
  if (el.liveChipText) el.liveChipText.textContent = t('top.liveCount', { count: count })
  const shown = online.slice(0, 4)
  const key = shown.map((e) => {
    const info = avatarInfoFor(e.user.id)
    return e.user.id + ':' + info.colorIndex + ':' + info.initial + ':' + (info.blobUrl || '')
  }).join('|')
  if (key === liveChipKey && el.liveStack.childNodes.length === shown.length) return
  liveChipKey = key
  clear(el.liveStack)
  shown.forEach((e) => {
    const av = avatar(e.user.id, 'sm')
    av.removeAttribute('data-status')
    el.liveStack.appendChild(av)
  })
}

function memberRowKey (entry) {
  const u = entry.user
  const info = avatarInfoFor(u.id)
  let blocked = false
  if (typeof isBlocked === 'function') {
    try {
      blocked = Boolean(isBlocked(u.id))
    } catch (err) {
      blocked = false
    }
  }
  const sub = entry.voice ? JSON.stringify(memberVoiceState(entry)) : memberPresenceText(u.id, entry.status)
  const custom = typeof userRoleOf === 'function' ? userRoleOf(u.id) : null
  return [u.id, entry.status, entry.name, u.role, custom ? custom.name + '/' + custom.color : '', u.voiceMuted === true, sub, blocked, info.colorIndex, info.blobUrl || '', info.initial].join(':')
}

function fillMemberList (list, entries) {
  clear(list)
  entries.forEach((entry) => {
    list.appendChild(buildMemberRow(entry))
  })
}

function buildMemberRow (entry) {
  const u = entry.user
  const status = entry.status
  const li = h('li', 'member-li')
  const clickable = typeof openProfileCard === 'function'
  const row = h(clickable ? 'button' : 'div', 'member ' + (status === 'offline' ? 'is-offline' : 'is-online') + (entry.voice ? ' is-voice' : ''))
  row.setAttribute('data-user-id', String(u.id))
  row.setAttribute('data-status', status)
  if (clickable) {
    row.type = 'button'
    row.setAttribute('aria-haspopup', 'dialog')
    row.setAttribute('data-focus-key', 'member-' + u.id)
    row.addEventListener('click', () => {
      openProfileCard(u.id, row)
    })
  }
  if (typeof isBlocked === 'function') {
    try {
      if (isBlocked(u.id)) row.classList.add('is-blocked')
    } catch (err) {
      // Sosyal modül hazır değil
    }
  }
  const self = Boolean(state.me && sameId(u.id, state.me.id))
  if (self) row.classList.add('is-own')
  row.appendChild(avatar(u.id, 'md'))
  const text = h('span', 'member-text')
  const line = h('span', 'member-line')
  line.appendChild(h('span', 'member-name', entry.name))
  if (self) line.appendChild(h('span', 'member-you', t('common.you')))
  text.appendChild(line)
  let flag = null
  if (entry.voice) {
    const vs = memberVoiceState(entry)
    const sub = h('span', 'member-sub')
    const talk = h('span', 'member-talk')
    talk.appendChild(icon('i-wave'))
    talk.appendChild(h('span', 'member-talk-text', t('people.talking')))
    sub.appendChild(talk)
    sub.appendChild(h('span', 'member-state', vs.text))
    text.appendChild(sub)
    if (vs.deafened) flag = icon('i-headphones-off', 'member-flag')
    else if (vs.muted) flag = icon('i-mic-off', 'member-flag')
  } else {
    const subText = memberPresenceText(u.id, status)
    if (subText) text.appendChild(h('span', 'member-sub', subText))
  }
  row.appendChild(text)
  if (flag) row.appendChild(flag)
  const badge = roleBadge(u.role) || customRoleBadge(u.id)
  if (badge) {
    badge.classList.add('member-role')
    row.appendChild(badge)
  }
  li.appendChild(row)
  return li
}

// Konuşma başlığı (oda adı, alt satır, şifreli rozeti veya anahtar yok uyarısı) ve yazma alanı durumu.
// Özel mesaj ve Arkadaşlar görünümünde başlığı ve yazma alanını 15-dm.js ve 14-social.js çizer.

function renderChannelHeader () {
  if (currentViewMode() !== 'channel') {
    if (el.e2ePill) el.e2ePill.hidden = true
    refreshConversationChrome()
    return
  }
  const ch = findChannel(state.channelId)
  el.channelTitle.textContent = ch ? ch.name : ''
  if (el.channelSub) el.channelSub.textContent = ch ? t('band.roomSub', { count: metaUsers().length }) : ''
  el.channelStartTitle.textContent = ch ? t('channel.welcome', { name: ch.name }) : ''
  renderStartIcon(null)
  const placeholder = ch ? t(isNarrow() ? 'composer.placeholderShort' : 'composer.placeholder', { name: ch.name }) : t('composer.selectChannel')
  el.composerInput.setAttribute('placeholder', placeholder)
  const keyOk = hasActiveKey()
  el.keyState.hidden = keyOk
  el.keyState.textContent = keyOk ? '' : t('header.noKey')
  if (el.e2ePill) el.e2ePill.hidden = !keyOk || !ch
  renderRoomCard()
}

// Konuşma başlangıcındaki simge: odada kilit, özel mesajda karşı tarafın büyük avatarı (15-dm.js)
function renderStartIcon (partnerId) {
  const box = el.channelStart ? el.channelStart.querySelector('.channel-start-icon') : null
  if (!box) return
  const dm = partnerId !== null && partnerId !== undefined
  const key = dm ? 'dm:' + partnerId + ':' + JSON.stringify(avatarInfoFor(partnerId)) : 'channel'
  if (box.getAttribute('data-start') === key) return
  box.setAttribute('data-start', key)
  clear(box)
  box.classList.toggle('is-avatar', dm)
  el.channelStart.classList.toggle('is-dm', dm)
  if (dm) {
    const av = typeof personAvatar === 'function' ? personAvatar(partnerId, 'xl') : avatar(partnerId, 'xl')
    av.classList.add('channel-start-avatar')
    av.setAttribute('aria-hidden', 'true')
    box.appendChild(av)
  } else {
    box.appendChild(icon('i-lock'))
  }
}

function renderComposerState () {
  if (currentViewMode() !== 'channel') {
    refreshConversationChrome()
    return
  }
  const ch = findChannel(state.channelId)
  const keyOk = hasActiveKey()
  const enabled = Boolean(ch) && keyOk
  el.composerInput.disabled = !enabled
  el.btnPhoto.disabled = !enabled
  el.btnFile.disabled = !enabled
  el.btnEmoji.disabled = !enabled
  if (!keyOk) {
    el.composerHint.hidden = false
    el.composerHintText.textContent = t(activeKid() ? 'composer.keyNeeded' : 'composer.noActiveKey')
    el.composerHintAction.hidden = Boolean(!activeKid() && !isAdmin())
    el.composerHintAction.textContent = t(activeKid() ? 'key.addShort' : 'key.generate')
  } else {
    el.composerHint.hidden = true
  }
  renderChannelHeader()
  updateSendState()
}

// Okunmamış sayaçlar

function markRead () {
  if (!state.channelId || document.hidden) return
  const last = state.messages.length ? state.messages[state.messages.length - 1].id : null
  if (last !== null && last !== undefined) {
    const prev = Number(state.lastRead[state.channelId]) || 0
    if (Number(last) > prev) {
      state.lastRead[state.channelId] = last
      storeSetJson(userKey('read'), state.lastRead)
    }
  }
  let changed = false
  if (state.unread[state.channelId]) {
    state.unread[state.channelId] = 0
    changed = true
  }
  let mentionsChanged = false
  if (state.mentions && state.mentions[state.channelId]) {
    state.mentions[state.channelId] = 0
    changed = true
    mentionsChanged = true
  }
  if (changed) renderBand()
  if (mentionsChanged && typeof renderHomeEntry === 'function') renderHomeEntry()
}

// Açılışta diğer yazı odalarındaki okunmamış mesajları ve aralarındaki anmaları sayar (son 50 mesaja kadar).
async function scanUnread () {
  const me = state.me
  const list = textChannels().filter((c) => !sameId(c.id, state.channelId))
  for (const c of list) {
    if (!state.inApp || state.me !== me) return
    const res = await api('GET', '/api/messages?channel=' + encodeURIComponent(c.id) + '&limit=' + PAGE_SIZE)
    if (res.status !== 200 || !res.data || !Array.isArray(res.data.messages)) continue
    if (!state.inApp || state.me !== me) return
    const lastRead = Number(state.lastRead[c.id]) || 0
    const unread = res.data.messages.filter((m) => Number(m.id) > lastRead && !sameId(m.authorId, me.id))
    if (sameId(c.id, state.channelId)) continue
    if (unread.length > (state.unread[c.id] || 0)) state.unread[c.id] = unread.length
    if (typeof messageMentionsMe === 'function') {
      const mentions = unread.filter((m) => !(typeof isBlocked === 'function' && isBlocked(m.authorId)) && messageMentionsMe(m)).length
      if (mentions > (Number(state.mentions[c.id]) || 0)) state.mentions[c.id] = mentions
    }
  }
  if (state.inApp && state.me === me) {
    renderBand()
    if (typeof renderHomeEntry === 'function') renderHomeEntry()
  }
}

// Oda seçimi. Özel mesaj veya Arkadaşlar görünümündeyken önce oda görünümüne dönülür. Bant yeniden çizilir,
// ibre seçilen istasyona taşınır ve istasyon görünür alana kaydırılır (21-band.js bandAfterRender).

function selectChannel (id, opts) {
  const options = opts || {}
  const ch = findChannel(id)
  if (!ch || ch.type !== 'text') return
  closeDrawers()
  const fromOtherView = currentViewMode() !== 'channel'
  if (fromOtherView && typeof socialOnChannelLoad === 'function') {
    try {
      socialOnChannelLoad(ch.id)
    } catch (err) {
      window.console.error(err)
    }
  }
  if (sameId(state.channelId, ch.id) && !options.force && !fromOtherView) {
    if (options.focus && !isNarrow()) focusNode(el.composerInput)
    return
  }
  cancelEdit()
  closeMessageMenu()
  state.channelId = ch.id
  storeSet(userKey('channel'), String(ch.id))
  state.unread[ch.id] = 0
  const hadMentions = Boolean(state.mentions && state.mentions[ch.id])
  if (state.mentions) state.mentions[ch.id] = 0
  renderBand()
  if (hadMentions && typeof renderHomeEntry === 'function') renderHomeEntry()
  renderChannelHeader()
  renderComposerState()
  loadChannel()
  if (options.focus && isWide() && !el.composerInput.disabled) focusNode(el.composerInput)
}
