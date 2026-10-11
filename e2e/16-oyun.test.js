'use strict'

// Renk kart oyunu (public/js/33-oyun-protokol.js ile 37-renk.js) gerçek tarayıcıda, dört kişi aynı ses odasında.
// Deniz kurpiyerdir ve Aylin'i engellemiştir. Ece ve Deniz geniş ekranda, Mert telefonda (360 x 740).
// - Oyun düğmesi telsiz kartının araç satırında Telsiz DJ'den hemen önce durur
// - Masa Kur: Resmî kural seçili, engellenen Aylin "Engellediniz" çipiyle görünür, Masa Aç lobiyi açar
// - Davet: Ece ve Mert'te Oyun düğmesi "Davet" olur, Ece'nin Bildirimler listesine kayıt düşer, Aylin davet görmez
// - Ece Masaya Bak ile güven notunu görüp katılır. Mert reddeder, kurpiyerde "Reddetti" görünür, düğmeden
//   yeniden açıp katılır
// - Başlat: her elde 7 kart (ilk kart +2 ise atlanan oyuncuda 9), sayfada el dışında yalnız atılan kart çizilir
// - Altı tur oynanır (oynatıcı kural ayrıntısını sınamaz), her turdan sonra üç sayfada atılan kart ve sıra aynıdır
// - Küçült masayı kapatır ama oyun sürer, Oyun düğmesi masayı yeniden açar (22-cast.js castMinimizeGame)
// - Ece sayfasını yenileyip ses odasına döner, Oyuna Dön ile koltuğuna ve eline döner
// - Telefonda sahnenin başlığı 375 x 667 ve 360 x 640 ekranda ve büyük yazıda ulaşılabilir, masa sahnenin içinde kayar
// - Telefonda masa yeniden çizilince sahnenin dikey ve elin yatay kaydırması korunur, odak sahneyi kaydırmaz
// - Masa açıkken paylaşım izlenip bırakılınca ve üst çubuktan durdurulunca odak masada kalır (yalnız Chromium)
// - Telefonda yatay taşma yoktur, el kendi içinde yatay kayar
// - Mert ses odasından ayrılınca iki koltuk kalır, kartları desteye döner
// - Kurpiyer ses odasından ayrılınca oyuncuda bitiş metni görünür, Kapat odağı Oyun düğmesine verir
// - Konsol ve sunucu günlüğü temiz (eksik i18n anahtarı konsola uyarı yazar)
// Test için tohum kancası yoktur: deste kurpiyerin cihazında gerçek rastgelelikle karıştırılır.

const { before, after } = require('node:test')
const assert = require('node:assert/strict')
const h = require('./yardimci')

const W = { w: null, deniz: null, ece: null, mert: null, aylin: null, lobi: null, names: {} }
// Ses odası sahte mikrofon ister (Chromium bayraklarla, Firefox tercihlerle). WebKit'te sahte mikrofon yoktur.
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []), { browsers: h.MIC_BROWSERS, reason: 'sahte mikrofon yok' })

const TURNS = 6
const DEALER_LEFT = 'Kurpiyer ses odasından ayrıldı, oyun bitti.'

const idOf = (who) => String(W.w.P[who].id)
const players = () => [W.deniz, W.ece, W.mert]
const key = (k) => '#cast [data-focus-key="' + k + '"]'
// Sahne oyun kipinde açık ve içinde bu odak anahtarlı denetim var
const onStage = (k) => '#cast[data-mode="game"]:not([hidden]) [data-focus-key="' + k + '"]'
const personSel = (block, who) => '#cast ' + block + ' .game-person[data-user-id="' + idOf(who) + '"]'

// Telefonda ses odaları telsiz kartından değil İstasyonlar sayfasından açılır (10-kamera.test.js gibi)
async function joinPhone (page, channelId) {
  await page.click('#btn-rooms')
  await page.waitForSelector('#stations-sheet:not([hidden])')
  await page.click('#stations-list .room-row[data-station="voice-' + channelId + '"]')
  await page.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'on' && document.getElementById('stations-sheet').hidden, null, { timeout: h.LONG })
}

// Masanın sayfadaki özeti: adım ve sıra modelden, atılan kartın adı, durum satırı ve el DOM'dan
function tableOf (page) {
  return page.evaluate(() => {
    const m = gameModel()
    const q = (sel) => document.querySelector('#cast ' + sel)
    const pile = q('.renk-pile')
    const status = q('.game-status-turn')
    const table = q('.renk-table')
    return {
      stage: m.stage,
      me: m.me,
      step: m.view ? m.view.step : null,
      turn: m.view ? m.view.turn : null,
      top: m.view ? m.view.top : null,
      seats: m.view ? m.view.seats.length : 0,
      deck: m.view ? m.view.deck : null,
      pending: Boolean(m.pending),
      cards: m.mine ? m.mine.cards.length : 0,
      pile: pile ? pile.getAttribute('aria-label') : null,
      status: status ? status.textContent : null,
      mine: Boolean(table) && table.getAttribute('data-turn') === 'me',
      hand: document.querySelectorAll('#cast .renk-hand .renk-card').length,
      all: document.querySelectorAll('#cast .renk-card').length,
      opponents: document.querySelectorAll('#cast .renk-opp').length,
      sub: q('.cast-sub') ? q('.cast-sub').textContent : ''
    }
  })
}

// Sayfalar aynı adıma, sıraya ve atılan karta gelene kadar bekler. Sıra tam bir sayfada "me" görünür.
async function settle (pages) {
  let list = []
  await h.until(async () => {
    list = await Promise.all(pages.map(tableOf))
    const sig = (x) => [x.stage, x.step, x.turn, x.pile, x.seats, x.deck].join('|')
    if (list.some((x) => x.pending || x.pile === null) || !list.every((x) => sig(x) === sig(list[0]))) return false
    return list.filter((x) => x.mine).length === (list[0].turn ? 1 : 0)
  }, h.LONG, 'masa sayfalarda eşitlenmedi')
  return list
}

// Sayfanın modeli bu adımı geçti ve bekleyen hamle yok
async function advanced (page, step) {
  await page.waitForFunction((s) => {
    const m = gameModel()
    return Boolean(m.view) && m.view.step > s && !m.pending
  }, step, { timeout: h.LONG })
  return tableOf(page)
}

async function pickFirstColor (page) {
  await page.waitForSelector('#cast .renk-picker[role="dialog"] .renk-pick', { timeout: h.LONG })
  await page.click('#cast .renk-picker .renk-pick')
}

// Sırası gelen sayfa için bir tur: Renk Seç görünüyorsa ilk renk, yoksa ilk oynanabilir kart (seçici açılırsa ilk
// renk), yoksa Deste ve ardından etkinse Pas Geç. Kuralların ayrıntısı burada sınanmaz.
async function playOneTurn (page) {
  const start = await tableOf(page)
  const choose = await page.$(key('game-choose-color') + ':not([aria-disabled="true"])')
  if (choose) {
    await choose.click()
    await pickFirstColor(page)
    await advanced(page, start.step)
    return 'color'
  }
  const card = await page.$('#cast .renk-hand .renk-card.is-playable:not([aria-disabled="true"])')
  if (card) {
    const wild = (await card.getAttribute('data-color')) === 'W'
    await card.click()
    if (wild && start.cards > 1) await pickFirstColor(page)
    await advanced(page, start.step)
    return 'play'
  }
  await page.click(key('game-draw'))
  const drawn = await advanced(page, start.step)
  const pass = await page.$(key('game-pass') + ':not([aria-disabled="true"])')
  if (!pass) return 'draw'
  await pass.click()
  await advanced(page, drawn.step)
  return 'draw pass'
}

// Elin yatay kayması: el görünür alanın içinde, taşan el kendi içinde sona kayar (sayfa kaymaz)
function handScroll (page) {
  return page.evaluate(() => {
    const hand = document.querySelector('#cast .renk-hand')
    const box = hand.getBoundingClientRect()
    const wide = hand.scrollWidth > hand.clientWidth
    hand.scrollLeft = hand.scrollWidth
    const out = {
      overflow: getComputedStyle(hand).overflowX,
      inside: box.left >= 0 && box.right <= document.documentElement.clientWidth,
      wide: wide,
      scrolled: hand.scrollLeft > 0,
      cards: hand.querySelectorAll('.renk-card').length
    }
    hand.scrollLeft = 0
    return out
  })
}

// Sırası olan sayfada "Sıra Sizde", diğerlerinde "Sıradaki: <ad>"
function assertStatus (list) {
  const turn = list[0].turn
  list.forEach((x) => {
    assert.equal(x.status, x.me === turn ? 'Sıra Sizde' : 'Sıradaki: ' + W.names[turn], 'durum satırı (' + W.names[x.me] + ')')
  })
}

before(async () => {
  if (test.skipped) return
  W.w = await h.setupWorld({ slot: 21, extraPeople: { aylin: 'Aylin' } })
  W.lobi = W.w.room('Lobi')
  Object.keys(W.w.names).forEach((who) => {
    W.names[idOf(who)] = W.w.names[who]
  })
  const res = await W.w.call('POST', '/api/blocks/add', { userId: W.w.P.aylin.id }, W.w.P.deniz.token)
  assert.equal(res.status, 200, JSON.stringify(res.data))
  W.deniz = await W.w.pageFor('deniz')
  W.ece = await W.w.pageFor('ece')
  W.mert = await W.w.pageFor('mert', { viewport: { width: 360, height: 740 }, mobile: true })
  W.aylin = await W.w.pageFor('aylin')
})

after(async () => {
  if (W.w) await W.w.close()
})

test('dört kişi ses odasında, Oyun düğmesi araç satırında Telsiz DJ\'den hemen önce', async () => {
  await h.joinVoice(W.deniz, W.lobi.id)
  await h.joinVoice(W.ece, W.lobi.id)
  await joinPhone(W.mert, W.lobi.id)
  await h.joinVoice(W.aylin, W.lobi.id)
  for (const page of [W.deniz, W.ece, W.mert, W.aylin]) {
    await page.waitForFunction(() => document.querySelectorAll('#radio-crew .crew-item[data-user-id]').length === 4, null, { timeout: h.LONG })
    await page.waitForSelector('#radio-tools #radio-game', { timeout: h.LONG })
    const r = await page.evaluate(() => {
      const box = document.getElementById('radio-tools')
      const b = document.getElementById('radio-game')
      const dj = box.querySelector('.crew-dj')
      return {
        label: b.querySelector('.radio-tool-label').textContent,
        aria: b.getAttribute('aria-label'),
        focusKey: b.getAttribute('data-focus-key'),
        controls: b.getAttribute('aria-controls'),
        expanded: b.getAttribute('aria-expanded'),
        placed: dj ? box.lastElementChild === dj && b.nextElementSibling === dj : box.lastElementChild === b
      }
    })
    assert.deepEqual(r, { label: 'Oyun', aria: 'Oyun masası kurun', focusKey: 'tool-game', controls: 'cast', expanded: 'false', placed: true })
    // Araç satırındaki görünen etiketler kesilmez (telefonda Oyun düğmesinin etiketi görsel olarak gizlidir)
    const cut = await page.evaluate(() => Array.from(document.querySelectorAll('#radio-tools .radio-tool-label'))
      .filter((l) => getComputedStyle(l).position !== 'absolute' && l.scrollWidth > l.clientWidth + 1)
      .map((l) => l.textContent))
    assert.deepEqual(cut, [], 'kesilen etiket')
  }
})

test('kurpiyer Masa Kur ekranında Resmî kuralı ve engellediği kişiyi görür, masayı açar', async () => {
  const { deniz } = W
  await deniz.click('#radio-game')
  await deniz.waitForSelector(onStage('game-open'), { timeout: h.LONG })
  const r = await deniz.evaluate(() => ({
    title: document.querySelector('#cast .cast-title').textContent,
    official: document.querySelector('#cast [data-focus-key="game-rule-official"]').getAttribute('aria-checked'),
    stack: document.querySelector('#cast [data-focus-key="game-rule-stack"]').getAttribute('aria-checked'),
    tool: document.getElementById('radio-game').getAttribute('aria-expanded')
  }))
  assert.deepEqual(r, { title: 'Masa Kur', official: 'true', stack: 'false', tool: 'true' })
  assert.equal(await deniz.textContent(personSel('.game-room', 'aylin') + ' .game-chip.is-blocked'), 'Engellediniz')
  // Ece ve Mert katılabilir: anahtarları doğrulanınca satırlarında çip kalmaz
  await deniz.waitForFunction((sels) => sels.every((sel) => {
    const row = document.querySelector(sel)
    return Boolean(row) && !row.querySelector('.game-chip')
  }), [personSel('.game-room', 'ece'), personSel('.game-room', 'mert')], { timeout: h.LONG })
  await deniz.click(key('game-open'))
  await deniz.waitForSelector('#cast .game-body[data-stage="lobby"]', { timeout: h.LONG })
  assert.equal(await deniz.textContent('#cast .cast-title'), 'Renk Masası')
  assert.equal(await deniz.textContent('#cast .cast-sub'), 'Kurpiyer Sizsiniz · 1 Oyuncu')
})

test('davet: Ece ve Mert davet görür, engellenen Aylin görmez', async () => {
  const { deniz, ece, mert, aylin } = W
  await ece.waitForSelector('#radio-game.is-invited', { timeout: h.LONG })
  await ece.waitForSelector('#activity .activity-item.is-game', { timeout: h.LONG })
  await mert.waitForSelector('#radio-game.is-invited', { timeout: h.LONG })
  const r = await ece.evaluate(() => {
    const b = document.getElementById('radio-game')
    return { label: b.querySelector('.radio-tool-label').textContent, badge: b.querySelector('.radio-tool-count').textContent, aria: b.getAttribute('aria-label') }
  })
  assert.deepEqual(r, { label: 'Davet', badge: '1', aria: 'Davet: Deniz sizi Renk oyununa davet ediyor' })
  assert.equal(await ece.textContent('#activity .activity-item.is-game .activity-watch'), 'Masaya Bak')
  // Gelen davet sahneyi açmaz
  for (const page of [ece, mert]) assert.equal(await page.isHidden('#cast'), true)
  for (const who of ['ece', 'mert']) assert.equal(await deniz.textContent(personSel('.game-room', who) + ' .game-chip'), 'Yanıt Bekleniyor')
  await h.sleep(3000)
  const a = await aylin.evaluate(() => ({
    invited: document.getElementById('radio-game').classList.contains('is-invited'),
    label: document.querySelector('#radio-game .radio-tool-label').textContent,
    activity: document.querySelectorAll('#activity .activity-item.is-game').length,
    invite: gameModel().invite
  }))
  assert.deepEqual(a, { invited: false, label: 'Oyun', activity: 0, invite: null })
})

test('Ece Masaya Bak ile katılır, Mert reddeder ve düğmeden yeniden açıp katılır', async () => {
  const { deniz, ece, mert } = W
  await ece.click('#activity .activity-item.is-game .activity-watch')
  await ece.waitForSelector(onStage('game-join'), { timeout: h.LONG })
  assert.match(await ece.textContent('#cast .game-trust'), /^Kurpiyer Deniz\./)
  // Güven notu Katıl düğmesinden önce gelir
  const order = await ece.evaluate(() => {
    const trust = document.querySelector('#cast .game-trust')
    const join = document.querySelector('#cast [data-focus-key="game-join"]')
    return Boolean(trust.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  assert.equal(order, true, 'güven notu Katıl düğmesinin üstünde')
  await ece.click(key('game-join'))
  await deniz.waitForSelector(personSel('.game-seats', 'ece'), { timeout: h.LONG })
  await ece.waitForSelector('#cast .game-body[data-stage="lobby"] .game-wait', { timeout: h.LONG })
  // Katılınca Bildirimler listesindeki davet kalkar
  await ece.waitForSelector('#activity .activity-item.is-game', { state: 'detached', timeout: h.LONG })

  await mert.click('#radio-game')
  await mert.waitForSelector(onStage('game-decline'), { timeout: h.LONG })
  await mert.click(key('game-decline'))
  await mert.waitForSelector('#cast', { state: 'hidden', timeout: h.LONG })
  await deniz.waitForFunction((sel) => {
    const chip = document.querySelector(sel)
    return Boolean(chip) && chip.textContent === 'Reddetti'
  }, personSel('.game-room', 'mert') + ' .game-chip', { timeout: h.LONG })
  // Lobi sürdükçe düğme "Davet" kalır
  assert.equal(await mert.textContent('#radio-game .radio-tool-label'), 'Davet')
  await mert.click('#radio-game.is-invited')
  await mert.waitForSelector(onStage('game-join'), { timeout: h.LONG })
  await mert.click(key('game-join'))
  await deniz.waitForFunction(() => document.querySelectorAll('#cast .game-seats .game-person').length === 3, null, { timeout: h.LONG })
  assert.equal(await deniz.textContent('#cast .cast-sub'), 'Kurpiyer Sizsiniz · 3 Oyuncu')
  assert.equal(await deniz.getAttribute(key('game-start'), 'aria-disabled'), null)
})

test('Başlat: üç sayfada eller dağıtılır, sayfada başkalarının eli çizilmez', async (t) => {
  const { deniz, mert } = W
  await deniz.click(key('game-start'))
  for (const page of players()) await page.waitForSelector('#cast .renk-table', { timeout: h.LONG })
  const list = await settle(players())
  // İlk kart +2 ise sıradaki oyuncu 2 kart çekip atlanır (35-renk-kural.js newGame)
  const extra = list[0].top.charAt(1) === 'D' ? 2 : 0
  assert.deepEqual(list.map((x) => x.hand).sort(), (extra ? [7, 7, 9] : [7, 7, 7]), 'el sayıları')
  list.forEach((x) => {
    assert.equal(x.hand, x.cards, 'el modelle aynı (' + W.names[x.me] + ')')
    assert.equal(x.all, x.hand + 1, 'el ve atılan kart dışında kart yok (' + W.names[x.me] + ')')
    assert.equal(x.opponents, 2)
    assert.equal(x.stage, 'play')
  })
  assert.equal(list[0].sub, 'Resmî Kurallar · Kurpiyer Sizsiniz · 3 Oyuncu')
  assertStatus(list)
  t.diagnostic('ilk kart ' + list[0].top + ', eller ' + list.map((x) => x.hand).join(' '))
  // Telefonda 7 kart 360 piksele sığmaz, el kendi içinde kayar
  const r = await handScroll(mert)
  assert.deepEqual(r, { overflow: 'auto', inside: true, wide: true, scrolled: true, cards: list[2].hand })
  assert.ok(await h.overflowX(mert) <= 0, 'telefonda yatay taşma')
})

test('altı tur oynanır, her turdan sonra üç sayfada atılan kart ve sıra aynıdır', async (t) => {
  const pages = players()
  const done = []
  while (done.length < TURNS) {
    const list = await settle(pages)
    assert.equal(list[0].stage, 'play', 'el bitmedi')
    const k = list.findIndex((x) => x.mine)
    done.push(W.names[list[k].me] + ' ' + await playOneTurn(pages[k]))
    const after = await settle(pages)
    assertStatus(after)
    assert.ok(after[0].step > list[0].step, 'adım ilerledi')
  }
  t.diagnostic(done.join(', '))
})

test('Küçült masayı kapatır ama oyun sürer, Oyun düğmesi masayı yeniden açar', async () => {
  const { ece } = W
  const before = await settle(players())
  await ece.click('#cast .cast-game-min')
  await ece.waitForSelector('#cast', { state: 'hidden', timeout: h.LONG })
  const r = await ece.evaluate(() => {
    const b = document.getElementById('radio-game')
    return { stage: gameModel().stage, state: b.getAttribute('data-state'), expanded: b.getAttribute('aria-expanded'), active: document.activeElement.id }
  })
  const mine = before[1].mine
  assert.deepEqual(r, { stage: 'play', state: mine ? 'turn' : 'back', expanded: 'false', active: 'radio-game' })
  await ece.click('#radio-game')
  await ece.waitForSelector('#cast[data-mode="game"]:not([hidden]) .renk-table', { timeout: h.LONG })
  const after = await settle(players())
  assert.equal(after[1].cards, before[1].cards)
  assert.equal(after[1].step, before[1].step)
})

test('Ece sayfasını yenileyip ses odasına döner, Oyuna Dön ile koltuğuna ve eline döner', async () => {
  const { ece } = W
  const before = await settle(players())
  await ece.reload({ waitUntil: 'domcontentloaded', timeout: h.LONG })
  await ece.waitForSelector('#app-view:not([hidden])', { timeout: h.LONG })
  await ece.waitForSelector('#band-track .station[data-station]', { timeout: h.LONG })
  await h.joinVoice(ece, W.lobi.id)
  // Kurpiyer yeni bağlantıda yeni değerli davet gönderir: teklif sahneyi açmaz, düğme Davet olur
  await ece.waitForSelector('#radio-game.is-invited', { timeout: h.LONG })
  assert.equal(await ece.textContent('#radio-game .radio-tool-label'), 'Davet')
  assert.equal(await ece.isHidden('#cast'), true)
  await ece.click('#radio-game')
  await ece.waitForSelector(onStage('game-rejoin'), { timeout: h.LONG })
  assert.equal(await ece.textContent('#cast .game-lead'), 'Bu masada koltuğunuz duruyor. Oyuna dönmek ister misiniz?')
  assert.equal(await ece.evaluate(() => document.activeElement.getAttribute('data-focus-key')), 'game-rejoin')
  await ece.click(key('game-rejoin'))
  await ece.waitForSelector('#cast .renk-table', { timeout: h.LONG })
  const after = await settle(players())
  assert.equal(after[1].cards, before[1].cards, 'el aynı')
  assert.equal(after[1].step, before[1].step)
  assert.equal(after[1].seats, 3)
})

test('telefonda sahnenin başlığı küçük ekranda ve büyük yazıda ulaşılabilir, masa sahnenin içinde kayar', async () => {
  const { mert } = W
  const check = async (label) => {
    await h.sleep(300)
    for (const sel of ['#cast .cast-title', '#cast .cast-game-min', '#cast .cast-full']) {
      assert.equal(await h.reachable(mert, sel), true, label + ': ' + sel)
    }
    // Sahneyi kırpan panel kaymaz, masa .cast-game içinde kayar: en üstte durum satırı görünür
    const panel = await mert.evaluate(() => {
      document.querySelector('#cast .cast-game').scrollTop = 0
      return document.querySelector('#cast .cast-panel').scrollTop
    })
    assert.equal(panel, 0, label + ': panel kaymış')
    assert.equal(await h.reachable(mert, '#cast .game-status-turn'), true, label + ': durum satırı')
  }
  await check('360 x 740')
  await mert.setViewportSize({ width: 375, height: 667 })
  await check('375 x 667')
  await mert.setViewportSize({ width: 360, height: 640 })
  await check('360 x 640')
  await mert.setViewportSize({ width: 360, height: 740 })
  await mert.evaluate(() => window.TelsizTheme.set({ fontSize: 'large' }))
  await check('360 x 740, büyük yazı')
  await mert.evaluate(() => window.TelsizTheme.set({ fontSize: 'normal' }))
  assert.ok(await h.overflowX(mert) <= 0, 'telefonda yatay taşma')
})

test('telefonda masa yeniden çizilince sahnenin ve elin kaydırması korunur, odak sahneyi kaydırmaz', async () => {
  const { mert } = W
  await settle(players())
  const r = await mert.evaluate(() => {
    const game = document.querySelector('#cast .cast-game')
    const card = document.querySelector('#cast .renk-hand .renk-card')
    const hand = document.querySelector('#cast .renk-hand')
    const focusKey = card.getAttribute('data-focus-key')
    card.focus({ preventScroll: true })
    game.scrollTop = 0
    hand.scrollLeft = hand.scrollWidth
    const left = hand.scrollLeft
    // Odaktaki kart sahnenin görünen alanının dışında (en üstte durum satırı ve atılan kart görünür)
    const hidden = card.getBoundingClientRect().top >= game.getBoundingClientRect().bottom
    const body = document.querySelector('#cast .game-body')
    gameRefreshStage()
    const hand2 = document.querySelector('#cast .renk-hand')
    return {
      rebuilt: document.querySelector('#cast .game-body') !== body,
      hidden: hidden,
      top: game.scrollTop,
      left: hand2.scrollLeft === left,
      focus: document.activeElement.getAttribute('data-focus-key') === focusKey
    }
  })
  assert.deepEqual(r, { rebuilt: true, hidden: true, top: 0, left: true, focus: true })
})

test('masa açıkken paylaşım izlenip bırakılınca ve üst çubuktan durdurulunca odak masada kalır', async () => {
  const { deniz, ece } = W
  const focusIn = (page) => page.evaluate(() => {
    const c = document.getElementById('cast')
    return { mode: c.getAttribute('data-mode'), hidden: c.hidden, inStage: c.querySelector('.cast-game').contains(document.activeElement) }
  })
  await deniz.click('#btn-screen')
  await deniz.waitForSelector('#cast-dialog:not([hidden]) .cast-dialog-panel', { timeout: h.LONG })
  await deniz.click('#cast-dialog .cast-primary')
  await deniz.waitForSelector('#top-cast:not([hidden]) .top-cast-stop', { timeout: h.LONG })
  // Kendi paylaşımının önizlemesi masadan sonra gelir: sahne oyun kipinde kalır
  assert.equal(await deniz.getAttribute('#cast', 'data-mode'), 'game')
  await ece.waitForSelector('#activity:not([hidden]) .activity-item.is-share .activity-watch', { timeout: h.LONG })
  await ece.focus('#activity .activity-item.is-share .activity-watch')
  await ece.keyboard.press('Enter')
  await ece.waitForSelector('#cast[data-mode="watch"]:not([hidden]) .cast-unwatch', { timeout: h.LONG })
  await ece.focus('#cast .cast-unwatch')
  await ece.keyboard.press('Enter')
  await ece.waitForSelector('#cast[data-mode="game"]:not([hidden])', { timeout: h.LONG })
  assert.deepEqual(await focusIn(ece), { mode: 'game', hidden: false, inStage: true })
  await deniz.focus('#top-cast .top-cast-stop')
  await deniz.keyboard.press('Enter')
  await deniz.waitForFunction(() => document.getElementById('top-cast').hidden, null, { timeout: h.LONG })
  assert.deepEqual(await focusIn(deniz), { mode: 'game', hidden: false, inStage: true })
  await settle(players())
}, { browsers: ['chromium'], reason: 'sahte ekran paylaşımı yalnızca Chromium bayraklarıyla' })

test('telefonda oyun ortasında yatay taşma yok, el kendi içinde yatay kayar', async (t) => {
  const { mert } = W
  assert.ok(await h.overflowX(mert) <= 0, 'telefonda yatay taşma: ' + await h.overflowX(mert))
  const r = await handScroll(mert)
  t.diagnostic('telefonda el ' + r.cards + ' kart, taşıyor: ' + r.wide)
  assert.equal(r.overflow, 'auto')
  assert.equal(r.inside, true, 'el görünür alanın içinde')
  // Az kart kalmışsa el sığar ve kaymaz, taşan el kayar
  assert.equal(r.scrolled, r.wide, 'taşan el yatay kayar')
  assert.ok(await h.overflowX(mert) <= 0, 'el kayınca sayfa taşmaz')
})

test('Mert ses odasından ayrılınca iki koltuk kalır, kartları desteye döner', async () => {
  const { deniz, ece, mert } = W
  const list = await settle(players())
  const deck = list[0].deck
  const left = list[2].cards
  await mert.click('#voice-leave')
  await mert.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
  await mert.waitForSelector('#cast', { state: 'hidden', timeout: h.LONG })
  await deniz.waitForFunction(() => gameModel().view.seats.length === 2, null, { timeout: h.LONG })
  const after = await settle([deniz, ece])
  after.forEach((x) => {
    assert.equal(x.seats, 2)
    assert.equal(x.deck, deck + left, 'deste Mert\'in kartları kadar büyüdü')
    assert.equal(x.opponents, 1)
    assert.match(x.sub, / · 2 Oyuncu$/)
    assert.equal(x.stage, 'play')
  })
  assertStatus(after)
})

test('kurpiyer ses odasından ayrılınca oyun biter, Kapat odağı Oyun düğmesine verir', async () => {
  const { deniz, ece } = W
  await deniz.click('#voice-leave')
  await deniz.waitForFunction(() => document.getElementById('radio').getAttribute('data-state') === 'off', null, { timeout: h.LONG })
  await deniz.waitForSelector('#cast', { state: 'hidden', timeout: h.LONG })
  await ece.waitForSelector('#cast .game-ended', { timeout: h.LONG })
  assert.equal(await ece.textContent('#cast .game-ended .game-note-text'), DEALER_LEFT)
  assert.equal(await ece.textContent(key('game-dismiss')), 'Kapat')
  await ece.click(key('game-dismiss'))
  await ece.waitForSelector('#cast', { state: 'hidden', timeout: h.LONG })
  assert.equal(await ece.evaluate(() => document.activeElement.id), 'radio-game')
  assert.equal(await ece.textContent('#radio-game .radio-tool-label'), 'Oyun')
})

test('konsol ve sunucu günlüğü temiz', async () => {
  h.assertCleanConsole(W.w.logs, W.w.srv.errors)
})
