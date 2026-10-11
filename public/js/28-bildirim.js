'use strict'

// Bildirimler (#activity): sol sütunda telsiz kartının üstündeki kısa olay listesi. Üç tür olay yazılır:
// - Ekran paylaşımı başladı: yanında İzle düğmesi durur, paylaşım bitince veya ses odasından ayrılınca kayıt
//   kalkar (22-cast.js castOnScreenEvent ve castSync, activityShare ve activityClearShares). Paylaşım ses
//   bağlantıları üzerinden duyurulduğu için yalnızca aynı ses odasındaki paylaşımlar görünür.
// - Ses odasına katılma ve ayrılma: her metada ses kadroları (meta.voice) bir öncekiyle karşılaştırılır
//   (04-meta.js applyMeta, activityOnMeta). İlk meta yalnızca karşılaştırma tabanıdır, kendi hareketlerin
//   yazılmaz.
// - Telsiz DJ'ye başkasının parça eklemesi: aynı ses odasında motorun notice olayından (23-dj.js djOnNotice,
//   activityDj). Hangi yazı odasında olunursa olunsun görünür, parçanın adı kuyruktan canlı okunur.
// Liste en çok ACTIVITY_MAX kayıt tutar (süren paylaşımların kaydı korunur), en yeni üsttedir. Kayıt yoksa kart
// gizlidir. Liste geniş ekranda görünürken paylaşım bildirimi sağ üstte ayrıca açılmaz (castShowNotice,
// activityShown).

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

// Liste dolunca en eski kayıt düşer. Süren ekran paylaşımının kaydı (İzle düğmesi) diğer kayıtlar varken
// düşmez: sık gelen Telsiz DJ, katılma ve ayrılma kayıtları onu listeden atmaz (liste görünürken paylaşım
// bildirimi ayrıca açılmaz). Liste paylaşım kayıtlarıyla doluysa yeni paylaşım en eskisini düşürür, başka türden
// yeni kayıt yazılmaz.
function activityAdd (item) {
  activityState.seq++
  const items = activityState.items
  items.unshift(Object.assign({ id: activityState.seq, at: Date.now() }, item))
  while (items.length > ACTIVITY_MAX) {
    let drop = items.length - 1
    while (drop > 0 && items[drop].kind === 'share') drop--
    if (items[drop].kind === 'share') drop = items.length - 1
    items.splice(drop, 1)
  }
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

// Telsiz DJ: aynı ses odasında başkası kuyruğa parça ekledi. title ve type kaydın parça belleğidir (23-dj.js
// djLiveTitle doldurur): ad sonradan gelince kayda yazılır, parça kuyruktan çıkınca kayıt bu adı gösterir.
function activityDj (userId, channelId, trackId, title, type) {
  if (userId === null || userId === undefined) return
  activityAdd({
    kind: 'dj',
    userId: String(userId),
    channelId: channelId === null || channelId === undefined ? null : String(channelId),
    trackId: trackId || null,
    title: typeof title === 'string' ? title : '',
    type: type === 'youtube' || type === 'file' ? type : null
  })
  renderActivity()
}

// Motorun her durum değişikliğinde Telsiz DJ kayıtları yenilenir: parçanın adı ekleme anında bilinmeyebilir,
// sonradan gelir. Kaydın belleği liste çizilmemiş olsa da güncellenir, parça kuyruktan çıkınca ad korunur.
function activityDjRefresh () {
  const texts = new Map()
  activityState.items.forEach((item) => {
    if (item.kind === 'dj') texts.set(item.id, activityText(item))
  })
  const list = el.activityList
  if (!list || !texts.size) return
  Array.from(list.children).forEach((li) => {
    const value = texts.get(Number(li.getAttribute('data-activity-id')))
    const text = value === undefined ? null : li.querySelector('.activity-text')
    if (text && text.textContent !== value) text.textContent = value
  })
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
  // Kayıt djLiveTitle'a parça belleği olarak verilir (ad ve tür kayda yazılır)
  if (item.kind === 'dj') return t('activity.djAdd', { name: name, title: typeof djLiveTitle === 'function' ? djLiveTitle(item.trackId, item) : item.title })
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
    li.setAttribute('data-activity-id', String(item.id))
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
