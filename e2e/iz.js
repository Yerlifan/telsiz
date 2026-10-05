'use strict'

// Geçici tanılama (TELSIZ_E2E_IZ=1). Firefox CI'da dosyanın ilk sayfasının gezinmesi zaman zaman 20 ila 30 saniye
// commit olmuyor. Bu dosya, ilk sayfa için sunucunun gördüğü bağlantıları ve istekleri, sayfanın Playwright
// olaylarını ve Playwright ile tarayıcı arasındaki protokol iletilerini zaman damgasıyla toplar. Sayfa
// GEC_MS içinde load olayına ulaşmazsa hepsi test çıktısına "# iz" satırları olarak yazılır, her durumda
// tek satırlık bir özet yazılır. Kanıt toplandıktan sonra bu dosya kaldırılır.

const { monitorEventLoopDelay } = require('node:perf_hooks')

const ACIK = process.env.TELSIZ_E2E_IZ === '1'
// debug.enable verilen değeri process.env.DEBUG içine yazar, özgün değer burada saklanır
const ESKI_DEBUG = process.env.DEBUG || ''
const GEC_MS = Number(process.env.TELSIZ_E2E_IZ_GEC_MS) || 5000
const SON_MS = 30000
const SATIR = 420
const SUNUCU_EN_FAZLA = 4000

const durum = {
  t0: 0,
  etiket: '',
  dosya: '',
  sayfa: null,
  olaylar: [],
  sunucu: [],
  yuklendi: 0,
  yazildi: false,
  sonYazim: 0,
  bitti: false,
  zamanlayicilar: [],
  gecikme: null,
  debug: null,
  eskiLog: null
}

function simdi () {
  return Date.now()
}

function kisalt (text) {
  const s = String(text).replace(/\s+/g, ' ')
  return s.length > SATIR ? s.slice(0, SATIR) + ' ...(' + s.length + ')' : s
}

function ekle (kaynak, text) {
  if (!durum.t0 || durum.bitti) return
  durum.olaylar.push({ t: simdi(), kaynak, text: kisalt(text) })
}

function sunucuEkle (text) {
  if (!ACIK) return
  durum.sunucu.push({ t: simdi(), kaynak: 'sunucu', text: kisalt(text) })
  if (durum.sunucu.length > SUNUCU_EN_FAZLA) durum.sunucu.shift()
}

// Sunucunun gördüğü TCP bağlantıları, istekler ve yanıtlar
function izleSunucu (server) {
  if (!ACIK) return
  let sayac = 0
  server.on('connection', (socket) => {
    sayac += 1
    const id = sayac
    socket.izId = id
    sunucuEkle('bağlantı #' + id + ' açıldı (uzak port ' + socket.remotePort + ')')
    socket.on('close', () => sunucuEkle('bağlantı #' + id + ' kapandı'))
  })
  server.on('request', (req, res) => {
    const id = req.socket && req.socket.izId
    const h = req.headers
    const ek = [
      h['sec-fetch-dest'] ? 'dest=' + h['sec-fetch-dest'] : '',
      h['sec-fetch-mode'] ? 'mode=' + h['sec-fetch-mode'] : '',
      h['cache-control'] ? 'cc=' + h['cache-control'] : '',
      h['service-worker'] ? 'sw=' + h['service-worker'] : ''
    ].filter(Boolean).join(' ')
    const bas = simdi()
    sunucuEkle('istek #' + id + ' :' + req.socket.localPort + ' ' + req.method + ' ' + req.url.split('#')[0].split('?')[0] + ' ' + ek)
    res.on('finish', () => sunucuEkle('yanıt #' + id + ' ' + req.method + ' ' + req.url.split('?')[0] + ' ' + res.statusCode + ' (' + (simdi() - bas) + ' ms)'))
    res.on('close', () => {
      if (!res.writableFinished) sunucuEkle('yanıt #' + id + ' ' + req.url.split('?')[0] + ' bitmeden kapandı')
    })
  })
}

function protokolAc () {
  let debug = null
  try {
    debug = require('playwright-core/lib/utilsBundle').debug
  } catch (err) {
    ekle('iz', 'protokol günlüğü açılamadı: ' + err.message)
    return
  }
  durum.debug = debug
  durum.eskiLog = debug.log
  debug.log = (...args) => {
    const text = args.join(' ')
    if (text.indexOf('pw:protocol') !== -1 || text.indexOf('pw:browser') !== -1) {
      ekle('protokol', text.replace(/^\S+Z /, '').replace('pw:protocol ', '').replace('pw:browser ', 'tarayıcı: '))
    } else {
      process.stderr.write(text + '\n')
    }
  }
  debug.enable([ESKI_DEBUG, 'pw:protocol', 'pw:browser'].filter(Boolean).join(','))
}

function protokolKapat () {
  const debug = durum.debug
  if (!debug) return
  debug.enable(ESKI_DEBUG)
  debug.log = durum.eskiLog
  durum.debug = null
}

function sure (t) {
  return String(t - durum.t0).padStart(6)
}

async function yokla (page) {
  const zaman = (ms) => new Promise((resolve) => setTimeout(() => resolve('zaman aşımı'), ms))
  const sonuc = {}
  sonuc.evaluate = await Promise.race([
    page.evaluate(() => ({
      url: location.href,
      readyState: document.readyState,
      title: document.title,
      sw: navigator.serviceWorker ? (navigator.serviceWorker.controller ? 'denetliyor' : 'denetlemiyor') : 'yok',
      kaynak: performance.getEntriesByType('resource').length
    })).catch((e) => 'hata: ' + e.message.split('\n')[0]),
    zaman(3000)
  ])
  sonuc.ekranGoruntusu = await Promise.race([
    page.screenshot({ timeout: 3000 }).then((b) => b.length + ' bayt').catch((e) => 'hata: ' + e.message.split('\n')[0]),
    zaman(4000)
  ])
  return sonuc
}

function ozet (neden) {
  const g = durum.gecikme
  const dongu = g ? 'olay döngüsü gecikmesi en çok ' + Math.round(g.max / 1e6) + ' ms, ortalama ' + Math.round(g.mean / 1e6) + ' ms' : ''
  const ilk = (kaynak, re) => {
    const o = durum.olaylar.concat(durum.sunucu).find((x) => x.t >= durum.t0 && x.kaynak === kaynak && re.test(x.text))
    return o ? (o.t - durum.t0) + ' ms' : 'yok'
  }
  return 'iz özet (' + durum.dosya + ', ' + durum.etiket + ', ' + neden + ', service worker ' + (process.env.TELSIZ_E2E_SW || 'allow') + '): ' + [
    'gezinme isteği ' + ilk('sayfa', /^request nav /),
    'sunucuda GET / ' + ilk('sunucu', /^istek #\d+ :\d+ GET \/ /),
    'yanıt ' + ilk('sayfa', /^response nav /),
    'commit ' + ilk('sayfa', /^framenavigated ana /),
    'domcontentloaded ' + ilk('sayfa', /^domcontentloaded/),
    'load ' + (durum.yuklendi ? (durum.yuklendi - durum.t0) + ' ms' : 'yok'),
    dongu
  ].join(', ')
}

// Sonraki yazımlar yalnızca önceki yazımdan sonra gelen satırları içerir
async function yaz (neden) {
  const alt = durum.sonYazim || durum.t0 - 1000
  durum.sonYazim = simdi()
  const satirlar = durum.olaylar.concat(durum.sunucu).filter((x) => x.t >= alt && x.t < durum.sonYazim)
  satirlar.sort((a, b) => a.t - b.t)
  let yoklama = { sayfa: 'henüz yok' }
  if (durum.sayfa) yoklama = durum.sayfa.isClosed() ? { sayfa: 'kapalı' } : await yokla(durum.sayfa)
  const cikti = ['iz başlangıç (' + durum.dosya + ', ' + durum.etiket + ', ' + neden + ', ' + satirlar.length + ' satır)']
  for (const s of satirlar) cikti.push('iz ' + sure(s.t) + ' ' + s.kaynak + ': ' + s.text)
  cikti.push('iz yoklama: ' + kisalt(JSON.stringify(yoklama)))
  cikti.push(ozet(neden))
  cikti.push('iz bitiş (' + durum.dosya + ')')
  console.log(cikti.join('\n'))
}

function bitir () {
  if (durum.bitti) return
  durum.bitti = true
  protokolKapat()
  for (const z of durum.zamanlayicilar) clearTimeout(z)
  if (durum.gecikme) durum.gecikme.disable()
}

// İlk sayfa açılmadan hemen önce çağrılır
function basla (dosya, etiket) {
  if (!ACIK || durum.t0) return
  durum.t0 = simdi()
  durum.dosya = dosya
  durum.etiket = etiket
  durum.gecikme = monitorEventLoopDelay({ resolution: 10 })
  durum.gecikme.enable()
  protokolAc()
  ekle('iz', 'ilk sayfa açılıyor')
  durum.zamanlayicilar.push(setTimeout(() => {
    if (durum.yuklendi || durum.yazildi) return
    durum.yazildi = true
    yaz(GEC_MS + ' ms içinde load yok').catch(() => {})
  }, GEC_MS))
  durum.zamanlayicilar.push(setTimeout(() => {
    if (durum.yuklendi) return
    yaz(SON_MS + ' ms içinde load yok').catch(() => {}).then(bitir)
  }, SON_MS))
}

// İlk sayfanın Playwright olayları
function izleSayfa (page) {
  if (!ACIK || durum.sayfa || durum.bitti) return
  durum.sayfa = page
  const tur = (r) => (r.isNavigationRequest() ? 'nav ' : '') + r.method() + ' ' + r.url().split('#')[0]
  page.on('request', (r) => ekle('sayfa', 'request ' + tur(r) + ' (' + r.resourceType() + ')'))
  page.on('response', (r) => ekle('sayfa', 'response ' + tur(r.request()) + ' ' + r.status() + (r.fromServiceWorker() ? ' (service worker)' : '')))
  page.on('requestfinished', (r) => ekle('sayfa', 'requestfinished ' + tur(r)))
  page.on('requestfailed', (r) => ekle('sayfa', 'requestfailed ' + tur(r) + ' ' + (r.failure() ? r.failure().errorText : '')))
  page.on('framenavigated', (f) => ekle('sayfa', 'framenavigated ' + (f === page.mainFrame() ? 'ana ' : 'alt ') + f.url().split('#')[0]))
  page.on('domcontentloaded', () => ekle('sayfa', 'domcontentloaded'))
  page.on('console', (m) => ekle('sayfa', 'console ' + m.type() + ' ' + m.text()))
  page.on('pageerror', (e) => ekle('sayfa', 'pageerror ' + e.message))
  page.on('crash', () => ekle('sayfa', 'crash'))
  page.on('close', () => ekle('sayfa', 'close'))
  page.on('worker', (w) => ekle('sayfa', 'worker ' + w.url()))
  page.on('load', () => {
    ekle('sayfa', 'load')
    if (durum.yuklendi) return
    durum.yuklendi = simdi()
    const gec = durum.yuklendi - durum.t0 > GEC_MS
    const is = gec ? yaz('load ' + (durum.yuklendi - durum.t0) + ' ms sonra geldi') : Promise.resolve(console.log(ozet('normal')))
    is.catch(() => {}).then(bitir)
  })
}

// Tarayıcı kapanmadan önce: ilk sayfa hiç yüklenmediyse son durum yazılır
async function kapanis () {
  if (!ACIK || !durum.t0 || durum.bitti) return
  if (!durum.yuklendi) await yaz('tarayıcı kapanıyor, load yok').catch(() => {})
  bitir()
}

module.exports = { ACIK, basla, izleSayfa, izleSunucu, kapanis }
