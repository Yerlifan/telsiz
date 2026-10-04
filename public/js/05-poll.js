'use strict'

// Long-poll döngüsü, olayların, kişiye özel metanın (private, pmv) ve yazıyor bilgisinin (typing, tv)
// işlenmesi, anma sayaçları, masaüstü bildirimi ve mesaj sesi (bildirim düzeyi ve Rahatsız etmeyin
// kuralıyla) ve görünürlük değişimi.

// Long-poll döngüsü. Her başlatmada nesil sayacı artar,
// eski döngüler bir sonraki adımda sessizce sonlanır.

function startPoll () {
  stopPoll()
  pollLoop(state.pollGen)
}

function stopPoll () {
  state.pollGen += 1
  const pending = state.activePoll
  state.activePoll = null
  if (pending) pending.abort()
}

function setConnLost (lost) {
  if (state.connLost === lost) return
  state.connLost = lost
  el.connBanner.hidden = !lost
  if (lost && typeof typingOnConnLost === 'function') typingOnConnLost()
}

function retryDelay (failures) {
  return Math.min(10, Math.pow(2, failures - 1)) * 1000
}

async function pollLoop (generation) {
  let failures = 0
  while (generation === state.pollGen && state.token) {
    const path = '/api/poll?since=' + encodeURIComponent(state.seq) +
      '&mv=' + encodeURIComponent(state.metaVersion) +
      '&pmv=' + encodeURIComponent(socialPmv()) +
      // tv yalnızca yazıyor modülü yüklüyse gönderilir (tv yanıtı işlenmezse poll hemen dönmeye devam ederdi)
      (typeof typingPollParam === 'function' ? '&tv=' + encodeURIComponent(typingPollParam()) : '') +
      '&sig=' + encodeURIComponent(state.sigSeq) +
      '&boot=' + encodeURIComponent(state.boot)
    const pending = api('GET', path, null, { timeout: POLL_TIMEOUT_MS })
    state.activePoll = pending
    const res = await pending
    if (generation !== state.pollGen) return
    state.activePoll = null
    if (res.status === 200 && res.data) {
      failures = 0
      setConnLost(false)
      try {
        handlePoll(res.data)
      } catch (err) {
        // Beklenmeyen bir çizim hatası döngüyü durdurmamalı
        window.console.error(err)
      }
      continue
    }
    if (res.status === 401 || (res.status === 403 && res.data && res.data.code === 'banned')) return
    failures += 1
    setConnLost(true)
    await wait(retryDelay(failures))
  }
}

function handlePoll (data) {
  const bootChanged = typeof data.boot === 'string' && data.boot !== state.boot
  if (bootChanged || data.resync === true) {
    if (bootChanged) state.sigSeq = 0
    state.boot = String(data.boot || state.boot)
    state.seq = Number(data.seq) || 0
    state.metaVersion = Number(data.metaVersion) || 0
    if (data.meta) applyMetaUpdate(data.meta)
    if (data.private) socialApplyPrivate(data.private, Number(data.pmv) || 0)
    if (typeof typingApply === 'function') typingApply(data)
    // Olay kaybı olmuş olabilir: arama dizini konuşmaların en yeni kısmını yeniden denetler
    if (typeof searchOnResync === 'function') searchOnResync()
    handleSignals(data.signals)
    if (state.channelId) loadChannel()
    return
  }
  if (data.meta) {
    state.metaVersion = Number(data.metaVersion) || state.metaVersion
    applyMetaUpdate(data.meta)
  }
  if (data.private) socialApplyPrivate(data.private, Number(data.pmv) || 0)
  if (typeof typingApply === 'function') typingApply(data)
  const events = Array.isArray(data.events) ? data.events : []
  events.forEach((ev) => {
    if (!ev || typeof ev !== 'object') return
    try {
      applyEvent(ev)
    } catch (err) {
      window.console.error(err)
    }
  })
  if (typeof data.seq === 'number' && data.seq >= 0) state.seq = data.seq
  handleSignals(data.signals)
}

// Meta uygulama. Ana sayfa ve özel mesaj görünümünde applyMeta kanal seçimine dokunmaz (görünüm modu
// conversationMode ile okunur), ardından profiller ve kimlik bağlaması güncellenir.
function applyMetaUpdate (meta) {
  const prevKid = activeKid()
  applyMeta(meta, false)
  socialAfterMeta(prevKid)
}

function handleSignals (signals) {
  if (!Array.isArray(signals) || !signals.length) return
  let max = state.sigSeq
  signals.forEach((s) => {
    if (s && typeof s.seq === 'number' && s.seq > max) max = s.seq
  })
  state.sigSeq = max
  if (voice) {
    try {
      voice.handleSignals(signals)
    } catch (err) {
      window.console.error(err)
    }
  }
}

function applyEvent (ev) {
  // Arama dizini taranmış konuşmalardaki yeni, düzenlenen ve silinen mesajları izler
  if (typeof searchOnEvent === 'function') {
    try {
      searchOnEvent(ev)
    } catch (err) {
      window.console.error(err)
    }
  }
  const inCurrent = sameId(ev.channelId, state.channelId)
  if (inCurrent && state.loading) {
    state.pendingEvents.push(ev)
    return
  }
  if (ev.type === 'msg' && ev.message) {
    onIncomingMessage(ev.message, inCurrent)
  } else if (ev.type === 'edit' && ev.message) {
    if (inCurrent) replaceMessage(ev.message)
  } else if (ev.type === 'del') {
    if (inCurrent) removeMessage(ev.messageId)
  }
}

function isDmMessage (message) {
  return isDmChannel(message.channelId) || (typeof message.body === 'string' && message.body.slice(0, 2) === '2.')
}

function onIncomingMessage (message, inCurrent) {
  const mine = state.me && sameId(message.authorId, state.me.id)
  const dm = isDmMessage(message)
  if (inCurrent) {
    insertMessage(message, { own: mine })
    if (!document.hidden) markRead()
  } else if (!mine) {
    state.unread[message.channelId] = (state.unread[message.channelId] || 0) + 1
    if (dm) {
      renderDmList()
      renderHomeEntry()
    } else {
      // Beni anan mesaj kanal listesinde ayrı rozet ve Ana sayfa toplamında sayılır (18-mentions.js)
      const counted = typeof mentionOnIncoming === 'function' && mentionOnIncoming(message)
      if (!counted) renderChannels()
    }
  }
  if (!mine && document.hidden) {
    state.hiddenUnread += 1
    updateTitle()
    alertMessage(message)
  }
}

// Sayfa gizliyken gelen mesaj: bildirim düzeyi ('all', 'mentions', 'none'), engel ve Rahatsız etmeyin
// kuralına uyan mesajda masaüstü bildirimi (açıksa) ve mesaj sesi (açıksa). İki ayar bağımsızdır.
function alertMessage (message) {
  const allowed = typeof messageAlertAllowed === 'function' ? messageAlertAllowed(message) : myChosenStatus() !== 'dnd'
  if (!allowed) return
  notifyMessage(message)
  if (typeof playMessageSound === 'function') {
    try {
      playMessageSound()
    } catch (err) {
      window.console.error(err)
    }
  }
}

// Masaüstü bildirimi. Varsayılan kapalı, ayarlardan açılır. Rahatsız etmeyin durumunda verilmez.

function notificationsEnabled () {
  return storeGet(KEYS.notify) === '1' && typeof window.Notification === 'function' && window.Notification.permission === 'granted'
}

function notificationsAllowedNow () {
  return notificationsEnabled() && myChosenStatus() !== 'dnd'
}

function notifyMessage (message) {
  if (!notificationsAllowedNow()) return
  const dm = isDmMessage(message)
  if (!dm && isBlocked(message.authorId)) return
  const result = decryptMessage(message)
  let text = ''
  if (result.state === 'ok') {
    text = result.text ? cpSlice(result.text, 100) : (result.files.length ? t(result.files[0].kind === 'image' ? 'notify.photo' : 'notify.file') : '')
  } else if (result.state === 'no_key' || result.state === 'dm_locked' || result.state === 'dm_unverified' || result.state === 'dm_old_key') {
    text = t('notify.encrypted')
  } else {
    return
  }
  const name = userDisplayName(message.authorId)
  const channelId = message.channelId
  const title = dm ? name : state.serverName
  const body = dm ? text : t('notify.body', { name: name, text: text })
  showNotification(title, body, 'telsiz-' + (dm ? 'dm-' : '') + channelId, () => {
    if (dm) {
      if (dmEntry(channelId)) showDm(channelId, {})
    } else if (findChannel(channelId)) {
      selectChannel(channelId, {})
    }
  })
}

function onVisibilityChange () {
  if (document.hidden) return
  state.hiddenUnread = 0
  updateTitle()
  if (state.inApp) {
    markRead()
    if (state.connLost) startPoll()
  }
}
