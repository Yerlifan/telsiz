'use strict'

// Kişisel güvenlik anahtarı: paroladan anahtar türetme (ilerleme yüzdesiyle), kimlik anahtarı çiftinin
// üretilmesi, sarılması ve açılması, cihazda saklanan kimliğin yüklenmesi, kayıtlı oturumla açılışta
// parola isteyen kimlik açma penceresi, kimlik bağlamasının grup anahtarıyla mühürlenip yüklenmesi,
// parola değiştirme, kullanıcı adı değiştirme ve hesap silme yardımcıları.
// Parola sunucuya hiç gönderilmez: sunucuya yalnızca paroladan türetilen kimlik doğrulama anahtarı
// (authKey) gider. Özel anahtar yalnızca bellekte ve bu cihazın depolamasında tutulur.

const USERNAME_RE = /^[a-z0-9_.]{2,32}$/
const USERNAME_MAX_INPUT = 32
const NAME_CHECK_DELAY_MS = 400

const identityState = {
  keys: null,
  // Parola sıfırlandı: yeni anahtar çifti yalnızca yeni parolayla birlikte kurulur (sunucu /api/me/keys'i reddeder)
  resetPending: false,
  pair: null,
  pairUser: null,
  bindingKey: '',
  bindingBusy: false,
  unlockSkipped: false,
  profileStep: false
}

// Modüllerin yüklendiğini gösterir (açılışta erken gelen sunucu yanıtı için, bkz. startSession)
function identityModuleReady () {
  return true
}

// Kullanıcı adı kuralı: küçük İngilizce harf, rakam, alt çizgi ve nokta, 2..32 karakter, nokta ile
// başlayıp bitemez, iki nokta yan yana gelemez. Sorun yoksa null, varsa metin kodu döner.
function usernameProblem (name) {
  const text = String(name || '')
  if (!text) return 'empty'
  if (!USERNAME_RE.test(text)) return cpLength(text) < 2 || cpLength(text) > 32 ? 'length' : 'chars'
  if (text.charAt(0) === '.' || text.charAt(text.length - 1) === '.' || text.indexOf('..') !== -1) return 'dots'
  return null
}

function usernameProblemText (code) {
  if (code === 'empty') return t('auth.usernameEmpty')
  if (code === 'length') return t('auth.usernameLength', { min: 2, max: 32 })
  if (code === 'dots') return t('auth.usernameDots')
  return t('auth.usernameChars')
}

// Giriş alanındaki adı küçük harfe çevirir (yerel ayar kullanılmaz). İmleç yerinde kalır.
function lowercaseInput (input) {
  const value = input.value
  const lower = value.toLowerCase()
  if (lower === value) return
  let start = null
  let end = null
  try {
    start = input.selectionStart
    end = input.selectionEnd
  } catch (err) {
    start = null
  }
  input.value = lower
  if (start !== null && lower.length === value.length) {
    try {
      input.setSelectionRange(start, end)
    } catch (err) {
      // Seçim desteklenmiyor
    }
  }
}

function cleanUsername (value) {
  return String(value || '').trim().toLowerCase()
}

function passwordLimits () {
  return { min: state.limits.passwordMin || 8, max: state.limits.passwordMax || 128 }
}

// Parola uzunluğu istemcide denetlenir. Sorun varsa metin üreten fonksiyon, yoksa null.
function passwordProblem (password) {
  const limits = passwordLimits()
  const len = cpLength(password)
  if (len < limits.min || len > limits.max) {
    return () => t('auth.passwordLength', { min: limits.min, max: limits.max })
  }
  return null
}

// Basit parola gücü: 0 (çok zayıf) .. 4 (güçlü). Uzunluk ve karakter çeşitliliğine bakar.
function passwordStrength (password) {
  const text = String(password || '')
  const len = cpLength(text)
  if (len < passwordLimits().min) return 0
  let kinds = 0
  if (/[a-z]/.test(text)) kinds += 1
  if (/[A-Z]/.test(text)) kinds += 1
  if (/[0-9]/.test(text)) kinds += 1
  if (/[^A-Za-z0-9]/.test(text)) kinds += 1
  let score = 1
  if (len >= 12) score += 1
  if (len >= 16) score += 1
  if (kinds >= 3) score += 1
  if (kinds <= 1 && len < 16) score = Math.min(score, 1)
  return Math.max(1, Math.min(4, score))
}

const STRENGTH_KEYS = ['auth.strength0', 'auth.strength1', 'auth.strength2', 'auth.strength3', 'auth.strength4']

// Şifreleme modülünün hata kodunu metne çevirir
function identityErrorText (err) {
  const code = err && typeof err.code === 'string' ? err.code : ''
  if (code && hasText('identity.error.' + code)) return t('identity.error.' + code)
  return t('identity.error.generic')
}

function identityErrorProducer (err) {
  if (err && typeof err.uiText === 'function') return err.uiText
  return () => identityErrorText(err)
}

// Paroladan authKey ve wrapKey türetir. onPercent 0..100 tamsayı alır.
function deriveKeys (password, kdf, onPercent) {
  let last = -1
  const report = (fraction) => {
    if (typeof onPercent !== 'function') return
    const pct = Math.max(0, Math.min(100, Math.round(Number(fraction) * 100)))
    if (pct === last) return
    last = pct
    onPercent(pct)
  }
  report(0)
  return window.E2EE.kdf.derive(password, kdf, report).then((out) => {
    report(1)
    return out
  })
}

// Ön giriş: hesabın türetme ayarları (hesap yoksa sunucu ayırt edilemeyen sahte ayar verir)
async function fetchKdf (name) {
  const res = await request('POST', '/api/prelogin', { token: '', body: { name: name } })
  if (res.status !== 200 || !res.data || !res.data.kdf || typeof res.data.kdf !== 'object') {
    throw textError(() => errorText(res, t('auth.loginFailed'), authOverrides()))
  }
  return res.data.kdf
}

// Yeni hesap için türetme ayarları, authKey ve sarılmış yeni kimlik anahtarı
async function buildAccountKeys (password, onPercent) {
  const kdf = window.E2EE.kdf.newParams()
  const derived = await deriveKeys(password, kdf, onPercent)
  try {
    const pair = window.E2EE.identity.generate()
    const wrappedKey = window.E2EE.identity.wrap(pair.secretKey, derived.wrapKey)
    return { kdf: kdf, authKey: derived.authKey, publicKey: pair.publicKey, secretKey: pair.secretKey, wrappedKey: wrappedKey }
  } finally {
    derived.wrapKey.fill(0)
  }
}

// Kimliği bellekte ve bu cihazda saklar
function rememberIdentity (userId, publicKey, secretKey) {
  try {
    window.E2EE.identity.save(userId, { publicKey: publicKey, secretKey: secretKey })
  } catch (err) {
    window.console.error(err)
  }
  identityState.pair = { publicKey: publicKey, secretKey: secretKey }
  identityState.pairUser = String(userId)
}

function forgetIdentity (userId) {
  identityState.pair = null
  identityState.pairUser = null
  identityState.bindingKey = ''
  identityState.unlockSkipped = false
  if (userId === null || userId === undefined || !cryptoReady()) return
  try {
    window.E2EE.identity.clear(userId)
  } catch (err) {
    // Depolama kullanılamıyor
  }
}

// Sunucudaki anahtar kaydı ({ publicKey, wrappedKey }) ve parola sıfırlaması bekleniyor mu /api/state yanıtından gelir
function setServerKeys (keys, resetPending) {
  identityState.resetPending = resetPending === true
  if (keys && typeof keys === 'object') {
    identityState.keys = {
      publicKey: typeof keys.publicKey === 'string' ? keys.publicKey : null,
      wrappedKey: typeof keys.wrappedKey === 'string' ? keys.wrappedKey : null
    }
  } else {
    identityState.keys = { publicKey: null, wrappedKey: null }
  }
}

function serverPublicKey () {
  return identityState.keys && identityState.keys.publicKey ? identityState.keys.publicKey : null
}

// Bu cihazdaki kimlik anahtarı çifti. Sunucudaki açık anahtarla aynı değilse yok sayılır.
function myIdentity () {
  if (!state.me || !cryptoReady()) return null
  const uid = String(state.me.id)
  if (!identityState.pair || identityState.pairUser !== uid) {
    let loaded = null
    try {
      loaded = window.E2EE.identity.load(state.me.id)
    } catch (err) {
      loaded = null
    }
    if (!loaded) return null
    identityState.pair = loaded
    identityState.pairUser = uid
  }
  const pk = serverPublicKey()
  if (!pk || identityState.pair.publicKey !== pk) return null
  return identityState.pair
}

function hasIdentity () {
  return Boolean(myIdentity())
}

// Sunucuda anahtar var ama bu cihazda açılmamış (depolama temizlenmiş olabilir)
function identityLocked () {
  return Boolean(state.me && !myIdentity())
}

// Giriş cihazı işaretleri (hesap adına göre, çıkışta silinmez). Sunucu başarılı girişte verir. Hesap başına
// başarısız giriş sınırı dolduğunda bu işareti gösteren cihaz denemeye devam edebilir.
function loginDeviceOf (name) {
  const all = storeGetJson(KEYS.loginDevices, {})
  const value = all['u:' + name]
  return typeof value === 'string' ? value : ''
}

function rememberLoginDevice (name, device) {
  if (typeof device !== 'string' || device === '' || device.length > 80) return
  const all = storeGetJson(KEYS.loginDevices, {})
  all['u:' + name] = device
  storeSetJson(KEYS.loginDevices, all)
}

// Giriş: ön giriş, türetme, /api/login, ardından özel anahtarın açılması. Parola sıfırlanmışsa
// (sarılmış anahtar yok) yeni anahtar çifti üretilir ve yüklenir.
// Sonuç { ok: true, token, user, keysReset } veya { ok: false, error: metin üretici }.
async function loginWithPassword (name, password, onPercent) {
  let derived = null
  try {
    const kdf = await fetchKdf(name)
    derived = await deriveKeys(password, kdf, onPercent)
    const body = { name: name, authKey: derived.authKey }
    const device = loginDeviceOf(name)
    if (device) body.device = device
    const res = await request('POST', '/api/login', { token: '', body: body })
    if (res.status !== 200 || !res.data || typeof res.data.token !== 'string' || !res.data.user) {
      return { ok: false, error: () => errorText(res, t('auth.loginFailed'), authOverrides()) }
    }
    rememberLoginDevice(name, res.data.device)
    const token = res.data.token
    const user = res.data.user
    const keys = res.data.keys && typeof res.data.keys === 'object' ? res.data.keys : {}
    // Parola sıfırlanmış: geçici parolayı sıfırlayan da bilir, yeni anahtar çifti girişten sonra yeni parolayla
    // birlikte kurulur (openResetPassword)
    if (res.data.resetPending === true) return { ok: true, token: token, user: user, keysReset: false }
    if (typeof keys.wrappedKey !== 'string' || !keys.wrappedKey) {
      const made = await uploadNewKeys(token, derived.wrapKey)
      if (!made.ok) {
        await request('POST', '/api/logout', { token: token, timeout: 5000 })
        return { ok: false, error: made.error }
      }
      rememberIdentity(user.id, made.publicKey, made.secretKey)
      return { ok: true, token: token, user: user, keysReset: true }
    }
    const secretKey = window.E2EE.identity.unwrap(keys.wrappedKey, derived.wrapKey, keys.publicKey)
    if (!secretKey) {
      await request('POST', '/api/logout', { token: token, timeout: 5000 })
      return { ok: false, error: () => t('identity.error.unwrap_failed') }
    }
    rememberIdentity(user.id, keys.publicKey, secretKey)
    return { ok: true, token: token, user: user, keysReset: false }
  } catch (err) {
    return { ok: false, error: identityErrorProducer(err) }
  } finally {
    if (derived) derived.wrapKey.fill(0)
  }
}

// Sarılmış anahtarı olmayan hesap için yeni kimlik çifti üretir ve /api/me/keys ile yükler
async function uploadNewKeys (token, wrapKey) {
  let pair = null
  let wrapped = ''
  try {
    pair = window.E2EE.identity.generate()
    wrapped = window.E2EE.identity.wrap(pair.secretKey, wrapKey)
  } catch (err) {
    return { ok: false, error: identityErrorProducer(err) }
  }
  const res = await request('POST', '/api/me/keys', { token: token, body: { publicKey: pair.publicKey, wrappedKey: wrapped } })
  if (res.status !== 200) {
    return { ok: false, error: () => errorText(res, t('identity.keysUploadFailed')) }
  }
  return { ok: true, publicKey: pair.publicKey, secretKey: pair.secretKey, wrappedKey: wrapped }
}

// Kayıt (kurulum veya davet). Sonuç { ok: true, token, user } veya { ok: false, res | error }.
async function registerAccount (name, password, codeField, code, onPercent) {
  let keys = null
  try {
    keys = await buildAccountKeys(password, onPercent)
  } catch (err) {
    return { ok: false, error: identityErrorProducer(err) }
  }
  const body = { name: name, authKey: keys.authKey, kdf: keys.kdf, publicKey: keys.publicKey, wrappedKey: keys.wrappedKey }
  body[codeField] = code
  const res = await request('POST', '/api/register', { token: '', body: body })
  if (res.status !== 200 || !res.data || typeof res.data.token !== 'string' || !res.data.user) {
    return { ok: false, res: res }
  }
  rememberIdentity(res.data.user.id, keys.publicKey, keys.secretKey)
  rememberLoginDevice(name, res.data.device)
  return { ok: true, token: res.data.token, user: res.data.user }
}

// Kullanıcı adı uygunluğu (davet veya kurulum kodu gerekir). Sonuç { state, text } biçiminde gösterilir.
function createNameChecker (input, statusEl, codeInput) {
  let timer = 0
  let pending = null
  let seq = 0
  const show = (value, kind) => {
    setMsg(statusEl, value, kind)
  }
  const run = () => {
    const name = cleanUsername(input.value)
    const problem = usernameProblem(name)
    clearTimeout(timer)
    if (pending) pending.abort()
    pending = null
    seq += 1
    if (!name) {
      show('')
      return
    }
    if (problem) {
      show(() => usernameProblemText(problem), 'error')
      return
    }
    const code = codeInput ? codeInput.value.trim() : ''
    if (!code) {
      show(() => t('auth.nameCheckNeedsCode'))
      return
    }
    show(() => t('auth.nameChecking'))
    const mySeq = seq
    timer = setTimeout(async () => {
      const req = request('POST', '/api/username-available', { token: '', body: { name: name, code: code } })
      pending = req
      const res = await req
      if (mySeq !== seq) return
      pending = null
      if (res.status === 200 && res.data) {
        if (res.data.valid === false) show(() => usernameProblemText('chars'), 'error')
        else if (res.data.available === true) show(() => t('auth.nameAvailable', { name: name }), 'ok')
        else show(() => t('auth.nameTaken', { name: name }), 'error')
      } else if (res.status === 403) {
        show(() => t('auth.nameCheckBadCode'), 'error')
      } else if (res.status === 429) {
        show(() => t('auth.rateLimited'), 'error')
      } else {
        show('')
      }
    }, NAME_CHECK_DELAY_MS)
  }
  return { run: run }
}

// Form içinde, verilen alanın hemen arkasına yardımcı öğe ekler (yoksa)
function ensureAfter (anchor, id, tag, className) {
  let node = byId(id)
  if (node) return node
  node = h(tag, className)
  node.id = id
  if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(node, anchor.nextSibling)
  return node
}

function buildStrengthMeter (input, id) {
  const anchor = byId(input.id + '-hint') || input
  const wrap = ensureAfter(anchor, id, 'div', 'password-strength')
  if (!wrap.firstChild) {
    wrap.setAttribute('aria-live', 'polite')
    const track = h('span', 'password-strength-track meter')
    const bar = h('span', 'password-strength-bar meter-bar')
    track.appendChild(bar)
    wrap.appendChild(track)
    wrap.appendChild(h('span', 'password-strength-label hint'))
  }
  wrap.hidden = true
  return wrap
}

function updateStrengthMeter (wrap, password) {
  if (!wrap) return
  const text = String(password || '')
  if (!text) {
    wrap.hidden = true
    return
  }
  const score = passwordStrength(text)
  wrap.hidden = false
  wrap.setAttribute('data-strength', String(score))
  const bar = wrap.querySelector('.password-strength-bar')
  if (bar) bar.style.width = (score * 25) + '%'
  const label = wrap.querySelector('.password-strength-label')
  if (label) setLive(label, () => t(STRENGTH_KEYS[score]))
}

// Türetme ilerlemesi: formdaki durum satırı "Anahtar türetiliyor %NN"
function progressLine (form) {
  const id = form.id + '-progress'
  let node = byId(id)
  if (!node) {
    node = h('p', 'derive-progress hint')
    node.id = id
    node.setAttribute('role', 'status')
    node.setAttribute('aria-live', 'polite')
    const submit = form.querySelector('[type="submit"]')
    form.insertBefore(node, submit || null)
  }
  return node
}

function showProgress (node, percent) {
  if (!node) return
  if (percent === null) {
    setMsg(node, '')
    return
  }
  setMsg(node, () => t('auth.deriving', { percent: percent }))
}

// Kimlik bağlaması: grup anahtarı varsa ve sunucudaki kayıt yoksa, açılamıyorsa, açık anahtarı
// farklıysa veya etkin olmayan bir anahtarla mühürlenmişse yeniden mühürlenip yüklenir.
async function ensureIdentityBinding () {
  if (!state.inApp || !state.me || identityState.bindingBusy) return
  const kid = activeKid()
  const pair = myIdentity()
  if (!kid || !pair || !hasActiveKey()) return
  const marker = kid + ':' + pair.publicKey
  if (identityState.bindingKey === marker) return
  identityState.bindingBusy = true
  const me = state.me
  try {
    const res = await api('GET', '/api/profiles?ids=' + encodeURIComponent(me.id))
    if (state.me !== me) return
    if (res.status !== 200 || !res.data || !Array.isArray(res.data.profiles)) return
    const entry = res.data.profiles.filter((p) => p && sameId(p.id, me.id))[0]
    if (!entry || entry.publicKey !== pair.publicKey) return
    let needed = true
    if (typeof entry.identity === 'string' && entry.identity) {
      const check = window.E2EE.identity.verifyBinding(entry.identity, me.id, pair.publicKey)
      needed = !check.ok || check.kid !== kid
    }
    if (needed) {
      const envelope = window.E2EE.identity.sealBinding(kid, me.id, pair.publicKey)
      const up = await api('POST', '/api/me/identity', { identity: envelope })
      if (up.status !== 200) return
    }
    identityState.bindingKey = marker
  } catch (err) {
    window.console.error(err)
  } finally {
    identityState.bindingBusy = false
  }
}

// Kayıtlı oturumla açılışta kimlik bu cihazda yoksa parolayla açma penceresi

function identityNeedsUnlock () {
  return Boolean(state.inApp && state.me && cryptoReady() && !myIdentity())
}

function maybeAskIdentityUnlock () {
  if (!identityNeedsUnlock() || identityState.unlockSkipped) return
  openIdentityUnlock(null)
}

function openIdentityUnlock (trigger) {
  if (!identityNeedsUnlock()) return
  const resetCase = !(identityState.keys && identityState.keys.wrappedKey)
  if (resetCase && identityState.resetPending) {
    openResetPassword(trigger)
    return
  }
  openAppDialog({
    name: 'identity-unlock',
    titleKey: 'identity.unlockTitle',
    trigger: trigger,
    closeLabelKey: 'identity.unlockLater',
    onClose: (reason) => {
      if (reason !== 'done') identityState.unlockSkipped = true
    },
    build: (body, close) => {
      body.appendChild(h('p', 'lead', t(resetCase ? 'identity.unlockResetLead' : 'identity.unlockLead')))
      const form = h('form', 'form identity-unlock-form')
      form.id = 'identity-unlock-form'
      form.noValidate = true
      const user = h('input', 'sr-only')
      user.type = 'text'
      user.autocomplete = 'username'
      user.value = state.me ? state.me.name : ''
      user.tabIndex = -1
      user.setAttribute('aria-hidden', 'true')
      user.readOnly = true
      form.appendChild(user)
      const label = h('label', 'label', t('auth.password'))
      label.setAttribute('for', 'identity-unlock-password')
      const input = h('input', 'input')
      input.id = 'identity-unlock-password'
      input.type = 'password'
      input.autocomplete = 'current-password'
      input.maxLength = 256
      form.appendChild(label)
      form.appendChild(input)
      const msg = h('p', 'form-error')
      msg.id = 'identity-unlock-error'
      msg.setAttribute('role', 'alert')
      msg.hidden = true
      form.appendChild(msg)
      const progress = h('p', 'derive-progress hint')
      progress.id = 'identity-unlock-progress'
      progress.setAttribute('role', 'status')
      progress.hidden = true
      form.appendChild(progress)
      const row = h('div', 'row dialog-actions')
      const submit = button('button', t('identity.unlockSubmit'))
      submit.type = 'submit'
      submit.id = 'identity-unlock-submit'
      const later = button('button button-secondary', t('identity.unlockLater'))
      later.id = 'identity-unlock-later'
      later.addEventListener('click', () => {
        close('later')
      })
      row.appendChild(submit)
      row.appendChild(later)
      form.appendChild(row)
      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        if (form.classList.contains('is-busy')) return
        const password = input.value
        if (!password) {
          setMsg(msg, () => t('identity.enterPassword'), 'error')
          return
        }
        setMsg(msg, '')
        setFormBusy(form, true)
        const result = await unlockIdentity(password, (pct) => {
          showProgress(progress, pct)
        })
        setFormBusy(form, false)
        showProgress(progress, null)
        if (!result.ok) {
          setMsg(msg, result.error, 'error')
          focusNode(input)
          return
        }
        input.value = ''
        close('done')
        toast(() => t(result.keysReset ? 'identity.keysReset' : 'identity.unlocked'), 'ok', result.keysReset ? 10000 : TOAST_MS)
        afterIdentityChange()
      })
      body.appendChild(form)
      return input
    }
  })
}

function passwordField (form, id, labelKey, autocomplete) {
  const label = h('label', 'label', t(labelKey))
  label.setAttribute('for', id)
  const input = h('input', 'input')
  input.id = id
  input.type = 'password'
  input.autocomplete = autocomplete
  input.maxLength = 256
  form.appendChild(label)
  form.appendChild(input)
  return input
}

// Parola sıfırlamasından sonra: geçici parola ve yeni parola. Yeni anahtar çifti yeni parolayla sarılır ve parola
// değişikliğiyle birlikte kurulur, geçici parolayı bilen (sıfırlayan) onu seçemez veya açamaz.
function openResetPassword (trigger) {
  openAppDialog({
    name: 'identity-reset',
    titleKey: 'identity.resetPendingTitle',
    trigger: trigger,
    closeLabelKey: 'identity.unlockLater',
    onClose: (reason) => {
      if (reason !== 'done') identityState.unlockSkipped = true
    },
    build: (body, close) => {
      body.appendChild(h('p', 'lead', t('identity.resetPendingLead')))
      const form = h('form', 'form identity-unlock-form')
      form.id = 'identity-reset-form'
      form.noValidate = true
      const user = h('input', 'sr-only')
      user.type = 'text'
      user.autocomplete = 'username'
      user.value = state.me ? state.me.name : ''
      user.tabIndex = -1
      user.setAttribute('aria-hidden', 'true')
      user.readOnly = true
      form.appendChild(user)
      const oldInput = passwordField(form, 'identity-reset-old', 'settings.account.oldPassword', 'current-password')
      const newInput = passwordField(form, 'identity-reset-new', 'settings.account.newPassword', 'new-password')
      const newInput2 = passwordField(form, 'identity-reset-new2', 'settings.account.newPassword2', 'new-password')
      const msg = h('p', 'form-error')
      msg.id = 'identity-reset-error'
      msg.setAttribute('role', 'alert')
      msg.hidden = true
      form.appendChild(msg)
      const progress = h('p', 'derive-progress hint')
      progress.id = 'identity-reset-progress'
      progress.setAttribute('role', 'status')
      progress.hidden = true
      form.appendChild(progress)
      const row = h('div', 'row dialog-actions')
      const submit = button('button', t('settings.account.passwordSubmit'))
      submit.type = 'submit'
      submit.id = 'identity-reset-submit'
      const later = button('button button-secondary', t('identity.unlockLater'))
      later.id = 'identity-reset-later'
      later.addEventListener('click', () => {
        close('later')
      })
      row.appendChild(submit)
      row.appendChild(later)
      form.appendChild(row)
      const problemOf = () => {
        if (!oldInput.value) return { input: oldInput, text: () => t('settings.password.enterOld') }
        const problem = passwordProblem(newInput.value)
        if (problem) return { input: newInput, text: problem }
        if (newInput.value !== newInput2.value) return { input: newInput2, text: () => t('settings.password.mismatch') }
        // Geçici parolayla sarılan anahtarı sıfırlayan açabilirdi
        if (newInput.value === oldInput.value) return { input: newInput, text: () => t('settings.password.same') }
        return null
      }
      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        if (form.classList.contains('is-busy')) return
        const problem = problemOf()
        if (problem) {
          setMsg(msg, problem.text, 'error')
          focusNode(problem.input)
          return
        }
        setMsg(msg, '')
        setFormBusy(form, true)
        const result = await changePasswordRequest(oldInput.value, newInput.value, (pct) => {
          showProgress(progress, pct)
        })
        setFormBusy(form, false)
        showProgress(progress, null)
        if (!result.ok) {
          setMsg(msg, result.error, 'error')
          focusNode(oldInput)
          return
        }
        oldInput.value = ''
        newInput.value = ''
        newInput2.value = ''
        close('done')
        toast(() => t('identity.keysReset'), 'ok', 10000)
      })
      body.appendChild(form)
      return oldInput
    }
  })
}

// Parolayla bu cihazdaki kimliği açar (oturum yenilenmez). Sarılmış anahtar yoksa yeni çift üretilir.
async function unlockIdentity (password, onPercent) {
  if (!state.me) return { ok: false, error: () => t('identity.error.generic') }
  let derived = null
  try {
    const kdf = await fetchKdf(state.me.name)
    derived = await deriveKeys(password, kdf, onPercent)
    const st = await api('GET', '/api/state')
    if (st.status !== 200 || !st.data) return { ok: false, error: () => errorText(st, t('auth.stateFailed')) }
    setServerKeys(st.data.keys, st.data.resetPending)
    const keys = identityState.keys
    if (!keys.wrappedKey) {
      const made = await uploadNewKeys(state.token, derived.wrapKey)
      if (!made.ok) return { ok: false, error: made.error }
      identityState.keys = { publicKey: made.publicKey, wrappedKey: made.wrappedKey }
      rememberIdentity(state.me.id, made.publicKey, made.secretKey)
      return { ok: true, keysReset: true }
    }
    const secretKey = window.E2EE.identity.unwrap(keys.wrappedKey, derived.wrapKey, keys.publicKey)
    if (!secretKey) return { ok: false, error: () => t('identity.wrongPassword') }
    rememberIdentity(state.me.id, keys.publicKey, secretKey)
    return { ok: true, keysReset: false }
  } catch (err) {
    return { ok: false, error: identityErrorProducer(err) }
  } finally {
    if (derived) derived.wrapKey.fill(0)
  }
}

// Kimlik değişince (açıldı, yeni anahtar) bağlama ve özel mesaj görünümleri yenilenir
function afterIdentityChange () {
  identityState.bindingKey = ''
  ensureIdentityBinding()
  if (typeof dmAfterIdentityChange === 'function') dmAfterIdentityChange()
}

// Parola değiştirme: mevcut ayarlarla eski authKey, yeni ayarlarla yeni authKey ve aynı özel
// anahtarın yeni sarma anahtarıyla sarılması. Diğer oturumlar sunucuda kapanır. Hesabın anahtar çifti yoksa
// (parola sıfırlaması sonrası) yeni çift üretilir, yeni parolayla sarılır ve aynı istekle kurulur.
async function changePasswordRequest (oldPassword, newPassword, onPercent) {
  if (!state.me) return { ok: false, error: () => t('settings.password.failed') }
  let oldKeys = null
  let newKeys = null
  try {
    const kdf = await fetchKdf(state.me.name)
    oldKeys = await deriveKeys(oldPassword, kdf, (pct) => {
      if (onPercent) onPercent(Math.round(pct / 2))
    })
    const newKdf = window.E2EE.kdf.newParams()
    newKeys = await deriveKeys(newPassword, newKdf, (pct) => {
      if (onPercent) onPercent(50 + Math.round(pct / 2))
    })
    // Başka bir sekme sıfırlamadan sonra anahtar çiftini kurmuş olabilir: seçim sunucudaki güncel anahtarlarla yapılır
    const st = await api('GET', '/api/state')
    if (st.status !== 200 || !st.data) return { ok: false, error: () => errorText(st, t('auth.stateFailed')) }
    setServerKeys(st.data.keys, st.data.resetPending)
    const keys = identityState.keys
    let wrappedKey = null
    let fresh = null
    if (!keys.publicKey) {
      fresh = window.E2EE.identity.generate()
      wrappedKey = window.E2EE.identity.wrap(fresh.secretKey, newKeys.wrapKey)
    } else {
      const pair = myIdentity()
      let secretKey = pair ? pair.secretKey : null
      if (!secretKey && keys.wrappedKey) secretKey = window.E2EE.identity.unwrap(keys.wrappedKey, oldKeys.wrapKey, keys.publicKey)
      if (!secretKey) return { ok: false, error: () => t('settings.password.oldWrong') }
      wrappedKey = window.E2EE.identity.wrap(secretKey, newKeys.wrapKey)
      if (!pair) rememberIdentity(state.me.id, keys.publicKey, secretKey)
    }
    const body = { oldAuthKey: oldKeys.authKey, newAuthKey: newKeys.authKey, kdf: newKdf, wrappedKey: wrappedKey }
    if (fresh) body.publicKey = fresh.publicKey
    const res = await api('POST', '/api/me/password', body)
    if (res.status === 200) {
      identityState.resetPending = false
      // Parola değişince önceki giriş cihazı işareti geçersizdir, sunucu yenisini verir
      if (res.data) rememberLoginDevice(state.me.name, res.data.device)
      if (fresh) {
        identityState.keys = { publicKey: fresh.publicKey, wrappedKey: wrappedKey }
        rememberIdentity(state.me.id, fresh.publicKey, fresh.secretKey)
        afterIdentityChange()
        return { ok: true, keysReset: true }
      }
      identityState.keys = { publicKey: keys.publicKey, wrappedKey: wrappedKey }
      return { ok: true }
    }
    // Anahtar durumu bu arada değişmiştir, sunucudaki güncel anahtarlar yeniden yüklenir ve yeni deneme ona göre seçer
    if (res.data && res.data.code === 'bad_keys') {
      const again = await api('GET', '/api/state')
      if (again.status === 200 && again.data) setServerKeys(again.data.keys, again.data.resetPending)
    }
    return { ok: false, error: () => errorText(res, t('settings.password.failed'), { bad_credentials: t('settings.password.oldWrong'), rate_limited: t('auth.rateLimited') }) }
  } catch (err) {
    return { ok: false, error: identityErrorProducer(err) }
  } finally {
    if (oldKeys) oldKeys.wrapKey.fill(0)
    if (newKeys) newKeys.wrapKey.fill(0)
  }
}

// Kullanıcı adı değiştirme (mevcut parola ile). Ayarlar görünümü bu yardımcıyı kullanır.
async function changeUsernameRequest (newName, password, onPercent) {
  if (!state.me) return { ok: false, error: () => t('identity.error.generic') }
  const name = cleanUsername(newName)
  const problem = usernameProblem(name)
  if (problem) return { ok: false, error: () => usernameProblemText(problem) }
  let derived = null
  try {
    const kdf = await fetchKdf(state.me.name)
    derived = await deriveKeys(password, kdf, onPercent)
    const res = await api('POST', '/api/me/username', { name: name, authKey: derived.authKey })
    if (res.status === 200 && res.data && res.data.user) {
      state.me.name = String(res.data.user.name || name)
      return { ok: true, user: res.data.user }
    }
    return { ok: false, error: () => errorText(res, t('identity.usernameFailed'), { bad_credentials: t('identity.wrongPassword'), rate_limited: t('auth.rateLimited') }) }
  } catch (err) {
    return { ok: false, error: identityErrorProducer(err) }
  } finally {
    if (derived) derived.wrapKey.fill(0)
  }
}

// Hesap silme (parola ile onay). Başarıda yerel oturum ve kimlik silinir, giriş ekranı açılır.
async function deleteAccountRequest (password, onPercent) {
  if (!state.me) return { ok: false, error: () => t('identity.error.generic') }
  if (isOwner()) return { ok: false, error: () => t('errors.owner_cannot_delete') }
  let derived = null
  try {
    const kdf = await fetchKdf(state.me.name)
    derived = await deriveKeys(password, kdf, onPercent)
    const res = await api('POST', '/api/me/delete', { authKey: derived.authKey })
    if (res.status === 200) {
      finishDeletedAccount()
      return { ok: true }
    }
    return { ok: false, error: () => errorText(res, t('identity.deleteFailed'), { bad_credentials: t('identity.wrongPassword'), rate_limited: t('auth.rateLimited') }) }
  } catch (err) {
    return { ok: false, error: identityErrorProducer(err) }
  } finally {
    if (derived) derived.wrapKey.fill(0)
  }
}

function finishDeletedAccount () {
  const me = state.me
  stopPoll()
  if (voice) {
    try {
      voice.teardown()
    } catch (err) {
      // Yerel kapatma hatası önemsiz
    }
  }
  state.sessionLost = true
  if (me) forgetIdentity(me.id)
  clearToken()
  resetAppState()
  showLogin(() => t('identity.accountDeleted'))
}

// Ayarlarda gösterilecek kendi güvenlik anahtarı parmak izi
function myFingerprint () {
  const pk = serverPublicKey()
  if (!pk || !cryptoReady()) return ''
  try {
    return window.E2EE.fingerprint(pk)
  } catch (err) {
    return ''
  }
}
