'use strict'

// Ses odası sınırları ve kameralar: sahibin ayarı (kapasite, kameralar açık mı, oda başına kamera sınırı),
// doğrulama ve yetki, kalıcılık ve meta yayını, kapasitenin katılmada uygulanması, kamera açık bilgisinin
// sunucudan geçmesi ve sınırın uygulanması, sunucu bilgileri ucu (GET /api/server-info) ve src/system-info.js
// içindeki cgroup ve statfs yedekleri.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const h = require('./server-yardimci')
const systemInfo = require('../src/system-info')

async function room (options) {
  const ctx = await h.startServer(options)
  const owner = await h.setupOwner(ctx)
  const ayse = await h.addUser(ctx, owner.token, 'ayse')
  const mehmet = await h.addUser(ctx, owner.token, 'mehmet')
  const zeynep = await h.addUser(ctx, owner.token, 'zeynep')
  return { ctx, owner, ayse, mehmet, zeynep }
}

function join (ctx, token, channelId) {
  return h.post(ctx, '/api/voice/join', token, { channelId })
}

function camera (ctx, token, on, lang) {
  return h.request(ctx, 'POST', '/api/voice/camera', { token, body: { on }, headers: lang ? { 'accept-language': lang } : undefined })
}

function settings (ctx, token, voice, lang) {
  return h.request(ctx, 'POST', '/api/settings', { token, body: { voice }, headers: lang ? { 'accept-language': lang } : undefined })
}

async function metaOf (ctx, token) {
  return (await h.stateOf(ctx, token)).meta
}

describe('ses odası ayarları', () => {
  it('varsayılanlar metada ve sınırlar /api/info içinde', async () => {
    const { ctx, owner, ayse } = await room()
    try {
      const meta = await metaOf(ctx, ayse.token)
      assert.deepEqual(meta.voiceSettings, { capacity: 8, cameras: true, maxCameras: 4 })
      const info = await h.get(ctx, '/api/info')
      assert.equal(info.data.limits.voiceCapacityMin, 2)
      assert.equal(info.data.limits.voiceCapacityMax, 12)
      assert.equal(info.data.limits.maxCamerasMin, 1)
      assert.equal(info.data.limits.maxCamerasMax, 12)
      assert.ok(owner)
    } finally {
      await ctx.cleanup()
    }
  })

  it('maxVoicePerChannel seçeneği kapasitenin varsayılanıdır ve aralığa sıkıştırılır', async () => {
    for (const [option, capacity, maxCameras] of [[5, 5, 4], [3, 3, 3], [1, 2, 2], [40, 12, 4]]) {
      const ctx = await h.startServer({ maxVoicePerChannel: option })
      try {
        const owner = await h.setupOwner(ctx)
        assert.deepEqual((await metaOf(ctx, owner.token)).voiceSettings, { capacity, cameras: true, maxCameras }, String(option))
      } finally {
        await ctx.cleanup()
      }
    }
  })

  it('doğrulama: aralık, tür, bilinmeyen alan ve kapasiteyi aşan kamera sınırı', async () => {
    const { ctx, owner } = await room()
    try {
      const bad = [
        null, 'x', [], {}, { capacity: 1 }, { capacity: 13 }, { capacity: 4.5 }, { capacity: '6' },
        { maxCameras: 0 }, { maxCameras: 13 }, { maxCameras: 2.5 }, { cameras: 'evet' }, { cameras: 1 },
        { other: 1 }, { capacity: 6, other: true }, { maxCameras: 9 }, { capacity: 3, maxCameras: 4 }
      ]
      for (const body of bad) h.expectStatus(await settings(ctx, owner.token, body), 400, 'invalid_voice_settings')
      const tr = await settings(ctx, owner.token, { capacity: 13 }, 'tr')
      assert.match(tr.data.error, /2 ile 12/)
      const en = await settings(ctx, owner.token, { capacity: 13 }, 'en')
      assert.match(en.data.error, /between 2 and 12/)
      // Hiçbir geçersiz istek ayarı değiştirmedi
      assert.deepEqual((await metaOf(ctx, owner.token)).voiceSettings, { capacity: 8, cameras: true, maxCameras: 4 })
    } finally {
      await ctx.cleanup()
    }
  })

  it('yalnızca sahip değiştirir, yönetici ve üye 403 alır', async () => {
    const { ctx, owner, ayse, mehmet } = await room()
    try {
      await h.makeAdmin(ctx, owner.token, ayse.user.id)
      const admin = await settings(ctx, ayse.token, { capacity: 6 }, 'tr')
      h.expectStatus(admin, 403, 'forbidden')
      assert.match(admin.data.error, /yalnızca sahip/)
      h.expectStatus(await settings(ctx, mehmet.token, { capacity: 6 }), 403, 'forbidden')
      // Yönetici ayarları metada salt okunur görür
      assert.deepEqual((await metaOf(ctx, ayse.token)).voiceSettings, { capacity: 8, cameras: true, maxCameras: 4 })
    } finally {
      await ctx.cleanup()
    }
  })

  it('kaydedilir, meta sürümü artar ve yeniden başlatmadan sonra korunur', async () => {
    const { ctx, owner, ayse } = await room()
    let current = ctx
    try {
      const before = await h.stateOf(ctx, ayse.token)
      const res = await settings(ctx, owner.token, { capacity: 10, maxCameras: 6 })
      h.expectStatus(res, 200)
      assert.deepEqual(res.data.voice, { capacity: 10, cameras: true, maxCameras: 6 })
      const p = h.poller(ctx, ayse.token, before)
      const polled = await p.poll()
      h.expectStatus(polled, 200)
      assert.deepEqual(polled.data.meta.voiceSettings, { capacity: 10, cameras: true, maxCameras: 6 })
      // Yanıt durum dosyası diske yazıldıktan sonra gelir
      const saved = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8'))
      assert.deepEqual(saved.voice, { capacity: 10, cameras: true, maxCameras: 6 })
      h.expectStatus(await settings(ctx, owner.token, { cameras: false }), 200)
      current = await ctx.restart()
      const login = await h.login(current, 'ayse')
      h.expectStatus(login, 200)
      assert.deepEqual((await metaOf(current, login.data.token)).voiceSettings, { capacity: 10, cameras: false, maxCameras: 6 })
    } finally {
      await current.cleanup()
    }
  })

  it('eski durum dosyası (voice alanı yok) varsayılanlarla açılır, bozuk değer düzeltilir', async () => {
    const ctx = await h.startServer()
    let current = ctx
    try {
      const owner = await h.setupOwner(ctx)
      assert.ok(owner.token)
      await ctx.stop()
      const file = path.join(ctx.dataDir, 'state.json')
      const st = JSON.parse(fs.readFileSync(file, 'utf8'))
      delete st.voice
      fs.writeFileSync(file, JSON.stringify(st))
      current = await h.startServer({ maxVoicePerChannel: 6 }, ctx.root)
      let login = await h.login(current, 'sahip')
      assert.deepEqual((await metaOf(current, login.data.token)).voiceSettings, { capacity: 6, cameras: true, maxCameras: 4 })
      await current.stop()
      const st2 = JSON.parse(fs.readFileSync(file, 'utf8'))
      st2.voice = { capacity: 99, cameras: 'x', maxCameras: 11 }
      fs.writeFileSync(file, JSON.stringify(st2))
      current = await h.startServer({}, ctx.root)
      login = await h.login(current, 'sahip')
      assert.deepEqual((await metaOf(current, login.data.token)).voiceSettings, { capacity: 8, cameras: true, maxCameras: 8 })
    } finally {
      await current.cleanup()
    }
  })
})

describe('ses odası kapasitesi', () => {
  it('katılma durumdaki kapasiteyle sınırlanır, düşürülen kapasite kimseyi çıkarmaz', async () => {
    const { ctx, owner, ayse, mehmet, zeynep } = await room()
    try {
      h.expectStatus(await settings(ctx, owner.token, { capacity: 2, maxCameras: 2 }), 200)
      h.expectStatus(await join(ctx, owner.token, 3), 200)
      h.expectStatus(await join(ctx, ayse.token, 3), 200)
      h.expectStatus(await join(ctx, mehmet.token, 3), 409, 'voice_full')
      h.expectStatus(await settings(ctx, owner.token, { capacity: 3 }), 200)
      h.expectStatus(await join(ctx, mehmet.token, 3), 200)
      // Kapasite 2'ye inince içerideki üç kişi kalır, yeni gelen giremez
      h.expectStatus(await settings(ctx, owner.token, { capacity: 2 }), 200)
      assert.equal((await metaOf(ctx, owner.token)).voice['3'].length, 3)
      h.expectStatus(await join(ctx, zeynep.token, 3), 409, 'voice_full')
      // Diğer ses odası etkilenmez
      h.expectStatus(await join(ctx, zeynep.token, 4), 200)
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('kameralar', () => {
  it('açık bilgisi kadroda görünür, sınır dolunca 409 camera_limit', async () => {
    const { ctx, owner, ayse, mehmet, zeynep } = await room()
    try {
      h.expectStatus(await settings(ctx, owner.token, { maxCameras: 2 }), 200)
      for (const u of [owner, ayse, mehmet, zeynep]) h.expectStatus(await join(ctx, u.token, 3), 200)
      const on = await camera(ctx, owner.token, true)
      h.expectStatus(on, 200)
      assert.equal(on.data.camera, true)
      // Aynı durumu yeniden bildirmek sayıyı artırmaz
      h.expectStatus(await camera(ctx, owner.token, true), 200)
      h.expectStatus(await camera(ctx, ayse.token, true), 200)
      const full = await camera(ctx, mehmet.token, true, 'tr')
      h.expectStatus(full, 409, 'camera_limit')
      assert.match(full.data.error, /en fazla 2 kamera/)
      const fullEn = await camera(ctx, mehmet.token, true, 'en')
      assert.match(fullEn.data.error, /At most 2 cameras/)
      let list = (await metaOf(ctx, zeynep.token)).voice['3']
      assert.deepEqual(list.map((m) => [m.userId, m.camera]), [[owner.user.id, true], [ayse.user.id, true], [mehmet.user.id, false], [zeynep.user.id, false]])
      // Kapatmak her zaman serbesttir, yer açılınca başkası açabilir
      h.expectStatus(await camera(ctx, mehmet.token, false), 200)
      h.expectStatus(await camera(ctx, ayse.token, false), 200)
      h.expectStatus(await camera(ctx, mehmet.token, true), 200)
      // Başka odadaki kameralar sayılmaz
      h.expectStatus(await join(ctx, zeynep.token, 4), 200)
      h.expectStatus(await camera(ctx, zeynep.token, true), 200)
      // Ses odasından ayrılmak ve oda değiştirmek kamerayı kapatır
      h.expectStatus(await h.post(ctx, '/api/voice/leave', mehmet.token), 200)
      h.expectStatus(await join(ctx, owner.token, 4), 200)
      list = (await metaOf(ctx, zeynep.token)).voice['4']
      assert.deepEqual(list.map((m) => [m.userId, m.camera]), [[zeynep.user.id, true], [owner.user.id, false]])
      assert.deepEqual((await metaOf(ctx, zeynep.token)).voice['3'].map((m) => m.camera), [false])
    } finally {
      await ctx.cleanup()
    }
  })

  it('ses odası dışında 403, geçersiz gövde 400', async () => {
    const { ctx, ayse } = await room()
    try {
      h.expectStatus(await camera(ctx, ayse.token, true), 403, 'not_in_voice')
      h.expectStatus(await camera(ctx, ayse.token, false), 403, 'not_in_voice')
      h.expectStatus(await join(ctx, ayse.token, 3), 200)
      for (const bad of [{}, { on: 'true' }, { on: 1 }, { on: null }]) {
        h.expectStatus(await h.post(ctx, '/api/voice/camera', ayse.token, bad), 400, 'bad_request')
      }
      h.expectStatus(await h.post(ctx, '/api/voice/camera', null, { on: true }), 401, 'invalid_token')
    } finally {
      await ctx.cleanup()
    }
  })

  it('sahip kameraları kapatınca açık kameralar kapanır ve açılamaz', async () => {
    const { ctx, owner, ayse, mehmet } = await room()
    try {
      for (const u of [owner, ayse, mehmet]) h.expectStatus(await join(ctx, u.token, 3), 200)
      h.expectStatus(await camera(ctx, ayse.token, true), 200)
      h.expectStatus(await camera(ctx, mehmet.token, true), 200)
      const before = await h.stateOf(ctx, ayse.token)
      h.expectStatus(await settings(ctx, owner.token, { cameras: false }), 200)
      const p = h.poller(ctx, ayse.token, before)
      const polled = await p.poll()
      assert.deepEqual(polled.data.meta.voice['3'].map((m) => m.camera), [false, false, false])
      assert.equal(polled.data.meta.voiceSettings.cameras, false)
      const res = await camera(ctx, ayse.token, true, 'tr')
      h.expectStatus(res, 403, 'camera_disabled')
      assert.match(res.data.error, /Kameralar bu frekansta kapalı/)
      h.expectStatus(await camera(ctx, ayse.token, false), 200)
      h.expectStatus(await settings(ctx, owner.token, { cameras: true }), 200)
      h.expectStatus(await camera(ctx, ayse.token, true), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kamera sınırını düşürmek açık kameraları kapatmaz, yeni açılışa uygulanır', async () => {
    const { ctx, owner, ayse, mehmet } = await room()
    try {
      for (const u of [owner, ayse, mehmet]) h.expectStatus(await join(ctx, u.token, 3), 200)
      h.expectStatus(await camera(ctx, owner.token, true), 200)
      h.expectStatus(await camera(ctx, ayse.token, true), 200)
      h.expectStatus(await settings(ctx, owner.token, { maxCameras: 1 }), 200)
      assert.deepEqual((await metaOf(ctx, owner.token)).voice['3'].map((m) => m.camera), [true, true, false])
      h.expectStatus(await camera(ctx, mehmet.token, true), 409, 'camera_limit')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('sunucu bilgileri', () => {
  it('yalnızca sahip ve yöneticiler alır, yanıt biçimi', async () => {
    const { ctx, owner, ayse, mehmet } = await room({ iceServers: [{ urls: 'stun:stun.example.org:3478' }, { urls: ['turn:127.0.0.1:3478?transport=udp'], username: 'u', credential: 'p' }] })
    try {
      h.expectStatus(await h.get(ctx, '/api/server-info', mehmet.token), 403, 'forbidden')
      h.expectStatus(await h.get(ctx, '/api/server-info', null), 401, 'invalid_token')
      await h.makeAdmin(ctx, owner.token, ayse.user.id)
      h.expectStatus(await join(ctx, ayse.token, 3), 200)
      h.expectStatus(await camera(ctx, ayse.token, true), 200)
      await h.sendMessage(ctx, owner.token, 1)
      await h.sendMessage(ctx, owner.token, 1)
      for (const token of [owner.token, ayse.token]) {
        const res = await h.get(ctx, '/api/server-info', token)
        h.expectStatus(res, 200)
        const d = res.data
        assert.equal(typeof d.cpu.cores, 'number')
        assert.ok(d.cpu.cores >= 1)
        assert.ok(d.cpu.model === null || typeof d.cpu.model === 'string')
        assert.ok(d.cpu.loadavg === null || (Array.isArray(d.cpu.loadavg) && d.cpu.loadavg.length === 3))
        assert.ok(d.memory.total > 0 && d.memory.free >= 0)
        assert.ok(d.memory.cgroupLimit === null || d.memory.cgroupLimit > 0)
        assert.ok(d.memory.processRss > 0)
        assert.ok(d.disk === null || (d.disk.total > 0 && d.disk.free >= 0 && d.disk.free <= d.disk.total))
        assert.equal(d.node, process.version)
        assert.equal(d.platform, process.platform)
        assert.equal(typeof d.uptime, 'number')
        assert.equal(typeof d.version, 'string')
        assert.equal(d.data.messageCount, 2)
        assert.equal(d.data.uploadsBytes, 0)
        assert.equal(d.data.maxTotalMessages, 500000)
        assert.equal(d.data.uploadQuotaBytes, 2048 * 1024 * 1024)
        assert.equal(d.data.users, 4)
        assert.ok(d.online >= 2)
        assert.deepEqual(d.voice, { inVoice: 1, cameras: 1 })
        assert.deepEqual(d.turn, { configured: true, local: true })
      }
    } finally {
      await ctx.cleanup()
    }
  })

  it('TURN yoksa configured false', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const res = await h.get(ctx, '/api/server-info', owner.token)
      h.expectStatus(res, 200)
      assert.deepEqual(res.data.turn, { configured: false, local: false })
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('system-info yedekleri', () => {
  it('cgroup bellek sınırı: v2, v1, max, sınırsız ve okuma hataları', async () => {
    const reader = (files) => async (file) => {
      if (Object.prototype.hasOwnProperty.call(files, file)) return files[file]
      const err = new Error('yok')
      err.code = 'ENOENT'
      throw err
    }
    const [v2, v1] = systemInfo.CGROUP_FILES
    assert.equal(await systemInfo.cgroupMemoryLimit(reader({ [v2]: '536870912\n' })), 536870912)
    assert.equal(await systemInfo.cgroupMemoryLimit(reader({ [v2]: 'max\n' })), null)
    assert.equal(await systemInfo.cgroupMemoryLimit(reader({ [v1]: '1073741824' })), 1073741824)
    assert.equal(await systemInfo.cgroupMemoryLimit(reader({ [v1]: '9223372036854771712' })), null)
    assert.equal(await systemInfo.cgroupMemoryLimit(reader({ [v2]: 'bozuk' })), null)
    assert.equal(await systemInfo.cgroupMemoryLimit(reader({ [v2]: 'max', [v1]: '268435456' })), 268435456)
    assert.equal(await systemInfo.cgroupMemoryLimit(reader({})), null)
    assert.equal(await systemInfo.cgroupMemoryLimit(async () => { throw new Error('EACCES') }), null)
    for (const bad of ['', '0', '-5', '12.5', ' ', null]) assert.equal(systemInfo.parseCgroupLimit(bad), null, String(bad))
  })

  it('disk alanı: statfs yoksa, hata verirse veya geçersiz değer dönerse null', async () => {
    assert.deepEqual(await systemInfo.diskSpace('/veri', async () => ({ bsize: 4096, blocks: 1000, bavail: 250, bfree: 300 })), { total: 4096000, free: 1024000 })
    assert.equal(await systemInfo.diskSpace('/veri', null), null)
    assert.equal(await systemInfo.diskSpace('/veri', async () => { throw new Error('ENOSYS') }), null)
    assert.equal(await systemInfo.diskSpace('/veri', async () => ({ bsize: 0, blocks: 10, bavail: 1 })), null)
    assert.equal(await systemInfo.diskSpace('/veri', async () => null), null)
    // Gerçek statfs (Node 18.15 ve sonrası) veri klasörü için sayı döner
    const real = await systemInfo.diskSpace(__dirname)
    if (real !== null) assert.ok(real.total > 0 && real.free >= 0)
  })

  it('collect: Windows yük ortalaması vermez, işlemci listesi boş olabilir', async () => {
    const fakeOs = {
      cpus: () => [],
      availableParallelism: () => 3,
      loadavg: () => [0, 0, 0],
      platform: () => 'win32',
      arch: () => 'x64',
      totalmem: () => 2048,
      freemem: () => 1024
    }
    const facts = await systemInfo.collect({ dataDir: '/yok', os: fakeOs, statfs: null, readFile: async () => { throw new Error('yok') } })
    assert.deepEqual(facts.cpu, { model: null, cores: 3, loadavg: null })
    assert.deepEqual({ total: facts.memory.total, free: facts.memory.free, cgroupLimit: facts.memory.cgroupLimit }, { total: 2048, free: 1024, cgroupLimit: null })
    assert.equal(facts.disk, null)
    assert.equal(facts.platform, 'win32')
    const linux = await systemInfo.collect({ os: Object.assign({}, fakeOs, { platform: () => 'linux', loadavg: () => [0.5, 1.234, 2], cpus: () => [{ model: '  Örnek   CPU  ' }, { model: 'x' }] }), statfs: null })
    assert.deepEqual(linux.cpu, { model: 'Örnek CPU', cores: 2, loadavg: [0.5, 1.23, 2] })
  })
})
