'use strict'

// Masaüstü uygulaması tümleştirmesi (Ek J2.4). Yalnızca Telsiz masaüstü uygulamasının ön yükleme
// betiği window.telsizDesktop nesnesini verdiyse etkinleşir, tarayıcıda hiçbir şey yapmaz.
// - Genel kısayol olaylarında (mikrofonu aç/kapat, sağırlaştır) ses modülünün toggleMute ve
//   toggleDeafen işlevlerini çağırır (10-voice.js).
// - Masaüstünde PWA yükleme önerisini engeller ve yükleme düğmesini gizler.
// - Ayarlar sayfası için iki bölüm üretir: window.TelsizDesktopUI.renderShortcutSettings(kapsayici)
//   genel kısayolları, renderAppSettings(kapsayici) sunucu adresini ve tepsiye küçültmeyi gösterir.
//   İkisi de kapsayıcıyı temizleyip yeniden çizer, dil değişince yeniden çağrılabilir (veya
//   refresh() kullanılır).
// - Güncellemeler: uygulama ayarlarında "Güncellemeleri otomatik denetle" anahtarı, Şimdi denetle
//   düğmesi, sürüm ve son denetimin sonucu. İndirilmiş bir güncelleme (kurucu ve AppImage) veya
//   yeni sürüm bildirimi (taşınabilir exe ve .deb) için sayfanın köşesinde kapatılabilir bir şerit.
//   Denetim, indirme ve kurulum ana süreçte yapılır (desktop/src/lib/updates.js), sayfa yalnızca
//   telsizDesktop.updates API'sini çağırır ve hiçbir adres vermez.
// Kısayollar ana süreçte yeniden doğrulanır ve kaydedilir, burada yalnızca tuş bileşimi yakalanır.

window.TelsizDesktopUI = (function () {
  const desktop = window.telsizDesktop
  const inactive = {
    active: false,
    renderShortcutSettings: function () {
      return false
    },
    renderAppSettings: function () {
      return false
    },
    refresh: function () {}
  }
  if (!desktop || typeof desktop !== 'object' || typeof desktop.onShortcut !== 'function') return inactive

  const ACTIONS = ['toggleMute', 'toggleDeafen']
  const CAPTURE_TIMEOUT_MS = 10000
  // KeyboardEvent.code değerinden Electron tuş adına (klavye düzeninden bağımsız)
  const CODE_KEYS = {
    Space: 'Space',
    Tab: 'Tab',
    Backspace: 'Backspace',
    Delete: 'Delete',
    Insert: 'Insert',
    Enter: 'Return',
    NumpadEnter: 'Return',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    PrintScreen: 'PrintScreen',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Semicolon: ';',
    Quote: '\'',
    Comma: ',',
    Period: '.',
    Slash: '/',
    Backslash: '\\',
    Backquote: '`',
    NumpadDecimal: 'numdec',
    NumpadAdd: 'numadd',
    NumpadSubtract: 'numsub',
    NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv',
    AudioVolumeUp: 'VolumeUp',
    AudioVolumeDown: 'VolumeDown',
    AudioVolumeMute: 'VolumeMute',
    MediaTrackNext: 'MediaNextTrack',
    MediaTrackPrevious: 'MediaPreviousTrack',
    MediaStop: 'MediaStop',
    MediaPlayPause: 'MediaPlayPause'
  }
  const MODIFIER_CODE_RE = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$|^(AltGraph|CapsLock|ContextMenu|Fn|FnLock)$/
  const LABELS = {
    CommandOrControl: 'Ctrl',
    Return: 'Enter',
    Escape: 'Esc',
    numdec: 'Num .',
    numadd: 'Num +',
    numsub: 'Num -',
    nummult: 'Num *',
    numdiv: 'Num /'
  }

  let settings = null
  let shortcutBox = null
  let appBox = null
  let capture = null
  const updatesApi = desktop.updates && typeof desktop.updates === 'object' && typeof desktop.updates.getState === 'function' ? desktop.updates : null
  let updateState = null
  let updateBox = null
  let updateStatusEl = null
  let updateMessage = null
  let banner = null
  // Şeritte "Sonra" denilen sürümler (yalnızca bu oturumda)
  const dismissed = {}

  function hasOwn (object, key) {
    return Object.prototype.hasOwnProperty.call(object, key)
  }

  function node (tag, className, text) {
    const el = document.createElement(tag)
    if (className) el.className = className
    if (text !== undefined && text !== null) el.textContent = text
    return el
  }

  function actionButton (text) {
    const b = node('button', 'button button-secondary button-small', text)
    b.type = 'button'
    return b
  }

  function clearNode (el) {
    while (el.firstChild) el.removeChild(el.firstChild)
  }

  function keyFromCode (code) {
    if (typeof code !== 'string') return null
    if (/^Key[A-Z]$/.test(code)) return code.slice(3)
    if (/^Digit[0-9]$/.test(code)) return code.slice(5)
    if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
    if (/^Numpad[0-9]$/.test(code)) return 'num' + code.slice(6)
    return hasOwn(CODE_KEYS, code) ? CODE_KEYS[code] : null
  }

  // Klavye olayından Electron kısayol dizgesi (ör. CommandOrControl+Shift+M), tuş desteklenmiyorsa null
  function acceleratorFromEvent (e) {
    const key = keyFromCode(e.code)
    if (!key) return null
    const parts = []
    if (e.ctrlKey) parts.push('CommandOrControl')
    if (e.altKey) parts.push('Alt')
    if (e.shiftKey) parts.push('Shift')
    if (e.metaKey) parts.push('Super')
    parts.push(key)
    return parts.join('+')
  }

  function acceleratorLabel (accelerator) {
    if (typeof accelerator !== 'string' || accelerator === '') return ''
    return accelerator.split('+').map((part) => {
      if (part === 'Super') return desktop.platform === 'win32' ? 'Win' : 'Super'
      if (/^num[0-9]$/.test(part)) return 'Num ' + part.slice(3)
      return hasOwn(LABELS, part) ? LABELS[part] : part
    }).join('+')
  }

  function loadSettings () {
    return Promise.resolve(desktop.getSettings()).then((value) => {
      if (value && typeof value === 'object') settings = value
      return settings
    }, () => settings)
  }

  // Genel kısayol olayları: yalnızca uygulama açıkken (oturum varken) ses modülüne iletilir
  function onShortcut (action) {
    if (typeof state === 'undefined' || !state.inApp) return
    if (action === 'toggleMute' && typeof toggleMute === 'function') toggleMute()
    else if (action === 'toggleDeafen' && typeof toggleDeafen === 'function') toggleDeafen()
  }

  // PWA yükleme önerisi masaüstünde anlamsızdır: olay diğer işleyicilere ulaşmadan durdurulur
  function blockInstallPrompt (e) {
    e.preventDefault()
    e.stopImmediatePropagation()
    hideInstall()
  }

  function hideInstall () {
    if (typeof state !== 'undefined' && state) state.installPrompt = null
    const wrap = document.getElementById('set-install-wrap')
    if (wrap) wrap.hidden = true
  }

  // ---------------------------------------------------------------- genel kısayollar

  function stopCapture () {
    if (!capture) return
    window.removeEventListener('keydown', capture.onKey, true)
    clearTimeout(capture.timer)
    capture = null
  }

  function currentMap () {
    const map = {}
    ACTIONS.forEach((action) => {
      map[action] = settings && settings.shortcuts && settings.shortcuts[action] ? settings.shortcuts[action] : null
    })
    return map
  }

  function saveShortcut (action, accelerator) {
    const map = currentMap()
    map[action] = accelerator
    Promise.resolve(desktop.setShortcuts(map)).then((result) => {
      if (result && result.ok) {
        settings = result
        const taken = Boolean(accelerator) && Boolean(result.registered) && result.registered[action] === false
        drawShortcuts({ ok: !taken, text: t(taken ? 'desktop.shortcuts.taken' : (accelerator ? 'desktop.shortcuts.saved' : 'desktop.shortcuts.cleared')) }, action)
        return
      }
      drawShortcuts({ ok: false, text: t(result && result.code === 'duplicate' ? 'desktop.shortcuts.duplicate' : 'desktop.shortcuts.invalid') }, action)
    }, () => {
      drawShortcuts({ ok: false, text: t('desktop.shortcuts.invalid') }, action)
    })
  }

  function startCapture (action) {
    stopCapture()
    const onKey = (e) => {
      if (e.repeat) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (e.key === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        stopCapture()
        drawShortcuts(null, action)
        return
      }
      if (MODIFIER_CODE_RE.test(e.code)) return
      const accelerator = acceleratorFromEvent(e)
      stopCapture()
      if (!accelerator) {
        drawShortcuts({ ok: false, text: t('desktop.shortcuts.invalid') }, action)
        return
      }
      saveShortcut(action, accelerator)
    }
    capture = {
      action: action,
      onKey: onKey,
      timer: setTimeout(() => {
        stopCapture()
        drawShortcuts(null, action)
      }, CAPTURE_TIMEOUT_MS)
    }
    window.addEventListener('keydown', onKey, true)
    drawShortcuts(null, action)
  }

  function shortcutRow (action) {
    const current = settings && settings.shortcuts ? settings.shortcuts[action] : null
    const registered = settings && settings.registered ? settings.registered[action] : null
    const recording = Boolean(capture) && capture.action === action
    const row = node('div', 'row desktop-shortcut')
    row.setAttribute('data-desktop-action', action)
    const labelId = 'desktop-shortcut-' + action
    const label = node('span', 'label-inline', t('desktop.shortcuts.' + action))
    label.id = labelId
    const key = node('kbd', 'kbd', recording ? t('desktop.shortcuts.recording') : (current ? acceleratorLabel(current) : t('desktop.shortcuts.none')))
    const assign = actionButton(t(recording ? 'desktop.shortcuts.cancel' : 'desktop.shortcuts.assign'))
    assign.setAttribute('aria-describedby', labelId)
    assign.setAttribute('data-desktop-assign', action)
    assign.addEventListener('click', () => {
      if (capture && capture.action === action) {
        stopCapture()
        drawShortcuts(null, action)
      } else {
        startCapture(action)
      }
    })
    const remove = actionButton(t('desktop.shortcuts.clear'))
    remove.setAttribute('aria-describedby', labelId)
    remove.disabled = !current || recording
    remove.addEventListener('click', () => {
      stopCapture()
      saveShortcut(action, null)
    })
    row.appendChild(label)
    row.appendChild(key)
    row.appendChild(assign)
    row.appendChild(remove)
    if (current && registered === false) row.appendChild(node('p', 'hint is-error', t('desktop.shortcuts.taken')))
    return row
  }

  function drawShortcuts (message, focusAction) {
    const box = shortcutBox
    if (!box) return
    clearNode(box)
    const section = node('section', 'desktop-shortcuts')
    const title = node('h3', 'section-title', t('desktop.shortcuts.title'))
    title.id = 'desktop-shortcuts-title'
    section.setAttribute('aria-labelledby', title.id)
    section.appendChild(title)
    section.appendChild(node('p', 'hint', t('desktop.shortcuts.hint')))
    ACTIONS.forEach((action) => {
      section.appendChild(shortcutRow(action))
    })
    const status = node('p', 'form-msg')
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    if (message) {
      status.textContent = message.text
      status.classList.add(message.ok ? 'is-ok' : 'is-error')
    }
    section.appendChild(status)
    section.appendChild(node('p', 'hint', t('desktop.shortcuts.pttNote')))
    if (desktop.platform === 'linux') section.appendChild(node('p', 'hint', t('desktop.shortcuts.waylandNote')))
    box.appendChild(section)
    if (focusAction) {
      const target = box.querySelector('[data-desktop-assign="' + focusAction + '"]')
      if (target) target.focus()
    }
  }

  function renderShortcutSettings (container) {
    if (!container || typeof container.appendChild !== 'function') return false
    stopCapture()
    shortcutBox = container
    drawShortcuts(null, null)
    loadSettings().then(() => {
      if (shortcutBox === container && !capture) drawShortcuts(null, null)
    })
    return true
  }

  // ---------------------------------------------------------------- uygulama ayarları

  function drawApp (message) {
    const box = appBox
    if (!box) return
    clearNode(box)
    const section = node('section', 'desktop-app')
    const title = node('h3', 'section-title', t('desktop.app.title'))
    title.id = 'desktop-app-title'
    section.setAttribute('aria-labelledby', title.id)
    section.appendChild(title)

    const server = settings && typeof settings.server === 'string' ? settings.server : ''
    section.appendChild(node('p', 'label-value', t('desktop.server.current', { server: server })))
    const change = actionButton(t('desktop.server.change'))
    change.addEventListener('click', () => {
      Promise.resolve(desktop.changeServer()).catch(() => {})
    })
    section.appendChild(change)

    const trayAvailable = !settings || settings.trayAvailable !== false
    const toggle = node('label', 'switch desktop-tray')
    const input = node('input')
    input.type = 'checkbox'
    input.checked = Boolean(settings && settings.closeToTray)
    input.disabled = !trayAvailable
    const track = node('span', 'switch-track')
    track.setAttribute('aria-hidden', 'true')
    toggle.appendChild(input)
    toggle.appendChild(track)
    toggle.appendChild(node('span', null, t('desktop.tray.closeToTray')))
    input.addEventListener('change', () => {
      const wanted = input.checked
      Promise.resolve(desktop.setCloseToTray(wanted)).then((result) => {
        if (result && result.ok) settings = result
        drawApp({ ok: Boolean(result && result.ok), text: t(result && result.ok ? 'desktop.tray.saved' : 'desktop.tray.failed') })
      }, () => {
        drawApp({ ok: false, text: t('desktop.tray.failed') })
      })
    })
    section.appendChild(toggle)
    section.appendChild(node('p', 'hint', t(trayAvailable ? 'desktop.tray.hint' : 'desktop.tray.unavailable')))

    const status = node('p', 'form-msg')
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    if (message) {
      status.textContent = message.text
      status.classList.add(message.ok ? 'is-ok' : 'is-error')
    }
    section.appendChild(status)
    section.appendChild(node('p', 'hint', t('desktop.app.security')))
    if (desktop.version) section.appendChild(node('p', 'hint', t('desktop.app.version', { version: desktop.version })))
    if (updatesApi) {
      updateBox = node('div', 'desktop-updates')
      section.appendChild(updateBox)
      drawUpdates()
    }
    box.appendChild(section)
  }

  // ---------------------------------------------------------------- güncellemeler

  function updateStatusText (u) {
    if (!u) return t('desktop.update.status.idle')
    const version = u.version || ''
    if (u.status === 'checking') return t('desktop.update.status.checking')
    if (u.status === 'up-to-date') return t('desktop.update.status.upToDate')
    if (u.status === 'available') return t('desktop.update.status.available', { version: version })
    if (u.status === 'downloading') return t('desktop.update.status.downloading', { version: version, percent: u.percent === null ? 0 : u.percent })
    if (u.status === 'downloaded') return t('desktop.update.status.downloaded', { version: version })
    if (u.status === 'error') return t('desktop.update.error.' + (u.error || 'failed'))
    return t(u.enabled ? 'desktop.update.status.idle' : 'desktop.update.status.disabled')
  }

  function lastCheckText (ms) {
    if (typeof formatShort === 'function') return formatShort(ms)
    return new Date(ms).toString()
  }

  function updateButton (text, key, primary, onClick) {
    const b = node('button', primary ? 'button button-small' : 'button button-secondary button-small', text)
    b.type = 'button'
    b.setAttribute('data-desktop-update', key)
    b.addEventListener('click', onClick)
    return b
  }

  function afterUpdateCall (result, okKey, failKey) {
    if (result && result.state) applyUpdateState(result.state)
    updateMessage = null
    if (result && result.ok && okKey) updateMessage = { ok: true, text: t(okKey) }
    else if (!(result && result.ok) && failKey) updateMessage = { ok: false, text: t(failKey) }
    drawUpdates()
  }

  function runInstall () {
    Promise.resolve(updatesApi.install()).then((result) => {
      if (!(result && result.ok)) afterUpdateCall(result, null, 'desktop.update.installFailed')
    }, () => afterUpdateCall(null, null, 'desktop.update.installFailed'))
  }

  function runOpenRelease () {
    Promise.resolve(updatesApi.openRelease()).catch(() => {})
  }

  function drawUpdates () {
    const box = updateBox
    if (!box || !updatesApi) return
    const focused = document.activeElement && box.contains(document.activeElement) ? document.activeElement.getAttribute('data-desktop-update') : null
    clearNode(box)
    const u = updateState
    const enabled = Boolean(u && u.enabled)
    const title = node('h4', 'section-title', t('desktop.update.title'))
    title.id = 'desktop-update-title'
    box.setAttribute('role', 'group')
    box.setAttribute('aria-labelledby', title.id)
    box.appendChild(title)

    const toggle = node('label', 'switch desktop-update-auto')
    const input = node('input')
    input.type = 'checkbox'
    input.checked = enabled
    input.disabled = !u
    input.setAttribute('data-desktop-update', 'auto')
    const track = node('span', 'switch-track')
    track.setAttribute('aria-hidden', 'true')
    toggle.appendChild(input)
    toggle.appendChild(track)
    toggle.appendChild(node('span', null, t('desktop.update.auto')))
    input.addEventListener('change', () => {
      const wanted = input.checked
      Promise.resolve(updatesApi.setEnabled(wanted)).then((result) => {
        afterUpdateCall(result, 'desktop.tray.saved', 'desktop.tray.failed')
      }, () => afterUpdateCall(null, null, 'desktop.tray.failed'))
    })
    box.appendChild(toggle)
    box.appendChild(node('p', 'hint', t(u && u.mode === 'auto' ? 'desktop.update.hintAuto' : 'desktop.update.hintNotify')))
    box.appendChild(node('p', 'hint', t('desktop.update.privacy')))

    updateStatusEl = node('p', 'label-value desktop-update-status', updateStatusText(u))
    box.appendChild(updateStatusEl)
    if (u && u.lastCheckAt) box.appendChild(node('p', 'hint', t('desktop.update.lastCheck', { time: lastCheckText(u.lastCheckAt) })))

    const actions = node('div', 'row desktop-update-actions')
    const busy = Boolean(u) && (u.status === 'checking' || u.status === 'downloading')
    const check = updateButton(t('desktop.update.checkNow'), 'check', false, () => {
      updateMessage = null
      Promise.resolve(updatesApi.checkNow()).then((result) => {
        if (result && result.state) applyUpdateState(result.state)
        drawUpdates()
      }, () => afterUpdateCall(null, null, 'desktop.update.error.failed'))
    })
    check.disabled = !enabled || busy
    actions.appendChild(check)
    if (u && u.canInstall) actions.appendChild(updateButton(t('desktop.update.install'), 'install', true, runInstall))
    if (u && u.mode === 'notify' && u.status === 'available') actions.appendChild(updateButton(t('desktop.update.openRelease'), 'open', true, runOpenRelease))
    box.appendChild(actions)

    const status = node('p', 'form-msg')
    status.setAttribute('role', 'status')
    status.setAttribute('aria-live', 'polite')
    if (updateMessage) {
      status.textContent = updateMessage.text
      status.classList.add(updateMessage.ok ? 'is-ok' : 'is-error')
    }
    box.appendChild(status)
    if (focused) {
      const target = box.querySelector('[data-desktop-update="' + focused + '"]')
      if (target && !target.disabled) target.focus()
    }
  }

  // Köşedeki şerit: indirilmiş güncelleme veya (bildirim kipinde) yeni sürüm
  function drawBanner () {
    const u = updateState
    let kind = null
    if (u && u.canInstall && u.version) kind = 'downloaded'
    else if (u && u.mode === 'notify' && u.status === 'available' && u.version) kind = 'available'
    if (!kind || dismissed[kind + ':' + u.version]) {
      if (banner) banner.hidden = true
      return
    }
    if (!banner) {
      if (!document.body) return
      banner = node('div', 'desktop-update-banner')
      banner.id = 'desktop-update-banner'
      banner.setAttribute('role', 'status')
      banner.setAttribute('aria-live', 'polite')
      document.body.appendChild(banner)
    }
    clearNode(banner)
    banner.appendChild(node('p', 'desktop-update-text', t('desktop.update.banner.' + kind, { version: u.version })))
    const actions = node('div', 'desktop-update-actions')
    if (kind === 'downloaded') actions.appendChild(updateButton(t('desktop.update.install'), 'banner-install', true, runInstall))
    else actions.appendChild(updateButton(t('desktop.update.openRelease'), 'banner-open', true, runOpenRelease))
    actions.appendChild(updateButton(t('desktop.update.later'), 'banner-later', false, () => {
      dismissed[kind + ':' + u.version] = true
      banner.hidden = true
    }))
    banner.appendChild(actions)
    banner.hidden = false
  }

  function applyUpdateState (value) {
    if (!value || typeof value !== 'object') return
    const prev = updateState
    updateState = value
    const same = prev && prev.status === value.status && prev.enabled === value.enabled && prev.version === value.version &&
      prev.lastCheckAt === value.lastCheckAt && prev.error === value.error && prev.canInstall === value.canInstall
    if (!same) drawBanner()
    if (!updateBox || !updateBox.isConnected) return
    // Yalnızca indirme yüzdesi değiştiyse durum satırı güncellenir, bölüm yeniden çizilmez
    if (same && updateStatusEl) updateStatusEl.textContent = updateStatusText(value)
    else drawUpdates()
  }

  function renderAppSettings (container) {
    if (!container || typeof container.appendChild !== 'function') return false
    appBox = container
    hideInstall()
    drawApp(null)
    loadSettings().then(() => {
      if (appBox === container) drawApp(null)
    })
    return true
  }

  function refresh () {
    if (shortcutBox && shortcutBox.isConnected) renderShortcutSettings(shortcutBox)
    if (appBox && appBox.isConnected) renderAppSettings(appBox)
    drawBanner()
  }

  document.documentElement.setAttribute('data-desktop', '1')
  window.addEventListener('beforeinstallprompt', blockInstallPrompt, true)
  desktop.onShortcut(onShortcut)
  if (updatesApi) {
    if (typeof updatesApi.onState === 'function') updatesApi.onState(applyUpdateState)
    Promise.resolve(updatesApi.getState()).then(applyUpdateState, () => {})
  }

  return {
    active: true,
    platform: typeof desktop.platform === 'string' ? desktop.platform : '',
    version: typeof desktop.version === 'string' ? desktop.version : '',
    acceleratorLabel: acceleratorLabel,
    renderShortcutSettings: renderShortcutSettings,
    renderAppSettings: renderAppSettings,
    refresh: refresh
  }
})()
