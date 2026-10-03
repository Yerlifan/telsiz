'use strict'

// Açılış, kurulum, davet, giriş, kayıt ve anahtar ekranları ile oturum yaşam döngüsü.

// Görünümler

function showView (name) {
  el.bootView.hidden = name !== 'boot'
  el.authView.hidden = name !== 'auth'
  el.appView.hidden = name !== 'app'
  document.body.classList.toggle('in-app', name === 'app')
}

// Metin dize veya () => t('...') olabilir, varsayılan "Bağlanılıyor..."
function showBoot (text, canRetry) {
  showView('boot')
  setLive(el.bootText, text || (() => t('boot.connecting')))
  el.bootRetry.hidden = !canRetry
}

const AUTH_CARDS = ['setup', 'invite', 'login', 'key']

function showAuthCard (name, notice) {
  showView('auth')
  AUTH_CARDS.forEach((card) => {
    el[card + 'Card'].hidden = card !== name
  })
  setMsg(el.authNotice, notice || '', 'error')
  el.authServerName.textContent = state.serverName
  document.title = state.serverName
}

function setFormBusy (form, busy) {
  Array.from(form.querySelectorAll('button, input')).forEach((node) => {
    node.disabled = busy
  })
  form.classList.toggle('is-busy', busy)
}

// Adresteki #davet= ve #anahtar= parçaları (5.2 adım 1)

function parseFragment (text) {
  const out = Object.create(null)
  String(text || '').split('&').forEach((part) => {
    const eq = part.indexOf('=')
    if (eq <= 0) return
    const key = part.slice(0, eq)
    let value = part.slice(eq + 1)
    try {
      value = decodeURIComponent(value.replace(/\+/g, ' '))
    } catch (err) {
      // Kodlanmamış değer olduğu gibi kullanılır
    }
    out[key] = value
  })
  return out
}

function readFragment () {
  const hash = window.location.hash || ''
  if (hash.length < 2) return
  const params = parseFragment(hash.slice(1))
  let touched = false
  if (typeof params.davet === 'string') {
    touched = true
    const code = params.davet.trim()
    if (code) storeSet(KEYS.invite, code, 'session')
  }
  if (typeof params.anahtar === 'string') {
    touched = true
    if (cryptoReady()) {
      try {
        window.E2EE.keyring.add(params.anahtar)
        state.fragmentNotice = { kind: 'ok', text: () => t('fragment.keyAdded') }
      } catch (err) {
        state.fragmentNotice = { kind: 'error', text: () => t('fragment.keyInvalid', { reason: keyErrorText(err) }) }
      }
    }
  }
  if (touched) {
    try {
      window.history.replaceState(null, document.title, window.location.pathname + window.location.search)
    } catch (err) {
      window.location.hash = ''
    }
  }
}

function showFragmentNotice () {
  const notice = state.fragmentNotice
  if (!notice) return
  state.fragmentNotice = null
  toast(notice.text, notice.kind, notice.kind === 'error' ? 10000 : TOAST_MS)
}

// Açılış

function applyInfo (info) {
  state.info = info
  if (typeof info.serverName === 'string' && info.serverName) state.serverName = info.serverName
  const limits = info.limits && typeof info.limits === 'object' ? info.limits : {}
  Object.keys(state.limits).forEach((key) => {
    const value = limits[key]
    if (typeof value === 'number' && isFinite(value) && value > 0) state.limits[key] = value
  })
  document.title = state.serverName
}

async function loadInfo () {
  showBoot(null, false)
  const res = await request('GET', '/api/info', { token: '' })
  if (res.status !== 200 || !res.data) {
    showBoot(() => t('boot.unreachableRetry'), true)
    setTimeout(() => {
      if (!el.bootView.hidden) loadInfo()
    }, INFO_RETRY_MS)
    return
  }
  applyInfo(res.data)
  if (res.data.setupRequired === true) {
    showSetup()
    return
  }
  const saved = storeGet(KEYS.token)
  if (saved) {
    state.token = saved
    await resumeSession()
    return
  }
  showLogin('')
}

async function resumeSession () {
  showBoot(null, false)
  const res = await request('GET', '/api/state')
  if (res.status === 200 && res.data && res.data.me) {
    startSession(res.data)
    return
  }
  if (res.status === 401) {
    clearToken()
    showLogin(() => t('auth.sessionEnded'))
    return
  }
  if (res.status === 403 && res.data && res.data.code === 'banned') {
    clearToken()
    showLogin(() => t('auth.banned'))
    return
  }
  showBoot(() => errorText(res, t('net.unreachable')), true)
}

function setToken (token) {
  state.token = token
  state.sessionLost = false
  storeSet(KEYS.token, token)
}

function clearToken () {
  state.token = ''
  storeRemove(KEYS.token)
}

// Kurulum ekranı (sahip hesabı)

function showSetup () {
  showAuthCard('setup')
  focusNode(el.setupName)
}

// Sorun varsa metni üreten fonksiyon, yoksa null döner
function validateNameAndPassword (name, password, password2) {
  const limits = state.limits
  const len = cpLength(name)
  if (len < limits.nameMin || len > limits.nameMax) {
    return () => t('auth.nameLength', { min: limits.nameMin, max: limits.nameMax })
  }
  const plen = cpLength(password)
  if (plen < limits.passwordMin || plen > limits.passwordMax) {
    return () => t('auth.passwordLength', { min: limits.passwordMin, max: limits.passwordMax })
  }
  if (password2 !== undefined && password !== password2) return () => t('auth.passwordMismatch')
  return null
}

// Kimlik ekranlarındaki hız sınırı metni (sunucu aynı kodu IP ve hesap sınırı için verir)
function authOverrides (extra) {
  return Object.assign({ rate_limited: t('auth.rateLimited') }, extra || {})
}

async function submitSetup (e) {
  e.preventDefault()
  if (el.setupForm.classList.contains('is-busy')) return
  const name = normalizeName(el.setupName.value)
  const password = el.setupPassword.value
  const code = el.setupCode.value.trim()
  const problem = validateNameAndPassword(name, password, el.setupPassword2.value) || (code ? null : () => t('auth.enterSetupCode'))
  if (problem) {
    setMsg(el.setupError, problem, 'error')
    return
  }
  if (!cryptoReady()) {
    setMsg(el.setupError, () => t('boot.noCrypto'), 'error')
    return
  }
  setMsg(el.setupError, '')
  setFormBusy(el.setupForm, true)
  const res = await request('POST', '/api/register', { token: '', body: { name: name, password: password, setupCode: code } })
  if (res.status !== 200 || !res.data || typeof res.data.token !== 'string') {
    setFormBusy(el.setupForm, false)
    setMsg(el.setupError, () => errorText(res, t('auth.setupFailed'), authOverrides({ bad_code: t('auth.setupCodeWrong') })), 'error')
    return
  }
  setToken(res.data.token)
  el.setupPassword.value = ''
  el.setupPassword2.value = ''
  const created = await createGroupKey()
  const st = await api('GET', '/api/state')
  setFormBusy(el.setupForm, false)
  if (st.status !== 200 || !st.data || !st.data.me) {
    setMsg(el.setupError, () => errorText(st, t('auth.stateFailed')), 'error')
    return
  }
  if (!created.ok) {
    startSession(st.data)
    toast(created.error, 'error', 10000)
    return
  }
  showInvite(st.data.inviteCode, created.code, () => {
    startSession(st.data)
  })
}

// Yeni grup anahtarı üretir, anahtarlığa ekler ve sunucuda etkin anahtar kimliğini ayarlar.
async function createGroupKey () {
  let code = ''
  let kid = ''
  try {
    code = window.E2EE.generateKeyCode()
    kid = window.E2EE.keyring.add(code)
  } catch (err) {
    return { ok: false, error: () => t('key.createFailed') }
  }
  const res = await api('POST', '/api/settings', { activeKid: kid })
  if (res.status !== 200) {
    return { ok: false, error: () => errorText(res, t('key.activateFailed')), code: code, kid: kid }
  }
  if (state.meta) state.meta.activeKid = kid
  return { ok: true, code: code, kid: kid }
}

function inviteLink (inviteCode, keyCode) {
  const origin = window.location.origin || (window.location.protocol + '//' + window.location.host)
  const parts = []
  if (inviteCode) parts.push('davet=' + encodeURIComponent(inviteCode))
  if (keyCode) parts.push('anahtar=' + encodeURIComponent(keyCode))
  return origin + '/#' + parts.join('&')
}

// Davet ekranı

function showInvite (inviteCode, keyCode, next) {
  state.afterInvite = next
  el.inviteLink.value = inviteLink(inviteCode, keyCode)
  el.inviteKey.value = keyCode
  showAuthCard('invite')
  focusNode(el.inviteCopyLink)
}

function continueFromInvite () {
  const next = state.afterInvite
  state.afterInvite = null
  el.inviteLink.value = ''
  el.inviteKey.value = ''
  if (typeof next === 'function') next()
}

// Giriş ve kayıt ekranı

function showLogin (notice) {
  const invite = storeGet(KEYS.invite, 'session')
  if (invite && !el.registerInvite.value) el.registerInvite.value = invite
  showAuthCard('login', notice)
  selectAuthTab(invite ? 'register' : 'login', false)
  focusNode(invite ? el.registerName : el.loginName)
}

function selectAuthTab (name, focusTab) {
  const login = name === 'login'
  el.authTabLogin.setAttribute('aria-selected', login ? 'true' : 'false')
  el.authTabRegister.setAttribute('aria-selected', login ? 'false' : 'true')
  el.authTabLogin.tabIndex = login ? 0 : -1
  el.authTabRegister.tabIndex = login ? -1 : 0
  el.loginForm.hidden = !login
  el.registerForm.hidden = login
  if (focusTab) focusNode(login ? el.authTabLogin : el.authTabRegister)
}

function onAuthTabKey (e) {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
    e.preventDefault()
    const loginSelected = el.authTabLogin.getAttribute('aria-selected') === 'true'
    selectAuthTab(loginSelected ? 'register' : 'login', true)
  }
}

async function submitLogin (e) {
  e.preventDefault()
  if (el.loginForm.classList.contains('is-busy')) return
  const name = normalizeName(el.loginName.value)
  const password = el.loginPassword.value
  if (!name || !password) {
    setMsg(el.loginError, () => t('auth.enterNameAndPassword'), 'error')
    return
  }
  setMsg(el.loginError, '')
  setFormBusy(el.loginForm, true)
  const res = await request('POST', '/api/login', { token: '', body: { name: name, password: password } })
  setFormBusy(el.loginForm, false)
  if (res.status === 200 && res.data && typeof res.data.token === 'string') {
    el.loginPassword.value = ''
    setToken(res.data.token)
    await resumeSession()
    return
  }
  setMsg(el.loginError, () => errorText(res, t('auth.loginFailed'), authOverrides()), 'error')
}

async function submitRegister (e) {
  e.preventDefault()
  if (el.registerForm.classList.contains('is-busy')) return
  const name = normalizeName(el.registerName.value)
  const password = el.registerPassword.value
  const invite = el.registerInvite.value.trim()
  const problem = validateNameAndPassword(name, password, el.registerPassword2.value) || (invite ? null : () => t('auth.enterInvite'))
  if (problem) {
    setMsg(el.registerError, problem, 'error')
    return
  }
  setMsg(el.registerError, '')
  setFormBusy(el.registerForm, true)
  const res = await request('POST', '/api/register', { token: '', body: { name: name, password: password, inviteCode: invite } })
  setFormBusy(el.registerForm, false)
  if (res.status === 200 && res.data && typeof res.data.token === 'string') {
    el.registerPassword.value = ''
    el.registerPassword2.value = ''
    storeRemove(KEYS.invite, 'session')
    setToken(res.data.token)
    await resumeSession()
    return
  }
  setMsg(el.registerError, () => errorText(res, t('auth.registerFailed'), authOverrides({ bad_code: t('auth.inviteCodeWrong') })), 'error')
}

// Anahtar ekranı (5.2 adım 5)

function isAdmin () {
  return Boolean(state.me && (state.me.role === 'owner' || state.me.role === 'admin'))
}

function isOwner () {
  return Boolean(state.me && state.me.role === 'owner')
}

function activeKid () {
  const kid = state.meta ? state.meta.activeKid : null
  return typeof kid === 'string' && KID_RE.test(kid) ? kid : null
}

function hasActiveKey () {
  const kid = activeKid()
  if (!kid || !cryptoReady()) return false
  try {
    return window.E2EE.keyring.has(kid)
  } catch (err) {
    return false
  }
}

function showKeyScreen () {
  const noActive = !activeKid()
  const memberWithoutKey = noActive && !isAdmin()
  setLive(el.keyIntro, () => t(memberWithoutKey ? 'key.introNoActive' : 'key.intro'))
  el.keyGenerateWrap.hidden = !(noActive && isAdmin())
  setMsg(el.keyError, '')
  el.keyInput.value = ''
  showAuthCard('key')
  focusNode(el.keyInput)
}

function submitKey (e) {
  e.preventDefault()
  const value = el.keyInput.value.trim()
  if (!value) {
    setMsg(el.keyError, () => t('errors.key.empty'), 'error')
    return
  }
  let kid = ''
  try {
    kid = window.E2EE.keyring.add(value)
  } catch (err) {
    setMsg(el.keyError, () => keyErrorText(err), 'error')
    return
  }
  el.keyInput.value = ''
  const active = activeKid()
  if (active && kid !== active) {
    setMsg(el.keyError, () => t('key.notActive'), 'error')
    return
  }
  toast(() => t('key.added'), 'ok')
  openApp()
}

async function generateFromKeyScreen () {
  if (!isAdmin()) return
  el.keyGenerate.disabled = true
  const created = await createGroupKey()
  el.keyGenerate.disabled = false
  if (!created.ok) {
    setMsg(el.keyError, created.error, 'error')
    return
  }
  showInvite(state.inviteCode, created.code, () => {
    openApp()
  })
}

function skipKey () {
  state.keySkipped = true
  openApp()
}

// Oturum yaşam döngüsü

function applyStateData (data) {
  state.me = { id: data.me.id, name: String(data.me.name || ''), role: data.me.role }
  state.boot = String(data.boot || '')
  state.seq = Number(data.seq) || 0
  state.metaVersion = Number(data.metaVersion) || 0
  state.sigSeq = Number(data.sigSeq) || 0
  state.inviteCode = typeof data.inviteCode === 'string' ? data.inviteCode : null
  state.bannedUsers = Array.isArray(data.bannedUsers) ? data.bannedUsers : state.bannedUsers
  if (data.meta) applyMeta(data.meta, true)
}

function startSession (data) {
  state.sessionLost = false
  applyStateData(data)
  state.lastRead = storeGetJson(userKey('read'), {})
  if (!hasActiveKey() && !state.keySkipped) {
    showKeyScreen()
    showFragmentNotice()
    return
  }
  openApp()
}

function userKey (name) {
  return 'telsiz.' + name + '.' + (state.me ? state.me.id : '')
}

function handleSessionLost (reason) {
  if (state.sessionLost) return
  state.sessionLost = true
  stopPoll()
  if (voice) {
    try {
      voice.teardown()
    } catch (err) {
      // Yerel kapatma hatası önemsiz
    }
  }
  clearToken()
  resetAppState()
  showLogin(() => t(reason === 'banned' ? 'auth.banned' : 'auth.sessionEnded'))
}

async function logout () {
  const token = state.token
  stopPoll()
  if (voice) {
    try {
      const current = voice.snapshot()
      if (current && current.channelId) {
        await Promise.race([voice.leave(), wait(3000)])
      } else {
        voice.teardown()
      }
    } catch (err) {
      // Ses kapatma hatası önemsiz
    }
  }
  if (token) {
    await request('POST', '/api/logout', { token: token, timeout: 5000 })
  }
  state.sessionLost = true
  clearToken()
  resetAppState()
  showLogin('')
}

function resetAppState () {
  closeAllLayers()
  state.inApp = false
  state.me = null
  state.meta = null
  state.inviteCode = null
  state.bannedUsers = null
  state.users = new Map()
  state.channelId = null
  state.messages = []
  state.nodes = new Map()
  state.unread = Object.create(null)
  state.hiddenUnread = 0
  state.keySkipped = false
  state.connLost = false
  state.editingId = null
  state.voiceKey = ''
  clearAttachments()
  decryptCache.clear()
  clear(el.messageList)
  clear(el.textChannels)
  clear(el.voiceChannels)
  clear(el.membersOnline)
  clear(el.membersOffline)
  el.composerInput.value = ''
  el.connBanner.hidden = true
  updateTitle()
}
