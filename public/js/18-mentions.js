'use strict'

// @ ile anma: metindeki anmaların ayrıştırılması, mesajda rozet olarak çizilmesi (yalnızca
// textContent, tıklanınca profil kartı), beni anan mesajın vurgusu, kanal anma sayaçları, yazma
// alanındaki öneri listesi (#mention-popover) ve bildirim düzeyi. Anma tamamen istemcidedir: sunucu
// şifreli metni göremez, alıcının istemcisi çözdüğü metinde kendi kullanıcı adını arar.
// @herkes ve @everyone yalnızca sahip ve yöneticiler yazdığında (yazarın rolüne bakılır) ve yazı
// kanallarında herkes için anma sayılır, üyelerin yazdığı düz metin kalır.

const MENTION_EVERYONE = ['herkes', 'everyone']
const MENTION_NAME_RE = /^[a-z0-9_.]{2,32}$/
const MENTION_SUGGEST_MAX = 10
const NOTIFY_LEVEL_KEY = 'telsiz.notifyLevel'

// Kullanıcı adı kuralı: [a-z0-9_.], 2..32, nokta ile başlayıp bitemez, ardışık iki nokta olamaz
function validMentionName (name) {
  return MENTION_NAME_RE.test(name) && name.charAt(0) !== '.' && name.charAt(name.length - 1) !== '.' && name.indexOf('..') === -1
}

function isMentionNameChar (ch) {
  return Boolean(ch) && /[A-Za-z0-9_.]/.test(ch)
}

// Kelime sınırı için harf, rakam ve alt çizgi. ASCII dışındaki harfler de (ğ, ş, é) kelime sayılır,
// boşluk, noktalama, simge ve emoji (vekil çiftler) sayılmaz.
function isMentionWordChar (ch) {
  if (!ch) return false
  if (/[A-Za-z0-9_]/.test(ch)) return true
  const code = ch.charCodeAt(0)
  if (code < 0x80) return false
  if (code >= 0xd800 && code <= 0xdfff) return false
  if (code >= 0x2000 && code <= 0x2bff) return false
  if (code >= 0x3000 && code <= 0x303f) return false
  if (code >= 0xfe00 && code <= 0xfe0f) return false
  if (code === 0xa0 || code === 0xa1 || code === 0xab || code === 0xbb || code === 0xbf || code === 0xd7 || code === 0xf7 || code === 0xfeff) return false
  return /\S/.test(ch)
}

// Metni parçalara ayırır: { type: 'text', text } | { type: 'user', text, name, userId } |
// { type: 'everyone', text }. resolveName(ad) var olan kullanıcının kimliğini veya null döner.
// allowEveryone yalnızca yazar sahip veya yöneticiyse ve yazı kanalındaysa true verilir.
function parseMentions (text, resolveName, allowEveryone) {
  const s = typeof text === 'string' ? text : ''
  const out = []
  let buf = ''
  let i = 0
  const flush = () => {
    if (buf) out.push({ type: 'text', text: buf })
    buf = ''
  }
  while (i < s.length) {
    const ch = s.charAt(i)
    if (ch === '@' && !isMentionWordChar(s.charAt(i - 1)) && s.charAt(i - 1) !== '@') {
      let j = i + 1
      while (j < s.length && isMentionNameChar(s.charAt(j))) j += 1
      let end = j
      // Sondaki noktalar cümle noktalaması sayılır
      while (end > i + 1 && s.charAt(end - 1) === '.') end -= 1
      const raw = s.slice(i + 1, end)
      const lower = raw.toLowerCase()
      let token = null
      if (raw && !isMentionWordChar(s.charAt(end))) {
        if (MENTION_EVERYONE.indexOf(lower) !== -1) {
          if (allowEveryone) token = { type: 'everyone', text: '@' + raw }
        } else if (validMentionName(lower) && typeof resolveName === 'function') {
          const userId = resolveName(lower)
          if (userId !== null && userId !== undefined) token = { type: 'user', text: '@' + raw, name: lower, userId: userId }
        }
      }
      if (token) {
        flush()
        out.push(token)
        i = end
        continue
      }
    }
    buf += ch
    i += 1
  }
  flush()
  return out
}

// Var olan kullanıcı adlarından kimliğe dizin (meta değişince yenilenir)
const mentionIndexCache = { meta: null, map: null }

function mentionNameIndex () {
  const meta = state.meta
  if (mentionIndexCache.meta === meta && mentionIndexCache.map) return mentionIndexCache.map
  const map = new Map()
  const users = meta && Array.isArray(meta.users) ? meta.users : []
  users.forEach((u) => {
    if (u && u.id !== undefined && typeof u.name === 'string' && u.name) map.set(u.name.toLowerCase(), u.id)
  })
  mentionIndexCache.meta = meta
  mentionIndexCache.map = map
  return map
}

function resolveMentionName (name) {
  const id = mentionNameIndex().get(String(name || '').toLowerCase())
  return id === undefined ? null : id
}

function mentionIsDm (channelId) {
  if (typeof isDmChannel !== 'function') return false
  try {
    return Boolean(isDmChannel(channelId))
  } catch (err) {
    return false
  }
}

// Yazarın rolü (meta listesindeki güncel rol): sahip ve yöneticinin @herkes'i anma sayılır
function mentionAuthorRole (authorId) {
  const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
  const user = users.filter((u) => u && sameId(u.id, authorId))[0]
  return user ? user.role : 'member'
}

function mayMentionEveryone (authorId, channelId) {
  if (mentionIsDm(channelId)) return false
  const role = mentionAuthorRole(authorId)
  return role === 'owner' || role === 'admin'
}

function mentionTokensFor (text, m) {
  return parseMentions(text, resolveMentionName, mayMentionEveryone(m.authorId, m.channelId))
}

// Mesaj beni anıyor mu (kendi mesajlarım sayılmaz). text verilmezse mesaj çözülür.
function messageMentionsMe (m, text) {
  if (!m || !state.me || sameId(m.authorId, state.me.id)) return false
  let body = text
  if (typeof body !== 'string') {
    let result = null
    try {
      result = decryptMessage(m)
    } catch (err) {
      result = null
    }
    if (!result || result.state !== 'ok') return false
    body = result.text
  }
  if (!body || body.indexOf('@') === -1) return false
  return mentionTokensFor(body, m).some((tok) => tok.type === 'everyone' || (tok.type === 'user' && sameId(tok.userId, state.me.id)))
}

// Mesaj metnini anma rozetleriyle çizer. Rozetler yalnızca textContent ile, kullanıcı rozetine
// tıklamak profil kartını açar.
function renderMentionText (node, text, m) {
  const tokens = text && text.indexOf('@') !== -1 ? mentionTokensFor(text, m) : [{ type: 'text', text: text || '' }]
  tokens.forEach((tok) => {
    if (tok.type === 'user') {
      const b = h('button', 'mention mention-user', tok.text)
      b.type = 'button'
      b.setAttribute('data-user-id', String(tok.userId))
      b.setAttribute('aria-haspopup', 'dialog')
      const name = typeof userDisplayName === 'function' ? userDisplayName(tok.userId) : shownName(tok.userId)
      b.title = name
      b.setAttribute('aria-label', t('mention.profileLabel', { handle: tok.text, name: name }))
      if (state.me && sameId(tok.userId, state.me.id)) b.classList.add('is-me')
      b.addEventListener('click', (e) => {
        e.stopPropagation()
        if (typeof openProfileCard === 'function') openProfileCard(tok.userId, b)
      })
      node.appendChild(b)
    } else if (tok.type === 'everyone') {
      const span = h('span', 'mention mention-everyone', tok.text)
      span.title = t('mention.everyoneTitle')
      node.appendChild(span)
    } else {
      node.appendChild(document.createTextNode(tok.text))
    }
  })
  return node
}

// Kanal anma sayaçları (Ek H3.5): okunmamış anmalar kanal listesinde ayrı rozet, Ana sayfa
// girişinde toplam

function mentionTotal () {
  const map = state.mentions || {}
  let total = 0
  textChannels().forEach((c) => {
    const n = Number(map[c.id] || map[String(c.id)]) || 0
    if (n > 0) total += n
  })
  return total
}

function refreshMentionBadges () {
  renderChannels()
  if (typeof renderHomeEntry === 'function') renderHomeEntry()
}

// Gelen mesaj geçerli olmayan bir yazı kanalında beni anıyorsa sayaç artar
function mentionOnIncoming (message) {
  if (!message || mentionIsDm(message.channelId)) return false
  if (typeof isBlocked === 'function' && isBlocked(message.authorId)) return false
  if (!messageMentionsMe(message)) return false
  if (!state.mentions) state.mentions = Object.create(null)
  state.mentions[message.channelId] = (Number(state.mentions[message.channelId]) || 0) + 1
  refreshMentionBadges()
  return true
}

// Bildirim düzeyi: 'all' (tüm mesajlar), 'mentions' (yalnızca anmalar ve özel mesajlar, varsayılan),
// 'none' (hiçbiri). Rahatsız etmeyin durumunda hiçbir bildirim ve ses verilmez.
function mentionNotifyLevel () {
  const value = typeof storeGet === 'function' ? storeGet(NOTIFY_LEVEL_KEY) : null
  return value === 'all' || value === 'none' ? value : 'mentions'
}

function messageAlertAllowed (message) {
  if (!message || !state.me || sameId(message.authorId, state.me.id)) return false
  if (typeof myChosenStatus === 'function' && myChosenStatus() === 'dnd') return false
  const level = mentionNotifyLevel()
  if (level === 'none') return false
  const dm = typeof isDmMessage === 'function' ? isDmMessage(message) : mentionIsDm(message.channelId)
  if (!dm && typeof isBlocked === 'function' && isBlocked(message.authorId)) return false
  if (level === 'all' || dm) return true
  return messageMentionsMe(message)
}

// Kişi önerileri (yazma alanındaki @ listesi ve aramadaki "Kimden" süzgeci ortak kullanır)

function personFold (text) {
  if (typeof foldSearchText === 'function') return foldSearchText(text)
  return String(text || '').toLowerCase()
}

// ids içinden sorguya uyanlar, en uygun önce: kullanıcı adı başı, görünen ad kelime başı, içerme
function matchPeople (query, ids, max) {
  const q = personFold(query).trim()
  const scored = []
  ids.forEach((id) => {
    const user = (state.meta && Array.isArray(state.meta.users) ? state.meta.users : []).filter((u) => u && sameId(u.id, id))[0]
    if (!user) return
    const handle = String(user.name || '').toLowerCase()
    const display = typeof userDisplayName === 'function' ? userDisplayName(id) : shownName(id)
    const fd = personFold(display)
    let score = -1
    if (!q) score = 3
    else if (handle.indexOf(q) === 0) score = 0
    else if (fd.indexOf(q) === 0 || fd.indexOf(' ' + q) !== -1) score = 1
    else if (handle.indexOf(q) !== -1 || fd.indexOf(q) !== -1) score = 2
    if (score === -1) return
    const online = typeof userStatus === 'function' ? userStatus(id) !== 'offline' : Boolean(user.online)
    scored.push({ id: id, name: handle, display: display, score: score, online: online })
  })
  const locale = window.I18N && typeof window.I18N.locale === 'function' ? window.I18N.locale() : undefined
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    if (a.online !== b.online) return a.online ? -1 : 1
    try {
      return a.display.localeCompare(b.display, locale)
    } catch (err) {
      return a.display < b.display ? -1 : 1
    }
  })
  return typeof max === 'number' ? scored.slice(0, max) : scored
}

// Yazma alanındaki öneri listesi

// mode: 'user' (@ ile kişi önerileri) veya 'command' (yazma alanı "/" ile başlayınca Telsiz DJ komutları,
// KONSEPT 6.10 ve 8.4). Komut kipinde ses odasında değilken liste yerine tek bir uyarı satırı gösterilir
// (warning true, items boş).
const mentionState = {
  open: false,
  mode: 'user',
  warning: false,
  items: [],
  index: 0,
  start: -1,
  end: -1,
  query: '',
  dismissed: -1,
  blurTimer: 0
}

// Telsiz DJ komutları (dj-interface commands). Adlar ve açıklamalar i18n'dedir (dj.cmd.<ad>,
// dj.cmdDesc.<ad>). Eş adlar motor yüklüyse TelsizMusic.COMMANDS'tan, değilse iki dilin adlarından ve
// Türkçe klavyesi olmayanlar için ASCII eşlerinden gelir. Komutların işlevi 08-composer.js kancasıyla
// DJ arayüzüne bağlanır.
const DJ_COMMAND_ORDER = ['play', 'skip', 'pause', 'resume', 'queue', 'stop']
const DJ_COMMAND_ASCII = { play: ['/cal'], skip: ['/gec'] }

function commandFold (text) {
  let s = String(text || '')
  try {
    s = s.normalize('NFC')
  } catch (err) {
    s = String(text || '')
  }
  return s.replace(/[İı]/g, 'i').toLowerCase()
}

function djCommandAliases (name) {
  const engine = window.TelsizMusic && window.TelsizMusic.COMMANDS ? window.TelsizMusic.COMMANDS[name] : null
  const out = []
  const add = (value) => {
    if (typeof value === 'string' && value.charAt(0) === '/' && out.indexOf(value) === -1) out.push(value)
  }
  add(t('dj.cmd.' + name))
  if (Array.isArray(engine)) engine.forEach(add)
  const dicts = window.I18N && window.I18N.messages ? window.I18N.messages : {}
  Object.keys(dicts).forEach((lang) => {
    if (dicts[lang]) add(dicts[lang]['dj.cmd.' + name])
  })
  const ascii = DJ_COMMAND_ASCII[name] || []
  ascii.forEach(add)
  return out
}

// Yazma alanı "/" ile başlıyorsa ve imleç ilk kelimedeyse { start: 0, end (kelimenin sonu), query }
function commandQueryAt (text, caret) {
  const s = typeof text === 'string' ? text : ''
  if (s.charAt(0) !== '/' || typeof caret !== 'number' || caret < 1 || caret > s.length) return null
  const space = s.search(/\s/)
  const end = space === -1 ? s.length : space
  if (caret > end || end > 40) return null
  return { start: 0, end: end, query: commandFold(s.slice(1, caret)) }
}

// Sorguya uyan komutlar: geçerli dildeki ad önce, yazılan eş ad yalnızca dildeki ad uymuyorsa gösterilir
function commandCandidates (query) {
  const q = commandFold(query)
  const out = []
  DJ_COMMAND_ORDER.forEach((name) => {
    const aliases = djCommandAliases(name)
    if (!aliases.length) return
    const hit = aliases.filter((a) => commandFold(a.slice(1)).indexOf(q) === 0)[0]
    if (!hit) return
    const label = commandFold(aliases[0].slice(1)).indexOf(q) === 0 ? aliases[0] : hit
    out.push({ kind: 'command', name: name, label: label, desc: t('dj.cmdDesc.' + name) })
  })
  return out
}

function commandInVoice () {
  try {
    return typeof snap === 'function' && snap().channelId !== null && snap().channelId !== undefined
  } catch (err) {
    return false
  }
}

function commandVoiceName () {
  const id = commandInVoice() ? snap().channelId : null
  const ch = id !== null && typeof findChannel === 'function' ? findChannel(id) : null
  return ch ? ch.name : ''
}

// Komut kipindeki değişiklikler yazma alanında 'telsiz:commands' olayıyla duyurulur (23-dj.js dinler)
function commandAnnounce () {
  if (typeof composerEmit !== 'function') return
  composerEmit('telsiz:commands', {
    open: mentionState.open && mentionState.mode === 'command',
    query: mentionState.query,
    inVoice: commandInVoice(),
    items: mentionState.items.map((item) => ({ name: item.name, label: item.label }))
  })
}

function mentionPopoverEl () {
  return (el && el.mentionPopover) || byId('mention-popover')
}

// İmlecin önündeki @ kelimesi: { start (@ konumu), end (kelimenin sonu), query } veya null
function mentionQueryAt (text, caret) {
  const s = typeof text === 'string' ? text : ''
  if (typeof caret !== 'number' || caret < 0 || caret > s.length) return null
  let i = caret
  while (i > 0 && isMentionNameChar(s.charAt(i - 1))) i -= 1
  if (i === 0 || s.charAt(i - 1) !== '@') return null
  const at = i - 1
  if (at > 0 && (isMentionWordChar(s.charAt(at - 1)) || s.charAt(at - 1) === '@')) return null
  let end = caret
  while (end < s.length && isMentionNameChar(s.charAt(end))) end += 1
  const query = s.slice(i, caret)
  if (query.length > 32) return null
  return { start: at, end: end, query: query.toLowerCase() }
}

// Konuşmaya göre aday listesi: yazı kanalında üyeler (kendim ve engellediklerim hariç) ve yetkiliyse
// @herkes ile @everyone, özel mesajda yalnızca karşı taraf
function mentionCandidates (query) {
  const channelId = state.channelId
  if (!channelId || !state.me) return []
  const dm = mentionIsDm(channelId)
  let ids = []
  if (dm) {
    const partner = typeof dmPartner === 'function' ? dmPartner(channelId) : null
    if (partner !== null && partner !== undefined) ids = [partner]
  } else {
    const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
    ids = users.filter((u) => u && !sameId(u.id, state.me.id) && !(typeof isBlocked === 'function' && isBlocked(u.id))).map((u) => u.id)
  }
  const out = matchPeople(query, ids, MENTION_SUGGEST_MAX).map((p) => ({ kind: 'user', id: p.id, name: p.name, display: p.display }))
  if (!dm && typeof isAdmin === 'function' && isAdmin()) {
    const lang = window.I18N ? window.I18N.lang : 'tr'
    const tokens = lang === 'en' ? ['everyone', 'herkes'] : ['herkes', 'everyone']
    tokens.forEach((word) => {
      if (word.indexOf(query) === 0) out.push({ kind: 'everyone', name: word, display: '@' + word })
    })
  }
  return out
}

function composerCaret () {
  const input = el.composerInput
  if (!input) return -1
  try {
    if (input.selectionStart !== input.selectionEnd) return -1
    return input.selectionStart
  } catch (err) {
    return -1
  }
}

// Yazma alanı değişince veya imleç oynayınca liste açılır, süzülür ya da kapanır
function mentionUpdate () {
  const input = el.composerInput
  if (!input || input.disabled || !state.inApp || !state.channelId) {
    mentionClose()
    return
  }
  const caret = composerCaret()
  const command = commandQueryAt(input.value, caret)
  if (command) {
    commandUpdate(command)
    return
  }
  const found = mentionQueryAt(input.value, caret)
  if (!found) {
    mentionState.dismissed = -1
    mentionClose()
    return
  }
  if (found.start === mentionState.dismissed) {
    mentionClose()
    return
  }
  const items = mentionCandidates(found.query)
  if (!items.length) {
    mentionClose()
    return
  }
  if (mentionState.open && mentionState.mode !== 'user') mentionClose()
  mentionState.mode = 'user'
  mentionState.warning = false
  const sameToken = mentionState.open && mentionState.start === found.start
  const prevKey = sameToken && mentionState.items[mentionState.index] ? mentionItemKey(mentionState.items[mentionState.index]) : ''
  mentionState.items = items
  mentionState.start = found.start
  mentionState.end = found.end
  mentionState.query = found.query
  const keep = prevKey ? items.map(mentionItemKey).indexOf(prevKey) : -1
  mentionState.index = keep !== -1 ? keep : 0
  mentionState.open = true
  renderMentionPopover()
}

// Komut kipi: "/" ile başlayan ilk kelime. Ses odasında değilken liste yerine uyarı satırı, uyan komut
// yoksa liste kapanır (metin olağan mesajdır).
function commandUpdate (found) {
  if (found.start === mentionState.dismissed) {
    mentionClose()
    return
  }
  const inVoice = commandInVoice()
  const items = inVoice ? commandCandidates(found.query) : []
  if (inVoice && !items.length) {
    mentionClose()
    return
  }
  if (mentionState.open && mentionState.mode !== 'command') mentionClose()
  const prevKey = mentionState.open && mentionState.items[mentionState.index] ? mentionItemKey(mentionState.items[mentionState.index]) : ''
  mentionState.mode = 'command'
  mentionState.warning = !inVoice
  mentionState.items = items
  mentionState.start = found.start
  mentionState.end = found.end
  mentionState.query = found.query
  const keep = prevKey ? items.map(mentionItemKey).indexOf(prevKey) : -1
  mentionState.index = keep !== -1 ? keep : 0
  mentionState.open = true
  renderMentionPopover()
  commandAnnounce()
}

function mentionItemKey (item) {
  return item.kind + ':' + (item.kind === 'user' ? String(item.id) : item.name)
}

function mentionOnInput () {
  mentionUpdate()
}

function renderMentionPopover () {
  const pop = mentionPopoverEl()
  const input = el.composerInput
  if (!pop) return
  clear(pop)
  const command = mentionState.mode === 'command'
  pop.classList.toggle('is-commands', mentionState.open && command)
  pop.classList.toggle('is-warning', mentionState.open && mentionState.warning)
  if (!mentionState.open) {
    pop.hidden = true
    pop.setAttribute('role', 'listbox')
    pop.setAttribute('aria-label', t('layout.mentionList'))
    if (input) {
      input.setAttribute('aria-expanded', 'false')
      input.removeAttribute('aria-activedescendant')
    }
    return
  }
  // Başlık satırı: kişi listesinde tuş ipucu, komut listesinde kapsam (ses odası) ve gönderim notu
  const voiceName = command ? commandVoiceName() : ''
  let title = t('composer.mentionHint')
  if (command) title = typeof composerCommandsLive === 'function' && composerCommandsLive() && voiceName ? t('dj.cmdTitleLive', { room: voiceName }) : t('dj.cmdTitle')
  const head = h('p', 'mention-title', title)
  head.setAttribute('aria-hidden', 'true')
  pop.appendChild(head)
  if (command && mentionState.warning) {
    // Ses odasında değil: liste yerine uyarı (ekran okuyucuya durum olarak okunur)
    pop.setAttribute('role', 'status')
    pop.setAttribute('aria-label', t('dj.cmdTitle'))
    const warn = h('p', 'mention-warning')
    warn.appendChild(icon('i-alert'))
    warn.appendChild(h('span', '', t('dj.cmdNoVoice')))
    pop.appendChild(warn)
    pop.hidden = false
    if (input) {
      input.setAttribute('aria-expanded', 'false')
      input.removeAttribute('aria-activedescendant')
    }
    return
  }
  pop.setAttribute('role', 'listbox')
  pop.setAttribute('aria-label', t(command ? 'dj.cmdTitle' : 'layout.mentionList'))
  mentionState.items.forEach((item, i) => {
    const opt = h('div', 'mention-option' + (item.kind === 'everyone' ? ' mention-option-everyone' : '') + (item.kind === 'command' ? ' mention-option-command' : ''))
    opt.id = 'mention-opt-' + i
    opt.setAttribute('role', 'option')
    opt.setAttribute('data-index', String(i))
    opt.setAttribute('aria-selected', i === mentionState.index ? 'true' : 'false')
    if (item.kind === 'command') {
      opt.setAttribute('data-command', item.name)
      opt.appendChild(h('span', 'mention-option-cmd', item.label))
      opt.appendChild(h('span', 'mention-option-desc', item.desc))
    } else if (item.kind === 'user') {
      opt.setAttribute('data-user-id', String(item.id))
      const av = typeof personAvatar === 'function' ? personAvatar(item.id, 'sm') : avatar(item.id, 'sm')
      opt.appendChild(av)
      opt.appendChild(h('span', 'mention-option-name', item.display))
      opt.appendChild(h('span', 'handle mention-option-handle', '@' + item.name))
    } else {
      const ic = h('span', 'mention-option-icon')
      ic.setAttribute('aria-hidden', 'true')
      ic.appendChild(icon('i-at'))
      opt.appendChild(ic)
      opt.appendChild(h('span', 'mention-option-name', '@' + item.name))
      opt.appendChild(h('span', 'handle mention-option-handle', t('mention.everyoneHint')))
    }
    if (i === mentionState.index) {
      // Seçili satırda ekleme tuşunun ipucu (kişide Enter, komutta Tab)
      const key = h('kbd', 'kbd mention-option-key', item.kind === 'command' ? 'Tab' : 'Enter')
      key.setAttribute('aria-hidden', 'true')
      opt.appendChild(key)
    }
    opt.addEventListener('click', (e) => {
      e.preventDefault()
      mentionSelect(i)
    })
    pop.appendChild(opt)
  })
  pop.hidden = false
  if (input) {
    input.setAttribute('aria-controls', pop.id || 'mention-popover')
    input.setAttribute('aria-autocomplete', 'list')
    input.setAttribute('aria-expanded', 'true')
    input.setAttribute('aria-activedescendant', 'mention-opt-' + mentionState.index)
  }
  const active = byId('mention-opt-' + mentionState.index)
  if (active && typeof active.scrollIntoView === 'function') {
    try {
      active.scrollIntoView({ block: 'nearest' })
    } catch (err) {
      active.scrollIntoView(false)
    }
  }
}

function mentionMove (delta) {
  const n = mentionState.items.length
  if (!n) return
  mentionState.index = (mentionState.index + delta + n) % n
  renderMentionPopover()
}

function mentionClose () {
  clearTimeout(mentionState.blurTimer)
  if (!mentionState.open) {
    const pop = mentionPopoverEl()
    if (pop && !pop.hidden) renderMentionPopover()
    return
  }
  const wasCommand = mentionState.mode === 'command'
  mentionState.open = false
  mentionState.items = []
  mentionState.index = 0
  mentionState.warning = false
  renderMentionPopover()
  mentionState.mode = 'user'
  if (wasCommand) commandAnnounce()
}

// Seçilen komut ilk kelimenin yerine '/ad ' olarak konur, 'telsiz:command-pick' olayı yayılır
function commandSelect (item, input) {
  const text = input.value
  const end = Math.max(mentionState.end, 1)
  if (text.charAt(0) !== '/') {
    mentionClose()
    return
  }
  const after = text.slice(end)
  const insert = item.label + (/^\s/.test(after) ? '' : ' ')
  input.value = insert + after
  let caret = insert.length
  if (/^\s/.test(after)) caret += 1
  try {
    input.setSelectionRange(caret, caret)
  } catch (err) {
    // Seçim desteklenmiyor
  }
  mentionState.dismissed = 0
  mentionClose()
  focusNode(input)
  if (typeof onComposerInput === 'function') onComposerInput()
  if (typeof composerEmit === 'function') composerEmit('telsiz:command-pick', { name: item.name, label: item.label, text: input.value })
}

// Seçilen kişi '@kullanıcıadı ' olarak yazılan kelimenin yerine konur
function mentionSelect (index) {
  const item = mentionState.items[index]
  const input = el.composerInput
  if (!item || !input || input.disabled) return
  if (item.kind === 'command') {
    commandSelect(item, input)
    return
  }
  const text = input.value
  const start = mentionState.start
  const end = Math.max(mentionState.end, start + 1)
  if (start < 0 || text.charAt(start) !== '@') {
    mentionClose()
    return
  }
  const after = text.slice(end)
  const insert = '@' + item.name + (/^\s/.test(after) ? '' : ' ')
  input.value = text.slice(0, start) + insert + after
  let caret = start + insert.length
  if (/^\s/.test(after)) caret += 1
  try {
    input.setSelectionRange(caret, caret)
  } catch (err) {
    // Seçim desteklenmiyor
  }
  mentionState.dismissed = -1
  mentionClose()
  focusNode(input)
  if (typeof onComposerInput === 'function') onComposerInput()
}

// Yazma alanının tuşları: liste açıkken oklar seçer, Enter ve Tab ekler, Esc kapatır.
// Olay ele alındıysa true döner (mesaj gönderilmez).
function mentionOnKeydown (e) {
  if (!mentionState.open) return false
  if (e.altKey || e.ctrlKey || e.metaKey) return false
  const key = e.key
  if (!mentionState.items.length) {
    // Yalnızca uyarı satırı açık (komut kipi, ses odasında değil): Esc kapatır, diğer tuşlar yazma alanının
    if (key !== 'Escape' && key !== 'Esc') return false
    e.preventDefault()
    e.stopPropagation()
    mentionState.dismissed = mentionState.start
    mentionClose()
    return true
  }
  // Komut tam yazılmışsa Enter listeyi değil gönderimi tetikler (Tab yine tamamlar)
  if (key === 'Enter' && !e.shiftKey && mentionState.mode === 'command') {
    const input = el.composerInput
    const word = input ? commandFold(input.value.slice(0, mentionState.end)) : ''
    if (mentionState.items.some((item) => word === commandFold(item.label))) {
      mentionClose()
      return false
    }
  }
  if (key === 'ArrowDown' || key === 'Down') {
    e.preventDefault()
    mentionMove(1)
    return true
  }
  if (key === 'ArrowUp' || key === 'Up') {
    e.preventDefault()
    mentionMove(-1)
    return true
  }
  if ((key === 'Enter' && !e.shiftKey) || (key === 'Tab' && !e.shiftKey)) {
    e.preventDefault()
    mentionSelect(mentionState.index)
    return true
  }
  if (key === 'Escape' || key === 'Esc') {
    e.preventDefault()
    e.stopPropagation()
    mentionState.dismissed = mentionState.start
    mentionClose()
    return true
  }
  return false
}

function mentionOnBlur () {
  clearTimeout(mentionState.blurTimer)
  mentionState.blurTimer = setTimeout(() => {
    if (document.activeElement !== el.composerInput) mentionClose()
  }, 150)
}

// Seçenekler yazma alanından odağı almasın (fare, dokunma ve kontrolcü imleci)
function mentionPointerDown (e) {
  e.preventDefault()
}

function mentionInit () {
  const input = el.composerInput
  const pop = mentionPopoverEl()
  if (input) {
    input.addEventListener('click', mentionUpdate)
    input.addEventListener('keyup', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') mentionUpdate()
    })
    input.addEventListener('blur', mentionOnBlur)
  }
  if (pop) {
    pop.addEventListener('mousedown', mentionPointerDown)
    if (window.PointerEvent) pop.addEventListener('pointerdown', mentionPointerDown)
  }
}

// Dil veya konuşma değişince açık liste kapanır, mesajlardaki rozetler zaten yeniden çizilir
function mentionReset () {
  mentionState.dismissed = -1
  mentionState.start = -1
  mentionClose()
  mentionIndexCache.meta = null
  mentionIndexCache.map = null
}
