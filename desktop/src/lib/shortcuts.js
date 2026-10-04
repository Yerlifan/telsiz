'use strict'

// Genel kısayolların (Electron accelerator) doğrulanması ve normalleştirilmesi. Electron'a
// bağımlı değildir. Yalnızca izinli bir alt küme kabul edilir:
//   değiştiriciler: CommandOrControl (Ctrl), Alt, Shift, Super (Windows tuşu)
//   tuşlar: A-Z, 0-9, F1-F24, sayısal tuş takımı, gezinme ve düzenleme tuşları, temel
//   noktalama, ses ve medya tuşları
// Değiştiricisiz tuş yalnızca F1-F24, ses ve medya tuşlarında kabul edilir. Yalnızca Shift ile
// harf, rakam veya noktalama da reddedilir, çünkü genel kısayol o tuşu bütün uygulamalardan alır
// ve yazmayı bozar. AltGr bilerek desteklenmez (Türkçe klavyede @, # gibi karakterleri üretir).

const { ACTIONS } = require('./channels')

const MAX_LENGTH = 80

// Girilebilen değiştirici adları (küçük harfle) ve normal biçimleri
const MODIFIERS = new Map([
  ['commandorcontrol', 'CommandOrControl'],
  ['cmdorctrl', 'CommandOrControl'],
  ['control', 'CommandOrControl'],
  ['ctrl', 'CommandOrControl'],
  ['alt', 'Alt'],
  ['option', 'Alt'],
  ['shift', 'Shift'],
  ['super', 'Super'],
  ['meta', 'Super']
])
const MODIFIER_ORDER = ['CommandOrControl', 'Alt', 'Shift', 'Super']

const NAMED_KEYS = [
  'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Return', 'Up', 'Down', 'Left', 'Right',
  'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Plus', 'PrintScreen',
  'VolumeUp', 'VolumeDown', 'VolumeMute', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause',
  'numdec', 'numadd', 'numsub', 'nummult', 'numdiv'
]
const KEY_ALIASES = new Map([['enter', 'Return'], ['esc', 'Escape']])
const PUNCTUATION = new Set(['-', '=', '[', ']', ';', '\'', ',', '.', '/', '\\', '`'])
// Değiştiricisiz kullanılabilen tuşlar (yazmayı bozmayanlar)
const STANDALONE_KEYS = new Set([
  'VolumeUp', 'VolumeDown', 'VolumeMute', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop', 'MediaPlayPause'
])

// 0..n-1 dizisi (noktalı virgülsüz döngüler için)
function range (n) {
  return Array.from({ length: n }, (_, i) => i)
}

const KEYS = new Map()
for (const name of NAMED_KEYS) KEYS.set(name.toLowerCase(), name)
for (const i of range(26)) {
  const letter = String.fromCharCode(65 + i)
  KEYS.set(letter.toLowerCase(), letter)
}
for (const i of range(10)) {
  KEYS.set(String(i), String(i))
  KEYS.set('num' + i, 'num' + i)
}
for (const i of range(24)) {
  KEYS.set('f' + (i + 1), 'F' + (i + 1))
  STANDALONE_KEYS.add('F' + (i + 1))
}
for (const mark of PUNCTUATION) KEYS.set(mark, mark)
for (const entry of KEY_ALIASES) KEYS.set(entry[0], entry[1])

// Yazı üreten tuşlar: harf, rakam, boşluk ve noktalama (yalnızca Shift ile kullanılamaz)
function isPrintable (key) {
  return /^[A-Z0-9]$/.test(key) || key === 'Space' || key === 'Plus' || PUNCTUATION.has(key)
}

// Geçerliyse normal biçimi (ör. "CommandOrControl+Shift+M"), değilse null döner
function normalizeAccelerator (input) {
  if (typeof input !== 'string') return null
  const text = input.trim()
  if (text === '' || text.length > MAX_LENGTH) return null
  const parts = text.split('+')
  // "+" ayırıcıdır, artı tuşu "Plus" adıyla yazılır, boş parça geçersizdir
  if (parts.some((part) => part.trim() === '')) return null
  const modifiers = new Set()
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIERS.get(part.trim().toLowerCase())
    if (!modifier || modifiers.has(modifier)) return null
    modifiers.add(modifier)
  }
  const key = KEYS.get(parts[parts.length - 1].trim().toLowerCase()) || null
  if (!key) return null
  if (modifiers.size === 0 && !STANDALONE_KEYS.has(key)) return null
  if (modifiers.size === 1 && modifiers.has('Shift') && isPrintable(key)) return null
  const ordered = MODIFIER_ORDER.filter((name) => modifiers.has(name))
  return ordered.concat([key]).join('+')
}

// Web uygulamasından gelen kısayol tablosunu doğrular.
// Girdi: { toggleMute: string|null, toggleDeafen: string|null } (eksik eylem null sayılır)
// Sonuç: { ok: true, map } veya { ok: false, code } (code: invalid, duplicate)
function validateShortcutMap (input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, code: 'invalid' }
  const proto = Object.getPrototypeOf(input)
  if (proto !== Object.prototype && proto !== null) return { ok: false, code: 'invalid' }
  const keys = Object.keys(input)
  if (keys.length > ACTIONS.length || keys.some((key) => !ACTIONS.includes(key))) return { ok: false, code: 'invalid' }
  const map = {}
  const used = new Set()
  for (const action of ACTIONS) {
    const value = Object.prototype.hasOwnProperty.call(input, action) ? input[action] : null
    if (value === null || value === undefined || value === '') {
      map[action] = null
      continue
    }
    const normalized = normalizeAccelerator(value)
    if (!normalized) return { ok: false, code: 'invalid' }
    if (used.has(normalized)) return { ok: false, code: 'duplicate' }
    used.add(normalized)
    map[action] = normalized
  }
  return { ok: true, map }
}

function emptyMap () {
  const map = {}
  for (const action of ACTIONS) map[action] = null
  return map
}

module.exports = {
  ACTIONS,
  MAX_LENGTH,
  normalizeAccelerator,
  validateShortcutMap,
  emptyMap
}
