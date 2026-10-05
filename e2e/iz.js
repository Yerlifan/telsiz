'use strict'

// Geçici tanılama (TELSIZ_E2E_IZ=1). Firefox CI'da yeni bir bağlamın ilk gezinmesi zaman zaman 20 ila 30 saniye
// commit olmuyor (08-tanitim ilk sayfa, 09-frekans-foto ve 11-roller üçüncü sayfa). Bu dosya sunucunun gördüğü
// bağlantıları ve istekleri, sayfaların Playwright olaylarını ve Playwright ile tarayıcı arasındaki protokol
// iletilerini tek bir zaman çizgisinde (son KAYIT_MS) tutar. Bir sayfa açıldıktan sonra GEC_MS içinde load
// olayına ulaşmazsa o aralıktaki bütün satırlar test çıktısına "iz" satırları olarak yazılır, her sayfa için
// tek satırlık bir özet yazılır. Kanıt toplandıktan sonra bu dosya kaldırılır.

const { monitorEventLoopDelay } = require('node:perf_hooks')

const ACIK = process.env.TELSIZ_E2E_IZ === '1'
const GEC_MS = Number(process.env.TELSIZ_E2E_IZ_GEC_MS) || 5000
const SON_MS = 30000
const KAYIT_MS = 120000
const SATIR = 420
// debug.enable verilen değeri process.env.DEBUG içine yazar, özgün değer burada saklanır
const ESKI_DEBUG = process.env.DEBUG || ''

const kayit = []
const sayfalar = []
let dosya = ''
let gecikme = null

function simdi () {
  return Date.now()
}

function kisalt (text) {
  const s = String(text).replace(/\s+/g, ' ')
  return s.length > SATIR ? s.slice(0, SATIR) + ' ...(' + s.length + ')' : s
}

function ekle (kaynak, text) {
  const t = simdi()
  kayit.push({ t, kaynak, text: kisalt(text) })
  if (kayit.length % 500 === 0) {
    let i = 0
    while (i < kayit.length && kayit[i].t < t - KAYIT_MS) i += 1
    if (i > 0) kayit.splice(0, i)
  }
}

// Protokol iletileri çalıştırma boyunca toplanır (Playwright'ın debug modülü üzerinden)
function protokolAc () {
  let debug = null
  try {
    debug = require('playwright-core/lib/utilsBundle').debug
  } catch (err) {
    ekle('iz', 'protokol günlüğü açılamadı: ' + err.message)
    return
  }
  debug.log = (...args) => {
    const text = args.join(' ')
    if (text.indexOf('pw:protocol') !== -1 || text.indexOf('pw:browser') !== -1) {
      const satir = text.replace(/^\S+Z /, '').replace('pw:protocol ', '').replace('pw:browser ', 'tarayıcı: ')
      ekle('protokol', satir)
      // Juggler hataları her zaman, o anda açılmakta olan sayfa etiketiyle yazılır (takılmayla ilişkiyi görmek için)
      if (satir.indexOf('tarayıcı: ') === 0 && /juggler/i.test(satir)) {
        const son = sayfalar.length ? sayfalar[sayfalar.length - 1] : null
        console.log('iz juggler hatası (' + dosya + ', son açılan sayfa ' + (son ? son.etiket + ', açılıştan ' + (simdi() - son.t0) + ' ms sonra' : 'yok') + '): ' + kisalt(satir))
      }
    } else {
      process.stderr.write(text + '\n')
    }
  }
  debug.enable([ESKI_DEBUG, 'pw:protocol', 'pw:browser'].filter(Boolean).join(','))
}

if (ACIK) {
  dosya = require.main && require.main.filename ? require.main.filename.split(/[\\/]/).pop() : ''
  gecikme = monitorEventLoopDelay({ resolution: 10 })
  gecikme.enable()
  protokolAc()
}

// Sunucunun gördüğü TCP bağlantıları, istekler ve yanıtlar
function izleSunucu (server) {
  if (!ACIK) return
  let sayac = 0
  server.on('connection', (socket) => {
    sayac += 1
    const id = sayac
    socket.izId = id
    ekle('sunucu', 'bağlantı #' + id + ' :' + socket.localPort + ' açıldı (uzak port ' + socket.remotePort + ')')
    socket.on('close', () => ekle('sunucu', 'bağlantı #' + id + ' :' + socket.localPort + ' kapandı'))
  })
  server.on('request', (req, res) => {
    const id = req.socket && req.socket.izId
    const port = req.socket && req.socket.localPort
    const h = req.headers
    const ek = [
      h['sec-fetch-dest'] ? 'dest=' + h['sec-fetch-dest'] : '',
      h['sec-fetch-mode'] ? 'mode=' + h['sec-fetch-mode'] : '',
      h['cache-control'] ? 'cc=' + h['cache-control'] : '',
      h['service-worker'] ? 'sw=' + h['service-worker'] : ''
    ].filter(Boolean).join(' ')
    const yol = req.url.split('?')[0]
    const bas = simdi()
    ekle('sunucu', 'istek #' + id + ' :' + port + ' ' + req.method + ' ' + yol + ' ' + ek)
    res.on('finish', () => ekle('sunucu', 'yanıt #' + id + ' :' + port + ' ' + req.method + ' ' + yol + ' ' + res.statusCode + ' (' + (simdi() - bas) + ' ms)'))
    res.on('close', () => {
      if (!res.writableFinished) ekle('sunucu', 'yanıt #' + id + ' :' + port + ' ' + yol + ' bitmeden kapandı')
    })
  })
}

function sure (st, t) {
  return String(t - st.t0).padStart(6)
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

// Sayfanın Juggler oturumu (açılıştan sonraki ilk Browser.attachedToTarget) ve bu oturumun protokol olayları
function protokolOzet (st) {
  const bitis = st.yuklendi || simdi()
  const pencere = kayit.filter((x) => x.kaynak === 'protokol' && x.t >= st.t0 && x.t <= bitis)
  const bag = pencere.find((x) => x.text.indexOf('"Browser.attachedToTarget"') !== -1)
  const m = bag ? /"sessionId":"([^"]+)"/.exec(bag.text) : null
  if (!m) return 'oturum yok'
  const oturum = pencere.filter((x) => x.text.indexOf(m[1]) !== -1)
  const say = (re) => oturum.filter((x) => re.test(x.text)).length
  const juggler = pencere.filter((x) => x.text.indexOf('tarayıcı: ') === 0 && /juggler/i.test(x.text)).length
  return 'frameAttached ' + say(/"method":"Page\.frameAttached"/) +
    ', http commit ' + say(/"method":"Page\.navigationCommitted".*"url":"http/) +
    ', sameDocumentNavigation ' + say(/"method":"Page\.sameDocumentNavigation"/) +
    ', juggler hatası ' + juggler
}

function ozet (st, neden) {
  const dongu = gecikme ? 'olay döngüsü gecikmesi (dosya başından) en çok ' + Math.round(gecikme.max / 1e6) + ' ms' : ''
  const ilk = (re) => {
    const o = st.olaylar.find((x) => re.test(x))
    return o ? o.split(' ')[0] + ' ms' : 'yok'
  }
  return 'iz özet (' + dosya + ', ' + st.etiket + ', ' + neden + ', service worker ' + (process.env.TELSIZ_E2E_SW || 'allow') + '): ' + [
    'goto ' + ilk(/ goto /),
    'gezinme isteği ' + ilk(/ request nav /),
    'yanıt ' + ilk(/ response nav /),
    'commit ' + ilk(/ framenavigated ana /),
    'domcontentloaded ' + ilk(/ domcontentloaded/),
    'load ' + (st.yuklendi ? (st.yuklendi - st.t0) + ' ms' : 'yok'),
    'açık sayfa ' + sayfalar.filter((x) => x.sayfa && !x.sayfa.isClosed()).length,
    protokolOzet(st),
    'fission ' + (process.env.TELSIZ_E2E_FISSION === '0' ? 'kapalı' : 'varsayılan'),
    dongu
  ].join(', ')
}

// Sonraki yazımlar yalnızca önceki yazımdan sonra gelen satırları içerir
async function yaz (st, neden) {
  const alt = st.sonYazim || st.t0 - 1000
  st.sonYazim = simdi()
  const satirlar = kayit.filter((x) => x.t >= alt && x.t < st.sonYazim)
  let yoklama = { sayfa: 'henüz yok' }
  if (st.sayfa) yoklama = st.sayfa.isClosed() ? { sayfa: 'kapalı' } : await yokla(st.sayfa)
  const cikti = ['iz başlangıç (' + dosya + ', ' + st.etiket + ', ' + neden + ', ' + satirlar.length + ' satır)']
  for (const s of satirlar) cikti.push('iz ' + sure(st, s.t) + ' ' + s.kaynak + ': ' + s.text)
  cikti.push('iz yoklama (' + st.etiket + '): ' + kisalt(JSON.stringify(yoklama)))
  cikti.push(ozet(st, neden))
  cikti.push('iz bitiş (' + dosya + ', ' + st.etiket + ')')
  console.log(cikti.join('\n'))
}

function bitir (st) {
  if (st.bitti) return
  st.bitti = true
  for (const z of st.zamanlayicilar) clearTimeout(z)
}

// Sayfa için yeni bağlam açılmadan hemen önce çağrılır
function basla (etiket) {
  if (!ACIK) return null
  const st = { t0: simdi(), etiket, sayfa: null, olaylar: [], yuklendi: 0, sonYazim: 0, bitti: false, zamanlayicilar: [] }
  sayfalar.push(st)
  ekle('iz', 'sayfa açılıyor: ' + etiket)
  st.zamanlayicilar.push(setTimeout(() => {
    if (!st.yuklendi) yaz(st, GEC_MS + ' ms içinde load yok').catch(() => {})
  }, GEC_MS))
  st.zamanlayicilar.push(setTimeout(() => {
    if (!st.yuklendi) yaz(st, SON_MS + ' ms içinde load yok').catch(() => {}).then(() => bitir(st))
  }, SON_MS))
  return st
}

// Sayfanın Playwright olayları ortak zaman çizgisine etiketiyle yazılır, ilk load olayına kadar ayrıca
// sayfanın kendi listesinde tutulur (özet için)
function izleSayfa (st, page) {
  if (!st) return
  st.sayfa = page
  const k = 'sayfa ' + st.etiket
  const not = (text) => {
    ekle(k, text)
    if (!st.yuklendi) st.olaylar.push((simdi() - st.t0) + ' ' + text)
  }
  const tur = (r) => (r.isNavigationRequest() ? 'nav ' : '') + r.method() + ' ' + r.url().split('#')[0]
  page.on('request', (r) => not('request ' + tur(r) + ' (' + r.resourceType() + ')'))
  page.on('response', (r) => not('response ' + tur(r.request()) + ' ' + r.status() + (r.fromServiceWorker() ? ' (service worker)' : '')))
  page.on('requestfinished', (r) => not('requestfinished ' + tur(r)))
  page.on('requestfailed', (r) => not('requestfailed ' + tur(r) + ' ' + (r.failure() ? r.failure().errorText : '')))
  page.on('framenavigated', (f) => not('framenavigated ' + (f === page.mainFrame() ? 'ana ' : 'alt ') + f.url().split('#')[0]))
  page.on('domcontentloaded', () => not('domcontentloaded'))
  page.on('console', (m) => not('console ' + m.type() + ' ' + m.text()))
  page.on('pageerror', (e) => not('pageerror ' + e.message))
  page.on('crash', () => not('crash'))
  page.on('close', () => not('close'))
  page.on('worker', (w) => not('worker ' + w.url()))
  page.on('load', () => {
    not('load ' + page.url().split('#')[0])
    // Firefox'ta ilk about:blank belgesi de load olayı verir, yalnızca uygulama belgesi sayılır
    if (st.yuklendi || !/^https?:/.test(page.url())) return
    st.yuklendi = simdi()
    const gec = st.yuklendi - st.t0 > GEC_MS
    const is = gec ? yaz(st, 'load ' + (st.yuklendi - st.t0) + ' ms sonra geldi') : Promise.resolve(console.log(ozet(st, 'normal')))
    is.catch(() => {}).then(() => bitir(st))
  })
}

// Testin kendi adımları (ör. goto çağrısı) ortak zaman çizgisine sayfa etiketiyle yazılır
function isaret (st, text) {
  if (!st) return
  ekle('sayfa ' + st.etiket, text)
  if (!st.yuklendi) st.olaylar.push((simdi() - st.t0) + ' ' + text)
}

// Tarayıcı kapanmadan önce: hiç yüklenmemiş sayfaların son durumu yazılır
async function kapanis () {
  if (!ACIK) return
  for (const st of sayfalar) {
    if (st.bitti) continue
    if (!st.yuklendi) await yaz(st, 'tarayıcı kapanıyor, load yok').catch(() => {})
    bitir(st)
  }
}

module.exports = { ACIK, basla, izleSayfa, izleSunucu, isaret, kapanis }
