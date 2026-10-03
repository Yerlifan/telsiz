'use strict'

// Ters vekil güveni: X-Forwarded-For ve CF-Connecting-IP yalnızca bağlantı güvenilir bir
// adresten geliyorsa dikkate alınır. X-Forwarded-For sağdan sola okunur, istemcinin eklediği
// sahte girdiler kullanılmaz.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const auth = require('../src/auth')
const h = require('./server-yardimci')

function fakeReq (remoteAddress, headers) {
  return { socket: { remoteAddress }, headers: headers || {} }
}

describe('güvenilir vekil listesi', () => {
  it('parseTrustedProxies: loopback, none, IP adresleri ve CIDR aralıkları', () => {
    assert.deepEqual(auth.parseTrustedProxies(''), ['loopback'])
    assert.deepEqual(auth.parseTrustedProxies(' , '), ['loopback'])
    assert.deepEqual(auth.parseTrustedProxies('LOOPBACK'), ['loopback'])
    assert.deepEqual(auth.parseTrustedProxies('none'), ['none'])
    assert.deepEqual(auth.parseTrustedProxies('10.0.0.5, 172.16.0.0/12,loopback'), ['10.0.0.5', '172.16.0.0/12', 'loopback'])
    assert.deepEqual(auth.parseTrustedProxies('fd00::/8, ::ffff:192.0.2.1'), ['fd00::/8', '192.0.2.1'])
    assert.deepEqual(auth.parseTrustedProxies(['10.0.0.1', 'loopback']), ['10.0.0.1', 'loopback'])
    for (const bad of ['abc', '10.0.0.0/33', '::/129', '10.0.0.0/', '10.0.0.0/-1', '10.0.0.0/1/2', 'none,10.0.0.1',
      '999.1.1.1', 'http://10.0.0.1', '10.0.0.*', 42, null, [1], ['10.0.0.1', {}], new Array(65).fill('10.0.0.1')]) {
      assert.equal(auth.parseTrustedProxies(bad), null, JSON.stringify(bad))
    }
    assert.throws(() => auth.trustPolicy('abc'), TypeError)
  })

  it('trustPolicy: adres ve aralık eşleşmesi', () => {
    const loopback = auth.trustPolicy(['loopback'])
    for (const ip of ['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1']) assert.equal(loopback(ip), true, ip)
    for (const ip of ['10.0.0.1', '::2', '192.0.2.1', '', 'abc']) assert.equal(loopback(ip), false, ip)
    const list = auth.trustPolicy(['10.0.0.5', '172.16.0.0/12', 'fd00::/8'])
    for (const ip of ['10.0.0.5', '172.20.1.2', '172.31.255.255', 'fd12:3456::1', '::ffff:10.0.0.5']) assert.equal(list(ip), true, ip)
    for (const ip of ['10.0.0.6', '172.32.0.1', '127.0.0.1', '::1', 'fe80::1']) assert.equal(list(ip), false, ip)
    const none = auth.trustPolicy(['none'])
    for (const ip of ['127.0.0.1', '::1', '10.0.0.5']) assert.equal(none(ip), false, ip)
  })
})

describe('istemci IP adresi', () => {
  const loopback = auth.trustPolicy(['loopback'])

  it('güvenilmeyen bağlantıda başlıklar yok sayılır', () => {
    const headers = { 'x-forwarded-for': '203.0.113.1', 'cf-connecting-ip': '198.51.100.1' }
    assert.equal(auth.clientIp(fakeReq('192.0.2.50', headers), loopback), '192.0.2.50')
    assert.equal(auth.clientIp(fakeReq('::ffff:192.0.2.50', headers), loopback), '192.0.2.50')
    // Yalnızca belirli vekile güvenilince loopback bağlantısının başlıkları da yok sayılır
    const onlyProxy = auth.trustPolicy(['10.0.0.5'])
    assert.equal(auth.clientIp(fakeReq('127.0.0.1', headers), onlyProxy), '127.0.0.1')
    assert.equal(auth.clientIp(fakeReq('10.0.0.5', headers), onlyProxy), '203.0.113.1')
    assert.equal(auth.clientIp(fakeReq('127.0.0.1', headers), auth.trustPolicy(['none'])), '127.0.0.1')
  })

  it('X-Forwarded-For sağdan sola, güvenilir olmayan ilk adres', () => {
    const cases = [
      // Vekil istemcinin adresini sona ekler, istemcinin yazdığı sahte girdi solda kalır
      { header: '1.2.3.4, 203.0.113.9', ip: '203.0.113.9' },
      { header: '203.0.113.9', ip: '203.0.113.9' },
      { header: ' 203.0.113.9 ', ip: '203.0.113.9' },
      { header: '203.0.113.9, 127.0.0.1', ip: '203.0.113.9' },
      { header: '198.51.100.1, 203.0.113.9, 127.0.0.1, ::1', ip: '203.0.113.9' },
      { header: '2001:db8::1', ip: '2001:db8::1' },
      { header: '::ffff:203.0.113.9', ip: '203.0.113.9' },
      // Bozuk girdide daha soldakilere güvenilmez
      { header: '203.0.113.1, bozuk, 203.0.113.9', ip: '203.0.113.9' },
      { header: '203.0.113.1, bozuk', ip: '127.0.0.1' },
      { header: 'bozuk', ip: '127.0.0.1' },
      { header: '', ip: '127.0.0.1' },
      // Tümü güvenilir vekillerse en soldaki
      { header: '127.0.0.2, 127.0.0.3', ip: '127.0.0.2' },
      { header: '203.0.113.1:8080', ip: '127.0.0.1' },
      // Çok uzun başlıkta yalnızca son kısım okunur
      { header: '1.1.1.1,'.repeat(400) + '203.0.113.9', ip: '203.0.113.9' },
      { header: '127.0.0.5,'.repeat(400) + '127.0.0.9', ip: '127.0.0.1' },
      { header: '203.0.113.77,'.repeat(300) + '127.0.0.9', ip: '203.0.113.77' },
      { header: '1'.repeat(3000) + ',203.0.113.9', ip: '203.0.113.9' }
    ]
    for (const { header, ip } of cases) {
      assert.equal(auth.clientIp(fakeReq('127.0.0.1', { 'x-forwarded-for': header }), loopback), ip, header.slice(0, 40))
    }
  })

  it('X-Forwarded-For kullanılamıyorsa CF-Connecting-IP, o da yoksa soket adresi', () => {
    assert.equal(auth.clientIp(fakeReq('::1', { 'cf-connecting-ip': '198.51.100.7' }), loopback), '198.51.100.7')
    assert.equal(auth.clientIp(fakeReq('::1', { 'cf-connecting-ip': 'bozuk' }), loopback), '::1')
    assert.equal(auth.clientIp(fakeReq('::1', { 'x-forwarded-for': 'bozuk', 'cf-connecting-ip': '198.51.100.7' }), loopback), '198.51.100.7')
    // İkisi de varsa X-Forwarded-For'un sağdaki gerçek adresi kullanılır
    assert.equal(auth.clientIp(fakeReq('127.0.0.1', { 'x-forwarded-for': '203.0.113.9', 'cf-connecting-ip': '198.51.100.7' }), loopback), '203.0.113.9')
    assert.equal(auth.clientIp(fakeReq('127.0.0.1', {}), loopback), '127.0.0.1')
    // trusts verilmezse yalnızca loopback güvenilirdir
    assert.equal(auth.clientIp(fakeReq('127.0.0.1', { 'x-forwarded-for': '203.0.113.9' })), '203.0.113.9')
    assert.equal(auth.clientIp(fakeReq('192.0.2.1', { 'x-forwarded-for': '203.0.113.9' })), '192.0.2.1')
  })
})

describe('sunucuda vekil güveni ve hız sınırları', () => {
  it('varsayılan (loopback): sahte sol girdiyle sınır aşılamaz, gerçek istemci adresi sayılır', async () => {
    const ctx = await h.startServer({ authLimit: 2 })
    try {
      const attempt = (xff) => h.request(ctx, 'POST', '/api/login', { headers: { 'x-forwarded-for': xff }, body: { name: 'yok', authKey: h.authKeyFor('x') } })
      h.expectStatus(await attempt('198.51.100.1, 203.0.113.5'), 401)
      h.expectStatus(await attempt('198.51.100.2, 203.0.113.5'), 401)
      // İstemcinin her istekte değiştirdiği sol girdi işe yaramaz
      h.expectStatus(await attempt('198.51.100.3, 203.0.113.5'), 429, 'rate_limited')
      h.expectStatus(await attempt('203.0.113.6'), 401)
    } finally {
      await ctx.cleanup()
    }
  })

  it('belirli vekile güvenilince loopback bağlantısının başlıkları yok sayılır', async () => {
    const ctx = await h.startServer({ authLimit: 2, trustedProxies: ['192.0.2.10'] })
    try {
      const attempt = (xff) => h.request(ctx, 'POST', '/api/login', { headers: { 'x-forwarded-for': xff, 'cf-connecting-ip': xff }, body: { name: 'yok', authKey: h.authKeyFor('x') } })
      h.expectStatus(await attempt('203.0.113.1'), 401)
      h.expectStatus(await attempt('203.0.113.2'), 401)
      // Tüm istekler 127.0.0.1 olarak sayılır
      h.expectStatus(await attempt('203.0.113.3'), 429, 'rate_limited')
    } finally {
      await ctx.cleanup()
    }
  })

  it('geçersiz trustedProxies seçeneği TypeError', async () => {
    const { createChatServer } = require('../src/app')
    await assert.rejects(createChatServer({ dataDir: 'x', trustedProxies: 'bozuk' }), TypeError)
    await assert.rejects(createChatServer({ dataDir: 'x', trustedProxies: ['10.0.0.0/40'] }), TypeError)
  })
})
