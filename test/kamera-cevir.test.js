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
// facingMode veya deviceId'ye göre kamera seçer. busy: aynı anda yalnızca bir kamera açılabilir
// (NotReadableError). fail(c): bu istek için hata adı döndürürse istek o hatayla reddedilir.
function loadEngine (opts) {
  const o = opts || {}
  const cameras = o.cameras
  const requests = []
  const posts = []
  const live = []
  const deviceListeners = []
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
        track.readyState = 'ended'
        const i = live.indexOf(track)
        if (i >= 0) live.splice(i, 1)
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
      if (o.busy && live.length) return Promise.reject(domError('NotReadableError'))
      const t = videoTrack(cam)
      live.push(t)
      return Promise.resolve({ getAudioTracks: () => [], getVideoTracks: () => [t], getTracks: () => [t] })
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
    setTimeout: () => 0,
    clearTimeout: noop,
    setInterval: () => 0,
    clearInterval: noop,
    console: { log: noop, warn: noop, error: noop }
  }
  win.window = win
  win.navigator = { mediaDevices: md }
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
  return { voice, requests, live, cam, cameraPosts, deviceListeners, utils: win.VoiceClient.cameraUtils }
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
