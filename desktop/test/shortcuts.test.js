'use strict'

// Genel kısayol (accelerator) doğrulaması (src/lib/shortcuts.js)

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeAccelerator, validateShortcutMap, emptyMap, ACTIONS } = require('../src/lib/shortcuts')

test('geçerli bileşimler normal biçime çevrilir', () => {
  const cases = {
    'CommandOrControl+Shift+M': 'CommandOrControl+Shift+M',
    'ctrl+shift+m': 'CommandOrControl+Shift+M',
    'Shift+Ctrl+M': 'CommandOrControl+Shift+M',
    'CmdOrCtrl+Alt+D': 'CommandOrControl+Alt+D',
    'Control+F11': 'CommandOrControl+F11',
    'Alt+1': 'Alt+1',
    'Super+Alt+K': 'Alt+Super+K',
    'Meta+K': 'Super+K',
    'Option+Space': 'Alt+Space',
    F9: 'F9',
    f24: 'F24',
    'Shift+F1': 'Shift+F1',
    MediaPlayPause: 'MediaPlayPause',
    volumemute: 'VolumeMute',
    'Ctrl+num5': 'CommandOrControl+num5',
    'Ctrl+numadd': 'CommandOrControl+numadd',
    'Ctrl+Plus': 'CommandOrControl+Plus',
    'Ctrl+Enter': 'CommandOrControl+Return',
    'Alt+Esc': 'Alt+Escape',
    'Ctrl+;': 'CommandOrControl+;',
    'Ctrl+\\': 'CommandOrControl+\\',
    'Ctrl+`': 'CommandOrControl+`',
    ' Ctrl + Shift + M ': 'CommandOrControl+Shift+M'
  }
  for (const input of Object.keys(cases)) assert.equal(normalizeAccelerator(input), cases[input], input)
})

test('yazmayı bozan, eksik veya bilinmeyen bileşimler reddedilir', () => {
  const bad = [
    'A', 'm', '1', 'Space', 'Return', 'Escape', 'Tab', 'Up', 'num1', '-', 'Plus',
    'Shift+A', 'Shift+1', 'Shift+Space', 'Shift+;', 'Shift+Plus',
    'Ctrl', 'Ctrl+Shift', 'Ctrl+', '+M', 'Ctrl++', 'Ctrl+Ctrl+M', 'Ctrl+Control+M',
    'AltGr+Q', 'Command+M', 'Cmd+M', 'Hyper+M', 'Ctrl+F25', 'Ctrl+Capslock', 'Ctrl+Numlock',
    'Ctrl+M+N', 'Ctrl+Ğ', 'Ctrl+ç', 'Ctrl+' + String.fromCharCode(0xa0), '',
    'Ctrl+Shift+Alt+Super+' + 'M'.repeat(80)
  ]
  for (const input of bad) assert.equal(normalizeAccelerator(input), null, JSON.stringify(input))
  for (const input of [null, undefined, 5, {}, ['Ctrl+M']]) assert.equal(normalizeAccelerator(input), null)
})

test('kısayol tablosu doğrulanır', () => {
  assert.deepEqual(ACTIONS, ['toggleMute', 'toggleDeafen'])
  assert.deepEqual(emptyMap(), { toggleMute: null, toggleDeafen: null })
  assert.deepEqual(validateShortcutMap({ toggleMute: 'ctrl+shift+m', toggleDeafen: 'Ctrl+Shift+D' }), { ok: true, map: { toggleMute: 'CommandOrControl+Shift+M', toggleDeafen: 'CommandOrControl+Shift+D' } })
  assert.deepEqual(validateShortcutMap({ toggleMute: 'F9' }), { ok: true, map: { toggleMute: 'F9', toggleDeafen: null } })
  assert.deepEqual(validateShortcutMap({ toggleMute: '', toggleDeafen: null }), { ok: true, map: { toggleMute: null, toggleDeafen: null } })
  assert.deepEqual(validateShortcutMap({}), { ok: true, map: { toggleMute: null, toggleDeafen: null } })
  assert.deepEqual(validateShortcutMap(Object.create(null)), { ok: true, map: { toggleMute: null, toggleDeafen: null } })
  assert.deepEqual(validateShortcutMap({ toggleMute: 'Ctrl+M', toggleDeafen: 'control+m' }), { ok: false, code: 'duplicate' })
  assert.deepEqual(validateShortcutMap({ toggleMute: 'M' }), { ok: false, code: 'invalid' })
  assert.deepEqual(validateShortcutMap({ toggleMute: 5 }), { ok: false, code: 'invalid' })
  assert.deepEqual(validateShortcutMap({ pushToTalk: 'F9' }), { ok: false, code: 'invalid' })
  assert.deepEqual(validateShortcutMap({ toggleMute: 'F9', toggleDeafen: 'F10', extra: null }), { ok: false, code: 'invalid' })
  for (const bad of [null, undefined, 'F9', ['F9'], new Map(), new Date()]) assert.deepEqual(validateShortcutMap(bad), { ok: false, code: 'invalid' })
  const proto = Object.create({ toggleMute: 'F9' })
  assert.deepEqual(validateShortcutMap(proto), { ok: false, code: 'invalid' })
  assert.deepEqual(validateShortcutMap(JSON.parse('{"__proto__": {"toggleMute": "F9"}}')), { ok: false, code: 'invalid' })
})
