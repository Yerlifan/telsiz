'use strict'

// server.js: sifre-sifirla komutu, kilit dosyası, bozuk veri, ortam değişkenleri,
// banner ve bağlantı noktası hataları. Süreçler doğrudan node ile başlatılır (kabuk yok).

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const h = require('./server-yardimci')

const SERVER_JS = path.join(__dirname, '..', 'server.js')
const DEAD_PID = '2147483646'

const CONFIG_KEYS = ['PORT', 'HOST', 'SUNUCU_ADI', 'VERI_KLASORU', 'MAKS_YUKLEME_MB', 'YUKLEME_KOTASI_MB',
  'STUN_URL', 'TURN_URL', 'TURN_KULLANICI', 'TURN_SIFRE']

// Komutu çalıştırır, çıkışı ve çıktıları döner. Testi çalıştıranın ayarları alt sürece geçmez.
function runServerJs (args, env, opts) {
  const o = opts || {}
  const childEnv = Object.assign({}, process.env)
  for (const key of CONFIG_KEYS) delete childEnv[key]
  Object.assign(childEnv, env)
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_JS].concat(args), {
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      stdout += d
      if (o.onStdout) o.onStdout(stdout, child)
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('süreç zaman aşımına uğradı: ' + stdout + stderr))
    }, o.timeout || 20000)
    child.on('error', reject)
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

async function preparedData () {
  const ctx = await h.startServer()
  const owner = await h.setupOwner(ctx)
  const ayse = await h.addUser(ctx, owner.token, 'Ayşe Yılmaz')
  await ctx.stop()
  return { ctx, owner, ayse }
}

function freePort () {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

describe('sifre-sifirla komutu', () => {
  it('geçici parola üretir, oturumları siler, yeni parola çalışır', async () => {
    const { ctx, owner, ayse } = await preparedData()
    try {
      const statePath = path.join(ctx.dataDir, 'state.json')
      const result = await runServerJs(['sifre-sifirla', 'ayşe', 'YILMAZ'], { VERI_KLASORU: ctx.dataDir })
      assert.equal(result.code, 0, result.stderr)
      const match = /Geçici parola: ([A-Za-z0-9]{12})/.exec(result.stdout)
      assert.ok(match, result.stdout)
      assert.match(result.stdout, /"Ayşe Yılmaz" hesabının parolası sıfırlandı/)
      assert.ok(!fs.existsSync(path.join(ctx.dataDir, '.kilit')))
      const disk = JSON.parse(fs.readFileSync(statePath, 'utf8'))
      assert.ok(!disk.sessions.some((s) => s.userId === ayse.user.id))
      assert.ok(disk.sessions.some((s) => s.userId === owner.user.id))
      assert.ok(!fs.readFileSync(statePath, 'utf8').includes(match[1]))

      const next = await h.startServer({}, ctx.root)
      try {
        h.expectStatus(await h.get(next, '/api/state', ayse.token), 401, 'invalid_token')
        h.expectStatus(await h.get(next, '/api/state', owner.token), 200)
        h.expectStatus(await h.login(next, 'Ayşe Yılmaz'), 401)
        h.expectStatus(await h.login(next, 'Ayşe Yılmaz', match[1]), 200)
      } finally {
        await next.stop()
      }
    } finally {
      h.removeRoot(ctx.root)
    }
  })

  it('kullanıcı yoksa veya ad verilmezse çıkış kodu 1', async () => {
    const { ctx } = await preparedData()
    try {
      const before = fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8')
      const missing = await runServerJs(['sifre-sifirla', 'Hayalet'], { VERI_KLASORU: ctx.dataDir })
      assert.equal(missing.code, 1)
      assert.match(missing.stderr, /"Hayalet" adlı kullanıcı bulunamadı/)
      const noName = await runServerJs(['sifre-sifirla'], { VERI_KLASORU: ctx.dataDir })
      assert.equal(noName.code, 1)
      assert.match(noName.stderr, /Kullanım: node server.js sifre-sifirla/)
      const unknown = await runServerJs(['bilinmeyen-komut'], { VERI_KLASORU: ctx.dataDir })
      assert.equal(unknown.code, 1)
      assert.equal(fs.readFileSync(path.join(ctx.dataDir, 'state.json'), 'utf8'), before)
      assert.ok(!fs.existsSync(path.join(ctx.dataDir, '.kilit')))
    } finally {
      h.removeRoot(ctx.root)
    }
  })

  it('canlı kilit varsa reddeder, eski kilit dosyasını yok sayar', async () => {
    const { ctx } = await preparedData()
    try {
      const lockPath = path.join(ctx.dataDir, '.kilit')
      const statePath = path.join(ctx.dataDir, 'state.json')
      const before = fs.readFileSync(statePath, 'utf8')
      // Bu test sürecinin PID'i canlıdır, çalışan bir sunucu gibi davranır
      fs.writeFileSync(lockPath, process.pid + '\n')
      const refused = await runServerJs(['sifre-sifirla', 'Sahip'], { VERI_KLASORU: ctx.dataDir })
      assert.equal(refused.code, 1)
      assert.match(refused.stderr, /Sunucu şu anda çalışıyor \(PID \d+\)/)
      assert.match(refused.stderr, /ezer/)
      assert.equal(fs.readFileSync(statePath, 'utf8'), before)
      assert.equal(fs.readFileSync(lockPath, 'utf8'), process.pid + '\n')

      fs.writeFileSync(lockPath, DEAD_PID + '\n')
      const ok = await runServerJs(['sifre-sifirla', 'Sahip'], { VERI_KLASORU: ctx.dataDir })
      assert.equal(ok.code, 0, ok.stderr)
      assert.match(ok.stdout, /Geçici parola: /)
      assert.ok(!fs.existsSync(lockPath))
    } finally {
      h.removeRoot(ctx.root)
    }
  })

  it('veri klasörü yoksa hiçbir şey oluşturmadan çıkış kodu 1', async () => {
    const root = h.makeRoot()
    try {
      const dataDir = path.join(root, 'yok')
      const result = await runServerJs(['sifre-sifirla', 'Sahip'], { VERI_KLASORU: dataDir })
      assert.equal(result.code, 1)
      assert.match(result.stderr, /kayıtlı hesap bulunamadı/)
      assert.ok(!fs.existsSync(dataDir))
    } finally {
      h.removeRoot(root)
    }
  })
})

describe('server.js başlatma', () => {
  it('bozuk veri dosyasında Türkçe hata, çıkış kodu 1, veri ezilmez', async () => {
    const root = h.makeRoot()
    try {
      const dataDir = path.join(root, 'veri')
      fs.mkdirSync(dataDir, { recursive: true })
      fs.writeFileSync(path.join(dataDir, 'state.json'), '{bozuk')
      const port = await freePort()
      const result = await runServerJs([], { VERI_KLASORU: dataDir, PORT: String(port), HOST: '127.0.0.1' })
      assert.equal(result.code, 1)
      assert.match(result.stderr, /Veri dosyası bozuk/)
      assert.equal(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'), '{bozuk')
      assert.deepEqual(fs.readdirSync(dataDir), ['state.json'])
    } finally {
      h.removeRoot(root)
    }
  })

  it('geçersiz ortam değişkenlerinde Türkçe hata', async () => {
    const root = h.makeRoot()
    try {
      const dataDir = path.join(root, 'veri')
      const cases = [
        { env: { PORT: 'abc' }, pattern: /PORT değeri geçersiz/ },
        { env: { PORT: '70000' }, pattern: /PORT değeri geçersiz/ },
        { env: { MAKS_YUKLEME_MB: '-3' }, pattern: /MAKS_YUKLEME_MB değeri geçersiz/ },
        { env: { SUNUCU_ADI: 'x'.repeat(41) }, pattern: /SUNUCU_ADI değeri geçersiz/ },
        { env: { TURN_URL: 'http://kotu' }, pattern: /TURN_URL değeri geçersiz/ },
        { env: { STUN_URL: 'turn:yanlis' }, pattern: /STUN_URL değeri geçersiz/ }
      ]
      for (const { env, pattern } of cases) {
        const result = await runServerJs([], Object.assign({ VERI_KLASORU: dataDir }, env))
        assert.equal(result.code, 1, JSON.stringify(env))
        assert.match(result.stderr, pattern)
      }
      assert.ok(!fs.existsSync(dataDir))
    } finally {
      h.removeRoot(root)
    }
  })

  it('banner, kurulum kodu ve çalışan sunucu', async () => {
    const root = h.makeRoot()
    try {
      const dataDir = path.join(root, 'veri')
      const port = await freePort()
      let infoStatus = null
      let infoBody = null
      const result = await runServerJs([], {
        VERI_KLASORU: dataDir,
        PORT: String(port),
        HOST: '127.0.0.1',
        SUNUCU_ADI: 'Kankalar',
        TURN_URL: 'turn:turn.example.org:3478',
        TURN_KULLANICI: 'kullanici',
        TURN_SIFRE: 'gizli-turn'
      }, {
        onStdout: (out, child) => {
          if (infoStatus !== null || !out.includes('Ctrl+C')) return
          infoStatus = 'bekleniyor'
          h.request({ port }, 'GET', '/api/info').then((res) => {
            infoStatus = res.status
            infoBody = res.data
            child.kill('SIGTERM')
          }, (err) => {
            infoStatus = String(err)
            child.kill('SIGTERM')
          })
        }
      })
      assert.match(result.stdout, /^Telsiz sunucusu çalışıyor\./)
      assert.match(result.stdout, /Sunucu adı: Kankalar/)
      assert.match(result.stdout, /Kurulum kodu: [0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}\. Tarayıcıda açıp sahip hesabını bu kodla oluşturun\./)
      assert.ok(result.stdout.includes('Veri klasörü: ' + dataDir))
      assert.ok(result.stdout.includes('http://127.0.0.1:' + port))
      assert.match(result.stdout, /https/)
      assert.match(result.stdout, /tunel\.bat/)
      assert.match(result.stdout, /TURN sunucusu: etkin/)
      assert.ok(!result.stdout.includes('gizli-turn'))
      assert.equal(infoStatus, 200)
      assert.equal(infoBody.serverName, 'Kankalar')
      assert.equal(infoBody.setupRequired, true)
      assert.equal(infoBody.limits.uploadMaxBytes, 25 * 1024 * 1024 + 16)
      if (process.platform !== 'win32') {
        // Windows'ta SIGTERM süreci doğrudan sonlandırır, düzgün kapanış yalnızca POSIX'te denetlenir
        assert.equal(result.code, 0, result.stderr)
        assert.match(result.stdout, /Sunucu kapatıldı\./)
        assert.ok(!fs.existsSync(path.join(dataDir, '.kilit')))
        assert.ok(fs.existsSync(path.join(dataDir, 'state.json')))
      }
    } finally {
      h.removeRoot(root)
    }
  })

  it('bağlantı noktası kullanımdaysa Türkçe hata, kilit bırakılır', async () => {
    const root = h.makeRoot()
    const blocker = net.createServer()
    await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve))
    try {
      const dataDir = path.join(root, 'veri')
      const port = blocker.address().port
      const result = await runServerJs([], { VERI_KLASORU: dataDir, PORT: String(port), HOST: '127.0.0.1' })
      assert.equal(result.code, 1)
      assert.match(result.stderr, new RegExp(port + ' numaralı bağlantı noktası zaten kullanımda'))
      assert.ok(!fs.existsSync(path.join(dataDir, '.kilit')))
    } finally {
      await new Promise((resolve) => blocker.close(resolve))
      h.removeRoot(root)
    }
  })
})
