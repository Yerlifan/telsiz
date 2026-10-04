'use strict'

// İstemcinin kimlik, arkadaşlık ve özel mesaj yardımcıları (public/js/13..16) testleri. Modüller
// tarayıcıdaki gibi ortak bir genel ortamda, gerçek crypto.js, tweetnacl ve scrypt-js ile Node vm
// bağlamında yüklenir. Kullanıcı adı kuralı, parola gücü, türetme yardımcısının ortak test vektörü,
// kişiye özel metanın süzülmesi, özel mesaj gönderme koşulları ve çözme denetimleri (yazar ve konuşma
// kimliği, sabitlenmiş anahtarlar, eski anahtar) sınanır.

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
