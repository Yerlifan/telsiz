'use strict'

// Basılı tut tuşunun (src/lib/shortcuts.js normalizeHoldKey biçimi, ör. "V" veya "CommandOrControl+F13")
// uiohook-napi tuş kodlarına çevrilmesi. Electron'a ve yerel modüle bağımlı değildir: kodlar modülün
// UiohookKey tablosundan okunur ve tablo dışarıdan verilir. Böylece eşleme yerel modül yüklenmeden
// denetlenebilir (desktop/test/tus-kancasi.test.js) ve paket güncellense de kodlar modülün kendi
// tablosundan gelir.
// Tuş adları web tarafının (public/js/20-desktop.js keyFromCode) KeyboardEvent.code değerlerinden
// ürettiği Electron tuş adlarıdır. Tabloda olmayan tuşlar (ses ve medya tuşları, Plus) basılı tut
// için kabul edilmez.

// 0..n-1 dizisi (noktalı virgülsüz döngüler için)
function range (n) {
  return Array.from({ length: n }, (_, i) => i)
}

// Tuş adı -> UiohookKey alan adları. İlk ad asıl tuştur. Sonrakiler aynı fiziksel tuşun başka kodlarıdır:
// sayısal tuş takımı NumLock kapalıyken gezinme kodlarıyla gelir, web tarafı iki Enter tuşunu da Return
// olarak yakalar.
const KEY_FIELDS = new Map([
  ['Space', ['Space']],
  ['Tab', ['Tab']],
  ['Backspace', ['Backspace']],
  ['Delete', ['Delete']],
  ['Insert', ['Insert']],
  ['Return', ['Enter', 'NumpadEnter']],
  ['Escape', ['Escape']],
  ['Up', ['ArrowUp']],
  ['Down', ['ArrowDown']],
  ['Left', ['ArrowLeft']],
  ['Right', ['ArrowRight']],
  ['Home', ['Home']],
  ['End', ['End']],
  ['PageUp', ['PageUp']],
  ['PageDown', ['PageDown']],
  ['PrintScreen', ['PrintScreen']],
  ['-', ['Minus']],
  ['=', ['Equal']],
  ['[', ['BracketLeft']],
  [']', ['BracketRight']],
  [';', ['Semicolon']],
  ['\'', ['Quote']],
  [',', ['Comma']],
  ['.', ['Period']],
  ['/', ['Slash']],
  ['\\', ['Backslash']],
  ['`', ['Backquote']],
  ['num0', ['Numpad0', 'NumpadInsert']],
  ['num1', ['Numpad1', 'NumpadEnd']],
  ['num2', ['Numpad2', 'NumpadArrowDown']],
  ['num3', ['Numpad3', 'NumpadPageDown']],
  ['num4', ['Numpad4', 'NumpadArrowLeft']],
  ['num5', ['Numpad5']],
  ['num6', ['Numpad6', 'NumpadArrowRight']],
  ['num7', ['Numpad7', 'NumpadHome']],
  ['num8', ['Numpad8', 'NumpadArrowUp']],
  ['num9', ['Numpad9', 'NumpadPageUp']],
  ['numdec', ['NumpadDecimal', 'NumpadDelete']],
  ['numadd', ['NumpadAdd']],
  ['numsub', ['NumpadSubtract']],
  ['nummult', ['NumpadMultiply']],
  ['numdiv', ['NumpadDivide']]
])
for (const i of range(26)) {
  const letter = String.fromCharCode(65 + i)
  KEY_FIELDS.set(letter, [letter])
}
for (const i of range(10)) KEY_FIELDS.set(String(i), [String(i)])
for (const i of range(24)) KEY_FIELDS.set('F' + (i + 1), ['F' + (i + 1)])

// Değiştiriciler: olaydaki bayrak ve sol ile sağ tuşun alan adları (bırakılınca konuşma biter)
const MODIFIER_FIELDS = new Map([
  ['CommandOrControl', { flag: 'ctrlKey', fields: ['Ctrl', 'CtrlRight'] }],
  ['Alt', { flag: 'altKey', fields: ['Alt', 'AltRight'] }],
  ['Shift', { flag: 'shiftKey', fields: ['Shift', 'ShiftRight'] }],
  ['Super', { flag: 'metaKey', fields: ['Meta', 'MetaRight'] }]
])

function isMappableKey (name) {
  return typeof name === 'string' && KEY_FIELDS.has(name)
}

function codeOf (table, field) {
  const value = Object.prototype.hasOwnProperty.call(table, field) ? table[field] : undefined
  return Number.isInteger(value) && value > 0 && value <= 0xffff ? value : null
}

// Normal biçimdeki basılı tut tuşunu kodlara çevirir. Sonuç:
//   { codes: [asıl tuşun kodları], flags: ['ctrlKey', ...], releaseCodes: [değiştiricilerin kodları] }
// Ad veya tablodaki bir alan geçersizse null döner (kanca başlatılmaz).
function resolveHoldKey (holdKey, table) {
  if (typeof holdKey !== 'string' || holdKey === '' || !table || typeof table !== 'object') return null
  const parts = holdKey.split('+')
  const key = parts[parts.length - 1]
  if (!isMappableKey(key)) return null
  const codes = []
  for (const field of KEY_FIELDS.get(key)) {
    const code = codeOf(table, field)
    if (code === null) return null
    codes.push(code)
  }
  const flags = []
  const releaseCodes = []
  for (const name of parts.slice(0, -1)) {
    const modifier = MODIFIER_FIELDS.get(name)
    if (!modifier || flags.includes(modifier.flag)) return null
    flags.push(modifier.flag)
    for (const field of modifier.fields) {
      const code = codeOf(table, field)
      if (code === null) return null
      releaseCodes.push(code)
    }
  }
  return { codes, flags, releaseCodes }
}

module.exports = {
  KEY_FIELDS,
  MODIFIER_FIELDS,
  isMappableKey,
  resolveHoldKey
}
