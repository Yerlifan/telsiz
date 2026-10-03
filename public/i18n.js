'use strict'

// Arayüz dil desteği (window.I18N, Ek E1). Türkçe ve İngilizce sözlükler, dil seçimi ve kalıcılığı
// ('telsiz.lang'), parametreli ve çoğul metinler, statik HTML metinlerinin data-i18n* öznitelikleriyle
// doldurulması ve Intl ile tarih, saat, boyut ve sayı biçimleri.
// Sözlük anahtarları düz ve noktalıdır. Parametreler {ad} biçimindedir ve metin olarak yerleştirilir
// (çağıran textContent kullanır, HTML yorumlanmaz). Çoğul metinler _one ve _other sonekli iki anahtarla
// tanımlanır, seçim count parametresine göre Intl.PluralRules ile yapılır.
// İki sözlüğün anahtar kümeleri ve parametre adları birebir aynı olmalıdır (scripts/denetle.js denetler).

window.I18N = (function () {
  const STORAGE_KEY = 'telsiz.lang'
  const LANGS = ['tr', 'en']
  const LOCALES = { tr: 'tr-TR', en: 'en-US' }
  const ATTRS = [
    ['data-i18n', null],
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-aria-label', 'aria-label'],
    ['data-i18n-title', 'title']
  ]
  // Saat gösterimi: Türkçede 09:05, İngilizcede 9:05 AM
  const HOUR = { tr: '2-digit', en: 'numeric' }

  const tr = {
    'app.name': 'Telsiz',
    'app.reconnecting': 'Bağlantı koptu, yeniden deneniyor...',
    'app.installed': 'Uygulama yüklendi.',
    'main.label': 'Sohbet',
    'net.unreachable': 'Sunucuya ulaşılamadı.',
    'title.unread': '({count}) {name}',

    'boot.connecting': 'Bağlanılıyor...',
    'boot.retry': 'Yeniden dene',
    'boot.reload': 'Sayfayı yenile',
    'boot.unreachableRetry': 'Sunucuya ulaşılamadı. Yeniden deneniyor...',
    'boot.noCrypto': 'Şifreleme bileşeni yüklenemedi veya bu tarayıcı güvenli rastgele sayı üretemiyor. Sayfayı yenileyin.',

    'common.cancel': 'İptal',
    'common.close': 'Kapat',
    'common.copy': 'Kopyala',
    'common.delete': 'Sil',
    'common.download': 'İndir',
    'common.hidden': 'Gizli',
    'common.hide': 'Gizle',
    'common.percent': '%{value}',
    'common.remove': 'Kaldır',
    'common.retry': 'Tekrar dene',
    'common.save': 'Kaydet',
    'common.show': 'Göster',
    'common.you': '(sen)',

    'clipboard.copied': 'Kopyalandı.',
    'clipboard.failed': 'Kopyalanamadı. Metni seçip elle kopyalayın.',

    'roles.owner': 'sahip',
    'roles.admin': 'yönetici',
    'roles.member': 'üye',
    'presence.online': 'çevrimiçi',
    'presence.offline': 'çevrimdışı',
    'users.unknown': 'Bilinmeyen kullanıcı',

    'auth.setupTitle': 'Kurulum',
    'auth.setupLead': 'Bu sunucu henüz kurulmadı. Sahip hesabını oluşturun.',
    'auth.username': 'Kullanıcı adı',
    'auth.password': 'Parola',
    'auth.password2': 'Parola (tekrar)',
    'auth.setupCode': 'Kurulum kodu',
    'auth.setupCodeHint': 'Sunucu penceresinde yazan kod',
    'auth.setupSubmit': 'Sahip hesabını oluştur',
    'auth.loginRegion': 'Giriş',
    'auth.tabs': 'Giriş veya kayıt',
    'auth.login': 'Giriş yap',
    'auth.register': 'Kayıt ol',
    'auth.nameHint': '2 ile 20 karakter arası. Harf, rakam, boşluk, nokta, tire ve alt çizgi kullanılabilir.',
    'auth.passwordHint': 'En az 8 karakter.',
    'auth.inviteCode': 'Davet kodu',
    'auth.logout': 'Çıkış yap',
    'auth.nameLength': 'Kullanıcı adı {min} ile {max} karakter arasında olmalı.',
    'auth.passwordLength': 'Parola {min} ile {max} karakter arasında olmalı.',
    'auth.passwordMismatch': 'Parolalar aynı değil.',
    'auth.enterSetupCode': 'Kurulum kodunu girin.',
    'auth.enterNameAndPassword': 'Kullanıcı adı ve parolayı girin.',
    'auth.enterInvite': 'Davet kodunu girin.',
    'auth.setupFailed': 'Kurulum tamamlanamadı.',
    'auth.stateFailed': 'Sunucu durumu alınamadı.',
    'auth.loginFailed': 'Giriş yapılamadı.',
    'auth.registerFailed': 'Kayıt olunamadı.',
    'auth.setupCodeWrong': 'Kurulum kodu hatalı. Sunucu penceresinde yazan kodu girin.',
    'auth.inviteCodeWrong': 'Davet kodu hatalı.',
    'auth.rateLimited': 'Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.',
    'auth.sessionEnded': 'Oturum sona erdi, lütfen yeniden giriş yapın.',
    'auth.banned': 'Bu hesap engellendi.',

    'invite.title': 'Davet bağlantısı',
    'invite.lead': 'Arkadaşlarınız bu bağlantıyla kayıt olur ve şifreleme anahtarını otomatik alır.',
    'invite.copyLink': 'Bağlantıyı kopyala',
    'invite.keyLabel': 'Şifreleme anahtarı',
    'invite.copyKey': 'Anahtarı kopyala',
    'invite.warning': 'Bu bağlantı şifreleme anahtarını içerir. Yalnızca güvendiğiniz kişilere, mümkünse uçtan uca şifreli bir uygulamayla gönderin. Anahtar sunucuya hiç gönderilmez.',
    'invite.keepKey': 'Anahtarı ayrıca güvenli bir yere not edin. Anahtar kaybolursa mesaj geçmişi okunamaz.',
    'invite.continue': 'Devam',

    'key.intro': 'Bu sunucudaki mesajlar uçtan uca şifreli. Okuyup yazabilmek için şifreleme anahtarını girin.',
    'key.introNoActive': 'Bu sunucudaki mesajlar uçtan uca şifreli. Sunucuda henüz etkin bir şifreleme anahtarı yok. Elinizde bir anahtar varsa girebilir veya anahtar olmadan devam edebilirsiniz.',
    'key.codeLabel': 'Anahtar kodu',
    'key.add': 'Ekle',
    'key.addShort': 'Anahtar ekle',
    'key.generateHint': 'Sunucuda henüz şifreleme anahtarı yok. Sahip veya yönetici olarak yeni bir anahtar oluşturabilirsiniz.',
    'key.generate': 'Anahtar oluştur',
    'key.skip': 'Anahtar olmadan devam et',
    'key.invalid': 'Anahtar hatalı.',
    'key.notActive': 'Anahtar eklendi ama bu sunucunun etkin anahtarı değil. Eski mesajları okumak için saklandı. Etkin anahtarı girin veya anahtar olmadan devam edin.',
    'key.added': 'Şifreleme anahtarı eklendi.',
    'key.createFailed': 'Şifreleme anahtarı oluşturulamadı.',
    'key.activateFailed': 'Etkin anahtar sunucuya bildirilemedi.',
    'fragment.keyAdded': 'Şifreleme anahtarı bu cihaza eklendi.',
    'fragment.keyInvalid': 'Bağlantıdaki şifreleme anahtarı hatalı. {reason}',

    'sidebar.label': 'Kanallar ve kullanıcı paneli',
    'sidebar.close': 'Kanal listesini kapat',
    'channels.label': 'Kanallar',
    'channels.text': 'Yazı kanalları',
    'channels.voice': 'Ses kanalları',
    'channels.unreadLabel_one': '{name}, {count} okunmamış mesaj',
    'channels.unreadLabel_other': '{name}, {count} okunmamış mesaj',
    'channel.welcome': '#{name} kanalına hoş geldin',
    'header.noKey': 'Anahtar yok',

    'members.title': 'Üyeler',
    'members.list': 'Üye listesi',
    'members.close': 'Üye listesini kapat',
    'members.online_one': 'Çevrimiçi ({count})',
    'members.online_other': 'Çevrimiçi ({count})',
    'members.offline_one': 'Çevrimdışı ({count})',
    'members.offline_other': 'Çevrimdışı ({count})',

    'user.online': 'Çevrimiçi',
    'user.mute': 'Mikrofonu kapat',
    'user.deafen': 'Sağırlaştır',

    'messages.label': 'Mesajlar',
    'messages.start': 'Kanalın başlangıcı. Mesajlar uçtan uca şifrelidir.',
    'messages.loadOlder': 'Daha eski mesajları yükle',
    'messages.loadingOlder': 'Yükleniyor...',
    'messages.loading': 'Mesajlar yükleniyor...',
    'messages.loadFailed': 'Mesajlar yüklenemedi.',
    'messages.olderFailed': 'Eski mesajlar yüklenemedi.',

    'msg.actions': 'Mesaj eylemleri',
    'msg.edit': 'Düzenle',
    'msg.delete': 'Sil',
    'msg.noKey': '[Şifreli mesaj, anahtar yok]',
    'msg.unverified': 'Doğrulanamayan mesaj',
    'msg.badFormat': 'Mesaj biçimi tanınmadı',
    'msg.edited': '(düzenlendi)',
    'msg.editedAt': 'Düzenlendi: {date}',
    'msg.srHead': '{name}, {time}: ',
    'msg.editLabel': 'Mesajı düzenle',
    'msg.editHint': 'Enter kaydeder, Esc iptal eder.',
    'msg.emptyEdit': 'Mesaj boş olamaz. Silmek için Sil seçeneğini kullanın.',
    'msg.editFailed': 'Mesaj düzenlenemedi.',
    'msg.deleteConfirm': 'Bu mesaj silinsin mi? Bu işlem geri alınamaz.',
    'msg.deleteFailed': 'Mesaj silinemedi.',

    'composer.message': 'Mesaj',
    'composer.photo': 'Fotoğraf',
    'composer.photoTitle': 'Fotoğraf ekle',
    'composer.file': 'Dosya',
    'composer.fileTitle': 'Dosya ekle',
    'composer.emoji': 'Emoji',
    'composer.send': 'Gönder',
    'composer.placeholder': '#{name} kanalına mesaj gönder',
    'composer.placeholderShort': '#{name} kanalına yaz',
    'composer.selectChannel': 'Kanal seçin',
    'composer.keyNeeded': 'Mesaj göndermek için şifreleme anahtarı gerekli',
    'composer.noActiveKey': 'Sunucuda henüz şifreleme anahtarı yok. Sahip veya yönetici anahtar oluşturmalı.',
    'composer.counterLeft_one': 'Kalan: {count}',
    'composer.counterLeft_other': 'Kalan: {count}',
    'composer.counterOver_one': 'Sınır {count} karakter aşıldı',
    'composer.counterOver_other': 'Sınır {count} karakter aşıldı',
    'composer.waitUploadsTitle': 'Yüklemeler bitince gönderilebilir',
    'composer.waitUploads': 'Yüklemeler bitince gönderebilirsiniz.',
    'composer.removeFailed': 'Yüklenemeyen ekleri kaldırın.',
    'composer.tooLong': 'Mesaj en fazla {max} karakter olabilir.',
    'composer.bodyTooLong': 'Mesaj çok uzun.',
    'composer.sealFailed': 'Mesaj şifrelenemedi.',
    'composer.sendFailed': 'Mesaj gönderilemedi.',
    'composer.rateLimited': 'Çok hızlı mesaj gönderiyorsunuz, lütfen biraz bekleyin.',

    'attach.list': 'Ekler',
    'attach.photoNote': 'Fotoğrafların konum bilgisi gönderilmeden önce silinir.',
    'attach.drop': 'Dosyaları göndermek için buraya bırakın',
    'attach.max': 'Bir mesajda en fazla {max} ek gönderilebilir.',
    'attach.tooBig': 'Dosya çok büyük. En fazla {max} gönderilebilir.',
    'attach.readFailed': 'Dosya okunamadı.',
    'attach.prepareFailed': 'Dosya hazırlanamadı.',
    'attach.photoFailed': 'Fotoğraf işlenemedi.',
    'attach.busy': 'Sunucu meşgul.',
    'attach.uploadFailed': 'Yükleme başarısız.',
    'attach.rateLimited': 'Çok fazla dosya yüklendi, lütfen biraz bekleyin.',
    'attach.remove': 'Kaldır: {name}',
    'attach.meta': '{size} · {status}',
    'attach.status.processing': 'Hazırlanıyor...',
    'attach.status.encrypting': 'Şifreleniyor...',
    'attach.status.queued': 'Sırada',
    'attach.status.uploading': 'Yükleniyor %{pct}',
    'attach.status.retry': 'Sunucu meşgul, yeniden denenecek',
    'attach.status.done': 'Hazır',
    'attach.status.error': 'Hata',

    'image.open': 'Resmi büyüt: {name}',
    'image.loading': 'Resim yükleniyor...',
    'image.failed': 'Resim açılamadı',
    'image.failedLabel': 'Resim açılamadı: {name}',
    'file.cardLabel': 'İndir: {name}, {size}',
    'file.cardLabelExec': 'İndir: {name}, {size}, Çalıştırılabilir dosya',
    'file.execBadge': 'Çalıştırılabilir dosya',
    'file.execConfirm': 'Bu dosya cihazınızda program çalıştırabilir. Yalnızca gönderene güveniyorsanız indirin.',
    'file.notFound': 'Dosya sunucuda bulunamadı.',
    'file.downloadFailed': 'Dosya indirilemedi.',
    'file.decryptFailed': 'Dosya çözülemedi. Veri bozuk veya anahtar hatalı.',
    'files.defaultName': 'dosya',
    'files.photoName': 'fotograf',
    'files.imageName': 'resim-{id}',

    'size.bytes_one': '{count} bayt',
    'size.bytes_other': '{count} bayt',
    'size.kb': '{value} KB',
    'size.mb': '{value} MB',
    'size.gb': '{value} GB',

    'notify.body': '{name}: {text}',
    'notify.photo': '[Fotoğraf]',
    'notify.file': '[Dosya]',
    'notify.encrypted': 'Şifreli mesaj',

    'emoji.picker': 'Emoji seçici',
    'emoji.categories': 'Emoji kategorileri',
    'emoji.shiftHelp': 'Shift ile seçince pencere açık kalır.',
    'emoji.recent': 'Son kullanılanlar',
    'emoji.empty': 'Henüz emoji kullanılmadı.',
    'emoji.faces': 'Yüzler',
    'emoji.people': 'İnsanlar ve el hareketleri',
    'emoji.nature': 'Hayvanlar ve doğa',
    'emoji.food': 'Yiyecek ve içecek',
    'emoji.activity': 'Etkinlik ve oyun',
    'emoji.travel': 'Seyahat ve yerler',
    'emoji.objects': 'Nesneler',
    'emoji.symbols': 'Semboller',
    'emoji.flags': 'Bayraklar',

    'voice.connecting': 'Bağlanıyor...',
    'voice.connectedTo': 'Ses bağlı: {name}',
    'voice.notConnected': 'Ses bağlı değil',
    'voice.joining': 'Sese bağlanıyor...',
    'voice.inChannel': 'Seste: {name}',
    'voice.disconnect': 'Bağlantıyı kes',
    'voice.leave': 'Ayrıl',
    'voice.unlock': 'Sesi başlat',
    'voice.pushToTalk': 'Bas konuş',
    'voice.talking': 'Konuşuyorsun',
    'voice.channelJoined_one': '{name} ses kanalı, {count} kişi, bağlısın',
    'voice.channelJoined_other': '{name} ses kanalı, {count} kişi, bağlısın',
    'voice.channelJoin_one': '{name} ses kanalı, {count} kişi, katılmak için seç',
    'voice.channelJoin_other': '{name} ses kanalı, {count} kişi, katılmak için seç',
    'voice.channelMembers': '{name} kanalındakiler',
    'voice.selfName': '{name} (sen)',
    'voice.peerFailed': 'Ses bağlantısı kurulamadı',
    'voice.localMuted': 'yerel olarak susturuldu',
    'voice.mutedTitle': 'Mikrofonu kapalı',
    'voice.mutedState': 'mikrofonu kapalı',
    'voice.deafenedTitle': 'Sağırlaştırılmış',
    'voice.deafenedState': 'sağırlaştırılmış',
    'voice.memberStates': '{name}, {states}',
    'voice.memberSettings': '{label}, ses ayarları',

    'peer.volume': 'Ses seviyesi',
    'peer.mute': 'Sustur',
    'peer.unmute': 'Susturmayı kaldır',
    'peer.note': 'Ayarlar bu kişiyle aynı ses kanalına katıldığında uygulanır.',

    'settings.title': 'Ayarlar',
    'settings.sections': 'Ayar bölümleri',
    'settings.close': 'Ayarları kapat',
    'settings.closeTitle': 'Kapat (Esc)',
    'settings.tab.account': 'Hesap',
    'settings.tab.voice': 'Ses',
    'settings.tab.crypto': 'Şifreleme',
    'settings.tab.server': 'Sunucu',
    'settings.tab.members': 'Üyeler',

    'settings.account.role': 'Rol: {role}',
    'settings.account.language': 'Dil / Language',
    'settings.account.changePassword': 'Parola değiştir',
    'settings.account.oldPassword': 'Mevcut parola',
    'settings.account.newPassword': 'Yeni parola',
    'settings.account.newPassword2': 'Yeni parola (tekrar)',
    'settings.account.passwordSubmit': 'Parolayı değiştir',
    'settings.account.notifications': 'Bildirimler',
    'settings.account.notifyLabel': 'Sayfa arka plandayken gelen mesajlar için bildirim göster',
    'settings.account.app': 'Uygulama',
    'settings.account.install': 'Uygulamayı yükle',
    'settings.account.iosHint': 'Safari\'de Paylaş menüsünden Ana Ekrana Ekle\'yi seçin.',
    'settings.account.session': 'Oturum',
    'settings.password.enterOld': 'Mevcut parolayı girin.',
    'settings.password.length': 'Yeni parola {min} ile {max} karakter arasında olmalı.',
    'settings.password.mismatch': 'Yeni parolalar aynı değil.',
    'settings.password.changed': 'Parola değiştirildi. Diğer cihazlardaki oturumlar kapatıldı.',
    'settings.password.failed': 'Parola değiştirilemedi.',
    'settings.password.oldWrong': 'Mevcut parola hatalı.',
    'settings.notify.unsupported': 'Bu tarayıcı bildirimleri desteklemiyor.',
    'settings.notify.enabled': 'Bildirimler açıldı.',
    'settings.notify.denied': 'Bildirim izni verilmedi. Tarayıcı ayarlarından izin verebilirsiniz.',

    'settings.voice.mic': 'Mikrofon',
    'settings.voice.refreshDevices': 'Cihazları yenile',
    'settings.voice.micHint': 'Mikrofon adları, mikrofon izni verildikten sonra görünür.',
    'settings.voice.defaultMic': 'Varsayılan mikrofon',
    'settings.voice.micUnnamed': 'Mikrofon {n}',
    'settings.voice.inputMode': 'Giriş modu',
    'settings.voice.modeVad': 'Ses etkinliği',
    'settings.voice.modePtt': 'Bas konuş (mikrofon yalnızca tuş basılıyken açılır)',
    'settings.voice.vadAuto': 'Hassasiyeti otomatik belirle',
    'settings.voice.threshold': 'Hassasiyet eşiği',
    'settings.voice.thresholdHint': 'Ses bu eşiği aşınca mikrofon açılır. Arka plan gürültüsü gidiyorsa eşiği yükseltin.',
    'settings.voice.auto': 'Otomatik',
    'settings.voice.autoValue': 'Otomatik ({value} dB)',
    'settings.voice.dbValue': '{value} dB',
    'settings.voice.msValue': '{value} ms',
    'settings.voice.pttKey': 'Bas-konuş tuşu:',
    'settings.voice.changeKey': 'Tuşu değiştir',
    'settings.voice.capturePrompt': 'Yeni tuşa basın (fare yan tuşu veya oyun kolu düğmesi de olabilir). Vazgeçmek için Esc.',
    'settings.voice.pttKeySet': 'Bas-konuş tuşu: {key}',
    'settings.voice.release': 'Bırakma gecikmesi',
    'settings.voice.focusNote': 'Tarayıcılar klavye, fare ve oyun kolu girdisini yalnızca odaktaki sayfaya iletir. Oyun ön plandayken bas-konuş tuşu çalışmaz, oyun sırasında Ses etkinliği modunu kullanın. Telefon ve tablette ekrandaki Bas konuş düğmesini kullanabilirsiniz.',
    'settings.voice.level': 'Giriş seviyesi',
    'settings.voice.levelSpeaking': 'Konuşurken çubuk yeşile döner.',
    'settings.voice.levelOnlyInVoice': 'Seviye yalnızca ses kanalındayken gösterilir.',

    'settings.crypto.intro': 'Mesajlar, dosyalar ve ses kurulum bilgileri bu cihazda şifrelenir. Anahtarlar yalnızca bu cihazın tarayıcısında saklanır ve sunucuya gönderilmez.',
    'settings.crypto.keyring': 'Anahtarlık',
    'settings.crypto.active': 'Etkin anahtar',
    'settings.crypto.copyInvite': 'Davet bağlantısını kopyala',
    'settings.crypto.newKey': 'Yeni anahtar oluştur',
    'settings.crypto.newKeyWarning': 'Yeni anahtar yalnızca bundan sonraki mesajları korur. Herkese yeni davet bağlantısını göndermeniz gerekir. Eski anahtarı silmeyin, eski mesajlar onunla okunur.',
    'settings.crypto.newKeyConfirm': 'Yeni anahtar yalnızca bundan sonraki mesajları korur. Herkese yeni davet bağlantısını göndermeniz gerekir. Eski anahtarı silmeyin, eski mesajlar onunla okunur. Devam edilsin mi?',
    'settings.crypto.newKeyActivated': 'Yeni anahtar etkinleştirildi. Davet bağlantısını herkese gönderin.',
    'settings.crypto.newInvite': 'Yeni davet bağlantısı',
    'settings.crypto.noKeys': 'Bu cihazda kayıtlı anahtar yok.',
    'settings.crypto.activeBadge': 'etkin',
    'settings.crypto.addedAt': 'Eklendi: {date}',
    'settings.crypto.removeKey': 'Anahtarı kaldır: {kid}',
    'settings.crypto.removeActiveConfirm': 'Bu, sunucunun etkin anahtarı. Kaldırırsanız bu cihazda mesaj okuyamaz ve gönderemezsiniz. Kaldırılsın mı?',
    'settings.crypto.removeConfirm': 'Bu anahtarla şifrelenmiş eski mesajlar bu cihazda okunamaz hale gelir. Kaldırılsın mı?',
    'settings.crypto.activeMissing': 'Etkin anahtar ({kid}) bu cihazda yok. Anahtarı yukarıdan ekleyin.',
    'settings.crypto.noActive': 'Sunucuda henüz etkin anahtar yok.',
    'settings.crypto.enterKey': 'Anahtar kodunu girin.',
    'settings.crypto.activeAdded': 'Etkin anahtar eklendi.',
    'settings.crypto.keyAdded': 'Anahtar eklendi ({kid}).',

    'settings.server.name': 'Sunucu adı',
    'settings.server.rotate': 'Yenile',
    'settings.server.rotateHint': 'Davet kodunu yenilemek, eski davet bağlantılarıyla yeni kayıtları durdurur.',
    'settings.server.unavailable': 'Alınamadı',
    'settings.server.newChannel': 'Yeni kanal adı',
    'settings.server.channelType': 'Kanal türü',
    'settings.server.typeText': 'Yazı',
    'settings.server.typeVoice': 'Ses',
    'settings.server.create': 'Oluştur',
    'settings.server.moveUp': '{name} yukarı taşı',
    'settings.server.moveDown': '{name} aşağı taşı',
    'settings.server.rename': 'Yeniden adlandır',
    'settings.server.renameLabel': '{name} kanalını yeniden adlandır',
    'settings.server.deleteLabel': '{name} kanalını sil',
    'settings.server.newName': 'Yeni ad',
    'settings.server.renamed': 'Kanal yeniden adlandırıldı.',
    'settings.server.renameFailed': 'Kanal yeniden adlandırılamadı.',
    'settings.server.moveFailed': 'Kanal taşınamadı.',
    'settings.server.deleteVoiceConfirm': '{name} ses kanalı silinsin mi? İçindeki kişiler sesten çıkarılır.',
    'settings.server.deleteTextConfirm': '#{name} kanalı ve tüm mesajları, dosyaları kalıcı olarak silinsin mi?',
    'settings.server.deleted': 'Kanal silindi.',
    'settings.server.deleteFailed': 'Kanal silinemedi.',
    'settings.server.enterChannelName': 'Kanal adını girin.',
    'settings.server.textCreated': 'Yazı kanalı oluşturuldu.',
    'settings.server.voiceCreated': 'Ses kanalı oluşturuldu.',
    'settings.server.createFailed': 'Kanal oluşturulamadı.',
    'settings.server.enterName': 'Sunucu adını girin.',
    'settings.server.nameSaved': 'Sunucu adı kaydedildi.',
    'settings.server.nameFailed': 'Sunucu adı kaydedilemedi.',
    'settings.server.rotateConfirm': 'Davet kodu yenilensin mi? Eski davet bağlantılarıyla artık kayıt olunamaz.',
    'settings.server.rotated': 'Davet kodu yenilendi. Yeni davet bağlantısını Şifreleme sekmesinden kopyalayabilirsiniz.',
    'settings.server.rotateFailed': 'Davet kodu yenilenemedi.',

    'settings.members.tempHint': 'Geçici parola yalnızca bir kez gösterilir. Kişiye güvenli bir yoldan iletin.',
    'settings.members.tempLabel': '{name} için geçici parola:',
    'settings.members.banned': 'Engellenenler',
    'settings.members.bannedState': 'engellendi',
    'settings.members.sub': '{role}, {status}',
    'settings.members.makeMember': 'Üye yap',
    'settings.members.makeAdmin': 'Yönetici yap',
    'settings.members.ban': 'Engelle',
    'settings.members.unban': 'Engeli kaldır',
    'settings.members.resetPassword': 'Parola sıfırla',
    'settings.members.nowAdmin': '{name} artık yönetici.',
    'settings.members.nowMember': '{name} artık üye.',
    'settings.members.roleFailed': 'Rol değiştirilemedi.',
    'settings.members.banConfirm': '{name} engellensin mi? Tüm oturumları kapatılır ve giriş yapamaz.',
    'settings.members.bannedOk': '{name} engellendi.',
    'settings.members.unbannedOk': '{name} için engel kaldırıldı.',
    'settings.members.actionFailed': 'İşlem yapılamadı.',
    'settings.members.resetConfirm': '{name} için parola sıfırlansın mı? Kişinin tüm oturumları kapanır.',
    'settings.members.resetFailed': 'Parola sıfırlanamadı.',

    // Ses modülünün tuş ve atama adları (voice.bindingLabel)
    'bindings.none': 'Atanmamış',
    'bindings.key': '{key} tuşu',
    'bindings.mouseMiddle': 'Fare orta tuşu',
    'bindings.mouseSide': 'Fare yan tuşu {n}',
    'bindings.gamepad': 'Oyun kolu düğmesi {n}',
    'keys.numpad': 'Num {key}',
    'keys.Space': 'Boşluk',
    'keys.Enter': 'Enter',
    'keys.Tab': 'Tab',
    'keys.Backspace': 'Geri silme',
    'keys.CapsLock': 'Caps Lock',
    'keys.ShiftLeft': 'Sol Shift',
    'keys.ShiftRight': 'Sağ Shift',
    'keys.ControlLeft': 'Sol Ctrl',
    'keys.ControlRight': 'Sağ Ctrl',
    'keys.AltLeft': 'Sol Alt',
    'keys.AltRight': 'Sağ Alt (Alt Gr)',
    'keys.MetaLeft': 'Sol Windows/Cmd',
    'keys.MetaRight': 'Sağ Windows/Cmd',
    'keys.ArrowUp': 'Yukarı ok',
    'keys.ArrowDown': 'Aşağı ok',
    'keys.ArrowLeft': 'Sol ok',
    'keys.ArrowRight': 'Sağ ok',
    'keys.Insert': 'Insert',
    'keys.Delete': 'Delete',
    'keys.Home': 'Home',
    'keys.End': 'End',
    'keys.PageUp': 'Page Up',
    'keys.PageDown': 'Page Down',
    'keys.ContextMenu': 'Menü',
    'keys.Pause': 'Pause',
    'keys.ScrollLock': 'Scroll Lock',
    'keys.PrintScreen': 'Print Screen',
    'keys.NumLock': 'Num Lock',
    'keys.NumpadEnter': 'Num Enter',

    // Şifreleme modülünün hata kodları (Error.code)
    'errors.key.empty': 'Lütfen 28 karakterlik anahtar kodunu girin.',
    'errors.key.bad_length': 'Anahtar kodu 28 karakterden oluşmalı.',
    'errors.key.bad_char': 'Anahtar kodunda geçersiz bir karakter var.',
    'errors.key.bad_padding': 'Anahtar kodunda yazım hatası var, lütfen kontrol edin.',
    'errors.key.bad_checksum': 'Anahtar kodunda yazım hatası var, lütfen kontrol edin.',
    'errors.key.no_library': 'Şifreleme kütüphanesi yüklenemedi. Lütfen sayfayı yenileyin.',
    'errors.key.no_random': 'Bu tarayıcıda güvenli rastgele sayı üreteci yok, anahtar oluşturulamıyor.',
    'errors.e2ee.no_key': 'Şifreleme anahtarı bu cihazda yok.',
    'errors.e2ee.no_library': 'Şifreleme kütüphanesi yüklenemedi. Lütfen sayfayı yenileyin.',
    'errors.e2ee.no_random': 'Bu tarayıcıda güvenli rastgele sayı üreteci yok, şifreleme yapılamıyor.',
    'errors.e2ee.seal_failed': 'İçerik şifrelenemedi.',
    'errors.e2ee.bad_type': 'Şifreleme için geçersiz veri.',
    'errors.e2ee.bad_base64': 'Şifreli veri bozuk.',
    'errors.e2ee.bad_format': 'Şifreli içeriğin biçimi bozuk.',
    'errors.e2ee.bad_data': 'Doğrulanamayan mesaj',

    // Ses modülünün hata kodları (snapshot.errorCode, Error.code)
    'errors.mic_denied': 'Mikrofon izni verilmedi.',
    'errors.mic_not_found': 'Mikrofon bulunamadı.',
    'errors.mic_failed': 'Mikrofon açılamadı.',
    'errors.no_key': 'Sesli sohbet için şifreleme anahtarı gerekli.',
    'errors.insecure': 'Sesli sohbet yalnızca https:// ile başlayan adreste çalışır. Tünel adresini kullanın.',
    'errors.unsupported': 'Bu tarayıcı sesli sohbeti desteklemiyor. Oyun konsolundaysanız telefonunuzun tarayıcısından katılabilirsiniz.',
    'errors.connect_failed': 'Bazı kişilerle ses bağlantısı kurulamadı. Ağınız doğrudan bağlantıya izin vermiyor olabilir, TURN sunucusu gerekebilir.',
    'errors.kicked': 'Sesli bağlantı kesildi, yeniden katılabilirsiniz.',
    'errors.join_failed': 'Ses kanalına katılınamadı.',
    'errors.bad_channel': 'Geçersiz ses kanalı.',

    // Sunucu hata kodları (yanıttaki code alanı)
    'errors.bad_request': 'İstek geçersiz.',
    'errors.too_large': 'İstek çok büyük.',
    'errors.not_found': 'İstenen adres bulunamadı.',
    'errors.method_not_allowed': 'Bu adres bu istek yöntemini desteklemiyor.',
    'errors.invalid_token': 'Oturumunuz sona erdi. Lütfen yeniden giriş yapın.',
    'errors.banned': 'Bu hesap engellendi.',
    'errors.forbidden': 'Bu işlem için yetkiniz yok.',
    'errors.invalid_name': 'Kullanıcı adı 2 ile 32 karakter arasında olmalı ve yalnızca küçük İngilizce harf, rakam, alt çizgi ve nokta içermelidir. Nokta ile başlayamaz veya bitemez, iki nokta yan yana gelemez.',
    'errors.weak_password': 'Parola 8 ile 128 karakter arasında olmalı.',
    'errors.bad_auth_key': 'Kimlik doğrulama anahtarı geçersiz.',
    'errors.bad_kdf': 'Anahtar türetme ayarları geçersiz.',
    'errors.bad_keys': 'Güvenlik anahtarı geçersiz.',
    'errors.keys_exist': 'Bu hesabın güvenlik anahtarı zaten var.',
    'errors.no_keys': 'Bu hesabın henüz güvenlik anahtarı yok.',
    'errors.bad_identity': 'Kimlik kaydı geçersiz.',
    'errors.bad_code': 'Kod hatalı.',
    'errors.name_taken': 'Bu kullanıcı adı zaten kullanılıyor.',
    'errors.server_full': 'Sunucudaki hesap sayısı üst sınıra ulaştı.',
    'errors.bad_credentials': 'Kullanıcı adı veya parola hatalı.',
    'errors.rate_limited': 'Çok fazla istek gönderildi. Lütfen biraz bekleyip tekrar deneyin.',
    'errors.channel_not_found': 'Kanal bulunamadı.',
    'errors.message_not_found': 'Mesaj bulunamadı.',
    'errors.upload_not_found': 'Dosya bulunamadı.',
    'errors.user_not_found': 'Kullanıcı bulunamadı.',
    'errors.bad_body': 'Mesaj geçersiz veya çok uzun.',
    'errors.bad_uploads': 'Mesaja eklenen dosyalar geçersiz.',
    'errors.empty_upload': 'Boş dosya yüklenemez.',
    'errors.quota_full': 'Sunucudaki dosya alanı doldu. Sunucu sahibine başvurun.',
    'errors.busy': 'Sunucu şu anda başka yüklemeleri işliyor, birazdan tekrar deneyin.',
    'errors.invalid_channel_name': 'Kanal adı 1 ile 30 karakter arasında olmalı ve yalnızca harf, rakam, boşluk, nokta, alt çizgi veya kısa çizgi içermelidir.',
    'errors.invalid_channel_type': 'Kanal türü yazı veya ses olmalıdır.',
    'errors.channel_exists': 'Bu adda bir kanal zaten var.',
    'errors.too_many_channels': 'Kanal sayısı üst sınıra ulaştı.',
    'errors.last_text_channel': 'Son yazı kanalı silinemez.',
    'errors.invalid_server_name': 'Sunucu adı 1 ile 40 karakter arasında olmalıdır.',
    'errors.bad_kid': 'Anahtar kimliği geçersiz.',
    'errors.voice_full': 'Bu ses kanalı dolu.',
    'errors.bad_signal': 'Ses sinyali geçersiz.',
    'errors.not_in_voice': 'Önce bir ses kanalına katılmalısınız.',
    'errors.peer_not_found': 'Bağlanılmak istenen kişi bu ses kanalında değil.',
    'errors.owner_cannot_delete': 'Sunucu sahibi hesabını silemez.',
    'errors.self': 'Bu işlem kendi hesabınıza uygulanamaz.',
    'errors.already_friends': 'Bu kişiyle zaten arkadaşsınız.',
    'errors.already_pending': 'Bu kişiye zaten arkadaşlık isteği gönderdiniz.',
    'errors.request_failed': 'Arkadaşlık isteği gönderilemedi.',
    'errors.request_not_found': 'Arkadaşlık isteği bulunamadı.',
    'errors.not_friends': 'Bu kişiyle arkadaş değilsiniz.',
    'errors.too_many_pending': 'Bekleyen arkadaşlık isteği sayısı üst sınıra ulaştı.',
    'errors.too_many_friends': 'Arkadaş sayısı üst sınıra ulaştı.',
    'errors.dm_not_allowed': 'Bu kişiye özel mesaj gönderilemiyor.',
    'errors.too_many_dms': 'Özel mesaj konuşması sayısı üst sınıra ulaştı.',
    'errors.shutting_down': 'Sunucu kapanıyor.',
    'errors.server_error': 'Sunucuda beklenmeyen bir hata oluştu.',
    'errors.session_not_found': 'Oturum bulunamadı.',
    'errors.bad_profile': 'Profil bilgileri geçersiz.',
    'errors.bad_avatar': 'Profil resmi geçersiz.',
    'errors.avatar_too_large': 'Profil resmi çok büyük.',
    'errors.bad_status': 'Durum geçersiz. Çevrimiçi, boşta, rahatsız etmeyin veya görünmez seçilebilir.'
  }

  const en = {
    'app.name': 'Telsiz',
    'app.reconnecting': 'Connection lost, reconnecting...',
    'app.installed': 'App installed.',
    'main.label': 'Chat',
    'net.unreachable': 'Could not reach the server.',
    'title.unread': '({count}) {name}',

    'boot.connecting': 'Connecting...',
    'boot.retry': 'Try again',
    'boot.reload': 'Reload page',
    'boot.unreachableRetry': 'Could not reach the server. Retrying...',
    'boot.noCrypto': 'The encryption component could not be loaded, or this browser cannot generate secure random numbers. Please reload the page.',

    'common.cancel': 'Cancel',
    'common.close': 'Close',
    'common.copy': 'Copy',
    'common.delete': 'Delete',
    'common.download': 'Download',
    'common.hidden': 'Hidden',
    'common.hide': 'Hide',
    'common.percent': '{value}%',
    'common.remove': 'Remove',
    'common.retry': 'Try again',
    'common.save': 'Save',
    'common.show': 'Show',
    'common.you': '(you)',

    'clipboard.copied': 'Copied.',
    'clipboard.failed': 'Could not copy. Select the text and copy it manually.',

    'roles.owner': 'owner',
    'roles.admin': 'admin',
    'roles.member': 'member',
    'presence.online': 'online',
    'presence.offline': 'offline',
    'users.unknown': 'Unknown user',

    'auth.setupTitle': 'Setup',
    'auth.setupLead': 'This server has not been set up yet. Create the owner account.',
    'auth.username': 'Username',
    'auth.password': 'Password',
    'auth.password2': 'Password (again)',
    'auth.setupCode': 'Setup code',
    'auth.setupCodeHint': 'The code shown in the server window',
    'auth.setupSubmit': 'Create owner account',
    'auth.loginRegion': 'Sign in',
    'auth.tabs': 'Sign in or sign up',
    'auth.login': 'Sign in',
    'auth.register': 'Sign up',
    'auth.nameHint': 'Between 2 and 20 characters. Letters, digits, spaces, dots, hyphens and underscores are allowed.',
    'auth.passwordHint': 'At least 8 characters.',
    'auth.inviteCode': 'Invite code',
    'auth.logout': 'Sign out',
    'auth.nameLength': 'The username must be between {min} and {max} characters.',
    'auth.passwordLength': 'The password must be between {min} and {max} characters.',
    'auth.passwordMismatch': 'The passwords do not match.',
    'auth.enterSetupCode': 'Enter the setup code.',
    'auth.enterNameAndPassword': 'Enter your username and password.',
    'auth.enterInvite': 'Enter the invite code.',
    'auth.setupFailed': 'Setup could not be completed.',
    'auth.stateFailed': 'Could not load the server state.',
    'auth.loginFailed': 'Could not sign in.',
    'auth.registerFailed': 'Could not sign up.',
    'auth.setupCodeWrong': 'The setup code is wrong. Enter the code shown in the server window.',
    'auth.inviteCodeWrong': 'The invite code is wrong.',
    'auth.rateLimited': 'Too many attempts. Please try again in a few minutes.',
    'auth.sessionEnded': 'Your session has ended. Please sign in again.',
    'auth.banned': 'This account has been banned.',

    'invite.title': 'Invite link',
    'invite.lead': 'Your friends sign up with this link and receive the encryption key automatically.',
    'invite.copyLink': 'Copy link',
    'invite.keyLabel': 'Encryption key',
    'invite.copyKey': 'Copy key',
    'invite.warning': 'This link contains the encryption key. Only send it to people you trust, ideally through an end-to-end encrypted app. The key is never sent to the server.',
    'invite.keepKey': 'Also keep a copy of the key somewhere safe. If the key is lost, the message history cannot be read.',
    'invite.continue': 'Continue',

    'key.intro': 'Messages on this server are end-to-end encrypted. Enter the encryption key to read and write them.',
    'key.introNoActive': 'Messages on this server are end-to-end encrypted. The server does not have an active encryption key yet. If you have a key, you can enter it, or you can continue without one.',
    'key.codeLabel': 'Key code',
    'key.add': 'Add',
    'key.addShort': 'Add key',
    'key.generateHint': 'The server does not have an encryption key yet. As the owner or an admin, you can create a new one.',
    'key.generate': 'Create key',
    'key.skip': 'Continue without a key',
    'key.invalid': 'The key is invalid.',
    'key.notActive': 'The key was added, but it is not the active key of this server. It has been kept so that older messages can be read. Enter the active key or continue without one.',
    'key.added': 'Encryption key added.',
    'key.createFailed': 'Could not create the encryption key.',
    'key.activateFailed': 'Could not register the active key with the server.',
    'fragment.keyAdded': 'The encryption key was added to this device.',
    'fragment.keyInvalid': 'The encryption key in the link is invalid. {reason}',

    'sidebar.label': 'Channels and user panel',
    'sidebar.close': 'Close channel list',
    'channels.label': 'Channels',
    'channels.text': 'Text channels',
    'channels.voice': 'Voice channels',
    'channels.unreadLabel_one': '{name}, {count} unread message',
    'channels.unreadLabel_other': '{name}, {count} unread messages',
    'channel.welcome': 'Welcome to #{name}',
    'header.noKey': 'No key',

    'members.title': 'Members',
    'members.list': 'Member list',
    'members.close': 'Close member list',
    'members.online_one': 'Online ({count})',
    'members.online_other': 'Online ({count})',
    'members.offline_one': 'Offline ({count})',
    'members.offline_other': 'Offline ({count})',

    'user.online': 'Online',
    'user.mute': 'Mute microphone',
    'user.deafen': 'Deafen',

    'messages.label': 'Messages',
    'messages.start': 'This is the start of the channel. Messages are end-to-end encrypted.',
    'messages.loadOlder': 'Load older messages',
    'messages.loadingOlder': 'Loading...',
    'messages.loading': 'Loading messages...',
    'messages.loadFailed': 'Could not load messages.',
    'messages.olderFailed': 'Could not load older messages.',

    'msg.actions': 'Message actions',
    'msg.edit': 'Edit',
    'msg.delete': 'Delete',
    'msg.noKey': '[Encrypted message, no key]',
    'msg.unverified': 'Message could not be verified',
    'msg.badFormat': 'Unrecognized message format',
    'msg.edited': '(edited)',
    'msg.editedAt': 'Edited: {date}',
    'msg.srHead': '{name}, {time}: ',
    'msg.editLabel': 'Edit message',
    'msg.editHint': 'Enter to save, Esc to cancel.',
    'msg.emptyEdit': 'A message cannot be empty. To remove it, use Delete.',
    'msg.editFailed': 'Could not edit the message.',
    'msg.deleteConfirm': 'Delete this message? This cannot be undone.',
    'msg.deleteFailed': 'Could not delete the message.',

    'composer.message': 'Message',
    'composer.photo': 'Photo',
    'composer.photoTitle': 'Add photo',
    'composer.file': 'File',
    'composer.fileTitle': 'Add file',
    'composer.emoji': 'Emoji',
    'composer.send': 'Send',
    'composer.placeholder': 'Message #{name}',
    'composer.placeholderShort': 'Write in #{name}',
    'composer.selectChannel': 'Select a channel',
    'composer.keyNeeded': 'An encryption key is required to send messages',
    'composer.noActiveKey': 'The server does not have an encryption key yet. The owner or an admin needs to create one.',
    'composer.counterLeft_one': '{count} character left',
    'composer.counterLeft_other': '{count} characters left',
    'composer.counterOver_one': 'Limit exceeded by {count} character',
    'composer.counterOver_other': 'Limit exceeded by {count} characters',
    'composer.waitUploadsTitle': 'You can send once the uploads finish',
    'composer.waitUploads': 'You can send once the uploads finish.',
    'composer.removeFailed': 'Remove the attachments that failed to upload.',
    'composer.tooLong': 'A message can be at most {max} characters long.',
    'composer.bodyTooLong': 'The message is too long.',
    'composer.sealFailed': 'The message could not be encrypted.',
    'composer.sendFailed': 'The message could not be sent.',
    'composer.rateLimited': 'You are sending messages too quickly. Please wait a moment.',

    'attach.list': 'Attachments',
    'attach.photoNote': 'Location data is removed from photos before they are sent.',
    'attach.drop': 'Drop files here to send them',
    'attach.max': 'A message can have at most {max} attachments.',
    'attach.tooBig': 'The file is too large. The maximum size is {max}.',
    'attach.readFailed': 'The file could not be read.',
    'attach.prepareFailed': 'The file could not be prepared.',
    'attach.photoFailed': 'The photo could not be processed.',
    'attach.busy': 'The server is busy.',
    'attach.uploadFailed': 'Upload failed.',
    'attach.rateLimited': 'Too many files uploaded. Please wait a moment.',
    'attach.remove': 'Remove: {name}',
    'attach.meta': '{size} · {status}',
    'attach.status.processing': 'Preparing...',
    'attach.status.encrypting': 'Encrypting...',
    'attach.status.queued': 'Queued',
    'attach.status.uploading': 'Uploading {pct}%',
    'attach.status.retry': 'Server busy, will retry',
    'attach.status.done': 'Ready',
    'attach.status.error': 'Error',

    'image.open': 'Enlarge image: {name}',
    'image.loading': 'Loading image...',
    'image.failed': 'Image could not be opened',
    'image.failedLabel': 'Image could not be opened: {name}',
    'file.cardLabel': 'Download: {name}, {size}',
    'file.cardLabelExec': 'Download: {name}, {size}, Executable file',
    'file.execBadge': 'Executable file',
    'file.execConfirm': 'This file can run programs on your device. Only download it if you trust the sender.',
    'file.notFound': 'The file was not found on the server.',
    'file.downloadFailed': 'The file could not be downloaded.',
    'file.decryptFailed': 'The file could not be decrypted. The data is corrupted or the key is wrong.',
    'files.defaultName': 'file',
    'files.photoName': 'photo',
    'files.imageName': 'image-{id}',

    'size.bytes_one': '{count} byte',
    'size.bytes_other': '{count} bytes',
    'size.kb': '{value} KB',
    'size.mb': '{value} MB',
    'size.gb': '{value} GB',

    'notify.body': '{name}: {text}',
    'notify.photo': '[Photo]',
    'notify.file': '[File]',
    'notify.encrypted': 'Encrypted message',

    'emoji.picker': 'Emoji picker',
    'emoji.categories': 'Emoji categories',
    'emoji.shiftHelp': 'Hold Shift while choosing to keep the picker open.',
    'emoji.recent': 'Recently used',
    'emoji.empty': 'No emoji used yet.',
    'emoji.faces': 'Smileys',
    'emoji.people': 'People and gestures',
    'emoji.nature': 'Animals and nature',
    'emoji.food': 'Food and drink',
    'emoji.activity': 'Activities and games',
    'emoji.travel': 'Travel and places',
    'emoji.objects': 'Objects',
    'emoji.symbols': 'Symbols',
    'emoji.flags': 'Flags',

    'voice.connecting': 'Connecting...',
    'voice.connectedTo': 'Voice connected: {name}',
    'voice.notConnected': 'Voice not connected',
    'voice.joining': 'Joining voice...',
    'voice.inChannel': 'In voice: {name}',
    'voice.disconnect': 'Disconnect',
    'voice.leave': 'Leave',
    'voice.unlock': 'Start audio',
    'voice.pushToTalk': 'Push to talk',
    'voice.talking': 'Talking',
    'voice.channelJoined_one': '{name} voice channel, {count} person, you are connected',
    'voice.channelJoined_other': '{name} voice channel, {count} people, you are connected',
    'voice.channelJoin_one': '{name} voice channel, {count} person, select to join',
    'voice.channelJoin_other': '{name} voice channel, {count} people, select to join',
    'voice.channelMembers': 'People in {name}',
    'voice.selfName': '{name} (you)',
    'voice.peerFailed': 'Voice connection failed',
    'voice.localMuted': 'muted locally',
    'voice.mutedTitle': 'Microphone off',
    'voice.mutedState': 'microphone off',
    'voice.deafenedTitle': 'Deafened',
    'voice.deafenedState': 'deafened',
    'voice.memberStates': '{name}, {states}',
    'voice.memberSettings': '{label}, voice settings',

    'peer.volume': 'Volume',
    'peer.mute': 'Mute',
    'peer.unmute': 'Unmute',
    'peer.note': 'These settings take effect when you are in the same voice channel as this person.',

    'settings.title': 'Settings',
    'settings.sections': 'Settings sections',
    'settings.close': 'Close settings',
    'settings.closeTitle': 'Close (Esc)',
    'settings.tab.account': 'Account',
    'settings.tab.voice': 'Voice',
    'settings.tab.crypto': 'Encryption',
    'settings.tab.server': 'Server',
    'settings.tab.members': 'Members',

    'settings.account.role': 'Role: {role}',
    'settings.account.language': 'Language / Dil',
    'settings.account.changePassword': 'Change password',
    'settings.account.oldPassword': 'Current password',
    'settings.account.newPassword': 'New password',
    'settings.account.newPassword2': 'New password (again)',
    'settings.account.passwordSubmit': 'Change password',
    'settings.account.notifications': 'Notifications',
    'settings.account.notifyLabel': 'Show notifications for messages that arrive while the page is in the background',
    'settings.account.app': 'App',
    'settings.account.install': 'Install app',
    'settings.account.iosHint': 'In Safari, choose Add to Home Screen from the Share menu.',
    'settings.account.session': 'Session',
    'settings.password.enterOld': 'Enter your current password.',
    'settings.password.length': 'The new password must be between {min} and {max} characters.',
    'settings.password.mismatch': 'The new passwords do not match.',
    'settings.password.changed': 'Password changed. Sessions on your other devices have been signed out.',
    'settings.password.failed': 'Could not change the password.',
    'settings.password.oldWrong': 'The current password is wrong.',
    'settings.notify.unsupported': 'This browser does not support notifications.',
    'settings.notify.enabled': 'Notifications are on.',
    'settings.notify.denied': 'Notification permission was not granted. You can allow it in your browser settings.',

    'settings.voice.mic': 'Microphone',
    'settings.voice.refreshDevices': 'Refresh devices',
    'settings.voice.micHint': 'Microphone names appear after microphone permission has been granted.',
    'settings.voice.defaultMic': 'Default microphone',
    'settings.voice.micUnnamed': 'Microphone {n}',
    'settings.voice.inputMode': 'Input mode',
    'settings.voice.modeVad': 'Voice activity',
    'settings.voice.modePtt': 'Push to talk (the microphone is only on while the key is held)',
    'settings.voice.vadAuto': 'Determine sensitivity automatically',
    'settings.voice.threshold': 'Sensitivity threshold',
    'settings.voice.thresholdHint': 'The microphone opens when your voice goes above this threshold. If background noise gets through, raise the threshold.',
    'settings.voice.auto': 'Automatic',
    'settings.voice.autoValue': 'Automatic ({value} dB)',
    'settings.voice.dbValue': '{value} dB',
    'settings.voice.msValue': '{value} ms',
    'settings.voice.pttKey': 'Push-to-talk key:',
    'settings.voice.changeKey': 'Change key',
    'settings.voice.capturePrompt': 'Press a new key (a side mouse button or a gamepad button also works). Press Esc to cancel.',
    'settings.voice.pttKeySet': 'Push-to-talk key: {key}',
    'settings.voice.release': 'Release delay',
    'settings.voice.focusNote': 'Browsers only pass keyboard, mouse and gamepad input to the page that has focus. While a game is in the foreground the push-to-talk key does not work, so use Voice activity mode while gaming. On phones and tablets you can use the on-screen Push to talk button.',
    'settings.voice.level': 'Input level',
    'settings.voice.levelSpeaking': 'The bar turns green while you are talking.',
    'settings.voice.levelOnlyInVoice': 'The level is only shown while you are in a voice channel.',

    'settings.crypto.intro': 'Messages, files and voice setup data are encrypted on this device. Keys are stored only in this device\'s browser and are never sent to the server.',
    'settings.crypto.keyring': 'Keyring',
    'settings.crypto.active': 'Active key',
    'settings.crypto.copyInvite': 'Copy invite link',
    'settings.crypto.newKey': 'Create new key',
    'settings.crypto.newKeyWarning': 'A new key only protects messages sent from now on. You will need to send everyone the new invite link. Do not delete the old key, because older messages are read with it.',
    'settings.crypto.newKeyConfirm': 'A new key only protects messages sent from now on. You will need to send everyone the new invite link. Do not delete the old key, because older messages are read with it. Continue?',
    'settings.crypto.newKeyActivated': 'The new key is now active. Send the invite link to everyone.',
    'settings.crypto.newInvite': 'New invite link',
    'settings.crypto.noKeys': 'No keys are stored on this device.',
    'settings.crypto.activeBadge': 'active',
    'settings.crypto.addedAt': 'Added: {date}',
    'settings.crypto.removeKey': 'Remove key: {kid}',
    'settings.crypto.removeActiveConfirm': 'This is the active key of the server. If you remove it, you will not be able to read or send messages on this device. Remove it?',
    'settings.crypto.removeConfirm': 'Older messages encrypted with this key will no longer be readable on this device. Remove it?',
    'settings.crypto.activeMissing': 'The active key ({kid}) is not on this device. Add it above.',
    'settings.crypto.noActive': 'The server does not have an active key yet.',
    'settings.crypto.enterKey': 'Enter the key code.',
    'settings.crypto.activeAdded': 'Active key added.',
    'settings.crypto.keyAdded': 'Key added ({kid}).',

    'settings.server.name': 'Server name',
    'settings.server.rotate': 'Renew',
    'settings.server.rotateHint': 'Renewing the invite code stops new sign-ups through old invite links.',
    'settings.server.unavailable': 'Unavailable',
    'settings.server.newChannel': 'New channel name',
    'settings.server.channelType': 'Channel type',
    'settings.server.typeText': 'Text',
    'settings.server.typeVoice': 'Voice',
    'settings.server.create': 'Create',
    'settings.server.moveUp': 'Move {name} up',
    'settings.server.moveDown': 'Move {name} down',
    'settings.server.rename': 'Rename',
    'settings.server.renameLabel': 'Rename the {name} channel',
    'settings.server.deleteLabel': 'Delete the {name} channel',
    'settings.server.newName': 'New name',
    'settings.server.renamed': 'Channel renamed.',
    'settings.server.renameFailed': 'Could not rename the channel.',
    'settings.server.moveFailed': 'Could not move the channel.',
    'settings.server.deleteVoiceConfirm': 'Delete the {name} voice channel? Everyone in it will be disconnected.',
    'settings.server.deleteTextConfirm': 'Permanently delete #{name} along with all of its messages and files?',
    'settings.server.deleted': 'Channel deleted.',
    'settings.server.deleteFailed': 'Could not delete the channel.',
    'settings.server.enterChannelName': 'Enter a channel name.',
    'settings.server.textCreated': 'Text channel created.',
    'settings.server.voiceCreated': 'Voice channel created.',
    'settings.server.createFailed': 'Could not create the channel.',
    'settings.server.enterName': 'Enter a server name.',
    'settings.server.nameSaved': 'Server name saved.',
    'settings.server.nameFailed': 'Could not save the server name.',
    'settings.server.rotateConfirm': 'Renew the invite code? Old invite links will no longer work for signing up.',
    'settings.server.rotated': 'The invite code was renewed. You can copy the new invite link from the Encryption tab.',
    'settings.server.rotateFailed': 'Could not renew the invite code.',

    'settings.members.tempHint': 'The temporary password is shown only once. Pass it on to the person through a secure channel.',
    'settings.members.tempLabel': 'Temporary password for {name}:',
    'settings.members.banned': 'Banned',
    'settings.members.bannedState': 'banned',
    'settings.members.sub': '{role}, {status}',
    'settings.members.makeMember': 'Make member',
    'settings.members.makeAdmin': 'Make admin',
    'settings.members.ban': 'Ban',
    'settings.members.unban': 'Unban',
    'settings.members.resetPassword': 'Reset password',
    'settings.members.nowAdmin': '{name} is now an admin.',
    'settings.members.nowMember': '{name} is now a member.',
    'settings.members.roleFailed': 'Could not change the role.',
    'settings.members.banConfirm': 'Ban {name}? All of their sessions will be signed out and they will not be able to sign in.',
    'settings.members.bannedOk': '{name} has been banned.',
    'settings.members.unbannedOk': '{name} has been unbanned.',
    'settings.members.actionFailed': 'The action could not be completed.',
    'settings.members.resetConfirm': 'Reset the password for {name}? All of their sessions will be signed out.',
    'settings.members.resetFailed': 'Could not reset the password.',

    // Ses modülünün tuş ve atama adları (voice.bindingLabel)
    'bindings.none': 'Not set',
    'bindings.key': '{key} key',
    'bindings.mouseMiddle': 'Middle mouse button',
    'bindings.mouseSide': 'Mouse button {n}',
    'bindings.gamepad': 'Gamepad button {n}',
    'keys.numpad': 'Numpad {key}',
    'keys.Space': 'Space',
    'keys.Enter': 'Enter',
    'keys.Tab': 'Tab',
    'keys.Backspace': 'Backspace',
    'keys.CapsLock': 'Caps Lock',
    'keys.ShiftLeft': 'Left Shift',
    'keys.ShiftRight': 'Right Shift',
    'keys.ControlLeft': 'Left Ctrl',
    'keys.ControlRight': 'Right Ctrl',
    'keys.AltLeft': 'Left Alt',
    'keys.AltRight': 'Right Alt',
    'keys.MetaLeft': 'Left Win/Cmd',
    'keys.MetaRight': 'Right Win/Cmd',
    'keys.ArrowUp': 'Up Arrow',
    'keys.ArrowDown': 'Down Arrow',
    'keys.ArrowLeft': 'Left Arrow',
    'keys.ArrowRight': 'Right Arrow',
    'keys.Insert': 'Insert',
    'keys.Delete': 'Delete',
    'keys.Home': 'Home',
    'keys.End': 'End',
    'keys.PageUp': 'Page Up',
    'keys.PageDown': 'Page Down',
    'keys.ContextMenu': 'Menu',
    'keys.Pause': 'Pause',
    'keys.ScrollLock': 'Scroll Lock',
    'keys.PrintScreen': 'Print Screen',
    'keys.NumLock': 'Num Lock',
    'keys.NumpadEnter': 'Numpad Enter',

    // Şifreleme modülünün hata kodları (Error.code)
    'errors.key.empty': 'Please enter the 28-character key code.',
    'errors.key.bad_length': 'The key code must be 28 characters long.',
    'errors.key.bad_char': 'The key code contains an invalid character.',
    'errors.key.bad_padding': 'The key code contains a typo. Please check it.',
    'errors.key.bad_checksum': 'The key code contains a typo. Please check it.',
    'errors.key.no_library': 'The encryption library could not be loaded. Please reload the page.',
    'errors.key.no_random': 'This browser has no secure random number generator, so a key cannot be created.',
    'errors.e2ee.no_key': 'The encryption key is not on this device.',
    'errors.e2ee.no_library': 'The encryption library could not be loaded. Please reload the page.',
    'errors.e2ee.no_random': 'This browser has no secure random number generator, so encryption is not possible.',
    'errors.e2ee.seal_failed': 'The content could not be encrypted.',
    'errors.e2ee.bad_type': 'Invalid data for encryption.',
    'errors.e2ee.bad_base64': 'The encrypted data is corrupted.',
    'errors.e2ee.bad_format': 'The encrypted content is malformed.',
    'errors.e2ee.bad_data': 'Message could not be verified',

    // Ses modülünün hata kodları (snapshot.errorCode, Error.code)
    'errors.mic_denied': 'Microphone permission was not granted.',
    'errors.mic_not_found': 'No microphone was found.',
    'errors.mic_failed': 'The microphone could not be opened.',
    'errors.no_key': 'An encryption key is required for voice chat.',
    'errors.insecure': 'Voice chat only works on an address that starts with https://. Use the tunnel address.',
    'errors.unsupported': 'This browser does not support voice chat. If you are on a game console, you can join from your phone\'s browser.',
    'errors.connect_failed': 'Could not set up a voice connection with some people. Your network may not allow direct connections, so a TURN server may be needed.',
    'errors.kicked': 'You were disconnected from voice. You can join again.',
    'errors.join_failed': 'Could not join the voice channel.',
    'errors.bad_channel': 'Invalid voice channel.',

    // Sunucu hata kodları (yanıttaki code alanı)
    'errors.bad_request': 'Invalid request.',
    'errors.too_large': 'The request is too large.',
    'errors.not_found': 'The requested address was not found.',
    'errors.method_not_allowed': 'This address does not support this request method.',
    'errors.invalid_token': 'Your session has ended. Please sign in again.',
    'errors.banned': 'This account has been banned.',
    'errors.forbidden': 'You do not have permission to do this.',
    'errors.invalid_name': 'The username must be 2 to 32 characters long and contain only lowercase English letters, digits, underscores and dots. It cannot start or end with a dot, and two dots cannot be next to each other.',
    'errors.weak_password': 'The password must be between 8 and 128 characters.',
    'errors.bad_auth_key': 'The authentication key is invalid.',
    'errors.bad_kdf': 'The key derivation settings are invalid.',
    'errors.bad_keys': 'The security key is invalid.',
    'errors.keys_exist': 'This account already has a security key.',
    'errors.no_keys': 'This account does not have a security key yet.',
    'errors.bad_identity': 'The identity record is invalid.',
    'errors.bad_code': 'The code is wrong.',
    'errors.name_taken': 'This username is already taken.',
    'errors.server_full': 'The server has reached its account limit.',
    'errors.bad_credentials': 'The username or password is wrong.',
    'errors.rate_limited': 'Too many requests. Please wait a moment and try again.',
    'errors.channel_not_found': 'Channel not found.',
    'errors.message_not_found': 'Message not found.',
    'errors.upload_not_found': 'File not found.',
    'errors.user_not_found': 'User not found.',
    'errors.bad_body': 'The message is invalid or too long.',
    'errors.bad_uploads': 'The files attached to the message are invalid.',
    'errors.empty_upload': 'An empty file cannot be uploaded.',
    'errors.quota_full': 'The server has run out of file storage. Contact the server owner.',
    'errors.busy': 'The server is processing other uploads right now. Please try again shortly.',
    'errors.invalid_channel_name': 'The channel name must be 1 to 30 characters long and contain only letters, digits, spaces, dots, underscores or hyphens.',
    'errors.invalid_channel_type': 'The channel type must be text or voice.',
    'errors.channel_exists': 'A channel with this name already exists.',
    'errors.too_many_channels': 'The channel limit has been reached.',
    'errors.last_text_channel': 'The last text channel cannot be deleted.',
    'errors.invalid_server_name': 'The server name must be between 1 and 40 characters.',
    'errors.bad_kid': 'The key ID is invalid.',
    'errors.voice_full': 'This voice channel is full.',
    'errors.bad_signal': 'The voice signal is invalid.',
    'errors.not_in_voice': 'You need to join a voice channel first.',
    'errors.peer_not_found': 'The person you are trying to connect to is not in this voice channel.',
    'errors.owner_cannot_delete': 'The server owner cannot delete their account.',
    'errors.self': 'This action cannot be applied to your own account.',
    'errors.already_friends': 'You are already friends with this person.',
    'errors.already_pending': 'You have already sent this person a friend request.',
    'errors.request_failed': 'The friend request could not be sent.',
    'errors.request_not_found': 'Friend request not found.',
    'errors.not_friends': 'You are not friends with this person.',
    'errors.too_many_pending': 'You have reached the limit of pending friend requests.',
    'errors.too_many_friends': 'You have reached the friend limit.',
    'errors.dm_not_allowed': 'You cannot send direct messages to this person.',
    'errors.too_many_dms': 'You have reached the limit of direct message conversations.',
    'errors.shutting_down': 'The server is shutting down.',
    'errors.server_error': 'An unexpected error occurred on the server.',
    'errors.session_not_found': 'Session not found.',
    'errors.bad_profile': 'The profile data is invalid.',
    'errors.bad_avatar': 'The profile picture is invalid.',
    'errors.avatar_too_large': 'The profile picture is too large.',
    'errors.bad_status': 'The status is invalid. Choose online, idle, do not disturb or invisible.'
  }

  const messages = { tr: tr, en: en }

  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key)
  const hasWindow = typeof window !== 'undefined'
  const warned = Object.create(null)
  const cache = Object.create(null)

  function normalize (code) {
    const text = String(code || '').toLowerCase()
    if (text.indexOf('tr') === 0) return 'tr'
    if (text.indexOf('en') === 0) return 'en'
    return null
  }

  function readStored () {
    try {
      const value = hasWindow && window.localStorage ? window.localStorage.getItem(STORAGE_KEY) : null
      return value === 'tr' || value === 'en' ? value : null
    } catch (err) {
      return null
    }
  }

  function writeStored (lang) {
    try {
      if (hasWindow && window.localStorage) window.localStorage.setItem(STORAGE_KEY, lang)
    } catch (err) {
      // Depolama kapalıysa seçim yalnızca bu sayfa için geçerlidir
    }
  }

  // Öncelik: kullanıcının kayıtlı seçimi, tarayıcı dillerinden biri tr ile başlıyorsa tr, değilse en
  function detect () {
    const stored = readStored()
    if (stored) return stored
    const list = []
    try {
      const nav = typeof navigator !== 'undefined' ? navigator : null
      if (nav && nav.languages && nav.languages.length) Array.prototype.forEach.call(nav.languages, (item) => list.push(item))
      if (nav && nav.language) list.push(nav.language)
    } catch (err) {
      // Dil bilgisi okunamazsa İngilizce
    }
    return list.some((item) => normalize(item) === 'tr') ? 'tr' : 'en'
  }

  let current = detect()

  function syncDocument () {
    try {
      if (typeof document !== 'undefined' && document.documentElement) document.documentElement.lang = current
    } catch (err) {
      // Belge yoksa (testler) yalnızca dil değişkeni güncellenir
    }
  }

  function locale () {
    return LOCALES[current]
  }

  function lookup (lang, key) {
    const dict = messages[lang]
    return hasOwn(dict, key) ? dict[key] : null
  }

  function pluralCategory (count) {
    const id = 'plural:' + current
    try {
      if (!cache[id] && typeof Intl !== 'undefined' && typeof Intl.PluralRules === 'function') cache[id] = new Intl.PluralRules(locale())
      if (cache[id]) return cache[id].select(count)
    } catch (err) {
      // Yedek kurala geçilir
    }
    return count === 1 ? 'one' : 'other'
  }

  // Anahtarın seçili dildeki metni. count sayısal ise çoğul biçim seçilir. Bulunamazsa null.
  function resolve (lang, key, params) {
    if (params && typeof params.count === 'number') {
      const exact = lookup(lang, key + '_' + pluralCategory(params.count))
      if (exact !== null) return exact
      const other = lookup(lang, key + '_other')
      if (other !== null) return other
    }
    const plain = lookup(lang, key)
    if (plain !== null) return plain
    return lookup(lang, key + '_other')
  }

  function fill (text, params) {
    if (!params) return text
    return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name) => {
      if (!hasOwn(params, name) || params[name] === undefined || params[name] === null) return match
      return String(params[name])
    })
  }

  function t (key, params) {
    const name = String(key)
    let text = resolve(current, name, params)
    if (text === null) {
      // Eksik anahtar bir geliştirme hatasıdır: bir kez uyarılır, öteki dil veya anahtarın kendisi gösterilir
      if (!warned[name]) {
        warned[name] = true
        try {
          if (typeof console !== 'undefined') console.warn('I18N: missing key "' + name + '" (' + current + ')')
        } catch (err) {
          // Konsol yoksa sessiz
        }
      }
      text = resolve(current === 'tr' ? 'en' : 'tr', name, params)
      if (text === null) text = name
    }
    return fill(text, params)
  }

  function has (key) {
    return resolve(current, String(key), null) !== null || lookup(current, String(key) + '_one') !== null
  }

  function setLang (code) {
    const lang = normalize(code)
    if (!lang) return current
    current = lang
    api.lang = lang
    writeStored(lang)
    syncDocument()
    return current
  }

  // Statik HTML metinleri: data-i18n (metin), data-i18n-placeholder, data-i18n-aria-label, data-i18n-title
  function apply (root) {
    const scope = root || (typeof document !== 'undefined' ? document : null)
    if (!scope || typeof scope.querySelectorAll !== 'function') return
    ATTRS.forEach((pair) => {
      const attr = pair[0]
      const nodes = Array.prototype.slice.call(scope.querySelectorAll('[' + attr + ']'))
      if (typeof scope.hasAttribute === 'function' && scope.hasAttribute(attr)) nodes.unshift(scope)
      nodes.forEach((node) => {
        const key = node.getAttribute(attr)
        if (!key) return
        const text = t(key)
        if (pair[1]) node.setAttribute(pair[1], text)
        else node.textContent = text
      })
    })
  }

  // Biçimlendiriciler dil başına önbelleğe alınır
  function formatter (kind, options) {
    const id = kind + ':' + current + ':' + JSON.stringify(options)
    if (!hasOwn(cache, id)) {
      let made = null
      try {
        if (typeof Intl !== 'undefined') made = kind === 'date' ? new Intl.DateTimeFormat(locale(), options) : new Intl.NumberFormat(locale(), options)
      } catch (err) {
        made = null
      }
      cache[id] = made
    }
    return cache[id]
  }

  function pad2 (n) {
    return n < 10 ? '0' + n : String(n)
  }

  function dateOptions (style) {
    const hour = HOUR[current]
    if (style === 'long') return { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: hour, minute: '2-digit' }
    if (style === 'date') return { year: 'numeric', month: '2-digit', day: '2-digit' }
    if (style === 'time') return { hour: hour, minute: '2-digit' }
    return { year: 'numeric', month: '2-digit', day: '2-digit', hour: hour, minute: '2-digit' }
  }

  // Intl yoksa basit yedek: GG.AA.YYYY SS:DD (tr) veya AA/GG/YYYY SS:DD (en)
  function fallbackDate (date, style) {
    const time = pad2(date.getHours()) + ':' + pad2(date.getMinutes())
    if (style === 'time') return time
    const day = current === 'tr'
      ? pad2(date.getDate()) + '.' + pad2(date.getMonth() + 1) + '.' + date.getFullYear()
      : pad2(date.getMonth() + 1) + '/' + pad2(date.getDate()) + '/' + date.getFullYear()
    return style === 'date' ? day : day + ' ' + time
  }

  // style: 'short' (tarih ve saat, varsayılan), 'long' (gün adı ve ay adıyla), 'date', 'time'
  function formatDate (ms, style) {
    const value = Number(ms)
    if (!isFinite(value)) return ''
    const date = new Date(value)
    if (isNaN(date.getTime())) return ''
    const f = formatter('date', dateOptions(style))
    if (f) {
      try {
        return f.format(date)
      } catch (err) {
        // Yedek biçim kullanılır
      }
    }
    return fallbackDate(date, style)
  }

  function formatTime (ms) {
    return formatDate(ms, 'time')
  }

  // maxFraction verilmezse Intl varsayılanı (en fazla 3 ondalık)
  function formatNumber (n, maxFraction) {
    const value = Number(n)
    if (!isFinite(value)) return String(n)
    const options = typeof maxFraction === 'number' ? { maximumFractionDigits: maxFraction } : {}
    const f = formatter('number', options)
    if (f) {
      try {
        return f.format(value)
      } catch (err) {
        // Yedek biçim kullanılır
      }
    }
    const rounded = typeof maxFraction === 'number' ? Number(value.toFixed(maxFraction)) : value
    const text = String(rounded)
    return current === 'tr' ? text.replace('.', ',') : text
  }

  // İnsan okunur boyut: 820 bayt, 12 KB, 1,4 MB (tr) veya 820 bytes, 12 KB, 1.4 MB (en)
  function formatSize (bytes) {
    const n = Math.max(0, Math.floor(Number(bytes) || 0))
    if (n < 1024) return t('size.bytes', { count: n })
    if (n < 1024 * 1024) return t('size.kb', { value: formatNumber(Math.max(1, Math.round(n / 1024)), 0) })
    const giga = n >= 1024 * 1024 * 1024
    const value = n / (giga ? 1024 * 1024 * 1024 : 1024 * 1024)
    const text = value >= 100 ? formatNumber(Math.round(value), 0) : formatNumber(value, 1)
    return t(giga ? 'size.gb' : 'size.mb', { value: text })
  }

  const api = {
    lang: current,
    languages: LANGS.slice(),
    locale: locale,
    setLang: setLang,
    t: t,
    has: has,
    apply: apply,
    formatDate: formatDate,
    formatTime: formatTime,
    formatSize: formatSize,
    formatNumber: formatNumber,
    messages: messages
  }

  syncDocument()
  return api
})()
