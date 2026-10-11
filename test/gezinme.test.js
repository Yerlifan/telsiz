'use strict'

// Gezinme (public/js/38-gezinme.js, istek 17). Modüller tarayıcıdaki gibi ortak bir genel ortamda Node vm
// bağlamında yüklenir. Tarayıcı geçmişi (pushState, replaceState, go ve zaman uyumsuz popstate) bellekte taklit
// edilir, konuşma açan işlevler (selectChannel, showDm, showHome) görünümü değiştiren basit taklitlerdir.
// Sınananlar: kök kayıt, konuşma kayıtlarının sırası, geri ve ileri tuşuyla dönüş, katman kayıtları (sayfa,
// profil kartı, sayfa değişimi, satıra basınca sayfanın kaydının yeni konuşmayla değişmesi), başka hesabın ve
// uygulama dışının kayıtlarının yok sayılması, kilitli katmanda geri tuşu, kaydı olmayan katmanda (menü, kamera
// büyütme) geri tuşu ve oturum kapanınca geri sarma (açık katman yokken ve model eskimişken de). Ayrıca ilk okunmamış
// mesajın yeri (kendi mesajları atlanır), son okunanın çevresiyle yükleme kararı, okunmamış sayısının iki sayfadan
// sayılması ve alt sınırı, Özel mesajlar grubunun sırası (okunmamışlar önce), Özel düğmesinin açtığı konuşma, Tüm Özel
// Mesajlar ve görünümün hatırlanması.

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

test('geçmiş: kaydı olmayan katman (menü, kamera büyütme) en üstteyse geri tuşu yalnızca onu kapatır, konuşma değişmez', async () => {
  const { run, hist, json } = load()
  run('selectChannel(11, {})')
  await settle()
  // Durum menüsü geçmişe yazılmaz
  run("testOpen('status-menu', 2)")
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-10', '1:channel-11'])
  run('testCalls.length = 0')
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('[testCalls, testOpenNames(), testView, state.channelId]'), [['kapandı-status-menu'], [], 'channel', 11])
  assert.strictEqual(hist.index, 1, 'geçmiş eski yerine döndü')
  assert.deepStrictEqual(json('navState.stack.length'), 2)
  // Sayfanın üstündeki menü: önce menü, sonra sayfa kapanır
  run("testOpen('sheet-stations', 1); testOpen('frekans-menu', 2)")
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-10', '1:channel-11', '2:sheet-stations'])
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('testOpenNames()'), ['sheet-stations'])
  assert.strictEqual(hist.index, 2)
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('[testOpenNames(), state.channelId]'), [[], 11])
  assert.strictEqual(hist.index, 1)
  // Kamera büyütmenin üstünde profil kartı: önce kart kapanır, kamera büyütme açık kalır, sonra o kapanır, en son
  // önceki konuşmaya dönülür
  run("testOpen('cast-full', 1); testOpen('profile-card', 2)")
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-10', '1:channel-11', '2:profile-card'])
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('[testOpenNames(), state.channelId]'), [['cast-full'], 11])
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('[testOpenNames(), state.channelId]'), [[], 11])
  assert.strictEqual(hist.index, 1)
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('[testView, state.channelId]'), ['channel', 10])
  assert.strictEqual(hist.index, 0)
  // İleri tuşu da menüyü kapatır ve geçmişi yerinde tutar
  run("testOpen('emoji', 2)")
  hist.user(1)
  await settle()
  assert.deepStrictEqual(json('[testOpenNames(), state.channelId]'), [[], 10])
  assert.strictEqual(hist.index, 0)
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
  // Katmanlar kapanırken uygulamadan çıkılmışsa navReconcile de geri sarar (03-auth.js resetAppState ayrıca navStop
  // çağırır, aşağıdaki test)
  run('closeAllLayers(); state.inApp = false')
  await settle()
  assert.strictEqual(hist.index, 0)
  assert.strictEqual(hist.top().view, 'channel')
  run('state.inApp = true; state.channelId = 12; navStart()')
  await settle()
  assert.deepStrictEqual(hist.list(), ['0:channel-12'])
})

test('geçmiş: açık katman yokken oturum kapanınca da geri sarılır, eskimiş model kökün ötesine geri sarmaz', async () => {
  const { run, hist, json } = load()
  run('selectChannel(11, {})')
  await settle()
  run('selectChannel(12, {})')
  await settle()
  run('showDm(50, {})')
  await settle()
  assert.strictEqual(hist.index, 3)
  // 03-auth.js resetAppState: katman açık değil, navStop doğrudan çağrılır (katmanların kapanması bir şey bildirmez)
  run('navStop(); closeAllLayers(); state.inApp = false')
  await settle()
  assert.strictEqual(hist.index, 0)
  assert.deepStrictEqual(json('[navState.on, navState.stack.length]'), [false, 0])
  // Uygulama dışında ileri tuşu bir şey açmaz, yeniden girişte geri sarılacak kayıt yoktur
  run('testCalls.length = 0')
  hist.user(1)
  await settle()
  assert.deepStrictEqual(json('testCalls'), [], 'uygulama dışında geçmiş olayı yok sayılır')
  hist.user(-1)
  await settle()
  hist.calls.length = 0
  run("state.inApp = true; testView = 'channel'; state.channelId = 10; navStart()")
  await settle()
  assert.deepStrictEqual(hist.calls, ['replace'])
  assert.deepStrictEqual(hist.list(), ['0:channel-10'])

  // Model eskidiyse (uygulama dışındayken geri basıldı, navStop çağrılmadı) geri sarma tarayıcının o anki kaydındaki
  // d kadardır: modelin uzunluğu kadar geri gidilseydi kökün ötesindeki sayfaya çıkılırdı
  run('selectChannel(11, {})')
  await settle()
  run('selectChannel(12, {})')
  await settle()
  run('showDm(50, {})')
  await settle()
  run('state.inApp = false')
  hist.user(-1)
  await settle()
  assert.deepStrictEqual(json('[navState.on, navState.stack.length]'), [true, 4])
  assert.strictEqual(hist.index, 2)
  hist.calls.length = 0
  run('state.inApp = true; navStart()')
  await settle()
  assert.deepStrictEqual(hist.calls, ['go-2', 'replace'])
  assert.strictEqual(hist.index, 0)
  assert.deepStrictEqual(hist.list(), ['0:dm-50'])
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
  // Okunmamış sayısı: son okunanın çevresi ve en yeni sayfa birleşik sayılır (yinelenen ve kendi mesajlarım hariç).
  // Sayfalar bitişmiyorsa veya en eski yüklü mesaj son okunandan yeniyse ve daha eskisi varsa sayı alt sınırdır.
  const tally = (args) => json('(function () { const r = navUnreadTally(' + args + '); return [r.list.map((m) => m.id), r.more] })()')
  const near = '[{ id: 4, authorId: 2 }, { id: 5, authorId: 2 }, { id: 6, authorId: 1 }, { id: 7, authorId: 2 }]'
  assert.deepStrictEqual(tally(near + ', [{ id: 7, authorId: 2 }, { id: 8, authorId: 3 }, { id: 9, authorId: 2 }], 4, false, true'), [[5, 7, 8, 9], false])
  assert.deepStrictEqual(tally(near + ', [{ id: 20, authorId: 2 }, { id: 21, authorId: 2 }], 4, false, true'), [[5, 7, 20, 21], true])
  assert.deepStrictEqual(tally(near + ', null, 4, false, false'), [[5, 7], false])
  assert.deepStrictEqual(tally('[{ id: 10, authorId: 2 }, { id: 11, authorId: 2 }], null, 4, true, false'), [[10, 11], true])
  assert.deepStrictEqual(tally(near + ', null, 0, true, true'), [[], false])
})

test('özel mesaj grubu: okunmamışlar önce, sonra son mesaja göre, açık konuşma sayılmaz, altıdan fazlası Tüm Özel Mesajlar ile açılır', () => {
  const { run, json } = load()
  run(`
    var testEntries = [
      { id: 50, userId: 2, lastMessageAt: 100 },
      { id: 51, userId: 3, lastMessageAt: 300 },
      { id: 52, userId: 4, lastMessageAt: 200 },
      { id: 53, userId: 5, lastMessageAt: 50 }
    ]
    function bandDmEntries () { return testEntries.slice().sort((a, b) => b.lastMessageAt - a.lastMessageAt) }
    state.users.set('2', { id: 2, name: 'ece' })
    state.unread[50] = 2
    state.unread[53] = 1
  `)
  const unreadOf = '(id) => Number(state.unread[id]) || 0'
  assert.deepStrictEqual(json('navDmOrder(testEntries, ' + unreadOf + ').map((d) => d.id)'), [50, 53, 51, 52])
  // Geniş ekranda Özel düğmesi okunmamışı olan en yeni konuşmayı, yoksa son açılanı, o da yoksa en yenisini açar
  assert.strictEqual(json('navDmPick(testEntries, ' + unreadOf + ', 52).id'), 50)
  assert.strictEqual(json('navDmPick(testEntries, () => 0, 52).id'), 52)
  assert.strictEqual(json('navDmPick(testEntries, () => 0, 99).id'), 51)
  assert.strictEqual(json('navDmPick([], () => 0, null)'), null)
  let g = json('navDmGroup()')
  assert.strictEqual(g.label, 'Özel mesajlar')
  assert.deepStrictEqual(g.stations.map((s) => [s.id, s.mention, s.tuned]), [[50, 2, false], [53, 1, false], [51, 0, false], [52, 0, false]])
  assert.strictEqual(g.stations[0].label, 'ece ile özel mesajlar, 2 okunmamış')
  // Açık özel konuşmanın okunmamışı sayılmaz, satır işaretlidir
  run("testView = 'dm'; state.channelId = 50")
  g = json('navDmGroup()')
  assert.deepStrictEqual(g.stations.map((s) => [s.id, s.mention, s.tuned]), [[53, 1, false], [51, 0, false], [52, 0, false], [50, 0, true]])
  // Yedi konuşma: altı satır ve Tüm Özel Mesajlar, basınca hepsi ve Daha Az Göster
  run(`
    testView = 'channel'; state.channelId = 10
    testEntries.push({ id: 54, userId: 6, lastMessageAt: 40 }, { id: 55, userId: 7, lastMessageAt: 30 }, { id: 56, userId: 8, lastMessageAt: 20 })
  `)
  g = json('navDmGroup()')
  assert.deepStrictEqual(g.stations.map((s) => s.key), ['dm-50', 'dm-53', 'dm-51', 'dm-52', 'dm-54', 'dm-55', 'dm-all'])
  assert.deepStrictEqual([g.stations[6].name, g.stations[6].count, g.stations[6].expanded], ['Tüm Özel Mesajlar', 7, false])
  run('navToggleDmAll()')
  g = json('navDmGroup()')
  assert.strictEqual(g.stations.length, 8)
  assert.deepStrictEqual([g.stations[7].name, g.stations[7].expanded], ['Daha Az Göster', true])
  // Özel konuşma yoksa grup yoktur
  run('testEntries.length = 0')
  assert.strictEqual(json('navDmGroup()'), null)
})

test('görünüm: açık görünüm kişiye özel anahtarda saklanır, açılışta özel konuşma ve Arkadaşlar geri yüklenir', async () => {
  const { run, json } = load()
  run('selectChannel(11, {})')
  assert.deepStrictEqual(json("JSON.parse(localStorage.getItem('telsiz.view.1'))"), { mode: 'channel', id: '11' })
  assert.strictEqual(json('navSavedView()'), null, 'yazı odası 04-meta.js openApp ile açılır')
  run('showDm(50, {})')
  assert.deepStrictEqual(json("JSON.parse(localStorage.getItem('telsiz.view.1'))"), { mode: 'dm', id: '50' })
  assert.deepStrictEqual(json('navSavedView()'), { mode: 'dm', id: 50 })
  // Geri tuşuyla gelinen görünüm de saklanır
  await settle()
  run('showHome(null, { fromHistory: true })')
  assert.deepStrictEqual(json('navSavedView()'), { mode: 'home', id: null })
  // Listeden kalkan özel konuşma geri yüklenmez, başka hesabın kaydı okunmaz
  run('showDm(50, {}); delete testDms[50]')
  assert.strictEqual(json('navSavedView()'), null)
  run("state.me = { id: 2, name: 'ece', role: 'member' }")
  assert.strictEqual(json('navSavedView()'), null)
})
