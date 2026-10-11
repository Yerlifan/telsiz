'use strict'

// Otomatik boşta (istek 2). Bu cihazda seçilen süre (Ayarlar > Gizlilik, varsayılan 10 dakika) boyunca fare,
// klavye, dokunma, tekerlek veya oyun kolu kullanılmazsa long-poll sorgusu idle=1 taşır (05-poll.js
// pollLoop, arka plan penceresinde 25-arka-plan.js bgPoll). Sunucu (src/hub.js) kişinin bütün etkin oturumları
// boştaysa ve elle seçtiği durum Çevrimiçi ise kişiyi başkalarına Boşta gösterir. Elle seçilen Boşta, Rahatsız
// etmeyin ve Görünmez durumlarına dokunulmaz, hiçbir geçiş diske yazılmaz.
// - Karar zamanlayıcının kendisine değil Date.now() farkına dayanır. Tarayıcı gizli sekmedeki zamanlayıcıları
//   dakikada bire indirebildiği için karar en çok yaklaşık bir dakika gecikebilir.
// - Ses odasındayken (özel mesaj araması dahil) cihaz boşta sayılmaz.
// - Oyun kolu 2 saniyede bir okunur: basılı düğmeler ve ölü bölgeyi aşan eksenler değişince girdi sayılır
//   (çubuk titremesi sayılmaz). 21-band.js değişmez.
// - Masaüstü uygulamasında sistemin boşta süresi de okunur (telsizDesktop.idleSeconds, arka plan penceresinde
//   telsizArkaPlan.idleSeconds): kişi başka bir uygulamayı kullanıyorsa boşta sayılmaz. Arka plan penceresinde
//   girdi dinlenmez, karar yalnızca sistemin boşta süresine dayanır.
// - Durum değişince poll yeni değerle yeniden başlar (startPoll, arka planda bgRestartPoll).

const IDLE_CHECK_MS = 15000
const IDLE_MOVE_GAP_MS = 2000
const IDLE_PAD_MS = 2000
const IDLE_PAD_DEADZONE = 0.5

const idleState = {
  started: false,
  idle: false,
  lastInput: Date.now(),
  // Sistemin boşta süresinden çıkarılan son girdi zamanı (masaüstü), bilinmiyorsa 0
  systemInput: 0,
  checkTimer: 0,
  padTimer: 0,
  pads: Object.create(null),
  reading: false
}

function idleBgMode () {
  return typeof bgModeActive === 'function' && bgModeActive()
}

// Sistemin boşta süresini veren masaüstü işlevi, yoksa null
function idleDesktopReader () {
  const d = idleBgMode() ? window.telsizArkaPlan : window.telsizDesktop
  return d && typeof d.idleSeconds === 'function' ? d : null
}

// Bu cihaz ses odasında mı (katılırken dahil)
function idleInVoice () {
  if (typeof snap !== 'function') return false
  try {
    const s = snap()
    return Boolean(s && (s.channelId || s.joining))
  } catch (err) {
    return false
  }
}

function idleLastActivity () {
  return Math.max(idleState.lastInput, idleState.systemInput)
}

// Bu cihaz şu anda boşta mı sayılmalı (ayar açık, uygulama açık, ses odasında değil, süre doldu)
function idleDecide (now) {
  if (typeof autoIdleEnabled !== 'function' || !autoIdleEnabled()) return false
  if (!idleBgMode() && !state.inApp) return false
  if (idleInVoice()) return false
  return now - idleLastActivity() >= autoIdleMinutes() * 60000
}

// Poll sorgusunun idle değeri: '1' bu cihaz boşta, '0' değil
function idlePollParam () {
  return idleState.idle ? '1' : '0'
}

// Bu cihaz boşta bildiriyor mu (13-profile.js kendi durumumun gösterimi)
function idleThisDevice () {
  return idleState.idle
}

function idleApply () {
  const want = idleDecide(Date.now())
  if (want === idleState.idle) return
  idleState.idle = want
  if (idleBgMode()) {
    if (typeof bgRestartPoll === 'function') bgRestartPoll()
    return
  }
  if (state.inApp && state.token) startPoll()
}

function idleNoteInput (now) {
  idleState.lastInput = now || Date.now()
  if (idleState.idle) idleApply()
}

// Fare hareketi zaman damgasıyla kısılır, boştayken ilk hareket hemen işlenir
function idleOnMove () {
  const now = Date.now()
  if (!idleState.idle && now - idleState.lastInput < IDLE_MOVE_GAP_MS) return
  idleNoteInput(now)
}

function idleOnInput () {
  idleNoteInput(Date.now())
}

function idleOnVisible () {
  if (!document.hidden) idleNoteInput(Date.now())
}

// Oyun kolunun girdi imzası: basılı düğmeler ve ölü bölgeyi aşan eksenlerin yönü
function idlePadSignature (gp) {
  const buttons = Array.prototype.map.call(gp.buttons || [], (b) => (b && (b.pressed || b.value > IDLE_PAD_DEADZONE) ? '1' : '0'))
  const axes = Array.prototype.map.call(gp.axes || [], (value) => {
    const a = Number(value) || 0
    return a > IDLE_PAD_DEADZONE ? '+' : a < -IDLE_PAD_DEADZONE ? '-' : '0'
  })
  return buttons.join('') + '|' + axes.join('')
}

function idlePadTick () {
  let pads = []
  try {
    pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : []
  } catch (err) {
    pads = []
  }
  const seen = Object.create(null)
  let changed = false
  pads.forEach((gp) => {
    if (!gp || gp.connected === false) return
    const key = String(gp.index)
    const sig = idlePadSignature(gp)
    seen[key] = sig
    if (idleState.pads[key] !== undefined && idleState.pads[key] !== sig) changed = true
  })
  idleState.pads = seen
  if (changed) idleNoteInput(Date.now())
}

// Masaüstünde sistemin boşta süresi okunur, ardından karar verilir
function idleCheck () {
  const reader = idleDesktopReader()
  if (!reader || idleState.reading) {
    idleApply()
    return
  }
  idleState.reading = true
  let pending = null
  try {
    pending = Promise.resolve(reader.idleSeconds())
  } catch (err) {
    pending = Promise.reject(err)
  }
  pending.then((seconds) => {
    const n = Number(seconds)
    if (isFinite(n) && n >= 0) idleState.systemInput = Date.now() - n * 1000
  }).catch(() => {
    // Sistemin boşta süresi okunamadı, yalnızca bu sayfanın girdileri sayılır
  }).then(() => {
    idleState.reading = false
    idleApply()
  })
}

// Ayar değişti (11-settings.js) veya ses durumu değişti: karar hemen yenilenir
function idleSettingsChanged () {
  idleCheck()
}

function idleStart () {
  if (idleState.started) return
  idleState.started = true
  idleState.lastInput = Date.now()
  idleState.checkTimer = setInterval(idleCheck, IDLE_CHECK_MS)
  if (idleBgMode()) return
  const opts = { capture: true, passive: true }
  document.addEventListener('pointerdown', idleOnInput, opts)
  document.addEventListener('pointermove', idleOnMove, opts)
  document.addEventListener('keydown', idleOnInput, opts)
  document.addEventListener('wheel', idleOnInput, opts)
  document.addEventListener('touchstart', idleOnInput, opts)
  document.addEventListener('visibilitychange', idleOnVisible)
  if (navigator.getGamepads) idleState.padTimer = setInterval(idlePadTick, IDLE_PAD_MS)
  // Ses odasına katılınca boştan hemen çıkılır, ayrılınca karar yeniden verilir
  if (typeof voiceHook === 'function') voiceHook('change', idleApply)
}

idleStart()
