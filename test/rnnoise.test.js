'use strict'

// Gelişmiş gürültü engelleme (RNNoise) testleri:
// 1. public/vendor/rnnoise/ altındaki üçüncü taraf dosyaların sha256 değerleri ve denetleyicideki kayıtları.
//    Kaynak: @shiguredo/rnnoise-wasm 2022.2.0 npm paketi (Apache-2.0), dist/rnnoise.wasm. Paketin belgesine
//    göre wasm dosyasının lisansı RNNoise'un BSD-3-Clause lisansıdır (shiguredo/rnnoise 2022.1.0 COPYING).
// 2. wasm dosyasının public/rnnoise-worklet.js içindeki küçük yapıştırıcının beklediği içe ve dışa aktarımları.
// 3. AudioWorklet işlemcisi (public/rnnoise-worklet.js) Node vm bağlamında gerçek wasm ile: hazır iletisi,
//    blok uzunluğu, gecikme, tıkırtı ve gürültü bastırma, 44,1 kHz bağlamda yeniden örnekleme, hata
//    durumlarında girişin olduğu gibi geçmesi ve kapatma.
// 4. voice.js mikrofon hattı sahte WebAudio ile: varsayılan ayar, düğümün yalnızca hazır olunca ses koluna
//    girmesi, algılama kolunun ham kaynakta kalması, getUserMedia kısıtlarının (tarayıcının gürültü
//    bastırması dahil) değişmemesi, modül, wasm veya işlemci hatasında ve zaman aşımında sesin kesilmeden
//    tarayıcının işlemesine dönmesi, ayarın kapatılıp açılması ve cihaz değişimi.
// Gerçek tarayıcıdaki davranış e2e/13-gurultu-engelleme.test.js ile Chromium'da sınanır.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const denetle = require('../scripts/denetle')

const ROOT = path.join(__dirname, '..')
const PUB = path.join(ROOT, 'public')
const WORKLET = fs.readFileSync(path.join(PUB, 'rnnoise-worklet.js'), 'utf8')
const VOICE = fs.readFileSync(path.join(PUB, 'voice.js'), 'utf8')
const WASM_PATH = path.join(PUB, 'vendor', 'rnnoise', 'rnnoise.wasm')

const VENDOR = {
  'public/vendor/rnnoise/rnnoise.wasm': '8b60a2ab88fdae2d1a9f940249d0eb072f28ba8e796f7304347b4e07839c8853',
  'public/vendor/rnnoise/RNNOISE-LICENSE.txt': 'd597473329bdc1807197a303be09e79882159ea858daa9f06ce780592877534e',
  'public/vendor/rnnoise/RNNOISE-WASM-LICENSE.txt': 'a6cba85bc92e0cff7a450b1d873c0eaa2e9fc96bf472df0247a26bec77bf3ff9'
}

function sha256 (buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function wasmBytes () {
  const buf = fs.readFileSync(WASM_PATH)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

function noop () {}

function flush () {
  return new Promise((resolve) => setImmediate(resolve))
}

test('üçüncü taraf dosyalar: sha256 değerleri, klasör içeriği ve denetleyici kaydı', () => {
  for (const rel of Object.keys(VENDOR)) {
    assert.equal(sha256(fs.readFileSync(path.join(ROOT, ...rel.split('/')))), VENDOR[rel], rel)
    const entry = denetle.VENDOR_FILES.find((item) => item.path === rel)
    assert.ok(entry, 'denetleyicide kayıt: ' + rel)
    assert.equal(entry.sha256, VENDOR[rel], rel)
    assert.equal(entry.required, true, rel)
  }
  assert.deepEqual(fs.readdirSync(path.join(PUB, 'vendor', 'rnnoise')).sort(), ['RNNOISE-LICENSE.txt', 'RNNOISE-WASM-LICENSE.txt', 'rnnoise.wasm'])
  const bsd = fs.readFileSync(path.join(PUB, 'vendor', 'rnnoise', 'RNNOISE-LICENSE.txt'), 'utf8')
  assert.match(bsd, /Copyright \(c\) 2017, Mozilla/)
  assert.match(bsd, /Xiph\.Org Foundation/)
  assert.match(bsd, /Redistributions in binary form must reproduce/)
  const apache = fs.readFileSync(path.join(PUB, 'vendor', 'rnnoise', 'RNNOISE-WASM-LICENSE.txt'), 'utf8')
  assert.match(apache, /Apache License\s+Version 2\.0, January 2004/)
})

test('wasm: yapıştırıcının karşıladığı üç içe aktarım ve kullanılan dışa aktarımlar', () => {
  const mod = new WebAssembly.Module(fs.readFileSync(WASM_PATH))
  const imports = WebAssembly.Module.imports(mod).map((i) => i.module + '.' + i.name + ':' + i.kind).sort()
  assert.deepEqual(imports, ['env.__assert_fail:function', 'env.emscripten_memcpy_big:function', 'env.emscripten_resize_heap:function'])
  const exports = new Set(WebAssembly.Module.exports(mod).map((e) => e.name))
  for (const name of ['memory', '__wasm_call_ctors', 'emscripten_stack_init', 'rnnoise_get_frame_size', 'rnnoise_create', 'rnnoise_destroy', 'rnnoise_process_frame', 'malloc', 'free']) {
    assert.ok(exports.has(name), name)
  }
})

// AudioWorklet işlemcisi

function loadWorklet (rate, wasmApi) {
  const registered = {}
  class AudioWorkletProcessor {
    constructor () {
      this.port = { messages: [], postMessage (m) { this.messages.push(m) }, onmessage: null }
    }
  }
  const context = {
    AudioWorkletProcessor,
    registerProcessor: (name, ctor) => { registered[name] = ctor },
    sampleRate: rate,
    WebAssembly: wasmApi || WebAssembly
  }
  vm.createContext(context)
  vm.runInContext(WORKLET, context, { filename: 'rnnoise-worklet.js' })
  return registered
}

// İşlemciyi kurar ve ilk iletisini (hazır veya hata) bekler
async function makeProcessor (rate, bytes, wasmApi) {
  const registered = loadWorklet(rate, wasmApi)
  assert.deepEqual(Object.keys(registered), ['telsiz-rnnoise'])
  const P = registered['telsiz-rnnoise']
  const proc = new P({ processorOptions: { wasm: bytes } })
  const end = Date.now() + 5000
  while (proc.port.messages.length === 0 && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 5))
  return proc
}

// Bloklar halinde işler, çıkışı döner
function runBlocks (proc, input, block) {
  const n = block || 128
  const out = new Float32Array(input.length)
  let i = 0
  while (i + n <= input.length) {
    const o = new Float32Array(n)
    const keep = proc.process([[input.subarray(i, i + n)]], [[o]])
    assert.equal(keep, true)
    out.set(o, i)
    i += n
  }
  return out
}

function rms (a, from, to) {
  let s = 0
  let i = from
  while (i < to) {
    s += a[i] * a[i]
    i++
  }
  return Math.sqrt(s / Math.max(1, to - from))
}

function db (x) {
  return 20 * Math.log10(x)
}

function rng (seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

// Sentetik sinyal (verilen hızda): 0-2 sn klavye tıkırtıları ve pembe benzeri gürültü, 2-4 sn konuşmaya benzer
// ünlü dizisi (darbe dizisi ve biçimlendirici süzgeçler) ve aynı gürültü
function makeSignal (rate) {
  const rand = rng(7)
  const n = 4 * rate
  const clicks = new Float32Array(n)
  const speech = new Float32Array(n)
  const noise = new Float32Array(n)
  const bandpass = (f0, q) => {
    const w = 2 * Math.PI * f0 / rate
    const alpha = Math.sin(w) / (2 * q)
    const a0 = 1 + alpha
    const a1 = -2 * Math.cos(w)
    const a2 = 1 - alpha
    let x1 = 0
    let x2 = 0
    let y1 = 0
    let y2 = 0
    return (x) => {
      const y = (alpha * x - alpha * x2 - a1 * y1 - a2 * y2) / a0
      x2 = x1
      x1 = x
      y2 = y1
      y1 = y
      return y
    }
  }
  let at = Math.round(0.1 * rate)
  while (at < 1.9 * rate) {
    const bp = bandpass(3000 + rand() * 2500, 2)
    const thud = bandpass(300, 3)
    let i = 0
    while (i < 0.012 * rate) {
      const w = rand() * 2 - 1
      clicks[at + i] += 0.35 * Math.exp(-i / (0.0018 * rate)) * (bp(w) * 3 + thud(w) * 1.5)
      i++
    }
    at += Math.round((0.1 + rand() * 0.1) * rate)
  }
  const vowels = [[730, 1090, 2440], [270, 2290, 3010], [530, 1840, 2480], [570, 840, 2410]]
  let t = 2 * rate
  let syl = 0
  let phase = 0
  const len = Math.round(0.22 * rate)
  while (t + len < 4 * rate) {
    const filters = vowels[syl % vowels.length].map((f, k) => bandpass(f, 6 + k * 2))
    let i = 0
    while (i < len) {
      phase += (120 + 25 * Math.sin(syl)) / rate
      let pulse = 0
      if (phase >= 1) {
        phase -= 1
        pulse = 1
      }
      const exc = pulse + (rand() * 2 - 1) * 0.02
      speech[t + i] = (filters[0](exc) + 0.6 * filters[1](exc) + 0.3 * filters[2](exc)) * Math.sin(Math.PI * i / len)
      i++
    }
    t += len + Math.round(0.06 * rate)
    syl++
  }
  let peak = 0
  speech.forEach((x) => { peak = Math.max(peak, Math.abs(x)) })
  speech.forEach((x, i) => { speech[i] = x * 0.3 / peak })
  let b0 = 0
  let b1 = 0
  let i = 0
  while (i < n) {
    const w = rand() * 2 - 1
    b0 = 0.99765 * b0 + w * 0.099046
    b1 = 0.963 * b1 + w * 0.2965164
    noise[i] = (b0 + b1 + w * 0.1848) * 0.004
    i++
  }
  const mix = new Float32Array(n)
  i = 0
  while (i < n) {
    mix[i] = clicks[i] + speech[i] + noise[i]
    i++
  }
  return { mix, speech }
}

// Sinyali başka bir hıza çevirir (doğrusal ara değerleme). Aynı içerik her hızda sınanır, tıkırtıların rastgele
// biçimi hıza göre değişmez.
function resample (a, from, to) {
  const n = Math.floor(a.length * to / from)
  const out = new Float32Array(n)
  let i = 0
  while (i < n) {
    const q = i * from / to
    const k = Math.floor(q)
    const f = q - k
    out[i] = (a[k] || 0) * (1 - f) + (a[k + 1] || 0) * f
    i++
  }
  return out
}

// Çıkışın girişe göre gecikmesi (konuşma bölümünde çapraz ilinti)
function lagOf (out, speech, rate) {
  let best = -Infinity
  let lag = 0
  let d = 0
  while (d < 1500) {
    let c = 0
    let i = Math.round(2.3 * rate)
    const end = Math.round(3.3 * rate)
    while (i < end) {
      c += out[i + d] * speech[i]
      i += 2
    }
    if (c > best) {
      best = c
      lag = d
    }
    d++
  }
  return lag
}

test('işlemci 48 kHz: hazır iletisi, 128 örneklik blok, yaklaşık 20 ms gecikme, tıkırtı ve gürültü bastırma', async () => {
  const rate = 48000
  const proc = await makeProcessor(rate, wasmBytes())
  assert.deepEqual(JSON.parse(JSON.stringify(proc.port.messages)), [{ type: 'ready', sampleRate: 48000 }])
  const sig = makeSignal(rate)
  const out = runBlocks(proc, sig.mix)
  assert.ok(out.every((x) => Number.isFinite(x)), 'çıkışta NaN veya sonsuz yok')
  // Çerçeve tamponu (480 + 16 örnek), RNNoise'un kendi çerçevesi (480 örnek) ve iki çeviricinin birer örneği
  const lag = lagOf(out, sig.speech, rate)
  assert.ok(lag >= 960 && lag <= 1000, 'gecikme ' + lag)
  const clicksIn = rms(sig.mix, Math.round(0.3 * rate), Math.round(1.8 * rate))
  const clicksOut = rms(out, Math.round(0.3 * rate) + lag, Math.round(1.8 * rate) + lag)
  assert.ok(db(clicksOut / clicksIn) < -15, 'tıkırtılar en az 15 dB azalır: ' + db(clicksOut / clicksIn).toFixed(1))
  const speechIn = rms(sig.speech, Math.round(2.2 * rate), Math.round(3.8 * rate))
  const speechOut = rms(out, Math.round(2.2 * rate) + lag, Math.round(3.8 * rate) + lag)
  assert.ok(Math.abs(db(speechOut / speechIn)) < 3, 'konuşma seviyesi 3 dB içinde kalır: ' + db(speechOut / speechIn).toFixed(1))
  proc.port.onmessage({ data: 'destroy' })
  assert.equal(proc.process([[new Float32Array(128)]], [[new Float32Array(128)]]), false)
})

test('işlemci 44,1 kHz bağlamda 48 kHz\'e çevirip geri çevirir, kuyruk boşalmaz ve büyümez', async () => {
  const rate = 44100
  const proc = await makeProcessor(rate, wasmBytes())
  assert.equal(proc.port.messages[0].type, 'ready')
  assert.equal(proc.port.messages[0].sampleRate, 44100)
  const base = makeSignal(48000)
  const sig = { mix: resample(base.mix, 48000, rate), speech: resample(base.speech, 48000, rate) }
  const out = runBlocks(proc, sig.mix)
  assert.ok(out.every((x) => Number.isFinite(x)))
  const queued = proc.framer.queued()
  assert.ok(queued > 0 && queued < 1200, 'kuyruk ' + queued)
  const lag = lagOf(out, sig.speech, rate)
  assert.ok(lag >= 860 && lag <= 940, 'gecikme ' + lag)
  const clicksIn = rms(sig.mix, Math.round(0.3 * rate), Math.round(1.8 * rate))
  const clicksOut = rms(out, Math.round(0.3 * rate) + lag, Math.round(1.8 * rate) + lag)
  assert.ok(db(clicksOut / clicksIn) < -15, 'tıkırtılar: ' + db(clicksOut / clicksIn).toFixed(1))
  const speechIn = rms(sig.speech, Math.round(2.2 * rate), Math.round(3.8 * rate))
  const speechOut = rms(out, Math.round(2.2 * rate) + lag, Math.round(3.8 * rate) + lag)
  assert.ok(Math.abs(db(speechOut / speechIn)) < 3, 'konuşma: ' + db(speechOut / speechIn).toFixed(1))
})

test('işlemci: 48 kHz\'de çeviriciler örnekleri değiştirmez, giriş yokken sessizlik verir', async () => {
  // RNNoise yerine birim işlemle çerçeveleyici: çıkış, girişin sabit gecikmeli birebir kopyası olmalıdır
  const sandbox = { AudioWorkletProcessor: class {}, registerProcessor: noop, sampleRate: 48000, WebAssembly }
  vm.createContext(sandbox)
  const createFramer = vm.runInContext(WORKLET + '\ncreateFramer', sandbox)
  const identity = createFramer(48000, noop)
  const input = new Float32Array(4800).map((x, i) => Math.sin(i / 7) * 0.5)
  const out = new Float32Array(4800)
  let i = 0
  while (i < 4800) {
    const end = Math.min(4800, i + 128)
    identity.run(input.subarray(i, end), out.subarray(i, end))
    i = end
  }
  // Kuyruğun başlangıç dolgusu 496 örnek, yukarı çevirici bir, aşağı çevirici iki örnek
  const delay = 499
  let j = 0
  while (j < 4800) {
    assert.equal(out[j], j < delay ? 0 : input[j - delay], 'örnek ' + j)
    j++
  }
  const proc = await makeProcessor(48000, wasmBytes())
  const silent = new Float32Array(128).fill(1)
  assert.equal(proc.process([[]], [[silent]]), true)
  assert.ok(silent.every((x) => x === 0))
  assert.equal(proc.process([], [[]]), true)
})

test('işlemci hataları: wasm yok, bozuk wasm veya işleme hatası girişi olduğu gibi geçirir ve bildirir', async () => {
  const input = new Float32Array(128).map((x, i) => (i % 13) / 26)
  const passes = (proc) => {
    const o = new Float32Array(128)
    assert.equal(proc.process([[input]], [[o]]), true)
    assert.deepEqual(Array.from(o), Array.from(input))
  }
  const none = await makeProcessor(48000, null)
  assert.deepEqual(JSON.parse(JSON.stringify(none.port.messages)), [{ type: 'error', code: 'no_wasm' }])
  passes(none)
  const broken = await makeProcessor(48000, new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 5]).buffer)
  assert.deepEqual(JSON.parse(JSON.stringify(broken.port.messages)), [{ type: 'error', code: 'wasm' }])
  passes(broken)
  // Hazır olmadan önce de giriş geçer
  const registered = loadWorklet(48000, { instantiate: () => new Promise(noop) })
  const waiting = new registered['telsiz-rnnoise']({ processorOptions: { wasm: wasmBytes() } })
  passes(waiting)
  assert.deepEqual(waiting.port.messages, [])
  // İşlerken hata: wasm durum makinesi tuzağa düşerse işlemci kendini kapatır, ses geçmeye devam eder
  const real = await WebAssembly.instantiate(fs.readFileSync(WASM_PATH), {
    env: { emscripten_memcpy_big: noop, emscripten_resize_heap: () => 0, __assert_fail: noop }
  })
  const exportsCopy = Object.assign({}, real.instance.exports, { rnnoise_process_frame: () => { throw new Error('tuzak') } })
  const fake = { instantiate: () => Promise.resolve({ instance: { exports: exportsCopy } }) }
  const trapping = await makeProcessor(48000, wasmBytes(), fake)
  assert.equal(trapping.port.messages[0].type, 'ready')
  const big = new Float32Array(1024).map((x, i) => (i % 17) / 34)
  const outs = []
  let k = 0
  while (k < 1024) {
    const o = new Float32Array(128)
    trapping.process([[big.subarray(k, k + 128)]], [[o]])
    outs.push(o)
    k += 128
  }
  assert.deepEqual(JSON.parse(JSON.stringify(trapping.port.messages[1])), { type: 'error', code: 'process' })
  // Hatadan sonraki bloklar girişin birebir kopyasıdır
  assert.deepEqual(Array.from(outs[7]), Array.from(big.subarray(896, 1024)))
})

// voice.js mikrofon hattı (sahte WebAudio)

function makeClock () {
  let now = 1000000
  let seq = 0
  const timers = new Map()
  const add = (fn, ms, every) => {
    seq++
    timers.set(seq, { fn, at: now + Math.max(0, ms || 0), every: every ? Math.max(1, ms || 0) : 0 })
    return seq
  }
  return {
    Date: { now: () => now },
    setTimeout: (fn, ms) => add(fn, ms, false),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => add(fn, ms, true),
    clearInterval: (id) => timers.delete(id),
    async advance (ms) {
      const end = now + ms
      while (true) {
        let next = null
        for (const entry of timers) {
          if (entry[1].at <= end && (!next || entry[1].at < next[1].at)) next = entry
        }
        if (!next) break
        now = next[1].at
        if (next[1].every) next[1].at += next[1].every
        else timers.delete(next[0])
        next[1].fn()
        await flush()
      }
      now = end
      await flush()
    }
  }
}

class FTrack {
  constructor (kind) {
    this.kind = kind
    this.enabled = true
    this.readyState = 'live'
    this.onended = null
  }

  stop () {
    this.readyState = 'ended'
  }

  clone () {
    return new FTrack(this.kind)
  }
}

class FStream {
  constructor (tracks) {
    this.tracks = tracks || []
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
}

function makeVoiceEnv (opts) {
  const o = opts || {}
  const clock = makeClock()
  const log = { modules: [], xhr: [], gum: [], worklets: [], contexts: [] }
  class FNode {
    constructor (kind) {
      this.kind = kind
      this.outs = new Set()
    }

    connect (node) {
      this.outs.add(node)
      return node
    }

    disconnect (node) {
      if (node === undefined) {
        this.outs.clear()
        return
      }
      if (!this.outs.has(node)) throw new Error('InvalidAccessError')
      this.outs.delete(node)
    }
  }
  const param = (value) => ({ value, cancelScheduledValues: noop, setValueAtTime: noop, setTargetAtTime (v) { this.value = v } })
  function FakeAudioContext () {
    this.state = 'running'
    this.currentTime = 0
    this.sampleRate = 48000
    this.destination = new FNode('destination')
    this.onstatechange = null
    if (!o.noWorkletApi) {
      this.audioWorklet = {
        addModule: (url) => {
          log.modules.push(url)
          return o.moduleFails ? Promise.reject(new Error('AbortError')) : Promise.resolve()
        }
      }
    }
    log.contexts.push(this)
  }
  FakeAudioContext.prototype.createAnalyser = function () {
    const n = new FNode('analyser')
    n.fftSize = 2048
    n.getFloatTimeDomainData = (buf) => buf.fill(0)
    return n
  }
  FakeAudioContext.prototype.createDelay = function () {
    const n = new FNode('delay')
    n.delayTime = param(0)
    return n
  }
  FakeAudioContext.prototype.createGain = function () {
    const n = new FNode('gain')
    n.gain = param(1)
    return n
  }
  FakeAudioContext.prototype.createMediaStreamDestination = function () {
    const n = new FNode('dest')
    n.stream = new FStream([new FTrack('audio')])
    return n
  }
  FakeAudioContext.prototype.createMediaStreamSource = function (stream) {
    const n = new FNode('source')
    n.stream = stream
    return n
  }
  FakeAudioContext.prototype.createOscillator = function () {
    const n = new FNode('osc')
    n.frequency = param(0)
    n.start = noop
    n.stop = noop
    return n
  }
  FakeAudioContext.prototype.resume = function () {
    this.state = 'running'
    return Promise.resolve()
  }
  FakeAudioContext.prototype.close = function () {
    this.state = 'closed'
    return Promise.resolve()
  }
  class FakeWorkletNode extends FNode {
    constructor (ctx, name, options) {
      super('rnnoise')
      if (o.nodeThrows) throw new Error('NotSupportedError')
      this.ctx = ctx
      this.name = name
      this.options = options
      this.onprocessorerror = null
      const posted = []
      this.posted = posted
      this.port = { onmessage: null, postMessage: (m) => posted.push(m) }
      log.worklets.push(this)
    }

    send (data) {
      if (this.port.onmessage) this.port.onmessage({ data })
    }
  }
  function FakeXHR () {
    this.status = 0
    this.response = null
    log.xhr.push(this)
  }
  FakeXHR.prototype.open = function (method, url) {
    this.method = method
    this.url = url
  }
  FakeXHR.prototype.send = function () {
    clock.setTimeout(() => {
      if (o.wasmFails) {
        this.status = 404
        this.onload()
        return
      }
      this.status = 200
      this.response = new ArrayBuffer(16)
      this.onload()
    }, 5)
  }
  const md = {
    getUserMedia: (c) => {
      log.gum.push(JSON.parse(JSON.stringify(c)))
      return Promise.resolve(new FStream([new FTrack('audio')]))
    },
    enumerateDevices: () => Promise.resolve([])
  }
  function FakePC () {}
  FakePC.prototype.addTrack = noop
  FakePC.prototype.getTransceivers = () => []
  function FakeSender () {}
  FakeSender.prototype.replaceTrack = noop
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
    AudioContext: FakeAudioContext,
    MediaStream: FStream,
    RTCPeerConnection: FakePC,
    RTCRtpSender: FakeSender,
    XMLHttpRequest: FakeXHR
  }
  if (!o.noWorkletNode) win.AudioWorkletNode = FakeWorkletNode
  // vm bağlamının kendi WebAssembly nesnesi vardır, yokluğu açıkça taklit edilir
  if (o.noWasm) win.WebAssembly = undefined
  win.window = win
  win.navigator = { mediaDevices: md }
  win.document = { visibilityState: 'visible', documentElement: { lang: 'tr' }, addEventListener: noop, removeEventListener: noop }
  vm.createContext(win)
  vm.runInContext(VOICE, win, { filename: 'voice.js' })
  const store = new Map(Object.entries(o.storage || {}))
  const voice = win.VoiceClient.create({
    api: () => Promise.resolve({ status: 200, data: {} }),
    seal: () => '1.0123456789abcdef.AAAA.BBBB',
    open: () => ({ ok: false }),
    storage: { get: (k) => (store.has(k) ? store.get(k) : null), set: (k, v) => store.set(k, v) }
  })
  return { voice, win, clock, log, store }
}

async function startTest (env) {
  const p = env.voice.startMicTest()
  await env.clock.advance(1)
  await p
  await env.clock.advance(20)
}

test('voice.js: varsayılan açık, ayar saklanır, getUserMedia kısıtları ve tarayıcının gürültü bastırması değişmez', async () => {
  const env = makeVoiceEnv()
  assert.equal(env.win.VoiceClient.defaultSettings().rnnoise, true)
  assert.equal(env.voice.settings().rnnoise, true)
  assert.equal(env.voice.snapshot().rnnoise, 'idle')
  await startTest(env)
  assert.deepEqual(env.log.gum, [{ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false }])
  assert.deepEqual(env.log.modules, ['/rnnoise-worklet.js'])
  assert.equal(env.log.xhr.length, 1)
  assert.equal(env.log.xhr[0].url, '/vendor/rnnoise/rnnoise.wasm')
  assert.equal(env.log.xhr[0].responseType, 'arraybuffer')
  assert.equal(env.log.worklets.length, 1)
  const node = env.log.worklets[0]
  assert.equal(node.name, 'telsiz-rnnoise')
  assert.equal(node.options.channelCount, 1)
  assert.equal(node.options.channelCountMode, 'explicit')
  assert.deepEqual(Array.from(node.options.outputChannelCount), [1])
  assert.equal(node.options.processorOptions.wasm.byteLength, 16)
  // Hazır bildirilmeden düğüm hatta değildir
  assert.equal(env.voice.snapshot().rnnoise, 'loading')
  assert.equal(node.outs.size, 0)
  node.send({ type: 'ready', sampleRate: 48000 })
  await flush()
  assert.equal(env.voice.snapshot().rnnoise, 'on')
  assert.equal(env.voice.snapshot().fallback, false)
  // Tarayıcının gürültü bastırması kapatılırsa yalnızca o ayar değişir, RNNoise açık kalır
  assert.equal(await env.voice.setSettings({ noiseSuppression: false }), null)
  await env.clock.advance(20)
  assert.deepEqual(env.log.gum[1], { audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: true }, video: false })
  // Ayar kapatılınca mikrofon yeniden alınmaz, ayar saklanır
  const gumCount = env.log.gum.length
  assert.equal(await env.voice.setSettings({ rnnoise: false }), null)
  assert.equal(env.voice.settings().rnnoise, false)
  assert.equal(JSON.parse(env.store.get('telsiz.voice')).rnnoise, false)
  assert.equal(env.voice.snapshot().rnnoise, 'off')
  assert.equal(env.log.gum.length, gumCount)
  assert.deepEqual(node.posted, ['destroy'])
  env.voice.stopMicTest()
  await env.clock.advance(2000)
  // Saklanan ayar yeniden yüklenir
  const again = makeVoiceEnv({ storage: { 'telsiz.voice': env.store.get('telsiz.voice') } })
  assert.equal(again.voice.settings().rnnoise, false)
  assert.equal(again.voice.snapshot().rnnoise, 'off')
})

// Kaynak düğümünü bulmak için createMediaStreamSource sarmalanır
function trackSources (env) {
  const list = []
  const proto = env.win.AudioContext.prototype
  const original = proto.createMediaStreamSource
  proto.createMediaStreamSource = function (stream) {
    const n = original.call(this, stream)
    list.push(n)
    return n
  }
  return list
}

function kinds (node) {
  return Array.from(node.outs).map((n) => n.kind).sort()
}

test('voice.js: düğüm hazır olunca ses koluna girer, analizör ham kaynakta kalır, cihaz değişince yeni kaynak düğüme bağlanır', async () => {
  const env = makeVoiceEnv()
  const sources = trackSources(env)
  await startTest(env)
  assert.equal(sources.length, 1)
  assert.deepEqual(kinds(sources[0]), ['analyser', 'delay'])
  const node = env.log.worklets[0]
  node.send({ type: 'ready', sampleRate: 48000 })
  await flush()
  assert.deepEqual(kinds(sources[0]), ['analyser', 'rnnoise'])
  assert.deepEqual(kinds(node), ['delay'])
  const delay = Array.from(node.outs)[0]
  assert.deepEqual(kinds(delay), ['gain'])
  // Cihaz değişimi: yeni kaynak doğrudan RNNoise düğümüne bağlanır, eski kaynak ayrılır
  await env.voice.setInputDevice('baska-mikrofon')
  await env.clock.advance(20)
  assert.equal(sources.length, 2)
  assert.deepEqual(kinds(sources[1]), ['analyser', 'rnnoise'])
  assert.equal(sources[0].outs.size, 0)
  assert.equal(env.log.worklets.length, 1, 'düğüm yeniden kurulmaz')
  // Ayar kapatılınca kaynak gecikmeye döner, açılınca yeni düğüm hazırlanır
  await env.voice.setSettings({ rnnoise: false })
  assert.deepEqual(kinds(sources[1]), ['analyser', 'delay'])
  assert.equal(node.outs.size, 0)
  await env.voice.setSettings({ rnnoise: true })
  await env.clock.advance(20)
  assert.equal(env.log.worklets.length, 2)
  assert.equal(env.log.modules.length, 1, 'modül bağlam başına bir kez yüklenir')
  assert.equal(env.log.xhr.length, 1, 'wasm sayfa başına bir kez indirilir')
  env.log.worklets[1].send({ type: 'ready', sampleRate: 48000 })
  await flush()
  assert.deepEqual(kinds(sources[1]), ['analyser', 'rnnoise'])
  // Mikrofon bırakılınca düğüm kapatılır
  env.voice.stopMicTest()
  await env.clock.advance(2000)
  assert.deepEqual(env.log.worklets[1].posted, ['destroy'])
  assert.equal(env.voice.snapshot().rnnoise, 'idle')
})

test('voice.js: işlemci hata verirse ses kesilmeden kaynak gecikmeye döner, mikrofon yeniden alınmaz, ayar yeniden açılınca denenir', async () => {
  const env = makeVoiceEnv()
  const sources = trackSources(env)
  await startTest(env)
  const node = env.log.worklets[0]
  node.send({ type: 'ready', sampleRate: 48000 })
  await flush()
  assert.deepEqual(kinds(sources[0]), ['analyser', 'rnnoise'])
  node.send({ type: 'error', code: 'process' })
  await flush()
  assert.deepEqual(kinds(sources[0]), ['analyser', 'delay'])
  assert.deepEqual(node.posted, ['destroy'])
  assert.equal(env.voice.snapshot().rnnoise, 'unavailable')
  assert.equal(env.voice.snapshot().fallback, false, 'ses hattı sürer')
  assert.equal(env.log.gum.length, 1)
  // Aynı oturumda kendiliğinden yeniden denenmez
  await env.clock.advance(5000)
  assert.equal(env.log.worklets.length, 1)
  // Kişi ayarı kapatıp açarsa yeniden denenir
  await env.voice.setSettings({ rnnoise: false })
  await env.voice.setSettings({ rnnoise: true })
  await env.clock.advance(20)
  assert.equal(env.log.worklets.length, 2)
  // processorerror olayı da aynı yolu izler
  const second = env.log.worklets[1]
  second.send({ type: 'ready', sampleRate: 48000 })
  await flush()
  assert.deepEqual(kinds(sources[0]), ['analyser', 'rnnoise'])
  second.onprocessorerror()
  assert.deepEqual(kinds(sources[0]), ['analyser', 'delay'])
  assert.equal(env.voice.snapshot().rnnoise, 'unavailable')
  env.voice.stopMicTest()
  await env.clock.advance(2000)
})

test('voice.js: modül veya wasm yüklenemezse, düğüm kurulamazsa ya da hazır yanıtı gelmezse tarayıcının işlemesiyle sürer', async () => {
  const cases = [
    { opts: { moduleFails: true }, worklets: 0 },
    { opts: { wasmFails: true }, worklets: 0 },
    { opts: { nodeThrows: true }, worklets: 0 },
    { opts: { noWorkletApi: true }, worklets: 0, modules: 0 }
  ]
  for (const c of cases) {
    const env = makeVoiceEnv(c.opts)
    const sources = trackSources(env)
    await startTest(env)
    await env.clock.advance(100)
    assert.equal(env.voice.snapshot().rnnoise, 'unavailable', JSON.stringify(c.opts))
    assert.deepEqual(kinds(sources[0]), ['analyser', 'delay'], JSON.stringify(c.opts))
    assert.equal(env.log.worklets.length, c.worklets, JSON.stringify(c.opts))
    if (c.modules === 0) assert.equal(env.log.modules.length, 0)
    assert.equal(env.log.gum.length, 1)
    assert.equal(env.voice.snapshot().fallback, false)
    env.voice.stopMicTest()
    await env.clock.advance(2000)
  }
  // Hazır yanıtı: bağlam askıdayken beklenir, çalışırken 15 sn içinde gelmezse bırakılır
  const env = makeVoiceEnv()
  const sources = trackSources(env)
  await startTest(env)
  const ctx = env.log.contexts[0]
  ctx.state = 'suspended'
  await env.clock.advance(30000)
  assert.equal(env.voice.snapshot().rnnoise, 'loading', 'askıdayken bekler')
  assert.equal(env.log.worklets[0].posted.length, 0)
  ctx.state = 'running'
  await env.clock.advance(14000)
  assert.notEqual(env.voice.snapshot().rnnoise, 'unavailable')
  await env.clock.advance(2000)
  assert.equal(env.voice.snapshot().rnnoise, 'unavailable')
  assert.deepEqual(env.log.worklets[0].posted, ['destroy'])
  assert.deepEqual(kinds(sources[0]), ['analyser', 'delay'])
  // Geç gelen hazır iletisi yok sayılır
  env.log.worklets[0].send({ type: 'ready', sampleRate: 48000 })
  await flush()
  assert.deepEqual(kinds(sources[0]), ['analyser', 'delay'])
  env.voice.stopMicTest()
  await env.clock.advance(2000)
})

test('voice.js: AudioWorklet veya WebAssembly olmayan tarayıcıda hiç yükleme yapılmaz', async () => {
  for (const opts of [{ noWorkletNode: true }, { noWasm: true }]) {
    const env = makeVoiceEnv(opts)
    const sources = trackSources(env)
    assert.equal(env.voice.snapshot().rnnoise, 'unavailable')
    await startTest(env)
    assert.deepEqual(env.log.modules, [])
    assert.deepEqual(env.log.xhr, [])
    assert.deepEqual(kinds(sources[0]), ['analyser', 'delay'])
    assert.equal(env.voice.snapshot().rnnoise, 'unavailable')
    env.voice.stopMicTest()
    await env.clock.advance(2000)
  }
})

test('voice.js: kapı, bas konuş ve susturma RNNoise açıkken de kazanç düğümünde ve izde uygulanır', async () => {
  const env = makeVoiceEnv()
  await startTest(env)
  const node = env.log.worklets[0]
  node.send({ type: 'ready', sampleRate: 48000 })
  await flush()
  assert.equal(env.voice.snapshot().rnnoise, 'on')
  const delay = Array.from(node.outs)[0]
  const gain = Array.from(delay.outs)[0]
  const dest = Array.from(gain.outs)[0]
  const track = dest.stream.getAudioTracks()[0]
  // Sessiz analizörde ses etkinliği kapısı kapalı kalır
  await env.clock.advance(400)
  assert.equal(env.voice.snapshot().gateOpen, false)
  assert.equal(gain.gain.value, 0)
  // Bas konuş: basılıyken açık, bırakınca bırakma süresinden sonra kapalı
  await env.voice.setSettings({ inputMode: 'ptt' })
  env.voice.pttDown()
  assert.equal(env.voice.snapshot().gateOpen, true)
  assert.equal(gain.gain.value, 1)
  env.voice.pttUp()
  await env.clock.advance(250)
  assert.equal(env.voice.snapshot().gateOpen, false)
  assert.equal(gain.gain.value, 0)
  // Susturma eşlere giden izi tamamen kapatır
  env.voice.setMuted(true)
  assert.equal(track.enabled, false)
  env.voice.pttDown()
  assert.equal(env.voice.snapshot().gateOpen, false)
  env.voice.pttUp()
  env.voice.setMuted(false)
  assert.equal(track.enabled, true)
  assert.equal(env.voice.snapshot().rnnoise, 'on')
  env.voice.stopMicTest()
  await env.clock.advance(2000)
})
