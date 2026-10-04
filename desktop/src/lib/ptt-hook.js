'use strict'

// Basılı tutmalı bas konuş için genel tuş kancası (uiohook-napi). Electron'a bağımlı değildir: yerel
// modül dışarıdan verilen load() ile ve yalnızca gerektiğinde yüklenir (desktop/test/tus-kancasi.test.js
// sahte modülle dener).
//
// Gizlilik ve güvenlik:
// - Kanca yalnızca basılı tut kipi açıkken, bir tuş atanmışken ve sayfa ses odasında bas konuş modunda
//   olduğunu bildirmişken çalışır. Bunlardan biri değişince durdurulur.
// - Kanca işletim sistemindeki bütün tuş olaylarını görür. Burada yalnızca olayın tuş kodu ve değiştirici
//   bayrakları okunup atanan tuşla karşılaştırılır, olay nesnesi saklanmaz. Dışarıya yalnızca onTalk(true)
//   (konuş başla) ve onTalk(false) (konuş bitti) çıkar. Tuş kodları ve diğer tuşlar hiçbir yere iletilmez
//   ve günlüğe yazılmaz. Fare olayları dinlenmez.
// - Modül yüklenemez veya kanca başlatılamazsa uygulama çökmez, durum nedeniyle birlikte bildirilir.
//
// Linux'ta modül yüklenirken X11 ekranına bağlanır. Ekran yoksa (DISPLAY tanımsız, ör. yalnızca Wayland)
// modül hiç yüklenmez: yüklenseydi süreç kapanırken X11 kitaplığı hata verip çıkış kodunu bozardı.

const hookKeys = require('./hook-keys')

const PLATFORMS = ['win32', 'linux', 'darwin']
// Seçeneğin kullanılamama nedenleri ve başlatma hatası (arayüz metinleri bu kodlarla seçilir)
const REASONS = ['unsupported', 'no_display', 'load_failed']
const ERRORS = ['start_failed']

function noop () {}

// options: { platform, env, load: () => uiohook-napi modülü, onTalk(boolean), log(etiket, hata) }
function createPttHook (options) {
  const o = options || {}
  const env = o.env && typeof o.env === 'object' ? o.env : {}
  const onTalk = typeof o.onTalk === 'function' ? o.onTalk : noop
  const log = typeof o.log === 'function' ? o.log : noop
  let mod = null
  let loadFailed = false
  let lastError = null
  let running = false
  let binding = null
  let talking = false
  // Son başlatma isteğinin tuşu: aynı istek başarısız olduysa her durum bildiriminde yeniden denenmez
  let requested = null

  function staticReason () {
    if (!PLATFORMS.includes(o.platform)) return 'unsupported'
    if (o.platform === 'linux' && !(typeof env.DISPLAY === 'string' && env.DISPLAY !== '')) return 'no_display'
    return null
  }

  // { available, reason, running, error }: available false ise seçenek devre dışı görünür
  function availability () {
    const reason = staticReason() || (loadFailed ? 'load_failed' : null)
    return { available: reason === null, reason, running, error: lastError }
  }

  // Modülü bir kez yükler, başarısızlık oturum boyunca hatırlanır
  function ensureLoaded () {
    if (mod) return true
    if (staticReason() || loadFailed || typeof o.load !== 'function') return false
    try {
      const loaded = o.load()
      const hook = loaded && loaded.uIOhook
      if (!hook || typeof hook.start !== 'function' || typeof hook.stop !== 'function' || typeof hook.on !== 'function' ||
        !loaded.UiohookKey || typeof loaded.UiohookKey !== 'object') throw new Error('unexpected module shape')
      mod = loaded
      return true
    } catch (err) {
      loadFailed = true
      log('ptt hook load', err)
      return false
    }
  }

  function setTalking (value) {
    if (talking === value) return
    talking = value
    try {
      onTalk(value)
    } catch (err) {
      log('ptt hook', err)
    }
  }

  // Tuş tekrarında (basılı tutulan tuş) olay yinelenir, konuşma zaten başladıysa yok sayılır
  function onKeyDown (e) {
    if (!binding || talking || !e) return
    if (!binding.codes.includes(e.keycode)) return
    if (!binding.flags.every((flag) => e[flag] === true)) return
    setTalking(true)
  }

  // Atanan tuş veya gerekli değiştiricilerden biri bırakılınca konuşma biter
  function onKeyUp (e) {
    if (!binding || !talking || !e) return
    if (binding.codes.includes(e.keycode) || binding.releaseCodes.includes(e.keycode)) setTalking(false)
  }

  function detach () {
    const hook = mod && mod.uIOhook
    if (!hook || typeof hook.removeListener !== 'function') return
    hook.removeListener('keydown', onKeyDown)
    hook.removeListener('keyup', onKeyUp)
  }

  function start (key) {
    if (!ensureLoaded()) return false
    const resolved = hookKeys.resolveHoldKey(key, mod.UiohookKey)
    if (!resolved) {
      lastError = 'start_failed'
      log('ptt hook', new Error('the hold key could not be mapped to a hook key code'))
      return false
    }
    binding = resolved
    mod.uIOhook.on('keydown', onKeyDown)
    mod.uIOhook.on('keyup', onKeyUp)
    try {
      mod.uIOhook.start()
    } catch (err) {
      detach()
      binding = null
      lastError = 'start_failed'
      log('ptt hook start', err)
      return false
    }
    running = true
    return true
  }

  // Kancayı durdurur. Konuşma sürüyorsa "konuş bitti" bildirilir (tuş takılı kalmasın).
  function stop () {
    if (running) {
      running = false
      try {
        mod.uIOhook.stop()
      } catch (err) {
        log('ptt hook stop', err)
      }
    }
    detach()
    binding = null
    setTalking(false)
  }

  // İstenen durum: { enabled: basılı tut kipi, active: ses odasında bas konuş modunda, key: basılı tut tuşu }
  function update (next) {
    const n = next || {}
    const key = typeof n.key === 'string' && n.key !== '' ? n.key : null
    if (n.enabled !== true || n.active !== true || key === null) {
      requested = null
      stop()
      return availability()
    }
    if (requested === key) return availability()
    requested = key
    stop()
    lastError = null
    start(key)
    return availability()
  }

  return {
    availability,
    // Ayarda basılı tut açılırken modül şimdi denenir (yüklenemezse seçenek kaydedilmez)
    check: () => {
      ensureLoaded()
      return availability()
    },
    update,
    stop: () => {
      requested = null
      stop()
    },
    isRunning: () => running,
    isTalking: () => talking
  }
}

module.exports = { PLATFORMS, REASONS, ERRORS, createPttHook }
