'use strict'

// Telsiz DJ arayüzü (Ek L2, KONSEPT 8): motorun (public/music.js, window.TelsizMusic) uygulamaya bağlanması,
// DJ kartı (#dj), ses odası kadrosundaki "Telsiz DJ" öğesi, yazma alanındaki "/" komutları, mesajdaki ses
// dosyası kartının "DJ'de çal" düğmesi ve sunucu ayarı değişikliklerinin karta yansıması.
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
// Köşedeki oynatıcı: kart görünmezken (sayfa kipinde sayfa kapalı) veya üstünü bir katman örterken (Ayarlar,
// başka bir sayfa, menü, pencere) oynatıcı alanı yalnızca CSS sınıflarıyla köşeye sabitlenir, altında başlık,
// duraklat ve "DJ'yi aç" düğmeleri olan küçük bir çubuk durur (djApplyLayout). Çerçeve ve ataları DOM'da hiç
// taşınmaz (taşınan çerçeve yeniden yüklenir), kart visibility ile gizlenir. Böylece müzik ses odasından
// ayrılana kadar çalmaya devam eder.

const DJ_TICK_MS = 500
// Perdesiz küçük katmanlar: kartın yanında açılabilir, oynatıcıyı yalnızca üstüne gelirse örter. Diğer
// katmanlar (Ayarlar, sayfalar ve perdeleri, pencereler, görüntüleyici, tam ekran yayın) her zaman örter.
const DJ_POPOVER_LAYERS = ['emoji', 'msg-menu', 'peer', 'profile-card', 'status-menu', 'social-menu', 'frekans-menu', 'band-help', 'search']
const DJ_WAVE_BARS = 30
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
  marksKey: '',
  docked: false,
  dockSticky: null,
  layoutBusy: false,
  dockBottom: null
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
    djRenderSoon()
  })
  engine.on('track', () => {
    djRenderSoon()
  })
  engine.on('notice', djOnNotice)
  engine.on('consentneeded', () => {
    if (!djCardShown()) toast(() => t('music.consent.needed'), '', 8000)
  })
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

// Bu cihazın ses odası: bağlantı tamamlanınca oda, ayrılınca null
function djSyncVoice () {
  const engine = djEngine()
  if (!engine) return
  let room = null
  if (state.inApp && typeof snap === 'function') {
    const s = snap()
    if (s.channelId !== null && s.channelId !== undefined && !s.joining) room = s.channelId
  }
  if (room === dj.voiceRoom) return
  dj.voiceRoom = room
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
  ui.yt = h('div', 'dj-yt')
  ui.yt.setAttribute('role', 'group')
  stage.appendChild(ui.yt)

  // Köşedeki oynatıcının çubuğu: yalnızca köşedeyken görünür, oynatıcı alanının altında durur (üstüne binmez)
  ui.dock = h('div', 'dj-dock')
  ui.dock.setAttribute('role', 'group')
  ui.dock.appendChild(h('span', 'dj-led'))
  ui.dockTitle = h('span', 'dj-dock-title')
  ui.dock.appendChild(ui.dockTitle)
  ui.dockToggle = button('icon-button dj-dock-toggle', '', 'i-pause', '')
  ui.dockToggle.addEventListener('click', () => {
    const engine = djEngine()
    const s = djSnapshot()
    // Dokunarak başlatma bu dokunuşla yapılır (kullanıcı hareketi), değilse kart düğmesi gibi herkes için
    if (engine && s && s.player && s.player.needsTap) engine.unlock()
    else djOnToggle()
  })
  ui.dock.appendChild(ui.dockToggle)
  ui.dockOpen = button('icon-button dj-dock-open', '', 'i-expand', '')
  ui.dockOpen.addEventListener('click', djOpenFromDock)
  ui.dock.appendChild(ui.dockOpen)
  stage.appendChild(ui.dock)

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

  ui.wave = h('div', 'dj-wave')
  ui.wave.setAttribute('aria-hidden', 'true')
  ui.waveBars = h('span', 'dj-wave-bars')
  ui.wave.appendChild(ui.waveBars)
  stage.appendChild(ui.wave)

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

  dj.ui = ui
  const engine = djEngine()
  if (engine) engine.attachPlayer(ui.yt)
}

function djRenderSoon () {
  if (dj.renderQueued || !dj.ready) return
  dj.renderQueued = true
  nextFrame(() => {
    dj.renderQueued = false
    djRender()
  })
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
  const s = djSnapshot()
  const show = djShouldShow()
  djApplyLayout(show)
  djAttr(el.appView, 'data-dj', s && s.supported && s.enabled ? 'on' : 'off')
  djEnsureCrewItem(show)
  if (!show || !dj.ui || !s) return
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
}

// Oynatıcı alanının altındaki tek uyarı satırı. Öncelik: oturum hatası, dokunarak başlat, oynatıcı hatası,
// yerel duraklatma, görünürlük.
function djRenderAlert (s, current, ytVisible) {
  const ui = dj.ui
  const p = s.player || {}
  let text = ''
  let action = ''
  let primary = false
  if (current && p.needsTap) {
    action = 'tap'
    primary = true
  } else if (current && p.error) {
    text = djErrorText(p.error)
    action = 'retry'
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
    const key = action === 'tap' ? 'music.tapToListen' : action === 'retry' ? 'music.actions.retry' : 'music.actions.resync'
    djSetText(ui.alertAction.lastChild, t(key))
  }
}

// Köşedeki oynatıcının çubuğu: parça adı, duraklat veya devam (dokunarak başlatma gerekiyorsa o) ve DJ'yi aç
function djRenderDock (s, current) {
  const ui = dj.ui
  if (!dj.docked || !current) return
  const session = s.session
  const tap = Boolean(s.player && s.player.needsTap)
  const playing = Boolean(session && session.playing)
  djAttr(ui.dock, 'aria-label', t('dj.dock.label'))
  djSetText(ui.dockTitle, djTrackTitle(current))
  djAttr(ui.dockTitle, 'title', djTrackTitle(current))
  setIcon(ui.dockToggle, playing && !tap ? 'i-pause' : 'i-play')
  const toggleLabel = t(tap ? 'music.tapToListen' : playing ? 'music.actions.pause' : 'music.actions.resume')
  djAttr(ui.dockToggle, 'aria-label', toggleLabel)
  djAttr(ui.dockToggle, 'title', toggleLabel)
  djAttr(ui.dockOpen, 'aria-label', t('dj.dock.open'))
  djAttr(ui.dockOpen, 'title', t('dj.dock.open'))
  ui.dock.classList.toggle('needs-tap', tap)
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
  if (action === 'tap') engine.unlock()
  else if (action === 'retry' || action === 'resync') engine.resync()
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
  const key = window.I18N.lang + '|' + (listenOnly ? 'l' : 'c') + '|' + items.map((tr) => tr.id + ':' + tr.title + ':' + tr.addedBy).join(',')
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

function djOnNotice (n) {
  if (!n || typeof n.op !== 'string') return
  const key = 'music.notice.' + n.op
  if (!hasText(key)) return
  const by = n.by
  const title = n.title || ''
  dj.notice = () => t('music.notice.' + n.op, { name: by !== null && by !== undefined ? shownName(by) : '', title: title || t('music.untitledYouTube') })
  djRenderSoon()
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
function djWantDock (show, hidden) {
  const s = djSnapshot()
  if (!show || !dj.ui || !s) return false
  const current = s.session ? s.session.current : null
  if (!current || current.type !== 'youtube') return false
  if (!s.youtubeEnabled || s.consent !== 'granted' || (s.player && s.player.blocked === 'youtube_disabled')) return false
  if (hidden) return true
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

// Telefonda köşedeki oynatıcı yazma alanının üstünde durur. Yazma alanı görünmüyorsa veya üstünü bir katman
// örtüyorsa (Ayarlar, alt sayfa) ekranın altındadır.
function djDockBottom () {
  if (!isNarrow() || layers.some((layer) => layer.name !== 'sheet-dj')) return null
  const composer = byId('composer')
  if (!composer || !composer.getClientRects().length) return null
  const r = composer.getBoundingClientRect()
  const lift = Math.round(window.innerHeight - r.top)
  return r.height > 0 && lift > 0 && lift < window.innerHeight / 2 ? lift + 'px' : null
}

// Yükseklik gövdeye yazılır: kısa bildirim ve güncelleme şeridi de köşedeki oynatıcının üstüne çıkar (dj.css)
function djPlaceDock (docked) {
  const body = document.body
  body.classList.toggle('has-dj-dock', docked)
  const value = docked ? djDockBottom() : null
  if (value === dj.dockBottom) return
  dj.dockBottom = value
  if (value === null) body.style.removeProperty('--dj-dock-lift')
  else body.style.setProperty('--dj-dock-lift', value)
  body.classList.toggle('has-dj-dock-lift', value !== null)
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
  // oynatıcı alanı ve çubuğu görünür. Kapalı sayfa yer kaplamaz, sütundaki kart yerini korur (dj.css).
  const docked = djWantDock(show, hidden)
  const dockOnly = docked && hidden
  const dialog = sheetMode && !dockOnly
  djAttr(node, 'role', dialog ? 'dialog' : null)
  djAttr(node, 'aria-modal', dialog ? 'true' : null)
  djAttr(node, 'aria-labelledby', dialog ? 'dj-sheet-title' : null)
  dj.docked = docked
  node.classList.toggle('is-docked', docked)
  node.classList.toggle('is-dock-only', dockOnly)
  djPlaceDock(docked)
  const hide = hidden && !docked
  if (node.hidden !== hide) node.hidden = hide
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

// ------------------------------------------------------------------ kadrodaki Telsiz DJ öğesi

function djEnsureCrewItem (show) {
  const list = el.radioCrew
  if (!list) return
  let li = dj.crewLi
  if (!show) {
    if (li && li.parentNode) li.parentNode.removeChild(li)
    return
  }
  if (!li) {
    li = h('li', 'crew-item crew-dj')
    dj.crewLi = li
    const btn = h('button', 'crew-button dj-crew-button')
    btn.type = 'button'
    btn.setAttribute('data-focus-key', 'crew-dj')
    btn.setAttribute('aria-controls', 'dj')
    const av = h('span', 'avatar avatar-md crew-avatar dj-avatar')
    av.setAttribute('aria-hidden', 'true')
    av.appendChild(icon('i-music', 'dj-avatar-icon'))
    btn.appendChild(av)
    btn.appendChild(h('span', 'crew-name dj-crew-name'))
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
  // Öğe her zaman kadronun sonunda durur. Kadro yeniden çizilince (10-voice.js renderCrew) aynı öğe geri
  // eklenir, odaktaysa odak geri verilir.
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
    badge.appendChild(icon('i-headphones-off'))
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
  }
  // Duyuru komutun yazıldığı yazı odasına gider (kullanıcı bu arada oda değiştirse bile)
  const roomId = state.channelId
  const pending = engine.runCommand(text)
  if (!pending) return null
  return pending.then((r) => {
    djReport(r && r.command ? r.command : cmd.name, r)
    if (r && r.ok && !r.noop && cmd.name === 'play' && cmd.videoId) djAnnounce(roomId, text, { op: 'add', src: 'yt', vid: cmd.videoId })
    return r
  })
}

// Kuyruğa eklenen parça komutun yazıldığı yazı odasında herkese duyurulur. Duyuru başarısız olursa parça
// yine kuyruktadır, yalnızca bildirim gösterilir.
function djAnnounce (roomId, text, d) {
  if (!roomId || isDmChannel(roomId)) return
  postSideMessage(roomId, text, d).then((sent) => {
    if (!sent) toast(() => t('dj.notice.failed'), 'error')
  }).catch(() => toast(() => t('dj.notice.failed'), 'error'))
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
  return Promise.resolve().then(() => sendMessage({ dj: { op: 'add', src: 'file' } })).then(() => {
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
      djPlayFile(f, b)
    })
    row.appendChild(b)
    if (card.nextSibling) wrap.insertBefore(row, card.nextSibling)
    else wrap.appendChild(row)
  })
}

function djPlayFile (f, b) {
  const engine = djEngine()
  if (!engine || b.getAttribute('aria-busy') === 'true') return
  b.setAttribute('aria-busy', 'true')
  engine.addFile({ u: f.u, k: f.k, n: f.n, m: f.m, s: f.s, name: f.name }).then((r) => {
    b.removeAttribute('aria-busy')
    djReport('play', r)
  }, (err) => {
    b.removeAttribute('aria-busy')
    window.console.error(err)
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
  if (typeof watchLayers === 'function') watchLayers(djOnLayers)
  // Saniyelik denetim: ses odası, konum ve zamana bağlı durum (ör. "Yükleniyor" yerine "Çalıyor")
  setInterval(() => {
    djSyncVoice()
    if (djCardShown() || dj.docked) {
      dj.snap = engine.snapshot()
      djRender()
    } else {
      djSyncMarks()
    }
  }, DJ_TICK_MS)
  if (typeof composerSetCommandHandler === 'function') composerSetCommandHandler(djCommand)
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
