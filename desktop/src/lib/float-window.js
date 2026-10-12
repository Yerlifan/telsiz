'use strict'

// Yüzen pencere (istek 7 ve 16): ses odasındayken uygulama penceresi simge durumuna küçültülür veya tepsiye
// gizlenirse kameralar ya da profil fotoğrafları her zaman üstte kalan küçük, çerçevesiz bir pencerede görünür
// (public/js/39-yuzen.js). Electron'a bağımlı değildir.
//
// Neden kendi penceremiz: Electron 44'te belge resim içinde resim (documentPictureInPicture) var görünür ama
// açtığı pencere görünmez (Electron 44.5.1 ile denendi). Sayfa bunun yerine window.open('about:blank', jeton)
// çağırır, ana süreç bu tek isteğe izin verir. Pencere açan sayfayla aynı kökendedir, içeriğini açan sayfanın
// betiği çizer ve kamera akışları aynı süreçte paylaşılır.
//
// Yeni pencere kuralının tek istisnası olduğu için açma isteği dar tutulur (src/main.js):
// - Jeton: sayfa telsiz:float-arm ile ana süreçten tek kullanımlık bir ad alır (telsiz-yuzen-<32 onaltılık>).
//   Ad yaklaşık 3 saniye geçerlidir, yalnızca bir kez kullanılır ve yeni bir jeton eskisini geçersiz kılar.
//   YouTube oynatıcısının çerçevesi kullanıcı hareketi olmadan da window.open çağırabilir, ama jetonu bilemez.
// - Yalnızca uygulama penceresinin isteği, yalnızca about:blank adresi ve doğru jeton kabul edilir. Pencere
//   açıldıktan sonra açanın uygulama penceresinin ana çerçevesi olduğu ayrıca denetlenir (did-create-window).
// - Pencerede ön yükleme betiği yoktur (preload: ''), bütün izinler, gezinmeler ve yeni pencereler reddedilir
//   (permissions.js deniedFor, navigation.js decideNavigation).
//
// Konum ve boyut ayarlar dosyasında floatBounds olarak saklanır (settings-store.js). Kayıtlı konum ekranın
// çalışma alanına sığmazsa pencere uygulama penceresinin ekranında sağ alt köşeye yerleşir.

const crypto = require('node:crypto')

const TOKEN_PREFIX = 'telsiz-yuzen-'
const TOKEN_RE = /^telsiz-yuzen-[0-9a-f]{32}$/
const TOKEN_TTL_MS = 3000
const MIN_WIDTH = 200
const MIN_HEIGHT = 120
const DEFAULT_WIDTH = 340
const DEFAULT_HEIGHT = 240
// Kayıtlı değerlerin akıl sınırı (piksel). Daha büyük ekran koordinatı veya boyut geçersiz sayılır.
const MAX_COORD = 100000
const MAX_SIZE = 10000
// Varsayılan konumda ekranın kenarından uzaklık
const MARGIN = 16

function isToken (value) {
  return typeof value === 'string' && TOKEN_RE.test(value)
}

// Tek kullanımlık jeton kapısı. opts.now (saat, ms) ve opts.random (bayt üreteci) testte verilir.
// arm(): yeni jeton üretir ve önceki jetonu geçersiz kılar. take(ad): ad geçerli jetonsa jetonu harcar ve
// true döner, değilse false (yanlış ad bekleyen jetonu harcamaz).
function createGate (opts) {
  const o = opts || {}
  const now = typeof o.now === 'function' ? o.now : () => Date.now()
  const random = typeof o.random === 'function' ? o.random : (n) => crypto.randomBytes(n)
  let pending = null
  return {
    arm () {
      const token = TOKEN_PREFIX + Buffer.from(random(16)).toString('hex')
      pending = { token, at: now() }
      return token
    },
    take (name) {
      if (!pending || !isToken(name)) return false
      if (now() - pending.at > TOKEN_TTL_MS) {
        pending = null
        return false
      }
      if (name !== pending.token) return false
      pending = null
      return true
    }
  }
}

// window.open isteği yüzen pencere isteği mi? req: { context (açan pencerenin bağlamı), fromMain (açan uygulama
// penceresi mi), url, frameName (window.open ikinci argümanı), open (yüzen pencere zaten açık mı) }. Bütün koşullar
// tutarsa jeton harcanır ve true döner. Koşullardan biri tutmazsa jetona dokunulmaz.
function isFloatRequest (req, gate) {
  const r = req || {}
  if (r.context !== 'app' || r.fromMain !== true || r.url !== 'about:blank' || r.open === true) return false
  return Boolean(gate && typeof gate.take === 'function' && gate.take(r.frameName))
}

// İki çerçeve (Electron WebFrameMain) aynı mı: aynı nesne ya da aynı süreç ve yönlendirme kimliği. Biri yoksa false.
function sameFrame (a, b) {
  if (!a || !b) return false
  if (a === b) return true
  return Number.isInteger(a.processId) && a.processId === b.processId && Number.isInteger(a.routingId) && a.routingId === b.routingId
}

function isInt (value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max
}

// Ayarlar dosyasındaki floatBounds: { x, y, width, height } tam sayılar, akıl sınırları içinde. Geçersizse null.
function validBounds (raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  if (!isInt(raw.x, -MAX_COORD, MAX_COORD) || !isInt(raw.y, -MAX_COORD, MAX_COORD)) return null
  if (!isInt(raw.width, MIN_WIDTH, MAX_SIZE) || !isInt(raw.height, MIN_HEIGHT, MAX_SIZE)) return null
  return { x: raw.x, y: raw.y, width: raw.width, height: raw.height }
}

function validArea (area) {
  if (!area || typeof area !== 'object') return null
  const nums = [area.x, area.y, area.width, area.height]
  if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  if (area.width <= 0 || area.height <= 0) return null
  return { x: Math.round(area.x), y: Math.round(area.y), width: Math.floor(area.width), height: Math.floor(area.height) }
}

function clamp (value, min, max) {
  return Math.max(min, Math.min(max, value))
}

// Pencerenin konumu ve boyutu. raw: kayıtlı floatBounds (veya null), workArea: uygulama penceresinin ekranının
// çalışma alanı. Kayıtlı pencere bu alanın içinde kalıyorsa boyutu alana sığdırılarak korunur. Yoksa veya alanın
// dışına düşüyorsa varsayılan boyutla sağ alt köşe seçilir. Sonuç her zaman tam sayıdır.
function cleanBounds (raw, workArea) {
  const area = validArea(workArea) || { x: 0, y: 0, width: DEFAULT_WIDTH + 2 * MARGIN, height: DEFAULT_HEIGHT + 2 * MARGIN }
  const maxW = Math.max(MIN_WIDTH, area.width)
  const maxH = Math.max(MIN_HEIGHT, area.height)
  const saved = validBounds(raw)
  if (saved) {
    const width = clamp(saved.width, MIN_WIDTH, maxW)
    const height = clamp(saved.height, MIN_HEIGHT, maxH)
    const inside = saved.x >= area.x && saved.y >= area.y && saved.x + saved.width <= area.x + area.width && saved.y + saved.height <= area.y + area.height
    if (inside) return { x: saved.x, y: saved.y, width, height }
  }
  const width = clamp(DEFAULT_WIDTH, MIN_WIDTH, maxW)
  const height = clamp(DEFAULT_HEIGHT, MIN_HEIGHT, maxH)
  return {
    x: Math.max(area.x, area.x + area.width - width - MARGIN),
    y: Math.max(area.y, area.y + area.height - height - MARGIN),
    width,
    height
  }
}

// window.open isteğine verilecek pencere seçenekleri (setWindowOpenHandler overrideBrowserWindowOptions).
// Pencere gizli açılır, ana süreç did-create-window içinde odak almadan gösterir (showInactive).
// webPreferences açan pencereden miras kalır (bağlam yalıtımı, korumalı alan, oturum bölümü), ön yükleme betiği
// boş verilerek kaldırılır: yüzen pencerede telsizDesktop API'si yoktur.
function options (bounds) {
  const b = validBounds(bounds)
  const out = {
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    resizable: true,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    webPreferences: { preload: '' }
  }
  if (b) Object.assign(out, b)
  return out
}

module.exports = {
  TOKEN_PREFIX,
  TOKEN_RE,
  TOKEN_TTL_MS,
  MIN_WIDTH,
  MIN_HEIGHT,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  isToken,
  createGate,
  isFloatRequest,
  sameFrame,
  validBounds,
  cleanBounds,
  options
}
