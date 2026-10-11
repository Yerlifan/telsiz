'use strict'

// Hexball kural motoru (window.TelsizHexball). DOM, ağ, saat ve sözlük kullanmaz, kullanıcıya görünen metin üretmez.
// Hatalar err.code ile, olaylar kodla verilir, arayüz game.hexball.* anahtarlarıyla çevirir.
// Motor yalnızca düşük hızlı işleri taşır: takımlar, maçı başlatma, goller, süre, altın gol ve sonuç. Gerçek zamanlı
// fizik ve anlık görüntüler masa yöneticisinden geçmez, ses bağlantısının üstündeki oyun veri kanalıyla gider
// (44-hexball-fizik.js, 45-hexball-ag.js). Ev sahibi otoriterdir: fiziği o hesaplar, gol ve süre bitti hamlelerini
// o gönderir, bu yüzden bu hamleler ve takım atama, maçı başlatma ve durdurma yalnızca ev sahibine açıktır.
// 34-oyun-masa.js motoru genel uygulama sözleşmesiyle çağırır (Renk tasarımı 5.1): id, RULES, DEFAULT_RULES,
// MIN_PLAYERS, MAX_PLAYERS, DELAYED_MOVES, newGame, validateMove, applyMove, removePlayer, endGame, isOver, turnOf,
// publicView, privateView, legalMoves, validateView, validatePrivate. Motor 36-oyun.js içindeki GAME_ENGINES
// tablosuna kayıtlıdır.
// Ev sahibi masayı kuran kişidir. Masa yöneticisinde onun koltuğu her zaman ilktir ve kaldırılmaz (seats[0]), motor da
// ev sahibini seats[0] sayar.
// Gizli bilgi yoktur: herkese açık görünüm tam durumun kopyasıdır. privateView koltuktaki kişiye boş bir nesne verir,
// çünkü masa yöneticisinde oyuncu görünümle birlikte null olmayan bir el bekler.
// Aşamalar (ph):
// - teams: ilk takım seçimi. newGame koltukları sırayla Kırmızı ve Mavi takıma dağıtır.
// - match: maç sürüyor. Takımlar donar, yuvalar (slots) veri kanalındaki oyuncu numaralarıdır.
// - result: maç bitti. Takımlar değişebilir, ev sahibi aynı turda yeni maç başlatabilir (Tekrar Oyna).
// - over: masa bitti (ev sahibi bitirdi ya da iki kişinin altına düşüldü), isOver doğru döner.
// Sıra yoktur (turnOf null), gecikmeli hamle yoktur (DELAYED_MOVES boş).
// Rastgelelik yalnızca maç başlatmada, maç kimliği (epoch) için rng(n) ile gelir (ev sahibinde nacl.randomBytes).
// Girdi durumu hiçbir zaman değiştirilmez: her işlem elle yazılmış bir kopya üzerinde çalışır.

window.TelsizHexball = (function (G) {
  const ID = 'hexball'
  const VERSION = 1
  const MIN_PLAYERS = 2
  const MAX_PLAYERS = 8
  const RULES = ['quick', 'classic', 'long']
  const DEFAULT_RULES = 'classic'
  // Ön ayarların maç süresi (saniye) ve gol sınırı (0: sınırsız). Saha ölçüleri fizik modülündedir.
  const PRESETS = {
    quick: { secs: 180, goals: 3 },
    classic: { secs: 300, goals: 5 },
    long: { secs: 600, goals: 0 }
  }
  const TEAMS = ['red', 'blue']
  const SIDES = ['red', 'blue', 'spec']
  // Takım başına en çok oyuncu, kalanlar izleyicidir
  const TEAM_MAX = 4
  const PHASES = ['teams', 'match', 'result', 'over']
  // Sonucun nedeni: süre, gol sınırı, altın gol (kazananı olanlar), ev sahibi ve oyuncu yetmedi (kazananı yok)
  const WHY = ['time', 'score', 'golden', 'host', 'too_few']
  const WIN_WHY = ['time', 'score', 'golden']
  // goals listesinde tutulan en çok gol (son goller)
  const MAX_GOALS = 10
  // Skor anlık görüntüde bir bayttır (45-hexball-ag.js). Gol sınırı olmayan ön ayarda maç bu skorda biter.
  const MAX_SCORE = 255
  // Golün maç saatindeki saniyesi en çok bu kadardır
  const MAX_AT = 65535
  const MAX_MT = 1000000
  const DELAYED_MOVES = []
  const ERRORS = ['bad_options', 'bad_random', 'no_random', 'bad_move', 'bad_player', 'game_over', 'stale', 'not_host',
    'bad_phase', 'team_full', 'teams_empty']
  const EVENTS = ['team', 'kickoff', 'goal', 'own_goal', 'time_up', 'golden', 'win', 'stop', 'leave']

  // Hamle alanları (hepsi zorunlu, fazlası reddedilir). goal ve time maç numarasını (mt) taşır, eski maça ait olanı
  // stale ile reddedilir.
  const MOVE_KEYS = {
    team: ['t', 'side'],
    set: ['t', 'id', 'side'],
    kickoff: ['t'],
    goal: ['t', 'mt', 'side', 'by', 'at'],
    time: ['t', 'mt'],
    stop: ['t']
  }
  const HOST_MOVES = ['set', 'kickoff', 'goal', 'time', 'stop']
  const MOVE_PHASES = {
    team: ['teams', 'result'],
    set: ['teams', 'result'],
    kickoff: ['teams', 'result'],
    goal: ['match'],
    time: ['match'],
    stop: ['match']
  }
  const OPTION_KEYS = ['rules', 'players', 'dealSeat']
  const STATE_KEYS = ['v', 'rules', 'seats', 'ph', 'teams', 'slots', 'score', 'kick', 'mt', 'epoch', 'golden', 'goals',
    'result']
  const GOAL_KEYS = ['side', 'by', 'own', 'at']
  const RESULT_KEYS = ['winner', 'why']

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

  function otherTeam (side) {
    return side === 'red' ? 'blue' : 'red'
  }

  function goalLimit (rules) {
    return PRESETS[rules].goals || MAX_SCORE
  }

  // Kimlik anahtarlı haritanın kopyası (anahtarlar denetlenmiş kimliklerdir)
  function cloneMap (map) {
    const out = {}
    Object.keys(map).forEach((key) => {
      out[key] = map[key]
    })
    return out
  }

  function withoutKey (map, id) {
    const out = {}
    Object.keys(map).forEach((key) => {
      if (key !== id) out[key] = map[key]
    })
    return out
  }

  function cloneResult (r) {
    return r ? { winner: r.winner, why: r.why } : null
  }

  function cloneState (s) {
    return {
      v: s.v,
      rules: s.rules,
      seats: s.seats.slice(),
      ph: s.ph,
      teams: cloneMap(s.teams),
      slots: cloneMap(s.slots),
      score: { red: s.score.red, blue: s.score.blue },
      kick: s.kick,
      mt: s.mt,
      epoch: s.epoch,
      golden: s.golden,
      goals: s.goals.map((x) => ({ side: x.side, by: x.by, own: x.own, at: x.at })),
      result: cloneResult(s.result)
    }
  }

  // Takımların kişi sayısı. teams denetlenmemiş olabilir, bilinmeyen değerler sayılmaz.
  function countSides (teams) {
    const out = { red: 0, blue: 0, spec: 0 }
    if (!isPlain(teams)) return out
    Object.keys(teams).forEach((id) => {
      const side = teams[id]
      if (typeof side === 'string' && SIDES.indexOf(side) >= 0) out[side]++
    })
    return out
  }

  // Takım dengesi: koltuk sırasıyla Kırmızı, Mavi, Kırmızı, Mavi... Takımı dolan kişi izleyici olur.
  function balanceTeams (ids) {
    const out = {}
    const n = { red: 0, blue: 0 }
    ids.forEach((id, i) => {
      const want = i % 2 === 0 ? 'red' : 'blue'
      if (n[want] < TEAM_MAX) {
        out[id] = want
        n[want]++
      } else {
        out[id] = 'spec'
      }
    })
    return out
  }

  // Maç başında yuvalar: takımdaki kişilere koltuk sırasıyla 0'dan başlayarak. İzleyicinin yuvası yoktur.
  function assignSlots (s) {
    const out = {}
    let n = 0
    s.seats.forEach((id) => {
      if (s.teams[id] !== 'spec') {
        out[id] = n
        n++
      }
    })
    return out
  }

  // Maç bitti: kazanan (ya da null) ve neden. Yuvalar silinir, olay win (kazanan varsa) ya da stop olur.
  function finishMatch (s, winner, why, ev) {
    s.ph = 'result'
    s.slots = {}
    s.result = { winner: winner, why: why }
    ev.push(winner === null ? { e: 'stop', why: why } : { e: 'win', side: winner, why: why })
  }

  // ----- Yeni oyun -----

  // Seçenekler: rules RULES içinde, players 2-8 benzersiz kimlik (ilki ev sahibi), dealSeat geçerli koltuk dizini.
  // dealSeat sözleşme gereği denetlenir, Hexball'da kullanılmaz. Dönüş: kendi kopyası veya null.
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

  // rng yeni oyunda kullanılmaz, maç kimliği ilk maç başlarken üretilir
  function newGame (opts) {
    const o = validateOptions(opts)
    if (!o) throw fail('bad_options')
    const s = {
      v: VERSION,
      rules: o.rules,
      seats: o.players,
      ph: 'teams',
      teams: balanceTeams(o.players),
      slots: {},
      score: { red: 0, blue: 0 },
      kick: 'red',
      mt: 0,
      epoch: null,
      golden: false,
      goals: [],
      result: null
    }
    return { state: s, events: [] }
  }

  // ----- Hamleler -----

  // Katı biçim denetimi. Dönüş: aynı alanlarla yeni nesne (yeniden doğrulanabilir) veya null.
  function validateMove (raw) {
    if (!isPlain(raw) || typeof raw.t !== 'string' || !hasOwn(MOVE_KEYS, raw.t)) return null
    const t = raw.t
    if (!exactKeys(raw, MOVE_KEYS[t])) return null
    if (hasOwn(raw, 'side') && SIDES.indexOf(raw.side) < 0) return null
    if (hasOwn(raw, 'mt') && !isInt(raw.mt, 1, MAX_MT)) return null
    if (t === 'set' && !G.isId(raw.id)) return null
    if (t === 'goal') {
      if (TEAMS.indexOf(raw.side) < 0 || (raw.by !== null && !G.isId(raw.by)) || !isInt(raw.at, 0, MAX_AT)) return null
    }
    const out = {}
    Object.keys(raw).forEach((key) => {
      out[key] = raw[key]
    })
    return out
  }

  // Takım değişikliği (team: kişi kendisi, set: ev sahibi başkası için). Zaten o takımdaysa durum aynı kalır ve olay
  // üretilmez (ev sahibinin ataması ile kişinin kendi seçimi yarışabilir). İzleyici sınırsızdır.
  function changeTeam (state, who, side, by) {
    if (state.teams[who] === side) return { state: cloneState(state), events: [] }
    if (side !== 'spec' && countSides(state.teams)[side] >= TEAM_MAX) throw fail('team_full')
    const s = cloneState(state)
    s.teams[who] = side
    return { state: s, events: [{ e: 'team', p: who, side: side, by: by }] }
  }

  // Maçı Başlat ve Tekrar Oyna: her takımda en az bir kişi gerekir. Yeni maç kimliği ve yuvalar atanır, skor sıfırlanır.
  // Tek numaralı maçı Kırmızı, çift numaralıyı Mavi başlatır.
  function kickoff (state, rng) {
    const c = countSides(state.teams)
    if (c.red < 1 || c.blue < 1) throw fail('teams_empty')
    if (state.mt >= MAX_MT) throw fail('bad_phase')
    const epoch = G.randomHex16(rng)
    const s = cloneState(state)
    s.mt++
    s.ph = 'match'
    s.epoch = epoch
    s.slots = assignSlots(s)
    s.score = { red: 0, blue: 0 }
    s.kick = s.mt % 2 === 1 ? 'red' : 'blue'
    s.golden = false
    s.goals = []
    s.result = null
    return { state: s, events: [{ e: 'kickoff', mt: s.mt, kick: s.kick }] }
  }

  // Gol: side golü kazanan takımdır. by topa son dokunan kişidir (bilinmiyorsa null), maçtaki bir takımda olmalıdır.
  // Kendi kalesine gol by kişisinin takımı side değilse olur. at maç saatindeki saniyedir ve önceki golden küçük
  // olamaz. Altın golde maç biter, gol sınırına ulaşan takım kazanır, aksi hâlde gol yiyen takım başlar.
  function scoreGoal (state, m) {
    if (m.by !== null && (!hasOwn(state.teams, m.by) || state.teams[m.by] === 'spec')) throw fail('bad_player')
    const prev = state.goals.length ? state.goals[state.goals.length - 1].at : 0
    if (m.at < prev) throw fail('bad_move')
    const s = cloneState(state)
    const own = m.by !== null && s.teams[m.by] !== m.side
    s.score[m.side]++
    s.goals.push({ side: m.side, by: m.by, own: own, at: m.at })
    if (s.goals.length > MAX_GOALS) s.goals = s.goals.slice(-MAX_GOALS)
    const ev = [{ e: own ? 'own_goal' : 'goal', side: m.side, p: m.by, at: m.at }]
    if (s.golden) finishMatch(s, m.side, 'golden', ev)
    else if (s.score[m.side] >= goalLimit(s.rules)) finishMatch(s, m.side, 'score', ev)
    else s.kick = otherTeam(m.side)
    return { state: s, events: ev }
  }

  // Süre bitti: önde olan kazanır, beraberlikte altın gol başlar. Altın golde süre yeniden bitemez.
  function timeUp (state) {
    if (state.golden) throw fail('bad_phase')
    const s = cloneState(state)
    const ev = [{ e: 'time_up' }]
    if (s.score.red === s.score.blue) {
      s.golden = true
      ev.push({ e: 'golden' })
    } else {
      finishMatch(s, s.score.red > s.score.blue ? 'red' : 'blue', 'time', ev)
    }
    return { state: s, events: ev }
  }

  // Denetim sırası: masa bitti (game_over), biçim (bad_move), oyuncu (bad_player), ev sahibi (not_host), aşama
  // (bad_phase), maç numarası (stale), ardından hamleye özgü denetimler. Hata fırlatılınca girdi değişmez.
  function applyMove (state, id, move, rng) {
    if (state.ph === 'over') throw fail('game_over')
    const m = validateMove(move)
    if (!m) throw fail('bad_move')
    if (state.seats.indexOf(id) < 0) throw fail('bad_player')
    if (HOST_MOVES.indexOf(m.t) >= 0 && id !== state.seats[0]) throw fail('not_host')
    if (MOVE_PHASES[m.t].indexOf(state.ph) < 0) throw fail('bad_phase')
    if (hasOwn(m, 'mt') && m.mt !== state.mt) throw fail('stale')
    if (m.t === 'team') return changeTeam(state, id, m.side, id)
    if (m.t === 'set') {
      if (state.seats.indexOf(m.id) < 0) throw fail('bad_player')
      return changeTeam(state, m.id, m.side, id)
    }
    if (m.t === 'kickoff') return kickoff(state, rng)
    if (m.t === 'goal') return scoreGoal(state, m)
    if (m.t === 'time') return timeUp(state)
    const s = cloneState(state)
    const ev = []
    finishMatch(s, null, 'host', ev)
    return { state: s, events: ev }
  }

  // Oyuncu ayrıldı. Ev sahibinin koltuğu kaldırılmaz. İki kişinin altına düşülürse masa biter (too_few, maç bitmişse
  // sonuç korunur). Maçta bir takım boşalırsa maç kazanansız biter (too_few), masa sürer.
  function removePlayer (state, id) {
    const k = state.seats.indexOf(id)
    if (k <= 0) throw fail('bad_player')
    const s = cloneState(state)
    const side = s.teams[id]
    s.seats.splice(k, 1)
    s.teams = withoutKey(s.teams, id)
    s.slots = withoutKey(s.slots, id)
    const ev = [{ e: 'leave', p: id }]
    if (s.ph === 'over') return { state: s, events: ev }
    if (s.seats.length < MIN_PLAYERS) {
      if (s.ph !== 'result') {
        s.result = { winner: null, why: 'too_few' }
        ev.push({ e: 'stop', why: 'too_few' })
      }
      s.ph = 'over'
      s.slots = {}
      return { state: s, events: ev }
    }
    if (s.ph === 'match' && side !== 'spec' && countSides(s.teams)[side] === 0) finishMatch(s, null, 'too_few', ev)
    return { state: s, events: ev }
  }

  // Ev sahibinin Oyunu Bitir düğmesi (Lobiye Dön de bunu kullanır). Maç bitmişse sonucu korunur.
  function endGame (state) {
    if (state.ph === 'over') throw fail('game_over')
    const s = cloneState(state)
    const ev = []
    if (s.ph !== 'result') {
      s.result = { winner: null, why: 'host' }
      ev.push({ e: 'stop', why: 'host' })
    }
    s.ph = 'over'
    s.slots = {}
    return { state: s, events: ev }
  }

  function isOver (state) {
    return state.ph === 'over'
  }

  function turnOf () {
    return null
  }

  // ----- Görünümler -----

  function publicView (s) {
    return cloneState(s)
  }

  function privateView (s, id) {
    return s.seats.indexOf(id) >= 0 ? {} : null
  }

  function scoreOk (score) {
    return isPlain(score) && exactKeys(score, TEAMS) && isInt(score.red, 0, MAX_SCORE) && isInt(score.blue, 0, MAX_SCORE)
  }

  // Son goller: en çok MAX_GOALS, saniyeler azalmaz. Liste skorla tutarlıdır: toplam golün son MAX_GOALS kadarı
  // listededir, toplam sığıyorsa takım başına sayılar skora eşittir.
  function goalsOk (goals, score) {
    if (!Array.isArray(goals) || goals.length > MAX_GOALS) return false
    const n = { red: 0, blue: 0 }
    let prev = 0
    const each = goals.every((x) => {
      if (!isPlain(x) || !exactKeys(x, GOAL_KEYS) || TEAMS.indexOf(x.side) < 0) return false
      if (x.by !== null && !G.isId(x.by)) return false
      if (typeof x.own !== 'boolean' || (x.by === null && x.own)) return false
      if (!isInt(x.at, prev, MAX_AT)) return false
      prev = x.at
      n[x.side]++
      return true
    })
    if (!each) return false
    const total = score.red + score.blue
    if (goals.length !== Math.min(total, MAX_GOALS)) return false
    if (total <= MAX_GOALS) return n.red === score.red && n.blue === score.blue
    return n.red <= score.red && n.blue <= score.blue
  }

  // Yuvalar yalnızca maçta vardır: anahtarlar tam olarak takımdaki kişiler, değerler benzersiz 0-7
  function slotsOk (slots, teams, match) {
    if (!isPlain(slots)) return false
    if (!match) return Object.keys(slots).length === 0
    const ids = Object.keys(teams).filter((id) => teams[id] !== 'spec')
    if (!exactKeys(slots, ids)) return false
    const seen = []
    return ids.every((id) => {
      const n = slots[id]
      if (!isInt(n, 0, MAX_PLAYERS - 1) || seen.indexOf(n) >= 0) return false
      seen.push(n)
      return true
    })
  }

  // Sonuç: kazananı olan nedenlerde kazanan önde, gol sınırında tam sınırda, altın golde bir gol farkla. Kazananı
  // olmayan nedenlerde (ev sahibi, oyuncu yetmedi) skor serbesttir.
  function resultOk (r, s) {
    if (!isPlain(r) || !exactKeys(r, RESULT_KEYS) || WHY.indexOf(r.why) < 0) return false
    if (WIN_WHY.indexOf(r.why) < 0) return r.winner === null
    if (TEAMS.indexOf(r.winner) < 0 || s.mt < 1) return false
    const win = s.score[r.winner]
    const lose = s.score[otherTeam(r.winner)]
    if (win <= lose) return false
    if (r.why === 'golden') return s.golden && win === lose + 1
    if (s.golden) return false
    if (r.why === 'score') return win === goalLimit(s.rules)
    return true
  }

  // Tam durumun (ve aynı biçimdeki görünümün) değişmezleri. Dönüş: durum veya null.
  function validateState (s) {
    if (!isPlain(s) || !exactKeys(s, STATE_KEYS) || s.v !== VERSION || RULES.indexOf(s.rules) < 0) return null
    if (PHASES.indexOf(s.ph) < 0) return null
    const seats = s.seats
    if (!Array.isArray(seats) || seats.length < 1 || seats.length > MAX_PLAYERS) return null
    if (s.ph !== 'over' && seats.length < MIN_PLAYERS) return null
    if (!seats.every((id, i) => G.isId(id) && seats.indexOf(id) === i)) return null
    if (!isPlain(s.teams) || !exactKeys(s.teams, seats)) return null
    if (!seats.every((id) => SIDES.indexOf(s.teams[id]) >= 0)) return null
    const c = countSides(s.teams)
    if (c.red > TEAM_MAX || c.blue > TEAM_MAX) return null
    if (!isInt(s.mt, 0, MAX_MT) || TEAMS.indexOf(s.kick) < 0 || typeof s.golden !== 'boolean') return null
    if (s.mt === 0 ? s.epoch !== null : !G.isHex16(s.epoch)) return null
    if (!scoreOk(s.score) || !goalsOk(s.goals, s.score)) return null
    const match = s.ph === 'match'
    if (!slotsOk(s.slots, s.teams, match)) return null
    // Hiç maç oynanmadıysa skor, goller ve altın gol boştur
    if (s.mt === 0 && (s.score.red !== 0 || s.score.blue !== 0 || s.golden)) return null
    if (s.ph === 'teams') return s.mt === 0 && s.result === null ? s : null
    if (match) {
      if (s.mt < 1 || c.red < 1 || c.blue < 1 || s.result !== null) return null
      const limit = goalLimit(s.rules)
      if (s.score.red >= limit || s.score.blue >= limit) return null
      if (s.golden && s.score.red !== s.score.blue) return null
      return s
    }
    if (!resultOk(s.result, s)) return null
    // Kazanansız biten altın golde skor eşittir
    if (s.golden && s.result.winner === null && s.score.red !== s.score.blue) return null
    return s
  }

  // Oyuncunun cihazında görünümün denetimi. seatIds masanın koltuk sırasıdır, görünümdeki sırayla aynı olmalıdır.
  // Dönüş: view veya null.
  function validateView (v, seatIds) {
    if (!validateState(v) || !Array.isArray(seatIds) || seatIds.length !== v.seats.length) return null
    return v.seats.every((id, i) => seatIds[i] === id) ? v : null
  }

  // Gizli bilgi olmadığı için el her zaman boş nesnedir, kişi görünümün koltuklarında olmalıdır. Dönüş: mine veya null.
  function validatePrivate (m, v, id) {
    if (!isPlain(m) || Object.keys(m).length !== 0 || !isPlain(v) || !Array.isArray(v.seats)) return null
    return v.seats.indexOf(id) >= 0 ? m : null
  }

  // Arayüzün seçenekleri. team: kişinin geçebileceği takımlar (bulunduğu takım hariç). kickoffWhy: Maçı Başlat
  // kapalıysa nedeni (not_host, teams_empty, bad_phase). Bitmiş masada ve koltukta olmayan kişide hiçbir seçenek yok.
  function legalMoves (view, mine, id) {
    const seats = Array.isArray(view.seats) ? view.seats : []
    const teams = isPlain(view.teams) ? view.teams : {}
    const counts = countSides(teams)
    const out = {
      turn: false,
      ph: view.ph,
      host: seats.length > 0 && seats[0] === id,
      side: hasOwn(teams, id) ? teams[id] : null,
      counts: counts,
      team: [],
      set: false,
      kickoff: false,
      kickoffWhy: null,
      goal: false,
      time: false,
      stop: false
    }
    if (view.ph === 'over' || out.side === null) return out
    if (view.ph === 'match') {
      out.goal = out.host
      out.time = out.host && !view.golden
      out.stop = out.host
      return out
    }
    out.team = SIDES.filter((x) => x !== out.side && (x === 'spec' || counts[x] < TEAM_MAX))
    out.set = out.host
    if (!out.host) out.kickoffWhy = 'not_host'
    else if (counts.red < 1 || counts.blue < 1) out.kickoffWhy = 'teams_empty'
    else if (view.mt >= MAX_MT) out.kickoffWhy = 'bad_phase'
    out.kickoff = out.kickoffWhy === null
    return out
  }

  function freezePresets () {
    const out = {}
    RULES.forEach((key) => {
      out[key] = Object.freeze({ secs: PRESETS[key].secs, goals: PRESETS[key].goals })
    })
    return Object.freeze(out)
  }

  return Object.freeze({
    id: ID,
    VERSION: VERSION,
    MIN_PLAYERS: MIN_PLAYERS,
    MAX_PLAYERS: MAX_PLAYERS,
    RULES: Object.freeze(RULES.slice()),
    DEFAULT_RULES: DEFAULT_RULES,
    HIDDEN: false,
    ERRORS: Object.freeze(ERRORS.slice()),
    EVENTS: Object.freeze(EVENTS.slice()),
    DELAYED_MOVES: Object.freeze(DELAYED_MOVES.slice()),
    PRESETS: freezePresets(),
    TEAMS: Object.freeze(TEAMS.slice()),
    SIDES: Object.freeze(SIDES.slice()),
    PHASES: Object.freeze(PHASES.slice()),
    TEAM_MAX: TEAM_MAX,
    MAX_GOALS: MAX_GOALS,
    MAX_SCORE: MAX_SCORE,
    MAX_AT: MAX_AT,
    MAX_MT: MAX_MT,
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
    validateState: validateState,
    validateOptions: validateOptions,
    balanceTeams: balanceTeams,
    countSides: countSides,
    goalLimit: goalLimit
  })
})(window.TelsizGame)
