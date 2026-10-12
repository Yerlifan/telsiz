'use strict'

// Konuşma başına taslak ve konuşmaya bağlı ekler (public/js/08-composer.js, istek 17 S1). Modüller
// tarayıcıdaki gibi ortak bir genel ortamda Node vm bağlamında yüklenir. Görünüm, özel konuşma listesi,
// engelleme, sunucu istekleri ve ek çipleri basit taklitlerle verilir. Sınananlar: taslak anahtarları,
// konuşmadan çıkınca metnin ve eklerin kendi taslağında kalması, yüklemesi süren ekin kendi taslağında
// tamamlanması, gönderim süzgeci (yalnızca açık konuşmanın ekleri ve doğru şifreleme), yanıt gelmeden konuşma
// değişince taslağın düşmesi, gönderilemeyen mesajın istemci kimliğinin korunması, silinen konuşmada ve
// engellenen kişide taslağın bırakılması, oturum kapanınca, yazı odası kalmayınca ve frekans değişince
// taslakların silinmesi ve diske yazılmaması. Ayrıca taslakta bekleyen ekin sunucudaki kopyası silinmeden
// yeniden yüklenmesi (ve sunucu ekleri tanımazsa gönderimde yeniden yüklenmesi), yükleme hatasının başka
// konuşmaların eklerine geçmemesi ve yükleme kuyruğunda açık konuşmanın eklerinin öne alınması.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const nodeCrypto = require('node:crypto')

const PUB = path.join(__dirname, '..', 'public')
const FILES = ['i18n.js', 'js/01-core.js', 'js/02-state-dom.js', 'js/04-meta.js', 'js/08-composer.js', 'js/24-frekans.js']
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
    },
    dump: () => Array.from(map.entries())
  }
}

// Odalar: 10 genel, 11 oyun, 12 duyuru (yazı). Özel konuşmalar: 50 Ece (2), 51 Mert (3).
function load () {
  const sandbox = vm.createContext({})
  sandbox.self = sandbox
  sandbox.window = sandbox
  sandbox.setTimeout = setTimeout
  sandbox.clearTimeout = clearTimeout
  sandbox.crypto = nodeCrypto.webcrypto
  sandbox.URL = URL
  sandbox.TextEncoder = TextEncoder
  sandbox.TextDecoder = TextDecoder
  sandbox.btoa = btoa
  sandbox.atob = atob
  sandbox.location = { origin: SELF, hash: '', pathname: '/', search: '', assign: (url) => sandbox.testAssigned.push(url) }
  sandbox.testAssigned = []
  sandbox.localStorage = makeStorage()
  sandbox.sessionStorage = makeStorage()
  sandbox.localStorage.setItem('telsiz.lang', 'tr')
  sandbox.navigator = { languages: ['tr-TR'], language: 'tr-TR', userAgent: 'node' }
  sandbox.document = { documentElement: { lang: 'tr' }, readyState: 'loading', hidden: false, getElementById: () => null }
  sandbox.console = { warn () {}, log () {}, error () {} }
  sandbox.getComputedStyle = () => ({ lineHeight: '20px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px' })
  for (const src of SOURCES) vm.runInContext(src.code, sandbox, { filename: src.file })
  const run = (code) => vm.runInContext(code, sandbox)
  run(`
    state.me = { id: 1, name: 'burak', role: 'owner', status: 'online' }
    state.meta = {
      channels: [
        { id: 10, name: 'genel', type: 'text', position: 0 },
        { id: 11, name: 'oyun', type: 'text', position: 1 },
        { id: 12, name: 'duyuru', type: 'text', position: 2 },
        { id: 20, name: 'Lobi', type: 'voice', position: 3 }
      ],
      users: []
    }
    el.composerInput = { value: '', disabled: false, style: {}, scrollHeight: 20, setAttribute () {}, dispatchEvent () {} }
    el.charCounter = { hidden: true, textContent: '', classList: { toggle () {} } }
    el.btnSend = { disabled: true, title: '' }
    window.E2EE = {
      sealJson (kid, plain) {
        testSealed.push({ dm: false, kid: kid, plain: plain })
        return 'grup-zarfi'
      }
    }
  `)
  run(`
    var testView = 'channel'
    var testDms = [{ id: 50, userId: 2 }, { id: 51, userId: 3 }]
    var testBlocked = []
    var testSealed = []
    var testApi = []
    var testApiNext = null
    var testUploads = []
    var testShown = []
    var testProcessed = []
    var testToasts = []
    var testLeaveHooks = { edit: 0, typing: 0, mention: 0 }
    var dmState = { activeId: null, partnerId: null }
    function conversationMode () { return testView }
    function dmEntry (id) { return testDms.filter((d) => String(d.id) === String(id))[0] || null }
    function isDmChannel (id) { return Boolean(dmEntry(id)) }
    function isBlocked (id) { return testBlocked.indexOf(Number(id)) !== -1 }
    function conversationKeyReady () { return Boolean(state.channelId) }
    function activeKid () { return 'a1b2c3d4e5f60718' }
    function dmSealBody (plain, channelId) {
      testSealed.push({ dm: true, channelId: channelId, plain: plain })
      return 'ozel-zarf'
    }
    function api (method, url, body) {
      testApi.push({ method: method, url: url, body: body })
      if (testApiNext) {
        const next = testApiNext
        testApiNext = null
        return next
      }
      return Promise.resolve({ status: 200, data: { message: { id: testApi.length, channelId: body.channelId } } })
    }
    function request (method, url, opts) {
      const pending = new Promise((resolve) => { testUploads.push({ url: url, resolve: resolve }) })
      pending.abort = function () {}
      return pending
    }
    function toast (msg) { testToasts.push(typeof msg === 'function' ? msg() : String(msg)) }
    function keepBottom () {}
    function insertMessage () {}
    function markRead () {}
    function jumpToLatest () {}
    function processAttachment (att) { testProcessed.push(att.name) }
    function renderAttachments (key) { testShown = composerAttachments(key).map((a) => a.name) }
    function cancelEdit () { testLeaveHooks.edit += 1 }
    function typingStop () { testLeaveHooks.typing += 1 }
    function mentionClose () { testLeaveHooks.mention += 1 }
    function testOpen (view, id) {
      composerLeave()
      testView = view
      state.channelId = id
      dmState.activeId = view === 'dm' ? id : null
      composerEnter()
    }
    function testAdd (name) {
      addFiles([{ name: name, type: 'image/png', size: 10 }], 'photo')
      return state.attachments[state.attachments.length - 1]
    }
    function testDone (att, uploadId) {
      att.status = 'done'
      att.uploadId = uploadId
      att.uploadedAt = Date.now()
      att.key = 'k'
      att.nonce = 'n'
    }
    // Şifrelenip yükleme sırasına giren ek (processAttachment sonrası)
    function testQueued (att) {
      att.status = 'queued'
      att.box = new Uint8Array(4)
      return att
    }
  `)
  return {
    sandbox: sandbox,
    run: run,
    json: (code) => JSON.parse(run('JSON.stringify(' + code + ')'))
  }
}

const U = (c) => c.repeat(32)
const SELF = 'https://kankalar.ornek.com'

test('taslak anahtarı: yazı odası c:, özel konuşma d:, Arkadaşlar görünümünde boş', () => {
  const { run } = load()
  run("testView = 'channel'; state.channelId = 10")
  assert.strictEqual(run('composerKey()'), 'c:10')
  run("testView = 'dm'; state.channelId = 50")
  assert.strictEqual(run('composerKey()'), 'd:50')
  // Görünüm henüz değişmemiş olsa da özel konuşma listedeyse d: kullanılır
  run("testView = 'channel'; state.channelId = 51")
  assert.strictEqual(run('composerKey()'), 'd:51')
  run("testView = 'home'; state.channelId = null")
  assert.strictEqual(run('composerKey()'), '')
  run("testView = 'channel'; state.channelId = null")
  assert.strictEqual(run('composerKey()'), '')
})

test('konuşma değişince metin ve ekler kendi taslağında kalır, yeni konuşmanın yazma alanı boştur', () => {
  const { run, json } = load()
  run("testOpen('channel', 10)")
  run("el.composerInput.value = 'oda taslağı'")
  run("testDone(testAdd('oda.png'), '" + U('a') + "')")
  assert.deepStrictEqual(json('testShown'), ['oda.png'])
  run('testLeaveHooks = { edit: 0, typing: 0, mention: 0 }')
  run("testOpen('dm', 50)")
  assert.strictEqual(run('el.composerInput.value'), '')
  assert.deepStrictEqual(json('testShown'), [])
  assert.strictEqual(run('canSend()'), false)
  assert.strictEqual(run('el.btnSend.disabled'), true)
  // Çıkarken düzenleme kipi, @ öneri listesi ve yazıyor bildirimi biter
  assert.deepStrictEqual(json('testLeaveHooks'), { edit: 1, typing: 1, mention: 1 })

  run("el.composerInput.value = 'OZEL: yalnızca Ece görmeli'")
  run("testDone(testAdd('ozel.png'), '" + U('b') + "')")
  assert.deepStrictEqual(json('testShown'), ['ozel.png'])
  assert.strictEqual(run('canSend()'), true)

  run("testOpen('channel', 11)")
  assert.strictEqual(run('el.composerInput.value'), '')
  assert.deepStrictEqual(json('testShown'), [])
  assert.strictEqual(run('canSend()'), false)

  run("testOpen('channel', 10)")
  assert.strictEqual(run('el.composerInput.value'), 'oda taslağı')
  assert.deepStrictEqual(json('testShown'), ['oda.png'])
  assert.strictEqual(run('canSend()'), true)

  run("testOpen('dm', 50)")
  assert.strictEqual(run('el.composerInput.value'), 'OZEL: yalnızca Ece görmeli')
  assert.deepStrictEqual(json('testShown'), ['ozel.png'])

  // Arkadaşlar görünümünde yazma alanı boştur, dönünce taslak yerindedir
  run("testOpen('home', null)")
  assert.strictEqual(run('el.composerInput.value'), '')
  assert.deepStrictEqual(json('testShown'), [])
  run("testOpen('dm', 50)")
  assert.strictEqual(run('el.composerInput.value'), 'OZEL: yalnızca Ece görmeli')
  // Ekler eklendikleri konuşmanın anahtarını taşır
  assert.deepStrictEqual(json("state.attachments.map((a) => a.name + '@' + a.convKey)"), ['oda.png@c:10', 'ozel.png@d:50'])
})

test('ek sınırı açık konuşmanın eklerine uygulanır', () => {
  const { run } = load()
  run('state.limits.maxUploadsPerMessage = 2')
  run("testOpen('dm', 50)")
  run("testAdd('a.png'); testAdd('b.png'); testAdd('c.png')")
  assert.strictEqual(run('composerAttachments().length'), 2)
  run("testOpen('channel', 10)")
  run("testAdd('d.png'); testAdd('e.png')")
  assert.strictEqual(run('composerAttachments().length'), 2)
  assert.strictEqual(run('state.attachments.length'), 4)
})

test('gönderim yalnızca açık konuşmanın eklerini gönderir, özel konuşmanın eki grup anahtarıyla mühürlenmez', async () => {
  const { run, json } = load()
  run("testOpen('dm', 50)")
  run("el.composerInput.value = 'özel metin'")
  run("testDone(testAdd('ozel-1.png'), '" + U('b') + "')")
  run("testAdd('ozel-2.png').status = 'uploading'")
  run("testOpen('channel', 10)")
  run("el.composerInput.value = 'oda metni'")
  run("testDone(testAdd('oda.png'), '" + U('a') + "')")
  // Başka konuşmada süren yükleme açık konuşmanın gönderimini bekletmez
  assert.strictEqual(run('pendingUploads()'), 0)
  assert.strictEqual(run('canSend()'), true)
  await run('sendMessage()')
  const sent = json('testApi[testApi.length - 1].body')
  assert.strictEqual(sent.channelId, 10)
  assert.deepStrictEqual(sent.uploads, [U('a')])
  const seal = json('testSealed[testSealed.length - 1]')
  assert.strictEqual(seal.dm, false)
  assert.deepStrictEqual(seal.plain.f.map((f) => f.u), [U('a')])
  assert.strictEqual(seal.plain.t, 'oda metni')
  assert.strictEqual(run('el.composerInput.value'), '')
  // Özel konuşmanın ekleri yerinde durur
  assert.deepStrictEqual(json("state.attachments.map((a) => a.name + '@' + a.convKey)"), ['ozel-1.png@d:50', 'ozel-2.png@d:50'])

  run("testOpen('dm', 50)")
  assert.strictEqual(run('el.composerInput.value'), 'özel metin')
  assert.strictEqual(run('pendingUploads()'), 1)
  assert.strictEqual(run('canSend()'), false)
  const calls = run('testApi.length')
  await run('sendMessage()')
  assert.strictEqual(run('testApi.length'), calls, 'yüklemesi süren ekle gönderilmez')
  run("testDone(state.attachments[1], '" + U('c') + "')")
  await run('sendMessage()')
  const dmSent = json('testApi[testApi.length - 1].body')
  assert.strictEqual(dmSent.channelId, 50)
  assert.deepStrictEqual(dmSent.uploads, [U('b'), U('c')])
  const dmSeal = json('testSealed[testSealed.length - 1]')
  assert.strictEqual(dmSeal.dm, true)
  assert.strictEqual(dmSeal.plain.t, 'özel metin')
  assert.strictEqual(run('state.attachments.length'), 0)
})

test('yüklemesi süren ek konuşmadan çıkılınca kendi taslağında tamamlanır', async () => {
  const { run, json } = load()
  run("testOpen('dm', 50)")
  run("const testAtt = testAdd('ozel.png'); testAtt.status = 'queued'; testAtt.box = new Uint8Array(4)")
  run("testOpen('channel', 10)")
  run('pumpUploads()')
  assert.strictEqual(run('testUploads.length'), 1, 'başka konuşmanın eki de yüklenir')
  assert.strictEqual(run('state.attachments[0].status'), 'uploading')
  run("testUploads[0].resolve({ status: 200, data: { id: '" + U('d') + "' } })")
  await new Promise((resolve) => setImmediate(resolve))
  assert.strictEqual(run('state.attachments[0].status'), 'done')
  assert.strictEqual(run('state.attachments[0].uploadId'), U('d'))
  // Açık konuşmanın yazma alanı etkilenmez
  assert.deepStrictEqual(json('testShown'), [])
  assert.strictEqual(run('canSend()'), false)
  run("testOpen('dm', 50)")
  assert.deepStrictEqual(json('testShown'), ['ozel.png'])
  assert.strictEqual(run('canSend()'), true)
})

test('yanıt gelmeden konuşma değişirse açık yazma alanına dokunulmaz, gönderilen metin kendi taslağından düşer', async () => {
  const { run } = load()
  run("testOpen('dm', 50)")
  run("el.composerInput.value = 'özel taslak'")
  run("testOpen('channel', 10)")
  run("el.composerInput.value = 'gidecek mesaj'")
  run('var testResolve = null; testApiNext = new Promise((resolve) => { testResolve = resolve })')
  const sending = run('sendMessage()')
  run("testOpen('dm', 50)")
  assert.strictEqual(run('el.composerInput.value'), 'özel taslak')
  run('testResolve({ status: 200, data: { message: { id: 9, channelId: 10 } } })')
  await sending
  assert.strictEqual(run('el.composerInput.value'), 'özel taslak')
  assert.strictEqual(run('state.sending'), false)
  run("testOpen('channel', 10)")
  assert.strictEqual(run('el.composerInput.value'), '')
  assert.strictEqual(run('state.unsentMessage'), null)
})

test('gönderilemeyen mesajın istemci kimliği konuşmanın taslağıyla korunur', async () => {
  const { run } = load()
  run("testOpen('channel', 10)")
  run("el.composerInput.value = 'yeniden denenecek'")
  run("testApiNext = Promise.resolve({ status: 500, data: { code: 'internal' } })")
  await run('sendMessage()')
  const first = run('state.unsentMessage.id')
  assert.match(first, /^[0-9a-f]{32}$/)
  run("testOpen('dm', 50)")
  assert.strictEqual(run('state.unsentMessage'), null)
  run("testOpen('channel', 10)")
  assert.strictEqual(run('el.composerInput.value'), 'yeniden denenecek')
  await run('sendMessage()')
  assert.strictEqual(run('testApi[testApi.length - 1].body.clientMessageId'), first)
})

test('engellenen kişinin ve silinen konuşmanın taslağı ile ekleri bırakılır, açık konuşmaya dokunulmaz', () => {
  const { run, json } = load()
  run("testOpen('dm', 51)")
  run("el.composerInput.value = 'Mert için taslak'")
  run("testAdd('mert.png')")
  run("testOpen('channel', 11)")
  run("el.composerInput.value = 'oyun taslağı'")
  run("testAdd('oyun.png')")
  run("testOpen('channel', 10)")
  run("el.composerInput.value = 'açık konuşma'")
  run("testAdd('genel.png')")

  run('testBlocked = [3]; composerPruneDrafts()')
  assert.deepStrictEqual(json('Array.from(composerDrafts.keys())'), ['c:11'])
  assert.deepStrictEqual(json("state.attachments.map((a) => a.convKey)"), ['c:11', 'c:10'])

  run('state.meta.channels = state.meta.channels.filter((c) => c.id !== 11); composerPruneDrafts()')
  assert.deepStrictEqual(json('Array.from(composerDrafts.keys())'), [])
  assert.deepStrictEqual(json("state.attachments.map((a) => a.convKey)"), ['c:10'])
  assert.strictEqual(run('el.composerInput.value'), 'açık konuşma')

  // Engellenen kişiyle açık konuşmadan çıkılınca taslak kaydedilmez
  run('testBlocked = []')
  run("testOpen('dm', 51)")
  run("el.composerInput.value = 'gönderilemeyecek'")
  run("testAdd('engel.png')")
  run('testBlocked = [3]')
  run("testOpen('channel', 10)")
  assert.strictEqual(run("composerDrafts.has('d:51')"), false)
  assert.strictEqual(run("state.attachments.some((a) => a.convKey === 'd:51')"), false)
  assert.strictEqual(run('el.composerInput.value'), 'açık konuşma')

  // Silinen odadan çıkılırken metin ve ekler başka konuşmaya taşınmaz
  run("testOpen('channel', 12)")
  run("el.composerInput.value = 'silinecek oda'")
  run("testAdd('duyuru.png')")
  run('state.meta.channels = state.meta.channels.filter((c) => c.id !== 12)')
  run("testOpen('channel', 10)")
  assert.strictEqual(run("composerDrafts.has('c:12')"), false)
  assert.deepStrictEqual(json("state.attachments.map((a) => a.convKey)"), ['c:10'])
  assert.strictEqual(run('el.composerInput.value'), 'açık konuşma')
})

test('taslaklar silinince yalnızca açık konuşma kalır, taslaklar diske yazılmaz', () => {
  const { run, json, sandbox } = load()
  run("testOpen('dm', 50)")
  run("el.composerInput.value = 'GIZLI-TASLAK-1'")
  run("testAdd('a.png')")
  run("testOpen('channel', 11)")
  run("el.composerInput.value = 'GIZLI-TASLAK-2'")
  run("testOpen('channel', 10)")
  run("el.composerInput.value = 'GIZLI-TASLAK-3'")
  run("testAdd('b.png')")
  const stored = sandbox.localStorage.dump().concat(sandbox.sessionStorage.dump())
  assert.ok(!stored.some((pair) => /GIZLI-TASLAK/.test(pair.join(' '))), 'taslak tarayıcı deposuna yazılmaz')
  run('composerDraftsClear()')
  assert.strictEqual(run('composerDrafts.size'), 0)
  assert.deepStrictEqual(json("state.attachments.map((a) => a.name + '@' + a.convKey)"), ['b.png@c:10'])
  assert.strictEqual(run('el.composerInput.value'), 'GIZLI-TASLAK-3')
  run("testOpen('dm', 50)")
  assert.strictEqual(run('el.composerInput.value'), '')
  assert.deepStrictEqual(json('testShown'), [])
})

// Sunucu mesaja bağlanmayan yüklemeyi bir saat sonra siler (orphanUploadTtlMs). İstemci 45 dakikayı aşan eki
// yeniden yükler.
const STALE = '(Date.now() - 46 * 60 * 1000)'

test('taslakta uzun süre bekleyen yüklenmiş ek konuşmaya dönülünce yeniden yüklenir, yeni ek dokunulmadan kalır', () => {
  const { run, json } = load()
  run("testOpen('dm', 50)")
  run("el.composerInput.value = 'özel taslak'")
  run("testDone(testAdd('eski.png'), '" + U('a') + "')")
  run('state.attachments[0].uploadedAt = ' + STALE)
  run("testDone(testAdd('yeni.png'), '" + U('b') + "')")
  // addFiles her eki bir kez hazırlar, sayım bundan sonra başlar
  run('testProcessed = []')
  run("testOpen('channel', 10)")
  // Başka konuşmaya girmek özel konuşmanın eklerine dokunmaz
  assert.deepStrictEqual(json('testProcessed'), [])
  run("testOpen('dm', 50)")
  assert.deepStrictEqual(json('testProcessed'), ['eski.png'])
  assert.deepStrictEqual(json("state.attachments.map((a) => a.name + '=' + a.status + ':' + a.uploadId)"),
    ['eski.png=processing:', 'yeni.png=done:' + U('b')])
  assert.strictEqual(run('state.attachments[0].uploadedAt'), 0)
  assert.strictEqual(run('el.composerInput.value'), 'özel taslak')
  assert.strictEqual(run('canSend()'), false)
  // Yeniden yükleme bitince gönderilir, yeni kimlikle
  run("testDone(state.attachments[0], '" + U('c') + "')")
  assert.strictEqual(run('canSend()'), true)
})

test('gönderirken süresi dolmak üzere olan ek gönderilmez, yeniden yüklenir, metin yerinde kalır', async () => {
  const { run, json } = load()
  run("testOpen('channel', 10)")
  run("el.composerInput.value = 'oda metni'")
  run("testDone(testAdd('oda.png'), '" + U('a') + "')")
  run('state.attachments[0].uploadedAt = ' + STALE)
  run('testProcessed = []')
  assert.strictEqual(run('canSend()'), true)
  await run('sendMessage()')
  assert.strictEqual(run('testApi.length'), 0, 'mesaj gönderilmedi')
  assert.deepStrictEqual(json('testProcessed'), ['oda.png'])
  assert.strictEqual(run('state.attachments[0].status'), 'processing')
  assert.strictEqual(run('el.composerInput.value'), 'oda metni')
  assert.deepStrictEqual(json('testToasts'), [run("t('composer.waitUploads')")])
  run("testDone(state.attachments[0], '" + U('b') + "')")
  await run('sendMessage()')
  assert.deepStrictEqual(json('testApi[0].body.uploads'), [U('b')])
  assert.strictEqual(run('state.attachments.length'), 0)
})

test('sunucu ekleri tanımazsa (bad_uploads) ekler yeniden yüklenir, metin kalır, yeniden gönderim yeni kimlikle gider', async () => {
  const { run, json } = load()
  run("testOpen('dm', 50)")
  run("el.composerInput.value = 'özel metin'")
  run("testDone(testAdd('ozel.png'), '" + U('a') + "')")
  run('testProcessed = []')
  run("testApiNext = Promise.resolve({ status: 400, data: { code: 'bad_uploads' } })")
  await run('sendMessage()')
  assert.deepStrictEqual(json('testApi[0].body.uploads'), [U('a')])
  assert.deepStrictEqual(json('testProcessed'), ['ozel.png'])
  assert.deepStrictEqual(json("state.attachments.map((a) => a.status + ':' + a.uploadId)"), ['processing:'])
  assert.strictEqual(run('el.composerInput.value'), 'özel metin')
  assert.strictEqual(run('state.sending'), false)
  assert.strictEqual(run('canSend()'), false)
  assert.deepStrictEqual(json('testToasts'), [run("t('composer.waitUploads')")])
  run("testDone(state.attachments[0], '" + U('b') + "')")
  await run('sendMessage()')
  const again = json('testApi[1].body')
  assert.deepStrictEqual([again.channelId, again.uploads], [50, [U('b')]])
  assert.strictEqual(run('state.attachments.length'), 0)
  assert.strictEqual(run('el.composerInput.value'), '')
})

test('yanıtı alınamayan gönderimin ekleri süre dolsa da aynı kimlikle yeniden gönderilir, mesaj iki kez gitmez', async () => {
  const { run, json } = load()
  run("testOpen('dm', 50)")
  run("el.composerInput.value = 'özel metin'")
  run("testDone(testAdd('ozel.png'), '" + U('a') + "')")
  run('testProcessed = []')
  // İstek sunucuya ulaştı ama yanıt alınamadı: mesaj ekleri bağlamış olabilir
  run('testApiNext = Promise.resolve({ status: 0, data: null })')
  await run('sendMessage()')
  const first = run('testApi[0].body.clientMessageId')
  run('state.attachments[0].uploadedAt = ' + STALE)
  // Konuşmadan çıkıp dönünce ve gönderirken ek yeniden yüklenmez, istek aynı ek ve istemci kimliğiyle gider
  run("testOpen('channel', 10)")
  run("testOpen('dm', 50)")
  assert.deepStrictEqual(json('testProcessed'), [])
  assert.strictEqual(run('canSend()'), true)
  run("testApiNext = Promise.resolve({ status: 400, data: { code: 'bad_uploads' } })")
  await run('sendMessage()')
  const again = json('testApi[1].body')
  assert.deepStrictEqual([again.clientMessageId, again.uploads], [first, [U('a')]])
  // Mesaj ulaşmamış ve ek silinmiş (bad_uploads): ek ancak şimdi yeniden yüklenir
  assert.deepStrictEqual(json("state.attachments.map((a) => a.status + ':' + a.uploadId)"), ['processing:'])
  assert.deepStrictEqual(json('testProcessed'), ['ozel.png'])
  run("testDone(state.attachments[0], '" + U('b') + "')")
  await run('sendMessage()')
  const last = json('testApi[2].body')
  assert.deepStrictEqual(last.uploads, [U('b')])
  assert.notStrictEqual(last.clientMessageId, first)
  assert.strictEqual(run('state.attachments.length'), 0)
})

test('yükleme hatası aynı konuşmanın sıradaki eklerine geçer, başka konuşmanın eki kendi sırasında denenir', async () => {
  const { run, json } = load()
  run('state.uploadHeld = true')
  run("testOpen('dm', 50)")
  run("testQueued(testAdd('ozel-1.png')).refusedSends = UPLOAD_RESERVED_SENDS_MAX - 1")
  run('pumpUploads()')
  run("testQueued(testAdd('ozel-2.png'))")
  run("testOpen('channel', 10)")
  run("testQueued(testAdd('oda.png'))")
  run('pumpUploads()')
  assert.strictEqual(run('testUploads.length'), 1, 'tek yükleme kuralında ikinci istek gitmez')
  // Yer açılmadı ve özel konuşmanın ekinin hakkı bitti
  run("testUploads[0].resolve({ status: 503, data: { code: 'busy_reserved' } })")
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepStrictEqual(json("state.attachments.map((a) => a.name + '@' + a.convKey + '=' + a.status)"),
    ['ozel-1.png@d:50=error', 'ozel-2.png@d:50=error', 'oda.png@c:10=uploading'])
  assert.strictEqual(run('testUploads.length'), 2, 'odanın eki kendisi denendi')
  run("testUploads[1].resolve({ status: 200, data: { id: '" + U('e') + "' } })")
  await new Promise((resolve) => setImmediate(resolve))
  run("el.composerInput.value = 'oda metni'")
  assert.strictEqual(run('canSend()'), true)
})

test('yükleme sırasında açık konuşmanın ekleri öne alınır, süren yükleme kesilmez', async () => {
  const { run, json } = load()
  run("testOpen('dm', 50)")
  run("testQueued(testAdd('b1.png')); testQueued(testAdd('b2.png')); testQueued(testAdd('b3.png'))")
  run("testOpen('channel', 10)")
  run("el.composerInput.value = 'oda metni'")
  run("testQueued(testAdd('oda.png'))")
  run('pumpUploads()')
  const statuses = () => json("state.attachments.map((a) => a.name + '=' + a.status)")
  assert.deepStrictEqual(statuses(), ['b1.png=uploading', 'b2.png=queued', 'b3.png=queued', 'oda.png=uploading'])
  assert.deepStrictEqual(json('testUploads.map((u) => u.url)').length, 2)
  run("testUploads[0].resolve({ status: 200, data: { id: '" + U('a') + "' } })")
  await new Promise((resolve) => setImmediate(resolve))
  assert.strictEqual(run('state.attachments[3].status'), 'done', 'ilk istek odanın ekiydi')
  assert.strictEqual(run('pendingUploads()'), 0)
  assert.strictEqual(run('canSend()'), true)
  // Sıra kalan özel konuşma eklerine geçer
  assert.deepStrictEqual(statuses(), ['b1.png=uploading', 'b2.png=uploading', 'b3.png=queued', 'oda.png=done'])
})

test('yazı odası kalmayınca (applyMeta) açık odanın taslağı ve ekleri bırakılır, yazma alanı boşalır', () => {
  const { run, json } = load()
  run(`
    state.inApp = true
    function voiceHandleMeta () {}
    function myPermsKey () { return '' }
    function renderServerName () {}
    function renderBand () {}
    function renderMembers () {}
    function renderUserPanel () {}
    function renderVoiceAll () {}
    function renderChannelHeader () {}
    function refreshConversationChrome () {}
    function refreshSettings () {}
    function renderComposerState () {}
    function refreshAllMessages () {}
    function refreshMentionMessages () {}
  `)
  run("testOpen('dm', 50)")
  run("el.composerInput.value = 'özel taslak'")
  run("testAdd('ozel.png')")
  run("testOpen('channel', 10)")
  run("el.composerInput.value = 'silinecek oda'")
  run("testAdd('genel.png')")
  run("applyMeta({ channels: [{ id: 20, name: 'Lobi', type: 'voice', position: 0 }], users: [] }, false)")
  assert.strictEqual(run('state.channelId'), null)
  assert.strictEqual(run('composerKey()'), '')
  assert.strictEqual(run('el.composerInput.value'), '')
  assert.deepStrictEqual(json('testShown'), [])
  assert.strictEqual(run("composerDrafts.has('c:10')"), false)
  // Özel konuşmanın taslağı ve eki yerinde durur
  assert.deepStrictEqual(json("state.attachments.map((a) => a.name + '@' + a.convKey)"), ['ozel.png@d:50'])
  assert.strictEqual(run("composerDrafts.get('d:50').text"), 'özel taslak')
})

test('frekans değişince taslaklar silinir: tarayıcıda sayfadan çıkmadan önce, masaüstünde geçiş başarılı olunca', async () => {
  const { run, json, sandbox } = load()
  const fill = () => {
    run("testOpen('dm', 50)")
    run("el.composerInput.value = 'özel taslak'")
    run("testAdd('ozel.png')")
    run("testOpen('channel', 10)")
    run("el.composerInput.value = 'açık oda'")
  }
  fill()
  // Açık frekansa geçiş bir şey yapmaz
  run("frekansSwitch('" + SELF + "')")
  assert.strictEqual(run('composerDrafts.size'), 1)
  run("frekansSwitch('https://diger.ornek.com')")
  assert.strictEqual(sandbox.testAssigned.length, 1)
  assert.match(sandbox.testAssigned[0], /^https:\/\/diger\.ornek\.com\/#frekanslar=/)
  assert.strictEqual(run('composerDrafts.size'), 0)
  assert.deepStrictEqual(json('state.attachments'), [])
  assert.strictEqual(run('el.composerInput.value'), 'açık oda')

  // Masaüstü: başarısız geçişte taslaklar kalır
  run('var testSwitch = { ok: false }')
  run('window.telsizDesktop = { listFrequencies () { return [] }, switchFrequency () { return Promise.resolve(testSwitch) } }')
  fill()
  run("frekansSwitch('https://diger.ornek.com')")
  await new Promise((resolve) => setImmediate(resolve))
  assert.strictEqual(run('composerDrafts.size'), 1)
  assert.deepStrictEqual(json('testToasts'), [run("t('frekans.failed')")])
  run('testSwitch = { ok: true }')
  run("frekansSwitch('https://diger.ornek.com')")
  await new Promise((resolve) => setImmediate(resolve))
  assert.strictEqual(run('composerDrafts.size'), 0)
  assert.deepStrictEqual(json('state.attachments'), [])
  assert.strictEqual(sandbox.testAssigned.length, 1, 'masaüstünde sayfa adresi değişmez')
})
