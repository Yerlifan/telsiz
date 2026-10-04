'use strict'

// Gelişmiş gürültü engelleme (RNNoise) gerçek Chromium'da. Sahte mikrofon konuşma içermeyen, yalnızca klavye
// tıkırtısı ve hafif arka plan gürültüsünden oluşan bir WAV dosyasını döngüyle çalar. Deniz ve Mert Lobi'ye
// katılır. Mert'in sayfasında RNNoise düğümü gerçekten hatta girer (AudioWorklet modülü ve wasm kendi
// kökeninden yüklenir, sayfa politikası wasm derlemesine izin verir, durum 'on', ayarlar sayfasında "Etkin"
// açıklaması). Deniz'e ulaşan sesin seviyesi, Deniz'in sayfasında Mert'in uzak ses akışından ölçülür: RNNoise
// açıkken tıkırtılar, ayar kapalıyken ulaşan aynı tıkırtılardan en az 8 dB daha zayıftır. Ayar kapalıyken
// Deniz Mert'i konuşuyor görür. Ayar yeniden açılınca seviye yine düşer. Konsol temizdir.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const h = require('./yardimci')

const W = { w: null, deniz: null, mert: null, lobi: null, dir: null }
// Sahte mikrofona dosya verme bayrağı yalnızca Chromium'da vardır
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []), { browsers: ['chromium'], reason: 'sahte mikrofona dosya yalnızca Chromium bayrağıyla verilir' })

const RATE = 48000

// 4 saniyelik döngü: tuş başına basma ve bırakma tıkırtısı (kısa, sönümlü, geniş bantlı patlama) ve pembe
// benzeri hafif gürültü. Belirlenimci üreteçle her çalıştırmada aynı dosya üretilir.
function keyboardWav () {
  let seed = 12345
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  const n = 4 * RATE
  const data = new Float32Array(n)
  const bandpass = (f0, q) => {
    const w = 2 * Math.PI * f0 / RATE
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
  const click = (start, amp) => {
    const bp = bandpass(3000 + rand() * 2500, 2)
    const thud = bandpass(250 + rand() * 150, 3)
    let i = 0
    while (i < 0.012 * RATE && start + i < n) {
      const w = rand() * 2 - 1
      data[start + i] += amp * Math.exp(-i / (0.0018 * RATE)) * (bp(w) * 3 + thud(w) * 1.5)
      i++
    }
  }
  let at = Math.round(0.05 * RATE)
  while (at < n - 0.2 * RATE) {
    const amp = 0.25 + rand() * 0.15
    click(at, amp)
    click(at + Math.round((0.06 + rand() * 0.05) * RATE), amp * 0.7)
    at += Math.round((0.12 + rand() * 0.15) * RATE)
  }
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let i = 0
  while (i < n) {
    const w = rand() * 2 - 1
    b0 = 0.99765 * b0 + w * 0.099046
    b1 = 0.963 * b1 + w * 0.2965164
    b2 = 0.57 * b2 + w * 1.0526913
    data[i] += (b0 + b1 + b2 + w * 0.1848) * 0.004
    i++
  }
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(RATE, 24)
  buf.writeUInt32LE(RATE * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  i = 0
  while (i < n) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(data[i] * 32767))), 44 + i * 2)
    i++
  }
  return buf
}

before(async () => {
  if (test.skipped) return
  W.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-e2e-ses-'))
  const wav = path.join(W.dir, 'klavye.wav')
  fs.writeFileSync(wav, keyboardWav())
  W.w = await h.setupWorld({ slot: 17, chromiumArgs: ['--use-file-for-fake-audio-capture=' + wav] })
  W.lobi = W.w.room('Lobi')
  W.deniz = await W.w.pageFor('deniz')
  W.mert = await W.w.pageFor('mert')
})

after(async () => {
  try {
    if (W.w) await W.w.close()
  } finally {
    if (W.dir) fs.rmSync(W.dir, { recursive: true, force: true })
  }
})

// Deniz'e ulaşan Mert sesinin ortalama seviyesi (dBFS). Mert'in uzak ses akışı (gizli ses öğesindeki tek akış)
// sayfada ayrı bir ses bağlamında analizörle ms boyunca ölçülür.
async function receivedLevel (ms) {
  return W.deniz.evaluate(async (duration) => {
    const el = document.querySelector('div[data-voice-audio] audio')
    if (!el || !el.srcObject) return null
    if (!window.__olcumBaglami) window.__olcumBaglami = new AudioContext()
    const ac = window.__olcumBaglami
    await ac.resume()
    const src = ac.createMediaStreamSource(el.srcObject)
    const an = ac.createAnalyser()
    an.fftSize = 2048
    src.connect(an)
    const buf = new Float32Array(an.fftSize)
    let sum = 0
    let count = 0
    const end = Date.now() + duration
    while (Date.now() < end) {
      an.getFloatTimeDomainData(buf)
      let i = 0
      while (i < buf.length) {
        sum += buf[i] * buf[i]
        i++
      }
      count += buf.length
      await new Promise((resolve) => setTimeout(resolve, 40))
    }
    src.disconnect()
    return 10 * Math.log10(Math.max(1e-12, sum / Math.max(1, count)))
  }, ms)
}

async function setRnnoiseFromSettings (page, on) {
  await page.evaluate(() => openSettings('voice'))
  await page.waitForSelector('#settings-page[data-cat="voice"] #set-rnnoise')
  const checked = await page.evaluate(() => document.getElementById('set-rnnoise').checked)
  if (checked !== on) await page.click('#set-rnnoise')
  await page.waitForFunction((want) => snap().rnnoise === want, on ? 'on' : 'off', { timeout: h.LONG })
}

test('sayfa politikası yalnızca WebAssembly derlemesine izin verir, işlemci ve wasm kendi kökeninden sunulur', async () => {
  const res = await new Promise((resolve, reject) => {
    require('node:http').get(W.w.base + '/', (r) => {
      r.resume()
      r.on('end', () => resolve(r))
    }).on('error', reject)
  })
  const csp = res.headers['content-security-policy']
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval';/)
  assert.doesNotMatch(csp, /'unsafe-eval'|'unsafe-inline'/)
  const wasm = await W.w.call('GET', '/vendor/rnnoise/rnnoise.wasm')
  assert.equal(wasm.status, 200)
  assert.equal(wasm.buf.length, 152656)
  assert.equal((await W.w.call('GET', '/rnnoise-worklet.js')).status, 200)
})

test('iki kişi Lobi\'ye katılır, Mert\'te RNNoise düğümü gerçekten hatta girer', async () => {
  const { deniz, mert } = W
  await h.joinVoice(mert, W.lobi.id)
  await h.joinVoice(deniz, W.lobi.id)
  for (const page of [deniz, mert]) {
    await page.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 2, null, { timeout: h.LONG })
  }
  await mert.waitForFunction(() => snap().rnnoise === 'on', null, { timeout: h.LONG })
  const r = await mert.evaluate(() => ({ setting: voice.settings().rnnoise, noise: voice.settings().noiseSuppression, fallback: snap().fallback }))
  assert.deepEqual(r, { setting: true, noise: true, fallback: false })
  // Ayarlar sayfasında anahtar açık ve açıklama etkin durumu söyler
  await mert.evaluate(() => openSettings('voice'))
  await mert.waitForSelector('#settings-page[data-cat="voice"] #set-rnnoise')
  const ui = await mert.evaluate(() => ({
    checked: document.getElementById('set-rnnoise').checked,
    label: document.querySelector('label[for="set-rnnoise"] .settings-switch-text').textContent,
    hint: document.getElementById('set-rnnoise-hint').textContent,
    afterNoise: document.getElementById('set-noise').closest('.settings-switch-row').nextElementSibling.contains(document.getElementById('set-rnnoise'))
  }))
  assert.deepEqual(ui, {
    checked: true,
    label: 'Gelişmiş gürültü engelleme (RNNoise)',
    hint: 'Etkin. Mikrofon sesiniz cihazınızda RNNoise ile temizleniyor.',
    afterNoise: true
  })
  await mert.keyboard.press('Escape')
  await mert.waitForSelector('#settings-view', { state: 'hidden' })
})

test('RNNoise açıkken Deniz\'e ulaşan tıkırtılar, ayar kapalıyken ulaşanlardan en az 8 dB zayıftır', async (t) => {
  const { deniz, mert } = W
  const mertId = W.w.P.mert.id
  // Düğüm hatta girdikten sonra kısa bir oturma süresi
  await h.sleep(1500)
  const on = await receivedLevel(4000)
  assert.equal(typeof on, 'number', 'Mert\'in uzak ses akışı bulunamadı')
  await setRnnoiseFromSettings(mert, false)
  // Mikrofon yeniden alınmadan yalnızca hat değişir, ses tarayıcının kendi işlemesiyle gider
  await deniz.waitForFunction((id) => {
    const p = snap().peers[id]
    return Boolean(p && p.speaking)
  }, mertId, { timeout: h.LONG })
  await h.sleep(1000)
  const off = await receivedLevel(4000)
  await setRnnoiseFromSettings(mert, true)
  await mert.keyboard.press('Escape')
  await mert.waitForSelector('#settings-view', { state: 'hidden' })
  await h.sleep(1500)
  const again = await receivedLevel(4000)
  const report = 'açık ' + on.toFixed(1) + ' dB, kapalı ' + off.toFixed(1) + ' dB, yeniden açık ' + again.toFixed(1) + ' dB'
  t.diagnostic(report)
  assert.ok(off - on >= 8, report)
  assert.ok(off - again >= 8, report)
})

test('sesten ayrılınca düğüm kapanır, konsol ve sunucu günlüğü temiz', async () => {
  const { deniz, mert } = W
  await mert.click('#voice-leave')
  await mert.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
  assert.equal(await mert.evaluate(() => snap().rnnoise), 'idle')
  await deniz.click('#voice-leave')
  await deniz.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
  h.assertCleanConsole(W.w.logs, W.w.srv.errors)
})
