'use strict'

// Mikrofon düğmesinin (#btn-mute) bağlam menüsü: sağ tık (dokunmatikte uzun basış da contextmenu olayı
// üretir), klavyede Shift+F10 veya Menü tuşu. İki seçenek vardır: Bas konuş ve Ses etkinliği. Seçim ses
// ayarındaki giriş moduna yazılır (11-settings.js applyVoiceSettings), telsiz kartı motorun değişiklik
// bildirimiyle yeniden çizilir. Düğmeye normal basmak mikrofonu açıp kapatmaya devam eder.

const MIC_MODES = [
  { value: 'ptt', label: 'voice.pushToTalk', icon: 'i-ptt' },
  { value: 'vad', label: 'radio.vad', icon: 'i-wave' }
]
let micMenuNode = null

function micModeNow () {
  const s = typeof snap === 'function' ? snap() : null
  return s && s.inputMode === 'ptt' ? 'ptt' : 'vad'
}

function closeMicModeMenu () {
  const layer = findLayer('mic-menu')
  if (layer) closeLayer(layer, false)
}

function openMicModeMenu (anchor) {
  if (!voice || !anchor) return
  if (findLayer('mic-menu')) {
    closeMicModeMenu()
    return
  }
  if (!micMenuNode) {
    micMenuNode = h('div', 'popup-menu mic-menu')
    micMenuNode.id = 'mic-menu'
    micMenuNode.hidden = true
    document.body.appendChild(micMenuNode)
  }
  const menu = micMenuNode
  clear(menu)
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', t('radio.micMenu'))
  const current = micModeNow()
  MIC_MODES.forEach((mode) => {
    const item = h('button', 'menu-item mic-menu-item')
    item.type = 'button'
    item.setAttribute('role', 'menuitemradio')
    item.setAttribute('aria-checked', mode.value === current ? 'true' : 'false')
    item.setAttribute('data-mode', mode.value)
    item.appendChild(icon(mode.icon))
    item.appendChild(h('span', 'mic-menu-label', t(mode.label)))
    if (mode.value === current) item.appendChild(icon('i-check', 'mic-menu-check'))
    item.addEventListener('click', () => {
      closeMicModeMenu()
      if (mode.value !== micModeNow() && typeof applyVoiceSettings === 'function') applyVoiceSettings({ inputMode: mode.value })
    })
    menu.appendChild(item)
  })
  menu.hidden = false
  positionPopup(menu, anchor)
  openLayer({
    name: 'mic-menu',
    el: menu,
    trigger: anchor,
    level: 2,
    outside: true,
    closeOnFocusOut: true,
    initialFocus: () => menu.querySelector('[aria-checked="true"]') || menu.querySelector('button'),
    onClose: () => {
      menu.hidden = true
      clear(menu)
    }
  })
}

function bindMicModeMenu () {
  const b = el.btnMute
  if (!b) return
  b.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    openMicModeMenu(b)
  })
  b.addEventListener('keydown', (e) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault()
      openMicModeMenu(b)
    }
  })
}
