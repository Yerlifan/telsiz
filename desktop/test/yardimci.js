'use strict'

// Masaüstü testlerinin ortak yardımcıları (test dosyası değildir, adı .test.js ile bitmez).

const net = require('node:net')

const PORT_MIN = 4300
const PORT_MAX = 4349

function portFree (port) {
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

// Sunucuyu 4300 ile 4349 arasındaki ilk boş portta dinletir, portu döndürür
async function listenInRange (server) {
  for (const port of Array.from({ length: PORT_MAX - PORT_MIN + 1 }, (_, i) => PORT_MIN + i)) {
    if (!(await portFree(port))) continue
    const ok = await new Promise((resolve) => {
      const onError = () => resolve(false)
      server.once('error', onError)
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError)
        resolve(true)
      })
    })
    if (ok) return port
  }
  throw new Error('No free port between ' + PORT_MIN + ' and ' + PORT_MAX)
}

function sleep (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

module.exports = { PORT_MIN, PORT_MAX, listenInRange, sleep }
