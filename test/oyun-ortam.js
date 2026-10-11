'use strict'

// Oyun arayüzü testlerinin ortak ortamı (test/oyun-arayuz.test.js ve test/hexball-arayuz.test.js): küçük DOM taklidi,
// sahte saat, sahte iç zarf, tohumlu rastgelelik, yayın sahnesinin (22-cast.js) ve ses arayüzünün (10-voice.js) vm
// bağlamına yüklenen karşılıkları ve testteki kişilerin adları. Test dosyası değildir (adı .test.js ile bitmez).

const assert = require('node:assert/strict')

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

module.exports = { same, stripComments, makeDocument, makeClock, fakeDm, seeded, STAGE_FAKES, NAMES }
