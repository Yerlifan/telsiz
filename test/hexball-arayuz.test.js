'use strict'

// Hexball arayüzü testleri: public/js/46-hexball.js (Takımlar ve sonuç ekranı, maç ekranı, saha tuvali, klavye, oyun
// kolu, dokunmatik çubuk ve Vur düğmesi, oyun veri kanalındaki oturumlar, 'Bağlantı Yok' durumu, güven notu),
// hexball.css, tokens.css saha ve takım belirteçleri (her tema ve modda tanımlı, kontrast yeterli), index.html ve sw.js
// bağlantıları, i18n kapsamı ve marka denetimi (başka bir oyunun adı hiçbir dosyada geçmez).
// Arayüz tarayıcıdaki gibi ortak bir genel ortamda Node vm bağlamında yüklenir: gerçek i18n.js, 01-core.js,
// 02-state-dom.js, masa modülleri (33, 34, 36), 28-bildirim.js ve Hexball modülleri (43, 44, 45, 46). DOM, yayın sahnesi
// ve ses arayüzü test/oyun-ortam.js taklitleridir, tuval bağlamı burada taklit edilir. Ses motoru taklidi masa
// iletilerini (sendGame) ve oyun veri kanalını (openGameLink, sendGameData, onGameData) cihazlar arasında sahte bir
// ağla taşır. Bütün cihazlar aynı sahte saati paylaşır, fizik, ağ ve kural motoru gerçektir.

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { same, stripComments, makeDocument, makeClock, fakeDm, seeded, STAGE_FAKES, NAMES } = require('./oyun-ortam')

const ROOT = path.join(__dirname, '..')
const PUB = path.join(ROOT, 'public')
const read = (...parts) => fs.readFileSync(path.join(...parts), 'utf8')
const HTML = read(PUB, 'index.html')
const SW = read(PUB, 'sw.js')
const I18N_SRC = read(PUB, 'i18n.js')
const CSS = read(PUB, 'css', 'hexball.css')
const TOKENS = read(PUB, 'css', 'tokens.css')
const UI_SRC = read(PUB, 'js', '46-hexball.js')
const HEX_SCRIPTS = ['43-hexball-kural.js', '44-hexball-fizik.js', '45-hexball-ag.js', '46-hexball.js']
const SOURCES = ['01-core.js', '02-state-dom.js', '33-oyun-protokol.js', '34-oyun-masa.js', '36-oyun.js', '28-bildirim.js']
  .concat(HEX_SCRIPTS).map((name) => ({ name, code: read(PUB, 'js', name) }))
// Ağ gecikmesi (ms): masa iletileri flush ile, oyun verisi sahte saatle bu kadar sonra teslim edilir
const LATENCY = 10

// ------------------------------------------------------------------ tokens.css kademesi

// Kök öğedeki belirteçler: :root ile başlayan üst düzey kurallar (@media dışında) özgüllük ve kaynak sırasıyla
// uygulanır, var() başvuruları çözülür. Tema listesi theme-init.js içindedir.
function tokenRules () {
  const css = stripComments(TOKENS)
  const out = []
  let depth = 0
  let start = 0
  let i = 0
  while (i < css.length) {
    const c = css[i]
    if (c === '{') {
      if (depth === 0) {
        const prelude = css.slice(start, i).trim()
        let d = 1
        let j = i + 1
        while (j < css.length && d > 0) {
          if (css[j] === '{') d++
          else if (css[j] === '}') d--
          j++
        }
        if (prelude.charAt(0) !== '@') {
          const decls = {}
          for (const m of css.slice(i + 1, j - 1).matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) decls[m[1]] = m[2].trim()
          out.push({ selectors: prelude.split(',').map((s) => s.trim()), decls })
        }
        i = j
        start = j
        continue
      }
    }
    i++
  }
  return out
}

const RULES = tokenRules()
const SKINS = JSON.parse(read(PUB, 'theme-init.js').match(/const SKINS = (\[[^\]]*\])/)[1].replace(/'/g, '"'))
const SCHEMES = ['dark', 'light']

// Seçicinin kök öğeye uyup uymadığı ve özgüllüğü (öznitelik sayısı), uymuyorsa -1
function rootMatch (selector, attrs) {
  if (selector.indexOf(':root') !== 0) return -1
  const rest = selector.slice(5)
  const parts = rest.match(/\[[a-z-]+="[^"]*"\]/g) || []
  if (parts.join('') !== rest) return -1
  for (const part of parts) {
    const m = part.match(/^\[([a-z-]+)="([^"]*)"\]$/)
    if (attrs[m[1]] !== m[2]) return -1
  }
  return parts.length
}

function cascade (skin, scheme) {
  const attrs = { 'data-skin': skin, 'data-scheme': scheme }
  const hits = []
  RULES.forEach((rule, order) => {
    const spec = Math.max.apply(null, rule.selectors.map((s) => rootMatch(s, attrs)))
    if (spec >= 0) hits.push({ spec, order, decls: rule.decls })
  })
  hits.sort((a, b) => a.spec - b.spec || a.order - b.order)
  const vars = {}
  hits.forEach((h) => Object.assign(vars, h.decls))
  return vars
}

function resolve (vars, name, depth) {
  if ((depth || 0) > 20 || !Object.prototype.hasOwnProperty.call(vars, name)) return null
  return vars[name].replace(/var\((--[a-z0-9-]+)(?:,\s*([^)]+))?\)/g, (m, ref, fallback) => {
    const v = resolve(vars, ref, (depth || 0) + 1)
    return v === null ? (fallback || 'TANIMSIZ') : v
  })
}

function luminance (hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)))
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}

function ratio (a, b) {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

// ------------------------------------------------------------------ tuval, pencere ve ses taklidi

// Tuvalin 2B bağlamı: çizim çağrıları sayılır, dolgu renkleri ve yazılar kaydedilir
function makeContext (canvas) {
  const ctx = {
    canvas,
    fills: [],
    texts: [],
    images: 0,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    fill () { ctx.fills.push(ctx.fillStyle) },
    fillText (text) { ctx.texts.push(String(text)) },
    drawImage () { ctx.images++ }
  }
  for (const name of ['setTransform', 'fillRect', 'beginPath', 'rect', 'clip', 'save', 'restore', 'stroke', 'moveTo', 'lineTo',
    'closePath', 'arc', 'strokeRect']) {
    ctx[name] = () => {}
  }
  return ctx
}

// DOM taklidine tuval, ölçüler ve işaretçi yakalaması eklenir. Tarayıcıdaki gibi işaretçiyi yakalamış öğe DOM'da
// yer değiştirince yakalama düşer (lostpointercapture).
function extendDocument (doc) {
  const proto = Object.getPrototypeOf(doc.body)
  proto.getBoundingClientRect = function () {
    return this.rect || { left: 0, top: 0, width: 0, height: 0 }
  }
  proto.setPointerCapture = function (id) {
    this.captured = id
  }
  const detach = proto.detach
  proto.detach = function (node) {
    if (node.captured !== undefined && node.parentNode) {
      const id = node.captured
      delete node.captured
      node.dispatch('lostpointercapture', { pointerId: id })
    }
    return detach.call(this, node)
  }
  Object.defineProperty(proto, 'clientWidth', { get () { return this.visible() ? 640 : 0 } })
  Object.defineProperty(proto, 'clientHeight', { get () { return this.visible() ? 600 : 0 } })
  const create = doc.createElement
  doc.createElement = (tag) => {
    const node = create(tag)
    if (String(tag).toLowerCase() === 'canvas') {
      node.width = 300
      node.height = 150
      node.contexts = []
      node.getContext = (kind) => {
        if (kind !== '2d') return null
        const ctx = makeContext(node)
        node.contexts.push(ctx)
        return ctx
      }
    }
    return node
  }
  doc.removeEventListener = () => {}
}

// Bir cihaz: kendi vm bağlamı, DOM'u, ses motoru taklidi, gerçek masa ve Hexball modülleri
function makePage (me, net, opts) {
  const o = opts || {}
  const clock = net.clock
  const doc = makeDocument()
  extendDocument(doc)
  class FakeDate extends Date {
    static now () { return clock.now }
  }
  const store = {}
  const sandbox = {
    console: { log () {}, warn () {}, error: (e) => { net.errors.push(e) } },
    document: doc,
    navigator: { languages: [o.lang || 'tr-TR'], language: o.lang || 'tr-TR', userAgent: '', getGamepads: () => sandbox.fakePads },
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
    devicePixelRatio: 2,
    E2EE: { dm: fakeDm },
    nacl: { randomBytes: seeded(Number(me) + net.seed) },
    fakeVoice: {
      snap: { channelId: 3, private: false, joining: false, peers: {} },
      roster: [],
      keys: {},
      blocked: [],
      locked: false,
      settings: { bindings: { ptt: { type: 'key', code: 'KeyV' }, toggleMute: null, toggleDeafen: null } },
      uplink: 5000,
      blockLink: false,
      dropData: false,
      noGameLink: false
    },
    fakePads: [],
    coarse: false,
    winListeners: {},
    netSend: (peerId, p, done) => net.send(me, peerId, p, done),
    netOpen: (peerId) => net.open(me, peerId),
    netClose: (peerId) => net.close(me, peerId),
    netData: (peerId, buf) => net.data(me, peerId, buf)
  }
  sandbox.window = sandbox
  sandbox.self = sandbox
  sandbox.addEventListener = (type, fn) => {
    if (!sandbox.winListeners[type]) sandbox.winListeners[type] = []
    if (sandbox.winListeners[type].indexOf(fn) === -1) sandbox.winListeners[type].push(fn)
  }
  sandbox.removeEventListener = (type, fn) => {
    if (sandbox.winListeners[type]) sandbox.winListeners[type] = sandbox.winListeners[type].filter((f) => f !== fn)
  }
  sandbox.matchMedia = (q) => ({ matches: q === '(pointer: coarse)' && sandbox.coarse === true })
  // Kök öğedeki belirteçler tokens.css kademesinden (tema ve mod kök öğenin özniteliklerinden)
  sandbox.getComputedStyle = () => {
    const root = doc.documentElement
    const vars = cascade(root.getAttribute('data-skin') || 'arcade', root.getAttribute('data-scheme') || 'dark')
    return { fontSize: '16px', getPropertyValue: (name) => resolve(vars, name) || '' }
  }
  vm.createContext(sandbox)
  const run = (code) => vm.runInContext(code, sandbox)
  vm.runInContext(I18N_SRC, sandbox, { filename: 'i18n.js' })
  for (const s of SOURCES) {
    if (o.skip && o.skip.indexOf(s.name) !== -1) continue
    vm.runInContext(s.code, sandbox, { filename: s.name })
  }
  vm.runInContext(STAGE_FAKES, sandbox, { filename: 'sahne-taklidi.js' })
  run(`
    state.me = { id: ${Number(me)} }
    state.inApp = true
    ${Object.keys(NAMES).map((id) => `state.users.set('${id}', { name: '${NAMES[id]}' })`).join('\n')}
    voice = {
      sendGame: (peerId, p, done) => netSend(peerId, p, done),
      settings: () => fakeVoice.settings,
      uplinkEstimate: () => Promise.resolve(fakeVoice.uplink)
    }
    if (!fakeVoice.noGameLink) {
      voice.openGameLink = (peerId) => netOpen(peerId)
      voice.closeGameLink = (peerId) => netClose(peerId)
      voice.sendGameData = (peerId, buf) => netData(peerId, buf)
    }
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
    activity.appendChild(h('ul', 'activity-list'))
    document.body.appendChild(activity)
    el.activity = activity
    el.activityList = activity.firstChild
    const toastNode = h('div', 'toast')
    toastNode.hidden = true
    document.body.appendChild(toastNode)
    el.toast = toastNode
    // Duyurular: 400 ms içinde birleşenler de tek tek kaydedilir
    const spoken = []
    const realAnnounce = gameAnnounce
    gameAnnounce = function (text, assertive) {
      if (text) spoken.push(String(text))
      return realAnnounce(text, assertive)
    }
  `)
  const page = {
    me: String(me),
    peerId: 'p' + me,
    sandbox,
    doc,
    run,
    fake: sandbox.fakeVoice,
    q: (sel) => doc.querySelector(sel),
    qa: (sel) => doc.querySelectorAll(sel),
    key: (k) => doc.querySelector('[data-focus-key="' + k + '"]'),
    press: (k) => {
      const node = doc.querySelector('[data-focus-key="' + k + '"]')
      assert.ok(node, 'düğme yok: ' + k)
      node.click()
    },
    model: () => run('gameModel()'),
    view: () => JSON.parse(JSON.stringify(run('gameModel().view'))),
    stage: () => (doc.getElementById('cast').hidden ? null : doc.getElementById('cast').getAttribute('data-mode')),
    text: (sel) => {
      const node = doc.querySelector(sel)
      return node ? node.textContent : null
    },
    disabled: (k) => {
      const node = doc.querySelector('[data-focus-key="' + k + '"]')
      assert.ok(node, 'düğme yok: ' + k)
      return node.getAttribute('aria-disabled') === 'true'
    },
    spoken: () => run('spoken.slice()'),
    // Pencereye klavye ve işaretçi olayı: dinleyiciler sırayla çağrılır, olay nesnesi döner
    win: (type, extra) => {
      const evt = Object.assign({ type, target: doc.body, defaultPrevented: false, ctrlKey: false, metaKey: false, altKey: false }, extra || {})
      evt.preventDefault = () => { evt.defaultPrevented = true }
      evt.stopPropagation = () => {}
      for (const fn of (sandbox.winListeners[type] || []).slice()) fn(evt)
      return evt
    },
    listening: () => (sandbox.winListeners.keydown || []).length > 0,
    // Ev sahibinin dünyası ya da oyuncunun ara değerli durumu
    frame: () => run('hexballFrameNow()'),
    input: () => JSON.parse(JSON.stringify(run('hexballState.sent'))),
    canvas: () => doc.querySelector('.hex-canvas')
  }
  page.keyDown = (code, key) => page.win('keydown', { code, key: key || code })
  page.keyUp = (code, key) => page.win('keyup', { code, key: key || code })
  net.pages[page.peerId] = page
  return page
}

// Sahte ağ: masa iletileri kuyruğa yazılır, flush teslim eder. Oyun bağı ve oyun verisi sahte saatle LATENCY ms
// sonra karşı tarafa ulaşır. blockLink bağı açılmadan düşürür (link-failed), dropData gelen oyun verisini atar (oyun
// verisini almayan eski istemci).
function makeNet (seed) {
  const net = { pages: {}, queue: [], errors: [], clock: makeClock(), seed: seed || 1, links: {} }
  net.send = (fromId, peerId, p, done) => {
    if (!net.pages[peerId]) return 'no_peer'
    net.queue.push({ from: 'p' + fromId, fromId: String(fromId), to: peerId, p, done })
    return 'ok'
  }
  net.flush = () => {
    let guard = 0
    while (net.queue.length && guard < 400) {
      guard++
      const m = net.queue.shift()
      const target = net.pages[m.to]
      target.sandbox.gameOnVoiceEvent({ type: 'message', peerId: m.from, userId: m.fromId, p: m.p })
      if (typeof m.done === 'function') m.done(true)
    }
  }
  const pair = (a, b) => [a, b].sort().join('|')
  net.open = (fromId, peerId) => {
    const target = net.pages[peerId]
    if (!target) return 'no_peer'
    const from = 'p' + fromId
    const k = pair(from, peerId)
    if (net.links[k] === 'open') return 'open'
    if (net.links[k] === 'connecting') return 'ok'
    net.links[k] = 'connecting'
    net.clock.add(() => {
      if (net.links[k] !== 'connecting') return
      const source = net.pages[from]
      if (source.fake.blockLink || target.fake.blockLink) {
        delete net.links[k]
        source.sandbox.gameOnVoiceEvent({ type: 'link-failed', peerId, userId: target.me })
        return
      }
      net.links[k] = 'open'
      source.sandbox.gameOnVoiceEvent({ type: 'link-open', peerId, userId: target.me })
      target.sandbox.gameOnVoiceEvent({ type: 'link-open', peerId: from, userId: String(fromId) })
    }, LATENCY)
    return 'ok'
  }
  net.close = (fromId, peerId) => {
    delete net.links[pair('p' + fromId, peerId)]
  }
  net.data = (fromId, peerId, buf) => {
    const from = 'p' + fromId
    const k = pair(from, peerId)
    if (net.links[k] !== 'open') return false
    const copy = buf.slice(0)
    net.clock.add(() => {
      const target = net.pages[peerId]
      if (!target || target.fake.dropData || net.links[k] !== 'open') return
      target.sandbox.gameOnData(from, String(fromId), copy)
    }, LATENCY)
    return true
  }
  // Saat ilerler, arada masa iletileri teslim edilir
  net.advance = (ms, step) => {
    const each = step || 50
    let left = ms
    while (left > 0) {
      const d = Math.min(each, left)
      net.clock.advance(d)
      net.flush()
      left -= d
    }
  }
  // Koşul doğru olana kadar (en çok limit ms) saat ilerler
  net.until = (fn, limit, label) => {
    let waited = 0
    while (!fn()) {
      assert.ok(waited < (limit || 20000), 'beklenen durum gelmedi: ' + (label || ''))
      net.advance(50)
      waited += 50
    }
    return waited
  }
  return net
}

// Aynı ses odasındaki kişiler. opts.page[id] o kişinin makePage seçenekleri.
function makeWorld (ids, opts) {
  const o = opts || {}
  const net = makeNet(o.seed)
  const pages = ids.map((id) => makePage(id, net, (o.page && o.page[id]) || {}))
  for (const page of pages) {
    page.fake.roster = ids.map((id) => ({ userId: Number(id) }))
    for (const other of pages) {
      if (other !== page) page.fake.snap.peers[other.me] = { peerId: other.peerId, status: 'connected' }
    }
    page.run('gameRender()')
  }
  return { net, pages }
}

// Ev sahibi masayı kurar (kural seti rules), herkes katılır, ev sahibi başlatır: masa Takımlar aşamasında
function openTable (rules, world) {
  const { net, pages } = world
  const host = pages[0]
  host.press('tool-game')
  assert.equal(host.model().stage, 'setup')
  if (rules) host.press('game-rule-' + rules)
  host.press('game-open')
  net.flush()
  for (const page of pages.slice(1)) {
    page.press('tool-game')
    page.press('game-join')
    net.flush()
  }
  host.press('game-start')
  net.flush()
  for (const page of pages) assert.equal(page.model().stage, 'play', page.me)
  assert.equal(host.view().ph, 'teams')
}

// Takımlar aşamasında bağlar hazır olur (el sıkışma)
function linksReady (world) {
  const host = world.pages[0]
  world.net.until(() => {
    const links = host.run('hexballLinks()')
    return world.pages.slice(1).every((p) => links[p.me] === 'ready')
  }, 5000, 'bağlar hazır')
}

// Maçı başlatır, iki tarafta maç ekranı çizilir
function kickoff (world) {
  const host = world.pages[0]
  assert.equal(host.disabled('hex-kickoff'), false)
  host.press('hex-kickoff')
  world.net.flush()
  for (const page of world.pages) assert.equal(page.view().ph, 'match', page.me)
  world.net.advance(200)
}

const slotOf = (page, id) => page.view().slots[id]
const discOf = (frame, slot) => frame.players.filter((p) => p.slot === slot)[0]

// ------------------------------------------------------------------ bağlantılar, stiller ve belirteçler

describe('bağlantılar, stiller ve belirteçler', () => {
  test('index.html hexball.css dosyasını renk.css ile tema dosyaları arasında, betikleri 37-renk.js satırından sonra numara sırasıyla bir kez yükler', () => {
    const count = (text, part) => text.split(part).length - 1
    const css = '<link rel="stylesheet" href="/css/hexball.css">'
    assert.equal(count(HTML, css), 1)
    assert.ok(HTML.indexOf(css) > HTML.indexOf('href="/css/renk.css"'))
    assert.ok(HTML.indexOf(css) < HTML.indexOf('href="/css/skins/arcade.css"'))
    let prev = HTML.indexOf('<script src="/js/37-renk.js" defer></script>')
    assert.ok(prev > 0)
    for (const name of HEX_SCRIPTS) {
      const tag = '<script src="/js/' + name + '" defer></script>'
      assert.equal(count(HTML, tag), 1, name)
      assert.ok(HTML.indexOf(tag) > prev, 'sıra ' + name)
      prev = HTML.indexOf(tag)
    }
    assert.ok(prev < HTML.indexOf('</head>'))
    // Numara sırası: index.html'deki bütün betikler artan numarayla
    const nums = Array.from(HTML.matchAll(/<script src="\/js\/(\d+)-[a-z-]+\.js" defer><\/script>/g)).map((m) => Number(m[1]))
    same(nums.slice().sort((a, b) => a - b), nums)
  })

  test('sw.js kabuğu hexball.css dosyasını ve dört betiği numara sırasıyla önbelleğe alır', () => {
    assert.ok(SW.indexOf("'/css/hexball.css',") > SW.indexOf("'/css/renk.css',"))
    let prev = SW.indexOf("'/js/37-renk.js',")
    for (const name of HEX_SCRIPTS) {
      const at = SW.indexOf("'/js/" + name + "',")
      assert.ok(at > prev, name)
      prev = at
    }
  })

  test('hexball.css yalnızca belirteçlerle ve eski WebKit kurallarıyla yazılır, tuval ve dokunmatik denetimler sayfayı kaydırmaz', () => {
    const css = stripComments(CSS)
    assert.ok(!/(^|[\s{;])(row-|column-)?gap\s*:|clamp\(|:is\(|:where\(|aspect-ratio|(^|[\s{;])inset\s*:|display:\s*(inline-)?grid/.test(css), 'yasak özellik')
    same(css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g) || [], [], 'renkler yalnızca var(--...) ile')
    for (const m of css.matchAll(/z-index:\s*(\d+)/g)) assert.ok(Number(m[1]) <= 3, 'z-index ' + m[1])
    for (const m of css.replace(/@media[^{]*/g, '').matchAll(/(\d*\.?\d+)px/g)) assert.equal(m[1], '1', m[0])
    for (const sel of ['.hex-canvas', '.hex-stick', '.hex-kick']) {
      const i = css.indexOf('\n' + sel + ' {')
      assert.ok(i !== -1, sel)
      assert.match(css.slice(i, css.indexOf('}', i)), /touch-action: none;/, sel)
    }
    // Gizlenen dokunmatik denetim yer kaplamaz (display: flex hidden özniteliğini ezmez)
    assert.match(css, /\.hex-touch\[hidden\] \{\s*display: none;/)
    // Kullanılan bütün sınıflar arayüzde üretilir
    for (const m of new Set(Array.from(css.matchAll(/\.(hex-[a-z-]+)/g)).map((x) => x[1]))) {
      assert.ok(UI_SRC.indexOf("'" + m) !== -1 || UI_SRC.indexOf(' ' + m) !== -1, 'arayüzde yok: ' + m)
    }
  })

  test('tuvalin okuduğu --hex-* belirteçleri ve hexball.css içindeki her belirteç her tema ve modda çözülür', () => {
    const names = Array.from(UI_SRC.match(/const HEXBALL_COLOR_TOKENS = \{([\s\S]*?)\n\}/)[1].matchAll(/'(--[a-z-]+)'/g)).map((m) => m[1])
    assert.ok(names.length >= 14, names.join(','))
    const used = new Set(Array.from(stripComments(CSS).matchAll(/var\((--[a-z0-9-]+)\)/g)).map((m) => m[1]))
    assert.ok(used.has('--hex-red') && used.has('--hex-blue') && used.has('--hex-ink'))
    assert.ok(SKINS.length >= 3 && SKINS[0] === 'arcade', SKINS.join(','))
    for (const skin of SKINS) {
      for (const scheme of SCHEMES) {
        const vars = cascade(skin, scheme)
        for (const name of names.concat(Array.from(used))) {
          const v = resolve(vars, name)
          assert.ok(v && v.indexOf('TANIMSIZ') === -1, skin + ' ' + scheme + ': ' + name)
        }
      }
    }
  })

  test('kontrast: takım rengi ve yazı 4.5:1, sahadaki çizimler sahayla 3:1 üstünde (her tema ve modda)', () => {
    const below = []
    for (const skin of SKINS) {
      for (const scheme of SCHEMES) {
        const vars = cascade(skin, scheme)
        const c = (name) => {
          const v = resolve(vars, '--hex-' + name)
          assert.match(v, /^#[0-9a-f]{6}$/, skin + ' ' + scheme + ' --hex-' + name)
          return v
        }
        const check = (label, value, limit) => {
          if (!(value >= limit)) below.push(skin + ' ' + scheme + ' ' + label + ' ' + value.toFixed(2))
        }
        check('ink/red', ratio(c('ink'), c('red')), 4.5)
        check('ink/blue', ratio(c('ink'), c('blue')), 4.5)
        const field = c('field')
        for (const name of ['line', 'post', 'me', 'kick']) check(name + '/field', ratio(c(name), field), 3)
        check('line/out', ratio(c('line'), c('out')), 3)
        // Disk ve top: dolgu ya da kenarından biri sahadan ayrışır
        for (const team of ['red', 'blue']) check(team + ' disk', Math.max(ratio(c(team), field), ratio(c('disc-edge'), field)), 3)
        check('top', Math.max(ratio(c('ball'), field), ratio(c('ball-edge'), field)), 3)
        check('top kenarı/top', ratio(c('ball-edge'), c('ball')), 3)
      }
    }
    same(below, [], 'eşik altındaki çiftler')
  })

  test('tokens.css: saha ve takım belirteçleri ortak koyu ve açık blokta, kart belirteçleri bloğu en sonda kalır', () => {
    const css = TOKENS.replace(/\r\n/g, '\n')
    const at = css.indexOf('\n  --hex-field:')
    assert.ok(at !== -1)
    assert.ok(at < css.lastIndexOf('\n:root {'), 'kart oyunlarının :root bloğu Hexball bloğundan sonra')
    assert.ok(css.lastIndexOf('\n  --hex-field:') < css.indexOf('\n  --card-edge:'))
  })
})

// ------------------------------------------------------------------ i18n ve marka adı

function loadI18n () {
  const sandbox = vm.createContext({})
  sandbox.window = sandbox
  sandbox.localStorage = { getItem: () => null, setItem () {}, removeItem () {} }
  sandbox.navigator = { languages: ['tr-TR'], language: 'tr-TR' }
  sandbox.document = { documentElement: { lang: 'tr' }, readyState: 'loading', querySelectorAll: () => [] }
  sandbox.console = { warn () {}, log () {}, error () {} }
  vm.runInContext(I18N_SRC, sandbox, { filename: 'i18n.js' })
  return sandbox.I18N
}

function loadEngine () {
  const sandbox = { console }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  for (const name of ['33-oyun-protokol.js', '43-hexball-kural.js', '44-hexball-fizik.js']) vm.runInContext(read(PUB, 'js', name), sandbox)
  return { H: sandbox.TelsizHexball, P: sandbox.TelsizHexballPhysics }
}

// Metin dosyaları: depo kökünden, bağımlılıklar, git ve derleme çıktıları dışında
function textFiles () {
  const skip = new Set(['node_modules', '.git', 'dist'])
  const generated = [path.join(ROOT, 'desktop', 'app'), path.join(ROOT, 'desktop', 'dist')]
  const binary = /\.(png|jpe?g|gif|webp|ico|bmp|avif|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|mp3|ogg|wav|mp4|webm|wasm)$/i
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!skip.has(entry.name) && generated.indexOf(full) === -1) walk(full)
      } else if (entry.isFile() && !binary.test(entry.name)) {
        out.push(full)
      }
    }
  }
  walk(ROOT)
  return out
}

describe('i18n ve marka adı', () => {
  test('game.hexball.* anahtarları iki sözlükte aynı sırada, plandaki çekirdek metinler ve düğme etiketleri', () => {
    const I = loadI18n()
    const keys = (lang) => Object.keys(I.messages[lang]).filter((k) => k.indexOf('game.hexball.') === 0)
    same(keys('tr'), keys('en'))
    assert.ok(keys('tr').length >= 60, String(keys('tr').length))
    const expect = {
      tr: { name: 'Hexball', 'team.red': 'Kırmızı', 'team.blue': 'Mavi', 'team.spec': 'İzleyici', kickoff: 'Maçı Başlat', again: 'Tekrar Oyna', toLobby: 'Lobiye Dön', golden: 'Altın gol', 'link.waiting': 'Bağlantı bekleniyor', 'link.failed': 'Bağlantı Yok', kick: 'Vur', trustHost: 'Fiziği ev sahibi hesaplar, ev sahibi hile yapabilir.', desc: 'Ses odasındakilerle üstten görünümlü gerçek zamanlı futbol.', paused: 'Ev sahibinin sekmesi arka planda, maç duraklatıldı.' },
      en: { name: 'Hexball', 'team.red': 'Red', 'team.blue': 'Blue', 'team.spec': 'Spectator', kickoff: 'Start Match', again: 'Play Again', toLobby: 'Back to Lobby', golden: 'Golden goal', 'link.waiting': 'Waiting for connection', 'link.failed': 'No Connection', kick: 'Kick', trustHost: 'The host runs the physics and could cheat.', desc: 'Real-time top-down football with your voice room.', paused: 'The host\'s tab is in the background, the match is paused.' }
    }
    // Düğme etiketlerinde her kelime büyük harfle başlar
    const buttons = ['kickoff', 'again', 'toLobby', 'stop', 'confirmStop', 'kick', 'to.red', 'to.blue', 'to.spec', 'set.red', 'set.blue', 'set.spec', 'link.failed', 'lag', 'ph.result']
    for (const lang of ['tr', 'en']) {
      I.setLang(lang)
      for (const [k, v] of Object.entries(expect[lang])) assert.equal(I.t('game.hexball.' + k), v, lang + ': ' + k)
      for (const k of buttons) {
        const words = I.t('game.hexball.' + k).split(' ').filter((w) => !/^(to|for|of|the|a)$/.test(w))
        for (const w of words) assert.equal(w.charAt(0), w.charAt(0).toLocaleUpperCase(lang), lang + ': ' + k + ' = ' + I.t('game.hexball.' + k))
      }
    }
  })

  test('kural motorunun ön ayarları, takımları, hata kodları, olayları ve sonuç nedenleri iki dilde metne çevrilir', () => {
    const I = loadI18n()
    const { H } = loadEngine()
    const page = makePage('5', makeNet())
    for (const lang of ['tr', 'en']) {
      I.setLang(lang)
      page.run(`I18N.setLang('${lang}')`)
      const ok = (key, params) => {
        const text = I.t(key, params || { name: 'Ece', team: 'X', red: 1, blue: 2, mt: 3, names: 'Ece', label: 'L' })
        assert.ok(I.has(key) && text && text.indexOf('{') === -1, lang + ': ' + key)
      }
      for (const r of H.RULES) ['rules.', 'rulesHint.', 'rulesLine.'].forEach((p) => ok('game.hexball.' + p + r))
      for (const s of H.SIDES) ['team.', 'to.', 'set.', 'ev.team.'].forEach((p) => ok('game.hexball.' + p + s))
      for (const s of H.TEAMS) ok('game.hexball.letter.' + s)
      const why = JSON.parse(read(PUB, 'js', '43-hexball-kural.js').match(/const WHY = (\[[^\]]*\])/)[1].replace(/'/g, '"'))
      assert.ok(why.length >= 5, why.join(','))
      for (const w of why) ok('game.hexball.why.' + w)
      for (const code of H.ERRORS) ok('game.hexball.err.' + code)
      // Gösterilen hata kodları metin verir, diğerleri sessizdir (gelen yeni durum arayüzü düzeltir)
      const shown = ['team_full', 'teams_empty', 'not_host', 'bad_random', 'no_random']
      for (const code of H.ERRORS) {
        const text = page.run(`gameErrorText('${code}', 'hexball')`)
        if (shown.indexOf(code) >= 0) assert.equal(text, I.t('game.hexball.err.' + code), lang + ': ' + code)
        else assert.equal(text, '', lang + ': ' + code)
      }
      // Her olay kodu duyurulur, ayrılan kişiyi masa yöneticisi duyurur
      const sample = {
        team: { e: 'team', p: '12', side: 'blue' },
        kickoff: { e: 'kickoff', mt: 1, kick: 'red' },
        goal: { e: 'goal', side: 'red', p: '12', at: 3 },
        own_goal: { e: 'own_goal', side: 'red', p: '12', at: 3 },
        time_up: { e: 'time_up' },
        golden: { e: 'golden' },
        win: { e: 'win', side: 'blue', why: 'score' },
        stop: { e: 'stop', why: 'host' },
        leave: { e: 'leave', p: '12' }
      }
      same(Object.keys(sample).sort(), H.EVENTS.slice().sort())
      const view = { score: { red: 1, blue: 0 } }
      for (const ev of Object.values(sample)) {
        const text = page.run('hexballEventText(' + JSON.stringify(ev) + ', { view: ' + JSON.stringify(view) + ' })')
        if (ev.e === 'leave') assert.equal(text, '')
        else assert.ok(text && text.indexOf('{') === -1 && text.indexOf('game.') === -1, lang + ': ' + ev.e + ' ' + text)
      }
    }
    page.run("I18N.setLang('tr')")
    assert.equal(page.run('hexballEventText({ e: "goal", side: "red", p: "12", at: 3 }, { view: { score: { red: 1, blue: 0 } } })'), 'Gol: Ece (Kırmızı). Skor: Kırmızı 1, Mavi 0.')
    assert.equal(page.run('hexballEventText({ e: "goal", side: "blue", p: null, at: 3 }, null)'), 'Gol: Mavi.')
  })

  test('oyunun adı yalnızca i18n sözlüğünde, kodda ve stillerde ad metni yok', () => {
    const name = /\bHexball\b/
    for (const file of HEX_SCRIPTS.map((n) => path.join(PUB, 'js', n)).concat([path.join(PUB, 'js', '36-oyun.js'), path.join(PUB, 'css', 'hexball.css'), path.join(PUB, 'index.html')])) {
      const code = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '')
      assert.ok(!name.test(code), path.relative(ROOT, file))
    }
    const I = loadI18n()
    assert.equal(I.messages.tr['game.hexball.name'], 'Hexball')
    assert.equal(I.messages.en['game.hexball.name'], 'Hexball')
  })

  test('marka denetimi: başka bir oyunun adı hiçbir dosyada ve i18n değerinde geçmez', () => {
    // Ad karakter kodlarıyla kurulur, bu dosyanın kendisi de taranır
    const brand = new RegExp(String.fromCharCode(104, 97, 120) + '[\\s_.-]*' + String.fromCharCode(98, 97, 108, 108), 'i')
    const files = textFiles()
    assert.ok(files.length > 200, String(files.length))
    for (const rel of ['test/hexball-arayuz.test.js', 'public/js/46-hexball.js', 'public/css/hexball.css', 'public/i18n.js', 'README.md']) {
      assert.ok(files.indexOf(path.join(ROOT, rel)) !== -1, rel)
    }
    const hits = files.filter((file) => brand.test(fs.readFileSync(file, 'utf8')))
    same(hits.map((f) => path.relative(ROOT, f)), [])
    const I = loadI18n()
    for (const lang of ['tr', 'en']) {
      for (const [key, value] of Object.entries(I.messages[lang])) assert.ok(!brand.test(key + ' ' + value), lang + ': ' + key)
    }
  })
})

// ------------------------------------------------------------------ masa ve maç

describe('Masa Kur, Takımlar ve güven notu', () => {
  test('yalnızca Hexball kayıtlıyken Oyun düğmesi Masa Kur ekranını açar, ön ayarlar ve güven notu Masa Kur, davet ve Ayrıntı bölümünde', () => {
    const world = makeWorld(['5', '12'])
    const [deniz, ece] = world.pages
    deniz.press('tool-game')
    assert.equal(deniz.model().stage, 'setup')
    assert.equal(deniz.model().app, 'hexball')
    assert.equal(deniz.text('.cast-sub'), 'Ses odasındakilerle üstten görünümlü gerçek zamanlı futbol.')
    same(Array.from(deniz.qa('.game-rules [role="radio"]')).map((b) => [b.getAttribute('data-value'), b.getAttribute('aria-checked'), b.textContent]),
      [['quick', 'false', 'Hızlı'], ['classic', 'true', 'Klasik'], ['long', 'false', 'Uzun']])
    const host = 'Ev sahibi sizsiniz. Oyunu bu cihaz yürütür ve masadaki her şeyi teknik olarak bilir. Oyunculara bu durum yazılır. Fiziği ev sahibi hesaplar, ev sahibi hile yapabilir.'
    assert.equal(deniz.text('.game-trust'), host)
    deniz.press('game-rule-quick')
    deniz.press('game-open')
    world.net.flush()
    assert.equal(deniz.text('.game-trust'), host)
    ece.press('tool-game')
    assert.equal(ece.text('.game-trust'), 'Ev sahibi Deniz. Oyunu onun cihazı yürütür ve masadaki her şeyi teknik olarak bilir. Fiziği ev sahibi hesaplar, ev sahibi hile yapabilir.')
    ece.press('game-join')
    world.net.flush()
    deniz.press('game-start')
    world.net.flush()
    assert.equal(ece.text('.cast-sub'), 'Hızlı Maç · Ev Sahibi Deniz · 2 Oyuncu')
    ece.press('game-trust-more')
    const detail = Array.from(ece.qa('.game-trust-detail .game-trust-text')).map((p) => p.textContent)
    assert.equal(detail[0], 'Ev sahibi Deniz. Oyunu onun cihazı yürütür ve masadaki her şeyi teknik olarak bilir. Fiziği ev sahibi hesaplar, ev sahibi hile yapabilir.')
    assert.ok(detail.indexOf('Gerçek zamanlı maç ekran okuyucuyla oynanamaz. Goller, skor ve sonuç duyurulur.') > 0)
    assert.ok(detail.indexOf('Oklar veya WASD ile hareket, X veya Boşluk ile vuruş.') > 0)
    assert.equal(world.net.errors.length, 0, String(world.net.errors[0]))
  })

  test('Takımlar: koltuklar sırayla Kırmızı ve Mavi, bağ el sıkışmayla hazır olunca Maçı Başlat etkin, takım değiştirme ve atama', () => {
    const world = makeWorld(['5', '12', '7'])
    const [deniz, ece, mert] = world.pages
    openTable('quick', world)
    assert.equal(deniz.text('.game-status-chip'), 'Takımlar')
    const column = (page, side) => Array.from(page.qa('.hex-team[data-side="' + side + '"] .hex-person')).map((li) => li.getAttribute('data-user-id'))
    same(column(deniz, 'red'), ['5', '7'])
    same(column(deniz, 'blue'), ['12'])
    same(column(deniz, 'spec'), [])
    assert.equal(deniz.text('.hex-team[data-side="red"] .hex-team-count'), '2/4')
    assert.equal(deniz.text('.hex-team[data-side="spec"] .hex-empty'), 'Henüz kimse yok.')
    // Takım harfi ve numarası: K1, K2, M1
    same(Array.from(deniz.qa('.hex-person .hex-badge')).map((b) => b.textContent), ['K1', 'K2', 'M1'])
    assert.equal(ece.text('.hex-mine'), 'Takımınız: Mavi')
    // El sıkışmadan önce bağ bekleniyor, Maçı Başlat pasif
    assert.equal(deniz.disabled('hex-kickoff'), true)
    assert.equal(deniz.text('.hex-person[data-user-id="12"] .hex-chip'), 'Bağlantı bekleniyor')
    assert.equal(ece.text('.hex-link .game-note-text'), 'Ev sahibiyle oyun bağlantısı kuruluyor.')
    assert.match(deniz.text('.hex-not-ready'), /^Oyun bağlantısı bekleniyor: (Ece, Mert|Mert, Ece)$/)
    linksReady(world)
    world.net.advance(300)
    assert.equal(deniz.q('.hex-chip'), null)
    assert.equal(deniz.q('.hex-not-ready'), null)
    assert.equal(ece.q('.hex-link'), null)
    assert.equal(deniz.disabled('hex-kickoff'), false)
    // Oyuncu yalnızca kendi takımını değiştirir, atama düğmeleri ev sahibindedir
    assert.equal(ece.q('.hex-set'), null)
    assert.equal(ece.key('hex-kickoff'), null)
    assert.equal(ece.text('.game-wait .game-note-text'), 'Ev sahibinin maçı başlatması bekleniyor.')
    same(Array.from(ece.qa('.hex-join')).map((b) => b.textContent), ['Kırmızıya Geç', 'İzleyici Ol'])
    ece.press('hex-join-spec')
    world.net.flush()
    same(column(deniz, 'spec'), ['12'])
    assert.equal(ece.text('.hex-mine'), 'Maçı izliyorsunuz.')
    // Mavi boşaldı: Maçı Başlat pasif ve nedeni yazar
    assert.equal(deniz.disabled('hex-kickoff'), true)
    assert.equal(deniz.text('.game-hint .game-note-text'), 'Maçı başlatmak için her takımda en az bir kişi olmalı.')
    const set = deniz.key('hex-set-7-blue')
    assert.equal(set.textContent, 'Maviye Al')
    assert.equal(set.getAttribute('aria-label'), 'Maviye Al: Mert')
    deniz.press('hex-set-7-blue')
    world.net.flush()
    same(column(mert, 'blue'), ['7'])
    assert.equal(mert.text('.hex-mine'), 'Takımınız: Mavi')
    assert.equal(deniz.disabled('hex-kickoff'), false)
    assert.ok(mert.spoken().indexOf('Mert Mavi takımda.') !== -1, mert.spoken().join(' | '))
    assert.equal(world.net.errors.length, 0, String(world.net.errors[0]))
  })
})

describe('maç: tuval, girdi, gol ve sonuç', () => {
  test('maç ekranı: skor tablosu, saat, saha tuvali belirteç renkleriyle çizilir, oyun kolu bandı değiştirmez', () => {
    const world = makeWorld(['5', '12', '7'])
    const [deniz, ece, mert] = world.pages
    openTable('quick', world)
    ece.press('hex-join-spec')
    world.net.flush()
    deniz.press('hex-set-7-blue')
    world.net.flush()
    linksReady(world)
    // Takımlar ekranında kol bandındır
    assert.equal(mert.run('gameOwnsPad()'), false)
    kickoff(world)
    for (const page of world.pages) {
      assert.equal(page.q('.hex-table').getAttribute('data-ph'), 'match')
      assert.equal(page.text('.game-status-chip'), '1. Maç')
      same(Array.from(page.qa('.hex-board-team')).map((t) => [t.getAttribute('data-side'), t.querySelector('.hex-badge').textContent, t.querySelector('.hex-board-name').textContent]),
        [['red', 'K', 'Kırmızı'], ['blue', 'M', 'Mavi']])
      assert.equal(page.text('.hex-clock'), '03:00')
      assert.equal(page.q('.hex-clock').getAttribute('role'), 'timer')
      assert.equal(page.canvas().getAttribute('role'), 'img')
      assert.equal(page.canvas().getAttribute('aria-label'), 'Saha. Kırmızı 0, Mavi 0.')
    }
    // Başlama vuruşunu Kırmızı yapar (1. maç)
    assert.equal(mert.text('.hex-overlay'), 'Başlama vuruşu: Kırmızı')
    assert.equal(mert.q('.hex-overlay').getAttribute('data-kind'), 'kickoff')
    // Tuval sahaya sığar (devicePixelRatio 2), saha katmanı ayrı tuvalde bir kez çizilir
    const canvas = deniz.canvas()
    assert.equal(canvas.style.width, '640px')
    assert.equal(canvas.width, 1280)
    const ctx = canvas.contexts[0]
    assert.ok(ctx.images > 10, 'saha katmanı her karede kopyalanır: ' + ctx.images)
    // Diskler takım rengi, top beyaz, disklerde takım harfi ve numarası
    assert.ok(ctx.fills.indexOf('#c9303f') !== -1 && ctx.fills.indexOf('#2d5fd3') !== -1 && ctx.fills.indexOf('#ffffff') !== -1, ctx.fills.slice(-6).join(','))
    assert.ok(ctx.texts.indexOf('K1') !== -1 && ctx.texts.indexOf('M1') !== -1, ctx.texts.slice(-4).join(','))
    // Açık modda belirteçler yeniden okunur
    deniz.doc.documentElement.setAttribute('data-scheme', 'light')
    world.net.advance(100)
    assert.equal(deniz.run('hexballColors().field'), '#d6efe2')
    assert.equal(deniz.run('hexballColors().red'), '#c9303f')
    // İzleyicide tuşlar ve kol oyunun değildir
    assert.equal(ece.q('.hex-help-role').textContent, 'Maçı izliyorsunuz.')
    assert.equal(ece.listening(), false)
    assert.equal(ece.run('gameOwnsPad()'), false)
    assert.equal(mert.listening(), true)
    assert.equal(mert.run('gameOwnsPad()'), true)
    assert.equal(deniz.run('gameOwnsPad()'), true)
    assert.equal(mert.text('.hex-help-role'), 'Mavi takımında oynuyorsunuz.')
    assert.equal(mert.text('.hex-help-keys'), ' Oklar veya WASD ile hareket, X veya Boşluk ile vuruş.')
    // Ev sahibi maçı durdurabilir (onay satırıyla), oyuncu durduramaz
    assert.equal(mert.key('hex-stop'), null)
    assert.ok(deniz.key('hex-stop'))
    assert.equal(world.net.errors.length, 0, String(world.net.errors[0]))
  })

  test('klavye: oyuncunun tuşları veri kanalından ev sahibinin dünyasına ulaşır, ses ataması ve modlu tuşlar oyunun değildir', () => {
    const world = makeWorld(['5', '12'])
    const [deniz, ece] = world.pages
    openTable('quick', world)
    linksReady(world)
    kickoff(world)
    const slot = slotOf(deniz, '12')
    const start = discOf(deniz.frame(), slot)
    const down = ece.keyDown('ArrowUp')
    assert.equal(down.defaultPrevented, true, 'oklar sayfayı kaydırmaz')
    same(ece.input(), { x: 0, y: -1, kick: false })
    world.net.advance(600)
    const moved = discOf(deniz.frame(), slot)
    assert.ok(moved.y < start.y - 20, start.y + ' -> ' + moved.y)
    // Oyuncunun ara değerli görüntüsü de aynı yöne gider
    assert.ok(discOf(ece.frame(), slot).y < start.y - 10)
    ece.keyUp('ArrowUp')
    same(ece.input(), { x: 0, y: 0, kick: false })
    // WASD ve vuruş tuşları, çapraz girdi
    ece.keyDown('KeyD', 'd')
    ece.keyDown('KeyS', 's')
    ece.keyDown('Space', ' ')
    same(ece.input(), { x: 1, y: 1, kick: true })
    ece.keyUp('Space', ' ')
    ece.keyDown('KeyX', 'x')
    same(ece.input(), { x: 1, y: 1, kick: true })
    world.net.advance(100)
    // Vuruş tutulurken diskin bayrağı ev sahibinden gelir (dış halka çizilir)
    assert.equal(discOf(ece.frame(), slot).kick, true)
    for (const code of ['KeyD', 'KeyS', 'KeyX']) ece.keyUp(code)
    same(ece.input(), { x: 0, y: 0, kick: false })
    // Bas konuş tuşu (V) ve modlu tuşlar engellenmez
    const ptt = ece.keyDown('KeyV', 'v')
    assert.equal(ptt.defaultPrevented, false)
    ece.fake.settings.bindings.ptt = { type: 'key', code: 'KeyW' }
    assert.equal(ece.keyDown('KeyW', 'w').defaultPrevented, false, 'bas konuşa atanan W oyunda kullanılmaz')
    same(ece.input(), { x: 0, y: 0, kick: false })
    assert.equal(ece.win('keydown', { code: 'ArrowLeft', key: 'ArrowLeft', ctrlKey: true }).defaultPrevented, false)
    // Yazı alanında ve açık pencerede tuşlar dinlenmez
    ece.run("isTypingTarget = (node) => Boolean(node && node.tagName === 'INPUT')")
    assert.equal(ece.win('keydown', { code: 'ArrowLeft', key: 'ArrowLeft', target: ece.doc.createElement('input') }).defaultPrevented, false)
    ece.run("layers.push({ name: 'settings', el: document.body })")
    assert.equal(ece.keyDown('ArrowLeft').defaultPrevented, false)
    ece.run('layers.length = 0')
    ece.run("layers.push({ name: 'cast-full', el: document.body })")
    assert.equal(ece.keyDown('ArrowLeft').defaultPrevented, true, 'tam ekranda oynanır')
    same(ece.input(), { x: -1, y: 0, kick: false })
    // Pencere odağı gidince denetimler bırakılır
    ece.win('blur')
    same(ece.input(), { x: 0, y: 0, kick: false })
    ece.run('layers.length = 0')
    // Sahne küçültülünce tuşlar bırakılır, maç sürer
    ece.press('tool-game')
    assert.equal(ece.stage(), null)
    world.net.advance(100)
    assert.equal(ece.listening(), false)
    assert.equal(ece.run('gameOwnsPad()'), false)
    assert.ok(ece.run('hexballState.player') !== null, 'oyuncu oturumu sürer')
    assert.equal(world.net.errors.length, 0, String(world.net.errors[0]))
  })

  test('gol, skor ve duyuru iki tarafta, Maçı Durdur ile sonuç ekranı, Tekrar Oyna ve Lobiye Dön', () => {
    const world = makeWorld(['5', '12'])
    const [deniz, ece] = world.pages
    openTable('quick', world)
    linksReady(world)
    kickoff(world)
    // Deniz (Kırmızı) topu sağdaki kaleye sürer, Ece (Mavi) yoldan çekilir
    deniz.keyDown('ArrowRight')
    ece.keyDown('ArrowUp')
    world.net.until(() => deniz.view().score.red === 1, 15000, 'gol')
    world.net.advance(100)
    same(deniz.view().goals.map((g) => [g.side, g.by, g.own]), [['red', '5', false]])
    for (const page of world.pages) {
      assert.equal(page.text('.hex-board-team[data-side="red"] .hex-board-score'), '1')
      assert.equal(page.text('.hex-board-team[data-side="blue"] .hex-board-score'), '0')
      assert.equal(page.canvas().getAttribute('aria-label'), 'Saha. Kırmızı 1, Mavi 0.')
      assert.ok(page.spoken().indexOf('Gol: Deniz (Kırmızı). Skor: Kırmızı 1, Mavi 0.') !== -1, page.spoken().join(' | '))
    }
    assert.equal(ece.q('.hex-overlay').getAttribute('data-kind'), 'goal')
    assert.equal(ece.text('.hex-overlay'), 'Gol! Deniz')
    deniz.keyUp('ArrowRight')
    ece.keyUp('ArrowUp')
    // Maçı Durdur onay satırıyla
    deniz.press('hex-stop')
    assert.equal(deniz.text('#hex-stop-text'), 'Maç kazanansız bitsin mi?')
    assert.equal(deniz.run('document.activeElement').getAttribute('data-focus-key'), 'hex-stop-no')
    deniz.press('hex-stop-no')
    assert.ok(deniz.key('hex-stop'))
    deniz.press('hex-stop')
    deniz.press('hex-stop-yes')
    world.net.flush()
    world.net.advance(100)
    for (const page of world.pages) {
      assert.equal(page.view().ph, 'result')
      assert.equal(page.q('.hex-table').getAttribute('data-ph'), 'result')
      assert.equal(page.text('.hex-result-win'), 'Kazanan Yok')
      assert.equal(page.text('.hex-result-why'), 'Ev sahibi maçı durdurdu.')
      assert.equal(page.text('.hex-result-score'), 'Kırmızı 1, Mavi 0')
      const at = page.view().goals[0].at
      assert.ok(at >= 1 && at <= 15, String(at))
      same(Array.from(page.qa('.hex-goal')).map((li) => [li.getAttribute('data-side'), li.querySelector('.hex-goal-time').textContent, li.querySelector('.hex-goal-who').textContent]),
        [['red', '00:' + (at < 10 ? '0' : '') + at, 'Deniz (Kırmızı)']])
      assert.equal(page.run('gameOwnsPad()'), false, 'sonuçta kol bandındır')
      assert.equal(page.listening(), false)
    }
    assert.equal(ece.text('.game-wait .game-note-text'), 'Ev sahibinin yeni maçı başlatması bekleniyor.')
    assert.equal(deniz.key('hex-kickoff').textContent, 'Tekrar Oyna')
    assert.equal(deniz.key('hex-lobby').textContent, 'Lobiye Dön')
    // Tekrar Oyna: 2. maçı Mavi başlatır, skor sıfırlanır
    deniz.press('hex-kickoff')
    world.net.flush()
    world.net.advance(300)
    assert.equal(ece.text('.game-status-chip'), '2. Maç')
    assert.equal(ece.text('.hex-board-team[data-side="red"] .hex-board-score'), '0')
    assert.equal(ece.text('.hex-overlay'), 'Başlama vuruşu: Mavi')
    assert.ok(ece.spoken().indexOf('Maç başladı, başlama vuruşu Mavi takımında.') !== -1)
    // Lobiye Dön: sonuç korunarak masa biter ve lobiye dönülür
    deniz.press('hex-stop')
    deniz.press('hex-stop-yes')
    world.net.flush()
    deniz.press('hex-lobby')
    world.net.flush()
    assert.equal(deniz.model().stage, 'lobby')
    world.net.advance(300)
    assert.equal(deniz.run('hexballState.host'), null, 'lobide oturum yok')
    assert.equal(world.net.errors.length, 0, String(world.net.errors[0]))
  })
})

describe('Bağlantı Yok', () => {
  test('oyun verisini almayan istemci ev sahibinde Bağlantı Yok olur, Maçı Başlat pasif kalır, izleyicilere alınınca açılır', () => {
    const world = makeWorld(['5', '12', '7'], { page: { 7: {} } })
    const [deniz, ece, mert] = world.pages
    mert.fake.dropData = true
    openTable('quick', world)
    world.net.until(() => deniz.run('hexballLinks()')['12'] === 'ready', 5000)
    world.net.advance(6000)
    assert.equal(deniz.run('hexballLinks()')['7'], 'failed')
    assert.equal(deniz.text('.hex-person[data-user-id="7"] .hex-chip'), 'Bağlantı Yok')
    assert.ok(deniz.q('.hex-person[data-user-id="7"] .hex-chip').classList.contains('is-failed'))
    assert.equal(deniz.q('.hex-person[data-user-id="12"] .hex-chip'), null)
    assert.equal(deniz.text('.hex-failed .game-note-text'), 'Oyun bağlantısı kurulamadı: Mert. Eski bir sürüm kullanıyor ya da bağlantısı engelleniyor olabilir. İzleyicilere alabilir ya da koltuktan çıkarabilirsiniz.')
    assert.equal(deniz.disabled('hex-kickoff'), true)
    deniz.press('hex-kickoff')
    deniz.run('hexballKickoff()')
    world.net.flush()
    assert.equal(deniz.view().ph, 'teams', 'pasif düğme de işlev de maçı başlatmaz')
    // Oyuncunun kendisi el sıkışma alamaz: bekleme süresi dolunca Bağlantı Yok
    assert.equal(mert.text('.hex-link .game-note-text'), 'Ev sahibiyle oyun bağlantısı kuruluyor.')
    world.net.advance(10000)
    assert.equal(mert.text('.hex-link .game-note-text'), 'Ev sahibiyle oyun bağlantısı kurulamadı. Uygulamanız güncel değilse sayfayı yenileyin.')
    assert.ok(mert.q('.hex-link').classList.contains('is-failed'))
    // İzleyicinin bağı maçı başlatmayı engellemez, Bağlantı Yok çipi kalır
    deniz.press('hex-set-7-spec')
    world.net.flush()
    assert.equal(deniz.disabled('hex-kickoff'), false)
    assert.equal(deniz.text('.hex-person[data-user-id="7"] .hex-chip'), 'Bağlantı Yok')
    kickoff(world)
    assert.equal(deniz.text('.hex-legend-item[data-user-id="12"] .hex-badge'), 'M1')
    assert.equal(world.net.errors.length, 0, String(world.net.errors[0]))
  })

  test('engellenen bağ (link-failed) ev sahibinde hemen, oyuncuda bekleme sonunda Bağlantı Yok, oyun bağı olmayan ses motorunda hemen', () => {
    const world = makeWorld(['5', '12', '7'])
    const [deniz, ece, mert] = world.pages
    ece.fake.blockLink = true
    openTable('quick', world)
    world.net.advance(400)
    assert.equal(deniz.run('hexballLinks()')['12'], 'failed')
    assert.equal(deniz.text('.hex-person[data-user-id="12"] .hex-chip'), 'Bağlantı Yok')
    assert.equal(deniz.text('.hex-person[data-user-id="7"] .hex-chip'), null)
    assert.equal(ece.text('.hex-link .game-note-text'), 'Ev sahibiyle oyun bağlantısı kuruluyor.')
    assert.equal(mert.q('.hex-link'), null)
    world.net.advance(15000)
    assert.equal(ece.text('.hex-link .game-note-text'), 'Ev sahibiyle oyun bağlantısı kurulamadı. Uygulamanız güncel değilse sayfayı yenileyin.')
    assert.equal(deniz.text('.hex-person[data-user-id="12"] .hex-chip'), 'Bağlantı Yok')
    // Ses motoru oyun bağını hiç bilmiyorsa (sendGameData yok) oturum kurulmaz, oyuncu hemen Bağlantı Yok görür,
    // ev sahibi bağ açılmadığı için bekleme sonunda
    const old = makeWorld(['5', '30'])
    const [host, aylin] = old.pages
    aylin.run('delete voice.openGameLink; delete voice.sendGameData; delete voice.closeGameLink')
    openTable('quick', old)
    old.net.advance(1000)
    assert.equal(aylin.run('hexballState.player'), null)
    assert.equal(aylin.text('.hex-link .game-note-text'), 'Ev sahibiyle oyun bağlantısı kurulamadı. Uygulamanız güncel değilse sayfayı yenileyin.')
    assert.equal(host.text('.hex-person[data-user-id="30"] .hex-chip'), 'Bağlantı bekleniyor')
    old.net.advance(16000)
    assert.equal(host.run('hexballLinks()')['30'], 'failed')
    assert.equal(host.text('.hex-person[data-user-id="30"] .hex-chip'), 'Bağlantı Yok')
    assert.equal(world.net.errors.length + old.net.errors.length, 0, String(world.net.errors[0] || old.net.errors[0]))
  })

  test('oyuncu ev sahibiyle ses bağlantısı yokken bekler, süre dolunca Bağlantı Yok, ses oturumu bitince oturumlar kapanır', () => {
    const world = makeWorld(['5', '12'])
    const [deniz, ece] = world.pages
    openTable('quick', world)
    linksReady(world)
    world.net.advance(300)
    assert.equal(ece.q('.hex-link'), null)
    // Ev sahibinin eşi ses motorunun anlık görüntüsünden düştü (ör. yeniden bağlanıyor): oturum kapanır
    delete ece.fake.snap.peers['5']
    world.net.advance(1000)
    assert.equal(ece.run('hexballState.player'), null)
    assert.equal(ece.text('.hex-link .game-note-text'), 'Ev sahibiyle oyun bağlantısı kuruluyor.')
    world.net.advance(15000)
    assert.equal(ece.text('.hex-link .game-note-text'), 'Ev sahibiyle oyun bağlantısı kurulamadı. Uygulamanız güncel değilse sayfayı yenileyin.')
    // Ses oturumu bitti: bütün oturumlar ve zamanlayıcı kapanır
    deniz.run("gameOnVoiceEvent({ type: 'reset' })")
    assert.equal(deniz.run('hexballState.host'), null)
    assert.equal(deniz.run('hexballState.timer'), 0)
    assert.equal(world.net.errors.length, 0, String(world.net.errors[0]))
  })
})

describe('dokunmatik ve oyun kolu', () => {
  test('dokunmatik çubuk ve Vur düğmesi: kaba işaretçide görünür, ekran yeniden çizilse de basılı çubuk bırakılmaz', () => {
    const world = makeWorld(['5', '12'])
    const [deniz, ece] = world.pages
    ece.sandbox.coarse = true
    openTable('quick', world)
    linksReady(world)
    kickoff(world)
    assert.equal(deniz.q('.hex-touch').hidden, true, 'ince işaretçide gizli')
    const touch = ece.q('.hex-touch')
    assert.equal(touch.hidden, false)
    assert.equal(ece.text('.hex-help-keys'), ' Soldaki çubukla hareket edin, Vur düğmesiyle vurun.')
    const stick = ece.q('.hex-stick')
    const kick = ece.key('hex-kick')
    assert.equal(stick.getAttribute('aria-hidden'), 'true')
    assert.equal(kick.textContent, 'Vur')
    assert.equal(kick.getAttribute('type'), 'button')
    stick.rect = { left: 0, top: 0, width: 128, height: 128 }
    const down = stick.dispatch('pointerdown', { pointerId: 3, pointerType: 'touch', clientX: 128, clientY: 64 })
    assert.equal(down.defaultPrevented, true)
    same(ece.input(), { x: 1, y: 0, kick: false })
    assert.equal(ece.q('.hex-knob').style.transform, 'translate(64%, 0%)')
    // Ölü bölgede hareket yok
    ece.win('pointermove', { pointerId: 3, clientX: 70, clientY: 64 })
    same(ece.input(), { x: 0, y: 0, kick: false })
    ece.win('pointermove', { pointerId: 3, clientX: 64, clientY: 0 })
    same(ece.input(), { x: 0, y: -1, kick: false })
    // Ekran yeniden çizilir (ör. gol): aynı öğeler yeniden yerleşir, çubuk basılı kalır
    ece.run('gameRefreshStage()')
    assert.equal(ece.q('.hex-stick'), stick)
    ece.win('pointermove', { pointerId: 3, clientX: 0, clientY: 64 })
    same(ece.input(), { x: -1, y: 0, kick: false })
    // Başka parmak çubuğu almaz, Vur düğmesine basar
    kick.dispatch('pointerdown', { pointerId: 4, pointerType: 'touch' })
    same(ece.input(), { x: -1, y: 0, kick: true })
    ece.win('pointermove', { pointerId: 4, clientX: 128, clientY: 64 })
    same(ece.input(), { x: -1, y: 0, kick: true })
    ece.win('pointerup', { pointerId: 4 })
    same(ece.input(), { x: -1, y: 0, kick: false })
    ece.win('pointercancel', { pointerId: 3 })
    same(ece.input(), { x: 0, y: 0, kick: false })
    assert.equal(ece.q('.hex-knob').style.transform, '')
    // Klavyeyle (Enter) etkinleştirilen Vur kısa bir vuruştur
    kick.dispatch('click', { detail: 0 })
    same(ece.input(), { x: 0, y: 0, kick: true })
    world.net.advance(200)
    same(ece.input(), { x: 0, y: 0, kick: false })
    // İnce işaretçili cihazda sahaya ilk dokunuş denetimleri gösterir
    assert.equal(deniz.q('.hex-touch').hidden, true)
    deniz.q('.hex-field').dispatch('pointerdown', { pointerId: 1, pointerType: 'touch' })
    world.net.advance(50)
    assert.equal(deniz.q('.hex-touch').hidden, false)
    assert.equal(world.net.errors.length, 0, String(world.net.errors[0]))
  })

  test('oyun kolu: sol çubuk ve yön tuşları hareket, alt yüz düğmesi vuruş, bas konuş o düğmedeyse sol yüz düğmesi', () => {
    const world = makeWorld(['5', '12'])
    const [deniz, ece] = world.pages
    openTable('quick', world)
    linksReady(world)
    kickoff(world)
    const pad = (axes, pressed) => ({
      index: 0,
      connected: true,
      axes,
      buttons: Array.from({ length: 17 }, (x, i) => ({ pressed: pressed.indexOf(i) !== -1, value: pressed.indexOf(i) !== -1 ? 1 : 0 }))
    })
    ece.sandbox.fakePads = [pad([0.1, -0.1], [])]
    world.net.advance(50)
    assert.equal(ece.input(), null, 'ölü bölgede girdi yok')
    ece.sandbox.fakePads = [pad([0.8, 0], [0])]
    world.net.advance(50)
    same(ece.input(), { x: 0.8, y: 0, kick: true })
    ece.sandbox.fakePads = [pad([0, 0], [12, 14])]
    world.net.advance(50)
    same(ece.input(), { x: -1, y: -1, kick: false })
    // Bas konuş alt yüz düğmesine atanırsa vuruş sol yüz düğmesidir
    ece.fake.settings.bindings.ptt = { type: 'gamepad', button: 0 }
    ece.run('hexballState.padCheck = 0')
    ece.sandbox.fakePads = [pad([0, 0], [0])]
    world.net.advance(50)
    same(ece.input(), { x: 0, y: 0, kick: false })
    ece.sandbox.fakePads = [pad([0, 0], [2])]
    world.net.advance(50)
    same(ece.input(), { x: 0, y: 0, kick: true })
    ece.sandbox.fakePads = []
    world.net.advance(50)
    same(ece.input(), { x: 0, y: 0, kick: false })
    assert.equal(ece.run('gameOwnsPad()'), true)
    assert.equal(world.net.errors.length, 0, String(world.net.errors[0]))
  })
})
