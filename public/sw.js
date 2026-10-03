'use strict'

// Service worker (5.9). Yalnızca uygulama kabuğunu önbelleğe alır.
// /api/ istekleri hiçbir zaman ele alınmaz ve önbelleğe alınmaz.
// Aynı kökenli GET isteklerinde ağ önceliklidir, ağ yoksa önbellek kullanılır.

// Önbellek adı sürümle değişir, yeni sürümde eski önbellek activate aşamasında silinir
const CACHE_NAME = 'telsiz-2.0.0-tema1'
const SHELL = [
  '/',
  '/index.html',
  '/theme-init.js',
  '/css/tokens.css',
  '/css/base.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/skins/arcade.css',
  '/css/skins/gece.css',
  '/css/skins/turkuaz.css',
  '/i18n.js',
  '/crypto.js',
  '/emoji.js',
  '/voice.js',
  '/js/01-core.js',
  '/js/02-state-dom.js',
  '/js/03-auth.js',
  '/js/04-meta.js',
  '/js/05-poll.js',
  '/js/06-messages.js',
  '/js/07-attachments.js',
  '/js/08-composer.js',
  '/js/09-emoji.js',
  '/js/10-voice.js',
  '/js/11-settings.js',
  '/js/12-init.js',
  '/js/13-profile.js',
  '/js/14-social.js',
  '/js/15-dm.js',
  '/js/16-identity.js',
  '/fonts/figtree-latin-ext-wght-normal.woff2',
  '/fonts/figtree-latin-wght-normal.woff2',
  '/fonts/manrope-latin-ext-wght-normal.woff2',
  '/fonts/manrope-latin-wght-normal.woff2',
  '/fonts/martian-mono-latin-500-normal.woff2',
  '/fonts/martian-mono-latin-ext-500-normal.woff2',
  '/fonts/rubik-latin-ext-wght-normal.woff2',
  '/fonts/rubik-latin-wght-normal.woff2',
  '/fonts/unbounded-latin-700-normal.woff2',
  '/fonts/unbounded-latin-ext-700-normal.woff2',
  '/fonts/young-serif-latin-400-normal.woff2',
  '/fonts/young-serif-latin-ext-400-normal.woff2',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/vendor/nacl-fast.min.js',
  '/vendor/scrypt.js',
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
