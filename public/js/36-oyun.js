'use strict'

// Oyun yapıştırıcısı ve genel arayüz. Masa yöneticisini (34-oyun-masa.js) bu cihazın ortamıyla kurar ve ses
// motorunun oyun olaylarını ona iletir (10-voice.js createVoice onGameEvent). Telsiz kartının araç satırındaki Oyun
// düğmesini (#radio-game, Büyüt ile Telsiz DJ arasında) ve yayın sahnesinin game kipinde (22-cast.js) Masa Kur,
// lobi, davet, bitiş ve sonuç ekranlarını, durum satırını, güven notunu, onay satırını ve canlı bölgeleri çizer.
// Oyunun masa ortası uygulamanın kendi arayüzündedir (ör. 37-renk.js), o da yüklenirken gameUiRegister ile kaydolur.
// Kayıtlı arayüzü olmayan oyun açılamaz, davetleri de işlenmez (düğme görünmez).
//
// Kurallar:
// - Özel aramada oyun yoktur: düğme gizlenir, olaylar atılır.
// - Gelen davet sahneyi açmaz. Düğme "Davet" olur, Bildirimler listesine kayıt düşer, kibar bir duyuru yapılır.
//   Sahne yalnızca kişi açınca açılır, küçültülünce oyun sürer.
// - Görünüm modeli değişince sahne yalnızca kendi anahtarı değiştiyse yeniden çizilir, odak data-focus-key ile korunur.
// - "Sıra sizde" duyurusu ısrarlı bölgeye, diğer duyurular kibar bölgeye gider. 400 ms içindekiler birleşir.
//
// Uygulama arayüzünün sözleşmesi (gameUiRegister(id, ui)), name ve render zorunlu, diğerleri isteğe bağlıdır:
//   name(), tagline(), rulesLabel(rules), rulesHint(rules), rulesLine(rules), render(box, model),
//   statusParts(model) -> [metin], turnOf(model) -> id, turnText(model), onTurn(box, model), eventText(olay, model),
//   errorText(kod) -> metin veya false (sessiz kod), results(model) -> { reason, winner, total, ranks: [{ id, rank, n, points }] },
//   notes(model) -> [metin], firstFocus(box) -> öğe, stageClosed() (sahne kapandı, uygulama kendi katmanlarını kapatır)

const GAME_TICK_MS = 250
const GAME_ANNOUNCE_MS = 400
const GAME_ID_RE = /^[a-z]{1,16}$/
// Oyun kimliği -> kural motorunun genel adı (5.1 sözleşmesi)
const GAME_ENGINES = { renk: 'TelsizRenk' }
// İlk odak sırası: sahne açılınca en anlamlı denetim
const GAME_FIRST_KEYS = ['game-confirm-no', 'game-join', 'game-rejoin', 'game-open', 'game-start', 'game-new-round', 'game-dismiss']

const gameState = {
  desk: null,
  model: null,
  apps: {},
  uis: {},
  timer: 0,
  minimized: false,
  wanted: false,
  acting: 0,
  stageKey: '',
  toolKey: '',
  body: null,
  live: null,
  confirm: null,
  focusNext: null,
  trustOpen: false,
  picker: null,
  uiRev: 0,
  turnFocus: false,
  lastTurnId: null,
  startedRd: 0,
  activityDealer: null,
  announce: { polite: [], assertive: [], timer: 0 }
}

function gameHas (obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key)
}

// ----- Uygulamalar ve arayüzleri -----

function gameApp (id) {
  const key = String(id)
  if (!GAME_ID_RE.test(key) || !gameHas(GAME_ENGINES, key)) return null
  const engine = window[GAME_ENGINES[key]]
  return engine && typeof engine === 'object' && engine.id === key ? engine : null
}

// Uygulama arayüzünün kaydı. Kural motoru da bulunmalıdır, yalnızca ikisi birlikte olan oyun açılır ve davet alır.
function gameUiRegister (id, ui) {
  const key = String(id)
  if (!GAME_ID_RE.test(key) || !ui || typeof ui.name !== 'function' || typeof ui.render !== 'function') return false
  const engine = gameApp(key)
  if (!engine) return false
  gameState.uis[key] = ui
  gameState.apps[key] = engine
  gameState.toolKey = ''
  return true
}

function gameUi (id) {
  return id && gameHas(gameState.uis, id) ? gameState.uis[id] : null
}

function gameAppIds () {
  return Object.keys(gameState.apps)
}

// Arayüz kancası: yoksa veya hata verirse yedek değer
function gameUiCall (ui, name, args, fallback) {
  if (!ui || typeof ui[name] !== 'function') return fallback
  try {
    const out = ui[name].apply(ui, args || [])
    return out === undefined || out === null ? fallback : out
  } catch (err) {
    window.console.error(err)
    return fallback
  }
}

function gameAppName (id) {
  return String(gameUiCall(gameUi(id), 'name', [], ''))
}

function gameRulesLabel (ui, rules) {
  return String(gameUiCall(ui, 'rulesLabel', [rules], rules || ''))
}

function gameRulesHint (ui, rules) {
  return String(gameUiCall(ui, 'rulesHint', [rules], ''))
}

// Hareketi azalt: işletim sistemi ayarı veya Ayarlar > Görünüm seçimi
function gameReducedMotion () {
  let media = false
  try {
    media = Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  } catch (err) {
    media = false
  }
  return media || document.documentElement.getAttribute('data-reduce-motion') === 'true'
}

// ----- Masa yöneticisi ve ortamı (4.5) -----

// İç katman anahtarları: kişinin güncel doğrulanmış açık anahtarı ve bu cihazdaki kimlik anahtarı. Her mühürleme ve
// açmada yeniden okunur, eski anahtarlar denenmez.
function gameKeys (userId) {
  if (typeof dmSendState !== 'function' || typeof myIdentity !== 'function') return { ok: false, reason: 'locked' }
  const st = dmSendState(userId)
  if (!st || !st.ok) return { ok: false, reason: st && st.reason ? st.reason : 'gone' }
  const pair = myIdentity()
  if (!pair) return { ok: false, reason: 'locked' }
  return { ok: true, pk: st.pk, sk: pair.secretKey }
}

// Odadaki kişiler (kendim hariç), ses kadrosunun sırasıyla. peerId ses motorunun anlık görüntüsünden gelir.
function gameRoomPeers () {
  const s = snap()
  const peers = s && s.peers && typeof s.peers === 'object' ? s.peers : {}
  const me = state.me ? String(state.me.id) : ''
  const order = s && s.channelId !== null && s.channelId !== undefined ? voiceRoster(s.channelId).map((entry) => String(entry.userId)) : []
  const ids = order.filter((id) => gameHas(peers, id)).concat(Object.keys(peers).filter((id) => order.indexOf(id) < 0))
  return ids.filter((id, i) => {
    const p = peers[id]
    return id !== me && ids.indexOf(id) === i && p && typeof p.peerId === 'string' && p.peerId !== ''
  }).map((id) => ({ userId: id, peerId: peers[id].peerId }))
}

function gameSend (peerId, p, done) {
  if (!voice || typeof voice.sendGame !== 'function') return 'not_in_voice'
  try {
    return voice.sendGame(peerId, p, done)
  } catch (err) {
    window.console.error(err)
    return 'bad_message'
  }
}

function gameDesk () {
  if (gameState.desk) return gameState.desk
  const D = window.TelsizGameDesk
  if (!D || !window.TelsizGame || !window.E2EE || !window.E2EE.dm || !window.nacl) return null
  gameState.desk = D.create({
    me: () => (state.me ? String(state.me.id) : null),
    channel: () => {
      const s = snap()
      return s.channelId === null || s.channelId === undefined ? null : String(s.channelId)
    },
    isPrivate: () => Boolean(snap().private),
    roomPeers: gameRoomPeers,
    send: gameSend,
    keys: gameKeys,
    locked: () => typeof myIdentity !== 'function' || !myIdentity(),
    dm: window.E2EE.dm,
    rng: (n) => window.nacl.randomBytes(n),
    now: () => Date.now(),
    isBlocked: (uid) => typeof isBlocked === 'function' && Boolean(isBlocked(uid)),
    apps: gameState.apps,
    onChange: gameOnDeskChange,
    onNotice: gameOnNotice
  })
  return gameState.desk
}

function gameEmptyModel () {
  return {
    rev: 0,
    role: 'none',
    stage: 'none',
    app: null,
    g: null,
    dealer: null,
    me: null,
    rules: null,
    rd: 0,
    min: 0,
    max: 0,
    seats: [],
    room: [],
    invite: null,
    pending: null,
    slow: false,
    syncing: false,
    view: null,
    mine: null,
    legal: null,
    ack: null,
    events: [],
    newEvents: [],
    ended: null,
    rejected: null,
    error: null,
    locked: false
  }
}

function gameModel () {
  if (!gameState.model) gameState.model = gameState.desk ? gameState.desk.model() : gameEmptyModel()
  return gameState.model
}

// Kişinin başlattığı işlem: bu sırada başlayan masa küçültülmüş açılmaz
function gameUser (fn) {
  gameState.acting++
  try {
    return fn()
  } finally {
    gameState.acting--
  }
}

function gameCall (name, arg) {
  const desk = gameDesk()
  if (!desk || typeof desk[name] !== 'function') return false
  return gameUser(() => desk[name](arg))
}

// Ses motorunun olayları: özel aramada ve seste değilken reset dışındakiler atılır (4.8 ortak ön adımlar)
function gameOnVoiceEvent (evt) {
  if (!evt || typeof evt !== 'object') return
  const desk = gameDesk()
  if (!desk) return
  if (evt.type !== 'reset') {
    const s = snap()
    if (s.private || s.channelId === null || s.channelId === undefined) return
  }
  desk.onVoiceEvent(evt)
}

function gameTick () {
  if (!gameState.desk) return
  try {
    gameState.desk.tick()
  } catch (err) {
    window.console.error(err)
  }
}

// Zamanlayıcı yalnızca masa veya davet varken çalışır
function gameSyncTick (m) {
  if (m.role !== 'none' && !gameState.timer) {
    gameState.timer = setInterval(gameTick, GAME_TICK_MS)
  } else if (m.role === 'none' && gameState.timer) {
    clearInterval(gameState.timer)
    gameState.timer = 0
  }
}

// Saklı davet başka bir masaya ait ve beni oturtmuyorsa "Oyun Sürüyor"
function gameOfferBusy (inv, me) {
  return Boolean(inv) && inv.ph !== 'lobby' && (!Array.isArray(inv.seats) || inv.seats.indexOf(me) < 0)
}

function gameTurnId (m) {
  const ui = gameUi(m.app)
  const fallback = m.view && typeof m.view.turn === 'string' ? m.view.turn : null
  const id = gameUiCall(ui, 'turnOf', [m], fallback)
  return typeof id === 'string' ? id : null
}

// Masa yöneticisinin onChange'i: sahne istenirliği değiştiyse yayın sahnesi yeniden düzenlenir, değişmediyse
// görünen masa yerinde güncellenir. Düğme her durumda yenilenir.
function gameOnDeskChange () {
  const before = gameState.model || gameEmptyModel()
  const m = gameState.desk.model()
  gameState.model = m
  // Kişi açmadan başlayan masa (gelen davet, Oyuna Dön teklifi) sahneyi açmaz
  if (before.stage === 'none' && m.stage !== 'none' && !gameState.acting) gameState.minimized = true
  if (before.stage !== m.stage) {
    gameState.confirm = null
    gameState.picker = null
  }
  gameStartNote(m)
  const turnId = m.stage === 'play' ? gameTurnId(m) : null
  if (turnId && turnId !== gameState.lastTurnId && turnId !== m.me) gameAnnounce(t('game.sr.next', { name: shownName(turnId) }), false)
  gameState.lastTurnId = turnId
  gameSyncTick(m)
  gameSyncActivity(m)
  const wanted = gameStageWanted()
  if (wanted !== gameState.wanted) {
    gameState.wanted = wanted
    if (typeof castSync === 'function') castSync()
  } else if (gameStageVisible() && typeof castRenderGame === 'function' && gameCastNodes()) {
    castRenderGame(gameCastNodes())
  }
  gameRenderTool()
  gameTurnFocus(m)
}

// "Oyun başladı" duyurusu elin olaylarından önce gelir: bildirimler onChange'den önce geldiği için önceki model
// (gameState.model) henüz lobidedir
function gameStartNote (m) {
  const before = gameState.model
  if (!before || before.stage !== 'lobby' || m.stage !== 'play' || gameState.startedRd === m.rd) return
  gameState.startedRd = m.rd
  gameAnnounce(t('game.sr.started'), false)
}

// Sıra gelince uygulama odağı ilk oynanabilir karta taşıyabilir (yazma alanındaki kişinin odağı alınmaz)
function gameTurnFocus (m) {
  if (!gameState.turnFocus) return
  gameState.turnFocus = false
  if (!gameStageVisible() || !gameCastNodes()) return
  const active = document.activeElement
  if (typeof isTypingTarget === 'function' && isTypingTarget(active)) return
  if (active && active !== document.body && !el.cast.contains(active)) return
  const box = gameState.body ? gameState.body.querySelector('.game-app') : null
  if (box) gameUiCall(gameUi(m.app), 'onTurn', [box, m], null)
}

// Bildirimler listesindeki davet kaydı yalnızca açılabilir davet varken kalır
function gameSyncActivity (m) {
  if (gameState.activityDealer === null) return
  const inv = m.invite
  const open = Boolean(inv) && inv.dealer === gameState.activityDealer &&
    (m.stage === 'invited' || m.stage === 'rejoin' || (m.stage === 'none' && !gameOfferBusy(inv, m.me)))
  if (open) return
  gameClearActivity()
}

function gameClearActivity () {
  gameState.activityDealer = null
  if (typeof activityClearGames === 'function') activityClearGames()
}

function gameEndedText (reason) {
  if (reason === 'left') return t('game.ended.left')
  return hasText('game.ended.' + reason) ? t('game.ended.' + reason) : t('game.ended.closed')
}

// Hata kodunun metni: masa yöneticisinin kendi kodları, sonra uygulamanın game.<oyun>.err.<kod> anahtarları
function gameErrorText (code, app) {
  if (!code) return ''
  if (code === 'send') return t('game.sendFailed')
  if (code === 'join_timeout') return t('game.joinTimeout')
  if (code === 'locked') return t('game.setupLocked')
  const ui = gameUi(app)
  const own = gameUiCall(ui, 'errorText', [code], '')
  if (own === false) return ''
  if (own) return String(own)
  return app && hasText('game.' + app + '.err.' + code) ? t('game.' + app + '.err.' + code) : ''
}

// Masa yöneticisinin bildirimleri (onChange'den önce gelir)
function gameOnNotice (kind, data) {
  const m = gameState.desk ? gameState.desk.model() : gameEmptyModel()
  gameStartNote(m)
  if (kind === 'invite' && data) {
    gameState.activityDealer = data.dealer
    if (typeof activityGame === 'function') activityGame(data.dealer, true, data.app)
    gameAnnounce(t('game.sr.invited', { name: shownName(data.dealer), game: gameAppName(data.app) }), false)
  } else if (kind === 'turn') {
    gameAnnounce(String(gameUiCall(gameUi(m.app), 'turnText', [m], t('game.sr.yourTurn'))), true)
    gameState.turnFocus = true
  } else if (kind === 'events' && Array.isArray(data)) {
    const ui = gameUi(m.app)
    const texts = data.map((ev) => String(gameUiCall(ui, 'eventText', [ev, m], ''))).filter(Boolean)
    if (texts.length) gameAnnounce(texts.join(' '), false)
  } else if (kind === 'joined' && data) {
    gameAnnounce(t('game.sr.joined', { name: shownName(data.id) }), false)
  } else if (kind === 'left' && data) {
    gameAnnounce(t('game.sr.left', { name: shownName(data.id) }), false)
  } else if (kind === 'declined' && data) {
    gameAnnounce(t('game.sr.declined', { name: shownName(data.id) }), false)
  } else if (kind === 'error') {
    const text = gameErrorText(data, m.app)
    if (!text) return
    gameAnnounce(text, false)
    if (!gameStageVisible()) toast(() => gameErrorText(data, m.app), 'error', 6000)
  } else if (kind === 'ended' && data) {
    gameOnEnded(data.reason)
  }
}

function gameOnEnded (reason) {
  if (reason === 'reset') {
    // Ses odasından çıkınca sahne sessizce kapanır
    gameClearActivity()
    if (typeof castState === 'undefined' || !castState.full) toast(() => t('game.ended.reset'), '', 6000)
    return
  }
  gameAnnounce(gameEndedText(reason), false)
  if (!gameStageVisible()) toast(() => gameEndedText(reason), '', 8000)
  // Küçültülmüş masa bitince bitiş ekranı beklemez: duyurulur ve kapanır
  if (gameState.minimized && gameState.desk && gameState.desk.model().stage === 'ended') gameState.desk.dismiss()
}

// ----- Duyurular -----

function gameAnnounce (text, assertive) {
  if (!text) return
  const q = gameState.announce
  if (assertive) q.assertive.push(String(text))
  else q.polite.push(String(text))
  if (!q.timer) q.timer = setTimeout(gameFlushAnnounce, GAME_ANNOUNCE_MS)
}

function gameFlushAnnounce () {
  const q = gameState.announce
  q.timer = 0
  const regions = gameLiveRegions()
  if (q.assertive.length) gameSpeak(regions.assertive, q.assertive.join(' '))
  if (q.polite.length) gameSpeak(regions.polite, q.polite.join(' '))
  q.assertive = []
  q.polite = []
}

// Aynı metin yeniden duyurulsun diye bölge önce boşaltılır
function gameSpeak (node, text) {
  if (!node) return
  if (node.textContent !== text) {
    node.textContent = text
    return
  }
  node.textContent = ''
  setTimeout(() => {
    node.textContent = text
  }, 100)
}

// Sahne oyun kipinde görünürken panelin canlı bölgeleri, değilse gövdedeki gizli #game-live
function gameLiveRegions () {
  const live = gameState.live
  if (gameStageVisible() && live && isConnected(live.polite)) return live
  let box = byId('game-live')
  if (!box) {
    box = h('div', 'sr-only game-live')
    box.id = 'game-live'
    box.appendChild(gameLiveNode(false))
    box.appendChild(gameLiveNode(true))
    document.body.appendChild(box)
  }
  return { polite: box.firstChild, assertive: box.lastChild }
}

function gameLiveNode (assertive) {
  const p = h('p', 'sr-only ' + (assertive ? 'game-live-assertive' : 'game-live-polite'))
  if (assertive) {
    p.setAttribute('aria-live', 'assertive')
  } else {
    p.setAttribute('role', 'status')
    p.setAttribute('aria-live', 'polite')
  }
  return p
}

// ----- Telsiz kartındaki Oyun düğmesi (6.2) -----

function gameStageVisible () {
  return Boolean(el.cast && !el.cast.hidden && el.cast.getAttribute('data-mode') === 'game')
}

// Yayın sahnesinin düğümleri (22-cast.js castBuildStage), sahne kurulmadıysa null
function gameCastNodes () {
  return typeof castState !== 'undefined' && castState.nodes ? castState.nodes : null
}

// Düğmenin durumu: null (gizli) veya { kind, label, aria, badge, expanded, disabled }
function gameToolState (s, m, visible) {
  if (!s || s.channelId === null || s.channelId === undefined || s.joining) return null
  if (s.private || (typeof inCallRoom === 'function' && inCallRoom(s))) return null
  if (!voice || typeof voice.sendGame !== 'function' || !gameAppIds().length) return null
  const inv = m.invite
  const out = (kind, label, aria, badge) => ({ kind: kind, label: label, aria: aria, badge: badge, expanded: kind === 'minimize', disabled: kind === 'busy' })
  if (m.stage !== 'none' && visible) return out('minimize', t('game.minimize'), t('game.minimizeLabel'), '')
  if (m.stage === 'busy' || (m.stage === 'none' && gameOfferBusy(inv, m.me))) return out('busy', t('game.toolBusy'), t('game.toolBusyLabel'), '')
  if (m.stage === 'invited' || m.stage === 'rejoin' || (m.stage === 'none' && inv)) {
    return out('invite', t('game.toolInvite'), t('game.toolInviteLabel', { name: shownName(inv.dealer), game: gameAppName(inv.app) }), '1')
  }
  if (m.stage === 'none') return out('tool', t('game.tool'), t('game.toolLabel'), '')
  if (m.legal && m.legal.turn) return out('turn', t('game.toolTurn'), t('game.toolTurn'), '!')
  return out('back', t('game.toolBack'), t('game.toolBack'), '')
}

function gameRenderTool () {
  const box = el.radioTools
  if (!box) return
  let b = byId('radio-game')
  const st = gameToolState(snap(), gameModel(), gameStageVisible())
  if (!st) {
    gameState.toolKey = ''
    if (b && b.parentNode) b.parentNode.removeChild(b)
    return
  }
  if (!b) {
    b = h('button', 'radio-tool game-tool')
    b.type = 'button'
    b.id = 'radio-game'
    b.setAttribute('data-focus-key', 'tool-game')
    b.setAttribute('aria-controls', 'cast')
    b.appendChild(icon('i-gamepad', 'radio-tool-icon'))
    b.appendChild(h('span', 'radio-tool-label'))
    b.appendChild(h('span', 'radio-tool-count'))
    b.addEventListener('click', gameToolClick)
    gameState.toolKey = ''
  }
  // Sıra: Büyüt başa (10-voice.js), Telsiz DJ sona (23-dj.js) kendini koyar, Oyun DJ'den hemen önce durur
  const dj = box.querySelector('.crew-dj')
  const placed = b.parentNode === box && (dj ? b.nextElementSibling === dj : b === box.lastElementChild)
  if (!placed) {
    const had = document.activeElement === b
    if (dj) box.insertBefore(b, dj)
    else box.appendChild(b)
    if (had) focusNode(b)
  }
  const key = [st.kind, st.label, st.aria, st.badge].join('|')
  if (key === gameState.toolKey) return
  gameState.toolKey = key
  b.setAttribute('data-state', st.kind)
  b.classList.toggle('is-invited', st.kind === 'invite')
  b.classList.toggle('is-busy', st.kind === 'busy')
  b.classList.toggle('is-turn', st.kind === 'turn')
  b.querySelector('.radio-tool-label').textContent = st.label
  b.setAttribute('aria-label', st.aria)
  b.title = st.aria
  b.setAttribute('aria-expanded', st.expanded ? 'true' : 'false')
  if (st.disabled) b.setAttribute('aria-disabled', 'true')
  else b.removeAttribute('aria-disabled')
  const count = b.querySelector('.radio-tool-count')
  count.textContent = st.badge
  count.hidden = !st.badge
}

function gameToolClick () {
  const st = gameToolState(snap(), gameModel(), gameStageVisible())
  if (!st) return
  if (st.kind === 'minimize') {
    if (typeof castMinimizeGame === 'function') castMinimizeGame()
    return
  }
  const m = gameModel()
  if (m.stage === 'none') {
    if (m.invite) gameCall('openInvite')
    else gameCall('openSetup', gameAppIds()[0])
    if (gameModel().stage === 'none') return
  }
  gameOpenStage(true)
}

// Bildirimler listesindeki Masaya Bak
function gameOpenInvite (dealerId) {
  if (!gameDesk()) return
  if (gameModel().stage === 'none') gameCall('openInvite')
  if (gameModel().stage === 'none') {
    gameClearActivity()
    return
  }
  gameOpenStage(true)
}

// 10-voice.js renderVoiceAll: kadro, anahtar veya profil değişti
function gameRender () {
  const desk = gameDesk()
  if (desk) {
    try {
      desk.recheck()
    } catch (err) {
      window.console.error(err)
    }
  }
  const s = snap()
  if (s.channelId === null || s.channelId === undefined || s.private) gameClearActivity()
  gameRenderTool()
}

// ----- Sahne kancaları (22-cast.js) -----

function gameStageWanted () {
  return gameModel().stage !== 'none' && !gameState.minimized
}

function gameOpenStage (focus) {
  gameState.minimized = false
  gameState.wanted = gameStageWanted()
  if (typeof castOpenGame === 'function') castOpenGame(Boolean(focus))
}

function gameSetMinimized (on) {
  gameState.minimized = Boolean(on)
  gameState.wanted = gameStageWanted()
}

// Sahne kapandı (castCloseStage): içerik temizlendi, yerel seçimler sıfırlanır
function gameStageClosed () {
  gameState.stageKey = ''
  gameState.body = null
  gameState.live = null
  gameState.confirm = null
  gameState.focusNext = null
  gameState.trustOpen = false
  gameState.picker = null
  Object.keys(gameState.uis).forEach((id) => {
    gameUiCall(gameState.uis[id], 'stageClosed', [], null)
  })
}

function gameStageTitle () {
  const m = gameModel()
  const name = gameAppName(m.app || (m.invite ? m.invite.app : null))
  if (m.stage === 'setup') return t('game.setupTitle')
  if (m.stage === 'play' || m.stage === 'over') return name
  return t('game.lobbyTitle', { game: name })
}

function gameDealerLine (m, dealer) {
  return m.me !== null && dealer === m.me ? t('game.dealerYou') : t('game.dealerLine', { name: shownName(dealer) })
}

function gameStageSub () {
  const m = gameModel()
  const ui = gameUi(m.app)
  if (m.stage === 'setup') return String(gameUiCall(ui, 'tagline', [], ''))
  if (m.stage === 'lobby' || m.stage === 'play' || m.stage === 'over') {
    const parts = [gameDealerLine(m, m.dealer), t('game.players', { count: m.seats.length })]
    if (m.stage !== 'lobby') parts.unshift(String(gameUiCall(ui, 'rulesLine', [m.rules], gameRulesLabel(ui, m.rules))))
    return parts.filter(Boolean).join(' · ')
  }
  const inv = m.invite
  if (inv && (m.stage === 'invited' || m.stage === 'rejoin' || m.stage === 'busy' || m.stage === 'joining')) {
    return [gameDealerLine(m, inv.dealer), t('game.players', { count: inv.seats.length })].join(' · ')
  }
  return ''
}

// Uygulama yerel bir seçimi (ör. renk seçici) değiştirince masayı yeniden çizdirir
function gameSetPicker (value) {
  gameState.picker = value === undefined || value === null ? null : String(value)
  gameRefreshStage()
}

function gameRefreshStage () {
  gameState.uiRev++
  const n = gameCastNodes()
  if (gameStageVisible() && n) gameRenderStage(n.game)
}

function gameFirstFocus () {
  const n = gameCastNodes()
  const box = n ? n.game : null
  if (!box) return null
  const byKey = (key) => Array.from(box.querySelectorAll('[data-focus-key]')).filter((node) => node.getAttribute('data-focus-key') === key && !node.closest('[hidden]'))[0] || null
  for (const key of GAME_FIRST_KEYS) {
    const found = byKey(key)
    if (found) return found
  }
  const app = gameState.body ? gameState.body.querySelector('.game-app') : null
  const own = app ? gameUiCall(gameUi(gameModel().app), 'firstFocus', [app], null) : null
  if (own) return own
  return focusables(box)[0] || n.gameMin || null
}

// ----- Sahnenin içi -----

function gameNamesKey (m) {
  const ids = m.seats.map((s) => s.id).concat(m.room.map((r) => r.id))
  if (m.invite) ids.push(m.invite.dealer)
  return ids.map((id) => id + '=' + shownName(id)).join(',')
}

function gameSharing () {
  const sc = typeof castScreen === 'function' ? castScreen(snap()) : null
  return Boolean(sc && sc.state === 'live')
}

function gameRenderStage (container) {
  if (!container) return
  const m = gameModel()
  const confirm = gameState.confirm ? gameState.confirm.kind + ':' + (gameState.confirm.id || '') : ''
  const lang = window.I18N ? window.I18N.lang : ''
  const key = [m.rev, lang, gameState.minimized ? 1 : 0, gameState.picker || '', confirm, gameState.trustOpen ? 1 : 0,
    isNarrow() ? 1 : 0, gameState.uiRev, gameSharing() ? 1 : 0, gameNamesKey(m)].join('|')
  if (key === gameState.stageKey && gameState.body && gameState.body.parentNode === container) return
  gameState.stageKey = key
  gameBindStage(container)
  const focusKey = gameState.focusNext || activeFocusKey(container)
  const hadFocus = Boolean(gameState.focusNext) || container.contains(document.activeElement)
  gameState.focusNext = null
  const body = h('div', 'game-body')
  body.setAttribute('data-stage', m.stage)
  body.setAttribute('data-role', m.role)
  gameFillStage(body, m)
  if (gameState.body && gameState.body.parentNode === container) container.replaceChild(body, gameState.body)
  else container.insertBefore(body, container.firstChild)
  gameState.body = body
  if (!hadFocus) return
  restoreFocusKey(container, focusKey)
  if (!container.contains(document.activeElement)) focusNode(gameFirstFocus())
}

// Kapsayıcı bir kez bağlanır: canlı bölgeler ve onay satırının Esc tuşu
function gameBindStage (container) {
  if (!gameState.live || gameState.live.polite.parentNode !== container) {
    const polite = gameLiveNode(false)
    const assertive = gameLiveNode(true)
    container.appendChild(polite)
    container.appendChild(assertive)
    gameState.live = { polite: polite, assertive: assertive }
  }
  if (container.gameBound) return
  container.gameBound = true
  container.addEventListener('keydown', (e) => {
    if ((e.key !== 'Escape' && e.key !== 'Esc') || !gameState.confirm) return
    e.preventDefault()
    gameCancelConfirm()
  })
}

function gameFillStage (body, m) {
  const ui = gameUi(m.app)
  if (m.error) body.appendChild(gameErrorLine(m))
  if (m.stage === 'setup') gameRenderSetup(body, m, ui)
  else if (m.stage === 'lobby') gameRenderLobby(body, m, ui)
  else if (m.stage === 'invited' || m.stage === 'rejoin' || m.stage === 'busy') gameRenderInvite(body, m, ui)
  else if (m.stage === 'joining') gameRenderJoining(body, m, ui)
  else if (m.stage === 'rejected') gameRenderNotice(body, t('game.reject.' + (m.rejected ? m.rejected.why : 'closed')))
  else if (m.stage === 'ended') gameRenderNotice(body, gameEndedText(m.ended ? m.ended.reason : 'closed'))
  else if (m.stage === 'play' || m.stage === 'over') gameRenderTable(body, m, ui)
}

// Küçük yapı taşları

function gameButton (className, text, iconName, focusKey, onClick) {
  const b = button(className, text, iconName)
  b.setAttribute('data-focus-key', focusKey)
  b.addEventListener('click', () => {
    if (b.getAttribute('aria-disabled') === 'true') return
    onClick()
  })
  return b
}

function gameSection (className, title, id) {
  const sec = h('section', 'game-section' + (className ? ' ' + className : ''))
  if (title) {
    const head = h('h3', 'game-h', title)
    if (id) {
      head.id = id
      sec.setAttribute('aria-labelledby', id)
    }
    sec.appendChild(head)
  }
  return sec
}

function gameActions () {
  return h('div', 'game-actions')
}

function gameChip (status) {
  return h('span', 'game-chip is-' + status, t('game.status.' + status))
}

function gamePerson (id, opts) {
  const o = opts || {}
  const li = h('li', 'game-person')
  li.setAttribute('data-user-id', id)
  li.appendChild(avatar(id, 'sm', 'game-person-avatar'))
  const text = h('span', 'game-person-text')
  const name = h('span', 'game-person-name', shownName(id))
  if (o.dealer) name.appendChild(icon('i-crown', 'game-crown'))
  text.appendChild(name)
  if (o.reason) text.appendChild(h('span', 'game-person-reason', o.reason))
  li.appendChild(text)
  if (o.chip) li.appendChild(gameChip(o.chip))
  if (o.extra) li.appendChild(o.extra)
  return li
}

function gameNote (className, iconName, text) {
  const p = h('p', 'game-note' + (className ? ' ' + className : ''))
  if (iconName) p.appendChild(icon(iconName, 'game-note-icon'))
  p.appendChild(h('span', 'game-note-text', text))
  return p
}

function gameErrorLine (m) {
  const text = gameErrorText(m.error, m.app)
  const p = gameNote('game-error', 'i-alert', text)
  p.hidden = !text
  return p
}

function gameTrustText (m, dealer) {
  return m.me !== null && dealer === m.me ? t('game.trustDealer') : t('game.trustPlayer', { name: shownName(dealer) })
}

function gameTrustNote (m, dealer) {
  return gameNote('game-trust', 'i-eye', gameTrustText(m, dealer))
}

// Kural seti: kurpiyerde seçim grubu (Masa Kur ve lobi), oyuncuda yalnızca ad ve açıklama
function gameRulesBlock (m, ui, rules, editable) {
  const sec = gameSection('game-rules-block', t('game.rulesTitle'), 'game-rules-title')
  const engine = gameApp(m.app)
  const list = engine ? engine.RULES : [rules]
  if (editable && typeof castChoiceGroup === 'function') {
    const options = list.map((id) => ({ value: id, label: gameRulesLabel(ui, id), hint: gameRulesHint(ui, id) }))
    const group = castChoiceGroup('cast-choices game-rules', 'game-rules-title', options, rules, (value) => {
      if (value !== rules) gameCall('setRules', value)
    }, 'cast-choice')
    Array.from(group.children).forEach((b) => {
      b.setAttribute('data-focus-key', 'game-rule-' + b.getAttribute('data-value'))
    })
    sec.appendChild(group)
    return sec
  }
  sec.appendChild(h('p', 'game-rules-name', gameRulesLabel(ui, rules)))
  const hint = gameRulesHint(ui, rules)
  if (hint) sec.appendChild(h('p', 'game-rules-hint', hint))
  return sec
}

// Odadakiler (yalnız kurpiyerde): kişi, durum çipi ve anahtar sorununun nedeni
function gameRoomBlock (entries) {
  if (!entries.length) return null
  const sec = gameSection('game-room', t('game.roomTitle'), 'game-room-title')
  const list = h('ul', 'game-people')
  entries.forEach((e) => {
    const reason = e.status === 'keys' && e.key ? t('game.reason.' + e.key, { name: shownName(e.id) }) : ''
    list.appendChild(gamePerson(e.id, { chip: e.status, reason: reason }))
  })
  sec.appendChild(list)
  return sec
}

function gameSeatChip (seat, index) {
  if (index === 0) return 'dealer'
  if (seat.keyIssue) return 'keys'
  if (seat.offline) return 'offline'
  return seat.away ? 'away' : 'joined'
}

// Oyuncular: kurpiyer her koltuğun durumunu görür ve diğerlerini çıkarabilir, oyuncu yalnızca adları görür
function gameSeatsBlock (m, ids, dealerView) {
  const sec = gameSection('game-seats', t('game.seatsTitle'), 'game-seats-title')
  const list = h('ul', 'game-people')
  ids.forEach((id, i) => {
    const seat = m.seats[i] && m.seats[i].id === id ? m.seats[i] : { id: id, away: false, offline: false, keyIssue: null }
    let extra = null
    if (dealerView && i > 0) {
      extra = gameButton('button button-small button-danger game-remove', t('game.removeSeat'), null, 'game-remove-' + id, () => {
        if (m.stage === 'play') gameAsk('remove', id, 'game-remove-' + id)
        else gameCall('removeSeat', id)
      })
    }
    const reason = dealerView && seat.keyIssue ? t('game.reason.' + seat.keyIssue, { name: shownName(id) }) : ''
    list.appendChild(gamePerson(id, { dealer: i === 0, chip: dealerView ? gameSeatChip(seat, i) : null, reason: reason, extra: extra }))
  })
  sec.appendChild(list)
  return sec
}

function gameEnsureProfiles (ids) {
  if (typeof profilesEnsure === 'function' && ids.length) profilesEnsure(ids)
}

// Masa Kur (kurpiyer, yerel)
function gameRenderSetup (body, m, ui) {
  const intro = h('div', 'game-intro')
  intro.appendChild(h('p', 'game-intro-name', gameAppName(m.app)))
  const tagline = String(gameUiCall(ui, 'tagline', [], ''))
  if (tagline) intro.appendChild(h('p', 'game-intro-text', tagline))
  body.appendChild(intro)
  body.appendChild(gameRulesBlock(m, ui, m.rules, true))
  gameEnsureProfiles(m.room.map((r) => r.id))
  const room = gameRoomBlock(m.room)
  if (room) body.appendChild(room)
  body.appendChild(gameTrustNote(m, m.me))
  if (m.locked) body.appendChild(gameNote('game-locked', 'i-lock', t('game.setupLocked')))
  const actions = gameActions()
  actions.appendChild(gameButton('button button-secondary', t('common.cancel'), null, 'game-setup-cancel', () => {
    gameCall('cancelSetup')
  }))
  const open = gameButton('button game-primary', t('game.openTable'), 'i-gamepad', 'game-open', () => {
    gameCall('openTable', gameModel().rules)
  })
  if (m.locked) open.setAttribute('aria-disabled', 'true')
  actions.appendChild(open)
  body.appendChild(actions)
}

// Lobi: kurpiyerde kural seçimi, koltuklar, odadakiler, Masayı Kapat ve Başlat. Oyuncuda bekleme ve Masadan Ayrıl.
function gameRenderLobby (body, m, ui) {
  const dealerView = m.role === 'dealer'
  const ids = m.seats.map((s) => s.id)
  gameEnsureProfiles(ids)
  body.appendChild(gameRulesBlock(m, ui, m.rules, dealerView))
  body.appendChild(gameSeatsBlock(m, ids, dealerView))
  if (dealerView) {
    const room = gameRoomBlock(m.room.filter((r) => ids.indexOf(r.id) < 0))
    if (room) body.appendChild(room)
  }
  body.appendChild(gameTrustNote(m, m.dealer))
  if (!dealerView) body.appendChild(gameNote('game-wait', null, t('game.waitingStart')))
  else if (m.seats.length < m.min) body.appendChild(gameNote('game-hint', null, t('game.startHint')))
  if (gameState.confirm) {
    body.appendChild(gameConfirmRow())
    return
  }
  const actions = gameActions()
  if (dealerView) {
    actions.appendChild(gameButton('button button-danger', t('game.closeTable'), null, 'game-close-table', () => {
      gameAsk('close', null, 'game-close-table')
    }))
    const start = gameButton('button game-primary', t('game.start'), 'i-play', 'game-start', () => {
      gameCall('start')
    })
    if (m.seats.length < m.min || m.seats.length > m.max) start.setAttribute('aria-disabled', 'true')
    actions.appendChild(start)
  } else {
    actions.appendChild(gameButton('button button-danger', t('game.leave'), null, 'game-leave', gameLeave))
  }
  body.appendChild(actions)
}

// Davet tarafındaki anahtar sorunu: kendi cihazımın kurpiyer için gördüğü ya da kurpiyerin benim için gördüğü
function gameInviteProblem (m) {
  const inv = m.invite
  if (!inv) return ''
  if (inv.myKey && inv.myKey !== 'loading') return t('game.reason.' + inv.myKey, { name: shownName(inv.dealer) })
  if (inv.key && inv.key !== 'loading') return t('game.reason.peer_' + inv.key)
  return ''
}

// Davet, Oyuna Dön ve Oyun Sürüyor (oyuncu)
function gameRenderInvite (body, m, ui) {
  const inv = m.invite
  if (!inv) return
  const name = shownName(inv.dealer)
  gameEnsureProfiles([inv.dealer].concat(inv.seats))
  const lead = m.stage === 'rejoin' ? t('game.rejoinText') : m.stage === 'busy' ? t('game.toolBusyLabel') : t('game.inviteText', { name: name, game: gameAppName(inv.app) })
  body.appendChild(h('p', 'game-lead', lead))
  body.appendChild(gameRulesBlock(m, ui, inv.rules, false))
  if (inv.seats.length) body.appendChild(gameSeatsBlock(m, inv.seats, false))
  const problem = m.stage === 'busy' ? '' : gameInviteProblem(m)
  const actions = gameActions()
  if (problem) {
    body.appendChild(gameNote('game-alert', 'i-alert', problem))
    // Anahtar sorunu kurpiyerin lobi çipine join() ile bir kez bildirilir (4.7), ardından sahne kapanır
    actions.appendChild(gameButton('button button-secondary', t('common.close'), null, 'game-dismiss', () => {
      if (m.stage === 'invited') gameCall('join')
      gameMinimize()
    }))
    body.appendChild(actions)
    return
  }
  if (inv.myKey === 'loading') body.appendChild(gameNote('game-hint', null, t('game.reason.loading')))
  body.appendChild(gameTrustNote(m, inv.dealer))
  if (m.stage === 'busy') {
    actions.appendChild(gameButton('button button-secondary', t('common.close'), null, 'game-dismiss', gameDecline))
  } else if (m.stage === 'rejoin') {
    actions.appendChild(gameButton('button button-secondary', t('common.close'), null, 'game-dismiss', gameDecline))
    actions.appendChild(gameButton('button game-primary', t('game.rejoin'), 'i-play', 'game-rejoin', gameJoin))
  } else {
    actions.appendChild(gameButton('button button-secondary', t('game.decline'), null, 'game-decline', gameDecline))
    actions.appendChild(gameButton('button game-primary', t('game.join'), 'i-check', 'game-join', gameJoin))
  }
  body.appendChild(actions)
}

function gameRenderJoining (body, m, ui) {
  const inv = m.invite
  if (inv) body.appendChild(h('p', 'game-lead', t('game.inviteText', { name: shownName(inv.dealer), game: gameAppName(inv.app) })))
  body.appendChild(gameNote('game-wait', null, t('game.waitingStart')))
  const actions = gameActions()
  actions.appendChild(gameButton('button button-danger', t('game.leave'), null, 'game-leave', gameLeave))
  body.appendChild(actions)
}

// Ret ve bitiş: metin ve Kapat
function gameRenderNotice (body, text) {
  body.appendChild(gameNote('game-lead game-ended', 'i-alert', text))
  const actions = gameActions()
  actions.appendChild(gameButton('button game-primary', t('common.close'), null, 'game-dismiss', gameDismiss))
  body.appendChild(actions)
}

// Oyun ve sonuç: durum satırı, uygulamanın masası, sonuçlar ve alt satır
function gameRenderTable (body, m, ui) {
  if (m.stage === 'play') body.appendChild(gameStatusRow(m, ui))
  const app = h('div', 'game-app')
  body.appendChild(app)
  if (ui) {
    try {
      ui.render(app, m)
    } catch (err) {
      window.console.error(err)
    }
  }
  if (m.stage === 'over') body.appendChild(gameResultsBlock(m, ui))
  body.appendChild(gameFoot(m, ui))
}

function gameStatusRow (m, ui) {
  const row = h('div', 'game-status')
  const turnId = gameTurnId(m)
  if (m.legal && m.legal.turn) row.appendChild(h('span', 'game-status-turn is-me', t('game.turnYou')))
  else if (turnId) row.appendChild(h('span', 'game-status-turn', t('game.upNext', { name: shownName(turnId) })))
  const parts = gameUiCall(ui, 'statusParts', [m], [])
  if (Array.isArray(parts)) {
    parts.filter(Boolean).forEach((text) => {
      row.appendChild(h('span', 'game-status-chip', String(text)))
    })
  }
  if (gameSharing()) row.appendChild(gameNote('game-share-warn', 'i-screen', t('game.shareWarn')))
  const sync = m.slow ? t('game.sendSlow') : m.pending ? t('game.sending') : m.syncing ? t('game.syncing') : ''
  if (sync) {
    const strip = h('span', 'game-sync' + (m.slow ? ' is-slow' : ''))
    strip.appendChild(h('span', 'game-sync-dot'))
    strip.appendChild(h('span', 'game-sync-text', sync))
    row.appendChild(strip)
  }
  return row
}

function gameResultsBlock (m, ui) {
  const sec = gameSection('game-results', t('game.resultsTitle'), 'game-results-title')
  const fallback = m.view && m.view.result ? m.view.result : null
  const res = gameUiCall(ui, 'results', [m], fallback)
  if (!res || !Array.isArray(res.ranks)) return sec
  if (res.winner) {
    sec.appendChild(h('p', 'game-winner', t('game.resultWinner', { name: shownName(res.winner), points: t('game.points', { count: Number(res.total) || 0 }) })))
  } else {
    sec.appendChild(h('p', 'game-winner is-none', t('game.resultNone')))
    if (res.reason === 'too_few' || res.reason === 'ended') sec.appendChild(h('p', 'game-results-reason', t('game.resultReason.' + res.reason)))
  }
  const list = h('ol', 'game-results-list')
  res.ranks.forEach((r) => {
    const cards = t('game.cards', { count: Number(r.n) || 0 })
    const points = t('game.points', { count: Number(r.points) || 0 })
    const li = h('li', 'game-result' + (r.id === res.winner ? ' is-winner' : ''))
    li.setAttribute('aria-label', t('game.resultLabel', { rank: String(r.rank), name: shownName(r.id), cards: cards, points: points }))
    const rank = h('span', 'game-result-rank', String(r.rank))
    rank.setAttribute('aria-hidden', 'true')
    li.appendChild(rank)
    li.appendChild(avatar(r.id, 'sm', 'game-person-avatar'))
    const name = h('span', 'game-result-name', shownName(r.id))
    name.setAttribute('aria-hidden', 'true')
    li.appendChild(name)
    const meta = h('span', 'game-result-meta', cards + ' · ' + points)
    meta.setAttribute('aria-hidden', 'true')
    li.appendChild(meta)
    list.appendChild(li)
  })
  sec.appendChild(list)
  return sec
}

// Alt satır: güven çipi ve Ayrıntı, ardından ayrılma ve bitirme düğmeleri (onay satırıyla)
function gameFoot (m, ui) {
  const foot = h('div', 'game-foot')
  const trust = h('div', 'game-trust-row')
  const chip = h('span', 'game-trust-chip')
  chip.appendChild(icon('i-eye'))
  chip.appendChild(h('span', '', t('game.trustChip')))
  trust.appendChild(chip)
  const more = gameButton('button button-small button-ghost game-trust-more', t(gameState.trustOpen ? 'game.trustLess' : 'game.trustMore'), null, 'game-trust-more', () => {
    gameState.trustOpen = !gameState.trustOpen
    gameState.focusNext = 'game-trust-more'
    gameRefreshStage()
  })
  more.setAttribute('aria-expanded', gameState.trustOpen ? 'true' : 'false')
  more.setAttribute('aria-controls', 'game-trust-detail')
  trust.appendChild(more)
  foot.appendChild(trust)
  const detail = h('div', 'game-trust-detail')
  detail.id = 'game-trust-detail'
  detail.hidden = !gameState.trustOpen
  detail.appendChild(h('p', 'game-trust-text', gameTrustText(m, m.dealer)))
  const notes = gameUiCall(ui, 'notes', [m], [])
  if (Array.isArray(notes)) {
    notes.filter(Boolean).forEach((text) => {
      detail.appendChild(h('p', 'game-trust-text', String(text)))
    })
  }
  foot.appendChild(detail)
  if (m.stage === 'over' && m.role !== 'dealer') foot.appendChild(gameNote('game-wait', null, t('game.waitNewRound')))
  if (gameState.confirm) {
    foot.appendChild(gameConfirmRow())
    return foot
  }
  const actions = gameActions()
  if (m.role === 'dealer') {
    if (m.stage === 'play') {
      actions.appendChild(gameButton('button button-danger', t('game.endGame'), null, 'game-end', () => {
        gameAsk('end', null, 'game-end')
      }))
    }
    actions.appendChild(gameButton('button button-danger', t('game.closeTable'), null, 'game-close-table', () => {
      gameAsk('close', null, 'game-close-table')
    }))
    if (m.stage === 'over') {
      actions.appendChild(gameButton('button game-primary', t('game.newRound'), 'i-play', 'game-new-round', () => {
        gameCall('newRound')
      }))
    }
  } else {
    actions.appendChild(gameButton('button button-danger', t('game.leave'), null, 'game-leave', gameLeave))
  }
  foot.appendChild(actions)
  return foot
}

// ----- Onay satırı (window.confirm yerine, panelin içinde) -----

function gameAsk (kind, id, from) {
  gameState.confirm = { kind: kind, id: id || null, from: from || null }
  gameState.focusNext = 'game-confirm-no'
  gameRefreshStage()
}

function gameCancelConfirm () {
  const c = gameState.confirm
  if (!c) return
  gameState.confirm = null
  gameState.focusNext = c.from
  gameRefreshStage()
}

function gameConfirmYes () {
  const c = gameState.confirm
  if (!c) return
  gameState.confirm = null
  gameState.uiRev++
  if (c.kind === 'leave') gameLeaveNow()
  else if (c.kind === 'end') gameCall('endGame')
  else if (c.kind === 'close') gameCall('closeTable')
  else if (c.kind === 'remove') gameCall('removeSeat', c.id)
  gameRefreshStage()
}

function gameConfirmRow () {
  const c = gameState.confirm
  const row = h('div', 'game-confirm')
  row.setAttribute('role', 'group')
  row.setAttribute('aria-labelledby', 'game-confirm-text')
  let text = t('game.closeAsk')
  let label = t('game.confirmClose')
  if (c.kind === 'leave') {
    text = t('game.leaveAsk')
    label = t('game.confirmLeave')
  } else if (c.kind === 'end') {
    text = t('game.endAsk')
    label = t('game.confirmEnd')
  } else if (c.kind === 'remove') {
    text = t('game.removeAsk', { name: shownName(c.id) })
    label = t('game.confirmRemove')
  }
  const p = h('p', 'game-confirm-text', text)
  p.id = 'game-confirm-text'
  row.appendChild(p)
  const actions = gameActions()
  actions.appendChild(gameButton('button button-secondary', t('game.confirmStay'), null, 'game-confirm-no', gameCancelConfirm))
  actions.appendChild(gameButton('button button-danger', label, null, 'game-confirm-yes', gameConfirmYes))
  row.appendChild(actions)
  return row
}

// ----- Kişinin işlemleri -----

// Katıl: Bildirimler listesindeki kayıt aşama katılıma geçince kalkar (gameSyncActivity)
function gameJoin () {
  gameCall('join')
}

// Reddet (lobi), Kapat (Oyuna Dön ve Oyun Sürüyor): saklı davet kalır, düğmeden yeniden açılabilir
function gameDecline () {
  gameCall('decline')
  gameAfterClose()
}

function gameDismiss () {
  gameCall('dismiss')
  gameAfterClose()
}

function gameLeave () {
  if (gameModel().stage === 'play') gameAsk('leave', null, 'game-leave')
  else gameLeaveNow()
}

function gameLeaveNow () {
  if (gameCall('leave')) toast(() => t('game.ended.left'), '', 4000)
  gameAfterClose()
}

function gameMinimize () {
  if (typeof castMinimizeGame === 'function') castMinimizeGame()
  else gameSetMinimized(true)
}

// Masa kapandıysa sahne de kapanmıştır (onChange), odak Oyun düğmesine gider
function gameAfterClose () {
  if (gameModel().stage !== 'none') return
  const tool = byId('radio-game')
  if (tool && !tool.closest('[hidden]') && tool.getClientRects().length) focusNode(tool)
}
