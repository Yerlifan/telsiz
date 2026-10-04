'use strict'

// server.js: sifre-sifirla ve reset-password komutları, kilit dosyası, bozuk veri, ortam
// değişkenleri ve İngilizce takma adları, konsol dili, banner ve bağlantı noktası hataları.
// Süreçler doğrudan node ile başlatılır (kabuk yok). Konsol dili testte açıkça verilmezse DIL=tr.

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const net = require('node:net')
const { spawn } = require('node:child_process')
const h = require('./server-yardimci')

const SERVER_JS = path.join(__dirname, '..', 'server.js')
const DEAD_PID = '2147483646'

const CONFIG_KEYS = ['PORT', 'HOST', 'SUNUCU_ADI', 'SERVER_NAME', 'VERI_KLASORU', 'DATA_DIR', 'MAKS_YUKLEME_MB',
  'MAX_UPLOAD_MB', 'YUKLEME_KOTASI_MB', 'UPLOAD_QUOTA_MB', 'KULLANICI_YUKLEME_KOTASI_MB', 'USER_UPLOAD_QUOTA_MB',
  'MAKS_TOPLAM_MESAJ', 'MAX_TOTAL_MESSAGES', 'STUN_URL', 'TURN_URL', 'TURN_KULLANICI', 'TURN_USERNAME',
  'TURN_SIFRE', 'TURN_PASSWORD', 'GUVENILIR_VEKIL', 'TRUSTED_PROXY', 'DIL', 'TELSIZ_LANG', 'LANG', 'LC_ALL', 'LC_MESSAGES']

// Komutu çalıştırır, çıkışı ve çıktıları döner. Testi çalıştıranın ayarları alt sürece geçmez.
// env içinde undefined verilen değişken alt süreçte hiç tanımlanmaz. opts.cwd: çalışma klasörü.
function runServerJs (args, env, opts) {
  const o = opts || {}
  const childEnv = Object.assign({}, process.env)
  for (const key of CONFIG_KEYS) delete childEnv[key]
  Object.assign(childEnv, { DIL: 'tr' }, env)
  for (const key of Object.keys(childEnv)) {
    if (childEnv[key] === undefined) delete childEnv[key]
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER_JS].concat(args), {
      env: childEnv,
      cwd: o.cwd || process.cwd(),
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
  const ayse = await h.addUser(ctx, owner.token, 'ayse.yilmaz')
  h.expectStatus(await h.post(ctx, '/api/me/identity', ayse.token, { identity: h.envelope() }), 200)
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
  it('geçici parola üretir, istemciyle aynı türetmeyi yapar, anahtarları siler, oturumları kapatır', async () => {
    const { ctx, owner, ayse } = await preparedData()
    try {
      const statePath = path.join(ctx.dataDir, 'state.json')
      const result = await runServerJs(['sifre-sifirla', 'AYSE.YILMAZ'], { VERI_KLASORU: ctx.dataDir })
      assert.equal(result.code, 0, result.stderr)
      const match = /Geçici parola: ([A-Za-z0-9]{12})/.exec(result.stdout)
      assert.ok(match, result.stdout)
      assert.match(result.stdout, /"ayse\.yilmaz" hesabının parolası sıfırlandı/)
      assert.match(result.stdout, /Eski özel mesajlar bu hesapla artık okunamaz/)
      assert.ok(!fs.existsSync(path.join(ctx.dataDir, '.kilit')))
      const text = fs.readFileSync(statePath, 'utf8')
      const disk = JSON.parse(text)
      assert.ok(!disk.sessions.some((s) => s.userId === ayse.user.id))
      assert.ok(disk.sessions.some((s) => s.userId === owner.user.id))
      assert.ok(!text.includes(match[1]))
      const user = disk.users.find((u) => u.id === ayse.user.id)
      assert.deepEqual([user.publicKey, user.wrappedKey, user.identity], [null, null, null])
      assert.notEqual(user.kdf.salt, h.KDF.salt)
      assert.deepEqual([user.kdf.N, user.kdf.r, user.kdf.p], [16384, 8, 1])
      // Sunucu tarafı karma, istemci türetmesinin (ortak test vektörüyle doğrulanmış) authKey değerine aittir
      const authKey = h.deriveKeys(match[1], user.kdf.salt, 16384).authKey
      assert.match(user.passHash, /^scrypt\$16384\$8\$1\$/)
      assert.ok(!text.includes(authKey))

      const next = await h.startServer({}, ctx.root)
      try {
        h.expectStatus(await h.get(next, '/api/state', ayse.token), 401, 'invalid_token')
        h.expectStatus(await h.get(next, '/api/state', owner.token), 200)
        h.expectStatus(await h.login(next, 'ayse.yilmaz'), 401)
        const relog = await h.request(next, 'POST', '/api/login', { body: { name: 'ayse.yilmaz', authKey } })
        h.expectStatus(relog, 200)
        assert.deepEqual(relog.data.keys, { publicKey: null, wrappedKey: null })
        h.expectStatus(await h.login(next, 'ayse.yilmaz', match[1]), 200)
      } finally {
        await next.stop()
      }
    } finally {
      h.removeRoot(ctx.root)
    }
  })

  it('İngilizce takma ad: reset-password', async () => {
    const { ctx } = await preparedData()
    try {
      const result = await runServerJs(['reset-password', 'sahip'], { VERI_KLASORU: ctx.dataDir })
      assert.equal(result.code, 0, result.stderr)
      const match = /Geçici parola: ([A-Za-z0-9]{12})/.exec(result.stdout)
      assert.ok(match, result.stdout)
      const next = await h.startServer({}, ctx.root)
      try {
        h.expectStatus(await h.login(next, 'sahip', match[1]), 200)
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
      const invalid = await runServerJs(['sifre-sifirla', 'Ayşe Yılmaz'], { VERI_KLASORU: ctx.dataDir })
      assert.equal(invalid.code, 1)
      assert.match(invalid.stderr, /adlı kullanıcı bulunamadı/)
      const noName = await runServerJs(['sifre-sifirla'], { VERI_KLASORU: ctx.dataDir })
      assert.equal(noName.code, 1)
      assert.match(noName.stderr, /Kullanım: node server.js sifre-sifirla/)
      const unknown = await runServerJs(['bilinmeyen-komut'], { VERI_KLASORU: ctx.dataDir })
      assert.equal(unknown.code, 1)
      // Depo kopyasında kullanım metni node server.js komutunu gösterir
      assert.match(unknown.stderr, /^Kullanım:$/m)
      assert.match(unknown.stderr, /^  node server\.js$/m)
      assert.match(unknown.stderr, /^  node server\.js sifre-sifirla <kullanıcı adı>$/m)
      assert.match(unknown.stderr, /^  node server\.js reset-password <kullanıcı adı>$/m)
      assert.match(unknown.stderr, /sunucu kapalıyken bir hesabın parolasını sıfırlar/)
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
      const refused = await runServerJs(['sifre-sifirla', 'sahip'], { VERI_KLASORU: ctx.dataDir })
      assert.equal(refused.code, 1)
      assert.match(refused.stderr, /Sunucu şu anda çalışıyor \(PID \d+\)/)
      assert.match(refused.stderr, /ezer/)
      assert.equal(fs.readFileSync(statePath, 'utf8'), before)
      assert.equal(fs.readFileSync(lockPath, 'utf8'), process.pid + '\n')

      fs.writeFileSync(lockPath, DEAD_PID + '\n')
      const ok = await runServerJs(['sifre-sifirla', 'sahip'], { VERI_KLASORU: ctx.dataDir })
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
      const result = await runServerJs(['sifre-sifirla', 'sahip'], { VERI_KLASORU: dataDir })
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
      // Depo kopyasında işletim sistemine uygun tünel betiği önerilir
      assert.ok(result.stdout.includes(process.platform === 'win32' ? 'tunel.bat' : 'tunel.sh'), result.stdout)
      assert.ok(result.stdout.includes('cloudflared tunnel --url http://localhost:' + port), result.stdout)
      assert.ok(result.stdout.includes('Sürüm: ' + require('../package.json').version), result.stdout)
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

// Sunucuyu başlatır, banner tamamlanınca /api/info ister ve SIGTERM ile durdurur
async function startAndStop (env, opts) {
  const port = await freePort()
  let info = null
  const result = await runServerJs([], Object.assign({ PORT: String(port), HOST: '127.0.0.1' }, env), {
    cwd: opts && opts.cwd,
    onStdout: (out, child) => {
      if (info !== null || !out.includes('Ctrl+C')) return
      info = 'bekleniyor'
      h.request({ port }, 'GET', '/api/info').then((res) => {
        info = res
        child.kill('SIGTERM')
      }, (err) => {
        info = String(err)
        child.kill('SIGTERM')
      })
    }
  })
  return { result, info, port }
}

describe('konsol dili ve İngilizce ortam değişkeni adları', () => {
  it('DIL=en ile banner, kurulum kodu ve kapanış İngilizce', async () => {
    const root = h.makeRoot()
    try {
      const dataDir = path.join(root, 'veri')
      const { result, info, port } = await startAndStop({ DIL: 'en', DATA_DIR: dataDir, SERVER_NAME: 'Friends' })
      assert.match(result.stdout, /^Telsiz server is running\./)
      assert.match(result.stdout, /Server name: Friends/)
      assert.ok(result.stdout.includes('Data folder: ' + dataDir))
      assert.match(result.stdout, /Setup code: [0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}\. Open the app in a browser/)
      assert.ok(result.stdout.includes('http://127.0.0.1:' + port))
      assert.match(result.stdout, /TURN server: not configured/)
      assert.match(result.stdout, /Press Ctrl\+C to stop the server\./)
      assert.ok(!/[çğıİöşüÇĞÖŞÜ]/.test(result.stdout), result.stdout)
      assert.equal(info.status, 200)
      assert.equal(info.data.serverName, 'Friends')
      // DATA_DIR kullanıldı: kilit ve veri bu klasörde
      assert.ok(fs.existsSync(dataDir))
      if (process.platform !== 'win32') {
        // Windows'ta SIGTERM süreci doğrudan sonlandırır, düzgün kapanış ve diske yazım yalnızca POSIX'te denetlenir
        assert.equal(result.code, 0, result.stderr)
        assert.match(result.stdout, /The server has stopped\./)
        // İlk kurulumdaki kanal adları da konsol dilinde
        const disk = JSON.parse(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'))
        assert.deepEqual(disk.channels.map((c) => c.name), ['general', 'gaming', 'Voice 1', 'Voice 2'])
      }
    } finally {
      h.removeRoot(root)
    }
  })

  it('DIL yoksa TELSIZ_LANG, ikisi de yoksa LC_ALL, LC_MESSAGES ve LANG sırasıyla', async () => {
    const root = h.makeRoot()
    try {
      const dataDir = path.join(root, 'veri')
      const cases = [
        { env: { DIL: undefined, TELSIZ_LANG: 'en' }, lang: 'en' },
        { env: { DIL: 'tr', TELSIZ_LANG: 'en' }, lang: 'tr' },
        { env: { DIL: 'en', TELSIZ_LANG: 'tr' }, lang: 'en' },
        { env: { DIL: undefined, LANG: 'tr_TR.UTF-8' }, lang: 'tr' },
        { env: { DIL: undefined, LANG: 'en_US.UTF-8' }, lang: 'en' },
        { env: { DIL: undefined, LC_ALL: 'en_GB.UTF-8', LANG: 'tr_TR.UTF-8' }, lang: 'en' },
        { env: { DIL: undefined, LC_MESSAGES: 'tr_TR.UTF-8', LANG: 'en_US.UTF-8' }, lang: 'tr' },
        { env: { DIL: 'de', LANG: 'tr_TR.UTF-8' }, lang: 'tr' }
      ]
      for (const { env, lang } of cases) {
        // Geçersiz bağlantı noktası hatası en hızlı biçimde konsol dilini gösterir
        const result = await runServerJs([], Object.assign({ VERI_KLASORU: dataDir, PORT: 'abc' }, env))
        assert.equal(result.code, 1, JSON.stringify(env))
        if (lang === 'tr') assert.match(result.stderr, /^Hata: PORT değeri geçersiz/, JSON.stringify(env))
        else assert.match(result.stderr, /^Error: PORT is invalid: "abc"\. Enter a number between 1 and 65535\./, JSON.stringify(env))
      }
      assert.ok(!fs.existsSync(dataDir))
    } finally {
      h.removeRoot(root)
    }
  })

  it('İngilizce takma adlar çalışır, ikisi birden verilirse Türkçe ad geçerlidir', async () => {
    const { readConfig } = require('../server.js')
    const english = readConfig({
      DIL: 'en',
      SERVER_NAME: 'Friends',
      DATA_DIR: path.join('a', 'b'),
      MAX_UPLOAD_MB: '5',
      UPLOAD_QUOTA_MB: '100',
      TURN_URL: 'turn:turn.example.org:3478',
      TURN_USERNAME: 'user',
      TURN_PASSWORD: 'secret',
      TRUSTED_PROXY: '10.0.0.5, loopback'
    })
    assert.equal(english.lang, 'en')
    assert.equal(english.serverName, 'Friends')
    assert.equal(english.dataDir, path.resolve('a', 'b'))
    assert.equal(english.uploadMaxBytes, 5 * 1024 * 1024 + 16)
    assert.equal(english.uploadQuotaBytes, 100 * 1024 * 1024)
    assert.deepEqual(english.iceServers[1], { urls: 'turn:turn.example.org:3478', username: 'user', credential: 'secret' })
    assert.deepEqual(english.trustedProxies, ['10.0.0.5', 'loopback'])

    const both = readConfig({
      DIL: 'tr',
      TELSIZ_LANG: 'en',
      SUNUCU_ADI: 'Kankalar',
      SERVER_NAME: 'Friends',
      VERI_KLASORU: path.join('tr', 'veri'),
      DATA_DIR: path.join('en', 'data'),
      MAKS_YUKLEME_MB: '3',
      MAX_UPLOAD_MB: '5',
      YUKLEME_KOTASI_MB: '50',
      UPLOAD_QUOTA_MB: '100',
      TURN_URL: 'turn:turn.example.org:3478',
      TURN_KULLANICI: 'kullanici',
      TURN_USERNAME: 'user',
      TURN_SIFRE: 'sifre',
      TURN_PASSWORD: 'secret',
      GUVENILIR_VEKIL: '192.0.2.1',
      TRUSTED_PROXY: '10.0.0.5'
    })
    assert.equal(both.lang, 'tr')
    assert.equal(both.serverName, 'Kankalar')
    assert.equal(both.dataDir, path.resolve('tr', 'veri'))
    assert.equal(both.uploadMaxBytes, 3 * 1024 * 1024 + 16)
    assert.equal(both.uploadQuotaBytes, 50 * 1024 * 1024)
    assert.deepEqual(both.iceServers[1], { urls: 'turn:turn.example.org:3478', username: 'kullanici', credential: 'sifre' })
    assert.deepEqual(both.trustedProxies, ['192.0.2.1'])

    // Boş Türkçe değer verilmemiş sayılır
    assert.equal(readConfig({ SUNUCU_ADI: '', SERVER_NAME: 'Friends' }).serverName, 'Friends')
    // Varsayılan güvenilir vekil loopback
    assert.deepEqual(readConfig({}).trustedProxies, ['loopback'])
    // Hata metninde kullanılan değişkenin adı geçer
    assert.throws(() => readConfig({ DIL: 'en', MAX_UPLOAD_MB: 'x' }), { message: /^MAX_UPLOAD_MB is invalid: "x"/ })
    assert.throws(() => readConfig({ DIL: 'tr', SERVER_NAME: 'x'.repeat(41) }), /SERVER_NAME değeri geçersiz/)
    assert.throws(() => readConfig({ DIL: 'en', UPLOAD_QUOTA_MB: '1', MAX_UPLOAD_MB: '5' }), /UPLOAD_QUOTA_MB cannot be smaller than MAX_UPLOAD_MB/)
    for (const bad of ['abc', '10.0.0.0/33', '::1/129', 'none, loopback', '1.2.3.4/x', '300.1.1.1']) {
      assert.throws(() => readConfig({ DIL: 'en', TRUSTED_PROXY: bad }), /TRUSTED_PROXY is invalid/, bad)
    }
    assert.throws(() => readConfig({ DIL: 'tr', GUVENILIR_VEKIL: 'kotu' }), /GUVENILIR_VEKIL değeri geçersiz/)
  })

  it('kullanıcı yükleme kotası ve toplam mesaj sınırı: varsayılanlar, takma adlar ve hatalı değerler', () => {
    const { readConfig } = require('../server.js')
    const MB = 1024 * 1024
    const defaults = readConfig({})
    assert.equal(defaults.userUploadQuotaBytes, 512 * MB)
    assert.equal(defaults.maxTotalMessages, 500000)
    // Verilmezse tek dosya sınırından küçük kalmaz
    assert.equal(readConfig({ MAKS_YUKLEME_MB: '1000', YUKLEME_KOTASI_MB: '4096' }).userUploadQuotaBytes, 1000 * MB + 16)

    const english = readConfig({ USER_UPLOAD_QUOTA_MB: '100', MAX_TOTAL_MESSAGES: '1234' })
    assert.equal(english.userUploadQuotaBytes, 100 * MB)
    assert.equal(english.maxTotalMessages, 1234)
    const both = readConfig({ KULLANICI_YUKLEME_KOTASI_MB: '50', USER_UPLOAD_QUOTA_MB: '100', MAKS_TOPLAM_MESAJ: '99', MAX_TOTAL_MESSAGES: '1234' })
    assert.equal(both.userUploadQuotaBytes, 50 * MB)
    assert.equal(both.maxTotalMessages, 99)

    assert.throws(() => readConfig({ DIL: 'en', USER_UPLOAD_QUOTA_MB: '10', MAX_UPLOAD_MB: '25' }), /USER_UPLOAD_QUOTA_MB cannot be smaller than MAX_UPLOAD_MB/)
    assert.throws(() => readConfig({ DIL: 'tr', KULLANICI_YUKLEME_KOTASI_MB: 'x' }), /KULLANICI_YUKLEME_KOTASI_MB değeri geçersiz/)
    for (const bad of ['0', '-5', '1.5', 'abc', '100000001']) {
      assert.throws(() => readConfig({ DIL: 'en', MAX_TOTAL_MESSAGES: bad }), { message: new RegExp('^MAX_TOTAL_MESSAGES is invalid: "' + bad.replace('.', '\\.') + '"') }, bad)
    }
    assert.throws(() => readConfig({ DIL: 'tr', MAKS_TOPLAM_MESAJ: '0' }), /MAKS_TOPLAM_MESAJ değeri geçersiz: "0"\. 1 ile 100000000 arasında bir tam sayı girin\./)
  })

  it('reset-password İngilizce konsolda, DATA_DIR takma adıyla', async () => {
    const { ctx } = await preparedData()
    try {
      const result = await runServerJs(['reset-password', 'ayse.yilmaz'], { DIL: 'en', DATA_DIR: ctx.dataDir })
      assert.equal(result.code, 0, result.stderr)
      const match = /Temporary password: ([A-Za-z0-9]{12})/.exec(result.stdout)
      assert.ok(match, result.stdout)
      assert.match(result.stdout, /The password of the account "ayse\.yilmaz" has been reset\./)
      assert.match(result.stdout, /Old direct messages can no longer be read with this account\./)
      const missing = await runServerJs(['reset-password', 'hayalet'], { DIL: 'en', DATA_DIR: ctx.dataDir })
      assert.equal(missing.code, 1)
      assert.match(missing.stderr, /Error: no user named "hayalet" was found\./)
      const usage = await runServerJs(['reset-password'], { DIL: 'en', DATA_DIR: ctx.dataDir })
      assert.equal(usage.code, 1)
      assert.match(usage.stderr, /Usage: node server\.js reset-password <username>/)
      const help = await runServerJs(['--help'], { DIL: 'en' })
      assert.equal(help.code, 1)
      assert.match(help.stderr, /node server\.js reset-password <username>/)
      assert.match(help.stderr, /node server\.js sifre-sifirla <username>/)
      const next = await h.startServer({}, ctx.root)
      try {
        h.expectStatus(await h.login(next, 'ayse.yilmaz', match[1]), 200)
      } finally {
        await next.stop()
      }
    } finally {
      h.removeRoot(ctx.root)
    }
  })

  it('bozuk veri dosyası hatası konsol dilinde', async () => {
    const root = h.makeRoot()
    try {
      const dataDir = path.join(root, 'veri')
      fs.mkdirSync(dataDir, { recursive: true })
      fs.writeFileSync(path.join(dataDir, 'state.json'), '{bozuk')
      const port = await freePort()
      const result = await runServerJs([], { DIL: 'en', DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1' })
      assert.equal(result.code, 1)
      assert.match(result.stderr, /^Error: The data file is corrupt: /)
      assert.equal(fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8'), '{bozuk')
    } finally {
      h.removeRoot(root)
    }
  })
})

describe('veri klasörünün varsayılan yeri', () => {
  it('VERI_KLASORU verilmezse çalışma klasöründeki veri klasörü kullanılır ve tam yolu gösterilir', async () => {
    const root = h.makeRoot()
    try {
      const work = path.join(root, 'calisma')
      fs.mkdirSync(work)
      const { result, info } = await startAndStop({}, { cwd: work })
      const dataDir = path.join(work, 'veri')
      assert.equal(info.status, 200)
      assert.ok(result.stdout.includes('Veri klasörü: ' + dataDir), result.stdout)
      assert.ok(path.isAbsolute(dataDir))
      assert.ok(fs.existsSync(dataDir))
      // Sunucu kodunun yanına (npm ile kurulduğunda node_modules içine) yazılmaz
      assert.ok(!fs.existsSync(path.join(root, 'veri')))
      if (process.platform !== 'win32') {
        assert.equal(result.code, 0, result.stderr)
        assert.ok(fs.existsSync(path.join(dataDir, 'state.json')))
      }
    } finally {
      h.removeRoot(root)
    }
  })

  it('parola sıfırlama komutu da varsayılan olarak çalışma klasöründeki veri klasörünü kullanır', async () => {
    const { ctx } = await preparedData()
    try {
      assert.equal(path.basename(ctx.dataDir), 'veri')
      const result = await runServerJs(['sifre-sifirla', 'sahip'], { VERI_KLASORU: undefined, DATA_DIR: undefined }, { cwd: path.dirname(ctx.dataDir) })
      assert.equal(result.code, 0, result.stderr)
      assert.match(result.stdout, /Geçici parola: [A-Za-z0-9]{12}/)
      const elsewhere = await runServerJs(['sifre-sifirla', 'sahip'], {}, { cwd: path.join(ctx.root, 'public') })
      assert.equal(elsewhere.code, 1)
      assert.ok(elsewhere.stderr.includes(path.join(ctx.root, 'public', 'veri')), elsewhere.stderr)
      assert.ok(!fs.existsSync(path.join(ctx.root, 'public', 'veri')))
    } finally {
      h.removeRoot(ctx.root)
    }
  })

  it('readConfig ve defaultDataDir varsayılanı process.cwd() altındaki veri klasörüdür', () => {
    const { readConfig, defaultDataDir } = require('../server.js')
    assert.equal(defaultDataDir(), path.join(process.cwd(), 'veri'))
    assert.equal(readConfig({}).dataDir, path.join(process.cwd(), 'veri'))
    assert.equal(readConfig({ VERI_KLASORU: '  ' }).dataDir, path.join(process.cwd(), 'veri'))
    assert.equal(readConfig({ DATA_DIR: 'baska' }).dataDir, path.resolve('baska'))
  })
})

describe('tek dosya uygulaması yardımcıları', () => {
  it('Enter beklemesi yalnızca tek dosya uygulamasında ve etkileşimli konsolda yapılır', () => {
    const { pausesOnFatal } = require('../server.js')
    const tty = { isTTY: true }
    const pipe = { isTTY: false }
    assert.equal(pausesOnFatal(true, tty, tty), true)
    assert.equal(pausesOnFatal(false, tty, tty), false)
    assert.equal(pausesOnFatal(true, pipe, tty), false)
    assert.equal(pausesOnFatal(true, tty, pipe), false)
    assert.equal(pausesOnFatal(true, {}, tty), false)
    assert.equal(pausesOnFatal(true, null, null), false)
  })

  it('telsiz.env ayar grupları ortam değişkeni adlarının tamamını kapsar', () => {
    const { SETTING_GROUPS, ENV_NAMES } = require('../server.js')
    const names = SETTING_GROUPS.flat()
    assert.equal(new Set(names).size, names.length)
    for (const key of Object.keys(ENV_NAMES)) assert.ok(SETTING_GROUPS.some((g) => g.join() === ENV_NAMES[key].join()), key)
    for (const name of ['PORT', 'HOST', 'STUN_URL', 'TURN_URL']) assert.ok(names.includes(name), name)
    // Testlerde temizlenen ayar adlarıyla aynı küme (sistem dil değişkenleri hariç)
    assert.deepEqual(names.slice().sort(), CONFIG_KEYS.filter((k) => !['LANG', 'LC_ALL', 'LC_MESSAGES'].includes(k)).sort())
  })
})
