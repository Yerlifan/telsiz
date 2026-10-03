'use strict'

// PS5 + PC Sohbet istemcisi.
// PS5 tarayıcısının desteklediği özellikler belirsiz olduğu için yalnızca ES2017
// sözdizimi, XMLHttpRequest ve HTTP long-polling kullanılır. Kod tek bir blok
// içinde tutulur, böylece genel ad alanına değişken eklenmez.

{
  const TOKEN_KEY = 'sohbet.token'
  const NICK_KEY = 'sohbet.nick'
  const BASE_TITLE = 'Sohbet'
  const REQUEST_TIMEOUT_MS = 15000
  const POLL_TIMEOUT_MS = 35000
  const BACKUP_TIMER_EXTRA_MS = 2000
  const INFO_RETRY_MS = 3000
  const FLASH_MS = 4000
  const MAX_RETRY_SECONDS = 10
  const SCROLL_STICK_PX = 120
  const MAX_RENDERED_MESSAGES = 500
  const NICK_COLOR_COUNT = 8

  const TEXT_UNREACHABLE = 'Sunucuya ulaşılamadı.'
  const TEXT_RECONNECTING = 'Bağlantı koptu, yeniden deneniyor...'
  const TEXT_SESSION_ENDED = 'Oturum sona erdi, lütfen yeniden katıl.'

  const el = {}
  const memoryStore = Object.create(null)

  const state = {
    infoReady: false,
    passwordRequired: false,
    maxMessageLength: 1000,
    nickMin: 2,
    nickMax: 20,
    token: '',
    nick: '',
    password: '',
    lastId: 0,
    inChat: false,
    viewEpoch: 0,
    pollGeneration: 0,
    activePoll: null,
    connectionLost: false,
    flashText: '',
    flashTimer: 0,
    unread: 0,
    joinBusy: false,
    sendBusy: false,
    rejoinBusy: false,
    usersOpen: false,
    stickToBottom: true
  }

  // Kalıcı depolama. localStorage yoksa veya hata verirse bellekte devam edilir.

  function storeGet (key) {
    try {
      const value = window.localStorage.getItem(key)
      if (typeof value === 'string') {
        return value
      }
    } catch (err) {
      // localStorage kullanılamıyor, bellekteki kopyaya bakılır
    }
    return typeof memoryStore[key] === 'string' ? memoryStore[key] : ''
  }

  function storeSet (key, value) {
    memoryStore[key] = value
    try {
      window.localStorage.setItem(key, value)
    } catch (err) {
      // Değer yalnızca bellekte tutulur
    }
  }

  function storeRemove (key) {
    delete memoryStore[key]
    try {
      window.localStorage.removeItem(key)
    } catch (err) {
      // Bellekteki kopya zaten silindi
    }
  }

  // Sunucu istekleri. Dönen Promise hiçbir zaman reddedilmez,
  // ağ hatası, zaman aşımı ve iptal durumunda status 0 olur.

  function parseJson (text) {
    try {
      const value = JSON.parse(text)
      return value && typeof value === 'object' ? value : null
    } catch (err) {
      return null
    }
  }

  function abortRequest (xhr) {
    if (!xhr) {
      return
    }
    try {
      xhr.abort()
    } catch (err) {
      // İstek zaten bitmiş olabilir
    }
  }

  function request (method, path, options) {
    const opts = options || {}
    const timeoutMs = opts.timeout || REQUEST_TIMEOUT_MS
    let xhr = null
    const promise = new Promise((resolve) => {
      let settled = false
      let backupTimer = 0
      const settle = (status, data) => {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(backupTimer)
        resolve({ status: status, data: data })
      }
      try {
        xhr = new XMLHttpRequest()
        xhr.open(method, path, true)
        try {
          xhr.timeout = timeoutMs
        } catch (err) {
          // Yedek zamanlayıcı devreye girer
        }
        if (opts.token) {
          xhr.setRequestHeader('X-Token', opts.token)
        }
        if (method !== 'GET') {
          xhr.setRequestHeader('Content-Type', 'application/json')
        }
        xhr.onload = () => {
          settle(xhr.status, parseJson(xhr.responseText))
        }
        xhr.onerror = () => {
          settle(0, null)
        }
        xhr.ontimeout = () => {
          settle(0, null)
        }
        xhr.onabort = () => {
          settle(0, null)
        }
        // xhr.timeout özelliğini desteklemeyen tarayıcılar için yedek zamanlayıcı
        backupTimer = setTimeout(() => {
          abortRequest(xhr)
          settle(0, null)
        }, timeoutMs + BACKUP_TIMER_EXTRA_MS)
        xhr.send(method === 'GET' ? null : JSON.stringify(opts.body || {}))
      } catch (err) {
        settle(0, null)
      }
    })
    promise.abort = () => {
      abortRequest(xhr)
    }
    return promise
  }

  function errorMessage (res, fallback) {
    if (res.data && typeof res.data.error === 'string' && res.data.error) {
      return res.data.error
    }
    if (res.status === 0) {
      return TEXT_UNREACHABLE
    }
    return fallback
  }

  function isState (data) {
    return Boolean(data) && typeof data.token === 'string' && data.token !== '' && typeof data.nick === 'string'
  }

  function toCount (value) {
    const number = Number(value)
    return isFinite(number) && number > 0 ? Math.floor(number) : 0
  }

  function isPositiveInteger (value) {
    return typeof value === 'number' && value > 0 && Math.floor(value) === value
  }

  function wait (ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms)
    })
  }

  function retryDelayMs (failures) {
    return Math.min(MAX_RETRY_SECONDS, Math.pow(2, failures - 1)) * 1000
  }

  // Yardımcı DOM ve biçimlendirme işlevleri

  function byId (id) {
    return document.getElementById(id)
  }

  function clearChildren (node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild)
    }
  }

  function pad2 (value) {
    return value < 10 ? '0' + value : String(value)
  }

  function toDate (ts) {
    const date = new Date(typeof ts === 'number' ? ts : Date.now())
    return isNaN(date.getTime()) ? new Date() : date
  }

  function formatClock (date) {
    return pad2(date.getHours()) + ':' + pad2(date.getMinutes())
  }

  function formatFull (date) {
    return pad2(date.getDate()) + '.' + pad2(date.getMonth() + 1) + '.' + date.getFullYear() + ' ' + formatClock(date)
  }

  // Takma ad için basit karma, aynı ad her zaman aynı rengi alır
  function nickColorClass (nick) {
    let hash = 7
    Array.from(String(nick).toLowerCase()).forEach((ch) => {
      hash = (hash * 31 + ch.charCodeAt(0)) % 2147483647
    })
    return 'nick-c' + (hash % NICK_COLOR_COUNT)
  }

  function updateTitle () {
    document.title = state.unread > 0 ? '(' + state.unread + ') ' + BASE_TITLE : BASE_TITLE
  }

  function setRoomName (name) {
    el.joinRoom.textContent = name
    el.roomName.textContent = name
  }

  function showJoinError (message) {
    el.joinError.textContent = message || ''
  }

  function setJoinBusy (busy) {
    state.joinBusy = busy
    el.joinSubmit.disabled = busy || !state.infoReady
  }

  // Durum satırı: geçici uyarı varsa o, yoksa bağlantı durumu gösterilir

  function renderStatus () {
    const stick = state.inChat && isNearBottom()
    el.status.textContent = state.flashText || (state.connectionLost ? TEXT_RECONNECTING : '')
    // Durum satırı mesaj alanını daraltır, alttaysa son mesaj görünür kalır
    if (stick) {
      scrollToBottom()
    }
  }

  function setConnectionLost (lost) {
    state.connectionLost = lost
    renderStatus()
  }

  function flashStatus (text) {
    clearTimeout(state.flashTimer)
    state.flashText = text
    renderStatus()
    state.flashTimer = setTimeout(() => {
      state.flashText = ''
      renderStatus()
    }, FLASH_MS)
  }

  function clearFlash () {
    clearTimeout(state.flashTimer)
    state.flashText = ''
    renderStatus()
  }

  // Kaydırma

  function isNearBottom () {
    const box = el.messages
    return box.scrollHeight - box.scrollTop - box.clientHeight <= SCROLL_STICK_PX
  }

  function scrollToBottom () {
    el.messages.scrollTop = el.messages.scrollHeight
    state.stickToBottom = true
  }

  function trimRenderedMessages () {
    const box = el.messages
    while (box.childNodes.length > MAX_RENDERED_MESSAGES) {
      box.removeChild(box.firstChild)
    }
  }

  // Mesaj ve kişi listesi çizimi (yalnızca textContent ve createElement)

  function renderMessage (message) {
    const item = document.createElement('div')
    const date = toDate(message.ts)
    const text = typeof message.text === 'string' ? message.text : ''
    if (message.type === 'system') {
      item.className = 'msg system'
      item.textContent = text
      item.setAttribute('title', formatFull(date))
      return item
    }
    const nick = typeof message.nick === 'string' ? message.nick : ''
    item.className = nick === state.nick ? 'msg own' : 'msg'

    const head = document.createElement('div')
    head.className = 'msg-head'

    const time = document.createElement('span')
    time.className = 'msg-time'
    time.textContent = formatClock(date)
    time.setAttribute('title', formatFull(date))

    const name = document.createElement('span')
    name.className = 'msg-nick ' + nickColorClass(nick)
    name.textContent = nick

    const body = document.createElement('div')
    body.className = 'msg-text'
    body.textContent = text

    head.appendChild(time)
    head.appendChild(name)
    item.appendChild(head)
    item.appendChild(body)
    return item
  }

  function appendMessages (list, options) {
    if (!Array.isArray(list) || list.length === 0) {
      return
    }
    const wasNearBottom = isNearBottom()
    const fragment = document.createDocumentFragment()
    let added = 0
    let othersChat = 0
    let ownArrived = false
    list.forEach((message) => {
      if (!message || typeof message.id !== 'number' || message.id <= state.lastId) {
        return
      }
      state.lastId = message.id
      fragment.appendChild(renderMessage(message))
      added += 1
      if (message.type !== 'system') {
        if (message.nick === state.nick) {
          ownArrived = true
        } else {
          othersChat += 1
        }
      }
    })
    if (added === 0) {
      return
    }
    el.messages.appendChild(fragment)
    if (options.countUnread && othersChat > 0 && document.hidden) {
      state.unread += othersChat
      updateTitle()
    }
    if (options.forceScroll || wasNearBottom || ownArrived) {
      trimRenderedMessages()
      scrollToBottom()
    }
  }

  function renderUsers (users) {
    if (!Array.isArray(users)) {
      return
    }
    const fragment = document.createDocumentFragment()
    users.forEach((entry) => {
      const name = typeof entry === 'string' ? entry : ''
      if (!name) {
        return
      }
      const item = document.createElement('li')
      item.className = nickColorClass(name)
      if (name === state.nick) {
        item.className += ' own'
        item.textContent = name + ' (sen)'
      } else {
        item.textContent = name
      }
      fragment.appendChild(item)
    })
    clearChildren(el.users)
    el.users.appendChild(fragment)
    el.onlineCount.textContent = users.length + ' çevrimiçi'
  }

  function setUsersOpen (open) {
    state.usersOpen = open
    if (open) {
      el.chatView.classList.add('users-open')
    } else {
      el.chatView.classList.remove('users-open')
    }
    el.toggleUsers.setAttribute('aria-expanded', open ? 'true' : 'false')
  }

  // Görünümler

  function showJoin (message) {
    stopPolling()
    clearFlash()
    state.inChat = false
    state.viewEpoch += 1
    state.connectionLost = false
    state.unread = 0
    setUsersOpen(false)
    el.chatView.hidden = true
    el.joinView.hidden = false
    const savedNick = state.nick || storeGet(NICK_KEY)
    if (savedNick) {
      el.nick.value = savedNick
    }
    if (state.passwordRequired && state.password && !el.password.value) {
      el.password.value = state.password
    }
    showJoinError(message)
    setJoinBusy(false)
    updateTitle()
    if (el.nick.value) {
      el.joinSubmit.focus()
    } else {
      el.nick.focus()
    }
  }

  function enterChat (data) {
    state.token = data.token
    state.nick = data.nick
    state.inChat = true
    state.lastId = 0
    state.unread = 0
    state.connectionLost = false
    storeSet(TOKEN_KEY, data.token)
    storeSet(NICK_KEY, data.nick)
    if (typeof data.room === 'string' && data.room) {
      setRoomName(data.room)
    }
    showJoinError('')
    clearFlash()
    clearChildren(el.messages)
    el.joinView.hidden = true
    el.chatView.hidden = false
    appendMessages(data.messages, { forceScroll: true, countUnread: false })
    state.lastId = Math.max(state.lastId, toCount(data.lastId))
    renderUsers(data.users)
    updateTitle()
    scrollToBottom()
    el.text.focus()
    startPolling()
  }

  // Long-polling döngüsü. Her başlatmada nesil sayacı artar,
  // eski döngüler bir sonraki adımda sessizce sonlanır.

  function startPolling () {
    stopPolling()
    pollLoop(state.pollGeneration)
  }

  function stopPolling () {
    state.pollGeneration += 1
    const pending = state.activePoll
    state.activePoll = null
    if (pending) {
      pending.abort()
    }
  }

  async function pollLoop (generation) {
    let failures = 0
    while (generation === state.pollGeneration) {
      const pending = request('GET', '/api/poll?since=' + state.lastId, { token: state.token, timeout: POLL_TIMEOUT_MS })
      state.activePoll = pending
      const res = await pending
      if (generation !== state.pollGeneration) {
        return
      }
      state.activePoll = null
      if (res.status === 200 && res.data) {
        failures = 0
        try {
          handlePollData(res.data)
        } catch (err) {
          // Beklenmeyen bir çizim hatası döngüyü durdurmamalı
          window.console.error(err)
        }
      } else if (res.status === 401) {
        handleSessionLost()
        return
      } else {
        failures += 1
        setConnectionLost(true)
        await wait(retryDelayMs(failures))
      }
    }
  }

  function handlePollData (data) {
    setConnectionLost(false)
    appendMessages(data.messages, { forceScroll: false, countUnread: true })
    const lastId = toCount(data.lastId)
    if (lastId > state.lastId) {
      state.lastId = lastId
    }
    renderUsers(data.users)
  }

  // Bağlantı geri geldiğinde bekleme süresini atlayıp hemen yeniden dene
  function recoverConnection () {
    if (state.inChat && state.connectionLost && !state.rejoinBusy) {
      startPolling()
    }
  }

  // Oturum geçersizleşti (401). Bellekte bilgiler varsa sessizce yeniden katılır.
  async function handleSessionLost () {
    if (!state.inChat || state.rejoinBusy) {
      return
    }
    stopPolling()
    const epoch = state.viewEpoch
    const nick = state.nick
    const password = state.password
    state.token = ''
    storeRemove(TOKEN_KEY)
    if (nick && (!state.passwordRequired || password)) {
      state.rejoinBusy = true
      const body = { nick: nick }
      if (state.passwordRequired) {
        body.password = password
      }
      const res = await request('POST', '/api/join', { body: body })
      state.rejoinBusy = false
      if (epoch !== state.viewEpoch) {
        // Bu arada kullanıcı çıktıysa yeni oturum da kapatılır
        if (res.status === 200 && isState(res.data)) {
          request('POST', '/api/leave', { token: res.data.token })
        }
        return
      }
      if (res.status === 200 && isState(res.data)) {
        enterChat(res.data)
        return
      }
    }
    showJoin(TEXT_SESSION_ENDED)
  }

  // Kullanıcı eylemleri

  async function submitJoin () {
    if (state.joinBusy || !state.infoReady) {
      return
    }
    const nick = el.nick.value.replace(/\s+/g, ' ').trim()
    const password = state.passwordRequired ? el.password.value : ''
    const length = Array.from(nick).length
    if (length < state.nickMin || length > state.nickMax) {
      showJoinError('Takma ad ' + state.nickMin + ' ile ' + state.nickMax + ' karakter arasında olmalı.')
      el.nick.focus()
      return
    }
    if (state.passwordRequired && !password) {
      showJoinError('Lütfen oda şifresini yaz.')
      el.password.focus()
      return
    }
    showJoinError('')
    setJoinBusy(true)
    const body = { nick: nick }
    if (state.passwordRequired) {
      body.password = password
    }
    const res = await request('POST', '/api/join', { body: body })
    setJoinBusy(false)
    if (res.status === 200 && isState(res.data)) {
      // Şifre yalnızca bellekte tutulur, otomatik yeniden katılma için
      state.password = password
      el.password.value = ''
      enterChat(res.data)
      return
    }
    showJoinError(errorMessage(res, 'Sohbete katılınamadı, lütfen tekrar dene.'))
  }

  async function submitSend () {
    if (state.sendBusy || !state.inChat) {
      return
    }
    const text = el.text.value.trim()
    if (!text) {
      return
    }
    state.sendBusy = true
    el.sendSubmit.disabled = true
    const res = await request('POST', '/api/send', { token: state.token, body: { text: text } })
    state.sendBusy = false
    el.sendSubmit.disabled = false
    if (res.status === 200) {
      el.text.value = ''
      el.text.focus()
      return
    }
    if (res.status === 401) {
      handleSessionLost()
      return
    }
    flashStatus(errorMessage(res, 'Mesaj gönderilemedi.'))
  }

  function leaveChat () {
    const token = state.token
    state.token = ''
    storeRemove(TOKEN_KEY)
    showJoin('')
    if (token) {
      // Yanıt önemsiz
      request('POST', '/api/leave', { token: token })
    }
  }

  function onVisibilityChange () {
    if (document.hidden) {
      return
    }
    state.unread = 0
    updateTitle()
    recoverConnection()
  }

  // Açılış

  function applyInfo (info) {
    state.infoReady = true
    state.passwordRequired = info.passwordRequired === true
    if (isPositiveInteger(info.maxMessageLength)) {
      state.maxMessageLength = info.maxMessageLength
    }
    if (isPositiveInteger(info.nickMin)) {
      state.nickMin = info.nickMin
    }
    if (isPositiveInteger(info.nickMax)) {
      state.nickMax = info.nickMax
    }
    setRoomName(typeof info.room === 'string' && info.room ? info.room : BASE_TITLE)
    el.passwordRow.hidden = !state.passwordRequired
    el.text.setAttribute('maxlength', String(state.maxMessageLength))
    el.nick.setAttribute('maxlength', String(state.nickMax))
  }

  async function tryResume () {
    const saved = storeGet(TOKEN_KEY)
    if (saved) {
      // Oturum sürdürülürken katılma formu gösterilmez
      el.joinView.hidden = true
      setJoinBusy(true)
      const res = await request('POST', '/api/resume', { body: { token: saved } })
      setJoinBusy(false)
      if (res.status === 200 && isState(res.data)) {
        enterChat(res.data)
        return
      }
      storeRemove(TOKEN_KEY)
    }
    showJoin('')
  }

  async function loadInfo () {
    const res = await request('GET', '/api/info')
    if (res.status !== 200 || !res.data) {
      el.joinView.hidden = false
      showJoinError(TEXT_UNREACHABLE)
      setTimeout(loadInfo, INFO_RETRY_MS)
      return
    }
    applyInfo(res.data)
    showJoinError('')
    await tryResume()
  }

  function init () {
    el.joinView = byId('join-view')
    el.joinRoom = byId('join-room')
    el.joinForm = byId('join-form')
    el.nick = byId('nick')
    el.passwordRow = byId('password-row')
    el.password = byId('password')
    el.joinError = byId('join-error')
    el.joinSubmit = byId('join-submit')
    el.chatView = byId('chat-view')
    el.roomName = byId('room-name')
    el.onlineCount = byId('online-count')
    el.toggleUsers = byId('toggle-users')
    el.leave = byId('leave')
    el.messages = byId('messages')
    el.users = byId('users')
    el.status = byId('status')
    el.sendForm = byId('send-form')
    el.text = byId('text')
    el.sendSubmit = byId('send-submit')

    el.joinForm.addEventListener('submit', (event) => {
      event.preventDefault()
      submitJoin()
    })
    el.sendForm.addEventListener('submit', (event) => {
      event.preventDefault()
      submitSend()
    })
    el.leave.addEventListener('click', () => {
      leaveChat()
    })
    el.toggleUsers.addEventListener('click', () => {
      setUsersOpen(!state.usersOpen)
    })
    el.messages.addEventListener('scroll', () => {
      state.stickToBottom = isNearBottom()
    })
    window.addEventListener('resize', () => {
      if (state.inChat && state.stickToBottom) {
        scrollToBottom()
      }
    })
    document.addEventListener('keydown', (event) => {
      if (state.usersOpen && (event.key === 'Escape' || event.keyCode === 27)) {
        setUsersOpen(false)
        el.toggleUsers.focus()
      }
    })
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', recoverConnection)

    const savedNick = storeGet(NICK_KEY)
    if (savedNick) {
      el.nick.value = savedNick
    }
    // Katılma görünümü HTML'de gizli başlar. Saklı oturum varsa önce sürdürme denenir.
    el.joinView.hidden = Boolean(storeGet(TOKEN_KEY))
    setJoinBusy(false)
    updateTitle()
    loadInfo()
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
}
