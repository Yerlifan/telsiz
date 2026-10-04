'use strict'

// Masaüstü uygulamasının güncelleme denetimi. Electron'a bağımlı değildir, Electron nesneleri
// (electron-updater, oturumun fetch işlevi, zamanlayıcılar) src/main.js tarafından verilir.
//
// İki kip vardır:
// - auto: Windows NSIS kurucusuyla kurulmuş uygulama ve Linux AppImage. electron-updater GitHub
//   sürümündeki latest.yml (Windows) veya latest-linux.yml (AppImage) dosyasını okur, yeni sürümü
//   arka planda indirir ve dosyanın sha512 değerini bu dosyadaki değerle doğrular. Kurulum yalnızca
//   kullanıcı "Yeniden başlat ve güncelle" dediğinde yapılır, çıkışta kendiliğinden kurulmaz.
// - notify: taşınabilir exe, .deb paketi ve diğer durumlar. GitHub API'sinden son sürüm okunur,
//   daha yeni bir kararlı sürüm varsa kullanıcıya sürüm sayfasını açan bir düğme gösterilir.
//   Hiçbir dosya indirilmez veya çalıştırılmaz.
// Ayarlarda "Güncellemeleri otomatik denetle" kapalıyken GitHub'a hiçbir istek gönderilmez,
// electron-updater modülü de yüklenmez.

const OWNER = 'Yerlifan'
const REPO = 'telsiz'
const RELEASES_API = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/releases/latest'
const RELEASE_PAGE_PREFIX = 'https://github.com/' + OWNER + '/' + REPO + '/releases/'
const PUBLISH_CONFIG = Object.freeze({ provider: 'github', owner: OWNER, repo: REPO, releaseType: 'release' })

const STARTUP_DELAY_MS = 30 * 1000
const INTERVAL_MS = 6 * 60 * 60 * 1000
const FETCH_TIMEOUT_MS = 15 * 1000
const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_URL_LENGTH = 300

const STATUSES = Object.freeze(['idle', 'checking', 'up-to-date', 'available', 'downloading', 'downloaded', 'error'])
const ERROR_CODES = Object.freeze(['network', 'timeout', 'rate_limited', 'not_found', 'http', 'invalid', 'failed'])

// Anlamsal sürüm (ör. 2.0.1, v2.1.0-beta.1). Derleme üst verisi (+...) kabul edilmez.
const VERSION_RE = /^v?(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})(?:-([0-9A-Za-z-]{1,20}(?:\.[0-9A-Za-z-]{1,20}){0,4}))?$/

function parseVersion (value) {
  if (typeof value !== 'string') return null
  const match = VERSION_RE.exec(value)
  if (!match) return null
  const pre = match[4] ? match[4].split('.') : []
  // Sayısal ön sürüm kimliklerinde baştaki sıfır geçersizdir (semver 2.0.0, madde 9)
  if (pre.some((id) => /^\d+$/.test(id) && id.length > 1 && id[0] === '0')) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), pre, text: match[0].replace(/^v/, '') }
}

function compareIdentifiers (a, b) {
  const aNum = /^\d+$/.test(a)
  const bNum = /^\d+$/.test(b)
  if (aNum && bNum) return Math.sign(Number(a) - Number(b))
  if (aNum) return -1
  if (bNum) return 1
  if (a === b) return 0
  return a < b ? -1 : 1
}

// a < b ise -1, eşitse 0, a > b ise 1. Geçersiz sürüm için null.
function compareVersions (a, b) {
  const x = typeof a === 'string' ? parseVersion(a) : a
  const y = typeof b === 'string' ? parseVersion(b) : b
  if (!x || !y) return null
  for (const key of ['major', 'minor', 'patch']) {
    if (x[key] !== y[key]) return x[key] < y[key] ? -1 : 1
  }
  // Ön sürüm, aynı numaralı kararlı sürümden önce gelir
  if (x.pre.length === 0 || y.pre.length === 0) return Math.sign(y.pre.length - x.pre.length)
  const length = Math.min(x.pre.length, y.pre.length)
  for (const i of Array.from({ length }, (_, index) => index)) {
    const order = compareIdentifiers(x.pre[i], y.pre[i])
    if (order !== 0) return order
  }
  return Math.sign(x.pre.length - y.pre.length)
}

function isNewer (candidate, current) {
  return compareVersions(candidate, current) === 1
}

// Yalnızca bu projenin GitHub sürüm sayfaları dış tarayıcıda açılabilir
function isReleasePageUrl (value) {
  if (typeof value !== 'string' || value.length > MAX_URL_LENGTH || !value.startsWith(RELEASE_PAGE_PREFIX)) return false
  let url
  try {
    url = new URL(value)
  } catch (err) {
    return false
  }
  if (url.protocol !== 'https:' || url.host !== 'github.com' || url.username !== '' || url.password !== '') return false
  if (url.search !== '' || url.hash !== '') return false
  const rest = url.pathname.slice(('/' + OWNER + '/' + REPO + '/releases/').length)
  return url.pathname.startsWith('/' + OWNER + '/' + REPO + '/releases/') && /^(latest|tag\/[0-9A-Za-z.-]{1,64})$/.test(rest)
}

function releasePageFor (version) {
  return RELEASE_PAGE_PREFIX + 'tag/v' + version
}

// Çalışma biçimi: Windows'ta NSIS kurulumu veya taşınabilir exe, Linux'ta AppImage veya .deb.
// electron-builder taşınabilir exe'de PORTABLE_EXECUTABLE_DIR, AppImage çalışırken APPIMAGE
// ortam değişkenini tanımlar. Sonuç: { mode: 'auto' | 'notify', kind }
function detectMode (options) {
  const opts = options || {}
  const env = opts.env || {}
  const has = (name) => typeof env[name] === 'string' && env[name] !== ''
  if (opts.isPackaged !== true) return { mode: 'notify', kind: 'dev' }
  if (opts.platform === 'win32') return has('PORTABLE_EXECUTABLE_DIR') ? { mode: 'notify', kind: 'portable' } : { mode: 'auto', kind: 'nsis' }
  if (opts.platform === 'linux') return has('APPIMAGE') ? { mode: 'auto', kind: 'appimage' } : { mode: 'notify', kind: 'deb' }
  return { mode: 'notify', kind: 'other' }
}

// GitHub API'sinin releases/latest yanıtını doğrular.
// Sonuç: { ok: true, version, url, newer } veya { ok: false, code }
function parseRelease (data, current) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, code: 'invalid' }
  if (data.draft !== false || data.prerelease !== false) return { ok: false, code: 'invalid' }
  const parsed = parseVersion(data.tag_name)
  // Yalnızca kararlı sürümler bildirilir
  if (!parsed || parsed.pre.length > 0) return { ok: false, code: 'invalid' }
  const url = isReleasePageUrl(data.html_url) ? data.html_url : releasePageFor(parsed.text)
  return { ok: true, version: parsed.text, url, newer: isNewer(parsed, current) }
}

function fetchErrorCode (err) {
  if (err && (err.name === 'AbortError' || err.name === 'TimeoutError')) return 'timeout'
  return 'network'
}

// Hafif denetim (notify kipi). fetchFn: Electron oturumunun fetch işlevi.
async function checkLatestRelease (fetchFn, current, options) {
  const opts = options || {}
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs || FETCH_TIMEOUT_MS)
  try {
    let response
    try {
      response = await fetchFn(RELEASES_API, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Telsiz/' + (parseVersion(current) ? current : '0.0.0')
        },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal
      })
    } catch (err) {
      return { ok: false, code: fetchErrorCode(err) }
    }
    if (response.status === 404) return { ok: false, code: 'not_found' }
    if (response.status === 403 || response.status === 429) return { ok: false, code: 'rate_limited' }
    if (!response.ok) return { ok: false, code: 'http' }
    const declared = Number(response.headers && typeof response.headers.get === 'function' ? response.headers.get('content-length') : NaN)
    if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) return { ok: false, code: 'invalid' }
    let text
    try {
      text = await response.text()
    } catch (err) {
      return { ok: false, code: fetchErrorCode(err) }
    }
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_RESPONSE_BYTES) return { ok: false, code: 'invalid' }
    let data
    try {
      data = JSON.parse(text)
    } catch (err) {
      return { ok: false, code: 'invalid' }
    }
    return parseRelease(data, current)
  } finally {
    clearTimeout(timer)
  }
}

function errorCodeOf (err) {
  const message = err && err.message ? String(err.message) : ''
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK|net::/i.test(message)) return 'network'
  if (/\b(403|429)\b|rate limit/i.test(message)) return 'rate_limited'
  if (/\b404\b/.test(message)) return 'not_found'
  return 'failed'
}

// Durum makinesi. Seçenekler:
//   mode: detectMode sonucu, current: uygulama sürümü
//   getEnabled(): ayar açık mı, saveEnabled(value): ayarı kaydeder
//   fetch(url, init): notify kipinin isteği, loadUpdater(): electron-updater autoUpdater nesnesi
//   onChange(snapshot, statusChanged): durum değişince (sayfaya ve menülere bildirmek için)
//   beforeInstall(): kurulumdan hemen önce (çıkış hazırlığı), log(label, err), now()
//   timers: { setTimeout, clearTimeout, setInterval, clearInterval }, schedule: zamanlanmış denetim
//   yapılsın mı (gözetimsiz çalıştırmada false), startupDelayMs, intervalMs
function createController (options) {
  const opts = options || {}
  const mode = opts.mode && opts.mode.mode === 'auto' ? 'auto' : 'notify'
  const kind = opts.mode && typeof opts.mode.kind === 'string' ? opts.mode.kind : 'other'
  const current = parseVersion(opts.current) ? parseVersion(opts.current).text : '0.0.0'
  const timers = opts.timers || { setTimeout, clearTimeout, setInterval, clearInterval }
  const now = opts.now || (() => Date.now())
  const log = opts.log || (() => {})
  const onChange = opts.onChange || (() => {})
  const startupDelayMs = typeof opts.startupDelayMs === 'number' ? opts.startupDelayMs : STARTUP_DELAY_MS
  const intervalMs = typeof opts.intervalMs === 'number' ? opts.intervalMs : INTERVAL_MS
  const schedule = opts.schedule !== false

  const state = { status: 'idle', version: null, url: null, percent: null, lastCheckAt: null, error: null }
  let updater = null
  let cancelToken = null
  let startTimer = null
  let intervalTimer = null
  let running = null
  let started = false

  function enabled () {
    return opts.getEnabled() === true
  }

  function snapshot () {
    return {
      enabled: enabled(),
      mode,
      kind,
      current,
      status: state.status,
      version: state.version,
      url: state.url,
      percent: state.percent,
      lastCheckAt: state.lastCheckAt,
      error: state.error,
      canInstall: mode === 'auto' && state.status === 'downloaded'
    }
  }

  function set (patch) {
    const before = state.status
    Object.assign(state, patch)
    try {
      onChange(snapshot(), before !== state.status)
    } catch (err) {
      log('updates onChange', err)
    }
  }

  function finishCheck (patch) {
    set(Object.assign({ lastCheckAt: now() }, patch))
  }

  function attachUpdater (instance) {
    instance.autoDownload = true
    instance.autoInstallOnAppQuit = false
    instance.allowPrerelease = false
    instance.allowDowngrade = false
    instance.fullChangelog = false
    instance.logger = {
      info () {},
      warn () {},
      debug () {},
      error (message) {
        log('electron-updater', message instanceof Error ? message : new Error(String(message)))
      }
    }
    instance.on('update-available', (info) => {
      const parsed = parseVersion(info && info.version)
      if (!parsed) return
      set({ status: 'downloading', version: parsed.text, url: releasePageFor(parsed.text), percent: 0, error: null })
    })
    instance.on('update-not-available', () => {
      if (state.status !== 'downloaded') finishCheck({ status: 'up-to-date', percent: null, error: null })
    })
    instance.on('download-progress', (progress) => {
      if (state.status !== 'downloading') return
      const percent = progress && Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, Math.floor(progress.percent))) : null
      if (percent !== null && percent !== state.percent) set({ percent })
    })
    instance.on('update-downloaded', (info) => {
      const parsed = parseVersion(info && info.version)
      cancelToken = null
      const version = parsed ? parsed.text : state.version
      finishCheck({ status: 'downloaded', version, url: version ? releasePageFor(version) : null, percent: 100, error: null })
    })
    instance.on('error', (err) => {
      cancelToken = null
      if (state.status === 'downloaded') return
      finishCheck({ status: 'error', percent: null, error: errorCodeOf(err) })
    })
  }

  function getUpdater () {
    if (!updater) {
      updater = opts.loadUpdater()
      attachUpdater(updater)
    }
    return updater
  }

  async function runAuto () {
    const instance = getUpdater()
    const result = await instance.checkForUpdates()
    if (result && result.cancellationToken) cancelToken = result.cancellationToken
    // Güncelleyici etkin değilse (ör. kurulum bilgisi yok) sonuç null döner, olay da gelmez
    if (!result && state.status === 'checking') finishCheck({ status: 'error', error: 'failed' })
    else if (state.status === 'checking') finishCheck({ status: 'up-to-date', error: null })
  }

  async function runNotify () {
    const result = await checkLatestRelease(opts.fetch, current, { timeoutMs: opts.timeoutMs })
    if (!result.ok) {
      finishCheck({ status: 'error', error: result.code })
      return
    }
    if (result.newer) finishCheck({ status: 'available', version: result.version, url: result.url, error: null })
    else finishCheck({ status: 'up-to-date', version: null, url: null, error: null })
  }

  // Denetimi başlatır. Ayar kapalıyken, indirme sürerken veya indirme bitmişken hiçbir istek yapılmaz.
  function check () {
    if (!enabled()) return Promise.resolve({ ok: false, code: 'disabled' })
    if (running) return running
    if (state.status === 'downloading' || state.status === 'downloaded') return Promise.resolve({ ok: true, state: snapshot() })
    set({ status: 'checking', error: null })
    running = (mode === 'auto' ? runAuto() : runNotify()).catch((err) => {
      log('updates', err)
      if (state.status === 'checking' || state.status === 'downloading') finishCheck({ status: 'error', percent: null, error: errorCodeOf(err) })
    }).then(() => {
      running = null
      return { ok: state.status !== 'error', code: state.error || undefined, state: snapshot() }
    })
    return running
  }

  function clearTimers () {
    if (startTimer) timers.clearTimeout(startTimer)
    if (intervalTimer) timers.clearInterval(intervalTimer)
    startTimer = null
    intervalTimer = null
  }

  function arm () {
    clearTimers()
    if (!started || !schedule || !enabled()) return
    startTimer = timers.setTimeout(() => {
      startTimer = null
      check()
    }, startupDelayMs)
    intervalTimer = timers.setInterval(() => check(), intervalMs)
  }

  function start () {
    started = true
    arm()
  }

  function stop () {
    started = false
    clearTimers()
  }

  // IPC: ayarı açar veya kapatır. Kapatınca zamanlayıcılar durur ve süren indirme iptal edilir.
  function setEnabled (value) {
    if (typeof value !== 'boolean') return { ok: false, code: 'invalid' }
    opts.saveEnabled(value)
    if (!value) {
      if (cancelToken && state.status === 'downloading') {
        try {
          cancelToken.cancel()
        } catch (err) {
          log('updates cancel', err)
        }
        cancelToken = null
        set({ status: 'idle', percent: null, version: null, url: null })
      } else if (state.status !== 'downloaded') {
        set({ status: 'idle', error: null })
      } else {
        set({})
      }
    } else {
      set({})
    }
    arm()
    return { ok: true, state: snapshot() }
  }

  // IPC: "Şimdi denetle"
  function checkNow () {
    return check()
  }

  // IPC: "Yeniden başlat ve güncelle". Yalnızca indirilmiş ve doğrulanmış bir güncelleme varken.
  function install () {
    if (mode !== 'auto' || state.status !== 'downloaded' || !updater) return { ok: false, code: 'not_ready' }
    try {
      if (opts.beforeInstall) opts.beforeInstall()
      // Sessiz kurulum (kurulum klasörü korunur) ve ardından uygulama yeniden açılır
      updater.quitAndInstall(true, true)
    } catch (err) {
      log('updates install', err)
      return { ok: false, code: 'failed' }
    }
    return { ok: true }
  }

  // Dış tarayıcıda açılacak sürüm sayfası (yalnızca doğrulanmış adres)
  function releaseUrl () {
    return state.url && isReleasePageUrl(state.url) ? state.url : null
  }

  return { start, stop, snapshot, check, checkNow, setEnabled, install, releaseUrl }
}

module.exports = {
  OWNER,
  REPO,
  RELEASES_API,
  RELEASE_PAGE_PREFIX,
  PUBLISH_CONFIG,
  STARTUP_DELAY_MS,
  INTERVAL_MS,
  FETCH_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  STATUSES,
  ERROR_CODES,
  parseVersion,
  compareVersions,
  isNewer,
  isReleasePageUrl,
  releasePageFor,
  detectMode,
  parseRelease,
  checkLatestRelease,
  createController
}
