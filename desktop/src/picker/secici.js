'use strict'

// Ekran paylaşımı seçicisi. Kaynak listesi (ekranlar ve pencereler, küçük resimleriyle) ana
// süreçten gelir. Seçilen kimliğin sunulan kaynaklardan biri olduğu ana süreçte yeniden denetlenir.
// Pencere adları başka uygulamalardan gelen güvenilmeyen metindir ve yalnızca textContent ile
// yerleştirilir. Küçük resimler yalnızca data:image/png adresleridir (CSP img-src 'self' data:).

const api = window.telsizPicker
const el = {}
let texts = {}
let selectedId = null
let busy = false

function byId (id) {
  return document.getElementById(id)
}

function text (key, params) {
  const raw = Object.prototype.hasOwnProperty.call(texts, key) ? texts[key] : key
  if (!params) return raw
  return raw.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name) => {
    return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
  })
}

function select (button, source) {
  selectedId = source.id
  for (const node of document.querySelectorAll('.source')) {
    node.setAttribute('aria-pressed', node === button ? 'true' : 'false')
  }
  el.share.disabled = false
  el.selected.textContent = text('picker.selected', { name: source.name })
}

async function share () {
  if (busy || !selectedId) return
  busy = true
  el.share.disabled = true
  let result = null
  try {
    result = await api.choose(selectedId, el.audio.checked)
  } catch (err) {
    result = null
  }
  if (!result || !result.ok) {
    busy = false
    el.share.disabled = false
  }
}

function cancel () {
  if (busy) return
  busy = true
  api.cancel().catch(() => {})
}

function buildSource (source) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'source'
  button.setAttribute('aria-pressed', 'false')
  const frame = document.createElement('span')
  frame.className = 'thumb'
  if (typeof source.thumbnail === 'string' && source.thumbnail.startsWith('data:image/png;base64,')) {
    const img = document.createElement('img')
    img.alt = ''
    img.src = source.thumbnail
    frame.appendChild(img)
  }
  const name = document.createElement('span')
  name.className = 'name'
  name.textContent = source.name
  button.title = source.name
  button.appendChild(frame)
  button.appendChild(name)
  button.addEventListener('click', () => select(button, source))
  button.addEventListener('dblclick', () => {
    select(button, source)
    share()
  })
  return button
}

async function init () {
  const ids = ['title', 'lead', 'screens-section', 'screens-title', 'screens', 'windows-section', 'windows-title', 'windows', 'empty', 'audio-wrap', 'audio', 'audio-label', 'audio-hint', 'selected', 'cancel', 'share']
  for (const id of ids) el[id.replace(/-([a-z])/g, (whole, letter) => letter.toUpperCase())] = byId(id)
  let data = null
  try {
    data = await api.init()
  } catch (err) {
    data = null
  }
  texts = data && data.strings && typeof data.strings === 'object' ? data.strings : {}
  document.documentElement.lang = data && data.lang === 'tr' ? 'tr' : 'en'
  document.title = text('picker.windowTitle')
  el.title.textContent = text('picker.title')
  el.lead.textContent = text('picker.lead')
  el.screensTitle.textContent = text('picker.screens')
  el.windowsTitle.textContent = text('picker.windows')
  el.empty.textContent = text('picker.empty')
  el.audioLabel.textContent = text('picker.systemAudio')
  el.audioHint.textContent = text('picker.systemAudioHint')
  el.cancel.textContent = text('picker.cancel')
  el.share.textContent = text('picker.share')
  el.audioWrap.hidden = !(data && data.systemAudio === true)
  const sources = data && Array.isArray(data.sources) ? data.sources : []
  for (const source of sources) {
    const target = source.type === 'screen' ? el.screens : el.windows
    target.appendChild(buildSource(source))
  }
  el.screensSection.hidden = el.screens.childElementCount === 0
  el.windowsSection.hidden = el.windows.childElementCount === 0
  el.empty.hidden = sources.length > 0
  el.share.addEventListener('click', share)
  el.cancel.addEventListener('click', cancel)
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cancel()
  })
  const first = document.querySelector('.source')
  if (first) first.focus()
  else el.cancel.focus()
}

init()
