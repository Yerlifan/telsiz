'use strict'

// Arkadaşlıklar, engellemeler ve özel mesaj konuşmaları.
// Kalıcı veriler durum nesnesindedir: state.friendships ({ a, b, state, from, createdAt }, a < b),
// state.blocks ({ by, user, createdAt }) ve state.channels içindeki { id, type: 'dm', members, createdAt }.
// Bu modül hızlı erişim için dizinler kurar, kuralları uygular ve kişiye özel meta görünümünü üretir.
// Kişiye özel görünümü değişen kullanıcılar onChange ile bildirilir. Bu modül hiçbir şey loglamaz.

function isId (value) {
  return Number.isSafeInteger(value) && value >= 1
}

function pairKey (a, b) {
  return a < b ? a + ':' + b : b + ':' + a
}

function blockKey (by, user) {
  return by + '>' + user
}

function finiteOr (value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function addTo (index, key, item) {
  let set = index.get(key)
  if (!set) {
    set = new Set()
    index.set(key, set)
  }
  set.add(item)
}

function removeFrom (index, key, item) {
  const set = index.get(key)
  if (!set) return
  set.delete(item)
  if (set.size === 0) index.delete(key)
}

function sortedIds (list) {
  return list.sort((x, y) => x - y)
}

// options: { state, limits: { maxFriends, maxPendingRequests, maxDmsPerUser },
//   lastMessageOf: (channelId) => message | null, onChange: (userIds) => void, save: () => void }
function createSocial (options) {
  const state = options.state
  const limits = options.limits
  const lastMessageOf = options.lastMessageOf
  const onChange = options.onChange
  const save = options.save

  const friendships = new Map()
  const friendshipsByUser = new Map()
  const blocks = new Map()
  const blocksByUser = new Map()
  const dmsByPair = new Map()
  const dmsByUser = new Map()

  // ---------------------------------------------------------------- açılış

  // Geçersiz, yinelenen veya silinmiş kullanıcılara ait kayıtlar atılır. Değişiklik varsa true.
  function sanitize () {
    const live = new Set()
    for (const u of state.users) {
      if (u && isId(u.id) && u.deleted !== true) live.add(u.id)
    }
    let changed = false
    if (!Array.isArray(state.friendships)) {
      state.friendships = []
      changed = true
    }
    if (!Array.isArray(state.blocks)) {
      state.blocks = []
      changed = true
    }
    const seenPairs = new Set()
    const cleanFriendships = []
    for (const rec of state.friendships) {
      if (!rec || typeof rec !== 'object') continue
      const a = Math.min(rec.a, rec.b)
      const b = Math.max(rec.a, rec.b)
      if (!isId(a) || !isId(b) || a === b || !live.has(a) || !live.has(b)) continue
      if (rec.state !== 'pending' && rec.state !== 'friends') continue
      if (rec.from !== a && rec.from !== b) continue
      const key = pairKey(a, b)
      if (seenPairs.has(key)) continue
      seenPairs.add(key)
      cleanFriendships.push({ a, b, state: rec.state, from: rec.from, createdAt: finiteOr(rec.createdAt, 0) })
    }
    const seenBlocks = new Set()
    const cleanBlocks = []
    for (const rec of state.blocks) {
      if (!rec || typeof rec !== 'object') continue
      if (!isId(rec.by) || !isId(rec.user) || rec.by === rec.user || !live.has(rec.by) || !live.has(rec.user)) continue
      const key = blockKey(rec.by, rec.user)
      if (seenBlocks.has(key)) continue
      seenBlocks.add(key)
      cleanBlocks.push({ by: rec.by, user: rec.user, createdAt: finiteOr(rec.createdAt, 0) })
    }
    // Engellenmiş çiftler arasındaki arkadaşlık kayıtları geçersizdir
    const blockedPairs = new Set(cleanBlocks.map((r) => pairKey(r.by, r.user)))
    const finalFriendships = cleanFriendships.filter((r) => !blockedPairs.has(pairKey(r.a, r.b)))
    // Temiz kopyalar her durumda kullanılır, diskteki biçimden farklıysa kaydedilir
    if (JSON.stringify(finalFriendships) !== JSON.stringify(state.friendships)) changed = true
    if (JSON.stringify(cleanBlocks) !== JSON.stringify(state.blocks)) changed = true
    state.friendships = finalFriendships
    state.blocks = cleanBlocks
    return changed
  }

  function rebuild () {
    friendships.clear()
    friendshipsByUser.clear()
    blocks.clear()
    blocksByUser.clear()
    dmsByPair.clear()
    dmsByUser.clear()
    for (const rec of state.friendships) indexFriendship(rec)
    for (const rec of state.blocks) indexBlock(rec)
    for (const ch of state.channels) {
      if (ch.type === 'dm') indexDm(ch)
    }
  }

  function indexFriendship (rec) {
    friendships.set(pairKey(rec.a, rec.b), rec)
    addTo(friendshipsByUser, rec.a, rec)
    addTo(friendshipsByUser, rec.b, rec)
  }

  function unindexFriendship (rec) {
    friendships.delete(pairKey(rec.a, rec.b))
    removeFrom(friendshipsByUser, rec.a, rec)
    removeFrom(friendshipsByUser, rec.b, rec)
  }

  function indexBlock (rec) {
    blocks.set(blockKey(rec.by, rec.user), rec)
    addTo(blocksByUser, rec.by, rec)
    addTo(blocksByUser, rec.user, rec)
  }

  function unindexBlock (rec) {
    blocks.delete(blockKey(rec.by, rec.user))
    removeFrom(blocksByUser, rec.by, rec)
    removeFrom(blocksByUser, rec.user, rec)
  }

  function indexDm (ch) {
    const key = pairKey(ch.members[0], ch.members[1])
    if (!dmsByPair.has(key)) dmsByPair.set(key, ch)
    addTo(dmsByUser, ch.members[0], ch)
    addTo(dmsByUser, ch.members[1], ch)
  }

  // ---------------------------------------------------------------- sorgular

  function friendshipOf (a, b) {
    return friendships.get(pairKey(a, b)) || null
  }

  function areFriends (a, b) {
    const rec = friendshipOf(a, b)
    return rec !== null && rec.state === 'friends'
  }

  function hasBlocked (by, user) {
    return blocks.has(blockKey(by, user))
  }

  // Taraflardan biri diğerini engellediyse true
  function isBlockedEither (a, b) {
    return hasBlocked(a, b) || hasBlocked(b, a)
  }

  function countFriendships (userId, test) {
    const set = friendshipsByUser.get(userId)
    if (!set) return 0
    let n = 0
    for (const rec of set) {
      if (test(rec)) n++
    }
    return n
  }

  function friendCount (userId) {
    return countFriendships(userId, (rec) => rec.state === 'friends')
  }

  function outgoingCount (userId) {
    return countFriendships(userId, (rec) => rec.state === 'pending' && rec.from === userId)
  }

  // ---------------------------------------------------------------- arkadaşlık durum makinesi

  function removeFriendship (rec) {
    state.friendships = state.friendships.filter((r) => r !== rec)
    unindexFriendship(rec)
  }

  function canBecomeFriends (a, b) {
    return friendCount(a) < limits.maxFriends && friendCount(b) < limits.maxFriends
  }

  // Sonuç: { state: 'pending' | 'friends' } veya { error }
  function request (fromId, toId, now) {
    if (isBlockedEither(fromId, toId)) return { error: 'request_failed' }
    const rec = friendshipOf(fromId, toId)
    if (rec) {
      if (rec.state === 'friends') return { error: 'already_friends' }
      if (rec.from === fromId) return { error: 'already_pending' }
      // Karşı taraf zaten istek göndermiş: otomatik kabul
      if (!canBecomeFriends(fromId, toId)) return { error: 'too_many_friends' }
      rec.state = 'friends'
      save()
      onChange([fromId, toId])
      return { state: 'friends' }
    }
    if (outgoingCount(fromId) >= limits.maxPendingRequests) return { error: 'too_many_pending' }
    if (friendCount(fromId) >= limits.maxFriends) return { error: 'too_many_friends' }
    const created = { a: Math.min(fromId, toId), b: Math.max(fromId, toId), state: 'pending', from: fromId, createdAt: now }
    state.friendships.push(created)
    indexFriendship(created)
    save()
    onChange([fromId, toId])
    return { state: 'pending' }
  }

  function incomingRequest (meId, otherId) {
    const rec = friendshipOf(meId, otherId)
    return rec !== null && rec.state === 'pending' && rec.from === otherId ? rec : null
  }

  function accept (meId, otherId) {
    const rec = incomingRequest(meId, otherId)
    if (!rec) return { error: 'request_not_found' }
    if (!canBecomeFriends(meId, otherId)) return { error: 'too_many_friends' }
    rec.state = 'friends'
    save()
    onChange([meId, otherId])
    return { state: 'friends' }
  }

  function decline (meId, otherId) {
    const rec = incomingRequest(meId, otherId)
    if (!rec) return { error: 'request_not_found' }
    removeFriendship(rec)
    save()
    onChange([meId, otherId])
    return { state: null }
  }

  // Arkadaşlığı kaldırır veya giden isteği iptal eder
  function remove (meId, otherId) {
    const rec = friendshipOf(meId, otherId)
    if (!rec || (rec.state === 'pending' && rec.from !== meId)) return { error: 'not_friends' }
    removeFriendship(rec)
    save()
    onChange([meId, otherId])
    return { state: null }
  }

  // ---------------------------------------------------------------- engellemeler

  // Arkadaşlığı ve bekleyen istekleri de siler. Engellenen kişiye yalnızca kendi listeleri
  // değiştiyse bildirim gider (engel bilgisi başka yoldan sızmasın).
  function block (meId, otherId, now) {
    const changed = [meId]
    const rec = friendshipOf(meId, otherId)
    if (rec) {
      removeFriendship(rec)
      changed.push(otherId)
    }
    if (!hasBlocked(meId, otherId)) {
      const created = { by: meId, user: otherId, createdAt: now }
      state.blocks.push(created)
      indexBlock(created)
    } else if (!rec) {
      return { state: 'blocked' }
    }
    save()
    onChange(changed)
    return { state: 'blocked' }
  }

  function unblock (meId, otherId) {
    const rec = blocks.get(blockKey(meId, otherId))
    if (!rec) return { state: null }
    state.blocks = state.blocks.filter((r) => r !== rec)
    unindexBlock(rec)
    save()
    onChange([meId])
    return { state: null }
  }

  // Hesap silinince kullanıcıya ait arkadaşlık ve engel kayıtları silinir.
  // Özel mesaj konuşmaları ve geçmişi kalır.
  function removeUser (userId) {
    const affected = new Set()
    const fset = friendshipsByUser.get(userId)
    if (fset) {
      for (const rec of Array.from(fset)) {
        affected.add(rec.a === userId ? rec.b : rec.a)
        unindexFriendship(rec)
      }
      state.friendships = state.friendships.filter((r) => r.a !== userId && r.b !== userId)
    }
    const bset = blocksByUser.get(userId)
    if (bset) {
      for (const rec of Array.from(bset)) {
        // Silinen kişiyi engellemiş olanların engel listesi değişir
        if (rec.user === userId) affected.add(rec.by)
        unindexBlock(rec)
      }
      state.blocks = state.blocks.filter((r) => r.by !== userId && r.user !== userId)
    }
    affected.delete(userId)
    if (fset || bset) save()
    if (affected.size > 0) onChange(Array.from(affected))
  }

  // ---------------------------------------------------------------- özel mesaj konuşmaları

  function dmBetween (a, b) {
    return dmsByPair.get(pairKey(a, b)) || null
  }

  function dmCount (userId) {
    const set = dmsByUser.get(userId)
    return set ? set.size : 0
  }

  function isMember (channel, userId) {
    return channel.type === 'dm' && channel.members.includes(userId)
  }

  function otherMember (channel, userId) {
    return channel.members[0] === userId ? channel.members[1] : channel.members[0]
  }

  // Yeni konuşma kanalını oluşturur ve durum dizisine ekler.
  function createDm (a, b, now) {
    state.counters.channel++
    const channel = { id: state.counters.channel, type: 'dm', members: sortedIds([a, b]), createdAt: now }
    state.channels.push(channel)
    indexDm(channel)
    save()
    onChange([a, b])
    return channel
  }

  // Konuşmanın son mesajı değişti (gönderme veya silme)
  function touchDm (channel) {
    onChange(channel.members.slice())
  }

  // ---------------------------------------------------------------- kişiye özel meta

  function privateView (user) {
    const userId = user.id
    const friends = []
    const incoming = []
    const outgoing = []
    for (const rec of friendshipsByUser.get(userId) || []) {
      const other = rec.a === userId ? rec.b : rec.a
      if (rec.state === 'friends') friends.push(other)
      else if (rec.from === userId) outgoing.push(other)
      else incoming.push(other)
    }
    const blocked = []
    for (const rec of blocksByUser.get(userId) || []) {
      if (rec.by === userId) blocked.push(rec.user)
    }
    // Son etkinliğe göre (mesaj yoksa oluşturulma zamanı) yeniden eskiye
    const rows = []
    for (const ch of dmsByUser.get(userId) || []) {
      const last = lastMessageOf(ch.id)
      rows.push({
        order: last ? last.createdAt : finiteOr(ch.createdAt, 0),
        dm: {
          id: ch.id,
          userId: otherMember(ch, userId),
          lastMessageId: last ? last.id : null,
          lastMessageAt: last ? last.createdAt : null
        }
      })
    }
    rows.sort((x, y) => y.order - x.order || y.dm.id - x.dm.id)
    const dms = rows.map((row) => row.dm)
    return {
      friends: sortedIds(friends),
      incoming: sortedIds(incoming),
      outgoing: sortedIds(outgoing),
      blocked: sortedIds(blocked),
      dms,
      allowMemberDms: user.allowMemberDms !== false,
      // Kullanıcının kendi seçtiği durum (görünmez dahil), yalnızca kendisine gönderilir
      status: typeof user.status === 'string' ? user.status : 'online'
    }
  }

  const dirty = sanitize()
  rebuild()

  return {
    dirty,
    areFriends,
    hasBlocked,
    isBlockedEither,
    friendCount,
    outgoingCount,
    request,
    accept,
    decline,
    remove,
    block,
    unblock,
    removeUser,
    dmBetween,
    dmCount,
    isMember,
    otherMember,
    createDm,
    touchDm,
    privateView
  }
}

module.exports = { createSocial, pairKey }
