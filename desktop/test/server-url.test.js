'use strict'

// Sunucu adresi doğrulaması, /api/info denetimi ve sürüm uyumu (src/lib/server-url.js)

const { test } = require('node:test')
const assert = require('node:assert/strict')
const su = require('../src/lib/server-url')

test('https adresleri normalleştirilir', () => {
  assert.deepEqual(su.parseServerUrl('https://Telsiz.Ornek.com'), { ok: true, origin: 'https://telsiz.ornek.com', secure: true })
  assert.deepEqual(su.parseServerUrl('  https://telsiz.ornek.com/  '), { ok: true, origin: 'https://telsiz.ornek.com', secure: true })
  assert.equal(su.parseServerUrl('https://telsiz.ornek.com:443').origin, 'https://telsiz.ornek.com')
  assert.equal(su.parseServerUrl('https://telsiz.ornek.com:8443').origin, 'https://telsiz.ornek.com:8443')
  assert.equal(su.parseServerUrl('telsiz.ornek.com').origin, 'https://telsiz.ornek.com')
  assert.equal(su.parseServerUrl('localhost:4310').origin, 'https://localhost:4310')
  assert.equal(su.parseServerUrl('https://192.168.1.20').origin, 'https://192.168.1.20')
  assert.equal(su.parseServerUrl('https://örnek.com').origin, 'https://xn--rnek-4qa.com')
})

test('http yalnızca bu bilgisayardaki sunucu için kabul edilir', () => {
  assert.equal(su.parseServerUrl('http://localhost:4310').origin, 'http://localhost:4310')
  assert.equal(su.parseServerUrl('http://127.0.0.1:4310').origin, 'http://127.0.0.1:4310')
  assert.equal(su.parseServerUrl('http://LOCALHOST').origin, 'http://localhost')
  for (const value of ['http://ornek.com', 'http://192.168.1.2', 'http://[::1]:4310', 'http://localhost.ornek.com', 'http://127.0.0.2', 'http://0.0.0.0']) {
    assert.equal(su.parseServerUrl(value).code, 'insecure', value)
  }
})

test('geçersiz, yol içeren, kimlik bilgili veya başka şemalı adresler reddedilir', () => {
  const cases = {
    '': 'invalid',
    '   ': 'invalid',
    'ftp://ornek.com': 'invalid',
    'file:///etc/passwd': 'invalid',
    'javascript:alert(1)': 'invalid',
    'telsiz://app': 'invalid',
    'https://': 'invalid',
    'https://ornek .com': 'invalid',
    'https://ornek.com\\x': 'invalid',
    'https://orn\tek.com': 'invalid',
    'https://a\u0000b.com': 'invalid',
    'https://kullanici:parola@ornek.com': 'credentials',
    'https://kullanici@ornek.com': 'credentials',
    'https://ornek.com/telsiz': 'path',
    'https://ornek.com/?a=1': 'path',
    'https://ornek.com/#x': 'path',
    'https://ornek.com?': 'path',
    'https://ornek.com#': 'path',
    'https://ornek.com/%2e%2e/': 'path'
  }
  for (const value of Object.keys(cases)) assert.equal(su.parseServerUrl(value).code, cases[value], JSON.stringify(value))
  assert.equal(su.parseServerUrl('https://' + 'a'.repeat(300) + '.com').code, 'too_long')
  for (const value of [null, undefined, 42, {}, []]) assert.equal(su.parseServerUrl(value).code, 'invalid')
})

test('ayardaki köken yalnızca normalleştirilmiş biçimdeyse geçerlidir', () => {
  assert.equal(su.isValidOrigin('https://telsiz.ornek.com'), true)
  assert.equal(su.isValidOrigin('http://127.0.0.1:4310'), true)
  assert.equal(su.isValidOrigin('https://telsiz.ornek.com/'), false)
  assert.equal(su.isValidOrigin('https://TELSIZ.ornek.com'), false)
  assert.equal(su.isValidOrigin('telsiz.ornek.com'), false)
  assert.equal(su.isValidOrigin('http://ornek.com'), false)
  assert.equal(su.isValidOrigin(null), false)
})

test('/api/info yanıtı ve sürüm uyumu', () => {
  const good = { serverName: 'Kankalar', setupRequired: false, version: '2.0.0', limits: {} }
  assert.deepEqual(su.parseInfo(good), { serverName: 'Kankalar', version: '2.0.0', setupRequired: false })
  assert.equal(su.parseInfo(Object.assign({}, good, { version: null })).version, null)
  for (const bad of [null, [], 'x', {}, Object.assign({}, good, { serverName: '' }), Object.assign({}, good, { setupRequired: 'no' }), Object.assign({}, good, { limits: null }), Object.assign({}, good, { version: 2 }), Object.assign({}, good, { serverName: 'x'.repeat(201) })]) {
    assert.equal(su.parseInfo(bad), null)
  }
  assert.deepEqual(su.compareVersions('2.4.1', '2.0.0'), { compatible: true, reason: 'match' })
  assert.deepEqual(su.compareVersions('3.0.0', '2.0.0'), { compatible: false, reason: 'mismatch' })
  assert.deepEqual(su.compareVersions('1.9.9', '2.0.0'), { compatible: false, reason: 'mismatch' })
  assert.deepEqual(su.compareVersions(null, '2.0.0'), { compatible: false, reason: 'unknown' })
  assert.deepEqual(su.compareVersions('abc', '2.0.0'), { compatible: false, reason: 'unknown' })
  assert.equal(su.majorOf('2.0.0-beta.1'), 2)
  assert.equal(su.majorOf('v12.1.0'), 12)
})

test('ağ hataları sınıflandırılır', () => {
  assert.equal(su.classifyNetworkError(new Error('net::ERR_CERT_AUTHORITY_INVALID')), 'certificate')
  const nodeCert = new TypeError('fetch failed')
  nodeCert.cause = Object.assign(new Error('self-signed certificate'), { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' })
  assert.equal(su.classifyNetworkError(nodeCert), 'certificate')
  const refused = new TypeError('fetch failed')
  refused.cause = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
  assert.equal(su.classifyNetworkError(refused), 'unreachable')
  assert.equal(su.classifyNetworkError(null), 'unreachable')
})

function fakeResponse (status, body) {
  return new Response(body, { status, headers: { 'content-type': 'application/json' } })
}

test('checkServer: başarı, yönlendirme yasağı ve hatalar', async () => {
  let seen = null
  const ok = await su.checkServer(async (url, init) => {
    seen = { url, init }
    return fakeResponse(200, JSON.stringify({ serverName: 'Kankalar', setupRequired: true, version: '2.1.0', limits: {} }))
  }, 'https://telsiz.ornek.com', '2.0.0')
  assert.deepEqual(ok, { ok: true, origin: 'https://telsiz.ornek.com', serverName: 'Kankalar', version: '2.1.0', compatible: true, reason: 'match' })
  assert.equal(seen.url, 'https://telsiz.ornek.com/api/info')
  assert.equal(seen.init.redirect, 'error')
  assert.equal(seen.init.credentials, 'omit')
  assert.equal(seen.init.cache, 'no-store')

  const mismatch = await su.checkServer(async () => fakeResponse(200, JSON.stringify({ serverName: 'S', setupRequired: false, version: '3.0.0', limits: {} })), 'https://s.com', '2.0.0')
  assert.equal(mismatch.compatible, false)
  assert.equal(mismatch.reason, 'mismatch')

  assert.equal((await su.checkServer(async () => fakeResponse(404, '{}'), 'https://s.com', '2.0.0')).code, 'not_telsiz')
  assert.equal((await su.checkServer(async () => fakeResponse(200, '<html>'), 'https://s.com', '2.0.0')).code, 'not_telsiz')
  assert.equal((await su.checkServer(async () => fakeResponse(200, '"x"'), 'https://s.com', '2.0.0')).code, 'not_telsiz')
  assert.equal((await su.checkServer(async () => fakeResponse(200, 'x'.repeat(su.MAX_INFO_BYTES + 1)), 'https://s.com', '2.0.0')).code, 'not_telsiz')
  assert.equal((await su.checkServer(async () => { throw new Error('net::ERR_CERT_DATE_INVALID') }, 'https://s.com', '2.0.0')).code, 'certificate')
  assert.equal((await su.checkServer(async () => { throw new Error('net::ERR_NAME_NOT_RESOLVED') }, 'https://s.com', '2.0.0')).code, 'unreachable')
  const slow = await su.checkServer((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')))
  }), 'https://s.com', '2.0.0', { timeoutMs: 50 })
  assert.equal(slow.code, 'timeout')
})
