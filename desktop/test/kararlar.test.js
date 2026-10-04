'use strict'

// Gezinme, izin ve ekran paylaşımı kararları (src/lib/navigation.js, permissions.js, screen-share.js)

const { test } = require('node:test')
const assert = require('node:assert/strict')
const nav = require('../src/lib/navigation')
const perm = require('../src/lib/permissions')
const share = require('../src/lib/screen-share')

const APP = 'telsiz://app'

test('köken hesaplama', () => {
  assert.equal(nav.originOf('telsiz://app/'), 'telsiz://app')
  assert.equal(nav.originOf('telsiz://app'), 'telsiz://app')
  assert.equal(nav.originOf('telsiz://app/index.html?x#y'), 'telsiz://app')
  assert.equal(nav.originOf('https://a.com:8443/x'), 'https://a.com:8443')
  assert.equal(nav.originOf('file:///etc/passwd'), null)
  assert.equal(nav.originOf('blob:telsiz://app/1'), null)
  assert.equal(nav.originOf('data:text/html,x'), null)
  assert.equal(nav.originOf(''), null)
  assert.equal(nav.originOf(null), null)
})

test('gezinme kararları', () => {
  assert.equal(nav.decideNavigation('telsiz://app/', 'app'), 'allow')
  assert.equal(nav.decideNavigation('telsiz://app/index.html?davet=1#x', 'app'), 'allow')
  assert.equal(nav.decideNavigation('telsiz://baglan/', 'connect'), 'allow')
  assert.equal(nav.decideNavigation('telsiz://secici/', 'picker'), 'allow')
  const denied = [
    ['telsiz://app/api/info', 'app'], ['telsiz://app/js/01-core.js', 'app'], ['telsiz://baglan/', 'app'],
    ['telsiz://app/', 'connect'], ['telsiz://app/', 'picker'], ['telsiz://app/', undefined], ['telsiz://app/', 'none'],
    ['http://127.0.0.1:4310/', 'app'], ['file:///etc/passwd', 'app'], ['javascript:alert(1)', 'app'],
    ['data:text/html,x', 'app'], ['blob:telsiz://app/x', 'app'], ['about:blank', 'app'], ['chrome://gpu', 'app'],
    ['devtools://devtools', 'app'], ['ftp://x.com/', 'app'], ['https://u:p@x.com/', 'app'], ['not a url', 'app']
  ]
  for (const [url, ctx] of denied) assert.equal(nav.decideNavigation(url, ctx), 'deny', url + ' ' + ctx)
  assert.equal(nav.decideNavigation('https://ornek.com/a?b#c', 'app'), 'external')
  assert.equal(nav.decideNavigation('https://' + 'a'.repeat(2100) + '.com', 'app'), 'deny')
  assert.equal(nav.decideWindowOpen('https://ornek.com/'), 'external')
  for (const url of ['http://ornek.com/', 'telsiz://app/', 'file:///x', 'javascript:x', 'mailto:a@b.c', '']) assert.equal(nav.decideWindowOpen(url), 'deny', url)
})

test('izin isteği kararları', () => {
  const main = { isMainFrame: true, requestingUrl: 'telsiz://app/', securityOrigin: 'telsiz://app/' }
  const req = (permission, extra) => perm.decideRequest(permission, Object.assign({}, main, extra || {}), APP)
  assert.equal(req('media', { mediaTypes: ['audio'] }), 'allow')
  assert.equal(req('media', { mediaTypes: ['video'] }), 'deny')
  assert.equal(req('media', { mediaTypes: ['audio', 'video'] }), 'deny')
  assert.equal(req('media', { mediaTypes: [] }), 'display')
  assert.equal(req('media', { mediaTypes: undefined }), 'deny')
  assert.equal(req('notifications'), 'allow')
  assert.equal(req('clipboard-sanitized-write'), 'allow')
  for (const p of ['clipboard-read', 'geolocation', 'display-capture', 'fullscreen', 'openExternal', 'hid', 'usb', 'serial', 'midi', 'midiSysex', 'pointerLock', 'screen-wake-lock', 'speaker-selection', 'window-management', 'unknown', 'fileSystem', 'local-network-access']) {
    assert.equal(req(p), 'deny', p)
  }
  assert.equal(perm.decideRequest('notifications', Object.assign({}, main, { isMainFrame: false }), APP), 'deny')
  assert.equal(perm.decideRequest('notifications', Object.assign({}, main, { requestingUrl: 'telsiz://baglan/' }), APP), 'deny')
  assert.equal(perm.decideRequest('notifications', Object.assign({}, main, { requestingUrl: 'https://kotu.com/' }), APP), 'deny')
  assert.equal(perm.decideRequest('media', Object.assign({}, main, { mediaTypes: ['audio'], securityOrigin: 'https://kotu.com' }), APP), 'deny')
  assert.equal(perm.decideRequest('notifications', main, null), 'deny')
  assert.equal(perm.decideRequest('notifications', null, APP), 'deny')
})

test('izin denetimi kararları', () => {
  const d = { isMainFrame: true, requestingUrl: 'telsiz://app/' }
  assert.equal(perm.decideCheck('media', 'telsiz://app/', Object.assign({ mediaType: 'audio' }, d), APP), true)
  assert.equal(perm.decideCheck('media', 'telsiz://app', Object.assign({ mediaType: 'video' }, d), APP), false)
  assert.equal(perm.decideCheck('media', 'telsiz://app', Object.assign({ mediaType: 'unknown' }, d), APP), false)
  assert.equal(perm.decideCheck('notifications', 'telsiz://app/', d, APP), true)
  assert.equal(perm.decideCheck('clipboard-sanitized-write', 'telsiz://app/', d, APP), true)
  assert.equal(perm.decideCheck('clipboard-read', 'telsiz://app/', d, APP), false)
  assert.equal(perm.decideCheck('notifications', 'telsiz://baglan/', d, APP), false)
  assert.equal(perm.decideCheck('notifications', 'telsiz://app/', { isMainFrame: false }, APP), false)
  assert.equal(perm.decideCheck('notifications', 'telsiz://app/', { isMainFrame: true, requestingUrl: 'https://x.com/' }, APP), false)
  assert.equal(perm.decideCheck('notifications', 'telsiz://app/', d, null), false)
})

test('ekran paylaşımı: kullanıcı girişi, istek ve bekleyen seçim', () => {
  const now = 100000
  assert.equal(share.hasRecentActivation(now - 1000, now), true)
  assert.equal(share.hasRecentActivation(now - share.ACTIVATION_WINDOW_MS - 1, now), false)
  assert.equal(share.hasRecentActivation(undefined, now), false)
  assert.equal(share.hasRecentActivation(now + 10, now), false)

  const request = { securityOrigin: 'telsiz://app/', videoRequested: true, audioRequested: false, userGesture: true }
  const frame = { url: 'telsiz://app/', isMainFrame: true }
  assert.equal(share.isAcceptableDisplayRequest(request, frame, APP), true)
  assert.equal(share.isAcceptableDisplayRequest(Object.assign({}, request, { userGesture: false }), frame, APP), false)
  assert.equal(share.isAcceptableDisplayRequest(Object.assign({}, request, { videoRequested: false }), frame, APP), false)
  assert.equal(share.isAcceptableDisplayRequest(Object.assign({}, request, { securityOrigin: 'https://kotu.com' }), frame, APP), false)
  assert.equal(share.isAcceptableDisplayRequest(request, { url: 'telsiz://app/', isMainFrame: false }, APP), false)
  assert.equal(share.isAcceptableDisplayRequest(request, { url: 'https://kotu.com/', isMainFrame: true }, APP), false)
  assert.equal(share.isAcceptableDisplayRequest(request, null, APP), false)

  const pending = { contentsId: 7, video: { id: 'screen:0:0', name: 'Ekran' }, systemAudio: true, createdAt: now }
  assert.equal(share.isPendingFresh(pending, 7, now + 100), true)
  assert.equal(share.isPendingFresh(pending, 8, now + 100), false)
  assert.equal(share.isPendingFresh(pending, 7, now + share.PENDING_TTL_MS + 1), false)
  assert.equal(share.isPendingFresh(null, 7, now), false)
  assert.deepEqual(share.buildStreams(pending, { audioRequested: true }, 'win32'), { video: { id: 'screen:0:0', name: 'Ekran' }, audio: 'loopback' })
  assert.deepEqual(share.buildStreams(pending, { audioRequested: true }, 'linux'), { video: { id: 'screen:0:0', name: 'Ekran' } })
  assert.deepEqual(share.buildStreams(pending, { audioRequested: false }, 'win32'), { video: { id: 'screen:0:0', name: 'Ekran' } })
  assert.deepEqual(share.buildStreams(null, request, 'win32'), {})
})

test('ekran paylaşımı: kaynak listesi ve seçim doğrulaması', () => {
  const png = 'data:image/png;base64,iVBORw0KGgo='
  const sources = share.toPickerSources([
    { id: 'window:123:0', name: 'Oyun\u0007 penceresi', thumbnail: png },
    { id: 'screen:0:0', name: 'Ekran 1', thumbnail: png },
    { id: 'screen:0:0', name: 'Tekrar', thumbnail: png },
    { id: 'kotu:1:2', name: 'x', thumbnail: png },
    { id: 'window:1:0;rm', name: 'x', thumbnail: png },
    { id: 'window:9:0', name: 'Resimsiz', thumbnail: 'data:text/html;base64,PGI+' },
    null
  ])
  assert.deepEqual(sources.map((s) => s.id), ['screen:0:0', 'window:123:0', 'window:9:0'])
  assert.equal(sources[1].name, 'Oyun  penceresi')
  assert.equal(sources[0].type, 'screen')
  assert.equal(sources[2].thumbnail, '')
  assert.equal(share.toPickerSources('x').length, 0)
  assert.ok(share.toPickerSources(Array.from({ length: 100 }, (_, i) => ({ id: 'window:' + i + ':0', name: 'p' }))).length <= share.MAX_SOURCES)
  assert.deepEqual(share.resolveChoice(sources, { id: 'screen:0:0', systemAudio: true }, 'win32'), { video: { id: 'screen:0:0', name: 'Ekran 1' }, systemAudio: true })
  assert.deepEqual(share.resolveChoice(sources, { id: 'screen:0:0', systemAudio: true }, 'linux'), { video: { id: 'screen:0:0', name: 'Ekran 1' }, systemAudio: false })
  assert.equal(share.resolveChoice(sources, { id: 'screen:9:0' }, 'win32'), null)
  assert.equal(share.resolveChoice(sources, { id: 5 }, 'win32'), null)
  assert.equal(share.resolveChoice(sources, null, 'win32'), null)
  assert.equal(share.systemAudioSupported('win32'), true)
  assert.equal(share.systemAudioSupported('linux'), false)
})
