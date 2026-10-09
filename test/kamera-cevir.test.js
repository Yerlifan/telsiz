'use strict'

// Kamerayı Çevir: public/voice.js içinde varsayılan ön kamera isteği, kamera yönünün ve değiştirme
// seçeneklerinin saf yardımcıları (cameraUtils.facingOf, cameraUtils.switchTargets) ve switchCamera akışı.
// Telefonda karşı yöne (facingMode exact), yön bildirmeyen bilgisayarda sıradaki kameraya (deviceId exact)
// geçilir. Aynı anda iki kamerayı açamayan cihazda eski kamera bırakılıp yeniden denenir, değiştirme
// başarısızsa eski kamera sürer veya yeniden açılır, o da olmazsa kamera kapanır (camera_lost). Motor Node vm
// bağlamında sahte kamera ve sahte sunucuyla yüklenir.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const VOICE = fs.readFileSync(path.join(__dirname, '..', 'public', 'voice.js'), 'utf8')
const KID = '0123456789abcdef'
const ROOM = '7'

function noop () {}

function plain (v) {
  return JSON.parse(JSON.stringify(v))
}

function b64 (obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64')
}

async function flush () {
  let i = 0
  while (i < 30) {
    await new Promise((resolve) => setImmediate(resolve))
    i++
  }
}

function domError (name) {
  return Object.assign(new Error(name), { name })
}

// Sahte kamera: cameras dizisindeki her kamera { deviceId, facing, label }. getUserMedia isteğindeki
// facingMode veya deviceId'ye göre kamera seçer. Seçenekler:
// busy: aynı anda yalnızca bir kamera açılabilir (NotReadableError).
// hold: başka kamera açıkken istek bekletilir, açık kamera kalmayınca yanıtlanır (hedeflenen telefon).
// hang: başka kamera açıkken istek hiç yanıtlanmaz, kamera bırakılsa da.
// stall(c, n): true dönerse n. istek hiç yanıtlanmaz.
// manual(c, n): true dönerse n. istek test answer(n) veya refuse(n, ad) çağırana kadar bekler.
// fail(c, n): hata adı döndürürse n. istek o hatayla reddedilir.
// permission: navigator.permissions.query sonucu ('granted', 'prompt'), verilmezse permissions yoktur.
// Zamanlayıcılar çalışmaz, kaydedilir, fire(ms) o süredekileri çalıştırır.
function loadEngine (opts) {
  const o = opts || {}
  const cameras = o.cameras
  const requests = []
  const posts = []
  const live = []
  const deviceListeners = []
  const timers = []
  const held = []
  const pending = {}
  let serial = 0
  function audioTrack () {
    return { kind: 'audio', enabled: true, readyState: 'live', onended: null, stop: noop, clone: () => audioTrack() }
  }
  function videoTrack (cam) {
    const listeners = {}
    const track = {
      id: 'v' + (++serial),
      kind: 'video',
      label: cam.label || '',
      readyState: 'live',
      cam,
      enabled: true,
      getSettings: () => (cam.facing && !o.hideFacing ? { deviceId: cam.deviceId, facingMode: cam.facing } : { deviceId: cam.deviceId }),
      applyConstraints: () => Promise.resolve(),
      addEventListener: (type, fn) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== fn).concat([fn])
      },
      removeEventListener: (type, fn) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== fn)
      },
      stop () {
        if (track.readyState === 'ended') return
        track.readyState = 'ended'
        const i = live.indexOf(track)
        if (i >= 0) live.splice(i, 1)
        if (!live.length && held.length) held.shift()()
      },
      // Kamera çıkarıldı: tarayıcı izi bitirir ve olay gönderir
      unplug () {
        track.stop()
        const ended = listeners.ended || []
        ended.slice().forEach((fn) => fn())
      },
      listenerCount: (type) => (listeners[type] || []).length
    }
    return track
  }
  function pick (video) {
    if (video === true) return cameras[0]
    if (video.deviceId) {
      const want = video.deviceId.exact || video.deviceId.ideal
      const found = cameras.filter((c) => c.deviceId === want)[0]
      if (found) return found
      return video.deviceId.exact ? null : cameras[0]
    }
    if (video.facingMode) {
      const want = video.facingMode.exact || video.facingMode.ideal
      const found = cameras.filter((c) => c.facing === want)[0]
      if (found) return found
      return video.facingMode.exact ? null : cameras[0]
    }
    return cameras[0]
  }
  const md = {
    getUserMedia: (c) => {
      if (c.audio && !c.video) {
        const t = audioTrack()
        return Promise.resolve({ getAudioTracks: () => [t], getVideoTracks: () => [], getTracks: () => [t] })
      }
      requests.push(plain(c.video))
      const failName = o.fail ? o.fail(plain(c.video), requests.length) : null
      if (failName) return Promise.reject(domError(failName))
      const cam = pick(c.video)
      if (!cam) return Promise.reject(domError('OverconstrainedError'))
      const n = requests.length
      const open = () => {
        const t = videoTrack(cam)
        live.push(t)
        return { getAudioTracks: () => [], getVideoTracks: () => [t], getTracks: () => [t] }
      }
      if (o.manual && o.manual(plain(c.video), n)) {
        return new Promise((resolve, reject) => {
          pending[n] = { answer: () => resolve(open()), refuse: (name) => reject(domError(name)) }
        })
      }
      if ((o.hang && live.length) || (o.stall && o.stall(plain(c.video), n))) return new Promise(noop)
      if (o.hold && live.length) return new Promise((resolve) => held.push(() => resolve(open())))
      if (o.busy && live.length) return Promise.reject(domError('NotReadableError'))
      return Promise.resolve(open())
    },
    enumerateDevices: () => Promise.resolve(cameras.map((c) => ({ kind: 'videoinput', deviceId: c.deviceId, label: c.label || '' })).concat([{ kind: 'audioinput', deviceId: 'mic', label: '' }])),
    addEventListener: (type, fn) => {
      if (type === 'devicechange') deviceListeners.push(fn)
    },
    removeEventListener: (type, fn) => {
      const i = deviceListeners.indexOf(fn)
      if (type === 'devicechange' && i >= 0) deviceListeners.splice(i, 1)
    }
  }
  class FakePC {
    constructor () {
      this.signalingState = 'stable'
      this.connectionState = 'new'
    }

    addTrack (track) {
      return { track, replaceTrack: () => Promise.resolve() }
    }

    getTransceivers () {
      return []
    }

    getSenders () {
      return []
    }

    close () {
      this.signalingState = 'closed'
    }
  }
  function FakeSender () {}
  FakeSender.prototype.replaceTrack = noop
  const win = {
    isSecureContext: true,
    addEventListener: noop,
    removeEventListener: noop,
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    clearTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop,
    console: { log: noop, warn: noop, error: noop }
  }
  win.window = win
  win.navigator = { mediaDevices: md }
  if (o.permission) win.navigator.permissions = { query: () => Promise.resolve({ state: o.permission }) }
  win.document = { visibilityState: 'visible', documentElement: { lang: 'tr' }, addEventListener: noop, removeEventListener: noop }
  win.RTCPeerConnection = FakePC
  win.RTCRtpSender = FakeSender
  win.MediaStream = function (list) {
    this.list = list
    this.id = 's' + (++serial)
  }
  vm.createContext(win)
  vm.runInContext(VOICE, win, { filename: 'voice.js' })
  const voice = win.VoiceClient.create({
    api: (method, url, body) => {
      posts.push({ url, body: plain(body || {}) })
      if (url === '/api/voice/join') return Promise.resolve({ status: 200, data: { ok: true, peerId: 'peerA', members: [], iceServers: [] } })
      return Promise.resolve({ status: 200, data: { ok: true } })
    },
    seal: (obj) => '1.' + KID + '.nonce.' + b64(obj),
    open: () => ({ ok: false }),
    storage: null
  })
  voice.handleMeta({ voice: {} }, { id: '1' })
  const cam = () => voice.snapshot().camera
  const cameraPosts = () => posts.filter((p) => p.url === '/api/voice/camera').map((p) => p.body.on)
  const fire = (ms) => {
    const due = timers.filter((t) => t.ms === ms)
    due.forEach((t) => timers.splice(timers.indexOf(t), 1))
    due.forEach((t) => t.fn())
  }
  const answer = (n) => pending[n].answer()
  const refuse = (n, name) => pending[n].refuse(name)
  return { voice, requests, live, cam, cameraPosts, deviceListeners, fire, answer, refuse, utils: win.VoiceClient.cameraUtils }
}

const PHONE = [
  { deviceId: 'front', facing: 'user', label: 'camera2 1, facing front' },
  { deviceId: 'back', facing: 'environment', label: 'camera2 0, facing back' }
]
const DESKTOP = [
  { deviceId: 'usb', label: 'USB Kamera' },
  { deviceId: 'dahili', label: 'Dahili Kamera' }
]

async function cameraOn (e) {
  await e.voice.join(ROOM)
  await e.voice.startCamera()
  await flush()
}

test('kamera ilk açılışta ön kamerayı ister, yön ve değiştirme seçeneği durumda görünür', async () => {
  const e = loadEngine({ cameras: [PHONE[1], PHONE[0]] })
  await cameraOn(e)
  assert.deepEqual(e.requests[0].facingMode, { ideal: 'user' })
  assert.equal(e.live.length, 1)
  assert.equal(e.live[0].cam.deviceId, 'front')
  const c = e.cam()
  assert.equal(c.state, 'on')
  assert.equal(c.facing, 'user')
  assert.equal(c.canSwitch, true)
  assert.equal(c.switching, false)
  assert.equal(e.deviceListeners.length, 1, 'kamera açıkken cihaz değişimi dinlenir')
  e.voice.stopCamera()
  const off = plain(e.cam())
  assert.deepEqual([off.state, off.facing, off.canSwitch, off.switching], ['off', null, false, false])
  assert.equal(e.deviceListeners.length, 0)
})

test('telefonda Çevir arka kameraya geçer, eski kamera bırakılır, kapatıp açınca arka kamera hatırlanır', async () => {
  const e = loadEngine({ cameras: PHONE })
  await cameraOn(e)
  const before = e.cam().preview
  const oldTrack = e.live[0]
  const job = e.voice.switchCamera()
  assert.equal(e.cam().switching, true)
  assert.equal(e.voice.switchCamera(), job, 'süren değiştirme yeniden başlatılmaz')
  await job
  await flush()
  assert.deepEqual(e.requests[1].facingMode, { exact: 'environment' })
  assert.equal(oldTrack.readyState, 'ended')
  assert.equal(oldTrack.listenerCount('ended'), 0)
  assert.deepEqual(e.live.map((t) => t.cam.deviceId), ['back'])
  const c = e.cam()
  assert.equal(c.state, 'on')
  assert.equal(c.facing, 'environment')
  assert.equal(c.switching, false)
  assert.notEqual(c.preview, before, 'önizleme yeni akışa geçer')
  assert.deepEqual(e.cameraPosts(), [true], 'değiştirme sunucuya kamera açık bilgisini yeniden göndermez')
  // Geri çevirme ön kameraya döner
  await e.voice.switchCamera()
  assert.deepEqual(e.requests[2].facingMode, { exact: 'user' })
  assert.equal(e.cam().facing, 'user')
  await e.voice.switchCamera()
  e.voice.stopCamera()
  await e.voice.startCamera()
  assert.deepEqual(e.requests[e.requests.length - 1].facingMode, { ideal: 'environment' })
  assert.equal(e.cam().facing, 'environment')
})

test('aynı anda iki kamerayı açamayan cihazda eski kamera bırakılıp yeniden denenir', async () => {
  const e = loadEngine({ cameras: PHONE, busy: true })
  await cameraOn(e)
  const oldTrack = e.live[0]
  await e.voice.switchCamera()
  assert.equal(e.requests.length, 3)
  assert.deepEqual(e.requests[1].facingMode, { exact: 'environment' })
  assert.deepEqual(e.requests[2].facingMode, { exact: 'environment' })
  assert.equal(oldTrack.readyState, 'ended')
  assert.deepEqual(e.live.map((t) => t.cam.deviceId), ['back'])
  assert.equal(e.cam().facing, 'environment')
  // Cihaz iki kamerayı açamadığını bildirdi: sonraki geçişte eski kamera baştan bırakılır, tek istek gider
  const before = e.requests.length
  await e.voice.switchCamera()
  assert.equal(e.requests.length, before + 1)
  assert.deepEqual(e.live.map((t) => t.cam.deviceId), ['front'])
})

test('ikinci isteği eski kamera bırakılana kadar bekleten telefonda 2,5 saniye sonra eski kamera bırakılır, bekleyen istek kullanılır', async () => {
  const e = loadEngine({ cameras: PHONE, hold: true })
  await cameraOn(e)
  const waits = e.utils.switchWaits
  assert.ok(waits.first > 0 && waits.first < waits.open && waits.open < waits.prompt)
  const oldTrack = e.live[0]
  const job = e.voice.switchCamera()
  await flush()
  assert.equal(e.cam().switching, true)
  assert.equal(oldTrack.readyState, 'live', 'süre dolmadan eski kamera bırakılmaz')
  e.fire(waits.first)
  await job
  assert.equal(e.requests.length, 2, 'ikinci istek gönderilmez, bekleyen istek kullanılır')
  assert.equal(oldTrack.readyState, 'ended')
  assert.deepEqual(e.live.map((t) => t.cam.deviceId), ['back'])
  assert.equal(e.cam().switching, false)
  assert.equal(e.cam().facing, 'environment')
  // Süre dolması cihazı "iki kamera açamaz" diye işaretlemez: geri dönüşte yine önce eski kamera açıkken istenir
  const back = e.live[0]
  const job2 = e.voice.switchCamera()
  await flush()
  assert.equal(back.readyState, 'live')
  e.fire(waits.first)
  await job2
  assert.deepEqual(e.live.map((t) => t.cam.deviceId), ['front'])
  assert.equal(e.requests.length, 3)
})

test('kamera bırakıldıktan sonra da yanıtlanmayan isteğin yanına ikinci istek gönderilir, önce gelen kullanılır', async () => {
  const e = loadEngine({ cameras: PHONE, hang: true })
  await cameraOn(e)
  const waits = e.utils.switchWaits
  const oldTrack = e.live[0]
  const job = e.voice.switchCamera()
  await flush()
  e.fire(waits.first)
  await flush()
  assert.equal(oldTrack.readyState, 'ended', 'eski kamera bırakıldı')
  assert.equal(e.requests.length, 2, 'bırakılınca önce aynı istek beklenir')
  e.fire(waits.first)
  await job
  assert.equal(e.requests.length, 3)
  assert.deepEqual(e.live.map((t) => t.cam.deviceId), ['back'])
  assert.equal(e.cam().switching, false)
})

test('ikinci istek kazanınca sonradan gelen ilk istek durdurulur, ilk istek kazanınca ikinci durdurulur', async () => {
  const e = loadEngine({ cameras: PHONE, manual: (v, n) => n === 2 })
  await cameraOn(e)
  const waits = e.utils.switchWaits
  const job = e.voice.switchCamera()
  await flush()
  e.fire(waits.first)
  await flush()
  e.fire(waits.first)
  await job
  assert.equal(e.requests.length, 3)
  const winner = e.live[0]
  e.answer(2)
  await flush()
  assert.deepEqual(e.live, [winner], 'geç gelen ilk akış durduruldu')
  assert.equal(e.cam().facing, 'environment')

  const f = loadEngine({ cameras: PHONE, manual: (v, n) => n === 2 || n === 3 })
  await cameraOn(f)
  const job2 = f.voice.switchCamera()
  await flush()
  f.fire(waits.first)
  await flush()
  f.fire(waits.first)
  await flush()
  f.answer(2)
  await job2
  const first = f.live[0]
  f.answer(3)
  await flush()
  assert.deepEqual(f.live, [first], 'geç gelen ikinci akış durduruldu')

  // İki istek aynı anda yanıtlanırsa biri kullanılır, öteki durdurulur
  const g = loadEngine({ cameras: PHONE, manual: (v, n) => n === 2 || n === 3 })
  await cameraOn(g)
  const job3 = g.voice.switchCamera()
  await flush()
  g.fire(waits.first)
  await flush()
  g.fire(waits.first)
  await flush()
  g.answer(2)
  g.answer(3)
  await job3
  await flush()
  assert.equal(g.live.length, 1, 'aynı anda gelen ikinci akış durduruldu')
  assert.equal(g.cam().facing, 'environment')
})

test('2,5 saniyelik bekleme sırasında kamera kapatılırsa yeni istek gönderilmez, geç gelen akış durdurulur', async () => {
  const e = loadEngine({ cameras: PHONE, manual: (v, n) => n === 2 })
  await cameraOn(e)
  const waits = e.utils.switchWaits
  const job = e.voice.switchCamera()
  const caught = job.catch((err) => err)
  await flush()
  e.voice.stopCamera()
  e.fire(waits.first)
  const err = await caught
  assert.equal(err.code, 'cancelled')
  assert.equal(e.requests.length, 2, 'kapatıldıktan sonra kamera yeniden istenmez')
  e.answer(2)
  await flush()
  assert.deepEqual(e.live, [])
  assert.equal(e.cam().state, 'off')

  // Akış süre dolduğu anda gelir ve kamera aynı anda kapatılırsa da durdurulur
  const f = loadEngine({ cameras: PHONE, manual: (v, n) => n === 2 })
  await cameraOn(f)
  const job2 = f.voice.switchCamera()
  const caught2 = job2.catch((err) => err)
  await flush()
  f.fire(waits.first)
  f.answer(2)
  f.voice.stopCamera()
  assert.equal((await caught2).code, 'cancelled')
  await flush()
  assert.deepEqual(f.live, [])
  assert.equal(f.requests.length, 2)
})

test('tarayıcı izin soruyorsa eski kamera kesilmez, kişinin yanıtı beklenir ve tek istek gider', async () => {
  const e = loadEngine({ cameras: PHONE, permission: 'prompt', manual: (v, n) => n === 2 })
  await cameraOn(e)
  const waits = e.utils.switchWaits
  const oldTrack = e.live[0]
  const job = e.voice.switchCamera()
  await flush()
  e.fire(waits.first)
  await flush()
  assert.equal(oldTrack.readyState, 'live', '2,5 saniyede eski kamera bırakılmaz')
  e.answer(2)
  await job
  assert.equal(e.requests.length, 2, 'ikinci izin penceresi açılmaz')
  assert.equal(oldTrack.readyState, 'ended')
  assert.deepEqual(e.live.map((t) => t.cam.deviceId), ['back'])

  // Kişi hiç yanıt vermezse süre dolunca eski kamera sürer, geç gelen akış durdurulur
  const f = loadEngine({ cameras: PHONE, permission: 'prompt', manual: (v, n) => n === 2 })
  await cameraOn(f)
  const keep = f.live[0]
  const job2 = f.voice.switchCamera()
  const caught = job2.catch((err) => err)
  await flush()
  f.fire(waits.prompt)
  const err = await caught
  assert.equal(err.code, 'camera_failed')
  assert.equal(keep.readyState, 'live')
  assert.equal(f.cam().state, 'on')
  assert.equal(f.cam().switching, false)
  f.answer(2)
  await flush()
  assert.deepEqual(f.live, [keep])
})

test('yön bildirmeyen bilgisayar kamerasında yanıtsız istek izin penceresi sayılır: eski kamera kesilmez, ikinci istek gitmez', async () => {
  // Firefox izni kamera başına sorar ama izin sorgusu 'granted' döner
  const e = loadEngine({ cameras: DESKTOP, permission: 'granted', manual: (v, n) => n === 2 })
  await cameraOn(e)
  const waits = e.utils.switchWaits
  const oldTrack = e.live[0]
  const job = e.voice.switchCamera()
  await flush()
  e.fire(waits.first)
  await flush()
  e.fire(waits.first)
  await flush()
  assert.equal(oldTrack.readyState, 'live')
  assert.equal(e.requests.length, 2)
  e.answer(2)
  await job
  assert.equal(oldTrack.readyState, 'ended')
  assert.deepEqual(e.live.map((t) => t.cam.deviceId), ['dahili'])

  // Kişi geç reddederse eski kamera sürer, izin reddi bildirilir
  const f = loadEngine({ cameras: DESKTOP, permission: 'granted', manual: (v, n) => n === 2 })
  await cameraOn(f)
  const keep = f.live[0]
  const job2 = f.voice.switchCamera()
  const caught = job2.catch((err) => err)
  await flush()
  f.fire(waits.first)
  await flush()
  f.refuse(2, 'NotAllowedError')
  assert.equal((await caught).code, 'camera_denied')
  assert.equal(keep.readyState, 'live')
  assert.equal(f.cam().state, 'on')
})

test('eski kamera bırakıldıktan sonra izin reddedilir ve eski kamera da açılamazsa kişi izin reddini görür', async () => {
  const e = loadEngine({ cameras: PHONE, manual: (v, n) => n === 2, fail: (v, n) => (n >= 3 ? 'NotAllowedError' : null) })
  await cameraOn(e)
  const waits = e.utils.switchWaits
  const job = e.voice.switchCamera()
  const caught = job.catch((err) => err)
  await flush()
  e.fire(waits.first)
  await flush()
  e.refuse(2, 'NotAllowedError')
  assert.equal((await caught).code, 'cancelled')
  assert.equal(e.cam().state, 'off')
  assert.equal(e.cam().errorCode, 'camera_denied')
})

test('hedef kamerayı başka uygulama kullandığı için gelen NotReadableError cihazı "iki kamera açamaz" yapmaz', async () => {
  let busy = true
  const e = loadEngine({
    cameras: DESKTOP,
    fail: (v) => (busy && v.deviceId && v.deviceId.exact === 'dahili' ? 'NotReadableError' : null),
    manual: (v, n) => n === 5
  })
  await cameraOn(e)
  await assert.rejects(e.voice.switchCamera(), (err) => err.code === 'camera_in_use')
  await flush()
  assert.deepEqual(e.live.map((t) => t.cam.deviceId), ['usb'])
  assert.equal(e.requests.length, 4, 'eski kamera açıkken, bırakıldıktan sonra ve geri açılırken')
  busy = false
  const usb = e.live[0]
  const job = e.voice.switchCamera()
  await flush()
  assert.equal(e.requests.length, 5)
  assert.equal(usb.readyState, 'live', 'yeni kamera eski kamera açıkken istenir')
  e.answer(5)
  await job
  assert.deepEqual(e.live.map((t) => t.cam.deviceId), ['dahili'])
})

test('kamera bırakıldıktan sonra da hiçbir istek yanıtlanmazsa değiştirme süre dolunca biter, kamera kapanır', async () => {
  const e = loadEngine({ cameras: PHONE, stall: (v, n) => n >= 2 })
  await cameraOn(e)
  const waits = e.utils.switchWaits
  const job = e.voice.switchCamera()
  const caught = job.catch((err) => err)
  await flush()
  e.fire(waits.first)
  await flush()
  assert.deepEqual(e.live, [], 'eski kamera bırakıldı')
  e.fire(waits.first)
  await flush()
  assert.equal(e.requests.length, 3, 'ikinci istek gönderildi')
  assert.equal(e.cam().switching, true)
  // İki isteğin de süresi dolar, eski kamera yeniden istenir, onun da süresi dolar
  e.fire(waits.open)
  await flush()
  e.fire(waits.open)
  const err = await caught
  assert.equal(err.code, 'cancelled')
  assert.equal(e.cam().state, 'off')
  assert.equal(e.cam().switching, false)
  assert.equal(e.cam().errorCode, 'camera_lost')
})

test('yön bildirmeyen bilgisayarda Çevir sıradaki kameraya geçer, yön bilinmediği için ayna kalır', async () => {
  const e = loadEngine({ cameras: DESKTOP })
  await cameraOn(e)
  assert.equal(e.cam().facing, null)
  assert.equal(e.cam().canSwitch, true)
  await e.voice.switchCamera()
  assert.deepEqual(e.requests[1].deviceId, { exact: 'dahili' })
  assert.deepEqual(e.live.map((t) => t.cam.deviceId), ['dahili'])
  await e.voice.switchCamera()
  assert.deepEqual(e.requests[2].deviceId, { exact: 'usb' })
  e.voice.stopCamera()
  await e.voice.startCamera()
  assert.deepEqual(e.requests[3].deviceId, { ideal: 'usb' })
})

test('tek kameralı cihazda Çevir görünmez, denenirse eski kamera sürer ve çıkarılınca kamera kapanır', async () => {
  const e = loadEngine({ cameras: [PHONE[0]] })
  await cameraOn(e)
  assert.equal(e.cam().canSwitch, false)
  const track = e.live[0]
  await assert.rejects(e.voice.switchCamera(), (err) => err.code === 'camera_not_found')
  assert.equal(track.readyState, 'live')
  assert.equal(e.cam().state, 'on')
  assert.equal(e.cam().switching, false)
  assert.equal(track.listenerCount('ended'), 1, 'çıkarılma dinlemesi geri takılır')
  track.unplug()
  await flush()
  assert.equal(e.cam().state, 'off')
  assert.equal(e.cam().errorCode, 'camera_lost')
  assert.deepEqual(e.cameraPosts(), [true, false])
})

test('eski kamera bırakıldıktan sonra yeni kamera açılamazsa eski kamera yeniden açılır', async () => {
  const e = loadEngine({ cameras: PHONE, busy: true, fail: (v) => (v.facingMode && v.facingMode.exact === 'environment' && !v.deviceId ? 'NotReadableError' : null) })
  await cameraOn(e)
  await assert.rejects(e.voice.switchCamera(), (err) => err.code === 'camera_in_use')
  const last = e.requests[e.requests.length - 1]
  assert.deepEqual(last.deviceId, { ideal: 'front' })
  assert.deepEqual(e.live.map((t) => t.cam.deviceId), ['front'])
  assert.equal(e.cam().state, 'on')
  assert.equal(e.cam().facing, 'user')
  assert.equal(e.cam().errorCode, null)
})

test('eski kamera da yeniden açılamazsa kamera kapanır, hata camera_lost olarak bildirilir', async () => {
  const e = loadEngine({ cameras: PHONE, busy: true, fail: (v, n) => (n >= 2 ? 'NotReadableError' : null) })
  await cameraOn(e)
  await assert.rejects(e.voice.switchCamera(), (err) => err.code === 'cancelled')
  assert.equal(e.cam().state, 'off')
  assert.equal(e.cam().errorCode, 'camera_lost')
  assert.deepEqual(e.live, [])
  assert.deepEqual(e.cameraPosts(), [true, false])
})

test('değiştirme sürerken kamera kapatılırsa yeni kamera bırakılır', async () => {
  const e = loadEngine({ cameras: PHONE })
  await cameraOn(e)
  const job = e.voice.switchCamera()
  e.voice.stopCamera()
  await assert.rejects(job, (err) => err.code === 'cancelled')
  await flush()
  assert.deepEqual(e.live, [])
  assert.equal(e.cam().state, 'off')
})

test('kamera yönü ve değiştirme seçenekleri saf yardımcılarla belirlenir', () => {
  const u = loadEngine({ cameras: PHONE }).utils
  assert.equal(u.facingOf({ facingMode: 'environment' }, null, ''), 'environment')
  assert.equal(u.facingOf({ facingMode: 'left' }, { facingMode: ['user'] }, ''), 'user')
  assert.equal(u.facingOf({}, { facingMode: ['user', 'environment'] }, 'camera2 0, facing back'), 'environment')
  assert.equal(u.facingOf(null, null, 'Front Camera'), 'user')
  assert.equal(u.facingOf(null, null, 'Integrated Webcam'), null)
  assert.equal(u.facingOf(null, null, 'Feedback Cam'), null, 'sözcük sınırı: "back" geçen başka ad sayılmaz')
  assert.deepEqual(plain(u.switchTargets('user', 'a', ['a', 'b'])), [{ facing: 'environment', exact: true }, { deviceId: 'b', exact: true }])
  assert.deepEqual(plain(u.switchTargets('environment', 'b', ['b'])), [{ facing: 'user', exact: true }])
  assert.deepEqual(plain(u.switchTargets(null, 'c', ['a', 'b', 'c'])), [{ deviceId: 'a', exact: true }])
  assert.deepEqual(plain(u.switchTargets(null, null, ['a', 'b'])), [{ deviceId: 'a', exact: true }])
  assert.deepEqual(plain(u.switchTargets(null, 'a', ['a', '', 7])), [])
  assert.deepEqual(plain(u.constraints({ facing: 'environment', exact: true }).video.facingMode), { exact: 'environment' })
  assert.deepEqual(plain(u.constraints({ deviceId: 'x' }).video.deviceId), { ideal: 'x' })
  assert.equal(u.constraints({ deviceId: 'x' }).video.facingMode, undefined)
  assert.deepEqual(plain(u.constraints({ facing: 'sideways' }).video.facingMode), { ideal: 'user' })
})
