'use strict'

// Service worker (5.9). Yalnızca uygulama kabuğunu önbelleğe alır.
// /api/ istekleri hiçbir zaman ele alınmaz ve önbelleğe alınmaz.
// Aynı kökenli GET isteklerinde ağ önceliklidir, ağ yoksa önbellek kullanılır.

const CACHE_NAME = 'sohbet-kabuk-v2.0.0'
const SHELL = [
  '/',
  '/index.html',
  '/app.js',
  '/crypto.js',
  '/emoji.js',
  '/voice.js',
  '/style.css',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/vendor/nacl-fast.min.js',
  '/manifest.webmanifest'
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => Promise.all(SHELL.map((path) => {
      return cache.add(new Request(path, { cache: 'reload' })).catch(() => null)
    }))).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  )
})

function shellPath (url) {
  if (url.pathname === '/' || url.pathname === '/index.html') return '/'
  return SHELL.indexOf(url.pathname) !== -1 ? url.pathname : null
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  let url = null
  try {
    url = new URL(request.url)
  } catch (err) {
    return
  }
  if (url.origin !== self.location.origin) return
  if (url.pathname === '/api' || url.pathname.indexOf('/api/') === 0) return
  const isPage = request.mode === 'navigate'
  const key = isPage ? '/' : shellPath(url)
  if (!key) return
  event.respondWith(
    fetch(request).then((response) => {
      if (response && response.ok && response.type === 'basic') {
        const copy = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(key, copy)).catch(() => null)
      }
      return response
    }).catch(() => caches.match(key).then((cached) => cached || Response.error()))
  )
})
