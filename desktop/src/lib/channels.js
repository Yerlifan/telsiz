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
  updatesState: 'telsiz:updates-state',
  connectInit: 'telsiz:connect-init',
  connectSubmit: 'telsiz:connect-submit',
  connectCancel: 'telsiz:connect-cancel',
  pickerInit: 'telsiz:picker-init',
  pickerChoose: 'telsiz:picker-choose',
  pickerCancel: 'telsiz:picker-cancel'
})

// Genel kısayollarla tetiklenebilen eylemler (basılı tutmalı bas-konuş bu sürümde yoktur)
const ACTIONS = Object.freeze(['toggleMute', 'toggleDeafen'])

// Uygulama sürümü ön yükleme betiğine bu önekle process.argv üzerinden verilir
const VERSION_ARG = '--telsiz-version='

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
  VERSION_ARG
}
