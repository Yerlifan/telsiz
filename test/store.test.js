'use strict'

// src/store.js testleri: atomik yazım, .bak kurtarma, JSONL yeniden oynatma, yarım satır toleransı,
// sıkıştırma, kanal başına üst sınır, kilit dosyası ve yükleme yolları.
// Windows'ta da çalışır: yollar path.join, geçici klasörler os.tmpdir(), izin testleri yalnızca POSIX'te.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const childProcess = require('node:child_process')
const { Readable } = require('node:stream')
const { pipeline } = require('node:stream/promises')

const { openStore, StoreError, emptyState, lockInfo } = require('../src/store')

// Linux, macOS ve Windows'ta geçerli bir süreç kimliği olamayacak değer
const DEAD_PID = 2147483646
const IS_WINDOWS = process.platform === 'win32'

function tempDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-store-'))
}

function removeDir (dir) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
}

function makeLog () {
  const lines = { info: [], warn: [], error: [] }
  return {
    lines,
    info (text) {
      lines.info.push(String(text))
    },
    warn (text) {
      lines.warn.push(String(text))
    },
    error (text) {
      lines.error.push(String(text))
    }
  }
}

function msg (id, channelId, extra) {
  return Object.assign({ id, channelId, authorId: 1, body: 'zarf-' + id, createdAt: 1000 + id, editedAt: null, uploads: [] }, extra || {})
}

function hexId (n) {
  return n.toString(16).padStart(32, '0')
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitFor (check, timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 5000)
  while (Date.now() < deadline) {
    if (check()) return
    await sleep(10)
  }
  throw new Error('Koşul zaman aşımına kadar sağlanmadı.')
}

function nonEmptyLines (file) {
  return fs.readFileSync(file, 'utf8').split('\n').filter((line) => line.trim() !== '')
}

function readJson (file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\ufeff/, ''))
}

function ids (list) {
  return list.map((m) => m.id)
}

function range (from, to) {
  const out = []
  let i = from
  while (i <= to) out.push(i++)
  return out
}

// Klasördeki tüm dosyaların adları ve içerikleri (yazım olmadığını doğrulamak için)
function snapshotDir (dir) {
  const out = {}
  function walk (sub) {
    for (const name of fs.readdirSync(path.join(dir, sub)).sort()) {
      const rel = path.join(sub, name)
      const full = path.join(dir, rel)
      const info = fs.statSync(full)
      if (info.isDirectory()) {
        out[rel + path.sep] = 'dir'
        walk(rel)
      } else {
        out[rel] = fs.readFileSync(full).toString('base64') + ':' + info.mtimeMs
      }
    }
  }
  walk('')
  return out
}

function isCode (code) {
  return (err) => err instanceof StoreError && err.code === code
}

function patchFs (name, replacement) {
  const original = fs.promises[name]
  fs.promises[name] = replacement(original)
  return () => {
    fs.promises[name] = original
  }
}

async function populated (dir, opts) {
  const store = await openStore(Object.assign({ dir, log: makeLog() }, opts || {}))
  store.initState({ serverName: 'Bir' })
  return store
}

test('ilk açılış: durum null, initState iskeleti tamamlar ve kalıcı olur', async () => {
  const dir = tempDir()
  try {
    const store = await openStore({ dir, log: makeLog() })
    assert.equal(store.state, null)
    assert.ok(fs.statSync(path.join(dir, 'messages')).isDirectory())
    assert.ok(fs.statSync(path.join(dir, 'uploads')).isDirectory())
    assert.equal(fs.existsSync(path.join(dir, 'state.json')), false)

    const channels = [{ id: 1, name: 'genel', type: 'text', position: 0, createdAt: 5 }]
    const st = store.initState({ serverName: 'Deneme', inviteCode: 'ABCDE-FGHJK', channels, counters: { channel: 1 } })
    assert.equal(store.state, st)
    assert.equal(st.version, 2)
    assert.deepEqual(st.counters, { user: 0, channel: 1, message: 0 })
    assert.deepEqual(st.users, [])
    assert.deepEqual(st.sessions, [])
    assert.deepEqual(st.uploads, [])
    assert.equal(st.activeKid, null)
    assert.throws(() => store.initState({}), isCode('state_exists'))

    await store.flush()
    assert.deepEqual(readJson(path.join(dir, 'state.json')), st)
    assert.equal(fs.existsSync(path.join(dir, 'state.json.tmp')), false)
    await store.close()

    const again = await openStore({ dir, log: makeLog() })
    assert.deepEqual(again.state, st)
    await again.close()
  } finally {
    removeDir(dir)
  }
})

test('emptyState iskeleti ve geçersiz ilk durumlar', async () => {
  assert.deepEqual(emptyState(), {
    version: 2,
    serverName: 'Telsiz',
    inviteCode: null,
    activeKid: null,
    counters: { user: 0, channel: 0, message: 0 },
    users: [],
    sessions: [],
    channels: [],
    uploads: []
  })
  assert.notEqual(emptyState().users, emptyState().users)

  const dir = tempDir()
  try {
    const store = await openStore({ dir, log: makeLog() })
    assert.throws(() => store.initState({ users: 'x' }), TypeError)
    assert.throws(() => store.initState({ version: 3 }), TypeError)
    assert.throws(() => store.initState({ counters: { message: -1 } }), TypeError)
    assert.throws(() => store.initState({ channels: [1, 2] }), TypeError)
    assert.throws(() => store.initState(5), TypeError)
    assert.equal(store.state, null)
    const st = store.initState()
    assert.deepEqual(st, emptyState())
    await store.close()
  } finally {
    removeDir(dir)
  }
})

test('saveState 200 ms içinde tek yazım planlar, flush hemen yazar', async () => {
  const dir = tempDir()
  const statePath = path.join(dir, 'state.json')
  let stateRenames = 0
  const restore = patchFs('rename', (original) => function (from, to) {
    if (path.basename(String(to)) === 'state.json') stateRenames++
    return original.call(this, from, to)
  })
  try {
    const store = await openStore({ dir, log: makeLog() })
    store.initState({})
    for (const i of range(0, 49)) {
      store.state.serverName = 'Ad ' + i
      store.saveState()
    }
    assert.equal(fs.existsSync(statePath), false)
    await store.flush()
    assert.equal(stateRenames, 1)
    assert.equal(readJson(statePath).serverName, 'Ad 49')

    // flush olmadan zamanlayıcı yazar
    store.state.serverName = 'Zamanlayıcı'
    const started = Date.now()
    store.saveState()
    store.saveState()
    assert.equal(readJson(statePath).serverName, 'Ad 49')
    await waitFor(() => readJson(statePath).serverName === 'Zamanlayıcı', 5000)
    assert.ok(Date.now() - started >= 150, 'yazım beklemeden yapıldı')
    assert.equal(stateRenames, 2)

    // değişiklik yoksa flush yazmaz
    await store.flush()
    assert.equal(stateRenames, 2)
    await store.close()
  } finally {
    restore()
    removeDir(dir)
  }
})

test('her yazımda önceki state.json, state.json.bak olarak saklanır', async () => {
  const dir = tempDir()
  const statePath = path.join(dir, 'state.json')
  const bakPath = statePath + '.bak'
  try {
    const store = await populated(dir)
    await store.flush()
    assert.equal(fs.existsSync(bakPath), false)
    const first = fs.readFileSync(statePath, 'utf8')

    store.state.serverName = 'İki'
    store.saveState()
    await store.flush()
    assert.equal(fs.readFileSync(bakPath, 'utf8'), first)
    assert.equal(readJson(statePath).serverName, 'İki')

    store.state.serverName = 'Üç'
    store.saveState()
    await store.flush()
    assert.equal(readJson(bakPath).serverName, 'İki')
    assert.equal(readJson(statePath).serverName, 'Üç')
    await store.close()
  } finally {
    removeDir(dir)
  }
})

test('atomik yazım: Windows EPERM/EBUSY rename hataları 3 kez yeniden denenir', async () => {
  const dir = tempDir()
  const statePath = path.join(dir, 'state.json')
  try {
    const log = makeLog()
    const store = await openStore({ dir, log })
    store.initState({ serverName: 'Önce' })
    await store.flush()

    // 3 hata, 4. deneme başarılı
    let failures = 3
    let restore = patchFs('rename', (original) => function (from, to) {
      if (path.basename(String(to)) === 'state.json' && failures > 0) {
        failures--
        const err = new Error('dosya kilitli')
        err.code = failures % 2 === 0 ? 'EPERM' : 'EBUSY'
        return Promise.reject(err)
      }
      return original.call(this, from, to)
    })
    try {
      store.state.serverName = 'Sonra'
      store.saveState()
      await store.flush()
    } finally {
      restore()
    }
    assert.equal(failures, 0)
    assert.equal(readJson(statePath).serverName, 'Sonra')
    assert.equal(fs.existsSync(statePath + '.tmp'), false)

    // sürekli hata: flush reddedilir, eski dosya bozulmaz, geçici dosya kalmaz
    let attempts = 0
    restore = patchFs('rename', (original) => function (from, to) {
      if (path.basename(String(to)) === 'state.json') {
        attempts++
        const err = new Error('dosya kilitli')
        err.code = 'EBUSY'
        return Promise.reject(err)
      }
      return original.call(this, from, to)
    })
    try {
      store.state.serverName = 'Yazılamayan'
      store.saveState()
      await assert.rejects(store.flush(), isCode('write_failed'))
      assert.ok(attempts >= 4, 'deneme sayısı ' + attempts)
      assert.equal(readJson(statePath).serverName, 'Sonra')
      assert.equal(fs.existsSync(statePath + '.tmp'), false)
      assert.ok(log.lines.error.length >= 1)
    } finally {
      restore()
    }
    await store.flush()
    assert.equal(readJson(statePath).serverName, 'Yazılamayan')
    await store.close()
  } finally {
    removeDir(dir)
  }
})

test('bozuk state.json: .bak ile kurtarılır, bozuk dosya saklanır, iyi yedek ezilmez', async () => {
  const dir = tempDir()
  const statePath = path.join(dir, 'state.json')
  const bakPath = statePath + '.bak'
  try {
    const store = await populated(dir)
    await store.flush()
    store.state.serverName = 'İki'
    store.saveState()
    await store.close()
    assert.equal(readJson(bakPath).serverName, 'Bir')

    fs.writeFileSync(statePath, '{"version":2,"serverName":"yarı')
    const log = makeLog()
    const recovered = await openStore({ dir, log })
    assert.equal(recovered.state.serverName, 'Bir')
    assert.ok(log.lines.warn.some((line) => line.includes('bozuk')))
    const copies = fs.readdirSync(dir).filter((name) => name.startsWith('state.json.bozuk-'))
    assert.equal(copies.length, 1)
    assert.equal(fs.readFileSync(path.join(dir, copies[0]), 'utf8'), '{"version":2,"serverName":"yarı')

    recovered.state.serverName = 'Üç'
    recovered.saveState()
    await recovered.flush()
    assert.equal(readJson(statePath).serverName, 'Üç')
    assert.equal(readJson(bakPath).serverName, 'Bir')

    // sonraki yazımda artık geçerli olan dosya yedeklenir
    recovered.state.serverName = 'Dört'
    recovered.saveState()
    await recovered.flush()
    assert.equal(readJson(bakPath).serverName, 'Üç')
    await recovered.close()
  } finally {
    removeDir(dir)
  }
})

test('state.json ve yedeği geçersizse StoreError, hiçbir dosyaya yazılmaz', async () => {
  const dir = tempDir()
  const statePath = path.join(dir, 'state.json')
  const bakPath = statePath + '.bak'
  try {
    const store = await populated(dir)
    store.addMessage(msg(1, 1))
    await store.flush()
    store.state.serverName = 'İki'
    store.saveState()
    await store.close()

    const cases = [
      { main: 'bozuk {', bak: 'bozuk [' },
      { main: '[]', bak: null },
      { main: '{"version":2,"users":"x"}', bak: '{"version":2,"counters":{"message":-5}}' },
      { main: '', bak: '' }
    ]
    for (const item of cases) {
      fs.writeFileSync(statePath, item.main)
      if (item.bak === null) fs.rmSync(bakPath, { force: true })
      else fs.writeFileSync(bakPath, item.bak)
      const before = snapshotDir(dir)
      await assert.rejects(openStore({ dir, log: makeLog() }), (err) => {
        return err instanceof StoreError && err.code === 'corrupt' && err.message.includes('hiçbir dosyaya yazılmadı')
      })
      assert.deepEqual(snapshotDir(dir), before)
      assert.equal(fs.existsSync(path.join(dir, '.kilit')), false)
    }

    // state.json yok ama yedek bozuk: yeni kurulum gibi davranılmaz
    fs.rmSync(statePath)
    fs.writeFileSync(bakPath, 'bozuk')
    const before = snapshotDir(dir)
    await assert.rejects(openStore({ dir, log: makeLog() }), isCode('corrupt'))
    assert.deepEqual(snapshotDir(dir), before)
  } finally {
    removeDir(dir)
  }
})

test('desteklenmeyen sürüm StoreError verir ve hiçbir şey yazılmaz', async () => {
  const dir = tempDir()
  try {
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 3, serverName: 'Yeni' }))
    const before = snapshotDir(dir)
    await assert.rejects(openStore({ dir, log: makeLog() }), isCode('version'))
    assert.deepEqual(snapshotDir(dir), before)
  } finally {
    removeDir(dir)
  }
})

test('state.json yoksa geçerli yedek kullanılır, BOM ve eksik alanlar tolere edilir', async () => {
  const dir = tempDir()
  try {
    fs.writeFileSync(path.join(dir, 'state.json.bak'), '\ufeff' + JSON.stringify({ version: 2, serverName: 'Yedek', counters: { user: 3 } }))
    const log = makeLog()
    const store = await openStore({ dir, log })
    assert.equal(store.state.serverName, 'Yedek')
    assert.deepEqual(store.state.counters, { user: 3, channel: 0, message: 0 })
    assert.deepEqual(store.state.users, [])
    assert.ok(log.lines.warn.some((line) => line.includes('yedek')))
    store.saveState()
    await store.close()
    assert.equal(readJson(path.join(dir, 'state.json')).serverName, 'Yedek')
    assert.equal(readJson(path.join(dir, 'state.json.bak')).serverName, 'Yedek')
  } finally {
    removeDir(dir)
  }
})

test('kilit dosyası: PID yazılır, kapanınca silinir, eski kilit yok sayılır, canlı süreç reddedilir', async () => {
  const dir = tempDir()
  const lockPath = path.join(dir, '.kilit')
  let child = null
  try {
    assert.deepEqual(lockInfo(dir), { path: lockPath, exists: false, pid: null, alive: false })
    const store = await openStore({ dir, log: makeLog() })
    assert.equal(fs.readFileSync(lockPath, 'utf8').trim(), String(process.pid))
    assert.deepEqual(lockInfo(dir), { path: lockPath, exists: true, pid: process.pid, alive: true })
    await store.close()
    assert.equal(fs.existsSync(lockPath), false)

    // eski (ölü süreç) ve bozuk kilitler yok sayılır
    for (const content of [DEAD_PID + '\n', 'çöp']) {
      fs.writeFileSync(lockPath, content)
      assert.equal(lockInfo(dir).alive, false)
      const reopened = await openStore({ dir, log: makeLog() })
      assert.equal(fs.readFileSync(lockPath, 'utf8').trim(), String(process.pid))
      await reopened.close()
    }

    // canlı başka bir süreç
    child = childProcess.spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' })
    assert.ok(child.pid > 0)
    fs.writeFileSync(lockPath, child.pid + '\n')
    assert.equal(lockInfo(dir).alive, true)
    const before = snapshotDir(dir)
    await assert.rejects(openStore({ dir, log: makeLog() }), (err) => err instanceof StoreError && err.code === 'locked' && err.message.includes(String(child.pid)))
    assert.deepEqual(snapshotDir(dir), before)
  } finally {
    if (child) child.kill()
    removeDir(dir)
  }
})

test('JSONL: ekleme, düzenleme ve silme satırları yazılır ve yeniden oynatılır', async () => {
  const dir = tempDir()
  const file1 = path.join(dir, 'messages', '1.jsonl')
  try {
    const store = await populated(dir)
    const upload = hexId(1)
    for (const id of [1, 2, 3, 4]) assert.deepEqual(store.addMessage(msg(id, 1, id === 4 ? { uploads: [upload] } : {})), [])
    store.addMessage(msg(5, 2))
    store.addMessage(msg(6, 2))
    const edited = store.editMessage(2, 'yeni-zarf', 5000)
    assert.equal(edited.body, 'yeni-zarf')
    assert.equal(edited.editedAt, 5000)
    assert.equal(store.deleteMessage(3).id, 3)
    await store.flush()

    const lines = nonEmptyLines(file1)
    assert.equal(lines.length, 6)
    assert.deepEqual(JSON.parse(lines[0]), { op: 'add', m: msg(1, 1) })
    assert.deepEqual(JSON.parse(lines[3]), { op: 'add', m: msg(4, 1, { uploads: [upload] }) })
    assert.equal(lines[4], '{"op":"edit","id":2,"body":"yeni-zarf","editedAt":5000}')
    assert.equal(lines[5], '{"op":"del","id":3}')
    assert.equal(nonEmptyLines(path.join(dir, 'messages', '2.jsonl')).length, 2)
    await store.close()

    const again = await openStore({ dir, log: makeLog() })
    assert.deepEqual(ids(again.listMessages(1).messages), [1, 2, 4])
    assert.deepEqual(again.getMessage(2), msg(2, 1, { body: 'yeni-zarf', editedAt: 5000 }))
    assert.deepEqual(again.getMessage(4).uploads, [upload])
    assert.equal(again.getMessage(3), null)
    assert.equal(again.getMessage(5).channelId, 2)
    assert.deepEqual(ids(again.listMessages(2).messages), [5, 6])

    // en büyük güvenli tamsayı kanal kimliği de yeniden yüklenir
    const bigChannel = Number.MAX_SAFE_INTEGER
    again.addMessage(msg(7, bigChannel))
    await again.close()
    assert.ok(fs.existsSync(path.join(dir, 'messages', String(bigChannel) + '.jsonl')))
    const third = await openStore({ dir, log: makeLog() })
    assert.deepEqual(ids(third.listMessages(bigChannel).messages), [7])
    await third.close()
  } finally {
    removeDir(dir)
  }
})

test('JSONL: yarım son satır atlanır ve sonraki ekleme onunla birleşmez', async () => {
  const dir = tempDir()
  const file = path.join(dir, 'messages', '1.jsonl')
  try {
    const store = await populated(dir)
    for (const id of range(1, 5)) store.addMessage(msg(id, 1))
    await store.close()

    fs.appendFileSync(file, '{"op":"add","m":{"id":6,"chan')
    const log = makeLog()
    const reopened = await openStore({ dir, log })
    assert.deepEqual(ids(reopened.listMessages(1).messages), range(1, 5))
    assert.ok(log.lines.warn.some((line) => line.includes('1 bozuk veya yarım satır')))
    reopened.addMessage(msg(7, 1))
    await reopened.close()

    const raw = fs.readFileSync(file, 'utf8')
    assert.ok(raw.includes('"chan\n{"op":"add","m":{"id":7,'), 'yeni satır yarım satırdan ayrılmalı')
    const third = await openStore({ dir, log: makeLog() })
    assert.deepEqual(ids(third.listMessages(1).messages), [1, 2, 3, 4, 5, 7])
    await third.close()
  } finally {
    removeDir(dir)
  }
})

test('JSONL: bozuk, geçersiz, yinelenen ve CRLF satırlar güvenle işlenir', async () => {
  const dir = tempDir()
  const messagesDir = path.join(dir, 'messages')
  try {
    fs.mkdirSync(messagesDir, { recursive: true })
    const add = (m) => JSON.stringify({ op: 'add', m })
    const content = [
      add(msg(1, 4)),
      'tamamen bozuk satır',
      add(msg(2, 4)),
      '',
      '[]',
      'null',
      '{"op":"zap","id":1}',
      '{"op":"add","m":{"id":"x","channelId":4}}',
      add(msg(3, 4, { uploads: ['../../state.json'] })),
      add(msg(4, 9)),
      add(msg(5, 4)),
      add(msg(5, 4, { body: 'yinelenen' })),
      '{"op":"del","id":5}',
      add(msg(5, 4, { body: 'dirilmemeli' })),
      '{"op":"edit","id":2,"body":"düzeltilmiş","editedAt":77}',
      '{"op":"edit","id":1,"body":5,"editedAt":1}',
      add(msg(6, 4))
    ].join('\r\n') + '\r\n'
    fs.writeFileSync(path.join(messagesDir, '4.jsonl'), content)
    fs.writeFileSync(path.join(messagesDir, '007.jsonl'), add(msg(8, 7)) + '\n')
    fs.writeFileSync(path.join(messagesDir, 'not.jsonl'), 'x\n')

    const log = makeLog()
    const store = await openStore({ dir, log, compactMinLines: 1000000 })
    assert.deepEqual(ids(store.listMessages(4).messages), [1, 2, 6])
    assert.equal(store.getMessage(2).body, 'düzeltilmiş')
    assert.equal(store.getMessage(2).editedAt, 77)
    assert.equal(store.getMessage(1).body, 'zarf-1')
    assert.equal(store.getMessage(5), null)
    assert.equal(store.getMessage(8), null)
    assert.ok(log.lines.warn.some((line) => line.includes('4.jsonl') && line.includes('bozuk')))
    assert.ok(log.lines.warn.some((line) => line.includes('007.jsonl')))
    await store.close()
    // geçersiz adlı dosyalara dokunulmaz
    assert.ok(fs.existsSync(path.join(messagesDir, '007.jsonl')))
    assert.ok(fs.existsSync(path.join(messagesDir, 'not.jsonl')))
  } finally {
    removeDir(dir)
  }
})

test('açılışta sıkıştırma: silme ve düzenleme oranı yüzde 30u aşan dosya atomik yeniden yazılır', async () => {
  const dir = tempDir()
  const file1 = path.join(dir, 'messages', '1.jsonl')
  const file2 = path.join(dir, 'messages', '2.jsonl')
  try {
    const store = await populated(dir, { compactMinLines: 1000000 })
    for (const id of range(1, 10)) store.addMessage(msg(id, 1))
    store.editMessage(1, 'd1', 1)
    store.editMessage(2, 'd2', 2)
    store.editMessage(3, 'd3', 3)
    store.deleteMessage(4)
    store.deleteMessage(5)
    for (const id of range(11, 20)) store.addMessage(msg(id, 2))
    store.deleteMessage(11)
    await store.close()
    assert.equal(nonEmptyLines(file1).length, 15)
    assert.equal(nonEmptyLines(file2).length, 11)

    const reopened = await openStore({ dir, log: makeLog() })
    const lines = nonEmptyLines(file1)
    assert.equal(lines.length, 8)
    assert.ok(lines.every((line) => JSON.parse(line).op === 'add'))
    assert.equal(fs.existsSync(file1 + '.tmp'), false)
    // eşiğin altındaki dosyaya dokunulmaz
    assert.equal(nonEmptyLines(file2).length, 11)
    const list = reopened.listMessages(1).messages
    assert.deepEqual(ids(list), [1, 2, 3, 6, 7, 8, 9, 10])
    assert.deepEqual(list[1], msg(2, 1, { body: 'd2', editedAt: 2 }))
    await reopened.close()

    const third = await openStore({ dir, log: makeLog() })
    assert.deepEqual(third.listMessages(1).messages, list)
    assert.equal(nonEmptyLines(file1).length, 8)
    await third.close()
  } finally {
    removeDir(dir)
  }
})

test('çalışırken sıkıştırma ve eşzamanlı yazımlar veri kaybetmez veya çoğaltmaz', async () => {
  const dir = tempDir()
  const file = path.join(dir, 'messages', '1.jsonl')
  try {
    const store = await populated(dir, { compactMinLines: 4 })
    const expected = new Map()
    let ops = 0
    for (const id of range(1, 300)) {
      store.addMessage(msg(id, 1))
      expected.set(id, msg(id, 1))
      ops++
      if (id % 3 === 0 && expected.has(id - 1)) {
        store.deleteMessage(id - 1)
        expected.delete(id - 1)
        ops++
      }
      if (id % 5 === 0) {
        store.editMessage(id, 'düz-' + id, id)
        expected.set(id, msg(id, 1, { body: 'düz-' + id, editedAt: id }))
        ops++
      }
      if (id % 40 === 0) await new Promise((resolve) => setImmediate(resolve))
    }
    // uygulama gibi sayaçları ilerlet, açılışta uzlaştırma uyarısı beklenmez
    store.state.counters.message = 300
    store.state.counters.channel = 1
    store.saveState()
    const inMemory = store.listMessages(1, { limit: 1000 }).messages
    assert.deepEqual(inMemory, Array.from(expected.values()))
    await store.flush()
    assert.ok(nonEmptyLines(file).length < ops, 'dosya sıkıştırılmalıydı')
    await store.close()

    const log = makeLog()
    const reopened = await openStore({ dir, log })
    assert.deepEqual(reopened.listMessages(1, { limit: 1000 }).messages, inMemory)
    assert.deepEqual(log.lines.warn, [])
    await reopened.close()
  } finally {
    removeDir(dir)
  }
})

test('kanal başına üst sınır: en eski mesajlar düşer ve döndürülür', async () => {
  const dir = tempDir()
  const file = path.join(dir, 'messages', '1.jsonl')
  try {
    const store = await populated(dir, { maxMessagesPerChannel: 5 })
    for (const id of range(1, 5)) assert.deepEqual(store.addMessage(msg(id, 1)), [])
    store.addMessage(msg(50, 2))
    assert.deepEqual(store.addMessage(msg(6, 1)), [msg(1, 1)])
    assert.deepEqual(store.addMessage(msg(7, 1, { uploads: [hexId(9)] })), [msg(2, 1)])
    assert.deepEqual(ids(store.listMessages(1).messages), [3, 4, 5, 6, 7])
    assert.equal(store.getMessage(1), null)
    assert.equal(store.getMessage(50).id, 50)
    await store.close()
    assert.equal(nonEmptyLines(file).length, 7)

    const same = await openStore({ dir, log: makeLog(), maxMessagesPerChannel: 5 })
    assert.deepEqual(ids(same.listMessages(1).messages), [3, 4, 5, 6, 7])
    await same.close()

    const smaller = await openStore({ dir, log: makeLog(), maxMessagesPerChannel: 3 })
    assert.deepEqual(ids(smaller.listMessages(1).messages), [5, 6, 7])
    assert.equal(smaller.getMessage(4), null)
    await smaller.close()
    assert.equal(nonEmptyLines(file).length, 3)
  } finally {
    removeDir(dir)
  }
})

test('sayfalama: before, limit ve hasMore, dönen nesneler kopyadır', async () => {
  const dir = tempDir()
  try {
    const store = await populated(dir)
    for (const id of range(1, 120)) store.addMessage(msg(id, 1))
    let page = store.listMessages(1)
    assert.deepEqual(ids(page.messages), range(71, 120))
    assert.equal(page.hasMore, true)
    page = store.listMessages(1, { before: 71 })
    assert.deepEqual(ids(page.messages), range(21, 70))
    assert.equal(page.hasMore, true)
    page = store.listMessages(1, { before: 21, limit: 50 })
    assert.deepEqual(ids(page.messages), range(1, 20))
    assert.equal(page.hasMore, false)
    assert.deepEqual(store.listMessages(1, { before: 1 }), { messages: [], hasMore: false })
    assert.deepEqual(ids(store.listMessages(1, { limit: 10 }).messages), range(111, 120))
    assert.deepEqual(ids(store.listMessages(1, { before: 1000 }).messages), range(71, 120))
    assert.equal(store.listMessages(1, { limit: 0 }).messages.length, 50)
    assert.equal(store.listMessages(1, { limit: 'x' }).messages.length, 50)
    assert.deepEqual(store.listMessages(99), { messages: [], hasMore: false })
    assert.deepEqual(store.listMessages('1'), { messages: [], hasMore: false })

    // dışarı verilen nesneler değiştirilse de depo etkilenmez
    page.messages[0].body = 'değişti'
    page.messages[0].uploads.push('x')
    store.getMessage(1).body = 'değişti'
    store.editMessage(2, 'e', 1).body = 'değişti'
    assert.equal(store.getMessage(1).body, 'zarf-1')
    assert.deepEqual(store.getMessage(1).uploads, [])
    assert.equal(store.getMessage(2).body, 'e')
    const input = msg(121, 1)
    store.addMessage(input)
    input.body = 'değişti'
    input.uploads.push(hexId(1))
    assert.deepEqual(store.getMessage(121), msg(121, 1))
    await store.close()
  } finally {
    removeDir(dir)
  }
})

test('around sayfası: hedefin etrafı, kenarlarda kayma, kanalda olmayan kimlikte konum, kopyalar', async () => {
  const dir = tempDir()
  try {
    const store = await populated(dir)
    // Kanal 1 tek, kanal 2 çift kimlikleri alır
    for (const id of range(1, 40)) store.addMessage(msg(id, id % 2 === 1 ? 1 : 2))
    let page = store.listAround(1, { around: 21, limit: 6 })
    assert.deepEqual(ids(page.messages), [15, 17, 19, 21, 23, 25])
    assert.equal(page.hasMore, true)
    assert.equal(page.hasNewer, true)
    // Tek limitte eski taraf aşağı yuvarlanır
    assert.deepEqual(ids(store.listAround(1, { around: 21, limit: 5 }).messages), [17, 19, 21, 23, 25])
    assert.deepEqual(ids(store.listAround(1, { around: 21, limit: 1 }).messages), [21])
    // Başa ve sona yakın
    page = store.listAround(1, { around: 3, limit: 6 })
    assert.deepEqual(ids(page.messages), [1, 3, 5, 7, 9, 11])
    assert.deepEqual([page.hasMore, page.hasNewer], [false, true])
    page = store.listAround(1, { around: 37, limit: 6 })
    assert.deepEqual(ids(page.messages), [29, 31, 33, 35, 37, 39])
    assert.deepEqual([page.hasMore, page.hasNewer], [true, false])
    // Başka kanalın kimliği: kimliği ondan büyük ilk mesajın konumu
    assert.deepEqual(ids(store.listAround(1, { around: 22, limit: 4 }).messages), [19, 21, 23, 25])
    // Silinmiş kimlik
    store.deleteMessage(21)
    assert.deepEqual(ids(store.listAround(1, { around: 21, limit: 4 }).messages), [17, 19, 23, 25])
    page = store.listAround(1, { around: 21, limit: 1000 })
    assert.equal(page.messages.length, 19)
    assert.deepEqual([page.hasMore, page.hasNewer], [false, false])
    // Uçlar ve geçersiz seçenekler (around yoksa son sayfa, geçersiz limit varsayılan 50)
    page = store.listAround(1, { around: 0, limit: 3 })
    assert.deepEqual(ids(page.messages), [1, 3, 5])
    assert.deepEqual([page.hasMore, page.hasNewer], [false, true])
    page = store.listAround(1, { around: 1e9, limit: 3 })
    assert.deepEqual(ids(page.messages), [35, 37, 39])
    assert.deepEqual([page.hasMore, page.hasNewer], [true, false])
    assert.deepEqual(ids(store.listAround(1, { limit: 2 }).messages), [37, 39])
    assert.deepEqual(ids(store.listAround(1, { around: 'x', limit: 2 }).messages), [37, 39])
    assert.deepEqual(ids(store.listAround(1, { around: NaN, limit: 2 }).messages), [37, 39])
    assert.equal(store.listAround(1, { around: 21, limit: 0 }).messages.length, 19)
    assert.equal(store.listAround(1, { around: 21, limit: 'x' }).messages.length, 19)
    assert.equal(store.listAround(1).messages.length, 19)
    assert.deepEqual(store.listAround(99, { around: 1 }), { messages: [], hasMore: false, hasNewer: false })
    assert.deepEqual(store.listAround('1', { around: 1 }), { messages: [], hasMore: false, hasNewer: false })
    // Dışarı verilen nesneler kopyadır
    page = store.listAround(1, { around: 23, limit: 1 })
    page.messages[0].body = 'değişti'
    page.messages[0].uploads.push('x')
    assert.deepEqual(store.getMessage(23), msg(23, 1))
    await store.close()
  } finally {
    removeDir(dir)
  }
})

test('kanal mesajlarının toplu silinmesi dosyayı da siler', async () => {
  const dir = tempDir()
  const file1 = path.join(dir, 'messages', '1.jsonl')
  try {
    const store = await populated(dir)
    store.addMessage(msg(1, 1))
    store.addMessage(msg(2, 1, { uploads: [hexId(3)] }))
    store.addMessage(msg(3, 1))
    store.addMessage(msg(4, 2))
    await store.flush()
    assert.ok(fs.existsSync(file1))

    const removed = store.deleteChannelMessages(1)
    assert.deepEqual(ids(removed), [1, 2, 3])
    assert.deepEqual(removed[1].uploads, [hexId(3)])
    assert.deepEqual(store.listMessages(1), { messages: [], hasMore: false })
    assert.equal(store.getMessage(2), null)
    assert.equal(store.getMessage(4).id, 4)
    assert.deepEqual(store.deleteChannelMessages(42), [])
    await store.flush()
    assert.equal(fs.existsSync(file1), false)

    // silme sürerken eklenen mesajlar korunur
    for (const id of range(10, 60)) store.addMessage(msg(id, 3))
    store.deleteChannelMessages(3)
    store.addMessage(msg(61, 3))
    store.addMessage(msg(5, 1))
    await store.close()

    const reopened = await openStore({ dir, log: makeLog() })
    assert.deepEqual(ids(reopened.listMessages(1).messages), [5])
    assert.deepEqual(ids(reopened.listMessages(2).messages), [4])
    assert.deepEqual(ids(reopened.listMessages(3).messages), [61])
    await reopened.close()
  } finally {
    removeDir(dir)
  }
})

test('geçersiz mesajlar ve yinelenen id reddedilir, fazladan alanlar saklanmaz', async () => {
  const dir = tempDir()
  try {
    const store = await populated(dir)
    const invalid = [
      null,
      'x',
      msg('1', 1),
      msg(1.5, 1),
      msg(-1, 1),
      msg(1, -1),
      msg(1, '1'),
      msg(1, 1, { authorId: null }),
      msg(1, 1, { body: 5 }),
      msg(1, 1, { createdAt: Number.NaN }),
      msg(1, 1, { editedAt: 'dün' }),
      msg(1, 1, { uploads: 'abc' }),
      msg(1, 1, { uploads: ['../x'] }),
      msg(1, 1, { uploads: [hexId(0xabc).toUpperCase()] })
    ]
    for (const value of invalid) assert.throws(() => store.addMessage(value), TypeError)
    assert.deepEqual(store.listMessages(1).messages, [])

    store.addMessage(msg(1, 1, { extra: 'saklanmamalı', editedAt: undefined, uploads: undefined }))
    assert.deepEqual(store.getMessage(1), msg(1, 1))
    assert.throws(() => store.addMessage(msg(1, 2)), isCode('duplicate_id'))
    assert.equal(store.editMessage(999, 'x', 1), null)
    assert.equal(store.editMessage('1', 'x', 1), null)
    assert.throws(() => store.editMessage(1, 5, 1), TypeError)
    assert.throws(() => store.editMessage(1, 'x', 'dün'), TypeError)
    assert.equal(store.deleteMessage(999), null)
    assert.equal(store.deleteMessage('1'), null)
    assert.equal(store.getMessage('1'), null)
    assert.equal(store.getMessage(1).id, 1)
    await store.close()
  } finally {
    removeDir(dir)
  }
})

test('kapatma: bekleyenler yazılır, kilit bırakılır, sonraki yazımlar reddedilir', async () => {
  const dir = tempDir()
  try {
    const store = await populated(dir)
    store.addMessage(msg(1, 1))
    store.state.serverName = 'Kapanış'
    store.saveState()
    const closing = store.close()
    assert.equal(store.close(), closing)
    assert.throws(() => store.addMessage(msg(2, 1)), isCode('closed'))
    await closing
    assert.equal(readJson(path.join(dir, 'state.json')).serverName, 'Kapanış')
    assert.equal(nonEmptyLines(path.join(dir, 'messages', '1.jsonl')).length, 1)
    assert.equal(fs.existsSync(path.join(dir, '.kilit')), false)
    assert.throws(() => store.addMessage(msg(2, 1)), isCode('closed'))
    assert.throws(() => store.editMessage(1, 'x', 1), isCode('closed'))
    assert.throws(() => store.deleteMessage(1), isCode('closed'))
    assert.throws(() => store.deleteChannelMessages(1), isCode('closed'))
    assert.throws(() => store.createUploadWriteStream(hexId(1)), isCode('closed'))
    await assert.rejects(store.writeUpload(hexId(1), Buffer.from('x')), isCode('closed'))
    store.saveState()
    await store.flush()
  } finally {
    removeDir(dir)
  }
})

test('flush çağrı anına kadarki tüm kuyrukları gerçekten bekler', async () => {
  const dir = tempDir()
  const restore = patchFs('appendFile', (original) => async function (file, data, options) {
    await sleep(15)
    return original.call(this, file, data, options)
  })
  try {
    const store = await populated(dir)
    for (const id of range(1, 400)) store.addMessage(msg(id, 1 + (id % 4)))
    store.editMessage(10, 'e', 1)
    store.deleteMessage(11)
    await store.flush()
    let total = 0
    for (const ch of [1, 2, 3, 4]) total += nonEmptyLines(path.join(dir, 'messages', ch + '.jsonl')).length
    assert.equal(total, 402)
    assert.ok(fs.existsSync(path.join(dir, 'state.json')))
    await store.close()
  } finally {
    restore()
    removeDir(dir)
  }
})

test('ekleme hatası: satırlar korunur, yeniden denenir, yarım yazım sonraki satırı bozmaz', async () => {
  const dir = tempDir()
  try {
    const log = makeLog()
    const store = await openStore({ dir, log })
    store.initState({})
    await store.flush()

    let failNext = true
    let restore = patchFs('appendFile', (original) => async function (file, data, options) {
      if (failNext) {
        failNext = false
        await original.call(this, file, String(data).slice(0, 20), options)
        const err = new Error('disk dolu')
        err.code = 'ENOSPC'
        throw err
      }
      return original.call(this, file, data, options)
    })
    try {
      store.addMessage(msg(1, 1))
      await assert.rejects(store.flush(), isCode('write_failed'))
      assert.ok(log.lines.error.some((line) => line.includes('ENOSPC')))
      await store.flush()
    } finally {
      restore()
    }

    // sürekli hata: veri bellekte kalır, düzelince yazılır
    restore = patchFs('appendFile', () => async function () {
      const err = new Error('G/Ç hatası')
      err.code = 'EIO'
      throw err
    })
    try {
      store.addMessage(msg(2, 1))
      await assert.rejects(store.flush(), isCode('write_failed'))
      assert.deepEqual(ids(store.listMessages(1).messages), [1, 2])
    } finally {
      restore()
    }
    await store.flush()
    store.addMessage(msg(3, 1))
    await store.close()

    const reopened = await openStore({ dir, log: makeLog() })
    assert.deepEqual(ids(reopened.listMessages(1).messages), [1, 2, 3])
    await reopened.close()
  } finally {
    removeDir(dir)
  }
})

test('yükleme yolları yalnızca 32 haneli küçük harf hex kimlik kabul eder', async () => {
  const dir = tempDir()
  try {
    const store = await populated(dir)
    const valid = hexId(255)
    assert.equal(store.uploadPath(valid), path.join(dir, 'uploads', valid + '.bin'))
    const bad = [
      '',
      'abc',
      'A'.repeat(32),
      'g'.repeat(32),
      'a'.repeat(31),
      'a'.repeat(33),
      'a'.repeat(32) + '\n',
      '\n' + 'a'.repeat(32),
      '../' + 'a'.repeat(29),
      '..\\' + 'a'.repeat(29),
      'a'.repeat(16) + '/' + 'a'.repeat(15),
      'a'.repeat(16) + '\\' + 'a'.repeat(15),
      '/etc/passwd',
      'C:\\Windows\\win.ini',
      'a'.repeat(31) + '.',
      ' ' + 'a'.repeat(31),
      'a'.repeat(32) + '.bin',
      'a'.repeat(31) + '\u0000',
      '\uff41'.repeat(32),
      null,
      undefined,
      123,
      Array.of('a'.repeat(32)),
      { toString () { return 'a'.repeat(32) } },
      Buffer.from('a'.repeat(32))
    ]
    const isBad = isCode('bad_upload_id')
    for (const value of bad) {
      assert.throws(() => store.uploadPath(value), isBad)
      assert.throws(() => store.createUploadWriteStream(value), isBad)
      await assert.rejects(store.writeUpload(value, Buffer.from('x')), isBad)
      await assert.rejects(store.removeUpload(value), isBad)
      await assert.rejects(store.commitUpload(value), isBad)
      await assert.rejects(store.discardUpload(value), isBad)
    }
    assert.deepEqual(fs.readdirSync(path.join(dir, 'uploads')), [])
    assert.deepEqual(fs.readdirSync(dir).sort(), ['.kilit', 'messages', 'uploads'])
    await store.close()
  } finally {
    removeDir(dir)
  }
})

test('writeUpload, removeUpload ve uploadsBytes', async () => {
  const dir = tempDir()
  try {
    const store = await openStore({ dir, log: makeLog() })
    assert.equal(store.uploadsBytes(), 0)
    store.initState({})
    const id = hexId(1)
    const file = store.uploadPath(id)
    await store.writeUpload(id, Buffer.from([1, 2, 3]))
    assert.deepEqual(fs.readFileSync(file), Buffer.from([1, 2, 3]))
    await store.writeUpload(hexId(2), new Uint8Array([9]))
    assert.deepEqual(fs.readFileSync(store.uploadPath(hexId(2))), Buffer.from([9]))

    // var olan yüklemenin üzerine yazılmaz
    await assert.rejects(store.writeUpload(id, Buffer.from('başka')), isCode('upload_exists'))
    assert.deepEqual(fs.readFileSync(file), Buffer.from([1, 2, 3]))
    await assert.rejects(store.writeUpload(hexId(3), 'metin'), TypeError)
    assert.deepEqual(fs.readdirSync(path.join(dir, 'uploads')).sort(), [hexId(1) + '.bin', hexId(2) + '.bin'])

    await store.removeUpload(id)
    assert.equal(fs.existsSync(file), false)
    await store.removeUpload(id)
    await store.removeUpload(hexId(77))

    store.state.uploads.push(
      { id: hexId(1), size: 10, uploaderId: 1, createdAt: 1, messageId: null },
      { id: hexId(2), size: 5, uploaderId: 1, createdAt: 1, messageId: null },
      { id: hexId(3), size: 'x' },
      { id: hexId(4), size: -3 },
      { id: hexId(5), size: Number.NaN }
    )
    assert.equal(store.uploadsBytes(), 15)
    await store.close()
  } finally {
    removeDir(dir)
  }
})

test('akışla yükleme: .tmp dosyasına yazılır, commitUpload ile .bin olur', async () => {
  const dir = tempDir()
  try {
    const store = await populated(dir)
    const id = hexId(10)
    const tmp = path.join(dir, 'uploads', id + '.tmp')
    const ws = store.createUploadWriteStream(id)
    assert.throws(() => store.createUploadWriteStream(id), isCode('upload_busy'))
    await assert.rejects(store.writeUpload(id, Buffer.from('x')), isCode('upload_busy'))
    await pipeline(Readable.from([Buffer.alloc(1000, 7), Buffer.alloc(24, 8)]), ws)
    assert.ok(fs.existsSync(tmp))
    assert.equal(fs.existsSync(store.uploadPath(id)), false)

    const size = await store.commitUpload(id)
    assert.equal(size, 1024)
    assert.equal(fs.existsSync(tmp), false)
    const data = fs.readFileSync(store.uploadPath(id))
    assert.equal(data.length, 1024)
    assert.equal(data[0], 7)
    assert.equal(data[1023], 8)
    await assert.rejects(store.commitUpload(id), isCode('upload_missing'))

    // aynı kimlikle ikinci yükleme var olanı ezmez
    const again = store.createUploadWriteStream(id)
    again.end(Buffer.from('ezme'))
    await assert.rejects(store.commitUpload(id), isCode('upload_exists'))
    assert.equal(fs.existsSync(tmp), false)
    assert.equal(fs.readFileSync(store.uploadPath(id)).length, 1024)
    await store.close()
  } finally {
    removeDir(dir)
  }
})

test('akışla yükleme iptali ve hatası geçici dosyayı siler', async () => {
  const dir = tempDir()
  try {
    const store = await populated(dir)
    const id = hexId(20)
    const tmp = path.join(dir, 'uploads', id + '.tmp')
    const ws = store.createUploadWriteStream(id)
    ws.write(Buffer.alloc(100, 1))
    await waitFor(() => fs.existsSync(tmp), 5000)
    await assert.rejects(store.commitUpload(id), isCode('upload_unfinished'))
    await store.discardUpload(id)
    assert.equal(fs.existsSync(tmp), false)
    assert.equal(fs.existsSync(store.uploadPath(id)), false)
    await store.discardUpload(id)

    // akış hatası: commit hatayı bildirir ve geçici dosyayı temizler
    const id2 = hexId(21)
    const ws2 = store.createUploadWriteStream(id2)
    ws2.write(Buffer.from('yarım'))
    const closed = new Promise((resolve) => ws2.once('close', resolve))
    ws2.destroy(new Error('bağlantı kesildi'))
    await closed
    await assert.rejects(store.commitUpload(id2), /bağlantı kesildi/)
    assert.equal(fs.existsSync(path.join(dir, 'uploads', id2 + '.tmp')), false)
    assert.equal(fs.existsSync(store.uploadPath(id2)), false)

    // kapatma etkin akışları iptal eder
    const id3 = hexId(22)
    const ws3 = store.createUploadWriteStream(id3)
    ws3.write(Buffer.from('kapanış'))
    await waitFor(() => fs.existsSync(path.join(dir, 'uploads', id3 + '.tmp')), 5000)
    await store.close()
    assert.equal(fs.existsSync(path.join(dir, 'uploads', id3 + '.tmp')), false)
    assert.deepEqual(fs.readdirSync(path.join(dir, 'uploads')), [])
    assert.ok(ws.destroyed)
  } finally {
    removeDir(dir)
  }
})

test('açılışta yarım kalmış geçici dosyalar silinir', async () => {
  const dir = tempDir()
  try {
    const store = await populated(dir)
    store.addMessage(msg(1, 1))
    await store.writeUpload(hexId(5), Buffer.from('kalıcı'))
    store.state.uploads.push({ id: hexId(5), size: 6, uploaderId: 1, createdAt: 1, messageId: null })
    store.saveState()
    await store.close()

    fs.writeFileSync(path.join(dir, 'uploads', hexId(6) + '.tmp'), 'yarım')
    fs.writeFileSync(path.join(dir, 'uploads', 'baska.tmp'), 'yarım')
    fs.writeFileSync(path.join(dir, 'messages', '1.jsonl.tmp'), 'yarım sıkıştırma')
    const log = makeLog()
    const reopened = await openStore({ dir, log })
    assert.deepEqual(fs.readdirSync(path.join(dir, 'uploads')), [hexId(5) + '.bin'])
    assert.deepEqual(fs.readdirSync(path.join(dir, 'messages')), ['1.jsonl'])
    assert.ok(log.lines.info.some((line) => line.includes('2 yükleme')))
    assert.deepEqual(ids(reopened.listMessages(1).messages), [1])
    await reopened.close()
  } finally {
    removeDir(dir)
  }
})

test('açılış uzlaştırması: sayaçlar ve yükleme kayıtları diskteki mesajlarla eşitlenir', async () => {
  const dir = tempDir()
  const A = hexId(0xa)
  const B = hexId(0xb)
  const C = hexId(0xc)
  const D = hexId(0xd)
  const E = hexId(0xe)
  const F = hexId(0xf)
  try {
    const store = await populated(dir)
    for (const id of [A, B, C, D, E, F]) await store.writeUpload(id, Buffer.from('şifreli-' + id))
    store.state.uploads.push(
      { id: A, size: 41, uploaderId: 1, createdAt: 1, messageId: null },
      { id: B, size: 41, uploaderId: 1, createdAt: 1, messageId: 77 },
      { id: D, size: 41, uploaderId: 1, createdAt: 1, messageId: null },
      { id: F, size: 41, uploaderId: 1, createdAt: 1, messageId: 'beklenmeyen' }
    )
    store.saveState()
    store.addMessage(msg(1, 3, { uploads: [A] }))
    store.addMessage(msg(2, 3, { uploads: [E], authorId: 7 }))
    await store.close()

    const log = makeLog()
    const reopened = await openStore({ dir, log })
    const st = reopened.state
    assert.equal(st.counters.message, 2)
    assert.equal(st.counters.channel, 3)
    const byId = new Map(st.uploads.map((rec) => [rec.id, rec]))
    assert.equal(byId.get(A).messageId, 1)
    assert.equal(byId.has(B), false)
    assert.equal(byId.get(D).messageId, null)
    assert.deepEqual(byId.get(E), { id: E, size: Buffer.byteLength('şifreli-' + E), uploaderId: 7, createdAt: msg(2, 3).createdAt, messageId: 2 })
    assert.equal(byId.has(C), false)
    assert.equal(byId.get(F).messageId, 'beklenmeyen')
    assert.deepEqual(fs.readdirSync(path.join(dir, 'uploads')).sort(), [A + '.bin', D + '.bin', E + '.bin', F + '.bin'])
    assert.ok(log.lines.warn.length > 0)
    await reopened.close()

    // uzlaştırma diske yazılmıştır, tekrar açılışta değişiklik olmaz
    const disk = readJson(path.join(dir, 'state.json'))
    assert.equal(disk.counters.message, 2)
    assert.equal(disk.uploads.length, 4)
    const log2 = makeLog()
    const third = await openStore({ dir, log: log2 })
    assert.deepEqual(third.state, disk)
    assert.deepEqual(log2.lines.warn, [])
    await third.close()
  } finally {
    removeDir(dir)
  }
})

test('durumda hiç yükleme kaydı yoksa yükleme dosyalarına dokunulmaz', async () => {
  const dir = tempDir()
  try {
    const store = await populated(dir)
    await store.writeUpload(hexId(1), Buffer.from('a'))
    await store.writeUpload(hexId(2), Buffer.from('b'))
    await store.close()
    const reopened = await openStore({ dir, log: makeLog() })
    assert.deepEqual(reopened.state.uploads, [])
    assert.deepEqual(fs.readdirSync(path.join(dir, 'uploads')).sort(), [hexId(1) + '.bin', hexId(2) + '.bin'])
    await reopened.close()
  } finally {
    removeDir(dir)
  }
})

test('initState diskte kalmış mesajlarla id çakışmasını önler', async () => {
  const dir = tempDir()
  try {
    const store = await populated(dir)
    store.addMessage(msg(9, 4))
    await store.close()
    fs.rmSync(path.join(dir, 'state.json'))
    fs.rmSync(path.join(dir, 'state.json.bak'), { force: true })

    const fresh = await openStore({ dir, log: makeLog() })
    assert.equal(fresh.state, null)
    const st = fresh.initState({})
    assert.equal(st.counters.message, 9)
    assert.equal(st.counters.channel, 4)
    await fresh.close()
  } finally {
    removeDir(dir)
  }
})

test('klasör ve dosya izinleri yalnızca sahibine açıktır', { skip: IS_WINDOWS }, async () => {
  const dir = path.join(tempDir(), 'veri')
  try {
    const store = await populated(dir)
    store.addMessage(msg(1, 1))
    await store.writeUpload(hexId(1), Buffer.from('x'))
    await store.flush()
    const mode = (file) => fs.statSync(file).mode & 0o777
    assert.equal(mode(dir), 0o700)
    assert.equal(mode(path.join(dir, 'messages')), 0o700)
    assert.equal(mode(path.join(dir, 'uploads')), 0o700)
    assert.equal(mode(path.join(dir, 'state.json')), 0o600)
    assert.equal(mode(path.join(dir, '.kilit')), 0o600)
    assert.equal(mode(path.join(dir, 'messages', '1.jsonl')), 0o600)
    assert.equal(mode(store.uploadPath(hexId(1))), 0o600)
    await store.close()
  } finally {
    removeDir(path.dirname(dir))
  }
})
