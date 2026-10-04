'use strict'

// Arkadaşlar ve engelleme: kişiye özel meta (private, pmv), görünüm modu (oda, Arkadaşlar istasyonu, özel
// mesaj), Kişisel istasyonların rozetleri (bantta), arkadaşlar görünümü (Çevrimiçi, Tümü, Bekleyen, Engellenenler,
// Arkadaş ekle), istek gönderme, kabul, ret, iptal, arkadaşlıktan çıkarma, engelleme ve engeli
// kaldırma, engellenen kişinin kanal mesajlarının katlanması ve seste yerel otomatik susturma.

const HOME_TABS = ['online', 'all', 'pending', 'blocked', 'add']

const socialState = {
  priv: null,
  pmv: 0,
  view: 'channel',
  homeTab: 'online',
  addText: '',
  addMsg: null,
  uiBound: false,
  expanded: new Set(),
  incomingSeen: null,
  menuUserId: null,
  // Sol bilgi sütunu sayfada görünüyor mu (Arkadaş ekle formunun yeri, onSocialResize)
  inline: null
}

function emptyPrivate () {
  return { friends: [], incoming: [], outgoing: [], blocked: [], dms: [], allowMemberDms: true, status: null }
}

function idList (value) {
  if (!Array.isArray(value)) return []
  return value.filter((id) => (typeof id === 'number' && id > 0) || (typeof id === 'string' && /^[1-9][0-9]*$/.test(id)))
}

function normalizePrivate (p) {
  const out = emptyPrivate()
  if (!p || typeof p !== 'object') return out
  out.friends = idList(p.friends)
  out.incoming = idList(p.incoming)
  out.outgoing = idList(p.outgoing)
  out.blocked = idList(p.blocked)
  out.dms = Array.isArray(p.dms) ? p.dms.filter((d) => d && d.id !== undefined && d.userId !== undefined).map((d) => ({
    id: d.id,
    userId: d.userId,
    lastMessageId: d.lastMessageId === undefined ? null : d.lastMessageId,
    lastMessageAt: typeof d.lastMessageAt === 'number' ? d.lastMessageAt : 0
  })) : []
  out.allowMemberDms = p.allowMemberDms !== false
  out.status = STATUS_CHOICES.indexOf(p.status) !== -1 ? p.status : null
  return out
}

function priv () {
  return socialState.priv || emptyPrivate()
}

function socialPmv () {
  return socialState.pmv || 0
}

function inList (list, userId) {
  return list.some((id) => sameId(id, userId))
}

function isFriend (userId) {
  return inList(priv().friends, userId)
}

function hasIncoming (userId) {
  return inList(priv().incoming, userId)
}

function hasOutgoing (userId) {
  return inList(priv().outgoing, userId)
}

function isBlocked (userId) {
  return inList(priv().blocked, userId)
}

function privateIds (p) {
  const ids = [].concat(p.friends, p.incoming, p.outgoing, p.blocked, p.dms.map((d) => d.userId))
  return ids.map(String).filter((id, i, all) => all.indexOf(id) === i)
}

// /api/state yanıtı (oturum başlarken)
function socialApplyState (data) {
  socialState.priv = normalizePrivate(data.private)
  socialState.pmv = Number(data.pmv) || 0
  socialState.incomingSeen = new Set(socialState.priv.incoming.map(String))
  if (state.me && socialState.priv.status) state.me.status = socialState.priv.status
}

// Poll yanıtındaki kişiye özel meta
function socialApplyPrivate (p, pmv) {
  const before = priv()
  const next = normalizePrivate(p)
  socialState.priv = next
  if (typeof pmv === 'number') socialState.pmv = pmv
  if (state.me && next.status && next.status !== state.me.status) {
    state.me.status = next.status
    renderUserPanel()
    renderMembers()
  }
  const blockedChanged = before.blocked.map(String).sort().join(',') !== next.blocked.map(String).sort().join(',')
  notifyNewRequests(next.incoming)
  profilesEnsure(privateIds(next))
  if (!state.inApp) return
  if (blockedChanged) {
    autoMuteBlocked()
    if (!isDmChannel(state.channelId)) refreshAllMessages()
  }
  socialRender()
  refreshProfileCard()
}

function socialReset () {
  socialState.priv = null
  socialState.pmv = 0
  socialState.view = 'channel'
  socialState.homeTab = 'online'
  socialState.addText = ''
  socialState.addMsg = null
  socialState.expanded = new Set()
  socialState.incomingSeen = null
  dmState.activeId = null
  dmState.partnerId = null
  dmState.scanGen += 1
  closeAppDialog()
  profilesReset()
  setConversationMode('channel')
  const list = byId('dm-list')
  if (list) clear(list)
  const home = byId('home-view')
  if (home) clear(home)
  renderHomeEntry()
}

// Uygulama ekranı açıldıktan sonra
function socialAfterOpen () {
  bindSocialUi()
  setConversationMode('channel')
  profilesOnMeta()
  profilesEnsure(privateIds(priv()))
  socialRender()
  autoMuteBlocked()
  ensureIdentityBinding()
  maybeAskIdentityUnlock()
  if (identityState.profileStep) {
    identityState.profileStep = false
    if (!findLayer('app-dialog')) openProfileStep()
  }
  scanDmUnread()
}

// Meta uygulandıktan sonra: profiller, kimlik bağlaması ve görünüm
function socialAfterMeta (prevKid) {
  profilesOnMeta()
  if (prevKid !== activeKid()) {
    profilesRecheck()
    identityState.bindingKey = ''
    ensureIdentityBinding()
  }
  autoMuteBlocked()
  if (!state.inApp) return
  renderDmList()
  if (socialState.view === 'home') renderHomeView()
  if (socialState.view === 'dm') dmRefreshChrome()
}

// Grup anahtarlığı değişince (anahtar eklendi veya silindi)
function socialAfterKeyring () {
  profilesRecheck()
  identityState.bindingKey = ''
  ensureIdentityBinding()
  if (socialState.view === 'dm') dmRefreshChrome()
}

function socialRender () {
  renderHomeEntry()
  renderDmList()
  renderPersonalCards()
  if (socialState.view === 'home') renderHomeView()
  if (socialState.view === 'dm') dmRefreshChrome()
}

function bindSocialUi () {
  if (socialState.uiBound) return
  socialState.uiBound = true
  socialState.inline = homeAddInline()
  window.addEventListener('resize', onSocialResize)
  // Dil değişince (html lang) bu modüllerin çizdiği bölgeler yeniden üretilir
  if (typeof window.MutationObserver === 'function') {
    try {
      const observer = new window.MutationObserver(() => {
        if (state.inApp) socialOnLanguage()
      })
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    } catch (err) {
      // Gözlemci desteklenmiyor, görünümler bir sonraki çizimde güncellenir
    }
  }
}

function socialOnLanguage () {
  socialRender()
  refreshProfileCard()
  const menu = findLayer('status-menu')
  if (menu) closeLayer(menu, false)
}

// Görünüm modu: 'channel' (yazı kanalı), 'home' (arkadaşlar) veya 'dm' (özel mesaj).
// Özel mesajda state.channelId özel konuşmanın kimliğidir, ana sayfada null olur.

function conversationMode () {
  return socialState.view
}

function channelTitleNode () {
  if (!el.channelTitle) return null
  return el.channelTitle.closest ? (el.channelTitle.closest('.channel-title') || el.channelTitle) : el.channelTitle
}

function setConversationMode (mode) {
  socialState.view = mode
  if (el.appView) el.appView.setAttribute('data-view', mode)
  const home = byId('home-view')
  if (home) home.hidden = mode !== 'home'
  const header = byId('dm-header')
  if (header) header.hidden = mode !== 'dm'
  const warning = byId('key-warning')
  if (warning && mode !== 'dm') warning.hidden = true
  const notice = byId('dm-notice')
  if (notice && mode !== 'dm') notice.hidden = true
  const title = channelTitleNode()
  if (title) title.hidden = mode !== 'channel'
  const startText = el.channelStart ? el.channelStart.querySelector('.channel-start-text') : null
  if (startText) setLive(startText, mode === 'dm' ? () => t('dm.startText') : () => t('messages.start'))
  if (el.messages) el.messages.hidden = mode === 'home'
  if (el.composer) el.composer.hidden = mode === 'home'
  if (el.keyState && mode !== 'channel') el.keyState.hidden = true
  if (el.e2ePill && mode !== 'channel') el.e2ePill.hidden = true
  renderPersonalCards()
}

// Kanal yüklenirken (kanal listesinden seçildiğinde) kanal moduna dönülür
function socialOnChannelLoad (channelId) {
  if (socialState.view !== 'channel' && !isDmChannel(channelId) && findChannel(channelId)) {
    dmState.activeId = null
    dmState.partnerId = null
    setConversationMode('channel')
    renderDmList()
  }
}

// Arkadaşlar istasyonu (#home-view, KONSEPT 6.3 ve 3.2): başlık ("Arkadaşlar", "Kişisel istasyon · yalnızca siz
// görürsünüz"), sekmeler (Çevrimiçi, Tümü, Bekleyen, Engellenenler, sol sütun gizliyken Arkadaş ekle) ve listeler.
// Geniş ekranda (1280 px ve üstü) Arkadaş ekle formu ve gönderilen istekler sol sütundaki kartlardadır
// (renderPersonalCards), Özel istasyonunda sol sütunda gelen arkadaşlık istekleri kartı durur.

function showHome (tab, opts) {
  if (!state.inApp) return
  const options = opts || {}
  closeDrawers()
  cancelEdit()
  closeMessageMenu()
  const wantAdd = tab === 'add'
  if (tab && HOME_TABS.indexOf(tab) !== -1) socialState.homeTab = tab
  if (socialState.view !== 'home') {
    state.loadGen += 1
    state.loading = false
    state.channelId = null
    state.messages = []
    state.nodes = new Map()
    decryptCache.clear()
    clear(el.messageList)
    dmState.activeId = null
    dmState.partnerId = null
  }
  setConversationMode('home')
  renderChannels()
  renderDmList()
  renderHomeView()
  // Geniş ekranda Arkadaş ekle sekmesi yoktur, form sol sütundaki karttadır
  if (wantAdd && homeAddInline()) {
    const input = byId('friend-add-name')
    if (input) focusNode(input)
    return
  }
  if (options.focus) {
    const selected = byId('home-tab-' + socialState.homeTab)
    if (selected) focusNode(selected)
  }
}

// Kişisel istasyonların (Özel, Arkadaşlar) rozetleri bantta çizilir (04-meta.js renderBand): okunmamış özel
// mesajlar ve bekleyen arkadaşlık istekleri. Eski ad korunur, çağıran modüller bandı bununla yeniler.
function renderHomeEntry () {
  renderBand()
}

// Sol bilgi sütunu sayfada görünür mü (1280 px ve üstü): Arkadaş ekle formu orada durur
function homeAddInline () {
  return typeof isInfoInline === 'function' ? isInfoInline() : window.innerWidth >= 1280
}

// Görünen sekmeler: sol sütun görünürken Arkadaş ekle sekmesi yoktur
function homeTabs () {
  return homeAddInline() ? HOME_TABS.filter((name) => name !== 'add') : HOME_TABS.slice()
}

function currentHomeTab () {
  return homeTabs().indexOf(socialState.homeTab) !== -1 ? socialState.homeTab : 'online'
}

function homeLists () {
  const p = priv()
  const friends = p.friends.slice().sort((a, b) => userDisplayName(a).localeCompare(userDisplayName(b), window.I18N.locale()))
  return {
    online: friends.filter((id) => userStatus(id) !== 'offline'),
    offline: friends.filter((id) => userStatus(id) === 'offline'),
    all: friends,
    incoming: p.incoming.slice(),
    outgoing: p.outgoing.slice(),
    blocked: p.blocked.slice()
  }
}

function tabCount (text, kind) {
  const badge = h('span', 'station-mark home-tab-count ' + (kind === 'mention' ? 'mark-mention' : 'mark-unread'), text)
  badge.setAttribute('aria-hidden', 'true')
  return badge
}

function renderHomeView () {
  const root = byId('home-view')
  if (!root || socialState.view !== 'home') return
  const focusKey = activeFocusKey(root)
  const keepInput = document.activeElement && document.activeElement.id === 'friend-add-name' && root.contains(document.activeElement)
  const scrollBox = root.querySelector('.home-page')
  const scroll = scrollBox ? scrollBox.scrollTop : 0
  clear(root)
  const tab = currentHomeTab()
  const lists = homeLists()
  const head = h('header', 'home-view-head')
  const titles = h('div', 'home-view-titles')
  const title = h('h2', 'home-view-title', t('social.friends'))
  title.id = 'home-view-title'
  titles.appendChild(title)
  titles.appendChild(h('p', 'home-view-sub', t('people.friendsSub')))
  head.appendChild(titles)
  root.appendChild(head)
  const page = h('div', 'home-page')
  const tabs = h('div', 'tabs home-tabs')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', t('social.tabsLabel'))
  homeTabs().forEach((name) => {
    const b = h('button', 'tab home-tab' + (name === 'add' ? ' home-tab-add' : ''))
    b.type = 'button'
    b.id = 'home-tab-' + name
    b.setAttribute('role', 'tab')
    b.setAttribute('aria-controls', 'home-panel')
    b.setAttribute('data-tab', name)
    b.setAttribute('data-focus-key', 'home-tab-' + name)
    const selected = name === tab
    b.setAttribute('aria-selected', selected ? 'true' : 'false')
    b.tabIndex = selected ? 0 : -1
    if (name === 'add') b.appendChild(icon('i-user-plus'))
    b.appendChild(h('span', 'home-tab-label', t('social.tab.' + name)))
    if (name === 'online' && lists.online.length) {
      b.appendChild(tabCount(countLabel(lists.online.length), 'unread'))
      b.setAttribute('aria-label', t('people.onlineTabLabel', { count: lists.online.length }))
    }
    if (name === 'pending' && lists.incoming.length) {
      b.appendChild(tabCount(countLabel(lists.incoming.length), 'mention'))
      b.setAttribute('aria-label', t('social.pendingTabLabel', { count: lists.incoming.length }))
    }
    b.addEventListener('click', () => {
      selectHomeTab(name, false)
    })
    b.addEventListener('keydown', onHomeTabKey)
    tabs.appendChild(b)
  })
  page.appendChild(tabs)
  const panel = h('div', 'home-panel')
  panel.id = 'home-panel'
  panel.setAttribute('role', 'tabpanel')
  panel.setAttribute('aria-labelledby', 'home-tab-' + tab)
  panel.setAttribute('data-tab', tab)
  fillHomePanel(panel, tab, lists)
  page.appendChild(panel)
  root.appendChild(page)
  page.scrollTop = scroll
  if (keepInput) {
    const input = byId('friend-add-name')
    if (input) focusNode(input)
  } else {
    restoreFocusKey(root, focusKey)
  }
}

function countLabel (n) {
  return n > 99 ? '99+' : String(n)
}

function selectHomeTab (name, focusTab) {
  if (homeTabs().indexOf(name) === -1) return
  socialState.homeTab = name
  renderHomeView()
  if (focusTab) {
    const tab = byId('home-tab-' + name)
    if (tab) focusNode(tab)
  } else if (name === 'add') {
    const input = byId('friend-add-name')
    if (input) focusNode(input)
  }
}

function onHomeTabKey (e) {
  const tabs = homeTabs()
  const i = tabs.indexOf(currentHomeTab())
  let next = -1
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % tabs.length
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + tabs.length) % tabs.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = tabs.length - 1
  if (next === -1) return
  e.preventDefault()
  selectHomeTab(tabs[next], true)
}

function fillHomePanel (panel, tab, lists) {
  if (tab === 'add') {
    panel.appendChild(buildAddFriendForm(false))
    return
  }
  if (tab === 'pending') {
    appendFriendSection(panel, 'social.incomingTitle', lists.incoming, 'incoming')
    appendFriendSection(panel, 'social.outgoingTitle', lists.outgoing, 'outgoing')
    if (!lists.incoming.length && !lists.outgoing.length) panel.appendChild(h('p', 'home-empty hint', t('social.emptyPending')))
    return
  }
  if (tab === 'blocked') {
    appendFriendSection(panel, 'social.blockedTitle', lists.blocked, 'blocked')
    if (!lists.blocked.length) panel.appendChild(h('p', 'home-empty hint', t('social.emptyBlocked')))
    return
  }
  if (tab === 'online') {
    // Yanıt bekleyen gelen istekler Çevrimiçi sekmesinin başında da görünür
    appendFriendSection(panel, 'social.incomingTitle', lists.incoming, 'incoming')
    appendFriendSection(panel, 'social.onlineTitle', lists.online, 'friend', 'online')
    if (!lists.online.length) panel.appendChild(h('p', 'home-empty hint', t(lists.all.length ? 'social.emptyOnline' : 'social.emptyFriends')))
    return
  }
  appendFriendSection(panel, 'social.onlineTitle', lists.online, 'friend', 'online')
  appendFriendSection(panel, 'people.offlineTitle', lists.offline, 'friend', 'offline')
  if (!lists.all.length) panel.appendChild(h('p', 'home-empty hint', t('social.emptyFriends')))
}

function appendFriendSection (panel, titleKey, ids, kind, part) {
  if (!ids.length) return
  const titleId = 'home-section-' + kind + (part ? '-' + part : '')
  const heading = h('h3', 'section-title home-section-title', t(titleKey, { count: ids.length }))
  heading.id = titleId
  panel.appendChild(heading)
  const list = h('ul', 'member-list friend-list')
  list.setAttribute('aria-labelledby', titleId)
  ids.forEach((id) => {
    list.appendChild(buildFriendRow(id, kind))
  })
  panel.appendChild(list)
}

// Satırın alt metni. Arkadaşta bulunduğu ses odası veya durum ve özel durum metni, isteklerde ve
// engellenende kullanıcı adının yanında açıklama.
function friendSubText (id, kind) {
  if (kind === 'incoming') return t('social.incomingSub')
  if (kind === 'outgoing') return t('social.outgoingSub')
  if (kind === 'blocked') return t('social.blockedSub')
  const status = userStatus(id)
  const room = status !== 'offline' && typeof voiceChannelOf === 'function' ? voiceChannelOf(id) : null
  if (room) return t('people.inVoice', { name: room.name })
  const custom = status !== 'offline' ? userStatusText(id) : ''
  const label = statusLabel(status)
  return custom ? t('social.statusWithText', { status: label, text: custom }) : label
}

function rowButton (className, text, label, focusKey, handler, iconName) {
  const b = button('button button-small ' + className, text, iconName)
  b.setAttribute('data-focus-key', focusKey)
  if (label) b.setAttribute('aria-label', label)
  b.addEventListener('click', handler)
  return b
}

// Kişi satırının avatar, ad ve alt satır kısmı (Arkadaşlar listeleri ve sol sütundaki istek kartları)
function personMain (id, subText, nameKey, withHandle) {
  const main = h('span', 'list-main friend-main')
  main.appendChild(personAvatar(id, 'md'))
  const text = h('span', 'list-text')
  const name = h('span', 'list-name friend-name', userDisplayName(id))
  makeUserLink(name, id)
  name.setAttribute('data-focus-key', nameKey)
  text.appendChild(name)
  const sub = h('span', 'list-sub friend-sub')
  const handle = withHandle ? userHandle(id) : ''
  if (handle) sub.appendChild(h('span', 'friend-handle', handle))
  if (subText) sub.appendChild(h('span', 'friend-sub-text', subText))
  text.appendChild(sub)
  main.appendChild(text)
  return main
}

function buildFriendRow (id, kind) {
  const li = h('li', 'list-row friend-row' + (kind === 'blocked' ? ' is-blocked' : ''))
  li.setAttribute('data-user-id', String(id))
  li.setAttribute('data-kind', kind)
  const status = userStatus(id)
  li.setAttribute('data-status', status)
  if (kind === 'friend' && status === 'offline') li.classList.add('is-offline')
  const room = kind === 'friend' && status !== 'offline' && typeof voiceChannelOf === 'function' ? voiceChannelOf(id) : null
  const main = personMain(id, friendSubText(id, kind), 'fname-' + kind + '-' + id, kind !== 'friend')
  if (room) {
    const sub = main.querySelector('.friend-sub-text')
    if (sub) {
      sub.classList.add('friend-voice-tag')
      sub.insertBefore(icon('i-speaker'), sub.firstChild)
    }
  }
  li.appendChild(main)
  const actions = h('span', 'row-actions friend-actions')
  const params = { name: userDisplayName(id) }
  if (kind === 'friend') {
    actions.appendChild(rowButton('button-secondary act-message', t('social.message'), t('social.messageLabel', params), 'msg-' + id, () => {
      openDmWith(id)
    }, 'i-chat'))
    const more = button('icon-button act-more', '', 'i-more', t('social.moreLabel', params))
    more.setAttribute('aria-haspopup', 'menu')
    more.setAttribute('aria-expanded', 'false')
    more.setAttribute('data-focus-key', 'more-' + id)
    more.addEventListener('click', () => {
      openFriendMenu(id, more)
    })
    actions.appendChild(more)
  } else if (kind === 'incoming') {
    actions.appendChild(rowButton('act-accept', t('social.accept'), t('social.acceptLabel', params), 'acc-' + id, () => {
      acceptFriend(id)
    }, 'i-check'))
    actions.appendChild(rowButton('button-secondary act-decline', t('social.decline'), t('social.declineLabel', params), 'dec-' + id, () => {
      declineFriend(id)
    }))
  } else if (kind === 'outgoing') {
    actions.appendChild(rowButton('button-secondary act-cancel', t('social.cancelRequest'), t('social.cancelRequestLabel', params), 'can-' + id, () => {
      removeFriend(id, true)
    }))
  } else if (kind === 'blocked') {
    actions.appendChild(rowButton('button-secondary act-unblock', t('social.unblock'), t('social.unblockLabel', params), 'unb-' + id, () => {
      unblockUser(id)
    }))
  }
  li.appendChild(actions)
  return li
}

// Arkadaş ekle formu. inCard: sol sütundaki kartta (alan ve tam genişlik düğme alt alta), değilse sekme panelinde.
function buildAddFriendForm (inCard) {
  const wrap = h('div', 'friend-add' + (inCard ? ' friend-add-card-body' : ''))
  if (!inCard) wrap.appendChild(h('h3', 'section-title', t('social.addTitle')))
  wrap.appendChild(h('p', inCard ? 'side-card-text friend-add-lead' : 'hint friend-add-lead', t('social.addLead')))
  const form = h('form', 'form friend-add-form')
  form.id = 'friend-add-form'
  form.noValidate = true
  form.setAttribute('autocomplete', 'off')
  const label = h('label', 'sr-only', t('social.addLabel'))
  label.setAttribute('for', 'friend-add-name')
  form.appendChild(label)
  const row = h('div', 'row friend-add-row')
  const input = h('input', 'input')
  input.id = 'friend-add-name'
  input.type = 'text'
  input.maxLength = USERNAME_MAX_INPUT
  input.setAttribute('autocapitalize', 'none')
  input.setAttribute('spellcheck', 'false')
  input.setAttribute('placeholder', t('social.addPlaceholder'))
  input.value = socialState.addText
  input.addEventListener('input', () => {
    lowercaseInput(input)
    socialState.addText = input.value
  })
  row.appendChild(input)
  const submit = button('button act-send-request' + (inCard ? ' button-wide' : ''), t('social.sendRequest'), 'i-user-plus')
  submit.type = 'submit'
  submit.id = 'friend-add-submit'
  row.appendChild(submit)
  form.appendChild(row)
  const msg = h('p', 'form-msg friend-add-msg')
  msg.id = 'friend-add-msg'
  msg.setAttribute('role', 'status')
  msg.setAttribute('aria-live', 'polite')
  msg.hidden = true
  form.appendChild(msg)
  if (socialState.addMsg) setMsg(msg, socialState.addMsg.text, socialState.addMsg.kind)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const name = cleanUsername(input.value)
    const problem = usernameProblem(name)
    if (problem) {
      socialState.addMsg = { kind: 'error', text: () => usernameProblemText(problem) }
      setMsg(msg, socialState.addMsg.text, 'error')
      return
    }
    submit.disabled = true
    const result = await sendFriendRequest({ name: name }, true)
    submit.disabled = false
    socialState.addMsg = { kind: result.ok ? 'ok' : 'error', text: result.text }
    if (result.ok) {
      socialState.addText = ''
      input.value = ''
    }
    const current = byId('friend-add-msg')
    if (current) setMsg(current, result.text, result.ok ? 'ok' : 'error')
    const field = byId('friend-add-name')
    if (field) focusNode(field)
  })
  wrap.appendChild(form)
  return wrap
}

// Sol bilgi sütunundaki kişisel kartlar (KONSEPT 6.3). Özel istasyonunda gelen arkadaşlık istekleri (Kabul et,
// Reddet), Arkadaşlar istasyonunda Arkadaş ekle formu (yalnızca sol sütun sayfada görünürken) ve gönderilen
// istekler (İsteği geri al). Kartlar #dm-section'dan sonra eklenir, görünürlükleri görünüm moduna bağlıdır.
const REQUEST_CARD_MAX = 3
let addCardKey = ''

function personalCard (id, titleId) {
  let card = byId(id)
  if (!card) {
    const scroll = el.infoCol ? el.infoCol.querySelector('.side-scroll') : null
    if (!scroll) return null
    card = h('section', 'side-card people-card ' + id)
    card.id = id
    card.setAttribute('aria-labelledby', titleId)
    card.hidden = true
    const anchor = byId('hints-card')
    scroll.insertBefore(card, anchor && anchor.parentNode === scroll ? anchor : null)
  }
  return card
}

function cardHead (card, titleId, text) {
  const title = h('h3', 'kicker', text)
  title.id = titleId
  card.appendChild(title)
}

function renderPersonalCards () {
  const view = state.inApp ? socialState.view : 'channel'
  const lists = state.me ? homeLists() : { incoming: [], outgoing: [] }
  const req = personalCard('req-card', 'req-card-title')
  const add = personalCard('friend-add-card', 'friend-add-card-title')
  const out = personalCard('outgoing-card', 'outgoing-card-title')
  if (!req || !add || !out) return
  // Özel istasyonu: gelen istekler
  const reqFocus = activeFocusKey(req)
  clear(req)
  req.hidden = !(view === 'dm' && lists.incoming.length)
  if (!req.hidden) {
    cardHead(req, 'req-card-title', t('people.requestsTitle', { count: lists.incoming.length }))
    lists.incoming.slice(0, REQUEST_CARD_MAX).forEach((id) => {
      const params = { name: userDisplayName(id) }
      const row = h('div', 'req-row')
      row.setAttribute('data-user-id', String(id))
      row.appendChild(personMain(id, t('social.incomingSub'), 'req-name-' + id, true))
      req.appendChild(row)
      const actions = h('div', 'btn-row req-actions')
      actions.setAttribute('data-user-id', String(id))
      actions.appendChild(rowButton('req-accept', t('social.accept'), t('social.acceptLabel', params), 'req-acc-' + id, () => {
        acceptFriend(id)
      }, 'i-check'))
      actions.appendChild(rowButton('button-secondary req-decline', t('social.decline'), t('social.declineLabel', params), 'req-dec-' + id, () => {
        declineFriend(id)
      }))
      req.appendChild(actions)
    })
    if (lists.incoming.length > REQUEST_CARD_MAX) {
      const more = button('link-button req-more', t('people.allRequests', { count: lists.incoming.length }), 'i-users')
      more.setAttribute('data-focus-key', 'req-more')
      more.addEventListener('click', () => {
        showHome('pending', { focus: true })
      })
      req.appendChild(more)
    }
    restoreFocusKey(req, reqFocus)
  }
  // Arkadaşlar istasyonu, geniş ekran: Arkadaş ekle formu (dil değişmedikçe yeniden kurulmaz, yazılan korunur)
  const addVisible = view === 'home' && homeAddInline()
  add.hidden = !addVisible
  const key = window.I18N ? window.I18N.lang : ''
  if (!addVisible) {
    if (add.firstChild) clear(add)
    addCardKey = ''
  } else if (addCardKey !== key || !add.firstChild) {
    const keepInput = document.activeElement && document.activeElement.id === 'friend-add-name'
    addCardKey = key
    clear(add)
    cardHead(add, 'friend-add-card-title', t('social.addTitle'))
    add.appendChild(buildAddFriendForm(true))
    if (keepInput) focusNode(byId('friend-add-name'))
  }
  // Arkadaşlar istasyonu: gönderilen istekler
  const outFocus = activeFocusKey(out)
  clear(out)
  out.hidden = !(view === 'home' && homeAddInline() && lists.outgoing.length)
  if (!out.hidden) {
    cardHead(out, 'outgoing-card-title', t('people.outgoingTitle', { count: lists.outgoing.length }))
    lists.outgoing.forEach((id) => {
      const params = { name: userDisplayName(id) }
      const row = h('div', 'req-row')
      row.setAttribute('data-user-id', String(id))
      row.appendChild(personMain(id, t('people.outgoingWaiting'), 'out-name-' + id, false))
      out.appendChild(row)
      const cancel = rowButton('button-secondary button-wide req-cancel', t('people.cancelRequest'), t('social.cancelRequestLabel', params), 'out-can-' + id, () => {
        removeFriend(id, true)
      })
      cancel.setAttribute('data-user-id', String(id))
      out.appendChild(cancel)
    })
    restoreFocusKey(out, outFocus)
  }
}

// Pencere 1280 px sınırını geçince Arkadaş ekle formu sekme paneli ile sol sütun arasında yer değiştirir
function onSocialResize () {
  const inline = homeAddInline()
  if (inline === socialState.inline) return
  const hadFocus = document.activeElement && document.activeElement.id === 'friend-add-name'
  socialState.inline = inline
  if (!state.inApp) return
  if (socialState.view === 'home') renderHomeView()
  renderPersonalCards()
  if (hadFocus) {
    const input = byId('friend-add-name')
    if (input) focusNode(input)
  }
}

// Arkadaş satırındaki "..." menüsü

function friendMenuEl () {
  let menu = byId('social-menu')
  if (!menu) {
    menu = h('div', 'popup-menu social-menu')
    menu.id = 'social-menu'
    menu.setAttribute('role', 'menu')
    menu.hidden = true
    menu.addEventListener('keydown', onPopupMenuKey)
    document.body.appendChild(menu)
  }
  return menu
}

function openFriendMenu (userId, trigger) {
  const existing = findLayer('social-menu')
  if (existing) {
    const same = sameId(socialState.menuUserId, userId)
    closeLayer(existing, false)
    if (same) return
  }
  const menu = friendMenuEl()
  clear(menu)
  menu.setAttribute('aria-label', t('social.moreLabel', { name: userDisplayName(userId) }))
  const add = (key, iconName, danger, handler) => {
    const item = h('button', 'menu-item' + (danger ? ' menu-danger' : ''))
    item.type = 'button'
    item.setAttribute('role', 'menuitem')
    item.appendChild(icon(iconName))
    item.appendChild(h('span', '', t(key)))
    item.addEventListener('click', () => {
      const layer = findLayer('social-menu')
      if (layer) closeLayer(layer, false)
      handler()
    })
    menu.appendChild(item)
    return item
  }
  add('social.removeFriend', 'i-close', false, () => {
    removeFriend(userId)
  }).classList.add('menu-unfriend')
  add('social.block', 'i-alert', true, () => {
    blockUser(userId)
  }).classList.add('menu-block')
  socialState.menuUserId = userId
  menu.hidden = false
  trigger.setAttribute('aria-expanded', 'true')
  positionPopup(menu, trigger)
  openLayer({
    name: 'social-menu',
    el: menu,
    trigger: trigger,
    level: 2,
    outside: true,
    closeOnFocusOut: true,
    onClose: () => {
      menu.hidden = true
      trigger.setAttribute('aria-expanded', 'false')
      socialState.menuUserId = null
    }
  })
}

// Arkadaşlık ve engelleme işlemleri. Sunucu yanıtından sonra yerel liste hemen güncellenir,
// kişiye özel meta poll ile ayrıca gelir.

function updatePrivateLocal (mutate) {
  const p = priv()
  mutate(p)
  socialState.priv = p
  socialRender()
  refreshProfileCard()
}

function withoutId (list, userId) {
  return list.filter((id) => !sameId(id, userId))
}

function withId (list, userId) {
  return inList(list, userId) ? list : list.concat([userId])
}

// target: { name } veya { userId }. Sonuç { ok, text } (text dil değişince yeniden üretilir).
async function sendFriendRequest (target, quiet) {
  const res = await api('POST', '/api/friends/request', target)
  let result = null
  if (res.status === 200 && res.data) {
    const uid = res.data.userId
    const friends = res.data.state === 'friends'
    updatePrivateLocal((p) => {
      if (friends) {
        p.friends = withId(p.friends, uid)
        p.incoming = withoutId(p.incoming, uid)
        p.outgoing = withoutId(p.outgoing, uid)
      } else {
        p.outgoing = withId(p.outgoing, uid)
      }
    })
    profilesEnsure([uid])
    result = { ok: true, text: () => t(friends ? 'social.nowFriends' : 'social.requestSentTo', { name: userDisplayName(uid) }) }
  } else {
    result = { ok: false, text: () => errorText(res, t('social.requestFailed'), { user_not_found: t('social.userNotFound'), rate_limited: t('social.rateLimited') }) }
  }
  if (!quiet) toast(result.text, result.ok ? 'ok' : 'error')
  return result
}

async function acceptFriend (userId) {
  const res = await api('POST', '/api/friends/accept', { userId: Number(userId) })
  if (res.status === 200) {
    updatePrivateLocal((p) => {
      p.incoming = withoutId(p.incoming, userId)
      p.friends = withId(p.friends, userId)
    })
    toast(() => t('social.nowFriends', { name: userDisplayName(userId) }), 'ok')
    return true
  }
  toast(() => errorText(res, t('social.actionFailed')), 'error')
  return false
}

async function declineFriend (userId) {
  const res = await api('POST', '/api/friends/decline', { userId: Number(userId) })
  if (res.status === 200) {
    updatePrivateLocal((p) => {
      p.incoming = withoutId(p.incoming, userId)
    })
    return true
  }
  toast(() => errorText(res, t('social.actionFailed')), 'error')
  return false
}

// Arkadaşlığı kaldırır veya giden isteği iptal eder
async function removeFriend (userId, cancelOnly) {
  const friend = isFriend(userId)
  if (friend && !cancelOnly && !window.confirm(t('social.removeConfirm', { name: userDisplayName(userId) }))) return false
  const res = await api('POST', '/api/friends/remove', { userId: Number(userId) })
  if (res.status === 200) {
    updatePrivateLocal((p) => {
      p.friends = withoutId(p.friends, userId)
      p.outgoing = withoutId(p.outgoing, userId)
    })
    return true
  }
  toast(() => errorText(res, t('social.actionFailed')), 'error')
  return false
}

async function blockUser (userId) {
  if (!window.confirm(t('social.blockConfirm', { name: userDisplayName(userId) }))) return false
  const res = await api('POST', '/api/blocks/add', { userId: Number(userId) })
  if (res.status === 200) {
    updatePrivateLocal((p) => {
      p.blocked = withId(p.blocked, userId)
      p.friends = withoutId(p.friends, userId)
      p.incoming = withoutId(p.incoming, userId)
      p.outgoing = withoutId(p.outgoing, userId)
    })
    autoMuteBlocked()
    if (!isDmChannel(state.channelId)) refreshAllMessages()
    toast(() => t('social.blocked', { name: userDisplayName(userId) }), 'ok')
    return true
  }
  toast(() => errorText(res, t('social.actionFailed')), 'error')
  return false
}

async function unblockUser (userId) {
  const res = await api('POST', '/api/blocks/remove', { userId: Number(userId) })
  if (res.status === 200) {
    updatePrivateLocal((p) => {
      p.blocked = withoutId(p.blocked, userId)
    })
    autoMuteBlocked()
    if (!isDmChannel(state.channelId)) refreshAllMessages()
    toast(() => t('social.unblocked', { name: userDisplayName(userId) }), 'ok')
    return true
  }
  toast(() => errorText(res, t('social.actionFailed')), 'error')
  return false
}

// Sunucu üyelerinden özel mesaj kabul etme ayarı (Ayarlar > Gizlilik ve güvenlik kullanır)
async function setAllowMemberDms (value) {
  const res = await api('POST', '/api/me/settings', { allowMemberDms: value === true })
  if (res.status === 200) {
    updatePrivateLocal((p) => {
      p.allowMemberDms = value === true
    })
    return { ok: true }
  }
  return { ok: false, error: () => errorText(res, t('social.actionFailed')) }
}

// Yeni gelen arkadaşlık istekleri: sayfa gizliyse masaüstü bildirimi, görünürse kısa bildirim.
// Rahatsız etmeyin durumunda ikisi de verilmez.
function notifyNewRequests (incoming) {
  const seen = socialState.incomingSeen
  const now = new Set(incoming.map(String))
  socialState.incomingSeen = now
  if (!seen || !state.inApp) return
  const fresh = incoming.filter((id) => !seen.has(String(id)))
  if (!fresh.length || myChosenStatus() === 'dnd') return
  const id = fresh[0]
  profilesEnsure([id])
  if (document.hidden) {
    showNotification(t('social.requestNotifyTitle'), t('social.requestNotifyBody', { name: userDisplayName(id) }), 'telsiz-friend', () => {
      showHome('pending')
    })
  } else {
    toast(() => t('social.requestNotifyBody', { name: userDisplayName(id) }))
  }
}

// Engellenen kişiler seste yerelde otomatik susturulur, engel kalkınca yalnızca otomatik
// susturulanların sesi açılır.
function voiceIdArg (userId) {
  return isNaN(Number(userId)) ? userId : Number(userId)
}

function autoMuteBlocked () {
  if (!voice || !state.me) return
  const key = userKey('blockMuted')
  const muted = storeGetJson(key, {})
  const blocked = priv().blocked.map(String)
  const s = snap()
  const peers = s.peers || {}
  let changed = false
  blocked.forEach((id) => {
    if (muted[id]) return
    const peer = peers[id]
    if (peer && peer.localMute) return
    try {
      voice.setPeerLocalMute(voiceIdArg(id), true)
      muted[id] = true
      changed = true
    } catch (err) {
      // Ses modülü hazır değil
    }
  })
  Object.keys(muted).forEach((id) => {
    if (blocked.indexOf(id) !== -1) return
    try {
      voice.setPeerLocalMute(voiceIdArg(id), false)
    } catch (err) {
      // Ses modülü hazır değil
    }
    delete muted[id]
    changed = true
  })
  if (changed) storeSetJson(key, muted)
}

// Yazı kanallarında engellenen kişinin mesajı katlanır, "Göster" ile açılır
function isFoldedMessage (m) {
  if (!m || isDmChannel(m.channelId)) return false
  if (state.me && sameId(m.authorId, state.me.id)) return false
  return isBlocked(m.authorId) && !socialState.expanded.has(String(m.id))
}

function buildBlockedNode (m) {
  const node = h('div', 'msg msg-blocked is-blocked')
  node.setAttribute('data-id', String(m.id))
  node.appendChild(h('div', 'msg-gutter'))
  const content = h('div', 'msg-content')
  const row = h('div', 'msg-text msg-notice msg-blocked-row')
  row.appendChild(icon('i-alert'))
  row.appendChild(h('span', 'msg-blocked-text', t('social.blockedMessage')))
  const show = button('button button-ghost button-small msg-blocked-show', t('social.showMessage'))
  show.addEventListener('click', () => {
    socialState.expanded.add(String(m.id))
    replaceMessage(m)
  })
  row.appendChild(show)
  content.appendChild(row)
  node.appendChild(content)
  return node
}

// Ortak bildirim gösterimi (masaüstü bildirimi açık ve izinliyse)
function showNotification (title, body, tag, onClick) {
  if (!notificationsAllowedNow()) return
  try {
    const n = new window.Notification(title, { body: body, tag: tag })
    n.onclick = () => {
      try {
        window.focus()
      } catch (err) {
        // Pencere öne alınamadı
      }
      if (typeof onClick === 'function') onClick()
      n.close()
    }
  } catch (err) {
    // Bazı mobil tarayıcılar yalnızca service worker üzerinden bildirim gösterir
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then((reg) => {
        if (reg && typeof reg.showNotification === 'function') reg.showNotification(title, { body: body, tag: tag })
      }).catch(() => {})
    }
  }
}
