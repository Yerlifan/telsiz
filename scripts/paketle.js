'use strict'

// Sunucu kodunu (server.js ve göreli olarak yüklediği src/*.js modülleri) tek bir CommonJS
// dosyasında toplar. Node.js tek dosya uygulaması (SEA) yalnızca tek bir betik çalıştırabildiği
// ve gömülü betikteki require() yalnızca yerleşik modülleri yükleyebildiği için gereklidir.
// Desteklenenler: göreli require ('./x', '../y/z.js') ve node: önekli yerleşik modüller.
// Desteklenmeyen her kullanımda hata verilir, sessizce eksik paket üretilmez: paket adı veya
// öneksiz yerleşik modül adı ('fs'), değişkenle veya birden çok argümanla require, require.resolve
// ve require.cache gibi özellikler, require'ın değer olarak kullanılması, import ve import(),
// module.exports dışındaki module özellikleri, JSON ve .js dışındaki dosyalar, kök klasörün
// dışına çıkan yollar. Çözümleme acorn sözdizimi ağacı üzerinde yapılır.
// Kullanım: node scripts/paketle.js <giriş dosyası> <çıktı dosyası>

const fs = require('node:fs')
const path = require('node:path')
const { isBuiltin } = require('node:module')

class BundleError extends Error {
  constructor (message, file, line) {
    super((file ? file + (line ? ':' + line : '') + ': ' : '') + message)
    this.name = 'BundleError'
    this.file = file || null
    this.line = line || null
  }
}

function loadAcorn () {
  try {
    return require('acorn')
  } catch (err) {
    throw new BundleError('acorn paketi bulunamadı. Önce depo kökünde "npm ci" komutunu çalıştırın.')
  }
}

function toPosix (rel) {
  return rel.split(path.sep).join('/')
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
        let i = value.length
        while (i > 0) {
          i--
          const child = value[i]
          if (child && typeof child.type === 'string') stack.push({ node: child, parent: item.node })
        }
      } else if (value && typeof value.type === 'string') {
        stack.push({ node: value, parent: item.node })
      }
    }
  }
}

// Düğüm bir özellik adı mı (nesne anahtarı, üye adı, sınıf öğesi adı). Bunlar değişken kullanımı değildir.
function isPropertyName (node, parent) {
  if (!parent) return false
  if (parent.type === 'MemberExpression') return parent.property === node && !parent.computed
  if (parent.type === 'Property' || parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') {
    return parent.key === node && !parent.computed && parent.value !== node
  }
  return false
}

function literalString (node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked
  return null
}

// Kaynaktaki require çağrılarını bulur ve desteklenmeyen kullanımları reddeder.
// Sonuç: [{ spec, line }]
function scanModule (acorn, code, rel) {
  let ast
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      allowHashBang: true,
      locations: true
    })
  } catch (err) {
    const line = err.loc ? err.loc.line : null
    throw new BundleError('ayrıştırılamadı (' + String(err.message).replace(/\s*\(\d+:\d+\)$/, '') + '). Yalnızca CommonJS desteklenir.', rel, line)
  }
  const requires = []
  walk(ast, (node, parent) => {
    const line = node.loc ? node.loc.start.line : null
    if (node.type === 'ImportExpression') throw new BundleError('import() desteklenmez.', rel, line)
    if (node.type === 'MetaProperty') throw new BundleError(node.meta.name + '.' + node.property.name + ' desteklenmez.', rel, line)
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') {
      const arg = node.arguments.length === 1 ? node.arguments[0] : null
      const spec = arg && arg.type !== 'SpreadElement' ? literalString(arg) : null
      if (spec === null) throw new BundleError('require yalnızca tek bir sabit dizeyle kullanılabilir.', rel, line)
      requires.push({ spec, line })
      return
    }
    if (node.type !== 'Identifier' || isPropertyName(node, parent)) return
    if (node.name === 'require') {
      if (parent && parent.type === 'CallExpression' && parent.callee === node) return
      if (parent && parent.type === 'MemberExpression' && parent.object === node) {
        const prop = parent.computed ? literalString(parent.property) : parent.property.name
        if (prop === 'main') return
        throw new BundleError('require.' + (prop || '[...]') + ' desteklenmez.', rel, line)
      }
      throw new BundleError('require yalnızca doğrudan çağrılabilir (değer olarak kullanılamaz veya yeniden tanımlanamaz).', rel, line)
    }
    if (node.name === 'module') {
      if (parent && parent.type === 'MemberExpression' && parent.object === node) {
        const prop = parent.computed ? literalString(parent.property) : parent.property.name
        if (prop === 'exports') return
        throw new BundleError('module.' + (prop || '[...]') + ' desteklenmez, yalnızca module.exports kullanılabilir.', rel, line)
      }
      // require.main === module karşılaştırması
      if (parent && parent.type === 'BinaryExpression' && /^[!=]==?$/.test(parent.operator)) return
      throw new BundleError('module yalnızca module.exports veya require.main === module biçiminde kullanılabilir.', rel, line)
    }
  })
  return requires
}

function isInside (root, file) {
  const rel = path.relative(root, file)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function regularFile (file) {
  try {
    return fs.statSync(file).isFile()
  } catch (err) {
    return false
  }
}

// Göreli require yolunu dosyaya çözer: tam ad (.js veya .cjs), ad + .js veya klasör/index.js
function resolveRelative (root, fromFile, spec, rel, line) {
  const base = path.resolve(path.dirname(fromFile), spec)
  const ext = path.extname(base).toLowerCase()
  if (ext === '.json') throw new BundleError('"' + spec + '": JSON dosyaları desteklenmez.', rel, line)
  if (ext !== '' && ext !== '.js' && ext !== '.cjs') throw new BundleError('"' + spec + '": yalnızca .js ve .cjs dosyaları desteklenir.', rel, line)
  const candidates = ext === '' ? [base + '.js', path.join(base, 'index.js')] : [base]
  const found = candidates.find(regularFile)
  if (!found) throw new BundleError('"' + spec + '" bulunamadı.', rel, line)
  const real = fs.realpathSync(found)
  if (!isInside(root, real)) throw new BundleError('"' + spec + '" kök klasörün (' + root + ') dışında.', rel, line)
  return real
}

function resolveSpec (root, fromFile, spec, rel, line) {
  if (spec.startsWith('node:')) {
    if (!isBuiltin(spec)) throw new BundleError('"' + spec + '" bilinen bir Node.js yerleşik modülü değil.', rel, line)
    return { builtin: spec }
  }
  if (spec.startsWith('./') || spec.startsWith('../')) return { file: resolveRelative(root, fromFile, spec, rel, line) }
  if (isBuiltin(spec)) throw new BundleError('"' + spec + '" yerine "node:' + spec + '" yazın. Yerleşik modüller node: önekiyle yüklenir.', rel, line)
  throw new BundleError('"' + spec + '" desteklenmez. Yalnızca göreli yollar ve node: önekli yerleşik modüller toplanabilir.', rel, line)
}

// Giriş dosyasından başlayarak tüm modülleri toplar.
// Sonuç: { entry, modules: [{ id, source, deps: { spec: id } }], builtins: [ad] }
function collect (entryFile, options) {
  const acorn = loadAcorn()
  const entry = fs.realpathSync(path.resolve(entryFile))
  const root = fs.realpathSync(path.resolve((options && options.root) || path.dirname(entry)))
  if (!isInside(root, entry)) throw new BundleError('giriş dosyası kök klasörün içinde olmalıdır.', entryFile)
  const modules = new Map()
  const builtins = new Set()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()
    const id = toPosix(path.relative(root, file))
    if (modules.has(id)) continue
    const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    const source = raw.startsWith('#!') ? raw.replace(/^#![^\r\n]*/, '') : raw
    const deps = {}
    for (const item of scanModule(acorn, source, id)) {
      const target = resolveSpec(root, file, item.spec, id, item.line)
      if (target.builtin) {
        builtins.add(target.builtin)
        continue
      }
      const depId = toPosix(path.relative(root, target.file))
      deps[item.spec] = depId
      if (!modules.has(depId)) queue.push(target.file)
    }
    modules.set(id, { id, source, deps })
  }
  const entryId = toPosix(path.relative(root, entry))
  const list = Array.from(modules.values()).sort((a, b) => (a.id === entryId ? -1 : b.id === entryId ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  return { entry: entryId, modules: list, builtins: Array.from(builtins).sort() }
}

// Toplanan modüllerden tek dosyalık betiği üretir. Modüller kendi işlevlerinde çalışır,
// require yalnızca toplama anında çözülmüş göreli yolları ve node: modüllerini yükler,
// require.main giriş modülüdür, __filename ve __dirname paketin bulunduğu klasöre göre
// özgün göreli konumu gösterir.
function render (collected, banner) {
  const lines = []
  lines.push('\'use strict\'')
  lines.push('// Bu dosya scripts/paketle.js ile üretildi, elle düzenlemeyin.')
  if (banner) lines.push('// ' + String(banner).replace(/[\r\n]+/g, ' '))
  lines.push('const __paketYol = require(\'node:path\')')
  lines.push('const __paketYerlesik = require')
  lines.push('const __paketKok = __dirname')
  lines.push('const __paketModuller = new Map()')
  lines.push('const __paketOnbellek = new Map()')
  lines.push('let __paketAna = null')
  for (const mod of collected.modules) {
    lines.push('')
    lines.push('// ==================== modül: ' + mod.id)
    lines.push('__paketModuller.set(' + JSON.stringify(mod.id) + ', {')
    lines.push('  deps: ' + JSON.stringify(mod.deps) + ',')
    lines.push('  fn: function (exports, require, module, __filename, __dirname) {')
    lines.push(mod.source.replace(/\s+$/, ''))
    lines.push('  }')
    lines.push('})')
  }
  lines.push('')
  lines.push('function __paketYukle (id) {')
  lines.push('  const hazir = __paketOnbellek.get(id)')
  lines.push('  if (hazir) return hazir.exports')
  lines.push('  const tanim = __paketModuller.get(id)')
  lines.push('  const mod = { id, exports: {}, loaded: false }')
  lines.push('  __paketOnbellek.set(id, mod)')
  lines.push('  if (__paketAna === null) __paketAna = mod')
  lines.push('  const yukle = function (spec) {')
  lines.push('    if (Object.prototype.hasOwnProperty.call(tanim.deps, spec)) return __paketYukle(tanim.deps[spec])')
  lines.push('    if (typeof spec === \'string\' && spec.startsWith(\'node:\')) return __paketYerlesik(spec)')
  lines.push('    throw new Error(\'Module not found in the bundle: \' + String(spec))')
  lines.push('  }')
  lines.push('  Object.defineProperty(yukle, \'main\', { enumerable: true, get: () => __paketAna })')
  lines.push('  const dosya = __paketYol.join(__paketKok, ...id.split(\'/\'))')
  lines.push('  tanim.fn.call(mod.exports, mod.exports, yukle, mod, dosya, __paketYol.dirname(dosya))')
  lines.push('  mod.loaded = true')
  lines.push('  return mod.exports')
  lines.push('}')
  lines.push('')
  lines.push('__paketYukle(' + JSON.stringify(collected.entry) + ')')
  return lines.join('\n') + '\n'
}

// Paketi üretir ve sözdizimini doğrular. Sonuç: { code, entry, modules: [id], builtins: [ad] }
function bundle (entryFile, options) {
  const collected = collect(entryFile, options)
  const code = render(collected, options && options.banner)
  const acorn = loadAcorn()
  try {
    acorn.parse(code, { ecmaVersion: 'latest', sourceType: 'script' })
  } catch (err) {
    throw new BundleError('üretilen paket ayrıştırılamadı (' + err.message + ').')
  }
  return { code, entry: collected.entry, modules: collected.modules.map((m) => m.id), builtins: collected.builtins }
}

function main (argv) {
  const args = argv.slice(2)
  if (args.length !== 2 || args.some((arg) => arg.startsWith('-'))) {
    console.error('Kullanım: node scripts/paketle.js <giriş dosyası> <çıktı dosyası>')
    return 2
  }
  try {
    const result = bundle(args[0])
    fs.mkdirSync(path.dirname(path.resolve(args[1])), { recursive: true })
    fs.writeFileSync(args[1], result.code)
    console.log('Paket yazıldı: ' + args[1] + ' (' + result.modules.length + ' modül: ' + result.modules.join(', ') + ')')
    console.log('Yerleşik modüller: ' + result.builtins.join(', '))
    return 0
  } catch (err) {
    console.error('Paketleme başarısız: ' + (err instanceof BundleError ? err.message : (err && err.stack) || String(err)))
    return 1
  }
}

if (require.main === module) process.exitCode = main(process.argv)

module.exports = { bundle, collect, render, scanModule, BundleError }
