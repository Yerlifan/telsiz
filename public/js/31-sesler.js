'use strict'

// Sesli bildirimler (window.TelsizSesler). Ses dosyası kullanılmaz, her ses Web Audio ile sentezlenir:
// notalar sinüs kısmi tonlarının toplamıdır (çan, marimba, cam ve yumuşak tını), her kısmi ton kısa bir
// yükselişten sonra üstel olarak söner. Bütün sesler alçak geçiren süzgeçten ve ana kazançtan geçer, bazılarında
// kısa bir yankı vardır. Her bildirim sesi tam DURATION saniyedir, ana kazanç son FADE saniyede sıfıra iner.
// - join: ses odasına biri katıldı (yükselen dört notalı çan arpeji, Do majör)
// - leave: ses odasından biri ayrıldı (inen dört nota, daha koyu tını)
// - share: biri ekran yayını başlattı (cam tınılı uzun beşli aralık ve yükselen parıltı)
// - dm: özel mesaj geldi (inen iki notalı kapı zili)
// - friend: arkadaşlık isteği geldi (hızla tellenen majör yedili akor ve yüksek iki parıltı)
// - drop: ses odasından düştünüz (alçak, inen minör üç nota, son nota aşağı kayar)
// - message: mesaj sesi (eski kısa iki tonlu ses, bildirim seslerinden ayrıdır ve kısadır)
// Ses düzeyi 0 ile 100 arasıdır (telsiz.notifyVolume, varsayılan DEFAULT_VOLUME). Algıya yakın olsun diye
// genlik düzeyin karesiyle ölçeklenir. Ses bağlamı sayfa başına birdir, ilk kullanıcı etkileşiminde açılır ve
// ses bitince askıya alınır. Masaüstü uygulamasının arka plan penceresinde hiç ses çalınmaz.
// Hangi olayda çalınacağına ve ayarlara (Giriş ve çıkış sesleri, Mesaj sesi, Rahatsız etmeyin, sağırlaştırma)
// çağıran modül karar verir: public/voice.js (katılma, ayrılma, düşme), 22-cast.js (ekran yayını),
// 05-poll.js ve 11-settings.js (özel mesaj, mesaj sesi), 14-social.js (arkadaşlık isteği).

window.TelsizSesler = (function () {
  const KINDS = ['join', 'leave', 'share', 'dm', 'friend', 'drop']
  const DURATION = 2
  const FADE = 0.3
  const ATTACK = 0.006
  const START_DELAY = 0.02
  const VOLUME_KEY = 'telsiz.notifyVolume'
  const DEFAULT_VOLUME = 40
  // Düzey 100'deyken bir sesin tepe genliği (yaklaşık -10 dBFS). Varsayılan 40 yaklaşık 0.05 (-26 dBFS).
  const MAX_AMPLITUDE = 0.3
  // Aynı ses bu süre içinde yeniden istenirse (ör. aynı anda birkaç kişi katılınca) bir kez çalar
  const REPEAT_GAP_MS = 900
  const SLEEP_AFTER_MS = 600

  // Tınılar: [frekans oranı, genlik, sönme katsayısı]. Sönme katsayısı notanın sönme süresiyle çarpılır, üst
  // kısmi tonlar daha çabuk söner.
  const TIMBRES = {
    bell: [[1, 1, 1], [2, 0.45, 0.6], [3, 0.22, 0.45], [4.2, 0.1, 0.3], [5.4, 0.05, 0.22]],
    marimba: [[1, 1, 1], [3.9, 0.28, 0.25], [9.2, 0.08, 0.12]],
    glass: [[1, 1, 1], [2.76, 0.35, 0.5], [5.4, 0.14, 0.3], [8.93, 0.06, 0.2]],
    soft: [[1, 1, 1], [2, 0.18, 0.7], [3, 0.06, 0.5]]
  }

  // Notalar: t başlangıç (saniye), f temel frekans (Hz), a genlik, d sönme zaman sabiti (saniye). detune sent
  // cinsinden ikinci bir sesle hafif titreşim verir, glide frekansın varacağı oran (aşağı kayma).
  // norm, sesin tepe genliğini 1'e getiren katsayıdır (Chromium OfflineAudioContext ile ölçüldü).
  const SOUNDS = {
    join: {
      timbre: 'bell',
      lowpass: 7000,
      norm: 0.537,
      notes: [
        { t: 0, f: 523.25, a: 0.55, d: 0.5 },
        { t: 0.11, f: 659.25, a: 0.55, d: 0.5 },
        { t: 0.22, f: 783.99, a: 0.55, d: 0.55 },
        { t: 0.33, f: 1046.5, a: 0.6, d: 0.9 }
      ]
    },
    leave: {
      timbre: 'marimba',
      lowpass: 3500,
      norm: 0.674,
      notes: [
        { t: 0, f: 783.99, a: 0.5, d: 0.4 },
        { t: 0.13, f: 659.25, a: 0.5, d: 0.4 },
        { t: 0.26, f: 523.25, a: 0.5, d: 0.45 },
        { t: 0.39, f: 392, a: 0.6, d: 0.8 }
      ]
    },
    share: {
      timbre: 'glass',
      lowpass: 8000,
      norm: 0.737,
      echo: { time: 0.17, feedback: 0.25, wet: 0.3 },
      notes: [
        { t: 0, f: 587.33, a: 0.4, d: 1 },
        { t: 0, f: 587.33, a: 0.25, d: 1, detune: 6 },
        { t: 0, f: 880, a: 0.35, d: 1 },
        { t: 0.42, f: 1174.66, a: 0.3, d: 0.5 },
        { t: 0.56, f: 1479.98, a: 0.26, d: 0.5 },
        { t: 0.7, f: 1760, a: 0.24, d: 0.6 }
      ]
    },
    dm: {
      timbre: 'bell',
      lowpass: 6500,
      norm: 0.778,
      echo: { time: 0.2, feedback: 0.2, wet: 0.25 },
      notes: [
        { t: 0, f: 1318.51, a: 0.5, d: 0.6 },
        { t: 0.28, f: 1046.5, a: 0.55, d: 0.9 }
      ]
    },
    friend: {
      timbre: 'bell',
      lowpass: 7500,
      norm: 0.681,
      echo: { time: 0.15, feedback: 0.2, wet: 0.22 },
      notes: [
        { t: 0, f: 523.25, a: 0.35, d: 0.9 },
        { t: 0.035, f: 659.25, a: 0.35, d: 0.9 },
        { t: 0.07, f: 783.99, a: 0.35, d: 0.9 },
        { t: 0.105, f: 987.77, a: 0.32, d: 0.9 },
        { t: 0.5, f: 1567.98, a: 0.2, d: 0.35, timbre: 'glass' },
        { t: 0.62, f: 2093, a: 0.16, d: 0.4, timbre: 'glass' }
      ]
    },
    drop: {
      timbre: 'soft',
      lowpass: 2200,
      norm: 0.805,
      notes: [
        { t: 0, f: 440, a: 0.5, d: 0.45 },
        { t: 0.2, f: 349.23, a: 0.5, d: 0.45 },
        { t: 0.4, f: 293.66, a: 0.6, d: 0.9, glide: 0.97 }
      ]
    }
  }

  const state = { ctx: null, timer: 0, sleepAt: 0, last: Object.create(null) }

  function readStore (key) {
    try {
      return window.localStorage.getItem(key)
    } catch (err) {
      return null
    }
  }

  function writeStore (key, value) {
    try {
      window.localStorage.setItem(key, value)
    } catch (err) {
      // Yerel depo kapalı, değer yalnızca bu oturumda geçerli değildir
    }
  }

  function clampVolume (value) {
    const n = Math.round(Number(value))
    return isFinite(n) ? Math.max(0, Math.min(100, n)) : null
  }

  function getVolume () {
    const raw = readStore(VOLUME_KEY)
    const n = raw === null || raw === '' ? null : clampVolume(raw)
    return n === null ? DEFAULT_VOLUME : n
  }

  function setVolume (value) {
    const n = clampVolume(value)
    if (n === null) return getVolume()
    writeStore(VOLUME_KEY, String(n))
    return n
  }

  // Düzeyden (0 ile 100) tepe genliğine
  function amplitude (volume) {
    const v = clampVolume(volume)
    const x = (v === null ? DEFAULT_VOLUME : v) / 100
    return MAX_AMPLITUDE * x * x
  }

  function background () {
    const bg = window.telsizArkaPlan
    return Boolean(bg && typeof bg === 'object' && bg.background === true)
  }

  function context () {
    if (state.ctx && state.ctx.state !== 'closed') return state.ctx
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (typeof Ctx !== 'function') return null
    try {
      state.ctx = new Ctx()
    } catch (err) {
      state.ctx = null
    }
    return state.ctx
  }

  // Ses bağlamı en az ms boyunca açık kalır, sonra askıya alınır (boşta işlemci harcamaz)
  function keepAwake (ms) {
    const until = Date.now() + ms
    if (until <= state.sleepAt) return
    state.sleepAt = until
    clearTimeout(state.timer)
    state.timer = setTimeout(() => {
      const c = state.ctx
      if (c && c.state === 'running' && typeof c.suspend === 'function') {
        try {
          const p = c.suspend()
          if (p && typeof p.catch === 'function') p.catch(() => {})
        } catch (err) {
          // Askıya alınamadı
        }
      }
    }, ms)
  }

  // İlk kullanıcı etkileşiminde bağlam açılır (tarayıcılar sesi ancak bir etkileşimden sonra başlatır)
  function unlock () {
    const c = context()
    if (!c || typeof c.resume !== 'function') return
    try {
      const p = c.resume()
      if (p && typeof p.then === 'function') p.then(() => keepAwake(1000), () => {})
    } catch (err) {
      // Tarayıcı izin vermedi
    }
  }

  function disconnectAll (nodes) {
    nodes.forEach((n) => {
      try {
        n.disconnect()
      } catch (err) {
        // Zaten ayrılmış
      }
    })
  }

  // Eski mesaj sesi: 880 Hz'den 1175 Hz'e iki tonlu kısa ses. Varsayılan düzeyde tepe genliği eskisi gibi 0.09.
  function scheduleMessage (ctx, dest, t0, amp) {
    const peak = Math.max(0.0001, amp * 1.9)
    const gain = ctx.createGain()
    gain.connect(dest)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.015)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.24)
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, t0)
    osc.frequency.setValueAtTime(1175, t0 + 0.09)
    osc.connect(gain)
    osc.onended = () => disconnectAll([osc, gain])
    osc.start(t0)
    osc.stop(t0 + 0.26)
    return { start: t0, end: t0 + 0.26 }
  }

  // Sesi verilen bağlama (çevrimdışı bağlam da olabilir) kurar. opts: { destination, when, amplitude }.
  // amplitude verilmezse kayıtlı düzey kullanılır. { start, end } döner, bilinmeyen türde null.
  function schedule (ctx, kind, opts) {
    const o = opts && typeof opts === 'object' ? opts : {}
    const dest = o.destination || ctx.destination
    const t0 = (typeof o.when === 'number' ? o.when : ctx.currentTime) + START_DELAY
    const amp = typeof o.amplitude === 'number' && o.amplitude >= 0 ? o.amplitude : amplitude(getVolume())
    if (kind === 'message') return scheduleMessage(ctx, dest, t0, amp)
    const spec = SOUNDS[kind]
    if (!spec) return null
    const end = t0 + DURATION
    const nodes = []
    const master = ctx.createGain()
    const level = amp * spec.norm
    master.gain.setValueAtTime(level, t0)
    master.gain.setValueAtTime(level, end - FADE)
    master.gain.linearRampToValueAtTime(0, end)
    master.connect(dest)
    nodes.push(master)
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.setValueAtTime(spec.lowpass, t0)
    filter.Q.setValueAtTime(0.5, t0)
    filter.connect(master)
    nodes.push(filter)
    if (spec.echo) {
      const delay = ctx.createDelay(1)
      delay.delayTime.setValueAtTime(spec.echo.time, t0)
      const feedback = ctx.createGain()
      feedback.gain.setValueAtTime(spec.echo.feedback, t0)
      const wet = ctx.createGain()
      wet.gain.setValueAtTime(spec.echo.wet, t0)
      filter.connect(delay)
      delay.connect(feedback)
      feedback.connect(delay)
      delay.connect(wet)
      wet.connect(master)
      nodes.push(delay, feedback, wet)
    }
    let lastOsc = null
    spec.notes.forEach((note) => {
      const start = t0 + note.t
      TIMBRES[note.timbre || spec.timbre].forEach((partial) => {
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        const freq = note.f * partial[0]
        osc.frequency.setValueAtTime(freq, start)
        if (note.glide) osc.frequency.setTargetAtTime(freq * note.glide, start + 0.08, 0.25)
        if (note.detune) osc.detune.setValueAtTime(note.detune, start)
        const g = ctx.createGain()
        g.gain.setValueAtTime(0, start)
        g.gain.linearRampToValueAtTime(note.a * partial[1], start + ATTACK)
        g.gain.setTargetAtTime(0, start + ATTACK, note.d * partial[2])
        osc.connect(g)
        g.connect(filter)
        osc.start(start)
        osc.stop(end)
        nodes.push(osc, g)
        lastOsc = osc
      })
    })
    // Bütün osilatörler aynı anda durur, sonuncusu bitince düğümler ayrılır
    if (lastOsc) lastOsc.onended = () => disconnectAll(nodes)
    return { start: t0, end: end }
  }

  // Sesi sayfanın ses bağlamında çalar. opts.test: ayarlardaki dinleme düğmesi (yineleme sınırı uygulanmaz).
  // Çalınabildiyse (bağlam var, bilinmeyen tür değil, arka plan penceresi değil) true döner.
  function play (kind, opts) {
    const test = Boolean(opts && opts.test)
    if (kind !== 'message' && !SOUNDS[kind]) return false
    if (background()) return false
    const now = Date.now()
    if (!test && state.last[kind] && now - state.last[kind] < REPEAT_GAP_MS) return true
    state.last[kind] = now
    const c = context()
    if (!c) return false
    const length = kind === 'message' ? 0.3 : DURATION
    const run = () => {
      try {
        schedule(c, kind, null)
        keepAwake(Math.round((length + START_DELAY) * 1000) + SLEEP_AFTER_MS)
      } catch (err) {
        // Ses kurulamadı, bildirim sessiz geçer
      }
    }
    if (c.state === 'suspended' && typeof c.resume === 'function') {
      try {
        const p = c.resume()
        if (p && typeof p.then === 'function') p.then(run, () => {})
        else run()
      } catch (err) {
        return false
      }
    } else {
      run()
    }
    return true
  }

  return {
    KINDS: KINDS.slice(),
    DURATION: DURATION,
    DEFAULT_VOLUME: DEFAULT_VOLUME,
    getVolume: getVolume,
    setVolume: setVolume,
    amplitude: amplitude,
    context: context,
    keepAwake: keepAwake,
    unlock: unlock,
    schedule: schedule,
    play: play
  }
})()
