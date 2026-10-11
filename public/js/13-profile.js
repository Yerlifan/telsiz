'use strict'

// Profiller: /api/profiles ile toplu çekme ve (id, pv) önbelleği, grup anahtarıyla şifreli profil
// zarfının çözülüp doğrulanması, profil resimleri ve kapak fotoğrafları (indirme, çözme, blob URL önbelleği,
// kapak yalnızca gösterileceği zaman), kişisel anahtarın kimlik bağlamasıyla doğrulanması ve ilk görüşte
// sabitlenmesi, görsel yardımcılar (görünen ad, @kullanıcı adı, avatar bilgisi, durum), ortak pencere yardımcısı,
// profil kartı, durum menüsü ve kendi profilini kaydetme.

const PROFILE_BATCH = 100
const PROFILE_FETCH_DELAY_MS = 30
// Başarısız profil isteğinin yeniden deneme beklemeleri. Dört denemenin sonuncusu da düşerse grup kuyrukta kalır,
// bir sonraki başarılı poll (profilesAfterPoll) son bekleme dolunca yeniden istemek için zamanlayıcı kurar.
const PROFILE_RETRY_MS = [2000, 5000, 15000, 60000]
// /api/profiles isteğine giren kullanıcı kimliği biçimi (diğerleri istenmeden kuyruktan düşer)
const PROFILE_ID_RE = /^[1-9][0-9]{0,15}$/
// Profil resmi indirmesi kendiliğinden en çok AVATAR_TRIES kez denenir, denemeler arası beklemeler sırayla bunlardır.
// Bunun dışında her başarılı poll (profileImagesAfterPoll) kalıcı olmayan bir hatayla düşmüş resmi, deneme hakkı bitmiş
// olsa da, son denemeden AVATAR_POLL_RETRY_MS sonra (o an geçtiyse hemen) yeniden ister: ağ düzelince resim en geç 60
// saniye içinde gelir.
const AVATAR_TRIES = 4
const AVATAR_RETRY_MS = [10000, 30000, 120000]
const AVATAR_POLL_RETRY_MS = 60000
const PROFILE_NAME_MAX = 32
const PROFILE_STATUS_MAX = 128
const PROFILE_BIO_MAX = 190
const PROFILE_COLORS = 8
const AVATAR_EDGE = 256
const AVATAR_JPEG_QUALITY = 0.9
const AVATAR_TYPES = ['image/png', 'image/jpeg']
// Kapak fotoğrafı (istek 8): ortasından 3:1 kırpılır ve 1200x400 JPEG olarak kodlanır. Dosya profil resmiyle aynı
// sınırı (avatarMaxBytes) aşarsa kalite sırayla düşürülür.
const COVER_W = 1200
const COVER_H = 400
const COVER_QUALITIES = [0.85, 0.7, 0.55]
// Bellekte tutulan en çok kapak sayısı. Kapak 1 MB'a kadar olabildiği için önbellek son kullanılan kapaklarla sınırlıdır,
// açık kartın ve kendi profilimin kapağı atılmaz (trimCovers).
const COVER_CACHE_MAX = 20
const STATUS_CHOICES = ['online', 'idle', 'dnd', 'invisible']
const SHOWN_STATUSES = ['online', 'idle', 'dnd', 'offline']

const profileState = {
  entries: new Map(),
  avatars: new Map(),
  // Kapak fotoğrafları (yükleme kimliği -> kayıt, avatars ile aynı biçim). Kapak yalnızca profil kartında ve Ayarlar
  // önizlemesinde gösterileceği zaman indirilir (loadCover). Sıra son kullanıma göredir, en eskisi baştadır.
  covers: new Map(),
  formerUsers: new Map(),
  queue: new Set(),
  // Bekleyen profil isteği zamanlayıcısı ve çalışacağı an (Date.now)
  timer: 0,
  timerAt: 0,
  fetching: false,
  // Art arda başarısız profil isteği sayısı ve bir sonraki isteğin en erken zamanı (Date.now)
  failures: 0,
  retryAt: 0,
  gen: 0,
  renderQueued: false,
  changed: new Set(),
  cardUserId: null,
  cardTrigger: null,
  cardModKey: '',
  metaIds: null,
  // Metadaki kullanıcı adları (kimlik -> ad), ad değişikliğini bulmak için
  metaNames: null,
  // Profil sürümü: görünen ad, profil resmi veya kullanıcı adı değişince artar (profileEpoch)
  epoch: 0,
  // Son başarılı kendi profil kaydım: { userId, pv, avatar, cover }. pv sunucunun döndürdüğü sürüm, avatar ve cover zarfa
  // giren resim başvurularıdır ({ u, k, n, m } veya null). Kendi profil kaydım yenilenene kadar sonraki kayıt değişmeyen
  // resimleri buradan alır (ownImageBase).
  ownSaved: null
}

// Ad ve avatar çizen, kendi önbellek anahtarıyla yeniden çizimi atlayan yüzeyler (kameralar ızgarası, paylaşan
// seçicisi, izleyiciler, Telsiz DJ kuyruğu) bu değeri anahtarlarına katar. Değer her profil değişikliğinde, profil
// resmi gelince ve metadaki kullanıcı adı değişince artar.
function profileEpoch () {
  return profileState.epoch
}

// Önbellek

function profilesReset () {
  profileState.gen += 1
  clearTimeout(profileState.timer)
  profileState.timer = 0
  profileState.queue.clear()
  profileState.changed.clear()
  profileState.entries = new Map()
  profileState.formerUsers = new Map()
  profileState.metaIds = null
  profileState.metaNames = null
  profileState.epoch += 1
  profileState.ownSaved = null
  profileState.fetching = false
  profileState.failures = 0
  profileState.retryAt = 0
  profileState.avatars.forEach((entry) => {
    clearTimeout(entry.timer)
    revokeLater(entry.url)
  })
  profileState.avatars = new Map()
  profileState.covers.forEach((entry) => {
    clearTimeout(entry.timer)
    revokeLater(entry.url)
  })
  profileState.covers = new Map()
}

function revokeLater (url) {
  if (!url) return
  setTimeout(() => {
    try {
      URL.revokeObjectURL(url)
    } catch (err) {
      // Zaten bırakılmış
    }
  }, REVOKE_DELAY_MS)
}

async function refreshFormerUsers () {
  const gen = profileState.gen
  const res = await api('GET', '/api/state')
  if (gen !== profileState.gen || res.status !== 200 || !res.data) return
  setFormerUsers(res.data.formerUsers)
  if (!state.inApp) return
  refreshAllMessages()
  socialRender()
}

// Sunucudan engellenen hesapların adları (eski mesajlarında gösterilir)
function setFormerUsers (list) {
  profileState.formerUsers = new Map()
  profileState.epoch += 1
  if (!Array.isArray(list)) return
  list.forEach((u) => {
    if (u && u.id !== undefined && typeof u.name === 'string') profileState.formerUsers.set(String(u.id), u.name)
  })
}

function profileRecord (userId) {
  if (userId === null || userId === undefined) return null
  return profileState.entries.get(String(userId)) || null
}

function metaUser (userId) {
  const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
  return users.filter((u) => u && sameId(u.id, userId))[0] || null
}

// Meta'daki pv değişen kullanıcıların profilleri kuyruğa alınır. Listeden düşen kullanıcı varsa
// (hesap silindi veya sunucudan engellendi) engellenenlerin adları yeniden alınır. Kullanıcı adı değişen kişi
// profil değişikliği gibi yeniden çizilir (profil sürümü artar).
function profilesOnMeta () {
  const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
  const ids = new Set(users.map((u) => String(u && u.id)))
  const before = profileState.metaIds
  profileState.metaIds = ids
  if (before && Array.from(before).some((id) => !ids.has(id))) refreshFormerUsers()
  const names = new Map()
  users.forEach((u) => {
    if (u && u.id !== undefined) names.set(String(u.id), String(u.name || ''))
  })
  const oldNames = profileState.metaNames
  profileState.metaNames = names
  if (oldNames) {
    let renamed = false
    names.forEach((name, id) => {
      if (!oldNames.has(id) || oldNames.get(id) === name) return
      profileState.changed.add(id)
      renamed = true
    })
    if (renamed) queueProfileRender()
  }
  // Açık profil kartının ses odası denetimi düğmeleri (herkes için susturma, kamerasını kapat) metaya uyar
  if (profileState.cardUserId !== null && cardModKey(profileState.cardUserId) !== profileState.cardModKey) refreshProfileCard()
  users.forEach((u) => {
    if (!u || u.id === undefined) return
    const rec = profileRecord(u.id)
    const pv = typeof u.pv === 'number' ? u.pv : 0
    if (!rec || rec.pv !== pv) profileState.queue.add(String(u.id))
  })
  scheduleProfileFetch()
}

// Meta dışında kalabilecek kişiler (özel mesaj, arkadaşlık listeleri) için de profil istenir. Kuyruğa ilk kez giren
// kişi (yeni açılan profil kartı veya özel mesaj kişisi) düşen bir isteğin beklemesine takılmaz. Kuyrukta bekleyen
// kişi yeniden istenince bekleme kısalmaz, düşmeye devam eden grup sunucuyu sık sık yormaz.
function profilesEnsure (ids) {
  if (!Array.isArray(ids)) return
  let fresh = false
  ids.forEach((id) => {
    if (id === null || id === undefined) return
    const key = String(id)
    if (profileRecord(key) || profileState.queue.has(key)) return
    profileState.queue.add(key)
    if (PROFILE_ID_RE.test(key)) fresh = true
  })
  scheduleProfileFetch(fresh)
}

// Kendi profili kaydedilince (saveProfile) beklemeden yeniden istenir: sunucuya ulaşıldığı az önce görüldü
function profilesRefetch (ids) {
  ids.forEach((id) => {
    profileState.queue.add(String(id))
  })
  scheduleProfileFetch(true)
}

// Başarısız bir istekten sonra bekleme süresi (retryAt) dolmadan yeni istek gönderilmez. now: açık bir istek
// (profilesEnsure, profilesRefetch) beklemeyi atlar, kuyrukta bekleyen grup da aynı istekle gider. Zamanlayıcı
// yalnızca öne çekilir, daha erken kurulmuş bir istek ertelenmez.
function scheduleProfileFetch (now) {
  if (!profileState.queue.size || profileState.fetching || !state.token) return
  const at = Date.now() + Math.max(PROFILE_FETCH_DELAY_MS, now ? 0 : profileState.retryAt - Date.now())
  if (profileState.timer && profileState.timerAt <= at) return
  clearTimeout(profileState.timer)
  profileState.timerAt = at
  profileState.timer = setTimeout(fetchProfiles, at - Date.now())
}

async function fetchProfiles () {
  profileState.timer = 0
  if (profileState.fetching || !profileState.queue.size || !state.token) return
  profileState.fetching = true
  const gen = profileState.gen
  let failed = false
  try {
    while (profileState.queue.size && gen === profileState.gen) {
      const batch = Array.from(profileState.queue).slice(0, PROFILE_BATCH)
      batch.forEach((id) => {
        profileState.queue.delete(id)
      })
      const ids = batch.filter((id) => PROFILE_ID_RE.test(id))
      if (!ids.length) continue
      const res = await api('GET', '/api/profiles?ids=' + ids.join(','))
      if (gen !== profileState.gen) return
      if (res.status !== 200 || !res.data || !Array.isArray(res.data.profiles)) {
        // Grup kuyruğa geri konur, artan beklemeyle yeniden istenir (profileRetryLater)
        ids.forEach((id) => {
          profileState.queue.add(id)
        })
        failed = true
        break
      }
      profileState.failures = 0
      profileState.retryAt = 0
      const seen = new Set()
      res.data.profiles.forEach((entry) => {
        if (!entry || entry.id === undefined) return
        seen.add(String(entry.id))
        storeProfileEntry(entry)
      })
      ids.forEach((id) => {
        if (seen.has(id)) return
        // Silinmiş veya sunucudan engellenmiş: yeniden istenmesin
        const old = profileRecord(id)
        if (old && old.missing) return
        if (old && old.profile && old.profile.cover) dropProfileImage(profileState.covers, old.profile.cover.u)
        profileState.entries.set(id, { id: id, pv: -1, missing: true, raw: null, profile: null, publicKey: null, identity: null, avatarUploadId: null, coverUploadId: null, keyState: 'none' })
        profileState.changed.add(id)
      })
      queueProfileRender()
    }
  } finally {
    if (gen === profileState.gen) profileState.fetching = false
  }
  if (gen !== profileState.gen) return
  if (failed) profileRetryLater()
  else if (profileState.queue.size) scheduleProfileFetch()
}

// Başarısız istekten sonra 2, 5, 15 ve 60 saniye beklenerek yeniden denenir. Sonra kendiliğinden zamanlayıcı kurulmaz:
// kuyruktaki grubu bir sonraki başarılı poll (profilesAfterPoll) en az 60 saniye arayla yeniden ister, böylece
// sunucuya ulaşılamazken boşuna istek gönderilmez.
function profileRetryLater () {
  profileState.failures += 1
  const n = profileState.failures
  profileState.retryAt = Date.now() + PROFILE_RETRY_MS[Math.min(n, PROFILE_RETRY_MS.length) - 1]
  clearTimeout(profileState.timer)
  profileState.timer = 0
  if (n <= PROFILE_RETRY_MS.length) scheduleProfileFetch()
}

// Her başarılı poll'dan sonra (05-poll.js): bir profil isteği düştüyse metadaki pv değerleri önbellekle karşılaştırılır
// ve eskiyen kişiler kuyruğa alınır. İstek bekleme süresi dolunca gider (scheduleProfileFetch zamanlayıcıyı retryAt'e
// kurar), sonraki poll'u veya meta değişikliğini beklemez: ağ düzeldikten en geç 60 saniye sonra profiller gelir.
// Düşen profil resimleri de aynı sürede yeniden istenir (profileImagesAfterPoll). Hata yoksa hiçbir şey yapılmaz.
function profilesAfterPoll () {
  if (!state.token) return
  profileImagesAfterPoll()
  if (!profileState.failures || profileState.fetching) return
  const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
  users.forEach((u) => {
    if (!u || u.id === undefined) return
    const rec = profileRecord(u.id)
    if (rec && rec.missing) return
    const pv = typeof u.pv === 'number' ? u.pv : 0
    if (!rec || rec.pv !== pv) profileState.queue.add(String(u.id))
  })
  scheduleProfileFetch()
}

function storeProfileEntry (entry) {
  const id = String(entry.id)
  const old = profileRecord(id)
  const rec = {
    id: id,
    pv: typeof entry.pv === 'number' ? entry.pv : 0,
    missing: false,
    raw: typeof entry.profile === 'string' ? entry.profile : null,
    avatarUploadId: typeof entry.avatarUploadId === 'string' && UPLOAD_ID_RE.test(entry.avatarUploadId) ? entry.avatarUploadId : null,
    coverUploadId: typeof entry.coverUploadId === 'string' && UPLOAD_ID_RE.test(entry.coverUploadId) ? entry.coverUploadId : null,
    publicKey: typeof entry.publicKey === 'string' ? entry.publicKey : null,
    identity: typeof entry.identity === 'string' ? entry.identity : null,
    profile: null,
    keyState: 'none',
    keyKid: null
  }
  decodeProfile(rec)
  verifyProfileKey(rec)
  profileState.entries.set(id, rec)
  const oldAvatar = old && old.profile && old.profile.avatar ? old.profile.avatar.u : null
  const newAvatar = rec.profile && rec.profile.avatar ? rec.profile.avatar.u : null
  if (oldAvatar && oldAvatar !== newAvatar) dropAvatar(oldAvatar)
  if (rec.profile && rec.profile.avatar) loadAvatar(rec)
  // Kapak burada indirilmez, kart açıksa yeniden çizilirken istenir (coverUrlOf)
  const oldCover = old && old.profile && old.profile.cover ? old.profile.cover.u : null
  const newCover = rec.profile && rec.profile.cover ? rec.profile.cover.u : null
  if (oldCover && oldCover !== newCover) dropProfileImage(profileState.covers, oldCover)
  profileState.changed.add(id)
}

// Grup anahtarı değişince (eklendi, etkin anahtar değişti) profiller yeniden çözülür ve doğrulanır
function profilesRecheck () {
  profileState.entries.forEach((rec) => {
    if (rec.missing) return
    decodeProfile(rec)
    verifyProfileKey(rec)
    if (rec.profile && rec.profile.avatar) loadAvatar(rec)
    profileState.changed.add(rec.id)
  })
  queueProfileRender()
}

function cleanLine (value, max) {
  if (typeof value !== 'string') return ''
  return cpSliceExact(normalizeName(value), max)
}

function cpSliceExact (text, max) {
  const cps = codePoints(text)
  return cps.length > max ? cps.slice(0, max).join('') : text
}

function cleanBio (value) {
  if (typeof value !== 'string') return ''
  let text = value
  try {
    text = text.normalize('NFC')
  } catch (err) {
    // normalize yoksa olduğu gibi
  }
  text = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\n{3,}/g, '\n\n').trim()
  return cpSliceExact(text, PROFILE_BIO_MAX)
}

function cleanColor (value) {
  return typeof value === 'number' && Math.floor(value) === value && value >= 0 && value < PROFILE_COLORS ? value : null
}

// Profil zarfındaki resim başvurusu { u, k, n, m }: u sunucudaki kayıtta aynı alana bağlı yükleme olmalıdır
function cleanImageRef (value, uploadId) {
  if (!value || typeof value !== 'object') return null
  if (typeof value.u !== 'string' || !UPLOAD_ID_RE.test(value.u) || value.u !== uploadId) return null
  if (typeof value.k !== 'string' || !B64URL_RE.test(value.k) || typeof value.n !== 'string' || !B64URL_RE.test(value.n)) return null
  const mime = typeof value.m === 'string' ? value.m : ''
  if (AVATAR_TYPES.indexOf(mime) === -1) return null
  return { u: value.u, k: value.k, n: value.n, m: mime }
}

function cleanAvatarRef (value, rec) {
  return cleanImageRef(value, rec.avatarUploadId)
}

// Kapak başvurusu { u, k, n, m, w, h } profil resmiyle aynı biçimdedir. Kapağı bilmeyen eski istemciler alanı yok sayar,
// eski bir istemci profili kaydedince sunucu kapağı kaldırır, zarftaki başvuru da coverUploadId tutmadığı için düşer.
function cleanCoverRef (value, rec) {
  return cleanImageRef(value, rec.coverUploadId)
}

// Profil zarfı grup anahtarıyla açılır, u alanı kişinin kimliği olmalıdır (sunucu profilleri
// kullanıcılar arasında değiştiremez). Açılamayan profil yok sayılır.
function decodeProfile (rec) {
  rec.profile = null
  if (!rec.raw || !cryptoReady()) return
  let opened = null
  try {
    opened = window.E2EE.openJson(rec.raw)
  } catch (err) {
    opened = null
  }
  if (!opened || opened.ok !== true) return
  const v = opened.value
  if (!v || typeof v !== 'object' || v.v !== 1 || !sameId(v.u, rec.id)) return
  rec.profile = {
    displayName: cleanLine(v.displayName, PROFILE_NAME_MAX),
    statusText: cleanLine(v.statusText, PROFILE_STATUS_MAX),
    bio: cleanBio(v.bio),
    color: cleanColor(v.color),
    avatar: cleanAvatarRef(v.avatar, rec),
    cover: cleanCoverRef(v.cover, rec)
  }
}

// Kişisel anahtar ancak grup anahtarıyla açılan kimlik bağlaması kişinin kimliğini ve sunucudaki
// açık anahtarı taşıyorsa kullanılır. Doğrulanan anahtar ilk görüşte sabitlenir.
function verifyProfileKey (rec) {
  rec.keyState = 'none'
  rec.keyKid = null
  if (!rec.publicKey || !cryptoReady()) return
  if (!rec.identity) {
    rec.keyState = 'unverified'
    return
  }
  let check = null
  try {
    check = window.E2EE.identity.verifyBinding(rec.identity, rec.id, rec.publicKey)
  } catch (err) {
    check = null
  }
  if (!check || check.ok !== true) {
    rec.keyState = 'unverified'
    return
  }
  rec.keyState = 'ok'
  rec.keyKid = check.kid
  if (state.me && !sameId(rec.id, state.me.id)) {
    try {
      window.E2EE.pins.observe(state.me.id, rec.id, rec.publicKey)
    } catch (err) {
      window.console.error(err)
    }
  }
}

// Profil resimleri ve kapak fotoğrafları: indirilir, çözülür, içerik türü doğrulanır ve blob URL olarak saklanır

// Kayıt: { url, state: 'loading' | 'ok' | 'failed', at (son denemenin bitişi), tries, timer, retryAt (zamanlayıcının
// çalışacağı an), permanent, userId, ref }. Düşen indirme 10 saniye, 30 saniye ve 2 dakika sonra yeniden denenir (en çok
// AVATAR_TRIES deneme), başarılı poll'dan sonra da son denemenin üzerinden 60 saniye geçince (profileImagesAfterPoll).
// Sunucu dosyayı bulamazsa (404), dosya çözülemezse veya türü tutmazsa hata kalıcıdır, yeniden denenmez. images:
// profileState.avatars veya covers.
function loadAvatar (rec) {
  const ref = rec.profile && rec.profile.avatar
  if (ref) loadProfileImage(profileState.avatars, rec.id, ref)
}

// Profil resimlerinden farklı olarak kapak önceden indirilmez, yalnızca kart açılınca istenir. Bu yüzden sunucu kimin
// hangi kişinin kartını açtığını görebilir (docs/MIMARI.md, Sınırlar).
function loadCover (rec) {
  const ref = rec && rec.profile && rec.profile.cover
  if (!ref) return
  const covers = profileState.covers
  const entry = covers.get(ref.u)
  if (entry) {
    // Son kullanılan sona alınır (Map ekleme sırasını korur)
    covers.delete(ref.u)
    covers.set(ref.u, entry)
    return
  }
  loadProfileImage(covers, rec.id, ref)
  trimCovers()
}

// Kapak önbelleği COVER_CACHE_MAX kaydı aşarsa en uzun süredir kullanılmayan kapaklar bırakılır. Açık kartın ve kendi
// profilimin (Ayarlar önizlemesi) kapağı tutulur.
function trimCovers () {
  const covers = profileState.covers
  if (covers.size <= COVER_CACHE_MAX) return
  const keep = [coverIdOf(profileState.cardUserId), coverIdOf(state.me ? state.me.id : null)]
  Array.from(covers.keys()).forEach((uploadId) => {
    if (covers.size > COVER_CACHE_MAX && keep.indexOf(uploadId) === -1) dropProfileImage(covers, uploadId)
  })
}

function coverIdOf (userId) {
  if (userId === null || userId === undefined) return null
  const profile = activeProfile(userId)
  return profile && profile.cover ? profile.cover.u : null
}

function loadProfileImage (images, userId, ref) {
  if (images.get(ref.u)) return
  const entry = { url: '', state: 'loading', at: 0, tries: 0, timer: 0, retryAt: 0, permanent: false, userId: userId, ref: ref }
  images.set(ref.u, entry)
  fetchProfileImage(images, entry)
}

function fetchProfileImage (images, entry) {
  const gen = profileState.gen
  const ref = entry.ref
  const userId = entry.userId
  entry.state = 'loading'
  entry.tries += 1
  downloadPlain({ u: ref.u, k: ref.k, n: ref.n }, null).then((res) => {
    if (gen !== profileState.gen || images.get(ref.u) !== entry) return
    entry.at = Date.now()
    if (!res.ok) {
      // 200 ile gelip çözülemeyen dosya da kalıcı hatadır
      profileImageFailed(images, entry, res.status === 404 || res.status === 200)
      return
    }
    const sniffed = window.E2EE.sniffImage(res.bytes)
    if (!sniffed || AVATAR_TYPES.indexOf(sniffed) === -1 || sniffed !== ref.m) {
      profileImageFailed(images, entry, true)
      return
    }
    entry.url = URL.createObjectURL(new Blob([res.bytes], { type: sniffed }))
    entry.state = 'ok'
    if (images === profileState.covers) {
      profileCoverReady(userId)
      return
    }
    profileState.changed.add(String(userId))
    queueProfileRender()
  })
}

function profileImageFailed (images, entry, permanent) {
  entry.state = 'failed'
  entry.permanent = permanent
  if (permanent || entry.tries >= AVATAR_TRIES) return
  retryProfileImageAt(images, entry, entry.at + AVATAR_RETRY_MS[Math.min(entry.tries, AVATAR_RETRY_MS.length) - 1])
}

// Düşen indirmenin yeniden denemesini at anına (Date.now) kurar, kurulu zamanlayıcının yerini alır
function retryProfileImageAt (images, entry, at) {
  clearTimeout(entry.timer)
  entry.retryAt = at
  entry.timer = setTimeout(() => {
    entry.timer = 0
    if (images.get(entry.ref.u) === entry) fetchProfileImage(images, entry)
  }, Math.max(0, at - Date.now()))
}

// Her başarılı poll'dan sonra (profilesAfterPoll): kalıcı olmayan bir hatayla düşmüş profil resimleri ve gösterilen
// kapaklar (açık profil kartı ve Ayarlar önizlemesindeki kendi kapağım, myCoverShown) son denemeden
// AVATAR_POLL_RETRY_MS sonra (o an geçtiyse hemen) yeniden istenir. Deneme hakkı bitmiş kayıt da böylece ağ düzelince
// gelir. Son deneme ağ düzelmeden önce düştüğü için resim ağ düzeldikten en geç 60 saniye sonra istenir. Daha geç
// kurulmuş (2 dakikalık) deneme öne çekilir, daha erken kurulmuş deneme ertelenmez. Deneme hakkı bittikten sonra
// düşmeye devam eden resim sunucudan en çok dakikada bir istenir. Hiçbir yerde görünmeyen kapak istenmez.
function profileImagesAfterPoll () {
  profileState.avatars.forEach((entry) => {
    retryProfileImageAfterPoll(profileState.avatars, entry)
  })
  const shown = [coverIdOf(profileState.cardUserId), myCoverShown() ? coverIdOf(state.me.id) : null]
  shown.forEach((uploadId) => {
    const entry = uploadId ? profileState.covers.get(uploadId) : null
    if (entry) retryProfileImageAfterPoll(profileState.covers, entry)
  })
}

// Kendi kapağım Ayarlar'da yalnızca Hesabım ve Profil sayfalarındaki önizleme kartında görünür (11-settings.js
// myProfileView ve draftCoverUrl). Kendi kartım açıksa kapak cardUserId yoluyla zaten gösterilen kapaktır.
function myCoverShown () {
  if (!state.me || typeof isSettingsTab !== 'function') return false
  return isSettingsTab('account') || isSettingsTab('profile')
}

function retryProfileImageAfterPoll (images, entry) {
  if (entry.state !== 'failed' || entry.permanent) return
  const at = Math.max(Date.now(), entry.at + AVATAR_POLL_RETRY_MS)
  if (entry.timer && entry.retryAt <= at) return
  retryProfileImageAt(images, entry, at)
}

function dropProfileImage (images, uploadId) {
  const entry = images.get(uploadId)
  if (!entry) return
  images.delete(uploadId)
  clearTimeout(entry.timer)
  revokeLater(entry.url)
}

function dropAvatar (uploadId) {
  dropProfileImage(profileState.avatars, uploadId)
}

// Kapak geldi: yalnızca o kişinin açık kartındaki bant değişir (kapak başka yüzeyde yoktur, profil sürümü artmaz).
// Ayarlar önizlemesi sayfa imzasıyla (myProfileSignature) kendiliğinden yenilenir.
function profileCoverReady (userId) {
  if (profileState.cardUserId !== null && sameId(profileState.cardUserId, userId)) refreshProfileCardCover()
}

function avatarUrlOf (userId) {
  const profile = activeProfile(userId)
  const ref = profile ? profile.avatar : null
  if (!ref) return null
  const entry = profileState.avatars.get(ref.u)
  return entry && entry.state === 'ok' ? entry.url : null
}

// Kişinin kapak fotoğrafının blob adresi (yoksa veya henüz inmediyse null). load: kapak gösterilecek, inmemişse
// indirmeye başlanır (profil kartı ve Ayarlar önizlemesi).
function coverUrlOf (userId, load) {
  const profile = activeProfile(userId)
  const ref = profile ? profile.cover : null
  if (!ref) return null
  if (load) loadCover(profileRecord(userId))
  const entry = profileState.covers.get(ref.u)
  return entry && entry.state === 'ok' ? entry.url : null
}

// Profil kartının renk bandı. Kapak fotoğrafı varsa bandın içinde durur (components.css .profile-card-cover), yoksa
// profil rengi görünür. Profil kartı ve Ayarlar'daki önizleme kartları kullanır. Yalnızca blob adresi kabul edilir.
function profileCoverBand (url, colorIndex) {
  const band = h('div', 'profile-card-band')
  band.setAttribute('data-color', String(colorIndex))
  if (typeof url === 'string' && url.indexOf('blob:') === 0) {
    band.classList.add('has-cover')
    const img = h('img', 'profile-card-cover')
    img.alt = ''
    img.src = url
    band.appendChild(img)
  }
  return band
}

// Profil değişince görünür bölgeler bir sonraki karede yeniden çizilir. Profil sürümü hemen artar, böylece arada
// çizilen önbellekli yüzeyler de değişikliği görür.
function queueProfileRender () {
  profileState.epoch += 1
  if (profileState.renderQueued) return
  profileState.renderQueued = true
  nextFrame(() => {
    profileState.renderQueued = false
    const changed = new Set(profileState.changed)
    profileState.changed.clear()
    if (!changed.size || !state.inApp) return
    profilesChanged(changed)
  })
}

// renderVoiceAll kadroyu, İstasyonlar'daki kişileri, yayın sahnesini (castSync, kameralar ızgarası) ve açık kişi ses
// kartının başlığını (aşağıdaki ses kancası) yeniden çizer. Telsiz DJ kuyruğundaki ekleyen adı ve Bildirimler listesi
// ad ve avatarı çizim anında okur, burada yeniden çizilir.
function profilesChanged (changed) {
  renderMembers()
  renderUserPanel()
  renderVoiceAll()
  if (typeof djRenderSoon === 'function') djRenderSoon()
  profileActivityRefresh(changed)
  if (state.messages.some((m) => changed.has(String(m.authorId)))) refreshAllMessages()
  socialRender()
  if (profileState.cardUserId !== null && changed.has(String(profileState.cardUserId))) refreshProfileCard()
  if (isDmChannel(state.channelId)) {
    const partner = dmPartner(state.channelId)
    if (partner !== null && changed.has(String(partner))) {
      decryptCache.clear()
      refreshAllMessages()
    }
  }
}

// Bildirimler listesi (28-bildirim.js renderActivity) baştan kurulur, bu yüzden yalnızca kayıtlarından birinin kişisi
// değiştiyse yeniden çizilir. Odak listedeki bir İzle düğmesindeyse yeni listede aynı satırın düğmesine geri verilir
// (profil değişikliği klavyeyle gezen kişinin yerini kaybettirmez). Kayıtların sırası profil değişikliğiyle değişmez.
function profileActivityRefresh (changed) {
  if (typeof renderActivity !== 'function' || typeof activityState === 'undefined') return
  if (!activityState.items.some((item) => changed.has(String(item.userId)))) return
  const list = el.activityList
  const active = document.activeElement
  const row = list && active && list.contains(active) ? Array.from(list.children).findIndex((li) => li.contains(active)) : -1
  renderActivity()
  const again = row === -1 ? null : list.children[row]
  const watch = again ? again.querySelector('.activity-watch') : null
  if (watch) focusNode(watch)
}

// Ses odasındaki kişinin açık ses kartının başlığı (#peer-name) yalnızca açılırken yazılır (10-voice.js
// openPeerPopover). Telsiz kartı her yeniden çizildiğinde, profil değişikliğinden sonra da, güncel ad yazılır.
function profilePeerNameHook () {
  if (typeof popoverUserId === 'undefined' || popoverUserId === null || !el.peerName) return
  const name = shownName(popoverUserId)
  if (el.peerName.textContent !== name) el.peerName.textContent = name
}

if (typeof voiceHook === 'function') voiceHook('render', profilePeerNameHook)

// Görsel yardımcılar (tema tarafındaki çizim fonksiyonları da kullanır)

// Kullanıcı adı: meta veya sunucudan engellenenler listesi. İkisinde de yoksa hesap silinmiştir.
function userBaseName (userId) {
  const user = metaUser(userId)
  if (user && user.name) return String(user.name)
  const former = profileState.formerUsers.get(String(userId))
  if (former) return former
  return ''
}

// Görünen ad yalnızca listedeki (silinmemiş ve engellenmemiş) kullanıcılar için kullanılır
function activeProfile (userId) {
  if (!metaUser(userId)) return null
  const rec = profileRecord(userId)
  return rec && !rec.missing && rec.profile ? rec.profile : null
}

function userDisplayName (userId) {
  const profile = activeProfile(userId)
  if (profile && profile.displayName) return profile.displayName
  return userBaseName(userId) || t('profile.deletedUser')
}

function userHandle (userId) {
  const name = userBaseName(userId)
  return name ? '@' + name : ''
}

function userColorIndex (userId) {
  const profile = activeProfile(userId)
  if (profile && profile.color !== null) return profile.color
  const n = Number(avatarClass(userId).slice('avatar-c'.length))
  return isFinite(n) ? n : 0
}

function userAvatarInfo (userId) {
  return { initial: initial(userDisplayName(userId)), colorIndex: userColorIndex(userId), blobUrl: avatarUrlOf(userId) }
}

function myChosenStatus () {
  const status = state.me && typeof state.me.status === 'string' ? state.me.status : 'online'
  return STATUS_CHOICES.indexOf(status) !== -1 ? status : 'online'
}

function userStatus (userId) {
  if (state.me && sameId(userId, state.me.id)) {
    const mine = myChosenStatus()
    return mine === 'invisible' ? 'offline' : mine
  }
  const user = metaUser(userId)
  if (!user) return 'offline'
  if (typeof user.status === 'string' && SHOWN_STATUSES.indexOf(user.status) !== -1) return user.status
  return user.online === true ? 'online' : 'offline'
}

function statusLabel (status) {
  if (status === 'idle') return t('status.idle')
  if (status === 'dnd') return t('status.dnd')
  if (status === 'invisible') return t('status.invisible')
  if (status === 'offline') return t('status.offline')
  return t('status.online')
}

function userStatusText (userId) {
  const profile = activeProfile(userId)
  return profile ? profile.statusText : ''
}

// Avatar öğesi: tema yardımcısı avatar(userId, size) varsa o, yoksa baş harf ve renkli yedek
function personAvatar (userId, size) {
  if (typeof avatar === 'function' && avatar.length <= 2) {
    try {
      const node = avatar(userId, size)
      if (node) return node
    } catch (err) {
      window.console.error(err)
    }
  }
  const info = userAvatarInfo(userId)
  const span = h('span', 'avatar avatar-c' + info.colorIndex + (size === 'lg' || size === 'xl' ? ' avatar-large' : size === 'sm' ? ' avatar-small' : ''))
  span.setAttribute('aria-hidden', 'true')
  span.setAttribute('data-status', userStatus(userId))
  if (info.blobUrl) {
    const img = h('img', 'avatar-img')
    img.alt = ''
    img.src = info.blobUrl
    span.appendChild(img)
  } else {
    span.textContent = info.initial
  }
  return span
}

function statusDot (status) {
  const dot = h('span', 'status-dot')
  dot.setAttribute('data-status', status)
  dot.setAttribute('aria-hidden', 'true')
  return dot
}

// Ad veya avatar gibi satır içi öğeye profil kartı açma davranışı ekler (düğme rolüyle)
function makeUserLink (node, userId) {
  node.classList.add('user-link')
  node.setAttribute('role', 'button')
  node.tabIndex = 0
  node.setAttribute('aria-haspopup', 'dialog')
  node.setAttribute('data-user-id', String(userId))
  node.addEventListener('click', (e) => {
    e.stopPropagation()
    openProfileCard(userId, node)
  })
  node.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openProfileCard(userId, node)
    }
  })
  return node
}

// Ortak pencere (#dialog-root): güvenlik numarası ve kimlik açma pencereleri.
// opts: { name, titleKey, titleParams, trigger, build(body, close) -> ilk odak, onClose(reason) }

let dialogSeq = 0

function openAppDialog (opts) {
  const root = byId('dialog-root')
  if (!root) return null
  const existing = findLayer('app-dialog')
  if (existing) closeLayer(existing, false)
  dialogSeq += 1
  const titleId = 'app-dialog-title-' + dialogSeq
  const backdrop = h('div', 'modal app-dialog-backdrop')
  backdrop.setAttribute('data-dialog', opts.name || '')
  const dialog = h('div', 'modal-dialog app-dialog')
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.setAttribute('aria-labelledby', titleId)
  dialog.id = (opts.name || 'app') + '-dialog'
  const head = h('div', 'app-dialog-head')
  const title = h('h2', 'section-heading app-dialog-title', t(opts.titleKey, opts.titleParams))
  title.id = titleId
  head.appendChild(title)
  const closeBtn = button('icon-button app-dialog-close', '', 'i-close', t('common.close'))
  head.appendChild(closeBtn)
  dialog.appendChild(head)
  const body = h('div', 'app-dialog-body')
  dialog.appendChild(body)
  backdrop.appendChild(dialog)
  let reason = 'dismiss'
  let layer = null
  const close = (why) => {
    reason = why || 'dismiss'
    if (layer) closeLayer(layer, true)
  }
  const first = opts.build(body, close)
  clear(root)
  root.appendChild(backdrop)
  root.hidden = false
  closeBtn.addEventListener('click', () => {
    close('dismiss')
  })
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close('dismiss')
  })
  layer = {
    name: 'app-dialog',
    el: dialog,
    trigger: opts.trigger || null,
    level: 3,
    trap: true,
    initialFocus: () => first || closeBtn,
    onClose: () => {
      if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop)
      if (!root.firstChild) root.hidden = true
      if (typeof opts.onClose === 'function') opts.onClose(reason)
    }
  }
  openLayer(layer)
  return { close: close, body: body }
}

function closeAppDialog () {
  const layer = findLayer('app-dialog')
  if (layer) closeLayer(layer, false)
}

// Profil kartı (#profile-card)

function openProfileCard (userId, anchorEl) {
  const card = byId('profile-card')
  if (!card || userId === null || userId === undefined) return
  const existing = findLayer('profile-card')
  if (existing) {
    const same = sameId(profileState.cardUserId, userId)
    closeLayer(existing, false)
    if (same) return
  }
  closeStatusMenu()
  profileState.cardUserId = userId
  profileState.cardTrigger = anchorEl || null
  profilesEnsure([userId])
  buildProfileCard(card, userId)
  card.hidden = false
  card.setAttribute('role', 'dialog')
  card.setAttribute('aria-labelledby', 'profile-card-name')
  if (anchorEl) positionPopup(card, anchorEl)
  openLayer({
    name: 'profile-card',
    el: card,
    trigger: anchorEl || null,
    level: 2,
    outside: true,
    trap: true,
    onClose: () => {
      card.hidden = true
      clear(card)
      profileState.cardUserId = null
      profileState.cardTrigger = null
    }
  })
}

function closeProfileCard () {
  const layer = findLayer('profile-card')
  if (layer) closeLayer(layer, false)
}

// Kart sahibinin ses odası denetimi durumu: herkes için susturulmuş mu, kamerası açık mı
function cardModKey (userId) {
  const rec = metaRecordOf(userId)
  return (rec && rec.voiceMuted ? 'm' : '-') + (userCameraOn(userId) ? 'c' : '-')
}

function refreshProfileCard () {
  const card = byId('profile-card')
  if (!card || profileState.cardUserId === null || card.hidden) return
  const focusKey = activeFocusKey(card)
  buildProfileCard(card, profileState.cardUserId)
  restoreFocusKey(card, focusKey)
}

// Kapak inince açık kartın yalnızca renk bandı yenilenir. Kart bütünüyle yeniden kurulmaz, böylece kartta sürüklenen
// ses düzeyi kaydırıcısı ve odak yerinde kalır.
function refreshProfileCardCover () {
  const card = byId('profile-card')
  const userId = profileState.cardUserId
  if (!card || userId === null || card.hidden) return
  const band = card.querySelector('.profile-card-band')
  if (!band || band.parentNode !== card) return
  card.replaceChild(profileCoverBand(coverUrlOf(userId, false), userColorIndex(userId)), band)
}

// Profil kimliği (istek 9): avatar solda, sağında iki satırlı bir sütun. Üst satırda görünen ad ve hemen yanında rol
// rozetleri (ad uzunsa rozetler alt satıra kayar), alt satırda @kullanıcı adı. Profil kartı, Ayarlar'daki iki önizleme
// kartı ve avatar menüsünün başı bu yardımcıyı kullanır, düzen components.css .profile-identity kurallarındadır.
// avatarNode: avatar öğesi. name ve handle: çağıranın etiket, kimlik ve sınıfla kurduğu ad ve @kullanıcı adı öğeleri
// (handle null olabilir). badges: rozet öğeleri, null olanlar atlanır.
function buildProfileIdentity (avatarNode, name, handle, badges) {
  const row = h('div', 'profile-identity')
  row.appendChild(avatarNode)
  const text = h('div', 'profile-identity-text')
  const line = h('div', 'profile-identity-line')
  name.classList.add('profile-identity-name')
  line.appendChild(name)
  const list = (badges || []).filter(Boolean)
  if (list.length) {
    const box = h('span', 'profile-identity-badges')
    list.forEach((badge) => {
      box.appendChild(badge)
    })
    line.appendChild(box)
  }
  text.appendChild(line)
  if (handle) {
    handle.classList.add('profile-identity-handle')
    text.appendChild(handle)
  }
  row.appendChild(text)
  return row
}

// Kartlardaki rol rozetleri: temel rol (sahip ve yönetici rozeti, düz üyede soluk "Üye" rozeti) ve varsa özel rol.
// roleBadge üyede boş döner, mesaj akışı ve Çevrimiçi listesi bu yüzden değişmez.
function profileBadges (userId, role) {
  const base = role === 'member' ? h('span', 'badge badge-member', roleLabel(role)) : roleBadge(role)
  return [base, customRoleBadge(userId)]
}

function buildProfileCard (card, userId) {
  clear(card)
  profileState.cardModKey = cardModKey(userId)
  const profile = activeProfile(userId)
  const self = Boolean(state.me && sameId(userId, state.me.id))
  const status = userStatus(userId)
  card.classList.toggle('is-own', self)
  card.setAttribute('data-user-id', String(userId))
  card.appendChild(profileCoverBand(coverUrlOf(userId, true), userColorIndex(userId)))
  const av = h('span', 'avatar-wrap profile-card-avatar')
  av.setAttribute('data-status', status)
  av.appendChild(personAvatar(userId, 'xl'))
  const name = h('h2', 'profile-card-name', userDisplayName(userId))
  name.id = 'profile-card-name'
  const handle = userHandle(userId)
  const user = metaUser(userId)
  const head = buildProfileIdentity(av, name, handle ? h('p', 'profile-card-handle', handle) : null, user ? profileBadges(userId, user.role) : [])
  head.classList.add('profile-card-head')
  card.appendChild(head)
  const body = h('div', 'profile-card-body')
  const statusRow = h('p', 'profile-card-status')
  statusRow.setAttribute('data-status', status)
  statusRow.appendChild(statusDot(status))
  statusRow.appendChild(h('span', 'profile-card-status-label', statusLabel(self ? myChosenStatus() : status)))
  if (profile && profile.statusText) {
    statusRow.appendChild(h('span', 'profile-card-status-text', profile.statusText))
  }
  body.appendChild(statusRow)
  if (profile && profile.bio) {
    const section = h('div', 'profile-card-section')
    section.appendChild(h('h3', 'profile-card-label', t('profile.about')))
    section.appendChild(h('p', 'profile-card-bio', profile.bio))
    body.appendChild(section)
  }
  if (!self && isBlocked(userId)) body.appendChild(h('p', 'profile-card-note hint', t('social.blockedNote')))
  if (!self) {
    const voiceSection = buildCardVoice(userId)
    if (voiceSection) body.appendChild(voiceSection)
  }
  body.appendChild(buildCardActions(userId, self))
  card.appendChild(body)
}

// Kişi aynı ses kanalındaysa ses seviyesi ve yerel susturma
function buildCardVoice (userId) {
  if (!voice) return null
  const s = snap()
  const peer = s.peers ? s.peers[String(userId)] : null
  if (!s.channelId || !peer) return null
  const section = h('div', 'profile-card-section profile-card-voice')
  const value = peerVolumeValue(userId)
  const label = h('label', 'label')
  label.setAttribute('for', 'profile-card-volume')
  label.appendChild(h('span', '', t('peer.volume')))
  label.appendChild(document.createTextNode(' '))
  const valueText = h('span', 'profile-card-volume-value', formatPercent(value))
  label.appendChild(valueText)
  section.appendChild(label)
  const range = h('input', 'range')
  range.id = 'profile-card-volume'
  range.type = 'range'
  range.min = '0'
  range.max = String(PEER_VOLUME_MAX_PCT)
  range.step = '1'
  range.value = String(value)
  range.setAttribute('data-focus-key', 'card-volume')
  const onRange = () => {
    const v = clampPeerVolume(range.value)
    valueText.textContent = formatPercent(v)
    const stored = storeGetJson(KEYS.peerVolume, {})
    stored[String(userId)] = v
    storeSetJson(KEYS.peerVolume, stored)
    try {
      voice.setPeerVolume(voiceUserArg(userId), v / 100)
    } catch (err) {
      // Eş bağlı değil, değer saklandı
    }
  }
  range.addEventListener('input', onRange)
  range.addEventListener('change', onRange)
  section.appendChild(range)
  const muted = Boolean(peer.localMute)
  const mute = button('button button-secondary button-small profile-card-mute', t(muted ? 'peer.unmute' : 'peer.mute'))
  mute.setAttribute('aria-pressed', muted ? 'true' : 'false')
  mute.setAttribute('data-focus-key', 'card-mute')
  mute.addEventListener('click', () => {
    voice.setPeerLocalMute(voiceUserArg(userId), !muted)
    nextFrame(refreshProfileCard)
  })
  section.appendChild(mute)
  // Ses odası denetimi izni olan, kişiden üst rütbedeyse herkes için susturur, kamerasını kapatır (yalnızca kamerası
  // açıkken) veya odadan çıkarır
  if (typeof moderateVoice === 'function' && hasPerm('voice') && outranksUser(userId)) {
    const rec = metaRecordOf(userId)
    const serverMuted = Boolean(rec && rec.voiceMuted)
    const serverMute = button('button button-secondary button-small profile-card-server-mute', t(serverMuted ? 'peer.serverUnmute' : 'peer.serverMute'))
    serverMute.setAttribute('aria-pressed', serverMuted ? 'true' : 'false')
    serverMute.setAttribute('data-focus-key', 'card-server-mute')
    serverMute.addEventListener('click', async () => {
      await moderateVoice(userId, serverMuted ? 'unmute' : 'mute', null, serverMute)
      nextFrame(refreshProfileCard)
    })
    section.appendChild(serverMute)
    if (userCameraOn(userId)) {
      const camOff = button('button button-secondary button-small profile-card-camera-off', t('peer.cameraOff'))
      camOff.setAttribute('data-focus-key', 'card-camera-off')
      camOff.addEventListener('click', async () => {
        await moderateVoice(userId, 'camera-off', null, camOff)
        nextFrame(refreshProfileCard)
      })
      section.appendChild(camOff)
    }
    const kick = button('button button-danger button-small profile-card-disconnect', t('peer.disconnect'))
    kick.setAttribute('data-focus-key', 'card-disconnect')
    kick.addEventListener('click', async () => {
      await moderateVoice(userId, 'disconnect', null, kick)
      nextFrame(refreshProfileCard)
    })
    section.appendChild(kick)
  }
  return section
}

function cardButton (className, key, focusKey, handler) {
  const b = button('button button-small ' + className, t(key))
  b.setAttribute('data-focus-key', focusKey)
  b.addEventListener('click', handler)
  return b
}

function buildCardActions (userId, self) {
  const actions = h('div', 'profile-card-actions')
  if (self) {
    actions.appendChild(cardButton('button-secondary card-status', 'status.change', 'card-status', () => {
      const trigger = profileState.cardTrigger
      closeProfileCard()
      openStatusMenu(trigger || el.meAvatar)
    }))
    actions.appendChild(cardButton('button-secondary card-edit', 'profile.edit', 'card-edit', () => {
      closeProfileCard()
      openProfileEditor()
    }))
    return actions
  }
  const deleted = !metaUser(userId) && !profileState.formerUsers.has(String(userId))
  if (deleted) return actions
  const blocked = isBlocked(userId)
  if (!blocked) {
    if (isFriend(userId)) {
      actions.appendChild(cardButton('button-secondary card-unfriend', 'social.removeFriend', 'card-unfriend', () => {
        removeFriend(userId)
      }))
    } else if (hasIncoming(userId)) {
      actions.appendChild(cardButton('card-accept', 'social.accept', 'card-accept', () => {
        acceptFriend(userId)
      }))
    } else if (hasOutgoing(userId)) {
      const sent = cardButton('button-secondary card-sent', 'social.requestSent', 'card-sent', () => {})
      sent.disabled = true
      actions.appendChild(sent)
    } else {
      actions.appendChild(cardButton('card-add', 'social.addFriend', 'card-add', () => {
        sendFriendRequest({ userId: userId })
      }))
    }
    actions.appendChild(cardButton('card-message', 'social.message', 'card-message', () => {
      closeProfileCard()
      openDmWith(userId)
    }))
  }
  actions.appendChild(cardButton(blocked ? 'button-secondary card-unblock' : 'button-danger card-block', blocked ? 'social.unblock' : 'social.block', 'card-block', () => {
    if (blocked) unblockUser(userId)
    else blockUser(userId)
  }))
  return actions
}

// Profil düzenleme sayfası ayarlar görünümündedir. O görünüm yoksa hesap sekmesi açılır.
function openProfileEditor () {
  if (typeof openSettings === 'function') openSettings('profile', el.meButton)
}

// Avatar menüsü (#status-menu, KONSEPT 6.8): üst çubuktaki avatar çipinden açılır. Baş kısım (avatar, ad ve
// yanında rol rozetleri, altında @kullanıcı adı), durum seçenekleri, özel durum, profil düzenleme, ayarlar, görünüm, dil ve çıkış.
// Ayarlara giriş tektir ve her ekranda aynı yerdedir.

function openStatusMenu (anchorEl) {
  const menu = byId('status-menu')
  if (!menu || !state.me) return
  const existing = findLayer('status-menu')
  if (existing) {
    closeLayer(existing, false)
    return
  }
  closeProfileCard()
  buildStatusMenu(menu)
  menu.classList.add('avatar-menu')
  menu.hidden = false
  menu.setAttribute('role', 'menu')
  menu.setAttribute('aria-label', t('layout.statusMenu', { name: userDisplayName(state.me.id) }))
  if (anchorEl) {
    positionPopup(menu, anchorEl)
    anchorEl.setAttribute('aria-expanded', 'true')
  }
  openLayer({
    name: 'status-menu',
    el: menu,
    trigger: anchorEl || null,
    level: 2,
    outside: true,
    closeOnFocusOut: true,
    initialFocus: () => menu.querySelector('[aria-checked="true"]') || menu.querySelector('button'),
    onClose: () => {
      menu.hidden = true
      clear(menu)
      if (anchorEl) anchorEl.setAttribute('aria-expanded', 'false')
    }
  })
}

function closeStatusMenu () {
  const layer = findLayer('status-menu')
  if (layer) closeLayer(layer, false)
}

function buildStatusMenu (menu) {
  clear(menu)
  const handle = userHandle(state.me.id)
  const head = buildProfileIdentity(personAvatar(state.me.id, 'lg'), h('span', 'menu-head-name', userDisplayName(state.me.id)), handle ? h('span', 'menu-head-sub', handle) : null, profileBadges(state.me.id, state.me.role))
  head.classList.add('menu-head')
  menu.appendChild(head)
  // Durum seçenekleri tek seçimli bir grup: seçili olanda onay işareti
  const current = myChosenStatus()
  const group = h('div', 'avatar-menu-statuses')
  group.setAttribute('role', 'group')
  group.setAttribute('aria-label', t('status.menuLabel'))
  STATUS_CHOICES.forEach((status) => {
    const item = h('button', 'menu-item status-option')
    item.type = 'button'
    item.setAttribute('role', 'menuitemradio')
    item.setAttribute('aria-checked', status === current ? 'true' : 'false')
    item.setAttribute('data-status', status)
    item.appendChild(statusDot(status === 'invisible' ? 'offline' : status))
    const text = h('span', 'status-option-text')
    text.appendChild(h('span', 'status-option-label', statusLabel(status)))
    if (status === 'dnd' || status === 'invisible') {
      text.appendChild(h('span', 'status-option-hint', t(status === 'dnd' ? 'status.dndHint' : 'status.invisibleHint')))
    }
    item.appendChild(text)
    if (status === current) item.appendChild(icon('i-check', 'avatar-menu-check'))
    item.addEventListener('click', () => {
      closeStatusMenu()
      setMyStatus(status)
    })
    group.appendChild(item)
  })
  menu.appendChild(group)
  const custom = h('button', 'menu-item status-custom')
  custom.type = 'button'
  custom.setAttribute('role', 'menuitem')
  custom.appendChild(icon('i-edit'))
  custom.appendChild(h('span', 'menu-entry-label', t('status.custom')))
  custom.addEventListener('click', () => {
    const layer = findLayer('status-menu')
    const trigger = layer ? layer.trigger : null
    closeStatusMenu()
    openCustomStatusDialog(trigger)
  })
  menu.appendChild(custom)
  menu.appendChild(menuSeparator())
  const edit = h('button', 'menu-item status-edit-profile')
  edit.type = 'button'
  edit.setAttribute('role', 'menuitem')
  edit.appendChild(icon('i-user'))
  edit.appendChild(h('span', 'menu-entry-label', t('profile.edit')))
  edit.addEventListener('click', () => {
    closeStatusMenu()
    openProfileEditor()
  })
  menu.appendChild(edit)
  const theme = window.TelsizTheme && typeof window.TelsizTheme.get === 'function' ? window.TelsizTheme.get() : null
  const skin = theme && theme.skin ? theme.skin : 'arcade'
  const scheme = theme && theme.resolvedScheme === 'light' ? 'light' : 'dark'
  menu.appendChild(menuEntry('menu-settings', 'i-gear', t('settings.title'), t('top.menuSettingsSub'), () => {
    openSettings(null, el.meButton)
  }))
  menu.appendChild(menuEntry('menu-appearance', 'i-palette', t('top.menuAppearance'), t('top.menuAppearanceSub', { skin: t('theme.skin.' + skin), scheme: t('theme.scheme.' + scheme) }), () => {
    openSettings('appearance', el.meButton)
  }))
  menu.appendChild(menuEntry('menu-language', 'i-globe', t('settings.appearance.language'), t('top.langName'), () => {
    openSettings('appearance', el.meButton)
  }))
  menu.appendChild(menuSeparator())
  const out = menuEntry('menu-logout', 'i-logout', t('auth.logout'), '', () => {
    logout()
  })
  out.classList.add('menu-danger')
  menu.appendChild(out)
  menu.addEventListener('keydown', onPopupMenuKey)
}

function menuSeparator () {
  const sep = h('div', 'menu-separator')
  sep.setAttribute('role', 'separator')
  return sep
}

// Avatar menüsünün gezinme öğesi: simge, ad ve isteğe bağlı sağda kısa bilgi
function menuEntry (id, iconName, label, end, handler) {
  const item = h('button', 'menu-item menu-entry')
  item.type = 'button'
  item.id = id
  item.setAttribute('role', 'menuitem')
  item.appendChild(icon(iconName))
  item.appendChild(h('span', 'menu-entry-label', label))
  if (end) item.appendChild(h('span', 'menu-entry-end', end))
  item.addEventListener('click', () => {
    closeStatusMenu()
    handler()
  })
  return item
}

// Açılır menülerde ok tuşlarıyla gezinme
function onPopupMenuKey (e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return
  e.preventDefault()
  const items = focusables(e.currentTarget)
  if (!items.length) return
  let i = items.indexOf(document.activeElement)
  if (e.key === 'ArrowDown') i = (i + 1) % items.length
  else if (e.key === 'ArrowUp') i = (i - 1 + items.length) % items.length
  else if (e.key === 'Home') i = 0
  else i = items.length - 1
  focusNode(items[i])
}

async function setMyStatus (status) {
  if (!state.me || STATUS_CHOICES.indexOf(status) === -1) return
  const before = myChosenStatus()
  if (before === status) return
  state.me.status = status
  renderUserPanel()
  renderMembers()
  const res = await api('POST', '/api/me/status', { status: status })
  if (res.status === 200) {
    if (socialState.priv) socialState.priv.status = status
    return
  }
  if (state.me) state.me.status = before
  renderUserPanel()
  renderMembers()
  toast(() => errorText(res, t('status.failed')), 'error')
}

// Kayıttan sonraki isteğe bağlı profil adımı: görünen ad. Profil grup anahtarıyla şifrelendiği için
// yalnızca anahtar bu cihazdayken sorulur, sonradan Ayarlar > Profil'den değiştirilebilir.
function openProfileStep () {
  if (!state.me || !hasActiveKey()) return
  openAppDialog({
    name: 'profile-step',
    titleKey: 'profile.stepTitle',
    build: (body, close) => {
      body.appendChild(h('p', 'lead', t('profile.stepLead')))
      const form = h('form', 'form profile-step-form')
      form.id = 'profile-step-form'
      form.noValidate = true
      const label = h('label', 'label', t('profile.displayName'))
      label.setAttribute('for', 'profile-step-name')
      const input = h('input', 'input')
      input.id = 'profile-step-name'
      input.type = 'text'
      input.maxLength = PROFILE_NAME_MAX * 2
      input.autocomplete = 'nickname'
      input.setAttribute('placeholder', t('profile.displayNamePlaceholder'))
      form.appendChild(label)
      form.appendChild(input)
      form.appendChild(h('p', 'hint', t('profile.stepHint', { name: userHandle(state.me.id) })))
      const msg = h('p', 'form-error')
      msg.id = 'profile-step-error'
      msg.setAttribute('role', 'alert')
      msg.hidden = true
      form.appendChild(msg)
      const row = h('div', 'row dialog-actions')
      const save = button('button', t('common.save'))
      save.type = 'submit'
      save.id = 'profile-step-save'
      const skip = button('button button-secondary', t('profile.stepSkip'))
      skip.id = 'profile-step-skip'
      skip.addEventListener('click', () => {
        close('skip')
      })
      row.appendChild(save)
      row.appendChild(skip)
      form.appendChild(row)
      form.addEventListener('submit', async (e) => {
        e.preventDefault()
        if (form.classList.contains('is-busy')) return
        const name = cleanLine(input.value, 1000)
        if (!name) {
          close('skip')
          return
        }
        setFormBusy(form, true)
        const result = await saveProfile({ displayName: name, statusText: '', bio: '', color: null })
        setFormBusy(form, false)
        if (!result.ok) {
          setMsg(msg, result.error, 'error')
          focusNode(input)
          return
        }
        close('done')
        toast(() => t('profile.stepSaved'), 'ok')
      })
      body.appendChild(form)
      return input
    }
  })
}

// Özel durum metni (ör. "Valorant oynuyor"): profilin diğer alanları korunarak kaydedilir
function openCustomStatusDialog (trigger) {
  if (!state.me) return
  const rec = profileRecord(state.me.id)
  const current = rec && rec.profile ? rec.profile : null
  openAppDialog({
    name: 'custom-status',
    titleKey: 'status.customTitle',
    trigger: trigger,
    build: (body, close) => {
      const form = h('form', 'form custom-status-form')
      form.id = 'custom-status-form'
      form.noValidate = true
      const label = h('label', 'label', t('status.customLabel'))
      label.setAttribute('for', 'custom-status-input')
      const input = h('input', 'input')
      input.id = 'custom-status-input'
      input.type = 'text'
      input.maxLength = PROFILE_STATUS_MAX
      input.setAttribute('placeholder', t('status.customPlaceholder'))
      input.value = current ? current.statusText : ''
      form.appendChild(label)
      form.appendChild(input)
      form.appendChild(h('p', 'hint', t('status.customHint', { max: PROFILE_STATUS_MAX })))
      const msg = h('p', 'form-error')
      msg.id = 'custom-status-error'
      msg.setAttribute('role', 'alert')
      msg.hidden = true
      form.appendChild(msg)
      const row = h('div', 'row dialog-actions')
      const save = button('button', t('common.save'))
      save.type = 'submit'
      save.id = 'custom-status-save'
      const clearBtn = button('button button-secondary', t('status.customClear'))
      clearBtn.id = 'custom-status-clear'
      row.appendChild(save)
      row.appendChild(clearBtn)
      form.appendChild(row)
      const store = async (text) => {
        if (form.classList.contains('is-busy')) return
        setFormBusy(form, true)
        const latest = profileRecord(state.me.id)
        const base = latest && latest.profile ? latest.profile : current
        const result = await saveProfile({
          displayName: base ? base.displayName : '',
          statusText: text,
          bio: base ? base.bio : '',
          color: base ? base.color : null
        })
        setFormBusy(form, false)
        if (!result.ok) {
          setMsg(msg, result.error, 'error')
          return
        }
        close('done')
        toast(() => t('status.customSaved'), 'ok')
      }
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        store(input.value)
      })
      clearBtn.addEventListener('click', () => {
        input.value = ''
        store('')
      })
      body.appendChild(form)
      return input
    }
  })
}

// Kendi profilini kaydetme. avatarFile ve coverFile: undefined (değişmez), null (kaldırılır) veya resim dosyası.
// Görünen ad, durum metni ve hakkımda grup anahtarıyla şifrelenir, profil resmi kare kırpılıp
// 256x256 boyutunda, kapak fotoğrafı 3:1 kırpılıp 1200x400 boyutunda yeniden kodlanır (üst veri silinir) ve
// ikisi de kendi dosya anahtarıyla şifrelenir.
async function saveProfile (input) {
  const data = input || {}
  if (!state.me) return { ok: false, error: () => t('profile.saveFailed') }
  const kid = activeKid()
  if (!kid || !hasActiveKey()) return { ok: false, error: () => t('profile.needKey') }
  const displayName = cleanLine(data.displayName, 1000)
  const statusText = cleanLine(data.statusText, 1000)
  const bio = cleanBio(String(data.bio || '').slice(0, 4000))
  if (cpLength(displayName) > PROFILE_NAME_MAX) return { ok: false, error: () => t('profile.nameTooLong', { max: PROFILE_NAME_MAX }) }
  if (cpLength(statusText) > PROFILE_STATUS_MAX) return { ok: false, error: () => t('profile.statusTooLong', { max: PROFILE_STATUS_MAX }) }
  if (cpLength(String(data.bio || '').trim()) > PROFILE_BIO_MAX) return { ok: false, error: () => t('profile.bioTooLong', { max: PROFILE_BIO_MAX }) }
  const color = cleanColor(typeof data.color === 'number' ? data.color : null)
  const gen = profileState.gen
  const userId = String(state.me.id)
  const base = ownImageBase(profileRecord(userId))
  let avatarRef = base.avatar
  let avatarUploadId = avatarRef ? avatarRef.u : null
  if (data.avatarFile === null) {
    avatarRef = null
    avatarUploadId = null
  } else if (data.avatarFile) {
    const made = await uploadAvatar(data.avatarFile)
    if (!made.ok) return made
    avatarRef = made.ref
    avatarUploadId = made.ref.u
  }
  let coverRef = base.cover
  if (data.coverFile === null) {
    coverRef = null
  } else if (data.coverFile) {
    const made = await uploadCover(data.coverFile)
    if (!made.ok) return made
    coverRef = made.ref
  }
  const plain = {
    v: 1,
    u: Number(state.me.id),
    displayName: displayName,
    statusText: statusText,
    bio: bio,
    color: color,
    avatar: avatarRef ? { u: avatarRef.u, k: avatarRef.k, n: avatarRef.n, m: avatarRef.m, w: AVATAR_EDGE, h: AVATAR_EDGE } : null,
    cover: coverRef ? { u: coverRef.u, k: coverRef.k, n: coverRef.n, m: coverRef.m, w: COVER_W, h: COVER_H } : null
  }
  let envelope = ''
  try {
    envelope = window.E2EE.sealJson(kid, plain)
  } catch (err) {
    return { ok: false, error: () => t('profile.saveFailed') }
  }
  const maxChars = state.info && state.info.limits && typeof state.info.limits.maxProfileChars === 'number' ? state.info.limits.maxProfileChars : 6000
  if (envelope.length > maxChars) return { ok: false, error: () => t('profile.tooLarge') }
  const res = await api('POST', '/api/me/profile', { profile: envelope, avatarUploadId: avatarUploadId, coverUploadId: coverRef ? coverRef.u : null })
  if (res.status !== 200) {
    return { ok: false, error: () => errorText(res, t('profile.saveFailed'), { rate_limited: t('profile.rateLimited') }) }
  }
  rememberOwnSave(gen, userId, res.data, avatarRef, coverRef)
  profilesRefetch([userId])
  return { ok: true }
}

// Kaydın değişmeyen profil resmi ve kapağı. Önceki kayıttan sonra kendi profil kaydım henüz yenilenmediyse (yenileme
// isteği düşebilir, sürümü son kaydınkinden eskidir) resimler son başarılı kayıttan alınır. Eski kayıttaki başvuru
// gönderilseydi sunucuda silinmiş resim kaydı bad_avatar veya bad_cover ile düşürür, eski kayıtta resim yoksa da yeni
// yüklenen resim kaldırılırdı. Kayıt son kayıt kadar yeniyse (veya başka cihazdan gelen daha yeni bir kayıtsa) kayıttaki
// resimler geçerlidir.
function ownImageBase (rec) {
  const saved = profileState.ownSaved
  if (saved && state.me && saved.userId === String(state.me.id) && (!rec || rec.missing || rec.pv < saved.pv)) {
    return { avatar: saved.avatar, cover: saved.cover }
  }
  const profile = rec && rec.profile ? rec.profile : null
  return { avatar: profile && profile.avatar ? profile.avatar : null, cover: profile && profile.cover ? profile.cover : null }
}

// Başarılı kaydın sürümü ve resimleri saklanır. Kayıt sürerken oturum veya frekans değiştiyse (profilesReset) ya da
// aynı anda giden başka bir kayıt daha yeni bir sürüm aldıysa saklanan değer değişmez.
function rememberOwnSave (gen, userId, data, avatarRef, coverRef) {
  if (gen !== profileState.gen || !data || typeof data.pv !== 'number') return
  const prev = profileState.ownSaved
  if (prev && prev.userId === userId && prev.pv > data.pv) return
  const pick = (ref) => (ref ? { u: ref.u, k: ref.k, n: ref.n, m: ref.m } : null)
  profileState.ownSaved = { userId: userId, pv: data.pv, avatar: pick(avatarRef), cover: pick(coverRef) }
}

// Profil resmi: kare kırpma, 256x256, PNG kaynak PNG, diğerleri JPEG olarak yeniden kodlanır
async function uploadAvatar (file) {
  let encoded = null
  try {
    const bytes = await readBlobBytes(file)
    const sniffed = window.E2EE.sniffImage(bytes)
    const decoded = await decodeImage(bytes, sniffed || String(file.type || 'application/octet-stream'))
    if (!decoded) return { ok: false, error: () => t('profile.avatarInvalid') }
    try {
      encoded = await squareAvatar(decoded.image, sniffed === 'image/png' ? 'image/png' : 'image/jpeg')
    } finally {
      decoded.release()
    }
  } catch (err) {
    return { ok: false, error: errorProducer(err, () => t('profile.avatarInvalid')) }
  }
  if (!encoded) return { ok: false, error: () => t('profile.avatarInvalid') }
  return uploadProfileImage(encoded, 'profile.avatarUploadFailed')
}

// Yeniden kodlanmış resmi ({ bytes, mime }) kendi dosya anahtarıyla şifreleyip yükler, profil zarfına girecek
// başvuruyu { u, k, n, m } döner
async function uploadProfileImage (encoded, failKey) {
  const enc = window.E2EE.encryptFile(encoded.bytes)
  const res = await request('POST', '/api/uploads', { binary: enc.box, timeout: TRANSFER_TIMEOUT_MS })
  checkAuthFailure(res)
  if (res.status !== 200 || !res.data || typeof res.data.id !== 'string' || !UPLOAD_ID_RE.test(res.data.id)) {
    return { ok: false, error: () => errorText(res, t(failKey), { rate_limited: t('attach.rateLimited') }) }
  }
  return { ok: true, ref: { u: res.data.id, k: enc.key, n: enc.nonce, m: encoded.mime } }
}

async function squareAvatar (image, type) {
  const w0 = image.naturalWidth
  const h0 = image.naturalHeight
  const side = Math.min(w0, h0)
  if (!side) return null
  const sx = Math.floor((w0 - side) / 2)
  const sy = Math.floor((h0 - side) / 2)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_EDGE
  canvas.height = AVATAR_EDGE
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, AVATAR_EDGE, AVATAR_EDGE)
  }
  ctx.imageSmoothingEnabled = true
  try {
    ctx.imageSmoothingQuality = 'high'
  } catch (err) {
    // Eski tarayıcı
  }
  ctx.drawImage(image, sx, sy, side, side, 0, 0, AVATAR_EDGE, AVATAR_EDGE)
  const bytes = await canvasToBytes(canvas, type, type === 'image/jpeg' ? AVATAR_JPEG_QUALITY : undefined)
  canvas.width = 1
  canvas.height = 1
  const actual = window.E2EE.sniffImage(bytes)
  if (!actual || AVATAR_TYPES.indexOf(actual) === -1) return null
  return { bytes: bytes, mime: actual }
}

// Kapak fotoğrafı (istek 8)

// Kapağın şifrelenmeden önceki en büyük boyutu: sunucunun profil resmi sınırı (avatarMaxBytes) şifreli dosyaya
// uygulanır, şifreleme 16 bayt ekler
function coverByteLimit () {
  const limits = state.info && state.info.limits ? state.info.limits : null
  const max = limits && typeof limits.avatarMaxBytes === 'number' ? limits.avatarMaxBytes : 1024 * 1024 + 16
  return Math.max(1, max - 16)
}

// Kaynağın ortasından alınabilecek en büyük 3:1 dikdörtgen: { sx, sy, sw, sh } (boyut yoksa null)
function coverCrop (w, h) {
  if (!(w > 0) || !(h > 0)) return null
  let sw = w
  let sh = Math.max(1, Math.round(w * COVER_H / COVER_W))
  if (sh > h) {
    sh = h
    sw = Math.max(1, Math.min(w, Math.round(h * COVER_W / COVER_H)))
  }
  return { sx: Math.floor((w - sw) / 2), sy: Math.floor((h - sh) / 2), sw: sw, sh: sh }
}

// Kırpılan bölge 1200x400 tuvale çizilir ve JPEG olarak kodlanır. Kalite önce 0.85, dosya maxBytes sınırını aşarsa
// 0.7 ve 0.55 denenir. Sonuç { bytes, mime, quality }, hiçbiri sığmazsa { tooBig: true }, kodlanamazsa null.
async function encodeCover (image, maxBytes) {
  const crop = coverCrop(image.naturalWidth, image.naturalHeight)
  if (!crop) return null
  const canvas = document.createElement('canvas')
  canvas.width = COVER_W
  canvas.height = COVER_H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // Saydam yerler JPEG'de beyaz görünür
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, COVER_W, COVER_H)
  ctx.imageSmoothingEnabled = true
  try {
    ctx.imageSmoothingQuality = 'high'
  } catch (err) {
    // Eski tarayıcı
  }
  ctx.drawImage(image, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, COVER_W, COVER_H)
  try {
    for (const quality of COVER_QUALITIES) {
      const bytes = await canvasToBytes(canvas, 'image/jpeg', quality)
      if (window.E2EE.sniffImage(bytes) !== 'image/jpeg') return null
      if (bytes.length <= maxBytes) return { bytes: bytes, mime: 'image/jpeg', quality: quality }
    }
    return { tooBig: true }
  } finally {
    canvas.width = 1
    canvas.height = 1
  }
}

// Seçilen dosyadan kapak hazırlar: { ok: true, bytes, mime } veya { ok: false, reason: 'invalid' | 'tooBig', error }.
// Ayarlar önizlemesi ve yükleme aynı kodlamayı kullanır.
async function prepareCover (file) {
  const invalid = { ok: false, reason: 'invalid', error: () => t('profile.coverInvalid') }
  const max = coverByteLimit()
  let encoded = null
  try {
    const bytes = await readBlobBytes(file)
    const sniffed = window.E2EE.sniffImage(bytes)
    const decoded = await decodeImage(bytes, sniffed || String(file.type || 'application/octet-stream'))
    if (!decoded) return invalid
    try {
      encoded = await encodeCover(decoded.image, max)
    } finally {
      decoded.release()
    }
  } catch (err) {
    return { ok: false, reason: 'invalid', error: errorProducer(err, () => t('profile.coverInvalid')) }
  }
  if (!encoded) return invalid
  if (encoded.tooBig) return { ok: false, reason: 'tooBig', error: () => t('settings.profile.coverTooBig', { size: formatSize(max) }) }
  return { ok: true, bytes: encoded.bytes, mime: encoded.mime }
}

async function uploadCover (file) {
  const prepared = await prepareCover(file)
  if (!prepared.ok) return prepared
  return uploadProfileImage(prepared, 'profile.coverUploadFailed')
}
