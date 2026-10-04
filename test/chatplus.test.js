'use strict'

// Arama, @ ile anma ve yazıyor göstergesi yardımcılarının (public/js/17-search.js, 18-mentions.js,
// 19-typing.js) testleri. Modüller tarayıcıdaki gibi ortak bir genel ortamda Node vm bağlamında yüklenir.
// Arama eşleştirme normalleştirmesi (Türkçe ve İngilizce, ı/i, İ/i, aksanlar), vurgu aralıkları ve kısa
// alıntı, anma ayrıştırma ve kelime sınırları, @herkes kuralı (yazarın rolü), öneri kelimesi, yazıyor
// metninin çoğul kuralları ve yazanların süzülmesi sınanır.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const PUB = path.join(__dirname, '..', 'public')
const FILES = ['i18n.js', 'js/01-core.js', 'js/02-state-dom.js', 'js/04-meta.js', 'js/17-search.js', 'js/18-mentions.js', 'js/19-typing.js']
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

// Yeni bir bağlamda modülleri yükler. Kullanıcılar: 1 burak (sahip, ben), 2 ece (yönetici), 3 mert (üye),
// 4 kaan (üye). Görünen adlar ve engel listesi test için basit taklitlerle verilir.
function load (lang) {
  const sandbox = vm.createContext({})
  sandbox.self = sandbox
  sandbox.window = sandbox
  sandbox.setTimeout = setTimeout
  sandbox.clearTimeout = clearTimeout
  sandbox.localStorage = makeStorage()
  sandbox.sessionStorage = makeStorage()
  sandbox.localStorage.setItem('telsiz.lang', lang || 'tr')
  sandbox.navigator = { languages: [lang === 'en' ? 'en-US' : 'tr-TR'], language: lang === 'en' ? 'en-US' : 'tr-TR', userAgent: 'node' }
  sandbox.document = { documentElement: { lang: 'tr' }, readyState: 'loading', hidden: false, getElementById: () => null }
  sandbox.console = { warn () {}, log () {}, error () {} }
  for (const src of SOURCES) vm.runInContext(src.code, sandbox, { filename: src.file })
  const run = (code) => vm.runInContext(code, sandbox)
  run(`
    state.me = { id: 1, name: 'burak', role: 'owner', status: 'online' }
    state.meta = {
      channels: [{ id: 10, name: 'genel', type: 'text', position: 0 }, { id: 11, name: 'oyun', type: 'text', position: 1 }],
      users: [
        { id: 1, name: 'burak', role: 'owner', online: true, status: 'online' },
        { id: 2, name: 'ece', role: 'admin', online: true, status: 'online' },
        { id: 3, name: 'mert', role: 'member', online: false, status: 'offline' },
        { id: 4, name: 'kaan', role: 'member', online: true, status: 'online' }
      ]
    }
  `)
  run(`
    var testDisplay = { 1: 'Burak', 2: 'Ece Yılmaz', 3: 'Mert', 4: 'Kaan' }
    var testBlocked = []
    var testDm = { 50: 2 }
    function userDisplayName (id) { return testDisplay[id] || 'Silinmiş kullanıcı' }
    function userStatus (id) { const u = state.meta.users.filter((x) => String(x.id) === String(id))[0]; return u ? u.status : 'offline' }
    function isBlocked (id) { return testBlocked.indexOf(Number(id)) !== -1 }
    function isDmChannel (id) { return Object.prototype.hasOwnProperty.call(testDm, String(id)) }
    function dmPartner (id) { return isDmChannel(id) ? testDm[String(id)] : null }
  `)
  return { sandbox: sandbox, run: run, json: (code) => JSON.parse(run('JSON.stringify(' + code + ')')) }
}

const q = (value) => JSON.stringify(value)

test('arama katlaması: Türkçe ve İngilizcede büyük/küçük harf, ı/i, İ/i ve aksan duyarsız', () => {
  for (const lang of ['tr', 'en']) {
    const { run } = load(lang)
    assert.strictEqual(run('I18N.lang'), lang)
    const fold = (text) => run('foldSearchText(' + q(text) + ')')
    assert.strictEqual(fold('İğneada'), 'igneada', lang)
    assert.strictEqual(fold('igneada'), 'igneada', lang)
    assert.strictEqual(fold('ISINMA'), 'isinma', lang)
    assert.strictEqual(fold('ısınma'), 'isinma', lang)
    assert.strictEqual(fold('Çağrı ŞÖLEN Ülkü'), 'cagri solen ulku', lang)
    assert.strictEqual(fold('İSTANBUL'), 'istanbul', lang)
    assert.strictEqual(fold('Café Noël'), 'cafe noel', lang)
    assert.strictEqual(fold('Âşık'), 'asik', lang)
    // Emoji ve rakamlar korunur
    assert.strictEqual(fold('Maç 3:1 🎉'), 'mac 3:1 🎉', lang)
    // Sorgu ve metin aynı katlamayla karşılaştırılır
    assert.ok(fold('İğneada turnuvası için ısınma şart.').indexOf(fold('igneada')) !== -1)
    assert.ok(fold('İğneada turnuvası için ısınma şart.').indexOf(fold('ISINMA')) !== -1)
    assert.ok(fold('ISINMA turu').indexOf(fold('ısınma')) !== -1)
  }
})

test('arama sorgusu: terimler ve kimden:/from: belirteci', () => {
  const { json } = load('tr')
  assert.deepStrictEqual(json("parseSearchQuery('  İğneada   ISINMA ')"), { terms: ['igneada', 'isinma'], from: null })
  assert.deepStrictEqual(json("parseSearchQuery('kimden:Ece turnuva')"), { terms: ['turnuva'], from: 'ece' })
  assert.deepStrictEqual(json("parseSearchQuery('from:@mert')"), { terms: [], from: 'mert' })
  assert.deepStrictEqual(json("parseSearchQuery('')"), { terms: [], from: null })
})

test('arama vurgusu: eşleşen aralıklar özgün metinde, kısa alıntı textContent parçaları', () => {
  const { json } = load('tr')
  assert.deepStrictEqual(json("searchHitRanges('Eski bir İğneada anısı', ['igneada'])"), [[9, 16]])
  assert.deepStrictEqual(json("searchSnippetParts('Eski bir İğneada anısı', ['igneada'])"), [
    { text: 'Eski bir ', hit: false }, { text: 'İğneada', hit: true }, { text: ' anısı', hit: false }
  ])
  // Birden çok terim ve çakışan aralıklar birleşir
  assert.deepStrictEqual(json("searchHitRanges('ISINMA ve ısınma', ['isinma'])"), [[0, 6], [10, 16]])
  assert.deepStrictEqual(json("searchHitRanges('turnuva', ['turn', 'nuva'])"), [[0, 7]])
  // Uzun metinde ilk eşleşmenin çevresi, başta ve sonda üç nokta
  const parts = json("searchSnippetParts('a'.repeat(300) + ' kadimsoz ' + 'b'.repeat(300), ['kadimsoz'], undefined, 40)")
  assert.strictEqual(parts[0].text, '...')
  assert.strictEqual(parts[parts.length - 1].text, '...')
  assert.ok(parts.some((p) => p.hit && p.text === 'kadimsoz'))
  assert.ok(parts.map((p) => p.text).join('').length <= 80 + 6)
  // Vekil çiftler (emoji) bölünmez
  const emoji = json("searchSnippetParts('🎉'.repeat(100) + 'hedef' + '🎉'.repeat(100), ['hedef'], undefined, 21)")
  const joined = emoji.map((p) => p.text).join('')
  assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])|(^|[^\ud800-\udbff])[\udc00-\udfff]/.test(joined), 'yarım vekil çift yok')
  // Satır sonları boşluğa döner
  assert.deepStrictEqual(json("searchSnippetParts('bir\\niki', [])"), [{ text: 'bir iki', hit: false }])
})

test('arama süzgeçleri: kimden, resim, dosya ve terimlerin tamamı', () => {
  const { run } = load('tr')
  run(`
    var e1 = { id: 5, channelId: 10, authorId: 3, text: 'İğneada kampı', names: '', fold: foldSearchText('İğneada kampı'), foldNames: '', hasImage: true, hasFile: false }
    var e2 = { id: 6, channelId: 10, authorId: 4, text: '', names: 'harita.zip', fold: '', foldNames: foldSearchText('harita.zip'), hasImage: false, hasFile: true }
    var base = { terms: [], fromId: null, fromMissing: false, hasImage: false, hasFile: false, mentionsMe: false }
  `)
  const m = (entry, extra) => run('entryMatches(' + entry + ', Object.assign({}, base, ' + JSON.stringify(extra) + '))')
  assert.strictEqual(m('e1', { terms: ['igneada'] }), true)
  assert.strictEqual(m('e1', { terms: ['igneada', 'yok'] }), false)
  assert.strictEqual(m('e2', { terms: ['harita'] }), true, 'dosya adında arama')
  assert.strictEqual(m('e1', { hasImage: true }), true)
  assert.strictEqual(m('e2', { hasImage: true }), false)
  assert.strictEqual(m('e2', { hasFile: true }), true)
  assert.strictEqual(m('e1', { fromId: 3 }), true)
  assert.strictEqual(m('e1', { fromId: 4 }), false)
  assert.strictEqual(m('e1', { fromMissing: true }), false)
  // Engellenen kişinin yazı kanalındaki mesajı sonuçlarda yok
  run('testBlocked = [3]')
  assert.strictEqual(m('e1', { terms: ['igneada'] }), false)
})

test('anma ayrıştırma: var olan kullanıcı adları, kelime sınırları ve büyük harf', () => {
  const { json } = load('tr')
  const parse = (text, everyone) => json('parseMentions(' + q(text) + ', resolveMentionName, ' + Boolean(everyone) + ')')
  assert.deepStrictEqual(parse('Selam @ece, nasılsın?'), [
    { type: 'text', text: 'Selam ' }, { type: 'user', text: '@ece', name: 'ece', userId: 2 }, { type: 'text', text: ', nasılsın?' }
  ])
  const users = (text) => parse(text).filter((tok) => tok.type === 'user').map((tok) => tok.name)
  assert.deepStrictEqual(users('@ece'), ['ece'])
  assert.deepStrictEqual(users('@Ece büyük harfle'), ['ece'])
  assert.deepStrictEqual(users('(@mert) ve @kaan.'), ['mert', 'kaan'])
  assert.deepStrictEqual(users("@ece'ye sor"), ['ece'])
  assert.deepStrictEqual(users('🎉@ece'), ['ece'])
  assert.deepStrictEqual(users('@ece...'), ['ece'])
  // Anma sayılmayanlar: e-posta, eksik veya fazla ad, Türkçe harfle süren kelime, var olmayan kullanıcı
  assert.deepStrictEqual(users('kaan@ece.com'), [])
  assert.deepStrictEqual(users('@ecem'), [])
  assert.deepStrictEqual(users('@ece.com'), [])
  assert.deepStrictEqual(users('@eceğe'), [])
  assert.deepStrictEqual(users('@@ece'), [])
  assert.deepStrictEqual(users('@yok'), [])
  assert.deepStrictEqual(users('@e'), [])
  assert.deepStrictEqual(users('@'), [])
  // Metin parçaları kaybolmaz
  const text = 'a @ece b @yok c @herkes'
  assert.strictEqual(parse(text).map((tok) => tok.text).join(''), text)
  assert.strictEqual(parse(text, true).map((tok) => tok.text).join(''), text)
})

test('@herkes ve @everyone: yalnızca sahip ve yönetici yazınca, yazı kanalında anma sayılır', () => {
  const { run, json } = load('tr')
  const kinds = (text, everyone) => json('parseMentions(' + q(text) + ', resolveMentionName, ' + everyone + ')').map((tok) => tok.type)
  assert.deepStrictEqual(kinds('@herkes toplantı', false), ['text'])
  assert.deepStrictEqual(kinds('@herkes toplantı', true), ['everyone', 'text'])
  assert.deepStrictEqual(kinds('@everyone meeting', true), ['everyone', 'text'])
  assert.deepStrictEqual(kinds('@Herkes', true), ['everyone'])
  assert.deepStrictEqual(kinds('x@herkes', true), ['text'])
  // Yazarın rolü: 2 yönetici, 3 üye, 1 sahip (ben)
  assert.strictEqual(run('mayMentionEveryone(2, 10)'), true)
  assert.strictEqual(run('mayMentionEveryone(3, 10)'), false)
  assert.strictEqual(run('mayMentionEveryone(1, 10)'), true)
  assert.strictEqual(run('mayMentionEveryone(99, 10)'), false, 'listede olmayan yazar üye sayılır')
  assert.strictEqual(run('mayMentionEveryone(2, 50)'), false, 'özel mesajda @herkes yok')
  const me = (author, channel, text) => run('messageMentionsMe({ authorId: ' + author + ', channelId: ' + channel + ' }, ' + q(text) + ')')
  assert.strictEqual(me(3, 10, '@herkes yarın toplantı'), false, 'üyenin @herkesi')
  assert.strictEqual(me(2, 10, '@herkes yarın toplantı'), true, 'yöneticinin @herkesi')
  assert.strictEqual(me(2, 10, '@everyone meeting'), true)
  assert.strictEqual(me(3, 10, 'selam @burak'), true, 'adımla anma')
  assert.strictEqual(me(3, 10, 'selam @ece'), false, 'başkasını anma')
  assert.strictEqual(me(1, 10, '@burak kendime not'), false, 'kendi mesajım sayılmaz')
  assert.strictEqual(me(2, 50, '@herkes özelde'), false)
  assert.strictEqual(me(2, 50, '@burak özelde'), true)
  // Rol düşürülünce eski @herkes mesajı da anma sayılmaz (yazarın güncel rolü)
  run("state.meta.users[1].role = 'member'")
  assert.strictEqual(me(2, 10, '@herkes yarın toplantı'), false)
})

test('öneri kelimesi: imlecin önündeki @ kelimesi, kelime sınırı ve kelimenin sonu', () => {
  const { json } = load('tr')
  const at = (text, caret) => json('mentionQueryAt(' + q(text) + ', ' + caret + ')')
  assert.deepStrictEqual(at('merhaba @ec', 11), { start: 8, end: 11, query: 'ec' })
  assert.deepStrictEqual(at('@', 1), { start: 0, end: 1, query: '' })
  assert.deepStrictEqual(at('@Ece', 4), { start: 0, end: 4, query: 'ece' })
  assert.deepStrictEqual(at('@ece kanka', 2), { start: 0, end: 4, query: 'e' })
  assert.strictEqual(at('mail@ec', 7), null)
  assert.strictEqual(at('@ece ', 5), null)
  assert.strictEqual(at('selam', 5), null)
  assert.strictEqual(at('@@ec', 4), null)
})

test('kişi önerileri: kullanıcı adı başı, görünen ad kelime başı ve içerme sırası, aksan duyarsız', () => {
  const { json } = load('tr')
  const ids = (query) => json('matchPeople(' + q(query) + ', [1, 2, 3, 4])').map((p) => p.id)
  assert.deepStrictEqual(ids('e'), [2, 3], 'önce kullanıcı adı başı (ece), sonra içerme (mert)')
  assert.deepStrictEqual(ids('k'), [4, 1], 'kaan adın başında, burak içeriyor')
  assert.deepStrictEqual(ids('yil'), [2], 'görünen adın ikinci kelimesi (Yılmaz), aksan duyarsız')
  assert.deepStrictEqual(ids('a'), [1, 2, 4], 'hepsi içeriyor: çevrimiçiler görünen ada göre, çevrimdışı (mert) yok')
  assert.deepStrictEqual(ids(''), [1, 2, 4, 3], 'boş sorguda çevrimiçiler önce, ada göre')
  assert.deepStrictEqual(ids('zzz'), [])
})

test('yazıyor metni: 1 kişi, 2 kişi, 3 ve üstü, iki dilde, adlar kalın parça', () => {
  const tr = load('tr')
  const parts = (env, names) => env.json('typingTextParts(' + q(names) + ')')
  assert.deepStrictEqual(parts(tr, []), [])
  assert.deepStrictEqual(parts(tr, ['Ece']), [{ text: 'Ece', strong: true }, { text: ' yazıyor', strong: false }])
  assert.deepStrictEqual(parts(tr, ['Ece', 'Mert']), [{ text: 'Ece', strong: true }, { text: ' ve ', strong: false }, { text: 'Mert', strong: true }, { text: ' yazıyor', strong: false }])
  assert.deepStrictEqual(parts(tr, ['Ece', 'Mert', 'Kaan']), [{ text: 'Birkaç kişi yazıyor', strong: false }])
  assert.deepStrictEqual(parts(tr, ['A', 'B', 'C', 'D', 'E']), [{ text: 'Birkaç kişi yazıyor', strong: false }])
  const en = load('en')
  assert.strictEqual(parts(en, ['Ece']).map((p) => p.text).join(''), 'Ece is typing')
  assert.strictEqual(parts(en, ['Ece', 'Mert']).map((p) => p.text).join(''), 'Ece and Mert are typing')
  assert.strictEqual(parts(en, ['Ece', 'Mert', 'Kaan']).map((p) => p.text).join(''), 'Several people are typing')
  // Ad içindeki süslü parantez şablon sayılmaz, değer olduğu gibi basılır
  assert.deepStrictEqual(parts(tr, ['{a}']), [{ text: '{a}', strong: true }, { text: ' yazıyor', strong: false }])
  // Şablon ayrıştırıcı: bilinmeyen yer tutucu olduğu gibi kalır
  assert.deepStrictEqual(tr.json("templateParts('{x} ve {y}', { x: 'A' }, ['x'])"), [{ text: 'A', strong: true }, { text: ' ve ', strong: false }, { text: '{y}', strong: false }])
})

test('yazıyor listesi: kendim, engellediklerim ve listede olmayanlar gösterilmez, biçimsiz değerler atılır', () => {
  const { run, json } = load('tr')
  run("typingApply({ tv: 7, typing: { 10: [2, 1, 3, 99, 'x', -4], 50: [2], bad: 'no' } })")
  assert.strictEqual(run('typingState.tv'), 7)
  assert.deepStrictEqual(json('typingUsersFor(10)'), [2, 3])
  assert.deepStrictEqual(json('typingUsersFor(50)'), [2])
  assert.deepStrictEqual(json('typingUsersFor(11)'), [])
  run('testBlocked = [3]')
  assert.deepStrictEqual(json('typingUsersFor(10)'), [2])
  // typing alanı olmayan yanıt sürümü değiştirmez
  run('typingApply({ tv: 9 })')
  assert.strictEqual(run('typingState.tv'), 7)
  run('typingOnConnLost()')
  assert.strictEqual(run('typingState.tv'), 0, 'bağlantı kopunca liste baştan istenir')
  assert.deepStrictEqual(json('typingUsersFor(10)'), [])
})

test('yazıyor tercihi: telsiz.typing 0 ise gönderilmez, varsayılan açık', () => {
  const { run } = load('tr')
  assert.strictEqual(run('typingSendAllowed()'), true)
  run("localStorage.setItem('telsiz.typing', '0')")
  assert.strictEqual(run('typingSendAllowed()'), false)
  run("localStorage.setItem('telsiz.typing', '1')")
  assert.strictEqual(run('typingSendAllowed()'), true)
})

test('bildirim düzeyi: varsayılan anmalar, tanınmayan değer anmalar sayılır', () => {
  const { run } = load('tr')
  assert.strictEqual(run('mentionNotifyLevel()'), 'mentions')
  run("localStorage.setItem('telsiz.notifyLevel', 'all')")
  assert.strictEqual(run('mentionNotifyLevel()'), 'all')
  run("localStorage.setItem('telsiz.notifyLevel', 'none')")
  assert.strictEqual(run('mentionNotifyLevel()'), 'none')
  run("localStorage.setItem('telsiz.notifyLevel', 'bozuk')")
  assert.strictEqual(run('mentionNotifyLevel()'), 'mentions')
})
