'use strict'

// Oyun arayüzü testleri: public/js/36-oyun.js (yapıştırıcı ve genel arayüz), 37-renk.js (Renk masası), 22-cast.js
// game kipi, 28-bildirim.js oyun daveti, oyun.css, renk.css ve tokens.css kart belirteçleri, index.html ve sw.js
// bağlantıları, i18n kapsamı ve marka denetimi. Arayüz mantığı tarayıcıdaki gibi ortak bir genel ortamda Node vm
// bağlamında yüklenir: gerçek i18n.js, 01-core.js, 02-state-dom.js, oyun modülleri (33, 34, 35), 36-oyun.js ve
// 28-bildirim.js ile küçük bir DOM taklidi. Yayın sahnesi (22-cast.js) ve ses motoru taklit edilir, iki "cihaz" sahte
// bir ağla birbirine bağlanır. Genel arayüz testlerinde Renk arayüzünün yerine burada tanımlı küçük bir arayüz
// kaydolur (FAKE_UI), Renk testlerinde gerçek 37-renk.js yüklenir (makePage renk: true).

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..')
const PUB = path.join(ROOT, 'public')
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8')
const HTML = read(PUB, 'index.html')
const SW = read(PUB, 'sw.js')
const I18N_SRC = read(PUB, 'i18n.js')
const CAST_SRC = read(PUB, 'js', '22-cast.js')
const GAME_UI_SRC = read(PUB, 'js', '36-oyun.js')
const SOURCES = ['01-core.js', '02-state-dom.js', '33-oyun-protokol.js', '34-oyun-masa.js', '35-renk-kural.js', '36-oyun.js', '28-bildirim.js']
  .map((name) => ({ name, code: read(PUB, 'js', name) }))

// Oyun modülleri ve stilleri, yükleme sırasıyla
const GAME_SCRIPTS = ['33-oyun-protokol.js', '34-oyun-masa.js', '35-renk-kural.js', '36-oyun.js', '37-renk.js']
const GAME_STYLES = ['oyun.css', 'renk.css']
const RENK_SRC = read(PUB, 'js', '37-renk.js')

// vm bağlamındaki nesnelerin ön örnekleri farklıdır, karşılaştırma JSON kopyasıyla yapılır
function same (actual, expected, message) {
  const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))
  assert.deepEqual(plain(actual), plain(expected), message)
}

function stripComments (css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

// ------------------------------------------------------------------ küçük DOM taklidi

function parseCompound (text) {
  const out = { tag: null, id: null, classes: [], attrs: [], nots: [] }
  let rest = text.replace(/:not\(([^)]*)\)/g, (m, inner) => {
    out.nots.push(parseCompound(inner))
    return ''
  })
  rest = rest.replace(/\[([a-zA-Z0-9_-]+)(?:="([^"]*)")?\]/g, (m, name, value) => {
    out.attrs.push({ name, value: value === undefined ? null : value })
    return ''
  })
  for (const part of rest.match(/[#.]?[a-zA-Z0-9_-]+/g) || []) {
    if (part.charAt(0) === '#') out.id = part.slice(1)
    else if (part.charAt(0) === '.') out.classes.push(part.slice(1))
    else out.tag = part.toUpperCase()
  }
  return out
}

// Boşlukla ayrılmış seçici: son parça öğenin kendisine, öncekiler sırayla atalarına uyar
function matchesComplex (node, text) {
  const parts = text.trim().split(/\s+/).map(parseCompound)
  if (!matchesCompound(node, parts[parts.length - 1])) return false
  let i = parts.length - 2
  let n = node.parentNode
  while (i >= 0 && n) {
    if (matchesCompound(n, parts[i])) i--
    n = n.parentNode
  }
  return i < 0
}

function matchesCompound (node, c) {
  if (!node || node.nodeType !== 1) return false
  if (c.tag && node.tagName !== c.tag) return false
  if (c.id && node.getAttribute('id') !== c.id) return false
  if (c.classes.some((cls) => !node.classList.contains(cls))) return false
  if (c.attrs.some((a) => (a.value === null ? !node.hasAttribute(a.name) : node.getAttribute(a.name) !== a.value))) return false
  return !c.nots.some((n) => matchesCompound(node, n))
}

function makeDocument () {
  const counter = { mutations: 0 }
  const doc = { activeElement: null, readyState: 'complete', counter }

  class TextNode {
    constructor (text) {
      this.nodeType = 3
      this.data = String(text)
      this.parentNode = null
    }

    get textContent () {
      return this.data
    }
  }

  class Element {
    constructor (tag) {
      this.nodeType = 1
      this.tagName = String(tag).toUpperCase()
      this.attrs = {}
      this.childNodes = []
      this.parentNode = null
      this.listeners = {}
      this.style = {}
      const el = this
      this.classList = {
        list: () => (el.attrs.class || '').split(/\s+/).filter(Boolean),
        contains: (name) => el.classList.list().indexOf(name) !== -1,
        add: (...names) => {
          const now = el.classList.list()
          names.forEach((n) => {
            if (now.indexOf(n) === -1) now.push(n)
          })
          el.setAttribute('class', now.join(' '))
        },
        remove: (...names) => {
          el.setAttribute('class', el.classList.list().filter((n) => names.indexOf(n) === -1).join(' '))
        },
        toggle: (name, force) => {
          const on = force === undefined ? !el.classList.contains(name) : Boolean(force)
          if (on && !el.classList.contains(name)) el.classList.add(name)
          if (!on && el.classList.contains(name)) el.classList.remove(name)
          return on
        }
      }
    }

    get className () { return this.attrs.class || '' }
    set className (v) { this.setAttribute('class', v) }
    get id () { return this.attrs.id || '' }
    set id (v) { this.setAttribute('id', v) }
    get type () { return this.attrs.type || '' }
    set type (v) { this.setAttribute('type', v) }
    get title () { return this.attrs.title || '' }
    set title (v) { this.setAttribute('title', v) }
    get hidden () { return this.hasAttribute('hidden') }
    set hidden (v) {
      if (v) this.setAttribute('hidden', '')
      else this.removeAttribute('hidden')
    }

    get disabled () { return this.hasAttribute('disabled') }
    set disabled (v) {
      if (v) this.setAttribute('disabled', '')
      else this.removeAttribute('disabled')
    }

    get children () { return this.childNodes.filter((n) => n.nodeType === 1) }
    get firstChild () { return this.childNodes[0] || null }
    get lastChild () { return this.childNodes[this.childNodes.length - 1] || null }
    get firstElementChild () { return this.children[0] || null }
    get lastElementChild () {
      const c = this.children
      return c[c.length - 1] || null
    }

    get nextElementSibling () {
      if (!this.parentNode) return null
      const c = this.parentNode.children
      return c[c.indexOf(this) + 1] || null
    }

    get textContent () {
      return this.childNodes.map((n) => n.textContent).join('')
    }

    set textContent (v) {
      this.childNodes.forEach((n) => { n.parentNode = null })
      this.childNodes = []
      if (v !== '' && v !== null && v !== undefined) this.appendChild(new TextNode(v))
      counter.mutations++
    }

    get isConnected () {
      let n = this
      while (n.parentNode) n = n.parentNode
      return n === doc.documentElement
    }

    get offsetWidth () { return this.visible() ? 10 : 0 }
    get offsetHeight () { return this.visible() ? 10 : 0 }

    visible () {
      return this.isConnected && !this.closest('[hidden]')
    }

    getClientRects () {
      return this.visible() ? [{}] : []
    }

    setAttribute (name, value) {
      this.attrs[name] = String(value)
      counter.mutations++
    }

    setAttributeNS (ns, name, value) {
      this.setAttribute(name, value)
    }

    getAttribute (name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
    }

    hasAttribute (name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name)
    }

    removeAttribute (name) {
      delete this.attrs[name]
      counter.mutations++
    }

    detach (node) {
      if (node.parentNode) node.parentNode.childNodes.splice(node.parentNode.childNodes.indexOf(node), 1)
      node.parentNode = null
    }

    appendChild (node) {
      this.detach(node)
      node.parentNode = this
      this.childNodes.push(node)
      counter.mutations++
      return node
    }

    insertBefore (node, ref) {
      if (!ref) return this.appendChild(node)
      this.detach(node)
      node.parentNode = this
      this.childNodes.splice(this.childNodes.indexOf(ref), 0, node)
      counter.mutations++
      return node
    }

    removeChild (node) {
      this.detach(node)
      counter.mutations++
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
      return selector.split(',').some((part) => matchesComplex(this, part))
    }

    closest (selector) {
      let n = this
      while (n && n.nodeType === 1) {
        if (n.matches(selector)) return n
        n = n.parentNode
      }
      return null
    }

    querySelectorAll (selector) {
      const out = []
      const walk = (node) => {
        node.children.forEach((c) => {
          if (c.matches(selector)) out.push(c)
          walk(c)
        })
      }
      walk(this)
      return out
    }

    querySelector (selector) {
      return this.querySelectorAll(selector)[0] || null
    }

    addEventListener (type, fn) {
      if (!this.listeners[type]) this.listeners[type] = []
      this.listeners[type].push(fn)
    }

    removeEventListener (type, fn) {
      if (this.listeners[type]) this.listeners[type] = this.listeners[type].filter((f) => f !== fn)
    }

    dispatch (type, extra) {
      const evt = Object.assign({ type, target: this, defaultPrevented: false }, extra || {})
      evt.preventDefault = () => { evt.defaultPrevented = true }
      evt.stopPropagation = () => {}
      let n = this
      while (n) {
        const fns = n.listeners[type] || []
        fns.slice().forEach((fn) => fn(evt))
        n = n.parentNode
      }
      return evt
    }

    click () {
      return this.dispatch('click')
    }

    focus () {
      doc.activeElement = this
    }
  }

  doc.createElement = (tag) => new Element(tag)
  doc.createElementNS = (ns, tag) => new Element(tag)
  doc.createTextNode = (text) => new TextNode(text)
  doc.documentElement = new Element('html')
  doc.body = doc.documentElement.appendChild(new Element('body'))
  doc.activeElement = doc.body
  doc.getElementById = (id) => doc.documentElement.querySelector('#' + id)
  doc.querySelectorAll = (selector) => doc.documentElement.querySelectorAll(selector)
  doc.querySelector = (selector) => doc.documentElement.querySelector(selector)
  doc.addEventListener = () => {}
  return doc
}

// ------------------------------------------------------------------ zaman, ağ ve cihazlar

function makeClock () {
  const clock = { now: 1700000000000, jobs: [], seq: 0 }
  clock.add = (fn, ms, every) => {
    clock.seq++
    clock.jobs.push({ id: clock.seq, fn, due: clock.now + (ms || 0), every: every ? ms : 0 })
    return clock.seq
  }
  clock.clear = (id) => {
    clock.jobs = clock.jobs.filter((j) => j.id !== id)
  }
  clock.advance = (ms) => {
    const end = clock.now + ms
    while (true) {
      const due = clock.jobs.filter((j) => j.due <= end).sort((a, b) => a.due - b.due || a.id - b.id)[0]
      if (!due) break
      clock.now = Math.max(clock.now, due.due)
      if (due.every) due.due += due.every
      else clock.clear(due.id)
      due.fn()
    }
    clock.now = end
  }
  return clock
}

// Sahte iç zarf (test/oyun-masa.test.js kalıbı): gönderenin gizli ve alıcının açık anahtarı iki tarafı belirler
const fakeDm = {
  seal (obj, pk, sk) {
    if (typeof pk !== 'string' || typeof sk !== 'string') throw new Error('anahtar')
    return '2.' + Buffer.from(JSON.stringify({ a: sk.slice(3), b: pk.slice(3), m: obj })).toString('base64')
  },
  open (p, pks, sk) {
    let x = null
    try {
      x = JSON.parse(Buffer.from(p.slice(2), 'base64').toString('utf8'))
    } catch (e) {
      return { ok: false, reason: 'bad' }
    }
    const me = sk.slice(3)
    const other = pks[0].slice(3)
    const pair = (x.a === me && x.b === other) || (x.a === other && x.b === me)
    return pair ? { ok: true, value: x.m, pk: pks[0] } : { ok: false, reason: 'key' }
  }
}

function seeded (seed) {
  let x = (seed * 2654435761) >>> 0 || 1
  return (n) => {
    const out = []
    while (out.length < n) {
      x ^= x << 13
      x >>>= 0
      x ^= x >>> 17
      x ^= x << 5
      x >>>= 0
      out.push(x & 255)
    }
    return out
  }
}

// Yayın sahnesinin (22-cast.js) ve ses arayüzünün (10-voice.js) bu testteki karşılıkları
const STAGE_FAKES = `
const castState = { nodes: null, full: false }
let fakeShare = 'off'
function castSync () {
  const s = snap()
  const want = s.channelId !== null && !s.private && gameStageWanted()
  if (want) {
    el.cast.hidden = false
    el.cast.setAttribute('data-mode', 'game')
    castRenderGame(castState.nodes)
  } else if (!el.cast.hidden) {
    const had = el.cast.contains(document.activeElement)
    el.cast.hidden = true
    el.cast.removeAttribute('data-mode')
    clear(castState.nodes.game)
    gameStageClosed()
    if (had) focusNode(byId('radio-game'))
  }
  gameRenderTool()
}
function castRenderGame (n) {
  setLive(n.title, () => gameStageTitle())
  setLive(n.sub, () => gameStageSub())
  gameRenderStage(n.game)
}
function castOpenGame (moveFocus) {
  castSync()
  if (moveFocus && !el.cast.hidden) focusNode(gameFirstFocus())
}
function castMinimizeGame () {
  gameSetMinimized(true)
  castSync()
  focusNode(byId('radio-game'))
}
function castScreen () {
  return { state: fakeShare }
}
function castChoiceGroup (className, labelledBy, options, current, onPick, itemClass) {
  const group = h('div', className)
  group.setAttribute('role', 'radiogroup')
  group.setAttribute('aria-labelledby', labelledBy)
  options.forEach((opt) => {
    const b = h('button', itemClass)
    b.setAttribute('role', 'radio')
    b.setAttribute('data-value', opt.value)
    b.setAttribute('aria-checked', opt.value === current ? 'true' : 'false')
    b.appendChild(h('b', itemClass + '-label', opt.label))
    b.addEventListener('click', () => onPick(opt.value))
    group.appendChild(b)
  })
  return group
}
function activeFocusKey (container) {
  const active = document.activeElement
  if (!active || !container || !container.contains(active)) return null
  return active.getAttribute('data-focus-key')
}
function restoreFocusKey (container, key) {
  if (!key || !container) return
  const found = Array.from(container.querySelectorAll('[data-focus-key]')).filter((node) => node.getAttribute('data-focus-key') === key)[0]
  if (found) focusNode(found)
}
function isTypingTarget () {
  return false
}
function snap () {
  return fakeVoice.snap
}
function voiceRoster (channelId) {
  return fakeVoice.roster
}
function inCallRoom (s) {
  return Boolean(s && s.private)
}
function dmSendState (uid) {
  const r = fakeVoice.keys[String(uid)]
  return r ? { ok: false, reason: r } : { ok: true, pk: 'pk:' + uid }
}
function myIdentity () {
  return fakeVoice.locked ? null : { secretKey: 'sk:' + state.me.id }
}
function isBlocked (uid) {
  return fakeVoice.blocked.indexOf(String(uid)) !== -1
}
function profilesEnsure () {}
`

const NAMES = { 5: 'Deniz', 12: 'Ece', 7: 'Mert', 30: 'Aylin' }

// Testte tanımlı küçük oyun arayüzü (Renk arayüzü yerine)
const FAKE_UI = `
const fakeUiCalls = []
const fakeUi = {
  name: () => 'Renk',
  tagline: () => 'Kart oyunu',
  rulesLabel: (r) => 'Kural ' + r,
  rulesHint: (r) => 'Ipucu ' + r,
  rulesLine: (r) => 'Satir ' + r,
  render: (box, m) => {
    fakeUiCalls.push(m.stage)
    box.appendChild(h('p', 'fake-table', m.stage))
  },
  turnText: () => 'Sira sende, karti oyna',
  eventText: (ev) => 'olay ' + ev.e
}
`

// Bir cihaz: kendi vm bağlamı, DOM'u, ses motoru taklidi ve oyun modülleri
function makePage (me, net, opts) {
  const o = opts || {}
  const clock = net.clock
  const doc = makeDocument()
  class FakeDate extends Date {
    static now () { return clock.now }
  }
  const store = {}
  const sandbox = {
    console: { log () {}, warn () {}, error: (e) => { net.errors.push(e) } },
    document: doc,
    navigator: { languages: [o.lang || 'tr-TR'], language: o.lang || 'tr-TR', userAgent: '' },
    localStorage: {
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v) },
      removeItem: (k) => { delete store[k] }
    },
    Date: FakeDate,
    setTimeout: (fn, ms) => clock.add(fn, ms),
    clearTimeout: (id) => clock.clear(id),
    setInterval: (fn, ms) => clock.add(fn, ms, true),
    clearInterval: (id) => clock.clear(id),
    innerWidth: 1440,
    E2EE: { dm: fakeDm },
    nacl: { randomBytes: seeded(Number(me) + net.seed) },
    fakeVoice: {
      snap: { channelId: 3, private: false, joining: false, peers: {} },
      roster: [],
      keys: {},
      blocked: [],
      locked: false
    },
    netSend: (peerId, p, done) => net.send(me, peerId, p, done)
  }
  sandbox.window = sandbox
  sandbox.self = sandbox
  vm.createContext(sandbox)
  const run = (code) => vm.runInContext(code, sandbox)
  vm.runInContext(I18N_SRC, sandbox, { filename: 'i18n.js' })
  for (const s of SOURCES) vm.runInContext(s.code, sandbox, { filename: s.name })
  vm.runInContext(STAGE_FAKES, sandbox, { filename: 'sahne-taklidi.js' })
  vm.runInContext(FAKE_UI, sandbox, { filename: 'arayuz-taklidi.js' })
  run(`
    state.me = { id: ${Number(me)} }
    state.inApp = true
    ${Object.keys(NAMES).map((id) => `state.users.set('${id}', { name: '${NAMES[id]}' })`).join('\n')}
    voice = { sendGame: (peerId, p, done) => netSend(peerId, p, done) }
    const tools = h('div', 'radio-tools')
    tools.id = 'radio-tools'
    document.body.appendChild(tools)
    el.radioTools = tools
    const cast = h('section', 'cast')
    cast.id = 'cast'
    cast.hidden = true
    const title = cast.appendChild(h('h2', 'cast-title'))
    title.id = 'cast-title'
    const sub = cast.appendChild(h('p', 'cast-sub'))
    const game = cast.appendChild(h('div', 'cast-game'))
    const gameMin = cast.appendChild(h('button', 'cast-game-min'))
    document.body.appendChild(cast)
    el.cast = cast
    castState.nodes = { title: title, sub: sub, game: game, gameMin: gameMin }
    const activity = h('section', 'activity-card')
    activity.id = 'activity'
    activity.hidden = true
    const list = activity.appendChild(h('ul', 'activity-list'))
    document.body.appendChild(activity)
    el.activity = activity
    el.activityList = list
    const toastNode = h('div', 'toast')
    toastNode.hidden = true
    document.body.appendChild(toastNode)
    el.toast = toastNode
  `)
  if (o.renk) vm.runInContext(RENK_SRC, sandbox, { filename: '37-renk.js' })
  else if (o.ui !== false) run("gameUiRegister('renk', fakeUi)")
  const page = {
    me: String(me),
    peerId: 'p' + me,
    sandbox,
    doc,
    run,
    fake: sandbox.fakeVoice,
    q: (sel) => doc.querySelector(sel),
    qa: (sel) => doc.querySelectorAll(sel),
    click: (sel) => {
      const node = doc.querySelector(sel)
      assert.ok(node, 'öğe yok: ' + sel)
      node.click()
    },
    key: (k) => doc.querySelector('[data-focus-key="' + k + '"]'),
    press: (k) => {
      const node = doc.querySelector('[data-focus-key="' + k + '"]')
      assert.ok(node, 'düğme yok: ' + k)
      node.click()
    },
    model: () => run('gameModel()'),
    tool: () => doc.getElementById('radio-game'),
    stage: () => (doc.getElementById('cast').hidden ? null : doc.getElementById('cast').getAttribute('data-mode')),
    text: (sel) => {
      const node = doc.querySelector(sel)
      return node ? node.textContent : null
    }
  }
  net.pages[page.peerId] = page
  return page
}

// Sahte ağ: voice.sendGame kuyruğa yazar, flush teslim eder (alıcının oyun olayı ve gönderenin done geri çağrısı)
function makeNet (seed) {
  const net = { pages: {}, queue: [], errors: [], clock: makeClock(), seed: seed || 1 }
  net.send = (fromId, peerId, p, done) => {
    if (!net.pages[peerId]) return 'no_peer'
    net.queue.push({ from: 'p' + fromId, fromId: String(fromId), to: peerId, p, done })
    return 'ok'
  }
  net.flush = () => {
    let guard = 0
    while (net.queue.length && guard < 200) {
      guard++
      const m = net.queue.shift()
      const target = net.pages[m.to]
      target.sandbox.gameOnVoiceEvent({ type: 'message', peerId: m.from, userId: m.fromId, p: m.p })
      if (typeof m.done === 'function') m.done(true)
    }
  }
  return net
}

// İki (veya daha çok) kişinin aynı ses odasında olduğu dünya
function makeWorld (ids, opts) {
  const net = makeNet(opts && opts.seed)
  const pages = ids.map((id) => makePage(id, net, opts))
  for (const page of pages) {
    page.fake.roster = ids.map((id) => ({ userId: Number(id) }))
    for (const other of pages) {
      if (other !== page) page.fake.snap.peers[other.me] = { peerId: other.peerId, status: 'connected' }
    }
    page.run('gameRender()')
  }
  return { net, pages }
}

// ------------------------------------------------------------------ bağlantılar ve stiller

describe('bağlantılar ve stiller', () => {
  test('index.html oyun stillerini tanitim.css ile tema dosyaları arasında, betikleri 32-arama.js satırından sonra sırayla bir kez yükler', () => {
    const count = (text, part) => text.split(part).length - 1
    let prev = HTML.indexOf('href="/css/tanitim.css"')
    assert.ok(prev > 0)
    for (const name of GAME_STYLES) {
      const tag = '<link rel="stylesheet" href="/css/' + name + '">'
      assert.equal(count(HTML, tag), 1, name)
      assert.ok(HTML.indexOf(tag) > prev, 'sıra ' + name)
      prev = HTML.indexOf(tag)
    }
    assert.ok(prev < HTML.indexOf('href="/css/skins/arcade.css"'))
    prev = HTML.indexOf('<script src="/js/32-arama.js" defer></script>')
    assert.ok(prev > 0)
    for (const name of GAME_SCRIPTS) {
      const tag = '<script src="/js/' + name + '" defer></script>'
      assert.equal(count(HTML, tag), 1, name)
      assert.ok(HTML.indexOf(tag) > prev, 'sıra ' + name)
      prev = HTML.indexOf(tag)
    }
    assert.ok(prev < HTML.indexOf('</head>'))
  })

  test('sw.js kabuğu oyun stillerini ve betiklerini önbelleğe alır', () => {
    for (const name of GAME_STYLES) assert.ok(SW.indexOf("'/css/" + name + "',") !== -1, name)
    for (const name of GAME_SCRIPTS) assert.ok(SW.indexOf("'/js/" + name + "',") !== -1, name)
  })

  test('oyun.css yalnızca belirteçlerle ve eski WebKit kurallarıyla yazılır', () => {
    for (const name of GAME_STYLES) {
      const css = stripComments(read(PUB, 'css', name))
      assert.ok(!/(^|[\s{;])(row-|column-)?gap\s*:|clamp\(|:is\(|:where\(|aspect-ratio|(^|[\s{;])inset\s*:|display:\s*(inline-)?grid/.test(css), name + ': yasak özellik')
      same(css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) || [], [], name + ': renkler yalnızca var(--...) ile')
      assert.ok(css.indexOf('-webkit-inline-box') === -1, name)
      assert.match(css, /@media \(prefers-reduced-motion: reduce\)/, name)
      for (const m of css.matchAll(/z-index:\s*(\d+)/g)) assert.ok(Number(m[1]) <= 3, name + ': z-index ' + m[1])
      // Ölçüler rem: piksel yalnızca gizleme kalıbında (1px)
      for (const m of css.replace(/@media[^{]*/g, '').matchAll(/(\d*\.?\d+)px/g)) assert.equal(m[1], '1', name + ': ' + m[0])
    }
  })

  test('telefonda oyun sahnesinin yüksekliği cast.css 16:9 kuralını eşit özgüllükle ezer', () => {
    const css = stripComments(read(PUB, 'css', 'oyun.css')).replace(/\r\n/g, '\n')
    const phone = css.slice(css.indexOf('@media (max-width: 759px)'))
    assert.match(phone, /body\[data-cast="live"\]\[data-cast-mode="game"\] \.cast-screen \{\s*height: auto;\s*flex: 1 1 auto;\s*min-height: 20rem;/)
    assert.ok(HTML.indexOf('href="/css/cast.css"') < HTML.indexOf('href="/css/oyun.css"'), 'oyun.css cast.css dosyasından sonra yüklenir')
  })

  test('tokens.css kart belirteçleri iki modda tanımlı, yazı ve yüz kontrastı 4.5:1 üstünde', () => {
    const css = read(PUB, 'css', 'tokens.css').replace(/\r\n/g, '\n')
    const block = (selector) => {
      const i = css.lastIndexOf('\n' + selector + ' {')
      assert.ok(i !== -1, selector)
      const body = css.slice(i, css.indexOf('}', i))
      const out = {}
      for (const m of body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim()
      return out
    }
    const dark = block(':root')
    const light = block(':root[data-scheme="light"]')
    for (const name of ['card-edge', 'card-shadow', 'card-back-a', 'card-back-b', 'card-hatch']) {
      assert.ok(dark[name] && light[name], name)
    }
    for (const name of ['renk-red', 'renk-yellow', 'renk-green', 'renk-blue', 'renk-wild', 'renk-ink', 'renk-ink-yellow']) {
      assert.match(dark[name] || '', /^#[0-9a-f]{6}$/, name)
    }
    const lum = (hex) => {
      const v = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
    }
    const ratio = (a, b) => {
      const x = lum(a)
      const y = lum(b)
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
    }
    const pairs = [['renk-ink', 'renk-red'], ['renk-ink', 'renk-green'], ['renk-ink', 'renk-blue'], ['renk-ink', 'renk-wild'], ['renk-ink-yellow', 'renk-yellow']]
    for (const [ink, face] of pairs) {
      assert.ok(ratio(dark[ink], dark[face]) > 4.5, ink + ' / ' + face + ': ' + ratio(dark[ink], dark[face]).toFixed(2))
    }
  })

  test('22-cast.js: castModeFor önceliği izleme, ızgara, oyun, kendi paylaşımı ve game kipinin bağlantıları', () => {
    const src = CAST_SRC.replace(/\r\n/g, '\n')
    const fn = src.slice(src.indexOf('function castModeFor'), src.indexOf('}', src.indexOf('function castModeFor')))
    const order = ['watch', 'cams', 'game', 'own'].map((m) => fn.indexOf("'" + m + "'"))
    assert.ok(order.every((i) => i > 0), fn)
    same(order.slice().sort((a, b) => a - b), order)
    const sandbox = { window: {} }
    vm.createContext(sandbox)
    vm.runInContext(fn + '}', sandbox)
    const mode = (o) => vm.runInContext('castModeFor(' + JSON.stringify(o) + ')', sandbox)
    assert.equal(mode({ watching: '7', cams: true, game: true, sharing: true }), 'watch')
    assert.equal(mode({ watching: null, cams: true, game: true, sharing: true }), 'cams')
    assert.equal(mode({ watching: null, cams: false, game: true, sharing: true }), 'game')
    assert.equal(mode({ watching: null, cams: false, game: false, sharing: true }), 'own')
    assert.equal(mode({ watching: null, cams: false, game: false, sharing: false }), null)
    assert.match(src, /const game = inVoice && !s\.private && typeof gameStageWanted === 'function' && gameStageWanted\(\)/)
    assert.match(src, /n\.game = h\('div', 'cast-game'\)/)
    assert.match(src, /castHeadButton\('cast-game-min', 'i-close', \(\) => t\('game\.minimize'\)\)/)
    assert.match(src, /if \(mode === 'game'\) return false/, 'oyunda sohbet varsayılan olarak daraltılmış')
    assert.match(src, /clear\(castState\.nodes\.game\)/)
    assert.match(src, /if \(typeof gameStageClosed === 'function'\) gameStageClosed\(\)/)
  })
})

// ------------------------------------------------------------------ i18n ve marka denetimi

function loadI18n () {
  const sandbox = vm.createContext({})
  sandbox.window = sandbox
  sandbox.localStorage = { getItem: () => null, setItem () {}, removeItem () {} }
  sandbox.navigator = { languages: ['tr-TR'], language: 'tr-TR' }
  sandbox.document = { documentElement: { lang: 'tr' }, readyState: 'loading', querySelectorAll: () => [] }
  sandbox.warnings = []
  sandbox.console = { warn: (w) => sandbox.warnings.push(w), log () {}, error () {} }
  vm.runInContext(I18N_SRC, sandbox, { filename: 'i18n.js' })
  return sandbox
}

describe('i18n ve marka adı', () => {
  test('game.* anahtarları iki sözlükte aynı sırada, bütün kod kümeleri iki dilde çevrilir', () => {
    const I = loadI18n().I18N
    const G = makePage('5', makeNet(), { ui: false }).sandbox.TelsizGame
    const order = (lang) => Object.keys(I.messages[lang]).filter((k) => k.indexOf('game.') === 0 && k.indexOf('game.renk.') !== 0)
    same(order('tr'), order('en'))
    assert.ok(order('tr').length >= 100, String(order('tr').length))
    const needed = []
    G.KEY_REASONS.forEach((r) => needed.push('game.reason.' + r))
    G.INVITE_KEYS.forEach((r) => needed.push('game.reason.peer_' + r))
    G.REJECT_WHY.forEach((r) => needed.push('game.reject.' + r))
    G.END_REASONS.concat(['left']).forEach((r) => needed.push('game.ended.' + r))
    G.STATUSES.forEach((r) => needed.push('game.status.' + r))
    for (const lang of ['tr', 'en']) {
      I.setLang(lang)
      for (const key of needed) {
        const text = I.t(key, { name: 'Ece' })
        assert.ok(text && text !== key && text.indexOf('{') === -1, lang + ': ' + key)
      }
      for (const key of ['game.players', 'game.cards', 'game.points']) {
        for (const count of [1, 2]) assert.match(I.t(key, { count }), new RegExp('^' + count + ' [^{]+$'), lang + ': ' + key)
      }
    }
  })

  test('masa yöneticisinin ve masanın hata kodları metne çevrilir', () => {
    const page = makePage('5', makeNet())
    const D = page.sandbox.TelsizGameDesk
    for (const lang of ['tr', 'en']) {
      page.run(`I18N.setLang('${lang}')`)
      for (const code of D.ERRORS) {
        const text = page.run(`gameErrorText('${code}', 'renk')`)
        assert.ok(text && text.indexOf('game.') !== 0, lang + ': ' + code)
      }
    }
  })

  test('marka adı oyun dosyalarında, i18n değerlerinde, testlerde ve belgelerde geçmez', () => {
    const brand = new RegExp('\\b' + String.fromCharCode(117, 110, 111) + '\\b', 'i')
    const files = []
    for (const name of fs.readdirSync(path.join(PUB, 'js'))) {
      if (/^3[3-9]-.*\.js$/.test(name)) files.push(path.join(PUB, 'js', name))
    }
    for (const name of ['oyun.css', 'renk.css', 'tokens.css', 'cast.css']) files.push(path.join(PUB, 'css', name))
    for (const name of ['22-cast.js', '28-bildirim.js', '10-voice.js']) files.push(path.join(PUB, 'js', name))
    for (const dir of ['test', 'e2e']) {
      for (const name of fs.readdirSync(path.join(ROOT, dir))) {
        if (name.endsWith('.js')) files.push(path.join(ROOT, dir, name))
      }
    }
    for (const doc of ['README.md', 'README.en.md', 'CHANGELOG.md', 'CHANGELOG.en.md', 'CONTRIBUTING.md', 'CONTRIBUTING.en.md',
      path.join('docs', 'MIMARI.md'), path.join('docs', 'ARCHITECTURE.md'), path.join('docs', 'TASARIM.md'), path.join('docs', 'DESIGN.md')]) {
      files.push(path.join(ROOT, doc))
    }
    const checked = files.filter((file) => fs.existsSync(file))
    assert.ok(checked.length > 60, String(checked.length))
    for (const file of checked) assert.ok(!brand.test(fs.readFileSync(file, 'utf8')), path.relative(ROOT, file))
    const I = loadI18n().I18N
    for (const lang of ['tr', 'en']) {
      for (const [key, value] of Object.entries(I.messages[lang])) assert.ok(!brand.test(value), lang + ': ' + key)
    }
  })
})

// ------------------------------------------------------------------ arayüz mantığı

describe('Oyun düğmesi', () => {
  test('gameToolState: 6.2 tablosu, özel aramada, bağlanırken ve kayıtlı arayüz yokken gizli', () => {
    const page = makePage('5', makeNet())
    const state = (s, m, visible) => {
      page.sandbox.tS = s
      page.sandbox.tM = Object.assign(page.run('gameEmptyModel()'), { me: '5' }, m)
      return page.run('gameToolState(tS, tM, ' + Boolean(visible) + ')')
    }
    const room = { channelId: 3, private: false, joining: false, peers: {} }
    const pick = (st) => (st ? [st.kind, st.label, st.badge, st.expanded, st.disabled] : null)
    same(pick(state(room, {})), ['tool', 'Oyun', '', false, false])
    assert.equal(state(room, {}).aria, 'Oyun masası kurun')
    assert.equal(state({ channelId: null, peers: {} }, {}), null, 'seste değil')
    assert.equal(state(Object.assign({}, room, { joining: true }), {}), null, 'bağlanıyor')
    assert.equal(state(Object.assign({}, room, { private: true }), {}), null, 'özel arama')
    const invite = { dealer: '12', app: 'renk', ph: 'lobby', rules: 'official', seats: ['12'], key: null, myKey: null }
    same(pick(state(room, { role: 'player', stage: 'invited', invite })), ['invite', 'Davet', '1', false, false])
    assert.equal(state(room, { role: 'player', stage: 'invited', invite }).aria, 'Ece sizi Renk oyununa davet ediyor, masaya bakın')
    same(pick(state(room, { role: 'player', stage: 'rejoin', invite: Object.assign({}, invite, { ph: 'play', seats: ['12', '5'] }) })), ['invite', 'Davet', '1', false, false])
    same(pick(state(room, { stage: 'none', invite })), ['invite', 'Davet', '1', false, false], 'reddedilen ama süren lobi')
    same(pick(state(room, { stage: 'none', invite: Object.assign({}, invite, { ph: 'play' }) })), ['busy', 'Oyun Sürüyor', '', false, true])
    same(pick(state(room, { role: 'player', stage: 'busy', invite: Object.assign({}, invite, { ph: 'play' }) })), ['busy', 'Oyun Sürüyor', '', false, true])
    same(pick(state(room, { role: 'player', stage: 'play', invite, legal: { turn: false } })), ['back', 'Masaya Dön', '', false, false])
    same(pick(state(room, { role: 'player', stage: 'play', invite, legal: { turn: true } })), ['turn', 'Sıra Sizde', '!', false, false])
    same(pick(state(room, { role: 'dealer', stage: 'lobby' }, true)), ['minimize', 'Küçült', '', true, false])
    assert.equal(state(room, { role: 'dealer', stage: 'lobby' }, true).aria, 'Masayı küçültün, oyun sürer')
    page.run('voice = {}')
    assert.equal(state(room, {}), null, 'sendGame yok')
    const bare = makePage('5', makeNet(), { ui: false })
    bare.sandbox.tS = room
    assert.equal(bare.run('gameToolState(tS, gameEmptyModel(), false)'), null, 'kayıtlı arayüz yok')
    bare.run('gameRender()')
    assert.equal(bare.tool(), null, 'bu adımda düğme görünmez')
  })

  test('gameUiRegister: kural motoru ve name ile render olmadan kayıt olmaz', () => {
    const page = makePage('5', makeNet(), { ui: false })
    assert.equal(page.run("gameUiRegister('xox', fakeUi)"), false, 'motoru olmayan oyun')
    assert.equal(page.run("gameUiRegister('Renk', fakeUi)"), false, 'geçersiz kimlik')
    assert.equal(page.run("gameUiRegister('renk', { name: () => 'Renk' })"), false, 'render yok')
    same(page.run('gameAppIds()'), [])
    assert.equal(page.run("gameUiRegister('renk', fakeUi)"), true)
    same(page.run('gameAppIds()'), ['renk'])
    assert.equal(page.run("gameAppName('renk')"), 'Renk')
  })

  test('düğme Büyüt ile Telsiz DJ arasında durur, gizlenince satırdan kalkar', () => {
    const page = makePage('5', makeNet())
    const ids = () => page.q('#radio-tools').children.map((c) => c.id || c.className)
    // Telsiz DJ önce gelmişse düğme onun önüne girer
    page.run(`
      const dj = h('span', 'radio-tool-wrap crew-dj')
      el.radioTools.appendChild(dj)
      gameRender()
    `)
    same(ids(), ['radio-game', 'radio-tool-wrap crew-dj'])
    // Büyüt başa kendini koyar, DJ sona taşınır (10-voice.js ve 23-dj.js kalıpları), düğme yerinde kalır
    page.run(`
      const cams = h('button', 'radio-tool cams-tool')
      cams.id = 'radio-cams'
      el.radioTools.insertBefore(cams, el.radioTools.firstElementChild)
      el.radioTools.appendChild(el.radioTools.querySelector('.crew-dj'))
      gameRenderTool()
    `)
    same(ids(), ['radio-cams', 'radio-game', 'radio-tool-wrap crew-dj'])
    // Yanlış yerdeyse taşınır, odaktaysa odak geri verilir
    page.run(`
      el.radioTools.appendChild(byId('radio-game'))
      byId('radio-game').focus()
      gameState.toolKey = ''
      gameRenderTool()
    `)
    same(ids(), ['radio-cams', 'radio-game', 'radio-tool-wrap crew-dj'])
    assert.equal(page.doc.activeElement, page.tool())
    const tool = page.tool()
    assert.equal(tool.getAttribute('data-focus-key'), 'tool-game')
    assert.equal(tool.getAttribute('aria-controls'), 'cast')
    assert.equal(tool.getAttribute('aria-expanded'), 'false')
    assert.equal(tool.querySelector('.radio-tool-count').hidden, true)
    page.fake.snap = Object.assign({}, page.fake.snap, { private: true })
    page.run('gameRender()')
    same(ids(), ['radio-cams', 'radio-tool-wrap crew-dj'])
  })
})

describe('duyurular ve sahne', () => {
  test('"Sıra sizde" ısrarlı bölgeye, diğerleri kibar bölgeye gider, 400 ms içindekiler birleşir', () => {
    const net = makeNet()
    const page = makePage('5', net)
    page.run("gameOnNotice('joined', { id: '12' })")
    page.run("gameOnNotice('left', { id: '7', why: 'leave' })")
    page.run("gameOnNotice('turn', null)")
    assert.equal(page.q('#game-live'), null, '400 ms dolmadan yazılmaz')
    net.clock.advance(400)
    assert.equal(page.text('#game-live .game-live-polite'), 'Ece masaya katıldı. Mert masadan ayrıldı.')
    assert.equal(page.text('#game-live .game-live-assertive'), 'Sıra sizde.')
    assert.equal(page.q('#game-live .game-live-polite').getAttribute('aria-live'), 'polite')
    assert.equal(page.q('#game-live .game-live-polite').getAttribute('role'), 'status')
    assert.equal(page.q('#game-live .game-live-assertive').getAttribute('aria-live'), 'assertive')
    // Aynı metin yeniden duyurulur
    page.run("gameOnNotice('turn', null)")
    net.clock.advance(400)
    assert.equal(page.text('#game-live .game-live-assertive'), '')
    net.clock.advance(100)
    assert.equal(page.text('#game-live .game-live-assertive'), 'Sıra sizde.')
  })

  test('sahne açıkken duyurular panelin canlı bölgelerine gider, gameRenderStage aynı anahtarla DOM\'a dokunmaz', () => {
    const { net, pages } = makeWorld(['5', '12'])
    const [deniz] = pages
    deniz.press('tool-game')
    assert.equal(deniz.stage(), 'game')
    const box = deniz.q('#cast .cast-game')
    const body = box.firstChild
    const before = deniz.doc.counter.mutations
    deniz.run('gameRenderStage(castState.nodes.game)')
    deniz.run('gameRenderStage(castState.nodes.game)')
    assert.equal(deniz.doc.counter.mutations, before, 'ikinci çizim DOM\'a dokunmaz')
    assert.equal(box.firstChild, body)
    deniz.run("gameOnNotice('joined', { id: '12' })")
    net.clock.advance(400)
    assert.equal(deniz.text('#cast .game-live-polite'), 'Ece masaya katıldı.')
    assert.equal(deniz.q('#game-live'), null)
    // Dil değişince yeniden çizilir
    deniz.run("I18N.setLang('en')")
    deniz.run('gameRenderStage(castState.nodes.game)')
    assert.notEqual(box.firstChild, body)
    assert.equal(deniz.text('[data-focus-key="game-open"]'), 'Open Table')
  })
})

describe('akış: Masa Kur, davet, lobi, oyun', () => {
  test('kurpiyer masa açar, davet sahneyi açmaz, Masaya Bak ile açılır, Katıl ve Başlat', () => {
    const { net, pages } = makeWorld(['5', '12'])
    const [deniz, ece] = pages
    // Masa Kur: kurallar, odadakiler, güven notu, İptal ve Masa Aç
    deniz.press('tool-game')
    assert.equal(deniz.stage(), 'game')
    assert.equal(deniz.text('#cast .cast-title'), 'Masa Kur')
    assert.equal(deniz.doc.activeElement.getAttribute('data-focus-key'), 'game-open')
    assert.equal(deniz.key('game-rule-official').getAttribute('aria-checked'), 'true')
    assert.equal(deniz.text('.game-room .game-person-name'), 'Ece')
    assert.match(deniz.text('.game-trust'), /^Kurpiyer sizsiniz\./)
    assert.equal(deniz.tool().getAttribute('data-state'), 'minimize')
    deniz.press('game-rule-stack')
    assert.equal(deniz.model().rules, 'stack')
    assert.equal(deniz.key('game-rule-stack').getAttribute('aria-checked'), 'true')
    deniz.press('game-open')
    assert.equal(deniz.model().stage, 'lobby')
    assert.equal(deniz.text('#cast .cast-title'), 'Renk Masası')
    assert.equal(deniz.text('#cast .cast-sub'), 'Kurpiyer Sizsiniz · 1 Oyuncu')
    assert.equal(deniz.text('.game-room .game-chip'), 'Yanıt Bekleniyor')
    assert.equal(deniz.key('game-start').getAttribute('aria-disabled'), 'true')
    assert.ok(deniz.text('.game-body').indexOf('Başlatmak için en az bir oyuncunun daha katılması gerekir.') !== -1)

    // Ece: davet gelir, sahne açılmaz, düğme Davet olur, Bildirimler listesine kayıt düşer, kibar duyuru yapılır
    net.flush()
    assert.equal(ece.model().stage, 'invited')
    assert.equal(ece.stage(), null, 'davet sahneyi açmaz')
    assert.equal(ece.tool().getAttribute('data-state'), 'invite')
    assert.ok(ece.tool().classList.contains('is-invited'))
    assert.equal(ece.text('#radio-game .radio-tool-count'), '1')
    assert.equal(ece.qa('#activity .activity-item.is-game').length, 1)
    assert.equal(ece.text('#activity .activity-text'), 'Deniz, Renk masası açtı')
    assert.equal(ece.q('#activity').hidden, false)
    net.clock.advance(400)
    assert.equal(ece.text('#game-live .game-live-polite'), 'Deniz sizi Renk oyununa davet ediyor.')

    // Bildirimler listesindeki Masaya Bak: davet, kurallar, güven notu Katıl'ın hemen üstünde
    ece.click('#activity .activity-watch')
    assert.equal(ece.stage(), 'game')
    assert.equal(ece.text('.game-lead'), 'Deniz sizi Renk oyununa davet ediyor.')
    assert.equal(ece.text('.game-rules-name'), 'Kural stack')
    const bodyKids = ece.q('.game-body').children
    assert.ok(bodyKids[bodyKids.length - 2].classList.contains('game-trust'), 'güven notu düğmelerin hemen üstünde')
    assert.match(ece.text('.game-trust'), /^Kurpiyer Deniz\./)
    assert.equal(ece.doc.activeElement.getAttribute('data-focus-key'), 'game-join')
    ece.press('game-join')
    assert.equal(ece.qa('#activity .activity-item.is-game').length, 0, 'Katıl kaydı kaldırır')
    assert.equal(ece.model().stage, 'joining')
    net.flush()
    assert.equal(deniz.model().seats.length, 2)
    assert.equal(ece.model().stage, 'lobby')
    assert.ok(ece.text('.game-body').indexOf('Kurpiyerin başlatması bekleniyor.') !== -1)
    assert.equal(deniz.key('game-start').getAttribute('aria-disabled'), null)
    same(deniz.qa('.game-seats .game-chip').map((c) => c.textContent), ['Kurpiyer', 'Katıldı'])
    assert.ok(deniz.key('game-remove-12'), 'diğer koltukta Koltuktan Çıkar')
    assert.equal(ece.qa('.game-seats .game-chip').length, 0, 'oyuncu durum çiplerini görmez')
    net.clock.advance(400)
    assert.equal(deniz.text('#cast .game-live-polite'), 'Ece masaya katıldı.')

    // Başlat: iki sayfada uygulamanın masası, durum satırı ve alt satır
    deniz.press('game-start')
    net.flush()
    assert.equal(deniz.model().stage, 'play')
    assert.equal(ece.model().stage, 'play')
    for (const page of [deniz, ece]) {
      assert.equal(page.text('.game-app .fake-table'), 'play')
      assert.equal(page.text('#cast .cast-title'), 'Renk')
      assert.equal(page.text('#cast .cast-sub').split(' · ')[0], 'Satir stack')
      assert.ok(page.q('.game-status'), 'durum satırı')
      assert.equal(page.text('.game-trust-chip'), 'Kurpiyer Elleri Bilir')
    }
    assert.ok(deniz.key('game-end') && deniz.key('game-close-table'))
    assert.ok(ece.key('game-leave') && !ece.key('game-end'))
    const turn = deniz.model().view.turn
    const mover = turn === '5' ? deniz : ece
    const other = mover === deniz ? ece : deniz
    assert.equal(mover.text('.game-status-turn'), 'Sıra Sizde')
    assert.equal(other.text('.game-status-turn'), 'Sıradaki: ' + NAMES[turn])
    net.clock.advance(400)
    assert.equal(mover.text('#cast .game-live-assertive'), 'Sira sende, karti oyna')
    assert.equal(net.errors.length, 0, String(net.errors[0]))
  })

  test('küçültülen masa sürer, düğme Masaya Dön ve Sıra Sizde olur, Ayrıntı ve onay satırı', () => {
    const { net, pages } = makeWorld(['5', '12'])
    const [deniz, ece] = pages
    deniz.press('tool-game')
    deniz.press('game-open')
    net.flush()
    ece.press('tool-game')
    ece.press('game-join')
    net.flush()
    deniz.press('game-start')
    net.flush()
    // Küçült: sahne kalkar, odak düğmeye gider
    ece.press('tool-game')
    assert.equal(ece.stage(), null)
    assert.equal(ece.doc.activeElement, ece.tool())
    const eceTurn = ece.model().legal.turn
    assert.equal(ece.tool().getAttribute('data-state'), eceTurn ? 'turn' : 'back')
    ece.press('tool-game')
    assert.equal(ece.stage(), 'game')
    // Ayrıntı: güven metninin tamamı panelde açılır
    assert.equal(ece.q('#game-trust-detail').hidden, true)
    ece.press('game-trust-more')
    assert.equal(ece.q('#game-trust-detail').hidden, false)
    assert.equal(ece.key('game-trust-more').getAttribute('aria-expanded'), 'true')
    assert.equal(ece.doc.activeElement.getAttribute('data-focus-key'), 'game-trust-more')
    // Onay satırı: odak Vazgeç'e gider, Esc kapatır ve odak düğmeye döner
    ece.press('game-leave')
    assert.equal(ece.text('.game-confirm-text'), 'Ayrılırsanız kartlarınız desteye döner.')
    assert.equal(ece.doc.activeElement.getAttribute('data-focus-key'), 'game-confirm-no')
    const esc = ece.q('#cast .cast-game').dispatch('keydown', { key: 'Escape' })
    assert.equal(esc.defaultPrevented, true)
    assert.equal(ece.q('.game-confirm'), null)
    assert.equal(ece.doc.activeElement.getAttribute('data-focus-key'), 'game-leave')
    // Kurpiyer masayı kapatır (onaylı), oyuncuda bitiş ekranı ve Kapat
    deniz.press('game-close-table')
    assert.equal(deniz.text('.game-confirm-text'), 'Masa herkes için kapanır.')
    deniz.press('game-confirm-yes')
    assert.equal(deniz.model().stage, 'none')
    assert.equal(deniz.stage(), null)
    net.flush()
    assert.equal(ece.model().stage, 'ended')
    assert.equal(ece.text('.game-ended'), 'Kurpiyer masayı kapattı.')
    ece.press('game-dismiss')
    assert.equal(ece.model().stage, 'none')
    assert.equal(ece.stage(), null)
    assert.equal(ece.doc.activeElement, ece.tool())
    assert.equal(ece.tool().getAttribute('data-state'), 'tool')
    assert.equal(net.errors.length, 0, String(net.errors[0]))
  })

  test('Oyunu Bitir sonuçları gösterir, Yeni El lobiye döner, Oyun Sürüyor bilgisi', () => {
    const { net, pages } = makeWorld(['5', '12', '7'])
    const [deniz, ece, mert] = pages
    deniz.press('tool-game')
    deniz.press('game-open')
    net.flush()
    ece.press('tool-game')
    ece.press('game-join')
    net.flush()
    deniz.press('game-start')
    net.flush()
    net.clock.advance(400)
    assert.match(deniz.text('#cast .game-live-polite'), /^Ece masaya katıldı\. Oyun başladı\./)
    // Oturmayan Mert: Oyun Sürüyor, basınca bilgi ekranı ve Kapat
    assert.equal(mert.tool().getAttribute('data-state'), 'busy')
    assert.equal(mert.tool().getAttribute('aria-disabled'), 'true')
    mert.press('tool-game')
    assert.equal(mert.stage(), 'game')
    assert.equal(mert.text('.game-lead'), 'Bu odada bir oyun sürüyor, sonraki elde katılabilirsiniz')
    assert.equal(mert.key('game-join'), null)
    mert.press('game-dismiss')
    assert.equal(mert.stage(), null)
    // Oyunu Bitir (onaylı): sonuç çerçevesi
    deniz.press('game-end')
    assert.equal(deniz.text('.game-confirm-text'), 'Oyun herkes için biter.')
    deniz.press('game-confirm-yes')
    net.flush()
    for (const page of [deniz, ece]) {
      assert.equal(page.model().stage, 'over')
      assert.equal(page.text('.game-results .game-h'), 'Sonuçlar')
      assert.equal(page.text('.game-winner'), 'Kazanan Yok')
      assert.equal(page.text('.game-results-reason'), 'Kurpiyer oyunu bitirdi.')
      const rows = page.qa('.game-result')
      assert.equal(rows.length, 2)
      assert.match(rows[0].getAttribute('aria-label'), /^1\. sıra (Deniz|Ece): [0-9]+ Kart, [0-9]+ Puan$/)
      assert.equal(page.q('.game-status'), null, 'bitince durum satırı yok')
    }
    assert.ok(deniz.key('game-new-round') && deniz.key('game-close-table'))
    assert.equal(deniz.key('game-end'), null)
    assert.ok(ece.text('.game-foot').indexOf('Kurpiyer yeni el açarsa masada kalırsınız.') !== -1)
    assert.ok(ece.key('game-leave'))
    // Yeni El: oturanlar yerinde, lobi
    deniz.press('game-new-round')
    net.flush()
    assert.equal(deniz.model().stage, 'lobby')
    assert.equal(ece.model().stage, 'lobby')
    assert.equal(deniz.qa('.game-seats .game-person').length, 2)
    // Lobide ayrılma onay istemez
    ece.press('game-leave')
    assert.equal(ece.model().stage, 'none')
    assert.equal(ece.text('.toast'), 'Masadan ayrıldınız.')
    net.flush()
    assert.equal(deniz.qa('.game-seats .game-person').length, 1)
    assert.equal(net.errors.length, 0, String(net.errors[0]))
  })

  test('küçültülmüş masa bitince duyurulur ve kapanır, ses odasından çıkınca masa sessizce kapanır', () => {
    const { net, pages } = makeWorld(['5', '12'])
    const [deniz, ece] = pages
    deniz.press('tool-game')
    deniz.press('game-open')
    net.flush()
    net.clock.advance(400)
    ece.press('tool-game')
    ece.press('game-join')
    net.flush()
    ece.press('tool-game')
    assert.equal(ece.stage(), null)
    deniz.press('game-close-table')
    deniz.press('game-confirm-yes')
    net.flush()
    assert.equal(ece.model().stage, 'none', 'küçültülmüş masa bitiş ekranı beklemez')
    assert.equal(ece.text('.toast'), 'Kurpiyer masayı kapattı.')
    net.clock.advance(400)
    assert.equal(ece.text('#game-live .game-live-polite'), 'Kurpiyer masayı kapattı.')
    // Ses odasından çıkış: reset
    deniz.press('tool-game')
    deniz.press('game-open')
    assert.equal(deniz.stage(), 'game')
    deniz.fake.snap = { channelId: null, private: false, joining: false, peers: {} }
    deniz.run("gameOnVoiceEvent({ type: 'reset' })")
    assert.equal(deniz.model().stage, 'none')
    assert.equal(deniz.stage(), null)
    assert.equal(deniz.text('.toast'), 'Ses odasından ayrıldınız, masa kapandı.')
    deniz.run('gameRender()')
    assert.equal(deniz.tool(), null, 'seste değilken düğme yok')
  })

  test('özel aramada gelen oyun olayları atılır, kilitli kimlikte Masa Aç pasif', () => {
    const { net, pages } = makeWorld(['5', '12'])
    const [deniz, ece] = pages
    ece.fake.snap = Object.assign({}, ece.fake.snap, { private: true })
    ece.run('gameRender()')
    deniz.press('tool-game')
    deniz.press('game-open')
    net.flush()
    assert.equal(ece.model().stage, 'none')
    assert.equal(ece.tool(), null)
    const locked = makeWorld(['7', '30']).pages[0]
    locked.fake.locked = true
    locked.press('tool-game')
    assert.equal(locked.key('game-open').getAttribute('aria-disabled'), 'true')
    assert.ok(locked.text('.game-locked').indexOf('güvenlik anahtarınızın') !== -1)
    locked.press('game-open')
    assert.equal(locked.model().stage, 'setup', 'pasif Masa Aç masa açmaz')
  })

  test('anahtar sorunu olan davette Katıl yerine neden ve Kapat görünür', () => {
    const { net, pages } = makeWorld(['5', '12'])
    const [deniz, ece] = pages
    ece.fake.keys['5'] = 'unverified'
    deniz.press('tool-game')
    deniz.press('game-open')
    net.flush()
    ece.press('tool-game')
    assert.equal(ece.key('game-join'), null)
    assert.equal(ece.text('.game-alert'), 'Deniz kişisinin güvenlik anahtarı doğrulanmadı.')
    ece.press('game-dismiss')
    assert.equal(ece.stage(), null)
    net.flush()
    same(deniz.model().room.map((r) => r.status), ['cannot'])
    assert.equal(deniz.text('.game-room .game-chip'), 'Katılamaz')
  })
})

// ------------------------------------------------------------------ Renk masası (37-renk.js)

// Elle kurulmuş Renk eli: oyuncular ['12', '5'], dağıtan 12, soldaki (ilk sıra) 5. Kartlar dealFrom ile kanonik
// desteden verilen sırayla dağıtılır (üst = son öğe): sırayla 5, 12, 5, 12 ... ve ilk açılan kart.
function renkDeal (page, mine, other, top, rules) {
  const R = page.sandbox.TelsizRenk
  const pops = []
  mine.forEach((c, i) => pops.push(c, other[i]))
  pops.push(top)
  const deck = R.buildDeck()
  for (const c of pops) deck.splice(deck.indexOf(c), 1)
  const rng = (n) => new Array(n).fill(7)
  return R.dealFrom({ rules: rules || 'official', players: ['12', '5'], dealSeat: 0 }, deck.concat(pops.reverse()), rng).state
}

// Durumdan Deniz'in (5) görünüm modeli: sahne açık, masa oyun aşamasında, hamleler kaydedilir (gameCall taklidi)
function renkShow (page, state, extra) {
  const R = page.sandbox.TelsizRenk
  const view = R.publicView(state)
  const mine = R.privateView(state, '5')
  page.sandbox.tM = Object.assign(page.run('gameEmptyModel()'), {
    rev: (page.sandbox.tRev = (page.sandbox.tRev || 0) + 1),
    role: 'player',
    stage: view.phase === 'over' ? 'over' : 'play',
    app: 'renk',
    g: 'g1',
    dealer: '12',
    me: '5',
    rules: state.rules,
    rd: 1,
    min: 2,
    max: 8,
    seats: state.seats.map((s) => ({ id: s.id, away: false, offline: false, keyIssue: null })),
    view,
    mine,
    legal: R.legalMoves(view, mine, '5')
  }, extra || {})
  page.run(`
    if (typeof actCalls === 'undefined') {
      globalThis.actCalls = []
      gameCall = function (name, arg) {
        actCalls.push([name, arg])
        return true
      }
    }
    gameState.model = tM
    el.cast.hidden = false
    el.cast.setAttribute('data-mode', 'game')
    gameRenderStage(castState.nodes.game)
  `)
  return page.sandbox.tM
}

const calls = (page) => JSON.parse(JSON.stringify(page.sandbox.actCalls || []))

function renkPage (lang) {
  const net = makeNet()
  const page = makePage('5', net, { renk: true, lang: lang || 'tr-TR' })
  return { net, page }
}

describe('Renk: bağlantılar, i18n ve kart adları', () => {
  test('index.html sprite yeni beş sembolü içerir, 37-renk.js kendini kaydeder', () => {
    for (const id of ['i-reverse', 'i-suit-circle', 'i-suit-triangle', 'i-suit-square', 'i-suit-diamond']) {
      assert.equal(HTML.split('<symbol id="' + id + '" viewBox="0 0 24 24">').length - 1, 1, id)
    }
    assert.ok(HTML.indexOf('<symbol id="i-gamepad"') < HTML.indexOf('<symbol id="i-reverse"'))
    const { page } = renkPage()
    same(page.run('gameAppIds()'), ['renk'])
    assert.equal(page.run("gameAppName('renk')"), 'Renk')
  })

  test('game.renk.* anahtarları iki dilde aynı sırada, motorun bütün kodları ve renkleri çevrilir', () => {
    const I = loadI18n().I18N
    const R = makePage('5', makeNet(), { ui: false }).sandbox.TelsizRenk
    const order = (lang) => Object.keys(I.messages[lang]).filter((k) => k.indexOf('game.renk.') === 0)
    same(order('tr'), order('en'))
    const has = (key) => Object.prototype.hasOwnProperty.call(I.messages[I.lang], key)
    for (const lang of ['tr', 'en']) {
      I.setLang(lang)
      for (const code of R.ERRORS) assert.ok(has('game.renk.err.' + code), lang + ': err ' + code)
      for (const e of R.EVENTS) assert.ok(has('game.renk.ev.' + e) || (has('game.renk.ev.' + e + '_one') && has('game.renk.ev.' + e + '_other')), lang + ': ev ' + e)
      for (const rules of R.RULES) {
        for (const key of ['game.renk.rules.' + rules, 'game.renk.rules.' + rules + 'Hint', 'game.renk.rulesLine.' + rules]) assert.ok(has(key), lang + ': ' + key)
      }
      const letters = R.COLORS.map((c) => {
        assert.ok(has('game.renk.color.' + c), lang + ': color ' + c)
        return I.t('game.renk.letter.' + c)
      })
      assert.equal(new Set(letters).size, 4, lang + ': harfler tekil ' + letters.join(''))
      for (const l of letters) assert.match(l, /^[A-ZÇĞİÖŞÜ]$/, lang + ': ' + l)
    }
  })

  test('renkCardLabel iki dilde gerçek sözlükle, hata kodları sessiz ya da kısa metinli', () => {
    const { page } = renkPage()
    const label = (c) => page.run(`renkCardLabel('${c}')`)
    assert.equal(label('R7'), 'Kırmızı 7')
    assert.equal(label('BS'), 'Mavi Engel')
    assert.equal(label('GV'), 'Yeşil Yön')
    assert.equal(label('YD'), 'Sarı +2')
    assert.equal(label('WW'), 'Joker')
    assert.equal(label('WF'), 'Joker +4')
    assert.equal(label('X9'), '', 'geçersiz kod')
    assert.equal(page.run("renkPlayedLabel('WW', 'B')"), 'Joker, Mavi seçildi')
    // 5.17: sessiz kodlar boş, panelde gösterilenler metinli
    for (const code of ['stale', 'not_your_turn', 'bad_move', 'game_over', 'already_drawn', 'no_last', 'self_catch']) {
      assert.equal(page.run(`gameErrorText('${code}', 'renk')`), '', code)
    }
    assert.equal(page.run("gameErrorText('wild4_has_color', 'renk')"), 'Elinizde aktif renkte kart varken Joker +4 oynanamaz.')
    assert.equal(page.run("gameErrorText('send', 'renk')"), 'Masaya ileti gönderilemedi.', 'masa yöneticisinin kodu')
    page.run("I18N.setLang('en')")
    assert.equal(label('R7'), 'Red 7')
    assert.equal(label('WF'), 'Wild +4')
    assert.equal(label('BV'), 'Blue Reverse')
  })

  test('olay ve sıra metinleri: çekilen kart okunmaz, yakalanmanın cezası tekrarlanmaz', () => {
    const { page } = renkPage()
    page.sandbox.tEv = [
      { e: 'play', p: '12', c: 'WF', col: 'G' },
      { e: 'penalty', p: '5', n: 4, want: 4, why: 'F' },
      { e: 'skip', p: '5' },
      { e: 'draw', p: '12', n: 1 },
      { e: 'reverse', dir: -1 },
      { e: 'caught', p: '7', by: '12' },
      { e: 'penalty', p: '7', n: 2, want: 2, why: 'last' },
      { e: 'end', winner: null, total: 0, reason: 'ended' },
      { e: 'end', winner: '12', total: 30, reason: 'out' }
    ]
    same(page.run('tEv.map((ev) => renkEventText(ev))'), [
      'Ece Joker +4, Yeşil seçildi oynadı.',
      'Deniz ceza olarak 4 kart çekti.',
      'Deniz sırasını kaybetti.',
      'Ece 1 kart çekti.',
      'Yön değişti: Ters Yön.',
      'Mert yakalandı ve 2 kart çekti.',
      '',
      '',
      'Ece kazandı.'
    ])
    const state = renkDeal(page, ['R5', 'R2', 'G5', 'B1', 'Y3', 'WW', 'G9'], ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'], 'R9')
    const m = renkShow(page, state)
    assert.equal(page.run('renkTurnText(tM)'), 'Sıra sizde. Atılan kart Kırmızı 9. 4 kartınız oynanabilir.')
    same(Array.from(m.legal.play).sort(), ['G9', 'R2', 'R5', 'WW'])
  })
})

describe('Renk: masa çizimi ve hamleler', () => {
  test('masa: rakip şeridi, deste, atılan kart, aktif renk, el sıralı ve oynanabilirlik etiketli', () => {
    const { page } = renkPage()
    const state = renkDeal(page, ['WW', 'G9', 'R5', 'B1', 'R2', 'G5', 'Y3'], ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'], 'R9')
    renkShow(page, state)
    assert.equal(page.q('.renk-table').getAttribute('data-turn'), 'me')
    same(page.qa('.renk-opp .sr-only').map((n) => n.textContent), ['Ece, 7 Kart'])
    assert.ok(page.q('.renk-opp [data-user-id], .renk-opp').getAttribute('data-user-id') === '12')
    assert.equal(page.q('.renk-opp .renk-crown') !== null, true, 'kurpiyerde taç')
    const keys = page.qa('.renk-hand .renk-card').map((c) => c.getAttribute('data-focus-key'))
    same(keys, ['game-card-R2-0', 'game-card-R5-0', 'game-card-Y3-0', 'game-card-G5-0', 'game-card-G9-0', 'game-card-B1-0', 'game-card-WW-0'], 'renk ve değer sırası, Joker sonda')
    assert.equal(page.qa('.renk-card').length, 8, 'el ve atılan kart, başkasının eli çizilmez')
    assert.equal(page.key('game-card-R5-0').getAttribute('aria-label'), 'Kırmızı 5, oynanabilir')
    assert.equal(page.key('game-card-R5-0').getAttribute('aria-disabled'), null)
    assert.ok(page.key('game-card-R5-0').classList.contains('is-playable'))
    assert.equal(page.key('game-card-B1-0').getAttribute('aria-label'), 'Mavi 1, Atılan kartla rengi ya da işareti eşleşmiyor.')
    assert.equal(page.key('game-card-B1-0').getAttribute('aria-disabled'), 'true')
    assert.ok(page.key('game-card-B1-0').classList.contains('is-blocked'))
    assert.equal(page.q('.renk-pile').getAttribute('aria-label'), 'Atılan kart: Kırmızı 9')
    assert.equal(page.q('.renk-pile .renk-card').getAttribute('data-color'), 'R')
    assert.equal(page.text('.renk-color-name'), 'Kırmızı')
    assert.equal(page.key('game-draw').getAttribute('aria-label'), 'Desteden kart çekin, 93 kart kaldı')
    assert.equal(page.key('game-draw').getAttribute('aria-disabled'), null)
    assert.equal(page.text('.renk-hand-title'), 'Eliniz · 7 Kart')
    assert.equal(page.q('.renk-hand').getAttribute('aria-label'), 'Eliniz, 7 kart')
    assert.equal(page.key('game-last').getAttribute('aria-disabled'), 'true')
    assert.equal(page.key('game-catch').getAttribute('aria-disabled'), 'true')
    assert.equal(page.key('game-pass'), null)
    assert.equal(page.key('game-choose-color'), null)
    same(page.qa('.game-status .game-status-chip').map((n) => n.textContent), ['Saat Yönü'])
    // Renk körlüğü: kart yüzünde şekil ve dile göre harf
    const card = page.key('game-card-Y3-0')
    assert.equal(card.querySelector('use').getAttribute('href'), '#i-suit-triangle')
    assert.equal(card.querySelector('.renk-card-tag').textContent, 'S')
    // Firstfocus: ilk oynanabilir kart
    assert.equal(page.run('gameFirstFocus()').getAttribute('data-focus-key'), 'game-card-R2-0')
  })

  test('kart, Deste ve Pas Geç hamle gönderir, oynanamayan kart nedeni gösterir, gönderim sürerken hepsi pasif', () => {
    const { net, page } = renkPage()
    const state = renkDeal(page, ['R5', 'R2', 'G5', 'B1', 'Y3', 'WW', 'G9'], ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'], 'R9')
    renkShow(page, state)
    page.press('game-card-B1-0')
    same(calls(page), [], 'oynanamayan kart gönderilmez')
    assert.equal(page.text('.renk-note'), 'Atılan kartla rengi ya da işareti eşleşmiyor.')
    assert.equal(page.doc.activeElement.getAttribute('data-focus-key'), 'game-card-B1-0')
    net.clock.advance(400)
    assert.equal(page.text('#cast .game-live-polite'), 'Atılan kartla rengi ya da işareti eşleşmiyor.')
    page.press('game-card-R5-0')
    same(calls(page), [['act', { t: 'play', c: 'R5', step: 0 }]])
    page.press('game-draw')
    same(calls(page)[1], ['act', { t: 'draw', step: 0 }])
    // Çekilen kart (R7, destenin üstüne konur) oynanabilir: Pas Geç görünür, kart Yeni işareti taşır, diğerleri örtülü
    const R = page.sandbox.TelsizRenk
    const top = JSON.parse(JSON.stringify(state))
    top.deck.splice(top.deck.indexOf('R7'), 1)
    top.deck.push('R7')
    const drawn = R.applyMove(top, '5', { t: 'draw', step: 0 }, (n) => new Array(n).fill(3)).state
    assert.equal(drawn.phase, 'drawn')
    renkShow(page, drawn)
    assert.equal(page.text('.renk-card.is-new .renk-card-new'), 'Yeni')
    assert.equal(page.q('.renk-card.is-new').getAttribute('data-focus-key'), 'game-card-R7-0')
    assert.equal(page.q('.renk-card.is-new').getAttribute('aria-label'), 'Kırmızı 7, oynanabilir, yeni çekildi')
    assert.equal(page.key('game-card-R5-0').getAttribute('aria-label'), 'Kırmızı 5, Yalnız çektiğiniz kartı oynayabilirsiniz.')
    assert.equal(page.key('game-draw').getAttribute('aria-disabled'), 'true')
    page.press('game-pass')
    same(calls(page)[2], ['act', { t: 'pass', step: 1 }])
    // Gönderim sürerken
    const before = calls(page).length
    renkShow(page, state, { pending: { seq: 1, at: 0 } })
    assert.ok(page.q('.renk-table').classList.contains('is-pending'))
    assert.ok(page.qa('.renk-hand .renk-card').every((c) => c.getAttribute('aria-disabled') === 'true'))
    assert.equal(page.key('game-draw').getAttribute('aria-disabled'), 'true')
    page.press('game-card-R5-0')
    page.press('game-draw')
    assert.equal(calls(page).length, before)
  })

  test('Joker: renk seçici katmanı açılır, renk seçilince hamle gider, Esc ve İptal kart oynamaz', () => {
    const { net, page } = renkPage()
    const state = renkDeal(page, ['R5', 'R2', 'G5', 'B1', 'Y3', 'WW', 'G9'], ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'], 'R9')
    renkShow(page, state)
    page.press('game-card-WW-0')
    assert.ok(page.q('.cast-game .renk-picker[role="dialog"]'), 'seçici panelin içinde')
    assert.equal(page.run('topLayer().name'), 'game-color')
    assert.equal(page.run('topLayer().trap'), true)
    assert.equal(page.run('topLayer().el') === page.q('.renk-picker'), true)
    assert.equal(page.doc.activeElement.getAttribute('data-focus-key'), 'game-color-R')
    same(page.qa('.renk-pick').map((b) => b.textContent), ['KKırmızı', 'SSarı', 'YYeşil', 'MMavi'])
    // Model değişince seçici yeniden çizilir, katman yeni öğeyi izler
    renkShow(page, state)
    assert.equal(page.run('topLayer().el') === page.q('.renk-picker'), true)
    page.click('.renk-pick[data-color="B"]')
    same(calls(page), [['act', { t: 'play', c: 'WW', col: 'B', step: 0 }]])
    assert.equal(page.q('.renk-picker'), null)
    assert.equal(page.run('topLayer()'), null)
    // Esc (katman kapanır): kart oynanmaz, odak karta döner
    page.press('game-card-WW-0')
    page.run('closeLayer(topLayer(), true)')
    assert.equal(page.q('.renk-picker'), null)
    assert.equal(page.doc.activeElement.getAttribute('data-focus-key'), 'game-card-WW-0')
    // İptal
    page.press('game-card-WW-0')
    page.press('game-color-cancel')
    assert.equal(page.q('.renk-picker'), null)
    assert.equal(page.run('topLayer()'), null)
    assert.equal(calls(page).length, 1)
    // Sıra geçerse açık seçici kapanır
    page.press('game-card-WW-0')
    renkShow(page, state, { legal: Object.assign({}, page.sandbox.tM.legal, { turn: false, play: [] }) })
    assert.equal(page.q('.renk-picker'), null)
    assert.equal(page.run('topLayer()'), null)
    assert.equal(page.run('gameState.picker'), null)
    // Sahne kapanınca katman da kapanır
    renkShow(page, state)
    page.press('game-card-WW-0')
    page.run('clear(castState.nodes.game); gameStageClosed()')
    assert.equal(page.run('topLayer()'), null)
    net.clock.advance(100)
    assert.equal(net.errors.length, 0, String(net.errors[0]))
  })

  test('ilk kart Joker: kartlar renk seçimini bekler, Renk Seç renk hamlesi gönderir', () => {
    const { page } = renkPage()
    const state = renkDeal(page, ['R5', 'R2', 'G5', 'B1', 'Y3', 'WF', 'G9'], ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'], 'WW')
    const m = renkShow(page, state)
    assert.equal(m.view.phase, 'color')
    assert.equal(page.text('.renk-color-name'), 'Seçilmedi')
    assert.equal(page.q('.renk-color').getAttribute('data-color'), 'none')
    assert.equal(page.run('renkTurnText(tM)'), 'Sıra sizde. İlk kart Joker, önce renk seçin.')
    assert.equal(page.key('game-draw').getAttribute('aria-disabled'), 'true')
    assert.ok(page.qa('.renk-hand .renk-card').every((c) => c.getAttribute('aria-disabled') === 'true' && !c.classList.contains('is-blocked')))
    assert.equal(page.key('game-card-R5-0').getAttribute('aria-label'), 'Kırmızı 5, Önce renk seçin.')
    assert.equal(page.run('gameFirstFocus()').getAttribute('data-focus-key'), 'game-choose-color')
    page.press('game-choose-color')
    assert.ok(page.q('.renk-picker'))
    page.click('.renk-pick[data-color="Y"]')
    same(calls(page), [['act', { t: 'color', col: 'Y', step: 0 }]])
    assert.equal(page.q('.renk-picker'), null)
  })

  test('Tek!: iki kartla işaretlenir ve kartla gider, geç Tek! ve Yakala hemen gider', () => {
    const { page } = renkPage()
    const base = renkDeal(page, ['R5', 'R2', 'G5', 'B1', 'Y3', 'WW', 'G9'], ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'], 'R9')
    // Elde iki kart: R5 ve G9 (fazlası desteye)
    const two = JSON.parse(JSON.stringify(base))
    two.deck = two.deck.concat(two.seats[1].hand.filter((c) => c !== 'R5' && c !== 'G9'))
    two.seats[1].hand = ['R5', 'G9']
    renkShow(page, two)
    const last = page.key('game-last')
    assert.equal(last.getAttribute('aria-disabled'), null)
    assert.equal(last.getAttribute('aria-pressed'), 'false')
    assert.equal(last.getAttribute('aria-label'), 'Tek! deyin: son kartınıza düşüyorsunuz')
    page.press('game-last')
    assert.equal(page.key('game-last').getAttribute('aria-pressed'), 'true')
    assert.equal(page.text('[data-focus-key="game-last"]'), 'Tek! Denecek')
    assert.equal(page.doc.activeElement.getAttribute('data-focus-key'), 'game-last')
    page.press('game-last')
    assert.equal(page.key('game-last').getAttribute('aria-pressed'), 'false', 'ikinci basış kaldırır')
    page.press('game-last')
    page.press('game-card-R5-0')
    same(calls(page), [['act', { t: 'play', c: 'R5', step: 0, last: true }]])
    // Geç Tek!: pencere açık ve korunmasız
    const late = JSON.parse(JSON.stringify(two))
    late.seats[1].hand = ['G9']
    late.deck.push('R5')
    late.last = { p: '5', safe: false }
    late.turn = 0
    renkShow(page, late)
    page.press('game-last')
    same(calls(page)[1], ['act', { t: 'last' }])
    assert.equal(page.key('game-last').getAttribute('aria-disabled'), 'true', 'gönderildi')
    // Yakala: rakip korunmasız tek kartta
    const other = JSON.parse(JSON.stringify(base))
    other.deck = other.deck.concat(other.seats[0].hand.slice(1))
    other.seats[0].hand = other.seats[0].hand.slice(0, 1)
    other.last = { p: '12', safe: false }
    renkShow(page, other)
    assert.ok(page.q('.renk-opp').classList.contains('is-catchable'))
    const grab = page.key('game-catch')
    assert.equal(grab.getAttribute('aria-disabled'), null)
    assert.equal(grab.getAttribute('aria-label'), 'Ece Tek! demedi, yakalayın')
    page.press('game-catch')
    same(calls(page)[2], ['act', { t: 'catch', p: '12' }])
    // Masa değişene kadar ikinci basış gitmez (kurpiyerin sıra dışı hamlesi gecikmeli işlenir)
    assert.equal(page.key('game-catch').getAttribute('aria-disabled'), 'true')
    page.press('game-catch')
    assert.equal(calls(page).length, 3)
    // Tek! diyen rakipte çip ve cümle
    other.last = { p: '12', safe: true }
    renkShow(page, other)
    assert.equal(page.text('.renk-opp .renk-chip.is-last'), 'Tek!')
    assert.equal(page.text('.renk-opp .sr-only'), 'Ece, 1 Kart, Tek! dedi')
    assert.equal(page.key('game-catch').getAttribute('aria-disabled'), 'true')
  })

  test('ok tuşları elde, eylem satırında ve Deste\'de gezdirir, yalnızca işlenen tuş engellenir', () => {
    const { page } = renkPage()
    const state = renkDeal(page, ['R5', 'R2', 'G5', 'B1', 'Y3', 'WW', 'G9'], ['B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'], 'R9')
    renkShow(page, state)
    const press = (k, keyName) => page.key(k).dispatch('keydown', { key: keyName })
    const at = () => page.doc.activeElement.getAttribute('data-focus-key')
    page.key('game-card-R2-0').focus()
    assert.equal(press('game-card-R2-0', 'ArrowRight').defaultPrevented, true)
    assert.equal(at(), 'game-card-R5-0')
    press('game-card-R5-0', 'End')
    assert.equal(at(), 'game-card-WW-0')
    press('game-card-WW-0', 'Home')
    assert.equal(at(), 'game-card-R2-0')
    press('game-card-R2-0', 'ArrowLeft')
    assert.equal(at(), 'game-card-R2-0', 'baştaki kartta kalır')
    press('game-card-R2-0', 'ArrowUp')
    assert.equal(at(), 'game-draw')
    press('game-draw', 'ArrowDown')
    assert.equal(at(), 'game-card-R2-0', 'ilk oynanabilir kart')
    page.key('game-catch').focus()
    press('game-catch', 'ArrowLeft')
    assert.equal(at(), 'game-last')
    assert.equal(press('game-last', 'a').defaultPrevented, false, 'işlenmeyen tuş')
    assert.equal(press('game-last', 'Enter').defaultPrevented, false)
  })
})

describe('Renk: iki cihazda gerçek masa', () => {
  test('başlatınca iki sayfada Renk masası, sıradaki hamle iki sayfada aynı atılan kartı gösterir', () => {
    const { net, pages } = makeWorld(['5', '12'], { renk: true, seed: 3 })
    const [deniz, ece] = pages
    deniz.press('tool-game')
    assert.equal(deniz.text('.game-intro-name'), 'Renk')
    assert.equal(deniz.text('.game-intro-text'), 'Renk ve sayı eşleştirmeli kart oyunu')
    same(deniz.qa('.game-rules .cast-choice-label').map((n) => n.textContent), ['Resmî', 'Üst Üste Ekleme'])
    deniz.press('game-open')
    net.flush()
    ece.press('tool-game')
    assert.equal(ece.text('.game-rules-name'), 'Resmî')
    assert.match(ece.text('.game-rules-hint'), /^\+2 ve \+4 üst üste konmaz\./)
    ece.press('game-join')
    net.flush()
    deniz.press('game-start')
    net.flush()
    for (const page of pages) {
      const m = page.model()
      assert.equal(m.stage, 'play')
      assert.ok(page.q('.renk-table'), 'Renk masası')
      assert.equal(page.qa('.renk-hand .renk-card').length, m.mine.cards.length)
      assert.equal(page.qa('.renk-card').length, m.mine.cards.length + 1, 'el ve atılan kart')
      assert.equal(page.text('#cast .cast-sub'), 'Resmî Kurallar · Kurpiyer ' + (page === deniz ? 'Sizsiniz' : 'Deniz') + ' · 2 Oyuncu')
      assert.equal(page.q('.renk-table').getAttribute('data-turn'), m.legal.turn ? 'me' : 'other')
    }
    assert.equal(deniz.q('.renk-pile').getAttribute('aria-label'), ece.q('.renk-pile').getAttribute('aria-label'))
    // Birkaç tur: sırası gelen ilk oynanabilir kartı (Joker'de seçiciyle) oynar, yoksa çeker ve gerekirse pas geçer
    let turns = 8
    while (turns-- > 0) {
      const mover = pages.filter((p) => p.model().legal && p.model().legal.turn)[0]
      if (!mover) break
      const m = mover.model()
      if (m.legal.color) {
        mover.press('game-choose-color')
        mover.click('.renk-pick[data-color="G"]')
      } else if (mover.q('.renk-card.is-playable')) {
        const card = mover.q('.renk-card.is-playable')
        card.click()
        if (mover.q('.renk-picker')) mover.click('.renk-pick[data-color="R"]')
      } else {
        mover.press('game-draw')
        net.flush()
        if (mover.key('game-pass')) mover.press('game-pass')
      }
      net.flush()
      net.clock.advance(400)
      assert.equal(deniz.model().view.step, ece.model().view.step)
      assert.equal(deniz.q('.renk-pile').getAttribute('aria-label'), ece.q('.renk-pile').getAttribute('aria-label'))
      if (deniz.model().stage !== 'play') break
    }
    assert.ok(deniz.model().view.step > 0, 'hamleler uygulandı')
    assert.match(ece.text('#cast .game-live-polite') + deniz.text('#cast .game-live-polite'), /(oynadı|çekti|seçti|pas geçti)\./)
    assert.equal(net.errors.length, 0, String(net.errors[0]))
  })
})
