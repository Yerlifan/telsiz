'use strict'

// Yüzen pencere istemcisi (public/js/39-yuzen.js): floatPlan durumları (kamera yok, kamera ve avatar şeridi, konuşma,
// izlenen yayın, kendi yayını, özel arama kadrosu, sınırı aşınca "+N"), floatMode önceliği (masaüstünde belge resim
// içinde resim de var görünür ama masaüstü yolu seçilir), masaüstünde simge durumu ve tepsi kuralları, tarayıcıda
// otomatik açılış işleyicisi, i18n anahtarları ve index.html, sw.js bağlantıları. Modül tarayıcıdaki gibi ortak bir
// genel ortamda Node vm bağlamında, gerekli yardımcılar taklit edilerek yüklenir. Gerçek pencere e2e/20-yuzen.test.js
// içinde açılır.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const PUB = path.join(__dirname, '..', 'public')
const YUZEN = fs.readFileSync(path.join(PUB, 'js', '39-yuzen.js'), 'utf8')
const HTML = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
const SW = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8')

function load (opts) {
  const o = opts || {}
  const hooks = []
  const listeners = {}
  const toasts = []
  const handlers = {}
  const sandbox = {
    console,
    Promise,
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval: () => {},
    window: null,
    document: {
      pictureInPictureEnabled: o.videoPip === true,
      hidden: false,
      addEventListener: (type, fn) => {
        listeners['document:' + type] = fn
      },
      querySelector: () => null,
      documentElement: { getAttribute: () => null, style: null }
    },
    navigator: o.mediaSession === false ? {} : {
      mediaSession: {
        setActionHandler: (name, fn) => {
          if (o.noPipAction && name === 'enterpictureinpicture') throw new TypeError('unsupported action')
          handlers[name] = fn
        }
      }
    },
    state: { me: { id: 1 } },
    voiceSnap: { channelId: null },
    snap: () => sandbox.voiceSnap,
    voiceRoster: () => [],
    voiceHook: (kind, fn) => hooks.push({ kind, fn }),
    el: { radioTools: null },
    toast: (fn) => toasts.push(typeof fn === 'function' ? fn() : fn),
    t: (key, params) => key + (params ? JSON.stringify(params) : ''),
    floatAutoEnabled: () => sandbox.auto,
    auto: true
  }
  sandbox.window = sandbox
  sandbox.addEventListener = (type, fn) => {
    listeners['window:' + type] = fn
  }
  if (o.desktop) sandbox.telsizDesktop = o.desktop
  if (o.documentPip) sandbox.documentPictureInPicture = { requestWindow: () => Promise.reject(new Error('test')) }
  if (o.videoPip) {
    sandbox.HTMLVideoElement = function () {}
    sandbox.HTMLVideoElement.prototype.requestPictureInPicture = function () {}
    sandbox.HTMLCanvasElement = function () {}
    sandbox.HTMLCanvasElement.prototype.captureStream = function () {}
  }
  if (o.bg) sandbox.bgModeActive = () => true
  vm.createContext(sandbox)
  vm.runInContext(YUZEN, sandbox, { filename: '39-yuzen.js' })
  const run = (code) => vm.runInContext(code, sandbox)
  // vm içindeki nesnelerin prototipi farklıdır, karşılaştırma JSON kopyasıyla yapılır
  const plan = (input) => JSON.parse(JSON.stringify(sandbox.floatPlan(input)))
  return { sandbox, run, hooks, listeners, toasts, handlers, plan }
}

const ids = (plan) => plan.tiles.map((tile) => tile.id + (tile.cam ? '*' : '') + (tile.speaking ? '!' : '') + (tile.self ? '@' : ''))

test('floatPlan: odada değilken boş, kamera yokken avatarlar, siz sonda, konuşanlar işaretli', () => {
  const env = load()
  assert.deepEqual(env.plan({ room: false, roster: ['2', '3'], me: '1' }), { kind: 'avatars', tiles: [], more: 0, sharing: false, watching: null })
  assert.deepEqual(env.plan(null), { kind: 'avatars', tiles: [], more: 0, sharing: false, watching: null })
  const p = env.plan({ room: true, me: '1', roster: ['1', '2', '3'], cams: {}, speaking: ['3', '1'] })
  assert.equal(p.kind, 'avatars')
  assert.deepEqual(ids(p), ['2', '3!', '1!@'])
  assert.equal(p.more, 0)
  // Kadroda yinelenen kimlik bir kez görünür, sayılar dizgeye çevrilir
  assert.deepEqual(ids(env.plan({ room: true, me: 1, roster: [2, 2, 1, 3] })), ['2', '3', '1@'])
})

test('floatPlan: en fazla 8 avatar, kalanlar "+N"', () => {
  const env = load()
  const roster = ['1'].concat(Array.from({ length: 10 }, (_, i) => String(i + 2)))
  const p = env.plan({ room: true, me: '1', roster })
  assert.equal(p.kind, 'avatars')
  assert.deepEqual(ids(p), ['2', '3', '4', '5', '6', '7', '8', '9'])
  assert.equal(p.more, 3, 'kendiniz dahil üç kişi gösterilmedi')
})

test('floatPlan: kamera varken en fazla 4 kamera kutusu, kamerasızlar en fazla 8 avatarlık şeritte', () => {
  const env = load()
  const p = env.plan({ room: true, me: '1', roster: ['1', '2', '3', '4'], cams: { 1: 's1', 3: 's3' }, speaking: ['2'] })
  assert.equal(p.kind, 'cams')
  // Önce kameralar (siz sonda), sonra kamerasız kişiler
  assert.deepEqual(ids(p), ['3*', '1*@', '2!', '4'])
  assert.equal(p.more, 0)
  const many = ['1'].concat(Array.from({ length: 14 }, (_, i) => String(i + 2)))
  const cams = {}
  for (const id of ['2', '3', '4', '5', '6', '1']) cams[id] = 'akış-' + id
  const big = env.plan({ room: true, me: '1', roster: many, cams })
  assert.deepEqual(ids(big), ['2*', '3*', '4*', '5*', '7', '8', '9', '10', '11', '12', '13', '14'])
  // 6 ve sizin kameranız (2) ile 15 kamerasızdan gösterilmeyen 1 kişi
  assert.equal(big.more, 3)
})

test('floatPlan: izlenen yayın varsa yalnızca o, kendi yayınınız sürerken oda ve yayın satırı', () => {
  const env = load()
  const share = env.plan({ room: true, me: '1', roster: ['1', '2', '3'], cams: { 3: 's' }, watching: '2', speaking: ['2'] })
  assert.deepEqual(share, { kind: 'share', tiles: [{ id: '2', cam: false, self: false, speaking: true }], more: 0, sharing: false, watching: '2' })
  // Odada olmayan kişinin yayını gösterilmez
  assert.equal(env.plan({ room: true, me: '1', roster: ['1', '3'], watching: '2' }).kind, 'avatars')
  const own = env.plan({ room: true, me: '1', roster: ['1', '2'], sharing: true })
  assert.equal(own.kind, 'avatars')
  assert.equal(own.sharing, true)
  assert.equal(env.plan({ room: false, sharing: true }).sharing, false)
})

test('floatPlan: özel arama kadrosu (iki kişi) ses odası gibi gösterilir', () => {
  const env = load()
  const p = env.plan({ room: true, me: '1', roster: ['1', '9'], cams: { 9: 'kamera' } })
  assert.equal(p.kind, 'cams')
  assert.deepEqual(ids(p), ['9*', '1@'])
})

test('floatMode: masaüstü önce gelir (belge resim içinde resim de var görünse), sonra belge, sonra görüntü', () => {
  const desktop = { float: { arm: () => Promise.resolve(''), showMain: () => Promise.resolve(true) }, onWindowState: () => () => {} }
  assert.equal(load({ desktop, documentPip: true, videoPip: true }).sandbox.floatMode(), 'desktop')
  assert.equal(load({ documentPip: true, videoPip: true }).sandbox.floatMode(), 'document')
  assert.equal(load({ videoPip: true }).sandbox.floatMode(), 'video')
  assert.equal(load().sandbox.floatMode(), null)
  // float nesnesi olmayan eski masaüstü sürümü masaüstü yolu sayılmaz
  assert.equal(load({ desktop: { onWindowState: () => () => {} }, documentPip: true }).sandbox.floatMode(), 'document')
})

test('masaüstü: simge durumunda ve tepsiye gizlenince yalnızca ses odasındayken ve ayar açıkken açılır', async () => {
  const calls = []
  let onState = null
  const desktop = {
    float: {
      arm: () => {
        calls.push('arm')
        return Promise.resolve('')
      },
      showMain: () => Promise.resolve(true)
    },
    onWindowState: (fn) => {
      onState = fn
      return () => {}
    }
  }
  const env = load({ desktop })
  assert.equal(typeof onState, 'function')
  assert.deepEqual(env.hooks.map((hk) => hk.kind), ['change', 'render'])
  // Odada değil
  onState('minimized')
  assert.deepEqual(calls, [])
  // Odada ama ayar kapalı
  env.sandbox.voiceSnap = { channelId: 5 }
  env.sandbox.auto = false
  onState('hidden')
  assert.deepEqual(calls, [])
  // Odada ve ayar açık: simge durumu ve tepsi açar. Ana süreç ad vermezse pencere açılmaz, hata gösterilmez.
  env.sandbox.auto = true
  onState('restored')
  assert.deepEqual(calls, [])
  onState('minimized')
  await new Promise((resolve) => setImmediate(resolve))
  onState('hidden')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, ['arm', 'arm'])
  assert.deepEqual(env.toasts, [])
  assert.equal(env.run('floatIsOpen()'), false)
})

test('tarayıcı: otomatik açılış işleyicisi yalnızca belge yolunda, odadayken ve ayar açıkken kayıtlıdır', () => {
  const env = load({ documentPip: true })
  const change = env.hooks.find((hk) => hk.kind === 'change').fn
  change({ channelId: null })
  assert.equal(env.handlers.enterpictureinpicture, undefined)
  change({ channelId: 7 })
  assert.equal(typeof env.handlers.enterpictureinpicture, 'function')
  env.sandbox.auto = false
  env.run('floatSettingsChanged()')
  // Ayar kapanınca işleyici kaldırılır (setActionHandler null ile)
  assert.equal(env.handlers.enterpictureinpicture, null)
  env.sandbox.auto = true
  change({ channelId: 7 })
  assert.equal(typeof env.handlers.enterpictureinpicture, 'function')
  change({ channelId: null })
  assert.equal(env.handlers.enterpictureinpicture, null)
  // Görüntü yolunda (belge resim içinde resim yok) işleyici kaydedilmez
  const video = load({ videoPip: true })
  video.hooks.find((hk) => hk.kind === 'change').fn({ channelId: 7 })
  assert.equal(video.handlers.enterpictureinpicture, undefined)
  // Eylemi tanımayan tarayıcı bir kez hata verir, yeniden denenmez
  const old = load({ documentPip: true, noPipAction: true })
  const oldChange = old.hooks.find((hk) => hk.kind === 'change').fn
  oldChange({ channelId: 7 })
  oldChange({ channelId: 7 })
  assert.equal(old.run('floatState.msUnsupported'), true)
})

test('arka plan penceresinde modül çalışmaz', () => {
  const env = load({ bg: true, documentPip: true })
  assert.deepEqual(env.hooks, [])
  assert.equal(env.run('floatState.started'), false)
})

test('desteklenmeyen tarayıcıda düğmeyle açma bildirim gösterir', async () => {
  const env = load()
  env.sandbox.voiceSnap = { channelId: 5 }
  assert.equal(await env.sandbox.floatOpen('button'), false)
  assert.deepEqual(env.toasts, ['float.unsupported'])
  // Kendiliğinden açılış sessizdir
  assert.equal(await env.sandbox.floatOpen('auto'), false)
  assert.equal(env.toasts.length, 1)
})

test('i18n: yüzen pencere anahtarları iki dilde', () => {
  const sandbox = { console, navigator: { languages: [] }, document: { documentElement: {} }, localStorage: { getItem: () => null, setItem () {} } }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.join(PUB, 'i18n.js'), 'utf8'), sandbox)
  const I18N = sandbox.window.I18N
  const keys = ['float.open', 'float.openLabel', 'float.backToApp', 'float.close', 'float.title', 'float.unsupported', 'float.failed', 'settings.voice.floatTitle', 'settings.voice.floatAuto', 'settings.voice.floatHintDesktop', 'settings.voice.floatHintBrowser', 'settings.voice.floatHintWayland']
  for (const lang of ['tr', 'en']) {
    I18N.setLang(lang)
    for (const key of keys) assert.notEqual(I18N.t(key, { room: 'Lobi' }), key, lang + ' ' + key)
  }
  I18N.setLang('tr')
  assert.equal(I18N.t('float.open'), 'Yüzen Pencere')
  assert.equal(I18N.t('float.title', { room: 'Lobi' }), 'Lobi · Telsiz')
  assert.equal(I18N.t('float.more', { count: 3 }), '+3 kişi')
  I18N.setLang('en')
  assert.equal(I18N.t('float.backToApp'), 'Back to App')
  assert.equal(I18N.t('float.more', { count: 1 }), '+1 person')
  assert.equal(I18N.t('float.more', { count: 2 }), '+2 people')
})

test('index.html ve sw.js: modül 32 ile 40 arasında, stil dosyası ve simgeler kayıtlı', () => {
  const script = '<script src="/js/39-yuzen.js" defer></script>'
  assert.ok(HTML.indexOf(script) > HTML.indexOf('<script src="/js/32-arama.js" defer></script>'))
  assert.ok(HTML.indexOf(script) < HTML.indexOf('<script src="/js/40-bosta.js" defer></script>'))
  assert.ok(HTML.includes('<link rel="stylesheet" href="/css/yuzen.css">'))
  // Temaların stil dosyaları en sonda kalır
  assert.ok(HTML.indexOf('/css/yuzen.css') < HTML.indexOf('/css/skins/arcade.css'))
  assert.ok(HTML.includes('<symbol id="i-pip"'))
  assert.ok(HTML.includes('<symbol id="i-minimize"'))
  assert.ok(SW.indexOf("'/js/39-yuzen.js'") > SW.indexOf("'/js/32-arama.js'"))
  assert.ok(SW.indexOf("'/js/39-yuzen.js'") < SW.indexOf("'/js/40-bosta.js'"))
  assert.ok(SW.includes("'/css/yuzen.css'"))
})
