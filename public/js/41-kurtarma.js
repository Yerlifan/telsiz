'use strict'

// Kurtarma kodu arayüzü (istek 14): giriş ekranındaki Parolamı Unuttum kartı (kurtarma koduyla yeni parola, kodu
// olmayanlar için sahibe yönlendirme), kurulumdan, kayıttan ve kurtarmadan sonra gösterilen kurtarma kodu kartı,
// uygulama içindeki kod penceresi (Kopyala, Dosya Olarak İndir, "kaydettim" onayı), Ayarlar > Hesabım içindeki
// Kurtarma Kodu bölümü, kodu olmayan hesaba parolayla girişten sonra bir kez gösterilen hatırlatma ve kaydedildiği
// onaylanmayan kod için uyarı.
// Şifreleme ve sunucu istekleri 16-identity.js içindedir (recoverAccount, recoveryChangeRequest).

const RECOVERY_REMIND_KEY = 'telsiz.recoveryReminded'
const RECOVERY_UNSAVED_KEY = 'telsiz.recoveryUnsaved'
const RECOVERY_REMIND_DELAY_MS = 1500
const RECOVERY_REMIND_TRIES = 40

const recoveryUi = {
  forgotReady: false,
  forgot: null,
  remindPending: false,
  remindTimer: 0,
  refreshing: false,
  // Onaylanmayan kod uyarısının bu sayfa açılışında gösterildiği kişi
  unsavedShownFor: null
}

// Dil değişince yeniden çevrilen metinli öğe
function recoveryText (tag, className, producer) {
  const node = h(tag, className)
  setLive(node, producer)
  return node
}

function recoveryServerText () {
  const origin = window.location.origin || (window.location.protocol + '//' + window.location.host)
  return state.serverName + ' (' + origin + ')'
}

function downloadRecoveryCode (code, name) {
  const text = t('recovery.fileText', { server: recoveryServerText(), name: name, code: code, date: formatLong(Date.now()) })
  saveBytes(window.E2EE.utf8.encode(text + '\n'), t('recovery.fileName'))
}

// ----- Kaydedildiği onaylanmayan kod -----

// Sunucu yeni kodu kaydettikten sonra kod kişiye bir kez gösterilir. Sayfa yenilenir, sekme kapanır veya pencere
// Devam'a basılmadan kapanırsa kod bir daha gösterilemez. Bu yüzden kod verilince kişi başına bir bayrak yazılır
// (değer kodun sunucudaki oluşturma zamanı, bilinmiyorsa 0), "kaydettim" onayıyla Devam'a basılınca silinir. Bayrak
// durdukça uygulama açılınca bir kez uyarı çıkar ve Ayarlar'daki durum satırı vurgulanır.

function recoveryUnsavedOf (userId) {
  if (userId === null || userId === undefined) return null
  const value = storeGetJson(RECOVERY_UNSAVED_KEY, {})['u:' + userId]
  return typeof value === 'number' && isFinite(value) && value >= 0 ? value : null
}

// value null bayrağı siler
function writeRecoveryUnsaved (userId, value) {
  const all = storeGetJson(RECOVERY_UNSAVED_KEY, {})
  if (value === null) delete all['u:' + userId]
  else all['u:' + userId] = value
  if (Object.keys(all).length) storeSetJson(RECOVERY_UNSAVED_KEY, all)
  else storeRemove(RECOVERY_UNSAVED_KEY)
}

// Ayarlar açıksa Kurtarma Kodu bölümü yenilenir
function recoveryRefreshSettings () {
  if (typeof isSettingsOpen === 'function' && isSettingsOpen() && typeof updateSettingsPage === 'function') updateSettingsPage()
}

// Sunucu yeni kodu kaydetti (16-identity.js: kayıt, kurtarma, Ayarlar'dan oluşturma, parola değişikliğiyle yenileme)
function recoveryIssued (userId, createdAt) {
  if (userId === null || userId === undefined) return
  writeRecoveryUnsaved(userId, typeof createdAt === 'number' && isFinite(createdAt) && createdAt > 0 ? createdAt : 0)
  recoveryRefreshSettings()
}

// Kişi kodu kaydettiğini onayladı veya kod kaldırıldı
function recoveryConfirmed (userId) {
  if (recoveryUnsavedOf(userId) === null) return
  writeRecoveryUnsaved(userId, null)
  recoveryRefreshSettings()
}

// Oturumdaki kişinin sunucudaki kodu kaydedildiği onaylanmamış kod mu? Sunucu bilgisi gelmeden veya sunucuda kod
// yokken false döner. Oluşturma zamanı bilinmeden yazılan bayrak (kayıt yanıtı zamanı vermez) sunucudaki kodu
// benimser. Sunucudaki kod bayraklı koddan sonra oluşturulduysa (ör. başka bir cihazda) bayrak silinir. Bu sekmenin
// sunucu bilgisi eskiyse (bayraklı kod daha yeni, ör. kod başka bir sekmede verildi) bayrağa dokunulmaz.
function recoveryUnsaved () {
  if (!state.me || !identityState.recoveryKnown) return false
  const id = state.me.id
  const value = recoveryUnsavedOf(id)
  const rec = identityState.recovery
  if (value === null || !rec) return false
  if (value === 0) {
    writeRecoveryUnsaved(id, rec.createdAt)
    return true
  }
  if (rec.createdAt > value) writeRecoveryUnsaved(id, null)
  return rec.createdAt === value
}

// Kod görünümü: açıklama, kod (dörderli gruplar satır sonunda bölünebilir), uyarı, Kopyala, Dosya Olarak İndir,
// "kaydettim" onayı ve onaydan sonra açılan Devam düğmesi. opts: { code, name, rotated, idPrefix, onContinue }.
// İlk odaklanacak öğeyi döndürür.
function buildRecoveryCodeView (parent, opts) {
  const prefix = opts.idPrefix
  const wrap = h('div', 'recovery-view')
  wrap.id = prefix + '-view'
  if (opts.rotated) wrap.appendChild(recoveryText('p', 'recovery-rotated', () => t('recovery.rotated')))
  wrap.appendChild(recoveryText('p', 'lead', () => t('recovery.lead')))
  const codeBox = h('p', 'recovery-code mono')
  codeBox.id = prefix + '-code'
  opts.code.split('-').forEach((group, i) => {
    if (i > 0) codeBox.appendChild(document.createTextNode('-'))
    codeBox.appendChild(h('span', 'recovery-code-group', group))
  })
  wrap.appendChild(codeBox)
  wrap.appendChild(recoveryText('p', 'warning', () => t('recovery.warning')))
  const actions = h('div', 'recovery-actions')
  const copy = button('button button-secondary', '', 'i-copy')
  copy.id = prefix + '-copy'
  setLive(copy.appendChild(h('span', 'button-text')), () => t('recovery.copy'))
  copy.addEventListener('click', () => {
    copyWithToast(opts.code)
  })
  const download = button('button button-secondary', '', 'i-download')
  download.id = prefix + '-download'
  setLive(download.appendChild(h('span', 'button-text')), () => t('recovery.download'))
  download.addEventListener('click', () => {
    downloadRecoveryCode(opts.code, opts.name)
  })
  actions.appendChild(copy)
  actions.appendChild(download)
  wrap.appendChild(actions)
  const check = h('label', 'check recovery-saved')
  const box = h('input')
  box.type = 'checkbox'
  box.id = prefix + '-saved'
  check.setAttribute('for', box.id)
  check.appendChild(box)
  check.appendChild(recoveryText('span', '', () => t('recovery.saved')))
  wrap.appendChild(check)
  const next = button('button button-wide recovery-continue', '')
  next.id = prefix + '-continue'
  setLive(next.appendChild(h('span', 'button-text')), () => t('recovery.continue'))
  next.disabled = true
  box.addEventListener('change', () => {
    next.disabled = !box.checked
  })
  next.addEventListener('click', () => {
    if (!box.checked) return
    clear(codeBox)
    opts.onContinue()
  })
  wrap.appendChild(next)
  parent.appendChild(wrap)
  return copy
}

// Giriş ekranındaki kod kartı (kurulum, kayıt ve kurtarma sonrası). user: { id, name }. next Devam ile çağrılır.
// Oturum kart gösterilmeden önce bu cihazda saklanmıştır: sayfa kart açıkken yenilenirse uygulama açılır ve kod
// onaylanmamış sayılır (recoveryAfterEnter uyarısı, Ayarlar'da vurgulu durum).
function showRecoveryCard (code, user, rotated, next) {
  const card = el.recoveryCard
  clear(card)
  const title = recoveryText('h2', 'section-heading', () => t('recovery.title'))
  title.id = 'recovery-title'
  card.appendChild(title)
  buildRecoveryCodeView(card, {
    code: code,
    name: user.name,
    rotated: rotated,
    idPrefix: 'recovery-card',
    onContinue: () => {
      recoveryConfirmed(user.id)
      clear(card)
      next()
    }
  })
  showAuthCard('recovery')
  focusNode(byId('recovery-card-copy'))
}

// Uygulama içindeki kod penceresi (Ayarlar'dan oluşturma ve yenileme, parola değişikliğiyle yenileme, sıfırlamadan
// sonra yeni parola). Pencere "kaydettim" onayıyla Devam'a basılmadan kapanmaz: kapat düğmesi gizlenir, katman
// kilitlenir ve Esc, oyun kolunun geri düğmesi ve dışarı tıklama onu kapatmaz (02-state-dom.js closeLayer). Köşedeki
// DJ oynatıcısının kartı açan düğmesi de kilitli katmanı kapatmaz (23-dj.js djOpenFromDock, lockedLayer). Program
// kapatırsa (ör. oturum kapanması) kod onaylanmamış sayılır. opts: { trigger, rotated }
function openRecoveryCodeDialog (code, opts) {
  const o = opts || {}
  const userId = state.me ? state.me.id : null
  let layer = null
  const handle = openAppDialog({
    name: 'recovery-code',
    titleKey: 'recovery.title',
    trigger: o.trigger || null,
    build: (body, close) => buildRecoveryCodeView(body, {
      code: code,
      name: state.me ? state.me.name : '',
      rotated: Boolean(o.rotated),
      idPrefix: 'recovery-dialog',
      onContinue: () => {
        recoveryConfirmed(userId)
        if (layer) layer.locked = false
        close('done')
      }
    })
  })
  const opened = handle ? findLayer('app-dialog') : null
  if (opened && opened.el && opened.el.id === 'recovery-code-dialog') {
    layer = opened
    layer.locked = true
    const closeBtn = layer.el.querySelector('.app-dialog-close')
    if (closeBtn) closeBtn.hidden = true
  }
  return handle
}

// ----- Parolamı Unuttum kartı -----

function recoveryField (form, id, labelKey, input, hintKey) {
  const label = recoveryText('label', 'label', () => t(labelKey))
  label.setAttribute('for', id)
  input.id = id
  form.appendChild(label)
  form.appendChild(input)
  if (hintKey) {
    const hint = recoveryText('p', 'hint', () => t(hintKey))
    hint.id = id + '-hint'
    input.setAttribute('aria-describedby', hint.id)
    form.appendChild(hint)
  }
  return input
}

function recoveryInput (type, autocomplete, className) {
  const input = h('input', 'input' + (className ? ' ' + className : ''))
  input.type = type
  input.autocomplete = autocomplete
  input.setAttribute('autocapitalize', 'none')
  input.setAttribute('spellcheck', 'false')
  return input
}

// Sahibin sunucuda çalıştıracağı sıfırlama komutu (ad yazılmışsa onunla)
function forgotOwnerCommand (name) {
  const shown = name && !usernameProblem(name) ? name : '<' + t('auth.username').toLocaleLowerCase(window.I18N.lang === 'tr' ? 'tr-TR' : 'en-US') + '>'
  return 'node server.js sifre-sifirla ' + shown
}

function buildForgotCard () {
  const card = el.forgotCard
  clear(card)
  const title = recoveryText('h2', 'section-heading', () => t('auth.forgotTitle'))
  title.id = 'forgot-title'
  card.appendChild(title)
  card.appendChild(recoveryText('p', 'lead', () => t('auth.forgotLead')))
  const form = h('form', 'form')
  form.id = 'forgot-form'
  form.noValidate = true
  form.setAttribute('autocomplete', 'on')
  const name = recoveryField(form, 'forgot-name', 'auth.username', recoveryInput('text', 'username'), null)
  name.maxLength = USERNAME_MAX_INPUT
  const code = recoveryField(form, 'forgot-code', 'auth.recoveryCode', recoveryInput('text', 'off', 'mono'), 'auth.recoveryCodeHint')
  code.maxLength = 80
  code.setAttribute('autocapitalize', 'characters')
  code.placeholder = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX'
  const pass = recoveryField(form, 'forgot-password', 'settings.account.newPassword', recoveryInput('password', 'new-password'), null)
  pass.maxLength = 256
  const pass2 = recoveryField(form, 'forgot-password2', 'settings.account.newPassword2', recoveryInput('password', 'new-password'), null)
  pass2.maxLength = 256
  const strength = buildStrengthMeter(pass, 'forgot-password-strength')
  const error = h('p', 'form-error')
  error.id = 'forgot-error'
  error.setAttribute('role', 'alert')
  error.hidden = true
  form.appendChild(error)
  const submit = button('button button-wide', '')
  submit.type = 'submit'
  submit.id = 'forgot-submit'
  setLive(submit.appendChild(h('span', 'button-text')), () => t('auth.forgotSubmit'))
  form.appendChild(submit)
  card.appendChild(form)
  const back = button('button button-ghost button-wide forgot-back', '')
  back.id = 'forgot-back'
  setLive(back.appendChild(h('span', 'button-text')), () => t('auth.forgotBack'))
  card.appendChild(back)
  // Kodu olmayanlar: sahibin sıfırlaması (eski özel mesajlar okunamaz) ve sahibin kendisi için komut satırı
  const none = h('details', 'forgot-nocode')
  none.id = 'forgot-nocode'
  const summary = recoveryText('summary', 'forgot-nocode-title', () => t('auth.forgotNoCodeTitle'))
  summary.id = 'forgot-nocode-title'
  none.appendChild(summary)
  none.appendChild(recoveryText('p', 'hint', () => t('auth.forgotNoCodeText')))
  // Komut metnin içinde kod biçiminde gösterilir: metin komutun yerinden ikiye bölünür, üç parça da dil değişince
  // yeniden üretilir
  const owner = h('p', 'hint forgot-owner')
  owner.id = 'forgot-owner'
  const ownerParts = () => t('auth.forgotOwnerText', { command: '\u0000' }).split('\u0000')
  owner.appendChild(recoveryText('span', '', () => ownerParts()[0]))
  const command = recoveryText('code', 'forgot-command mono', () => forgotOwnerCommand(cleanUsername(name.value)))
  command.id = 'forgot-command'
  owner.appendChild(command)
  owner.appendChild(recoveryText('span', '', () => ownerParts().slice(1).join('')))
  none.appendChild(owner)
  card.appendChild(none)

  const refreshCommand = () => {
    setLive(command, () => forgotOwnerCommand(cleanUsername(name.value)))
  }
  name.addEventListener('input', () => {
    lowercaseInput(name)
    refreshCommand()
  })
  pass.addEventListener('input', () => {
    updateStrengthMeter(strength, pass.value)
  })
  back.addEventListener('click', () => {
    clearForgotSecrets()
    showLogin('')
  })
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    submitForgot()
  })
  recoveryUi.forgot = { form: form, name: name, code: code, pass: pass, pass2: pass2, error: error, strength: strength, refreshCommand: refreshCommand }
  recoveryUi.forgotReady = true
}

function clearForgotSecrets () {
  const f = recoveryUi.forgot
  if (!f) return
  f.code.value = ''
  f.pass.value = ''
  f.pass2.value = ''
  updateStrengthMeter(f.strength, '')
  setMsg(f.error, '')
}

// Giriş formundaki Parolamı Unuttum bağlantısı (03-auth.js prepareAuthForms bağlar)
function showForgotCard () {
  if (!recoveryUi.forgotReady) buildForgotCard()
  const f = recoveryUi.forgot
  const typed = cleanUsername(el.loginName.value)
  if (typed && !f.name.value) f.name.value = typed
  f.refreshCommand()
  setMsg(f.error, '')
  showAuthCard('forgot')
  focusNode(f.name.value ? f.code : f.name)
}

async function submitForgot () {
  const f = recoveryUi.forgot
  if (!f || f.form.classList.contains('is-busy')) return
  const name = cleanUsername(f.name.value)
  const fail = (text, input) => {
    setMsg(f.error, text, 'error')
    focusNode(input)
  }
  const nameProblem = usernameProblem(name)
  if (nameProblem) return fail(() => usernameProblemText(nameProblem), f.name)
  if (!f.code.value.trim()) return fail(() => t('identity.error.recovery_empty'), f.code)
  const passProblem = passwordProblem(f.pass.value)
  if (passProblem) return fail(passProblem, f.pass)
  if (f.pass.value !== f.pass2.value) return fail(() => t('auth.passwordMismatch'), f.pass2)
  if (!cryptoReady()) return fail(() => t('boot.noCrypto'), f.code)
  setMsg(f.error, '')
  setFormBusy(f.form, true)
  const progress = progressLine(f.form)
  const result = await recoverAccount(name, f.code.value, f.pass.value, (pct) => {
    showProgress(progress, pct)
  })
  showProgress(progress, null)
  setFormBusy(f.form, false)
  if (!result.ok) return fail(result.error, result.field === 'code' ? f.code : f.name)
  clearForgotSecrets()
  setToken(result.token)
  showRecoveryCard(result.code, { id: result.user.id, name: name }, true, () => {
    resumeSession()
  })
}

// ----- Ayarlar > Hesabım: Kurtarma Kodu bölümü -----

function recoverySignature () {
  const rec = identityState.recovery
  return [identityState.recoveryKnown ? 1 : 0, rec ? rec.createdAt : '', rec && rec.label ? rec.label : '', identityState.resetPending ? 1 : 0, recoveryUnsaved() ? 1 : 0].join('|')
}

// Bölüm her açılışta sunucudaki güncel bilgiyi bir kez ister (kod başka bir cihazda değişmiş olabilir)
async function recoveryRefresh () {
  if (recoveryUi.refreshing || !state.me) return
  recoveryUi.refreshing = true
  try {
    await reloadServerKeys()
  } finally {
    recoveryUi.refreshing = false
  }
  if (typeof isSettingsOpen === 'function' && isSettingsOpen()) updateSettingsPage()
}

function recoveryStatusText () {
  const rec = identityState.recovery
  if (!rec) return t('settings.account.recoveryNone')
  const created = t('settings.account.recoveryCreated', { date: formatLong(rec.createdAt), device: rec.label || t('sessions.unknown') })
  return recoveryUnsaved() ? created + ' ' + t('settings.account.recoveryUnsaved') : created
}

function recoverySettingsSection (page) {
  const sec = sSection(page, t('settings.account.recoveryTitle'), 'set-recovery-section')
  const status = h('p', 'settings-text recovery-status')
  status.id = 'set-recovery-status'
  sec.appendChild(status)
  const actions = sActions(sec)
  const create = sButton('button button-secondary', '', 'set-recovery-create', null, 'i-key')
  const remove = sButton('button button-secondary', t('settings.account.recoveryRemove'), 'set-recovery-remove', null, 'i-trash')
  actions.appendChild(create)
  actions.appendChild(remove)
  const form = h('form', 'form settings-form')
  form.id = 'set-recovery-form'
  form.noValidate = true
  form.hidden = true
  sec.appendChild(form)
  hiddenUsername(form)
  const pass = sInput('password')
  pass.autocomplete = 'current-password'
  pass.maxLength = 256
  sField(form, 'set-recovery-password', t('settings.account.currentPassword'), pass, null)
  const progress = progressNode('set-recovery-progress')
  form.appendChild(progress)
  const formActions = sActions(form)
  const submit = sButton('button', '', 'set-recovery-submit')
  submit.type = 'submit'
  formActions.appendChild(submit)
  const cancel = sButton('button button-secondary', t('common.cancel'), 'set-recovery-cancel')
  formActions.appendChild(cancel)
  const msg = sMsg('set-recovery-msg')
  sec.appendChild(msg)
  let mode = 'create'
  let trigger = create

  const showForm = (nextMode, from) => {
    mode = nextMode
    trigger = from
    setButtonText(submit, t(mode === 'remove' ? 'settings.account.recoveryRemove' : identityState.recovery ? 'settings.account.recoveryRenew' : 'settings.account.recoveryCreate'))
    submit.className = mode === 'remove' ? 'button button-danger' : 'button'
    form.hidden = false
    setMsg(msg, '')
    focusNode(pass)
  }
  const hideForm = () => {
    form.hidden = true
    pass.value = ''
  }
  create.addEventListener('click', () => {
    showForm('create', create)
  })
  remove.addEventListener('click', () => {
    if (!window.confirm(t('settings.account.recoveryRemoveConfirm'))) return
    showForm('remove', remove)
  })
  cancel.addEventListener('click', () => {
    hideForm()
    focusNode(trigger)
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (isBusy(form)) return
    if (!pass.value) {
      setMsg(msg, () => t('settings.account.enterPassword'), 'error')
      focusNode(pass)
      return
    }
    setMsg(msg, '')
    setFormBusy(form, true)
    const result = await recoveryChangeRequest(pass.value, mode !== 'remove', (pct) => {
      showProgress(progress, pct)
    })
    showProgress(progress, null)
    setFormBusy(form, false)
    if (!result.ok) {
      setMsg(msg, result.error, 'error')
      focusNode(pass)
      return
    }
    hideForm()
    update()
    if (result.code) {
      openRecoveryCodeDialog(result.code, { trigger: create })
    } else {
      setMsg(msg, () => t('settings.account.recoveryRemoved'), 'ok')
      focusNode(create)
    }
  })

  const update = () => {
    const rec = identityState.recovery
    status.textContent = recoveryStatusText()
    status.classList.toggle('is-missing', (identityState.recoveryKnown && !rec) || recoveryUnsaved())
    setButtonText(create, t(rec ? 'settings.account.recoveryRenew' : 'settings.account.recoveryCreate'))
    remove.hidden = !rec
    // Sıfırlanmış parolada kod kurulamaz, önce yeni parola belirlenir
    const blocked = identityState.resetPending || !(identityState.keys && identityState.keys.publicKey)
    if (!isBusy(form)) {
      create.disabled = blocked
      remove.disabled = blocked
    }
    if (blocked && !form.hidden && !isBusy(form)) hideForm()
  }
  update()
  recoveryRefresh()
  return { update: update, signature: recoverySignature }
}

// ----- Kodu olmayan hesaba girişten sonra bir kez hatırlatma -----

// Giriş formuyla başarılı girişten hemen önce çağrılır (03-auth.js submitLogin)
function recoveryNoteLogin () {
  recoveryUi.remindPending = true
}

function recoveryReminded (userId) {
  const all = storeGetJson(RECOVERY_REMIND_KEY, {})
  return all['u:' + userId] === 1
}

function markRecoveryReminded (userId) {
  const all = storeGetJson(RECOVERY_REMIND_KEY, {})
  all['u:' + userId] = 1
  storeSetJson(RECOVERY_REMIND_KEY, all)
}

// Uygulama açılınca (03-auth.js enterApp). Kaydedildiği onaylanmayan kod varsa her sayfa açılışında bir kez uyarı,
// yoksa kodu olmayan hesaba parolayla girişten sonra bir kez hatırlatma. Profil adımı veya kimlik açma penceresi
// açıksa beklenir.
function recoveryAfterEnter () {
  if (!recoveryUi.remindPending && !(state.me && recoveryUnsavedOf(state.me.id) !== null)) return
  clearTimeout(recoveryUi.remindTimer)
  let tries = 0
  const tick = () => {
    recoveryUi.remindTimer = 0
    if (!state.inApp || !state.me) return
    if (findLayer('app-dialog') || (typeof isSettingsOpen === 'function' && isSettingsOpen()) || !identityState.recoveryKnown || !hasIdentity()) {
      tries += 1
      if (tries < RECOVERY_REMIND_TRIES) recoveryUi.remindTimer = setTimeout(tick, RECOVERY_REMIND_DELAY_MS)
      return
    }
    const pending = recoveryUi.remindPending
    recoveryUi.remindPending = false
    if (recoveryUnsaved()) {
      if (recoveryUi.unsavedShownFor === state.me.id) return
      recoveryUi.unsavedShownFor = state.me.id
      openRecoveryUnsaved()
      return
    }
    if (!pending || identityState.recovery || identityState.resetPending || recoveryReminded(state.me.id)) return
    markRecoveryReminded(state.me.id)
    openRecoveryRemind()
  }
  recoveryUi.remindTimer = setTimeout(tick, RECOVERY_REMIND_DELAY_MS)
}

// Ayarlar > Hesabım açılır ve Kurtarma Kodu bölümünün oluşturma düğmesine odaklanılır. Odak katmanın ilk odağı
// olarak verilir, ayrı bir zamanlayıcıyla verilseydi katmanın sonraki karedeki odağı onu başlığa taşıyabilirdi.
function openRecoverySettings () {
  openSettings('account', null, () => {
    const section = byId('set-recovery-section')
    if (section && typeof section.scrollIntoView === 'function') section.scrollIntoView()
    return byId('set-recovery-create')
  })
}

function openRecoveryRemind () {
  openAppDialog({
    name: 'recovery-remind',
    titleKey: 'settings.account.recoveryTitle',
    build: (body, close) => {
      body.appendChild(recoveryText('p', 'lead', () => t('recovery.remind')))
      const row = h('div', 'row dialog-actions')
      const create = button('button', t('settings.account.recoveryCreate'), 'i-key')
      create.id = 'recovery-remind-create'
      const later = button('button button-secondary', t('identity.unlockLater'))
      later.id = 'recovery-remind-later'
      create.addEventListener('click', () => {
        close('done')
        openRecoverySettings()
      })
      later.addEventListener('click', () => {
        close('later')
      })
      row.appendChild(create)
      row.appendChild(later)
      body.appendChild(row)
      return create
    }
  })
}

// Kaydedildiği onaylanmayan kod: yeni kod oluşturma (eskisi geçersiz olur), kodu kaydettiğini bildirme veya sonraya
// bırakma. Sonraya bırakılırsa uyarı sonraki sayfa açılışında yeniden çıkar.
function openRecoveryUnsaved () {
  const userId = state.me.id
  openAppDialog({
    name: 'recovery-unsaved',
    titleKey: 'settings.account.recoveryTitle',
    build: (body, close) => {
      body.appendChild(recoveryText('p', 'lead', () => t('recovery.unsavedRemind')))
      const row = h('div', 'row dialog-actions')
      const renew = button('button', t('settings.account.recoveryRenew'), 'i-key')
      renew.id = 'recovery-unsaved-renew'
      const saved = button('button button-secondary', t('recovery.unsavedConfirm'))
      saved.id = 'recovery-unsaved-confirm'
      const later = button('button button-secondary', t('identity.unlockLater'))
      later.id = 'recovery-unsaved-later'
      renew.addEventListener('click', () => {
        close('done')
        openRecoverySettings()
      })
      saved.addEventListener('click', () => {
        recoveryConfirmed(userId)
        close('done')
      })
      later.addEventListener('click', () => {
        close('later')
      })
      row.appendChild(renew)
      row.appendChild(saved)
      row.appendChild(later)
      body.appendChild(row)
      return renew
    }
  })
}

// Oturum kapanınca bekleyen hatırlatma düşer (03-auth.js resetAppState)
function recoveryReset () {
  recoveryUi.remindPending = false
  clearTimeout(recoveryUi.remindTimer)
  recoveryUi.remindTimer = 0
  recoveryUi.unsavedShownFor = null
  clearForgotSecrets()
}
