'use strict'

// Gezinme (public/js/38-gezinme.js, istek 17). Modüller tarayıcıdaki gibi ortak bir genel ortamda Node vm
// bağlamında yüklenir. Tarayıcı geçmişi (pushState, replaceState, go ve zaman uyumsuz popstate) bellekte taklit
// edilir, konuşma açan işlevler (selectChannel, showDm, showHome) görünümü değiştiren basit taklitlerdir.
// Sınananlar: kök kayıt, konuşma kayıtlarının sırası, geri ve ileri tuşuyla dönüş, katman kayıtları (sayfa,
// profil kartı, sayfa değişimi, satıra basınca sayfanın kaydının yeni konuşmayla değişmesi), başka hesabın ve
// uygulama dışının kayıtlarının yok sayılması, kilitli katmanda geri tuşu ve oturum kapanınca geri sarma.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const PUB = path.join(__dirname, '..', 'public')
const FILES = ['i18n.js', 'js/01-core.js', 'js/02-state-dom.js', 'js/38-gezinme.js']
const SOURCES = FILES.map((file) => ({ file: file, code: fs.readFileSync(path.join(PUB, file), 'utf8') }))

function makeStorage () {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v))
    },
    removeItem: (k) => {
      map.delete(k)
    }
  }
}

// Tarayıcı geçmişinin taklidi: go zaman uyumsuzdur ve hedef kayıt varsa popstate yayımlar
function makeHistory () {
  const h = { entries: [{ state: null }], index: 0, listeners: [], calls: [] }
  const copy = (s) => (s === null || s === undefined ? null : JSON.parse(JSON.stringify(s)))
  const fire = () => {
    const ev = { state: copy(h.entries[h.index].state) }
    h.listeners.forEach((fn) => fn(ev))
  }
  h.api = {
    get state () {
      return copy(h.entries[h.index].state)
    },
    get length () {
      return h.entries.length
    },
    pushState (s) {
      h.calls.push('push')
      h.entries.splice(h.index + 1)
      h.entries.push({ state: copy(s) })
      h.index += 1
    },
    replaceState (s) {
      h.calls.push('replace')
      h.entries[h.index] = { state: copy(s) }
    },
    go (n) {
      h.calls.push('go' + n)
      const target = h.index + n
      if (!n || target < 0 || target >= h.entries.length) return
      setTimeout(() => {
        h.index = target
        fire()
      }, 0)
    },
    back () {
      h.api.go(-1)
    }
  }
  // Kişinin geri ve ileri tuşu
  h.user = (n) => h.api.go(n)
  h.top = () => h.entries[h.index].state ? h.entries[h.index].state.telsiz : null
  h.list = () => h.entries.slice(0, h.index + 1).map((e) => {
    const s = e.state ? e.state.telsiz : null
    if (!s) return null
    return s.overlay ? s.d + ':' + s.overlay : s.d + ':' + s.view + (s.id === null ? '' : '-' + s.id)
  })
  return h
}

// Odalar 10, 11, 12 (yazı), özel konuşma 50, kullanıcı 1
function load () {
  const sandbox = vm.createContext({})
  const hist = makeHistory()
  sandbox.self = sandbox
  sandbox.window = sandbox
  sandbox.setTimeout = setTimeout
  sandbox.clearTimeout = clearTimeout
  sandbox.history = hist.api
  sandbox.addEventListener = (type, fn) => {
    if (type === 'popstate') hist.listeners.push(fn)
  }
  sandbox.localStorage = makeStorage()
  sandbox.sessionStorage = makeStorage()
  sandbox.localStorage.setItem('telsiz.lang', 'tr')
  sandbox.navigator = { languages: ['tr-TR'], language: 'tr-TR', userAgent: 'node' }
  sandbox.document = { documentElement: { lang: 'tr' }, readyState: 'loading', hidden: false, getElementById: () => null, activeElement: null }
  sandbox.console = { warn () {}, log () {}, error () {} }
  for (const src of SOURCES) vm.runInContext(src.code, sandbox, { filename: src.file })
  const run = (code) => vm.runInContext(code, sandbox)
  run(`
    state.me = { id: 1, name: 'burak', role: 'owner' }
    state.inApp = true
    state.channelId = 10
    var testView = 'channel'
    var testRooms = { 10: true, 11: true, 12: true }
    var testDms = { 50: true }
    var testCalls = []
    function userKey (name) { return 'telsiz.' + name + '.' + (state.me ? state.me.id : '') }
    function currentViewMode () { return testView }
    function findChannel (id) { return testRooms[id] ? { id: Number(id), type: 'text', name: 'oda' + id } : null }
    function dmEntry (id) { return testDms[id] ? { id: Number(id), userId: 2 } : null }
    function selectChannel (id, opts) {
      testCalls.push('channel-' + id + (opts && opts.fromHistory ? '-geçmiş' : ''))
      testView = 'channel'
      state.channelId = Number(id)
      navOnConversation(opts)
    }
    function showDm (id, opts) {
      testCalls.push('dm-' + id + (opts && opts.fromHistory ? '-geçmiş' : ''))
      testView = 'dm'
      state.channelId = Number(id)
      navOnConversation(opts)
    }
    function showHome (tab, opts) {
      testCalls.push('home' + (opts && opts.fromHistory ? '-geçmiş' : ''))
      testView = 'home'
      state.channelId = null
      navOnConversation(opts)
    }
    function testOpen (name, level, locked) {
      openLayer({ name: name, el: {}, level: level || 1, focus: false, locked: locked === true, onClose: () => { testCalls.push('kapandı-' + name) } })
    }
    function testClose (name) {
      const layer = findLayer(name)
      if (layer) closeLayer(layer, false)
    }
    function testOpenNames () { return layers.map((l) => l.name) }
    navInit()
    navStart()
  `)
  return { run: run, hist: hist, json: (code) => JSON.parse(run('JSON.stringify(' + code + ')')) }
}

// Mikro görevler ve zaman uyumsuz popstate olayları biter
async function settle () {
  let i = 0
  while (i < 6) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    i += 1
  }
}

test('geçmiş: kök kayıt açık konuşmayla yazılır, konuşma geçişleri sırayla eklenir, adres değişmez', async () => {
  const { run, hist } = load()
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-10'])
  assert.deepStrictEqual(hist.calls, ['replace'])
  assert.strictEqual(hist.top().u, 1)
  run('selectChannel(11, {})')
  await settle()
  run('showDm(50, { focus: true })')
  await settle()
  run('showHome(null, {})')
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-10', '1:channel-11', '2:dm-50', '3:home'])
  // Aynı konuşmayı yeniden seçmek ve programın seçimi (force) yeni kayıt eklemez
  run('selectChannel(12, { force: true })')
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-10', '1:channel-11', '2:dm-50', '3:channel-12'])
  assert.strictEqual(hist.entries.length, 4)
})

test('geçmiş: geri tuşu önceki konuşmaları sırayla açar, ileri tuşu geri getirir, yeni geçiş ileriyi siler', async () => {
  const { run, hist, json } = load()
  run('selectChannel(11, {})')
  await settle()
  run('showDm(50, {})')
  await settle()
  run('showHome(null, {})')
  await settle()
  run('testCalls.length = 0')
  hist.user(-1)
  await settle()
  hist.user(-1)
  await settle()
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('testCalls'), ['dm-50-geçmiş', 'channel-11-geçmiş', 'channel-10-geçmiş'])
  assert.strictEqual(hist.index, 0)
  assert.deepStrictEqual(json('[testView, state.channelId]'), ['channel', 10])
  // Geçmişten gelen geçişler kayıt eklemez
  assert.strictEqual(hist.entries.length, 4)
  // Kök kayıttan geri basmak uygulamadan çıkarır: tuzak kaydı yok
  hist.user(-1)
  await settle()
  assert.strictEqual(hist.index, 0)
  assert.strictEqual(hist.entries.length, 4)
  hist.user(1)
  await settle()
  assert.deepStrictEqual(json('[testView, state.channelId]'), ['channel', 11])
  run('selectChannel(12, {})')
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-10', '1:channel-11', '2:channel-12'])
  assert.strictEqual(hist.entries.length, 3)
})

test('geçmiş: sayfa ve profil kartı kendi kaydını ekler, geri tuşu önce en üstteki katmanı kapatır', async () => {
  const { run, hist, json } = load()
  run('selectChannel(11, {})')
  await settle()
  run("testOpen('sheet-people', 1)")
  await settle()
  run("testOpen('profile-card', 2)")
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-10', '1:channel-11', '2:sheet-people', '3:profile-card'])
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('testOpenNames()'), ['sheet-people'])
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('testOpenNames()'), [])
  assert.deepStrictEqual(json('[testView, state.channelId]'), ['channel', 11], 'konuşma değişmedi')
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('[testView, state.channelId]'), ['channel', 10])
  // İleri tuşu katmanı açık olmayan katman kaydına gelince kayıt atlanır
  hist.user(1)
  await settle()
  hist.user(1)
  await settle()
  assert.deepStrictEqual(json('[testView, state.channelId, testOpenNames()]'), ['channel', 11, []])
  assert.strictEqual(hist.index, 1)
})

test('geçmiş: Esc ile kapanan katmanın kaydı geri alınır, satıra basınca sayfanın kaydı yeni konuşmayla değişir', async () => {
  const { run, hist, json } = load()
  run("testOpen('search', 1)")
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-10', '1:search'])
  run("testClose('search')")
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-10'])
  // Sayfa açıkken başka sayfa açılır: kayıt yer değiştirir
  run("testOpen('sheet-stations', 1)")
  await settle()
  run("testOpen('sheet-people', 1)")
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-10', '1:sheet-people'])
  run("testClose('sheet-people'); testOpen('sheet-stations', 1)")
  await settle()
  // İstasyonlar sayfasındaki satır: sayfa kapanır ve oda açılır (aynı görevde)
  run("testClose('sheet-stations'); selectChannel(12, {})")
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-10', '1:channel-12'])
  assert.deepStrictEqual(json('testOpenNames()'), [])
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('[testView, state.channelId]'), ['channel', 10])
  // Profil kartından özel mesaja geçiş: kart açık kalsa da konuşmanın kaydı kartın altına girer
  run("testOpen('profile-card', 2)")
  await settle()
  run('showDm(50, {})')
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-10', '1:dm-50', '2:profile-card'])
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('[testView, state.channelId, testOpenNames()]'), ['dm', 50, []])
})

test('geçmiş: başka hesabın kaydı ve uygulama dışındaki olay yok sayılır, kilitli katman açıkken geri gidilmez', async () => {
  const { run, hist, json } = load()
  run('selectChannel(11, {})')
  await settle()
  // Aynı adreste başka bir hesabın kaydı
  hist.entries[0].state.telsiz.u = 2
  run('testCalls.length = 0')
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('[testCalls, testView, state.channelId]'), [[], 'channel', 11])
  hist.user(1)
  await settle()
  hist.entries[0].state.telsiz.u = 1
  // Kilitli katman (kurtarma kodu penceresi): geçmiş eski yerine döner, katman açık kalır
  run("testOpen('app-dialog', 3, true)")
  await settle()
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('[testCalls, testOpenNames(), state.channelId]'), [[], ['app-dialog'], 11])
  assert.strictEqual(hist.index, 1)
  run("closeLayer(findLayer('app-dialog'), false)")
  // Uygulamadan çıkıldıysa olay yok sayılır
  run('testCalls.length = 0; state.inApp = false')
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('[testCalls, state.channelId]'), [[], 11])
})

test('geçmiş: oturum kapanınca açık katmanların kayıtları geri sarılır, yeniden açılışta kök kayıt yazılır', async () => {
  const { run, hist } = load()
  run('selectChannel(11, {})')
  await settle()
  run("testOpen('settings', 1)")
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-10', '1:channel-11', '2:settings'])
  // 03-auth.js resetAppState: katmanlar kapanır, uygulamadan çıkılır
  run('closeAllLayers(); state.inApp = false')
  await settle()
  assert.strictEqual(hist.index, 0)
  assert.strictEqual(hist.top().view, 'channel')
  run('state.inApp = true; state.channelId = 12; navStart()')
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-12'])
})

test('okunmamış: ilk okunmamış kendi mesajlarını atlar, okuma kaydı yoksa ayraç yok, sayfanın hepsi yeniyse çevresi yüklenir', () => {
  const { json } = load()
  // Kullanıcı 1: 6 numaralı mesaj kendi mesajı
  const list = '[{ id: 5, authorId: 2 }, { id: 6, authorId: 1 }, { id: 7, authorId: 2 }, { id: 8, authorId: 3 }]'
  assert.deepStrictEqual(json('[navFirstUnread(' + list + ', 5), navFirstUnread(' + list + ', 4), navFirstUnread(' + list + ', 0), navFirstUnread(' + list + ', 8)]'), [2, 0, -1, -1])
  assert.deepStrictEqual(json('[navCountUnread(' + list + ', 5), navCountUnread(' + list + ', 4), navCountUnread(' + list + ', 0)]'), [2, 3, 0])
  // En yeni sayfanın ilk mesajı son okunandan yeniyse ve daha eskisi varsa ilk okunmamış bu sayfada olmayabilir
  assert.deepStrictEqual(json('[navNeedsAround(' + list + ', true, 4), navNeedsAround(' + list + ', true, 5), navNeedsAround(' + list + ', false, 4), navNeedsAround(' + list + ', true, 0), navNeedsAround([], true, 4)]'),
    [true, false, false, false, false])
})
