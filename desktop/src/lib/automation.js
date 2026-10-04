'use strict'

// Playwright ile otomasyon (duman testi) için açılış kapısı.
// Playwright paketlenmiş uygulamayı executablePath ile açtığında kendi yükleyicisini eklemez. Önce
// ana sürecin Node.js denetleyicisine (--inspect), sonra Chromium'a (--remote-debugging-port)
// bağlanır, var olan sayfalara bağlanıp her birinin ilk gezinmesini (Page.frameNavigated) bekler
// ve en son ana süreçte __playwright_run() ifadesini çalıştırır. Bağlanma sayfanın ilk gezinmesinin
// ortasına denk gelirse (Windows'ta yeni oluşturucu sürecinin geç açılması yüzünden) gezinme olayı
// Playwright'a hiç ulaşmaz ve başlatma sonsuza dek bekler.
// Kapı açıkken uygulama ilk pencereyi __playwright_run() çağrılana kadar açmaz. Bu çağrı
// Playwright'ın tarayıcıya bağlanıp otomatik bağlanmayı (Target.setAutoAttach,
// waitForDebuggerOnStart) kurmasından sonra gelir, böylece bütün pencereler bağlanmadan sonra
// oluşturulur, Playwright'ın denetimi altında duraklatılmış başlar ve hiçbir gezinme olayı kaçmaz.
// Playwright'ın kendi yükleyicisi (playwright-core/lib/server/electron/loader.js) de ready olayını
// aynı çağrıya kadar bekletir.
// Kapı yalnızca TELSIZ_PLAYWRIGHT=1 verildiğinde ve Node.js denetleyicisi gerçekten açıkken
// (inspector.url()) etkindir. Kullanıcının uygulamayı açışında hiçbir şey değişmez. Çağrı hiç
// gelmezse uygulama süre dolunca yine de açılır. Electron'a bağımlı değildir.

const ENV_NAME = 'TELSIZ_PLAYWRIGHT'
const GLOBAL_NAME = '__playwright_run'
const WAIT_MS = 30000

// options: { env, inspectorUrl(), target (global nesne), setTimer, clearTimer, waitMs }
// Sonuç: Promise<'off' | 'no-inspector' | 'connected' | 'timeout'>
function waitForAutomation (options) {
  const env = options.env || {}
  if (env[ENV_NAME] !== '1') return Promise.resolve('off')
  let url
  try {
    url = options.inspectorUrl()
  } catch (err) {
    url = undefined
  }
  if (typeof url !== 'string' || url === '') return Promise.resolve('no-inspector')
  const target = options.target
  const setTimer = options.setTimer || setTimeout
  const clearTimer = options.clearTimer || clearTimeout
  return new Promise((resolve) => {
    let done = false
    const finish = (result) => {
      if (done) return
      done = true
      clearTimer(timer)
      if (target[GLOBAL_NAME] === run) delete target[GLOBAL_NAME]
      resolve(result)
    }
    const run = () => {
      finish('connected')
    }
    const timer = setTimer(() => finish('timeout'), options.waitMs || WAIT_MS)
    target[GLOBAL_NAME] = run
  })
}

module.exports = { ENV_NAME, GLOBAL_NAME, WAIT_MS, waitForAutomation }
