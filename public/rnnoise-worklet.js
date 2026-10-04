'use strict'

// Gelişmiş gürültü engelleme (RNNoise) için AudioWorklet işlemcisi: 'telsiz-rnnoise'.
// voice.js bu dosyayı ses bağlamına audioWorklet.addModule ile yükler ve düğümü mikrofon hattının ses
// koluna (kaynak ile ileri bakış gecikmesi arasına) ekler. RNNoise'un WebAssembly derlemesi
// public/vendor/rnnoise/rnnoise.wasm dosyasıdır (@shiguredo/rnnoise-wasm 2022.2.0, değiştirilmemiş kopya).
// wasm baytları processorOptions.wasm ile gelir ve burada derlenir. Bu dosya kullanıcıya görünen metin
// üretmez, durumu ana iş parçacığına { type: 'ready' } veya { type: 'error', code } iletisiyle bildirir.
// Hazır olana kadar ve herhangi bir hatada giriş olduğu gibi çıkışa geçer, ses hiçbir zaman kesilmez.
//
// RNNoise 48 kHz örnekleme hızında 480 örneklik (10 ms) çerçevelerle çalışır, Web Audio ise 128 örneklik
// bloklar verir. Örnekler bir çerçeve dolana kadar biriktirilir, işlenen çerçeveler bir kuyruğa yazılır ve
// çıkış kuyruktan okunur. Kuyruk başta bir çerçeve ve küçük bir pay kadar sessizlikle doldurulur, bu yüzden
// kuyruk hiç boşalmaz. Çerçeveleme yaklaşık 10 ms gecikme ekler, RNNoise'un kendisi de sesi bir çerçeve
// geciktirir (toplam yaklaşık 20 ms). Bağlamın hızı 48 kHz değilse giriş doğrusal ara
// değerlemeyle 48 kHz'e, çıkış aynı yolla bağlamın hızına çevrilir (48 kHz'de iki çevirici örnekleri
// değiştirmeden geçirir).
//
// Emscripten'in JavaScript yapıştırıcı kodu kullanılmaz: wasm dosyası yalnızca üç işlev ister
// (env.emscripten_memcpy_big, env.emscripten_resize_heap, env.__assert_fail), bunların karşılıkları
// aşağıdadır. Dışa açılan işlevler rnnoise_create, rnnoise_process_frame, rnnoise_destroy, malloc ve
// free'dir. Bu dosya Node testlerinde (test/rnnoise.test.js) vm bağlamında da yüklenir.

const PROCESSOR_NAME = 'telsiz-rnnoise'
const FRAME = 480
const RNNOISE_RATE = 48000
// RNNoise örnekleri 16 bit PCM ölçeğinde bekler, Web Audio -1..1 aralığını kullanır
const PCM_SCALE = 32768
const WASM_PAGE = 65536
const PREFILL = FRAME + 16
const QUEUE_SIZE = 8192

// wasm örneğini kurar. Sonuç: { process(frame), destroy() }. frame -1..1 ölçeğinde 480 örnektir ve
// yerinde işlenir, process RNNoise'un konuşma olasılığını (0..1) döner.
function createDenoiser (bytes) {
  let memory = null
  let heap = null
  let floats = null
  const views = () => {
    heap = new Uint8Array(memory.buffer)
    floats = new Float32Array(memory.buffer)
  }
  const env = {
    emscripten_memcpy_big (dest, src, num) {
      heap.copyWithin(dest, src, src + num)
    },
    emscripten_resize_heap (size) {
      const want = size >>> 0
      const have = memory.buffer.byteLength
      if (want <= have) return 0
      try {
        memory.grow(Math.ceil((want - have) / WASM_PAGE))
        views()
        return 1
      } catch (err) {
        return 0
      }
    },
    __assert_fail () {
      throw new Error('rnnoise_assert')
    }
  }
  return WebAssembly.instantiate(bytes, { env: env }).then((result) => {
    const x = result.instance.exports
    memory = x.memory
    views()
    if (typeof x.emscripten_stack_init === 'function') x.emscripten_stack_init()
    x.__wasm_call_ctors()
    if (x.rnnoise_get_frame_size() !== FRAME) throw new Error('rnnoise_frame')
    const state = x.rnnoise_create(0)
    const input = x.malloc(FRAME * 4)
    const output = x.malloc(FRAME * 4)
    if (!state || !input || !output) throw new Error('rnnoise_memory')
    let alive = true
    return {
      process (frame) {
        // Bellek büyüdüyse eski görünümler geçersizdir
        if (floats.buffer !== memory.buffer) views()
        const inAt = input >> 2
        const outAt = output >> 2
        let i = 0
        while (i < FRAME) {
          floats[inAt + i] = frame[i] * PCM_SCALE
          i++
        }
        const vad = x.rnnoise_process_frame(state, output, input)
        if (floats.buffer !== memory.buffer) views()
        i = 0
        while (i < FRAME) {
          frame[i] = floats[outAt + i] / PCM_SCALE
          i++
        }
        return vad
      },
      destroy () {
        if (!alive) return
        alive = false
        x.rnnoise_destroy(state)
        x.free(input)
        x.free(output)
      }
    }
  })
}

// 48 kHz çerçeveleme, işleme ve hız çevirme. denoise(frame) çerçeveyi yerinde işler.
// run(input, output) aynı uzunlukta iki dizi alır (bağlamın hızında).
function createFramer (rate, denoise) {
  const upStep = rate / RNNOISE_RATE
  const downStep = RNNOISE_RATE / rate
  const frame = new Float32Array(FRAME)
  const queue = new Float32Array(QUEUE_SIZE)
  let frameLen = 0
  let head = 0
  let size = PREFILL
  let upT = 0
  let upPrev = 0
  let upCur = 0
  let downT = 0
  let downPrev = 0
  let downCur = 0

  function pushFrameSample (value) {
    frame[frameLen++] = value
    if (frameLen < FRAME) return
    frameLen = 0
    denoise(frame)
    let i = 0
    while (i < FRAME) {
      // Kuyruk taşarsa (olmaması gerekir) en eski örnek atılır
      if (size === QUEUE_SIZE) {
        head = (head + 1) % QUEUE_SIZE
        size--
      }
      queue[(head + size) % QUEUE_SIZE] = frame[i]
      size++
      i++
    }
  }

  function shift () {
    if (size === 0) return 0
    const value = queue[head]
    head = (head + 1) % QUEUE_SIZE
    size--
    return value
  }

  return {
    run (input, output) {
      let i = 0
      while (i < input.length) {
        upPrev = upCur
        upCur = input[i]
        while (upT < 1) {
          pushFrameSample(upPrev + (upCur - upPrev) * upT)
          upT += upStep
        }
        upT -= 1
        i++
      }
      i = 0
      while (i < output.length) {
        while (downT >= 1) {
          downPrev = downCur
          downCur = shift()
          downT -= 1
        }
        output[i] = downPrev + (downCur - downPrev) * downT
        downT += downStep
        i++
      }
    },
    // Kuyrukta bekleyen örnek sayısı (testler için)
    queued () {
      return size
    }
  }
}

class RnnoiseProcessor extends AudioWorkletProcessor {
  constructor (options) {
    super()
    this.denoiser = null
    this.framer = null
    this.closed = false
    this.failed = false
    this.port.onmessage = (event) => {
      if (event.data === 'destroy') this.destroy()
    }
    const opts = options && options.processorOptions
    const bytes = opts && opts.wasm
    if (!bytes || typeof bytes.byteLength !== 'number' || bytes.byteLength === 0) {
      this.fail('no_wasm')
      return
    }
    createDenoiser(bytes).then((denoiser) => {
      if (this.closed || this.failed) {
        denoiser.destroy()
        return
      }
      this.denoiser = denoiser
      this.framer = createFramer(sampleRate, (frame) => denoiser.process(frame))
      this.port.postMessage({ type: 'ready', sampleRate: sampleRate })
    }, () => {
      this.fail('wasm')
    })
  }

  fail (code) {
    if (this.failed) return
    this.failed = true
    this.releaseDenoiser()
    this.port.postMessage({ type: 'error', code: code })
  }

  releaseDenoiser () {
    const denoiser = this.denoiser
    this.denoiser = null
    this.framer = null
    if (!denoiser) return
    try {
      denoiser.destroy()
    } catch (err) {
      // wasm durumu zaten bozuksa serbest bırakma da başarısız olabilir
    }
  }

  destroy () {
    this.closed = true
    this.releaseDenoiser()
  }

  process (inputs, outputs) {
    if (this.closed) return false
    const output = outputs[0] && outputs[0][0]
    if (!output) return true
    const input = inputs[0] && inputs[0][0]
    if (!input) {
      output.fill(0)
      return true
    }
    if (!this.framer) {
      output.set(input)
      return true
    }
    try {
      this.framer.run(input, output)
    } catch (err) {
      this.fail('process')
      output.set(input)
    }
    return true
  }
}

registerProcessor(PROCESSOR_NAME, RnnoiseProcessor)
