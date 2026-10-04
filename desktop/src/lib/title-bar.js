'use strict'

// Uygulama penceresinin başlık çubuğu (Windows ve Linux). Pencere yerel başlık çubuğu ve menü çubuğu
// olmadan, Pencere Denetimleri Kaplamasıyla (titleBarOverlay) açılır: küçült, ekranı boyutla ve kapat
// düğmelerini işletim sistemi çizer, rengini sayfa temadan verir (public/js/30-pencere.js). Sayfa en üstte
// düğmeler kadar yükseklikte bir şerit çizer: solda uygulama menüleri, ortada pencere başlığı. Menü
// kısayolları (ör. Ctrl+Q, Ctrl+0) uygulama menüsü kayıtlı kaldığı için çalışmaya devam eder.
// macOS'ta yerel başlık çubuğu korunur.
// Sayfadan gelen değerler burada süzülür: renkler yalnızca #rrggbb biçiminde, menü isteği yalnızca var
// olan bir menü sırası ve pencere içindeki bir konumla kabul edilir.

const OVERLAY_HEIGHT = 32
// Sayfa rengini bildirene kadar varsayılan temanın (Arcade, koyu) zemini ve metni
const DEFAULT_COLORS = Object.freeze({ color: '#0f1015', symbolColor: '#f2f1f8' })
const COLOR_RE = /^#[0-9a-f]{6}$/
const MAX_COORD = 100000
const MAX_MENUS = 12

function supported (platform) {
  return platform === 'win32' || platform === 'linux'
}

// BrowserWindow seçeneklerine eklenecek alanlar. Desteklenmeyen sistemde boş nesne (yerel başlık çubuğu).
function windowOptions (platform, colors) {
  if (!supported(platform)) return {}
  const c = cleanColors(colors) || DEFAULT_COLORS
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: c.color, symbolColor: c.symbolColor, height: OVERLAY_HEIGHT }
  }
}

// { color, symbolColor } yalnızca ikisi de #rrggbb ise kabul edilir (küçük harfe çevrilir), değilse null
function cleanColors (value) {
  if (!value || typeof value !== 'object') return null
  const color = typeof value.color === 'string' ? value.color.toLowerCase() : ''
  const symbolColor = typeof value.symbolColor === 'string' ? value.symbolColor.toLowerCase() : ''
  if (!COLOR_RE.test(color) || !COLOR_RE.test(symbolColor)) return null
  return { color, symbolColor }
}

function sameColors (a, b) {
  return Boolean(a && b && a.color === b.color && a.symbolColor === b.symbolColor)
}

// Menü açma isteği: menü sırası 0 ile count - 1 arasında bir tam sayı, konum sayfanın CSS pikseli
// cinsinden pencere içinde (0 ile MAX_COORD arası) olmalıdır. Uymayan istek null döner.
function cleanMenuRequest (index, x, y, count) {
  const total = Number.isInteger(count) ? Math.min(count, MAX_MENUS) : 0
  if (!Number.isInteger(index) || index < 0 || index >= total) return null
  const okCoord = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_COORD
  if (!okCoord(x) || !okCoord(y)) return null
  return { index, x, y }
}

// Uygulama menüsünün üst düzey etiketleri (Telsiz, Düzen, Görünüm, Yardım). Alt menüsü olmayan öğe
// şeritte gösterilmez ama sırası korunur ki menü isteği doğru bölüme gitsin.
function menuLabels (menu) {
  const items = menu && Array.isArray(menu.items) ? menu.items.slice(0, MAX_MENUS) : []
  return items.map((item) => (item && item.submenu && typeof item.label === 'string' ? item.label.slice(0, 60) : ''))
}

module.exports = {
  OVERLAY_HEIGHT,
  DEFAULT_COLORS,
  MAX_MENUS,
  supported,
  windowOptions,
  cleanColors,
  sameColors,
  cleanMenuRequest,
  menuLabels
}
