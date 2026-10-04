'use strict'

// Masaüstü uygulamasının kendi metinleri (menü, tepsi, frekans adresi ekranı, ekran paylaşımı
// seçicisi, iletişim kutuları).
// Web uygulamasının metinleri public/i18n.js içindedir, bu küçük sözlük yalnızca uygulama
// penceresinin dışındaki arayüz içindir. Dil sistem dilinden seçilir: Türkçe ise tr, değilse en.
// İki sözlüğün anahtarları ve parametreleri birebir aynıdır (desktop/test/strings.test.js).

const MESSAGES = {
  tr: {
    'menu.app': 'Telsiz',
    'menu.changeServer': 'Frekans ekle...',
    'menu.frequencies': 'Frekanslar',
    'menu.closeToTray': 'Kapatınca sistem tepsisine küçült',
    'menu.quit': 'Çık',
    'menu.edit': 'Düzen',
    'menu.undo': 'Geri al',
    'menu.redo': 'Yinele',
    'menu.cut': 'Kes',
    'menu.copy': 'Kopyala',
    'menu.paste': 'Yapıştır',
    'menu.selectAll': 'Tümünü seç',
    'menu.view': 'Görünüm',
    'menu.reload': 'Yeniden yükle',
    'menu.zoomIn': 'Yakınlaştır',
    'menu.zoomOut': 'Uzaklaştır',
    'menu.resetZoom': 'Gerçek boyut',
    'menu.fullScreen': 'Tam ekran',
    'menu.devTools': 'Geliştirici araçları',
    'menu.help': 'Yardım',
    'menu.about': 'Telsiz hakkında',
    'menu.project': 'Proje sayfası',
    'menu.checkUpdates': 'Güncellemeleri denetle',
    'update.install': 'Yeniden başlat ve güncelle ({version})',
    'update.available': 'Yeni sürüm var: {version}',
    'tray.tooltip': 'Telsiz',
    'tray.open': 'Aç',
    'tray.toggleMute': 'Mikrofonu aç/kapat',
    'tray.frequencies': 'Frekanslar',
    'tray.quit': 'Çık',
    'tray.hintTitle': 'Telsiz arka planda çalışıyor',
    'tray.hintBody': 'Ses bağlantınız sürüyor. Tamamen çıkmak için tepsi simgesinin menüsünden Çık seçeneğini kullanın.',
    'about.title': 'Telsiz hakkında',
    'about.detail': 'Sürüm {version}\nElectron {electron}\nFrekans: {server}\n\nUçtan uca şifreli, açık kaynak yazılı ve sesli iletişim. Arayüz bu uygulamanın içinden yüklenir.',
    'about.noServer': 'seçilmedi',
    'integrity.title': 'Telsiz başlatılamadı',
    'integrity.body': 'Uygulama dosyaları bozuk veya değiştirilmiş: {files}\n\nTelsiz\'i resmi sürüm sayfasından yeniden indirip kurun.',
    'http.notFound': 'Bulunamadı',
    'connect.windowTitle': 'Telsiz: frekans adresi',
    'connect.title': 'Frekansa bağlan',
    'connect.addTitle': 'Frekans ekle',
    'connect.lead': 'Katılmak istediğiniz frekansın adresini girin. Her frekans bir Telsiz sunucusudur, adresini frekansı kuran kişiden alabilirsiniz.',
    'connect.addLead': 'Yeni frekans listenize eklenir ve hemen açılır. Diğer frekanslardaki girişleriniz bu cihazda saklı kalır.',
    'connect.label': 'Frekans adresi',
    'connect.placeholder': 'https://telsiz.ornek.com',
    'connect.hint': 'Frekansın sunucusunun https:// adresi. Bu bilgisayardaki sunucu için http://localhost da kullanılabilir.',
    'connect.submit': 'Bağlan',
    'connect.cancel': 'Vazgeç',
    'connect.anyway': 'Yine de bağlan',
    'connect.checking': 'Sunucu denetleniyor...',
    'connect.connecting': '{name} frekansına bağlanılıyor...',
    'connect.current': 'Şu anki frekans: {server}',
    'connect.security': 'Uygulamanın arayüzü bu bilgisayardaki paketten yüklenir, sunucudan indirilmez. Sunucu yalnızca şifreli verileri taşır.',
    'connect.error.invalid': 'Geçerli bir adres girin, örneğin https://telsiz.ornek.com',
    'connect.error.too_long': 'Adres çok uzun.',
    'connect.error.insecure': 'http:// yalnızca bu bilgisayardaki sunucu için (localhost veya 127.0.0.1) kullanılabilir. Uzak sunucular için https:// adresini girin.',
    'connect.error.credentials': 'Adreste kullanıcı adı veya parola bulunamaz.',
    'connect.error.path': 'Yalnızca sunucunun ana adresini girin (yol, ? veya # olmadan).',
    'connect.error.unreachable': 'Sunucuya ulaşılamadı. Adresi ve internet bağlantınızı denetleyin.',
    'connect.error.certificate': 'Sunucunun güvenlik sertifikası doğrulanamadı. Sunucuda geçerli bir sertifika olmalıdır.',
    'connect.error.timeout': 'Sunucu zamanında yanıt vermedi. Daha sonra yeniden deneyin.',
    'connect.error.not_telsiz': 'Bu adreste bir Telsiz sunucusu bulunamadı.',
    'connect.error.busy': 'Önceki deneme sürüyor, lütfen bekleyin.',
    'connect.error.unknown': 'Bağlanılamadı. Yeniden deneyin.',
    'connect.version.mismatch': '{name} sunucusunun sürümü ({server}) bu uygulamanın sürümüyle ({app}) uyumlu olmayabilir, ana sürümler farklı. Sunucuyu veya uygulamayı güncelleyin ya da yine de bağlanın.',
    'connect.version.unknown': '{name} sunucusu sürümünü bildirmiyor, uyumluluk doğrulanamadı. Yine de bağlanabilirsiniz.',
    'picker.windowTitle': 'Telsiz: ekran paylaş',
    'picker.title': 'Neyi paylaşmak istiyorsunuz?',
    'picker.lead': 'Seçtiğiniz ekran veya pencere ses odasında izlemek isteyenlere gönderilir. Paylaşımı istediğiniz an durdurabilirsiniz.',
    'picker.screens': 'Ekranlar',
    'picker.windows': 'Pencereler',
    'picker.empty': 'Paylaşılabilecek bir ekran veya pencere bulunamadı.',
    'picker.systemAudio': 'Sistem sesini de paylaş',
    'picker.systemAudioHint': 'Bilgisayarınızda çalan bütün sesler paylaşılır, Telsiz\'deki konuşmalar da dahil.',
    'picker.share': 'Paylaş',
    'picker.cancel': 'Vazgeç',
    'picker.selected': '{name} seçildi',
    'context.cut': 'Kes',
    'context.copy': 'Kopyala',
    'context.paste': 'Yapıştır',
    'context.selectAll': 'Tümünü seç'
  },
  en: {
    'menu.app': 'Telsiz',
    'menu.changeServer': 'Add a frequency...',
    'menu.frequencies': 'Frequencies',
    'menu.closeToTray': 'Minimize to system tray on close',
    'menu.quit': 'Quit',
    'menu.edit': 'Edit',
    'menu.undo': 'Undo',
    'menu.redo': 'Redo',
    'menu.cut': 'Cut',
    'menu.copy': 'Copy',
    'menu.paste': 'Paste',
    'menu.selectAll': 'Select all',
    'menu.view': 'View',
    'menu.reload': 'Reload',
    'menu.zoomIn': 'Zoom in',
    'menu.zoomOut': 'Zoom out',
    'menu.resetZoom': 'Actual size',
    'menu.fullScreen': 'Full screen',
    'menu.devTools': 'Developer tools',
    'menu.help': 'Help',
    'menu.about': 'About Telsiz',
    'menu.project': 'Project page',
    'menu.checkUpdates': 'Check for updates',
    'update.install': 'Restart and update ({version})',
    'update.available': 'New version available: {version}',
    'tray.tooltip': 'Telsiz',
    'tray.open': 'Open',
    'tray.toggleMute': 'Toggle microphone',
    'tray.frequencies': 'Frequencies',
    'tray.quit': 'Quit',
    'tray.hintTitle': 'Telsiz is running in the background',
    'tray.hintBody': 'Your voice connection stays on. To quit completely, choose Quit from the tray icon menu.',
    'about.title': 'About Telsiz',
    'about.detail': 'Version {version}\nElectron {electron}\nFrequency: {server}\n\nOpen source, end-to-end encrypted text and voice communication. The interface is loaded from inside this app.',
    'about.noServer': 'not selected',
    'integrity.title': 'Telsiz could not start',
    'integrity.body': 'The application files are damaged or modified: {files}\n\nDownload and install Telsiz again from the official release page.',
    'http.notFound': 'Not found',
    'connect.windowTitle': 'Telsiz: frequency address',
    'connect.title': 'Connect to a frequency',
    'connect.addTitle': 'Add a frequency',
    'connect.lead': 'Enter the address of the frequency you want to join. Each frequency is a Telsiz server, you can get its address from the person who set it up.',
    'connect.addLead': 'The new frequency is added to your list and opens right away. Your sign-ins on other frequencies stay saved on this device.',
    'connect.label': 'Frequency address',
    'connect.placeholder': 'https://telsiz.example.com',
    'connect.hint': 'The https:// address of the frequency\'s server. For a server on this computer, http://localhost can also be used.',
    'connect.submit': 'Connect',
    'connect.cancel': 'Cancel',
    'connect.anyway': 'Connect anyway',
    'connect.checking': 'Checking the server...',
    'connect.connecting': 'Connecting to {name}...',
    'connect.current': 'Current frequency: {server}',
    'connect.security': 'The app interface is loaded from the package on this computer, not downloaded from the server. The server only carries encrypted data.',
    'connect.error.invalid': 'Enter a valid address, for example https://telsiz.example.com',
    'connect.error.too_long': 'The address is too long.',
    'connect.error.insecure': 'http:// can only be used for a server on this computer (localhost or 127.0.0.1). Enter an https:// address for remote servers.',
    'connect.error.credentials': 'The address cannot contain a user name or password.',
    'connect.error.path': 'Enter only the main address of the server (without a path, ? or #).',
    'connect.error.unreachable': 'The server could not be reached. Check the address and your internet connection.',
    'connect.error.certificate': 'The security certificate of the server could not be verified. The server needs a valid certificate.',
    'connect.error.timeout': 'The server did not respond in time. Try again later.',
    'connect.error.not_telsiz': 'No Telsiz server was found at this address.',
    'connect.error.busy': 'The previous attempt is still running, please wait.',
    'connect.error.unknown': 'Could not connect. Try again.',
    'connect.version.mismatch': 'The version of {name} ({server}) may not be compatible with this app ({app}), the major versions differ. Update the server or the app, or connect anyway.',
    'connect.version.unknown': '{name} does not report its version, compatibility could not be verified. You can still connect.',
    'picker.windowTitle': 'Telsiz: share your screen',
    'picker.title': 'What do you want to share?',
    'picker.lead': 'The screen or window you choose is sent to those in the voice room who want to watch. You can stop sharing at any time.',
    'picker.screens': 'Screens',
    'picker.windows': 'Windows',
    'picker.empty': 'No screen or window that can be shared was found.',
    'picker.systemAudio': 'Also share system audio',
    'picker.systemAudioHint': 'All sound playing on your computer is shared, including the conversation in Telsiz.',
    'picker.share': 'Share',
    'picker.cancel': 'Cancel',
    'picker.selected': '{name} selected',
    'context.cut': 'Cut',
    'context.copy': 'Copy',
    'context.paste': 'Paste',
    'context.selectAll': 'Select all'
  }
}

const LANGS = Object.freeze(Object.keys(MESSAGES))

// Sistem dili Türkçe ise tr, değilse en. languages: tercih sırasına göre dil kodları
// (ör. app.getPreferredSystemLanguages() ve app.getLocale()), ilk dolu değer belirleyicidir.
function pickLang (languages) {
  const list = Array.isArray(languages) ? languages : [languages]
  const first = list.find((value) => typeof value === 'string' && value.trim() !== '')
  if (!first) return 'en'
  return /^tr(?:[-_]|$)/i.test(first.trim()) ? 'tr' : 'en'
}

function format (text, params) {
  if (!params) return text
  return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name) => {
    return Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
  })
}

// t(key, params): anahtar yoksa İngilizce sözlüğe, o da yoksa anahtarın kendisine düşer
function translator (lang) {
  const dict = MESSAGES[lang] || MESSAGES.en
  return function t (key, params) {
    const text = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : (MESSAGES.en[key] || key)
    return format(text, params)
  }
}

// Önekle başlayan anahtarlar (sunucu adresi ekranına gönderilen alt küme)
function subset (lang, prefix) {
  const dict = MESSAGES[lang] || MESSAGES.en
  const out = {}
  for (const key of Object.keys(dict)) {
    if (key.startsWith(prefix)) out[key] = dict[key]
  }
  return out
}

module.exports = { MESSAGES, LANGS, pickLang, format, translator, subset }
