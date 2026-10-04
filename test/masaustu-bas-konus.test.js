'use strict'

// Masaüstü uygulamasında arka planda bas konuş: public/voice.js içindeki dış bas konuş kaynağı (masaüstü
// kısayolu veya tuş kancası) ve public/js/20-desktop.js içindeki bas aç, bas kapat kısayolu, basılı tut
// olayları, ses odası durumunun ana sürece bildirilmesi ve ayar bölümü. Modüller Node vm bağlamında
// sahte tarayıcı nesneleriyle yüklenir. Ana süreç tarafı desktop/test/ altında, gerçek Electron ile
// olan kontroller desktop/e2e/duman.test.js içindedir.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const PUB = path.join(__dirname, '..', 'public')
const VOICE = fs.readFileSync(path.join(PUB, 'voice.js'), 'utf8')
const DESKTOP = fs.readFileSync(path.join(PUB, 'js', '20-desktop.js'), 'utf8')
const I18N = fs.readFileSync(path.join(PUB, 'i18n.js'), 'utf8')

function noop () {}

function tick () {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ---------------------------------------------------------------- VoiceClient

// Sahte mikrofonlu VoiceClient: AudioContext yoktur, ses ham izden gider (kapı izin enabled değeridir)
function loadVoice () {
  const winListeners = {}
  const docListeners = {}
  const tracks = []
  function makeTrack () {
    const track = { kind: 'audio', enabled: true, onended: null, stop: noop, clone: () => makeTrack() }
    tracks.push(track)
    return track
  }
  const md = {
    getUserMedia: () => {
      const track = makeTrack()
      return Promise.resolve({ getAudioTracks: () => [track], getTracks: () => [track] })
    }
  }
  const listen = (map, type, fn) => {
    if (!map[type]) map[type] = new Set()
    map[type].add(fn)
  }
  const win = {
    isSecureContext: true,
    addEventListener (type, fn) {
      listen(winListeners, type, fn)
    },
    removeEventListener (type, fn) {
      if (winListeners[type]) winListeners[type].delete(fn)
    },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    console: { log: noop, warn: noop, error: noop }
  }
  win.window = win
  win.navigator = { mediaDevices: md }
  win.document = {
    visibilityState: 'visible',
    documentElement: { lang: 'tr' },
    addEventListener (type, fn) {
      listen(docListeners, type, fn)
    },
    removeEventListener (type, fn) {
      if (docListeners[type]) docListeners[type].delete(fn)
    }
  }
  win.RTCPeerConnection = function () {}
  win.MediaStream = function (list) {
    this.list = list
  }
  vm.createContext(win)
  vm.runInContext(VOICE, win, { filename: 'voice.js' })
  const store = new Map()
  const client = win.VoiceClient.create({
    api: () => Promise.resolve({ status: 200, data: {} }),
    seal: () => 'x',
    open: () => ({ ok: false }),
    storage: {
      get: (key) => (store.has(key) ? JSON.parse(store.get(key)) : null),
      set: (key, value) => store.set(key, value)
    }
  })
  const fire = (target, type, event) => {
    const set = (target === 'doc' ? docListeners : winListeners)[type]
    for (const fn of Array.from(set || [])) fn(event || {})
  }
  return { client, win, fire, tracks }
}

// Bas konuş modunda, mikrofon testi açık (dinleyiciler kurulu), bırakma gecikmesi yok
async function pttVoice () {
  const v = loadVoice()
  await v.client.setSettings({ inputMode: 'ptt', pttReleaseMs: 0 })
  await v.client.startMicTest()
  return v
}

test('dış kaynak (masaüstü) VoiceClient bas konuş yolunu kullanır ve anlık durumda görünür', async () => {
  const v = await pttVoice()
  const c = v.client
  try {
    assert.deepEqual(JSON.parse(JSON.stringify(c.snapshot().ptt)), { enabled: true, active: false, external: false })
    assert.equal(c.snapshot().gateOpen, false)
    c.pttDown('external')
    assert.equal(c.snapshot().ptt.external, true)
    assert.equal(c.snapshot().ptt.active, true)
    assert.equal(c.snapshot().gateOpen, true, 'mikrofon açıldı')
    c.pttUp('external')
    assert.equal(c.snapshot().ptt.active, false)
    assert.equal(c.snapshot().gateOpen, false)
    // Kaynak verilmezse ekrandaki düğme sayılır, dış kaynakla karışmaz
    c.pttDown()
    assert.equal(c.snapshot().ptt.external, false)
    assert.equal(c.snapshot().ptt.active, true)
    c.pttUp()
    assert.equal(c.snapshot().ptt.active, false)
  } finally {
    c.stopMicTest()
  }
})

test('iki kaynak birbirini bozmaz: biri bırakılınca diğeri basılıysa konuşma sürer', async () => {
  const v = await pttVoice()
  const c = v.client
  try {
    // Pencerenin kendi tuşu (V) ve masaüstü kaynağı
    v.fire('win', 'keydown', { code: 'KeyV', repeat: false, target: null })
    c.pttDown('external')
    v.fire('win', 'keyup', { code: 'KeyV' })
    assert.equal(c.snapshot().ptt.active, true, 'tuş bırakıldı, masaüstü kaynağı basılı')
    assert.equal(c.snapshot().gateOpen, true)
    v.fire('win', 'keydown', { code: 'KeyV', repeat: false, target: null })
    c.pttUp('external')
    assert.equal(c.snapshot().ptt.active, true, 'masaüstü kaynağı bırakıldı, tuş basılı')
    v.fire('win', 'keyup', { code: 'KeyV' })
    assert.equal(c.snapshot().ptt.active, false)
    // Ekrandaki düğme ve masaüstü kaynağı
    c.pttDown()
    c.pttDown('external')
    c.pttUp()
    assert.equal(c.snapshot().ptt.active, true)
    c.pttUp('external')
    assert.equal(c.snapshot().ptt.active, false)
  } finally {
    c.stopMicTest()
  }
})

test('pencere odağı kaybedince veya gizlenince yalnızca pencere içi kaynaklar bırakılır', async () => {
  const v = await pttVoice()
  const c = v.client
  try {
    // Yalnızca pencere içi tuş: odak kaybında bırakılır
    v.fire('win', 'keydown', { code: 'KeyV', repeat: false, target: null })
    v.fire('win', 'blur')
    assert.equal(c.snapshot().ptt.active, false)
    // Masaüstü kaynağı (oyun öndeyken bas aç, bas kapat) odak kaybında açık kalır
    c.pttDown('external')
    v.fire('win', 'keydown', { code: 'KeyV', repeat: false, target: null })
    v.fire('win', 'blur')
    assert.equal(c.snapshot().ptt.active, true)
    assert.equal(c.snapshot().ptt.external, true)
    assert.equal(c.snapshot().gateOpen, true)
    v.win.document.visibilityState = 'hidden'
    v.fire('doc', 'visibilitychange')
    assert.equal(c.snapshot().ptt.active, true, 'pencere gizliyken (tepsi) de sürer')
    // Pencere tuşu blur ile bırakılmıştı: masaüstü kaynağı bırakılınca konuşma biter
    c.pttUp('external')
    assert.equal(c.snapshot().ptt.active, false)
    assert.equal(c.snapshot().gateOpen, false)
  } finally {
    c.stopMicTest()
  }
})

test('ses etkinliği moduna geçince ve mikrofon kapalıyken dış kaynak konuşturmaz', async () => {
  const v = await pttVoice()
  const c = v.client
  try {
    c.pttDown('external')
    await c.setSettings({ inputMode: 'vad' })
    assert.equal(c.snapshot().ptt.external, false, 'mod değişince her kaynak bırakılır')
    // Ses etkinliği modunda bas konuş kaynağı yok sayılır
    c.pttDown('external')
    assert.equal(c.snapshot().ptt.external, false)
    await c.setSettings({ inputMode: 'ptt' })
    // Yalnızca atama değişince masaüstü kaynağı açık kalır
    c.pttDown('external')
    await c.setSettings({ bindings: { ptt: { type: 'key', code: 'KeyB' } } })
    assert.equal(c.snapshot().ptt.external, true)
    // Susturulmuşken kaynak basılı olsa da kapı kapalıdır
    c.setMuted(true)
    assert.equal(c.snapshot().gateOpen, false)
    c.setMuted(false)
    assert.equal(c.snapshot().gateOpen, true)
    c.pttUp('external')
  } finally {
    c.stopMicTest()
  }
})

test('mikrofon bırakılınca (ses odasından çıkış) dış kaynak da bırakılır, ipucu sesi güvenle çağrılır', async () => {
  const v = await pttVoice()
  const c = v.client
  c.pttDown('external')
  c.stopMicTest()
  assert.equal(c.snapshot().ptt.external, false)
  assert.equal(c.snapshot().ptt.active, false)
  // AudioContext yokken ipucu sesi sessizce geçer, bilinmeyen tür yok sayılır
  c.playCue('pttOn')
  c.playCue('pttOff')
  c.playCue('join')
  c.playCue({})
  assert.equal(typeof c.playCue, 'function')
})

// ---------------------------------------------------------------- 20-desktop.js

// Küçük DOM taklidi: öğe ağacı, öznitelikler, sınıflar, olaylar, odak ve [ad="değer"] seçicileri
class FakeElement {
  constructor (doc, tag) {
    this.ownerDocument = doc
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parentNode = null
    this.attrs = new Map()
    this.listeners = {}
    this.className = ''
    this.text = ''
    this.disabled = false
    this.checked = false
    this.hidden = false
    this.type = ''
    this.id = ''
  }

  get firstChild () {
    return this.children[0] || null
  }

  appendChild (child) {
    if (child.parentNode) child.parentNode.removeChild(child)
    child.parentNode = this
    this.children.push(child)
    return child
  }

  removeChild (child) {
    const i = this.children.indexOf(child)
    if (i >= 0) this.children.splice(i, 1)
    child.parentNode = null
    return child
  }

  set textContent (value) {
    this.children = []
    this.text = String(value)
  }

  get textContent () {
    return this.text + this.children.map((c) => c.textContent).join('')
  }

  get classList () {
    const el = this
    return {
      add: (name) => {
        el.className = (el.className + ' ' + name).trim()
      },
      contains: (name) => el.className.split(/\s+/).includes(name)
    }
  }

  setAttribute (name, value) {
    this.attrs.set(name, String(value))
  }

  getAttribute (name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null
  }

  addEventListener (type, fn) {
    if (!this.listeners[type]) this.listeners[type] = []
    this.listeners[type].push(fn)
  }

  removeEventListener () {}

  dispatch (type) {
    for (const fn of this.listeners[type] || []) fn({ type, target: this, preventDefault: noop })
  }

  click () {
    this.dispatch('click')
  }

  focus () {
    this.ownerDocument.activeElement = this
  }

  get isConnected () {
    let node = this
    while (node.parentNode) node = node.parentNode
    return node === this.ownerDocument.body
  }

  contains (node) {
    let current = node
    while (current) {
      if (current === this) return true
      current = current.parentNode
    }
    return false
  }

  descendants () {
    const out = []
    for (const child of this.children) out.push(child, ...child.descendants())
    return out
  }

  querySelectorAll (selector) {
    const attr = /^\[([a-z-]+)="([^"]*)"\]$/.exec(selector)
    return this.descendants().filter((el) => {
      if (attr) return el.getAttribute(attr[1]) === attr[2]
      if (selector.startsWith('.')) return el.classList.contains(selector.slice(1))
      return el.tagName === selector.toUpperCase()
    })
  }

  querySelector (selector) {
    return this.querySelectorAll(selector)[0] || null
  }
}

function makeDocument () {
  const doc = { activeElement: null }
  doc.createElement = (tag) => new FakeElement(doc, tag)
  doc.body = new FakeElement(doc, 'body')
  doc.documentElement = new FakeElement(doc, 'html')
  doc.documentElement.lang = 'tr'
  doc.getElementById = () => null
  return doc
}

// Sahte ses modülü: anlık durum ve çağrı kaydı
function fakeVoice (initial) {
  const s = Object.assign({ channelId: 'ses1', inputMode: 'ptt', muted: false, ptt: { enabled: true, active: false, external: false } }, initial || {})
  const calls = []
  return {
    s,
    calls,
    snapshot: () => JSON.parse(JSON.stringify(s)),
    pttDown: (source) => {
      calls.push(['down', source])
      if (source === 'external' && s.inputMode === 'ptt') s.ptt.external = true
    },
    pttUp: (source) => {
      calls.push(['up', source])
      if (source === 'external') s.ptt.external = false
    },
    playCue: (kind) => calls.push(['cue', kind])
  }
}

// Sahte window.telsizDesktop: abonelikler, ayar çağrıları ve ana sürece giden ses odası durumu
function fakeDesktop (opts) {
  const o = opts || {}
  const d = {
    platform: 'linux',
    version: '2.2.0',
    shortcutCb: null,
    holdCb: null,
    voiceSent: [],
    pttCalls: [],
    settings: Object.assign({
      server: 'https://telsiz.ornek.com',
      closeToTray: false,
      trayAvailable: true,
      shortcuts: { toggleMute: null, toggleDeafen: null, pttToggle: 'CommandOrControl+Alt+V' },
      registered: { toggleMute: null, toggleDeafen: null, pttToggle: true },
      ptt: { mode: 'toggle', holdKey: null },
      pttHook: { available: true, reason: null, running: false, error: null }
    }, o.settings || {}),
    getSettings: () => Promise.resolve(JSON.parse(JSON.stringify(d.settings))),
    setShortcuts: () => Promise.resolve({ ok: false, code: 'invalid' }),
    setCloseToTray: () => Promise.resolve({ ok: false }),
    changeServer: () => Promise.resolve(true),
    onShortcut: (cb) => {
      d.shortcutCb = cb
      return noop
    }
  }
  if (!o.noPtt) {
    d.setPtt = (value) => {
      d.pttCalls.push(value)
      const result = o.setPtt ? o.setPtt(value, d.settings) : { ok: true }
      if (result.ok) d.settings.ptt = { mode: value.mode, holdKey: value.holdKey }
      return Promise.resolve(Object.assign({}, JSON.parse(JSON.stringify(d.settings)), result))
    }
    d.setVoiceActive = (value) => d.voiceSent.push(value)
    d.onPttHold = (cb) => {
      d.holdCb = cb
      return noop
    }
  }
  return d
}

function loadDesktop (opts) {
  const o = opts || {}
  const desktop = fakeDesktop(o)
  const voice = fakeVoice(o.voice)
  const sandbox = vm.createContext({})
  const toggles = []
  sandbox.window = sandbox
  sandbox.self = sandbox
  sandbox.addEventListener = noop
  sandbox.removeEventListener = noop
  sandbox.console = { log: noop, warn: noop, error: noop }
  sandbox.setTimeout = setTimeout
  sandbox.clearTimeout = clearTimeout
  sandbox.navigator = { languages: ['tr-TR'], language: 'tr-TR' }
  sandbox.localStorage = { getItem: () => 'tr', setItem: noop, removeItem: noop }
  sandbox.document = makeDocument()
  vm.runInContext(I18N, sandbox, { filename: 'i18n.js' })
  sandbox.t = (key, params) => sandbox.I18N.t(key, params)
  sandbox.telsizDesktop = desktop
  sandbox.state = { inApp: o.inApp !== false }
  sandbox.voice = voice
  // 10-voice.js toggleMute: ses etkinliği modunda kısayol bunu çağırır
  sandbox.toggleMute = () => {
    toggles.push('mute')
    voice.s.muted = !voice.s.muted
  }
  sandbox.toggleDeafen = () => toggles.push('deafen')
  vm.runInContext(DESKTOP, sandbox, { filename: '20-desktop.js' })
  return { ui: sandbox.TelsizDesktopUI, desktop, voice, toggles, sandbox }
}

test('bas aç, bas kapat: bas konuş modunda masaüstü kaynağı açılır ve kapanır, ipucu sesi çalar', () => {
  const { desktop, voice } = loadDesktop()
  desktop.shortcutCb('pttToggle')
  assert.deepEqual(voice.calls, [['down', 'external'], ['cue', 'pttOn']])
  desktop.shortcutCb('pttToggle')
  assert.deepEqual(voice.calls.slice(2), [['up', 'external'], ['cue', 'pttOff']])
  assert.equal(voice.s.ptt.external, false)
})

test('bas aç, bas kapat: ses odasında değilken veya oturum yokken hiçbir şey yapmaz', () => {
  const out = loadDesktop({ voice: { channelId: null } })
  out.desktop.shortcutCb('pttToggle')
  assert.deepEqual(out.voice.calls, [])
  assert.deepEqual(out.toggles, [])
  const noSession = loadDesktop({ inApp: false })
  noSession.desktop.shortcutCb('pttToggle')
  assert.deepEqual(noSession.voice.calls, [])
})

test('bas aç, bas kapat: ses etkinliği modunda bas konuşa geçmez, mikrofonu aç/kapat gibi davranır', () => {
  const { desktop, voice, toggles } = loadDesktop({ voice: { inputMode: 'vad', ptt: { enabled: false, active: false, external: false } } })
  desktop.shortcutCb('pttToggle')
  assert.deepEqual(toggles, ['mute'])
  assert.deepEqual(voice.calls, [['cue', 'pttOff']], 'mikrofon kapandı')
  desktop.shortcutCb('pttToggle')
  assert.deepEqual(toggles, ['mute', 'mute'])
  assert.deepEqual(voice.calls.slice(1), [['cue', 'pttOn']], 'mikrofon açıldı')
  assert.equal(voice.s.inputMode, 'vad', 'mod değişmedi')
})

test('bas aç, bas kapat: mikrofon kapalıyken konuşma başlamaz, kapanış sesi çalar', () => {
  const { desktop, voice } = loadDesktop({ voice: { muted: true } })
  desktop.shortcutCb('pttToggle')
  assert.deepEqual(voice.calls, [['cue', 'pttOff']])
  // Açık kalmış kaynak susturulmuşken de kapatılabilir
  voice.s.ptt.external = true
  desktop.shortcutCb('pttToggle')
  assert.deepEqual(voice.calls.slice(1), [['up', 'external'], ['cue', 'pttOff']])
})

test('diğer genel kısayollar değişmeden çalışır, bilinmeyen eylem yok sayılır', () => {
  const { desktop, voice, toggles } = loadDesktop()
  desktop.shortcutCb('toggleMute')
  desktop.shortcutCb('toggleDeafen')
  desktop.shortcutCb('start')
  desktop.shortcutCb('kotu')
  assert.deepEqual(toggles, ['mute', 'deafen'])
  assert.deepEqual(voice.calls, [])
})

test('basılı tut olayları: start yalnızca ses odasında bas konuş modunda başlatır, end her zaman bırakır', () => {
  const out = loadDesktop()
  out.desktop.holdCb('start')
  out.desktop.holdCb('end')
  out.desktop.holdCb('kotu')
  assert.deepEqual(out.voice.calls, [['down', 'external'], ['up', 'external']])
  const vad = loadDesktop({ voice: { inputMode: 'vad' } })
  vad.desktop.holdCb('start')
  vad.desktop.holdCb('end')
  assert.deepEqual(vad.voice.calls, [['up', 'external']])
  const away = loadDesktop({ voice: { channelId: null } })
  away.desktop.holdCb('start')
  assert.deepEqual(away.voice.calls, [])
  // Basılı tutta ipucu sesi çalmaz
  assert.equal(out.voice.calls.some((c) => c[0] === 'cue'), false)
})

test('ses odası durumu ana sürece yalnızca değişince ve yalnızca true veya false olarak gider', () => {
  const { ui, desktop } = loadDesktop()
  ui.onVoice(null)
  ui.onVoice({ channelId: null, inputMode: 'ptt' })
  ui.onVoice({ channelId: 'ses1', inputMode: 'ptt', peers: { a: 1 } })
  ui.onVoice({ channelId: 'ses1', inputMode: 'ptt' })
  ui.onVoice({ channelId: 'ses1', inputMode: 'vad' })
  ui.onVoice({ channelId: 'ses2', inputMode: 'ptt' })
  ui.onVoice({ channelId: null, inputMode: 'ptt' })
  assert.deepEqual(desktop.voiceSent, [false, true, false, true, false])
  // Eski masaüstü sürümünde (bas konuş API'si yok) çağrı sessizce geçer
  const old = loadDesktop({ noPtt: true })
  old.ui.onVoice({ channelId: 'ses1', inputMode: 'ptt' })
  assert.equal(typeof old.ui.onVoice, 'function')
})

test('ayar bölümü: bas konuş satırı, basılı tut seçeneği, açıklaması ve kip değişikliği', async () => {
  const out = loadDesktop()
  const box = out.sandbox.document.createElement('div')
  out.sandbox.document.body.appendChild(box)
  assert.equal(out.ui.renderShortcutSettings(box), true)
  await tick()
  await tick()
  const text = box.textContent
  assert.ok(box.querySelector('[data-desktop-action="pttToggle"]'), 'bas konuş satırı')
  assert.match(text, /Bas konuş \(bas aç, bas kapat\)/)
  assert.match(text, /Ctrl\+Alt\+V/)
  const toggle = box.querySelector('[data-desktop-ptt="pttMode"]')
  assert.ok(toggle, 'basılı tut seçeneği')
  assert.equal(toggle.checked, false)
  assert.equal(toggle.disabled, false)
  assert.match(text, /Basılı tut \(tuş kancası\)/)
  assert.match(text, /bütün tuş olaylarını görür ama yalnızca seçtiğiniz tuşu işler/)
  assert.match(text, /antivirüs/)
  assert.match(text, /ses odasındayken çalışır/)
  assert.equal(box.querySelector('[data-desktop-assign="pttHold"]'), null, 'kapalıyken tuş satırı yok')
  // Basılı tut açılır: kip kaydedilir, tuş satırı görünür, bas aç, bas kapat kısayolu kullanılmaz notu çıkar
  toggle.checked = true
  toggle.dispatch('change')
  await tick()
  await tick()
  assert.deepEqual(JSON.parse(JSON.stringify(out.desktop.pttCalls)), [{ mode: 'hold', holdKey: null }])
  assert.ok(box.querySelector('[data-desktop-assign="pttHold"]'), 'tuş satırı')
  assert.match(box.textContent, /Basılı tut açıkken bu kısayol kullanılmaz/)
  assert.match(box.textContent, /Bas konuş ayarı kaydedildi/)
  // Kip değişince masaüstü kaynağı bırakılır
  assert.deepEqual(out.voice.calls, [['up', 'external']])
})

test('ayar bölümü: kanca kullanılamıyorsa seçenek devre dışı görünür ve nedeni yazar', async () => {
  const reasons = {
    load_failed: /modülü yüklenemedi/,
    no_display: /X11 ekranı/,
    unsupported: /işletim sisteminde desteklenmiyor/
  }
  for (const reason of Object.keys(reasons)) {
    const out = loadDesktop({ settings: { pttHook: { available: false, reason, running: false, error: null } } })
    const box = out.sandbox.document.createElement('div')
    out.sandbox.document.body.appendChild(box)
    out.ui.renderShortcutSettings(box)
    await tick()
    await tick()
    const toggle = box.querySelector('[data-desktop-ptt="pttMode"]')
    assert.equal(toggle.disabled, true, reason)
    assert.match(box.textContent, reasons[reason])
  }
  // Başlatma hatası: seçenek açık kalır ve kapatılabilir
  const failed = loadDesktop({ settings: { ptt: { mode: 'hold', holdKey: 'V' }, pttHook: { available: true, reason: null, running: false, error: 'start_failed' } } })
  const box = failed.sandbox.document.createElement('div')
  failed.sandbox.document.body.appendChild(box)
  failed.ui.renderShortcutSettings(box)
  await tick()
  await tick()
  assert.equal(box.querySelector('[data-desktop-ptt="pttMode"]').disabled, false)
  assert.match(box.textContent, /Tuş kancası başlatılamadı/)
  assert.match(box.textContent, /Basılı tut tuşu/)
  // Ana süreç kullanılamıyor derse ayar değişmez ve ileti gösterilir
  const refused = loadDesktop({ setPtt: () => ({ ok: false, code: 'unavailable' }) })
  const box2 = refused.sandbox.document.createElement('div')
  refused.sandbox.document.body.appendChild(box2)
  refused.ui.renderShortcutSettings(box2)
  await tick()
  await tick()
  const toggle = box2.querySelector('[data-desktop-ptt="pttMode"]')
  toggle.checked = true
  toggle.dispatch('change')
  await tick()
  await tick()
  assert.match(box2.textContent, /Basılı tut bu bilgisayarda kullanılamıyor/)
  assert.equal(box2.querySelector('[data-desktop-ptt="pttMode"]').checked, false)
})

test('eski masaüstü sürümünde (bas konuş API yok) basılı tut seçeneği çizilmez', async () => {
  const out = loadDesktop({ noPtt: true })
  const box = out.sandbox.document.createElement('div')
  out.sandbox.document.body.appendChild(box)
  out.ui.renderShortcutSettings(box)
  await tick()
  assert.equal(box.querySelector('[data-desktop-ptt="pttMode"]'), null)
  assert.ok(box.querySelector('[data-desktop-action="pttToggle"]'))
})

test('metinler iki dilde var, bas konuş notu yeni davranışı anlatır', () => {
  const sandbox = vm.createContext({ console: { log: noop, warn: noop, error: noop } })
  sandbox.window = sandbox
  vm.runInContext(I18N, sandbox, { filename: 'i18n.js' })
  const t = (lang, key) => {
    sandbox.I18N.setLang(lang)
    return sandbox.I18N.t(key)
  }
  const keys = [
    'desktop.shortcuts.pttToggle', 'desktop.shortcuts.pttNote', 'desktop.ptt.hold', 'desktop.ptt.holdHint', 'desktop.ptt.privacy',
    'desktop.ptt.holdKey', 'desktop.ptt.toggleInactive', 'desktop.ptt.saved', 'desktop.ptt.keyCleared', 'desktop.ptt.invalid',
    'desktop.ptt.unavailableSave', 'desktop.ptt.unavailable.unsupported', 'desktop.ptt.unavailable.no_display',
    'desktop.ptt.unavailable.load_failed', 'desktop.ptt.error.start_failed', 'settings.voice.focusNoteDesktop'
  ]
  for (const lang of ['tr', 'en']) {
    for (const key of keys) assert.notEqual(t(lang, key), key, lang + ' ' + key)
  }
  assert.doesNotMatch(t('tr', 'desktop.shortcuts.pttNote'), /desteklenmez/)
  assert.match(t('tr', 'desktop.shortcuts.pttNote'), /ses odasındayken/)
  assert.match(t('en', 'desktop.shortcuts.pttNote'), /voice room/)
  assert.match(t('en', 'desktop.ptt.privacy'), /antivirus/)
})
