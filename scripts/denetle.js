'use strict'

// Stil ve güvenlik denetleyicisi. Projenin yazım kurallarını otomatik olarak denetler.
// Kullanım: node scripts/denetle.js [klasör]
// Klasör verilmezse depo kökü denetlenir. Her ihlal "dosya:satır: açıklama" biçiminde
// yazılır. İhlal varsa çıkış kodu 1, kullanım veya ortam hatasında 2 olur.
// JavaScript denetimleri acorn ile üretilen sözdizimi ağacı ve token listesi üzerinde
// yapılır, bu yüzden yorumlar ve dizeler içindeki geçişler ihlal sayılmaz.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')

const NACL_PATH = 'public/vendor/nacl-fast.min.js'
const NACL_SHA256 = '3ec535c004aeeb225785d8e93fb33bf99f52e399bd7dfc01969b5629baea5131'
const VENDOR_DIR = 'public/vendor/'
const SKIP_DIRS = new Set(['.git', 'node_modules'])
const JS_EXTS = new Set(['.js', '.cjs', '.mjs'])
const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.avif',
  '.woff', '.woff2', '.ttf', '.otf', '.eot', '.pdf', '.zip', '.gz', '.tgz',
  '.mp3', '.ogg', '.wav', '.mp4', '.webm'
])
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title'])

const RULE_LABELS = {
  dash: 'uzun veya kısa tire',
  semicolon: 'noktalı virgül',
  syntax: 'sözdizimi',
  lineStart: 'satır başı',
  banned: 'yasak kullanım',
  vendor: 'üçüncü taraf dosya',
  bom: 'BOM',
  eol: 'satır sonu',
  prose: 'düzyazıda noktalı virgül',
  html: 'satır içi betik veya stil'
}

const DASH_NAMES = {
  '\u2014': 'U+2014 (uzun tire)',
  '\u2013': 'U+2013 (kısa tire)'
}

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
  const stat = fs.statSync(abs, { throwIfNoEntry: false })
  return Boolean(stat && stat.isFile())
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

function walkFiles (root) {
  const rules = readIgnoreRules(root)
  const files = []
  const stack = ['']
  while (stack.length > 0) {
    const rel = stack.pop()
    const entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
    for (const entry of entries) {
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

function listFiles (root) {
  const files = listGitFiles(root) || walkFiles(root)
  return files.filter((rel) => {
    const parts = rel.split('/')
    return !rel.startsWith(VENDOR_DIR) && !parts.some((part) => SKIP_DIRS.has(part))
  }).sort()
}

function isBinary (rel, buf) {
  if (BINARY_EXTS.has(path.extname(rel).toLowerCase())) return true
  return buf.subarray(0, 8000).includes(0)
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

// Kural 1: uzun ve kısa tire

function checkDashes (ctx) {
  if (!/[\u2013\u2014]/.test(ctx.text)) return
  const starts = lineStarts(ctx.text)
  for (const match of ctx.text.matchAll(/[\u2013\u2014]/g)) {
    ctx.report(lineAt(starts, match.index), 'dash', DASH_NAMES[match[0]] + ' karakteri var. Yerine normal tire (-), virgül veya iki nokta kullanın.')
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
    return /^[ \t\uFEFF]*$/.test(ctx.text.slice(lineBegin, offset))
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
  const client = ctx.rel.startsWith('public/')
  const parsed = parseJs(acorn, ctx, client)
  if (!parsed) return
  checkSemicolons(acorn, ctx, parsed.tokens)
  checkLineStarts(acorn, ctx, parsed.ast, parsed.tokens)
  if (client) checkClientUsage(ctx, parsed.ast)
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
  let fence = null
  let block = []
  const flush = () => {
    if (block.length > 0) checkParagraph(ctx, block)
    block = []
  }
  ctx.text.split(/\r\n|\r|\n/).forEach((content, index) => {
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(content)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null
      return
    }
    const open = /^\s*(`{3,}|~{3,})/.exec(content)
    if (open) {
      flush()
      fence = open[1]
    } else if (content.trim() === '') {
      flush()
    } else {
      block.push({ line: index + 1, text: content })
    }
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
    while (i < text.length && /\s/.test(text[i])) i++
    if (text[i] === '=') {
      i++
      while (i < text.length && /\s/.test(text[i])) i++
      const quote = text[i]
      if (quote === '"' || quote === '\'') {
        const close = text.indexOf(quote, i + 1)
        i = close === -1 ? text.length : close + 1
      } else {
        while (i < text.length && !/[\s>]/.test(text[i])) i++
      }
    }
    if (name) attrs.push({ name, offset: nameStart })
  }
  return { attrs, end: text.length }
}

function skipPast (text, needle, from) {
  const found = text.indexOf(needle, from)
  return found === -1 ? text.length : found + needle.length
}

function checkHtml (ctx) {
  const text = ctx.text
  const lower = text.toLowerCase()
  const starts = lineStarts(text)
  const lineOf = (offset) => lineAt(starts, offset)
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
}

// Kural 4: üçüncü taraf şifreleme kütüphanesinin bütünlüğü

function checkVendor (root, report) {
  let buf = null
  try {
    buf = fs.readFileSync(path.join(root, NACL_PATH))
  } catch (err) {
    report(NACL_PATH, 1, 'vendor', 'dosya bulunamadı. TweetNaCl-js 1.0.3 kopyası bu yolda bulunmalıdır.')
    return
  }
  const hash = crypto.createHash('sha256').update(buf).digest('hex')
  if (hash !== NACL_SHA256) {
    report(NACL_PATH, 1, 'vendor', 'sha256 değeri beklenenden farklı (' + hash + '). Bu dosya TweetNaCl-js 1.0.3 ile birebir aynı olmalı ve değiştirilmemelidir.')
  }
}

// Ana denetim

function runChecks (rootDir) {
  const acorn = loadAcorn()
  if (!acorn) throw new Error('acorn paketi bulunamadı. Önce depo kökünde "npm ci" komutunu çalıştırın.')
  const root = path.resolve(rootDir)
  const violations = []
  const seen = new Set()
  const report = (file, line, rule, message) => {
    const key = file + ':' + line + ':' + message
    if (seen.has(key)) return
    seen.add(key)
    violations.push({ file, line, rule, message })
  }
  let scanned = 0
  for (const rel of listFiles(root)) {
    const buf = fs.readFileSync(path.join(root, rel))
    if (isBinary(rel, buf)) continue
    scanned++
    const ctx = {
      rel,
      buf,
      text: buf.toString('utf8'),
      report: (line, rule, message) => report(rel, line, rule, message)
    }
    const ext = path.extname(rel).toLowerCase()
    checkDashes(ctx)
    if (JS_EXTS.has(ext)) checkJs(acorn, ctx)
    else if (ext === '.md') checkMarkdown(ctx)
    else if (ext === '.bat') checkBat(ctx)
    else if (ext === '.html' || ext === '.htm') checkHtml(ctx)
  }
  checkVendor(root, report)
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
  'denetlenir. node_modules, .git ve public/vendor dışarıda bırakılır.',
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

module.exports = { runChecks, formatViolation, NACL_PATH, NACL_SHA256 }
