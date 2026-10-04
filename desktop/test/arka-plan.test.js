'use strict'

// Arka plan sayımı (src/lib/background.js): rapor doğrulaması, üst sınır ve sıra, geçişte pencere takası,
// oturumu olmayan frekansın kapatılması, çökmede gecikmeli yeniden açma, erişilebilirlik yoklamasının
// seyrelmesi (sahte yoklama ve sahte saatle) ve ana süreçteki sertleştirmelerin kaynakta bulunması.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const bg = require('../src/lib/background')

const A = 'https://a.ornek.com'
const B = 'https://b.ornek.com:8443'
const L = 'http://localhost:4800'

// Sahte saat: zamanlayıcılar yalnızca advance ile çalışır
function fakeClock () {
  let now = 1000
  let seq = 0
  const timers = new Map()
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      seq += 1
      timers.set(seq, { at: now + Math.max(0, ms), fn })
      return seq
    },
    clearTimer: (id) => {
      timers.delete(id)
    },
    async advance (ms) {
      const end = now + ms
      while (true) {
        let nextId = null
        let next = null
        for (const [id, timer] of timers) {
          if (timer.at <= end && (!next || timer.at < next.at)) {
            next = timer
            nextId = id
          }
        }
        if (!next) break
        timers.delete(nextId)
        now = Math.max(now, next.at)
        next.fn()
        // Yoklama sözlerinin çözülmesine izin verilir
        await new Promise((resolve) => setImmediate(resolve))
      }
      now = end
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
}

function makeWorld (list, active, opts) {
  const o = opts || {}
  const clock = fakeClock()
  const w = { clock, list, active, windows: [], destroyed: [], pushes: [], probes: [], names: [], probeResult: o.probeResult || (() => true), nextId: 100 }
  w.manager = bg.createManager({
    frequencies: () => w.list,
    active: () => w.active,
    createWindow: (origin) => {
      w.nextId += 1
      const handle = { id: w.nextId, origin, destroy: () => w.destroyed.push(origin) }
      w.windows.push(handle)
      return handle
    },
    probe: (origin) => {
      w.probes.push({ origin, at: clock.now() })
      return Promise.resolve(w.probeResult(origin))
    },
    push: (snapshot) => w.pushes.push(snapshot),
    setName: (origin, name) => w.names.push([origin, name]),
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    now: clock.now,
    max: o.max
  })
  w.idOf = (origin) => {
    const list = w.windows.filter((h) => h.origin === origin)
    return list.length ? list[list.length - 1].id : null
  }
  return w
}

function report (origin, fields) {
  return Object.assign({ origin, state: 'ok', unread: 0, mention: 0, online: true, lastError: null, name: null, onlineUsers: null }, fields || {})
}

test('rapor doğrulaması: köken pencereninkiyle aynı, alanlar türü ve sınırıyla, bilinmeyen alan yok', () => {
  const ok = bg.validateReport(report(A, { unread: 5, mention: 2, name: '  Kankalar ', onlineUsers: 3 }), A)
  assert.deepEqual(ok, { origin: A, state: 'ok', unread: 5, mention: 2, online: true, lastError: null, name: 'Kankalar', onlineUsers: 3 })
  assert.equal(bg.validateReport(report(A), B), null, 'başka frekansın kökeni')
  assert.equal(bg.validateReport(report('http://kotu.com'), 'http://kotu.com'), null, 'uzak http')
  assert.equal(bg.validateReport(Object.assign(report(A), { fazla: 1 }), A), null, 'bilinmeyen alan')
  assert.equal(bg.validateReport(report(A, { state: 'hazir' }), A), null)
  assert.equal(bg.validateReport(report(A, { unread: -1 }), A), null)
  assert.equal(bg.validateReport(report(A, { unread: 1.5 }), A), null)
  assert.equal(bg.validateReport(report(A, { mention: 100001 }), A), null)
  assert.equal(bg.validateReport(report(A, { unread: '3' }), A), null)
  assert.equal(bg.validateReport(report(A, { online: 'evet' }), A), null)
  assert.equal(bg.validateReport(report(A, { lastError: 'bilinmez' }), A), null)
  assert.equal(bg.validateReport(report(A, { name: 7 }), A), null)
  assert.equal(bg.validateReport(report(A, { name: 'x'.repeat(1001) }), A), null)
  assert.equal(bg.validateReport(report(A, { onlineUsers: -3 }), A), null)
  assert.equal(bg.validateReport(null, A), null)
  assert.equal(bg.validateReport([report(A)], A), null)
  assert.equal(bg.validateReport(report(A, { name: 'Satır\nsonu' }), A).name, 'Satır sonu')
  assert.equal(bg.validateReport(report(L, { state: 'login', online: null, lastError: 'session' }), L).state, 'login')
})

test('yoklama ve yeniden açma aralıkları seyrelir ve sınırlıdır', () => {
  assert.equal(bg.probeDelay(0), 60000)
  assert.equal(bg.probeDelay(1), 120000)
  assert.equal(bg.probeDelay(2), 240000)
  assert.equal(bg.probeDelay(4), 600000)
  assert.equal(bg.probeDelay(50), 600000)
  assert.equal(bg.restartDelay(1), 30000)
  assert.equal(bg.restartDelay(2), 60000)
  assert.equal(bg.restartDelay(20), 600000)
})

test('hedefler: açık frekans hariç, en son kullanılan önce, en fazla 8', () => {
  const list = Array.from({ length: 12 }, (_, i) => ({ origin: 'https://f' + i + '.com', lastUsed: i }))
  const targets = bg.pickTargets(list, 'https://f11.com', bg.MAX_WINDOWS)
  assert.equal(bg.MAX_WINDOWS, 8)
  assert.deepEqual(targets, ['https://f10.com', 'https://f9.com', 'https://f8.com', 'https://f7.com', 'https://f6.com', 'https://f5.com', 'https://f4.com', 'https://f3.com'])
  assert.deepEqual(bg.pickTargets([{ origin: A }, { origin: B }, { origin: 'kotu' }], null, 8), [A, B])
})

test('açılışta pencereler gecikmeyle ve teker teker açılır, üst sınır aşılmaz', async () => {
  const list = Array.from({ length: 10 }, (_, i) => ({ origin: 'https://f' + i + '.com', lastUsed: i + 1 }))
  const w = makeWorld(list, 'https://f9.com', { max: 3 })
  w.manager.setActive('https://f9.com')
  await w.clock.advance(bg.START_DELAY_MS - 1)
  assert.equal(w.windows.length, 0, 'gecikmeden önce pencere yok')
  await w.clock.advance(1)
  assert.deepEqual(w.windows.map((h) => h.origin), ['https://f8.com'])
  await w.clock.advance(bg.STAGGER_MS)
  await w.clock.advance(bg.STAGGER_MS)
  await w.clock.advance(bg.STAGGER_MS * 5)
  assert.deepEqual(w.windows.map((h) => h.origin), ['https://f8.com', 'https://f7.com', 'https://f6.com'])
  assert.equal(w.manager.windowCount(), 3)
  // Yoklama üst sınırın dışındaki frekanslar için de yapılır, açık frekans yoklanmaz
  const probed = new Set(w.probes.map((p) => p.origin))
  assert.equal(probed.size, 9)
  assert.ok(!probed.has('https://f9.com'))
})

test('geçiş: hedef frekansın penceresi hemen kapanır, önceki frekansa gecikmeyle pencere açılır', async () => {
  const w = makeWorld([{ origin: A, lastUsed: 2 }, { origin: B, lastUsed: 1 }], A)
  w.manager.setActive(A)
  await w.clock.advance(bg.START_DELAY_MS)
  assert.deepEqual(w.windows.map((h) => h.origin), [B])
  const bId = w.idOf(B)
  assert.equal(w.manager.ownerOf(bId), B)
  assert.equal(w.manager.report(bId, report(B, { unread: 4, mention: 1 })), true)
  // Kullanıcı B'ye geçer
  w.active = B
  w.list = [{ origin: A, lastUsed: 2 }, { origin: B, lastUsed: 3 }]
  w.manager.setActive(B)
  assert.deepEqual(w.destroyed, [B], 'B penceresi uygulama penceresinden önce kapandı')
  assert.equal(w.manager.ownerOf(bId), null)
  assert.equal(w.manager.report(bId, report(B, { unread: 9 })), false, 'kapanan pencerenin raporu reddedilir')
  await w.clock.advance(bg.START_DELAY_MS - 1)
  assert.equal(w.windows.length, 1)
  await w.clock.advance(1)
  assert.deepEqual(w.windows.map((h) => h.origin), [B, A])
  await w.clock.advance(1000)
  const snap = w.manager.snapshot()
  const byOrigin = Object.fromEntries(snap.items.map((item) => [item.origin, item]))
  assert.equal(byOrigin[B].active, true)
  assert.equal(byOrigin[B].unread, 0, 'açık frekansın sayısı arka plandan gelmez')
  assert.equal(byOrigin[A].background, true)
  assert.equal(snap.max, 8)
})

test('rapor yalnızca kayıtlı pencereden, sayılar ve ad işlenir, durum gönderilir', async () => {
  const w = makeWorld([{ origin: A, lastUsed: 2 }, { origin: B, lastUsed: 1 }], A)
  w.manager.setActive(A)
  await w.clock.advance(bg.START_DELAY_MS)
  const id = w.idOf(B)
  assert.equal(w.manager.report(999, report(B, { unread: 3 })), false, 'bilinmeyen gönderen')
  assert.equal(w.manager.report(id, report(A, { unread: 3 })), false, 'başka kökenin raporu')
  assert.equal(w.manager.report(id, Object.assign(report(B), { unread: 'çok' })), false)
  assert.equal(w.manager.report(id, report(B, { unread: 7, mention: 2, name: 'Bee', onlineUsers: 5 })), true)
  await w.clock.advance(400)
  const last = w.pushes[w.pushes.length - 1]
  const item = last.items.filter((entry) => entry.origin === B)[0]
  assert.deepEqual(item, { origin: B, active: false, background: true, state: 'ok', unread: 7, mention: 2, online: true, lastError: null, onlineUsers: 5 })
  assert.deepEqual(w.names, [[B, 'Bee']])
  // Durum gönderimi seyreltilir: art arda raporlar tek gönderimde toplanır
  const before = w.pushes.length
  w.manager.report(id, report(B, { unread: 8 }))
  w.manager.report(id, report(B, { unread: 9 }))
  await w.clock.advance(400)
  assert.equal(w.pushes.length, before + 1)
  assert.equal(w.pushes[w.pushes.length - 1].items.filter((entry) => entry.origin === B)[0].unread, 9)
})

test('giriş gerekli: pencere kapanır, frekans açılana kadar yeniden açılmaz', async () => {
  const w = makeWorld([{ origin: A, lastUsed: 2 }, { origin: B, lastUsed: 1 }], A)
  w.manager.setActive(A)
  await w.clock.advance(bg.START_DELAY_MS)
  const id = w.idOf(B)
  assert.equal(w.manager.report(id, report(B, { state: 'login', online: true, lastError: 'session' })), true)
  assert.deepEqual(w.destroyed, [B])
  assert.equal(w.manager.windowCount(), 0)
  w.manager.windowGone(id)
  w.manager.listChanged()
  await w.clock.advance(bg.RESTART_DELAY_MS * 4)
  assert.equal(w.windows.length, 1, 'yeniden açılmadı')
  assert.equal(w.manager.snapshot().items.filter((item) => item.origin === B)[0].state, 'login')
  // Kullanıcı B'yi açıp A'ya döner: B yeniden sayılır
  w.active = B
  w.manager.setActive(B)
  await w.clock.advance(bg.START_DELAY_MS)
  w.active = A
  w.manager.setActive(A)
  await w.clock.advance(bg.START_DELAY_MS)
  assert.deepEqual(w.windows.map((h) => h.origin), [B, A, B])
})

test('çöken pencere gecikmeyle ve seyrelerek yeniden açılır, durdurunca hepsi kapanır', async () => {
  const w = makeWorld([{ origin: A, lastUsed: 2 }, { origin: B, lastUsed: 1 }, { origin: L, lastUsed: 0 }], A)
  w.manager.setActive(A)
  await w.clock.advance(bg.START_DELAY_MS + bg.STAGGER_MS)
  assert.deepEqual(w.windows.map((h) => h.origin), [B, L])
  assert.equal(w.manager.windowGone(w.idOf(B)), true)
  assert.equal(w.manager.windowGone(12345), false)
  assert.equal(w.manager.snapshot().items.filter((item) => item.origin === B)[0].state, 'error')
  await w.clock.advance(bg.RESTART_DELAY_MS - 10)
  assert.equal(w.windows.length, 2)
  await w.clock.advance(10)
  assert.deepEqual(w.windows.map((h) => h.origin), [B, L, B])
  // İkinci çökme: bekleme iki katı
  w.manager.windowGone(w.idOf(B))
  await w.clock.advance(bg.RESTART_DELAY_MS)
  assert.equal(w.windows.length, 3)
  await w.clock.advance(bg.RESTART_DELAY_MS)
  assert.equal(w.windows.length, 4)
  w.manager.stop()
  assert.equal(w.manager.windowCount(), 0)
  assert.equal(w.manager.isRunning(), false)
  assert.ok(w.destroyed.includes(B) && w.destroyed.includes(L))
  const count = w.windows.length
  await w.clock.advance(bg.PROBE_MAX_MS * 2)
  assert.equal(w.windows.length, count, 'durduktan sonra pencere açılmaz')
})

test('listeden çıkarılan frekansın penceresi kapanır', async () => {
  const w = makeWorld([{ origin: A, lastUsed: 2 }, { origin: B, lastUsed: 1 }], A)
  w.manager.setActive(A)
  await w.clock.advance(bg.START_DELAY_MS)
  w.list = [{ origin: A, lastUsed: 2 }]
  w.manager.listChanged()
  await w.clock.advance(1)
  assert.deepEqual(w.destroyed, [B])
  assert.deepEqual(w.manager.snapshot().items.map((item) => item.origin), [A])
})

test('erişilebilirlik yoklaması: başarıda 60 saniyede bir, hatada katlanarak seyrelir', async () => {
  let up = false
  const w = makeWorld([{ origin: A, lastUsed: 2 }, { origin: B, lastUsed: 1 }], A, { max: 0, probeResult: () => up })
  w.manager.setActive(A)
  await w.clock.advance(bg.START_DELAY_MS)
  const times = () => w.probes.filter((p) => p.origin === B).map((p) => p.at)
  assert.equal(times().length, 1)
  await w.clock.advance(1000)
  assert.equal(w.manager.snapshot().items.filter((item) => item.origin === B)[0].online, false)
  await w.clock.advance(bg.PROBE_INTERVAL_MS * 2 + 10)
  await w.clock.advance(bg.PROBE_INTERVAL_MS * 4 + 10)
  const t = times()
  assert.equal(t.length, 3)
  assert.equal(t[1] - t[0], 120000)
  assert.equal(t[2] - t[1], 240000)
  up = true
  await w.clock.advance(bg.PROBE_INTERVAL_MS * 8 + 10)
  await w.clock.advance(bg.PROBE_INTERVAL_MS + 10)
  const t2 = times()
  assert.equal(t2.length, 5)
  assert.equal(t2[4] - t2[3], 60000, 'başarıdan sonra normal aralık')
  assert.equal(w.manager.snapshot().items.filter((item) => item.origin === B)[0].online, true)
  assert.equal(w.windows.length, 0, 'üst sınır 0 iken pencere açılmaz')
})

test('ana süreç: arka plan penceresi sertleştirmeleri ve gönderen denetimi kaynakta bulunur', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n')
  const start = main.indexOf('function createBackgroundWindow (origin) {')
  assert.ok(start !== -1)
  const body = main.slice(start, main.indexOf('\n}\n', start))
  for (const needle of ['show: false', 'skipTaskbar: true', 'backgroundThrottling: false', 'images: false', 'setAudioMuted(true)', 'BACKGROUND_ARG + origin', "state.contexts.set(id, 'background')", "path.join(__dirname, 'preload.js')", 'partitionFor(origin)']) {
    assert.ok(body.includes(needle), needle)
  }
  assert.ok(main.includes("if (context === 'background' && !backgroundWindows.ownerOf(contents.id)) return false"))
  assert.ok(main.includes("if (senderIs(event, 'background')) backgroundWindows.report(event.sender.id, report)"))
  assert.ok(main.includes("contextOf(contents) === 'background' && permission !== 'notifications'"))
  assert.ok(main.includes('backgroundWindows.stop()'))
})
