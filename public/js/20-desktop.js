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
    box.appendChild(section)
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
  }

  document.documentElement.setAttribute('data-desktop', '1')
  window.addEventListener('beforeinstallprompt', blockInstallPrompt, true)
  desktop.onShortcut(onShortcut)

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
