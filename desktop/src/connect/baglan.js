'use strict'

// Sunucu adresi ekranı. Adres ana süreçte doğrulanır ve /api/info ile denetlenir, bu sayfa
// yalnızca formu gösterir ve sonucu yazar. Metinler ana süreçten gelir (src/lib/strings.js) ve
// her zaman textContent ile yerleştirilir.

const api = window.telsizConnect
const el = {}
let texts = {}
let busy = false
let canCancel = false

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

function setStatus (message, kind) {
  el.status.textContent = message || ''
  el.status.className = 'status' + (kind ? ' is-' + kind : '')
}

function setBusy (value) {
  busy = value
  el.submit.disabled = value
  el.anyway.disabled = value
  el.address.readOnly = value
  document.body.classList.toggle('is-busy', value)
}

function errorText (code) {
  const key = 'connect.error.' + code
  return Object.prototype.hasOwnProperty.call(texts, key) ? texts[key] : text('connect.error.unknown')
}

function showWarning (result) {
  const key = result.reason === 'unknown' ? 'connect.version.unknown' : 'connect.version.mismatch'
  el.warningText.textContent = text(key, {
    name: result.serverName || result.origin || '',
    server: result.serverVersion || '?',
    app: result.appVersion || '?'
  })
  el.warning.hidden = false
  el.anyway.focus()
}

async function submit (acceptMismatch) {
  if (busy) return
  el.warning.hidden = true
  setBusy(true)
  setStatus(text('connect.checking'))
  let result = null
  try {
    result = await api.submit(el.address.value, acceptMismatch)
  } catch (err) {
    result = null
  }
  if (result && result.ok) {
    // Ana süreç uygulama penceresini açar ve bu pencereyi kapatır
    setStatus(text('connect.connecting', { name: result.serverName || result.origin }), 'ok')
    return
  }
  setBusy(false)
  if (result && result.code === 'version') {
    setStatus('')
    showWarning(result)
    return
  }
  setStatus(errorText(result && typeof result.code === 'string' ? result.code : 'unknown'), 'error')
  el.address.focus()
}

function cancel () {
  if (!canCancel) return
  api.cancel().catch(() => {})
}

async function init () {
  const ids = ['title', 'lead', 'current', 'form', 'label', 'address', 'hint', 'status', 'warning', 'anyway', 'cancel', 'submit', 'security']
  for (const id of ids) el[id] = byId(id)
  el.warningText = byId('warning-text')
  let data = null
  try {
    data = await api.init()
  } catch (err) {
    data = null
  }
  texts = data && data.strings && typeof data.strings === 'object' ? data.strings : {}
  canCancel = Boolean(data && data.canCancel)
  document.documentElement.lang = data && data.lang === 'tr' ? 'tr' : 'en'
  document.title = text('connect.windowTitle')
  el.title.textContent = text('connect.title')
  el.lead.textContent = text('connect.lead')
  el.label.textContent = text('connect.label')
  el.address.placeholder = text('connect.placeholder')
  el.hint.textContent = text('connect.hint')
  el.submit.textContent = text('connect.submit')
  el.cancel.textContent = text('connect.cancel')
  el.anyway.textContent = text('connect.anyway')
  el.security.textContent = text('connect.security')
  el.cancel.hidden = !canCancel
  if (data && typeof data.current === 'string' && data.current) {
    el.current.textContent = text('connect.current', { server: data.current })
    el.current.hidden = false
    el.address.value = data.current
  }
  el.form.addEventListener('submit', (event) => {
    event.preventDefault()
    submit(false)
  })
  el.anyway.addEventListener('click', () => {
    submit(true)
  })
  el.cancel.addEventListener('click', cancel)
  el.address.addEventListener('input', () => {
    el.warning.hidden = true
    if (!busy) setStatus('')
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') cancel()
  })
  el.address.focus()
  el.address.select()
}

init()
