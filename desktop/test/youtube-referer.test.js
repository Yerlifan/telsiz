'use strict'

// Telsiz DJ YouTube oynatıcısı: masaüstünde telsiz://app kökeninden Referer gitmediği için YouTube
// oynatıcısı 153 hatası veriyordu. Çerçeve isteğine sunucunun kökeni Referer olarak eklenir.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { youtubeEmbedHeaders } = require('../src/lib/navigation')

const EMBED = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1'

function details (extra) {
  return Object.assign({ url: EMBED, resourceType: 'subFrame', requestHeaders: { 'User-Agent': 'x' } }, extra)
}

test('YouTube çerçeve isteğine sunucu kökeni Referer olarak eklenir', () => {
  const input = details()
  assert.deepEqual(youtubeEmbedHeaders(input, 'https://telsiz.ornek.com'), { 'User-Agent': 'x', Referer: 'https://telsiz.ornek.com/' })
  assert.deepEqual(youtubeEmbedHeaders(details(), 'http://localhost:3000'), { 'User-Agent': 'x', Referer: 'http://localhost:3000/' })
  assert.deepEqual(input.requestHeaders, { 'User-Agent': 'x' }, 'gelen nesne değişmez')
})

test('Referer yalnız embed alt çerçeve isteğine ve yalnız http(s) sunucu kökeniyle eklenir', () => {
  const plain = { 'User-Agent': 'x' }
  assert.deepEqual(youtubeEmbedHeaders(details({ resourceType: 'script' }), 'https://a.com'), plain)
  assert.deepEqual(youtubeEmbedHeaders(details({ url: 'https://www.youtube-nocookie.com/s/player.js' }), 'https://a.com'), plain)
  assert.deepEqual(youtubeEmbedHeaders(details({ url: 'https://www.youtube.com/embed/dQw4w9WgXcQ' }), 'https://a.com'), plain)
  assert.deepEqual(youtubeEmbedHeaders(details({ url: 'http://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' }), 'https://a.com'), plain)
  assert.deepEqual(youtubeEmbedHeaders(details(), 'telsiz://app'), plain)
  assert.deepEqual(youtubeEmbedHeaders(details(), ''), plain)
  assert.deepEqual(youtubeEmbedHeaders(details({ url: 'çöp' }), 'https://a.com'), plain)
  assert.deepEqual(youtubeEmbedHeaders(null, 'https://a.com'), {})
})

test('istekte zaten Referer varsa dokunulmaz', () => {
  const headers = { referer: 'https://b.com/' }
  assert.deepEqual(youtubeEmbedHeaders(details({ requestHeaders: headers }), 'https://a.com'), headers)
})
