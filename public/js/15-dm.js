'use strict'

// Özel mesajlar: konuşma listesi (#dm-list), konuşma açma, özel mesaj görünümü (#dm-header,
// #key-warning, kanallarla aynı mesaj listesi ve yazma alanı), kişisel anahtarlarla şifreleme ve
// çözme, gönderme koşulları (karşı tarafın doğrulanmış ve kabul edilmiş anahtarı), anahtar değişti
// şeridi, güvenlik numarası penceresi ve okunmamış sayaçlar.

const dmState = {
  activeId: null,
  partnerId: null,
  scanGen: 0
}

function dmEntries () {
  return priv().dms
}

function dmEntry (channelId) {
  if (channelId === null || channelId === undefined) return null
  return dmEntries().filter((d) => sameId(d.id, channelId))[0] || null
}

function isDmChannel (channelId) {
  if (channelId === null || channelId === undefined) return false
  if (dmEntry(channelId)) return true
  return socialState.view === 'dm' && sameId(channelId, dmState.activeId)
}

function dmPartner (channelId) {
  const entry = dmEntry(channelId)
  if (entry) return entry.userId
  if (sameId(channelId, dmState.activeId)) return dmState.partnerId
  return null
}

// Konuşma listesi (Özel istasyonunun sol kartı, #dm-list, KONSEPT 6.3): son mesaja göre yeniden eskiye. Satırda
// yumuşak kare avatar ve durum noktası, ad, alt satırda bulunduğu ses odası veya durumu ve son mesaj saati,
// okunmamış rozeti. Açık olan konuşma aria-current taşır. Aynı konuşmalar Tümü sayfasında da satırdır
// (04-meta.js buildSheetDmRow alt satırı dmRowSub ile çizer).

// Son mesaj zamanı: bugünse saat, dünse "dün", daha eskiyse tarih
function dmWhen (ts) {
  const date = toDate(ts)
  const now = new Date()
  if (sameDay(date, now)) return formatClock(date.getTime())
  if (sameDay(date, new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))) return t('people.yesterday')
  return window.I18N.formatDate(date.getTime(), 'date')
}

function dmRowParts (d) {
  const status = userStatus(d.userId)
  const blocked = isBlocked(d.userId)
  const room = !blocked && status !== 'offline' && typeof voiceChannelOf === 'function' ? voiceChannelOf(d.userId) : null
  let text = statusLabel(status)
  if (blocked) text = t('social.blockedSub')
  else if (room) text = t('people.inVoice', { name: room.name })
  return { status: status, room: room, text: text, when: d.lastMessageAt ? dmWhen(d.lastMessageAt) : '' }
}

function dmRowSub (d) {
  const parts = dmRowParts(d)
  return parts.when ? t('people.pair', { a: parts.text, b: parts.when }) : parts.text
}

function renderDmList () {
  const list = byId('dm-list')
  if (!list) return
  const focusKey = activeFocusKey(list)
  clear(list)
  if (!state.me) return
  const entries = dmEntries().slice().sort((a, b) => (b.lastMessageAt || 0) - (a.lastMessageAt || 0))
  entries.forEach((d) => {
    const li = h('li', 'dm-row')
    const b = h('button', 'dm-item')
    b.type = 'button'
    b.setAttribute('data-channel-id', String(d.id))
    b.setAttribute('data-user-id', String(d.userId))
    b.setAttribute('data-focus-key', 'dm-' + d.id)
    const parts = dmRowParts(d)
    b.setAttribute('data-status', parts.status)
    b.appendChild(personAvatar(d.userId, 'md'))
    const name = userDisplayName(d.userId)
    const text = h('span', 'dm-text')
    text.appendChild(h('span', 'dm-name', name))
    const sub = h('span', 'dm-sub')
    const lead = h('span', parts.room ? 'dm-sub-text dm-voice-tag' : 'dm-sub-text')
    if (parts.room) lead.appendChild(icon('i-speaker'))
    lead.appendChild(h('span', '', parts.text))
    sub.appendChild(lead)
    if (parts.when) sub.appendChild(h('span', 'dm-sub-time', parts.when))
    text.appendChild(sub)
    b.appendChild(text)
    const count = state.unread[d.id] || 0
    const current = socialState.view === 'dm' && sameId(d.id, state.channelId)
    if (current) {
      b.setAttribute('aria-current', 'page')
      b.classList.add('is-active')
    }
    if (isBlocked(d.userId)) b.classList.add('is-blocked')
    const label = count > 0 && !current ? t('dm.itemUnreadLabel', { name: name, count: count }) : t('dm.itemLabel', { name: name })
    if (count > 0 && !current) {
      b.classList.add('is-unread')
      const badge = h('span', 'unread-badge station-mark mark-mention', count > 99 ? '99+' : String(count))
      badge.setAttribute('aria-hidden', 'true')
      b.appendChild(badge)
    }
    b.setAttribute('aria-label', t('people.pair', { a: label, b: dmRowSub(d) }))
    if (d.lastMessageAt) b.title = t('dm.lastMessageAt', { date: formatLong(d.lastMessageAt) })
    b.addEventListener('click', () => {
      showDm(d.id, { focus: true })
    })
    li.appendChild(b)
    list.appendChild(li)
  })
  if (!entries.length) list.appendChild(h('li', 'empty-row dm-empty hint', t('dm.empty')))
  restoreFocusKey(list, focusKey)
  const hint = dmHintEl()
  if (hint) hint.textContent = t('people.dmHint')
}

// Kartın altındaki ipucu: yeni özel konuşma profil kartından veya Arkadaşlar istasyonundan başlar
function dmHintEl () {
  const section = byId('dm-section')
  if (!section) return null
  let hint = byId('dm-hint')
  if (!hint) {
    hint = h('p', 'hint dm-hint')
    hint.id = 'dm-hint'
    section.appendChild(hint)
  }
  return hint
}

// Konuşmayı açar (yoksa sunucuda oluşturur) ve görünüme geçer
async function openDmWith (userId) {
  if (!state.inApp || userId === null || userId === undefined) return false
  const existing = dmEntries().filter((d) => sameId(d.userId, userId))[0]
  if (existing) {
    showDm(existing.id, { focus: true })
    return true
  }
  const res = await api('POST', '/api/dms/open', { userId: Number(userId) })
  if (res.status === 200 && res.data && res.data.dm && res.data.dm.id !== undefined) {
    const dm = res.data.dm
    if (!dmEntry(dm.id)) {
      const p = priv()
      p.dms = [{ id: dm.id, userId: dm.userId, lastMessageId: null, lastMessageAt: Date.now() }].concat(p.dms)
      socialState.priv = p
    }
    showDm(dm.id, { focus: true })
    return true
  }
  toast(() => errorText(res, t('dm.openFailed')), 'error')
  return false
}

function showDm (dmId, opts) {
  const entry = dmEntry(dmId)
  if (!entry || !state.inApp) return
  const options = opts || {}
  closeDrawers()
  if (socialState.view === 'dm' && sameId(state.channelId, entry.id) && !options.force) {
    if (options.focus && !isNarrow() && !el.composerInput.disabled) focusNode(el.composerInput)
    return
  }
  cancelEdit()
  closeMessageMenu()
  dmState.activeId = entry.id
  dmState.partnerId = entry.userId
  state.channelId = entry.id
  state.unread[entry.id] = 0
  setConversationMode('dm')
  renderChannels()
  renderDmList()
  renderHomeEntry()
  profilesEnsure([entry.userId])
  dmRefreshChrome()
  loadChannel()
  if (options.focus && isWide() && !el.composerInput.disabled) focusNode(el.composerInput)
}

// Gönderme koşulu: bu cihazda kimlik açık, kişi engelli değil ve hesabı duruyor, kişinin anahtarı
// grup anahtarıyla bağlanmış (doğrulanmış) ve değişmişse kabul edilmiş olmalı.
function dmSendState (partnerId) {
  if (partnerId === null || partnerId === undefined) return { ok: false, reason: 'gone' }
  if (!myIdentity()) return { ok: false, reason: 'locked' }
  if (isBlocked(partnerId)) return { ok: false, reason: 'blocked' }
  const rec = profileRecord(partnerId)
  if (!metaUser(partnerId) || (rec && rec.missing)) return { ok: false, reason: 'gone' }
  if (!rec) return { ok: false, reason: 'loading' }
  if (rec.keyState !== 'ok') return { ok: false, reason: 'unverified' }
  let pin = null
  try {
    pin = window.E2EE.pins.get(state.me.id, partnerId)
  } catch (err) {
    pin = null
  }
  if (pin && pin.status === 'changed') return { ok: false, reason: 'changed' }
  return { ok: true, pk: rec.publicKey, verified: Boolean(pin && pin.verified) }
}

function dmSendProblemText (reason, partnerId) {
  if (reason === 'locked') return t('dm.locked')
  if (reason === 'blocked') return t('dm.blockedNotice')
  if (reason === 'gone') return t('dm.userGone')
  if (reason === 'loading') return t('dm.keyLoading')
  if (reason === 'changed') return t('dm.sendLockedChanged', { name: userDisplayName(partnerId) })
  return t('dm.keyUnverified')
}

// Açık özel mesajın yazma alanı için anahtar hazır mı
function dmReady () {
  return dmSendState(dmPartner(state.channelId)).ok
}

// Yazı kanalı veya özel mesaj fark etmeksizin geçerli konuşmada gönderilebilir mi
function conversationKeyReady () {
  if (!state.channelId) return false
  if (isDmChannel(state.channelId)) return dmReady()
  return hasActiveKey()
}

function conversationProblemText () {
  if (isDmChannel(state.channelId)) {
    const partner = dmPartner(state.channelId)
    return dmSendProblemText(dmSendState(partner).reason, partner)
  }
  return t('composer.keyNeeded')
}

// Özel mesaj zarfı: karşı tarafın doğrulanmış anahtarı ve kendi özel anahtarımla
function dmSealBody (obj, channelId) {
  const partner = dmPartner(channelId)
  const st = dmSendState(partner)
  if (!st.ok) throw textError(() => dmSendProblemText(st.reason, partner))
  const pair = myIdentity()
  return window.E2EE.dm.seal(obj, st.pk, pair.secretKey)
}

// Çözme: karşı tarafın sabitlenmiş anahtarları (en yeniden eskiye) ve kendi mevcut anahtarım.
// Yazar ve konuşma kimliği düz metindeki a ve c alanlarıyla eşleşmelidir.
function decryptDmMessage (m) {
  const pair = myIdentity()
  if (!pair) return { state: 'dm_locked' }
  let partner = dmPartner(m.channelId)
  if ((partner === null || partner === undefined) && state.me && !sameId(m.authorId, state.me.id)) partner = m.authorId
  if (partner === null || partner === undefined) return { state: 'dm_old_key' }
  let candidates = []
  try {
    candidates = window.E2EE.pins.knownKeys(state.me.id, partner)
  } catch (err) {
    candidates = []
  }
  if (!candidates.length) return { state: 'dm_unverified' }
  const opened = window.E2EE.dm.open(m.body, candidates, pair.secretKey)
  if (!opened || opened.ok !== true) {
    const reason = opened ? opened.reason : 'bad_data'
    if (reason === 'bad_format') return { state: 'bad_format' }
    if (reason === 'no_key') return { state: 'dm_old_key' }
    return { state: 'unverified' }
  }
  const v = opened.value
  if (!v || typeof v !== 'object' || v.v !== 1 || !sameId(v.a, m.authorId) || !sameId(v.c, m.channelId)) return { state: 'unverified' }
  return { state: 'ok', text: typeof v.t === 'string' ? v.t : '', files: normalizeFiles(v.f, m) }
}

// Özel mesaj görünümünün başlığı, uyarı şeridi ve yazma alanı durumu

function dmNoticeEl () {
  let node = byId('dm-notice')
  if (!node && el.composer) {
    node = h('div', 'composer-hint dm-notice')
    node.id = 'dm-notice'
    node.setAttribute('role', 'status')
    node.hidden = true
    el.composer.insertBefore(node, el.composerForm || null)
  }
  return node
}

function dmRefreshChrome () {
  if (socialState.view !== 'dm' || !state.me) return
  const partner = dmPartner(state.channelId)
  const name = partner === null ? '' : userDisplayName(partner)
  renderDmHeader(partner, name)
  const st = dmSendState(partner)
  renderKeyWarning(partner, name, st)
  const enabled = st.ok
  el.composerInput.disabled = !enabled
  el.btnPhoto.disabled = !enabled
  el.btnFile.disabled = !enabled
  el.btnEmoji.disabled = !enabled
  el.composerHint.hidden = true
  if (el.keyState) el.keyState.hidden = true
  el.composerInput.setAttribute('placeholder', t(isNarrow() ? 'dm.placeholderShort' : 'dm.placeholder', { name: name }))
  if (el.channelStartTitle) el.channelStartTitle.textContent = t('dm.start', { name: name })
  // Konuşma başlangıcında kanal simgesi yerine karşı tarafın büyük avatarı
  if (partner !== null && typeof renderStartIcon === 'function') renderStartIcon(partner)
  const notice = dmNoticeEl()
  if (notice) {
    clear(notice)
    notice.hidden = enabled || st.reason === 'changed'
    if (!enabled) {
      notice.setAttribute('data-reason', st.reason)
      notice.appendChild(icon('i-lock'))
      notice.appendChild(h('span', 'dm-notice-text', dmSendProblemText(st.reason, partner)))
      if (st.reason === 'locked') {
        const unlock = button('button button-small dm-unlock', t('identity.unlockSubmit'))
        unlock.addEventListener('click', () => {
          openIdentityUnlock(unlock)
        })
        notice.appendChild(unlock)
      } else if (st.reason === 'blocked') {
        const unblock = button('button button-small button-secondary dm-unblock', t('social.unblock'))
        unblock.addEventListener('click', () => {
          unblockUser(partner)
        })
        notice.appendChild(unblock)
      }
    }
  }
  updateSendState()
}

// Özel mesaj başlığı (KONSEPT 6.4): kişinin avatarı ve durum noktası (profil kartını açar), ad, "@ad · durum ·
// özel mesaj", güvenlik numarası rozeti (doğrulandıysa "Doğrulandı", değilse uyarı renginde "Doğrulanmadı",
// basınca güvenlik numarası penceresi) ve Profil düğmesi.
function renderDmHeader (partner, name) {
  const header = byId('dm-header')
  if (!header) return
  const focusKey = activeFocusKey(header)
  clear(header)
  if (partner === null) return
  const status = userStatus(partner)
  const av = h('span', 'avatar-wrap dm-header-avatar')
  av.setAttribute('data-status', status)
  av.appendChild(personAvatar(partner, 'md'))
  makeUserLink(av, partner)
  av.setAttribute('aria-label', t('dm.profileLabel', { name: name }))
  av.setAttribute('data-focus-key', 'dmh-avatar')
  header.appendChild(av)
  const text = h('span', 'dm-header-text')
  const title = h('h2', 'dm-header-name', name)
  title.id = 'dm-header-name'
  text.appendChild(title)
  const sub = h('span', 'dm-header-sub')
  const handle = userHandle(partner)
  if (handle) sub.appendChild(h('span', 'dm-header-handle', handle))
  const room = status !== 'offline' && typeof voiceChannelOf === 'function' ? voiceChannelOf(partner) : null
  sub.appendChild(h('span', 'dm-header-status', isBlocked(partner) ? t('social.blockedSub') : room ? t('people.inVoice', { name: room.name }) : statusLabel(status)))
  sub.appendChild(h('span', 'dm-header-kind', t('people.dmKind')))
  text.appendChild(sub)
  header.appendChild(text)
  let pin = null
  try {
    pin = window.E2EE.pins.get(state.me.id, partner)
  } catch (err) {
    pin = null
  }
  const verified = Boolean(pin && pin.verified && pin.status !== 'changed')
  const safety = h('button', 'pill dm-safety ' + (verified ? 'dm-verified' : 'dm-unverified'))
  safety.type = 'button'
  safety.id = 'dm-safety-button'
  safety.setAttribute('aria-haspopup', 'dialog')
  safety.setAttribute('data-focus-key', 'dmh-safety')
  safety.setAttribute('aria-label', t(verified ? 'people.safetyVerifiedLabel' : 'people.safetyUnverifiedLabel', { name: name }))
  safety.title = t(verified ? 'dm.verified' : 'people.safetyUnverifiedTitle')
  safety.appendChild(icon(verified ? 'i-verified' : 'i-shield'))
  safety.appendChild(h('span', 'pill-text', t(verified ? 'people.verified' : 'people.unverified')))
  safety.addEventListener('click', () => {
    openSafetyDialog(safety)
  })
  header.appendChild(safety)
  const profile = button('button button-secondary dm-profile-button', t('people.profile'), 'i-user')
  profile.id = 'dm-profile-button'
  profile.setAttribute('aria-haspopup', 'dialog')
  profile.setAttribute('aria-label', t('dm.profileLabel', { name: name }))
  profile.setAttribute('data-focus-key', 'dmh-profile')
  profile.addEventListener('click', () => {
    openProfileCard(partner, profile)
  })
  header.appendChild(profile)
  restoreFocusKey(header, focusKey)
}

function renderKeyWarning (partner, name, st) {
  const strip = byId('key-warning')
  if (!strip) return
  clear(strip)
  const changed = st.reason === 'changed'
  strip.hidden = !changed
  if (!changed) return
  strip.setAttribute('role', 'alert')
  strip.appendChild(icon('i-alert'))
  strip.appendChild(h('span', 'key-warning-text', t('dm.keyChanged', { name: name })))
  const actions = h('span', 'key-warning-actions')
  const accept = button('button button-small key-warning-accept', t('dm.acceptNewKey'))
  accept.id = 'key-warning-accept'
  accept.addEventListener('click', () => {
    try {
      window.E2EE.pins.accept(state.me.id, partner)
    } catch (err) {
      window.console.error(err)
    }
    dmRefreshChrome()
    if (!el.composerInput.disabled) focusNode(el.composerInput)
  })
  actions.appendChild(accept)
  const safety = button('button button-small button-secondary key-warning-safety', t('dm.safetyNumber'))
  safety.addEventListener('click', () => {
    openSafetyDialog(safety)
  })
  actions.appendChild(safety)
  strip.appendChild(actions)
}

// Güvenlik numarası penceresi: iki tarafta aynı 60 rakam. Karşılaştırıldıktan sonra
// "Doğrulandı olarak işaretle".
function openSafetyDialog (trigger) {
  const partner = dmState.partnerId
  if (partner === null || !state.me) return
  const name = userDisplayName(partner)
  openAppDialog({
    name: 'safety',
    titleKey: 'dm.safetyTitle',
    trigger: trigger,
    build: (body, close) => {
      const pair = myIdentity()
      const rec = profileRecord(partner)
      if (!pair || !rec || rec.keyState !== 'ok') {
        body.appendChild(h('p', 'hint safety-unavailable', t(pair ? 'dm.safetyUnavailable' : 'dm.locked')))
        return null
      }
      let number = ''
      try {
        number = window.E2EE.safetyNumber(state.me.id, pair.publicKey, partner, rec.publicKey)
      } catch (err) {
        number = ''
      }
      if (!number) {
        body.appendChild(h('p', 'hint safety-unavailable', t('dm.safetyUnavailable')))
        return null
      }
      body.appendChild(h('p', 'lead', t('dm.safetyLead', { name: name })))
      const grid = h('div', 'safety-number')
      grid.id = 'safety-number'
      grid.setAttribute('data-number', number)
      grid.setAttribute('aria-label', t('dm.safetyAria', { number: number }))
      number.split(' ').forEach((group) => {
        grid.appendChild(h('span', 'safety-group mono', group))
      })
      body.appendChild(grid)
      let pin = null
      try {
        pin = window.E2EE.pins.get(state.me.id, partner)
      } catch (err) {
        pin = null
      }
      const verified = Boolean(pin && pin.verified && pin.status !== 'changed')
      body.appendChild(h('p', 'hint safety-state' + (verified ? ' is-ok' : ''), t(verified ? 'dm.safetyVerified' : 'dm.safetyNotVerified', { name: name })))
      const row = h('div', 'row dialog-actions')
      const mark = button('button' + (verified ? ' button-secondary' : ''), t(verified ? 'dm.unmarkVerified' : 'dm.markVerified'))
      mark.id = 'safety-mark'
      mark.addEventListener('click', () => {
        try {
          window.E2EE.pins.setVerified(state.me.id, partner, !verified)
        } catch (err) {
          window.console.error(err)
        }
        close('done')
        dmRefreshChrome()
        toast(() => t(verified ? 'dm.unmarkedToast' : 'dm.markedToast', { name: name }), 'ok')
      })
      row.appendChild(mark)
      body.appendChild(row)
      return mark
    }
  })
}

// Açılışta okunmamış özel mesajları sayar (son okunandan yeni, karşı tarafın mesajları)
async function scanDmUnread () {
  dmState.scanGen += 1
  const gen = dmState.scanGen
  const me = state.me
  const list = dmEntries().slice()
  for (const d of list) {
    if (gen !== dmState.scanGen || !state.inApp || state.me !== me) return
    if (sameId(d.id, state.channelId)) continue
    const lastRead = Number(state.lastRead[d.id]) || 0
    if (d.lastMessageId === null || d.lastMessageId === undefined || Number(d.lastMessageId) <= lastRead) continue
    const res = await api('GET', '/api/messages?channel=' + encodeURIComponent(d.id) + '&limit=' + PAGE_SIZE)
    if (res.status !== 200 || !res.data || !Array.isArray(res.data.messages)) continue
    const count = res.data.messages.filter((m) => Number(m.id) > lastRead && !sameId(m.authorId, me.id)).length
    if (!sameId(d.id, state.channelId) && count > (state.unread[d.id] || 0)) state.unread[d.id] = count
  }
  if (gen === dmState.scanGen && state.inApp && state.me === me) {
    renderDmList()
    renderHomeEntry()
  }
}

// Kimlik açıldığında veya değiştiğinde açık özel mesaj yeniden çözülür
function dmAfterIdentityChange () {
  decryptCache.clear()
  if (socialState.view === 'dm') {
    dmRefreshChrome()
    refreshAllMessages()
  }
}
