'use strict'

// Uygulama penceresinin ön yükleme betiği (korumalı alan ve bağlam yalıtımıyla çalışır).
// Sayfaya yalnızca dar bir API açar: window.telsizDesktop. Node.js, ipcRenderer veya Electron
// nesneleri sayfaya hiçbir zaman verilmez. Her çağrı sabit adlı bir IPC kanalına gider ve
// girdiler ana süreçte yeniden doğrulanır (src/main.js).
// Korumalı alandaki ön yükleme betiği yerel dosya yükleyemediği için sabitler burada yeniden
// tanımlanır, src/lib/channels.js ile aynı oldukları testle denetlenir.

const { contextBridge, ipcRenderer } = require('electron')

const CHANNELS = {
  getServer: 'telsiz:get-server',
  changeServer: 'telsiz:change-server',
  getSettings: 'telsiz:get-settings',
  setShortcuts: 'telsiz:set-shortcuts',
  setCloseToTray: 'telsiz:set-close-to-tray',
  shortcut: 'telsiz:shortcut',
  setPtt: 'telsiz:set-ptt',
  pttVoice: 'telsiz:ptt-voice',
  pttHold: 'telsiz:ptt-hold',
  userActivation: 'telsiz:user-activation',
  titleBarInfo: 'telsiz:title-bar-info',
  titleBarColors: 'telsiz:title-bar-colors',
  titleBarMenu: 'telsiz:title-bar-menu',
  titleBarFullscreen: 'telsiz:title-bar-fullscreen',
  listFrequencies: 'telsiz:list-frequencies',
  switchFrequency: 'telsiz:switch-frequency',
  addFrequency: 'telsiz:add-frequency',
  removeFrequency: 'telsiz:remove-frequency',
  setFrequencyName: 'telsiz:set-frequency-name',
  updatesGet: 'telsiz:updates-get',
  updatesCheck: 'telsiz:updates-check',
  updatesInstall: 'telsiz:updates-install',
  updatesSetAuto: 'telsiz:updates-set-auto',
  updatesOpenRelease: 'telsiz:updates-open-release',
  updatesState: 'telsiz:updates-state',
  bgReport: 'telsiz:bg-report',
  bgOpen: 'telsiz:bg-open',
  bgState: 'telsiz:bg-state',
  bgGet: 'telsiz:bg-get'
}
const ACTIONS = ['toggleMute', 'toggleDeafen', 'pttToggle']
const HOLD_PHASES = ['start', 'end']
const PTT_MODES = ['toggle', 'hold']
const VERSION_ARG = '--telsiz-version='
const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/
const ACTIVATION_INTERVAL_MS = 1000
// Güncelleme durumu yalnızca bu değerlerle sayfaya verilir (src/lib/updates.js ile aynı)
const UPDATE_STATUSES = ['idle', 'checking', 'up-to-date', 'available', 'downloading', 'downloaded', 'error']
const UPDATE_ERRORS = ['network', 'timeout', 'rate_limited', 'not_found', 'http', 'invalid', 'failed']
const UPDATE_KINDS = ['nsis', 'appimage', 'portable', 'deb', 'dev', 'other']
const UPDATE_CODES = ['disabled', 'invalid', 'not_ready', 'unavailable'].concat(UPDATE_ERRORS)

function readVersion () {
  const args = Array.isArray(process.argv) ? process.argv : []
  const arg = args.find((value) => typeof value === 'string' && value.startsWith(VERSION_ARG))
  const value = arg ? arg.slice(VERSION_ARG.length) : ''
  return VERSION_RE.test(value) ? value : ''
}

// Genel kısayol olayları yalnızca izinli eylem adlarıyla sayfaya iletilir (olay nesnesi verilmez)
const listeners = new Set()
ipcRenderer.on(CHANNELS.shortcut, (event, action) => {
  if (!ACTIONS.includes(action)) return
  for (const callback of Array.from(listeners)) {
    try {
      callback(action)
    } catch (err) {
      // Sayfanın işleyicisindeki hata diğer işleyicileri etkilemez
    }
  }
})

// Basılı tut kancasının olayları: yalnızca 'start' (konuş başla) ve 'end' (konuş bitti) sayfaya iletilir
const holdListeners = new Set()
ipcRenderer.on(CHANNELS.pttHold, (event, phase) => {
  if (!HOLD_PHASES.includes(phase)) return
  for (const callback of Array.from(holdListeners)) {
    try {
      callback(phase)
    } catch (err) {
      // Sayfanın işleyicisindeki hata diğer işleyicileri etkilemez
    }
  }
})

// Bas konuş ayarının yalnızca bilinen alanları, türleri denetlenerek ana sürece gider (ana süreç yeniden doğrular)
// Bilinmeyen kip boş dizgeye, metin olmayan tuş false değerine çevrilir, ikisini de ana süreç reddeder
function copyPtt (value) {
  const v = value && typeof value === 'object' ? value : {}
  const key = v.holdKey
  return {
    mode: PTT_MODES.includes(v.mode) ? v.mode : '',
    holdKey: key === undefined || key === null ? null : (typeof key === 'string' ? key : false)
  }
}

// Ana süreçten gelen güncelleme durumunun yalnızca bilinen alanları, türleri denetlenerek kopyalanır
function cleanUpdateState (raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  const version = (value) => typeof value === 'string' && VERSION_RE.test(value) ? value : null
  return {
    enabled: s.enabled === true,
    mode: s.mode === 'auto' ? 'auto' : 'notify',
    kind: UPDATE_KINDS.includes(s.kind) ? s.kind : 'other',
    current: version(s.current) || '',
    status: UPDATE_STATUSES.includes(s.status) ? s.status : 'idle',
    version: version(s.version),
    percent: Number.isInteger(s.percent) && s.percent >= 0 && s.percent <= 100 ? s.percent : null,
    lastCheckAt: Number.isFinite(s.lastCheckAt) && s.lastCheckAt > 0 ? s.lastCheckAt : null,
    error: UPDATE_ERRORS.includes(s.error) ? s.error : null,
    canInstall: s.canInstall === true
  }
}

function cleanUpdateResult (raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const out = { ok: r.ok === true }
  if (UPDATE_CODES.includes(r.code)) out.code = r.code
  if (r.state && typeof r.state === 'object') out.state = cleanUpdateState(r.state)
  return out
}

// Başlık şeridinin bilgisi: kaplama açık mı, şeridin erişilebilir adı ve uygulama menüsünün üst düzey etiketleri
const TITLE_BAR_MAX_MENUS = 12
function cleanTitleBarInfo (raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const menus = Array.isArray(r.menus) ? r.menus.slice(0, TITLE_BAR_MAX_MENUS) : []
  return {
    enabled: r.enabled === true,
    fullscreen: r.fullscreen === true,
    label: typeof r.label === 'string' ? r.label.slice(0, 80) : '',
    menus: menus.map((label) => (typeof label === 'string' ? label.slice(0, 60) : ''))
  }
}

// Pencere tam ekrana girince true, çıkınca false (olay nesnesi verilmez, yalnızca true veya false iletilir)
const fullscreenListeners = new Set()
ipcRenderer.on(CHANNELS.titleBarFullscreen, (event, value) => {
  if (typeof value !== 'boolean') return
  for (const callback of Array.from(fullscreenListeners)) {
    try {
      callback(value)
    } catch (err) {
      // Sayfanın işleyicisindeki hata diğer işleyicileri etkilemez
    }
  }
})

function shortText (value, max) {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function finiteNumber (value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : -1
}

const updateListeners = new Set()
ipcRenderer.on(CHANNELS.updatesState, (event, raw) => {
  const value = cleanUpdateState(raw)
  for (const callback of Array.from(updateListeners)) {
    try {
      callback(Object.assign({}, value))
    } catch (err) {
      // Sayfanın işleyicisindeki hata diğer işleyicileri etkilemez
    }
  }
})

// Gerçek kullanıcı girişi (fare, dokunma veya tuş) ana sürece bildirilir. Ekran paylaşımı seçicisi
// yalnızca son birkaç saniyede böyle bir giriş olduysa açılır. Sayfa betikleri isTrusted değeri
// true olan olay üretemez ve bu dinleyici sayfa betiklerinden önce kaydedildiği için
// engellenemez. Bildirim en fazla saniyede bir gönderilir.
let lastActivation = 0
function onTrustedInput (event) {
  if (!event || event.isTrusted !== true) return
  const now = Date.now()
  if (now - lastActivation < ACTIVATION_INTERVAL_MS) return
  lastActivation = now
  ipcRenderer.send(CHANNELS.userActivation)
}
window.addEventListener('pointerdown', onTrustedInput, true)
window.addEventListener('keydown', onTrustedInput, true)

contextBridge.exposeInMainWorld('telsizDesktop', {
  version: readVersion(),
  platform: process.platform,
  // Ayarlardaki sunucu kökeni (ör. https://telsiz.ornek.com)
  getServer: () => ipcRenderer.invoke(CHANNELS.getServer),
  // Frekans adresi penceresini açar (yeni frekans ekleme)
  changeServer: () => ipcRenderer.invoke(CHANNELS.changeServer),
  // { server, closeToTray, trayAvailable, shortcuts, registered, ptt, pttHook }
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  // map: { toggleMute: 'CommandOrControl+Shift+M' | null, toggleDeafen: ..., pttToggle: ... }
  setShortcuts: (map) => ipcRenderer.invoke(CHANNELS.setShortcuts, map),
  // callback(action): action 'toggleMute', 'toggleDeafen' veya 'pttToggle'. Dönen işlev aboneliği kaldırır.
  onShortcut: (callback) => {
    if (typeof callback !== 'function') return () => {}
    listeners.add(callback)
    return () => {
      listeners.delete(callback)
    }
  },
  // Bas konuş ayarı: { mode: 'toggle' | 'hold', holdKey: 'V' | null }
  setPtt: (value) => ipcRenderer.invoke(CHANNELS.setPtt, copyPtt(value)),
  // Sayfa ses odasında bas konuş modundayken true, değilken false bildirir (basılı tut kancası yalnızca true iken çalışır)
  setVoiceActive: (value) => ipcRenderer.send(CHANNELS.pttVoice, value === true),
  // callback(phase): 'start' veya 'end' (basılı tut kancası). Dönen işlev aboneliği kaldırır.
  onPttHold: (callback) => {
    if (typeof callback !== 'function') return () => {}
    holdListeners.add(callback)
    return () => {
      holdListeners.delete(callback)
    }
  },
  setCloseToTray: (value) => ipcRenderer.invoke(CHANNELS.setCloseToTray, typeof value === 'boolean' ? value : null),
  // Başlık şeridi (Windows ve Linux, public/js/30-pencere.js): getInfo() { enabled, fullscreen, label, menus },
  // setColors('#rrggbb', '#rrggbb') pencere düğmelerinin zemini ve simge rengi, openMenu(sıra, x, y) uygulama
  // menüsünün o bölümünü sayfadaki konumda (CSS pikseli) açar ve menü kapanınca true ile çözülür,
  // onFullscreen(cb) pencere tam ekrana girince cb(true), çıkınca cb(false). Değerler ana süreçte yeniden doğrulanır.
  titleBar: {
    getInfo: () => ipcRenderer.invoke(CHANNELS.titleBarInfo).then(cleanTitleBarInfo),
    setColors: (color, symbolColor) => ipcRenderer.send(CHANNELS.titleBarColors, { color: shortText(color, 7), symbolColor: shortText(symbolColor, 7) }),
    openMenu: (index, x, y) => ipcRenderer.invoke(CHANNELS.titleBarMenu, Number.isInteger(index) ? index : -1, finiteNumber(x), finiteNumber(y)).then((value) => value === true),
    onFullscreen: (callback) => {
      if (typeof callback !== 'function') return () => {}
      fullscreenListeners.add(callback)
      return () => {
        fullscreenListeners.delete(callback)
      }
    }
  },
  // Kayıtlı frekanslar: { active, items: [{ origin, name, host, active }] }, etkin frekans başta
  listFrequencies: () => ipcRenderer.invoke(CHANNELS.listFrequencies),
  // Listedeki bir frekansa geçer (uygulama penceresi o frekansın oturum bölümüyle yeniden açılır)
  switchFrequency: (origin) => ipcRenderer.invoke(CHANNELS.switchFrequency, typeof origin === 'string' ? origin : ''),
  // Frekans adresi penceresini ekleme kipinde açar, başarılı bağlantıda frekans eklenir ve etkin olur
  addFrequency: () => ipcRenderer.invoke(CHANNELS.addFrequency),
  // Frekansı listeden çıkarır. clearData true ise o frekansın bu cihazdaki oturum verisi de silinir.
  removeFrequency: (origin, clearData) => ipcRenderer.invoke(CHANNELS.removeFrequency, typeof origin === 'string' ? origin : '', clearData === true),
  // Etkin frekansın sunucudan öğrenilen adı (listede ve menüde gösterilir)
  setFrequencyName: (name) => ipcRenderer.invoke(CHANNELS.setFrequencyName, typeof name === 'string' ? name : ''),
  // Güncellemeler: durum { enabled, mode, kind, current, status, version, percent, lastCheckAt, error, canInstall }.
  // Sayfa hiçbir adres veya dosya yolu vermez, sürüm sayfası ana süreçteki doğrulanmış adresle açılır.
  updates: {
    getState: () => ipcRenderer.invoke(CHANNELS.updatesGet).then(cleanUpdateState),
    checkNow: () => ipcRenderer.invoke(CHANNELS.updatesCheck).then(cleanUpdateResult),
    install: () => ipcRenderer.invoke(CHANNELS.updatesInstall).then(cleanUpdateResult),
    setEnabled: (value) => ipcRenderer.invoke(CHANNELS.updatesSetAuto, typeof value === 'boolean' ? value : null).then(cleanUpdateResult),
    openRelease: () => ipcRenderer.invoke(CHANNELS.updatesOpenRelease).then(cleanUpdateResult),
    // callback(state). Dönen işlev aboneliği kaldırır.
    onState: (callback) => {
      if (typeof callback !== 'function') return () => {}
      updateListeners.add(callback)
      return () => {
        updateListeners.delete(callback)
      }
    }
  }
})

// Arka plan sayımı (src/lib/background.js, public/js/25-arka-plan.js). Ayrı bir nesnedir:
// - Ana sürecin --telsiz-background=<köken> argümanıyla açtığı gizli pencerede { background: true, origin,
//   report(rapor), open() }: rapor bilinen alanlarla kopyalanarak gönderilir, ana süreç göndereni ve her
//   alanı yeniden doğrular. open() bildirime basınca o frekansa geçer.
// - Uygulama penceresinde { background: false, getState(), onState(callback) }: açık olmayan frekansların
//   durumu. Olay nesnesi verilmez, durum burada da süzülür.
const BACKGROUND_ARG = '--telsiz-background='
const BG_ORIGIN_RE = /^https?:\/\/(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/
const BG_STATES = ['ok', 'login', 'offline', 'error', 'starting']
const BG_MAX_ITEMS = 60
const BG_MAX_COUNT = 100000
// Frekans fotoğrafı: ana sürecin doğruladığı PNG, JPEG veya WebP data: adresi (src/lib/server-icon.js)
const BG_ICON_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/
const BG_ICON_MAX = 1400000

// Argüman varsa pencere her durumda arka plan kipindedir, köken biçime uymuyorsa boş kalır (ana süreç o
// pencerenin raporlarını kabul etmez)
function readBackgroundArg () {
  const args = Array.isArray(process.argv) ? process.argv : []
  const arg = args.find((value) => typeof value === 'string' && value.startsWith(BACKGROUND_ARG))
  if (!arg) return null
  const value = arg.slice(BACKGROUND_ARG.length)
  return value.length <= 300 && BG_ORIGIN_RE.test(value) ? value : ''
}

function bgNumber (value, max) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null
}

function bgCopyReport (report) {
  const r = report && typeof report === 'object' ? report : {}
  return {
    origin: typeof r.origin === 'string' ? r.origin.slice(0, 1000) : '',
    state: typeof r.state === 'string' ? r.state.slice(0, 20) : '',
    unread: bgNumber(r.unread, BG_MAX_COUNT),
    mention: bgNumber(r.mention, BG_MAX_COUNT),
    online: r.online === true || r.online === false ? r.online : null,
    lastError: typeof r.lastError === 'string' ? r.lastError.slice(0, 20) : null,
    name: typeof r.name === 'string' ? r.name.slice(0, 1000) : null,
    onlineUsers: bgNumber(r.onlineUsers, 1000000)
  }
}

function bgCleanState (data) {
  const items = data && Array.isArray(data.items) ? data.items.slice(0, BG_MAX_ITEMS) : []
  return {
    items: items.filter((item) => item && typeof item === 'object' && typeof item.origin === 'string' && BG_ORIGIN_RE.test(item.origin)).map((item) => ({
      origin: item.origin,
      active: item.active === true,
      state: BG_STATES.includes(item.state) ? item.state : null,
      unread: bgNumber(item.unread, BG_MAX_COUNT) || 0,
      mention: bgNumber(item.mention, BG_MAX_COUNT) || 0,
      online: item.online === true || item.online === false ? item.online : null,
      onlineUsers: bgNumber(item.onlineUsers, 1000000),
      icon: typeof item.icon === 'string' && item.icon.length <= BG_ICON_MAX && BG_ICON_RE.test(item.icon) ? item.icon : null
    }))
  }
}

const backgroundOrigin = readBackgroundArg()
if (backgroundOrigin !== null) {
  contextBridge.exposeInMainWorld('telsizArkaPlan', {
    background: true,
    origin: backgroundOrigin,
    report: (report) => ipcRenderer.send(CHANNELS.bgReport, bgCopyReport(report)),
    open: () => ipcRenderer.invoke(CHANNELS.bgOpen)
  })
} else {
  const stateListeners = new Set()
  ipcRenderer.on(CHANNELS.bgState, (event, data) => {
    const clean = bgCleanState(data)
    for (const callback of Array.from(stateListeners)) {
      try {
        callback(clean)
      } catch (err) {
        // Sayfanın işleyicisindeki hata diğer işleyicileri etkilemez
      }
    }
  })
  contextBridge.exposeInMainWorld('telsizArkaPlan', {
    background: false,
    getState: () => ipcRenderer.invoke(CHANNELS.bgGet).then(bgCleanState),
    onState: (callback) => {
      if (typeof callback !== 'function') return () => {}
      stateListeners.add(callback)
      return () => {
        stateListeners.delete(callback)
      }
    }
  })
}
