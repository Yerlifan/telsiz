'use strict'

// Yazı kanallarında ve sohbetlerde gezinme (istek 17): tarayıcı geçmişi.
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

const NAV_OVERLAYS = ['search', 'settings', 'viewer', 'profile-card']
const NAV_POP_WAIT_MS = 2000

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
  restoring: false
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
  if (extra > 0) {
    navState.ops.push({ kind: 'go', delta: -extra })
    navRun()
  }
}

// Konuşma değişti (04-meta.js selectChannel, 15-dm.js showDm, 14-social.js showHome). Geçmişten gelen
// değişiklik kayıt eklemez. force: true ile programın yaptığı seçim (açılış, silinen oda) kaydı değiştirir.
function navOnConversation (opts) {
  const o = opts || {}
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
