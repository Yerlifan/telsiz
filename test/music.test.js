'use strict'

// Telsiz DJ istemci motoru (public/music.js, window.TelsizMusic) ve YouTube bağdaştırıcısı
// (public/dj/youtube.js, window.TelsizYouTube) testleri. Dosyalar tarayıcıdaki gibi Node vm bağlamında,
// gerçek TweetNaCl ve public/crypto.js ile birlikte yüklenir. Sunucu (Ek L2.10) bellekte taklit edilir,
// zamanlayıcılar ve saat elle ilerletilir. Saf mantık (URL ayrıştırma, durum doğrulama, konum, saat farkı,
// CAS yeniden deneme, çift atlama koruması, komutlar) ve motorun oynatıcı yönetimi sınanır.

const { describe, test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const nodeCrypto = require('node:crypto')

const ROOT = path.join(__dirname, '..')
const NACL_SRC = fs.readFileSync(path.join(ROOT, 'public', 'vendor', 'nacl-fast.min.js'), 'utf8')
const E2EE_SRC = fs.readFileSync(path.join(ROOT, 'public', 'crypto.js'), 'utf8')
const MUSIC_SRC = fs.readFileSync(path.join(ROOT, 'public', 'music.js'), 'utf8')
const YT_SRC = fs.readFileSync(path.join(ROOT, 'public', 'dj', 'youtube.js'), 'utf8')
const I18N_SRC = fs.readFileSync(path.join(ROOT, 'public', 'i18n.js'), 'utf8')

const ROOM = 5
const OTHER_ROOM = 6
const VID = 'dQw4w9WgXcQ'
const VID2 = 'M7lc1UVf-VE'
const CONSENT_KEY = 'telsiz.djYoutubeConsent'

function makeLocalStorage () {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      map.set(k, String(v))
    },
    removeItem: (k) => {
      map.delete(k)
    },
    _map: map
  }
}

// Bir "cihaz": kendi vm bağlamı (localStorage, anahtarlık) ve yüklü betikler
function loadDevice (opts) {
  const o = opts || {}
  const sandbox = vm.createContext({})
  sandbox.self = sandbox
  sandbox.window = sandbox
  sandbox.setTimeout = setTimeout
  sandbox.clearTimeout = clearTimeout
  sandbox.setInterval = setInterval
  sandbox.clearInterval = clearInterval
  sandbox.crypto = nodeCrypto.webcrypto
  sandbox.localStorage = makeLocalStorage()
  sandbox.console = { log () {}, warn () {}, error () {} }
  if (o.nacl !== false) vm.runInContext(NACL_SRC, sandbox, { filename: 'nacl-fast.min.js' })
  if (o.e2ee !== false) vm.runInContext(E2EE_SRC, sandbox, { filename: 'crypto.js' })
  vm.runInContext(MUSIC_SRC, sandbox, { filename: 'music.js' })
  if (o.youtube) vm.runInContext(YT_SRC, sandbox, { filename: 'youtube.js' })
  if (o.code && o.e2ee !== false) sandbox.kid = sandbox.E2EE.keyring.add(o.code)
  return sandbox
}

const BASE = loadDevice({})
const M = BASE.TelsizMusic
const GROUP_CODE = BASE.E2EE.generateKeyCode()

// vm bağlamındaki nesnelerin ön örnekleri farklıdır, karşılaştırma JSON kopyasıyla yapılır
function same (actual, expected, message) {
  const plain = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))
  assert.deepEqual(plain(actual), plain(expected), message)
}

function flush (rounds) {
  let p = Promise.resolve()
  let left = rounds || 6
  while (left-- > 0) p = p.then(() => new Promise((resolve) => setImmediate(resolve)))
  return p
}

// Elle ilerletilen saat ve zamanlayıcılar. advance() sıradaki zamanlayıcıları sırayla çalıştırır ve
// aralarda bekleyen sözleri (microtask ve setImmediate) boşaltır.
function makeTimers (start) {
  let t = start || 1000000
  let seq = 0
  const list = new Map()
  const api = {
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = ++seq
      list.set(id, { fn, due: t + Math.max(0, Number(ms) || 0), every: 0 })
      return id
    },
    clearTimeout: (id) => {
      list.delete(id)
    },
    setInterval: (fn, ms) => {
      const id = ++seq
      const every = Math.max(1, Number(ms) || 1)
      list.set(id, { fn, due: t + every, every })
      return id
    },
    clearInterval: (id) => {
      list.delete(id)
    },
    pending: () => list.size,
    advance: async (ms) => {
      const target = t + ms
      await flush()
      let running = true
      while (running) {
        let nextId = null
        let next = null
        for (const [id, entry] of list) {
          if (entry.due <= target && (next === null || entry.due < next.due || (entry.due === next.due && id < nextId))) {
            next = entry
            nextId = id
          }
        }
        if (!next) {
          running = false
          continue
        }
        t = Math.max(t, next.due)
        if (next.every > 0) next.due += next.every
        else list.delete(nextId)
        next.fn()
        await flush()
      }
      t = target
      await flush()
    }
  }
  return api
}

// Ek L2.10 sözleşmesini taklit eden bellek içi sunucu. Sürüm sayacı sunucu geneldir (odalar arasında
// yeniden kullanılmaz). skew: sunucu saatinin yerel saatten farkı. Kayıtlardaki yazar bilgisi (by, since,
// writes, authors) gerçek sunucudaki gibi (src/music.js) tutulur. Testin rooms.set ile doğrudan koyduğu
// kayıt da sunucuya yapılmış bir yazım sayılır (yazar geçmişine eklenir).
const HISTORY = 32
function makeServer (timers, opts) {
  const o = opts || {}
  const hist = new Map()
  // Kayıt konduğu anda yazar geçmişi güncellenir (testin doğrudan koyduğu kayıtlar dahil)
  class RoomMap extends Map {
    set (room, rec) {
      super.set(room, rec)
      provenance(room, rec)
      return this
    }
  }
  const rooms = new RoomMap()
  // Odanın yazar geçmişi kaydın sürümüne göre güncellenir
  function provenance (room, rec) {
    let h = hist.get(room)
    if (!h || rec.v < h.lastV) {
      h = { since: 0, writes: [], authors: new Set(), lastV: 0 }
      hist.set(room, h)
    }
    // Yazanı bildirilmeyen kayıt (sunucu hatası taklidi) geçmişe girmez, istemci bu kaydı reddeder
    if (rec.v > h.lastV && Number.isSafeInteger(rec.by)) {
      h.writes.push({ v: rec.v, by: rec.by })
      h.authors.add(rec.by)
      if (h.writes.length > HISTORY) {
        h.since = h.writes[h.writes.length - HISTORY - 1].v
        h.writes = h.writes.slice(-HISTORY)
      }
      h.lastV = rec.v
    }
    return { since: h.since, writes: h.writes.map((w) => ({ v: w.v, by: w.by })), authors: Array.from(h.authors) }
  }
  function view (room, rec) {
    return Object.assign({ v: rec.v, at: rec.at, by: rec.by, env: rec.env }, provenance(room, rec))
  }
  const members = new Map()
  const uploads = new Map()
  const stats = { posts: 0, ok: 0, conflicts: 0 }
  let counter = 0
  let muv = 1
  let gate = null
  const server = {
    skew: o.skew || 0,
    enabled: true,
    youtube: true,
    maxEnv: 131072,
    rooms,
    stats,
    now: () => timers.now() + server.skew,
    join: (room, userId) => {
      if (!members.has(room)) members.set(room, new Set())
      members.get(room).add(userId)
    },
    leave: (room, userId) => {
      if (members.has(room)) members.get(room).delete(userId)
    },
    meta: () => {
      const voice = {}
      for (const [room, set] of members) voice[String(room)] = Array.from(set).map((id) => ({ userId: id, peerId: 'p' + id, muted: false, deafened: false }))
      return { activeKid: o.kid || null, music: { enabled: server.enabled, youtube: server.youtube }, voice }
    },
    musicMap: () => {
      const out = {}
      for (const [room, rec] of rooms) out[String(room)] = view(room, rec)
      return out
    },
    payload: () => ({ now: server.now(), muv, music: server.musicMap() }),
    // Bir sonraki n isteği birlikte bekletir (eşzamanlı CAS çakışması için)
    hold: (n) => {
      gate = { n, waiting: [] }
    },
    post: (userId, body) => {
      stats.posts++
      const handle = () => {
        const now = server.now()
        if (!server.enabled) return { status: 403, data: { code: 'dj_disabled', now } }
        const room = body.channelId
        if (!members.has(room) || !members.get(room).has(userId)) return { status: 403, data: { code: 'not_in_voice', now } }
        if (typeof body.env !== 'string' || body.env.length > server.maxEnv) return { status: 413, data: { code: 'too_large', now } }
        const cur = rooms.get(room)
        const v = cur ? cur.v : 0
        if (body.expect !== v) {
          stats.conflicts++
          return { status: 409, data: cur ? Object.assign(view(room, cur), { now }) : { v: 0, at: 0, by: null, env: null, now } }
        }
        // Testin doğrudan koyduğu kayıtların sürümleri de sayaçtan geçilmiş sayılır (sürüm yeniden kullanılmaz)
        for (const r of rooms.values()) counter = Math.max(counter, r.v)
        counter++
        rooms.set(room, { v: counter, at: now, by: userId, env: body.env })
        muv++
        stats.ok++
        return { status: 200, data: { v: counter, at: now, now } }
      }
      if (gate) {
        const g = gate
        return new Promise((resolve) => {
          g.waiting.push(() => resolve(handle()))
          if (g.waiting.length >= g.n) {
            gate = null
            g.waiting.forEach((fn) => fn())
          }
        })
      }
      return Promise.resolve(handle())
    },
    remove: (room) => {
      rooms.delete(room)
      hist.delete(room)
      muv++
    },
    upload: (bytes) => {
      const id = nodeCrypto.randomBytes(16).toString('hex')
      uploads.set(id, Buffer.from(bytes))
      return id
    },
    download: (id) => {
      const buf = uploads.get(id)
      if (!buf) return Promise.resolve({ status: 404, data: { code: 'upload_not_found' } })
      return Promise.resolve({ status: 200, data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) })
    }
  }
  return server
}

function fakeAudio (behaviour) {
  const b = behaviour || {}
  const listeners = {}
  const audio = {
    preload: '',
    src: '',
    currentTime: 0,
    duration: NaN,
    paused: true,
    ended: false,
    volume: 1,
    muted: false,
    plays: 0,
    seeks: [],
    addEventListener: (name, fn) => {
      if (!listeners[name]) listeners[name] = []
      listeners[name].push(fn)
    },
    fire: (name) => {
      const list = listeners[name] || []
      list.forEach((fn) => fn())
    },
    play: () => {
      audio.plays++
      if (b.block) {
        const err = new Error('blocked')
        err.name = 'NotAllowedError'
        return Promise.reject(err)
      }
      audio.paused = false
      audio.fire('play')
      return Promise.resolve()
    },
    pause: () => {
      if (!audio.paused) {
        audio.paused = true
        audio.fire('pause')
      }
    },
    removeAttribute: () => {},
    load: () => {}
  }
  Object.defineProperty(audio, 'position', { get: () => audio.currentTime })
  const seekProxy = new Proxy(audio, {
    set (target, key, value) {
      if (key === 'currentTime') target.seeks.push(value)
      target[key] = value
      return true
    }
  })
  return seekProxy
}

// Motor kurulumu: cihaz, sunucuya bağlı taşıma, elle zamanlayıcı ve sahte YouTube/ses fabrikaları
function makeClient (server, timers, userId, opts) {
  const o = opts || {}
  const device = o.device || loadDevice({ code: o.noKey ? null : GROUP_CODE })
  const events = []
  const audios = []
  const ytPlayers = []
  const urls = { created: [], revoked: [] }
  const storage = o.storage || makeStore()
  const youtube = {
    create: (cfg) => {
      const p = fakeYouTubePlayer(cfg, o.yt || {})
      ytPlayers.push(p)
      return p.impl
    }
  }
  const engine = device.TelsizMusic.create({
    transport: o.transport || {
      postState: (body) => server.post(userId, body),
      download: (id) => server.download(id)
    },
    storage,
    now: timers.now,
    timers,
    youtube,
    createAudio: () => {
      const a = fakeAudio(o.audio)
      audios.push(a)
      return a
    },
    createObjectURL: () => {
      const url = 'blob:test/' + nodeCrypto.randomBytes(4).toString('hex')
      urls.created.push(url)
      return url
    },
    revokeObjectURL: (url) => {
      urls.revoked.push(url)
    },
    makeBlob: (bytes, type) => ({ bytes, type }),
    canPlayType: () => 'probably',
    probeVolume: o.probeVolume,
    t: (key) => 'T:' + key
  })
  for (const name of ['change', 'track', 'position', 'error', 'consentneeded', 'tapneeded', 'notice']) {
    engine.on(name, (payload) => events.push({ name, payload }))
  }
  const client = {
    device,
    engine,
    events,
    audios,
    ytPlayers,
    urls,
    storage,
    userId,
    sync: () => {
      engine.handleMeta(server.meta(), userId)
      engine.ingest(server.payload(), { t0: timers.now(), t1: timers.now() })
    },
    count: (name) => events.filter((e) => e.name === name).length,
    last: (name) => {
      const list = events.filter((e) => e.name === name)
      return list.length ? list[list.length - 1].payload : null
    }
  }
  return client
}

function makeStore () {
  const map = new Map()
  return {
    get: (k) => (map.has(k) ? map.get(k) : null),
    set: (k, v) => {
      map.set(k, String(v))
    },
    remove: (k) => {
      map.delete(k)
    },
    map
  }
}

// Belgelenmiş durum kodları: -1 başlamadı, 5 hazırlandı, 1 çalıyor, 2 duraklatıldı
function fakeYouTubePlayer (cfg, behaviour) {
  const state = { ready: false, playing: false, pos: 0, posAt: 0, commands: [], destroyed: false, visible: behaviour.visible !== false, yt: -1, durationMs: behaviour.durationMs || 0 }
  const emit = (ev) => cfg.onEvent(ev)
  const impl = {
    ready: () => state.ready,
    playing: () => state.playing,
    state: () => (state.playing ? 1 : state.yt),
    durationMs: () => state.durationMs,
    position: () => (state.ready ? Math.round(state.pos + (state.playing ? cfg.now() - state.posAt : 0)) : null),
    play: () => {
      state.commands.push('play')
      if (behaviour.block) return Promise.resolve('blocked')
      state.posAt = cfg.now()
      state.playing = true
      emit({ type: 'playing' })
      return Promise.resolve('ok')
    },
    pause: () => {
      state.commands.push('pause')
      if (state.playing) state.pos += cfg.now() - state.posAt
      state.playing = false
      state.yt = 2
    },
    seek: (ms) => {
      state.commands.push('seek:' + ms)
      state.pos = ms
      state.posAt = cfg.now()
    },
    setVolume: (v) => state.commands.push('volume:' + v),
    setMuted: (m) => state.commands.push('muted:' + m),
    visible: () => state.visible,
    element: () => null,
    destroy: () => {
      state.destroyed = true
    }
  }
  return {
    cfg,
    state,
    impl,
    becomeReady: () => {
      state.ready = true
      state.yt = 5
      emit({ type: 'ready' })
    },
    emit
  }
}

function track (over) {
  return Object.assign({ id: '0123456789abcdef', type: 'youtube', videoId: VID, title: 'Parça', addedBy: 1, duration: 0 }, over || {})
}

function fileTrack (over) {
  return Object.assign({
    id: 'fedcba9876543210',
    type: 'file',
    file: { u: 'a'.repeat(32), k: 'K'.repeat(43), n: 'N'.repeat(32), m: 'audio/wav', s: 1000 },
    title: 'Dosya',
    addedBy: 2,
    duration: 30000
  }, over || {})
}

function state (over) {
  return Object.assign({
    v: 1,
    ctx: 'music',
    room: ROOM,
    sid: '00112233aabbccdd',
    seq: 3,
    current: track(),
    queue: [fileTrack()],
    gone: [],
    playing: true,
    anchorAt: 1000000,
    anchorPos: 0,
    last: { op: 'add', by: 1, id: '0123456789abcdef', title: 'Parça' }
  }, over || {})
}

function makeWav (seconds, rate) {
  const sr = rate || 8000
  const n = Math.round(seconds * sr)
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 2, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24)
  buf.writeUInt32LE(sr * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 2, 40)
  let i = 0
  while (i < n) {
    buf.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / sr) * 8000), 44 + i * 2)
    i++
  }
  return buf
}

// ------------------------------------------------------------------ YouTube bağlantısı

describe('parseYouTubeUrl', () => {
  test('Ek L2.2 biçimlerinin hepsi kimliği verir', () => {
    const ok = [
      'https://www.youtube.com/watch?v=' + VID,
      'http://youtube.com/watch?v=' + VID,
      'youtube.com/watch?v=' + VID,
      'https://m.youtube.com/watch?v=' + VID + '&t=42s',
      'https://www.youtube.com/watch?feature=share&v=' + VID + '&list=PL123',
      'https://www.youtube.com/watch/?v=' + VID,
      'https://youtu.be/' + VID,
      'https://youtu.be/' + VID + '?t=10',
      'https://youtu.be/' + VID + '/',
      'https://www.youtube.com/shorts/' + VID,
      'https://youtube.com/shorts/' + VID + '?feature=share',
      'https://music.youtube.com/watch?v=' + VID + '&si=abc',
      'https://www.youtube-nocookie.com/embed/' + VID,
      'https://youtube-nocookie.com/embed/' + VID + '?start=3',
      'https://WWW.YouTube.COM/watch?v=' + VID,
      '  https://youtu.be/' + VID + '  ',
      'https://www.youtube.com/watch?v=' + VID + '#t=1m',
      'https://www.youtube.com/watch?v=' + encodeURIComponent(VID)
    ]
    for (const url of ok) same(M.parseYouTubeUrl(url), { videoId: VID }, url)
  })

  test('oynatma listesi, arama, başka alan adları ve bozuk kimlikler reddedilir', () => {
    const bad = [
      '',
      'merhaba',
      'https://www.youtube.com/playlist?list=PL123',
      'https://www.youtube.com/results?search_query=muzik',
      'https://www.youtube.com/watch?list=PL123',
      'https://www.youtube.com/watch?v=' + VID.slice(0, 10),
      'https://www.youtube.com/watch?v=' + VID + 'x',
      'https://www.youtube.com/watch?v=dQw4w9WgXc!',
      'https://youtu.be/' + VID + 'x',
      'https://youtu.be/watch?v=' + VID,
      'https://youtube.com.evil.example/watch?v=' + VID,
      'https://evilyoutube.com/watch?v=' + VID,
      'https://user@youtube.com/watch?v=' + VID,
      'https://youtube.com:8080/watch?v=' + VID,
      'https://music.youtube.com/shorts/' + VID,
      'https://www.youtube-nocookie.com/watch?v=' + VID,
      'javascript:alert(1)//youtu.be/' + VID,
      'ftp://youtu.be/' + VID,
      'https://youtu.be/' + VID + ' x',
      'https://youtu.be/\u0000' + VID,
      'https://www.youtube.com/watch?v=%E0%A4%A',
      'https://www.youtube.com/channel/UC123',
      'https://youtu.be/' + 'a'.repeat(3000),
      null,
      42
    ]
    for (const url of bad) assert.equal(M.parseYouTubeUrl(url), null, String(url))
  })
})

// ------------------------------------------------------------------ komutlar

describe('parseCommand', () => {
  test('Türkçe ve İngilizce adlar, büyük harf ve ayrışık yazım', () => {
    const cases = [
      ['/çal https://youtu.be/' + VID, 'play'],
      ['/play https://youtu.be/' + VID, 'play'],
      ['/ÇAL https://youtu.be/' + VID, 'play'],
      ['/çal https://youtu.be/' + VID, 'play'],
      ['/geç', 'skip'],
      ['/GEÇ', 'skip'],
      ['/skip', 'skip'],
      ['/duraklat', 'pause'],
      ['/DURAKLAT', 'pause'],
      ['/pause', 'pause'],
      ['/devam', 'resume'],
      ['/resume', 'resume'],
      ['/kuyruk', 'queue'],
      ['/queue', 'queue'],
      ['/dur', 'stop'],
      ['/stop', 'stop'],
      ['  /Stop  ', 'stop']
    ]
    for (const [text, name] of cases) {
      const cmd = M.parseCommand(text)
      assert.ok(cmd, text)
      assert.equal(cmd.name, name, text)
    }
    assert.equal(M.parseCommand('/çal https://youtu.be/' + VID).videoId, VID)
  })

  test('DJ komutu olmayan metin null, bozuk bağlantı ve boş /çal ayrı bildirilir', () => {
    for (const text of ['merhaba', '', '/merhaba', '/playlist', '/durdur', 'play', ' / play', null]) {
      assert.equal(M.parseCommand(text), null, String(text))
    }
    assert.equal(M.parseCommand('/play https://example.com/x').error, 'bad_url')
    const empty = M.parseCommand('/çal')
    assert.equal(empty.name, 'play')
    assert.equal(empty.videoId, null)
    assert.equal(empty.error, undefined)
    assert.equal(M.parseCommand('/skip   fazladan').arg, 'fazladan')
  })

  test('komut listesi sözleşmesi', () => {
    same(Object.keys(M.COMMANDS), ['play', 'skip', 'pause', 'resume', 'queue', 'stop'])
    assert.ok(M.COMMANDS.play.includes('/çal'))
    assert.ok(M.COMMANDS.skip.includes('/geç'))
  })
})

// ------------------------------------------------------------------ durum doğrulama

describe('validateState', () => {
  test('geçerli durum yalnızca bilinen alanlarla yeni bir nesne olarak döner', () => {
    const input = state()
    const res = M.validateState(input, ROOM)
    assert.equal(res.ok, true)
    assert.notEqual(res.state, input)
    input.current.title = 'degisti'
    assert.equal(res.state.current.title, 'Parça')
    assert.equal(M.validateState(state({ current: null, queue: [], playing: false, last: null }), ROOM).ok, true)
  })

  test('her alan katı biçimde denetlenir', () => {
    const cases = [
      [null, 'not_object'],
      [[], 'not_object'],
      [state({ extra: 1 }), 'keys'],
      [Object.assign(state(), { last: undefined }), 'last'],
      [state({ v: 2 }), 'version'],
      [state({ ctx: 'msg' }), 'context'],
      [state({ room: OTHER_ROOM }), 'room'],
      [state({ room: '5' }), 'room'],
      [state({ sid: 'XYZ' }), 'sid'],
      [state({ seq: 0 }), 'seq'],
      [state({ seq: 1.5 }), 'seq'],
      [state({ playing: 1 }), 'playing'],
      [state({ anchorAt: -1 }), 'anchor_at'],
      [state({ anchorPos: 86400001 }), 'anchor_pos'],
      [state({ current: track({ videoId: 'kisa' }) }), 'current'],
      [state({ current: track({ type: 'video' }) }), 'current'],
      [state({ current: track({ id: 'ABC' }) }), 'current'],
      [state({ current: track({ addedBy: 0 }) }), 'current'],
      [state({ current: track({ duration: -1 }) }), 'current'],
      [state({ current: track({ title: 'a\u202eb' }) }), 'current'],
      [state({ current: track({ title: 'a\u0007b' }) }), 'current'],
      [state({ current: track({ title: 'a\ud800b' }) }), 'current'],
      [state({ current: track({ title: 'x'.repeat(121) }) }), 'current'],
      [state({ current: track({ file: {} }) }), 'current'],
      [state({ queue: [fileTrack({ file: { u: 'a'.repeat(32), k: 'K'.repeat(43), n: 'N'.repeat(32), m: 'text/html', s: 10 } })] }), 'queue'],
      [state({ queue: [fileTrack({ file: { u: 'a'.repeat(31), k: 'K'.repeat(43), n: 'N'.repeat(32), m: 'audio/wav', s: 10 } })] }), 'queue'],
      [state({ queue: [fileTrack({ file: { u: 'a'.repeat(32), k: 'K'.repeat(43), n: 'N'.repeat(32), m: 'audio/wav', s: 0 } })] }), 'queue'],
      [state({ queue: [fileTrack({ videoId: VID })] }), 'queue'],
      [state({ queue: 'x' }), 'queue'],
      [state({ current: null }), 'empty_session'],
      [state({ queue: [track()] }), 'duplicate_id'],
      [state({ last: { op: 'hack', by: 1 } }), 'last'],
      [state({ last: { op: 'add', by: 1, code: 'BAD CODE' } }), 'last'],
      [state({ last: { op: 'add' } }), 'last'],
      [state({ gone: 'x' }), 'gone'],
      [state({ gone: ['ABC'] }), 'gone'],
      [state({ gone: ['5555555555555555', '5555555555555555'] }), 'gone'],
      [state({ gone: [track().id] }), 'gone'],
      [Object.assign(state(), { gone: undefined }), 'gone']
    ]
    for (const [value, reason] of cases) {
      const res = M.validateState(value, ROOM)
      assert.equal(res.ok, false, JSON.stringify(value))
      assert.equal(res.reason, reason, JSON.stringify(value))
    }
    const full = Array.from({ length: 101 }, (x, i) => track({ id: '1' + i.toString(16).padStart(15, '0') }))
    assert.equal(M.validateState(state({ queue: full }), ROOM).reason, 'queue')
    assert.equal(M.validateState(state({ queue: full.slice(0, 100) }), ROOM).ok, true)
    const gone = Array.from({ length: 129 }, (x, i) => '6' + i.toString(16).padStart(15, '0'))
    assert.equal(M.validateState(state({ gone }), ROOM).reason, 'gone')
    assert.equal(M.validateState(state({ gone: gone.slice(0, 128) }), ROOM).ok, true)
  })

  test('başlık sınırı kod noktası sayar (120 emoji geçerlidir)', () => {
    const emoji = '🎵'.repeat(120)
    assert.equal(M.validateState(state({ current: track({ title: emoji }) }), ROOM).ok, true)
    assert.equal(M.validateState(state({ current: track({ title: emoji + 'a' }) }), ROOM).ok, false)
  })
})

// ------------------------------------------------------------------ konum

describe('positionAt', () => {
  test('çapa konumu + (sunucu şimdi - çapa zamanı), süreyle sınırlı', () => {
    const s = state({ anchorAt: 1000, anchorPos: 5000, current: track({ duration: 60000 }) })
    assert.equal(M.positionAt(s, 1000), 5000)
    assert.equal(M.positionAt(s, 3500), 7500)
    assert.equal(M.positionAt(s, 500), 5000)
    assert.equal(M.positionAt(s, 999999), 60000)
    assert.equal(M.positionAt(state({ playing: false, anchorAt: 1000, anchorPos: 4000 }), 99999), 4000)
    assert.equal(M.positionAt(state({ anchorAt: 0, anchorPos: 0, current: track({ duration: 0 }) }), 123456), 123456)
    assert.equal(M.positionAt(state({ current: null, queue: [], playing: false }), 5), 0)
    assert.equal(M.positionAt(null, 5), 0)
  })
})

// ------------------------------------------------------------------ işlemler

describe('applyOp', () => {
  const ctx = (now) => ({ room: ROOM, me: 7, now: now || 50000, newSid: () => 'aaaaaaaaaaaaaaaa' })

  test('boş odaya ekleme oturumu başlatır, başlangıç payıyla çalar', () => {
    const s = M.applyOp(null, { type: 'add', track: track() }, ctx())
    assert.equal(s.current.id, track().id)
    assert.equal(s.playing, true)
    assert.equal(s.anchorAt, 50000 + M.LIMITS.startLeadMs)
    assert.equal(s.seq, 1)
    assert.equal(s.sid, 'aaaaaaaaaaaaaaaa')
    same({ op: s.last.op, by: s.last.by }, { op: 'add', by: 7 })
    assert.equal(M.validateState(s, ROOM).ok, true)
  })

  test('aynı kimlikle ikinci ekleme etkisizdir, kuyruk 100 parçada dolar', () => {
    let s = M.applyOp(null, { type: 'add', track: track() }, ctx())
    assert.equal(M.applyOp(s, { type: 'add', track: track() }, ctx()), null)
    Array.from({ length: 100 }, (x, i) => '2' + i.toString(16).padStart(15, '0')).forEach((id) => {
      s = M.applyOp(s, { type: 'add', track: track({ id }) }, ctx())
    })
    assert.equal(s.queue.length, 100)
    assert.throws(() => M.applyOp(s, { type: 'add', track: track({ id: 'ffffffffffffffff' }) }, ctx()), (e) => e.code === 'queue_full')
    assert.throws(() => M.applyOp(s, { type: 'add', track: { id: 'x' } }, ctx()), (e) => e.code === 'bad_track')
    assert.throws(() => M.applyOp(s, { type: 'nuke' }, ctx()), (e) => e.code === 'bad_op')
  })

  test('geçiş yalnızca çalan parçanın kimliğiyle yapılır (çift atlama yok)', () => {
    const s = state()
    const a = M.applyOp(s, { type: 'end', id: s.current.id }, ctx(2000000))
    assert.equal(a.current.id, fileTrack().id)
    assert.equal(a.queue.length, 0)
    assert.equal(a.anchorPos, 0)
    assert.equal(a.anchorAt, 2000000 + M.LIMITS.startLeadMs)
    assert.equal(a.seq, s.seq + 1)
    // Aynı parça kimliğiyle ikinci geçiş (başka bir istemciden) reddedilir
    assert.equal(M.applyOp(a, { type: 'end', id: s.current.id }, ctx()), null)
    assert.equal(M.applyOp(a, { type: 'skip', id: s.current.id }, ctx()), null)
    assert.equal(M.applyOp(a, { type: 'error_skip', id: s.current.id, code: 'yt_embed_blocked' }, ctx()), null)
    const last = M.applyOp(a, { type: 'skip', id: a.current.id }, ctx())
    assert.equal(last.current, null)
    assert.equal(last.playing, false)
    assert.equal(M.validateState(last, ROOM).ok, true)
    const e = M.applyOp(s, { type: 'error_skip', id: s.current.id, code: 'yt_embed_blocked' }, ctx())
    assert.equal(e.last.code, 'yt_embed_blocked')
    assert.equal(M.applyOp(s, { type: 'error_skip', id: s.current.id, code: 'BAD!' }, ctx()).last.code, undefined)
  })

  test('duraklatılmış oturumda geçiş duraklatılmış kalır', () => {
    const s = state({ playing: false, anchorPos: 9000 })
    const a = M.applyOp(s, { type: 'skip', id: s.current.id }, ctx(70000))
    assert.equal(a.playing, false)
    assert.equal(a.anchorAt, 70000)
    assert.equal(a.anchorPos, 0)
  })

  test('çıkar, sırala, duraklat, devam, dur', () => {
    const t2 = track({ id: '1111111111111111', videoId: VID2 })
    const t3 = track({ id: '2222222222222222' })
    let s = state({ queue: [fileTrack(), t2, t3] })
    s = M.applyOp(s, { type: 'move', id: t3.id, to: 0 }, ctx())
    same(s.queue.map((x) => x.id), [t3.id, fileTrack().id, t2.id])
    assert.equal(M.applyOp(s, { type: 'move', id: t3.id, to: 0 }, ctx()), null)
    assert.equal(M.applyOp(s, { type: 'move', id: t3.id, to: 99 }, ctx()).queue[2].id, t3.id)
    assert.equal(M.applyOp(s, { type: 'move', id: 'eeeeeeeeeeeeeeee', to: 1 }, ctx()), null)
    s = M.applyOp(s, { type: 'remove', id: fileTrack().id }, ctx())
    same(s.queue.map((x) => x.id), [t3.id, t2.id])
    assert.equal(M.applyOp(s, { type: 'remove', id: fileTrack().id }, ctx()), null)
    const removedCurrent = M.applyOp(s, { type: 'remove', id: s.current.id }, ctx(1000000))
    assert.equal(removedCurrent.current.id, t3.id)
    // Duraklat: konum sabitlenir
    const p = M.applyOp(state({ anchorAt: 10000, anchorPos: 2000 }), { type: 'pause' }, ctx(15000))
    assert.equal(p.playing, false)
    assert.equal(p.anchorPos, 7000)
    assert.equal(p.anchorAt, 15000)
    assert.equal(M.applyOp(p, { type: 'pause' }, ctx()), null)
    const r = M.applyOp(p, { type: 'resume' }, ctx(20000))
    assert.equal(r.playing, true)
    assert.equal(r.anchorPos, 7000)
    assert.equal(r.anchorAt, 20000)
    assert.equal(M.applyOp(r, { type: 'resume' }, ctx()), null)
    const st = M.applyOp(r, { type: 'stop' }, ctx(30000))
    assert.equal(st.current, null)
    assert.equal(st.queue.length, 0)
    assert.equal(st.playing, false)
    assert.equal(M.applyOp(st, { type: 'stop' }, ctx()), null)
    assert.equal(M.validateState(st, ROOM).ok, true)
    // Durdurulmuş oturuma ekleme aynı oturum kimliğiyle yeniden çalar
    const again = M.applyOp(st, { type: 'add', track: t2 }, ctx(40000))
    assert.equal(again.sid, st.sid)
    assert.equal(again.playing, true)
    assert.equal(again.seq, st.seq + 1)
  })

  test('açıklama yalnızca boş başlık ve bilinmeyen süreyi doldurur', () => {
    const s = state({ current: track({ title: '', duration: 0 }) })
    const a = M.applyOp(s, { type: 'annotate', id: s.current.id, title: '  Gerçek\u202e ad  ', duration: 213000 }, ctx())
    assert.equal(a.current.title, 'Gerçek ad')
    assert.equal(a.current.duration, 213000)
    assert.equal(M.validateState(a, ROOM).ok, true)
    assert.equal(M.applyOp(a, { type: 'annotate', id: s.current.id, title: 'Başka', duration: 1 }, ctx()), null)
    assert.equal(M.applyOp(s, { type: 'annotate', id: s.current.id, title: '\u200b', duration: 0 }, ctx()), null)
  })

  test('YouTube kapalıyken YouTube parçaları temizlenir', () => {
    const s = state({ queue: [fileTrack(), track({ id: '3333333333333333' })] })
    const a = M.applyOp(s, { type: 'purge_youtube' }, ctx(5000000))
    assert.equal(a.current.type, 'file')
    assert.equal(a.queue.length, 0)
    assert.equal(a.last.op, 'purge_youtube')
    assert.equal(M.applyOp(a, { type: 'purge_youtube' }, ctx()), null)
  })
})

// ------------------------------------------------------------------ saat farkı

describe('createClock', () => {
  test('aralıkların kesişimi: kestirim orta nokta, hata payı yarı genişlik', () => {
    let local = 1000
    const c = M.createClock({ now: () => local })
    assert.equal(c.synced(), false)
    assert.equal(c.offset(), 0)
    // Gerçek fark +5000: istek 1000'de gitti, 1100'de döndü, sunucu 6060'ta yanıtladı
    assert.equal(c.sample(1000, 1100, 6060), true)
    assert.equal(c.offset(), 5010)
    assert.equal(c.uncertainty(), 50)
    c.sample(2000, 2020, 7015)
    assert.ok(Math.abs(c.offset() - 5000) <= 10, String(c.offset()))
    assert.ok(c.uncertainty() <= 10)
    local = 3000
    assert.ok(Math.abs(c.serverNow() - 8000) <= 10)
    assert.equal(c.sample(NaN, 3000, 0), false)
  })

  test('yalnızca alt sınır (uzun poll) ve çelişkide sıfırlama', () => {
    const c = M.createClock({ now: () => 0 })
    c.sample(NaN, 1000, 3000)
    assert.equal(c.offset(), 2000)
    assert.equal(c.uncertainty(), Infinity)
    c.sample(1500, 1600, 3700)
    assert.ok(c.offset() >= 2100 && c.offset() <= 2200)
    // Yerel saat atladı: yeni aralık eskileriyle kesişmez, en yeni örneğe dönülür
    c.sample(100000, 100010, 50000)
    assert.ok(Math.abs(c.offset() - (50000 - 100005)) <= 5)
  })

  test('eski örnekler 10 dakikalık pencereden düşer', () => {
    const c = M.createClock({ now: () => 0 })
    c.sample(0, 10, 1010)
    c.sample(700000, 700010, 702000)
    assert.ok(c.offset() >= 1990 && c.offset() <= 2000)
  })
})

// ------------------------------------------------------------------ ses dosyası türleri

describe('ses türleri', () => {
  test('sihirli baytlar ve MIME eşdeğerleri', () => {
    assert.equal(M.sniffAudio(makeWav(0.01)), 'audio/wav')
    assert.equal(M.sniffAudio(Buffer.from('OggS0000')), 'audio/ogg')
    assert.equal(M.sniffAudio(Buffer.from('fLaC0000')), 'audio/flac')
    assert.equal(M.sniffAudio(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0])), 'audio/webm')
    assert.equal(M.sniffAudio(Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])), 'audio/mp4')
    assert.equal(M.sniffAudio(Buffer.from('ID3\u0004')), 'audio/mpeg')
    assert.equal(M.sniffAudio(Buffer.from([0xff, 0xfb, 0x90, 0x00])), 'audio/mpeg')
    assert.equal(M.sniffAudio(Buffer.from([0xff, 0xf1, 0x50, 0x80])), 'audio/aac')
    assert.equal(M.sniffAudio(Buffer.from('<html>')), null)
    assert.equal(M.sniffAudio(Buffer.from([1, 2])), null)
    assert.equal(M.normalizeAudioType('audio/x-wav'), 'audio/wav')
    assert.equal(M.normalizeAudioType('audio/mp3; codecs=x'), 'audio/mpeg')
    assert.equal(M.normalizeAudioType('', 'sarki.OPUS'), 'audio/ogg')
    assert.equal(M.normalizeAudioType('text/plain', 'x.txt'), null)
    assert.equal(M.isAudioAttachment({ kind: 'file', m: 'audio/flac', name: 'a.flac' }), true)
    assert.equal(M.isAudioAttachment({ kind: 'image', m: 'audio/flac' }), false)
    assert.equal(M.isAudioAttachment({ kind: 'file', m: 'application/pdf', name: 'a.pdf' }), false)
  })
})

// ------------------------------------------------------------------ şifreleme ve bağlam bağlama

describe('zarf ve bağlam bağlama', () => {
  test('en kötü durum zarfı sınırın altındadır', () => {
    const dev = loadDevice({ code: GROUP_CODE })
    const title = '😀'.repeat(120)
    const ft = fileTrack({ title, addedBy: Number.MAX_SAFE_INTEGER, duration: 86400000, file: { u: '0'.repeat(32), k: 'A'.repeat(43), n: 'B'.repeat(32), m: 'audio/mpeg', s: 2147483647 } })
    const queue = Array.from({ length: 100 }, (x, i) => Object.assign({}, ft, { id: '4' + i.toString(16).padStart(15, '0') }))
    const gone = Array.from({ length: 128 }, (x, i) => '7' + i.toString(16).padStart(15, '0'))
    const s = state({ room: Number.MAX_SAFE_INTEGER, seq: Number.MAX_SAFE_INTEGER, current: ft, queue, gone, anchorAt: 8640000000000000, anchorPos: 86400000, last: { op: 'error_skip', by: Number.MAX_SAFE_INTEGER, id: ft.id, title, code: 'a'.repeat(40) } })
    assert.equal(dev.TelsizMusic.validateState(s, Number.MAX_SAFE_INTEGER).ok, true)
    const env = dev.E2EE.sealJson(dev.kid, s)
    assert.ok(env.length < M.LIMITS.maxEnvChars, String(env.length))
    assert.ok(env.length > 90000)
  })
})

// ------------------------------------------------------------------ motor

async function setup (opts) {
  const o = opts || {}
  const timers = makeTimers()
  const server = makeServer(timers, { kid: BASE.E2EE.parseKeyCode(GROUP_CODE).kid, skew: o.skew })
  const clients = []
  Array.from({ length: o.count || 2 }, (x, i) => i).forEach((i) => {
    const userId = i + 1
    server.join(ROOM, userId)
    clients.push(makeClient(server, timers, userId, (o.client && o.client[i]) || {}))
  })
  for (const c of clients) {
    c.engine.setVoiceRoom(ROOM)
    c.sync()
  }
  return { timers, server, clients, syncAll: () => clients.forEach((c) => c.sync()) }
}

describe('motor: eşitleme, CAS ve komutlar', () => {
  test('ekleme şifreli zarfla sunucuya gider, öteki istemci aynı durumu görür', async () => {
    const { timers, server, clients: [a, b] } = await setup()
    a.storage.set(CONSENT_KEY, '1')
    const res = await a.engine.addYouTube('https://youtu.be/' + VID, { title: 'Deneme' })
    assert.equal(res.ok, true)
    assert.match(res.trackId, /^[0-9a-f]{16}$/)
    const rec = server.rooms.get(ROOM)
    assert.match(rec.env, /^1\.[0-9a-f]{16}\./)
    assert.ok(!rec.env.includes(VID))
    b.sync()
    const sa = a.engine.snapshot()
    const sb = b.engine.snapshot()
    assert.equal(sb.session.current.videoId, VID)
    assert.equal(sb.session.current.title, 'Deneme')
    assert.equal(sb.session.v, sa.session.v)
    assert.equal(sb.session.playing, true)
    assert.ok(sb.session.startsInMs > 0 && sb.session.startsInMs <= M.LIMITS.startLeadMs)
    assert.equal(b.count('track'), 1)
    assert.equal(b.last('notice').op, 'add')
    assert.equal(a.count('notice'), 0)
    await timers.advance(10)
    assert.ok(timers.pending() > 0)
  })

  test('eşzamanlı iki ekleme: biri 409 alır, durumu alıp işlemini yeniden uygular, iki parça da kalır', async () => {
    const { timers, server, clients: [a, b] } = await setup()
    server.hold(2)
    const pa = a.engine.addYouTube(VID)
    const pb = b.engine.addYouTube(VID2)
    await timers.advance(5000)
    const [ra, rb] = await Promise.all([pa, pb])
    assert.equal(ra.ok, true)
    assert.equal(rb.ok, true)
    assert.ok(server.stats.conflicts >= 1)
    a.sync()
    b.sync()
    const s = a.engine.snapshot().session
    const ids = [s.current.videoId].concat(s.queue.map((t) => t.videoId)).sort()
    same(ids, [VID, VID2].sort())
    same(b.engine.snapshot().session, s)
  })

  test('parça sonunda üç istemci aynı anda geçiş ister, yalnızca bir geçiş olur', async () => {
    const { timers, server, clients, syncAll } = await setup({ count: 3 })
    const [a] = clients
    await a.engine.addYouTube(VID, { title: 'Bir', durationMs: 4000 })
    await a.engine.addYouTube(VID2, { title: 'Iki', durationMs: 4000 })
    const third = await a.engine.addYouTube('https://youtu.be/aaaaaaaaaaa')
    assert.equal(third.ok, true)
    syncAll()
    const before = server.rooms.get(ROOM).v
    const firstId = a.engine.snapshot().session.current.id
    server.hold(3)
    // Süre 4 sn, başlangıç payı 1,5 sn, son payı 2,5 sn: 8,5 sn sonra her istemci yedek geçişi ister
    await timers.advance(9000)
    syncAll()
    const s = a.engine.snapshot().session
    assert.notEqual(s.current.id, firstId)
    assert.equal(s.current.videoId, VID2)
    assert.equal(s.queue.length, 1)
    assert.equal(server.rooms.get(ROOM).v, before + 1)
    assert.equal(server.stats.conflicts, 2)
    for (const c of clients) assert.equal(c.engine.snapshot().session.current.id, s.current.id)
  })

  test('geç katılan istemci ortak konumu sunucu saat farkıyla hesaplar', async () => {
    const { timers, server, clients: [a] } = await setup({ skew: 777777 })
    a.storage.set(CONSENT_KEY, '1')
    await a.engine.addYouTube(VID, { durationMs: 600000 })
    await timers.advance(20000)
    server.join(ROOM, 3)
    const late = makeClient(server, timers, 3, {})
    late.engine.setVoiceRoom(ROOM)
    late.sync()
    const pos = late.engine.snapshot().session.positionMs
    assert.ok(Math.abs(pos - (20000 - M.LIMITS.startLeadMs)) <= 5, String(pos))
    assert.ok(Math.abs(late.engine.serverNow() - server.now()) <= 1)
  })

  test('duraklat, devam, geç, dur ve kuyruk komutları', async () => {
    const { timers, clients: [a, b] } = await setup()
    await a.engine.addYouTube(VID)
    await a.engine.addYouTube(VID2)
    await timers.advance(5000)
    b.sync()
    let r = await b.engine.runCommand('/duraklat')
    same({ ok: r.ok, command: r.command }, { ok: true, command: 'pause' })
    a.sync()
    const paused = a.engine.snapshot().session
    assert.equal(paused.playing, false)
    assert.ok(Math.abs(paused.positionMs - 3500) <= 5)
    await timers.advance(3000)
    a.sync()
    assert.equal(a.engine.snapshot().session.positionMs, paused.positionMs)
    r = await a.engine.runCommand('/resume')
    assert.equal(r.ok, true)
    r = await a.engine.runCommand('/devam')
    assert.equal(r.ok, true)
    assert.equal(r.noop, true)
    r = await a.engine.runCommand('/kuyruk')
    assert.equal(r.ok, true)
    assert.equal(r.queue.current.videoId, VID)
    assert.equal(r.queue.queue.length, 1)
    b.sync()
    r = await b.engine.runCommand('/geç')
    assert.equal(r.ok, true)
    a.sync()
    assert.equal(a.engine.snapshot().session.current.videoId, VID2)
    assert.equal(a.last('notice').op, 'skip')
    r = await a.engine.runCommand('/dur')
    assert.equal(r.ok, true)
    b.sync()
    assert.equal(b.engine.snapshot().session.current, null)
    r = await b.engine.runCommand('/skip')
    assert.equal(r.code, 'nothing_playing')
    r = await b.engine.runCommand('/stop')
    assert.equal(r.code, 'nothing_playing')
    assert.equal(a.engine.runCommand('merhaba'), null)
    r = await a.engine.runCommand('/play')
    assert.equal(r.code, 'play_needs_source')
    r = await a.engine.runCommand('/play https://vimeo.com/1')
    assert.equal(r.code, 'bad_url')
  })

  test('kuyruktan çıkarma ve sıralama', async () => {
    const { clients: [a] } = await setup()
    await a.engine.addYouTube(VID)
    const r2 = await a.engine.addYouTube(VID2)
    const r3 = await a.engine.addYouTube('aaaaaaaaaaa')
    assert.equal((await a.engine.move(r3.trackId, 0)).ok, true)
    same(a.engine.queue().queue.map((t) => t.id), [r3.trackId, r2.trackId])
    assert.equal((await a.engine.remove(r2.trackId)).ok, true)
    same(a.engine.queue().queue.map((t) => t.id), [r3.trackId])
    assert.equal((await a.engine.remove('zz')).code, 'bad_track')
    assert.equal((await a.engine.move(r3.trackId, -1)).code, 'bad_track')
  })

  test('ses odasında olmayan, anahtarı olmayan ve DJ kapalı sunucu', async () => {
    const { server, clients: [a] } = await setup()
    a.engine.setVoiceRoom(null)
    server.leave(ROOM, 1)
    a.sync()
    assert.equal((await a.engine.addYouTube(VID)).code, 'not_in_voice')
    assert.equal((await a.engine.runCommand('/queue')).code, 'not_in_voice')
    const timers = makeTimers()
    const s2 = makeServer(timers, { kid: BASE.E2EE.parseKeyCode(GROUP_CODE).kid })
    s2.join(ROOM, 1)
    const nokey = makeClient(s2, timers, 1, { noKey: true })
    nokey.engine.setVoiceRoom(ROOM)
    nokey.sync()
    assert.equal((await nokey.engine.addYouTube(VID)).code, 'no_key')
    s2.enabled = false
    nokey.sync()
    assert.equal(nokey.engine.snapshot().enabled, false)
    assert.equal((await nokey.engine.addYouTube(VID)).code, 'dj_disabled')
    // Sunucu ayarı yoksa (eski sunucu) DJ desteklenmiyor sayılır
    const old = makeClient(s2, timers, 1, {})
    old.engine.handleMeta({ activeKid: null, voice: {} }, 1)
    assert.equal(old.engine.snapshot().supported, false)
    assert.equal((await old.engine.skip()).code, 'dj_unsupported')
  })

  test('sunucu yanıt kodları hata kodlarına çevrilir, ağ hatası sınırlı yeniden denenir', async () => {
    const timers = makeTimers()
    const server = makeServer(timers, { kid: BASE.E2EE.parseKeyCode(GROUP_CODE).kid })
    server.join(ROOM, 1)
    let reply = { status: 403, data: { code: 'dj_disabled' } }
    let calls = 0
    const c = makeClient(server, timers, 1, {
      transport: {
        postState: () => {
          calls++
          return Promise.resolve(reply)
        }
      }
    })
    c.engine.setVoiceRoom(ROOM)
    c.sync()
    const expect = async (r, code) => {
      reply = r
      const p = c.engine.addYouTube(VID)
      await timers.advance(20000)
      assert.equal((await p).code, code, JSON.stringify(r))
    }
    await expect({ status: 403, data: { code: 'dj_disabled' } }, 'dj_disabled')
    await expect({ status: 403, data: { code: 'not_in_voice' } }, 'not_in_voice')
    await expect({ status: 403, data: { code: 'other' } }, 'forbidden')
    await expect({ status: 413, data: {} }, 'state_too_large')
    await expect({ status: 429, data: { code: 'rate_limited' } }, 'rate_limited')
    await expect({ status: 401, data: {} }, 'session_expired')
    await expect({ status: 404, data: { code: 'not_found' } }, 'dj_unsupported')
    await expect({ status: 500, data: {} }, 'server')
    calls = 0
    await expect({ status: 0, data: null }, 'network')
    assert.equal(calls, 3)
  })

  test('sürekli çakışmada sınırlı deneme sonrası conflict, 409 boş durumla odayı sıfırlar', async () => {
    const timers = makeTimers()
    const server = makeServer(timers, { kid: BASE.E2EE.parseKeyCode(GROUP_CODE).kid })
    server.join(ROOM, 1)
    const sent = []
    const c = makeClient(server, timers, 1, {
      transport: {
        postState: (body) => {
          sent.push(body)
          return Promise.resolve({ status: 409, data: { v: 0, at: 0, env: null, now: server.now() } })
        }
      }
    })
    c.engine.setVoiceRoom(ROOM)
    c.sync()
    const p = c.engine.addYouTube(VID)
    await timers.advance(60000)
    assert.equal((await p).code, 'conflict')
    assert.equal(sent.length, 6)
    same(Object.keys(sent[0]).sort(), ['channelId', 'env', 'expect'])
    assert.equal(sent[0].channelId, ROOM)
    assert.equal(sent[0].expect, 0)
  })

  test('başka odaya veya mesaj kanalına yeniden oynatılan zarf reddedilir, eski zarf yok sayılır', async () => {
    const { server, clients: [a, b] } = await setup()
    await a.engine.addYouTube(VID)
    const first = server.rooms.get(ROOM)
    await a.engine.addYouTube(VID2)
    const second = server.rooms.get(ROOM)
    b.sync()
    assert.equal(b.engine.snapshot().session.queue.length, 1)
    // Eski zarf yeni sürüm numarasıyla yeniden oynatılır: gösterilen durum korunur
    server.rooms.set(ROOM, { v: second.v + 1, at: second.at, by: 1, env: first.env })
    b.sync()
    assert.equal(b.engine.snapshot().sessionStatus, 'replay')
    assert.equal(b.engine.snapshot().session.queue.length, 1)
    assert.equal(b.last('error').code, 'replay')
    // Aynı zarf başka bir odada: oda bağlama
    server.join(OTHER_ROOM, 2)
    server.rooms.set(OTHER_ROOM, { v: second.v + 2, at: second.at, by: 1, env: second.env })
    b.engine.setVoiceRoom(OTHER_ROOM)
    b.sync()
    assert.equal(b.engine.snapshot().sessionStatus, 'invalid')
    assert.equal(b.engine.snapshot().session, null)
    // Mesaj zarfı ({ v, a, c, t }) müzik durumu olarak
    const msgEnv = b.device.E2EE.sealJson(b.device.kid, { v: 1, a: 1, c: OTHER_ROOM, t: 'selam', f: [] })
    server.rooms.set(OTHER_ROOM, { v: second.v + 3, at: second.at, by: 1, env: msgEnv })
    b.sync()
    assert.equal(b.engine.snapshot().sessionStatus, 'invalid')
    // Biçimi bozuk zarf
    server.rooms.set(OTHER_ROOM, { v: second.v + 4, at: second.at, by: 1, env: '<script>' })
    b.sync()
    assert.equal(b.engine.snapshot().sessionStatus, 'invalid')
    // Daha küçük sürüm yok sayılır
    server.rooms.set(OTHER_ROOM, { v: 1, at: 0, by: 1, env: second.env })
    b.sync()
    assert.equal(b.engine.snapshot().session, null)
  })

  test('oda durumu silinince istemci bırakır, sunucu yeniden başlayınca sıfırlanır', async () => {
    const { server, clients: [a, b] } = await setup()
    await a.engine.addYouTube(VID)
    b.sync()
    assert.ok(b.engine.snapshot().session)
    server.remove(ROOM)
    b.sync()
    assert.equal(b.engine.snapshot().session, null)
    assert.equal(b.engine.pollParam(), String(server.payload().muv))
    b.engine.ingest({ boot: 'b1', now: server.now() })
    b.engine.ingest({ boot: 'b2', now: server.now() })
    assert.equal(b.engine.pollParam(), '0')
  })

  test('YouTube kaynağı kapalı: ekleme reddedilir, odadaki YouTube parçaları istemcilerce temizlenir', async () => {
    const { timers, server, clients: [a, b] } = await setup()
    await a.engine.addYouTube(VID)
    const wav = makeWav(1)
    const enc = a.device.E2EE.encryptFile(new Uint8Array(wav))
    const file = server.upload(enc.box)
    const r = await a.engine.addFile({ u: file, k: enc.key, n: enc.nonce, m: 'audio/wav', s: wav.length, name: 'a.wav' }, { durationMs: 60000 })
    assert.equal(r.ok, true)
    server.youtube = false
    a.sync()
    b.sync()
    assert.equal((await a.engine.addYouTube(VID2)).code, 'youtube_disabled')
    await timers.advance(3000)
    a.sync()
    b.sync()
    const s = a.engine.snapshot().session
    assert.equal(s.current.type, 'file')
    assert.equal(s.queue.length, 0)
    assert.equal(b.engine.snapshot().youtubeEnabled, false)
  })

  test('odada olmayan istemci de odaların oturumunu görür (roomView, activeRooms)', async () => {
    const { timers, server, clients: [a] } = await setup()
    await a.engine.addYouTube(VID, { title: 'Oda parcasi' })
    const outsider = makeClient(server, timers, 9, {})
    outsider.sync()
    assert.equal(outsider.engine.snapshot().room, null)
    assert.equal(outsider.engine.snapshot().session, null)
    const view = outsider.engine.roomView(ROOM)
    assert.equal(view.room, ROOM)
    assert.equal(view.status, 'ok')
    assert.equal(view.current.videoId, VID)
    assert.equal(view.playing, true)
    assert.equal(view.queueLength, 0)
    same(outsider.engine.activeRooms().map((r) => r.room), [ROOM])
    assert.equal(outsider.engine.roomView(OTHER_ROOM), null)
    assert.equal(outsider.engine.roomView('x'), null)
    assert.equal((await outsider.engine.addYouTube(VID2)).code, 'not_in_voice')
  })

  test('HTTP taşıması L2.10 gövdesini birebir gönderir', async () => {
    const calls = []
    const tr = M.createHttpTransport({
      api: (method, p, body, ro) => {
        calls.push({ method, p, body, ro })
        return Promise.resolve({ status: 200, data: { v: 3, at: 10, now: 11 } })
      }
    })
    const res = await tr.postState({ channelId: 5, expect: 2, env: 'E', extra: 'x' })
    same(res, { status: 200, data: { v: 3, at: 10, now: 11 } })
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].p, '/api/music/state')
    same(calls[0].body, { channelId: 5, expect: 2, env: 'E' })
    await tr.download('b'.repeat(32), {})
    assert.equal(calls[1].method, 'GET')
    assert.equal(calls[1].p, '/api/uploads/' + 'b'.repeat(32))
    assert.equal(calls[1].ro.responseType, 'arraybuffer')
    same(await tr.download('../etc/passwd'), { status: 0, data: null })
    const failing = M.createHttpTransport({ api: () => Promise.reject(new Error('x')) })
    same(await failing.postState({ channelId: 1, expect: 0, env: 'E' }), { status: 0, data: null })
  })

  test('XHR yedeği X-Token ve JSON gövdesiyle istek yapar', async () => {
    const dev = loadDevice({ code: GROUP_CODE })
    const seen = []
    dev.XMLHttpRequest = function () {
      const xhr = {
        headers: {},
        open: (m, p) => {
          xhr.m = m
          xhr.p = p
        },
        setRequestHeader: (k, v) => {
          xhr.headers[k] = v
        },
        send: (payload) => {
          seen.push({ m: xhr.m, p: xhr.p, headers: xhr.headers, payload })
          xhr.status = 409
          xhr.responseText = JSON.stringify({ v: 4, at: 1, env: null, now: 2 })
          setImmediate(() => xhr.onload())
        }
      }
      return xhr
    }
    const tr = dev.TelsizMusic.createHttpTransport({ token: () => 'tok123' })
    const res = await tr.postState({ channelId: 9, expect: 1, env: 'ENV' })
    assert.equal(res.status, 409)
    assert.equal(res.data.v, 4)
    assert.equal(seen[0].m, 'POST')
    assert.equal(seen[0].p, '/api/music/state')
    assert.equal(seen[0].headers['X-Token'], 'tok123')
    assert.equal(seen[0].headers['Content-Type'], 'application/json')
    same(JSON.parse(seen[0].payload), { channelId: 9, expect: 1, env: 'ENV' })
  })

  test('taşıma olmadan motor kurulmaz', () => {
    assert.throws(() => M.create({}), (e) => e.code === 'bad_transport')
  })
})

describe('motor: oynatıcı, rıza ve dokunarak başlatma', () => {
  test('rıza yoksa YouTube oynatıcısı kurulmaz ve rıza istenir, rıza verilince kurulur', async () => {
    const { timers, clients: [a, b] } = await setup()
    b.engine.attachPlayer({ appendChild () {} })
    await a.engine.addYouTube(VID)
    b.sync()
    assert.equal(b.ytPlayers.length, 0)
    assert.equal(b.engine.snapshot().player.blocked, 'consent')
    assert.equal(b.engine.snapshot().consent, 'unset')
    assert.equal(b.count('consentneeded'), 1)
    b.sync()
    assert.equal(b.count('consentneeded'), 1)
    b.engine.setConsent(false)
    assert.equal(b.storage.get(CONSENT_KEY), '0')
    assert.equal(b.engine.snapshot().consent, 'denied')
    assert.equal(b.ytPlayers.length, 0)
    b.engine.setConsent(true)
    assert.equal(b.storage.get(CONSENT_KEY), '1')
    assert.equal(b.ytPlayers.length, 1)
    const p = b.ytPlayers[0]
    assert.equal(p.cfg.videoId, VID)
    assert.equal(p.cfg.title, 'T:music.playerFrameTitle')
    // Ayarlar > Gizlilik izni geri alır (anahtar silinir): bir sonraki tıkta oynatıcı kapanır
    b.storage.remove(CONSENT_KEY)
    await timers.advance(600)
    assert.equal(p.state.destroyed, true)
    assert.equal(b.engine.snapshot().player.blocked, 'consent')
  })

  test('oynatıcı alanı yoksa YouTube kurulmaz, dosya parçası alan gerektirmez', async () => {
    const { clients: [a, b] } = await setup()
    b.storage.set(CONSENT_KEY, '1')
    await a.engine.addYouTube(VID)
    b.sync()
    assert.equal(b.engine.snapshot().player.blocked, 'no_player_host')
    b.engine.attachPlayer({ appendChild () {} })
    assert.equal(b.ytPlayers.length, 1)
    b.engine.detachPlayer()
    assert.equal(b.ytPlayers[0].state.destroyed, true)
  })

  test('YouTube parçası çapa zamanında başlar, sapma 1,5 sn aşılınca düzeltilir', async () => {
    const { timers, clients: [a, b] } = await setup()
    b.storage.set(CONSENT_KEY, '1')
    b.engine.attachPlayer({ appendChild () {} })
    await a.engine.addYouTube(VID, { durationMs: 300000 })
    b.sync()
    const p = b.ytPlayers[0]
    p.becomeReady()
    assert.ok(p.state.commands.includes('volume:50'))
    assert.ok(p.state.commands.includes('muted:false'))
    assert.equal(p.state.playing, false)
    await timers.advance(M.LIMITS.startLeadMs + 20)
    assert.equal(p.state.playing, true)
    assert.equal(b.engine.snapshot().player.status, 'playing')
    // Yerel oynatıcı 2 sn geride kalır. Oynatma başladıktan sonra oynatıcı oturunca (1 sn) düzeltilir.
    p.state.pos -= 2000
    await timers.advance(2000)
    const seeks = p.state.commands.filter((c) => c.startsWith('seek:'))
    assert.ok(seeks.length >= 1)
    assert.ok(Math.abs(p.impl.position() - b.engine.snapshot().session.positionMs) <= 50)
    assert.equal(b.engine.snapshot().player.corrections, 1)
    // 1 sn sapma düzeltilmez
    p.state.pos -= 1000
    await timers.advance(4000)
    assert.equal(b.engine.snapshot().player.corrections, 1)
  })

  test('duraklatma oynatıcıyı durdurur, kişinin kendi durdurması ortak durumu değiştirmez', async () => {
    const { timers, clients: [a, b] } = await setup()
    b.storage.set(CONSENT_KEY, '1')
    b.engine.attachPlayer({ appendChild () {} })
    await a.engine.addYouTube(VID)
    b.sync()
    const p = b.ytPlayers[0]
    p.becomeReady()
    await timers.advance(2000)
    assert.equal(p.state.playing, true)
    await a.engine.pause()
    b.sync()
    await timers.advance(600)
    assert.equal(p.state.playing, false)
    assert.equal(b.engine.snapshot().player.status, 'paused')
    await a.engine.resume()
    b.sync()
    await timers.advance(600)
    assert.equal(p.state.playing, true)
    // Kişi YouTube denetimleriyle durdurur
    await timers.advance(3000)
    p.impl.pause()
    p.emit({ type: 'paused' })
    await timers.advance(2000)
    assert.equal(p.state.playing, false)
    assert.equal(b.engine.snapshot().player.hold, true)
    b.engine.resync()
    await timers.advance(600)
    assert.equal(p.state.playing, true)
  })

  test('görünmeyen YouTube oynatıcısı bu cihazda duraklatılır', async () => {
    const { timers, clients: [a, b] } = await setup({ client: [{}, { yt: { visible: false } }] })
    b.storage.set(CONSENT_KEY, '1')
    b.engine.attachPlayer({ appendChild () {} })
    await a.engine.addYouTube(VID)
    b.sync()
    const p = b.ytPlayers[0]
    p.becomeReady()
    await timers.advance(3000)
    assert.equal(p.state.playing, false)
    assert.equal(b.engine.snapshot().player.hidden, true)
    p.state.visible = true
    await timers.advance(600)
    assert.equal(p.state.playing, true)
    assert.equal(b.engine.snapshot().player.hidden, false)
  })

  test('gömmeye kapalı video: hata herkes için tek geçişle atlanır', async () => {
    const { timers, server, clients: [a, b] } = await setup()
    for (const c of [a, b]) {
      c.storage.set(CONSENT_KEY, '1')
      c.engine.attachPlayer({ appendChild () {} })
    }
    await a.engine.addYouTube(VID)
    await a.engine.addYouTube(VID2)
    b.sync()
    const v0 = server.rooms.get(ROOM).v
    server.hold(2)
    a.ytPlayers[0].emit({ type: 'error', code: 150 })
    b.ytPlayers[0].emit({ type: 'error', code: 150 })
    await timers.advance(3000)
    a.sync()
    b.sync()
    assert.equal(server.rooms.get(ROOM).v, v0 + 1)
    const s = b.engine.snapshot().session
    assert.equal(s.current.videoId, VID2)
    assert.equal(s.last.op, 'error_skip')
    assert.equal(s.last.code, 'yt_embed_blocked')
    assert.equal(a.last('error').code, 'yt_embed_blocked')
    // Ağ veya yerel oynatıcı hatası parçayı geçmez
    a.ytPlayers[1].emit({ type: 'unresponsive' })
    await timers.advance(1000)
    a.sync()
    assert.equal(a.engine.snapshot().session.current.videoId, VID2)
    assert.equal(a.engine.snapshot().player.error, 'yt_unresponsive')
  })

  test('oynatıcı başlığı ve süreyi bildirir, boş alanlar bir kez doldurulur', async () => {
    const { timers, server, clients: [a, b] } = await setup()
    for (const c of [a, b]) {
      c.storage.set(CONSENT_KEY, '1')
      c.engine.attachPlayer({ appendChild () {} })
    }
    await a.engine.addYouTube(VID)
    b.sync()
    const v0 = server.rooms.get(ROOM).v
    server.hold(2)
    a.ytPlayers[0].emit({ type: 'title', text: 'Rick Astley \u202e Never' })
    b.ytPlayers[0].emit({ type: 'title', text: 'Rick Astley \u202e Never' })
    await timers.advance(2000)
    a.sync()
    b.sync()
    assert.equal(server.rooms.get(ROOM).v, v0 + 1)
    assert.equal(b.engine.snapshot().session.current.title, 'Rick Astley Never')
    assert.equal(b.count('notice'), 1)
    a.ytPlayers[0].emit({ type: 'duration', ms: 212000 })
    await timers.advance(2000)
    b.sync()
    assert.equal(b.engine.snapshot().session.current.durationMs, 212000)
  })

  test('parça yerel oynatıcıda bitince geçiş istenir ve parça yeniden başlatılmaz', async () => {
    const { timers, clients: [a] } = await setup()
    a.storage.set(CONSENT_KEY, '1')
    a.engine.attachPlayer({ appendChild () {} })
    await a.engine.addYouTube(VID, { durationMs: 3000 })
    await a.engine.addYouTube(VID2)
    const p = a.ytPlayers[0]
    p.becomeReady()
    await timers.advance(M.LIMITS.startLeadMs + 3000)
    p.state.playing = false
    p.emit({ type: 'ended' })
    await timers.advance(1000)
    a.sync()
    assert.equal(a.engine.snapshot().session.current.videoId, VID2)
    assert.equal(p.state.destroyed, true)
    assert.equal(p.state.commands.filter((c) => c === 'play').length, 1)
  })

  test('dosya parçası: indirilir, çözülür, blob adresiyle <audio> öğesinde ortak konumdan çalar', async () => {
    const { timers, server, clients: [a, b] } = await setup()
    const wav = makeWav(2)
    const enc = a.device.E2EE.encryptFile(new Uint8Array(wav))
    const id = server.upload(enc.box)
    const r = await a.engine.addFile({ u: id, k: enc.key, n: enc.nonce, m: 'audio/x-wav', s: wav.length, name: 'ton.wav' })
    assert.equal(r.ok, true)
    b.sync()
    const st = b.engine.snapshot().session
    assert.equal(st.current.type, 'file')
    assert.equal(st.current.title, 'ton.wav')
    assert.equal(st.current.file.mime, 'audio/wav')
    assert.equal(st.current.file.uploadId, id)
    assert.equal(st.current.file.key, undefined)
    await flush()
    const audio = b.audios[0]
    assert.ok(audio, 'audio created')
    assert.match(audio.src, /^blob:/)
    audio.duration = 2
    audio.fire('loadedmetadata')
    audio.fire('canplay')
    await timers.advance(M.LIMITS.startLeadMs + 200)
    assert.equal(audio.paused, false)
    assert.equal(b.engine.snapshot().player.status, 'playing')
    a.sync()
    await timers.advance(2000)
    b.sync()
    assert.equal(b.engine.snapshot().session.current.durationMs, 2000)
  })

  test('çözülen içerik ses değilse veya dosya iki kez çözülemezse parça herkes için geçilir', async () => {
    const { timers, server, clients: [a, b] } = await setup()
    // a odada (meta) ama bu cihazda dinlemiyor: hatayı ve geçişi yalnızca b görür
    a.engine.setVoiceRoom(null)
    a.sync()
    const enc = a.device.E2EE.encryptFile(new Uint8Array(Buffer.from('<html>bu ses degil</html>')))
    const id = server.upload(enc.box)
    let downloads = 0
    const realDownload = server.download
    server.download = (u) => {
      downloads++
      return realDownload(u)
    }
    await a.engine.addFile({ u: id, k: enc.key, n: enc.nonce, m: 'audio/mpeg', s: 10, name: 'x.mp3' })
    const enc2 = a.device.E2EE.encryptFile(new Uint8Array(makeWav(0.1)))
    const id2 = server.upload(enc2.box)
    // Yanlış anahtar: her cihazda çözülemez
    await a.engine.addFile({ u: id2, k: enc.key, n: enc2.nonce, m: 'audio/wav', s: 10, name: 'y.wav' })
    const enc3 = a.device.E2EE.encryptFile(new Uint8Array(makeWav(0.1)))
    const id3 = server.upload(enc3.box)
    await a.engine.addFile({ u: id3, k: enc3.key, n: enc3.nonce, m: 'audio/wav', s: 10, name: 'z.wav' }, { durationMs: 100000 })
    b.sync()
    await flush(12)
    await timers.advance(100)
    await flush(12)
    a.sync()
    b.sync()
    // Hatalar yerel olarak bildirilir, ardından b'nin kendi error_skip yazımları parçaları elle geçmeye gerek
    // kalmadan geçer. Çözülemeyen dosya geçilmeden önce bir kez yeniden indirilir.
    same(b.events.filter((e) => e.name === 'error').map((e) => e.payload.code), ['file_bad_type', 'file_decrypt_failed'])
    const s = b.engine.snapshot().session
    assert.equal(s.current.title, 'z.wav')
    assert.equal(s.last.op, 'error_skip')
    assert.equal(s.last.code, 'file_decrypt_failed')
    // x bir kez, y iki kez (yeniden indirme), çalmaya başlayan z bir kez
    assert.equal(downloads, 4)
    assert.equal((await a.engine.addFile({ u: 'x', k: enc.key, n: enc.nonce, m: 'audio/wav', s: 1 })).code, 'bad_file')
    assert.equal((await a.engine.addFile({ u: id, k: enc.key, n: enc.nonce, m: 'application/pdf', s: 1, name: 'a.pdf' })).code, 'file_bad_type')
  })

  test('cihaza veya kişiye özgü dosya hatası (indirme izni, biçim desteği) parçayı geçmez', async () => {
    const { timers, server, clients: [a, b] } = await setup({ client: [{}, { transport: { postState: (body) => server.post(2, body), download: () => Promise.resolve({ status: 404, data: { code: 'upload_not_found' } }) } }] })
    const enc = a.device.E2EE.encryptFile(new Uint8Array(makeWav(1)))
    const id = server.upload(enc.box)
    await a.engine.addFile({ u: id, k: enc.key, n: enc.nonce, m: 'audio/wav', s: 10, name: 'a.wav' }, { durationMs: 600000 })
    b.sync()
    await flush(12)
    assert.equal(b.engine.snapshot().player.error, 'file_unavailable')
    await timers.advance(60000)
    a.sync()
    b.sync()
    assert.equal(b.engine.snapshot().session.current.title, 'a.wav')
    assert.equal(b.engine.snapshot().session.last.op, 'add')
  })

  test('kendiliğinden oynatma engellenirse dokunarak başlatma istenir', async () => {
    const { timers, server, clients: [a, b] } = await setup({ client: [{}, { audio: { block: true } }] })
    const wav = makeWav(10)
    const enc = a.device.E2EE.encryptFile(new Uint8Array(wav))
    const id = server.upload(enc.box)
    await a.engine.addFile({ u: id, k: enc.key, n: enc.nonce, m: 'audio/wav', s: wav.length, name: 'ton.wav' }, { durationMs: 10000 })
    b.sync()
    await flush()
    const audio = b.audios[0]
    audio.fire('canplay')
    await timers.advance(M.LIMITS.startLeadMs + 100)
    assert.equal(b.count('tapneeded'), 1)
    assert.equal(b.engine.snapshot().player.needsTap, true)
    await timers.advance(5000)
    assert.equal(audio.plays, 1)
    audio.play = () => {
      audio.plays++
      audio.paused = false
      audio.fire('play')
      return Promise.resolve()
    }
    b.engine.unlock()
    await flush()
    assert.equal(audio.paused, false)
    assert.equal(b.engine.snapshot().player.needsTap, false)
    assert.equal(b.engine.snapshot().player.status, 'playing')
  })

  test('kişisel ses seviyesi ve susturma cihazda saklanır ve oynatıcıya uygulanır', async () => {
    const { clients: [a, b] } = await setup()
    b.storage.set(CONSENT_KEY, '1')
    b.engine.attachPlayer({ appendChild () {} })
    await a.engine.addYouTube(VID)
    b.sync()
    b.ytPlayers[0].becomeReady()
    b.engine.setVolume(0.25)
    b.engine.setMuted(true)
    assert.equal(b.storage.get('telsiz.music.volume'), '0.25')
    assert.equal(b.storage.get('telsiz.music.muted'), '1')
    assert.ok(b.ytPlayers[0].state.commands.includes('volume:25'))
    assert.ok(b.ytPlayers[0].state.commands.includes('muted:true'))
    assert.equal(b.engine.snapshot().volume, 0.25)
    assert.equal(b.engine.snapshot().muted, true)
    b.engine.setVolume(7)
    assert.equal(b.engine.snapshot().volume, 1)
  })

  test('konum olayı saniyede bir verilir, destroy sonrası olay ve zamanlayıcı kalmaz', async () => {
    const { timers, clients: [a] } = await setup()
    await a.engine.addYouTube(VID)
    const before = a.count('position')
    await timers.advance(3100)
    const n = a.count('position') - before
    assert.ok(n >= 3 && n <= 4, String(n))
    a.engine.destroy()
    const after = a.events.length
    await timers.advance(3000)
    assert.equal(a.events.length, after)
    assert.equal((await a.engine.skip()).code, 'destroyed')
  })
})

// ------------------------------------------------------------------ YouTube bağdaştırıcısı

function loadYouTube () {
  const dev = loadDevice({ youtube: true, e2ee: false, nacl: false })
  const listeners = []
  dev.addEventListener = (name, fn) => {
    if (name === 'message') listeners.push(fn)
  }
  dev.removeEventListener = (name, fn) => {
    const i = listeners.indexOf(fn)
    if (i !== -1) listeners.splice(i, 1)
  }
  const frames = []
  dev.document = {
    createElement: (tag) => {
      assert.equal(tag, 'iframe')
      const sent = []
      const handlers = {}
      const frame = {
        attrs: {},
        sent,
        isConnected: true,
        rect: { width: 320, height: 240 },
        visibleFlag: true,
        contentWindow: {
          postMessage: (data, target) => sent.push({ data: JSON.parse(data), target })
        },
        setAttribute: (k, v) => {
          frame.attrs[k] = v
        },
        addEventListener: (name, fn) => {
          handlers[name] = fn
        },
        removeEventListener: (name) => {
          delete handlers[name]
        },
        fire: (name) => handlers[name] && handlers[name](),
        getBoundingClientRect: () => frame.rect,
        checkVisibility: () => frame.visibleFlag,
        parentNode: null
      }
      frames.push(frame)
      return frame
    }
  }
  const deliver = (frame, data, origin) => {
    const ev = { origin: origin || 'https://www.youtube-nocookie.com', source: frame.contentWindow, data: typeof data === 'string' ? data : JSON.stringify(data) }
    listeners.slice().forEach((fn) => fn(ev))
  }
  return { YT: dev.TelsizYouTube, frames, deliver, listeners, dev }
}

describe('YouTube bağdaştırıcısı (yol ii)', () => {
  test('gömme adresi yalnızca doğrulanmış kimlik ve sabit parametrelerden kurulur', () => {
    const { YT } = loadYouTube()
    const url = YT.buildEmbedUrl(VID, { pageOrigin: 'https://telsiz.example:8443', lang: 'tr', widgetId: 3 })
    assert.equal(url, 'https://www.youtube-nocookie.com/embed/' + VID + '?enablejsapi=1&autoplay=0&controls=1&playsinline=1&rel=0&iv_load_policy=3&fs=1&origin=https%3A%2F%2Ftelsiz.example%3A8443&hl=tr&widgetid=3')
    assert.ok(!YT.buildEmbedUrl(VID, { pageOrigin: 'telsiz://app', lang: 'tr"x' }).includes('origin='))
    assert.ok(!YT.buildEmbedUrl(VID, { pageOrigin: 'https://a.example/path' }).includes('origin='))
    assert.ok(YT.buildEmbedUrl(VID, { pageOrigin: 'http://[::1]:4450' }).includes('origin=http%3A%2F%2F%5B%3A%3A1%5D%3A4450'))
    for (const bad of ['x', VID + '/', '../../x', 'dQw4w9WgXc?', null]) {
      assert.throws(() => YT.buildEmbedUrl(bad), (e) => e.code === 'bad_video_id')
    }
  })

  test('çerçeve öznitelikleri, köken ve kaynak denetimi, hazır olma', async () => {
    const { YT, frames, deliver, listeners } = loadYouTube()
    const timers = makeTimers()
    const events = []
    const host = { children: [], appendChild: (f) => host.children.push(f) }
    const p = YT.create({ container: host, videoId: VID, pageOrigin: 'http://127.0.0.1:4450', lang: 'en', title: 'Oynatici', now: timers.now, timers, onEvent: (e) => events.push(e) })
    const f = frames[0]
    assert.equal(host.children[0], f)
    assert.equal(f.attrs.sandbox, 'allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox')
    assert.equal(f.attrs.referrerpolicy, 'strict-origin-when-cross-origin')
    assert.equal(f.attrs.allow, 'autoplay; encrypted-media; picture-in-picture; fullscreen')
    assert.equal(f.attrs.title, 'Oynatici')
    assert.match(f.src, /^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?enablejsapi=1&/)
    assert.equal(listeners.length, 1)
    f.fire('load')
    same(f.sent[0], { data: { event: 'listening', id: p.widgetId, channel: 'widget' }, target: 'https://www.youtube-nocookie.com' })
    await timers.advance(600)
    assert.ok(f.sent.filter((m) => m.data.event === 'listening').length >= 3)
    // Yanlış köken veya kaynak yok sayılır
    deliver(f, { event: 'onReady', id: p.widgetId }, 'https://evil.example')
    deliver({ contentWindow: {} }, { event: 'onReady', id: p.widgetId })
    deliver(f, { event: 'onReady', id: p.widgetId + 99 })
    deliver(f, 'bozuk json')
    deliver(f, 'x'.repeat(70000))
    assert.equal(p.ready(), false)
    p.setVolume(30)
    p.setMuted(true)
    deliver(f, { event: 'initialDelivery', id: p.widgetId, info: { playerState: -1, currentTime: 0, duration: 0 } })
    const subs = f.sent.filter((m) => m.data.event === 'command' && m.data.func === 'addEventListener').map((m) => m.data.args[0])
    same(subs, ['onReady', 'onStateChange', 'onError', 'onAutoplayBlocked'])
    const listenCount = f.sent.filter((m) => m.data.event === 'listening').length
    await timers.advance(1000)
    assert.equal(f.sent.filter((m) => m.data.event === 'listening').length, listenCount)
    deliver(f, { event: 'onReady', id: p.widgetId })
    assert.equal(p.ready(), true)
    assert.equal(events[0].type, 'ready')
    const cmds = f.sent.filter((m) => m.data.event === 'command').map((m) => m.data.func + ':' + JSON.stringify(m.data.args))
    assert.ok(cmds.includes('setVolume:[30]'))
    assert.ok(cmds.includes('mute:[]'))
    p.destroy()
    assert.equal(listeners.length, 0)
  })

  test('bilgi iletileri, oynatma sözü, engellenen oynatma, hata ve görünürlük', async () => {
    const { YT, frames, deliver } = loadYouTube()
    const timers = makeTimers()
    const events = []
    const p = YT.create({ container: { appendChild () {} }, videoId: VID, now: timers.now, timers, onEvent: (e) => events.push(e) })
    const f = frames[0]
    f.fire('load')
    deliver(f, { event: 'onReady', id: p.widgetId })
    deliver(f, { event: 'infoDelivery', id: p.widgetId, info: { duration: 212.5, videoData: { title: 'Bir Video' }, currentTime: 0, playerState: 5 } })
    deliver(f, { event: 'infoDelivery', id: p.widgetId, info: { duration: 212.5, videoData: { title: 'Bir Video' } } })
    same(events.filter((e) => e.type === 'duration'), [{ type: 'duration', ms: 212500 }])
    same(events.filter((e) => e.type === 'title'), [{ type: 'title', text: 'Bir Video' }])
    // Oynatma: PLAYING durumu sözü 'ok' ile çözer
    const pr = p.play()
    assert.equal(f.sent[f.sent.length - 1].data.func, 'playVideo')
    deliver(f, { event: 'onStateChange', id: p.widgetId, info: 1 })
    assert.equal(await pr, 'ok')
    assert.equal(p.playing(), true)
    deliver(f, { event: 'infoDelivery', id: p.widgetId, info: { currentTime: 10 } })
    await timers.advance(1500)
    assert.equal(p.position(), 11500)
    p.seek(30000)
    same(f.sent[f.sent.length - 1].data.args, [30, true])
    assert.equal(p.position(), 30000)
    deliver(f, { event: 'onStateChange', id: p.widgetId, info: 2 })
    assert.equal(events[events.length - 1].type, 'paused')
    // Engellenen oynatma: süre dolar, durum değişmez
    const blocked = p.play()
    await timers.advance(5100)
    assert.equal(await blocked, 'blocked')
    // Yükleniyorsa geçerli sayılır
    deliver(f, { event: 'infoDelivery', id: p.widgetId, info: { playerState: 3 } })
    const buffering = p.play()
    await timers.advance(5100)
    assert.equal(await buffering, 'ok')
    deliver(f, { event: 'onError', id: p.widgetId, info: 150 })
    same(events[events.length - 1], { type: 'error', code: 150 })
    deliver(f, { event: 'infoDelivery', id: p.widgetId, info: { playerState: 0 } })
    assert.equal(events[events.length - 1].type, 'ended')
    assert.equal(p.position(), 212500)
    assert.equal(p.visible(), true)
    f.rect = { width: 199, height: 300 }
    assert.equal(p.visible(), false)
    f.rect = { width: 200, height: 200 }
    f.visibleFlag = false
    assert.equal(p.visible(), false)
    f.visibleFlag = true
    f.isConnected = false
    assert.equal(p.visible(), false)
    p.destroy()
    assert.equal(await p.play(), 'aborted')
  })

  test('yanıt vermeyen oynatıcı bildirilir', async () => {
    const { YT, frames } = loadYouTube()
    const timers = makeTimers()
    const events = []
    YT.create({ container: { appendChild () {} }, videoId: VID, now: timers.now, timers, onEvent: (e) => events.push(e) })
    frames[0].fire('load')
    await timers.advance(21000)
    same(events, [{ type: 'unresponsive' }])
  })
})

// ------------------------------------------------------------------ i18n

describe('i18n anahtarları', () => {
  test('motorun ürettiği her kod ve bildirim iki dilde çevrilir', () => {
    const sandbox = vm.createContext({})
    sandbox.window = sandbox
    sandbox.localStorage = makeLocalStorage()
    sandbox.navigator = { languages: ['tr-TR'], language: 'tr-TR' }
    sandbox.document = { documentElement: { lang: 'tr' }, readyState: 'loading', querySelectorAll: () => [] }
    sandbox.console = { warn () {}, log () {}, error () {} }
    vm.runInContext(I18N_SRC, sandbox, { filename: 'i18n.js' })
    const I18N = sandbox.I18N
    const codes = new Set()
    for (const m of MUSIC_SRC.matchAll(/(?:rejected\(|fail\(|emitError\(|hooks\.error\(|local\.error = |code: )'([a-z0-9_]+)'/g)) codes.add(m[1])
    const statusFn = MUSIC_SRC.slice(MUSIC_SRC.indexOf('function statusCode'), MUSIC_SRC.indexOf('function commit'))
    for (const m of statusFn.matchAll(/return '([a-z_]+)'/g)) codes.add(m[1])
    for (const v of Object.values({ 2: 'yt_bad_request', 5: 'yt_html5', 100: 'yt_not_found', 101: 'yt_embed_blocked' })) codes.add(v)
    codes.delete('bad_transport')
    // İç kod: indirme bitince dosya artık istenmiyordu, kullanıcıya hiç gösterilmez
    codes.delete('cancelled')
    codes.add('no_listener')
    assert.ok(codes.size > 20, String(codes.size))
    for (const lang of ['tr', 'en']) {
      I18N.setLang(lang)
      for (const code of codes) {
        const text = I18N.t('music.errors.' + code)
        assert.notEqual(text, 'music.errors.' + code, lang + ': ' + code)
      }
      for (const op of ['add', 'remove', 'move', 'skip', 'end', 'error_skip', 'pause', 'resume', 'stop', 'purge_youtube']) {
        assert.notEqual(I18N.t('music.notice.' + op, { name: 'x', title: 'y' }), 'music.notice.' + op)
      }
      for (const b of ['dj_disabled', 'youtube_disabled', 'consent', 'no_player_host']) {
        assert.notEqual(I18N.t('music.blocked.' + b), 'music.blocked.' + b)
      }
      for (const s of ['idle', 'loading', 'ready', 'playing', 'paused', 'ended', 'blocked', 'error']) {
        assert.notEqual(I18N.t('music.status.' + s), 'music.status.' + s)
      }
      for (const k of ['music.player.hold', 'music.player.holdDevice', 'music.player.hidden', 'music.volumeUnsupported', 'music.actions.retry', 'music.actions.resync']) {
        assert.notEqual(I18N.t(k), k, lang + ': ' + k)
      }
      // Onay metni sunucu adresinin de YouTube'a gittiğini söyler, ret düğmesi kalıcı reddi anlatır
      const consentText = I18N.t('music.consent.text')
      assert.ok(lang === 'tr' ? consentText.includes('sunucunun adresi') : consentText.includes('address of the server'), consentText)
      assert.ok(['\u015eimdi de\u011fil', 'Not now'].indexOf(I18N.t('music.consent.decline')) === -1)
    }
  })
})

// ------------------------------------------------------------------ inceleme bulguları (kalıcı testler)

// İndirmeleri elle bitirilen taşıma. abort() çağrılırsa istek status 0 ile biter.
function deferredDownloads (server) {
  const d = { count: 0, aborted: 0, pending: [] }
  d.download = (id) => {
    d.count++
    let resolve = null
    const p = new Promise((r) => {
      resolve = r
    })
    const entry = { id, aborted: false, release: () => resolve(server.download(id)) }
    p.abort = () => {
      entry.aborted = true
      d.aborted++
      resolve({ status: 0, data: null })
    }
    d.pending.push(entry)
    return p
  }
  return d
}

function encryptedWav (device, server, seconds, name) {
  const wav = makeWav(seconds)
  const enc = device.E2EE.encryptFile(new Uint8Array(wav))
  const id = server.upload(enc.box)
  return { u: id, k: enc.key, n: enc.nonce, m: 'audio/wav', s: wav.length, name: name || 'ton.wav' }
}

// a odada (meta) ve komut verir ama bu cihazda dinlemez, b dinler
function listenerPair (bOpts) {
  const timers = makeTimers()
  const server = makeServer(timers, { kid: BASE.E2EE.parseKeyCode(GROUP_CODE).kid })
  server.join(ROOM, 1)
  server.join(ROOM, 2)
  const a = makeClient(server, timers, 1, {})
  const b = makeClient(server, timers, 2, typeof bOpts === 'function' ? bOpts(server) : (bOpts || {}))
  a.sync()
  b.engine.setVoiceRoom(ROOM)
  b.sync()
  return { timers, server, a, b }
}

// Belgelenmiş durumlarla (1 çalıyor, 3 yükleniyor, 5 hazırlandı) yavaş YouTube oynatıcısı: her atlama ve
// başlatma B ms yükler, yükleme sırasında konum ilerlemez. withState false ise state() verilmez.
function slowYouTube (timers, B, withState, log) {
  const box = { impl: null }
  box.create = (cfg) => {
    let st = 5
    let pos = 0
    let posAt = 0
    let bufTimer = null
    let waiters = []
    const setSt = (s) => {
      st = s
      if (s === 1) {
        waiters.forEach((w) => w('ok'))
        waiters = []
        cfg.onEvent({ type: 'playing' })
      }
    }
    const buffer = () => {
      timers.clearTimeout(bufTimer)
      st = 3
      bufTimer = timers.setTimeout(() => {
        posAt = cfg.now()
        setSt(1)
      }, B)
    }
    const impl = {
      ready: () => true,
      playing: () => st === 1,
      position: () => Math.round(pos + (st === 1 ? cfg.now() - posAt : 0)),
      play: () => {
        if (st === 1) return Promise.resolve('ok')
        if (st !== 3) buffer()
        return new Promise((resolve) => {
          waiters.push(resolve)
          timers.setTimeout(() => resolve(st === 3 ? 'ok' : 'blocked'), 5000)
        })
      },
      pause: () => {
        if (st === 1) pos += cfg.now() - posAt
        timers.clearTimeout(bufTimer)
        st = 2
        cfg.onEvent({ type: 'paused' })
      },
      seek: (ms) => {
        log.push(ms)
        if (st === 1) pos += cfg.now() - posAt
        pos = ms
        posAt = cfg.now()
        if (st === 1 || st === 3 || st === 5) buffer()
      },
      setVolume () {},
      setMuted () {},
      visible: () => true,
      element: () => null,
      destroy () {
        timers.clearTimeout(bufTimer)
      }
    }
    if (withState) impl.state = () => st
    box.impl = impl
    timers.setTimeout(() => cfg.onEvent({ type: 'ready' }), 0)
    return impl
  }
  return box
}

describe('inceleme bulguları: dosya indirme, kurtarma ve hata durumları', () => {
  test('aynı dosyanın iki kopyası tek indirmeyi paylaşır, kapanışta her blob adresi bırakılır', async () => {
    const dl = { d: null }
    const { server, a, b } = listenerPair((srv) => {
      dl.d = deferredDownloads(srv)
      return { transport: { postState: (body) => srv.post(2, body), download: dl.d.download } }
    })
    const att = encryptedWav(a.device, server, 1, 'a.wav')
    assert.equal((await a.engine.addFile(att)).ok, true)
    assert.equal((await a.engine.addFile(att)).ok, true)
    b.sync()
    await flush()
    assert.equal(dl.d.count, 1)
    // İlk kopya geçilir, ikinci kopya (aynı dosya) çalmaya başlar: süren indirmeye katılır
    assert.equal((await a.engine.skip()).ok, true)
    b.sync()
    await flush()
    assert.equal(dl.d.count, 1)
    assert.equal(dl.d.aborted, 0)
    dl.d.pending[0].release()
    await flush(12)
    assert.equal(b.audios.length, 1)
    assert.equal(b.urls.created.length, 1)
    await a.engine.stop()
    b.sync()
    await flush()
    b.engine.destroy()
    same(b.urls.created.filter((u) => b.urls.revoked.indexOf(u) === -1), [])
  })

  test('geçilen parçanın indirmesi iptal edilir, çözülmez ve blob adresi üretilmez', async () => {
    const dl = { d: null }
    const { server, a, b } = listenerPair((srv) => {
      dl.d = deferredDownloads(srv)
      return { transport: { postState: (body) => srv.post(2, body), download: dl.d.download } }
    })
    for (const i of Array.from({ length: 4 }, (x, k) => k)) await a.engine.addFile(encryptedWav(a.device, server, 1, 'f' + i + '.wav'))
    b.sync()
    await flush()
    for (const i of Array.from({ length: 3 }, (x, k) => k)) {
      await a.engine.skip()
      b.sync()
      await flush()
    }
    assert.equal(dl.d.count, 4)
    assert.equal(dl.d.aborted, 3)
    dl.d.pending[3].release()
    await flush(12)
    dl.d.pending.slice(0, 3).forEach((p) => p.release())
    await flush(12)
    assert.equal(b.urls.created.length, 1)
    assert.equal(b.audios.length, 1)
    assert.equal(b.audios[0].src, b.urls.created[0])
    await a.engine.stop()
    b.sync()
    await flush()
    b.engine.destroy()
    same(b.urls.created.filter((u) => b.urls.revoked.indexOf(u) === -1), [])
  })

  test('önbellekten düşen blob adresleri bırakılır, çalan adres oynatıcı kapanınca bırakılır', async () => {
    const { timers, server, a, b } = listenerPair()
    const files = Array.from({ length: 5 }, (x, i) => encryptedWav(a.device, server, 1, 'g' + i + '.wav'))
    for (const f of files) await a.engine.addFile(f, { durationMs: 100000 })
    for (const i of Array.from({ length: 5 }, (x, k) => k)) {
      b.sync()
      await flush(12)
      if (i < 4) await a.engine.skip()
    }
    await timers.advance(10)
    assert.equal(b.urls.created.length, 5)
    // Önbellek en fazla 3 adres tutar, çalan adres de önbellektedir
    same(b.urls.revoked, b.urls.created.slice(0, 2))
    await a.engine.stop()
    b.sync()
    b.engine.destroy()
    same(b.urls.created.filter((u) => b.urls.revoked.indexOf(u) === -1), [])
  })

  test('geçici indirme hatası artan beklemeyle yeniden denenir, kalıcı hatayı resync yeniden dener', async () => {
    let mode = 'net'
    let downloads = 0
    const { timers, server, a, b } = listenerPair((srv) => ({
      transport: {
        postState: (body) => srv.post(2, body),
        download: (id) => {
          downloads++
          if (mode === 'net') return Promise.resolve({ status: 0, data: null })
          if (mode === '503') return Promise.resolve({ status: 503, data: {} })
          if (mode === '404') return Promise.resolve({ status: 404, data: { code: 'upload_not_found' } })
          return srv.download(id)
        }
      }
    }))
    await a.engine.addFile(encryptedWav(a.device, server, 1, 'a.wav'), { durationMs: 600000 })
    b.sync()
    await flush(12)
    assert.equal(b.engine.snapshot().player.error, 'network')
    assert.equal(b.engine.snapshot().player.status, 'error')
    assert.equal(downloads, 1)
    mode = '503'
    await timers.advance(2100)
    assert.equal(downloads, 2)
    assert.equal(b.engine.snapshot().player.error, 'file_unavailable')
    mode = 'ok'
    await timers.advance(5100)
    assert.equal(downloads, 3)
    assert.equal(b.audios.length, 1)
    assert.equal(b.engine.snapshot().player.error, null)
    assert.equal(b.count('error'), 2)
    // Kalıcı hata (404: izin yok veya silinmiş) kendiliğinden yeniden denenmez, resync yeniden dener
    await a.engine.addFile(encryptedWav(a.device, server, 1, 'b.wav'), { durationMs: 600000 })
    await a.engine.skip()
    mode = '404'
    b.sync()
    await flush(12)
    assert.equal(b.engine.snapshot().player.error, 'file_unavailable')
    const before = downloads
    await timers.advance(60000)
    assert.equal(downloads, before)
    mode = 'ok'
    b.engine.resync()
    await flush(12)
    assert.equal(downloads, before + 1)
    assert.equal(b.audios.length, 2)
    assert.equal(b.engine.snapshot().player.error, null)
  })

  test('yanıt vermeyen YouTube oynatıcısı geç hazır olunca hata temizlenir, değilse sınırlı sayıda yeniden kurulur', async () => {
    const { timers, clients: [a, b] } = await setup()
    b.storage.set(CONSENT_KEY, '1')
    b.engine.attachPlayer({ appendChild () {} })
    await a.engine.addYouTube(VID, { durationMs: 300000 })
    await a.engine.addYouTube(VID2, { durationMs: 300000 })
    b.sync()
    const p0 = b.ytPlayers[0]
    p0.emit({ type: 'unresponsive' })
    assert.equal(b.engine.snapshot().player.error, 'yt_unresponsive')
    p0.becomeReady()
    assert.equal(b.engine.snapshot().player.error, null)
    await timers.advance(2000)
    assert.equal(p0.state.playing, true)
    assert.equal(b.engine.snapshot().player.status, 'playing')
    assert.equal(b.engine.snapshot().player.error, null)
    // İkinci parçanın oynatıcısı hiç hazır olmaz
    await a.engine.skip()
    b.sync()
    assert.equal(b.ytPlayers.length, 2)
    const delays = [10000, 30000, 60000]
    for (const i of Array.from({ length: 3 }, (x, k) => k)) {
      b.ytPlayers[b.ytPlayers.length - 1].emit({ type: 'unresponsive' })
      await timers.advance(delays[i] + 100)
      assert.equal(b.ytPlayers.length, 3 + i)
      assert.equal(b.ytPlayers[1 + i].state.destroyed, true)
    }
    b.ytPlayers[4].emit({ type: 'unresponsive' })
    await timers.advance(200000)
    assert.equal(b.ytPlayers.length, 5)
    assert.equal(b.engine.snapshot().player.error, 'yt_unresponsive')
    assert.equal(b.count('error'), 1 + 4)
    b.engine.resync()
    assert.equal(b.ytPlayers.length, 6)
    assert.equal(b.engine.snapshot().player.error, null)
  })

  test('kalıcı YouTube hatasından sonra playVideo yeniden gönderilmez ve dokunma istenmez', async () => {
    for (const failWrite of [false, true]) {
      const timers = makeTimers()
      const server = makeServer(timers, { kid: BASE.E2EE.parseKeyCode(GROUP_CODE).kid })
      server.join(ROOM, 1)
      server.join(ROOM, 2)
      const a = makeClient(server, timers, 1, {})
      const { YT, frames, deliver } = loadYouTube()
      const store = makeStore()
      store.set(CONSENT_KEY, '1')
      const dev = loadDevice({ code: GROUP_CODE })
      const events = []
      const eng = dev.TelsizMusic.create({
        transport: { postState: (body) => (failWrite ? Promise.resolve({ status: 500, data: {} }) : server.post(2, body)) },
        storage: store,
        now: timers.now,
        timers,
        youtube: YT
      })
      for (const n of ['error', 'tapneeded']) eng.on(n, (p) => events.push(n + ':' + p.code))
      a.engine.setVoiceRoom(ROOM)
      a.sync()
      eng.setVoiceRoom(ROOM)
      eng.attachPlayer({ appendChild () {} })
      const sync = () => {
        eng.handleMeta(server.meta(), 2)
        eng.ingest(server.payload(), { t0: timers.now(), t1: timers.now() })
      }
      sync()
      await a.engine.addYouTube(VID, { durationMs: 300000 })
      sync()
      const f = frames[0]
      const wid = Number(/widgetid=(\d+)/.exec(f.src)[1])
      f.fire('load')
      deliver(f, { event: 'initialDelivery', id: wid, info: { playerState: -1, currentTime: 0, duration: 300 } })
      deliver(f, { event: 'onReady', id: wid })
      await timers.advance(1600)
      const plays = () => f.sent.filter((m) => m.data.func === 'playVideo').length
      assert.equal(plays(), 1)
      // 5: HTML5 hatası (geçilmez), failWrite: 150 (geçilir ama yazım başarısız)
      deliver(f, { event: 'onError', id: wid, info: failWrite ? 150 : 5 })
      await timers.advance(20000)
      assert.equal(plays(), 1, 'no playVideo after a permanent player error')
      assert.equal(events.filter((e) => e.startsWith('tapneeded')).length, 0)
      const p = eng.snapshot().player
      assert.equal(p.status, 'error')
      assert.equal(p.error, failWrite ? 'yt_embed_blocked' : 'yt_html5')
      assert.equal(p.needsTap, false)
      eng.destroy()
    }
  })

  test('yanıtı kaybolan eklemenin yeniden denenmesi o arada geçilen parçayı geri getirmez', async () => {
    const timers = makeTimers()
    const server = makeServer(timers, { kid: BASE.E2EE.parseKeyCode(GROUP_CODE).kid })
    server.join(ROOM, 1)
    server.join(ROOM, 2)
    let lose = true
    let firstDone = null
    const firstDoneP = new Promise((resolve) => {
      firstDone = resolve
    })
    const a = makeClient(server, timers, 1, {
      transport: {
        postState: async (body) => {
          const res = await server.post(1, body)
          if (lose) {
            // Sunucu uyguladı, yanıt kayboldu (ör. 20 sn zaman aşımı)
            lose = false
            firstDone()
            return { status: 0, data: null }
          }
          return res
        }
      }
    })
    const b = makeClient(server, timers, 2, {})
    for (const c of [a, b]) {
      c.engine.setVoiceRoom(ROOM)
      c.sync()
    }
    const pAdd = a.engine.addYouTube(VID, { durationMs: 200000 })
    await firstDoneP
    b.sync()
    const id = b.engine.snapshot().session.current.id
    assert.equal((await b.engine.skip()).ok, true)
    await timers.advance(2000)
    const r = await pAdd
    assert.equal(r.ok, true)
    assert.equal(r.noop, true)
    b.sync()
    const s = b.engine.snapshot().session
    assert.equal(s.current, null)
    assert.equal(s.last.op, 'skip')
    const plain = b.device.E2EE.openJson(server.rooms.get(ROOM).env).value
    assert.ok(plain.gone.indexOf(id) !== -1)
  })

  test('geçilen, çıkarılan ve durdurulan parçalar gone listesine girer, aynı kimlik yeniden eklenmez', () => {
    const ctx = (now) => ({ room: ROOM, me: 7, now: now || 50000, newSid: () => 'aaaaaaaaaaaaaaaa' })
    const t2 = track({ id: '1111111111111111' })
    const t3 = track({ id: '2222222222222222' })
    let s = state({ queue: [fileTrack(), t2, t3] })
    s = M.applyOp(s, { type: 'skip', id: s.current.id }, ctx())
    same(s.gone, [track().id])
    assert.equal(M.applyOp(s, { type: 'add', track: track() }, ctx()), null)
    s = M.applyOp(s, { type: 'remove', id: t2.id }, ctx())
    same(s.gone, [track().id, t2.id])
    assert.equal(M.applyOp(s, { type: 'add', track: t2 }, ctx()), null)
    s = M.applyOp(s, { type: 'stop' }, ctx())
    same(s.gone, [track().id, t2.id, fileTrack().id, t3.id])
    assert.equal(M.validateState(s, ROOM).ok, true)
    // Liste en fazla 128 kimlik tutar, en eskiler düşer
    for (const i of Array.from({ length: 130 }, (x, k) => k)) {
      s = M.applyOp(s, { type: 'add', track: track({ id: '8' + i.toString(16).padStart(15, '0') }) }, ctx())
      s = M.applyOp(s, { type: 'skip', id: s.current.id }, ctx())
    }
    assert.equal(s.gone.length, 128)
    assert.equal(s.gone[127], '8' + (129).toString(16).padStart(15, '0'))
    assert.equal(M.validateState(s, ROOM).ok, true)
    const purged = M.applyOp(state({ queue: [fileTrack(), t2] }), { type: 'purge_youtube' }, ctx())
    same(purged.gone.slice().sort(), [track().id, t2.id].sort())
  })
})

describe('inceleme bulguları: eşitleme ve oynatma', () => {
  async function seekRun (B, withState) {
    const timers = makeTimers()
    const server = makeServer(timers, { kid: BASE.E2EE.parseKeyCode(GROUP_CODE).kid })
    server.join(ROOM, 1)
    server.join(ROOM, 2)
    const a = makeClient(server, timers, 1, {})
    const log = []
    const yt = slowYouTube(timers, B, withState, log)
    const store = makeStore()
    store.set(CONSENT_KEY, '1')
    const dev = loadDevice({ code: GROUP_CODE })
    const eng = dev.TelsizMusic.create({ transport: { postState: (body) => server.post(2, body) }, storage: store, now: timers.now, timers, youtube: yt })
    a.sync()
    eng.setVoiceRoom(ROOM)
    eng.attachPlayer({ appendChild () {} })
    const sync = () => {
      eng.handleMeta(server.meta(), 2)
      eng.ingest(server.payload(), { t0: timers.now(), t1: timers.now() })
    }
    sync()
    await a.engine.addYouTube(VID, { durationMs: 600000 })
    sync()
    let playingMs = 0
    for (const i of Array.from({ length: 600 }, (x, k) => k)) {
      await timers.advance(100)
      if (yt.impl && yt.impl.playing()) playingMs += 100
    }
    const p = eng.snapshot().player
    eng.destroy()
    return { seeks: log.length, playingMs, drift: p.driftMs, corrections: p.corrections }
  }

  test('YouTube atlama gecikmesi ölçülüp telafi edilir, yükleme sırasında yeniden atlanmaz', async () => {
    for (const B of [1000, 1600, 3000, 4000]) {
      const r = await seekRun(B, true)
      assert.ok(r.seeks <= 2, B + ': ' + JSON.stringify(r))
      assert.ok(r.playingMs >= 60000 - 1500 - 2 * B - 2500, B + ': ' + JSON.stringify(r))
      assert.ok(Math.abs(r.drift) <= 1500, B + ': ' + JSON.stringify(r))
    }
    // Oynatıcı yükleme durumunu bildirmese de (state() yok) döngüye girilmez
    const r = await seekRun(3000, false)
    assert.ok(r.seeks <= 2 && r.playingMs >= 45000 && Math.abs(r.drift) <= 1500, JSON.stringify(r))
  })

  test('duraklatılmış oturuma geç katılan istemci başlamamış YouTube oynatıcısına atlama göndermez', async () => {
    const { timers, server, clients: [a] } = await setup({ count: 1 })
    await a.engine.addYouTube(VID, { durationMs: 300000 })
    await timers.advance(62000)
    a.sync()
    await a.engine.pause()
    a.sync()
    const pausedAt = a.engine.snapshot().session.positionMs
    server.join(ROOM, 2)
    const b = makeClient(server, timers, 2, {})
    b.storage.set(CONSENT_KEY, '1')
    b.engine.attachPlayer({ appendChild () {} })
    b.engine.setVoiceRoom(ROOM)
    b.sync()
    const p = b.ytPlayers[0]
    p.becomeReady()
    await timers.advance(4000)
    b.sync()
    // IFrame API: seekTo hazırlanmış (CUED) oynatıcıda oynatmayı başlatır, bu yüzden gönderilmez
    assert.equal(p.state.commands.filter((c) => c.startsWith('seek:') || c === 'play').length, 0)
    assert.equal(p.state.playing, false)
    assert.equal(b.engine.snapshot().player.status, 'paused')
    await a.engine.resume()
    b.sync()
    await timers.advance(600)
    assert.equal(p.state.playing, true)
    assert.ok(p.state.commands.includes('seek:' + pausedAt) || p.state.commands.some((c) => c.startsWith('seek:')))
    assert.ok(Math.abs(p.impl.position() - b.engine.snapshot().session.positionMs) <= 700)
  })

  test('süresi bilinmeyen ve odada kimsenin çalamadığı parça arkasında kuyruk varken geçilir', async () => {
    const { timers, server, clients: [a, b] } = await setup()
    await a.engine.addYouTube(VID)
    await a.engine.addFile(encryptedWav(a.device, server, 1, 'f.wav'), { durationMs: 60000 })
    await timers.advance(60000)
    a.sync()
    b.sync()
    assert.equal(b.engine.snapshot().session.current.type, 'youtube')
    let skippedAt = null
    let rounds = 0
    while (skippedAt === null && rounds < 20) {
      rounds++
      await timers.advance(5000)
      a.sync()
      b.sync()
      if (b.engine.snapshot().session.current.type === 'file') skippedAt = b.engine.snapshot().session.last
    }
    assert.ok(skippedAt, 'unplayable YouTube track skipped')
    assert.equal(skippedAt.op, 'error_skip')
    assert.equal(skippedAt.code, 'no_listener')
  })

  test('süresi bilinmeyen parça kuyruk boşsa veya bu cihazda çalıyorsa geçilmez, süre açıklaması yeniden denenir', async () => {
    const one = await setup()
    await one.clients[0].engine.addYouTube(VID)
    await one.timers.advance(300000)
    one.syncAll()
    assert.equal(one.clients[1].engine.snapshot().session.current.videoId, VID)
    // Tek istemci oynatıcıyla dinliyor, oynatıcı süreyi bildirmiyor: kuyruk olsa da geçilmez
    const two = await setup({ count: 1 })
    const c = two.clients[0]
    c.storage.set(CONSENT_KEY, '1')
    c.engine.attachPlayer({ appendChild () {} })
    await c.engine.addYouTube(VID)
    await c.engine.addYouTube(VID2)
    c.ytPlayers[0].becomeReady()
    await two.timers.advance(300000)
    c.sync()
    assert.equal(c.engine.snapshot().session.current.videoId, VID)
    // Süre olayı kaçırıldı ama oynatıcı süreyi biliyor: açıklama yeniden istenir
    c.ytPlayers[0].state.durationMs = 400000
    await two.timers.advance(6000)
    c.sync()
    assert.equal(c.engine.snapshot().session.current.durationMs, 400000)
  })

  test('/devam bu cihazdaki yerel duraklatmayı da kaldırır ve "zaten yapılmış" demez', async () => {
    const { timers, clients: [a, b] } = await setup()
    b.storage.set(CONSENT_KEY, '1')
    b.engine.attachPlayer({ appendChild () {} })
    await a.engine.addYouTube(VID, { durationMs: 300000 })
    b.sync()
    const p = b.ytPlayers[0]
    p.becomeReady()
    await timers.advance(5000)
    p.impl.pause()
    p.emit({ type: 'paused' })
    assert.equal(b.engine.snapshot().player.hold, true)
    assert.equal(b.engine.snapshot().player.holdReason, 'player')
    for (const cmd of ['/devam', '/resume']) {
      const r = await b.engine.runCommand(cmd)
      if (cmd === '/devam') {
        same(r, { command: 'resume', ok: true, local: true })
        assert.equal(b.engine.snapshot().player.hold, false)
        await timers.advance(600)
        assert.equal(p.state.playing, true)
      } else {
        // Yerel duraklatma yokken ortak oturum zaten çalıyor: etkisiz
        assert.equal(r.noop, true)
      }
    }
  })

  test('duraklatmanın kaynağı bildirilir, sayfa görünmezken olan duraklama görünür olunca kendiliğinden eşitlenir', async () => {
    const timers = makeTimers()
    const server = makeServer(timers, { kid: BASE.E2EE.parseKeyCode(GROUP_CODE).kid })
    server.join(ROOM, 1)
    server.join(ROOM, 2)
    const dev = loadDevice({ code: GROUP_CODE })
    const docListeners = {}
    dev.document = {
      visibilityState: 'visible',
      addEventListener: (name, fn) => {
        docListeners[name] = fn
      },
      removeEventListener: (name) => {
        delete docListeners[name]
      }
    }
    const a = makeClient(server, timers, 1, {})
    const b = makeClient(server, timers, 2, { device: dev })
    a.sync()
    b.engine.setVoiceRoom(ROOM)
    b.sync()
    b.storage.set(CONSENT_KEY, '1')
    b.engine.attachPlayer({ appendChild () {} })
    assert.equal(typeof docListeners.visibilitychange, 'function')
    await a.engine.addYouTube(VID, { durationMs: 300000 })
    b.sync()
    const p = b.ytPlayers[0]
    p.becomeReady()
    await timers.advance(5000)
    // Mobilde arka plana geçiş: oynatıcıyı sistem durdurur
    dev.document.visibilityState = 'hidden'
    p.impl.pause()
    p.emit({ type: 'paused' })
    assert.equal(b.engine.snapshot().player.hold, true)
    assert.equal(b.engine.snapshot().player.holdReason, 'device')
    await timers.advance(3000)
    assert.equal(p.state.playing, false)
    dev.document.visibilityState = 'visible'
    docListeners.visibilitychange()
    assert.equal(b.engine.snapshot().player.hold, false)
    await timers.advance(600)
    assert.equal(p.state.playing, true)
    // <audio> öğesi sayfada denetim göstermez: görünürken de kaynak 'device' olur, kendiliğinden eşitlenmez
    await a.engine.addFile(encryptedWav(a.device, server, 1, 'a.wav'), { durationMs: 100000 })
    await a.engine.skip()
    b.sync()
    await flush(12)
    const audio = b.audios[0]
    audio.fire('canplay')
    await timers.advance(3000)
    assert.equal(audio.paused, false)
    audio.pause()
    assert.equal(b.engine.snapshot().player.holdReason, 'device')
    docListeners.visibilitychange()
    await timers.advance(600)
    assert.equal(audio.paused, true)
    b.engine.destroy()
    assert.equal(docListeners.visibilitychange, undefined)
  })

  test('tarayıcı oynatmayı engellediğinde (onAutoplayBlocked) dokunma bir kez istenir', async () => {
    const { timers, clients: [a, b] } = await setup({ client: [{}, { yt: { block: true } }] })
    b.storage.set(CONSENT_KEY, '1')
    b.engine.attachPlayer({ appendChild () {} })
    await a.engine.addYouTube(VID, { durationMs: 300000 })
    b.sync()
    const p = b.ytPlayers[0]
    p.becomeReady()
    p.emit({ type: 'blocked' })
    p.emit({ type: 'blocked' })
    assert.equal(b.engine.snapshot().player.needsTap, true)
    await timers.advance(3000)
    assert.equal(b.count('tapneeded'), 1)
  })

  test('ses seviyesi ayarlanamayan cihaz bildirilir', async () => {
    const timers = makeTimers()
    const server = makeServer(timers, { kid: BASE.E2EE.parseKeyCode(GROUP_CODE).kid })
    const ios = makeClient(server, timers, 1, { probeVolume: () => false })
    const desktop = makeClient(server, timers, 2, { probeVolume: () => true })
    const unknown = makeClient(server, timers, 3, {})
    assert.equal(ios.engine.snapshot().volumeSupported, false)
    assert.equal(desktop.engine.snapshot().volumeSupported, true)
    assert.equal(unknown.engine.snapshot().volumeSupported, true)
    // Susturma her durumda çalışır
    ios.engine.setMuted(true)
    assert.equal(ios.engine.snapshot().muted, true)
  })
})

describe('inceleme bulguları: rıza, yazar doğrulaması ve görünürlük', () => {
  test('varsayılan saklamada izin geri alınınca motor görür, depolama yazılamazsa bellekte kalır', () => {
    const timers = makeTimers()
    const dev = loadDevice({ code: GROUP_CODE })
    const e = dev.TelsizMusic.create({ transport: { postState: () => Promise.resolve({ status: 0, data: null }) }, now: timers.now, timers })
    e.setConsent(true)
    assert.equal(e.consent(), 'granted')
    // Ayarlar > Gizlilik (storeRemove) veya başka bir sekme localStorage.removeItem çağırır
    dev.localStorage.removeItem(CONSENT_KEY)
    assert.equal(e.consent(), 'unset')
    const dev2 = loadDevice({ code: GROUP_CODE })
    dev2.localStorage.setItem = () => {
      throw new Error('QuotaExceededError')
    }
    const e2 = dev2.TelsizMusic.create({ transport: { postState: () => Promise.resolve({ status: 0, data: null }) }, now: timers.now, timers })
    e2.setConsent(true)
    assert.equal(e2.consent(), 'granted')
    e2.setConsent(null)
    assert.equal(e2.consent(), 'unset')
    e.destroy()
    e2.destroy()
  })

  test('başka sekmede geri alınan izin, bellek kopyalı ortak saklamada da oynatıcıyı kapatır', async () => {
    const timers = makeTimers()
    const server = makeServer(timers, { kid: BASE.E2EE.parseKeyCode(GROUP_CODE).kid })
    server.join(ROOM, 1)
    server.join(ROOM, 2)
    const dev = loadDevice({ code: GROUP_CODE })
    const winListeners = {}
    dev.addEventListener = (name, fn) => {
      winListeners[name] = fn
    }
    dev.removeEventListener = (name) => {
      delete winListeners[name]
    }
    // public/js/01-core.js storeGet/storeSet/storeRemove gibi: localStorage boş dönerse bellekteki kopya
    const memoryStore = {}
    const st = {
      get: (k) => {
        const v = dev.localStorage.getItem(k)
        if (typeof v === 'string') return v
        return typeof memoryStore[k] === 'string' ? memoryStore[k] : null
      },
      set: (k, v) => {
        memoryStore[k] = String(v)
        dev.localStorage.setItem(k, String(v))
      },
      remove: (k) => {
        delete memoryStore[k]
        dev.localStorage.removeItem(k)
      }
    }
    const a = makeClient(server, timers, 1, {})
    const b = makeClient(server, timers, 2, { device: dev, storage: st })
    a.sync()
    b.engine.setVoiceRoom(ROOM)
    b.sync()
    b.engine.attachPlayer({ appendChild () {} })
    b.engine.setConsent(true)
    await a.engine.addYouTube(VID)
    b.sync()
    assert.equal(b.ytPlayers.length, 1)
    // Başka sekme izni geri alır
    dev.localStorage.removeItem(CONSENT_KEY)
    assert.equal(b.engine.consent(), 'granted', 'memory copy still shadows the removal before the event')
    winListeners.storage({ key: CONSENT_KEY, oldValue: '1', newValue: null, storageArea: dev.localStorage })
    assert.equal(b.engine.consent(), 'unset')
    assert.equal(b.ytPlayers[0].state.destroyed, true)
    assert.equal(b.engine.snapshot().player.blocked, 'consent')
    // localStorage.clear() (key null) da aynı yoldan
    b.engine.setConsent(true)
    assert.equal(b.ytPlayers.length, 2)
    dev.localStorage._map.clear()
    winListeners.storage({ key: null, storageArea: dev.localStorage })
    assert.equal(b.engine.consent(), 'unset')
    b.engine.destroy()
    assert.equal(winListeners.storage, undefined)
  })

  test('müzik durumunu yazanı sunucu bildirir, başkası adına yazılmış işlem kabul edilmez', async () => {
    const { timers, server, clients: [a, b] } = await setup()
    await a.engine.addYouTube(VID, { title: 'Bir' })
    b.sync()
    assert.equal(b.engine.snapshot().sessionStatus, 'ok')
    assert.equal(b.last('notice').by, 1)
    const kid = b.device.kid
    const plainNow = () => JSON.parse(JSON.stringify(b.device.E2EE.openJson(server.rooms.get(ROOM).env).value))
    let base = plainNow()
    let seq = base.seq
    const forge = (mutate, by) => {
      const plain = JSON.parse(JSON.stringify(base))
      seq++
      plain.seq = seq
      mutate(plain)
      const cur = server.rooms.get(ROOM)
      const rec = { v: cur.v + 1, at: server.now(), env: b.device.E2EE.sealJson(kid, plain) }
      if (by !== undefined) rec.by = by
      server.rooms.set(ROOM, rec)
      b.sync()
      return b.engine.snapshot()
    }
    const notices = b.count('notice')
    // 3 numaralı üye durdurmayı kurbanın (2) adına yazar: hem sahte yazar hem kurbana bildirimin gizlenmesi
    let s = forge((p) => {
      p.gone.push(p.current.id)
      p.current = null
      p.queue = []
      p.playing = false
      p.last = { op: 'stop', by: 2 }
    }, 3)
    assert.equal(s.sessionStatus, 'invalid')
    // Eklenen parçanın ekleyeni yazan değil
    s = forge((p) => {
      p.queue.push({ id: '9999999999999999', type: 'youtube', videoId: VID2, title: 'x', addedBy: 1, duration: 0 })
      p.last = { op: 'add', by: 3, id: '9999999999999999', title: 'x' }
    }, 3)
    assert.equal(s.sessionStatus, 'invalid')
    // Bilinen parçanın ekleyeni değiştirilir (araya giren geçersiz kayıtlar karşılaştırmayı atlatmaz)
    s = forge((p) => {
      p.current.addedBy = 3
      p.last = { op: 'annotate', by: 3, id: p.current.id, title: 'Bir' }
    }, 3)
    assert.equal(s.sessionStatus, 'invalid')
    // Sunucu yazanı bildirmiyor
    s = forge((p) => {
      p.playing = false
      p.last = { op: 'pause', by: 3, id: p.current.id, title: 'Bir' }
    })
    assert.equal(s.sessionStatus, 'invalid')
    assert.equal(b.count('notice'), notices)
    // Doğru yazarla aynı işlem kabul edilir, bildirim gerçek yazarı gösterir
    s = forge((p) => {
      p.playing = false
      p.anchorPos = 1000
      p.anchorAt = server.now()
      p.last = { op: 'pause', by: 3, id: p.current.id, title: 'Bir' }
    }, 3)
    assert.equal(s.sessionStatus, 'ok')
    same({ op: b.last('notice').op, by: b.last('notice').by }, { op: 'pause', by: 3 })
    await timers.advance(10)
    // 409 yanıtındaki kayıt da yazarıyla doğrulanır
    base = plainNow()
    const r = await b.engine.resume()
    assert.equal(r.ok, true)
    a.sync()
    assert.equal(a.engine.snapshot().session.playing, true)
    assert.equal(a.last('notice').by, 2)
  })

  // İkinci inceleme turu bulgusu (MAJOR): ekleyen denetimi yalnızca son işlemin parçasına bakıyordu. Oda üyesi
  // başka bir işlemle (duraklat) veya ikinci bir parçayla kuyruğa başkasının adına parça koyabiliyordu.
  test('yeni parçanın ekleyeni sunucunun onayladığı yazarlardan olmalı, başkası adına parça eklenemez', async () => {
    const { server, clients: [a, b, c] } = await setup({ count: 3 })
    await a.engine.addYouTube(VID, { title: 'Bir' })
    b.sync()
    c.sync()
    const kid = c.device.kid
    const plainNow = () => JSON.parse(JSON.stringify(c.device.E2EE.openJson(server.rooms.get(ROOM).env).value))
    let seq = plainNow().seq + 100
    // Saldırgan 3 numaralı üye (c), kurban 2 numaralı üye (b)
    const forge = (base, mutate, by) => {
      const plain = JSON.parse(JSON.stringify(base))
      seq++
      plain.seq = seq
      mutate(plain)
      const cur = server.rooms.get(ROOM)
      server.rooms.set(ROOM, { v: cur.v + 1, at: server.now(), by, env: c.device.E2EE.sealJson(kid, plain) })
    }
    const extra = (id, addedBy, title) => ({ id, type: 'youtube', videoId: VID2, title, addedBy, duration: 0 })
    const base = plainNow()

    // 1. Duraklatma işlemiyle kurbanın adına parça (kurban odada hiç yazmadı)
    forge(base, (p) => {
      p.queue.push(extra('9999999999999999', 2, 'Kurban'))
      p.playing = false
      p.last = { op: 'pause', by: 3, id: p.current.id, title: 'Bir' }
    }, 3)
    a.sync()
    assert.equal(a.engine.snapshot().sessionStatus, 'invalid')
    // 2. Ekleme işleminde iki parça: biri kendi adına (last.id), biri kurban adına
    forge(base, (p) => {
      p.queue.push(extra('8888888888888888', 3, 'Kendi'))
      p.queue.push(extra('7777777777777777', 2, 'Kurban'))
      p.last = { op: 'add', by: 3, id: '8888888888888888', title: 'Kendi' }
    }, 3)
    a.sync()
    assert.equal(a.engine.snapshot().sessionStatus, 'invalid')
    // Aynı ekleme yalnızca kendi parçasıyla kabul edilir
    forge(base, (p) => {
      p.queue.push(extra('8888888888888888', 3, 'Kendi'))
      p.last = { op: 'add', by: 3, id: '8888888888888888', title: 'Kendi' }
    }, 3)
    a.sync()
    assert.equal(a.engine.snapshot().sessionStatus, 'ok')
    same(a.engine.snapshot().session.queue.map((t) => t.addedBy), [3])

    // 3. Kurban odada daha önce yazdıysa (authors içinde) bile, bu cihazın son gördüğü sürümden sonra
    // yazmadıysa adına parça konamaz
    b.sync()
    const r = await b.engine.pause()
    assert.equal(r.ok, true)
    a.sync()
    assert.equal(a.engine.snapshot().sessionStatus, 'ok')
    const afterPause = plainNow()
    forge(afterPause, (p) => {
      p.queue.push(extra('6666666666666666', 2, 'Kurban'))
      p.playing = true
      p.anchorAt = server.now()
      p.last = { op: 'resume', by: 3, id: p.current.id, title: 'Bir' }
    }, 3)
    a.sync()
    assert.equal(a.engine.snapshot().sessionStatus, 'invalid')
    const authors = server.musicMap()[String(ROOM)].authors.slice().sort()
    same(authors, [1, 2, 3])

    for (const x of [a, b, c]) x.engine.destroy()
  })

  test('bu cihazın görmediği ara sürümlerde başkalarının eklediği parçalar gerçek yazarlarıyla kabul edilir', async () => {
    const { server, clients: [a, b, c] } = await setup({ count: 3 })
    await a.engine.addYouTube(VID, { title: 'Bir' })
    b.sync()
    c.sync()
    assert.equal((await b.engine.addYouTube(VID2, { title: 'Burak' })).ok, true)
    c.sync()
    assert.equal((await c.engine.addYouTube('aaaaaaaaaaa', { title: 'Cem' })).ok, true)
    assert.equal((await c.engine.pause()).ok, true)
    // a araya giren üç yazımı hiç görmedi, geçmiş son gördüğü sürümden sonrasını kapsıyor
    const rec = server.musicMap()[String(ROOM)]
    same(rec.writes.map((w) => w.by), [1, 2, 3, 3])
    a.sync()
    const s = a.engine.snapshot()
    assert.equal(s.sessionStatus, 'ok')
    same(s.session.queue.map((t) => [t.title, t.addedBy]), [['Burak', 2], ['Cem', 3]])
    assert.equal(s.session.playing, false)
    for (const x of [a, b, c]) x.engine.destroy()
  })

  test('yazar bilgisi bozuk veya eksik kayıt reddedilir, kapsanmayan geçmişte yalnızca odanın yazarları kabul edilir', async () => {
    const { timers, server, clients: [a, b, c] } = await setup({ count: 3 })
    await a.engine.addYouTube(VID, { title: 'Bir' })
    b.sync()
    c.sync()
    const kid = c.device.kid
    const good = server.musicMap()[String(ROOM)]
    // Sunucunun verdiği kayıt bozulursa (test için doğrudan istemciye verilir)
    const variants = [
      Object.assign({}, good, { writes: undefined }),
      Object.assign({}, good, { authors: undefined }),
      Object.assign({}, good, { since: good.v }),
      Object.assign({}, good, { since: -1 }),
      Object.assign({}, good, { writes: [] }),
      Object.assign({}, good, { writes: [{ v: good.v, by: 2 }] }),
      Object.assign({}, good, { writes: [{ v: good.v - 1, by: 1 }] }),
      Object.assign({}, good, { writes: [{ v: good.v, by: 1, x: 1 }] }),
      Object.assign({}, good, { authors: [] }),
      Object.assign({}, good, { authors: [1, 1] }),
      Object.assign({}, good, { authors: [2] }),
      Object.assign({}, good, { authors: ['1'] })
    ]
    const fresh = makeClient(server, timers, 2)
    fresh.engine.handleMeta(server.meta(), 2)
    fresh.engine.setVoiceRoom(ROOM)
    for (const rec of variants) {
      fresh.engine.ingest({ now: server.now(), muv: 1000, music: {} }, null)
      fresh.engine.ingest({ now: server.now(), muv: 1001, music: { [String(ROOM)]: rec } }, null)
      assert.equal(fresh.engine.snapshot().sessionStatus, 'invalid', JSON.stringify(Object.assign({}, rec, { env: '' })))
    }
    fresh.engine.ingest({ now: server.now(), muv: 1000, music: {} }, null)
    fresh.engine.ingest({ now: server.now(), muv: 1002, music: { [String(ROOM)]: good } }, null)
    assert.equal(fresh.engine.snapshot().sessionStatus, 'ok')
    fresh.engine.destroy()

    // Geç katılan (son geçerli durumu yok): odada hiç yazmamış biri adına parça reddedilir. Sınır: odada
    // daha önce yazmış biri adına parça doğrulanamaz ve kabul edilir (sözleşmede belirtildi).
    const base = JSON.parse(JSON.stringify(c.device.E2EE.openJson(server.rooms.get(ROOM).env).value))
    let seq = base.seq + 50
    const forge = (mutate, by) => {
      const plain = JSON.parse(JSON.stringify(base))
      plain.seq = ++seq
      mutate(plain)
      const cur = server.rooms.get(ROOM)
      server.rooms.set(ROOM, { v: cur.v + 1, at: server.now(), by, env: c.device.E2EE.sealJson(kid, plain) })
    }
    const late = () => {
      const x = makeClient(server, timers, 2)
      x.engine.handleMeta(server.meta(), 2)
      x.engine.ingest(server.payload(), null)
      const st = x.engine.roomView(ROOM).status
      x.engine.destroy()
      return st
    }
    forge((p) => {
      p.queue.push({ id: '5555555555555555', type: 'youtube', videoId: VID2, title: 'x', addedBy: 2, duration: 0 })
      p.last = { op: 'pause', by: 3, id: p.current.id, title: 'Bir' }
      p.playing = false
    }, 3)
    assert.equal(late(), 'invalid')
    forge((p) => {
      p.queue.push({ id: '5555555555555555', type: 'youtube', videoId: VID2, title: 'x', addedBy: 1, duration: 0 })
      p.last = { op: 'pause', by: 3, id: p.current.id, title: 'Bir' }
      p.playing = false
    }, 3)
    assert.equal(late(), 'ok')
    // Sürekli izleyen cihaz (a) ise aynı kaydı reddeder: 1 numaralı üye son gördüğü sürümden sonra yazmadı
    a.sync()
    assert.equal(a.engine.snapshot().sessionStatus, 'invalid')

    // a'nın son geçerli durumundan sonra 32'den çok yazım girdi (geçmiş kapsamıyor): yalnızca authors kuralı
    for (const i of Array.from({ length: 40 }, (x, k) => k)) {
      void i
      forge((p) => {
        p.playing = false
        p.last = { op: 'pause', by: 3, id: p.current.id, title: 'Bir' }
      }, 3)
    }
    const rec = server.musicMap()[String(ROOM)]
    assert.ok(rec.since > 0)
    assert.equal(rec.writes.length, 32)
    assert.ok(rec.writes.every((w) => w.by === 3))
    forge((p) => {
      p.queue.push({ id: '4444444444444444', type: 'youtube', videoId: VID2, title: 'y', addedBy: 2, duration: 0 })
      p.last = { op: 'pause', by: 3, id: p.current.id, title: 'Bir' }
      p.playing = false
    }, 3)
    a.sync()
    assert.equal(a.engine.snapshot().sessionStatus, 'invalid')
    forge((p) => {
      p.queue.push({ id: '4444444444444444', type: 'youtube', videoId: VID2, title: 'y', addedBy: 1, duration: 0 })
      p.last = { op: 'pause', by: 3, id: p.current.id, title: 'Bir' }
      p.playing = false
    }, 3)
    a.sync()
    assert.equal(a.engine.snapshot().sessionStatus, 'ok')
    for (const x of [a, b, c]) x.engine.destroy()
  })
})

describe('inceleme bulguları: YouTube bağdaştırıcısı', () => {
  test('onAutoplayBlocked bekleyen oynatmayı hemen engellendi olarak çözer ve bildirir', async () => {
    const { YT, frames, deliver } = loadYouTube()
    const timers = makeTimers()
    const events = []
    const p = YT.create({ container: { appendChild () {} }, videoId: VID, now: timers.now, timers, onEvent: (e) => events.push(e) })
    const f = frames[0]
    f.fire('load')
    deliver(f, { event: 'onReady', id: p.widgetId })
    const subs = f.sent.filter((m) => m.data.func === 'addEventListener').map((m) => m.data.args[0])
    assert.ok(subs.includes('onAutoplayBlocked'))
    let result = null
    p.play().then((r) => {
      result = r
    })
    await timers.advance(100)
    deliver(f, { event: 'onAutoplayBlocked', id: p.widgetId })
    await timers.advance(10)
    assert.equal(result, 'blocked')
    same(events.filter((e) => e.type === 'blocked'), [{ type: 'blocked' }])
    p.destroy()
  })

  // Çerçeve, ataları ve belge için en küçük DOM taklidi: hesaplanmış stil, kutular, elementFromPoint
  function visibilityDom (opts) {
    const o = opts || {}
    const { YT, frames, dev } = loadYouTube()
    const style = (over) => Object.assign({ overflowX: 'visible', overflowY: 'visible', opacity: '1', display: 'block', visibility: 'visible', clipPath: 'none', clip: 'auto', position: 'static', maskImage: 'none' }, over || {})
    const docEl = { cs: style(), clientWidth: 1000, clientHeight: 800, parentElement: null }
    const body = { cs: style(), parentElement: docEl }
    const card = { cs: style(), parentElement: body, rect: { left: 0, top: 0, right: 400, bottom: 400 }, clientLeft: 0, clientTop: 0, clientWidth: 400, clientHeight: 400, scrollLeft: 0, scrollTop: 0 }
    card.getBoundingClientRect = () => card.rect
    const env = { docEl, body, card, cover: null }
    return { YT, frames, env, style, win: dev, setup: (frame) => {
      frame.parentElement = card
      frame.cs = style()
      frame.rect = { left: 10, top: 10, right: 330, bottom: 250, width: 320, height: 240 }
      const doc = dev.document
      doc.documentElement = docEl
      doc.body = body
      doc.visibilityState = o.hidden ? 'hidden' : 'visible'
      doc.elementFromPoint = (x, y) => (env.cover && env.cover(x, y) ? { cover: true } : frame)
      dev.getComputedStyle = (el) => el.cs
      dev.pageXOffset = 0
      dev.pageYOffset = 0
    } }
  }

  test('örtülen, kırpılan, saydam ata veya ulaşılamayan yerdeki oynatıcı görünür sayılmaz, kaydırılan sayılır', () => {
    const v = visibilityDom()
    const p = v.YT.create({ container: { appendChild () {} }, videoId: VID, onEvent () {} })
    const f = v.frames[0]
    v.setup(f)
    const check = (label, mutate, expected) => {
      const undo = mutate() || (() => {})
      assert.equal(p.visible(), expected, label)
      undo()
    }
    check('normal', () => null, true)
    // Tam ekran opak katman (Ayarlar görünümü gibi)
    check('covered', () => {
      v.env.cover = () => true
      return () => {
        v.env.cover = null
      }
    }, false)
    check('corner covered', () => {
      v.env.cover = (x, y) => x < 50 && y < 50
      return () => {
        v.env.cover = null
      }
    }, false)
    check('ancestor clip-path', () => {
      v.env.card.cs.clipPath = 'inset(50%)'
      return () => {
        v.env.card.cs.clipPath = 'none'
      }
    }, false)
    check('frame mask', () => {
      f.cs.maskImage = 'linear-gradient(transparent, transparent)'
      return () => {
        f.cs.maskImage = 'none'
      }
    }, false)
    check('collapsed card (overflow hidden)', () => {
      v.env.card.cs.overflowY = 'hidden'
      v.env.card.rect = { left: 0, top: 0, right: 400, bottom: 60 }
      v.env.card.clientHeight = 60
      return () => {
        v.env.card.cs.overflowY = 'visible'
        v.env.card.rect = { left: 0, top: 0, right: 400, bottom: 400 }
        v.env.card.clientHeight = 400
      }
    }, false)
    check('off-screen left -10000', () => {
      f.rect = { left: -10000, top: 10, right: -9680, bottom: 250, width: 320, height: 240 }
      return () => {
        f.rect = { left: 10, top: 10, right: 330, bottom: 250, width: 320, height: 240 }
      }
    }, false)
    check('scrolled out of the viewport (reachable)', () => {
      f.rect = { left: 10, top: -2000, right: 330, bottom: -1760, width: 320, height: 240 }
      v.win.pageYOffset = 2500
      v.env.cover = () => true
      return () => {
        f.rect = { left: 10, top: 10, right: 330, bottom: 250, width: 320, height: 240 }
        v.win.pageYOffset = 0
        v.env.cover = null
      }
    }, true)
    check('scroll container scrolled (reachable)', () => {
      v.env.card.cs.overflowY = 'auto'
      v.env.card.scrollTop = 300
      f.rect = { left: 10, top: -290, right: 330, bottom: -50, width: 320, height: 240 }
      return () => {
        v.env.card.cs.overflowY = 'visible'
        v.env.card.scrollTop = 0
        f.rect = { left: 10, top: 10, right: 330, bottom: 250, width: 320, height: 240 }
      }
    }, true)
    check('body overflow hidden, below the viewport', () => {
      v.env.body.cs.overflowY = 'hidden'
      f.rect = { left: 10, top: 5000, right: 330, bottom: 5240, width: 320, height: 240 }
      return () => {
        v.env.body.cs.overflowY = 'visible'
        f.rect = { left: 10, top: 10, right: 330, bottom: 250, width: 320, height: 240 }
      }
    }, false)
    // checkVisibility olmayan eski tarayıcı: atadaki opacity 0 da yakalanır
    check('ancestor opacity 0 without checkVisibility', () => {
      const cv = f.checkVisibility
      f.checkVisibility = undefined
      v.env.card.cs.opacity = '0'
      return () => {
        f.checkVisibility = cv
        v.env.card.cs.opacity = '1'
      }
    }, false)
    p.destroy()
  })

  // 23-dj.js ve dj.css: kart görünmezken veya üstü örtülürken oynatıcı alanı köşeye sabitlenir. Kart
  // visibility: hidden olur, çerçeve görünür kalır ve kartın kutusunun dışındadır, atalar overflow visible olur.
  test('köşedeki oynatıcı görünür sayılır, kırpan bir ata kalırsa veya 200x200 altına inerse sayılmaz', () => {
    const v = visibilityDom()
    const p = v.YT.create({ container: { appendChild () {} }, videoId: VID, onEvent () {} })
    const f = v.frames[0]
    v.setup(f)
    v.env.card.cs.visibility = 'hidden'
    v.env.card.rect = { left: 0, top: 0, right: 0, bottom: 0 }
    v.env.card.clientWidth = 0
    v.env.card.clientHeight = 0
    f.rect = { left: 625, top: 535, right: 979, bottom: 735, width: 354, height: 200 }
    assert.equal(p.visible(), true, 'köşede')
    v.env.card.cs.overflowX = 'hidden'
    v.env.card.cs.overflowY = 'hidden'
    assert.equal(p.visible(), false, 'kırpan ata')
    v.env.card.cs.overflowX = 'visible'
    v.env.card.cs.overflowY = 'visible'
    f.rect = { left: 625, top: 536, right: 979, bottom: 735, width: 354, height: 199 }
    assert.equal(p.visible(), false, '200 pikselden alçak')
    p.destroy()
  })

  test('arka plandaki sekmede örtme denetimi yapılmaz', () => {
    const v = visibilityDom({ hidden: true })
    const p = v.YT.create({ container: { appendChild () {} }, videoId: VID, onEvent () {} })
    v.setup(v.frames[0])
    v.env.cover = () => true
    assert.equal(p.visible(), true)
    p.destroy()
  })
})

// dj.css: köşedeki oynatıcı kutusu en az 202 piksel (kenarlık dahil, çerçeve 200x200 kalır) ve her katmanın,
// Ayarlar'ın ve kısa bildirimlerin üstündedir. Atalarında position: fixed kutuyu hapseden özellik yoktur.
test('dj.css: köşedeki oynatıcı en az 200x200 ve bütün katmanların üstünde', () => {
  const cssDir = path.join(ROOT, 'public', 'css')
  const files = fs.readdirSync(cssDir).filter((n) => n.endsWith('.css')).map((n) => path.join(cssDir, n))
    .concat(fs.readdirSync(path.join(cssDir, 'skins')).map((n) => path.join(cssDir, 'skins', n)))
  const rule = (css, selector) => {
    const i = css.indexOf('\n' + selector + ' {')
    assert.ok(i !== -1, 'kural yok: ' + selector)
    return css.slice(i, css.indexOf('}', i))
  }
  const dj = fs.readFileSync(path.join(cssDir, 'dj.css'), 'utf8')
  const dock = rule(dj, '.side-dj.is-docked')
  const dockZ = Number(/z-index: (\d+)/.exec(dock)[1])
  let maxOther = 0
  files.forEach((file) => {
    const css = fs.readFileSync(file, 'utf8').replace(dock, '')
    const re = /z-index: (\d+)/g
    let m
    while ((m = re.exec(css))) maxOther = Math.max(maxOther, Number(m[1]))
  })
  assert.ok(dockZ > maxOther, 'köşedeki oynatıcı z-index ' + dockZ + ' > ' + maxOther)
  assert.match(dock, /visibility: hidden/)
  assert.match(dock, /overflow: visible/)
  const box = rule(dj, '.side-dj.is-docked .dj-yt')
  assert.match(box, /height: 202px/)
  assert.match(rule(dj, '.side-dj.is-docked .dj-yt,\n.side-dj.is-docked .dj-dock'), /min-width: 202px[\s\S]*visibility: visible/)
  assert.match(rule(dj, '.side-dj.is-docked .dj-scroll'), /overflow: visible/)
  assert.match(rule(dj, ':root .side-dj.is-docked .dj-card.side-card'), /backdrop-filter: none/)
  assert.match(rule(dj, 'body.has-dj-dock .app-view'), /z-index: auto/)
  // Kartın ve sayfanın kurallarında kutuyu hapseden özellik yok (açılış canlandırması köşedeyken kapalı)
  assert.doesNotMatch(dj, /(^|\s)(transform|filter|contain|will-change|perspective):/m)
  assert.match(dock, /animation: none/)
})
