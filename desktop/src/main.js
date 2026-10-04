'use strict'

// Telsiz masaüstü uygulamasının ana süreci (Ek J2, Ek L1.9).
//
// Güvenlik mimarisi:
// - İstemci kodu uygulamanın içinde taşınır (desktop/app/, derlemede public/ klasöründen
//   kopyalanır). Açılışta her dosyanın sha256 değeri bütünlük bildirimine göre doğrulanır ve
//   dosyalar yalnızca bu doğrulanmış bellek kopyasından sunulur. Arayüz sunucudan indirilmez.
// - Sayfa telsiz://app/ ayrıcalıklı şemasından yüklenir. /api/* istekleri ana süreçte
//   yapılandırılmış sunucuya iletilir (src/lib/proxy.js), diğer yollar beyaz listeden sunulur
//   (src/lib/static-files.js). Sayfa sunucuya doğrudan bağlanamaz (CSP connect-src 'self').
// - Her sunucu kendi oturum bölümünü (partition) kullanır: bir sunucunun oturum bilgisi ve yerel
//   verisi başka bir sunucuya hiçbir zaman gönderilemez. Arayüzde her sunucu bir "frekans"tır:
//   uygulama birden çok frekansı hatırlar (src/lib/frequencies.js), geçişte uygulama penceresi o
//   frekansın oturum bölümüyle yeniden açılır, böylece her frekansın girişi ayrı ayrı korunur.
// - Açık olmayan frekansların okunmamış sayıları için her biri kendi oturum bölümünde gizli, sesi kapalı,
//   görselsiz bir arka plan penceresi çalışır (src/lib/background.js, en fazla 8). Bu pencerelere yalnızca
//   bildirim izni verilir, raporları gönderen pencere ve her alan doğrulanarak kabul edilir.
// - Pencereler bağlam yalıtımı ve korumalı alanla açılır, Node.js sayfaya hiç verilmez. Gezinme,
//   yeni pencere, webview, izinler, indirmeler ve sertifika hataları sıkı biçimde denetlenir.
// - Ön yükleme betikleri yalnızca sabit adlı IPC kanallarını kullanır, her girdi burada yeniden
//   doğrulanır ve her çağrının hangi pencereden ve kökenden geldiği denetlenir.
// - Güncellemeler (src/lib/updates.js): kurucu ve AppImage electron-updater ile arka planda indirir
//   ve sha512 ile doğrular, kurulum yalnızca kullanıcı isteyince yapılır. Taşınabilir exe ve .deb
//   için yalnızca yeni sürüm bildirilir. Ayar kapalıyken GitHub'a hiç istek gitmez.

const path = require('node:path')
const fs = require('node:fs')
const crypto = require('node:crypto')
const {
  app,
  BrowserWindow,
  Menu,
  Tray,
  nativeImage,
  ipcMain,
  globalShortcut,
  protocol,
  session,
  shell,
  dialog,
  desktopCapturer,
  webContents
} = require('electron')

const channels = require('./lib/channels')
const serverUrl = require('./lib/server-url')
const shortcuts = require('./lib/shortcuts')
const staticFiles = require('./lib/static-files')
const proxy = require('./lib/proxy')
const csp = require('./lib/csp')
const navigation = require('./lib/navigation')
const permissions = require('./lib/permissions')
const screenShare = require('./lib/screen-share')
const integrity = require('./lib/integrity')
const strings = require('./lib/strings')
const settingsStore = require('./lib/settings-store')
const diagnostics = require('./lib/diagnostics')
const automation = require('./lib/automation')
const frequencies = require('./lib/frequencies')
const updates = require('./lib/updates')
const background = require('./lib/background')
const serverIcon = require('./lib/server-icon')

const { SCHEME, APP_HOST, CONNECT_HOST, PICKER_HOST, APP_ORIGIN, CONNECT_ORIGIN, PICKER_ORIGIN, CHANNELS, ACTIONS, VERSION_ARG, BACKGROUND_ARG } = channels

const APP_ID = 'io.github.yerlifan.telsiz'
const HOMEPAGE = 'https://github.com/Yerlifan/telsiz'
const ROOT_DIR = path.join(__dirname, '..')
const APP_DIR = path.join(ROOT_DIR, 'app')
const RUNTIME_ICON_DIR = path.join(ROOT_DIR, 'build', 'runtime')
const IS_DEV = !app.isPackaged
const CONNECT_PARTITION = 'telsiz-baglan'
const PICKER_PARTITION = 'telsiz-secici'
// Hafif güncelleme denetiminin (GitHub API) oturumu: çerez ve önbellek yok, sunucu oturumlarından ayrı
const UPDATE_PARTITION = 'telsiz-guncelleme'
const BACKGROUND = '#0f1015'
const EXTERNAL_OPEN_INTERVAL_MS = 500
const MAX_ADDRESS_INPUT = 1000
const THUMBNAIL_SIZE = { width: 320, height: 180 }
const ORIGINS = { app: APP_ORIGIN, connect: CONNECT_ORIGIN, picker: PICKER_ORIGIN, background: APP_ORIGIN }
// Arka plan pencerelerinin erişilebilirlik yoklaması bu kalıcı olmayan oturumla yapılır (çerez ve oturum yok)
const PROBE_PARTITION = 'telsiz-yokla'
const BG_OPEN_INTERVAL_MS = 2000
// Gözetimsiz çalıştırmalarda (duman testi, CI) açılış adımlarının tanı günlüğü, ortam değişkeni
// yoksa kapalıdır (src/lib/diagnostics.js)
const diag = diagnostics.fromEnv(process.env)

diag.log('start', { version: app.getVersion(), electron: process.versions.electron, platform: process.platform, arch: process.arch, packaged: app.isPackaged, pid: process.pid })
if (diag.enabled) {
  // Gözetimsiz çalıştırmada yakalanmamış hata Electron'un engelleyici hata kutusu yerine günlüğe
  // yazılır ve uygulama kapanır (kutuyu kapatacak kimse yoktur). Değişken yokken Electron'un
  // varsayılan davranışı (hata kutusu) aynen kalır.
  process.on('uncaughtException', (err, origin) => {
    diag.log('uncaught-exception', { origin, error: err })
    logError('uncaught ' + origin, err)
    app.exit(1)
  })
  app.on('child-process-gone', (event, details) => diag.log('child-process-gone', { type: details.type, reason: details.reason, exitCode: details.exitCode, name: details.name || null }))
  app.on('will-quit', () => diag.log('will-quit'))
  app.on('quit', (event, exitCode) => diag.log('quit', { exitCode }))
}

protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME,
  // allowServiceWorkers verilmez: service worker bu şemada kaydedilemez
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}])
app.enableSandbox()
// Ses odası pencere arka plandayken (tepsi, önde bir oyun) de çalışmalı: ses etkinliği algılayıcısı
// 20 ms aralıklı bir zamanlayıcı kullanır ve Chromium arka plandaki sayfanın zamanlayıcılarını
// saniyede bire indirir. Bu anahtarlar zamanlayıcı kısmayı kapatır, sayfa görünürlüğü
// (document.hidden) doğru kalır, bildirimler bu yüzden yine yalnızca pencere gizliyken çıkar.
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
if (process.platform === 'win32') app.setAppUserModelId(APP_ID)

const state = {
  lang: 'en',
  t: strings.translator('en'),
  files: null,
  pages: null,
  settingsFile: null,
  settings: settingsStore.defaults(),
  mainWindow: null,
  mainOrigin: null,
  connectWindow: null,
  tray: null,
  trayHintShown: false,
  quitting: false,
  registeredAccelerators: [],
  shortcutStatus: {},
  contexts: new Map(),
  preparedSessions: new WeakSet(),
  connectBusy: false,
  lastExternalOpen: 0,
  activation: new Map(),
  pickerBusy: false,
  picker: null,
  pendingDisplay: null,
  updates: null,
  updateStatus: null,
  // Zamanlanmış güncelleme denetimi (gözetimsiz çalıştırmada ve otomasyonda kapalı)
  scheduleUpdates: false,
  lastBackgroundOpen: 0
}

function t (key, params) {
  return state.t(key, params)
}

function noop () {}

function logError (label, err) {
  const message = err && err.message ? err.message : String(err)
  console.error('[telsiz] ' + label + ': ' + message)
  diag.log('error', { label, message })
}

// ------------------------------------------------------------------ yardımcılar

function partitionFor (origin) {
  return 'persist:sunucu-' + crypto.createHash('sha256').update(origin).digest('hex').slice(0, 32)
}

function loadIcon (name) {
  const file = path.join(RUNTIME_ICON_DIR, name)
  if (!fs.existsSync(file)) return null
  const image = nativeImage.createFromPath(file)
  return image.isEmpty() ? null : image
}

function windowIcon () {
  return loadIcon('window-256.png') || undefined
}

function webPreferences (preload, partition, extra) {
  return Object.assign({
    preload,
    partition,
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    spellcheck: false,
    webviewTag: false,
    navigateOnDragDrop: false,
    experimentalFeatures: false,
    enableWebSQL: false,
    safeDialogs: true,
    devTools: IS_DEV
  }, extra || {})
}

function isAlive (win) {
  return Boolean(win) && !win.isDestroyed()
}

function contextOf (contents) {
  return contents ? state.contexts.get(contents.id) : undefined
}

// IPC çağrısı beklenen pencereden, ana çerçeveden ve beklenen kökenden mi geldi?
function senderIs (event, context) {
  const contents = event.sender
  const frame = event.senderFrame
  if (!contents || contents.isDestroyed() || !frame || frame.parent !== null) return false
  if (state.contexts.get(contents.id) !== context) return false
  if (context === 'app' && (!isAlive(state.mainWindow) || state.mainWindow.webContents !== contents)) return false
  if (context === 'connect' && (!isAlive(state.connectWindow) || state.connectWindow.webContents !== contents)) return false
  if (context === 'picker' && (!state.picker || state.picker.windowContentsId !== contents.id)) return false
  if (context === 'background' && !backgroundWindows.ownerOf(contents.id)) return false
  return navigation.originOf(frame.url) === ORIGINS[context]
}

function requireSender (event, context) {
  if (!senderIs(event, context)) throw new Error('forbidden')
}

function openExternal (url) {
  if (!navigation.isExternalUrl(url)) return
  const now = Date.now()
  if (now - state.lastExternalOpen < EXTERNAL_OPEN_INTERVAL_MS) return
  state.lastExternalOpen = now
  shell.openExternal(url).catch((err) => logError('openExternal', err))
}

function persistSettings () {
  try {
    state.settings = settingsStore.save(state.settingsFile, state.settings)
  } catch (err) {
    logError('settings', err)
  }
}

// ------------------------------------------------------------------ kendi sayfalarımız

function readOwnFile (dir, name) {
  return fs.readFileSync(path.join(__dirname, dir, name))
}

// Sunucu adresi ekranı ve ekran seçicisi: birkaç sabit yol, kendi CSP'leriyle
function loadPages () {
  const logo = state.files.get('favicon.svg')
  const page = (dir, base, pageCsp) => {
    const routes = new Map()
    const html = { data: readOwnFile(dir, base + '.html'), type: staticFiles.HTML_TYPE, csp: pageCsp }
    routes.set('/', html)
    routes.set('/' + base + '.html', html)
    routes.set('/' + base + '.js', { data: readOwnFile(dir, base + '.js'), type: staticFiles.JS_TYPE, csp: csp.STATIC_CSP })
    routes.set('/' + base + '.css', { data: readOwnFile(dir, base + '.css'), type: staticFiles.CSS_TYPE, csp: csp.STATIC_CSP })
    if (logo) routes.set('/logo.svg', { data: logo, type: 'image/svg+xml', csp: csp.STATIC_CSP })
    return routes
  }
  return {
    connect: { host: CONNECT_HOST, routes: page('connect', 'baglan', csp.CONNECT_CSP) },
    picker: { host: PICKER_HOST, routes: page('picker', 'secici', csp.PICKER_CSP) }
  }
}

function servePage (request, page) {
  diag.log('own-page-request', { method: request.method, url: request.url })
  let url
  try {
    url = new URL(request.url)
  } catch (err) {
    return staticFiles.textResponse(404, t('http.notFound'))
  }
  if (url.protocol !== SCHEME + ':' || url.host !== page.host) return staticFiles.textResponse(404, t('http.notFound'))
  return staticFiles.pageResponse(request.method, url.pathname, page.routes, t('http.notFound'))
}

// ------------------------------------------------------------------ oturum politikaları

function denyDeviceChoosers (ses) {
  ses.setDevicePermissionHandler(() => false)
  ses.on('select-hid-device', (event, details, callback) => {
    event.preventDefault()
    callback()
  })
  ses.on('select-serial-port', (event, portList, contents, callback) => {
    event.preventDefault()
    callback('')
  })
  ses.on('select-usb-device', (event, details, callback) => {
    event.preventDefault()
    callback()
  })
}

// Sunucu adresi ekranı ve seçici: hiçbir izin, indirme veya ağ isteği yok
function prepareOwnSession (ses, page) {
  if (state.preparedSessions.has(ses)) return
  state.preparedSessions.add(ses)
  ses.protocol.handle(SCHEME, (request) => servePage(request, page))
  ses.setPermissionRequestHandler((contents, permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  denyDeviceChoosers(ses)
  ses.on('will-download', (event) => event.preventDefault())
  ses.setSpellCheckerEnabled(false)
}

function prepareAppSession (ses, origin) {
  if (state.preparedSessions.has(ses)) return
  state.preparedSessions.add(ses)
  const apiProxy = proxy.createApiProxy({
    origin,
    fetch: (url, init) => ses.fetch(url, init),
    expectedInitiator: APP_ORIGIN
  })
  ses.protocol.handle(SCHEME, (request) => handleAppRequest(request, apiProxy))
  ses.setPermissionRequestHandler(onPermissionRequest)
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => {
    // Arka plan penceresi yalnızca bildirim gösterebilir (mikrofon, kamera ve diğer izinler yok)
    if (contents && permissions.deniedFor(contextOf(contents), permission)) return false
    return permissions.decideCheck(permission, requestingOrigin, details, APP_ORIGIN)
  })
  ses.setDisplayMediaRequestHandler(onDisplayMediaRequest)
  // Telsiz DJ: YouTube oynatıcısının çerçeve isteğine sunucu kökeni Referer olarak eklenir (153 hatası)
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://' + navigation.YOUTUBE_FRAME_HOST + '/embed/*'] }, (details, callback) => {
    callback({ requestHeaders: navigation.youtubeEmbedHeaders(details, origin) })
  })
  denyDeviceChoosers(ses)
  // Yalnızca sayfanın ürettiği blob: indirmeleri (çözülmüş dosyalar) kaydedilebilir, Electron
  // kayıt yerini kullanıcıya sorar
  ses.on('will-download', (event, item) => {
    const url = typeof item.getURL === 'function' ? item.getURL() : ''
    if (!url.startsWith('blob:' + APP_ORIGIN + '/')) event.preventDefault()
  })
  ses.setSpellCheckerEnabled(false)
}

function handleAppRequest (request, apiProxy) {
  let url
  try {
    url = new URL(request.url)
  } catch (err) {
    return staticFiles.textResponse(404, t('http.notFound'))
  }
  if (url.protocol !== SCHEME + ':' || url.host !== APP_HOST) return staticFiles.textResponse(404, t('http.notFound'))
  if (proxy.isApiPath(url.pathname)) return apiProxy(request, url)
  return staticFiles.staticResponse(request.method, url.pathname, state.files, t('http.notFound'))
}

function onPermissionRequest (contents, permission, callback, details) {
  if (contents && permissions.deniedFor(contextOf(contents), permission)) {
    callback(false)
    return
  }
  const decision = permissions.decideRequest(permission, details, APP_ORIGIN)
  if (decision === 'allow') {
    callback(true)
    return
  }
  if (decision === 'display' && contents && isAlive(state.mainWindow) && contents === state.mainWindow.webContents) {
    requestScreenChoice(contents).then((granted) => callback(granted), (err) => {
      logError('screen share', err)
      callback(false)
    })
    return
  }
  callback(false)
}

// ------------------------------------------------------------------ ekran paylaşımı

// İzin aşaması: son kullanıcı girişi yeniyse seçiciyi gösterir. Kullanıcı bir kaynak seçerse
// seçim kısa süreli bekleyen kayıt olur ve izin verilir.
async function requestScreenChoice (contents) {
  if (!screenShare.hasRecentActivation(state.activation.get(contents.id), Date.now())) return false
  if (state.pickerBusy || state.pendingDisplay) return false
  state.pickerBusy = true
  try {
    let sources = []
    try {
      const raw = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: THUMBNAIL_SIZE, fetchWindowIcons: false })
      sources = screenShare.toPickerSources(raw.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : ''
      })))
    } catch (err) {
      logError('desktopCapturer', err)
      return false
    }
    if (sources.length === 0 || contents.isDestroyed()) return false
    const choice = await openPicker(contents, sources)
    if (!choice || contents.isDestroyed()) return false
    setPendingDisplay(contents.id, choice)
    return true
  } finally {
    state.pickerBusy = false
  }
}

function openPicker (contents, sources) {
  return new Promise((resolve) => {
    const parent = BrowserWindow.fromWebContents(contents) || undefined
    const ses = session.fromPartition(PICKER_PARTITION)
    prepareOwnSession(ses, state.pages.picker)
    const win = new BrowserWindow({
      parent,
      modal: Boolean(parent),
      width: 780,
      height: 640,
      minWidth: 420,
      minHeight: 380,
      show: false,
      title: t('picker.windowTitle'),
      backgroundColor: BACKGROUND,
      autoHideMenuBar: true,
      icon: windowIcon(),
      webPreferences: webPreferences(path.join(__dirname, 'picker-preload.js'), PICKER_PARTITION)
    })
    win.setMenu(null)
    const windowContentsId = win.webContents.id
    state.contexts.set(windowContentsId, 'picker')
    let done = false
    const finish = (choice) => {
      if (done) return
      done = true
      clearTimeout(timer)
      state.picker = null
      state.contexts.delete(windowContentsId)
      if (!win.isDestroyed()) win.destroy()
      resolve(choice)
    }
    const timer = setTimeout(() => finish(null), screenShare.PICKER_TIMEOUT_MS)
    state.picker = { contentsId: contents.id, windowContentsId, sources, finish }
    win.on('closed', () => finish(null))
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show()
    })
    win.loadURL(PICKER_ORIGIN + '/').catch((err) => {
      logError('picker', err)
      finish(null)
    })
  })
}

function clearPendingDisplay () {
  if (state.pendingDisplay) clearTimeout(state.pendingDisplay.timer)
  state.pendingDisplay = null
}

function setPendingDisplay (contentsId, choice) {
  clearPendingDisplay()
  const pending = { contentsId, video: choice.video, systemAudio: choice.systemAudio, createdAt: Date.now(), timer: null }
  // İzin verildiği hâlde seçim getDisplayMedia işleyicisince tüketilmezse istek eski
  // chromeMediaSource yoludur ve seçiciyi atlayarak yakalama yapar. Sayfa yeniden yüklenerek
  // yakalama durdurulur (meşru istemci kodu bu yolu hiç kullanmaz).
  pending.timer = setTimeout(() => {
    if (state.pendingDisplay !== pending) return
    state.pendingDisplay = null
    const target = webContents.fromId(contentsId)
    logError('screen share', new Error('a screen capture permission was not used by getDisplayMedia, reloading the page'))
    if (target && !target.isDestroyed()) target.reload()
  }, screenShare.PENDING_TTL_MS)
  state.pendingDisplay = pending
}

function onDisplayMediaRequest (request, callback) {
  const pending = state.pendingDisplay
  clearPendingDisplay()
  let frame = null
  let contentsId = null
  try {
    if (request.frame) {
      frame = { url: request.frame.url, isMainFrame: request.frame.parent === null }
      const contents = webContents.fromFrame(request.frame)
      contentsId = contents ? contents.id : null
    }
  } catch (err) {
    frame = null
  }
  const accepted = screenShare.isAcceptableDisplayRequest(request, frame, APP_ORIGIN) &&
    isAlive(state.mainWindow) && contentsId === state.mainWindow.webContents.id &&
    screenShare.isPendingFresh(pending, contentsId, Date.now())
  const streams = accepted ? screenShare.buildStreams(pending, request, process.platform) : {}
  try {
    callback(streams)
  } catch (err) {
    // Çerçeve bu arada kapanmış olabilir
    logError('display media', err)
  }
}

// ------------------------------------------------------------------ pencereler

function attachContextMenu (contents) {
  contents.on('context-menu', (event, params) => {
    const items = []
    if (params.isEditable) {
      items.push(
        { label: t('context.cut'), role: 'cut', enabled: params.editFlags.canCut },
        { label: t('context.copy'), role: 'copy', enabled: params.editFlags.canCopy },
        { label: t('context.paste'), role: 'paste', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { label: t('context.selectAll'), role: 'selectAll' }
      )
    } else if (params.selectionText) {
      items.push({ label: t('context.copy'), role: 'copy' })
    }
    if (items.length === 0) return
    const win = BrowserWindow.fromWebContents(contents)
    Menu.buildFromTemplate(items).popup(win ? { window: win } : {})
  })
}

function showWhenReady (win) {
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show()
  })
  // ready-to-show bazı Linux masaüstlerinde gecikirse pencere yine de gösterilir
  const fallback = setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show()
  }, 5000)
  win.once('closed', () => clearTimeout(fallback))
}

function openMainWindow () {
  const origin = state.settings.server
  if (!serverUrl.isValidOrigin(origin)) {
    openConnectWindow()
    return
  }
  const partition = partitionFor(origin)
  prepareAppSession(session.fromPartition(partition), origin)
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 380,
    minHeight: 500,
    show: false,
    title: 'Telsiz',
    backgroundColor: BACKGROUND,
    icon: windowIcon(),
    webPreferences: webPreferences(path.join(__dirname, 'preload.js'), partition, {
      additionalArguments: [VERSION_ARG + app.getVersion()]
    })
  })
  const id = win.webContents.id
  state.contexts.set(id, 'app')
  diag.log('window', { context: 'app', contents: id })
  state.mainWindow = win
  state.mainOrigin = origin
  // Bu frekansın arka plan penceresi uygulama penceresi yüklenmeden kapanır, diğerleri biraz sonra açılır
  backgroundWindows.setActive(origin)
  attachContextMenu(win.webContents)
  showWhenReady(win)
  win.on('close', (event) => {
    if (state.quitting || state.mainWindow !== win) return
    if (state.settings.closeToTray && state.tray) {
      event.preventDefault()
      win.hide()
      showTrayHint()
    }
  })
  win.on('closed', () => {
    state.contexts.delete(id)
    state.activation.delete(id)
    if (state.picker && state.picker.contentsId === id) state.picker.finish(null)
    if (state.pendingDisplay && state.pendingDisplay.contentsId === id) clearPendingDisplay()
    if (state.mainWindow === win) {
      state.mainWindow = null
      state.mainOrigin = null
      // Uygulama penceresi gerçekten kapandı (geçiş değil): arka plan pencereleri de kapanır
      backgroundWindows.stop()
    }
  })
  win.webContents.on('render-process-gone', (event, details) => logError('renderer', new Error(details.reason)))
  win.loadURL(APP_ORIGIN + '/').catch((err) => logError('load', err))
}

function showMain () {
  const win = state.mainWindow
  if (isAlive(win)) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return
  }
  if (isAlive(state.connectWindow)) {
    state.connectWindow.show()
    state.connectWindow.focus()
    return
  }
  if (state.settings.server) openMainWindow()
  else openConnectWindow()
}

function openConnectWindow () {
  if (isAlive(state.connectWindow)) {
    state.connectWindow.show()
    state.connectWindow.focus()
    return
  }
  prepareOwnSession(session.fromPartition(CONNECT_PARTITION), state.pages.connect)
  const parent = isAlive(state.mainWindow) && state.mainWindow.isVisible() ? state.mainWindow : undefined
  const win = new BrowserWindow({
    parent,
    width: 560,
    height: 640,
    minWidth: 360,
    minHeight: 480,
    show: false,
    title: t('connect.windowTitle'),
    backgroundColor: BACKGROUND,
    autoHideMenuBar: true,
    icon: windowIcon(),
    webPreferences: webPreferences(path.join(__dirname, 'connect-preload.js'), CONNECT_PARTITION)
  })
  win.setMenu(null)
  const id = win.webContents.id
  state.contexts.set(id, 'connect')
  diag.log('window', { context: 'connect', contents: id })
  state.connectWindow = win
  attachContextMenu(win.webContents)
  showWhenReady(win)
  win.on('closed', () => {
    state.contexts.delete(id)
    if (state.connectWindow === win) state.connectWindow = null
  })
  win.loadURL(CONNECT_ORIGIN + '/').catch((err) => logError('load', err))
}

function closeConnectWindow () {
  const win = state.connectWindow
  if (isAlive(win)) win.close()
}

// Kaydedilen sunucuya geçer: aynı sunucuysa yalnızca pencereyi gösterir, farklıysa yeni sunucunun
// oturum bölümüyle yeni bir pencere açar ve eskisini kapatır
function applyServer (origin) {
  const old = state.mainWindow
  if (isAlive(old) && state.mainOrigin === origin) {
    closeConnectWindow()
    showMain()
    return
  }
  state.mainWindow = null
  openMainWindow()
  if (isAlive(old)) old.destroy()
  closeConnectWindow()
}

async function submitServer (address, acceptMismatch) {
  if (state.connectBusy) return { ok: false, code: 'busy' }
  state.connectBusy = true
  try {
    const parsed = serverUrl.parseServerUrl(address)
    if (!parsed.ok) return { ok: false, code: parsed.code }
    const ses = session.fromPartition(CONNECT_PARTITION)
    const info = await serverUrl.checkServer((url, init) => ses.fetch(url, init), parsed.origin, app.getVersion())
    if (!info.ok) return { ok: false, code: info.code, origin: parsed.origin }
    if (!info.compatible && acceptMismatch !== true) {
      return { ok: false, code: 'version', reason: info.reason, origin: parsed.origin, serverName: info.serverName, serverVersion: info.version, appVersion: app.getVersion() }
    }
    // Yeni frekans listeye eklenir (zaten varsa adı ve kullanım zamanı güncellenir) ve etkin olur
    frequencyControl.added(parsed.origin, info.serverName)
    return { ok: true, origin: parsed.origin, serverName: info.serverName }
  } finally {
    state.connectBusy = false
  }
}

// ------------------------------------------------------------------ frekanslar

// Bir frekansın bu cihazdaki oturum verisi (giriş, yerel depolama, önbellek). Yalnızca kullanıcı
// açıkça isterse silinir.
async function clearFrequencyData (origin) {
  try {
    const ses = session.fromPartition(partitionFor(origin))
    await ses.clearStorageData()
    await ses.clearCache()
  } catch (err) {
    logError('clear data', err)
  }
}

// Son frekans listeden çıkarılınca: uygulama penceresi kapanır, frekans adresi penceresi açılır
function closeToConnect () {
  const old = state.mainWindow
  state.mainWindow = null
  state.mainOrigin = null
  backgroundWindows.stop()
  openConnectWindow()
  if (isAlive(old)) old.destroy()
}

// Geçiş, ekleme, çıkarma ve ad bildirimi (src/lib/frequencies.js). Geçişte uygulama penceresi o
// frekansın oturum bölümüyle yeniden açılır, eski pencere (ve varsa ses bağlantısı) kapanır.
const frequencyControl = frequencies.createController({
  settings: () => state.settings,
  persist: () => {
    persistSettings()
    refreshMenus()
    backgroundWindows.listChanged()
  },
  windowOrigin: () => state.mainOrigin,
  apply: (origin) => applyServer(origin),
  closeToConnect,
  clearData: (origin) => clearFrequencyData(origin),
  defer: (fn) => setImmediate(fn),
  now: () => Date.now()
})

// ------------------------------------------------------------------ arka plan sayımı

// Açık olmayan bir frekansın gizli penceresi: aynı uygulama paketi, ön yükleme betiği, korumalı alan ve
// CSP, o frekansın oturum bölümü. Ön yükleme betiği --telsiz-background argümanıyla istemcinin arka plan
// kipini açar (public/js/25-arka-plan.js). Pencere görünmez, görev çubuğunda yoktur, sesi kapalıdır,
// görseller yüklenmez. backgroundThrottling kapalıdır: istemcinin yeniden deneme ve rapor zamanlayıcıları
// gizli pencerede de zamanında çalışmalı (uygulama zaten zamanlayıcı kısmayı genel olarak kapatır).
function createBackgroundWindow (origin) {
  const partition = partitionFor(origin)
  prepareAppSession(session.fromPartition(partition), origin)
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    skipTaskbar: true,
    focusable: false,
    paintWhenInitiallyHidden: false,
    title: 'Telsiz',
    backgroundColor: BACKGROUND,
    webPreferences: webPreferences(path.join(__dirname, 'preload.js'), partition, {
      additionalArguments: [VERSION_ARG + app.getVersion(), BACKGROUND_ARG + origin],
      backgroundThrottling: false,
      images: false,
      autoplayPolicy: 'document-user-activation-required'
    })
  })
  const contents = win.webContents
  const id = contents.id
  state.contexts.set(id, 'background')
  diag.log('window', { context: 'background', contents: id })
  contents.setAudioMuted(true)
  win.on('closed', () => {
    state.contexts.delete(id)
    backgroundWindows.windowGone(id)
  })
  contents.on('render-process-gone', (event, details) => {
    logError('background renderer', new Error(details.reason))
    if (!win.isDestroyed()) win.destroy()
  })
  win.loadURL(APP_ORIGIN + '/').catch((err) => logError('background load', err))
  return {
    id,
    destroy: () => {
      if (!win.isDestroyed()) win.destroy()
    }
  }
}

// Erişilebilirlik yoklaması: GET <köken>/api/info zaman aşımıyla. Yanıttaki frekans fotoğrafı karması da
// döner (arka plan yöneticisi karma değişince fotoğrafı indirir).
async function probeFrequency (origin) {
  const ses = session.fromPartition(PROBE_PARTITION)
  const info = await serverUrl.checkServer((url, init) => ses.fetch(url, init), origin, app.getVersion(), { timeoutMs: background.PROBE_TIMEOUT_MS })
  return info.ok === true ? { ok: true, icon: info.serverIcon } : { ok: false }
}

// Frekans fotoğrafı: yoklamayla aynı çerezsiz oturum bölümünden indirilir, src/lib/server-icon.js tür, boyut
// ve karma denetiminden sonra data: adresine çevirir
function fetchFrequencyIcon (origin, hash) {
  const ses = session.fromPartition(PROBE_PARTITION)
  return serverIcon.fetchIcon((url, init) => ses.fetch(url, init), origin, hash)
}

// Arka plan penceresinin öğrendiği sunucu adı listeye yazılır (yalnızca o frekansın adı, değiştiyse)
function noteBackgroundName (origin, name) {
  const entry = state.settings.frequencies.find((item) => item.origin === origin)
  if (!entry || entry.name === name) return
  state.settings.frequencies = frequencies.upsert(state.settings.frequencies, origin, { name })
  persistSettings()
  refreshMenus()
}

function pushBackgroundState (snapshot) {
  const win = state.mainWindow
  if (!isAlive(win) || win.webContents.isDestroyed()) return
  win.webContents.send(CHANNELS.bgState, snapshot)
}

const backgroundWindows = background.createManager({
  frequencies: () => state.settings.frequencies,
  active: () => state.mainOrigin,
  createWindow: (origin) => createBackgroundWindow(origin),
  probe: (origin) => probeFrequency(origin),
  fetchIcon: (origin, hash) => fetchFrequencyIcon(origin, hash),
  push: (snapshot) => pushBackgroundState(snapshot),
  setName: (origin, name) => noteBackgroundName(origin, name),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle),
  now: () => Date.now()
})

// Menüde ve tepside frekans listesi: etkin frekans işaretli, en altta Frekans ekle
function frequencyMenuItems () {
  const list = frequencies.publicList(state.settings.server, state.settings.frequencies).items
  const items = list.map((item) => ({
    // Windows menüleri & işaretini kısayol harfi sayar
    label: frequencies.displayName(item).replace(/&/g, '&&'),
    type: 'radio',
    checked: item.active,
    click: () => frequencyControl.switchTo(item.origin)
  }))
  if (items.length > 0) items.push({ type: 'separator' })
  items.push({ label: t('menu.changeServer'), click: () => openConnectWindow() })
  return items
}

function refreshMenus () {
  buildMenu()
  updateTrayMenu()
}

// ------------------------------------------------------------------ güncellemeler

function updateSnapshot () {
  return state.updates ? state.updates.snapshot() : null
}

// Menüde ve tepside, kullanıcının yapabileceği bir güncelleme eylemi varsa en üstte gösterilir
function updateActionItems () {
  const snap = updateSnapshot()
  if (!snap) return []
  if (snap.canInstall) return [{ label: t('update.install', { version: snap.version || '' }), click: () => installUpdate() }]
  if (snap.mode === 'notify' && snap.status === 'available') return [{ label: t('update.available', { version: snap.version || '' }), click: () => openReleasePage() }]
  return []
}

function checkForUpdatesItem () {
  const snap = updateSnapshot()
  return {
    label: t('menu.checkUpdates'),
    enabled: Boolean(snap && snap.enabled && snap.status !== 'checking' && snap.status !== 'downloading'),
    click: () => {
      if (state.updates) state.updates.checkNow().catch((err) => logError('updates', err))
    }
  }
}

function installUpdate () {
  return state.updates ? state.updates.install() : { ok: false, code: 'unavailable' }
}

function openReleasePage () {
  const url = state.updates ? state.updates.releaseUrl() : null
  if (!url || !updates.isReleasePageUrl(url)) return { ok: false, code: 'unavailable' }
  openExternal(url)
  return { ok: true }
}

// Durum değişikliği sayfaya bildirilir. Menüler yalnızca durum değişince yeniden kurulur
// (indirme yüzdesi her değiştiğinde değil).
function onUpdateChange (snapshot, statusChanged) {
  const win = state.mainWindow
  if (isAlive(win) && !win.webContents.isDestroyed()) win.webContents.send(CHANNELS.updatesState, snapshot)
  if (statusChanged || state.updateStatus !== snapshot.status + ':' + snapshot.enabled) {
    state.updateStatus = snapshot.status + ':' + snapshot.enabled
    refreshMenus()
  }
}

function createUpdates (schedule) {
  const mode = updates.detectMode({ platform: process.platform, env: process.env, isPackaged: app.isPackaged })
  const ses = session.fromPartition(UPDATE_PARTITION, { cache: false })
  ses.setPermissionRequestHandler((contents, permission, callback) => callback(false))
  ses.setPermissionCheckHandler(() => false)
  state.updates = updates.createController({
    mode,
    current: app.getVersion(),
    getEnabled: () => state.settings.autoUpdate === true,
    saveEnabled: (value) => {
      state.settings.autoUpdate = value
      persistSettings()
    },
    fetch: (url, init) => ses.fetch(url, init),
    // electron-updater yalnızca ayar açıkken ve ilk denetimde yüklenir
    loadUpdater: () => require('electron-updater').autoUpdater,
    onChange: onUpdateChange,
    beforeInstall: () => {
      state.quitting = true
    },
    log: logError,
    schedule
  })
  diag.log('updates', { mode: mode.mode, kind: mode.kind, enabled: state.settings.autoUpdate, schedule })
  state.updates.start()
}

// ------------------------------------------------------------------ menü, tepsi, kısayollar

function showAbout () {
  const parent = BrowserWindow.getFocusedWindow() || undefined
  const options = {
    type: 'info',
    title: t('about.title'),
    message: 'Telsiz',
    detail: t('about.detail', { version: app.getVersion(), electron: process.versions.electron, server: state.settings.server || t('about.noServer') }),
    buttons: ['OK']
  }
  const shown = parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options)
  shown.catch(noop)
}

function buildMenu () {
  const view = [
    { label: t('menu.reload'), role: 'reload' },
    { type: 'separator' },
    { label: t('menu.zoomIn'), role: 'zoomIn' },
    { label: t('menu.zoomOut'), role: 'zoomOut' },
    { label: t('menu.resetZoom'), role: 'resetZoom' },
    { type: 'separator' },
    { label: t('menu.fullScreen'), role: 'togglefullscreen' }
  ]
  if (IS_DEV) view.push({ type: 'separator' }, { label: t('menu.devTools'), role: 'toggleDevTools' })
  const template = [
    {
      label: t('menu.app'),
      submenu: [
        { label: t('menu.frequencies'), submenu: frequencyMenuItems() },
        { type: 'separator' },
        { label: t('menu.closeToTray'), type: 'checkbox', checked: state.settings.closeToTray, enabled: Boolean(state.tray), click: (item) => setCloseToTray(item.checked) },
        { type: 'separator' },
        ...updateActionItems(),
        { label: t('menu.quit'), accelerator: 'CommandOrControl+Q', click: () => quitApp() }
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        { label: t('menu.undo'), role: 'undo' },
        { label: t('menu.redo'), role: 'redo' },
        { type: 'separator' },
        { label: t('menu.cut'), role: 'cut' },
        { label: t('menu.copy'), role: 'copy' },
        { label: t('menu.paste'), role: 'paste' },
        { type: 'separator' },
        { label: t('menu.selectAll'), role: 'selectAll' }
      ]
    },
    { label: t('menu.view'), submenu: view },
    {
      label: t('menu.help'),
      submenu: [
        { label: t('menu.about'), click: () => showAbout() },
        checkForUpdatesItem(),
        { label: t('menu.project'), click: () => openExternal(HOMEPAGE) }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function trayImage () {
  const small = process.platform === 'win32' ? 'tray-16.png' : 'tray-24.png'
  const large = process.platform === 'win32' ? 'tray-32.png' : 'tray-48.png'
  const image = loadIcon(small)
  if (!image) return null
  const big = loadIcon(large)
  if (big) {
    const size = big.getSize()
    image.addRepresentation({ scaleFactor: 2, width: size.width, height: size.height, buffer: big.toPNG() })
  }
  return image
}

function createTray () {
  const image = trayImage()
  if (!image) return
  try {
    state.tray = new Tray(image)
  } catch (err) {
    logError('tray', err)
    state.tray = null
    return
  }
  state.tray.setToolTip(t('tray.tooltip'))
  updateTrayMenu()
  state.tray.on('click', () => showMain())
}

function updateTrayMenu () {
  if (!state.tray) return
  const actions = updateActionItems()
  if (actions.length > 0) actions.push({ type: 'separator' })
  state.tray.setContextMenu(Menu.buildFromTemplate(actions.concat([
    { label: t('tray.open'), click: () => showMain() },
    { label: t('tray.toggleMute'), click: () => sendShortcut('toggleMute') },
    { label: t('tray.frequencies'), submenu: frequencyMenuItems() },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => quitApp() }
  ])))
}

function showTrayHint () {
  if (state.trayHintShown || !state.tray) return
  state.trayHintShown = true
  if (process.platform === 'win32') {
    try {
      state.tray.displayBalloon({ title: t('tray.hintTitle'), content: t('tray.hintBody'), iconType: 'info' })
    } catch (err) {
      logError('tray', err)
    }
  }
}

function sendShortcut (action) {
  if (!ACTIONS.includes(action)) return
  const win = state.mainWindow
  if (!isAlive(win) || win.webContents.isDestroyed()) return
  win.webContents.send(CHANNELS.shortcut, action)
}

function applyShortcuts (map) {
  for (const accelerator of state.registeredAccelerators) {
    try {
      globalShortcut.unregister(accelerator)
    } catch (err) {
      logError('shortcut', err)
    }
  }
  state.registeredAccelerators = []
  const status = {}
  for (const action of ACTIONS) {
    const accelerator = map[action]
    if (!accelerator) {
      status[action] = null
      continue
    }
    let registered = false
    try {
      registered = globalShortcut.register(accelerator, () => sendShortcut(action))
    } catch (err) {
      registered = false
    }
    if (registered) state.registeredAccelerators.push(accelerator)
    status[action] = registered
  }
  state.shortcutStatus = status
}

function settingsSnapshot () {
  return {
    server: state.settings.server,
    closeToTray: state.settings.closeToTray,
    trayAvailable: Boolean(state.tray),
    shortcuts: Object.assign({}, state.settings.shortcuts),
    registered: Object.assign({}, state.shortcutStatus)
  }
}

function setCloseToTray (value) {
  if (typeof value !== 'boolean') return { ok: false, code: 'invalid' }
  if (value && !state.tray) return { ok: false, code: 'tray_unavailable' }
  state.settings.closeToTray = value
  persistSettings()
  buildMenu()
  return Object.assign({ ok: true }, settingsSnapshot())
}

function quitApp () {
  state.quitting = true
  app.quit()
}

// ------------------------------------------------------------------ IPC

function registerIpc () {
  ipcMain.handle(CHANNELS.getServer, (event) => {
    requireSender(event, 'app')
    return state.settings.server
  })
  ipcMain.handle(CHANNELS.changeServer, (event) => {
    requireSender(event, 'app')
    openConnectWindow()
    return true
  })
  ipcMain.handle(CHANNELS.getSettings, (event) => {
    requireSender(event, 'app')
    return settingsSnapshot()
  })
  ipcMain.handle(CHANNELS.setShortcuts, (event, map) => {
    requireSender(event, 'app')
    const checked = shortcuts.validateShortcutMap(map)
    if (!checked.ok) return { ok: false, code: checked.code }
    state.settings.shortcuts = checked.map
    persistSettings()
    applyShortcuts(checked.map)
    return Object.assign({ ok: true }, settingsSnapshot())
  })
  ipcMain.handle(CHANNELS.setCloseToTray, (event, value) => {
    requireSender(event, 'app')
    return setCloseToTray(value)
  })
  ipcMain.handle(CHANNELS.listFrequencies, (event) => {
    requireSender(event, 'app')
    return frequencyControl.list()
  })
  ipcMain.handle(CHANNELS.switchFrequency, (event, origin) => {
    requireSender(event, 'app')
    return frequencyControl.switchTo(origin)
  })
  ipcMain.handle(CHANNELS.addFrequency, (event) => {
    requireSender(event, 'app')
    openConnectWindow()
    return true
  })
  ipcMain.handle(CHANNELS.removeFrequency, (event, origin, clearData) => {
    requireSender(event, 'app')
    return frequencyControl.remove(origin, clearData)
  })
  ipcMain.handle(CHANNELS.setFrequencyName, (event, name) => {
    requireSender(event, 'app')
    return frequencyControl.setName(name)
  })
  ipcMain.handle(CHANNELS.updatesGet, (event) => {
    requireSender(event, 'app')
    return updateSnapshot()
  })
  ipcMain.handle(CHANNELS.updatesCheck, (event) => {
    requireSender(event, 'app')
    return state.updates ? state.updates.checkNow() : { ok: false, code: 'unavailable' }
  })
  ipcMain.handle(CHANNELS.updatesInstall, (event) => {
    requireSender(event, 'app')
    return installUpdate()
  })
  ipcMain.handle(CHANNELS.updatesSetAuto, (event, value) => {
    requireSender(event, 'app')
    return state.updates ? state.updates.setEnabled(value) : { ok: false, code: 'unavailable' }
  })
  ipcMain.handle(CHANNELS.updatesOpenRelease, (event) => {
    requireSender(event, 'app')
    return openReleasePage()
  })
  ipcMain.on(CHANNELS.userActivation, (event) => {
    if (senderIs(event, 'app')) state.activation.set(event.sender.id, Date.now())
  })
  // Arka plan sayımı: rapor yalnızca kayıtlı arka plan penceresinden, durum yalnızca uygulama penceresine
  ipcMain.on(CHANNELS.bgReport, (event, report) => {
    if (senderIs(event, 'background')) backgroundWindows.report(event.sender.id, report)
  })
  ipcMain.handle(CHANNELS.bgOpen, (event) => {
    requireSender(event, 'background')
    const origin = backgroundWindows.ownerOf(event.sender.id)
    const now = Date.now()
    if (!origin || now - state.lastBackgroundOpen < BG_OPEN_INTERVAL_MS) return { ok: false }
    state.lastBackgroundOpen = now
    showMain()
    return frequencyControl.switchTo(origin)
  })
  ipcMain.handle(CHANNELS.bgGet, (event) => {
    requireSender(event, 'app')
    return backgroundWindows.snapshot()
  })

  ipcMain.handle(CHANNELS.connectInit, (event) => {
    requireSender(event, 'connect')
    return {
      lang: state.lang,
      strings: strings.subset(state.lang, 'connect.'),
      current: state.settings.server,
      mode: state.settings.frequencies.length > 0 ? 'add' : 'first',
      canCancel: Boolean(state.settings.server),
      appVersion: app.getVersion()
    }
  })
  ipcMain.handle(CHANNELS.connectSubmit, (event, address, acceptMismatch) => {
    requireSender(event, 'connect')
    if (typeof address !== 'string' || address.length > MAX_ADDRESS_INPUT || typeof acceptMismatch !== 'boolean') {
      return { ok: false, code: 'invalid' }
    }
    return submitServer(address, acceptMismatch)
  })
  ipcMain.handle(CHANNELS.connectCancel, (event) => {
    requireSender(event, 'connect')
    if (state.settings.server) closeConnectWindow()
    return true
  })

  ipcMain.handle(CHANNELS.pickerInit, (event) => {
    requireSender(event, 'picker')
    return {
      lang: state.lang,
      strings: strings.subset(state.lang, 'picker.'),
      sources: state.picker.sources,
      systemAudio: screenShare.systemAudioSupported(process.platform)
    }
  })
  ipcMain.handle(CHANNELS.pickerChoose, (event, id, systemAudio) => {
    requireSender(event, 'picker')
    const choice = screenShare.resolveChoice(state.picker.sources, { id, systemAudio }, process.platform)
    if (!choice) return { ok: false }
    state.picker.finish(choice)
    return { ok: true }
  })
  ipcMain.handle(CHANNELS.pickerCancel, (event) => {
    requireSender(event, 'picker')
    state.picker.finish(null)
    return true
  })
}

// ------------------------------------------------------------------ uygulama düzeyi korumalar

// Tanı günlüğü açıkken her sayfanın yükleme, ön yükleme ve süreç olayları yazılır
function watchContents (contents) {
  const id = contents.id
  const tag = (extra) => Object.assign({ contents: id, context: contextOf(contents) || null }, extra || {})
  contents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) diag.log('did-start-navigation', tag({ url: details.url }))
  })
  contents.on('did-navigate', (event, url, httpResponseCode) => diag.log('did-navigate', tag({ url, httpResponseCode })))
  contents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    diag.log('did-fail-load', tag({ errorCode, errorDescription, url: validatedURL, isMainFrame }))
  })
  contents.on('did-finish-load', () => diag.log('did-finish-load', tag({ url: contents.getURL() })))
  contents.on('preload-error', (event, preloadPath, error) => diag.log('preload-error', tag({ preload: path.basename(preloadPath), error })))
  contents.on('render-process-gone', (event, details) => diag.log('render-process-gone', tag({ reason: details.reason, exitCode: details.exitCode })))
  contents.on('unresponsive', () => diag.log('unresponsive', tag()))
  contents.on('responsive', () => diag.log('responsive', tag()))
  contents.on('console-message', (details) => {
    if (details.level === 'warning' || details.level === 'error') {
      diag.log('console-' + details.level, tag({ message: details.message, source: details.sourceId, line: details.lineNumber }))
    }
  })
  contents.once('destroyed', () => diag.log('contents-destroyed', { contents: id }))
}

// Çerçevenin ana çerçeveye uzaklığı (doğrudan alt çerçeve 1). Çerçeve bilinmiyorsa veya kapanmışsa -1.
function frameDepth (frame) {
  let depth = 0
  try {
    let current = frame
    if (!current) return -1
    while (current.parent) {
      depth++
      current = current.parent
      if (depth > 32) return -1
    }
  } catch (err) {
    return -1
  }
  return depth
}

function installGuards () {
  app.on('web-contents-created', (event, contents) => {
    if (diag.enabled) watchContents(contents)
    contents.on('will-attach-webview', (e) => e.preventDefault())
    contents.setWindowOpenHandler((details) => {
      const referrer = details.referrer && typeof details.referrer.url === 'string' ? details.referrer.url : ''
      if (contextOf(contents) === 'app' && navigation.decideAppWindowOpen(details.url, referrer) === 'external') openExternal(details.url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (details) => {
      const context = contextOf(contents)
      const decision = navigation.decideNavigation(details.url, context)
      if (decision === 'allow') return
      details.preventDefault()
      if (decision === 'external' && context === 'app') openExternal(details.url)
    })
    // Alt çerçevelerde yalnızca Telsiz DJ'nin YouTube oynatıcısı açılabilir (navigation.decideFrameNavigation),
    // ana çerçeve yukarıda ele alınır
    contents.on('will-frame-navigate', (details) => {
      if (details.isMainFrame) return
      if (navigation.decideFrameNavigation(details.url, contextOf(contents), frameDepth(details.frame)) !== 'allow') details.preventDefault()
    })
    contents.on('will-redirect', (details) => {
      const context = contextOf(contents)
      const decision = details.isMainFrame === false
        ? navigation.decideFrameNavigation(details.url, context, frameDepth(details.frame))
        : navigation.decideNavigation(details.url, context)
      if (decision !== 'allow') details.preventDefault()
    })
  })
  // Sertifika hataları hiçbir zaman yok sayılmaz
  app.on('certificate-error', (event, contents, url, error, certificate, callback) => {
    event.preventDefault()
    callback(false)
  })
  // İstemci sertifikası hiçbir sunucuya kendiliğinden gönderilmez
  app.on('select-client-certificate', (event, contents, url, list, callback) => {
    event.preventDefault()
    callback()
  })
  // HTTP kimlik doğrulama istekleri iptal edilir
  app.on('login', (event, contents, details, authInfo, callback) => {
    event.preventDefault()
    callback()
  })
}

// ------------------------------------------------------------------ başlatma

// Açılışı durduran hata (ör. bütünlük denetimi). Neden her zaman stderr'e yazılır ve kullanıcıya
// engelleyici bir hata kutusuyla gösterilir. Tanı günlüğü açıksa (gözetimsiz çalıştırma, duman
// testi) kutu açılmaz: kapatacak kimse olmadığından süreç sonsuza dek beklerdi.
function showFatal (err) {
  const message = String(err && err.message ? err.message : err)
  const files = err && Array.isArray(err.files) && err.files.length > 0 ? err.files.slice(0, 10).join(', ') : message
  logError('fatal', message + (files !== message ? ' (' + files + ')' : ''))
  if (!diag.enabled) dialog.showErrorBox(t('integrity.title'), t('integrity.body', { files }))
  app.exit(1)
}

function start () {
  state.lang = strings.pickLang([].concat(app.getPreferredSystemLanguages(), [app.getLocale()]))
  state.t = strings.translator(state.lang)
  try {
    state.files = integrity.loadVerifiedFiles(APP_DIR)
    state.pages = loadPages()
  } catch (err) {
    showFatal(err)
    return
  }
  diag.log('integrity-ok', { files: state.files.size, lang: state.lang })
  state.settingsFile = path.join(app.getPath('userData'), settingsStore.FILE_NAME)
  state.settings = settingsStore.load(state.settingsFile)
  diag.log('settings', { userData: app.getPath('userData'), hasServer: Boolean(state.settings.server), frequencies: state.settings.frequencies.length })
  installGuards()
  registerIpc()
  createUpdates(state.scheduleUpdates)
  createTray()
  diag.log('tray', { available: Boolean(state.tray) })
  if (!state.tray) state.settings.closeToTray = false
  buildMenu()
  applyShortcuts(state.settings.shortcuts)
  if (state.settings.server) openMainWindow()
  else openConnectWindow()
}

const singleInstance = app.requestSingleInstanceLock()
diag.log('single-instance-lock', { acquired: singleInstance })
if (!singleInstance) {
  app.quit()
} else {
  app.on('second-instance', () => {
    diag.log('second-instance')
    if (app.isReady() && state.files) showMain()
  })
  app.on('before-quit', () => {
    state.quitting = true
    backgroundWindows.stop()
  })
  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
  })
  app.on('window-all-closed', () => {
    app.quit()
  })
  app.whenReady().then(() => {
    diag.log('ready')
    // Playwright otomasyonunda ilk pencere Playwright bağlandıktan sonra açılır (src/lib/automation.js)
    return automation.waitForAutomation({ env: process.env, inspectorUrl: () => require('node:inspector').url(), target: globalThis })
  }).then((gate) => {
    if (gate !== 'off') diag.log('automation', { gate })
    if (gate === 'timeout') logError('automation', new Error('__playwright_run was not called, starting anyway'))
    // Duman testi ve otomasyon GitHub'a kendiliğinden istek göndermez
    state.scheduleUpdates = gate === 'off' && !diag.enabled
    start()
  }).catch((err) => {
    logError('start', err)
    app.exit(1)
  })
}
