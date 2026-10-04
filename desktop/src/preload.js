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
  userActivation: 'telsiz:user-activation',
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
  updatesState: 'telsiz:updates-state'
}
const ACTIONS = ['toggleMute', 'toggleDeafen']
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
  // { server, closeToTray, trayAvailable, shortcuts, registered, systemAudio }
  getSettings: () => ipcRenderer.invoke(CHANNELS.getSettings),
  // map: { toggleMute: 'CommandOrControl+Shift+M' | null, toggleDeafen: ... }
  setShortcuts: (map) => ipcRenderer.invoke(CHANNELS.setShortcuts, map),
  // callback(action): action 'toggleMute' veya 'toggleDeafen'. Dönen işlev aboneliği kaldırır.
  onShortcut: (callback) => {
    if (typeof callback !== 'function') return () => {}
    listeners.add(callback)
    return () => {
      listeners.delete(callback)
    }
  },
  setCloseToTray: (value) => ipcRenderer.invoke(CHANNELS.setCloseToTray, typeof value === 'boolean' ? value : null),
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
