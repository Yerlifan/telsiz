'use strict'

// Yazıyor göstergesi: yazı kanalında ve özel mesajda yazarken en fazla 3 saniyede bir
// POST /api/typing gönderilir, alan boşalınca, mesaj gönderilince veya 5 saniye tuşa basılmayınca
// bırakma (stop) gönderilir. Başkalarının yazıyor bilgisi poll yanıtındaki typing alanıyla (tv
// sürümü) gelir ve yazma alanının üstündeki satırda gösterilir. Yazıyor bilgisi şifrelenmez,
// sunucu kimin ne zaman yazdığını görür. Ayarlardaki tercih kapalıysa (telsiz.typing) gönderilmez,
// başkalarınınki yine görünür.

const TYPING_SEND_MS = 3000
const TYPING_IDLE_MS = 5000
const TYPING_PREF_KEY = 'telsiz.typing'

const typingState = {
  // Sunucudan son alınan yazıyor sürümü. 0 iken ilk poll typing alanını hemen getirir.
  tv: 0,
  map: Object.create(null),
  sentChannel: null,
  sentAt: 0,
  lastKeyAt: 0,
  idleTimer: 0,
  blockedUntil: 0,
  deniedChannel: null,
  renderKey: ''
}

// Ayarlardaki "Yazıyor bilgimi gönder" tercihi (varsayılan açık)
function typingSendAllowed () {
  const value = typeof storeGet === 'function' ? storeGet(TYPING_PREF_KEY) : null
  return !(value === 'false' || value === '0' || value === 'off')
}

// Poll isteğindeki tv parametresi
function typingPollParam () {
  return typingState.tv
}

function normalizeTyping (value) {
  const out = Object.create(null)
  if (!value || typeof value !== 'object') return out
  Object.keys(value).forEach((channelId) => {
    const list = value[channelId]
    if (!Array.isArray(list)) return
    const ids = list.filter((id) => (typeof id === 'number' && id > 0) || (typeof id === 'string' && /^[1-9][0-9]*$/.test(id)))
    if (ids.length) out[String(channelId)] = ids.slice(0, 50)
  })
  return out
}

// /api/state veya poll yanıtı: typing alanı geldiyse liste ve sürüm güncellenir
function typingApply (data) {
  if (!data || typeof data !== 'object') return
  if (!data.typing || typeof data.typing !== 'object') return
  typingState.map = normalizeTyping(data.typing)
  if (typeof data.tv === 'number' && isFinite(data.tv)) typingState.tv = data.tv
  renderTypingLine()
}

// Bağlantı koptuğunda gösterilen liste eskiyebilir: satır gizlenir, sonraki poll listeyi baştan alır
function typingOnConnLost () {
  typingState.tv = 0
  typingState.map = Object.create(null)
  renderTypingLine()
}

// Uygulama açılırken ve oturum kapanınca durum sıfırlanır
function typingReset () {
  clearTimeout(typingState.idleTimer)
  typingState.tv = 0
  typingState.map = Object.create(null)
  typingState.sentChannel = null
  typingState.sentAt = 0
  typingState.lastKeyAt = 0
  typingState.idleTimer = 0
  typingState.blockedUntil = 0
  typingState.deniedChannel = null
  typingState.renderKey = ''
  renderTypingLine()
}

function sendTyping (channelId, stop) {
  if (!state.token || !state.inApp || channelId === null || channelId === undefined) return
  const body = stop ? { channelId: channelId, stop: true } : { channelId: channelId }
  api('POST', '/api/typing', body).then((res) => {
    if (stop || !res) return
    if (res.status === 429) {
      typingState.blockedUntil = Date.now() + 10000
    } else if (res.status === 403 || res.status === 404) {
      // Yazılamayan konuşmada yeniden denenmez (kanal değişince sıfırlanır)
      typingState.deniedChannel = String(channelId)
      if (sameId(typingState.sentChannel, channelId)) typingState.sentChannel = null
    }
  })
}

// Yazıyor bildirimi gönderilmişse geri alınır
function typingStop () {
  clearTimeout(typingState.idleTimer)
  typingState.idleTimer = 0
  const channelId = typingState.sentChannel
  typingState.sentChannel = null
  typingState.sentAt = 0
  if (channelId !== null) sendTyping(channelId, true)
}

function armTypingIdle () {
  clearTimeout(typingState.idleTimer)
  typingState.idleTimer = setTimeout(() => {
    typingState.idleTimer = 0
    if (Date.now() - typingState.lastKeyAt >= TYPING_IDLE_MS - 50) typingStop()
    else armTypingIdle()
  }, TYPING_IDLE_MS)
}

// Yazma alanındaki her değişiklikte (08-composer.js onComposerInput)
function typingOnInput () {
  const input = el.composerInput
  if (!input || !state.inApp) return
  const channelId = state.channelId
  const text = String(input.value || '')
  if (!channelId || input.disabled || !text.trim()) {
    typingStop()
    return
  }
  const now = Date.now()
  typingState.lastKeyAt = now
  armTypingIdle()
  if (!typingSendAllowed()) {
    typingStop()
    return
  }
  if (typingState.sentChannel !== null && !sameId(typingState.sentChannel, channelId)) typingStop()
  if (sameId(typingState.sentChannel, channelId) && now - typingState.sentAt < TYPING_SEND_MS) return
  if (now < typingState.blockedUntil || sameId(typingState.deniedChannel, channelId)) return
  typingState.sentChannel = channelId
  typingState.sentAt = now
  armTypingIdle()
  sendTyping(channelId, false)
}

// Mesaj gönderildikten sonra (sunucu yazanı zaten listeden çıkarır, bırakma yine gönderilir)
function typingAfterSend (channelId) {
  if (sameId(typingState.sentChannel, channelId)) typingStop()
}

// Konuşma değişince (06-messages.js loadChannel ve görünüm değişimi): önceki kanaldaki bildirim
// geri alınır, satır yeni kanalın listesiyle çizilir
function typingOnChannelChange (channelId) {
  if (typingState.sentChannel !== null && !sameId(typingState.sentChannel, channelId)) typingStop()
  if (!sameId(typingState.deniedChannel, channelId)) typingState.deniedChannel = null
  renderTypingLine()
}

function typingBlocked (userId) {
  if (typeof isBlocked !== 'function') return false
  try {
    return Boolean(isBlocked(userId))
  } catch (err) {
    return false
  }
}

function typingKnownUser (userId) {
  const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
  return users.some((u) => u && sameId(u.id, userId))
}

// Geçerli konuşmada yazanlar: kendim, engellediklerim ve listede olmayanlar hariç
function typingUsersFor (channelId) {
  if (channelId === null || channelId === undefined) return []
  const list = typingState.map[String(channelId)] || []
  return list.filter((id) => !(state.me && sameId(id, state.me.id)) && !typingBlocked(id) && typingKnownUser(id))
}

// Metin anahtarı ve parametreleri: 1 kişi, 2 kişi, 3 ve üstü "Birkaç kişi"
function typingSummary (names) {
  const list = Array.isArray(names) ? names : []
  if (list.length === 0) return null
  if (list.length === 1) return { key: 'typing.one', params: { name: list[0] }, strong: ['name'] }
  if (list.length === 2) return { key: 'typing.two', params: { a: list[0], b: list[1] }, strong: ['a', 'b'] }
  return { key: 'typing.many', params: { count: list.length }, strong: [] }
}

// Çeviri şablonunu düz metin ve kalın (ad) parçalarına ayırır. Değerler yalnızca textContent ile basılır.
// template örneği: '{a} ve {b} yazıyor'
function templateParts (template, params, strongNames) {
  const parts = []
  const strong = Array.isArray(strongNames) ? strongNames : []
  const re = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g
  let last = 0
  let match = re.exec(template)
  while (match) {
    if (match.index > last) parts.push({ text: template.slice(last, match.index), strong: false })
    const name = match[1]
    const known = params && Object.prototype.hasOwnProperty.call(params, name) && params[name] !== null && params[name] !== undefined
    parts.push({ text: known ? String(params[name]) : match[0], strong: known && strong.indexOf(name) !== -1 })
    last = match.index + match[0].length
    match = re.exec(template)
  }
  if (last < template.length) parts.push({ text: template.slice(last), strong: false })
  return parts.filter((p) => p.text !== '')
}

// Gösterilecek parçalar: şablon parametresiz alınır (eksik parametreler {ad} olarak kalır)
function typingTextParts (names) {
  const summary = typingSummary(names)
  if (!summary) return []
  const template = summary.key === 'typing.many' ? t('typing.many', { count: summary.params.count }) : t(summary.key)
  return templateParts(template, summary.params, summary.strong)
}

function typingLineEl () {
  return (el && el.typingLine) || byId('typing-line')
}

function renderTypingLine () {
  const line = typingLineEl()
  if (!line) return
  let mode = 'channel'
  if (typeof currentViewMode === 'function') {
    try {
      mode = currentViewMode()
    } catch (err) {
      mode = 'channel'
    }
  }
  const channelId = mode === 'home' || !state.inApp ? null : state.channelId
  const ids = typingUsersFor(channelId)
  const names = ids.map((id) => (typeof userDisplayName === 'function' ? userDisplayName(id) : shownName(id)))
  const key = [channelId, window.I18N ? window.I18N.lang : ''].concat(names).join('|')
  if (key === typingState.renderKey && (ids.length > 0) === !line.hidden) return
  typingState.renderKey = key
  clear(line)
  if (!ids.length) {
    line.hidden = true
    line.removeAttribute('data-count')
    return
  }
  const dots = h('span', 'typing-dots')
  dots.setAttribute('aria-hidden', 'true')
  dots.appendChild(h('span', 'typing-dot'))
  line.appendChild(dots)
  const text = h('span', 'typing-text')
  typingTextParts(names).forEach((part) => {
    text.appendChild(part.strong ? h('strong', 'typing-name', part.text) : document.createTextNode(part.text))
  })
  line.appendChild(text)
  line.setAttribute('data-count', String(Math.min(ids.length, 3)))
  line.hidden = false
}

// Dil, profil veya engel listesi değişince satır yeniden çizilir
function typingRefresh () {
  typingState.renderKey = ''
  renderTypingLine()
}

// 17, 18 ve 19 numaralı modüllerin olay bağlantıları. 12-init.js start() DOMContentLoaded olayında
// çalışır ve bu dosya ondan sonra yüklendiği için bu dinleyici start'tan sonra çağrılır.
function chatPlusInit () {
  if (typeof searchInit === 'function') searchInit()
  if (typeof mentionInit === 'function') mentionInit()
  if (typeof window.MutationObserver !== 'function') return
  try {
    // Dil değişince (html lang) panel, öneri listesi ve yazıyor satırı yeni dilde çizilir
    const langObserver = new window.MutationObserver(() => {
      if (typeof searchApplyLanguage === 'function') searchApplyLanguage()
      if (typeof mentionClose === 'function') mentionClose()
      typingRefresh()
      if (state.inApp && typeof renderJumpBar === 'function') renderJumpBar()
    })
    langObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
    // Uygulama ekranı gizlenince (çıkış, oturum sonu) bellekteki arama dizini ve durumlar silinir
    const view = byId('app-view')
    if (view) {
      const viewObserver = new window.MutationObserver(() => {
        if (view.hidden && typeof chatPlusReset === 'function') chatPlusReset()
      })
      viewObserver.observe(view, { attributes: true, attributeFilter: ['hidden'] })
    }
  } catch (err) {
    // Gözlemci desteklenmiyor
  }
}

if (typeof document !== 'undefined' && document.addEventListener) {
  if (document.readyState === 'complete') {
    chatPlusInit()
  } else {
    document.addEventListener('DOMContentLoaded', chatPlusInit)
  }
}
