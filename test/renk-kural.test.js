'use strict'

// Renk kural motoru (public/js/35-renk-kural.js, window.TelsizRenk) testleri. Motor tarayıcıdaki gibi Node vm
// bağlamında, gerçek protokol çekirdeğiyle (public/js/33-oyun-protokol.js, window.TelsizGame) birlikte yüklenir.
// Motorun çekirdekten kullandığı yardımcıların varlığı, kodların çekirdeğin desenlerine uyması ve Renk görünümlerinin
// state gövdesi denetiminden geçmesi de sınanır. Rastgelelik belirlenimcidir: seeded (xorshift32) ve fixed düz Array
// döndürür. vm bağlamından dönen nesneler JSON kopyasıyla karşılaştırılır.

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const ROOT = path.join(__dirname, '..')
const RENK_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', '35-renk-kural.js'), 'utf8')
const GAME_SRC = fs.readFileSync(path.join(ROOT, 'public', 'js', '33-oyun-protokol.js'), 'utf8')
const LAST_LINE = 'const LAST_CARD = { official: true, stack: true }'

// Motoru boş bir vm bağlamında yükler: yalnızca window, protokol çekirdeği ve motor (DOM, saat, ağ yok).
// core: false çekirdeği yüklemez (motorun çekirdeğe yalnızca çalışma anında eriştiğini sınamak için).
function loadEngine (opts) {
  const o = opts || {}
  const sandbox = vm.createContext({})
  sandbox.window = sandbox
  sandbox.self = sandbox
  if (o.core !== false) vm.runInContext(GAME_SRC, sandbox, { filename: '33-oyun-protokol.js' })
  vm.runInContext(o.src || RENK_SRC, sandbox, { filename: '35-renk-kural.js' })
  return sandbox
}

const ENGINE = loadEngine()
const R = ENGINE.TelsizRenk
const CORE = ENGINE.TelsizGame
const COLORS = ['R', 'Y', 'G', 'B']
const IDS = ['5', '12', '7', '30', '41', '8', '19', '2', '77']
const [A, B, C, D] = IDS

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

// Verilen baytları döngüyle yineleyen kaynak
function fixed (bytes) {
  let pos = 0
  return (n) => {
    const out = range(0, n).map((i) => bytes[(pos + i) % bytes.length])
    pos += n
    return out
  }
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

const DECK = copy(R.buildDeck())

function countOf (list, code) {
  return list.filter((c) => c === code).length
}

// Elle kurulan tam durum. Kartlar buildDeck() içinden çıkarılır. hands: koltuk elleri, top: atılanların üstü,
// deckTop: destenin üstünden sırayla çekilecek kartlar, under: üstün altındaki atılanlar. Kalan kartlar rest değerine
// göre destenin altına ('deck', varsayılan), atılanlara ('discard') ya da bir koltuğun eline (dizin) gider.
function table (o) {
  const pool = DECK.slice()
  const take = (c) => {
    const i = pool.indexOf(c)
    assert.ok(i >= 0, 'destede kalmadı: ' + c)
    pool.splice(i, 1)
    return c
  }
  const hands = o.hands.map((h) => h.map(take))
  const top = take(o.top)
  const deckTop = (o.deckTop || []).map(take)
  let under = (o.under || []).map(take)
  let deck = pool
  const rest = o.rest === undefined ? 'deck' : o.rest
  if (rest === 'discard') {
    under = pool.concat(under)
    deck = []
  } else if (typeof rest === 'number') {
    hands[rest] = hands[rest].concat(pool)
    deck = []
  }
  const ids = o.ids || IDS.slice(0, hands.length)
  const s = {
    v: 1,
    rules: o.rules || 'official',
    seats: ids.map((id, i) => ({ id, hand: hands[i] })),
    dealSeat: o.dealSeat || 0,
    turn: o.turn || 0,
    dir: o.dir || 1,
    deck: deck.concat(deckTop.slice().reverse()),
    discard: under.concat([top]),
    color: o.color !== undefined ? o.color : R.cardColor(top),
    phase: o.phase || 'play',
    drawn: o.drawn || null,
    pending: o.pending || null,
    last: o.last || null,
    step: o.step || 0,
    result: null
  }
  assert.ok((o.engine || R).validateState(s), 'elle kurulan durum geçerli')
  return s
}

function seatIds (s) {
  return s.seats.map((x) => x.id)
}

function handOf (s, id) {
  return copy(s.seats.find((x) => x.id === id).hand)
}

function total (s) {
  return s.deck.length + s.discard.length + s.seats.reduce((sum, x) => sum + x.hand.length, 0)
}

// Durumun, görünümün, ellerin ve olayların denetimi: her adımda çağrılır
function checkAll (s, events, engine) {
  const E = engine || R
  assert.ok(E.validateState(s), 'validateState geçer')
  assert.equal(total(s), 108)
  const view = E.publicView(s)
  assert.ok(E.validateView(view, seatIds(s)), 'validateView geçer')
  for (const x of s.seats) {
    assert.ok(E.validatePrivate(E.privateView(s, x.id), view, x.id), 'validatePrivate geçer')
  }
  for (const ev of events || []) {
    assert.ok(E.EVENTS.indexOf(ev.e) >= 0, 'bilinen olay: ' + ev.e)
    for (const key of Object.keys(ev)) {
      // Çekilen kartın kodu hiçbir olayda geçmez, kart kodu yalnızca play olayının c alanında bulunur
      if (typeof ev[key] === 'string' && E.isCard(ev[key])) assert.ok(ev.e === 'play' && key === 'c', 'olayda kart: ' + ev.e)
    }
  }
}

// Doğrulanmış hamle: sonuç durumu ve olaylar denetlenir
function apply (s, id, move, rng) {
  const res = R.applyMove(s, id, move, rng || seeded(99))
  checkAll(res.state, res.events)
  return res
}

function eventNames (events) {
  return events.map((ev) => ev.e)
}

// Kanonik deste, first kartı dağıtımdan sonra açılacak yere (108 - 7n - 1) taşınmış hâlde
function deckWithFirst (first, n) {
  const deck = DECK.slice()
  deck.splice(deck.indexOf(first), 1)
  deck.splice(108 - 7 * n - 1, 0, first)
  return deck
}

// size kartlık karıştırmayı önce identity kez birim permütasyon yapan (her adımda j = i), sonra rotate kez sıfır
// baytla sola döndüren (en alttaki kart üste çıkar) kaynak. Çekirdek 64 baytlık parçalar ister, 108'den küçük
// her aralık bir bayt okur, parçanın artığı atılır.
function shuffleScript (size, identity, rotate) {
  const block = (zero) => {
    const out = []
    for (const i of range(1, size).reverse()) out.push(zero ? 0 : i)
    while (out.length % 64 !== 0) out.push(0)
    return out
  }
  let bytes = []
  for (const zero of range(0, identity).map(() => false).concat(range(0, rotate).map(() => true))) {
    bytes = bytes.concat(block(zero))
  }
  let pos = 0
  return (n) => {
    const out = bytes.slice(pos, pos + n)
    pos += n
    while (out.length < n) out.push(0)
    return out
  }
}

function deepFreeze (x) {
  if (x && typeof x === 'object') {
    Object.keys(x).forEach((key) => deepFreeze(x[key]))
    Object.freeze(x)
  }
  return x
}

describe('deste', () => {
  test('108 kart, renk başına 25 kart ve doğru adetler', () => {
    assert.equal(DECK.length, 108)
    for (const col of COLORS) {
      assert.equal(DECK.filter((c) => c.charAt(0) === col).length, 25, col)
      assert.equal(countOf(DECK, col + '0'), 1)
      for (const v of range(1, 10)) assert.equal(countOf(DECK, col + v), 2, col + v)
      for (const v of ['S', 'V', 'D']) assert.equal(countOf(DECK, col + v), 2, col + v)
    }
    assert.equal(countOf(DECK, 'WW'), 4)
    assert.equal(countOf(DECK, 'WF'), 4)
    assert.ok(DECK.every((c) => R.isCard(c)))
  })

  test('kanonik sıra sabit ve her çağrı yeni dizi döner', () => {
    const text = DECK.join('')
    assert.ok(text.startsWith('R0R1R1R2'), text.slice(0, 16))
    assert.ok(text.endsWith('WWWWWWWWWFWFWFWF'), text.slice(-16))
    assert.ok(text.indexOf('RSRSRVRVRDRDY0Y1') > 0)
    const a = R.buildDeck()
    a.pop()
    assert.equal(R.buildDeck().length, 108)
  })
})

describe('kart kodu', () => {
  test('isCard geçerli ve geçersiz kodları ayırır', () => {
    for (const c of ['R0', 'BD', 'YV', 'GS', 'R9', 'WW', 'WF']) assert.equal(R.isCard(c), true, c)
    for (const c of ['W4', 'R4x', 'X5', 'r5', 'RRR', 'WR', 'R', '', 'RA', 'W0', 5, null, undefined, {}, ['R5']]) {
      assert.equal(R.isCard(c), false, String(c))
    }
  })

  test('parseCards: en çok 108 geçerli kart, kopya döner', () => {
    same(R.parseCards(['R1', 'WF']), ['R1', 'WF'])
    same(R.parseCards([]), [])
    assert.equal(R.parseCards(DECK).length, 108)
    assert.equal(R.parseCards(DECK.concat(['R1'])), null, '109 öğe')
    assert.equal(R.parseCards(['R1', 'W4']), null)
    assert.equal(R.parseCards('R1'), null)
    assert.equal(R.parseCards(null), null)
    const src = ['R1']
    const out = R.parseCards(src)
    out.push('R2')
    assert.equal(src.length, 1)
  })

  test('renk, değer, Joker ve puan', () => {
    assert.equal(R.cardColor('G7'), 'G')
    assert.equal(R.cardColor('WW'), null)
    assert.equal(R.cardColor('WF'), null)
    assert.equal(R.isWild('WF'), true)
    assert.equal(R.isWild('RD'), false)
    assert.equal(R.points('R0'), 0)
    assert.equal(R.points('B9'), 9)
    for (const c of ['RS', 'YV', 'GD']) assert.equal(R.points(c), 20, c)
    assert.equal(R.points('WW'), 50)
    assert.equal(R.points('WF'), 50)
    const values = DECK.map((c) => R.cardValue(c)).filter((v, i, list) => list.indexOf(v) === i).sort()
    same(values, ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'D', 'F', 'S', 'V', 'W'])
  })
})

describe('değer benzersizliği (K1 regresyonu)', () => {
  test('Joker +4 ile 4 aynı değeri taşımaz', () => {
    assert.notEqual(R.cardValue('WF'), R.cardValue('R4'))
    assert.notEqual(R.cardValue('WW'), R.cardValue('R4'))
    assert.equal(R.points('R4'), 4)
  })

  test('yalnız R4 olan oyuncu Kırmızı 9 üstüne R4 oynayabilir', () => {
    const s = table({ hands: [['R4'], ['B1', 'B2']], top: 'R9' })
    const res = apply(s, A, { t: 'play', c: 'R4', step: 0 })
    assert.equal(res.state.phase, 'over')
    assert.equal(res.state.result.winner, A)
  })

  test('Kırmızı seçilmiş Joker +4 üstüne B4 oynanamaz', () => {
    const s = table({ hands: [['B4', 'G1'], ['B1', 'B2']], top: 'WF', color: 'R' })
    assert.equal(R.canPlay(R.publicView(s), R.privateView(s, A), A, 'B4'), 'not_playable')
    throwsCode(() => R.applyMove(s, A, { t: 'play', c: 'B4', step: 0 }, noRng), 'not_playable')
  })

  test('bekleyen Joker +4 cezasına G4 eklenemez', () => {
    const s = table({ rules: 'stack', hands: [['G4', 'WF', 'G1'], ['B1', 'B2']], top: 'WF', color: 'G', pending: { k: 'F', n: 4 } })
    throwsCode(() => R.applyMove(s, A, { t: 'play', c: 'G4', step: 0 }, noRng), 'must_stack')
    const res = apply(s, A, { t: 'play', c: 'WF', col: 'B', step: 0 })
    same(res.state.pending, { k: 'F', n: 8 })
  })
})

// Bağımsız kâhin: canPlay'den ayrı yazılmış oynanabilirlik kuralı
function oracle (top, color, card, hand, pending) {
  if (pending) {
    if (pending.k === 'D') return card.charAt(0) !== 'W' && card.charAt(1) === 'D' ? null : 'must_stack'
    return card === 'WF' ? null : 'must_stack'
  }
  if (card.charAt(0) === 'W') {
    if (card === 'WF' && hand.some((h) => h.charAt(0) === color)) return 'wild4_has_color'
    return null
  }
  if (card.charAt(0) === color || card.charAt(1) === top.charAt(1)) return null
  return 'not_playable'
}

describe('bağımsız kâhin', () => {
  test('108x108 çiftin hepsinde canPlay kâhinle aynı sonucu verir (ceza ve +4 kısıtı dahil)', () => {
    const pendings = [null, { k: 'D', n: 2 }, { k: 'F', n: 4 }]
    let checked = 0
    let wrong = null
    for (const top of DECK) {
      const colors = top.charAt(0) === 'W' ? COLORS : [top.charAt(0)]
      for (const color of colors) {
        const other = COLORS.find((c) => c !== color)
        // Elde etkin renk olan ve olmayan iki el ile tek kartlık el
        const fillers = [null, color + '5', other + '5']
        for (const card of DECK) {
          for (const filler of fillers) {
            const hand = filler === null ? [card] : [card, filler]
            for (const pending of pendings) {
              const view = { phase: 'play', turn: A, top, color, pending, rules: pending ? 'stack' : 'official' }
              const got = R.canPlay(view, { cards: hand, drawn: null }, A, card)
              const want = oracle(top, color, card, hand, pending)
              checked++
              if (got !== want && wrong === null) wrong = [top, color, card, hand.join(','), JSON.stringify(pending), got, want].join(' ')
            }
          }
        }
      }
    }
    assert.equal(wrong, null)
    assert.ok(checked > 108 * 108 * 3)
  })

  test('canPlay kodlarının hepsi ERRORS içinde', () => {
    const view = { phase: 'play', turn: A, top: 'R1', color: 'R', pending: null, rules: 'official' }
    const codes = [
      R.canPlay(Object.assign({}, view, { phase: 'over' }), { cards: ['R2'], drawn: null }, A, 'R2'),
      R.canPlay(view, { cards: ['R2'], drawn: null }, B, 'R2'),
      R.canPlay(Object.assign({}, view, { phase: 'color', color: null }), { cards: ['R2'], drawn: null }, A, 'R2'),
      R.canPlay(view, { cards: ['R2'], drawn: null }, A, 'W4'),
      R.canPlay(view, { cards: ['R2'], drawn: null }, A, 'R3'),
      R.canPlay(view, { cards: ['R2', 'R3'], drawn: 'R3' }, A, 'R2'),
      R.canPlay(Object.assign({}, view, { pending: { k: 'D', n: 2 } }), { cards: ['R2'], drawn: null }, A, 'R2'),
      R.canPlay(view, { cards: ['B2'], drawn: null }, A, 'B2'),
      R.canPlay(view, { cards: ['WF', 'R5'], drawn: null }, A, 'WF')
    ]
    same(codes, ['game_over', 'not_your_turn', 'choose_color', 'bad_move', 'not_in_hand', 'only_drawn', 'must_stack',
      'not_playable', 'wild4_has_color'])
    for (const code of codes) assert.ok(R.ERRORS.indexOf(code) >= 0, code)
  })
})

describe('seçenekler', () => {
  const ok = { rules: 'official', players: [A, B], dealSeat: 0 }

  test('geçerli seçenekler kabul edilir, kopya döner', () => {
    same(R.validateOptions(ok), ok)
    same(R.validateOptions({ rules: 'stack', players: IDS.slice(0, 8), dealSeat: 7 }), { rules: 'stack', players: IDS.slice(0, 8), dealSeat: 7 })
    const res = R.newGame(ok, seeded(1))
    checkAll(res.state, res.events)
  })

  test('geçersiz seçenekler bad_options döner', () => {
    const bad = [
      Object.assign({}, ok, { players: [A] }),
      Object.assign({}, ok, { players: IDS.slice(0, 9) }),
      Object.assign({}, ok, { players: [A, A] }),
      Object.assign({}, ok, { rules: 'house' }),
      Object.assign({}, ok, { players: [5, 12] }),
      Object.assign({}, ok, { players: ['05', '12'] }),
      Object.assign({}, ok, { dealSeat: 2 }),
      Object.assign({}, ok, { dealSeat: -1 }),
      Object.assign({}, ok, { dealSeat: 0.5 }),
      Object.assign({}, ok, { dealSeat: '0' }),
      Object.assign({}, ok, { extra: 1 }),
      { rules: 'official', players: [A, B] },
      null,
      [A, B]
    ]
    for (const o of bad) {
      assert.equal(R.validateOptions(o), null, JSON.stringify(o))
      throwsCode(() => R.newGame(o, seeded(1)), 'bad_options', JSON.stringify(o))
      throwsCode(() => R.dealFrom(o, DECK, seeded(1)), 'bad_options', JSON.stringify(o))
    }
  })

  test('dealFrom eksik ya da bozuk desteyi reddeder', () => {
    throwsCode(() => R.dealFrom(ok, DECK.slice(1), seeded(1)), 'bad_options')
    const twice = DECK.slice()
    twice[0] = 'R1'
    throwsCode(() => R.dealFrom(ok, twice, seeded(1)), 'bad_options')
    throwsCode(() => R.dealFrom(ok, DECK.concat(['R1']), seeded(1)), 'bad_options')
  })

  test('kaynak hatası: fırlatan kaynak no_random, kısa ya da bozuk kaynak bad_random', () => {
    throwsCode(() => R.newGame(ok, () => { throw new Error('x') }), 'no_random')
    throwsCode(() => R.newGame(ok, () => [1, 2, 3]), 'bad_random')
    throwsCode(() => R.newGame(ok, fixed([255])), 'bad_random')
    throwsCode(() => R.newGame(ok, fixed([256])), 'bad_random')
  })
})

describe('dağıtım', () => {
  test('2-8 oyuncu: kanonik destede her biri 7 kart alır, dağıtım dealSeat + 1 koltuğundan başlar', () => {
    for (const n of range(2, 9)) {
      const dealSeat = (n * 3) % n
      const players = IDS.slice(0, n)
      const res = R.dealFrom({ rules: 'official', players, dealSeat }, DECK, seeded(n))
      const s = res.state
      checkAll(s, res.events)
      const hands = players.map(() => [])
      let pos = 107
      for (const r of range(0, 7)) {
        for (const k of range(1, n + 1)) hands[(dealSeat + k) % n].push(DECK[pos - r * n - k + 1])
      }
      pos -= 7 * n
      same(s.seats.map((x) => x.hand), hands, 'eller n=' + n)
      same(s.discard, [DECK[pos]], 'ilk kart n=' + n)
      assert.equal(s.deck.length, 108 - 7 * n - 1, 'deste n=' + n)
      assert.equal(s.step, 0)
    }
  })

  test('2-8 oyuncu: karıştırılmış destede eller 7 kart, toplam 108', () => {
    for (const n of range(2, 9)) {
      for (const seed of range(1, 7)) {
        const res = R.newGame({ rules: R.RULES[seed % 2], players: IDS.slice(0, n), dealSeat: seed % n }, seeded(seed * 100 + n))
        const s = res.state
        checkAll(s, res.events)
        const extra = R.cardValue(s.discard[s.discard.length - 1]) === 'D' ? 2 : 0
        const sizes = s.seats.map((x) => x.hand.length).sort((a, b) => a - b)
        assert.equal(sizes[0], 7)
        assert.equal(sizes.reduce((a, b) => a + b, 0), 7 * n + extra)
        assert.equal(s.deck.length, 108 - 7 * n - 1 - extra)
      }
    }
  })

  test('aynı kaynakla aynı el, farklı kaynakla farklı el', () => {
    const o = { rules: 'official', players: [A, B, C], dealSeat: 1 }
    same(R.newGame(o, seeded(7)), R.newGame(o, seeded(7)))
    assert.notDeepEqual(copy(R.newGame(o, seeded(7)).state.deck), copy(R.newGame(o, seeded(8)).state.deck))
  })
})

describe('ilk kart', () => {
  const players = [A, B, C]
  const opts = (n, rules) => ({ rules: rules || 'official', players: IDS.slice(0, n), dealSeat: 1 })

  test('sayı: sıra soldakinde, renk kartın rengi', () => {
    const res = R.dealFrom(opts(3), deckWithFirst('G7', 3), noRng)
    const s = res.state
    checkAll(s, res.events)
    same(s.discard, ['G7'])
    assert.equal(s.turn, 2)
    assert.equal(s.color, 'G')
    assert.equal(s.phase, 'play')
    same(res.events, [])
  })

  test('Engel: soldaki atlanır', () => {
    const res = R.dealFrom(opts(3), deckWithFirst('BS', 3), noRng)
    assert.equal(res.state.turn, 0)
    same(res.events, [{ e: 'skip', p: players[2] }])
  })

  test('Yön, 3 kişi: yön döner, sıra dağıtanda', () => {
    const res = R.dealFrom(opts(3), deckWithFirst('YV', 3), noRng)
    assert.equal(res.state.dir, -1)
    assert.equal(res.state.turn, 1)
    same(res.events, [{ e: 'reverse', dir: -1 }])
  })

  test('Yön, 2 kişi: Engel gibi, sıra dağıtanda ve yön değişmez', () => {
    const res = R.dealFrom(opts(2), deckWithFirst('YV', 2), noRng)
    assert.equal(res.state.dir, 1)
    assert.equal(res.state.turn, 1)
    same(res.events, [{ e: 'skip', p: A }])
  })

  test('+2: soldaki 2 kart çeker ve atlanır, iki sette de aynı', () => {
    for (const rules of R.RULES) {
      const res = R.dealFrom(opts(3, rules), deckWithFirst('RD', 3), noRng)
      const s = res.state
      checkAll(s, res.events)
      assert.equal(s.seats[2].hand.length, 9)
      assert.equal(s.turn, 0)
      assert.equal(s.pending, null)
      same(res.events, [{ e: 'penalty', p: C, n: 2, want: 2, why: 'D' }, { e: 'skip', p: C }])
    }
  })

  test('Joker: renk seçimi beklenir, play ve draw choose_color döner', () => {
    const res = R.dealFrom(opts(3), deckWithFirst('WW', 3), noRng)
    const s = res.state
    checkAll(s, res.events)
    assert.equal(s.phase, 'color')
    assert.equal(s.color, null)
    assert.equal(s.turn, 2)
    const view = R.publicView(s)
    assert.equal(view.phase, 'color')
    assert.equal(view.color, null)
    const lm = R.legalMoves(view, R.privateView(s, C), C)
    assert.equal(lm.color, true)
    assert.equal(lm.draw, false)
    same(lm.play, [])
    const card = s.seats[2].hand[0]
    throwsCode(() => R.applyMove(s, C, { t: 'play', c: card, step: 0 }, noRng), 'choose_color')
    throwsCode(() => R.applyMove(s, C, { t: 'play', c: 'B9', step: 0 }, noRng), 'choose_color')
    throwsCode(() => R.applyMove(s, C, { t: 'draw', step: 0 }, noRng), 'choose_color')
    throwsCode(() => R.applyMove(s, C, { t: 'pass', step: 0 }, noRng), 'cannot_pass')
    throwsCode(() => R.applyMove(s, A, { t: 'color', col: 'B', step: 0 }, noRng), 'not_your_turn')
    const next = apply(s, C, { t: 'color', col: 'B', step: 0 }, noRng)
    assert.equal(next.state.phase, 'play')
    assert.equal(next.state.color, 'B')
    assert.equal(next.state.turn, 2)
    assert.equal(next.state.step, 1)
    same(next.events, [{ e: 'color', p: C, col: 'B' }])
  })

  test('Joker +4 desteye geri konur ve yeniden açılır', () => {
    for (const seed of range(1, 21)) {
      const res = R.dealFrom(opts(3), deckWithFirst('WF', 3), seeded(seed))
      checkAll(res.state, res.events)
      assert.notEqual(res.state.discard[0], 'WF')
      assert.ok(eventNames(res.events).indexOf('reflip') === 0)
    }
  })

  test('bozuk kaynakla 16 yeniden açılıştan sonra bad_random', () => {
    // Birim karıştırma Joker +4'ü hep üstte bırakır
    throwsCode(() => R.dealFrom(opts(3), deckWithFirst('WF', 3), shuffleScript(87, 16, 0)), 'bad_random')
    // 15 birim ve 1 döndürme: 16 yeniden açılış yeter, en alttaki R0 üste çıkar
    const res = R.dealFrom(opts(3), deckWithFirst('WF', 3), shuffleScript(87, 15, 1))
    checkAll(res.state, res.events)
    assert.equal(eventNames(res.events).filter((e) => e === 'reflip').length, 16)
    same(res.state.discard, ['R0'])
  })
})

describe('hamle biçimi', () => {
  test('validateMove geçerli hamleleri aynı alanlarla kopyalar', () => {
    const good = [
      { t: 'play', c: 'R5', step: 0 },
      { t: 'play', c: 'WW', col: 'G', step: 3 },
      { t: 'play', c: 'WF', col: 'B', last: true, step: 9 },
      { t: 'play', c: 'B2', last: true, step: 1 },
      { t: 'draw', step: 0 },
      { t: 'pass', step: 4 },
      { t: 'color', col: 'Y', step: 0 },
      { t: 'last' },
      { t: 'catch', p: '12' }
    ]
    for (const m of good) {
      const out = R.validateMove(m)
      same(out, m)
      same(R.validateMove(out), m, 'yeniden doğrulanabilir')
    }
  })

  test('validateMove bozuk hamleleri reddeder', () => {
    const bad = [
      null,
      [],
      'play',
      {},
      { t: 'jump', step: 0 },
      { t: 'constructor', step: 0 },
      { t: 'play', c: 'R5' },
      { t: 'play', c: 'W4', step: 0 },
      { t: 'play', c: 'R5', col: 'R', step: 0 },
      { t: 'play', c: 'WW', col: 'X', step: 0 },
      { t: 'play', c: 'R5', last: false, step: 0 },
      { t: 'play', c: 'R5', step: -1 },
      { t: 'play', c: 'R5', step: 1.5 },
      { t: 'play', c: 'R5', step: '0' },
      { t: 'play', c: 'R5', step: 0, x: 1 },
      { t: 'draw' },
      { t: 'draw', step: 0, c: 'R5' },
      { t: 'pass', step: null },
      { t: 'color', step: 0 },
      { t: 'color', col: null, step: 0 },
      { t: 'last', step: 0 },
      { t: 'catch' },
      { t: 'catch', p: 12 },
      { t: 'catch', p: '012' },
      { t: 'catch', p: '12', step: 0 }
    ]
    for (const m of bad) assert.equal(R.validateMove(m), null, JSON.stringify(m))
  })
})

describe('hata önceliği', () => {
  const base = () => table({
    hands: [['R5', 'B7', 'WF', 'WW', 'G2'], ['Y1', 'Y2'], ['G3', 'G4']],
    top: 'R9',
    deckTop: ['B1']
  })

  test('oyun bitince her hamle game_over döner', () => {
    const over = R.endGame(base()).state
    throwsCode(() => R.applyMove(over, A, { t: 'nonsense' }, noRng), 'game_over')
    throwsCode(() => R.applyMove(over, '999', { t: 'draw', step: 0 }, noRng), 'game_over')
    throwsCode(() => R.applyMove(over, A, { t: 'draw', step: over.step }, noRng), 'game_over')
  })

  test('biçim, oyuncu, Tek! ve yakalama sırası', () => {
    const s = base()
    throwsCode(() => R.applyMove(s, '999', { t: 'x' }, noRng), 'bad_move')
    throwsCode(() => R.applyMove(s, '999', { t: 'draw', step: 0 }, noRng), 'bad_player')
    throwsCode(() => R.applyMove(s, B, { t: 'last' }, noRng), 'no_last')
    throwsCode(() => R.applyMove(s, A, { t: 'catch', p: A }, noRng), 'self_catch')
    throwsCode(() => R.applyMove(s, A, { t: 'catch', p: B }, noRng), 'not_catchable')
  })

  test('sıra, step ve aşama sırası', () => {
    const s = base()
    throwsCode(() => R.applyMove(s, B, { t: 'draw', step: 5 }, noRng), 'not_your_turn')
    throwsCode(() => R.applyMove(s, A, { t: 'pass', step: 5 }, noRng), 'stale')
    throwsCode(() => R.applyMove(s, A, { t: 'color', col: 'R', step: 0 }, noRng), 'bad_move')
    throwsCode(() => R.applyMove(s, A, { t: 'pass', step: 0 }, noRng), 'cannot_pass')
  })

  test('play denetim sırası', () => {
    const s = base()
    throwsCode(() => R.applyMove(s, A, { t: 'play', c: 'B9', step: 0 }, noRng), 'not_in_hand')
    throwsCode(() => R.applyMove(s, A, { t: 'play', c: 'B7', step: 0 }, noRng), 'not_playable')
    throwsCode(() => R.applyMove(s, A, { t: 'play', c: 'WF', col: 'B', step: 0 }, noRng), 'wild4_has_color')
    throwsCode(() => R.applyMove(s, A, { t: 'play', c: 'WF', step: 0 }, noRng), 'wild4_has_color')
    throwsCode(() => R.applyMove(s, A, { t: 'play', c: 'WW', step: 0 }, noRng), 'need_color')
    throwsCode(() => R.applyMove(s, A, { t: 'play', c: 'R5', col: 'R', step: 0 }, noRng), 'bad_move')
    apply(s, A, { t: 'play', c: 'WW', col: 'B', step: 0 })
  })

  test('drawn aşamasında oynanamayan başka kart only_drawn döner, not_playable değil', () => {
    const s = table({ hands: [['R7', 'B7', 'R5'], ['Y1', 'Y2']], top: 'R9', phase: 'drawn', drawn: 'R7' })
    throwsCode(() => R.applyMove(s, A, { t: 'play', c: 'B7', step: 0 }, noRng), 'only_drawn')
    throwsCode(() => R.applyMove(s, A, { t: 'play', c: 'R5', step: 0 }, noRng), 'only_drawn')
    throwsCode(() => R.applyMove(s, A, { t: 'play', c: 'B9', step: 0 }, noRng), 'not_in_hand')
    throwsCode(() => R.applyMove(s, A, { t: 'draw', step: 0 }, noRng), 'already_drawn')
    apply(s, A, { t: 'play', c: 'R7', step: 0 })
  })

  test('ceza beklerken renk tutsa bile eklenemeyen kart must_stack döner', () => {
    const s = table({ rules: 'stack', hands: [['B7', 'R5', 'GD', 'WF'], ['Y1', 'Y2']], top: 'RD', pending: { k: 'D', n: 2 } })
    throwsCode(() => R.applyMove(s, A, { t: 'play', c: 'R5', step: 0 }, noRng), 'must_stack')
    throwsCode(() => R.applyMove(s, A, { t: 'play', c: 'B7', step: 0 }, noRng), 'must_stack')
    throwsCode(() => R.applyMove(s, A, { t: 'play', c: 'WF', col: 'B', step: 0 }, noRng), 'must_stack')
    const res = apply(s, A, { t: 'play', c: 'GD', step: 0 })
    same(res.state.pending, { k: 'D', n: 4 })
  })

  test('hata fırlatılınca girdi değişmez', () => {
    const s = base()
    const before = copy(s)
    codeOf(() => R.applyMove(s, A, { t: 'play', c: 'B7', step: 0 }, noRng))
    codeOf(() => R.applyMove(s, A, { t: 'draw', step: 0 }, () => { throw new Error('x') }))
    same(s, before)
  })
})

describe('etkiler', () => {
  const three = (hand, extra) => table(Object.assign({
    hands: [hand, ['B1', 'B2', 'B3'], ['G1', 'G2', 'G3']],
    top: 'R9',
    deckTop: ['Y1', 'Y2', 'Y3', 'Y4']
  }, extra))

  test('Engel: sonraki atlanır', () => {
    const res = apply(three(['RS', 'R1', 'R2']), A, { t: 'play', c: 'RS', step: 0 })
    assert.equal(res.state.turn, 2)
    same(res.events, [{ e: 'play', p: A, c: 'RS', col: 'R' }, { e: 'skip', p: B }])
    assert.equal(res.state.step, 1)
  })

  test('Yön, 3 kişi: yön döner ve sıra bir önceki koltuğa geçer', () => {
    const res = apply(three(['RV', 'R1', 'R2']), A, { t: 'play', c: 'RV', step: 0 })
    assert.equal(res.state.dir, -1)
    assert.equal(res.state.turn, 2)
    same(res.events, [{ e: 'play', p: A, c: 'RV', col: 'R' }, { e: 'reverse', dir: -1 }])
    const next = apply(res.state, C, { t: 'draw', step: 1 })
    assert.equal(next.state.turn, 1)
  })

  test('Yön, 2 kişi: Engel gibi, oynayan yeniden oynar ve yön değişmez', () => {
    const s = table({ hands: [['RV', 'R1', 'R2'], ['B1', 'B2']], top: 'R9' })
    const res = apply(s, A, { t: 'play', c: 'RV', step: 0 })
    assert.equal(res.state.turn, 0)
    assert.equal(res.state.dir, 1)
    same(res.events, [{ e: 'play', p: A, c: 'RV', col: 'R' }, { e: 'skip', p: B }])
  })

  test('3 kişiden 2 kişiye düşünce Yön Engel gibi davranır', () => {
    const s = R.removePlayer(three(['RV', 'R1', 'R2']), C, seeded(3)).state
    const res = apply(s, A, { t: 'play', c: 'RV', step: 0 })
    assert.equal(res.state.turn, 0)
    assert.equal(res.state.dir, 1)
  })

  test('Resmî +2: sonraki 2 kart çeker ve atlanır', () => {
    const res = apply(three(['RD', 'R1', 'R2']), A, { t: 'play', c: 'RD', step: 0 })
    assert.equal(res.state.turn, 2)
    assert.equal(res.state.pending, null)
    same(handOf(res.state, B), ['B1', 'B2', 'B3', 'Y1', 'Y2'])
    same(res.events, [{ e: 'play', p: A, c: 'RD', col: 'R' }, { e: 'penalty', p: B, n: 2, want: 2, why: 'D' }, { e: 'skip', p: B }])
  })

  test('Resmî +4: renk seçilir, sonraki 4 kart çeker ve atlanır', () => {
    const res = apply(three(['WF', 'B5', 'G9']), A, { t: 'play', c: 'WF', col: 'G', step: 0 })
    assert.equal(res.state.color, 'G')
    assert.equal(res.state.turn, 2)
    assert.equal(handOf(res.state, B).length, 7)
    same(res.events, [{ e: 'play', p: A, c: 'WF', col: 'G' }, { e: 'penalty', p: B, n: 4, want: 4, why: 'F' }, { e: 'skip', p: B }])
  })

  test('Joker rengi değiştirir, renkli kart kendi rengini verir', () => {
    const res = apply(three(['WW', 'B5', 'G9']), A, { t: 'play', c: 'WW', col: 'Y', step: 0 })
    assert.equal(res.state.color, 'Y')
    assert.equal(res.state.turn, 1)
    const res2 = apply(three(['R4', 'B5', 'G9']), A, { t: 'play', c: 'R4', step: 0 })
    assert.equal(res2.state.color, 'R')
  })

  test('ters yönde Engel ve +2 doğru koltuğu atlar', () => {
    const s = three(['RS', 'RD', 'R2'], { dir: -1 })
    const res = apply(s, A, { t: 'play', c: 'RS', step: 0 })
    assert.equal(res.state.turn, 1)
    same(res.events[1], { e: 'skip', p: C })
    const res2 = apply(s, A, { t: 'play', c: 'RD', step: 0 })
    assert.equal(res2.state.turn, 1)
    assert.equal(handOf(res2.state, C).length, 5)
  })
})

describe('çekme', () => {
  test('oynanabilir çekilen kartta drawn aşaması açılır, görünümde play görünür', () => {
    const s = table({ hands: [['B5', 'G1'], ['B1', 'B2']], top: 'R3', deckTop: ['R7'] })
    const res = apply(s, A, { t: 'draw', step: 0 })
    const t = res.state
    assert.equal(t.phase, 'drawn')
    assert.equal(t.drawn, 'R7')
    assert.equal(t.turn, 0)
    same(res.events, [{ e: 'draw', p: A, n: 1 }])
    const view = R.publicView(t)
    assert.equal(view.phase, 'play')
    same(R.privateView(t, A), { cards: ['B5', 'G1', 'R7'], drawn: 'R7' })
    same(R.privateView(t, B), { cards: ['B1', 'B2'], drawn: null })
    const lm = R.legalMoves(view, R.privateView(t, A), A)
    assert.equal(lm.pass, true)
    assert.equal(lm.draw, false)
    assert.equal(lm.drawn, 'R7')
    same(lm.play, ['R7'])
    same(lm.blocked, { B5: 'only_drawn', G1: 'only_drawn' })
    const passed = apply(t, A, { t: 'pass', step: 1 })
    assert.equal(passed.state.turn, 1)
    assert.equal(passed.state.phase, 'play')
    assert.equal(passed.state.drawn, null)
    same(passed.events, [{ e: 'pass', p: A }])
    const played = apply(t, A, { t: 'play', c: 'R7', step: 1 })
    assert.equal(played.state.turn, 1)
  })

  test('elde oynanabilir kart varken çekmek serbesttir', () => {
    const s = table({ hands: [['R5', 'G1'], ['B1', 'B2']], top: 'R3', deckTop: ['B9'] })
    const res = apply(s, A, { t: 'draw', step: 0 })
    assert.equal(res.state.turn, 1)
  })

  test('oynanamayan çekilen kartta sıra geçer', () => {
    const s = table({ hands: [['B5', 'G1'], ['B1', 'B2']], top: 'R3', deckTop: ['B9'] })
    const res = apply(s, A, { t: 'draw', step: 0 })
    assert.equal(res.state.turn, 1)
    assert.equal(res.state.phase, 'play')
    assert.equal(res.state.drawn, null)
    same(handOf(res.state, A), ['B5', 'G1', 'B9'])
    same(res.events, [{ e: 'draw', p: A, n: 1 }])
  })

  test('çekilen Joker +4 elde etkin renk varken oynanamaz, yokken oynanabilir', () => {
    const withColor = table({ hands: [['R5', 'G1'], ['B1', 'B2']], top: 'R3', deckTop: ['WF'] })
    const res = apply(withColor, A, { t: 'draw', step: 0 })
    assert.equal(res.state.turn, 1)
    assert.equal(res.state.phase, 'play')
    const without = table({ hands: [['B5', 'G1'], ['B1', 'B2']], top: 'R3', deckTop: ['WF'] })
    const res2 = apply(without, A, { t: 'draw', step: 0 })
    assert.equal(res2.state.phase, 'drawn')
    assert.equal(res2.state.drawn, 'WF')
  })

  test('deste boşalınca üstteki hariç atılanlar karıştırılıp deste olur', () => {
    const s = table({ hands: [['B5', 'G1'], ['B1', 'B2']], top: 'R3', rest: 'discard' })
    assert.equal(s.deck.length, 0)
    const res = apply(s, A, { t: 'draw', step: 0 }, seeded(5))
    assert.equal(res.events[0].e, 'reshuffle')
    assert.equal(res.events[0].n, 103)
    same(res.state.discard, ['R3'])
    assert.equal(res.state.deck.length, 102)
  })

  test('deste ve atılanlar boşsa draw nodraw olur ve sıra geçer', () => {
    const s = table({ hands: [['B5', 'G1'], ['B1', 'B2']], top: 'R3', rest: 1 })
    const res = apply(s, A, { t: 'draw', step: 0 }, noRng)
    same(res.events, [{ e: 'nodraw', p: A }])
    assert.equal(res.state.turn, 1)
    assert.equal(res.state.step, 1)
  })

  test('ceza çekiminde var olan kadar kart verilir, want ve n ayrı gider', () => {
    const s = table({ hands: [['RD', 'G1', 'G2'], ['B1', 'B2'], ['Y1']], top: 'R3', rest: 2 })
    const res = apply(s, A, { t: 'play', c: 'RD', step: 0 }, seeded(4))
    const pen = res.events.find((ev) => ev.e === 'penalty')
    same(pen, { e: 'penalty', p: B, n: 1, want: 2, why: 'D' })
    assert.ok(eventNames(res.events).indexOf('reshuffle') > 0)
    same(res.state.discard, ['RD'])
  })

  test('kilitlenme olmaz: her şey eldeyken Joker hep oynanabilir', () => {
    const s = table({ hands: [['WW', 'B5'], ['B1', 'B2']], top: 'R3', rest: 1 })
    const lm = R.legalMoves(R.publicView(s), R.privateView(s, A), A)
    same(lm.play, ['WW'])
  })
})

describe('üst üste ekleme', () => {
  const four = () => table({
    rules: 'stack',
    hands: [['RD', 'R1', 'R2'], ['BD', 'B1', 'B2'], ['YD', 'Y1', 'Y2'], ['G1', 'G2', 'G3']],
    top: 'R9',
    deckTop: ['G4', 'G5', 'G6', 'G7', 'G8', 'G9']
  })

  test('RD BD YD sonrası 6 kart birikir, draw 6 kart verir ve sıra geçer', () => {
    let s = four()
    s = apply(s, A, { t: 'play', c: 'RD', step: 0 }).state
    same(s.pending, { k: 'D', n: 2 })
    assert.equal(s.turn, 1)
    s = apply(s, B, { t: 'play', c: 'BD', step: 1 }).state
    s = apply(s, C, { t: 'play', c: 'YD', step: 2 }).state
    same(s.pending, { k: 'D', n: 6 })
    same(R.publicView(s).pending, { k: 'D', n: 6 })
    const lm = R.legalMoves(R.publicView(s), R.privateView(s, D), D)
    assert.equal(lm.take, 6)
    assert.equal(lm.draw, true)
    same(lm.play, [])
    same(lm.blocked, { G1: 'must_stack', G2: 'must_stack', G3: 'must_stack' })
    const res = apply(s, D, { t: 'draw', step: 3 })
    same(res.events, [{ e: 'penalty', p: D, n: 6, want: 6, why: 'stack' }])
    assert.equal(res.state.pending, null)
    assert.equal(res.state.turn, 0)
    assert.equal(res.state.phase, 'play')
    assert.equal(handOf(res.state, D).length, 9)
  })

  test('+2 üstüne Joker +4 ve Joker +4 üstüne +2 must_stack döner', () => {
    const s = table({ rules: 'stack', hands: [['WF', 'BD', 'B1'], ['B2', 'B3']], top: 'RD', pending: { k: 'D', n: 2 } })
    throwsCode(() => R.applyMove(s, A, { t: 'play', c: 'WF', col: 'B', step: 0 }, noRng), 'must_stack')
    const f = table({ rules: 'stack', hands: [['WF', 'BD', 'B1'], ['B2', 'B3']], top: 'WF', color: 'B', pending: { k: 'F', n: 4 } })
    throwsCode(() => R.applyMove(f, A, { t: 'play', c: 'BD', step: 0 }, noRng), 'must_stack')
  })

  test('Joker +4 üstüne Joker +4 elde etkin renk olsa bile geçerlidir', () => {
    let s = table({ rules: 'stack', hands: [['WF', 'B1', 'B2'], ['WF', 'R5', 'R6']], top: 'R3' })
    s = apply(s, A, { t: 'play', c: 'WF', col: 'R', step: 0 }).state
    same(s.pending, { k: 'F', n: 4 })
    const res = apply(s, B, { t: 'play', c: 'WF', col: 'G', step: 1 })
    same(res.state.pending, { k: 'F', n: 8 })
    assert.equal(res.state.color, 'G')
  })

  test('Resmî sette +2 üstüne +2 konamaz: ceza hemen çekilir ve sıra atlanır', () => {
    const s = table({ hands: [['RD', 'R1', 'R2'], ['BD', 'B1'], ['G1', 'G2']], top: 'R9' })
    const res = apply(s, A, { t: 'play', c: 'RD', step: 0 })
    assert.equal(res.state.pending, null)
    assert.equal(res.state.turn, 2)
    throwsCode(() => R.applyMove(res.state, B, { t: 'play', c: 'BD', step: 1 }, noRng), 'not_your_turn')
  })

  test('son kart +2 ve birikmiş 4 varsa sıradaki 6 kart çeker', () => {
    let s = table({
      rules: 'stack',
      hands: [['RD', 'R1', 'R2'], ['BD', 'B1', 'B2'], ['YD']],
      top: 'R9',
      deckTop: ['G1', 'G2', 'G3', 'G4', 'G5', 'G6']
    })
    s = apply(s, A, { t: 'play', c: 'RD', step: 0 }).state
    s = apply(s, B, { t: 'play', c: 'BD', step: 1 }).state
    same(s.pending, { k: 'D', n: 4 })
    const res = apply(s, C, { t: 'play', c: 'YD', step: 2 })
    assert.equal(res.state.phase, 'over')
    same(res.events.find((ev) => ev.e === 'penalty'), { e: 'penalty', p: A, n: 6, want: 6, why: 'stack' })
    assert.equal(handOf(res.state, A).length, 8)
    assert.equal(res.state.pending, null)
    assert.equal(res.state.result.winner, C)
  })
})

describe('Tek!', () => {
  const two = (hand) => table({ hands: [hand, ['B1', 'B2', 'B3']], top: 'R9', deckTop: ['Y1', 'Y2', 'Y3', 'Y4'] })

  test('Tek! diyen korunur, yakalanamaz', () => {
    const res = apply(two(['R5', 'R6']), A, { t: 'play', c: 'R5', last: true, step: 0 })
    same(res.state.last, { p: A, safe: true })
    same(res.events[1], { e: 'last', p: A, late: false })
    throwsCode(() => R.applyMove(res.state, B, { t: 'catch', p: A }, noRng), 'not_catchable')
    throwsCode(() => R.applyMove(res.state, A, { t: 'last' }, noRng), 'no_last')
  })

  test('korunmayan oyuncu yakalanır, 2 kart çeker, step değişmez', () => {
    const s = apply(two(['R5', 'R6']), A, { t: 'play', c: 'R5', step: 0 }).state
    same(s.last, { p: A, safe: false })
    const view = R.publicView(s)
    assert.equal(R.legalMoves(view, R.privateView(s, B), B).catch, A)
    assert.equal(R.legalMoves(view, R.privateView(s, A), A).last, true)
    const res = apply(s, B, { t: 'catch', p: A })
    same(res.events, [{ e: 'caught', p: A, by: B }, { e: 'penalty', p: A, n: 2, want: 2, why: 'last' }])
    assert.equal(res.state.last, null)
    assert.equal(res.state.step, s.step)
    assert.equal(res.state.turn, s.turn)
    same(handOf(res.state, A), ['R6', 'Y1', 'Y2'])
  })

  test('geç bildirim korur, step değişmez', () => {
    const s = apply(two(['R5', 'R6']), A, { t: 'play', c: 'R5', step: 0 }).state
    const res = apply(s, A, { t: 'last' })
    same(res.events, [{ e: 'last', p: A, late: true }])
    same(res.state.last, { p: A, safe: true })
    assert.equal(res.state.step, s.step)
    throwsCode(() => R.applyMove(res.state, B, { t: 'catch', p: A }, noRng), 'not_catchable')
    // Bekleyen tur hamlesi bayatlamaz
    apply(res.state, B, { t: 'draw', step: s.step })
  })

  test('kendini ya da pencere dışındaki kişiyi yakalamak çalışmaz', () => {
    const s = table({ hands: [['R5', 'R6'], ['B1', 'B2', 'B3'], ['G1', 'G2']], top: 'R9' })
    const t = apply(s, A, { t: 'play', c: 'R5', step: 0 }).state
    throwsCode(() => R.applyMove(t, A, { t: 'catch', p: A }, noRng), 'self_catch')
    throwsCode(() => R.applyMove(t, B, { t: 'catch', p: C }, noRng), 'not_catchable')
    throwsCode(() => R.applyMove(t, B, { t: 'catch', p: '999' }, noRng), 'not_catchable')
    // Sırası olmayan oyuncu da yakalayabilir
    apply(t, C, { t: 'catch', p: A })
  })

  test('sonraki tur hamlesinden sonra yakalama not_catchable döner', () => {
    const s = apply(two(['R5', 'R6']), A, { t: 'play', c: 'R5', step: 0 }).state
    const t = apply(s, B, { t: 'draw', step: 1 }).state
    assert.equal(t.last, null)
    throwsCode(() => R.applyMove(t, B, { t: 'catch', p: A }, noRng), 'not_catchable')
  })

  test('Resmî +2 ile tek karta düşenin penceresi atlanan oyuncudan sonrakinin hamlesine kadar açık kalır', () => {
    const s = table({ hands: [['RD', 'R6'], ['B1', 'B2'], ['G1', 'G2']], top: 'R9', deckTop: ['Y1', 'Y2', 'Y3', 'Y4'] })
    const t = apply(s, A, { t: 'play', c: 'RD', step: 0 }).state
    assert.equal(t.turn, 2)
    same(t.last, { p: A, safe: false })
    apply(t, B, { t: 'catch', p: A })
    const u = apply(t, C, { t: 'draw', step: 1 }).state
    assert.equal(u.last, null)
    throwsCode(() => R.applyMove(u, B, { t: 'catch', p: A }, noRng), 'not_catchable')
  })

  test('2 kişide Engel ile tek karta düşenin penceresini kendi sonraki hamlesi kapatır', () => {
    const s = table({ hands: [['RS', 'R6'], ['B1', 'B2']], top: 'R9', deckTop: ['B9'] })
    const t = apply(s, A, { t: 'play', c: 'RS', step: 0 }).state
    assert.equal(t.turn, 0)
    same(t.last, { p: A, safe: false })
    apply(t, B, { t: 'catch', p: A })
    const u = apply(t, A, { t: 'draw', step: 1 }).state
    assert.equal(u.last, null)
    assert.equal(u.turn, 1)
    throwsCode(() => R.applyMove(u, B, { t: 'catch', p: A }, noRng), 'not_catchable')
  })

  test('2 karta düşüren oyunda last:true yok sayılır', () => {
    const res = apply(two(['R5', 'R6', 'R7']), A, { t: 'play', c: 'R5', last: true, step: 0 })
    assert.equal(res.state.last, null)
    same(eventNames(res.events), ['play'])
  })

  test('armLast: sıra bende, 2 kartım var ve en az biri oynanabilir', () => {
    const lm = (hand) => {
      const s = two(hand)
      return R.legalMoves(R.publicView(s), R.privateView(s, A), A).armLast
    }
    assert.equal(lm(['R5', 'B6']), true)
    assert.equal(lm(['G5', 'B6']), false)
    assert.equal(lm(['R5', 'R6', 'R7']), false)
  })

  test('LAST_CARD.stack false yapılan kopyada eklemeli sette pencere açılmaz', () => {
    assert.ok(RENK_SRC.indexOf(LAST_LINE) >= 0, 'sabit satırı kaynakta')
    const R2 = loadEngine({ src: RENK_SRC.replace(LAST_LINE, 'const LAST_CARD = { official: true, stack: false }') }).TelsizRenk
    same(R2.LAST_CARD, { official: true, stack: false })
    const s = table({ rules: 'stack', hands: [['R5', 'R6'], ['B1', 'B2', 'B3']], top: 'R9', engine: R2 })
    const res = R2.applyMove(s, A, { t: 'play', c: 'R5', last: true, step: 0 }, seeded(1))
    assert.equal(res.state.last, null)
    same(eventNames(res.events), ['play'])
    checkAll(res.state, res.events, R2)
    throwsCode(() => R2.applyMove(res.state, A, { t: 'last' }, noRng), 'no_last')
    throwsCode(() => R2.applyMove(res.state, B, { t: 'catch', p: A }, noRng), 'not_catchable')
    assert.equal(R2.legalMoves(R2.publicView(s), R2.privateView(s, A), A).armLast, false)
    // Pencere açık tam durum bu kopyada geçersizdir
    const open = copy(res.state)
    open.last = { p: A, safe: false }
    assert.equal(R2.validateState(open), null)
    // Resmî sette pencere hâlâ açılır
    const o = table({ hands: [['R5', 'R6'], ['B1', 'B2', 'B3']], top: 'R9', engine: R2 })
    same(R2.applyMove(o, A, { t: 'play', c: 'R5', step: 0 }, seeded(1)).state.last, { p: A, safe: false })
  })
})

describe('ayrılma', () => {
  const four = (extra) => table(Object.assign({
    hands: [['R1', 'R2', 'R3'], ['B1', 'B2'], ['G1', 'G2', 'G3', 'G4'], ['Y1', 'Y2']],
    top: 'R9'
  }, extra))

  test('kartlar desteye eklenir ve bütün deste yeniden karıştırılır, aynı tohumla sonuç aynıdır', () => {
    const s = four()
    const res = R.removePlayer(s, C, seeded(11))
    checkAll(res.state, res.events)
    same(res.events, [{ e: 'leave', p: C, n: 4 }])
    assert.equal(res.state.deck.length, s.deck.length + 4)
    assert.notDeepEqual(copy(res.state.deck), s.deck.concat(handOf(s, C)))
    same(R.removePlayer(s, C, seeded(11)), res)
    same(seatIds(res.state), [A, B, D])
    throwsCode(() => R.removePlayer(s, '999', seeded(1)), 'bad_player')
  })

  test('ayrılan koltuk sıradakinden önceyse sıra bir azalır, sonraysa değişmez', () => {
    const s = four({ turn: 2 })
    const res = R.removePlayer(s, A, seeded(1))
    assert.equal(res.state.turn, 1)
    assert.equal(R.turnOf(res.state), C)
    assert.equal(res.state.step, 0)
    const t = four({ turn: 1 })
    const res2 = R.removePlayer(t, D, seeded(1))
    assert.equal(res2.state.turn, 1)
    assert.equal(R.turnOf(res2.state), B)
  })

  test('sıradaki ayrılırsa sıra yöne göre sonrakine geçer ve step artar', () => {
    const fwd = R.removePlayer(four({ turn: 1 }), B, seeded(1)).state
    assert.equal(R.turnOf(fwd), C)
    assert.equal(fwd.step, 1)
    const back = R.removePlayer(four({ turn: 1, dir: -1 }), B, seeded(1)).state
    assert.equal(R.turnOf(back), A)
    const last = R.removePlayer(four({ turn: 3 }), D, seeded(1)).state
    assert.equal(R.turnOf(last), A)
    const first = R.removePlayer(four({ turn: 0, dir: -1 }), A, seeded(1)).state
    assert.equal(R.turnOf(first), D)
  })

  test('sıradaki ayrılırsa drawn boşalır, renk seçimi sıradakine geçer', () => {
    const drawn = R.removePlayer(four({ turn: 1, phase: 'drawn', drawn: 'B2' }), B, seeded(1))
    checkAll(drawn.state, drawn.events)
    assert.equal(drawn.state.phase, 'play')
    assert.equal(drawn.state.drawn, null)
    const color = R.removePlayer(four({ turn: 1, phase: 'color', top: 'WW', color: null }), B, seeded(1))
    checkAll(color.state, color.events)
    assert.equal(color.state.phase, 'color')
    assert.equal(R.turnOf(color.state), C)
  })

  test('bekleyen ceza sıradakiyle düşer, başkası ayrılınca korunur', () => {
    const s = four({ rules: 'stack', turn: 1, top: 'RD', pending: { k: 'D', n: 4 } })
    const gone = R.removePlayer(s, B, seeded(1))
    same(gone.events, [{ e: 'leave', p: B, n: 2 }, { e: 'pending_dropped', n: 4 }])
    assert.equal(gone.state.pending, null)
    const kept = R.removePlayer(s, D, seeded(1))
    same(kept.state.pending, { k: 'D', n: 4 })
    assert.equal(kept.state.step, 0)
  })

  test('Tek! sahibi ayrılınca pencere kapanır, başkası ayrılınca açık kalır', () => {
    const s = table({ hands: [['R1', 'R2'], ['B1', 'B2'], ['G1'], ['Y1', 'Y2']], top: 'R9', turn: 3, last: { p: C, safe: false } })
    assert.equal(R.removePlayer(s, C, seeded(1)).state.last, null)
    same(R.removePlayer(s, A, seeded(1)).state.last, { p: C, safe: false })
  })

  test('dağıtan koltuk: önceki koltuk çıkınca bir azalır, kendisi çıkınca yöne göre sonraki olur', () => {
    assert.equal(R.removePlayer(four({ dealSeat: 2 }), A, seeded(1)).state.dealSeat, 1)
    assert.equal(R.removePlayer(four({ dealSeat: 2 }), D, seeded(1)).state.dealSeat, 2)
    assert.equal(R.removePlayer(four({ dealSeat: 2 }), C, seeded(1)).state.dealSeat, 2)
    assert.equal(R.removePlayer(four({ dealSeat: 2, dir: -1 }), C, seeded(1)).state.dealSeat, 1)
    assert.equal(R.removePlayer(four({ dealSeat: 3 }), D, seeded(1)).state.dealSeat, 0)
  })

  test('2 kişinin altına düşülürse oyun too_few ile biter', () => {
    const s = table({ hands: [['R1', 'R2'], ['B1', 'B2']], top: 'R9', turn: 1 })
    const res = R.removePlayer(s, B, seeded(1))
    checkAll(res.state, res.events)
    const t = res.state
    assert.equal(t.phase, 'over')
    assert.equal(t.turn, -1)
    assert.equal(R.turnOf(t), null)
    same(t.result, { reason: 'too_few', winner: null, total: 0, ranks: [{ id: A, n: 2, points: 3, rank: 1 }] })
    same(res.events, [{ e: 'leave', p: B, n: 2 }, { e: 'end', winner: null, total: 0, reason: 'too_few' }])
  })

  test('renk seçilmeden 2 kişinin altına düşülürse bitmiş durum yine geçerlidir', () => {
    const s = table({ hands: [['R1', 'R2'], ['B1', 'B2']], top: 'WW', color: null, phase: 'color', turn: 1 })
    const res = R.removePlayer(s, A, seeded(1))
    checkAll(res.state, res.events)
    assert.equal(res.state.color, null)
    assert.equal(R.publicView(res.state).phase, 'over')
  })

  test('oyun bitmişse koltuk silinir, sonuç değişmez, deste karıştırılmaz', () => {
    const s = table({ hands: [['R5'], ['B1', 'B2'], ['G1', 'G2']], top: 'R9' })
    const over = apply(s, A, { t: 'play', c: 'R5', step: 0 }).state
    const res = R.removePlayer(over, B, noRng)
    checkAll(res.state, res.events)
    same(res.state.result, over.result)
    same(seatIds(res.state), [A, C])
    same(res.state.deck, over.deck.concat(['B1', 'B2']))
    same(res.events, [{ e: 'leave', p: B, n: 2 }])
    // Son kişiler de çıkabilir
    const empty = R.removePlayer(R.removePlayer(res.state, A, noRng).state, C, noRng).state
    checkAll(empty, [])
    assert.equal(empty.seats.length, 0)
    assert.equal(R.validateView(R.publicView(empty), []) !== null, true)
  })
})

describe('sonuç', () => {
  test('kazanan birinci, diğerleri puana göre artan, eşit puan aynı sıra (1, 2, 2, 4)', () => {
    const s = table({ hands: [['R5'], ['B5'], ['G2', 'G3'], ['YS']], top: 'R1' })
    const res = apply(s, A, { t: 'play', c: 'R5', step: 0 })
    const t = res.state
    assert.equal(R.isOver(t), true)
    assert.equal(t.turn, -1)
    same(t.result, {
      reason: 'out',
      winner: A,
      total: 30,
      ranks: [
        { id: A, n: 0, points: 0, rank: 1 },
        { id: B, n: 1, points: 5, rank: 2 },
        { id: C, n: 2, points: 5, rank: 2 },
        { id: D, n: 1, points: 20, rank: 4 }
      ]
    })
    same(res.events[res.events.length - 1], { e: 'end', winner: A, total: 30, reason: 'out' })
    for (const row of t.result.ranks) same(Object.keys(row), ['id', 'n', 'points', 'rank'])
    assert.equal(JSON.stringify(t.result).indexOf('cards'), -1)
    const view = R.publicView(t)
    assert.equal(view.turn, null)
    assert.equal(view.phase, 'over')
    same(view.result, t.result)
  })

  test('sıfır puanlı kaybeden kazananla aynı sırayı almaz', () => {
    const s = table({ hands: [['R5'], ['R0'], ['B1']], top: 'R1' })
    const t = apply(s, A, { t: 'play', c: 'R5', step: 0 }).state
    same(t.result.ranks.map((x) => x.rank), [1, 2, 3])
    assert.equal(t.result.total, 1)
  })

  test('son kart +2 ise sıradaki önce çeker, puan buna göre hesaplanır', () => {
    const s = table({ hands: [['RD'], ['B5'], ['G1']], top: 'R1', deckTop: ['Y9', 'YS'] })
    const res = apply(s, A, { t: 'play', c: 'RD', step: 0 })
    same(res.events.find((ev) => ev.e === 'penalty'), { e: 'penalty', p: B, n: 2, want: 2, why: 'D' })
    assert.equal(res.state.result.total, 5 + 9 + 20 + 1)
    same(res.state.result.ranks.map((x) => x.id), [A, C, B])
  })

  test('son kart Joker +4 ise renksiz de oynanır ve sıradaki 4 kart çeker', () => {
    const s = table({ hands: [['WF'], ['B5'], ['G1']], top: 'R1', deckTop: ['Y1', 'Y2', 'Y3', 'Y4'] })
    const res = apply(s, A, { t: 'play', c: 'WF', step: 0 })
    assert.equal(res.state.color, 'R')
    assert.equal(handOf(res.state, B).length, 5)
    assert.equal(res.state.result.total, 5 + 1 + 2 + 3 + 4 + 1)
  })

  test('endGame: winner null, total 0, puana göre sıralama', () => {
    const s = table({ hands: [['RS', 'R1'], ['B5'], ['G2', 'G3']], top: 'R9', phase: 'drawn', drawn: 'R1' })
    const res = R.endGame(s)
    checkAll(res.state, res.events)
    same(res.state.result, {
      reason: 'ended',
      winner: null,
      total: 0,
      ranks: [
        { id: B, n: 1, points: 5, rank: 1 },
        { id: C, n: 2, points: 5, rank: 1 },
        { id: A, n: 2, points: 21, rank: 3 }
      ]
    })
    same(res.events, [{ e: 'end', winner: null, total: 0, reason: 'ended' }])
    assert.equal(res.state.drawn, null)
    throwsCode(() => R.endGame(res.state), 'game_over')
  })
})

// Görünümdeki her değeri yoluyla gezer
function walkValues (x, at, visit) {
  visit(at, x)
  if (Array.isArray(x)) x.forEach((v, i) => walkValues(v, at + '.' + i, visit))
  else if (x && typeof x === 'object') Object.keys(x).forEach((key) => walkValues(x[key], at + '.' + key, visit))
}

// publicView hiçbir elin kartını taşımaz: kart kodu yalnızca top alanında olabilir, hiçbir dizi bir ele eşit değildir
function assertNoHands (s, view) {
  const hands = s.seats.filter((x) => x.hand.length > 0).map((x) => JSON.stringify(x.hand))
  walkValues(view, 'view', (at, v) => {
    if (typeof v === 'string' && R.isCard(v)) assert.equal(at, 'view.top', 'kart kodu: ' + at)
    if (Array.isArray(v)) assert.equal(hands.indexOf(JSON.stringify(v)), -1, 'el dizisi: ' + at)
  })
}

describe('görünümler', () => {
  const base = () => table({
    rules: 'stack',
    hands: [['R5', 'R6'], ['B1', 'B2', 'B3'], ['G1']],
    top: 'R9',
    turn: 1,
    step: 4,
    last: { p: C, safe: false }
  })

  test('publicView alanları', () => {
    const s = base()
    same(R.publicView(s), {
      v: 1,
      rules: 'stack',
      seats: [{ id: A, n: 2 }, { id: B, n: 3 }, { id: C, n: 1 }],
      turn: B,
      dir: 1,
      top: 'R9',
      color: 'R',
      deck: 101,
      discard: 1,
      phase: 'play',
      pending: null,
      last: { p: C, safe: false },
      step: 4,
      result: null
    })
    assertNoHands(s, R.publicView(s))
  })

  test('privateView yalnız kendi elini ve kendi çektiğini verir', () => {
    const s = table({ hands: [['R5', 'R6'], ['B1', 'B2', 'B3']], top: 'R9', turn: 1, phase: 'drawn', drawn: 'B2' })
    same(R.privateView(s, A), { cards: ['R5', 'R6'], drawn: null })
    same(R.privateView(s, B), { cards: ['B1', 'B2', 'B3'], drawn: 'B2' })
    assert.equal(R.privateView(s, '999'), null)
  })

  test('görünüm ve el çıktısı tam durumla bağlantılı değildir', () => {
    const s = base()
    const view = R.publicView(s)
    view.seats[0].n = 50
    view.last.safe = true
    const mine = R.privateView(s, A)
    mine.cards.push('WW')
    assert.equal(s.seats[0].hand.length, 2)
    assert.equal(s.last.safe, false)
  })

  test('validateView geçerli görünümleri kabul eder', () => {
    const states = [
      base(),
      table({ hands: [['R5', 'R6'], ['B1', 'B2']], top: 'WW', color: null, phase: 'color' }),
      table({ rules: 'stack', hands: [['R5', 'R6'], ['B1', 'B2']], top: 'RD', pending: { k: 'D', n: 2 } }),
      table({ hands: [['R5', 'R6'], ['B1', 'B2']], top: 'R9', phase: 'drawn', drawn: 'R6' }),
      R.endGame(base()).state,
      apply(table({ hands: [['R5'], ['B1', 'B2']], top: 'R9' }), A, { t: 'play', c: 'R5', step: 0 }).state
    ]
    for (const s of states) {
      const view = R.publicView(s)
      assert.ok(R.validateView(view, seatIds(s)), JSON.stringify(view))
      for (const x of s.seats) assert.ok(R.validatePrivate(R.privateView(s, x.id), view, x.id))
      assertNoHands(s, view)
    }
  })

  test('validateView bozuk görünümleri reddeder', () => {
    const s = base()
    const good = copy(R.publicView(s))
    const ids = seatIds(s)
    assert.ok(R.validateView(good, ids))
    const over = copy(R.publicView(R.endGame(s).state))
    assert.ok(R.validateView(over, ids))
    const bad = [
      (v) => { v.extra = 1 },
      (v) => { delete v.step },
      (v) => { v.v = 2 },
      (v) => { v.rules = 'house' },
      (v) => { v.seats.reverse() },
      (v) => { v.seats[0].id = '999' },
      (v) => { v.seats[0].n = 0 },
      (v) => { v.seats[0].n = 109 },
      (v) => { v.seats[0].x = 1 },
      (v) => { v.turn = '999' },
      (v) => { v.turn = null },
      (v) => { v.dir = 0 },
      (v) => { v.top = 'W4' },
      (v) => { v.color = null },
      (v) => { v.color = 'X' },
      (v) => { v.phase = 'drawn' },
      (v) => { v.phase = 'color' },
      (v) => { v.deck = -1 },
      (v) => { v.discard = 0 },
      (v) => { v.deck += 1 },
      (v) => { v.pending = { k: 'D', n: 3 } },
      (v) => { v.pending = { k: 'X', n: 2 } },
      (v) => { v.pending = { k: 'D', n: 2, x: 1 } },
      (v) => { v.last = { p: '999', safe: false } },
      (v) => { v.last = { p: C, safe: 'no' } },
      (v) => { v.last = { p: A, safe: false } },
      (v) => { v.step = -1 },
      (v) => { v.result = over.result }
    ]
    for (const mutate of bad) {
      const v = copy(good)
      mutate(v)
      assert.equal(R.validateView(v, ids), null, mutate.toString())
    }
    assert.equal(R.validateView(good, ids.slice(1)), null)
    assert.equal(R.validateView(good, 'x'), null)
    assert.equal(R.validateView(null, ids), null)
    // Resmî sette ceza alanı dolu olamaz
    const official = copy(good)
    official.rules = 'official'
    assert.ok(R.validateView(Object.assign(copy(official), { pending: null }), ids))
    official.pending = { k: 'D', n: 2 }
    assert.equal(R.validateView(official, ids), null)
    const badOver = [
      (v) => { v.result = null },
      (v) => { v.turn = B },
      (v) => { v.last = { p: C, safe: false } },
      (v) => { v.result.reason = 'won' },
      (v) => { v.result.winner = A },
      (v) => { v.result.total = 5 },
      (v) => { v.result.ranks[0].cards = ['R1'] },
      (v) => { v.result.ranks[1].id = v.result.ranks[0].id },
      (v) => { v.result.ranks[0].rank = 0 }
    ]
    for (const mutate of badOver) {
      const v = copy(over)
      mutate(v)
      assert.equal(R.validateView(v, ids), null, mutate.toString())
    }
  })

  test('validatePrivate: el sayısı, kart biçimi ve çekilen kart', () => {
    const s = table({ hands: [['R5', 'R6'], ['B1', 'B2', 'B3']], top: 'R9', turn: 1, phase: 'drawn', drawn: 'B2' })
    const view = R.publicView(s)
    assert.ok(R.validatePrivate(copy(R.privateView(s, B)), view, B))
    // Üst kart kendi elimde de olabilir (aynı koddan iki kart)
    const dup = table({ hands: [['R9', 'R6'], ['B1', 'B2']], top: 'R9' })
    assert.ok(R.validatePrivate(R.privateView(dup, A), R.publicView(dup), A))
    const bad = [
      [{ cards: ['B1', 'B2'], drawn: null }, B],
      [{ cards: ['B1', 'B2', 'W4'], drawn: null }, B],
      [{ cards: ['B1', 'B2', 'B3'], drawn: 'B9' }, B],
      [{ cards: ['B1', 'B2', 'B3'], drawn: null, x: 1 }, B],
      [{ cards: ['B1', 'B2', 'B3'] }, B],
      [{ cards: 'B1', drawn: null }, B],
      [{ cards: ['R5', 'R6'], drawn: 'R5' }, A],
      [{ cards: ['R5', 'R6'], drawn: null }, '999'],
      [null, A]
    ]
    for (const [mine, id] of bad) assert.equal(R.validatePrivate(mine, view, id), null, JSON.stringify(mine))
  })

  test('legalMoves: sırası olmayan, bitmiş oyun ve sıradaki oyuncu', () => {
    const s = table({ hands: [['R5', 'R5', 'B7', 'WF', 'WW'], ['B1', 'B2']], top: 'R9' })
    const view = R.publicView(s)
    same(R.legalMoves(view, R.privateView(s, B), B), {
      turn: false,
      phase: 'play',
      drawn: null,
      play: [],
      blocked: {},
      draw: false,
      take: 0,
      pass: false,
      color: false,
      armLast: false,
      last: false,
      catch: null
    })
    same(R.legalMoves(view, R.privateView(s, A), A), {
      turn: true,
      phase: 'play',
      drawn: null,
      play: ['R5', 'WW'],
      blocked: { B7: 'not_playable', WF: 'wild4_has_color' },
      draw: true,
      take: 0,
      pass: false,
      color: false,
      armLast: false,
      last: false,
      catch: null
    })
    const over = R.endGame(s).state
    const lm = R.legalMoves(R.publicView(over), R.privateView(over, A), A)
    assert.equal(lm.turn, false)
    assert.equal(lm.phase, 'over')
    same(lm.play, [])
    assert.equal(lm.draw, false)
  })
})

// Rastgele ama belirlenimci oyuncu: çoğunlukla oynar, bazen oynamak yerine çeker
function chooseMove (lm, mine, step, pick) {
  if (lm.color) return { t: 'color', col: COLORS[pick(4)], step }
  const wantDraw = pick(100) < 15
  if (lm.play.length > 0 && !wantDraw) {
    const c = lm.play[pick(lm.play.length)]
    const move = { t: 'play', c, step }
    if (R.isWild(c) && mine.cards.length > 1) move.col = COLORS[pick(4)]
    if (mine.cards.length === 2 && pick(2) === 0) move.last = true
    return move
  }
  if (lm.pass) return { t: 'pass', step }
  return { t: 'draw', step }
}

// Eldeki her benzersiz kart için legalMoves.play içinde olmak ile applyMove başarısı aynıdır
function compareLegal (s, id, mine, lm) {
  const unique = mine.cards.filter((c, i) => mine.cards.indexOf(c) === i)
  for (const c of unique) {
    const move = { t: 'play', c, step: s.step }
    if (R.isWild(c) && mine.cards.length > 1) move.col = 'B'
    const code = codeOf(() => R.applyMove(s, id, move, seeded(1)))
    const listed = lm.play.indexOf(c) >= 0
    assert.equal(code === null, listed, c + ' ' + code)
    if (!listed) assert.equal(code, lm.blocked[c], c)
  }
  assert.equal(lm.armLast, mine.cards.length === 2 && lm.play.length > 0 && R.publicView(s).phase === 'play')
}

function playRandomGame (seed, opts) {
  const o = opts || {}
  const rng = seeded(seed)
  const pick = chooser(seed * 31 + 7)
  const n = 2 + (seed % 7)
  const rules = R.RULES[Math.floor(seed / 7) % 2]
  let res = R.newGame({ rules, players: IDS.slice(0, n), dealSeat: pick(n) }, rng)
  let s = res.state
  checkAll(s, res.events)
  if (o.onStep) o.onStep(s, res.events)
  const seen = {}
  let steps = 0
  while (!R.isOver(s)) {
    steps++
    assert.ok(steps < 20000, 'oyun 20000 adımda bitmedi, tohum ' + seed)
    const roll = pick(1000)
    const view = R.publicView(s)
    if (o.leaks) assertNoHands(s, view)
    let id = null
    let move = null
    if (roll < 4) {
      // Rastgele ayrılma
      res = R.removePlayer(s, s.seats[pick(s.seats.length)].id, rng)
    } else {
      if (view.last && !view.last.safe && roll < 300) {
        if (roll < 150) {
          id = view.last.p
          move = { t: 'last' }
        } else {
          const others = seatIds(s).filter((x) => x !== view.last.p)
          id = others[pick(others.length)]
          move = { t: 'catch', p: view.last.p }
        }
      } else {
        id = R.turnOf(s)
        const mine = R.privateView(s, id)
        const lm = R.legalMoves(view, mine, id)
        if (o.legal) compareLegal(s, id, mine, lm)
        move = chooseMove(lm, mine, s.step, pick)
      }
      res = R.applyMove(s, id, move, rng)
    }
    for (const ev of res.events) seen[ev.e] = true
    s = res.state
    checkAll(s, res.events)
    if (o.onStep) o.onStep(s, res.events)
  }
  assert.ok(['out', 'too_few'].indexOf(s.result.reason) >= 0)
  return { state: s, steps, seen }
}

describe('özellik testi', () => {
  test('200 tohumlu oyun: değişmezler, görünümler, legalMoves ile applyMove uyumu ve bitiş', () => {
    const seen = {}
    let longest = 0
    const counts = { official: 0, stack: 0 }
    for (const seed of range(1, 201)) {
      const out = playRandomGame(seed, { legal: seed <= 40, leaks: seed <= 10 })
      Object.keys(out.seen).forEach((e) => {
        seen[e] = true
      })
      longest = Math.max(longest, out.steps)
      counts[out.state.rules]++
    }
    assert.ok(longest < 20000)
    assert.ok(counts.official > 50 && counts.stack > 50, JSON.stringify(counts))
    // Sık görülen olayların hepsi en az bir kez çıktı
    for (const e of ['play', 'draw', 'pass', 'skip', 'reverse', 'penalty', 'last', 'caught', 'leave', 'end', 'reshuffle']) {
      assert.ok(seen[e], 'olay görülmedi: ' + e)
    }
  })

  test('aynı tohumla oyun belirlenimcidir', () => {
    same(playRandomGame(17).state, playRandomGame(17).state)
  })
})

// Kurpiyerin bir koltuğa göndereceği state gövdesi (4.4): Renk görünümleri ve olayları, olaylar masa sürümü r ile
function stateBody (s, me, r, events) {
  return {
    ph: R.isOver(s) ? 'over' : 'play',
    app: R.id,
    rules: s.rules,
    seats: seatIds(s),
    rd: 1,
    ack: { seq: 0, ok: true },
    view: R.publicView(s),
    mine: R.privateView(s, me),
    ev: events.slice(-CORE.MAX_EVENTS).map((ev) => Object.assign({ r }, ev)),
    away: []
  }
}

describe('protokol çekirdeğiyle uyum', () => {
  test('motorun kullandığı her çekirdek yardımcısı 33-oyun-protokol.js içinde bir işlevdir', () => {
    const used = Array.from(RENK_SRC.matchAll(/\bG\.([A-Za-z0-9_]+)/g), (m) => m[1])
    const names = used.filter((name, i) => used.indexOf(name) === i).sort()
    same(names, ['fail', 'isId', 'onlyKeys', 'ring', 'shuffle'])
    for (const name of names) assert.equal(typeof CORE[name], 'function', name)
    // Çekirdeğin rastgelelik hataları motorun hata listesinde
    for (const code of ['no_random', 'bad_random']) assert.ok(R.ERRORS.indexOf(code) >= 0, code)
    assert.equal(codeOf(() => R.newGame({ rules: 'official', players: [A, B], dealSeat: 0 }, noRng)), 'no_random')
    assert.equal(codeOf(() => R.newGame({ rules: 'official', players: [A, B], dealSeat: 0 }, () => [1, 2])), 'bad_random')
  })

  test('uygulama kimliği, kural setleri, hata ve olay kodları çekirdeğin desenlerine uyar', () => {
    assert.ok(CORE.isApp(R.id))
    assert.ok(R.MIN_PLAYERS >= 2 && R.MAX_PLAYERS <= CORE.MAX_SEATS)
    assert.ok(R.RULES.indexOf(R.DEFAULT_RULES) >= 0)
    for (const list of ['RULES', 'ERRORS', 'EVENTS']) {
      for (const code of R[list]) assert.ok(CORE.isCode(code), list + ' ' + code)
    }
    // Masa düzeyindeki hamle sonuçları uygulamanın hata listesinde de bulunur
    for (const code of CORE.DESK_ERRORS) assert.ok(R.ERRORS.indexOf(code) >= 0, code)
  })

  test('Renk görünümleri, elleri ve olayları state gövdesi denetiminden geçer', () => {
    let checked = 0
    for (const seed of range(1, 15)) {
      let r = 1
      playRandomGame(seed, {
        onStep: (s, events) => {
          r++
          const ids = seatIds(s)
          for (const me of ids) {
            const b = stateBody(s, me, r, events)
            const ctx = { dealer: ids[0], me, r, app: R.id, rules: R.RULES }
            assert.ok(CORE.validStateBody(b, ctx), 'tohum ' + seed + ' adım ' + r)
            assert.ok(R.validateView(b.view, b.seats) && R.validatePrivate(b.mine, b.view, me))
            checked++
          }
          // Gövde yazdırılabilir ASCII olarak kodlanır, taşıma sınırının altında kalır
          assert.equal(typeof CORE.encodePlain(stateBody(s, ids[ids.length - 1], r, events)), 'string')
        }
      })
    }
    assert.ok(checked > 1000, String(checked))
  })
})

describe('saflık', () => {
  test('kaynakta DOM, ağ, saat, rastgelelik ve sözlük kullanılmaz', () => {
    const banned = [/\bdocument\b/, /XMLHttpRequest/, /Math\.random/, /\bDate\b/, /setTimeout/, /setInterval/,
      /(^|[^\w$.])t\(/m, /structuredClone/, /localStorage/, /\bfetch\b/, /\bnavigator\b/]
    for (const re of banned) assert.equal(re.test(RENK_SRC), false, String(re))
  })

  test('çekirdek olmadan da boş bağlamda yüklenir, saf kart işlevleri çalışır', () => {
    const bare = loadEngine({ core: false }).TelsizRenk
    assert.ok(bare)
    assert.equal(bare.buildDeck().length, 108)
    assert.equal(bare.isCard('WF'), true)
    assert.equal(bare.points('RS'), 20)
  })

  test('dışa açılan nesne ve listeler dondurulmuştur', () => {
    assert.ok(Object.isFrozen(R))
    for (const key of ['RULES', 'ERRORS', 'EVENTS', 'COLORS', 'LAST_CARD']) assert.ok(Object.isFrozen(R[key]), key)
    assert.equal(R.id, 'renk')
    assert.equal(R.VERSION, 1)
    assert.equal(R.MIN_PLAYERS, 2)
    assert.equal(R.MAX_PLAYERS, 8)
    assert.equal(R.DEFAULT_RULES, 'official')
    assert.equal(R.HIDDEN, true)
    same(R.RULES, ['official', 'stack'])
    same(R.LAST_CARD, { official: true, stack: true })
    for (const name of ['newGame', 'validateMove', 'applyMove', 'removePlayer', 'endGame', 'isOver', 'turnOf',
      'publicView', 'privateView', 'validateView', 'validatePrivate', 'legalMoves', 'buildDeck', 'isCard',
      'parseCards', 'cardColor', 'cardValue', 'isWild', 'points', 'canPlay', 'validateState', 'dealFrom']) {
      assert.equal(typeof R[name], 'function', name)
    }
  })

  test('derin dondurulmuş durumla hamleler hata vermez ve girdi değişmez', () => {
    const s = deepFreeze(table({
      rules: 'stack',
      hands: [['R5', 'R6', 'WW'], ['B1', 'B2'], ['G1']],
      top: 'R9',
      deckTop: ['B9', 'R7'],
      last: { p: C, safe: false }
    }))
    const before = copy(s)
    apply(s, A, { t: 'play', c: 'R5', step: 0 })
    apply(s, A, { t: 'play', c: 'WW', col: 'G', step: 0 })
    apply(s, A, { t: 'draw', step: 0 })
    apply(s, B, { t: 'catch', p: C })
    apply(s, C, { t: 'last' })
    checkAll(R.removePlayer(s, B, seeded(2)).state, [])
    checkAll(R.removePlayer(s, A, seeded(2)).state, [])
    checkAll(R.endGame(s).state, [])
    R.legalMoves(R.publicView(s), R.privateView(s, A), A)
    same(s, before)
    const drawn = deepFreeze(apply(s, A, { t: 'draw', step: 0 }).state)
    apply(drawn, A, { t: 'pass', step: 1 })
    checkAll(R.removePlayer(drawn, A, seeded(3)).state, [])
  })

  test('kaynaktaki her fail kodu ve canPlay kodu ERRORS içinde', () => {
    const failed = Array.from(RENK_SRC.matchAll(/fail\('([^']*)'\)/g), (m) => m[1])
    assert.ok(failed.length >= 15, String(failed.length))
    for (const code of failed) assert.ok(R.ERRORS.indexOf(code) >= 0, code)
    const returned = Array.from(RENK_SRC.matchAll(/return '([a-z_0-9]+)'/g), (m) => m[1])
    assert.ok(returned.length > 0)
    for (const code of returned) assert.ok(R.ERRORS.indexOf(code) >= 0, code)
    same(R.ERRORS.slice().sort(), ['already_drawn', 'bad_move', 'bad_options', 'bad_player', 'bad_random',
      'cannot_pass', 'choose_color', 'game_over', 'must_stack', 'need_color', 'no_last', 'no_random',
      'not_catchable', 'not_in_hand', 'not_playable', 'not_your_turn', 'only_drawn', 'self_catch', 'stale',
      'wild4_has_color'])
  })
})
