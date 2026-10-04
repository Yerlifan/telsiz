'use strict'

// Uygulama ekranı, meta uygulama, sunucu kimliği, kanal ve üye listeleri, kanal başlığı,
// okunmamış ve anma sayaçları ve kanal seçimi. Düzen (Ek H1): üyeler solda, kanallar sağda.

// Uygulama ekranı

function openApp () {
  state.inApp = true
  // Arama dizini, yazıyor ve anma durumları oturuma özeldir, her açılışta sıfırlanır
  chatPlusReset()
  showView('app')
  renderServerName()
  renderChannels()
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

// Meta uygulama: kanallar, üyeler, ses kadroları, roller (5.3)

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
  renderChannels()
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

// Sunucu kimliği: amblem (sunucu adının baş harfi), ad, çevrimiçi sayısı ve şifreleme notu

function renderServerName () {
  el.serverName.textContent = state.serverName
  el.authServerName.textContent = state.serverName
  if (el.serverEmblem) el.serverEmblem.textContent = initial(state.serverName)
  renderServerMeta()
  updateTitle()
}

function renderServerMeta () {
  if (!el.serverMeta) return
  const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
  const online = users.filter((u) => u && shownStatus(u.id) !== 'offline').length
  clear(el.serverMeta)
  const dot = h('span', 'online-dot')
  dot.setAttribute('aria-hidden', 'true')
  el.serverMeta.appendChild(dot)
  el.serverMeta.appendChild(h('span', 'server-online', t('layout.serverOnline', { count: online })))
  el.serverMeta.appendChild(icon('i-lock'))
  el.serverMeta.appendChild(h('span', 'server-encrypted', t('layout.encrypted')))
}

function updateTitle () {
  const name = state.serverName || t('app.name')
  document.title = document.hidden && state.hiddenUnread > 0 ? t('title.unread', { count: state.hiddenUnread, name: name }) : name
}

// Kanal listesi. Gece temasındaki frekans etiketi kanal kimliğinden türetilir (87.5 ile 108.0 arası),
// yalnızca süstür ve ekran okuyuculardan gizlidir.

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

// Liste değişmediyse yeniden çizilmez: klavye odağı ve odak çerçevesi korunur
let channelsRenderKey = ''

function renderChannels () {
  const mode = currentViewMode()
  const key = [mode, state.channelId, window.I18N ? window.I18N.lang : ''].concat(textChannels().map((c) => [c.id, c.name, state.unread[c.id] || 0, mentionCount(c.id)].join(':'))).join('|')
  if (key === channelsRenderKey && el.textChannels.childNodes.length) return
  channelsRenderKey = key
  const focusKey = activeFocusKey(el.textChannels)
  clear(el.textChannels)
  textChannels().forEach((c) => {
    const li = h('li', 'channel-row')
    const b = h('button', 'channel-item text-channel')
    b.type = 'button'
    b.setAttribute('data-channel-id', String(c.id))
    b.setAttribute('data-focus-key', 'text-' + c.id)
    b.appendChild(channelFreqNode(c.id))
    b.appendChild(icon('i-hash', 'channel-icon'))
    b.appendChild(h('span', 'channel-name', c.name))
    const count = state.unread[c.id] || 0
    const mentions = mentionCount(c.id)
    const current = sameId(c.id, state.channelId) && currentViewMode() === 'channel'
    if (current) b.setAttribute('aria-current', 'page')
    if (count > 0 && !current) {
      b.classList.add('is-unread')
      b.setAttribute('aria-label', t('channels.unreadLabel', { name: c.name, count: count }))
      if (!mentions) {
        const dot = h('span', 'unread-badge')
        dot.setAttribute('aria-hidden', 'true')
        b.appendChild(dot)
      }
    }
    if (mentions > 0 && !current) {
      b.classList.add('is-mentioned')
      const badge = h('span', 'mention-badge', mentions > 99 ? '99+' : String(mentions))
      badge.setAttribute('aria-hidden', 'true')
      b.appendChild(badge)
      b.setAttribute('aria-label', t('layout.channelMentions', { name: c.name, count: mentions }))
    }
    b.addEventListener('click', () => {
      selectChannel(c.id, { focus: true })
    })
    li.appendChild(b)
    el.textChannels.appendChild(li)
  })
  restoreFocusKey(el.textChannels, focusKey)
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

// Üye listesi (sol sütun): görünen ad, durum, ses kanalı, özel durum metni.
// Satıra tıklamak profil kartını açar (13-profile.js).

function voiceChannelOf (userId) {
  const rosters = state.meta && state.meta.voice ? state.meta.voice : null
  if (!rosters) return null
  const found = Object.keys(rosters).filter((id) => {
    const roster = rosters[id]
    return Array.isArray(roster) && roster.some((entry) => entry && sameId(entry.userId, userId))
  })[0]
  return found === undefined ? null : findChannel(found)
}

function memberStatusText (userId, status) {
  const ch = voiceChannelOf(userId)
  if (ch && status !== 'offline') return t('voice.inChannel', { name: ch.name })
  if (typeof userStatusText === 'function') {
    try {
      const custom = userStatusText(userId)
      if (custom && status !== 'offline') return String(custom)
    } catch (err) {
      // Profil modülü hazır değil
    }
  }
  if (status === 'idle') return t('layout.status.idle')
  if (status === 'dnd') return t('layout.status.dnd')
  return ''
}

let membersRenderKey = ''

function renderMembers () {
  const focusKey = activeFocusKey(el.members)
  const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users.filter((u) => u && u.id !== undefined) : []
  const entries = users.map((u) => ({ user: u, status: shownStatus(u.id), name: shownName(u.id) }))
  const locale = window.I18N && typeof window.I18N.locale === 'function' ? window.I18N.locale() : undefined
  entries.sort((a, b) => {
    try {
      return a.name.localeCompare(b.name, locale)
    } catch (err) {
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
    }
  })
  const online = entries.filter((e) => e.status !== 'offline')
  const offline = entries.filter((e) => e.status === 'offline')
  el.membersOnlineTitle.textContent = t('members.online', { count: online.length })
  el.membersOfflineTitle.textContent = t('members.offline', { count: offline.length })
  el.membersOfflineTitle.hidden = offline.length === 0
  if (el.membersCount) el.membersCount.textContent = formatNumber(entries.length)
  renderServerMeta()
  const key = entries.map((e) => memberRowKey(e)).join('|')
  if (key !== membersRenderKey || !el.membersOnline.childNodes.length) {
    membersRenderKey = key
    fillMemberList(el.membersOnline, online)
    fillMemberList(el.membersOffline, offline)
    restoreFocusKey(el.members, focusKey)
  }
  updateVoiceLive()
  // Görünen ad veya engel listesi değiştiyse yazıyor satırı da güncellenir
  if (typeof renderTypingLine === 'function') renderTypingLine()
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
  return [u.id, entry.status, entry.name, u.role, memberStatusText(u.id, entry.status), blocked, info.colorIndex, info.blobUrl || '', info.initial, window.I18N ? window.I18N.lang : ''].join(':')
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
  const row = h(clickable ? 'button' : 'div', 'member ' + (status === 'offline' ? 'is-offline' : 'is-online'))
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
  const badge = roleBadge(u.role)
  if (badge) line.appendChild(badge)
  text.appendChild(line)
  const sub = memberStatusText(u.id, status)
  if (sub) text.appendChild(h('span', 'member-sub', sub))
  row.appendChild(text)
  li.appendChild(row)
  return li
}

// Kanal başlığı ve yazma alanı durumu. Özel mesaj ve ana sayfa görünümünde başlığı ve yazma
// alanını 15-dm.js çizer.

function renderChannelHeader () {
  if (currentViewMode() !== 'channel') {
    refreshConversationChrome()
    return
  }
  const ch = findChannel(state.channelId)
  el.channelTitle.textContent = ch ? ch.name : ''
  el.channelStartTitle.textContent = ch ? t('channel.welcome', { name: ch.name }) : ''
  renderStartIcon(null)
  const placeholder = ch ? t(isNarrow() ? 'composer.placeholderShort' : 'composer.placeholder', { name: ch.name }) : t('composer.selectChannel')
  el.composerInput.setAttribute('placeholder', placeholder)
  const keyOk = hasActiveKey()
  el.keyState.hidden = keyOk
  el.keyState.textContent = keyOk ? '' : t('header.noKey')
}

// Konuşma başlangıcındaki simge: kanalda #, özel mesajda karşı tarafın büyük avatarı (15-dm.js)
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
    box.appendChild(icon('i-hash'))
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
  if (changed) renderChannels()
  if (mentionsChanged && typeof renderHomeEntry === 'function') renderHomeEntry()
}

// Açılışta diğer yazı kanallarındaki okunmamış mesajları ve aralarındaki anmaları sayar (son 50 mesaja kadar).
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
    renderChannels()
    if (typeof renderHomeEntry === 'function') renderHomeEntry()
  }
}

// Kanal seçimi. Özel mesaj veya ana sayfa görünümündeyken önce kanal görünümüne dönülür.

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
  renderChannels()
  if (hadMentions && typeof renderHomeEntry === 'function') renderHomeEntry()
  renderChannelHeader()
  renderComposerState()
  loadChannel()
  if (options.focus && isWide() && !el.composerInput.disabled) focusNode(el.composerInput)
}
