'use strict'

// Frekans fotoğrafı (src/lib/server-icon.js): dosya imzası, içerik türü ve karma denetimi, boyut sınırı,
// yönlendirme yasağı, data: adresine çevirme ve gerçek bir Telsiz sunucusuna karşı indirme. Ön yükleme
// betiğinin ve vekilin fotoğrafı bozmadan geçirdiği de sınanır.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const zlib = require('node:zlib')
const icon = require('../src/lib/server-icon')
const proxy = require('../src/lib/proxy')
const h = require('../../test/server-yardimci')

function crc32 (buf) {
  let c = 0xffffffff
  for (const byte of buf) {
    c ^= byte
    let k = 8
    while (k-- > 0) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
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

function makePng (rgb) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(2, 0)
  ihdr.writeUInt32BE(2, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(rgb), Buffer.from(rgb)])
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat([row, row]))), chunk('IEND', Buffer.alloc(0))])
}

const PNG = makePng([10, 200, 30])
const JPEG = Buffer.concat([Buffer.from('ffd8ffe000104a46494600010100000100010000', 'hex'), crypto.randomBytes(30), Buffer.from('ffd9', 'hex')])
const WEBP = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([40, 0, 0, 0]), Buffer.from('WEBPVP8L', 'latin1'), crypto.randomBytes(24)])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

function hashOf (data) {
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32)
}

function fakeResponse (status, body, type, extra) {
  return new Response(body, { status, headers: Object.assign({ 'content-type': type }, extra || {}) })
}

test('dosya imzası: yalnızca PNG, JPEG ve WebP', () => {
  assert.equal(icon.detectType(PNG), 'image/png')
  assert.equal(icon.detectType(JPEG), 'image/jpeg')
  assert.equal(icon.detectType(WEBP), 'image/webp')
  assert.equal(icon.detectType(SVG), null)
  assert.equal(icon.detectType(Buffer.from('GIF89a' + 'x'.repeat(20))), null)
  assert.equal(icon.detectType(Buffer.from('89504e470d0a1a0a', 'hex')), null, 'kısa')
  assert.equal(icon.detectType('PNG'), null)
  assert.equal(icon.isIconHash('a'.repeat(32)), true)
  for (const bad of ['A'.repeat(32), 'a'.repeat(33), '', null, 5]) assert.equal(icon.isIconHash(bad), false)
})

test('data: adresi: tür başlıkla, karma içerikle tutmalı, boyut sınırı', () => {
  const url = icon.toDataUrl(PNG, 'image/png', hashOf(PNG))
  assert.equal(url, 'data:image/png;base64,' + PNG.toString('base64'))
  assert.equal(icon.isDataUrl(url), true)
  assert.equal(icon.toDataUrl(JPEG, 'image/jpeg; charset=binary', hashOf(JPEG)).startsWith('data:image/jpeg;base64,'), true)
  assert.equal(icon.toDataUrl(PNG, 'image/jpeg', hashOf(PNG)), null, 'başlık ve imza farklı')
  assert.equal(icon.toDataUrl(PNG, 'image/png', hashOf(JPEG)), null, 'karma tutmuyor')
  assert.equal(icon.toDataUrl(SVG, 'image/svg+xml', hashOf(SVG)), null)
  assert.equal(icon.toDataUrl(Buffer.alloc(0), 'image/png', hashOf(Buffer.alloc(0))), null)
  const big = Buffer.concat([PNG, Buffer.alloc(icon.MAX_ICON_BYTES)])
  assert.equal(icon.toDataUrl(big, 'image/png', hashOf(big)), null)
  assert.equal(icon.isDataUrl('data:image/svg+xml;base64,PHN2Zz4='), false)
  assert.equal(icon.isDataUrl('data:image/png;base64,abc"onerror'), false)
  assert.equal(icon.isDataUrl('https://kotu.com/x.png'), false)
  assert.equal(icon.isDataUrl('data:image/png;base64,' + 'A'.repeat(icon.MAX_DATA_URL)), false)
})

test('indirme: adres, istek ayarları ve ret durumları', async () => {
  const hash = hashOf(PNG)
  let seen = null
  const ok = await icon.fetchIcon(async (url, init) => {
    seen = { url, init }
    return fakeResponse(200, PNG, 'image/png')
  }, 'https://telsiz.ornek.com', hash)
  assert.equal(ok, 'data:image/png;base64,' + PNG.toString('base64'))
  assert.equal(seen.url, 'https://telsiz.ornek.com/api/server-icon?v=' + hash)
  assert.equal(seen.init.method, 'GET')
  assert.equal(seen.init.redirect, 'error')
  assert.equal(seen.init.credentials, 'omit')
  assert.equal(seen.init.cache, 'no-store')

  const never = async () => {
    throw new Error('istek gönderilmemeli')
  }
  assert.equal(await icon.fetchIcon(never, 'javascript:alert(1)', hash), null)
  assert.equal(await icon.fetchIcon(never, 'http://kotu.com', hash), null, 'https olmayan uzak köken')
  assert.equal(await icon.fetchIcon(never, 'https://telsiz.ornek.com', '../x'), null)
  assert.equal(await icon.fetchIcon(null, 'https://telsiz.ornek.com', hash), null)
  assert.equal(await icon.fetchIcon(async () => fakeResponse(404, '{}', 'application/json'), 'https://a.com', hash), null)
  assert.equal(await icon.fetchIcon(async () => fakeResponse(200, PNG, 'text/html'), 'https://a.com', hash), null)
  assert.equal(await icon.fetchIcon(async () => fakeResponse(200, SVG, 'image/svg+xml'), 'https://a.com', hashOf(SVG)), null)
  assert.equal(await icon.fetchIcon(async () => fakeResponse(200, PNG, 'image/png'), 'https://a.com', 'f'.repeat(32)), null)
  assert.equal(await icon.fetchIcon(async () => fakeResponse(200, PNG, 'image/png', { 'content-length': String(icon.MAX_ICON_BYTES + 1) }), 'https://a.com', hash), null)
  // Akışla gelen büyük gövde sınırda kesilir
  const big = Buffer.alloc(icon.MAX_ICON_BYTES + 100)
  PNG.copy(big)
  assert.equal(await icon.fetchIcon(async () => fakeResponse(200, big, 'image/png'), 'https://a.com', hashOf(big)), null)
  assert.equal(await icon.fetchIcon(async () => {
    throw new TypeError('fetch failed')
  }, 'https://a.com', hash), null)
  // Zaman aşımı
  const slow = await icon.fetchIcon((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')))
  }), 'https://a.com', hash, { timeoutMs: 30 })
  assert.equal(slow, null)
})

test('gerçek sunucu: info karması, indirme, vekilden geçen fotoğraf', async () => {
  const ctx = await h.startServer()
  try {
    const owner = await h.setupOwner(ctx)
    const res = await h.request(ctx, 'POST', '/api/server-icon', { token: owner.token, raw: PNG, headers: { 'content-type': 'application/octet-stream' } })
    h.expectStatus(res, 200)
    const origin = 'http://127.0.0.1:' + ctx.port
    const su = require('../src/lib/server-url')
    const info = await su.checkServer((url, init) => fetch(url, init), origin, '2.0.0')
    assert.equal(info.ok, true)
    assert.equal(info.serverIcon, hashOf(PNG))
    const url = await icon.fetchIcon((u, init) => fetch(u, init), origin, info.serverIcon)
    assert.equal(url, 'data:image/png;base64,' + PNG.toString('base64'))

    // Açık frekansın sayfası fotoğrafı telsiz://app/api/server-icon üzerinden ister: vekil gövdeyi bozmadan
    // geçirir, tür ikili sayılır ve betik çalıştıramayan CSP eklenir
    const apiProxy = proxy.createApiProxy({ origin, fetch: (u, init) => fetch(u, init) })
    const relayed = await apiProxy({ url: 'telsiz://app/api/server-icon?v=' + info.serverIcon, method: 'GET', headers: new Headers(), body: null, initiatorOrigin: 'telsiz://app', mode: 'no-cors' })
    assert.equal(relayed.status, 200)
    assert.deepEqual(Buffer.from(await relayed.arrayBuffer()), PNG)
    assert.equal(relayed.headers.get('content-type'), 'application/octet-stream')
    assert.match(relayed.headers.get('content-security-policy'), /sandbox/)

    // Fotoğraf kaldırılınca info karması null olur
    h.expectStatus(await h.post(ctx, '/api/server-icon/delete', owner.token, {}), 200)
    const after = await su.checkServer((u, init) => fetch(u, init), origin, '2.0.0')
    assert.equal(after.serverIcon, null)
  } finally {
    await ctx.cleanup()
  }
})
