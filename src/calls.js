'use strict'

// Özel mesaj aramaları: konuşma kimliğine göre bellekte tutulan arama kayıtları. Diske yazılmaz, sunucu yeniden
// başlayınca (ses odaları gibi) kaybolur. Kurallar (üyelik, arkadaşlık, engel, hız sınırı) src/app.js'tedir, bu modül
// kayıtları, kullanıcı dizinini, zil süresini ve aramanın oda üyeliğine göre durumunu yönetir. Bu modül hiçbir şey
// loglamaz.
// Kayıt: { dmId, members: [a, b], caller, callee, video, state: 'ringing' | 'active', createdAt, ringUntil,
//   answeredAt, joined, declined }. joined, arama odasına en az bir kez katılmış üyelerin kümesidir ve görünüme
//   girmez. declined, arananın reddettiği çalan aramadır: arananın görünümünden kalkar, arayan için zil süresi
//   dolana kadar sürer (reddetme cevapsız kalmadan ayırt edilemez).

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

// options: { ringMs, onEnd: (kayıt) => void (kayıt silindikten sonra çağrılır) }
function createCalls (options) {
  const ringMs = options.ringMs
  const onEnd = options.onEnd
  // Konuşma kimliği (dize) -> kayıt
  const calls = new Map()
  // Kullanıcı kimliği -> kayıtlar
  const byUser = new Map()

  function get (dmId) {
    return calls.get(String(dmId)) || null
  }

  // Zil süresi dolmuş çalan arama mı (süpürme henüz silmemiş olabilir)
  function stale (rec, now) {
    return rec.state === 'ringing' && now >= rec.ringUntil
  }

  // Konuşmanın geçerli kaydı: zil süresi dolmuş çalan arama yok sayılır ve silinir (süpürmeyi beklemeden). Yoksa null.
  function live (dmId, now) {
    const rec = get(dmId)
    if (!rec) return null
    if (!stale(rec, now)) return rec
    end(rec)
    return null
  }

  // Yeni çalan arama. Konuşmada kayıt olmadığı denetlenmiş olmalıdır.
  function create (dm, callerId, video, now) {
    const callee = dm.members[0] === callerId ? dm.members[1] : dm.members[0]
    const rec = {
      dmId: dm.id,
      members: dm.members.slice(),
      caller: callerId,
      callee,
      video,
      state: 'ringing',
      createdAt: now,
      ringUntil: now + ringMs,
      answeredAt: null,
      joined: new Set(),
      declined: false
    }
    calls.set(String(dm.id), rec)
    for (const id of rec.members) addTo(byUser, id, rec)
    return rec
  }

  // Kaydı siler ve onEnd'i çağırır. Kayıt zaten silinmişse false.
  function end (rec) {
    const key = String(rec.dmId)
    if (calls.get(key) !== rec) return false
    calls.delete(key)
    for (const id of rec.members) removeFrom(byUser, id, rec)
    onEnd(rec)
    return true
  }

  // Aranan çalan aramayı reddetti. Kayıt zil süresi dolana kadar kalır. Durum değiştiyse true.
  function decline (rec) {
    if (rec.state !== 'ringing' || rec.declined) return false
    rec.declined = true
    return true
  }

  // Reddedilen çalan arama aranana artık görünmez
  function hiddenFrom (rec, userId) {
    return rec.declined && rec.state === 'ringing' && rec.callee === userId
  }

  // Kullanıcının üyesi olduğu kayıtlar
  function ofUser (userId) {
    return Array.from(byUser.get(userId) || [])
  }

  // Kullanıcının görünümündeki arama: etkin olan öncelikli, sonra en yeni. Zil süresi dolmuş çalan arama görünmez.
  // Yoksa null.
  function latestOf (userId, now) {
    let best = null
    for (const rec of byUser.get(userId) || []) {
      if (stale(rec, now) || hiddenFrom(rec, userId)) continue
      if (best === null) {
        best = rec
        continue
      }
      const activeFirst = Number(rec.state === 'active') - Number(best.state === 'active')
      if (activeFirst > 0 || (activeFirst === 0 && (rec.createdAt > best.createdAt || (rec.createdAt === best.createdAt && rec.dmId > best.dmId)))) best = rec
    }
    return best
  }

  // Arayanın çalan diğer aramaları (yeni arama bunları iptal eder)
  function ringingBy (callerId, exceptDmId) {
    return ofUser(callerId).filter((rec) => rec.caller === callerId && rec.state === 'ringing' && rec.dmId !== exceptDmId)
  }

  // Zil süresi dolmuş çalan aramalar
  function expired (now) {
    const out = []
    for (const rec of calls.values()) {
      if (stale(rec, now)) out.push(rec)
    }
    return out
  }

  // Arama odasının güncel üyeleri (present: odadaki kullanıcı kimlikleri) ile kaydı günceller: iki üye de odaya
  // katılınca arama etkin olur, odaya katılmış bir üye ayrılınca arama biter. Arayan odada yokken katılan aranan
  // aramayı etkin yapmaz (arama çalmaya devam eder, zil süresi dolunca biter), böylece arayanı olmayan bir arama
  // süresiz etkin kalamaz. Arama bitmeliyse false döner.
  function sync (rec, present, now) {
    for (const id of rec.joined) {
      if (!present.includes(id)) return false
    }
    for (const id of present) {
      if (rec.members.includes(id)) rec.joined.add(id)
    }
    if (rec.state === 'ringing' && rec.joined.has(rec.callee) && rec.joined.has(rec.caller)) {
      rec.state = 'active'
      rec.answeredAt = now
    }
    return true
  }

  function size () {
    return calls.size
  }

  return { get, live, create, end, decline, hiddenFrom, ofUser, latestOf, ringingBy, expired, sync, size }
}

module.exports = { createCalls }
