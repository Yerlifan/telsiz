'use strict'

// Stil ve güvenlik denetleyicisi. Projenin yazım kurallarını otomatik olarak denetler.
// Kullanım: node scripts/denetle.js [klasör]
// Klasör verilmezse depo kökü denetlenir. Her ihlal "dosya:satır: açıklama" biçiminde
// yazılır. İhlal varsa çıkış kodu 1, kullanım veya ortam hatasında 2 olur.
// JavaScript denetimleri acorn ile üretilen sözdizimi ağacı ve token listesi üzerinde
// yapılır, bu yüzden yorumlar ve dizeler içindeki geçişler ihlal sayılmaz.
// Dosyaya özgü kurallar dosya dosya, i18n ve belge eşliği kuralları ise tüm dosyalar
// okunduktan sonra proje düzeyinde çalışır.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const NACL_PATH = 'public/vendor/nacl-fast.min.js'
const NACL_SHA256 = '3ec535c004aeeb225785d8e93fb33bf99f52e399bd7dfc01969b5629baea5131'
const SCRYPT_PATH = 'public/vendor/scrypt.js'
const SCRYPT_SHA256 = '544292934136527d60acc9e337d8c7b953f412e81314aa551a12d4230afd449d'

// Üçüncü taraf dosyalar birebir kopyadır. Zorunlu olmayanlar yalnızca varsa denetlenir.
const VENDOR_FILES = [
  { path: NACL_PATH, sha256: NACL_SHA256, name: 'TweetNaCl-js 1.0.3', required: true },
  { path: SCRYPT_PATH, sha256: SCRYPT_SHA256, name: 'scrypt-js 3.0.1', required: false }
]

const VENDOR_DIR = 'public/vendor/'
const SKIP_DIRS = new Set(['.git', 'node_modules'])
const JS_EXTS = new Set(['.js', '.cjs', '.mjs'])
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.pdf', '.zip', '.gz', '.tgz',
  '.mp3', '.ogg', '.wav', '.mp4', '.webm'
])
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title'])

// Listeleme ile okuma arasında silinen veya yeri değişen dosyalarda görülen hata kodları
const VANISHED_CODES = new Set(['ENOENT', 'ENOTDIR', 'EISDIR', 'ELOOP'])

const RULE_LABELS = {
  dash: 'uzun veya kısa tire',
  invisible: 'görünmez karakter',
  semicolon: 'noktalı virgül',
  syntax: 'sözdizimi',
  lineStart: 'satır başı',
  banned: 'yasak kullanım',
  vendor: 'üçüncü taraf dosya',
  bom: 'BOM',
  eol: 'satır sonu',
  prose: 'düzyazıda noktalı virgül',
  html: 'satır içi betik veya stil',
  'i18n-parity': 'i18n sözlük eşliği',
  'i18n-hardcoded': 'i18n dışı sabit metin',
  'i18n-keys': 'i18n anahtarı',
  'doc-parity': 'belge eşliği'
}

const DASH_NAMES = {
  '\u2014': 'U+2014 (uzun tire)',
  '\u2013': 'U+2013 (kısa tire)'
}

// Görünmez veya metnin yönünü değiştiren karakterler. Kodun ve metnin göründüğünden
// farklı okunmasına (Trojan Source, CVE-2021-42574) veya fark edilmeyen hatalara yol açar.
// Yalnızca matchAll ve search ile kullanılır, bu ikisi lastIndex durumunu değiştirmez.
const INVISIBLE_PATTERN = /[\u00a0\u200b-\u200f\u202a-\u202e\u2066-\u2069\u2028\u2029\ufeff]/g

const HTML_SINK = 'HTML dizesiyle DOM üretmek yasaktır, createElement ve textContent kullanın.'
const CODE_FROM_STRING = 'Dizeden kod çalıştırmak yasaktır.'

// İstemci kodunda tanımlayıcı, üye adı veya nesne anahtarı olarak hiçbir konumda geçmemesi gereken adlar
const BANNED_NAMES = {
  innerHTML: HTML_SINK,
  outerHTML: HTML_SINK,
  insertAdjacentHTML: HTML_SINK,
  eval: CODE_FROM_STRING,
  structuredClone: 'İstemci kodu ES2017 ile sınırlıdır.',
  fetch: 'İstemcide XMLHttpRequest kullanılır, fetch yalnızca sw.js içinde serbesttir.'
}

// i18n: sözlük dosyaları, diller ve kurallar
const CLIENT_I18N_FILES = ['public/i18n.js', 'public/js/i18n.js']
const SERVER_I18N_FILE = 'src/i18n.js'
const LANGS = ['tr', 'en']
const TURKISH_LETTERS = /[çğıİöşüÇĞÖŞÜ]/
const PARAM_PATTERN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g
const MAX_DICTIONARY_DEPTH = 8

// Türkçe ve İngilizce eş belgeler. Biri varsa diğeri de bulunur ve "## " başlık sayıları eşittir.
const DOC_PAIRS = [
  ['README.md', 'README.en.md'],
  ['CONTRIBUTING.md', 'CONTRIBUTING.en.md'],
  ['docs/MIMARI.md', 'docs/ARCHITECTURE.md'],
  ['docs/KURULUM.md', 'docs/DEPLOYMENT.md'],
  ['docs/TASARIM.md', 'docs/DESIGN.md']
]

function hasOwn (object, key) {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function loadAcorn () {
  try {
    return require('acorn')
  } catch (err) {
    return null
  }
}

// Dosya listesi

function samePath (a, b) {
  const normalize = (p) => {
    let real = path.resolve(p)
    try {
      real = fs.realpathSync.native(real)
    } catch (err) {
      // Çözülemeyen yol olduğu gibi karşılaştırılır
    }
    return process.platform === 'win32' ? real.toLowerCase() : real
  }
  return normalize(a) === normalize(b)
}

function isFile (abs) {
  try {
    const stat = fs.statSync(abs, { throwIfNoEntry: false })
    return Boolean(stat && stat.isFile())
  } catch (err) {
    return false
  }
}

// Dosya yoksa (git'te izlenip çalışma ağacından silinmişse veya tarama sırasında
// silindiyse) null döner, diğer okuma hataları denetimi durdurur
function readIfFile (abs) {
  try {
    return fs.readFileSync(abs)
  } catch (err) {
    if (err && VANISHED_CODES.has(err.code)) return null
    throw err
  }
}

// Git deposunun kökündeysek izlenen dosyalar ile .gitignore dışında kalan yeni dosyalar
function listGitFiles (root) {
  const options = { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true }
  const top = spawnSync('git', ['rev-parse', '--show-toplevel'], options)
  if (top.error || top.status !== 0 || !samePath(top.stdout.trim(), root)) return null
  const listed = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], options)
  if (listed.error || listed.status !== 0) return null
  const files = new Set()
  for (const file of listed.stdout.split('\0')) {
    if (file && isFile(path.join(root, file))) files.add(file)
  }
  return Array.from(files)
}

function escapeRegex (text) {
  return text.replace(/[.+^${}()|[\]\\]/g, '\\$&')
}

function globToRegex (glob) {
  const source = glob.split('**').map((part) => {
    return part.split('*').map((piece) => piece.split('?').map(escapeRegex).join('[^/]')).join('[^/]*')
  }).join('.*')
  return new RegExp('^' + source + '$')
}

// Klasör taramasında kullanılan basit .gitignore okuyucusu (olumsuzlama desteklenmez)
function readIgnoreRules (root) {
  let text = ''
  try {
    text = fs.readFileSync(path.join(root, '.gitignore'), 'utf8')
  } catch (err) {
    return []
  }
  const rules = []
  for (const raw of text.split(/\r\n|\r|\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('!')) continue
    const dirOnly = line.endsWith('/')
    let pattern = dirOnly ? line.slice(0, -1) : line
    const anchored = pattern.includes('/')
    if (pattern.startsWith('/')) pattern = pattern.slice(1)
    if (pattern) rules.push({ regex: globToRegex(pattern), dirOnly, anchored })
  }
  return rules
}

function isIgnored (rel, isDir, rules) {
  const base = rel.slice(rel.lastIndexOf('/') + 1)
  return rules.some((rule) => {
    if (rule.dirOnly && !isDir) return false
    return rule.regex.test(rule.anchored ? rel : base)
  })
}

function readDirIfExists (abs) {
  try {
    return fs.readdirSync(abs, { withFileTypes: true })
  } catch (err) {
    if (err && VANISHED_CODES.has(err.code)) return []
    throw err
  }
}

function walkFiles (root) {
  const rules = readIgnoreRules(root)
  const files = []
  const stack = ['']
  while (stack.length > 0) {
    const rel = stack.pop()
    for (const entry of readDirIfExists(path.join(root, rel))) {
      const child = rel ? rel + '/' + entry.name : entry.name
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !isIgnored(child, true, rules)) stack.push(child)
      } else if (entry.isFile() && !isIgnored(child, false, rules)) {
        files.push(child)
      }
    }
  }
  return files
}

function isScannable (rel) {
  return !rel.startsWith(VENDOR_DIR) && !rel.split('/').some((part) => SKIP_DIRS.has(part))
}

function listFiles (root) {
  return (listGitFiles(root) || walkFiles(root)).filter(isScannable).sort()
}

function isBinary (rel, buf) {
  if (BINARY_EXTS.has(path.extname(rel).toLowerCase())) return true
  return buf.subarray(0, 8000).includes(0)
}

// public/ altındaki her betik tarayıcıda çalışır: public/*.js, public/js/*.js,
// theme-init.js, i18n.js ve sw.js dahil. public/vendor/ listeye hiç girmez.
function isClientScript (rel) {
  return rel.startsWith('public/')
}

// Proje düzeyindeki kurallar için sözdizimi ağacı saklanan dosyalar
function keepsAst (rel) {
  return isClientScript(rel) || rel.startsWith('src/') || rel === 'server.js'
}

// Satır yardımcıları

function lineStarts (text) {
  const starts = [0]
  for (const match of text.matchAll(/\r\n|\r|\n/g)) starts.push(match.index + match[0].length)
  return starts
}

function lineAt (starts, offset) {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (starts[mid] <= offset) low = mid
    else high = mid - 1
  }
  return low + 1
}

function snippet (text) {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 40 ? flat.slice(0, 40) + '...' : flat
}

// Kural 1: uzun ve kısa tire

function checkDashes (ctx) {
  if (!/[\u2013\u2014]/.test(ctx.text)) return
  const starts = lineStarts(ctx.text)
  for (const match of ctx.text.matchAll(/[\u2013\u2014]/g)) {
    ctx.report(lineAt(starts, match.index), 'dash', DASH_NAMES[match[0]] + ' karakteri var. Yerine normal tire (-), virgül veya iki nokta kullanın.')
  }
}

// Görünmez ve biçim karakterleri (tüm metin dosyaları, dosya başındaki BOM dahil)

function invisibleName (ch) {
  const code = ch.charCodeAt(0)
  let label = 'görünmez karakter'
  if (code === 0xa0) label = 'bölünmez boşluk'
  else if (code >= 0x200b && code <= 0x200d) label = 'sıfır genişlikli karakter'
  else if (code === 0x200e || code === 0x200f) label = 'yön işareti'
  else if (code >= 0x202a && code <= 0x202e) label = 'yön gömme veya geçersiz kılma'
  else if (code >= 0x2066 && code <= 0x2069) label = 'yön yalıtımı'
  else if (code === 0x2028) label = 'satır ayırıcı'
  else if (code === 0x2029) label = 'paragraf ayırıcı'
  else if (code === 0xfeff) label = 'BOM veya sıfır genişlikli bölünmez boşluk'
  return 'U+' + code.toString(16).toUpperCase().padStart(4, '0') + ' (' + label + ')'
}

function checkInvisible (ctx) {
  if (ctx.text.search(INVISIBLE_PATTERN) === -1) return
  const starts = lineStarts(ctx.text)
  const byLine = new Map()
  for (const match of ctx.text.matchAll(INVISIBLE_PATTERN)) {
    // Windows betiğinin başındaki BOM ayrıca "bom" kuralıyla bildirilir
    if (match.index === 0 && match[0] === '\ufeff' && ctx.ext === '.bat') continue
    const line = lineAt(starts, match.index)
    if (!byLine.has(line)) byLine.set(line, [])
    byLine.get(line).push(invisibleName(match[0]) + ' sütun ' + (match.index - starts[line - 1] + 1))
  }
  for (const entry of byLine) {
    ctx.report(entry[0], 'invisible', 'görünmez veya biçim karakteri var: ' + entry[1].join(', ') + '. Bu karakterler metni göründüğünden farklı okutabilir. Silin, kodda gerekiyorsa \\u kaçışıyla yazın.')
  }
}

// Kural 2 ve 3: JavaScript

function parseAttempts (rel, client) {
  if (client) return [{ ecmaVersion: 2017, sourceType: 'script' }]
  if (rel.endsWith('.mjs')) return [{ ecmaVersion: 'latest', sourceType: 'module' }]
  return [
    { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true, allowHashBang: true },
    { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true }
  ]
}

function parseJs (acorn, ctx, client) {
  // Birden çok deneme varsa (betik, sonra modül) en ileri gidebilen denemenin hatası bildirilir
  let bestError = null
  for (const attempt of parseAttempts(ctx.rel, client)) {
    const tokens = []
    try {
      const ast = acorn.parse(ctx.text, Object.assign({ locations: true, onToken: tokens }, attempt))
      return { ast, tokens }
    } catch (err) {
      if (!bestError || (err.pos || 0) > (bestError.pos || 0)) bestError = err
    }
  }
  const loc = bestError.loc || { line: 1, column: 0 }
  const detail = String(bestError.message).replace(/\s*\(\d+:\d+\)$/, '')
  const hint = client ? ' İstemci kodu en fazla ES2017 sözdizimi kullanabilir.' : ''
  ctx.report(loc.line, 'syntax', 'JavaScript ayrıştırılamadı: ' + detail + ' (sütun ' + (loc.column + 1) + ').' + hint)
  return null
}

// Sözdizimi ağacını özyineleme olmadan gezer, her düğüm için ziyaretçiyi ebeveyniyle çağırır
function walk (root, visit) {
  const stack = [{ node: root, parent: null }]
  while (stack.length > 0) {
    const item = stack.pop()
    visit(item.node, item.parent)
    for (const key of Object.keys(item.node)) {
      if (key === 'loc' || key === 'type') continue
      const value = item.node[key]
      if (Array.isArray(value)) {
        for (const child of value) {
          if (child && typeof child.type === 'string') stack.push({ node: child, parent: item.node })
        }
      } else if (value && typeof value.type === 'string') {
        stack.push({ node: value, parent: item.node })
      }
    }
  }
}

function firstTokenIndex (tokens, offset) {
  let low = 0
  let high = tokens.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (tokens[mid].start < offset) low = mid + 1
    else high = mid
  }
  return low
}

function memberName (member) {
  if (!member.computed) return member.property.type === 'Identifier' ? member.property.name : null
  return stringValue(member.property)
}

function stringValue (node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked
  return null
}

function objectName (node) {
  if (node.type === 'Identifier') return node.name
  if (node.type === 'MemberExpression') return memberName(node)
  return null
}

function checkSemicolons (acorn, ctx, tokens) {
  const lines = new Map()
  for (const token of tokens) {
    if (token.type !== acorn.tokTypes.semi) continue
    const line = token.loc.start.line
    if (!lines.has(line)) lines.set(line, [])
    lines.get(line).push(token.loc.start.column + 1)
  }
  for (const entry of lines) {
    ctx.report(entry[0], 'semicolon', 'noktalı virgül (;) kullanılmış (sütun ' + entry[1].join(', ') + '). JavaScript dosyaları noktalı virgülsüz yazılır.')
  }
}

// Noktalı virgülsüz yazımda satırın "(", "[" veya "`" ile başlaması önceki satırla birleşme tehlikesidir
function checkLineStarts (acorn, ctx, ast, tokens) {
  const startsLine = (offset) => {
    const lineBegin = ctx.text.lastIndexOf('\n', offset - 1) + 1
    return /^[ \t\ufeff]*$/.test(ctx.text.slice(lineBegin, offset))
  }
  const continuation = (afterOffset, type, symbol) => {
    let index = firstTokenIndex(tokens, afterOffset)
    while (index < tokens.length && tokens[index].type !== type) index++
    if (index === 0 || index >= tokens.length) return
    const open = tokens[index]
    if (tokens[index - 1].loc.end.line < open.loc.start.line) {
      ctx.report(open.loc.start.line, 'lineStart', 'satır "' + symbol + '" ile başlıyor ve önceki satırdaki ifadeye bağlanıyor. Noktalı virgülsüz yazımda bu iki satır tek ifade olarak çalışır.')
    }
  }
  walk(ast, (node) => {
    if (node.type === 'ExpressionStatement') {
      const first = ctx.text[node.start]
      if ((first === '(' || first === '[' || first === '`') && startsLine(node.start)) {
        ctx.report(node.loc.start.line, 'lineStart', 'satır "' + first + '" ile başlıyor. Noktalı virgülsüz yazımda bu satır önceki satırla birleşebilir, ifadeyi bir değişkene atayın veya yeniden düzenleyin.')
      }
    } else if (node.type === 'CallExpression') {
      continuation(node.callee.end, acorn.tokTypes.parenL, '(')
    } else if (node.type === 'MemberExpression' && node.computed) {
      continuation(node.object.end, acorn.tokTypes.bracketL, '[')
    } else if (node.type === 'TaggedTemplateExpression') {
      continuation(node.tag.end, acorn.tokTypes.backQuote, '`')
    }
  })
}

function checkClientUsage (ctx, ast) {
  const isServiceWorker = ctx.rel === 'public/sw.js'
  const banned = (line, name, reason) => ctx.report(line, 'banned', '"' + name + '" kullanılmış. ' + reason)
  const checkName = (name, node) => {
    if (typeof name !== 'string' || !hasOwn(BANNED_NAMES, name)) return
    if (name === 'fetch' && isServiceWorker) return
    banned(node.loc.start.line, name, BANNED_NAMES[name])
  }
  walk(ast, (node) => {
    const line = node.loc.start.line
    if (node.type === 'Identifier') {
      checkName(node.name, node)
    } else if (node.type === 'MemberExpression') {
      const name = memberName(node)
      if (node.computed) checkName(name, node)
      if (name === 'replaceAll') banned(line, '.replaceAll', 'İstemci kodu ES2017 ile sınırlıdır, g bayraklı düzenli ifadeyle replace kullanın.')
      if (name === 'hasOwn' && objectName(node.object) === 'Object') banned(line, 'Object.hasOwn', 'İstemci kodu ES2017 ile sınırlıdır, Object.prototype.hasOwnProperty.call kullanın.')
      if ((name === 'write' || name === 'writeln') && objectName(node.object) === 'document') banned(line, 'document.' + name, HTML_SINK)
    } else if (node.type === 'Property' && node.key.type === 'Literal') {
      checkName(node.key.value, node.key)
    } else if (node.type === 'CallExpression' || node.type === 'NewExpression') {
      const callee = node.callee
      if (objectName(callee) === 'Function') banned(line, 'Function', CODE_FROM_STRING)
      if (node.type === 'CallExpression' && callee.type === 'MemberExpression' && memberName(callee) === 'at') {
        banned(line, '.at()', 'İstemci kodu ES2017 ile sınırlıdır, köşeli parantezle dizin kullanın.')
      }
    } else if (node.type === 'Literal' && node.regex && /\\[pP]\{/.test(node.regex.pattern)) {
      banned(line, '\\p{...}', 'Unicode özellik kaçışı ES2017 düzenli ifadelerinde yoktur.')
    }
  })
}

function checkJs (acorn, ctx) {
  const client = isClientScript(ctx.rel)
  const parsed = parseJs(acorn, ctx, client)
  if (!parsed) return null
  checkSemicolons(acorn, ctx, parsed.tokens)
  checkLineStarts(acorn, ctx, parsed.ast, parsed.tokens)
  if (client) checkClientUsage(ctx, parsed.ast)
  return parsed
}

// Kural 5 ve 6: Windows betikleri

function checkBat (ctx) {
  const buf = ctx.buf
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    ctx.report(1, 'bom', 'UTF-8 BOM (imza) var. Windows betikleri BOM olmadan kaydedilmelidir.')
  }
  let bad = 0
  let firstBad = 0
  let line = 1
  for (const match of ctx.text.matchAll(/\r\n|\r|\n/g)) {
    if (match[0] !== '\r\n') {
      bad++
      if (firstBad === 0) firstBad = line
    }
    line++
  }
  if (bad > 0) {
    ctx.report(firstBad, 'eol', bad + ' satırda satır sonu CRLF değil. Windows betikleri CRLF satır sonuyla saklanmalıdır.')
  }
  ctx.text.split(/\r\n|\r|\n/).forEach((content, index) => {
    if (content.includes(';')) ctx.report(index + 1, 'prose', 'noktalı virgül (;) var. Windows betiklerinde noktalı virgül kullanılmaz.')
  })
}

// Kural 6: Markdown düzyazısı (kod blokları ve satır içi kod hariç)

// Markdown satırlarını gezer. Tür: 'text' düzyazı, 'fence' kod bloğu açılışı, 'code' blok içi veya kapanışı.
function eachMarkdownLine (text, visit) {
  let fence = null
  text.split(/\r\n|\r|\n/).forEach((content, index) => {
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(content)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null
      visit(content, index, 'code')
      return
    }
    const open = /^\s*(`{3,}|~{3,})/.exec(content)
    if (open) {
      fence = open[1]
      visit(content, index, 'fence')
      return
    }
    visit(content, index, 'text')
  })
}

function findBacktickRun (text, from, length) {
  let index = text.indexOf('`', from)
  while (index !== -1) {
    let run = 1
    while (text[index + run] === '`') run++
    if (run === length) return index
    index = text.indexOf('`', index + run)
  }
  return -1
}

function codeSpanRanges (text) {
  const ranges = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\\') {
      i += 2
    } else if (ch === '`') {
      let run = 1
      while (text[i + run] === '`') run++
      const close = findBacktickRun(text, i + run, run)
      if (close === -1) {
        i += run
      } else {
        ranges.push({ start: i, end: close + run })
        i = close + run
      }
    } else {
      i++
    }
  }
  return ranges
}

function checkParagraph (ctx, block) {
  const text = block.map((item) => item.text).join('\n')
  if (!text.includes(';')) return
  const ranges = codeSpanRanges(text)
  const offsets = []
  let position = 0
  for (const item of block) {
    offsets.push(position)
    position += item.text.length + 1
  }
  let index = text.indexOf(';')
  while (index !== -1) {
    const at = index
    if (!ranges.some((range) => at >= range.start && at < range.end)) {
      const line = block[lineAt(offsets, at) - 1].line
      ctx.report(line, 'prose', 'düzyazıda noktalı virgül (;) var. Cümleyi bölün veya virgül kullanın. Kod örnekleri kod bloğuna veya satır içi koda yazılır.')
    }
    index = text.indexOf(';', index + 1)
  }
}

function checkMarkdown (ctx) {
  let block = []
  const flush = () => {
    if (block.length > 0) checkParagraph(ctx, block)
    block = []
  }
  eachMarkdownLine(ctx.text, (content, index, kind) => {
    if (kind !== 'text' || content.trim() === '') flush()
    else block.push({ line: index + 1, text: content })
  })
  flush()
}

// Kural 7: HTML içinde satır içi betik, stil ve olay öznitelikleri

function parseAttributes (text, start) {
  const attrs = []
  let i = start
  while (i < text.length) {
    const ch = text[i]
    if (ch === '>') return { attrs, end: i + 1 }
    if (/[\s/]/.test(ch)) {
      i++
      continue
    }
    const nameStart = i
    while (i < text.length && !/[\s/>=]/.test(text[i])) i++
    const name = text.slice(nameStart, i)
    let value = null
    while (i < text.length && /\s/.test(text[i])) i++
    if (text[i] === '=') {
      i++
      while (i < text.length && /\s/.test(text[i])) i++
      const quote = text[i]
      if (quote === '"' || quote === '\'') {
        const close = text.indexOf(quote, i + 1)
        const end = close === -1 ? text.length : close
        value = text.slice(i + 1, end)
        i = close === -1 ? text.length : close + 1
      } else {
        const valueStart = i
        while (i < text.length && !/[\s>]/.test(text[i])) i++
        value = text.slice(valueStart, i)
      }
    }
    if (name) attrs.push({ name, offset: nameStart, value })
  }
  return { attrs, end: text.length }
}

function skipPast (text, needle, from) {
  const found = text.indexOf(needle, from)
  return found === -1 ? text.length : found + needle.length
}

// Satır içi betik ve stil kurallarını denetler, data-i18n* özniteliklerini döndürür
function checkHtml (ctx) {
  const text = ctx.text
  const lower = text.toLowerCase()
  const starts = lineStarts(text)
  const lineOf = (offset) => lineAt(starts, offset)
  const i18nAttrs = []
  let i = 0
  while (i < text.length) {
    const lt = text.indexOf('<', i)
    if (lt === -1) break
    if (text.startsWith('<!--', lt)) {
      i = skipPast(text, '-->', lt + 4)
      continue
    }
    const next = text[lt + 1]
    if (next === '/' || next === '!' || next === '?') {
      i = skipPast(text, '>', lt + 1)
      continue
    }
    const match = /^<([A-Za-z][A-Za-z0-9-]*)/.exec(text.slice(lt, lt + 100))
    if (!match) {
      i = lt + 1
      continue
    }
    const tag = match[1].toLowerCase()
    const parsed = parseAttributes(text, lt + match[0].length)
    for (const attr of parsed.attrs) {
      const name = attr.name.toLowerCase()
      if (name === 'style') {
        ctx.report(lineOf(attr.offset), 'html', 'style özniteliği var. CSP satır içi stili engeller, kurallar style.css dosyasına yazılır.')
      } else if (name.length > 2 && name.startsWith('on')) {
        ctx.report(lineOf(attr.offset), 'html', name + ' olay özniteliği var. CSP satır içi betiği engeller, olaylar addEventListener ile bağlanır.')
      } else if (name === 'data-i18n' || name.startsWith('data-i18n-')) {
        i18nAttrs.push({ name, line: lineOf(attr.offset), key: attr.value === null ? '' : attr.value.trim() })
      }
    }
    i = parsed.end
    if (tag === 'style') {
      ctx.report(lineOf(lt), 'html', '<style> öğesi var. CSP satır içi stili engeller, kurallar style.css dosyasına yazılır.')
    }
    if (RAW_TEXT_TAGS.has(tag)) {
      const close = lower.indexOf('</' + tag, i)
      const bodyEnd = close === -1 ? text.length : close
      if (tag === 'script' && text.slice(i, bodyEnd).trim() !== '') {
        ctx.report(lineOf(lt), 'html', 'satır içi <script> gövdesi var. CSP satır içi betiği engeller, kod ayrı bir .js dosyasına yazılır.')
      }
      i = close === -1 ? text.length : skipPast(text, '>', close)
    }
  }
  return i18nAttrs
}

// Kural 4: üçüncü taraf kütüphanelerin bütünlüğü

function checkVendor (root, report) {
  for (const item of VENDOR_FILES) {
    const buf = readIfFile(path.join(root, item.path))
    if (buf === null) {
      if (item.required) report(item.path, 1, 'vendor', 'dosya bulunamadı. ' + item.name + ' kopyası bu yolda bulunmalıdır.')
      continue
    }
    const hash = crypto.createHash('sha256').update(buf).digest('hex')
    if (hash !== item.sha256) {
      report(item.path, 1, 'vendor', 'sha256 değeri beklenenden farklı (' + hash + '). Bu dosya ' + item.name + ' ile birebir aynı olmalı ve değiştirilmemelidir.')
    }
  }
}

// i18n kuralları (Ek E5). Sözlük dosyası yoksa ilgili kapsamın kuralları atlanır.

// Sabit dize: dize, ifadesiz şablon veya bunların + ile birleşimi. Değilse null.
function staticString (node) {
  if (!node) return null
  const direct = stringValue(node)
  if (direct !== null) return direct
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticString(node.left)
    const right = left === null ? null : staticString(node.right)
    return right === null ? null : left + right
  }
  return null
}

// Dinamik anahtarın sabit öneki ('errors.' + code veya `errors.${code}`), yoksa boş dize
function staticPrefix (node) {
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const left = staticString(node.left)
    return left === null ? staticPrefix(node.left) : left
  }
  if (node.type === 'TemplateLiteral') return node.quasis[0].value.cooked || ''
  return ''
}

function unwrapObject (node) {
  if (!node) return null
  if (node.type === 'ObjectExpression') return node
  // Object.freeze({ ... }) gibi sarmalayıcılar
  if (node.type === 'CallExpression' && node.arguments.length === 1 && objectName(node.callee) === 'freeze') {
    return unwrapObject(node.arguments[0])
  }
  return null
}

function propertyKey (prop) {
  if (prop.computed) return staticString(prop.key)
  if (prop.key.type === 'Identifier') return prop.key.name
  if (prop.key.type === 'Literal') return String(prop.key.value)
  return null
}

function ownerName (parent) {
  if (!parent) return null
  if (parent.type === 'Property') return propertyKey(parent)
  if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name
  if (parent.type === 'AssignmentExpression') return objectName(parent.left)
  return null
}

// Dosyadaki tr ve en sözlük nesnelerini bulur. Desteklenen biçimler:
// messages: { tr: {...}, en: {...} }, messages: { tr, en } ve const tr = {...}, en = {...}
function findDictionaries (ast) {
  const declared = new Map()
  const objects = []
  walk(ast, (node, parent) => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
      const object = unwrapObject(node.init)
      const known = declared.get(node.id.name)
      if (object && (!known || object.start < known.start)) declared.set(node.id.name, object)
    } else if (node.type === 'ObjectExpression') {
      objects.push({ node, owner: ownerName(parent) })
    }
  })
  const resolve = (value) => {
    const object = unwrapObject(value)
    if (object || !value || value.type !== 'Identifier') return object
    return declared.get(value.name) || null
  }
  const pairOf = (object) => {
    const found = {}
    for (const prop of object.properties) {
      if (prop.type !== 'Property') continue
      const key = propertyKey(prop)
      if (LANGS.includes(key) && !found[key]) found[key] = resolve(prop.value)
    }
    return found.tr && found.en ? found : null
  }
  objects.sort((a, b) => {
    const rank = (item) => (item.owner === 'messages' ? 0 : 1)
    return rank(a) - rank(b) || a.node.start - b.node.start
  })
  for (const item of objects) {
    const pair = pairOf(item.node)
    if (pair) return { tr: pair.tr, en: pair.en, resolve }
  }
  if (declared.has('tr') && declared.has('en')) return { tr: declared.get('tr'), en: declared.get('en'), resolve }
  return null
}

// Sözlük nesnesini noktalı anahtarlara düzleştirir, iç içe nesneler "a.b" anahtarı olur
function flattenDictionary (object, resolve, prefix, out, depth) {
  for (const prop of object.properties) {
    const line = prop.loc.start.line
    if (prop.type === 'SpreadElement') {
      const spread = resolve(prop.argument)
      if (spread && depth < MAX_DICTIONARY_DEPTH) flattenDictionary(spread, resolve, prefix, out, depth + 1)
      else out.problems.push({ line, message: 'yayılım (...) çözülemedi. Sözlükler sabit nesnelerden oluşmalıdır.' })
      continue
    }
    const name = propertyKey(prop)
    if (name === null) {
      out.problems.push({ line, message: 'anahtarı sabit olmayan bir girdi var. Anahtarlar sabit dize olmalıdır.' })
      continue
    }
    const key = prefix + name
    if (prop.kind !== 'init' || prop.method) {
      out.problems.push({ line, message: '\'' + key + '\' bir yöntem veya erişimci. Değerler sabit dize olmalıdır.' })
      continue
    }
    const nested = resolve(prop.value)
    if (nested) {
      if (depth < MAX_DICTIONARY_DEPTH) flattenDictionary(nested, resolve, key + '.', out, depth + 1)
      else out.problems.push({ line, message: '\'' + key + '\' çok derin iç içe tanımlanmış.' })
      continue
    }
    const value = staticString(prop.value)
    if (value === null) {
      out.problems.push({ line, message: '\'' + key + '\' anahtarının değeri sabit bir dize değil.' })
      continue
    }
    out.entries.push({ key, value, line })
  }
}

function paramNames (value) {
  const names = new Set()
  for (const match of value.matchAll(PARAM_PATTERN)) names.add(match[1])
  return Array.from(names).sort().join(', ')
}

// Sözlük dosyasını okur, eşlik kurallarını denetler ve tüm anahtarları döndürür.
// Sözlükler bulunamazsa null döner.
function checkDictionaryFile (rel, ast, report) {
  const rule = 'i18n-parity'
  const dictionaries = findDictionaries(ast)
  if (!dictionaries) {
    report(rel, 1, rule, 'tr ve en sözlükleri bulunamadı. Sözlükler messages: { tr: {...}, en: {...} } biçiminde sabit nesneler olmalıdır.')
    return null
  }
  const read = {}
  for (const lang of LANGS) {
    const out = { entries: [], problems: [] }
    flattenDictionary(dictionaries[lang], dictionaries.resolve, '', out, 0)
    for (const problem of out.problems) report(rel, problem.line, rule, lang + ' sözlüğünde ' + problem.message)
    const map = new Map()
    for (const entry of out.entries) {
      if (map.has(entry.key)) {
        report(rel, entry.line, rule, lang + ' sözlüğünde \'' + entry.key + '\' anahtarı birden fazla tanımlanmış.')
        continue
      }
      map.set(entry.key, entry)
      if (entry.value.trim() === '') report(rel, entry.line, rule, lang + ' sözlüğünde \'' + entry.key + '\' anahtarının değeri boş.')
    }
    read[lang] = map
  }
  for (const lang of LANGS) {
    const other = lang === 'tr' ? 'en' : 'tr'
    for (const entry of read[lang].values()) {
      if (!read[other].has(entry.key)) {
        report(rel, entry.line, rule, '\'' + entry.key + '\' anahtarı ' + lang + ' sözlüğünde var, ' + other + ' sözlüğünde yok.')
      }
      const plural = /^(.*)_(one|other)$/.exec(entry.key)
      if (plural) {
        const pair = plural[1] + (plural[2] === 'one' ? '_other' : '_one')
        if (!read[lang].has(pair)) report(rel, entry.line, rule, lang + ' sözlüğünde \'' + entry.key + '\' var ama çoğul eşi \'' + pair + '\' yok.')
      }
    }
  }
  for (const entry of read.en.values()) {
    const source = read.tr.get(entry.key)
    if (!source) continue
    const trParams = paramNames(source.value)
    const enParams = paramNames(entry.value)
    if (trParams !== enParams) {
      report(rel, entry.line, rule, '\'' + entry.key + '\' anahtarının parametreleri iki dilde farklı: tr {' + trParams + '}, en {' + enParams + '}.')
    }
  }
  return new Set(Array.from(read.tr.keys()).concat(Array.from(read.en.keys())))
}

// t() çağrısındaki anahtar ifadesinden denetlenecek sabit anahtarları ve önekleri çıkarır
function keyCandidates (node, out) {
  const value = staticString(node)
  if (value !== null) {
    out.push({ key: value, prefix: false })
  } else if (node.type === 'ConditionalExpression') {
    keyCandidates(node.consequent, out)
    keyCandidates(node.alternate, out)
  } else if (node.type === 'LogicalExpression') {
    keyCandidates(node.left, out)
    keyCandidates(node.right, out)
  } else {
    const prefix = staticPrefix(node)
    if (prefix) out.push({ key: prefix, prefix: true })
  }
  return out
}

// t('anahtar') ve I18N.t('anahtar') çağrıları. Sunucuda imza t(dil, anahtar) olduğu için
// anahtar ikinci argümandır.
function translationCalls (ast, keyIndex) {
  const calls = []
  walk(ast, (node) => {
    if (node.type !== 'CallExpression') return
    const callee = node.callee
    const named = callee.type === 'Identifier' && callee.name === 't'
    const member = callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier' && callee.property.name === 't'
    if (!named && !member) return
    const arg = node.arguments[keyIndex]
    if (arg && arg.type !== 'SpreadElement') calls.push({ line: node.loc.start.line, candidates: keyCandidates(arg, []) })
  })
  return calls
}

function hasKey (keys, key) {
  return keys.has(key) || keys.has(key + '_one') || keys.has(key + '_other')
}

function hasPrefix (keys, prefix) {
  for (const key of keys) {
    if (key.startsWith(prefix)) return true
  }
  return false
}

function checkCalls (rel, calls, keys, dictRel, report) {
  for (const call of calls) {
    for (const candidate of call.candidates) {
      if (candidate.prefix && !hasPrefix(keys, candidate.key)) {
        report(rel, call.line, 'i18n-keys', '\'' + candidate.key + '\' önekiyle başlayan hiçbir anahtar ' + dictRel + ' sözlüğünde yok.')
      } else if (!candidate.prefix && !hasKey(keys, candidate.key)) {
        report(rel, call.line, 'i18n-keys', '\'' + candidate.key + '\' anahtarı ' + dictRel + ' sözlüğünde yok.')
      }
    }
  }
}

function checkHtmlKeys (items, keys, dictRel, report) {
  for (const item of items) {
    if (item.key === '') report(item.file, item.line, 'i18n-keys', item.name + ' özniteliği boş. Değer bir sözlük anahtarı olmalıdır.')
    else if (!hasKey(keys, item.key)) report(item.file, item.line, 'i18n-keys', item.name + ' özniteliğindeki \'' + item.key + '\' anahtarı ' + dictRel + ' sözlüğünde yok.')
  }
}

// Türkçeye özgü harf içeren dize ve şablon sabitleri (yorumlar sayılmaz)
function checkHardcoded (rel, ast, report) {
  const lines = new Map()
  const note = (node, text) => {
    if (typeof text !== 'string' || !TURKISH_LETTERS.test(text)) return
    const line = node.loc.start.line
    if (!lines.has(line)) lines.set(line, text)
  }
  walk(ast, (node) => {
    if (node.type === 'Literal' && typeof node.value === 'string') note(node, node.value)
    else if (node.type === 'TemplateElement') note(node, node.value.cooked === null ? node.value.raw : node.value.cooked)
  })
  for (const entry of lines) {
    report(rel, entry[0], 'i18n-hardcoded', 'Türkçeye özgü harf içeren sabit metin var ("' + snippet(entry[1]) + '"). Kullanıcıya görünen metinler i18n sözlüğüne iki dilde eklenir ve t() ile kullanılır.')
  }
}

function checkI18n (project, report) {
  const scripts = project.scripts
  const clientDict = CLIENT_I18N_FILES.find((rel) => scripts.has(rel))
  if (clientDict) {
    const keys = checkDictionaryFile(clientDict, scripts.get(clientDict), report)
    for (const entry of scripts) {
      const rel = entry[0]
      if (!isClientScript(rel)) continue
      if (!CLIENT_I18N_FILES.includes(rel)) checkHardcoded(rel, entry[1], report)
      if (keys) checkCalls(rel, translationCalls(entry[1], 0), keys, clientDict, report)
    }
    if (keys) checkHtmlKeys(project.htmlKeys, keys, clientDict, report)
  }
  if (scripts.has(SERVER_I18N_FILE)) {
    const keys = checkDictionaryFile(SERVER_I18N_FILE, scripts.get(SERVER_I18N_FILE), report)
    for (const entry of scripts) {
      const rel = entry[0]
      if (rel === SERVER_I18N_FILE || isClientScript(rel)) continue
      if (rel.startsWith('src/')) checkHardcoded(rel, entry[1], report)
      if (keys) checkCalls(rel, translationCalls(entry[1], 1), keys, SERVER_I18N_FILE, report)
    }
  }
}

// Belge eşliği (Ek E5.4): Türkçe ve İngilizce belgeler birlikte bulunur, bölüm sayıları eşittir

function countLevel2Headings (text) {
  let count = 0
  eachMarkdownLine(text, (content, index, kind) => {
    if (kind === 'text' && /^ {0,3}##[ \t]+\S/.test(content)) count++
  })
  return count
}

function checkDocParity (markdown, report) {
  for (const pair of DOC_PAIRS) {
    const trRel = pair[0]
    const enRel = pair[1]
    const hasTr = markdown.has(trRel)
    const hasEn = markdown.has(enRel)
    if (!hasTr && !hasEn) continue
    if (!hasTr || !hasEn) {
      const present = hasTr ? trRel : enRel
      const missing = hasTr ? enRel : trRel
      report(present, 1, 'doc-parity', 'eşi olan ' + missing + ' bulunamadı. Belgeler Türkçe ve İngilizce olarak birlikte tutulur.')
      continue
    }
    const trCount = countLevel2Headings(markdown.get(trRel))
    const enCount = countLevel2Headings(markdown.get(enRel))
    if (trCount !== enCount) {
      report(enRel, 1, 'doc-parity', '"## " başlık sayısı (' + enCount + ') Türkçe eşi ' + trRel + ' ile (' + trCount + ') aynı değil. İki dildeki bölümler eşleşmelidir.')
    }
  }
}

// Ana denetim. options.files verilirse dosya listesi yerine o liste kullanılır (testler için).

function runChecks (rootDir, options) {
  const acorn = loadAcorn()
  if (!acorn) throw new Error('acorn paketi bulunamadı. Önce depo kökünde "npm ci" komutunu çalıştırın.')
  const root = path.resolve(rootDir)
  const opts = options || {}
  const violations = []
  const seen = new Set()
  const report = (file, line, rule, message) => {
    const key = file + ':' + line + ':' + message
    if (seen.has(key)) return
    seen.add(key)
    violations.push({ file, line, rule, message })
  }
  const project = { scripts: new Map(), markdown: new Map(), htmlKeys: [] }
  const files = Array.isArray(opts.files) ? opts.files.filter(isScannable).sort() : listFiles(root)
  let scanned = 0
  for (const rel of files) {
    const buf = readIfFile(path.join(root, rel))
    if (buf === null || isBinary(rel, buf)) continue
    scanned++
    const ext = path.extname(rel).toLowerCase()
    const ctx = {
      rel,
      ext,
      buf,
      text: buf.toString('utf8'),
      report: (line, rule, message) => report(rel, line, rule, message)
    }
    checkDashes(ctx)
    checkInvisible(ctx)
    if (JS_EXTS.has(ext)) {
      const parsed = checkJs(acorn, ctx)
      if (parsed && keepsAst(rel)) project.scripts.set(rel, parsed.ast)
    } else if (ext === '.md') {
      checkMarkdown(ctx)
      project.markdown.set(rel, ctx.text)
    } else if (ext === '.bat') {
      checkBat(ctx)
    } else if (ext === '.html' || ext === '.htm') {
      const attrs = checkHtml(ctx)
      if (rel.startsWith('public/')) {
        for (const attr of attrs) project.htmlKeys.push(Object.assign({ file: rel }, attr))
      }
    }
  }
  checkVendor(root, report)
  checkI18n(project, report)
  checkDocParity(project.markdown, report)
  violations.sort((a, b) => {
    if (a.file !== b.file) return a.file < b.file ? -1 : 1
    return a.line - b.line
  })
  return { root, scanned, violations }
}

function formatViolation (violation) {
  return violation.file + ':' + violation.line + ': ' + violation.message
}

const USAGE = [
  'Kullanım: node scripts/denetle.js [klasör]',
  '',
  'Klasör verilmezse depo kökü denetlenir. Klasör bir git deposunun köküyse izlenen',
  'dosyalar ve .gitignore dışında kalan yeni dosyalar, değilse klasördeki tüm dosyalar',
  'denetlenir. node_modules, .git ve public/vendor dışarıda bırakılır, git\'te izlenip',
  'diskten silinmiş dosyalar atlanır.',
  '',
  'Kurallar: uzun ve kısa tire, görünmez karakterler, JavaScript sözdizimi ve noktalı',
  'virgül, istemci kodunda ES2017 ve yasak kullanımlar, üçüncü taraf dosyaların sha256',
  'değeri, Windows betikleri, Markdown düzyazısı, HTML içinde satır içi betik ve stil,',
  'i18n sözlük eşliği, sabit metin ve anahtarlar, Türkçe ve İngilizce belge eşliği.',
  'İhlal varsa çıkış kodu 1, kullanım veya ortam hatasında 2 olur.'
].join('\n')

function main (argv) {
  const args = argv.slice(2)
  if (args.includes('-h') || args.includes('--help') || args.includes('--yardim')) {
    console.log(USAGE)
    return 0
  }
  if (args.length > 1 || args.some((arg) => arg.startsWith('-'))) {
    console.error('Tanınmayan argüman: ' + args.join(' '))
    console.error(USAGE)
    return 2
  }
  const target = args.length === 1 ? path.resolve(args[0]) : path.join(__dirname, '..')
  const stat = fs.statSync(target, { throwIfNoEntry: false })
  if (!stat || !stat.isDirectory()) {
    console.error('Klasör bulunamadı: ' + target)
    return 2
  }
  let result = null
  try {
    result = runChecks(target)
  } catch (err) {
    console.error('Denetim çalıştırılamadı: ' + err.message)
    return 2
  }
  if (result.violations.length === 0) {
    console.log('Denetim tamamlandı: ' + result.scanned + ' dosya tarandı, ihlal bulunmadı.')
    return 0
  }
  for (const violation of result.violations) console.log(formatViolation(violation))
  const files = new Set(result.violations.map((violation) => violation.file))
  const counts = {}
  for (const violation of result.violations) counts[violation.rule] = (counts[violation.rule] || 0) + 1
  const summary = Object.keys(RULE_LABELS).filter((rule) => counts[rule]).map((rule) => RULE_LABELS[rule] + ': ' + counts[rule])
  console.log('')
  console.log('Denetim başarısız: ' + result.violations.length + ' ihlal, ' + files.size + ' dosyada (' + result.scanned + ' dosya tarandı).')
  console.log('Kurallara göre: ' + summary.join(', '))
  return 1
}

if (require.main === module) process.exitCode = main(process.argv)

module.exports = {
  runChecks,
  formatViolation,
  NACL_PATH,
  NACL_SHA256,
  SCRYPT_PATH,
  SCRYPT_SHA256,
  VENDOR_FILES,
  DOC_PAIRS,
  RULE_LABELS
}
