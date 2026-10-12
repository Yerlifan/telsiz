'use strict'

// Yüzen pencere istemcisi (public/js/39-yuzen.js): floatPlan durumları (kamera yok, kamera ve avatar şeridi, konuşma,
// izlenen yayın, kendi yayını, özel arama kadrosu, sınırı aşınca "+N"), yapı anahtarının profil sürümü (floatKey),
// floatMode önceliği (masaüstünde belge resim içinde resim de var görünür ama masaüstü yolu seçilir), masaüstünde
// simge durumu ve tepsi kuralları, tarayıcıda otomatik açılış işleyicisi, i18n anahtarları ve index.html, sw.js
// bağlantıları. Modül tarayıcıdaki gibi ortak bir genel ortamda Node vm bağlamında, gerekli yardımcılar taklit
// edilerek yüklenir. Gerçek pencere e2e/20-yuzen.test.js içinde açılır.

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

test('floatKey: profil sürümü (13-profile.js profileEpoch) artınca anahtar değişir, aynı sürümde değişmez', () => {
  // Profil resmi olmayan kişinin avatarı baş harf ve profil rengiyle çizilir. Rengini değiştirince ad ve resim aynı
  // kalır ama profil sürümü artar: anahtar değişir, pencerenin içi yeni renkle yeniden kurulur
  const env = load()
  const box = env.sandbox
  box.color = 2
  box.epoch = 1
  box.shownName = () => 'Deniz'
  box.castRoomName = () => 'Oda'
  box.avatarInfoFor = () => ({ initial: 'D', colorIndex: box.color, blobUrl: null })
  box.profileEpoch = () => box.epoch
  const plan = { kind: 'avatars', tiles: [{ id: '2', cam: false, self: false, speaking: false }], more: 0, sharing: false, watching: null }
  const key = () => box.floatKey(plan, { channelId: 5, private: false }, { cams: {} })
  const before = key()
  assert.equal(key(), before, 'aynı profil sürümünde anahtar aynı')
  box.color = 6
  box.epoch = 2
  assert.notEqual(key(), before, 'profil sürümü artınca anahtar değişir')
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

// Ana süreçten ad beklenirken (arm) uygulama penceresi geri gelirse kendiliğinden açılış iptal olur: aksi halde her
// zaman üstte kalan pencere uygulama görünürken açılır ve bir sonraki küçültme ile geri yükleme döngüsüne kadar kalırdı
test('masaüstü: ad beklenirken pencere geri gelirse yüzen pencere açılmaz, elle açılış pencere durumuna bakmaz', async () => {
  const arms = []
  let onState = null
  const desktop = {
    float: { arm: () => new Promise((resolve) => arms.push(resolve)), showMain: () => Promise.resolve(true) },
    onWindowState: (fn) => {
      onState = fn
      return () => {}
    }
  }
  const env = load({ desktop })
  const opened = []
  env.sandbox.open = (url, name) => {
    opened.push(name)
    return { closed: false, close () { this.closed = true } }
  }
  // Belgenin hazırlanması bu testin konusu değil: açılan pencere yalnızca kaydedilir
  env.run('floatAttach = function (win, mode, reason) { floatState.mode = mode; floatState.reason = reason; floatState.win = win }')
  env.sandbox.voiceSnap = { channelId: 5 }
  const flush = () => new Promise((resolve) => setImmediate(resolve))
  const token = (n) => 'telsiz-yuzen-' + String(n).repeat(32)
  // Simge durumu ve hemen geri yükleme, sonra tepsiye gizleme ve hemen gösterme
  for (const [away, back] of [['minimized', 'restored'], ['hidden', 'shown']]) {
    onState(away)
    onState(back)
    assert.equal(arms.length, 1, away)
    arms.shift()(token(1))
    await flush()
    assert.deepEqual(opened, [], away + ' sonra ' + back)
    assert.equal(env.run('floatIsOpen()'), false)
    assert.equal(env.run('floatState.opening'), false)
  }
  assert.deepEqual(env.toasts, [])
  // Pencere küçük kalırsa açılır, geri gelince kapanır
  onState('minimized')
  arms.shift()(token(2))
  await flush()
  assert.deepEqual(opened, [token(2)])
  assert.equal(env.run('floatState.reason'), 'auto')
  const win = env.run('floatState.win')
  onState('restored')
  assert.equal(win.closed, true)
  assert.equal(env.run('floatIsOpen()'), false)
  // Düğmeyle açılış uygulama penceresi görünürken de açılır
  env.sandbox.floatOpen('button')
  arms.shift()(token(3))
  await flush()
  assert.deepEqual(opened, [token(2), token(3)])
  assert.equal(env.run('floatState.reason'), 'button')
})

// İzlenen yayının akışı pencere açıldıktan sonra gelebilir (İzle'ye yeni basıldı, bağlantı yenilendi) ve yenisiyle
// değişebilir. Pencerenin yapısı değişmediği için yeniden kurulmaz, akış her çizimde (floatLive) yeniden bağlanır.
test('izlenen yayın: akış pencere açıldıktan sonra gelirse veya değişirse aynı görüntü öğesine bağlanıp oynar', () => {
  const env = load({ documentPip: true })
  let stream = null
  env.sandbox.radioScreen = () => ({ remote: { 2: { status: stream ? 'live' : 'requested', stream } } })
  env.sandbox.castCall = () => null
  env.sandbox.setIcon = () => {}
  env.sandbox.castRoomName = () => 'Lobi'
  const video = {
    srcObject: null,
    paused: true,
    plays: 0,
    play () {
      this.plays++
      this.paused = false
      return Promise.resolve()
    }
  }
  env.sandbox.__video = video
  env.run("floatState.mode = 'document'; floatState.doc = { querySelectorAll: () => [] }; floatState.nodes = { mic: { setAttribute () {}, classList: { toggle () {} } }, title: { textContent: 'Lobi' } }; floatState.shareVideo = __video")
  const plan = { kind: 'share', tiles: [{ id: '2', cam: false, self: false, speaking: false }], more: 0, sharing: false, watching: '2' }
  const draw = () => env.sandbox.floatLive(plan, { channelId: 5 })
  draw()
  assert.equal(video.srcObject, null, 'akış yokken öğe boş kalır')
  assert.equal(video.plays, 0)
  const first = { id: 'yayin-1' }
  stream = first
  draw()
  assert.equal(video.srcObject, first, 'akış gelince bağlanır')
  assert.equal(video.plays, 1)
  draw()
  assert.equal(video.plays, 1, 'oynayan öğe yeniden başlatılmaz')
  const second = { id: 'yayin-2' }
  stream = second
  video.paused = true
  draw()
  assert.equal(video.srcObject, second, 'yeni akış eskisinin yerine geçer')
  assert.equal(video.plays, 2)
  stream = null
  draw()
  assert.equal(video.srcObject, null, 'yayın gidince öğe boşalır')
})

// Görüntü yedeğinde izlenen yayın sahnenin kendi görüntü öğesiyle resim içinde resimde açılır. Yayın izlenmez olunca
// (İzlemeyi Bırak, Büyüt, oyun masası, paylaşım bitti) sahne öğenin akışını bırakır: 22-cast.js castSync'in
// çağırdığı floatOnStage pencereyi kapatır, öğenin resim içinde resim izni geri kapanır
test('görüntü yedeği: izlenen yayının sahne öğesi resim içinde resimdeyken yayın izlenmez olunca pencere kapanır', () => {
  const env = load({ videoPip: true })
  const attrs = {}
  const video = {
    setAttribute: (k, v) => {
      attrs[k] = v
    }
  }
  let exits = 0
  env.sandbox.document.pictureInPictureElement = video
  env.sandbox.document.exitPictureInPicture = () => {
    exits++
    return Promise.resolve()
  }
  env.sandbox.voiceSnap = { channelId: 5 }
  env.sandbox.voiceRoster = () => [{ userId: 1 }, { userId: 2 }]
  env.sandbox.radioScreen = () => ({ state: 'off', remote: { 2: { status: 'live' } } })
  env.sandbox.castState = { watching: '2' }
  env.sandbox.__video = video
  env.run("floatState.mode = 'video'; floatState.reason = 'share'; floatState.video = { video: __video, holder: null, timer: 0, own: true }")
  env.run('floatOnStage()')
  assert.equal(env.run('floatState.mode'), 'video', 'yayın izlenirken pencere açık kalır')
  assert.equal(exits, 0)
  env.sandbox.castState.watching = null
  env.run('floatOnStage()')
  assert.equal(env.run('floatState.mode'), null, 'yayın izlenmez olunca pencere kapanır')
  assert.equal(env.run('floatState.video'), null)
  assert.equal(exits, 1)
  assert.equal(attrs.disablepictureinpicture, '', 'sahne öğesinin resim içinde resim izni geri kapanır')
  // Tuval akışıyla açılan pencere (kamera ve avatarlar) yayına bağlı değildir, açık kalır
  env.run("floatState.mode = 'video'; floatState.video = { video: __video, holder: {}, timer: 0, own: false }")
  env.run('floatOnStage()')
  assert.equal(env.run('floatState.mode'), 'video')
  assert.equal(exits, 1)
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

// Ekran paylaşımı (public/js/22-cast.js, istek 16): kendi paylaşımının önizlemesini küçültme ve Yüzen Pencere
// düğmeleri. Modül vm bağlamında, sahne çizimi taklit edilerek yüklenir.
function loadCast (opts) {
  const o = opts || {}
  const store = new Map(Object.entries(o.store || {}))
  const calls = []
  const attr = () => {
    const a = {}
    return {
      hidden: false,
      setAttribute: (k, v) => {
        a[k] = String(v)
      },
      getAttribute: (k) => (k in a ? a[k] : null),
      attrs: a
    }
  }
  const sandbox = {
    console,
    window: null,
    document: { readyState: 'loading', addEventListener () {}, activeElement: null },
    innerWidth: o.width || 1440,
    isNarrow: () => sandbox.innerWidth < 760,
    storeGet: (k) => (store.has(k) ? store.get(k) : null),
    storeSet: (k, v) => store.set(k, String(v)),
    t: (key) => key,
    el: { cast: Object.assign(attr(), { hidden: o.stageHidden === true, contains: () => false }), topCast: null },
    state: { inApp: true },
    voice: null
  }
  sandbox.window = sandbox
  sandbox.addEventListener = () => {}
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.join(PUB, 'js', '22-cast.js'), 'utf8'), sandbox, { filename: '22-cast.js' })
  vm.runInContext('castSync = function () { __calls.push("sync") }\ncastCloseStage = function () { __calls.push("close") }\ncastFocusAfterClose = function () {}', Object.assign(sandbox, { __calls: calls }))
  return { sandbox, run: (code) => vm.runInContext(code, sandbox), store, calls, attr }
}

test('22-cast: Küçült önizlemeyi kapatır ve seçimi saklar, Önizlemeyi Göster geri getirir, dar ekranda küçültme yok', () => {
  const env = loadCast()
  assert.equal(env.run('CAST_OWN_MIN_KEY'), 'telsiz.castOwnMin')
  assert.equal(env.run('castOwnMinimized()'), false)
  env.run('castMinimizeOwn()')
  assert.equal(env.store.get('telsiz.castOwnMin'), '1')
  assert.equal(env.run('castState.ownMin'), true)
  assert.equal(env.run('castOwnMinimized()'), true)
  assert.deepEqual(env.calls, ['sync'])
  // Kendi paylaşımının kipi küçükken sahne kapanır (paylaşım sürer, motor çağrılmaz)
  env.run("castRenderStage('own', { state: 'live' }, {})")
  assert.deepEqual(env.calls, ['sync', 'close'])
  // Dar ekranda üst çubukta çip yoktur: önizleme küçük sayılmaz
  env.sandbox.innerWidth = 600
  assert.equal(env.run('castOwnMinimized()'), false)
  env.sandbox.innerWidth = 1440
  env.run('castShowOwn()')
  assert.equal(env.store.get('telsiz.castOwnMin'), '0')
  assert.equal(env.run('castOwnMinimized()'), false)
  const stage = loadCast({ stageHidden: true })
  stage.run('castState.ownMin = true')
  stage.run("castRenderStage('own', { state: 'live' }, {})")
  assert.deepEqual(stage.calls, [], 'sahne zaten kapalıysa bir şey yapılmaz')
})

// Önizleme kip önceliğinde en sondadır (castModeFor): izlenen paylaşım, kamera ızgarası ve oyun masası onun önüne
// geçer. Çipteki Önizlemeyi Göster yalnızca basınca önizleme görünecekse durur, oyun sürerken masa sahnedeyken yoktur
test('22-cast: Önizlemeyi Göster yalnızca önizleme sahnenin en üstteki kipi olacaksa çipte durur', () => {
  const env = loadCast()
  env.run('castState.ownMin = true')
  const modeFor = (o) => env.run('castModeFor(' + JSON.stringify(o) + ')')
  const own = modeFor({ watching: null, cams: false, game: false, sharing: true })
  assert.equal(own, 'own')
  assert.equal(env.run('castShowWanted(true, ' + JSON.stringify(own) + ')'), true)
  const above = [
    modeFor({ watching: '2', cams: false, game: false, sharing: true }),
    modeFor({ watching: null, cams: true, game: false, sharing: true }),
    modeFor({ watching: null, cams: false, game: true, sharing: true })
  ]
  assert.deepEqual(above, ['watch', 'cams', 'game'])
  for (const mode of above) assert.equal(env.run('castShowWanted(true, ' + JSON.stringify(mode) + ')'), false, mode)
  assert.equal(env.run("castShowWanted(false, 'own')"), false, 'paylaşım yok')
  env.sandbox.innerWidth = 600
  assert.equal(env.run("castShowWanted(true, 'own')"), false, 'dar ekranda önizleme küçültülmez')
  env.sandbox.innerWidth = 1440
  env.run('castState.ownMin = false')
  assert.equal(env.run("castShowWanted(true, 'own')"), false, 'önizleme küçük değil')
})

// Üst çubuk çipi (castRenderTop) kip değişince de yeniden kurulur: önizleme küçükken izlenen paylaşım veya kamera
// ızgarası kapanınca Önizlemeyi Göster Durdur'un önüne gelir. Odak düğmenin anahtarıyla korunur, Durdur'daki odak
// Önizlemeyi Göster'e kaymaz. Modül küçük DOM taklidiyle (test/oyun-ortam.js) yüklenir.
test('22-cast: üst çubuk çipi kip değişince yeniden kurulur, odaktaki düğme odağı korur', () => {
  const { makeDocument } = require('./oyun-ortam')
  const doc = makeDocument()
  doc.readyState = 'loading'
  const sandbox = {
    console,
    window: null,
    document: doc,
    innerWidth: 1440,
    isNarrow: () => sandbox.innerWidth < 760,
    storeGet: () => null,
    storeSet: () => {},
    t: (key) => key,
    h: (tag, className, text) => {
      const node = doc.createElement(tag)
      if (className) node.className = className
      if (text !== undefined && text !== null) node.textContent = String(text)
      return node
    },
    icon: () => doc.createElement('svg'),
    clear: (node) => {
      while (node && node.firstChild) node.removeChild(node.firstChild)
    },
    setLive: (node, value) => {
      node.textContent = typeof value === 'function' ? value() : value
      return node.textContent
    },
    focusNode: (node) => {
      if (node) node.focus()
    },
    el: { topCast: doc.body.appendChild(doc.createElement('div')) },
    state: { inApp: true },
    voice: null
  }
  sandbox.window = sandbox
  sandbox.addEventListener = () => {}
  vm.createContext(sandbox)
  vm.runInContext(fs.readFileSync(path.join(PUB, 'js', '22-cast.js'), 'utf8'), sandbox, { filename: '22-cast.js' })
  const run = (code) => vm.runInContext(code, sandbox)
  const chip = () => Array.from(sandbox.el.topCast.querySelectorAll('button')).map((b) => b.getAttribute('data-focus-key'))
  const active = () => doc.activeElement.getAttribute('data-focus-key')
  const top = (mode) => run("castRenderTop({ state: 'live' }, {}, true, " + JSON.stringify(mode) + ')')
  run('castState.ownMin = true')
  // İzlerken çipte yalnızca Durdur, kişi Durdur'a gelir, izlenen paylaşım biter (watch'tan own'a)
  top('watch')
  assert.deepEqual(chip(), ['cast-top-stop'])
  sandbox.el.topCast.querySelector('.top-cast-stop').focus()
  top('own')
  assert.deepEqual(chip(), ['cast-top-show', 'cast-top-stop'])
  assert.equal(active(), 'cast-top-stop', 'odak Durdur\'da kalır')
  // Kamera ızgarası açılınca Önizlemeyi Göster kalkar, ızgara kapanınca geri gelir, odak yine Durdur'da
  top('cams')
  assert.deepEqual(chip(), ['cast-top-stop'])
  assert.equal(active(), 'cast-top-stop')
  top('own')
  assert.equal(active(), 'cast-top-stop')
  // Önizlemeyi Göster odaktayken o düğme kalkarsa odak çipteki ilk düğmeye (Durdur) gider
  sandbox.el.topCast.querySelector('.top-cast-show').focus()
  top('watch')
  assert.equal(active(), 'cast-top-stop')
  // Odak çipte değilken yeniden kurulum odağı taşımaz
  doc.body.focus()
  top('own')
  assert.equal(doc.activeElement, doc.body)
})

test('22-cast: Yüzen Pencere düğmesi kendi paylaşımında ve izlerken, Küçült yalnızca kendi paylaşımında', () => {
  const env = loadCast()
  const n = { float: env.attr(), ownMin: env.attr() }
  env.sandbox.__n = n
  // Yüzen pencere modülü yokken düğme gizli
  env.run("castRenderFloatTools(__n, 'own')")
  assert.equal(n.float.hidden, true)
  assert.equal(n.ownMin.hidden, false)
  assert.equal(n.ownMin.attrs['aria-label'], 'cast.minimizeLabel')
  env.run("var floatMode = function () { return 'document' }")
  const cases = [['own', false, false, 'float.openLabel'], ['watch', false, true, 'cast.floatLabel'], ['cams', true, true, 'cast.floatLabel']]
  for (const [mode, floatHidden, minHidden, label] of cases) {
    env.run('castRenderFloatTools(__n, ' + JSON.stringify(mode) + ')')
    assert.deepEqual([n.float.hidden, n.ownMin.hidden, n.float.attrs['aria-label']], [floatHidden, minHidden, label], mode)
  }
  // Saklanan seçim açılışta okunur
  const stored = loadCast({ store: { 'telsiz.castOwnMin': '1' } })
  stored.run('castInit()')
  assert.equal(stored.run('castState.ownMin'), true)
})

// Yüzen Pencere önizlemeyi yalnızca o paylaşım için kapatır: saklanan seçim yalnızca Küçült ve Önizlemeyi Göster
// ile değişir, paylaşım bitince önizleme saklanan seçime döner (sonraki paylaşım önizlemeyle başlar)
test('22-cast: kendi paylaşımında Yüzen Pencere önizlemeyi saklamadan küçültür, paylaşım bitince seçim geri gelir', async () => {
  const env = loadCast({ store: { 'telsiz.castOwnMin': '0' } })
  env.sandbox.toast = () => {}
  env.run("el.cast.setAttribute('data-mode', 'own')")
  env.run('var floatOpen = function (reason) { __calls.push("float:" + reason); return Promise.resolve(true) }')
  env.run('castFloat()')
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(env.calls, ['float:share-own', 'sync'])
  assert.equal(env.run('castState.ownMin'), true, 'bu paylaşımda önizleme küçük')
  assert.equal(env.store.get('telsiz.castOwnMin'), '0', 'saklanan seçim değişmedi')
  env.run("castOnScreenEvent({ type: 'local-stop', reason: 'user' })")
  assert.equal(env.run('castState.ownMin'), false, 'sonraki paylaşım önizlemeyle başlar')
  // Küçült'le saklanan seçim paylaşım bitince de korunur
  env.run('castMinimizeOwn()')
  assert.equal(env.store.get('telsiz.castOwnMin'), '1')
  env.run("castOnScreenEvent({ type: 'local-stop', reason: 'user' })")
  assert.equal(env.run('castState.ownMin'), true)
  // Yüzen pencere açılamazsa önizleme küçülmez
  const failed = loadCast()
  failed.run("el.cast.setAttribute('data-mode', 'own')")
  failed.run('var floatOpen = function () { return Promise.resolve(false) }')
  failed.run('castFloat()')
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(failed.run('castState.ownMin'), false)
  assert.equal(failed.store.has('telsiz.castOwnMin'), false)
})
