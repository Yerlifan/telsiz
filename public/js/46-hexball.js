'use strict'

// Hexball arayüzü: yayın sahnesinin game kipinde 36-oyun.js'in açtığı .game-app kutusunun içi. Takımlar ve sonuç
// ekranı, maç ekranı (skor tablosu, saha tuvali, dokunmatik çubuk ve Vur düğmesi), klavye, oyun kolu ve oyun veri
// kanalındaki oturumlar. Yüklenirken gameUiRegister('hexball', ...) ile kaydolur. Kural motoru (43-hexball-kural.js,
// window.TelsizHexball), fizik (44-hexball-fizik.js) ve ağ (45-hexball-ag.js) çalışma anında okunur.
//
// Kurallar:
// - Takım seçimi, takım atama, maçı başlatma, gol, süre bitti ve durdurma gameCall('act', hamle) ile masa yöneticisine
//   gider. Seçenekler yalnızca modelin legal alanından (motorun legalMoves sonucu) okunur, bu dosya kural yazmaz.
// - Gerçek zamanlı veri masa yöneticisinden geçmez. Masa oyun aşamasındayken (stage play) ev sahibinde
//   TelsizHexballNet.createHost, oyuncuda createPlayer oturumu vardır. Oturumlar sahne küçültülünce de sürer, model
//   250 ms'de bir okunur (hexballTick). Ev sahibi koltuklara oyun bağı açar (voice.js openGameLink), maç başlayınca
//   fiziği yürütür ve fizik olaylarından gol ve süre bittiyi kural motoruna hamle olarak gönderir.
// - 'Bağlantı Yok': ev sahibi oyun bağı kurulamayan ya da el sıkışmayı yanıtlamayan kişiyi (eski istemci, engellenmiş
//   bağ) böyle görür. Maçı Başlat takımdaki herkesin bağı hazır olana kadar pasiftir, ev sahibi kişiyi izleyicilere
//   alabilir ya da koltuktan çıkarabilir. Oyuncu ev sahibinden 15 sn içinde el sıkışma alamazsa, bağ kurulamazsa ya da
//   ses motoru oyun bağını bilmiyorsa aynı durumu görür.
// - Fiziği ev sahibi hesapladığı için ev sahibi hile yapabilir: bu not güven notunun sonuna eklenir (trustNote), Masa
//   Kur, lobi ve davet ekranında katılmadan önce okunur.
// - Tuşlar (oklar veya WASD ile hareket, X veya Boşluk ile vuruş) yalnızca maçta yuvası olan kişide, sahne oyun
//   kipinde görünürken, odak yazı alanında değilken ve tam ekran dışında açık katman yokken dinlenir. Ses
//   atamalarının tuşları (bas konuş, varsayılan V) kullanılmaz ve engellenmez. Oyun kolunda sol çubuk veya yön tuşları
//   hareket, alt yüz düğmesi (Çarpı veya A) vuruştur. Ses atamalarının kol düğmeleri de oyunda kullanılmaz: alt yüz
//   düğmesi atanmışsa vuruş sol (Kare veya X), o da atanmışsa üst yüz düğmesidir (Üçgen veya Y), hepsi atanmışsa
//   kolda vuruş yoktur. Maç sürerken L1 ve R1 frekans değiştirmez (ownsPad, 21-band.js padPoll).
// - Dokunmatikte solda Pointer Events ve işaretçi yakalamayla sanal çubuk, sağda Vur düğmesi bulunur (kaba işaretçili
//   cihazda ya da sahaya ilk dokunuşta görünür). Basılan işaretçinin hareketi ve bırakılması pencere düzeyinde izlenir.
//   Tuvalde, çubukta ve Vur düğmesinde touch-action: none.
// - Tuval: renkler tokens.css belirteçlerinden (--hex-*) okunur, devicePixelRatio en çok 2. Saha, çizgiler ve fileler
//   ayrı bir tuvalde bir kez çizilir. Diskte takım harfi ve numara (ör. K1, M2) bulunur, takımlar yalnızca renkle
//   ayrılmaz. Kendi diskinizde halka, vuruş tutulurken dış halka vardır. Sarsıntı efekti yoktur.
// - Maç ekranının skor tablosu, tuvali ve dokunmatik denetimleri maç boyunca aynı öğelerdir (hexballKit): gol ya da
//   bağ değişince yeniden çizilen ekran onları yeniden yerleştirir, tuval boşalmaz, basılı çubuk bırakılmaz.
// - Erişilebilirlik: goller, skor ve sonuç canlı bölgeden duyurulur (eventText). Gerçek zamanlı maç ekran
//   okuyucuyla oynanamaz, bu not Ayrıntı bölümündedir.

const HEXBALL_ID = 'hexball'
const HEXBALL_SIDES = ['red', 'blue', 'spec']
const HEXBALL_TEAMS = ['red', 'blue']
const HEXBALL_SYNC_MS = 250
const HEXBALL_UPLINK_MS = 5000
// Alıcı başına gereken gönderim hızı tahmini (kbps): 30 Hz x (en çok 102 bayt + yaklaşık 60 bayt ek yük) x 8 bit
const HEXBALL_KBPS_PER_PEER = 40
// Oyuncuda en yeni anlık görüntü bu kadar eskiyse "Bağlantı Yavaş"
const HEXBALL_LAG_MS = 400
// Oyuncu ev sahibinden bu süre içinde el sıkışma almazsa "Bağlantı Yok" (45-hexball-ag.js OPEN_TIMEOUT_MS)
const HEXBALL_WAIT_FAIL_MS = 15000
const HEXBALL_DEADZONE = 0.2
// Standart oyun kolu düzeni: 0 alt, 2 sol, 3 üst yüz düğmesi, 12-15 yön tuşları. Vuruş sıradaki ilk boş yüz
// düğmesidir (1, sağ yüz düğmesi, üstteki katmanı kapatır, 21-band.js padPoll)
const HEXBALL_PAD_KICKS = [0, 2, 3]
const HEXBALL_PAD_UP = 12
const HEXBALL_PAD_DOWN = 13
const HEXBALL_PAD_LEFT = 14
const HEXBALL_PAD_RIGHT = 15
const HEXBALL_PAD_CHECK_FRAMES = 60
const HEXBALL_MAX_DPR = 2
const HEXBALL_SIZE_FRAMES = 30
// Tuvalde sahanın çevresinde gösterilen pay (birim): oyuncuların çıkabildiği dış kutuyla aynı (fizikte MARGIN)
const HEXBALL_PAD = 50
// Saha desenindeki altıgenin yarıçapı (birim)
const HEXBALL_HEX_R = 36
const HEXBALL_KICK_PULSE_MS = 120
// Fiziksel tuş konumları (KeyboardEvent.code), code vermeyen eski tarayıcıda key değerleri
const HEXBALL_KEY_CODES = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  KeyX: 'kick',
  Space: 'kick'
}
const HEXBALL_KEY_NAMES = {
  ArrowUp: 'up',
  Up: 'up',
  w: 'up',
  W: 'up',
  ArrowDown: 'down',
  Down: 'down',
  s: 'down',
  S: 'down',
  ArrowLeft: 'left',
  Left: 'left',
  a: 'left',
  A: 'left',
  ArrowRight: 'right',
  Right: 'right',
  d: 'right',
  D: 'right',
  x: 'kick',
  X: 'kick',
  ' ': 'kick',
  Spacebar: 'kick'
}
// Panelde kısa metinle gösterilen hata kodları, diğerleri sessizdir (gelen yeni durum arayüzü düzeltir)
const HEXBALL_SHOWN_ERRORS = ['team_full', 'teams_empty', 'not_host', 'bad_random', 'no_random']
// Tuval renkleri: özellik adı -> tokens.css belirteci
const HEXBALL_COLOR_TOKENS = {
  field: '--hex-field',
  pattern: '--hex-pattern',
  out: '--hex-out',
  line: '--hex-line',
  net: '--hex-net',
  post: '--hex-post',
  red: '--hex-red',
  blue: '--hex-blue',
  ink: '--hex-ink',
  edge: '--hex-disc-edge',
  ball: '--hex-ball',
  ballEdge: '--hex-ball-edge',
  me: '--hex-me',
  kick: '--hex-kick'
}

const hexballState = {
  host: null,
  hostKey: '',
  epoch: null,
  // Ev sahibinde maçtaki kişiler (yuvası olanlar): görünümden çıkan kişinin yuvası maçtan kalkar (dropPlayer)
  matchIds: [],
  // Ev sahibinde oturumda eşi olmayan oturan kişiler: kimlik -> ilk görüldüğü an
  peerless: {},
  links: '',
  player: null,
  playerKey: '',
  playerPeer: null,
  playerEpoch: null,
  playerLink: 'waiting',
  playerSince: 0,
  playerShown: '',
  timer: 0,
  uplinkAt: 0,
  uplinkBusy: false,
  lowUplink: false,
  refresh: 0,
  kit: null,
  raf: false,
  listening: false,
  keys: {},
  touch: { x: 0, y: 0, kick: false, pointer: null, kickPointer: null },
  pad: { x: 0, y: 0, kick: false },
  // Ses atamalarındaki kol düğmeleri (oyunda kullanılmaz) ve vuruş düğmesi (hepsi atanmışsa null)
  padUsed: [],
  padKick: HEXBALL_PAD_KICKS[0],
  padCheck: 0,
  sent: null,
  touchSeen: false,
  colors: null,
  colorsKey: '',
  confirmStop: false,
  paused: false
}

// ----- Küçük yardımcılar -----

function hexballHas (obj, key) {
  return Boolean(obj) && Object.prototype.hasOwnProperty.call(obj, key)
}

function hexballNow () {
  const p = window.performance
  return p && typeof p.now === 'function' ? p.now() : Date.now()
}

function hexballClamp (n) {
  return n < -1 ? -1 : n > 1 ? 1 : n
}

function hexballTeamName (side) {
  return HEXBALL_SIDES.indexOf(side) >= 0 ? t('game.hexball.team.' + side) : ''
}

function hexballLetter (side) {
  return HEXBALL_TEAMS.indexOf(side) >= 0 ? t('game.hexball.letter.' + side) : ''
}

// Saniye -> dd:ss
function hexballClock (secs) {
  const n = Math.max(0, Math.floor(Number(secs) || 0))
  const m = Math.floor(n / 60)
  const s = n % 60
  return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s
}

function hexballSetText (node, text) {
  if (node && node.textContent !== text) node.textContent = text
}

function hexballByKey (root, key) {
  if (!root || !key) return null
  return Array.from(root.querySelectorAll('[data-focus-key]')).filter((node) => node.getAttribute('data-focus-key') === key)[0] || null
}

function hexballEnabled (node) {
  return Boolean(node) && node.getAttribute('aria-disabled') !== 'true'
}

// Takımdaki kişilerin numaraları: koltuk sırasıyla takım içinde 1'den başlar (maçtaki yuva sırasıyla aynıdır)
function hexballNumbers (v) {
  const out = {}
  const n = { red: 0, blue: 0 }
  v.seats.forEach((id) => {
    const side = v.teams[id]
    if (side !== 'red' && side !== 'blue') return
    n[side]++
    out[id] = n[side]
  })
  return out
}

function hexballTag (v, numbers, id) {
  const side = v.teams[id]
  return HEXBALL_TEAMS.indexOf(side) >= 0 && numbers[id] ? hexballLetter(side) + numbers[id] : ''
}

// Yuva -> kişi kimliği
function hexballSlotIds (v) {
  const out = {}
  Object.keys(v.slots || {}).forEach((id) => {
    out[v.slots[id]] = id
  })
  return out
}

function hexballHasSlot (m) {
  return Boolean(m && m.view && m.me !== null && hexballHas(m.view.slots, m.me))
}

function hexballInMatch (m) {
  return Boolean(m && m.app === HEXBALL_ID && m.stage === 'play' && m.view && m.view.ph === 'match')
}

// ----- Oyun veri kanalı oturumları -----

function hexballLive (m) {
  if (!m || m.app !== HEXBALL_ID || m.stage !== 'play' || !m.view || m.me === null) return false
  if (m.role !== 'dealer' && m.role !== 'player') return false
  const s = snap()
  if (!s || s.private || s.channelId === null || s.channelId === undefined) return false
  return Boolean(voice && typeof voice.sendGameData === 'function' && window.TelsizHexballNet && window.TelsizHexballPhysics)
}

function hexballPeerOf (s, id) {
  const p = s && s.peers && hexballHas(s.peers, id) ? s.peers[id] : null
  return p && typeof p.peerId === 'string' && p.peerId !== '' ? p.peerId : null
}

function hexballSend (peerId, buf) {
  if (!voice || typeof voice.sendGameData !== 'function') return false
  return voice.sendGameData(peerId, buf) === true
}

function hexballEnv (onEvent) {
  return {
    now: hexballNow,
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    send: hexballSend,
    onEvent: onEvent,
    onError: (err) => window.console.error(err)
  }
}

// Modelin istediği oturumlar: ev sahibinde host, oyuncuda player, masa oyun aşamasında değilse hiçbiri
function hexballSync (m) {
  if (!hexballLive(m)) {
    hexballDrop()
    return
  }
  if (m.role === 'dealer') {
    hexballDropPlayer()
    hexballSyncHost(m)
  } else {
    hexballDropHost()
    hexballSyncPlayer(m)
  }
  if (!hexballState.timer) hexballState.timer = setInterval(hexballTick, HEXBALL_SYNC_MS)
}

function hexballSyncHost (m) {
  const s = snap()
  const v = m.view
  const key = m.g + ':' + m.me
  if (hexballState.host && hexballState.hostKey !== key) hexballDropHost()
  if (!hexballState.host) {
    const env = hexballEnv(hexballOnHostEvent)
    env.openLink = (peerId) => (typeof voice.openGameLink === 'function' ? voice.openGameLink(peerId) : 'unsupported')
    env.closeLink = (peerId) => {
      if (typeof voice.closeGameLink === 'function') voice.closeGameLink(peerId)
    }
    env.lowUplink = () => hexballState.lowUplink
    try {
      hexballState.host = window.TelsizHexballNet.createHost(env, { me: String(m.me) })
    } catch (err) {
      window.console.error(err)
      return
    }
    hexballState.hostKey = key
    hexballState.epoch = null
    hexballState.matchIds = []
    hexballState.links = ''
  }
  const host = hexballState.host
  const list = []
  const peerless = {}
  const now = hexballNow()
  m.seats.forEach((seat) => {
    if (seat.id === m.me) return
    const peerId = hexballPeerOf(s, seat.id)
    if (peerId) list.push({ id: seat.id, peerId: peerId })
    else peerless[seat.id] = hexballHas(hexballState.peerless, seat.id) ? hexballState.peerless[seat.id] : now
  })
  // Ses bağlantısı olmayan oturan kişi (oturumda eşi yok): bağ açılamaz, HEXBALL_WAIT_FAIL_MS sonra "Bağlantı Yok"
  hexballState.peerless = peerless
  host.setPeers(list)
  if (v.ph === 'match' && v.epoch) {
    if (hexballState.epoch !== v.epoch) {
      const players = Object.keys(v.slots).map((id) => ({ id: id, slot: v.slots[id], side: v.teams[id] }))
      if (host.startMatch({ epoch: v.epoch, rules: v.rules, kick: v.kick, players: players })) {
        hexballState.epoch = v.epoch
        hexballState.matchIds = Object.keys(v.slots)
        // Yeni maçta ev sahibinin bekletilen girdisi sıfırlandı, basılı tuşlar yeniden bildirilir
        hexballState.sent = null
        hexballPushInput()
      }
    } else {
      // Maç sürerken ayrılan ya da koltuktan çıkarılan kişinin yuvası maçtan, diski sahadan kalkar
      const gone = hexballState.matchIds.filter((id) => !hexballHas(v.slots, id))
      if (gone.length) {
        gone.forEach((id) => host.dropPlayer(id))
        hexballState.matchIds = Object.keys(v.slots)
      }
    }
  } else if (hexballState.epoch !== null) {
    hexballState.epoch = null
    hexballState.matchIds = []
    host.endMatch()
  }
}

function hexballSyncPlayer (m) {
  const v = m.view
  const dealer = String(m.dealer)
  const peer = hexballPeerOf(snap(), dealer)
  if (!peer) {
    // Ev sahibiyle ses bağlantısı yok: oturum kurulmaz, bekleme süresi dolunca "Bağlantı Yok"
    hexballDropPlayer()
    if (!hexballState.playerSince) hexballState.playerSince = hexballNow()
    return
  }
  const key = m.g + ':' + m.me
  if (hexballState.player && hexballState.playerKey !== key) hexballDropPlayer()
  if (!hexballState.player) {
    try {
      hexballState.player = window.TelsizHexballNet.createPlayer(hexballEnv(hexballOnPlayerEvent), { hostId: dealer, hostPeer: peer })
    } catch (err) {
      window.console.error(err)
      return
    }
    hexballState.playerKey = key
    hexballState.playerPeer = peer
    hexballState.playerEpoch = v.epoch
    hexballState.playerLink = 'waiting'
    hexballState.playerSince = hexballNow()
    return
  }
  if (hexballState.playerPeer !== peer) {
    // Ev sahibinin bağlantısı yeniden kuruldu: yeni eşle el yeniden sıkışılır
    hexballState.playerPeer = peer
    hexballState.playerLink = 'waiting'
    hexballState.playerSince = hexballNow()
    hexballState.player.setHost(dealer, peer)
  }
  if (hexballState.playerEpoch !== v.epoch) {
    hexballState.playerEpoch = v.epoch
    if (hexballState.playerLink !== 'failed') hexballState.playerSince = hexballNow()
  }
}

function hexballDropHost () {
  const host = hexballState.host
  if (!host) return
  hexballState.host = null
  hexballState.hostKey = ''
  hexballState.epoch = null
  hexballState.matchIds = []
  hexballState.peerless = {}
  hexballState.links = ''
  hexballState.lowUplink = false
  host.destroy()
}

function hexballDropPlayer () {
  const player = hexballState.player
  if (!player) return
  hexballState.player = null
  hexballState.playerKey = ''
  hexballState.playerPeer = null
  hexballState.playerEpoch = null
  hexballState.playerLink = 'waiting'
  hexballState.playerSince = 0
  hexballState.playerShown = ''
  player.destroy()
}

function hexballDrop () {
  hexballDropHost()
  hexballDropPlayer()
  hexballState.playerSince = 0
  if (hexballState.timer) {
    clearInterval(hexballState.timer)
    hexballState.timer = 0
  }
  hexballSyncListen(false)
  hexballState.kit = null
  hexballState.confirmStop = false
  hexballState.paused = false
}

// Model 250 ms'de bir okunur: sahne küçültülmüşken de maç başlar ve biter, oyuncunun bağ durumu güncellenir
function hexballTick () {
  const m = gameModel()
  hexballSync(m)
  if (m.role === 'player' && hexballLive(m)) {
    const shown = hexballPlayerLink(m)
    if (shown !== hexballState.playerShown) {
      hexballState.playerShown = shown
      hexballSoon()
    }
  }
  if (hexballState.host) {
    // Bekleme süresi dolan bağlar (olay üretmeyenler dahil) ekrana yansır
    const links = JSON.stringify(hexballLinks())
    if (links !== hexballState.links) {
      hexballState.links = links
      hexballSoon()
    }
    if (hexballState.epoch) hexballWatchUplink()
  }
}

// Ev sahibinin gönderim hızı tahmini (voice.js uplinkEstimate) düşükse anlık görüntüler 20 Hz'e iner
function hexballWatchUplink () {
  const now = hexballNow()
  if (hexballState.uplinkBusy || now - hexballState.uplinkAt < HEXBALL_UPLINK_MS) return
  if (!voice || typeof voice.uplinkEstimate !== 'function') return
  hexballState.uplinkAt = now
  hexballState.uplinkBusy = true
  let job = null
  try {
    job = Promise.resolve(voice.uplinkEstimate())
  } catch (err) {
    job = Promise.resolve(null)
  }
  job.then((kbps) => {
    hexballState.uplinkBusy = false
    const links = hexballLinks()
    const ready = Object.keys(links).filter((id) => links[id] === 'ready').length
    hexballState.lowUplink = typeof kbps === 'number' && kbps < HEXBALL_KBPS_PER_PEER * Math.max(1, ready)
  }, () => {
    hexballState.uplinkBusy = false
  })
}

// Ev sahibinin oturum olayları: bağ durumu değişince ekran yenilenir, gol ve süre bitti kural motoruna gider
function hexballOnHostEvent (evt) {
  if (!evt || typeof evt.e !== 'string') return
  if (evt.e === 'link') {
    const now = JSON.stringify(hexballLinks())
    if (now !== hexballState.links) {
      hexballState.links = now
      hexballSoon()
    }
    return
  }
  if (evt.e === 'paused' || evt.e === 'resumed') return
  const m = gameModel()
  const v = m.view
  if (m.role !== 'dealer' || !hexballInMatch(m) || evt.epoch !== v.epoch) return
  if (evt.e === 'goal') {
    // Topa son dokunan maçtan ayrıldıysa gol takıma yazılır
    const by = evt.by !== null && hexballHas(v.teams, evt.by) && v.teams[evt.by] !== 'spec' ? evt.by : null
    gameCall('act', { t: 'goal', mt: v.mt, side: evt.side, by: by, at: evt.at })
  } else if (evt.e === 'time') {
    gameCall('act', { t: 'time', mt: v.mt })
  }
}

// El sıkışma geldi ya da bağ koptu: bekleme süresi (HEXBALL_WAIT_FAIL_MS) yeniden sayılır
function hexballOnPlayerEvent (evt) {
  if (!evt) return
  if (evt.e === 'hello' || evt.e === 'lost') {
    hexballState.playerSince = hexballNow()
    hexballSoon()
  }
}

// Ev sahibinde kişi kimliği -> none | waiting | ready | failed. Oturumda eşi olmayan oturan kişi none, bekleme süresi
// dolunca failed.
function hexballLinks () {
  if (!hexballState.host) return {}
  const out = hexballState.host.links()
  const now = hexballNow()
  Object.keys(hexballState.peerless).forEach((id) => {
    if (!hexballHas(out, id)) out[id] = now - hexballState.peerless[id] > HEXBALL_WAIT_FAIL_MS ? 'failed' : 'none'
  })
  return out
}

// Oyuncunun ev sahibiyle bağı: ready, waiting ya da failed. Ses motoru oyun bağını bilmiyorsa ya da bağ kurulamadıysa
// (link-failed) hemen, el sıkışma ya da ses bağlantısı HEXBALL_WAIT_FAIL_MS içinde gelmezse "Bağlantı Yok" olur.
// Maç ev sahibinde bitti ve el lobi kimliğiyle sıkışıldıysa (ended) bağ hazırdır: masanın sonuç durumu sinyal
// yolundan veri kanalından daha geç gelir, o arada son anlık görüntü çizilir.
function hexballPlayerLink (m) {
  const p = hexballState.player
  if (!voice || typeof voice.sendGameData !== 'function') return 'failed'
  if (p) {
    const s = p.state()
    const v = m.view
    if (s.ready && (!v || v.ph !== 'match' || s.epoch === v.epoch || s.ended)) return 'ready'
    if (hexballState.playerLink === 'failed') return 'failed'
  }
  const since = hexballState.playerSince
  return since && hexballNow() - since > HEXBALL_WAIT_FAIL_MS ? 'failed' : 'waiting'
}

// Takımdaki (izleyici olmayan) diğer kişilerden bağı hazır olmayanlar (ev sahibinde)
function hexballNotReady (m, v) {
  const links = hexballLinks()
  return v.seats.filter((id) => id !== m.me && v.teams[id] !== 'spec' && links[id] !== 'ready')
}

// Ekran bir sonraki adımda bir kez yenilenir (oturum olayları çizimin içinden de gelebilir)
function hexballSoon () {
  if (hexballState.refresh) return
  hexballState.refresh = setTimeout(() => {
    hexballState.refresh = 0
    if (gameModel().app === HEXBALL_ID && gameStageVisible()) gameRefreshStage()
  }, 0)
}

// ----- Girdi -----

function hexballInput () {
  const st = hexballState
  let x = st.touch.x + st.pad.x
  let y = st.touch.y + st.pad.y
  let kick = st.touch.kick || st.pad.kick
  Object.keys(st.keys).forEach((code) => {
    const a = st.keys[code]
    if (a === 'up') y -= 1
    else if (a === 'down') y += 1
    else if (a === 'left') x -= 1
    else if (a === 'right') x += 1
    else if (a === 'kick') kick = true
  })
  return { x: hexballClamp(x), y: hexballClamp(y), kick: kick }
}

// Girdi değişince oturuma bildirilir (ev sahibinde bekletilmek üzere sıraya, oyuncuda ağa)
function hexballPushInput () {
  const inp = hexballInput()
  const last = hexballState.sent
  if (last && last.x === inp.x && last.y === inp.y && last.kick === inp.kick) return
  hexballState.sent = inp
  if (hexballState.host) hexballState.host.setInput(inp)
  else if (hexballState.player) hexballState.player.setInput(inp)
}

function hexballKeyAction (e) {
  if (e.code && hexballHas(HEXBALL_KEY_CODES, e.code)) return HEXBALL_KEY_CODES[e.code]
  if (!e.code && typeof e.key === 'string' && hexballHas(HEXBALL_KEY_NAMES, e.key)) return HEXBALL_KEY_NAMES[e.key]
  return null
}

// Ses atamasının tuşu (bas konuş, sustur, sağırlaştır): oyunda kullanılmaz, olayı ses motoru alır
function hexballVoiceKey (e) {
  if (!voice || typeof voice.settings !== 'function' || !e.code) return false
  try {
    const b = voice.settings().bindings || {}
    return Object.keys(b).some((name) => Boolean(b[name]) && b[name].type === 'key' && b[name].code === e.code)
  } catch (err) {
    return false
  }
}

// Tam ekran dışında açık bir katman (pencere, seçici) varken tuşlar ona bırakılır
function hexballLayerOpen () {
  const top = typeof topLayer === 'function' ? topLayer() : null
  return Boolean(top && top.name !== 'cast-full')
}

function hexballOnKey (e) {
  const action = hexballKeyAction(e)
  if (!action) return
  const keys = hexballState.keys
  const code = e.code || e.key
  if (e.type === 'keyup') {
    if (!hexballHas(keys, code)) return
    delete keys[code]
    e.preventDefault()
    hexballPushInput()
    return
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (typeof isTypingTarget === 'function' && isTypingTarget(e.target)) return
  if (hexballLayerOpen() || hexballVoiceKey(e)) return
  // Oklar ve Boşluk sayfayı kaydırmaz, odaktaki düğmeyi çalıştırmaz
  e.preventDefault()
  if (typeof e.stopPropagation === 'function') e.stopPropagation()
  if (keys[code] === action) return
  keys[code] = action
  hexballPushInput()
}

// Bütün denetimler bırakılır (pencere odağı gitti, sekme gizlendi, maç ekranı kapandı)
function hexballRelease () {
  const tc = hexballState.touch
  hexballState.keys = {}
  hexballState.touch = { x: 0, y: 0, kick: false, pointer: null, kickPointer: null }
  hexballState.pad = { x: 0, y: 0, kick: false }
  const kit = hexballState.kit
  if (kit && tc.pointer !== null) kit.knob.style.transform = ''
  hexballPushInput()
}

function hexballSyncListen (on) {
  const want = Boolean(on)
  if (want === hexballState.listening) return
  hexballState.listening = want
  const fn = want ? 'addEventListener' : 'removeEventListener'
  window[fn]('keydown', hexballOnKey, true)
  window[fn]('keyup', hexballOnKey, true)
  window[fn]('pointermove', hexballOnPointerMove)
  window[fn]('pointerup', hexballOnPointerEnd)
  window[fn]('pointercancel', hexballOnPointerEnd)
  window[fn]('blur', hexballRelease)
  document[fn]('visibilitychange', hexballRelease)
  if (!want) hexballRelease()
}

function hexballPadOn (gp, index) {
  const b = gp.buttons[index]
  return Boolean(b && (b.pressed || b.value > 0.5))
}

// Ses atamalarının kol düğmeleri (bas konuş, sustur, sağırlaştır) oyunda kullanılmaz, basışı ses motoru alır
// (klavyedeki hexballVoiceKey ile aynı kural). Vuruş HEXBALL_PAD_KICKS içinden atanmamış ilk düğmedir, hepsi
// atanmışsa kolda vuruş yoktur. Atamalar HEXBALL_PAD_CHECK_FRAMES karede bir okunur.
function hexballPadButtons () {
  hexballState.padCheck--
  if (hexballState.padCheck > 0) return
  hexballState.padCheck = HEXBALL_PAD_CHECK_FRAMES
  const used = []
  if (voice && typeof voice.settings === 'function') {
    try {
      const b = voice.settings().bindings || {}
      Object.keys(b).forEach((name) => {
        const x = b[name]
        if (x && x.type === 'gamepad' && typeof x.button === 'number') used.push(x.button)
      })
    } catch (err) {
      // Ses ayarları okunamadı, atama yok sayılır
    }
  }
  hexballState.padUsed = used
  hexballState.padKick = HEXBALL_PAD_KICKS.filter((n) => used.indexOf(n) === -1)[0]
  if (hexballState.padKick === undefined) hexballState.padKick = null
}

function hexballPollPad () {
  let pads = []
  try {
    pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((gp) => gp && gp.connected !== false && gp.buttons) : []
  } catch (err) {
    pads = []
  }
  if (pads.length) hexballPadButtons()
  const used = hexballState.padUsed
  const kickButton = hexballState.padKick
  const on = (gp, n) => used.indexOf(n) === -1 && hexballPadOn(gp, n)
  let x = 0
  let y = 0
  let kick = false
  pads.forEach((gp) => {
    const axes = gp.axes && gp.axes.length > 1 ? gp.axes : [0, 0]
    const ax = Number(axes[0]) || 0
    const ay = Number(axes[1]) || 0
    if (Math.sqrt(ax * ax + ay * ay) >= HEXBALL_DEADZONE) {
      x += ax
      y += ay
    }
    if (on(gp, HEXBALL_PAD_UP)) y -= 1
    if (on(gp, HEXBALL_PAD_DOWN)) y += 1
    if (on(gp, HEXBALL_PAD_LEFT)) x -= 1
    if (on(gp, HEXBALL_PAD_RIGHT)) x += 1
    if (kickButton !== null && on(gp, kickButton)) kick = true
  })
  x = hexballClamp(x)
  y = hexballClamp(y)
  const p = hexballState.pad
  if (p.x === x && p.y === y && p.kick === kick) return
  hexballState.pad = { x: x, y: y, kick: kick }
  hexballPushInput()
}

function hexballCoarse () {
  try {
    return Boolean(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
  } catch (err) {
    return false
  }
}

function hexballTouchMode () {
  return hexballState.touchSeen || hexballCoarse()
}

// Sanal çubuk: işaretçi çubuğun merkezine göre birim çembere çekilir, ölü bölgede hareket yok
function hexballStickMove (e) {
  const kit = hexballState.kit
  if (!kit) return
  const r = kit.stick.getBoundingClientRect()
  const radius = r.width / 2
  if (!(radius > 0)) return
  let x = (e.clientX - (r.left + radius)) / radius
  let y = (e.clientY - (r.top + r.height / 2)) / radius
  const len = Math.sqrt(x * x + y * y)
  if (len > 1) {
    x /= len
    y /= len
  }
  const dead = len < HEXBALL_DEADZONE
  hexballState.touch.x = dead ? 0 : x
  hexballState.touch.y = dead ? 0 : y
  kit.knob.style.transform = 'translate(' + Math.round(x * 64) + '%, ' + Math.round(y * 64) + '%)'
  hexballPushInput()
}

// Çubuk ve Vur düğmesi işaretçiyi basınca alır. Hareket ve bırakma pencere düzeyinde izlenir (hexballSyncListen):
// gol ya da bağ değişince yeniden çizilen ekran öğeleri yeniden yerleştirir, bu sırada işaretçi yakalaması düşse de
// basılı çubuk ve düğme bırakılmaz.
function hexballBindStick (stick) {
  stick.addEventListener('pointerdown', (e) => {
    const tc = hexballState.touch
    if (tc.pointer !== null) return
    tc.pointer = e.pointerId
    try {
      stick.setPointerCapture(e.pointerId)
    } catch (err) {
      // İşaretçi yakalanamadı, çubuk pencere düzeyindeki olaylarla yine de hareket eder
    }
    e.preventDefault()
    hexballStickMove(e)
  })
}

function hexballBindKick (b) {
  b.addEventListener('pointerdown', (e) => {
    const tc = hexballState.touch
    if (tc.kickPointer !== null) return
    tc.kick = true
    tc.kickPointer = e.pointerId
    try {
      b.setPointerCapture(e.pointerId)
    } catch (err) {
      // İşaretçi yakalanamadı
    }
    if (e.pointerType !== 'mouse') e.preventDefault()
    hexballPushInput()
  })
  // Klavyeyle (Enter) etkinleştirilen düğme kısa bir vuruş yapar. Boşluk zaten vuruş tuşudur.
  b.addEventListener('click', (e) => {
    if (e.detail !== 0 || hexballState.touch.kick) return
    hexballState.touch.kick = true
    hexballPushInput()
    setTimeout(() => {
      if (hexballState.touch.kickPointer !== null) return
      hexballState.touch.kick = false
      hexballPushInput()
    }, HEXBALL_KICK_PULSE_MS)
  })
}

function hexballOnPointerMove (e) {
  if (e.pointerId === hexballState.touch.pointer) hexballStickMove(e)
}

function hexballOnPointerEnd (e) {
  const tc = hexballState.touch
  let changed = false
  if (e.pointerId === tc.pointer) {
    tc.pointer = null
    tc.x = 0
    tc.y = 0
    if (hexballState.kit) hexballState.kit.knob.style.transform = ''
    changed = true
  }
  if (e.pointerId === tc.kickPointer) {
    tc.kick = false
    tc.kickPointer = null
    changed = true
  }
  if (changed) hexballPushInput()
}

// ----- Metinler -----

function hexballEventText (ev, m) {
  if (!ev || typeof ev.e !== 'string') return ''
  const v = m && m.view ? m.view : null
  const team = (side) => hexballTeamName(side)
  if (ev.e === 'goal' || ev.e === 'own_goal') {
    let text = ''
    if (ev.e === 'own_goal') text = t('game.hexball.ev.own_goal', { name: shownName(ev.p), team: team(ev.side) })
    else if (ev.p) text = t('game.hexball.ev.goal', { name: shownName(ev.p), team: team(ev.side) })
    else text = t('game.hexball.ev.goalNobody', { team: team(ev.side) })
    if (v && v.score) text += ' ' + t('game.hexball.ev.score', { red: v.score.red, blue: v.score.blue })
    return text
  }
  if (ev.e === 'kickoff') return t('game.hexball.ev.kickoff', { team: team(ev.kick) })
  if (ev.e === 'time_up' || ev.e === 'golden') return t('game.hexball.ev.' + ev.e)
  if (ev.e === 'win') return t('game.hexball.ev.win', { team: team(ev.side) })
  if (ev.e === 'stop' && (ev.why === 'host' || ev.why === 'too_few')) return t('game.hexball.ev.stop.' + ev.why)
  if (ev.e === 'team' && HEXBALL_SIDES.indexOf(ev.side) >= 0) return t('game.hexball.ev.team.' + ev.side, { name: shownName(ev.p) })
  // Ayrılan kişiyi masa yöneticisi duyurur
  return ''
}

function hexballErrorText (code) {
  return HEXBALL_SHOWN_ERRORS.indexOf(code) >= 0 ? t('game.hexball.err.' + code) : false
}

function hexballRules (rules) {
  return window.TelsizHexball && window.TelsizHexball.RULES.indexOf(rules) >= 0
}

function hexballStatusParts (m) {
  const v = m.view
  if (!v || m.stage !== 'play') return []
  if (v.ph === 'match') return [t('game.hexball.ph.match', { mt: v.mt })]
  if (v.ph === 'result') return [t('game.hexball.ph.result')]
  return [t('game.hexball.ph.teams')]
}

function hexballNotes () {
  return [t('game.hexball.goldenRule'), t('game.hexball.controls.keys'), t('game.hexball.controls.pad'),
    t('game.hexball.controls.touch'), t('game.hexball.a11y')]
}

// ----- Takımlar ve sonuç ekranı -----

function hexballAct (move) {
  return gameCall('act', move)
}

function hexballKickoff () {
  const m = gameModel()
  const v = m.view
  if (m.role !== 'dealer' || !v || !m.legal || !m.legal.kickoff || hexballNotReady(m, v).length) return
  hexballAct({ t: 'kickoff' })
}

// Lobiye Dön: maç sonucu korunarak masa biter ve hemen lobiye döner, yeni kişiler katılabilir
function hexballToLobby () {
  const m = gameModel()
  if (m.role !== 'dealer' || !m.view || m.view.ph !== 'result') return
  if (gameCall('endGame')) gameCall('newRound')
}

function hexballChip (kind) {
  return h('span', 'hex-chip is-' + kind, t(kind === 'failed' ? 'game.hexball.link.failed' : 'game.hexball.link.waiting'))
}

function hexballBadge (side, text) {
  const b = h('span', 'hex-badge', text)
  b.setAttribute('data-side', side)
  b.setAttribute('aria-hidden', 'true')
  return b
}

function hexballPerson (m, v, ctx, id, side) {
  const li = h('li', 'hex-person')
  li.setAttribute('data-user-id', id)
  li.classList.toggle('is-me', id === m.me)
  const tag = hexballTag(v, ctx.numbers, id)
  if (tag) li.appendChild(hexballBadge(side, tag))
  li.appendChild(avatar(id, 'sm', 'hex-person-avatar'))
  const text = h('span', 'hex-person-text')
  const name = h('span', 'hex-person-name', shownName(id))
  if (id === v.seats[0]) name.appendChild(icon('i-crown', 'hex-crown'))
  text.appendChild(name)
  li.appendChild(text)
  if (ctx.host && id !== m.me) {
    const st = hexballHas(ctx.links, id) ? ctx.links[id] : 'none'
    if (st === 'failed') li.appendChild(hexballChip('failed'))
    else if (st !== 'ready' && side !== 'spec') li.appendChild(hexballChip('waiting'))
  }
  if (ctx.host && id !== m.me && ctx.legal.set) {
    const row = h('span', 'hex-set-row')
    HEXBALL_SIDES.filter((x) => x !== side).forEach((x) => {
      const label = t('game.hexball.set.' + x)
      const b = gameButton('button button-small button-ghost hex-set', label, null, 'hex-set-' + id + '-' + x, () => {
        hexballAct({ t: 'set', id: id, side: x })
      })
      b.setAttribute('aria-label', t('game.hexball.setLabel', { label: label, name: shownName(id) }))
      if (x !== 'spec' && ctx.legal.counts && ctx.legal.counts[x] >= window.TelsizHexball.TEAM_MAX) b.setAttribute('aria-disabled', 'true')
      row.appendChild(b)
    })
    li.appendChild(row)
  }
  return li
}

function hexballTeamColumn (m, v, ctx, side) {
  const ids = v.seats.filter((id) => v.teams[id] === side)
  const sec = h('section', 'hex-team')
  sec.setAttribute('data-side', side)
  const head = h('h3', 'hex-team-title')
  head.id = 'hex-team-' + side
  sec.setAttribute('aria-labelledby', head.id)
  if (side !== 'spec') head.appendChild(hexballBadge(side, hexballLetter(side)))
  head.appendChild(h('span', 'hex-team-name', hexballTeamName(side)))
  const count = h('span', 'hex-team-count', side === 'spec' ? String(ids.length) : ids.length + '/' + window.TelsizHexball.TEAM_MAX)
  count.setAttribute('aria-hidden', 'true')
  head.appendChild(count)
  head.appendChild(h('span', 'sr-only', t('game.players', { count: ids.length })))
  sec.appendChild(head)
  if (ids.length) {
    const list = h('ul', 'hex-roster')
    ids.forEach((id) => list.appendChild(hexballPerson(m, v, ctx, id, side)))
    sec.appendChild(list)
  } else {
    sec.appendChild(h('p', 'hex-empty', t('game.hexball.empty')))
  }
  // Kişinin kendi takım değişikliği bu sütunun altında
  if (ctx.legal.team && ctx.legal.team.indexOf(side) >= 0) {
    const join = gameButton('button button-secondary hex-join', t('game.hexball.to.' + side), null, 'hex-join-' + side, () => {
      hexballAct({ t: 'team', side: side })
    })
    if (m.pending) join.setAttribute('aria-disabled', 'true')
    sec.appendChild(join)
  }
  return sec
}

function hexballResultBlock (v) {
  const r = v.result
  const sec = h('div', 'hex-result')
  if (!r) return sec
  const win = h('p', 'hex-result-win', r.winner ? t('game.hexball.win', { team: hexballTeamName(r.winner) }) : t('game.resultNone'))
  if (r.winner) win.insertBefore(hexballBadge(r.winner, hexballLetter(r.winner)), win.firstChild)
  sec.appendChild(win)
  sec.appendChild(h('p', 'hex-result-why', t('game.hexball.why.' + r.why)))
  if (v.mt < 1) return sec
  sec.appendChild(h('p', 'hex-result-score', t('game.hexball.scoreLine', { red: v.score.red, blue: v.score.blue })))
  if (!v.goals.length) return sec
  const title = h('h4', 'hex-goals-title', t('game.hexball.goalsTitle'))
  sec.appendChild(title)
  const list = h('ol', 'hex-goals')
  v.goals.forEach((g) => {
    const li = h('li', 'hex-goal')
    li.setAttribute('data-side', g.side)
    const who = g.by === null ? hexballTeamName(g.side) : g.own
      ? t('game.hexball.ownGoalBy', { name: shownName(g.by), team: hexballTeamName(g.side) })
      : t('game.hexball.goalBy', { name: shownName(g.by), team: hexballTeamName(g.side) })
    li.appendChild(h('span', 'hex-goal-time', hexballClock(g.at)))
    li.appendChild(h('span', 'hex-goal-who', who))
    list.appendChild(li)
  })
  sec.appendChild(list)
  return sec
}

function hexballLinkNote (m) {
  if (m.role !== 'player') return null
  const st = hexballPlayerLink(m)
  hexballState.playerShown = st
  if (st === 'ready') return null
  const failed = st === 'failed'
  return gameNote('hex-link is-' + st, failed ? 'i-alert' : null, t(failed ? 'game.hexball.link.failedPlayer' : 'game.hexball.link.waitingPlayer'))
}

function hexballRenderTeams (root, m, v) {
  const host = m.role === 'dealer'
  const legal = m.legal || { team: [], set: false, kickoff: false, kickoffWhy: null, counts: null }
  const ctx = { host: host, legal: legal, links: host ? hexballLinks() : {}, numbers: hexballNumbers(v) }
  if (v.ph === 'result') root.appendChild(hexballResultBlock(v))
  const link = hexballLinkNote(m)
  if (link) root.appendChild(link)
  const side = hexballHas(v.teams, m.me) ? v.teams[m.me] : null
  if (side) root.appendChild(h('p', 'hex-mine', side === 'spec' ? t('game.hexball.youSpec') : t('game.hexball.yourTeam', { team: hexballTeamName(side) })))
  const cols = h('div', 'hex-teams')
  HEXBALL_SIDES.forEach((x) => cols.appendChild(hexballTeamColumn(m, v, ctx, x)))
  root.appendChild(cols)
  const actions = h('div', 'game-actions hex-actions')
  if (host) {
    const waiting = hexballNotReady(m, v)
    const failed = waiting.filter((id) => ctx.links[id] === 'failed')
    if (legal.kickoffWhy === 'teams_empty') root.appendChild(gameNote('game-hint', null, t('game.hexball.err.teams_empty')))
    else if (waiting.length) root.appendChild(gameNote('game-hint hex-not-ready', null, t('game.hexball.link.notReady', { names: waiting.map(shownName).join(', ') })))
    if (failed.length) root.appendChild(gameNote('game-alert hex-failed', 'i-alert', t('game.hexball.link.failedHost', { names: failed.map(shownName).join(', ') })))
    if (v.ph === 'result') {
      actions.appendChild(gameButton('button button-secondary', t('game.hexball.toLobby'), null, 'hex-lobby', hexballToLobby))
    }
    const start = gameButton('button game-primary', t(v.ph === 'result' ? 'game.hexball.again' : 'game.hexball.kickoff'), 'i-play', 'hex-kickoff', hexballKickoff)
    if (!legal.kickoff || waiting.length) start.setAttribute('aria-disabled', 'true')
    actions.appendChild(start)
    root.appendChild(actions)
  } else {
    root.appendChild(gameNote('game-wait', null, t(v.ph === 'result' ? 'game.hexball.waitAgain' : 'game.hexball.waitKickoff')))
  }
  // Maç ekranındaki gibi dokunmatik cihazda dokunmatik denetimler anlatılır
  root.appendChild(h('p', 'hex-help', t(hexballTouchMode() ? 'game.hexball.controls.touch' : 'game.hexball.controls.keys')))
}

// ----- Maç ekranı -----

// Maç boyunca aynı kalan öğeler: skor tablosu, saha tuvali ve dokunmatik denetimler. Maç, dil ya da kişi değişince
// yeniden kurulur.
function hexballKit (m, v) {
  const lang = window.I18N ? window.I18N.lang : ''
  const key = [v.epoch, lang, m.me].join('|')
  if (hexballState.kit && hexballState.kit.key === key) return hexballState.kit
  const kit = { key: key, epoch: v.epoch, ctx: null, layer: null, layerKey: '', w: 0, h: 0, dpr: 1, scale: 1, frames: 0, label: '' }
  const board = h('div', 'hex-board')
  HEXBALL_TEAMS.forEach((side, i) => {
    const team = h('span', 'hex-board-team')
    team.setAttribute('data-side', side)
    team.appendChild(hexballBadge(side, hexballLetter(side)))
    team.appendChild(h('span', 'hex-board-name', hexballTeamName(side)))
    const score = h('b', 'hex-board-score', '0')
    team.appendChild(score)
    kit[side] = score
    board.appendChild(team)
    if (i === 0) {
      const mid = h('span', 'hex-board-mid')
      kit.clock = h('span', 'hex-clock', '')
      kit.clock.setAttribute('role', 'timer')
      kit.clock.setAttribute('aria-live', 'off')
      mid.appendChild(kit.clock)
      kit.lag = h('span', 'hex-chip is-waiting hex-lag', t('game.hexball.lag'))
      kit.lag.hidden = true
      mid.appendChild(kit.lag)
      board.appendChild(mid)
    }
  })
  kit.board = board
  const wrap = h('div', 'hex-field')
  const canvas = h('canvas', 'hex-canvas')
  canvas.setAttribute('role', 'img')
  wrap.appendChild(canvas)
  const overlay = h('p', 'hex-overlay')
  overlay.setAttribute('aria-hidden', 'true')
  overlay.hidden = true
  wrap.appendChild(overlay)
  wrap.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || hexballState.touchSeen) return
    hexballState.touchSeen = true
    hexballSoon()
  })
  kit.wrap = wrap
  kit.canvas = canvas
  kit.overlay = overlay
  const touch = h('div', 'hex-touch')
  const stick = h('div', 'hex-stick')
  stick.setAttribute('aria-hidden', 'true')
  const knob = h('span', 'hex-knob')
  stick.appendChild(knob)
  hexballBindStick(stick)
  const kick = h('button', 'hex-kick', t('game.hexball.kick'))
  kick.type = 'button'
  kick.setAttribute('data-focus-key', 'hex-kick')
  hexballBindKick(kick)
  touch.appendChild(stick)
  touch.appendChild(kick)
  kit.touch = touch
  kit.stick = stick
  kit.knob = knob
  kit.kick = kick
  if (hexballState.kit) hexballRelease()
  hexballState.kit = kit
  return kit
}

function hexballLegend (m, v) {
  const numbers = hexballNumbers(v)
  const links = m.role === 'dealer' ? hexballLinks() : {}
  const list = h('ul', 'hex-legend')
  list.setAttribute('aria-label', t('game.seatsTitle'))
  v.seats.filter((id) => v.teams[id] === 'red' || v.teams[id] === 'blue').forEach((id) => {
    const side = v.teams[id]
    const li = h('li', 'hex-legend-item')
    li.setAttribute('data-user-id', id)
    li.classList.toggle('is-me', id === m.me)
    li.appendChild(hexballBadge(side, hexballTag(v, numbers, id)))
    li.appendChild(h('span', 'hex-legend-name', shownName(id)))
    li.appendChild(h('span', 'sr-only', hexballTeamName(side)))
    if (m.role === 'dealer' && id !== m.me && links[id] !== 'ready') li.appendChild(hexballChip(links[id] === 'failed' ? 'failed' : 'waiting'))
    list.appendChild(li)
  })
  return list
}

function hexballStopRow () {
  const row = h('div', 'game-confirm hex-confirm')
  row.setAttribute('role', 'group')
  row.setAttribute('aria-labelledby', 'hex-stop-text')
  const p = h('p', 'game-confirm-text', t('game.hexball.stopAsk'))
  p.id = 'hex-stop-text'
  row.appendChild(p)
  const actions = h('div', 'game-actions')
  const cancel = () => {
    hexballState.confirmStop = false
    gameState.focusNext = 'hex-stop'
    gameRefreshStage()
  }
  actions.appendChild(gameButton('button button-secondary', t('game.confirmStay'), null, 'hex-stop-no', cancel))
  actions.appendChild(gameButton('button button-danger', t('game.hexball.confirmStop'), null, 'hex-stop-yes', () => {
    hexballState.confirmStop = false
    hexballAct({ t: 'stop' })
  }))
  row.appendChild(actions)
  row.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' && e.key !== 'Esc') return
    e.preventDefault()
    cancel()
  })
  return row
}

function hexballRenderMatch (root, m, v) {
  const kit = hexballKit(m, v)
  root.appendChild(kit.board)
  const link = hexballLinkNote(m)
  if (link) root.appendChild(link)
  root.appendChild(kit.wrap)
  const touch = hexballTouchMode() && hexballHasSlot(m)
  kit.touch.hidden = !touch
  root.appendChild(kit.touch)
  root.appendChild(hexballLegend(m, v))
  const side = hexballHasSlot(m) ? v.teams[m.me] : null
  const help = h('p', 'hex-help')
  help.appendChild(h('span', 'hex-help-role', side ? t('game.hexball.youPlay', { team: hexballTeamName(side) }) : t('game.hexball.youSpec')))
  if (side) help.appendChild(h('span', 'hex-help-keys', ' ' + t(touch ? 'game.hexball.controls.touch' : 'game.hexball.controls.keys')))
  root.appendChild(help)
  if (m.role === 'dealer') {
    if (hexballState.confirmStop) {
      root.appendChild(hexballStopRow())
    } else {
      const actions = h('div', 'game-actions hex-actions')
      actions.appendChild(gameButton('button button-danger', t('game.hexball.stop'), null, 'hex-stop', () => {
        hexballState.confirmStop = true
        gameState.focusNext = 'hex-stop-no'
        gameRefreshStage()
      }))
      root.appendChild(actions)
    }
  }
  hexballUpdateBoard(kit, m, v, hexballFrameNow())
}

function hexballRender (box, m) {
  hexballSync(m)
  const v = m.view
  if (!v || !Array.isArray(v.seats) || !window.TelsizHexball) return
  if (!hexballInMatch(m)) hexballState.confirmStop = false
  const root = h('div', 'hex-table')
  root.setAttribute('data-ph', v.ph)
  if (hexballInMatch(m)) hexballRenderMatch(root, m, v)
  else if (m.stage === 'play') hexballRenderTeams(root, m, v)
  box.appendChild(root)
  if (hexballInMatch(m)) hexballStartFrames()
}

function hexballRenderResults (box, m) {
  if (m.view && m.view.result) box.appendChild(hexballResultBlock(m.view))
}

function hexballFirstFocus (box) {
  const keys = ['hex-kickoff', 'hex-kick', 'hex-stop']
  for (const key of keys) {
    const node = hexballByKey(box, key)
    if (node && !node.closest('[hidden]')) return node
  }
  return box.querySelector('.hex-join')
}

// Sahne kapandı (küçültüldü): maç oturumları sürer, tuşlar ve denetimler bırakılır
function hexballStageClosed () {
  hexballState.confirmStop = false
  hexballSyncListen(false)
}

function hexballOnVoiceEvent (evt, m) {
  if (!evt || typeof evt !== 'object') return
  if (evt.type === 'reset') {
    hexballDrop()
    return
  }
  if (hexballState.host) hexballState.host.onVoiceEvent(evt)
  if (hexballState.player) {
    hexballState.player.onVoiceEvent(evt)
    if (evt.type === 'link-failed' && evt.peerId === hexballState.playerPeer) {
      hexballState.playerLink = 'failed'
      hexballSoon()
    }
  }
  if (evt.type === 'peer-ready' || evt.type === 'peer-leave') hexballSync(m)
}

function hexballOnData (peerId, userId, data) {
  if (hexballState.host) hexballState.host.onData(peerId, userId, data)
  else if (hexballState.player) hexballState.player.onData(peerId, userId, data)
}

// ----- Çizim -----

function hexballFrameNow () {
  if (hexballState.host) return hexballState.host.frame()
  if (hexballState.player) return hexballState.player.frame(hexballNow())
  return null
}

function hexballStartFrames () {
  if (hexballState.raf) return
  hexballState.raf = true
  nextFrame(hexballFrame)
}

function hexballFrame () {
  hexballState.raf = false
  const kit = hexballState.kit
  const m = gameModel()
  const v = m.view
  const on = Boolean(kit) && isConnected(kit.canvas) && gameStageVisible() && hexballInMatch(m) && v.epoch === kit.epoch
  hexballSyncListen(on && hexballHasSlot(m))
  if (!on) return
  if (hexballHasSlot(m)) hexballPollPad()
  const f = hexballFrameNow()
  hexballDraw(kit, v, f)
  hexballUpdateBoard(kit, m, v, f)
  hexballState.raf = true
  nextFrame(hexballFrame)
}

// Belirteçler kök öğede çözülür, tema ya da mod değişince yeniden okunur
function hexballColors () {
  const root = document.documentElement
  const key = (root.getAttribute('data-skin') || '') + '|' + (root.getAttribute('data-scheme') || '')
  if (hexballState.colors && hexballState.colorsKey === key) return hexballState.colors
  let style = null
  try {
    style = window.getComputedStyle(root)
  } catch (err) {
    style = null
  }
  const out = {}
  Object.keys(HEXBALL_COLOR_TOKENS).forEach((name) => {
    const value = style ? String(style.getPropertyValue(HEXBALL_COLOR_TOKENS[name]) || '').trim() : ''
    out[name] = value || 'gray'
  })
  const font = style ? String(style.getPropertyValue('--font-label') || '').trim() : ''
  out.font = font || 'sans-serif'
  hexballState.colors = out
  hexballState.colorsKey = key
  return out
}

function hexballRem () {
  let size = 16
  try {
    size = parseFloat(window.getComputedStyle(document.documentElement).fontSize) || 16
  } catch (err) {
    size = 16
  }
  return size
}

// Tuval sahanın en boy oranıyla kutuya sığar: genişlik kutunun genişliği, yükseklik sahnenin görünen yüksekliğinde
// tuvalin üstünden alta kalan yeri (telefonda altındaki dokunmatik denetimler de görünür kalır) aşmaz. Oyuncular,
// açıklama ve alt satır gerekirse kaydırılarak görülür. Ölçü her HEXBALL_SIZE_FRAMES karede bir okunur.
function hexballFit (kit, geo) {
  kit.frames++
  if (kit.w && kit.frames % HEXBALL_SIZE_FRAMES !== 1) return
  const viewW = geo.w + 2 * HEXBALL_PAD
  const viewH = geo.h + 2 * HEXBALL_PAD
  const avail = Number(kit.wrap.clientWidth) || 0
  let maxH = Infinity
  const box = kit.wrap.closest('.cast-game')
  if (box) {
    const rem = hexballRem()
    const top = kit.wrap.getBoundingClientRect().top - box.getBoundingClientRect().top + (Number(box.scrollTop) || 0)
    const touch = kit.touch.hidden ? 0 : Number(kit.touch.offsetHeight) || 0
    const room = Number(box.clientHeight) - top - touch - rem * 1.75
    if (room > 0) maxH = Math.max(rem * 9, room)
  }
  let w = avail
  let hh = w * viewH / viewW
  if (hh > maxH) {
    hh = maxH
    w = hh * viewW / viewH
  }
  w = Math.floor(w)
  hh = Math.floor(hh)
  const dpr = Math.min(HEXBALL_MAX_DPR, Math.max(1, Number(window.devicePixelRatio) || 1))
  if (w === kit.w && hh === kit.h && dpr === kit.dpr) return
  kit.w = w
  kit.h = hh
  kit.dpr = dpr
  kit.scale = w / viewW
  kit.canvas.width = Math.round(w * dpr)
  kit.canvas.height = Math.round(hh * dpr)
  kit.canvas.style.width = w + 'px'
  kit.canvas.style.height = hh + 'px'
  kit.layer = null
}

function hexballHexPath (g, x, y, r, k) {
  g.moveTo(x + r, y)
  g.lineTo(x + r / 2, y + r * k)
  g.lineTo(x - r / 2, y + r * k)
  g.lineTo(x - r, y)
  g.lineTo(x - r / 2, y - r * k)
  g.lineTo(x + r / 2, y - r * k)
  g.closePath()
}

// Saha deseni: düz kenarı yukarıda altıgenler
function hexballHexGrid (g, hw, hh) {
  const r = HEXBALL_HEX_R
  const k = Math.sqrt(3) / 2
  const dx = r * 1.5
  const dy = r * 2 * k
  let col = 0
  let x = -hw - r
  g.beginPath()
  while (x <= hw + r) {
    let y = -hh - dy + (col % 2 ? dy / 2 : 0)
    while (y <= hh + dy) {
      hexballHexPath(g, x, y, r, k)
      y += dy
    }
    x += dx
    col++
  }
  g.stroke()
}

function hexballPaintField (g, width, height, s, geo, c) {
  const hw = geo.hw
  const hh = geo.hh
  const gh = geo.goal / 2
  g.setTransform(1, 0, 0, 1, 0, 0)
  g.fillStyle = c.out
  g.fillRect(0, 0, width, height)
  g.setTransform(s, 0, 0, s, width / 2, height / 2)
  g.fillStyle = c.net
  g.fillRect(-hw - geo.depth, -gh, geo.depth, geo.goal)
  g.fillRect(hw, -gh, geo.depth, geo.goal)
  g.fillStyle = c.field
  g.fillRect(-hw, -hh, geo.w, geo.h)
  g.save()
  g.beginPath()
  g.rect(-hw, -hh, geo.w, geo.h)
  g.clip()
  g.strokeStyle = c.pattern
  g.lineWidth = 2
  hexballHexGrid(g, hw, hh)
  g.restore()
  g.strokeStyle = c.line
  g.lineWidth = 3
  g.strokeRect(-hw, -hh, geo.w, geo.h)
  g.beginPath()
  g.moveTo(0, -hh)
  g.lineTo(0, hh)
  g.stroke()
  g.beginPath()
  g.arc(0, 0, geo.centerR, 0, Math.PI * 2)
  g.stroke()
  g.lineWidth = 2
  g.strokeRect(-hw - geo.depth, -gh, geo.depth, geo.goal)
  g.strokeRect(hw, -gh, geo.depth, geo.goal)
  g.fillStyle = c.post
  geo.posts.forEach((p) => {
    g.beginPath()
    g.arc(p.x, p.y, geo.postR, 0, Math.PI * 2)
    g.fill()
  })
}

// Saha katmanı ayrı bir tuvalde bir kez çizilir, ölçü, ön ayar ya da renkler değişince yenilenir
function hexballFieldLayer (kit, geo, colors) {
  const key = [geo.rules, kit.canvas.width, kit.canvas.height, hexballState.colorsKey].join('|')
  if (kit.layer && kit.layerKey === key) return kit.layer
  const c = document.createElement('canvas')
  const g = typeof c.getContext === 'function' ? c.getContext('2d') : null
  if (!g) return null
  c.width = kit.canvas.width
  c.height = kit.canvas.height
  hexballPaintField(g, c.width, c.height, kit.scale * kit.dpr, geo, colors)
  kit.layer = c
  kit.layerKey = key
  return c
}

function hexballCircle (ctx, x, y, r) {
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
}

function hexballDraw (kit, v, f) {
  const P = window.TelsizHexballPhysics
  const geo = P ? P.field(v.rules) : null
  const canvas = kit.canvas
  if (!geo || typeof canvas.getContext !== 'function') return
  if (!kit.ctx) kit.ctx = canvas.getContext('2d')
  const ctx = kit.ctx
  if (!ctx) return
  hexballFit(kit, geo)
  if (!kit.w || !kit.h) return
  const c = hexballColors()
  const s = kit.scale * kit.dpr
  const layer = hexballFieldLayer(kit, geo, c)
  if (layer) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(layer, 0, 0)
  } else {
    hexballPaintField(ctx, canvas.width, canvas.height, s, geo, c)
  }
  ctx.setTransform(s, 0, 0, s, canvas.width / 2, canvas.height / 2)
  if (!f) return
  const ids = hexballSlotIds(v)
  const numbers = hexballNumbers(v)
  ctx.font = '700 13px ' + c.font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  f.players.forEach((p) => {
    const id = hexballHas(ids, p.slot) ? ids[p.slot] : null
    const side = id ? v.teams[id] : null
    if (side !== 'red' && side !== 'blue') return
    const r = P.PLAYER_R
    if (p.kick) {
      hexballCircle(ctx, p.x, p.y, r + 7)
      ctx.strokeStyle = c.kick
      ctx.lineWidth = 2
      ctx.stroke()
    }
    hexballCircle(ctx, p.x, p.y, r)
    ctx.fillStyle = c[side]
    ctx.fill()
    ctx.strokeStyle = c.edge
    ctx.lineWidth = 2
    ctx.stroke()
    if (p.slot === f.me) {
      hexballCircle(ctx, p.x, p.y, r + 3.5)
      ctx.strokeStyle = c.me
      ctx.lineWidth = 2.5
      ctx.stroke()
    }
    ctx.fillStyle = c.ink
    ctx.fillText(hexballLetter(side) + (numbers[id] || ''), p.x, p.y + 0.5)
  })
  hexballCircle(ctx, f.ball.x, f.ball.y, P.BALL_R)
  ctx.fillStyle = c.ball
  ctx.fill()
  ctx.strokeStyle = c.ballEdge
  ctx.lineWidth = 2
  ctx.stroke()
}

// Gol yazısı: modeldeki son gol anlık görüntünün skoruyla aynıysa atanın adı, değilse yalnızca "Gol!"
function hexballGoalText (v, f) {
  const total = f.score.red + f.score.blue
  const g = v.goals.length && v.score.red + v.score.blue === total ? v.goals[v.goals.length - 1] : null
  if (!g) return t('game.hexball.goalShort')
  if (g.by === null) return t('game.hexball.goalTeam', { team: hexballTeamName(g.side) })
  return g.own ? t('game.hexball.ownGoal', { name: shownName(g.by) }) : t('game.hexball.goal', { name: shownName(g.by) })
}

function hexballOverlay (m, v, f) {
  if (!f) {
    const st = m.role === 'player' ? hexballPlayerLink(m) : 'waiting'
    return { kind: 'link', text: t(st === 'failed' ? 'game.hexball.link.failed' : 'game.hexball.link.waiting') }
  }
  if (f.paused || f.phase === 'paused') return { kind: 'paused', text: t('game.hexball.paused') }
  if (f.phase === 'goal') return { kind: 'goal', text: hexballGoalText(v, f) }
  if (f.phase === 'over') return { kind: 'over', text: t('game.hexball.ph.result') }
  if (f.phase === 'kickoff') return { kind: 'kickoff', text: t('game.hexball.kickoffBy', { team: hexballTeamName(v.kick) }) }
  return null
}

// Skor tablosu, saat, bindirme yazısı ve tuvalin erişilebilir adı (yalnızca değişen metin yazılır)
function hexballUpdateBoard (kit, m, v, f) {
  const score = f ? f.score : v.score
  hexballSetText(kit.red, String(score.red))
  hexballSetText(kit.blue, String(score.blue))
  const golden = v.golden || Boolean(f && f.remaining === 0 && (f.phase === 'play' || f.phase === 'kickoff' || f.phase === 'goal'))
  let secs = window.TelsizHexball.PRESETS[v.rules].secs
  if (f) secs = Math.ceil(f.remaining / 10)
  hexballSetText(kit.clock, golden ? t('game.hexball.golden') : hexballClock(secs))
  kit.clock.classList.toggle('is-golden', golden)
  const label = t('game.hexball.fieldLabel', { red: score.red, blue: score.blue })
  if (kit.label !== label) {
    kit.label = label
    kit.canvas.setAttribute('aria-label', label)
  }
  const over = hexballOverlay(m, v, f)
  kit.overlay.hidden = !over
  if (over) {
    hexballSetText(kit.overlay, over.text)
    if (kit.overlay.getAttribute('data-kind') !== over.kind) kit.overlay.setAttribute('data-kind', over.kind)
  }
  const paused = Boolean(over && over.kind === 'paused')
  if (paused !== hexballState.paused) {
    hexballState.paused = paused
    if (paused) gameAnnounce(t('game.hexball.paused'), false)
  }
  let lag = false
  if (hexballState.player && f && !paused && f.phase !== 'over') {
    const st = hexballState.player.state()
    lag = !st.ended && st.age !== null && st.age > HEXBALL_LAG_MS
  }
  if (kit.lag.hidden === lag) kit.lag.hidden = !lag
}

const hexballUi = {
  name: () => t('game.hexball.name'),
  tagline: () => t('game.hexball.desc'),
  rulesLabel: (rules) => (hexballRules(rules) ? t('game.hexball.rules.' + rules) : ''),
  rulesHint: (rules) => (hexballRules(rules) ? t('game.hexball.rulesHint.' + rules) : ''),
  rulesLine: (rules) => (hexballRules(rules) ? t('game.hexball.rulesLine.' + rules) : ''),
  render: hexballRender,
  renderResults: hexballRenderResults,
  statusParts: hexballStatusParts,
  turnOf: () => null,
  eventText: hexballEventText,
  errorText: hexballErrorText,
  notes: hexballNotes,
  trustNote: () => t('game.hexball.trustHost'),
  firstFocus: hexballFirstFocus,
  stageClosed: hexballStageClosed,
  ownsPad: (m) => hexballInMatch(m) && hexballHasSlot(m),
  onVoiceEvent: hexballOnVoiceEvent,
  onData: hexballOnData
}

if (typeof gameUiRegister === 'function') gameUiRegister(HEXBALL_ID, hexballUi)
