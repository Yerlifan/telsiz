'use strict'

// Genel kısayol (accelerator) doğrulaması ve bas konuş ayarı (src/lib/shortcuts.js)

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeAccelerator, normalizeHoldKey, validateShortcutMap, validatePttSettings, holdConflict, defaultPtt, emptyMap, ACTIONS, PTT_MODES } = require('../src/lib/shortcuts')

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
  assert.deepEqual(ACTIONS, ['toggleMute', 'toggleDeafen', 'pttToggle'])
  assert.deepEqual(emptyMap(), { toggleMute: null, toggleDeafen: null, pttToggle: null })
  // Bas aç, bas kapat kısayolu diğerleriyle aynı kurallara uyar
  assert.deepEqual(validateShortcutMap({ pttToggle: 'ctrl+alt+v' }), { ok: true, map: { toggleMute: null, toggleDeafen: null, pttToggle: 'CommandOrControl+Alt+V' } })
  assert.deepEqual(validateShortcutMap({ pttToggle: 'V' }), { ok: false, code: 'invalid' })
  assert.deepEqual(validateShortcutMap({ toggleMute: 'F9', pttToggle: 'f9' }), { ok: false, code: 'duplicate' })
  assert.deepEqual(validateShortcutMap({ toggleMute: 'ctrl+shift+m', toggleDeafen: 'Ctrl+Shift+D' }), { ok: true, map: { toggleMute: 'CommandOrControl+Shift+M', toggleDeafen: 'CommandOrControl+Shift+D', pttToggle: null } })
  assert.deepEqual(validateShortcutMap({ toggleMute: 'F9' }), { ok: true, map: { toggleMute: 'F9', toggleDeafen: null, pttToggle: null } })
  assert.deepEqual(validateShortcutMap({ toggleMute: '', toggleDeafen: null }), { ok: true, map: { toggleMute: null, toggleDeafen: null, pttToggle: null } })
  assert.deepEqual(validateShortcutMap({}), { ok: true, map: { toggleMute: null, toggleDeafen: null, pttToggle: null } })
  assert.deepEqual(validateShortcutMap(Object.create(null)), { ok: true, map: { toggleMute: null, toggleDeafen: null, pttToggle: null } })
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

test('basılı tut tuşu: tek tuş da kabul edilir, yalnızca kancanın tanıdığı tuşlar', () => {
  const cases = {
    v: 'V',
    ' V ': 'V',
    '`': '`',
    F13: 'F13',
    'shift+num1': 'Shift+num1',
    'Alt+Ctrl+Space': 'CommandOrControl+Alt+Space',
    'Meta+Q': 'Super+Q',
    Enter: 'Return',
    numdec: 'numdec',
    'Shift+1': 'Shift+1'
  }
  for (const input of Object.keys(cases)) assert.equal(normalizeHoldKey(input), cases[input], input)
  const bad = ['Plus', 'Ctrl+Plus', 'VolumeUp', 'MediaPlayPause', 'Ctrl', 'Ctrl+', 'CapsLock', 'Ğ', 'AltGr+Q', 'F25', 'Ctrl+Ctrl+V', '', 'V'.repeat(81)]
  for (const input of bad) assert.equal(normalizeHoldKey(input), null, JSON.stringify(input))
  for (const input of [null, undefined, 5, {}, ['V']]) assert.equal(normalizeHoldKey(input), null)
})

test('bas konuş ayarı doğrulanır, varsayılan bas aç, bas kapat', () => {
  assert.deepEqual(PTT_MODES, ['toggle', 'hold'])
  assert.deepEqual(defaultPtt(), { mode: 'toggle', holdKey: null })
  assert.deepEqual(validatePttSettings({}), { ok: true, value: { mode: 'toggle', holdKey: null } })
  assert.deepEqual(validatePttSettings(Object.create(null)), { ok: true, value: { mode: 'toggle', holdKey: null } })
  assert.deepEqual(validatePttSettings({ mode: 'hold', holdKey: 'v' }), { ok: true, value: { mode: 'hold', holdKey: 'V' } })
  assert.deepEqual(validatePttSettings({ mode: 'toggle', holdKey: 'ctrl+f13' }), { ok: true, value: { mode: 'toggle', holdKey: 'CommandOrControl+F13' } })
  assert.deepEqual(validatePttSettings({ mode: 'hold', holdKey: '' }), { ok: true, value: { mode: 'hold', holdKey: null } })
  assert.deepEqual(validatePttSettings({ mode: 'hold', holdKey: null }), { ok: true, value: { mode: 'hold', holdKey: null } })
  const bad = [
    null, undefined, 'hold', ['hold'], new Map(), { mode: 'bas' }, { mode: '' }, { mode: 1 }, { mode: 'hold', holdKey: 'Plus' },
    { mode: 'hold', holdKey: 5 }, { mode: 'hold', holdKey: false }, { mode: 'hold', holdKey: 'V', fazla: 1 },
    Object.create({ mode: 'hold' }), JSON.parse('{"__proto__": {"mode": "hold"}}')
  ]
  for (const input of bad) assert.deepEqual(validatePttSettings(input), { ok: false, code: 'invalid' }, JSON.stringify(input))
})

test('basılı tut tuşu genel kısayolla çakışmaz', () => {
  const map = { toggleMute: 'CommandOrControl+Shift+M', toggleDeafen: 'F9', pttToggle: 'CommandOrControl+Alt+V' }
  // Kanca fazladan basılı değiştiricileri yok sayar: Ctrl+Shift+M basılınca M kancası da tetiklenirdi
  assert.equal(holdConflict(map, { mode: 'hold', holdKey: 'M' }), true)
  assert.equal(holdConflict(map, { mode: 'hold', holdKey: 'Shift+M' }), true)
  assert.equal(holdConflict(map, { mode: 'hold', holdKey: 'CommandOrControl+Shift+M' }), true)
  assert.equal(holdConflict(map, { mode: 'hold', holdKey: 'F9' }), true)
  assert.equal(holdConflict(map, { mode: 'hold', holdKey: 'Alt+M' }), false)
  assert.equal(holdConflict(map, { mode: 'hold', holdKey: 'N' }), false)
  // Bas aç, bas kapat kısayolu basılı tut kipinde kaydedilmez, çakışma sayılmaz
  assert.equal(holdConflict(map, { mode: 'hold', holdKey: 'V' }), false)
  assert.equal(holdConflict(map, { mode: 'toggle', holdKey: 'M' }), false)
  assert.equal(holdConflict(map, { mode: 'hold', holdKey: null }), false)
  assert.equal(holdConflict(null, { mode: 'hold', holdKey: 'M' }), false)
})
