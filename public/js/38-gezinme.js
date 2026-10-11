'use strict'

// Yazı kanallarında ve sohbetlerde gezinme (istek 17): tarayıcı geçmişi, okunmamış ayracı ve şeridi, yeni mesaj
// kapsülü, İstasyonlar listesindeki Özel Mesajlar grubu ve açık görünümün hatırlanması.
//
// Geçmiş (S2). Açılışta o anki kayıt kök kayda çevrilir: { telsiz: { v: 1, u, d: 0, view, id } }. Kişi başka bir
// konuşmaya geçince (oda, özel mesaj, Arkadaşlar) yeni kayıt eklenir. Adres ve # bölümü hiç değişmez, çünkü #
// bölümü anahtar ve davet gibi gizli veriler taşıyabilir. Sayfalar, arama, ayarlar, resim görüntüleyici ve profil
// kartı her genişlikte kendi kaydını ekler: { telsiz: { v: 1, u, d, overlay } }. Katman başka yoldan (Esc, Kapat,
// dışarı tıklama) kapanınca kaydı history.go ile geri alınır. Geri tuşu önce açık katmanı kapatır, katman yoksa
// önceki konuşmaya döner (selectChannel, showDm, showHome { fromHistory: true } ile). Kayıttaki kullanıcı
// kimliği uyuşmazsa veya kişi uygulamada değilse olay yok sayılır. Kök kayıttan geri basılınca tarayıcı
// uygulamadan çıkar, tuzak kurulmaz. d kaydın kökten uzaklığıdır, ileri ve geri yönü bununla ayrılır.
//
// Geçmiş işlemleri (pushState, replaceState, go) bir kuyrukta sırayla yapılır: history.go zaman uyumsuzdur, kendi
// popstate olayı gelene kadar sonraki işlemler bekler. Katman ve konuşma değişiklikleri aynı görev içinde
// toplanır, bir sonraki mikro görevde (navReconcile) beklenen geçmişle karşılaştırılır. Böylece sayfadaki bir
// satıra basmak (sayfa kapanır, oda açılır) sayfanın kaydını yeni odanın kaydıyla değiştirir.
//
// Okunmamış (S3, S4). Konuşma açılırken yüklemeden önceki son okunan mesaj saklanır. İlk okunmamış mesaj yüklüyse
// önüne Yeni mesajlar ayracı konur, ayraç görünür alanın üst kısmına kaydırılır ve üstte şerit (sayı, Okunmamışa
// Git, Okundu İşaretle) görünür. İlk okunmamış en yeni sayfada değilse konuşma son okunanın çevresiyle (around)
// yüklenir. Konuşma yalnızca kişi en alttayken okundu sayılır (04-meta.js markRead). Kişi yukarıdayken gelen mesaj
// kaydırma yapmaz, alttaki kapsül sayar.
//
// Özel Mesajlar grubu (S5). İstasyonlar kartında ve sayfasında yazı odalarının altında özel konuşmalar: okunmamışı
// olanlar önce, en çok NAV_DM_ROWS satır, fazlası Tüm Özel Mesajlar ile açılır. 1280 px altında sol sütun yoktur,
// üst çubuktaki Özel düğmesi İstasyonlar sayfasını bu grupta açar. Geniş ekranda okunmamışı olan en yeni
// konuşmayı açar.
//
// Görünümün hatırlanması (S12). Açık görünüm ({ mode, id }) kişiye özel anahtarda (userKey('view')) saklanır,
// sayfa yenilenince özel konuşma ve Arkadaşlar görünümü de geri gelir (04-meta.js openApp).

const NAV_OVERLAYS = ['search', 'settings', 'viewer', 'profile-card']
const NAV_POP_WAIT_MS = 2000
// Kişi bu kadar ekran yukarıdaysa yeni mesaj olmasa da En Alta Git kapsülü görünür
const NAV_FAR_SCREENS = 2
// Özel Mesajlar grubunda Tüm Özel Mesajlar açılmadan gösterilen en çok satır
const NAV_DM_ROWS = 6

const navState = {
  bound: false,
  on: false,
  u: null,
  // Kökten bu yana beklenen geçmiş: { view, id } konuşma kaydı veya { overlay } katman kaydı, sıra d'dir
  stack: [],
  // Bekleyen konuşma değişikliği: 'push' (kişinin eylemi) veya 'replace' (programın seçimi)
  convMode: '',
  ops: [],
  waiting: false,
  waitTimer: 0,
  scheduled: false,
  restoring: false,
  // Okunmamış ayracı ve şeridi: konuşma, ilk okunmamış mesajın kimliği ve zamanı, sayı, şerit açık mı
  unread: { channelId: null, id: null, since: 0, count: 0, bar: false },
  // Kişi yukarıdayken gelen mesaj sayısı (kapsül)
  newBelow: 0,
  divider: null,
  // Özel Mesajlar grubunda bütün konuşmalar açık mı (İstasyonlar kartı ve sayfası ortak)
  dmAll: false
}

// ------------------------------------------------------------------ geçmiş

function navIsOverlay (name) {
  return typeof name === 'string' && (name.indexOf('sheet-') === 0 || NAV_OVERLAYS.indexOf(name) !== -1)
}

function navOpenOverlays () {
  return layers.filter((layer) => navIsOverlay(layer.name)).map((layer) => layer.name)
}

function navCurrentConv () {
  const view = typeof currentViewMode === 'function' ? currentViewMode() : 'channel'
  const id = view === 'home' || state.channelId === null || state.channelId === undefined ? null : String(state.channelId)
  return { view: view, id: id }
}

function navSameConv (a, b) {
  if (!a || !b || a.overlay || b.overlay || a.view !== b.view) return false
  if (a.id === null || b.id === null) return a.id === b.id
  return sameId(a.id, b.id)
}

function navConvIndex () {
  let i = navState.stack.length - 1
  while (i > 0 && navState.stack[i].overlay) i -= 1
  return i
}

function navStateOf (entry, d) {
  const rec = { v: 1, u: navState.u, d: d }
  if (entry.overlay) {
    rec.overlay = entry.overlay
  } else {
    rec.view = entry.view
    rec.id = entry.id
  }
  return { telsiz: rec }
}

// Geçmiş kaydından giriş: { d, overlay } veya { d, view, id }. Bize ait değilse null.
function navEntryFrom (raw) {
  const s = raw && typeof raw === 'object' ? raw.telsiz : null
  if (!s || typeof s !== 'object' || s.v !== 1 || typeof s.d !== 'number' || !isFinite(s.d) || s.d < 0) return null
  if (!state.me || !sameId(s.u, state.me.id)) return null
  const d = Math.floor(s.d)
  if (typeof s.overlay === 'string') return { d: d, entry: { overlay: s.overlay } }
  const view = s.view === 'dm' || s.view === 'home' ? s.view : 'channel'
  const id = view === 'home' || s.id === null || s.id === undefined ? null : String(s.id)
  return { d: d, entry: { view: view, id: id } }
}

function navHistory () {
  return window.history && typeof window.history.pushState === 'function' ? window.history : null
}

// Model hemen güncellenir, tarayıcı geçmişine yazma kuyruğa girer
function navQueuePush (entry) {
  navState.stack.push(entry)
  navState.ops.push({ kind: 'push', state: navStateOf(entry, navState.stack.length - 1) })
}

function navQueueReplace (entry) {
  const d = navState.stack.length - 1
  navState.stack[d] = entry
  navState.ops.push({ kind: 'replace', state: navStateOf(entry, d) })
}

function navQueueGo (delta) {
  if (!delta) return
  if (delta < 0) navState.stack.length = Math.max(1, navState.stack.length + delta)
  navState.ops.push({ kind: 'go', delta: delta })
}

function navRun () {
  const hist = navHistory()
  while (!navState.waiting && navState.ops.length) {
    const op = navState.ops.shift()
    if (!hist) continue
    try {
      if (op.kind === 'push') {
        hist.pushState(op.state, '')
      } else if (op.kind === 'replace') {
        hist.replaceState(op.state, '')
      } else {
        navState.waiting = true
        clearTimeout(navState.waitTimer)
        navState.waitTimer = setTimeout(navPopTimeout, NAV_POP_WAIT_MS)
        hist.go(op.delta)
      }
    } catch (err) {
      navState.waiting = false
    }
  }
}

// Beklenen popstate gelmezse (geçmiş tarayıcıda daha kısaysa) kuyruk yine de sürer
function navPopTimeout () {
  navState.waiting = false
  navRun()
}

function navSchedule () {
  if (navState.scheduled) return
  navState.scheduled = true
  Promise.resolve().then(navReconcile)
}

// Uygulama açıldı: o anki kayıt kök kayıt olur. Önceki oturumun kayıtları kapanmadan kaldıysa önce geri alınır.
function navStart () {
  if (!state.me) return
  if (navState.on) navStop()
  navState.on = true
  navState.u = state.me.id
  navState.stack = [navCurrentConv()]
  navState.convMode = ''
  navState.ops.push({ kind: 'replace', state: navStateOf(navState.stack[0], 0) })
  navRun()
}

// Uygulamadan çıkıldı (oturum kapandı): geçmiş kök kayda geri sarılır, bundan sonraki popstate yok sayılır
function navStop () {
  const extra = navState.stack.length - 1
  navState.on = false
  navState.stack = []
  navState.convMode = ''
  navState.dmAll = false
  navUnreadReset(null)
  if (extra > 0) {
    navState.ops.push({ kind: 'go', delta: -extra })
    navRun()
  }
}

// Konuşma değişti (04-meta.js selectChannel, 15-dm.js showDm, 14-social.js showHome). Geçmişten gelen
// değişiklik kayıt eklemez. force: true ile programın yaptığı seçim (açılış, silinen oda) kaydı değiştirir.
function navOnConversation (opts) {
  const o = opts || {}
  if (navCurrentConv().view === 'home') navUnreadReset(null)
  navRememberView()
  if (!navState.on || o.fromHistory || navState.restoring) return
  if (!o.force) navState.convMode = 'push'
  else if (!navState.convMode) navState.convMode = 'replace'
  navSchedule()
}

function navLayersChanged () {
  if (navState.on) navSchedule()
}

// Beklenen geçmişi (konuşma kaydı ve üstündeki katman kayıtları) açık katmanlarla ve açık konuşmayla eşitler
function navReconcile () {
  navState.scheduled = false
  if (!navState.on) return
  if (!state.inApp || !state.me || !sameId(state.me.id, navState.u)) {
    navStop()
    return
  }
  const ci = navConvIndex()
  const have = navState.stack.slice(ci + 1).map((e) => e.overlay)
  const want = navOpenOverlays()
  const cur = navCurrentConv()
  if (!navSameConv(navState.stack[ci], cur)) {
    // Yeni konuşmanın kaydı eski konuşmanın üstündeki ilk katman kaydının yerine yazılır
    if (navState.convMode === 'push' && have.length) {
      navQueueGo(-(have.length - 1))
      navQueueReplace(cur)
    } else if (navState.convMode === 'push') {
      navQueuePush(cur)
    } else {
      navQueueGo(-have.length)
      navQueueReplace(cur)
    }
    want.forEach((name) => {
      navQueuePush({ overlay: name })
    })
  } else {
    let k = 0
    while (k < have.length && k < want.length && have[k] === want[k]) k += 1
    const pops = have.length - k
    const adds = want.slice(k)
    if (pops && adds.length) {
      navQueueGo(-(pops - 1))
      navQueueReplace({ overlay: adds[0] })
      adds.slice(1).forEach((name) => {
        navQueuePush({ overlay: name })
      })
    } else {
      navQueueGo(-pops)
      adds.forEach((name) => {
        navQueuePush({ overlay: name })
      })
    }
  }
  navState.convMode = ''
  navRun()
}

function navOnPopState (e) {
  if (navState.waiting) {
    navState.waiting = false
    clearTimeout(navState.waitTimer)
    navRun()
    return
  }
  if (!navState.on || !state.inApp) return
  const found = navEntryFrom(e ? e.state : null)
  if (!found) return
  const top = navState.stack.length - 1
  // Kilitli katman (ör. kurtarma kodu penceresi) açıkken gezinilmez: geçmiş eski yerine döner
  if (layers.some((layer) => layer.locked === true)) {
    if (found.d !== top) {
      navState.ops.push({ kind: 'go', delta: top - found.d })
      navRun()
    }
    return
  }
  const stack = navState.stack
  if (found.d > top) {
    // İleri: aradaki bilinmeyen kayıtlar açık konuşmanın kopyası sayılır
    const fill = stack[top] && !stack[top].overlay ? stack[top] : navCurrentConv()
    while (stack.length < found.d) stack.push(fill)
    stack.push(found.entry)
  } else {
    stack.length = found.d + 1
    stack[found.d] = found.entry
  }
  // Katmanı açık olmayan katman kaydı (ileri gidilince veya kayıt geride kalınca) atlanır
  if (found.entry.overlay && !findLayer(found.entry.overlay)) navQueueGo(-1)
  const ci = navConvIndex()
  const keep = stack.slice(ci + 1).map((entry) => entry.overlay)
  layers.slice().reverse().forEach((layer) => {
    if (keep.indexOf(layer.name) === -1) closeLayer(layer, true)
  })
  const conv = stack[ci]
  if (conv && !navSameConv(conv, navCurrentConv()) && !navRestore(conv)) {
    // Konuşma artık yok (oda silindi, özel konuşma kapandı): kayıt açık konuşmaya çevrilir
    stack[ci] = navCurrentConv()
    if (ci === stack.length - 1) navQueueReplace(stack[ci])
  }
  navRun()
}

function navRestore (conv) {
  navState.restoring = true
  let ok = false
  try {
    if (conv.view === 'dm') {
      if (typeof dmEntry === 'function' && dmEntry(conv.id) && typeof showDm === 'function') {
        showDm(conv.id, { fromHistory: true })
        ok = true
      }
    } else if (conv.view === 'home') {
      if (typeof showHome === 'function') {
        showHome(null, { fromHistory: true })
        ok = true
      }
    } else if (conv.id !== null && typeof findChannel === 'function') {
      const ch = findChannel(conv.id)
      if (ch && ch.type === 'text') {
        selectChannel(ch.id, { fromHistory: true })
        ok = true
      }
    }
  } catch (err) {
    window.console.error(err)
  } finally {
    navState.restoring = false
  }
  return ok && navSameConv(conv, navCurrentConv())
}

function navInit () {
  if (navState.bound) return
  navState.bound = true
  watchLayers(navLayersChanged)
  if (typeof window.addEventListener === 'function') window.addEventListener('popstate', navOnPopState)
}

// ------------------------------------------------------------------ okunmamış ayracı, şerit ve kapsül (S3, S4)

function navReadMark (channelId) {
  return Number(state.lastRead[channelId]) || 0
}

function navOwn (m) {
  return Boolean(state.me && sameId(m.authorId, state.me.id))
}

// İlk okunmamış mesajın sırası (son okunandan yeni, kendi mesajım değil). Okuma kaydı yoksa -1.
function navFirstUnread (messages, readMark) {
  if (!(readMark > 0)) return -1
  let i = 0
  while (i < messages.length) {
    if (Number(messages[i].id) > readMark && !navOwn(messages[i])) return i
    i += 1
  }
  return -1
}

function navCountUnread (messages, readMark) {
  if (!(readMark > 0)) return 0
  return messages.filter((m) => Number(m.id) > readMark && !navOwn(m)).length
}

// En yeni sayfanın hepsi son okunandan yeniyse ve daha eskisi varsa ilk okunmamış bu sayfada olmayabilir,
// konuşma son okunan mesajın çevresiyle (around) yeniden yüklenir
function navNeedsAround (messages, hasMore, readMark) {
  return readMark > 0 && hasMore === true && messages.length > 0 && Number(messages[0].id) > readMark
}

// Konuşma değişti veya yükleniyor: şerit, ayraç ve kapsül kalkar
function navUnreadReset (channelId) {
  navState.unread = { channelId: channelId === undefined ? null : channelId, id: null, since: 0, count: 0, bar: false }
  navState.newBelow = 0
  if (navState.divider && navState.divider.parentNode) navState.divider.parentNode.removeChild(navState.divider)
  navRenderBar()
  navRenderBelow()
}

// Yükleme bitti (06-messages.js loadChannel): ilk okunmamış mesaj yüklüyse ayraç konur ve şerit gösterilir.
// Ayracın öğesi döner (06-messages.js onu görünür alanın üst kısmına kaydırır), yoksa null.
function navShowUnread (channelId, readMark, knownUnread) {
  const i = navFirstUnread(state.messages, readMark)
  if (i === -1 || !sameId(channelId, state.channelId)) return null
  const first = state.messages[i]
  navState.unread = {
    channelId: channelId,
    id: first.id,
    since: Number(first.createdAt) || 0,
    count: Math.max(Number(knownUnread) || 0, navCountUnread(state.messages, readMark)),
    bar: true
  }
  regroup()
  navRenderBar()
  return navState.divider && navState.divider.parentNode ? navState.divider : null
}

function navDividerEl () {
  if (!navState.divider) {
    const node = h('div', 'unread-divider')
    node.setAttribute('role', 'separator')
    node.appendChild(h('span', 'unread-divider-text'))
    navState.divider = node
  }
  const text = navState.divider.querySelector('.unread-divider-text')
  text.textContent = t('nav.newDivider')
  navState.divider.setAttribute('aria-label', t('nav.newDivider'))
  return navState.divider
}

// Ayracı ilk okunmamış mesajın (silindiyse ondan sonraki ilk mesajın) önüne yerleştirir. 06-messages.js regroup
// her çizimden sonra çağırır. Ayracın önünde durduğu mesajın kimliği döner, ayraç yoksa null.
function navPlaceDivider () {
  const u = navState.unread
  const live = u.id !== null && sameId(u.channelId, state.channelId) && el.messageList && navCurrentConv().view !== 'home'
  const target = live ? state.messages.filter((m) => Number(m.id) >= Number(u.id))[0] : null
  const node = target ? state.nodes.get(String(target.id)) : null
  if (!node || node.parentNode !== el.messageList) {
    if (navState.divider && navState.divider.parentNode) navState.divider.parentNode.removeChild(navState.divider)
    return null
  }
  const divider = navDividerEl()
  if (node.previousSibling !== divider) el.messageList.insertBefore(divider, node)
  return target.id
}

// Üstteki şerit (#unread-bar): sayı, ilk okunmamışın saati, Okunmamışa Git ve Okundu İşaretle
function navBarEl () {
  let bar = byId('unread-bar')
  if (!bar && el.main && el.messages && el.messages.parentNode === el.main) {
    bar = h('div', 'unread-bar')
    bar.id = 'unread-bar'
    bar.setAttribute('role', 'status')
    bar.hidden = true
    const text = h('p', 'unread-bar-text')
    text.appendChild(h('span', 'unread-bar-count'))
    text.appendChild(h('span', 'unread-bar-since'))
    bar.appendChild(text)
    // İki düğme birlikte kayar: dar sütunda metnin altında tek satır olurlar
    const actions = h('div', 'unread-bar-actions')
    const jump = button('button button-small button-secondary unread-bar-jump', '', 'i-up')
    jump.id = 'unread-bar-jump'
    jump.appendChild(h('span', 'button-text'))
    jump.addEventListener('click', navJumpToUnread)
    actions.appendChild(jump)
    const read = button('button button-small unread-bar-read', '', 'i-check')
    read.id = 'unread-bar-read'
    read.appendChild(h('span', 'button-text'))
    read.addEventListener('click', navMarkAllRead)
    actions.appendChild(read)
    bar.appendChild(actions)
    el.main.insertBefore(bar, el.messages)
  }
  return bar
}

function navSinceText (ts) {
  const date = toDate(ts)
  return sameDay(date, new Date()) ? formatClock(date.getTime()) : formatShort(date.getTime())
}

function navRenderBar () {
  const u = navState.unread
  const show = u.bar && u.count > 0 && sameId(u.channelId, state.channelId) && navCurrentConv().view !== 'home' && !state.loading
  if (!show && !byId('unread-bar')) return
  const bar = navBarEl()
  if (!bar) return
  bar.hidden = !show
  if (!show) return
  bar.querySelector('.unread-bar-count').textContent = t('nav.unreadBar', { count: u.count })
  bar.querySelector('.unread-bar-since').textContent = u.since ? t('nav.unreadSince', { time: navSinceText(u.since) }) : ''
  byId('unread-bar-jump').querySelector('.button-text').textContent = t('nav.jumpToUnread')
  byId('unread-bar-read').querySelector('.button-text').textContent = t('nav.markRead')
}

// Okundu sayıldı (04-meta.js markRead): şerit ve kapsül kalkar, ayraç konuşmadan çıkılana kadar kalır
function navAfterRead (channelId) {
  if (sameId(navState.unread.channelId, channelId)) navState.unread.bar = false
  navState.newBelow = 0
  navRenderBar()
  navRenderBelow()
}

function navJumpToUnread () {
  const divider = navState.divider && navState.divider.parentNode ? navState.divider : null
  if (divider) {
    scrollToDivider(divider)
    navRenderBelow()
    return
  }
  // İlk okunmamış artık yüklü değil: konuşma son okunanın çevresiyle yeniden yüklenir
  if (state.channelId) loadChannel()
}

// Okundu İşaretle: daha yeni mesajlar yüklü değilse en yeni mesajın kimliği sunucudan alınır
async function navMarkAllRead () {
  const channelId = state.channelId
  if (!channelId) return
  if (!state.hasNewer) {
    markRead({ force: true })
    return
  }
  const gen = state.loadGen
  const res = await api('GET', '/api/messages?channel=' + encodeURIComponent(channelId) + '&limit=1')
  if (gen !== state.loadGen || !sameId(channelId, state.channelId)) return
  const list = res.status === 200 && res.data && Array.isArray(res.data.messages) ? res.data.messages : null
  if (!list) {
    toast(() => errorText(res, t('messages.loadFailed')), 'error')
    return
  }
  const last = list.length ? Number(list[list.length - 1].id) : 0
  if (last > navReadMark(channelId)) {
    state.lastRead[channelId] = last
    storeSetJson(userKey('read'), state.lastRead)
  }
  state.unread[channelId] = 0
  if (state.mentions) state.mentions[channelId] = 0
  renderBand()
  if (typeof renderHomeEntry === 'function') renderHomeEntry()
  navAfterRead(channelId)
}

// Kapsül (#new-below): kişi yukarıdayken gelen mesajları sayar, basınca en alta inilir ve okundu sayılır.
// Yeni mesaj yokken kişi çok yukarıdaysa En Alta Git olarak görünür.
function navBelowEl () {
  let wrap = byId('new-below')
  if (!wrap && el.messages && el.messageList) {
    wrap = h('div', 'new-below')
    wrap.id = 'new-below'
    wrap.hidden = true
    // Mesaj günlüğünün canlı bölgesi kapsülün sayısını ayrıca okumaz, düğmenin adı yeterli
    wrap.setAttribute('aria-live', 'off')
    const b = button('new-below-button', '', 'i-down')
    b.id = 'new-below-button'
    b.appendChild(h('span', 'button-text'))
    b.addEventListener('click', navGoBottom)
    wrap.appendChild(b)
    el.messages.insertBefore(wrap, el.messageList.nextSibling)
  }
  return wrap
}

function navFarFromBottom () {
  const box = el.messages
  if (!box || !box.clientHeight) return false
  return box.scrollHeight - box.scrollTop - box.clientHeight > NAV_FAR_SCREENS * box.clientHeight
}

function navRenderBelow () {
  const count = navState.newBelow
  const usable = Boolean(state.channelId) && !state.loading && !state.hasNewer && navCurrentConv().view !== 'home'
  const show = usable && (count > 0 || navFarFromBottom()) && !isNearBottom()
  if (!show && !byId('new-below')) return
  const wrap = navBelowEl()
  if (!wrap) return
  wrap.hidden = !show
  if (!show) return
  const b = byId('new-below-button')
  const text = count > 0 ? t('nav.newBelow', { count: count }) : t('nav.jumpToBottom')
  b.querySelector('.button-text').textContent = text
  b.classList.toggle('has-new', count > 0)
  const label = count > 0 ? text + ', ' + t('nav.newBelowLabel') : text
  b.setAttribute('aria-label', label)
  b.title = count > 0 ? t('nav.newBelowLabel') : text
}

// Kişi yukarıdayken açık konuşmaya mesaj geldi (06-messages.js insertMessage). Şerit açıksa sayısı da artar.
function navNewBelow () {
  navState.newBelow += 1
  const u = navState.unread
  if (u.bar && sameId(u.channelId, state.channelId)) {
    u.count += 1
    navRenderBar()
  }
  navRenderBelow()
}

// Kaydırma (06-messages.js onMessagesScroll)
function navOnScroll () {
  navRenderBelow()
}

function navGoBottom () {
  scrollToBottom()
  markRead()
  navState.newBelow = 0
  navRenderBelow()
  focusNode(el.composerInput && !el.composerInput.disabled ? el.composerInput : el.messages)
}

function navOnLanguage () {
  if (navState.divider && navState.divider.parentNode) navDividerEl()
  navRenderBar()
  navRenderBelow()
}

// ------------------------------------------------------------------ Özel Mesajlar grubu (S5)

function navUnreadOf (id) {
  const n = Number(state.unread[id])
  return isFinite(n) && n > 0 ? Math.floor(n) : 0
}

function navOpenDmId () {
  return navCurrentConv().view === 'dm' ? state.channelId : null
}

// Özel konuşmaların grup sırası: okunmamışı olanlar önce, iki bölümde de son mesaja göre yeniden eskiye. Açık
// konuşmanın okunmamışı sayılmaz (kişi onu zaten görüyor).
function navDmOrder (entries, unreadOf) {
  return entries.map((d, i) => ({ d: d, i: i, n: unreadOf(d.id) > 0 ? 1 : 0, at: Number(d.lastMessageAt) || 0 }))
    .sort((a, b) => (b.n - a.n) || (b.at - a.at) || (a.i - b.i))
    .map((x) => x.d)
}

// Geniş ekranda Özel düğmesinin açtığı konuşma: okunmamışı olan en yeni konuşma, yoksa son açılan, o da yoksa en
// yeni konuşma
function navDmPick (entries, unreadOf, lastId) {
  const sorted = navDmOrder(entries, () => 0)
  const unread = sorted.filter((d) => unreadOf(d.id) > 0)[0]
  if (unread) return unread
  const last = lastId === null || lastId === undefined ? null : sorted.filter((d) => sameId(d.id, lastId))[0]
  return last || sorted[0] || null
}

// 04-meta.js fillRoomList grubu çizer: satırlar data-dm-id taşır (21-band.js onStationRowClick açar), son satır
// konuşma sayısı NAV_DM_ROWS'u aşınca Tüm Özel Mesajlar düğmesidir. Hiç özel konuşma yoksa grup gösterilmez.
function navDmGroup () {
  const entries = typeof bandDmEntries === 'function' && state.me ? bandDmEntries() : []
  if (!entries.length) return null
  const open = navOpenDmId()
  const unreadOf = (id) => (open !== null && sameId(id, open) ? 0 : navUnreadOf(id))
  const ordered = navDmOrder(entries, unreadOf)
  const shown = navState.dmAll ? ordered : ordered.slice(0, NAV_DM_ROWS)
  const stations = shown.map((d) => {
    const n = unreadOf(d.id)
    const name = shownName(d.userId)
    return {
      key: 'dm-' + d.id,
      kind: 'conv',
      type: 'dm',
      id: d.id,
      userId: d.userId,
      name: name,
      sub: '',
      unread: 0,
      // Özel mesajın okunmamışı Özel düğmesindeki gibi anma rengindedir
      mention: n,
      tuned: open !== null && sameId(d.id, open),
      blocked: typeof isBlocked === 'function' && isBlocked(d.userId),
      status: shownStatus(d.userId),
      people: [d.userId],
      label: n ? t('dm.itemUnreadLabel', { name: name, count: n }) : t('dm.itemLabel', { name: name })
    }
  })
  if (ordered.length > NAV_DM_ROWS) {
    const label = navState.dmAll ? t('rooms.dmFewer') : t('rooms.dmAll')
    stations.push({ key: 'dm-all', kind: 'more', type: 'more', name: label, sub: '', unread: 0, mention: 0, tuned: false, expanded: navState.dmAll, count: ordered.length, label: label + ', ' + ordered.length })
  }
  return { key: 'dm', label: t('rooms.dmGroup'), stations: stations, empty: '' }
}

// Tüm Özel Mesajlar: grup bütün konuşmaları gösterir veya ilk satırlara döner, odak düğmede kalır
function navToggleDmAll () {
  navState.dmAll = !navState.dmAll
  if (typeof renderBand === 'function') renderBand()
}

// Özel düğmesi 1280 px altında İstasyonlar sayfasını açınca ilk odak gruptaki ilk konuşmadır
function navDmSheetFocus (panel) {
  return panel ? panel.querySelector('.room-row-dm') : null
}

// ------------------------------------------------------------------ görünümün hatırlanması (S12)

function navRememberView () {
  if (!state.me || typeof storeSetJson !== 'function') return
  const cur = navCurrentConv()
  if (cur.view !== 'home' && cur.id === null) return
  storeSetJson(userKey('view'), { mode: cur.view, id: cur.view === 'home' ? null : cur.id })
}

// Açılışta geri yüklenecek görünüm: özel konuşma hâlâ listedeyse { mode: 'dm', id }, Arkadaşlar görünümü
// { mode: 'home' }, yoksa null (04-meta.js openApp hatırlanan yazı odasını açar)
function navSavedView () {
  if (!state.me || typeof storeGetJson !== 'function') return null
  const v = storeGetJson(userKey('view'), null)
  if (!v || typeof v !== 'object') return null
  if (v.mode === 'home') return { mode: 'home', id: null }
  if (v.mode === 'dm' && v.id !== null && v.id !== undefined && typeof dmEntry === 'function' && dmEntry(v.id)) {
    return { mode: 'dm', id: dmEntry(v.id).id }
  }
  return null
}
