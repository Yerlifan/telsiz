'use strict'

// Uygulama simgelerinin üretimi (bağımlılık yok, yalnızca node:zlib).
// Kaynak Arcade logosudur (public/favicon.svg). Logo, desteklenen küçük bir SVG alt kümesiyle
// (svg, defs, linearGradient, stop, rect, circle) her boyutta vektörden yeniden çizilir, kenarlar
// çoklu örneklemeyle yumuşatılır. Desteklenmeyen bir öğe görülürse açık bir hatayla durulur.
//
// Üretilen dosyalar (desktop/build/, git dışında):
//   icon.ico                Windows uygulama ve kurucu simgesi (16, 24, 32, 48, 64, 128, 256)
//   icon.png                512 piksel
//   icons/<N>x<N>.png       Linux simge seti (16 ile 512 arası)
//   runtime/tray-<N>.png    sistem tepsisi simgesi (yalnızca logo, saydam zemin)
//   runtime/window-256.png  pencere simgesi
// Uygulama simgesi koyu, köşeleri yuvarlatılmış bir zemin üzerinde logodan oluşur. Zemin renkleri
// PWA simgesindeki (public/icons/icon-512.png) mor ve camgöbeği geçişini izler.
//
// Kullanım: node scripts/simge.js [çıktı klasörü]

const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
const TRAY_SIZES = [16, 24, 32, 48]
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const TILE_STOPS = [
  { offset: 0, color: [0x2b, 0x24, 0x52, 255] },
  { offset: 0.55, color: [0x13, 0x12, 0x1c, 255] },
  { offset: 1, color: [0x0f, 0x31, 0x38, 255] }
]
const TILE_MARGIN = 0.04
const TILE_RADIUS = 0.22
const LOGO_SCALE = 0.72

// 0..n-1 dizisi (noktalı virgülsüz döngüler için)
function range (n) {
  return Array.from({ length: n }, (_, i) => i)
}

// ------------------------------------------------------------------ PNG

const CRC_TABLE = range(256).map((n) => {
  let c = n
  range(8).forEach(() => {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  })
  return c >>> 0
})

function crc32 (buf) {
  let crc = 0xffffffff
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk (type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

// RGBA (8 bit) piksellerden PNG. Her satırda filtre 0 kullanılır.
function encodePng (width, height, rgba) {
  if (rgba.length !== width * height * 4) throw new Error('encodePng: pixel buffer size mismatch')
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  header[10] = 0
  header[11] = 0
  header[12] = 0
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (const y of range(height)) {
    raw[y * (stride + 1)] = 0
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride)
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function paeth (a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

// 8 bit, taramasız PNG çözücü (gri, gri ve saydamlık, RGB, RGBA). Sonuç: { width, height, data: RGBA }
function decodePng (buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('decodePng: not a PNG file')
  let offset = 8
  let header = null
  const idat = []
  while (offset + 8 <= buf.length) {
    const length = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    const data = buf.subarray(offset + 8, offset + 8 + length)
    if (offset + 12 + length > buf.length) throw new Error('decodePng: truncated chunk')
    const crc = buf.readUInt32BE(offset + 8 + length)
    if (crc32(buf.subarray(offset + 4, offset + 8 + length)) !== crc) throw new Error('decodePng: bad CRC in ' + type)
    if (type === 'IHDR') header = { width: data.readUInt32BE(0), height: data.readUInt32BE(4), depth: data[8], color: data[9], interlace: data[12] }
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  if (!header) throw new Error('decodePng: missing IHDR')
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.color]
  if (header.depth !== 8 || !channels || header.interlace !== 0) throw new Error('decodePng: only 8-bit non-interlaced gray, RGB and RGBA images are supported')
  const raw = zlib.inflateSync(Buffer.concat(idat))
  const stride = header.width * channels
  if (raw.length !== (stride + 1) * header.height) throw new Error('decodePng: unexpected data length')
  const pixels = Buffer.alloc(stride * header.height)
  for (const y of range(header.height)) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const out = y * stride
    for (const x of range(stride)) {
      const left = x >= channels ? pixels[out + x - channels] : 0
      const up = y > 0 ? pixels[out - stride + x] : 0
      const upLeft = y > 0 && x >= channels ? pixels[out - stride + x - channels] : 0
      let value = line[x]
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += (left + up) >> 1
      else if (filter === 4) value += paeth(left, up, upLeft)
      else if (filter !== 0) throw new Error('decodePng: unknown filter ' + filter)
      pixels[out + x] = value & 0xff
    }
  }
  const rgba = Buffer.alloc(header.width * header.height * 4)
  for (const i of range(header.width * header.height)) {
    const s = i * channels
    const d = i * 4
    if (channels === 1 || channels === 2) {
      rgba[d] = rgba[d + 1] = rgba[d + 2] = pixels[s]
      rgba[d + 3] = channels === 2 ? pixels[s + 1] : 255
    } else {
      rgba[d] = pixels[s]
      rgba[d + 1] = pixels[s + 1]
      rgba[d + 2] = pixels[s + 2]
      rgba[d + 3] = channels === 4 ? pixels[s + 3] : 255
    }
  }
  return { width: header.width, height: header.height, data: rgba }
}

// ------------------------------------------------------------------ SVG alt kümesi

const ALLOWED_TAGS = new Set(['svg', 'defs', 'linearGradient', 'stop', 'rect', 'circle'])

function parseColor (value) {
  const text = String(value || '').trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text)
  if (short) return [parseInt(short[1] + short[1], 16), parseInt(short[2] + short[2], 16), parseInt(short[3] + short[3], 16), 255]
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(text)
  if (long) return [parseInt(long[1], 16), parseInt(long[2], 16), parseInt(long[3], 16), 255]
  throw new Error('Unsupported SVG color: ' + text)
}

function attributes (text) {
  const out = {}
  for (const match of text.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*"([^"]*)"/g)) out[match[1]] = match[2]
  return out
}

function number (attrs, name, fallback) {
  if (attrs[name] === undefined) {
    if (fallback !== undefined) return fallback
    throw new Error('Missing SVG attribute: ' + name)
  }
  const value = Number(attrs[name])
  if (!Number.isFinite(value)) throw new Error('Invalid SVG number in ' + name)
  return value
}

// Logo SVG'sini çizim sahnesine çevirir: { viewBox: [x, y, w, h], shapes: [...] }
function parseLogoSvg (svgText) {
  const text = String(svgText).replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[\s\S]*?\?>/, '')
  const gradients = new Map()
  const shapes = []
  let viewBox = null
  let gradient = null
  for (const match of text.matchAll(/<(\/?)([A-Za-z][A-Za-z0-9]*)([^>]*?)(\/?)>/g)) {
    const closing = match[1] === '/'
    const tag = match[2]
    if (!ALLOWED_TAGS.has(tag)) throw new Error('Unsupported SVG element: ' + tag)
    if (closing) {
      if (tag === 'linearGradient') gradient = null
      continue
    }
    const attrs = attributes(match[3])
    if (tag === 'svg') {
      const parts = String(attrs.viewBox || '').trim().split(/[\s,]+/).map(Number)
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n)) || parts[2] <= 0 || parts[3] <= 0) throw new Error('The SVG needs a valid viewBox')
      viewBox = parts
    } else if (tag === 'linearGradient') {
      if (attrs.gradientUnits !== 'userSpaceOnUse' || !attrs.id) throw new Error('Only userSpaceOnUse linear gradients with an id are supported')
      gradient = { x1: number(attrs, 'x1'), y1: number(attrs, 'y1'), x2: number(attrs, 'x2'), y2: number(attrs, 'y2'), stops: [] }
      gradients.set(attrs.id, gradient)
      if (match[4] === '/') gradient = null
    } else if (tag === 'stop') {
      if (!gradient) throw new Error('A stop element must be inside a linear gradient')
      gradient.stops.push({ offset: number(attrs, 'offset'), color: parseColor(attrs['stop-color']) })
    } else if (tag === 'rect') {
      const rx = number(attrs, 'rx', 0)
      shapes.push({ type: 'rect', x: number(attrs, 'x', 0), y: number(attrs, 'y', 0), w: number(attrs, 'width'), h: number(attrs, 'height'), rx, ry: number(attrs, 'ry', rx), fill: attrs.fill })
    } else if (tag === 'circle') {
      shapes.push({ type: 'circle', cx: number(attrs, 'cx'), cy: number(attrs, 'cy'), r: number(attrs, 'r'), fill: attrs.fill })
    }
  }
  if (!viewBox) throw new Error('The SVG has no svg element')
  if (shapes.length === 0) throw new Error('The SVG has no shapes')
  for (const shape of shapes) {
    const ref = /^url\(#([^)]+)\)$/.exec(String(shape.fill || ''))
    if (ref) {
      const found = gradients.get(ref[1])
      if (!found || found.stops.length === 0) throw new Error('Unknown SVG gradient: ' + ref[1])
      shape.paint = { type: 'gradient', gradient: found }
    } else {
      shape.paint = { type: 'solid', color: parseColor(shape.fill) }
    }
  }
  return { viewBox, shapes }
}

// ------------------------------------------------------------------ çizim

function insideRoundRect (px, py, x, y, w, h, rx, ry) {
  if (px < x || py < y || px > x + w || py > y + h) return false
  const rX = Math.min(Math.max(rx, 0), w / 2)
  const rY = Math.min(Math.max(ry, 0), h / 2)
  if (rX === 0 || rY === 0) return true
  const cx = px < x + rX ? x + rX : px > x + w - rX ? x + w - rX : px
  const cy = py < y + rY ? y + rY : py > y + h - rY ? y + h - rY : py
  const dx = (px - cx) / rX
  const dy = (py - cy) / rY
  return dx * dx + dy * dy <= 1
}

function inside (shape, px, py) {
  if (shape.type === 'rect') return insideRoundRect(px, py, shape.x, shape.y, shape.w, shape.h, shape.rx, shape.ry)
  const dx = px - shape.cx
  const dy = py - shape.cy
  return dx * dx + dy * dy <= shape.r * shape.r
}

function gradientColor (gradient, px, py) {
  const vx = gradient.x2 - gradient.x1
  const vy = gradient.y2 - gradient.y1
  const len = vx * vx + vy * vy
  let t = len === 0 ? 0 : ((px - gradient.x1) * vx + (py - gradient.y1) * vy) / len
  t = Math.min(Math.max(t, 0), 1)
  const stops = gradient.stops
  if (t <= stops[0].offset) return stops[0].color
  const last = stops[stops.length - 1]
  if (t >= last.offset) return last.color
  const index = stops.findIndex((stop) => stop.offset >= t)
  const a = stops[index - 1]
  const b = stops[index]
  const f = b.offset === a.offset ? 0 : (t - a.offset) / (b.offset - a.offset)
  return [0, 1, 2, 3].map((i) => a.color[i] + (b.color[i] - a.color[i]) * f)
}

function paintColor (paint, px, py) {
  return paint.type === 'solid' ? paint.color : gradientColor(paint.gradient, px, py)
}

const TO_LINEAR = range(256).map((v) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
})

function toSrgb (linear) {
  const c = linear <= 0.0031308 ? linear * 12.92 : 1.055 * Math.pow(linear, 1 / 2.4) - 0.055
  return Math.round(Math.min(Math.max(c, 0), 1) * 255)
}

// Bir örnek noktasının rengi (sRGB 0-255 ve opaklık) veya null (saydam)
function sceneSample (scene, layout, px, py) {
  let color = null
  if (layout.tile) {
    const t = layout.tile
    if (insideRoundRect(px, py, t.x, t.y, t.size, t.size, t.radius, t.radius)) {
      color = gradientColor({ x1: t.x, y1: t.y, x2: t.x + t.size, y2: t.y + t.size, stops: TILE_STOPS }, px, py)
    }
  }
  const lx = layout.logo.x0 + (px - layout.logo.ox) / layout.logo.scale
  const ly = layout.logo.y0 + (py - layout.logo.oy) / layout.logo.scale
  for (const shape of scene.shapes) {
    if (inside(shape, lx, ly)) color = paintColor(shape.paint, lx, ly)
  }
  return color
}

// Sahneyi size x size piksel RGBA olarak çizer. options.tile: koyu zemin çiz
function rasterize (scene, size, options) {
  const opts = options || {}
  const samples = opts.samples || (size <= 64 ? 8 : 4)
  const [vx, vy, vw, vh] = scene.viewBox
  const layout = { tile: null, logo: null }
  if (opts.tile) {
    const margin = size * TILE_MARGIN
    const tileSize = size - 2 * margin
    layout.tile = { x: margin, y: margin, size: tileSize, radius: tileSize * TILE_RADIUS }
    const box = tileSize * LOGO_SCALE
    const scale = Math.min(box / vw, box / vh)
    layout.logo = { scale, ox: (size - vw * scale) / 2, oy: (size - vh * scale) / 2, x0: vx, y0: vy }
  } else {
    const scale = Math.min(size / vw, size / vh)
    layout.logo = { scale, ox: (size - vw * scale) / 2, oy: (size - vh * scale) / 2, x0: vx, y0: vy }
  }
  const out = Buffer.alloc(size * size * 4)
  const total = samples * samples
  for (const y of range(size)) {
    for (const x of range(size)) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (const sy of range(samples)) {
        for (const sx of range(samples)) {
          const color = sceneSample(scene, layout, x + (sx + 0.5) / samples, y + (sy + 0.5) / samples)
          if (!color) continue
          const alpha = color[3] / 255
          r += TO_LINEAR[Math.round(color[0])] * alpha
          g += TO_LINEAR[Math.round(color[1])] * alpha
          b += TO_LINEAR[Math.round(color[2])] * alpha
          a += alpha
        }
      }
      const i = (y * size + x) * 4
      if (a > 0) {
        out[i] = toSrgb(r / a)
        out[i + 1] = toSrgb(g / a)
        out[i + 2] = toSrgb(b / a)
        out[i + 3] = Math.round((a / total) * 255)
      }
    }
  }
  return out
}

// ------------------------------------------------------------------ ICO

// 32 bit BMP (DIB) girdisi: BITMAPINFOHEADER, alttan üste BGRA satırları ve 1 bitlik AND maskesi
function bmpEntry (size, rgba) {
  const header = Buffer.alloc(40)
  const maskStride = Math.ceil(size / 32) * 4
  const pixels = Buffer.alloc(size * size * 4)
  const mask = Buffer.alloc(maskStride * size)
  for (const y of range(size)) {
    const row = size - 1 - y
    for (const x of range(size)) {
      const s = (y * size + x) * 4
      const d = (row * size + x) * 4
      pixels[d] = rgba[s + 2]
      pixels[d + 1] = rgba[s + 1]
      pixels[d + 2] = rgba[s]
      pixels[d + 3] = rgba[s + 3]
      if (rgba[s + 3] === 0) mask[row * maskStride + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  header.writeUInt32LE(40, 0)
  header.writeInt32LE(size, 4)
  header.writeInt32LE(size * 2, 8)
  header.writeUInt16LE(1, 12)
  header.writeUInt16LE(32, 14)
  header.writeUInt32LE(0, 16)
  header.writeUInt32LE(pixels.length + mask.length, 20)
  return Buffer.concat([header, pixels, mask])
}

// images: [{ size, rgba, png }]. 256 piksel PNG olarak, küçükler BMP olarak gömülür.
function encodeIco (images) {
  const sorted = images.slice().sort((a, b) => a.size - b.size)
  const entries = sorted.map((image) => (image.size >= 256 ? image.png : bmpEntry(image.size, image.rgba)))
  const dir = Buffer.alloc(6 + 16 * sorted.length)
  dir.writeUInt16LE(0, 0)
  dir.writeUInt16LE(1, 2)
  dir.writeUInt16LE(sorted.length, 4)
  let offset = dir.length
  sorted.forEach((image, i) => {
    const at = 6 + i * 16
    dir[at] = image.size >= 256 ? 0 : image.size
    dir[at + 1] = image.size >= 256 ? 0 : image.size
    dir[at + 2] = 0
    dir[at + 3] = 0
    dir.writeUInt16LE(1, at + 4)
    dir.writeUInt16LE(32, at + 6)
    dir.writeUInt32LE(entries[i].length, at + 8)
    dir.writeUInt32LE(offset, at + 12)
    offset += entries[i].length
  })
  return Buffer.concat([dir].concat(entries))
}

// ICO başlığını okur (testler ve doğrulama için): [{ width, height, bytes, offset, png }]
function readIcoDirectory (buf) {
  if (buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('Not an ICO file')
  const count = buf.readUInt16LE(4)
  return range(count).map((i) => {
    const at = 6 + i * 16
    const bytes = buf.readUInt32LE(at + 8)
    const offset = buf.readUInt32LE(at + 12)
    return {
      width: buf[at] || 256,
      height: buf[at + 1] || 256,
      bytes,
      offset,
      png: buf.subarray(offset, offset + 8).equals(PNG_SIGNATURE)
    }
  })
}

// ------------------------------------------------------------------ üretim

function writeFile (file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, data)
}

// svgText: logo SVG metni, outDir: desktop/build. Üretilen dosyaların göreli yollarını döndürür.
function generateIcons (svgText, outDir) {
  const scene = parseLogoSvg(svgText)
  const written = []
  const save = (rel, data) => {
    writeFile(path.join(outDir, ...rel.split('/')), data)
    written.push(rel)
  }
  const tiles = new Map()
  for (const size of Array.from(new Set(ICO_SIZES.concat(LINUX_SIZES)))) {
    const rgba = rasterize(scene, size, { tile: true })
    tiles.set(size, { size, rgba, png: encodePng(size, size, rgba) })
  }
  save('icon.ico', encodeIco(ICO_SIZES.map((size) => tiles.get(size))))
  save('icon.png', tiles.get(512).png)
  for (const size of LINUX_SIZES) save('icons/' + size + 'x' + size + '.png', tiles.get(size).png)
  for (const size of TRAY_SIZES) save('runtime/tray-' + size + '.png', encodePng(size, size, rasterize(scene, size, { tile: false })))
  save('runtime/window-256.png', tiles.get(256).png)
  return written
}

function main (argv) {
  const desktopDir = path.join(__dirname, '..')
  const outDir = argv[2] ? path.resolve(argv[2]) : path.join(desktopDir, 'build')
  const svgPath = path.join(desktopDir, '..', 'public', 'favicon.svg')
  const written = generateIcons(fs.readFileSync(svgPath, 'utf8'), outDir)
  console.log('Simgeler üretildi (' + written.length + ' dosya): ' + outDir)
  return 0
}

if (require.main === module) process.exitCode = main(process.argv)

module.exports = {
  ICO_SIZES,
  LINUX_SIZES,
  TRAY_SIZES,
  crc32,
  encodePng,
  decodePng,
  parseLogoSvg,
  rasterize,
  encodeIco,
  readIcoDirectory,
  generateIcons
}
