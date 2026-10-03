'use strict'

// Long-poll döngüsü, olayların işlenmesi, masaüstü bildirimi ve görünürlük değişimi.

// Long-poll döngüsü (5.3). Her başlatmada nesil sayacı artar,
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
}

function retryDelay (failures) {
  return Math.min(10, Math.pow(2, failures - 1)) * 1000
}

async function pollLoop (generation) {
  let failures = 0
  while (generation === state.pollGen && state.token) {
    const path = '/api/poll?since=' + encodeURIComponent(state.seq) +
      '&mv=' + encodeURIComponent(state.metaVersion) +
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
    if (data.meta) applyMeta(data.meta, false)
    handleSignals(data.signals)
    if (state.channelId) loadChannel()
    return
  }
  if (data.meta) {
    state.metaVersion = Number(data.metaVersion) || state.metaVersion
    applyMeta(data.meta, false)
  }
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

function onIncomingMessage (message, inCurrent) {
  const mine = state.me && sameId(message.authorId, state.me.id)
  if (inCurrent) {
    insertMessage(message, { own: mine })
    if (!document.hidden) markRead()
  } else if (!mine) {
    state.unread[message.channelId] = (state.unread[message.channelId] || 0) + 1
    renderChannels()
  }
  if (!mine && document.hidden) {
    state.hiddenUnread += 1
    updateTitle()
    notifyMessage(message)
  }
}

// Masaüstü bildirimi (5.5). Varsayılan kapalı, ayarlardan açılır.

function notificationsEnabled () {
  return storeGet(KEYS.notify) === '1' && typeof window.Notification === 'function' && window.Notification.permission === 'granted'
}

function notifyMessage (message) {
  if (!notificationsEnabled()) return
  const result = decryptMessage(message)
  let text = ''
  if (result.state === 'ok') {
    text = result.text ? cpSlice(result.text, 100) : (result.files.length ? t(result.files[0].kind === 'image' ? 'notify.photo' : 'notify.file') : '')
  } else if (result.state === 'no_key') {
    text = t('notify.encrypted')
  } else {
    return
  }
  const body = t('notify.body', { name: userName(message.authorId), text: text })
  const title = state.serverName
  try {
    const n = new window.Notification(title, { body: body, tag: 'telsiz-' + message.channelId })
    n.onclick = () => {
      try {
        window.focus()
      } catch (err) {
        // Pencere öne alınamadı
      }
      if (findChannel(message.channelId)) selectChannel(message.channelId, {})
      n.close()
    }
  } catch (err) {
    // Bazı mobil tarayıcılar yalnızca service worker üzerinden bildirim gösterir
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then((reg) => {
        if (reg && typeof reg.showNotification === 'function') reg.showNotification(title, { body: body, tag: 'telsiz-' + message.channelId })
      }).catch(() => {})
    }
  }
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
