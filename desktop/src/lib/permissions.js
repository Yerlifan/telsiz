'use strict'

// İzin kararları (Electron session.setPermissionRequestHandler ve setPermissionCheckHandler).
// Electron'a bağımlı değildir. Yalnızca telsiz://app kökeninin ana çerçevesine şu izinler verilir:
//   media, yalnızca ses: mikrofon (getUserMedia audio), kamera hiçbir zaman
//   media, ekran yakalama: yalnızca kullanıcı ekran seçicide bir kaynak seçerse (src/lib/screen-share.js)
//   notifications: sistem bildirimleri
//   clipboard-sanitized-write: panoya metin yazma (kopyala düğmeleri)
// Geri kalan her izin (konum, kamera, pano okuma, HID, USB, seri port, tam ekran, MIDI, dış
// uygulama açma ve diğerleri) reddedilir. Sunucu adresi ve ekran seçici pencerelerine hiçbir
// izin verilmez.
//
// Ekran yakalama neden ayrıca ele alınır: Electron 44'te getDisplayMedia önce mediaTypes listesi
// boş bir 'media' izin isteği üretir, ekran seçimi bu izin verildikten sonra gelir. Eski
// getUserMedia({ video: { mandatory: { chromeMediaSource: 'desktop' } } }) çağrısı da aynı boş
// listeli isteği üretir ve izin verilirse seçici olmadan bütün ekranı yakalar (yerelde Electron
// 44.5.1 ile doğrulandı). Bu yüzden boş listeli istek hiçbir zaman kendiliğinden kabul edilmez,
// karar 'display' olur ve ana süreç ekran seçiciyi gösterir.

const { originOf } = require('./navigation')

const SIMPLE_PERMISSIONS = new Set(['notifications', 'clipboard-sanitized-write'])

function sameOrigin (value, allowedOrigin) {
  return typeof allowedOrigin === 'string' && allowedOrigin !== '' && originOf(value) === allowedOrigin
}

// İzin isteği. details: Electron PermissionRequest (requestingUrl, isMainFrame, mediaTypes,
// securityOrigin). Sonuç: 'allow', 'deny' veya 'display' (ekran seçici gösterilmeli).
function decideRequest (permission, details, allowedOrigin) {
  const d = details || {}
  if (d.isMainFrame !== true || !sameOrigin(d.requestingUrl, allowedOrigin)) return 'deny'
  if (typeof d.securityOrigin === 'string' && d.securityOrigin !== '' && !sameOrigin(d.securityOrigin, allowedOrigin)) return 'deny'
  if (SIMPLE_PERMISSIONS.has(permission)) return 'allow'
  if (permission === 'media') {
    if (!Array.isArray(d.mediaTypes)) return 'deny'
    if (d.mediaTypes.length === 0) return 'display'
    return d.mediaTypes.every((type) => type === 'audio') ? 'allow' : 'deny'
  }
  return 'deny'
}

// İzin denetimi. requestingOrigin: Chromium'un verdiği köken, details: isMainFrame, mediaType,
// requestingUrl (varsa), securityOrigin (varsa). Ekran yakalama denetim aşamasında değil, istek
// aşamasında ve ekran seçicide karara bağlanır.
function decideCheck (permission, requestingOrigin, details, allowedOrigin) {
  const d = details || {}
  if (d.isMainFrame !== true || !sameOrigin(requestingOrigin, allowedOrigin)) return false
  if (typeof d.requestingUrl === 'string' && d.requestingUrl !== '' && !sameOrigin(d.requestingUrl, allowedOrigin)) return false
  if (typeof d.securityOrigin === 'string' && d.securityOrigin !== '' && !sameOrigin(d.securityOrigin, allowedOrigin)) return false
  if (SIMPLE_PERMISSIONS.has(permission)) return true
  if (permission === 'media') return d.mediaType === 'audio'
  return false
}

module.exports = { SIMPLE_PERMISSIONS, decideRequest, decideCheck }
