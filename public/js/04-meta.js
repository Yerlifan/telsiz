'use strict'

// Uygulama ekranı, meta uygulama, üst çubuktaki sunucu kimliği ve Yayındakiler şeridi, frekans bandı
// (istasyonlar, rozetler, ibre), Tümü sayfası, Gelenler kartı, oda bilgisi kartı, Yayındakiler sayfasındaki
// üye listesi, konuşma başlığı, okunmamış ve anma sayaçları ve oda seçimi (Ek K, Frekans düzeni).
// Bandın etkileşimi (tıklama, ibre sürükleme, klavye, tekerlek, kol) 21-band.js içindedir.

// Uygulama ekranı

function openApp () {
  state.inApp = true
  // Arama dizini, yazıyor ve anma durumları oturuma özeldir, her açılışta sıfırlanır
  chatPlusReset()
  showView('app')
  renderServerName()
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
  const prevUsersKey = mentionUsersKey(state.meta)
  state.meta = meta
  if (typeof meta.serverName === 'string' && meta.serverName) state.serverName = meta.serverName
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
  if (prevKid !== meta.activeKid || prevRole !== (state.me ? state.me.role : null)) {
    renderComposerState()
    refreshAllMessages()
  } else if (prevUsersKey !== mentionUsersKey(meta)) {
    refreshMentionMessages()
  }
  refreshSettings()
}

// Üst çubuktaki sunucu kimliği: amblem (sunucu adının baş harfi), ad ve alt satır (üye sayısı, şifreleme notu)

function renderServerName () {
  if (el.serverName) el.serverName.textContent = state.serverName
  if (el.authServerName) el.authServerName.textContent = state.serverName
  if (el.serverEmblem) el.serverEmblem.textContent = initial(state.serverName)
  renderServerMeta()
  updateTitle()
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

// Frekans bandı (KONSEPT 6.2). İstasyonlar üç gruptadır: Kişisel (Özel ve Arkadaşlar), Yazı odaları ve
// Ses odaları. İbre yalnızca konuşma istasyonlarına (data-kind="conv") oturur, ses istasyonuna basmak o
// odaya katılır. İstasyon anahtarları: 'dm', 'friends', 'text-<oda>', 'voice-<oda>'.

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

// Bandın veri modeli: gruplar ve istasyonlar. Çizimden bağımsızdır (Tümü sayfası ve Gelenler de kullanır).
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

function stationKeyOf (st) {
  return [st.key, st.name, st.sub, st.unread, st.mention, st.tuned ? 1 : 0, st.connected ? 1 : 0, st.joining ? 1 : 0, st.dj ? 1 : 0, (st.people || []).map((id) => {
    const info = avatarInfoFor(id)
    return id + '.' + info.colorIndex + '.' + info.initial + '.' + (info.blobUrl || '')
  }).join(','), st.label].join(':')
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

function buildStation (st) {
  const b = h('button', 'station station-' + st.type)
  b.type = 'button'
  b.setAttribute('data-station', st.key)
  b.setAttribute('data-kind', st.kind)
  b.setAttribute('data-focus-key', 'station-' + st.key)
  if (st.id !== undefined) b.setAttribute('data-channel-id', String(st.id))
  b.setAttribute('aria-label', st.label)
  b.tabIndex = -1
  if (st.tuned) {
    b.classList.add('is-tuned')
    b.setAttribute('aria-current', 'page')
    b.appendChild(buildNeedle())
  }
  if (st.unread > 0 || st.mention > 0) b.classList.add('is-unread')
  if (st.mention > 0) b.classList.add('is-mentioned')
  if (st.connected) b.classList.add('is-connected')
  if (st.joining) b.classList.add('is-joining')
  if (st.live) b.classList.add('is-live')
  b.appendChild(icon(st.icon, 'station-icon'))
  const text = h('span', 'station-body')
  text.appendChild(h('span', 'station-name', st.name))
  const sub = h('span', 'station-meta')
  if (st.freq) sub.appendChild(channelFreqNode(st.id))
  sub.appendChild(h('span', 'station-sub', st.sub))
  text.appendChild(sub)
  b.appendChild(text)
  if (st.kind === 'voice') {
    const pulse = h('span', 'station-pulse')
    pulse.setAttribute('aria-hidden', 'true')
    b.appendChild(pulse)
    if (st.dj) b.appendChild(icon('i-music', 'station-dj'))
    if (st.people && st.people.length) {
      const stack = h('span', 'mini-stack')
      stack.setAttribute('aria-hidden', 'true')
      st.people.slice(0, 3).forEach((id) => {
        const av = avatar(id, 'xs')
        av.removeAttribute('data-status')
        stack.appendChild(av)
      })
      b.appendChild(stack)
    }
  }
  const mark = buildStationMark(st)
  if (mark) b.appendChild(mark)
  return b
}

// Liste değişmediyse yeniden çizilmez: klavye odağı, gezici tabindex ve kaydırma konumu korunur
let bandRenderKey = ''

function renderBand () {
  if (!el.bandTrack) return
  // İbre sürüklenirken çizim bekletilir, sürükleme bitince 21-band.js yeniden çağırır
  if (typeof bandIsDragging === 'function' && bandIsDragging()) {
    if (typeof bandRenderLater === 'function') bandRenderLater()
    return
  }
  const model = bandModel()
  const tuned = tunedStationKey()
  if (currentViewMode() === 'dm' && state.channelId !== null && state.channelId !== undefined) bandLastDm = state.channelId
  const key = [window.I18N ? window.I18N.lang : '', tuned].concat(model.map((g) => g.key + '=' + g.label + '=' + g.stations.map(stationKeyOf).join('|'))).join('#')
  if (key !== bandRenderKey || !el.bandTrack.querySelector('.station[data-station]')) {
    bandRenderKey = key
    const focusKey = activeFocusKey(el.bandTrack)
    const scroll = el.bandTrack.scrollLeft
    clear(el.bandTrack)
    el.bandTrack.removeAttribute('aria-busy')
    model.forEach((g, i) => {
      if (i > 0) {
        const sep = h('span', 'band-sep')
        sep.setAttribute('aria-hidden', 'true')
        el.bandTrack.appendChild(sep)
      }
      const group = h('div', 'band-group band-group-' + g.key)
      group.setAttribute('role', 'group')
      group.setAttribute('aria-label', g.label)
      const label = h('span', 'band-group-label', g.label)
      label.setAttribute('aria-hidden', 'true')
      group.appendChild(label)
      g.stations.forEach((st) => {
        group.appendChild(buildStation(st))
      })
      if (!g.stations.length && g.empty) group.appendChild(h('span', 'band-empty', g.empty))
      el.bandTrack.appendChild(group)
    })
    el.bandTrack.scrollLeft = scroll
    const stations = Array.from(el.bandTrack.querySelectorAll('.station[data-station]'))
    const focusTarget = focusKey ? stations.filter((n) => n.getAttribute('data-focus-key') === focusKey)[0] : null
    const rover = focusTarget || stations.filter((n) => n.classList.contains('is-tuned'))[0] || stations[0]
    if (rover) rover.tabIndex = 0
    if (focusTarget) focusNode(focusTarget)
  }
  if (el.bandAdd) el.bandAdd.hidden = !(typeof isAdmin === 'function' && isAdmin())
  if (typeof bandAfterRender === 'function') bandAfterRender(tuned)
  renderStationsSheet(model)
  renderInbox(model)
  renderRoomCard()
}

// Eski ad: diğer modüller oda listesi yerine bandı bu adla da yeniler
function renderChannels () {
  renderBand()
}

// Konuşan ses odasının nabzı ve ses durumundaki küçük değişiklikler (10-voice.js updateVoiceLive çağırır)
function updateBandLive () {
  if (!el.bandTrack) return
  Array.from(el.bandTrack.querySelectorAll('.station[data-kind="voice"]')).forEach((b) => {
    b.classList.toggle('is-live', voiceSpeakingIn(b.getAttribute('data-channel-id')))
  })
}

// Tümü sayfası (#stations-sheet): bandın tüm istasyonları gruplu ve büyük satırlarla, Özel grubunda
// özel konuşmalar da ayrı satırdır. Sayfa açık değilken de çizilir, açılınca hazırdır.
let stationsRenderKey = ''

function renderStationsSheet (model) {
  const list = el.stationsList
  if (!list) return
  const groups = model || bandModel()
  const dms = bandDmEntries()
  const key = [window.I18N ? window.I18N.lang : '', state.channelId, currentViewMode()].concat(groups.map((g) => g.stations.map(stationKeyOf).join('|'))).concat(dms.map((d) => {
    const name = typeof userDisplayName === 'function' ? userDisplayName(d.userId) : shownName(d.userId)
    const sub = typeof dmRowSub === 'function' ? dmRowSub(d) : ''
    return d.id + ':' + name + ':' + (state.unread[d.id] || 0) + ':' + sub + ':' + shownStatus(d.userId) + ':' + JSON.stringify(avatarInfoFor(d.userId))
  })).join('#')
  if (key === stationsRenderKey && list.childNodes.length) return
  stationsRenderKey = key
  const focusKey = activeFocusKey(list)
  clear(list)
  groups.forEach((g) => {
    list.appendChild(h('h3', 'section-title sheet-section', g.label))
    const ul = h('ul', 'sheet-list')
    ul.setAttribute('aria-label', g.label)
    g.stations.forEach((st) => {
      ul.appendChild(buildSheetRow(st))
      if (st.type === 'dm') {
        dms.forEach((d) => {
          ul.appendChild(buildSheetDmRow(d))
        })
      }
    })
    if (!g.stations.length && g.empty) ul.appendChild(h('li', 'sheet-empty hint', g.empty))
    list.appendChild(ul)
  })
  restoreFocusKey(list, focusKey)
}

function buildSheetRow (st) {
  const li = h('li', 'sheet-li')
  const b = h('button', 'sheet-row sheet-row-' + st.type)
  b.type = 'button'
  b.setAttribute('data-station', st.key)
  b.setAttribute('data-focus-key', 'sheet-' + st.key)
  if (st.id !== undefined) b.setAttribute('data-channel-id', String(st.id))
  b.setAttribute('aria-label', st.label)
  if (st.tuned) {
    b.classList.add('is-current')
    b.setAttribute('aria-current', 'page')
  }
  if (st.connected) b.classList.add('is-connected')
  const ic = h('span', 'sheet-row-icon')
  ic.setAttribute('aria-hidden', 'true')
  ic.appendChild(icon(st.icon))
  b.appendChild(ic)
  const text = h('span', 'sheet-row-body')
  text.appendChild(h('span', 'sheet-row-name', st.name))
  text.appendChild(h('span', 'sheet-row-sub', st.tuned ? t('band.tunedSub') : st.sub))
  b.appendChild(text)
  if (st.dj) b.appendChild(icon('i-music', 'sheet-row-dj'))
  const mark = buildStationMark(st)
  if (mark) b.appendChild(mark)
  if (st.tuned) b.appendChild(icon('i-check', 'sheet-row-check'))
  li.appendChild(b)
  return li
}

function buildSheetDmRow (d) {
  const li = h('li', 'sheet-li sheet-li-dm')
  const b = h('button', 'sheet-row sheet-row-dmitem')
  b.type = 'button'
  b.setAttribute('data-dm-id', String(d.id))
  b.setAttribute('data-focus-key', 'sheet-dm-' + d.id)
  const name = typeof userDisplayName === 'function' ? userDisplayName(d.userId) : shownName(d.userId)
  const count = Number(state.unread[d.id]) || 0
  const current = currentViewMode() === 'dm' && sameId(d.id, state.channelId)
  b.setAttribute('aria-label', count && !current ? t('dm.itemUnreadLabel', { name: name, count: count }) : t('dm.itemLabel', { name: name }))
  if (current) {
    b.classList.add('is-current')
    b.setAttribute('aria-current', 'page')
  }
  const av = typeof personAvatar === 'function' ? personAvatar(d.userId, 'sm') : avatar(d.userId, 'sm')
  b.appendChild(av)
  const text = h('span', 'sheet-row-body')
  text.appendChild(h('span', 'sheet-row-name', name))
  // Alt satır (15-dm.js): durum veya bulunduğu ses odası ve son mesaj saati
  const sub = typeof dmRowSub === 'function' ? dmRowSub(d) : ''
  if (sub) text.appendChild(h('span', 'sheet-row-sub', sub))
  b.appendChild(text)
  if (count && !current) {
    const mark = h('span', 'station-mark mark-mention', countText(count))
    mark.setAttribute('aria-hidden', 'true')
    b.appendChild(mark)
  }
  li.appendChild(b)
  return li
}

// Gelenler kartı (#inbox, KONSEPT 6.5): ayarlı olmayan istasyonlardaki okunmamış, anma ve özel mesaj
// sayılarının toplu görünümü. Her satır o istasyonu ayarlar.
let inboxRenderKey = ''

function inboxRows (model) {
  const rows = []
  bandStations(model).forEach((st) => {
    if (st.kind !== 'conv' || st.tuned) return
    if (st.type === 'text' && st.mention) rows.push({ station: st.key, count: '@' + countText(st.mention), mention: true, name: st.name, sub: t('inbox.mentions', { count: st.mention }), label: st.label })
    else if (st.type === 'text' && st.unread) rows.push({ station: st.key, count: countText(st.unread), mention: false, name: st.name, sub: t('inbox.unread', { count: st.unread }), label: st.label })
    else if (st.type === 'friends' && st.unread) rows.push({ station: st.key, count: countText(st.unread), mention: false, name: st.name, sub: t('band.requests', { count: st.unread }), label: st.label })
  })
  const mode = currentViewMode()
  bandDmEntries().forEach((d) => {
    const count = Number(state.unread[d.id]) || 0
    if (!count || (mode === 'dm' && sameId(d.id, state.channelId))) return
    const name = typeof userDisplayName === 'function' ? userDisplayName(d.userId) : shownName(d.userId)
    rows.push({ dm: d.id, count: countText(count), mention: true, name: t('inbox.dmName', { name: name }), sub: t('inbox.dm', { count: count }), label: t('dm.itemUnreadLabel', { name: name, count: count }) })
  })
  // Anmalar ve özel mesajlar önce
  return rows.filter((r) => r.mention).concat(rows.filter((r) => !r.mention))
}

function renderInbox (model) {
  const list = el.inboxList
  if (!list) return
  const rows = inboxRows(model)
  const key = [window.I18N ? window.I18N.lang : ''].concat(rows.map((r) => [r.station || 'dm-' + r.dm, r.count, r.name, r.sub].join(':'))).join('|')
  if (key === inboxRenderKey && list.childNodes.length) return
  inboxRenderKey = key
  const focusKey = activeFocusKey(list)
  clear(list)
  if (!rows.length) {
    list.appendChild(h('p', 'inbox-empty hint', t('inbox.empty')))
    return
  }
  rows.forEach((r) => {
    const b = h('button', 'inbox-row')
    b.type = 'button'
    b.setAttribute('aria-label', r.label)
    if (r.station) b.setAttribute('data-station', r.station)
    if (r.dm !== undefined) b.setAttribute('data-dm-id', String(r.dm))
    b.setAttribute('data-focus-key', 'inbox-' + (r.station || 'dm-' + r.dm))
    const badge = h('span', 'station-mark ' + (r.mention ? 'mark-mention' : 'mark-unread'), r.count)
    badge.setAttribute('aria-hidden', 'true')
    b.appendChild(badge)
    const text = h('span', 'inbox-row-text')
    text.appendChild(h('span', 'inbox-row-name', r.name))
    text.appendChild(h('span', 'inbox-row-sub', r.sub))
    b.appendChild(text)
    list.appendChild(b)
  })
  restoreFocusKey(list, focusKey)
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
  el.roomCardManage.hidden = !(typeof isAdmin === 'function' && isAdmin())
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

// Yayındakiler sayfası (#people-sheet, KONSEPT 6.7): ses odalarındakiler oda oda ("<oda> odasında · n", konuşuyor,
// mikrofonu kapalı, bas konuş modu), sonra çevrimiçi ve çevrimdışı kişiler. Satırda yumuşak kare avatar ve durum
// noktası, ad, alt satırda durum ve özel durum metni, sağda rol etiketi ve susturma işareti. Satıra basmak profil
// kartını açar (13-profile.js). Üst çubuktaki Yayındakiler şeridi de burada çizilir. Konuşan kişinin halesi ve
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
  let text = t('people.voiceIdle')
  if (deafened) text = t('voice.deafenedState')
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

// Yayındakiler sayfasının ses bölümü kabı ve alttaki not (ilk çizimde eklenir)
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

// Üst çubuktaki Yayındakiler şeridi (#live-chip): canlı noktası, en fazla dört çevrimiçi kişinin avatarı
// ve sayı. Basınca Yayındakiler sayfası açılır (12-init.js).
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
  return [u.id, entry.status, entry.name, u.role, sub, blocked, info.colorIndex, info.blobUrl || '', info.initial].join(':')
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
  const badge = roleBadge(u.role)
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
