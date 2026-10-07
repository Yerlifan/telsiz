'use strict'

// Kamera ve kapasite önerisi: public/voice.js içindeki kamera yardımcıları (özellik algılama, kısıtlar,
// kodlama sınırı, hata kodu eşlemesi, şifreli 'camera' sinyalinin katı doğrulaması, ses odası dışında
// kameranın istenmemesi), public/js/27-kapasite.js içindeki öneri formülleri ve sunucu ipuçları, iki dilde
// metinler, index.html ve sw.js bağlantıları ve Permissions-Policy başlığı. Gerçek görüntü akışı uçtan uca
// testte (e2e/10-kamera.test.js) sahte kamerayla sınanır.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..')
const PUB = path.join(ROOT, 'public')
const VOICE = fs.readFileSync(path.join(PUB, 'voice.js'), 'utf8')
const KAPASITE = fs.readFileSync(path.join(PUB, 'js', '27-kapasite.js'), 'utf8')
const I18N = fs.readFileSync(path.join(PUB, 'i18n.js'), 'utf8')

function noop () {}

// vm bağlamında üretilen nesneleri bu bağlamın nesnelerine çevirir
function plain (v) {
  return JSON.parse(JSON.stringify(v))
}

function loadVoice (opts) {
  const o = opts || {}
  const calls = []
  const md = {
    getUserMedia: (c) => {
      calls.push(c)
      return Promise.reject(Object.assign(new Error('yok'), { name: 'NotFoundError' }))
    }
  }
  function FakePC () {}
  FakePC.prototype.addTrack = noop
  if (!o.noTransceivers) FakePC.prototype.getTransceivers = () => []
  function FakeSender () {}
  FakeSender.prototype.replaceTrack = noop
  const win = {
    isSecureContext: o.secure !== false,
    addEventListener: noop,
    removeEventListener: noop,
    setTimeout,
    clearTimeout,
    console: { log: noop, warn: noop, error: noop }
  }
  win.window = win
  win.navigator = { mediaDevices: md }
  win.document = { visibilityState: 'visible', documentElement: { lang: 'tr' } }
  if (!o.noPc) {
    win.RTCPeerConnection = FakePC
    win.RTCRtpSender = FakeSender
  }
  vm.createContext(win)
  vm.runInContext(VOICE, win, { filename: 'voice.js' })
  return { VC: win.VoiceClient, calls }
}

function loadKapasite () {
  const win = { console: { log: noop, warn: noop, error: noop } }
  win.window = win
  vm.createContext(win)
  vm.runInContext(KAPASITE, win, { filename: '27-kapasite.js' })
  return win.TelsizKapasite
}

test('kamera özellik algılaması: güvensiz bağlam, WebRTC yokluğu ve aktarıcı desteği', () => {
  assert.deepStrictEqual(plain(loadVoice().VC.cameraSupport()), { ok: true, reason: null })
  assert.deepStrictEqual(plain(loadVoice({ secure: false }).VC.cameraSupport()), { ok: false, reason: 'insecure' })
  assert.deepStrictEqual(plain(loadVoice({ noPc: true }).VC.cameraSupport()), { ok: false, reason: 'camera_unsupported' })
  assert.deepStrictEqual(plain(loadVoice({ noTransceivers: true }).VC.cameraSupport()), { ok: false, reason: 'camera_unsupported' })
})

test('kamera kısıtları 640x360 15 kare ve ön kamera, kodlama sınırı yaklaşık 400 kbps', () => {
  const u = loadVoice().VC.cameraUtils
  assert.deepStrictEqual(plain(u.size), { width: 640, height: 360, frameRate: 15 })
  const c = plain(u.constraints())
  assert.strictEqual(c.audio, false)
  // Telefonda ilk açılış ön kameradır (ideal: kamerası yönsüz bilgisayarda istek reddedilmez)
  assert.deepStrictEqual(c.video, { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 15 }, facingMode: { ideal: 'user' } })
  assert.deepStrictEqual(plain(u.trackConstraints()), { width: { ideal: 640, max: 640 }, height: { ideal: 360, max: 360 }, frameRate: { max: 15 } })
  assert.deepStrictEqual(plain(u.encoding()), { maxBitrate: 400000, maxFramerate: 15 })
  // Öneri hesabı aynı bit hızını varsayar
  assert.strictEqual(loadKapasite().CAMERA_KBPS * 1000, u.encoding().maxBitrate)
})

test('kamera hata kodu eşlemesi', () => {
  const e = loadVoice().VC.cameraUtils.errorCode
  const cases = {
    NotAllowedError: 'camera_denied',
    PermissionDeniedError: 'camera_denied',
    SecurityError: 'camera_denied',
    NotFoundError: 'camera_not_found',
    DevicesNotFoundError: 'camera_not_found',
    OverconstrainedError: 'camera_not_found',
    NotReadableError: 'camera_in_use',
    TrackStartError: 'camera_in_use',
    AbortError: 'camera_in_use',
    TypeError: 'camera_unsupported',
    NotSupportedError: 'camera_unsupported',
    Bilinmeyen: 'camera_failed'
  }
  for (const name of Object.keys(cases)) assert.strictEqual(e({ name }), cases[name], name)
  assert.strictEqual(e({ code: 'camera_limit' }), 'camera_limit')
  assert.strictEqual(e({ code: 'camera_disabled' }), 'camera_disabled')
  assert.strictEqual(e({ code: 'cancelled' }), 'cancelled')
  assert.strictEqual(e(null), 'camera_failed')
})

test('şifreli kamera sinyalinin katı doğrulaması', () => {
  const v = loadVoice().VC.cameraUtils.validateSignal
  assert.deepStrictEqual(plain(v({ type: 'camera', on: true, mid: '2', sid: '0123456789abcdef', n: 4 })), { type: 'camera', on: true, mid: '2' })
  assert.deepStrictEqual(plain(v({ type: 'camera', on: false, sid: '0123456789abcdef', n: 5 })), { type: 'camera', on: false })
  assert.deepStrictEqual(plain(v({ type: 'camera', on: true, mid: '{a1b2-c3}' })), { type: 'camera', on: true, mid: '{a1b2-c3}' })
  const bad = [
    null, [], 'camera', { type: 'screen', on: true, mid: '1' }, { type: 'camera' }, { type: 'camera', on: 'true', mid: '1' },
    { type: 'camera', on: true }, { type: 'camera', on: true, mid: '' }, { type: 'camera', on: true, mid: 'a b' },
    { type: 'camera', on: true, mid: 'x'.repeat(65) }, { type: 'camera', on: true, mid: 3 }, { type: 'camera', on: false, mid: '1' },
    { type: 'camera', on: true, mid: '1', extra: 1 }, { type: 'camera', on: true, mid: '<1>' }
  ]
  for (const d of bad) assert.strictEqual(v(d), null, JSON.stringify(d))
})

test('kamera ses odası dışında açılmaz ve kamera istenmez', async () => {
  const { VC, calls } = loadVoice()
  const posts = []
  const c = VC.create({
    api: (method, url, body) => {
      posts.push([method, url, body])
      return Promise.resolve({ status: 200, data: {} })
    },
    seal: () => '1.0123456789abcdef.AAAA.BBBB',
    open: () => ({ ok: false })
  })
  await assert.rejects(c.startCamera(), (e) => e.code === 'not_in_voice')
  assert.deepStrictEqual(calls, [])
  assert.deepStrictEqual(posts, [])
  const snap = plain(c.snapshot().camera)
  assert.deepStrictEqual(snap, { canUse: true, reason: null, state: 'off', preview: null, errorCode: null, facing: null, canSwitch: false, switching: false })
  await assert.rejects(c.switchCamera(), (e) => e.code === 'camera_failed')
  // Kapalıyken durdurmak sessizce geçer
  c.stopCamera()
  assert.deepStrictEqual(posts, [])
  const offline = loadVoice({ secure: false }).VC.create({ api: () => Promise.resolve({ status: 200 }), seal: () => 'x', open: () => ({ ok: false }) })
  await assert.rejects(offline.startCamera(), (e) => e.code === 'insecure')
})

test('öneri formülleri: kullanılabilir yükleme, güvenli kapasite ve kamera sınırı', () => {
  const K = loadKapasite()
  assert.strictEqual(K.AUDIO_KBPS, 40)
  assert.strictEqual(K.CAMERA_KBPS, 400)
  assert.strictEqual(K.USABLE_SHARE, 0.7)
  assert.strictEqual(K.DEFAULT_UPLOAD_MBPS, 5)
  assert.strictEqual(K.usableKbps(5), 3500)
  // Kapasite: taban(kullanılabilir / 40) + 1, 2 ile 12 arasına sıkıştırılır
  assert.strictEqual(K.safeCapacity(5), 12)
  assert.strictEqual(K.safeCapacity(0.3), 6)
  assert.strictEqual(K.safeCapacity(0.25), 5)
  assert.strictEqual(K.safeCapacity(0.1), 2)
  assert.strictEqual(K.safeCapacity(100), 12)
  // Kameralı kapasite: taban(kullanılabilir / (40 + 400)) + 1, kamera açan kişi herkese ses ve görüntü gönderir
  assert.strictEqual(K.cameraCapacity(5), 8)
  assert.strictEqual(K.cameraCapacity(2), 4)
  assert.strictEqual(K.cameraCapacity(0.3), 2)
  assert.strictEqual(K.cameraCapacity(50), 12)
  // Kamera sınırı önerilen kapasite kadardır (herkes açabilir), sahibin aralığına sıkıştırılır
  assert.strictEqual(K.maxCameras(8), 8)
  assert.strictEqual(K.maxCameras(12), 12)
  assert.strictEqual(K.maxCameras(12, { camerasMin: 1, camerasMax: 4 }), 4)
  assert.deepStrictEqual(plain(K.recommend(5)), { upload: 5, usableKbps: 3500, capacity: 8, audioCapacity: 12, maxCameras: 8, audioKbps: 280, cameraKbps: 3080, camerasTight: false })
  assert.deepStrictEqual(plain(K.recommend('50')), { upload: 50, usableKbps: 35000, capacity: 12, audioCapacity: 12, maxCameras: 12, audioKbps: 440, cameraKbps: 4840, camerasTight: false })
  assert.deepStrictEqual(plain(K.recommend('0,3')), { upload: 0.3, usableKbps: 210, capacity: 2, audioCapacity: 6, maxCameras: 2, audioKbps: 40, cameraKbps: 440, camerasTight: true })
  // Kamera açan kişinin gönderdiği toplam kullanılabilir yüklemeyi aşmaz (en küçük oda dışında)
  for (const up of [1, 2, 5, 10, 25]) {
    const r = K.recommend(up)
    assert.ok(r.cameraKbps <= r.usableKbps, String(up))
  }
  // Sahibin aralıkları verilirse onlara sıkıştırılır
  assert.strictEqual(K.recommend(50, { capacityMin: 2, capacityMax: 6, camerasMin: 1, camerasMax: 3 }).capacity, 6)
  assert.strictEqual(K.recommend(50, { capacityMin: 2, capacityMax: 6, camerasMin: 1, camerasMax: 3 }).maxCameras, 3)
  for (const bad of [0, 0.05, -1, 20000, 'abc', '', null, undefined, NaN, Infinity]) assert.strictEqual(K.recommend(bad), null, String(bad))
  // Kamera sınırı hiçbir zaman kapasiteyi aşmaz
  for (const up of [0.1, 0.5, 1, 2, 5, 10, 25, 50, 100, 1000]) {
    const r = K.recommend(up)
    assert.ok(r.maxCameras >= 1 && r.maxCameras <= r.capacity && r.capacity >= 2 && r.capacity <= 12, String(up))
  }
})

test('sunucu ipuçları: disk, bellek, yük ve TURN', () => {
  const K = loadKapasite()
  const GB = 1024 * 1024 * 1024
  const base = {
    cpu: { cores: 4, loadavg: [0.5, 0.5, 0.5] },
    memory: { total: 8 * GB, free: 4 * GB, cgroupLimit: null },
    disk: { total: 100 * GB, free: 50 * GB },
    data: { uploadsBytes: 0, uploadQuotaBytes: 2 * GB, maxTotalMessages: 500000 },
    turn: { configured: true, local: false }
  }
  const keys = (f) => plain(K.hints(f)).map((x) => x.level + ':' + x.key)
  assert.deepStrictEqual(keys(base), ['ok:allGood'])
  // Boş disk kalan kotadan az
  assert.deepStrictEqual(keys(Object.assign({}, base, { disk: { total: 10 * GB, free: 1.5 * GB } })), ['warn:diskQuota'])
  const dq = plain(K.hints(Object.assign({}, base, { disk: { total: 10 * GB, free: 1.5 * GB }, data: Object.assign({}, base.data, { uploadsBytes: 0.25 * GB }) })))[0]
  assert.deepStrictEqual(dq.params, { free: 1.5 * GB, remaining: 1.75 * GB })
  // Kota zaten dolu, disk az
  assert.deepStrictEqual(keys(Object.assign({}, base, { disk: { total: 10 * GB, free: 0.5 * GB }, data: Object.assign({}, base.data, { uploadsBytes: 2 * GB }) })), ['warn:diskLow'])
  // Bellek: 500000 x 1500 bayt = 750 MB, 1 GB'lık kapsayıcının yarısından fazla
  assert.deepStrictEqual(keys(Object.assign({}, base, { memory: { total: 8 * GB, free: 4 * GB, cgroupLimit: GB } })), ['warn:memoryMessages'])
  assert.deepStrictEqual(keys(Object.assign({}, base, { memory: { total: 1.2 * GB, free: GB, cgroupLimit: null } })), ['warn:memoryMessages'])
  assert.deepStrictEqual(keys(Object.assign({}, base, { memory: { total: 1.6 * GB, free: GB, cgroupLimit: null } })), ['ok:allGood'])
  // Yük: 5 dakikalık ortalama çekirdek başına 1'den büyük
  assert.deepStrictEqual(keys(Object.assign({}, base, { cpu: { cores: 2, loadavg: [5, 2.5, 1] } })), ['warn:loadHigh'])
  assert.deepStrictEqual(keys(Object.assign({}, base, { cpu: { cores: 2, loadavg: [5, 2, 1] } })), ['ok:allGood'])
  assert.deepStrictEqual(keys(Object.assign({}, base, { cpu: { cores: 2, loadavg: null } })), ['ok:allGood'])
  // TURN
  assert.deepStrictEqual(keys(Object.assign({}, base, { turn: { configured: true, local: true } })), ['ok:allGood', 'info:turnLocal'])
  assert.deepStrictEqual(keys(Object.assign({}, base, { turn: { configured: false, local: false } })), ['ok:allGood', 'info:turnNone'])
  // Eksik bilgiler hata vermez
  assert.deepStrictEqual(keys({}), ['ok:allGood'])
  assert.deepStrictEqual(keys(null), ['ok:allGood'])
  assert.deepStrictEqual(keys(Object.assign({}, base, { disk: null })), ['ok:allGood'])
})

test('kamera, ses odası ayarları ve sunucu bilgileri metinleri iki dilde', () => {
  const sandbox = {
    console: { warn: noop, log: noop, error: noop },
    navigator: { languages: ['tr-TR'], language: 'tr-TR' },
    document: { documentElement: { lang: 'tr' } },
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop }
  }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(I18N, sandbox, { filename: 'i18n.js' })
  const msgs = sandbox.window.I18N.messages
  const codes = loadVoice().VC.cameraUtils.errorCodes
  const required = codes.map((c) => 'camera.errors.' + c).concat(['camera.start', 'camera.stop', 'camera.liveSelf', 'camera.flip', 'camera.flipShort',
    'camera.flipHint', 'camera.flipping', 'camera.flipFailed', 'radio.camera',
    'radio.cameraOn', 'radio.cameraOff', 'radio.stateCamera', 'radio.stateSelfCamera', 'settings.voiceLimits.title', 'settings.voiceLimits.mesh',
    'serverInfo.title', 'serverInfo.recIntro', 'serverInfo.apply'])
  const hintKeys = ['allGood', 'diskQuota', 'diskLow', 'memoryMessages', 'loadHigh', 'turnLocal', 'turnNone']
  for (const k of hintKeys) required.push('serverInfo.hint.' + k)
  for (const lang of ['tr', 'en']) {
    for (const key of required) assert.ok(typeof msgs[lang][key] === 'string' && msgs[lang][key].trim(), lang + ': ' + key)
  }
  assert.strictEqual(msgs.tr['serverInfo.apply'], 'Öneriyi Uygula')
  assert.strictEqual(msgs.tr['serverInfo.title'], 'Sunucu bilgileri')
  assert.match(msgs.tr['serverInfo.recIntro'], /tahmindir/)
  assert.match(msgs.en['serverInfo.recIntro'], /estimates/)
  // Belgelerdeki ve arayüzdeki iddia: görüntü kişiler arasında doğrudan akar, sunucu görmez
  assert.match(msgs.tr['settings.voiceLimits.mesh'], /sunucusu görmez/)
})

test('index.html, sw.js ve güvenlik başlığı kamerayı bağlar', () => {
  const html = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8')
  const sw = fs.readFileSync(path.join(PUB, 'sw.js'), 'utf8')
  assert.ok(html.indexOf('<script src="/js/27-kapasite.js" defer></script>') > html.indexOf('<script src="/js/26-tanitim.js" defer></script>'))
  assert.ok(sw.indexOf("'/js/27-kapasite.js'") !== -1)
  for (const id of ['btn-camera', 'btn-camera-state', 'radio-cam-bar', 'radio-cam-live', 'btn-camera-flip', 'radio-camera-note', 'i-camera', 'i-camera-off', 'i-camera-flip', 'i-grid']) {
    assert.ok(html.indexOf('id="' + id + '"') !== -1, id)
  }
  // Düğme sırası: üst satırda Kamera, Mikrofon, Sağırlaştır, alt satırda Ekran ve Ayrıl
  const order = ['btn-camera', 'btn-mute', 'btn-deafen', 'btn-screen', 'voice-leave'].map((id) => html.indexOf('id="' + id + '"'))
  assert.deepEqual(order.slice().sort((a, b) => a - b), order)
  assert.ok(order[0] !== -1)
  const util = require('../src/http-util')
  const headers = util.SECURITY_HEADERS || null
  const source = fs.readFileSync(path.join(ROOT, 'src', 'http-util.js'), 'utf8')
  assert.ok(source.indexOf("'Permissions-Policy': 'camera=(self), geolocation=(), microphone=(self)'") !== -1)
  if (headers) assert.strictEqual(headers['Permissions-Policy'], 'camera=(self), geolocation=(), microphone=(self)')
})
