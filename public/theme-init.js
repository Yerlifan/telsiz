'use strict'

// Tema ön yükleyicisi (Ek G1.5). <head> içinde defer olmadan, stil dosyalarından önce yüklenir.
// Cihazdaki tercihi okuyup kök öğeye data-skin, data-scheme, data-font-size, data-compact, data-reduce-motion
// ve data-msg-layout özniteliklerini ve elle ayarlanan yazı boyutunu (--font-px) yazar, böylece sayfa ilk
// çizimde doğru temayla açılır.
// window.TelsizTheme arayüzü ayarlar görünümü ve uygulama tarafından kullanılır.
// Bu dosya ES2017 ve noktalı virgülsüz yazılır, inline betik yasak olduğu için ayrı dosyadır.

function createTelsizTheme () {
  const SKINS = ['arcade', 'gece', 'turkuaz', 'saha', 'lamba', 'fosfor', 'kutup', 'plak', 'kokpit', 'kontrast']
  const SCHEMES = ['dark', 'light', 'system']
  const FONT_SIZES = ['auto', 'small', 'normal', 'large', 'tv', 'custom']
  const MOTION = ['system', 'on', 'off']
  // Mesaj düzeni: kayit (Kayıt Defteri: saat her mesajın solunda, küçük avatar adın yanında, TX ve RX) veya klasik
  const MSG_LAYOUTS = ['kayit', 'klasik']
  // Erişilebilirlik teması: Ayarlar'da ayrı grupta listelenir, sistem yüksek karşıtlık istiyorsa ilk açılışta seçilir
  const CONTRAST_SKIN = 'kontrast'
  const STORE = {
    skin: 'telsiz.skin',
    scheme: 'telsiz.scheme',
    fontSize: 'telsiz.fontSize',
    fontPx: 'telsiz.fontPx',
    compact: 'telsiz.compact',
    reduceMotion: 'telsiz.reduceMotion',
    msgLayout: 'telsiz.msgLayout'
  }
  // Elle ayarlanan yazı boyutunun (custom) sınırları, piksel
  const FONT_PX = { min: 12, max: 28 }
  // Yazı boyutu varsayılanı 15 piksel (normal), otomatik seçenek ekran genişliğine göre büyütür. Özel boyut
  // da ilk açılışta 15 pikseldir.
  const DEFAULTS = { skin: 'arcade', scheme: 'system', fontSize: 'normal', fontPx: 15, compact: false, reduceMotion: 'system', msgLayout: 'kayit' }
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

  // Tam sayı piksel, sınırlar içinde. Geçersizse null.
  function fontPx (value) {
    const n = typeof value === 'number' ? value : Number(String(value === null || value === undefined ? '' : value).trim())
    if (!Number.isInteger(n) || n < FONT_PX.min || n > FONT_PX.max) return null
    return n
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
  const contrastQuery = media('(prefers-contrast: more)')
  const forcedQuery = media('(forced-colors: active)')

  // İlk açılış: saklı (geçerli) tema tercihi yoksa ve sistem yüksek karşıtlık istiyorsa (prefers-contrast: more veya
  // Windows Yüksek Karşıtlık gibi zorlanmış renkler) Yüksek Kontrast seçilir. Seçim saklanmaz, kişi Ayarlar'dan bir
  // tema seçene kadar (kendiliğinden seçilen Yüksek Kontrast dahil) her açılışta sistem ayarına bakılır. Bu sorguları
  // tanımayan eski tarayıcılarda varsayılan kalır.
  function initialSkin () {
    const stored = read(STORE.skin)
    if (SKINS.indexOf(stored) !== -1) return stored
    if ((contrastQuery && contrastQuery.matches) || (forcedQuery && forcedQuery.matches)) return CONTRAST_SKIN
    return DEFAULTS.skin
  }

  const prefs = {
    skin: initialSkin(),
    scheme: pick(SCHEMES, read(STORE.scheme), DEFAULTS.scheme),
    fontSize: pick(FONT_SIZES, read(STORE.fontSize), DEFAULTS.fontSize),
    fontPx: fontPx(read(STORE.fontPx)) || DEFAULTS.fontPx,
    compact: read(STORE.compact) === 'true',
    reduceMotion: pick(MOTION, read(STORE.reduceMotion), DEFAULTS.reduceMotion),
    msgLayout: pick(MSG_LAYOUTS, read(STORE.msgLayout), DEFAULTS.msgLayout)
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
      fontPx: prefs.fontPx,
      compact: prefs.compact,
      reduceMotion: prefs.reduceMotion,
      motionReduced: resolvedMotion(),
      msgLayout: prefs.msgLayout
    }
  }

  function apply () {
    root.setAttribute('data-skin', prefs.skin)
    root.setAttribute('data-scheme', resolvedScheme())
    root.setAttribute('data-font-size', prefs.fontSize)
    // Özel boyut CSSOM ile kök öğenin değişkenine yazılır (CSP satır içi stil özniteliğine izin vermez,
    // CSSOM ataması izinlidir), tokens.css html[data-font-size="custom"] kuralı kullanır
    if (root.style && typeof root.style.setProperty === 'function') root.style.setProperty('--font-px', prefs.fontPx + 'px')
    root.setAttribute('data-compact', prefs.compact ? 'true' : 'false')
    root.setAttribute('data-reduce-motion', resolvedMotion() ? 'true' : 'false')
    root.setAttribute('data-msg-layout', prefs.msgLayout)
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
    if (next.skin !== undefined && SKINS.indexOf(next.skin) !== -1) {
      if (next.skin !== prefs.skin) {
        prefs.skin = next.skin
        write(STORE.skin, prefs.skin)
        changed = true
      } else if (read(STORE.skin) !== prefs.skin) {
        // Sistem ayarıyla kendiliğinden seçilen tema saklı değildir. Kişi aynı temayı seçerse seçim saklanır ve
        // sistem ayarı kapansa da korunur. Görünüm değişmediği için yeniden uygulanmaz.
        write(STORE.skin, prefs.skin)
      }
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
    if (next.fontPx !== undefined) {
      const px = fontPx(next.fontPx)
      if (px !== null && px !== prefs.fontPx) {
        prefs.fontPx = px
        write(STORE.fontPx, String(px))
        changed = true
      }
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
    if (next.msgLayout !== undefined && MSG_LAYOUTS.indexOf(next.msgLayout) !== -1 && next.msgLayout !== prefs.msgLayout) {
      prefs.msgLayout = next.msgLayout
      write(STORE.msgLayout, prefs.msgLayout)
      changed = true
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

  // Masaüstü uygulamasında (Windows ve Linux) pencere düğmeleri sayfanın üstüne çizilir (Pencere Denetimleri
  // Kaplaması). Sayfa ilk çizimden önce başlık şeridi kadar aşağıdan başlar, yükseklik CSS ortam değişkeninden
  // gelir (components.css .has-titlebar), kaplama yoksa veya tam ekranda sıfırdır. Şerit js/30-pencere.js ile çizilir.
  if (window.telsizDesktop && typeof navigator !== 'undefined' && navigator.windowControlsOverlay && root.classList) root.classList.add('has-titlebar')

  watch(darkQuery, () => prefs.scheme === 'system')
  watch(lightQuery, () => prefs.scheme === 'system')
  watch(motionQuery, () => prefs.reduceMotion === 'system')
  apply()

  return {
    get: snapshot,
    set: set,
    skins: SKINS.slice(),
    contrastSkin: CONTRAST_SKIN,
    schemes: SCHEMES.slice(),
    fontSizes: FONT_SIZES.slice(),
    fontPxRange: { min: FONT_PX.min, max: FONT_PX.max },
    msgLayouts: MSG_LAYOUTS.slice(),
    onChange: onChange
  }
}

window.TelsizTheme = createTelsizTheme()
