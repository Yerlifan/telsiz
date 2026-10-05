'use strict'

// Özel mesaj araması arayüzü (public/js/32-arama.js): aşama ve durum metni, süre biçimi, zilin ne zaman ve hangi
// aralıkla çaldığı (Rahatsız etmeyin, Esc ile susturma, bu cihaz aramadayken), özel görünümdeki aramanın
// doğrulanması (14-social.js normalizeCall) ve index.html, sw.js bağlantıları. Modüller tarayıcıdaki gibi ortak
// bir genel ortamda Node vm bağlamında, gerekli yardımcılar taklit edilerek yüklenir.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const PUB = path.join(__dirname, '..', 'public')
const ARAMA = fs.readFileSync(path.join(PUB, 'js', '32-arama.js'), 'utf8')
const SOCIAL = fs.readFileSync(path.join(PUB, 'js', '14-social.js'), 'utf8')
const HTML = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
const SW = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8')
// Yorumlar çıkarılır (başlık yorumu yasak özelliklerin adlarını anar)
const CSS = fs.readFileSync(path.join(PUB, 'css', 'arama.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function load (opts) {
  const o = opts || {}
  const timers = []
  const played = []
  const sandbox = {
    console,
    Date: o.Date || Date,
    window: null,
    document: { hidden: false, activeElement: null, documentElement: { lang: 'tr' } },
    state: { inApp: true, me: { id: 1 }, channelId: null },
    socialState: { view: 'channel' },
    sameId: (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b),
    t: (key, params) => key + (params ? ' ' + JSON.stringify(params) : ''),
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms, live: true })
      return timers.length
    },
    clearTimeout: (id) => {
      if (timers[id - 1]) timers[id - 1].live = false
    },
    setInterval: () => 0,
    clearInterval: () => {},
    byId: () => null,
    snap: () => sandbox.voiceState,
    voiceState: { channelId: null, private: false, joining: false, peers: {} },
    privateCall: () => sandbox.callNow,
    callNow: null,
    myChosenStatus: () => sandbox.status,
    status: 'online',
    pruneCameraVideos: () => {},
    TelsizSesler: { play: (kind) => played.push(kind) }
  }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(ARAMA, sandbox, { filename: '32-arama.js' })
  return { sandbox, timers, played, run: (code) => vm.runInContext(code, sandbox) }
}

function call (extra) {
  return Object.assign({ dmId: 7, userId: 2, video: false, state: 'ringing', role: 'callee', createdAt: 1000, ringUntil: 46000, answeredAt: 0, members: [] }, extra || {})
}

test('süre biçimi: dd:ss, bir saatten uzunsa s:dd:ss, eksi ve bozuk değer sıfır', () => {
  const { run } = load()
  assert.equal(run('aramaClock(0)'), '00:00')
  assert.equal(run('aramaClock(65999)'), '01:05')
  assert.equal(run('aramaClock(3600000 + 61000)'), '1:01:01')
  assert.equal(run('aramaClock(-5000)'), '00:00')
  assert.equal(run('aramaClock("bozuk")'), '00:00')
})

test('aşama: gelen arama, aranıyor, bağlanıyor, etkin ve başka cihazda', () => {
  const env = load()
  const phase = (c, s) => {
    env.sandbox.c = c
    env.sandbox.s = s
    return env.run('aramaPhase(c, s)')
  }
  const away = { channelId: null, private: false, joining: false, peers: {} }
  const room = (extra) => Object.assign({ channelId: 7, private: true, joining: false, peers: {} }, extra || {})
  assert.equal(phase(null, away), null)
  assert.equal(phase(call(), away), 'incoming')
  assert.equal(phase(call({ role: 'caller' }), away), 'elsewhere')
  assert.equal(phase(call({ state: 'active' }), away), 'elsewhere')
  // Aynı kimlikli ses odası (özel kip değil) aramanın odası sayılmaz
  assert.equal(phase(call(), { channelId: 7, private: false, joining: false, peers: {} }), 'incoming')
  assert.equal(phase(call({ role: 'caller' }), room({ joining: true })), 'calling')
  assert.equal(phase(call({ role: 'caller' }), room()), 'calling')
  assert.equal(phase(call(), room({ joining: true })), 'connecting')
  assert.equal(phase(call({ state: 'active' }), room({ peers: { 2: { status: 'connecting' } } })), 'connecting')
  assert.equal(phase(call({ state: 'active' }), room({ peers: { 2: { status: 'connected' } } })), 'active')
})

test('durum metni: Aranıyor, Bağlanıyor, gelen arama türü ve süre', () => {
  const env = load()
  const text = (phase, c, ms) => {
    env.sandbox.c = c
    return env.run('aramaStatusText(' + JSON.stringify(phase) + ', c, ' + ms + ')')
  }
  assert.equal(text('calling', call(), 0), 'call.calling')
  assert.equal(text('connecting', call(), 0), 'call.connecting')
  assert.equal(text('incoming', call(), 0), 'call.incomingVoiceState')
  assert.equal(text('incoming', call({ video: true }), 0), 'call.incomingVideoState')
  assert.equal(text('active', call({ state: 'active' }), 125000), '02:05')
  assert.equal(text('elsewhere', call({ state: 'active' }), 0), 'call.elsewhere')
  assert.equal(text(null, null, 0), '')
})

test('zil kuralı: yalnızca aranan ve aramada olmayan cihazda, Rahatsız etmeyin ve Esc ile susturulunca çalmaz', () => {
  const env = load()
  const should = (c, s, status, dismissed) => {
    env.sandbox.c = c
    env.sandbox.s = s
    return env.run('aramaShouldRing(c, s, ' + JSON.stringify(status) + ', ' + JSON.stringify(dismissed) + ')')
  }
  const away = { channelId: null, private: false, peers: {} }
  assert.equal(should(call(), away, 'online', ''), true)
  assert.equal(should(call(), away, 'idle', ''), true)
  assert.equal(should(call(), away, 'dnd', ''), false)
  assert.equal(should(call({ role: 'caller' }), away, 'online', ''), false)
  assert.equal(should(call({ state: 'active' }), away, 'online', ''), false)
  assert.equal(should(call(), { channelId: 7, private: true, peers: {} }, 'online', ''), false)
  assert.equal(should(call(), away, 'online', '7:1000'), false)
  assert.equal(should(call({ createdAt: 2000 }), away, 'online', '7:1000'), true, 'yeni arama yeniden çalar')
  assert.equal(should(null, away, 'online', ''), false)
  assert.equal(env.run('aramaRingLimit({ createdAt: 1000, ringUntil: 46000 })'), 48000)
  assert.equal(env.run('aramaRingLimit({ createdAt: 1000, ringUntil: 900 })'), 8000)
})

test('zil yaklaşık 3 saniyede bir yinelenir, arama bitince, kabul edilince ve Rahatsız etmeyin seçilince durur', () => {
  let now = 5000
  const env = load({ Date: { now: () => now } })
  const { sandbox, timers, played, run } = env
  sandbox.callNow = call()
  run('aramaSyncRing()')
  assert.deepEqual(played, ['ring'])
  const live = () => timers.filter((x) => x.live)
  assert.equal(live().length, 1)
  assert.equal(live()[0].ms, 3000)
  // Yeniden eşitleme aynı aramada ikinci bir döngü başlatmaz
  run('aramaSyncRing()')
  assert.equal(played.length, 1)
  assert.equal(live().length, 1)
  now += 3000
  const tick = live()[0]
  tick.live = false
  tick.fn()
  assert.deepEqual(played, ['ring', 'ring'])
  // Rahatsız etmeyin: sonraki adımda çalmaz ve döngü biter
  sandbox.status = 'dnd'
  const next = live()[0]
  next.live = false
  next.fn()
  assert.equal(played.length, 2)
  assert.equal(live().length, 0)
  // Kabul: bu cihaz aramanın odasına katılınca zil durur
  sandbox.status = 'online'
  run('aramaSyncRing()')
  assert.equal(played.length, 3)
  sandbox.voiceState = { channelId: 7, private: true, joining: true, peers: {} }
  run('aramaSyncRing()')
  assert.equal(live().length, 0)
  // Arama özel görünümden kalkınca zil durur
  sandbox.voiceState = { channelId: null, private: false, joining: false, peers: {} }
  run('aramaSyncRing()')
  assert.equal(live().length, 1)
  sandbox.callNow = null
  run('aramaSyncRing()')
  assert.equal(live().length, 0)
})

test('zil, zil süresi pay ile aşılınca kendiliğinden durur, oturum kapanınca da durur', () => {
  let now = 1000
  const env = load({ Date: { now: () => now } })
  const { sandbox, timers, played, run } = env
  sandbox.callNow = call({ createdAt: 0, ringUntil: 6000 })
  run('aramaSyncRing()')
  const live = () => timers.filter((x) => x.live)
  now += 9500
  const tick = live()[0]
  tick.live = false
  tick.fn()
  assert.equal(played.length, 1, 'süre dolunca çalmadı')
  assert.equal(live().length, 0)
  sandbox.callNow = call({ createdAt: 20000 })
  run('aramaSyncRing()')
  assert.equal(live().length, 1)
  run('aramaReset()')
  assert.equal(live().length, 0)
})

// Arama başlatma ve kabul için ağ, ses motoru ve konuşma yardımcıları taklit edilir. Kamera açma istekleri sayılır.
function loadJoin (answerCall) {
  const env = load()
  const { sandbox } = env
  const cams = []
  const posts = []
  Object.assign(sandbox, {
    isFriend: () => true,
    dmSendState: () => ({ ok: true }),
    callSupportCode: () => '',
    camerasAllowed: () => true,
    toast: () => {},
    normalizeCall: (c) => c,
    dmEntry: () => null,
    showDm: () => {},
    nextFrame: () => {},
    focusNode: () => {},
    radioCamera: () => ({ canUse: true, state: 'off' }),
    voice: { startCamera: () => cams.push(true) },
    api: (method, path, body) => {
      posts.push({ path, body })
      return Promise.resolve({ status: 200, data: { call: answerCall, answer: true } })
    },
    joinCallRoom: (dmId) => {
      sandbox.voiceState = { channelId: dmId, private: true, joining: false, peers: {} }
      return Promise.resolve()
    }
  })
  return Object.assign(env, { cams, posts })
}

const settle = async () => {
  let i = 0
  while (i < 5) {
    await new Promise((resolve) => setImmediate(resolve))
    i += 1
  }
}

test('görüntülü arama çalarken başlıktaki Sesli Ara aramayı kamerasız kabul eder, kamerayı yalnızca kişinin seçimi açar', async () => {
  // Sunucu (çakışan arama) arayanın görüntülü aramasını kabul sayar, call.video true döner
  const voiceOnly = loadJoin(call({ video: true }))
  voiceOnly.sandbox.callNow = call({ video: true })
  voiceOnly.run('aramaStart(7, 2, false)')
  await settle()
  assert.deepEqual(JSON.parse(JSON.stringify(voiceOnly.posts.map((x) => x.body))), [{ dmId: 7, video: false }])
  assert.equal(voiceOnly.run('arama.session && arama.session.role'), 'callee')
  assert.equal(voiceOnly.cams.length, 0, 'Sesli Ara kamerayı açmaz')

  const withVideo = loadJoin(call({ video: true }))
  withVideo.sandbox.callNow = call({ video: true })
  withVideo.run('aramaStart(7, 2, true)')
  await settle()
  assert.equal(withVideo.cams.length, 1, 'Görüntülü Ara kamerayı açar')

  // Karşı taraf sesli arıyorsa Görüntülü Ara kişinin kendi kamerasını açar, Sesli Ara açmaz
  const voiceCall = loadJoin(call({ video: false }))
  voiceCall.sandbox.callNow = call({ video: false })
  voiceCall.run('aramaStart(7, 2, false)')
  await settle()
  assert.equal(voiceCall.cams.length, 0)
})

test('görüntülü aramada Kabul Et kamerayla, Kamerasız Kabul Et yalnızca sesle katılır', async () => {
  const plain = loadJoin(null)
  plain.sandbox.callNow = call({ video: true })
  plain.run('aramaAccept()')
  await settle()
  assert.equal(plain.run('arama.session && arama.session.video'), true)
  assert.equal(plain.cams.length, 1)

  const voiceOnly = loadJoin(null)
  voiceOnly.sandbox.callNow = call({ video: true })
  voiceOnly.run('aramaAcceptVoice()')
  await settle()
  assert.equal(voiceOnly.run('arama.session && arama.session.role'), 'callee')
  assert.equal(voiceOnly.run('arama.session.video'), false)
  assert.equal(voiceOnly.cams.length, 0, 'kamerasız kabul kamerayı açmaz')

  // Sesli aramada Kabul Et kamerayı açmaz
  const voiceCall = loadJoin(null)
  voiceCall.sandbox.callNow = call({ video: false })
  voiceCall.run('aramaAccept()')
  await settle()
  assert.equal(voiceCall.cams.length, 0)
})

test('gelen arama kartı odağı kabul düğmesine değil kartın kendisine taşır, kamerasız kabul yalnızca görüntülü aramada görünür', () => {
  const env = loadJoin(null)
  const { sandbox, run } = env
  const focused = []
  const node = (id) => ({
    id,
    hidden: true,
    tabIndex: 0,
    attrs: {},
    listeners: {},
    addEventListener (type, fn) {
      this.listeners[type] = fn
    },
    getAttribute (name) {
      return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null
    },
    setAttribute (name, value) {
      this.attrs[name] = String(value)
    },
    removeAttribute (name) {
      delete this.attrs[name]
    },
    contains: () => false
  })
  const nodes = {}
  for (const id of ['call-incoming', 'call-incoming-accept', 'call-incoming-accept-voice', 'call-incoming-decline']) nodes[id] = node(id)
  Object.assign(sandbox, {
    byId: (id) => nodes[id] || null,
    userDisplayName: () => 'Ece',
    setText: () => {},
    focusNode: (n) => focused.push(n ? n.id : null)
  })
  sandbox.callNow = call({ video: true })
  run('aramaSyncCard()')
  assert.equal(nodes['call-incoming'].hidden, false)
  assert.equal(nodes['call-incoming'].tabIndex, -1, 'kart odaklanabilir')
  assert.deepEqual(focused, ['call-incoming'], 'yanlışlıkla basılan Enter veya Boşluk aramayı kabul etmez')
  assert.equal(nodes['call-incoming-accept'].hidden, false)
  assert.equal(nodes['call-incoming-accept-voice'].hidden, false)
  assert.equal(typeof nodes['call-incoming-accept-voice'].listeners.click, 'function')

  // Sesli aramada kamerasız kabul düğmesi gizlidir
  run('aramaHideCard(false)')
  sandbox.callNow = call({ video: false, createdAt: 2000 })
  run('aramaSyncCard()')
  assert.equal(nodes['call-incoming-accept-voice'].hidden, true)
  assert.deepEqual(focused, ['call-incoming', 'call-incoming'])
})

test('özel görünümdeki arama doğrulanır: bozuk kayıt yok sayılır, alanlar daraltılır', () => {
  const sandbox = { console, window: null, STATUS_CHOICES: ['online', 'idle', 'dnd', 'invisible'] }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(SOCIAL, sandbox, { filename: '14-social.js' })
  const norm = (value) => {
    sandbox.v = value
    return JSON.parse(JSON.stringify(vm.runInContext('normalizeCall(v)', sandbox)))
  }
  const good = {
    dmId: 7,
    userId: 2,
    video: true,
    state: 'active',
    role: 'caller',
    createdAt: 10,
    ringUntil: 20,
    answeredAt: 15,
    extra: 'yok sayılır',
    members: [{ userId: 2, peerId: 'p1', muted: true, deafened: 'evet', camera: true, x: 1 }, { userId: 'bozuk', peerId: 'p2' }, null]
  }
  assert.deepEqual(norm(good), {
    dmId: 7,
    userId: 2,
    video: true,
    state: 'active',
    role: 'caller',
    createdAt: 10,
    ringUntil: 20,
    answeredAt: 15,
    members: [{ userId: 2, peerId: 'p1', muted: true, deafened: false, camera: true }]
  })
  assert.equal(norm(null), null)
  assert.equal(norm(Object.assign({}, good, { state: 'ended' })), null)
  assert.equal(norm(Object.assign({}, good, { role: 'admin' })), null)
  assert.equal(norm(Object.assign({}, good, { dmId: '__proto__' })), null)
  assert.equal(norm(Object.assign({}, good, { video: 'true' })).video, false)
  assert.equal(norm(Object.assign({}, good, { createdAt: 'dün', members: 'liste' })).createdAt, 0)
  assert.deepEqual(norm(Object.assign({}, good, { members: 'liste' })).members, [])
  const full = vm.runInContext('normalizePrivate({ friends: [2], call: { dmId: 7, userId: 2, state: "ringing", role: "callee" } })', sandbox)
  assert.equal(full.call.dmId, 7)
  assert.equal(vm.runInContext('normalizePrivate({}).call', sandbox), null)
})

test('index.html, sw.js ve arama.css: modül, simge, kart ve bölüm bağlı, yasak CSS özelliği yok', () => {
  assert.ok(HTML.indexOf('<script src="/js/32-arama.js" defer></script>') > HTML.indexOf('<script src="/js/31-sesler.js" defer></script>'))
  assert.ok(HTML.indexOf('href="/css/arama.css"') !== -1 && HTML.indexOf('href="/css/arama.css"') < HTML.indexOf('href="/css/skins/arcade.css"'))
  assert.ok(SW.indexOf("'/js/32-arama.js'") !== -1 && SW.indexOf("'/css/arama.css'") !== -1)
  assert.ok(/<symbol id="i-phone" viewBox="0 0 24 24">/.test(HTML))
  assert.ok(/<div id="call-incoming" class="call-incoming" role="alertdialog" aria-labelledby="call-incoming-title" aria-describedby="call-incoming-text" hidden>/.test(HTML))
  assert.ok(/<button id="call-incoming-accept-voice" [^>]*hidden>/.test(HTML), 'kamerasız kabul düğmesi')
  // Arama bölümü başlık ile mesajlar arasında
  assert.ok(HTML.indexOf('id="dm-header"') < HTML.indexOf('id="dm-call"') && HTML.indexOf('id="dm-call"') < HTML.indexOf('id="messages"'))
  assert.ok(!/(^|[\s{])(row-|column-)?gap\s*:|clamp\(|:is\(|:where\(|aspect-ratio|(^|[\s{])inset\s*:|display:\s*grid/.test(CSS), 'yasak özellik yok')
  assert.deepEqual(CSS.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) || [], [], 'renkler yalnızca var(--...) ile')
  assert.ok(/@media \(prefers-reduced-motion: reduce\)/.test(CSS))
})
