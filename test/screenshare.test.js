'use strict'

// Ekran paylaşımı motorunun (public/voice.js, Ek L1) Node'da sınanabilen kısımları. Dosya Node vm bağlamında,
// tarayıcı genel nesnelerinin küçük taklitleriyle yüklenir. Sınananlar: özellik algılama, kalite ön ayarları ve
// kodlama sınırları, getDisplayMedia ve applyConstraints kısıtları, hata kodu eşlemesi, şifreli 'screen' ve
// 'watch' sinyallerinin katı doğrulaması, yerel paylaşım ve izleme durum makineleri, ses odası dışındaki genel API
// davranışı, paylaşım varsayılanlarının ve kişi bazlı paylaşım sesinin saklanması, hata kodlarının iki dilde
// i18n karşılığı. Gerçek WebRTC davranışı (yeniden anlaşma, çakışma, gönderim) gerçek tarayıcı düzeneğiyle
// doğrulanır, burada sınanmaz.

const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const PUB = path.join(__dirname, '..', 'public')
const VOICE = fs.readFileSync(path.join(PUB, 'voice.js'), 'utf8')
const I18N = fs.readFileSync(path.join(PUB, 'i18n.js'), 'utf8')

function noop () {}

// Tarayıcı taklidi. opts: secure, noPc, noDisplay, noReplace, noTransceivers, noGum
function load (opts) {
  const o = opts || {}
  const md = {}
  if (!o.noGum) md.getUserMedia = () => Promise.reject(new Error('yok'))
  if (!o.noDisplay) md.getDisplayMedia = () => Promise.reject(new Error('yok'))
  function FakePC () {}
  FakePC.prototype.addTrack = noop
  if (!o.noTransceivers) FakePC.prototype.getTransceivers = () => []
  function FakeSender () {}
  if (!o.noReplace) FakeSender.prototype.replaceTrack = noop
  const listeners = []
  const win = {
    isSecureContext: o.secure !== false,
    addEventListener: (type) => listeners.push(type),
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
  return { VC: win.VoiceClient, win, listeners }
}

function storageStub (initial) {
  const map = new Map(Object.entries(initial || {}))
  return {
    map,
    get: (k) => (map.has(k) ? map.get(k) : null),
    set: (k, v) => {
      map.set(k, v)
    }
  }
}

function client (VC, extra) {
  return VC.create(Object.assign({
    api: () => Promise.resolve({ status: 200, data: {} }),
    seal: () => '1.0123456789abcdef.AAAA.BBBB',
    open: () => ({ ok: false })
  }, extra || {}))
}

// vm bağlamında üretilen nesneleri bu bağlamın nesnelerine çevirir (deepStrictEqual prototip karşılaştırır)
function plain (v) {
  return JSON.parse(JSON.stringify(v))
}

const ID = '0123456789abcdef'

test('genel API: statik yardımcılar ve örnek yöntemleri var', () => {
  const { VC } = load()
  for (const name of ['screenSupport', 'screenPresets', 'screenDefaults', 'screenUtils']) assert.ok(VC[name], name)
  for (const name of ['options', 'encoding', 'trackConstraints', 'displayConstraints', 'errorCode', 'validateSignal', 'shareStep', 'watchStep']) {
    assert.strictEqual(typeof VC.screenUtils[name], 'function', name)
  }
  const v = client(VC)
  for (const name of ['screenSupport', 'startScreenShare', 'stopScreenShare', 'setScreenQuality', 'screenSettings', 'setScreenSettings',
    'watchScreen', 'unwatchScreen', 'getScreenStream', 'setScreenVolume', 'setScreenMuted']) {
    assert.strictEqual(typeof v[name], 'function', name)
  }
})

test('özellik algılama: paylaşmak için getDisplayMedia ve aktarıcı API, izlemek için sesli sohbet desteği yeter', () => {
  assert.deepStrictEqual(plain(load().VC.screenSupport()), { share: true, watch: true, reason: null })
  assert.deepStrictEqual(plain(load({ noDisplay: true }).VC.screenSupport()), { share: false, watch: true, reason: 'screen_unsupported' })
  assert.deepStrictEqual(plain(load({ noTransceivers: true }).VC.screenSupport()), { share: false, watch: true, reason: 'screen_unsupported' })
  assert.deepStrictEqual(plain(load({ noReplace: true }).VC.screenSupport()), { share: false, watch: true, reason: 'screen_unsupported' })
  assert.deepStrictEqual(plain(load({ secure: false }).VC.screenSupport()), { share: false, watch: false, reason: 'insecure' })
  assert.deepStrictEqual(plain(load({ noPc: true }).VC.screenSupport()), { share: false, watch: false, reason: 'unsupported' })
  assert.deepStrictEqual(plain(load({ noGum: true }).VC.screenSupport()), { share: false, watch: false, reason: 'unsupported' })
})

test('kalite ön ayarları: dört ön ayar, varsayılan 720p15, net metin, ses kapalı', () => {
  const { VC } = load()
  assert.deepStrictEqual(plain(VC.screenPresets()), [
    { id: '720p15', width: 1280, height: 720, frameRate: 15, maxBitrate: 1200000 },
    { id: '720p30', width: 1280, height: 720, frameRate: 30, maxBitrate: 2500000 },
    { id: '1080p15', width: 1920, height: 1080, frameRate: 15, maxBitrate: 2500000 },
    { id: '1080p30', width: 1920, height: 1080, frameRate: 30, maxBitrate: 4000000 }
  ])
  assert.deepStrictEqual(plain(VC.screenDefaults()), { preset: '720p15', hint: 'detail', audio: false })
  // Dönen nesneler kopyadır, değiştirmek sonraki çağrıları etkilemez
  VC.screenPresets()[0].maxBitrate = 1
  VC.screenDefaults().preset = 'x'
  assert.strictEqual(VC.screenPresets()[0].maxBitrate, 1200000)
  assert.strictEqual(VC.screenDefaults().preset, '720p15')
})

test('ön ayar eşleme: setParameters kodlama sınırları ve applyConstraints kısıtları', () => {
  const u = load().VC.screenUtils
  assert.deepStrictEqual(plain(u.encoding('720p15')), { maxBitrate: 1200000, maxFramerate: 15 })
  assert.deepStrictEqual(plain(u.encoding('720p30')), { maxBitrate: 2500000, maxFramerate: 30 })
  assert.deepStrictEqual(plain(u.encoding('1080p15')), { maxBitrate: 2500000, maxFramerate: 15 })
  assert.deepStrictEqual(plain(u.encoding('1080p30')), { maxBitrate: 4000000, maxFramerate: 30 })
  // Bilinmeyen veya prototip anahtarı varsayılana düşer
  for (const bad of ['4k60', '', null, undefined, '__proto__', 'constructor', 'toString']) {
    assert.deepStrictEqual(plain(u.encoding(bad)), { maxBitrate: 1200000, maxFramerate: 15 }, String(bad))
  }
  assert.deepStrictEqual(plain(u.trackConstraints('1080p30')), { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 30 } })
  assert.deepStrictEqual(plain(u.trackConstraints('nope')), { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 15 } })
})

test('getDisplayMedia kısıtları: yalnızca üst sınır, ses isteğe bağlı ve işlemesiz, kendi sekmesi hariç', () => {
  const u = load().VC.screenUtils
  assert.deepStrictEqual(plain(u.displayConstraints({ preset: '720p30', audio: false })), {
    video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 30 } },
    audio: false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include'
  })
  assert.deepStrictEqual(plain(u.displayConstraints({ audio: true })), {
    video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { max: 15 } },
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    systemAudio: 'include'
  })
  // min ve exact getDisplayMedia'da TypeError verir, hiç kullanılmaz
  const text = JSON.stringify(u.displayConstraints({ preset: '1080p15', audio: true }))
  assert.ok(!/min|exact|ideal/.test(text), text)
})

test('kodek süzgeci: ekran görüntüsünde VP8, VP9 p0, AV1 p0, H.264 temel profil ve RTX, seste yalnız Opus', () => {
  const keep = load().VC.screenUtils.keepCodec
  const video = [
    ['video/VP8', '', true],
    ['video/rtx', '', true],
    ['video/VP9', 'profile-id=0', true],
    ['video/VP9', '', true],
    ['video/VP9', 'profile-id=2', false],
    ['video/AV1', 'level-idx=5;profile=0;tier=0', true],
    ['video/AV1', 'level-idx=5;profile=1;tier=0', false],
    ['video/H264', 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f', true],
    ['video/H264', 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42001f', true],
    ['video/H264', 'level-asymmetry-allowed=1;packetization-mode=0;profile-level-id=42e01f', false],
    ['video/H264', 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=640c1f', false],
    ['video/H264', 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=4d001f', false],
    ['video/H265', 'level-id=180;profile-id=1;tier-flag=0;tx-mode=SRST', false],
    ['video/red', '', false],
    ['video/ulpfec', '', false],
    ['video/flexfec-03', 'repair-window=10000000', false]
  ]
  for (const [mimeType, sdpFmtpLine, expected] of video) {
    assert.strictEqual(keep('video', { mimeType, sdpFmtpLine }), expected, mimeType + ' ' + sdpFmtpLine)
  }
  assert.strictEqual(keep('audio', { mimeType: 'audio/opus', sdpFmtpLine: 'minptime=10;useinbandfec=1' }), true)
  for (const m of ['audio/red', 'audio/G722', 'audio/PCMU', 'audio/PCMA', 'audio/CN', 'audio/telephone-event', 'audio/ISAC']) {
    assert.strictEqual(keep('audio', { mimeType: m }), false, m)
  }
  assert.strictEqual(keep('video', null), false)
  assert.strictEqual(keep('video', { mimeType: 5 }), false)
})

test('paylaşım seçenekleri: geçersiz alan önce tabandan, sonra varsayılandan alınır, türler katı', () => {
  const u = load().VC.screenUtils
  assert.deepStrictEqual(plain(u.options(null, null)), { preset: '720p15', hint: 'detail', audio: false })
  assert.deepStrictEqual(plain(u.options({ preset: '1080p30', hint: 'motion', audio: true }, null)), { preset: '1080p30', hint: 'motion', audio: true })
  const base = { preset: '720p30', hint: 'motion', audio: true }
  assert.deepStrictEqual(plain(u.options({}, base)), base)
  assert.deepStrictEqual(plain(u.options({ preset: '4k', hint: 'text', audio: 'true' }, base)), base)
  assert.deepStrictEqual(plain(u.options({ preset: '4k', hint: 1, audio: 1 }, { preset: 'x', hint: null, audio: 'no' })), { preset: '720p15', hint: 'detail', audio: false })
  assert.deepStrictEqual(plain(u.options({ audio: false }, base)), { preset: '720p30', hint: 'motion', audio: false })
  assert.deepStrictEqual(plain(u.options('metin', 7)), { preset: '720p15', hint: 'detail', audio: false })
  assert.deepStrictEqual(plain(u.options(JSON.parse('{"__proto__":{"preset":"1080p30"}}'), null)), { preset: '720p15', hint: 'detail', audio: false })
})

test('hata kodu eşlemesi: DOMException adları ekran kodlarına, bilinmeyen screen_failed', () => {
  const u = load().VC.screenUtils
  const cases = {
    NotAllowedError: 'screen_denied',
    PermissionDeniedError: 'screen_denied',
    SecurityError: 'screen_denied',
    InvalidStateError: 'screen_gesture',
    NotFoundError: 'screen_not_found',
    TypeError: 'screen_unsupported',
    NotSupportedError: 'screen_unsupported',
    NotReadableError: 'screen_failed',
    AbortError: 'screen_failed',
    OverconstrainedError: 'screen_failed'
  }
  for (const name of Object.keys(cases)) assert.strictEqual(u.errorCode({ name }), cases[name], name)
  assert.strictEqual(u.errorCode({ code: 'screen_busy', name: 'NotAllowedError' }), 'screen_busy')
  assert.strictEqual(u.errorCode({ code: 'mic_denied' }), 'screen_failed')
  assert.strictEqual(u.errorCode(null), 'screen_failed')
  assert.strictEqual(u.errorCode(undefined), 'screen_failed')
  assert.ok(u.errorCodes.length >= 10)
  for (const code of u.errorCodes) assert.ok(/^[a-z_]+$/.test(code), code)
})

test('sinyal doğrulaması: geçerli screen ve watch mesajları normalleştirilir (sid ve n ortak alanlardır)', () => {
  const v = load().VC.screenUtils.validateSignal
  assert.deepStrictEqual(plain(v({ type: 'screen', on: true, id: ID, audio: true, hint: 'motion', preset: '1080p30', sid: ID, n: 3 })),
    { type: 'screen', on: true, id: ID, audio: true, hint: 'motion', preset: '1080p30' })
  assert.deepStrictEqual(plain(v({ type: 'screen', on: false, id: ID, sid: ID, n: 4 })), { type: 'screen', on: false, id: ID })
  assert.deepStrictEqual(plain(v({ type: 'watch', on: true, id: ID, sid: ID, n: 5 })), { type: 'watch', on: true, id: ID })
  assert.deepStrictEqual(plain(v({ type: 'watch', on: false, id: ID })), { type: 'watch', on: false, id: ID })
})

test('sinyal doğrulaması: tür, alan kümesi, alan türü, değer kümesi ve boyut katı denetlenir', () => {
  const v = load().VC.screenUtils.validateSignal
  const on = { type: 'screen', on: true, id: ID, audio: false, hint: 'detail', preset: '720p15' }
  const bad = [
    null, undefined, 'screen', 5, [], [on],
    { type: 'Screen', on: true, id: ID, audio: false, hint: 'detail', preset: '720p15' },
    { type: 'offer', on: true, id: ID },
    Object.assign({}, on, { id: ID.toUpperCase() }),
    Object.assign({}, on, { id: ID.slice(1) }),
    Object.assign({}, on, { id: ID + '0' }),
    Object.assign({}, on, { id: 12345 }),
    Object.assign({}, on, { on: 1 }),
    Object.assign({}, on, { on: 'true' }),
    Object.assign({}, on, { audio: 'false' }),
    Object.assign({}, on, { audio: null }),
    Object.assign({}, on, { hint: 'text' }),
    Object.assign({}, on, { hint: 'm'.repeat(5000) }),
    Object.assign({}, on, { preset: '4k60' }),
    Object.assign({}, on, { preset: '__proto__' }),
    Object.assign({}, on, { name: 'Ece' }),
    Object.assign({}, on, { sdp: 'v=0' }),
    { type: 'screen', id: ID, audio: false, hint: 'detail', preset: '720p15' },
    { type: 'screen', on: true, id: ID, hint: 'detail', preset: '720p15' },
    { type: 'screen', on: false, id: ID, audio: false },
    { type: 'watch', on: true },
    { type: 'watch', on: true, id: ID, preset: '720p15' },
    { type: 'watch', on: true, id: ID, x: 1 },
    JSON.parse('{"type":"watch","on":true,"id":"' + ID + '","__proto__":1}'),
    JSON.parse('{"type":"screen","on":false,"id":"' + ID + '","constructor":1}')
  ]
  bad.forEach((d, i) => assert.strictEqual(v(d), null, 'geçersiz örnek ' + i + ': ' + String(JSON.stringify(d)).slice(0, 80)))
})

test('yerel paylaşım durum makinesi: idle, starting, live', () => {
  const step = load().VC.screenUtils.shareStep
  const table = [
    ['idle', 'start', 'starting'], ['idle', 'granted', 'idle'], ['idle', 'failed', 'idle'], ['idle', 'stop', 'idle'],
    ['starting', 'granted', 'live'], ['starting', 'failed', 'idle'], ['starting', 'stop', 'idle'], ['starting', 'leave', 'idle'],
    ['starting', 'start', 'starting'], ['starting', 'ended', 'idle'],
    // live iken yeniden start kaynak değişimidir, başarısız olursa paylaşım sürer
    ['live', 'start', 'live'], ['live', 'failed', 'live'], ['live', 'granted', 'live'],
    ['live', 'stop', 'idle'], ['live', 'ended', 'idle'], ['live', 'leave', 'idle'],
    ['bilinmeyen', 'start', 'starting'], ['idle', 'bilinmeyen', 'idle']
  ]
  for (const [from, ev, to] of table) assert.strictEqual(step(from, ev), to, from + ' + ' + ev)
})

test('izleme durum makinesi: none, available, requested, live, failed', () => {
  const step = load().VC.screenUtils.watchStep
  const table = [
    ['none', 'announce', 'available'], ['none', 'watch', 'none'], ['none', 'media', 'none'], [null, 'announce', 'available'],
    ['available', 'watch', 'requested'], ['available', 'media', 'available'], ['available', 'unwatch', 'available'],
    ['requested', 'media', 'live'], ['requested', 'nomedia', 'requested'], ['requested', 'timeout', 'failed'],
    ['requested', 'unwatch', 'available'], ['requested', 'watch', 'requested'],
    ['live', 'nomedia', 'requested'], ['live', 'media', 'live'], ['live', 'timeout', 'live'], ['live', 'unwatch', 'available'],
    ['live', 'watch', 'live'],
    ['failed', 'watch', 'requested'], ['failed', 'media', 'live'], ['failed', 'unwatch', 'available'], ['failed', 'nomedia', 'failed'],
    ['live', 'withdraw', 'none'], ['requested', 'withdraw', 'none'], ['available', 'withdraw', 'none']
  ]
  for (const [from, ev, to] of table) assert.strictEqual(step(from, ev), to, from + ' + ' + ev)
})

test('ses odası dışında: başlatma, izleme ve kalite çağrıları hata kodu döndürür, durum boş', async () => {
  const { VC } = load()
  const v = client(VC)
  const s = plain(v.snapshot().screen)
  assert.deepStrictEqual(s, {
    canShare: true,
    canWatch: true,
    reason: null,
    state: 'idle',
    starting: false,
    id: null,
    preset: null,
    hint: null,
    audio: false,
    preview: null,
    viewers: [],
    viewerCount: 0,
    errorCode: null,
    remote: {}
  })
  await assert.rejects(v.startScreenShare({}), (e) => e.code === 'not_in_voice' && e.message === 'not_in_voice')
  assert.strictEqual(v.watchScreen('5'), 'not_in_voice')
  assert.strictEqual(v.unwatchScreen('5'), 'not_in_voice')
  assert.strictEqual(v.getScreenStream('5'), null)
  assert.strictEqual(await v.setScreenQuality({ preset: '1080p30' }), 'no_share')
  // Durdurmak her zaman güvenlidir
  v.stopScreenShare()
  assert.strictEqual(v.snapshot().screen.state, 'idle')
  const u = client(load({ noDisplay: true }).VC)
  await assert.rejects(u.startScreenShare({}), (e) => e.code === 'screen_unsupported')
  const w = client(load({ secure: false }).VC)
  await assert.rejects(w.startScreenShare({}), (e) => e.code === 'insecure')
})

test('paylaşım varsayılanları cihaza özel saklanır, geçersiz alanlar yok sayılır', () => {
  const { VC } = load()
  const storage = storageStub()
  const v = client(VC, { storage })
  assert.deepStrictEqual(plain(v.screenSettings()), { preset: '720p15', hint: 'detail', audio: false })
  assert.deepStrictEqual(plain(v.setScreenSettings({ preset: '1080p30', hint: 'nope', audio: true, extra: 1 })), { preset: '1080p30', hint: 'detail', audio: true })
  assert.deepStrictEqual(JSON.parse(storage.map.get('telsiz.voice.screen')), { preset: '1080p30', hint: 'detail', audio: true })
  v.setScreenSettings({ hint: 'motion' })
  assert.deepStrictEqual(plain(v.screenSettings()), { preset: '1080p30', hint: 'motion', audio: true })
  // Yeni örnek kayıtlı değerle başlar, bozuk kayıt varsayılana düşer
  assert.deepStrictEqual(plain(client(VC, { storage }).screenSettings()), { preset: '1080p30', hint: 'motion', audio: true })
  const broken = storageStub({ 'telsiz.voice.screen': '{"preset":"8k","hint":5,"audio":"x"}' })
  assert.deepStrictEqual(plain(client(VC, { storage: broken }).screenSettings()), { preset: '720p15', hint: 'detail', audio: false })
  const garbage = storageStub({ 'telsiz.voice.screen': '{bozuk' })
  assert.deepStrictEqual(plain(client(VC, { storage: garbage }).screenSettings()), { preset: '720p15', hint: 'detail', audio: false })
})

test('kişi bazlı paylaşım sesi mikrofon sesinden ayrı saklanır, susturma oturumluktur', () => {
  const { VC } = load()
  const storage = storageStub()
  const v = client(VC, { storage })
  v.setScreenVolume('7', 0.25)
  v.setPeerVolume('7', 0.5)
  v.setScreenVolume('8', 2)
  v.setScreenVolume('__proto__', 0.1)
  v.setScreenVolume('9', 'yarım')
  v.setScreenMuted('7', true)
  const saved = JSON.parse(storage.map.get('telsiz.voice.peers'))
  // 2 değeri 1'e kırpılır, 1 varsayılandır ve saklanmaz. Geçersiz kimlik ve değer yok sayılır.
  assert.deepStrictEqual(saved.screenVolumes, { 7: 0.25 })
  assert.deepStrictEqual(saved.volumes, { 7: 0.5 })
  assert.strictEqual(Object.prototype.hasOwnProperty.call(saved, 'screenMutes'), false)
  // Yeni örnek kayıtlı paylaşım sesini okur
  v.setScreenVolume('7', 1)
  assert.deepStrictEqual(JSON.parse(storage.map.get('telsiz.voice.peers')).screenVolumes, {})
  v.setScreenVolume('7', 0.3)
  const again = client(VC, { storage })
  again.setPeerVolume('1', 1)
  assert.deepStrictEqual(JSON.parse(storage.map.get('telsiz.voice.peers')).screenVolumes, { 7: 0.3 })
})

test('olay dinleyicisi isteğe bağlıdır, geçersiz dinleyici yok sayılır', () => {
  const { VC } = load()
  assert.doesNotThrow(() => client(VC, { onScreenEvent: 'olay' }))
  assert.doesNotThrow(() => client(VC, { onScreenEvent: null }))
})

test('her ekran hata kodunun ve arayüz anahtarlarının iki dilde metni var', () => {
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
  const u = load().VC.screenUtils
  const required = u.errorCodes.map((c) => 'screen.errors.' + c).concat([
    'screen.share', 'screen.stop', 'screen.changeSource', 'screen.watch', 'screen.unwatch', 'screen.retry', 'screen.sharingSelf',
    'screen.sharingUser', 'screen.notify', 'screen.stoppedUser', 'screen.stoppedSelf', 'screen.viewerJoined', 'screen.viewerLeft',
    'screen.viewers_one', 'screen.viewers_other', 'screen.noViewers', 'screen.unsupported', 'screen.preview', 'screen.waiting',
    'screen.status.available', 'screen.status.requested', 'screen.status.live', 'screen.status.failed', 'screen.fullscreen',
    'screen.exitFullscreen', 'screen.fit', 'screen.fill', 'screen.switch', 'screen.volume', 'screen.volumeLabel', 'screen.mute',
    'screen.unmute', 'screen.settingsTitle', 'screen.settingsHint', 'screen.quality', 'screen.hintLabel', 'screen.hint.motion',
    'screen.hint.motionHint', 'screen.hint.detail', 'screen.hint.detailHint', 'screen.audio', 'screen.audioHint', 'screen.audioMissing',
    'screen.bandwidthNote', 'screen.privacyNote'
  ], load().VC.screenPresets().map((p) => 'screen.preset.' + p.id))
  for (const lang of ['tr', 'en']) {
    for (const key of required) assert.ok(typeof msgs[lang][key] === 'string' && msgs[lang][key].trim(), lang + ': ' + key)
  }
  // Şartnamedeki metinler
  assert.strictEqual(msgs.tr['screen.unsupported'], 'Bu cihaz ekran paylaşımını başlatamıyor, ama izleyebilirsiniz.')
  assert.strictEqual(msgs.tr['screen.hint.motion'], 'Akıcı')
  assert.strictEqual(msgs.tr['screen.hint.detail'], 'Net metin')
  assert.strictEqual(msgs.tr['screen.audio'], 'Sesi de paylaş')
})

test('voice.js ekran paylaşımı kodu metin üretmez ve tarayıcı adı tahmin etmez', () => {
  // Özellik algılama: userAgent, vendor veya platform okunmaz
  assert.ok(!/navigator\.(userAgent|vendor|platform|appVersion)/.test(VOICE))
  // Ekran paylaşımı bölümündeki dize sabitlerinde Türkçeye özgü harf yok (yorumlar hariç)
  const code = VOICE.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')
  const strings = code.match(/'(?:[^'\\\n]|\\.)*'/g) || []
  const turkish = strings.filter((s) => /[çğıöşüÇĞİÖŞÜ]/.test(s))
  assert.deepStrictEqual(turkish, [])
})

// ---------------------------------------------------------------- Sahte WebRTC düzeneği
// Yeniden anlaşma ve izleme durumunun birim testleri için gerçek tarayıcıda ölçülen Chromium davranışlarının küçük
// bir modeli. Gerçek tarayıcı denemeleri work-screenshare düzeneğindedir, burada aynı hatalar her ortamda ve
// belirlenimci saatle (sahte setTimeout ve Date) yeniden üretilir. Modelin kuralları:
//  - SDP metni oturum başlığı ve m satırlarını (tür, port, kodekler, mid, yön) taşır
//  - sonraki tekliflerde mevcut m satırlarının sırası ve mid'leri değişemez (InvalidAccessError), yalnız
//    reddedilmiş (port 0) bir m satırı yeni bir aktarıcıya verilebilir
//  - geri alınan teklifin mid'leri yeniden kullanılmaz
//  - yeni m satırı ekleyen teklif geri alınınca göndericiler, sonraki tamamlanan anlaşmadan sonra replaceTrack
//    yapılana kadar paket göndermez (work-screenshare/probe-rollback*.js)
//  - yeni ICE oturumu açan teklifin localDescription.sdp değeri sonradan toplanan adaylarla büyür (curut-1-0/probe-ld.js)
//  - ortak görüntü kodeki yoksa yanıt m satırını reddeder (port 0), iki taraftaki aktarıcı durur
//  - seçenekle: uzak görüntü izi 'track' olayından 1 ms sonra paket gelmeden 'unmute' olur (Chromium 141)
//  - iki tarafın ICE kimlikleri tutmazsa bağlantı 'failed' olur
// Paketler 250 ms aralıkla sayılır: gönderen aktarıcının izi canlı ve kare üretiyorsa, anlaşılmış yön gönderime ve
// alıma izin veriyorsa, kodlama etkinse ve gönderici bozuk değilse alıcının sayaçları artar.

const KID = '0123456789abcdef'
const CH = '7'
const VIDEO_CAPS = [
  { mimeType: 'video/VP8', clockRate: 90000 },
  { mimeType: 'video/rtx', clockRate: 90000 },
  { mimeType: 'video/VP9', clockRate: 90000, sdpFmtpLine: 'profile-id=0' },
  { mimeType: 'video/VP9', clockRate: 90000, sdpFmtpLine: 'profile-id=2' },
  { mimeType: 'video/AV1', clockRate: 90000, sdpFmtpLine: 'level-idx=5;profile=0;tier=0' },
  { mimeType: 'video/AV1', clockRate: 90000, sdpFmtpLine: 'level-idx=5;profile=1;tier=0' },
  { mimeType: 'video/H265', clockRate: 90000 },
  { mimeType: 'video/red', clockRate: 90000 },
  { mimeType: 'video/ulpfec', clockRate: 90000 }
]
const AUDIO_CAPS = [
  { mimeType: 'audio/opus', clockRate: 48000, channels: 2, sdpFmtpLine: 'minptime=10;useinbandfec=1' },
  { mimeType: 'audio/red', clockRate: 48000, channels: 2 },
  { mimeType: 'audio/G722', clockRate: 8000 },
  { mimeType: 'audio/PCMU', clockRate: 8000 },
  { mimeType: 'audio/PCMA', clockRate: 8000 },
  { mimeType: 'audio/CN', clockRate: 8000 },
  { mimeType: 'audio/telephone-event', clockRate: 48000 }
]

function codecKey (c) {
  return c.mimeType.split('/')[1] + (c.sdpFmtpLine ? ':' + c.sdpFmtpLine.replace(/\s/g, '') : '')
}

function isMediaKey (k) {
  return !/^(rtx|red|ulpfec|flexfec|CN|telephone-event)/.test(k)
}

function sendsDir (d) {
  return d === 'sendrecv' || d === 'sendonly'
}

function recvsDir (d) {
  return d === 'sendrecv' || d === 'recvonly'
}

function answerDir (offerDir, localDir) {
  const send = recvsDir(offerDir) && sendsDir(localDir)
  const recv = sendsDir(offerDir) && recvsDir(localDir)
  if (send && recv) return 'sendrecv'
  if (send) return 'sendonly'
  return recv ? 'recvonly' : 'inactive'
}

function reverseDir (d) {
  if (d === 'sendonly') return 'recvonly'
  if (d === 'recvonly') return 'sendonly'
  return d
}

function domErr (name, message) {
  const e = new Error(message)
  e.name = name
  return e
}

function parseSdp (sdp) {
  const parts = String(sdp).split('\r\nm=')
  const head = parts[0]
  return {
    pcid: Number((head.match(/a=pcid:(\d+)/) || [])[1]),
    ufrag: (head.match(/a=ice-ufrag:(\S+)/) || [])[1],
    secs: parts.slice(1).map((p) => {
      const f = p.split('\r\n')[0].split(' ')
      return {
        kind: f[0],
        port: Number(f[1]),
        codecs: f.slice(3).filter(Boolean),
        mid: (p.match(/\r\na=mid:(\S+)/) || [])[1],
        dir: (p.match(/\r\na=(sendrecv|sendonly|recvonly|inactive)/) || [])[1]
      }
    })
  }
}

function makeClock () {
  let now = 1700000000000
  let seq = 0
  const timers = new Map()
  const errors = []
  function add (fn, ms, every) {
    seq++
    const d = Math.max(0, Number(ms) || 0)
    timers.set(seq, { id: seq, fn, at: now + d, every: every ? Math.max(1, d) : 0 })
    return seq
  }
  class FakeDate extends Date {
    constructor (...a) {
      if (a.length) super(...a)
      else super(now)
    }

    static now () {
      return now
    }
  }
  async function flush (turns) {
    let i = 0
    while (i < turns) {
      await new Promise((resolve) => setImmediate(resolve))
      i++
    }
  }
  return {
    Date: FakeDate,
    errors,
    now: () => now,
    setTimeout: (fn, ms) => add(fn, ms, false),
    clearTimeout: (id) => { timers.delete(id) },
    setInterval: (fn, ms) => add(fn, ms, true),
    clearInterval: (id) => { timers.delete(id) },
    flush,
    async advance (ms) {
      const end = now + ms
      await flush(30)
      while (true) {
        let next = null
        timers.forEach((t) => {
          if (t.at <= end && (!next || t.at < next.at || (t.at === next.at && t.id < next.id))) next = t
        })
        if (!next) break
        now = next.at
        if (next.every) next.at += next.every
        else timers.delete(next.id)
        try {
          next.fn()
        } catch (e) {
          errors.push(e)
        }
        // Mikrofon ölçüm döngüsü (20 ms) eşzamanlıdır, diğer zamanlayıcılardan sonra söz zincirleri tamamlanır
        await flush(next.every && next.every <= 50 ? 1 : 30)
      }
      now = end
      await flush(30)
    }
  }
}

// Bir ses odası: sahte sunucu (katılım, meta, sinyal yönlendirme), sahte ağ kuralları ve her istemci için ayrı
// vm bağlamında gerçek voice.js. İstemciler katılma sırasıyla eklenir, sonra katılan bağlantıyı başlatır (kaba eş).
function makeRoom () {
  const clock = makeClock()
  const net = { pcs: new Map(), pcSeq: 0, ufragSeq: 0, trackSeq: 0 }
  const engines = {}
  const roster = []
  let sigSeq = 0
  let rnd = 12345
  const room = { clock, net, engines, rule: null, offline: new Set(), signals: 0, lastAt: {} }

  class FTrack {
    constructor (kind, opts) {
      const o = opts || {}
      net.trackSeq++
      this.id = 'track-' + net.trackSeq
      this.kind = kind
      this.readyState = 'live'
      this.muted = !!o.muted
      this.enabled = true
      this.contentHint = ''
      this.produces = o.produces !== false
      this.unmutedAt = 0
      this.ls = {}
    }

    addEventListener (type, fn) {
      if (!this.ls[type]) this.ls[type] = []
      this.ls[type].push(fn)
    }

    removeEventListener (type, fn) {
      const list = this.ls[type] || []
      const i = list.indexOf(fn)
      if (i >= 0) list.splice(i, 1)
    }

    dispatch (type) {
      if (type === 'mute') this.muted = true
      if (type === 'unmute') {
        this.muted = false
        this.unmutedAt = clock.now()
      }
      if (type === 'ended') this.readyState = 'ended'
      const ev = { type, target: this }
      const list = (this.ls[type] || []).slice()
      list.forEach((fn) => fn.call(this, ev))
      if (typeof this['on' + type] === 'function') this['on' + type](ev)
    }

    stop () {
      this.readyState = 'ended'
    }

    clone () {
      return new FTrack(this.kind, { produces: this.produces })
    }

    applyConstraints () {
      return Promise.resolve()
    }
  }

  class FStream {
    constructor (tracks) {
      this.tracks = Array.isArray(tracks) ? tracks.slice() : []
    }

    getTracks () {
      return this.tracks.slice()
    }

    getAudioTracks () {
      return this.tracks.filter((t) => t.kind === 'audio')
    }

    getVideoTracks () {
      return this.tracks.filter((t) => t.kind === 'video')
    }

    addTrack (t) {
      if (this.tracks.indexOf(t) < 0) this.tracks.push(t)
    }

    removeTrack (t) {
      const i = this.tracks.indexOf(t)
      if (i >= 0) this.tracks.splice(i, 1)
    }
  }

  function element (tag) {
    return {
      tagName: String(tag).toUpperCase(),
      nodeType: 1,
      children: [],
      parentNode: null,
      attrs: {},
      paused: true,
      volume: 1,
      muted: false,
      srcObject: null,
      appendChild (c) {
        c.parentNode = this
        this.children.push(c)
        return c
      },
      removeChild (c) {
        const i = this.children.indexOf(c)
        if (i >= 0) this.children.splice(i, 1)
        c.parentNode = null
        return c
      },
      setAttribute (k, v) {
        this.attrs[k] = String(v)
      },
      play () {
        this.paused = false
        return Promise.resolve()
      },
      pause () {
        this.paused = true
      }
    }
  }

  function engineRtc (owner, eo) {
    class FSender {
      constructor (pc, track) {
        this.pc = pc
        this.track = track || null
        this.broken = false
        this.enc = { active: true }
      }

      replaceTrack (t) {
        if (this.pc.closed) return Promise.reject(domErr('InvalidStateError', 'closed'))
        this.track = t || null
        if (this.pc.signalingState === 'stable' && this.pc.negotiated) this.broken = false
        return Promise.resolve()
      }

      getParameters () {
        return { encodings: [Object.assign({}, this.enc)] }
      }

      setParameters (p) {
        this.enc = Object.assign({}, p.encodings[0])
        return Promise.resolve()
      }
    }

    class FReceiver {
      constructor (pc, kind) {
        this.pc = pc
        this.track = new FTrack(kind, { muted: true })
        this.stats = { packets: 0, frames: 0 }
        this.lastPkt = 0
      }

      getStats () {
        return Promise.resolve(this.pc.report(this))
      }

      static getCapabilities (kind) {
        if (kind === 'video') return { codecs: eo.noVideoDecode ? [] : VIDEO_CAPS.slice(), headerExtensions: [] }
        return { codecs: AUDIO_CAPS.slice(), headerExtensions: [] }
      }
    }

    class FTransceiver {
      constructor (pc, kind, dir, sender) {
        this.pc = pc
        this.kind = kind
        this.mid = null
        this.dir = dir
        this.currentDirection = null
        this.stopped = false
        this.recyclable = false
        this.byAddTrack = false
        this.receiving = false
        this.prefs = null
        this.sender = sender || new FSender(pc, null)
        this.receiver = new FReceiver(pc, kind)
      }

      get direction () {
        return this.dir
      }

      set direction (d) {
        if (this.stopped) throw domErr('InvalidStateError', 'stopped')
        this.dir = d
      }

      setCodecPreferences (list) {
        this.prefs = list.map(codecKey)
      }
    }

    class FakePC {
      constructor () {
        net.pcSeq++
        this.id = net.pcSeq
        this.owner = owner
        net.pcs.set(this.id, this)
        this.signalingState = 'stable'
        this.connectionState = 'new'
        this.iceConnectionState = 'new'
        this.closed = false
        this.trs = []
        this.ml = []
        this.usedMids = new Set()
        this.midSeq = 0
        this.plans = new Map()
        this.pendingLocal = null
        this.pendingRemote = null
        this.localUfrag = null
        this.remoteUfrag = null
        this.localSdp = null
        this.localType = null
        this.stableLocal = null
        this.remoteSdp = null
        this.remoteType = null
        this.stableRemote = null
        this.remotePcId = null
        this.curPlan = null
        this.negotiated = false
        this.rollbacks = 0
        this.calls = []
        this.onicecandidate = null
        this.ontrack = null
        this.onconnectionstatechange = null
        this.oniceconnectionstatechange = null
      }

      get localDescription () {
        return this.localSdp === null ? null : { type: this.localType, sdp: this.localSdp }
      }

      get remoteDescription () {
        return this.remoteSdp === null ? null : { type: this.remoteType, sdp: this.remoteSdp }
      }

      log (call, err) {
        this.calls.push({ t: clock.now(), call, state: this.signalingState, err: err ? err.name + ': ' + err.message : null })
      }

      fail (call, name, message) {
        const e = domErr(name, message)
        this.log(call, e)
        return Promise.reject(e)
      }

      newMid () {
        while (this.usedMids.has(String(this.midSeq))) this.midSeq++
        const m = String(this.midSeq)
        this.midSeq++
        this.usedMids.add(m)
        return m
      }

      codecsFor (t) {
        const caps = t.kind === 'video' ? (eo.noVideoDecode ? [] : VIDEO_CAPS) : AUDIO_CAPS
        const list = t.prefs ? caps.filter((c) => t.prefs.indexOf(codecKey(c)) >= 0) : caps
        return list.map(codecKey)
      }

      sdpOf (secs, ufrag) {
        let s = 'v=0\r\no=- ' + this.id + ' 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=pcid:' + this.id + '\r\na=ice-ufrag:' + ufrag
        secs.forEach((m) => {
          s += '\r\nm=' + m.kind + ' ' + m.port + ' UDP/TLS/RTP/SAVPF ' + m.codecs.join(' ') + '\r\na=mid:' + m.mid + '\r\na=' + m.dir
        })
        return s + '\r\n'
      }

      addTrack (track, stream) {
        if (this.closed) throw domErr('InvalidStateError', 'closed')
        const t = new FTransceiver(this, track.kind, 'sendrecv', new FSender(this, track))
        t.byAddTrack = true
        this.trs.push(t)
        return t.sender
      }

      getTransceivers () {
        return this.trs.slice()
      }

      getSenders () {
        return this.trs.map((t) => t.sender)
      }

      getReceivers () {
        return this.trs.map((t) => t.receiver)
      }

      createOffer (o) {
        if (this.closed) return this.fail('createOffer', 'InvalidStateError', 'closed')
        this.log('createOffer')
        const restart = !!(o && o.iceRestart) || this.localUfrag === null
        net.ufragSeq++
        const ufrag = restart ? 'u' + net.ufragSeq : this.localUfrag
        const list = this.ml.slice()
        const assign = []
        this.trs.forEach((t) => {
          if (t.mid !== null || t.stopped || list.indexOf(t) >= 0) return
          const mid = this.newMid()
          assign.push([t, mid])
          const slot = list.findIndex((x) => x.stopped && x.recyclable && !x.taken)
          if (slot >= 0) {
            list[slot].taken = true
            list[slot] = t
          } else {
            list.push(t)
          }
        })
        list.forEach((x) => { delete x.taken })
        const secs = list.map((t) => {
          const a = assign.find((x) => x[0] === t)
          const mid = a ? a[1] : t.mid
          return { kind: t.kind, port: t.stopped ? 0 : 9, codecs: t.stopped ? [] : this.codecsFor(t), mid, dir: t.stopped ? 'inactive' : t.dir }
        })
        const sdp = this.sdpOf(secs, ufrag)
        this.plans.set(sdp, { type: 'offer', list, assign, ufrag, secs, adds: assign.length > 0 })
        return Promise.resolve({ type: 'offer', sdp })
      }

      createAnswer () {
        if (this.closed || this.signalingState !== 'have-remote-offer') return this.fail('createAnswer', 'InvalidStateError', 'no remote offer')
        this.log('createAnswer')
        const pr = this.pendingRemote
        net.ufragSeq++
        const ufrag = pr.ufrag !== this.remoteUfrag || this.localUfrag === null ? 'u' + net.ufragSeq : this.localUfrag
        const secs = pr.secs.map((s, i) => {
          const t = pr.list[i]
          const reject = { kind: s.kind, port: 0, codecs: [], mid: s.mid, dir: 'inactive' }
          if (s.port === 0) return reject
          const common = this.codecsFor(t).filter((c) => s.codecs.indexOf(c) >= 0)
          if (!common.some(isMediaKey)) return reject
          return { kind: s.kind, port: 9, codecs: common, mid: s.mid, dir: answerDir(s.dir, t.dir) }
        })
        const sdp = this.sdpOf(secs, ufrag)
        this.plans.set(sdp, { type: 'answer', secs, ufrag })
        return Promise.resolve({ type: 'answer', sdp })
      }

      stopT (t) {
        t.stopped = true
        t.dir = 'stopped'
        t.currentDirection = 'stopped'
        t.receiving = false
        t.recyclable = true
      }

      finishStable () {
        this.signalingState = 'stable'
        this.negotiated = true
        this.stableLocal = [this.localType, this.localSdp]
        this.stableRemote = [this.remoteType, this.remoteSdp]
        this.trs = this.trs.filter((t) => !t.stopped)
        this.checkIce()
      }

      setConn (s) {
        if (this.closed || this.connectionState === s) return
        this.connectionState = s
        this.iceConnectionState = s
        if (this.onconnectionstatechange) this.onconnectionstatechange()
      }

      // ICE: iki taraf da kararlıyken kimlikler tutuyorsa bağlı, tutmuyorsa 1 sn sonra başarısız
      checkIce () {
        const r = net.pcs.get(this.remotePcId)
        if (!r || r.closed || r.remotePcId !== this.id) return
        if (this.signalingState !== 'stable' || r.signalingState !== 'stable') return
        const ok = this.localUfrag && this.remoteUfrag && r.localUfrag === this.remoteUfrag && r.remoteUfrag === this.localUfrag
        if (ok) {
          this.setConn('connected')
          r.setConn('connected')
          return
        }
        clock.setTimeout(() => {
          const ok2 = this.localUfrag && r.localUfrag === this.remoteUfrag && r.remoteUfrag === this.localUfrag
          if (!ok2 && this.signalingState === 'stable' && r.signalingState === 'stable') {
            this.setConn('failed')
            r.setConn('failed')
          }
        }, 1000)
      }

      // Yeni ICE oturumunun adayı 30 ms sonra toplanır: yerel tanıma eklenir ve onicecandidate ile bildirilir
      gather (plan) {
        clock.setTimeout(() => {
          if (this.closed || this.curPlan !== plan) return
          const c = 'candidate:1 1 udp 2122260223 127.0.0.' + this.id + ' 50000 typ host'
          this.localSdp += 'a=' + c + '\r\n'
          if (this.onicecandidate) {
            this.onicecandidate({ candidate: { candidate: c, sdpMid: plan.secs[0].mid, sdpMLineIndex: 0 } })
            this.onicecandidate({ candidate: null })
          }
        }, 30)
      }

      fireTrack (t) {
        if (t.receiving) return
        t.receiving = true
        const track = t.receiver.track
        if (this.ontrack) this.ontrack({ track, transceiver: t, receiver: t.receiver, streams: [new FStream([track])] })
        if (t.kind === 'video' && eo.spuriousUnmute) {
          clock.setTimeout(() => {
            if (track.muted && !this.closed) track.dispatch('unmute')
          }, 1)
        }
      }

      setLocalDescription (desc) {
        const type = desc && desc.type
        if (this.closed) return this.fail('sLD:' + type, 'InvalidStateError', 'closed')
        if (type === 'rollback') {
          if (this.signalingState === 'have-local-offer') {
            const p = this.pendingLocal
            p.assign.forEach((a) => {
              if (a[0].mid === a[1]) a[0].mid = null
            })
            if (p.adds) {
              this.trs.forEach((t) => { t.sender.broken = true })
              this.negotiated = false
            }
            this.pendingLocal = null
            this.localType = this.stableLocal ? this.stableLocal[0] : null
            this.localSdp = this.stableLocal ? this.stableLocal[1] : null
          } else if (this.signalingState === 'have-remote-offer') {
            const p = this.pendingRemote
            p.created.forEach((t) => this.trs.splice(this.trs.indexOf(t), 1))
            p.assoc.forEach((t) => { t.mid = null })
            this.pendingRemote = null
            this.remoteType = this.stableRemote ? this.stableRemote[0] : null
            this.remoteSdp = this.stableRemote ? this.stableRemote[1] : null
          } else {
            return this.fail('sLD:rollback', 'InvalidStateError', 'nothing to roll back')
          }
          this.log('sLD:rollback')
          this.rollbacks++
          this.signalingState = 'stable'
          return Promise.resolve()
        }
        const plan = this.plans.get(desc.sdp)
        if (!plan || plan.type !== type) return this.fail('sLD:' + type, 'InvalidModificationError', 'unknown description')
        if (type === 'offer') {
          if (this.signalingState !== 'stable' && this.signalingState !== 'have-local-offer') return this.fail('sLD:offer', 'InvalidStateError', 'bad state')
          this.log('sLD:offer')
          if (this.pendingLocal) {
            this.pendingLocal.assign.forEach((a) => {
              if (a[0].mid === a[1]) a[0].mid = null
            })
          }
          plan.assign.forEach((a) => { a[0].mid = a[1] })
          this.pendingLocal = plan
          this.localType = 'offer'
          this.localSdp = desc.sdp
          this.curPlan = plan
          this.signalingState = 'have-local-offer'
          if (plan.ufrag !== this.localUfrag) this.gather(plan)
          return Promise.resolve()
        }
        if (this.signalingState !== 'have-remote-offer') return this.fail('sLD:answer', 'InvalidStateError', 'bad state')
        this.log('sLD:answer')
        const pr = this.pendingRemote
        plan.secs.forEach((s, i) => {
          const t = pr.list[i]
          if (s.port === 0) this.stopT(t)
          else t.currentDirection = s.dir
        })
        this.ml = pr.list.slice()
        const fresh = plan.ufrag !== this.localUfrag
        this.localUfrag = plan.ufrag
        this.remoteUfrag = pr.ufrag
        this.localType = 'answer'
        this.localSdp = desc.sdp
        this.curPlan = plan
        this.pendingRemote = null
        this.finishStable()
        if (fresh) this.gather(plan)
        return Promise.resolve()
      }

      setRemoteDescription (desc) {
        const type = desc && desc.type
        if (this.closed) return this.fail('sRD:' + type, 'InvalidStateError', 'closed')
        const p = parseSdp(desc.sdp)
        if (type === 'offer') {
          if (this.signalingState !== 'stable') return this.fail('sRD:offer', 'InvalidStateError', 'bad state')
          if (eo.failOffer && eo.failOffer(p, this)) return this.fail('sRD:offer', 'OperationError', 'cannot apply this offer')
          let i = 0
          while (i < this.ml.length) {
            const cur = this.ml[i]
            const s = p.secs[i]
            if (!s) return this.fail('sRD:offer', 'InvalidAccessError', 'The number of m-lines in subsequent offer is smaller')
            if (s.mid !== cur.mid && !(cur.stopped && cur.recyclable)) {
              return this.fail('sRD:offer', 'InvalidAccessError', "The order of m-lines in subsequent offer doesn't match order from previous offer/answer.")
            }
            i++
          }
          this.log('sRD:offer')
          const list = []
          const created = []
          const assoc = []
          p.secs.forEach((s, k) => {
            let t = k < this.ml.length && this.ml[k].mid === s.mid ? this.ml[k] : null
            if (!t) {
              t = this.trs.find((x) => x.mid === null && !x.stopped && x.byAddTrack && x.kind === s.kind) || null
              if (t) {
                assoc.push(t)
              } else {
                t = new FTransceiver(this, s.kind, 'recvonly')
                this.trs.push(t)
                created.push(t)
              }
              t.mid = s.mid
            }
            this.usedMids.add(s.mid)
            list.push(t)
          })
          this.pendingRemote = { list, created, assoc, ufrag: p.ufrag, secs: p.secs }
          this.remoteType = 'offer'
          this.remoteSdp = desc.sdp
          this.remotePcId = p.pcid
          this.signalingState = 'have-remote-offer'
          p.secs.forEach((s, k) => {
            if (s.port !== 0 && sendsDir(s.dir) && recvsDir(list[k].dir)) this.fireTrack(list[k])
          })
          return Promise.resolve()
        }
        if (this.signalingState !== 'have-local-offer') return this.fail('sRD:answer', 'InvalidStateError', 'bad state')
        const pl = this.pendingLocal
        if (p.secs.length !== pl.secs.length || p.secs.some((s, k) => s.mid !== pl.secs[k].mid)) {
          return this.fail('sRD:answer', 'InvalidAccessError', 'answer does not match the offer')
        }
        this.log('sRD:answer')
        p.secs.forEach((s, k) => {
          const t = pl.list[k]
          if (s.port === 0) {
            this.stopT(t)
            return
          }
          t.currentDirection = reverseDir(s.dir)
          if (sendsDir(s.dir) && recvsDir(t.dir)) this.fireTrack(t)
        })
        this.ml = pl.list.slice()
        this.pendingLocal = null
        this.remoteType = 'answer'
        this.remoteSdp = desc.sdp
        this.remotePcId = p.pcid
        this.localUfrag = pl.ufrag
        this.remoteUfrag = p.ufrag
        this.finishStable()
        return Promise.resolve()
      }

      addIceCandidate () {
        if (this.closed || !this.remoteSdp) return Promise.reject(domErr('InvalidStateError', 'no remote description'))
        return Promise.resolve()
      }

      report (rc) {
        const m = new Map()
        this.trs.forEach((t) => {
          if (rc && t.receiver !== rc) return
          const s = t.receiver.stats
          if (!s.packets) return
          m.set('in-' + t.mid, { id: 'in-' + t.mid, type: 'inbound-rtp', kind: t.kind, mid: t.mid, packetsReceived: s.packets, framesDecoded: t.kind === 'video' ? s.frames : undefined, trackIdentifier: t.receiver.track.id })
        })
        return m
      }

      getStats () {
        return Promise.resolve(this.report(null))
      }

      close () {
        if (this.closed) return
        this.closed = true
        this.signalingState = 'closed'
        this.connectionState = 'closed'
        this.trs.forEach((t) => {
          t.stopped = true
          t.dir = 'stopped'
          t.currentDirection = 'stopped'
        })
      }
    }

    return { FakePC, FSender, FReceiver }
  }

  // Paket sayımı (250 ms)
  function flowTick () {
    net.pcs.forEach((pc) => {
      if (pc.closed) return
      const r = net.pcs.get(pc.remotePcId)
      const linked = !!(r && !r.closed && r.connectionState === 'connected' && pc.connectionState === 'connected')
      pc.trs.forEach((t) => {
        if (t.stopped || t.mid === null) return
        const rt = linked ? r.trs.find((x) => x.mid === t.mid && !x.stopped) : null
        const tr = rt ? rt.sender.track : null
        const flowing = !!(tr && tr.readyState === 'live' && tr.produces && sendsDir(rt.currentDirection) && recvsDir(t.currentDirection) && !rt.sender.broken && rt.sender.enc.active !== false)
        const rx = t.receiver
        if (flowing) {
          rx.stats.packets++
          if (t.kind === 'video') rx.stats.frames++
          rx.lastPkt = clock.now()
          if (rx.track.muted) rx.track.dispatch('unmute')
        } else if (!rx.track.muted && clock.now() - Math.max(rx.lastPkt, rx.track.unmutedAt) > 2000) {
          rx.track.dispatch('mute')
        }
      })
    })
  }
  clock.setInterval(flowTick, 250)

  function seal (obj) {
    return '1.' + KID + '.nonce.' + Buffer.from(JSON.stringify(obj)).toString('base64')
  }

  function open (env) {
    const parts = String(env).split('.')
    if (parts[0] !== '1' || parts[1] !== KID) return { ok: false }
    return { ok: true, kid: KID, value: JSON.parse(Buffer.from(parts[3], 'base64').toString()) }
  }

  function pushMeta () {
    const list = roster.map((m) => ({ peerId: m.peerId, userId: m.userId, muted: false, deafened: false }))
    Object.keys(engines).forEach((name) => {
      const e = engines[name]
      if (room.offline.has(name)) return
      clock.setTimeout(() => e.voice.handleMeta({ voice: { [CH]: list } }, { id: e.userId }), 20)
    })
  }

  function display (c, eo) {
    const tracks = [new FTrack('video', { produces: !eo.deadVideo })]
    if (c && c.audio) tracks.push(new FTrack('audio'))
    return new FStream(tracks)
  }

  async function serverApi (e, method, path, body) {
    room.calls.push({ t: clock.now(), from: e.name, path })
    if (room.offline.has(e.name)) return { status: 0, data: null }
    if (path === '/api/voice/join') {
      e.peerId = 'peer' + e.name + e.joins
      e.joins++
      const members = roster.map((m) => ({ peerId: m.peerId, userId: m.userId, muted: false, deafened: false }))
      roster.push({ peerId: e.peerId, userId: e.userId })
      pushMeta()
      return { status: 200, data: { ok: true, peerId: e.peerId, members, iceServers: [] } }
    }
    if (path === '/api/voice/leave') {
      const i = roster.findIndex((m) => m.peerId === e.peerId)
      if (i >= 0) roster.splice(i, 1)
      pushMeta()
      return { status: 200, data: { ok: true } }
    }
    if (path === '/api/voice/state') return { status: 200, data: { ok: true } }
    if (path === '/api/voice/signal') {
      const env = open(body.data).value
      const d = env.d
      const target = Object.keys(engines).map((k) => engines[k]).find((x) => x.peerId === body.to)
      const entry = { t: clock.now(), from: e.name, to: target ? target.name : null, type: d.type, n: d.n, o: d.o, sid: d.sid, sdp: d.sdp || null }
      e.sent.push(entry)
      room.signals++
      if (room.signals > 2000) return { status: 429, data: null }
      const rule = room.rule ? room.rule(entry) : null
      if (rule && typeof rule.after === 'number') await new Promise((resolve) => clock.setTimeout(resolve, rule.after))
      if (rule && typeof rule.status === 'number') return { status: rule.status, data: null }
      if (!target || room.offline.has(target.name)) return { status: 200, data: { ok: true } }
      // Gerçek sunucuda bir göndericinin sinyalleri alıcıya gönderim sırasıyla ulaşır (istemci POST'ları sıralı,
      // sunucu kuyruğu sıralı): geciken bir sinyal kendisinden sonrakileri de geciktirir
      const delayMs = rule && typeof rule.delay === 'number' ? rule.delay : 20
      const key = e.name + '>' + target.name
      const at = Math.max(clock.now() + delayMs, (room.lastAt[key] || 0) + 1)
      room.lastAt[key] = at
      sigSeq++
      const sig = { seq: sigSeq, from: e.peerId, data: body.data }
      clock.setTimeout(() => target.voice.handleSignals([sig]), at - clock.now())
      return { status: 200, data: { ok: true } }
    }
    return { status: 404, data: null }
  }
  room.calls = []

  room.add = function (name, opts) {
    const eo = opts || {}
    const rtc = engineRtc(name, eo)
    const win = {
      isSecureContext: true,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      setInterval: clock.setInterval,
      clearInterval: clock.clearInterval,
      Date: clock.Date,
      console: { log: noop, warn: noop, error: noop },
      addEventListener: noop,
      removeEventListener: noop,
      crypto: {
        getRandomValues (b) {
          let i = 0
          while (i < b.length) {
            rnd = (rnd * 1103515245 + 12345) % 2147483648
            b[i] = rnd % 256
            i++
          }
          return b
        }
      }
    }
    win.window = win
    win.document = { visibilityState: 'visible', documentElement: element('html'), body: element('body'), createElement: element, addEventListener: noop, removeEventListener: noop }
    const md = { getUserMedia: () => Promise.resolve(new FStream([new FTrack('audio')])), enumerateDevices: () => Promise.resolve([]) }
    if (!eo.noDisplay) md.getDisplayMedia = (c) => Promise.resolve(display(c, eo))
    win.navigator = { mediaDevices: md }
    win.MediaStream = FStream
    win.RTCPeerConnection = rtc.FakePC
    win.RTCRtpSender = rtc.FSender
    win.RTCRtpReceiver = rtc.FReceiver
    vm.createContext(win)
    vm.runInContext(VOICE, win, { filename: 'voice.js' })
    const e = { name, userId: String(Object.keys(engines).length + 1), peerId: null, joins: 1, events: [], sent: [], win, opts: eo }
    e.voice = win.VoiceClient.create({
      api: (m, p, b) => serverApi(e, m, p, b),
      seal,
      open,
      onScreenEvent: (ev) => e.events.push(Object.assign({ t: clock.now() }, JSON.parse(JSON.stringify(ev)))),
      storage: null
    })
    engines[name] = e
    return e
  }

  room.join = async function (name) {
    const e = engines[name]
    e.voice.handleMeta({ voice: {} }, { id: e.userId })
    const p = e.voice.join(CH)
    await clock.advance(100)
    await p
    await clock.advance(400)
  }

  // Sunucudan düşme: istemci kadrodan çıkar, diğerlerine meta gider (çevrimdışı istemciye gitmez)
  room.serverDrop = function (name) {
    const e = engines[name]
    const i = roster.findIndex((m) => m.peerId === e.peerId)
    if (i >= 0) roster.splice(i, 1)
    pushMeta()
  }

  room.pushMeta = pushMeta
  room.advance = (ms) => clock.advance(ms)

  // name tarafındaki, other ile kurulmuş açık bağlantı
  room.pc = function (name, other) {
    let found = null
    net.pcs.forEach((pc) => {
      const r = net.pcs.get(pc.remotePcId)
      if (pc.owner === name && !pc.closed && r && r.owner === other) found = pc
    })
    return found
  }
  room.pcsOf = (name) => Array.from(net.pcs.values()).filter((pc) => pc.owner === name)

  // name'in other'dan aldığı mikrofon paketleri (bağlantının ilk m satırı) ve görüntü kareleri
  room.micIn = function (name, other) {
    const pc = room.pc(name, other)
    return pc && pc.ml[0] ? pc.ml[0].receiver.stats.packets : 0
  }
  room.framesIn = function (name, other) {
    const pc = room.pc(name, other)
    if (!pc) return 0
    return pc.trs.filter((t) => t.kind === 'video').reduce((n, t) => n + t.receiver.stats.frames, 0)
  }
  room.screen = (name) => JSON.parse(JSON.stringify(Object.assign({}, engines[name].voice.snapshot().screen, { preview: null, remote: null })))
  room.remote = function (name, other) {
    const r = engines[name].voice.snapshot().screen.remote[engines[other].userId]
    return r ? { status: r.status, watching: r.watching, stream: !!r.stream, id: r.id } : null
  }
  room.offers = (name, other) => engines[name].sent.filter((s) => s.type === 'offer' && s.to === other)
  room.events = (name, type) => engines[name].events.filter((ev) => !type || ev.type === type)

  // Belirli aralıklarla mikrofon akışı örneklenir: her aralıkta paket sayısı artmalı
  room.micGaps = async function (name, other, totalMs, stepMs) {
    const out = []
    let prev = room.micIn(name, other)
    let t = 0
    while (t < totalMs) {
      await clock.advance(stepMs)
      t += stepMs
      const cur = room.micIn(name, other)
      out.push(cur - prev)
      prev = cur
    }
    return out
  }

  room.leaveAll = async function () {
    Object.keys(engines).forEach((k) => {
      try {
        engines[k].voice.teardown()
      } catch (e) {}
    })
    await clock.advance(2000)
  }
  return room
}

// İki kişilik oda: A önce katılır (yanıtlayan, kibar eş), B sonra katılır (başlatıcı, kaba eş)
async function twoRoom (optsA, optsB) {
  const room = makeRoom()
  room.add('A', optsA)
  room.add('B', optsB)
  await room.join('A')
  await room.join('B')
  await room.advance(1500)
  return room
}

async function shareAndAnnounce (room, sharer, viewer, opts) {
  const p = room.engines[sharer].voice.startScreenShare(opts || { audio: false })
  await room.advance(100)
  const res = await p
  await room.advance(500)
  assert.ok(room.remote(viewer, sharer), viewer + ' paylaşımı görmeli')
  return res
}

test('sahte düzenek: iki istemci bağlanır, mikrofon iki yönde akar, paylaşım izlenince görüntü gelir', async () => {
  const room = await twoRoom()
  assert.strictEqual(room.pc('A', 'B').connectionState, 'connected')
  assert.strictEqual(room.pc('B', 'A').connectionState, 'connected')
  const gaps = await room.micGaps('B', 'A', 2000, 500)
  assert.ok(gaps.every((d) => d > 0), JSON.stringify(gaps))
  assert.ok((await room.micGaps('A', 'B', 1000, 500)).every((d) => d > 0))
  await shareAndAnnounce(room, 'A', 'B')
  assert.strictEqual(room.remote('B', 'A').status, 'available')
  assert.strictEqual(room.engines.B.voice.watchScreen(room.engines.A.userId), null)
  await room.advance(3000)
  assert.strictEqual(room.remote('B', 'A').status, 'live')
  assert.ok(room.framesIn('B', 'A') > 0)
  assert.ok((await room.micGaps('B', 'A', 2000, 500)).every((d) => d > 0))
  assert.deepStrictEqual(room.clock.errors.map(String), [])
  await room.leaveAll()
})

function consistent (room, a, b) {
  const pa = room.pc(a, b)
  const pb = room.pc(b, a)
  if (!pa || !pb) return { ok: false, why: 'bağlantı yok' }
  const ma = pa.ml.map((t) => t.mid).join(',')
  const mb = pb.ml.map((t) => t.mid).join(',')
  const ok = pa.signalingState === 'stable' && pb.signalingState === 'stable' && ma === mb && pa.connectionState === 'connected' && pb.connectionState === 'connected'
  return { ok, a: [pa.signalingState, pa.connectionState, ma], b: [pb.signalingState, pb.connectionState, mb] }
}

function forceIceFailure (room, name, other) {
  room.pc(name, other).setConn('failed')
}

test('hata 1: yanıtı kaybolan yeniden anlaşma teklifi geri alınmaz, yeniden gönderilir, mikrofon ve görüntü sürer', async () => {
  const room = await twoRoom()
  const A = room.engines.A
  const B = room.engines.B
  await shareAndAnnounce(room, 'A', 'B')
  const t0 = room.clock.now()
  // B'nin yanıtı ve 3 yeniden denemesi sunucuya ulaşmaz (503), B karşı teklifi zaten uygulamıştır
  room.rule = (s) => (s.from === 'B' && s.type === 'answer' && s.t - t0 < 8000 ? { status: 503 } : null)
  assert.strictEqual(B.voice.watchScreen(A.userId), null)
  const gaps = await room.micGaps('B', 'A', 60000, 5000)
  assert.ok(gaps.every((d) => d > 0), 'A->B mikrofon her 5 sn aralıkta akmalı: ' + JSON.stringify(gaps))
  assert.ok((await room.micGaps('A', 'B', 5000, 5000)).every((d) => d > 0))
  assert.strictEqual(room.pc('A', 'B').rollbacks, 0, 'yanıtsız teklif geri alınmamalı')
  const c = consistent(room, 'A', 'B')
  assert.ok(c.ok, JSON.stringify(c))
  assert.strictEqual(room.remote('B', 'A').status, 'live')
  assert.ok(room.framesIn('B', 'A') > 0)
  const offers = room.offers('A', 'B').filter((s) => s.t >= t0)
  assert.ok(offers.length >= 2 && offers[1].sdp === offers[0].sdp && offers[1].o === offers[0].o, 'aynı teklif aynı numarayla yeniden gönderilmeli')
  assert.deepStrictEqual(room.events('A', 'error'), [])
  assert.deepStrictEqual(room.clock.errors.map(String), [])
  await room.leaveAll()
})

test('hata 1: 20 sn sonra gelen geç yanıt uygulanır, bağlantı tutarlı kalır', async () => {
  const room = await twoRoom()
  const A = room.engines.A
  const B = room.engines.B
  await shareAndAnnounce(room, 'A', 'B')
  const t0 = room.clock.now()
  // B'nin ilk yanıtı 25 sn gecikir (ağda bekler)
  room.rule = (s) => (s.from === 'B' && s.type === 'answer' && s.t - t0 < 1000 ? { delay: 25000 } : null)
  B.voice.watchScreen(A.userId)
  const gaps = await room.micGaps('B', 'A', 40000, 5000)
  assert.ok(gaps.every((d) => d > 0), JSON.stringify(gaps))
  assert.strictEqual(room.pc('A', 'B').rollbacks, 0)
  const c = consistent(room, 'A', 'B')
  assert.ok(c.ok, JSON.stringify(c))
  assert.strictEqual(room.remote('B', 'A').status, 'live')
  await room.leaveAll()
})

test('hata 1: başka bir teklif beklerken gelen eski teklifin yanıtı uygulanmaz (yanıt teklif numarasını taşır)', async () => {
  const room = await twoRoom()
  const A = room.engines.A
  const B = room.engines.B
  // B (başlatıcı) paylaşır, A izler: teklifleri B yapar. A'nın ilk yanıtı 25 sn gecikir, sıradaki sinyalleri de
  // arkasında bekler. B 20. saniyede aynı teklifi yeniden gönderir, A ikinci kez yanıtlar.
  await shareAndAnnounce(room, 'B', 'A')
  const t0 = room.clock.now()
  room.rule = (s) => (s.from === 'A' && s.type === 'answer' && s.t - t0 < 1000 ? { delay: 25000 } : null)
  A.voice.watchScreen(B.userId)
  await room.advance(22000)
  // B'de ICE yeniden başlatma istenir (teklif beklerken ertelenir). İlk yanıt gelince B hemen yeniden başlatma
  // teklif eder, aynı teklife verilmiş ikinci yanıt bu yeni teklife uygulanırsa ICE kimlikleri tutmaz.
  forceIceFailure(room, 'B', 'A')
  await room.advance(18000)
  const answers = A.sent.filter((s) => s.type === 'answer' && s.t >= t0)
  assert.ok(answers.length >= 3 && answers[0].o === answers[1].o && answers[2].o > answers[0].o, JSON.stringify(answers.map((x) => [x.t - t0, x.o])))
  // Teklifler: ilk teklif, aynı teklifin yeniden gönderimi, tek bir ICE yeniden başlatma. Eski yanıt yeni teklife
  // uygulansaydı ICE kopar ve ikinci bir yeniden başlatma gerekirdi (gerçekte saniyelerce ses kesintisi).
  const offers = room.offers('B', 'A').filter((s) => s.t >= t0).map((s) => s.o)
  assert.deepStrictEqual(offers, [offers[0], offers[0], offers[0] + 1])
  assert.ok(room.pc('B', 'A').calls.every((x) => x.t < t0 + 22000 || !x.err))
  const c = consistent(room, 'A', 'B')
  assert.ok(c.ok, JSON.stringify(c))
  assert.ok((await room.micGaps('A', 'B', 5000, 2500)).every((d) => d > 0))
  assert.ok((await room.micGaps('B', 'A', 5000, 2500)).every((d) => d > 0))
  assert.strictEqual(room.remote('A', 'B').status, 'live')
  await room.leaveAll()
})

test('hata 2: izleyicinin yanıtı görüntü m satırını reddederse yeniden teklif fırtınası olmaz, izleme başarısız olur', async () => {
  const room = await twoRoom(null, { noVideoDecode: true })
  const A = room.engines.A
  const B = room.engines.B
  await shareAndAnnounce(room, 'A', 'B')
  const t0 = room.clock.now()
  B.voice.watchScreen(A.userId)
  await room.advance(5000)
  const offers = room.offers('A', 'B').filter((s) => s.t >= t0)
  assert.ok(offers.length <= 1, 'reddedilen m satırı için en fazla bir teklif: ' + offers.length)
  const errs = room.events('A', 'error')
  assert.deepStrictEqual(errs.map((e) => e.code), ['screen_negotiation_failed'])
  assert.strictEqual(errs[0].userId, B.userId)
  assert.strictEqual(room.screen('A').viewerCount, 0)
  const gaps = await room.micGaps('B', 'A', 30000, 5000)
  assert.ok(gaps.every((d) => d > 0), JSON.stringify(gaps))
  assert.strictEqual(room.offers('A', 'B').filter((s) => s.t >= t0).length, offers.length)
  assert.strictEqual(room.remote('B', 'A').status, 'failed')
  assert.ok(room.events('B', 'watch-state').every((e) => e.status !== 'live'))
  assert.deepStrictEqual(room.events('B', 'error').map((e) => e.code), ['screen_watch_failed'])
  // Yeniden izleme isteği aynı bağlantıda teklif üretmez, paylaşan hatayı yeniden bildirir
  B.voice.watchScreen(A.userId)
  await room.advance(3000)
  assert.strictEqual(room.offers('A', 'B').filter((s) => s.t >= t0).length, offers.length)
  assert.strictEqual(room.events('A', 'error').length, 2)
  assert.ok(room.engines.A.sent.length < 60, 'sinyal sayısı sınırlı: ' + room.engines.A.sent.length)
  await room.leaveAll()
})

test('hata 3: yanıtı kaybolan ICE yeniden başlatma teklifi yeniden gönderilir, bağlantı kilitlenmez', async () => {
  const room = await twoRoom()
  const A = room.engines.A
  const B = room.engines.B
  const t0 = room.clock.now()
  room.rule = (s) => (s.from === 'A' && s.type === 'answer' && s.t - t0 < 10000 ? { status: 503 } : null)
  forceIceFailure(room, 'B', 'A')
  await room.advance(200)
  const ld = room.pc('B', 'A').localDescription.sdp
  assert.ok(/a=candidate:/.test(ld), 'yeni ICE oturumunun yerel tanımı adaylarla büyür (Chromium)')
  await room.advance(30000)
  const c = consistent(room, 'A', 'B')
  assert.ok(c.ok, JSON.stringify(c))
  const offers = room.offers('B', 'A').filter((s) => s.t >= t0)
  assert.ok(offers.length >= 2 && offers[1].o === offers[0].o && offers[1].sdp === offers[0].sdp, JSON.stringify(offers.map((o) => [o.t - t0, o.o])))
  // Ekran paylaşımı bu bağlantıda çalışır
  await shareAndAnnounce(room, 'A', 'B')
  B.voice.watchScreen(A.userId)
  await room.advance(3000)
  assert.strictEqual(room.remote('B', 'A').status, 'live')
  await room.leaveAll()
})

test('hata 3: sunucunun reddettiği (400) ICE yeniden başlatma teklifi bağlantıyı yeniden kurar', async () => {
  const room = await twoRoom()
  const t0 = room.clock.now()
  let n = 0
  room.rule = (s) => {
    if (s.from !== 'B' || s.type !== 'offer' || s.t < t0) return null
    n++
    return n === 1 ? { status: 400, after: 200 } : null
  }
  const old = room.pc('B', 'A')
  forceIceFailure(room, 'B', 'A')
  await room.advance(5000)
  assert.ok(old.closed, 'reddedilen teklifin bağlantısı kapanmalı')
  const c = consistent(room, 'A', 'B')
  assert.ok(c.ok, JSON.stringify(c))
  assert.notStrictEqual(room.pc('B', 'A'), old)
  assert.ok((await room.micGaps('A', 'B', 5000, 2500)).every((d) => d > 0))
  // Yalnız mikrofon m satırlı teklif: ekran paylaşımı hatası bildirilmez
  assert.deepStrictEqual(room.events('A', 'error').concat(room.events('B', 'error')), [])
  await room.leaveAll()
})

test('hata 4: görüntülü teklifi uygulayamayan izleyici bağlantıyı yeniden kurar, mikrofon kalıcı olarak kesilmez', async () => {
  const room = await twoRoom(null, { failOffer: (p) => p.secs.some((s) => s.kind === 'video') })
  const A = room.engines.A
  const B = room.engines.B
  await shareAndAnnounce(room, 'A', 'B')
  const t0 = room.clock.now()
  B.voice.watchScreen(A.userId)
  await room.advance(5000)
  const gaps = await room.micGaps('B', 'A', 120000, 5000)
  assert.ok(gaps.every((d) => d > 0), 'A->B mikrofon: ' + JSON.stringify(gaps))
  assert.ok((await room.micGaps('A', 'B', 5000, 5000)).every((d) => d > 0))
  const c = consistent(room, 'A', 'B')
  assert.ok(c.ok, JSON.stringify(c))
  // Yeniden kurulum bir kez olur, izleme yeniden istenmez (aynı teklif yeniden gelmesin)
  assert.ok(room.pcsOf('B').length <= 2 && room.pcsOf('A').length <= 2, room.pcsOf('B').length + ' ' + room.pcsOf('A').length)
  assert.strictEqual(room.remote('B', 'A').watching, false)
  assert.strictEqual(room.remote('B', 'A').status, 'available')
  assert.deepStrictEqual(room.events('B', 'error').map((e) => e.code), ['screen_watch_failed'])
  assert.ok(room.offers('A', 'B').filter((s) => s.t >= t0 + 5000).every((s) => !/m=video/.test(s.sdp)))
  await room.leaveAll()
})

test('hata 5: paylaşan çevrimdışı kalınca paylaşım ağ dönmeden durur (reason left), çevrimiçi boştayken durmaz', async () => {
  const room = await twoRoom()
  const A = room.engines.A
  await shareAndAnnounce(room, 'A', 'B')
  // Çevrimiçi ve sinyal trafiği yokken 2 dakika: paylaşım sürer, sunucu en fazla 10 sn'de bir yoklanır
  const c0 = room.calls.length
  await room.advance(120000)
  assert.strictEqual(room.screen('A').state, 'live')
  const probes = room.calls.slice(c0).filter((x) => x.from === 'A' && x.path === '/api/voice/state').length
  assert.ok(probes <= 13, 'yoklama sayısı: ' + probes)
  const track = A.voice.snapshot().screen.preview.getVideoTracks()[0]
  room.offline.add('A')
  await room.advance(15000)
  assert.strictEqual(room.screen('A').state, 'live', 'kısa kesintide paylaşım sürer')
  await room.advance(25000)
  assert.strictEqual(room.screen('A').state, 'idle')
  assert.strictEqual(track.readyState, 'ended')
  const stops = room.events('A', 'local-stop')
  assert.strictEqual(stops.length, 1)
  assert.strictEqual(stops[0].reason, 'left')
  room.offline.delete('A')
  await room.advance(3000)
  await room.leaveAll()
})

test('hata 6: kare gelmeden live olmaz, 30 sn içinde görüntü gelmezse failed ve screen_watch_failed', async () => {
  const room = await twoRoom({ deadVideo: true }, { spuriousUnmute: true })
  const A = room.engines.A
  const B = room.engines.B
  await shareAndAnnounce(room, 'A', 'B')
  const t0 = room.clock.now()
  B.voice.watchScreen(A.userId)
  await room.advance(40000)
  const states = room.events('B', 'watch-state').filter((e) => e.t >= t0).map((e) => e.status)
  assert.ok(states.indexOf('live') < 0, JSON.stringify(states))
  assert.strictEqual(room.remote('B', 'A').status, 'failed')
  assert.deepStrictEqual(room.events('B', 'error').map((e) => e.code), ['screen_watch_failed'])
  await room.leaveAll()
})

test('hata 6: live durumuna ilk çözülen kareden sonra geçilir, görüntü kesilirse 30 sn sonra failed, gelince yeniden live', async () => {
  const room = await twoRoom(null, { spuriousUnmute: true })
  const A = room.engines.A
  const B = room.engines.B
  await shareAndAnnounce(room, 'A', 'B')
  B.voice.watchScreen(A.userId)
  let steps = 0
  while (room.remote('B', 'A').status !== 'live' && steps < 500) {
    await room.advance(10)
    steps++
  }
  assert.strictEqual(room.remote('B', 'A').status, 'live')
  assert.ok(room.framesIn('B', 'A') > 0, 'live olduğunda en az bir kare çözülmüş olmalı')
  // Paylaşanın görüntüsü kesilir: iz sessize geçer, durum requested, 30 sn sonra failed
  const track = A.voice.snapshot().screen.preview.getVideoTracks()[0]
  track.produces = false
  await room.advance(5000)
  assert.strictEqual(room.remote('B', 'A').status, 'requested')
  await room.advance(30000)
  assert.strictEqual(room.remote('B', 'A').status, 'failed')
  assert.deepStrictEqual(room.events('B', 'error').map((e) => e.code), ['screen_watch_failed'])
  track.produces = true
  await room.advance(3000)
  assert.strictEqual(room.remote('B', 'A').status, 'live')
  await room.leaveAll()
})

test('hata 7: karşı tarafın açtığı ekran m satırlarına da kodek süzgeci uygulanır, izleyicinin teklifleri süzülür', async () => {
  const room = await twoRoom()
  const A = room.engines.A
  const B = room.engines.B
  await shareAndAnnounce(room, 'A', 'B', { audio: true })
  B.voice.watchScreen(A.userId)
  await room.advance(3000)
  assert.strictEqual(room.remote('B', 'A').status, 'live')
  const t0 = room.clock.now()
  // İzleyici (B) ICE yeniden başlatır: teklifinde A'nın açtığı görüntü ve ses m satırları vardır
  forceIceFailure(room, 'B', 'A')
  await room.advance(3000)
  const offer = room.offers('B', 'A').filter((s) => s.t >= t0)[0]
  assert.ok(offer, 'B teklif etmeli')
  const secs = parseSdp(offer.sdp).secs
  assert.strictEqual(secs.length, 3)
  const video = secs.filter((s) => s.kind === 'video')[0]
  const screenAudio = secs[2]
  assert.deepStrictEqual(video.codecs, ['VP8', 'rtx', 'VP9:profile-id=0', 'AV1:level-idx=5;profile=0;tier=0'])
  assert.deepStrictEqual(screenAudio.codecs, ['opus:minptime=10;useinbandfec=1'])
  // Mikrofon m satırı süzülmez
  assert.strictEqual(secs[0].codecs.length, AUDIO_CAPS.length)
  assert.ok(consistent(room, 'A', 'B').ok)
  await room.leaveAll()
})
