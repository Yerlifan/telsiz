'use strict'

// Ayarlar görünümü (public/js/11-settings.js) testleri. İstemci modülleri tarayıcıdaki gibi ortak bir
// genel ortamda Node vm bağlamında yüklenir. Tarayıcı olmadan çalışabilmek için küçük bir DOM taklidi
// kullanılır (öğe ağacı, öznitelikler, sınıflar, olaylar, odak ve basit seçiciler). Kategori adları,
// cihaz ayarı anahtarları ve varsayılanları, mesaj sesi kuralları, 12 kategorinin çizimi ve yetkiler,
// dar ekran listesi ve Geri, Esc ile kapanma ve odak dönüşü, oturum ve üye satırları, iki dilde metinler,
// CSS kuralları, index.html ile sw.js bağlantıları, ses kancaları (10-voice.js voiceHook) ve önizleme kartının
// kimlik düzeni (ad avatarın yanında, rol ve özel rol rozetleri adın yanında) sınanır. Gerçek
// sunucu ve tarayıcıyla yapılan doğrulama ayrıca yapılır, bu testler CI'da ayarlar görünümünün bozulmasını yakalar.
// Profil sayfasındaki kapak fotoğrafı (istek 8): seçme, önizleme, kaydetme, kaldırma, geri alma, kayıt sürerken hazırlanması
// biten kapak, önceki kaydın kapağı kayda yansımadan yapılan kayıtta bekleyen önizlemenin kalması, kendi profil kaydım geç
// yenilense de sunucuda silinen eski kapağın istenmemesi, kapak inince profil kartında yalnızca bandın, Hesabım'da yalnızca
// önizleme kartının yenilenmesi de sınanır.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const nodeCrypto = require('node:crypto')

const ROOT = path.join(__dirname, '..')
const PUB = path.join(ROOT, 'public')
const FILES = [
  'vendor/nacl-fast.min.js', 'vendor/scrypt.js', 'i18n.js', 'crypto.js',
  'js/01-core.js', 'js/02-state-dom.js', 'js/03-auth.js', 'js/04-meta.js', 'js/05-poll.js',
  'js/06-messages.js', 'js/07-attachments.js', 'js/08-composer.js', 'js/09-emoji.js', 'js/10-voice.js',
  'js/11-settings.js', 'js/13-profile.js', 'js/14-social.js', 'js/15-dm.js', 'js/16-identity.js', 'js/31-sesler.js', 'js/32-arama.js'
]
const SOURCES = FILES.map((file) => ({ file: file, code: fs.readFileSync(path.join(PUB, file), 'utf8') }))
const SETTINGS_SOURCE = fs.readFileSync(path.join(PUB, 'js', '11-settings.js'), 'utf8')

// Tema listesinin tek kaynağı theme-init.js: ön yükleyici küçük bir tarayıcı taklidinde çalıştırılır, ayarlar
// görünümüne verilen TelsizTheme taklidi bu listeyi taşır
function loadThemeInit () {
  const root = { setAttribute () {}, style: { setProperty () {} }, classList: { add () {} } }
  const box = { document: { documentElement: root }, localStorage: { getItem: () => null, setItem () {} } }
  box.window = box
  vm.createContext(box)
  vm.runInContext(fs.readFileSync(path.join(PUB, 'theme-init.js'), 'utf8'), box, { filename: 'theme-init.js' })
  return { skins: Array.from(box.window.TelsizTheme.skins), contrastSkin: box.window.TelsizTheme.contrastSkin }
}
const THEME_INIT = loadThemeInit()
const SKINS = THEME_INIT.skins

// Küçük DOM taklidi

const REFLECTED = { id: 'id', className: 'class', type: 'type', name: 'name', href: 'href', target: 'target', rel: 'rel', title: 'title', htmlFor: 'for' }
const BOOLEAN_REFLECTED = ['hidden', 'disabled']

function parseCompound (text) {
  const out = { tag: null, id: null, classes: [], attrs: [], nots: [] }
  let rest = text
  const notRe = /:not\(([^)]*)\)/g
  rest = rest.replace(notRe, (m, inner) => {
    out.nots.push(parseCompound(inner))
    return ''
  })
  const attrRe = /\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g
  rest = rest.replace(attrRe, (m, name, value) => {
    out.attrs.push({ name: name, value: value === undefined ? null : value })
    return ''
  })
  const parts = rest.match(/[#.]?[a-zA-Z0-9_-]+/g) || []
  parts.forEach((part) => {
    if (part.charAt(0) === '#') out.id = part.slice(1)
    else if (part.charAt(0) === '.') out.classes.push(part.slice(1))
    else out.tag = part.toUpperCase()
  })
  return out
}

function matchesCompound (node, c) {
  if (!node || node.nodeType !== 1) return false
  if (c.tag && node.tagName !== c.tag) return false
  if (c.id && node.getAttribute('id') !== c.id) return false
  for (const cls of c.classes) if (!node.classList.contains(cls)) return false
  for (const a of c.attrs) {
    if (!node.hasAttribute(a.name)) return false
    if (a.value !== null && node.getAttribute(a.name) !== a.value) return false
  }
  for (const n of c.nots) if (matchesCompound(node, n)) return false
  return true
}

function matchesSelector (node, selector) {
  return selector.split(',').some((one) => {
    const steps = one.trim().split(/\s+/).map(parseCompound)
    if (!matchesCompound(node, steps[steps.length - 1])) return false
    let current = node.parentNode
    let i = steps.length - 2
    while (i >= 0) {
      while (current && !matchesCompound(current, steps[i])) current = current.parentNode
      if (!current) return false
      current = current.parentNode
      i -= 1
    }
    return true
  })
}

function nextSiblingOf (node) {
  const parent = node.parentNode
  if (!parent) return null
  return parent.childNodes[parent.childNodes.indexOf(node) + 1] || null
}

class FakeText {
  constructor (text) {
    this.nodeType = 3
    this.data = String(text)
    this.parentNode = null
  }

  get textContent () {
    return this.data
  }

  get nextSibling () {
    return nextSiblingOf(this)
  }
}

class FakeElement {
  constructor (doc, tag) {
    this.ownerDocument = doc
    this.nodeType = 1
    this.tagName = String(tag).toUpperCase()
    this.childNodes = []
    this.parentNode = null
    this.attributes = new Map()
    this.listeners = new Map()
    this.style = {}
    this.scrollTop = 0
    this.value = ''
    this.checked = false
    this.files = null
    const self = this
    this.classList = {
      contains: (c) => self.className.split(/\s+/).indexOf(c) !== -1,
      add: (c) => {
        if (!self.classList.contains(c)) self.className = (self.className + ' ' + c).trim()
      },
      remove: (c) => {
        self.className = self.className.split(/\s+/).filter((x) => x && x !== c).join(' ')
      },
      toggle: (c, force) => {
        const on = force === undefined ? !self.classList.contains(c) : Boolean(force)
        if (on) self.classList.add(c)
        else self.classList.remove(c)
        return on
      }
    }
  }

  get firstChild () {
    return this.childNodes[0] || null
  }

  get nextSibling () {
    return nextSiblingOf(this)
  }

  get lastChild () {
    return this.childNodes[this.childNodes.length - 1] || null
  }

  get children () {
    return this.childNodes.filter((n) => n.nodeType === 1)
  }

  get isConnected () {
    let n = this
    while (n.parentNode) n = n.parentNode
    return n === this.ownerDocument.documentElement
  }

  get textContent () {
    return this.childNodes.map((n) => n.textContent).join('')
  }

  set textContent (value) {
    this.childNodes.forEach((n) => {
      n.parentNode = null
    })
    this.childNodes = []
    if (value !== '' && value !== null && value !== undefined) this.appendChild(new FakeText(value))
  }

  get offsetWidth () {
    return this.closest('[hidden]') ? 0 : 10
  }

  get offsetHeight () {
    return this.offsetWidth
  }

  get tabIndex () {
    return this.hasAttribute('tabindex') ? Number(this.getAttribute('tabindex')) : 0
  }

  set tabIndex (v) {
    this.setAttribute('tabindex', String(v))
  }

  setAttribute (name, value) {
    this.attributes.set(name, String(value))
  }

  getAttribute (name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null
  }

  hasAttribute (name) {
    return this.attributes.has(name)
  }

  removeAttribute (name) {
    this.attributes.delete(name)
  }

  setAttributeNS (ns, name, value) {
    this.setAttribute(name, value)
  }

  appendChild (node) {
    if (node.parentNode) node.parentNode.removeChild(node)
    node.parentNode = this
    this.childNodes.push(node)
    return node
  }

  insertBefore (node, ref) {
    if (!ref) return this.appendChild(node)
    if (node.parentNode) node.parentNode.removeChild(node)
    node.parentNode = this
    this.childNodes.splice(this.childNodes.indexOf(ref), 0, node)
    return node
  }

  removeChild (node) {
    const i = this.childNodes.indexOf(node)
    if (i !== -1) this.childNodes.splice(i, 1)
    node.parentNode = null
    return node
  }

  replaceChild (node, old) {
    this.insertBefore(node, old)
    return this.removeChild(old)
  }

  contains (node) {
    let n = node
    while (n) {
      if (n === this) return true
      n = n.parentNode
    }
    return false
  }

  matches (selector) {
    return matchesSelector(this, selector)
  }

  closest (selector) {
    let n = this
    while (n && n.nodeType === 1) {
      if (matchesSelector(n, selector)) return n
      n = n.parentNode
    }
    return null
  }

  querySelectorAll (selector) {
    const out = []
    const walk = (node) => {
      node.childNodes.forEach((child) => {
        if (child.nodeType !== 1) return
        if (matchesSelector(child, selector)) out.push(child)
        walk(child)
      })
    }
    walk(this)
    return out
  }

  querySelector (selector) {
    return this.querySelectorAll(selector)[0] || null
  }

  addEventListener (type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(fn)
  }

  removeEventListener (type, fn) {
    const list = this.listeners.get(type) || []
    const i = list.indexOf(fn)
    if (i !== -1) list.splice(i, 1)
  }

  dispatchEvent (event) {
    event.target = event.target || this
    let n = this
    while (n && !event.stopped) {
      event.currentTarget = n
      const list = n.listeners.get(event.type) || []
      list.slice().forEach((fn) => fn(event))
      n = n.parentNode
    }
    return !event.defaultPrevented
  }

  click () {
    if (this.disabled) return
    if (this.tagName === 'INPUT' && (this.type === 'checkbox' || this.type === 'radio')) {
      this.checked = this.type === 'radio' ? true : !this.checked
      this.dispatchEvent(fakeEvent('change'))
    }
    this.dispatchEvent(fakeEvent('click'))
    if (this.type === 'submit') {
      const form = this.closest('form')
      if (form) form.dispatchEvent(fakeEvent('submit'))
    }
  }

  focus () {
    this.ownerDocument.activeElement = this
  }

  blur () {}
  select () {}
  setSelectionRange () {}
  getBoundingClientRect () {
    return { top: 0, left: 0, right: 10, bottom: 10, width: 10, height: 10 }
  }
}

Object.keys(REFLECTED).forEach((prop) => {
  Object.defineProperty(FakeElement.prototype, prop, {
    get () {
      return this.getAttribute(REFLECTED[prop]) || ''
    },
    set (v) {
      this.setAttribute(REFLECTED[prop], v)
    }
  })
})
BOOLEAN_REFLECTED.forEach((prop) => {
  Object.defineProperty(FakeElement.prototype, prop, {
    get () {
      return this.hasAttribute(prop)
    },
    set (v) {
      if (v) this.setAttribute(prop, '')
      else this.removeAttribute(prop)
    }
  })
})

function fakeEvent (type, extra) {
  const e = Object.assign({ type: type, defaultPrevented: false, stopped: false, target: null }, extra || {})
  e.preventDefault = () => {
    e.defaultPrevented = true
  }
  e.stopPropagation = () => {
    e.stopped = true
  }
  return e
}

function makeDocument () {
  const doc = { activeElement: null, readyState: 'complete', hidden: false, listeners: [] }
  doc.createElement = (tag) => new FakeElement(doc, tag)
  doc.createElementNS = (ns, tag) => new FakeElement(doc, tag)
  doc.createTextNode = (text) => new FakeText(text)
  doc.documentElement = new FakeElement(doc, 'html')
  doc.documentElement.lang = 'tr'
  doc.body = new FakeElement(doc, 'body')
  doc.documentElement.appendChild(doc.body)
  doc.getElementById = (id) => doc.documentElement.querySelector('#' + id)
  doc.querySelector = (s) => doc.documentElement.querySelector(s)
  doc.querySelectorAll = (s) => doc.documentElement.querySelectorAll(s)
  doc.addEventListener = (type, fn) => {
    doc.listeners.push({ type: type, fn: fn })
  }
  doc.removeEventListener = () => {}
  return doc
}

function makeStorage () {
  const map = new Map()
  return {
    map: map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v))
    },
    removeItem: (k) => {
      map.delete(k)
    }
  }
}

// Sahte WebAudio: çalınan osilatörleri sayar
function makeAudio () {
  const log = { created: 0, started: 0, resumed: 0 }
  function FakeAudioContext () {
    log.created += 1
    this.state = 'running'
    this.currentTime = 0
    this.destination = {}
  }
  FakeAudioContext.prototype.createGain = function () {
    return { gain: { setValueAtTime () {}, exponentialRampToValueAtTime () {} }, connect () {}, disconnect () {} }
  }
  FakeAudioContext.prototype.createOscillator = function () {
    return { type: '', frequency: { setValueAtTime () {} }, connect () {}, disconnect () {}, start () { log.started += 1 }, stop () {} }
  }
  FakeAudioContext.prototype.resume = function () {
    log.resumed += 1
    this.state = 'running'
    return Promise.resolve()
  }
  FakeAudioContext.prototype.suspend = function () {
    this.state = 'suspended'
    return Promise.resolve()
  }
  return { ctor: FakeAudioContext, log: log }
}

// Yeni bir bağlamda istemci modüllerini ve ayarlar kökünü yükler
function load (options) {
  const opts = options || {}
  const doc = makeDocument()
  const root = doc.createElement('div')
  root.id = 'settings-view'
  root.hidden = true
  doc.body.appendChild(root)
  const gear = doc.createElement('button')
  gear.id = 'btn-settings'
  doc.body.appendChild(gear)
  const toastNode = doc.createElement('div')
  toastNode.id = 'toast'
  doc.body.appendChild(toastNode)
  const audio = makeAudio()
  const sandbox = vm.createContext({})
  sandbox.self = sandbox
  sandbox.window = sandbox
  sandbox.setTimeout = (fn) => 0
  sandbox.clearTimeout = () => {}
  sandbox.setInterval = () => 1
  sandbox.clearInterval = () => {}
  // Kareler sırayla biriktirilir, her run çağrısından sonra bir kez çalıştırılır
  const frames = []
  sandbox.requestAnimationFrame = (fn) => {
    frames.push(fn)
    return frames.length
  }
  sandbox.cancelAnimationFrame = () => {}
  sandbox.crypto = nodeCrypto.webcrypto
  sandbox.localStorage = makeStorage()
  sandbox.sessionStorage = makeStorage()
  sandbox.navigator = { languages: ['tr-TR'], language: 'tr-TR', userAgent: 'node' }
  sandbox.document = doc
  sandbox.innerWidth = opts.width || 1280
  sandbox.innerHeight = 800
  sandbox.isSecureContext = true
  sandbox.addEventListener = () => {}
  sandbox.AudioContext = audio.ctor
  sandbox.matchMedia = () => ({ matches: false })
  sandbox.console = { warn () {}, log () {}, error () {} }
  sandbox.TelsizTheme = {
    skins: SKINS.slice(),
    contrastSkin: THEME_INIT.contrastSkin,
    prefs: { skin: 'arcade', scheme: 'system', fontSize: 'auto', compact: false, reduceMotion: 'system' },
    get () {
      return Object.assign({}, this.prefs)
    },
    set (p) {
      Object.assign(this.prefs, p)
      return this.get()
    }
  }
  sandbox.confirm = () => true
  for (const src of SOURCES) vm.runInContext(src.code, sandbox, { filename: src.file })
  const flush = () => {
    const list = frames.splice(0)
    list.forEach((fn) => fn(16))
  }
  const run = (code) => {
    const out = vm.runInContext(code, sandbox)
    flush()
    return out
  }
  run('cacheElements()')
  // Ağ istekleri yerine sahte yanıtlar: oturum listesi ve diğerleri
  sandbox.__requests = []
  run(`api = function (method, path, body) {
    __requests.push({ method: method, path: path, body: body })
    if (path === '/api/me/sessions') return Promise.resolve({ status: 200, data: { sessions: __sessions } })
    return Promise.resolve({ status: 200, data: {} })
  }`)
  sandbox.__sessions = []
  run('closeDrawers = function () {}')
  const role = opts.role || 'owner'
  run('state.inApp = true')
  run('state.info = { version: "2.0.0", limits: {} }')
  run(`state.me = { id: 1, name: 'burak', role: '${role}', status: 'online' }`)
  run(`applyMeta({ serverName: 'Kankalar', activeKid: null, channels: [
    { id: 1, name: 'genel', type: 'text', position: 0 }, { id: 2, name: 'oyun', type: 'text', position: 1 },
    { id: 3, name: 'Ses 1', type: 'voice', position: 0 }],
    users: [{ id: 1, name: 'burak', role: '${role}', online: true, status: 'online', pv: 0 },
      { id: 2, name: 'ece', role: 'admin', online: true, status: 'idle', pv: 0 },
      { id: 3, name: 'mert', role: 'member', online: false, status: 'offline', pv: 0 }],
    voice: {} }, true)`)
  run("socialApplyState({ private: { friends: [], incoming: [], outgoing: [], blocked: [], dms: [], allowMemberDms: true } })")
  return { sandbox: sandbox, run: run, doc: doc, root: root, gear: gear, audio: audio, storage: sandbox.localStorage }
}

function ids (root) {
  return root.querySelectorAll('[id]').map((n) => n.id)
}

test('kategori adları, eski sekme adları ve role göre izinli kategoriler', () => {
  const { run } = load({ role: 'member' })
  assert.strictEqual(run("settingsCatName('crypto')"), 'privacy')
  assert.strictEqual(run("settingsCatName('server')"), 'general')
  assert.strictEqual(run("settingsCatName('theme')"), 'appearance')
  assert.strictEqual(run("settingsCatName('profile')"), 'profile')
  assert.strictEqual(run("settingsCatName('yok')"), null)
  assert.strictEqual(run('settingsCatName(null)'), null)
  assert.deepStrictEqual(Array.from(run('settingsCats()')), ['account', 'profile', 'privacy', 'voice', 'keybinds', 'notifications', 'appearance', 'app'])
  assert.strictEqual(run("allowedSettingsCat('members')"), 'account')
  run("state.me.role = 'admin'")
  assert.strictEqual(run('settingsCats().length'), 12)
  assert.strictEqual(run("allowedSettingsCat('members')"), 'members')
})

test('cihaz ayarı anahtarları ve varsayılanlar (yazıyor, bildirim düzeyi, mesaj sesi)', () => {
  const { run, storage } = load()
  assert.strictEqual(run('SETTINGS_KEYS.typing'), 'telsiz.typing')
  assert.strictEqual(run('SETTINGS_KEYS.notifyLevel'), 'telsiz.notifyLevel')
  assert.strictEqual(run('SETTINGS_KEYS.messageSound'), 'telsiz.messageSound')
  assert.strictEqual(run('typingEnabled()'), true)
  storage.setItem('telsiz.typing', '0')
  assert.strictEqual(run('typingEnabled()'), false)
  storage.setItem('telsiz.typing', '1')
  assert.strictEqual(run('typingEnabled()'), true)
  assert.strictEqual(run('notifyLevel()'), 'mentions')
  storage.setItem('telsiz.notifyLevel', 'all')
  assert.strictEqual(run('notifyLevel()'), 'all')
  storage.setItem('telsiz.notifyLevel', 'none')
  assert.strictEqual(run('notifyLevel()'), 'none')
  storage.setItem('telsiz.notifyLevel', 'bozuk')
  assert.strictEqual(run('notifyLevel()'), 'mentions')
  assert.strictEqual(run('messageSoundEnabled()'), true)
  storage.setItem('telsiz.messageSound', '0')
  assert.strictEqual(run('messageSoundEnabled()'), false)
})

test('mesaj sesi: ayar kapalıyken ve Rahatsız etmeyin durumunda çalmaz, deneme her zaman çalar', () => {
  const { run, storage, audio } = load()
  assert.strictEqual(run('playMessageSound()'), true)
  assert.strictEqual(audio.log.started, 1)
  storage.setItem('telsiz.messageSound', '0')
  assert.strictEqual(run('playMessageSound()'), false)
  assert.strictEqual(audio.log.started, 1)
  assert.strictEqual(run('playMessageSound({ test: true })'), true)
  assert.strictEqual(audio.log.started, 2)
  storage.setItem('telsiz.messageSound', '1')
  run("state.me.status = 'dnd'")
  assert.strictEqual(run('playMessageSound()'), false)
  assert.strictEqual(audio.log.created, 1, 'tek ses bağlamı kullanılır')
})

test('yardımcılar: atama karşılaştırma, seviye yüzdesi, kaydırıcı sınırları, taslak değişikliği', () => {
  const { run } = load()
  assert.strictEqual(run("sameBinding({ type: 'key', code: 'KeyV' }, { type: 'key', code: 'KeyV' })"), true)
  assert.strictEqual(run("sameBinding({ type: 'key', code: 'KeyV' }, { type: 'key', code: 'KeyB' })"), false)
  assert.strictEqual(run("sameBinding({ type: 'mouse', button: 3 }, { type: 'mouse', button: 3 })"), true)
  assert.strictEqual(run("sameBinding({ type: 'mouse', button: 3 }, { type: 'gamepad', button: 3 })"), false)
  assert.strictEqual(run('sameBinding(null, null)'), false)
  assert.strictEqual(run('dbPercent(-100)'), 0)
  assert.strictEqual(run('dbPercent(-40)'), 60)
  assert.strictEqual(run('dbPercent(5)'), 100)
  assert.strictEqual(run('dbPercent(null)'), 0)
  assert.strictEqual(run("sliderValue({ value: '-140' }, -100, 0)"), -100)
  assert.strictEqual(run("sliderValue({ value: '12.6' }, 0, 1000)"), 13)
  assert.strictEqual(run("sliderValue({ value: 'x' }, 0, 1000)"), 0)
  const base = "{ base: { displayName: 'a', statusText: '', bio: '', color: 2 }, displayName: 'a', statusText: '', bio: '', color: 2, avatarMode: 'server', coverMode: 'server' }"
  assert.strictEqual(run('draftDirty(' + base + ')'), false)
  assert.strictEqual(run('draftDirty(Object.assign(' + base + ", { color: 3 }))"), true)
  assert.strictEqual(run('draftDirty(Object.assign(' + base + ", { avatarMode: 'removed' }))"), true)
  assert.strictEqual(run('draftDirty(Object.assign(' + base + ", { coverMode: 'new' }))"), true)
  assert.strictEqual(run('draftDirty(Object.assign(' + base + ", { coverMode: 'removed' }))"), true)
})

test('sahip: 13 kategori, her sayfa çizilir ve beklenen denetimler bulunur', () => {
  const { run, root, gear, doc } = load({ role: 'owner' })
  run("openSettings(null, document.getElementById('btn-settings'))")
  assert.strictEqual(root.hidden, false)
  assert.strictEqual(run("isSettingsOpen()"), true)
  assert.strictEqual(root.getAttribute('data-pane'), 'page')
  assert.strictEqual(doc.activeElement.id, 'settings-cat-account', 'geniş ekranda odak seçili kategoride')
  const cats = root.querySelectorAll('.settings-cat').map((b) => b.getAttribute('data-cat'))
  assert.deepStrictEqual(cats, ['account', 'profile', 'privacy', 'voice', 'keybinds', 'notifications', 'appearance', 'app', 'general', 'channels', 'members', 'roles', 'invite'])
  const expected = {
    account: ['set-account-card', 'set-username-change', 'set-username-form', 'set-old-password', 'set-new-password', 'set-new-password2', 'set-password-submit', 'set-logout', 'set-delete-password', 'set-delete-submit', 'set-delete-owner-note'],
    profile: ['set-avatar-pick', 'set-avatar-file', 'set-avatar-remove', 'set-cover-preview', 'set-cover-pick', 'set-cover-file', 'set-cover-remove', 'set-cover-hint', 'set-display-name', 'set-status-text', 'set-bio', 'set-color-0', 'set-color-7', 'set-profile-save', 'set-profile-reset', 'set-profile-card'],
    privacy: ['set-allow-dms', 'set-typing', 'set-blocked-list', 'set-sessions-list', 'set-sessions-others', 'set-fingerprint', 'set-keyring', 'set-key-input', 'set-key-show', 'set-invite-copy', 'set-key-generate', 'set-youtube-state', 'set-youtube-revoke'],
    voice: ['set-mic', 'set-mode-vad', 'set-mode-ptt', 'set-vad-auto', 'set-vad-threshold', 'set-ptt-key', 'set-ptt-change', 'set-ptt-release', 'set-level-bar', 'set-level-threshold', 'set-mic-test', 'set-echo', 'set-noise', 'set-rnnoise', 'set-rnnoise-hint', 'set-agc', 'set-output-volume', 'set-sounds', 'set-screen-hint-motion', 'set-screen-hint-detail', 'set-screen-preset-720p15', 'set-screen-preset-720p30', 'set-screen-preset-1080p15', 'set-screen-preset-1080p30'],
    keybinds: ['set-bind-ptt-assign', 'set-bind-toggleMute-assign', 'set-bind-toggleMute-clear', 'set-bind-toggleDeafen-clear', 'set-bind-msg'],
    notifications: ['set-notify', 'set-notify-state', 'set-notify-level-all', 'set-notify-level-mentions', 'set-notify-level-none', 'set-message-sound', 'set-sound-test'],
    appearance: SKINS.map((skin) => 'set-skin-' + skin).concat(['set-scheme-dark', 'set-scheme-light', 'set-scheme-system', 'set-font-auto', 'set-font-tv', 'set-font-custom', 'set-font-px', 'set-compact', 'set-motion-on', 'set-lang']),
    app: ['set-install', 'set-version', 'set-repo-link'],
    general: ['set-server-name', 'set-server-save', 'set-server-summary', 'set-music-enabled', 'set-music-youtube'],
    channels: ['set-channel-name', 'set-channel-type', 'set-channel-create', 'set-text-channels', 'set-voice-channels'],
    members: ['set-members-filter', 'set-members-list', 'set-temp-wrap', 'set-banned-list'],
    roles: ['set-role-name', 'set-role-color', 'set-role-create', 'set-roles-list', 'set-roles-msg'],
    invite: ['set-invite-code', 'set-invite-show', 'set-invite-rotate', 'set-invite-link-copy']
  }
  for (const cat of Object.keys(expected)) {
    run(`showSettingsCat('${cat}', null)`)
    assert.strictEqual(root.querySelector('#settings-page').getAttribute('data-cat'), cat)
    assert.strictEqual(run(`isSettingsTab('${cat}')`), true)
    assert.strictEqual(root.querySelector('#settings-page-title').textContent, run(`t('settings.cat.${cat}')`))
    const present = ids(root)
    for (const id of expected[cat]) assert.ok(present.indexOf(id) !== -1, cat + ': ' + id)
    assert.strictEqual(root.querySelector('#settings-cat-' + cat).getAttribute('aria-current'), 'page')
  }
  // Sahip hesabını silemez: düğme kapalı ve açıklama görünür
  run("showSettingsCat('account', null)")
  assert.strictEqual(root.querySelector('#set-delete-submit').disabled, true)
  assert.strictEqual(root.querySelector('#set-delete-owner-note').hidden, false)
  // Depo bağlantısı yalnızca sabit adres
  run("showSettingsCat('app', null)")
  const link = root.querySelector('#set-repo-link')
  assert.strictEqual(link.getAttribute('href'), 'https://github.com/Yerlifan/telsiz')
  assert.strictEqual(link.getAttribute('rel'), 'noopener noreferrer')
  assert.strictEqual(root.querySelector('#set-version').textContent, 'Telsiz 2.0.0')
  assert.ok(gear)
})

test('üye: sunucu kategorileri yok, hesap silme açık, yönetim düğmeleri yok', () => {
  const { run, root } = load({ role: 'member' })
  run("openSettings('members', null)")
  assert.strictEqual(root.querySelector('#settings-page').getAttribute('data-cat'), 'account')
  assert.strictEqual(root.querySelectorAll('.settings-group-title').length, 1)
  assert.strictEqual(root.querySelector('#settings-cat-general'), null)
  assert.strictEqual(root.querySelector('#set-delete-submit').disabled, false)
  assert.strictEqual(root.querySelector('#set-delete-owner-note').hidden, true)
  run("showSettingsCat('privacy', null)")
  assert.strictEqual(root.querySelector('#set-key-admin').hidden, true)
})

test('rol değişince sunucu kategorileri canlı belirir ve kaybolur', () => {
  const { run, root } = load({ role: 'member' })
  run("openSettings('account', null)")
  assert.strictEqual(root.querySelector('#settings-cat-members'), null)
  // 04-meta.js applyMeta rolü state.me'ye yazdıktan sonra refreshSettings çağırır
  run("state.meta.users[0].role = 'admin'")
  run("state.me.role = 'admin'")
  run('refreshSettings()')
  assert.ok(root.querySelector('#settings-cat-members'), 'yönetici olunca belirir')
  run("showSettingsCat('members', null)")
  run("state.meta.users[0].role = 'member'")
  run("state.me.role = 'member'")
  run('refreshSettings()')
  assert.strictEqual(root.querySelector('#settings-cat-members'), null)
  assert.strictEqual(root.querySelector('#settings-page').getAttribute('data-cat'), 'account', 'yetkisi kalmayan sayfa kapanır')
})

test('dar ekran: önce kategori listesi, içerik ve Geri, odak kategoriye döner', () => {
  const { run, root, doc } = load({ width: 390 })
  run("openSettings(null, document.getElementById('btn-settings'))")
  assert.strictEqual(root.getAttribute('data-pane'), 'list')
  assert.ok(root.classList.contains('is-narrow'))
  assert.strictEqual(root.querySelector('#settings-page').childNodes.length, 0, 'listede sayfa çizilmez')
  assert.strictEqual(root.querySelector('#settings-back').hidden, false)
  assert.strictEqual(doc.activeElement.id, 'settings-cat-account')
  root.querySelector('#settings-cat-voice').click()
  assert.strictEqual(root.getAttribute('data-pane'), 'page')
  assert.strictEqual(doc.activeElement.id, 'settings-page-title')
  root.querySelector('#settings-back').click()
  assert.strictEqual(root.getAttribute('data-pane'), 'list')
  assert.strictEqual(doc.activeElement.id, 'settings-cat-voice')
  // Doğrudan kategoriyle açılış içeriği gösterir
  run('closeSettings(false)')
  run("openSettings('profile', null)")
  assert.strictEqual(root.getAttribute('data-pane'), 'page')
  assert.strictEqual(doc.activeElement.id, 'settings-page-title')
})

test('klavye: ok tuşları kategoriler arasında gezer, Esc kapatır ve odak açan düğmeye döner', () => {
  const { run, root, doc, gear } = load()
  run("openSettings(null, document.getElementById('btn-settings'))")
  const nav = root.querySelector('#settings-nav')
  const key = (k) => {
    const e = fakeEvent('keydown', { key: k, target: doc.activeElement })
    doc.activeElement.dispatchEvent(e)
    return e
  }
  key('ArrowDown')
  assert.strictEqual(doc.activeElement.id, 'settings-cat-profile')
  assert.strictEqual(root.querySelector('#settings-page').getAttribute('data-cat'), 'profile')
  key('End')
  assert.strictEqual(doc.activeElement.id, 'settings-cat-invite')
  key('ArrowDown')
  assert.strictEqual(doc.activeElement.id, 'settings-cat-account', 'sondan başa döner')
  key('ArrowUp')
  assert.strictEqual(doc.activeElement.id, 'settings-cat-invite')
  assert.ok(nav)
  run("onLayerKeydown({ key: 'Escape', defaultPrevented: false, preventDefault () {} })")
  assert.strictEqual(root.hidden, true)
  assert.strictEqual(root.childNodes.length, 0, 'kapanınca içerik temizlenir')
  assert.strictEqual(doc.activeElement, gear)
  assert.strictEqual(run('isSettingsOpen()'), false)
})

// 02-state-dom.js watchLayers: Ayarlar açılınca ve kapanınca katman yığınını izleyenler (23-dj.js köşedeki
// oynatıcı) aynı anda haber alır. Kapanışta haber onClose'dan sonra gelir (Ayarlar görünümü artık gizlidir).
test('katman yığınını izleyenler Ayarlar açılınca ve kapanınca haber alır', () => {
  const { run } = load()
  run(`__seen = []
    watchLayers(function () {
      __seen.push(layers.map(function (l) { return l.name }).join(',') + ':' + document.getElementById('settings-view').hidden)
    })
    watchLayers(function () { throw new Error('izleyen hatası') })`)
  run("openSettings(null, document.getElementById('btn-settings'))")
  run('closeSettings(false)')
  assert.strictEqual(run('__seen.join("|")'), 'settings:false|:true')
})

test('oturum listesi: bu cihaz rozeti, bilinmeyen cihaz etiketi, kapatma yalnızca diğerlerinde', async () => {
  const { run, root, sandbox } = load()
  sandbox.__sessions = [
    { id: 'aaaaaaaaaaaaaaaa', label: 'Chrome, Windows', createdAt: Date.now(), lastUsed: Date.now(), current: true },
    { id: 'bbbbbbbbbbbbbbbb', label: null, createdAt: Date.now() - 86400000, lastUsed: Date.now() - 3600000, current: false }
  ]
  run("openSettings('privacy', null)")
  await new Promise((r) => setImmediate(r))
  const rows = root.querySelectorAll('#set-sessions-list .session-row')
  assert.strictEqual(rows.length, 2)
  assert.ok(rows[0].classList.contains('is-current'))
  assert.ok(rows[0].textContent.indexOf('Bu cihaz') !== -1)
  assert.strictEqual(rows[0].querySelector('.act-revoke'), null)
  assert.ok(rows[1].textContent.indexOf('Bilinmeyen cihaz') !== -1)
  assert.ok(rows[1].querySelector('.act-revoke'))
  assert.strictEqual(root.querySelector('#set-sessions-others').disabled, false)
  rows[1].querySelector('.act-revoke').click()
  await new Promise((r) => setImmediate(r))
  const revoke = sandbox.__requests.filter((r) => r.path === '/api/me/sessions/revoke')
  assert.deepStrictEqual(JSON.parse(JSON.stringify(revoke[0].body)), { id: 'bbbbbbbbbbbbbbbb' })
})

test('üye yönetimi satırları: sahip rol değiştirir, yönetici yalnızca üyeyi engeller ve atar, kendine işlem yok', () => {
  const owner = load({ role: 'owner' })
  owner.run("openSettings('members', null)")
  const row = (ctx, id) => ctx.root.querySelector('#set-members-list .member-row[data-user-id="' + id + '"]')
  assert.strictEqual(row(owner, 1).querySelector('button'), null, 'kendi satırında düğme yok')
  assert.ok(row(owner, 2).querySelector('.act-role'), 'sahip yöneticiyi üye yapabilir')
  assert.ok(row(owner, 2).querySelector('.act-ban'))
  assert.ok(row(owner, 2).querySelector('.act-kick'), 'sahip yöneticiyi atabilir')
  assert.ok(row(owner, 3).querySelector('.act-reset'))
  assert.strictEqual(row(owner, 2).querySelector('.list-sub').textContent, 'Yönetici, boşta')
  assert.strictEqual(row(owner, 3).querySelector('.settings-handle').textContent, '@mert')
  const admin = load({ role: 'admin' })
  admin.run("openSettings('members', null)")
  assert.strictEqual(row(admin, 2).querySelector('.act-ban'), null, 'yönetici başka yöneticiyi engelleyemez')
  assert.strictEqual(row(admin, 2).querySelector('.act-kick'), null, 'yönetici başka yöneticiyi atamaz')
  assert.ok(row(admin, 3).querySelector('.act-ban'), 'yönetici üyeyi engelleyebilir')
  assert.ok(row(admin, 3).querySelector('.act-kick'), 'yönetici üyeyi atabilir')
  assert.strictEqual(row(admin, 3).querySelector('.act-role'), null)
  assert.strictEqual(row(admin, 3).querySelector('.act-reset'), null)
  // Arama süzgeci
  const filter = owner.root.querySelector('#set-members-filter')
  filter.value = 'MER'
  filter.dispatchEvent(fakeEvent('input'))
  assert.strictEqual(owner.root.querySelectorAll('#set-members-list .member-row').length, 1)
})

test('özel rol izinleri: moderatör izinli kategorileri görür, yalnızca alt sıradakileri engeller', () => {
  const { run, root } = load({ role: 'member' })
  run("state.meta.roles = [{ id: 7, name: 'Moderatör', color: 'blue', perms: ['ban', 'channels'] }, { id: 8, name: 'DJ', color: 'purple', perms: ['dj'] }]")
  run('state.meta.users[0].roleId = 7')
  run('state.meta.users[2].roleId = 8')
  assert.strictEqual(run("hasPerm('ban')"), true)
  assert.strictEqual(run("hasPerm('messages')"), false)
  assert.strictEqual(run('outranksUser(2)'), false, 'yönetici üst rütbede')
  assert.strictEqual(run('outranksUser(3)'), true, 'DJ rolü listede aşağıda')
  assert.strictEqual(run('outranksUser(1)'), false, 'kendine işlem yok')
  assert.deepStrictEqual(Array.from(run('settingsCats()')).slice(8), ['channels', 'members'])
  run("openSettings('members', null)")
  assert.strictEqual(root.querySelector('#settings-page').getAttribute('data-cat'), 'members')
  const row = (id) => root.querySelector('#set-members-list .member-row[data-user-id="' + id + '"]')
  assert.strictEqual(row(2).querySelector('.act-ban'), null)
  assert.strictEqual(row(2).querySelector('.act-kick'), null)
  assert.ok(row(3).querySelector('.act-ban'))
  assert.ok(row(3).querySelector('.act-kick'))
  assert.strictEqual(row(3).querySelector('.act-role'), null)
  assert.strictEqual(row(3).querySelector('.act-custom-role'), null)
  assert.strictEqual(row(3).querySelector('.act-reset'), null)
  assert.strictEqual(row(3).querySelector('.list-sub').textContent, 'Üye, DJ, çevrimdışı')
  // DJ rolü üste taşınınca moderatör onu engelleyemez
  run('state.meta.roles.reverse()')
  run('refreshSettings()')
  assert.strictEqual(run('outranksUser(3)'), false)
  assert.strictEqual(row(3).querySelector('.act-ban'), null)
  assert.strictEqual(row(3).querySelector('.act-kick'), null)
  // Rol kalkınca Odalar ve Üyeler kategorileri kaybolur
  run('state.meta.users[0].roleId = null')
  run('refreshSettings()')
  assert.strictEqual(root.querySelector('#settings-cat-members'), null)
  assert.strictEqual(root.querySelector('#settings-page').getAttribute('data-cat'), 'account')
})

test('frekanstan atma: onay istenir, iptalde istek gitmez, onayda istek gider, engellenenlerde düğme yok', async () => {
  const { run, root, sandbox } = load({ role: 'owner' })
  run("state.bannedUsers = [{ id: 9, name: 'eski', role: 'member' }]")
  run("openSettings('members', null)")
  const kickBtn = () => root.querySelector('#set-members-list .member-row[data-user-id="3"] .act-kick')
  const kicks = () => sandbox.__requests.filter((r) => r.path === '/api/users/kick')
  assert.strictEqual(kickBtn().textContent, 'Frekanstan At')
  assert.strictEqual(kickBtn().getAttribute('aria-label'), 'Frekanstan at: mert')
  assert.ok(root.querySelector('#set-banned-list .member-row[data-user-id="9"] .act-ban'), 'engellenende engeli kaldır düğmesi var')
  assert.strictEqual(root.querySelector('#set-banned-list .act-kick'), null)
  const asked = []
  sandbox.confirm = (text) => {
    asked.push(text)
    return false
  }
  kickBtn().click()
  await new Promise((r) => setImmediate(r))
  assert.strictEqual(kicks().length, 0, 'onay verilmezse istek gitmez')
  assert.ok(asked[0].indexOf('mert frekanstan atılsın mı?') === 0)
  sandbox.confirm = () => true
  kickBtn().click()
  await new Promise((r) => setImmediate(r))
  assert.deepStrictEqual(JSON.parse(JSON.stringify(kicks()[0].body)), { userId: 3 })
  assert.strictEqual(root.querySelector('#set-members-msg').textContent, 'mert frekanstan atıldı.')
})

test('roller sayfası (sahip): oluşturma, izin anahtarları, sıralama, silme ve üyeye rol verme', () => {
  const owner = load({ role: 'owner' })
  const { run, root, sandbox } = owner
  run("state.meta.roles = [{ id: 7, name: 'Moderatör', color: 'blue', perms: ['ban'] }, { id: 8, name: 'DJ', color: 'purple', perms: ['dj'] }]")
  run('state.meta.users[2].roleId = 7')
  run("openSettings('roles', null)")
  const rows = root.querySelectorAll('#set-roles-list .role-admin-row')
  assert.strictEqual(rows.length, 2)
  assert.strictEqual(rows[0].querySelector('.list-sub').textContent, '1 üye')
  assert.strictEqual(root.querySelector('#set-role-7-ban').checked, true)
  assert.strictEqual(root.querySelector('#set-role-7-voice').checked, false)
  const sent = (path) => sandbox.__requests.filter((r) => r.path === path).map((r) => JSON.parse(JSON.stringify(r.body)))
  root.querySelector('#set-role-7-voice').click()
  assert.deepStrictEqual(sent('/api/roles/update').pop(), { id: 7, perms: ['ban', 'voice'] })
  root.querySelector('#set-role-name').value = '  Yardımcı '
  root.querySelector('#set-role-create').click()
  const created = sent('/api/roles/create').pop()
  assert.strictEqual(created.name, 'Yardımcı')
  assert.deepStrictEqual(created.perms, [])
  assert.ok(run('ROLE_COLORS').indexOf(created.color) !== -1)
  const down = rows[0].querySelectorAll('.icon-button')[1]
  down.click()
  assert.deepStrictEqual(sent('/api/roles/update').pop(), { id: 7, position: 1 })
  run('confirm = function () { return true }')
  root.querySelector('#set-roles-list .role-admin-row[data-role-id="8"] .button-danger').click()
  assert.deepStrictEqual(sent('/api/roles/delete').pop(), { id: 8 })
  // Üyeler sayfasında sahip için rol seçimi
  run("showSettingsCat('members', null)")
  const select = root.querySelector('#set-custom-role-3')
  assert.ok(select)
  assert.strictEqual(select.value, '7')
  assert.strictEqual(root.querySelector('#set-custom-role-1'), null, 'sahibe rol verilmez')
  select.value = ''
  select.dispatchEvent(fakeEvent('change'))
  assert.deepStrictEqual(sent('/api/users/custom-role').pop(), { userId: 3, roleId: null })
})

test('ayarlar görünümündeki tüm sabit anahtarlar iki dilde var ve dinamik anahtarlar tam', () => {
  const { run } = load()
  const tr = run('I18N.messages.tr')
  const en = run('I18N.messages.en')
  const has = (dict, key) => Object.prototype.hasOwnProperty.call(dict, key) || Object.prototype.hasOwnProperty.call(dict, key + '_other')
  const keys = new Set()
  const re = /\bt\('([a-zA-Z0-9_.]+)'/g
  let m = re.exec(SETTINGS_SOURCE)
  while (m) {
    if (!m[1].endsWith('.')) keys.add(m[1])
    m = re.exec(SETTINGS_SOURCE)
  }
  const cats = ['account', 'profile', 'privacy', 'voice', 'keybinds', 'notifications', 'appearance', 'app', 'general', 'channels', 'members', 'invite']
  cats.forEach((c) => keys.add('settings.cat.' + c))
  const actions = ['ptt', 'toggleMute', 'toggleDeafen']
  actions.forEach((a) => {
    keys.add('settings.keybinds.' + a)
    keys.add('settings.keybinds.' + a + 'Hint')
  })
  const states = ['unsupported', 'insecure', 'granted', 'denied', 'default']
  states.forEach((st) => keys.add('settings.notify.state.' + st))
  keys.add('settings.app.licenseNacl')
  keys.add('settings.app.licenseScrypt')
  keys.add('settings.app.licenseRnnoise')
  keys.add('settings.app.licenseRnnoiseWasm')
  for (const status of ['on', 'unavailable', 'off', 'idle', 'loading']) keys.add(run('rnnoiseHintKey')(status))
  assert.ok(keys.size > 150)
  for (const key of keys) {
    assert.ok(has(tr, key), 'tr: ' + key)
    assert.ok(has(en, key), 'en: ' + key)
  }
  // Dil adları kendi dillerinde ve iki sözlükte aynı
  assert.strictEqual(tr['settings.appearance.langTr'], 'Türkçe')
  assert.strictEqual(en['settings.appearance.langTr'], 'Türkçe')
  assert.strictEqual(en['settings.appearance.langEn'], 'English')
})

test('dil değişince görünüm yeniden çizilir ve odak aynı öğeye döner', () => {
  const { run, root, doc } = load()
  run("openSettings('appearance', null)")
  root.querySelector('#set-lang').focus()
  run("I18N.setLang('en')")
  run('settingsOnLanguage()')
  assert.strictEqual(root.querySelector('#settings-page-title').textContent, 'Appearance')
  assert.strictEqual(root.querySelector('#settings-cat-account .settings-cat-label').textContent, 'My Account')
  assert.strictEqual(doc.activeElement.id, 'set-lang')
  assert.notStrictEqual(doc.activeElement, null)
  run("I18N.setLang('tr')")
})

test('görünüm sayfası TelsizTheme ile çalışır', () => {
  const { run, root, sandbox } = load()
  run("openSettings('appearance', null)")
  root.querySelector('#set-skin-gece').click()
  assert.strictEqual(sandbox.TelsizTheme.prefs.skin, 'gece')
  root.querySelector('#set-scheme-light').click()
  assert.strictEqual(sandbox.TelsizTheme.prefs.scheme, 'light')
  root.querySelector('#set-font-tv').click()
  assert.strictEqual(sandbox.TelsizTheme.prefs.fontSize, 'tv')
  // Elle ayar: kaydırıcı Özel boyutu seçer ve pikseli yazar (12 ile 28 arası)
  const px = root.querySelector('#set-font-px')
  assert.strictEqual(px.value, '15')
  assert.strictEqual(root.querySelector('#set-font-px-value').textContent, '15 px')
  px.value = '20'
  px.dispatchEvent(fakeEvent('input'))
  assert.strictEqual(sandbox.TelsizTheme.prefs.fontSize, 'custom')
  assert.strictEqual(sandbox.TelsizTheme.prefs.fontPx, 20)
  assert.strictEqual(root.querySelector('#set-font-px-value').textContent, '20 px')
  px.value = '99'
  px.dispatchEvent(fakeEvent('input'))
  assert.strictEqual(sandbox.TelsizTheme.prefs.fontPx, 28)
  root.querySelector('#set-font-tv').click()
  root.querySelector('#set-compact').click()
  assert.strictEqual(sandbox.TelsizTheme.prefs.compact, true)
  root.querySelector('#set-motion-off').click()
  assert.strictEqual(sandbox.TelsizTheme.prefs.reduceMotion, 'off')
  run('refreshThemeSettings()')
  assert.strictEqual(root.querySelector('#set-skin-gece').checked, true)
  assert.ok(root.querySelector('label[data-skin-choice="gece"]').classList.contains('is-selected'))
})

test('zaten işaretli tema kartına tıklamak temayı yeniden seçer (kendiliğinden seçilen Yüksek Kontrast saklanır)', () => {
  const { run, root, sandbox } = load()
  sandbox.TelsizTheme.prefs.skin = THEME_INIT.contrastSkin
  const calls = []
  const set = sandbox.TelsizTheme.set
  sandbox.TelsizTheme.set = function (p) {
    calls.push(p.skin)
    return set.call(this, p)
  }
  run("openSettings('appearance', null)")
  const input = root.querySelector('#set-skin-' + THEME_INIT.contrastSkin)
  assert.strictEqual(input.checked, true, 'kendiliğinden seçilen tema işaretli')
  // Tarayıcıda işaretli radyo düğmesine tıklamak change üretmez, yalnızca click gelir
  input.dispatchEvent(fakeEvent('click'))
  assert.deepStrictEqual(calls, [THEME_INIT.contrastSkin])
  // İşaretli olmayan kartın click olayı tek başına tema seçmez
  root.querySelector('#set-skin-gece').dispatchEvent(fakeEvent('click'))
  assert.deepStrictEqual(calls, [THEME_INIT.contrastSkin])
})

test('tema kartları theme-init.js listesinden çizilir, ayarlar kendi kopyasını tutmaz', () => {
  // Liste yalnızca theme-init.js içinde: ayarlar modülünde tema kimliklerini sıralayan bir dizi yok
  assert.ok(!/['"]arcade['"]\s*,\s*['"]gece['"]/.test(SETTINGS_SOURCE), '11-settings.js tema listesinin kopyasını tutmamalı')
  assert.ok(SKINS.length >= 3 && SKINS[0] === 'arcade', 'theme-init.js listesi okunur')
  const { run, root, sandbox } = load()
  run("openSettings('appearance', null)")
  const cards = root.querySelectorAll('label[data-skin-choice]').map((n) => n.getAttribute('data-skin-choice'))
  assert.deepStrictEqual(cards, SKINS, 'her tema için bir kart, theme-init.js sırasıyla')
  for (const skin of SKINS) {
    const input = root.querySelector('#set-skin-' + skin)
    assert.ok(input, skin + ' radyo düğmesi')
    assert.strictEqual(input.getAttribute('aria-describedby'), 'set-skin-' + skin + '-hint')
    assert.ok(root.querySelector('#set-skin-' + skin + '-hint').textContent.length > 0, skin + ' açıklaması')
  }
  // Listeye eklenen tema ayarlarda da görünür (ayrı bir kopyayı güncellemek gerekmez)
  sandbox.TelsizTheme.skins = SKINS.concat(['deneme'])
  run("showSettingsCat('account', null)")
  run("showSettingsCat('appearance', null)")
  assert.ok(root.querySelector('#set-skin-deneme'), 'yeni tema kartı')
  // Ön yükleyici yoksa yalnızca varsayılan tema
  sandbox.TelsizTheme.skins = undefined
  assert.deepStrictEqual(Array.from(run('skinChoices()')), ['arcade'])
})

test('tema kartları Telsiz Temaları ve Erişilebilirlik gruplarında, Yüksek Kontrast ayrı grupta', () => {
  assert.strictEqual(THEME_INIT.contrastSkin, 'kontrast')
  assert.ok(SKINS.indexOf('kontrast') !== -1, 'Yüksek Kontrast tema listesinde')
  const { run, root } = load()
  run("openSettings('appearance', null)")
  const radiogroup = root.querySelector('.settings-theme-cards')
  assert.strictEqual(radiogroup.getAttribute('role'), 'radiogroup')
  assert.strictEqual(radiogroup.getAttribute('aria-labelledby'), 'set-skin-section-title')
  const groups = root.querySelectorAll('.settings-theme-group')
  assert.deepStrictEqual(groups.map((g) => g.getAttribute('data-skin-group')), ['radio', 'access'])
  const titles = groups.map((g) => {
    assert.strictEqual(g.getAttribute('role'), 'group')
    const title = root.querySelector('#' + g.getAttribute('aria-labelledby'))
    assert.ok(title, 'grup başlığı')
    return title.textContent
  })
  assert.deepStrictEqual(titles, ['Telsiz Temaları', 'Erişilebilirlik'])
  const inGroup = (id) => groups[id === 'radio' ? 0 : 1].querySelectorAll('label[data-skin-choice]').map((n) => n.getAttribute('data-skin-choice'))
  assert.deepStrictEqual(inGroup('access'), ['kontrast'])
  assert.deepStrictEqual(inGroup('radio'), SKINS.filter((s) => s !== 'kontrast'))
  // Bütün kartlar tek radyo grubudur
  const names = root.querySelectorAll('input[name="set-skin"]').map((n) => n.id)
  assert.strictEqual(names.length, SKINS.length)
  // İngilizce başlıklar
  run("I18N.setLang('en')")
  run('settingsOnLanguage()')
  const en = root.querySelectorAll('.settings-theme-group-title').map((n) => n.textContent)
  assert.deepStrictEqual(en, ['Radio Themes', 'Accessibility'])
  run("I18N.setLang('tr')")
})

test('tema kartları sıkışık: önizleme 2rem, açıklama yalnızca seçili kartta görünür', () => {
  const css = fs.readFileSync(path.join(PUB, 'css', 'settings.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(/\.settings-theme-card \.theme-swatch \{\s*height: 2rem\x3b/.test(css), 'önizleme şeridi 2rem')
  assert.ok(/\.settings-theme-card:not\(\.is-selected\) \.settings-theme-hint \{\s*display: none\x3b/.test(css), 'açıklama seçili olmayan kartta gizli')
  assert.ok(/\.settings-theme-list \{\s*display: flex\x3b\s*flex-wrap: wrap\x3b/.test(css), 'grup içinde satır kırılır')
})

test('gizlilik: yazıyor ve bildirim tercihleri cihazda saklanır', () => {
  const { run, root, storage } = load()
  run("openSettings('privacy', null)")
  assert.strictEqual(root.querySelector('#set-typing').checked, true)
  root.querySelector('#set-typing').click()
  assert.strictEqual(storage.getItem('telsiz.typing'), '0')
  run("showSettingsCat('notifications', null)")
  assert.strictEqual(root.querySelector('#set-notify-level-mentions').checked, true)
  root.querySelector('#set-notify-level-all').click()
  assert.strictEqual(storage.getItem('telsiz.notifyLevel'), 'all')
  root.querySelector('#set-message-sound').click()
  assert.strictEqual(storage.getItem('telsiz.messageSound'), '0')
})

test('settings.css yalnızca belirteçlerle yazılır ve eski WebKit kurallarına uyar', () => {
  const css = fs.readFileSync(path.join(PUB, 'css', 'settings.css'), 'utf8')
  const body = css.replace(/\/\*[\s\S]*?\*\//g, '')
  assert.ok(!/display:\s*grid/.test(body), 'grid yok')
  // Kural başı: satır başı, boşluk, '{' veya noktalı virgül (\x3b, kaynakta noktalı virgül karakteri olmasın)
  assert.ok(!/(^|[\s\x3b{])(row-|column-)?gap\s*:/.test(body), 'flex gap yok')
  assert.ok(!/clamp\(|:is\(|:where\(|aspect-ratio|(^|[\s\x3b{])inset\s*:/.test(body), 'yasak özellik yok')
  const colors = body.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || []
  assert.deepStrictEqual(colors, [], 'renkler yalnızca var(--...) ile')
  // Bileşen sınıfları önekli
  const selectors = body.match(/(^|\})\s*([^{}@]+)\{/g) || []
  assert.ok(selectors.length > 50)
})

test('index.html ve sw.js: yeni stil ve betik etiketleri doğru sırada, eski ayarlar penceresi yok', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
  const pos = (s) => html.indexOf(s)
  assert.ok(pos('href="/css/components.css"') < pos('href="/css/settings.css"'))
  assert.ok(pos('href="/css/settings.css"') < pos('href="/css/chat-plus.css"'))
  assert.ok(pos('href="/css/chat-plus.css"') < pos('href="/css/skins/arcade.css"'))
  const scripts = ['/js/16-identity.js', '/js/17-search.js', '/js/18-mentions.js', '/js/19-typing.js']
  scripts.slice(1).forEach((script, i) => {
    assert.ok(pos('src="' + scripts[i] + '"') < pos('src="' + script + '"'), script)
  })
  assert.ok(/<script src="\/js\/17-search\.js" defer><\/script>/.test(html))
  assert.ok(/<div id="settings-view" class="settings-view" role="dialog" aria-modal="true" aria-labelledby="settings-view-title" hidden><\/div>/.test(html))
  assert.strictEqual(html.indexOf('settings-modal'), -1)
  assert.strictEqual(html.indexOf('settings-tab-'), -1)
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8')
  for (const p of ['/css/settings.css', '/css/chat-plus.css', '/js/17-search.js', '/js/18-mentions.js', '/js/19-typing.js']) {
    assert.ok(sw.indexOf("'" + p + "'") !== -1, 'sw: ' + p)
  }
})

test('ekran paylaşımı kalitesi: varsayılan Net metin ve 720p 15, tercih telsiz.screenQuality olarak saklanır ve ses istemcisine verilir', () => {
  const { run, root, storage, sandbox } = load()
  assert.strictEqual(run('SETTINGS_KEYS.screenQuality'), 'telsiz.screenQuality')
  assert.deepStrictEqual(JSON.parse(JSON.stringify(run('screenQuality()'))), { hint: 'detail', preset: '720p15' })
  // Paylaşım desteklenmeyen cihazda seçimler kapalı ve açıklama görünür
  run("openSettings('voice', null)")
  assert.strictEqual(root.querySelector('#settings-page-title').textContent, 'Ses ve Görüntü')
  assert.strictEqual(root.querySelector('#set-screen-unsupported').hidden, false)
  assert.strictEqual(root.querySelector('#set-screen-preset-720p15').disabled, true)
  assert.strictEqual(root.querySelector('#set-screen-hint-detail').checked, true)
  assert.strictEqual(root.querySelector('#set-screen-preset-720p15').checked, true)
  assert.ok(root.querySelector('label[for="set-screen-preset-1080p30"]').textContent.indexOf('1080p, Saniyede 30 Kare') !== -1)
  assert.ok(root.querySelector('label[for="set-screen-preset-720p15"]').textContent.indexOf('720p, Saniyede 15 Kare (Varsayılan)') !== -1)
  run('closeSettings(false)')
  // Destekleyen cihaz: seçim saklanır, ses istemcisine paylaşım varsayılanı ve sürmekte olan paylaşıma kalite olarak gider
  sandbox.__screen = []
  sandbox.__live = []
  run(`window.VoiceClient = { screenSupport () { return { share: true, watch: true } } }`)
  run("openSettings('voice', null)")
  assert.strictEqual(root.querySelector('#set-screen-unsupported').hidden, true)
  assert.strictEqual(root.querySelector('#set-screen-preset-1080p30').disabled, false)
  root.querySelector('#set-screen-preset-1080p30').click()
  root.querySelector('#set-screen-hint-motion').click()
  assert.deepStrictEqual(JSON.parse(storage.getItem('telsiz.screenQuality')), { hint: 'motion', preset: '1080p30' })
  run('closeSettings(false)')
  run(`voice = { screenSettings () { return { hint: 'detail', preset: '720p30', audio: false } }, setScreenSettings (p) { __screen.push(p) }, setScreenQuality (p) { __live.push(p); return Promise.resolve('no_share') } }`)
  assert.deepStrictEqual(JSON.parse(JSON.stringify(run("saveScreenQuality({ preset: '720p30' })"))), { hint: 'motion', preset: '720p30' })
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.__screen)), [{ hint: 'motion', preset: '720p30' }])
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.__live)), [{ hint: 'motion', preset: '720p30' }])
  // Bozuk kayıt: ses istemcisinin varsayılanı, o da yoksa sabit varsayılan
  storage.setItem('telsiz.screenQuality', '{"hint":"x","preset":"4k60"}')
  assert.deepStrictEqual(JSON.parse(JSON.stringify(run('screenQuality()'))), { hint: 'detail', preset: '720p30' })
  run('voice = null')
  storage.setItem('telsiz.screenQuality', 'bozuk')
  assert.deepStrictEqual(JSON.parse(JSON.stringify(run('screenQuality()'))), { hint: 'detail', preset: '720p15' })
})

test('YouTube oynatıcısı izni: durum, geri alma ve telsiz.djYoutubeConsent', () => {
  const { run, root, storage } = load()
  assert.strictEqual(run('SETTINGS_KEYS.youtubeConsent'), 'telsiz.djYoutubeConsent')
  run("openSettings('privacy', null)")
  assert.strictEqual(root.querySelector('#set-youtube-state').getAttribute('data-state'), 'default')
  assert.ok(root.querySelector('#set-youtube-state').textContent.indexOf('İzin verilmedi') === 0)
  assert.ok(root.querySelector('#set-youtube-revoke').closest('[hidden]'), 'izin yokken geri al gizli')
  storage.setItem('telsiz.djYoutubeConsent', '1')
  run('settingsWatchTick()')
  assert.strictEqual(root.querySelector('#set-youtube-state').getAttribute('data-state'), 'granted')
  assert.strictEqual(root.querySelector('#set-youtube-revoke').closest('[hidden]'), null)
  root.querySelector('#set-youtube-revoke').click()
  assert.strictEqual(storage.getItem('telsiz.djYoutubeConsent'), null)
  assert.strictEqual(root.querySelector('#set-youtube-state').getAttribute('data-state'), 'default')
  assert.strictEqual(root.querySelector('#set-youtube-msg').hidden, false)
  // Reddedilmiş izin ('0', music.js "Şimdi değil"): Yeniden sor düğmesi izni kaldırır, sonraki parçada sorulur
  storage.setItem('telsiz.djYoutubeConsent', '0')
  run('settingsWatchTick()')
  assert.strictEqual(root.querySelector('#set-youtube-state').getAttribute('data-state'), 'denied')
  assert.strictEqual(root.querySelector('#set-youtube-revoke').textContent, 'Yeniden Sor')
  root.querySelector('#set-youtube-revoke').click()
  assert.strictEqual(storage.getItem('telsiz.djYoutubeConsent'), null)
  assert.ok(root.querySelector('#set-youtube-msg').textContent.indexOf('yeniden sorulacak') !== -1)
  storage.setItem('telsiz.djYoutubeConsent', 'evet')
  assert.strictEqual(run('youtubeConsentGranted()'), false, 'yalnızca "1" izin sayılır')
  assert.strictEqual(run('youtubeConsentState()'), 'denied')
})

test('Telsiz DJ sunucu anahtarları: yalnızca sahipte görünür ve sahipte etkin (POST /api/settings { music })', () => {
  const owner = load({ role: 'owner' })
  owner.run("openSettings('general', null)")
  const sec = owner.root.querySelector('#set-music-section')
  assert.strictEqual(sec.hidden, false)
  const on = owner.root.querySelector('#set-music-enabled')
  const yt = owner.root.querySelector('#set-music-youtube')
  assert.strictEqual(on.checked, true, 'varsayılan açık')
  assert.strictEqual(yt.checked, true)
  assert.strictEqual(on.disabled, false)
  assert.strictEqual(yt.disabled, false)
  assert.strictEqual(on.getAttribute('role'), 'switch')
  owner.run('state.meta.music = { enabled: true, youtube: false }')
  owner.run('updateSettingsPage()')
  assert.strictEqual(owner.root.querySelector('#set-music-youtube').checked, false)
  owner.run('state.meta.music = { enabled: false, youtube: true }')
  owner.run('updateSettingsPage()')
  assert.strictEqual(owner.root.querySelector('#set-music-enabled').checked, false)
  assert.strictEqual(owner.root.querySelector('#set-music-youtube').checked, false, 'DJ kapalıyken YouTube da kapalı görünür')
  assert.strictEqual(owner.root.querySelector('#set-music-youtube').disabled, true, 'DJ kapalıyken YouTube anahtarı devre dışı')
  const admin = load({ role: 'admin' })
  admin.run("openSettings('general', null)")
  assert.strictEqual(admin.root.querySelector('#set-music-section').hidden, true, 'yönetici görmez')
})

test('ses ve tuş atamaları sayfası doğrudan kategoriyle açılınca da tam çizilir', () => {
  const { run, root } = load()
  run("openSettings('voice', null)")
  assert.strictEqual(root.querySelector('#set-ptt-wrap').hidden, true, 'ses etkinliği modunda bas konuş bölümü gizli')
  assert.strictEqual(root.querySelector('#set-vad-wrap').hidden, false)
  assert.ok(root.querySelector('#set-level-note').textContent.length > 0, 'seviye notu yazıldı')
  run('closeSettings(false)')
  run("openSettings('keybinds', null)")
  assert.ok(root.querySelector('#set-bind-mode').textContent.length > 0, 'giriş modu satırı yazıldı')
  assert.ok(root.querySelector('#set-bind-ptt-key').textContent.length > 0, 'atama adı yazıldı')
})

test('Gelişmiş gürültü engelleme (RNNoise): tarayıcının gürültü bastırmasının yanında, varsayılan açık, durumla değişen açıklama', () => {
  const { run, root, sandbox } = load()
  sandbox.__voiceCalls = []
  sandbox.__rn = true
  run(`voice = {
    support () { return { ok: true, reason: null } },
    settings () {
      return { inputDeviceId: null, inputMode: 'vad', vadAuto: true, vadThreshold: -50, pttReleaseMs: 200, echoCancellation: true,
        noiseSuppression: true, autoGainControl: true, rnnoise: __rn, outputVolume: 1, sounds: true,
        bindings: { ptt: { type: 'key', code: 'KeyV' }, toggleMute: null, toggleDeafen: null } }
    },
    setSettings (p) {
      __voiceCalls.push(JSON.parse(JSON.stringify(p)))
      if (typeof p.rnnoise === 'boolean') __rn = p.rnnoise
      return Promise.resolve(null)
    },
    bindingLabel () { return 'V' },
    listInputDevices () { return Promise.resolve([]) },
    snapshot () { return null }
  }`)
  run("openSettings('voice', null)")
  const sw = root.querySelector('#set-rnnoise')
  assert.ok(sw, 'anahtar var')
  assert.strictEqual(sw.getAttribute('role'), 'switch')
  assert.strictEqual(sw.checked, true, 'varsayılan açık')
  assert.strictEqual(root.querySelector('label[for="set-rnnoise"] .settings-switch-text').textContent, 'Gelişmiş gürültü engelleme (RNNoise)')
  assert.strictEqual(sw.getAttribute('aria-describedby'), 'set-rnnoise-hint')
  const hint = () => root.querySelector('#set-rnnoise-hint').textContent
  assert.ok(hint().indexOf('Klavye tıkırtısı') === 0, hint())
  // Tarayıcının gürültü bastırması anahtarının hemen ardından gelir
  const noiseRow = root.querySelector('#set-noise').parentNode
  assert.ok(noiseRow.nextSibling && noiseRow.nextSibling.contains(sw), 'set-noise satırının yanında')
  // Açıklama ses hattındaki durumu izler
  run("state.voiceSnap = Object.assign({}, snap(), { rnnoise: 'on' })")
  run('settingsOnVoice()')
  assert.strictEqual(hint(), 'Etkin. Mikrofon sesiniz cihazınızda RNNoise ile temizleniyor.')
  run("state.voiceSnap = Object.assign({}, snap(), { rnnoise: 'unavailable' })")
  run('settingsOnVoice()')
  assert.strictEqual(hint(), 'Bu tarayıcıda kullanılamıyor. Sesiniz tarayıcının kendi ses işlemesiyle gönderiliyor.')
  // Anahtar yalnızca rnnoise ayarını değiştirir
  root.querySelector('#set-rnnoise').click()
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.__voiceCalls)), [{ rnnoise: false }])
  run('settingsOnVoice()')
  assert.strictEqual(root.querySelector('#set-rnnoise').checked, false)
  root.querySelector('#set-noise').click()
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sandbox.__voiceCalls[1])), { noiseSuppression: false })
  // İngilizce
  run("I18N.setLang('en')")
  run('settingsOnLanguage()')
  assert.strictEqual(root.querySelector('label[for="set-rnnoise"] .settings-switch-text').textContent, 'Advanced noise suppression (RNNoise)')
  assert.strictEqual(hint(), 'Not available in this browser. Your audio is sent with the browser\'s own voice processing.')
  run("I18N.setLang('tr')")
  run('voice = null')
  run('state.voiceSnap = null')
})

test('Uygulama sayfası üçüncü taraf lisanslarında RNNoise bağlantıları var', () => {
  const { run, root } = load()
  run("openSettings('app', null)")
  const links = root.querySelectorAll('.settings-links a').map((a) => [a.childNodes[0].textContent, a.getAttribute('href')])
  const rn = links.filter((l) => /rnnoise/i.test(l[1]))
  assert.deepStrictEqual(rn, [
    ['RNNoise, gelişmiş gürültü engelleme (BSD-3-Clause)', '/vendor/rnnoise/RNNOISE-LICENSE.txt'],
    ['@shiguredo/rnnoise-wasm 2022.2.0, RNNoise WebAssembly derlemesi (Apache-2.0)', '/vendor/rnnoise/RNNOISE-WASM-LICENSE.txt']
  ])
})

test('Frekans tanıtımı: sahip yazar ve kaydeder (POST /api/settings { about }), yönetici salt okunur görür', async () => {
  const owner = load({ role: 'owner' })
  owner.run("state.info = { version: '2.0.1', about: 'Eski tanıtım', limits: { aboutMax: 20, aboutMaxLines: 2 } }")
  owner.run("openSettings('general', null)")
  const root = owner.root
  const input = root.querySelector('#set-about')
  assert.ok(input, 'tanıtım alanı var')
  assert.strictEqual(input.tagName, 'TEXTAREA')
  assert.strictEqual(input.value, 'Eski tanıtım')
  assert.strictEqual(root.querySelector('#set-about-section-title').textContent, 'Frekans tanıtımı')
  assert.ok(root.querySelector('#set-about-hint').textContent.indexOf('herkese açıktır') !== -1, 'herkese açık uyarısı')
  assert.strictEqual(root.querySelector('#set-about-owner-only').hidden, true)
  assert.strictEqual(root.querySelector('#set-about-save').closest('.settings-actions').hidden, false)
  assert.strictEqual(root.querySelector('#set-about-counter').textContent, '12 / 20 karakter, en fazla 2 satır')
  // Sınır aşılınca sayaç uyarır, gönderim yapılmaz
  input.value = 'bir\niki\nüç'
  input.dispatchEvent(fakeEvent('input'))
  assert.ok(root.querySelector('#set-about-counter').classList.contains('is-over'))
  root.querySelector('#set-about-save').click()
  assert.strictEqual(owner.sandbox.__requests.filter((r) => r.path === '/api/settings').length, 0)
  assert.strictEqual(root.querySelector('#set-about-msg').textContent, 'Tanıtım en fazla 20 karakter ve 2 satır olabilir.')
  // Geçerli metin kırpılıp kaydedilir
  input.value = '  Yeni  tanıtım \n\n\n'
  input.dispatchEvent(fakeEvent('input'))
  assert.strictEqual(root.querySelector('#set-about-counter').classList.contains('is-over'), false)
  root.querySelector('#set-about-save').click()
  await new Promise((resolve) => setImmediate(resolve))
  const sent = owner.sandbox.__requests.filter((r) => r.path === '/api/settings')
  assert.strictEqual(sent.length, 1)
  assert.deepStrictEqual(JSON.parse(JSON.stringify(sent[0].body)), { about: '  Yeni  tanıtım \n\n\n' })
  assert.strictEqual(owner.run('state.info.about'), 'Yeni tanıtım')
  assert.strictEqual(root.querySelector('#set-about-msg').textContent, 'Frekans tanıtımı kaydedildi.')

  const admin = load({ role: 'admin' })
  admin.run("state.info = { version: '2.0.1', about: 'Sahibin metni', limits: {} }")
  admin.run("openSettings('general', null)")
  const ro = admin.root.querySelector('#set-about')
  assert.strictEqual(ro.value, 'Sahibin metni')
  assert.strictEqual(ro.readOnly, true)
  assert.strictEqual(admin.root.querySelector('#set-about-owner-only').hidden, false)
  assert.strictEqual(admin.root.querySelector('#set-about-save').closest('.settings-actions').hidden, true)
  admin.root.querySelector('#set-about-save').click()
  assert.strictEqual(admin.sandbox.__requests.filter((r) => r.path === '/api/settings').length, 0)
})

test('Frekans fotoğrafı: sahip seçer ve kaldırır (POST /api/server-icon/delete), yönetici yalnızca önizlemeyi görür', async () => {
  const owner = load({ role: 'owner' })
  owner.run("openSettings('general', null)")
  const root = owner.root
  assert.strictEqual(root.querySelector('#set-photo-section-title').textContent, 'Frekans fotoğrafı')
  assert.ok(root.querySelector('#set-photo-hint').textContent.indexOf('herkese açıktır ve şifrelenmez') !== -1)
  assert.strictEqual(root.querySelector('#set-photo-pick').hidden, false)
  assert.strictEqual(root.querySelector('#set-photo-remove').hidden, true, 'fotoğraf yokken kaldır gizli')
  assert.strictEqual(root.querySelector('#set-photo-owner-only').hidden, true)
  // Fotoğraf yokken önizleme frekans adının baş harfidir
  assert.strictEqual(root.querySelector('#set-photo-preview .emblem-letter').textContent, 'K')
  // Meta yeni fotoğraf karması getirir: kaldır düğmesi görünür, kaldırınca istek gider ve durum sıfırlanır
  owner.run("frekansOwnIconUrl = function () { return state.serverIcon ? '/api/server-icon?v=' + state.serverIcon : null }")
  owner.run("state.serverIcon = '" + 'a'.repeat(32) + "'")
  owner.run('updateSettingsPage()')
  assert.strictEqual(root.querySelector('#set-photo-remove').hidden, false)
  root.querySelector('#set-photo-remove').click()
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  const sent = owner.sandbox.__requests.filter((r) => r.path === '/api/server-icon/delete')
  assert.strictEqual(sent.length, 1)
  assert.strictEqual(sent[0].method, 'POST')
  assert.strictEqual(owner.run('state.serverIcon'), null)
  assert.strictEqual(root.querySelector('#set-photo-msg').textContent, 'Frekans fotoğrafı kaldırıldı.')
  assert.strictEqual(root.querySelector('#set-photo-remove').hidden, true)

  const admin = load({ role: 'admin' })
  admin.run("openSettings('general', null)")
  assert.strictEqual(admin.root.querySelector('#set-photo-pick').hidden, true)
  assert.strictEqual(admin.root.querySelector('#set-photo-remove').hidden, true)
  assert.strictEqual(admin.root.querySelector('#set-photo-owner-only').hidden, false)
  admin.root.querySelector('#set-photo-pick').click()
  assert.strictEqual(admin.sandbox.__requests.filter((r) => r.path.indexOf('/api/server-icon') === 0).length, 0)
})

test('ses kancaları: voiceHook değişiklik ve çizim kancalarını kaydeder, hatalı kanca ötekileri durdurmaz', () => {
  const { run, sandbox } = load()
  const errors = []
  sandbox.console = { warn () {}, log () {}, error (err) { errors.push(err && err.message) } }
  assert.strictEqual(run('typeof voiceHook'), 'function')
  assert.strictEqual(run('typeof runVoiceHooks'), 'function')
  // Telsiz kartının ve bandın DOM çizimi taklit ortamda boşa çıkarılır, çağrı sırası ve kancalar değişmez
  run('renderBand = renderVoiceChannels = renderVoicePanel = renderUserPanel = updateVoiceLive = aramaRender = function () {}')
  run(`__hooks = []
    voiceHook('change', function (snap) { __hooks.push('change:' + (snap ? snap.channelId : 'yok')) })
    voiceHook('change', function () { throw new Error('bozuk kanca') })
    voiceHook('change', function () { __hooks.push('change2') })
    voiceHook('render', function (arg) { __hooks.push('render:' + typeof arg) })
    voiceHook('bilinmeyen', function () { __hooks.push('bilinmeyen') })
    voiceHook('change', 'işlev değil')`)
  const hooks = () => JSON.parse(run('JSON.stringify(__hooks)'))
  run('onVoiceChange({ channelId: 3, peers: {} })')
  assert.deepStrictEqual(hooks(), ['change:3', 'change2', 'render:undefined'])
  assert.deepStrictEqual(errors, ['bozuk kanca'])
  // Yapı değişmeyince kart yeniden çizilmez: change kancaları çalışır, render kancası çalışmaz
  run('onVoiceChange({ channelId: 3, peers: {} })')
  assert.deepStrictEqual(hooks().slice(3), ['change:3', 'change2'])
  run('onVoiceChange(null)')
  assert.deepStrictEqual(hooks().slice(5), ['change:yok', 'change2', 'render:undefined'])
})

test('önizleme kartında ad avatarın yanında, rol rozetleri adın yanında: üyede soluk Üye rozeti ve özel rol', () => {
  const badgesOf = (root, id) => root.querySelectorAll('#' + id + ' .profile-identity-line .profile-identity-badges .badge')
    .map((b) => [b.getAttribute('class'), b.textContent])
  let ctx = load({ role: 'member' })
  ctx.run("state.meta.roles = [{ id: 7, name: 'Moderatör', color: 'green', perms: [] }]")
  ctx.run('state.meta.users[0].roleId = 7')
  ctx.run("openSettings('account', null)")
  const head = ctx.root.querySelector('#set-account-preview .profile-card-head')
  assert.ok(head.classList.contains('profile-identity'))
  assert.ok(head.firstChild.classList.contains('profile-card-avatar'), 'avatar solda')
  assert.strictEqual(head.querySelector('.profile-identity-line .profile-card-name').textContent, 'burak')
  assert.strictEqual(head.querySelector('.profile-identity-text .profile-card-handle').textContent, '@burak')
  assert.deepStrictEqual(badgesOf(ctx.root, 'set-account-preview'), [['badge badge-member', 'Üye'], ['badge badge-custom role-color-green', 'Moderatör']])
  // Profil sayfasındaki önizleme de aynı rozetleri gösterir
  ctx.run("showSettingsCat('profile', 'title')")
  assert.deepStrictEqual(badgesOf(ctx.root, 'set-profile-card').map((b) => b[1]), ['Üye', 'Moderatör'])

  ctx = load({ role: 'owner' })
  ctx.run("openSettings('account', null)")
  assert.deepStrictEqual(badgesOf(ctx.root, 'set-account-preview'), [['badge badge-owner', 'Sahip']])
})

test('Profil sayfasında kapak fotoğrafı: seçilen kapak iki önizlemede görünür, kaydedince saveProfile kapağı alır, kaldırma ve geri alma', async () => {
  const { run, root, sandbox } = load({ role: 'member' })
  // Bekleyen söz zincirlerinin ilerlemesi için olay döngüsüne birkaç tur verilir
  const settle = async (rounds = 6) => {
    if (rounds === 0) return
    await new Promise((resolve) => setImmediate(resolve))
    return settle(rounds - 1)
  }
  const band = (id) => root.querySelector('#' + id + ' .profile-card-band')
  const coverImg = (id) => root.querySelector('#' + id + ' .profile-card-band img.profile-card-cover')
  run('hasActiveKey = function () { return true }')
  run("openSettings('profile', null)")
  assert.strictEqual(root.querySelector('#set-cover-title').textContent, 'Kapak fotoğrafı')
  assert.strictEqual(root.querySelector('#set-cover-pick .button-text').textContent, 'Kapak Seç')
  assert.strictEqual(root.querySelector('#set-cover-remove .button-text').textContent, 'Kapağı Kaldır')
  assert.ok(root.querySelector('#set-cover-hint').textContent.indexOf('1200x400') !== -1)
  // Kapak yokken iki önizlemede de yalnızca profil rengi
  for (const id of ['set-cover-preview', 'set-profile-card']) {
    assert.ok(band(id), id + ' bandı')
    assert.strictEqual(band(id).classList.contains('has-cover'), false)
    assert.strictEqual(coverImg(id), null)
  }
  assert.strictEqual(root.querySelector('#set-cover-pick').disabled, false)
  assert.strictEqual(root.querySelector('#set-cover-remove').disabled, true)
  assert.strictEqual(root.querySelector('#set-profile-save').disabled, true)
  const file = root.querySelector('#set-cover-file')
  const choose = async (picked) => {
    file.files = [picked]
    file.dispatchEvent(fakeEvent('change'))
    await settle()
  }
  // Kaynak dosya 20 MB'tan büyükse okunmaz
  await choose({ name: 'buyuk.jpg', size: 21 * 1024 * 1024 })
  assert.match(root.querySelector('#set-cover-msg').textContent, /^Resim en fazla /)
  // Kodlanamayan veya sınıra sığmayan kapak: hata metni, taslak değişmez
  sandbox.__preview = { error: () => 'Kapak 1 MB sınırına sığdırılamadı. Başka bir resim seçin.' }
  run('makeCoverPreview = function () { return Promise.resolve(__preview) }')
  await choose({ name: 'gurultu.png', size: 1000 })
  assert.strictEqual(root.querySelector('#set-cover-msg').textContent, 'Kapak 1 MB sınırına sığdırılamadı. Başka bir resim seçin.')
  assert.strictEqual(root.querySelector('#set-profile-save').disabled, true)
  // Kırpılmış kapak önizlemesi: bant önizlemesinde ve profil kartı önizlemesinde görünür
  sandbox.__preview = { url: 'blob:kapak-onizleme' }
  const chosen = { name: 'kapak.jpg', size: 5000 }
  await choose(chosen)
  assert.strictEqual(root.querySelector('#set-cover-msg').textContent, 'Kapak hazır, kaydedince yüklenir.')
  for (const id of ['set-cover-preview', 'set-profile-card']) {
    assert.strictEqual(band(id).classList.contains('has-cover'), true, id)
    assert.strictEqual(coverImg(id).src, 'blob:kapak-onizleme', id)
    assert.strictEqual(coverImg(id).alt, '')
  }
  assert.strictEqual(root.querySelector('#set-profile-save').disabled, false)
  assert.strictEqual(root.querySelector('#set-cover-remove').disabled, false)
  // Geri al: kapak taslaktan çıkar
  root.querySelector('#set-profile-reset').click()
  assert.strictEqual(coverImg('set-cover-preview'), null)
  assert.strictEqual(root.querySelector('#set-profile-save').disabled, true)
  assert.strictEqual(root.querySelector('#set-cover-msg').textContent, '')
  // Yeniden seçip kaldırınca da kapak düşer, sunucuda kapak olmadığı için taslak temiz kalır
  await choose(chosen)
  root.querySelector('#set-cover-remove').click()
  assert.strictEqual(coverImg('set-profile-card'), null)
  assert.strictEqual(root.querySelector('#set-profile-save').disabled, true)
  // Kaydet: seçilen dosya saveProfile'a coverFile olarak gider, profil resmi alanı gönderilmez
  sandbox.__saved = []
  run('saveProfile = function (input) { __saved.push(input); return Promise.resolve({ ok: true }) }')
  await choose(chosen)
  root.querySelector('#set-profile-save').click()
  await settle()
  assert.strictEqual(sandbox.__saved.length, 1)
  assert.strictEqual(sandbox.__saved[0].coverFile, chosen)
  assert.strictEqual('avatarFile' in sandbox.__saved[0], false)
  assert.strictEqual(root.querySelector('#set-profile-msg').textContent, 'Profil kaydedildi.')
  // Sunucudaki kapak çözülene kadar yerel önizleme kalır, taslak temizdir
  assert.strictEqual(coverImg('set-profile-card').src, 'blob:kapak-onizleme')
  assert.strictEqual(root.querySelector('#set-profile-save').disabled, true)
  assert.strictEqual(root.querySelector('#set-cover-msg').textContent, '')
})

test('Profil sayfası kaldırılan kapağı kayıttan sonra, sunucu kaydı yenilenene kadar yeniden indirmeye kalkmaz', async () => {
  const { run, root, sandbox } = load({ role: 'member' })
  const settle = async (rounds = 6) => {
    if (rounds === 0) return
    await new Promise((resolve) => setImmediate(resolve))
    return settle(rounds - 1)
  }
  const coverImg = (id) => root.querySelector('#' + id + ' .profile-card-band img.profile-card-cover')
  // Sunucudaki kendi kaydımda kapak var. coverUrlOf indirme isteğini (load) kaydeder.
  sandbox.__cover = 'c'.repeat(32)
  sandbox.__loads = []
  run('hasActiveKey = function () { return true }')
  run("profileRecord = function (id) { return sameId(id, state.me.id) && __cover ? { pv: 1, missing: false, profile: { displayName: '', statusText: '', bio: '', color: null, avatar: null, cover: { u: __cover } } } : null }")
  run("coverUrlOf = function (id, load) { __loads.push(Boolean(load)); return __cover ? 'blob:sunucu-kapak' : null }")
  run("openSettings('profile', null)")
  assert.strictEqual(coverImg('set-cover-preview').src, 'blob:sunucu-kapak')
  assert.strictEqual(root.querySelector('#set-cover-remove').disabled, false)
  root.querySelector('#set-cover-remove').click()
  assert.strictEqual(coverImg('set-cover-preview'), null)
  assert.strictEqual(root.querySelector('#set-cover-msg').textContent, 'Kapak kaydedince kaldırılır.')
  assert.strictEqual(root.querySelector('#set-profile-save').disabled, false)
  sandbox.__saved = []
  run('saveProfile = function (input) { __saved.push(input); return Promise.resolve({ ok: true }) }')
  sandbox.__loads.length = 0
  root.querySelector('#set-profile-save').click()
  await settle()
  assert.strictEqual(sandbox.__saved.length, 1)
  assert.strictEqual(sandbox.__saved[0].coverFile, null)
  // Kayıt yenilenene kadar eski kapak (sunucuda silindi) istenmez ve gösterilmez
  run('updateSettingsPage()')
  assert.deepStrictEqual(sandbox.__loads.filter(Boolean), [], 'silinen kapak indirilmez')
  assert.strictEqual(coverImg('set-cover-preview'), null)
  assert.strictEqual(coverImg('set-profile-card'), null)
  // Sunucu kaydı kapaksız gelince bekleme biter
  sandbox.__cover = null
  run('updateSettingsPage()')
  assert.strictEqual(coverImg('set-cover-preview'), null)
  assert.strictEqual(run('settingsUi.draft.coverPending'), null)
  assert.strictEqual(root.querySelector('#set-cover-remove').disabled, true)
})


test('Profil kaydı sürerken hazırlanması biten kapak taslakta kalır, Kaldır düğmeleri kayıt bitene kadar kapalı kalır', async () => {
  const { run, root, sandbox } = load({ role: 'member' })
  const settle = async (rounds = 6) => {
    if (rounds === 0) return
    await new Promise((resolve) => setImmediate(resolve))
    return settle(rounds - 1)
  }
  const coverImg = (id) => root.querySelector('#' + id + ' .profile-card-band img.profile-card-cover')
  const byId = (id) => root.querySelector('#' + id)
  // Kapak hazırlığı ve kayıt, testin bitirdiği sözlerle sürer
  sandbox.__finishPreview = null
  sandbox.__finishSave = null
  sandbox.__saved = []
  run('hasActiveKey = function () { return true }')
  run('makeCoverPreview = function () { return new Promise(function (resolve) { __finishPreview = resolve }) }')
  run('saveProfile = function (input) { __saved.push(input); return new Promise(function (resolve) { __finishSave = resolve }) }')
  run("openSettings('profile', null)")
  // Görünen ad değişir, Kaydet açılır
  const name = byId('set-display-name')
  name.value = 'Burak Yeni'
  name.dispatchEvent(fakeEvent('input'))
  assert.strictEqual(byId('set-profile-save').disabled, false)
  // Büyük bir kapak seçilir, kapak hazırlanırken Kaydet'e basılır: kayıt kapaksız gider
  const chosen = { name: 'buyuk-kapak.jpg', size: 9 * 1024 * 1024 }
  const file = byId('set-cover-file')
  file.files = [chosen]
  file.dispatchEvent(fakeEvent('change'))
  await settle()
  assert.strictEqual(byId('set-cover-msg').textContent, 'Kapak hazırlanıyor...')
  byId('set-profile-save').click()
  await settle()
  assert.strictEqual(sandbox.__saved.length, 1)
  assert.strictEqual('coverFile' in sandbox.__saved[0], false)
  // Kayıt sürerken kapak hazır olur: önizlemede görünür, düğmeler kayıt bitene kadar kapalı kalır
  sandbox.__finishPreview({ url: 'blob:gec-kapak' })
  await settle()
  assert.strictEqual(coverImg('set-cover-preview').src, 'blob:gec-kapak')
  for (const id of ['set-profile-save', 'set-profile-reset', 'set-cover-pick', 'set-cover-remove', 'set-avatar-pick', 'set-avatar-remove']) {
    assert.strictEqual(byId(id).disabled, true, id + ' kayıt sürerken kapalı')
  }
  // Ayar izleyicisinin yenilemesi de Kaldır düğmelerini açmaz, kapalı düğmeye basılsa da taslak değişmez
  run('updateSettingsPage()')
  assert.strictEqual(byId('set-cover-remove').disabled, true)
  assert.strictEqual(byId('set-avatar-remove').disabled, true)
  byId('set-cover-remove').dispatchEvent(fakeEvent('click'))
  assert.strictEqual(run('settingsUi.draft.coverMode'), 'new')
  // Kayıt biter: görünen ad kaydedilir, kayda girmeyen kapak taslakta kalır ve kaydedilmemiş değişiklik olarak görünür
  sandbox.__finishSave({ ok: true })
  await settle()
  assert.strictEqual(byId('set-profile-msg').textContent, 'Profil kaydedildi.')
  assert.strictEqual(run('settingsUi.draft.base.displayName'), 'Burak Yeni')
  assert.strictEqual(run('settingsUi.draft.coverMode'), 'new')
  assert.strictEqual(run('settingsUi.draft.coverFile === __saved[0].coverFile'), false)
  assert.strictEqual(coverImg('set-cover-preview').src, 'blob:gec-kapak')
  assert.strictEqual(coverImg('set-profile-card').src, 'blob:gec-kapak')
  assert.strictEqual(byId('set-cover-msg').textContent, 'Kapak hazır, kaydedince yüklenir.')
  assert.strictEqual(byId('set-profile-dirty').hidden, false)
  assert.strictEqual(byId('set-profile-save').disabled, false)
  assert.strictEqual(byId('set-cover-remove').disabled, false)
  // İkinci kayıt kapağı yükler
  byId('set-profile-save').click()
  await settle()
  assert.strictEqual(sandbox.__saved.length, 2)
  assert.strictEqual(sandbox.__saved[1].coverFile, chosen)
  sandbox.__finishSave({ ok: true })
  await settle()
  assert.strictEqual(run('settingsUi.draft.coverMode'), 'server')
  assert.strictEqual(run('settingsUi.draft.coverPending.url'), 'blob:gec-kapak')
  assert.strictEqual(byId('set-profile-dirty').hidden, true)
})

test('Profil kaydı sürerken yeni kapak seçilirse kayda giren kapağın önizlemesi bırakılmaz, kayıt düşerse bırakılır', async () => {
  const { run, root, sandbox } = load({ role: 'member' })
  const settle = async (rounds = 6) => {
    if (rounds === 0) return
    await new Promise((resolve) => setImmediate(resolve))
    return settle(rounds - 1)
  }
  const byId = (id) => root.querySelector('#' + id)
  sandbox.__previews = []
  sandbox.__finishSave = null
  sandbox.__saved = []
  sandbox.__revoked = []
  run('hasActiveKey = function () { return true }')
  run('revokeBlobLater = function (url) { if (url) __revoked.push(url) }')
  run('makeCoverPreview = function () { return new Promise(function (resolve) { __previews.push(resolve) }) }')
  run('saveProfile = function (input) { __saved.push(input); return new Promise(function (resolve) { __finishSave = resolve }) }')
  run("openSettings('profile', null)")
  const file = byId('set-cover-file')
  const choose = async (picked) => {
    file.files = [picked]
    file.dispatchEvent(fakeEvent('change'))
    await settle()
  }
  // A kapağı hazır, B kapağı hazırlanırken Kaydet: kayda A girer
  const first = { name: 'a.jpg', size: 5000 }
  const second = { name: 'b.jpg', size: 5000 }
  await choose(first)
  sandbox.__previews.shift()({ url: 'blob:a' })
  await settle()
  await choose(second)
  byId('set-profile-save').click()
  await settle()
  assert.strictEqual(sandbox.__saved[0].coverFile, first)
  // B kayıt sürerken hazır olur: taslağa girer, kayda giren A bırakılmaz
  sandbox.__previews.shift()({ url: 'blob:b' })
  await settle()
  assert.strictEqual(run('settingsUi.draft.coverUrl'), 'blob:b')
  assert.deepStrictEqual(sandbox.__revoked, [])
  // Kayıt düşer: A artık taslakta olmadığı için bırakılır, B taslakta kalır
  sandbox.__finishSave({ ok: false, error: () => 'Profil kaydedilemedi.' })
  await settle()
  assert.deepStrictEqual(sandbox.__revoked, ['blob:a'])
  assert.strictEqual(run('settingsUi.draft.coverMode'), 'new')
  assert.strictEqual(run('settingsUi.draft.coverFile.name'), 'b.jpg')
  // C kapağı hazırlanırken yeniden kaydedilir: kayda B girer, kayıt başarılı olunca B bekleyen önizleme olur, kayıt
  // sürerken hazır olan C taslakta kalır
  await choose({ name: 'c.jpg', size: 5000 })
  byId('set-profile-save').click()
  await settle()
  assert.strictEqual(sandbox.__saved[1].coverFile, second)
  sandbox.__previews.shift()({ url: 'blob:c' })
  await settle()
  sandbox.__finishSave({ ok: true })
  await settle()
  assert.deepStrictEqual(sandbox.__revoked, ['blob:a'])
  assert.strictEqual(run('settingsUi.draft.coverPending.url'), 'blob:b')
  assert.strictEqual(run('settingsUi.draft.coverUrl'), 'blob:c')
  assert.strictEqual(run('settingsUi.draft.coverMode'), 'new')
})

test('kendi profil kaydım yenilenmeden yapılan ikinci kayıt kapağa dokunmazsa yeni kapağın önizlemesi kalır, silinen eski kapak istenmez', async () => {
  const { run, root, sandbox } = load({ role: 'member' })
  const settle = async (rounds = 6) => {
    if (rounds === 0) return
    await new Promise((resolve) => setImmediate(resolve))
    return settle(rounds - 1)
  }
  const coverImg = (id) => root.querySelector('#' + id + ' .profile-card-band img.profile-card-cover')
  const byId = (id) => root.querySelector('#' + id)
  // Kendi kaydımda eski kapak X var. Kayıttan sonraki yenileme düşer, kayıt X'i göstermeye devam eder.
  const oldCover = 'c'.repeat(32)
  sandbox.__cover = oldCover
  sandbox.__loads = []
  sandbox.__saved = []
  run('hasActiveKey = function () { return true }')
  run("profileRecord = function (id) { return sameId(id, state.me.id) ? { pv: 1, missing: false, profile: { displayName: '', statusText: '', bio: '', color: null, avatar: null, cover: __cover ? { u: __cover } : null } } : null }")
  run("coverUrlOf = function (id, load) { if (load) __loads.push(__cover); return __cover === 'e'.repeat(32) ? 'blob:sunucu-kapak' : null }")
  // Önceki kaydın yansımasını bekleme süresi hemen dolar
  run('wait = function () { return Promise.resolve() }')
  run('makeCoverPreview = function () { return Promise.resolve({ url: "blob:yeni-kapak" }) }')
  run('saveProfile = function (input) { __saved.push(input); return Promise.resolve({ ok: true }) }')
  run("openSettings('profile', null)")
  const chosen = { name: 'kapak.jpg', size: 5000 }
  const file = byId('set-cover-file')
  file.files = [chosen]
  file.dispatchEvent(fakeEvent('change'))
  await settle()
  byId('set-profile-save').click()
  await settle()
  assert.strictEqual(sandbox.__saved[0].coverFile, chosen)
  assert.strictEqual(run('settingsUi.draft.coverPending.from'), oldCover)
  // Yalnızca hakkımda metni değiştirilip yeniden kaydedilir: kapak kayda girmez (saveProfile son kayıttaki kapağı
  // kullanır), yeni kapağın bekleyen önizlemesi kalır
  const bio = byId('set-bio')
  bio.value = 'Yeni metin'
  bio.dispatchEvent(fakeEvent('input'))
  byId('set-profile-save').click()
  await settle()
  assert.strictEqual(sandbox.__saved.length, 2)
  assert.strictEqual('coverFile' in sandbox.__saved[1], false)
  assert.strictEqual(byId('set-profile-msg').textContent, 'Profil kaydedildi.')
  assert.strictEqual(run('settingsUi.draft.coverPending.url'), 'blob:yeni-kapak')
  sandbox.__loads.length = 0
  run('updateSettingsPage()')
  assert.strictEqual(coverImg('set-cover-preview').src, 'blob:yeni-kapak')
  assert.strictEqual(coverImg('set-profile-card').src, 'blob:yeni-kapak')
  assert.deepStrictEqual(sandbox.__loads, [], 'sunucuda silinen eski kapak indirilmez')
  assert.strictEqual(byId('set-cover-remove').disabled, false)
  // Kayıt yeni kapakla gelince bekleme biter
  sandbox.__cover = 'e'.repeat(32)
  run('updateSettingsPage()')
  assert.strictEqual(coverImg('set-profile-card').src, 'blob:sunucu-kapak')
  assert.strictEqual(run('settingsUi.draft.coverPending'), null)
})

test('kendi profil kaydım kayıttan 20 saniye sonra da yenilenmediyse önizleme yerel kapakta kalır, sunucuda silinen eski kapak istenmez ve gösterilmez', async () => {
  const { run, root, sandbox } = load({ role: 'member' })
  const settle = async (rounds = 6) => {
    if (rounds === 0) return
    await new Promise((resolve) => setImmediate(resolve))
    return settle(rounds - 1)
  }
  const coverImg = (id) => root.querySelector('#' + id + ' .profile-card-band img.profile-card-cover')
  const byId = (id) => root.querySelector('#' + id)
  const previews = () => ['set-cover-preview', 'set-profile-card'].map((id) => (coverImg(id) ? coverImg(id).src : null))
  // Kendi kaydımda eski kapak X var ve önbellekte çözülmüş durumda. coverUrlOf indirme isteğini (load) kaydeder.
  const oldCover = 'c'.repeat(32)
  const newCover = 'e'.repeat(32)
  sandbox.__cover = oldCover
  sandbox.__loads = []
  sandbox.__saved = []
  sandbox.__now = 1000000
  run('Date.now = function () { return __now }')
  run('hasActiveKey = function () { return true }')
  run("profileRecord = function (id) { return sameId(id, state.me.id) ? { pv: 1, missing: false, profile: { displayName: '', statusText: '', bio: '', color: null, avatar: null, cover: __cover ? { u: __cover } : null } } : null }")
  sandbox.__decoded = false
  run("coverUrlOf = function (id, load) { if (load) __loads.push(__cover); if (__cover === 'e'.repeat(32)) return __decoded ? 'blob:sunucu-kapak' : null; return __cover ? 'blob:eski-kapak' : null }")
  run('wait = function () { return Promise.resolve() }')
  run('makeCoverPreview = function () { return Promise.resolve({ url: "blob:yeni-kapak" }) }')
  run('saveProfile = function (input) { __saved.push(input); return Promise.resolve({ ok: true }) }')
  run("openSettings('profile', null)")
  assert.deepStrictEqual(previews(), ['blob:eski-kapak', 'blob:eski-kapak'])
  // Yeni kapak seçilip kaydedilir. Kayıttan sonraki profil yenilemesi düşer, kaydım X'i göstermeye devam eder.
  const chosen = { name: 'kapak.jpg', size: 5000 }
  const file = byId('set-cover-file')
  file.files = [chosen]
  file.dispatchEvent(fakeEvent('change'))
  await settle()
  byId('set-profile-save').click()
  await settle()
  assert.strictEqual(sandbox.__saved[0].coverFile, chosen)
  // Bekleme süresi (AVATAR_PENDING_MS) dolar. İki yenileme: bekleyen önizleme bırakılsaydı ayar izleyicisi imza değiştiği
  // için sayfayı yeniden çizerdi.
  sandbox.__now += run('AVATAR_PENDING_MS') + 1
  sandbox.__loads.length = 0
  run('updateSettingsPage()')
  run('updateSettingsPage()')
  assert.deepStrictEqual(previews(), ['blob:yeni-kapak', 'blob:yeni-kapak'], 'kayıt başarılı, yerel önizleme kalır')
  assert.deepStrictEqual(sandbox.__loads, [], 'sunucuda silinen eski kapak istenmez')
  assert.strictEqual(run('settingsUi.draft.coverPending.url'), 'blob:yeni-kapak')
  // Kayıt yeni kapakla gelir: yeni kapak indirilir, çözülene kadar yerel önizleme kalır (bekleme kaydın yenilendiği
  // andan sayılır), çözülünce sunucudaki kapak gösterilir ve bekleme biter
  sandbox.__cover = newCover
  run('updateSettingsPage()')
  assert.deepStrictEqual(sandbox.__loads, [newCover])
  assert.deepStrictEqual(previews(), ['blob:yeni-kapak', 'blob:yeni-kapak'])
  sandbox.__decoded = true
  run('updateSettingsPage()')
  assert.deepStrictEqual(previews(), ['blob:sunucu-kapak', 'blob:sunucu-kapak'])
  assert.strictEqual(run('settingsUi.draft.coverPending'), null)

  // Kapak kaldırılıp kaydedilir, yenileme yine geç kalır: süre dolsa da sunucuda silinen kapak istenmez ve gösterilmez
  byId('set-cover-remove').click()
  byId('set-profile-save').click()
  await settle()
  assert.strictEqual(sandbox.__saved[1].coverFile, null)
  sandbox.__now += run('AVATAR_PENDING_MS') + 1
  sandbox.__loads.length = 0
  run('updateSettingsPage()')
  run('updateSettingsPage()')
  assert.deepStrictEqual(previews(), [null, null])
  assert.deepStrictEqual(sandbox.__loads, [], 'kaldırılan kapak istenmez')
  // Kayıt kapaksız gelince bekleme biter
  sandbox.__cover = null
  run('updateSettingsPage()')
  assert.deepStrictEqual(previews(), [null, null])
  assert.strictEqual(run('settingsUi.draft.coverPending'), null)
  assert.strictEqual(byId('set-cover-remove').disabled, true)
})

test('Hesabım: kapak inince yalnızca önizleme kartı yenilenir, Profili Düzenle düğmesi ve odağı yerinde kalır', () => {
  const { run, root, doc, sandbox } = load({ role: 'member' })
  sandbox.__coverUrl = null
  run("profileRecord = function (id) { return sameId(id, state.me.id) ? { pv: 1, missing: false, profile: { displayName: 'Burak', statusText: '', bio: '', color: null, avatar: null, cover: { u: 'c'.repeat(32) } } } : null }")
  run('coverUrlOf = function () { return __coverUrl }')
  run("openSettings('account', null)")
  const host = root.querySelector('#set-account-card')
  const edit = root.querySelector('#set-account-edit-profile')
  const card = root.querySelector('#set-account-preview')
  // Düğümler karşılaştırılırken assert.ok kullanılır: DOM taklidinin döngülü ağacı hata iletisine dökülmez
  assert.ok(host.childNodes.length === 2 && host.childNodes[0] === card && host.childNodes[1] === edit, 'önce kart, sonra düğme')
  assert.strictEqual(card.querySelector('.profile-card-band').classList.contains('has-cover'), false)
  edit.focus()
  // Kapak iner: ayar izleyicisi imzanın değiştiğini görür ve sayfayı yeniler
  sandbox.__coverUrl = 'blob:kapak'
  run('settingsWatchTick()')
  const fresh = root.querySelector('#set-account-preview')
  assert.ok(fresh !== card, 'kart yenilenir')
  assert.strictEqual(fresh.querySelector('img.profile-card-cover').src, 'blob:kapak')
  assert.ok(root.querySelector('#set-account-edit-profile') === edit, 'düğme yeniden kurulmaz')
  assert.ok(host.childNodes.length === 2 && host.childNodes[0] === fresh && host.childNodes[1] === edit, 'kart düğmenin önünde kalır')
  assert.ok(doc.activeElement === edit, 'odak düğmede kalır')
  assert.strictEqual(root.querySelectorAll('#set-account-preview').length, 1)
  // Düğme çalışmaya devam eder
  edit.click()
  assert.strictEqual(run('settingsUi.cat'), 'profile')
})

test('kapak inince açık profil kartında yalnızca bant değişir, kartın geri kalanı yeniden kurulmaz', () => {
  const { run, doc, sandbox } = load({ role: 'member' })
  const card = doc.createElement('div')
  card.id = 'profile-card'
  card.hidden = true
  doc.body.appendChild(card)
  sandbox.__coverUrl = null
  run('coverUrlOf = function () { return __coverUrl }')
  run('openProfileCard(2, null)')
  assert.strictEqual(card.hidden, false)
  const band = card.querySelector('.profile-card-band')
  assert.strictEqual(band.classList.contains('has-cover'), false)
  const body = card.querySelector('.profile-card-body')
  const head = card.querySelector('.profile-card-head')
  assert.ok(body && head)
  // Başka kişinin kapağı gelince kart değişmez
  sandbox.__coverUrl = 'blob:ece-kapak'
  run('profileCoverReady(3)')
  assert.strictEqual(card.querySelector('.profile-card-band'), band)
  // Kart sahibinin kapağı gelince bant değişir, ad, durum, ses düzeyi ve düğmeler aynı öğeler olarak kalır
  run('profileCoverReady(2)')
  const fresh = card.querySelector('.profile-card-band')
  assert.notStrictEqual(fresh, band)
  assert.strictEqual(card.firstChild, fresh, 'bant kartın başında kalır')
  assert.strictEqual(fresh.classList.contains('has-cover'), true)
  assert.strictEqual(fresh.querySelector('img.profile-card-cover').src, 'blob:ece-kapak')
  assert.strictEqual(card.querySelectorAll('.profile-card-band').length, 1)
  assert.strictEqual(card.querySelector('.profile-card-body'), body)
  assert.strictEqual(card.querySelector('.profile-card-head'), head)
  assert.strictEqual(body.parentNode, card)
})
