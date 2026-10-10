'use strict'

// Uygulama penceresinin durumu ve sistemin boşta süresi. Electron'a bağımlı değildir.
//
// Pencere durumu: ana süreç uygulama penceresinin minimize, restore, hide ve show olaylarını dinler ve
// sayfaya telsiz:window-state kanalıyla yalnızca şu dört değerden birini gönderir: 'minimized'
// (simge durumuna küçültüldü), 'restored' (simge durumundan geri geldi), 'hidden' (tepsiye gizlendi),
// 'shown' (gösterildi, tepsiden geri dönüş dahil). Olay nesnesi ve pencere bilgisi sayfaya hiç gitmez.
// Art arda gelen aynı değer bir kez gönderilir: tepsiden dönüşte show olayı ile ana sürecin kendi
// bildirimi (showMain) aynı anda gelebilir. Sayfada window.telsizDesktop.onWindowState(cb) ile alınır.
//
// Boşta süresi: telsiz:idle-seconds çağrısı sistemin son kullanıcı girişinden (fare, klavye) bu yana geçen
// süreyi tam saniye olarak döndürür (Electron powerMonitor.getSystemIdleTime). Çağrı yalnızca uygulama
// penceresinden ve arka plan pencerelerinden kabul edilir. Değer sayı değilse, sonlu değilse veya negatifse
// 0 döner: bilinmeyen süre hiçbir zaman "boşta" sayılmaz. Sayfada window.telsizDesktop.idleSeconds() ve
// window.telsizArkaPlan.idleSeconds() ile alınır.

const STATES = Object.freeze(['minimized', 'restored', 'hidden', 'shown'])

// BrowserWindow olayının adı ve sayfaya giden değer
const EVENTS = Object.freeze({
  minimize: 'minimized',
  restore: 'restored',
  hide: 'hidden',
  show: 'shown'
})

function isState (value) {
  return typeof value === 'string' && STATES.includes(value)
}

// Olay adının sayfaya giden değeri, eşlenmeyen olayda null
function stateForEvent (name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(EVENTS, name) ? EVENTS[name] : null
}

// win: on(olay, işlev) yöntemi olan pencere (BrowserWindow). send(değer): değeri sayfaya iletir.
// Dönen nesne: report(değer) beyaz listedeki bir değeri elle bildirir (önceki değerle aynıysa
// gönderilmez, gönderildiyse true döner), current() son gönderilen değeri verir (henüz yoksa null).
function watch (win, send) {
  let last = null
  function report (value) {
    if (!isState(value) || value === last) return false
    last = value
    send(value)
    return true
  }
  for (const name of Object.keys(EVENTS)) {
    win.on(name, () => {
      report(EVENTS[name])
    })
  }
  return {
    report,
    current: () => last
  }
}

// powerMonitor.getSystemIdleTime() sonucunu negatif olmayan tam saniyeye çevirir
function cleanIdleSeconds (raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return 0
  const value = Math.floor(raw)
  return Number.isSafeInteger(value) ? value : 0
}

module.exports = {
  STATES,
  EVENTS,
  isState,
  stateForEvent,
  watch,
  cleanIdleSeconds
}
