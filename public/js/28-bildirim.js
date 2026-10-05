'use strict'

// Bildirimler (#activity): sol sütunda telsiz kartının üstündeki kısa olay listesi. İki tür olay yazılır:
// - Ekran paylaşımı başladı: yanında İzle düğmesi durur, paylaşım bitince veya ses odasından ayrılınca kayıt
//   kalkar (22-cast.js castOnScreenEvent ve castSync, activityShare ve activityClearShares). Paylaşım ses
//   bağlantıları üzerinden duyurulduğu için yalnızca aynı ses odasındaki paylaşımlar görünür.
// - Ses odasına katılma ve ayrılma: her metada ses kadroları (meta.voice) bir öncekiyle karşılaştırılır
//   (04-meta.js applyMeta, activityOnMeta). İlk meta yalnızca karşılaştırma tabanıdır, kendi hareketlerin
//   yazılmaz.
// Liste en yeni ACTIVITY_MAX kaydı tutar, en yeni üsttedir. Kayıt yoksa kart gizlidir. Liste geniş ekranda
// görünürken paylaşım bildirimi sağ üstte ayrıca açılmaz (castShowNotice, activityShown).

const ACTIVITY_MAX = 5
const activityState = { items: [], seq: 0, rosters: null }

// meta.voice kadrolarından oda kimliği -> kişi kimlikleri kümesi
function activityRosters (meta) {
  const out = {}
  const voiceMap = meta && meta.voice && typeof meta.voice === 'object' ? meta.voice : {}
  Object.keys(voiceMap).forEach((channelId) => {
    const roster = Array.isArray(voiceMap[channelId]) ? voiceMap[channelId] : []
    out[channelId] = new Set(roster.filter((entry) => entry && entry.userId !== undefined).map((entry) => String(entry.userId)))
  })
  return out
}

function activityAdd (item) {
  activityState.seq++
  activityState.items.unshift(Object.assign({ id: activityState.seq, at: Date.now() }, item))
  if (activityState.items.length > ACTIVITY_MAX) activityState.items.length = ACTIVITY_MAX
}

// Kadro farkından katılma ve ayrılma kayıtları
function activityOnMeta (meta) {
  const next = activityRosters(meta)
  const prev = activityState.rosters
  activityState.rosters = next
  if (!prev || !state.me) return
  const me = String(state.me.id)
  let changed = false
  Object.keys(prev).forEach((channelId) => {
    prev[channelId].forEach((userId) => {
      if (userId === me || (next[channelId] && next[channelId].has(userId))) return
      activityAdd({ kind: 'leave', userId: userId, channelId: channelId })
      changed = true
    })
  })
  Object.keys(next).forEach((channelId) => {
    next[channelId].forEach((userId) => {
      if (userId === me || (prev[channelId] && prev[channelId].has(userId))) return
      activityAdd({ kind: 'join', userId: userId, channelId: channelId })
      changed = true
    })
  })
  if (changed) renderActivity()
}

// Ekran paylaşımı başladı (on true) veya bitti (on false). Aynı kişinin eski paylaşım kaydı kaldırılır.
function activityShare (userId, on) {
  if (userId === null || userId === undefined) return
  // Özel mesaj aramasında ekran paylaşımı yoktur, oradan gelen olay bildirim listesine yazılmaz
  if (on && typeof snap === 'function' && snap().private) return
  const id = String(userId)
  const before = activityState.items.length
  activityState.items = activityState.items.filter((item) => !(item.kind === 'share' && item.userId === id))
  if (on) activityAdd({ kind: 'share', userId: id, channelId: null })
  if (on || activityState.items.length !== before) renderActivity()
}

function activityClearShares () {
  const before = activityState.items.length
  activityState.items = activityState.items.filter((item) => item.kind !== 'share')
  if (activityState.items.length !== before) renderActivity()
}

// Çıkışta veya frekans değişince liste ve karşılaştırma tabanı sıfırlanır
function activityReset () {
  activityState.items = []
  activityState.rosters = null
  renderActivity()
}

// Liste şu an ekranda mı (geniş ekranda sol sütun görünür, dar ekranda yalnızca Oda bilgisi sayfası açıkken)
function activityShown () {
  return Boolean(el.activity && !el.activity.hidden && el.activity.getClientRects().length > 0)
}

function activityText (item) {
  const name = shownName(item.userId)
  if (item.kind === 'share') return t('activity.share', { name: name })
  const room = findChannel(item.channelId)
  const roomName = room && room.name ? String(room.name) : t('activity.voiceRoom')
  return t(item.kind === 'join' ? 'activity.join' : 'activity.leave', { name: name, room: roomName })
}

function renderActivity () {
  const box = el.activity
  const list = el.activityList
  if (!box || !list) return
  clear(list)
  activityState.items.forEach((item) => {
    const li = h('li', 'activity-item is-' + item.kind)
    li.setAttribute('data-user-id', item.userId)
    li.appendChild(avatar(item.userId, 'xs', 'activity-avatar'))
    const body = h('span', 'activity-body')
    setLive(body.appendChild(h('span', 'activity-text')), () => activityText(item))
    const time = h('time', 'activity-time', formatClock(item.at))
    time.setAttribute('datetime', new Date(item.at).toISOString())
    body.appendChild(time)
    li.appendChild(body)
    if (item.kind === 'share') {
      const watch = button('button button-small activity-watch', t('screen.watch'), 'i-eye', t('cast.watchLabel', { name: shownName(item.userId) }))
      watch.addEventListener('click', () => {
        if (typeof castWatch === 'function') castWatch(item.userId, true)
      })
      li.appendChild(watch)
    }
    list.appendChild(li)
  })
  box.hidden = activityState.items.length === 0
}
