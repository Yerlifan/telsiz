'use strict'

// Ana süreç ile ön yükleme betikleri arasındaki sabit adlar: özel şema, kökenler (uygulama,
// sunucu adresi ekranı ve ekran paylaşımı seçicisi), IPC kanalları,
// kısayol eylemleri ve sürüm argümanı. Ön yükleme betikleri korumalı alanda (sandbox) çalıştığı
// için bu dosyayı yükleyemez, aynı değerleri kendileri tanımlar. Değerlerin birebir aynı olduğu
// desktop/test/preload.test.js ile denetlenir.

const SCHEME = 'telsiz'
const APP_HOST = 'app'
const CONNECT_HOST = 'baglan'
const PICKER_HOST = 'secici'
const APP_ORIGIN = SCHEME + '://' + APP_HOST
const CONNECT_ORIGIN = SCHEME + '://' + CONNECT_HOST
const PICKER_ORIGIN = SCHEME + '://' + PICKER_HOST

const CHANNELS = Object.freeze({
  getServer: 'telsiz:get-server',
  changeServer: 'telsiz:change-server',
  getSettings: 'telsiz:get-settings',
  setShortcuts: 'telsiz:set-shortcuts',
  setCloseToTray: 'telsiz:set-close-to-tray',
  shortcut: 'telsiz:shortcut',
  // Bas konuş (src/lib/ptt-hook.js): bas konuş ayarı, sayfanın ses odası durumu ve basılı tut kancasının
  // "konuş başla" ve "konuş bitti" olayları
  setPtt: 'telsiz:set-ptt',
  pttVoice: 'telsiz:ptt-voice',
  pttHold: 'telsiz:ptt-hold',
  userActivation: 'telsiz:user-activation',
  // Başlık şeridi (src/lib/title-bar.js): kaplama bilgisi ve menü etiketleri, tema renkleri, menü açma ve
  // pencerenin tam ekrana girip çıkması (ana süreçten sayfaya)
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
  // Arka plan sayımı (src/lib/background.js): pencerenin raporu, bildirimden frekansa geçiş, uygulama
  // penceresine durum ve durumun okunması
  bgReport: 'telsiz:bg-report',
  bgOpen: 'telsiz:bg-open',
  bgState: 'telsiz:bg-state',
  bgGet: 'telsiz:bg-get',
  connectInit: 'telsiz:connect-init',
  connectSubmit: 'telsiz:connect-submit',
  connectCancel: 'telsiz:connect-cancel',
  pickerInit: 'telsiz:picker-init',
  pickerChoose: 'telsiz:picker-choose',
  pickerCancel: 'telsiz:picker-cancel'
})

// Genel kısayollarla tetiklenebilen eylemler. pttToggle bas konuşu açar veya kapatır (bas aç, bas kapat).
// Basılı tutmalı bas konuş genel kısayol değildir, tuş kancasıyla çalışır (HOLD_PHASES).
const ACTIONS = Object.freeze(['toggleMute', 'toggleDeafen', 'pttToggle'])

// Basılı tut kancasının sayfaya gönderebildiği tek olaylar: konuş başla ve konuş bitti
const HOLD_PHASES = Object.freeze(['start', 'end'])

// Uygulama sürümü ön yükleme betiğine bu önekle process.argv üzerinden verilir
const VERSION_ARG = '--telsiz-version='

// Arka plan penceresinin frekansı (kökeni) ön yükleme betiğine bu önekle verilir. Yalnızca ana süreç
// ekler, sayfa içeriği süreç argümanlarını değiştiremez.
const BACKGROUND_ARG = '--telsiz-background='

module.exports = {
  SCHEME,
  APP_HOST,
  CONNECT_HOST,
  PICKER_HOST,
  APP_ORIGIN,
  CONNECT_ORIGIN,
  PICKER_ORIGIN,
  CHANNELS,
  ACTIONS,
  HOLD_PHASES,
  VERSION_ARG,
  BACKGROUND_ARG
}
