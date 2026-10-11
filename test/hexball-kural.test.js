'use strict'

// Hexball kural motoru (public/js/43-hexball-kural.js, window.TelsizHexball) testleri. Motor tarayıcıdaki gibi Node vm
// bağlamında, gerçek protokol çekirdeğiyle (public/js/33-oyun-protokol.js, window.TelsizGame) birlikte yüklenir.
// Sınananlar: genel uygulama sözleşmesi (Renk tasarımı 5.1), takım dengesi, ev sahibine özel hamleler, gol, skor ve
// gol sınırı, süre ve altın gol, ayrılma ve too_few, hata önceliği, düşmanca görünümün reddi, legalMoves ile
// applyMove uyumu, state gövdesi denetimi, saflık ve hamle adlarının masa yöneticisinin gecikmeli işlediği adlarla
// (last, catch) çakışmaması. Rastgelelik belirlenimcidir: seeded (xorshift32) düz Array döndürür. vm bağlamından
// dönen nesneler JSON kopyasıyla karşılaştırılır.

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..')
const HEX_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', '43-hexball-kural.js'), 'utf8')
const GAME_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', '33-oyun-protokol.js'), 'utf8')

// Motoru boş bir vm bağlamında yükler: yalnızca window, protokol çekirdeği ve motor (DOM, saat, ağ yok).
// core: false çekirdeği yüklemez (motorun çekirdeğe yalnızca çalışma anında eriştiğini sınamak için).
function loadEngine (opts) {
  const o = opts || {}
  const sandbox = vm.createContext({})
  sandbox.window = sandbox
  sandbox.self = sandbox
  if (o.core !== false) vm.runInContext(GAME_SRC, sandbox, { filename: '33-oyun-protokol.js' })
  vm.runInContext(HEX_SRC, sandbox, { filename: '43-hexball-kural.js' })
  return sandbox
}

const ENGINE = loadEngine()
const H = ENGINE.TelsizHexball
const CORE = ENGINE.TelsizGame
const IDS = ['5', '12', '7', '30', '41', '8', '19', '2', '77']
const [A, B, C, D, E] = IDS
const SIDES = ['red', 'blue', 'spec']
const TEAMS = ['red', 'blue']

// vm bağlamındaki nesnelerin ön örnekleri farklıdır, karşılaştırma JSON kopyasıyla yapılır
function same (actual, expected, message) {
  const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))
  assert.deepEqual(plain(actual), plain(expected), message)
}

function copy (x) {
  return JSON.parse(JSON.stringify(x))
}

// [from, to) aralığındaki tamsayılar
function range (from, to) {
  const out = []
  let i = from
  while (i < to) {
    out.push(i)
    i++
  }
  return out
}

// Fırlatılan hatanın kodu, hata yoksa null
function codeOf (fn) {
  try {
    fn()
  } catch (e) {
    return e.code === undefined ? 'no_code: ' + e.message : e.code
  }
  return null
}

function throwsCode (fn, code, message) {
  assert.equal(codeOf(fn), code, message)
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

// Tohumlu kaynak (xorshift32): n baytlık düz Array
function seeded (seed) {
  const next = xorshift(seed)
  return (n) => range(0, n).map(() => next() & 255)
}

// Kararlar için ayrı bir sayı üreteci: [0, m)
function chooser (seed) {
  const next = xorshift(seed)
  return (m) => next() % m
}

// Hiç çağrılmaması gereken kaynak
function noRng () {
  throw new Error('rng çağrılmamalıydı')
}

function deepFreeze (x) {
  if (x && typeof x === 'object') {
    Object.keys(x).forEach((key) => deepFreeze(x[key]))
    Object.freeze(x)
  }
  return x
}

// Durumun, görünümün, ellerin ve olayların denetimi: her başarılı adımda çağrılır
function checkAll (s, events) {
  assert.ok(H.validateState(s), 'validateState geçer: ' + JSON.stringify(s))
  const view = H.publicView(s)
  assert.ok(H.validateView(view, s.seats), 'validateView geçer')
  for (const id of s.seats) assert.ok(H.validatePrivate(H.privateView(s, id), view, id), 'validatePrivate geçer ' + id)
  for (const ev of events || []) {
    assert.ok(H.EVENTS.indexOf(ev.e) >= 0, 'olay ' + ev.e)
    assert.ok(CORE.isCode(ev.e), 'olay kodu ' + ev.e)
  }
}

// Yeni oyun: ilk n kimlik, ev sahibi A. Takımlar koltuk sırasıyla Kırmızı, Mavi, Kırmızı...
function game (n, rules) {
  const res = H.newGame({ rules: rules || 'classic', players: IDS.slice(0, n), dealSeat: 0 }, noRng)
  checkAll(res.state, res.events)
  return res.state
}

// Başarılı olması gereken hamle: yeni durum denetlenir, { state, events } döner
function apply (s, id, move, rng) {
  const res = H.applyMove(s, id, move, rng || seeded(1))
  checkAll(res.state, res.events)
  return res
}

function lastAt (s) {
  return s.goals.length ? s.goals[s.goals.length - 1].at : 0
}

// Maçta durum: n kişi, ev sahibi maçı başlatır
function match (n, rules, seed) {
  return apply(game(n, rules), A, { t: 'kickoff' }, seeded(seed || 1)).state
}

// Ev sahibinin gol hamlesi (varsayılan: topa dokunan bilinmiyor, saniye son golünki)
function goalMove (s, side, by, at) {
  return { t: 'goal', mt: s.mt, side, by: by === undefined ? null : by, at: at === undefined ? lastAt(s) : at }
}

function goal (s, side, by, at) {
  return apply(s, A, goalMove(s, side, by, at))
}

// Bir takıma art arda gol
function goals (s, side, n) {
  let x = s
  range(0, n).forEach(() => {
    x = goal(x, side).state
  })
  return x
}

function legal (s, id) {
  return H.legalMoves(H.publicView(s), H.privateView(s, id), id)
}

describe('sözleşme', () => {
  test('kimlik, sınırlar, kural setleri ve ön ayarlar', () => {
    assert.equal(H.id, 'hexball')
    assert.equal(H.VERSION, 1)
    assert.equal(H.MIN_PLAYERS, 2)
    assert.equal(H.MAX_PLAYERS, 8)
    same(H.RULES, ['quick', 'classic', 'long'])
    assert.equal(H.DEFAULT_RULES, 'classic')
    assert.equal(H.HIDDEN, false)
    same(H.PRESETS, { quick: { secs: 180, goals: 3 }, classic: { secs: 300, goals: 5 }, long: { secs: 600, goals: 0 } })
    same(H.TEAMS, TEAMS)
    same(H.SIDES, SIDES)
    same(H.PHASES, ['teams', 'match', 'result', 'over'])
    assert.equal(H.TEAM_MAX, 4)
    assert.equal(H.MAX_GOALS, 10)
    assert.equal(H.MAX_SCORE, 255)
    // Gol sınırı olmayan ön ayarda maç skor baytının sınırında biter
    same(H.RULES.map((r) => H.goalLimit(r)), [3, 5, 255])
  })

  test('dışa açılan nesne ve listeler dondurulmuştur, sözleşme işlevleri vardır', () => {
    assert.ok(Object.isFrozen(H))
    for (const key of ['RULES', 'ERRORS', 'EVENTS', 'DELAYED_MOVES', 'PRESETS', 'TEAMS', 'SIDES', 'PHASES']) {
      assert.ok(Object.isFrozen(H[key]), key)
    }
    for (const rules of H.RULES) assert.ok(Object.isFrozen(H.PRESETS[rules]), rules)
    for (const name of ['newGame', 'validateMove', 'applyMove', 'removePlayer', 'endGame', 'isOver', 'turnOf',
      'publicView', 'privateView', 'validateView', 'validatePrivate', 'legalMoves', 'validateState', 'validateOptions',
      'balanceTeams', 'countSides', 'goalLimit']) {
      assert.equal(typeof H[name], 'function', name)
    }
  })

  test('hamle adları last ve catch değildir, gecikmeli hamle yoktur', () => {
    // Masa yöneticisi ev sahibinin DELAYED_MOVES içindeki hamlelerini 300 ms gecikmeyle işler. Gol ve süre fizik
    // döngüsünden gelir, gecikmemelidir.
    same(H.DELAYED_MOVES, [])
    const samples = [
      { t: 'team', side: 'red' },
      { t: 'set', id: B, side: 'blue' },
      { t: 'kickoff' },
      { t: 'goal', mt: 1, side: 'red', by: null, at: 0 },
      { t: 'time', mt: 1 },
      { t: 'stop' }
    ]
    for (const m of samples) {
      assert.ok(H.validateMove(m), m.t)
      assert.ok(m.t !== 'last' && m.t !== 'catch')
    }
    for (const m of [{ t: 'last' }, { t: 'catch', p: B }, { t: 'catch' }, { t: 'last', side: 'red' }]) {
      assert.equal(H.validateMove(m), null, m.t)
    }
    const declared = Array.from(HEX_SRC.matchAll(/^ {4}([a-z]+): \['t'/gm), (m) => m[1])
    same(declared, ['team', 'set', 'kickoff', 'goal', 'time', 'stop'])
  })

  test('sıra yoktur: turnOf her aşamada null, legalMoves.turn hep false', () => {
    const s = game(3)
    const m = match(3)
    const r = apply(m, A, { t: 'stop' }).state
    const o = H.endGame(r).state
    for (const x of [s, m, r, o]) {
      assert.equal(H.turnOf(x), null, x.ph)
      for (const id of x.seats) assert.equal(legal(x, id).turn, false)
    }
  })
})

describe('seçenekler', () => {
  const ok = { rules: 'quick', players: [A, B, C], dealSeat: 2 }

  test('geçerli seçenekler kabul edilir, kopya döner', () => {
    const o = H.validateOptions(ok)
    same(o, ok)
    assert.notEqual(o.players, ok.players)
    for (const rules of H.RULES) assert.ok(H.validateOptions({ rules, players: [A, B], dealSeat: 0 }), rules)
  })

  test('geçersiz seçenekler bad_options döner', () => {
    const bad = [
      null,
      [],
      'x',
      { rules: 'quick', players: [A], dealSeat: 0 },
      { rules: 'quick', players: IDS.slice(0, 9), dealSeat: 0 },
      { rules: 'quick', players: [A, A], dealSeat: 0 },
      { rules: 'quick', players: [A, 12], dealSeat: 0 },
      { rules: 'quick', players: [A, '012'], dealSeat: 0 },
      { rules: 'fast', players: [A, B], dealSeat: 0 },
      { rules: 'official', players: [A, B], dealSeat: 0 },
      { rules: 'quick', players: [A, B], dealSeat: 2 },
      { rules: 'quick', players: [A, B], dealSeat: -1 },
      { rules: 'quick', players: [A, B], dealSeat: 0.5 },
      { rules: 'quick', players: [A, B] },
      { rules: 'quick', players: [A, B], dealSeat: 0, extra: 1 },
      { rules: 'quick', players: 'ab', dealSeat: 0 }
    ]
    for (const o of bad) {
      assert.equal(H.validateOptions(o), null, JSON.stringify(o))
      throwsCode(() => H.newGame(o, noRng), 'bad_options', JSON.stringify(o))
    }
  })

  test('yeni oyun rng kullanmaz, takımlar koltuk sırasıyla dengelenir, maç oynanmamıştır', () => {
    for (const n of range(2, 9)) {
      const players = IDS.slice(0, n)
      const res = H.newGame({ rules: 'classic', players, dealSeat: n - 1 }, noRng)
      const s = res.state
      checkAll(s, res.events)
      same(res.events, [])
      same(s.seats, players)
      const want = {}
      players.forEach((id, i) => {
        want[id] = i % 2 === 0 ? 'red' : 'blue'
      })
      same(s.teams, want, 'takımlar ' + n)
      same(H.countSides(s.teams), { red: Math.ceil(n / 2), blue: Math.floor(n / 2), spec: 0 })
      assert.equal(s.ph, 'teams')
      assert.equal(s.mt, 0)
      assert.equal(s.epoch, null)
      same(s.score, { red: 0, blue: 0 })
      same(s.slots, {})
      same(s.goals, [])
      assert.equal(s.kick, 'red')
      assert.equal(s.golden, false)
      assert.equal(s.result, null)
      assert.equal(H.isOver(s), false)
      // Seçeneklerdeki dizi durumla bağlantılı değildir
      players.push('99')
      assert.equal(s.seats.length, n)
    }
  })

  test('takım dengesi: takımı dolan kişi izleyici olur', () => {
    const ten = IDS.concat(['6'])
    same(H.balanceTeams(ten), { 5: 'red', 12: 'blue', 7: 'red', 30: 'blue', 41: 'red', 8: 'blue', 19: 'red', 2: 'blue', 77: 'spec', 6: 'spec' })
    same(H.countSides(H.balanceTeams(IDS)), { red: 4, blue: 4, spec: 1 })
    same(H.countSides(null), { red: 0, blue: 0, spec: 0 })
    same(H.countSides({ 5: 'red', 12: 'green', 7: 3 }), { red: 1, blue: 0, spec: 0 })
  })
})

describe('hamle biçimi', () => {
  test('validateMove geçerli hamleleri aynı alanlarla kopyalar', () => {
    const good = [
      { t: 'team', side: 'red' },
      { t: 'team', side: 'blue' },
      { t: 'team', side: 'spec' },
      { t: 'set', id: B, side: 'spec' },
      { t: 'kickoff' },
      { t: 'goal', mt: 1, side: 'blue', by: C, at: 125 },
      { t: 'goal', mt: H.MAX_MT, side: 'red', by: null, at: H.MAX_AT },
      { t: 'time', mt: 3 },
      { t: 'stop' }
    ]
    for (const m of good) {
      const out = H.validateMove(m)
      same(out, m)
      assert.notEqual(out, m)
    }
  })

  test('validateMove bozuk hamleleri reddeder', () => {
    const bad = [
      null,
      [],
      'kickoff',
      5,
      {},
      { t: 5 },
      { t: 'unknown' },
      { t: '__proto__' },
      { t: 'constructor' },
      { t: 'toString' },
      { t: 'kickoff', x: 1 },
      { t: 'stop', mt: 1 },
      { t: 'team' },
      { t: 'team', side: 'green' },
      { t: 'team', side: 'Red' },
      { t: 'team', side: 'red', id: B },
      { t: 'set', side: 'red' },
      { t: 'set', id: 12, side: 'red' },
      { t: 'set', id: 'abc', side: 'red' },
      { t: 'set', id: B, side: null },
      { t: 'goal', mt: 1, side: 'spec', by: null, at: 0 },
      { t: 'goal', mt: 1, side: 'red', by: 'x', at: 0 },
      { t: 'goal', mt: 1, side: 'red', by: 5, at: 0 },
      { t: 'goal', mt: 1, side: 'red', at: 0 },
      { t: 'goal', mt: 1, side: 'red', by: null, at: -1 },
      { t: 'goal', mt: 1, side: 'red', by: null, at: 1.5 },
      { t: 'goal', mt: 1, side: 'red', by: null, at: H.MAX_AT + 1 },
      { t: 'goal', mt: 0, side: 'red', by: null, at: 0 },
      { t: 'goal', mt: H.MAX_MT + 1, side: 'red', by: null, at: 0 },
      { t: 'goal', mt: '1', side: 'red', by: null, at: 0 },
      { t: 'goal', side: 'red', by: null, at: 0 },
      { t: 'time' },
      { t: 'time', mt: 0 },
      { t: 'time', mt: 1, step: 1 }
    ]
    for (const m of bad) assert.equal(H.validateMove(m), null, JSON.stringify(m))
  })
})

describe('takımlar', () => {
  test('herkes kendi takımını seçer, olay kişiyi, takımı ve yapanı taşır', () => {
    const s = game(3)
    const res = apply(s, B, { t: 'team', side: 'red' })
    assert.equal(res.state.teams[B], 'red')
    same(res.events, [{ e: 'team', p: B, side: 'red', by: B }])
    const spec = apply(res.state, A, { t: 'team', side: 'spec' })
    assert.equal(spec.state.teams[A], 'spec')
    same(H.countSides(spec.state.teams), { red: 2, blue: 0, spec: 1 })
  })

  test('takım başına en çok 4 kişi, izleyici sınırsız', () => {
    let s = game(8)
    same(H.countSides(s.teams), { red: 4, blue: 4, spec: 0 })
    throwsCode(() => H.applyMove(s, B, { t: 'team', side: 'red' }, noRng), 'team_full')
    throwsCode(() => H.applyMove(s, A, { t: 'set', id: B, side: 'red' }, noRng), 'team_full')
    for (const id of s.seats.slice(1)) s = apply(s, id, { t: 'team', side: 'spec' }).state
    same(H.countSides(s.teams), { red: 1, blue: 0, spec: 7 })
    s = apply(s, B, { t: 'team', side: 'red' }).state
    s = apply(s, C, { t: 'team', side: 'red' }).state
    s = apply(s, D, { t: 'team', side: 'red' }).state
    throwsCode(() => H.applyMove(s, E, { t: 'team', side: 'red' }, noRng), 'team_full')
    s = apply(s, A, { t: 'set', id: E, side: 'blue' }).state
    same(H.countSides(s.teams), { red: 4, blue: 1, spec: 3 })
  })

  test('aynı takımı yeniden seçmek durumu değiştirmez ve olay üretmez, takımı dolu olsa bile', () => {
    const s = game(8)
    const res = apply(s, B, { t: 'team', side: 'blue' })
    same(res.state, s)
    same(res.events, [])
    assert.notEqual(res.state, s)
    same(apply(s, A, { t: 'set', id: C, side: 'red' }).events, [])
  })

  test('set yalnızca ev sahibine açıktır, bilinmeyen kişi bad_player, ev sahibi kendini de taşır', () => {
    const s = game(3)
    throwsCode(() => H.applyMove(s, B, { t: 'set', id: C, side: 'blue' }, noRng), 'not_host')
    throwsCode(() => H.applyMove(s, B, { t: 'set', id: B, side: 'red' }, noRng), 'not_host')
    throwsCode(() => H.applyMove(s, A, { t: 'set', id: '99', side: 'blue' }, noRng), 'bad_player')
    const res = apply(s, A, { t: 'set', id: C, side: 'blue' })
    same(res.events, [{ e: 'team', p: C, side: 'blue', by: A }])
    const self = apply(res.state, A, { t: 'set', id: A, side: 'spec' })
    assert.equal(self.state.teams[A], 'spec')
  })

  test('maçta takım değişmez, maç bitince değişebilir', () => {
    const m = match(3)
    throwsCode(() => H.applyMove(m, B, { t: 'team', side: 'red' }, noRng), 'bad_phase')
    throwsCode(() => H.applyMove(m, A, { t: 'set', id: B, side: 'red' }, noRng), 'bad_phase')
    // Maçta kendi takımını "yeniden seçmek" de aşama hatasıdır
    throwsCode(() => H.applyMove(m, B, { t: 'team', side: 'blue' }, noRng), 'bad_phase')
    const r = apply(m, A, { t: 'stop' }).state
    const res = apply(r, B, { t: 'team', side: 'red' })
    assert.equal(res.state.ph, 'result')
    assert.equal(res.state.teams[B], 'red')
  })
})

describe('maçı başlatma', () => {
  test('yalnızca ev sahibi başlatır, her takımda en az bir kişi gerekir', () => {
    const s = game(3)
    throwsCode(() => H.applyMove(s, B, { t: 'kickoff' }, noRng), 'not_host')
    const noBlue = apply(s, B, { t: 'team', side: 'spec' }).state
    throwsCode(() => H.applyMove(noBlue, A, { t: 'kickoff' }, noRng), 'teams_empty')
    const noRed = apply(apply(s, A, { t: 'team', side: 'blue' }).state, C, { t: 'team', side: 'spec' }).state
    same(H.countSides(noRed.teams), { red: 0, blue: 2, spec: 1 })
    throwsCode(() => H.applyMove(noRed, A, { t: 'kickoff' }, noRng), 'teams_empty')
    // Ev sahibi izleyici olsa da başlatır, yuvası olmaz
    const hostSpec = apply(game(3), A, { t: 'team', side: 'spec' }).state
    const ok = apply(hostSpec, A, { t: 'kickoff' }).state
    assert.equal(ok.ph, 'match')
    same(ok.slots, { [B]: 0, [C]: 1 })
  })

  test('yeni maç kimliği rng ile üretilir, yuvalar koltuk sırasıyla yalnızca takımdakilere verilir', () => {
    const s = apply(game(5), C, { t: 'team', side: 'spec' }).state
    const res = apply(s, A, { t: 'kickoff' }, seeded(42))
    const m = res.state
    assert.equal(m.ph, 'match')
    assert.equal(m.mt, 1)
    assert.equal(m.epoch, CORE.randomHex16(seeded(42)))
    assert.match(m.epoch, /^[0-9a-f]{16}$/)
    same(m.slots, { [A]: 0, [B]: 1, [D]: 2, [E]: 3 })
    assert.equal(m.kick, 'red')
    same(m.score, { red: 0, blue: 0 })
    same(res.events, [{ e: 'kickoff', mt: 1, kick: 'red' }])
    same(m.teams, s.teams)
    // Farklı kaynak farklı kimlik verir
    assert.notEqual(apply(s, A, { t: 'kickoff' }, seeded(43)).state.epoch, m.epoch)
  })

  test('Tekrar Oyna: maç bitince aynı takımlarla yeni maç, yeni kimlik, sıfır skor, sırayla Kırmızı ve Mavi başlar', () => {
    let s = match(4, 'quick', 1)
    const first = s.epoch
    s = goals(s, 'red', 1)
    s = goals(s, 'blue', 3)
    assert.equal(s.ph, 'result')
    s = apply(s, B, { t: 'team', side: 'red' }).state
    const res = apply(s, A, { t: 'kickoff' }, seeded(2))
    const m = res.state
    assert.equal(m.mt, 2)
    assert.notEqual(m.epoch, first)
    assert.equal(m.kick, 'blue')
    same(m.score, { red: 0, blue: 0 })
    same(m.goals, [])
    assert.equal(m.result, null)
    assert.equal(m.golden, false)
    assert.equal(m.teams[B], 'red')
    same(m.slots, { [A]: 0, [B]: 1, [C]: 2, [D]: 3 })
    same(res.events, [{ e: 'kickoff', mt: 2, kick: 'blue' }])
    const third = apply(apply(m, A, { t: 'stop' }).state, A, { t: 'kickoff' }, seeded(3)).state
    assert.equal(third.mt, 3)
    assert.equal(third.kick, 'red')
  })

  test('kaynak hatası: fırlatan kaynak no_random, kısa ya da bozuk kaynak bad_random, durum değişmez', () => {
    const s = deepFreeze(game(2))
    const before = copy(s)
    throwsCode(() => H.applyMove(s, A, { t: 'kickoff' }, noRng), 'no_random')
    throwsCode(() => H.applyMove(s, A, { t: 'kickoff' }, () => [1, 2]), 'bad_random')
    throwsCode(() => H.applyMove(s, A, { t: 'kickoff' }, (n) => range(0, n).map(() => 300)), 'bad_random')
    same(s, before)
  })

  test('maç sürerken başlatma bad_phase, maç numarası sınırdaysa bad_phase', () => {
    const m = match(2)
    throwsCode(() => H.applyMove(m, A, { t: 'kickoff' }, seeded(1)), 'bad_phase')
    const r = copy(apply(m, A, { t: 'stop' }).state)
    r.mt = H.MAX_MT
    assert.ok(H.validateState(r))
    throwsCode(() => H.applyMove(r, A, { t: 'kickoff' }, seeded(1)), 'bad_phase')
    assert.equal(legal(r, A).kickoff, false)
    assert.equal(legal(r, A).kickoffWhy, 'bad_phase')
  })
})

describe('gol ve skor', () => {
  test('gol skoru artırır, son goller listesine girer, gol yiyen takım başlar', () => {
    const m = match(4)
    const res = goal(m, 'red', A, 12)
    const s = res.state
    same(s.score, { red: 1, blue: 0 })
    same(s.goals, [{ side: 'red', by: A, own: false, at: 12 }])
    assert.equal(s.kick, 'blue')
    same(res.events, [{ e: 'goal', side: 'red', p: A, at: 12 }])
    const res2 = goal(s, 'blue', D, 40)
    same(res2.state.score, { red: 1, blue: 1 })
    assert.equal(res2.state.kick, 'red')
    same(res2.state.goals.map((x) => x.at), [12, 40])
  })

  test('kendi kalesine gol: topa son dokunanın takımı golü kazanan takım değilse', () => {
    const m = match(4)
    const res = goal(m, 'blue', A, 3)
    same(res.state.score, { red: 0, blue: 1 })
    same(res.state.goals, [{ side: 'blue', by: A, own: true, at: 3 }])
    same(res.events, [{ e: 'own_goal', side: 'blue', p: A, at: 3 }])
    assert.equal(res.state.kick, 'red')
  })

  test('topa dokunan bilinmiyorsa by null, izleyici ve koltukta olmayan kişi bad_player', () => {
    const s = apply(game(3), C, { t: 'team', side: 'spec' }).state
    const m = apply(s, A, { t: 'kickoff' }).state
    const res = goal(m, 'red', null, 5)
    same(res.state.goals, [{ side: 'red', by: null, own: false, at: 5 }])
    same(res.events, [{ e: 'goal', side: 'red', p: null, at: 5 }])
    throwsCode(() => H.applyMove(m, A, goalMove(m, 'red', C, 5), noRng), 'bad_player')
    throwsCode(() => H.applyMove(m, A, goalMove(m, 'red', '99', 5), noRng), 'bad_player')
  })

  test('golün saniyesi önceki golünkinden küçük olamaz, eşit olabilir', () => {
    const s = goal(match(2), 'red', A, 30).state
    throwsCode(() => H.applyMove(s, A, goalMove(s, 'blue', B, 29), noRng), 'bad_move')
    same(goal(s, 'blue', B, 30).state.score, { red: 1, blue: 1 })
  })

  test('gol sınırına ulaşan takım kazanır: Hızlı 3, Klasik 5', () => {
    for (const [rules, limit] of [['quick', 3], ['classic', 5]]) {
      let s = match(2, rules)
      s = goals(s, 'blue', limit - 1)
      s = goals(s, 'red', limit - 1)
      assert.equal(s.ph, 'match')
      const res = goal(s, 'blue', B, lastAt(s) + 1)
      assert.equal(res.state.ph, 'result')
      same(res.state.result, { winner: 'blue', why: 'score' })
      same(res.state.slots, {})
      same(res.events, [{ e: 'goal', side: 'blue', p: B, at: lastAt(s) + 1 }, { e: 'win', side: 'blue', why: 'score' }])
      assert.equal(H.isOver(res.state), false)
      throwsCode(() => H.applyMove(res.state, A, goalMove(res.state, 'red'), noRng), 'bad_phase')
    }
  })

  test('Uzun ön ayarda gol sınırı yoktur: maç 255. golde biter, listede son 10 gol tutulur', () => {
    let s = match(2, 'long')
    range(0, 254).forEach((i) => {
      s = goal(s, i % 3 === 0 ? 'blue' : 'red', null, i).state
    })
    assert.equal(s.ph, 'match')
    assert.equal(s.goals.length, 10)
    same(s.goals.map((x) => x.at), range(244, 254))
    assert.equal(s.score.red + s.score.blue, 254)
    s = goals(s, 'red', 255 - s.score.red - 1)
    assert.equal(s.score.red, 254)
    const res = goal(s, 'red', null, 300)
    same(res.state.result, { winner: 'red', why: 'score' })
    assert.equal(res.state.score.red, 255)
  })

  test('yalnızca ev sahibi gol bildirir, maç dışında bad_phase, eski maçın golü stale', () => {
    const m = match(3)
    throwsCode(() => H.applyMove(m, B, goalMove(m, 'blue', B, 1), noRng), 'not_host')
    throwsCode(() => H.applyMove(m, A, { t: 'goal', mt: 2, side: 'red', by: null, at: 0 }, noRng), 'stale')
    const s = game(3)
    throwsCode(() => H.applyMove(s, A, { t: 'goal', mt: 1, side: 'red', by: null, at: 0 }, noRng), 'bad_phase')
    const r = apply(m, A, { t: 'stop' }).state
    const m2 = apply(r, A, { t: 'kickoff' }, seeded(9)).state
    throwsCode(() => H.applyMove(m2, A, { t: 'goal', mt: 1, side: 'red', by: null, at: 0 }, noRng), 'stale')
  })
})

describe('süre ve altın gol', () => {
  test('süre bitince önde olan kazanır', () => {
    let s = match(3, 'classic')
    s = goals(s, 'blue', 2)
    s = goals(s, 'red', 1)
    const res = apply(s, A, { t: 'time', mt: s.mt })
    assert.equal(res.state.ph, 'result')
    same(res.state.result, { winner: 'blue', why: 'time' })
    same(res.events, [{ e: 'time_up' }, { e: 'win', side: 'blue', why: 'time' }])
    assert.equal(res.state.golden, false)
    same(res.state.slots, {})
  })

  test('beraberlikte altın gol başlar, ilk gol maçı bitirir, altın golde süre yeniden bitmez', () => {
    let s = match(4, 'classic')
    s = goals(s, 'red', 2)
    s = goals(s, 'blue', 2)
    const res = apply(s, A, { t: 'time', mt: s.mt })
    const g = res.state
    assert.equal(g.ph, 'match')
    assert.equal(g.golden, true)
    same(res.events, [{ e: 'time_up' }, { e: 'golden' }])
    same(g.slots, s.slots)
    throwsCode(() => H.applyMove(g, A, { t: 'time', mt: g.mt }, noRng), 'bad_phase')
    assert.equal(legal(g, A).time, false)
    assert.equal(legal(g, A).goal, true)
    const end = goal(g, 'blue', D, 301)
    same(end.state.result, { winner: 'blue', why: 'golden' })
    same(end.state.score, { red: 2, blue: 3 })
    same(end.events, [{ e: 'goal', side: 'blue', p: D, at: 301 }, { e: 'win', side: 'blue', why: 'golden' }])
    assert.equal(end.state.golden, true)
  })

  test('0-0 beraberlikte de altın gol oynanır, kendi kalesine altın gol karşı takımı kazandırır', () => {
    const m = match(2, 'quick')
    const g = apply(m, A, { t: 'time', mt: m.mt }).state
    assert.equal(g.golden, true)
    const end = goal(g, 'blue', A, 181)
    same(end.state.result, { winner: 'blue', why: 'golden' })
    same(end.events[0], { e: 'own_goal', side: 'blue', p: A, at: 181 })
  })

  test('altın golde ev sahibi maçı durdurursa kazanan yoktur ve skor eşit kalır', () => {
    const m = match(2)
    const g = apply(m, A, { t: 'time', mt: m.mt }).state
    const res = apply(g, A, { t: 'stop' })
    same(res.state.result, { winner: null, why: 'host' })
    assert.equal(res.state.golden, true)
  })

  test('yalnızca ev sahibi, maç dışında bad_phase, eski maçın süre bitti hamlesi stale', () => {
    const m = match(3)
    throwsCode(() => H.applyMove(m, B, { t: 'time', mt: m.mt }, noRng), 'not_host')
    throwsCode(() => H.applyMove(m, A, { t: 'time', mt: m.mt + 1 }, noRng), 'stale')
    throwsCode(() => H.applyMove(game(3), A, { t: 'time', mt: 1 }, noRng), 'bad_phase')
    const r = apply(m, A, { t: 'stop' }).state
    throwsCode(() => H.applyMove(r, A, { t: 'time', mt: r.mt }, noRng), 'bad_phase')
  })
})

describe('durdurma ve bitiş', () => {
  test('stop: maç kazanansız biter, masa sürer, Tekrar Oyna açılır', () => {
    const m = goal(match(3), 'red', A, 10).state
    throwsCode(() => H.applyMove(m, B, { t: 'stop' }, noRng), 'not_host')
    const res = apply(m, A, { t: 'stop' })
    assert.equal(res.state.ph, 'result')
    same(res.state.result, { winner: null, why: 'host' })
    same(res.events, [{ e: 'stop', why: 'host' }])
    same(res.state.score, { red: 1, blue: 0 })
    assert.equal(H.isOver(res.state), false)
    assert.equal(legal(res.state, A).kickoff, true)
    throwsCode(() => H.applyMove(res.state, A, { t: 'stop' }, noRng), 'bad_phase')
    throwsCode(() => H.applyMove(game(2), A, { t: 'stop' }, noRng), 'bad_phase')
  })

  test('endGame: takım seçiminde ve maçta kazanansız biter, maç sonunda sonuç korunur', () => {
    const fromTeams = H.endGame(game(3))
    checkAll(fromTeams.state, fromTeams.events)
    assert.equal(fromTeams.state.ph, 'over')
    same(fromTeams.state.result, { winner: null, why: 'host' })
    same(fromTeams.events, [{ e: 'stop', why: 'host' }])
    assert.equal(H.isOver(fromTeams.state), true)

    const m = goal(match(3), 'blue', B, 7).state
    const fromMatch = H.endGame(m)
    checkAll(fromMatch.state, fromMatch.events)
    same(fromMatch.state.result, { winner: null, why: 'host' })
    same(fromMatch.state.slots, {})
    same(fromMatch.state.score, { red: 0, blue: 1 })

    const won = goals(match(2, 'quick'), 'red', 3)
    const fromResult = H.endGame(won)
    checkAll(fromResult.state, fromResult.events)
    same(fromResult.state.result, { winner: 'red', why: 'score' })
    same(fromResult.events, [])
    assert.equal(fromResult.state.ph, 'over')
  })

  test('bitmiş masada her hamle ve endGame game_over döner', () => {
    const o = H.endGame(match(3)).state
    for (const m of [{ t: 'team', side: 'red' }, { t: 'kickoff' }, { t: 'stop' }, { t: 'nope' }, null]) {
      throwsCode(() => H.applyMove(o, A, m, noRng), 'game_over')
      throwsCode(() => H.applyMove(o, '99', m, noRng), 'game_over')
    }
    throwsCode(() => H.endGame(o), 'game_over')
  })
})

describe('ayrılma', () => {
  test('ayrılan kişi koltuklardan ve takımlardan çıkar, olay leave, rng kullanılmaz', () => {
    const s = game(4)
    const res = H.removePlayer(s, C, noRng)
    checkAll(res.state, res.events)
    same(res.state.seats, [A, B, D])
    same(res.state.teams, { [A]: 'red', [B]: 'blue', [D]: 'blue' })
    same(res.events, [{ e: 'leave', p: C }])
    assert.equal(res.state.ph, 'teams')
  })

  test('ev sahibi ve koltukta olmayan kişi çıkarılamaz', () => {
    const s = game(3)
    throwsCode(() => H.removePlayer(s, A, noRng), 'bad_player')
    throwsCode(() => H.removePlayer(s, '99', noRng), 'bad_player')
  })

  test('iki kişinin altına düşülürse masa too_few ile biter', () => {
    const t = H.removePlayer(game(2), B, noRng)
    checkAll(t.state, t.events)
    assert.equal(t.state.ph, 'over')
    same(t.state.result, { winner: null, why: 'too_few' })
    same(t.events, [{ e: 'leave', p: B }, { e: 'stop', why: 'too_few' }])
    assert.equal(H.isOver(t.state), true)

    const m = H.removePlayer(goal(match(2), 'red', A, 4).state, B, noRng)
    checkAll(m.state, m.events)
    assert.equal(m.state.ph, 'over')
    same(m.state.result, { winner: null, why: 'too_few' })
    same(m.state.slots, {})
    same(m.state.score, { red: 1, blue: 0 })
  })

  test('maç bittikten sonra iki kişinin altına düşülürse sonuç korunur', () => {
    const won = goals(match(2, 'quick'), 'blue', 3)
    const res = H.removePlayer(won, B, noRng)
    checkAll(res.state, res.events)
    assert.equal(res.state.ph, 'over')
    same(res.state.result, { winner: 'blue', why: 'score' })
    same(res.events, [{ e: 'leave', p: B }])
  })

  test('maçta takımı boşalan maç kazanansız biter, masa sürer', () => {
    const m = goal(match(3), 'blue', B, 9).state
    const res = H.removePlayer(m, B, noRng)
    checkAll(res.state, res.events)
    assert.equal(res.state.ph, 'result')
    same(res.state.result, { winner: null, why: 'too_few' })
    same(res.events, [{ e: 'leave', p: B }, { e: 'stop', why: 'too_few' }])
    same(res.state.slots, {})
    assert.equal(H.isOver(res.state), false)
    // Kalanlar takım seçip yeniden başlayabilir
    const again = apply(apply(res.state, C, { t: 'team', side: 'blue' }).state, A, { t: 'kickoff' }).state
    same(again.slots, { [A]: 0, [C]: 1 })
  })

  test('maçta takım boşalmazsa maç sürer, yalnızca ayrılanın yuvası silinir', () => {
    const m = match(5)
    same(m.slots, { [A]: 0, [B]: 1, [C]: 2, [D]: 3, [E]: 4 })
    const res = H.removePlayer(m, C, noRng)
    checkAll(res.state, res.events)
    assert.equal(res.state.ph, 'match')
    same(res.state.slots, { [A]: 0, [B]: 1, [D]: 3, [E]: 4 })
    same(res.events, [{ e: 'leave', p: C }])
    // İzleyicinin ayrılması maçı etkilemez
    const spec = apply(game(4), D, { t: 'team', side: 'spec' }).state
    const m2 = apply(spec, A, { t: 'kickoff' }).state
    const res2 = H.removePlayer(m2, D, noRng)
    assert.equal(res2.state.ph, 'match')
    same(res2.state.slots, m2.slots)
  })

  test('bitmiş masada koltuk silinir, sonuç değişmez', () => {
    const o = H.endGame(match(3)).state
    const res = H.removePlayer(o, C, noRng)
    checkAll(res.state, res.events)
    same(res.state.seats, [A, B])
    same(res.state.result, o.result)
    same(res.events, [{ e: 'leave', p: C }])
    const last = H.removePlayer(res.state, B, noRng)
    checkAll(last.state, last.events)
    same(last.state.seats, [A])
    same(last.state.result, o.result)
  })
})

describe('hata önceliği', () => {
  test('bitiş, biçim, oyuncu, ev sahibi, aşama, maç numarası, ardından hamleye özgü denetim', () => {
    const s = game(8)
    const m = match(8)
    const o = H.endGame(s).state
    throwsCode(() => H.applyMove(o, '99', { t: 'nope' }, noRng), 'game_over')
    throwsCode(() => H.applyMove(s, '99', { t: 'nope' }, noRng), 'bad_move')
    throwsCode(() => H.applyMove(s, '99', { t: 'kickoff' }, noRng), 'bad_player')
    throwsCode(() => H.applyMove(s, B, { t: 'goal', mt: 5, side: 'red', by: '99', at: 0 }, noRng), 'not_host')
    throwsCode(() => H.applyMove(s, A, { t: 'goal', mt: 5, side: 'red', by: '99', at: 0 }, noRng), 'bad_phase')
    throwsCode(() => H.applyMove(m, A, { t: 'goal', mt: 5, side: 'red', by: '99', at: 0 }, noRng), 'stale')
    throwsCode(() => H.applyMove(m, A, { t: 'goal', mt: 1, side: 'red', by: '99', at: 0 }, noRng), 'bad_player')
    // Takım değişikliğinde aşama, takım doluluğundan önce
    throwsCode(() => H.applyMove(m, B, { t: 'team', side: 'red' }, noRng), 'bad_phase')
    throwsCode(() => H.applyMove(s, B, { t: 'team', side: 'red' }, noRng), 'team_full')
    // set: ev sahibi, aşama, kişi, takım doluluğu
    throwsCode(() => H.applyMove(m, B, { t: 'set', id: '99', side: 'red' }, noRng), 'not_host')
    throwsCode(() => H.applyMove(m, A, { t: 'set', id: '99', side: 'red' }, noRng), 'bad_phase')
    throwsCode(() => H.applyMove(s, A, { t: 'set', id: '99', side: 'red' }, noRng), 'bad_player')
    throwsCode(() => H.applyMove(s, A, { t: 'set', id: B, side: 'red' }, noRng), 'team_full')
    // kickoff: aşama, takımlar, rastgelelik
    throwsCode(() => H.applyMove(m, A, { t: 'kickoff' }, noRng), 'bad_phase')
    const empty = apply(s, A, { t: 'team', side: 'spec' }).state
    const lone = [C, E, '19'].reduce((x, id) => apply(x, id, { t: 'team', side: 'spec' }).state, empty)
    throwsCode(() => H.applyMove(lone, A, { t: 'kickoff' }, noRng), 'teams_empty')
    throwsCode(() => H.applyMove(s, A, { t: 'kickoff' }, noRng), 'no_random')
  })

  test('hata fırlatılınca girdi değişmez', () => {
    const states = [game(8), match(4), apply(match(2), A, { t: 'stop' }).state, H.endGame(game(2)).state]
    const tries = [
      [A, { t: 'nope' }],
      ['99', { t: 'team', side: 'red' }],
      [B, { t: 'team', side: 'red' }],
      [B, { t: 'kickoff' }],
      [A, { t: 'goal', mt: 9, side: 'red', by: null, at: 0 }],
      [A, { t: 'time', mt: 9 }],
      [A, { t: 'set', id: '99', side: 'red' }]
    ]
    for (const s of states) {
      deepFreeze(s)
      const before = copy(s)
      for (const [id, move] of tries) {
        const code = codeOf(() => H.applyMove(s, id, move, noRng))
        if (code !== null) assert.ok(H.ERRORS.indexOf(code) >= 0, code)
      }
      codeOf(() => H.removePlayer(s, '99', noRng))
      codeOf(() => H.removePlayer(s, A, noRng))
      same(s, before)
    }
  })
})

// Görünüm denetimi için örnek durumlar: her aşama ve her sonuç nedeni
function sampleStates () {
  const teams = apply(game(5), C, { t: 'team', side: 'spec' }).state
  const m = apply(teams, A, { t: 'kickoff' }).state
  const scored = goal(goal(goal(m, 'red', A, 10).state, 'blue', A, 20).state, 'blue', B, 31).state
  const level = goal(scored, 'red', E, 40).state
  const golden = apply(level, A, { t: 'time', mt: level.mt }).state
  return {
    teams,
    match: scored,
    golden,
    time: apply(scored, A, { t: 'time', mt: scored.mt }).state,
    score: goals(match(2, 'quick'), 'red', 3),
    goldenWin: goal(golden, 'red', A, 305).state,
    host: apply(scored, A, { t: 'stop' }).state,
    leftAfter: H.removePlayer(apply(match(3), A, { t: 'stop' }).state, B, noRng).state,
    teamGone: H.removePlayer(match(3), B, noRng).state,
    over: H.endGame(scored).state,
    overTeams: H.endGame(game(2)).state,
    overTooFew: H.removePlayer(game(2), B, noRng).state
  }
}

describe('görünümler', () => {
  test('publicView tam durumun bağlantısız kopyasıdır', () => {
    const s = sampleStates().match
    const view = H.publicView(s)
    same(view, s)
    assert.notEqual(view, s)
    for (const key of ['seats', 'teams', 'slots', 'score', 'goals']) assert.notEqual(view[key], s[key], key)
    view.teams[A] = 'spec'
    view.goals[0].at = 999
    view.seats.push('99')
    assert.equal(s.teams[A], 'red')
    assert.equal(s.goals[0].at, 10)
    assert.equal(s.seats.length, 5)
  })

  test('privateView koltuktaki kişiye boş nesne, koltukta olmayana null verir', () => {
    const s = game(3)
    for (const id of s.seats) same(H.privateView(s, id), {})
    assert.equal(H.privateView(s, '99'), null)
  })

  test('validateView her aşamayı ve her sonuç nedenini kabul eder', () => {
    const all = sampleStates()
    same(Object.keys(all).map((k) => all[k].ph), ['teams', 'match', 'match', 'result', 'result', 'result', 'result',
      'result', 'result', 'over', 'over', 'over'])
    same(Object.keys(all).filter((k) => all[k].result).map((k) => all[k].result.why), ['time', 'score', 'golden',
      'host', 'host', 'too_few', 'host', 'host', 'too_few'])
    for (const key of Object.keys(all)) {
      const v = copy(H.publicView(all[key]))
      assert.ok(H.validateView(v, v.seats.slice()), key)
      assert.equal(H.validateView(v, v.seats.slice()), v)
    }
  })

  test('validateView düşmanca ve tutarsız görünümleri reddeder', () => {
    const all = sampleStates()
    const cases = [
      ['teams', (v) => { v.extra = 1 }],
      ['teams', (v) => { delete v.kick }],
      ['teams', (v) => { v.v = 2 }],
      ['teams', (v) => { v.rules = 'official' }],
      ['teams', (v) => { v.ph = 'play' }],
      ['teams', (v) => { v.seats = v.seats.concat([v.seats[0]]) }],
      ['teams', (v) => { v.seats = [] }],
      ['teams', (v) => { v.seats = [12] }],
      ['teams', (v) => { v.teams[A] = 'green' }],
      ['teams', (v) => { delete v.teams[B] }],
      ['teams', (v) => { v.teams['99'] = 'red' }],
      ['teams', (v) => { v.teams = JSON.parse('{"__proto__":"red"}') }],
      ['teams', (v) => { v.teams = [] }],
      ['teams', (v) => { v.mt = 1 }],
      ['teams', (v) => { v.mt = -1 }],
      ['teams', (v) => { v.epoch = '0123456789abcdef' }],
      ['teams', (v) => { v.kick = 'spec' }],
      ['teams', (v) => { v.golden = true }],
      ['teams', (v) => { v.golden = 'no' }],
      ['teams', (v) => { v.score.red = 1 }],
      ['teams', (v) => { v.slots[A] = 0 }],
      ['teams', (v) => { v.result = { winner: null, why: 'host' } }],
      ['match', (v) => { v.epoch = null }],
      ['match', (v) => { v.epoch = '0123456789ABCDEF' }],
      ['match', (v) => { v.mt = 1.5 }],
      ['match', (v) => { v.score.red = -1 }],
      ['match', (v) => { v.score.red = 256 }],
      ['match', (v) => { v.score.green = 0 }],
      ['match', (v) => { v.score = [1, 2] }],
      ['match', (v) => { v.score.blue = 1 }],
      ['match', (v) => { v.goals.pop() }],
      ['match', (v) => { v.goals[0].side = 'spec' }],
      ['match', (v) => { v.goals[0].side = 'blue' }],
      ['match', (v) => { v.goals[0].by = 'abc' }],
      ['match', (v) => { v.goals[1].by = null }],
      ['match', (v) => { v.goals[0].own = 'no' }],
      ['match', (v) => { v.goals[0].extra = 1 }],
      ['match', (v) => { v.goals[2].at = 5 }],
      ['match', (v) => { v.goals[0].at = -1 }],
      ['match', (v) => { v.goals = {} }],
      ['match', (v) => { delete v.slots[A] }],
      ['match', (v) => { v.slots[C] = 5 }],
      ['match', (v) => { v.slots[B] = v.slots[A] }],
      ['match', (v) => { v.slots[A] = 8 }],
      ['match', (v) => { v.slots[A] = '0' }],
      ['match', (v) => { v.result = { winner: 'blue', why: 'time' } }],
      ['match', (v) => { v.golden = true }],
      ['match', (v) => {
        v.teams[B] = 'spec'
        v.teams[D] = 'spec'
        delete v.slots[B]
        delete v.slots[D]
      }],
      ['golden', (v) => {
        v.goals.pop()
        v.score.red = 1
      }],
      ['time', (v) => { v.result = null }],
      ['time', (v) => { v.result.winner = 'red' }],
      ['time', (v) => { v.result.winner = null }],
      ['time', (v) => { v.result.why = 'score' }],
      ['time', (v) => { v.result.why = 'golden' }],
      ['time', (v) => { v.result.why = 'ended' }],
      ['time', (v) => { v.result.extra = 1 }],
      ['time', (v) => { v.golden = true }],
      ['time', (v) => { v.slots[A] = 0 }],
      ['score', (v) => {
        v.score.red = 2
        v.goals.pop()
      }],
      ['score', (v) => { v.rules = 'classic' }],
      ['goldenWin', (v) => { v.golden = false }],
      ['goldenWin', (v) => {
        v.score.red = 4
        v.goals.push({ side: 'red', by: null, own: false, at: 306 })
      }],
      ['host', (v) => { v.result.winner = 'blue' }],
      ['host', (v) => { v.result = null }],
      ['over', (v) => { v.result = null }],
      ['over', (v) => { v.ph = 'teams' }],
      ['overTeams', (v) => { v.result = { winner: 'red', why: 'time' } }],
      ['overTeams', (v) => {
        v.seats = []
        v.teams = {}
      }]
    ]
    for (const [key, fn] of cases) {
      const v = copy(H.publicView(all[key]))
      fn(v)
      // Koltuk listesi bozulsa bile sıra denetimi değil, durum denetimi reddetmelidir
      assert.equal(H.validateView(v, Array.isArray(v.seats) ? v.seats.slice() : []), null, key + ': ' + fn.toString())
    }
    // Takım başına en çok 4 kişi
    const five = copy(H.publicView(game(8)))
    five.teams[B] = 'red'
    assert.equal(H.validateView(five, five.seats.slice()), null)
    // Koltuk sırası masanınkiyle aynı olmalıdır
    const v = copy(H.publicView(all.teams))
    assert.equal(H.validateView(v, v.seats.slice().reverse()), null)
    assert.equal(H.validateView(v, v.seats.slice(1)), null)
    assert.equal(H.validateView(v, null), null)
    for (const x of [null, [], 'x', 5]) assert.equal(H.validateView(x, [A, B]), null)
    // Tek kişilik görünüm yalnızca bitmiş masada olur
    const one = copy(H.publicView(all.overTooFew))
    assert.ok(H.validateView(one, [A]))
    one.ph = 'teams'
    one.result = null
    assert.equal(H.validateView(one, [A]), null)
    // Dokuz koltuk sınırın üstündedir
    const nine = copy(H.publicView(H.endGame(game(8)).state))
    nine.seats.push('77')
    nine.teams['77'] = 'spec'
    assert.equal(H.validateView(nine, nine.seats.slice()), null)
  })

  test('validatePrivate: boş nesne ve görünümün koltuklarındaki kişi', () => {
    const v = copy(H.publicView(game(3)))
    same(H.validatePrivate({}, v, B), {})
    assert.equal(H.validatePrivate({}, v, '99'), null)
    for (const m of [null, [], { cards: [] }, { side: 'red' }, 'x']) assert.equal(H.validatePrivate(m, v, B), null)
    assert.equal(H.validatePrivate({}, null, B), null)
    assert.equal(H.validatePrivate({}, { seats: 'x' }, B), null)
  })
})

describe('legalMoves', () => {
  test('takım seçiminde: herkes takım değiştirir, ev sahibi atar ve başlatır', () => {
    const s = game(3)
    same(legal(s, A), {
      turn: false,
      ph: 'teams',
      host: true,
      side: 'red',
      counts: { red: 2, blue: 1, spec: 0 },
      team: ['blue', 'spec'],
      set: true,
      kickoff: true,
      kickoffWhy: null,
      goal: false,
      time: false,
      stop: false
    })
    same(legal(s, B), {
      turn: false,
      ph: 'teams',
      host: false,
      side: 'blue',
      counts: { red: 2, blue: 1, spec: 0 },
      team: ['red', 'spec'],
      set: false,
      kickoff: false,
      kickoffWhy: 'not_host',
      goal: false,
      time: false,
      stop: false
    })
  })

  test('dolu takım seçeneklerde yoktur, boş takımda Maçı Başlat kapalıdır', () => {
    const full = game(8)
    same(legal(full, B).team, ['spec'])
    const spec = apply(full, B, { t: 'team', side: 'spec' }).state
    same(legal(spec, B).team, ['blue'])
    same(legal(spec, C).team, ['blue', 'spec'])
    const empty = apply(game(2), B, { t: 'team', side: 'spec' }).state
    assert.equal(legal(empty, A).kickoff, false)
    assert.equal(legal(empty, A).kickoffWhy, 'teams_empty')
  })

  test('maçta yalnızca ev sahibine gol, süre ve durdurma, takım seçeneği yok', () => {
    const m = match(3)
    const L = legal(m, A)
    assert.equal(L.ph, 'match')
    same(L.team, [])
    assert.equal(L.set, false)
    assert.equal(L.kickoff, false)
    assert.equal(L.goal, true)
    assert.equal(L.time, true)
    assert.equal(L.stop, true)
    const P = legal(m, B)
    assert.equal(P.goal || P.time || P.stop || P.set || P.kickoff, false)
    same(P.team, [])
  })

  test('bitmiş masada ve koltukta olmayan kişide seçenek yoktur', () => {
    const o = H.endGame(game(3)).state
    const L = legal(o, A)
    assert.equal(L.ph, 'over')
    assert.equal(L.host, true)
    assert.equal(L.side, 'red')
    same(L.team, [])
    assert.equal(L.set || L.kickoff || L.goal || L.time || L.stop, false)
    const X = legal(game(3), '99')
    assert.equal(X.side, null)
    same(X.team, [])
    assert.equal(X.set || X.kickoff || X.goal || X.time || X.stop, false)
  })
})

// Tohumlu rastgele oyun: her adımda rastgele bir kişi rastgele bir hamle dener, legalMoves'un öngörüsü applyMove'un
// sonucuyla karşılaştırılır. Az olasılıkla oyuncu ayrılır ya da ev sahibi masayı bitirir.
function playRandomGame (seed, opts) {
  const o = opts || {}
  const rng = seeded(seed)
  const pick = chooser(seed * 31 + 7)
  const n = 2 + (seed % 7)
  const rules = H.RULES[Math.floor(seed / 7) % 3]
  let res = H.newGame({ rules, players: IDS.slice(0, n), dealSeat: pick(n) }, noRng)
  let s = res.state
  checkAll(s, res.events)
  if (o.onStep) o.onStep(s, res.events)
  const stats = o.stats || {}
  const count = (key) => {
    stats[key] = (stats[key] || 0) + 1
  }
  let steps = 0
  while (!H.isOver(s)) {
    steps++
    const roll = pick(1000)
    if (steps > 600 || roll < 3) {
      res = H.endGame(s)
    } else if (roll < 8 && s.seats.length > 1) {
      res = H.removePlayer(s, s.seats[1 + pick(s.seats.length - 1)], noRng)
    } else {
      const host = s.seats[0]
      const actor = pick(10) < 6 ? host : s.seats[pick(s.seats.length)]
      const L = H.legalMoves(H.publicView(s), H.privateView(s, actor), actor)
      const r2 = pick(100)
      const side = SIDES[pick(3)]
      const team = TEAMS[pick(2)]
      const mt = Math.max(1, s.mt)
      let move = null
      let expect = false
      if (r2 < 25) {
        move = { t: 'team', side }
        expect = L.side === side ? L.ph === 'teams' || L.ph === 'result' : L.team.indexOf(side) >= 0
      } else if (r2 < 35) {
        const target = s.seats[pick(s.seats.length)]
        move = { t: 'set', id: target, side }
        expect = L.set && (s.teams[target] === side || side === 'spec' || L.counts[side] < H.TEAM_MAX)
      } else if (r2 < 45) {
        move = { t: 'kickoff' }
        expect = L.kickoff
      } else if (r2 < 85) {
        const k = pick(s.seats.length + 1)
        const by = k === s.seats.length ? null : s.seats[k]
        move = { t: 'goal', mt, side: team, by, at: Math.min(H.MAX_AT, lastAt(s) + pick(40)) }
        expect = L.goal && (by === null || s.teams[by] !== 'spec')
      } else if (r2 < 93) {
        move = { t: 'time', mt }
        expect = L.time
      } else if (r2 < 96) {
        move = { t: 'stop' }
        expect = L.stop
      } else {
        // Eski ya da gelecek maçın golü hiçbir zaman kabul edilmez
        move = { t: 'goal', mt: mt + 1, side: team, by: null, at: lastAt(s) }
        expect = false
      }
      const code = codeOf(() => {
        res = H.applyMove(s, actor, move, rng)
      })
      assert.equal(code === null, expect, 'tohum ' + seed + ' adım ' + steps + ' ' + JSON.stringify(move) + ' ' + code)
      if (code !== null) {
        assert.ok(H.ERRORS.indexOf(code) >= 0, code)
        count('err_' + code)
        continue
      }
      count('move_' + move.t)
    }
    const prev = s
    s = res.state
    checkAll(s, res.events)
    if (s.result && !prev.result) count('why_' + s.result.why)
    if (s.golden && !prev.golden) count('golden')
    if (o.onStep) o.onStep(s, res.events)
  }
  return s
}

describe('özellik testi', () => {
  test('180 tohumlu oyun: değişmezler, görünümler, legalMoves ile applyMove uyumu ve bitiş', () => {
    const stats = {}
    for (const seed of range(1, 181)) playRandomGame(seed, { stats })
    // Her yol en az birkaç kez denenmiş olmalı
    for (const key of ['move_team', 'move_set', 'move_kickoff', 'move_goal', 'move_time', 'move_stop', 'golden',
      'why_time', 'why_score', 'why_golden', 'why_host', 'why_too_few', 'err_not_host', 'err_bad_phase', 'err_stale',
      'err_team_full', 'err_teams_empty', 'err_bad_player']) {
      assert.ok(stats[key] > 0, key + ' ' + JSON.stringify(stats))
    }
  })

  test('aynı tohumla oyun belirlenimcidir', () => {
    for (const seed of [3, 17, 58]) {
      const a = []
      const b = []
      playRandomGame(seed, { onStep: (s) => a.push(JSON.stringify(s)) })
      playRandomGame(seed, { onStep: (s) => b.push(JSON.stringify(s)) })
      assert.ok(a.length > 5)
      assert.deepEqual(a, b)
    }
  })
})

function stateBody (s, me, r, events) {
  return {
    ph: H.isOver(s) ? 'over' : 'play',
    app: H.id,
    rules: s.rules,
    seats: copy(s.seats),
    rd: 1,
    ack: { seq: 0, ok: true },
    view: H.publicView(s),
    mine: H.privateView(s, me),
    ev: events.slice(-CORE.MAX_EVENTS).map((ev) => Object.assign({ r }, ev)),
    away: []
  }
}

describe('protokol çekirdeğiyle uyum', () => {
  test('motorun kullandığı her çekirdek yardımcısı 33-oyun-protokol.js içinde bir işlevdir', () => {
    const used = Array.from(HEX_SRC.matchAll(/\bG\.([A-Za-z0-9_]+)/g), (m) => m[1])
    const names = used.filter((name, i) => used.indexOf(name) === i).sort()
    same(names, ['fail', 'isHex16', 'isId', 'onlyKeys', 'randomHex16'])
    for (const name of names) assert.equal(typeof CORE[name], 'function', name)
    for (const code of ['no_random', 'bad_random']) assert.ok(H.ERRORS.indexOf(code) >= 0, code)
  })

  test('uygulama kimliği, kural setleri, hata ve olay kodları çekirdeğin desenlerine uyar', () => {
    assert.ok(CORE.isApp(H.id))
    assert.ok(H.MIN_PLAYERS >= 2 && H.MAX_PLAYERS <= CORE.MAX_SEATS)
    assert.ok(H.RULES.indexOf(H.DEFAULT_RULES) >= 0)
    for (const list of ['RULES', 'ERRORS', 'EVENTS']) {
      for (const code of H[list]) assert.ok(CORE.isCode(code), list + ' ' + code)
    }
    for (const code of CORE.DESK_ERRORS) assert.ok(H.ERRORS.indexOf(code) >= 0, code)
  })

  test('görünümler, eller ve olaylar state gövdesi denetiminden geçer, oyuncu durumu kabul eder', () => {
    let checked = 0
    for (const seed of range(1, 30)) {
      let r = 1
      playRandomGame(seed, {
        onStep: (s, events) => {
          r++
          for (const me of s.seats) {
            const b = copy(stateBody(s, me, r, events))
            const ctx = { dealer: s.seats[0], me, r, app: H.id, rules: copy(H.RULES) }
            assert.ok(CORE.validStateBody(b, ctx), 'tohum ' + seed + ' adım ' + r)
            // Masa yöneticisi oyuncuda görünümü ve eli birlikte ister, el null olamaz (34-oyun-masa.js onState)
            const view = H.validateView(b.view, b.seats)
            assert.ok(view && b.mine !== null && H.validatePrivate(b.mine, view, me))
            checked++
          }
          const p = CORE.encodePlain(copy(stateBody(s, s.seats[s.seats.length - 1], r, events)))
          assert.equal(typeof p, 'string')
          assert.ok(p.length < CORE.MAX_P / 4, String(p.length))
        }
      })
    }
    assert.ok(checked > 1000, String(checked))
  })
})

describe('saflık', () => {
  test('kaynakta DOM, ağ, saat, rastgelelik ve sözlük kullanılmaz', () => {
    const banned = [/\bdocument\b/, /XMLHttpRequest/, /Math\.random/, /\bDate\b/, /setTimeout/, /setInterval/,
      /(^|[^\w$.])t\(/m, /structuredClone/, /localStorage/, /\bfetch\b/, /\bnavigator\b/, /performance/,
      /requestAnimationFrame/]
    for (const re of banned) assert.equal(re.test(HEX_SRC), false, String(re))
  })

  test('başka oyunların adları kaynakta ve bu testte geçmez', () => {
    const names = [String.fromCharCode(104, 97, 120, 98, 97, 108, 108), String.fromCharCode(117, 110, 111)]
    const own = fs.readFileSync(__filename, 'utf8')
    for (const name of names) {
      const re = new RegExp('\\b' + name + '\\b', 'i')
      assert.equal(re.test(HEX_SRC), false, 'kaynak')
      assert.equal(re.test(own), false, 'test')
    }
    assert.equal(/hax/i.test(HEX_SRC), false)
  })

  test('çekirdek olmadan da boş bağlamda yüklenir, saf yardımcılar çalışır', () => {
    const bare = loadEngine({ core: false }).TelsizHexball
    assert.ok(bare)
    same(bare.balanceTeams([A, B, C]), { [A]: 'red', [B]: 'blue', [C]: 'red' })
    same(bare.countSides({ [A]: 'spec' }), { red: 0, blue: 0, spec: 1 })
    assert.equal(bare.goalLimit('long'), 255)
    assert.equal(bare.turnOf({}), null)
  })

  test('derin dondurulmuş durumla hamleler hata vermez ve girdi değişmez', () => {
    const all = sampleStates()
    const s = deepFreeze(all.teams)
    const before = copy(s)
    apply(s, B, { t: 'team', side: 'red' })
    apply(s, A, { t: 'set', id: B, side: 'spec' })
    apply(s, A, { t: 'kickoff' })
    H.removePlayer(s, B, noRng)
    H.endGame(s)
    H.legalMoves(H.publicView(s), H.privateView(s, A), A)
    same(s, before)
    const m = deepFreeze(all.match)
    const mb = copy(m)
    goal(m, 'red', A, 50)
    apply(m, A, { t: 'time', mt: m.mt })
    apply(m, A, { t: 'stop' })
    H.removePlayer(m, B, noRng)
    H.endGame(m)
    same(m, mb)
    const g = deepFreeze(all.golden)
    goal(g, 'blue', B, 400)
    H.removePlayer(g, E, noRng)
    const r = deepFreeze(all.time)
    apply(r, A, { t: 'kickoff' })
    H.removePlayer(r, B, noRng)
    H.endGame(r)
  })

  test('kaynaktaki her fail kodu ve kickoffWhy kodu ERRORS içinde, liste tam', () => {
    const failed = Array.from(HEX_SRC.matchAll(/fail\('([^']*)'\)/g), (m) => m[1])
    assert.ok(failed.length >= 10, String(failed.length))
    for (const code of failed) assert.ok(H.ERRORS.indexOf(code) >= 0, code)
    const why = Array.from(HEX_SRC.matchAll(/kickoffWhy = '([a-z_]+)'/g), (m) => m[1])
    same(why, ['not_host', 'teams_empty', 'bad_phase'])
    for (const code of why) assert.ok(H.ERRORS.indexOf(code) >= 0, code)
    same(H.ERRORS.slice().sort(), ['bad_move', 'bad_options', 'bad_phase', 'bad_player', 'bad_random', 'game_over',
      'no_random', 'not_host', 'stale', 'team_full', 'teams_empty'])
    same(H.EVENTS.slice().sort(), ['goal', 'golden', 'kickoff', 'leave', 'own_goal', 'stop', 'team', 'time_up', 'win'])
  })
})
