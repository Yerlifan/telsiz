'use strict'

// Renk masası: yayın sahnesinin game kipinde 36-oyun.js'in açtığı .game-app kutusunun içi. Rakip şeridi, deste,
// atılan kart, aktif renk, eylem satırı (Renk Seç, Pas Geç, Tek!, Yakala), el ve Joker renk seçici. Yüklenirken
// gameUiRegister('renk', ...) ile kaydolur, kural motoru (35-renk-kural.js, window.TelsizRenk) çalışma anında okunur.
//
// Kurallar:
// - Hamleler gameCall('act', hamle) ile masa yöneticisine gider. Oynanabilirlik yalnızca modelin legal alanından
//   (motorun legalMoves ve canPlay sonucu) okunur, bu dosya kural yazmaz.
// - Kurpiyerin ekranında başkalarının elleri çizilmez (model bunları içermez), başkasının çektiği kart okunmaz.
// - Renk körlüğü: her rengin bir şekli (daire, üçgen, kare, karo) ve dile göre bir harfi vardır, ad da yazılır.
// - Yerel seçimler (renk seçici, Tek! işareti, oynanamayan kart notu) değişince gameRefreshStage ile masa yeniden
//   çizilir, odak data-focus-key ile korunur. Renk seçici panelin içindeki bir openLayer katmanıdır: Esc ve kolun
//   daire düğmesi yalnızca seçiciyi kapatır, kart oynanmaz. Seçicinin durumu 36-oyun.js gameState.picker içindedir.
// - Elde ve eylem satırında Sol ve Sağ ok komşuya, Home ve End uçlara gider, Yukarı ok elden Deste'ye, Aşağı ok
//   Deste'den ve eylem satırından ele iner. Kısayol tuşu yoktur (bas konuş atamalarıyla çakışmasın).

const RENK_COLORS = ['R', 'Y', 'G', 'B']
const RENK_SUITS = { R: 'i-suit-circle', Y: 'i-suit-triangle', G: 'i-suit-square', B: 'i-suit-diamond' }
// El sıralaması: önce renk (Joker sonda), sonra değer
const RENK_COLOR_ORDER = 'RYGBW'
const RENK_VALUE_ORDER = '0123456789SVDWF'
const RENK_CARD_RE = /^(?:[RYGB][0-9SVD]|W[WF])$/
// Panelde kısa metinle gösterilen hata kodları, diğerleri sessizdir (gelen yeni durum arayüzü düzeltir)
const RENK_SHOWN_ERRORS = ['choose_color', 'only_drawn', 'must_stack', 'not_playable', 'wild4_has_color', 'not_catchable',
  'bad_options', 'bad_random', 'no_random']
const RENK_NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Left', 'Right', 'Up', 'Down', 'Home', 'End']

const renkState = {
  layer: null,
  pickerEl: null,
  arm: null,
  note: null,
  hand: null,
  fresh: null,
  afterPlay: null,
  drawFocus: null
}

// ----- Metinler -----

function renkIsCard (code) {
  return typeof code === 'string' && RENK_CARD_RE.test(code)
}

function renkColorName (c) {
  return RENK_COLORS.indexOf(c) >= 0 ? t('game.renk.color.' + c) : t('game.renk.colorNone')
}

function renkLetter (c) {
  return RENK_COLORS.indexOf(c) >= 0 ? t('game.renk.letter.' + c) : ''
}

// Kartın adı: 'Kırmızı 7', 'Mavi Engel', 'Joker +4'
function renkCardLabel (code) {
  if (!renkIsCard(code)) return ''
  if (code === 'WW' || code === 'WF') return t('game.renk.card.' + code)
  const color = renkColorName(code.charAt(0))
  const v = code.charAt(1)
  if (v === 'S' || v === 'V' || v === 'D') return t('game.renk.card.' + v, { color: color })
  return t('game.renk.card.num', { color: color, number: v })
}

// Joker oynandıysa seçilen renkle birlikte: 'Joker, Mavi seçildi'
function renkPlayedLabel (code, color) {
  const card = renkCardLabel(code)
  if (!card || code.charAt(0) !== 'W' || RENK_COLORS.indexOf(color) < 0) return card
  return t('game.renk.card.chosen', { card: card, color: renkColorName(color) })
}

function renkDirText (dir) {
  return dir === -1 ? t('game.renk.dir.ccw') : t('game.renk.dir.cw')
}

function renkEventText (ev) {
  if (!ev || typeof ev.e !== 'string') return ''
  const name = (id) => shownName(id)
  const count = Number(ev.n) || 0
  if (ev.e === 'play') return t('game.renk.ev.play', { name: name(ev.p), card: renkPlayedLabel(ev.c, ev.col) })
  if (ev.e === 'draw') return t('game.renk.ev.draw', { name: name(ev.p), count: count })
  if (ev.e === 'nodraw' || ev.e === 'pass' || ev.e === 'skip' || ev.e === 'last' || ev.e === 'caught') {
    return t('game.renk.ev.' + ev.e, { name: name(ev.p) })
  }
  if (ev.e === 'color') return t('game.renk.ev.color', { name: name(ev.p), color: renkColorName(ev.col) })
  if (ev.e === 'reverse') return t('game.renk.ev.reverse', { dir: renkDirText(ev.dir) })
  // Yakalanan oyuncunun cezası caught cümlesinde söylenir
  if (ev.e === 'penalty') return ev.why === 'last' ? '' : t('game.renk.ev.penalty', { name: name(ev.p), count: count })
  if (ev.e === 'reshuffle' || ev.e === 'reflip') return t('game.renk.ev.' + ev.e)
  if (ev.e === 'leave') return t('game.renk.ev.leave', { name: name(ev.p), count: count })
  if (ev.e === 'pending_dropped') return t('game.renk.ev.pending_dropped', { count: count })
  if (ev.e === 'end') return ev.winner ? t('game.renk.ev.end', { name: name(ev.winner) }) : ''
  return ''
}

function renkTurnText (m) {
  const legal = m.legal
  const view = m.view
  if (!legal || !view) return t('game.sr.yourTurn')
  if (legal.color) return t('game.renk.sr.chooseColor')
  if (view.pending && legal.take) return t('game.renk.sr.mustTake', { count: legal.take })
  const cards = m.mine && Array.isArray(m.mine.cards) ? m.mine.cards : []
  const count = cards.filter((c) => legal.play.indexOf(c) >= 0).length
  if (!count) return t('game.renk.sr.yourTurnNone')
  return t('game.renk.sr.yourTurn', { card: renkPlayedLabel(view.top, view.color), count: count })
}

function renkErrorText (code) {
  return RENK_SHOWN_ERRORS.indexOf(code) >= 0 ? t('game.renk.err.' + code) : false
}

// ----- Yardımcılar -----

function renkSortKey (c) {
  return RENK_COLOR_ORDER.indexOf(c.charAt(0)) * 100 + RENK_VALUE_ORDER.indexOf(c.charAt(1))
}

function renkSorted (cards) {
  return cards.filter(renkIsCard).sort((a, b) => renkSortKey(a) - renkSortKey(b))
}

function renkCardKey (code, k) {
  return 'game-card-' + code + '-' + k
}

// Sıralı eldeki her kartın odak anahtarı: aynı koddan iki kart olabilir, k o kodun kaçıncı kopyası olduğudur
function renkHandKeys (sorted) {
  const seen = {}
  return sorted.map((c) => {
    const k = seen[c] || 0
    seen[c] = k + 1
    return renkCardKey(c, k)
  })
}

// Oynanan kartın yerine odaklanacak kart: sağdaki komşu (aynı koddansa oynananın anahtarını alır), yoksa soldaki
function renkAfterPlayKey (cards, key) {
  const sorted = renkSorted(cards)
  const keys = renkHandKeys(sorted)
  const i = keys.indexOf(key)
  if (i < 0) return null
  if (i + 1 < sorted.length) return sorted[i + 1] === sorted[i] ? keys[i] : keys[i + 1]
  return i > 0 ? keys[i - 1] : 'game-draw'
}

function renkByKey (root, key) {
  if (!root || !key) return null
  return Array.from(root.querySelectorAll('[data-focus-key]')).filter((node) => node.getAttribute('data-focus-key') === key)[0] || null
}

function renkEnabled (node) {
  return Boolean(node) && node.getAttribute('aria-disabled') !== 'true'
}

// Sıra gelince ve masa açılınca ilk anlamlı denetim: oynanabilir kart, Renk Seç, Deste
function renkTurnTarget (box) {
  const playable = Array.from(box.querySelectorAll('.renk-hand .renk-card')).filter((c) => c.classList.contains('is-playable') && renkEnabled(c))[0]
  if (playable) return playable
  const choose = renkByKey(box, 'game-choose-color')
  if (renkEnabled(choose)) return choose
  const deck = renkByKey(box, 'game-draw')
  if (renkEnabled(deck)) return deck
  return box.querySelector('.renk-hand .renk-card') || deck
}

function renkFirstFocus (box) {
  const after = renkState.afterPlay
  renkState.afterPlay = null
  const m = gameModel()
  if (after && m.view && after.rd === m.rd && m.view.step === after.step + 1) {
    const node = renkByKey(box, after.key)
    if (node) return node
  }
  return renkTurnTarget(box)
}

function renkOnTurn (box) {
  const target = renkTurnTarget(box)
  if (target) focusNode(target)
}

function renkArmed (m) {
  const a = renkState.arm
  return Boolean(a && m.view && m.legal && m.legal.armLast && a.rd === m.rd && a.step === m.view.step)
}

// ----- Hamleler -----

function renkCanAct (m) {
  return m.stage === 'play' && Boolean(m.view) && Boolean(m.legal) && !m.pending
}

function renkAct (move) {
  renkState.note = null
  return gameCall('act', move)
}

function renkSendPlay (m, code, key, col) {
  const move = { t: 'play', c: code, step: m.view.step }
  if (col) move.col = col
  if (renkArmed(m) && m.mine.cards.length === 2) move.last = true
  renkState.arm = null
  const next = renkAfterPlayKey(m.mine.cards, key)
  renkState.afterPlay = next ? { key: next, rd: m.rd, step: m.view.step } : null
  renkAct(move)
}

function renkCardClick (code, k) {
  const m = gameModel()
  if (!renkCanAct(m) || !m.legal.turn) return
  const key = renkCardKey(code, k)
  if (m.legal.play.indexOf(code) < 0) {
    renkShowBlocked(m, code, key)
    return
  }
  if (code.charAt(0) === 'W' && m.mine.cards.length > 1) {
    renkOpenPicker('play:' + code + ':' + key, key)
    return
  }
  renkSendPlay(m, code, key, null)
}

// Oynanamayan karta basınca nedeni kısa bir notla gösterilir ve duyurulur
function renkShowBlocked (m, code, key) {
  const why = m.legal.blocked ? m.legal.blocked[code] : null
  if (!why || !hasText('game.renk.err.' + why)) return
  renkState.note = { why: why, rd: m.rd, step: m.view.step }
  gameAnnounce(t('game.renk.err.' + why), false)
  gameState.focusNext = key
  gameRefreshStage()
}

function renkDraw () {
  const m = gameModel()
  if (!renkCanAct(m) || !m.legal.turn || !m.legal.draw) return
  renkState.drawFocus = { rd: m.rd, step: m.view.step }
  renkAct({ t: 'draw', step: m.view.step })
}

function renkPass () {
  const m = gameModel()
  if (!renkCanAct(m) || !m.legal.turn || !m.legal.pass) return
  renkAct({ t: 'pass', step: m.view.step })
}

// Tek!: geç bildirim hemen gider, sıra bendeyken ve iki kartım varken bir sonraki kartla birlikte gitmek üzere işaretlenir
function renkLastClick () {
  const m = gameModel()
  if (!renkCanAct(m)) return
  if (m.legal.last) {
    renkAct({ t: 'last' })
    return
  }
  if (!m.legal.armLast) return
  renkState.arm = renkArmed(m) ? null : { rd: m.rd, step: m.view.step }
  gameState.focusNext = 'game-last'
  gameRefreshStage()
}

function renkCatch () {
  const m = gameModel()
  if (!renkCanAct(m) || !m.legal.catch) return
  renkAct({ t: 'catch', p: m.legal.catch })
}

// ----- Renk seçici -----

// gameState.picker: 'color' (ilk kart Joker) veya 'play:<kod>:<kartın odak anahtarı>'. Geçersizse null.
function renkPicker (m) {
  const raw = gameState.picker
  if (!raw || !renkCanAct(m) || !m.legal.turn) return null
  if (raw === 'color') return m.legal.color ? { kind: 'color', code: null, key: 'game-choose-color' } : null
  const parts = String(raw).split(':')
  const code = parts[1]
  if (parts[0] !== 'play' || !renkIsCard(code) || code.charAt(0) !== 'W' || m.legal.play.indexOf(code) < 0) return null
  return { kind: 'play', code: code, key: parts[2] || '' }
}

function renkOpenPicker (value, triggerKey) {
  if (renkState.layer) return
  gameState.focusNext = 'game-color-' + RENK_COLORS[0]
  gameSetPicker(value)
  const node = renkState.pickerEl
  if (!node || !isConnected(node)) {
    gameSetPicker(null)
    return
  }
  const n = gameCastNodes()
  const layer = {
    name: 'game-color',
    el: node,
    trigger: renkByKey(n ? n.game : document, triggerKey),
    level: 2,
    trap: true,
    outside: true,
    closeOnFocusOut: true,
    initialFocus: () => (renkState.pickerEl ? renkState.pickerEl.querySelector('.renk-pick') : null),
    onClose: () => renkPickerClosed(layer, triggerKey)
  }
  renkState.layer = layer
  openLayer(layer)
}

// Katman Esc, kolun daire düğmesi, İptal, dışarı tıklama veya odağın dışarı çıkmasıyla kapandı
function renkPickerClosed (layer, triggerKey) {
  if (renkState.layer !== layer) return
  const active = document.activeElement
  const inside = !active || active === document.body || layer.el.contains(active)
  renkState.layer = null
  renkState.pickerEl = null
  if (!gameState.picker) return
  if (inside) gameState.focusNext = triggerKey
  gameSetPicker(null)
}

// Seçimden sonra veya seçici geçersizleşince: katman odağı geri vermeden kapanır
function renkDropPicker () {
  const layer = renkState.layer
  renkState.layer = null
  renkState.pickerEl = null
  gameState.picker = null
  if (layer) closeLayer(layer, false)
}

function renkCancelPicker () {
  const layer = renkState.layer
  if (layer) {
    closeLayer(layer, true)
    return
  }
  gameSetPicker(null)
}

function renkChoose (col) {
  const m = gameModel()
  const pick = renkPicker(m)
  renkDropPicker()
  gameState.uiRev++
  if (pick && RENK_COLORS.indexOf(col) >= 0) {
    gameState.focusNext = pick.key
    if (pick.kind === 'color') renkAct({ t: 'color', col: col, step: m.view.step })
    else renkSendPlay(m, pick.code, pick.key, col)
  }
  gameRefreshStage()
}

function renkPickerNode () {
  const wrap = h('div', 'renk-picker')
  wrap.setAttribute('role', 'dialog')
  wrap.setAttribute('aria-modal', 'true')
  wrap.setAttribute('aria-labelledby', 'renk-pick-title')
  wrap.setAttribute('aria-describedby', 'renk-pick-sub')
  const box = h('div', 'renk-picker-box')
  const title = h('h3', 'renk-picker-title', t('game.renk.pickTitle'))
  title.id = 'renk-pick-title'
  box.appendChild(title)
  const sub = h('p', 'renk-picker-sub', t('game.renk.pickSub'))
  sub.id = 'renk-pick-sub'
  box.appendChild(sub)
  const row = h('div', 'renk-picker-colors')
  RENK_COLORS.forEach((c) => {
    const b = h('button', 'renk-pick')
    b.type = 'button'
    b.setAttribute('data-color', c)
    b.setAttribute('data-focus-key', 'game-color-' + c)
    b.appendChild(icon(RENK_SUITS[c], 'icon-fill renk-suit'))
    const letter = h('b', 'renk-pick-letter', renkLetter(c))
    letter.setAttribute('aria-hidden', 'true')
    b.appendChild(letter)
    b.appendChild(h('span', 'renk-pick-name', renkColorName(c)))
    b.addEventListener('click', () => renkChoose(c))
    row.appendChild(b)
  })
  row.addEventListener('keydown', (e) => renkRowKey(e, row.querySelectorAll('.renk-pick')))
  box.appendChild(row)
  const cancel = button('button button-secondary renk-pick-cancel', t('common.cancel'))
  cancel.setAttribute('data-focus-key', 'game-color-cancel')
  cancel.addEventListener('click', renkCancelPicker)
  box.appendChild(cancel)
  wrap.appendChild(box)
  return wrap
}

// Seçici modelle birlikte yeniden çizilir, açık katman yeni öğeyi izler. Geçersizleşen seçici kapanır.
function renkSyncPicker (box, m, play) {
  const pick = play ? renkPicker(m) : null
  if (!pick) {
    if (gameState.picker || renkState.layer) renkDropPicker()
    return
  }
  const node = renkPickerNode()
  box.appendChild(node)
  renkState.pickerEl = node
  if (renkState.layer) renkState.layer.el = node
}

// ----- Çizim -----

function renkSuit (c, extra) {
  return icon(RENK_SUITS[c], 'icon-fill renk-suit' + (extra ? ' ' + extra : ''))
}

function renkHidden (node) {
  node.setAttribute('aria-hidden', 'true')
  return node
}

// Kartın yüzü: köşede şekil ve değer, ortada büyük değer (Joker'de dört renk karesi), altta dile göre harf
function renkFace (tag, code, extra) {
  const color = code.charAt(0)
  const value = code.charAt(1)
  const card = h(tag, 'renk-card' + (extra ? ' ' + extra : ''))
  card.setAttribute('data-color', color)
  card.setAttribute('data-value', value)
  const corner = renkHidden(h('span', 'renk-card-corner'))
  if (color !== 'W') corner.appendChild(renkSuit(color))
  if (value === 'S') corner.appendChild(icon('i-block', 'renk-mark-icon'))
  else if (value === 'V') corner.appendChild(icon('i-reverse', 'renk-mark-icon'))
  else if (value === 'D') corner.appendChild(h('b', 'renk-card-mark', '+2'))
  else if (value === 'F') corner.appendChild(h('b', 'renk-card-mark', '+4'))
  else if (value !== 'W') corner.appendChild(h('b', 'renk-card-mark', value))
  card.appendChild(corner)
  const center = renkHidden(h('span', 'renk-card-value'))
  if (color === 'W') {
    const quads = h('span', 'renk-quads')
    RENK_COLORS.forEach((c) => {
      const q = h('span', 'renk-quad')
      q.setAttribute('data-color', c)
      q.appendChild(renkSuit(c))
      quads.appendChild(q)
    })
    center.appendChild(quads)
    if (value === 'F') center.appendChild(h('b', 'renk-card-plus', '+4'))
  } else if (value === 'S') {
    center.appendChild(icon('i-block', 'renk-glyph'))
  } else if (value === 'V') {
    center.appendChild(icon('i-reverse', 'renk-glyph'))
  } else {
    center.appendChild(h('b', 'renk-card-big', value === 'D' ? '+2' : value))
  }
  card.appendChild(center)
  card.appendChild(renkHidden(h('span', 'renk-card-tag', renkLetter(color))))
  return card
}

function renkChip (className, text, hidden) {
  const chip = h('span', 'renk-chip ' + className, text)
  if (hidden) chip.setAttribute('aria-hidden', 'true')
  return chip
}

// Rakipler benden sonraki koltuktan başlayarak masanın koltuk sırasıyla
function renkOpponents (view, me) {
  const ids = view.seats.map((s) => s.id)
  const k = ids.indexOf(me)
  if (k < 0) return view.seats.slice()
  return view.seats.slice(k + 1).concat(view.seats.slice(0, k))
}

function renkOpponent (m, view, seat) {
  const id = seat.id
  const turn = view.turn === id
  const last = view.last && view.last.p === id ? view.last : null
  const away = m.seats.some((s) => s.id === id && s.away)
  const li = h('li', 'renk-opp')
  li.setAttribute('data-user-id', id)
  li.classList.toggle('is-turn', turn)
  li.classList.toggle('is-catchable', Boolean(last && !last.safe))
  const cards = t('game.cards', { count: seat.n })
  const state = (turn ? t('game.renk.seatTurn') : '') + (last && last.safe ? t('game.renk.seatLast') : '')
  li.appendChild(h('span', 'sr-only', t('game.renk.seatLabel', { name: shownName(id), cards: cards, state: state })))
  li.appendChild(avatar(id, 'sm', 'renk-opp-avatar'))
  const text = renkHidden(h('span', 'renk-opp-text'))
  const name = h('span', 'renk-opp-name', shownName(id))
  if (id === m.dealer) name.appendChild(icon('i-crown', 'renk-crown'))
  text.appendChild(name)
  const meta = h('span', 'renk-opp-meta')
  meta.appendChild(h('span', 'renk-back renk-mini-back'))
  meta.appendChild(h('span', 'renk-opp-count', cards))
  text.appendChild(meta)
  li.appendChild(text)
  if (turn) li.appendChild(renkChip('is-turn', t('game.renk.turnChip'), true))
  if (last && last.safe) li.appendChild(renkChip('is-last', t('game.renk.last'), true))
  if (away) li.appendChild(renkChip('is-away', t('game.status.away'), false))
  return li
}

function renkOpponentsBlock (m, view) {
  const list = h('ul', 'renk-opponents')
  list.setAttribute('aria-label', t('game.seatsTitle'))
  renkOpponents(view, m.me).forEach((seat) => {
    list.appendChild(renkOpponent(m, view, seat))
  })
  return list
}

// Masa ortasındaki bölme ve başlığı. Deste ve atılan kartın kendi erişilebilir adı vardır, başlıkları gizlenir.
function renkSlot (className, caption, spoken) {
  const slot = h('div', 'renk-slot ' + className)
  const head = h('span', 'renk-slot-caption', caption)
  slot.appendChild(spoken ? head : renkHidden(head))
  return slot
}

function renkCenter (m, view, legal, busy, play) {
  const center = h('div', 'renk-center')
  // Deste
  const deckSlot = renkSlot('renk-slot-deck', t('game.renk.deck'), false)
  const left = t('game.renk.deckLeft', { count: view.deck })
  const take = play && legal.turn ? legal.take : 0
  const deck = h('button', 'renk-deck')
  deck.type = 'button'
  deck.setAttribute('data-focus-key', 'game-draw')
  deck.setAttribute('aria-label', take ? t('game.renk.take', { count: take }) : t('game.renk.drawLabel', { left: left }))
  deck.appendChild(renkHidden(h('span', 'renk-back renk-deck-back')))
  deck.appendChild(renkHidden(h('span', 'renk-deck-label', take ? t('game.renk.take', { count: take }) : t('game.renk.draw'))))
  if (!play || busy || !legal.turn || !legal.draw) deck.setAttribute('aria-disabled', 'true')
  deck.classList.toggle('is-ready', play && !busy && legal.turn && legal.draw)
  deck.addEventListener('click', () => {
    if (renkEnabled(deck)) renkDraw()
  })
  deckSlot.appendChild(deck)
  deckSlot.appendChild(renkHidden(h('span', 'renk-slot-note', left)))
  center.appendChild(deckSlot)
  // Atılan kart
  const pileSlot = renkSlot('renk-slot-pile', t('game.renk.discard'), false)
  const pile = h('div', 'renk-pile')
  pile.setAttribute('role', 'img')
  pile.setAttribute('aria-label', t('game.renk.pileLabel', { card: renkPlayedLabel(view.top, view.color) }))
  pile.appendChild(renkFace('div', view.top, 'is-pile'))
  pileSlot.appendChild(pile)
  if (view.pending) pileSlot.appendChild(renkChip('renk-stacked', t('game.renk.stacked', { count: view.pending.n }), false))
  center.appendChild(pileSlot)
  // Aktif renk: şekil, harf ve ad
  const colorSlot = renkSlot('renk-slot-color', t('game.renk.activeColor'), true)
  const c = RENK_COLORS.indexOf(view.color) >= 0 ? view.color : null
  const swatch = h('div', 'renk-color')
  swatch.setAttribute('data-color', c || 'none')
  const dot = renkHidden(h('span', 'renk-color-dot'))
  if (c) {
    dot.appendChild(renkSuit(c))
    dot.appendChild(h('b', 'renk-color-letter', renkLetter(c)))
  }
  swatch.appendChild(dot)
  swatch.appendChild(h('span', 'renk-color-name', renkColorName(c)))
  colorSlot.appendChild(swatch)
  center.appendChild(colorSlot)
  return center
}

function renkActionButton (className, text, key, disabled, onClick) {
  const b = button('button button-secondary renk-action ' + className, text)
  b.setAttribute('data-focus-key', key)
  if (disabled) b.setAttribute('aria-disabled', 'true')
  b.addEventListener('click', () => {
    if (renkEnabled(b)) onClick()
  })
  return b
}

function renkActions (m, legal, busy) {
  const row = h('div', 'renk-actions')
  if (legal.color) {
    row.appendChild(renkActionButton('renk-choose', t('game.renk.chooseColor'), 'game-choose-color', busy, () => {
      renkOpenPicker('color', 'game-choose-color')
    }))
  }
  if (legal.pass) row.appendChild(renkActionButton('renk-pass', t('game.renk.pass'), 'game-pass', busy, renkPass))
  const done = Boolean(m.view.last && m.view.last.p === m.me && m.view.last.safe)
  const armed = renkArmed(m)
  const can = legal.last || legal.armLast
  const text = done ? t('game.renk.lastDone') : armed ? t('game.renk.lastArmed') : t('game.renk.last')
  const last = renkActionButton('renk-last', text, 'game-last', busy || !can, renkLastClick)
  last.setAttribute('aria-pressed', armed || done ? 'true' : 'false')
  if (can) last.setAttribute('aria-label', t('game.renk.lastLabel'))
  last.classList.toggle('is-armed', armed)
  last.classList.toggle('is-urgent', Boolean(legal.last))
  row.appendChild(last)
  const target = legal.catch
  const grab = renkActionButton('renk-catch', t('game.renk.catch'), 'game-catch', busy || !target, renkCatch)
  if (target) grab.setAttribute('aria-label', t('game.renk.catchLabel', { name: shownName(target) }))
  grab.classList.toggle('is-urgent', Boolean(target))
  row.appendChild(grab)
  return row
}

function renkNoteLine (m) {
  const n = renkState.note
  if (!n || !m.view || n.rd !== m.rd || n.step !== m.view.step) return null
  const p = h('p', 'renk-note')
  p.appendChild(icon('i-alert', 'renk-note-icon'))
  p.appendChild(h('span', '', t('game.renk.err.' + n.why)))
  return p
}

// Eli bir önceki çizimle karşılaştırır: yeni gelen kartlar (çekilen, ceza) bir sonraki tur hamlesine kadar işaretlenir
function renkTrackHand (m, cards) {
  const prev = renkState.hand
  if (prev && prev.rd === m.rd && cards.length > prev.cards.length) {
    const rest = prev.cards.slice()
    const added = []
    cards.forEach((c) => {
      const i = rest.indexOf(c)
      if (i >= 0) rest.splice(i, 1)
      else added.push(c)
    })
    if (added.length) renkState.fresh = { rd: m.rd, step: m.view.step, cards: added }
  }
  renkState.hand = { rd: m.rd, cards: cards.slice() }
}

function renkFreshCards (m, mine) {
  const f = renkState.fresh
  const out = f && f.rd === m.rd && f.step === m.view.step ? f.cards.slice() : []
  if (mine.drawn && out.indexOf(mine.drawn) < 0) out.push(mine.drawn)
  return out
}

function renkHandBlock (m, mine, legal, busy, play) {
  const wrap = h('div', 'renk-hand-wrap')
  const count = mine.cards.length
  wrap.appendChild(h('h3', 'renk-hand-title', t('game.renk.hand', { count: count })))
  const hand = h('div', 'renk-hand')
  hand.setAttribute('role', 'group')
  hand.setAttribute('aria-label', t('game.renk.handLabel', { count: count }))
  const sorted = renkSorted(mine.cards)
  const keys = renkHandKeys(sorted)
  const fresh = renkFreshCards(m, mine)
  const turn = play && legal.turn
  sorted.forEach((code, i) => {
    const k = Number(keys[i].slice(keys[i].lastIndexOf('-') + 1))
    const card = renkFace('button', code, '')
    card.type = 'button'
    card.setAttribute('data-focus-key', keys[i])
    const playable = turn && legal.play.indexOf(code) >= 0
    const why = turn && !playable && legal.blocked ? legal.blocked[code] : null
    const fi = fresh.indexOf(code)
    const isNew = fi >= 0
    if (isNew) fresh.splice(fi, 1)
    const parts = [renkCardLabel(code)]
    if (playable) {
      card.classList.add('is-playable')
      parts.push(t('game.renk.card.playable'))
    } else if (why && hasText('game.renk.err.' + why)) {
      card.classList.add('is-blocked')
      parts.push(t('game.renk.err.' + why))
    }
    if (isNew) {
      card.classList.add('is-new')
      card.appendChild(renkHidden(h('span', 'renk-card-new', t('game.renk.newTag'))))
      parts.push(t('game.renk.card.new'))
    }
    if (!playable || busy) card.setAttribute('aria-disabled', 'true')
    card.setAttribute('aria-label', parts.join(', '))
    card.addEventListener('click', () => renkCardClick(code, k))
    hand.appendChild(card)
  })
  wrap.appendChild(hand)
  return wrap
}

// Kart çekildikten sonra oynanabilir kart elde kalırsa odak (Deste'deyse) o karta geçer
function renkFocusDrawn (m, mine) {
  const d = renkState.drawFocus
  if (!d || !m.view || d.rd !== m.rd || m.view.step === d.step) return
  renkState.drawFocus = null
  if (!mine.drawn) return
  const key = renkHandKeys(renkSorted(mine.cards))[renkSorted(mine.cards).indexOf(mine.drawn)]
  nextFrame(() => {
    const n = gameCastNodes()
    const active = document.activeElement
    if (!n || !gameStageVisible() || (active && active !== document.body && active.getAttribute('data-focus-key') !== 'game-draw')) return
    focusNode(renkByKey(n.game, key))
  })
}

// Elde, eylem satırında ve Deste'de ok tuşlarıyla gezinme (yalnızca işlenen tuşta varsayılan davranış engellenir)
function renkRowKey (e, nodes) {
  if (RENK_NAV_KEYS.indexOf(e.key) < 0) return false
  const list = Array.from(nodes)
  const i = list.indexOf(e.target)
  if (i < 0) return false
  let next = null
  if (e.key === 'ArrowLeft' || e.key === 'Left') next = list[Math.max(0, i - 1)]
  else if (e.key === 'ArrowRight' || e.key === 'Right') next = list[Math.min(list.length - 1, i + 1)]
  else if (e.key === 'Home') next = list[0]
  else if (e.key === 'End') next = list[list.length - 1]
  if (!next) return false
  e.preventDefault()
  focusNode(next)
  return true
}

function renkOnKey (e) {
  const table = e.currentTarget
  const target = e.target
  if (!target || !target.closest || RENK_NAV_KEYS.indexOf(e.key) < 0) return
  const up = e.key === 'ArrowUp' || e.key === 'Up'
  const down = e.key === 'ArrowDown' || e.key === 'Down'
  const cards = table.querySelectorAll('.renk-hand .renk-card')
  if (target.closest('.renk-hand')) {
    if (up) {
      e.preventDefault()
      focusNode(table.querySelector('.renk-deck'))
      return
    }
    renkRowKey(e, cards)
    return
  }
  const fromDeck = target.classList.contains('renk-deck')
  if (target.closest('.renk-actions') && !up && !down && renkRowKey(e, table.querySelectorAll('.renk-actions .button'))) return
  if (down && (fromDeck || target.closest('.renk-actions')) && cards.length) {
    e.preventDefault()
    focusNode(renkTurnTarget(table) || cards[0])
  }
}

function renkRender (box, m) {
  const view = m.view
  if (!view || !Array.isArray(view.seats)) return
  const legal = m.legal || { turn: false, play: [], blocked: {}, draw: false, take: 0, pass: false, color: false, armLast: false, last: false, catch: null }
  const mine = m.mine && Array.isArray(m.mine.cards) ? m.mine : { cards: [], drawn: null }
  const play = m.stage === 'play' && view.phase !== 'over'
  const busy = Boolean(m.pending)
  renkTrackHand(m, mine.cards)
  const table = h('div', 'renk-table')
  table.setAttribute('data-turn', play && legal.turn ? 'me' : 'other')
  table.setAttribute('data-phase', view.phase)
  table.classList.toggle('is-pending', busy)
  table.appendChild(renkOpponentsBlock(m, view))
  table.appendChild(renkCenter(m, view, legal, busy, play))
  if (play) table.appendChild(renkActions(m, legal, busy))
  const note = renkNoteLine(m)
  if (note) table.appendChild(note)
  table.appendChild(renkHandBlock(m, mine, legal, busy, play))
  table.addEventListener('keydown', renkOnKey)
  box.appendChild(table)
  renkSyncPicker(box, m, play)
  if (play) renkFocusDrawn(m, mine)
}

// Sahne kapandı: açık seçici katmanı odağı geri vermeden kapanır
function renkStageClosed () {
  const layer = renkState.layer
  renkState.layer = null
  renkState.pickerEl = null
  if (layer) closeLayer(layer, false)
}

const renkUi = {
  name: () => t('game.renk.title'),
  tagline: () => t('game.renk.tagline'),
  rulesLabel: (rules) => (rules === 'official' || rules === 'stack' ? t('game.renk.rules.' + rules) : ''),
  rulesHint: (rules) => (rules === 'official' || rules === 'stack' ? t('game.renk.rules.' + rules + 'Hint') : ''),
  rulesLine: (rules) => (rules === 'official' || rules === 'stack' ? t('game.renk.rulesLine.' + rules) : ''),
  render: renkRender,
  statusParts: (m) => (m.view && m.stage === 'play' ? [renkDirText(m.view.dir)] : []),
  turnText: renkTurnText,
  onTurn: renkOnTurn,
  eventText: renkEventText,
  errorText: renkErrorText,
  notes: () => [t('game.renk.wild4Rule'), t('game.renk.lastRule'), t('game.renk.scoring')],
  firstFocus: renkFirstFocus,
  stageClosed: renkStageClosed
}

if (typeof gameUiRegister === 'function') gameUiRegister('renk', renkUi)
