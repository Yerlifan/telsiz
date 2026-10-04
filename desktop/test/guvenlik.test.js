'use strict'

// Güvenlik denetiminde bulunan sorunların gerileme testleri (masaüstü).
// Alt çerçeve gezinmesi: önceki kural bütün alt çerçeveleri engelliyordu, bu yüzden Telsiz DJ'nin YouTube
// oynatıcısı (public/dj/youtube.js, çapraz kökenli çerçeve) masaüstünde hiç yüklenmiyordu (Electron 44.5.1
// ile will-frame-navigate olayının iframe src atamasında da geldiği doğrulandı). Yeni kural yalnızca uygulama
// penceresinin ana çerçevesinin doğrudan alt çerçevesinde https://www.youtube-nocookie.com kökenine izin verir.
// Açılır pencere: YouTube çerçevesi kullanıcı hareketi olmadan window.open çağırabildiği için (Electron 44.5.1
// ile doğrulandı) bu çerçeveden gelen dış açma istekleri yalnızca YouTube adreslerine gider.

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const nav = require('../src/lib/navigation')
const csp = require('../src/lib/csp')

const SRC = path.join(__dirname, '..', 'src')

test('alt çerçeve: yalnızca uygulama penceresinde, doğrudan alt çerçevede YouTube oynatıcısı', () => {
  const embed = 'https://www.youtube-nocookie.com/embed/abcdefghijk?enablejsapi=1&origin=telsiz%3A%2F%2Fapp'
  assert.equal(nav.decideFrameNavigation(embed, 'app', 1), 'allow')
  assert.equal(nav.decideFrameNavigation('https://www.youtube-nocookie.com/', 'app', 1), 'allow')
  const denied = [
    // Başka bağlamlar ve derinlikler
    [embed, 'connect', 1],
    [embed, 'picker', 1],
    [embed, undefined, 1],
    [embed, 'app', 0],
    [embed, 'app', 2],
    [embed, 'app', -1],
    // Başka kökenler ve şemalar
    ['http://www.youtube-nocookie.com/embed/abcdefghijk', 'app', 1],
    ['https://www.youtube.com/embed/abcdefghijk', 'app', 1],
    ['https://youtube-nocookie.com/embed/abcdefghijk', 'app', 1],
    ['https://www.youtube-nocookie.com.evil.example/embed/x', 'app', 1],
    ['https://www.youtube-nocookie.com:8443/embed/x', 'app', 1],
    ['https://user:pass@www.youtube-nocookie.com/embed/x', 'app', 1],
    ['telsiz://app/', 'app', 1],
    ['telsiz://app/api/state', 'app', 1],
    ['data:text/html,x', 'app', 1],
    ['javascript:alert(1)', 'app', 1],
    ['blob:telsiz://app/1', 'app', 1],
    ['about:blank', 'app', 1],
    ['file:///etc/passwd', 'app', 1],
    ['https://www.youtube-nocookie.com/' + 'a'.repeat(nav.MAX_EXTERNAL_URL), 'app', 1],
    ['', 'app', 1],
    [null, 'app', 1]
  ]
  for (const [url, context, depth] of denied) {
    assert.equal(nav.decideFrameNavigation(url, context, depth), 'deny', String(url) + ' ' + context + ' ' + depth)
  }
})

test('alt çerçeve kökeni sayfanın CSP frame-src değeriyle aynı', () => {
  const frameSrc = csp.HTML_DIRECTIVES.find((entry) => entry[0] === 'frame-src')
  assert.deepEqual(frameSrc, ['frame-src', 'https://' + nav.YOUTUBE_FRAME_HOST])
})

test('ana süreç alt çerçeve gezinmesini ve yönlendirmesini bu kuralla denetler', () => {
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8').replace(/\r\n/g, '\n')
  const frameNav = /contents\.on\('will-frame-navigate', \(details\) => \{\n([\s\S]*?)\n {4}\}\)/.exec(main)
  assert.ok(frameNav, 'will-frame-navigate işleyicisi bulunmalı')
  assert.match(frameNav[1], /if \(details\.isMainFrame\) return/)
  assert.match(frameNav[1], /navigation\.decideFrameNavigation\(details\.url, contextOf\(contents\), frameDepth\(details\.frame\)\) !== 'allow'\) details\.preventDefault\(\)/)
  const redirect = /contents\.on\('will-redirect', \(details\) => \{\n([\s\S]*?)\n {4}\}\)/.exec(main)
  assert.ok(redirect, 'will-redirect işleyicisi bulunmalı')
  assert.match(redirect[1], /navigation\.decideFrameNavigation\(details\.url, context, frameDepth\(details\.frame\)\)/)
  assert.match(redirect[1], /if \(decision !== 'allow'\) details\.preventDefault\(\)/)
})

test('açılır pencere: YouTube çerçevesinden yalnızca YouTube adresleri dış tarayıcıya gider', () => {
  const yt = 'https://www.youtube-nocookie.com/'
  assert.equal(nav.decideAppWindowOpen('https://www.youtube.com/watch?v=abcdefghijk', yt), 'external')
  assert.equal(nav.decideAppWindowOpen('https://youtu.be/abcdefghijk', 'https://www.youtube-nocookie.com/embed/abcdefghijk'), 'external')
  for (const url of ['https://reklam.example/tikla', 'https://www.youtube.com.evil.example/', 'https://youtube-nocookie.com/', 'http://www.youtube.com/watch?v=x', 'javascript:alert(1)']) {
    assert.equal(nav.decideAppWindowOpen(url, yt), 'deny', url)
  }
  // Uygulamanın kendi bağlantıları (yönlendiren yok veya telsiz://app) önceki kurala uyar
  assert.equal(nav.decideAppWindowOpen('https://github.com/Yerlifan/telsiz', ''), 'external')
  assert.equal(nav.decideAppWindowOpen('https://ornek.com/a', 'telsiz://app/'), 'external')
  assert.equal(nav.decideAppWindowOpen('http://ornek.com/', ''), 'deny')
  assert.equal(nav.decideAppWindowOpen('file:///etc/passwd', ''), 'deny')
  const main = fs.readFileSync(path.join(SRC, 'main.js'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(main, /contextOf\(contents\) === 'app' && navigation\.decideAppWindowOpen\(details\.url, referrer\) === 'external'\) openExternal\(details\.url\)/)
})
