'use strict'

// Hexball fiziği (window.TelsizHexballPhysics). DOM, ağ, saat, rastgelelik ve sözlük kullanmaz, kullanıcıya görünen
// metin üretmez. Saat yoktur: dünya adım sayısıyla ilerler, bir adım 1/60 saniyedir ve iki alt adımda çözülür. Fiziği
// yalnızca ev sahibi hesaplar (45-hexball-ag.js oyunculara anlık görüntü gönderir), oyuncular çizim için ara değer
// bulur. Belirlenimcidir: aynı dünyaya aynı girdi dizisi her zaman aynı sonucu verir. Bunun için gizli durum,
// Math.random, trigonometri ve sırası belirsiz yineleme kullanılmaz, diskler her zaman yuva sırasıyla işlenir.
// Değerler başlangıç değerleridir, oynanarak ayarlanır ve başka bir oyundan kopyalanmamıştır.
// Koordinatlar: orta nokta (0, 0), x sağa, y aşağı artar. Kırmızı soldaki kaleyi (x < 0), Mavi sağdakini savunur.
// Top kale çizgisini bütünüyle geçince (merkezi çizginin yarıçap kadar ötesinde) gol olur.
// Aşamalar:
// - kickoff: başlama vuruşu. Topa dokunulana kadar herkes kendi yarısında kalır, savunan takım orta yuvarlağın
//   dışında bekler. Topa ilk dokunuşla play başlar. Maç saati işlemez.
// - play: oyun. Maç saati yalnızca bu aşamada işler.
// - goal: gol sonrası 2 saniye. Diskler hareket eder, gol sayılmaz, saat işlemez. Sonra gol yiyen takım başlar.
// - paused: ev sahibi durakladı (pause, resume), adım hiçbir şey yapmaz.
// - over: maç bitti (gol sınırı, süre, altın gol ya da stop), adım hiçbir şey yapmaz.
// Maç sonu kuralları 43-hexball-kural.js ile aynıdır: gol sınırına ulaşan kazanır, süre bitince önde olan kazanır,
// beraberlikte altın gol oynanır ve ilk gol maçı bitirir. Ev sahibi step olaylarını (goal, time) kural motoruna
// hamle olarak gönderir, iki taraf aynı sonuca varır.
// Dünya düz bir nesnedir ve step tarafından yerinde değiştirilir. Kopya için cloneWorld kullanılır.

window.TelsizHexballPhysics = (function () {
  const VERSION = 1
  const TICK_HZ = 60
  const SUBSTEPS = 2
  const RULES = ['quick', 'classic', 'long']
  // Saha ölçüleri (genişlik, yükseklik, kale ağzı). Maç süresi ve gol sınırı kural motorundadır (PRESETS).
  const FIELDS = {
    quick: { w: 720, h: 360, goal: 120 },
    classic: { w: 880, h: 440, goal: 140 },
    long: { w: 1040, h: 520, goal: 160 }
  }
  const TEAMS = ['red', 'blue']
  const PHASES = ['kickoff', 'play', 'goal', 'paused', 'over']
  const WHY = ['score', 'time', 'golden']
  const MAX_SLOTS = 8
  // Kalan süre anlık görüntüde u16 desisaniyedir, en uzun maç buna sığar
  const MAX_SECS = 6000
  // Skor anlık görüntüde bir bayttır
  const MAX_GOALS = 255
  // Golün maç saatindeki saniyesi (kural motorundaki MAX_AT)
  const MAX_AT = 65535

  // Saha
  const GOAL_DEPTH = 30
  const POST_R = 7
  // Oyuncuların saha çizgilerinin dışında kalabileceği pay
  const MARGIN = 50
  const CENTER_R = 70
  // Oyuncu diski
  const PLAYER_R = 15
  const PLAYER_INV = 0.5
  const PLAYER_DAMP = 0.96
  const ACCEL = 0.11
  const KICK_ACCEL = 0.07
  // Top
  const BALL_R = 10
  const BALL_INV = 1
  const BALL_DAMP = 0.985
  // Vuruş: itki ve erim (yarıçaplar toplamına eklenen)
  const KICK_POWER = 5.6
  const KICK_REACH = 4
  // Sekme katsayıları
  const E_DISC = 0.5
  const E_BALL_WALL = 0.6
  const E_PLAYER_WALL = 0.5
  // Hız sınırları (birim/adım). Alt adımda top en çok 8 birim yol alır: top yarıçapından (10) ve top ile direk
  // yarıçaplarının toplamından (17) küçük olduğu için top duvardan ya da direkten geçemez.
  const MAX_BALL_SPEED = 16
  const MAX_PLAYER_SPEED = 8
  // Gol sonrası bekleme (adım)
  const GOAL_PAUSE = 2 * TICK_HZ

  // Başlama vuruşu dizilişi: takımdaki kişi sayısına göre [x, y], x yarı genişliğin, y yarı yüksekliğin oranı.
  // Kırmızı için x eksi, Mavi için artı alınır. En yakın oyuncu en küçük sahada da orta yuvarlağın dışındadır:
  // 0,3 x 360 = 108, yuvarlak ve disk yarıçapı 70 + 15 = 85.
  const FORMATIONS = [
    [],
    [[0.5, 0]],
    [[0.5, -0.4], [0.5, 0.4]],
    [[0.3, 0], [0.6, -0.5], [0.6, 0.5]],
    [[0.3, -0.3], [0.3, 0.3], [0.65, -0.55], [0.65, 0.55]]
  ]

  const OPTION_KEYS = ['rules', 'secs', 'goals', 'kick', 'players']
  const PLAYER_KEYS = ['slot', 'side']

  // ----- Küçük yardımcılar -----

  function fail (code) {
    const err = new Error(code)
    err.code = code
    return err
  }

  function hasOwn (obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key)
  }

  function isPlain (x) {
    return x !== null && typeof x === 'object' && !Array.isArray(x)
  }

  function exactKeys (obj, keys) {
    const own = Object.keys(obj)
    return own.length === keys.length && keys.every((key) => hasOwn(obj, key))
  }

  function isInt (n, min, max) {
    return Number.isInteger(n) && n >= min && n <= max
  }

  function otherTeam (side) {
    return side === 'red' ? 'blue' : 'red'
  }

  function clampUnit (n) {
    if (typeof n !== 'number' || !isFinite(n)) return 0
    return n < -1 ? -1 : n > 1 ? 1 : n
  }

  // ----- Saha geometrisi -----

  // Duvar parçası: a'dan b'ye, (nx, ny) disk tam üstündeyken kullanılan iç yön. players: oyuncular da çarpar.
  function segment (ax, ay, bx, by, nx, ny, players) {
    return Object.freeze({ ax: ax, ay: ay, bx: bx, by: by, nx: nx, ny: ny, players: players })
  }

  // Top saha çizgilerinde kalır, kale ağzı açıktır. Kale filesi (iki yan ve arka) hem topu hem oyuncuları durdurur,
  // oyuncular kaleye yalnızca ağızdan girer. Direkler kale ağzının iki ucundadır.
  function buildField (rules) {
    const f = FIELDS[rules]
    const hw = f.w / 2
    const hh = f.h / 2
    const g = f.goal / 2
    const d = GOAL_DEPTH
    const segments = [
      segment(-hw, -hh, hw, -hh, 0, 1, false),
      segment(-hw, hh, hw, hh, 0, -1, false),
      segment(-hw, -hh, -hw, -g, 1, 0, false),
      segment(-hw, g, -hw, hh, 1, 0, false),
      segment(hw, -hh, hw, -g, -1, 0, false),
      segment(hw, g, hw, hh, -1, 0, false),
      segment(-hw, -g, -hw - d, -g, 0, 1, true),
      segment(-hw - d, -g, -hw - d, g, 1, 0, true),
      segment(-hw - d, g, -hw, g, 0, -1, true),
      segment(hw, -g, hw + d, -g, 0, 1, true),
      segment(hw + d, -g, hw + d, g, -1, 0, true),
      segment(hw + d, g, hw, g, 0, -1, true)
    ]
    const posts = [
      Object.freeze({ x: -hw, y: -g, nx: 1 }),
      Object.freeze({ x: -hw, y: g, nx: 1 }),
      Object.freeze({ x: hw, y: -g, nx: -1 }),
      Object.freeze({ x: hw, y: g, nx: -1 })
    ]
    return Object.freeze({
      rules: rules,
      w: f.w,
      h: f.h,
      goal: f.goal,
      hw: hw,
      hh: hh,
      depth: d,
      postR: POST_R,
      margin: MARGIN,
      centerR: CENTER_R,
      playerR: PLAYER_R,
      ballR: BALL_R,
      segments: Object.freeze(segments),
      posts: Object.freeze(posts)
    })
  }

  const GEOMETRY = {}
  RULES.forEach((rules) => {
    GEOMETRY[rules] = buildField(rules)
  })

  // Ön ayarın saha geometrisi (dondurulmuş, çizim için de kullanılır) ya da null
  function field (rules) {
    return typeof rules === 'string' && hasOwn(GEOMETRY, rules) ? GEOMETRY[rules] : null
  }

  // ----- Girdi -----

  // Ağdan gelen girdi sınırlanır: x ve y [-1, 1] aralığında, vektörün boyu en çok 1, vuruş yalnızca true ile.
  // Sayı olmayan ya da sonlu olmayan değer 0 sayılır.
  function normalizeInput (raw) {
    if (raw === null || typeof raw !== 'object') return { x: 0, y: 0, kick: false }
    let x = clampUnit(raw.x)
    let y = clampUnit(raw.y)
    const len2 = x * x + y * y
    if (len2 > 1) {
      const len = Math.sqrt(len2)
      x /= len
      y /= len
    }
    return { x: x, y: y, kick: raw.kick === true }
  }

  // ----- Dünya -----

  // Seçenekler: rules ön ayar, secs maç süresi (saniye), goals etkin gol sınırı (1-255, kural motorunda goalLimit),
  // kick başlayan takım, players 1-8 kişi { slot: 0-7 benzersiz, side: red | blue }. Dönüş: kendi kopyası veya null.
  function validateOptions (o) {
    if (!isPlain(o) || !exactKeys(o, OPTION_KEYS) || RULES.indexOf(o.rules) < 0) return null
    if (!isInt(o.secs, 1, MAX_SECS) || !isInt(o.goals, 1, MAX_GOALS) || TEAMS.indexOf(o.kick) < 0) return null
    const p = o.players
    if (!Array.isArray(p) || p.length < 1 || p.length > MAX_SLOTS) return null
    const seen = []
    const ok = p.every((x) => {
      if (!isPlain(x) || !exactKeys(x, PLAYER_KEYS) || !isInt(x.slot, 0, MAX_SLOTS - 1)) return false
      if (TEAMS.indexOf(x.side) < 0 || seen.indexOf(x.slot) >= 0) return false
      seen.push(x.slot)
      return true
    })
    if (!ok) return null
    const players = p.map((x) => ({ slot: x.slot, side: x.side }))
    players.sort((a, b) => a.slot - b.slot)
    return { rules: o.rules, secs: o.secs, goals: o.goals, kick: o.kick, players: players }
  }

  function formation (k, i) {
    if (k < FORMATIONS.length) return FORMATIONS[k][i]
    return [0.5, (2 * (i + 1)) / (k + 1) - 1]
  }

  // Başlama vuruşu dizilişi: top ortada, oyuncular kendi yarılarında, hepsi durgun
  function placeKickoff (w) {
    const f = GEOMETRY[w.rules]
    TEAMS.forEach((side) => {
      const s = side === 'red' ? -1 : 1
      const team = w.players.filter((p) => p.side === side)
      team.forEach((p, i) => {
        const at = formation(team.length, i)
        p.x = s * at[0] * f.hw
        p.y = at[1] * f.hh
        p.vx = 0
        p.vy = 0
      })
    })
    w.ball.x = 0
    w.ball.y = 0
    w.ball.vx = 0
    w.ball.vy = 0
    w.touch = -1
    w.phase = 'kickoff'
  }

  // Yeni maç: başlama vuruşu aşamasında, skor 0-0, saat 0. Hatalı seçenekte bad_options fırlatır.
  // Alanlar: tick (biten adım sayısı), clock (play aşamasındaki adım sayısı), restart (gol sonrası başlama
  // vuruşunun yapılacağı adım), touch (topa son dokunanın yuvası, yoksa -1), held (duraklamadan önceki aşama).
  function createWorld (opts) {
    const o = validateOptions(opts)
    if (!o) throw fail('bad_options')
    const w = {
      rules: o.rules,
      secs: o.secs,
      goals: o.goals,
      tick: 0,
      phase: 'kickoff',
      held: null,
      clock: 0,
      golden: false,
      kick: o.kick,
      score: { red: 0, blue: 0 },
      restart: 0,
      touch: -1,
      ball: { x: 0, y: 0, vx: 0, vy: 0 },
      players: o.players.map((p) => ({ slot: p.slot, side: p.side, x: 0, y: 0, vx: 0, vy: 0, kick: false, armed: true }))
    }
    placeKickoff(w)
    return w
  }

  function cloneWorld (w) {
    return {
      rules: w.rules,
      secs: w.secs,
      goals: w.goals,
      tick: w.tick,
      phase: w.phase,
      held: w.held,
      clock: w.clock,
      golden: w.golden,
      kick: w.kick,
      score: { red: w.score.red, blue: w.score.blue },
      restart: w.restart,
      touch: w.touch,
      ball: { x: w.ball.x, y: w.ball.y, vx: w.ball.vx, vy: w.ball.vy },
      players: w.players.map((p) => ({
        slot: p.slot, side: p.side, x: p.x, y: p.y, vx: p.vx, vy: p.vy, kick: p.kick, armed: p.armed
      }))
    }
  }

  // ----- Çarpışmalar -----

  // İki hareketli disk: iç içe geçme ters kütle oranıyla ayrılır, yaklaşıyorlarsa normal yönde dürtü uygulanır
  // (sekme katsayısı e). Merkezler çakışırsa yön (1, 0) alınır. Dönüş: diskler değdi mi.
  function collideDiscs (a, ra, ia, b, rb, ib, e) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    const rr = ra + rb
    const d2 = dx * dx + dy * dy
    if (d2 >= rr * rr) return false
    let nx = 1
    let ny = 0
    let d = 0
    if (d2 > 0) {
      d = Math.sqrt(d2)
      nx = dx / d
      ny = dy / d
    }
    const im = ia + ib
    const pen = rr - d
    a.x -= nx * pen * ia / im
    a.y -= ny * pen * ia / im
    b.x += nx * pen * ib / im
    b.y += ny * pen * ib / im
    const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
    if (rel < 0) {
      const j = -(1 + e) * rel / im
      a.vx -= nx * j * ia
      a.vy -= ny * j * ia
      b.vx += nx * j * ib
      b.vy += ny * j * ib
    }
    return true
  }

  // Disk ile sabit nokta (r: toplam yarıçap). Merkez tam noktadaysa (fx, fy) yönüne itilir.
  function hitPoint (disc, r, px, py, e, fx, fy) {
    let nx = disc.x - px
    let ny = disc.y - py
    const d2 = nx * nx + ny * ny
    if (d2 >= r * r) return false
    const d = Math.sqrt(d2)
    if (d > 0) {
      nx /= d
      ny /= d
    } else {
      nx = fx
      ny = fy
    }
    const pen = r - d
    disc.x += nx * pen
    disc.y += ny * pen
    const vn = disc.vx * nx + disc.vy * ny
    if (vn < 0) {
      disc.vx -= (1 + e) * vn * nx
      disc.vy -= (1 + e) * vn * ny
    }
    return true
  }

  // Disk ile duvar parçası: parçanın diske en yakın noktası sabit nokta gibi davranır
  function hitSegment (disc, r, s, e) {
    const ex = s.bx - s.ax
    const ey = s.by - s.ay
    let t = ((disc.x - s.ax) * ex + (disc.y - s.ay) * ey) / (ex * ex + ey * ey)
    t = t < 0 ? 0 : t > 1 ? 1 : t
    return hitPoint(disc, r, s.ax + ex * t, s.ay + ey * t, e, s.nx, s.ny)
  }

  // Önce direkler, sonra duvarlar: kalenin direk yanındaki köşesine sıkışan oyuncu direğe çok az girebilir ama
  // fileden hiçbir zaman taşmaz
  function hitWalls (disc, r, f, e, playerOnly) {
    f.posts.forEach((p) => {
      hitPoint(disc, r + POST_R, p.x, p.y, e, p.nx, 0)
    })
    f.segments.forEach((s) => {
      if (!playerOnly || s.players) hitSegment(disc, r, s, e)
    })
  }

  // Oyuncular saha çizgilerinin MARGIN kadar dışına kadar gidebilir. Dışa doğru hız sıfırlanır.
  function keepInBox (p, f) {
    const lx = f.hw + MARGIN - PLAYER_R
    const ly = f.hh + MARGIN - PLAYER_R
    if (p.x < -lx) {
      p.x = -lx
      if (p.vx < 0) p.vx = 0
    } else if (p.x > lx) {
      p.x = lx
      if (p.vx > 0) p.vx = 0
    }
    if (p.y < -ly) {
      p.y = -ly
      if (p.vy < 0) p.vy = 0
    } else if (p.y > ly) {
      p.y = ly
      if (p.vy > 0) p.vy = 0
    }
  }

  // Başlama vuruşu kısıtı: disk orta çizgiyi geçmez, savunan takımın diski orta yuvarlağa girmez
  function keepKickoff (w, p) {
    const s = p.side === 'red' ? -1 : 1
    if (p.x * s < PLAYER_R) {
      p.x = s * PLAYER_R
      if (p.vx * s < 0) p.vx = 0
    }
    if (p.side === w.kick) return
    const min = CENTER_R + PLAYER_R
    const d2 = p.x * p.x + p.y * p.y
    if (d2 >= min * min) return
    const d = Math.sqrt(d2)
    const nx = p.x / d
    const ny = p.y / d
    p.x = nx * min
    p.y = ny * min
    const vn = p.vx * nx + p.vy * ny
    if (vn < 0) {
      p.vx -= vn * nx
      p.vy -= vn * ny
    }
  }

  function capSpeed (disc, max) {
    const s2 = disc.vx * disc.vx + disc.vy * disc.vy
    if (s2 <= max * max) return
    const k = max / Math.sqrt(s2)
    disc.vx *= k
    disc.vy *= k
  }

  function capAll (w) {
    w.players.forEach((p) => capSpeed(p, MAX_PLAYER_SPEED))
    capSpeed(w.ball, MAX_BALL_SPEED)
  }

  // ----- Maç akışı -----

  function matchSecond (w) {
    return Math.min(MAX_AT, Math.floor(w.clock / TICK_HZ))
  }

  // Kalan süre (adım). Altın golde 0.
  function remaining (w) {
    return w.golden ? 0 : Math.max(0, w.secs * TICK_HZ - w.clock)
  }

  function finish (w, winner, why, ev) {
    w.phase = 'over'
    ev.push({ e: 'over', winner: winner, why: why })
  }

  // Topa dokunuş: başlama vuruşunda oyunu başlatır
  function touchBall (w, p, ev) {
    w.touch = p.slot
    if (w.phase === 'kickoff') {
      w.phase = 'play'
      ev.push({ e: 'play', by: p.slot })
    }
  }

  // side golü kazanan takım, by topa son dokunanın yuvası (kendi kalesine gol kural motorunda ayrılır)
  function scoreGoal (w, side, ev) {
    w.score[side]++
    ev.push({ e: 'goal', side: side, by: w.touch >= 0 ? w.touch : null, at: matchSecond(w) })
    if (w.golden) return finish(w, side, 'golden', ev)
    if (w.score[side] >= w.goals) return finish(w, side, 'score', ev)
    w.phase = 'goal'
    w.restart = w.tick + GOAL_PAUSE
    w.kick = otherTeam(side)
  }

  function checkGoal (w, f, ev) {
    const b = w.ball
    if (Math.abs(b.y) >= f.goal / 2) return
    if (b.x < -(f.hw + BALL_R)) scoreGoal(w, 'blue', ev)
    else if (b.x > f.hw + BALL_R) scoreGoal(w, 'red', ev)
  }

  // Girdi: ivme (vuruş tutulurken daha az) ve vuruş. Vuruş tutuldukça bir kez vurur, top erime girince vurur,
  // bırakılınca yeniden kurulur.
  function applyInput (w, p, inp, ev) {
    p.kick = inp.kick
    const acc = inp.kick ? KICK_ACCEL : ACCEL
    p.vx += inp.x * acc
    p.vy += inp.y * acc
    if (!inp.kick) {
      p.armed = true
      return
    }
    if (!p.armed) return
    const b = w.ball
    const dx = b.x - p.x
    const dy = b.y - p.y
    const d2 = dx * dx + dy * dy
    const reach = PLAYER_R + BALL_R + KICK_REACH
    if (d2 === 0 || d2 > reach * reach) return
    const d = Math.sqrt(d2)
    b.vx += dx / d * KICK_POWER * BALL_INV
    b.vy += dy / d * KICK_POWER * BALL_INV
    p.armed = false
    touchBall(w, p, ev)
  }

  // Alt adım: konumlar, diskler arası çarpışmalar (yuva sırasıyla, top en sonda), duvarlar ve direkler, oyuncu
  // kutusu, başlama vuruşu kısıtı, hız sınırları ve gol denetimi
  function substep (w, f, ev) {
    const ps = w.players
    const b = w.ball
    ps.forEach((p) => {
      p.x += p.vx / SUBSTEPS
      p.y += p.vy / SUBSTEPS
    })
    b.x += b.vx / SUBSTEPS
    b.y += b.vy / SUBSTEPS
    let i = 0
    while (i < ps.length) {
      let j = i + 1
      while (j < ps.length) {
        collideDiscs(ps[i], PLAYER_R, PLAYER_INV, ps[j], PLAYER_R, PLAYER_INV, E_DISC)
        j++
      }
      if (collideDiscs(ps[i], PLAYER_R, PLAYER_INV, b, BALL_R, BALL_INV, E_DISC)) touchBall(w, ps[i], ev)
      i++
    }
    ps.forEach((p) => hitWalls(p, PLAYER_R, f, E_PLAYER_WALL, true))
    hitWalls(b, BALL_R, f, E_BALL_WALL, false)
    ps.forEach((p) => keepInBox(p, f))
    if (w.phase === 'kickoff') ps.forEach((p) => keepKickoff(w, p))
    capAll(w)
    if (w.phase === 'play') checkGoal(w, f, ev)
  }

  // Bir adım (1/60 saniye). inputs yuva numarasıyla dizinlenir (dizi ya da nesne), eksik girdi boş sayılır.
  // Dönüş: bu adımın olayları, sırasıyla:
  // { e: 'play', by } başlama vuruşu yapıldı, { e: 'goal', side, by, at } gol (at maç saatindeki saniye),
  // { e: 'time' } süre bitti, { e: 'golden' } altın gol başladı, { e: 'over', winner, why } maç bitti,
  // { e: 'kickoff', kick } gol sonrası başlama vuruşu dizilişi.
  function step (w, inputs) {
    const ev = []
    if (w.phase === 'paused' || w.phase === 'over') return ev
    const f = GEOMETRY[w.rules]
    const list = inputs !== null && typeof inputs === 'object' ? inputs : {}
    w.players.forEach((p) => applyInput(w, p, normalizeInput(list[p.slot]), ev))
    capAll(w)
    let n = 0
    while (n < SUBSTEPS) {
      substep(w, f, ev)
      n++
    }
    w.players.forEach((p) => {
      p.vx *= PLAYER_DAMP
      p.vy *= PLAYER_DAMP
    })
    w.ball.vx *= BALL_DAMP
    w.ball.vy *= BALL_DAMP
    if (w.phase === 'play') {
      w.clock++
      if (!w.golden && w.clock >= w.secs * TICK_HZ) {
        ev.push({ e: 'time' })
        if (w.score.red === w.score.blue) {
          w.golden = true
          ev.push({ e: 'golden' })
        } else {
          finish(w, w.score.red > w.score.blue ? 'red' : 'blue', 'time', ev)
        }
      }
    } else if (w.phase === 'goal' && w.tick >= w.restart) {
      placeKickoff(w)
      ev.push({ e: 'kickoff', kick: w.kick })
    }
    w.tick++
    return ev
  }

  // Duraklatma: adım hiçbir şey yapmaz, resume önceki aşamaya döner. Dönüş: durum değişti mi.
  function pause (w) {
    if (w.phase === 'paused' || w.phase === 'over') return false
    w.held = w.phase
    w.phase = 'paused'
    return true
  }

  function resume (w) {
    if (w.phase !== 'paused') return false
    w.phase = w.held
    w.held = null
    return true
  }

  // Maçı dışarıdan bitirir (ev sahibi durdurdu ya da bir takım boşaldı). Olay üretilmez.
  function stop (w) {
    if (w.phase === 'over') return false
    w.phase = 'over'
    w.held = null
    return true
  }

  // Maç sürerken ayrılan ya da koltuktan çıkarılan kişinin diski dünyadan kalkar. Topa son dokunan oysa dokunuş
  // silinir (sonraki gol takıma yazılır). Başlama vuruşu beklenirken kalanlar yeni sayıya göre yeniden dizilir,
  // sonraki başlama vuruşlarında da diziliş kalanlara göredir. Olay üretilmez. Dönüş: disk vardı ve kalktı.
  function removePlayer (w, slot) {
    const i = w.players.findIndex((p) => p.slot === slot)
    if (i < 0) return false
    w.players.splice(i, 1)
    if (w.touch === slot) w.touch = -1
    if (w.phase === 'kickoff' || (w.phase === 'paused' && w.held === 'kickoff')) {
      const phase = w.phase
      placeKickoff(w)
      w.phase = phase
    }
    return true
  }

  function freezeFields () {
    const out = {}
    RULES.forEach((key) => {
      out[key] = Object.freeze({ w: FIELDS[key].w, h: FIELDS[key].h, goal: FIELDS[key].goal })
    })
    return Object.freeze(out)
  }

  return Object.freeze({
    VERSION: VERSION,
    TICK_HZ: TICK_HZ,
    SUBSTEPS: SUBSTEPS,
    RULES: Object.freeze(RULES.slice()),
    FIELDS: freezeFields(),
    TEAMS: Object.freeze(TEAMS.slice()),
    PHASES: Object.freeze(PHASES.slice()),
    WHY: Object.freeze(WHY.slice()),
    MAX_SLOTS: MAX_SLOTS,
    MAX_SECS: MAX_SECS,
    MAX_GOALS: MAX_GOALS,
    MAX_AT: MAX_AT,
    GOAL_DEPTH: GOAL_DEPTH,
    POST_R: POST_R,
    MARGIN: MARGIN,
    CENTER_R: CENTER_R,
    PLAYER_R: PLAYER_R,
    PLAYER_INV: PLAYER_INV,
    PLAYER_DAMP: PLAYER_DAMP,
    ACCEL: ACCEL,
    KICK_ACCEL: KICK_ACCEL,
    BALL_R: BALL_R,
    BALL_INV: BALL_INV,
    BALL_DAMP: BALL_DAMP,
    KICK_POWER: KICK_POWER,
    KICK_REACH: KICK_REACH,
    E_DISC: E_DISC,
    E_BALL_WALL: E_BALL_WALL,
    E_PLAYER_WALL: E_PLAYER_WALL,
    MAX_BALL_SPEED: MAX_BALL_SPEED,
    MAX_PLAYER_SPEED: MAX_PLAYER_SPEED,
    GOAL_PAUSE: GOAL_PAUSE,
    field: field,
    validateOptions: validateOptions,
    createWorld: createWorld,
    cloneWorld: cloneWorld,
    normalizeInput: normalizeInput,
    step: step,
    pause: pause,
    resume: resume,
    stop: stop,
    removePlayer: removePlayer,
    remaining: remaining,
    matchSecond: matchSecond
  })
})()
