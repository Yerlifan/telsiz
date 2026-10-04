'use strict'

// Ayarlar görünümü: tam ekran, solda kategori listesi, sağda seçilen kategorinin içeriği. Dar ekranda
// önce kategori listesi görünür, seçilince içerik ve Geri düğmesi gelir. Esc ve Kapat görünümü kapatır,
// odak açan düğmeye döner. Değişiklikler anında uygulanır, form gerektirenlerde Kaydet düğmesi vardır.
// Cihaz ayarları bu cihazda ('telsiz.' önekli anahtarlar), hesap ve profil sunucuda saklanır.
// Metinler çizim anında t() ile üretilir, dil değişince görünüm yeniden çizilir.

const SETTINGS_USER_CATS = ['account', 'profile', 'privacy', 'voice', 'keybinds', 'notifications', 'appearance', 'app']
const SETTINGS_SERVER_CATS = ['general', 'channels', 'members', 'roles', 'invite']
// Eski sekme adları ve kısa adlar da kabul edilir
const SETTINGS_ALIASES = {
  crypto: 'privacy',
  security: 'privacy',
  encryption: 'privacy',
  server: 'general',
  theme: 'appearance',
  bindings: 'keybinds',
  notify: 'notifications',
  install: 'app'
}
const SETTINGS_ICONS = {
  account: 'i-user',
  profile: 'i-smile',
  privacy: 'i-shield',
  voice: 'i-mic',
  keybinds: 'i-keyboard',
  notifications: 'i-bell',
  appearance: 'i-palette',
  app: 'i-download',
  general: 'i-server',
  channels: 'i-text',
  members: 'i-users',
  roles: 'i-crown',
  invite: 'i-user-plus'
}
// Ayarlar görünümünün yazdığı cihaz anahtarları. Yazıyor göstergesi ve bildirim kodu bunları
// storeGet ile doğrudan okur: telsiz.typing ('0' kapalı), telsiz.notifyLevel ('all', 'mentions'
// varsayılan, 'none'), telsiz.messageSound ('0' kapalı). Ekran paylaşımı kalitesi
// telsiz.screenQuality içinde JSON olarak ({ hint: 'motion' | 'detail', preset: '720p15' | '720p30' |
// '1080p15' | '1080p30' }), YouTube oynatıcısı izni telsiz.djYoutubeConsent içinde ('1' verildi,
// başka her değer veya anahtarın olmaması verilmedi) saklanır.
const SETTINGS_KEYS = {
  typing: 'telsiz.typing',
  notifyLevel: 'telsiz.notifyLevel',
  messageSound: 'telsiz.messageSound',
  screenQuality: 'telsiz.screenQuality',
  youtubeConsent: 'telsiz.djYoutubeConsent'
}
const NOTIFY_LEVELS = ['all', 'mentions', 'none']
const SCREEN_HINT_CHOICES = ['motion', 'detail']
const SCREEN_PRESET_CHOICES = ['720p15', '720p30', '1080p15', '1080p30']
const SCREEN_DEFAULT = { hint: 'detail', preset: '720p15' }
// Telsiz DJ sunucu ayarları (meta.music): POST /api/settings { music } (yalnızca sahip, Ek L2.10).
// false olursa anahtarlar devre dışı kalır.
const MUSIC_SETTINGS_READY = true
const BIND_ACTIONS = ['ptt', 'toggleMute', 'toggleDeafen']
const SKIN_CHOICES = ['arcade', 'gece', 'turkuaz']
const SCHEME_CHOICES = ['dark', 'light', 'system']
const FONT_SIZE_CHOICES = ['auto', 'small', 'normal', 'large', 'tv', 'custom']
// Elle ayarlanan yazı boyutunun sınırları (theme-init.js ile aynı) ve varsayılanı, piksel
const FONT_PX_RANGE = { min: 12, max: 28, initial: 15 }
const MOTION_CHOICES = ['system', 'on', 'off']
const AVATAR_SOURCE_MAX = 20 * 1024 * 1024
const AVATAR_PENDING_MS = 20000
const SETTINGS_WATCH_MS = 500
const LEVEL_FRAME_MS = 50
const ADMIN_REFRESH_MS = 2000
const REPO_URL = 'https://github.com/Yerlifan/telsiz'
const LICENSE_LINKS = [
  { key: 'settings.app.licenseNacl', href: '/vendor/TWEETNACL-LICENSE.txt' },
  { key: 'settings.app.licenseScrypt', href: '/vendor/SCRYPT-JS-LICENSE.txt' }
]

const settingsUi = {
  root: null,
  cat: 'account',
  // Dar ekranda 'list' (kategori listesi) veya 'page' (içerik)
  pane: 'page',
  narrow: false,
  admin: false,
  page: null,
  watchTimer: 0,
  eventsBound: false,
  capture: null,
  micTest: false,
  levelFrame: 0,
  levelAt: 0,
  sessions: null,
  sessionsGen: 0,
  draft: null,
  temp: null,
  newInvite: '',
  inviteVisible: false,
  keyVisible: false,
  membersFilter: '',
  metaUserKey: '',
  adminRefreshAt: 0
}

const SETTINGS_PAGES = {
  account: buildAccountPage,
  profile: buildProfilePage,
  privacy: buildPrivacyPage,
  voice: buildVoicePage,
  keybinds: buildKeybindsPage,
  notifications: buildNotificationsPage,
  appearance: buildAppearancePage,
  app: buildAppPage,
  general: buildGeneralPage,
  channels: buildChannelsPage,
  members: buildMembersPage,
  roles: buildRolesPage,
  invite: buildInvitePage
}

// Kategori adları

function settingsCatName (name) {
  if (typeof name !== 'string' || !name) return null
  const key = Object.prototype.hasOwnProperty.call(SETTINGS_ALIASES, name) ? SETTINGS_ALIASES[name] : name
  return SETTINGS_USER_CATS.indexOf(key) !== -1 || SETTINGS_SERVER_CATS.indexOf(key) !== -1 ? key : null
}

// Frekans kategorileri izne göre: Odalar oda yönetme izniyle, Üyeler engelleme izniyle (yöneticiler her
// zaman), Roller yalnızca sahibe, Genel ve Davet sahip ile yöneticilere görünür
function serverCatAllowed (cat) {
  if (cat === 'channels') return hasPerm('channels')
  if (cat === 'members') return isAdmin() || hasPerm('ban')
  if (cat === 'roles') return isOwner()
  return isAdmin()
}

function serverCats () {
  return SETTINGS_SERVER_CATS.filter(serverCatAllowed)
}

function settingsCats () {
  return SETTINGS_USER_CATS.concat(serverCats())
}

function allowedSettingsCat (name) {
  return settingsCats().indexOf(name) !== -1 ? name : 'account'
}

function settingsRoot () {
  if (!settingsUi.root || !isConnected(settingsUi.root)) settingsUi.root = byId('settings-view')
  return settingsUi.root
}

function catButton (cat) {
  return byId('settings-cat-' + cat)
}

function isSettingsOpen () {
  return Boolean(findLayer('settings'))
}

// Ayarlar açık ve verilen kategorinin içeriği gösteriliyor mu (eski sekme adları da kabul edilir)
function isSettingsTab (name) {
  const cat = settingsCatName(name)
  return Boolean(isSettingsOpen() && settingsUi.page && cat && settingsUi.page.cat === cat)
}

// Açma ve kapatma. Kategori verilirse doğrudan o sayfa açılır (ör. openSettings('profile')).
// Verilmezse geniş ekranda Hesabım, dar ekranda kategori listesi gösterilir.
function openSettings (name, trigger) {
  if (!state.inApp || !state.me) return
  const wanted = settingsCatName(name)
  if (isSettingsOpen()) {
    if (wanted) showSettingsCat(wanted, 'title')
    return
  }
  const root = settingsRoot()
  if (!root) return
  closeDrawers()
  bindSettingsEvents()
  settingsUi.narrow = isNarrow()
  settingsUi.admin = serverCats().join(',')
  settingsUi.cat = allowedSettingsCat(wanted || 'account')
  settingsUi.pane = settingsUi.narrow && !wanted ? 'list' : 'page'
  settingsUi.inviteVisible = false
  settingsUi.keyVisible = false
  settingsUi.temp = null
  settingsUi.newInvite = ''
  settingsUi.membersFilter = ''
  settingsUi.metaUserKey = metaUserKey()
  buildSettingsView()
  root.hidden = false
  document.body.classList.add('modal-open')
  openLayer({
    name: 'settings',
    el: root,
    trigger: trigger || el.meButton,
    level: 1,
    trap: true,
    initialFocus: () => settingsFocusTarget(wanted ? 'title' : 'nav'),
    onClose: onSettingsClosed
  })
  // Sayfa katman kurulmadan önce çizildi, isSettingsTab'e bağlı bölümler (ses, tuş atamaları) şimdi doldurulur
  updateSettingsPage()
  startSettingsWatch()
  if (settingsUi.admin) refreshAdminState(true)
}

function closeSettings (restoreFocus) {
  const layer = findLayer('settings')
  if (layer) closeLayer(layer, restoreFocus !== false)
}

function onSettingsClosed () {
  leaveSettingsPage()
  stopSettingsWatch()
  const root = settingsRoot()
  if (root) {
    root.hidden = true
    clear(root)
  }
  settingsUi.page = null
  settingsUi.temp = null
  settingsUi.newInvite = ''
  settingsUi.sessions = null
  document.body.classList.remove('modal-open')
}

function settingsFocusTarget (kind) {
  if (settingsUi.pane === 'list' || (kind === 'nav' && !settingsUi.narrow)) {
    return catButton(settingsUi.cat) || byId('settings-nav')
  }
  return byId('settings-page-title')
}

// Görünümün iskeleti: kategori listesi ve içerik alanı

function buildSettingsView () {
  const root = settingsRoot()
  clear(root)
  const shell = h('div', 'settings-shell')
  shell.appendChild(buildSettingsSide())
  shell.appendChild(buildSettingsMain())
  root.appendChild(shell)
  applySettingsPane()
  if (settingsUi.pane === 'page') renderSettingsPage()
  else markSettingsCat()
}

function buildSettingsSide () {
  const side = h('div', 'settings-side')
  side.id = 'settings-side'
  const head = h('div', 'settings-side-head')
  const title = h('h2', 'settings-side-title', t('settings.title'))
  title.id = 'settings-view-title'
  head.appendChild(title)
  const closeList = button('icon-button settings-x settings-close-list', '', 'i-close', t('settings.closeTitle'))
  closeList.id = 'settings-close-list'
  closeList.addEventListener('click', () => {
    closeSettings(true)
  })
  head.appendChild(closeList)
  side.appendChild(head)
  const nav = h('nav', 'settings-catnav')
  nav.id = 'settings-nav'
  nav.setAttribute('aria-label', t('settings.navLabel'))
  appendCatGroup(nav, 'user', t('settings.group.user'), SETTINGS_USER_CATS)
  const server = serverCats()
  if (server.length) appendCatGroup(nav, 'server', t('settings.group.server'), server)
  nav.addEventListener('keydown', onSettingsNavKey)
  side.appendChild(nav)
  const version = state.info && typeof state.info.version === 'string' ? state.info.version : ''
  if (version) side.appendChild(h('p', 'settings-side-version', t('settings.app.versionLine', { version: version })))
  return side
}

function appendCatGroup (nav, key, label, cats) {
  const group = h('div', 'settings-cat-group')
  const titleId = 'settings-group-' + key
  const heading = h('h3', 'settings-group-title', label)
  heading.id = titleId
  group.appendChild(heading)
  const list = h('ul', 'settings-cats')
  list.setAttribute('aria-labelledby', titleId)
  cats.forEach((cat) => {
    const li = h('li', 'settings-cat-item')
    const b = h('button', 'settings-cat')
    b.type = 'button'
    b.id = 'settings-cat-' + cat
    b.setAttribute('data-cat', cat)
    b.appendChild(icon(SETTINGS_ICONS[cat], 'settings-cat-icon'))
    b.appendChild(h('span', 'settings-cat-label', t('settings.cat.' + cat)))
    b.addEventListener('click', () => {
      showSettingsCat(cat, settingsUi.narrow ? 'title' : null)
    })
    li.appendChild(b)
    list.appendChild(li)
  })
  group.appendChild(list)
  nav.appendChild(group)
}

function buildSettingsMain () {
  const main = h('div', 'settings-main')
  main.id = 'settings-main'
  const inner = h('div', 'settings-main-inner')
  const head = h('header', 'settings-page-head')
  const back = button('button button-ghost settings-back', t('settings.back'), 'i-back')
  back.id = 'settings-back'
  back.setAttribute('aria-label', t('settings.backLabel'))
  back.addEventListener('click', settingsBackToList)
  head.appendChild(back)
  const title = h('h2', 'settings-page-title')
  title.id = 'settings-page-title'
  title.tabIndex = -1
  head.appendChild(title)
  const close = button('icon-button settings-x', '', 'i-close', t('settings.closeTitle'))
  close.id = 'settings-close'
  close.addEventListener('click', () => {
    closeSettings(true)
  })
  head.appendChild(close)
  inner.appendChild(head)
  const page = h('section', 'settings-page')
  page.id = 'settings-page'
  page.setAttribute('aria-labelledby', 'settings-page-title')
  inner.appendChild(page)
  main.appendChild(inner)
  return main
}

function applySettingsPane () {
  const root = settingsRoot()
  if (!root) return
  root.setAttribute('data-pane', settingsUi.pane)
  root.classList.toggle('is-narrow', settingsUi.narrow)
  const back = byId('settings-back')
  if (back) back.hidden = !settingsUi.narrow
  const closeList = byId('settings-close-list')
  if (closeList) closeList.hidden = !settingsUi.narrow
}

function markSettingsCat () {
  const root = settingsRoot()
  if (!root) return
  Array.from(root.querySelectorAll('.settings-cat')).forEach((b) => {
    const current = b.getAttribute('data-cat') === settingsUi.cat
    if (current) b.setAttribute('aria-current', 'page')
    else b.removeAttribute('aria-current')
    b.classList.toggle('is-active', current)
  })
}

function showSettingsCat (name, focusKind) {
  if (!isSettingsOpen()) return
  settingsUi.cat = allowedSettingsCat(name)
  settingsUi.pane = 'page'
  applySettingsPane()
  renderSettingsPage()
  if (focusKind === 'title') focusNode(byId('settings-page-title'))
  else if (focusKind === 'nav') focusNode(catButton(settingsUi.cat))
}

// Dar ekranda içerikten kategori listesine dönüş
function settingsBackToList () {
  if (!settingsUi.narrow) return
  leaveSettingsPage()
  const page = byId('settings-page')
  if (page) clear(page)
  settingsUi.pane = 'list'
  applySettingsPane()
  markSettingsCat()
  focusNode(catButton(settingsUi.cat))
}

// Kategori listesinde ok tuşları, Home ve End. Geniş ekranda odaklanan kategori hemen gösterilir.
function onSettingsNavKey (e) {
  const target = e.target && e.target.closest ? e.target.closest('.settings-cat') : null
  if (!target) return
  const buttons = Array.from(settingsRoot().querySelectorAll('.settings-cat'))
  const i = buttons.indexOf(target)
  let next = -1
  if (e.key === 'ArrowDown') next = (i + 1) % buttons.length
  else if (e.key === 'ArrowUp') next = (i - 1 + buttons.length) % buttons.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = buttons.length - 1
  if (next === -1) return
  e.preventDefault()
  const b = buttons[next]
  focusNode(b)
  if (!settingsUi.narrow) showSettingsCat(b.getAttribute('data-cat'), null)
}

function renderSettingsPage () {
  leaveSettingsPage()
  const cat = settingsUi.cat
  markSettingsCat()
  const title = byId('settings-page-title')
  const page = byId('settings-page')
  if (!title || !page) return
  title.textContent = t('settings.cat.' + cat)
  clear(page)
  page.setAttribute('data-cat', cat)
  // Bağlam oluşturucudan önce kurulur, böylece sayfa çizilirken isSettingsTab doğru yanıt verir
  const ctx = { cat: cat, update: null, signature: null, leave: null, sig: '' }
  settingsUi.page = ctx
  let result = null
  try {
    result = SETTINGS_PAGES[cat](page) || {}
  } catch (err) {
    window.console.error(err)
    result = {}
  }
  if (settingsUi.page !== ctx) return
  ctx.update = typeof result.update === 'function' ? result.update : null
  ctx.signature = typeof result.signature === 'function' ? result.signature : null
  ctx.leave = typeof result.leave === 'function' ? result.leave : null
  ctx.sig = pageSignature(ctx)
  const main = byId('settings-main')
  if (main) main.scrollTop = 0
}

function pageSignature (ctx) {
  if (!ctx || typeof ctx.signature !== 'function') return ''
  try {
    return String(ctx.signature())
  } catch (err) {
    return ''
  }
}

// Sayfadan ayrılırken: tuş yakalama, mikrofon testi ve seviye döngüsü durdurulur
function leaveSettingsPage () {
  const page = settingsUi.page
  settingsUi.page = null
  cancelBindingCapture()
  stopLevelLoop()
  if (settingsUi.micTest) stopSettingsMicTest()
  if (page && typeof page.leave === 'function') {
    try {
      page.leave()
    } catch (err) {
      window.console.error(err)
    }
  }
}

function updateSettingsPage () {
  const page = settingsUi.page
  if (!page || typeof page.update !== 'function') return
  try {
    page.update()
  } catch (err) {
    window.console.error(err)
  }
  page.sig = pageSignature(page)
}

// Profil, engellenenler, kimlik ve oturum gibi başka modüllerde değişen veriler için açık sayfanın
// imzası düzenli aralıkla denetlenir, değişince yalnızca sayfanın değişen bölümleri yenilenir.
function startSettingsWatch () {
  stopSettingsWatch()
  settingsUi.watchTimer = setInterval(settingsWatchTick, SETTINGS_WATCH_MS)
}

function stopSettingsWatch () {
  if (settingsUi.watchTimer) clearInterval(settingsUi.watchTimer)
  settingsUi.watchTimer = 0
}

function settingsWatchTick () {
  if (!isSettingsOpen()) {
    stopSettingsWatch()
    return
  }
  const page = settingsUi.page
  if (!page) return
  const sig = pageSignature(page)
  if (sig === page.sig) return
  updateSettingsPage()
}

// Meta değişince (04-meta.js applyMeta): yetkisi kalmayan sunucu kategorileri kapanır, açık sayfa yenilenir
function refreshSettings () {
  if (!isSettingsOpen()) return
  const admin = serverCats().join(',')
  if (admin !== settingsUi.admin) {
    settingsUi.admin = admin
    rebuildSettingsSide()
    if (settingsCats().indexOf(settingsUi.cat) === -1) {
      if (settingsUi.pane === 'page') showSettingsCat('account', 'title')
      else settingsUi.cat = 'account'
      markSettingsCat()
      return
    }
    if (admin) refreshAdminState(true)
  }
  const key = metaUserKey()
  if (key !== settingsUi.metaUserKey) {
    settingsUi.metaUserKey = key
    if (admin) refreshAdminState(false)
  }
  updateSettingsPage()
}

function metaUserKey () {
  const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
  return users.map((u) => String(u && u.id)).sort().join(',')
}

function rebuildSettingsSide () {
  const old = byId('settings-side')
  if (!old || !old.parentNode) return
  const focusCat = document.activeElement && old.contains(document.activeElement) && document.activeElement.getAttribute ? document.activeElement.getAttribute('data-cat') : null
  const side = buildSettingsSide()
  old.parentNode.replaceChild(side, old)
  applySettingsPane()
  markSettingsCat()
  if (focusCat) focusNode(catButton(focusCat) || catButton(settingsUi.cat))
}

// Dil değişince görünüm yeniden çizilir, odak aynı kimlikli öğeye döner
function settingsOnLanguage () {
  // Masaüstü bölümleri (20-desktop.js) kendi metinlerini yeniden üretir, tarayıcıda işlem yapmaz
  if (window.TelsizDesktopUI && typeof window.TelsizDesktopUI.refresh === 'function') {
    try {
      window.TelsizDesktopUI.refresh()
    } catch (err) {
      window.console.error(err)
    }
  }
  if (!isSettingsOpen()) return
  const active = document.activeElement
  const focusId = active && settingsRoot().contains(active) ? active.id : ''
  const scroll = byId('settings-main') ? byId('settings-main').scrollTop : 0
  leaveSettingsPage()
  buildSettingsView()
  const main = byId('settings-main')
  if (main) main.scrollTop = scroll
  const target = focusId ? byId(focusId) : null
  focusNode(target || settingsFocusTarget(settingsUi.pane === 'list' ? 'nav' : 'title'))
}

function onSettingsResize () {
  if (!isSettingsOpen()) return
  const narrow = isNarrow()
  if (narrow === settingsUi.narrow) return
  settingsUi.narrow = narrow
  if (!narrow && settingsUi.pane === 'list') {
    settingsUi.pane = 'page'
    applySettingsPane()
    renderSettingsPage()
    return
  }
  applySettingsPane()
}

// Olaylar: dişli düğmesi, pencere boyutu ve mesaj sesinin ilk etkileşimde hazırlanması
function bindSettingsEvents () {
  if (settingsUi.eventsBound) return
  settingsUi.eventsBound = true
  window.addEventListener('resize', onSettingsResize)
  const unlock = () => {
    document.removeEventListener('pointerdown', unlock, true)
    document.removeEventListener('keydown', unlock, true)
    document.removeEventListener('touchend', unlock, true)
    unlockMessageSound()
  }
  document.addEventListener('pointerdown', unlock, true)
  document.addEventListener('keydown', unlock, true)
  document.addEventListener('touchend', unlock, true)
}

// Sunucu yönetimi için /api/state (davet kodu ve sunucudan engellenenler yalnızca sahip ve yöneticiye)
async function refreshAdminState (force) {
  if (!isAdmin() && !hasPerm('ban')) return
  const now = Date.now()
  if (!force && now - settingsUi.adminRefreshAt < ADMIN_REFRESH_MS) return
  settingsUi.adminRefreshAt = now
  const res = await api('GET', '/api/state')
  if (res.status !== 200 || !res.data) return
  state.inviteCode = typeof res.data.inviteCode === 'string' ? res.data.inviteCode : null
  if (Array.isArray(res.data.bannedUsers)) state.bannedUsers = res.data.bannedUsers
  if (isSettingsOpen()) updateSettingsPage()
}

// Ortak yapı taşları

function sSection (parent, title, id) {
  const section = h('section', 'settings-section')
  section.id = id
  const heading = h('h3', 'settings-section-title', title)
  heading.id = id + '-title'
  section.setAttribute('aria-labelledby', heading.id)
  section.appendChild(heading)
  parent.appendChild(section)
  return section
}

function sSub (parent, text, id) {
  const node = h('h4', 'settings-subtitle', text)
  if (id) node.id = id
  parent.appendChild(node)
  return node
}

function sHint (text, id) {
  const p = h('p', 'hint settings-hint', text)
  if (id) p.id = id
  return p
}

function sMsg (id) {
  const p = h('p', 'form-msg settings-msg')
  p.id = id
  p.setAttribute('role', 'status')
  p.setAttribute('aria-live', 'polite')
  p.hidden = true
  return p
}

function sInput (type, className) {
  const input = h('input', 'input' + (className ? ' ' + className : ''))
  input.type = type
  return input
}

function sField (parent, id, labelText, control, hintText) {
  const label = h('label', 'label', labelText)
  label.setAttribute('for', id)
  control.id = id
  parent.appendChild(label)
  parent.appendChild(control)
  if (hintText) {
    const hint = sHint(hintText, id + '-hint')
    control.setAttribute('aria-describedby', hint.id)
    parent.appendChild(hint)
  }
  return label
}

function sButton (className, text, id, handler, iconName) {
  const b = button(className, text, iconName)
  if (id) b.id = id
  if (handler) b.addEventListener('click', handler)
  return b
}

// Simgeli düğmenin metni (simge korunur)
function setButtonText (b, text) {
  let span = b.querySelector('.button-text')
  if (!span) {
    span = h('span', 'button-text')
    b.appendChild(span)
  }
  span.textContent = text
}

function sActions (parent) {
  const row = h('div', 'settings-actions')
  parent.appendChild(row)
  return row
}

// Açık/kapalı anahtarı: görünür ve odaklanabilir onay kutusu (role=switch), metin solda
function sSwitch (id, labelText, checked, onChange, hintText) {
  const row = h('div', 'settings-switch-row')
  const label = h('label', 'settings-switch-label')
  label.setAttribute('for', id)
  label.appendChild(h('span', 'settings-switch-text', labelText))
  const input = h('input', 'settings-switch')
  input.type = 'checkbox'
  input.id = id
  input.setAttribute('role', 'switch')
  input.checked = Boolean(checked)
  if (hintText) {
    const hint = h('span', 'settings-switch-hint', hintText)
    hint.id = id + '-hint'
    label.appendChild(hint)
    input.setAttribute('aria-describedby', hint.id)
  }
  row.appendChild(label)
  row.appendChild(input)
  input.addEventListener('change', () => {
    onChange(input.checked, input)
  })
  return { row: row, input: input }
}

// Radyo düğmeleri: options [{ value, label, hint }]. Kimlikler name + '-' + value.
function sRadios (name, labelledBy, options, current, onChange, extraClass) {
  const group = h('div', 'settings-radios' + (extraClass ? ' ' + extraClass : ''))
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-labelledby', labelledBy)
  const inputs = {}
  options.forEach((opt) => {
    const id = name + '-' + opt.value
    const label = h('label', 'settings-radio')
    label.setAttribute('for', id)
    label.setAttribute('data-value', opt.value)
    const input = h('input', 'settings-radio-input')
    input.type = 'radio'
    input.name = name
    input.id = id
    input.value = opt.value
    input.checked = opt.value === current
    label.appendChild(input)
    const text = h('span', 'settings-radio-text')
    text.appendChild(h('span', 'settings-radio-label', opt.label))
    if (opt.hint) text.appendChild(h('span', 'settings-radio-hint', opt.hint))
    label.appendChild(text)
    label.classList.toggle('is-selected', input.checked)
    input.addEventListener('change', () => {
      if (!input.checked) return
      Object.keys(inputs).forEach((key) => {
        inputs[key].parentNode.classList.toggle('is-selected', key === opt.value)
      })
      onChange(opt.value)
    })
    group.appendChild(label)
    inputs[opt.value] = input
  })
  return { group: group, inputs: inputs }
}

function setRadioValue (inputs, value) {
  Object.keys(inputs).forEach((key) => {
    const input = inputs[key]
    input.checked = key === value
    if (input.parentNode) input.parentNode.classList.toggle('is-selected', key === value)
  })
}

// Parola yöneticileri için gizli kullanıcı adı alanı
function hiddenUsername (form) {
  const user = h('input', 'sr-only')
  user.type = 'text'
  user.autocomplete = 'username'
  user.value = state.me ? state.me.name : ''
  user.tabIndex = -1
  user.readOnly = true
  user.setAttribute('aria-hidden', 'true')
  form.appendChild(user)
}

function progressNode (id) {
  const p = h('p', 'derive-progress hint')
  p.id = id
  p.setAttribute('role', 'status')
  p.setAttribute('aria-live', 'polite')
  p.hidden = true
  return p
}

function isBusy (form) {
  return Boolean(form && form.classList.contains('is-busy'))
}

function safeCall (fn, fallback) {
  try {
    const value = fn()
    return value === undefined ? fallback : value
  } catch (err) {
    return fallback
  }
}

function defaultColorIndex (userId) {
  const n = Number(avatarClass(userId).slice('avatar-c'.length))
  return isFinite(n) ? n : 0
}

// Kişinin görünen durumu: 'online', 'idle', 'dnd' veya 'offline'
function shownStatusOf (userId) {
  return safeCall(() => shownStatus(userId), 'offline')
}

function chosenStatusLabel () {
  const status = safeCall(() => myChosenStatus(), 'online')
  return safeCall(() => statusLabel(status), '')
}

// Önizleme avatarı (kırpılmış yeni resim veya mevcut profil resmi). Yalnızca blob adresi kabul edilir.
function previewAvatar (size, url, letter, colorIndex, status) {
  const span = h('span', 'avatar has-face avatar-c' + colorIndex + ' avatar-' + size)
  span.setAttribute('aria-hidden', 'true')
  if (status) span.setAttribute('data-status', status)
  const face = h('span', 'avatar-face')
  if (typeof url === 'string' && url.indexOf('blob:') === 0) {
    const img = h('img', 'avatar-img')
    img.alt = ''
    img.src = url
    face.appendChild(img)
  } else {
    face.textContent = letter
  }
  span.appendChild(face)
  return span
}

function statusDotNode (status) {
  const dot = h('span', 'status-dot')
  dot.setAttribute('data-status', status)
  dot.setAttribute('aria-hidden', 'true')
  return dot
}

// Kendi profilimin şu anki görünümü (sunucudan çözülen profil)
function myProfileView () {
  const id = state.me.id
  const profile = safeCall(() => activeProfile(id), null)
  return {
    displayName: profile && profile.displayName ? profile.displayName : '',
    statusText: profile && profile.statusText ? profile.statusText : '',
    bio: profile && profile.bio ? profile.bio : '',
    color: profile && profile.color !== null && profile.color !== undefined ? profile.color : defaultColorIndex(id),
    avatarUrl: safeCall(() => avatarInfoFor(id).blobUrl, null)
  }
}

// Profil önizleme kartı (Hesabım ve Profil sayfaları). view: { displayName, statusText, bio, color, avatarUrl }
function buildPreviewCard (view, id) {
  const me = state.me
  const status = shownStatusOf(me.id)
  const card = h('div', 'settings-preview-card')
  if (id) card.id = id
  card.setAttribute('aria-label', t('settings.profile.previewLabel'))
  card.setAttribute('role', 'group')
  const band = h('div', 'profile-card-band')
  band.setAttribute('data-color', String(view.color))
  card.appendChild(band)
  const head = h('div', 'profile-card-head')
  const av = h('span', 'avatar-wrap profile-card-avatar')
  av.appendChild(previewAvatar('xl', view.avatarUrl, initial(view.displayName || me.name), view.color, status))
  head.appendChild(av)
  card.appendChild(head)
  const body = h('div', 'profile-card-body')
  body.appendChild(h('p', 'profile-card-name settings-preview-name', view.displayName || me.name))
  body.appendChild(h('p', 'profile-card-handle', '@' + me.name))
  const badge = roleBadge(me.role)
  if (badge) body.appendChild(badge)
  const statusRow = h('p', 'profile-card-status')
  statusRow.setAttribute('data-status', status)
  statusRow.appendChild(statusDotNode(status))
  statusRow.appendChild(h('span', 'profile-card-status-label', chosenStatusLabel()))
  if (view.statusText) statusRow.appendChild(h('span', 'profile-card-status-text', view.statusText))
  body.appendChild(statusRow)
  if (view.bio) {
    const section = h('div', 'profile-card-section')
    section.appendChild(h('p', 'profile-card-label', t('profile.about')))
    section.appendChild(h('p', 'profile-card-bio', view.bio))
    body.appendChild(section)
  }
  card.appendChild(body)
  return card
}

function myProfileSignature () {
  if (!state.me) return ''
  const id = state.me.id
  const rec = safeCall(() => profileRecord(id), null)
  return [state.me.name, state.me.role, safeCall(() => myChosenStatus(), ''), rec ? rec.pv : '', rec && rec.profile ? JSON.stringify(rec.profile) : '', safeCall(() => avatarInfoFor(id).blobUrl, '')].join('|')
}

// 1. Hesabım: önizleme kartı, kullanıcı adı, parola, çıkış ve hesabı silme

function buildAccountPage (page) {
  const cardHost = h('div', 'settings-card-host')
  cardHost.id = 'set-account-card'
  page.appendChild(cardHost)

  // Kullanıcı adı (yeni ad ve mevcut parola)
  const nameSec = sSection(page, t('settings.account.usernameTitle'), 'set-username-section')
  const nameRow = h('div', 'settings-kv')
  const nameText = h('div', 'settings-kv-text')
  const nameValue = h('span', 'settings-kv-value')
  nameValue.id = 'set-username-current'
  nameText.appendChild(nameValue)
  nameRow.appendChild(nameText)
  const changeBtn = sButton('button button-secondary', t('settings.account.change'), 'set-username-change')
  changeBtn.setAttribute('aria-expanded', 'false')
  changeBtn.setAttribute('aria-controls', 'set-username-form')
  nameRow.appendChild(changeBtn)
  nameSec.appendChild(nameRow)
  const nameForm = h('form', 'form settings-form')
  nameForm.id = 'set-username-form'
  nameForm.noValidate = true
  nameForm.hidden = true
  nameSec.appendChild(nameForm)
  const newName = sInput('text')
  newName.maxLength = USERNAME_MAX_INPUT
  newName.autocomplete = 'off'
  newName.setAttribute('autocapitalize', 'none')
  newName.setAttribute('spellcheck', 'false')
  sField(nameForm, 'set-username-new', t('settings.account.newUsername'), newName, t('auth.nameHint'))
  const namePass = sInput('password')
  namePass.autocomplete = 'current-password'
  namePass.maxLength = 256
  sField(nameForm, 'set-username-password', t('settings.account.currentPassword'), namePass, null)
  const nameProgress = progressNode('set-username-progress')
  nameForm.appendChild(nameProgress)
  const nameActions = sActions(nameForm)
  const nameSave = sButton('button', t('common.save'), 'set-username-save')
  nameSave.type = 'submit'
  nameActions.appendChild(nameSave)
  const nameCancel = sButton('button button-secondary', t('common.cancel'), 'set-username-cancel')
  nameActions.appendChild(nameCancel)
  const nameMsg = sMsg('set-username-msg')
  nameSec.appendChild(nameMsg)
  const showNameForm = (show) => {
    nameForm.hidden = !show
    changeBtn.setAttribute('aria-expanded', show ? 'true' : 'false')
    if (show) {
      setMsg(nameMsg, '')
      newName.value = state.me ? state.me.name : ''
      focusNode(newName)
      try {
        newName.select()
      } catch (err) {
        // Seçim desteklenmiyor
      }
    } else {
      newName.value = ''
      namePass.value = ''
    }
  }
  changeBtn.addEventListener('click', () => {
    showNameForm(nameForm.hidden)
  })
  nameCancel.addEventListener('click', () => {
    showNameForm(false)
    focusNode(changeBtn)
  })
  newName.addEventListener('input', () => {
    lowercaseInput(newName)
  })
  nameForm.addEventListener('submit', (e) => {
    e.preventDefault()
    submitUsernameChange({ form: nameForm, input: newName, pass: namePass, progress: nameProgress, msg: nameMsg, done: () => {
      showNameForm(false)
      focusNode(changeBtn)
    } })
  })

  // Parola değiştirme
  const passSec = sSection(page, t('settings.account.changePassword'), 'set-password-section')
  const passForm = h('form', 'form settings-form')
  passForm.id = 'set-password-form'
  passForm.noValidate = true
  passSec.appendChild(passForm)
  hiddenUsername(passForm)
  const oldPass = sInput('password')
  oldPass.autocomplete = 'current-password'
  oldPass.maxLength = 256
  sField(passForm, 'set-old-password', t('settings.account.oldPassword'), oldPass, null)
  const newPass = sInput('password')
  newPass.autocomplete = 'new-password'
  newPass.maxLength = 256
  const limits = passwordLimits()
  sField(passForm, 'set-new-password', t('settings.account.newPassword'), newPass, t('settings.account.passwordRule', { min: limits.min, max: limits.max }))
  const newPass2 = sInput('password')
  newPass2.autocomplete = 'new-password'
  newPass2.maxLength = 256
  sField(passForm, 'set-new-password2', t('settings.account.newPassword2'), newPass2, null)
  const passProgress = progressNode('set-password-progress')
  passForm.appendChild(passProgress)
  const passMsg = sMsg('set-password-msg')
  passForm.appendChild(passMsg)
  const passActions = sActions(passForm)
  const passSubmit = sButton('button', t('settings.account.passwordSubmit'), 'set-password-submit')
  passSubmit.type = 'submit'
  passActions.appendChild(passSubmit)
  passSec.appendChild(sHint(t('settings.account.passwordNote'), 'set-password-note'))
  const strength = buildStrengthMeter(newPass, 'set-new-password-strength')
  newPass.addEventListener('input', () => {
    updateStrengthMeter(strength, newPass.value)
  })
  passForm.addEventListener('submit', (e) => {
    e.preventDefault()
    submitPasswordChange({ form: passForm, oldPass: oldPass, newPass: newPass, newPass2: newPass2, progress: passProgress, msg: passMsg, strength: strength })
  })

  // Oturum
  const sessSec = sSection(page, t('settings.account.session'), 'set-session-section')
  sessSec.appendChild(sHint(t('settings.account.logoutHint')))
  const logoutRow = sActions(sessSec)
  logoutRow.appendChild(sButton('button button-secondary', t('auth.logout'), 'set-logout', () => {
    logout()
  }, 'i-logout'))

  // Tehlikeli bölge: hesabı silme (sahipte kapalı)
  const dangerSec = sSection(page, t('settings.account.dangerTitle'), 'set-danger-section')
  dangerSec.classList.add('settings-danger')
  dangerSec.appendChild(h('p', 'settings-text', t('settings.account.deleteLead')))
  const ownerNote = h('p', 'settings-note', t('settings.account.ownerCannotDelete'))
  ownerNote.id = 'set-delete-owner-note'
  dangerSec.appendChild(ownerNote)
  const delForm = h('form', 'form settings-form')
  delForm.id = 'set-delete-form'
  delForm.noValidate = true
  dangerSec.appendChild(delForm)
  hiddenUsername(delForm)
  const delPass = sInput('password')
  delPass.autocomplete = 'current-password'
  delPass.maxLength = 256
  sField(delForm, 'set-delete-password', t('settings.account.deletePassword'), delPass, null)
  const delProgress = progressNode('set-delete-progress')
  delForm.appendChild(delProgress)
  const delMsg = sMsg('set-delete-msg')
  delForm.appendChild(delMsg)
  const delActions = sActions(delForm)
  const delSubmit = sButton('button button-danger', t('settings.account.deleteSubmit'), 'set-delete-submit', null, 'i-trash')
  delSubmit.type = 'submit'
  delActions.appendChild(delSubmit)
  delForm.addEventListener('submit', (e) => {
    e.preventDefault()
    submitAccountDelete({ form: delForm, pass: delPass, progress: delProgress, msg: delMsg })
  })

  const update = () => {
    if (!state.me) return
    clear(cardHost)
    cardHost.appendChild(buildPreviewCard(myProfileView(), 'set-account-preview'))
    const edit = sButton('button button-secondary settings-card-action', t('profile.edit'), 'set-account-edit-profile', () => {
      showSettingsCat('profile', 'title')
    }, 'i-edit')
    cardHost.appendChild(edit)
    nameValue.textContent = '@' + state.me.name
    const owner = isOwner()
    ownerNote.hidden = !owner
    if (!isBusy(delForm)) {
      delPass.disabled = owner
      delSubmit.disabled = owner
    }
    if (owner) delSubmit.setAttribute('aria-describedby', ownerNote.id)
    else delSubmit.removeAttribute('aria-describedby')
    Array.from(page.querySelectorAll('input[autocomplete="username"]')).forEach((input) => {
      input.value = state.me.name
    })
  }
  update()
  return { update: update, signature: myProfileSignature }
}

async function submitUsernameChange (ui) {
  if (isBusy(ui.form) || !state.me) return
  const name = cleanUsername(ui.input.value)
  const problem = usernameProblem(name)
  if (problem) {
    setMsg(ui.msg, () => usernameProblemText(problem), 'error')
    focusNode(ui.input)
    return
  }
  if (name === state.me.name) {
    setMsg(ui.msg, () => t('settings.account.sameUsername'), 'error')
    focusNode(ui.input)
    return
  }
  const password = ui.pass.value
  if (!password) {
    setMsg(ui.msg, () => t('settings.account.enterPassword'), 'error')
    focusNode(ui.pass)
    return
  }
  setMsg(ui.msg, '')
  setFormBusy(ui.form, true)
  const result = await changeUsernameRequest(name, password, (pct) => {
    showProgress(ui.progress, pct)
  })
  showProgress(ui.progress, null)
  setFormBusy(ui.form, false)
  if (!result.ok) {
    setMsg(ui.msg, result.error, 'error')
    focusNode(ui.pass)
    return
  }
  const changed = state.me ? state.me.name : name
  ui.pass.value = ''
  ui.done()
  setMsg(ui.msg, () => t('settings.account.usernameChanged', { name: '@' + changed }), 'ok')
  safeCall(() => renderUserPanel(), null)
  updateSettingsPage()
}

async function submitPasswordChange (ui) {
  if (isBusy(ui.form)) return
  const oldPassword = ui.oldPass.value
  const newPassword = ui.newPass.value
  if (!oldPassword) {
    setMsg(ui.msg, () => t('settings.password.enterOld'), 'error')
    focusNode(ui.oldPass)
    return
  }
  const problem = passwordProblem(newPassword)
  if (problem) {
    setMsg(ui.msg, problem, 'error')
    focusNode(ui.newPass)
    return
  }
  if (newPassword !== ui.newPass2.value) {
    setMsg(ui.msg, () => t('settings.password.mismatch'), 'error')
    focusNode(ui.newPass2)
    return
  }
  if (newPassword === oldPassword) {
    setMsg(ui.msg, () => t('settings.password.same'), 'error')
    focusNode(ui.newPass)
    return
  }
  setMsg(ui.msg, '')
  setFormBusy(ui.form, true)
  const result = await changePasswordRequest(oldPassword, newPassword, (pct) => {
    showProgress(ui.progress, pct)
  })
  showProgress(ui.progress, null)
  setFormBusy(ui.form, false)
  if (result.ok) {
    ui.oldPass.value = ''
    ui.newPass.value = ''
    ui.newPass2.value = ''
    updateStrengthMeter(ui.strength, '')
    setMsg(ui.msg, () => t('settings.password.changed'), 'ok')
    settingsUi.sessions = null
    return
  }
  setMsg(ui.msg, result.error, 'error')
  focusNode(ui.oldPass)
}

async function submitAccountDelete (ui) {
  if (isBusy(ui.form) || !state.me) return
  if (isOwner()) {
    setMsg(ui.msg, () => t('settings.account.ownerCannotDelete'), 'error')
    return
  }
  const password = ui.pass.value
  if (!password) {
    setMsg(ui.msg, () => t('settings.account.enterPassword'), 'error')
    focusNode(ui.pass)
    return
  }
  if (!window.confirm(t('settings.account.deleteConfirm', { name: '@' + state.me.name }))) return
  setMsg(ui.msg, '')
  setFormBusy(ui.form, true)
  const result = await deleteAccountRequest(password, (pct) => {
    showProgress(ui.progress, pct)
  })
  // Başarıda hesap kapanır, görünüm de kapanır ve giriş ekranı açılır (16-identity.js)
  if (result.ok) return
  showProgress(ui.progress, null)
  setFormBusy(ui.form, false)
  setMsg(ui.msg, result.error, 'error')
  focusNode(ui.pass)
}

// 2. Profil: profil resmi (kare kırpma önizlemesi), görünen ad, özel durum, hakkımda, renk ve canlı
// önizleme kartı. Taslak bellekte tutulur, Kaydet ile grup anahtarıyla şifrelenip sunucuya gider.

function profileDraft () {
  const me = state.me
  const existing = settingsUi.draft
  if (existing && sameId(existing.userId, me.id)) return existing
  dropProfileDraft()
  const view = myProfileView()
  settingsUi.draft = {
    userId: me.id,
    base: { displayName: view.displayName, statusText: view.statusText, bio: view.bio, color: view.color },
    displayName: view.displayName,
    statusText: view.statusText,
    bio: view.bio,
    color: view.color,
    avatarMode: 'server',
    avatarFile: null,
    avatarUrl: '',
    pending: null
  }
  return settingsUi.draft
}

function revokeBlobLater (url) {
  if (!url) return
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url)
    } catch (err) {
      // Zaten bırakılmış
    }
  }, 5000)
}

function dropProfileDraft () {
  const d = settingsUi.draft
  settingsUi.draft = null
  if (!d) return
  revokeBlobLater(d.avatarUrl)
  if (d.pending) revokeBlobLater(d.pending.url)
}

function draftDirty (d) {
  return d.displayName !== d.base.displayName || d.statusText !== d.base.statusText || d.bio !== d.base.bio || d.color !== d.base.color || d.avatarMode !== 'server'
}

function myAvatarUploadId () {
  if (!state.me) return null
  const rec = safeCall(() => profileRecord(state.me.id), null)
  return rec && rec.profile && rec.profile.avatar ? rec.profile.avatar.u : null
}

// Taslakta gösterilecek profil resmi. Kayıttan sonra sunucudaki yeni resim çözülene kadar yerel
// önizleme gösterilir.
function draftAvatarUrl (d) {
  if (d.avatarMode === 'new') return d.avatarUrl
  if (d.avatarMode === 'removed') return ''
  const serverUrl = safeCall(() => avatarInfoFor(state.me.id).blobUrl, null)
  const p = d.pending
  if (p) {
    const stillOld = myAvatarUploadId() === p.from
    const waiting = p.url && !serverUrl
    if ((stillOld || waiting) && Date.now() - p.at < AVATAR_PENDING_MS) return p.url
    d.pending = null
    revokeBlobLater(p.url)
  }
  return serverUrl || ''
}

function draftView (d) {
  return {
    displayName: d.displayName.trim(),
    statusText: d.statusText.trim(),
    bio: d.bio.trim(),
    color: d.color,
    avatarUrl: draftAvatarUrl(d)
  }
}

// Kırpılmış önizleme: kaynağın ortasından kare, 256x256. Kayıtta aynı kırpma 13-profile.js'te yapılır.
async function makeAvatarPreview (file) {
  let bytes = null
  try {
    bytes = await readBlobBytes(file)
  } catch (err) {
    return null
  }
  const sniffed = window.E2EE.sniffImage(bytes)
  const decoded = await decodeImage(bytes, sniffed || String(file.type || 'application/octet-stream'))
  if (!decoded) return null
  try {
    const side = Math.min(decoded.w, decoded.h)
    if (!side) return null
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_EDGE
    canvas.height = AVATAR_EDGE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    if (sniffed !== 'image/png') {
      // Kayıtta PNG dışındaki resimler JPEG olur, saydam yerler beyaz görünür
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, AVATAR_EDGE, AVATAR_EDGE)
    }
    ctx.drawImage(decoded.image, Math.floor((decoded.w - side) / 2), Math.floor((decoded.h - side) / 2), side, side, 0, 0, AVATAR_EDGE, AVATAR_EDGE)
    const out = await canvasToBytes(canvas, 'image/png')
    canvas.width = 1
    canvas.height = 1
    if (window.E2EE.sniffImage(out) !== 'image/png') return null
    return { url: URL.createObjectURL(new Blob([out], { type: 'image/png' })) }
  } catch (err) {
    return null
  } finally {
    decoded.release()
  }
}

function buildProfilePage (page) {
  const d = profileDraft()
  page.appendChild(h('p', 'settings-lead', t('settings.profile.e2eeNote')))
  const keyNotice = h('p', 'warning settings-notice', t('profile.needKey'))
  keyNotice.id = 'set-profile-needkey'
  page.appendChild(keyNotice)
  const layout = h('div', 'settings-profile-layout')
  page.appendChild(layout)
  const form = h('form', 'form settings-form settings-profile-form')
  form.id = 'set-profile-form'
  form.noValidate = true
  layout.appendChild(form)
  const side = h('div', 'settings-profile-side')
  layout.appendChild(side)
  side.appendChild(h('p', 'settings-subtitle', t('theme.preview')))
  const previewHost = h('div', 'settings-card-host')
  previewHost.id = 'set-profile-preview'
  side.appendChild(previewHost)

  // Profil resmi
  sSub(form, t('settings.profile.avatarTitle'), 'set-avatar-title')
  const avatarRow = h('div', 'settings-avatar-row')
  const avatarHost = h('div', 'settings-avatar-host')
  avatarHost.id = 'set-avatar-preview'
  avatarRow.appendChild(avatarHost)
  const avatarButtons = h('div', 'settings-avatar-buttons')
  const pick = sButton('button button-secondary', t('settings.profile.avatarPick'), 'set-avatar-pick', null, 'i-image')
  const remove = sButton('button button-ghost', t('settings.profile.avatarRemove'), 'set-avatar-remove', null, 'i-trash')
  avatarButtons.appendChild(pick)
  avatarButtons.appendChild(remove)
  avatarRow.appendChild(avatarButtons)
  form.appendChild(avatarRow)
  const file = h('input', 'file-input')
  file.type = 'file'
  file.accept = 'image/*'
  file.id = 'set-avatar-file'
  file.tabIndex = -1
  file.setAttribute('aria-hidden', 'true')
  form.appendChild(file)
  form.appendChild(sHint(t('settings.profile.avatarHint'), 'set-avatar-hint'))
  const avatarMsg = sMsg('set-avatar-msg')
  form.appendChild(avatarMsg)

  // Metin alanları ve karakter sayaçları
  const counters = []
  const addText = (id, labelKey, value, max, multiline, placeholder, field) => {
    const control = multiline ? h('textarea', 'input settings-textarea') : sInput('text')
    if (multiline) control.rows = 3
    control.maxLength = max * 4
    control.value = value
    if (placeholder) control.setAttribute('placeholder', placeholder)
    sField(form, id, t(labelKey), control, null)
    const counter = h('p', 'settings-counter')
    counter.id = id + '-counter'
    form.appendChild(counter)
    control.setAttribute('aria-describedby', counter.id)
    counters.push({ control: control, counter: counter, max: max })
    control.addEventListener('input', () => {
      d[field] = control.value
      refresh()
    })
    return control
  }
  const nameInput = addText('set-display-name', 'profile.displayName', d.displayName, PROFILE_NAME_MAX, false, t('profile.displayNamePlaceholder'), 'displayName')
  nameInput.autocomplete = 'nickname'
  form.appendChild(sHint(t('settings.profile.displayNameHint'), 'set-display-name-hint'))
  nameInput.setAttribute('aria-describedby', 'set-display-name-counter set-display-name-hint')
  const statusInput = addText('set-status-text', 'status.customLabel', d.statusText, PROFILE_STATUS_MAX, false, t('status.customPlaceholder'), 'statusText')
  const bioInput = addText('set-bio', 'profile.about', d.bio, PROFILE_BIO_MAX, true, t('settings.profile.bioPlaceholder'), 'bio')

  // Profil rengi: 8 renkli palet
  sSub(form, t('settings.profile.colorTitle'), 'set-color-title')
  const palette = h('div', 'settings-palette')
  palette.setAttribute('role', 'radiogroup')
  palette.setAttribute('aria-labelledby', 'set-color-title')
  const swatches = []
  let i = 0
  while (i < PROFILE_COLORS) {
    const index = i
    const sw = h('input', 'settings-swatch')
    sw.type = 'radio'
    sw.name = 'set-color'
    sw.id = 'set-color-' + index
    sw.value = String(index)
    sw.setAttribute('data-color', String(index))
    sw.setAttribute('aria-label', t('settings.profile.colorN', { n: index + 1 }))
    sw.title = t('settings.profile.colorN', { n: index + 1 })
    sw.addEventListener('change', () => {
      if (!sw.checked) return
      d.color = index
      refresh()
    })
    palette.appendChild(sw)
    swatches.push(sw)
    i += 1
  }
  form.appendChild(palette)

  const msg = sMsg('set-profile-msg')
  form.appendChild(msg)
  const actions = sActions(form)
  const save = sButton('button', t('common.save'), 'set-profile-save')
  save.type = 'submit'
  const reset = sButton('button button-secondary', t('settings.profile.reset'), 'set-profile-reset')
  actions.appendChild(save)
  actions.appendChild(reset)
  const dirtyNote = h('p', 'settings-dirty', t('settings.profile.unsaved'))
  dirtyNote.id = 'set-profile-dirty'
  dirtyNote.setAttribute('role', 'status')
  form.appendChild(dirtyNote)

  const fillInputs = () => {
    if (nameInput.value !== d.displayName) nameInput.value = d.displayName
    if (statusInput.value !== d.statusText) statusInput.value = d.statusText
    if (bioInput.value !== d.bio) bioInput.value = d.bio
    swatches.forEach((sw, n) => {
      sw.checked = n === d.color
    })
  }

  const refresh = () => {
    const view = draftView(d)
    clear(avatarHost)
    avatarHost.appendChild(previewAvatar('xl', view.avatarUrl, initial(view.displayName || state.me.name), view.color, ''))
    clear(previewHost)
    previewHost.appendChild(buildPreviewCard(view, 'set-profile-card'))
    remove.disabled = !view.avatarUrl
    counters.forEach((c) => {
      const len = cpLength(c.control.value.trim())
      c.counter.textContent = t('settings.profile.counter', { count: formatNumber(len), max: formatNumber(c.max) })
      c.counter.classList.toggle('is-over', len > c.max)
    })
    const keyOk = hasActiveKey()
    keyNotice.hidden = keyOk
    const dirty = draftDirty(d)
    if (!isBusy(form)) {
      save.disabled = !dirty || !keyOk
      reset.disabled = !dirty
      pick.disabled = !keyOk
    }
    dirtyNote.hidden = !dirty
  }

  pick.addEventListener('click', () => {
    file.value = ''
    file.click()
  })
  file.addEventListener('change', async () => {
    const chosen = file.files && file.files[0] ? file.files[0] : null
    file.value = ''
    if (!chosen) return
    if (chosen.size > AVATAR_SOURCE_MAX) {
      setMsg(avatarMsg, () => t('settings.profile.avatarTooBig', { size: formatSize(AVATAR_SOURCE_MAX) }), 'error')
      return
    }
    setMsg(avatarMsg, () => t('settings.profile.avatarReading'))
    const preview = await makeAvatarPreview(chosen)
    if (!preview) {
      setMsg(avatarMsg, () => t('profile.avatarInvalid'), 'error')
      return
    }
    if (settingsUi.draft !== d) {
      revokeBlobLater(preview.url)
      return
    }
    if (d.avatarMode === 'new') revokeBlobLater(d.avatarUrl)
    d.avatarMode = 'new'
    d.avatarFile = chosen
    d.avatarUrl = preview.url
    setMsg(avatarMsg, () => t('settings.profile.avatarReady'), 'ok')
    refresh()
    if (isConnected(pick)) focusNode(pick)
  })
  remove.addEventListener('click', () => {
    if (d.avatarMode === 'new') revokeBlobLater(d.avatarUrl)
    d.avatarFile = null
    d.avatarUrl = ''
    d.avatarMode = myAvatarUploadId() || d.pending ? 'removed' : 'server'
    setMsg(avatarMsg, () => t('settings.profile.avatarRemoved'))
    refresh()
    focusNode(pick)
  })
  reset.addEventListener('click', () => {
    if (d.avatarMode === 'new') revokeBlobLater(d.avatarUrl)
    d.displayName = d.base.displayName
    d.statusText = d.base.statusText
    d.bio = d.base.bio
    d.color = d.base.color
    d.avatarMode = 'server'
    d.avatarFile = null
    d.avatarUrl = ''
    fillInputs()
    setMsg(avatarMsg, '')
    setMsg(msg, () => t('settings.profile.resetDone'))
    refresh()
    focusNode(nameInput)
  })
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    saveProfileDraft(d, { form: form, msg: msg, refresh: refresh, fill: fillInputs, avatarMsg: avatarMsg })
  })

  fillInputs()
  refresh()
  const update = () => {
    // Taslakta değişiklik yoksa sunucudaki profil (ör. başka cihazdan) taslağa yansır
    if (!draftDirty(d) && !isBusy(form)) {
      const view = myProfileView()
      d.base = { displayName: view.displayName, statusText: view.statusText, bio: view.bio, color: view.color }
      d.displayName = view.displayName
      d.statusText = view.statusText
      d.bio = view.bio
      d.color = view.color
      fillInputs()
    }
    refresh()
  }
  return { update: update, signature: () => myProfileSignature() + '|' + hasActiveKey() + '|' + (d.pending ? 'p' : '') }
}

async function saveProfileDraft (d, ui) {
  if (isBusy(ui.form)) return
  if (!hasActiveKey()) {
    setMsg(ui.msg, () => t('profile.needKey'), 'error')
    return
  }
  setFormBusy(ui.form, true)
  setMsg(ui.msg, () => t('settings.profile.saving'))
  // Önceki kaydın profil resmi sunucu kaydına yansıyana kadar beklenir (en fazla birkaç saniye)
  let waited = 0
  while (d.pending && myAvatarUploadId() === d.pending.from && waited < 3000) {
    await wait(100)
    waited += 100
  }
  const input = { displayName: d.displayName, statusText: d.statusText, bio: d.bio, color: d.color }
  if (d.avatarMode === 'new') input.avatarFile = d.avatarFile
  else if (d.avatarMode === 'removed') input.avatarFile = null
  const before = myAvatarUploadId()
  const mode = d.avatarMode
  const result = await saveProfile(input)
  setFormBusy(ui.form, false)
  if (!result.ok) {
    setMsg(ui.msg, result.error, 'error')
    ui.refresh()
    return
  }
  const saved = {
    displayName: cleanLine(d.displayName, 1000),
    statusText: cleanLine(d.statusText, 1000),
    bio: cleanBio(d.bio),
    color: d.color
  }
  d.base = saved
  d.displayName = saved.displayName
  d.statusText = saved.statusText
  d.bio = saved.bio
  if (d.pending) revokeBlobLater(d.pending.url)
  d.pending = null
  if (mode === 'new') {
    d.pending = { from: before, url: d.avatarUrl, at: Date.now() }
  } else if (mode === 'removed') {
    d.pending = { from: before, url: '', at: Date.now() }
  }
  d.avatarMode = 'server'
  d.avatarFile = null
  d.avatarUrl = ''
  setMsg(ui.avatarMsg, '')
  setMsg(ui.msg, () => t('settings.profile.saved'), 'ok')
  if (isConnected(ui.form)) {
    ui.fill()
    ui.refresh()
  }
}

// 3. Gizlilik ve güvenlik: özel mesaj kabulü, yazıyor bilgisi, engellenenler, etkin oturumlar,
// güvenlik anahtarım ve şifreleme anahtarları

function typingEnabled () {
  return storeGet(SETTINGS_KEYS.typing) !== '0'
}

// YouTube oynatıcısı izni (music.js ile aynı anlam): '1' verildi, '0' reddedildi (yeniden sorulmaz),
// anahtar yoksa sorulmadı (ilk YouTube parçasında sorulur)
function youtubeConsentState () {
  const v = storeGet(SETTINGS_KEYS.youtubeConsent)
  if (v === '1') return 'granted'
  return v === null ? 'unset' : 'denied'
}

function youtubeConsentGranted () {
  return youtubeConsentState() === 'granted'
}

function buildPrivacyPage (page) {
  // Özel mesajlar
  const dmSec = sSection(page, t('settings.privacy.dmTitle'), 'set-dm-section')
  const dmMsg = sMsg('set-dm-msg')
  const allow = sSwitch('set-allow-dms', t('settings.privacy.allowDms'), priv().allowMemberDms !== false, async (checked, input) => {
    input.disabled = true
    const result = await setAllowMemberDms(checked)
    input.disabled = false
    if (!result.ok) {
      input.checked = !checked
      setMsg(dmMsg, result.error, 'error')
      return
    }
    setMsg(dmMsg, () => t(checked ? 'settings.privacy.allowDmsOn' : 'settings.privacy.allowDmsOff'), 'ok')
  }, t('settings.privacy.allowDmsHint'))
  dmSec.appendChild(allow.row)
  dmSec.appendChild(dmMsg)

  // Yazıyor bilgisi
  const typingSec = sSection(page, t('settings.privacy.typingTitle'), 'set-typing-section')
  const typingMsg = sMsg('set-typing-msg')
  const typing = sSwitch('set-typing', t('settings.privacy.typing'), typingEnabled(), (checked) => {
    storeSet(SETTINGS_KEYS.typing, checked ? '1' : '0')
    setMsg(typingMsg, () => t(checked ? 'settings.privacy.typingOn' : 'settings.privacy.typingOff'), 'ok')
  }, t('settings.privacy.typingHint'))
  typingSec.appendChild(typing.row)
  typingSec.appendChild(typingMsg)

  // YouTube oynatıcısı izni (Ek L2.5): izin Telsiz DJ'de ilk YouTube parçasında istenir, burada
  // durumu görünür ve geri alınabilir
  const ytSec = sSection(page, t('settings.youtube.title'), 'set-youtube-section')
  ytSec.appendChild(sHint(t('settings.youtube.text'), 'set-youtube-text'))
  const ytState = h('p', 'settings-state')
  ytState.id = 'set-youtube-state'
  ytSec.appendChild(ytState)
  const ytMsg = sMsg('set-youtube-msg')
  const ytRow = sActions(ytSec)
  // Geri alma ve yeniden sorma izni kaldırır, oynatıcı yüklenmez ve sonraki YouTube parçasında yeniden sorulur
  const ytRevoke = sButton('button button-secondary', t('settings.youtube.revoke'), 'set-youtube-revoke', () => {
    const wasGranted = youtubeConsentGranted()
    storeRemove(SETTINGS_KEYS.youtubeConsent)
    setMsg(ytMsg, () => t(wasGranted ? 'settings.youtube.revoked' : 'settings.youtube.askAgainDone'), 'ok')
    updateSettingsPage()
    const heading = byId('set-youtube-section-title')
    if (heading) {
      heading.tabIndex = -1
      focusNode(heading)
    }
  }, 'i-close')
  ytRow.appendChild(ytRevoke)
  ytSec.appendChild(ytMsg)

  // Engellenen kullanıcılar
  const blockSec = sSection(page, t('settings.privacy.blockedTitle'), 'set-blocked-section')
  blockSec.appendChild(sHint(t('settings.privacy.blockedHint')))
  const blockList = h('ul', 'plain-list settings-list')
  blockList.id = 'set-blocked-list'
  blockList.setAttribute('aria-labelledby', 'set-blocked-section-title')
  blockSec.appendChild(blockList)

  // Etkin oturumlar
  const sessSec = sSection(page, t('sessions.title'), 'set-sessions-section')
  sessSec.appendChild(sHint(t('sessions.hint')))
  const sessList = h('ul', 'plain-list settings-list')
  sessList.id = 'set-sessions-list'
  sessList.setAttribute('aria-labelledby', 'set-sessions-section-title')
  sessSec.appendChild(sessList)
  const sessMsg = sMsg('set-sessions-msg')
  sessSec.appendChild(sessMsg)
  const sessActions = sActions(sessSec)
  const others = sButton('button button-danger', t('sessions.revokeOthers'), 'set-sessions-others', () => {
    revokeOtherSessions(sessMsg)
  }, 'i-logout')
  sessActions.appendChild(others)
  sessActions.appendChild(sButton('button button-secondary', t('sessions.refresh'), 'set-sessions-refresh', () => {
    setMsg(sessMsg, '')
    loadSessions()
  }))

  // Güvenlik anahtarım
  const myKeySec = sSection(page, t('settings.privacy.myKeyTitle'), 'set-mykey-section')
  myKeySec.appendChild(sHint(t('settings.privacy.myKeyHint')))
  const fp = h('code', 'settings-fingerprint')
  fp.id = 'set-fingerprint'
  myKeySec.appendChild(fp)
  const fpNote = h('p', 'settings-note')
  fpNote.id = 'set-fingerprint-note'
  myKeySec.appendChild(fpNote)
  const unlockRow = sActions(myKeySec)
  const unlock = sButton('button button-secondary', t('identity.unlockSubmit'), 'set-identity-unlock', () => {
    openIdentityUnlock(unlock)
  }, 'i-key')
  unlockRow.appendChild(unlock)

  // Şifreleme anahtarları (grup anahtarı)
  const keys = buildKeyringSection(page)

  const update = () => {
    if (!allow.input.disabled) allow.input.checked = priv().allowMemberDms !== false
    typing.input.checked = typingEnabled()
    const consent = youtubeConsentState()
    ytState.textContent = t(consent === 'granted' ? 'settings.youtube.granted' : consent === 'denied' ? 'settings.youtube.denied' : 'settings.youtube.notGranted')
    ytState.setAttribute('data-state', consent === 'granted' ? 'granted' : consent === 'denied' ? 'denied' : 'default')
    ytRow.hidden = consent === 'unset'
    setButtonText(ytRevoke, t(consent === 'denied' ? 'settings.youtube.askAgain' : 'settings.youtube.revoke'))
    renderBlockedList(blockList)
    renderSessions()
    const fingerprint = safeCall(() => myFingerprint(), '')
    const locked = safeCall(() => identityNeedsUnlock(), false)
    fp.hidden = !fingerprint
    fp.textContent = fingerprint
    const note = !fingerprint ? t('settings.privacy.myKeyNone') : locked ? t('settings.privacy.myKeyLocked') : ''
    fpNote.textContent = note
    fpNote.hidden = !note
    unlockRow.hidden = !locked
    others.disabled = !settingsUi.sessions || !Array.isArray(settingsUi.sessions.list) || !settingsUi.sessions.list.some((s) => s && !s.current)
    keys.update()
  }
  if (!settingsUi.sessions || !settingsUi.sessions.list) loadSessions()
  update()
  return {
    update: update,
    signature: () => {
      const p = priv()
      const blocked = p.blocked.map((id) => id + ':' + safeCall(() => userDisplayName(id), '') + ':' + safeCall(() => avatarInfoFor(id).blobUrl, '')).join(',')
      return [p.allowMemberDms, blocked, safeCall(() => myFingerprint(), ''), safeCall(() => identityNeedsUnlock(), false), typingEnabled(), youtubeConsentState(), keyringSignature(), isAdmin(), state.inviteCode || ''].join('|')
    }
  }
}

function renderBlockedList (list) {
  const focusKey = activeFocusKey(list)
  clear(list)
  const ids = priv().blocked
  if (!ids.length) {
    list.appendChild(h('li', 'empty-row', t('settings.privacy.blockedEmpty')))
    return
  }
  ids.forEach((id) => {
    const li = h('li', 'list-row settings-person-row')
    li.setAttribute('data-user-id', String(id))
    const main = h('span', 'list-main')
    main.appendChild(avatar(id, 'sm'))
    const text = h('span', 'list-text')
    text.appendChild(h('span', 'list-name', shownName(id)))
    const handle = shownHandle(id)
    if (handle) text.appendChild(h('span', 'list-sub', handle))
    main.appendChild(text)
    li.appendChild(main)
    const actions = h('span', 'row-actions')
    const b = button('button button-small button-secondary act-unblock', t('social.unblock'), null, t('settings.privacy.unblockLabel', { name: shownName(id) }))
    b.setAttribute('data-focus-key', 'unblock-' + id)
    b.addEventListener('click', async () => {
      b.disabled = true
      const index = ids.indexOf(id)
      const done = await unblockUser(id)
      if (!done && isConnected(b)) b.disabled = false
      updateSettingsPage()
      if (done) focusListAfterRemoval(list, index, 'set-blocked-section-title')
    })
    actions.appendChild(b)
    li.appendChild(actions)
    list.appendChild(li)
  })
  restoreFocusKey(list, focusKey)
}

// Satır kaldırılınca odak aynı sıradaki (yoksa önceki) satırın düğmesine, liste boşsa başlığa gider
function focusListAfterRemoval (list, index, headingId) {
  if (!isConnected(list)) return
  const buttons = Array.from(list.querySelectorAll('button:not([disabled])'))
  const target = buttons[Math.min(index, buttons.length - 1)]
  if (target) {
    focusNode(target)
    return
  }
  const heading = byId(headingId)
  if (heading) {
    heading.tabIndex = -1
    focusNode(heading)
  }
}

// Etkin oturumlar: /api/me/sessions, tek tek veya bu cihaz dışındakilerin hepsi kapatılabilir
async function loadSessions () {
  settingsUi.sessionsGen += 1
  const gen = settingsUi.sessionsGen
  const before = settingsUi.sessions
  settingsUi.sessions = { list: before ? before.list : null, loading: true, error: null }
  renderSessions()
  const res = await api('GET', '/api/me/sessions')
  if (gen !== settingsUi.sessionsGen || !isSettingsOpen()) return
  if (res.status === 200 && res.data && Array.isArray(res.data.sessions)) {
    settingsUi.sessions = { list: res.data.sessions.filter((s) => s && typeof s.id === 'string'), loading: false, error: null }
  } else {
    settingsUi.sessions = { list: before ? before.list : null, loading: false, error: () => errorText(res, t('sessions.loadFailed')) }
  }
  if (isSettingsTab('privacy')) updateSettingsPage()
}

function sessionLabel (s) {
  return typeof s.label === 'string' && s.label ? s.label : t('sessions.unknown')
}

function renderSessions () {
  const list = byId('set-sessions-list')
  if (!list) return
  const focusKey = activeFocusKey(list)
  clear(list)
  const data = settingsUi.sessions
  if (!data || (!data.list && data.loading)) {
    list.appendChild(h('li', 'empty-row', t('sessions.loading')))
    return
  }
  if (!data.list) {
    list.appendChild(h('li', 'empty-row is-error', data.error ? textOf(data.error) : t('sessions.loadFailed')))
    return
  }
  data.list.forEach((s) => {
    const li = h('li', 'list-row session-row' + (s.current ? ' is-current' : ''))
    li.setAttribute('data-session-id', s.id)
    const main = h('span', 'list-main')
    main.appendChild(icon(s.current ? 'i-check' : 'i-globe', 'settings-row-icon'))
    const text = h('span', 'list-text')
    const nameLine = h('span', 'settings-name-line')
    nameLine.appendChild(h('span', 'list-name', sessionLabel(s)))
    if (s.current) nameLine.appendChild(h('span', 'badge badge-active settings-badge', t('sessions.thisDevice')))
    text.appendChild(nameLine)
    const last = typeof s.lastUsed === 'number' ? s.lastUsed : 0
    const created = typeof s.createdAt === 'number' ? s.createdAt : 0
    const sub = h('span', 'list-sub', t('sessions.sub', { last: formatShort(last), created: formatShort(created) }))
    sub.title = t('sessions.subLong', { last: formatLong(last), created: formatLong(created) })
    text.appendChild(sub)
    main.appendChild(text)
    li.appendChild(main)
    if (!s.current) {
      const actions = h('span', 'row-actions')
      const b = button('button button-small button-secondary act-revoke', t('sessions.revoke'), null, t('sessions.revokeLabel', { label: sessionLabel(s) }))
      b.setAttribute('data-focus-key', 'revoke-' + s.id)
      b.addEventListener('click', () => {
        revokeSession(s, b)
      })
      actions.appendChild(b)
      li.appendChild(actions)
    }
    list.appendChild(li)
  })
  if (data.error) list.appendChild(h('li', 'empty-row is-error', textOf(data.error)))
  restoreFocusKey(list, focusKey)
}

async function revokeSession (s, b) {
  const msg = byId('set-sessions-msg')
  b.disabled = true
  const res = await api('POST', '/api/me/sessions/revoke', { id: s.id })
  if (res.status === 200) {
    const label = sessionLabel(s)
    setMsg(msg, () => t('sessions.revoked', { label: label }), 'ok')
    if (settingsUi.sessions && Array.isArray(settingsUi.sessions.list)) {
      settingsUi.sessions.list = settingsUi.sessions.list.filter((x) => x.id !== s.id)
    }
    updateSettingsPage()
    focusNode(byId('set-sessions-refresh'))
    loadSessions()
    return
  }
  if (isConnected(b)) b.disabled = false
  setMsg(msg, () => errorText(res, t('sessions.revokeFailed')), 'error')
}

async function revokeOtherSessions (msg) {
  if (!window.confirm(t('sessions.othersConfirm'))) return
  const b = byId('set-sessions-others')
  if (b) b.disabled = true
  const res = await api('POST', '/api/me/sessions/revoke', { others: true })
  if (res.status === 200) {
    const count = res.data && typeof res.data.revoked === 'number' ? res.data.revoked : 0
    setMsg(msg, () => t('sessions.othersRevoked', { count: count }), 'ok')
    if (settingsUi.sessions && Array.isArray(settingsUi.sessions.list)) {
      settingsUi.sessions.list = settingsUi.sessions.list.filter((x) => x.current)
    }
    updateSettingsPage()
    loadSessions()
    return
  }
  if (b && isConnected(b)) b.disabled = false
  setMsg(msg, () => errorText(res, t('sessions.revokeFailed')), 'error')
}

// Şifreleme anahtarları: anahtarlık, anahtar ekleme, etkin anahtarı gösterme ve kopyalama, davet
// veya anahtar bağlantısı, sahip ve yönetici için yeni anahtar oluşturma

function keyringList () {
  try {
    return cryptoReady() ? window.E2EE.keyring.list() : []
  } catch (err) {
    return []
  }
}

function keyringSignature () {
  return keyringList().map((k) => k.kid).join(',') + '|' + (activeKid() || '')
}

function activeKeyEntry () {
  const kid = activeKid()
  if (!kid) return null
  return keyringList().filter((k) => k.kid === kid)[0] || null
}

function buildKeyringSection (page) {
  const sec = sSection(page, t('settings.crypto.title'), 'set-keys-section')
  sec.appendChild(sHint(t('settings.crypto.intro')))
  sSub(sec, t('settings.crypto.keyring'), 'set-keyring-title')
  const ring = h('ul', 'plain-list settings-list')
  ring.id = 'set-keyring'
  ring.setAttribute('aria-labelledby', 'set-keyring-title')
  sec.appendChild(ring)

  sSub(sec, t('key.addShort'), 'set-key-add-title')
  const form = h('form', 'settings-inline-form')
  form.id = 'set-key-form'
  form.noValidate = true
  form.setAttribute('autocomplete', 'off')
  const keyLabel = h('label', 'sr-only', t('key.codeLabel'))
  keyLabel.setAttribute('for', 'set-key-input')
  form.appendChild(keyLabel)
  const keyInput = sInput('text', 'mono')
  keyInput.id = 'set-key-input'
  keyInput.autocomplete = 'off'
  keyInput.maxLength = 80
  keyInput.setAttribute('autocapitalize', 'characters')
  keyInput.setAttribute('spellcheck', 'false')
  keyInput.setAttribute('placeholder', 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX')
  form.appendChild(keyInput)
  const add = sButton('button', t('key.add'), 'set-key-add')
  add.type = 'submit'
  form.appendChild(add)
  sec.appendChild(form)
  const keyMsg = sMsg('set-key-msg')
  sec.appendChild(keyMsg)

  const activeWrap = h('div', 'settings-block')
  activeWrap.id = 'set-active-wrap'
  sSub(activeWrap, t('settings.crypto.active'), 'set-active-title')
  const missing = h('p', 'settings-note')
  missing.id = 'set-active-missing'
  activeWrap.appendChild(missing)
  const activeRow = h('div', 'settings-inline-form')
  activeRow.id = 'set-active-row'
  const code = h('code', 'secret')
  code.id = 'set-active-key'
  activeRow.appendChild(code)
  const show = sButton('button button-secondary', '', 'set-key-show')
  activeRow.appendChild(show)
  const copy = sButton('button button-secondary', t('common.copy'), 'set-key-copy', null, 'i-copy')
  activeRow.appendChild(copy)
  activeWrap.appendChild(activeRow)
  const linkRow = sActions(activeWrap)
  const copyLink = sButton('button', '', 'set-invite-copy', null, 'i-copy')
  linkRow.appendChild(copyLink)
  const linkHint = sHint('', 'set-invite-copy-hint')
  activeWrap.appendChild(linkHint)
  sec.appendChild(activeWrap)

  const adminWrap = h('div', 'settings-block')
  adminWrap.id = 'set-key-admin'
  sSub(adminWrap, t('settings.crypto.newKey'), 'set-key-admin-title')
  adminWrap.appendChild(h('p', 'warning', t('settings.crypto.newKeyWarning')))
  const generate = sButton('button button-secondary', '', 'set-key-generate')
  adminWrap.appendChild(generate)
  const newWrap = h('div', 'settings-block')
  newWrap.id = 'set-new-invite-wrap'
  const newText = h('textarea', 'input textarea-readonly mono')
  newText.rows = 3
  newText.readOnly = true
  newText.setAttribute('spellcheck', 'false')
  sField(newWrap, 'set-new-invite', t('settings.crypto.newInvite'), newText, null)
  const newCopy = sButton('button button-secondary', t('invite.copyLink'), 'set-new-invite-copy', () => {
    copyWithToast(newText.value)
  }, 'i-copy')
  sActions(newWrap).appendChild(newCopy)
  adminWrap.appendChild(newWrap)
  sec.appendChild(adminWrap)

  const setKeyVisible = (visible) => {
    settingsUi.keyVisible = visible
    const entry = activeKeyEntry()
    show.setAttribute('aria-pressed', visible ? 'true' : 'false')
    show.textContent = t(visible ? 'common.hide' : 'common.show')
    code.textContent = visible && entry ? entry.code : t('common.hidden')
    code.classList.toggle('secret-visible', Boolean(visible && entry))
  }

  const update = () => {
    const keys = keyringList()
    const kid = activeKid()
    clear(ring)
    if (!keys.length) ring.appendChild(h('li', 'empty-row', t('settings.crypto.noKeys')))
    keys.forEach((k) => {
      const li = h('li', 'list-row settings-key-row')
      li.setAttribute('data-kid', k.kid)
      const info = h('span', 'list-main')
      info.appendChild(icon('i-key'))
      info.appendChild(h('code', 'kid', k.kid.slice(0, 8)))
      if (k.kid === kid) info.appendChild(h('span', 'badge badge-active', t('settings.crypto.activeBadge')))
      if (k.added) info.appendChild(h('span', 'list-sub', t('settings.crypto.addedAt', { date: formatShort(k.added) })))
      li.appendChild(info)
      const rm = button('button button-small button-ghost', t('common.remove'), null, t('settings.crypto.removeKey', { kid: k.kid.slice(0, 8) }))
      rm.addEventListener('click', () => {
        const warn = t(k.kid === kid ? 'settings.crypto.removeActiveConfirm' : 'settings.crypto.removeConfirm')
        if (!window.confirm(warn)) return
        try {
          window.E2EE.keyring.remove(k.kid)
        } catch (err) {
          window.console.error(err)
        }
        afterKeyringChange()
      })
      li.appendChild(rm)
      ring.appendChild(li)
    })
    const entry = activeKeyEntry()
    activeRow.hidden = !entry
    linkRow.hidden = !entry
    missing.textContent = entry ? '' : (kid ? t('settings.crypto.activeMissing', { kid: kid.slice(0, 8) }) : t('settings.crypto.noActive'))
    missing.hidden = Boolean(entry)
    const admin = isAdmin()
    const withInvite = admin && Boolean(state.inviteCode)
    setButtonText(copyLink, t(withInvite ? 'settings.crypto.copyInvite' : 'settings.crypto.copyKeyLink'))
    linkHint.textContent = t(withInvite ? 'settings.crypto.copyInviteHint' : 'settings.crypto.copyKeyLinkHint')
    linkHint.hidden = !entry
    setKeyVisible(settingsUi.keyVisible)
    adminWrap.hidden = !admin
    generate.textContent = t(kid ? 'settings.crypto.newKey' : 'key.generate')
    newWrap.hidden = !settingsUi.newInvite
    newText.value = settingsUi.newInvite
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const value = keyInput.value.trim()
    if (!value) {
      setMsg(keyMsg, () => t('settings.crypto.enterKey'), 'error')
      focusNode(keyInput)
      return
    }
    let added = ''
    try {
      added = window.E2EE.keyring.add(value)
    } catch (err) {
      setMsg(keyMsg, () => keyErrorText(err), 'error')
      focusNode(keyInput)
      return
    }
    keyInput.value = ''
    const isActive = added === activeKid()
    setMsg(keyMsg, () => (isActive ? t('settings.crypto.activeAdded') : t('settings.crypto.keyAdded', { kid: added.slice(0, 8) })), 'ok')
    afterKeyringChange()
  })
  show.addEventListener('click', () => {
    setKeyVisible(show.getAttribute('aria-pressed') !== 'true')
  })
  copy.addEventListener('click', () => {
    const entry = activeKeyEntry()
    if (entry) copyWithToast(entry.code)
  })
  copyLink.addEventListener('click', () => {
    const entry = activeKeyEntry()
    if (!entry) return
    const link = isAdmin() && state.inviteCode ? inviteLink(state.inviteCode, entry.code) : inviteLink(null, entry.code)
    copyWithToast(link)
  })
  generate.addEventListener('click', async () => {
    if (!isAdmin()) return
    const hadKey = Boolean(activeKid())
    if (hadKey && !window.confirm(t('settings.crypto.newKeyConfirm'))) return
    generate.disabled = true
    const created = await createGroupKey()
    generate.disabled = false
    if (!created.ok) {
      setMsg(keyMsg, created.error, 'error')
      return
    }
    await refreshAdminState(true)
    settingsUi.newInvite = inviteLink(state.inviteCode, created.code)
    setMsg(keyMsg, () => t('settings.crypto.newKeyActivated'), 'ok')
    afterKeyringChange()
    focusNode(byId('set-new-invite-copy'))
  })
  update()
  return { update: update }
}

// Grup anahtarlığı değişince mesajlar, yazma alanı, ses ve profiller yenilenir
function afterKeyringChange () {
  if (conversationMode() === 'channel') renderComposerState()
  refreshAllMessages()
  renderVoiceAll()
  socialAfterKeyring()
  if (typeof djRekey === 'function') djRekey()
  updateSettingsPage()
}

// 4. Ses (voice.js ayarları 'telsiz.voice' içinde saklanır, burada gösterilir ve setSettings ile değişir)

function voiceSettings () {
  if (!voice) return null
  try {
    return voice.settings()
  } catch (err) {
    return null
  }
}

function bindingText (binding) {
  if (!voice) return t('bindings.none')
  try {
    return String(voice.bindingLabel(binding || null, t) || t('bindings.none'))
  } catch (err) {
    return t('bindings.none')
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
    settingsOnVoice()
  }, () => {})
  settingsOnVoice()
}

// Ses durumu veya ayarları değişince (10-voice.js) açık ses ve tuş atamaları sayfası güncellenir
function settingsOnVoice () {
  if (isSettingsTab('voice')) renderSettingsVoice()
  else if (isSettingsTab('keybinds')) renderKeybinds()
}

function sliderValue (input, min, max) {
  const n = Math.round(Number(input.value))
  return isFinite(n) ? Math.max(min, Math.min(max, n)) : min
}

function sRange (id, min, max, step, value) {
  const input = h('input', 'range settings-range')
  input.type = 'range'
  input.id = id
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  return input
}

function rangeLabel (parent, id, text) {
  const label = h('label', 'label')
  label.setAttribute('for', id)
  label.appendChild(h('span', '', text))
  const value = h('span', 'label-value')
  value.id = id + '-value'
  label.appendChild(value)
  parent.appendChild(label)
  return value
}

function buildVoicePage (page) {
  const support = h('p', 'notice settings-notice')
  support.id = 'set-voice-support'
  support.hidden = true
  page.appendChild(support)
  const s0 = voiceSettings() || {}

  // Giriş cihazı
  const devSec = sSection(page, t('settings.voice.deviceTitle'), 'set-device-section')
  const micLabel = h('label', 'label', t('settings.voice.mic'))
  micLabel.setAttribute('for', 'set-mic')
  devSec.appendChild(micLabel)
  const micRow = h('div', 'settings-inline-form')
  const mic = h('select', 'input select')
  mic.id = 'set-mic'
  micRow.appendChild(mic)
  micRow.appendChild(sButton('button button-secondary', t('settings.voice.refreshDevices'), 'set-mic-refresh', fillMicList))
  devSec.appendChild(micRow)
  devSec.appendChild(sHint(t('settings.voice.micHint')))
  mic.addEventListener('change', () => {
    applyVoiceSettings({ inputDeviceId: mic.value || null })
  })

  // Giriş modu
  const modeSec = sSection(page, t('settings.voice.inputMode'), 'set-mode-section')
  const modes = sRadios('set-mode', 'set-mode-section-title', [
    { value: 'vad', label: t('settings.voice.modeVad'), hint: t('settings.voice.modeVadHint') },
    { value: 'ptt', label: t('settings.voice.modePttShort'), hint: t('settings.voice.modePttHint') }
  ], s0.inputMode === 'ptt' ? 'ptt' : 'vad', (value) => {
    applyVoiceSettings({ inputMode: value })
  })
  modeSec.appendChild(modes.group)
  const vadWrap = h('div', 'settings-block')
  vadWrap.id = 'set-vad-wrap'
  const vadAuto = sSwitch('set-vad-auto', t('settings.voice.vadAuto'), s0.vadAuto !== false, (checked) => {
    applyVoiceSettings({ vadAuto: checked })
  }, t('settings.voice.vadAutoHint'))
  vadWrap.appendChild(vadAuto.row)
  rangeLabel(vadWrap, 'set-vad-threshold', t('settings.voice.threshold'))
  const threshold = sRange('set-vad-threshold', -100, 0, 1, typeof s0.vadThreshold === 'number' ? s0.vadThreshold : -50)
  vadWrap.appendChild(threshold)
  vadWrap.appendChild(sHint(t('settings.voice.thresholdHint')))
  threshold.addEventListener('input', () => {
    applyVoiceSettings({ vadThreshold: sliderValue(threshold, -100, 0) })
  })
  modeSec.appendChild(vadWrap)
  const pttWrap = h('div', 'settings-block')
  pttWrap.id = 'set-ptt-wrap'
  const keyRow = h('div', 'settings-kv')
  const keyText = h('div', 'settings-kv-text')
  keyText.appendChild(h('span', 'settings-kv-label', t('settings.voice.pttKey')))
  const keyCap = h('kbd', 'kbd settings-kbd')
  keyCap.id = 'set-ptt-key'
  keyText.appendChild(keyCap)
  keyRow.appendChild(keyText)
  const change = sButton('button button-secondary', t('settings.voice.changeKey'), 'set-ptt-change')
  keyRow.appendChild(change)
  pttWrap.appendChild(keyRow)
  const pttMsg = sMsg('set-ptt-msg')
  pttWrap.appendChild(pttMsg)
  rangeLabel(pttWrap, 'set-ptt-release', t('settings.voice.release'))
  const release = sRange('set-ptt-release', 0, 1000, 10, typeof s0.pttReleaseMs === 'number' ? s0.pttReleaseMs : 200)
  pttWrap.appendChild(release)
  pttWrap.appendChild(sHint(t('settings.voice.releaseHint')))
  pttWrap.appendChild(h('p', 'settings-note', t('settings.voice.focusNote')))
  release.addEventListener('input', () => {
    applyVoiceSettings({ pttReleaseMs: sliderValue(release, 0, 1000) })
  })
  change.addEventListener('click', () => {
    if (settingsUi.capture && settingsUi.capture.action === 'ptt') {
      cancelBindingCapture()
      setMsg(pttMsg, '')
      renderSettingsVoice()
      return
    }
    startBindingCapture('ptt', (phase, binding) => {
      if (phase === 'capturing') setMsg(pttMsg, () => t('settings.keybinds.capturePrompt'))
      else if (phase === 'set') setMsg(pttMsg, () => t('settings.voice.pttKeySet', { key: bindingText(binding) }), 'ok')
      else setMsg(pttMsg, '')
      renderSettingsVoice()
    })
  })
  modeSec.appendChild(pttWrap)

  // Giriş seviyesi ve mikrofon testi
  const levelSec = sSection(page, t('settings.voice.level'), 'set-level-section')
  const meter = h('div', 'meter settings-meter')
  meter.id = 'set-level-meter'
  meter.setAttribute('role', 'meter')
  meter.setAttribute('aria-label', t('settings.voice.level'))
  meter.setAttribute('aria-valuemin', '-100')
  meter.setAttribute('aria-valuemax', '0')
  const bar = h('div', 'meter-bar')
  bar.id = 'set-level-bar'
  meter.appendChild(bar)
  const mark = h('div', 'meter-threshold')
  mark.id = 'set-level-threshold'
  mark.hidden = true
  meter.appendChild(mark)
  levelSec.appendChild(meter)
  const levelNote = h('p', 'hint settings-hint')
  levelNote.id = 'set-level-note'
  levelSec.appendChild(levelNote)
  const testRow = sActions(levelSec)
  const test = sButton('button button-secondary', '', 'set-mic-test', toggleSettingsMicTest, 'i-mic')
  test.setAttribute('aria-pressed', 'false')
  testRow.appendChild(test)
  levelSec.appendChild(sMsg('set-mic-test-msg'))

  // Ses işleme
  const procSec = sSection(page, t('settings.voice.processingTitle'), 'set-processing-section')
  const procs = [
    ['set-echo', 'echoCancellation', 'settings.voice.echo'],
    ['set-noise', 'noiseSuppression', 'settings.voice.noise'],
    ['set-agc', 'autoGainControl', 'settings.voice.agc']
  ]
  procs.forEach((p) => {
    const sw = sSwitch(p[0], t(p[2]), s0[p[1]] !== false, (checked) => {
      const partial = {}
      partial[p[1]] = checked
      applyVoiceSettings(partial)
    }, null)
    procSec.appendChild(sw.row)
  })
  procSec.appendChild(sHint(t('settings.voice.processingHint')))

  // Çıkış
  const outSec = sSection(page, t('settings.voice.outputTitle'), 'set-output-section')
  rangeLabel(outSec, 'set-output-volume', t('settings.voice.outputVolume'))
  const volume = sRange('set-output-volume', 0, 100, 1, Math.round((typeof s0.outputVolume === 'number' ? s0.outputVolume : 1) * 100))
  outSec.appendChild(volume)
  outSec.appendChild(sHint(t('settings.voice.outputHint')))
  volume.addEventListener('input', () => {
    applyVoiceSettings({ outputVolume: sliderValue(volume, 0, 100) / 100 })
  })
  const sounds = sSwitch('set-sounds', t('settings.voice.sounds'), s0.sounds !== false, (checked) => {
    applyVoiceSettings({ sounds: checked })
  }, t('settings.voice.soundsHint'))
  outSec.appendChild(sounds.row)

  buildScreenQualitySection(page)

  fillMicList()
  renderSettingsVoice()
  // Görünüm ilk açılışta katman kurulmadan önce çizilir, ekran bölümü ayrıca hazırlanır
  renderScreenQuality()
  startLevelLoop()
  return {
    update: renderSettingsVoice,
    signature: () => {
      const s = voiceSettings()
      return (s ? JSON.stringify(s) : '') + '|' + JSON.stringify(screenQuality())
    }
  }
}

// Ekran paylaşımı kalitesi (Ek L1.4): içerik önceliği ve çözünürlük/kare hızı ön ayarı. Tercih bu
// cihazda telsiz.screenQuality olarak saklanır, voice.js'e paylaşım varsayılanı olarak verilir ve
// paylaşım sürüyorsa hemen uygulanır.

function screenQuality () {
  const stored = storeGetJson(SETTINGS_KEYS.screenQuality, null)
  const base = voice && typeof voice.screenSettings === 'function' ? safeCall(() => voice.screenSettings(), null) : null
  const pick = (key, list) => {
    if (stored && list.indexOf(stored[key]) !== -1) return stored[key]
    if (base && list.indexOf(base[key]) !== -1) return base[key]
    return SCREEN_DEFAULT[key]
  }
  return { hint: pick('hint', SCREEN_HINT_CHOICES), preset: pick('preset', SCREEN_PRESET_CHOICES) }
}

function saveScreenQuality (patch) {
  const next = Object.assign(screenQuality(), patch)
  storeSetJson(SETTINGS_KEYS.screenQuality, next)
  if (voice && typeof voice.setScreenSettings === 'function') {
    safeCall(() => voice.setScreenSettings({ hint: next.hint, preset: next.preset }), null)
  }
  if (voice && typeof voice.setScreenQuality === 'function') {
    let pending = null
    try {
      pending = voice.setScreenQuality({ hint: next.hint, preset: next.preset })
    } catch (err) {
      pending = null
    }
    Promise.resolve(pending).catch(() => {})
  }
  return next
}

// Bu cihaz ekran paylaşımı başlatabilir mi (voice.js özellik algılaması)
function screenShareSupported () {
  const factory = window.VoiceClient
  const probe = voice && typeof voice.screenSupport === 'function' ? voice : factory && typeof factory.screenSupport === 'function' ? factory : null
  if (!probe) return false
  const result = safeCall(() => probe.screenSupport(), null)
  return Boolean(result && result.share)
}

function screenPresetLabel (id) {
  const m = /^(\d+)p(\d+)$/.exec(id)
  return m ? t('settings.screen.presetLabel', { res: m[1] + 'p', fps: formatNumber(Number(m[2])) }) : id
}

function buildScreenQualitySection (page) {
  const sec = sSection(page, t('settings.screen.title'), 'set-screen-section')
  sec.appendChild(sHint(t('settings.screen.lead'), 'set-screen-lead'))
  const unsupported = h('p', 'settings-note')
  unsupported.id = 'set-screen-unsupported'
  unsupported.textContent = t('settings.screen.unsupported')
  unsupported.hidden = true
  sec.appendChild(unsupported)
  const current = screenQuality()
  sSub(sec, t('settings.screen.hintTitle'), 'set-screen-hint-title')
  const hints = sRadios('set-screen-hint', 'set-screen-hint-title', [
    { value: 'motion', label: t('settings.screen.motion'), hint: t('settings.screen.motionHint') },
    { value: 'detail', label: t('settings.screen.detail'), hint: t('settings.screen.detailHint') }
  ], current.hint, (value) => {
    saveScreenQuality({ hint: value })
  })
  sec.appendChild(hints.group)
  sSub(sec, t('settings.screen.presetTitle'), 'set-screen-preset-title')
  const presets = sRadios('set-screen-preset', 'set-screen-preset-title', SCREEN_PRESET_CHOICES.map((id) => ({
    value: id,
    label: id === SCREEN_DEFAULT.preset ? t('settings.screen.presetDefault', { label: screenPresetLabel(id) }) : screenPresetLabel(id)
  })), current.preset, (value) => {
    saveScreenQuality({ preset: value })
  }, 'is-chips')
  sec.appendChild(presets.group)
  sec.appendChild(sHint(t('settings.screen.bandwidthHint'), 'set-screen-bandwidth'))
}

function renderScreenQuality () {
  const motion = byId('set-screen-hint-motion')
  if (!motion) return
  const q = screenQuality()
  const supported = screenShareSupported()
  byId('set-screen-unsupported').hidden = supported
  const inputs = {}
  SCREEN_HINT_CHOICES.forEach((v) => {
    inputs[v] = byId('set-screen-hint-' + v)
  })
  setRadioValue(inputs, q.hint)
  const presetInputs = {}
  SCREEN_PRESET_CHOICES.forEach((v) => {
    presetInputs[v] = byId('set-screen-preset-' + v)
  })
  setRadioValue(presetInputs, q.preset)
  Object.keys(inputs).concat(Object.keys(presetInputs)).forEach((key) => {
    const node = inputs[key] || presetInputs[key]
    node.disabled = !supported
  })
}

function renderSettingsVoice () {
  if (!isSettingsTab('voice')) return
  const problem = voiceSupportCode()
  setMsg(byId('set-voice-support'), problem && problem !== 'no_key' ? voiceErrorText(problem, '') : '', 'error')
  const settings = voiceSettings()
  const enabled = Boolean(settings)
  const mode = settings && settings.inputMode === 'ptt' ? 'ptt' : 'vad'
  const vad = byId('set-mode-vad')
  const ptt = byId('set-mode-ptt')
  if (vad && ptt) {
    vad.checked = mode === 'vad'
    ptt.checked = mode === 'ptt'
    vad.disabled = !enabled
    ptt.disabled = !enabled
    vad.parentNode.classList.toggle('is-selected', mode === 'vad')
    ptt.parentNode.classList.toggle('is-selected', mode === 'ptt')
  }
  const toggle = (id, disabled) => {
    const node = byId(id)
    if (node) node.disabled = disabled
    return node
  }
  toggle('set-mic', !enabled)
  toggle('set-mic-refresh', !enabled)
  byId('set-vad-wrap').hidden = mode !== 'vad'
  byId('set-ptt-wrap').hidden = mode !== 'ptt'
  const auto = !settings || settings.vadAuto !== false
  const autoBox = toggle('set-vad-auto', !enabled)
  autoBox.checked = auto
  const threshold = toggle('set-vad-threshold', !enabled || auto)
  const thresholdValue = settings && typeof settings.vadThreshold === 'number' ? settings.vadThreshold : -50
  if (document.activeElement !== threshold) threshold.value = String(thresholdValue)
  const release = toggle('set-ptt-release', !enabled)
  const releaseValue = settings && typeof settings.pttReleaseMs === 'number' ? settings.pttReleaseMs : 200
  if (document.activeElement !== release) release.value = String(releaseValue)
  byId('set-ptt-release-value').textContent = t('settings.voice.msValue', { value: formatNumber(releaseValue) })
  const capturing = Boolean(settingsUi.capture && settingsUi.capture.action === 'ptt')
  const change = toggle('set-ptt-change', !enabled)
  change.textContent = t(capturing ? 'common.cancel' : 'settings.voice.changeKey')
  byId('set-ptt-key').textContent = capturing ? t('settings.keybinds.waiting') : bindingText(settings && settings.bindings ? settings.bindings.ptt : null)
  const switches = [['set-echo', 'echoCancellation'], ['set-noise', 'noiseSuppression'], ['set-agc', 'autoGainControl'], ['set-sounds', 'sounds']]
  switches.forEach((p) => {
    const node = toggle(p[0], !enabled)
    node.checked = !settings || settings[p[1]] !== false
  })
  const volume = toggle('set-output-volume', !enabled)
  const out = settings && typeof settings.outputVolume === 'number' ? settings.outputVolume : 1
  if (document.activeElement !== volume) volume.value = String(Math.round(out * 100))
  byId('set-output-volume-value').textContent = formatPercent(Math.round(out * 100))
  const test = toggle('set-mic-test', !voice || (problem !== null && problem !== 'no_key'))
  const testing = Boolean(snap().testing)
  test.setAttribute('aria-pressed', testing ? 'true' : 'false')
  setButtonText(test, t(testing ? 'settings.voice.testStop' : 'settings.voice.testStart'))
  updateLevelMeter()
  renderScreenQuality()
}

// dBFS değerini (-100..0) çubuktaki yüzdeye çevirir
function dbPercent (db) {
  if (typeof db !== 'number' || !isFinite(db)) return 0
  return Math.max(0, Math.min(100, db + 100))
}

// Seviye çubuğu, eşik işareti ve eşik değeri. Mikrofon testinde veya seste iken dolar.
function updateLevelMeter () {
  if (!isSettingsTab('voice')) return
  const bar = byId('set-level-bar')
  if (!bar) return
  let s = snap()
  if (voice && (s.testing || s.channelId)) {
    try {
      s = voice.snapshot() || s
    } catch (err) {
      // Son bilinen durum kullanılır
    }
  }
  const settings = voiceSettings()
  const measuring = Boolean(s.channelId || s.testing) && typeof s.level === 'number'
  const pct = measuring ? dbPercent(s.level) : 0
  bar.style.width = pct + '%'
  bar.classList.toggle('is-speaking', Boolean(measuring && s.gateOpen))
  const meter = byId('set-level-meter')
  meter.setAttribute('aria-valuenow', String(measuring ? Math.round(s.level) : -100))
  meter.setAttribute('aria-valuetext', measuring ? t('settings.voice.dbValue', { value: formatNumber(Math.round(s.level)) }) : t('settings.voice.levelNone'))
  const mark = byId('set-level-threshold')
  const showThreshold = s.inputMode !== 'ptt' && typeof s.threshold === 'number'
  mark.hidden = !showThreshold
  if (showThreshold) mark.style.left = dbPercent(s.threshold) + '%'
  const note = s.testing ? 'settings.voice.levelTesting' : s.channelId ? 'settings.voice.levelSpeaking' : 'settings.voice.levelIdle'
  byId('set-level-note').textContent = t(note)
  const auto = !settings || settings.vadAuto !== false
  const valueNode = byId('set-vad-threshold-value')
  if (auto) {
    valueNode.textContent = typeof s.threshold === 'number'
      ? t('settings.voice.autoValue', { value: formatNumber(Math.round(s.threshold)) })
      : t('settings.voice.auto')
  } else {
    const value = settings && typeof settings.vadThreshold === 'number' ? settings.vadThreshold : -50
    valueNode.textContent = t('settings.voice.dbValue', { value: formatNumber(value) })
  }
}

// Akıcı seviye çubuğu için ses sayfası açıkken kare döngüsü
function startLevelLoop () {
  stopLevelLoop()
  const step = (time) => {
    settingsUi.levelFrame = 0
    if (!isSettingsTab('voice')) return
    if (!time || time - settingsUi.levelAt >= LEVEL_FRAME_MS) {
      settingsUi.levelAt = time || 0
      const s = snap()
      if (s.testing || s.channelId) updateLevelMeter()
    }
    settingsUi.levelFrame = window.requestAnimationFrame ? window.requestAnimationFrame(step) : setTimeout(step, LEVEL_FRAME_MS)
  }
  settingsUi.levelFrame = window.requestAnimationFrame ? window.requestAnimationFrame(step) : setTimeout(step, LEVEL_FRAME_MS)
}

function stopLevelLoop () {
  if (!settingsUi.levelFrame) return
  if (window.cancelAnimationFrame) window.cancelAnimationFrame(settingsUi.levelFrame)
  clearTimeout(settingsUi.levelFrame)
  settingsUi.levelFrame = 0
}

// Mikrofon testi: seste değilken de mikrofonu açar, sesi eşlere ve hoparlöre vermez
function toggleSettingsMicTest () {
  if (!voice) return
  if (snap().testing) {
    stopSettingsMicTest()
    renderSettingsVoice()
    return
  }
  const msg = byId('set-mic-test-msg')
  setMsg(msg, '')
  settingsUi.micTest = true
  let pending = null
  try {
    pending = voice.startMicTest()
  } catch (err) {
    pending = Promise.reject(err)
  }
  Promise.resolve(pending).then(() => {
    if (!isSettingsTab('voice')) {
      stopSettingsMicTest()
      return
    }
    renderSettingsVoice()
  }, (err) => {
    settingsUi.micTest = false
    const code = err && typeof err.code === 'string' ? err.code : 'mic_failed'
    setMsg(byId('set-mic-test-msg'), () => voiceErrorText(code, ''), 'error')
    renderSettingsVoice()
  })
  renderSettingsVoice()
}

function stopSettingsMicTest () {
  settingsUi.micTest = false
  if (!voice) return
  try {
    voice.stopMicTest()
  } catch (err) {
    // Test zaten durmuş
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
  const select = byId('set-mic')
  if (!select) return
  const settings = voiceSettings()
  const current = settings && typeof settings.inputDeviceId === 'string' ? settings.inputDeviceId : ''
  clear(select)
  const def = h('option', '', t('settings.voice.defaultMic'))
  def.value = ''
  select.appendChild(def)
  let n = 0
  const list = Array.isArray(devices) ? devices : []
  list.forEach((d) => {
    if (!d || typeof d.deviceId !== 'string' || d.deviceId === '' || d.deviceId === 'default') return
    n += 1
    const index = typeof d.index === 'number' && d.index > 0 ? d.index : n
    const opt = h('option', '', d.label ? d.label : t('settings.voice.micUnnamed', { n: index }))
    opt.value = d.deviceId
    select.appendChild(opt)
  })
  select.value = current
  if (select.value !== current) select.value = ''
}

// Tuş yakalama (Ses ve Tuş atamaları sayfaları): sonraki klavye tuşu, fare orta veya yan tuşu ya da
// oyun kolu düğmesi. Esc veya 10 sn zaman aşımı yakalamayı iptal eder, Esc ayarları kapatmaz.
// onState(phase, binding): 'capturing', 'set' veya 'cancelled'
function startBindingCapture (action, onState) {
  if (!voice) return
  cancelBindingCapture()
  const token = {}
  settingsUi.capture = { action: action, token: token }
  onState('capturing', null)
  let pending = null
  try {
    pending = voice.captureBinding()
  } catch (err) {
    pending = null
  }
  Promise.resolve(pending).then((binding) => {
    if (!settingsUi.capture || settingsUi.capture.token !== token) return
    settingsUi.capture = null
    if (binding) {
      const bindings = {}
      bindings[action] = binding
      applyVoiceSettings({ bindings: bindings })
      onState('set', binding)
    } else {
      onState('cancelled', null)
    }
  }, () => {
    if (!settingsUi.capture || settingsUi.capture.token !== token) return
    settingsUi.capture = null
    onState('cancelled', null)
  })
}

function cancelBindingCapture () {
  if (!settingsUi.capture) return
  settingsUi.capture = null
  if (!voice) return
  try {
    voice.cancelCapture()
  } catch (err) {
    // Yakalama zaten bitmiş
  }
}

// 5. Tuş atamaları: Bas konuş, Mikrofonu aç/kapat, Sağırlaştır

function sameBinding (a, b) {
  if (!a || !b || a.type !== b.type) return false
  if (a.type === 'key') return a.code === b.code
  return a.button === b.button
}

function buildKeybindsPage (page) {
  page.appendChild(h('p', 'settings-note settings-note-strong', t('settings.voice.focusNote')))
  const modeLine = h('p', 'settings-text')
  modeLine.id = 'set-bind-mode'
  page.appendChild(modeLine)
  const modeRow = sActions(page)
  modeRow.appendChild(sButton('button button-secondary', t('settings.keybinds.openVoice'), 'set-bind-open-voice', () => {
    showSettingsCat('voice', 'title')
  }, 'i-mic'))
  const list = h('ul', 'plain-list settings-binds')
  list.id = 'set-binds'
  list.setAttribute('aria-label', t('settings.cat.keybinds'))
  page.appendChild(list)
  BIND_ACTIONS.forEach((action) => {
    const li = h('li', 'settings-bind-row')
    li.id = 'set-bind-' + action
    li.setAttribute('data-action', action)
    const text = h('div', 'settings-bind-text')
    const name = h('span', 'settings-bind-name', t('settings.keybinds.' + action))
    name.id = 'set-bind-' + action + '-name'
    text.appendChild(name)
    text.appendChild(h('span', 'settings-bind-hint', t('settings.keybinds.' + action + 'Hint')))
    li.appendChild(text)
    const key = h('kbd', 'kbd settings-kbd settings-bind-key')
    key.id = 'set-bind-' + action + '-key'
    li.appendChild(key)
    const actions = h('div', 'row-actions settings-bind-actions')
    const assign = sButton('button button-small button-secondary act-assign', t('settings.keybinds.assign'), 'set-bind-' + action + '-assign')
    assign.setAttribute('aria-describedby', name.id + ' ' + key.id)
    actions.appendChild(assign)
    if (action !== 'ptt') {
      const clearBtn = sButton('button button-small button-ghost act-clear', t('settings.keybinds.clear'), 'set-bind-' + action + '-clear')
      clearBtn.setAttribute('aria-describedby', name.id)
      clearBtn.addEventListener('click', () => {
        const bindings = {}
        bindings[action] = null
        applyVoiceSettings({ bindings: bindings })
        setMsg(byId('set-bind-msg'), () => t('settings.keybinds.cleared', { action: t('settings.keybinds.' + action) }), 'ok')
        focusNode(assign)
      })
      actions.appendChild(clearBtn)
    }
    li.appendChild(actions)
    const status = h('p', 'settings-bind-status')
    status.id = 'set-bind-' + action + '-status'
    status.setAttribute('aria-live', 'polite')
    status.hidden = true
    li.appendChild(status)
    assign.addEventListener('click', () => {
      if (settingsUi.capture && settingsUi.capture.action === action) {
        cancelBindingCapture()
        renderKeybinds()
        return
      }
      startBindingCapture(action, (phase, binding) => {
        if (phase === 'set') setMsg(byId('set-bind-msg'), () => t('settings.keybinds.assigned', { action: t('settings.keybinds.' + action), key: bindingText(binding) }), 'ok')
        else if (phase === 'capturing') setMsg(byId('set-bind-msg'), '')
        renderKeybinds()
      })
    })
    list.appendChild(li)
  })
  page.appendChild(sMsg('set-bind-msg'))
  page.appendChild(sHint(t('settings.keybinds.conflictHint')))
  // Masaüstü uygulamasının genel kısayolları (20-desktop.js): tarayıcıda çağrı false döner ve kap kaldırılır
  desktopSettingsBox(page, 'set-desktop-shortcuts', 'renderShortcutSettings')
  renderKeybinds()
  return {
    update: renderKeybinds,
    signature: () => {
      const s = voiceSettings()
      return s ? JSON.stringify(s.bindings) + s.inputMode : ''
    }
  }
}

function renderKeybinds () {
  if (!isSettingsTab('keybinds')) return
  const settings = voiceSettings()
  const bindings = settings && settings.bindings ? settings.bindings : {}
  const mode = settings && settings.inputMode === 'ptt' ? 'ptt' : 'vad'
  byId('set-bind-mode').textContent = t(mode === 'ptt' ? 'settings.keybinds.modePtt' : 'settings.keybinds.modeVad')
  BIND_ACTIONS.forEach((action) => {
    const capturing = Boolean(settingsUi.capture && settingsUi.capture.action === action)
    const binding = bindings[action] || null
    const key = byId('set-bind-' + action + '-key')
    key.textContent = capturing ? t('settings.keybinds.waiting') : bindingText(binding)
    key.classList.toggle('is-empty', !binding && !capturing)
    const assign = byId('set-bind-' + action + '-assign')
    assign.disabled = !voice
    assign.textContent = t(capturing ? 'common.cancel' : 'settings.keybinds.assign')
    assign.setAttribute('aria-pressed', capturing ? 'true' : 'false')
    const clearBtn = byId('set-bind-' + action + '-clear')
    if (clearBtn) clearBtn.disabled = !binding || capturing || !voice
    const row = byId('set-bind-' + action)
    row.classList.toggle('is-capturing', capturing)
    const status = byId('set-bind-' + action + '-status')
    let text = ''
    if (capturing) text = t('settings.keybinds.capturePrompt')
    else if (action !== 'ptt' && binding && sameBinding(binding, bindings.ptt)) text = t('settings.keybinds.samePtt')
    status.textContent = text
    status.hidden = !text
  })
}

// 6. Bildirimler: masaüstü bildirimi izni, bildirim düzeyi ve mesaj sesi

function notifyLevel () {
  const value = storeGet(SETTINGS_KEYS.notifyLevel)
  return NOTIFY_LEVELS.indexOf(value) !== -1 ? value : 'mentions'
}

function notificationPermission () {
  const N = window.Notification
  if (typeof N !== 'function') return 'unsupported'
  if (window.isSecureContext === false) return 'insecure'
  const p = N.permission
  return p === 'granted' || p === 'denied' ? p : 'default'
}

function buildNotificationsPage (page) {
  const dnd = h('p', 'notice settings-notice settings-notice-info', t('settings.notify.dndActive'))
  dnd.id = 'set-dnd-active'
  page.appendChild(dnd)

  // Masaüstü bildirimleri
  const deskSec = sSection(page, t('settings.notify.desktopTitle'), 'set-desktop-section')
  const deskMsg = sMsg('set-notify-msg')
  const desk = sSwitch('set-notify', t('settings.notify.desktop'), notificationsEnabled(), (checked, input) => {
    onDesktopNotifyChange(checked, input, deskMsg)
  }, t('settings.notify.desktopHint'))
  deskSec.appendChild(desk.row)
  const stateLine = h('p', 'settings-state')
  stateLine.id = 'set-notify-state'
  deskSec.appendChild(stateLine)
  deskSec.appendChild(deskMsg)

  // Bildirim düzeyi
  const levelSec = sSection(page, t('settings.notify.levelTitle'), 'set-level-choice-section')
  const levels = sRadios('set-notify-level', 'set-level-choice-section-title', [
    { value: 'all', label: t('settings.notify.levelAll'), hint: t('settings.notify.levelAllHint') },
    { value: 'mentions', label: t('settings.notify.levelMentions'), hint: t('settings.notify.levelMentionsHint') },
    { value: 'none', label: t('settings.notify.levelNone'), hint: t('settings.notify.levelNoneHint') }
  ], notifyLevel(), (value) => {
    storeSet(SETTINGS_KEYS.notifyLevel, value)
  })
  levelSec.appendChild(levels.group)

  // Mesaj sesi
  const soundSec = sSection(page, t('settings.notify.soundTitle'), 'set-sound-section')
  const sound = sSwitch('set-message-sound', t('settings.notify.sound'), messageSoundEnabled(), (checked) => {
    storeSet(SETTINGS_KEYS.messageSound, checked ? '1' : '0')
  }, t('settings.notify.soundHint'))
  soundSec.appendChild(sound.row)
  const soundRow = sActions(soundSec)
  const soundMsg = sMsg('set-sound-msg')
  soundRow.appendChild(sButton('button button-secondary', t('settings.notify.soundTest'), 'set-sound-test', () => {
    const ok = playMessageSound({ test: true })
    setMsg(soundMsg, ok ? '' : () => t('settings.notify.soundUnsupported'), ok ? '' : 'error')
  }, 'i-bell'))
  soundSec.appendChild(soundMsg)
  page.appendChild(sHint(t('settings.notify.dndNote'), 'set-dnd-note'))

  const update = () => {
    const perm = notificationPermission()
    stateLine.textContent = t('settings.notify.state.' + perm)
    stateLine.setAttribute('data-state', perm)
    if (!desk.input.disabled) desk.input.checked = notificationsEnabled()
    desk.input.disabled = perm === 'unsupported' || perm === 'insecure'
    setRadioValue(levels.inputs, notifyLevel())
    sound.input.checked = messageSoundEnabled()
    dnd.hidden = safeCall(() => myChosenStatus(), 'online') !== 'dnd'
  }
  update()
  return { update: update, signature: () => [notificationPermission(), notificationsEnabled(), notifyLevel(), messageSoundEnabled(), safeCall(() => myChosenStatus(), '')].join('|') }
}

function onDesktopNotifyChange (checked, input, msg) {
  if (!checked) {
    storeSet(KEYS.notify, '0')
    setMsg(msg, () => t('settings.notify.disabled'))
    updateSettingsPage()
    return
  }
  const N = window.Notification
  if (typeof N !== 'function') {
    input.checked = false
    setMsg(msg, () => t('settings.notify.unsupported'), 'error')
    return
  }
  let finished = false
  const done = (permission) => {
    if (finished) return
    finished = true
    if (permission === 'granted') {
      storeSet(KEYS.notify, '1')
      input.checked = true
      setMsg(msg, () => t('settings.notify.enabled'), 'ok')
    } else {
      storeSet(KEYS.notify, '0')
      input.checked = false
      setMsg(msg, () => t('settings.notify.denied'), 'error')
    }
    updateSettingsPage()
  }
  if (N.permission === 'granted') {
    done('granted')
    return
  }
  if (N.permission === 'denied') {
    done('denied')
    return
  }
  try {
    const result = N.requestPermission(done)
    if (result && typeof result.then === 'function') result.then(done, () => done('denied'))
  } catch (err) {
    done('denied')
  }
}

// Mesaj sesi: sayfa gizliyken başkasının mesajında kısa bip (WebAudio). Çağıran taraf sayfanın
// gizli olduğunu, mesajın başkasının olduğunu ve bildirim düzeyini denetler. Burada yalnızca ayar ve
// Rahatsız etmeyin durumu denetlenir. opts.test ayar sayfasındaki "Sesi dene" içindir.

const messageSound = { ctx: null, timer: 0 }

function messageSoundEnabled () {
  return storeGet(SETTINGS_KEYS.messageSound) !== '0'
}

function soundContext () {
  if (messageSound.ctx) return messageSound.ctx
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (typeof Ctx !== 'function') return null
  try {
    messageSound.ctx = new Ctx()
  } catch (err) {
    messageSound.ctx = null
  }
  return messageSound.ctx
}

// İlk kullanıcı etkileşiminde ses bağlamı hazırlanır, sonra boşta beklerken askıya alınır
function unlockMessageSound () {
  const ctx = soundContext()
  if (!ctx || typeof ctx.resume !== 'function') return
  try {
    ctx.resume().then(() => {
      sleepMessageSound(1000)
    }, () => {})
  } catch (err) {
    // Tarayıcı izin vermedi
  }
}

function sleepMessageSound (ms) {
  clearTimeout(messageSound.timer)
  messageSound.timer = setTimeout(() => {
    const ctx = messageSound.ctx
    if (ctx && ctx.state === 'running' && typeof ctx.suspend === 'function') {
      try {
        ctx.suspend().catch(() => {})
      } catch (err) {
        // Askıya alınamadı
      }
    }
  }, ms)
}

function playMessageSound (opts) {
  const test = Boolean(opts && opts.test)
  if (!test) {
    if (!messageSoundEnabled()) return false
    if (safeCall(() => myChosenStatus(), 'online') === 'dnd') return false
  }
  const ctx = soundContext()
  if (!ctx) return false
  const play = () => {
    try {
      const now = ctx.currentTime
      const gain = ctx.createGain()
      gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.0001, now)
      gain.gain.exponentialRampToValueAtTime(0.09, now + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24)
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, now)
      osc.frequency.setValueAtTime(1175, now + 0.09)
      osc.connect(gain)
      osc.onended = () => {
        try {
          osc.disconnect()
          gain.disconnect()
        } catch (err) {
          // Zaten ayrılmış
        }
      }
      osc.start(now)
      osc.stop(now + 0.26)
      sleepMessageSound(1500)
    } catch (err) {
      window.console.error(err)
    }
  }
  if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
    try {
      ctx.resume().then(play, () => {})
    } catch (err) {
      return false
    }
  } else {
    play()
  }
  return true
}

// 7. Görünüm: tema, mod, yazı boyutu, kompakt görünüm, hareketi azalt ve dil (TelsizTheme)

function themeState () {
  const theme = window.TelsizTheme
  if (!theme || typeof theme.get !== 'function') return { skin: 'arcade', scheme: 'system', fontSize: 'normal', fontPx: FONT_PX_RANGE.initial, compact: false, reduceMotion: 'system' }
  return theme.get()
}

function setTheme (patch) {
  const theme = window.TelsizTheme
  if (!theme || typeof theme.set !== 'function') return
  theme.set(patch)
}

function buildAppearancePage (page) {
  const current = themeState()

  // Tema kartları
  const skinSec = sSection(page, t('theme.title'), 'set-skin-section')
  const cards = h('div', 'settings-theme-cards')
  cards.setAttribute('role', 'radiogroup')
  cards.setAttribute('aria-labelledby', 'set-skin-section-title')
  const skinInputs = {}
  SKIN_CHOICES.forEach((skin) => {
    const card = h('label', 'theme-card settings-theme-card')
    card.setAttribute('for', 'set-skin-' + skin)
    card.setAttribute('data-skin-choice', skin)
    const swatch = h('span', 'theme-swatch theme-swatch-' + skin)
    swatch.setAttribute('aria-hidden', 'true')
    let n = 0
    while (n < 4) {
      swatch.appendChild(h('span'))
      n += 1
    }
    card.appendChild(swatch)
    const row = h('span', 'settings-theme-row')
    const input = h('input', 'settings-radio-input')
    input.type = 'radio'
    input.name = 'set-skin'
    input.id = 'set-skin-' + skin
    input.value = skin
    const hintId = 'set-skin-' + skin + '-hint'
    input.setAttribute('aria-describedby', hintId)
    row.appendChild(input)
    row.appendChild(h('span', 'theme-name', t('theme.skin.' + skin)))
    card.appendChild(row)
    const hint = h('span', 'settings-theme-hint', t('theme.skinHint.' + skin))
    hint.id = hintId
    card.appendChild(hint)
    input.addEventListener('change', () => {
      if (input.checked) setTheme({ skin: skin })
    })
    cards.appendChild(card)
    skinInputs[skin] = input
  })
  skinSec.appendChild(cards)

  const modeSec = sSection(page, t('theme.mode'), 'set-scheme-section')
  const schemes = sRadios('set-scheme', 'set-scheme-section-title', SCHEME_CHOICES.map((v) => ({ value: v, label: t('theme.scheme.' + v) })), current.scheme, (value) => {
    setTheme({ scheme: value })
  }, 'is-chips')
  modeSec.appendChild(schemes.group)
  modeSec.appendChild(sHint(t('settings.appearance.schemeHint')))

  const sizeSec = sSection(page, t('theme.fontSize'), 'set-font-section')
  const sizes = sRadios('set-font', 'set-font-section-title', FONT_SIZE_CHOICES.map((v) => ({ value: v, label: t('theme.fontSize.' + v) })), current.fontSize, (value) => {
    setTheme({ fontSize: value })
  }, 'is-chips')
  sizeSec.appendChild(sizes.group)
  // Elle ayar: kaydırıcı Özel boyutu belirler, oynatınca Özel seçilir
  const pxOf = (state) => (typeof state.fontPx === 'number' ? state.fontPx : FONT_PX_RANGE.initial)
  const pxValue = rangeLabel(sizeSec, 'set-font-px', t('theme.fontPx'))
  const pxRange = sRange('set-font-px', FONT_PX_RANGE.min, FONT_PX_RANGE.max, 1, pxOf(current))
  const showPx = (px) => {
    const text = t('theme.fontPxValue', { px: px })
    pxValue.textContent = text
    pxRange.setAttribute('aria-valuetext', text)
  }
  pxRange.addEventListener('input', () => {
    const px = sliderValue(pxRange, FONT_PX_RANGE.min, FONT_PX_RANGE.max)
    showPx(px)
    setTheme({ fontSize: 'custom', fontPx: px })
  })
  sizeSec.appendChild(pxRange)
  showPx(pxOf(current))

  const compactSec = sSection(page, t('settings.appearance.messagesTitle'), 'set-compact-section')
  const compact = sSwitch('set-compact', t('theme.compact'), current.compact, (checked) => {
    setTheme({ compact: checked })
  }, t('theme.compactHint'))
  compactSec.appendChild(compact.row)

  const motionSec = sSection(page, t('theme.reduceMotion'), 'set-motion-section')
  const motions = sRadios('set-motion', 'set-motion-section-title', MOTION_CHOICES.map((v) => ({ value: v, label: t('theme.motion.' + v) })), current.reduceMotion, (value) => {
    setTheme({ reduceMotion: value })
  }, 'is-chips')
  motionSec.appendChild(motions.group)
  motionSec.appendChild(sHint(t('settings.appearance.motionHint')))

  const langSec = sSection(page, t('settings.appearance.language'), 'set-lang-section')
  const langLabel = h('label', 'sr-only', t('settings.appearance.language'))
  langLabel.setAttribute('for', 'set-lang')
  langSec.appendChild(langLabel)
  const lang = h('select', 'input select select-small')
  lang.id = 'set-lang'
  const langs = [['tr', t('settings.appearance.langTr')], ['en', t('settings.appearance.langEn')]]
  langs.forEach((l) => {
    const opt = h('option', '', l[1])
    opt.value = l[0]
    opt.setAttribute('lang', l[0])
    lang.appendChild(opt)
  })
  lang.value = window.I18N.lang
  lang.addEventListener('change', () => {
    changeLanguage(lang.value)
  })
  langSec.appendChild(lang)

  const update = () => {
    const now = themeState()
    SKIN_CHOICES.forEach((skin) => {
      const input = skinInputs[skin]
      input.checked = skin === now.skin
      input.parentNode.parentNode.classList.toggle('is-selected', skin === now.skin)
    })
    setRadioValue(schemes.inputs, now.scheme)
    setRadioValue(sizes.inputs, now.fontSize)
    if (document.activeElement !== pxRange) {
      pxRange.value = String(pxOf(now))
      showPx(pxOf(now))
    }
    compact.input.checked = Boolean(now.compact)
    setRadioValue(motions.inputs, now.reduceMotion)
    if (lang.value !== window.I18N.lang) lang.value = window.I18N.lang
  }
  update()
  return { update: update, signature: () => JSON.stringify(themeState()) + window.I18N.lang }
}

// Tema değişince (12-init.js) açık Görünüm sayfası güncellenir
function refreshThemeSettings () {
  if (isSettingsTab('appearance')) updateSettingsPage()
}

// 8. Uygulama: yükleme, iOS ipucu, sürüm, açık kaynak ve lisans

// Masaüstü uygulamasının ayar bölümleri (20-desktop.js, window.TelsizDesktopUI) için kap. Bölümü modül
// çizer, tarayıcıda çağrı false döner ve kap sayfadan kaldırılır. Dil değişince ayarlar görünümü yeniden
// kurulur ve kap yeniden çizilir (ayrıca settingsOnLanguage TelsizDesktopUI.refresh çağırır).
function desktopSettingsBox (page, id, method) {
  const ui = window.TelsizDesktopUI
  if (!ui || typeof ui[method] !== 'function') return null
  const box = h('div', 'settings-section settings-desktop')
  box.id = id
  page.appendChild(box)
  let drawn = false
  try {
    drawn = ui[method](box) === true
  } catch (err) {
    window.console.error(err)
  }
  if (!drawn) {
    if (box.parentNode) box.parentNode.removeChild(box)
    return null
  }
  return box
}

function buildAppPage (page) {
  // Masaüstü uygulamasında sunucu adresi ve tepsi ayarları en üstte, tarayıcıya özgü yükleme bölümü gizli
  const desktopBox = desktopSettingsBox(page, 'set-desktop-app', 'renderAppSettings')
  const installSec = sSection(page, t('settings.app.installTitle'), 'set-install-section')
  if (desktopBox) installSec.hidden = true
  const installState = h('p', 'settings-text')
  installState.id = 'set-install-state'
  installSec.appendChild(installState)
  const installRow = sActions(installSec)
  const install = sButton('button', t('settings.app.install'), 'set-install', installApp, 'i-download')
  installRow.appendChild(install)
  const ios = sHint(t('settings.app.iosHint'), 'set-ios-hint')
  installSec.appendChild(ios)

  const versionSec = sSection(page, t('settings.app.versionTitle'), 'set-version-section')
  const version = h('p', 'settings-version')
  version.id = 'set-version'
  const v = state.info && typeof state.info.version === 'string' && state.info.version ? state.info.version : ''
  version.textContent = v ? t('settings.app.versionLine', { version: v }) : t('settings.app.versionUnknown')
  versionSec.appendChild(version)

  const ossSec = sSection(page, t('settings.app.sourceTitle'), 'set-source-section')
  ossSec.appendChild(h('p', 'settings-text', t('settings.app.sourceText')))
  const repo = externalLink(REPO_URL.replace(/^https:\/\//, ''), REPO_URL)
  repo.id = 'set-repo-link'
  const repoLine = h('p', 'settings-text')
  repoLine.appendChild(repo)
  ossSec.appendChild(repoLine)
  ossSec.appendChild(h('p', 'settings-text', t('settings.app.license')))
  sSub(ossSec, t('settings.app.thirdParty'), 'set-third-party-title')
  const libs = h('ul', 'plain-list settings-links')
  libs.setAttribute('aria-labelledby', 'set-third-party-title')
  LICENSE_LINKS.forEach((item) => {
    const li = h('li', 'settings-links-item')
    li.appendChild(externalLink(t(item.key), item.href))
    libs.appendChild(li)
  })
  ossSec.appendChild(libs)

  const update = () => {
    const standalone = isStandalone()
    const canPrompt = Boolean(state.installPrompt)
    let key = 'settings.app.installUnavailable'
    if (standalone) key = 'settings.app.installed'
    else if (canPrompt) key = 'settings.app.installReady'
    else if (isIos()) key = 'settings.app.installIos'
    installState.textContent = t(key)
    installRow.hidden = standalone || !canPrompt
    ios.hidden = standalone || !isIos()
  }
  update()
  return { update: update, signature: () => [isStandalone(), Boolean(state.installPrompt)].join('|') }
}

// Yeni sekmede açılan bağlantı. Adres her zaman koddaki sabit değerdir, kullanıcı verisi olamaz.
function externalLink (text, href) {
  const a = h('a', 'settings-link', text)
  a.href = href
  a.target = '_blank'
  a.rel = 'noopener noreferrer'
  a.appendChild(h('span', 'sr-only', ' (' + t('settings.app.newTab') + ')'))
  return a
}

async function installApp () {
  const prompt = state.installPrompt
  if (!prompt) return
  state.installPrompt = null
  updateSettingsPage()
  try {
    prompt.prompt()
    await prompt.userChoice
  } catch (err) {
    // Kullanıcı vazgeçti
  }
}

// Yükleme önerisi gelince veya uygulama yüklenince (12-init.js)
function settingsOnInstallChange () {
  if (isSettingsTab('app')) updateSettingsPage()
}

// 9. Genel: sunucu adı (yalnızca sahip değiştirir) ve sunucu özeti

function buildGeneralPage (page) {
  const nameSec = sSection(page, t('settings.server.name'), 'set-server-section')
  const form = h('form', 'settings-inline-form')
  form.id = 'set-server-form'
  form.noValidate = true
  form.setAttribute('autocomplete', 'off')
  const label = h('label', 'sr-only', t('settings.server.name'))
  label.setAttribute('for', 'set-server-name')
  form.appendChild(label)
  const input = sInput('text')
  input.id = 'set-server-name'
  const max = state.info && state.info.limits && typeof state.info.limits.serverNameMax === 'number' ? state.info.limits.serverNameMax : 40
  input.maxLength = max * 2
  input.setAttribute('spellcheck', 'false')
  input.value = state.serverName
  form.appendChild(input)
  const save = sButton('button', t('common.save'), 'set-server-save')
  save.type = 'submit'
  form.appendChild(save)
  nameSec.appendChild(form)
  const ownerOnly = sHint(t('settings.general.ownerOnly'), 'set-server-owner-only')
  nameSec.appendChild(ownerOnly)
  const msg = sMsg('set-server-msg')
  nameSec.appendChild(msg)
  let dirty = false
  input.addEventListener('input', () => {
    dirty = true
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!isOwner()) return
    const name = normalizeName(input.value)
    if (!name) {
      setMsg(msg, () => t('settings.server.enterName'), 'error')
      focusNode(input)
      return
    }
    save.disabled = true
    const res = await api('POST', '/api/settings', { serverName: name })
    save.disabled = false
    if (res.status === 200) {
      dirty = false
      setMsg(msg, () => t('settings.server.nameSaved'), 'ok')
      return
    }
    setMsg(msg, () => errorText(res, t('settings.server.nameFailed')), 'error')
  })

  // Frekans fotoğrafı (yalnızca sahip): herkese açık resim, amblemlerin, bandın, giriş ekranının ve
  // tanıtım sayfasının yerine baş harfin yerine geçer. Yönetici yalnızca önizlemeyi görür.
  const photo = buildServerIconSection(page)

  // Frekans tanıtımı (yalnızca sahip yazar): herkese açık düz metin, giriş yapmamış ziyaretçinin
  // gördüğü tanıtım sayfasında görünür (26-tanitim.js). Yönetici salt okunur görür.
  const about = buildAboutSection(page)

  // Telsiz DJ (Ek L2.5, yalnızca sahip): DJ'yi tümüyle veya yalnızca YouTube kaynağını kapatma
  const musicSec = sSection(page, t('settings.music.title'), 'set-music-section')
  const musicOn = sSwitch('set-music-enabled', t('settings.music.enabled'), true, (checked, input) => {
    musicSwitchChange('enabled', checked, input)
  }, t('settings.music.enabledHint'))
  musicSec.appendChild(musicOn.row)
  const musicYt = sSwitch('set-music-youtube', t('settings.music.youtube'), true, (checked, input) => {
    musicSwitchChange('youtube', checked, input)
  }, t('settings.music.youtubeHint'))
  musicSec.appendChild(musicYt.row)
  const musicRestricted = sSwitch('set-music-restricted', t('settings.music.restricted'), false, (checked, input) => {
    musicSwitchChange('restricted', checked, input)
  }, t('settings.music.restrictedHint'))
  musicSec.appendChild(musicRestricted.row)
  musicSec.appendChild(sMsg('set-music-msg'))

  // Ses odaları ve kameralar (yalnızca sahip değiştirir, yönetici salt okunur görür)
  const voiceLimits = buildVoiceLimitsSection(page)

  // Sunucu bilgileri ve kapasite önerisi (27-kapasite.js)
  const serverInfo = typeof buildServerInfoSection === 'function' ? buildServerInfoSection(page, voiceLimits.apply) : null

  const sumSec = sSection(page, t('settings.general.summaryTitle'), 'set-summary-section')
  const summary = h('ul', 'plain-list settings-summary')
  summary.id = 'set-server-summary'
  summary.setAttribute('aria-labelledby', 'set-summary-section-title')
  sumSec.appendChild(summary)

  const update = () => {
    const owner = isOwner()
    input.disabled = !owner
    save.hidden = !owner
    ownerOnly.hidden = owner
    if (!dirty && document.activeElement !== input) input.value = state.serverName
    photo.update(owner)
    about.update(owner)
    musicSec.hidden = !owner
    const music = musicServerSettings()
    musicOn.input.checked = music.enabled
    musicYt.input.checked = music.youtube
    musicRestricted.input.checked = music.restricted
    musicOn.input.disabled = !MUSIC_SETTINGS_READY || !owner
    musicYt.input.disabled = !MUSIC_SETTINGS_READY || !owner || !music.enabled
    musicRestricted.input.disabled = !MUSIC_SETTINGS_READY || !owner || !music.enabled
    voiceLimits.update(owner)
    if (serverInfo) serverInfo.update(owner)
    clear(summary)
    const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
    const online = users.filter((u) => u && u.online === true).length
    const rows = [
      t('settings.general.members', { count: users.length }),
      t('settings.general.online', { count: online }),
      t('settings.general.textChannels', { count: textChannels().length }),
      t('settings.general.voiceChannels', { count: voiceChannels().length })
    ]
    rows.forEach((text) => {
      summary.appendChild(h('li', 'settings-summary-item', text))
    })
  }
  update()
  return { update: update }
}

// ------------------------------------------------------------------ ses odaları ve kameralar

// Sınırlar /api/info limits alanından, yoksa sunucunun varsayılan aralıkları
function voiceLimitRange (key, fallback) {
  const l = state.info && state.info.limits ? state.info.limits : null
  return l && typeof l[key] === 'number' ? l[key] : fallback
}

// Ses odası kapasitesi, kameralar açık mı ve oda başına kamera sınırı (meta.voiceSettings). Kaydedilince
// POST /api/settings { voice } gider, yeni değer meta güncellemesiyle bütün açık istemcilere ulaşır.
// Düşürülen kapasite yalnızca yeni katılımlara uygulanır. Dönüş: { update(owner), apply(capacity, cameras) }
function buildVoiceLimitsSection (page) {
  const capMin = voiceLimitRange('voiceCapacityMin', 2)
  const capMax = voiceLimitRange('voiceCapacityMax', 12)
  const camMin = voiceLimitRange('maxCamerasMin', 1)
  const camMax = voiceLimitRange('maxCamerasMax', 12)
  const sec = sSection(page, t('settings.voiceLimits.title'), 'set-voice-limits-section')
  sec.appendChild(sHint(t('settings.voiceLimits.intro'), 'set-voice-limits-intro'))
  const form = h('form', 'settings-voice-limits')
  form.id = 'set-voice-limits-form'
  form.noValidate = true
  form.setAttribute('autocomplete', 'off')
  const capacity = sInput('number', 'settings-number')
  capacity.min = String(capMin)
  capacity.max = String(capMax)
  capacity.step = '1'
  capacity.inputMode = 'numeric'
  sField(form, 'set-voice-capacity', t('settings.voiceLimits.capacity'), capacity, t('settings.voiceLimits.capacityHint', { min: capMin, max: capMax }))
  const cameras = sSwitch('set-voice-cameras', t('settings.voiceLimits.cameras'), true, () => {
    dirty = true
    syncDisabled()
  }, t('settings.voiceLimits.camerasHint'))
  form.appendChild(cameras.row)
  const maxCameras = sInput('number', 'settings-number')
  maxCameras.min = String(camMin)
  maxCameras.max = String(camMax)
  maxCameras.step = '1'
  maxCameras.inputMode = 'numeric'
  sField(form, 'set-voice-max-cameras', t('settings.voiceLimits.maxCameras'), maxCameras, t('settings.voiceLimits.maxCamerasHint', { min: camMin, max: camMax }))
  form.appendChild(sHint(t('settings.voiceLimits.mesh'), 'set-voice-limits-mesh'))
  const actions = sActions(form)
  const save = sButton('button', t('common.save'), 'set-voice-limits-save')
  save.type = 'submit'
  actions.appendChild(save)
  sec.appendChild(form)
  const ownerOnly = sHint(t('settings.voiceLimits.ownerOnly'), 'set-voice-limits-owner-only')
  sec.appendChild(ownerOnly)
  const msg = sMsg('set-voice-limits-msg')
  sec.appendChild(msg)
  let dirty = false
  let owner = false

  const fill = () => {
    const v = voiceServerSettings()
    capacity.value = String(v.capacity)
    cameras.input.checked = v.cameras
    maxCameras.value = String(v.maxCameras)
  }
  const syncDisabled = () => {
    capacity.disabled = !owner
    cameras.input.disabled = !owner
    maxCameras.disabled = !owner || !cameras.input.checked
  }
  const readInt = (input) => {
    const text = String(input.value).trim()
    return /^\d{1,3}$/.test(text) ? Number(text) : NaN
  }
  const numberInputs = [capacity, maxCameras]
  numberInputs.forEach((input) => {
    input.addEventListener('input', () => {
      dirty = true
      setMsg(msg, '')
    })
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!isOwner()) return
    const cap = readInt(capacity)
    const cams = readInt(maxCameras)
    if (!(cap >= capMin && cap <= capMax)) {
      setMsg(msg, () => t('settings.voiceLimits.capacityInvalid', { min: capMin, max: capMax }), 'error')
      focusNode(capacity)
      return
    }
    if (!(cams >= camMin && cams <= camMax) || cams > cap) {
      setMsg(msg, () => t('settings.voiceLimits.maxCamerasInvalid', { min: camMin, max: Math.min(camMax, cap) }), 'error')
      focusNode(maxCameras)
      return
    }
    save.disabled = true
    const body = { voice: { capacity: cap, cameras: cameras.input.checked, maxCameras: cams } }
    const res = await api('POST', '/api/settings', body)
    save.disabled = false
    if (res.status === 200) {
      dirty = false
      if (state.meta) state.meta.voiceSettings = Object.assign({}, body.voice)
      setMsg(msg, () => t('settings.voiceLimits.saved'), 'ok')
      if (typeof renderVoiceAll === 'function' && state.inApp) renderVoiceAll()
      return
    }
    setMsg(msg, () => errorText(res, t('settings.voiceLimits.failed'), { forbidden: t('settings.voiceLimits.ownerOnly') }), 'error')
  })
  fill()
  return {
    update: (isOwnerNow) => {
      owner = Boolean(isOwnerNow)
      const focused = form.contains(document.activeElement)
      if (!dirty && !focused) fill()
      syncDisabled()
      actions.hidden = !owner
      ownerOnly.hidden = owner
    },
    // Öneri uygulanınca alanlar doldurulur, sahip Kaydet ile onaylar
    apply: (cap, cams) => {
      if (!owner) return
      capacity.value = String(cap)
      maxCameras.value = String(Math.min(cams, cap))
      if (!cameras.input.checked) cameras.input.checked = true
      dirty = true
      syncDisabled()
      setMsg(msg, () => t('settings.voiceLimits.appliedNote'))
      focusNode(capacity)
    }
  }
}

// ------------------------------------------------------------------ frekans fotoğrafı

const SERVER_ICON_EDGE = 256

// Açık frekansın fotoğraf adresi (24-frekans.js), yoksa null
function settingsIconUrl () {
  return typeof frekansOwnIconUrl === 'function' ? frekansOwnIconUrl() : null
}

function serverIconLimit () {
  const limits = state.info && state.info.limits ? state.info.limits : null
  const value = limits ? limits.serverIconMaxBytes : null
  return typeof value === 'number' && isFinite(value) && value > 0 ? value : 1024 * 1024
}

// Seçilen resmi ortasından kare kırpar ve 256x256 boyutuna küçültür. Saydamlık olabilecek kaynaklar
// (PNG, WebP, GIF) PNG, fotoğraflar JPEG olur. Yeniden kodlama konum gibi üst verileri siler.
// Sonuç: Uint8Array veya null (çözülemeyen ya da sınıra sığmayan resim)
async function serverIconPrepare (file) {
  let bytes = null
  try {
    bytes = await readBlobBytes(file)
  } catch (err) {
    return null
  }
  const sniffed = window.E2EE.sniffImage(bytes)
  if (!sniffed) return null
  const decoded = await decodeImage(bytes, sniffed)
  if (!decoded) return null
  try {
    const side = Math.min(decoded.w, decoded.h)
    if (!side) return null
    const canvas = document.createElement('canvas')
    canvas.width = SERVER_ICON_EDGE
    canvas.height = SERVER_ICON_EDGE
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    const draw = (opaque) => {
      ctx.clearRect(0, 0, SERVER_ICON_EDGE, SERVER_ICON_EDGE)
      if (opaque) {
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, SERVER_ICON_EDGE, SERVER_ICON_EDGE)
      }
      ctx.drawImage(decoded.image, Math.floor((decoded.w - side) / 2), Math.floor((decoded.h - side) / 2), side, side, 0, 0, SERVER_ICON_EDGE, SERVER_ICON_EDGE)
    }
    const max = serverIconLimit()
    let out = null
    if (sniffed !== 'image/jpeg') {
      draw(false)
      out = await canvasToBytes(canvas, 'image/png')
    }
    if (!out || out.length > max) {
      draw(true)
      out = await canvasToBytes(canvas, 'image/jpeg', JPEG_QUALITY)
    }
    canvas.width = 1
    canvas.height = 1
    const type = window.E2EE.sniffImage(out)
    if ((type !== 'image/png' && type !== 'image/jpeg') || out.length > max) return null
    return out
  } catch (err) {
    return null
  } finally {
    decoded.release()
  }
}

function buildServerIconSection (page) {
  const sec = sSection(page, t('settings.server.photoTitle'), 'set-photo-section')
  const row = h('div', 'settings-avatar-row settings-photo-row')
  const preview = h('div', 'settings-avatar-host settings-photo-host')
  preview.id = 'set-photo-preview'
  row.appendChild(preview)
  const buttons = h('div', 'settings-avatar-buttons')
  const pick = sButton('button button-secondary', t('settings.server.photoPick'), 'set-photo-pick', null, 'i-image')
  const remove = sButton('button button-ghost', t('settings.server.photoRemove'), 'set-photo-remove', null, 'i-trash')
  buttons.appendChild(pick)
  buttons.appendChild(remove)
  row.appendChild(buttons)
  sec.appendChild(row)
  const file = h('input', 'file-input')
  file.type = 'file'
  file.accept = 'image/png,image/jpeg,image/webp,image/gif'
  file.id = 'set-photo-file'
  file.tabIndex = -1
  file.setAttribute('aria-hidden', 'true')
  sec.appendChild(file)
  sec.appendChild(sHint(t('settings.server.photoHint'), 'set-photo-hint'))
  const ownerOnly = sHint(t('settings.server.photoOwnerOnly'), 'set-photo-owner-only')
  sec.appendChild(ownerOnly)
  const msg = sMsg('set-photo-msg')
  sec.appendChild(msg)
  let busy = false
  let shown = ''

  const renderPreview = () => {
    const src = settingsIconUrl() || ''
    const key = src + '|' + state.serverName
    if (key === shown && preview.firstChild) return
    shown = key
    clear(preview)
    let em = null
    if (typeof frekansEmblem === 'function') {
      em = frekansEmblem(state.serverName, src || null)
    } else {
      em = h('span', 'frekans-emblem')
      em.appendChild(h('span', 'emblem-letter', initial(state.serverName)))
      em.setAttribute('aria-hidden', 'true')
    }
    em.classList.add('settings-photo-emblem')
    preview.appendChild(em)
  }

  const applySaved = (hash) => {
    state.serverIcon = hash
    if (state.info) state.info.serverIcon = hash
    renderServerName()
    renderBand()
    renderPreview()
  }

  pick.addEventListener('click', () => {
    if (busy || !isOwner()) return
    file.value = ''
    file.click()
  })
  file.addEventListener('change', async () => {
    const chosen = file.files && file.files[0] ? file.files[0] : null
    file.value = ''
    if (!chosen || busy || !isOwner()) return
    if (chosen.size > AVATAR_SOURCE_MAX) {
      setMsg(msg, () => t('settings.profile.avatarTooBig', { size: formatSize(AVATAR_SOURCE_MAX) }), 'error')
      return
    }
    busy = true
    pick.disabled = true
    remove.disabled = true
    setMsg(msg, () => t('settings.profile.avatarReading'))
    const bytes = await serverIconPrepare(chosen)
    if (!bytes) {
      busy = false
      update(isOwner())
      setMsg(msg, () => t('settings.server.photoInvalid'), 'error')
      return
    }
    const res = await api('POST', '/api/server-icon', null, { binary: bytes })
    busy = false
    const saved = res.status === 200 && res.data && typeof res.data.serverIcon === 'string'
    if (saved) applySaved(res.data.serverIcon)
    update(isOwner())
    if (saved) {
      setMsg(msg, () => t('settings.server.photoSaved'), 'ok')
      if (isConnected(pick)) focusNode(pick)
      return
    }
    setMsg(msg, () => errorText(res, t('settings.server.photoFailed')), 'error')
  })
  remove.addEventListener('click', async () => {
    if (busy || !isOwner()) return
    busy = true
    pick.disabled = true
    remove.disabled = true
    const res = await api('POST', '/api/server-icon/delete', {})
    busy = false
    if (res.status === 200) applySaved(null)
    update(isOwner())
    if (res.status === 200) {
      setMsg(msg, () => t('settings.server.photoRemoved'), 'ok')
      focusNode(pick)
      return
    }
    setMsg(msg, () => errorText(res, t('settings.server.photoFailed')), 'error')
  })

  function update (owner) {
    pick.hidden = !owner
    remove.hidden = !owner || !settingsIconUrl()
    pick.disabled = busy
    remove.disabled = busy
    ownerOnly.hidden = owner
    renderPreview()
  }
  return { update: update }
}

// Frekans tanıtımı sınırları ve metni (GET /api/info: about, limits.aboutMax, limits.aboutMaxLines)
function aboutLimit (key, fallback) {
  const limits = state.info && state.info.limits ? state.info.limits : null
  const value = limits ? limits[key] : null
  return typeof value === 'number' && isFinite(value) && value > 0 ? value : fallback
}

function aboutServerText () {
  return state.info && typeof state.info.about === 'string' ? state.info.about : ''
}

// Sunucudaki temizliğin yaklaşığı (sayaç için): satır başına denetim karakterleri silinir, boşluklar
// teklenir ve kırpılır, art arda boş satırlar teke iner. Asıl denetim sunucudadır.
function aboutClean (value) {
  const kept = []
  String(value || '').split(/\r\n|\r|\n/).forEach((line) => {
    const text = line.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff]/g, '').replace(/\s+/g, ' ').trim()
    if (text === '' && (kept.length === 0 || kept[kept.length - 1] === '')) return
    kept.push(text)
  })
  while (kept.length > 0 && kept[kept.length - 1] === '') kept.pop()
  return { text: kept.join('\n'), lines: kept.length }
}

function buildAboutSection (page) {
  const max = aboutLimit('aboutMax', 600)
  const maxLines = aboutLimit('aboutMaxLines', 6)
  const sec = sSection(page, t('settings.general.aboutTitle'), 'set-about-section')
  const form = h('form', 'settings-about-form')
  form.id = 'set-about-form'
  form.noValidate = true
  form.setAttribute('autocomplete', 'off')
  const label = h('label', 'sr-only', t('settings.general.aboutLabel'))
  label.setAttribute('for', 'set-about')
  form.appendChild(label)
  const input = h('textarea', 'input settings-textarea')
  input.id = 'set-about'
  input.rows = 4
  input.maxLength = max * 4
  input.setAttribute('placeholder', t('settings.general.aboutPlaceholder'))
  input.value = aboutServerText()
  form.appendChild(input)
  const counter = h('p', 'settings-counter')
  counter.id = 'set-about-counter'
  form.appendChild(counter)
  const hint = sHint(t('settings.general.aboutHint'), 'set-about-hint')
  form.appendChild(hint)
  input.setAttribute('aria-describedby', 'set-about-counter set-about-hint')
  const actions = sActions(form)
  const save = sButton('button', t('common.save'), 'set-about-save')
  save.type = 'submit'
  actions.appendChild(save)
  sec.appendChild(form)
  const ownerOnly = sHint(t('settings.general.aboutOwnerOnly'), 'set-about-owner-only')
  sec.appendChild(ownerOnly)
  const msg = sMsg('set-about-msg')
  sec.appendChild(msg)
  let dirty = false
  const measure = () => {
    const cleaned = aboutClean(input.value)
    const len = cpLength(cleaned.text)
    counter.textContent = t('settings.general.aboutCounter', { count: formatNumber(len), max: formatNumber(max), lines: formatNumber(maxLines) })
    const over = len > max || cleaned.lines > maxLines
    counter.classList.toggle('is-over', over)
    return { text: cleaned.text, over: over }
  }
  input.addEventListener('input', () => {
    dirty = true
    measure()
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!isOwner()) return
    const m = measure()
    if (m.over) {
      setMsg(msg, () => t('settings.general.aboutTooLong', { max: formatNumber(max), lines: formatNumber(maxLines) }), 'error')
      focusNode(input)
      return
    }
    save.disabled = true
    const res = await api('POST', '/api/settings', { about: input.value })
    save.disabled = false
    if (res.status === 200) {
      dirty = false
      if (state.info) state.info.about = m.text
      input.value = m.text
      measure()
      setMsg(msg, () => t('settings.general.aboutSaved'), 'ok')
      return
    }
    setMsg(msg, () => errorText(res, t('settings.general.aboutFailed')), 'error')
  })
  // Başka cihazda yapılan değişiklik için güncel metin bir kez sorulur
  api('GET', '/api/info').then((res) => {
    if (!res || res.status !== 200 || !res.data || typeof res.data.about !== 'string') return
    if (state.info) state.info.about = res.data.about
    if (!dirty && document.activeElement !== input) {
      input.value = res.data.about
      measure()
    }
  })
  const update = (owner) => {
    input.readOnly = !owner
    input.classList.toggle('textarea-readonly', !owner)
    actions.hidden = !owner
    ownerOnly.hidden = owner
    if (!dirty && document.activeElement !== input) input.value = aboutServerText()
    measure()
  }
  return { update: update }
}

// Sunucunun Telsiz DJ ayarı (meta.music: { enabled, youtube, restricted }, varsayılan ilk ikisi açık,
// kısıtlı kip kapalı)
function musicServerSettings () {
  const m = state.meta && state.meta.music && typeof state.meta.music === 'object' ? state.meta.music : null
  const enabled = !m || m.enabled !== false
  return { enabled: enabled, youtube: enabled && (!m || m.youtube !== false), restricted: Boolean(m && m.restricted === true) }
}

function musicSwitchOkKey (field, checked) {
  if (field === 'enabled') return checked ? 'dj.settings.enabledOn' : 'dj.settings.enabledOff'
  if (field === 'restricted') return checked ? 'dj.settings.restrictedOn' : 'dj.settings.restrictedOff'
  return checked ? 'dj.settings.youtubeOn' : 'dj.settings.youtubeOff'
}

// Anahtar değişince POST /api/settings { music: { <alan>: değer } } gönderilir. Başarısızlıkta anahtar
// sunucudaki değere döner. Yeni değer meta güncellemesiyle (poll) gelir, DJ kartı djOnMeta ile güncellenir.
async function musicSwitchChange (field, checked, input) {
  const msg = byId('set-music-msg')
  if (!MUSIC_SETTINGS_READY || !isOwner()) {
    input.checked = musicServerSettings()[field]
    return
  }
  const body = { music: {} }
  body.music[field] = checked === true
  input.disabled = true
  setMsg(msg, '')
  const res = await api('POST', '/api/settings', body)
  input.disabled = false
  if (res.status === 200) {
    if (state.meta) {
      const prev = state.meta.music && typeof state.meta.music === 'object' ? state.meta.music : { enabled: true, youtube: true }
      state.meta.music = Object.assign({}, prev, body.music)
    }
    if (typeof djOnMeta === 'function') djOnMeta()
    setMsg(msg, () => t(musicSwitchOkKey(field, checked)), 'ok')
    updateSettingsPage()
    return
  }
  input.checked = musicServerSettings()[field]
  setMsg(msg, () => errorText(res, t('dj.settings.failed'), { forbidden: t('dj.settings.ownerOnly') }), 'error')
  updateSettingsPage()
}

// 10. Kanallar: yazı ve ses kanalı oluşturma, yeniden adlandırma, taşıma ve silme

function buildChannelsPage (page) {
  const createSec = sSection(page, t('settings.channels.createTitle'), 'set-channel-create-section')
  const form = h('form', 'settings-inline-form')
  form.id = 'set-channel-form'
  form.noValidate = true
  form.setAttribute('autocomplete', 'off')
  const nameLabel = h('label', 'sr-only', t('settings.server.newChannel'))
  nameLabel.setAttribute('for', 'set-channel-name')
  form.appendChild(nameLabel)
  const name = sInput('text')
  name.id = 'set-channel-name'
  name.maxLength = state.limits.channelNameMax * 2
  name.setAttribute('placeholder', t('settings.server.newChannel'))
  name.setAttribute('spellcheck', 'false')
  form.appendChild(name)
  const typeLabel = h('label', 'sr-only', t('settings.server.channelType'))
  typeLabel.setAttribute('for', 'set-channel-type')
  form.appendChild(typeLabel)
  const type = h('select', 'input select select-small')
  type.id = 'set-channel-type'
  const types = [['text', 'settings.server.typeText'], ['voice', 'settings.server.typeVoice']]
  types.forEach((p) => {
    const opt = h('option', '', t(p[1]))
    opt.value = p[0]
    type.appendChild(opt)
  })
  form.appendChild(type)
  const create = sButton('button', t('settings.server.create'), 'set-channel-create', null, 'i-plus')
  create.type = 'submit'
  form.appendChild(create)
  createSec.appendChild(form)
  createSec.appendChild(sHint(t('settings.channels.nameHint', { max: state.limits.channelNameMax })))
  const msg = sMsg('set-channel-msg')
  createSec.appendChild(msg)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const value = normalizeName(name.value)
    const kind = type.value === 'voice' ? 'voice' : 'text'
    if (!value) {
      setMsg(msg, () => t('settings.server.enterChannelName'), 'error')
      focusNode(name)
      return
    }
    create.disabled = true
    const res = await api('POST', '/api/channels/create', { name: value, type: kind })
    create.disabled = false
    if (res.status === 200) {
      name.value = ''
      setMsg(msg, () => t(kind === 'voice' ? 'settings.server.voiceCreated' : 'settings.server.textCreated'), 'ok')
      return
    }
    setMsg(msg, () => errorText(res, t('settings.server.createFailed')), 'error')
  })

  const textSec = sSection(page, t('channels.text'), 'set-text-channels-section')
  const textList = h('ul', 'plain-list settings-list')
  textList.id = 'set-text-channels'
  textList.setAttribute('aria-labelledby', 'set-text-channels-section-title')
  textSec.appendChild(textList)
  const voiceSec = sSection(page, t('channels.voice'), 'set-voice-channels-section')
  const voiceList = h('ul', 'plain-list settings-list')
  voiceList.id = 'set-voice-channels'
  voiceList.setAttribute('aria-labelledby', 'set-voice-channels-section-title')
  voiceSec.appendChild(voiceList)
  page.appendChild(sHint(t('settings.channels.lastTextHint')))

  const update = () => {
    // Yeniden adlandırma formu açıksa liste korunur
    if (textList.querySelector('.rename-form') || voiceList.querySelector('.rename-form')) return
    fillChannelAdmin(textList, textChannels())
    fillChannelAdmin(voiceList, voiceChannels())
  }
  update()
  return { update: update }
}

function renderServerChannels () {
  const textList = byId('set-text-channels')
  const voiceList = byId('set-voice-channels')
  if (textList) fillChannelAdmin(textList, textChannels())
  if (voiceList) fillChannelAdmin(voiceList, voiceChannels())
}

function fillChannelAdmin (list, channels) {
  const focusKey = activeFocusKey(list)
  clear(list)
  if (!channels.length) list.appendChild(h('li', 'empty-row', t('settings.channels.none')))
  channels.forEach((c, i) => {
    const li = h('li', 'list-row channel-admin-row')
    li.setAttribute('data-channel-id', String(c.id))
    const main = h('span', 'list-main')
    main.appendChild(icon(c.type === 'voice' ? 'i-speaker' : 'i-text'))
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
  const form = h('form', 'settings-inline-form rename-form')
  form.noValidate = true
  const label = h('label', 'sr-only', t('settings.server.newName'))
  const input = sInput('text')
  input.id = 'rename-' + c.id
  label.setAttribute('for', input.id)
  input.maxLength = state.limits.channelNameMax * 2
  input.value = c.name
  const save = button('button button-small', t('common.save'))
  save.type = 'submit'
  const cancel = button('button button-small button-secondary', t('common.cancel'))
  const msg = byId('set-channel-msg')
  const restore = () => {
    renderServerChannels()
    const list = byId(c.type === 'voice' ? 'set-voice-channels' : 'set-text-channels')
    restoreFocusKey(list, 'rename-' + c.id)
  }
  cancel.addEventListener('click', restore)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault()
      e.stopPropagation()
      restore()
    }
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const name = normalizeName(input.value)
    if (!name) {
      setMsg(msg, () => t('settings.server.enterChannelName'), 'error')
      return
    }
    save.disabled = true
    const res = await api('POST', '/api/channels/update', { id: c.id, name: name })
    save.disabled = false
    if (res.status === 200) {
      if (res.data && res.data.channel && typeof res.data.channel.name === 'string') c.name = res.data.channel.name
      setMsg(msg, () => t('settings.server.renamed'), 'ok')
      restore()
      return
    }
    setMsg(msg, () => errorText(res, t('settings.server.renameFailed')), 'error')
    focusNode(input)
  })
  form.appendChild(label)
  form.appendChild(input)
  form.appendChild(save)
  form.appendChild(cancel)
  li.appendChild(form)
  focusNode(input)
  try {
    input.select()
  } catch (err) {
    // Seçim desteklenmiyor
  }
}

async function moveChannel (c, delta) {
  const same = channelsOf(c.type)
  const index = same.indexOf(c)
  const target = index + delta
  if (index === -1 || target < 0 || target >= same.length) return
  const msg = byId('set-channel-msg')
  const res = await api('POST', '/api/channels/update', { id: c.id, position: target })
  if (res.status !== 200) {
    setMsg(msg, () => errorText(res, t('settings.server.moveFailed')), 'error')
    return
  }
  // Meta gelene kadar yerel sıra güncellenir
  const others = same.filter((x) => x !== c)
  others.splice(target, 0, c)
  others.forEach((x, i) => {
    x.position = i
  })
  setMsg(msg, () => t(delta < 0 ? 'settings.channels.movedUp' : 'settings.channels.movedDown', { name: c.name }), 'ok')
  renderServerChannels()
  // Taşınan kanalın aynı yöndeki düğmesine (artık kullanılamıyorsa Yeniden adlandır düğmesine) odaklanılır
  const list = byId(c.type === 'voice' ? 'set-voice-channels' : 'set-text-channels')
  const byKey = (key) => (list ? Array.from(list.querySelectorAll('[data-focus-key]')).filter((n) => n.getAttribute('data-focus-key') === key)[0] : null)
  const again = byKey((delta < 0 ? 'up-' : 'down-') + c.id)
  focusNode(again && !again.disabled ? again : byKey('rename-' + c.id))
  renderChannels()
  renderVoiceAll()
}

async function deleteChannel (c) {
  const text = t(c.type === 'voice' ? 'settings.server.deleteVoiceConfirm' : 'settings.server.deleteTextConfirm', { name: c.name })
  if (!window.confirm(text)) return
  const msg = byId('set-channel-msg')
  const res = await api('POST', '/api/channels/delete', { id: c.id })
  if (res.status === 200) {
    setMsg(msg, () => t('settings.server.deleted'), 'ok')
    focusNode(byId('set-channel-name'))
    return
  }
  setMsg(msg, () => errorText(res, t('settings.server.deleteFailed')), 'error')
}

// 11. Üyeler: liste, rol değiştirme ve özel rol verme (sahip), engelleme ve engeli kaldırma (engelleme izni),
// parola sıfırlama (sahip)

function memberMatches (u, filter) {
  if (!filter) return true
  const locale = window.I18N.locale()
  const hay = (shownName(u.id) + ' ' + String(u.name || '')).toLocaleLowerCase(locale)
  return hay.indexOf(filter) !== -1
}

function buildMembersPage (page) {
  const temp = h('div', 'temp-box settings-temp')
  temp.id = 'set-temp-wrap'
  temp.hidden = true
  const tempLabel = h('p', 'label')
  tempLabel.id = 'set-temp-label'
  temp.appendChild(tempLabel)
  const tempRow = h('div', 'settings-inline-form')
  const tempCode = h('code', 'secret secret-visible')
  tempCode.id = 'set-temp-password'
  tempRow.appendChild(tempCode)
  tempRow.appendChild(sButton('button button-secondary', t('common.copy'), 'set-temp-copy', () => {
    copyWithToast(tempCode.textContent)
  }, 'i-copy'))
  temp.appendChild(tempRow)
  temp.appendChild(sHint(t('settings.members.tempHint')))
  page.appendChild(temp)
  const msg = sMsg('set-members-msg')
  page.appendChild(msg)

  const listSec = sSection(page, t('settings.members.listTitle'), 'set-members-section')
  const filterLabel = h('label', 'sr-only', t('settings.members.filter'))
  filterLabel.setAttribute('for', 'set-members-filter')
  listSec.appendChild(filterLabel)
  const filter = sInput('search', 'settings-filter')
  filter.id = 'set-members-filter'
  filter.setAttribute('placeholder', t('settings.members.filter'))
  filter.value = settingsUi.membersFilter
  listSec.appendChild(filter)
  const list = h('ul', 'plain-list settings-list')
  list.id = 'set-members-list'
  list.setAttribute('aria-labelledby', 'set-members-section-title')
  listSec.appendChild(list)
  const bannedWrap = h('div', 'settings-block')
  bannedWrap.id = 'set-banned-wrap'
  listSec.appendChild(bannedWrap)
  sSub(bannedWrap, t('settings.members.banned'), 'set-banned-title')
  const bannedList = h('ul', 'plain-list settings-list')
  bannedList.id = 'set-banned-list'
  bannedList.setAttribute('aria-labelledby', 'set-banned-title')
  bannedWrap.appendChild(bannedList)
  filter.addEventListener('input', () => {
    settingsUi.membersFilter = filter.value
    update()
  })

  const update = () => {
    const tempData = settingsUi.temp
    temp.hidden = !tempData
    if (tempData) {
      tempLabel.textContent = t('settings.members.tempLabel', { name: tempData.name })
      tempCode.textContent = tempData.password
    } else {
      tempCode.textContent = ''
    }
    const needle = String(settingsUi.membersFilter || '').trim().toLocaleLowerCase(window.I18N.locale())
    const focusKey = activeFocusKey(list)
    clear(list)
    const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
    const shown = users.filter((u) => u && memberMatches(u, needle))
    if (!shown.length) list.appendChild(h('li', 'empty-row', t(users.length ? 'settings.members.noMatch' : 'settings.members.none')))
    shown.forEach((u) => {
      list.appendChild(buildMemberAdminRow(u, false))
    })
    restoreFocusKey(list, focusKey)
    const banned = Array.isArray(state.bannedUsers) ? state.bannedUsers.filter((u) => u && u.id !== undefined) : []
    bannedWrap.hidden = !banned.length
    const bFocus = activeFocusKey(bannedList)
    clear(bannedList)
    banned.forEach((u) => {
      bannedList.appendChild(buildMemberAdminRow({ id: u.id, name: String(u.name || ''), role: u.role || 'member' }, true))
    })
    restoreFocusKey(bannedList, bFocus)
  }
  update()
  return {
    update: update,
    signature: () => {
      const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
      return users.map((u) => [u.id, u.name, u.role, u.roleId, u.status, u.online, safeCall(() => shownName(u.id), ''), safeCall(() => avatarInfoFor(u.id).blobUrl, '')].join(':')).join(',') + '|' + JSON.stringify(state.bannedUsers || []) + '|' + JSON.stringify(metaRoles()) + '|' + myPermsKey() + '|' + (settingsUi.temp ? 't' : '')
    }
  }
}

function adminMemberStatus (userId) {
  const status = shownStatusOf(userId)
  if (status === 'idle') return t('settings.members.status.idle')
  if (status === 'dnd') return t('settings.members.status.dnd')
  if (status === 'online') return t('settings.members.status.online')
  return t('settings.members.status.offline')
}

function buildMemberAdminRow (u, banned) {
  const li = h('li', 'list-row member-row settings-person-row')
  li.setAttribute('data-user-id', String(u.id))
  const main = h('span', 'list-main')
  if (banned) {
    const av = previewAvatar('sm', null, initial(u.name), defaultColorIndex(u.id), '')
    main.appendChild(av)
  } else {
    main.appendChild(avatar(u.id, 'sm'))
  }
  const text = h('span', 'list-text')
  const self = Boolean(state.me && sameId(u.id, state.me.id))
  const line = h('span', 'settings-name-line')
  const display = banned ? u.name : shownName(u.id)
  line.appendChild(h('span', 'list-name', self ? t('voice.selfName', { name: display }) : display))
  line.appendChild(h('span', 'settings-handle', '@' + u.name))
  text.appendChild(line)
  const sub = banned ? t('settings.members.bannedState') : t('settings.members.sub', { role: memberRoleText(u), status: adminMemberStatus(u.id) })
  text.appendChild(h('span', 'list-sub', sub))
  main.appendChild(text)
  li.appendChild(main)
  const actions = h('span', 'row-actions')
  const owner = isOwner()
  if (!banned && owner && !self && u.role !== 'owner') {
    const toMember = u.role === 'admin'
    const roleBtn = button('button button-small button-secondary act-role', t(toMember ? 'settings.members.makeMember' : 'settings.members.makeAdmin'))
    roleBtn.setAttribute('data-focus-key', 'role-' + u.id)
    roleBtn.setAttribute('aria-label', t(toMember ? 'settings.members.makeMemberLabel' : 'settings.members.makeAdminLabel', { name: display }))
    roleBtn.addEventListener('click', () => {
      setUserRole(u, toMember ? 'member' : 'admin', roleBtn)
    })
    actions.appendChild(roleBtn)
  }
  // Engellenenler metada yoktur, rütbeleri bilinmez: engeli kaldırma düğmesi gösterilir, son karar sunucunundur
  const canBan = !self && u.role !== 'owner' && hasPerm('ban') && (banned ? (owner || u.role === 'member') : outranksUser(u.id))
  if (!banned && owner && !self && u.role !== 'owner' && metaRoles().length) actions.appendChild(customRoleSelect(u, display))
  if (canBan) {
    const banBtn = button('button button-small ' + (banned ? 'button-secondary' : 'button-danger') + ' act-ban', t(banned ? 'settings.members.unban' : 'settings.members.ban'))
    banBtn.setAttribute('data-focus-key', (banned ? 'unban-' : 'ban-') + u.id)
    banBtn.setAttribute('aria-label', t(banned ? 'settings.members.unbanLabel' : 'settings.members.banLabel', { name: display }))
    banBtn.addEventListener('click', () => {
      setUserBan(u, !banned, banBtn)
    })
    actions.appendChild(banBtn)
  }
  if (owner && !self && !banned) {
    const reset = button('button button-small button-ghost act-reset', t('settings.members.resetPassword'))
    reset.setAttribute('data-focus-key', 'reset-' + u.id)
    reset.setAttribute('aria-label', t('settings.members.resetLabel', { name: display }))
    reset.addEventListener('click', () => {
      resetUserPassword(u, reset)
    })
    actions.appendChild(reset)
  }
  li.appendChild(actions)
  return li
}

// Üyenin rol metni: temel rol, varsa özel rolüyle (ör. "Üye, Moderatör")
function memberRoleText (u) {
  const custom = findRole(u.roleId)
  return custom ? t('roles.withCustom', { role: roleLabel(u.role), custom: custom.name }) : roleLabel(u.role)
}

// Sahip için üye satırındaki özel rol seçimi
function customRoleSelect (u, display) {
  const wrap = h('span', 'custom-role-pick')
  const id = 'set-custom-role-' + u.id
  const label = h('label', 'sr-only', t('settings.members.customRoleLabel', { name: display }))
  label.setAttribute('for', id)
  wrap.appendChild(label)
  const select = h('select', 'input select select-small act-custom-role')
  select.id = id
  select.setAttribute('data-focus-key', 'crole-' + u.id)
  const none = h('option', '', t('settings.members.noCustomRole'))
  none.value = ''
  select.appendChild(none)
  metaRoles().forEach((r) => {
    const opt = h('option', '', r.name)
    opt.value = String(r.id)
    select.appendChild(opt)
  })
  const current = findRole(u.roleId)
  select.value = current ? String(current.id) : ''
  select.addEventListener('change', () => {
    setUserCustomRole(u, select.value ? Number(select.value) : null, select)
  })
  wrap.appendChild(select)
  return wrap
}

async function setUserCustomRole (u, roleId, select) {
  const msg = byId('set-members-msg')
  const name = shownName(u.id)
  select.disabled = true
  const res = await api('POST', '/api/users/custom-role', { userId: u.id, roleId: roleId })
  if (isConnected(select)) select.disabled = false
  if (res.status === 200) {
    const role = findRole(roleId)
    setMsg(msg, () => (role ? t('settings.members.customRoleSet', { name: name, role: role.name }) : t('settings.members.customRoleCleared', { name: name })), 'ok')
    return
  }
  const current = findRole(u.roleId)
  if (isConnected(select)) select.value = current ? String(current.id) : ''
  setMsg(msg, () => errorText(res, t('settings.members.actionFailed')), 'error')
}

async function setUserRole (u, role, b) {
  const msg = byId('set-members-msg')
  const name = shownName(u.id)
  b.disabled = true
  const res = await api('POST', '/api/users/role', { userId: u.id, role: role })
  if (isConnected(b)) b.disabled = false
  if (res.status === 200) {
    setMsg(msg, () => t(role === 'admin' ? 'settings.members.nowAdmin' : 'settings.members.nowMember', { name: name }), 'ok')
    return
  }
  setMsg(msg, () => errorText(res, t('settings.members.roleFailed')), 'error')
}

async function setUserBan (u, banned, b) {
  const msg = byId('set-members-msg')
  const name = banned ? shownName(u.id) : u.name
  if (banned && !window.confirm(t('settings.members.banConfirm', { name: name }))) return
  b.disabled = true
  const res = await api('POST', '/api/users/ban', { userId: u.id, banned: banned })
  if (res.status === 200) {
    const list = Array.isArray(state.bannedUsers) ? state.bannedUsers : []
    state.bannedUsers = banned ? list.filter((x) => !sameId(x.id, u.id)).concat([{ id: u.id, name: u.name, role: u.role }]) : list.filter((x) => !sameId(x.id, u.id))
    if (!banned) state.users.delete(String(u.id))
    setMsg(msg, () => t(banned ? 'settings.members.bannedOk' : 'settings.members.unbannedOk', { name: name }), 'ok')
    updateSettingsPage()
    focusNode(byId('set-members-filter'))
    refreshAdminState(true)
    return
  }
  if (isConnected(b)) b.disabled = false
  setMsg(msg, () => errorText(res, t('settings.members.actionFailed')), 'error')
}

async function resetUserPassword (u, b) {
  const name = shownName(u.id)
  if (!window.confirm(t('settings.members.resetConfirm', { name: name }))) return
  const msg = byId('set-members-msg')
  b.disabled = true
  const res = await api('POST', '/api/users/reset-password', { userId: u.id })
  if (isConnected(b)) b.disabled = false
  if (res.status === 200 && res.data && typeof res.data.tempPassword === 'string') {
    settingsUi.temp = { name: name, password: res.data.tempPassword }
    setMsg(msg, '')
    updateSettingsPage()
    focusNode(byId('set-temp-copy'))
    return
  }
  setMsg(msg, () => errorText(res, t('settings.members.resetFailed')), 'error')
}

// 12. Roller: özel rol oluşturma, ad ve renk, izinler, sıralama ve silme (yalnızca sahip). Rol üyelere Üyeler
// sayfasından verilir. Listede üstteki rol alttakilerden yüksek rütbelidir.

function roleColorClass (color) {
  return 'role-color-' + (ROLE_COLORS.indexOf(color) !== -1 ? color : 'blue')
}

function roleSwatch (color) {
  const dot = h('span', 'role-swatch ' + roleColorClass(color))
  dot.setAttribute('aria-hidden', 'true')
  return dot
}

function roleColorSelect (id, current) {
  const select = h('select', 'input select select-small role-color-select')
  select.id = id
  ROLE_COLORS.forEach((c) => {
    const opt = h('option', '', t('roles.color.' + c))
    opt.value = c
    select.appendChild(opt)
  })
  select.value = ROLE_COLORS.indexOf(current) !== -1 ? current : 'blue'
  return select
}

function roleMemberCount (roleId) {
  const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
  return users.filter((u) => u && sameId(u.roleId, roleId)).length
}

function buildRolesPage (page) {
  page.appendChild(h('p', 'settings-lead', t('settings.roles.lead')))
  const createSec = sSection(page, t('settings.roles.createTitle'), 'set-role-create-section')
  const form = h('form', 'settings-inline-form')
  form.id = 'set-role-form'
  form.noValidate = true
  form.setAttribute('autocomplete', 'off')
  const nameLabel = h('label', 'sr-only', t('settings.roles.name'))
  nameLabel.setAttribute('for', 'set-role-name')
  form.appendChild(nameLabel)
  const name = sInput('text')
  name.id = 'set-role-name'
  name.maxLength = ROLE_NAME_MAX * 2
  name.setAttribute('placeholder', t('settings.roles.namePlaceholder'))
  form.appendChild(name)
  const colorLabel = h('label', 'sr-only', t('settings.roles.color'))
  colorLabel.setAttribute('for', 'set-role-color')
  form.appendChild(colorLabel)
  const color = roleColorSelect('set-role-color', ROLE_COLORS[metaRoles().length % ROLE_COLORS.length])
  form.appendChild(color)
  const create = sButton('button', t('settings.roles.create'), 'set-role-create', null, 'i-plus')
  create.type = 'submit'
  form.appendChild(create)
  createSec.appendChild(form)
  createSec.appendChild(sHint(t('settings.roles.nameHint', { max: ROLE_NAME_MAX })))
  const msg = sMsg('set-role-msg')
  createSec.appendChild(msg)
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const value = normalizeName(name.value)
    if (!value) {
      setMsg(msg, () => t('settings.roles.enterName'), 'error')
      focusNode(name)
      return
    }
    create.disabled = true
    const res = await api('POST', '/api/roles/create', { name: value, color: color.value, perms: [] })
    create.disabled = false
    if (res.status === 200) {
      name.value = ''
      color.value = ROLE_COLORS[(metaRoles().length + 1) % ROLE_COLORS.length]
      setMsg(msg, () => t('settings.roles.created', { name: value }), 'ok')
      return
    }
    setMsg(msg, () => errorText(res, t('settings.roles.createFailed')), 'error')
    focusNode(name)
  })

  const listSec = sSection(page, t('settings.roles.listTitle'), 'set-roles-section')
  listSec.appendChild(sHint(t('settings.roles.orderHint')))
  listSec.appendChild(sMsg('set-roles-msg'))
  const list = h('ul', 'plain-list settings-list role-admin-list')
  list.id = 'set-roles-list'
  list.setAttribute('aria-labelledby', 'set-roles-section-title')
  listSec.appendChild(list)
  page.appendChild(sHint(t('settings.roles.assignHint')))

  const update = () => {
    // Düzenleme formu açıksa liste korunur
    if (list.querySelector('.rename-form')) return
    fillRoleAdmin(list)
  }
  update()
  return {
    update: update,
    signature: () => JSON.stringify(metaRoles()) + '|' + metaRoles().map((r) => roleMemberCount(r.id)).join(',')
  }
}

function fillRoleAdmin (list) {
  const focusKey = activeFocusKey(list)
  clear(list)
  const roles = metaRoles()
  if (!roles.length) list.appendChild(h('li', 'empty-row', t('settings.roles.none')))
  roles.forEach((r, i) => {
    const li = h('li', 'list-row role-admin-row')
    li.setAttribute('data-role-id', String(r.id))
    const head = h('div', 'role-admin-head')
    const main = h('span', 'list-main')
    main.appendChild(roleSwatch(r.color))
    const text = h('span', 'list-text')
    text.appendChild(h('span', 'list-name', r.name))
    text.appendChild(h('span', 'list-sub', t('settings.roles.memberCount', { count: roleMemberCount(r.id) })))
    main.appendChild(text)
    head.appendChild(main)
    const actions = h('span', 'row-actions')
    const up = button('icon-button', '', 'i-up', t('settings.roles.moveUp', { name: r.name }))
    up.disabled = i === 0
    up.setAttribute('data-focus-key', 'role-up-' + r.id)
    up.addEventListener('click', () => {
      moveRole(r, i, -1)
    })
    const down = button('icon-button', '', 'i-down', t('settings.roles.moveDown', { name: r.name }))
    down.disabled = i === roles.length - 1
    down.setAttribute('data-focus-key', 'role-down-' + r.id)
    down.addEventListener('click', () => {
      moveRole(r, i, 1)
    })
    const edit = button('button button-small button-secondary', t('settings.roles.edit'), null, t('settings.roles.editLabel', { name: r.name }))
    edit.setAttribute('data-focus-key', 'role-edit-' + r.id)
    edit.addEventListener('click', () => {
      startRoleEdit(li, r)
    })
    const del = button('button button-small button-danger', t('common.delete'), null, t('settings.roles.deleteLabel', { name: r.name }))
    del.setAttribute('data-focus-key', 'role-del-' + r.id)
    del.addEventListener('click', () => {
      deleteRole(r)
    })
    actions.appendChild(up)
    actions.appendChild(down)
    actions.appendChild(edit)
    actions.appendChild(del)
    head.appendChild(actions)
    li.appendChild(head)
    const perms = h('div', 'role-perms')
    perms.setAttribute('role', 'group')
    perms.setAttribute('aria-label', t('settings.roles.permsLabel', { name: r.name }))
    ROLE_PERMS.forEach((perm) => {
      const id = 'set-role-' + r.id + '-' + perm
      const on = Array.isArray(r.perms) && r.perms.indexOf(perm) !== -1
      const sw = sSwitch(id, t('roles.perm.' + perm), on, (checked, input) => {
        setRolePerm(r, perm, checked, input)
      }, t('roles.permHint.' + perm))
      sw.input.setAttribute('data-focus-key', id)
      perms.appendChild(sw.row)
    })
    li.appendChild(perms)
    list.appendChild(li)
  })
  restoreFocusKey(list, focusKey)
}

async function setRolePerm (r, perm, checked, input) {
  const msg = byId('set-roles-msg')
  const current = Array.isArray(r.perms) ? r.perms : []
  const next = ROLE_PERMS.filter((p) => (p === perm ? checked : current.indexOf(p) !== -1))
  input.disabled = true
  const res = await api('POST', '/api/roles/update', { id: r.id, perms: next })
  if (isConnected(input)) input.disabled = false
  if (res.status === 200) {
    r.perms = next
    setMsg(msg, () => t('settings.roles.saved', { name: r.name }), 'ok')
    return
  }
  if (isConnected(input)) input.checked = !checked
  setMsg(msg, () => errorText(res, t('settings.roles.saveFailed')), 'error')
}

function startRoleEdit (li, r) {
  const head = li.querySelector('.role-admin-head')
  if (!head) return
  clear(head)
  const form = h('form', 'settings-inline-form rename-form')
  form.noValidate = true
  form.setAttribute('autocomplete', 'off')
  const label = h('label', 'sr-only', t('settings.roles.name'))
  const input = sInput('text')
  input.id = 'set-role-rename-' + r.id
  label.setAttribute('for', input.id)
  input.maxLength = ROLE_NAME_MAX * 2
  input.value = r.name
  const colorLabel = h('label', 'sr-only', t('settings.roles.color'))
  const color = roleColorSelect('set-role-recolor-' + r.id, r.color)
  colorLabel.setAttribute('for', color.id)
  const save = button('button button-small', t('common.save'))
  save.type = 'submit'
  const cancel = button('button button-small button-secondary', t('common.cancel'))
  const msg = byId('set-roles-msg')
  const list = byId('set-roles-list')
  const restore = () => {
    if (list) {
      fillRoleAdmin(list)
      restoreFocusKey(list, 'role-edit-' + r.id)
    }
  }
  cancel.addEventListener('click', restore)
  form.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      e.preventDefault()
      e.stopPropagation()
      restore()
    }
  })
  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const value = normalizeName(input.value)
    if (!value) {
      setMsg(msg, () => t('settings.roles.enterName'), 'error')
      focusNode(input)
      return
    }
    const body = { id: r.id }
    if (value !== r.name) body.name = value
    if (color.value !== r.color) body.color = color.value
    if (body.name === undefined && body.color === undefined) {
      restore()
      return
    }
    save.disabled = true
    const res = await api('POST', '/api/roles/update', body)
    save.disabled = false
    if (res.status === 200) {
      if (res.data && res.data.role) {
        r.name = res.data.role.name
        r.color = res.data.role.color
      }
      setMsg(msg, () => t('settings.roles.saved', { name: r.name }), 'ok')
      restore()
      return
    }
    setMsg(msg, () => errorText(res, t('settings.roles.saveFailed')), 'error')
    focusNode(input)
  })
  form.appendChild(label)
  form.appendChild(input)
  form.appendChild(colorLabel)
  form.appendChild(color)
  form.appendChild(save)
  form.appendChild(cancel)
  head.appendChild(form)
  focusNode(input)
  try {
    input.select()
  } catch (err) {
    // Seçim desteklenmiyor
  }
}

async function moveRole (r, index, delta) {
  const roles = metaRoles()
  const target = index + delta
  if (target < 0 || target >= roles.length) return
  const msg = byId('set-roles-msg')
  const res = await api('POST', '/api/roles/update', { id: r.id, position: target })
  if (res.status !== 200) {
    setMsg(msg, () => errorText(res, t('settings.roles.saveFailed')), 'error')
    return
  }
  // Meta gelene kadar yerel sıra güncellenir
  if (state.meta && Array.isArray(state.meta.roles)) {
    const others = state.meta.roles.filter((x) => !sameId(x.id, r.id))
    others.splice(target, 0, r)
    state.meta.roles = others
  }
  setMsg(msg, () => t(delta < 0 ? 'settings.roles.movedUp' : 'settings.roles.movedDown', { name: r.name }), 'ok')
  const list = byId('set-roles-list')
  if (!list) return
  fillRoleAdmin(list)
  const byKey = (key) => Array.from(list.querySelectorAll('[data-focus-key]')).filter((n) => n.getAttribute('data-focus-key') === key)[0]
  const again = byKey((delta < 0 ? 'role-up-' : 'role-down-') + r.id)
  focusNode(again && !again.disabled ? again : byKey('role-edit-' + r.id))
}

async function deleteRole (r) {
  if (!window.confirm(t('settings.roles.deleteConfirm', { name: r.name }))) return
  const msg = byId('set-roles-msg')
  const res = await api('POST', '/api/roles/delete', { id: r.id })
  if (res.status === 200) {
    setMsg(msg, () => t('settings.roles.deleted', { name: r.name }), 'ok')
    focusNode(byId('set-role-name'))
    return
  }
  setMsg(msg, () => errorText(res, t('settings.roles.deleteFailed')), 'error')
}

// 13. Davet: davet kodu (göster, kopyala, yenile) ve anahtar dahil davet bağlantısı

function buildInvitePage (page) {
  page.appendChild(h('p', 'settings-lead', t('invite.lead')))
  const codeSec = sSection(page, t('auth.inviteCode'), 'set-invite-section')
  const row = h('div', 'settings-inline-form')
  const code = h('code', 'secret')
  code.id = 'set-invite-code'
  row.appendChild(code)
  const show = sButton('button button-secondary', '', 'set-invite-show')
  row.appendChild(show)
  const copy = sButton('button button-secondary', t('common.copy'), 'set-invite-copy-code', () => {
    if (state.inviteCode) copyWithToast(state.inviteCode)
  }, 'i-copy')
  row.appendChild(copy)
  const rotate = sButton('button button-secondary', t('settings.server.rotate'), 'set-invite-rotate')
  row.appendChild(rotate)
  codeSec.appendChild(row)
  const msg = sMsg('set-invite-msg')
  codeSec.appendChild(msg)
  codeSec.appendChild(sHint(t('settings.server.rotateHint')))

  const linkSec = sSection(page, t('invite.title'), 'set-invite-link-section')
  const linkRow = sActions(linkSec)
  const copyLink = sButton('button', t('settings.invite.copyLink'), 'set-invite-link-copy', null, 'i-copy')
  linkRow.appendChild(copyLink)
  const noKey = h('p', 'settings-note', t('settings.invite.noKey'))
  noKey.id = 'set-invite-no-key'
  linkSec.appendChild(noKey)
  linkSec.appendChild(h('p', 'warning', t('invite.warning')))

  const setVisible = (visible) => {
    settingsUi.inviteVisible = visible
    show.setAttribute('aria-pressed', visible ? 'true' : 'false')
    show.textContent = t(visible ? 'common.hide' : 'common.show')
    code.textContent = visible ? (state.inviteCode || t('settings.server.unavailable')) : t('common.hidden')
    code.classList.toggle('secret-visible', visible)
  }
  show.addEventListener('click', () => {
    setVisible(show.getAttribute('aria-pressed') !== 'true')
  })
  rotate.addEventListener('click', async () => {
    if (!window.confirm(t('settings.server.rotateConfirm'))) return
    rotate.disabled = true
    const res = await api('POST', '/api/invite/rotate')
    rotate.disabled = false
    if (res.status === 200 && res.data && typeof res.data.inviteCode === 'string') {
      state.inviteCode = res.data.inviteCode
      setVisible(true)
      setMsg(msg, () => t('settings.invite.rotated'), 'ok')
      return
    }
    setMsg(msg, () => errorText(res, t('settings.server.rotateFailed')), 'error')
  })
  copyLink.addEventListener('click', () => {
    const entry = activeKeyEntry()
    if (!entry || !state.inviteCode) return
    copyWithToast(inviteLink(state.inviteCode, entry.code))
  })

  const update = () => {
    setVisible(settingsUi.inviteVisible)
    copy.disabled = !state.inviteCode
    const entry = activeKeyEntry()
    copyLink.disabled = !entry || !state.inviteCode
    noKey.hidden = Boolean(entry)
  }
  update()
  return { update: update, signature: () => (state.inviteCode || '') + '|' + keyringSignature() }
}
