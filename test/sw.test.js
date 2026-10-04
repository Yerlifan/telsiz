'use strict'

// public/sw.js: activate aşamasında yalnız Telsiz'in eski önbellekleri silinir,
// aynı kökendeki başka uygulamaların önbelleklerine dokunulmaz.

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
