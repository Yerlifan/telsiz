'use strict'

// Oyun ağ benzetimi: dört cihaz, gerçek kripto. Her sayfa kendi Node vm bağlamıdır ve tarayıcıdaki sırayla
// TweetNaCl, public/crypto.js, protokol çekirdeği (33), masa yöneticisi (34) ve Renk kural motoru (35) yüklenir.
// Kimlik anahtarları E2EE.identity.generate() ile üretilir, iç zarflar E2EE.dm ile mühürlenir.
// Bellekteki "sunucu" voice.js oyun taşımasını benzetir: ses odası üyeliği (sayfası kapanan kişi kadroda kalır),
// eş başına bağlantı kimliği (sid) ve hazır olma (peer-ready), göndericinin alıcı başına sıralı POST kuyruğu ve done
// geri çağrısı, eş başına sıralı teslim, dış katmanın yeniden oynatma koruması (sid ve n) ve eski sid'in atılması.
// Ağ koşulları tohumludur: kayıp, çift teslim, sıra bozulması, 0-500 ms gecikme ve yeniden denemelerden sonra 429.
// Sunucuyu işleten saldırgan (grup anahtarını bilir, kimlik anahtarlarını bilmez) zarfları yeni n ile kopyalar ve
// yeniden oynatır, gönderen alanını sahteler. Oyuncular tohumlu rastgele hamle seçen botlarla oynar, kurpiyerin tam
// durumu uygulama sarmalayıcısıyla izlenir ve her adımda TelsizRenk.validateState ile denetlenir.

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const nodeCrypto = require('node:crypto')

const ROOT = path.join(__dirname, '..')
const SCRIPTS = [
  ['vendor', 'nacl-fast.min.js'],
  ['crypto.js'],
  ['js', '33-oyun-protokol.js'],
  ['js', '34-oyun-masa.js'],
  ['js', '35-renk-kural.js']
].map((parts) => {
  const file = path.join.apply(path, [ROOT, 'public'].concat(parts))
  return new vm.Script(fs.readFileSync(file, 'utf8'), { filename: parts[parts.length - 1] })
})

const CH = '3'
const IDS = ['5', '12', '7', '30']
const COLORS = ['R', 'Y', 'G', 'B']
const CARD_RE = /^(?:[RYGB][0-9SVD]|W[WF])$/
const TICK_MS = 250
// Botların davranışı: sıra dışı hamle olasılıkları, oynamak yerine çekme ve Tek! bildirme
const BOT = { catch: 0.5, late: 0.5, drawInstead: 0.1, announce: 0.6 }

// Bir sayfa: kendi vm bağlamı ve yüklü betikler
function loadPage () {
  const ctx = vm.createContext({})
  ctx.self = ctx
  ctx.window = ctx
  ctx.crypto = nodeCrypto.webcrypto
  ctx.console = { log () {}, warn () {}, error () {} }
  SCRIPTS.forEach((s) => s.runInContext(ctx))
  return ctx
}

const HELP = loadPage()
const R = HELP.TelsizRenk
const TM = HELP.TelsizGameDesk.TIMES

function text (x) {
  return JSON.stringify(x)
}

// vm bağlamındaki nesnelerin ön örnekleri farklıdır, karşılaştırma JSON kopyasıyla yapılır
function same (actual, expected, message) {
  const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))
  assert.deepEqual(plain(actual), plain(expected), message)
}

// xorshift32 ile tohumlu kaynak (ağ koşulları, botlar ve masa yöneticisinin rng değeri)
function prng (seed) {
  let x = (seed * 2654435761) >>> 0 || 1
  function next () {
    x ^= x << 13
    x >>>= 0
    x ^= x >>> 17
    x ^= x << 5
    x >>>= 0
    return x
  }
  const float = () => next() / 4294967296
  return {
    float,
    int: (min, max) => min + Math.floor(float() * (max - min + 1)),
    pick: (list) => list[Math.floor(float() * list.length)],
    bytes: (n) => {
      const out = []
      while (out.length < n) out.push(next() & 255)
      return out
    }
  }
}

// Kurpiyerin tam durumunu izleyen uygulama sarmalayıcısı: başarılı her çağrının sonucu sayfanın game alanına
// yazılır ve değişmezler denetlenir
function spyApp (page) {
  const A = page.ctx.TelsizRenk
  const wrap = (name) => function () {
    const res = A[name].apply(null, arguments)
    page.game = res.state
    if (!A.validateState(res.state)) page.bad.push(name)
    return res
  }
  return Object.assign({}, A, {
    newGame: wrap('newGame'),
    applyMove: wrap('applyMove'),
    removePlayer: wrap('removePlayer'),
    endGame: wrap('endGame')
  })
}

// ----- Bellekteki sunucu ve ağ -----

function makeNet (opts) {
  const o = Object.assign({ seed: 1, loss: 0.1, dup: 0.05, copy: 0.05, reorder: 0.03, refuse: 0.02, delay: 500 }, opts)
  const net = {
    o,
    clock: 1000000,
    rand: prng(o.seed),
    timers: [],
    nextId: 0,
    // Sunucudaki ses üyeliği (peerId -> userId). Sayfası kapanan kişi burada kalır (hayalet).
    voice: {},
    people: {},
    pages: [],
    // Sunucunun gördüğü bütün zarflar (S3 bunları kaydedip yeniden oynatabilir)
    log: [],
    fifo: {},
    sids: 0,
    stats: { sent: 0, delivered: 0, lost: 0, dup: 0, copy: 0, reordered: 0, refused: 0, notFresh: 0, staleSid: 0 }
  }

  net.at = (at, fn) => {
    const item = { at: Math.max(at, net.clock), id: net.nextId++, fn }
    let i = net.timers.length
    while (i > 0 && net.timers[i - 1].at > item.at) i--
    net.timers.splice(i, 0, item)
  }

  // Sıradaki zamanlayıcı until anına kadarsa saat ona ilerler ve çalışır. Dönüş: çalıştı mı
  net.step = (until) => {
    if (!net.timers.length || net.timers[0].at > until) return false
    const item = net.timers.shift()
    net.clock = item.at
    item.fn()
    return true
  }

  net.run = (ms) => {
    const until = net.clock + ms
    let more = true
    while (more) more = net.step(until)
    net.clock = until
  }

  // cond doğru olana kadar en çok ms kadar çalışır. Dönüş: cond
  net.runUntil = (cond, ms) => {
    const until = net.clock + ms
    if (cond()) return true
    while (net.step(until)) {
      if (cond()) return true
    }
    net.clock = until
    return cond()
  }

  net.person = (uid) => {
    const pair = HELP.E2EE.identity.generate()
    const who = { uid, peerId: 'peer-' + uid, pk: pair.publicKey, sk: Uint8Array.from(pair.secretKey), blocked: {}, page: null, pages: 0, autoJoin: true }
    net.people[uid] = who
    return who
  }

  net.pageOf = (peerId) => {
    const who = Object.keys(net.people).map((uid) => net.people[uid]).find((x) => x.peerId === peerId)
    return who && who.page && who.page.alive ? who.page : null
  }

  net.event = (page, evt) => {
    if (page.alive) page.desk.onVoiceEvent(evt)
  }

  // Yeni sayfa (aynı kişi, aynı kimlik ve peerId). 250 ms'de bir tick, sayfaya özgü evreyle.
  net.open = (who) => {
    const ctx = loadPage()
    const page = {
      who,
      ctx,
      alive: true,
      rand: prng(o.seed * 7919 + Number(who.uid) * 31 + who.pages),
      eng: { inVoice: false, gen: 0, peers: {}, seen: {}, busy: {} },
      sk: Uint8Array.from(who.sk),
      inbox: [],
      notices: [],
      game: null,
      bad: [],
      net,
      play: null,
      born: net.clock
    }
    page.onTick = () => autoPilot(page)
    who.pages++
    page.R = ctx.TelsizRenk
    page.G = ctx.TelsizGame
    page.env = {
      me: () => who.uid,
      channel: () => (page.alive && page.eng.inVoice ? CH : null),
      isPrivate: () => false,
      roomPeers: () => {
        if (!page.eng.inVoice) return []
        return Object.keys(net.voice).filter((pid) => pid !== who.peerId).map((pid) => ({ userId: net.voice[pid], peerId: pid }))
      },
      send: (peerId, p, done) => net.send(page, peerId, p, done),
      keys: (uid) => {
        if (who.blocked[uid]) return { ok: false, reason: 'blocked' }
        const other = net.people[uid]
        if (!other) return { ok: false, reason: 'gone' }
        return { ok: true, pk: other.pk, sk: page.sk }
      },
      dm: ctx.E2EE.dm,
      rng: (n) => page.rand.bytes(n),
      now: () => net.clock,
      isBlocked: (uid) => Boolean(who.blocked[uid]),
      apps: { renk: spyApp(page) },
      onChange: () => {},
      onNotice: (kind, data) => {
        page.notices.push({ kind, data, at: net.clock })
      }
    }
    page.desk = ctx.TelsizGameDesk.create(page.env)
    page.model = () => page.desk.model()
    who.page = page
    net.pages.push(page)
    const tick = () => {
      if (!page.alive) return
      page.desk.tick()
      if (page.onTick) page.onTick()
      net.at(net.clock + TICK_MS, tick)
    }
    net.at(net.clock + net.rand.int(0, TICK_MS - 1), tick)
    return page
  }

  // İki sayfa arasında yeni bağlantı: yeni sid, eski bağlantı olay yaymadan kapanır, kısa süre sonra iki tarafta
  // peer-ready olur (her peerId ve sid çifti için bir kez)
  net.connect = (a, b) => {
    net.sids++
    const sid = 'sid' + net.sids
    a.eng.peers[b.who.peerId] = { sid, ready: false, outN: 0 }
    b.eng.peers[a.who.peerId] = { sid, ready: false, outN: 0 }
    net.at(net.clock + net.rand.int(50, 250), () => {
      const pa = a.eng.peers[b.who.peerId]
      const pb = b.eng.peers[a.who.peerId]
      if (!a.alive || !b.alive || !pa || !pb || pa.sid !== sid || pb.sid !== sid) return
      pa.ready = true
      pb.ready = true
      const order = net.rand.float() < 0.5 ? [[a, b], [b, a]] : [[b, a], [a, b]]
      order.forEach((pair) => net.event(pair[0], { type: 'peer-ready', peerId: pair[1].who.peerId, userId: pair[1].who.uid }))
    })
  }

  // Ses odasına katılma: voice.js katılımın başında reset yayar, sonra odadaki her canlı sayfayla bağlantı kurulur
  net.join = (page) => {
    page.desk.onVoiceEvent({ type: 'reset' })
    page.eng.gen++
    page.eng.inVoice = true
    page.eng.peers = {}
    page.eng.busy = {}
    net.voice[page.who.peerId] = page.who.uid
    Object.keys(net.voice).forEach((pid) => {
      const other = net.pageOf(pid)
      if (pid !== page.who.peerId && other && other.eng.inVoice) net.connect(page, other)
    })
  }

  // Ses odasından ayrılma: kendi sayfasında reset, diğerlerinde kadro güncellenince peer-leave
  net.leave = (page) => {
    const who = page.who
    page.eng.inVoice = false
    page.eng.gen++
    page.eng.peers = {}
    delete net.voice[who.peerId]
    page.desk.onVoiceEvent({ type: 'reset' })
    net.pages.forEach((other) => {
      if (other === page || !other.alive || !other.eng.inVoice) return
      net.at(net.clock + net.rand.int(20, 200), () => {
        delete other.eng.peers[who.peerId]
        net.event(other, { type: 'peer-leave', peerId: who.peerId, userId: who.uid })
      })
    })
  }

  // Sayfa kapanır ama sunucu kişiyi seste tutar (hayalet): olay yok, gelen iletiler yutulur
  net.kill = (page) => {
    page.alive = false
  }

  // Sayfa yenileme: aynı peerId ve kimlikle yeni sayfa, ses odasına yeniden katılır (diğerlerinde peer-leave yok)
  net.reload = (who) => {
    net.kill(who.page)
    const page = net.open(who)
    net.join(page)
    return page
  }

  // voice.js sendGame: dönüş kodu, done(true) iletildi, done(sayı) yeniden denemelerden sonra da iletilemedi.
  // Oturum değişirse done çağrılmaz.
  net.send = (page, peerId, p, done) => {
    const eng = page.eng
    if (!page.alive || !eng.inVoice) return 'not_in_voice'
    if (typeof p !== 'string' || !p.length || p.length > 11000 || !/^[ -~]+$/.test(p)) return 'bad_message'
    if (!net.voice[peerId]) return 'no_peer'
    const peer = eng.peers[peerId]
    if (!peer) return 'no_peer'
    if (!peer.ready) return 'not_ready'
    peer.outN++
    const msg = { from: page.who, to: peerId, sid: peer.sid, n: peer.outN, p, at: net.clock }
    const gen = eng.gen
    const refused = net.rand.float() < o.refuse
    // Göndericinin alıcı başına kuyruğu: önceki POST bitmeden sonraki başlamaz. 429 üç yeniden denemeden sonra.
    let end = Math.max(net.clock, eng.busy[peerId] || 0) + net.rand.int(10, 60)
    if (refused) end += 7000
    eng.busy[peerId] = end
    net.stats.sent++
    net.at(end, () => {
      if (!page.alive || eng.gen !== gen) return
      let res = true
      if (refused) res = 429
      else if (!net.voice[page.who.peerId]) res = 403
      else if (!net.voice[peerId]) res = 404
      if (refused) net.stats.refused++
      if (res === true) net.route(msg)
      done(res)
    })
    return 'ok'
  }

  // Sunucu kabul etti: kayıp, sıra bozulması (geride kalan dış katmanda atılır), çift teslim (dış katmanda atılır) ve
  // saldırganın yeni n ile kopyası (iç katman karşılar)
  net.route = (msg) => {
    const r = net.rand
    net.log.push(msg)
    if (r.float() < o.loss) {
      net.stats.lost++
      return
    }
    const key = msg.from.peerId + '>' + msg.to
    const delay = r.int(0, o.delay)
    let at = 0
    if (r.float() < o.reorder) {
      net.stats.reordered++
      at = net.clock + delay + 600
    } else {
      at = Math.max(net.fifo[key] || 0, net.clock + delay)
      net.fifo[key] = at
    }
    net.at(at, () => net.receive(msg))
    if (r.float() < o.dup) {
      net.stats.dup++
      net.at(at + r.int(0, 100), () => net.receive(msg))
    }
    if (r.float() < o.copy) {
      net.stats.copy++
      net.at(at + r.int(0, o.delay), () => {
        const page = net.pageOf(msg.to)
        if (page) net.inject(page, msg.from, msg.p)
      })
    }
  }

  // Alıcının dış katmanı: kadro, yeniden oynatma koruması (sid başına artan n), aynı sid ve hazır bağlantı
  net.receive = (msg) => {
    const page = net.pageOf(msg.to)
    if (!page || !page.eng.inVoice || !net.voice[msg.from.peerId]) return
    const eng = page.eng
    const seen = eng.seen[msg.from.peerId] || (eng.seen[msg.from.peerId] = {})
    if (seen[msg.sid] !== undefined && msg.n <= seen[msg.sid]) {
      net.stats.notFresh++
      return
    }
    seen[msg.sid] = msg.n
    const peer = eng.peers[msg.from.peerId]
    if (!peer || peer.sid !== msg.sid || !peer.ready) {
      net.stats.staleSid++
      return
    }
    net.stats.delivered++
    page.inbox.push({ from: msg.from.uid, p: msg.p, at: net.clock })
    page.desk.onVoiceEvent({ type: 'message', peerId: msg.from.peerId, userId: msg.from.uid, p: msg.p })
  }

  // Saldırgan (S3): zarfı yeni n ile alıcının o göndericiyle güncel bağlantısına sokar
  net.inject = (page, from, p) => {
    const peer = page.eng.peers[from.peerId]
    if (!page.alive || !page.eng.inVoice || !peer || !peer.ready) return
    page.inbox.push({ from: from.uid, p, at: net.clock })
    page.desk.onVoiceEvent({ type: 'message', peerId: from.peerId, userId: from.uid, p })
  }

  return net
}

// ----- Zarfları okuma (yalnızca test tarafında) -----

// page sayfasının from kişisinden gelen p yükünü okuması: düz JSON ya da açılan iç metin, açılamazsa null
function readAt (page, fromUid, p) {
  if (p.charAt(0) === '{') return JSON.parse(p)
  const from = page.net.people[fromUid]
  return page.G.openInner(page.ctx.E2EE.dm, p, from.pk, page.sk)
}

// Sunucunun gördüğü zarflardan from kişisinden to kişisine gidenler, alıcının anahtarıyla açılmış hâlleriyle
function envelopes (net, from, to, k) {
  const page = to.page
  return net.log.filter((m) => m.from === from && m.to === to.peerId).map((m) => {
    const x = readAt(page, from.uid, m.p)
    return { m, x }
  }).filter((it) => it.x && (!k || it.x.k === k))
}

// Gizli el sızıntısı: alınan her iletinin açılmış metninde gezinilir. Kart kodu yalnızca alıcının kendi elinde
// (b.mine), üstteki kartta (b.view.top) ve play olaylarında (b.ev[i].c) bulunabilir.
function leaks (page) {
  const out = []
  const walk = (x, trail, root) => {
    if (typeof x === 'string') {
      if (CARD_RE.test(x) && !cardAllowed(root, trail)) out.push(trail.join('.') + '=' + x)
      return
    }
    if (x === null || typeof x !== 'object') return
    Object.keys(x).forEach((key) => walk(x[key], trail.concat([key]), root))
  }
  page.inbox.forEach((item) => {
    const x = readAt(page, item.from, item.p)
    if (x) walk(x, [], x)
  })
  return out
}

function cardAllowed (root, trail) {
  const pathText = trail.join('.')
  if (root.k !== 'state') return false
  if (pathText === 'b.view.top' || pathText === 'b.mine.drawn' || /^b\.mine\.cards\.\d+$/.test(pathText)) return true
  const m = /^b\.ev\.(\d+)\.c$/.exec(pathText)
  return Boolean(m) && root.b.ev[Number(m[1])].e === 'play'
}

// ----- Botlar -----

// Görünüm ve yasal hamlelerden tohumlu bir hamle. Sıra dışı Yakala ve geç Tek! olasılıkla seçilir.
function chooseMove (rand, m, o) {
  const L = m.legal
  if (m.stage !== 'play' || !L || !m.view || !m.mine) return null
  if (L.catch && rand.float() < o.catch) return { t: 'catch', p: L.catch }
  if (L.last && rand.float() < o.late) return { t: 'last' }
  if (!L.turn) return null
  const step = m.view.step
  if (L.color) return { t: 'color', col: rand.pick(COLORS), step }
  const cards = m.mine.cards
  const playOf = (c) => {
    const mv = { t: 'play', c, step }
    if (c.charAt(0) === 'W') mv.col = rand.pick(COLORS)
    if (cards.length === 2 && rand.float() < o.announce) mv.last = true
    return mv
  }
  if (L.drawn) return L.play.indexOf(L.drawn) >= 0 && rand.float() < 0.8 ? playOf(L.drawn) : { t: 'pass', step }
  if (L.play.length && rand.float() >= o.drawInstead) return playOf(rand.pick(L.play))
  return { t: 'draw', step }
}

// Her tick'te: davet gelince katılır, ret ekranını kapatır. autoDismiss ile biten masayı kapatır ve saklı lobi
// davetini Masaya Bak ile açar. play verilmişse serbest oyunda hamle yapar.
function autoPilot (page) {
  const m = page.model()
  const who = page.who
  if (who.autoJoin && (m.stage === 'invited' || m.stage === 'rejoin')) page.desk.join()
  else if (m.stage === 'rejected' || (who.autoDismiss && m.stage === 'ended')) page.desk.dismiss()
  else if (who.autoDismiss && m.stage === 'none' && m.invite && m.invite.ph === 'lobby') page.desk.openInvite()
  if (page.play) page.play(m)
}

// ----- Masa kurulumu ve sakinlik -----

// Dört kişi ses odasına girer, kurpiyer (ilk kişi) masayı açar, diğerleri davetle oturur
function seated (opts) {
  const o = Object.assign({ seed: 1, rules: 'official', ids: IDS }, opts)
  const net = makeNet(Object.assign({ seed: o.seed }, o.net))
  const all = o.ids.map((uid) => net.person(uid))
  if (o.before) o.before(net, all)
  all.forEach((who) => net.open(who))
  all.forEach((who) => net.join(who.page))
  net.run(1000)
  const K = all[0]
  assert.equal(K.page.desk.openSetup('renk'), true)
  assert.equal(K.page.desk.openTable(o.rules), true)
  const want = o.seats === undefined ? all.length : o.seats
  assert.ok(net.runUntil(() => K.page.model().seats.length === want, 60000), 'herkes oturur: ' + text(K.page.model().room))
  return { net, K, P: all.slice(1, want), all }
}

// Ağ sakin mi: her oyuncunun aşaması, koltukları, görünümü ve eli kurpiyerin tam durumuyla aynı, bekleyen hamle yok
function agreed (K, players) {
  const km = K.page.model()
  const game = K.page.game
  const A = K.page.R
  const view = km.stage === 'lobby' ? null : text(A.publicView(game))
  if (view !== null && text(km.view) !== view) return false
  return players.every((P) => {
    const m = P.page.model()
    if (m.stage !== km.stage || m.pending !== null || text(m.seats.map((s) => s.id)) !== text(km.seats.map((s) => s.id))) return false
    if (m.rules !== km.rules || m.rd !== km.rd) return false
    if (view === null) return true
    return text(m.view) === view && text(m.mine) === text(A.privateView(game, P.uid))
  })
}

function settle (t, ms) {
  return t.net.runUntil(() => agreed(t.K, t.P), ms === undefined ? 60000 : ms)
}

function start (t) {
  assert.equal(t.K.page.desk.start(), true)
  assert.ok(settle(t), 'Başlat sonrası herkes oyunda')
}

// Adım adım oyun: sıradaki kişi (ara sıra sıra dışı Yakala ya da geç Tek!) bir hamle yapar, ağ sakinleşince her
// oyuncunun görünümü ve eli kurpiyerin tam durumuyla karşılaştırılır. Dönüş: adım sayısı
function playLocked (t, rand, opts) {
  const o = Object.assign({ max: 3000, until: null }, opts)
  const all = [t.K].concat(t.P)
  let steps = 0
  while (t.K.page.model().stage === 'play' && !(o.until && o.until(steps))) {
    assert.ok(steps < o.max, 'el bitmedi')
    const extra = all.filter((x) => {
      const L = x.page.model().legal
      return L && (L.catch || L.last)
    })
    let actor = null
    let move = null
    if (extra.length && rand.float() < 0.5) {
      actor = rand.pick(extra)
      const L = actor.page.model().legal
      move = L.catch ? { t: 'catch', p: L.catch } : { t: 'last' }
    } else {
      const turn = t.K.page.R.turnOf(t.K.page.game)
      actor = all.find((x) => x.uid === turn)
      move = chooseMove(rand, actor.page.model(), { catch: 0, late: 0, drawInstead: BOT.drawInstead, announce: BOT.announce })
    }
    assert.ok(move, 'hamle seçildi')
    assert.equal(actor.page.desk.act(move), true, 'hamle kabul edildi ' + text(move))
    t.net.run(TM.SELF_DELAY_MS + TICK_MS)
    assert.ok(settle(t), 'ağ sakinleşince görünümler kurpiyerle aynı (adım ' + steps + ')')
    steps++
  }
  return steps
}

// Serbest oyun: her sayfa kendi tick'inde kendi görünümüne göre tohumlu olasılıkla hamle yapar, hamleler yarışır.
// Ardışık kayıplarla 45 sn kurpiyerden haber alamayan oyuncu dealer_lost ile çıkar ve koltuğu boşalır, el
// kalanlarla biter. Karşılaştırma kurpiyerin koltuklarındaki oyuncularla yapılır.
function playFree (t, rand, maxMs) {
  const all = [t.K].concat(t.P)
  all.forEach((x) => {
    x.page.play = (m) => {
      if (rand.float() >= 0.4) return
      const mv = chooseMove(rand, m, BOT)
      if (mv) x.page.desk.act(mv)
    }
  })
  const ok = t.net.runUntil(() => t.K.page.model().stage !== 'play', maxMs)
  all.forEach((x) => {
    x.page.play = null
  })
  assert.ok(ok, 'el bitti')
  const ids = t.K.page.model().seats.map((s) => s.id)
  t.P = t.P.filter((P) => ids.indexOf(P.uid) >= 0)
  assert.ok(settle(t), 'ağ sakinleşince görünümler kurpiyerle aynı')
}

function noLeaks (t) {
  t.P.forEach((P) => {
    same(leaks(P.page), [], 'sızıntı yok: ' + P.uid)
  })
}

function noBadState (t) {
  same(t.K.page.bad, [], 'kurpiyerin tam durumu her adımda geçerli')
}

// ----- Testler -----

describe('tam eller', () => {
  test('dört kişi oturur, Resmî ve eklemeli birer el adım adım oynanır, ağ sakinleşince görünümler kurpiyerle aynıdır', () => {
    const t = seated({ seed: 11, rules: 'official' })
    const rand = prng(101)
    start(t)
    const a = playLocked(t, rand)
    assert.ok(a > 10)
    assert.ok(settle(t))
    assert.equal(t.K.page.model().view.result.reason, 'out')
    assert.equal(t.K.page.desk.newRound(), true)
    assert.equal(t.K.page.desk.setRules('stack'), true)
    assert.ok(settle(t), 'Yeni El sonrası herkes lobide, kural eklemeli')
    start(t)
    assert.equal(t.P[0].page.model().view.rules, 'stack')
    const b = playLocked(t, rand)
    assert.ok(b > 10)
    assert.equal(t.P[1].page.model().view.result.reason, 'out')
    noLeaks(t)
    noBadState(t)
    const s = t.net.stats
    assert.ok(s.lost > 0 && s.dup > 0 && s.copy > 0 && s.reordered > 0 && s.refused > 0, 'ağ koşulları uygulandı ' + text(s))
  })
})

// Sunucunun gördüğü her iç zarf yalnızca iki tarafınca açılır: başka bir oyuncu da saldırgan da açamaz
function sealedPairs (t, attacker) {
  const people = Object.keys(t.net.people).map((uid) => t.net.people[uid])
  let checked = 0
  t.net.log.forEach((m) => {
    if (m.p.charAt(0) === '{') return
    const to = people.find((x) => x.peerId === m.to)
    people.filter((z) => z !== m.from && z !== to).forEach((z) => {
      assert.equal(HELP.TelsizGame.openInner(HELP.E2EE.dm, m.p, m.from.pk, z.sk), null, 'üçüncü kişi açamaz')
    })
    assert.equal(HELP.TelsizGame.openInner(HELP.E2EE.dm, m.p, m.from.pk, attacker.secretKey), null)
    assert.equal(HELP.TelsizGame.openInner(HELP.E2EE.dm, m.p, to.pk, attacker.secretKey), null)
    checked++
  })
  return checked
}

describe('gizlilik', () => {
  test('sızıntı denetimi başkasının kart kodunu bulur, izinli yerlerdekini saymaz', () => {
    const t = seated({ seed: 13 })
    start(t)
    const B = t.P[0]
    assert.ok(B.page.inbox.length > 0)
    same(leaks(B.page), [])
    // Kurpiyer B'ye C'nin elini taşıyan bir durum mühürlerse yürüyüş bulur
    const last = envelopes(t.net, t.K, B, 'state').pop().x
    const other = t.K.page.game.seats.find((x) => x.id === t.P[1].uid).hand
    const bad = Object.assign({}, last, { b: Object.assign({}, last.b, { view: Object.assign({}, last.b.view, { extra: [other[0]] }) }) })
    const p = t.K.page.G.sealInner(t.K.page.ctx.E2EE.dm, bad, B.pk, t.K.page.sk)
    B.page.inbox.push({ from: t.K.uid, p, at: t.net.clock })
    same(leaks(B.page), ['b.view.extra.0=' + other[0]])
    B.page.inbox.pop()
    // play olayı dışındaki olayda kart kodu da sızıntıdır
    const ev = Object.assign({}, last, { b: Object.assign({}, last.b, { ev: [{ r: 1, e: 'draw', p: t.P[1].uid, c: other[0] }] }) })
    B.page.inbox.push({ from: t.K.uid, p: t.K.page.G.sealInner(t.K.page.ctx.E2EE.dm, ev, B.pk, t.K.page.sk), at: t.net.clock })
    same(leaks(B.page), ['b.ev.0.c=' + other[0]])
  })

  test('tohumlu rastgele botlarla iki kural setinde üçer el sonuna kadar oynanır, hamleler yarışır, eller sızmaz', () => {
    let games = 0
    const seeds = [3, 4, 5]
    seeds.forEach((seed) => {
      const t = seated({ seed, rules: 'official' })
      const rand = prng(seed * 17 + 3)
      t.all.forEach((who) => {
        who.autoDismiss = true
      })
      start(t)
      playFree(t, rand, 3600000)
      assert.equal(t.K.page.desk.newRound(), true)
      assert.equal(t.K.page.desk.setRules('stack'), true)
      t.P = t.all.slice(1)
      assert.ok(settle(t), 'Yeni El ile herkes lobide')
      start(t)
      assert.equal(t.P[2].page.model().view.rules, 'stack')
      playFree(t, rand, 3600000)
      games += 2
      t.P.forEach((P) => assert.equal(P.page.model().view.result.reason, 'out'))
      noLeaks(t)
      noBadState(t)
      assert.ok(sealedPairs(t, HELP.E2EE.identity.generate()) > 100)
    })
    assert.equal(games, 6)
  })
})

describe('yeniden bağlanma ve yenileme', () => {
  test('aynı peerId ve yeni sid: yolda kalan iletiler atılır, peer-ready sonrası hamle aynı seq ile yeniden gider, oyun sürer', () => {
    const t = seated({ seed: 21 })
    const rand = prng(201)
    const K = t.K
    const B = t.P[0]
    const C = t.P[1]
    start(t)
    playLocked(t, rand, { until: (n) => n >= 4 && K.page.R.turnOf(K.page.game) === B.uid })
    // B hamlesini yapar ve hamle yoldayken K ile B arasındaki bağlantı yeniden kurulur (bu an kayıpsız)
    t.net.o.loss = 0
    let stale = t.net.stats.staleSid
    assert.equal(B.page.desk.act(chooseMove(rand, B.page.model(), { catch: 0, late: 0, drawInstead: 0, announce: 0 })), true)
    t.net.connect(K.page, B.page)
    t.net.run(2000)
    assert.ok(t.net.stats.staleSid > stale, 'eski sid ile gelen hamle atıldı')
    t.net.o.loss = 0.1
    assert.ok(settle(t))
    const acts = envelopes(t.net, B, K, 'act')
    const lastTwo = acts.slice(-2)
    assert.equal(lastTwo[0].x.seq, lastTwo[1].x.seq, 'aynı seq ile yeniden gönderildi')
    assert.notEqual(lastTwo[0].m.sid, lastTwo[1].m.sid)
    // Kurpiyerin hamlesinin durumu C'ye giderken bağlantı yeniden kurulur
    playLocked(t, rand, { until: () => K.page.R.turnOf(K.page.game) === K.uid })
    t.net.o.loss = 0
    stale = t.net.stats.staleSid
    const r = envelopes(t.net, K, C, 'state').pop().x.r
    assert.equal(K.page.desk.act(chooseMove(rand, K.page.model(), { catch: 0, late: 0, drawInstead: 0, announce: 0 })), true)
    t.net.connect(K.page, C.page)
    t.net.run(2000)
    assert.ok(t.net.stats.staleSid > stale, 'eski sid ile gelen durum atıldı')
    t.net.o.loss = 0.1
    assert.ok(settle(t))
    assert.ok(C.page.model().view.step >= 1)
    assert.ok(envelopes(t.net, K, C, 'state').pop().x.r > r)
    playLocked(t, rand)
    assert.equal(K.page.model().stage, 'over')
    noLeaks(t)
    noBadState(t)
  })

  test('oyuncu yenilemesi: yeni sayfa Oyuna Dön ile döner, sayaç ack.seq değerinden sürer, eski durum ni yüzünden reddedilir', () => {
    const t = seated({ seed: 31 })
    const rand = prng(301)
    const K = t.K
    const B = t.P[0]
    start(t)
    playLocked(t, rand, { until: (n) => n >= 8 })
    const old = B.page
    const sentSeq = Math.max.apply(null, envelopes(t.net, B, K).filter((it) => it.x.seq).map((it) => it.x.seq))
    const oldStates = envelopes(t.net, K, B, 'state')
    const latest = oldStates[oldStates.length - 1]
    B.autoJoin = false
    const page = t.net.reload(B)
    assert.ok(t.net.runUntil(() => page.model().stage === 'rejoin', 60000), 'yeni sayfada Oyuna Dön')
    same(page.model().invite.seats, K.page.model().seats.map((s) => s.id))
    // Katılım yanıtı beklenirken (henüz hiçbir durum kabul edilmedi) saldırgan eski sayfaya giden son durumu sokar
    assert.equal(page.desk.join(), true)
    assert.equal(page.model().stage, 'joining')
    t.net.inject(page, K, latest.x && latest.m.p)
    assert.equal(page.model().stage, 'joining', 'eski ni taşıyan durum kabul edilmez')
    B.autoJoin = true
    assert.ok(settle(t), 'yeni sayfa masaya döndü')
    assert.ok(page.model().ack.seq >= sentSeq)
    const view = text(page.model().view)
    t.net.inject(page, K, latest.m.p)
    assert.equal(text(page.model().view), view)
    // Yeni sayfanın sayaçlı ilk iletisi (act ya da sync) eski sayfanın son sayacından sürer
    const counted = () => envelopes(t.net, B, K).filter((it) => it.m.at > page.born && it.x.seq !== undefined)
    playLocked(t, rand, { until: () => counted().length > 0 })
    assert.equal(counted()[0].x.seq, sentSeq + 1)
    playLocked(t, rand)
    assert.equal(page.model().stage, 'over')
    same(leaks(old), [])
    noLeaks(t)
    noBadState(t)
  })

  test('kurpiyer yenilemesi: oyuncular close gone alır ve dealer_left ile biter', () => {
    const t = seated({ seed: 41 })
    const rand = prng(401)
    start(t)
    playLocked(t, rand, { until: (n) => n >= 5 })
    const page = t.net.reload(t.K)
    assert.ok(t.net.runUntil(() => t.P.every((P) => P.page.model().stage === 'ended'), 60000))
    const reasons = t.P.map((P) => {
      // Yeni kurpiyer sayfası yalnızca düz close gone gönderir. Hiçbiri ulaşmadıysa oyuncu 45 sn sonra dealer_lost
      // ile biter (ardışık kayıplar), ulaştıysa dealer_left ile.
      const after = envelopes(t.net, t.K, P).filter((it) => it.m.at >= page.born)
      after.forEach((it) => same([it.x.k, it.x.why], ['close', 'gone']))
      const got = P.page.inbox.some((it) => {
        const x = it.from === t.K.uid ? readAt(P.page, t.K.uid, it.p) : null
        return Boolean(x) && x.k === 'close' && x.why === 'gone'
      })
      same(P.page.model().ended, { reason: got ? 'dealer_left' : 'dealer_lost' })
      assert.equal(P.page.desk.dismiss(), true)
      assert.equal(P.page.model().stage, 'none')
      return P.page.notices.filter((n) => n.kind === 'ended')[0].data.reason
    })
    assert.ok(reasons.indexOf('dealer_left') >= 0)
    assert.equal(page.model().stage, 'none')
  })

  test('hayalet kurpiyer: sayfası kapanır, sunucu iletileri yutar, oyuncular sync gönderir ve 45 sn sonra dealer_lost ile biter', () => {
    const t = seated({ seed: 51 })
    const rand = prng(501)
    start(t)
    playLocked(t, rand, { until: (n) => n >= 5 })
    const at = t.net.clock
    t.net.kill(t.K.page)
    assert.ok(t.net.runUntil(() => t.P.every((P) => P.page.model().stage === 'ended'), 120000))
    t.P.forEach((P) => {
      same(P.page.model().ended, { reason: 'dealer_lost' })
      const end = P.page.notices.filter((n) => n.kind === 'ended')[0].at
      // Oyuncunun kabul ettiği (ya da canlılık saydığı) son durum: sürüm ve sayaç geriye gitmez
      let best = [0, 0]
      let lastGot = 0
      P.page.inbox.filter((it) => it.from === t.K.uid).forEach((it) => {
        const x = readAt(P.page, t.K.uid, it.p)
        if (x.k !== 'state' || x.r < best[0] || (x.r === best[0] && x.b.ack.seq < best[1])) return
        best = [x.r, x.b.ack.seq]
        lastGot = it.at
      })
      assert.ok(end > at)
      assert.ok(end - lastGot > TM.SILENT_END_MS && end - lastGot <= TM.SILENT_END_MS + TICK_MS, 'son durumdan 45 sn sonra')
      assert.ok(envelopes(t.net, P, t.K, 'sync').some((it) => it.m.at > at), 'sessizlikte sync gönderildi')
    })
  })
})

describe('ayrılma ve engelleme', () => {
  test('oyuncu masadan ya da ses odasından ayrılınca kartları desteye döner, oyun kalanlarla sonuna kadar sürer', () => {
    const t = seated({ seed: 61 })
    const rand = prng(601)
    const K = t.K
    const B = t.P[0]
    const C = t.P[1]
    const D = t.P[2]
    start(t)
    playLocked(t, rand, { until: (n) => n >= 6 })
    const handOf = (who) => K.page.game.seats.find((s) => s.id === who.uid).hand.length
    const ids = () => K.page.game.seats.map((s) => s.id)
    const without = (who) => ids().filter((id) => id !== who.uid)
    let deck = K.page.game.deck.length
    let n = handOf(B)
    let rest = without(B)
    assert.equal(B.page.desk.leave(), true)
    assert.equal(B.page.model().stage, 'none')
    t.P = [C, D]
    assert.ok(t.net.runUntil(() => ids().indexOf(B.uid) < 0, 60000), 'kurpiyer ayrılmayı işledi')
    assert.ok(settle(t))
    same(ids(), rest)
    assert.equal(K.page.game.deck.length, deck + n)
    same(K.page.notices.filter((x) => x.kind === 'left').map((x) => x.data), [{ id: '12', why: 'leave' }])
    playLocked(t, rand, { until: (k) => k >= 3 })
    deck = K.page.game.deck.length
    n = handOf(C)
    rest = without(C)
    t.net.leave(C.page)
    assert.equal(C.page.model().stage, 'none')
    t.P = [D]
    assert.ok(t.net.runUntil(() => ids().indexOf(C.uid) < 0, 60000))
    assert.ok(settle(t))
    same(ids(), rest)
    assert.equal(K.page.game.deck.length, deck + n)
    same(K.page.notices.filter((x) => x.kind === 'left').map((x) => x.data), [{ id: '12', why: 'leave' }, { id: '7', why: 'gone' }])
    playLocked(t, rand)
    assert.equal(D.page.model().view.result.reason, 'out')
    noLeaks(t)
    noBadState(t)
  })

  test('kurpiyer ses odasından ayrılınca oyun herkeste dealer_left ile biter', () => {
    const t = seated({ seed: 62 })
    const rand = prng(602)
    start(t)
    playLocked(t, rand, { until: (n) => n >= 4 })
    t.net.leave(t.K.page)
    assert.equal(t.K.page.model().stage, 'none')
    same(t.K.page.notices.filter((x) => x.kind === 'ended').map((x) => x.data), [{ reason: 'reset' }])
    assert.ok(t.net.runUntil(() => t.P.every((P) => P.page.model().stage === 'ended'), 5000))
    t.P.forEach((P) => same(P.page.model().ended, { reason: 'dealer_left' }))
  })

  test('engelleme: kurpiyer engellediği kişiye ileti göndermez ve ondan gelen iç iletiye yanıt vermez, oyuncu engellediği kurpiyerin davetini göstermez', () => {
    const t = seated({
      seed: 71,
      seats: 2,
      before: (net, all) => {
        all[0].blocked['30'] = true
        all[2].blocked['5'] = true
      }
    })
    const rand = prng(701)
    const K = t.K
    const C = t.net.people['7']
    const D = t.net.people['30']
    same(K.page.model().room.map((x) => [x.id, x.status]), [['12', 'joined'], ['7', 'waiting'], ['30', 'blocked']])
    assert.ok(t.net.runUntil(() => C.page.inbox.some((it) => it.from === K.uid), 60000), 'C daveti aldı')
    assert.equal(C.page.model().stage, 'none')
    assert.equal(C.page.model().invite, null)
    same(C.page.notices, [])
    // D (kurpiyerin engellediği kişi) kendi kimliğiyle masaya iç ileti gönderir: yanıt gelmez
    const g = K.page.model().g
    const forge = (k, extra) => D.page.G.sealInner(D.page.ctx.E2EE.dm, Object.assign({ v: 1, ctx: 'game', k, g, ch: CH, from: D.uid, to: K.uid }, extra), K.pk, D.page.sk)
    t.net.inject(K.page, D, forge('join', { app: 'renk', ni: '0123456789abcdef' }))
    t.net.inject(K.page, D, forge('sync', { seq: 1 }))
    t.net.inject(K.page, D, forge('act', { seq: 2, rd: 0, b: { t: 'draw', step: 0 } }))
    start(t)
    playLocked(t, rand)
    assert.equal(K.page.model().view.seats.length, 2)
    assert.equal(t.net.log.filter((m) => m.from === K && m.to === D.peerId).length, 0, 'kurpiyer D kişisine hiçbir şey göndermedi')
    assert.equal(t.net.log.filter((m) => m.from === C && m.to === K.peerId).length, 0, 'C kurpiyere hiçbir şey göndermedi')
    same(D.page.inbox.filter((it) => it.from === K.uid), [])
    same(C.page.notices, [])
    noLeaks(t)
  })
})

describe('sunucuyu işleten saldırgan (S3)', () => {
  test('sahte gönderen: saldırganın mühürlediği iç ileti, yönlendirilen ve yansıtılan zarf, sahte peerId ile düz ileti atılır', () => {
    const t = seated({ seed: 81 })
    const rand = prng(801)
    const K = t.K
    const B = t.P[0]
    const C = t.P[1]
    start(t)
    playLocked(t, rand, { until: (n) => n >= 5 && envelopes(t.net, B, K, 'act').length > 0 })
    const snap = () => text([K.page.game, t.P.map((P) => {
      const m = P.page.model()
      return [m.stage, m.view, m.mine, m.seats, m.ended, m.ack]
    })])
    const before = snap()
    const sent = t.net.stats.sent
    const attacker = HELP.E2EE.identity.generate()
    const g = K.page.model().g
    const toB = envelopes(t.net, K, B, 'state').pop()
    const fromB = envelopes(t.net, B, K, 'act').pop()
    // 1. Kurpiyer adına durum, saldırganın kendi kimlik anahtarıyla mühürlü
    const fake = Object.assign({}, toB.x, { r: toB.x.r + 50 })
    t.net.inject(B.page, K, HELP.TelsizGame.sealInner(HELP.E2EE.dm, fake, B.pk, attacker.secretKey))
    // 2. B adına hamle
    const act = { v: 1, ctx: 'game', k: 'act', g, ch: CH, from: B.uid, to: K.uid, seq: fromB.x.seq + 1, rd: 1, b: { t: 'draw', step: K.page.game.step } }
    t.net.inject(K.page, B, HELP.TelsizGame.sealInner(HELP.E2EE.dm, act, K.pk, attacker.secretKey))
    // 3. Kurpiyerin B'ye zarfı C'ye, 4. B'nin kurpiyere zarfı C'ye yönlendirilir: C açamaz
    t.net.inject(C.page, K, toB.m.p)
    t.net.inject(C.page, B, fromB.m.p)
    assert.equal(readAt(C.page, K.uid, toB.m.p), null)
    // 5. Yansıtma: kurpiyerin B'ye zarfı kurpiyere B'den geliyormuş gibi döner (açılır ama from bağı tutmaz)
    assert.ok(readAt(K.page, B.uid, toB.m.p))
    t.net.inject(K.page, B, toB.m.p)
    // 6. Kurpiyerin kimliğiyle ama başka bir peerId'den düz close ve davet
    const plain = (obj) => JSON.stringify(Object.assign({ v: 1, ctx: 'game', g, ch: CH }, obj))
    B.page.desk.onVoiceEvent({ type: 'message', peerId: 'peer-666', userId: K.uid, p: plain({ k: 'close', why: 'dealer' }) })
    // 7. Gönderenden farklı kurpiyer taşıyan davet
    const inv = { k: 'invite', app: 'renk', dealer: K.uid, ph: 'lobby', rules: 'official', seats: [K.uid], max: 8, ni: '0123456789abcdef', key: null }
    C.page.desk.onVoiceEvent({ type: 'message', peerId: B.peerId, userId: B.uid, p: plain(inv) })
    assert.equal(snap(), before, 'durum ve görünümler değişmedi')
    assert.equal(t.net.stats.sent, sent, 'hiçbir yanıt gitmedi')
    playLocked(t, rand)
    assert.equal(K.page.model().stage, 'over')
  })

  test('yeniden oynatma: eski act, leave ve join zarfları ve önceki elin iletileri yeni n ile gelir, durum değişmez, kimse atılmaz', () => {
    const t = seated({ seed: 91 })
    const rand = prng(901)
    const K = t.K
    const B = t.P[0]
    const C = t.P[1]
    const D = t.P[2]
    start(t)
    playLocked(t, rand, { until: (n) => n >= 10 })
    // C masadan ayrılır, el kalanlarla biter, Yeni El ile C yeniden davet edilir ve katılır
    assert.equal(C.page.desk.leave(), true)
    t.P = [B, D]
    assert.ok(t.net.runUntil(() => K.page.model().seats.length === 3, 60000), 'kurpiyer ayrılmayı işledi')
    assert.ok(settle(t))
    playLocked(t, rand)
    assert.equal(K.page.desk.newRound(), true)
    t.P = [B, C, D]
    assert.ok(settle(t), 'C yeniden oturdu')
    start(t)
    playLocked(t, rand, { until: (n) => n >= 8 })
    const before = text([K.page.game, K.page.model().seats, t.P.map((P) => [P.page.model().view, P.page.model().mine])])
    const left = K.page.notices.filter((x) => x.kind === 'left').length
    const roundOne = (it) => it.x.k === 'join' || (it.x.rd !== undefined && it.x.rd === 1) || it.x.k === 'leave'
    const replays = []
    t.P.forEach((P) => {
      envelopes(t.net, P, K).filter(roundOne).forEach((it) => replays.push([K.page, P, it.m.p]))
      envelopes(t.net, K, P, 'state').filter((it) => it.x.b.rd === 1).forEach((it) => replays.push([P.page, K, it.m.p]))
    })
    const kinds = replays.map((x) => readAt(x[0], x[1].uid, x[2]).k)
    assert.ok(kinds.indexOf('join') >= 0 && kinds.indexOf('leave') >= 0 && kinds.indexOf('act') >= 0 && kinds.indexOf('state') >= 0)
    replays.forEach((x) => t.net.inject(x[0], x[1], x[2]))
    t.net.run(3000)
    assert.equal(text([K.page.game, K.page.model().seats, t.P.map((P) => [P.page.model().view, P.page.model().mine])]), before)
    assert.equal(K.page.notices.filter((x) => x.kind === 'left').length, left, 'kimse masadan atılmadı')
    t.P.forEach((P) => assert.equal(P.page.model().stage, 'play'))
    playLocked(t, rand)
    assert.equal(K.page.model().view.seats.length, 4)
    noLeaks(t)
    noBadState(t)
  })
})
