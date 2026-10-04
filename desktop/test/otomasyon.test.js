'use strict'

// Playwright otomasyonu için açılış kapısı (src/lib/automation.js)

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const automation = require('../src/lib/automation')

const DESKTOP_DIR = path.join(__dirname, '..')

function fakeTimers () {
  const timers = []
  return {
    timers,
    setTimer: (fn, ms) => {
      const timer = { fn, ms, cleared: false }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer) => {
      timer.cleared = true
    }
  }
}

test('değişken yoksa veya denetleyici kapalıysa kapı hiç beklemez', async () => {
  const target = {}
  assert.equal(await automation.waitForAutomation({ env: {}, inspectorUrl: () => 'ws://127.0.0.1:1/x', target }), 'off')
  assert.equal(await automation.waitForAutomation({ env: { TELSIZ_PLAYWRIGHT: 'evet' }, inspectorUrl: () => 'ws://127.0.0.1:1/x', target }), 'off')
  assert.equal(await automation.waitForAutomation({ env: { TELSIZ_PLAYWRIGHT: '1' }, inspectorUrl: () => undefined, target }), 'no-inspector')
  assert.equal(await automation.waitForAutomation({ env: { TELSIZ_PLAYWRIGHT: '1' }, inspectorUrl: () => { throw new Error('yok') }, target }), 'no-inspector')
  assert.deepEqual(Object.keys(target), [])
})

test('kapı __playwright_run çağrılınca açılır ve genel adı kaldırır', async () => {
  const target = {}
  const t = fakeTimers()
  const gate = automation.waitForAutomation({ env: { TELSIZ_PLAYWRIGHT: '1' }, inspectorUrl: () => 'ws://127.0.0.1:1/x', target, setTimer: t.setTimer, clearTimer: t.clearTimer })
  assert.equal(typeof target.__playwright_run, 'function')
  assert.equal(t.timers[0].ms, automation.WAIT_MS)
  target.__playwright_run()
  assert.equal(await gate, 'connected')
  assert.equal('__playwright_run' in target, false)
  assert.equal(t.timers[0].cleared, true)
})

test('çağrı gelmezse kapı süre dolunca yine açılır', async () => {
  const target = {}
  const t = fakeTimers()
  const gate = automation.waitForAutomation({ env: { TELSIZ_PLAYWRIGHT: '1' }, inspectorUrl: () => 'ws://127.0.0.1:1/x', target, setTimer: t.setTimer, clearTimer: t.clearTimer, waitMs: 5 })
  assert.equal(t.timers[0].ms, 5)
  t.timers[0].fn()
  assert.equal(await gate, 'timeout')
  assert.equal('__playwright_run' in target, false)
})

test('Playwright başlatmanın sonunda __playwright_run ifadesini çalıştırır (sürüm yükseltmesi denetimi)', () => {
  const bundle = fs.readFileSync(path.join(DESKTOP_DIR, 'node_modules', 'playwright-core', 'lib', 'coreBundle.js'), 'utf8')
  assert.ok(bundle.includes('send("Runtime.evaluate", { expression: "' + automation.GLOBAL_NAME + '()" })'))
  // executablePath verildiğinde yükleyici eklenmez, kapıyı uygulama kendisi sağlar
  assert.match(bundle, /if \(options\.executablePath\) \{\s*command = options\.executablePath;\s*\} else \{[\s\S]{0,600}electronArguments\.unshift\("-r", libPath\("server", "electron", "loader\.js"\)\)/)
})

test('ana süreç ilk pencereyi kapıdan sonra açar, duman testi kapıyı etkinleştirir', () => {
  const main = fs.readFileSync(path.join(DESKTOP_DIR, 'src', 'main.js'), 'utf8').replace(/\r\n/g, '\n')
  assert.match(main, /return automation\.waitForAutomation\(\{ env: process\.env, inspectorUrl: \(\) => require\('node:inspector'\)\.url\(\), target: globalThis \}\)\n {2}\}\)\.then\(\(gate\) => \{[\s\S]*?\n {4}start\(\)\n/)
  const smoke = fs.readFileSync(path.join(DESKTOP_DIR, 'e2e', 'duman.test.js'), 'utf8')
  assert.ok(smoke.includes("TELSIZ_PLAYWRIGHT: '1'"))
})
