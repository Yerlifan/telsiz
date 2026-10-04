'use strict'

// Sunucu bilgileri ve kapasite önerisi (Ayarlar > Genel, sahip ve yöneticiler). Sunucunun donanım, disk,
// bellek ve kullanım bilgileri GET /api/server-info ile alınır ve "Sunucu bilgileri" bölümünde gösterilir.
// Öneri belgelenmiş, belirlenimci formüllerle hesaplanır ve arayüzde tahmin olduğu açıkça yazılır.
//
// Ses ve görüntü kişiler arasında doğrudan akar (tam örgü), bu yüzden ses odası ve kamera kapasitesi
// sunucudan çok üyelerin kendi yükleme hızına bağlıdır (TURN bu makinedeyse aktarılan medya sunucudan da
// geçer). Öneri bu yüzden "üyelerin tipik yükleme hızı" girdisini kullanır: varsayılan 5 Mbps, sahip
// değiştirebilir, değer yalnızca bu tarayıcıda saklanır ('telsiz.uploadMbps'). İsteğe bağlı olarak bu
// cihazın son görüşmesinde tarayıcının ölçtüğü gönderim hızı (WebRTC getStats availableOutgoingBitrate)
// gösterilir ve girdiye aktarılabilir. Ölçüm yalnızca bu cihazda saklanır ('telsiz.uplinkMeasure'), başka
// üyelerden hiçbir ölçüm toplanmaz ve sunucuya gönderilmez.
//
// Formüller (sabitler aşağıda). Tam örgüde kamerasını açan kişi sesini ve görüntüsünü odadaki diğer herkese
// ayrı ayrı gönderir, darboğaz bu kişinin yüklemesidir:
//   kullanılabilir yükleme = yükleme hızı x KAPASITE_USABLE_SHARE (yüzde 70)
//   yalnızca ses kapasitesi = (N - 1) x KAPASITE_AUDIO_KBPS <= kullanılabilir koşulunu sağlayan en büyük N
//                           = taban(kullanılabilir / KAPASITE_AUDIO_KBPS) + 1
//   önerilen kapasite = (N - 1) x (KAPASITE_AUDIO_KBPS + KAPASITE_CAMERA_KBPS) <= kullanılabilir koşulunu
//                       sağlayan en büyük N = taban(kullanılabilir / (ses + kamera)) + 1
//   önerilen kamera sınırı = önerilen kapasite (odadaki herkes kamerasını açabilir)
// Kamera sınırında indirme hızının yükleme hızından düşük olmadığı varsayılır: önerilen odada her kişi en
// çok (N - 1) görüntü indirir, bu da kamera açan kişinin yüklemesiyle aynı büyüklüktedir. Değerler izin
// verilen aralığa sıkıştırılır (kapasite 2 ile 12, kamera 1 ile 12 ve kapasiteden fazla değil).

const KAPASITE_AUDIO_KBPS = 40
const KAPASITE_CAMERA_KBPS = 400
const KAPASITE_USABLE_SHARE = 0.7
const KAPASITE_DEFAULT_UPLOAD_MBPS = 5
const KAPASITE_UPLOAD_MIN_MBPS = 0.1
const KAPASITE_UPLOAD_MAX_MBPS = 10000
const KAPASITE_LIMITS = Object.freeze({ capacityMin: 2, capacityMax: 12, camerasMin: 1, camerasMax: 12 })
// Sunucu ipuçlarının eşikleri: bellekte mesaj başına tahmini bayt (şifreli gövde ve kayıt alanları), mesaj
// sınırı dolunca tahmini belleğin etkin belleğe oranı, çekirdek başına 5 dakikalık yük ve en az boş disk
const KAPASITE_MESSAGE_BYTES = 1500
const KAPASITE_MEMORY_SHARE = 0.5
const KAPASITE_LOAD_PER_CORE = 1
const KAPASITE_DISK_LOW_BYTES = 1024 * 1024 * 1024
const KAPASITE_UPLOAD_KEY = 'telsiz.uploadMbps'
const KAPASITE_MEASURE_KEY = 'telsiz.uplinkMeasure'
const KAPASITE_SAMPLE_MS = 20000

function kapasiteClamp (value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function kapasiteLimits (limits) {
  const src = limits && typeof limits === 'object' ? limits : {}
  const pick = (key, fallback) => (typeof src[key] === 'number' && isFinite(src[key]) ? src[key] : fallback)
  return {
    capacityMin: pick('capacityMin', KAPASITE_LIMITS.capacityMin),
    capacityMax: pick('capacityMax', KAPASITE_LIMITS.capacityMax),
    camerasMin: pick('camerasMin', KAPASITE_LIMITS.camerasMin),
    camerasMax: pick('camerasMax', KAPASITE_LIMITS.camerasMax)
  }
}

// Geçerli yükleme hızı (Mbps) veya null
function kapasiteUpload (value) {
  const n = typeof value === 'number' ? value : Number(String(value === undefined || value === null ? '' : value).replace(',', '.'))
  if (!isFinite(n) || n < KAPASITE_UPLOAD_MIN_MBPS || n > KAPASITE_UPLOAD_MAX_MBPS) return null
  return n
}

function kapasiteUsableKbps (uploadMbps) {
  return uploadMbps * 1000 * KAPASITE_USABLE_SHARE
}

function kapasiteSafeCapacity (uploadMbps, limits) {
  const l = kapasiteLimits(limits)
  const raw = Math.floor(kapasiteUsableKbps(uploadMbps) / KAPASITE_AUDIO_KBPS) + 1
  return kapasiteClamp(raw, l.capacityMin, l.capacityMax)
}

// Kamerası açık bir kişinin herkese ses ve görüntü gönderebileceği en büyük oda. raw: sıkıştırmadan önceki
// değer (2'den küçükse en küçük odada bile tek bir kamera tam kalitede gönderilemez).
function kapasiteCameraCapacity (uploadMbps, limits) {
  const l = kapasiteLimits(limits)
  const raw = Math.floor(kapasiteUsableKbps(uploadMbps) / (KAPASITE_AUDIO_KBPS + KAPASITE_CAMERA_KBPS)) + 1
  return { value: kapasiteClamp(raw, l.capacityMin, l.capacityMax), raw: raw }
}

// Önerilen kamera sınırı: verilen odada herkes kamerasını açabilir, sahibin aralığına sıkıştırılır
function kapasiteMaxCameras (capacity, limits) {
  const l = kapasiteLimits(limits)
  return kapasiteClamp(capacity, l.camerasMin, Math.min(l.camerasMax, capacity))
}

// Öneri: { upload, usableKbps, capacity, audioCapacity, maxCameras, audioKbps, cameraKbps, camerasTight }
// veya geçersiz girdide null. capacity kameralı kullanıma göre, audioCapacity yalnızca sese göre kapasitedir.
// audioKbps ve cameraKbps önerilen odada kişinin yalnızca sesle ve kamerasıyla gönderdiği toplamdır.
function kapasiteRecommend (uploadMbps, limits) {
  const upload = kapasiteUpload(uploadMbps)
  if (upload === null) return null
  const audioCapacity = kapasiteSafeCapacity(upload, limits)
  const cam = kapasiteCameraCapacity(upload, limits)
  const capacity = Math.min(audioCapacity, cam.value)
  return {
    upload: upload,
    usableKbps: Math.round(kapasiteUsableKbps(upload)),
    capacity: capacity,
    audioCapacity: audioCapacity,
    maxCameras: kapasiteMaxCameras(capacity, limits),
    audioKbps: (capacity - 1) * KAPASITE_AUDIO_KBPS,
    cameraKbps: (capacity - 1) * (KAPASITE_AUDIO_KBPS + KAPASITE_CAMERA_KBPS),
    camerasTight: cam.raw < 2
  }
}

// Sunucu bilgilerinden ipuçları: [{ level: 'warn' | 'info' | 'ok', key, params }]. key i18n anahtarının
// sonudur ('serverInfo.hint.' + key). Sayılar ham değerdir, metin çizilirken biçimlenir.
function kapasiteHints (facts) {
  const out = []
  const f = facts && typeof facts === 'object' ? facts : {}
  const data = f.data && typeof f.data === 'object' ? f.data : {}
  const disk = f.disk && typeof f.disk === 'object' ? f.disk : null
  if (disk && typeof disk.free === 'number') {
    const quota = typeof data.uploadQuotaBytes === 'number' ? data.uploadQuotaBytes : 0
    const used = typeof data.uploadsBytes === 'number' ? data.uploadsBytes : 0
    const remaining = Math.max(0, quota - used)
    if (remaining > 0 && disk.free < remaining) out.push({ level: 'warn', key: 'diskQuota', params: { free: disk.free, remaining: remaining } })
    else if (disk.free < KAPASITE_DISK_LOW_BYTES) out.push({ level: 'warn', key: 'diskLow', params: { free: disk.free } })
  }
  const mem = f.memory && typeof f.memory === 'object' ? f.memory : null
  if (mem && typeof mem.total === 'number' && mem.total > 0 && typeof data.maxTotalMessages === 'number') {
    const effective = typeof mem.cgroupLimit === 'number' && mem.cgroupLimit > 0 ? Math.min(mem.total, mem.cgroupLimit) : mem.total
    const estimate = data.maxTotalMessages * KAPASITE_MESSAGE_BYTES
    if (estimate > effective * KAPASITE_MEMORY_SHARE) out.push({ level: 'warn', key: 'memoryMessages', params: { estimate: estimate, memory: effective, max: data.maxTotalMessages } })
  }
  const cpu = f.cpu && typeof f.cpu === 'object' ? f.cpu : null
  if (cpu && Array.isArray(cpu.loadavg) && typeof cpu.cores === 'number' && cpu.cores > 0) {
    const load = cpu.loadavg[1]
    if (typeof load === 'number' && load / cpu.cores > KAPASITE_LOAD_PER_CORE) out.push({ level: 'warn', key: 'loadHigh', params: { load: load, cores: cpu.cores } })
  }
  const turn = f.turn && typeof f.turn === 'object' ? f.turn : null
  if (turn && turn.local) out.push({ level: 'info', key: 'turnLocal', params: {} })
  else if (turn && !turn.configured) out.push({ level: 'info', key: 'turnNone', params: {} })
  if (!out.some((x) => x.level === 'warn')) out.unshift({ level: 'ok', key: 'allGood', params: {} })
  return out
}

window.TelsizKapasite = {
  AUDIO_KBPS: KAPASITE_AUDIO_KBPS,
  CAMERA_KBPS: KAPASITE_CAMERA_KBPS,
  USABLE_SHARE: KAPASITE_USABLE_SHARE,
  DEFAULT_UPLOAD_MBPS: KAPASITE_DEFAULT_UPLOAD_MBPS,
  MESSAGE_BYTES: KAPASITE_MESSAGE_BYTES,
  MEMORY_SHARE: KAPASITE_MEMORY_SHARE,
  LOAD_PER_CORE: KAPASITE_LOAD_PER_CORE,
  DISK_LOW_BYTES: KAPASITE_DISK_LOW_BYTES,
  upload: kapasiteUpload,
  usableKbps: kapasiteUsableKbps,
  safeCapacity: kapasiteSafeCapacity,
  cameraCapacity: (upload, limits) => kapasiteCameraCapacity(upload, limits).value,
  maxCameras: kapasiteMaxCameras,
  recommend: kapasiteRecommend,
  hints: kapasiteHints
}

// ------------------------------------------------------------------ cihazdaki girdiler ve ölçüm

function kapasiteStoredUpload () {
  const raw = typeof storeGet === 'function' ? storeGet(KAPASITE_UPLOAD_KEY) : null
  const n = kapasiteUpload(raw)
  return n === null ? KAPASITE_DEFAULT_UPLOAD_MBPS : n
}

function kapasiteMeasure () {
  const m = typeof storeGetJson === 'function' ? storeGetJson(KAPASITE_MEASURE_KEY, null) : null
  if (!m || typeof m.kbps !== 'number' || !isFinite(m.kbps) || m.kbps <= 0 || typeof m.at !== 'number') return null
  return { kbps: m.kbps, at: m.at }
}

// Ses odasındayken (yalnızca sahip ve yöneticilerin cihazında) tarayıcının gönderim hızı tahmini düzenli
// okunur, görüşme boyunca görülen en büyük değer bu cihazda saklanır
const kapasiteSampler = { timer: 0, channel: null, max: 0 }

function kapasiteSample () {
  const s = state.voiceSnap
  if (!voice || typeof voice.uplinkEstimate !== 'function' || !s || !s.channelId || s.joining || typeof isAdmin !== 'function' || !isAdmin()) {
    kapasiteSampler.channel = null
    kapasiteSampler.max = 0
    return
  }
  if (kapasiteSampler.channel !== s.channelId) {
    kapasiteSampler.channel = s.channelId
    kapasiteSampler.max = 0
  }
  Promise.resolve(voice.uplinkEstimate()).then((kbps) => {
    if (typeof kbps !== 'number' || !isFinite(kbps) || kbps <= 0 || kbps <= kapasiteSampler.max) return
    kapasiteSampler.max = kbps
    storeSetJson(KAPASITE_MEASURE_KEY, { kbps: kbps, at: Date.now() })
  }, () => {})
}

function kapasiteStartSampler () {
  if (kapasiteSampler.timer || typeof setInterval !== 'function' || typeof document === 'undefined') return
  kapasiteSampler.timer = setInterval(kapasiteSample, KAPASITE_SAMPLE_MS)
}

// ------------------------------------------------------------------ biçimler

function kapasiteMbps (value) {
  return t('serverInfo.mbps', { value: formatNumber(Math.round(value * 10) / 10) })
}

function kapasiteUptime (seconds) {
  const total = Math.max(0, Math.floor(seconds))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (days > 0) return t('serverInfo.uptimeDays', { days: formatNumber(days), hours: formatNumber(hours) })
  return t('serverInfo.uptimeHours', { hours: formatNumber(hours), minutes: formatNumber(minutes) })
}

function kapasiteHintText (hint) {
  const p = hint.params || {}
  const params = {}
  Object.keys(p).forEach((k) => {
    params[k] = p[k]
  })
  if (typeof p.free === 'number') params.free = formatSize(p.free)
  if (typeof p.remaining === 'number') params.remaining = formatSize(p.remaining)
  if (typeof p.estimate === 'number') params.estimate = formatSize(p.estimate)
  if (typeof p.memory === 'number') params.memory = formatSize(p.memory)
  if (typeof p.max === 'number') params.max = formatNumber(p.max)
  if (typeof p.load === 'number') params.load = formatNumber(p.load)
  if (typeof p.cores === 'number') params.cores = formatNumber(p.cores)
  return t('serverInfo.hint.' + hint.key, params)
}

// Bilgi satırları: [[etiket, değer]]
function kapasiteFactRows (f) {
  const rows = []
  const cpu = f.cpu || {}
  const cores = typeof cpu.cores === 'number' ? t('serverInfo.cores', { count: cpu.cores }) : ''
  rows.push([t('serverInfo.cpu'), [cpu.model || t('serverInfo.unknown'), cores].filter(Boolean).join(' · ')])
  rows.push([t('serverInfo.load'), Array.isArray(cpu.loadavg) ? t('serverInfo.loadValue', { one: formatNumber(cpu.loadavg[0]), five: formatNumber(cpu.loadavg[1]), fifteen: formatNumber(cpu.loadavg[2]) }) : t('serverInfo.loadNone')])
  const mem = f.memory || {}
  let memText = t('serverInfo.freeOf', { free: formatSize(mem.free || 0), total: formatSize(mem.total || 0) })
  if (typeof mem.cgroupLimit === 'number') memText += ' · ' + t('serverInfo.cgroup', { limit: formatSize(mem.cgroupLimit) })
  rows.push([t('serverInfo.memory'), memText])
  rows.push([t('serverInfo.disk'), f.disk ? t('serverInfo.freeOf', { free: formatSize(f.disk.free), total: formatSize(f.disk.total) }) : t('serverInfo.diskNone')])
  const data = f.data || {}
  rows.push([t('serverInfo.uploads'), t('serverInfo.usedOf', { used: formatSize(data.uploadsBytes || 0), total: formatSize(data.uploadQuotaBytes || 0) })])
  rows.push([t('serverInfo.messages'), t('serverInfo.usedOf', { used: formatNumber(data.messageCount || 0), total: formatNumber(data.maxTotalMessages || 0) })])
  const voiceInfo = f.voice || {}
  rows.push([t('serverInfo.online'), t('serverInfo.onlineValue', { online: formatNumber(f.online || 0), voice: formatNumber(voiceInfo.inVoice || 0), cameras: formatNumber(voiceInfo.cameras || 0) })])
  const turn = f.turn || {}
  rows.push([t('serverInfo.turn'), t(turn.local ? 'serverInfo.turnLocal' : turn.configured ? 'serverInfo.turnOn' : 'serverInfo.turnOff')])
  rows.push([t('serverInfo.runtime'), [String(f.node || ''), [f.platform, f.arch].filter(Boolean).join(' '), typeof f.uptime === 'number' ? t('serverInfo.uptime', { value: kapasiteUptime(f.uptime) }) : ''].filter(Boolean).join(' · ')])
  if (f.version) rows.push([t('serverInfo.version'), String(f.version)])
  return rows
}

// ------------------------------------------------------------------ ayarlar bölümü

// Ayarlar > Genel içindeki "Sunucu bilgileri" bölümü. onApply(capacity, maxCameras) önerilen değerleri ses
// odası ayarları formuna yazar (sahip ayrıca kaydeder). Dönüş: { update(owner) }
function buildServerInfoSection (page, onApply) {
  const sec = sSection(page, t('serverInfo.title'), 'set-server-info-section')
  sec.appendChild(sHint(t('serverInfo.intro'), 'set-server-info-intro'))
  const facts = h('dl', 'settings-facts')
  facts.id = 'set-server-facts'
  sec.appendChild(facts)
  const status = sMsg('set-server-info-msg')
  sec.appendChild(status)
  const refreshRow = sActions(sec)
  const refresh = sButton('button button-secondary', t('serverInfo.refresh'), 'set-server-info-refresh', null, 'i-signal')
  refreshRow.appendChild(refresh)

  sSub(sec, t('serverInfo.recTitle'), 'set-rec-title')
  const recBox = h('div', 'settings-rec')
  recBox.id = 'set-rec'
  recBox.setAttribute('aria-labelledby', 'set-rec-title')
  recBox.appendChild(sHint(t('serverInfo.recIntro'), 'set-rec-intro'))
  const uploadInput = sInput('number', 'settings-number')
  uploadInput.min = String(KAPASITE_UPLOAD_MIN_MBPS)
  uploadInput.max = String(KAPASITE_UPLOAD_MAX_MBPS)
  uploadInput.step = '0.5'
  uploadInput.inputMode = 'decimal'
  uploadInput.value = String(kapasiteStoredUpload())
  sField(recBox, 'set-rec-upload', t('serverInfo.uploadLabel'), uploadInput, t('serverInfo.uploadHint'))
  const measureRow = h('div', 'settings-rec-measure')
  measureRow.id = 'set-rec-measure'
  const measureText = h('p', 'hint settings-hint')
  measureText.id = 'set-rec-measure-text'
  measureRow.appendChild(measureText)
  const useMeasure = sButton('button button-small button-secondary', t('serverInfo.useMeasure'), 'set-rec-use-measure')
  measureRow.appendChild(useMeasure)
  recBox.appendChild(measureRow)
  const result = h('ul', 'plain-list settings-rec-result')
  result.id = 'set-rec-result'
  result.setAttribute('aria-live', 'polite')
  recBox.appendChild(result)
  const formula = sHint('', 'set-rec-formula')
  recBox.appendChild(formula)
  const hintsTitle = h('p', 'settings-rec-hints-title', t('serverInfo.hintsTitle'))
  hintsTitle.id = 'set-rec-hints-title'
  recBox.appendChild(hintsTitle)
  const hints = h('ul', 'plain-list settings-rec-hints')
  hints.id = 'set-rec-hints'
  hints.setAttribute('aria-labelledby', 'set-rec-hints-title')
  recBox.appendChild(hints)
  const applyRow = sActions(recBox)
  const apply = sButton('button', t('serverInfo.apply'), 'set-rec-apply')
  applyRow.appendChild(apply)
  const applyNote = sHint(t('serverInfo.applyNote'), 'set-rec-apply-note')
  recBox.appendChild(applyNote)
  const applyMsg = sMsg('set-rec-apply-msg')
  recBox.appendChild(applyMsg)
  sec.appendChild(recBox)

  let info = null
  let loading = false
  let owner = false

  const limits = () => {
    const l = state.info && state.info.limits ? state.info.limits : {}
    return kapasiteLimits({ capacityMin: l.voiceCapacityMin, capacityMax: l.voiceCapacityMax, camerasMin: l.maxCamerasMin, camerasMax: l.maxCamerasMax })
  }

  const renderFacts = () => {
    clear(facts)
    if (!info) return
    kapasiteFactRows(info).forEach((row) => {
      const item = h('div', 'settings-fact')
      item.appendChild(h('dt', 'settings-fact-label', row[0]))
      item.appendChild(h('dd', 'settings-fact-value', row[1]))
      facts.appendChild(item)
    })
  }

  const renderRec = () => {
    clear(result)
    clear(hints)
    const rec = kapasiteRecommend(uploadInput.value, limits())
    uploadInput.setAttribute('aria-invalid', rec ? 'false' : 'true')
    if (!rec) {
      result.appendChild(h('li', 'settings-rec-item is-error', t('serverInfo.uploadInvalid', { min: formatNumber(KAPASITE_UPLOAD_MIN_MBPS), max: formatNumber(KAPASITE_UPLOAD_MAX_MBPS) })))
      formula.textContent = ''
    } else {
      result.appendChild(h('li', 'settings-rec-item', t('serverInfo.recCapacity', { count: rec.capacity })))
      result.appendChild(h('li', 'settings-rec-item', t('serverInfo.recCameras', { count: rec.maxCameras })))
      if (rec.camerasTight) result.appendChild(h('li', 'settings-rec-item is-warn', t('serverInfo.recTight')))
      formula.textContent = t('serverInfo.recFormula', {
        upload: kapasiteMbps(rec.upload),
        usable: kapasiteMbps(rec.usableKbps / 1000),
        audio: formatNumber(KAPASITE_AUDIO_KBPS),
        camera: formatNumber(KAPASITE_CAMERA_KBPS),
        audioTotal: kapasiteMbps(rec.audioKbps / 1000),
        cameraTotal: kapasiteMbps(rec.cameraKbps / 1000),
        others: formatNumber(rec.capacity - 1),
        audioCapacity: formatNumber(rec.audioCapacity)
      })
    }
    if (info) {
      kapasiteHints(info).forEach((hint) => {
        hints.appendChild(h('li', 'settings-rec-hint is-' + hint.level, kapasiteHintText(hint)))
      })
    } else {
      hints.appendChild(h('li', 'settings-rec-hint is-info', t(loading ? 'serverInfo.loading' : 'serverInfo.noFacts')))
    }
    apply.disabled = !rec || !owner
    applyRow.hidden = !owner
    applyNote.hidden = !owner
    const m = kapasiteMeasure()
    measureRow.hidden = !m
    if (m) measureText.textContent = t('serverInfo.measured', { value: kapasiteMbps(m.kbps / 1000), date: formatShort(m.at) })
  }

  const load = async () => {
    if (loading) return
    loading = true
    refresh.disabled = true
    setMsg(status, () => t('serverInfo.loading'))
    renderRec()
    const res = await api('GET', '/api/server-info')
    loading = false
    refresh.disabled = false
    if (res.status === 200 && res.data && typeof res.data === 'object') {
      info = res.data
      setMsg(status, '')
    } else {
      setMsg(status, () => errorText(res, t('serverInfo.failed')), 'error')
    }
    renderFacts()
    renderRec()
  }

  refresh.addEventListener('click', () => {
    load()
  })
  uploadInput.addEventListener('input', () => {
    const n = kapasiteUpload(uploadInput.value)
    if (n !== null) storeSet(KAPASITE_UPLOAD_KEY, String(n))
    setMsg(applyMsg, '')
    renderRec()
  })
  useMeasure.addEventListener('click', () => {
    const m = kapasiteMeasure()
    if (!m) return
    const mbps = Math.round(m.kbps / 100) / 10
    uploadInput.value = String(kapasiteClamp(mbps, KAPASITE_UPLOAD_MIN_MBPS, KAPASITE_UPLOAD_MAX_MBPS))
    storeSet(KAPASITE_UPLOAD_KEY, uploadInput.value)
    renderRec()
    focusNode(uploadInput)
  })
  apply.addEventListener('click', () => {
    const rec = kapasiteRecommend(uploadInput.value, limits())
    if (!rec || !owner || typeof onApply !== 'function') return
    onApply(rec.capacity, rec.maxCameras)
    setMsg(applyMsg, () => t('serverInfo.applied', { capacity: rec.capacity, cameras: rec.maxCameras }), 'ok')
  })

  load()
  return {
    update: (isOwnerNow) => {
      owner = Boolean(isOwnerNow)
      renderRec()
    }
  }
}

kapasiteStartSampler()
