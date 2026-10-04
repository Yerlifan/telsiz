'use strict'

// Sunucunun dil desteği: Türkçe ve İngilizce sözlükler, Accept-Language başlığına göre dil
// seçimi, konsol dili seçimi ve parametreli metin üretimi.
// API hata yanıtlarındaki error metni isteğin diline göre seçilir, code alanı hiçbir zaman değişmez.
// Konsol çıktılarının dili DIL (TELSIZ_LANG) ortam değişkeninden, yoksa sistem yerel ayarından gelir.
// Parametreler {ad} biçimindedir. Yeni bir anahtar her iki sözlüğe de aynı parametrelerle eklenir.

const LANGS = Object.freeze(['tr', 'en'])
const DEFAULT_LANG = 'en'
// Accept-Language başlığının en fazla bu kadarı ve bu kadar girdisi değerlendirilir
const MAX_HEADER_CHARS = 1000
const MAX_HEADER_PARTS = 32
const PARAM_RE = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g
const QUALITY_RE = /^\s*q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)\s*$/i

const messages = {
  tr: {
    errors: {
      bad_request: 'İstek geçersiz.',
      too_large: 'İstek çok büyük.',
      not_found: 'İstenen adres bulunamadı.',
      method_not_allowed: 'Bu adres bu istek yöntemini desteklemiyor.',
      invalid_token: 'Oturumunuz sona erdi. Lütfen yeniden giriş yapın.',
      banned: 'Bu hesap engellendi.',
      kicked: 'Frekanstan çıkarıldınız. Geri dönmek için davet koduyla yeniden kayıt olmanız gerekir.',
      forbidden: 'Bu işlem için yetkiniz yok.',
      invalid_name: 'Kullanıcı adı 2 ile 32 karakter arasında olmalı ve yalnızca küçük İngilizce harf, rakam, alt çizgi ve nokta içermelidir. Nokta ile başlayamaz veya bitemez, iki nokta yan yana gelemez.',
      bad_auth_key: 'Kimlik doğrulama anahtarı geçersiz.',
      bad_kdf: 'Anahtar türetme ayarları geçersiz.',
      bad_keys: 'Güvenlik anahtarı geçersiz.',
      keys_exist: 'Bu hesabın güvenlik anahtarı zaten var.',
      no_keys: 'Bu hesabın henüz güvenlik anahtarı yok.',
      bad_identity: 'Kimlik kaydı geçersiz.',
      bad_code: 'Kod hatalı.',
      name_taken: 'Bu kullanıcı adı zaten kullanılıyor.',
      server_full: 'Bu frekanstaki hesap sayısı üst sınıra ulaştı.',
      bad_credentials: 'Kullanıcı adı veya parola hatalı.',
      rate_limited: 'Çok fazla istek gönderildi. Lütfen biraz bekleyip tekrar deneyin.',
      channel_not_found: 'Oda bulunamadı.',
      message_not_found: 'Mesaj bulunamadı.',
      upload_not_found: 'Dosya bulunamadı.',
      user_not_found: 'Kullanıcı bulunamadı.',
      session_not_found: 'Oturum bulunamadı.',
      bad_body: 'Mesaj geçersiz veya çok uzun.',
      bad_uploads: 'Mesaja eklenen dosyalar geçersiz.',
      empty_upload: 'Boş dosya yüklenemez.',
      quota_full: 'Sunucudaki dosya alanı doldu. Frekans sahibine başvurun.',
      user_quota_full: 'Dosya alanı kotanız doldu. Yer açmak için dosya eklediğiniz eski mesajlardan bazılarını silin.',
      busy: 'Sunucu şu anda başka yüklemeleri işliyor, birazdan tekrar deneyin.',
      invalid_channel_name: 'Oda adı 1 ile 30 karakter arasında olmalı ve yalnızca harf, rakam, boşluk, nokta, alt çizgi veya kısa çizgi içermelidir.',
      invalid_channel_type: 'Oda türü yazı veya ses olmalıdır.',
      channel_exists: 'Bu adda bir oda zaten var.',
      too_many_channels: 'Oda sayısı üst sınıra ulaştı.',
      last_text_channel: 'Son yazı odası silinemez.',
      invalid_server_name: 'Frekans adı 1 ile 40 karakter arasında olmalıdır.',
      invalid_about: 'Frekans tanıtımı en fazla 600 karakter ve 6 satır olabilir.',
      bad_server_icon: 'Frekans fotoğrafı PNG, JPEG veya WebP olmalıdır.',
      server_icon_too_large: 'Frekans fotoğrafı en fazla {kb} KB olabilir.',
      bad_kid: 'Anahtar kimliği geçersiz.',
      voice_full: 'Bu ses odası dolu.',
      camera_disabled: 'Kameralar bu frekansta kapalı.',
      camera_limit: 'Bu ses odasında aynı anda en fazla {max} kamera açık olabilir.',
      invalid_voice_settings: 'Ses odası kapasitesi {min} ile {max} arasında, kamera sınırı {camMin} ile {camMax} arasında olmalı ve kamera sınırı kapasiteden büyük olmamalıdır.',
      bad_signal: 'Ses sinyali geçersiz.',
      not_in_voice: 'Önce bir ses odasına katılmalısınız.',
      peer_not_found: 'Bağlanılmak istenen kişi bu ses odasında değil.',
      dj_disabled: 'Telsiz DJ bu frekansta kapalı.',
      dj_restricted: 'Bu odada kuyruğu DJ izni olanlar yönetiyor.',
      invalid_role_name: 'Rol adı 1 ile {max} karakter arasında olmalıdır.',
      role_exists: 'Bu adda bir rol zaten var.',
      role_not_found: 'Rol bulunamadı.',
      too_many_roles: 'En fazla {max} rol oluşturulabilir.',
      target_not_in_voice: 'Bu kişi şu an bir ses odasında değil.',
      bad_envelope: 'Müzik durumu geçersiz.',
      owner_cannot_delete: 'Frekans sahibi hesabını silemez.',
      self: 'Bu işlem kendi hesabınıza uygulanamaz.',
      already_friends: 'Bu kişiyle zaten arkadaşsınız.',
      already_pending: 'Bu kişiye zaten arkadaşlık isteği gönderdiniz.',
      request_failed: 'Arkadaşlık isteği gönderilemedi.',
      request_not_found: 'Arkadaşlık isteği bulunamadı.',
      not_friends: 'Bu kişiyle arkadaş değilsiniz.',
      too_many_pending: 'Bekleyen arkadaşlık isteği sayısı üst sınıra ulaştı.',
      too_many_friends: 'Arkadaş sayısı üst sınıra ulaştı.',
      dm_not_allowed: 'Bu kişiye özel mesaj gönderilemiyor.',
      too_many_dms: 'Özel mesaj konuşması sayısı üst sınıra ulaştı.',
      bad_profile: 'Profil bilgileri geçersiz.',
      bad_avatar: 'Profil resmi geçersiz.',
      avatar_too_large: 'Profil resmi çok büyük.',
      bad_status: 'Durum geçersiz. Çevrimiçi, boşta, rahatsız etmeyin veya görünmez seçilebilir.',
      shutting_down: 'Sunucu kapanıyor.',
      server_error: 'Sunucuda beklenmeyen bir hata oluştu.'
    },
    detail: {
      setupCodeWrong: 'Kurulum kodu hatalı. Sunucu penceresinde yazan kodu girin.',
      inviteCodeWrong: 'Davet kodu hatalı.',
      authRate: 'Çok fazla deneme yapıldı. Lütfen birkaç dakika sonra tekrar deneyin.',
      loginRate: 'Bu hesap için çok fazla hatalı giriş denemesi yapıldı. Lütfen daha sonra tekrar deneyin.',
      messageRate: 'Çok hızlı mesaj gönderiyorsunuz, lütfen biraz bekleyin.',
      typingRate: 'Yazıyor bilgisi çok sık gönderiliyor, lütfen biraz bekleyin.',
      uploadRate: 'Çok fazla dosya yüklendi, lütfen biraz bekleyin.',
      oldPasswordWrong: 'Mevcut parola hatalı.',
      passwordWrong: 'Parola hatalı.',
      ownerRoleLocked: 'Sahibin rolü değiştirilemez.',
      serverNameOwnerOnly: 'Frekans adını yalnızca sahip değiştirebilir.',
      musicOwnerOnly: 'Telsiz DJ ayarlarını yalnızca sahip değiştirebilir.',
      aboutOwnerOnly: 'Frekans tanıtımını yalnızca sahip değiştirebilir.',
      voiceOwnerOnly: 'Ses odası ve kamera ayarlarını yalnızca sahip değiştirebilir.',
      serverIconOwnerOnly: 'Frekans fotoğrafını yalnızca sahip değiştirebilir.',
      musicNotInRoom: 'Müziği yalnızca o ses odasında bulunanlar değiştirebilir.',
      musicRestricted: 'Bu odada DJ izni olan biri var, kuyruğu yalnızca DJ izni olanlar yönetebilir.',
      musicRate: 'Müzik komutları çok sık gönderiliyor, lütfen biraz bekleyin.',
      uploadTooLarge: 'Dosya çok büyük. En fazla {mb} MB yüklenebilir.',
      fileTooLarge: 'Dosya çok büyük.'
    },
    http: {
      notFound: 'Sayfa bulunamadı.',
      methodNotAllowed: 'Bu adres bu istek yöntemini desteklemiyor.'
    },
    defaults: {
      channelGeneral: 'genel',
      channelGaming: 'oyun',
      channelVoice1: 'Ses 1',
      channelVoice2: 'Ses 2'
    },
    log: {
      unknownError: 'bilinmeyen hata',
      corruptRecord: 'Veri dosyasındaki ({file}) bir {kind} kaydı geçersiz. Verilerinizi korumak için sunucu başlatılmadı. Dosyayı yedekten geri yükleyin veya elle onarın.',
      kindUser: 'kullanıcı',
      kindChannel: 'kanal',
      kindDm: 'özel mesaj konuşması',
      badKdf: 'Uyarı: {id} numaralı hesabın anahtar türetme ayarları geçersiz, giriş için parola sıfırlaması gerekir.',
      textChannelCreated: 'Uyarı: veri dosyasında yazı kanalı yoktu, "{name}" kanalı oluşturuldu.',
      invalidSessions: 'Uyarı: veri dosyasındaki {count} geçersiz oturum kaydı silindi.',
      invalidUploads: 'Uyarı: veri dosyasındaki {count} geçersiz yükleme kaydı yok sayıldı.',
      invalidAvatars: 'Uyarı: veri dosyasındaki {count} geçersiz profil resmi bağlantısı kaldırıldı.',
      invalidRoles: 'Uyarı: veri dosyasındaki geçersiz rol kayıtları düzeltildi.',
      serverIconMissing: 'Uyarı: frekans fotoğrafı dosyası eksik veya geçersiz, fotoğraf kaldırıldı.',
      serverIconRemoveFailed: 'Uyarı: eski frekans fotoğrafı silinemedi: {error}',
      invalidSocial: 'Uyarı: veri dosyasındaki geçersiz arkadaşlık veya engel kayıtları silindi.',
      uploadRemoveFailed: 'Uyarı: yükleme dosyası silinemedi: {error}',
      partialUploadRemoveFailed: 'Uyarı: yarım yükleme silinemedi: {error}',
      downloadFailed: 'Uyarı: dosya gönderilemedi: {error}',
      ownerCreated: 'Sahip hesabı oluşturuldu. Kurulum kodu artık geçersiz.',
      requestError: 'İstek işlenirken beklenmeyen hata ({label}): {error}',
      sweepError: 'Tarama sırasında beklenmeyen hata: {error}'
    },
    store: {
      ioError: 'Veri klasörüne erişilemedi: {error}',
      versionMismatch: 'Veri dosyasının sürümü ({version}) bu sunucu sürümüyle uyumlu değil. Verilerinizi korumak için hiçbir dosyaya yazılmadı.',
      locked: 'Veri klasörü başka bir süreç tarafından kullanılıyor (PID {pid}). Sunucu zaten çalışıyor olabilir. Çalışmadığından eminseniz {file} dosyasını silip yeniden deneyin.',
      recoveredMissing: 'Uyarı: {file} bulunamadı, yedek dosyadan ({backup}) yüklendi.',
      missingBackupCorrupt: 'Veri dosyası ({file}) bulunamadı ve yedek dosya ({backup}) bozuk. Verilerinizi korumak için hiçbir dosyaya yazılmadı. Yeni bir kurulum başlatmak istiyorsanız yedek dosyayı başka bir klasöre taşıyın.',
      corrupt: 'Veri dosyası bozuk: {file} okunamadı ve yedek dosya ({backup}) da kullanılamıyor. Verilerinizi korumak için hiçbir dosyaya yazılmadı. Veri klasörünü yedekleyip dosyayı elle onarın veya yedekten geri yükleyin.',
      recoveredCorrupt: 'Uyarı: {file} bozuk, yedek dosyadan ({backup}) yüklendi. Bozuk dosyanın kopyası: {copy}',
      badChannelFile: 'Uyarı: {file} dosya adı geçersiz, yok sayıldı.',
      tempRemoveFailed: 'Uyarı: geçici dosya silinemedi: {error}',
      compactFailed: 'Mesaj dosyası sıkıştırılamadı ({file}): {error}',
      badLines: 'Uyarı: {file} dosyasında {count} bozuk veya yarım satır atlandı.',
      duplicateMessages: 'Uyarı: {file} dosyasında başka kanalda da bulunan {count} mesaj yok sayıldı.',
      queueError: 'Mesaj yazım kuyruğu hatası: {error}',
      messageWriteFailed: 'Mesaj dosyasına yazılamadı ({file}): {error}. Yeniden denenecek.',
      messagesWriteError: 'Mesajlar diske yazılamadı: {error}',
      stateWriteError: 'Durum yazım hatası: {error}',
      backupUpdateFailed: 'Uyarı: yedek dosya ({backup}) güncellenemedi: {error}',
      stateFileWriteFailed: 'Durum dosyası ({file}) yazılamadı: {error}. Yeniden denenecek.',
      stateWriteFailed: 'Durum dosyası diske yazılamadı: {error}',
      lockRemoveFailed: 'Uyarı: kilit dosyası kaldırılamadı: {error}',
      closed: 'Veri deposu kapatıldı.',
      partialUploadRemoveFailed: 'Uyarı: yarım kalmış yükleme silinemedi: {error}',
      partialUploadsRemoved: 'Yarım kalmış {count} yükleme dosyası silindi.',
      messageCounterRaised: 'Uyarı: mesaj sayacı diskteki mesajlara göre {value} değerine yükseltildi.',
      channelCounterRaised: 'Uyarı: kanal sayacı diskteki mesaj dosyalarına göre {value} değerine yükseltildi.',
      uploadRemoveFailed: 'Uyarı: yükleme silinemedi: {error}',
      strayRemoveFailed: 'Uyarı: kayıtsız yükleme silinemedi: {error}',
      uploadsReconciled: 'Uyarı: yükleme kayıtları mesajlarla eşitlendi (bağlanan {bound}, geri yüklenen {restored}, silinen {removed}).',
      straysRemoved: 'Uyarı: kaydı olmayan {count} yükleme dosyası silindi.',
      unknownError: 'bilinmeyen hata'
    },
    config: {
      badPort: '{name} değeri geçersiz: "{value}". 1 ile 65535 arasında bir sayı girin.',
      badMegabytes: '{name} değeri geçersiz: "{value}". 0 ile {max} arasında bir sayı (MB) girin.',
      badUrl: '{name} değeri geçersiz: "{value}". Adres {prefixes} ile başlamalıdır.',
      or: 'veya',
      badServerName: '{name} değeri geçersiz. Sunucu adı 1 ile 40 karakter arasında olmalıdır.',
      quotaTooSmall: '{quota}, {upload} değerinden küçük olamaz.',
      badCount: '{name} değeri geçersiz: "{value}". 1 ile {max} arasında bir tam sayı girin.',
      badProxy: '{name} değeri geçersiz: "{value}". Virgülle ayrılmış IP adresleri, IP aralıkları (ör. 10.0.0.0/8), loopback veya none girin.'
    },
    console: {
      errorPrefix: 'Hata: {message}',
      running: '{product} sunucusu çalışıyor.',
      version: 'Sürüm: {version}',
      serverName: 'Sunucu adı: {name}',
      dataDir: 'Veri klasörü: {dir}',
      setupCode: 'Kurulum kodu: {code}. Tarayıcıda açıp sahip hesabını bu kodla oluşturun.',
      setupCodeNote: 'Kod yalnızca sahip hesabı oluşturulana kadar geçerlidir ve her başlatmada yenilenir.',
      addresses: 'Erişim adresleri:',
      local: '  Bu bilgisayardan: {url}',
      noLan: '  Aynı ağdaki cihazlar için ağ adresi bulunamadı.',
      lan: '  Aynı ağdaki cihazlardan: {url}',
      https: 'Sesli sohbet ve uygulama olarak yükleme (PWA) için adresin https:// ile başlaması gerekir.',
      httpLimits: 'Aynı ağdaki http adreslerinde bunlar çalışmaz, yalnızca bu bilgisayarda {url} adresinde çalışır.',
      tunnel: 'İnternetten https ile erişim için {script} dosyasını çalıştırın veya şu komutu kullanın: {command}',
      tunnelCommand: 'İnternetten https ile erişim için şu komutu kullanabilirsiniz (cloudflared programı gerekir): {command}',
      turnOn: 'TURN sunucusu: etkin.',
      turnOff: 'TURN sunucusu: tanımlı değil. Bazı ağlarda sesli sohbet için TURN gerekebilir (TURN_URL ayarı).',
      proxy: 'Güvenilir ters vekil adresleri: {list}',
      stopHint: 'Sunucuyu durdurmak için Ctrl+C tuşlarına basın.',
      portInUse: 'Hata: {port} numaralı bağlantı noktası zaten kullanımda. Sunucu başka bir pencerede çalışıyor olabilir. O pencereyi kapatın veya PORT ortam değişkeniyle başka bir bağlantı noktası seçin.',
      portDenied: 'Hata: {port} numaralı bağlantı noktasını açma izni yok. 1024 üzerinde bir PORT değeri deneyin.',
      hostMissing: 'Hata: HOST değerindeki adres bu bilgisayarda bulunamadı. HOST ayarını kaldırın veya doğru bir adres girin.',
      listenFailed: 'Hata: Sunucu başlatılamadı ({error}).',
      unhandledRejection: 'Yakalanmamış Promise reddi: {error}',
      uncaughtException: 'Yakalanmamış hata: {error}',
      serverError: 'Sunucu hatası: {error}',
      stopNow: 'Sunucu hemen kapatılıyor.',
      stopping: 'Sunucu kapatılıyor...',
      stopTimeout: 'Kapanış {seconds} saniye içinde tamamlanamadı, süreç sonlandırılıyor.',
      flushFailed: 'Kapanış sırasında veriler diske yazılamadı: {error}',
      stopped: 'Sunucu kapatıldı.',
      pressEnter: 'Kapatmak için Enter\'a basın.'
    },
    cli: {
      usageReset: 'Kullanım: {command} sifre-sifirla <kullanıcı adı>',
      dataDirAccess: 'Hata: Veri klasörüne erişilemedi: {dir}',
      serverRunning: 'Hata: Sunucu şu anda çalışıyor (PID {pid}). Çalışan sunucu, bu komutun yaptığı değişikliği kendi verisiyle ezer.',
      stopFirst: 'Önce sunucu penceresinde Ctrl+C ile sunucuyu durdurun, sonra komutu yeniden çalıştırın.',
      noAccounts: 'Hata: Veri klasöründe kayıtlı hesap bulunamadı: {dir}',
      dataDirHint: 'VERI_KLASORU (DATA_DIR) ayarı kullanıyorsanız komuttan önce aynı değeri verin.',
      openFailed: 'Veri klasörü açılamadı ({error}).',
      userNotFound: 'Hata: "{name}" adlı kullanıcı bulunamadı.',
      resetDone: '"{name}" hesabının parolası sıfırlandı.',
      tempPassword: 'Geçici parola: {password}',
      sessionsClosed: 'Hesabın {count} açık oturumu kapatıldı.',
      keysReset: 'Hesabın güvenlik anahtarı da sıfırlandı. Eski özel mesajlar bu hesapla artık okunamaz.',
      changeHint: 'Bu parolayla giriş yaptıktan sonra Ayarlar bölümünün Hesabım sayfasından yeni bir parola belirleyin.',
      resetFailed: 'Hata: Parola sıfırlanamadı ({error}).',
      usageTitle: 'Kullanım:',
      usageStart: '  {command}',
      usageStartNote: '      sunucuyu başlatır',
      usageResetLine: '  {command} sifre-sifirla <kullanıcı adı>',
      usageResetNote: '      sunucu kapalıyken bir hesabın parolasını sıfırlar',
      usageAliasLine: '  {command} reset-password <kullanıcı adı>',
      usageAliasNote: '      aynı komutun İngilizce adı'
    },
    envfile: {
      loaded: 'Ayarlar şu dosyadan okundu: {file}',
      unknown: 'Uyarı: {file} dosyasının {line}. satırındaki "{key}" bilinen bir ayar adı değil, yok sayıldı.',
      malformed: 'Uyarı: {file} dosyasının {line}. satırı AD=değer biçiminde değil, yok sayıldı.',
      duplicate: 'Uyarı: {file} dosyasında {key} ayarı birden fazla yazılmış, {line}. satırdaki değer geçerli.',
      skipped: '{key} ortam değişkeni olarak da tanımlı olduğu için telsiz.env dosyasındaki değeri kullanılmadı.',
      tooLarge: '{file} dosyası çok büyük. Dosya en fazla {max} bayt olabilir.',
      unreadable: '{file} dosyası okunamadı ({error}).'
    }
  },
  en: {
    errors: {
      bad_request: 'The request is invalid.',
      too_large: 'The request is too large.',
      not_found: 'The requested address was not found.',
      method_not_allowed: 'This address does not support this request method.',
      invalid_token: 'Your session has ended. Please sign in again.',
      banned: 'This account has been banned.',
      kicked: 'You were kicked from this frequency. To come back, you need to register again with an invite code.',
      forbidden: 'You are not allowed to do this.',
      invalid_name: 'Usernames must be 2 to 32 characters long and may contain only lowercase English letters, digits, underscores and dots. They cannot start or end with a dot, and two dots cannot appear in a row.',
      bad_auth_key: 'The authentication key is invalid.',
      bad_kdf: 'The key derivation settings are invalid.',
      bad_keys: 'The security key is invalid.',
      keys_exist: 'This account already has a security key.',
      no_keys: 'This account does not have a security key yet.',
      bad_identity: 'The identity record is invalid.',
      bad_code: 'The code is incorrect.',
      name_taken: 'This username is already taken.',
      server_full: 'This frequency has reached its account limit.',
      bad_credentials: 'Incorrect username or password.',
      rate_limited: 'Too many requests. Please wait a moment and try again.',
      channel_not_found: 'Room not found.',
      message_not_found: 'Message not found.',
      upload_not_found: 'File not found.',
      user_not_found: 'User not found.',
      session_not_found: 'Session not found.',
      bad_body: 'The message is invalid or too long.',
      bad_uploads: 'The files attached to the message are invalid.',
      empty_upload: 'Empty files cannot be uploaded.',
      quota_full: 'The server is out of file storage. Contact the frequency owner.',
      user_quota_full: 'Your file storage quota is full. Delete some of your older messages with files to free up space.',
      busy: 'The server is busy with other uploads. Try again shortly.',
      invalid_channel_name: 'Room names must be 1 to 30 characters long and may contain only letters, digits, spaces, dots, underscores or hyphens.',
      invalid_channel_type: 'The room type must be text or voice.',
      channel_exists: 'A room with this name already exists.',
      too_many_channels: 'The room limit has been reached.',
      last_text_channel: 'The last text room cannot be deleted.',
      invalid_server_name: 'The frequency name must be 1 to 40 characters long.',
      invalid_about: 'The frequency introduction can be at most 600 characters and 6 lines long.',
      bad_server_icon: 'The frequency photo must be a PNG, JPEG or WebP image.',
      server_icon_too_large: 'The frequency photo can be at most {kb} KB.',
      bad_kid: 'The key ID is invalid.',
      voice_full: 'This voice room is full.',
      camera_disabled: 'Cameras are turned off on this frequency.',
      camera_limit: 'At most {max} cameras can be on at the same time in this voice room.',
      invalid_voice_settings: 'The voice room capacity must be between {min} and {max}, the camera limit between {camMin} and {camMax}, and the camera limit cannot be larger than the capacity.',
      bad_signal: 'The voice signal is invalid.',
      not_in_voice: 'Join a voice room first.',
      peer_not_found: 'The person you are trying to reach is not in this voice room.',
      dj_disabled: 'Telsiz DJ is turned off on this frequency.',
      dj_restricted: 'In this room the queue is managed by people with the DJ permission.',
      invalid_role_name: 'The role name must be between 1 and {max} characters.',
      role_exists: 'A role with this name already exists.',
      role_not_found: 'Role not found.',
      too_many_roles: 'At most {max} roles can be created.',
      target_not_in_voice: 'This person is not in a voice room right now.',
      bad_envelope: 'The music state is invalid.',
      owner_cannot_delete: 'The frequency owner cannot delete their account.',
      self: 'This action cannot be applied to your own account.',
      already_friends: 'You are already friends with this person.',
      already_pending: 'You have already sent this person a friend request.',
      request_failed: 'The friend request could not be sent.',
      request_not_found: 'Friend request not found.',
      not_friends: 'You are not friends with this person.',
      too_many_pending: 'You have reached the limit for pending friend requests.',
      too_many_friends: 'The friend limit has been reached.',
      dm_not_allowed: 'You cannot send direct messages to this person.',
      too_many_dms: 'The direct message conversation limit has been reached.',
      bad_profile: 'The profile data is invalid.',
      bad_avatar: 'The profile picture is invalid.',
      avatar_too_large: 'The profile picture is too large.',
      bad_status: 'The status is invalid. Choose online, idle, do not disturb or invisible.',
      shutting_down: 'The server is shutting down.',
      server_error: 'An unexpected error occurred on the server.'
    },
    detail: {
      setupCodeWrong: 'The setup code is incorrect. Enter the code shown in the server window.',
      inviteCodeWrong: 'The invite code is incorrect.',
      authRate: 'Too many attempts. Please try again in a few minutes.',
      loginRate: 'Too many failed sign-in attempts for this account. Please try again later.',
      messageRate: 'You are sending messages too quickly. Please wait a moment.',
      typingRate: 'Typing updates are being sent too often. Please wait a moment.',
      uploadRate: 'Too many files were uploaded. Please wait a moment.',
      oldPasswordWrong: 'The current password is incorrect.',
      passwordWrong: 'The password is incorrect.',
      ownerRoleLocked: 'The role of the frequency owner cannot be changed.',
      serverNameOwnerOnly: 'Only the owner can change the frequency name.',
      musicOwnerOnly: 'Only the owner can change the Telsiz DJ settings.',
      aboutOwnerOnly: 'Only the owner can change the frequency introduction.',
      voiceOwnerOnly: 'Only the owner can change the voice room and camera settings.',
      serverIconOwnerOnly: 'Only the owner can change the frequency photo.',
      musicNotInRoom: 'Only people in that voice room can change its music.',
      musicRestricted: 'Someone with the DJ permission is in this room, only people with the DJ permission can manage the queue.',
      musicRate: 'Music commands are being sent too often, please wait a moment.',
      uploadTooLarge: 'The file is too large. The maximum size is {mb} MB.',
      fileTooLarge: 'The file is too large.'
    },
    http: {
      notFound: 'Page not found.',
      methodNotAllowed: 'This address does not support this request method.'
    },
    defaults: {
      channelGeneral: 'general',
      channelGaming: 'gaming',
      channelVoice1: 'Voice 1',
      channelVoice2: 'Voice 2'
    },
    log: {
      unknownError: 'unknown error',
      corruptRecord: 'A {kind} record in the data file ({file}) is invalid. The server was not started, to protect your data. Restore the file from a backup or repair it by hand.',
      kindUser: 'user',
      kindChannel: 'channel',
      kindDm: 'direct message conversation',
      badKdf: 'Warning: account {id} has invalid key derivation settings. Its password must be reset before it can sign in.',
      textChannelCreated: 'Warning: the data file had no text channel, so the "{name}" channel was created.',
      invalidSessions: 'Warning: {count} invalid session records in the data file were removed.',
      invalidUploads: 'Warning: {count} invalid upload records in the data file were ignored.',
      invalidAvatars: 'Warning: {count} invalid profile picture links in the data file were removed.',
      invalidRoles: 'Warning: invalid role records in the data file were corrected.',
      serverIconMissing: 'Warning: the frequency photo file is missing or invalid, the photo was removed.',
      serverIconRemoveFailed: 'Warning: the old frequency photo could not be deleted: {error}',
      invalidSocial: 'Warning: invalid friendship or block records in the data file were removed.',
      uploadRemoveFailed: 'Warning: an upload file could not be deleted: {error}',
      partialUploadRemoveFailed: 'Warning: an incomplete upload could not be deleted: {error}',
      downloadFailed: 'Warning: a file could not be sent: {error}',
      ownerCreated: 'The owner account was created. The setup code is no longer valid.',
      requestError: 'Unexpected error while handling a request ({label}): {error}',
      sweepError: 'Unexpected error during cleanup: {error}'
    },
    store: {
      ioError: 'The data folder could not be accessed: {error}',
      versionMismatch: 'The data file version ({version}) is not compatible with this server version. Nothing was written, to protect your data.',
      locked: 'The data folder is in use by another process (PID {pid}). The server may already be running. If you are sure it is not, delete the file {file} and try again.',
      recoveredMissing: 'Warning: {file} was not found, so the backup file ({backup}) was loaded.',
      missingBackupCorrupt: 'The data file ({file}) was not found and the backup file ({backup}) is corrupt. Nothing was written, to protect your data. To start a new installation, move the backup file to another folder.',
      corrupt: 'The data file is corrupt: {file} could not be read and the backup file ({backup}) cannot be used either. Nothing was written, to protect your data. Back up the data folder, then repair the file by hand or restore it from a backup.',
      recoveredCorrupt: 'Warning: {file} is corrupt, so the backup file ({backup}) was loaded. A copy of the corrupt file was kept as {copy}',
      badChannelFile: 'Warning: the file name {file} is invalid and was ignored.',
      tempRemoveFailed: 'Warning: a temporary file could not be deleted: {error}',
      compactFailed: 'A message file could not be compacted ({file}): {error}',
      badLines: 'Warning: {count} corrupt or incomplete lines were skipped in {file}.',
      duplicateMessages: 'Warning: {count} messages in {file} that also appear in another channel were ignored.',
      queueError: 'Message write queue error: {error}',
      messageWriteFailed: 'A message file could not be written ({file}): {error}. It will be retried.',
      messagesWriteError: 'Messages could not be written to disk: {error}',
      stateWriteError: 'State write error: {error}',
      backupUpdateFailed: 'Warning: the backup file ({backup}) could not be updated: {error}',
      stateFileWriteFailed: 'The state file ({file}) could not be written: {error}. It will be retried.',
      stateWriteFailed: 'The state file could not be written to disk: {error}',
      lockRemoveFailed: 'Warning: the lock file could not be removed: {error}',
      closed: 'The data store is closed.',
      partialUploadRemoveFailed: 'Warning: an incomplete upload could not be deleted: {error}',
      partialUploadsRemoved: '{count} incomplete upload files were deleted.',
      messageCounterRaised: 'Warning: the message counter was raised to {value} to match the messages on disk.',
      channelCounterRaised: 'Warning: the channel counter was raised to {value} to match the message files on disk.',
      uploadRemoveFailed: 'Warning: an upload could not be deleted: {error}',
      strayRemoveFailed: 'Warning: an unregistered upload could not be deleted: {error}',
      uploadsReconciled: 'Warning: upload records were matched with messages (linked {bound}, restored {restored}, removed {removed}).',
      straysRemoved: 'Warning: {count} upload files without a record were deleted.',
      unknownError: 'unknown error'
    },
    config: {
      badPort: '{name} is invalid: "{value}". Enter a number between 1 and 65535.',
      badMegabytes: '{name} is invalid: "{value}". Enter a number of megabytes greater than 0 and at most {max}.',
      badUrl: '{name} is invalid: "{value}". The address must start with {prefixes}.',
      or: 'or',
      badServerName: '{name} is invalid. The server name must be 1 to 40 characters long.',
      quotaTooSmall: '{quota} cannot be smaller than {upload}.',
      badCount: '{name} is invalid: "{value}". Enter a whole number between 1 and {max}.',
      badProxy: '{name} is invalid: "{value}". Enter comma-separated IP addresses, IP ranges (for example 10.0.0.0/8), loopback or none.'
    },
    console: {
      errorPrefix: 'Error: {message}',
      running: '{product} server is running.',
      version: 'Version: {version}',
      serverName: 'Server name: {name}',
      dataDir: 'Data folder: {dir}',
      setupCode: 'Setup code: {code}. Open the app in a browser and create the owner account with this code.',
      setupCodeNote: 'The code is valid only until the owner account is created and changes every time the server starts.',
      addresses: 'Addresses:',
      local: '  From this computer: {url}',
      noLan: '  No network address was found for devices on the same network.',
      lan: '  From devices on the same network: {url}',
      https: 'Voice chat and installing the app (PWA) require an address that starts with https://.',
      httpLimits: 'They do not work on plain http addresses on the local network, only at {url} on this computer.',
      tunnel: 'For https access from the internet, run {script} or use this command: {command}',
      tunnelCommand: 'For https access from the internet you can use this command (requires the cloudflared program): {command}',
      turnOn: 'TURN server: enabled.',
      turnOff: 'TURN server: not configured. Some networks need TURN for voice chat (TURN_URL setting).',
      proxy: 'Trusted reverse proxy addresses: {list}',
      stopHint: 'Press Ctrl+C to stop the server.',
      portInUse: 'Error: port {port} is already in use. The server may already be running in another window. Close that window or choose another port with the PORT environment variable.',
      portDenied: 'Error: there is no permission to open port {port}. Try a PORT value above 1024.',
      hostMissing: 'Error: the HOST address was not found on this computer. Remove the HOST setting or enter a valid address.',
      listenFailed: 'Error: the server could not be started ({error}).',
      unhandledRejection: 'Unhandled promise rejection: {error}',
      uncaughtException: 'Uncaught error: {error}',
      serverError: 'Server error: {error}',
      stopNow: 'Stopping the server immediately.',
      stopping: 'Stopping the server...',
      stopTimeout: 'Shutdown did not finish within {seconds} seconds, exiting.',
      flushFailed: 'Data could not be written to disk during shutdown: {error}',
      stopped: 'The server has stopped.',
      pressEnter: 'Press Enter to close.'
    },
    cli: {
      usageReset: 'Usage: {command} reset-password <username>',
      dataDirAccess: 'Error: the data folder could not be accessed: {dir}',
      serverRunning: 'Error: the server is running right now (PID {pid}). The running server would overwrite the change made by this command with its own data.',
      stopFirst: 'Stop the server first with Ctrl+C in its window, then run the command again.',
      noAccounts: 'Error: no registered accounts were found in the data folder: {dir}',
      dataDirHint: 'If you use the DATA_DIR (VERI_KLASORU) setting, set the same value before running the command.',
      openFailed: 'The data folder could not be opened ({error}).',
      userNotFound: 'Error: no user named "{name}" was found.',
      resetDone: 'The password of the account "{name}" has been reset.',
      tempPassword: 'Temporary password: {password}',
      sessionsClosed: 'Open sessions signed out: {count}.',
      keysReset: 'The security key of the account was reset too. Old direct messages can no longer be read with this account.',
      changeHint: 'After signing in with this password, set a new password on the My account page in Settings.',
      resetFailed: 'Error: the password could not be reset ({error}).',
      usageTitle: 'Usage:',
      usageStart: '  {command}',
      usageStartNote: '      starts the server',
      usageResetLine: '  {command} reset-password <username>',
      usageResetNote: '      resets the password of an account while the server is stopped',
      usageAliasLine: '  {command} sifre-sifirla <username>',
      usageAliasNote: '      the same command under its Turkish name'
    },
    envfile: {
      loaded: 'Settings were read from {file}',
      unknown: 'Warning: "{key}" on line {line} of {file} is not a known setting name and was ignored.',
      malformed: 'Warning: line {line} of {file} is not in the NAME=value format and was ignored.',
      duplicate: 'Warning: the setting {key} appears more than once in {file}, the value on line {line} is used.',
      skipped: 'The value of {key} in telsiz.env was not used because the setting is also defined as an environment variable.',
      tooLarge: '{file} is too large. The file may be at most {max} bytes.',
      unreadable: '{file} could not be read ({error}).'
    }
  }
}

// İç içe sözlüğü noktalı anahtarlara düzleştirir
function flatten (object, prefix, out) {
  for (const key of Object.keys(object)) {
    const value = object[key]
    if (typeof value === 'string') out.set(prefix + key, value)
    else flatten(value, prefix + key + '.', out)
  }
  return out
}

const tables = new Map(LANGS.map((lang) => [lang, flatten(messages[lang], '', new Map())]))

// 'tr', 'tr-TR', 'tr_TR.UTF-8' gibi değerlerden dil kodu, tanınmıyorsa null
function normalizeLang (value) {
  if (typeof value !== 'string') return null
  const text = value.trim().toLowerCase()
  for (const lang of LANGS) {
    if (!text.startsWith(lang)) continue
    const rest = text.slice(lang.length)
    if (rest === '' || /^[-_.@]/.test(rest)) return lang
  }
  return null
}

// Accept-Language başlığından yanıt dili. q değerleri dikkate alınır: Türkçenin ağırlığı
// sıfırdan büyük ve İngilizceden yüksekse (eşitlikte önce yazılan kazanır) tr, aksi halde en.
function pickLang (header) {
  if (typeof header !== 'string' || header === '') return DEFAULT_LANG
  const parts = header.slice(0, MAX_HEADER_CHARS).split(',', MAX_HEADER_PARTS)
  const best = { tr: { q: 0, index: Infinity }, en: { q: 0, index: Infinity } }
  parts.forEach((part, index) => {
    const pieces = part.split(';')
    const lang = normalizeLang(pieces[0])
    if (lang === null) return
    let q = 1
    for (const param of pieces.slice(1)) {
      if (!/^\s*q\s*=/i.test(param)) continue
      const match = QUALITY_RE.exec(param)
      q = match ? Math.min(1, Number(match[1])) : 0
    }
    const slot = best[lang]
    if (q > slot.q) {
      slot.q = q
      slot.index = index
    }
  })
  const tr = best.tr
  const en = best.en
  if (tr.q > 0 && (tr.q > en.q || (tr.q === en.q && tr.index < en.index))) return 'tr'
  return DEFAULT_LANG
}

function systemLocale () {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || ''
  } catch (err) {
    return ''
  }
}

// Konsol dili: DIL, yoksa TELSIZ_LANG (tr veya en). Bunlar yoksa veya tanınmıyorsa sistem
// yerel ayarı: LC_ALL, LC_MESSAGES, LANG sırasıyla ilk dolu olan, hiçbiri yoksa Intl yerel ayarı.
// Yerel ayar tr ile başlıyorsa tr, aksi halde en.
function consoleLang (env, intlLocale) {
  const vars = env || {}
  for (const name of ['DIL', 'TELSIZ_LANG']) {
    const lang = normalizeLang(vars[name])
    if (lang !== null) return lang
  }
  for (const name of ['LC_ALL', 'LC_MESSAGES', 'LANG']) {
    const value = typeof vars[name] === 'string' ? vars[name].trim() : ''
    if (value !== '') return normalizeLang(value) === 'tr' ? 'tr' : DEFAULT_LANG
  }
  const locale = intlLocale === undefined ? systemLocale() : intlLocale
  return normalizeLang(locale) === 'tr' ? 'tr' : DEFAULT_LANG
}

function lookup (lang, key) {
  const table = tables.get(lang) || tables.get(DEFAULT_LANG)
  if (table.has(key)) return table.get(key)
  for (const other of LANGS) {
    const fallback = tables.get(other)
    if (fallback.has(key)) return fallback.get(key)
  }
  return null
}

function has (lang, key) {
  const table = tables.get(lang)
  return Boolean(table) && table.has(key)
}

// Metni seçilen dilde üretir. Anahtar o dilde yoksa diğer dil, o da yoksa anahtarın kendisi döner.
// Verilmeyen parametreler olduğu gibi kalır.
function t (lang, key, params) {
  const text = lookup(lang, key)
  if (text === null) return String(key)
  if (!params) return text
  return text.replace(PARAM_RE, (whole, name) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole))
}

function keys (lang) {
  const table = tables.get(lang)
  return table ? Array.from(table.keys()) : []
}

module.exports = {
  LANGS,
  DEFAULT_LANG,
  messages,
  normalizeLang,
  pickLang,
  consoleLang,
  systemLocale,
  has,
  t,
  keys
}
