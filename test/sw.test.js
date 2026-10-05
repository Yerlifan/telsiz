'use strict'

// public/sw.js: activate aşamasında yalnız Telsiz'in eski önbellekleri silinir,
// aynı kökendeki başka uygulamaların önbelleklerine dokunulmaz. Ağ yokken önbellekte olmayan bir dosya
// Service Worker hatası (Response.error) yerine 504 yanıtı alır, sayfa ise tarayıcının hata sayfasını.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8')

function loadWorker (cacheNames) {
  const handlers = {}
  const deleted = []
  const context = {
    self: {
      addEventListener (type, fn) { handlers[type] = fn },
      skipWaiting () { return Promise.resolve() },
      clients: { claim () { return Promise.resolve() } }
    },
    caches: {
      keys () { return Promise.resolve(cacheNames.slice()) },
      delete (name) {
        deleted.push(name)
        return Promise.resolve(true)
      }
    },
    Request: function Request () {},
    URL,
    Promise
  }
  vm.runInNewContext(source, context, { filename: 'sw.js' })
  const current = vm.runInNewContext('CACHE_NAME', context)
  return { handlers, deleted, current }
}

test('activate yalnız telsiz- önekli eski önbellekleri siler', async () => {
  const probe = loadWorker([])
  const names = [probe.current, 'telsiz-1.9.0', 'telsiz-2.0.0-frekans1', 'other-app-cache', 'workbox-precache-v2']
  const worker = loadWorker(names)
  let pending = null
  worker.handlers.activate({ waitUntil (p) { pending = p } })
  await pending
  assert.deepEqual(worker.deleted.sort(), ['telsiz-1.9.0', 'telsiz-2.0.0-frekans1'])
})

test('ağ yokken önbellekte olmayan dosya 504 alır, sayfa Response.error alır', async () => {
  const errorMark = { error: true }
  class FakeResponse {
    constructor (body, init) {
      this.body = body
      this.status = init.status
    }

    static error () { return errorMark }
  }
  const handlers = {}
  const context = {
    self: {
      addEventListener (type, fn) { handlers[type] = fn },
      skipWaiting () { return Promise.resolve() },
      clients: { claim () { return Promise.resolve() } },
      location: { origin: 'https://telsiz.ornek' }
    },
    caches: {
      keys () { return Promise.resolve([]) },
      match () { return Promise.resolve(undefined) },
      open () { return Promise.reject(new Error('yok')) }
    },
    fetch () { return Promise.reject(new TypeError('NetworkError')) },
    Response: FakeResponse,
    Request: function Request () {},
    URL,
    Promise
  }
  vm.runInNewContext(source, context, { filename: 'sw.js' })
  const respond = (url, mode) => new Promise((resolve) => {
    handlers.fetch({ request: { method: 'GET', url, mode }, respondWith: (p) => resolve(p) })
  })
  const icon = await (await respond('https://telsiz.ornek/favicon.svg', 'no-cors'))
  assert.equal(icon.status, 504)
  const page = await (await respond('https://telsiz.ornek/', 'navigate'))
  assert.equal(page, errorMark)
})
