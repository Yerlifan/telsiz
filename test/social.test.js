'use strict'

// İstemcinin kimlik, arkadaşlık ve özel mesaj yardımcıları (public/js/13..16) testleri. Modüller
// tarayıcıdaki gibi ortak bir genel ortamda, gerçek crypto.js, tweetnacl ve scrypt-js ile Node vm
// bağlamında yüklenir. Kullanıcı adı kuralı, parola gücü, türetme yardımcısının ortak test vektörü,
// kişiye özel metanın süzülmesi, özel mesaj gönderme koşulları ve çözme denetimleri (yazar ve konuşma
// kimliği, sabitlenmiş anahtarlar, eski anahtar), Telsiz DJ duyurusunun (06-messages.js cleanDjNotice)
// doğrulanması ve "düzenlendi" etiketi, Bildirimler listesinin (28-bildirim.js) kayıt sınırı ve Telsiz DJ
// kaydının parça adı belleği (23-dj.js djLiveTitle, motor taklit edilir) sınanır.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const nodeCrypto = require('node:crypto')

const PUB = path.join(__dirname, '..', 'public')
const FILES = [
  'vendor/nacl-fast.min.js', 'vendor/scrypt.js', 'i18n.js', 'crypto.js',
  'js/01-core.js', 'js/02-state-dom.js', 'js/06-messages.js',
  'js/13-profile.js', 'js/14-social.js', 'js/15-dm.js', 'js/16-identity.js', 'js/23-dj.js', 'js/28-bildirim.js'
]
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

// Yeni bir bağlamda istemci modüllerini yükler, modüllerin genel adlarına erişim için run(ifade) döner
function load () {
  const sandbox = vm.createContext({})
  sandbox.self = sandbox
  sandbox.window = sandbox
  sandbox.setTimeout = setTimeout
  sandbox.clearTimeout = clearTimeout
  sandbox.setImmediate = setImmediate
  sandbox.crypto = nodeCrypto.webcrypto
  sandbox.localStorage = makeStorage()
  sandbox.sessionStorage = makeStorage()
  sandbox.navigator = { languages: ['tr-TR'], language: 'tr-TR', userAgent: 'node' }
  sandbox.document = { documentElement: { lang: 'tr' }, readyState: 'complete', hidden: false }
  sandbox.console = { warn () {}, log () {}, error () {} }
  for (const src of SOURCES) vm.runInContext(src.code, sandbox, { filename: src.file })
  const run = (code) => vm.runInContext(code, sandbox)
  // Oturum: kendi kimliğim 1, sunucudaki açık anahtar ve bu cihazdaki kimlik
  run("state.me = { id: 1, name: 'burak', role: 'owner', status: 'online' }")
  return { sandbox: sandbox, run: run, E2EE: sandbox.E2EE }
}

test('kullanıcı adı kuralı: küçük İngilizce harf, rakam, alt çizgi ve nokta, 2..32, nokta kuralları', () => {
  const { run } = load()
  const valid = ['burak', 'mert.k', 'a_b', 'x1', 'a'.repeat(32), 'ece_2026.tr']
  const invalid = { '': 'empty', a: 'length', Burak: 'chars', 'ayşe': 'chars', 'ali veli': 'chars', '.abc': 'dots', 'abc.': 'dots', 'a..b': 'dots', 'ab-c': 'chars' }
  invalid['a'.repeat(33)] = 'length'
  for (const name of valid) assert.strictEqual(run('usernameProblem(' + JSON.stringify(name) + ')'), null, name)
  for (const name of Object.keys(invalid)) assert.strictEqual(run('usernameProblem(' + JSON.stringify(name) + ')'), invalid[name], name)
  // Küçük harfe çevirme yerel ayar kullanmaz: İ Türkçe kurala göre değil, standart biçimde küçülür
  assert.strictEqual(run("cleanUsername('  BURAK ')"), 'burak')
  assert.notStrictEqual(run("usernameProblem(cleanUsername('İrem'))"), null)
})

test('parola uzunluğu istemcide denetlenir, güç göstergesi 0..4', () => {
  const { run } = load()
  assert.strictEqual(run("passwordProblem('1234567')") === null, false)
  assert.strictEqual(run("passwordProblem('12345678')"), null)
  assert.strictEqual(run("passwordProblem('x'.repeat(129))") === null, false)
  assert.strictEqual(run("passwordStrength('')"), 0)
  assert.strictEqual(run("passwordStrength('kisa')"), 0)
  assert.strictEqual(run("passwordStrength('abcdefgh')"), 1)
  assert.ok(run("passwordStrength('Burak-Parola-2026')") >= 3)
  assert.ok(run("passwordStrength('Burak-Parola-2026')") <= 4)
})

test('türetme yardımcısı ortak test vektörünü verir ve ilerlemeyi 0..100 bildirir', async () => {
  const { sandbox, run } = load()
  const seen = []
  sandbox.__progress = (pct) => seen.push(pct)
  const out = await run("deriveKeys('Parola-Örnek 1', { salt: 'AAECAwQFBgcICQoLDA0ODw', N: 16384, r: 8, p: 1 }, __progress)")
  assert.strictEqual(out.authKey, 'ddfe2a33db778dcc5ab649cabff09f25e8b1a4aa32d62d4b36ac75e591245595')
  assert.strictEqual(Buffer.from(out.wrapKey).toString('hex'), 'fdb8d3c6f1cf1ab6e1fdecef82533767ee48e009c6f4a870b35241e002cf5dc9')
  assert.strictEqual(seen[0], 0)
  assert.strictEqual(seen[seen.length - 1], 100)
  seen.slice(1).forEach((pct, i) => {
    assert.ok(pct > seen[i], 'ilerleme artan ve tekrarsız')
  })
})

test('kişiye özel meta süzülür: geçersiz kimlikler atılır, konuşmalar ve durum okunur', () => {
  const { run } = load()
  const p = run("normalizePrivate({ friends: [2, '3', -1, 'x', null], incoming: [4], outgoing: 'yok', blocked: [5], dms: [{ id: 9, userId: 2, lastMessageId: 12, lastMessageAt: 1000 }, { id: 10 }, null], allowMemberDms: false, status: 'dnd' })")
  assert.deepStrictEqual(Array.from(p.friends), [2, '3'])
  assert.deepStrictEqual(Array.from(p.incoming), [4])
  assert.deepStrictEqual(Array.from(p.outgoing), [])
  assert.strictEqual(p.dms.length, 1)
  assert.strictEqual(p.dms[0].lastMessageId, 12)
  assert.strictEqual(p.allowMemberDms, false)
  assert.strictEqual(p.status, 'dnd')
  assert.strictEqual(run("normalizePrivate({ status: 'gizli' }).status"), null)
})

// İki kişilik özel konuşma kurulumu: ben (1) ve karşı taraf (2), grup anahtarıyla bağlanmış kimlik
function setupDm (ctx, opts) {
  const options = opts || {}
  const { sandbox, run, E2EE } = ctx
  const kid = E2EE.keyring.add(E2EE.generateKeyCode())
  run("state.meta = { activeKid: '" + kid + "', channels: [], users: [{ id: 1, name: 'burak', role: 'owner', online: true, status: 'online', pv: 1 }, { id: 2, name: 'ayse', role: 'member', online: true, status: 'online', pv: 1 }] }")
  const mine = E2EE.identity.generate()
  const theirs = E2EE.identity.generate()
  sandbox.__mine = mine
  run("setServerKeys({ publicKey: __mine.publicKey, wrappedKey: null })")
  if (!options.locked) run('rememberIdentity(1, __mine.publicKey, __mine.secretKey)')
  run("socialState.priv = normalizePrivate({ friends: [2], dms: [{ id: 50, userId: 2, lastMessageId: 1, lastMessageAt: 1 }] })")
  const identity = E2EE.identity.sealBinding(kid, 2, theirs.publicKey)
  sandbox.__entry = { id: 2, pv: 1, profile: null, avatarUploadId: null, publicKey: theirs.publicKey, identity: options.noBinding ? null : identity }
  run('storeProfileEntry(__entry)')
  return { kid: kid, mine: mine, theirs: theirs }
}

test('özel mesaj gönderme koşulları: kilitli kimlik, doğrulanmamış anahtar, engel, anahtar değişimi', () => {
  let ctx = load()
  setupDm(ctx, { locked: true })
  assert.strictEqual(ctx.run('dmSendState(2).reason'), 'locked')

  ctx = load()
  setupDm(ctx, { noBinding: true })
  assert.strictEqual(ctx.run('dmSendState(2).reason'), 'unverified')

  ctx = load()
  const keys = setupDm(ctx)
  assert.strictEqual(ctx.run('dmSendState(2).ok'), true)
  assert.strictEqual(ctx.run('dmSendState(2).pk'), keys.theirs.publicKey)
  ctx.run("socialState.priv.blocked = [2]")
  assert.strictEqual(ctx.run('dmSendState(2).reason'), 'blocked')
  ctx.run('socialState.priv.blocked = []')
  // Karşı tarafın anahtarı değişti (parola sıfırlandı): kabul edilene kadar gönderme kapalı
  const fresh = ctx.E2EE.identity.generate()
  ctx.sandbox.__entry = { id: 2, pv: 2, profile: null, avatarUploadId: null, publicKey: fresh.publicKey, identity: ctx.E2EE.identity.sealBinding(keys.kid, 2, fresh.publicKey) }
  ctx.run('storeProfileEntry(__entry)')
  assert.strictEqual(ctx.run('dmSendState(2).reason'), 'changed')
  ctx.run('E2EE.pins.accept(1, 2)')
  assert.strictEqual(ctx.run('dmSendState(2).ok'), true)
  assert.strictEqual(ctx.run('dmSendState(2).pk'), fresh.publicKey)
  // Grup anahtarıyla bağlanmamış (sunucunun değiştirdiği) anahtar kullanılmaz
  const forged = ctx.E2EE.identity.generate()
  ctx.sandbox.__entry = { id: 2, pv: 3, profile: null, avatarUploadId: null, publicKey: forged.publicKey, identity: ctx.E2EE.identity.sealBinding(keys.kid, 2, fresh.publicKey) }
  ctx.run('storeProfileEntry(__entry)')
  assert.strictEqual(ctx.run('dmSendState(2).reason'), 'unverified')
})

test('özel mesaj çözme: iki yönde açılır, yazar ve konuşma denetlenir, eski anahtar ve kilit metinleri', () => {
  const ctx = load()
  const keys = setupDm(ctx)
  const { E2EE, sandbox, run } = ctx
  // Karşı tarafın gönderdiği mesaj
  sandbox.__m = { id: 7, channelId: 50, authorId: 2, body: E2EE.dm.seal({ v: 1, a: 2, c: 50, t: 'Selam 👋', f: [] }, keys.mine.publicKey, keys.theirs.secretKey), uploads: [] }
  let r = run('decryptDmMessage(__m)')
  assert.strictEqual(r.state, 'ok')
  assert.strictEqual(r.text, 'Selam 👋')
  // Kendi gönderdiğim mesaj (aynı ortak anahtar)
  sandbox.__m = { id: 8, channelId: 50, authorId: 1, body: run("dmSealBody({ v: 1, a: 1, c: 50, t: 'Merhaba', f: [] }, 50)"), uploads: [] }
  assert.ok(/^2\./.test(sandbox.__m.body))
  r = run('decryptDmMessage(__m)')
  assert.strictEqual(r.state, 'ok')
  assert.strictEqual(r.text, 'Merhaba')
  // Yazar veya konuşma kimliği tutmayan mesaj doğrulanamaz
  sandbox.__m = { id: 9, channelId: 50, authorId: 2, body: E2EE.dm.seal({ v: 1, a: 1, c: 50, t: 'sahte', f: [] }, keys.mine.publicKey, keys.theirs.secretKey), uploads: [] }
  assert.strictEqual(run('decryptDmMessage(__m).state'), 'unverified')
  sandbox.__m = { id: 10, channelId: 50, authorId: 2, body: E2EE.dm.seal({ v: 1, a: 2, c: 51, t: 'başka konuşma', f: [] }, keys.mine.publicKey, keys.theirs.secretKey), uploads: [] }
  assert.strictEqual(run('decryptDmMessage(__m).state'), 'unverified')
  // Bilinmeyen bir anahtarla şifrelenmiş mesaj: eski anahtar metni
  const stranger = E2EE.identity.generate()
  sandbox.__m = { id: 11, channelId: 50, authorId: 2, body: E2EE.dm.seal({ v: 1, a: 2, c: 50, t: 'x', f: [] }, keys.mine.publicKey, stranger.secretKey), uploads: [] }
  assert.strictEqual(run('decryptDmMessage(__m).state'), 'dm_old_key')
  assert.strictEqual(run("messageNoticeText('dm_old_key')"), 'Bu mesaj eski bir güvenlik anahtarıyla şifrelenmiş.')
  // Anahtarı değişen kişinin eski mesajları sabitlenmiş eski anahtarla okunmaya devam eder
  const fresh = E2EE.identity.generate()
  sandbox.__entry = { id: 2, pv: 2, profile: null, avatarUploadId: null, publicKey: fresh.publicKey, identity: E2EE.identity.sealBinding(keys.kid, 2, fresh.publicKey) }
  run('storeProfileEntry(__entry)')
  sandbox.__m = { id: 12, channelId: 50, authorId: 2, body: E2EE.dm.seal({ v: 1, a: 2, c: 50, t: 'eski', f: [] }, keys.mine.publicKey, keys.theirs.secretKey), uploads: [] }
  assert.strictEqual(run('decryptDmMessage(__m).text'), 'eski')
  // Bu cihazda kimlik yoksa kilit metni
  run('forgetIdentity(1)')
  assert.strictEqual(run('decryptDmMessage(__m).state'), 'dm_locked')
})

test('profil zarfı grup anahtarıyla açılır, u alanı başka kişiyi gösteriyorsa yok sayılır, görünen ad yardımcıları', () => {
  const ctx = load()
  const keys = setupDm(ctx)
  const { E2EE, sandbox, run } = ctx
  sandbox.__entry = { id: 2, pv: 5, profile: E2EE.sealJson(keys.kid, { v: 1, u: 2, displayName: '  Ayşe  Yılmaz ', statusText: 'Valorant oynuyor', bio: 'Merhaba\n\n\n\ndünya', color: 4, avatar: null }), avatarUploadId: null, publicKey: keys.theirs.publicKey, identity: E2EE.identity.sealBinding(keys.kid, 2, keys.theirs.publicKey) }
  run('storeProfileEntry(__entry)')
  assert.strictEqual(run('userDisplayName(2)'), 'Ayşe Yılmaz')
  assert.strictEqual(run('userHandle(2)'), '@ayse')
  assert.strictEqual(run('userStatusText(2)'), 'Valorant oynuyor')
  assert.strictEqual(run('profileRecord(2).profile.bio'), 'Merhaba\n\ndünya')
  assert.strictEqual(run('userAvatarInfo(2).colorIndex'), 4)
  assert.strictEqual(run('userAvatarInfo(2).initial'), 'A')
  // Sunucu başka bir kullanıcının profilini bu kişiye bağlarsa yok sayılır
  sandbox.__entry = { id: 2, pv: 6, profile: E2EE.sealJson(keys.kid, { v: 1, u: 1, displayName: 'Taklit', statusText: '', bio: '', color: 1, avatar: null }), avatarUploadId: null, publicKey: keys.theirs.publicKey, identity: null }
  run('storeProfileEntry(__entry)')
  assert.strictEqual(run('userDisplayName(2)'), 'ayse')
  // Listede olmayan (silinmiş) kişi
  assert.strictEqual(run('userDisplayName(99)'), 'Silinmiş kullanıcı')
  assert.strictEqual(run('userHandle(99)'), '')
  run("setFormerUsers([{ id: 98, name: 'eski_uye' }])")
  assert.strictEqual(run('userDisplayName(98)'), 'eski_uye')
})

test('durum: görünmez kendime çevrimdışı görünür, diğerleri meta durumundan okunur', () => {
  const ctx = load()
  setupDm(ctx)
  const { run } = ctx
  run("state.me.status = 'invisible'")
  assert.strictEqual(run('userStatus(1)'), 'offline')
  assert.strictEqual(run('myChosenStatus()'), 'invisible')
  run("state.meta.users[1].status = 'dnd'")
  assert.strictEqual(run('userStatus(2)'), 'dnd')
  assert.strictEqual(run('userStatus(77)'), 'offline')
})

test('Telsiz DJ duyurusu (06-messages.js): parçanın adı isteğe bağlı, temizlenir ve 120 kod noktasıyla sınırlanır', () => {
  const { run } = load()
  const clean = (d) => {
    const out = run('cleanDjNotice(' + JSON.stringify(d) + ')')
    return out === null ? null : JSON.parse(JSON.stringify(out))
  }
  const vid = 'dQw4w9WgXcQ'
  // Adsız eski biçim aynen kalır
  assert.deepStrictEqual(clean({ op: 'add', src: 'yt', vid: vid }), { op: 'add', src: 'yt', vid: vid })
  assert.deepStrictEqual(clean({ op: 'add', src: 'file' }), { op: 'add', src: 'file' })
  // Denetim ve yön karakterleri boşluğa döner, boşluklar teke iner, kenarlar kırpılır
  assert.deepStrictEqual(clean({ op: 'add', src: 'yt', vid: vid, title: '  Lobi\u202e  teması\u0007 ' }), { op: 'add', src: 'yt', vid: vid, title: 'Lobi teması' })
  assert.deepStrictEqual(clean({ op: 'add', src: 'file', title: 'lobi-temasi.wav' }), { op: 'add', src: 'file', title: 'lobi-temasi.wav' })
  // En çok 120 kod noktası (dört baytlık karakterler bölünmez)
  const long = clean({ op: 'add', src: 'yt', vid: vid, title: '🎵'.repeat(130) })
  assert.strictEqual(Array.from(long.title).length, 120)
  assert.strictEqual(long.title, '🎵'.repeat(120))
  // Dize olmayan veya temizlenince boş kalan ad yazılmaz, bilinmeyen alanlar atılır
  assert.deepStrictEqual(clean({ op: 'add', src: 'yt', vid: vid, title: 42, extra: 'x' }), { op: 'add', src: 'yt', vid: vid })
  assert.deepStrictEqual(clean({ op: 'add', src: 'file', title: '\u200b\u0000 \u2066' }), { op: 'add', src: 'file' })
  // Başka bir mesajdaki dosya ("DJ'de Çal", mesajda ek yok) kendi kaynağıyla gelir
  assert.deepStrictEqual(clean({ op: 'add', src: 'fileref', title: 'lobi-temasi.wav' }), { op: 'add', src: 'fileref', title: 'lobi-temasi.wav' })
  assert.deepStrictEqual(clean({ op: 'add', src: 'fileref', vid: vid }), { op: 'add', src: 'fileref' })
  // Geçersiz işlem, kaynak veya video kimliği
  assert.strictEqual(clean({ op: 'remove', src: 'file', title: 'a' }), null)
  assert.strictEqual(clean({ op: 'add', src: 'yt', vid: 'kisa', title: 'a' }), null)
  assert.strictEqual(clean({ op: 'add', src: 'web', title: 'a' }), null)
  assert.strictEqual(clean(null), null)
})

// 2.5.0 istemcisinin cleanDjNotice işlevi (yayımlanmış sürümden aynen): bilmediği kaynağı yok sayar, mesajın t
// alanı düz metin olarak gösterilir
function cleanDjNotice250 (d) {
  if (!d || typeof d !== 'object' || d.op !== 'add') return null
  if (d.src === 'yt' && typeof d.vid === 'string' && /^[A-Za-z0-9_-]{11}$/.test(d.vid)) return { op: 'add', src: 'yt', vid: d.vid }
  if (d.src === 'file') return { op: 'add', src: 'file' }
  return null
}

test('"DJ\'de Çal" duyurusu eki olmayan mesajdır: eski istemci "Bu ses dosyası" demez, çevrilmiş tam metni gösterir', () => {
  const { run } = load()
  // Yeni istemcinin gönderdiği gövde (23-dj.js djPlayFile): kaynak 'fileref', t çevrilmiş tam duyuru
  const titled = { op: 'add', src: 'fileref', title: 'lobi-temasi.wav' }
  const untitled = { op: 'add', src: 'fileref' }
  assert.strictEqual(cleanDjNotice250(titled), null)
  assert.strictEqual(cleanDjNotice250(untitled), null)
  assert.strictEqual(run("t('dj.notice.fileTitle', { title: 'lobi-temasi.wav' })"), 'Telsiz DJ kuyruğuna dosya ekledi: lobi-temasi.wav')
  assert.strictEqual(run("t('dj.notice.fileRef')"), 'Telsiz DJ kuyruğuna bir ses dosyası ekledi.')
  // /çal ve ek yolu (dosya aynı mesajda) eski biçimde kalır, eski istemci onu duyuru olarak çizer
  assert.deepStrictEqual(cleanDjNotice250({ op: 'add', src: 'file', title: 'x.wav' }), { op: 'add', src: 'file' })
})

test('"DJ\'de Çal" duyurusunun metni dosya adındaki @ işaretini anmaya çevirmez (23-dj.js djFileRefText)', () => {
  const { run } = load()
  // Dosyanın adını yükleyen kişi seçer: eski istemci metni düz metin olarak gösterip anma arar, @ tam genişlikli
  // at işaretiyle yazılır
  assert.strictEqual(run("djFileRefText('@herkes yeni parca.mp3')"), 'Telsiz DJ kuyruğuna dosya ekledi: \uff20herkes yeni parca.mp3')
  assert.strictEqual(run("djFileRefText('@ece icin @@mert.mp3')"), 'Telsiz DJ kuyruğuna dosya ekledi: \uff20ece icin \uff20\uff20mert.mp3')
  assert.doesNotMatch(run("djFileRefText('a @everyone b')"), /@/)
  // @ içermeyen ad ve adsız duyuru değişmez
  assert.strictEqual(run("djFileRefText('lobi-temasi.wav')"), 'Telsiz DJ kuyruğuna dosya ekledi: lobi-temasi.wav')
  assert.strictEqual(run("djFileRefText('')"), 'Telsiz DJ kuyruğuna bir ses dosyası ekledi.')
})

test('"düzenlendi" etiketi: DJ duyurusunda yalnızca izlenen, yalnızca ad ekleyen ve ad süresi içindeki düzenleme gizlenir', () => {
  const { run } = load()
  const mark = (m, dj) => run('showEditedMark(' + JSON.stringify(m) + ', ' + JSON.stringify(dj) + ')')
  // replaceMessage'in verdiği önceki ve yeni hâl (çözülmüş sonuçlar yalnızca state ve dj alanıyla)
  const note = (prev, m, a, b) => run('noteDjTitleEdit(' + [prev, m, { state: 'ok', dj: a }, { state: 'ok', dj: b }].map((x) => JSON.stringify(x)).join(', ') + ')')
  const at = 1700000000000
  const min = 60 * 1000
  const yt = { op: 'add', src: 'yt', vid: 'dQw4w9WgXcQ' }
  const titled = { op: 'add', src: 'yt', vid: 'dQw4w9WgXcQ', title: 'Lobi teması' }
  const msg = (id, editedAt) => ({ id: id, channelId: 5, createdAt: at, editedAt: editedAt })
  // Düzenlenmemiş mesaj etiket almaz
  assert.strictEqual(mark({ createdAt: at, editedAt: null }, true), false)
  assert.strictEqual(mark({ createdAt: at }, false), false)
  // Sıradan mesajın her düzenlemesi görünür
  assert.strictEqual(mark({ createdAt: at, editedAt: at + 5000 }, false), true)
  // Önceki hâli bilinmeyen DJ duyurusu düzenlemesi (konuşma sonradan açıldı) görünür
  assert.strictEqual(mark(msg(1, at + 9000), true), true)
  // İzlenen ve yalnızca ad ekleyen düzenleme (on dakika ve bir dakikalık pay içinde) etiketsiz kalır
  note(msg(1, null), msg(1, at + 9000), yt, titled)
  assert.strictEqual(mark(msg(1, at + 9000), true), false)
  note(msg(2, null), msg(2, at + 11 * min), yt, titled)
  assert.strictEqual(mark(msg(2, at + 11 * min), true), false)
  // Ad süresinden sonraki düzenleme görünür
  note(msg(3, null), msg(3, at + 11 * min + 1), yt, titled)
  assert.strictEqual(mark(msg(3, at + 11 * min + 1), true), true)
  // Kayıt yalnızca o düzenlemeye aittir: aynı mesajın sonraki bir düzenlemesi görünür
  assert.strictEqual(mark(msg(1, at + 20000), true), true)
  // Sıradan mesajı duyuruya çeviren düzenleme görünür
  note(msg(4, null), msg(4, at + 5 * min), null, titled)
  assert.strictEqual(mark(msg(4, at + 5 * min), true), true)
  // Duyurunun videosunu veya kaynağını değiştiren düzenleme görünür
  note(msg(5, null), msg(5, at + 9000), yt, { op: 'add', src: 'yt', vid: 'aaaaaaaaaaa', title: 'Başka' })
  assert.strictEqual(mark(msg(5, at + 9000), true), true)
  note(msg(6, null), msg(6, at + 9000), { op: 'add', src: 'file' }, { op: 'add', src: 'fileref', title: 'x.wav' })
  assert.strictEqual(mark(msg(6, at + 9000), true), true)
  // Zaten adı olan duyurunun adını değiştiren düzenleme görünür
  note(msg(7, null), msg(7, at + 9000), titled, { op: 'add', src: 'yt', vid: 'dQw4w9WgXcQ', title: 'Başka' })
  assert.strictEqual(mark(msg(7, at + 9000), true), true)
  // Önceki hâli zaten düzenlenmiş (sıradan mesajdan çevrilmiş olabilir) duyuruya ad eklemek de görünür
  note(msg(8, at + 1000), msg(8, at + 9000), yt, titled)
  assert.strictEqual(mark(msg(8, at + 9000), true), true)
  // İzlenen geçerli kayıt sonra geçersiz bir düzenlemeyle silinir
  note(msg(1, at + 9000), msg(1, at + 30000), titled, { op: 'add', src: 'yt', vid: 'aaaaaaaaaaa', title: 'Başka' })
  assert.strictEqual(mark(msg(1, at + 9000), true), true)
  // Zamanı okunamayan DJ duyurusunun düzenlemesi görünür
  assert.strictEqual(mark({ createdAt: 'x', editedAt: at }, true), true)
})

test('Telsiz DJ kaydı ve son işlem satırı: parçanın adı kuyruktan çıkınca korunur, adsız parça türüyle yazılır', () => {
  const { run } = load()
  // Motor taklidi: djEngine kurulu motoru döndürür, kuyruk window.djq'dan okunur
  run("window.djq = { current: { id: 'y1', type: 'youtube', title: '' }, queue: [] }")
  run('dj.engine = { queue: () => window.djq, serverNow: () => Date.now() }')
  const title = (expr) => {
    const text = run(expr)
    return text.slice(text.lastIndexOf(': ') + 2)
  }
  // YouTube parçasının adı ekleme anında bilinmez, oynatıcı bildirince gelir, parça bitince kayıtta kalır
  run("activityDj(2, '9', 'y1', '', null)")
  assert.strictEqual(title('activityText(activityState.items[0])'), 'YouTube videosu')
  run("window.djq.current.title = 'Lobi teması'")
  run('activityDjRefresh()')
  run("window.djq = { current: null, queue: [] }")
  assert.strictEqual(title('activityText(activityState.items[0])'), 'Lobi teması')
  // Adı boş dosya parçası kuyruktan çıkınca da "Ses dosyası" olarak kalır (tür bildirim anında kayda yazılır)
  run("window.djq = { current: null, queue: [{ id: 'f1', type: 'file', title: '' }] }")
  run("djOnNotice({ op: 'add', by: 2, room: '9', trackId: 'f1', title: '', at: 0 })")
  run("window.djq = { current: null, queue: [] }")
  assert.strictEqual(title('activityText(activityState.items[0])'), 'Ses dosyası')
  assert.strictEqual(title('dj.notice()'), 'Ses dosyası')
  // Karttaki son işlem satırı: kendiliğinden biten parçanın bildirimi yoktur, satır ekleme bildiriminde kalır
  run("window.djq = { current: { id: 'y2', type: 'youtube', title: '' }, queue: [] }")
  run("djOnNotice({ op: 'add', by: 2, room: '9', trackId: 'y2', title: '', at: 0 })")
  assert.strictEqual(title('dj.notice()'), 'YouTube videosu')
  // Ad gelince motor değişiklik olayı verir: kart çizilir, Bildirimler kayıtları yenilenir
  run("window.djq.current.title = 'Gece yayını'")
  assert.strictEqual(title('dj.notice()'), 'Gece yayını')
  run('activityDjRefresh()')
  run("window.djq = { current: null, queue: [] }")
  assert.strictEqual(title('dj.notice()'), 'Gece yayını')
  assert.strictEqual(title('activityText(activityState.items[0])'), 'Gece yayını')
})

test('Bildirimler listesi: süren ekran paylaşımının kaydı sık gelen kayıtlarla listeden düşmez', () => {
  const { run } = load()
  const kinds = () => JSON.parse(run('JSON.stringify(activityState.items.map((x) => x.kind + ":" + x.userId))'))
  run("activityAdd({ kind: 'share', userId: '2', channelId: null })")
  run("activityAdd({ kind: 'join', userId: '3', channelId: '9' })")
  const djAdds = [0, 1, 2, 3, 4, 5]
  djAdds.forEach((i) => run("activityAdd({ kind: 'dj', userId: '4', channelId: '9', trackId: 't" + i + "', title: '' })"))
  const list = kinds()
  assert.strictEqual(list.length, 5)
  assert.deepStrictEqual(list, ['dj:4', 'dj:4', 'dj:4', 'dj:4', 'share:2'])
  // En yeni kayıt üsttedir, kimlikler artar
  const ids = JSON.parse(run('JSON.stringify(activityState.items.map((x) => x.id))'))
  assert.deepStrictEqual(ids, [8, 7, 6, 5, 1])
  // Liste yalnızca paylaşımlarla doluysa en eski paylaşım düşer
  run('activityState.items = []')
  const sharers = [10, 11, 12, 13, 14, 15]
  sharers.forEach((i) => run("activityAdd({ kind: 'share', userId: '" + i + "', channelId: null })"))
  assert.deepStrictEqual(kinds(), ['share:15', 'share:14', 'share:13', 'share:12', 'share:11'])
  // Paylaşımlarla dolu listede yeni bir DJ kaydı paylaşımları düşürmez
  run("activityAdd({ kind: 'dj', userId: '4', channelId: '9', trackId: 'x', title: '' })")
  assert.deepStrictEqual(kinds(), ['share:15', 'share:14', 'share:13', 'share:12', 'share:11'])
})

test('Bildirimler listesi: geçerli oyun davetinin kaydı (Masaya Bak) sık gelen Telsiz DJ kayıtlarıyla düşmez', () => {
  const { run } = load()
  const kinds = () => JSON.parse(run('JSON.stringify(activityState.items.map((x) => x.kind + ":" + x.userId))'))
  run("activityAdd({ kind: 'game', userId: '5', channelId: null, app: 'renk' })")
  run("activityAdd({ kind: 'share', userId: '2', channelId: null })")
  const djAdds = [0, 1, 2, 3, 4, 5]
  djAdds.forEach((i) => run("activityAdd({ kind: 'dj', userId: '4', channelId: '9', trackId: 't" + i + "', title: '' })"))
  assert.deepStrictEqual(kinds(), ['dj:4', 'dj:4', 'dj:4', 'share:2', 'game:5'])
  // Davet kalkınca (masa kapandı, Katıl'a basıldı) kayıt da kalkar, yeri sıradan kayıtlara açılır
  run('activityClearGames()')
  assert.deepStrictEqual(kinds(), ['dj:4', 'dj:4', 'dj:4', 'share:2'])
})
