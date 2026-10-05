'use strict'

// İstemcinin yükleme kuyruğu (public/js/08-composer.js): sunucu dolu olduğunda 503 busy, hesap ve adres başına yer
// sınırı veya son boş yerin ayrılması yüzünden yer vermediğinde 503 busy_reserved döner. Kendi diğer yüklemesi
// sürerken veya yer beklerken alınan bu yanıtlarda dosya sıraya döner ve istek göndermez. Tek başına alınan
// busy_reserved yanıtında bekleme iki katına çıkarak sürer, toplam bekleme iki dakikayla sınırlıdır. Tek başına
// alınan busy yanıtında eski üç deneme sınırı geçerlidir. Bekleyen dosyalar sunucunun varsayılan yükleme sınırına
// (dakikada 10) takılmaz. Modüller tarayıcıdaki gibi ortak bir genel ortamda Node vm bağlamında yüklenir, ağ ve
// bekleme taklit edilir.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const PUB = path.join(__dirname, '..', 'public')
const FILES = ['i18n.js', 'js/01-core.js', 'js/02-state-dom.js', 'js/08-composer.js']
const SOURCES = FILES.map((file) => ({ file, code: fs.readFileSync(path.join(PUB, file), 'utf8') }))
const auth = require('../src/auth.js')

const BUSY = { status: 503, data: { error: 'busy', code: 'busy' } }
const RESERVED = { status: 503, data: { error: 'busy_reserved', code: 'busy_reserved' } }

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

function load () {
  const sandbox = vm.createContext({})
  sandbox.self = sandbox
  sandbox.window = sandbox
  sandbox.setTimeout = setTimeout
  sandbox.clearTimeout = clearTimeout
  sandbox.localStorage = makeStorage()
  sandbox.sessionStorage = makeStorage()
  sandbox.navigator = { languages: ['tr-TR'], language: 'tr-TR', userAgent: 'node' }
  sandbox.document = { documentElement: { lang: 'tr' }, readyState: 'loading', hidden: false, title: 'Telsiz', addEventListener () {} }
  sandbox.location = { origin: 'https://kankalar.ornek.com', hash: '', pathname: '/', search: '' }
  sandbox.console = { warn () {}, log () {}, error () {} }
  for (const src of SOURCES) vm.runInContext(src.code, sandbox, { filename: src.file })
  const run = (code) => vm.runInContext(code, sandbox)
  const calls = []
  const waits = []
  sandbox.__request = (method, url, options) => {
    const call = {}
    call.promise = new Promise((resolve) => {
      call.resolve = resolve
    })
    call.box = options.binary
    calls.push(call)
    return call.promise
  }
  sandbox.__wait = (ms) => {
    waits.push(ms)
    return Promise.resolve()
  }
  run(`request = function (method, url, options) { return __request(method, url, options) }
    wait = function (ms) { return __wait(ms) }
    renderAttachments = function () {}
    updateChipProgress = function () {}
    updateSendState = function () {}
    checkAuthFailure = function () {}`)
  return { sandbox, run, calls, waits }
}

function okId (n) {
  return { status: 200, data: { id: String(n).repeat(32), size: 10 } }
}

// Bekleyen söz zincirlerinin ilerlemesi için olay döngüsüne birkaç tur verir
async function settle (rounds = 20) {
  if (rounds === 0) return
  await new Promise((resolve) => setImmediate(resolve))
  return settle(rounds - 1)
}

// Bir dosyaya ait sıradaki isteği bekler ve yanıtlar
async function answer (env, box, res) {
  await settle()
  const call = env.calls.find((c) => c.box === box && !c.done)
  assert.ok(call, 'beklenen yükleme isteği gönderilmedi')
  call.done = true
  call.resolve(res)
  await settle()
}

// Sanal saatle çalışan ortam: bekleme sanal saati ilerletir, yükleme isteğini sunucu gibi gerçek RateLimiter
// (varsayılan uploadLimit 10, uploadWindowMs 60000) süzer, sınırı geçen istek yerine verilen yanıt döner.
function virtualServer (env, reply) {
  const clock = { now: 0 }
  const timers = []
  const limiter = new auth.RateLimiter(10, 60000)
  const log = []
  env.sandbox.__wait = (ms) => new Promise((resolve) => {
    timers.push({ at: clock.now + ms, resolve })
  })
  env.sandbox.__request = (method, url, options) => {
    const wait = limiter.consume('u1', clock.now)
    const out = wait > 0 ? { status: 429, data: { error: 'rate_limited', code: 'rate_limited' } } : reply(options.binary, clock.now)
    // Süren yükleme: { after, res, done } yanıtı after ms sonra gelir, done yükleme bitince çağrılır
    const res = out.after ? out.res : out
    log.push({ box: options.binary, at: clock.now, status: res.status })
    if (!out.after) return Promise.resolve(res)
    return new Promise((resolve) => {
      timers.push({
        at: clock.now + out.after,
        resolve: () => {
          if (out.done) out.done()
          resolve(res)
        }
      })
    })
  }
  // Bekleyen ilk zamanlayıcıya kadar saati ilerletir, yüklemeler bitince durur
  async function runAll () {
    await settle()
    if (env.run('state.activeUploads') === 0 && timers.length === 0) return
    assert.ok(timers.length > 0, 'yükleme ne istek ne bekleme durumunda')
    assert.ok(clock.now < 3600000, 'yüklemeler bitmedi')
    timers.sort((a, b) => a.at - b.at)
    const next = timers.shift()
    clock.now = next.at
    next.resolve()
    return runAll()
  }
  return { clock, log, runAll }
}

// Her 60 sn'lik pencerede en çok kaç istek gönderildiği
function maxPerMinute (log) {
  return Math.max(0, ...log.map((x) => log.filter((y) => y.at >= x.at && y.at < x.at + 60000).length))
}

test('kendi diğer yüklemesi sürerken alınan 503 busy ile dosya sıraya döner, o yükleme bitince gönderilir', async () => {
  for (const refusal of [BUSY, RESERVED]) {
    const env = load()
    const a = { status: 'queued', box: 'birinci' }
    const b = { status: 'queued', box: 'ikinci' }
    env.sandbox.__atts = [a, b]
    env.run('state.attachments = __atts')
    env.run('pumpUploads()')
    await answer(env, 'ikinci', refusal)
    assert.equal(b.status, 'queued')
    // Birinci dosya sürerken ikinci dosya sunucuya yeniden sormaz ve beklemez
    await settle()
    assert.equal(env.calls.filter((c) => c.box === 'ikinci').length, 1)
    assert.deepEqual(env.waits, [])
    assert.equal(env.run('state.activeUploads'), 1)
    await answer(env, 'birinci', okId(1))
    assert.equal(a.status, 'done')
    await answer(env, 'ikinci', okId(2))
    assert.equal(b.status, 'done')
    assert.equal(env.run('state.activeUploads'), 0)
    assert.equal(env.run('state.uploadHeld'), false)
  }
})

test('tek başına alınan 503 busy en çok üç kez 2 sn arayla yeniden denenir', async () => {
  const env = load()
  const a = { status: 'queued', box: 'tek' }
  env.sandbox.__atts = [a]
  env.run('state.attachments = __atts')
  env.run('pumpUploads()')
  for (const res of Array(4).fill(BUSY)) await answer(env, 'tek', res)
  assert.equal(a.status, 'error')
  assert.deepEqual(env.waits, [2000, 2000, 2000])
  assert.equal(env.run('state.activeUploads'), 0)
})

test('tek başına alınan busy_reserved beklenir: 2, 4, 8, 16 sn diye artar, toplam bekleme iki dakikayı aşmaz', async () => {
  const env = load()
  const a = { status: 'queued', box: 'tek' }
  env.sandbox.__atts = [a]
  env.run('state.attachments = __atts')
  env.run('pumpUploads()')
  for (const res of Array(10).fill(RESERVED)) await answer(env, 'tek', res)
  assert.equal(a.status, 'error')
  assert.deepEqual(env.waits, [2000, 4000, 8000, 16000, 16000, 16000, 16000, 16000, 16000])
  assert.ok(env.waits.reduce((x, y) => x + y, 0) <= env.run('UPLOAD_WAIT_MAX_MS'))
  assert.equal(env.run('UPLOAD_WAIT_MAX_MS'), 120000)
  assert.equal(env.calls.length, 10)
  assert.equal(env.run('textOf(__atts[0].error)'), env.run("t('errors.busy_reserved')"))
  assert.equal(env.run('state.activeUploads'), 0)
})

test('tek başına bekleyen dosya, aynı ağdaki yükleme bitip yer açılınca yüklenir', async () => {
  const env = load()
  const a = { status: 'queued', box: 'tek' }
  env.sandbox.__atts = [a]
  env.run('state.attachments = __atts')
  env.run('pumpUploads()')
  for (const res of Array(5).fill(RESERVED)) await answer(env, 'tek', res)
  assert.equal(a.status, 'uploading')
  await answer(env, 'tek', okId(1))
  assert.equal(a.status, 'done')
  assert.deepEqual(env.waits, [2000, 4000, 8000, 16000, 16000])
})

test('iki dosya da beklerken istekler varsayılan yükleme sınırını aşmaz, bekleme 429 ile bitmez', async () => {
  for (const refusal of [BUSY, RESERVED]) {
    const env = load()
    const server = virtualServer(env, () => refusal)
    const a = { status: 'queued', box: 'birinci' }
    const b = { status: 'queued', box: 'ikinci' }
    env.sandbox.__atts = [a, b]
    env.run('state.attachments = __atts')
    env.run('pumpUploads()')
    await server.runAll()
    const statuses = server.log.map((x) => x.status)
    assert.ok(!statuses.includes(429), refusal.data.code + ': ' + JSON.stringify(server.log))
    assert.ok(maxPerMinute(server.log) <= 10)
    assert.equal(a.status, 'error')
    assert.equal(b.status, 'error')
    assert.equal(env.run('textOf(__atts[0].error)'), env.run("t('errors." + refusal.data.code + "')"))
    assert.equal(env.run('textOf(__atts[1].error)'), env.run("t('errors." + refusal.data.code + "')"))
    // Toplam bekleme sınırlıdır: iki dosya için de en çok yaklaşık iki dakika
    assert.ok(server.clock.now <= 120000, String(server.clock.now))
    assert.equal(env.run('state.activeUploads'), 0)
    assert.equal(env.run('state.uploadHeld'), false)
  }
})

test('iki dosya beklerken yer açılınca ikisi de yüklenir ve istekler yükleme sınırının altında kalır', async () => {
  const env = load()
  let n = 0
  // Aynı ağdaki yükleme 40 sn sonra biter, sunucu ondan sonra yer verir
  const server = virtualServer(env, (box, now) => (now < 40000 ? RESERVED : okId(++n)))
  const a = { status: 'queued', box: 'birinci' }
  const b = { status: 'queued', box: 'ikinci' }
  env.sandbox.__atts = [a, b]
  env.run('state.attachments = __atts')
  env.run('pumpUploads()')
  await server.runAll()
  assert.equal(a.status, 'done')
  assert.equal(b.status, 'done')
  assert.ok(maxPerMinute(server.log) <= 10, JSON.stringify(server.log))
  assert.ok(!server.log.some((x) => x.status === 429))
})

test('büyük dosya busy_reserved beklerken en çok üç kez uzun aralarla yeniden gönderilir, boşa giden bayt sınırlıdır', async () => {
  const env = load()
  const big = new Uint8Array(3 * 1024 * 1024)
  const a = { status: 'queued', box: big }
  env.sandbox.__atts = [a]
  env.run('state.attachments = __atts')
  env.run('pumpUploads()')
  for (const res of Array(4).fill(RESERVED)) await answer(env, big, res)
  assert.equal(a.status, 'error')
  assert.deepEqual(env.waits, [8000, 30000, 60000])
  const sent = env.calls.filter((c) => c.box === big).length * big.byteLength
  assert.equal(env.calls.length, 4)
  assert.equal(sent, (env.run('UPLOAD_LARGE_WAITS_MS.length') + 1) * big.byteLength)
  assert.equal(env.run('state.activeUploads'), 0)
})

test('küçük dosyanın iki dakikalık beklemesinde boşa giden bayt sınırı aşılmaz', async () => {
  const env = load()
  const small = new Uint8Array(512 * 1024)
  const a = { status: 'queued', box: small }
  env.sandbox.__atts = [a]
  env.run('state.attachments = __atts')
  env.run('pumpUploads()')
  for (const res of Array(10).fill(RESERVED)) await answer(env, small, res)
  assert.equal(a.status, 'error')
  assert.equal(env.calls.length, 10)
  assert.ok(env.calls.length * small.byteLength <= env.run('UPLOAD_WASTE_MAX_BYTES'))
})

test('küçük ve büyük dosyanın sınırı UPLOAD_WASTE_MAX_BYTES / UPLOAD_RESERVED_SENDS_MAX baytında ayrılır', async () => {
  const limit = Math.floor(8 * 1024 * 1024 / 10)
  for (const [size, sends] of [[limit, 10], [limit + 1, 4]]) {
    const env = load()
    const box = new Uint8Array(size)
    const a = { status: 'queued', box }
    env.sandbox.__atts = [a]
    env.run('state.attachments = __atts')
    env.run('pumpUploads()')
    for (const res of Array(sends).fill(RESERVED)) await answer(env, box, res)
    await settle()
    assert.equal(a.status, 'error', String(size))
    assert.equal(env.calls.length, sends, String(size))
  }
})

test('busy ve busy_reserved retleri ortak bütçeden sayılır: küçük dosya en çok on kez reddedilir', async () => {
  const env = load()
  const small = new Uint8Array(512 * 1024)
  const a = { status: 'queued', box: small }
  env.sandbox.__atts = [a]
  env.run('state.attachments = __atts')
  env.run('pumpUploads()')
  for (const res of [BUSY, BUSY, BUSY].concat(Array(7).fill(RESERVED))) await answer(env, small, res)
  await settle()
  assert.equal(a.status, 'error')
  assert.equal(env.calls.length, 10)
  assert.ok(env.calls.length * small.byteLength <= env.run('UPLOAD_WASTE_MAX_BYTES'))
})

test('başka bir yükleme bir yer tutarken on dosya tek tek yüklenir, tek ret dışında boşa gönderim olmaz ve 429 hatayla bitmez', async () => {
  const env = load()
  // Aynı hesabın başka bir oturumu bir yer tutuyor: hesap başına iki yer olduğundan bize aynı anda bir yer kalır
  let inFlight = 0
  let n = 0
  const server = virtualServer(env, () => {
    if (inFlight >= 1) return RESERVED
    inFlight += 1
    n += 1
    return { after: 3000, res: okId(n % 10), done: () => { inFlight -= 1 } }
  })
  const atts = Array.from({ length: 10 }, (_, i) => ({ status: 'queued', box: 'dosya' + i }))
  env.sandbox.__atts = atts
  env.run('state.attachments = __atts')
  env.run('pumpUploads()')
  await server.runAll()
  assert.deepEqual(atts.map((a) => a.status), Array(10).fill('done'), JSON.stringify(server.log))
  assert.equal(server.log.filter((x) => x.status === 503).length, 1)
  assert.ok(server.log.filter((x) => x.status === 429).length <= 1)
  assert.equal(env.run('state.uploadHeld'), false)
  assert.equal(env.run('state.activeUploads'), 0)
})

test('bekleyen dosya kaldırılınca bekleme hemen biter ve yeri sıradaki dosyaya geçer', async () => {
  const env = load()
  let n = 0
  const server = virtualServer(env, (box) => (box === 'birinci' ? RESERVED : okId(++n)))
  const a = { status: 'queued', box: 'birinci' }
  const b = { status: 'queued', box: 'ikinci' }
  env.sandbox.__atts = [a, b]
  env.run('state.attachments = __atts')
  env.run('state.uploadHeld = true')
  env.run('pumpUploads()')
  await settle()
  assert.equal(a.status, 'retry')
  assert.equal(env.run('state.activeUploads'), 1)
  env.run('el.composerInput = { disabled: false }; focusNode = function () {}')
  env.run('removeAttachment(__atts[0], true)')
  await settle()
  // Saat ilerlemeden ikinci dosya gönderildi
  assert.equal(server.clock.now, 0)
  assert.equal(b.status, 'done')
  assert.equal(env.run('state.activeUploads'), 0)
})
