'use strict'

// İstemcinin kimlik, arkadaşlık ve özel mesaj yardımcıları (public/js/13..16) testleri. Modüller
// tarayıcıdaki gibi ortak bir genel ortamda, gerçek crypto.js, tweetnacl ve scrypt-js ile Node vm
// bağlamında yüklenir. Kullanıcı adı kuralı, parola gücü, türetme yardımcısının ortak test vektörü,
// kişiye özel metanın süzülmesi, özel mesaj gönderme koşulları ve çözme denetimleri (yazar ve konuşma
// kimliği, sabitlenmiş anahtarlar, eski anahtar) sınanır. Profil eşitlemesi (istek 3): düşen profil isteğinin
// artan beklemeyle yeniden denenmesi ve başarılı poll'dan sonra yeniden istenmesi, profil resmi indirmesinin
// yeniden denenmesi ve kalıcı hatada (404, çözülemeyen dosya) durması sahte saatle (t.mock.timers), önbellekli
// yüzeylerin anahtarına giren profil sürümünün (profileEpoch) artması da ayrıca sınanır.

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
  'js/13-profile.js', 'js/14-social.js', 'js/15-dm.js', 'js/16-identity.js'
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

// Yeni bir bağlamda istemci modüllerini yükler, modüllerin genel adlarına erişim için run(ifade) döner.
// opts.clock: sahte saat açıkken bağlam testin (sahte) Date ve zamanlayıcılarını kullanır.
function load (opts) {
  const options = opts || {}
  const sandbox = vm.createContext({})
  sandbox.self = sandbox
  sandbox.window = sandbox
  sandbox.setTimeout = setTimeout
  sandbox.clearTimeout = clearTimeout
  if (options.clock) sandbox.Date = Date
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

// Bekleyen söz zincirlerinin ilerlemesi için olay döngüsüne birkaç tur verir (setImmediate sahte saate bağlı değil)
async function flush (rounds = 5) {
  if (rounds === 0) return
  await new Promise((resolve) => setImmediate(resolve))
  return flush(rounds - 1)
}

// Sahte /api/profiles: her çağrı kaydedilir, yanıt sıradaki işlevden (yoksa bağlantı hatası) gelir
function fakeProfiles (ctx) {
  const calls = []
  const replies = []
  ctx.sandbox.__api = (method, url) => {
    calls.push(url)
    const reply = replies.shift()
    return Promise.resolve(reply ? reply(url) : { status: 0, data: null })
  }
  ctx.run('api = function (method, url) { return __api(method, url) }')
  return { calls, replies }
}

test('profil isteği düşerse grup kuyruğa geri konur, 2, 5, 15 ve 60 saniye sonra yeniden denenir, sonra başarılı poll ister', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 })
  const ctx = load({ clock: true })
  const { run } = ctx
  const net = fakeProfiles(ctx)
  run("state.token = 'oturum'")
  run("state.meta = { channels: [], users: [{ id: 1, name: 'burak', role: 'owner', pv: 0 }, { id: 2, name: 'ayse', role: 'member', pv: 3 }] }")
  run("storeProfileEntry({ id: 1, pv: 0, profile: null, avatarUploadId: null, publicKey: null, identity: null })")
  run('profilesOnMeta()')
  t.mock.timers.tick(30)
  await flush()
  assert.deepStrictEqual(net.calls, ['/api/profiles?ids=2'])
  assert.strictEqual(run("profileState.queue.has('2')"), true, 'düşen grup kuyruğa geri konur')
  // Yeniden denemeler 2, 5, 15 ve 60 saniye sonra
  for (const wait of [2000, 5000, 15000, 60000]) {
    const before = net.calls.length
    t.mock.timers.tick(wait - 1)
    await flush()
    assert.strictEqual(net.calls.length, before, wait + ' ms dolmadan istenmez')
    t.mock.timers.tick(1)
    await flush()
    assert.strictEqual(net.calls.length, before + 1, wait + ' ms sonra yeniden istenir')
  }
  // Dördüncü yeniden deneme de düştü: zamanlayıcı kurulmaz, başarılı poll en erken 60 saniye sonra yeniden ister
  run('profilesAfterPoll()')
  t.mock.timers.tick(600000)
  await flush()
  assert.strictEqual(net.calls.length, 5)
  assert.strictEqual(run('profileRecord(2)'), null)
  net.replies.push(() => ({ status: 200, data: { profiles: [{ id: 2, pv: 3, profile: null, avatarUploadId: null, publicKey: null, identity: null }] } }))
  run('profilesAfterPoll()')
  t.mock.timers.tick(30)
  await flush()
  assert.strictEqual(net.calls.length, 6)
  assert.strictEqual(run('profileRecord(2).pv'), 3)
  assert.strictEqual(run('profileState.failures'), 0)
  // Hata yokken başarılı poll istek göndermez
  run('profilesAfterPoll()')
  t.mock.timers.tick(60000)
  await flush()
  assert.strictEqual(net.calls.length, 6)
})

test('profil isteği beklerken gelen meta bekleme süresini kısaltmaz, ilk başarılı yanıt beklemeyi sıfırlar', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 })
  const ctx = load({ clock: true })
  const { run } = ctx
  const net = fakeProfiles(ctx)
  run("state.token = 'oturum'")
  run("state.meta = { channels: [], users: [{ id: 2, name: 'ayse', role: 'member', pv: 1 }, { id: 3, name: 'mert', role: 'member', pv: 1 }] }")
  run("storeProfileEntry({ id: 3, pv: 1, profile: null, avatarUploadId: null, publicKey: null, identity: null })")
  run('profilesOnMeta()')
  t.mock.timers.tick(30)
  await flush()
  assert.strictEqual(net.calls.length, 1)
  // Mert'in profili değişti (yeni meta): istek ilk yeniden denemeye (2 saniye) kadar bekler, iki kişi birlikte istenir
  run('state.meta.users[1].pv = 2')
  run('profilesOnMeta()')
  t.mock.timers.tick(1999)
  await flush()
  assert.strictEqual(net.calls.length, 1)
  net.replies.push(() => ({ status: 200, data: { profiles: [{ id: 2, pv: 1, profile: null }, { id: 3, pv: 2, profile: null }] } }))
  t.mock.timers.tick(1)
  await flush()
  assert.deepStrictEqual(net.calls, ['/api/profiles?ids=2', '/api/profiles?ids=2,3'])
  assert.strictEqual(run('profileRecord(3).pv'), 2)
  assert.strictEqual(run('profileState.retryAt'), 0)
})

// Profil resmi olan bir kişi (2) ve sahte indirme: her çağrı kaydedilir, yanıt sıradaki değerden gelir
const AVATAR_ID = 'a'.repeat(32)
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

function avatarWorld (t, replies) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 })
  const ctx = load({ clock: true })
  const keys = setupDm(ctx)
  const { E2EE, sandbox, run } = ctx
  const downloads = []
  sandbox.downloadPlain = (f) => {
    downloads.push(f.u)
    const reply = replies.shift()
    return Promise.resolve(reply || { ok: false, status: 0 })
  }
  sandbox.URL = { createObjectURL: () => 'blob:profil-resmi', revokeObjectURL () {} }
  sandbox.Blob = Blob
  const avatarRef = { u: AVATAR_ID, k: 'anahtar', n: 'tek', m: 'image/png', w: 256, h: 256 }
  sandbox.__entry = { id: 2, pv: 2, profile: E2EE.sealJson(keys.kid, { v: 1, u: 2, displayName: 'Ayşe', statusText: '', bio: '', color: 1, avatar: avatarRef }), avatarUploadId: AVATAR_ID, publicKey: keys.theirs.publicKey, identity: E2EE.identity.sealBinding(keys.kid, 2, keys.theirs.publicKey) }
  run('storeProfileEntry(__entry)')
  return { ctx, downloads }
}

test('düşen profil resmi indirmesi 10 saniye, 30 saniye ve 2 dakika sonra yeniden denenir, en çok dört deneme', async (t) => {
  const { ctx, downloads } = avatarWorld(t, [{ ok: false, status: 0 }, { ok: false, status: 503 }, { ok: false, status: 0 }, { ok: false, status: 0 }])
  const { run } = ctx
  await flush()
  assert.strictEqual(downloads.length, 1)
  assert.strictEqual(run("profileState.avatars.get('" + AVATAR_ID + "').state"), 'failed')
  for (const wait of [10000, 30000, 120000]) {
    const before = downloads.length
    t.mock.timers.tick(wait - 1)
    await flush()
    assert.strictEqual(downloads.length, before, wait + ' ms dolmadan indirilmez')
    t.mock.timers.tick(1)
    await flush()
    assert.strictEqual(downloads.length, before + 1, wait + ' ms sonra yeniden indirilir')
  }
  t.mock.timers.tick(3600000)
  await flush()
  assert.strictEqual(downloads.length, 4, 'en çok dört deneme')
  const entry = run("profileState.avatars.get('" + AVATAR_ID + "')")
  assert.strictEqual(entry.state, 'failed')
  assert.strictEqual(entry.tries, 4)
  assert.strictEqual(typeof entry.at, 'number')
  assert.strictEqual(run('avatarUrlOf(2)'), null)
})

test('profil resmi yeniden denemede gelirse görünür, 404 ve çözülemeyen dosyada yeniden denenmez', async (t) => {
  let world = avatarWorld(t, [{ ok: false, status: 0 }, { ok: true, bytes: new Uint8Array(PNG_BYTES) }])
  await flush()
  assert.strictEqual(world.ctx.run('avatarUrlOf(2)'), null)
  t.mock.timers.tick(10000)
  await flush()
  assert.strictEqual(world.downloads.length, 2)
  assert.strictEqual(world.ctx.run('avatarUrlOf(2)'), 'blob:profil-resmi')
  assert.strictEqual(world.ctx.run("profileState.changed.has('2')"), true, 'gelen resim çizim kuyruğuna girer')
  t.mock.timers.reset()

  for (const reply of [{ ok: false, status: 404 }, { ok: false, status: 200 }]) {
    world = avatarWorld(t, [reply])
    await flush()
    t.mock.timers.tick(3600000)
    await flush()
    assert.strictEqual(world.downloads.length, 1, 'kalıcı hata (' + reply.status + ') yeniden denenmez')
    assert.strictEqual(world.ctx.run("profileState.avatars.get('" + AVATAR_ID + "').state"), 'failed')
    t.mock.timers.reset()
  }

  // Türü tutmayan dosya (PNG beklenirken başka bayt) da kalıcıdır
  world = avatarWorld(t, [{ ok: true, bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) }])
  await flush()
  t.mock.timers.tick(3600000)
  await flush()
  assert.strictEqual(world.downloads.length, 1)
})

test('profiller sıfırlanınca bekleyen profil resmi denemesi iptal olur', async (t) => {
  const { ctx, downloads } = avatarWorld(t, [{ ok: false, status: 0 }])
  await flush()
  ctx.run('profilesReset()')
  t.mock.timers.tick(3600000)
  await flush()
  assert.strictEqual(downloads.length, 1)
})

test('profil sürümü profil değişince, kullanıcı adı değişince ve engellenenler listesi gelince artar', () => {
  const ctx = load()
  const keys = setupDm(ctx)
  const { E2EE, sandbox, run } = ctx
  run('profilesOnMeta()')
  let epoch = run('profileEpoch()')
  sandbox.__entry = { id: 2, pv: 2, profile: E2EE.sealJson(keys.kid, { v: 1, u: 2, displayName: 'Ayşe Yeni', statusText: '', bio: '', color: 2, avatar: null }), avatarUploadId: null, publicKey: keys.theirs.publicKey, identity: E2EE.identity.sealBinding(keys.kid, 2, keys.theirs.publicKey) }
  run('storeProfileEntry(__entry)')
  run('queueProfileRender()')
  assert.ok(run('profileEpoch()') > epoch, 'profil değişikliği')
  // Aynı metanın yeniden gelmesi sürümü değiştirmez, kullanıcı adı değişikliği değiştirir ve kişiyi yeniden çizer
  epoch = run('profileEpoch()')
  run('profileState.changed.clear()')
  run('profilesOnMeta()')
  assert.strictEqual(run('profileEpoch()'), epoch, 'değişmeyen meta')
  run("state.meta = { activeKid: state.meta.activeKid, channels: [], users: [state.meta.users[0], { id: 2, name: 'ayse.y', role: 'member', online: true, status: 'online', pv: 2 }] }")
  run('profilesOnMeta()')
  assert.ok(run('profileEpoch()') > epoch, 'kullanıcı adı değişikliği')
  assert.strictEqual(run("profileState.changed.has('2')"), true)
  assert.strictEqual(run('userHandle(2)'), '@ayse.y')
  epoch = run('profileEpoch()')
  run("setFormerUsers([{ id: 98, name: 'eski_uye' }])")
  assert.ok(run('profileEpoch()') > epoch, 'engellenenler listesi')
  epoch = run('profileEpoch()')
  run('profilesReset()')
  assert.ok(run('profileEpoch()') > epoch, 'sıfırlama')
})
