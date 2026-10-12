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
// Mesajlar ve görünümün hatırlanması. G10: konuşma önbelleği (son sekiz konuşma, aynı konuşmanın yeniden yüklenmesi,
// anahtar ve hesap değişimi, önbelleğe uygulanan olaylar, kapsül sayısı ve kırpma), kısayolların konuşma sırası ve sıradaki
// okunmamış konuşma.

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

// Katmanın ilk odağı (02-state-dom.js openLayer) bir sonraki karede verilir (burada requestAnimationFrame yok, 16 ms
// sonra). Kare gelmeden odak katmanın içinde başka bir öğeye geçtiyse (Ctrl+K aramasında yazılıp aşağı okla sonuca
// inilmesi) ilk odak onu geri almaz. Odak açılıştan beri değişmediyse, dışarıda da katmanın içinde de olsa, ilk odak verilir.
test('katman: ilk odak, kare gelmeden katmanın içinde seçilen öğeyi geri almaz, odak değişmediyse verilir', async () => {
  const { run, json } = load()
  run(`
    var testFocus = []
    function testNode (name, parent) {
      const node = {
        name: name,
        parent: parent || null,
        focus () {
          testFocus.push(name)
          document.activeElement = node
        },
        contains (other) {
          let n = other
          while (n) {
            if (n === node) return true
            n = n.parent
          }
          return false
        }
      }
      return node
    }
    var testPanel = testNode('panel')
    var testInput = testNode('input', testPanel)
    var testItem = testNode('item', testPanel)
    var testOutside = testNode('outside')
    function testOpenPanel () {
      testFocus.length = 0
      openLayer({ name: 'deneme', el: testPanel, level: 1, initialFocus: () => testInput, onClose: () => {} })
    }
  `)
  const frame = () => new Promise((resolve) => setTimeout(resolve, 40))
  // Kare gelmeden aşağı ok sonuca odaklanır
  run('document.activeElement = testOutside; testOpenPanel(); testItem.focus()')
  await frame()
  assert.deepStrictEqual(json('[document.activeElement.name, testFocus]'), ['item', ['item']])
  run("testClose('deneme')")
  // Odak dışarıda kaldı
  run('document.activeElement = testOutside; testOpenPanel()')
  await frame()
  assert.deepStrictEqual(json('[document.activeElement.name, testFocus]'), ['input', ['input']])
  run("testClose('deneme')")
  // Odak açılışta zaten katmanın içindeydi ve değişmedi
  run('document.activeElement = testItem; testOpenPanel()')
  await frame()
  assert.deepStrictEqual(json('[document.activeElement.name, testFocus]'), ['input', ['input']])
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

// G10 (S6): konum ve önbellek. Konuşmanın çizimi taklit edilir: testShow önce çizili konuşmadan ayrılır
// (06-messages.js loadChannel gibi), sonra yeni konuşmanın mesajlarını koyar ve yüklemeyi bitmiş sayar.
function loadCache () {
  const ctx = load()
  ctx.run(`
    var testBottom = true
    var testKid = 'a'
    function isNearBottom () { return testBottom }
    function validMessage (m) { return Boolean(m && typeof m === 'object' && m.id !== undefined && m.id !== null && typeof m.body === 'string') }
    function activeKid () { return testKid }
    function testMsg (id, channelId, authorId, body) { return { id: id, channelId: channelId, authorId: authorId || 2, body: body || 'zarf-' + id } }
    function testShow (id, ids) {
      const switching = navCacheLeave(id)
      state.channelId = id
      state.messages = ids.map((x) => testMsg(x, id))
      navCacheReady()
      return switching
    }
    function testKeys () { return Array.from(navCache.map.keys()) }
  `)
  return ctx
}

test('önbellek: son sekiz konuşma tutulur, aynı konuşmanın yeniden yüklenmesi kaydı siler, anahtar veya hesap değişince kayıt kullanılmaz', () => {
  const { run, json } = loadCache()
  run('let i = 10; while (i < 20) { testShow(i, [i * 100 + 1, i * 100 + 2]); i += 1 }')
  assert.deepStrictEqual(json('testKeys()'), ['11', '12', '13', '14', '15', '16', '17', '18'])
  // Kayıt şifreli zarfları ve konumu tutar
  assert.deepStrictEqual(json("[navCache.map.get('12').messages.map((m) => m.body), navCache.map.get('12').stick, navCache.map.get('12').hasMore]"), [['zarf-1201', 'zarf-1202'], true, false])
  // Önbellekteki konuşmaya geçiş (06-messages.js loadChannel): çizili konuşma yazılır, en eski kayıt düşer, açılan
  // konuşmanın kaydı alınır. Yüklemesi bitmeden ayrılan konuşma kayıt yazmaz.
  assert.strictEqual(json('navCacheLeave(12)'), true)
  run('navCacheTake(12)')
  assert.deepStrictEqual(json('testKeys()'), ['13', '14', '15', '16', '17', '18', '19'])
  run('navCacheLeave(13)')
  assert.deepStrictEqual(json('[testKeys().length, navCache.shown]'), [7, 13])
  // Aynı konuşma yeniden yükleniyor (En Yeni Mesajlara Dön, Tekrar Dene): geçiş sayılmaz, kaydı silinir
  assert.strictEqual(json('navCacheLeave(13)'), false)
  assert.strictEqual(json("navCache.map.has('13')"), false)
  // Alınan kayıt önbellekten çıkar
  assert.deepStrictEqual(json('navCacheTake(15).messages.map((m) => m.id)'), [1501, 1502])
  assert.strictEqual(json("navCache.map.has('15')"), false)
  assert.strictEqual(json('navCacheTake(15)'), null)
  // Anahtar değişti: kayıt kullanılmaz ve silinir
  run("testKid = 'b'")
  assert.strictEqual(json('navCacheTake(16)'), null)
  assert.strictEqual(json("navCache.map.has('16')"), false)
  run("testKid = 'a'")
  // Başka hesap: kayıt kullanılmaz
  run("state.me = { id: 2, name: 'ece', role: 'member' }")
  assert.strictEqual(json('navCacheTake(17)'), null)
  run("state.me = { id: 1, name: 'burak', role: 'owner' }")
  assert.deepStrictEqual(json('navCacheTake(18).messages.length'), 2)
  // Oturum kapanınca önbellek ve çizili konuşma bilgisi silinir
  run('navStop()')
  assert.deepStrictEqual(json('[testKeys(), navCache.shown, navCache.ready]'), [[], null, false])
})

test('önbellek: gelen, düzenlenen ve silinen mesaj önbelleğe uygulanır, yukarıdan ayrılan konuşmada kapsül sayılır', () => {
  const { run, json } = loadCache()
  run('testShow(30, [1, 2, 3]); testBottom = false; navState.newBelow = 2; testShow(31, [5])')
  assert.deepStrictEqual(json("[navCache.map.get('30').stick, navCache.map.get('30').newBelow]"), [false, 2])
  const entry = (code) => json("(function () { const e = navCache.map.get('30'); return " + code + ' })()')
  run('navCacheApply({ type: \'msg\', channelId: 30, message: testMsg(4, 30) })')
  run('navCacheApply({ type: \'msg\', channelId: 30, message: testMsg(6, 30, 1) })')
  // Sıra dışı gelen mesaj yerine girer, aynı mesaj iki kez eklenmez
  run('navCacheApply({ type: \'msg\', channelId: 30, message: testMsg(5, 30) })')
  run('navCacheApply({ type: \'msg\', channelId: 30, message: testMsg(5, 30) })')
  assert.deepStrictEqual(entry('[e.messages.map((m) => m.id), e.newBelow]'), [[1, 2, 3, 4, 5, 6], 4])
  run('navCacheApply({ type: \'edit\', channelId: 30, message: testMsg(2, 30, 2, \'yeni-zarf\') })')
  run('navCacheApply({ type: \'edit\', channelId: 30, message: testMsg(99, 30, 2, \'yok\') })')
  run('navCacheApply({ type: \'del\', channelId: 30, messageId: 1 })')
  assert.deepStrictEqual(entry('e.messages.map((m) => m.body)'), ['yeni-zarf', 'zarf-3', 'zarf-4', 'zarf-5', 'zarf-6'])
  // Önbellekte olmayan konuşmanın ve geçersiz olayın etkisi yok
  run('navCacheApply({ type: \'msg\', channelId: 77, message: testMsg(1, 77) }); navCacheApply({ type: \'msg\', channelId: 30, message: { id: 8 } }); navCacheApply(null)')
  assert.deepStrictEqual(entry('e.messages.length'), 5)
  // En alttan ayrılan konuşmada kapsül sayılmaz
  run('testBottom = true; navState.newBelow = 0; testShow(32, [9])')
  run('navCacheApply({ type: \'msg\', channelId: 31, message: testMsg(7, 31) })')
  assert.deepStrictEqual(json("[navCache.map.get('31').messages.map((m) => m.id), navCache.map.get('31').newBelow]"), [[5, 7], 0])
  // Daha yeni mesajları yüklü olmayan eski bölüm: mesaj eklenmez, şerit uyarır
  run("navCache.map.get('30').hasNewer = true")
  run('navCacheApply({ type: \'msg\', channelId: 30, message: testMsg(10, 30) })')
  assert.deepStrictEqual(entry('[e.messages.length, e.newWhileOlder]'), [5, true])
  // Yukarıdan ayrılan konuşma MAX_RENDERED'ı aşsa da kırpılmaz (canlı listedeki gibi): yüklenen eski mesajlar ve
  // dönülecek mesaj (çapa) kalır
  run("navCache.map.get('30').hasNewer = false; navCache.map.get('30').anchor = { id: 3, offset: 12 }")
  run('let k = 100; while (k < 100 + MAX_RENDERED) { navCacheApply({ type: \'msg\', channelId: 30, message: testMsg(k, 30) }); k += 1 }')
  assert.deepStrictEqual(entry('[e.messages.length, e.hasMore, e.messages[0].id, e.messages.some((m) => m.id === e.anchor.id)]'), [json('MAX_RENDERED') + 5, false, 2, true])
  // En alttan ayrılan konuşmada liste MAX_RENDERED'ı aşınca en eskiler düşer, daha eskisi yüklenebilir (liste
  // MAX_RENDERED + 1 mesaja ulaşınca TRIM_TO'ya iner, ardından son mesaj eklenir)
  run('let j = 100; while (j < 100 + MAX_RENDERED) { navCacheApply({ type: \'msg\', channelId: 31, message: testMsg(j, 31) }); j += 1 }')
  assert.deepStrictEqual(json("(function () { const e = navCache.map.get('31'); return [e.messages.length, e.hasMore, e.messages[e.messages.length - 1].id] })()"), [json('TRIM_TO') + 1, true, 699])
})

test('önbellek: düzenlenen mesajın önceki ve yeni hâli DJ ad kuralına verilir (06-messages.js noteDjTitleEdit), gövde aynıysa verilmez', () => {
  // DJ duyurusuna yalnızca ad ekleyen düzenleme konuşma önbellekteyken gelirse de açık konuşmadaki gibi kaydedilir,
  // dönünce "düzenlendi" etiketi çıkmaz. İki hâl önbelleksiz çözülür (decryptMessageRaw), açık konuşmanın çözme
  // önbelleği değişmez.
  const { run, json } = loadCache()
  run(`
    var testNotes = []
    function decryptMessageRaw (m) { return { state: 'ok', text: '', dj: { op: 'add', src: 'yt', vid: 'D120aaaaaaa', from: m.body } } }
    function noteDjTitleEdit (prev, m, before, after) { testNotes.push([prev.body, m.body, before.dj.from, after.dj.from]) }
  `)
  run('testShow(30, [1, 2]); testShow(31, [5])')
  run("navCacheApply({ type: 'edit', channelId: 30, message: testMsg(2, 30, 2, 'adli-zarf') })")
  run("navCacheApply({ type: 'edit', channelId: 30, message: testMsg(2, 30, 2, 'adli-zarf') })")
  run("navCacheApply({ type: 'msg', channelId: 30, message: testMsg(3, 30) })")
  assert.deepStrictEqual(json('testNotes'), [['zarf-2', 'adli-zarf', 'zarf-2', 'adli-zarf']])
  assert.deepStrictEqual(json("navCache.map.get('30').messages.map((m) => m.body)"), ['zarf-1', 'adli-zarf', 'zarf-3'])
})

test('kısayollar: önceki ve sonraki konuşma sırası, uçlarda başa dönüş, sıradaki okunmamış (anmalar ve özel mesajlar önce)', () => {
  const { run, json } = load()
  run(`
    var testEntries = [{ id: 50, userId: 2, lastMessageAt: 300 }, { id: 51, userId: 3, lastMessageAt: 200 }]
    var testMentions = {}
    function bandDmEntries () { return testEntries.slice() }
    function textChannels () { return [{ id: 10, name: 'a' }, { id: 11, name: 'b' }, { id: 12, name: 'c' }] }
    function mentionCount (id) { return testMentions[id] || 0 }
  `)
  const step = (key, dir) => json('(function () { const c = navStepConv(navConvList(), ' + JSON.stringify(key) + ', ' + dir + '); return c ? c.key : null })()')
  const unread = (key, dir) => json('(function () { const c = navNextUnread(navConvList(), ' + JSON.stringify(key) + ', ' + dir + '); return c ? c.key : null })()')
  // İstasyonlar listesindeki sıra: yazı odaları, sonra özel konuşmalar
  assert.deepStrictEqual(json('navConvList().map((c) => c.key)'), ['c:10', 'c:11', 'c:12', 'd:50', 'd:51'])
  assert.strictEqual(json('navConvKey()'), 'c:10')
  assert.deepStrictEqual([step('c:10', 1), step('c:10', -1), step('d:51', 1), step('c:12', 1)], ['c:11', 'd:51', 'c:10', 'd:50'])
  // Arkadaşlar görünümünde aşağı ilk, yukarı son konuşma
  run("testView = 'home'; state.channelId = null")
  assert.deepStrictEqual([json('navConvKey()'), step('', 1), step('', -1)], ['', 'c:10', 'd:51'])
  run("testView = 'channel'; state.channelId = 10")
  // Okunmamış yoksa gidilmez, okunmamışlar sırayla, yukarı yönde geriye doğru
  assert.strictEqual(unread('c:10', 1), null)
  run('state.unread[11] = 3; state.unread[12] = 1')
  assert.deepStrictEqual([unread('c:10', 1), unread('c:10', -1), unread('c:11', 1)], ['c:11', 'c:12', 'c:12'])
  // Anması olan oda önce
  run('testMentions[12] = 1')
  assert.deepStrictEqual([unread('c:10', 1), unread('c:12', 1)], ['c:12', 'c:11'])
  // Özel mesajın okunmamışı anma sayılır, okunmamış özel konuşma grubun başına geçer
  run('state.unread[51] = 2')
  assert.deepStrictEqual(json('navConvList().map((c) => c.key)'), ['c:10', 'c:11', 'c:12', 'd:51', 'd:50'])
  assert.deepStrictEqual([unread('c:12', 1), unread('c:10', -1)], ['d:51', 'd:51'])
  // Açık konuşmanın okunmamışı sayılmaz
  run("testView = 'dm'; state.channelId = 51")
  assert.deepStrictEqual([json('navConvKey()'), unread('d:51', 1)], ['d:51', 'c:12'])
  // Tek konuşma varken önceki ve sonraki yoktur
  run("testEntries.length = 0; textChannels = function () { return [{ id: 10, name: 'a' }] }; testView = 'channel'; state.channelId = 10")
  assert.strictEqual(step('c:10', 1), null)
})

test('okunmamış alt sınırı: sayfanın hepsi okunmamışsa ve daha eskisi varsa "+" işareti, okununca ve kesin sayı bilinince kalkar', () => {
  const { run, json } = load()
  const page = '[{ id: 60, authorId: 2 }, { id: 61, authorId: 2 }, { id: 62, authorId: 1 }]'
  assert.deepStrictEqual(json('[navPageIsPartial(' + page + ', true, 40), navPageIsPartial(' + page + ', true, 60), navPageIsPartial(' + page + ', false, 40), navPageIsPartial([], true, 40), navPageIsPartial(' + page + ', true, 0)]'),
    [true, false, false, false, true])
  run('state.unread[11] = 50; navSetUnreadMore(11, true); navSetUnreadMore(12, true)')
  // Okunmamışı olmayan konuşmada işaret yok sayılır
  assert.deepStrictEqual(json('[navUnreadIsMore(11), navUnreadIsMore(12)]'), [true, false])
  run('navAfterRead(11)')
  assert.strictEqual(json('navUnreadIsMore(11)'), false)
  // Konuşma açılınca sayılan sayı kesinse işaret kalkar, alt sınırsa kalır (06-messages.js loadChannel)
  run("state.unread[11] = 50; navSetUnreadMore(11, true); navState.unread = { channelId: 11, id: 61, since: 0, count: 60, more: false, mentions: 0, bar: true }; navKeepUnread(11)")
  assert.deepStrictEqual(json('[state.unread[11], navUnreadIsMore(11)]'), [60, false])
  run('navState.unread.more = true; navState.unread.count = 70; navKeepUnread(11)')
  assert.deepStrictEqual(json('[state.unread[11], navUnreadIsMore(11)]'), [70, true])
  // Özel mesajlar grubunun satırı da işareti taşır, oturum kapanınca işaretler silinir
  run(`
    function bandDmEntries () { return [{ id: 50, userId: 2, lastMessageAt: 1 }] }
    state.unread[50] = 50
    navSetUnreadMore(50, true)
  `)
  assert.deepStrictEqual(json('navDmGroup().stations.map((s) => [s.id, s.mention, s.more])'), [[50, 50, true]])
  run('navStop()')
  assert.deepStrictEqual(json('[navUnreadIsMore(11), navUnreadIsMore(50)]'), [false, false])
})
