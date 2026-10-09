'use strict'

// Renk kural motoru (window.TelsizRenk). DOM, ağ, saat ve sözlük kullanmaz, kullanıcıya görünen metin üretmez.
// Hatalar err.code ile, olaylar kodla verilir, arayüz game.renk.* anahtarlarıyla çevirir.
// Tam durum yalnızca kurpiyerin cihazında tutulur. Oyunculara publicView (herkese açık) ve privateView (kişinin
// kendi eli) gider, oyuncunun cihazı bunları validateView ve validatePrivate ile denetler. 34-oyun-masa.js motoru
// genel uygulama sözleşmesiyle (newGame, validateMove, applyMove, removePlayer, endGame, görünümler) çağırır.
// Kart kodu iki karakterdir: renk R Y G B, değer 0-9, S (Engel), V (Yön), D (+2). Jokerler WW ve WF (Joker +4).
// Değer harfleri benzersizdir, eşleştirme ve puan yalnızca kart kodundan çıkar.
// Rastgelelik yalnızca rng(n) ile gelir (kurpiyerde nacl.randomBytes), karıştırma TelsizGame.shuffle ile yapılır.
// Girdi durumu hiçbir zaman değiştirilmez: her işlem elle yazılmış bir kopya üzerinde çalışır.

window.TelsizRenk = (function (G) {
  const ID = 'renk'
  const VERSION = 1
  const MIN_PLAYERS = 2
  const MAX_PLAYERS = 8
  const RULES = ['official', 'stack']
  const DEFAULT_RULES = 'official'
  const COLORS = ['R', 'Y', 'G', 'B']
  const HAND_SIZE = 7
  const DECK_SIZE = 108
  // İlk kart Joker +4 çıkınca deste en çok bu kadar kez yeniden karıştırılır, sonra bad_random
  const MAX_REFLIP = 16
  const MAX_STEP = 1000000000
  const MAX_POINTS = DECK_SIZE * 50
  // Tek! kuralı: bir set için false olursa pencere hiç açılmaz
  const LAST_CARD = { official: true, stack: true }
  const CARD_RE = /^(?:[RYGB][0-9SVD]|W[WF])$/
  const PHASES = ['color', 'play', 'drawn', 'over']
  // Görünümde drawn aşaması play olarak görünür
  const VIEW_PHASES = ['color', 'play', 'over']
  const REASONS = ['out', 'too_few', 'ended']
  const ERRORS = ['bad_options', 'bad_random', 'no_random', 'bad_move', 'bad_player', 'game_over', 'not_your_turn',
    'stale', 'choose_color', 'not_in_hand', 'only_drawn', 'must_stack', 'not_playable', 'wild4_has_color',
    'need_color', 'already_drawn', 'cannot_pass', 'no_last', 'self_catch', 'not_catchable']
  const EVENTS = ['play', 'draw', 'nodraw', 'pass', 'color', 'skip', 'reverse', 'penalty', 'last', 'caught',
    'reshuffle', 'reflip', 'leave', 'pending_dropped', 'end']

  // Hamle alanları: izinli alanlar ve zorunlu olanlar. last ve catch sıra dışıdır, step taşımaz.
  const MOVE_KEYS = {
    play: ['t', 'c', 'col', 'last', 'step'],
    draw: ['t', 'step'],
    pass: ['t', 'step'],
    color: ['t', 'col', 'step'],
    last: ['t'],
    catch: ['t', 'p']
  }
  const MOVE_NEEDS = {
    play: ['t', 'c', 'step'],
    draw: ['t', 'step'],
    pass: ['t', 'step'],
    color: ['t', 'col', 'step'],
    last: ['t'],
    catch: ['t', 'p']
  }
  const OPTION_KEYS = ['rules', 'players', 'dealSeat']
  const STATE_KEYS = ['v', 'rules', 'seats', 'dealSeat', 'turn', 'dir', 'deck', 'discard', 'color', 'phase', 'drawn',
    'pending', 'last', 'step', 'result']
  const VIEW_KEYS = ['v', 'rules', 'seats', 'turn', 'dir', 'top', 'color', 'deck', 'discard', 'phase', 'pending',
    'last', 'step', 'result']
  const SEAT_KEYS = ['id', 'hand']
  const VIEW_SEAT_KEYS = ['id', 'n']
  const MINE_KEYS = ['cards', 'drawn']
  const PENDING_KEYS = ['k', 'n']
  const LAST_KEYS = ['p', 'safe']
  const RESULT_KEYS = ['reason', 'winner', 'total', 'ranks']
  const RANK_KEYS = ['id', 'n', 'points', 'rank']

  // Kanonik destedeki her kodun adedi (çoklu küme denetimi için)
  const COUNTS = countCards(buildDeck())

  // ----- Küçük yardımcılar -----

  function fail (code) {
    return G.fail(code)
  }

  function hasOwn (obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key)
  }

  // JSON nesnesi (dizi ve null değil). Başka bir bağlamdan gelebilir, ön örnek denetlenmez.
  function isPlain (x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x)
  }

  // Alan kümesi tam olarak keys
  function exactKeys (obj, keys) {
    return G.onlyKeys(obj, keys) && keys.every((key) => hasOwn(obj, key))
  }

  function isInt (n, min, max) {
    return Number.isInteger(n) && n >= min && n <= max
  }

  function isStep (n) {
    return isInt(n, 0, MAX_STEP)
  }

  // ----- Kartlar -----

  // Kanonik sıra: R Y G B için C0, C1 C1 ... C9 C9, CS CS CV CV CD CD, ardından 4 WW ve 4 WF. Sıra sabittir,
  // ileride denetlenebilir karıştırmada herkes desteyi yeniden hesaplayacak.
  function buildDeck () {
    const deck = []
    COLORS.forEach((col) => {
      deck.push(col + '0')
      let v = 1
      while (v <= 9) {
        deck.push(col + v, col + v)
        v++
      }
      deck.push(col + 'S', col + 'S', col + 'V', col + 'V', col + 'D', col + 'D')
    })
    let i = 0
    while (i < 4) {
      deck.push('WW')
      i++
    }
    i = 0
    while (i < 4) {
      deck.push('WF')
      i++
    }
    return deck
  }

  function countCards (list) {
    const out = {}
    list.forEach((c) => {
      out[c] = (out[c] || 0) + 1
    })
    return out
  }

  function isCard (c) {
    return typeof c === 'string' && CARD_RE.test(c)
  }

  function cardColor (c) {
    return c.charAt(0) === 'W' ? null : c.charAt(0)
  }

  function cardValue (c) {
    return c.charAt(1)
  }

  function isWild (c) {
    return c.charAt(0) === 'W'
  }

  function points (c) {
    if (isWild(c)) return 50
    const v = cardValue(c)
    if (v === 'S' || v === 'V' || v === 'D') return 20
    return Number(v)
  }

  // En çok 108 geçerli kart kodundan oluşan dizi, değilse null. Dönüş kendi kopyasıdır.
  function parseCards (list) {
    if (!Array.isArray(list) || list.length > DECK_SIZE) return null
    let i = 0
    while (i < list.length) {
      if (!isCard(list[i])) return null
      i++
    }
    return list.slice()
  }

  // Kartlar kanonik destenin tam olarak aynısı mı (108 kart, her koddan doğru adet)
  function isFullDeck (list) {
    if (list.length !== DECK_SIZE) return false
    const got = countCards(list)
    return Object.keys(COUNTS).every((c) => got[c] === COUNTS[c])
  }

  // ----- Kopyalama ve durum yardımcıları -----

  function cloneResult (r) {
    if (!r) return null
    return {
      reason: r.reason,
      winner: r.winner,
      total: r.total,
      ranks: r.ranks.map((x) => ({ id: x.id, n: x.n, points: x.points, rank: x.rank }))
    }
  }

  function cloneState (s) {
    return {
      v: s.v,
      rules: s.rules,
      seats: s.seats.map((x) => ({ id: x.id, hand: x.hand.slice() })),
      dealSeat: s.dealSeat,
      turn: s.turn,
      dir: s.dir,
      deck: s.deck.slice(),
      discard: s.discard.slice(),
      color: s.color,
      phase: s.phase,
      drawn: s.drawn,
      pending: s.pending ? { k: s.pending.k, n: s.pending.n } : null,
      last: s.last ? { p: s.last.p, safe: s.last.safe } : null,
      step: s.step,
      result: cloneResult(s.result)
    }
  }

  function seatIndex (s, id) {
    let i = 0
    while (i < s.seats.length) {
      if (s.seats[i].id === id) return i
      i++
    }
    return -1
  }

  function topCard (s) {
    return s.discard[s.discard.length - 1]
  }

  // Koltuk k çıkınca n kişilik yeni halkada yöne göre sıradaki koltuk
  function nextAfterRemoval (k, n, dir) {
    return dir === 1 ? k % n : (k - 1 + n) % n
  }

  // Sırayı from koltuğundan steps adım öteye verir, aşama play olur
  function advance (s, from, steps) {
    s.turn = G.ring(s.seats.length, from, s.dir, steps)
    s.phase = 'play'
    s.drawn = null
  }

  // Desteden bir kart. Deste boşsa üstteki hariç atılanlar karıştırılıp deste olur. İkisi de boşsa null.
  function drawOne (s, rng, ev) {
    if (s.deck.length === 0 && s.discard.length > 1) {
      const top = s.discard.pop()
      s.deck = G.shuffle(s.discard, rng)
      s.discard = [top]
      ev.push({ e: 'reshuffle', n: s.deck.length })
    }
    return s.deck.length > 0 ? s.deck.pop() : null
  }

  // Ceza çekimi: var olan kadar kart verilir, olayda verilen (n) ve istenen (want) birlikte gider
  function giveCards (s, seat, want, why, rng, ev) {
    let n = 0
    while (n < want) {
      const c = drawOne(s, rng, ev)
      if (c === null) break
      s.seats[seat].hand.push(c)
      n++
    }
    ev.push({ e: 'penalty', p: s.seats[seat].id, n: n, want: want, why: why })
  }

  function handPoints (hand) {
    return hand.reduce((sum, c) => sum + points(c), 0)
  }

  // Kazanan birinci sıradadır, diğerleri puana göre artan sırada dizilir, eşit puan aynı sırayı alır (1, 2, 2, 4).
  // Eldeki kartlar sonuçta yer almaz.
  function makeResult (s, reason, winner) {
    const rows = s.seats.map((x, i) => ({ id: x.id, n: x.hand.length, points: handPoints(x.hand), i: i }))
    const total = winner === null ? 0 : rows.reduce((sum, x) => (x.id === winner ? sum : sum + x.points), 0)
    rows.sort((a, b) => {
      if (a.id === winner) return -1
      if (b.id === winner) return 1
      return a.points - b.points || a.i - b.i
    })
    const ranks = []
    rows.forEach((x, i) => {
      const prev = i > 0 ? rows[i - 1] : null
      const tie = prev !== null && prev.id !== winner && prev.points === x.points
      ranks.push({ id: x.id, n: x.n, points: x.points, rank: tie ? ranks[i - 1].rank : i + 1 })
    })
    return { reason: reason, winner: winner, total: total, ranks: ranks }
  }

  function closeGame (s, reason, winner, ev) {
    s.phase = 'over'
    s.turn = -1
    s.drawn = null
    s.pending = null
    s.last = null
    s.result = makeResult(s, reason, winner)
    ev.push({ e: 'end', winner: winner, total: s.result.total, reason: reason })
  }

  // ----- Yeni el -----

  // Seçenekler: rules RULES içinde, players 2-8 benzersiz kimlik, dealSeat geçerli koltuk dizini.
  // Dönüş: kendi kopyası veya null.
  function validateOptions (o) {
    if (!isPlain(o) || !exactKeys(o, OPTION_KEYS) || RULES.indexOf(o.rules) < 0) return null
    const p = o.players
    if (!Array.isArray(p) || p.length < MIN_PLAYERS || p.length > MAX_PLAYERS) return null
    let i = 0
    while (i < p.length) {
      if (!G.isId(p[i]) || p.indexOf(p[i]) !== i) return null
      i++
    }
    if (!isInt(o.dealSeat, 0, p.length - 1)) return null
    return { rules: o.rules, players: p.slice(), dealSeat: o.dealSeat }
  }

  function newGame (opts, rng) {
    if (!validateOptions(opts)) throw fail('bad_options')
    return dealFrom(opts, G.shuffle(buildDeck(), rng), rng)
  }

  // Verilen deste sırasıyla dağıtır (üst = son öğe). rng yalnızca yeniden karıştırmada kullanılır. Test kancasıdır,
  // newGame karıştırılmış desteyle bunu çağırır.
  function dealFrom (opts, deck, rng) {
    const o = validateOptions(opts)
    if (!o) throw fail('bad_options')
    const cards = parseCards(deck)
    if (!cards || !isFullDeck(cards)) throw fail('bad_options')
    const n = o.players.length
    const s = {
      v: VERSION,
      rules: o.rules,
      seats: o.players.map((id) => ({ id: id, hand: [] })),
      dealSeat: o.dealSeat,
      turn: 0,
      dir: 1,
      deck: cards,
      discard: [],
      color: null,
      phase: 'play',
      drawn: null,
      pending: null,
      last: null,
      step: 0,
      result: null
    }
    const left = G.ring(n, o.dealSeat, 1, 1)
    let round = 0
    while (round < HAND_SIZE) {
      let k = 0
      while (k < n) {
        s.seats[G.ring(n, left, 1, k)].hand.push(s.deck.pop())
        k++
      }
      round++
    }
    const ev = []
    let first = s.deck.pop()
    let flips = 0
    while (first === 'WF') {
      if (flips >= MAX_REFLIP) throw fail('bad_random')
      flips++
      s.deck.push(first)
      s.deck = G.shuffle(s.deck, rng)
      ev.push({ e: 'reflip' })
      first = s.deck.pop()
    }
    s.discard.push(first)
    s.color = cardColor(first)
    const v = cardValue(first)
    const leftId = s.seats[left].id
    if (v === 'W') {
      s.phase = 'color'
      s.turn = left
    } else if (v === 'S' || (v === 'V' && n === 2)) {
      ev.push({ e: 'skip', p: leftId })
      s.turn = G.ring(n, o.dealSeat, 1, 2)
    } else if (v === 'V') {
      s.dir = -1
      s.turn = o.dealSeat
      ev.push({ e: 'reverse', dir: -1 })
    } else if (v === 'D') {
      // İki sette de aynı: soldaki 2 kart çeker ve atlanır, bu karta ekleme yapılmaz
      giveCards(s, left, 2, 'D', rng, ev)
      ev.push({ e: 'skip', p: leftId })
      s.turn = G.ring(n, o.dealSeat, 1, 2)
    } else {
      s.turn = left
    }
    return { state: s, events: ev }
  }

  // ----- Oynanabilirlik -----

  // Kartın görünüm ve el üzerinden oynanabilirliği: null (oynanabilir) veya hata kodu. Kurpiyerin applyMove denetimi
  // ve oyuncunun arayüzü aynı işlevi kullanır. drawn aşaması görünümde play göründüğü için mine.drawn okunur.
  function canPlay (view, mine, id, code) {
    if (view.phase === 'over') return 'game_over'
    if (view.turn !== id) return 'not_your_turn'
    if (view.phase === 'color') return 'choose_color'
    if (!isCard(code)) return 'bad_move'
    const cards = mine && Array.isArray(mine.cards) ? mine.cards : []
    if (cards.indexOf(code) < 0) return 'not_in_hand'
    if (mine.drawn && code !== mine.drawn) return 'only_drawn'
    const pend = view.pending
    if (pend) {
      const stacks = pend.k === 'D' ? cardValue(code) === 'D' : code === 'WF'
      return stacks ? null : 'must_stack'
    }
    if (!isWild(code) && cardColor(code) !== view.color && cardValue(code) !== cardValue(view.top)) return 'not_playable'
    if (code === 'WF' && cards.some((c) => cardColor(c) === view.color)) return 'wild4_has_color'
    return null
  }

  // ----- Hamleler -----

  // Katı biçim denetimi. Dönüş: aynı alanlarla yeni nesne (yeniden doğrulanabilir) veya null.
  function validateMove (raw) {
    if (!isPlain(raw) || typeof raw.t !== 'string' || !hasOwn(MOVE_KEYS, raw.t)) return null
    const t = raw.t
    if (!G.onlyKeys(raw, MOVE_KEYS[t]) || !MOVE_NEEDS[t].every((key) => hasOwn(raw, key))) return null
    if (hasOwn(raw, 'step') && !isStep(raw.step)) return null
    if (hasOwn(raw, 'col') && COLORS.indexOf(raw.col) < 0) return null
    if (t === 'play') {
      if (!isCard(raw.c)) return null
      if (hasOwn(raw, 'col') && !isWild(raw.c)) return null
      if (hasOwn(raw, 'last') && raw.last !== true) return null
    }
    if (t === 'catch' && !G.isId(raw.p)) return null
    const out = {}
    Object.keys(raw).forEach((key) => {
      out[key] = raw[key]
    })
    return out
  }

  // Tur hamlesinin aşama ve kart denetimi (5.6 adım 6, sıra ve step denetiminden sonra)
  function checkTurnMove (state, id, m) {
    const phase = state.phase
    if (m.t === 'color') {
      if (phase !== 'color') throw fail('bad_move')
    } else if (m.t === 'pass') {
      if (phase !== 'drawn') throw fail('cannot_pass')
    } else if (m.t === 'draw') {
      if (phase === 'color') throw fail('choose_color')
      if (phase === 'drawn') throw fail('already_drawn')
    } else {
      const why = canPlay(publicView(state), privateView(state, id), id, m.c)
      if (why !== null) throw fail(why)
      if (isWild(m.c) && state.seats[state.turn].hand.length > 1 && !m.col) throw fail('need_color')
    }
  }

  function drawTurn (s, seat, rng, ev) {
    const id = s.seats[seat].id
    if (s.pending) {
      // Biriken ceza: toplam çekilir, drawn aşaması açılmaz
      const want = s.pending.n
      s.pending = null
      giveCards(s, seat, want, 'stack', rng, ev)
      advance(s, seat, 1)
      return
    }
    const c = drawOne(s, rng, ev)
    if (c === null) {
      ev.push({ e: 'nodraw', p: id })
      advance(s, seat, 1)
      return
    }
    const hand = s.seats[seat].hand
    hand.push(c)
    // Olay yalnızca sayıyı taşır, çekilen kartın kodu hiçbir olayda geçmez
    ev.push({ e: 'draw', p: id, n: 1 })
    if (canPlay(publicView(s), { cards: hand, drawn: null }, id, c) === null) {
      s.phase = 'drawn'
      s.drawn = c
    } else {
      advance(s, seat, 1)
    }
  }

  // El boşaldı: son kart +2 veya Joker +4 ise sıradaki önce çeker, sonra el biter
  function finish (s, seat, c, rng, ev) {
    const v = cardValue(c)
    if (v === 'D' || v === 'F') {
      const prior = s.pending ? s.pending.n : 0
      const why = s.pending ? 'stack' : v
      s.pending = null
      giveCards(s, G.ring(s.seats.length, seat, s.dir, 1), prior + (v === 'D' ? 2 : 4), why, rng, ev)
    }
    closeGame(s, 'out', s.seats[seat].id, ev)
  }

  function playCard (s, seat, m, rng, ev) {
    const id = s.seats[seat].id
    const hand = s.seats[seat].hand
    const c = m.c
    hand.splice(hand.indexOf(c), 1)
    s.discard.push(c)
    s.color = isWild(c) ? (m.col || s.color) : cardColor(c)
    s.phase = 'play'
    s.drawn = null
    ev.push({ e: 'play', p: id, c: c, col: s.color })
    if (hand.length === 0) {
      finish(s, seat, c, rng, ev)
      return
    }
    if (hand.length === 1 && LAST_CARD[s.rules]) {
      // Tek! penceresi açılır. move.last başka durumlarda yok sayılır, yersiz bildirime ceza yoktur.
      s.last = { p: id, safe: m.last === true }
      if (m.last === true) ev.push({ e: 'last', p: id, late: false })
    }
    const v = cardValue(c)
    const n = s.seats.length
    if (v === 'S' || (v === 'V' && n === 2)) {
      // 2 kişide Yön, Engel gibi davranır: oynayan yeniden oynar
      ev.push({ e: 'skip', p: s.seats[G.ring(n, seat, s.dir, 1)].id })
      advance(s, seat, 2)
    } else if (v === 'V') {
      s.dir = -s.dir
      ev.push({ e: 'reverse', dir: s.dir })
      advance(s, seat, 1)
    } else if (v === 'D' || v === 'F') {
      const add = v === 'D' ? 2 : 4
      if (s.rules === 'stack') {
        s.pending = { k: v, n: (s.pending ? s.pending.n : 0) + add }
        advance(s, seat, 1)
      } else {
        const victim = G.ring(n, seat, s.dir, 1)
        giveCards(s, victim, add, v, rng, ev)
        ev.push({ e: 'skip', p: s.seats[victim].id })
        advance(s, seat, 2)
      }
    } else {
      advance(s, seat, 1)
    }
  }

  // Sıra dışı: geç Tek! bildirimi. step değişmez, böylece o sırada gönderilmiş tur hamlesi bayatlamaz.
  function declareLast (state, id) {
    if (!(state.last && state.last.p === id && !state.last.safe)) throw fail('no_last')
    const s = cloneState(state)
    s.last.safe = true
    return { state: s, events: [{ e: 'last', p: id, late: true }] }
  }

  // Sıra dışı: korunmayan Tek! sahibini yakalama. Yakalanan 2 kart çeker, yanlış yakalamaya ceza yoktur.
  function catchLast (state, id, p, rng) {
    if (p === id) throw fail('self_catch')
    if (!(state.last && state.last.p === p && !state.last.safe)) throw fail('not_catchable')
    const s = cloneState(state)
    const ev = [{ e: 'caught', p: p, by: id }]
    s.last = null
    giveCards(s, seatIndex(s, p), 2, 'last', rng, ev)
    return { state: s, events: ev }
  }

  // Denetim sırası 5.6'daki gibidir, testler bu önceliğe dayanır. Hata fırlatılınca girdi değişmez.
  function applyMove (state, id, move, rng) {
    if (state.phase === 'over') throw fail('game_over')
    const m = validateMove(move)
    if (!m) throw fail('bad_move')
    const seat = seatIndex(state, id)
    if (seat < 0) throw fail('bad_player')
    if (m.t === 'last') return declareLast(state, id)
    if (m.t === 'catch') return catchLast(state, id, m.p, rng)
    if (seat !== state.turn) throw fail('not_your_turn')
    if (m.step !== state.step) throw fail('stale')
    checkTurnMove(state, id, m)
    const s = cloneState(state)
    const ev = []
    // Sıradaki ilk geçerli tur hamlesi Tek! penceresini kapatır, hamleyi kim yaparsa yapsın
    s.last = null
    if (m.t === 'color') {
      s.color = m.col
      s.phase = 'play'
      ev.push({ e: 'color', p: id, col: m.col })
    } else if (m.t === 'pass') {
      ev.push({ e: 'pass', p: id })
      advance(s, seat, 1)
    } else if (m.t === 'draw') {
      drawTurn(s, seat, rng, ev)
    } else {
      playCard(s, seat, m, rng, ev)
    }
    s.step++
    return { state: s, events: ev }
  }

  // Oyuncu ayrıldı: kartları desteye eklenir ve bütün deste yeniden karıştırılır. Bitmiş elde koltuk silinir,
  // kartlar karıştırılmadan desteye konur ve sonuç değişmez.
  function removePlayer (state, id, rng) {
    const k = seatIndex(state, id)
    if (k < 0) throw fail('bad_player')
    const s = cloneState(state)
    const ev = []
    const hand = s.seats[k].hand
    const over = s.phase === 'over'
    s.deck = over ? s.deck.concat(hand) : G.shuffle(s.deck.concat(hand), rng)
    s.seats.splice(k, 1)
    ev.push({ e: 'leave', p: id, n: hand.length })
    const n = s.seats.length
    if (k < s.dealSeat) s.dealSeat--
    else if (k === s.dealSeat) s.dealSeat = n > 0 ? nextAfterRemoval(k, n, s.dir) : 0
    if (over) return { state: s, events: ev }
    if (s.last && s.last.p === id) s.last = null
    if (n < MIN_PLAYERS) {
      closeGame(s, 'too_few', null, ev)
      return { state: s, events: ev }
    }
    if (k === s.turn) {
      s.turn = nextAfterRemoval(k, n, s.dir)
      s.drawn = null
      // İlk kart Joker iken renk seçimi sıradakine geçer
      if (s.phase !== 'color') s.phase = 'play'
      if (s.pending) {
        ev.push({ e: 'pending_dropped', n: s.pending.n })
        s.pending = null
      }
      s.step++
    } else if (k < s.turn) {
      s.turn--
    }
    return { state: s, events: ev }
  }

  // Kurpiyerin Oyunu Bitir düğmesi
  function endGame (state) {
    if (state.phase === 'over') throw fail('game_over')
    const s = cloneState(state)
    const ev = []
    closeGame(s, 'ended', null, ev)
    return { state: s, events: ev }
  }

  function isOver (state) {
    return state.phase === 'over'
  }

  function turnOf (state) {
    return state.phase === 'over' ? null : state.seats[state.turn].id
  }

  // ----- Görünümler -----

  function publicView (s) {
    return {
      v: VERSION,
      rules: s.rules,
      seats: s.seats.map((x) => ({ id: x.id, n: x.hand.length })),
      turn: turnOf(s),
      dir: s.dir,
      top: topCard(s),
      color: s.color,
      deck: s.deck.length,
      discard: s.discard.length,
      phase: s.phase === 'drawn' ? 'play' : s.phase,
      pending: s.pending ? { k: s.pending.k, n: s.pending.n } : null,
      last: s.last ? { p: s.last.p, safe: s.last.safe } : null,
      step: s.step,
      result: cloneResult(s.result)
    }
  }

  // Kişinin kendi eli. drawn yalnızca o kişi drawn aşamasındaysa doludur.
  function privateView (s, id) {
    const k = seatIndex(s, id)
    if (k < 0) return null
    return { cards: s.seats[k].hand.slice(), drawn: s.phase === 'drawn' && s.turn === k ? s.drawn : null }
  }

  function pendingOk (p) {
    if (!isPlain(p) || !exactKeys(p, PENDING_KEYS) || (p.k !== 'D' && p.k !== 'F')) return false
    return isInt(p.n, 2, DECK_SIZE) && p.n % 2 === 0
  }

  function lastOk (last, ids) {
    return isPlain(last) && exactKeys(last, LAST_KEYS) && ids.indexOf(last.p) >= 0 && typeof last.safe === 'boolean'
  }

  function resultOk (r) {
    if (!isPlain(r) || !exactKeys(r, RESULT_KEYS) || REASONS.indexOf(r.reason) < 0) return false
    if (!Array.isArray(r.ranks) || r.ranks.length > MAX_PLAYERS) return false
    const seen = []
    const ranksOk = r.ranks.every((x) => {
      if (!isPlain(x) || !exactKeys(x, RANK_KEYS) || !G.isId(x.id) || seen.indexOf(x.id) >= 0) return false
      seen.push(x.id)
      return isInt(x.n, 0, DECK_SIZE) && isInt(x.points, 0, MAX_POINTS) && isInt(x.rank, 1, MAX_PLAYERS)
    })
    if (!ranksOk) return false
    if (r.reason === 'out') {
      return G.isId(r.winner) && r.ranks.length > 0 && r.ranks[0].id === r.winner && isInt(r.total, 0, MAX_POINTS)
    }
    return r.winner === null && r.total === 0
  }

  // Etkin renk: R Y G B. null yalnızca ilk kart Joker iken renk seçilmeden önce (color aşaması) ya da o aşamada
  // biten elde olur. color aşamasında renk her zaman null'dır.
  function colorOk (color, phase) {
    if (color === null) return phase === 'color' || phase === 'over'
    return COLORS.indexOf(color) >= 0 && phase !== 'color'
  }

  // Tam durumun değişmezleri. Dönüş: durum veya null.
  function validateState (s) {
    if (!isPlain(s) || !exactKeys(s, STATE_KEYS) || s.v !== VERSION || RULES.indexOf(s.rules) < 0) return null
    if (PHASES.indexOf(s.phase) < 0) return null
    const over = s.phase === 'over'
    const seats = s.seats
    if (!Array.isArray(seats) || seats.length > MAX_PLAYERS || (!over && seats.length < MIN_PLAYERS)) return null
    const ids = []
    let all = []
    let i = 0
    while (i < seats.length) {
      const x = seats[i]
      if (!isPlain(x) || !exactKeys(x, SEAT_KEYS) || !G.isId(x.id) || ids.indexOf(x.id) >= 0) return null
      const hand = parseCards(x.hand)
      if (!hand || (!over && hand.length < 1)) return null
      ids.push(x.id)
      all = all.concat(hand)
      i++
    }
    const deck = parseCards(s.deck)
    const discard = parseCards(s.discard)
    if (!deck || !discard || discard.length < 1 || !isFullDeck(all.concat(deck, discard))) return null
    const n = seats.length
    if (!isInt(s.dealSeat, 0, Math.max(0, n - 1)) || (s.dir !== 1 && s.dir !== -1) || !isStep(s.step)) return null
    if (over ? s.turn !== -1 : !isInt(s.turn, 0, n - 1)) return null
    if (!colorOk(s.color, s.phase)) return null
    if (s.phase === 'drawn') {
      if (!isCard(s.drawn) || seats[s.turn].hand.indexOf(s.drawn) < 0) return null
    } else if (s.drawn !== null) {
      return null
    }
    if (s.pending !== null && (s.rules !== 'stack' || s.phase !== 'play' || !pendingOk(s.pending))) return null
    if (s.last !== null) {
      // Pencere açıkken sahibinin elinde tek kart vardır
      if (over || !LAST_CARD[s.rules] || !lastOk(s.last, ids)) return null
      if (seats[ids.indexOf(s.last.p)].hand.length !== 1) return null
    }
    if (over ? !resultOk(s.result) : s.result !== null) return null
    return s
  }

  // Oyuncunun cihazında herkese açık görünümün denetimi. seatIds masanın koltuk sırasıdır. Dönüş: view veya null.
  function validateView (v, seatIds) {
    if (!isPlain(v) || !exactKeys(v, VIEW_KEYS) || v.v !== VERSION || RULES.indexOf(v.rules) < 0) return null
    if (VIEW_PHASES.indexOf(v.phase) < 0 || !Array.isArray(seatIds) || !Array.isArray(v.seats)) return null
    const over = v.phase === 'over'
    const n = v.seats.length
    if (n !== seatIds.length || n > MAX_PLAYERS || (!over && n < MIN_PLAYERS)) return null
    const ids = []
    let sum = 0
    let i = 0
    while (i < n) {
      const x = v.seats[i]
      if (!isPlain(x) || !exactKeys(x, VIEW_SEAT_KEYS) || x.id !== seatIds[i] || !G.isId(x.id)) return null
      if (ids.indexOf(x.id) >= 0 || !isInt(x.n, over ? 0 : 1, DECK_SIZE)) return null
      ids.push(x.id)
      sum += x.n
      i++
    }
    if (over ? v.turn !== null : ids.indexOf(v.turn) < 0) return null
    if ((v.dir !== 1 && v.dir !== -1) || !isCard(v.top) || !colorOk(v.color, v.phase) || !isStep(v.step)) return null
    if (!isInt(v.deck, 0, DECK_SIZE) || !isInt(v.discard, 1, DECK_SIZE) || sum + v.deck + v.discard !== DECK_SIZE) return null
    if (v.pending !== null && (v.rules !== 'stack' || v.phase !== 'play' || !pendingOk(v.pending))) return null
    if (v.last !== null) {
      if (over || !lastOk(v.last, ids) || v.seats[ids.indexOf(v.last.p)].n !== 1) return null
    }
    if (over ? !resultOk(v.result) : v.result !== null) return null
    return v
  }

  // Oyuncunun kendi elinin denetimi (view önce validateView ile denetlenmiş olmalı). Üst kart da elde olabilir,
  // aynı koddan iki kart bulunur. Dönüş: mine veya null.
  function validatePrivate (m, v, id) {
    if (!isPlain(m) || !exactKeys(m, MINE_KEYS) || !isPlain(v) || !Array.isArray(v.seats)) return null
    const cards = parseCards(m.cards)
    if (!cards) return null
    const seat = v.seats.filter((x) => isPlain(x) && x.id === id)[0]
    if (!seat || cards.length !== seat.n) return null
    if (m.drawn !== null) {
      if (!isCard(m.drawn) || cards.indexOf(m.drawn) < 0 || v.turn !== id || v.phase !== 'play') return null
    }
    return m
  }

  // Arayüzün seçenekleri. blocked yalnızca sıra bendeyken doldurulur: elde olup oynanamayan her kod için neden.
  function legalMoves (view, mine, id) {
    const out = {
      turn: false,
      phase: view.phase,
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
    }
    if (view.phase === 'over') return out
    if (view.last && !view.last.safe) {
      if (view.last.p === id) out.last = true
      else out.catch = view.last.p
    }
    out.turn = view.turn === id
    if (!out.turn) return out
    const cards = mine && Array.isArray(mine.cards) ? mine.cards : []
    out.drawn = mine && mine.drawn ? mine.drawn : null
    cards.forEach((c, i) => {
      if (cards.indexOf(c) !== i) return
      const why = canPlay(view, mine, id, c)
      if (why === null) out.play.push(c)
      else out.blocked[c] = why
    })
    if (view.phase === 'color') {
      out.color = true
    } else if (out.drawn) {
      out.pass = true
    } else {
      out.draw = true
      out.take = view.pending ? view.pending.n : 0
    }
    out.armLast = view.phase === 'play' && !!LAST_CARD[view.rules] && cards.length === 2 && out.play.length > 0
    return out
  }

  return Object.freeze({
    id: ID,
    VERSION: VERSION,
    MIN_PLAYERS: MIN_PLAYERS,
    MAX_PLAYERS: MAX_PLAYERS,
    RULES: Object.freeze(RULES.slice()),
    DEFAULT_RULES: DEFAULT_RULES,
    HIDDEN: true,
    ERRORS: Object.freeze(ERRORS.slice()),
    EVENTS: Object.freeze(EVENTS.slice()),
    COLORS: Object.freeze(COLORS.slice()),
    LAST_CARD: Object.freeze({ official: LAST_CARD.official, stack: LAST_CARD.stack }),
    HAND_SIZE: HAND_SIZE,
    DECK_SIZE: DECK_SIZE,
    newGame: newGame,
    validateMove: validateMove,
    applyMove: applyMove,
    removePlayer: removePlayer,
    endGame: endGame,
    isOver: isOver,
    turnOf: turnOf,
    publicView: publicView,
    privateView: privateView,
    validateView: validateView,
    validatePrivate: validatePrivate,
    legalMoves: legalMoves,
    buildDeck: buildDeck,
    isCard: isCard,
    parseCards: parseCards,
    cardColor: cardColor,
    cardValue: cardValue,
    isWild: isWild,
    points: points,
    canPlay: canPlay,
    validateState: validateState,
    validateOptions: validateOptions,
    dealFrom: dealFrom
  })
})(window.TelsizGame)
