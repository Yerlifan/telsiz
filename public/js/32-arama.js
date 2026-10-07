'use strict'

// Özel mesaj araması arayüzü (sesli ve görüntülü). Arama yalnızca iki arkadaş arasında, özel mesaj konuşmasının
// kimliğiyle açılan özel bir ses odasında yapılır. Arama bilgisi herkese açık metaya girmez, kişiye özel görünümden
// gelir (priv().call, 14-social.js normalizeCall). Ses motoruna köprü ve odaya katılım 10-voice.js'tedir
// (voiceHandleMeta, voiceRoster, joinCallRoom).
// - Özel mesaj başlığında Sesli Ara (#dm-call-voice) ve Görüntülü Ara (#dm-call-video). Arama yapılamıyorsa düğme
//   devre dışıdır (aria-disabled), nedeni title ve erişilebilir adda yazar.
// - Konuşmanın üst bölümü (#dm-call, başlık ile mesajlar arasında): iki kutu (karşı taraf ve kendiniz; kamera açık ve
//   görüntü geliyorsa video, yoksa büyük avatar), durum satırı (Aranıyor, Bağlanıyor, süre) ve denetimler
//   (Mikrofon, Kamera, Aramayı Bitir). Gelen aramada aynı bölümde Kabul Et ve Reddet durur. Yazışma altta kalır.
// - Gelen arama kartı (#call-incoming, role="alertdialog"): çalan arama varsa ve bu cihaz aramada değilse görünür.
//   Esc kartı yalnızca gizler ve zili susturur, aramayı reddetmez ve kabul etmez. Kart görününce odak kartın
//   kendisine geçer, düğmelere değil: yanlışlıkla basılan Enter veya Boşluk (ör. bas konuş tuşu) aramayı açmaz.
// - Kamera yalnızca kişinin kendi seçimiyle açılır: görüntülü aramada Kabul Et kamerayla, Kamerasız Kabul Et
//   yalnızca sesle katılır. Gelen arama çalarken başlıktaki Sesli Ara aramayı kamerasız, Görüntülü Ara kamerayla
//   kabul eder (arayanın seçtiği tür aranan tarafın kamerasını açmaz).
// - Zil (31-sesler.js 'ring'): gelen arama çalarken yaklaşık 3 saniyede bir yinelenir. Rahatsız etmeyin durumunda
//   çalmaz (kart yine görünür). Sayfa gizliyse bildirimler açıksa bir kez sistem bildirimi verilir.
// - Arayan için ret ile cevapsız kalma ayırt edilmez: ikisinde de "Arama cevaplanmadı" yazar. Süren arama karşı
//   taraf kapatınca "Arama sona erdi" yazar.

const ARAMA_RING_EVERY_MS = 3000
// Zil, aramanın zil süresinden (ringUntil - createdAt) bu kadar fazla sürerse durur (sunucu kaydı zaten siler)
const ARAMA_RING_SLACK_MS = 3000
// Odaya katıldıktan sonra özel görünümde arama yoksa ve bu süre geçtiyse arama bitmiş sayılır
const ARAMA_GONE_AFTER_MS = 1500

const arama = {
  // Bu cihazın katıldığı veya katılmakta olduğu arama: { dmId, partnerId, role, key, video, seen, joined,
  // joinedAt, active, local }
  session: null,
  // POST /api/calls/start süren konuşmanın kimliği
  starting: null,
  // Görünen gelen arama kartının araması, Esc ile gizlenen veya reddedilen arama
  cardKey: '',
  dismissed: '',
  returnFocus: null,
  // Kabul edilemeyen gelen arama ve nedeni: { key, text }
  blocked: null,
  notified: '',
  // Çalan zilin araması, zilin başladığı an ve süresi dolan zilin araması
  ringKey: '',
  ringDone: '',
  ringTimer: 0,
  ringSince: 0,
  clockTimer: 0,
  // Aramanın etkin olduğu ilk an (süre buradan sayılır): { key, at }
  activeSince: null,
  boxKey: '',
  livePhase: '',
  bound: false
}

// Saf yardımcılar (test/ozel-arama-arayuz.test.js)

function aramaKey (call) {
  return call ? String(call.dmId) + ':' + String(call.createdAt) : ''
}

// Süre: dd:ss, bir saatten uzunsa s:dd:ss
function aramaClock (ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const two = (n) => (n < 10 ? '0' : '') + n
  return hours ? hours + ':' + two(minutes) + ':' + two(seconds) : two(minutes) + ':' + two(seconds)
}

// Bu cihaz aramanın odasında mı (bağlanırken de)
function aramaHere (call, s) {
  return Boolean(call && s && s.private && s.channelId !== null && s.channelId !== undefined && sameId(s.channelId, call.dmId))
}

// Aramanın bu cihazdaki aşaması: 'incoming' (çalıyor, bu cihaz aramada değil), 'calling' (arayan, karşı taraf henüz
// açmadı), 'connecting' (bağlantı kuruluyor), 'active' (karşı tarafla bağlantı kuruldu), 'elsewhere' (arama başka
// bir cihazınızda) veya null
function aramaPhase (call, s) {
  if (!call) return null
  if (!aramaHere(call, s)) return call.state === 'ringing' && call.role === 'callee' ? 'incoming' : 'elsewhere'
  if (call.state === 'ringing') return call.role === 'caller' ? 'calling' : 'connecting'
  if (s.joining) return 'connecting'
  const peer = s.peers ? s.peers[String(call.userId)] : null
  return peer && peer.status === 'connected' ? 'active' : 'connecting'
}

// Zil çalmalı mı: gelen arama çalıyor, bu cihaz aramada değil, Rahatsız etmeyin seçili değil, kart Esc ile
// gizlenmedi ve arama reddedilmedi
function aramaShouldRing (call, s, status, dismissed) {
  if (!call || call.state !== 'ringing' || call.role !== 'callee') return false
  if (aramaHere(call, s) || status === 'dnd') return false
  return aramaKey(call) !== dismissed
}

// Zilin en uzun süresi: aramanın zil süresi (en az 5 saniye) ve pay
function aramaRingLimit (call) {
  const span = call && call.ringUntil > call.createdAt ? call.ringUntil - call.createdAt : 0
  return Math.max(5000, span) + ARAMA_RING_SLACK_MS
}

// Durum satırının metni
function aramaStatusText (phase, call, elapsedMs) {
  if (phase === 'incoming') return t(call && call.video ? 'call.incomingVideoState' : 'call.incomingVoiceState')
  if (phase === 'calling') return t('call.calling')
  if (phase === 'connecting') return t('call.connecting')
  if (phase === 'active') return aramaClock(elapsedMs)
  if (phase === 'elsewhere') return t(call && call.state === 'ringing' ? 'call.calling' : 'call.elsewhere')
  return ''
}

// Durum bilgileri

function aramaCall () {
  return typeof privateCall === 'function' ? privateCall() : null
}

// Ses motorunun son durumu (10-voice.js onVoiceChange her değişimde günceller)
function aramaSnap () {
  return snap()
}

// Gelen ve bu cihazda henüz kabul edilmemiş arama veya null
function aramaIncoming () {
  const call = aramaCall()
  if (!call || call.state !== 'ringing' || call.role !== 'callee') return null
  if (aramaHere(call, aramaSnap())) return null
  if (arama.session && sameId(arama.session.dmId, call.dmId)) return null
  return call
}

function aramaElapsed (call) {
  const since = arama.activeSince && arama.activeSince.key === aramaKey(call) ? arama.activeSince.at : Date.now()
  return Date.now() - since
}

// Başlıktaki arama düğmelerinin devre dışı kalma nedeni, arama yapılabiliyorsa ''
function aramaBlockReason (partner, dmId, video) {
  if (partner === null || partner === undefined) return t('dm.userGone')
  if (!isFriend(partner)) return t('call.notFriends')
  const st = dmSendState(partner)
  if (!st.ok) return dmSendProblemText(st.reason, partner)
  const code = typeof callSupportCode === 'function' ? callSupportCode() : 'unsupported'
  if (code) return voiceErrorText(code, '')
  const call = aramaCall()
  if (call && sameId(call.dmId, dmId) && !(call.state === 'ringing' && call.role === 'callee')) return t('call.already')
  if (arama.session && sameId(arama.session.dmId, dmId)) return t('call.already')
  if (arama.starting !== null) return t('call.starting')
  if (video && !camerasAllowed()) return t('camera.errors.camera_disabled')
  return ''
}

// Özel mesaj başlığının düğmeleri (15-dm.js renderDmHeader çağırır)

function aramaHeaderButtons (header, partner, name) {
  const kinds = [
    { id: 'dm-call-voice', video: false, text: 'call.startVoice', icon: 'i-phone' },
    { id: 'dm-call-video', video: true, text: 'call.startVideo', icon: 'i-camera' }
  ]
  kinds.forEach((kind) => {
    const b = button('button button-secondary dm-call-button', t(kind.text), kind.icon)
    b.id = kind.id
    b.setAttribute('data-focus-key', 'dmh-' + kind.id)
    b.setAttribute('data-video', kind.video ? '1' : '0')
    b.addEventListener('click', () => {
      aramaStart(state.channelId, dmPartner(state.channelId), kind.video)
    })
    header.appendChild(b)
  })
  aramaApplyHeader()
}

// Düğmelerin durumu yerinde güncellenir (başlık yeniden çizilmez, odak korunur)
function aramaApplyHeader () {
  if (!state.me || socialState.view !== 'dm') return
  const dmId = state.channelId
  const partner = dmPartner(dmId)
  const name = partner === null ? '' : userDisplayName(partner)
  const ids = ['dm-call-voice', 'dm-call-video']
  ids.forEach((id) => {
    const b = byId(id)
    if (!b) return
    const video = b.getAttribute('data-video') === '1'
    const reason = aramaBlockReason(partner, dmId, video)
    const label = t(video ? 'call.startVideoLabel' : 'call.startVoiceLabel', { name: name })
    b.classList.toggle('is-disabled', Boolean(reason))
    if (reason) {
      b.setAttribute('aria-disabled', 'true')
      b.setAttribute('aria-label', t('call.unavailableLabel', { action: label, reason: reason }))
      b.title = reason
    } else {
      b.removeAttribute('aria-disabled')
      b.setAttribute('aria-label', label)
      b.title = label
    }
  })
}

// Arama başlatma (arayan). Karşı taraf bu konuşmada zaten arıyorsa sunucu kabul sayar (answer: true).
function aramaStart (dmId, partner, video) {
  if (!state.inApp || dmId === null || dmId === undefined || arama.starting !== null) return
  const reason = aramaBlockReason(partner, dmId, video)
  if (reason) {
    toast(reason, 'error', 8000)
    return
  }
  // Ses bağlamı kullanıcı hareketi içinde açılır (zil ve motor aynı bağlam kuralına uyar)
  if (window.TelsizSesler && typeof window.TelsizSesler.unlock === 'function') window.TelsizSesler.unlock()
  arama.starting = dmId
  aramaApplyHeader()
  api('POST', '/api/calls/start', { dmId: dmId, video: Boolean(video) }).then((res) => {
    arama.starting = null
    const call = res.status === 200 && res.data ? normalizeCall(res.data.call) : null
    if (!call || !state.inApp) {
      if (state.inApp) toast(() => errorText(res, t('call.startFailed')), 'error', 8000)
      aramaSync()
      return
    }
    const answer = res.data.answer === true
    // Karşı tarafın çalan araması kabul edildiyse de kamera bu kişinin bastığı düğmeye göre açılır (Sesli Ara
    // kamerasız katılır, arayanın görüntülü araması kamerayı açtırmaz)
    aramaJoin(call, answer ? 'callee' : 'caller', Boolean(video))
  })
}

// Aramanın odasına katılır. Görüntülü aramada kamera katılımdan sonra açılır.
function aramaJoin (call, role, video) {
  const code = callSupportCode()
  if (code) {
    toast(() => voiceErrorText(code, ''), 'error', 9000)
    return
  }
  const ses = { dmId: call.dmId, partnerId: call.userId, role: role, key: aramaKey(call), video: video, seen: false, joined: false, joinedAt: 0, active: false, local: false }
  arama.session = ses
  arama.blocked = null
  aramaStopRing()
  aramaHideCard(true)
  let pending = null
  try {
    pending = joinCallRoom(call.dmId, call.userId)
  } catch (err) {
    pending = Promise.reject(err)
  }
  Promise.resolve(pending).then(() => {
    if (arama.session !== ses || ses.local) return
    const s = aramaSnap()
    if (!aramaHere(call, s) || s.joining) return
    if (video) aramaStartCamera()
  }, (err) => {
    if (arama.session !== ses || ses.joined) return
    arama.session = null
    const errCode = err && typeof err.code === 'string' ? err.code : ''
    if (errCode === 'channel_not_found' || errCode === 'call_ended') toast(() => t(role === 'caller' ? 'call.unanswered' : 'call.ended'), '', 8000)
    aramaSync()
  })
  aramaSync()
}

function aramaStartCamera () {
  if (!voice || typeof voice.startCamera !== 'function' || !camerasAllowed()) return
  const cam = radioCamera(snap())
  if (!cam.canUse || cam.state !== 'off') return
  Promise.resolve(voice.startCamera()).catch(() => {})
}

// Gelen aramayı kabul eder (kart veya konuşmanın arama bölümü). Kullanıcı hareketi içinde çağrılır. Görüntülü
// aramada Kabul Et kamerayı açar, Kamerasız Kabul Et (aramaAcceptVoice) yalnızca sesle katılır.
function aramaAccept () {
  aramaAnswer(true)
}

function aramaAcceptVoice () {
  aramaAnswer(false)
}

function aramaAnswer (withCamera) {
  const call = aramaIncoming()
  if (!call || !state.inApp) return
  if (dmEntry(call.dmId)) showDm(call.dmId, {})
  const st = dmSendState(call.userId)
  if (!st.ok) {
    const text = dmSendProblemText(st.reason, call.userId)
    arama.blocked = { key: aramaKey(call), text: text }
    toast(text, 'error', 8000)
    aramaSync()
    const decline = byId('call-incoming-decline')
    const card = byId('call-incoming')
    if (card && !card.hidden && decline) focusNode(decline)
    return
  }
  aramaJoin(call, 'callee', Boolean(withCamera && call.video))
  // Odak kabul düğmesindeyse konuşmanın arama bölümüne geçer
  nextFrame(() => {
    const target = byId('dm-call-mute') || byId('dm-call-hangup')
    const active = document.activeElement
    if (target && (!active || active === document.body)) focusNode(target)
  })
}

// Gelen aramayı reddeder. Kart hemen gizlenir, özel görünüm güncellenince arama kalkar.
function aramaDecline () {
  const call = aramaIncoming()
  if (!call) return
  arama.dismissed = aramaKey(call)
  aramaStopRing()
  aramaHideCard(false)
  aramaSync()
  api('POST', '/api/calls/decline', { dmId: call.dmId }).then((res) => {
    if (res.status !== 200 && state.inApp) toast(() => errorText(res, t('call.declineFailed')), 'error', 8000)
  })
}

// Aramayı bitirir (Aramayı Bitir ve telsiz kartındaki Ayrıl). Bu cihaz odadaysa odadan çıkmak yeter (sunucu aramayı
// bitirir ve karşı tarafı çıkarır), değilse (arama başka bir cihazınızda) arama sunucuda bitirilir.
function aramaHangup () {
  const ses = arama.session
  const call = aramaCall()
  const s = aramaSnap()
  if (ses) ses.local = true
  if (s && s.private && s.channelId !== null && s.channelId !== undefined) {
    if (voice) Promise.resolve(voice.leave()).catch(() => {})
    return
  }
  if (ses && !ses.joined) arama.session = null
  const dmId = ses ? ses.dmId : call ? call.dmId : null
  if (dmId === null) return
  api('POST', '/api/calls/decline', { dmId: dmId }).then((res) => {
    if (res.status !== 200 && state.inApp) toast(() => errorText(res, t('call.declineFailed')), 'error', 8000)
  })
  aramaSync()
}

// Aramanın sonu: kapatan bu cihaz değilse arayan için "Arama cevaplanmadı" (etkin olmadan bitti) veya "Arama sona
// erdi" yazar. Motor hâlâ odadaysa yerel olarak çıkılır.
function aramaFinish (ses, local) {
  if (arama.session !== ses) return
  arama.session = null
  if (!local && state.inApp) toast(() => t(!ses.active && ses.role === 'caller' ? 'call.unanswered' : 'call.ended'), '', 8000)
  const s = aramaSnap()
  if (voice && s && s.private && s.channelId !== null && s.channelId !== undefined && sameId(s.channelId, ses.dmId)) {
    Promise.resolve(voice.leave()).catch(() => {})
  }
}

// Ses motorunun hata kodu bu modülün metniyle bildirilecekse true (10-voice.js onVoiceChange ve telsiz kartı)
function aramaOwnsError (code) {
  const ses = arama.session
  return Boolean(ses && !ses.joined && (code === 'channel_not_found' || code === 'call_ended'))
}

// Özel görünüm değişti (14-social.js socialApplyPrivate)
function aramaOnPrivate () {
  const call = aramaCall()
  if (call && call.state === 'active' && (!arama.activeSince || arama.activeSince.key !== aramaKey(call))) {
    arama.activeSince = { key: aramaKey(call), at: Date.now() }
  }
  const ses = arama.session
  if (ses) {
    if (call && sameId(call.dmId, ses.dmId)) {
      ses.seen = true
      if (call.state === 'active') ses.active = true
    } else if (ses.seen || (ses.joined && Date.now() - ses.joinedAt > ARAMA_GONE_AFTER_MS)) {
      // Arama görünümden kalktı: karşı taraf reddetti, kapattı veya zil süresi doldu
      aramaFinish(ses, ses.local)
    }
  }
  const incoming = aramaIncoming()
  if (!incoming) arama.dismissed = ''
  if (arama.blocked && (!incoming || arama.blocked.key !== aramaKey(incoming))) arama.blocked = null
  aramaSync()
}

// Ses motorunun durumu değişti (10-voice.js onVoiceChange, sık çağrılır)
function aramaOnVoice (s) {
  const ses = arama.session
  if (ses) {
    const here = Boolean(s && s.private && s.channelId !== null && s.channelId !== undefined && sameId(s.channelId, ses.dmId))
    if (here && !s.joining && !ses.joined) {
      ses.joined = true
      ses.joinedAt = Date.now()
    }
    // Karşı tarafla bağlantı kurulduysa arama cevaplanmıştır (özel görünümün etkin durumu gecikse de)
    const peer = here && s.peers ? s.peers[String(ses.partnerId)] : null
    if (peer && peer.status === 'connected') ses.active = true
    if (!here && !(s && s.joining)) {
      // Odadan çıkıldı: başka bir odaya geçmek veya kendi kapatmak yereldir
      if (ses.joined) aramaFinish(ses, ses.local || Boolean(s && s.channelId !== null && s.channelId !== undefined))
      else if (ses.local) arama.session = null
    }
  }
  aramaSyncRing()
  aramaSyncCard()
}

// Zil, kart, başlık düğmeleri, bildirim ve konuşmanın arama bölümü
function aramaSync () {
  aramaSyncRing()
  aramaSyncCard()
  aramaNotify()
  if (state.inApp && socialState.view === 'dm') aramaApplyHeader()
  aramaRender()
}

// Zil

function aramaRingWanted () {
  const call = aramaIncoming()
  if (!state.inApp || !call) return null
  const status = typeof myChosenStatus === 'function' ? myChosenStatus() : 'online'
  return aramaShouldRing(call, aramaSnap(), status, arama.dismissed) ? call : null
}

function aramaSyncRing () {
  const call = aramaRingWanted()
  if (!call) {
    aramaStopRing()
    return
  }
  const key = aramaKey(call)
  // Süresi dolan zil aynı arama için yeniden başlamaz
  if (key === arama.ringDone) {
    aramaStopRing()
    return
  }
  if (arama.ringKey === key && arama.ringTimer) return
  const since = arama.ringKey === key ? arama.ringSince : Date.now()
  aramaStopRing()
  arama.ringKey = key
  arama.ringSince = since
  aramaRingTick()
}

function aramaRingTick () {
  arama.ringTimer = 0
  const call = aramaRingWanted()
  if (!call || aramaKey(call) !== arama.ringKey) return
  if (Date.now() - arama.ringSince > aramaRingLimit(call)) {
    arama.ringDone = arama.ringKey
    return
  }
  if (window.TelsizSesler && typeof window.TelsizSesler.play === 'function') {
    try {
      window.TelsizSesler.play('ring')
    } catch (err) {
      window.console.error(err)
    }
  }
  arama.ringTimer = setTimeout(aramaRingTick, ARAMA_RING_EVERY_MS)
}

function aramaStopRing () {
  clearTimeout(arama.ringTimer)
  arama.ringTimer = 0
}

// Sayfa gizliyken gelen arama için bir kez sistem bildirimi (bildirimler açık ve Rahatsız etmeyin seçili değilse,
// 14-social.js showNotification)
function aramaNotify () {
  const call = aramaIncoming()
  if (!call || !state.inApp || typeof document === 'undefined' || !document.hidden) return
  const key = aramaKey(call)
  if (arama.notified === key || typeof showNotification !== 'function') return
  arama.notified = key
  const name = userDisplayName(call.userId)
  const dmId = call.dmId
  showNotification(t('call.incomingTitle'), t(call.video ? 'call.incomingVideo' : 'call.incomingVoice', { name: name }), 'telsiz-call-' + dmId, () => {
    if (dmEntry(dmId)) showDm(dmId, {})
  })
}

// Gelen arama kartı

function aramaBindCard () {
  if (arama.bound) return
  const card = byId('call-incoming')
  if (!card) return
  arama.bound = true
  // Kart görününce odak kartın kendisine geçer (aramaSyncCard)
  card.tabIndex = -1
  const accept = byId('call-incoming-accept')
  const acceptVoice = byId('call-incoming-accept-voice')
  const decline = byId('call-incoming-decline')
  if (accept) accept.addEventListener('click', aramaAccept)
  if (acceptVoice) acceptVoice.addEventListener('click', aramaAcceptVoice)
  if (decline) decline.addEventListener('click', aramaDecline)
  // Esc yalnızca kartı gizler ve zili susturur: arama ne reddedilir ne kabul edilir
  card.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' && e.key !== 'Esc') return
    e.preventDefault()
    e.stopPropagation()
    const call = aramaIncoming()
    if (call) arama.dismissed = aramaKey(call)
    aramaStopRing()
    aramaHideCard(false)
  })
}

function aramaTyping (node) {
  if (typeof isTypingTarget === 'function') return isTypingTarget(node)
  const tag = node ? String(node.tagName || '').toLowerCase() : ''
  return tag === 'input' || tag === 'textarea' || Boolean(node && node.isContentEditable)
}

function aramaSyncCard () {
  const card = byId('call-incoming')
  if (!card) return
  aramaBindCard()
  const call = state.inApp ? aramaIncoming() : null
  const key = aramaKey(call)
  if (!call || key === arama.dismissed) {
    aramaHideCard(false)
    return
  }
  const name = userDisplayName(call.userId)
  const blocked = arama.blocked && arama.blocked.key === key ? arama.blocked.text : ''
  const info = typeof userAvatarInfo === 'function' ? userAvatarInfo(call.userId) : null
  // İçerik yalnızca bir şey değişince yeniden yazılır (bu işlev ses durumu her değiştiğinde çağrılır)
  const content = [key, name, blocked, call.video ? 1 : 0, info ? info.initial + info.colorIndex + (info.blobUrl || '') : '', document.documentElement.lang].join('|')
  const accept = byId('call-incoming-accept')
  const acceptVoice = byId('call-incoming-accept-voice')
  const decline = byId('call-incoming-decline')
  if (card.getAttribute('data-content') !== content) {
    card.setAttribute('data-content', content)
    const av = byId('call-incoming-avatar')
    if (av) {
      clear(av)
      const face = personAvatar(call.userId, 'lg')
      face.removeAttribute('data-status')
      av.appendChild(face)
    }
    setText(byId('call-incoming-text'), t(call.video ? 'call.incomingVideo' : 'call.incomingVoice', { name: name }))
    const note = byId('call-incoming-note')
    if (note) setMsg(note, blocked, 'error')
    if (accept) {
      if (blocked && document.activeElement === accept && decline) focusNode(decline)
      accept.hidden = Boolean(blocked)
    }
    if (acceptVoice) {
      const hide = Boolean(blocked) || !call.video
      if (hide && document.activeElement === acceptVoice && decline) focusNode(decline)
      acceptVoice.hidden = hide
    }
    card.setAttribute('data-video', call.video ? '1' : '0')
  }
  if (arama.cardKey === key && !card.hidden) return
  arama.cardKey = key
  card.hidden = false
  // Odak kartın kendisine geçer (ekran okuyucu kartı okur, Tab düğmelere götürür). Kabul düğmesine geçmez: o an
  // basılan Enter veya Boşluk aramayı kabul edip mikrofonu ve kamerayı açmamalı. Kullanıcı bir alana yazıyorsa
  // odağı alınmaz.
  const active = document.activeElement
  if (aramaTyping(active)) {
    arama.returnFocus = null
    return
  }
  arama.returnFocus = active && active !== document.body ? active : null
  focusNode(card)
}

// Kart gizlenir. Odak karttaysa önceki yerine döner (accepted: kabul edildi, odak arama bölümüne geçer).
function aramaHideCard (accepted) {
  const card = byId('call-incoming')
  arama.cardKey = ''
  if (!card || card.hidden) return
  card.removeAttribute('data-content')
  const active = document.activeElement
  const had = Boolean(active && card.contains(active))
  card.hidden = true
  const back = arama.returnFocus
  arama.returnFocus = null
  if (!had || accepted) return
  if (back && isConnected(back) && back.getClientRects().length && !back.closest('[hidden]')) focusNode(back)
}

// Konuşmanın arama bölümü (#dm-call)

function aramaTile (userId, stream, self, muted, keep) {
  const tile = h('div', 'call-tile' + (self ? ' is-self' : ' is-partner') + (stream ? ' has-video' : '') + (muted ? ' is-muted' : ''))
  tile.setAttribute('data-user-id', String(userId))
  const media = h('div', 'call-tile-media')
  const av = personAvatar(userId, 'xl')
  av.removeAttribute('data-status')
  av.classList.add('call-tile-avatar')
  media.appendChild(av)
  if (stream) {
    keep['call-' + userId] = true
    media.appendChild(cameraVideoFor('call-' + userId, stream, self))
  }
  tile.appendChild(media)
  const name = userDisplayName(userId)
  const cap = h('span', 'call-tile-name')
  if (muted) {
    const mark = icon('i-mic-off', 'call-tile-muted')
    cap.appendChild(mark)
  }
  cap.appendChild(h('span', 'call-tile-name-text', self ? t('radio.selfName', { name: name }) : name))
  tile.appendChild(cap)
  const states = []
  if (muted) states.push(t('voice.mutedState'))
  if (stream) states.push(t(self ? 'radio.stateSelfCamera' : 'radio.stateCamera'))
  tile.setAttribute('role', 'img')
  tile.setAttribute('aria-label', states.length ? t('voice.memberStates', { name: self ? t('radio.selfName', { name: name }) : name, states: states.join(', ') }) : (self ? t('radio.selfName', { name: name }) : name))
  return tile
}

// Dar ekranda yazı gizlenir (arama.css), erişilebilir ad ve ipucu kalır
function aramaControl (id, cls, text, iconName, label, onClick) {
  const b = button('call-control ' + cls, text, iconName, label || text)
  b.id = id
  b.setAttribute('data-focus-key', id)
  b.addEventListener('click', onClick)
  return b
}

function aramaRender () {
  const box = byId('dm-call')
  if (!box) return
  const call = aramaCall()
  const show = Boolean(state.inApp && state.me && socialState.view === 'dm' && call && sameId(call.dmId, state.channelId))
  if (!show) {
    if (!box.hidden || box.firstChild) {
      box.hidden = true
      clear(box)
    }
    arama.boxKey = ''
    arama.livePhase = ''
    pruneCameraVideos('call-', {})
    aramaStopClock()
    return
  }
  const s = snap()
  const phase = aramaPhase(call, s)
  const here = phase !== 'incoming' && phase !== 'elsewhere'
  const partner = call.userId
  const cam = radioCamera(s)
  const streams = here ? cameraStreams(s) : {}
  const partnerCam = streams[String(partner)]
  const partnerStream = partnerCam && !partnerCam.self ? partnerCam.stream : null
  const selfStream = here && cam.state === 'on' && cam.preview ? cam.preview : null
  const partnerEntry = call.members.filter((m) => sameId(m.userId, partner))[0]
  const partnerMuted = Boolean(partnerEntry && (partnerEntry.muted || partnerEntry.deafened))
  const selfMuted = here && Boolean(s.muted)
  const st = phase === 'incoming' ? dmSendState(partner) : { ok: true }
  const blocked = phase === 'incoming' ? (arama.blocked && arama.blocked.key === aramaKey(call) ? arama.blocked.text : '') : ''
  const avatarKey = (id) => {
    const info = typeof userAvatarInfo === 'function' ? userAvatarInfo(id) : null
    return info ? info.initial + info.colorIndex + (info.blobUrl || '') : ''
  }
  const key = [phase, String(partner), call.video ? 1 : 0, selfStream ? selfStream.id : '', partnerStream ? partnerStream.id : '', selfMuted ? 1 : 0, partnerMuted ? 1 : 0,
    cam.state, cam.canUse ? 1 : 0, cam.canSwitch ? 1 : 0, cam.switching ? 1 : 0, cam.facing || '', camerasAllowed() ? 1 : 0, st.ok ? '' : st.reason, blocked, userDisplayName(partner), userDisplayName(state.me.id),
    avatarKey(partner), avatarKey(state.me.id), document.documentElement.lang].join('|')
  if (key !== arama.boxKey || box.hidden) {
    arama.boxKey = key
    const focusKey = activeFocusKey(box)
    clear(box)
    box.hidden = false
    box.setAttribute('data-phase', phase)
    box.setAttribute('aria-label', t('call.areaLabel', { name: userDisplayName(partner) }))
    const head = h('div', 'dm-call-head')
    head.appendChild(icon(call.video ? 'i-camera' : 'i-phone', 'dm-call-kind-icon'))
    head.appendChild(h('span', 'dm-call-kind', t(call.video ? 'call.videoKind' : 'call.voiceKind')))
    const stateText = h('span', 'dm-call-state')
    stateText.id = 'dm-call-state'
    head.appendChild(stateText)
    box.appendChild(head)
    const keep = {}
    const stage = h('div', 'dm-call-stage')
    stage.appendChild(aramaTile(partner, partnerStream, false, partnerMuted, keep))
    stage.appendChild(aramaTile(state.me.id, selfStream, true, selfMuted, keep))
    box.appendChild(stage)
    pruneCameraVideos('call-', keep)
    const hardBlock = phase === 'incoming' && (blocked || (!st.ok && st.reason !== 'loading'))
    if (hardBlock) {
      const note = h('p', 'dm-call-note', blocked || dmSendProblemText(st.reason, partner))
      note.id = 'dm-call-note'
      box.appendChild(note)
    }
    const row = h('div', 'dm-call-controls')
    if (phase === 'incoming') {
      if (!hardBlock && call.video) row.appendChild(aramaControl('dm-call-accept-voice', 'is-accept-voice', t('call.acceptVoice'), 'i-camera-off', '', aramaAcceptVoice))
      if (!hardBlock) row.appendChild(aramaControl('dm-call-accept', 'is-accept', t('call.accept'), 'i-phone', '', aramaAccept))
      row.appendChild(aramaControl('dm-call-decline', 'is-danger', t('call.decline'), 'i-hangup', '', aramaDecline))
    } else if (phase === 'elsewhere') {
      row.appendChild(aramaControl('dm-call-hangup', 'is-danger', t('call.hangup'), 'i-hangup', '', aramaHangup))
    } else {
      const mute = aramaControl('dm-call-mute', 'is-mic' + (selfMuted ? ' is-off' : ''), t('call.mic'), selfMuted ? 'i-mic-off' : 'i-mic', '', toggleMute)
      mute.setAttribute('aria-pressed', selfMuted ? 'true' : 'false')
      mute.setAttribute('aria-label', t('user.mute'))
      row.appendChild(mute)
      const camOn = cam.state === 'on'
      const usable = Boolean(cam.canUse) && camerasAllowed() && !s.joining
      const camBtn = aramaControl('dm-call-camera', 'is-camera' + (camOn ? ' is-live' : ''), t('call.camera'), cam.canUse && camerasAllowed() ? 'i-camera' : 'i-camera-off', '', onCameraButton)
      camBtn.setAttribute('aria-pressed', camOn ? 'true' : 'false')
      camBtn.setAttribute('aria-label', t(camOn ? 'camera.stop' : 'camera.start'))
      if (!usable && !camOn) {
        camBtn.classList.add('is-disabled')
        camBtn.setAttribute('aria-disabled', 'true')
        const why = !cam.canUse ? cameraErrorText(cam.reason || 'camera_unsupported', '') : !camerasAllowed() ? t('camera.errors.camera_disabled') : t('call.connecting')
        camBtn.title = why
        camBtn.setAttribute('aria-label', t('call.unavailableLabel', { action: t('camera.start'), reason: why }))
      }
      row.appendChild(camBtn)
      // Kamerayı Çevir (10-voice.js renderCameraFlip ile aynı kural): kamera açık ve birden çok kamera varken
      if (camOn && cam.canSwitch) {
        const flip = aramaControl('dm-call-camera-flip', 'is-flip', t('camera.flipShort'), 'i-camera-flip', t('camera.flip'), onCameraFlip)
        if (cam.switching) flip.setAttribute('aria-disabled', 'true')
        flip.title = t('camera.flipHint')
        row.appendChild(flip)
      }
      row.appendChild(aramaControl('dm-call-hangup', 'is-danger', t('call.hangup'), 'i-hangup', '', aramaHangup))
    }
    box.appendChild(row)
    restoreFocusKey(box, focusKey)
  }
  aramaUpdateStatus(phase, call)
}

// Durum satırı ve ekran okuyucu bildirimi (yalnızca aşama değişince). Etkin aramada süre saniyede bir güncellenir.
function aramaUpdateStatus (phase, call) {
  setText(byId('dm-call-state'), aramaStatusText(phase, call, aramaElapsed(call)))
  if (phase !== arama.livePhase) {
    arama.livePhase = phase
    const live = byId('dm-call-live')
    if (live) {
      let text = aramaStatusText(phase, call, 0)
      if (phase === 'active') text = t('call.connected')
      if (phase === 'incoming') text = t(call.video ? 'call.incomingVideo' : 'call.incomingVoice', { name: userDisplayName(call.userId) })
      setText(live, text)
    }
  }
  if (phase === 'active') aramaStartClock()
  else aramaStopClock()
}

function aramaStartClock () {
  if (arama.clockTimer) return
  arama.clockTimer = setInterval(() => {
    const call = aramaCall()
    const node = byId('dm-call-state')
    if (!call || !node) {
      aramaStopClock()
      return
    }
    setText(node, aramaStatusText('active', call, aramaElapsed(call)))
  }, 1000)
}

function aramaStopClock () {
  if (!arama.clockTimer) return
  clearInterval(arama.clockTimer)
  arama.clockTimer = 0
}

// Konuşan kişinin kutusunda hale (10-voice.js updateVoiceLive)
function aramaLive (s) {
  const box = byId('dm-call')
  if (!box || box.hidden) return
  Array.from(box.querySelectorAll('.call-tile[data-user-id]')).forEach((tile) => {
    tile.classList.toggle('is-speaking', Boolean(s && s.private && speakingIn(s, tile.getAttribute('data-user-id'))))
  })
}

// Oturum kapanınca (03-auth.js resetAppState)
function aramaReset () {
  aramaStopRing()
  arama.ringKey = ''
  arama.ringDone = ''
  aramaStopClock()
  aramaHideCard(false)
  arama.session = null
  arama.starting = null
  arama.dismissed = ''
  arama.blocked = null
  arama.notified = ''
  arama.activeSince = null
  arama.boxKey = ''
  arama.livePhase = ''
  const box = byId('dm-call')
  if (box) {
    box.hidden = true
    clear(box)
  }
  const live = byId('dm-call-live')
  if (live) live.textContent = ''
  if (typeof pruneCameraVideos === 'function') pruneCameraVideos('call-', {})
}
