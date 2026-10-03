'use strict'

// Ayarlar penceresi: hesap (geçici dil seçimi), ses (Ek D1 ayarları), şifreleme, sunucu ve üye sekmeleri.

// Ayarlar penceresi (5.7)

const SETTINGS_TABS = ['account', 'voice', 'crypto', 'server', 'members']
let settingsTab = 'account'
let capturingPtt = false

function tabEl (name) {
  return el['settingsTab' + name.charAt(0).toUpperCase() + name.slice(1)]
}

function panelEl (name) {
  return el['settingsPanel' + name.charAt(0).toUpperCase() + name.slice(1)]
}

function visibleTabs () {
  return SETTINGS_TABS.filter((name) => (name === 'server' || name === 'members') ? isAdmin() : true)
}

function isSettingsOpen () {
  return Boolean(findLayer('settings'))
}

function isSettingsTab (name) {
  return isSettingsOpen() && settingsTab === name
}

function openSettings (tab, trigger) {
  if (!state.inApp) return
  closeDrawers()
  const existing = findLayer('settings')
  if (existing) {
    selectSettingsTab(tab || settingsTab, true)
    return
  }
  el.settingsModal.hidden = false
  document.body.classList.add('modal-open')
  selectSettingsTab(tab || 'account', false)
  openLayer({
    name: 'settings',
    el: el.settingsModal,
    trigger: trigger || el.btnSettings,
    level: 1,
    trap: true,
    initialFocus: () => tabEl(settingsTab),
    onClose: () => {
      el.settingsModal.hidden = true
      document.body.classList.remove('modal-open')
      cancelPttCapture()
      setMsg(el.setPttMsg, '')
      setKeyVisible(false)
      setInviteVisible(false)
      el.setNewInviteWrap.hidden = true
      el.setNewInvite.value = ''
      el.setTempWrap.hidden = true
      el.setTempPassword.textContent = ''
      el.setOldPassword.value = ''
      el.setNewPassword.value = ''
      el.setNewPassword2.value = ''
    }
  })
  if (isAdmin()) refreshInviteCode()
}

function selectSettingsTab (name, focusTab) {
  const tabs = visibleTabs()
  const target = tabs.indexOf(name) !== -1 ? name : 'account'
  settingsTab = target
  SETTINGS_TABS.forEach((n) => {
    const tab = tabEl(n)
    const panel = panelEl(n)
    const allowed = tabs.indexOf(n) !== -1
    tab.hidden = !allowed
    const selected = n === target
    tab.setAttribute('aria-selected', selected ? 'true' : 'false')
    tab.tabIndex = selected ? 0 : -1
    panel.hidden = !selected
  })
  renderSettingsPanel(target)
  if (target === 'voice') fillMicList()
  if (focusTab) focusNode(tabEl(target))
}

function onSettingsTabsKey (e) {
  const tabs = visibleTabs()
  const i = tabs.indexOf(settingsTab)
  let next = -1
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') next = (i + 1) % tabs.length
  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = tabs.length - 1
  if (next === -1) return
  e.preventDefault()
  selectSettingsTab(tabs[next], true)
}

function renderSettingsPanel (name) {
  if (name === 'account') renderSettingsAccount()
  else if (name === 'voice') renderSettingsVoice()
  else if (name === 'crypto') renderSettingsCrypto()
  else if (name === 'server') renderSettingsServer()
  else if (name === 'members') renderSettingsMembers()
}

// Meta değişince açık ayarlar yeniden çizilir, yetkisi kalmayan sekme kapanır.
function refreshSettings () {
  if (!isSettingsOpen()) return
  if (visibleTabs().indexOf(settingsTab) === -1) {
    selectSettingsTab('account', true)
    return
  }
  SETTINGS_TABS.forEach((n) => {
    tabEl(n).hidden = visibleTabs().indexOf(n) === -1
  })
  const panel = panelEl(settingsTab)
  const active = document.activeElement
  if (panel.contains(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.tagName === 'SELECT')) {
    if (settingsTab === 'members') renderSettingsMembers()
    if (settingsTab === 'server') renderServerChannels()
    return
  }
  renderSettingsPanel(settingsTab)
}

// Hesap

function renderSettingsAccount () {
  if (!state.me) return
  el.setAvatar.textContent = initial(state.me.name)
  el.setAvatar.className = 'avatar avatar-large ' + avatarClass(state.me.id)
  el.setName.textContent = state.me.name
  el.setRole.textContent = t('settings.account.role', { role: roleLabel(state.me.role) })
  el.setLang.value = window.I18N.lang
  el.setNotify.checked = notificationsEnabled()
  el.setInstallWrap.hidden = !state.installPrompt
  el.setIosHint.hidden = !(isIos() && !isStandalone())
}

async function submitPasswordChange (e) {
  e.preventDefault()
  const oldPassword = el.setOldPassword.value
  const newPassword = el.setNewPassword.value
  if (!oldPassword) {
    setMsg(el.setPasswordMsg, () => t('settings.password.enterOld'), 'error')
    return
  }
  const plen = cpLength(newPassword)
  if (plen < state.limits.passwordMin || plen > state.limits.passwordMax) {
    const limits = state.limits
    setMsg(el.setPasswordMsg, () => t('settings.password.length', { min: limits.passwordMin, max: limits.passwordMax }), 'error')
    return
  }
  if (newPassword !== el.setNewPassword2.value) {
    setMsg(el.setPasswordMsg, () => t('settings.password.mismatch'), 'error')
    return
  }
  el.setPasswordSubmit.disabled = true
  const res = await api('POST', '/api/me/password', { oldPassword: oldPassword, newPassword: newPassword })
  el.setPasswordSubmit.disabled = false
  if (res.status === 200) {
    el.setOldPassword.value = ''
    el.setNewPassword.value = ''
    el.setNewPassword2.value = ''
    setMsg(el.setPasswordMsg, () => t('settings.password.changed'), 'ok')
    return
  }
  setMsg(el.setPasswordMsg, () => errorText(res, t('settings.password.failed'), { bad_credentials: t('settings.password.oldWrong'), rate_limited: t('auth.rateLimited') }), 'error')
}

function onNotifyChange () {
  if (!el.setNotify.checked) {
    storeSet(KEYS.notify, '0')
    setMsg(el.setNotifyMsg, '')
    return
  }
  const N = window.Notification
  if (typeof N !== 'function') {
    el.setNotify.checked = false
    setMsg(el.setNotifyMsg, () => t('settings.notify.unsupported'), 'error')
    return
  }
  const done = (permission) => {
    if (permission === 'granted') {
      storeSet(KEYS.notify, '1')
      el.setNotify.checked = true
      setMsg(el.setNotifyMsg, () => t('settings.notify.enabled'), 'ok')
    } else {
      storeSet(KEYS.notify, '0')
      el.setNotify.checked = false
      setMsg(el.setNotifyMsg, () => t('settings.notify.denied'), 'error')
    }
  }
  if (N.permission === 'granted') {
    done('granted')
    return
  }
  try {
    const result = N.requestPermission(done)
    if (result && typeof result.then === 'function') result.then(done, () => done('denied'))
  } catch (err) {
    done('denied')
  }
}

async function installApp () {
  const prompt = state.installPrompt
  if (!prompt) return
  state.installPrompt = null
  el.setInstallWrap.hidden = true
  try {
    prompt.prompt()
    await prompt.userChoice
  } catch (err) {
    // Kullanıcı vazgeçti
  }
}

// Ses (Ek D1). Ayarlar voice.js içinde saklanır ('telsiz.voice'), burada yalnızca gösterilir ve
// voice.setSettings ile değiştirilir. Ayrıntılı ses ayarları sayfası Ek D2 ile gelecek.

function voiceSettings () {
  if (!voice) return null
  try {
    return voice.settings()
  } catch (err) {
    return null
  }
}

function pttBindingLabel (settings) {
  if (!voice) return ''
  const binding = settings && settings.bindings ? settings.bindings.ptt : null
  try {
    return voice.bindingLabel(binding, t)
  } catch (err) {
    return ''
  }
}

// Ayar değişikliği. Mikrofon yeniden alınamazsa voice.js hata kodu döner.
function applyVoiceSettings (partial) {
  if (!voice) return
  let pending = null
  try {
    pending = voice.setSettings(partial)
  } catch (err) {
    pending = null
  }
  Promise.resolve(pending).then((code) => {
    if (code) toast(() => voiceErrorText(code, ''), 'error')
  }, () => {})
  renderSettingsVoice()
}

function renderSettingsVoice () {
  const problem = voiceSupportCode()
  setMsg(el.setVoiceSupport, problem && problem !== 'no_key' ? voiceErrorText(problem, '') : '', 'error')
  const settings = voiceSettings()
  const enabled = Boolean(settings)
  const mode = settings && settings.inputMode === 'ptt' ? 'ptt' : 'vad'
  el.setModeVad.checked = mode === 'vad'
  el.setModePtt.checked = mode === 'ptt'
  el.setModeVad.disabled = !enabled
  el.setModePtt.disabled = !enabled
  el.setMic.disabled = !enabled
  el.setMicRefresh.disabled = !enabled
  el.setVadWrap.hidden = mode !== 'vad'
  el.setPttWrap.hidden = mode !== 'ptt'
  const auto = !settings || settings.vadAuto !== false
  el.setVadAuto.checked = auto
  el.setVadAuto.disabled = !enabled
  const threshold = settings && typeof settings.vadThreshold === 'number' ? settings.vadThreshold : -50
  if (document.activeElement !== el.setVadThreshold) el.setVadThreshold.value = String(threshold)
  el.setVadThreshold.disabled = !enabled || auto
  const release = settings && typeof settings.pttReleaseMs === 'number' ? settings.pttReleaseMs : 200
  if (document.activeElement !== el.setPttRelease) el.setPttRelease.value = String(release)
  el.setPttRelease.disabled = !enabled
  el.setPttReleaseValue.textContent = t('settings.voice.msValue', { value: formatNumber(release) })
  el.setPttChange.disabled = !enabled
  if (!capturingPtt) el.setPttKey.textContent = pttBindingLabel(settings)
  updateLevelMeter()
}

// dBFS değerini (-100..0) çubuktaki yüzdeye çevirir
function dbPercent (db) {
  if (typeof db !== 'number' || !isFinite(db)) return 0
  return Math.max(0, Math.min(100, db + 100))
}

// Seviye çubuğu, eşik işareti ve eşik değeri (seste iken akıcı güncellenir)
function updateLevelMeter () {
  const s = snap()
  const settings = voiceSettings()
  const measuring = Boolean(s.channelId || s.testing) && typeof s.level === 'number'
  el.setLevelBar.style.width = (measuring ? dbPercent(s.level) : 0) + '%'
  el.setLevelBar.classList.toggle('is-speaking', Boolean(measuring && s.gateOpen))
  const showThreshold = s.inputMode !== 'ptt' && typeof s.threshold === 'number'
  el.setLevelThreshold.hidden = !showThreshold
  if (showThreshold) el.setLevelThreshold.style.left = dbPercent(s.threshold) + '%'
  el.setLevelNote.textContent = t(s.channelId ? 'settings.voice.levelSpeaking' : 'settings.voice.levelOnlyInVoice')
  const auto = !settings || settings.vadAuto !== false
  if (auto) {
    el.setVadThresholdValue.textContent = typeof s.threshold === 'number'
      ? t('settings.voice.autoValue', { value: formatNumber(Math.round(s.threshold)) })
      : t('settings.voice.auto')
  } else {
    const value = settings && typeof settings.vadThreshold === 'number' ? settings.vadThreshold : -50
    el.setVadThresholdValue.textContent = t('settings.voice.dbValue', { value: formatNumber(value) })
  }
}

async function fillMicList () {
  if (!voice) return
  let devices = []
  try {
    devices = await voice.listInputDevices()
  } catch (err) {
    devices = []
  }
  const settings = voiceSettings()
  const current = settings && typeof settings.inputDeviceId === 'string' ? settings.inputDeviceId : ''
  clear(el.setMic)
  const def = h('option', '', t('settings.voice.defaultMic'))
  def.value = ''
  el.setMic.appendChild(def)
  let n = 0
  const list = Array.isArray(devices) ? devices : []
  list.forEach((d) => {
    if (!d || typeof d.deviceId !== 'string' || d.deviceId === '' || d.deviceId === 'default') return
    n += 1
    const index = typeof d.index === 'number' && d.index > 0 ? d.index : n
    const opt = h('option', '', d.label ? d.label : t('settings.voice.micUnnamed', { n: index }))
    opt.value = d.deviceId
    el.setMic.appendChild(opt)
  })
  el.setMic.value = current
  if (el.setMic.value !== current) el.setMic.value = ''
}

function onMicChange () {
  applyVoiceSettings({ inputDeviceId: el.setMic.value || null })
}

function onInputModeChange () {
  applyVoiceSettings({ inputMode: el.setModePtt.checked ? 'ptt' : 'vad' })
}

function onVadAutoChange () {
  applyVoiceSettings({ vadAuto: el.setVadAuto.checked })
}

function sliderValue (input, min, max) {
  const n = Math.round(Number(input.value))
  return isFinite(n) ? Math.max(min, Math.min(max, n)) : min
}

function onVadThresholdInput () {
  applyVoiceSettings({ vadThreshold: sliderValue(el.setVadThreshold, -100, 0) })
}

function onPttReleaseInput () {
  applyVoiceSettings({ pttReleaseMs: sliderValue(el.setPttRelease, 0, 1000) })
}

// Bas konuş ataması: sonraki klavye tuşu, fare orta veya yan tuşu ya da oyun kolu düğmesi.
// Esc veya 10 sn zaman aşımı yakalamayı iptal eder. Yakalanan tuş ve Esc başka işleyicilere ulaşmaz.
function startPttCapture () {
  if (!voice || capturingPtt) return
  capturingPtt = true
  el.setPttKey.textContent = '...'
  setMsg(el.setPttMsg, () => t('settings.voice.capturePrompt'))
  let pending = null
  try {
    pending = voice.captureBinding()
  } catch (err) {
    pending = null
  }
  Promise.resolve(pending).then((binding) => {
    capturingPtt = false
    if (binding) {
      applyVoiceSettings({ bindings: { ptt: binding } })
      setMsg(el.setPttMsg, () => t('settings.voice.pttKeySet', { key: pttBindingLabel(voiceSettings()) }), 'ok')
    } else {
      setMsg(el.setPttMsg, '')
    }
    renderSettingsVoice()
  }, () => {
    capturingPtt = false
    setMsg(el.setPttMsg, '')
    renderSettingsVoice()
  })
}

function cancelPttCapture () {
  if (!capturingPtt) return
  capturingPtt = false
  if (voice) {
    try {
      voice.cancelCapture()
    } catch (err) {
      // Yakalama zaten bitmiş
    }
  }
}

// Şifreleme

function setKeyVisible (visible) {
  el.setKeyShow.setAttribute('aria-pressed', visible ? 'true' : 'false')
  el.setKeyShow.textContent = t(visible ? 'common.hide' : 'common.show')
  const entry = activeKeyEntry()
  el.setActiveKey.textContent = visible && entry ? entry.code : t('common.hidden')
  el.setActiveKey.classList.toggle('secret-visible', Boolean(visible && entry))
}

function activeKeyEntry () {
  const kid = activeKid()
  if (!kid || !cryptoReady()) return null
  try {
    return window.E2EE.keyring.list().filter((k) => k.kid === kid)[0] || null
  } catch (err) {
    return null
  }
}

function renderSettingsCrypto () {
  clear(el.setKeyring)
  let keys = []
  try {
    keys = cryptoReady() ? window.E2EE.keyring.list() : []
  } catch (err) {
    keys = []
  }
  const kid = activeKid()
  if (!keys.length) {
    el.setKeyring.appendChild(h('li', 'empty-row', t('settings.crypto.noKeys')))
  }
  keys.forEach((k) => {
    const li = h('li', 'list-row')
    const info = h('span', 'list-main')
    info.appendChild(icon('i-key'))
    info.appendChild(h('code', 'kid', k.kid.slice(0, 8)))
    if (k.kid === kid) info.appendChild(h('span', 'badge badge-active', t('settings.crypto.activeBadge')))
    if (k.added) info.appendChild(h('span', 'list-sub', t('settings.crypto.addedAt', { date: formatShort(k.added) })))
    li.appendChild(info)
    const remove = button('button button-small button-ghost', t('common.remove'), null, t('settings.crypto.removeKey', { kid: k.kid.slice(0, 8) }))
    remove.addEventListener('click', () => {
      const warn = t(k.kid === kid ? 'settings.crypto.removeActiveConfirm' : 'settings.crypto.removeConfirm')
      if (!window.confirm(warn)) return
      window.E2EE.keyring.remove(k.kid)
      afterKeyringChange()
    })
    li.appendChild(remove)
    el.setKeyring.appendChild(li)
  })
  const entry = activeKeyEntry()
  el.setActiveRow.hidden = !entry
  el.setInviteCopy.hidden = !entry
  setMsg(el.setActiveMissing, entry ? '' : (kid ? t('settings.crypto.activeMissing', { kid: kid.slice(0, 8) }) : t('settings.crypto.noActive')))
  setKeyVisible(el.setKeyShow.getAttribute('aria-pressed') === 'true')
  el.setKeyAdmin.hidden = !isAdmin()
  el.setKeyGenerate.textContent = t(kid ? 'settings.crypto.newKey' : 'key.generate')
}

function afterKeyringChange () {
  renderSettingsCrypto()
  renderComposerState()
  refreshAllMessages()
  renderVoiceAll()
}

function submitSettingsKey (e) {
  e.preventDefault()
  const value = el.setKeyInput.value.trim()
  if (!value) {
    setMsg(el.setKeyMsg, () => t('settings.crypto.enterKey'), 'error')
    return
  }
  try {
    const kid = window.E2EE.keyring.add(value)
    el.setKeyInput.value = ''
    const isActive = kid === activeKid()
    setMsg(el.setKeyMsg, () => (isActive ? t('settings.crypto.activeAdded') : t('settings.crypto.keyAdded', { kid: kid.slice(0, 8) })), 'ok')
  } catch (err) {
    setMsg(el.setKeyMsg, () => keyErrorText(err), 'error')
    return
  }
  afterKeyringChange()
}

function copyInviteLink () {
  const entry = activeKeyEntry()
  if (!entry) return
  const link = isAdmin() && state.inviteCode ? inviteLink(state.inviteCode, entry.code) : inviteLink(null, entry.code)
  copyWithToast(link)
}

async function generateNewKey () {
  if (!isAdmin()) return
  const hadKey = Boolean(activeKid())
  if (hadKey && !window.confirm(t('settings.crypto.newKeyConfirm'))) return
  el.setKeyGenerate.disabled = true
  const created = await createGroupKey()
  el.setKeyGenerate.disabled = false
  if (!created.ok) {
    setMsg(el.setKeyMsg, created.error, 'error')
    return
  }
  await refreshInviteCode()
  el.setNewInvite.value = inviteLink(state.inviteCode, created.code)
  el.setNewInviteWrap.hidden = false
  setMsg(el.setKeyMsg, () => t('settings.crypto.newKeyActivated'), 'ok')
  afterKeyringChange()
  focusNode(el.setNewInviteCopy)
}

// Sunucu

async function refreshInviteCode () {
  if (!isAdmin()) return
  const res = await api('GET', '/api/state')
  if (res.status === 200 && res.data) {
    state.inviteCode = typeof res.data.inviteCode === 'string' ? res.data.inviteCode : null
    if (Array.isArray(res.data.bannedUsers)) state.bannedUsers = res.data.bannedUsers
    if (isSettingsTab('server')) setInviteVisible(el.setInviteShow.getAttribute('aria-pressed') === 'true')
    if (isSettingsTab('members')) renderSettingsMembers()
  }
}

function setInviteVisible (visible) {
  el.setInviteShow.setAttribute('aria-pressed', visible ? 'true' : 'false')
  el.setInviteShow.textContent = t(visible ? 'common.hide' : 'common.show')
  el.setInviteCode.textContent = visible ? (state.inviteCode || t('settings.server.unavailable')) : t('common.hidden')
  el.setInviteCode.classList.toggle('secret-visible', visible)
}

function renderSettingsServer () {
  el.setServerName.value = state.serverName
  el.setServerName.disabled = !isOwner()
  el.setServerSave.hidden = !isOwner()
  setInviteVisible(el.setInviteShow.getAttribute('aria-pressed') === 'true')
  renderServerChannels()
}

function renderServerChannels () {
  fillChannelAdmin(el.setTextChannels, textChannels())
  fillChannelAdmin(el.setVoiceChannels, voiceChannels())
}

function fillChannelAdmin (list, channels) {
  const focusKey = activeFocusKey(list)
  clear(list)
  channels.forEach((c, i) => {
    const li = h('li', 'list-row channel-admin-row')
    const main = h('span', 'list-main')
    main.appendChild(icon(c.type === 'voice' ? 'i-speaker' : 'i-hash'))
    main.appendChild(h('span', 'list-name', c.name))
    li.appendChild(main)
    const actions = h('span', 'row-actions')
    const up = button('icon-button', '', 'i-up', t('settings.server.moveUp', { name: c.name }))
    up.disabled = i === 0
    up.setAttribute('data-focus-key', 'up-' + c.id)
    up.addEventListener('click', () => {
      moveChannel(c, -1)
    })
    const down = button('icon-button', '', 'i-down', t('settings.server.moveDown', { name: c.name }))
    down.disabled = i === channels.length - 1
    down.setAttribute('data-focus-key', 'down-' + c.id)
    down.addEventListener('click', () => {
      moveChannel(c, 1)
    })
    const rename = button('button button-small button-secondary', t('settings.server.rename'), null, t('settings.server.renameLabel', { name: c.name }))
    rename.setAttribute('data-focus-key', 'rename-' + c.id)
    rename.addEventListener('click', () => {
      startRename(li, c)
    })
    const del = button('button button-small button-danger', t('common.delete'), null, t('settings.server.deleteLabel', { name: c.name }))
    del.setAttribute('data-focus-key', 'del-' + c.id)
    del.addEventListener('click', () => {
      deleteChannel(c)
    })
    actions.appendChild(up)
    actions.appendChild(down)
    actions.appendChild(rename)
    actions.appendChild(del)
    li.appendChild(actions)
    list.appendChild(li)
  })
  restoreFocusKey(list, focusKey)
}

function startRename (li, c) {
  clear(li)
  const form = h('form', 'row rename-form')
  form.noValidate = true
  const label = h('label', 'sr-only', t('settings.server.newName'))
  const input = h('input', 'input')
  input.type = 'text'
  input.id = 'rename-' + c.id
  label.setAttribute('for', input.id)
  input.maxLength = state.limits.channelNameMax
  input.value = c.name
  const save = button('button button-small', t('common.save'))
  save.type = 'submit'
  const cancel = button('button button-small button-secondary', t('common.cancel'))
  cancel.addEventListener('click', () => {
    renderServerChannels()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault()
      e.stopPropagation()
      renderServerChannels()
    }
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const name = normalizeName(input.value)
    if (!name) return
    save.disabled = true
    const res = await api('POST', '/api/channels/update', { id: c.id, name: name })
    save.disabled = false
    if (res.status === 200) {
      setMsg(el.setChannelMsg, () => t('settings.server.renamed'), 'ok')
      renderServerChannels()
      return
    }
    setMsg(el.setChannelMsg, () => errorText(res, t('settings.server.renameFailed')), 'error')
  })
  form.appendChild(label)
  form.appendChild(input)
  form.appendChild(save)
  form.appendChild(cancel)
  li.appendChild(form)
  focusNode(input)
  input.select()
}

async function moveChannel (c, delta) {
  const same = channelsOf(c.type)
  const index = same.indexOf(c)
  const target = index + delta
  if (index === -1 || target < 0 || target >= same.length) return
  const res = await api('POST', '/api/channels/update', { id: c.id, position: target })
  if (res.status !== 200) {
    setMsg(el.setChannelMsg, () => errorText(res, t('settings.server.moveFailed')), 'error')
    return
  }
  if (res.data && res.data.channel && state.meta) {
    // Meta gelene kadar yerel sıra güncellenir
    const others = same.filter((x) => x !== c)
    others.splice(target, 0, c)
    others.forEach((x, i) => {
      x.position = i
    })
    renderServerChannels()
    renderChannels()
    renderVoiceAll()
  }
}

async function deleteChannel (c) {
  const text = t(c.type === 'voice' ? 'settings.server.deleteVoiceConfirm' : 'settings.server.deleteTextConfirm', { name: c.name })
  if (!window.confirm(text)) return
  const res = await api('POST', '/api/channels/delete', { id: c.id })
  if (res.status === 200) {
    setMsg(el.setChannelMsg, () => t('settings.server.deleted'), 'ok')
    return
  }
  setMsg(el.setChannelMsg, () => errorText(res, t('settings.server.deleteFailed')), 'error')
}

async function submitChannelCreate (e) {
  e.preventDefault()
  const name = normalizeName(el.setChannelName.value)
  const type = el.setChannelType.value === 'voice' ? 'voice' : 'text'
  if (!name) {
    setMsg(el.setChannelMsg, () => t('settings.server.enterChannelName'), 'error')
    return
  }
  el.setChannelCreate.disabled = true
  const res = await api('POST', '/api/channels/create', { name: name, type: type })
  el.setChannelCreate.disabled = false
  if (res.status === 200) {
    el.setChannelName.value = ''
    setMsg(el.setChannelMsg, () => t(type === 'voice' ? 'settings.server.voiceCreated' : 'settings.server.textCreated'), 'ok')
    return
  }
  setMsg(el.setChannelMsg, () => errorText(res, t('settings.server.createFailed')), 'error')
}

async function submitServerName (e) {
  e.preventDefault()
  if (!isOwner()) return
  const name = normalizeName(el.setServerName.value)
  if (!name) {
    setMsg(el.setServerMsg, () => t('settings.server.enterName'), 'error')
    return
  }
  el.setServerSave.disabled = true
  const res = await api('POST', '/api/settings', { serverName: name })
  el.setServerSave.disabled = false
  if (res.status === 200) {
    setMsg(el.setServerMsg, () => t('settings.server.nameSaved'), 'ok')
    return
  }
  setMsg(el.setServerMsg, () => errorText(res, t('settings.server.nameFailed')), 'error')
}

async function rotateInvite () {
  if (!window.confirm(t('settings.server.rotateConfirm'))) return
  el.setInviteRotate.disabled = true
  const res = await api('POST', '/api/invite/rotate')
  el.setInviteRotate.disabled = false
  if (res.status === 200 && res.data && typeof res.data.inviteCode === 'string') {
    state.inviteCode = res.data.inviteCode
    setInviteVisible(true)
    setMsg(el.setInviteMsg, () => t('settings.server.rotated'), 'ok')
    return
  }
  setMsg(el.setInviteMsg, () => errorText(res, t('settings.server.rotateFailed')), 'error')
}

// Üyeler

function renderSettingsMembers () {
  const list = el.setMembersList
  const focusKey = activeFocusKey(list)
  clear(list)
  const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
  users.forEach((u) => {
    list.appendChild(buildMemberAdminRow(u, false))
  })
  restoreFocusKey(list, focusKey)
  const banned = bannedList()
  el.setBannedWrap.hidden = !banned.length
  const bFocus = activeFocusKey(el.setBannedList)
  clear(el.setBannedList)
  banned.forEach((u) => {
    el.setBannedList.appendChild(buildMemberAdminRow(u, true))
  })
  restoreFocusKey(el.setBannedList, bFocus)
}

// Engellenenler meta'da yer almaz. Sunucu /api/state içinde bannedUsers verirse o, yoksa
// bu oturumda bilinen ama meta'dan düşen kullanıcılar listelenir.
function bannedList () {
  const present = new Set((state.meta && Array.isArray(state.meta.users) ? state.meta.users : []).map((u) => String(u.id)))
  const out = new Map()
  if (Array.isArray(state.bannedUsers)) {
    state.bannedUsers.forEach((u) => {
      if (u && u.id !== undefined && !present.has(String(u.id))) out.set(String(u.id), { id: u.id, name: String(u.name || userName(u.id)), role: u.role || 'member' })
    })
  }
  state.users.forEach((u, id) => {
    if (!present.has(id) && !out.has(id)) out.set(id, { id: u.id, name: u.name, role: u.role })
  })
  return Array.from(out.values())
}

function buildMemberAdminRow (u, banned) {
  const li = h('li', 'list-row member-row')
  li.setAttribute('data-user-id', String(u.id))
  const main = h('span', 'list-main')
  const av = h('span', 'avatar-wrap')
  av.appendChild(avatar(u.id, u.name))
  if (!banned) av.appendChild(h('span', 'presence-dot' + (u.online ? ' is-online' : '')))
  main.appendChild(av)
  const text = h('span', 'list-text')
  text.appendChild(h('span', 'list-name', state.me && sameId(u.id, state.me.id) ? t('voice.selfName', { name: u.name }) : u.name))
  const sub = banned ? t('settings.members.bannedState') : t('settings.members.sub', { role: roleLabel(u.role), status: t(u.online ? 'presence.online' : 'presence.offline') })
  text.appendChild(h('span', 'list-sub', sub))
  main.appendChild(text)
  li.appendChild(main)
  const actions = h('span', 'row-actions')
  const self = state.me && sameId(u.id, state.me.id)
  const owner = isOwner()
  if (!banned && owner && !self && u.role !== 'owner') {
    const promote = u.role === 'admin'
    const roleBtn = button('button button-small button-secondary act-role', t(promote ? 'settings.members.makeMember' : 'settings.members.makeAdmin'))
    roleBtn.setAttribute('data-focus-key', 'role-' + u.id)
    roleBtn.addEventListener('click', () => {
      setUserRole(u, promote ? 'member' : 'admin')
    })
    actions.appendChild(roleBtn)
  }
  const canBan = !self && u.role !== 'owner' && (owner || u.role === 'member')
  if (canBan) {
    const banBtn = button('button button-small ' + (banned ? 'button-secondary' : 'button-danger') + ' act-ban', t(banned ? 'settings.members.unban' : 'settings.members.ban'))
    banBtn.setAttribute('data-focus-key', 'ban-' + u.id)
    banBtn.addEventListener('click', () => {
      setUserBan(u, !banned)
    })
    actions.appendChild(banBtn)
  }
  if (owner && !self && !banned) {
    const reset = button('button button-small button-ghost act-reset', t('settings.members.resetPassword'))
    reset.setAttribute('data-focus-key', 'reset-' + u.id)
    reset.addEventListener('click', () => {
      resetUserPassword(u)
    })
    actions.appendChild(reset)
  }
  li.appendChild(actions)
  return li
}

async function setUserRole (u, role) {
  const res = await api('POST', '/api/users/role', { userId: u.id, role: role })
  if (res.status === 200) {
    setMsg(el.setMembersMsg, () => t(role === 'admin' ? 'settings.members.nowAdmin' : 'settings.members.nowMember', { name: u.name }), 'ok')
    return
  }
  setMsg(el.setMembersMsg, () => errorText(res, t('settings.members.roleFailed')), 'error')
}

async function setUserBan (u, banned) {
  if (banned && !window.confirm(t('settings.members.banConfirm', { name: u.name }))) return
  const res = await api('POST', '/api/users/ban', { userId: u.id, banned: banned })
  if (res.status === 200) {
    if (Array.isArray(state.bannedUsers)) {
      state.bannedUsers = banned ? state.bannedUsers.concat([{ id: u.id, name: u.name }]) : state.bannedUsers.filter((b) => !sameId(b.id, u.id))
    }
    if (!banned) state.users.delete(String(u.id))
    setMsg(el.setMembersMsg, () => t(banned ? 'settings.members.bannedOk' : 'settings.members.unbannedOk', { name: u.name }), 'ok')
    renderSettingsMembers()
    return
  }
  setMsg(el.setMembersMsg, () => errorText(res, t('settings.members.actionFailed')), 'error')
}

async function resetUserPassword (u) {
  if (!window.confirm(t('settings.members.resetConfirm', { name: u.name }))) return
  const res = await api('POST', '/api/users/reset-password', { userId: u.id })
  if (res.status === 200 && res.data && typeof res.data.tempPassword === 'string') {
    setLive(el.setTempLabel, () => t('settings.members.tempLabel', { name: u.name }))
    el.setTempPassword.textContent = res.data.tempPassword
    el.setTempWrap.hidden = false
    setMsg(el.setMembersMsg, '')
    focusNode(el.setTempCopy)
    return
  }
  setMsg(el.setMembersMsg, () => errorText(res, t('settings.members.resetFailed')), 'error')
}
