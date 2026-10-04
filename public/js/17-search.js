'use strict'

// Arama: tamamen istemcide yapılır (sunucu metni göremez). Seçili kapsamdaki konuşmaların geçmişi
// GET /api/messages ile 100'lük sayfalarla en yeniden eskiye çekilir, çözülür ve bu oturumun
// belleğindeki dizine eklenir (diske yazılmaz). Aynı oturumda tekrar aramada taranmış sayfalar yeniden
// çekilmez, yeni gelen, düzenlenen ve silinen mesajlar poll olaylarıyla dizine yansır. Kanal başına en
// fazla 20000 mesaj taranır. Çözülemeyen mesajlar dizine girmez (anahtar sonradan eklenirse yeniden
// denenir). Eşleşme büyük/küçük harf ve aksan duyarsızdır: seçili dile göre küçük harf, ı/i ve İ/i
// eşlemesi, NFD ile aksan kaldırma, kelime parçası eşleşir. Sonuca tıklayınca konuşmaya geçilir,
// mesaj bağlamıyla (around) yüklenip vurgulanır.

const SEARCH_PAGE = 100
const SEARCH_CHANNEL_MAX = 20000
const SEARCH_SHOW_STEP = 50
const SEARCH_DEBOUNCE_MS = 250
const SEARCH_SNIPPET = 90
const SEARCH_FROM_MAX = 8

const searchState = {
  built: false,
  query: '',
  scope: 'channel',
  channelId: null,
  fromId: null,
  fromItems: [],
  fromIndex: 0,
  hasImage: false,
  hasFile: false,
  mentionsMe: false,
  results: [],
  shown: SEARCH_SHOW_STEP,
  scanning: false,
  stopped: false,
  error: null,
  scanGen: 0,
  debounce: 0,
  refreshTimer: 0,
  index: new Map(),
  keyStamp: '',
  resultsSig: '',
  ranOnce: false
}

// Metin katlama: küçük harf (seçili dil), dotless ı -> i, NFD ve birleşik işaretlerin kaldırılması.
// normalize olmayan tarayıcılar için Türkçe harflerin yedek eşlemesi.

const SEARCH_DOTLESS_I = String.fromCharCode(0x131)
const SEARCH_MARKS_RE = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g')
const SEARCH_FALLBACK = {}
SEARCH_FALLBACK[String.fromCharCode(0xe7)] = 'c'
SEARCH_FALLBACK[String.fromCharCode(0x11f)] = 'g'
SEARCH_FALLBACK[String.fromCharCode(0xf6)] = 'o'
SEARCH_FALLBACK[String.fromCharCode(0x15f)] = 's'
SEARCH_FALLBACK[String.fromCharCode(0xfc)] = 'u'
SEARCH_FALLBACK[String.fromCharCode(0xe2)] = 'a'
SEARCH_FALLBACK[String.fromCharCode(0xee)] = 'i'
SEARCH_FALLBACK[String.fromCharCode(0xfb)] = 'u'
SEARCH_FALLBACK[String.fromCharCode(0x307)] = ''
const SEARCH_FALLBACK_RE = new RegExp('[' + Object.keys(SEARCH_FALLBACK).join('') + ']', 'g')

function searchLocale () {
  return window.I18N && typeof window.I18N.locale === 'function' ? window.I18N.locale() : undefined
}

function foldSearchText (text, locale) {
  let s = String(text === null || text === undefined ? '' : text)
  const loc = locale === undefined ? searchLocale() : locale
  try {
    s = loc ? s.toLocaleLowerCase(loc) : s.toLowerCase()
  } catch (err) {
    s = s.toLowerCase()
  }
  s = s.split(SEARCH_DOTLESS_I).join('i')
  try {
    s = s.normalize('NFD').replace(SEARCH_MARKS_RE, '')
  } catch (err) {
    s = s.replace(SEARCH_FALLBACK_RE, (ch) => SEARCH_FALLBACK[ch])
  }
  return s
}

// Karakter karakter katlama ve özgün metindeki konumlar (vurgu için)
function foldWithMap (text, locale) {
  const source = String(text || '')
  let folded = ''
  const starts = []
  const ends = []
  let pos = 0
  Array.from(source).forEach((ch) => {
    const f = foldSearchText(ch, locale)
    let k = 0
    while (k < f.length) {
      starts.push(pos)
      ends.push(pos + ch.length)
      k += 1
    }
    folded += f
    pos += ch.length
  })
  return { folded: folded, starts: starts, ends: ends }
}

// Arama terimleri ve kimden:/from: belirteçleri
function parseSearchQuery (query, locale) {
  const words = String(query || '').split(/\s+/).filter(Boolean)
  const out = { terms: [], from: null }
  words.forEach((word) => {
    const m = /^(kimden|from):(.*)$/i.exec(word)
    if (m) {
      out.from = m[2].replace(/^@/, '').toLowerCase()
      return
    }
    const f = foldSearchText(word, locale)
    if (f) out.terms.push(f)
  })
  return out
}

// Terimlerin özgün metindeki aralıkları (birleştirilmiş, sıralı)
function searchHitRanges (text, terms, locale) {
  if (!terms || !terms.length || !text) return []
  const map = foldWithMap(text, locale)
  const ranges = []
  terms.forEach((term) => {
    if (!term) return
    let from = map.folded.indexOf(term)
    while (from !== -1) {
      const last = from + term.length - 1
      if (last < map.ends.length) ranges.push([map.starts[from], map.ends[last]])
      from = map.folded.indexOf(term, from + Math.max(1, term.length))
    }
  })
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const merged = []
  ranges.forEach((r) => {
    const prev = merged[merged.length - 1]
    if (prev && r[0] <= prev[1]) prev[1] = Math.max(prev[1], r[1])
    else merged.push([r[0], r[1]])
  })
  return merged
}

function isLowSurrogate (text, i) {
  const c = text.charCodeAt(i)
  return c >= 0xdc00 && c <= 0xdfff
}

// Kısa alıntı parçaları: ilk eşleşmenin çevresi, eşleşen kısımlar hit: true
function searchSnippetParts (text, terms, locale, width) {
  const source = String(text || '').replace(/\s+/g, ' ')
  const max = width || SEARCH_SNIPPET
  const ranges = searchHitRanges(source, terms, locale)
  let from = 0
  let to = source.length
  if (source.length > max * 2) {
    const center = ranges.length ? ranges[0][0] : 0
    from = Math.max(0, center - Math.floor(max / 2))
    to = Math.min(source.length, from + max * 2)
    if (to - from < max * 2) from = Math.max(0, to - max * 2)
    if (from > 0 && isLowSurrogate(source, from)) from -= 1
    if (to < source.length && isLowSurrogate(source, to)) to += 1
  }
  const parts = []
  if (from > 0) parts.push({ text: '...', hit: false })
  let pos = from
  ranges.forEach((r) => {
    const a = Math.max(r[0], from)
    const b = Math.min(r[1], to)
    if (b <= a) return
    if (a > pos) parts.push({ text: source.slice(pos, a), hit: false })
    parts.push({ text: source.slice(a, b), hit: true })
    pos = b
  })
  if (pos < to) parts.push({ text: source.slice(pos, to), hit: false })
  if (to < source.length) parts.push({ text: '...', hit: false })
  return parts
}

// Dizin

function searchIndexFor (channelId) {
  const key = String(channelId)
  let idx = searchState.index.get(key)
  if (!idx) {
    idx = { channelId: channelId, entries: new Map(), failed: new Map(), oldestId: null, newestId: null, headCursor: null, fetched: 0, complete: false, synced: false, limited: false }
    searchState.index.set(key, idx)
  }
  return idx
}

function searchSeen (idx, id) {
  const key = String(id)
  return idx.entries.has(key) || idx.failed.has(key)
}

// Mesajı çözüp dizine ekler. Çözülemeyen mesaj dizine girmez, anahtar değişince yeniden denenir.
function indexSearchMessage (idx, m) {
  let result = null
  try {
    result = typeof decryptMessageRaw === 'function' ? decryptMessageRaw(m) : decryptMessage(m)
  } catch (err) {
    result = null
  }
  const key = String(m.id)
  if (!result || result.state !== 'ok') {
    idx.entries.delete(key)
    idx.failed.set(key, m)
    return null
  }
  idx.failed.delete(key)
  const files = Array.isArray(result.files) ? result.files : []
  const names = files.map((f) => f.name || '').filter(Boolean).join(' ')
  const text = typeof result.text === 'string' ? result.text : ''
  const entry = {
    id: m.id,
    channelId: m.channelId,
    authorId: m.authorId,
    createdAt: m.createdAt,
    text: text,
    names: names,
    fold: foldSearchText(text),
    foldNames: foldSearchText(names),
    hasImage: files.some((f) => f.kind === 'image'),
    hasFile: files.some((f) => f.kind === 'file'),
    fileKinds: files.map((f) => f.kind)
  }
  idx.entries.set(key, entry)
  return entry
}

function noteIds (idx, list) {
  list.forEach((m) => {
    const id = Number(m.id)
    if (idx.newestId === null || id > idx.newestId) idx.newestId = id
    if (idx.oldestId === null || id < idx.oldestId) idx.oldestId = id
  })
}

// Grup anahtarlığı veya kimlik değişince çözülemeyen mesajlar yeniden denenir
function searchKeyStamp () {
  let kids = ''
  try {
    kids = window.E2EE.keyring.list().map((k) => k.kid).sort().join(',')
  } catch (err) {
    kids = ''
  }
  let pk = ''
  try {
    const pair = typeof myIdentity === 'function' ? myIdentity() : null
    pk = pair ? String(pair.publicKey) : ''
  } catch (err) {
    pk = ''
  }
  return kids + '|' + pk + '|' + (typeof activeKid === 'function' ? activeKid() : '')
}

function retryFailedIfNeeded () {
  const stamp = searchKeyStamp()
  if (stamp === searchState.keyStamp) return
  searchState.keyStamp = stamp
  searchState.index.forEach((idx) => {
    Array.from(idx.failed.values()).forEach((m) => {
      indexSearchMessage(idx, m)
    })
  })
}

// Poll olayları dizine yansır (yalnızca taranmaya başlanmış konuşmalarda)
function searchOnEvent (ev) {
  if (!ev || ev.channelId === undefined) return
  const idx = searchState.index.get(String(ev.channelId))
  if (!idx || idx.newestId === null) return
  let changed = false
  if (ev.type === 'msg' && ev.message && validSearchMessage(ev.message)) {
    if (!searchSeen(idx, ev.message.id)) idx.fetched += 1
    indexSearchMessage(idx, ev.message)
    if (Number(ev.message.id) > idx.newestId) idx.newestId = Number(ev.message.id)
    changed = true
  } else if (ev.type === 'edit' && ev.message && validSearchMessage(ev.message)) {
    if (searchSeen(idx, ev.message.id)) {
      indexSearchMessage(idx, ev.message)
      changed = true
    }
  } else if (ev.type === 'del' && ev.messageId !== undefined) {
    const key = String(ev.messageId)
    if (searchSeen(idx, key)) {
      idx.entries.delete(key)
      idx.failed.delete(key)
      changed = true
    }
  }
  if (changed && isSearchOpen()) scheduleSearchRefresh()
}

// Olay kaybı (resync) olduysa konuşmaların en yeni kısmı bir sonraki aramada yeniden denetlenir
function searchOnResync () {
  searchState.index.forEach((idx) => {
    idx.synced = false
    idx.headCursor = null
  })
}

function searchReset () {
  searchState.scanGen += 1
  clearTimeout(searchState.debounce)
  clearTimeout(searchState.refreshTimer)
  searchState.index = new Map()
  searchState.results = []
  searchState.shown = SEARCH_SHOW_STEP
  searchState.scanning = false
  searchState.stopped = false
  searchState.error = null
  searchState.query = ''
  searchState.fromId = null
  searchState.fromItems = []
  searchState.hasImage = false
  searchState.hasFile = false
  searchState.mentionsMe = false
  searchState.scope = 'channel'
  searchState.channelId = null
  searchState.keyStamp = ''
  searchState.ranOnce = false
  const layer = typeof findLayer === 'function' ? findLayer('search') : null
  if (layer) closeLayer(layer, false)
  if (searchState.built) {
    const input = byId('search-input')
    if (input) input.value = ''
    const from = byId('search-from')
    if (from) from.value = ''
    renderSearchFilters()
    renderSearchResults()
    renderSearchStatus()
  }
}

function validSearchMessage (m) {
  return Boolean(m && typeof m === 'object' && m.id !== undefined && m.id !== null && typeof m.body === 'string')
}

// Kapsam

function searchDmIds () {
  if (typeof priv !== 'function') return []
  return priv().dms.map((d) => d.id)
}

function scopeChannelIds () {
  if (searchState.scope === 'text') return textChannels().map((c) => c.id)
  if (searchState.scope === 'dm') return searchDmIds()
  return searchState.channelId === null ? [] : [searchState.channelId]
}

function searchIsDm (channelId) {
  if (typeof dmEntry === 'function' && dmEntry(channelId)) return true
  return typeof isDmChannel === 'function' ? Boolean(isDmChannel(channelId)) : false
}

function scopeHasFilters () {
  return searchState.fromId !== null || searchState.hasImage || searchState.hasFile || searchState.mentionsMe
}

function searchActive () {
  return Boolean(parseSearchQuery(searchState.query).terms.length || parseSearchQuery(searchState.query).from || scopeHasFilters())
}

// Sorgunun kimden: belirteci var olan bir kullanıcı adına çözülür
function queryFromId (parsed) {
  if (!parsed.from) return undefined
  const id = typeof resolveMentionName === 'function' ? resolveMentionName(parsed.from) : null
  return id === null ? null : id
}

function searchFilters () {
  const parsed = parseSearchQuery(searchState.query)
  const tokenFrom = queryFromId(parsed)
  return {
    terms: parsed.terms,
    fromToken: parsed.from,
    fromId: tokenFrom !== undefined ? tokenFrom : searchState.fromId,
    fromMissing: tokenFrom === null,
    hasImage: searchState.hasImage,
    hasFile: searchState.hasFile,
    mentionsMe: searchState.mentionsMe
  }
}

function searchBlockedAuthor (entry) {
  if (searchIsDm(entry.channelId)) return false
  if (typeof isBlocked !== 'function') return false
  try {
    return Boolean(isBlocked(entry.authorId))
  } catch (err) {
    return false
  }
}

function entryMatches (entry, f) {
  if (f.fromMissing) return false
  if (f.fromId !== null && f.fromId !== undefined && !sameId(entry.authorId, f.fromId)) return false
  if (f.hasImage && !entry.hasImage) return false
  if (f.hasFile && !entry.hasFile) return false
  if (f.terms.length) {
    const hay = entry.fold + '\n' + entry.foldNames
    if (!f.terms.every((term) => hay.indexOf(term) !== -1)) return false
  }
  if (f.mentionsMe && !(typeof messageMentionsMe === 'function' && messageMentionsMe({ authorId: entry.authorId, channelId: entry.channelId }, entry.text))) return false
  if (searchBlockedAuthor(entry)) return false
  return true
}

function byNewest (a, b) {
  return Number(b.id) - Number(a.id)
}

// Sonuçların hesaplandığı sorgu ve süzgeçler. Sorgu değişip yeniden hesaplama beklerken taramadan gelen
// yeni mesajlar eski sonuç listesine karıştırılmaz.
function searchSignature () {
  return JSON.stringify([searchState.query, searchState.scope, String(searchState.channelId), String(searchState.fromId), searchState.hasImage, searchState.hasFile, searchState.mentionsMe])
}

// Dizinden tüm sonuçlar yeniden hesaplanır
function recomputeResults () {
  searchState.resultsSig = searchSignature()
  const f = searchFilters()
  const out = []
  if (searchActive()) {
    scopeChannelIds().forEach((channelId) => {
      const idx = searchState.index.get(String(channelId))
      if (!idx) return
      idx.entries.forEach((entry) => {
        if (entryMatches(entry, f)) out.push(entry)
      })
    })
  }
  out.sort(byNewest)
  searchState.results = out
}

function addResults (entries) {
  if (!entries.length || !searchActive() || searchState.resultsSig !== searchSignature()) return false
  const f = searchFilters()
  const scope = scopeChannelIds().map(String)
  const fresh = entries.filter((entry) => scope.indexOf(String(entry.channelId)) !== -1 && entryMatches(entry, f))
  if (!fresh.length) return false
  const seen = new Set(searchState.results.map((e) => String(e.id)))
  searchState.results = searchState.results.concat(fresh.filter((e) => !seen.has(String(e.id)))).sort(byNewest)
  return true
}

function scopeScanned () {
  let total = 0
  scopeChannelIds().forEach((channelId) => {
    const idx = searchState.index.get(String(channelId))
    if (idx) total += idx.fetched
  })
  return total
}

function scopeIncomplete () {
  return scopeChannelIds().some((channelId) => {
    const idx = searchState.index.get(String(channelId))
    return !idx || !idx.complete || !idx.synced
  })
}

function scopeLimited () {
  return scopeChannelIds().some((channelId) => {
    const idx = searchState.index.get(String(channelId))
    return Boolean(idx && idx.limited)
  })
}

// Tarama: kapsamdaki konuşmalardan sırayla birer sayfa (en yeniden eskiye). Durdurulabilir.

function fetchSearchPage (channelId, beforeId) {
  let path = '/api/messages?channel=' + encodeURIComponent(channelId) + '&limit=' + SEARCH_PAGE
  if (beforeId !== null && beforeId !== undefined) path += '&before=' + encodeURIComponent(beforeId)
  return api('GET', path)
}

async function scanStep (idx, gen) {
  const head = idx.newestId !== null && !idx.synced
  const before = head ? idx.headCursor : (idx.newestId === null ? null : idx.oldestId)
  const res = await fetchSearchPage(idx.channelId, before)
  if (gen !== searchState.scanGen) return { ok: true, added: [] }
  if (res.status === 404) {
    // Kanal silinmiş veya artık erişilemiyor
    idx.complete = true
    idx.synced = true
    return { ok: true, added: [] }
  }
  if (res.status !== 200 || !res.data || !Array.isArray(res.data.messages)) return { ok: false, res: res }
  const list = res.data.messages.filter(validSearchMessage)
  const fresh = list.filter((m) => !searchSeen(idx, m.id))
  const added = []
  fresh.forEach((m) => {
    const entry = indexSearchMessage(idx, m)
    if (entry) added.push(entry)
  })
  idx.fetched += fresh.length
  const hasMore = res.data.hasMore === true && list.length > 0
  const minId = list.length ? Math.min.apply(null, list.map((m) => Number(m.id))) : null
  const prevNewest = idx.newestId
  noteIds(idx, list)
  if (head) {
    if (!hasMore || minId === null || (prevNewest !== null && minId <= prevNewest)) {
      idx.synced = true
      idx.headCursor = null
    } else {
      idx.headCursor = minId
    }
  } else {
    idx.synced = true
    if (!hasMore) idx.complete = true
  }
  if (idx.fetched >= SEARCH_CHANNEL_MAX) {
    idx.complete = true
    idx.synced = true
    idx.limited = true
  }
  return { ok: true, added: added }
}

async function runSearchScan () {
  searchState.scanGen += 1
  const gen = searchState.scanGen
  searchState.stopped = false
  searchState.error = null
  let active = scopeChannelIds().map(searchIndexFor).filter((idx) => !idx.complete || !idx.synced)
  if (!active.length) {
    searchState.scanning = false
    renderSearchStatus()
    return
  }
  searchState.scanning = true
  renderSearchStatus()
  while (active.length && gen === searchState.scanGen) {
    for (const idx of active) {
      if (gen !== searchState.scanGen) return
      const step = await scanStep(idx, gen)
      if (gen !== searchState.scanGen) return
      if (!step.ok) {
        const res = step.res
        searchState.scanning = false
        searchState.error = () => errorText(res, t('search.error'))
        renderSearchStatus()
        return
      }
      if (addResults(step.added)) renderSearchResults()
      renderSearchStatus()
    }
    active = active.filter((idx) => !idx.complete || !idx.synced)
  }
  if (gen !== searchState.scanGen) return
  searchState.scanning = false
  renderSearchStatus(true)
}

function stopSearchScan () {
  if (!searchState.scanning) return
  searchState.scanGen += 1
  searchState.scanning = false
  searchState.stopped = true
  renderSearchStatus(true)
}

// Arama çalıştırma: sonuçlar dizinden hemen, eksik kısımlar taranarak

function executeSearch () {
  clearTimeout(searchState.debounce)
  if (!isSearchOpen()) return
  retryFailedIfNeeded()
  searchState.shown = SEARCH_SHOW_STEP
  recomputeResults()
  renderSearchResults()
  if (searchActive()) {
    searchState.ranOnce = true
    if (scopeIncomplete()) {
      runSearchScan()
      return
    }
  } else {
    searchState.scanGen += 1
    searchState.scanning = false
  }
  renderSearchStatus(true)
}

function scheduleSearch () {
  clearTimeout(searchState.debounce)
  searchState.debounce = setTimeout(executeSearch, SEARCH_DEBOUNCE_MS)
}

// Canlı olaylardan sonra sonuçlar kısa gecikmeyle tazelenir (tarama sürmüyorsa)
function scheduleSearchRefresh () {
  clearTimeout(searchState.refreshTimer)
  searchState.refreshTimer = setTimeout(() => {
    if (!isSearchOpen()) return
    recomputeResults()
    renderSearchResults()
    renderSearchStatus()
  }, 300)
}

// Panel

function searchPanelEl () {
  return (el && el.searchPanel) || byId('search-panel')
}

function isSearchOpen () {
  return Boolean(typeof findLayer === 'function' && findLayer('search'))
}

function searchOption (value, key) {
  const opt = h('option', '', t(key))
  opt.value = value
  opt.setAttribute('data-key', key)
  return opt
}

function searchChip (id, key, field) {
  const b = h('button', 'search-chip', t(key))
  b.type = 'button'
  b.id = id
  b.setAttribute('aria-pressed', 'false')
  b.setAttribute('data-key', key)
  b.addEventListener('click', () => {
    searchState[field] = !searchState[field]
    renderSearchFilters()
    executeSearch()
  })
  return b
}

function buildSearchPanel () {
  const panel = searchPanelEl()
  if (!panel || searchState.built) return
  searchState.built = true
  clear(panel)
  panel.setAttribute('aria-labelledby', 'search-title')
  const title = h('h2', 'sr-only', t('search.title'))
  title.id = 'search-title'
  panel.appendChild(title)

  const bar = h('div', 'search-bar')
  const glyph = icon('i-search', 'search-glyph')
  bar.appendChild(glyph)
  const input = h('input', 'input search-input')
  input.id = 'search-input'
  input.type = 'search'
  input.setAttribute('autocomplete', 'off')
  input.setAttribute('spellcheck', 'false')
  input.setAttribute('enterkeyhint', 'search')
  input.setAttribute('maxlength', '200')
  input.addEventListener('input', () => {
    searchState.query = input.value
    scheduleSearch()
  })
  input.addEventListener('keydown', onSearchInputKey)
  bar.appendChild(input)
  const scope = h('select', 'input select select-small search-scope')
  scope.id = 'search-scope'
  scope.appendChild(searchOption('channel', 'search.scope.channel'))
  scope.appendChild(searchOption('text', 'search.scope.text'))
  scope.appendChild(searchOption('dm', 'search.scope.dms'))
  scope.addEventListener('change', () => {
    searchState.scope = scope.value === 'text' || scope.value === 'dm' ? scope.value : 'channel'
    if (searchState.fromId !== null && !searchFromCandidates().some((id) => sameId(id, searchState.fromId))) searchState.fromId = null
    renderSearchFilters()
    executeSearch()
  })
  const close = button('icon-button search-close', '', 'i-close', t('search.close'))
  close.id = 'search-close'
  close.addEventListener('click', () => {
    closeSearch(true)
  })
  bar.appendChild(close)
  panel.appendChild(bar)

  const filters = h('div', 'search-filters')
  filters.id = 'search-filters'
  filters.setAttribute('role', 'group')
  // Kapsam süzgeçlerle aynı satırda: klavye sırası görsel sırayla aynı kalır (geniş ve dar ekran)
  filters.appendChild(scope)
  const fromWrap = h('div', 'search-from')
  fromWrap.id = 'search-from-wrap'
  const fromLabel = h('label', 'search-from-label', t('search.from'))
  fromLabel.id = 'search-from-label'
  fromLabel.setAttribute('for', 'search-from')
  fromWrap.appendChild(fromLabel)
  const fromInput = h('input', 'input search-from-input')
  fromInput.id = 'search-from'
  fromInput.type = 'text'
  fromInput.setAttribute('autocomplete', 'off')
  fromInput.setAttribute('spellcheck', 'false')
  fromInput.setAttribute('role', 'combobox')
  fromInput.setAttribute('aria-autocomplete', 'list')
  fromInput.setAttribute('aria-controls', 'search-from-list')
  fromInput.setAttribute('aria-expanded', 'false')
  fromInput.setAttribute('maxlength', '40')
  fromInput.addEventListener('input', renderSearchFromList)
  fromInput.addEventListener('focus', renderSearchFromList)
  fromInput.addEventListener('keydown', onSearchFromKey)
  fromInput.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement !== fromInput) closeSearchFromList()
    }, 150)
  })
  fromWrap.appendChild(fromInput)
  const fromChip = h('button', 'search-chip search-from-chip is-on')
  fromChip.id = 'search-from-chip'
  fromChip.type = 'button'
  fromChip.hidden = true
  fromChip.addEventListener('click', () => {
    searchState.fromId = null
    renderSearchFilters()
    executeSearch()
    focusNode(byId('search-from'))
  })
  fromWrap.appendChild(fromChip)
  const fromList = h('div', 'search-from-list')
  fromList.id = 'search-from-list'
  fromList.setAttribute('role', 'listbox')
  fromList.hidden = true
  fromList.addEventListener('mousedown', (e) => {
    e.preventDefault()
  })
  if (window.PointerEvent) {
    fromList.addEventListener('pointerdown', (e) => {
      e.preventDefault()
    })
  }
  fromWrap.appendChild(fromList)
  filters.appendChild(fromWrap)
  filters.appendChild(searchChip('search-has-image', 'search.hasImage', 'hasImage'))
  filters.appendChild(searchChip('search-has-file', 'search.hasFile', 'hasFile'))
  filters.appendChild(searchChip('search-mentions-me', 'search.mentionsMe', 'mentionsMe'))
  panel.appendChild(filters)

  const status = h('div', 'search-status')
  status.id = 'search-status'
  const statusText = h('span', 'search-status-text')
  statusText.id = 'search-status-text'
  status.appendChild(statusText)
  const stop = button('button button-small button-secondary search-stop', t('search.stop'))
  stop.id = 'search-stop'
  stop.hidden = true
  stop.addEventListener('click', () => {
    if (searchState.scanning) {
      stopSearchScan()
    } else {
      runSearchScan()
    }
    const again = byId('search-stop')
    if (again && !again.hidden) focusNode(again)
  })
  status.appendChild(stop)
  panel.appendChild(status)
  const live = h('p', 'sr-only')
  live.id = 'search-live'
  live.setAttribute('aria-live', 'polite')
  panel.appendChild(live)

  const results = h('ul', 'search-results')
  results.id = 'search-results'
  results.addEventListener('keydown', onSearchResultsKey)
  panel.appendChild(results)
  const more = button('button button-small button-secondary search-more', t('search.more'))
  more.id = 'search-more'
  more.hidden = true
  more.addEventListener('click', () => {
    searchState.shown += SEARCH_SHOW_STEP
    renderSearchResults()
    const list = byId('search-results')
    const items = list ? list.querySelectorAll('.search-result') : []
    const target = items[searchState.shown - SEARCH_SHOW_STEP]
    if (target) focusNode(target)
  })
  const moreWrap = h('div', 'search-more-wrap')
  moreWrap.appendChild(more)
  panel.appendChild(moreWrap)
  const note = h('p', 'search-note', t('search.note'))
  note.id = 'search-note'
  panel.appendChild(note)
  searchApplyLanguage()
}

// Statik metinler (dil değişince yeniden)
function searchApplyLanguage () {
  if (!searchState.built) return
  const title = byId('search-title')
  if (title) title.textContent = t('search.title')
  const input = byId('search-input')
  if (input) {
    input.setAttribute('placeholder', t('search.placeholder'))
    input.setAttribute('aria-label', t('search.inputLabel'))
  }
  const scope = byId('search-scope')
  if (scope) {
    scope.setAttribute('aria-label', t('search.scopeLabel'))
    Array.from(scope.options).forEach((opt) => {
      const key = opt.value === 'channel' ? (searchIsDm(searchState.channelId) ? 'search.scope.dm' : 'search.scope.channel') : opt.getAttribute('data-key')
      opt.textContent = t(key)
    })
  }
  const close = byId('search-close')
  if (close) {
    close.setAttribute('aria-label', t('search.close'))
    close.title = t('search.close')
  }
  const filters = byId('search-filters')
  if (filters) filters.setAttribute('aria-label', t('search.filters'))
  const fromLabel = byId('search-from-label')
  if (fromLabel) fromLabel.textContent = t('search.from')
  const from = byId('search-from')
  if (from) from.setAttribute('placeholder', t('search.fromPlaceholder'))
  const fromList = byId('search-from-list')
  if (fromList) fromList.setAttribute('aria-label', t('search.fromList'))
  Array.from(document.querySelectorAll('#search-filters .search-chip[data-key]')).forEach((chip) => {
    chip.textContent = t(chip.getAttribute('data-key'))
  })
  const results = byId('search-results')
  if (results) results.setAttribute('aria-label', t('search.resultsLabel'))
  const more = byId('search-more')
  if (more) more.textContent = t('search.more')
  const note = byId('search-note')
  if (note) note.textContent = t('search.note')
  renderSearchFilters()
  renderSearchStatus()
  renderSearchResults()
}

function renderSearchFilters () {
  if (!searchState.built) return
  const scope = byId('search-scope')
  if (scope) {
    scope.value = searchState.scope
    const channelOpt = Array.from(scope.options).filter((o) => o.value === 'channel')[0]
    if (channelOpt) {
      channelOpt.disabled = searchState.channelId === null
      channelOpt.textContent = t(searchIsDm(searchState.channelId) ? 'search.scope.dm' : 'search.scope.channel')
    }
  }
  const pairs = [['search-has-image', 'hasImage'], ['search-has-file', 'hasFile'], ['search-mentions-me', 'mentionsMe']]
  pairs.forEach((pair) => {
    const chip = byId(pair[0])
    if (!chip) return
    chip.setAttribute('aria-pressed', searchState[pair[1]] ? 'true' : 'false')
    chip.classList.toggle('is-on', Boolean(searchState[pair[1]]))
  })
  const fromInput = byId('search-from')
  const fromChip = byId('search-from-chip')
  if (fromInput && fromChip) {
    const has = searchState.fromId !== null
    const keepFocus = document.activeElement === fromInput && has
    fromInput.hidden = has
    fromChip.hidden = !has
    clear(fromChip)
    if (has) {
      const name = typeof userDisplayName === 'function' ? userDisplayName(searchState.fromId) : shownName(searchState.fromId)
      fromChip.appendChild(personAvatar(searchState.fromId, 'xs'))
      fromChip.appendChild(h('span', 'search-from-name', name))
      fromChip.appendChild(icon('i-close', 'search-from-x'))
      fromChip.setAttribute('aria-label', t('search.fromClear', { name: name }))
      fromChip.title = t('search.fromClear', { name: name })
      fromInput.value = ''
      closeSearchFromList()
      if (keepFocus) focusNode(fromChip)
    }
  }
}

// Kimden süzgecinin adayları: yazı kanallarında üyeler, özel mesaj kapsamında konuşulan kişiler ve kendim
function searchFromCandidates () {
  const me = state.me ? [state.me.id] : []
  if (searchState.scope === 'dm' || (searchState.scope === 'channel' && searchIsDm(searchState.channelId))) {
    const partners = typeof priv === 'function' ? priv().dms.map((d) => d.userId) : []
    const list = searchState.scope === 'channel' && typeof dmPartner === 'function' ? [dmPartner(searchState.channelId)] : partners
    return me.concat(list.filter((id) => id !== null && id !== undefined))
  }
  const users = state.meta && Array.isArray(state.meta.users) ? state.meta.users : []
  return users.filter((u) => u && u.id !== undefined).map((u) => u.id)
}

function renderSearchFromList () {
  const input = byId('search-from')
  const list = byId('search-from-list')
  if (!input || !list || input.hidden) return
  const people = typeof matchPeople === 'function' ? matchPeople(input.value, searchFromCandidates(), SEARCH_FROM_MAX) : []
  const prev = searchState.fromItems[searchState.fromIndex]
  searchState.fromItems = people
  const keep = prev ? people.map((p) => String(p.id)).indexOf(String(prev.id)) : -1
  searchState.fromIndex = keep !== -1 ? keep : 0
  clear(list)
  if (!people.length || document.activeElement !== input) {
    closeSearchFromList()
    return
  }
  people.forEach((p, i) => {
    const opt = h('div', 'mention-option search-from-option')
    opt.id = 'search-from-opt-' + i
    opt.setAttribute('role', 'option')
    opt.setAttribute('data-user-id', String(p.id))
    opt.setAttribute('aria-selected', i === searchState.fromIndex ? 'true' : 'false')
    opt.appendChild(personAvatar(p.id, 'sm'))
    opt.appendChild(h('span', 'mention-option-name', p.display))
    opt.appendChild(h('span', 'handle mention-option-handle', '@' + p.name))
    opt.addEventListener('click', () => {
      pickSearchFrom(i)
    })
    list.appendChild(opt)
  })
  list.hidden = false
  input.setAttribute('aria-expanded', 'true')
  input.setAttribute('aria-activedescendant', 'search-from-opt-' + searchState.fromIndex)
}

function closeSearchFromList () {
  const input = byId('search-from')
  const list = byId('search-from-list')
  if (list) {
    list.hidden = true
    clear(list)
  }
  if (input) {
    input.setAttribute('aria-expanded', 'false')
    input.removeAttribute('aria-activedescendant')
  }
}

function pickSearchFrom (i) {
  const p = searchState.fromItems[i]
  if (!p) return
  searchState.fromId = p.id
  closeSearchFromList()
  renderSearchFilters()
  executeSearch()
  const chip = byId('search-from-chip')
  if (chip && !chip.hidden) focusNode(chip)
}

function onSearchFromKey (e) {
  const list = byId('search-from-list')
  const open = list && !list.hidden && searchState.fromItems.length
  if (!open) {
    if (e.key === 'ArrowDown' || e.key === 'Down') {
      e.preventDefault()
      renderSearchFromList()
    }
    return
  }
  const n = searchState.fromItems.length
  if (e.key === 'ArrowDown' || e.key === 'Down' || e.key === 'ArrowUp' || e.key === 'Up') {
    e.preventDefault()
    const delta = e.key === 'ArrowDown' || e.key === 'Down' ? 1 : -1
    searchState.fromIndex = (searchState.fromIndex + delta + n) % n
    renderSearchFromList()
  } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
    e.preventDefault()
    pickSearchFrom(searchState.fromIndex)
  } else if (e.key === 'Escape' || e.key === 'Esc') {
    e.preventDefault()
    closeSearchFromList()
  }
}

function onSearchInputKey (e) {
  if (e.key === 'Enter') {
    e.preventDefault()
    searchState.query = e.target.value
    executeSearch()
  } else if (e.key === 'ArrowDown' || e.key === 'Down') {
    const first = document.querySelector('#search-results .search-result')
    if (first) {
      e.preventDefault()
      focusNode(first)
    }
  }
}

function onSearchResultsKey (e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Down' && e.key !== 'Up' && e.key !== 'Home' && e.key !== 'End') return
  const items = Array.from(document.querySelectorAll('#search-results .search-result'))
  const i = items.indexOf(document.activeElement)
  if (i === -1 || !items.length) return
  e.preventDefault()
  let next = i
  if (e.key === 'ArrowDown' || e.key === 'Down') next = Math.min(items.length - 1, i + 1)
  else if (e.key === 'ArrowUp' || e.key === 'Up') next = i - 1
  else if (e.key === 'Home') next = 0
  else next = items.length - 1
  if (next < 0) focusNode(byId('search-input'))
  else focusNode(items[next])
}

function searchChannelLabel (channelId) {
  if (searchIsDm(channelId)) {
    const partner = typeof dmPartner === 'function' ? dmPartner(channelId) : null
    const name = partner === null || partner === undefined ? t('users.unknown') : (typeof userDisplayName === 'function' ? userDisplayName(partner) : shownName(partner))
    return t('search.dmLabel', { name: name })
  }
  const ch = findChannel(channelId)
  return ch ? ch.name : t('search.unknownChannel')
}

// terms: aranan terimler (alıntı kaynağını seçer), marks: vurgulanacak terimler
function buildSearchResult (entry, terms, marks) {
  const li = h('li', 'search-result-row')
  const b = h('button', 'search-result')
  b.type = 'button'
  b.setAttribute('data-message-id', String(entry.id))
  b.setAttribute('data-channel-id', String(entry.channelId))
  b.setAttribute('data-focus-key', 'search-' + entry.id)
  const name = typeof userDisplayName === 'function' ? userDisplayName(entry.authorId) : shownName(entry.authorId)
  b.appendChild(personAvatar(entry.authorId, 'sm'))
  const body = h('span', 'search-result-body')
  const meta = h('span', 'search-result-meta')
  meta.appendChild(h('span', 'search-result-channel', searchChannelLabel(entry.channelId)))
  meta.appendChild(h('span', 'search-result-author', name))
  const date = h('span', 'search-result-date', formatShort(entry.createdAt))
  date.title = formatLong(entry.createdAt)
  meta.appendChild(date)
  body.appendChild(meta)
  const text = h('span', 'search-result-text')
  // Eşleşme yalnızca dosya adındaysa alıntı dosya adlarından yapılır
  const useNames = !entry.text || Boolean(terms.length && !terms.every((term) => entry.fold.indexOf(term) !== -1) && entry.names)
  const source = useNames ? entry.names : entry.text
  const kinds = entry.fileKinds || []
  if (kinds.length) {
    const tag = h('span', 'search-result-file', t(kinds.indexOf('image') !== -1 && kinds.indexOf('file') === -1 ? 'notify.photo' : 'notify.file'))
    text.appendChild(tag)
    text.appendChild(document.createTextNode(' '))
  }
  searchSnippetParts(source, marks || terms).forEach((part) => {
    text.appendChild(part.hit ? h('mark', 'search-hit', part.text) : document.createTextNode(part.text))
  })
  body.appendChild(text)
  b.appendChild(body)
  b.addEventListener('click', () => {
    searchJump(entry)
  })
  li.appendChild(b)
  return li
}

function renderSearchResults () {
  if (!searchState.built) return
  const list = byId('search-results')
  const more = byId('search-more')
  if (!list) return
  const focusKey = typeof activeFocusKey === 'function' ? activeFocusKey(list) : null
  clear(list)
  const f = searchFilters()
  // "Beni anan" süzgecinde alıntıdaki anmalar da vurgulanır
  const marks = f.mentionsMe && state.me ? f.terms.concat([foldSearchText('@' + state.me.name), '@herkes', '@everyone']) : f.terms
  const shown = searchState.results.slice(0, searchState.shown)
  shown.forEach((entry) => {
    list.appendChild(buildSearchResult(entry, f.terms, marks))
  })
  list.hidden = shown.length === 0
  if (more) more.hidden = searchState.results.length <= searchState.shown
  if (focusKey && typeof restoreFocusKey === 'function') restoreFocusKey(list, focusKey)
}

// Durum satırı: taranan mesaj sayısı, sonuç sayısı, durdurma ve sürdürme. final true ise ekran
// okuyucuya özet duyurulur.
function renderSearchStatus (final) {
  if (!searchState.built) return
  const text = byId('search-status-text')
  const stop = byId('search-stop')
  const status = byId('search-status')
  if (!text || !stop) return
  const active = searchActive()
  const scanned = scopeScanned()
  const scannedText = t('search.scanned', { count: scanned, n: formatNumber(scanned) })
  const count = searchState.results.length
  const resultsText = count ? t('search.results', { count: count, n: formatNumber(count) }) : t('search.noResults')
  const f = searchFilters()
  let line = ''
  let showStop = false
  let stopKey = 'search.stop'
  if (scopeChannelIds().length === 0) {
    line = t('search.noConversation')
  } else if (!active) {
    line = t('search.empty')
  } else if (f.fromMissing) {
    line = t('search.fromMissing', { name: f.fromToken })
  } else if (searchState.error) {
    line = textOf(searchState.error) + ' ' + scannedText
    showStop = true
    stopKey = 'search.resume'
  } else if (searchState.scanning) {
    line = t('search.scanning', { scanned: scannedText }) + ' ' + resultsText
    showStop = true
  } else if (searchState.stopped && scopeIncomplete()) {
    line = t('search.stopped') + ' ' + scannedText + ' ' + resultsText
    showStop = true
    stopKey = 'search.resume'
  } else {
    line = scannedText + ' ' + resultsText
    if (scopeLimited()) line += ' ' + t('search.limitNote', { n: formatNumber(SEARCH_CHANNEL_MAX) })
  }
  text.textContent = line
  stop.hidden = !showStop
  stop.textContent = t(stopKey)
  if (status) {
    status.classList.toggle('is-scanning', searchState.scanning)
    status.classList.toggle('is-error', Boolean(searchState.error))
  }
  if (final) {
    const live = byId('search-live')
    if (live) live.textContent = active && !f.fromMissing ? resultsText : ''
  }
}

// Açma ve kapama

function currentConversationId () {
  let mode = 'channel'
  if (typeof currentViewMode === 'function') mode = currentViewMode()
  return mode === 'home' ? null : state.channelId
}

function openSearch (trigger) {
  if (!state.inApp) return
  const panel = searchPanelEl()
  if (!panel) return
  const existing = findLayer('search')
  const input0 = byId('search-input')
  if (existing && input0) {
    focusNode(input0)
    selectAll(input0)
    return
  }
  buildSearchPanel()
  const conv = currentConversationId()
  if (!sameId(conv, searchState.channelId)) {
    searchState.channelId = conv
    if (searchState.scope === 'channel') searchState.results = []
  }
  if (conv === null && searchState.scope === 'channel') searchState.scope = 'text'
  const input = byId('search-input')
  if (input) input.value = searchState.query
  panel.hidden = false
  panel.classList.toggle('is-sheet', isNarrow())
  if (isNarrow()) panel.setAttribute('aria-modal', 'true')
  else panel.removeAttribute('aria-modal')
  const btn = el.btnSearch || byId('btn-search')
  if (btn) btn.setAttribute('aria-expanded', 'true')
  searchApplyLanguage()
  // Kapanınca odak, açan düğmeye veya kısayoldan önce odaktaki öğeye döner. Dışarı tıklama bu dosyada
  // ayrıca ele alınır (tetikleyici mesaj listesi olabilir).
  openLayer({
    name: 'search',
    el: panel,
    trigger: trigger || btn,
    level: 1,
    trap: isNarrow(),
    closeOnFocusOut: !isNarrow(),
    initialFocus: () => byId('search-input'),
    onClose: onSearchClosed
  })
  if (searchActive()) executeSearch()
}

function onSearchClosed () {
  const panel = searchPanelEl()
  if (panel) panel.hidden = true
  closeSearchFromList()
  clearTimeout(searchState.debounce)
  if (searchState.scanning) {
    searchState.scanGen += 1
    searchState.scanning = false
    searchState.stopped = true
  }
  const btn = el.btnSearch || byId('btn-search')
  if (btn) btn.setAttribute('aria-expanded', 'false')
}

function closeSearch (restoreFocus) {
  const layer = findLayer('search')
  if (layer) closeLayer(layer, restoreFocus !== false)
}

function toggleSearch () {
  if (isSearchOpen()) closeSearch(true)
  else openSearch(el.btnSearch || byId('btn-search'))
}

// Sonuca gitme: konuşmaya geçilir, mesaj bağlamıyla yüklenip vurgulanır (06-messages.js)
function searchJump (entry) {
  closeSearch(false)
  if (typeof goToMessage === 'function') goToMessage(entry.channelId, entry.id)
}

// Konuşma değişince açık panelin "Bu kanal" kapsamı güncellenir
function searchOnConversationChange () {
  if (!isSearchOpen()) return
  const conv = currentConversationId()
  if (sameId(conv, searchState.channelId)) return
  searchState.channelId = conv
  if (conv === null && searchState.scope === 'channel') searchState.scope = 'text'
  renderSearchFilters()
  if (searchState.scope === 'channel') executeSearch()
}

function isTypingTarget (node) {
  if (!node || node === document.body) return false
  const tag = String(node.tagName || '').toLowerCase()
  if (tag === 'textarea' || tag === 'select') return true
  if (tag === 'input') {
    const type = String(node.type || '').toLowerCase()
    return ['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'file', 'color'].indexOf(type) === -1
  }
  return Boolean(node.isContentEditable)
}

// Ctrl+K ve Ctrl+F (Mac'te Cmd): odak yazma alanında veya başka bir giriş alanında değilken arama açılır
function onSearchShortcut (e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return
  const key = String(e.key || '').toLowerCase()
  if (key !== 'k' && key !== 'f') return
  if (!state.inApp || !el.appView || el.appView.hidden) return
  if (isSearchOpen()) {
    const input = byId('search-input')
    if (input) {
      e.preventDefault()
      focusNode(input)
      selectAll(input)
    }
    return
  }
  if (typeof isSettingsOpen === 'function' && isSettingsOpen()) return
  if (findLayer('app-dialog') || findLayer('viewer') || findLayer('settings')) return
  if (isTypingTarget(document.activeElement)) return
  e.preventDefault()
  const active = document.activeElement
  const back = active && active !== document.body && active !== document.documentElement ? active : null
  openSearch(back || el.btnSearch || byId('btn-search'))
}

// Panelin ve arama düğmesinin dışına tıklanınca (veya dokununca) panel kapanır
function onSearchOutside (e) {
  if (!isSearchOpen()) return
  const panel = searchPanelEl()
  const btn = el.btnSearch || byId('btn-search')
  const target = e.target
  if (!target || !target.nodeType) return
  if (panel && panel.contains(target)) return
  if (btn && btn.contains(target)) return
  // Arama panelinin üstünde açılan katmanlar (ör. profil kartı) paneli kapatmaz
  const top = topLayer()
  if (top && top.name !== 'search' && top.el && top.el.contains(target)) return
  closeSearch(false)
}

function searchInit () {
  const btn = el.btnSearch || byId('btn-search')
  if (btn) btn.addEventListener('click', toggleSearch)
  document.addEventListener('keydown', onSearchShortcut)
  document.addEventListener('mousedown', onSearchOutside, true)
  document.addEventListener('touchstart', onSearchOutside, { capture: true, passive: true })
}
