'use strict'

// Çekmeceler, pencere boyutu, PWA, dil değişimi, olay bağlama ve uygulamanın başlatılması.

// Çekmeceler (Ek H1): üyeler soldan, kanallar sağdan açılır. Orta genişlikte (760..999px) yalnızca
// üyeler katmandır, kanallar sütunu sağda görünür kalır.

function openDrawer (side, trigger) {
  const isChannels = side === 'channels'
  if (isChannels && !isNarrow()) return
  if (!isChannels && isWide()) return
  const name = 'drawer-' + side
  const existing = findLayer(name)
  if (existing) {
    closeLayer(existing, true)
    return
  }
  closeDrawers()
  const panel = isChannels ? el.sidebar : el.members
  el.appView.classList.add(isChannels ? 'show-channels' : 'show-members')
  el.drawerBackdrop.hidden = false
  trigger.setAttribute('aria-expanded', 'true')
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  openLayer({
    name: name,
    el: panel,
    trigger: trigger,
    level: 1,
    trap: true,
    onClose: () => {
      el.appView.classList.remove(isChannels ? 'show-channels' : 'show-members')
      trigger.setAttribute('aria-expanded', 'false')
      panel.removeAttribute('role')
      panel.removeAttribute('aria-modal')
      if (!findLayer('drawer-channels') && !findLayer('drawer-members')) el.drawerBackdrop.hidden = true
    }
  })
}

function closeDrawers () {
  const names = ['drawer-channels', 'drawer-members']
  names.forEach((name) => {
    const layer = findLayer(name)
    if (layer) closeLayer(layer, false)
  })
  el.drawerBackdrop.hidden = true
}

function onBackdropClick () {
  const layer = findLayer('drawer-channels') || findLayer('drawer-members')
  if (layer) closeLayer(layer, true)
}

let lastLayoutClass = ''

function onResize () {
  autoGrow(el.composerInput, 6)
  keepBottom()
  const cls = isNarrow() ? 'narrow' : isWide() ? 'wide' : 'medium'
  if (cls === lastLayoutClass) return
  lastLayoutClass = cls
  if (state.inApp) renderChannelHeader()
  closeDrawers()
  const picker = findLayer('emoji')
  if (picker) closeLayer(picker, false)
  closeMessageMenu()
  const peer = findLayer('peer')
  if (peer) closeLayer(peer, false)
}

// Tema (Ek G1): theme-init.js kök özniteliklerini yazar, burada tarayıcı çubuğu rengi, renk şeması
// ve giriş ekranındaki güneş/ay düğmesi güncellenir. Değişiklik sayfa yenilenmeden uygulanır.

function themeApi () {
  return window.TelsizTheme && typeof window.TelsizTheme.get === 'function' ? window.TelsizTheme : null
}

function applyThemeMeta () {
  const theme = themeApi()
  const current = theme ? theme.get() : { resolvedScheme: 'dark' }
  const scheme = current.resolvedScheme === 'light' ? 'light' : 'dark'
  let color = ''
  try {
    color = window.getComputedStyle(document.documentElement).getPropertyValue('--theme-color').trim()
  } catch (err) {
    color = ''
  }
  if (!/^#[0-9a-fA-F]{3,8}$/.test(color)) color = scheme === 'light' ? '#ecedf4' : '#0f1015'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', color)
  const schemeMeta = document.querySelector('meta[name="color-scheme"]')
  if (schemeMeta) schemeMeta.setAttribute('content', scheme === 'light' ? 'light dark' : 'dark light')
  renderSchemeToggle()
}

function renderSchemeToggle () {
  if (!el.authScheme) return
  const theme = themeApi()
  const dark = !theme || theme.get().resolvedScheme !== 'light'
  const label = t(dark ? 'theme.toLight' : 'theme.toDark')
  el.authScheme.setAttribute('aria-label', label)
  el.authScheme.title = label
  el.authScheme.setAttribute('aria-pressed', dark ? 'false' : 'true')
}

function toggleScheme () {
  const theme = themeApi()
  if (!theme) return
  theme.set({ scheme: theme.get().resolvedScheme === 'light' ? 'dark' : 'light' })
}

function onThemeChange () {
  applyThemeMeta()
  // Yazı boyutu ve kompakt görünüm satır yüksekliklerini değiştirir
  if (state.inApp) {
    autoGrow(el.composerInput, 6)
    keepBottom()
  }
  if (typeof refreshThemeSettings === 'function') refreshThemeSettings()
}

// PWA (5.9)

function registerServiceWorker () {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return
  try {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {})
  } catch (err) {
    // Service worker desteklenmiyor
  }
}

function onBeforeInstallPrompt (e) {
  e.preventDefault()
  state.installPrompt = e
  settingsOnInstallChange()
}

function onAppInstalled () {
  state.installPrompt = null
  settingsOnInstallChange()
  toast(() => t('app.installed'), 'ok')
}

// Olay bağlama

function on (node, type, handler, options) {
  if (node) node.addEventListener(type, handler, options || false)
}

function bindEvents () {
  on(el.bootRetry, 'click', () => {
    if (!cryptoReady()) window.location.reload()
    else if (state.token) resumeSession()
    else loadInfo()
  })
  on(el.setupForm, 'submit', submitSetup)
  on(el.inviteCopyLink, 'click', () => {
    copyWithToast(el.inviteLink.value)
  })
  on(el.inviteCopyKey, 'click', () => {
    copyWithToast(el.inviteKey.value)
  })
  on(el.inviteLink, 'focus', () => {
    selectAll(el.inviteLink)
  })
  on(el.inviteKey, 'focus', () => {
    selectAll(el.inviteKey)
  })
  on(el.inviteContinue, 'click', continueFromInvite)
  on(el.authTabLogin, 'click', () => {
    selectAuthTab('login', false)
  })
  on(el.authTabRegister, 'click', () => {
    selectAuthTab('register', false)
  })
  on(el.authTabLogin, 'keydown', onAuthTabKey)
  on(el.authTabRegister, 'keydown', onAuthTabKey)
  on(el.loginForm, 'submit', submitLogin)
  on(el.registerForm, 'submit', submitRegister)
  on(el.keyForm, 'submit', submitKey)
  on(el.keyGenerate, 'click', generateFromKeyScreen)
  on(el.keySkip, 'click', skipKey)
  on(el.keyLogout, 'click', logout)

  on(el.btnOpenChannels, 'click', () => {
    openDrawer('channels', el.btnOpenChannels)
  })
  on(el.btnOpenMembers, 'click', () => {
    openDrawer('members', el.btnOpenMembers)
  })
  on(el.sidebarClose, 'click', closeDrawerFromButton)
  on(el.membersClose, 'click', closeDrawerFromButton)
  on(el.drawerBackdrop, 'click', onBackdropClick)

  on(el.meButton, 'click', () => {
    if (typeof openStatusMenu === 'function') openStatusMenu(el.meButton)
  })
  on(el.authScheme, 'click', toggleScheme)
  on(el.btnMute, 'click', toggleMute)
  on(el.btnDeafen, 'click', toggleDeafen)
  on(el.btnSettings, 'click', () => {
    openSettings(null, el.btnSettings)
  })
  on(el.voiceLeave, 'click', leaveVoice)
  on(el.voiceStripLeave, 'click', leaveVoice)
  on(el.voiceUnlock, 'click', () => {
    if (voice) voice.unlockAudio()
  })
  bindPttButton()
  on(el.peerVolume, 'input', onPeerVolumeInput)
  on(el.peerVolume, 'change', onPeerVolumeInput)
  on(el.peerMute, 'click', onPeerMuteClick)

  on(el.loadOlder, 'click', loadOlder)
  on(el.messages, 'scroll', onMessagesScroll)
  on(el.messagesRetry, 'click', loadChannel)
  on(el.msgMenu, 'keydown', onMenuKey)
  on(el.msgMenuEdit, 'click', () => {
    if (state.menuMessageId !== null) startEdit(state.menuMessageId)
  })
  on(el.msgMenuDelete, 'click', () => {
    if (state.menuMessageId !== null) confirmDelete(state.menuMessageId)
  })

  on(el.composerForm, 'submit', (e) => {
    e.preventDefault()
    sendMessage()
  })
  on(el.composerInput, 'input', onComposerInput)
  on(el.composerInput, 'keydown', onComposerKeydown)
  on(el.composerInput, 'paste', onPaste)
  on(el.composerHintAction, 'click', () => {
    if (activeKid() || isAdmin()) openSettings('privacy', el.composerHintAction)
  })
  on(el.btnPhoto, 'click', () => {
    el.filePhoto.value = ''
    el.filePhoto.click()
  })
  on(el.btnFile, 'click', () => {
    el.fileAny.value = ''
    el.fileAny.click()
  })
  on(el.filePhoto, 'change', () => {
    addFiles(el.filePhoto.files, 'photo')
    el.filePhoto.value = ''
    focusNode(el.composerInput)
  })
  on(el.fileAny, 'change', () => {
    addFiles(el.fileAny.files, 'file')
    el.fileAny.value = ''
    focusNode(el.composerInput)
  })
  on(el.btnEmoji, 'click', openEmojiPicker)
  on(el.emojiGrid, 'click', onEmojiGridClick)
  on(el.emojiGrid, 'keydown', onEmojiGridKey)
  on(el.emojiTabs, 'keydown', onEmojiTabsKey)
  on(el.main, 'dragenter', onDragEnter)
  on(el.main, 'dragover', onDragOver)
  on(el.main, 'dragleave', onDragLeave)
  on(el.main, 'drop', onDrop)

  on(el.viewerClose, 'click', () => {
    const layer = findLayer('viewer')
    if (layer) closeLayer(layer, true)
  })
  on(el.viewerDownload, 'click', downloadFromViewer)
  on(el.viewerStage, 'click', (e) => {
    if (e.target === el.viewerStage) {
      const layer = findLayer('viewer')
      if (layer) closeLayer(layer, true)
    }
  })

  // Ayarlar görünümünün olayları 11-settings.js içinde bağlanır
  bindSettingsEvents()

  on(el.authLang, 'click', (e) => {
    const target = e.target && e.target.closest ? e.target.closest('[data-lang]') : null
    if (target) changeLanguage(target.getAttribute('data-lang'))
  })
  on(document, 'keydown', onLayerKeydown)
  on(document, 'mousedown', onLayerPointerDown, true)
  on(document, 'touchstart', onLayerPointerDown, { capture: true, passive: true })
  on(document, 'focusin', onLayerFocusIn)
  on(document, 'visibilitychange', onVisibilityChange)
  on(window, 'resize', onResize)
  on(window, 'online', () => {
    if (state.inApp && state.connLost) startPoll()
  })
  on(window, 'beforeinstallprompt', onBeforeInstallPrompt)
  on(window, 'appinstalled', onAppInstalled)
  // Pencereye bırakılan dosyalar tarayıcıda açılmasın
  on(window, 'dragover', (e) => {
    if (hasDraggedFiles(e)) e.preventDefault()
  })
  on(window, 'drop', (e) => {
    if (hasDraggedFiles(e)) e.preventDefault()
  })
}

function closeDrawerFromButton () {
  const layer = findLayer('drawer-channels') || findLayer('drawer-members')
  if (layer) closeLayer(layer, true)
}

// Dil (Ek E1): giriş ekranlarındaki TR | EN düğmesi ve Ayarlar > Görünüm'deki dil seçimi.
// Dil değişince sayfa yenilenmeden statik metinler (data-i18n*) ve görünür dinamik metinler
// yeniden üretilir.

function renderLangSwitch () {
  const lang = window.I18N.lang
  Array.from(document.querySelectorAll('[data-lang]')).forEach((node) => {
    node.setAttribute('aria-pressed', node.getAttribute('data-lang') === lang ? 'true' : 'false')
  })
  const settingsLang = byId('set-lang')
  if (settingsLang) settingsLang.value = lang
  renderSchemeToggle()
}

function changeLanguage (code) {
  const before = window.I18N.lang
  window.I18N.setLang(code)
  if (window.I18N.lang !== before) applyLanguage()
  else renderLangSwitch()
}

function applyLanguage () {
  window.I18N.apply(document)
  refreshLiveTexts()
  renderLangSwitch()
  updateTitle()
  if (!state.inApp) return
  renderServerName()
  renderChannels()
  renderMembers()
  renderChannelHeader()
  renderComposerState()
  renderVoiceAll()
  refreshAllMessages()
  renderAttachments()
  updateCounter()
  refreshEmojiLanguage()
  if (findLayer('peer')) renderPeerMute()
  settingsOnLanguage()
}

function start () {
  cacheElements()
  window.I18N.apply(document)
  renderLangSwitch()
  applyThemeMeta()
  const theme = themeApi()
  if (theme && typeof theme.onChange === 'function') theme.onChange(onThemeChange)
  bindEvents()
  observeMessagesSize()
  onResize()
  registerServiceWorker()
  if (!cryptoReady()) {
    showBoot(() => t('boot.noCrypto'), true)
    setLive(el.bootRetry, () => t('boot.reload'))
    return
  }
  createVoice()
  readFragment()
  loadInfo()
}

// defer betikler sırayla çalışır, 13..16 numaralı modüller bu dosyadan sonra yüklenir. start bu yüzden
// DOMContentLoaded olayında (tüm defer betikler çalıştıktan sonra) çağrılır.
if (document.readyState === 'complete') {
  start()
} else {
  document.addEventListener('DOMContentLoaded', start)
}
