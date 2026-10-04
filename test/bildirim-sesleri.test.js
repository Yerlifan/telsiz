'use strict'

// Sesli bildirimler (public/js/31-sesler.js): düzey ve genlik, ses kurulumu (süre, düğümler), tekrar sınırı,
// arka plan penceresi ve askıdaki bağlam. Modül sahte bir WebAudio ile ayrı bir bağlamda yüklenir.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', '31-sesler.js'), 'utf8')

function param (log) {
  return {
    value: 0,
    setValueAtTime (v, t) { log.push(['set', v, t]) },
    linearRampToValueAtTime (v, t) { log.push(['linear', v, t]) },
    exponentialRampToValueAtTime (v, t) { log.push(['exp', v, t]) },
    setTargetAtTime (v, t, c) { log.push(['target', v, t, c]) }
  }
}

function fakeAudio () {
  const stats = { created: 0, resumed: 0, suspended: 0, oscillators: [], gains: [], filters: 0, delays: 0 }
  function Ctx () {
    stats.created++
    this.state = stats.startState || 'running'
    this.currentTime = 10
    this.destination = { name: 'destination' }
  }
  const node = (extra) => Object.assign({ connections: [], connect (to) { this.connections.push(to) }, disconnect () { this.disconnected = true } }, extra)
  Ctx.prototype.createGain = function () {
    const n = node({ log: [] })
    n.gain = param(n.log)
    stats.gains.push(n)
    return n
  }
  Ctx.prototype.createOscillator = function () {
    const n = node({ log: [], type: '' })
    n.frequency = param(n.log)
    n.detune = param(n.log)
    n.start = (t) => { n.startAt = t }
    n.stop = (t) => { n.stopAt = t }
    stats.oscillators.push(n)
    return n
  }
  Ctx.prototype.createBiquadFilter = function () {
    stats.filters++
    const log = []
    return node({ type: '', frequency: param(log), Q: param(log) })
  }
  Ctx.prototype.createDelay = function () {
    stats.delays++
    return node({ delayTime: param([]) })
  }
  Ctx.prototype.resume = function () {
    stats.resumed++
    this.state = 'running'
    return Promise.resolve()
  }
  Ctx.prototype.suspend = function () {
    stats.suspended++
    this.state = 'suspended'
    return Promise.resolve()
  }
  return { Ctx, stats }
}

function load (opts) {
  const o = opts || {}
  const audio = fakeAudio()
  if (o.startState) audio.stats.startState = o.startState
  const store = new Map(Object.entries(o.store || {}))
  const timers = []
  const sandbox = {
    console,
    Date: o.Date || Date,
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms })
      return timers.length
    },
    clearTimeout: () => {},
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v))
    }
  }
  sandbox.window = sandbox
  if (!o.noAudio) sandbox.AudioContext = audio.Ctx
  if (o.background) sandbox.telsizArkaPlan = { background: true }
  vm.createContext(sandbox)
  vm.runInContext(SOURCE, sandbox, { filename: '31-sesler.js' })
  return { api: sandbox.TelsizSesler, stats: audio.stats, store, timers, sandbox }
}

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('altı ses, 2 saniye, varsayılan düzey 40', () => {
  const { api } = load()
  assert.deepEqual(Array.from(api.KINDS), ['join', 'leave', 'share', 'dm', 'friend', 'drop'])
  assert.equal(api.DURATION, 2)
  assert.equal(api.DEFAULT_VOLUME, 40)
  assert.equal(api.getVolume(), 40)
})

test('düzey 0 ile 100 arasına kırpılır ve saklanır, bozuk kayıt varsayılana döner', () => {
  const { api, store } = load()
  assert.equal(api.setVolume(70), 70)
  assert.equal(store.get('telsiz.notifyVolume'), '70')
  assert.equal(api.getVolume(), 70)
  assert.equal(api.setVolume(150), 100)
  assert.equal(api.setVolume(-5), 0)
  assert.equal(api.setVolume('yarım'), 0, 'geçersiz değer kaydı değiştirmez')
  assert.equal(store.get('telsiz.notifyVolume'), '0')
  assert.equal(load({ store: { 'telsiz.notifyVolume': 'bozuk' } }).api.getVolume(), 40)
  assert.equal(load({ store: { 'telsiz.notifyVolume': '250' } }).api.getVolume(), 100)
})

test('genlik düzeyin karesiyle artar, varsayılan düzeyde alçaktır', () => {
  const { api } = load()
  assert.equal(api.amplitude(0), 0)
  assert.equal(Math.round(api.amplitude(100) * 1000) / 1000, 0.3)
  assert.equal(Math.round(api.amplitude(40) * 1000) / 1000, 0.048)
  assert.ok(20 * Math.log10(api.amplitude(40)) < -25, 'varsayılan tepe -25 dBFS altında')
  assert.ok(api.amplitude(50) < api.amplitude(60))
})

test('her ses tam 2 saniye kurulur: osilatörler sonda durur, ana kazanç sonda sıfıra iner', () => {
  for (const kind of ['join', 'leave', 'share', 'dm', 'friend', 'drop']) {
    const env = load()
    const ctx = new env.sandbox.AudioContext()
    const span = env.api.schedule(ctx, kind, { when: 0, amplitude: 0.5 })
    assert.ok(span, kind)
    assert.equal(Math.round((span.end - span.start) * 1000), 2000, kind + ' süresi')
    assert.ok(env.stats.oscillators.length > 0, kind)
    env.stats.oscillators.forEach((o) => assert.equal(o.stopAt, span.end, kind))
    const master = env.stats.gains[0]
    assert.deepEqual(master.log[master.log.length - 1].slice(0, 3), ['linear', 0, span.end], kind)
  }
})

test('ses düğümleri: osilatörler aynı anda durur, kısmi tonlar sönümlenir, son kazanç sıfır', () => {
  const env = load()
  const ctx = new env.sandbox.AudioContext()
  const span = env.api.schedule(ctx, 'friend', { when: 1, amplitude: 0.2 })
  assert.equal(span.start, 1.02)
  assert.equal(Math.round(span.end * 100) / 100, 3.02)
  const oscs = env.stats.oscillators
  assert.ok(oscs.length >= 6)
  oscs.forEach((o) => {
    assert.equal(o.stopAt, span.end)
    assert.ok(o.startAt >= span.start && o.startAt < span.end)
  })
  // İlk kazanç ana kazançtır: başta düzey x norm, sonda sıfır
  const master = env.stats.gains[0]
  const last = master.log[master.log.length - 1]
  assert.deepEqual(last.slice(0, 3), ['linear', 0, span.end])
  assert.ok(master.log[0][1] > 0 && master.log[0][1] <= 0.2, 'eşitleme katsayısı 1 veya altında')
  assert.equal(master.connections[0].name, 'destination')
  // Kısmi ton kazançları yükselip sönümlenir
  const partial = env.stats.gains.find((g) => g.log.some((e) => e[0] === 'target'))
  assert.ok(partial)
  assert.equal(env.stats.filters, 1)
  assert.equal(env.stats.delays, 1, 'arkadaşlık sesinde yankı')
  assert.equal(env.api.schedule(ctx, 'yok', {}), null)
})

test('mesaj sesi kısadır ve varsayılan düzeyde eski tepe genliğini korur', () => {
  const env = load()
  const ctx = new env.sandbox.AudioContext()
  const span = env.api.schedule(ctx, 'message', { when: 0 })
  assert.ok(span.end - span.start < 0.3)
  const peak = env.stats.gains[0].log.find((e) => e[0] === 'exp')[1]
  assert.equal(Math.round(peak * 100) / 100, 0.09)
})

test('çalma: arka plan penceresinde ve bilinmeyen türde çalmaz, ses bağlamı yoksa false', () => {
  assert.equal(load({ background: true }).api.play('join'), false)
  assert.equal(load().api.play('bilinmeyen'), false)
  assert.equal(load({ noAudio: true }).api.play('join'), false)
})

test('çalma: aynı ses kısa sürede bir kez çalar, dinleme düğmesi sınırsızdır, tek bağlam kullanılır', () => {
  let now = 1000000
  const FakeDate = { now: () => now }
  const env = load({ Date: FakeDate })
  assert.equal(env.api.play('join'), true)
  const first = env.stats.oscillators.length
  assert.ok(first > 0)
  assert.equal(env.api.play('join'), true)
  assert.equal(env.stats.oscillators.length, first, 'yineleme çalmadı')
  assert.equal(env.api.play('join', { test: true }), true)
  assert.equal(env.stats.oscillators.length, first * 2, 'dinleme düğmesi çaldı')
  now += 1000
  env.api.play('join')
  assert.equal(env.stats.oscillators.length, first * 3)
  env.api.play('leave')
  assert.equal(env.stats.created, 1)
  // Bağlam ses bitince askıya alınır
  const sleep = env.timers[env.timers.length - 1]
  assert.ok(sleep.ms >= 2000)
})

test('çalma: askıdaki bağlam önce açılır, ses sonra kurulur', async () => {
  const env = load({ startState: 'suspended' })
  assert.equal(env.api.play('dm'), true)
  assert.equal(env.stats.oscillators.length, 0)
  await flush()
  assert.equal(env.stats.resumed, 1)
  assert.ok(env.stats.oscillators.length > 0)
})
