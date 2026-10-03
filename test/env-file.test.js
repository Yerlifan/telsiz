'use strict'

// telsiz.env okuma ve ayrıştırma (src/env-file.js): biçim, yorumlar, BOM ve satır sonları,
// tırnaklar, bilinmeyen ve bozuk satırlar, yinelenen adlar, boyut sınırı ve ortam
// değişkenlerinin önceliği (Türkçe adlar ve İngilizce takma adlar birlikte).

const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const envFile = require('../src/env-file')
const { SETTING_GROUPS } = require('../server.js')

function tempDir (t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telsiz-env-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

function parse (text) {
  return envFile.parseEnvFile(text, SETTING_GROUPS)
}

function valuesOf (parsed) {
  return Object.fromEntries(parsed.values)
}

describe('telsiz.env ayrıştırma', () => {
  it('AD=değer satırları, yorumlar, boş satırlar, BOM, CRLF ve tırnaklar', () => {
    const text = '\uFEFF# Telsiz ayarları\r\n\r\nSUNUCU_ADI = Kankalar Sunucusu \r\n  PORT=4210\r\n' +
      'TURN_SIFRE="  boşluklu # parola "\r\nTURN_KULLANICI=\'kişi\'\r\nSTUN_URL=\r\n   # girintili yorum\r\nhost=127.0.0.1\r\n' +
      'DATA_DIR=C:\\Telsiz\\veri\rDIL=en\n'
    const parsed = parse(text)
    assert.deepEqual(parsed.warnings, [])
    assert.deepEqual(valuesOf(parsed), {
      SUNUCU_ADI: 'Kankalar Sunucusu',
      PORT: '4210',
      TURN_SIFRE: '  boşluklu # parola ',
      TURN_KULLANICI: 'kişi',
      STUN_URL: '',
      HOST: '127.0.0.1',
      DATA_DIR: 'C:\\Telsiz\\veri',
      DIL: 'en'
    })
  })

  it('bilinmeyen, bozuk ve yinelenen satırlar uyarıyla bildirilir', () => {
    const parsed = parse([
      'PORT=1',
      'BILINMEYEN=1',
      'NODE_OPTIONS=--require ./kotu.js',
      'bu satır bozuk',
      '=değer',
      '1PORT=3',
      'TÜRKÇE_AD=1',
      'PORT=2',
      'HOST=a\0b',
      'LANG=tr_TR.UTF-8',
      'export PORT=5'
    ].join('\n'))
    assert.deepEqual(valuesOf(parsed), { PORT: '2' })
    assert.deepEqual(parsed.warnings, [
      { kind: 'unknown', line: 2, key: 'BILINMEYEN' },
      { kind: 'unknown', line: 3, key: 'NODE_OPTIONS' },
      { kind: 'malformed', line: 4, key: '' },
      { kind: 'malformed', line: 5, key: '' },
      { kind: 'malformed', line: 6, key: '' },
      { kind: 'malformed', line: 7, key: '' },
      { kind: 'duplicate', line: 8, key: 'PORT' },
      { kind: 'malformed', line: 9, key: '' },
      { kind: 'unknown', line: 10, key: 'LANG' },
      { kind: 'malformed', line: 11, key: '' }
    ])
  })

  it('yalnızca server.js ayarları bilinir, adlar büyük harfe çevrilir', () => {
    const names = SETTING_GROUPS.flat()
    const parsed = parse(names.map((name, i) => name.toLowerCase() + '=' + i).join('\n'))
    assert.deepEqual(parsed.warnings, [])
    assert.deepEqual(Array.from(parsed.values.keys()), names)
    assert.deepEqual(parse('').values.size, 0)
    assert.deepEqual(parse(null).values.size, 0)
  })
})

describe('telsiz.env ortama ekleme', () => {
  it('ortam değişkeni (Türkçe adı veya İngilizce takma adı) tanımlıysa dosyadaki değer kullanılmaz', () => {
    const env = { MAX_UPLOAD_MB: '7', VERI_KLASORU: '', STUN_URL: '' }
    const parsed = parse([
      'MAKS_YUKLEME_MB=5',
      'DATA_DIR=/dosya/veri',
      'PORT=4210',
      'SUNUCU_ADI=Dosya',
      'SERVER_NAME=File',
      'STUN_URL=stun:dosya.example.org'
    ].join('\n'))
    const result = envFile.applyEnvFile(env, parsed, SETTING_GROUPS)
    assert.deepEqual(result.skipped, ['MAKS_YUKLEME_MB', 'DATA_DIR', 'STUN_URL'])
    assert.deepEqual(result.applied, ['PORT', 'SUNUCU_ADI', 'SERVER_NAME'])
    assert.deepEqual(env, {
      MAX_UPLOAD_MB: '7',
      VERI_KLASORU: '',
      STUN_URL: '',
      PORT: '4210',
      SUNUCU_ADI: 'Dosya',
      SERVER_NAME: 'File'
    })
  })
})

describe('telsiz.env okuma', () => {
  it('dosya yoksa null, varsa metin, sınırda kabul, bir bayt fazlası hata', (t) => {
    const dir = tempDir(t)
    const file = path.join(dir, envFile.ENV_FILE_NAME)
    assert.equal(envFile.readEnvFile(file), null)
    fs.writeFileSync(file, 'PORT=4210\n')
    assert.equal(envFile.readEnvFile(file), 'PORT=4210\n')
    const limit = envFile.MAX_ENV_FILE_BYTES
    assert.equal(limit, 16 * 1024)
    fs.writeFileSync(file, '#'.repeat(limit))
    assert.equal(envFile.readEnvFile(file).length, limit)
    fs.writeFileSync(file, '#'.repeat(limit + 1))
    assert.throws(() => envFile.readEnvFile(file), (err) => err instanceof envFile.EnvFileError && err.code === 'tooLarge')
  })

  it('klasör veya okunamayan yol hata verir', (t) => {
    const dir = tempDir(t)
    const folder = path.join(dir, envFile.ENV_FILE_NAME)
    fs.mkdirSync(folder)
    assert.throws(() => envFile.readEnvFile(folder), (err) => err instanceof envFile.EnvFileError && err.code === 'unreadable')
    // Yolun bir parçası klasör değil dosyaysa POSIX'te ENOTDIR (okunamaz) döner, Windows bunu
    // genellikle dosya yok (ENOENT) olarak bildirir
    const inFile = path.join(dir, 'dosya')
    fs.writeFileSync(inFile, 'x')
    const below = path.join(inFile, 'telsiz.env')
    if (process.platform === 'win32') {
      let result
      try {
        result = envFile.readEnvFile(below)
      } catch (err) {
        result = err
      }
      assert.ok(result === null || (result instanceof envFile.EnvFileError && result.code === 'unreadable'), String(result))
    } else {
      assert.throws(() => envFile.readEnvFile(below), (err) => err instanceof envFile.EnvFileError && err.code === 'unreadable' && err.detail === 'ENOTDIR')
    }
  })
})
