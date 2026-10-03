'use strict'

// Uygulama ekranı, meta uygulama, kanal ve üye listeleri, okunmamış sayaçlar ve kanal seçimi.

// Uygulama ekranı

function openApp () {
  state.inApp = true
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

// Meta uygulama: kanallar, üyeler, ses kadroları, roller (5.3)

function applyMeta (meta, isInitial) {
  if (!meta || typeof meta !== 'object') return
  const prevKid = state.meta ? state.meta.activeKid : undefined
  const prevRole = state.me ? state.me.role : null
  state.meta = meta
  if (typeof meta.serverName === 'string' && meta.serverName) state.serverName = meta.serverName
  const users = Array.isArray(meta.users) ? meta.users : []
  users.forEach((u) => {
    if (u && u.id !== undefined) state.users.set(String(u.id), { id: u.id, name: String(u.name || ''), role: u.role, online: u.online === true })
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
  if (prevKid !== meta.activeKid || prevRole !== (state.me ? state.me.role : null)) {
    renderComposerState()
    refreshAllMessages()
  }
  refreshSettings()
}

function renderServerName () {
  el.serverName.textContent = state.serverName
  el.authServerName.textContent = state.serverName
  updateTitle()
}

function updateTitle () {
  const name = state.serverName || t('app.name')
  document.title = document.hidden && state.hiddenUnread > 0 ? t('title.unread', { count: state.hiddenUnread, name: name }) : name
}

// Kanal listesi

function renderChannels () {
  const focusKey = activeFocusKey(el.textChannels)
  clear(el.textChannels)
  textChannels().forEach((c) => {
    const li = h('li', 'channel-row')
    const b = h('button', 'channel-item')
    b.type = 'button'
    b.setAttribute('data-channel-id', String(c.id))
    b.setAttribute('data-focus-key', 'text-' + c.id)
    b.appendChild(icon('i-hash', 'channel-icon'))
    b.appendChild(h('span', 'channel-name', c.name))
    const count = state.unread[c.id] || 0
    const current = sameId(c.id, state.channelId)
    if (current) b.setAttribute('aria-current', 'page')
    if (count > 0 && !current) {
      b.classList.add('is-unread')
      const badge = h('span', 'unread-badge', count > 99 ? '99+' : String(count))
      b.appendChild(badge)
      b.setAttribute('aria-label', t('channels.unreadLabel', { name: c.name, count: count }))
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
  if (!active || !container.contains(active)) return null
  return active.getAttribute('data-focus-key')
}

function restoreFocusKey (container, key) {
  if (!key) return
  const found = Array.from(container.querySelectorAll('[data-focus-key]')).filter((node) => node.getAttribute('data-focus-key') === key)[0]
  if (found) focusNode(found)
}

// Üye listesi (sağ sütun)

function renderMembers () {
  const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users.slice() : []
  const online = users.filter((u) => u.online === true)
  const offline = users.filter((u) => u.online !== true)
  el.membersOnlineTitle.textContent = t('members.online', { count: online.length })
  el.membersOfflineTitle.textContent = t('members.offline', { count: offline.length })
  fillMemberList(el.membersOnline, online, true)
  fillMemberList(el.membersOffline, offline, false)
}

function fillMemberList (list, users, online) {
  clear(list)
  users.forEach((u) => {
    const li = h('li', 'member' + (online ? ' is-online' : ' is-offline'))
    const av = h('span', 'avatar-wrap')
    av.appendChild(avatar(u.id, u.name))
    av.appendChild(h('span', 'presence-dot' + (online ? ' is-online' : '')))
    li.appendChild(av)
    const name = h('span', 'member-name', u.name)
    li.appendChild(name)
    if (state.me && sameId(u.id, state.me.id)) li.appendChild(h('span', 'member-you', t('common.you')))
    const badge = roleBadge(u.role)
    if (badge) li.appendChild(badge)
    list.appendChild(li)
  })
}

// Kanal başlığı ve yazma alanı durumu

function renderChannelHeader () {
  const ch = findChannel(state.channelId)
  el.channelTitle.textContent = ch ? ch.name : ''
  el.channelStartTitle.textContent = ch ? t('channel.welcome', { name: ch.name }) : ''
  const placeholder = ch ? t(isNarrow() ? 'composer.placeholderShort' : 'composer.placeholder', { name: ch.name }) : t('composer.selectChannel')
  el.composerInput.setAttribute('placeholder', placeholder)
  const keyOk = hasActiveKey()
  el.keyState.hidden = keyOk
  el.keyState.textContent = keyOk ? '' : t('header.noKey')
}

function renderComposerState () {
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
  if (state.unread[state.channelId]) {
    state.unread[state.channelId] = 0
    renderChannels()
  }
}

// Açılışta diğer yazı kanallarındaki okunmamış mesajları sayar (son 50 mesaja kadar).
async function scanUnread () {
  const me = state.me
  const list = textChannels().filter((c) => !sameId(c.id, state.channelId))
  for (const c of list) {
    if (!state.inApp || state.me !== me) return
    const res = await api('GET', '/api/messages?channel=' + encodeURIComponent(c.id) + '&limit=' + PAGE_SIZE)
    if (res.status !== 200 || !res.data || !Array.isArray(res.data.messages)) continue
    const lastRead = Number(state.lastRead[c.id]) || 0
    const count = res.data.messages.filter((m) => Number(m.id) > lastRead && !sameId(m.authorId, me.id)).length
    if (!sameId(c.id, state.channelId) && count > (state.unread[c.id] || 0)) {
      state.unread[c.id] = count
    }
  }
  if (state.inApp && state.me === me) renderChannels()
}

// Kanal seçimi

function selectChannel (id, opts) {
  const options = opts || {}
  const ch = findChannel(id)
  if (!ch || ch.type !== 'text') return
  closeDrawers()
  if (sameId(state.channelId, ch.id) && !options.force) {
    if (options.focus && !isNarrow()) focusNode(el.composerInput)
    return
  }
  cancelEdit()
  closeMessageMenu()
  state.channelId = ch.id
  storeSet(userKey('channel'), String(ch.id))
  state.unread[ch.id] = 0
  renderChannels()
  renderChannelHeader()
  renderComposerState()
  loadChannel()
  if (options.focus && isWide() && !el.composerInput.disabled) focusNode(el.composerInput)
}
