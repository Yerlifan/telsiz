'use strict'

// Başlık çubuğu kararları (src/lib/title-bar.js): pencere seçenekleri, renklerin ve menü isteğinin süzülmesi

const { test } = require('node:test')
const assert = require('node:assert/strict')
const titleBar = require('../src/lib/title-bar')

test('kaplama yalnızca Windows ve Linux için', () => {
  assert.equal(titleBar.supported('win32'), true)
  assert.equal(titleBar.supported('linux'), true)
  assert.equal(titleBar.supported('darwin'), false)
  assert.equal(titleBar.supported(''), false)
  assert.deepEqual(titleBar.windowOptions('darwin'), {})
})

test('pencere seçenekleri: gizli başlık çubuğu, tema rengi veya varsayılan renk', () => {
  assert.deepEqual(titleBar.windowOptions('win32'), {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0f1015', symbolColor: '#f2f1f8', height: titleBar.OVERLAY_HEIGHT }
  })
  assert.deepEqual(titleBar.windowOptions('linux', { color: '#ECEDF4', symbolColor: '#16151e' }).titleBarOverlay, {
    color: '#ecedf4',
    symbolColor: '#16151e',
    height: titleBar.OVERLAY_HEIGHT
  })
  // Geçersiz kayıtlı renk varsayılana döner
  assert.equal(titleBar.windowOptions('linux', { color: 'red', symbolColor: '#000000' }).titleBarOverlay.color, '#0f1015')
})

test('renkler yalnızca #rrggbb biçiminde kabul edilir', () => {
  assert.deepEqual(titleBar.cleanColors({ color: '#0F1015', symbolColor: '#f2f1f8' }), { color: '#0f1015', symbolColor: '#f2f1f8' })
  const bad = [
    null,
    'x',
    {},
    { color: '#0f1015' },
    { color: '#fff', symbolColor: '#000' },
    { color: 'rgb(1, 2, 3)', symbolColor: '#000000' },
    { color: '#0f1015;', symbolColor: '#000000' },
    { color: 'url(x)', symbolColor: '#000000' },
    { color: '#0f1015', symbolColor: 1 },
    { color: '#gggggg', symbolColor: '#000000' }
  ]
  for (const value of bad) assert.equal(titleBar.cleanColors(value), null, JSON.stringify(value))
  assert.equal(titleBar.sameColors({ color: '#000000', symbolColor: '#ffffff' }, { color: '#000000', symbolColor: '#ffffff' }), true)
  assert.equal(titleBar.sameColors({ color: '#000000', symbolColor: '#ffffff' }, null), false)
})

test('menü isteği: var olan bölüm ve pencere içi konum', () => {
  assert.deepEqual(titleBar.cleanMenuRequest(0, 10, 32, 4), { index: 0, x: 10, y: 32 })
  assert.deepEqual(titleBar.cleanMenuRequest(3, 0, 0, 4), { index: 3, x: 0, y: 0 })
  assert.equal(titleBar.cleanMenuRequest(4, 10, 32, 4), null)
  assert.equal(titleBar.cleanMenuRequest(-1, 10, 32, 4), null)
  assert.equal(titleBar.cleanMenuRequest(1.5, 10, 32, 4), null)
  assert.equal(titleBar.cleanMenuRequest('0', 10, 32, 4), null)
  assert.equal(titleBar.cleanMenuRequest(0, -1, 32, 4), null)
  assert.equal(titleBar.cleanMenuRequest(0, 10, Infinity, 4), null)
  assert.equal(titleBar.cleanMenuRequest(0, NaN, 32, 4), null)
  assert.equal(titleBar.cleanMenuRequest(0, 10, 1e9, 4), null)
  assert.equal(titleBar.cleanMenuRequest(0, '10', 32, 4), null)
  assert.equal(titleBar.cleanMenuRequest(0, 10, 32, 0), null)
  assert.equal(titleBar.cleanMenuRequest(20, 10, 32, 40), null, 'en fazla MAX_MENUS bölüm')
})

test('menü etiketleri: alt menüsü olmayan öğe boş kalır, sıra korunur', () => {
  const menu = { items: [{ label: 'Telsiz', submenu: {} }, { label: 'Ayırıcı' }, { label: 'Yardım', submenu: {} }, { label: 5, submenu: {} }] }
  assert.deepEqual(titleBar.menuLabels(menu), ['Telsiz', '', 'Yardım', ''])
  assert.deepEqual(titleBar.menuLabels(null), [])
  const long = { items: [{ label: 'a'.repeat(100), submenu: {} }] }
  assert.equal(titleBar.menuLabels(long)[0].length, 60)
})
