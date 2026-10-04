'use strict'

// Açılış, kurulum, davet, giriş, kayıt ve anahtar ekranları ile oturum yaşam döngüsü. Giriş ve kayıtta
// parola istemcide türetilir (16-identity.js), sunucuya yalnızca kimlik doğrulama anahtarı gider.

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
  // Giriş kartının hangi bölümü gösterdiği (people.css telsiz gövdesi biçimi için)
  el.authView.setAttribute('data-card', name)
  AUTH_CARDS.forEach((card) => {
    el[card + 'Card'].hidden = card !== name
  })
  setMsg(el.authNotice, notice || '', 'error')
  el.authServerName.textContent = state.serverName
  document.title = state.serverName
  // Frekans tanıtımı gizlenir, giriş kartında "Telsiz'i tanı" düğmesi görünür (25-tanitim.js)
  if (typeof tanitimHide === 'function') tanitimHide(name)
}

function setFormBusy (form, busy) {
  Array.from(form.querySelectorAll('button, input')).forEach((node) => {
    node.disabled = busy
  })
  form.classList.toggle('is-busy', busy)
}

// Adresteki #davet=, #anahtar= ve #frekanslar= parçaları. Frekans listesi (24-frekans.js) başka bir
// frekanstan geçişte gelir, yalnızca adres ve ad taşır, doğrulanarak bu tarayıcının listesine eklenir.

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
  if (typeof params.frekanslar === 'string') {
    touched = true
    if (typeof frekansMergeFragment === 'function') frekansMergeFragment(params.frekanslar)
  }
  if (touched) {
    // Bağlantıyla gelen ziyaretçi tanıtım sayfasını görmeden kayda, girişe veya frekansa geçer (25-tanitim.js)
    state.fragmentSeen = true
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
  if (typeof frekansNoteName === 'function') frekansNoteName(state.serverName)
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
  // Oturumu olmayan ziyaretçi önce frekans tanıtımını görür (25-tanitim.js, koşullar orada)
  if (typeof tanitimShouldShow === 'function' && tanitimShouldShow()) {
    tanitimShow(false)
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
  prepareAuthForms()
  showAuthCard('setup')
  focusNode(el.setupName)
}

// Sorun varsa metni üreten fonksiyon, yoksa null döner. Kullanıcı adı kuralı ve parola uzunluğu
// istemcide denetlenir.
function validateNameAndPassword (name, password, password2) {
  const nameProblem = usernameProblem(name)
  if (nameProblem) return () => usernameProblemText(nameProblem)
  const passProblem = passwordProblem(password)
  if (passProblem) return passProblem
  if (password2 !== undefined && password !== password2) return () => t('auth.passwordMismatch')
  return null
}

// Kimlik ekranlarındaki hız sınırı metni (sunucu aynı kodu IP ve hesap sınırı için verir)
function authOverrides (extra) {
  return Object.assign({ rate_limited: t('auth.rateLimited') }, extra || {})
}

// Giriş, kurulum ve kayıt formlarına canlı ad denetimi, küçük harf ve parola gücü göstergesi bir
// kez bağlanır. Yardımcı öğeler (durum satırı, güç göstergesi) yoksa forma eklenir.
let authFormsReady = false
const authHelpers = {}

function prepareAuthForms () {
  if (authFormsReady) return
  authFormsReady = true
  const setupStatus = ensureAfter(el.setupName, 'setup-name-status', 'p', 'field-status hint')
  setupStatus.setAttribute('aria-live', 'polite')
  setupStatus.hidden = true
  const registerStatus = ensureAfter(byId('register-name-hint') || el.registerName, 'register-name-status', 'p', 'field-status hint')
  registerStatus.setAttribute('aria-live', 'polite')
  registerStatus.hidden = true
  authHelpers.setupCheck = createNameChecker(el.setupName, setupStatus, el.setupCode)
  authHelpers.registerCheck = createNameChecker(el.registerName, registerStatus, el.registerInvite)
  authHelpers.setupStrength = buildStrengthMeter(el.setupPassword, 'setup-password-strength')
  authHelpers.registerStrength = buildStrengthMeter(el.registerPassword, 'register-password-strength')
  const nameInputs = [el.setupName, el.registerName, el.loginName]
  nameInputs.forEach((input) => {
    input.maxLength = USERNAME_MAX_INPUT
    input.setAttribute('autocapitalize', 'none')
    input.setAttribute('spellcheck', 'false')
  })
  el.loginName.addEventListener('input', () => {
    lowercaseInput(el.loginName)
  })
  el.setupName.addEventListener('input', () => {
    lowercaseInput(el.setupName)
    authHelpers.setupCheck.run()
  })
  el.setupCode.addEventListener('input', () => {
    authHelpers.setupCheck.run()
  })
  el.registerName.addEventListener('input', () => {
    lowercaseInput(el.registerName)
    authHelpers.registerCheck.run()
  })
  el.registerInvite.addEventListener('input', () => {
    authHelpers.registerCheck.run()
  })
  el.setupPassword.addEventListener('input', () => {
    updateStrengthMeter(authHelpers.setupStrength, el.setupPassword.value)
  })
  el.registerPassword.addEventListener('input', () => {
    updateStrengthMeter(authHelpers.registerStrength, el.registerPassword.value)
  })
}

function clearPasswordFields (list) {
  list.forEach((input) => {
    if (input) input.value = ''
  })
  updateStrengthMeter(authHelpers.setupStrength, '')
  updateStrengthMeter(authHelpers.registerStrength, '')
}

async function submitSetup (e) {
  e.preventDefault()
  if (el.setupForm.classList.contains('is-busy')) return
  const name = cleanUsername(el.setupName.value)
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
  const progress = progressLine(el.setupForm)
  const result = await registerAccount(name, password, 'setupCode', code, (pct) => {
    showProgress(progress, pct)
  })
  showProgress(progress, null)
  if (!result.ok) {
    setFormBusy(el.setupForm, false)
    const res = result.res
    setMsg(el.setupError, result.error || (() => errorText(res, t('auth.setupFailed'), authOverrides({ bad_code: t('auth.setupCodeWrong') }))), 'error')
    return
  }
  setToken(result.token)
  clearPasswordFields([el.setupPassword, el.setupPassword2])
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
  prepareAuthForms()
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

// Giriş: ön giriş, paroladan anahtar türetme (ilerleme yüzdesi), /api/login ve özel anahtarın
// bu cihazda açılması. Parola sunucuya gönderilmez.
async function submitLogin (e) {
  e.preventDefault()
  if (el.loginForm.classList.contains('is-busy')) return
  const name = cleanUsername(el.loginName.value)
  const password = el.loginPassword.value
  if (!name || !password) {
    setMsg(el.loginError, () => t('auth.enterNameAndPassword'), 'error')
    return
  }
  if (!cryptoReady()) {
    setMsg(el.loginError, () => t('boot.noCrypto'), 'error')
    return
  }
  setMsg(el.loginError, '')
  setFormBusy(el.loginForm, true)
  const progress = progressLine(el.loginForm)
  const result = await loginWithPassword(name, password, (pct) => {
    showProgress(progress, pct)
  })
  showProgress(progress, null)
  setFormBusy(el.loginForm, false)
  if (!result.ok) {
    setMsg(el.loginError, result.error, 'error')
    focusNode(el.loginPassword)
    return
  }
  el.loginPassword.value = ''
  setToken(result.token)
  if (result.keysReset) state.fragmentNotice = { kind: 'ok', text: () => t('identity.keysReset') }
  await resumeSession()
}

async function submitRegister (e) {
  e.preventDefault()
  if (el.registerForm.classList.contains('is-busy')) return
  const name = cleanUsername(el.registerName.value)
  const password = el.registerPassword.value
  const invite = el.registerInvite.value.trim()
  const problem = validateNameAndPassword(name, password, el.registerPassword2.value) || (invite ? null : () => t('auth.enterInvite'))
  if (problem) {
    setMsg(el.registerError, problem, 'error')
    return
  }
  if (!cryptoReady()) {
    setMsg(el.registerError, () => t('boot.noCrypto'), 'error')
    return
  }
  setMsg(el.registerError, '')
  setFormBusy(el.registerForm, true)
  const progress = progressLine(el.registerForm)
  const result = await registerAccount(name, password, 'inviteCode', invite, (pct) => {
    showProgress(progress, pct)
  })
  showProgress(progress, null)
  setFormBusy(el.registerForm, false)
  if (result.ok) {
    clearPasswordFields([el.registerPassword, el.registerPassword2])
    storeRemove(KEYS.invite, 'session')
    setToken(result.token)
    // Kayıttan sonra isteğe bağlı profil adımı (görünen ad)
    identityState.profileStep = true
    await resumeSession()
    return
  }
  const res = result.res
  setMsg(el.registerError, result.error || (() => errorText(res, t('auth.registerFailed'), authOverrides({ bad_code: t('auth.inviteCodeWrong') }))), 'error')
}

// Anahtar ekranı

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
  enterApp()
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
    enterApp()
  })
}

function skipKey () {
  state.keySkipped = true
  enterApp()
}

// Oturum yaşam döngüsü

function applyStateData (data) {
  state.me = { id: data.me.id, name: String(data.me.name || ''), role: data.me.role, status: typeof data.me.status === 'string' ? data.me.status : 'online' }
  state.boot = String(data.boot || '')
  state.seq = Number(data.seq) || 0
  state.metaVersion = Number(data.metaVersion) || 0
  state.sigSeq = Number(data.sigSeq) || 0
  state.inviteCode = typeof data.inviteCode === 'string' ? data.inviteCode : null
  state.bannedUsers = Array.isArray(data.bannedUsers) ? data.bannedUsers : state.bannedUsers
  setServerKeys(data.keys)
  setFormerUsers(data.formerUsers)
  if (data.meta) applyMeta(data.meta, true)
  socialApplyState(data)
  // Telsiz DJ: /api/state yanıtındaki müzik haritası, sunucu saati ve meta motora verilir
  if (typeof djIngestState === 'function') djIngestState(data)
}

// Sayfa açılırken sunucu yanıtı yeni modüllerden önce gelirse modüller yüklenene kadar beklenir
let sessionStartDeferred = false

function startSession (data) {
  if (typeof identityModuleReady !== 'function' && !sessionStartDeferred && document.readyState !== 'complete') {
    sessionStartDeferred = true
    document.addEventListener('DOMContentLoaded', () => {
      startSession(data)
    })
    return
  }
  state.sessionLost = false
  applyStateData(data)
  if (typeof tanitimRemember === 'function') tanitimRemember()
  state.lastRead = storeGetJson(userKey('read'), {})
  if (!hasActiveKey() && !state.keySkipped) {
    showKeyScreen()
    showFragmentNotice()
    return
  }
  enterApp()
}

// Uygulama ekranını açar, ardından arkadaşlar, özel mesajlar ve profiller hazırlanır
function enterApp () {
  openApp()
  socialAfterOpen()
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
  if (state.me) forgetIdentity(state.me.id)
  clearToken()
  resetAppState()
  showLogin(() => t(reason === 'banned' ? 'auth.banned' : 'auth.sessionEnded'))
}

async function logout () {
  const token = state.token
  const me = state.me
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
  // Özel anahtar yalnızca oturum açıkken bu cihazda kalır
  if (me) forgetIdentity(me.id)
  clearToken()
  resetAppState()
  showLogin('')
}

function resetAppState () {
  closeAllLayers()
  socialReset()
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
  identityState.keys = null
  clearAttachments()
  decryptCache.clear()
  clear(el.messageList)
  clear(el.bandTrack)
  if (typeof bandReset === 'function') bandReset()
  if (typeof closeSheets === 'function') closeSheets()
  clear(el.voiceChannels)
  clear(el.membersOnline)
  clear(el.membersOffline)
  el.composerInput.value = ''
  el.connBanner.hidden = true
  updateTitle()
}
