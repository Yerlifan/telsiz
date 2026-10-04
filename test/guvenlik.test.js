'use strict'

// Güvenlik denetiminde bulunan sorunların gerileme testleri.
// 1. Kimlik isteyen JSON yollarında oturum gövde okunmadan önce doğrulanır: oturumu olmayan biri sunucuya
//    gövde okutamaz ve bellekte tutturamaz (müzik yolunda 140 KB'a kadar). Gövde okunurken engellenen
//    hesabın isteği işlenmez.
// 2. JSON gövdesi süre sınırı içinde tamamlanmazsa bağlantı kesilir (util.readBody).

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const net = require('node:net')
const { PassThrough } = require('node:stream')
const h = require('./server-yardimci')
const util = require('../src/http-util')

// Ham soket isteği: başlıklar ve gövdenin bir kısmı gönderilir, gövdenin geri kalanı send() ile
// gönderilebilir. response(ms): o süre içinde gelen yanıtın ilk satırı ve gövdesi (gelmezse null).
function rawRequest (ctx, method, urlPath, headers, firstChunk) {
  const sock = net.connect(ctx.port, '127.0.0.1')
  let data = ''
  sock.setEncoding('utf8')
  sock.on('data', (chunk) => {
    data += chunk
  })
  sock.on('error', () => {})
  const lines = [method + ' ' + urlPath + ' HTTP/1.1', 'Host: 127.0.0.1']
  for (const name of Object.keys(headers)) lines.push(name + ': ' + headers[name])
  sock.write(lines.join('\r\n') + '\r\n\r\n' + (firstChunk || ''))
  return {
    send (text) {
      sock.write(text)
    },
    async response (ms) {
      const start = Date.now()
      while (Date.now() - start < ms) {
        const end = data.indexOf('\r\n\r\n')
        if (end !== -1) {
          const status = Number(data.split(' ')[1])
          const lengthMatch = /content-length: (\d+)/i.exec(data.slice(0, end))
          const body = data.slice(end + 4)
          if (!lengthMatch || Buffer.byteLength(body) >= Number(lengthMatch[1])) {
            let json = null
            try {
              json = JSON.parse(body)
            } catch (err) {
              json = null
            }
            return { status, head: data.slice(0, end), json }
          }
        }
        await h.sleep(10)
      }
      return null
    },
    close () {
      sock.destroy()
    }
  }
}

describe('kimlik doğrulaması gövdeden önce', () => {
  it('oturumsuz istek gövde beklenmeden 401 alır (müzik ve mesaj yolları)', async () => {
    const ctx = await h.startServer()
    try {
      for (const urlPath of ['/api/music/state', '/api/messages', '/api/me/profile']) {
        const req = rawRequest(ctx, 'POST', urlPath, { 'Content-Type': 'application/json', 'Content-Length': '60000' }, '{"channelId":')
        const res = await req.response(2000)
        req.close()
        assert.ok(res, urlPath + ': gövde tamamlanmadan yanıt gelmeli')
        assert.equal(res.status, 401, urlPath)
        assert.equal(res.json && res.json.code, 'invalid_token', urlPath)
      }
      // Geçersiz token da aynı biçimde reddedilir
      const req = rawRequest(ctx, 'POST', '/api/music/state', { 'Content-Type': 'application/json', 'Content-Length': '130000', 'X-Token': 'x'.repeat(43) }, '{')
      const res = await req.response(2000)
      req.close()
      assert.ok(res)
      assert.equal(res.status, 401)
    } finally {
      await ctx.cleanup()
    }
  })

  it('oturumsuz istekte boyutu bilinen gövde okunup atılır, bağlantı yanıtı alır', async () => {
    const ctx = await h.startServer()
    try {
      const body = JSON.stringify({ channelId: 1, body: 'x'.repeat(1000) })
      const res = await h.request(ctx, 'POST', '/api/messages', { body })
      h.expectStatus(res, 401, 'invalid_token')
    } finally {
      await ctx.cleanup()
    }
  })

  it('geçerli oturumla gövde okunur ve istek işlenir', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const body = JSON.stringify({ channelId: 1, body: h.envelope() })
      const req = rawRequest(ctx, 'POST', '/api/messages', { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), 'X-Token': owner.token }, body.slice(0, 10))
      assert.equal(await req.response(300), null, 'gövde tamamlanmadan yanıt gelmemeli')
      req.send(body.slice(10))
      const res = await req.response(3000)
      req.close()
      assert.ok(res)
      assert.equal(res.status, 200)
    } finally {
      await ctx.cleanup()
    }
  })

  it('gövde okunurken engellenen hesabın isteği işlenmez', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const ayse = await h.addUser(ctx, owner.token, 'ayse')
      const body = JSON.stringify({ channelId: 1, body: h.envelope() })
      const req = rawRequest(ctx, 'POST', '/api/messages', { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), 'X-Token': ayse.token }, body.slice(0, 10))
      assert.equal(await req.response(200), null)
      h.expectStatus(await h.post(ctx, '/api/users/ban', owner.token, { userId: ayse.user.id, banned: true }), 200)
      req.send(body.slice(10))
      const res = await req.response(3000)
      req.close()
      assert.ok(res)
      assert.equal(res.status, 403)
      assert.equal(res.json && res.json.code, 'banned')
      const list = await h.get(ctx, '/api/messages?channel=1', owner.token)
      h.expectStatus(list, 200)
      assert.equal(list.data.messages.length, 0, 'engellenen hesabın mesajı kaydedilmemeli')
    } finally {
      await ctx.cleanup()
    }
  })

  it('gövde okunurken kapatılan oturumun isteği işlenmez', async () => {
    const ctx = await h.startServer()
    try {
      const owner = await h.setupOwner(ctx)
      const body = JSON.stringify({ channelId: 1, body: h.envelope() })
      const req = rawRequest(ctx, 'POST', '/api/messages', { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)), 'X-Token': owner.token }, body.slice(0, 10))
      assert.equal(await req.response(200), null)
      h.expectStatus(await h.post(ctx, '/api/logout', owner.token), 200)
      req.send(body.slice(10))
      const res = await req.response(3000)
      req.close()
      assert.ok(res)
      assert.equal(res.status, 401)
      assert.equal(res.json && res.json.code, 'invalid_token')
    } finally {
      await ctx.cleanup()
    }
  })
})

describe('JSON gövde süre sınırı', () => {
  function fakeRequest (headers) {
    const req = new PassThrough()
    req.headers = headers
    req.complete = false
    return req
  }

  it('süre içinde tamamlanmayan gövde iptal edilir ve bağlantı kesilir', async () => {
    const req = fakeRequest({ 'content-length': '50' })
    req.write('{"a":')
    // readBody zamanlayıcısı süreci açık tutmaz (unref), test süresince olay döngüsü açık kalır
    const keep = setTimeout(() => {}, 5000)
    const result = await util.readBody(req, 100, 50)
    clearTimeout(keep)
    assert.deepEqual(result, { aborted: true })
    assert.equal(req.destroyed, true)
  })

  it('süre içinde tamamlanan gövde okunur', async () => {
    const req = fakeRequest({ 'content-length': '7' })
    const pending = util.readBody(req, 100, 1000)
    req.end('{"a":1}')
    assert.deepEqual(await pending, { text: '{"a":1}' })
  })
})
