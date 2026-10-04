'use strict'

// Sayfalar (yan ve alt sayfa), pencere boyutu, ayarlar kısayolu, PWA, dil değişimi, olay bağlama ve
// uygulamanın başlatılması.

// Sayfalar (Ek K, KONSEPT 6.7 ve 11): Frekanslar (#frekans-sheet, bandın Tümü düğmesi), İstasyonlar
// (#stations-sheet, yazı ve ses odaları, sağ sütun görünmediğinde üst çubuktaki İstasyonlar düğmesi),
// Yayındakiler (#people-sheet) ve 1280 px altında Oda bilgisi (#info-col, geniş ekranda sol sütun olarak her
// zaman görünür). Geniş ekranda sağdan
// açılan yan sayfa, telefonda alttan açılan sayfadır (biçim frekans.css içinde). Aynı anda tek sayfa açıktır,
// ortak örtü #drawer-backdrop'tur. Sayfa katman yığınına 'sheet-<ad>' adıyla girer: açılınca odak sayfadaki
// ilk anlamlı öğeye gider, odak sayfanın içinde kalır, Esc, örtüye tıklama, Kapat düğmesi ve tarayıcının
// geri düğmesi (dar ekranda) kapatır, odak açan düğmeye döner.

const SHEETS = {
  frekans: { id: 'frekans-sheet', trigger: 'band-all' },
  stations: { id: 'stations-sheet', trigger: 'btn-rooms' },
  people: { id: 'people-sheet', trigger: 'live-chip' },
  info: { id: 'info-col', trigger: 'btn-room-info' }
}

const sheetState = {
  history: false,
  switching: false
}

// 1280 px ve üstünde oda bilgisi sol sütundadır, sayfa olarak açılmaz. Telsiz DJ sütunu görünürken de
// sol sütun yerinde kalır (telsiz kartı oradadır), DJ kartı sağ sütundaki İstasyonlar listesinin yerini alır.
function isInfoInline () {
  return window.innerWidth >= 1280
}

// Telsiz kartı (#radio) geniş ekranda (1280 px ve üstü) sol sütunda, ayarlı istasyon kartının hemen
// üstündedir (#radio-slot). Daha dar ekranda sol sütun yan sayfaya dönüştüğü için kart sağ sütuna
// (telefonda ekranın altına) taşınır. Taşırken kartın içindeki odak korunur.
function placeRadio () {
  const radio = el.radio
  const slot = byId('radio-slot')
  if (!radio || !slot || !el.sideRight) return
  const parent = window.innerWidth >= 1280 ? slot : el.sideRight
  if (radio.parentNode === parent) return
  const active = document.activeElement
  const focused = active && radio.contains(active) ? active : null
  parent.appendChild(radio)
  if (focused) focusNode(focused)
}

function sheetLayer (name) {
  return findLayer('sheet-' + name)
}

function openSheetLayer () {
  return layers.filter((layer) => typeof layer.name === 'string' && layer.name.indexOf('sheet-') === 0)[0] || null
}

function isSheetOpen (name) {
  return Boolean(name ? sheetLayer(name) : openSheetLayer())
}

function sheetInitialFocus (name, panel) {
  if (name === 'stations' || name === 'frekans') {
    const current = panel.querySelector('.room-row[aria-current], .sheet-row[aria-current]')
    if (current) return current
  }
  const items = focusables(panel).filter((node) => !node.hasAttribute('data-sheet-close'))
  return items[0] || panel.querySelector('[data-sheet-close]')
}

// Sayfayı açar. Aynı sayfa açıksa kapatır (düğme açma ve kapama işini birlikte görür).
function openSheet (name, trigger) {
  const conf = SHEETS[name]
  const panel = conf ? byId(conf.id) : null
  if (!panel || !state.inApp) return
  const existing = sheetLayer(name)
  if (existing) {
    closeLayer(existing, true)
    return
  }
  if (name === 'info' && isInfoInline()) {
    focusNode(focusables(panel)[0] || panel)
    return
  }
  const opener = trigger || byId(conf.trigger)
  const other = openSheetLayer()
  if (other) {
    sheetState.switching = true
    closeLayer(other, false)
    sheetState.switching = false
  }
  if (name === 'stations' || name === 'frekans') renderBand()
  if (name === 'people') renderMembers()
  panel.hidden = false
  panel.classList.add('is-open')
  if (name === 'info') {
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'true')
  }
  el.appView.classList.add('has-sheet')
  el.drawerBackdrop.hidden = false
  if (opener) opener.setAttribute('aria-expanded', 'true')
  if (isNarrow() && !sheetState.history) pushSheetHistory()
  openLayer({
    name: 'sheet-' + name,
    el: panel,
    trigger: opener,
    level: 1,
    trap: true,
    initialFocus: () => sheetInitialFocus(name, panel),
    onClose: () => {
      panel.classList.remove('is-open')
      if (name === 'info') {
        panel.removeAttribute('role')
        panel.removeAttribute('aria-modal')
      } else {
        panel.hidden = true
      }
      if (opener) opener.setAttribute('aria-expanded', 'false')
      if (!openSheetLayer()) {
        el.appView.classList.remove('has-sheet')
        el.drawerBackdrop.hidden = true
        if (!sheetState.switching) popSheetHistory()
      }
    }
  })
}

function closeSheets () {
  Object.keys(SHEETS).forEach((name) => {
    const layer = sheetLayer(name)
    if (layer) closeLayer(layer, false)
  })
  if (el.drawerBackdrop) el.drawerBackdrop.hidden = true
}

// Eski ad: diğer modüller (oda seçimi, özel mesaj, ses, ayarlar) gezinmeden önce açık sayfayı bununla kapatır
function closeDrawers () {
  closeSheets()
}

function closeTopSheet (restoreFocus) {
  const layer = openSheetLayer()
  if (layer) closeLayer(layer, restoreFocus !== false)
}

function onBackdropClick () {
  closeTopSheet(true)
}

function onSheetCloseClick (e) {
  const btn = e.target && e.target.closest ? e.target.closest('[data-sheet-close]') : null
  if (btn) closeTopSheet(true)
}

// Dar ekranda tarayıcının (ve telefonun) geri düğmesi açık sayfayı kapatır. Sayfa açılınca geçmişe bir
// kayıt eklenir, sayfa başka yoldan kapanınca bu kayıt geri alınır.
function pushSheetHistory () {
  try {
    if (!window.history || typeof window.history.pushState !== 'function') return
    window.history.pushState({ telsizSheet: true }, '')
    sheetState.history = true
  } catch (err) {
    sheetState.history = false
  }
}

function popSheetHistory () {
  if (!sheetState.history) return
  sheetState.history = false
  try {
    window.history.back()
  } catch (err) {
    // Geçmiş kullanılamıyor
  }
}

function onPopState () {
  if (!sheetState.history) return
  sheetState.history = false
  closeTopSheet(true)
}

// Pencere boyutu: geniş (1280 ve üstü), geniş dar (1000 ile 1279), orta (760 ile 999), dar (760 altı) ve
// televizyon (1800 ve üstü). Düzen sınıfı değişince açık sayfa ve açılır katmanlar kapanır.
let lastLayoutClass = ''

function layoutClass () {
  const w = window.innerWidth
  if (w >= 1800) return 'tv'
  if (w >= 1280) return 'wide'
  if (w >= 1000) return 'wide-narrow'
  if (w >= 760) return 'medium'
  return 'narrow'
}

function onResize () {
  autoGrow(el.composerInput, 6)
  keepBottom()
  const cls = layoutClass()
  if (cls === lastLayoutClass) return
  lastLayoutClass = cls
  if (el.appView) el.appView.setAttribute('data-layout', cls)
  placeRadio()
  if (state.inApp) renderChannelHeader()
  closeSheets()
  const picker = findLayer('emoji')
  if (picker) closeLayer(picker, false)
  closeMessageMenu()
  const peer = findLayer('peer')
  if (peer) closeLayer(peer, false)
}

// Ayarlar kısayolu Ctrl , (Mac'te Cmd ,). Bas konuş veya başka bir ses tuşu virgüle atanmışsa o öncelikli
// olur ve kısayol çalışmaz (Ek K7.4).
function commaBound () {
  if (!voice || typeof voice.settings !== 'function') return false
  try {
    const bindings = voice.settings().bindings || {}
    return Object.keys(bindings).some((name) => {
      const b = bindings[name]
      return Boolean(b && b.type === 'key' && b.code === 'Comma')
    })
  } catch (err) {
    return false
  }
}

function onSettingsShortcut (e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
  if (e.key !== ',' && e.code !== 'Comma') return
  if (!state.inApp || !el.appView || el.appView.hidden || e.repeat) return
  if (findLayer('app-dialog') || findLayer('viewer')) return
  if (commaBound()) return
  e.preventDefault()
  if (typeof isSettingsOpen === 'function' && isSettingsOpen()) return
  openSettings(null, el.meButton)
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

  // Frekans düzeni: bant (21-band.js), sayfalar, üst çubuk ve oda bilgisi kartı
  if (typeof bandInit === 'function') bandInit()
  on(el.bandAll, 'click', () => {
    openSheet('frekans', el.bandAll)
  })
  on(byId('btn-rooms'), 'click', () => {
    openSheet('stations', byId('btn-rooms'))
  })
  on(el.liveChip, 'click', () => {
    openSheet('people', el.liveChip)
  })
  on(el.btnRoomInfo, 'click', () => {
    openSheet('info', el.btnRoomInfo)
  })
  // Bandın + düğmesi Frekans ekle, oda ekleme İstasyonlar başlığındadır (yalnızca sahip ve yönetici)
  on(el.bandAdd, 'click', () => {
    if (typeof frekansAdd === 'function') frekansAdd(el.bandAdd)
  })
  on(byId('inbox-add'), 'click', () => {
    openSettings('channels', byId('inbox-add'))
  })
  on(byId('rooms-sheet-add'), 'click', () => {
    openSettings('channels', byId('rooms-sheet-add'))
  })
  on(el.roomCardKeys, 'click', () => {
    openSettings('privacy', el.roomCardKeys)
  })
  on(el.roomCardManage, 'click', () => {
    openSettings('channels', el.roomCardManage)
  })
  on(el.drawerBackdrop, 'click', onBackdropClick)
  on(el.stationsSheet, 'click', onSheetCloseClick)
  on(byId('frekans-sheet'), 'click', onSheetCloseClick)
  on(el.peopleSheet, 'click', onSheetCloseClick)
  on(el.infoCol, 'click', onSheetCloseClick)
  on(window, 'popstate', onPopState)
  on(document, 'keydown', onSettingsShortcut)

  on(el.meButton, 'click', () => {
    if (typeof openStatusMenu === 'function') openStatusMenu(el.meButton)
  })
  // Üst çubuk: frekans değiştirici (24-frekans.js) ve ortadaki kişisel düğmeler (Özel mesajlar, Arkadaşlar)
  if (typeof frekansInit === 'function') frekansInit()
  on(byId('top-dm'), 'click', () => {
    bandTune('dm')
  })
  on(byId('top-friends'), 'click', () => {
    bandTune('friends')
  })
  on(el.authScheme, 'click', toggleScheme)
  on(el.btnMute, 'click', toggleMute)
  on(el.btnDeafen, 'click', toggleDeafen)
  on(el.voiceLeave, 'click', leaveVoice)
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
  renderBand()
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
  // Masaüstünün arka plan penceresi (25-arka-plan.js): yalnızca sayım, arayüz ve ses başlatılmaz
  if (typeof bgModeActive === 'function' && bgModeActive()) {
    bgStart()
    return
  }
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

// defer betikler sırayla çalışır, 13..21 numaralı modüller bu dosyadan sonra yüklenir. start bu yüzden
// DOMContentLoaded olayında (tüm defer betikler çalıştıktan sonra) çağrılır.
if (document.readyState === 'complete') {
  start()
} else {
  document.addEventListener('DOMContentLoaded', start)
}
