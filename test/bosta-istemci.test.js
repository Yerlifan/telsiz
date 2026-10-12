'use strict'

// Otomatik boşta istemcisi (public/js/40-bosta.js): süre dolunca poll'un idle=1 taşıması ve yeniden başlaması,
// girdiyle hemen dönüş, fare hareketinin kısılması, ayar, uygulama dışı ve ses odası kuralları, oyun kolunun ölü
// bölgesi ve kol döngüsündeki (21-band.js padPoll) kısa dokunuşlar, sayfa kimliği (tab), masaüstünde sistemin boşta
// süresi, arka plan penceresi (25-arka-plan.js bgRestartPoll) ve index.html, sw.js, poll sorgusu bağlantıları.
// Modüller tarayıcıdaki gibi ortak bir genel ortamda Node vm bağlamında, gerekli yardımcılar taklit edilerek yüklenir.
// Saat ve zamanlayıcılar elle ilerletilir.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const PUB = path.join(__dirname, '..', 'public')
const BOSTA = fs.readFileSync(path.join(PUB, 'js', '40-bosta.js'), 'utf8')
const ARKA = fs.readFileSync(path.join(PUB, 'js', '25-arka-plan.js'), 'utf8')
const POLL = fs.readFileSync(path.join(PUB, 'js', '05-poll.js'), 'utf8')
const BAND = fs.readFileSync(path.join(PUB, 'js', '21-band.js'), 'utf8')
const HTML = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
const SW = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8')
const MIN = 60000

function load (opts) {
  const o = opts || {}
  const clock = { now: 1000000 }
  const intervals = []
  const listeners = {}
  // Dinleyicinin bağlandığı yer ve seçenekleri: 'window capture' veya 'document'
  const targets = {}
  const listen = (target) => (type, fn, opts) => {
    listeners[type] = fn
    targets[type] = target + (opts && opts.capture ? ' capture' : '') + (opts && opts.passive ? ' passive' : '')
  }
  const polls = { main: 0, bg: 0 }
  const hooks = []
  const sandbox = {
    console,
    Promise,
    Date: { now: () => clock.now },
    window: null,
    addEventListener: listen('window'),
    document: {
      hidden: false,
      addEventListener: listen('document')
    },
    navigator: o.pads ? { getGamepads: () => o.pads.list } : {},
    setInterval: (fn, ms) => {
      intervals.push({ fn, ms })
      return intervals.length
    },
    clearInterval: () => {},
    state: { inApp: true, token: 'jeton' },
    startPoll: () => {
      polls.main += 1
    },
    bgRestartPoll: () => {
      polls.bg += 1
    },
    bgModeActive: () => o.bg === true,
    snap: () => sandbox.voiceSnap,
    voiceSnap: { channelId: null, joining: false },
    voiceHook: (kind, fn) => hooks.push({ kind, fn }),
    autoIdleEnabled: () => sandbox.enabled,
    autoIdleMinutes: () => sandbox.minutes,
    enabled: true,
    minutes: 10
  }
  sandbox.window = sandbox
  if (o.desktop) sandbox.telsizDesktop = o.desktop
  if (o.bgDesktop) sandbox.telsizArkaPlan = o.bgDesktop
  if (o.crypto) sandbox.crypto = o.crypto
  // Kol döngüsü (21-band.js padPoll): bir sonraki kare elle çağrılır, uygulama dışında frekans değiştirilmez
  const frames = []
  if (o.band) {
    Object.assign(sandbox, {
      el: { appView: null },
      voice: null,
      nextFrame: (fn) => frames.push(fn),
      topLayer: () => null
    })
    sandbox.document.body = null
    sandbox.document.hasFocus = () => true
  }
  vm.createContext(sandbox)
  if (o.band) vm.runInContext(BAND, sandbox, { filename: '21-band.js' })
  vm.runInContext(BOSTA, sandbox, { filename: '40-bosta.js' })
  const run = (code) => vm.runInContext(code, sandbox)
  // Denetim zamanlayıcısı (15 sn) ve oyun kolu zamanlayıcısı (2 sn)
  const tick = (ms) => {
    intervals.filter((t) => t.ms === ms).forEach((t) => t.fn())
  }
  const advance = (ms) => {
    clock.now += ms
  }
  const fire = (type, extra) => listeners[type](Object.assign({ type }, extra || {}))
  return { sandbox, run, clock, intervals, listeners, targets, polls, hooks, frames, tick, advance, fire }
}

// Bekleyen söz zincirleri (masaüstü okuması) bitsin
function settle () {
  return new Promise((resolve) => setImmediate(resolve))
}

test('süre dolunca boşa geçer ve poll yeniden başlar, girdiyle hemen döner', () => {
  const env = load()
  assert.equal(env.run('idlePollParam()'), '0')
  assert.deepEqual(env.intervals.map((t) => t.ms), [15000], 'oyun kolu desteği yokken yalnızca denetim zamanlayıcısı')
  env.advance(10 * MIN - 1)
  env.tick(15000)
  assert.equal(env.run('idlePollParam()'), '0')
  assert.equal(env.polls.main, 0)
  env.advance(1)
  env.tick(15000)
  assert.equal(env.run('idlePollParam()'), '1')
  assert.equal(env.run('idleThisDevice()'), true)
  assert.equal(env.polls.main, 1)
  env.tick(15000)
  assert.equal(env.polls.main, 1, 'durum değişmeden poll yeniden başlamaz')
  env.fire('pointerdown')
  assert.equal(env.run('idlePollParam()'), '0')
  assert.equal(env.polls.main, 2)
  // Dinlenen girdiler ve görünür olma. Girdiler window'un yakalama aşamasında dinlenir: Hexball maç sırasında oyun
  // tuşlarını window'un yakalama aşamasında durdurur (46-hexball.js), document'taki dinleyiciye ulaşmazlardı
  assert.deepEqual(Object.keys(env.listeners).sort(), ['keydown', 'pointerdown', 'pointermove', 'touchstart', 'visibilitychange', 'wheel'])
  assert.deepEqual(env.targets, {
    pointerdown: 'window capture passive',
    pointermove: 'window capture passive',
    keydown: 'window capture passive',
    wheel: 'window capture passive',
    touchstart: 'window capture passive',
    visibilitychange: 'document'
  })
  for (const type of ['keydown', 'wheel', 'touchstart']) {
    env.advance(10 * MIN)
    env.tick(15000)
    assert.equal(env.run('idlePollParam()'), '1', type)
    env.fire(type)
    assert.equal(env.run('idlePollParam()'), '0', type)
  }
  env.advance(10 * MIN)
  env.tick(15000)
  env.sandbox.document.hidden = true
  env.fire('visibilitychange')
  assert.equal(env.run('idlePollParam()'), '1', 'gizlenmek girdi sayılmaz')
  env.sandbox.document.hidden = false
  env.fire('visibilitychange')
  assert.equal(env.run('idlePollParam()'), '0', 'görünür olmak girdi sayılır')
})

test('fare hareketi kısılır, boştayken ilk hareket hemen işlenir', () => {
  const env = load()
  const start = env.clock.now
  env.advance(1000)
  env.fire('pointermove')
  assert.equal(env.run('idleState.lastInput'), start, '2 sn içindeki hareket sayılmaz')
  env.advance(1000)
  env.fire('pointermove')
  assert.equal(env.run('idleState.lastInput'), start + 2000)
  env.advance(10 * MIN)
  env.tick(15000)
  assert.equal(env.run('idlePollParam()'), '1')
  env.advance(10)
  env.fire('pointermove')
  assert.equal(env.run('idlePollParam()'), '0')
  assert.equal(env.polls.main, 2)
})

test('ayar kapalıyken, uygulama dışında ve ses odasındayken boşta olunmaz, seçilen süre geçerlidir', () => {
  const env = load()
  env.sandbox.enabled = false
  env.advance(60 * MIN)
  env.tick(15000)
  assert.equal(env.run('idlePollParam()'), '0')
  env.sandbox.enabled = true
  env.sandbox.state.inApp = false
  env.tick(15000)
  assert.equal(env.run('idlePollParam()'), '0')
  env.sandbox.state.inApp = true
  env.sandbox.voiceSnap = { channelId: 7, joining: false }
  env.tick(15000)
  assert.equal(env.run('idlePollParam()'), '0', 'ses odasında')
  env.sandbox.voiceSnap = { channelId: null, joining: true }
  env.tick(15000)
  assert.equal(env.run('idlePollParam()'), '0', 'katılırken')
  env.sandbox.voiceSnap = { channelId: null, joining: false }
  env.tick(15000)
  assert.equal(env.run('idlePollParam()'), '1')
  // Ses odasına katılınca ses kancasıyla hemen dönülür
  assert.deepEqual(env.hooks.map((x) => x.kind), ['change'])
  env.sandbox.voiceSnap = { channelId: 7, joining: false }
  env.hooks[0].fn({ channelId: 7 })
  assert.equal(env.run('idlePollParam()'), '0')
  // Ayar kapatılınca karar hemen yenilenir
  env.sandbox.voiceSnap = { channelId: null, joining: false }
  env.tick(15000)
  assert.equal(env.run('idlePollParam()'), '1')
  env.sandbox.enabled = false
  env.run('idleSettingsChanged()')
  assert.equal(env.run('idlePollParam()'), '0')
  // Süre 5 dakika seçiliyse 5 dakikada boşa geçilir
  env.sandbox.enabled = true
  env.sandbox.minutes = 5
  env.fire('pointerdown')
  env.advance(5 * MIN)
  env.tick(15000)
  assert.equal(env.run('idlePollParam()'), '1')
})

test('oyun kolu: düğme ve ölü bölgeyi aşan eksen girdi sayılır, çubuk titremesi sayılmaz', () => {
  const pad = { index: 0, connected: true, buttons: [{ pressed: false, value: 0 }, { pressed: false, value: 0 }], axes: [0.02, -0.03] }
  const pads = { list: [null, pad] }
  const env = load({ pads })
  assert.deepEqual(env.intervals.map((t) => t.ms).sort((a, b) => a - b), [2000, 15000])
  env.tick(2000)
  env.advance(10 * MIN)
  pad.axes = [0.3, -0.4]
  env.tick(2000)
  env.tick(15000)
  assert.equal(env.run('idlePollParam()'), '1', 'ölü bölge içindeki eksen değişimi')
  pad.axes = [0.9, 0]
  env.tick(2000)
  assert.equal(env.run('idlePollParam()'), '0', 'eksen ölü bölgeyi aştı')
  env.advance(10 * MIN)
  env.tick(2000)
  env.tick(15000)
  assert.equal(env.run('idlePollParam()'), '1', 'eksen aynı yönde tutuluyor')
  pad.buttons[1] = { pressed: true, value: 1 }
  env.tick(2000)
  assert.equal(env.run('idlePollParam()'), '0', 'düğmeye basıldı')
  // Yeni bağlanan kolun ilk okuması girdi sayılmaz
  env.advance(10 * MIN)
  pads.list = [{ index: 2, connected: true, buttons: [{ pressed: true, value: 1 }], axes: [] }]
  env.tick(2000)
  env.tick(15000)
  assert.equal(env.run('idlePollParam()'), '1')
})

test('oyun kolu: iki okuma arasında basılıp bırakılan düğme kol döngüsünün karelerinde girdi sayılır', () => {
  const button = () => ({ pressed: false, value: 0 })
  const pad = { index: 0, connected: true, buttons: [button(), button(), button(), button(), button(), button()], axes: [0, 0] }
  const pads = { list: [pad] }
  const env = load({ pads, band: true })
  // R1 frekansı değiştirir: adımlar kaydedilir
  env.run('var bandSteps = []')
  env.run('bandStep = (d) => { bandSteps.push(d) }')
  env.tick(2000)
  env.advance(10 * MIN)
  env.tick(15000)
  assert.equal(env.run('idlePollParam()'), '1')
  // Yalnızca 2 saniyelik okuma: iki okuma arasındaki 150 ms'lik R1 dokunuşu görülmez
  env.advance(925)
  pad.buttons[5] = { pressed: true, value: 1 }
  env.advance(150)
  pad.buttons[5] = button()
  env.advance(925)
  env.tick(2000)
  assert.equal(env.run('idlePollParam()'), '1', '2 saniyelik okuma dokunuşu kaçırır')
  // Kol döngüsü her karede okur: aynı dokunuş girdi sayılır ve boştan hemen dönülür
  env.run('padPoll()')
  env.advance(925)
  pad.buttons[5] = { pressed: true, value: 1 }
  env.run('padPoll()')
  const pressedAt = env.clock.now
  assert.equal(env.run('idlePollParam()'), '0', 'basılan düğme')
  assert.equal(env.run('idleState.lastInput'), pressedAt)
  assert.equal(env.polls.main, 2)
  env.advance(150)
  pad.buttons[5] = button()
  env.run('padPoll()')
  assert.equal(env.run('idleState.lastInput'), pressedAt + 150, 'bırakılan düğme')
  assert.ok(env.frames.length > 0, 'döngü sonraki kareyi ister')
  assert.deepEqual(Array.from(env.run('bandSteps')), [1], 'R1 frekansı yine bir kez değiştirir')
  env.advance(925)
  env.tick(2000)
  assert.equal(env.run('idleState.lastInput'), pressedAt + 150, 'okuma aynı imzayı yeniden saymaz')
  // Kare içinde sabit tutulan düğme ve ölü bölgedeki eksen girdi sayılmaz
  env.advance(10 * MIN)
  pad.axes = [0.2, -0.1]
  env.run('padPoll()')
  env.run('padPoll()')
  env.tick(15000)
  assert.equal(env.run('idlePollParam()'), '1')
  // Kol döngüsü olmayan arka plan penceresinde kare okuması yok sayılır
  const bg = load({ bg: true, pads: { list: [] } })
  bg.run('idlePadFrame([{ index: 0, connected: true, buttons: [{ pressed: true, value: 1 }], axes: [] }])')
  assert.equal(bg.run('Object.keys(idleState.pads).length'), 0)
})

test('sayfa kimliği: her sayfa açılışta bir kez üretilir ve sunucunun kabul ettiği biçimdedir', () => {
  const crypto = require('node:crypto')
  const a = load({ crypto: { getRandomValues: (bytes) => crypto.randomFillSync(bytes) } })
  const b = load({ crypto: { getRandomValues: (bytes) => crypto.randomFillSync(bytes) } })
  const tab = a.run('idleTabParam()')
  assert.match(tab, /^[0-9a-f]{16}$/)
  assert.equal(a.run('idleTabParam()'), tab, 'kimlik sayfa boyunca aynı kalır')
  assert.notEqual(b.run('idleTabParam()'), tab)
  // crypto yoksa yedek kimlik de sunucunun biçimine uyar
  const c = load()
  assert.match(c.run('idleTabParam()'), /^[0-9a-z]{1,32}$/)
})

test('masaüstü: sistemin boşta süresi kısaysa boşta olunmaz, okunamazsa sayfanın girdisi sayılır', async () => {
  const desktop = { seconds: 30, fail: false, calls: 0 }
  desktop.idleSeconds = () => {
    desktop.calls += 1
    return desktop.fail ? Promise.reject(new Error('yok')) : Promise.resolve(desktop.seconds)
  }
  const env = load({ desktop })
  env.advance(30 * MIN)
  env.tick(15000)
  await settle()
  assert.equal(desktop.calls, 1)
  assert.equal(env.run('idlePollParam()'), '0', 'kişi başka bir uygulamayı kullanıyor')
  desktop.seconds = 11 * 60
  env.tick(15000)
  await settle()
  assert.equal(env.run('idlePollParam()'), '1')
  // Okuma hatasında son okunan değer ve sayfanın girdileri geçerli kalır
  desktop.fail = true
  env.fire('keydown')
  assert.equal(env.run('idlePollParam()'), '0')
  env.advance(10 * MIN)
  env.tick(15000)
  await settle()
  assert.equal(env.run('idlePollParam()'), '1')
})

test('arka plan penceresi: girdi dinlenmez, karar sistemin boşta süresiyle verilir ve bgRestartPoll çağrılır', async () => {
  const bgDesktop = { background: true, seconds: 0 }
  bgDesktop.idleSeconds = () => Promise.resolve(bgDesktop.seconds)
  const env = load({ bg: true, bgDesktop, pads: { list: [] } })
  env.sandbox.state.inApp = false
  assert.deepEqual(Object.keys(env.listeners), [])
  assert.deepEqual(env.intervals.map((t) => t.ms), [15000])
  assert.deepEqual(env.hooks, [])
  env.advance(20 * MIN)
  env.tick(15000)
  await settle()
  assert.equal(env.run('idlePollParam()'), '0', 'sistem kullanılıyor')
  bgDesktop.seconds = 10 * 60
  env.tick(15000)
  await settle()
  assert.equal(env.run('idlePollParam()'), '1')
  assert.deepEqual(env.polls, { main: 0, bg: 1 })
  bgDesktop.seconds = 3
  env.tick(15000)
  await settle()
  assert.equal(env.run('idlePollParam()'), '0')
  assert.deepEqual(env.polls, { main: 0, bg: 2 })
})

test('arka plan poll döngüsü: idle sorguda gider, bgRestartPoll bekleyen poll\'u bırakıp hemen yeniden gönderir', async () => {
  const requests = []
  const sandbox = {
    console,
    Promise,
    window: null,
    state: { seq: 5, metaVersion: 2, sigSeq: 0, boot: 'b00t', token: 'jeton' },
    POLL_TIMEOUT_MS: 35000,
    socialPmv: () => 1,
    idle: '0',
    idlePollParam: () => sandbox.idle,
    idleTabParam: () => 'a1b2',
    request: (method, url) => {
      let resolve = null
      const p = new Promise((r) => {
        resolve = r
      })
      p.abort = () => resolve({ status: 0, data: null, aborted: true })
      p.finish = resolve
      requests.push({ url, p })
      return p
    },
    wait: () => new Promise(() => {})
  }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(ARKA, sandbox, { filename: '25-arka-plan.js' })
  const run = (code) => vm.runInContext(code, sandbox)
  run('bgRestartPoll()')
  const gen = run('bgState.gen')
  const loop = run('bgPoll(bgState.gen)')
  await settle()
  assert.equal(requests.length, 1)
  assert.match(requests[0].url, /&idle=0&tab=a1b2$/)
  sandbox.idle = '1'
  run('bgRestartPoll()')
  await settle()
  assert.equal(requests.length, 2, 'bırakılan poll hata sayılmadan hemen yeniden gönderilir')
  assert.match(requests[1].url, /&idle=1&tab=a1b2$/)
  assert.equal(run('bgState.status'), 'starting', 'durum değişmedi')
  // Döngü sona erer
  run('bgState.gen += 1')
  requests[1].p.finish({ status: 0, data: null, aborted: true })
  await loop
  assert.equal(run('bgState.gen'), gen + 1)
})

test('index.html, sw.js ve poll sorguları: modül bağlı, idle ve tab gönderilir', () => {
  assert.ok(HTML.indexOf('<script src="/js/40-bosta.js" defer></script>') > HTML.indexOf('<script src="/js/32-arama.js" defer></script>'))
  assert.ok(SW.indexOf("'/js/40-bosta.js'") > SW.indexOf("'/js/32-arama.js'"))
  const query = "'&idle=' + encodeURIComponent(idlePollParam()) + '&tab=' + encodeURIComponent(idleTabParam())"
  assert.ok(POLL.indexOf(query) !== -1)
  assert.ok(ARKA.indexOf(query) !== -1)
})
