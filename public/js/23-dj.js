'use strict'

// Telsiz DJ arayüzü (Ek L2, KONSEPT 8): motorun (public/music.js, window.TelsizMusic) uygulamaya bağlanması,
// DJ kartı (#dj), ses odası kadrosundaki "Telsiz DJ" öğesi, yazma alanındaki "/" komutları, mesajdaki ses
// dosyası kartının "DJ'de çal" düğmesi ve sunucu ayarı değişikliklerinin karta yansıması.
// /çal şarkı adı (istek 5): sahip açtıysa (meta.music.search) arama sunucuda yapılır (POST /api/music/search),
// ilk sonuç başlığıyla kuyruğa eklenir. İstemci YouTube'a hiçbir istek göndermez. Arama kapalıysa veya
// yapılamazsa kartta YouTube'un sonuç sayfasına giden bir bağlantı gösterilir (yeni sekmede açılır).
//
// Motor tek örnektir (djEngine). Taşıma 01-core.js api() yardımcısıyla kurulur (POST /api/music/state, ek
// indirme GET /api/uploads/<id>), durum zarfı etkin grup anahtarıyla mühürlenir (E2EE.sealJson) ve oda ile
// "music" bağlamına bağlıdır (motor denetler). Poll sorgusuna &muv= (djPollParam) ve yanıtlar djIngest ile,
// /api/state yanıtı djIngestState ile, meta güncellemeleri djOnMeta ile motora verilir (05-poll.js, 03-auth.js).
// Bu cihazın ses odası VoiceClient anlık görüntüsünden (snap) izlenir: #radio[data-state] ve kadro değişimi
// MutationObserver ile, ayrıca saniyelik denetimle.
//
// Yerleşim: geniş ekranda (1280 ve üstü) çalan veya kuyrukta parça varken kart telsiz kartının solunda bir
// sütundur. Boşken, 1280 altında ve ekran paylaşımı sahnesi açıkken (K7.2: #cast görünür veya data-cast="live") kart kadrodaki Telsiz DJ öğesinden açılan
// sayfaya iner (12-init.js sayfa yığını, 'dj' adıyla), telefonda alttan açılır. Yayın bitince yerine döner.
// YouTube oynatıcı alanı (.dj-yt) motora attachPlayer ile bir kez verilir ve hiç temizlenmez. Alan en az
// 200x200 CSS pikseli ve görünürdür, üstüne hiçbir öğe konmaz (dokunarak başlat, uyarılar ve hata metinleri
// alanın altındadır). Oynatıcı görünmezse motor YouTube parçasını bu cihazda duraklatır (music.js syncPlayer).
// Köşedeki oynatıcı: kart görünmezken (sayfa kipinde sayfa kapalı), üstünü bir katman örterken (Ayarlar,
// başka bir sayfa, menü, pencere) veya "Yüzen Oynatıcı" açıkken yüzen kutu (oynatıcı alanı ya da dosya
// parçasının dalga biçimi ve altında başlık, duraklat, Taşı, Küçült ve "DJ'yi aç" düğmeleri olan çubuk)
// yalnızca CSS sınıflarıyla dört köşeden birine sabitlenir (djApplyLayout, djPlaceDock). Kutu çubuğundan
// sürüklenir ve en yakın köşeye oturur (dockDrag), köşe cihazda saklanır (telsiz.djDock), alt köşede yazma
// alanının ve telsiz kartının üstüne çıkar, üst köşede bandın ve sohbet başlığının altında durur, yer oldukça
// kartın düğmelerine inmez ve görünüm alanında kalır. Ayarlar gibi ana görünümü örten bir katman açıkken kutu
// seçilen yandaki alt köşededir. Küçültülen kutuda yalnızca çubuk kalır, YouTube parçası bu cihazda bekletilir.
// Çerçeve ve ataları DOM'da hiç taşınmaz (taşınan çerçeve yeniden yüklenir), kart visibility ile gizlenir.
// Böylece müzik ses odasından ayrılana kadar çalmaya devam eder.
// Çizim: motorun parça ve durum olaylarında kart hemen çizilir, diğer değişiklikler bir sonraki karede
// toplanır. Sayfa gizliyken (arka plandaki sekme, simge durumundaki pencere) tarayıcı kareleri bekletir,
// çizim zamanlayıcıyla yapılır ve saniyelik denetim kartı her zaman çizer.

const DJ_TICK_MS = 500
// Duyuru parçanın adını en çok bu kadar bekler. Ad sonradan gelirse ekleyenin kendi duyurusu DJ_NOTICE_EDIT_MS
// (06-messages.js) içinde düzenlenir, konuşmayı açık tutanlar bu düzenlemeyi "düzenlendi" etiketsiz görür.
const DJ_TITLE_WAIT_MS = 8000
// Bu kadar eski bir işlemin bildirimi Bildirimler listesine yazılmaz (odaya sonradan katılınca gelen son işlem)
const DJ_NOTICE_FRESH_MS = 15000
// Perdesiz küçük katmanlar: kartın yanında açılabilir, oynatıcıyı yalnızca üstüne gelirse örter. Diğer
// katmanlar (Ayarlar, sayfalar ve perdeleri, pencereler, görüntüleyici, tam ekran yayın) her zaman örter.
// 'game-color' Renk masasındaki Joker renk seçicisidir (37-renk.js), yayın panelinin içinde durur, ana görünümü
// örtmez: açıkken köşedeki oynatıcı telsiz kartının ses düğmelerine inmez.
const DJ_POPOVER_LAYERS = ['emoji', 'msg-menu', 'peer', 'profile-card', 'status-menu', 'social-menu', 'frekans-menu', 'band-help', 'search', 'mic-menu', 'game-color']
const DJ_WAVE_BARS = 30
// Şarkı adıyla arama (istek 5): arama yapılamayınca kartta verilen YouTube sonuç sayfası ve sunucu ucunun hata
// kodlarının karşılığı olan music.errors.* kodları
const DJ_SEARCH_PAGE = 'https://www.youtube.com/results?search_query='
const DJ_SEARCH_ERRORS = {
  search_unavailable: 'search_unavailable',
  search_failed: 'search_failed',
  rate_limited: 'search_rate',
  search_daily_limit: 'search_daily',
  bad_query: 'search_bad_query',
  not_in_voice: 'not_in_voice',
  dj_restricted: 'dj_restricted',
  dj_disabled: 'dj_disabled',
  channel_not_found: 'not_in_voice'
}
// Bu hatalarda kartta YouTube'da arama bağlantısı gösterilir
const DJ_SEARCH_MISS = ['search_unavailable', 'search_failed', 'search_daily', 'search_no_results']
const DJ_OK_KEYS = {
  play: 'music.ok.added',
  skip: 'music.ok.skipped',
  pause: 'music.ok.paused',
  resume: 'music.ok.resumed',
  stop: 'music.ok.stopped',
  remove: 'music.ok.removed'
}

const dj = {
  engine: null,
  failed: false,
  ready: false,
  snap: null,
  ui: null,
  voiceRoom: null,
  castLive: false,
  sheetMode: false,
  queueKey: '',
  waveKey: '',
  notice: null,
  crewLi: null,
  crewFocus: false,
  renderQueued: false,
  renderTimer: 0,
  marksKey: '',
  docked: false,
  dockSticky: null,
  layoutBusy: false,
  dockBottom: null,
  minimized: false,
  desktopWatched: false,
  mediaKey: null,
  mediaPosKey: '',
  mediaPosAt: 0,
  consentRow: null,
  consentWarnFor: null,
  titleWatch: [],
  // Şarkı adıyla arama: son başlatılan aramanın sorgusu (yanıtı gelene kadar), her aramada ve ses odası her
  // değiştiğinde artan sıra numarası ve arama yapılamayınca kartta gösterilen { query, code, room }
  searching: null,
  searchSeq: 0,
  searchMiss: null
}

function djMusic () {
  const M = window.TelsizMusic
  return M && typeof M.create === 'function' ? M : null
}

// Anahtar bu cihaza eklendi: anahtarı olmadığı için açılamayan müzik durumları yeniden çözülür
function djRekey () {
  const engine = dj.engine
  if (!engine || typeof engine.rekey !== 'function') return
  try {
    engine.rekey()
  } catch (err) {
    window.console.error(err)
  }
}

// Motor: ilk çağrıda kurulur. Kurulamazsa (betik yok, eski tarayıcı) arayüz DJ'siz çalışır.
function djEngine () {
  if (dj.engine || dj.failed) return dj.engine
  const M = djMusic()
  if (!M) {
    dj.failed = true
    return null
  }
  try {
    dj.engine = M.create({
      transport: M.createHttpTransport({ api: api }),
      seal: (obj) => window.E2EE.sealJson(activeKid(), obj),
      open: (envelope) => window.E2EE.openJson(envelope),
      canSeal: () => hasActiveKey(),
      me: () => (state.me ? state.me.id : null),
      storage: {
        get: (key) => storeGet(key),
        set: (key, value) => {
          storeSet(key, value)
        },
        remove: (key) => {
          storeRemove(key)
        }
      },
      t: t
    })
  } catch (err) {
    window.console.error(err)
    dj.failed = true
    dj.engine = null
    return null
  }
  const engine = dj.engine
  engine.on('change', (snapshot) => {
    dj.snap = snapshot
    djRenderNow()
    djCheckTitles()
    if (typeof activityDjRefresh === 'function') activityDjRefresh()
  })
  // Parça değişti: olay oynatıcı kurulmadan önce gelir, oynatıcı alanı önceden görünür olur
  engine.on('track', () => {
    dj.snap = engine.snapshot()
    djRenderNow()
  })
  engine.on('notice', djOnNotice)
  // Rıza sorusu: telsiz kartındaki uyarı ve kısa bildirim (djSyncConsentWarn)
  engine.on('consentneeded', djRenderNow)
  engine.on('tapneeded', () => {
    // Köşedeki oynatıcının çubuğunda dokunarak başlatma düğmesi zaten vardır
    if (!djCardShown() && !dj.docked) toast(() => t('dj.tapViaCrew'), '', 8000)
  })
  return engine
}

function djSnapshot () {
  const engine = djEngine()
  if (!engine) return null
  if (!dj.snap) dj.snap = engine.snapshot()
  return dj.snap
}

// 05-poll.js: poll sorgusunun muv değeri
function djPollParam () {
  const engine = djEngine()
  return engine ? engine.pollParam() : '0'
}

// 05-poll.js: poll yanıtı (music, muv, now, boot). t0 ve t1 isteğin gönderilme ve alınma zamanları.
function djIngest (data, t0, t1) {
  const engine = djEngine()
  if (!engine || !data) return
  try {
    engine.ingest(data, { t0: t0, t1: t1 })
  } catch (err) {
    window.console.error(err)
  }
}

// 03-auth.js: /api/state yanıtı (meta önce, ardından müzik haritası ve sunucu saati)
function djIngestState (data) {
  const engine = djEngine()
  if (!engine || !data) return
  try {
    if (state.meta) engine.handleMeta(state.meta, state.me ? state.me.id : null)
    engine.ingest(data)
  } catch (err) {
    window.console.error(err)
  }
  djRenderSoon()
}

// 05-poll.js applyMetaUpdate ve 11-settings.js: meta.music, meta.voice ve etkin anahtar
function djOnMeta () {
  const engine = djEngine()
  if (!engine || !state.meta) return
  try {
    engine.handleMeta(state.meta, state.me ? state.me.id : null)
  } catch (err) {
    window.console.error(err)
  }
  djSyncVoice()
  djRenderSoon()
}

// Bu cihazın ses odası: bağlantı tamamlanınca oda, ayrılınca null. Özel mesaj araması (snapshot.private) ses
// odası sayılmaz, Telsiz DJ orada kullanılmaz.
function djSyncVoice () {
  const engine = djEngine()
  if (!engine) return
  let room = null
  if (state.inApp && typeof snap === 'function') {
    const s = snap()
    if (s.channelId !== null && s.channelId !== undefined && !s.joining && !s.private) room = s.channelId
  }
  if (room === dj.voiceRoom) return
  dj.voiceRoom = room
  dj.searchMiss = null
  // Önceki odada süren aramanın "aranıyor" satırı yeni odada görünmez, yanıtı kartı değiştirmez ve bulunan parça
  // hiçbir odaya eklenmez (djPlaySearch)
  dj.searching = null
  dj.searchSeq += 1
  // Küçültülmüş oynatıcı yeni odada yeniden açık başlar, medya tuşuyla veya kilit ekranından verilen duraklatma
  // da önceki odada kalır (yerel bekletme 'media')
  dj.minimized = false
  if (typeof engine.setLocalHold === 'function') engine.setLocalHold('media', false)
  engine.setVoiceRoom(room)
  djRenderSoon()
}

// ------------------------------------------------------------------ yardımcılar

function djTime (ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const pad = (n) => (n < 10 ? '0' + n : String(n))
  return hours ? hours + ':' + pad(minutes) + ':' + pad(seconds) : minutes + ':' + pad(seconds)
}

function djTrackTitle (track) {
  if (!track) return ''
  if (track.title) return track.title
  return t(track.type === 'youtube' ? 'music.untitledYouTube' : 'music.untitledFile')
}

function djSourceText (track) {
  return t(track.type === 'youtube' ? 'dj.sourceYouTube' : 'dj.sourceFile')
}

function djByText (track) {
  const name = track.addedBy !== null && track.addedBy !== undefined ? shownName(track.addedBy) : ''
  if (track.type === 'file' && track.file) return t('dj.byLineFile', { source: djSourceText(track), size: formatSize(track.file.size), name: name })
  return t('dj.byLine', { source: djSourceText(track), name: name })
}

function djErrorText (code) {
  const key = 'music.errors.' + code
  return hasText(key) ? t('music.errors.' + code) : t('music.errors.server')
}

function djRoomName (room) {
  const ch = room !== null && room !== undefined ? findChannel(room) : null
  return ch ? ch.name : ''
}

// Kart gösterilmeli mi: oturum açık, bu cihaz bir ses odasında, sunucu DJ'yi destekliyor ve açık
function djShouldShow () {
  const s = djSnapshot()
  return Boolean(s && state.inApp && dj.voiceRoom !== null && s.supported && s.enabled)
}

// Kart görünür mü (köşedeki oynatıcı açıkken kart görünmezdir, yalnızca oynatıcı ve çubuğu görünür)
function djCardShown () {
  return Boolean(el.dj && !el.dj.hidden && !dj.docked)
}

// Ekran paylaşımı sahnesi açık mı (K7.2). 22-cast.js #cast'ı gösterir veya data-cast="live" koyar.
function djDetectCast () {
  const live = (node) => Boolean(node && node.getAttribute && node.getAttribute('data-cast') === 'live')
  const cast = el.cast || byId('cast')
  return Boolean((cast && !cast.hidden) || live(cast) || live(el.appView) || live(document.body))
}

// Çalan veya kuyrukta bekleyen parça var mı
function djHasTracks () {
  const s = djSnapshot()
  const session = s ? s.session : null
  return Boolean(session && (session.current || (session.queue && session.queue.length)))
}

// Sayfa kipi: dar ekran, yayın sahnesi (K7.2) veya boş DJ. KONSEPT 3: sütun "Telsiz DJ çalarken" açılır. Boş
// kart ("Henüz parça yok") geniş ekranda ayrı sütun açıp ortada boşluk bırakmaz, kadrodaki Telsiz DJ öğesinden
// yan sayfada açılır. Parça eklenince kart sütuna geçer, kuyruk boşalınca sayfaya döner.
function djIsSheetMode () {
  return window.innerWidth < 1280 || dj.castLive || !djHasTracks()
}

function djButton (className, text, iconName) {
  const b = h('button', className)
  b.type = 'button'
  if (iconName) b.appendChild(icon(iconName))
  const label = h('span', 'dj-button-text', text || '')
  b.appendChild(label)
  return b
}

// Özniteliği yalnızca değişince yazar (null kaldırır): saniyelik çizimde gereksiz DOM değişikliği olmaz
function djAttr (node, name, value) {
  if (!node) return
  if (value === null) {
    if (node.hasAttribute(name)) node.removeAttribute(name)
  } else if (node.getAttribute(name) !== value) {
    node.setAttribute(name, value)
  }
}

function djSetText (node, text) {
  if (node && node.textContent !== text) node.textContent = text
}

// ------------------------------------------------------------------ kart

function djBuild () {
  const card = el.djCard
  if (!card || dj.ui) return
  const ui = {}
  clear(card)
  const kicker = h('p', 'kicker dj-kicker')
  kicker.appendChild(h('span', 'dj-led'))
  ui.kickerText = h('span', 'dj-kicker-text')
  kicker.appendChild(ui.kickerText)
  ui.tag = h('span', 'dj-tag')
  kicker.appendChild(ui.tag)
  ui.state = h('span', 'dj-state')
  kicker.appendChild(ui.state)
  card.appendChild(kicker)

  // Oynatıcı alanı: YouTube çerçevesi, rıza kartı, YouTube kapalı uyarısı, dosya dalga biçimi veya boş durum
  const stage = h('div', 'dj-stage')
  ui.stage = stage
  // Yüzen kutu: YouTube oynatıcı alanı, dosya parçasının dalga biçimi ve köşedeki oynatıcının çubuğu. Köşeye
  // alınınca yalnızca bu kutu sabitlenir ve sürüklenir. Kutu çerçeve kurulmadan önce yapılır, sonra hiç taşınmaz.
  ui.float = h('div', 'dj-float')
  stage.appendChild(ui.float)
  ui.yt = h('div', 'dj-yt')
  ui.yt.setAttribute('role', 'group')
  ui.float.appendChild(ui.yt)

  ui.wave = h('div', 'dj-wave')
  ui.wave.setAttribute('aria-hidden', 'true')
  ui.waveBars = h('span', 'dj-wave-bars')
  ui.wave.appendChild(ui.waveBars)
  ui.float.appendChild(ui.wave)

  // Köşedeki oynatıcının çubuğu: yalnızca köşedeyken görünür, oynatıcı alanının altında durur (üstüne binmez).
  // Çubuk sürükleme tutamağıdır (düğmeleri dışında).
  ui.dock = h('div', 'dj-dock')
  ui.dock.setAttribute('role', 'group')
  ui.dock.appendChild(h('span', 'dj-led'))
  ui.dockTitle = h('span', 'dj-dock-title')
  ui.dock.appendChild(ui.dockTitle)
  ui.dockToggle = button('icon-button dj-dock-toggle', '', 'i-pause', '')
  ui.dockToggle.addEventListener('click', () => {
    const engine = djEngine()
    const s = djSnapshot()
    // Dokunarak başlatma bu dokunuşla yapılır (kullanıcı hareketi). Bu cihazda yerel bekletme varsa düğme yalnızca
    // bekletmeyi kaldırır (oda durumu değişmez), değilse kart düğmesi gibi herkes için duraklatır veya sürdürür.
    if (engine && s && s.player && s.player.needsTap) engine.unlock()
    else if (engine && djDockHold(s)) djReleaseHolds()
    else djOnToggle()
  })
  ui.dock.appendChild(ui.dockToggle)
  ui.dockMove = button('icon-button dj-dock-move', '', 'i-grip', '')
  ui.dockMove.addEventListener('click', djMoveDock)
  ui.dock.appendChild(ui.dockMove)
  ui.dockMin = button('icon-button dj-dock-min', '', 'i-down', '')
  ui.dockMin.addEventListener('click', djToggleMinimized)
  ui.dock.appendChild(ui.dockMin)
  ui.dockOpen = button('icon-button dj-dock-open', '', 'i-expand', '')
  ui.dockOpen.addEventListener('click', djOpenFromDock)
  ui.dock.appendChild(ui.dockOpen)
  ui.float.appendChild(ui.dock)
  dockDrag(ui.float, ui.dock, {
    canStart: (e) => dj.docked && !(e.target && e.target.closest && e.target.closest('button')),
    onDrop: (corner) => {
      djSetDockCorner(corner)
      djRenderNow()
    }
  })

  ui.consent = h('div', 'dj-consent')
  ui.consent.appendChild(icon('i-shield', 'dj-consent-icon'))
  ui.consentTitle = h('p', 'dj-consent-title')
  ui.consentTitle.id = 'dj-consent-title'
  ui.consent.setAttribute('role', 'group')
  ui.consent.setAttribute('aria-labelledby', 'dj-consent-title')
  ui.consent.appendChild(ui.consentTitle)
  ui.consentText = h('p', 'dj-consent-text')
  ui.consent.appendChild(ui.consentText)
  ui.consentAccept = djButton('button dj-consent-accept')
  ui.consentAccept.addEventListener('click', () => {
    const engine = djEngine()
    if (engine) engine.setConsent(true)
  })
  ui.consent.appendChild(ui.consentAccept)
  ui.consentDecline = djButton('button button-ghost dj-consent-decline')
  ui.consentDecline.addEventListener('click', () => {
    const engine = djEngine()
    if (engine) engine.setConsent(false)
  })
  ui.consent.appendChild(ui.consentDecline)
  stage.appendChild(ui.consent)

  ui.blocked = h('div', 'dj-blocked')
  ui.blocked.appendChild(icon('i-block', 'dj-blocked-icon'))
  ui.blockedText = h('p', 'dj-blocked-text')
  ui.blocked.appendChild(ui.blockedText)
  stage.appendChild(ui.blocked)

  ui.empty = h('div', 'dj-empty')
  ui.empty.appendChild(icon('i-music', 'dj-empty-icon'))
  ui.emptyTitle = h('p', 'dj-empty-title')
  ui.empty.appendChild(ui.emptyTitle)
  ui.emptyHint = h('p', 'dj-empty-hint')
  ui.empty.appendChild(ui.emptyHint)
  stage.appendChild(ui.empty)
  card.appendChild(stage)

  // Oynatıcı alanının altındaki uyarı satırı: dokunarak başlat, yerel duraklatma, görünürlük, hata
  ui.alert = h('div', 'dj-alert')
  ui.alertText = h('p', 'dj-alert-text')
  ui.alert.appendChild(ui.alertText)
  ui.alertAction = djButton('button button-small dj-alert-action')
  ui.alertAction.addEventListener('click', djOnAlertAction)
  ui.alert.appendChild(ui.alertAction)
  card.appendChild(ui.alert)

  ui.consentNote = h('p', 'dj-hint dj-consent-note')
  card.appendChild(ui.consentNote)

  ui.now = h('div', 'dj-now')
  ui.title = h('p', 'dj-title')
  ui.now.appendChild(ui.title)
  ui.by = h('p', 'dj-by')
  ui.now.appendChild(ui.by)
  ui.time = h('div', 'dj-time')
  ui.timeSr = h('span', 'sr-only')
  ui.time.appendChild(ui.timeSr)
  ui.pos = h('span', 'dj-pos')
  ui.pos.setAttribute('aria-hidden', 'true')
  ui.time.appendChild(ui.pos)
  ui.bar = h('span', 'dj-bar')
  ui.bar.setAttribute('aria-hidden', 'true')
  ui.barFill = h('i', 'dj-bar-fill')
  ui.bar.appendChild(ui.barFill)
  ui.time.appendChild(ui.bar)
  ui.dur = h('span', 'dj-dur')
  ui.dur.setAttribute('aria-hidden', 'true')
  ui.time.appendChild(ui.dur)
  ui.now.appendChild(ui.time)
  const ctrl = h('div', 'dj-ctrl')
  ui.toggle = djButton('button button-secondary dj-toggle', '', 'i-pause')
  ui.toggle.addEventListener('click', djOnToggle)
  ctrl.appendChild(ui.toggle)
  ui.skip = djButton('button button-secondary dj-skip', '', 'i-skip')
  ui.skip.addEventListener('click', () => {
    djAction('skip', (engine) => engine.skip())
  })
  ctrl.appendChild(ui.skip)
  ui.now.appendChild(ctrl)
  card.appendChild(ui.now)

  // Başkasının işlemi (music.notice.*): görünür satır ve ekran okuyucu duyurusu
  ui.last = h('p', 'dj-last')
  ui.last.setAttribute('role', 'status')
  ui.last.setAttribute('aria-live', 'polite')
  card.appendChild(ui.last)
  // Kısıtlı kipte yalnızca dinleyen için açıklama
  ui.restricted = h('p', 'dj-hint dj-restricted')
  card.appendChild(ui.restricted)
  // Şarkı adıyla arama: aranırken durum satırı, arama yapılamayınca YouTube'un sonuç sayfasına bağlantı (yeni
  // sekmede, gönderen bilgisi olmadan) ve sahibe ayarın yeri
  ui.search = h('div', 'dj-search')
  ui.search.setAttribute('role', 'status')
  ui.search.setAttribute('aria-live', 'polite')
  ui.searchText = h('p', 'dj-hint dj-search-text')
  ui.search.appendChild(ui.searchText)
  ui.searchLinkRow = h('p', 'dj-hint dj-search-link-row')
  ui.searchLink = h('a', 'button button-small button-secondary dj-search-link')
  ui.searchLink.target = '_blank'
  ui.searchLink.rel = 'noopener noreferrer'
  ui.searchLinkRow.appendChild(ui.searchLink)
  ui.search.appendChild(ui.searchLinkRow)
  ui.searchOwner = h('p', 'dj-hint dj-search-owner')
  ui.search.appendChild(ui.searchOwner)
  card.appendChild(ui.search)

  // Kişisel ses seviyesi (cihazda saklanır) veya ayarlanamıyorsa açıklama
  ui.vol = h('div', 'dj-vol')
  ui.vol.appendChild(icon('i-speaker', 'dj-vol-icon'))
  ui.volLabel = h('label', 'dj-vol-label')
  ui.volLabel.setAttribute('for', 'dj-volume')
  ui.vol.appendChild(ui.volLabel)
  ui.volRange = h('input', 'range dj-vol-range')
  ui.volRange.type = 'range'
  ui.volRange.id = 'dj-volume'
  ui.volRange.min = '0'
  ui.volRange.max = '100'
  ui.volRange.step = '1'
  ui.volRange.addEventListener('input', () => {
    const engine = djEngine()
    if (engine) engine.setVolume(Number(ui.volRange.value) / 100)
    djSetText(ui.volValue, formatPercent(Number(ui.volRange.value)))
  })
  ui.vol.appendChild(ui.volRange)
  ui.volValue = h('span', 'dj-vol-value')
  ui.volValue.setAttribute('aria-hidden', 'true')
  ui.vol.appendChild(ui.volValue)
  card.appendChild(ui.vol)
  ui.volNote = h('p', 'dj-hint dj-vol-note')
  card.appendChild(ui.volNote)

  // "DJ'yi benim için sustur": yalnızca bu cihazda
  ui.mute = h('button', 'dj-mute')
  ui.mute.type = 'button'
  ui.mute.setAttribute('role', 'switch')
  const muteText = h('span', 'dj-mute-text')
  ui.muteLabel = h('span', 'dj-mute-label')
  muteText.appendChild(ui.muteLabel)
  ui.muteHint = h('span', 'dj-mute-hint')
  muteText.appendChild(ui.muteHint)
  ui.mute.appendChild(muteText)
  const sw = h('span', 'dj-switch')
  sw.setAttribute('aria-hidden', 'true')
  sw.appendChild(h('i', ''))
  ui.mute.appendChild(sw)
  ui.mute.addEventListener('click', () => {
    const engine = djEngine()
    const s = djSnapshot()
    if (engine && s) engine.setMuted(!s.muted)
  })
  card.appendChild(ui.mute)

  // "Yüzen Oynatıcı": kart görünürken de oynatıcı köşede durur (yalnızca bu cihazda)
  ui.floatSwitch = h('button', 'dj-mute dj-float-switch')
  ui.floatSwitch.type = 'button'
  ui.floatSwitch.setAttribute('role', 'switch')
  const floatText = h('span', 'dj-mute-text')
  ui.floatLabel = h('span', 'dj-mute-label')
  floatText.appendChild(ui.floatLabel)
  ui.floatHint = h('span', 'dj-mute-hint')
  floatText.appendChild(ui.floatHint)
  ui.floatSwitch.appendChild(floatText)
  const floatSw = h('span', 'dj-switch')
  floatSw.setAttribute('aria-hidden', 'true')
  floatSw.appendChild(h('i', ''))
  ui.floatSwitch.appendChild(floatSw)
  ui.floatSwitch.addEventListener('click', () => {
    djSetFloat(!djFloatOn())
    djRenderNow()
  })
  card.appendChild(ui.floatSwitch)

  // Kuyruk
  ui.queueTitle = h('h3', 'kicker dj-queue-title')
  ui.queueTitle.id = 'dj-queue-title'
  card.appendChild(ui.queueTitle)
  ui.queue = h('ol', 'dj-queue')
  ui.queue.setAttribute('aria-labelledby', 'dj-queue-title')
  card.appendChild(ui.queue)
  ui.queueEmpty = h('p', 'dj-hint dj-queue-empty')
  card.appendChild(ui.queueEmpty)
  ui.addHint = h('p', 'dj-hint dj-add-hint')
  card.appendChild(ui.addHint)
  ui.speakerHint = h('p', 'dj-hint dj-speaker-hint')
  card.appendChild(ui.speakerHint)
  // Masaüstü uygulamasında: YouTube parçası pencere arka plandayken çalmaz
  ui.bgNote = h('p', 'dj-hint dj-bg-note')
  card.appendChild(ui.bgNote)

  dj.ui = ui
  const engine = djEngine()
  if (engine) engine.attachPlayer(ui.yt)
}

// Sayfa gizli mi (arka plandaki sekme, simge durumundaki veya tepsideki masaüstü penceresi)
function djPageHidden () {
  try {
    return document.visibilityState === 'hidden'
  } catch (err) {
    return false
  }
}

// Çizim bir sonraki karede yapılır. Gizli sayfada tarayıcı requestAnimationFrame'i bekletir (Chrome arka
// plandaki sekmede, Electron simge durumundaki pencerede): çizim zamanlayıcıyla yapılır, yoksa oynatıcı alanı
// hiç çizilmez ve motor görünmeyen YouTube parçasını duraklatır. Kare beklenirken sayfa gizlenirse de
// zamanlayıcı kurulur.
function djRenderSoon () {
  if (!dj.ready) return
  if (dj.renderQueued) {
    if (djPageHidden() && !dj.renderTimer) dj.renderTimer = setTimeout(djRenderQueued, 0)
    return
  }
  dj.renderQueued = true
  if (djPageHidden()) dj.renderTimer = setTimeout(djRenderQueued, 0)
  else nextFrame(djRenderQueued)
}

function djRenderQueued () {
  if (dj.renderTimer) {
    clearTimeout(dj.renderTimer)
    dj.renderTimer = 0
  }
  if (!dj.renderQueued) return
  dj.renderQueued = false
  djRender()
}

// Motorun parça ve durum olaylarında yerleşim ve oynatıcı alanı kare beklenmeden uygulanır: parça gelince
// YouTube çerçevesi görünür bir alana kurulur (sayfa gizliyken de)
function djRenderNow () {
  if (!dj.ready || dj.layoutBusy) return
  djRender()
}

// ------------------------------------------------------------------ bant ve telsiz kartı işaretleri

// DJ'nin çaldığı ses odaları (motorun bildiği tüm odalar, KONSEPT 8.3 "Çalıyor" durumu)
function djPlayingRooms () {
  const engine = dj.ready ? djEngine() : null
  const s = engine ? djSnapshot() : null
  if (!s || !s.supported || !s.enabled) return []
  let rooms = []
  try {
    rooms = engine.activeRooms()
  } catch (err) {
    return []
  }
  return rooms.filter((r) => r && r.playing && r.current)
}

// 04-meta.js bandModel: bu ses istasyonunda nota işareti gösterilir mi
function djPlayingIn (roomId) {
  return djPlayingRooms().some((r) => sameId(r.room, roomId))
}

// Çalan odalar değişince bant yeniden çizilir, telsiz kartında "DJ çalıyor" satırı güncellenir
function djSyncMarks () {
  const rooms = djPlayingRooms()
  const key = rooms.map((r) => String(r.room)).sort().join(',')
  if (key !== dj.marksKey) {
    dj.marksKey = key
    if (typeof renderBand === 'function') renderBand()
  }
  const line = byId('radio-dj')
  const text = byId('radio-dj-text')
  if (!line || !text) return
  const here = dj.voiceRoom !== null ? rooms.filter((r) => sameId(r.room, dj.voiceRoom))[0] : null
  const value = here ? t('music.radioPlayingTrack', { title: djTrackTitle(here.current) }) : ''
  djSetText(text, value)
  if (line.hidden !== !here) line.hidden = !here
}

// Kartı, yerleşimi ve kadro öğesini anlık görüntüye göre günceller
function djRender () {
  if (!dj.ready || !el.dj) return
  djSyncMarks()
  const show = djShouldShow()
  djApplyLayout(show)
  // Anlık görüntü yerleşimden sonra okunur: yerleşim yerel bekletmeyi değiştirebilir (küçültülmüş köşe), motorun
  // o sıradaki değişiklik olayı çizim yapmaz (djRenderNow), çubuk ve uyarı satırı yeni durumla çizilir
  const s = djSnapshot()
  djAttr(el.appView, 'data-dj', s && s.supported && s.enabled ? 'on' : 'off')
  djEnsureCrewItem(show)
  if (!show || !dj.ui || !s) {
    djSyncConsentWarn(null)
    djMediaSession(null)
    return
  }
  const ui = dj.ui
  const session = s.session
  const current = session ? session.current : null
  const player = s.player || {}
  djAttr(el.djCard, 'aria-busy', s.busy ? 'true' : 'false')
  djSetText(el.djSheetTitle, t('dj.kicker', { room: djRoomName(dj.voiceRoom) }))
  djSetText(ui.kickerText, t('dj.kicker', { room: djRoomName(dj.voiceRoom) }))
  djSetText(ui.tag, t('dj.botTag'))
  let stateKey = ''
  if (current && session.playing) stateKey = session.startsInMs > 0 ? 'music.status.loading' : 'music.status.playing'
  else if (current) stateKey = 'music.status.paused'
  djSetText(ui.state, stateKey ? t(stateKey) : '')
  ui.state.hidden = !stateKey
  el.djCard.classList.toggle('is-playing', Boolean(current && session.playing))
  el.djCard.classList.toggle('is-paused', Boolean(current && !session.playing))

  // Oynatıcı alanı
  const isYt = Boolean(current && current.type === 'youtube')
  const ytOff = isYt && (player.blocked === 'youtube_disabled' || !s.youtubeEnabled)
  const needConsent = isYt && !ytOff && s.consent !== 'granted'
  ui.yt.hidden = !(isYt && !ytOff && !needConsent)
  djAttr(ui.yt, 'aria-label', t('dj.playerArea'))
  ui.consent.hidden = !needConsent
  ui.consentNote.hidden = !needConsent
  if (needConsent) {
    djSetText(ui.consentTitle, t('music.consent.title'))
    djSetText(ui.consentText, s.consent === 'denied' ? t('music.consent.needed') : t('music.consent.text'))
    djSetText(ui.consentAccept.lastChild, t('music.consent.accept'))
    djSetText(ui.consentDecline.lastChild, t('music.consent.decline'))
    // Reddedilmişken yalnızca yükleme düğmesi kalır (Ayarlar > Gizlilik'te Yeniden sor da var)
    ui.consentDecline.hidden = s.consent === 'denied'
    djSetText(ui.consentNote, t('dj.consentNote'))
  }
  ui.blocked.hidden = !ytOff
  if (ytOff) djSetText(ui.blockedText, t('music.blocked.youtube_disabled'))
  ui.wave.hidden = !(current && current.type === 'file')
  if (current && current.type === 'file') djBuildWave(current)
  ui.empty.hidden = Boolean(current)
  if (!current) {
    djSetText(ui.emptyTitle, t('dj.empty'))
    djSetText(ui.emptyHint, t('dj.addHint'))
  }
  if (s.sessionStatus === 'no_key' || s.sessionStatus === 'invalid') {
    ui.empty.hidden = false
    djSetText(ui.emptyTitle, djErrorText(s.sessionStatus === 'no_key' ? 'no_key' : 'invalid_state'))
    djSetText(ui.emptyHint, '')
  }

  djRenderAlert(s, current, isYt && !ytOff && !needConsent)
  djRenderDock(s, current)

  // Çalan parça, kaynak, ekleyen, konum ve denetimler
  ui.now.hidden = !current
  if (current) {
    djSetText(ui.title, djTrackTitle(current))
    djSetText(ui.by, djByText(current))
    const playing = session.playing
    setIcon(ui.toggle, playing ? 'i-pause' : 'i-play')
    djSetText(ui.toggle.lastChild, t(playing ? 'music.actions.pause' : 'music.actions.resume'))
    djSetText(ui.skip.lastChild, t('music.actions.skip'))
  }
  const listenOnly = djListenOnly()
  ui.toggle.disabled = listenOnly
  ui.skip.disabled = listenOnly
  ui.restricted.hidden = !listenOnly
  if (listenOnly) djSetText(ui.restricted, t('dj.restrictedNote'))
  djUpdateTime()

  // Başkasının son işlemi
  djSetText(ui.last, dj.notice ? textOf(dj.notice) : '')
  ui.last.hidden = !dj.notice
  djRenderSearch(ui)

  // Kişisel ses seviyesi ve susturma
  ui.vol.hidden = !s.volumeSupported
  ui.volNote.hidden = s.volumeSupported
  djSetText(ui.volLabel, t('dj.forYou'))
  djAttr(ui.volRange, 'aria-label', t('music.volume'))
  const percent = Math.round((Number(s.volume) || 0) * 100)
  if (document.activeElement !== ui.volRange) ui.volRange.value = String(percent)
  djSetText(ui.volValue, formatPercent(document.activeElement === ui.volRange ? Number(ui.volRange.value) : percent))
  if (!s.volumeSupported) djSetText(ui.volNote, t('music.volumeUnsupported'))
  ui.vol.classList.toggle('is-muted', Boolean(s.muted))
  djAttr(ui.mute, 'aria-checked', s.muted ? 'true' : 'false')
  djSetText(ui.muteLabel, t('music.muteForMe'))
  djSetText(ui.muteHint, t('dj.muteHint'))
  djAttr(ui.floatSwitch, 'aria-checked', djFloatOn() ? 'true' : 'false')
  djSetText(ui.floatLabel, t('dj.dock.float'))
  djSetText(ui.floatHint, t('dj.muteHint'))

  // Kuyruk
  djRenderQueue(session ? session.queue : [])
  // Boş durumda kuyruk başlığı ve "Kuyruk boş" yinelenmez (oynatıcı alanı zaten boş durumu söyler)
  ui.queueTitle.hidden = !current
  if (!current) ui.queueEmpty.hidden = true
  djSetText(ui.addHint, t('dj.addHint'))
  ui.addHint.hidden = !current || listenOnly
  const vs = typeof snap === 'function' ? snap() : null
  const vad = Boolean(vs && !(vs.ptt && vs.ptt.enabled))
  ui.speakerHint.hidden = !(current && vad)
  if (!ui.speakerHint.hidden) djSetText(ui.speakerHint, t('music.speakerHint'))
  ui.bgNote.hidden = !(isYt && dj.desktopWatched)
  if (!ui.bgNote.hidden) djSetText(ui.bgNote, t('music.player.backgroundYoutube'))
  djSyncConsentWarn(s)
  djMediaSession(s)
}

// ------------------------------------------------------------------ Media Session

const DJ_MEDIA_KEY = 'telsiz.djMediaSession'
const DJ_MEDIA_POSITION_MS = 5000

// Ayarlar > Gizlilik: parça adı işletim sisteminin medya denetimlerine verilsin mi (varsayılan açık)
function djMediaSessionOn () {
  return djStoreGet(DJ_MEDIA_KEY) !== '0'
}

// İşletim sisteminin medya denetimleri ve kilit ekranı (navigator.mediaSession): başlık parçanın adı, sanatçı
// alanı "Telsiz DJ · oda". Oynat ve Duraklat yalnızca bu cihazdaki yerel bekletmeyi yönetir (music.js
// setLocalHold 'media'), odanın durumunu değiştirmez: bir kulaklık tuşu bütün odayı durdurmaz. Konum
// setPositionState ile bildirilir. Odadan çıkınca, parça kalmayınca veya ayar kapalıyken metadata null olur ve
// işleyiciler kaldırılır. Başka modüller aynı nesneye yalnızca kendi eylem işleyicilerini ekler, metadata'yı
// yalnızca bu işlev yazar.
function djMediaSession (s) {
  const ms = navigator.mediaSession
  if (!ms) return
  const engine = djEngine()
  const session = s ? s.session : null
  const current = session ? session.current : null
  const active = Boolean(engine && s && s.supported && s.enabled && current && dj.voiceRoom !== null && djMediaSessionOn())
  if (!active) {
    if (dj.mediaKey === null) return
    dj.mediaKey = null
    dj.mediaPosAt = 0
    try {
      ms.metadata = null
      ms.playbackState = 'none'
      ms.setActionHandler('play', null)
      ms.setActionHandler('pause', null)
    } catch (err) {
      // Desteklenmeyen eylem
    }
    return
  }
  if (dj.mediaKey === null) {
    try {
      ms.setActionHandler('play', () => {
        const e = djEngine()
        if (e) e.setLocalHold('media', false)
      })
      ms.setActionHandler('pause', () => {
        const e = djEngine()
        if (e) e.setLocalHold('media', true)
      })
    } catch (err) {
      // Desteklenmeyen eylem
    }
  }
  const title = djTrackTitle(current)
  const artist = t('dj.mediaSession.artist', { room: djRoomName(dj.voiceRoom) })
  const key = current.id + '|' + title + '|' + artist
  if (key !== dj.mediaKey) {
    dj.mediaKey = key
    dj.mediaPosAt = 0
    try {
      ms.metadata = typeof window.MediaMetadata === 'function' ? new window.MediaMetadata({ title: title, artist: artist }) : null
    } catch (err) {
      ms.metadata = null
    }
  }
  const p = s.player || {}
  const held = Array.isArray(p.localHold) && p.localHold.length > 0
  const state = session.playing && !held ? 'playing' : 'paused'
  const posKey = state + '|' + current.id
  try {
    if (ms.playbackState !== state) ms.playbackState = state
  } catch (err) {
    // Yoksa sessiz
  }
  // Konum: parça veya durum değişince ve birkaç saniyede bir
  const dur = current.durationMs || 0
  const now = Date.now()
  if (typeof ms.setPositionState === 'function' && dur > 0 && (posKey !== dj.mediaPosKey || now - dj.mediaPosAt >= DJ_MEDIA_POSITION_MS)) {
    dj.mediaPosKey = posKey
    dj.mediaPosAt = now
    const pos = Math.max(0, Math.min(dur, Number(engine.queue().positionMs) || 0))
    try {
      ms.setPositionState({ duration: dur / 1000, playbackRate: 1, position: pos / 1000 })
    } catch (err) {
      // Geçersiz konum, sonraki denetimde yeniden denenir
    }
  }
}

// ------------------------------------------------------------------ erken YouTube rızası

// Rıza sorusu daha erken: YouTube oynatıcısına henüz izin vermemiş (sorulmamış) kişi ses odasındayken odada
// YouTube parçası çalıyorsa (odaya sonradan katılınca da) telsiz kartında kalıcı bir uyarı ve Yükle düğmesi
// durur. Her yeni YouTube parçasında bir kez kısa bildirim de çıkar, DJ kartı görünürken de (arka plandayken
// kaçmasın). Rıza yine yalnızca bu cihazda ve kişinin düğmesiyle verilir, ayrıntılı açıklama DJ kartındadır.
function djConsentWarnTrack (s) {
  if (!s || !s.supported || !s.enabled || !s.youtubeEnabled || s.consent !== 'unset' || dj.voiceRoom === null) return null
  if (!sameId(s.room, dj.voiceRoom) || !s.session || !s.session.current || s.session.current.type !== 'youtube') return null
  return s.session.current.id
}

function djConsentWarnRow () {
  if (dj.consentRow) return dj.consentRow
  const row = h('div', 'radio-dj-consent')
  row.setAttribute('role', 'group')
  row.hidden = true
  const text = h('p', 'radio-dj-consent-text')
  text.id = 'radio-dj-consent-text'
  row.setAttribute('aria-labelledby', text.id)
  row.appendChild(text)
  const actions = h('div', 'radio-dj-consent-actions')
  const accept = button('button button-small radio-dj-consent-accept', ' ')
  accept.addEventListener('click', () => {
    const engine = djEngine()
    if (engine) engine.setConsent(true)
  })
  actions.appendChild(accept)
  const decline = button('button button-small button-ghost radio-dj-consent-decline', ' ')
  decline.addEventListener('click', () => {
    const engine = djEngine()
    if (engine) engine.setConsent(false)
  })
  actions.appendChild(decline)
  row.appendChild(actions)
  dj.consentRow = { row: row, text: text, accept: accept, decline: decline }
  return dj.consentRow
}

function djSyncConsentWarn (s) {
  const trackId = djConsentWarnTrack(s)
  if (trackId && trackId !== dj.consentWarnFor) toast(() => t('music.consent.roomHasYoutube'), '', 8000)
  dj.consentWarnFor = trackId
  // DJ kartı rıza sorusunu zaten gösteriyorsa uyarı yinelenmez
  const cardAsks = Boolean(trackId && djCardShown() && dj.ui && !dj.ui.consent.hidden)
  const want = Boolean(trackId) && !cardAsks
  const host = el.radioTuned || byId('radio-tuned')
  if (!want && !dj.consentRow) return
  const c = djConsentWarnRow()
  if (want && host && c.row.parentNode !== host) host.appendChild(c.row)
  if (want) {
    djSetText(c.text, t('music.consent.roomHasYoutube'))
    djSetText(c.accept.lastChild, t('music.consent.accept'))
    djSetText(c.decline.lastChild, t('music.consent.decline'))
  }
  if (c.row.hidden !== !want) c.row.hidden = !want
}

// Oynatıcı alanının altındaki tek uyarı satırı. Öncelik: oturum hatası, dokunarak başlat, oynatıcı hatası,
// yerel duraklatma, görünürlük.
function djRenderAlert (s, current, ytVisible) {
  const ui = dj.ui
  const p = s.player || {}
  let text = ''
  let action = ''
  let primary = false
  const holds = current && Array.isArray(p.localHold) ? p.localHold : []
  if (current && p.needsTap) {
    action = 'tap'
    primary = true
  } else if (current && p.error) {
    text = djErrorText(p.error)
    action = 'retry'
  } else if (holds.indexOf('media') !== -1) {
    // Kilit ekranı veya medya tuşuyla bu cihazda duraklatıldı
    text = t('music.player.holdDevice')
    action = 'media'
  } else if (holds.indexOf('window') !== -1) {
    text = t('music.player.waitingVisible')
  } else if (holds.indexOf('minimized') !== -1) {
    text = t('music.player.minimizedYoutube')
    action = 'restore'
  } else if (current && p.hold) {
    text = t(p.holdReason === 'device' ? 'music.player.holdDevice' : 'music.player.hold')
    action = 'resync'
  } else if (current && p.hidden && ytVisible) {
    text = t('music.player.hidden')
  } else if (s.sessionStatus === 'replay') {
    text = djErrorText('replay')
  }
  ui.alert.hidden = !text && !action
  ui.alert.classList.toggle('is-error', Boolean(current && p.error && !p.needsTap))
  djSetText(ui.alertText, text)
  ui.alertText.hidden = !text
  ui.alertAction.hidden = !action
  djAttr(ui.alertAction, 'data-action', action)
  ui.alertAction.classList.toggle('button-secondary', !primary)
  ui.alertAction.classList.toggle('dj-tap', primary)
  if (action) {
    let key = 'music.actions.resync'
    if (action === 'tap') key = 'music.tapToListen'
    else if (action === 'retry') key = 'music.actions.retry'
    else if (action === 'restore') key = 'dj.dock.restore'
    djSetText(ui.alertAction.lastChild, t(key))
  }
}

// Bu cihazda kişinin kaldırabileceği yerel bekletme: medya tuşu veya kilit ekranı ('media'), küçültülmüş YouTube
// ('minimized'). Pencere bekletmesi ('window') pencere görünür olunca kendiliğinden kalkar.
function djDockHold (s) {
  const holds = s && s.player && Array.isArray(s.player.localHold) ? s.player.localHold : []
  if (holds.indexOf('media') !== -1) return 'media'
  if (holds.indexOf('minimized') !== -1) return 'minimized'
  return ''
}

// "Bu Cihazda Devam Et": medya bekletmesi kalkar, küçültülmüş oynatıcı açılır. Oynatıcı odanın konumuna atlayıp
// sürer, odanın durumu değişmez.
function djReleaseHolds () {
  const engine = djEngine()
  dj.minimized = false
  if (engine && typeof engine.setLocalHold === 'function') engine.setLocalHold('media', false)
  djRenderNow()
}

// Köşedeki oynatıcının çubuğu: parça adı, duraklat veya devam (dokunarak başlatma gerekiyorsa o) ve DJ'yi aç. Kartın
// uyarı satırı köşedeyken görünmez: bu cihazda yerel bekletme varsa çubuk bunu söner lamba ve "Bu Cihazda Devam
// Et" düğmesiyle gösterir, düğme odayı duraklatmaz.
function djRenderDock (s, current) {
  const ui = dj.ui
  if (!dj.docked || !current) return
  const session = s.session
  const tap = Boolean(s.player && s.player.needsTap)
  const hold = tap ? '' : djDockHold(s)
  const playing = Boolean(session && session.playing)
  djAttr(ui.dock, 'aria-label', t('dj.dock.label'))
  djSetText(ui.dockTitle, djTrackTitle(current))
  djAttr(ui.dockTitle, 'title', djTrackTitle(current))
  setIcon(ui.dockToggle, playing && !tap && !hold ? 'i-pause' : 'i-play')
  const toggleLabel = t(tap ? 'music.tapToListen' : hold ? 'dj.dock.resumeHere' : playing ? 'music.actions.pause' : 'music.actions.resume')
  djAttr(ui.dockToggle, 'aria-label', toggleLabel)
  djAttr(ui.dockToggle, 'title', toggleLabel)
  djAttr(ui.dockOpen, 'aria-label', t('dj.dock.open'))
  djAttr(ui.dockOpen, 'title', t('dj.dock.open'))
  djAttr(ui.dockMove, 'aria-label', t('dj.dock.moveLabel'))
  djAttr(ui.dockMove, 'title', t('dj.dock.move'))
  setIcon(ui.dockMin, dj.minimized ? 'i-up' : 'i-down')
  const minLabel = t(dj.minimized ? 'dj.dock.restore' : 'dj.dock.minimize')
  djAttr(ui.dockMin, 'aria-label', minLabel)
  djAttr(ui.dockMin, 'title', minLabel)
  ui.dock.classList.toggle('needs-tap', tap)
  ui.dock.classList.toggle('is-held', Boolean(hold))
}

// "DJ'yi aç": kartı örten katmanlar (Ayarlar, başka sayfalar, menüler) kapanır, kart gösterilir
function djOpenFromDock () {
  layers.slice().reverse().forEach((layer) => {
    if (layer.name !== 'sheet-dj') closeLayer(layer, false)
  })
  const crewButton = dj.crewLi && dj.crewLi.isConnected ? dj.crewLi.firstChild : null
  djReveal(crewButton)
}

function djOnAlertAction () {
  const engine = djEngine()
  if (!engine || !dj.ui) return
  const action = dj.ui.alertAction.getAttribute('data-action')
  // unlock() kullanıcı hareketinin içinde eşzamanlı çağrılmalıdır (kendiliğinden oynatma kuralı)
  if (action === 'tap') {
    engine.unlock()
  } else if (action === 'retry' || action === 'resync') {
    engine.resync()
  } else if (action === 'media') {
    engine.setLocalHold('media', false)
  } else if (action === 'restore') {
    dj.minimized = false
    djRenderNow()
  }
}

// Dosya parçasının dalga biçimi: çubuk boyları parça kimliğinden türetilir (içerik çözümlenmez)
function djBuildWave (track) {
  const ui = dj.ui
  if (dj.waveKey === track.id) return
  dj.waveKey = track.id
  clear(ui.waveBars)
  let seed = 0
  track.id.split('').forEach((ch) => {
    seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647
  })
  let i = 0
  while (i < DJ_WAVE_BARS) {
    seed = (seed * 48271) % 2147483647
    const bar = h('i', '')
    bar.style.height = (28 + (seed % 68)) + '%'
    ui.waveBars.appendChild(bar)
    i += 1
  }
}

// Konum: geçen ve toplam süre, ilerleme çubuğu, dalga biçiminin çalınan kısmı
function djUpdateTime () {
  const ui = dj.ui
  const engine = djEngine()
  if (!ui || !engine || ui.now.hidden) return
  const q = engine.queue()
  const current = q.current
  if (!current) return
  const dur = current.durationMs || 0
  const pos = dur ? Math.min(q.positionMs, dur) : q.positionMs
  const posText = djTime(pos)
  const durText = dur ? djTime(dur) : '--:--'
  djSetText(ui.pos, posText)
  djSetText(ui.dur, durText)
  djSetText(ui.timeSr, t('dj.timeLabel', { pos: posText, total: durText }))
  const ratio = dur ? Math.max(0, Math.min(1, pos / dur)) : 0
  ui.barFill.style.width = (ratio * 100).toFixed(1) + '%'
  ui.bar.classList.toggle('is-unknown', !dur)
  if (!ui.wave.hidden) {
    const played = Math.round(ratio * DJ_WAVE_BARS)
    Array.from(ui.waveBars.children).forEach((bar, i) => {
      bar.classList.toggle('is-played', i < played)
    })
  }
}

function djRenderQueue (list) {
  const ui = dj.ui
  const items = Array.isArray(list) ? list : []
  const listenOnly = djListenOnly()
  const key = window.I18N.lang + '|' + (listenOnly ? 'l' : 'c') + '|' + (typeof profileEpoch === 'function' ? profileEpoch() : 0) + '|' + items.map((tr) => tr.id + ':' + tr.title + ':' + tr.addedBy).join(',')
  djSetText(ui.queueTitle, t('dj.queueTitle', { count: items.length }))
  ui.queueEmpty.hidden = items.length > 0
  djSetText(ui.queueEmpty, t('music.queue.empty'))
  if (key === dj.queueKey) return
  dj.queueKey = key
  const focusKey = activeFocusKey(ui.queue)
  clear(ui.queue)
  items.forEach((track, i) => {
    const li = h('li', 'dj-queue-item')
    li.appendChild(h('span', 'dj-queue-n', String(i + 1)))
    const text = h('span', 'dj-queue-text')
    text.appendChild(h('span', 'dj-queue-name', djTrackTitle(track)))
    text.appendChild(h('span', 'dj-queue-by', djByText(track)))
    li.appendChild(text)
    if (!listenOnly) {
      const label = t('dj.queueRemove', { title: djTrackTitle(track) })
      const remove = button('icon-button dj-queue-remove', '', 'i-close', label)
      remove.setAttribute('data-focus-key', 'dj-remove-' + track.id)
      remove.addEventListener('click', () => {
        djAction('remove', (engine) => engine.remove(track.id), true)
      })
      li.appendChild(remove)
    }
    ui.queue.appendChild(li)
  })
  restoreFocusKey(ui.queue, focusKey)
}

function djOnToggle () {
  const s = djSnapshot()
  const playing = Boolean(s && s.session && s.session.playing)
  djAction(playing ? 'pause' : 'resume', (engine) => (playing ? engine.pause() : engine.resume()))
}

// Kart düğmeleri: sonuç kartta görünür, yalnızca hata (ve istenirse başarı) kısa bildirimle söylenir
function djAction (command, fn, announceOk) {
  const engine = djEngine()
  if (!engine) return
  Promise.resolve(fn(engine)).then((r) => {
    if (r && (!r.ok || announceOk)) djReport(command, r)
  }, (err) => {
    window.console.error(err)
  })
}

// Kuyruktaki parça (motorun bildiği oturumda yoksa null). Başlık sonradan dolabildiği için duyurular ve
// bildirimler adı buradan canlı okur.
function djLiveTrack (trackId) {
  const engine = djEngine()
  if (!engine || !trackId) return null
  const q = engine.queue()
  const all = (q.current ? [q.current] : []).concat(q.queue || [])
  return all.filter((tr) => tr && tr.id === trackId)[0] || null
}

// Parçanın gösterilecek adı. seen, adı gösteren kaydın kendi belleğidir ({ title, type }: Bildirimler kaydı
// veya karttaki son işlem satırı). Parça kuyruktayken güncel adı ve türü bu belleğe yazılır, böylece parça
// kuyruktan çıkınca (bitti, geçildi, durduruldu) kayıt en son bilinen adı gösterir. Ad hiç bilinmediyse metin
// parçanın türüne göre seçilir ("YouTube videosu" veya "Ses dosyası").
function djLiveTitle (trackId, seen) {
  const memo = seen && typeof seen === 'object' ? seen : {}
  const track = djLiveTrack(trackId)
  if (track) {
    if (track.type === 'youtube' || track.type === 'file') memo.type = track.type
    if (track.title) memo.title = track.title
  }
  if (memo.title) return memo.title
  return t(memo.type === 'file' ? 'music.untitledFile' : 'music.untitledYouTube')
}

function djOnNotice (n) {
  if (!n || typeof n.op !== 'string') return
  const key = 'music.notice.' + n.op
  if (!hasText(key)) return
  const by = n.by
  const trackId = n.trackId || null
  // Satırın kendi belleği: bildirimin taşıdığı ad, parça kuyruktaysa şimdiki adı ve türü
  const seen = { title: typeof n.title === 'string' ? n.title : '', type: null }
  djLiveTitle(trackId, seen)
  dj.notice = () => t(key, { name: by !== null && by !== undefined ? shownName(by) : '', title: djLiveTitle(trackId, seen) })
  djRenderSoon()
  // Bildirimler listesi (28-bildirim.js): aynı ses odasında başkasının az önce eklediği parça. Odaya katılınca
  // veya sayfa yenilenince gelen eski işlemin bildirimi listeye yazılmaz.
  const engine = djEngine()
  const fresh = !n.at || !engine || engine.serverNow() - n.at < DJ_NOTICE_FRESH_MS
  if (n.op === 'add' && fresh && typeof activityDj === 'function') activityDj(by, n.room, trackId, seen.title, seen.type)
}

// ------------------------------------------------------------------ yerleşim ve sayfa

// Katman kartın oynatıcı alanını örtüyor mu. Oynatıcı alanının yeri köşedeyken de korunur (dj.css), karar
// köşeye almayla değişmez.
function djLayerCovers (layer) {
  if (layer.name === 'sheet-dj') return false
  if (DJ_POPOVER_LAYERS.indexOf(layer.name) === -1 || !layer.el || !dj.ui) return true
  const a = layer.el.getBoundingClientRect()
  const b = dj.ui.stage.getBoundingClientRect()
  return a.width > 0 && a.height > 0 && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

// Köşedeki oynatıcı gerekli mi: çalan parça YouTube, oynatıcı alanı açık (rıza var, YouTube kapalı değil) ve
// kartın kendi yeri görünmüyor (sayfa kipinde sayfa kapalı) veya kartı bir katman örtüyor (Ayarlar, başka bir
// sayfa, pencere, görüntüleyici, üstüne gelen menü). Karar ölçülen görünürlüğe değil bu durumlara bağlıdır,
// köşeye alma ve geri döndürme birbirini tetikleyip titremez. Yedek: katman açıkken motor oynatıcıyı yine de
// görünmez bulduysa (beklenmeyen bir örtü) oynatıcı köşeye alınır ve katmanlar değişene kadar orada kalır.
// "Yüzen Oynatıcı" açıksa oynatıcı kart görünürken de köşede durur (DJ sayfası açıkken sayfanın içindedir). Dosya
// parçası yalnızca bu anahtarla köşeye çıkar (dalga biçimi ve çubuk), dosya görünmeden de çalar.
function djWantDock (show, hidden) {
  const s = djSnapshot()
  if (!show || !dj.ui || !s) return false
  const current = s.session ? s.session.current : null
  if (!current) return false
  const sheetOpen = dj.sheetMode && Boolean(findLayer('sheet-dj'))
  const float = djFloatOn() && !sheetOpen
  if (current.type !== 'youtube') return float
  if (!s.youtubeEnabled || s.consent !== 'granted' || (s.player && s.player.blocked === 'youtube_disabled')) return false
  if (hidden || float) return true
  const others = layers.filter((layer) => layer.name !== 'sheet-dj')
  const key = others.map((layer) => layer.name).join(',')
  if (dj.dockSticky !== null && dj.dockSticky !== key) dj.dockSticky = null
  if (!others.length) return false
  if (dj.dockSticky !== null || others.some(djLayerCovers)) return true
  if (!dj.docked && s.player && s.player.hidden) {
    dj.dockSticky = key
    return true
  }
  return false
}

// ------------------------------------------------------------------ köşedeki oynatıcı: köşe, sürükleme, küçültme

const DJ_DOCK_KEY = 'telsiz.djDock'
const DJ_FLOAT_KEY = 'telsiz.djFloat'
const DJ_CORNERS = ['tl', 'tr', 'br', 'bl']

function djStoreGet (key) {
  try {
    return storeGet(key)
  } catch (err) {
    return null
  }
}

function djStoreSet (key, value) {
  try {
    storeSet(key, value)
  } catch (err) {
    // Saklanamazsa bu oturumda geçerlidir
  }
}

function djFloatOn () {
  return djStoreGet(DJ_FLOAT_KEY) === '1'
}

function djSetFloat (on) {
  djStoreSet(DJ_FLOAT_KEY, on ? '1' : '0')
}

// Köşe: kişinin seçtiği köşe (cihazda saklanır), yoksa akıllı varsayılan (djDockDefault)
function djDockCorner () {
  const saved = djStoreGet(DJ_DOCK_KEY)
  if (DJ_CORNERS.indexOf(saved) !== -1) return saved
  return djDockDefault()
}

// Akıllı varsayılan: telsiz kartının düğmelerini, yazma alanını ve sohbet başlığındaki Oda bilgisi düğmesini
// örtmeyen ilk köşe. 760 ile 1279 piksel arasında telsiz kartı sağ alttadır, önce sağ üst (bandın altı)
// denenir. Diğer genişliklerde önce sağ alt. Hiçbiri uymazsa sıradaki ilk köşe.
function djDockDefault () {
  const mid = window.innerWidth >= 760 && window.innerWidth < 1280
  const order = mid ? ['tr', 'br', 'tl', 'bl'] : ['br', 'tr', 'bl', 'tl']
  const box = dj.ui ? dj.ui.float.getBoundingClientRect() : null
  if (!box || !box.width || !box.height) return order[0]
  // Ölçü YouTube oynatıcısının tam boyudur (çerçeve ve çubuk): köşe küçültünce veya dosya parçasında değişmez
  const bar = dj.ui.dock.getBoundingClientRect().height
  const size = { width: box.width, height: Math.max(box.height, bar > 0 ? 202 + bar : 0) }
  const guards = djDockControls().concat(djDockCovered() ? [] : djDockBoxes([byId('btn-room-info')]))
  for (const corner of order) {
    const r = djDockSpot(corner, size).rect
    if (!guards.some((g) => g.left < r.right && g.right > r.left && g.top < r.bottom && g.bottom > r.top)) return corner
  }
  return order[0]
}

// Kutunun bulunduğu köşe: Ayarlar, sayfalar veya bir pencere ana görünümü örterken üst köşe aynı yandaki alt
// köşeye iner. Bu katmanların başlığı ve Kapat düğmesi üsttedir, Ayarlar içeriğe alttan kutu kadar pay bırakır
// (dj.css), her satıra kaydırarak ulaşılır. Seçilen köşe değişmez, katman kapanınca kutu oraya döner.
function djDockPlace () {
  const corner = djDockCorner()
  return djDockCovered() && corner.charAt(0) === 't' ? 'b' + corner.charAt(1) : corner
}

function djSetDockCorner (corner) {
  if (DJ_CORNERS.indexOf(corner) !== -1) djStoreSet(DJ_DOCK_KEY, corner)
}

// "Taşı": köşeler saat yönünde dolaşılır (klavyeyle de taşınabilsin). Ana görünümü örten bir katman açıkken
// kutu yalnızca alt köşelerde durduğu için iki alt köşe arasında geçer.
function djMoveDock () {
  const order = djDockCovered() ? ['br', 'bl'] : DJ_CORNERS
  const i = order.indexOf(djDockPlace())
  djSetDockCorner(order[(i + 1) % order.length])
  djRenderNow()
}

// "Küçült" ve "Göster": küçültülünce yalnızca çubuk kalır. Dosya parçası çalmaya devam eder, YouTube parçası
// yalnızca bu cihazda duraklar (yerel bekletme, music.js setLocalHold) ve açılınca odayla eşitlenip sürer.
function djToggleMinimized () {
  dj.minimized = !dj.minimized
  const s = djSnapshot()
  const current = s && s.session ? s.session.current : null
  if (dj.minimized && current && current.type === 'youtube') toast(() => t('music.player.minimizedYoutube'), '', 7000)
  djRenderNow()
  if (dj.ui && dj.ui.dockMin.isConnected) focusNode(dj.ui.dockMin)
}

// Sürükleme yardımcısı (ayrı tutulur, yüzen başka pencereler de kullanabilir). box position: fixed bir kutudur,
// handle içinden pointer olaylarıyla sürüklenir (tutamakta touch-action: none). Kutu sürüklenirken görünüm
// alanının içinde tutulur, bırakınca kutunun ortasına en yakın köşe opts.onDrop(corner) ile bildirilir
// ('tl' | 'tr' | 'bl' | 'br'), kutunun satır içi konumu silinir. Birkaç pikselden kısa hareket tıklama sayılır.
// opts: { canStart(event) -> bool, onStart(), onDrop(corner) }
function dockDrag (box, handle, opts) {
  const o = opts || {}
  let drag = null
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
  const reset = () => {
    box.classList.remove('is-dragging')
    box.style.left = ''
    box.style.top = ''
    box.style.right = ''
    box.style.bottom = ''
  }
  handle.addEventListener('pointerdown', (e) => {
    if (drag || (typeof e.button === 'number' && e.button !== 0)) return
    if (typeof o.canStart === 'function' && !o.canStart(e)) return
    const r = box.getBoundingClientRect()
    drag = { id: e.pointerId, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width, h: r.height, x0: e.clientX, y0: e.clientY, moved: false }
    try {
      handle.setPointerCapture(e.pointerId)
    } catch (err) {
      // Yakalama yoksa olaylar yine tutamaktan gelir
    }
  })
  handle.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return
    if (!drag.moved && Math.abs(e.clientX - drag.x0) + Math.abs(e.clientY - drag.y0) < 6) return
    if (!drag.moved) {
      drag.moved = true
      box.classList.add('is-dragging')
      if (typeof o.onStart === 'function') o.onStart()
    }
    const vw = document.documentElement.clientWidth || window.innerWidth
    const vh = window.innerHeight
    box.style.left = Math.round(clamp(e.clientX - drag.dx, 0, Math.max(0, vw - drag.w))) + 'px'
    box.style.top = Math.round(clamp(e.clientY - drag.dy, 0, Math.max(0, vh - drag.h))) + 'px'
    box.style.right = 'auto'
    box.style.bottom = 'auto'
    if (e.cancelable) e.preventDefault()
  })
  const end = (e) => {
    if (!drag || e.pointerId !== drag.id) return
    const d = drag
    drag = null
    try {
      handle.releasePointerCapture(e.pointerId)
    } catch (err) {
      // Zaten bırakılmış
    }
    if (!d.moved) return
    const r = box.getBoundingClientRect()
    const vw = document.documentElement.clientWidth || window.innerWidth
    const vh = window.innerHeight
    reset()
    const corner = (r.top + r.height / 2 < vh / 2 ? 't' : 'b') + (r.left + r.width / 2 < vw / 2 ? 'l' : 'r')
    if (typeof o.onDrop === 'function') o.onDrop(corner)
  }
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  handle.addEventListener('lostpointercapture', end)
}

function djRemPx () {
  const v = parseFloat(window.getComputedStyle(document.documentElement).fontSize)
  return isFinite(v) && v > 0 ? v : 15
}

// Ana görünümü örten bir katman açık mı (Ayarlar, sayfalar ve perdeleri, pencereler, görüntüleyici). Perdesiz
// küçük katmanlar (DJ_POPOVER_LAYERS) ve DJ sayfası sayılmaz, onlar açıkken telsiz kartı ve yazma alanı görünür.
function djDockCovered () {
  return layers.some((layer) => layer.name !== 'sheet-dj' && DJ_POPOVER_LAYERS.indexOf(layer.name) === -1)
}

// Görünür öğelerin kutuları
function djDockBoxes (nodes) {
  const out = []
  nodes.forEach((n) => {
    if (!n || !n.getClientRects().length) return
    const r = n.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) out.push(r)
  })
  return out
}

// Alt köşedeki kutunun üstüne çıktığı öğeler: yazma alanı ve telsiz kartı. Ana görünümü bir katman örtüyorsa
// bunlar görünmez, oynatıcı ekranın köşesindedir.
function djDockObstacles () {
  return djDockCovered() ? [] : djDockBoxes([byId('composer'), byId('radio')])
}

// Kutunun hiçbir köşede inmediği düğmeler: telsiz kartındaki kadro (kişi başı ses ayarları), araç satırı
// (Telsiz DJ, Büyüt) ve ses düğmeleri, yazma alanı. Kartın üstünde yer kalmazsa kutu kartın başlığını ve oda
// adını örtebilir, düğmelerini örtmez.
function djDockControls () {
  if (djDockCovered()) return []
  const buttons = Array.from(document.querySelectorAll('#radio-crew button, #radio-tools button, #radio-row button'))
  return djDockBoxes([byId('composer')].concat(buttons))
}

// Üst köşelerin sınırı: üst çubuk ve frekans bandının altı
function djDockTopLimit () {
  let limit = 0
  const nodes = [byId('top'), el.band || byId('band')]
  nodes.forEach((n) => {
    if (!n || !n.getClientRects().length) return
    const r = n.getBoundingClientRect()
    if (r.height > 0) limit = Math.max(limit, r.bottom)
  })
  return limit
}

// Sohbet başlığı (oda adı, şifreleme ve Oda bilgisi düğmesi)
function djDockHead () {
  if (djDockCovered() || !el.main) return null
  const n = el.main.querySelector('.convo-head')
  if (!n || !n.getClientRects().length) return null
  const r = n.getBoundingClientRect()
  return r.width > 0 && r.height > 0 ? r : null
}

// Kutunun köşedeki yeri (görünüm alanı koordinatları). Üst köşede kutu bandın altında, aynı hizadaysa sohbet
// başlığının da altında durur. Alt köşede aynı yandaki yazma alanının ve telsiz kartının üstüne çıkar, sığmazsa
// bu üst sınıra kadar çıkar. İki durumda da kartın düğmelerine ve yazma alanına inmez: yer yetmezse başlık
// değil düğmeler korunur (kutu bandın altına kadar çıkar). Kutu görünüm alanında kalır (pencere kutudan alçak
// değilse): kısa pencerede bandın üstüne çıkar, 200x200 çerçeve kırpılmaz. free: alt köşede önünde hiçbir şey yok.
function djDockSpot (corner, box) {
  const vw = document.documentElement.clientWidth || window.innerWidth
  const vh = window.innerHeight
  const gap = djRemPx()
  const left = corner.charAt(1) === 'l' ? gap : vw - gap - box.width
  const right = left + box.width
  const across = (r) => r.left < right && r.right > left
  const band = Math.round(djDockTopLimit() + gap)
  let upper = band
  const head = djDockHead()
  if (head && across(head)) upper = Math.max(upper, Math.round(head.bottom + gap / 2))
  let top = upper
  let natural = null
  let lifted = false
  if (corner.charAt(0) === 'b') {
    let bottom = vh - gap
    djDockObstacles().forEach((r) => {
      if (!across(r)) return
      bottom = Math.min(bottom, r.top - gap / 2)
      lifted = true
    })
    natural = Math.round(bottom - box.height)
    top = Math.max(natural, upper)
  }
  let floor = Infinity
  djDockControls().forEach((r) => {
    if (across(r)) floor = Math.min(floor, r.top - gap / 2)
  })
  if (top + box.height > floor) top = Math.max(band, Math.round(floor - box.height))
  top = Math.max(0, Math.min(top, Math.round(vh - box.height - gap)))
  return {
    top: top,
    lift: Math.round(vh - top - box.height),
    free: !lifted && top === natural,
    rect: { left: left, right: right, top: top, bottom: top + box.height }
  }
}

// Köşe ve uzaklıklar gövdeye yazılır (dj.css): üst köşelerde --dj-dock-top, alt köşelerde --dj-dock-lift
// (djDockSpot). Kısa bildirim ve güncelleme şeridi alt köşedeki kutunun üstüne çıkar (--dj-dock-clear).
function djPlaceDock (docked) {
  const body = document.body
  const node = el.dj
  const corner = docked ? djDockPlace() : null
  body.classList.toggle('has-dj-dock', docked)
  body.classList.toggle('has-dj-dock-bottom', Boolean(corner) && corner.charAt(0) === 'b')
  djAttr(node, 'data-dock', corner)
  if (!docked || !dj.ui) {
    body.style.removeProperty('--dj-dock-lift')
    body.style.removeProperty('--dj-dock-top')
    body.style.removeProperty('--dj-dock-clear')
    body.classList.remove('has-dj-dock-lift')
    dj.dockBottom = null
    return
  }
  const box = dj.ui.float.getBoundingClientRect()
  const spot = djDockSpot(corner, box)
  if (corner.charAt(0) === 't') {
    body.style.setProperty('--dj-dock-top', spot.top + 'px')
    body.style.removeProperty('--dj-dock-lift')
    body.style.removeProperty('--dj-dock-clear')
    body.classList.remove('has-dj-dock-lift')
    dj.dockBottom = null
    return
  }
  // Önünde bir şey yoksa kutu CSS'teki yerindedir (alt boşluk ve güvenli alan)
  const value = spot.free ? null : spot.lift + 'px'
  if (value === null) body.style.removeProperty('--dj-dock-lift')
  else body.style.setProperty('--dj-dock-lift', value)
  body.classList.toggle('has-dj-dock-lift', value !== null)
  body.style.setProperty('--dj-dock-clear', Math.round(spot.lift + box.height + djRemPx()) + 'px')
  dj.dockBottom = value
}

function djApplyLayout (show) {
  dj.layoutBusy = true
  try {
    djApplyLayoutNow(show)
  } finally {
    dj.layoutBusy = false
  }
}

function djApplyLayoutNow (show) {
  const node = el.dj
  const sheetMode = djIsSheetMode()
  const layer = typeof findLayer === 'function' ? findLayer('sheet-dj') : null
  if (dj.sheetMode !== sheetMode) {
    dj.sheetMode = sheetMode
    // Yayın bitti veya pencere genişledi: açık sayfa kapanır, kart sütundaki yerine döner
    if (!sheetMode && layer) closeLayer(layer, false)
  }
  // Sütun görünürken kart sağ sütunun üstüne yerleşir, İstasyonlar listesi altında kalır, sol sütun (telsiz
  // kartı ve oda bilgisi) yerinde kalır (frekans.css)
  djAttr(el.appView, 'data-dj-col', !sheetMode && show ? 'on' : 'off')
  node.classList.toggle('is-sheet-mode', sheetMode)
  node.classList.toggle('is-cast-docked', sheetMode && dj.castLive && window.innerWidth >= 1280)
  let hidden = !show
  if (sheetMode) {
    if (!show && findLayer('sheet-dj')) closeLayer(findLayer('sheet-dj'), false)
    hidden = !(show && Boolean(findLayer('sheet-dj')))
  }
  // Köşedeyken kart görünmezdir (display: none çerçeveyi de gizlerdi): kart visibility ile gizlenir, yalnızca
  // oynatıcı alanı ve çubuğu görünür. Kapalı sayfa yer kaplamaz, sütundaki kart yerini korur (dj.css). Yüzen
  // oynatıcıda kart görünür kalır, oynatıcının yeri kapanır.
  const docked = djWantDock(show, hidden)
  const dockOnly = docked && hidden
  const dockFloat = docked && !hidden && djFloatOn()
  const dialog = sheetMode && !dockOnly
  djAttr(node, 'role', dialog ? 'dialog' : null)
  djAttr(node, 'aria-modal', dialog ? 'true' : null)
  djAttr(node, 'aria-labelledby', dialog ? 'dj-sheet-title' : null)
  dj.docked = docked
  node.classList.toggle('is-docked', docked)
  node.classList.toggle('is-dock-only', dockOnly)
  node.classList.toggle('is-dock-float', dockFloat)
  node.classList.toggle('is-dock-min', docked && dj.minimized)
  const hide = hidden && !docked
  if (node.hidden !== hide) node.hidden = hide
  djPlaceDock(docked)
  djSyncMinimizedHold()
}

// Küçültülmüş köşedeki YouTube oynatıcısı bu cihazda bekletilir (music.js setLocalHold, oda durumu değişmez)
function djSyncMinimizedHold () {
  const engine = djEngine()
  if (!engine || typeof engine.setLocalHold !== 'function') return
  engine.setLocalHold('minimized', Boolean(dj.docked && dj.minimized), 'youtube')
}

function djLayout () {
  const cast = djDetectCast()
  if (cast !== dj.castLive) dj.castLive = cast
  djRenderSoon()
}

// Pencere boyutu değişti: köşeye alma kararı hemen verilir (bir kare bile görünmez kalan oynatıcı duraklar)
function djOnResize () {
  const cast = djDetectCast()
  if (cast !== dj.castLive) dj.castLive = cast
  if (dj.ready && !dj.layoutBusy) djRender()
}

// Katman yığını değişti (12-init.js sayfaları, Ayarlar, menüler, pencereler): köşeye alma kararı aynı anda
// verilir. djApplyLayout'un kendi kapattığı sayfa yeniden çizim başlatmaz.
function djOnLayers () {
  if (dj.ready && !dj.layoutBusy) djRender()
}

// Kartı gösterir: sütundayken karta odaklanır, sayfa kipindeyse sayfayı açar
function djReveal (trigger) {
  if (!djShouldShow()) return
  djRender()
  if (!djIsSheetMode()) {
    const target = dj.ui ? focusables(el.djCard)[0] : null
    if (target) focusNode(target)
    if (el.dj.scrollIntoView) el.dj.scrollIntoView({ block: 'nearest' })
    return
  }
  if (findLayer('sheet-dj')) return
  openSheet('dj', trigger || null)
  djRender()
}

// ------------------------------------------------------------------ telsiz kartındaki Telsiz DJ düğmesi

// Düğme kadronun altındaki araç satırında (#radio-tools) Büyüt düğmesinden sonra durur
function djEnsureCrewItem (show) {
  const list = el.radioTools
  if (!list) return
  let li = dj.crewLi
  if (!show) {
    if (li && li.parentNode) li.parentNode.removeChild(li)
    return
  }
  if (!li) {
    li = h('span', 'radio-tool-wrap crew-dj')
    dj.crewLi = li
    const btn = h('button', 'radio-tool dj-crew-button')
    btn.type = 'button'
    btn.setAttribute('data-focus-key', 'crew-dj')
    btn.setAttribute('aria-controls', 'dj')
    const av = h('span', 'radio-tool-mark dj-avatar')
    av.setAttribute('aria-hidden', 'true')
    av.appendChild(icon('i-music', 'radio-tool-icon dj-avatar-icon'))
    btn.appendChild(av)
    btn.appendChild(h('span', 'radio-tool-label dj-crew-name'))
    btn.addEventListener('click', () => {
      const engine = djEngine()
      const s = djSnapshot()
      // Dokunarak başlatma bu dokunuşla yapılır (kullanıcı hareketi), ardından kart gösterilir
      if (engine && s && s.player && s.player.needsTap) engine.unlock()
      djReveal(btn)
    })
    btn.addEventListener('focus', () => {
      dj.crewFocus = true
    })
    btn.addEventListener('blur', () => {
      if (btn.isConnected !== false) dj.crewFocus = false
    })
    li.appendChild(btn)
  }
  // Düğme her zaman araç satırının sonunda durur. Satır yeniden düzenlenince (10-voice.js renderRadioCams)
  // aynı öğe geri eklenir, odaktaysa odak geri verilir.
  if (li.parentNode !== list || li !== list.lastElementChild) {
    list.appendChild(li)
    const active = document.activeElement
    if (dj.crewFocus && (!active || active === document.body)) focusNode(li.firstChild)
  }
  djUpdateCrewItem(li)
}

function djUpdateCrewItem (li) {
  const s = djSnapshot()
  const btn = li.querySelector('.dj-crew-button')
  const av = li.querySelector('.dj-avatar')
  if (!s || !btn || !av) return
  const session = s.session
  const current = session ? session.current : null
  const playing = Boolean(current && session.playing)
  li.classList.toggle('is-playing', playing)
  li.classList.toggle('is-muted', Boolean(s.muted))
  li.classList.toggle('needs-tap', Boolean(s.player && s.player.needsTap))
  let badge = av.querySelector('.crew-badge')
  if (s.muted && !badge) {
    badge = h('span', 'crew-badge dj-crew-badge')
    badge.appendChild(icon('i-speaker-off'))
    av.appendChild(badge)
  } else if (!s.muted && badge) {
    av.removeChild(badge)
  }
  if (badge) badge.title = t('dj.state.muted')
  const name = t('music.botName')
  djSetText(btn.querySelector('.dj-crew-name'), name)
  const states = []
  if (current) states.push(t(playing ? 'dj.state.playing' : 'dj.state.paused', { title: djTrackTitle(current) }))
  else states.push(t('dj.state.idle'))
  if (s.muted) states.push(t('dj.state.muted'))
  const label = t('dj.crewLabel', { name: name, states: states.join(', ') })
  if (btn.getAttribute('aria-label') !== label) btn.setAttribute('aria-label', label)
  djAttr(btn, 'aria-haspopup', dj.sheetMode ? 'dialog' : null)
  djAttr(btn, 'aria-expanded', dj.sheetMode ? (findLayer('sheet-dj') ? 'true' : 'false') : null)
}

// ------------------------------------------------------------------ komutlar ve sonuçlar

// Komut sonucu kısa bildirim olarak gösterilir: başarıda music.ok.*, hatada music.errors.<kod>
function djReport (command, r) {
  if (!r) return
  if (r.ok) {
    if (command === 'queue') {
      djShowQueue(r.queue)
      return
    }
    const key = r.noop ? 'music.ok.noop' : r.local ? 'music.ok.resumed' : DJ_OK_KEYS[command] || 'music.ok.noop'
    toast(() => t(key), 'ok')
    return
  }
  const code = typeof r.code === 'string' ? r.code : 'server'
  toast(() => djErrorText(code), 'error', 7000)
}

function djShowQueue (q) {
  if (!q || !q.current) {
    toast(() => t('music.nothingPlaying') + ' ' + t('music.queue.empty'), 'ok')
  } else {
    const title = djTrackTitle(q.current)
    const count = q.queue.length
    toast(() => t('dj.queueSummary', { title: title, count: count }), 'ok', 7000)
  }
  // Sütundaki kart zaten görünür, sayfa kipinde sayfa açılır
  if (djIsSheetMode()) djReveal(document.activeElement)
}

function djPrecheck () {
  const s = djSnapshot()
  if (!s || !s.supported) return 'dj_unsupported'
  if (!s.enabled) return 'dj_disabled'
  if (s.room === null) return 'not_in_voice'
  if (djListenOnly()) return 'dj_restricted'
  return null
}

// Kısıtlı kip (meta.music.restricted): odada DJ izni olan biri varken izni olmayan yalnızca dinler. Sunucu
// da aynı kuralla yazımı reddeder, burası yalnızca denetimleri gizler.
function djListenOnly () {
  const m = state.meta && state.meta.music
  if (!m || m.restricted !== true || hasPerm('dj')) return false
  const room = dj.voiceRoom
  if (room === null || room === undefined) return false
  return voiceRoster(room).some((e) => e && userHasPerm(e.userId, 'dj'))
}

// 08-composer.js kancası: DJ komutu değilse null (metin mesaj olarak gider), komutsa Promise
function djCommand (text, ctx) {
  const M = djMusic()
  const engine = djEngine()
  if (!M || !engine) return null
  const cmd = M.parseCommand(text)
  if (!cmd) return null
  if (cmd.name === 'play' && !cmd.error && !cmd.videoId) {
    const files = ctx && Array.isArray(ctx.files) ? ctx.files : []
    const att = files.filter((a) => a && M.isAudioAttachment({ kind: a.kind, m: a.mime, name: a.name }))[0]
    // Yükleme sürerken metin yazma alanında kalır (gönderim yüklemeyi bekleme uyarısı verir)
    if (!att && ctx && ctx.pending > 0) return null
    if (att) return djPlayAttached(att, ctx)
    if (cmd.query) return djPlaySearch(cmd.query, text)
  }
  // Duyuru komutun yazıldığı yazı odasına gider (kullanıcı bu arada oda değiştirse bile)
  const roomId = state.channelId
  const pending = engine.runCommand(text)
  if (!pending) return null
  return pending.then((r) => {
    djReport(r && r.command ? r.command : cmd.name, r)
    if (r && r.ok && !r.noop && cmd.name === 'play' && cmd.videoId) djAnnounceTrack(roomId, text, { op: 'add', src: 'yt', vid: cmd.videoId }, r.trackId)
    return r
  })
}

// ------------------------------------------------------------------ şarkı adıyla arama (istek 5)

// Sahip aramayı açtı mı (sunucu yalnızca DJ ve YouTube kaynağı da açıkken doğru verir)
function djSearchOn () {
  const m = state.meta && state.meta.music
  return Boolean(m && m.search === true)
}

function djSearchPage (query) {
  return DJ_SEARCH_PAGE + encodeURIComponent(query)
}

// Arama yapılamadı: hata bildirimi ve kartta YouTube'da arama bağlantısı. Sayfa kipinde DJ sayfası açılır ki
// bağlantı görünsün (/kuyruk komutundaki gibi). Arkasından yeni bir arama başlatılmışsa (stale) yalnızca
// bildirim gösterilir, kart son aramayı gösterir.
function djSearchMissed (query, code, stale) {
  const text = code === 'search_no_results' ? () => t('music.errors.search_no_results', { query: query }) : () => djErrorText(code)
  toast(text, 'error', 7000)
  if (stale || DJ_SEARCH_MISS.indexOf(code) === -1) return
  dj.searchMiss = { query: query, code: code, room: dj.voiceRoom }
  djRenderSoon()
  if (djIsSheetMode()) djReveal(document.activeElement)
}

function djRenderSearch (ui) {
  // Sahip aramayı sonradan açtıysa "arama kapalı" satırı artık gösterilmez
  const stale = Boolean(dj.searchMiss && dj.searchMiss.code === 'search_unavailable' && djSearchOn())
  const miss = dj.searchMiss && !stale && sameId(dj.searchMiss.room, dj.voiceRoom) ? dj.searchMiss : null
  ui.search.hidden = !dj.searching && !miss
  ui.searchLinkRow.hidden = !miss
  ui.searchOwner.hidden = !(miss && miss.code === 'search_unavailable' && isOwner())
  if (dj.searching) {
    djSetText(ui.searchText, t('music.searching', { query: dj.searching }))
    return
  }
  if (!miss) return
  djSetText(ui.searchText, t('dj.searchMiss', { query: miss.query }))
  djSetText(ui.searchLink, t('dj.searchOnYoutube'))
  const href = djSearchPage(miss.query)
  if (ui.searchLink.getAttribute('href') !== href) ui.searchLink.setAttribute('href', href)
  if (!ui.searchOwner.hidden) djSetText(ui.searchOwner, t('dj.searchOwnerHint'))
}

// /çal şarkı adı: sunucu YouTube'da arar, ilk sonuç başlığıyla eklenir ve duyuru başlıkla hemen gider. Duyuru
// komutun yazıldığı yazı odasına gider. Sonuç Promise<{ ok, code?, command }>.
function djPlaySearch (query, text) {
  const engine = djEngine()
  const roomId = state.channelId
  const voiceRoom = dj.voiceRoom
  const fail = (code) => Promise.resolve({ ok: false, code: code, command: 'play' })
  const pre = djPrecheck()
  if (pre) {
    djReport('play', { ok: false, code: pre })
    return fail(pre)
  }
  const s = djSnapshot()
  if (s && s.youtubeEnabled === false) {
    djReport('play', { ok: false, code: 'youtube_disabled' })
    return fail('youtube_disabled')
  }
  // Aynı anda birden çok arama sürebilir: "aranıyor" satırı ve karttaki bağlantı yalnızca son yazılan /çal
  // komutuyla değişir, daha önce başlatılan aramanın yanıtı yalnızca bildirim gösterir
  dj.searchSeq += 1
  if (!djSearchOn()) {
    dj.searching = null
    djSearchMissed(query, 'search_unavailable')
    return fail('search_unavailable')
  }
  const seq = dj.searchSeq
  dj.searching = query
  dj.searchMiss = null
  toast(() => t('music.searching', { query: query }), 'ok', 8000)
  djRenderSoon()
  // Ses odasının kimliği anlık görüntüde dize olabilir, sunucu sayı bekler (motorun postState'i gibi)
  return api('POST', '/api/music/search', { channelId: Number(voiceRoom), q: query }).then((res) => {
    // Ses odası saniyelik denetimden önce yeniden okunur: yanıt gelmeden oda değiştiyse arama eskimiştir
    djSyncVoice()
    const stale = seq !== dj.searchSeq
    if (!stale) {
      dj.searching = null
      djRenderSoon()
    }
    if (!res || res.status !== 200) {
      const serverCode = res && res.data && typeof res.data.code === 'string' ? res.data.code : ''
      const code = !res || res.status === 0 ? 'network' : DJ_SEARCH_ERRORS[serverCode] || 'server'
      djSearchMissed(query, code, stale)
      return fail(code)
    }
    const results = res.data && Array.isArray(res.data.results) ? res.data.results : []
    const first = results.filter((r) => r && typeof r.videoId === 'string')[0]
    if (!first) {
      djSearchMissed(query, 'search_no_results', stale)
      return fail('search_no_results')
    }
    // Arama komutun verildiği ses odası içindir. Yanıt gelmeden bu cihaz başka bir ses odasına geçtiyse veya
    // odadan çıktıysa parça eklenmez: motor artık yeni odanın kuyruğunu yazar
    if (!sameId(dj.voiceRoom, voiceRoom)) {
      toast(() => t('music.errors.search_room_changed', { query: query }), 'error', 7000)
      return fail('search_room_changed')
    }
    const title = cleanDjTitle(first.title)
    return engine.addYouTube(first.videoId, { title: title }).then((r) => {
      if (!r || !r.ok || r.noop) {
        djReport('play', r)
        return Object.assign({ command: 'play' }, r)
      }
      toast(() => (title ? t('music.ok.addedTitle', { title: title }) : t('music.ok.added')), 'ok')
      djAnnounceTrack(roomId, text, title ? { op: 'add', src: 'yt', vid: first.videoId, title: title } : { op: 'add', src: 'yt', vid: first.videoId }, r.trackId)
      return Object.assign({ command: 'play' }, r)
    })
  })
}

// Kuyruğa eklenen parça yazı odasında herkese duyurulur. Sonuç duyuru mesajının kimliği, gönderilemezse null.
// Duyuru başarısız olursa parça yine kuyruktadır, yalnızca bildirim gösterilir.
function djAnnounce (roomId, text, d) {
  if (!roomId || isDmChannel(roomId)) return Promise.resolve(null)
  const failed = () => {
    toast(() => t('dj.notice.failed'), 'error')
    return null
  }
  return postSideMessage(roomId, text, d).then((id) => (id === null || id === undefined ? failed() : id), failed)
}

// YouTube parçasının adı ekleme anında bilinmeyebilir, oynatıcısı yüklenen ilk cihaz adı duruma yazar
// (music.js annotate). Ad biliniyorsa duyuru hemen gider. Bilinmiyorsa parça en çok DJ_TITLE_WAIT_MS izlenir,
// ad gelince duyuru adla gider. Süre dolarsa duyuru adsız gider, ad sonradan gelirse ekleyenin kendi mesajı
// düzenlenir (DJ_NOTICE_EDIT_MS içinde, parça kuyruktayken). Sayfa gizlenir veya kapanırsa bekleyen duyuru hemen
// adsız gider (djFlushTitles).
function djAnnounceTrack (roomId, text, d, trackId) {
  if (!roomId || isDmChannel(roomId)) return
  const track = djLiveTrack(trackId)
  const title = d.title || (track ? track.title : '')
  if (title || !trackId) {
    djAnnounce(roomId, text, title ? Object.assign({}, d, { title: title }) : d)
    return
  }
  const at = Date.now()
  dj.titleWatch.push({ roomId: roomId, text: text, d: d, trackId: trackId, deadline: at + DJ_TITLE_WAIT_MS, until: at + DJ_NOTICE_EDIT_MS, sent: null })
  djCheckTitles()
}

// Motorun her durum değişikliğinde ve saniyelik denetimde bekleyen duyurular denetlenir
function djCheckTitles () {
  if (!dj.titleWatch.length) return
  const now = Date.now()
  dj.titleWatch = dj.titleWatch.filter((w) => {
    const track = djLiveTrack(w.trackId)
    const title = track ? track.title : ''
    if (title) {
      const d = Object.assign({}, w.d, { title: title })
      if (!w.sent) {
        djAnnounce(w.roomId, w.text, d)
      } else {
        w.sent.then((id) => {
          if (id !== null) return editSideMessage(w.roomId, id, w.text, d)
          return false
        }).catch((err) => {
          window.console.error(err)
        })
      }
      return false
    }
    if (!w.sent && (now >= w.deadline || !track)) w.sent = djAnnounce(w.roomId, w.text, w.d)
    return Boolean(track) && now < w.until
  })
}

// Sayfa gizlenirken (visibilitychange) veya kapanırken (pagehide) adı beklenen duyurular hemen adsız gider:
// bekleyen kayıt yalnızca bellektedir, sekme kapanır veya yenilenirse duyuru hiç gitmezdi. Sayfa açık kalırsa ad
// gelince duyuru yine düzenlenir. Kapanış anında başlayan istek yarıda kalabilir, bu en iyi çabadır.
function djFlushTitles () {
  dj.titleWatch.forEach((w) => {
    if (!w.sent) w.sent = djAnnounce(w.roomId, w.text, w.d)
  })
}

// /çal ve ekli ses dosyası: dosya önce yazı odasına mesaj eki olarak gönderilir (odadakiler indirebilsin),
// ardından kuyruğa eklenir
function djPlayAttached (att, ctx) {
  const engine = djEngine()
  const fail = (code) => {
    djReport('play', { ok: false, code: code })
    return Promise.resolve({ ok: false, code: code })
  }
  const pre = djPrecheck()
  if (pre) return fail(pre)
  if (ctx && ctx.pending > 0) {
    toast(() => t('composer.waitUploads'), 'error')
    return Promise.resolve({ ok: false, code: 'pending' })
  }
  if (!state.channelId || isDmChannel(state.channelId)) {
    toast(() => t('dj.fileNeedsRoom'), 'error', 7000)
    return Promise.resolve({ ok: false, code: 'file_unavailable' })
  }
  const ref = { u: att.uploadId, k: att.key, n: att.nonce, m: att.mime, s: att.size, name: att.name }
  const notice = { op: 'add', src: 'file' }
  const title = cleanDjTitle(att.name)
  if (title) notice.title = title
  return Promise.resolve().then(() => sendMessage({ dj: notice })).then(() => {
    if (state.attachments.indexOf(att) !== -1) {
      toast(() => t('dj.fileSendFailed'), 'error', 7000)
      return { ok: false, code: 'send_failed' }
    }
    return engine.addFile(ref).then((r) => {
      djReport('play', r)
      return r
    })
  })
}

// 06-messages.js: ses dosyası kartının yanına "DJ'de çal" düğmesi. Özel mesajdaki ek oda üyelerince
// indirilemediği için orada gösterilmez.
function djDecorateAttachments (wrap, files, m) {
  const M = djMusic()
  if (!M || !wrap || !Array.isArray(files) || !m || isDmChannel(m.channelId)) return
  const cards = Array.from(wrap.children)
  files.forEach((f, i) => {
    const card = cards[i]
    if (!card || !M.isAudioAttachment(f)) return
    const row = h('div', 'dj-file-actions')
    const b = djButton('button button-small button-secondary dj-play-file', t('music.playInDj'), 'i-music')
    b.setAttribute('aria-label', t('dj.playFileLabel', { name: f.name || t('music.untitledFile') }))
    b.addEventListener('click', () => {
      djPlayFile(f, b, m)
    })
    row.appendChild(b)
    if (card.nextSibling) wrap.insertBefore(row, card.nextSibling)
    else wrap.appendChild(row)
  })
}

// "DJ'de Çal" duyurusunun metni (mesajın t alanı). Bu kaynağı bilmeyen eski istemciler metni düz metin olarak
// gösterir ve içinde @ ile anma arar. Ad dosyayı yükleyen kişinin seçtiği addır. Düğmeye basan kişinin adına ve
// yetkisiyle anma (ör. @herkes) olmasın diye adın içindeki @ işaretleri tam genişlikli at işaretiyle (U+FF20)
// yazılır. Duyurunun d alanındaki ad değişmez: yeni istemciler duyuruyu oradan düz metin olarak çizer ve DJ
// duyurusunda anma aramaz (18-mentions.js messageMentionsMe).
function djFileRefText (title) {
  if (!title) return t('dj.notice.fileRef')
  return t('dj.notice.fileTitle', { title: title.replace(/@/g, '\uff20') })
}

// "DJ'de çal": dosya kuyruğa eklenir ve dosyanın bulunduğu yazı odasına adıyla duyurulur. Duyuru eki taşımaz
// (dosya başka bir mesajdadır), kaynağı 'fileref' olur. Bu kaynağı bilmeyen eski istemciler duyuruyu düz metin
// olarak gösterir, mesajın metni bu yüzden çevrilmiş tam duyurudur (06-messages.js cleanDjNotice).
function djPlayFile (f, b, m) {
  const engine = djEngine()
  if (!engine || b.getAttribute('aria-busy') === 'true') return
  b.setAttribute('aria-busy', 'true')
  engine.addFile({ u: f.u, k: f.k, n: f.n, m: f.m, s: f.s, name: f.name }).then((r) => {
    b.removeAttribute('aria-busy')
    djReport('play', r)
    if (r && r.ok && !r.noop && m) {
      const track = djLiveTrack(r.trackId)
      const title = cleanDjTitle(track ? track.title : f.name)
      const notice = { op: 'add', src: 'fileref' }
      if (title) notice.title = title
      djAnnounce(m.channelId, djFileRefText(title), notice)
    }
  }, (err) => {
    b.removeAttribute('aria-busy')
    window.console.error(err)
  })
}

// ------------------------------------------------------------------ masaüstü penceresi

// Masaüstü uygulamasında (20-desktop.js window.telsizDesktop, onWindowState) pencere simge durumuna
// küçültülünce veya tepsiye gizlenince YouTube parçası bu cihazda bekletilir (YouTube kuralları pencere kapalı
// veya küçültülmüşken çalmayı yasaklar), dosya parçaları çalmaya devam eder. Pencere geri gelince ('restored'
// veya 'shown') bekletme kalkar, oynatıcı odanın konumuna atlayıp sürer. Abonelik bir kez kurulur.
function djWatchWindowState () {
  const desktop = window.telsizDesktop
  if (dj.desktopWatched || !desktop || typeof desktop.onWindowState !== 'function') return
  dj.desktopWatched = true
  desktop.onWindowState((value) => {
    if (value !== 'minimized' && value !== 'hidden' && value !== 'restored' && value !== 'shown') return
    const engine = djEngine()
    if (engine && typeof engine.setLocalHold === 'function') engine.setLocalHold('window', value === 'minimized' || value === 'hidden', 'youtube')
    djRenderSoon()
  })
}

// ------------------------------------------------------------------ başlatma

function djInit () {
  if (dj.ready) return
  const engine = djEngine()
  if (!engine || !el.dj || !el.djCard) return
  if (typeof SHEETS === 'object' && SHEETS && !SHEETS.dj) SHEETS.dj = { id: 'dj', trigger: null }
  djBuild()
  dj.ready = true
  el.dj.addEventListener('click', onSheetCloseClick)
  if (typeof window.MutationObserver === 'function') {
    const onVoiceDom = () => {
      djSyncVoice()
      djEnsureCrewItem(djShouldShow())
      djRenderSoon()
    }
    if (el.radioCrew) new window.MutationObserver(onVoiceDom).observe(el.radioCrew, { childList: true })
    if (el.radio) new window.MutationObserver(onVoiceDom).observe(el.radio, { attributes: true, attributeFilter: ['data-state'] })
    const castObserver = new window.MutationObserver(djLayout)
    const castNode = el.cast || byId('cast')
    if (castNode) castObserver.observe(castNode, { attributes: true, attributeFilter: ['hidden', 'data-cast', 'class'] })
    if (el.appView) castObserver.observe(el.appView, { attributes: true, attributeFilter: ['data-cast'] })
    castObserver.observe(document.body, { attributes: true, attributeFilter: ['data-cast'] })
    // Dil değişimi: metinler yeniden üretilir
    new window.MutationObserver(() => {
      dj.queueKey = ''
      djRenderSoon()
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
  }
  window.addEventListener('resize', djOnResize)
  window.addEventListener('pagehide', djFlushTitles)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') djFlushTitles()
  })
  if (typeof watchLayers === 'function') watchLayers(djOnLayers)
  // Saniyelik denetim: ses odası, konum ve zamana bağlı durum (ör. "Yükleniyor" yerine "Çalıyor"). Kart
  // gösterilmesi gerekiyorsa her zaman çizilir (sayfa gizliyken kare gelmese de yerleşim güncel kalır).
  setInterval(() => {
    djSyncVoice()
    djCheckTitles()
    if (djShouldShow()) {
      dj.snap = engine.snapshot()
      if (!dj.layoutBusy) djRender()
    } else {
      djSyncMarks()
    }
  }, DJ_TICK_MS)
  if (typeof composerSetCommandHandler === 'function') composerSetCommandHandler(djCommand)
  djWatchWindowState()
  dj.castLive = djDetectCast()
  if (state.meta) djOnMeta()
  djSyncVoice()
  djRender()
}

if (document.readyState === 'complete') {
  djInit()
} else {
  document.addEventListener('DOMContentLoaded', djInit)
}
