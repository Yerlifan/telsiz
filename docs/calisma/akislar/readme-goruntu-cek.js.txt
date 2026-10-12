'use strict'
// README ekran görüntüleri (docs/img): yeni düzenle gerçek sunucuda çekilir
process.chdir('/home/user/ps5-pc-communication')
const path = require('path')
const h = require('/home/user/ps5-pc-communication/e2e/yardimci')
const OUT = process.argv[2] || path.join(__dirname, 'out')
require('fs').mkdirSync(OUT, { recursive: true })

const FREKANSLAR = [{ origin: 'https://oyun.ornek.com', name: 'Oyun Gecesi' }, { origin: 'https://okul.ornek.com', name: 'Okul Ekibi' }]

async function seed (page) {
  await page.context().route('https://*.ornek.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: '<!doctype html><meta charset="utf-8"><p>x</p>' }))
  await page.evaluate((list) => {
    localStorage.setItem('telsiz.frekanslar', JSON.stringify(list))
    localStorage.setItem('telsiz.frekanslar.konum', '0')
    frekansState.webList = null
    renderBand()
  }, FREKANSLAR)
}

async function quiet (page) {
  // Açılış bildirimi (anahtar eklendi) kapansın
  await page.waitForFunction(() => {
    const t = document.getElementById('toast')
    return !t || t.hidden || !t.textContent.trim() || getComputedStyle(t).opacity === '0'
  }, null, { timeout: 15000 }).catch(() => {})
  await h.sleep(800)
}

async function main () {
  const w = await h.setupWorld({ slot: 41, extraPeople: { can: 'Can' } })
  try {
    const T = w.P.deniz.token
    await w.call('POST', '/api/settings', { serverName: 'Cuma Akşamı' }, T)
    const meta = (await w.call('GET', '/api/state', null, T)).data.meta
    for (const c of meta.channels) {
      if (c.name === 'oyun-gecesi') await w.call('POST', '/api/channels/delete', { id: c.id }, T)
      if (c.name === 'Oyun') await w.call('POST', '/api/channels/update', { id: c.id, name: 'Oyun gecesi' }, T)
      if (c.type === 'voice' && c.name !== 'Lobi' && c.name !== 'Oyun') await w.call('POST', '/api/channels/delete', { id: c.id }, T)
    }
    const meta2 = (await w.call('GET', '/api/state', null, T)).data.meta
    const room = (name) => meta2.channels.filter((c) => c.name === name)[0]
    const genel = room('genel')
    const oyun = room('oyun')
    const lobi = room('Lobi')
    await w.say('mert', genel, 'Ben varım. Kulaklığı şarj ettim 🎧')
    await w.say('deniz', genel, 'Ben de geliyorum. @ece yeni haritayı birlikte deneyelim mi?')
    await w.say('ece', genel, 'Olur! Önce ekranımı paylaşırım, bir tur birlikte bakarız.')
    await w.say('mert', genel, 'Biraz geç kalabilirim, işten çıkınca telefondan bağlanırım.')
    await w.say('deniz', genel, 'Sorun değil. Telsiz DJ\'ye de birkaç parça ekledim, beklerken dinleriz.')
    await w.say('ece', genel, 'Harika 👍 Bu arada mesajlar uçtan uca şifreli, sunucu yalnızca şifreli metni görüyor.')
    await w.say('deniz', genel, 'Ben Lobi\'ye geçiyorum, oradayım.')
    await w.say('ece', oyun, 'Bu akşam hangi haritadayız?')
    await w.say('mert', oyun, 'Yeni çıkanı deneyelim')

    const deniz = await w.pageFor('deniz', { extra: { 'telsiz.skin': 'arcade', 'telsiz.scheme': 'dark' } })
    const ece = await w.pageFor('ece', { extra: { 'telsiz.skin': 'gece', 'telsiz.scheme': 'light' } })
    const mert = await w.pageFor('mert', { extra: { 'telsiz.skin': 'turkuaz', 'telsiz.scheme': 'dark' } })
    for (const p of [deniz, ece, mert]) await seed(p)
    await h.joinVoice(ece, lobi.id)
    await h.joinVoice(mert, lobi.id)
    await h.joinVoice(deniz, lobi.id)
    // Yalnızca Ece konuşsun: diğerlerinin mikrofonu kapalı
    for (const p of [deniz, mert]) await p.click('#btn-mute')
    // Telefon görüntüsü 2x yoğunlukta: yardımcı bağlamı 1x açar, bu sayfa için bağlam seçeneği genişletilir
    const browser = w.tb.browser
    const origCtx = browser.newContext.bind(browser)
    browser.newContext = (o) => origCtx(Object.assign({}, o, { deviceScaleFactor: 2 }))
    const tel = await w.pageFor('can', { label: 'can-tel', viewport: { width: 390, height: 844 }, mobile: true })
    browser.newContext = origCtx
    await seed(tel)
    // Telefonda İstasyonlar listesi gizli: uygulamanın kendi katılma işleviyle
    await tel.evaluate((id) => joinVoice(id), lobi.id)
    await tel.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'on', null, { timeout: h.LONG })
    await tel.evaluate(() => toggleMute())
    for (const p of [deniz, ece, mert, tel]) {
      await p.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 4, null, { timeout: h.LONG })
    }
    for (const p of [deniz, ece, mert, tel]) await quiet(p)
    await h.sleep(1500)
    // Ece konuşurken çekilsin (sahte mikrofon aralıklı ses verir)
    for (const p of [deniz, ece, mert]) await p.waitForFunction(() => Boolean(document.querySelector('#radio-crew .crew-item.is-speaking')), null, { timeout: 20000 }).catch(() => {})
    // Fare boş bir alana alınır (üzerine gelme vurgusu kalmasın). Sahte mikrofon aralıklı ses verdiği için görüntü
    // konuşma halkası çekimden önce ve sonra yanıyorsa kabul edilir, en çok 15 deneme
    const calm = async (p, x, y) => {
      await p.mouse.move(x === undefined ? 1300 : x, y === undefined ? 860 : y)
      await p.evaluate(() => {
        if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur()
      })
    }
    // Sonsuz animasyonlar (ör. İstasyonlar'daki canlı nokta) başlangıç karesinde dondurulur
    const shot = (p, o) => p.screenshot(Object.assign({ animations: 'disabled' }, o))
    // meter: konuşan kişinin kendi sayfasında ses düzeyi çubuğu da dolu olmalı
    const speaking = (p, meter) => p.evaluate((m) => Boolean(document.querySelector('#radio-crew .crew-item.is-speaking')) &&
      (!m || parseFloat(document.getElementById('radio-vad-bar').style.width || '0') >= 20), meter)
    const speakingShot = async (p, file, shoot, meter) => {
      await calm(p)
      let tries = 0
      while (tries < 15) {
        tries += 1
        await p.waitForFunction((m) => Boolean(document.querySelector('#radio-crew .crew-item.is-speaking')) &&
          (!m || parseFloat(document.getElementById('radio-vad-bar').style.width || '0') >= 20), meter, { timeout: 20000 }).catch(() => {})
        await (shoot || ((o) => shot(p, o)))({ path: path.join(OUT, file) })
        if (await speaking(p, meter)) {
          console.log(file + ': konuşma halkasıyla çekildi (' + tries + '. deneme)')
          return
        }
      }
      console.log(file + ': UYARI konuşma halkası yakalanamadı')
    }
    await speakingShot(deniz, 'ana-arcade-koyu.png')
    await speakingShot(ece, 'ana-gece-acik.png', null, true)
    await speakingShot(mert, 'ana-turkuaz-koyu.png')
    await speakingShot(tel, 'telefon.png')
    // İngilizce: Deniz'in ses odasındaki sayfasında dil İngilizceye çevrilir (sayfa yenilenmez), çekimden sonra geri alınır
    await deniz.evaluate(() => changeLanguage('en'))
    await deniz.waitForFunction(() => document.documentElement.lang === 'en', null, { timeout: 10000 }).catch(() => {})
    await h.sleep(600)
    await speakingShot(deniz, 'ingilizce.png')
    await deniz.evaluate(() => changeLanguage('tr'))
    await deniz.waitForFunction(() => document.documentElement.lang === 'tr', null, { timeout: 10000 }).catch(() => {})
    await h.sleep(600)
    // Ayarlar > Görünüm
    await deniz.evaluate(() => openSettings('appearance'))
    await deniz.waitForSelector('#settings-page[data-cat="appearance"]')
    await calm(deniz, 60, 860)
    await h.sleep(600)
    const cut = await deniz.evaluate(() => {
      const mode = document.getElementById('set-scheme-section').getBoundingClientRect()
      const font = document.getElementById('set-font-section').getBoundingClientRect()
      return Math.round((mode.bottom + font.top) / 2)
    })
    await shot(deniz, { path: path.join(OUT, 'ayarlar.png'), clip: { x: 0, y: 0, width: 1440, height: Math.min(900, cut) } })
    await deniz.keyboard.press('Escape')
    await deniz.waitForSelector('#settings-view', { state: 'hidden' })
    // Telsiz kartı yakın çekim, Ece konuşurken
    const card = await deniz.evaluate(() => {
      const r = document.getElementById('radio').getBoundingClientRect()
      return { x: Math.round(r.left), y: Math.round(r.top) + 2, width: Math.round(r.width), height: Math.round(r.height) - 2 }
    })
    await speakingShot(deniz, 'telsiz-karti.png', (o) => shot(deniz, Object.assign({ clip: card }, o)))
    console.log('tamam')
  } finally {
    await w.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
