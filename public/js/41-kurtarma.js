'use strict'

// Kurtarma kodu arayüzü (istek 14): giriş ekranındaki Parolamı Unuttum kartı (kurtarma koduyla yeni parola, kodu
// olmayanlar için sahibe yönlendirme), kurulumdan, kayıttan ve kurtarmadan sonra gösterilen kurtarma kodu kartı,
// uygulama içindeki kod penceresi (Kopyala, Dosya Olarak İndir, "kaydettim" onayı), Ayarlar > Hesabım içindeki
// Kurtarma Kodu bölümü ve kodu olmayan hesaba parolayla girişten sonra bir kez gösterilen hatırlatma.
// Şifreleme ve sunucu istekleri 16-identity.js içindedir (recoverAccount, recoveryChangeRequest).

const RECOVERY_REMIND_KEY = 'telsiz.recoveryReminded'
const RECOVERY_REMIND_DELAY_MS = 1500
const RECOVERY_REMIND_TRIES = 40

const recoveryUi = {
  forgotReady: false,
  forgot: null,
  remindPending: false,
  remindTimer: 0,
  refreshing: false
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

// Giriş ekranındaki kod kartı (kurulum, kayıt ve kurtarma sonrası). next Devam ile çağrılır.
function showRecoveryCard (code, name, rotated, next) {
  const card = el.recoveryCard
  clear(card)
  const title = recoveryText('h2', 'section-heading', () => t('recovery.title'))
  title.id = 'recovery-title'
  card.appendChild(title)
  buildRecoveryCodeView(card, {
    code: code,
    name: name,
    rotated: rotated,
    idPrefix: 'recovery-card',
    onContinue: () => {
      clear(card)
      next()
    }
  })
  showAuthCard('recovery')
  focusNode(byId('recovery-card-copy'))
}

// Uygulama içindeki kod penceresi (Ayarlar'dan oluşturma ve yenileme, sıfırlamadan sonra yeni parola).
// opts: { trigger, rotated }
function openRecoveryCodeDialog (code, opts) {
  const o = opts || {}
  return openAppDialog({
    name: 'recovery-code',
    titleKey: 'recovery.title',
    trigger: o.trigger || null,
    build: (body, close) => buildRecoveryCodeView(body, {
      code: code,
      name: state.me ? state.me.name : '',
      rotated: Boolean(o.rotated),
      idPrefix: 'recovery-dialog',
      onContinue: () => {
        close('done')
      }
    })
  })
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
  showRecoveryCard(result.code, name, true, () => {
    resumeSession()
  })
}

// ----- Ayarlar > Hesabım: Kurtarma Kodu bölümü -----

function recoverySignature () {
  const rec = identityState.recovery
  return [identityState.recoveryKnown ? 1 : 0, rec ? rec.createdAt : '', rec && rec.label ? rec.label : '', identityState.resetPending ? 1 : 0].join('|')
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
  return t('settings.account.recoveryCreated', { date: formatLong(rec.createdAt), device: rec.label || t('sessions.unknown') })
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
    status.classList.toggle('is-missing', identityState.recoveryKnown && !rec)
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

// Uygulama açılınca (03-auth.js enterApp). Profil adımı veya kimlik açma penceresi açıksa beklenir.
function recoveryAfterEnter () {
  if (!recoveryUi.remindPending) return
  clearTimeout(recoveryUi.remindTimer)
  let tries = 0
  const tick = () => {
    recoveryUi.remindTimer = 0
    if (!state.inApp || !state.me || !recoveryUi.remindPending) return
    if (findLayer('app-dialog') || (typeof isSettingsOpen === 'function' && isSettingsOpen()) || !identityState.recoveryKnown || !hasIdentity()) {
      tries += 1
      if (tries < RECOVERY_REMIND_TRIES) recoveryUi.remindTimer = setTimeout(tick, RECOVERY_REMIND_DELAY_MS)
      return
    }
    recoveryUi.remindPending = false
    if (identityState.recovery || identityState.resetPending || recoveryReminded(state.me.id)) return
    markRecoveryReminded(state.me.id)
    openRecoveryRemind()
  }
  recoveryUi.remindTimer = setTimeout(tick, RECOVERY_REMIND_DELAY_MS)
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
        openSettings('account', null)
        setTimeout(() => {
          const section = byId('set-recovery-section')
          if (section && typeof section.scrollIntoView === 'function') section.scrollIntoView()
          focusNode(byId('set-recovery-create'))
        }, 0)
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

// Oturum kapanınca bekleyen hatırlatma düşer (03-auth.js resetAppState)
function recoveryReset () {
  recoveryUi.remindPending = false
  clearTimeout(recoveryUi.remindTimer)
  recoveryUi.remindTimer = 0
  clearForgotSecrets()
}
