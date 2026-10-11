'use strict'

// İstemcinin kimlik, arkadaşlık ve özel mesaj yardımcıları (public/js/13..16) testleri. Modüller
// tarayıcıdaki gibi ortak bir genel ortamda, gerçek crypto.js, tweetnacl ve scrypt-js ile Node vm
// bağlamında yüklenir. Kullanıcı adı kuralı, parola gücü, türetme yardımcısının ortak test vektörü,
// kişiye özel metanın süzülmesi, özel mesaj gönderme koşulları ve çözme denetimleri (yazar ve konuşma
// kimliği, sabitlenmiş anahtarlar, eski anahtar) sınanır. Profil eşitlemesi (istek 3): düşen profil isteğinin
// artan beklemeyle yeniden denenmesi, başarılı poll'dan sonra bekleme dolunca yeniden istenmesi (ağ düzelince en geç
// 60 saniye), ilk kez istenen kişinin ve kendi kaydedilen profilin beklemeye takılmaması, profil resmi indirmesinin
// yeniden denenmesi, deneme hakkı bitse de başarılı poll'dan sonra ağ düzelince en geç 60 saniye içinde gelmesi ve
// kalıcı hatada (404, çözülemeyen dosya) durması, poll döngüsünün (05-poll.js pollLoop) bu yeniden denemeleri yalnızca
// başarılı yanıttan sonra başlatması sahte saatle (t.mock.timers), önbellekli
// yüzeylerin anahtarına giren profil sürümünün (profileEpoch) artması ve Bildirimler listesinin yalnızca listedeki
// bir kişi değişince yeniden çizilmesi de ayrıca sınanır. Kapak fotoğrafı (istek 8): zarftaki başvurunun sunucudaki
// kayıtla eşleşmesi, kapağın yalnızca gösterileceği zaman indirilmesi ve yeniden denenmesi, önbelleğin son kullanılan
// kapaklarla sınırlı kalması, kaydetmede korunması ve kaldırılması, ortadan 3:1 kırpma ve JPEG kalite sırası (0.85, 0.7,
// 0.55). Kendi profil kaydım yenilenmeden yapılan kaydın profil resmini ve kapağı son başarılı kayıttan alması da sınanır.

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
// Poll döngüsü yalnızca isteyen testlerde, tarayıcıdaki sırasıyla (02-state-dom.js ile 06-messages.js arasında) yüklenir
const POLL_SOURCE = { file: 'js/05-poll.js', code: fs.readFileSync(path.join(PUB, 'js/05-poll.js'), 'utf8') }
const POLL_AT = FILES.indexOf('js/06-messages.js')

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
// opts.clock: sahte saat açıkken bağlam testin (sahte) Date ve zamanlayıcılarını kullanır. opts.poll: 05-poll.js de yüklenir.
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
  const sources = options.poll ? SOURCES.slice(0, POLL_AT).concat([POLL_SOURCE], SOURCES.slice(POLL_AT)) : SOURCES
  for (const src of sources) vm.runInContext(src.code, sandbox, { filename: src.file })
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
  // Dördüncü yeniden deneme de düştü: kendiliğinden zamanlayıcı kurulmaz, poll gelmezse yeniden istenmez
  t.mock.timers.tick(600000)
  await flush()
  assert.strictEqual(net.calls.length, 5)
  assert.strictEqual(run('profileRecord(2)'), null)
  // Son beklemesi dolmuşken gelen başarılı poll hemen yeniden ister, bu istek de düşer
  run('profilesAfterPoll()')
  t.mock.timers.tick(30)
  await flush()
  assert.strictEqual(net.calls.length, 6)
  // Bekleme sürerken gelen poll istemeyi bekleme dolana kadar erteler, sonraki poll'u beklemez. İkinci poll da
  // beklemeyi uzatmaz
  t.mock.timers.tick(1000)
  run('profilesAfterPoll()')
  t.mock.timers.tick(25000)
  run('profilesAfterPoll()')
  net.replies.push(() => ({ status: 200, data: { profiles: [{ id: 2, pv: 3, profile: null, avatarUploadId: null, publicKey: null, identity: null }] } }))
  t.mock.timers.tick(33999)
  await flush()
  assert.strictEqual(net.calls.length, 6, '60 saniye dolmadan istenmez')
  t.mock.timers.tick(1)
  await flush()
  assert.strictEqual(net.calls.length, 7, '60 saniye dolunca poll beklenmeden istenir')
  assert.strictEqual(run('profileRecord(2).pv'), 3)
  assert.strictEqual(run('profileState.failures'), 0)
  // Hata yokken başarılı poll istek göndermez
  run('profilesAfterPoll()')
  t.mock.timers.tick(60000)
  await flush()
  assert.strictEqual(net.calls.length, 7)
})

test('profil isteği beşten çok kez düşse de ağ düzelince en geç 60 saniye içinde gelir, istekler 60 saniyeden sık gitmez', async (t) => {
  // Boş frekansta sunucu poll'u 25 saniye bekletir: poll her 25 saniyede bir döner (phase: dönüş saniyesinin 25'e
  // göre kalanı). Profil istekleri recover saniyesine kadar düşer. Saat saniye saniye ilerler.
  for (const [recover, phase] of [[83, 17], [83, 3], [100, 10], [143, 24], [200, 0]]) {
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
    const ctx = load({ clock: true })
    const { run } = ctx
    const times = []
    let up = false
    ctx.sandbox.__api = () => {
      times.push(Date.now())
      return Promise.resolve(up ? { status: 200, data: { profiles: [{ id: 2, pv: 3, profile: null }] } } : { status: 0, data: null })
    }
    run('api = function (method, url) { return __api(method, url) }')
    run("state.token = 'oturum'")
    run("state.meta = { channels: [], users: [{ id: 1, name: 'burak', role: 'owner', pv: 0 }, { id: 2, name: 'ayse', role: 'member', pv: 3 }] }")
    run('storeProfileEntry({ id: 1, pv: 0, profile: null })')
    run('profilesOnMeta()')
    let got = null
    let s = 0
    while (s < 400 && got === null) {
      s += 1
      t.mock.timers.tick(1000)
      await flush()
      if (s === recover) up = true
      if (s % 25 === phase) {
        run('profilesAfterPoll()')
        await flush()
      }
      if (run('profileRecord(2) !== null')) got = s
    }
    const label = 'ağ ' + recover + '. saniyede düzeldi, poll kalanı ' + phase
    assert.ok(got !== null && got - recover <= 60, label + ': profil ' + got + '. saniyede geldi')
    // Dördüncü yeniden denemeden sonra iki istek arasında en az 60 saniye vardır
    times.slice(4).forEach((at, i) => {
      assert.ok(at - times[i + 3] >= 60000, label + ': ' + times[i + 3] + ' ve ' + at + ' ms')
    })
    t.mock.timers.reset()
  }
})

test('bekleme sürerken ilk kez istenen kişi ve kişinin kendi kaydettiği profili beklemeden istenir', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 })
  const ctx = load({ clock: true })
  const { run } = ctx
  const net = fakeProfiles(ctx)
  run("state.token = 'oturum'")
  run("state.meta = { channels: [], users: [{ id: 1, name: 'burak', role: 'owner', pv: 0 }, { id: 2, name: 'ayse', role: 'member', pv: 3 }] }")
  run('storeProfileEntry({ id: 1, pv: 0, profile: null })')
  run('profilesOnMeta()')
  // İlk istek ve 2, 5 ve 15 saniye sonraki yeniden denemeler düşer, sıradaki deneme 60 saniye sonra
  for (const wait of [30, 2000, 5000, 15000]) {
    t.mock.timers.tick(wait)
    await flush()
  }
  assert.strictEqual(net.calls.length, 4)
  // Kuyrukta bekleyen kişinin yeniden istenmesi beklemeyi kısaltmaz
  run('profilesEnsure([2])')
  t.mock.timers.tick(1000)
  await flush()
  assert.strictEqual(net.calls.length, 4)
  // İlk kez istenen kişi (yeni açılan profil kartı veya özel mesaj kişisi) beklemez, kuyruktaki grup da aynı istekle
  // gider. Bu istek de düşer: kişi kuyrukta kalır ve yeniden istenince bekleme kısalmaz
  run('profilesEnsure([5])')
  t.mock.timers.tick(30)
  await flush()
  assert.deepStrictEqual(net.calls.slice(4), ['/api/profiles?ids=2,5'])
  run("profilesEnsure([5, 2, 'gecersiz'])")
  t.mock.timers.tick(10000)
  await flush()
  assert.strictEqual(net.calls.length, 5)
  // Kişi kendi profilini kaydetti (POST /api/me/profile 200): kendi kaydı beklemeden yeniden istenir
  net.replies.push(() => ({ status: 200, data: { profiles: [{ id: 2, pv: 3, profile: null }, { id: 5, pv: 1, profile: null }, { id: 1, pv: 1, profile: null }] } }))
  run('profilesRefetch([1])')
  t.mock.timers.tick(30)
  await flush()
  assert.deepStrictEqual(net.calls.slice(5), ['/api/profiles?ids=2,5,1'])
  assert.strictEqual(run('profileRecord(1).pv'), 1)
  assert.strictEqual(run('profileRecord(5).pv'), 1)
  assert.strictEqual(run('profileState.failures'), 0)
  assert.strictEqual(run('profileState.retryAt'), 0)
})

test('Bildirimler listesi yalnızca kayıtlarındaki bir kişinin profili değişince yeniden çizilir', () => {
  const { run } = load()
  run('globalThis.__renders = 0')
  run('globalThis.renderActivity = function () { __renders += 1 }')
  run("globalThis.activityState = { items: [{ id: 2, kind: 'share', userId: '3', channelId: null }, { id: 1, kind: 'join', userId: '2', channelId: '9' }] }")
  run("profileActivityRefresh(new Set(['4', '5']))")
  assert.strictEqual(run('__renders'), 0, 'listede olmayan kişiler')
  run("profileActivityRefresh(new Set(['5', '2']))")
  assert.strictEqual(run('__renders'), 1, 'listedeki kişi')
  run('activityState.items = []')
  run("profileActivityRefresh(new Set(['2']))")
  assert.strictEqual(run('__renders'), 1, 'boş liste')
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

// replies: sıradaki yanıtların dizisi veya her indirmede yanıtı veren işlev. opts load'a geçer.
function avatarWorld (t, replies, opts) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 })
  const ctx = load(Object.assign({ clock: true }, opts))
  const keys = setupDm(ctx)
  const { E2EE, sandbox, run } = ctx
  const downloads = []
  sandbox.downloadPlain = (f) => {
    downloads.push(f.u)
    const reply = typeof replies === 'function' ? replies() : replies.shift()
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

test('deneme hakkı bitmiş profil resmi ağ düzelince başarılı poll ile en geç 60 saniye içinde gelir, istekler dakikada birden sık gitmez', async (t) => {
  // İndirmeler recover saniyesine kadar düşer. Poll her every saniyede bir döner (phase: dönüş saniyesinin every'ye
  // göre kalanı), sunucuya ulaşılamazken de başarılı dönen poll en çok isteğe yol açan durumdur. Saat saniye saniye
  // ilerler. 50: üçüncü denemeden sonraki 2 dakikalık bekleme sürerken, 170: dört deneme de düştükten sonra.
  for (const [recover, every, phase] of [[50, 25, 17], [50, 1, 0], [170, 25, 3], [170, 1, 0], [100, 25, 24], [300, 25, 0]]) {
    let up = false
    const { ctx, downloads } = avatarWorld(t, () => (up ? { ok: true, bytes: new Uint8Array(PNG_BYTES) } : { ok: false, status: 0 }))
    const { run } = ctx
    run("state.token = 'oturum'")
    const t0 = Date.now()
    const times = []
    const record = () => {
      while (times.length < downloads.length) times.push(Date.now() - t0)
    }
    await flush()
    record()
    let got = null
    let s = 0
    while (s < 600 && got === null) {
      s += 1
      t.mock.timers.tick(1000)
      await flush()
      record()
      if (s === recover) up = true
      if (s % every === phase) {
        run('profilesAfterPoll()')
        await flush()
        record()
      }
      if (run('avatarUrlOf(2)') !== null) got = s
    }
    const label = 'ağ ' + recover + '. saniyede düzeldi, poll ' + every + ' saniyede bir (kalan ' + phase + ')'
    assert.ok(got !== null && got - recover <= 60, label + ': resim ' + got + '. saniyede geldi, indirmeler ' + times.join(', '))
    assert.strictEqual(run("profileState.changed.has('2')"), true, label + ': gelen resim çizim kuyruğuna girer')
    // İlk iki yeniden deneme 10 ve 30 saniye sonradır, sonraki iki indirme arasında en az 60 saniye vardır
    assert.deepStrictEqual(times.slice(0, 3), [0, 10000, 40000], label)
    times.slice(3).forEach((at, i) => {
      assert.ok(at - times[i + 2] >= 60000, label + ': ' + times[i + 2] + ' ve ' + at + ' ms')
    })
    t.mock.timers.reset()
  }
})

test('başarılı poll kalıcı hatayı yeniden denemez, kısa yeniden denemeyi ertelemez, 2 dakikalık beklemeyi öne çeker', async (t) => {
  let world = avatarWorld(t, [{ ok: false, status: 0 }, { ok: false, status: 0 }, { ok: false, status: 0 }, { ok: true, bytes: new Uint8Array(PNG_BYTES) }])
  let run = world.ctx.run
  run("state.token = 'oturum'")
  const tick = async (ms) => {
    t.mock.timers.tick(ms)
    await flush()
  }
  await flush()
  assert.strictEqual(world.downloads.length, 1)
  // İlk deneme düştü: 5. saniyedeki poll 10 saniyelik denemeyi ertelemez, öne de çekmez
  await tick(5000)
  run('profilesAfterPoll()')
  await tick(4999)
  assert.strictEqual(world.downloads.length, 1)
  await tick(1)
  assert.strictEqual(world.downloads.length, 2, '10 saniye sonra')
  // İkinci deneme düştü: 30 saniyelik deneme poll'a rağmen yerinde kalır
  await tick(10000)
  run('profilesAfterPoll()')
  await tick(20000)
  assert.strictEqual(world.downloads.length, 3, '40. saniyede')
  // Üçüncü deneme düştü, sıradaki deneme 2 dakika sonra (160. saniye). 50. saniyedeki poll denemeyi son denemenin
  // üzerinden 60 saniye geçince (100. saniye) yapar
  await tick(10000)
  run('profilesAfterPoll()')
  await tick(49999)
  assert.strictEqual(world.downloads.length, 3)
  await tick(1)
  assert.strictEqual(world.downloads.length, 4, '100. saniyede')
  assert.strictEqual(run('avatarUrlOf(2)'), 'blob:profil-resmi')
  // Resim geldikten sonra poll indirme başlatmaz
  run('profilesAfterPoll()')
  await tick(3600000)
  assert.strictEqual(world.downloads.length, 4)
  t.mock.timers.reset()

  // Kalıcı hata (404 ve çözülemeyen dosya) başarılı poll'dan sonra da yeniden istenmez
  for (const reply of [{ ok: false, status: 404 }, { ok: false, status: 200 }]) {
    world = avatarWorld(t, [reply])
    run = world.ctx.run
    run("state.token = 'oturum'")
    await flush()
    for (const wait of Array(5).fill(60000)) {
      await tick(wait)
      run('profilesAfterPoll()')
    }
    await tick(60000)
    assert.strictEqual(world.downloads.length, 1, 'kalıcı hata (' + reply.status + ')')
    t.mock.timers.reset()
  }
})

test('başarılı poll deneme hakkı bitmiş kapağı yalnızca kart açıkken yeniden ister', async (t) => {
  const { ctx, downloads } = coverWorld(t, [{ ok: false, status: 0 }, { ok: false, status: 0 }, { ok: false, status: 0 }, { ok: false, status: 0 }, { ok: true, bytes: new Uint8Array(JPEG_HEAD.concat([1, 2, 3])) }])
  const { run, sandbox } = ctx
  let refreshed = 0
  sandbox.__refresh = () => {
    refreshed++
  }
  run('refreshProfileCardCover = function () { __refresh() }')
  run("state.token = 'oturum'")
  const tick = async (ms) => {
    t.mock.timers.tick(ms)
    await flush()
  }
  run('profileState.cardUserId = 2')
  run('coverUrlOf(2, true)')
  await flush()
  for (const wait of [10000, 30000, 120000]) await tick(wait)
  assert.strictEqual(downloads.length, 4)
  assert.strictEqual(run("profileState.covers.get('" + COVER_ID + "').state"), 'failed')
  // Kart kapandı: poll kapağı istemez
  run('profileState.cardUserId = null')
  run('profilesAfterPoll()')
  await tick(120000)
  run('profilesAfterPoll()')
  await tick(120000)
  assert.strictEqual(downloads.length, 4, 'kapalı kartın kapağı istenmez')
  // Kart yeniden açıldı: yeniden çizim indirmeyi yinelemez, sonraki başarılı poll kapağı hemen ister
  run('profileState.cardUserId = 2')
  run('coverUrlOf(2, true)')
  await flush()
  assert.strictEqual(downloads.length, 4)
  run('profilesAfterPoll()')
  await tick(0)
  assert.strictEqual(downloads.length, 5)
  assert.strictEqual(run('coverUrlOf(2)'), 'blob:kapak')
  assert.strictEqual(refreshed, 1, 'açık kartın bandı yenilenir')
})

test('poll döngüsü düşen profil isteğini ve profil resmini başarılı yanıttan sonra yeniden ister, hata yanıtından sonra istemez', async (t) => {
  // Kişi 2'nin profil resmi indirmesi ve kişi 3'ün profil isteği ağ düzelene kadar düşer
  let up = false
  const { ctx, downloads } = avatarWorld(t, () => (up ? { ok: true, bytes: new Uint8Array(PNG_BYTES) } : { ok: false, status: 0 }), { poll: true })
  const { run, sandbox } = ctx
  const tick = async (ms) => {
    t.mock.timers.tick(ms)
    await flush()
  }
  // Sahte api: poll yanıtı test çözene kadar bekler (uzun poll), profil isteği ağ durumuna göre yanıtlanır
  const polls = []
  const profileCalls = []
  sandbox.__api = (method, url) => {
    if (url.indexOf('/api/poll?') === 0) {
      let resolve = null
      const pending = new Promise((r) => {
        resolve = r
      })
      pending.abort = () => resolve({ status: 0, data: null })
      polls.push(resolve)
      return pending
    }
    profileCalls.push(url)
    return Promise.resolve(up ? { status: 200, data: { profiles: [{ id: 3, pv: 2, profile: null }] } } : { status: 0, data: null })
  }
  run('api = function (method, url) { return __api(method, url) }')
  run('el.connBanner = { hidden: true }')
  run("state.token = 'oturum'")
  run('state.meta.users[1].pv = 2')
  run("state.meta.users.push({ id: 3, name: 'mert', role: 'member', online: true, status: 'online', pv: 2 })")
  run('storeProfileEntry({ id: 1, pv: 1, profile: null })')
  run('profilesOnMeta()')
  // Profil isteği beş kez (ilk istek ve 2, 5, 15, 60 saniye sonra), profil resmi dört kez düşer
  for (const wait of Array(400).fill(1000)) await tick(wait)
  assert.deepStrictEqual(profileCalls, Array(5).fill('/api/profiles?ids=3'))
  assert.strictEqual(downloads.length, 4)
  // Poll döngüsü başlar, ilk poll hata döner: profil isteği ve indirme başlamaz
  run('startPoll()')
  await flush()
  assert.strictEqual(polls.length, 1)
  polls[0]({ status: 0, data: null })
  await flush()
  assert.strictEqual(run('state.connLost'), true)
  await tick(1000)
  assert.strictEqual(polls.length, 2, 'hatadan sonra yeni poll')
  await tick(120000)
  assert.strictEqual(profileCalls.length, 5, 'hata yanıtı profil isteği başlatmaz')
  assert.strictEqual(downloads.length, 4, 'hata yanıtı indirme başlatmaz')
  // Ağ düzeldi, poll başarılı döner: profil ve profil resmi 60 saniye içinde gelir
  up = true
  polls[1]({ status: 200, data: {} })
  await flush()
  assert.strictEqual(run('state.connLost'), false)
  assert.strictEqual(polls.length, 3, 'başarılı yanıttan sonra yeni poll')
  let waited = 0
  while (waited < 60000 && (run('profileRecord(3)') === null || run('avatarUrlOf(2)') === null)) {
    await tick(1000)
    waited += 1000
  }
  assert.strictEqual(run('profileRecord(3).pv'), 2, 'profil ' + waited + ' ms içinde gelir')
  assert.strictEqual(run('avatarUrlOf(2)'), 'blob:profil-resmi')
  assert.strictEqual(profileCalls.length, 6)
  assert.strictEqual(downloads.length, 5)
  run('stopPoll()')
  await flush()
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

// Kapak fotoğrafı (istek 8)

const COVER_ID = 'c'.repeat(32)

function coverWorld (t, replies) {
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
  sandbox.URL = { createObjectURL: () => 'blob:kapak', revokeObjectURL () {} }
  sandbox.Blob = Blob
  const coverRef = { u: COVER_ID, k: 'anahtar', n: 'tek', m: 'image/jpeg', w: 1200, h: 400 }
  sandbox.__entry = { id: 2, pv: 2, profile: E2EE.sealJson(keys.kid, { v: 1, u: 2, displayName: 'Ayşe', statusText: '', bio: '', color: 1, avatar: null, cover: coverRef }), avatarUploadId: null, coverUploadId: COVER_ID, publicKey: keys.theirs.publicKey, identity: E2EE.identity.sealBinding(keys.kid, 2, keys.theirs.publicKey) }
  run('storeProfileEntry(__entry)')
  return { ctx, keys, downloads, coverRef }
}

const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0]

test('kapak başvurusu yalnızca sunucudaki coverUploadId ile eşleşirse kabul edilir, kapağı olmayan eski zarf boş kapak verir', () => {
  const ctx = load()
  const keys = setupDm(ctx)
  const { E2EE, sandbox, run } = ctx
  const ref = { u: COVER_ID, k: 'anahtar', n: 'tek', m: 'image/jpeg', w: 1200, h: 400 }
  const entry = (pv, cover, coverUploadId) => ({ id: 2, pv: pv, profile: E2EE.sealJson(keys.kid, { v: 1, u: 2, displayName: 'Ayşe', statusText: '', bio: '', color: 1, avatar: null, cover: cover }), avatarUploadId: null, coverUploadId: coverUploadId, publicKey: keys.theirs.publicKey, identity: null })
  sandbox.__entry = entry(2, ref, COVER_ID)
  run('storeProfileEntry(__entry)')
  assert.deepStrictEqual(JSON.parse(run('JSON.stringify(profileRecord(2).profile.cover)')), { u: COVER_ID, k: 'anahtar', n: 'tek', m: 'image/jpeg' })
  assert.strictEqual(run('profileRecord(2).coverUploadId'), COVER_ID)
  // Sunucu kapağı kaldırmışsa (eski istemcinin kaydı) zarftaki başvuru yok sayılır
  sandbox.__entry = entry(3, ref, null)
  run('storeProfileEntry(__entry)')
  assert.strictEqual(run('profileRecord(2).profile.cover'), null)
  // Başka bir yüklemeye işaret eden, türü desteklenmeyen veya alanı eksik başvuru
  for (const bad of [Object.assign({}, ref, { u: 'd'.repeat(32) }), Object.assign({}, ref, { m: 'image/gif' }), { u: COVER_ID, k: 'anahtar', m: 'image/jpeg' }, 'kapak']) {
    sandbox.__entry = entry(4, bad, COVER_ID)
    run('storeProfileEntry(__entry)')
    assert.strictEqual(run('profileRecord(2).profile.cover'), null, JSON.stringify(bad))
  }
  // Kapak alanı olmayan eski zarf
  sandbox.__entry = { id: 2, pv: 5, profile: E2EE.sealJson(keys.kid, { v: 1, u: 2, displayName: 'Ayşe', statusText: '', bio: '', color: 1, avatar: null }), avatarUploadId: null, publicKey: keys.theirs.publicKey, identity: null }
  run('storeProfileEntry(__entry)')
  assert.strictEqual(run('profileRecord(2).profile.cover'), null)
  assert.strictEqual(run('profileRecord(2).coverUploadId'), null)
  assert.strictEqual(run('coverUrlOf(2, true)'), null)
})

test('kapak yalnızca gösterileceği zaman indirilir, gelince açık kartın bandı yenilenir, düşen indirme yeniden denenir', async (t) => {
  const { ctx, downloads } = coverWorld(t, [{ ok: false, status: 0 }, { ok: true, bytes: new Uint8Array(JPEG_HEAD.concat([1, 2, 3])) }])
  const { run, sandbox } = ctx
  await flush()
  assert.strictEqual(downloads.length, 0, 'profil gelince kapak indirilmez')
  assert.strictEqual(run('coverUrlOf(2)'), null)
  await flush()
  assert.strictEqual(downloads.length, 0, 'yalnızca sorgu indirmez')
  // Kart açıkken: kapak istenir, ilk indirme düşer, 10 saniye sonra gelir ve yalnızca kartın bandı yenilenir
  let refreshed = 0
  let rebuilt = 0
  sandbox.__refresh = () => {
    refreshed++
  }
  sandbox.__rebuild = () => {
    rebuilt++
  }
  run('refreshProfileCardCover = function () { __refresh() }')
  run('refreshProfileCard = function () { __rebuild() }')
  run('profileState.cardUserId = 2')
  assert.strictEqual(run('coverUrlOf(2, true)'), null)
  await flush()
  assert.deepStrictEqual(downloads, [COVER_ID])
  assert.strictEqual(run("profileState.covers.get('" + COVER_ID + "').state"), 'failed')
  const epoch = run('profileEpoch()')
  t.mock.timers.tick(10000)
  await flush()
  assert.strictEqual(downloads.length, 2)
  assert.strictEqual(run('coverUrlOf(2)'), 'blob:kapak')
  assert.strictEqual(refreshed, 1, 'açık kartın bandı yenilenir')
  assert.strictEqual(rebuilt, 0, 'kart bütünüyle yeniden kurulmaz')
  assert.strictEqual(run('profileEpoch()'), epoch, 'kapak profil sürümünü değiştirmez')
  assert.strictEqual(run('avatarUrlOf(2)'), null)
  // Yeniden sorgu indirmeyi yinelemez
  run('coverUrlOf(2, true)')
  await flush()
  assert.strictEqual(downloads.length, 2)
})

test('kapağı kaldırılan kişinin eski kapağı bırakılır, türü tutmayan kapak yeniden denenmez', async (t) => {
  let world = coverWorld(t, [{ ok: true, bytes: new Uint8Array(JPEG_HEAD) }])
  world.ctx.run('coverUrlOf(2, true)')
  await flush()
  assert.strictEqual(world.ctx.run('coverUrlOf(2)'), 'blob:kapak')
  world.ctx.sandbox.__entry = { id: 2, pv: 3, profile: world.ctx.E2EE.sealJson(world.keys.kid, { v: 1, u: 2, displayName: 'Ayşe', statusText: '', bio: '', color: 1, avatar: null, cover: null }), avatarUploadId: null, coverUploadId: null, publicKey: world.keys.theirs.publicKey, identity: null }
  world.ctx.run('storeProfileEntry(__entry)')
  assert.strictEqual(world.ctx.run("profileState.covers.has('" + COVER_ID + "')"), false)
  assert.strictEqual(world.ctx.run('coverUrlOf(2, true)'), null)
  t.mock.timers.reset()

  // PNG baytları JPEG başvurusuyla gelirse kalıcı hatadır
  world = coverWorld(t, [{ ok: true, bytes: new Uint8Array(PNG_BYTES) }])
  world.ctx.run('coverUrlOf(2, true)')
  await flush()
  t.mock.timers.tick(3600000)
  await flush()
  assert.strictEqual(world.downloads.length, 1)
  assert.strictEqual(world.ctx.run("profileState.covers.get('" + COVER_ID + "').state"), 'failed')
})

test('kapak önbelleği son kullanılan 20 kapakla sınırlıdır, açık kartın ve kendi kapağım atılmaz, silinen kişinin kapağı bırakılır', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 })
  const ctx = load({ clock: true })
  const keys = setupDm(ctx)
  const { E2EE, sandbox, run } = ctx
  // Her kapak sırayla gösterilir, blob adresi son indirilen kapağın kimliğini taşır
  let last = ''
  const revoked = []
  sandbox.URL = {
    createObjectURL: () => 'blob:' + last,
    revokeObjectURL (url) {
      revoked.push(url)
    }
  }
  sandbox.Blob = Blob
  sandbox.downloadPlain = (f) => {
    last = f.u
    return Promise.resolve({ ok: true, bytes: new Uint8Array(JPEG_HEAD) })
  }
  const coverOf = (id) => id.toString(16).padStart(32, '0')
  // a..b (ikisi de dahil) kimlikleri
  const range = (a, b) => Array.from({ length: b - a + 1 }, (x, i) => a + i)
  const users = []
  for (const id of range(1, 30)) users.push({ id: id, name: 'kisi' + id, role: 'member', online: true, status: 'online', pv: 2 })
  sandbox.__users = users
  run('state.meta.users = __users')
  for (const id of range(1, 30)) {
    const cover = { u: coverOf(id), k: 'anahtar', n: 'tek', m: 'image/jpeg', w: 1200, h: 400 }
    sandbox.__entry = { id: id, pv: 2, profile: E2EE.sealJson(keys.kid, { v: 1, u: id, displayName: 'Kişi ' + id, statusText: '', bio: '', color: 1, avatar: null, cover: cover }), avatarUploadId: null, coverUploadId: cover.u, publicKey: null, identity: null }
    run('storeProfileEntry(__entry)')
  }
  const show = async (id) => {
    run('coverUrlOf(' + id + ', true)')
    await flush()
  }
  // Bağlamdaki dizi başka bir realm'den gelir, karşılaştırma için düz JSON'a çevrilir
  const cached = () => JSON.parse(run('JSON.stringify(Array.from(profileState.covers.keys()))'))
  // Önce kendi kapağım (Ayarlar önizlemesi) ve açık kart, sonra 18 kişinin kartı: sınır dolar, hiçbiri atılmaz
  await show(1)
  run('refreshProfileCardCover = function () {}')
  run('profileState.cardUserId = 2')
  await show(2)
  for (const id of range(3, 20)) await show(id)
  assert.strictEqual(cached().length, 20)
  // Yeniden gösterilen kapak sona alınır, sınırı aşan ilk kapakta en uzun süredir kullanılmayan (4) bırakılır
  await show(3)
  await show(21)
  assert.strictEqual(cached().length, 20)
  assert.strictEqual(cached().indexOf(coverOf(3)) !== -1, true, 'yeniden gösterilen kapak tutulur')
  assert.strictEqual(cached().indexOf(coverOf(4)), -1, 'en eski kapak bırakılır')
  for (const id of range(22, 30)) await show(id)
  const expected = [1, 2, 3]
  for (const id of range(14, 30)) expected.push(id)
  assert.deepStrictEqual(cached().slice().sort(), expected.map(coverOf).sort())
  assert.strictEqual(run('profileState.covers.size'), 20)
  // Bırakılan kapakların blob adresleri süre dolunca serbest kalır
  t.mock.timers.tick(60000)
  const dropped = []
  for (const id of range(4, 13)) dropped.push('blob:' + coverOf(id))
  assert.deepStrictEqual(revoked.slice().sort(), dropped.sort())
  assert.strictEqual(run('coverUrlOf(1)'), 'blob:' + coverOf(1), 'kendi kapağım bellekte kalır')
  assert.strictEqual(run('coverUrlOf(2)'), 'blob:' + coverOf(2), 'açık kartın kapağı bellekte kalır')
  // Silinen veya sunucudan engellenen kişinin (profil yanıtında yok) kapağı bırakılır
  const net = fakeProfiles(ctx)
  net.replies.push(() => ({ status: 200, data: { profiles: [] } }))
  run("state.token = 'oturum'")
  run("profileState.queue.add('30')")
  await run('fetchProfiles()')
  assert.deepStrictEqual(net.calls, ['/api/profiles?ids=30'])
  assert.strictEqual(run('profileRecord(30).missing'), true)
  assert.strictEqual(run("profileState.covers.has('" + coverOf(30) + "')"), false)
  t.mock.timers.tick(60000)
  assert.strictEqual(revoked.indexOf('blob:' + coverOf(30)) !== -1, true)
})

test('kendi profili kaydedilirken kapak korunur, null ile kaldırılır, yeni kapak zarfa ve isteğe girer', async () => {
  const ctx = load()
  const keys = setupDm(ctx)
  const { E2EE, sandbox, run } = ctx
  const ref = { u: COVER_ID, k: 'anahtar', n: 'tek', m: 'image/jpeg', w: 1200, h: 400 }
  sandbox.__entry = { id: 1, pv: 1, profile: E2EE.sealJson(keys.kid, { v: 1, u: 1, displayName: 'Burak', statusText: '', bio: '', color: 3, avatar: null, cover: ref }), avatarUploadId: null, coverUploadId: COVER_ID, publicKey: keys.mine.publicKey, identity: null }
  run('storeProfileEntry(__entry)')
  const posts = []
  sandbox.__api = (method, url, body) => {
    if (method === 'POST') posts.push({ url: url, body: body })
    return Promise.resolve(method === 'POST' ? { status: 200, data: { ok: true, pv: 2 } } : { status: 0, data: null })
  }
  run('api = function (method, url, body) { return __api(method, url, body) }')
  run('activeKid = function () { return state.meta.activeKid }')
  run('hasActiveKey = function () { return true }')
  // Bağlamdaki nesneler başka bir realm'den gelir, karşılaştırma için düz JSON'a çevrilir
  const opened = (post) => JSON.parse(JSON.stringify(E2EE.openJson(post.body.profile).value))
  // Durum metni gibi başka bir alan kaydedilince kapak aynen kalır
  let result = await run("saveProfile({ displayName: 'Burak', statusText: 'Yeni durum', bio: '', color: 3 })")
  assert.strictEqual(result.ok, true)
  assert.strictEqual(posts[0].url, '/api/me/profile')
  assert.strictEqual(posts[0].body.coverUploadId, COVER_ID)
  assert.deepStrictEqual(opened(posts[0]).cover, ref)
  // Yeni kapak: yüklenen başvuru zarfa ve coverUploadId alanına girer
  const fresh = { u: 'e'.repeat(32), k: 'yeni', n: 'tek2', m: 'image/jpeg' }
  sandbox.__fresh = fresh
  run('uploadCover = function () { return Promise.resolve({ ok: true, ref: __fresh }) }')
  result = await run("saveProfile({ displayName: 'Burak', statusText: '', bio: '', color: 3, coverFile: {} })")
  assert.strictEqual(result.ok, true)
  assert.strictEqual(posts[1].body.coverUploadId, fresh.u)
  assert.deepStrictEqual(opened(posts[1]).cover, Object.assign({}, fresh, { w: 1200, h: 400 }))
  // Yükleme düşerse profil kaydedilmez
  run("uploadCover = function () { return Promise.resolve({ ok: false, error: function () { return 'olmadı' } }) }")
  result = await run("saveProfile({ displayName: 'Burak', statusText: '', bio: '', color: 3, coverFile: {} })")
  assert.strictEqual(result.ok, false)
  assert.strictEqual(posts.length, 2)
  // null kapağı kaldırır
  result = await run("saveProfile({ displayName: 'Burak', statusText: '', bio: '', color: 3, coverFile: null })")
  assert.strictEqual(result.ok, true)
  assert.strictEqual(posts[2].body.coverUploadId, null)
  assert.strictEqual(opened(posts[2]).cover, null)
})

test('kendi profil kaydım yenilenmeden yapılan kayıt profil resmini ve kapağı son başarılı kayıttan alır, eski kayıt onları ezemez', async () => {
  const ctx = load()
  const keys = setupDm(ctx)
  const { E2EE, sandbox, run } = ctx
  run('loadAvatar = function () {}')
  const own = (pv, avatar, cover) => ({ id: 1, pv: pv, profile: E2EE.sealJson(keys.kid, { v: 1, u: 1, displayName: 'Deniz', statusText: '', bio: '', color: 3, avatar: avatar, cover: cover }), avatarUploadId: avatar ? avatar.u : null, coverUploadId: cover ? cover.u : null, publicKey: keys.mine.publicKey, identity: null })
  const oldAvatar = { u: AVATAR_ID, k: 'eski', n: 'tek', m: 'image/png', w: 256, h: 256 }
  const oldCover = { u: COVER_ID, k: 'eski', n: 'tek', m: 'image/jpeg', w: 1200, h: 400 }
  sandbox.__entry = own(1, oldAvatar, oldCover)
  run('storeProfileEntry(__entry)')
  // Kayıtlar sunucuya ulaşır, kendi profil kaydımı yenileme istekleri düşer (status 0)
  let serverPv = 1
  const posts = []
  sandbox.__api = (method, url, body) => {
    if (method !== 'POST') return Promise.resolve({ status: 0, data: null })
    posts.push(body)
    serverPv += 1
    return Promise.resolve({ status: 200, data: { ok: true, pv: serverPv } })
  }
  run('api = function (method, url, body) { return __api(method, url, body) }')
  run('activeKid = function () { return state.meta.activeKid }')
  run('hasActiveKey = function () { return true }')
  const newAvatar = { u: 'b'.repeat(32), k: 'yeni', n: 'tek2', m: 'image/png' }
  const newCover = { u: 'e'.repeat(32), k: 'yeni', n: 'tek3', m: 'image/jpeg' }
  sandbox.__newAvatar = newAvatar
  sandbox.__newCover = newCover
  run('uploadAvatar = function () { return Promise.resolve({ ok: true, ref: __newAvatar }) }')
  run('uploadCover = function () { return Promise.resolve({ ok: true, ref: __newCover }) }')
  const opened = (body) => JSON.parse(JSON.stringify(E2EE.openJson(body.profile).value))
  const textOnly = "saveProfile({ displayName: 'Deniz', statusText: '', bio: 'Yeni metin', color: 3 })"
  // Profil resmi ve kapak değişir, kendi kaydım eski resimleri göstermeye devam eder
  let result = await run("saveProfile({ displayName: 'Deniz', statusText: '', bio: '', color: 3, avatarFile: {}, coverFile: {} })")
  assert.strictEqual(result.ok, true)
  assert.strictEqual(posts[0].avatarUploadId, newAvatar.u)
  assert.strictEqual(posts[0].coverUploadId, newCover.u)
  assert.strictEqual(run('profileRecord(1).profile.cover.u'), COVER_ID)
  // Yalnızca metin değişir: sunucuda silinen eski resimler değil (bad_avatar, bad_cover), yeni resimler gider
  result = await run(textOnly)
  assert.strictEqual(result.ok, true)
  assert.strictEqual(posts[1].avatarUploadId, newAvatar.u)
  assert.strictEqual(posts[1].coverUploadId, newCover.u)
  assert.deepStrictEqual(opened(posts[1]).avatar, Object.assign({}, newAvatar, { w: 256, h: 256 }))
  assert.deepStrictEqual(opened(posts[1]).cover, Object.assign({}, newCover, { w: 1200, h: 400 }))
  assert.strictEqual(opened(posts[1]).bio, 'Yeni metin')
  // Oturum veya frekans değişince son kayıt unutulur
  run('profilesReset()')
  assert.strictEqual(run('profileState.ownSaved'), null)
  // Resmi olmayan kayıt da yeni yüklenen resimleri kaldıramaz
  sandbox.__entry = own(serverPv, null, null)
  run('storeProfileEntry(__entry)')
  result = await run("saveProfile({ displayName: 'Deniz', statusText: '', bio: '', color: 3, avatarFile: {}, coverFile: {} })")
  assert.strictEqual(result.ok, true)
  assert.strictEqual(run('profileRecord(1).profile.cover'), null)
  result = await run(textOnly)
  assert.strictEqual(posts[3].avatarUploadId, newAvatar.u)
  assert.strictEqual(posts[3].coverUploadId, newCover.u)
  // Bilerek kaldırılan resim yine kalkar
  result = await run("saveProfile({ displayName: 'Deniz', statusText: '', bio: '', color: 3, coverFile: null })")
  assert.strictEqual(posts[4].avatarUploadId, newAvatar.u)
  assert.strictEqual(posts[4].coverUploadId, null)
  result = await run(textOnly)
  assert.strictEqual(posts[5].coverUploadId, null)
  // Kayıt son kayıt kadar yeni veya daha yeniyse (başka cihazdan kaydedilen kapak) kayıttaki resimler geçerlidir
  const otherCover = { u: 'f'.repeat(32), k: 'baska', n: 'tek4', m: 'image/jpeg', w: 1200, h: 400 }
  sandbox.__entry = own(serverPv + 1, null, otherCover)
  run('storeProfileEntry(__entry)')
  serverPv += 1
  result = await run(textOnly)
  assert.strictEqual(posts[6].avatarUploadId, null)
  assert.strictEqual(posts[6].coverUploadId, otherCover.u)
  assert.deepStrictEqual(opened(posts[6]).cover, otherCover)
  // Kayıt sürerken profiller sıfırlanırsa (çıkış, frekans değişimi) yanıt son kayıt olarak saklanmaz
  let release = null
  sandbox.__api = (method, url, body) => {
    posts.push(body)
    return new Promise((resolve) => {
      release = () => resolve({ status: 200, data: { ok: true, pv: 99 } })
    })
  }
  const late = run(textOnly)
  run('profilesReset()')
  release()
  result = await late
  assert.strictEqual(result.ok, true)
  assert.strictEqual(run('profileState.ownSaved'), null)
})

test('kapak kırpması kaynağın ortasından en büyük 3:1 dikdörtgeni alır', () => {
  const { run } = load()
  const crop = (w, h) => JSON.parse(run('JSON.stringify(coverCrop(' + w + ', ' + h + '))'))
  assert.deepStrictEqual(crop(3000, 2000), { sx: 0, sy: 500, sw: 3000, sh: 1000 }, 'yatay fotoğraf')
  assert.deepStrictEqual(crop(1080, 1920), { sx: 0, sy: 780, sw: 1080, sh: 360 }, 'dikey fotoğraf')
  assert.deepStrictEqual(crop(1000, 100), { sx: 350, sy: 0, sw: 300, sh: 100 }, 'çok geniş şerit')
  assert.deepStrictEqual(crop(1200, 400), { sx: 0, sy: 0, sw: 1200, sh: 400 }, 'tam oran')
  assert.deepStrictEqual(crop(1, 1), { sx: 0, sy: 0, sw: 1, sh: 1 }, 'tek piksel')
  assert.strictEqual(run('coverCrop(0, 10)'), null)
  assert.strictEqual(run('coverCrop(10, NaN)'), null)
})

test('kapak 1200x400 JPEG olarak kodlanır, sınır aşılırsa kalite 0.85, 0.7 ve 0.55 sırasıyla düşürülür', async () => {
  const { run, sandbox } = load()
  const draws = []
  const sizes = []
  const canvases = []
  sandbox.document.createElement = (tag) => {
    assert.strictEqual(tag, 'canvas')
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({
        fillRect () {},
        drawImage (...args) {
          draws.push(args.slice(1))
        }
      })
    }
    canvases.push(canvas)
    return canvas
  }
  // Kaliteye göre boyutu değişen sahte JPEG
  const bySize = { 0.85: 3000, 0.7: 1800, 0.55: 900 }
  sandbox.canvasToBytes = (canvas, type, quality) => {
    sizes.push([canvas.width, canvas.height, type, quality])
    const out = new Uint8Array(bySize[quality])
    out.set(JPEG_HEAD)
    return Promise.resolve(out)
  }
  sandbox.__image = { naturalWidth: 3000, naturalHeight: 2000 }
  const encode = async (max) => {
    sizes.length = 0
    const res = await run('encodeCover(__image, ' + max + ')')
    return res
  }
  let res = await encode(5000)
  assert.strictEqual(res.quality, 0.85)
  assert.strictEqual(res.mime, 'image/jpeg')
  assert.strictEqual(res.bytes.length, 3000)
  assert.deepStrictEqual(sizes, [[1200, 400, 'image/jpeg', 0.85]])
  assert.deepStrictEqual(draws[0], [0, 500, 3000, 1000, 0, 0, 1200, 400], 'ortadan 3:1 kırpılıp 1200x400 çizilir')
  res = await encode(1000)
  assert.strictEqual(res.quality, 0.55)
  assert.deepStrictEqual(sizes.map((x) => x[3]), [0.85, 0.7, 0.55])
  res = await encode(2000)
  assert.strictEqual(res.quality, 0.7)
  res = await encode(500)
  assert.strictEqual(res.tooBig, true, 'en düşük kalite de sığmazsa')
  assert.deepStrictEqual(sizes.map((x) => x[3]), [0.85, 0.7, 0.55])
  // Tuval bellekte büyük yer tutmasın diye küçültülür
  for (const c of canvases) assert.deepStrictEqual([c.width, c.height], [1, 1])
  // JPEG çıkmayan tarayıcıda kapak kodlanamaz
  sandbox.canvasToBytes = () => Promise.resolve(new Uint8Array([1, 2, 3, 4]))
  assert.strictEqual(await run('encodeCover(__image, 5000)'), null)
  // Sınır sunucunun profil resmi sınırından (şifreleme payı düşülerek) gelir
  assert.strictEqual(run('coverByteLimit()'), 1024 * 1024)
  run('state.info = { limits: { avatarMaxBytes: 2016 } }')
  assert.strictEqual(run('coverByteLimit()'), 2000)
})

