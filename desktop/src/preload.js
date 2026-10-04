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
  setFrequencyName: 'telsiz:set-frequency-name'
}
const ACTIONS = ['toggleMute', 'toggleDeafen']
const VERSION_ARG = '--telsiz-version='
const VERSION_RE = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/
const ACTIVATION_INTERVAL_MS = 1000

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
  setFrequencyName: (name) => ipcRenderer.invoke(CHANNELS.setFrequencyName, typeof name === 'string' ? name : '')
})
