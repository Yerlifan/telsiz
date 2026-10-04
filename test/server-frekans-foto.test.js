'use strict'

// Frekans fotoğrafı: yalnızca sahibin yüklemesi ve kaldırması, dosya imzası denetimi (PNG, JPEG, WebP),
// boyut sınırı, hız sınırı, herkese açık GET /api/server-icon (ETag ve 304, güvenlik başlıkları),
// GET /api/info ve metadaki karma, meta sürümünün artması, diskte atomik dosya ve yeniden başlatma.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const zlib = require('node:zlib')
const crypto = require('node:crypto')
const h = require('./server-yardimci')
const i18n = require('../src/i18n')

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  let k = 8
  while (k-- > 0) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32 (buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk (type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

// Gerçek, tek renkli bir PNG (w x h, RGB)
function makePng (w, hgt, rgb) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(hgt, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: w }, () => Buffer.from(rgb)))])
  const raw = Buffer.concat(Array.from({ length: hgt }, () => row))
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// İmzası geçerli JPEG ve WebP örnekleri (sunucu yalnızca dosya imzasına bakar)
const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'), crypto.randomBytes(40), Buffer.from('ffd9', 'hex')])
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([40, 0, 0, 0]), Buffer.from('WEBPVP8 ', 'latin1'), crypto.randomBytes(32)])

function hashOf (data) {
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32)
}

function uploadIcon (ctx, token, data, headers) {
  return h.request(ctx, 'POST', '/api/server-icon', { token, raw: data, headers: Object.assign({ 'content-type': 'application/octet-stream' }, headers || {}) })
}

function iconFiles (ctx) {
  try {
    return fs.readdirSync(path.join(ctx.dataDir, 'server-icon')).sort()
  } catch (err) {
    return []
  }
}

async function metaVersion (ctx, token) {
  const st = await h.stateOf(ctx, token)
  return { mv: st.metaVersion, icon: st.meta.serverIcon }
}

describe('frekans fotoğrafı', () => {
  it('sahip yükler, herkese açık sunulur, ETag ile 304, info ve meta karması, meta sürümü artar', async () => {
    const ctx = await h.startServer()
    try {
      let info = await h.get(ctx, '/api/info')
      assert.equal(info.data.serverIcon, null)
      assert.equal(info.data.limits.serverIconMaxBytes, 1024 * 1024 + 16)
      h.expectStatus(await h.get(ctx, '/api/server-icon'), 404, 'not_found')
      const owner = await h.setupOwner(ctx)
      const before = await metaVersion(ctx, owner.token)
      assert.equal(before.icon, null)

      const png = makePng(4, 4, [200, 40, 90])
      const res = await uploadIcon(ctx, owner.token, png)
      h.expectStatus(res, 200)
      const hash = hashOf(png)
      assert.equal(res.data.serverIcon, hash)

      const after = await metaVersion(ctx, owner.token)
      assert.ok(after.mv > before.mv, 'meta sürümü artmalı')
      assert.equal(after.icon, hash)
      info = await h.get(ctx, '/api/info')
      assert.equal(info.data.serverIcon, hash)

      // Oturumsuz okunur, doğru tür ve güvenlik başlıkları
      const got = await h.get(ctx, '/api/server-icon?v=' + hash)
      assert.equal(got.status, 200)
      assert.deepEqual(got.buffer, png)
      assert.equal(got.headers['content-type'], 'image/png')
      assert.equal(got.headers['x-content-type-options'], 'nosniff')
      assert.equal(got.headers['content-security-policy'], "default-src 'none'; sandbox")
      assert.equal(got.headers['cache-control'], 'no-cache')
      assert.equal(got.headers.etag, '"' + hash + '"')

      const cached = await h.request(ctx, 'GET', '/api/server-icon', { headers: { 'if-none-match': '"' + hash + '"' } })
      assert.equal(cached.status, 304)
      assert.equal(cached.buffer.length, 0)
      const stale = await h.request(ctx, 'GET', '/api/server-icon', { headers: { 'if-none-match': '"' + 'a'.repeat(32) + '"' } })
      assert.equal(stale.status, 200)
      const head = await h.request(ctx, 'HEAD', '/api/server-icon')
      assert.equal(head.status, 200)
      assert.equal(head.headers['content-length'], String(png.length))
      assert.equal(head.buffer.length, 0)

      // Aynı fotoğraf yeniden yüklenirse meta değişmez
      const again = await uploadIcon(ctx, owner.token, png)
      h.expectStatus(again, 200)
      assert.equal((await metaVersion(ctx, owner.token)).mv, after.mv)

      // Dosya karmasıyla adlandırılır, geçici dosya kalmaz
      assert.deepEqual(iconFiles(ctx), [hash + '.bin'])
      assert.deepEqual(fs.readFileSync(path.join(ctx.dataDir, 'server-icon', hash + '.bin')), png)

      // Poll yanıtı yeni metayı taşır
      const st = await h.stateOf(ctx, owner.token)
      const p = h.poller(ctx, owner.token, st)
      const waiting = p.poll()
      const jpegRes = await uploadIcon(ctx, owner.token, JPEG, { 'content-type': 'image/png' })
      h.expectStatus(jpegRes, 200)
      const polled = await waiting
      assert.equal(polled.status, 200)
      assert.equal(polled.data.meta.serverIcon, hashOf(JPEG))
      // Tür başlıktan değil dosya imzasından gelir, eski dosya silinir
      const jpeg = await h.get(ctx, '/api/server-icon')
      assert.equal(jpeg.headers['content-type'], 'image/jpeg')
      await h.waitFor(() => iconFiles(ctx).length === 1, { label: 'eski fotoğraf silinmeli' })
      assert.deepEqual(iconFiles(ctx), [hashOf(JPEG) + '.bin'])

      h.expectStatus(await uploadIcon(ctx, owner.token, WEBP), 200)
      assert.equal((await h.get(ctx, '/api/server-icon')).headers['content-type'], 'image/webp')

      // Kayıt state.json'da: { hash, type, size }
      await ctx.server.flush()
      const disk = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8'))
      assert.deepEqual(disk.serverIcon, { hash: hashOf(WEBP), type: 'image/webp', size: WEBP.length })
    } finally {
      await ctx.cleanup()
    }
  })

  it('dosya imzası geçersizse reddedilir (SVG, GIF, HTML, sahte başlık), boş gövde', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const bad = [
        ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', 'image/svg+xml'],
        ['GIF89a' + 'x'.repeat(40), 'image/gif'],
        ['<!doctype html><html><body>merhaba dunya</body></html>', 'image/png'],
        [Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('xxxxxxxxxxxxxxxxxxxx')]), 'image/png'],
        [Buffer.from('RIFF0000WAVEfmt 00000000000000'), 'image/webp'],
        [crypto.randomBytes(64), 'image/jpeg']
      ]
      for (const [data, type] of bad) {
        const res = await uploadIcon(ctx, owner.token, Buffer.isBuffer(data) ? data : Buffer.from(data), { 'content-type': type })
        h.expectStatus(res, 400, 'bad_server_icon')
      }
      h.expectStatus(await uploadIcon(ctx, owner.token, Buffer.alloc(0)), 400, 'empty_upload')
      assert.equal((await h.get(ctx, '/api/info')).data.serverIcon, null)
      assert.deepEqual(iconFiles(ctx), [])
      // Hata metni iki dilde
      const en = await uploadIcon(ctx, owner.token, Buffer.from('GIF89a' + 'x'.repeat(40)), { 'accept-language': 'en' })
      assert.equal(en.data.error, i18n.t('en', 'errors.bad_server_icon'))
      const tr = await uploadIcon(ctx, owner.token, Buffer.from('GIF89a' + 'x'.repeat(40)), { 'accept-language': 'tr' })
      assert.equal(tr.data.error, i18n.t('tr', 'errors.bad_server_icon'))
    } finally {
      await ctx.cleanup()
    }
  })

  it('boyut sınırı (profil resmi sınırı): bildirilen ve akışla gelen gövde', async () => {
    const ctx = await h.startServer({ avatarMaxBytes: 4096 })
    try {
      const owner = await h.setupOwner(ctx)
      assert.equal((await h.get(ctx, '/api/info')).data.limits.serverIconMaxBytes, 4096)
      const big = Buffer.concat([makePng(1, 1, [0, 0, 0]), crypto.randomBytes(5000)])
      const res = await uploadIcon(ctx, owner.token, big, { 'accept-language': 'tr' })
      h.expectStatus(res, 413, 'server_icon_too_large')
      assert.equal(res.data.error, i18n.t('tr', 'errors.server_icon_too_large', { kb: 4 }))
      // Content-Length olmadan (parçalı) gelen büyük gövde de kesilir
      const chunked = await new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: ctx.port, method: 'POST', path: '/api/server-icon', agent: false, headers: { 'x-token': owner.token, 'content-type': 'application/octet-stream', 'transfer-encoding': 'chunked' } }, (r) => {
          const chunks = []
          r.on('data', (c) => chunks.push(c))
          r.on('end', () => resolve({ status: r.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }))
        })
        req.on('error', () => {})
        req.write(big.subarray(0, 3000))
        req.write(big.subarray(3000))
        req.end()
        setTimeout(() => reject(new Error('yanıt gelmedi')), 4000).unref()
      })
      assert.equal(chunked.status, 413)
      assert.equal(chunked.data.code, 'server_icon_too_large')
      // Sınırın altındaki fotoğraf kabul edilir
      h.expectStatus(await uploadIcon(ctx, owner.token, makePng(8, 8, [1, 2, 3])), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('yalnızca sahip: yönetici ve üye 403, oturumsuz 401, kaldırma da yalnızca sahip', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const admin = await h.addUser(ctx, owner.token, 'yonetici')
      const member = await h.addUser(ctx, owner.token, 'uye')
      await h.makeAdmin(ctx, owner.token, admin.user.id)
      const png = makePng(2, 2, [10, 20, 30])
      const denied = await uploadIcon(ctx, admin.token, png, { 'accept-language': 'tr' })
      h.expectStatus(denied, 403, 'forbidden')
      assert.equal(denied.data.error, i18n.t('tr', 'detail.serverIconOwnerOnly'))
      h.expectStatus(await uploadIcon(ctx, member.token, png), 403, 'forbidden')
      h.expectStatus(await uploadIcon(ctx, null, png), 401, 'invalid_token')
      h.expectStatus(await uploadIcon(ctx, owner.token, png), 200)
      h.expectStatus(await h.post(ctx, '/api/server-icon/delete', admin.token, {}), 403, 'forbidden')
      h.expectStatus(await h.post(ctx, '/api/server-icon/delete', member.token, {}), 403, 'forbidden')
      h.expectStatus(await h.post(ctx, '/api/server-icon/delete', null, {}), 401, 'invalid_token')
      assert.equal((await h.get(ctx, '/api/info')).data.serverIcon, hashOf(png))
      // Üye ve yönetici fotoğrafı okuyabilir (herkese açık)
      assert.equal((await h.get(ctx, '/api/server-icon', member.token)).status, 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('kaldırma: info ve meta null olur, dosya silinir, meta sürümü artar, ikinci kaldırma zararsız', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const png = makePng(3, 3, [9, 9, 9])
      h.expectStatus(await uploadIcon(ctx, owner.token, png), 200)
      const before = await metaVersion(ctx, owner.token)
      const res = await h.post(ctx, '/api/server-icon/delete', owner.token, {})
      h.expectStatus(res, 200)
      assert.equal(res.data.serverIcon, null)
      const after = await metaVersion(ctx, owner.token)
      assert.ok(after.mv > before.mv)
      assert.equal(after.icon, null)
      assert.equal((await h.get(ctx, '/api/info')).data.serverIcon, null)
      h.expectStatus(await h.get(ctx, '/api/server-icon'), 404, 'not_found')
      await h.waitFor(() => iconFiles(ctx).length === 0, { label: 'dosya silinmeli' })
      h.expectStatus(await h.post(ctx, '/api/server-icon/delete', owner.token, {}), 200)
      assert.equal((await metaVersion(ctx, owner.token)).mv, after.mv)
    } finally {
      await ctx.cleanup()
    }
  })

  it('hız sınırı yönetim sınırlayıcısıyla', async () => {
    const ctx = await h.startServer({ adminLimit: 2 })
    try {
      const owner = await h.setupOwner(ctx)
      h.expectStatus(await uploadIcon(ctx, owner.token, makePng(1, 1, [1, 1, 1])), 200)
      h.expectStatus(await uploadIcon(ctx, owner.token, makePng(1, 1, [2, 2, 2])), 200)
      const limited = await uploadIcon(ctx, owner.token, makePng(1, 1, [3, 3, 3]))
      h.expectStatus(limited, 429, 'rate_limited')
      assert.ok(Number(limited.headers['retry-after']) >= 1)
      h.expectStatus(await h.post(ctx, '/api/server-icon/delete', owner.token, {}), 429, 'rate_limited')
    } finally {
      await ctx.cleanup()
    }
  })

  it('yeniden başlatmada korunur, eksik veya bozuk dosyada kayıt silinir, artık dosyalar temizlenir', async () => {
    let ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const png = makePng(5, 5, [100, 150, 200])
      const hash = hashOf(png)
      h.expectStatus(await uploadIcon(ctx, owner.token, png), 200)
      const dir = path.join(ctx.dataDir, 'server-icon')
      // Yarım kalmış yazım ve eski fotoğraf dosyası
      fs.writeFileSync(path.join(dir, 'b'.repeat(32) + '.bin.tmp'), 'yarim')
      fs.writeFileSync(path.join(dir, 'c'.repeat(32) + '.bin'), png)
      fs.writeFileSync(path.join(dir, 'beni-silme.txt'), 'x')
      ctx = await ctx.restart()
      assert.equal((await h.get(ctx, '/api/info')).data.serverIcon, hash)
      assert.deepEqual((await h.get(ctx, '/api/server-icon')).buffer, png)
      assert.deepEqual(iconFiles(ctx), [hash + '.bin', 'beni-silme.txt'].sort())

      // Dosya bozulursa (karma tutmazsa) kayıt silinir ve uyarı yazılır
      fs.writeFileSync(path.join(dir, hash + '.bin'), makePng(5, 5, [0, 0, 0]))
      ctx = await ctx.restart()
      assert.equal((await h.get(ctx, '/api/info')).data.serverIcon, null)
      assert.ok(ctx.log.lines.warn.some((line) => line === i18n.t('tr', 'log.serverIconMissing')), ctx.log.lines.warn.join('\n'))
      await ctx.server.flush()
      const disk = JSON.parse(fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8'))
      assert.equal(disk.serverIcon, null)
      assert.deepEqual(iconFiles(ctx), ['beni-silme.txt'])
    } finally {
      await ctx.cleanup()
    }
  })

  it('geçersiz kayıt açılışta temizlenir, eski durum dosyasında alan yoktur', async () => {
    let ctx = await h.startServer()
    try {
      await h.setupOwner(ctx)
      await ctx.stop()
      const file = path.join(ctx.dataDir, 'state.json')
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
      raw.serverIcon = { hash: '../../etc/passwd', type: 'image/svg+xml', size: 1 }
      fs.writeFileSync(file, JSON.stringify(raw))
      ctx = await h.startServer({}, ctx.root)
      assert.equal((await h.get(ctx, '/api/info')).data.serverIcon, null)
      await ctx.stop()
      const old = JSON.parse(fs.readFileSync(file, 'utf8'))
      delete old.serverIcon
      fs.writeFileSync(file, JSON.stringify(old))
      ctx = await h.startServer({}, ctx.root)
      assert.equal((await h.get(ctx, '/api/info')).data.serverIcon, null)
    } finally {
      await ctx.cleanup()
    }
  })
})

