'use strict'

// Yüklemeler: akışla geçici dosyaya yazma, boyut, kota, sahiplik,
// yetim temizliği, mesaj silinince dosyanın silinmesi, indirme yetkisi ve başlıkları,
// istemci iptali, eşzamanlı yükleme sınırı ve mesaj başına ek sınırı.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const h = require('./server-yardimci')

function uploadsDir (ctx) {
  return path.join(ctx.dataDir, 'uploads')
}

function listUploads (ctx) {
  try {
    return fs.readdirSync(uploadsDir(ctx)).sort()
  } catch (err) {
    return []
  }
}

function tmpFiles (ctx) {
  return listUploads(ctx).filter((name) => name.endsWith('.tmp'))
}

async function uploadOk (ctx, token, bytes) {
  const res = await h.upload(ctx, token, bytes)
  h.expectStatus(res, 200)
  assert.match(res.data.id, /^[0-9a-f]{32}$/)
  assert.equal(res.data.size, bytes.length)
  assert.deepEqual(Object.keys(res.data).sort(), ['id', 'size'])
  return res.data.id
}

// Gövdesi parça parça gönderilen ve kontrolü teste bırakılan yükleme isteği
function openUpload (ctx, token, headers) {
  const req = http.request({
    host: '127.0.0.1',
    port: ctx.port,
    method: 'POST',
    path: '/api/uploads',
    headers: Object.assign({ 'x-token': token, 'content-type': 'application/octet-stream' }, headers || {}),
    agent: false
  })
  const response = new Promise((resolve) => {
    req.on('response', (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        let data = null
        try {
          data = JSON.parse(text)
        } catch (err) {
          data = null
        }
        resolve({ status: res.statusCode, headers: res.headers, text, data })
      })
      res.on('error', () => resolve({ status: 0 }))
    })
    req.on('error', (err) => resolve({ status: 0, error: err }))
  })
  return { req, response }
}

describe('yüklemeler', () => {
  it('akışla yükleme: başarıda .tmp dosyası .bin olur, indirme başlıkları', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const bytes = crypto.randomBytes(200000)
      const id = await uploadOk(ctx, owner.token, bytes)
      assert.deepEqual(listUploads(ctx), [id + '.bin'])
      assert.deepEqual(fs.readFileSync(path.join(uploadsDir(ctx), id + '.bin')), bytes)

      const res = await h.request(ctx, 'GET', '/api/uploads/' + id, { token: owner.token })
      h.expectStatus(res, 200)
      assert.deepEqual(res.buffer, bytes)
      assert.equal(res.headers['content-type'], 'application/octet-stream')
      assert.equal(res.headers['content-disposition'], 'attachment')
      assert.equal(res.headers['cache-control'], 'no-store')
      assert.equal(res.headers['content-security-policy'], "default-src 'none'; sandbox")
      assert.equal(res.headers['content-length'], String(bytes.length))
      assert.equal(res.headers['x-content-type-options'], 'nosniff')

      // Parçalı (Content-Length olmadan) gönderim de çalışır
      const { req, response } = openUpload(ctx, owner.token)
      req.write(bytes.subarray(0, 1000))
      await h.sleep(20)
      req.end(bytes.subarray(1000, 3000))
      const chunked = await response
      h.expectStatus(chunked, 200)
      assert.equal(chunked.data.size, 3000)
      assert.deepEqual(tmpFiles(ctx), [])
    } finally {
      await ctx.cleanup()
    }
  })

  it('boyut sınırı: 413, bağlantı kapanır ve geçici dosya kalmaz, boş dosya 400', async () => {
    const ctx = await h.startServer({ uploadMaxBytes: 1000 })
    try {
      const owner = await h.setupOwner(ctx)
      await uploadOk(ctx, owner.token, crypto.randomBytes(1000))

      // Bildirilen boyut sınırı aşıyorsa gövde beklenmeden yanıt verilir
      const declared = openUpload(ctx, owner.token, { 'content-length': '5000' })
      declared.req.flushHeaders()
      const r1 = await declared.response
      declared.req.destroy()
      h.expectStatus(r1, 413, 'too_large')
      assert.equal(r1.headers.connection, 'close')

      // Boyut bildirilmeden gönderilip okunurken aşılırsa
      const streamed = openUpload(ctx, owner.token)
      streamed.req.end(crypto.randomBytes(1500))
      const r2 = await streamed.response
      h.expectStatus(r2, 413, 'too_large')
      assert.equal(r2.headers.connection, 'close')
      await h.waitFor(() => tmpFiles(ctx).length === 0 && ctx.server.stats().activeUploads === 0)
      assert.equal(listUploads(ctx).length, 1)

      const empty = await h.upload(ctx, owner.token, Buffer.alloc(0))
      h.expectStatus(empty, 400, 'empty_upload')
      const emptyChunked = openUpload(ctx, owner.token)
      emptyChunked.req.end()
      h.expectStatus(await emptyChunked.response, 400, 'empty_upload')
      await h.waitFor(() => listUploads(ctx).length === 1)
    } finally {
      await ctx.cleanup()
    }
  })

  it('istemci yüklemeyi yarıda keserse geçici dosya silinir', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const { req, response } = openUpload(ctx, owner.token, { 'content-length': '100000' })
      req.write(crypto.randomBytes(30000))
      await h.waitFor(() => tmpFiles(ctx).length === 1 && ctx.server.stats().activeUploads === 1)
      req.destroy()
      const res = await response
      assert.equal(res.status, 0)
      await h.waitFor(() => tmpFiles(ctx).length === 0 && ctx.server.stats().activeUploads === 0)
      assert.deepEqual(listUploads(ctx), [])
      assert.equal(ctx.server.stats().uploadsBytes, 0)
    } finally {
      await ctx.cleanup()
    }
  })

  it('eşzamanlı yükleme sınırı aşılınca 503 busy', async () => {
    const ctx = await h.startServer({ maxConcurrentUploads: 1 })
    try {
      const owner = await h.setupOwner(ctx)
      const first = openUpload(ctx, owner.token, { 'content-length': '2000' })
      first.req.write(crypto.randomBytes(1000))
      await h.waitFor(() => ctx.server.stats().activeUploads === 1)
      const busy = await h.upload(ctx, owner.token, crypto.randomBytes(500))
      h.expectStatus(busy, 503, 'busy')
      assert.equal(busy.data.error, 'The server is busy with other uploads. Try again shortly.')
      first.req.end(crypto.randomBytes(1000))
      h.expectStatus(await first.response, 200)
      await uploadOk(ctx, owner.token, crypto.randomBytes(500))
    } finally {
      await ctx.cleanup()
    }
  })

  it('kalıcı bağlantıda: GET yanıtları bağlantıyı kapatmaz, 503 gövdesi okunup atılır ve bağlantı yeniden kullanılır', async () => {
    const ctx = await h.startServer({ maxConcurrentUploads: 1 })
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
    const send = (method, urlPath, token, body) => new Promise((resolve, reject) => {
      const headers = { 'x-token': token }
      if (body) headers['content-length'] = String(body.length)
      const req = http.request({ host: '127.0.0.1', port: ctx.port, method, path: urlPath, headers, agent }, (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode, connection: res.headers.connection, port: req.socket.localPort, text: Buffer.concat(chunks).toString('utf8') }))
      })
      req.on('error', reject)
      req.end(body)
    })
    try {
      const owner = await h.setupOwner(ctx)
      const first = await send('GET', '/api/info', owner.token)
      assert.equal(first.connection, 'keep-alive')
      const hold = openUpload(ctx, owner.token, { 'content-length': '2000' })
      hold.req.write(crypto.randomBytes(1000))
      await h.waitFor(() => ctx.server.stats().activeUploads === 1)
      // Tarayıcı gibi gövdenin tamamını gönderen istemci 503 yanıtını sıfırlama olmadan alır
      const busy = await send('POST', '/api/uploads', owner.token, crypto.randomBytes(2 * 1024 * 1024))
      assert.equal(busy.status, 503, busy.text)
      assert.equal(busy.connection, 'keep-alive')
      const after = await send('GET', '/api/info', owner.token)
      assert.equal(after.status, 200)
      assert.equal(after.port, busy.port)
      hold.req.end(crypto.randomBytes(1000))
      h.expectStatus(await hold.response, 200)
    } finally {
      agent.destroy()
      await ctx.cleanup()
    }
  })

  it('kota: dolunca 507, silinen dosya yer açar', async () => {
    const ctx = await h.startServer({ uploadMaxBytes: 1000, uploadQuotaBytes: 1500 })
    try {
      const owner = await h.setupOwner(ctx)
      const a = await uploadOk(ctx, owner.token, crypto.randomBytes(800))
      h.expectStatus(await h.upload(ctx, owner.token, crypto.randomBytes(800)), 507, 'quota_full')
      // Boyut bildirilmeden gönderilip okunurken kota aşılırsa
      const streamed = openUpload(ctx, owner.token)
      streamed.req.end(crypto.randomBytes(900))
      h.expectStatus(await streamed.response, 507, 'quota_full')
      await h.waitFor(() => tmpFiles(ctx).length === 0)

      const m = await h.sendMessage(ctx, owner.token, 1, { uploads: [a] })
      h.expectStatus(await h.post(ctx, '/api/messages/delete', owner.token, { id: m.id }), 200)
      await h.waitFor(() => listUploads(ctx).length === 0)
      await uploadOk(ctx, owner.token, crypto.randomBytes(800))
    } finally {
      await ctx.cleanup()
    }
  })

  it('yükleme hız sınırı 429', async () => {
    const ctx = await h.startServer({ uploadLimit: 2, uploadWindowMs: 60000 })
    try {
      const owner = await h.setupOwner(ctx)
      await uploadOk(ctx, owner.token, crypto.randomBytes(10))
      await uploadOk(ctx, owner.token, crypto.randomBytes(10))
      h.expectStatus(await h.upload(ctx, owner.token, crypto.randomBytes(10)), 429, 'rate_limited')
      h.expectStatus(await h.upload(ctx, 'x'.repeat(43), crypto.randomBytes(10)), 401, 'invalid_token')
    } finally {
      await ctx.cleanup()
    }
  })

  it('sahiplik ve indirme yetkisi: bağlı değilse yalnızca yükleyen, bağlıysa herkes', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const ayse = await h.addUser(ctx, owner.token, 'ayse')
      const bytes = crypto.randomBytes(64)
      const id = await uploadOk(ctx, ayse.token, bytes)
      h.expectStatus(await h.get(ctx, '/api/uploads/' + id, owner.token), 404)
      h.expectStatus(await h.get(ctx, '/api/uploads/' + id, ayse.token), 200)
      h.expectStatus(await h.get(ctx, '/api/uploads/' + id), 401, 'invalid_token')

      // Başkasının yüklemesi mesaja eklenemez
      h.expectStatus(await h.post(ctx, '/api/messages', owner.token, { channelId: 1, body: h.envelope(), uploads: [id] }), 400, 'bad_uploads')
      const m = await h.sendMessage(ctx, ayse.token, 1, { uploads: [id] })
      assert.deepEqual(m.uploads, [id])
      const res = await h.get(ctx, '/api/uploads/' + id, owner.token)
      h.expectStatus(res, 200)
      assert.deepEqual(res.buffer, bytes)
      // Bağlanmış yükleme ikinci kez eklenemez
      h.expectStatus(await h.post(ctx, '/api/messages', ayse.token, { channelId: 1, body: h.envelope(), uploads: [id] }), 400, 'bad_uploads')

      for (const bad of ['0'.repeat(32), 'xyz', id.toUpperCase(), id + '0', '..%2f..%2fstate.json']) {
        const r = await h.get(ctx, '/api/uploads/' + bad, ayse.token)
        assert.equal(r.status, 404, bad)
      }
      h.expectStatus(await h.request(ctx, 'DELETE', '/api/uploads/' + id, { token: ayse.token }), 405, 'method_not_allowed')
    } finally {
      await ctx.cleanup()
    }
  })

  it('mesaj başına ek sınırı (10) ve ek listesi doğrulaması', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const ids = []
      for (const i of h.times(11)) ids.push(await uploadOk(ctx, owner.token, crypto.randomBytes(16)))
      const send = (uploads) => h.post(ctx, '/api/messages', owner.token, { channelId: 1, body: h.envelope(), uploads })
      h.expectStatus(await send(ids), 400, 'bad_uploads')
      h.expectStatus(await send([ids[0], ids[0]]), 400, 'bad_uploads')
      h.expectStatus(await send(['f'.repeat(32)]), 400, 'bad_uploads')
      h.expectStatus(await send('abc'), 400, 'bad_uploads')
      h.expectStatus(await send([123]), 400, 'bad_uploads')
      h.expectStatus(await send({ 0: ids[0] }), 400, 'bad_uploads')
      const ok = await send(ids.slice(0, 10))
      h.expectStatus(ok, 200)
      assert.deepEqual(ok.data.message.uploads, ids.slice(0, 10))
      // Başarısız denemeler yüklemeleri bağlamadı, sonuncusu hâlâ kullanılabilir
      h.expectStatus(await send([ids[10]]), 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('yetim yüklemeler süre dolunca silinir', async () => {
    const ctx = await h.startServer({ orphanUploadTtlMs: 150 })
    try {
      const owner = await h.setupOwner(ctx)
      const orphan = await uploadOk(ctx, owner.token, crypto.randomBytes(100))
      const kept = await uploadOk(ctx, owner.token, crypto.randomBytes(100))
      await h.sendMessage(ctx, owner.token, 1, { uploads: [kept] })
      await h.waitFor(async () => (await h.get(ctx, '/api/uploads/' + orphan, owner.token)).status === 404)
      await h.waitFor(() => !listUploads(ctx).includes(orphan + '.bin'))
      assert.deepEqual(listUploads(ctx), [kept + '.bin'])
      assert.equal(ctx.server.stats().uploadsBytes, 100)
      h.expectStatus(await h.get(ctx, '/api/uploads/' + kept, owner.token), 200)
      h.expectStatus(await h.post(ctx, '/api/messages', owner.token, { channelId: 1, body: h.envelope(), uploads: [orphan] }), 400, 'bad_uploads')
    } finally {
      await ctx.cleanup()
    }
  })

  it('mesaj ve kanal silinince dosyalar silinir, bağlı yükleme yeniden başlatmadan sonra iner', async () => {
    let ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const a = await uploadOk(ctx, owner.token, crypto.randomBytes(10))
      const b = await uploadOk(ctx, owner.token, crypto.randomBytes(20))
      const cBytes = crypto.randomBytes(30)
      const c = await uploadOk(ctx, owner.token, cBytes)
      const m1 = await h.sendMessage(ctx, owner.token, 1, { uploads: [a] })
      await h.sendMessage(ctx, owner.token, 2, { uploads: [b] })
      await h.sendMessage(ctx, owner.token, 1, { uploads: [c] })

      h.expectStatus(await h.post(ctx, '/api/messages/delete', owner.token, { id: m1.id }), 200)
      h.expectStatus(await h.get(ctx, '/api/uploads/' + a, owner.token), 404)
      h.expectStatus(await h.post(ctx, '/api/channels/delete', owner.token, { id: 2 }), 200)
      h.expectStatus(await h.get(ctx, '/api/uploads/' + b, owner.token), 404)
      await h.waitFor(() => listUploads(ctx).length === 1)
      assert.deepEqual(listUploads(ctx), [c + '.bin'])

      ctx = await ctx.restart()
      const res = await h.get(ctx, '/api/uploads/' + c, owner.token)
      h.expectStatus(res, 200)
      assert.deepEqual(res.buffer, cBytes)
      assert.equal(ctx.server.stats().uploadsBytes, 30)
    } finally {
      await ctx.cleanup()
    }
  })

  it('varsayılan sınırlar: 25 MB + 16 bayt yükleme kabul edilir, fazlası 413', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const max = 25 * 1024 * 1024 + 16
      const big = Buffer.alloc(max, 7)
      const res = await h.upload(ctx, owner.token, big)
      h.expectStatus(res, 200)
      assert.equal(res.data.size, max)
      const over = openUpload(ctx, owner.token, { 'content-length': String(max + 1) })
      over.req.flushHeaders()
      const r = await over.response
      over.req.destroy()
      h.expectStatus(r, 413, 'too_large')
      assert.equal(r.data.error, 'The file is too large. The maximum size is 25 MB.')
    } finally {
      await ctx.cleanup()
    }
  })
})
