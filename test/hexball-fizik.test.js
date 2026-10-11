'use strict'

// Hexball fiziği (public/js/44-hexball-fizik.js, window.TelsizHexballPhysics) testleri. Modül tarayıcıdaki gibi Node vm
// bağlamında yüklenir, yalnızca window verilir (DOM, saat ve zamanlayıcı yok). Sınananlar: rapordaki başlangıç
// değerleri ve üç saha ön ayarı, seçeneklerin katı denetimi, girdi sınırlama, ivme ve sürtünme, vuruş (erim, tek vuruş,
// yeniden kurulma), diskler arası çarpışmada momentum ve sekme, duvar ve direk sekmesi, oyuncu kutusu ve kale filesi,
// başlama vuruşu kısıtı, gol algılama (kale çizgisini bütünüyle geçme, direk, kendi kalesi), gol sonrası bekleme,
// gol sınırı, süre ve altın gol, duraklatma, belirlenimcilik (aynı tohumlu girdiyle aynı dünya, ayrı bağlamlarda da),
// girdisiz dünyada kinetik enerjinin artmaması, hız sınırları ve tünelleme olmaması, kural motoruyla (43) aynı maç
// sonucu. Rastgele girdiler tohumlu xorshift32 ile üretilir. vm bağlamından dönen nesneler JSON kopyasıyla
// karşılaştırılır.

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..')
const PHYS_PATH = path.join(ROOT, 'public', 'js', '44-hexball-fizik.js')
const PHYS_SRC = fs.readFileSync(PHYS_PATH, 'utf8')
const HEX_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', '43-hexball-kural.js'), 'utf8')
const GAME_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', '33-oyun-protokol.js'), 'utf8')

// Boş bir vm bağlamı: yalnızca window. rules: true protokol çekirdeğini ve kural motorunu da yükler.
function load (opts) {
  const o = opts || {}
  const sandbox = vm.createContext({})
  sandbox.window = sandbox
  if (o.rules) {
    vm.runInContext(GAME_SRC, sandbox, { filename: '33-oyun-protokol.js' })
    vm.runInContext(HEX_SRC, sandbox, { filename: '43-hexball-kural.js' })
  }
  vm.runInContext(PHYS_SRC, sandbox, { filename: '44-hexball-fizik.js' })
  return sandbox
}

const P = load().TelsizHexballPhysics
const EPS = 1e-9

function plain (x) {
  return x === undefined ? undefined : JSON.parse(JSON.stringify(x))
}

function same (actual, expected, message) {
  assert.deepEqual(plain(actual), plain(expected), message)
}

function close (actual, expected, message, eps) {
  const tol = eps === undefined ? EPS : eps
  assert.ok(Math.abs(actual - expected) <= tol, (message || '') + ': ' + actual + ' yerine ' + expected + ' bekleniyordu')
}

function codeOf (fn) {
  try {
    fn()
  } catch (e) {
    return e.code === undefined ? 'no_code: ' + e.message : e.code
  }
  return null
}

function xorshift (seed) {
  let x = (seed >>> 0) || 0x9e3779b9
  return () => {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return x
  }
}

// [-1, 1] aralığında tohumlu sayı
function unit (next) {
  return (next() % 2001 - 1000) / 1000
}

function speed (d) {
  return Math.sqrt(d.vx * d.vx + d.vy * d.vy)
}

function dist (a, bx, by) {
  return Math.sqrt((a.x - bx) * (a.x - bx) + (a.y - by) * (a.y - by))
}

// Varsayılan dünya: classic, 300 sn, 5 gol, Kırmızı başlar, yuva 0 Kırmızı ve yuva 1 Mavi
function world (over) {
  const o = Object.assign({
    rules: 'classic',
    secs: 300,
    goals: 5,
    kick: 'red',
    players: [{ slot: 0, side: 'red' }, { slot: 1, side: 'blue' }]
  }, over || {})
  return P.createWorld(o)
}

function slot (w, n) {
  return w.players.filter((p) => p.slot === n)[0]
}

function put (disc, x, y, vx, vy) {
  disc.x = x
  disc.y = y
  disc.vx = vx || 0
  disc.vy = vy || 0
}

// Oyun aşamasında, oyuncular dış kutunun köşelerinde (sahadan ve toptan uzakta), top ortada durgun
function playWorld (over) {
  const w = world(over)
  const f = P.field(w.rules)
  w.phase = 'play'
  w.touch = 0
  w.players.forEach((p, i) => {
    const sx = i % 2 === 0 ? -1 : 1
    const sy = i % 4 < 2 ? -1 : 1
    put(p, sx * (f.hw + P.MARGIN - P.PLAYER_R), sy * (f.hh + P.MARGIN - P.PLAYER_R - 40 * Math.floor(i / 4)))
  })
  put(w.ball, 0, 0)
  return w
}

function run (w, n, inputs) {
  const all = []
  let i = 0
  while (i < n) {
    const ev = P.step(w, typeof inputs === 'function' ? inputs(w, i) : inputs)
    ev.forEach((e) => all.push(plain(e)))
    i++
  }
  return all
}

function kinetic (w) {
  let k = 0
  w.players.forEach((p) => {
    k += 0.5 * (1 / P.PLAYER_INV) * (p.vx * p.vx + p.vy * p.vy)
  })
  k += 0.5 * (1 / P.BALL_INV) * (w.ball.vx * w.ball.vx + w.ball.vy * w.ball.vy)
  return k
}

// Sahadaki kalıcı sınırlar: top saha ve kale içinde, direklere girmez. Oyuncular dış kutuda, kale filesinden
// taşmaz. Kale ağzının direk yanındaki köşesine sıkışan oyuncu direğe çok az girebilir (en çok 1 birim).
function checkBounds (w, label) {
  const f = P.field(w.rules)
  const g = f.goal / 2
  const b = w.ball
  const r = P.BALL_R
  const tag = (label || '') + ' tick ' + w.tick
  assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y) && Number.isFinite(b.vx) && Number.isFinite(b.vy), tag)
  assert.ok(Math.abs(b.y) <= f.hh - r + EPS, tag + ' top yan çizgide: ' + b.y)
  assert.ok(Math.abs(b.x) <= f.hw + f.depth - r + EPS, tag + ' top kalenin arkasında: ' + b.x)
  if (Math.abs(b.y) >= g) assert.ok(Math.abs(b.x) <= f.hw - r + EPS, tag + ' top kale çizgisinde: ' + b.x + ', ' + b.y)
  if (Math.abs(b.x) > f.hw) assert.ok(Math.abs(b.y) <= g - r + EPS, tag + ' top kale filesinde: ' + b.y)
  f.posts.forEach((q) => assert.ok(dist(b, q.x, q.y) >= r + P.POST_R - EPS, tag + ' top direğin içinde'))
  const lx = f.hw + P.MARGIN - P.PLAYER_R
  const ly = f.hh + P.MARGIN - P.PLAYER_R
  w.players.forEach((p) => {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.vx) && Number.isFinite(p.vy), tag)
    assert.ok(Math.abs(p.x) <= lx + EPS && Math.abs(p.y) <= ly + EPS, tag + ' oyuncu kutunun dışında')
    if (Math.abs(p.y) < g) assert.ok(Math.abs(p.x) <= f.hw + f.depth - P.PLAYER_R + EPS, tag + ' oyuncu fileden taştı')
    f.posts.forEach((q) => assert.ok(dist(p, q.x, q.y) >= P.PLAYER_R + P.POST_R - 1, tag + ' oyuncu direğin içinde'))
  })
}

// Topun arkasına geçip rakip kaleye süren basit oyuncu. Tohumlu gürültü eklenir, vuruş top yakınken rastgeledir.
function bot (next) {
  return (w) => {
    const f = P.field(w.rules)
    const out = {}
    w.players.forEach((p) => {
      const goalX = p.side === 'red' ? f.hw + 20 : -f.hw - 20
      const bx = w.ball.x
      const by = w.ball.y
      const gx = goalX - bx
      const gy = -by
      const gl = Math.sqrt(gx * gx + gy * gy) || 1
      const tx = bx - gx / gl * 22
      const ty = by - gy / gl * 22
      const dx = tx - p.x
      const dy = ty - p.y
      const dl = Math.sqrt(dx * dx + dy * dy) || 1
      out[p.slot] = {
        x: dx / dl + unit(next) * 0.4,
        y: dy / dl + unit(next) * 0.4,
        kick: dist(p, bx, by) < 32 && next() % 5 < 3
      }
    })
    return out
  }
}

// Tamamen rastgele girdiler
function noise (next) {
  return (w) => {
    const out = {}
    w.players.forEach((p) => {
      out[p.slot] = { x: unit(next), y: unit(next), kick: next() % 4 === 0 }
    })
    return out
  }
}

function eightPlayers () {
  const out = []
  let i = 0
  while (i < 8) {
    out.push({ slot: i, side: i % 2 === 0 ? 'red' : 'blue' })
    i++
  }
  return out
}

describe('sözleşme ve başlangıç değerleri', () => {
  test('modül dondurulmuş, değerler rapordaki başlangıç değerleri', () => {
    assert.ok(Object.isFrozen(P))
    assert.equal(P.VERSION, 1)
    assert.equal(P.TICK_HZ, 60)
    assert.equal(P.SUBSTEPS, 2)
    same(P.TEAMS, ['red', 'blue'])
    // Anlık görüntüdeki aşama kodunun sırası (45-hexball-ag.js)
    same(P.PHASES, ['kickoff', 'play', 'goal', 'paused', 'over'])
    same(P.WHY, ['score', 'time', 'golden'])
    assert.equal(P.MAX_SLOTS, 8)
    assert.equal(P.MAX_GOALS, 255)
    assert.equal(P.MAX_AT, 65535)
    assert.ok(P.MAX_SECS * 10 <= 65535, 'kalan süre u16 desisaniyeye sığar')
    const expect = {
      GOAL_DEPTH: 30,
      POST_R: 7,
      MARGIN: 50,
      CENTER_R: 70,
      PLAYER_R: 15,
      PLAYER_INV: 0.5,
      PLAYER_DAMP: 0.96,
      ACCEL: 0.11,
      KICK_ACCEL: 0.07,
      BALL_R: 10,
      BALL_INV: 1,
      BALL_DAMP: 0.985,
      KICK_POWER: 5.6,
      KICK_REACH: 4,
      E_DISC: 0.5,
      E_BALL_WALL: 0.6,
      E_PLAYER_WALL: 0.5,
      GOAL_PAUSE: 120
    }
    Object.keys(expect).forEach((key) => assert.equal(P[key], expect[key], key))
    // Alt adımda top yarıçapından ve top ile direk yarıçaplarının toplamından az yol alır
    assert.ok(P.MAX_BALL_SPEED / P.SUBSTEPS < P.BALL_R)
    assert.ok(P.MAX_BALL_SPEED / P.SUBSTEPS < P.BALL_R + P.POST_R)
    assert.ok(P.MAX_PLAYER_SPEED / P.SUBSTEPS < P.PLAYER_R)
    // Girdiyle ulaşılan en yüksek oyuncu hızı sınırın altında
    assert.ok(P.ACCEL * P.PLAYER_DAMP / (1 - P.PLAYER_DAMP) < P.MAX_PLAYER_SPEED)
  })

  test('üç saha ön ayarı ve geometrisi, ön ayar adları kural motoruyla aynı', () => {
    const ctx = load({ rules: true })
    same(P.RULES, ['quick', 'classic', 'long'])
    same(P.RULES, ctx.TelsizHexball.RULES)
    same(P.FIELDS, {
      quick: { w: 720, h: 360, goal: 120 },
      classic: { w: 880, h: 440, goal: 140 },
      long: { w: 1040, h: 520, goal: 160 }
    })
    assert.ok(Object.isFrozen(P.FIELDS) && Object.isFrozen(P.FIELDS.classic))
    for (const rules of P.RULES) {
      const f = P.field(rules)
      assert.ok(Object.isFrozen(f) && Object.isFrozen(f.segments) && Object.isFrozen(f.posts), rules)
      assert.equal(f.rules, rules)
      assert.equal(f.w, P.FIELDS[rules].w)
      assert.equal(f.h, P.FIELDS[rules].h)
      assert.equal(f.goal, P.FIELDS[rules].goal)
      assert.equal(f.hw, f.w / 2)
      assert.equal(f.hh, f.h / 2)
      assert.equal(f.depth, 30)
      same(f.posts.map((q) => [q.x, q.y]), [[-f.hw, -f.goal / 2], [-f.hw, f.goal / 2], [f.hw, -f.goal / 2], [f.hw, f.goal / 2]])
      // Saha çizgileri yalnızca topu, kale filesi topu ve oyuncuları durdurur
      assert.equal(f.segments.length, 12)
      assert.equal(f.segments.filter((s) => s.players).length, 6)
      f.segments.forEach((s) => {
        assert.equal(s.nx * s.nx + s.ny * s.ny, 1, 'iç yön birim vektör')
        if (s.players) assert.ok(Math.abs(s.ax) >= f.hw && Math.abs(s.bx) >= f.hw, 'file kale çizgisinin arkasında')
      })
    }
    assert.equal(P.field('stack'), null)
    assert.equal(P.field('__proto__'), null)
    assert.equal(P.field(null), null)
  })

  test('saflık: saat, zamanlayıcı, DOM, rastgelelik ve trigonometri yok, başka bir oyunun adı geçmiyor', () => {
    const code = PHYS_SRC.split(/\r?\n/).map((line) => line.replace(/\/\/.*$/, '')).join('\n')
    const banned = [/Math\.random/, /\bDate\b/, /performance/, /setTimeout/, /setInterval/, /requestAnimationFrame/,
      /\bdocument\b/, /navigator/, /Math\.(sin|cos|tan|asin|acos|atan|atan2|exp|pow|log|hypot|cbrt|fround)\b/,
      /structuredClone/, /\bfor\s*\(/]
    banned.forEach((re) => assert.ok(!re.test(code), String(re)))
    assert.ok(/window\.TelsizHexballPhysics = \(function \(\) \{/.test(code))
    const name = new RegExp(String.fromCharCode(104, 97, 120, 98, 97, 108, 108), 'i')
    assert.ok(!name.test(PHYS_SRC), 'fizik kaynağı')
    assert.ok(!name.test(fs.readFileSync(__filename, 'utf8')), 'test dosyası')
  })
})

describe('dünya ve seçenekler', () => {
  test('yeni dünya: başlama vuruşu, skor 0-0, top ortada, oyuncular yuva sırasıyla', () => {
    const w = world({ players: [{ slot: 3, side: 'blue' }, { slot: 1, side: 'red' }] })
    same(Object.keys(w).sort(), ['ball', 'clock', 'goals', 'golden', 'held', 'kick', 'phase', 'players', 'restart',
      'rules', 'score', 'secs', 'tick', 'touch'])
    assert.equal(w.phase, 'kickoff')
    assert.equal(w.tick, 0)
    assert.equal(w.clock, 0)
    assert.equal(w.golden, false)
    assert.equal(w.held, null)
    assert.equal(w.touch, -1)
    assert.equal(w.kick, 'red')
    same(w.score, { red: 0, blue: 0 })
    same(w.ball, { x: 0, y: 0, vx: 0, vy: 0 })
    same(w.players.map((p) => [p.slot, p.side, p.vx, p.vy, p.kick, p.armed]),
      [[1, 'red', 0, 0, false, true], [3, 'blue', 0, 0, false, true]])
    assert.equal(P.remaining(w), 300 * 60)
    assert.equal(P.matchSecond(w), 0)
  })

  test('diziliş: kendi yarısında, ayna simetrik, savunan orta yuvarlağın dışında, diskler çakışmıyor', () => {
    for (const rules of P.RULES) {
      const f = P.field(rules)
      let k = 1
      while (k <= 4) {
        const players = []
        let i = 0
        while (i < k) {
          players.push({ slot: 2 * i, side: 'red' })
          players.push({ slot: 2 * i + 1, side: 'blue' })
          i++
        }
        for (const kick of P.TEAMS) {
          const w = world({ rules: rules, kick: kick, players: players })
          const red = w.players.filter((p) => p.side === 'red')
          const blue = w.players.filter((p) => p.side === 'blue')
          red.forEach((p, n) => {
            assert.ok(p.x <= -P.PLAYER_R, rules + ' kırmızı solda')
            assert.equal(blue[n].x, -p.x, 'ayna')
            assert.equal(blue[n].y, p.y, 'ayna')
          })
          w.players.forEach((p) => {
            assert.ok(Math.abs(p.y) <= f.hh - P.PLAYER_R, 'saha içinde')
            if (p.side !== kick) assert.ok(dist(p, 0, 0) >= P.CENTER_R + P.PLAYER_R, 'savunan yuvarlağın dışında')
            w.players.forEach((q) => {
              if (q !== p) assert.ok(dist(p, q.x, q.y) >= 2 * P.PLAYER_R, 'çakışma yok')
            })
          })
          checkBounds(w, rules + ' ' + k)
        }
        k++
      }
      // Kural motoru takım başına en çok 4 kişiye izin verir, fizik bir takımda 8 kişiyi de dizer
      const w = world({ rules: rules, players: eightPlayers().map((p) => ({ slot: p.slot, side: 'red' })) })
      w.players.forEach((p) => {
        assert.ok(p.x < 0 && Math.abs(p.y) <= f.hh - P.PLAYER_R)
        w.players.forEach((q) => {
          if (q !== p) assert.ok(dist(p, q.x, q.y) >= 2 * P.PLAYER_R)
        })
      })
    }
  })

  test('hatalı seçenekler bad_options ile reddedilir', () => {
    const base = {
      rules: 'quick',
      secs: 180,
      goals: 3,
      kick: 'blue',
      players: [{ slot: 0, side: 'red' }, { slot: 7, side: 'blue' }]
    }
    assert.equal(codeOf(() => P.createWorld(base)), null)
    const bad = [
      null, 5, [], 'quick',
      Object.assign({}, base, { rules: 'stack' }),
      Object.assign({}, base, { rules: 'toString' }),
      Object.assign({}, base, { secs: 0 }),
      Object.assign({}, base, { secs: 1.5 }),
      Object.assign({}, base, { secs: P.MAX_SECS + 1 }),
      Object.assign({}, base, { secs: '180' }),
      Object.assign({}, base, { goals: 0 }),
      Object.assign({}, base, { goals: 256 }),
      Object.assign({}, base, { kick: 'spec' }),
      Object.assign({}, base, { kick: null }),
      Object.assign({}, base, { players: [] }),
      Object.assign({}, base, { players: eightPlayers().concat([{ slot: 0, side: 'red' }]) }),
      Object.assign({}, base, { players: [{ slot: 0, side: 'red' }, { slot: 0, side: 'blue' }] }),
      Object.assign({}, base, { players: [{ slot: 8, side: 'red' }] }),
      Object.assign({}, base, { players: [{ slot: -1, side: 'red' }] }),
      Object.assign({}, base, { players: [{ slot: 0, side: 'spec' }] }),
      Object.assign({}, base, { players: [{ slot: 0, side: 'red', x: 0 }] }),
      Object.assign({}, base, { players: [{ slot: 0 }] }),
      Object.assign({}, base, { players: [null] }),
      Object.assign({}, base, { players: 'x' }),
      Object.assign({}, base, { extra: 1 })
    ]
    const missing = Object.assign({}, base)
    delete missing.kick
    bad.push(missing)
    bad.forEach((o, i) => {
      assert.equal(codeOf(() => P.createWorld(o)), 'bad_options', 'durum ' + i)
      assert.equal(P.validateOptions(o), null, 'durum ' + i)
    })
  })

  test('seçenekler kopyalanır: girdiyi sonradan değiştirmek dünyayı etkilemez', () => {
    const players = [{ slot: 2, side: 'red' }, { slot: 1, side: 'blue' }]
    const o = { rules: 'long', secs: 600, goals: 255, kick: 'red', players: players }
    const copy = P.validateOptions(o)
    same(copy, { rules: 'long', secs: 600, goals: 255, kick: 'red', players: [{ slot: 1, side: 'blue' }, { slot: 2, side: 'red' }] })
    const w = P.createWorld(o)
    players[0].side = 'blue'
    players.push({ slot: 5, side: 'red' })
    same(w.players.map((p) => [p.slot, p.side]), [[1, 'blue'], [2, 'red']])
    same(o.players.map((p) => p.slot), [2, 1, 5], 'girdi sıralanmadı')
  })

  test('cloneWorld bağımsız ve eşit bir kopya verir', () => {
    const w = world({ players: eightPlayers() })
    run(w, 200, bot(xorshift(3)))
    const c = P.cloneWorld(w)
    same(c, w)
    c.ball.x += 1
    c.players[0].vx += 1
    c.score.red = 9
    assert.notEqual(w.ball.x, c.ball.x)
    assert.notEqual(w.players[0].vx, c.players[0].vx)
    assert.equal(w.score.red === 9, false)
  })
})

describe('girdi', () => {
  test('normalizeInput sınırlar ve temizler', () => {
    same(P.normalizeInput(null), { x: 0, y: 0, kick: false })
    same(P.normalizeInput(undefined), { x: 0, y: 0, kick: false })
    same(P.normalizeInput('x'), { x: 0, y: 0, kick: false })
    same(P.normalizeInput({ x: 0.5, y: -0.25, kick: true }), { x: 0.5, y: -0.25, kick: true })
    same(P.normalizeInput({ x: 5, y: 0 }), { x: 1, y: 0, kick: false })
    same(P.normalizeInput({ x: -1e9, y: 0 }), { x: -1, y: 0, kick: false })
    same(P.normalizeInput({ x: NaN, y: Infinity, kick: 1 }), { x: 0, y: 0, kick: false })
    same(P.normalizeInput({ x: '1', y: -Infinity, kick: 'true' }), { x: 0, y: 0, kick: false })
    const d = P.normalizeInput({ x: 1, y: 1 })
    close(d.x * d.x + d.y * d.y, 1, 'çapraz girdi birim boyda')
    close(d.x, d.y, 'yön korunur')
    const small = P.normalizeInput({ x: 0.3, y: 0.4 })
    same(small, { x: 0.3, y: 0.4, kick: false }, 'boyu 1 altındaki girdi aynı kalır')
  })

  test('girdi dizi, nesne ya da hiç verilmeyebilir, girdi değiştirilmez', () => {
    const a = world()
    const b = world()
    const c = world()
    const inputs = Object.freeze([Object.freeze({ x: 1, y: 0, kick: false }), Object.freeze({ x: -1, y: 0.5, kick: true })])
    run(a, 50, inputs)
    run(b, 50, { 0: { x: 1, y: 0, kick: false }, 1: { x: -1, y: 0.5, kick: true } })
    same(a, b)
    run(c, 50, null)
    const d = world()
    run(d, 50, undefined)
    same(c, d)
    same(c.players.map((p) => [p.vx, p.vy]), [[0, 0], [0, 0]], 'girdisiz oyuncular durur')
  })
})

describe('hareket ve vuruş', () => {
  test('ivme, sürtünme ve en yüksek hız', () => {
    const w = playWorld()
    const f = P.field(w.rules)
    const p = slot(w, 0)
    put(p, -f.hw, 0)
    put(w.ball, 300, 150)
    P.step(w, { 0: { x: 1, y: 0 } })
    close(p.vx, P.ACCEL * P.PLAYER_DAMP, 'ilk adım')
    let top = 0
    // 150 adımda oyuncu sahanın ortasına varmaz, hiçbir şeye çarpmaz
    run(w, 150, (ww) => {
      top = Math.max(top, speed(slot(ww, 0)))
      return { 0: { x: 1, y: 0 } }
    })
    const terminal = P.ACCEL * P.PLAYER_DAMP / (1 - P.PLAYER_DAMP)
    assert.ok(top <= terminal + EPS, 'en yüksek hız aşılmaz')
    close(p.vx, terminal, 'en yüksek hıza yaklaşır', 0.05)
    assert.ok(p.x < -50)
    // Vuruş tutulurken ivme daha az
    put(p, -200, -f.hh)
    run(w, 150, { 0: { x: 0, y: 1, kick: true } })
    assert.ok(p.y < 50)
    close(p.vy, P.KICK_ACCEL * P.PLAYER_DAMP / (1 - P.PLAYER_DAMP), 'vuruş tutulurken', 0.05)
    // Çapraz girdi düz girdiden hızlı değil
    const q = slot(w, 1)
    put(q, 100, 0)
    run(w, 400, { 1: { x: 1, y: 1 } })
    assert.ok(speed(q) <= terminal + EPS)
    // Top sürtünmesi
    put(w.ball, 0, 0, 5, 0)
    P.step(w, null)
    close(w.ball.vx, 5 * P.BALL_DAMP, 'top sürtünmesi')
    close(w.ball.x, 5, 'top iki alt adımda bir adımlık yol alır')
  })

  test('vuruş: erimde topa itki verir, tutuldukça bir kez vurur, bırakılınca yeniden kurulur', () => {
    const w = playWorld()
    const p = slot(w, 0)
    const reach = P.PLAYER_R + P.BALL_R + P.KICK_REACH
    put(p, -reach, 0)
    put(w.ball, 0, 0)
    P.step(w, { 0: { kick: true } })
    close(w.ball.vx, P.KICK_POWER * P.BALL_DAMP, 'erimin tam sınırında vurur')
    close(w.ball.vy, 0)
    assert.equal(p.armed, false)
    assert.equal(p.kick, true)
    // Tutmaya devam: top yeniden erime girse de vurmaz
    put(w.ball, 0, 0)
    P.step(w, { 0: { kick: true } })
    same([w.ball.vx, w.ball.vy], [0, 0], 'tutulan vuruş yeniden vurmaz')
    // Bırak ve yeniden bas
    P.step(w, { 0: { kick: false } })
    assert.equal(p.armed, true)
    assert.equal(p.kick, false)
    put(p, -20, -20)
    put(w.ball, 0, 0)
    P.step(w, { 0: { kick: true } })
    close(w.ball.vx, P.KICK_POWER / Math.sqrt(2) * P.BALL_DAMP, 'yön oyuncudan topa')
    close(w.ball.vy, P.KICK_POWER / Math.sqrt(2) * P.BALL_DAMP)
  })

  test('vuruş: erim dışında vurmaz, kurulu kalır ve top erime girince vurur', () => {
    const w = playWorld()
    const p = slot(w, 0)
    put(p, -29.5, 0)
    put(w.ball, 0, 0)
    P.step(w, { 0: { kick: true } })
    same([w.ball.vx, w.ball.vy], [0, 0])
    assert.equal(p.armed, true)
    put(p, -28.5, 0)
    P.step(w, { 0: { kick: true } })
    close(w.ball.vx, P.KICK_POWER * P.BALL_DAMP)
    assert.equal(p.armed, false)
    assert.equal(w.touch, 0)
  })

  test('aynı adımda iki vuruş ve hızlı top: top hız sınırını aşmaz', () => {
    const w = playWorld()
    put(slot(w, 0), -27, 0)
    put(slot(w, 1), -20, -18)
    put(w.ball, 0, 0, 14, 0)
    P.step(w, { 0: { kick: true }, 1: { kick: true } })
    assert.equal(slot(w, 0).armed, false)
    assert.equal(slot(w, 1).armed, false)
    assert.ok(speed(w.ball) <= P.MAX_BALL_SPEED + EPS)
    close(speed(w.ball), P.MAX_BALL_SPEED * P.BALL_DAMP, 'sınıra kırpılır', 1e-6)
  })
})

describe('çarpışmalar', () => {
  // İki disk karşı karşıya: momentum korunur, normal yöndeki bağıl hız -e katına iner, diskler iç içe kalmaz.
  // Adım sonundaki sürtünme geri alınarak çarpışmadan hemen sonraki hız bulunur.
  function headOn (w, a, ma, da, b, mb, db, e) {
    const before = { av: a.vx, bv: b.vx }
    const events = P.step(w, null)
    const av = a.vx / da
    const bv = b.vx / db
    close(ma * av + mb * bv, ma * before.av + mb * before.bv, 'momentum')
    close(bv - av, -e * (before.bv - before.av), 'sekme')
    close(a.vy, 0)
    close(b.vy, 0)
    return events
  }

  test('oyuncu ile oyuncu', () => {
    const w = playWorld()
    const a = slot(w, 0)
    const b = slot(w, 1)
    put(a, -40, 50, 4, 0)
    put(b, -8, 50, -2, 0)
    headOn(w, a, 1 / P.PLAYER_INV, P.PLAYER_DAMP, b, 1 / P.PLAYER_INV, P.PLAYER_DAMP, P.E_DISC)
    assert.ok(b.x - a.x >= 2 * P.PLAYER_R - EPS, 'iç içe değil')
  })

  test('oyuncu ile top: dokunuş kaydedilir', () => {
    const w = playWorld()
    w.touch = -1
    const p = slot(w, 1)
    put(p, -36, 0, 3, 0)
    put(w.ball, -10, 0, -1, 0)
    headOn(w, p, 1 / P.PLAYER_INV, P.PLAYER_DAMP, w.ball, 1 / P.BALL_INV, P.BALL_DAMP, P.E_DISC)
    assert.ok(w.ball.x - p.x >= P.PLAYER_R + P.BALL_R - EPS, 'iç içe değil')
    assert.equal(w.touch, 1)
  })

  test('merkezleri çakışan diskler belirlenimci yönde ayrılır', () => {
    const w = playWorld()
    put(slot(w, 0), 0, 100)
    put(slot(w, 1), 0, 100)
    P.step(w, null)
    assert.ok(slot(w, 1).x > slot(w, 0).x, 'küçük yuva sola, büyük yuva sağa')
    close(slot(w, 1).x - slot(w, 0).x, 2 * P.PLAYER_R)
  })

  // Sekmenin olduğu adımı bulur: o adımda hızın duvara dik bileşeni -e katına iner, paralel bileşen değişmez
  function bounce (w, disc, damp, axis, e, max) {
    let i = 0
    while (i < max) {
      const vn = axis === 'x' ? disc.vx : disc.vy
      const vt = axis === 'x' ? disc.vy : disc.vx
      P.step(w, null)
      const an = (axis === 'x' ? disc.vx : disc.vy) / damp
      const at = (axis === 'x' ? disc.vy : disc.vx) / damp
      if (Math.sign(an) !== Math.sign(vn) && vn !== 0) {
        close(an, -e * vn, 'dik bileşen')
        close(at, vt, 'paralel bileşen')
        return true
      }
      i++
    }
    return false
  }

  test('top yan çizgiden ve kale çizgisinden 0,6 ile seker', () => {
    const w = playWorld()
    const f = P.field(w.rules)
    put(w.ball, 0, -f.hh + 30, 2, -4)
    assert.ok(bounce(w, w.ball, P.BALL_DAMP, 'y', P.E_BALL_WALL, 60), 'üst çizgi')
    put(w.ball, f.hw - 40, f.goal / 2 + 60, 5, 1)
    assert.ok(bounce(w, w.ball, P.BALL_DAMP, 'x', P.E_BALL_WALL, 60), 'kale çizgisi')
    checkBounds(w)
  })

  test('top direkten 0,6, oyuncu direkten 0,5 ile seker, direğe çarpan top gol olmaz', () => {
    const w = playWorld()
    const f = P.field(w.rules)
    const g = f.goal / 2
    put(w.ball, f.hw - 40, g, 6, 0)
    assert.ok(bounce(w, w.ball, P.BALL_DAMP, 'x', P.E_BALL_WALL, 60), 'top')
    assert.ok(dist(w.ball, f.hw, g) >= P.BALL_R + P.POST_R - EPS)
    const p = slot(w, 0)
    put(p, -f.hw + 60, -g, -4, 0)
    assert.ok(bounce(w, p, P.PLAYER_DAMP, 'x', P.E_PLAYER_WALL, 60), 'oyuncu')
    assert.ok(dist(p, -f.hw, -g) >= P.PLAYER_R + P.POST_R - EPS)
    const events = run(w, 120, null)
    same(events, [], 'gol yok')
    same(w.score, { red: 0, blue: 0 })
  })
})

describe('saha sınırları', () => {
  test('en yüksek hızdaki top her yönde sahada kalır, duvardan ve direkten geçmez', () => {
    const next = xorshift(11)
    for (const rules of P.RULES) {
      const f = P.field(rules)
      let n = 0
      while (n < 150) {
        const w = playWorld({ rules: rules })
        const ang = (next() % 3600) / 3600
        // Yön trigonometri yerine birim kare çevresinden seçilir ve normalleştirilir
        let dx = ang < 0.25 ? 1 : ang < 0.5 ? 1 - (ang - 0.25) * 8 : ang < 0.75 ? -1 : -1 + (ang - 0.75) * 8
        let dy = ang < 0.25 ? -1 + ang * 8 : ang < 0.5 ? 1 : ang < 0.75 ? 1 - (ang - 0.5) * 8 : -1
        const len = Math.sqrt(dx * dx + dy * dy)
        dx /= len
        dy /= len
        const x = unit(next) * (f.hw - 20)
        const y = unit(next) * (f.hh - 20)
        put(w.ball, x, y, dx * P.MAX_BALL_SPEED, dy * P.MAX_BALL_SPEED)
        let i = 0
        while (i < 90) {
          P.step(w, null)
          checkBounds(w, rules + ' atış ' + n)
          assert.ok(speed(w.ball) <= P.MAX_BALL_SPEED + EPS)
          i++
        }
        n++
      }
    }
  })

  test('köşelere, direklere ve kale içine en yüksek hızla atılan top sahada kalır', () => {
    for (const rules of P.RULES) {
      const f = P.field(rules)
      const g = f.goal / 2
      const shots = [
        [f.hw - 100, f.hh - 100, 1, 1],
        [-f.hw + 100, -f.hh + 100, -1, -1],
        [f.hw - 100, g, 1, 0],
        [f.hw - 100, g - 12, 1, 0.05],
        [f.hw - 100, -g + 12, 1, -0.05],
        [-f.hw + 100, g + 3, -1, 0],
        [f.hw - 60, 0, 1, 0.9],
        [f.hw - 60, 0, 1, -0.9],
        [f.hw + 5, 0, 1, 0.3],
        [-f.hw - 5, g - 15, -0.2, 1]
      ]
      shots.forEach((s, n) => {
        const w = playWorld({ rules: rules })
        const len = Math.sqrt(s[2] * s[2] + s[3] * s[3])
        put(w.ball, s[0], s[1], s[2] / len * P.MAX_BALL_SPEED, s[3] / len * P.MAX_BALL_SPEED)
        let i = 0
        while (i < 120) {
          P.step(w, null)
          checkBounds(w, rules + ' atış ' + n)
          i++
        }
      })
    }
  })

  test('oyuncu dış kutuda kalır, kaleye ağızdan girer ama kalenin arkasına geçemez', () => {
    const w = playWorld()
    const f = P.field(w.rules)
    const p = slot(w, 0)
    const lx = f.hw + P.MARGIN - P.PLAYER_R
    const ly = f.hh + P.MARGIN - P.PLAYER_R
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
    dirs.forEach((d) => {
      // Top oyuncunun sekiz yolunun hiçbirinde değil
      put(w.ball, -300, -60)
      put(p, 0, 150)
      run(w, 900, (ww) => {
        checkBounds(ww)
        return { 0: { x: d[0], y: d[1] } }
      })
      if (d[1] === 0) close(Math.abs(p.x), lx, 'kutunun kenarı')
      if (d[0] === 0) close(Math.abs(p.y), ly, 'kutunun kenarı')
    })
    // Ağızdan girip arka fileye dayanır
    put(p, f.hw - 60, 0)
    run(w, 300, { 0: { x: 1, y: 0 } })
    // Fileden 0,5 ile sekip yeniden ivmelendiği için fileye çok yakın titrer
    close(p.x, f.hw + f.depth - P.PLAYER_R, 'arka file', 0.1)
    // Kalenin dışından dolanıp arkasına geçmeye çalışır: üstten aşağı, alttan yukarı
    put(p, f.hw + 34, -f.hh)
    run(w, 400, (ww) => {
      checkBounds(ww)
      return { 0: { x: 0.3, y: 1 } }
    })
    assert.ok(p.y < -f.goal / 2, 'kalenin üstünde kalır: ' + p.y)
    put(p, -f.hw - 34, f.hh)
    run(w, 400, (ww) => {
      checkBounds(ww)
      return { 0: { x: -0.3, y: -1 } }
    })
    assert.ok(p.y > f.goal / 2, 'kalenin altında kalır: ' + p.y)
  })
})

describe('başlama vuruşu', () => {
  test('topa dokunulana kadar herkes kendi yarısında, savunan orta yuvarlağın dışında, saat işlemez', () => {
    for (const kick of P.TEAMS) {
      const w = world({ kick: kick, players: [{ slot: 0, side: 'red' }, { slot: 1, side: 'blue' }, { slot: 2, side: 'red' }, { slot: 3, side: 'blue' }] })
      const events = run(w, 400, (ww) => {
        ww.players.forEach((p) => {
          const s = p.side === 'red' ? -1 : 1
          assert.ok(p.x * s >= P.PLAYER_R - EPS, 'kendi yarısında')
          if (p.side !== kick) assert.ok(dist(p, 0, 0) >= P.CENTER_R + P.PLAYER_R - EPS, 'yuvarlağın dışında')
        })
        const out = {}
        ww.players.forEach((p) => {
          // Savunanlar topa, başlayan takım topa değmeden rakip yarıya koşar
          out[p.slot] = p.side === kick ? { x: p.side === 'red' ? 1 : -1, y: p.slot < 2 ? -1 : 1 } : { x: -p.x, y: -p.y }
        })
        return out
      })
      same(events, [], kick)
      assert.equal(w.phase, 'kickoff')
      assert.equal(w.clock, 0)
      assert.equal(w.tick, 400)
      same(w.ball, { x: 0, y: 0, vx: 0, vy: 0 })
      assert.equal(P.remaining(w), 300 * 60)
      const defender = w.players.filter((p) => p.side !== kick)[0]
      // İki savunan yuvarlağın kenarında birbirine dayanır, aralarındaki itiş onları çok az dışarı itebilir
      close(dist(defender, 0, 0), P.CENTER_R + P.PLAYER_R, 'savunan yuvarlağın kenarında', 1e-3)
    }
  })

  test('ilk dokunuş oyunu başlatır, kısıt kalkar ve saat işlemeye başlar', () => {
    const w = world()
    const kicker = slot(w, 0)
    let events = []
    let n = 0
    while (w.phase === 'kickoff' && n < 400) {
      events = events.concat(run(w, 1, { 0: { x: -kicker.x, y: -kicker.y }, 1: { x: -1, y: 0 } }))
      n++
    }
    same(events, [{ e: 'play', by: 0 }])
    assert.equal(w.phase, 'play')
    assert.equal(w.touch, 0)
    assert.equal(w.clock, 1, 'dokunuşun olduğu adım sayılır')
    // Savunan artık yuvarlağa girebilir
    let inside = false
    run(w, 300, (ww) => {
      if (dist(slot(ww, 1), 0, 0) < P.CENTER_R) inside = true
      return { 1: { x: -slot(ww, 1).x, y: -slot(ww, 1).y } }
    })
    assert.ok(inside)
  })

  test('başlama vuruşunda vuruş da oyunu başlatır', () => {
    const w = world({ kick: 'blue' })
    put(slot(w, 1), 27, 0)
    const events = run(w, 1, { 1: { kick: true } })
    same(events, [{ e: 'play', by: 1 }])
    assert.ok(w.ball.vx < 0, 'top Kırmızının yarısına gider')
  })
})

describe('gol', () => {
  // Topu yuva by'nin vuruşuyla verilen hızda gönderir, gol olana kadar adımlar. Dönüş: gol adımının olayları.
  function shoot (w, x, y, vx, vy, by) {
    put(w.ball, x, y, vx, vy)
    w.touch = by
    let i = 0
    while (i < 200) {
      const tick = w.tick
      const ev = plain(P.step(w, null))
      if (ev.length) return { ev: ev, tick: tick }
      i++
    }
    return { ev: [], tick: -1 }
  }

  test('sağ kaleye giren top Kırmızının golüdür, gol sonrası 2 saniye beklenir, gol yiyen takım başlar', () => {
    const w = playWorld({ players: [{ slot: 0, side: 'red' }, { slot: 1, side: 'blue' }, { slot: 4, side: 'red' }] })
    const f = P.field(w.rules)
    w.clock = 150
    const res = shoot(w, f.hw - 100, 0, 6, 0, 4)
    same(res.ev, [{ e: 'goal', side: 'red', by: 4, at: 2 }])
    assert.ok(w.ball.x > f.hw + P.BALL_R, 'top çizgiyi bütünüyle geçti')
    assert.equal(w.phase, 'goal')
    same(w.score, { red: 1, blue: 0 })
    assert.equal(w.kick, 'blue')
    assert.equal(w.restart, res.tick + P.GOAL_PAUSE)
    const clock = w.clock
    // Bekleme sırasında top fileden döner, karşı kaleye taşınsa da gol sayılmaz, saat işlemez
    let events = run(w, 60, null)
    put(w.ball, -f.hw - 15, 0)
    events = events.concat(run(w, P.GOAL_PAUSE - 61, null))
    same(events, [])
    assert.equal(w.phase, 'goal')
    assert.equal(w.clock, clock)
    same(w.score, { red: 1, blue: 0 })
    events = run(w, 1, null)
    same(events, [{ e: 'kickoff', kick: 'blue' }])
    assert.equal(w.phase, 'kickoff')
    assert.equal(w.tick, res.tick + P.GOAL_PAUSE + 1)
    assert.equal(w.touch, -1)
    same(w.ball, { x: 0, y: 0, vx: 0, vy: 0 })
    const fresh = world({ kick: 'blue', players: [{ slot: 0, side: 'red' }, { slot: 1, side: 'blue' }, { slot: 4, side: 'red' }] })
    same(w.players.map((p) => [p.x, p.y, p.vx, p.vy]), fresh.players.map((p) => [p.x, p.y, p.vx, p.vy]), 'diziliş')
  })

  test('sol kaleye giren top Mavinin golüdür, Kırmızı oyuncu attıysa by yine onun yuvasıdır', () => {
    const w = playWorld()
    const f = P.field(w.rules)
    const res = shoot(w, -f.hw + 80, 20, -7, 0.5, 0)
    same(res.ev, [{ e: 'goal', side: 'blue', by: 0, at: 0 }])
    assert.equal(w.kick, 'red')
  })

  test('top kale çizgisini bütünüyle geçmeden gol olmaz', () => {
    for (const s of [1, -1]) {
      const w = playWorld()
      const f = P.field(w.rules)
      put(w.ball, s * (f.hw + 5), 0)
      same(run(w, 10, null), [], 'yarısı geçti')
      put(w.ball, s * (f.hw + P.BALL_R), -5)
      same(run(w, 10, null), [], 'tam çizgide')
      put(w.ball, s * (f.hw + P.BALL_R + 0.001), 5)
      same(run(w, 1, null), [{ e: 'goal', side: s > 0 ? 'red' : 'blue', by: 0, at: 0 }])
    }
  })

  test('kale çizgisi boyunca dışarıda yuvarlanan top ve başlama vuruşundaki top gol olmaz', () => {
    const w = playWorld()
    const f = P.field(w.rules)
    put(w.ball, f.hw - P.BALL_R, f.goal / 2 + 40, 0, 4)
    same(run(w, 120, null), [])
    const k = world()
    put(k.ball, f.hw + 15, 0)
    same(run(k, 5, null), [], 'başlama vuruşu aşamasında gol yok')
    assert.equal(k.phase, 'kickoff')
  })

  test('gol sınırına ulaşan takım kazanır, sonra adım hiçbir şey yapmaz', () => {
    const w = playWorld({ goals: 2 })
    const f = P.field(w.rules)
    w.score.blue = 1
    w.clock = 600
    const res = shoot(w, -f.hw + 50, 0, -8, 0, 1)
    same(res.ev, [{ e: 'goal', side: 'blue', by: 1, at: 10 }, { e: 'over', winner: 'blue', why: 'score' }])
    assert.equal(w.phase, 'over')
    const before = plain(w)
    same(run(w, 30, { 0: { x: 1, y: 1, kick: true } }), [])
    same(w, before)
  })
})

describe('süre ve altın gol', () => {
  test('saat yalnızca oyunda işler, süre bitince önde olan kazanır', () => {
    const w = playWorld({ secs: 2 })
    w.score.red = 1
    assert.equal(P.remaining(w), 120)
    same(run(w, 119, null), [])
    assert.equal(w.clock, 119)
    assert.equal(P.remaining(w), 1)
    assert.equal(P.matchSecond(w), 1)
    same(run(w, 1, null), [{ e: 'time' }, { e: 'over', winner: 'red', why: 'time' }])
    assert.equal(w.phase, 'over')
    assert.equal(P.remaining(w), 0)
  })

  test('beraberlikte altın gol: süre yeniden bitmez, ilk gol maçı bitirir', () => {
    const w = playWorld({ secs: 1 })
    const f = P.field(w.rules)
    w.score = { red: 2, blue: 2 }
    same(run(w, 60, null), [{ e: 'time' }, { e: 'golden' }])
    assert.equal(w.phase, 'play')
    assert.equal(w.golden, true)
    assert.equal(P.remaining(w), 0)
    same(run(w, 600, null), [], 'süre yeniden bitmez')
    assert.equal(w.clock, 660)
    put(w.ball, f.hw - 30, 0, 8, 0)
    w.touch = 1
    same(run(w, 30, null), [{ e: 'goal', side: 'red', by: 1, at: 11 }, { e: 'over', winner: 'red', why: 'golden' }])
    same(w.score, { red: 3, blue: 2 })
  })

  test('golün saniyesi MAX_AT ile sınırlanır', () => {
    const w = playWorld()
    w.clock = (P.MAX_AT + 10) * P.TICK_HZ
    assert.equal(P.matchSecond(w), P.MAX_AT)
  })
})

describe('duraklatma ve durdurma', () => {
  test('pause adımı durdurur, resume önceki aşamaya döner, stop maçı bitirir', () => {
    const w = world({ players: eightPlayers() })
    run(w, 100, bot(xorshift(5)))
    const phase = w.phase
    assert.equal(P.pause(w), true)
    assert.equal(w.phase, 'paused')
    assert.equal(w.held, phase)
    assert.equal(P.pause(w), false, 'iki kez duraklatılmaz')
    const before = plain(w)
    same(run(w, 50, bot(xorshift(6))), [])
    same(w, before, 'duraklamada dünya değişmez')
    assert.equal(P.resume(w), true)
    assert.equal(w.phase, phase)
    assert.equal(w.held, null)
    assert.equal(P.resume(w), false)
    assert.equal(P.stop(w), true)
    assert.equal(w.phase, 'over')
    assert.equal(P.stop(w), false)
    assert.equal(P.pause(w), false)
    assert.equal(P.resume(w), false)
    const b = world()
    P.pause(b)
    assert.equal(P.stop(b), true, 'duraklamadaki maç da durdurulur')
    assert.equal(b.held, null)
  })

  test('gol beklemesi duraklamada ilerlemez', () => {
    const w = playWorld()
    const f = P.field(w.rules)
    put(w.ball, f.hw + 11, 0)
    run(w, 1, null)
    assert.equal(w.phase, 'goal')
    run(w, 10, null)
    P.pause(w)
    run(w, 500, null)
    P.resume(w)
    same(run(w, P.GOAL_PAUSE - 11, null), [])
    same(run(w, 1, null), [{ e: 'kickoff', kick: 'blue' }])
  })
})

describe('maç sürerken ayrılan oyuncu', () => {
  test('removePlayer diski dünyadan kaldırır, topa son dokunan oysa dokunuş silinir, top artık ona çarpmaz', () => {
    const w = playWorld({ rules: 'quick', players: [{ slot: 0, side: 'red' }, { slot: 1, side: 'blue' }, { slot: 2, side: 'red' }] })
    put(slot(w, 2), -180, 72)
    put(w.ball, -120, 72, -8, 0)
    w.touch = 2
    assert.equal(P.removePlayer(w, 2), true)
    assert.equal(P.removePlayer(w, 2), false)
    assert.equal(P.removePlayer(w, 7), false)
    same(w.players.map((p) => p.slot), [0, 1])
    assert.equal(w.touch, -1)
    assert.equal(w.phase, 'play', 'aşama değişmez')
    // Top boş kalan yerden geçer (ayrılanın diskine çarpıp durmaz)
    run(w, 12, null)
    assert.ok(w.ball.x < -180, 'top ' + w.ball.x)
    assert.equal(w.touch, -1)
  })

  test('başlama vuruşu beklenirken kalanlar yeni sayıya göre dizilir, duraklamada aşama korunur, sonraki dizilişler kalanlara göre', () => {
    const w = world({ rules: 'quick', players: [{ slot: 0, side: 'red' }, { slot: 1, side: 'blue' }, { slot: 2, side: 'red' }] })
    const f = P.field(w.rules)
    same([slot(w, 0).y, slot(w, 2).y].map(Math.sign), [-1, 1], 'iki Kırmızı üst ve altta')
    P.removePlayer(w, 2)
    assert.equal(w.phase, 'kickoff')
    same([slot(w, 0).x, slot(w, 0).y], [-0.5 * f.hw, 0], 'tek Kırmızı ortada')
    // Duraklamadaki başlama vuruşu
    const d = world({ rules: 'quick', players: [{ slot: 0, side: 'red' }, { slot: 1, side: 'blue' }, { slot: 3, side: 'blue' }] })
    P.pause(d)
    P.removePlayer(d, 3)
    assert.equal(d.phase, 'paused')
    assert.equal(d.held, 'kickoff')
    same([slot(d, 1).x, slot(d, 1).y], [0.5 * f.hw, 0])
    // Oyunda ayrılınca diziliş hemen değişmez, gol sonrası başlama vuruşu kalanlara göredir
    const g = playWorld({ rules: 'quick', players: [{ slot: 0, side: 'red' }, { slot: 1, side: 'blue' }, { slot: 2, side: 'red' }] })
    put(slot(g, 0), -100, -100)
    P.removePlayer(g, 2)
    same([slot(g, 0).x, slot(g, 0).y], [-100, -100])
    put(g.ball, f.hw + 11, 0)
    run(g, 1, null)
    assert.equal(g.phase, 'goal')
    run(g, P.GOAL_PAUSE, null)
    assert.equal(g.phase, 'kickoff')
    same([slot(g, 0).x, slot(g, 0).y], [-0.5 * f.hw, 0])
  })
})

describe('belirlenimcilik', () => {
  function simulate (Phys, seed, ticks, kind) {
    const w = Phys.createWorld({ rules: 'classic', secs: 120, goals: 255, kick: 'red', players: eightPlayers() })
    const next = xorshift(seed)
    const input = kind === 'noise' ? noise(next) : bot(next)
    const events = []
    let i = 0
    while (i < ticks) {
      Phys.step(w, input(w)).forEach((e) => events.push(plain(Object.assign({ tick: w.tick }, e))))
      i++
    }
    return { world: plain(w), events: events }
  }

  test('aynı tohumlu girdiyle aynı dünya ve aynı olaylar', () => {
    for (const kind of ['bot', 'noise']) {
      const a = simulate(P, 42, 6000, kind)
      const b = simulate(P, 42, 6000, kind)
      same(a, b, kind)
      const c = simulate(P, 43, 6000, kind)
      assert.notDeepEqual(a.world, c.world, 'başka tohum başka sonuç')
    }
    const goals = simulate(P, 42, 6000, 'bot').events.filter((e) => e.e === 'goal')
    assert.ok(goals.length >= 2, 'maçta gol olur: ' + goals.length)
  })

  test('ayrı bağlamlarda yüklenen iki modül aynı sonucu verir, iç durum paylaşılmaz', () => {
    const other = load().TelsizHexballPhysics
    same(simulate(other, 7, 4000, 'bot'), simulate(P, 7, 4000, 'bot'))
    // İki dünyayı iç içe ilerletmek sonucu değiştirmez
    const a = P.createWorld({ rules: 'quick', secs: 180, goals: 3, kick: 'blue', players: eightPlayers() })
    const b = P.cloneWorld(a)
    const solo = P.cloneWorld(a)
    const na = xorshift(9)
    const nb = xorshift(9)
    const ns = xorshift(9)
    let i = 0
    while (i < 3000) {
      P.step(a, bot(na)(a))
      P.step(b, bot(nb)(b))
      i++
    }
    run(solo, 3000, bot(ns))
    same(a, b)
    same(a, solo)
  })
})

describe('enerji ve hız sınırları', () => {
  test('girdisiz dünyada kinetik enerji hiçbir adımda artmaz', () => {
    let seed = 1
    while (seed <= 12) {
      const next = xorshift(seed)
      const rules = P.RULES[seed % 3]
      const w = playWorld({ rules: rules, players: eightPlayers() })
      const f = P.field(rules)
      w.players.forEach((p) => {
        put(p, unit(next) * (f.hw - 20), unit(next) * (f.hh - 20), unit(next) * 5, unit(next) * 5)
      })
      put(w.ball, unit(next) * (f.hw - 20), unit(next) * (f.hh - 20), unit(next) * 11, unit(next) * 11)
      let k = kinetic(w)
      let i = 0
      while (i < 900) {
        P.step(w, null)
        const now = kinetic(w)
        assert.ok(now <= k * (1 + 1e-12) + 1e-12, 'tohum ' + seed + ' adım ' + i + ': ' + k + ' -> ' + now)
        k = now
        i++
      }
      assert.ok(k < 1, 'sürtünmeyle durulur: ' + k)
      seed++
    }
  })

  test('çarpışmalar enerji üretmez: iki disk karşılaşmasında enerji azalır', () => {
    const w = playWorld()
    put(slot(w, 0), -40, 60, 4, 0)
    put(slot(w, 1), -8, 60, -4, 0)
    const k0 = kinetic(w)
    P.step(w, null)
    const lossFree = k0 * P.PLAYER_DAMP * P.PLAYER_DAMP
    assert.ok(kinetic(w) < lossFree, 'sekme katsayısı 1 altında')
  })

  test('uzun rastgele oyunda hız sınırları aşılmaz, top ve oyuncular sınırlarda kalır', () => {
    for (const rules of P.RULES) {
      for (const kind of ['bot', 'noise']) {
        const w = P.createWorld({ rules: rules, secs: 600, goals: 255, kick: 'red', players: eightPlayers() })
        const next = xorshift(rules.length * 31 + kind.length)
        const input = kind === 'noise' ? noise(next) : bot(next)
        let topBall = 0
        let topPlayer = 0
        let i = 0
        while (i < 8000) {
          P.step(w, input(w))
          checkBounds(w, rules + ' ' + kind)
          topBall = Math.max(topBall, speed(w.ball))
          w.players.forEach((p) => {
            topPlayer = Math.max(topPlayer, speed(p))
          })
          i++
        }
        assert.ok(topBall <= P.MAX_BALL_SPEED + EPS, rules + ' top ' + topBall)
        assert.ok(topPlayer <= P.MAX_PLAYER_SPEED + EPS, rules + ' oyuncu ' + topPlayer)
      }
    }
  })

  test('en hızlı top duran oyuncuya çarpınca oyuncu hız sınırında kalır', () => {
    const w = playWorld()
    const p = slot(w, 1)
    put(p, 100, 0)
    put(w.ball, 60, 0, P.MAX_BALL_SPEED, 0)
    run(w, 4, null)
    assert.ok(p.vx > 0)
    assert.ok(speed(p) <= P.MAX_PLAYER_SPEED + EPS)
    assert.ok(w.ball.x < p.x - P.PLAYER_R, 'top oyuncudan geçmedi')
  })
})

describe('kural motoruyla uyum', () => {
  // Ev sahibinin yaptığı gibi: kural motorunda maç başlar, fizik yuvalar ve başlayan takımla kurulur, fiziğin goal ve
  // time olayları hamle olarak kural motoruna verilir. İki taraf aynı skora, aynı başlayan takıma ve aynı sonuca varır.
  function match (rules, seed, secs) {
    const ctx = load({ rules: true })
    const H = ctx.TelsizHexball
    const Phys = ctx.TelsizHexballPhysics
    const ids = ['5', '12', '7', '30', '41', '8']
    const host = ids[0]
    const bytes = xorshift(seed)
    let s = H.newGame({ rules: rules, players: ids, dealSeat: 0 }).state
    s = H.applyMove(s, host, { t: 'kickoff' }, (n) => {
      const out = []
      while (out.length < n) out.push(bytes() & 255)
      return out
    }).state
    const owner = {}
    const players = s.seats.filter((id) => s.teams[id] !== 'spec').map((id) => {
      owner[s.slots[id]] = id
      return { slot: s.slots[id], side: s.teams[id] }
    })
    const w = Phys.createWorld({ rules: rules, secs: secs || H.PRESETS[rules].secs, goals: H.goalLimit(rules), kick: s.kick, players: players })
    const input = bot(xorshift(seed + 1000))
    const noRng = () => {
      throw new Error('rng çağrılmamalı')
    }
    const seen = []
    let i = 0
    while (w.phase !== 'over' && i < 200000) {
      Phys.step(w, input(w)).forEach((e) => {
        seen.push(e.e)
        if (e.e === 'goal') {
          const by = e.by === null ? null : owner[e.by]
          s = H.applyMove(s, host, { t: 'goal', mt: s.mt, side: e.side, by: by, at: e.at }, noRng).state
        } else if (e.e === 'time') {
          s = H.applyMove(s, host, { t: 'time', mt: s.mt }, noRng).state
        } else if (e.e === 'over') {
          assert.equal(s.ph, 'result')
          same(s.result, { winner: e.winner, why: e.why })
        }
        assert.ok(H.validateState(s))
      })
      same(s.score, w.score)
      assert.equal(s.golden, w.golden)
      if (s.ph === 'match') assert.equal(s.kick, w.kick)
      i++
    }
    assert.equal(w.phase, 'over')
    assert.equal(s.ph, 'result')
    return { seen: seen, result: plain(s.result), score: plain(s.score) }
  }

  test('quick ve classic: gol sınırı ya da süre', () => {
    const q = match('quick', 1)
    const c = match('classic', 2)
    for (const r of [q, c]) {
      assert.ok(['score', 'time', 'golden'].indexOf(r.result.why) >= 0)
      assert.ok(r.seen.indexOf('goal') >= 0)
      assert.ok(r.seen.indexOf('play') >= 0)
    }
  })

  test('kısa süreli long: süre biter, beraberlikte altın golle biter', () => {
    let golden = null
    let timed = null
    let seed = 1
    while (seed < 40 && (golden === null || timed === null)) {
      const r = match('long', seed, 4)
      if (r.result.why === 'golden' && golden === null) golden = r
      if (r.result.why === 'time' && timed === null) timed = r
      seed++
    }
    assert.ok(golden, 'altın golle biten maç bulundu')
    assert.ok(golden.seen.indexOf('golden') >= 0)
    assert.equal(Math.abs(golden.score.red - golden.score.blue), 1)
    assert.ok(timed, 'süreyle biten maç bulundu')
  })
})
