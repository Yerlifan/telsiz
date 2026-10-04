'use strict'

// Tema ön yükleyicisi (Ek G1.5). <head> içinde defer olmadan, stil dosyalarından önce yüklenir.
// Cihazdaki tercihi okuyup kök öğeye data-skin, data-scheme, data-font-size, data-compact ve
// data-reduce-motion özniteliklerini yazar, böylece sayfa ilk çizimde doğru temayla açılır.
// window.TelsizTheme arayüzü ayarlar görünümü ve uygulama tarafından kullanılır.
// Bu dosya ES2017 ve noktalı virgülsüz yazılır, inline betik yasak olduğu için ayrı dosyadır.

function createTelsizTheme () {
  const SKINS = ['arcade', 'gece', 'turkuaz']
  const SCHEMES = ['dark', 'light', 'system']
  const FONT_SIZES = ['auto', 'small', 'normal', 'large', 'tv']
  const MOTION = ['system', 'on', 'off']
  const STORE = {
    skin: 'telsiz.skin',
    scheme: 'telsiz.scheme',
    fontSize: 'telsiz.fontSize',
    compact: 'telsiz.compact',
    reduceMotion: 'telsiz.reduceMotion'
  }
  // Yazı boyutu varsayılanı 16 piksel (normal), otomatik seçenek ekran genişliğine göre büyütür
  const DEFAULTS = { skin: 'arcade', scheme: 'system', fontSize: 'normal', compact: false, reduceMotion: 'system' }
  const root = document.documentElement
  const listeners = []

  function read (key) {
    try {
      return window.localStorage.getItem(key)
    } catch (err) {
      return null
    }
  }

  function write (key, value) {
    try {
      window.localStorage.setItem(key, String(value))
    } catch (err) {
      // Depolama kapalı, tercih yalnızca bu oturumda geçerli
    }
  }

  function pick (list, value, fallback) {
    return list.indexOf(value) !== -1 ? value : fallback
  }

  function media (query) {
    try {
      return window.matchMedia ? window.matchMedia(query) : null
    } catch (err) {
      return null
    }
  }

  const darkQuery = media('(prefers-color-scheme: dark)')
  const lightQuery = media('(prefers-color-scheme: light)')
  const motionQuery = media('(prefers-reduced-motion: reduce)')

  const prefs = {
    skin: pick(SKINS, read(STORE.skin), DEFAULTS.skin),
    scheme: pick(SCHEMES, read(STORE.scheme), DEFAULTS.scheme),
    fontSize: pick(FONT_SIZES, read(STORE.fontSize), DEFAULTS.fontSize),
    compact: read(STORE.compact) === 'true',
    reduceMotion: pick(MOTION, read(STORE.reduceMotion), DEFAULTS.reduceMotion)
  }

  // Sistem tercihi bilinmiyorsa koyu (Ek G3)
  function systemScheme () {
    if (lightQuery && lightQuery.matches && !(darkQuery && darkQuery.matches)) return 'light'
    return 'dark'
  }

  function resolvedScheme () {
    return prefs.scheme === 'system' ? systemScheme() : prefs.scheme
  }

  function resolvedMotion () {
    if (prefs.reduceMotion === 'on') return true
    if (prefs.reduceMotion === 'off') return false
    return Boolean(motionQuery && motionQuery.matches)
  }

  function snapshot () {
    return {
      skin: prefs.skin,
      scheme: prefs.scheme,
      resolvedScheme: resolvedScheme(),
      fontSize: prefs.fontSize,
      compact: prefs.compact,
      reduceMotion: prefs.reduceMotion,
      motionReduced: resolvedMotion()
    }
  }

  function apply () {
    root.setAttribute('data-skin', prefs.skin)
    root.setAttribute('data-scheme', resolvedScheme())
    root.setAttribute('data-font-size', prefs.fontSize)
    root.setAttribute('data-compact', prefs.compact ? 'true' : 'false')
    root.setAttribute('data-reduce-motion', resolvedMotion() ? 'true' : 'false')
  }

  function notify () {
    const value = snapshot()
    listeners.slice().forEach((fn) => {
      try {
        fn(value)
      } catch (err) {
        if (window.console) window.console.error(err)
      }
    })
  }

  function set (partial) {
    const next = partial && typeof partial === 'object' ? partial : {}
    let changed = false
    if (next.skin !== undefined && SKINS.indexOf(next.skin) !== -1 && next.skin !== prefs.skin) {
      prefs.skin = next.skin
      write(STORE.skin, prefs.skin)
      changed = true
    }
    if (next.scheme !== undefined && SCHEMES.indexOf(next.scheme) !== -1 && next.scheme !== prefs.scheme) {
      prefs.scheme = next.scheme
      write(STORE.scheme, prefs.scheme)
      changed = true
    }
    if (next.fontSize !== undefined && FONT_SIZES.indexOf(next.fontSize) !== -1 && next.fontSize !== prefs.fontSize) {
      prefs.fontSize = next.fontSize
      write(STORE.fontSize, prefs.fontSize)
      changed = true
    }
    if (next.compact !== undefined && Boolean(next.compact) !== prefs.compact) {
      prefs.compact = Boolean(next.compact)
      write(STORE.compact, prefs.compact ? 'true' : 'false')
      changed = true
    }
    if (next.reduceMotion !== undefined) {
      let motion = next.reduceMotion
      if (motion === true) motion = 'on'
      if (motion === false) motion = 'off'
      if (MOTION.indexOf(motion) !== -1 && motion !== prefs.reduceMotion) {
        prefs.reduceMotion = motion
        write(STORE.reduceMotion, prefs.reduceMotion)
        changed = true
      }
    }
    if (changed) {
      apply()
      notify()
    }
    return snapshot()
  }

  function onChange (fn) {
    if (typeof fn !== 'function') return () => {}
    listeners.push(fn)
    return () => {
      const index = listeners.indexOf(fn)
      if (index !== -1) listeners.splice(index, 1)
    }
  }

  // Sistem tercihi değişince yalnızca "Sistem" seçiliyse yeniden uygulanır
  function watch (query, relevant) {
    if (!query) return
    const handler = () => {
      if (!relevant()) return
      apply()
      notify()
    }
    if (typeof query.addEventListener === 'function') query.addEventListener('change', handler)
    else if (typeof query.addListener === 'function') query.addListener(handler)
  }

  watch(darkQuery, () => prefs.scheme === 'system')
  watch(lightQuery, () => prefs.scheme === 'system')
  watch(motionQuery, () => prefs.reduceMotion === 'system')
  apply()

  return {
    get: snapshot,
    set: set,
    skins: SKINS.slice(),
    schemes: SCHEMES.slice(),
    fontSizes: FONT_SIZES.slice(),
    onChange: onChange
  }
}

window.TelsizTheme = createTelsizTheme()
