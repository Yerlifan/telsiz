'use strict'

// Mesaj çözme (yazı kanalında grup anahtarı, özel mesajda kişisel anahtarlar), yalnızca emoji algılama,
// mesaj düğümleri (engellenen kişinin mesajı katlanır), sayfalama, mesaj menüsü, düzenleme ve silme.

// Mesaj çözme. Sonuçlar mesaj gövdesine göre önbelleğe alınır (arama dizini önbelleksiz sürümü kullanır).

const decryptCache = new Map()
const JUMP_LIMIT = 100
const HIGHLIGHT_MS = 4000

function decryptMessage (m) {
  const cached = decryptCache.get(String(m.id))
  if (cached && cached.body === m.body) return cached.result
  const result = decryptMessageRaw(m)
  decryptCache.set(String(m.id), { body: m.body, result: result })
  return result
}

function decryptMessageRaw (m) {
  let result = { state: 'no_key' }
  if (cryptoReady() && isDmMessage(m)) {
    try {
      result = decryptDmMessage(m)
    } catch (err) {
      result = { state: 'unverified' }
    }
  } else if (cryptoReady()) {
    let opened = null
    try {
      opened = window.E2EE.openJson(m.body)
    } catch (err) {
      opened = { ok: false, reason: 'bad_data' }
    }
    if (!opened || opened.ok !== true) {
      const reason = opened ? opened.reason : 'bad_data'
      result = { state: reason === 'no_key' ? 'no_key' : reason === 'bad_format' ? 'bad_format' : 'unverified' }
    } else {
      const v = opened.value
      if (!v || typeof v !== 'object' || v.v !== 1 || !sameId(v.a, m.authorId) || !sameId(v.c, m.channelId)) {
        result = { state: 'unverified' }
      } else {
        result = { state: 'ok', text: typeof v.t === 'string' ? v.t : '', files: normalizeFiles(v.f, m), dj: cleanDjNotice(v.d) }
      }
    }
  }
  return result
}

// Telsiz DJ duyurusu (23-dj.js): { op: 'add', src: 'yt', vid } veya ekli ses dosyası için { op: 'add', src: 'file' }.
// Eski istemciler bu alanı bilmez ve t alanındaki komut metnini gösterir.
function cleanDjNotice (d) {
  if (!d || typeof d !== 'object' || d.op !== 'add') return null
  if (d.src === 'yt' && typeof d.vid === 'string' && /^[A-Za-z0-9_-]{11}$/.test(d.vid)) return { op: 'add', src: 'yt', vid: d.vid }
  if (d.src === 'file') return { op: 'add', src: 'file' }
  return null
}

// Duyuru satırı: nota simgesi, sabit metin ve YouTube parçasında kimlikten kurulan bağlantı
function buildDjNotice (d) {
  const line = h('div', 'msg-text msg-dj')
  line.appendChild(icon('i-music'))
  line.appendChild(h('span', 'msg-dj-text', t(d.src === 'yt' ? 'dj.notice.youtube' : 'dj.notice.file')))
  if (d.src === 'yt') {
    const a = h('a', 'msg-dj-link', t('dj.notice.openYoutube'))
    a.href = 'https://www.youtube.com/watch?v=' + d.vid
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    line.appendChild(a)
  }
  return line
}

function normalizeFiles (list, m) {
  if (!Array.isArray(list)) return []
  const allowed = Array.isArray(m.uploads) ? m.uploads.map(String) : null
  const out = []
  list.slice(0, 20).forEach((f) => {
    if (!f || typeof f !== 'object') return
    if (typeof f.u !== 'string' || !UPLOAD_ID_RE.test(f.u)) return
    if (allowed && allowed.indexOf(f.u) === -1) return
    if (typeof f.k !== 'string' || !B64URL_RE.test(f.k) || typeof f.n !== 'string' || !B64URL_RE.test(f.n)) return
    const mime = typeof f.m === 'string' ? f.m.slice(0, 100) : ''
    let kind = f.kind === 'image' || f.kind === 'file' ? f.kind : null
    if (!kind) kind = IMAGE_TYPES.indexOf(mime) !== -1 ? 'image' : 'file'
    const dim = (value) => (typeof value === 'number' && isFinite(value) && value > 0 && value < 100000 ? Math.round(value) : 0)
    out.push({
      u: f.u,
      k: f.k,
      n: f.n,
      kind: kind,
      name: cleanFileName(typeof f.name === 'string' ? f.name : ''),
      m: mime,
      s: typeof f.s === 'number' && f.s >= 0 ? f.s : 0,
      w: dim(f.w),
      h: dim(f.h)
    })
  })
  return out
}

// Yalnızca emojiden oluşan mesaj algılama. \p{} kullanılmaz.

// Başlangıç ve bitiş çiftleri halinde düz liste
const EMOJI_RANGES = [
  0x1f000, 0x1faff, 0x2600, 0x27bf, 0x2300, 0x23ff, 0x2b00, 0x2bff,
  0x3030, 0x3030, 0x303d, 0x303d, 0x3297, 0x3297, 0x3299, 0x3299,
  0x00a9, 0x00a9, 0x00ae, 0x00ae, 0x203c, 0x203c, 0x2049, 0x2049,
  0x2122, 0x2122, 0x2139, 0x2139, 0x2194, 0x21aa, 0xfe0f, 0xfe0f,
  0x200d, 0x200d, 0x20e3, 0x20e3, 0xe0020, 0xe007f
]

function inEmojiRange (cp) {
  let i = 0
  while (i < EMOJI_RANGES.length) {
    if (cp >= EMOJI_RANGES[i] && cp <= EMOJI_RANGES[i + 1]) return true
    i += 2
  }
  return false
}

function emojiCount (text) {
  const cps = codePoints(text).map((ch) => ch.codePointAt(0))
  let count = 0
  let joinNext = false
  let riOpen = false
  let i = 0
  while (i < cps.length) {
    const cp = cps[i]
    if (cp === 0x20 || cp === 0x0a || cp === 0x0d || cp === 0x09 || cp === 0xa0) {
      joinNext = false
      riOpen = false
      i += 1
      continue
    }
    if ((cp >= 0x30 && cp <= 0x39) || cp === 0x23 || cp === 0x2a) {
      if (cps[i + 1] === 0xfe0f && cps[i + 2] === 0x20e3) {
        count += 1
        i += 3
        continue
      }
      return 0
    }
    if (!inEmojiRange(cp)) return 0
    i += 1
    if (cp === 0xfe0f || cp === 0x20e3 || (cp >= 0xe0020 && cp <= 0xe007f) || (cp >= 0x1f3fb && cp <= 0x1f3ff)) continue
    if (cp === 0x200d) {
      joinNext = true
      continue
    }
    if (joinNext) {
      joinNext = false
      continue
    }
    if (cp >= 0x1f1e6 && cp <= 0x1f1ff) {
      if (riOpen) {
        riOpen = false
        continue
      }
      riOpen = true
      count += 1
      continue
    }
    riOpen = false
    count += 1
  }
  return count
}

function isJumbo (text) {
  const n = emojiCount(text)
  return n >= 1 && n <= 27
}

// Mesaj düğümü

function canEdit (m) {
  return Boolean(state.me && sameId(m.authorId, state.me.id))
}

// Özel mesajda yalnızca kendi mesajı silinebilir (sahip ve yöneticiler dahil)
function canDelete (m) {
  return canEdit(m) || (isAdmin() && !isDmChannel(m.channelId))
}

function messageNoticeText (stateName) {
  if (stateName === 'no_key') return t('msg.noKey')
  if (stateName === 'bad_format') return t('msg.badFormat')
  if (stateName === 'dm_locked') return t('dm.msgLocked')
  if (stateName === 'dm_unverified') return t('dm.msgUnverified')
  if (stateName === 'dm_old_key') return t('dm.oldKey')
  return t('msg.unverified')
}

function buildMessageNode (m) {
  if (isFoldedMessage(m)) return buildBlockedNode(m)
  const node = h('div', 'msg')
  node.setAttribute('data-id', String(m.id))
  node.setAttribute('data-author-id', String(m.authorId))
  const mine = state.me && sameId(m.authorId, state.me.id)
  if (mine) node.classList.add('msg-own', 'is-own')
  const name = userDisplayName(m.authorId)
  const role = userRole(m.authorId)

  const gutter = h('div', 'msg-gutter')
  const av = personAvatar(m.authorId, 'md')
  av.classList.add('msg-avatar')
  makeUserLink(av, m.authorId)
  av.removeAttribute('aria-hidden')
  av.setAttribute('aria-label', t('profile.openCard', { name: name }))
  gutter.appendChild(av)
  const hoverTime = h('span', 'msg-hover-time', formatClock(m.createdAt))
  hoverTime.setAttribute('aria-hidden', 'true')
  hoverTime.title = formatLong(m.createdAt)
  gutter.appendChild(hoverTime)
  node.appendChild(gutter)

  const content = h('div', 'msg-content')
  const head = h('div', 'msg-head')
  const author = h('span', 'msg-author', name)
  makeUserLink(author, m.authorId)
  head.appendChild(author)
  const badge = roleBadge(role)
  if (badge) head.appendChild(badge)
  const time = h('span', 'msg-time', formatShort(m.createdAt))
  time.title = formatLong(m.createdAt)
  head.appendChild(time)
  content.appendChild(head)
  const sr = h('span', 'sr-only msg-sr', t('msg.srHead', { name: name, time: formatShort(m.createdAt) }))
  content.appendChild(sr)

  const result = decryptMessage(m)
  const body = h('div', 'msg-body')
  if (result.state === 'ok') {
    if (result.dj) {
      body.appendChild(buildDjNotice(result.dj))
    } else if (result.text) {
      const text = h('div', 'msg-text')
      // Geçerli anmalar rozet olarak çizilir (18-mentions.js), metin yalnızca textContent ile
      if (typeof renderMentionText === 'function') renderMentionText(text, result.text, m)
      else text.textContent = result.text
      if (isJumbo(result.text)) text.classList.add('jumbo')
      body.appendChild(text)
      if (typeof messageMentionsMe === 'function' && messageMentionsMe(m, result.text)) {
        node.classList.add('is-mentioned')
        content.appendChild(h('span', 'sr-only msg-mention-sr', t('mention.mentionsYou')))
      }
    }
    if (result.files.length) {
      const attachments = buildAttachments(result.files, m)
      // Ses dosyası kartının yanında "DJ'de çal" düğmesi (23-dj.js)
      if (typeof djDecorateAttachments === 'function') djDecorateAttachments(attachments, result.files, m)
      body.appendChild(attachments)
    }
  } else {
    const notice = messageNoticeText(result.state)
    const text = h('div', 'msg-text msg-notice')
    text.setAttribute('data-state', result.state)
    text.appendChild(icon(result.state === 'no_key' || result.state === 'dm_locked' || result.state === 'dm_old_key' || result.state === 'dm_unverified' ? 'i-lock' : 'i-alert'))
    text.appendChild(h('span', '', notice))
    body.appendChild(text)
  }
  if (m.editedAt) {
    const edited = h('span', 'msg-edited', t('msg.edited'))
    edited.title = t('msg.editedAt', { date: formatLong(m.editedAt) })
    const target = body.querySelector('.msg-text') || body
    target.appendChild(document.createTextNode(' '))
    target.appendChild(edited)
  }
  content.appendChild(body)
  node.appendChild(content)

  if (canEdit(m) || canDelete(m)) {
    const actions = h('div', 'msg-actions')
    if (canEdit(m) && result.state === 'ok' && !result.dj) {
      const edit = button('msg-action msg-quick', '', 'i-edit', t('msg.edit'))
      edit.tabIndex = -1
      edit.addEventListener('click', () => {
        startEdit(m.id)
      })
      actions.appendChild(edit)
    }
    if (canDelete(m)) {
      const del = button('msg-action msg-quick msg-action-danger', '', 'i-trash', t('msg.delete'))
      del.tabIndex = -1
      del.addEventListener('click', () => {
        confirmDelete(m.id)
      })
      actions.appendChild(del)
    }
    const more = button('msg-action msg-more', '', 'i-more', t('msg.actions'))
    more.setAttribute('aria-haspopup', 'menu')
    more.setAttribute('aria-expanded', 'false')
    more.addEventListener('click', () => {
      openMessageMenu(m.id, more)
    })
    actions.appendChild(more)
    node.appendChild(actions)
  }
  return node
}

// Gruplama: aynı yazar, 5 dakika içinde ve aynı gün ise başlıksız devam eder.
function startsGroup (m, prev) {
  if (!prev) return true
  if (!sameId(prev.authorId, m.authorId)) return true
  const a = Number(prev.createdAt) || 0
  const b = Number(m.createdAt) || 0
  if (b - a > GROUP_WINDOW_MS || b < a) return true
  return !sameDay(toDate(a), toDate(b))
}

function regroup () {
  let prev = null
  state.messages.forEach((m) => {
    const node = state.nodes.get(String(m.id))
    if (node) node.classList.toggle('msg-first', startsGroup(m, prev))
    prev = m
  })
}

function validMessage (m) {
  return Boolean(m && typeof m === 'object' && m.id !== undefined && m.id !== null && typeof m.body === 'string')
}

function indexOfMessage (id) {
  const key = String(id)
  let i = state.messages.length - 1
  while (i >= 0) {
    if (String(state.messages[i].id) === key) return i
    i -= 1
  }
  return -1
}

function renderAllMessages () {
  clear(el.messageList)
  state.nodes = new Map()
  const frag = document.createDocumentFragment()
  state.messages.forEach((m) => {
    const node = buildMessageNode(m)
    state.nodes.set(String(m.id), node)
    frag.appendChild(node)
  })
  el.messageList.appendChild(frag)
  regroup()
  renderListChrome()
}

function renderListChrome () {
  el.loadOlderWrap.hidden = !state.hasMore || state.loading
  el.channelStart.hidden = state.hasMore || state.loading || !state.channelId
  renderJumpBar()
}

function refreshAllMessages () {
  if (!state.inApp || state.loading) return
  const stick = isNearBottom()
  const top = el.messages.scrollTop
  decryptCache.clear()
  cancelEdit()
  renderAllMessages()
  if (stick) scrollToBottom()
  else el.messages.scrollTop = top
}

// Anma içeren mesajlar yeniden çizilir (kullanıcı adı veya rol değişince). Düzenlenen mesaja dokunulmaz.
function refreshMentionMessages () {
  if (!state.inApp || state.loading) return
  state.messages.slice().forEach((m) => {
    if (sameId(state.editingId, m.id)) return
    const result = decryptMessage(m)
    if (result.state === 'ok' && result.text && result.text.indexOf('@') !== -1) replaceMessage(m)
  })
}

function insertMessage (m, opts) {
  if (!validMessage(m) || !sameId(m.channelId, state.channelId)) return
  const options = opts || {}
  if (indexOfMessage(m.id) !== -1) {
    replaceMessage(m)
    return
  }
  // Aramadan gelinen eski bir bölüm görüntüleniyorsa yeni mesaj listeye eklenmez, şerit uyarır
  if (state.hasNewer) {
    state.newWhileOlder = true
    renderJumpBar()
    return
  }
  const stick = isNearBottom()
  let index = state.messages.length
  while (index > 0 && Number(state.messages[index - 1].id) > Number(m.id)) index -= 1
  state.messages.splice(index, 0, m)
  const node = buildMessageNode(m)
  state.nodes.set(String(m.id), node)
  const next = state.messages[index + 1]
  const nextNode = next ? state.nodes.get(String(next.id)) : null
  el.messageList.insertBefore(node, nextNode || null)
  regroup()
  renderListChrome()
  if (options.own || stick) {
    trimRendered()
    scrollToBottom()
  }
}

function replaceMessage (m) {
  if (!validMessage(m)) return
  const index = indexOfMessage(m.id)
  if (index === -1) return
  if (sameId(state.editingId, m.id)) state.editingId = null
  state.messages[index] = m
  decryptCache.delete(String(m.id))
  const old = state.nodes.get(String(m.id))
  const node = buildMessageNode(m)
  state.nodes.set(String(m.id), node)
  if (old && old.parentNode) {
    const hadFocus = old.contains(document.activeElement)
    old.parentNode.replaceChild(node, old)
    if (hadFocus) {
      const more = node.querySelector('.msg-more')
      if (more) focusNode(more)
    }
  }
  regroup()
}

function removeMessage (id) {
  const index = indexOfMessage(id)
  if (index === -1) return
  if (sameId(state.editingId, id)) state.editingId = null
  if (sameId(state.menuMessageId, id)) closeMessageMenu()
  state.messages.splice(index, 1)
  decryptCache.delete(String(id))
  const node = state.nodes.get(String(id))
  state.nodes.delete(String(id))
  if (node && node.parentNode) {
    const hadFocus = node.contains(document.activeElement)
    node.parentNode.removeChild(node)
    if (hadFocus) focusNode(el.messages)
  }
  regroup()
}

// Görüntülenen mesaj sayısını sınırlar. En eskiler düşer, sonra yeniden yüklenebilir.
function trimRendered () {
  if (state.messages.length <= MAX_RENDERED) return
  const drop = state.messages.length - TRIM_TO
  const removed = state.messages.splice(0, drop)
  removed.forEach((m) => {
    const node = state.nodes.get(String(m.id))
    state.nodes.delete(String(m.id))
    decryptCache.delete(String(m.id))
    if (node && node.parentNode) node.parentNode.removeChild(node)
  })
  state.hasMore = true
  regroup()
  renderListChrome()
}

// Kaydırma. Kullanıcı alttaysa düzen değişikliklerinde (şerit, ekler, pencere boyutu) altta kalınır.

let stickBottom = true

function isNearBottom () {
  const box = el.messages
  return box.scrollHeight - box.scrollTop - box.clientHeight <= STICK_PX
}

function scrollToBottom () {
  el.messages.scrollTop = el.messages.scrollHeight
  stickBottom = true
}

function onMessagesScroll () {
  stickBottom = isNearBottom()
  if (state.hasNewer && stickBottom) loadNewer()
}

function keepBottom () {
  if (stickBottom && state.inApp && !state.hasNewer) scrollToBottom()
}

function observeMessagesSize () {
  if (typeof window.ResizeObserver !== 'function') return
  try {
    const observer = new window.ResizeObserver(keepBottom)
    observer.observe(el.messages)
  } catch (err) {
    // Pencere boyutu olayı yedek olarak kullanılır
  }
}

// Mesaj akışının durumları (KONSEPT 6.4): yükleniyor (üç iskelet satır görünür, "Mesajlar yükleniyor"
// metni yalnızca ekran okuyucuya), hata (sütun ortasında açıklama ve Tekrar dene) ve olağan akış.
// İskelet satırlar bir kez kurulur ve süsleme olduğu için ekran okuyuculardan gizlidir.

let messagesSkeleton = null

function messagesSkeletonEl () {
  if (messagesSkeleton || !el.messages) return messagesSkeleton
  messagesSkeleton = h('div', 'messages-skeleton')
  messagesSkeleton.setAttribute('aria-hidden', 'true')
  messagesSkeleton.hidden = true
  const sizes = ['wide', 'mid', 'short']
  sizes.forEach((size) => {
    const row = h('div', 'msg-skeleton msg-skeleton-' + size)
    row.appendChild(h('span', 'msg-skeleton-avatar'))
    const lines = h('span', 'msg-skeleton-lines')
    lines.appendChild(h('span', 'msg-skeleton-line msg-skeleton-name'))
    lines.appendChild(h('span', 'msg-skeleton-line msg-skeleton-text'))
    row.appendChild(lines)
    messagesSkeleton.appendChild(row)
  })
  el.messages.insertBefore(messagesSkeleton, el.messagesStatus || null)
  return messagesSkeleton
}

function setMessagesView (kind, res) {
  const box = el.messages
  if (!box) return
  box.classList.toggle('is-loading', kind === 'loading')
  box.classList.toggle('is-error', kind === 'error')
  const skeleton = messagesSkeletonEl()
  if (skeleton) skeleton.hidden = kind !== 'loading'
  if (kind === 'loading') setMsg(el.messagesStatus, () => t('messages.loading'))
  else if (kind === 'error') setMsg(el.messagesStatus, () => errorText(res, t('messages.loadFailed')), 'error')
  else setMsg(el.messagesStatus, '')
  el.messagesStatus.classList.toggle('is-loading', kind === 'loading')
  el.messagesRetryWrap.hidden = kind !== 'error'
}

// Kanal mesajlarını yükleme ve sayfalama

async function loadChannel () {
  const channelId = state.channelId
  if (!channelId) return
  socialOnChannelLoad(channelId)
  // Aramadan gelindiyse mesaj bağlamıyla (around) yüklenir
  const jump = state.pendingJump && sameId(state.pendingJump.channelId, channelId) ? state.pendingJump : null
  state.pendingJump = null
  state.loadGen += 1
  const gen = state.loadGen
  state.loading = true
  state.pendingEvents = []
  state.messages = []
  state.hasMore = false
  state.hasNewer = false
  state.newWhileOlder = false
  state.loadingNewer = false
  state.nodes = new Map()
  decryptCache.clear()
  state.editingId = null
  clear(el.messageList)
  setMessagesView('loading')
  renderListChrome()
  chatPlusOnChannelLoad(channelId)
  const query = jump ? '&around=' + encodeURIComponent(jump.messageId) + '&limit=' + JUMP_LIMIT : '&limit=' + PAGE_SIZE
  const res = await api('GET', '/api/messages?channel=' + encodeURIComponent(channelId) + query)
  if (gen !== state.loadGen || !sameId(channelId, state.channelId)) return
  state.loading = false
  if (res.status !== 200 || !res.data || !Array.isArray(res.data.messages)) {
    setMessagesView('error', res)
    state.pendingEvents = []
    renderListChrome()
    el.channelStart.hidden = true
    return
  }
  setMessagesView('')
  state.messages = res.data.messages.filter(validMessage).sort((a, b) => Number(a.id) - Number(b.id))
  state.hasMore = res.data.hasMore === true
  state.hasNewer = Boolean(jump) && res.data.hasNewer === true
  const pending = state.pendingEvents
  state.pendingEvents = []
  pending.forEach((ev) => {
    if (ev.type === 'msg' && ev.message && state.hasNewer) {
      state.newWhileOlder = true
    } else if (ev.type === 'msg' && ev.message && indexOfMessage(ev.message.id) === -1) {
      const last = state.messages[state.messages.length - 1]
      if (!last || Number(ev.message.id) > Number(last.id)) state.messages.push(ev.message)
    } else if (ev.type === 'edit' && ev.message) {
      const i = indexOfMessage(ev.message.id)
      if (i !== -1) state.messages[i] = ev.message
    } else if (ev.type === 'del') {
      const i = indexOfMessage(ev.messageId)
      if (i !== -1) state.messages.splice(i, 1)
    }
  })
  renderAllMessages()
  if (jump) {
    if (!highlightMessage(jump.messageId)) {
      scrollNearMessage(jump.messageId)
      toast(() => t('search.notFound'), 'error')
    }
  } else {
    scrollToBottom()
  }
  markRead()
}

async function loadOlder () {
  if (state.loadingOlder || !state.hasMore || state.loading || !state.messages.length) return
  const channelId = state.channelId
  const gen = state.loadGen
  const first = state.messages[0]
  state.loadingOlder = true
  el.loadOlder.disabled = true
  el.loadOlder.textContent = t('messages.loadingOlder')
  const res = await api('GET', '/api/messages?channel=' + encodeURIComponent(channelId) + '&before=' + encodeURIComponent(first.id) + '&limit=' + PAGE_SIZE)
  state.loadingOlder = false
  el.loadOlder.disabled = false
  el.loadOlder.textContent = t('messages.loadOlder')
  if (gen !== state.loadGen || !sameId(channelId, state.channelId)) return
  if (res.status !== 200 || !res.data || !Array.isArray(res.data.messages)) {
    toast(() => errorText(res, t('messages.olderFailed')), 'error')
    return
  }
  const older = res.data.messages.filter((m) => validMessage(m) && Number(m.id) < Number(first.id) && indexOfMessage(m.id) === -1)
    .sort((a, b) => Number(a.id) - Number(b.id))
  state.hasMore = res.data.hasMore === true
  const box = el.messages
  const before = box.scrollHeight - box.scrollTop
  const frag = document.createDocumentFragment()
  older.forEach((m) => {
    const node = buildMessageNode(m)
    state.nodes.set(String(m.id), node)
    frag.appendChild(node)
  })
  state.messages = older.concat(state.messages)
  el.messageList.insertBefore(frag, el.messageList.firstChild)
  regroup()
  renderListChrome()
  box.scrollTop = box.scrollHeight - before
  if (!state.hasMore) focusNode(el.messages)
}

// Konuşma değişince yazıyor satırı, öneri listesi ve açık arama paneli güncellenir (17..19)
function chatPlusOnChannelLoad (channelId) {
  if (typeof typingOnChannelChange === 'function') typingOnChannelChange(channelId)
  if (typeof mentionClose === 'function') mentionClose()
  if (typeof searchOnConversationChange === 'function') searchOnConversationChange()
}

// Aramadan gelinen eski bir bölümde aşağı inildikçe daha yeni mesajlar yüklenir (around=<son kimlik>)
async function loadNewer () {
  if (state.loadingNewer || !state.hasNewer || state.loading || !state.messages.length) return
  const channelId = state.channelId
  const gen = state.loadGen
  const last = state.messages[state.messages.length - 1]
  state.loadingNewer = true
  renderJumpBar()
  const res = await api('GET', '/api/messages?channel=' + encodeURIComponent(channelId) + '&around=' + encodeURIComponent(last.id) + '&limit=' + JUMP_LIMIT)
  if (gen !== state.loadGen || !sameId(channelId, state.channelId)) return
  state.loadingNewer = false
  if (res.status !== 200 || !res.data || !Array.isArray(res.data.messages)) {
    renderJumpBar()
    toast(() => errorText(res, t('search.jumpFailed')), 'error')
    return
  }
  const newer = res.data.messages.filter((m) => validMessage(m) && Number(m.id) > Number(last.id) && indexOfMessage(m.id) === -1)
    .sort((a, b) => Number(a.id) - Number(b.id))
  state.hasNewer = res.data.hasNewer === true
  if (!state.hasNewer) state.newWhileOlder = false
  const frag = document.createDocumentFragment()
  newer.forEach((m) => {
    const node = buildMessageNode(m)
    state.nodes.set(String(m.id), node)
    frag.appendChild(node)
  })
  state.messages = state.messages.concat(newer)
  el.messageList.appendChild(frag)
  regroup()
  renderListChrome()
  if (!state.hasNewer) markRead()
}

// En yeni mesajlara dönüş: kanal en yeni sayfasıyla yeniden yüklenir
function jumpToLatest () {
  if (!state.channelId) return
  state.pendingJump = null
  loadChannel()
  focusNode(el.composerInput.disabled ? el.messages : el.composerInput)
}

// Arama sonucundan mesaja gitme. Mesaj zaten görüntüleniyorsa yalnızca vurgulanır, değilse konuşmaya
// geçilir ve mesaj bağlamıyla yüklenir.
function goToMessage (channelId, messageId) {
  if (!state.inApp || channelId === null || channelId === undefined) return
  const dm = typeof dmEntry === 'function' && Boolean(dmEntry(channelId))
  if (!dm && !findChannel(channelId)) {
    toast(() => t('search.notFound'), 'error')
    return
  }
  const mode = currentViewMode()
  const current = sameId(state.channelId, channelId) && mode === (dm ? 'dm' : 'channel')
  if (current && !state.loading && state.nodes.has(String(messageId))) {
    highlightMessage(messageId)
    return
  }
  state.pendingJump = { channelId: channelId, messageId: messageId }
  if (current) {
    loadChannel()
  } else if (dm) {
    showDm(channelId, {})
  } else {
    selectChannel(channelId, {})
  }
  if (state.pendingJump && !sameId(state.channelId, channelId)) state.pendingJump = null
}

let highlightTimer = 0

// Mesajı ortalayıp kısa süre vurgular, ekran okuyucu ve klavye için odak mesaja taşınır
function highlightMessage (id) {
  const node = state.nodes.get(String(id))
  if (!node) return false
  Array.from(el.messageList.querySelectorAll('.msg.is-highlighted')).forEach((n) => {
    n.classList.remove('is-highlighted')
  })
  node.classList.add('is-highlighted')
  stickBottom = false
  try {
    node.scrollIntoView({ block: 'center' })
  } catch (err) {
    node.scrollIntoView()
  }
  node.setAttribute('tabindex', '-1')
  try {
    node.focus({ preventScroll: true })
  } catch (err) {
    focusNode(node)
  }
  node.addEventListener('blur', () => {
    node.removeAttribute('tabindex')
  }, { once: true })
  clearTimeout(highlightTimer)
  highlightTimer = setTimeout(() => {
    node.classList.remove('is-highlighted')
  }, HIGHLIGHT_MS)
  return true
}

// Mesaj bulunamadıysa (silinmiş) aynı konumdaki en yakın mesaja kaydırılır
function scrollNearMessage (id) {
  const target = Number(id)
  const near = state.messages.filter((m) => Number(m.id) >= target)[0] || state.messages[state.messages.length - 1]
  const node = near ? state.nodes.get(String(near.id)) : null
  stickBottom = false
  if (node && typeof node.scrollIntoView === 'function') {
    try {
      node.scrollIntoView({ block: 'center' })
    } catch (err) {
      node.scrollIntoView()
    }
  }
}

// Eski bölüm şeridi: daha yeni mesajlar varken "En yeni mesajlara dön"
function jumpBarEl () {
  let bar = byId('search-jump')
  if (!bar && el.main) {
    bar = h('div', 'search-jump')
    bar.id = 'search-jump'
    bar.setAttribute('role', 'status')
    bar.hidden = true
    bar.appendChild(h('span', 'search-jump-text'))
    const go = button('button button-small search-jump-button', '', 'i-down')
    go.id = 'search-jump-latest'
    go.appendChild(h('span', 'button-text'))
    go.addEventListener('click', jumpToLatest)
    bar.appendChild(go)
    el.main.insertBefore(bar, el.composer && el.composer.parentNode === el.main ? el.composer : null)
  }
  return bar
}

function renderJumpBar () {
  const show = Boolean(state.hasNewer) && !state.loading && Boolean(state.channelId) && currentViewMode() !== 'home'
  const existing = byId('search-jump')
  if (!show && !existing) return
  const bar = jumpBarEl()
  if (!bar) return
  bar.hidden = !show
  if (!show) return
  const text = bar.querySelector('.search-jump-text')
  if (text) text.textContent = t(state.newWhileOlder ? 'search.newMessages' : 'search.viewingOlder')
  const go = byId('search-jump-latest')
  if (go) {
    const label = go.querySelector('.button-text')
    if (label) label.textContent = t('search.backToLatest')
    go.disabled = false
  }
  bar.classList.toggle('is-loading', Boolean(state.loadingNewer))
}

// Mesaj eylemleri menüsü

function openMessageMenu (id, trigger) {
  const m = state.messages[indexOfMessage(id)]
  if (!m) return
  const existing = findLayer('msg-menu')
  if (existing) {
    const same = sameId(state.menuMessageId, id)
    closeLayer(existing, false)
    if (same) return
  }
  const result = decryptMessage(m)
  el.msgMenuEdit.hidden = !(canEdit(m) && result.state === 'ok' && !result.dj)
  el.msgMenuDelete.hidden = !canDelete(m)
  state.menuMessageId = m.id
  el.msgMenu.hidden = false
  trigger.setAttribute('aria-expanded', 'true')
  positionPopup(el.msgMenu, trigger)
  openLayer({
    name: 'msg-menu',
    el: el.msgMenu,
    trigger: trigger,
    level: 2,
    outside: true,
    closeOnFocusOut: true,
    onClose: () => {
      el.msgMenu.hidden = true
      trigger.setAttribute('aria-expanded', 'false')
      state.menuMessageId = null
    }
  })
}

function closeMessageMenu () {
  const layer = findLayer('msg-menu')
  if (layer) closeLayer(layer, false)
}

function onMenuKey (e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
  e.preventDefault()
  const items = focusables(el.msgMenu)
  if (!items.length) return
  let i = items.indexOf(document.activeElement)
  if (e.key === 'ArrowDown') i = (i + 1) % items.length
  else if (e.key === 'ArrowUp') i = (i - 1 + items.length) % items.length
  else if (e.key === 'Home') i = 0
  else i = items.length - 1
  focusNode(items[i])
}

// Açılır öğeyi tetikleyicinin yanına, görünür alan içinde konumlandırır.
function positionPopup (popup, anchor) {
  const rect = anchor.getBoundingClientRect()
  popup.style.left = '0px'
  popup.style.top = '0px'
  const pw = popup.offsetWidth
  const ph = popup.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left = rect.right - pw
  if (left < 8) left = 8
  if (left + pw > vw - 8) left = Math.max(8, vw - 8 - pw)
  let top = rect.bottom + 6
  if (top + ph > vh - 8) top = rect.top - ph - 6
  if (top < 8) top = 8
  popup.style.left = Math.round(left) + 'px'
  popup.style.top = Math.round(top) + 'px'
}

// Düzenleme (yerinde textarea, Enter kaydeder, Esc iptal)

function startEdit (id) {
  closeMessageMenu()
  if (!conversationKeyReady()) {
    toast(() => conversationProblemText(), 'error')
    return
  }
  cancelEdit()
  const m = state.messages[indexOfMessage(id)]
  if (!m || !canEdit(m)) return
  const result = decryptMessage(m)
  // DJ duyurusu düzenlenmez (düzenleme duyuru alanını düşürürdü)
  if (result.state !== 'ok' || result.dj) return
  const node = state.nodes.get(String(m.id))
  if (!node) return
  state.editingId = m.id
  node.classList.add('msg-editing')
  const body = node.querySelector('.msg-body')
  const textNode = body.querySelector('.msg-text')
  if (textNode) textNode.hidden = true
  const box = h('div', 'edit-box')
  const label = h('label', 'sr-only', t('msg.editLabel'))
  const inputId = 'edit-input-' + m.id
  label.setAttribute('for', inputId)
  const ta = h('textarea', 'edit-input')
  ta.id = inputId
  ta.value = result.text
  ta.rows = 2
  ta.setAttribute('enterkeyhint', 'done')
  const hint = h('p', 'edit-hint', t('msg.editHint'))
  const row = h('div', 'edit-actions')
  const save = button('button button-small', t('common.save'))
  const cancel = button('button button-small button-secondary', t('common.cancel'))
  save.addEventListener('click', () => {
    saveEdit(m.id, ta)
  })
  cancel.addEventListener('click', () => {
    cancelEdit(true)
  })
  ta.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      saveEdit(m.id, ta)
    } else if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault()
      e.stopPropagation()
      cancelEdit(true)
    }
  })
  ta.addEventListener('input', () => {
    autoGrow(ta, 10)
  })
  row.appendChild(save)
  row.appendChild(cancel)
  box.appendChild(label)
  box.appendChild(ta)
  box.appendChild(hint)
  box.appendChild(row)
  body.insertBefore(box, body.firstChild)
  autoGrow(ta, 10)
  focusNode(ta)
  try {
    ta.setSelectionRange(ta.value.length, ta.value.length)
  } catch (err) {
    // Seçim desteklenmiyor
  }
}

function cancelEdit (refocus) {
  const id = state.editingId
  if (id === null || id === undefined) return
  state.editingId = null
  const m = state.messages[indexOfMessage(id)]
  if (m) {
    replaceMessage(m)
    if (refocus) {
      const node = state.nodes.get(String(id))
      const more = node ? node.querySelector('.msg-more') : null
      focusNode(more || el.composerInput)
    }
  }
}

async function saveEdit (id, ta) {
  const m = state.messages[indexOfMessage(id)]
  if (!m || ta.disabled) return
  const result = decryptMessage(m)
  if (result.state !== 'ok') return
  const text = ta.value.trim()
  if (!text && !result.files.length) {
    toast(() => t('msg.emptyEdit'), 'error')
    return
  }
  if (cpLength(text) > state.limits.messageMaxChars) {
    toast(() => t('composer.tooLong', { max: state.limits.messageMaxChars }), 'error')
    return
  }
  if (text === result.text) {
    cancelEdit(true)
    return
  }
  let body = ''
  try {
    const plain = { v: 1, a: state.me.id, c: m.channelId, t: text, f: filesForSeal(result.files) }
    body = isDmChannel(m.channelId) ? dmSealBody(plain, m.channelId) : window.E2EE.sealJson(activeKid(), plain)
  } catch (err) {
    toast(errorProducer(err, () => t('composer.sealFailed')), 'error')
    return
  }
  ta.disabled = true
  const res = await api('POST', '/api/messages/edit', { id: m.id, body: body })
  ta.disabled = false
  if (res.status === 200 && res.data && res.data.message) {
    state.editingId = null
    replaceMessage(res.data.message)
    const node = state.nodes.get(String(id))
    const more = node ? node.querySelector('.msg-more') : null
    focusNode(more || el.composerInput)
    return
  }
  toast(() => errorText(res, t('msg.editFailed'), { rate_limited: t('composer.rateLimited') }), 'error')
  focusNode(ta)
}

function filesForSeal (files) {
  return files.map((f) => {
    const out = { u: f.u, k: f.k, n: f.n, kind: f.kind, name: f.name, m: f.m, s: f.s }
    if (f.w) out.w = f.w
    if (f.h) out.h = f.h
    return out
  })
}

async function confirmDelete (id) {
  closeMessageMenu()
  const m = state.messages[indexOfMessage(id)]
  if (!m || !canDelete(m)) return
  if (!window.confirm(t('msg.deleteConfirm'))) return
  const res = await api('POST', '/api/messages/delete', { id: m.id })
  if (res.status === 200) {
    removeMessage(m.id)
    return
  }
  toast(() => errorText(res, t('msg.deleteFailed')), 'error')
}

function editLastOwnMessage () {
  let i = state.messages.length - 1
  while (i >= 0) {
    const m = state.messages[i]
    if (canEdit(m) && decryptMessage(m).state === 'ok' && !decryptMessage(m).dj) {
      startEdit(m.id)
      const node = state.nodes.get(String(m.id))
      if (node && typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'nearest' })
      return true
    }
    i -= 1
  }
  return false
}
