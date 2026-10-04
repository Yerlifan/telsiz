'use strict'

// Frekans bandının etkileşimi (Ek K5, KONSEPT 5.1). Bandı 04-meta.js renderBand çizer, bu modül olayları
// bağlar ve ibreyi yönetir:
// - Fare ve dokunma: konuşma istasyonuna (Özel, Arkadaşlar, yazı odası) basmak onu ayarlar, ses istasyonuna
//   basmak o odaya katılır. Ölçek şeridine (istasyonların üstündeki boş kadran) tıklamak en yakın konuşma
//   istasyonunu ayarlar.
// - İbre: topuzundan tutulup sürüklenir (fare, kalem, parmak), bırakınca en yakın konuşma istasyonuna oturur.
//   Ses istasyonuna oturmaz. Sürüklerken Esc vazgeçer, bandın kenarına gelince bant kendiliğinden kayar.
// - Tekerlek: bant taşıyorsa yalnızca yatay kaydırır, hiçbir zaman istasyon değiştirmez. Taşmıyorsa
//   olay sayfaya bırakılır.
// - Uç düğmeleri: önceki ve sonraki konuşma istasyonu (döngüsel), erişilebilir adları hedefi söyler.
// - Klavye: bant tek sekme durağıdır (gezici tabindex, role="toolbar"). Sol ve sağ ok odağı gezdirir,
//   Home ve End ilk ve son istasyon, Enter ve Boşluk ayarlar veya katılır. Ayarlamak odağı bantta bırakır.
// - Kol (Gamepad API): L1 ve R1 (standart düzende 4 ve 5) önceki ve sonraki konuşma istasyonu, daire
//   düğmesi (1) en üstteki katmanı kapatır. Yalnızca sayfa görünür ve odaktayken yoklanır. Kol gerçekten
//   algılanınca #app-view.has-gamepad sınıfı eklenir, L1 ve R1 ipuçları yalnızca o zaman görünür (Ek K7.6).
// Tümü sayfasındaki ve Gelenler kartındaki satırlar da aynı ayarlama işlevini kullanır.

const BAND_EDGE_PX = 32
const BAND_AUTOSCROLL_PX = 12
const BAND_DRAG_SLOP_PX = 4
const PAD_L1 = 4
const PAD_R1 = 5
const PAD_CIRCLE = 1

const bandState = {
  bound: false,
  drag: null,
  pendingRender: false,
  suppressClick: false,
  lastTuned: null,
  pads: {},
  polling: false
}

function bandIsDragging () {
  return Boolean(bandState.drag)
}

function bandRenderLater () {
  bandState.pendingRender = true
}

function bandStationEls () {
  return el.bandTrack ? Array.from(el.bandTrack.querySelectorAll('.station[data-station]')) : []
}

function bandConvEls () {
  return bandStationEls().filter((node) => node.getAttribute('data-kind') === 'conv')
}

function bandTunedEl () {
  return el.bandTrack ? el.bandTrack.querySelector('.station.is-tuned') : null
}

function bandStationName (node) {
  const name = node ? node.querySelector('.station-name') : null
  return name ? name.textContent : ''
}

// Gezici tabindex: bantta yalnızca bir istasyon sekme sırasındadır
function bandSetRoving (target) {
  bandStationEls().forEach((node) => {
    node.tabIndex = node === target ? 0 : -1
  })
}

function reducedMotion () {
  try {
    return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  } catch (err) {
    return false
  }
}

function bandScrollTo (left, smooth) {
  const track = el.bandTrack
  if (!track) return
  const max = Math.max(0, track.scrollWidth - track.clientWidth)
  const target = Math.max(0, Math.min(max, Math.round(left)))
  if (smooth && !reducedMotion() && typeof track.scrollTo === 'function') {
    try {
      track.scrollTo({ left: target, behavior: 'smooth' })
      return
    } catch (err) {
      // Seçenekli scrollTo desteklenmiyor
    }
  }
  track.scrollLeft = target
}

// İstasyonun kadran içindeki yatay konumu (kaydırmadan bağımsız, içerik koordinatı)
function bandContentRect (node) {
  const track = el.bandTrack
  const tr = track.getBoundingClientRect()
  const r = node.getBoundingClientRect()
  const left = r.left - tr.left + track.scrollLeft
  return { left: left, right: left + r.width, center: left + r.width / 2, width: r.width }
}

// İstasyon görünür alanda değilse ortalanır
function bandReveal (node, smooth) {
  const track = el.bandTrack
  if (!track || !node || track.scrollWidth <= track.clientWidth) return
  const r = bandContentRect(node)
  const viewLeft = track.scrollLeft
  const viewRight = viewLeft + track.clientWidth
  if (r.left >= viewLeft + 8 && r.right <= viewRight - 8) return
  bandScrollTo(r.center - track.clientWidth / 2, smooth)
}

// Klavyeyle odaklanan istasyon görünür alana (en yakın kenara) getirilir, sayfa kaydırılmaz
function bandEnsureVisible (node) {
  const track = el.bandTrack
  if (!track || !node || track.scrollWidth <= track.clientWidth) return
  const r = bandContentRect(node)
  if (r.left < track.scrollLeft + 8) bandScrollTo(r.left - 8, false)
  else if (r.right > track.scrollLeft + track.clientWidth - 8) bandScrollTo(r.right - track.clientWidth + 8, false)
}

// Açılışta ayarlı istasyonun grubu baştan görünür, sığmazsa istasyon ortalanır (KONSEPT 6.2, Taşma)
function bandInitialScroll (node) {
  const track = el.bandTrack
  if (!track || !node || track.scrollWidth <= track.clientWidth) return
  const group = node.closest('.band-group')
  const groupLeft = group ? bandContentRect(group).left : 0
  const r = bandContentRect(node)
  if (r.right - groupLeft + 16 <= track.clientWidth) bandScrollTo(groupLeft - 8, false)
  else bandScrollTo(r.center - track.clientWidth / 2, false)
}

// Uç düğmelerinin erişilebilir adları hedef istasyonu söyler
function bandUpdateSteps () {
  const list = bandConvEls()
  const cur = bandTunedEl()
  let i = list.indexOf(cur)
  if (i === -1) i = 0
  const prev = list.length ? list[(i - 1 + list.length) % list.length] : null
  const next = list.length ? list[(i + 1) % list.length] : null
  const label = (node, key, plainKey) => (node ? t(key, { name: bandStationName(node) }) : t(plainKey))
  if (el.bandPrev) {
    const text = label(prev, 'band.prevTo', 'band.prev')
    el.bandPrev.setAttribute('aria-label', text)
    el.bandPrev.title = text
    el.bandPrev.disabled = list.length < 2
  }
  if (el.bandNext) {
    const text = label(next, 'band.nextTo', 'band.next')
    el.bandNext.setAttribute('aria-label', text)
    el.bandNext.title = text
    el.bandNext.disabled = list.length < 2
  }
}

// renderBand her çizimden sonra çağırır: uç düğmeleri, ilk kaydırma ve ibrenin taşındığı istasyonun görünmesi
function bandAfterRender (tuned) {
  bandUpdateSteps()
  const node = bandTunedEl()
  if (!node) return
  if (bandState.lastTuned === null) bandInitialScroll(node)
  else if (tuned !== bandState.lastTuned) bandReveal(node, true)
  bandState.lastTuned = tuned
}

// Ayarlama: konuşma istasyonları konuşmayı açar, ses istasyonu odaya katılır

function bandOpenDm () {
  const entries = bandDmEntries()
  const last = entries.filter((d) => sameId(d.id, bandLastDm))[0] || entries[0]
  if (last && typeof showDm === 'function') {
    showDm(last.id, { focus: false })
    return
  }
  if (typeof showHome === 'function') showHome('all', { focus: false })
  toast(() => t('band.noDms'))
}

function bandJoinVoice (id) {
  const s = snap()
  if (sameId(s.channelId, id) || s.joining) return
  joinVoice(id)
}

function bandTune (key) {
  if (!state.inApp || !key) return
  if (key === 'dm') {
    bandOpenDm()
    return
  }
  if (key === 'friends') {
    if (typeof showHome === 'function') showHome(null, { focus: false })
    return
  }
  const m = /^(text|voice)-(.+)$/.exec(key)
  if (!m) return
  if (m[1] === 'text') selectChannel(m[2], { focus: false })
  else bandJoinVoice(m[2])
}

function bandStep (dir) {
  const list = bandConvEls()
  if (!list.length) return
  let i = list.indexOf(bandTunedEl())
  if (i === -1) i = dir > 0 ? -1 : 0
  const target = list[(i + dir + list.length) % list.length]
  bandTune(target.getAttribute('data-station'))
}

function bandNearestConv (x) {
  let best = null
  let bestD = Infinity
  bandConvEls().forEach((node) => {
    const d = Math.abs(bandContentRect(node).center - x)
    if (d < bestD) {
      bestD = d
      best = node
    }
  })
  return best
}

function bandPointerX (e) {
  const track = el.bandTrack
  return e.clientX - track.getBoundingClientRect().left + track.scrollLeft
}

// Olaylar

function onBandClick (e) {
  if (bandState.suppressClick) {
    bandState.suppressClick = false
    return
  }
  const node = e.target && e.target.closest ? e.target.closest('.station[data-station]') : null
  if (!node || !el.bandTrack.contains(node)) return
  bandSetRoving(node)
  bandTune(node.getAttribute('data-station'))
}

// Ölçek şeridi: istasyonların üstündeki boş kadrana fareyle tıklamak en yakın konuşma istasyonunu ayarlar
function onBandScalePointer (e) {
  if (e.pointerType === 'touch' || (typeof e.button === 'number' && e.button > 0)) return
  const target = e.target
  if (!target || !target.closest || target.closest('.station') || target.closest('.needle')) return
  const first = el.bandTrack.querySelector('.station[data-station]')
  if (!first || e.clientY >= first.getBoundingClientRect().top) return
  const nearest = bandNearestConv(bandPointerX(e))
  if (!nearest) return
  e.preventDefault()
  bandSetRoving(nearest)
  bandTune(nearest.getAttribute('data-station'))
}

function onBandKeydown (e) {
  const list = bandStationEls()
  const i = list.indexOf(document.activeElement)
  if (i === -1) return
  let to = null
  if (e.key === 'ArrowRight' || e.key === 'Right') to = list[Math.min(list.length - 1, i + 1)]
  else if (e.key === 'ArrowLeft' || e.key === 'Left') to = list[Math.max(0, i - 1)]
  else if (e.key === 'Home') to = list[0]
  else if (e.key === 'End') to = list[list.length - 1]
  if (!to) return
  e.preventDefault()
  bandSetRoving(to)
  focusNode(to)
  bandEnsureVisible(to)
}

function onBandFocusIn (e) {
  const node = e.target && e.target.closest ? e.target.closest('.station[data-station]') : null
  if (node && el.bandTrack.contains(node)) bandSetRoving(node)
}

// Tekerlek yalnızca bant taşarken ve yalnızca yatay kaydırır
function onBandWheel (e) {
  const track = el.bandTrack
  if (!track || track.scrollWidth <= track.clientWidth) return
  let delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
  if (!delta) return
  if (e.deltaMode === 1) delta *= 16
  else if (e.deltaMode === 2) delta *= track.clientWidth
  e.preventDefault()
  track.scrollLeft += delta
}

// İbre sürükleme

function bandClearTargets () {
  bandStationEls().forEach((node) => {
    node.classList.remove('is-target')
  })
}

function onNeedlePointerDown (e) {
  const needle = e.target && e.target.closest ? e.target.closest('.needle') : null
  if (!needle || !el.bandTrack.contains(needle)) return
  if (e.pointerType === 'mouse' && e.button > 0) return
  e.preventDefault()
  e.stopPropagation()
  const origin = needle.closest('.station')
  bandState.drag = { needle: needle, origin: origin, pointerId: e.pointerId, startX: e.clientX, moved: false }
  el.bandTrack.appendChild(needle)
  needle.classList.add('is-free', 'is-dragging')
  needle.style.left = Math.round(bandPointerX(e)) + 'px'
  el.bandTrack.classList.add('is-dragging')
  try {
    needle.setPointerCapture(e.pointerId)
  } catch (err) {
    // Yakalama desteklenmiyor, olaylar banttan izlenir
  }
}

function onNeedlePointerMove (e) {
  const drag = bandState.drag
  if (!drag || e.pointerId !== drag.pointerId) return
  e.preventDefault()
  const track = el.bandTrack
  const r = track.getBoundingClientRect()
  if (e.clientX < r.left + BAND_EDGE_PX) track.scrollLeft -= BAND_AUTOSCROLL_PX
  else if (e.clientX > r.right - BAND_EDGE_PX) track.scrollLeft += BAND_AUTOSCROLL_PX
  if (Math.abs(e.clientX - drag.startX) > BAND_DRAG_SLOP_PX) drag.moved = true
  const x = Math.max(0, Math.min(track.scrollWidth, bandPointerX(e)))
  drag.needle.style.left = Math.round(x) + 'px'
  bandClearTargets()
  const nearest = bandNearestConv(x)
  if (nearest) nearest.classList.add('is-target')
}

function bandEndDrag (cancel) {
  const drag = bandState.drag
  if (!drag) return
  const needle = drag.needle
  const x = parseFloat(needle.style.left) || 0
  bandState.drag = null
  try {
    needle.releasePointerCapture(drag.pointerId)
  } catch (err) {
    // Yakalama zaten bırakıldı
  }
  needle.classList.remove('is-dragging', 'is-free')
  needle.style.left = ''
  el.bandTrack.classList.remove('is-dragging')
  bandClearTargets()
  // Sürüklemenin sonundaki tıklama istasyonu yeniden ayarlamasın
  bandState.suppressClick = true
  setTimeout(() => {
    bandState.suppressClick = false
  }, 0)
  const target = cancel || !drag.moved ? drag.origin : bandNearestConv(x)
  if (drag.origin && isConnected(drag.origin)) drag.origin.insertBefore(needle, drag.origin.firstChild)
  else if (needle.parentNode) needle.parentNode.removeChild(needle)
  const pending = bandState.pendingRender
  bandState.pendingRender = false
  if (target && target !== drag.origin) {
    bandSetRoving(target)
    bandTune(target.getAttribute('data-station'))
  } else if (pending) {
    renderBand()
  }
}

function onNeedlePointerUp (e) {
  const drag = bandState.drag
  if (!drag || e.pointerId !== drag.pointerId) return
  bandEndDrag(false)
}

function onNeedlePointerCancel (e) {
  const drag = bandState.drag
  if (!drag || e.pointerId !== drag.pointerId) return
  bandEndDrag(true)
}

// Sürüklerken Esc vazgeçer (katman yığınından önce yakalanır)
function onBandEscape (e) {
  if (!bandState.drag || (e.key !== 'Escape' && e.key !== 'Esc')) return
  e.preventDefault()
  e.stopPropagation()
  bandEndDrag(true)
}

// Kol (Gamepad API)

function padBindingButtons () {
  const used = []
  if (!voice || typeof voice.settings !== 'function') return used
  try {
    const bindings = voice.settings().bindings || {}
    Object.keys(bindings).forEach((name) => {
      const b = bindings[name]
      if (b && b.type === 'gamepad' && typeof b.button === 'number') used.push(b.button)
    })
  } catch (err) {
    // Ses ayarları okunamadı
  }
  return used
}

function padList () {
  try {
    return navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((gp) => gp && gp.connected !== false && gp.buttons) : []
  } catch (err) {
    return []
  }
}

function setGamepadPresent (present) {
  if (el.appView) el.appView.classList.toggle('has-gamepad', present)
  // Rehber açılır penceresi #app-view dışındadır, kol ipucu satırı için gövdede de işaret
  if (document.body) document.body.classList.toggle('has-gamepad', present)
}

function padPressed (gp, index) {
  const b = gp.buttons[index]
  return Boolean(b && (b.pressed || b.value > 0.5))
}

function padPoll () {
  const pads = padList()
  if (!pads.length) {
    bandState.polling = false
    bandState.pads = {}
    setGamepadPresent(false)
    return
  }
  setGamepadPresent(true)
  const focused = !document.hidden && (typeof document.hasFocus !== 'function' || document.hasFocus())
  const used = padBindingButtons()
  pads.forEach((gp) => {
    const now = { l1: padPressed(gp, PAD_L1), r1: padPressed(gp, PAD_R1), circle: padPressed(gp, PAD_CIRCLE) }
    const before = bandState.pads[gp.index] || {}
    if (focused && state.inApp) {
      const top = topLayer()
      const modal = Boolean(top && top.trap)
      if (now.l1 && !before.l1 && !modal && used.indexOf(PAD_L1) === -1) bandStep(-1)
      if (now.r1 && !before.r1 && !modal && used.indexOf(PAD_R1) === -1) bandStep(1)
      if (now.circle && !before.circle && top && used.indexOf(PAD_CIRCLE) === -1) closeLayer(top, true)
    }
    bandState.pads[gp.index] = now
  })
  nextFrame(padPoll)
}

function startPadPoll () {
  if (bandState.polling) return
  bandState.polling = true
  nextFrame(padPoll)
}

function onGamepadConnected () {
  setGamepadPresent(true)
  startPadPoll()
}

function onGamepadDisconnected () {
  if (!padList().length) setGamepadPresent(false)
}

// İstasyon değiştirme rehberi (#hints-card): bandın sonundaki ? düğmesiyle (#band-help) açılan küçük açılır
// pencere. Esc, dışarı tıklama, Kapat ve kolun daire düğmesi kapatır, odak düğmeye döner.
function bandHelpOpen () {
  const pop = byId('hints-card')
  const trigger = byId('band-help')
  if (!pop || !trigger) return
  const existing = findLayer('band-help')
  if (existing) {
    closeLayer(existing, true)
    return
  }
  pop.hidden = false
  positionPopup(pop, trigger)
  trigger.setAttribute('aria-expanded', 'true')
  openLayer({
    name: 'band-help',
    el: pop,
    trigger: trigger,
    level: 2,
    outside: true,
    closeOnFocusOut: true,
    initialFocus: () => pop,
    onClose: () => {
      pop.hidden = true
      trigger.setAttribute('aria-expanded', 'false')
    }
  })
}

// Sağ sütundaki İstasyonlar listesi ve Tümü sayfası: satırlar istasyonu ayarlar veya özel konuşmayı açar

function onStationRowClick (e) {
  const row = e.target && e.target.closest ? e.target.closest('[data-station], [data-dm-id]') : null
  if (!row || !e.currentTarget.contains(row)) return
  const dmId = row.getAttribute('data-dm-id')
  if (dmId !== null) {
    if (typeof showDm === 'function') showDm(dmId, { focus: false })
    return
  }
  bandTune(row.getAttribute('data-station'))
}

function bandInit () {
  if (bandState.bound || !el.bandTrack) return
  bandState.bound = true
  const track = el.bandTrack
  track.addEventListener('click', onBandClick)
  track.addEventListener('keydown', onBandKeydown)
  track.addEventListener('focusin', onBandFocusIn)
  track.addEventListener('wheel', onBandWheel, { passive: false })
  if (window.PointerEvent) {
    track.addEventListener('pointerdown', onNeedlePointerDown)
    track.addEventListener('pointerdown', onBandScalePointer)
    track.addEventListener('pointermove', onNeedlePointerMove)
    track.addEventListener('pointerup', onNeedlePointerUp)
    track.addEventListener('pointercancel', onNeedlePointerCancel)
    track.addEventListener('lostpointercapture', onNeedlePointerCancel)
  }
  document.addEventListener('keydown', onBandEscape, true)
  if (el.bandPrev) {
    el.bandPrev.addEventListener('click', () => {
      bandStep(-1)
    })
  }
  if (el.bandNext) {
    el.bandNext.addEventListener('click', () => {
      bandStep(1)
    })
  }
  if (el.stationsList) el.stationsList.addEventListener('click', onStationRowClick)
  if (el.inboxList) {
    el.inboxList.addEventListener('click', onStationRowClick)
    el.inboxList.addEventListener('keydown', onRoomListKey)
  }
  const help = byId('band-help')
  if (help) help.addEventListener('click', bandHelpOpen)
  const helpClose = byId('hints-close')
  if (helpClose) {
    helpClose.addEventListener('click', () => {
      const layer = findLayer('band-help')
      if (layer) closeLayer(layer, true)
    })
  }
  window.addEventListener('gamepadconnected', onGamepadConnected)
  window.addEventListener('gamepaddisconnected', onGamepadDisconnected)
  if (padList().length) onGamepadConnected()
}

// Oturum kapanınca ilk kaydırma bir sonraki açılışta yeniden yapılır
function bandReset () {
  if (bandState.drag) bandEndDrag(true)
  bandState.lastTuned = null
  bandState.pendingRender = false
}
