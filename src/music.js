'use strict'

// Telsiz DJ müzik oturumları (SPEC-V2 Ek L2.6, L2.7, L2.10). Ses odası başına grup anahtarıyla şifreli tek
// bir durum zarfı tutulur. Sunucu içeriği görmez: yalnızca sürümü, kabul zamanını, zarfı ve yazanların
// kullanıcı kimliklerini bilir. Her şey bellektedir, diske hiçbir zaman yazılmaz. Sunucu yeniden başlayınca
// durumlar kaybolur, açılış kimliği (boot) değiştiği için istemciler sıfırlar.
// Sürümler (v) sunucu genelindeki tek bir sayaçtan gelir: hiç azalmaz ve bir oda silinip yeniden oluşsa bile
// yeniden kullanılmaz. Müzik sürümü (muv) herhangi bir odanın kaydı değişince veya silinince artar, uzun poll
// buna göre uyanır.
// Yazımlar sürüm karşılaştırmalıdır (compare-and-swap): beklenen sürüm güncel değilse yazım yapılmaz, güncel
// kayıt döner. Her kayıt yazar bilgisi taşır (istemci eklenen parçaların ekleyenini bununla doğrular,
// public/music.js): by bu sürümü yazanın kullanıcı kimliği, writes odanın son HISTORY yazımı ({ v, by },
// since sürümünden sonraki her yazımı içerir), authors odanın bu oturumunda (durum oluşturulduğundan beri)
// yazmış herkes.
// Boş kalan odanın durumu idleMs sonra silinir. Boşluk tarama ile algılanır (sweep), silinme en fazla bir
// tarama aralığı gecikebilir.

const HISTORY = 32

// options: { idleMs, onChange: () => void (kayıt değişti veya silindi) }
function createMusic (options) {
  const idleMs = options.idleMs
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {}
  // Oda kimliği -> { v, at, by, env, since, writes: [{ v, by }], authors: Set, emptySince, view }
  const rooms = new Map()
  let counter = 0
  let version = 1
  let mapCache = null

  function changed () {
    version++
    mapCache = null
    onChange()
  }

  // Yanıtlarda paylaşılan değişmez görünüm (yazımda bir kez kurulur)
  function makeView (rec) {
    return Object.freeze({
      v: rec.v,
      at: rec.at,
      by: rec.by,
      env: rec.env,
      since: rec.since,
      writes: Object.freeze(rec.writes.map((w) => Object.freeze({ v: w.v, by: w.by }))),
      authors: Object.freeze(Array.from(rec.authors).sort((a, b) => a - b))
    })
  }

  // Odanın kaydı ({ v, at, by, env, since, writes, authors }) veya null
  function get (channelId) {
    const rec = rooms.get(channelId)
    return rec ? rec.view : null
  }

  // Durumu olan bütün odalar: { '<oda>': kayıt }
  function map () {
    if (mapCache) return mapCache
    const out = {}
    for (const [channelId, rec] of rooms) out[String(channelId)] = rec.view
    mapCache = out
    return out
  }

  // Sonuç: { ok: true, v, at } veya { ok: false, record: güncel kayıt | null }
  function write (channelId, userId, expect, env, now) {
    const cur = rooms.get(channelId) || null
    const v = cur ? cur.v : 0
    if (expect !== v) return { ok: false, record: cur ? cur.view : null }
    counter++
    let writes = (cur ? cur.writes : []).concat([{ v: counter, by: userId }])
    let since = cur ? cur.since : 0
    if (writes.length > HISTORY) {
      since = writes[writes.length - HISTORY - 1].v
      writes = writes.slice(writes.length - HISTORY)
    }
    const authors = new Set(cur ? cur.authors : [])
    authors.add(userId)
    const rec = { v: counter, at: now, by: userId, env, since, writes, authors, emptySince: null, view: null }
    rec.view = makeView(rec)
    rooms.set(channelId, rec)
    changed()
    return { ok: true, v: counter, at: now }
  }

  // Kanal silindi: durumu hemen kalkar
  function remove (channelId) {
    if (!rooms.delete(channelId)) return false
    changed()
    return true
  }

  // occupied(channelId): odada şu an biri var mı. Boşalan odanın durumu idleMs sonra silinir, oda yeniden
  // dolarsa süre sıfırlanır.
  function sweep (now, occupied) {
    let removed = false
    for (const [channelId, rec] of rooms) {
      if (occupied(channelId)) {
        rec.emptySince = null
        continue
      }
      if (rec.emptySince === null) rec.emptySince = now
      if (now - rec.emptySince >= idleMs) {
        rooms.delete(channelId)
        removed = true
      }
    }
    if (removed) changed()
    return removed
  }

  return {
    HISTORY,
    version: () => version,
    get,
    map,
    write,
    remove,
    sweep,
    size: () => rooms.size
  }
}

module.exports = { createMusic, HISTORY }
