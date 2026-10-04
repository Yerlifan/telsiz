# Telsiz masaüstü uygulaması

[English](README.en.md)

Bu klasör Telsiz'in Windows ve Linux için Electron tabanlı masaüstü uygulamasıdır. Bu belge geliştiriciler içindir. Kullanıcıya yönelik kurulum anlatımı depo kökündeki README dosyasındadır.

## Neden ayrı bir uygulama

Web sürümünde arayüz kodu her açılışta sunucudan gelir. Sunucu ele geçirilirse kullanıcıya değiştirilmiş kod sunulabilir. Bu, tarayıcıda çalışan her uçtan uca şifreli uygulamanın bilinen sınırıdır.

Masaüstü uygulamasında arayüz kodu uygulamanın içinde taşınır ve sunucudan hiç indirilmez. Sunucu yalnızca API isteklerine yanıt verir ve yalnızca şifreli verileri görür. Böylece ele geçirilmiş bir sunucu masaüstü kullanıcısına değiştirilmiş kod sunamaz.

## Güvenlik mimarisi

- Derleme sırasında `public/` klasöründen yalnızca sunucunun beyaz listesine uyan dosyalar `desktop/app/` altına kopyalanır (service worker hariç). Her dosyanın sha256 değeri ve boyutu `desktop/app/butunluk.json` bildirimine yazılır.
- Uygulama açılışta bildirimdeki her dosyayı doğrular ve dosyaları yalnızca bu doğrulanmış bellek kopyasından sunar. Tek bir dosya eksik veya farklıysa uygulama açılmaz.
- Sayfa `telsiz://app/` ayrıcalıklı şemasından yüklenir. `telsiz://app/api/*` istekleri ana süreçte ayarlardaki sunucuya iletilir (`src/lib/proxy.js`). İstekten yalnızca `X-Token`, `Content-Type` ve `Accept-Language` başlıkları geçer. Yönlendirmeler izlenmez, çerez ve önbellek kullanılmaz. Long-poll, yükleme ve indirme gövdeleri akış olarak geçer.
- Sayfanın CSP'si sunucudakiyle birebir aynıdır (`connect-src 'self'`). Sayfa sunucuya doğrudan bağlanamaz, her istek vekilden geçer. Vekilden dönen yanıtlar betik çalıştıramayan bir CSP ile ve yalnızca JSON, ikili veya düz metin türüyle geçer.
- Sunucu adresi yalnızca `https://` olabilir. Tek istisna bu bilgisayardaki sunucudur (`http://localhost` ve `http://127.0.0.1`). Sertifika hataları hiçbir zaman yok sayılır.
- Her sunucu kendi oturum bölümünü kullanır. Bir sunucunun oturum anahtarı ve yerel verisi başka bir sunucuya gönderilemez.
- Pencereler `contextIsolation`, `sandbox` ve `webSecurity` açık, `nodeIntegration` kapalı olarak açılır. Şema dışı gezinme ve yeni pencere engellenir, `https://` bağlantılar varsayılan tarayıcıda açılır. Webview yoktur. Service worker bu şemada kaydedilemez. Geliştirici araçları yalnızca geliştirme düzeninde (paketlenmemiş) açılır.
- İzinler yalnızca `telsiz://app` kökeninin ana çerçevesine verilir: mikrofon (yalnızca ses), sistem bildirimleri ve panoya yazma. Kamera, konum, pano okuma, HID, USB ve diğerleri reddedilir. Ekran yakalama yalnızca aşağıdaki ekran seçiciyle verilir.
- Ön yükleme betiği sayfaya yalnızca dar bir API açar (`window.telsizDesktop`). IPC kanalları sabit adlıdır, her çağrının hangi pencereden ve kökenden geldiği ve her girdi ana süreçte denetlenir.
- Paketlenmiş uygulamada Electron sigortaları ayarlıdır: `ELECTRON_RUN_AS_NODE` ve `NODE_OPTIONS` yok sayılır, uygulama yalnızca `app.asar` içinden yüklenir ve Windows'ta asar bütünlüğü doğrulanır. `--inspect` bayrağı bilerek açık bırakılır. Duman testi Playwright ile yayımlanan derlemenin kendisi üzerinde bu bayrakla çalışır. Aynı kullanıcı haklarına sahip yerel bir program uygulama verisine zaten doğrudan erişebildiği için bu bayrak ek bir yetki vermez.

## Ekran paylaşımı seçicisi

Web uygulaması `getDisplayMedia` çağırdığında ana süreç kendi seçici penceresini açar (`src/picker/`). Seçici ekranları ve pencereleri küçük resim ve adlarıyla gösterir. Seçici yalnızca son birkaç saniyede gerçek bir kullanıcı girişi (tıklama veya tuş) olduysa açılır ve yalnızca kullanıcının seçtiği kaynak verilir. Vazgeçilirse istek reddedilir. Eski `chromeMediaSource: 'desktop'` çağrısı seçiciyi atlayamaz. Sistem sesini paylaşma seçeneği yalnızca Windows'ta gösterilir, çünkü Electron belgelerine göre sistem sesi yakalama (`loopback`) şu an yalnızca Windows'ta desteklenir.

## Gereksinimler

- Node.js 22 ve npm
- Linux'ta grafik oturum veya duman testi için `xvfb-run`
- Depo kökündeki sunucu kodu (testler gerçek bir Telsiz sunucusu başlatır)

## Komutlar

Bütün komutlar `desktop/` klasöründe çalıştırılır.

| Komut | Ne yapar |
| --- | --- |
| `npm ci` | Geliştirme bağımlılıklarını kurar (electron, electron-builder, playwright) |
| `npm run hazirla` | `public/` dosyalarını `app/` altına kopyalar, bütünlük bildirimini yazar, simgeleri `build/` altına üretir |
| `npm start` | Hazırlığı yapar ve uygulamayı geliştirme düzeninde açar |
| `npm test` | Birim testleri (Electron gerekmez, iletme mantığı gerçek bir yerel sunucuya karşı denenir) |
| `npm run test:duman` | Playwright `_electron` duman testi (Linux'ta `xvfb-run -a npm run test:duman`) |
| `npm run derle:win` | Windows NSIS kurucu ve taşınabilir exe (`dist/`) |
| `npm run derle:linux` | Linux AppImage ve .deb (`dist/`) |

Duman testi varsayılan olarak geliştirme düzenindeki uygulamayı açar. `TELSIZ_UYGULAMA` ortam değişkeni paketlenmiş yürütülebilir dosyayı gösterirse (ör. `dist/linux-unpacked/telsiz-masaustu` veya `dist/win-unpacked/Telsiz.exe`) test onunla yapılır. Test 4300 ile 4349 arasındaki ilk boş portta bir Telsiz sunucusu başlatır ve uygulamayı boş bir kullanıcı verisi klasörüyle açar.

Test uygulamayı `TELSIZ_TANI_GUNLUGU` ortam değişkeniyle açar. Bu değişken mutlak bir dosya yolu verirse ana süreç açılış adımlarını (tek örnek kilidi, bütünlük denetimi, pencereler, sayfa yüklemeleri, alt süreç çökmeleri) o dosyaya ve stderr'e yazar ve açılışı durduran hatayı engelleyici bir hata kutusu yerine günlükle bildirir (`src/lib/diagnostics.js`). Değişken yokken kullanıcı hatayı her zamanki gibi hata kutusunda görür. Test ayrıca `TELSIZ_PLAYWRIGHT=1` verir: Node.js denetleyicisi açıksa uygulama ilk pencereyi Playwright bağlanıp ana süreçte `__playwright_run()` çağrılana kadar açmaz (`src/lib/automation.js`). Playwright paketlenmiş uygulamaya kendi yükleyicisini eklemediği için, bağlanma ilk gezinmenin ortasına denk gelirse (Windows'ta) gezinme olayı Playwright'a ulaşmaz ve başlatma sonsuza dek beklerdi. Çağrı 30 saniye içinde gelmezse uygulama yine açılır. Bir test düşerse ana süreç günlüğü, uygulamanın çıktısı, başlatma hatası ve ekran görüntüsü `duman-sonuclar/` altına yazılır. `DEBUG=pw:protocol` ile `DEBUG_FILE` verilirse Playwright protokol günlüğü de o dosyaya yazılır.

Derleme çıktıları:

- `Telsiz-Kurulum-<sürüm>.exe` (Windows kurucu)
- `Telsiz-<sürüm>-tasinabilir.exe` (Windows taşınabilir)
- `Telsiz-<sürüm>-linux-x86_64.AppImage`
- `telsiz-masaustu_<sürüm>_amd64.deb`

## Dosya düzeni

| Yol | İçerik |
| --- | --- |
| `src/main.js` | Ana süreç: pencereler, şema, oturum politikaları, menü, tepsi, kısayollar, IPC |
| `src/preload.js` | Uygulama penceresinin ön yükleme betiği (`window.telsizDesktop`) |
| `src/connect/`, `src/connect-preload.js` | Sunucu adresi ekranı |
| `src/picker/`, `src/picker-preload.js` | Ekran paylaşımı seçicisi |
| `src/lib/` | Electron'dan bağımsız saf modüller: adres doğrulama, kısayol doğrulama, beyaz liste, iletme, CSP, gezinme, izinler, ekran paylaşımı kararları, bütünlük, ayarlar, metinler, tanı günlüğü, otomasyon kapısı |
| `scripts/hazirla.js` | Derleme hazırlığı |
| `scripts/simge.js` | Arcade logosundan (`public/favicon.svg`) simge üretimi, bağımlılıksız |
| `test/` | Birim testleri |
| `e2e/duman.test.js` | Duman testi |
| `electron-builder.json` | Paketleme yapılandırması |

Masaüstü uygulamasının menü, tepsi, sunucu adresi ekranı ve seçici metinleri `src/lib/strings.js` içindedir. Sistem dili Türkçe ise Türkçe, değilse İngilizce gösterilir. Web uygulamasının masaüstüne özgü metinleri `public/i18n.js` içindeki `desktop.` önekli anahtarlardır.

## Web uygulaması tümleştirmesi

`public/js/20-desktop.js` yalnızca `window.telsizDesktop` varsa etkinleşir:

- Genel kısayol olaylarında `toggleMute` ve `toggleDeafen` işlevlerini çağırır.
- PWA yükleme önerisini engeller.
- `window.TelsizDesktopUI.renderShortcutSettings(kapsayici)` genel kısayol bölümünü, `window.TelsizDesktopUI.renderAppSettings(kapsayici)` sunucu adresi ve tepsiye küçültme bölümünü çizer.

`window.telsizDesktop` API'si:

| Üye | Açıklama |
| --- | --- |
| `version`, `platform` | Uygulama sürümü ve işletim sistemi (`win32`, `linux`) |
| `getServer()` | Ayarlardaki sunucu kökeni |
| `changeServer()` | Sunucu adresi penceresini açar |
| `getSettings()` | `server`, `closeToTray`, `trayAvailable`, `shortcuts`, `registered` |
| `setShortcuts(map)` | `{ toggleMute, toggleDeafen }`, değerler Electron kısayol dizgesi veya `null` |
| `onShortcut(cb)` | `cb('toggleMute' veya 'toggleDeafen')`, dönen işlev aboneliği kaldırır |
| `setCloseToTray(bool)` | Pencere kapatılınca tepsiye küçültme |

Kısayollarda değiştiricisiz harf, rakam veya noktalama ile yalnızca Shift'li harf, rakam veya noktalama kabul edilmez, çünkü genel kısayol o tuşu bütün uygulamalardan alır. F1 ile F24 arası tuşlar ile ses ve medya tuşları tek başına kullanılabilir.

## Ayarlar ve veriler

Masaüstü ayarları (sunucu adresi, tepsiye küçültme, kısayollar) uygulama verisi klasöründeki `ayarlar.json` dosyasındadır. Bu klasör Windows'ta `%APPDATA%\Telsiz`, Linux'ta `~/.config/Telsiz` olur. Web uygulamasının yerel verisi aynı klasörde, her sunucu için ayrı bir oturum bölümündedir.

## Bilinen sınırlar

- Uygulama imzalı değildir. Windows SmartScreen ilk açılışta "Windows kişisel bilgisayarınızı korudu" uyarısı gösterebilir. "Ek bilgi" ve ardından "Yine de çalıştır" seçilir. İndirilen dosya sürüm sayfasındaki `SHA256SUMS.txt` ile doğrulanabilir.
- Otomatik güncelleme yoktur, çünkü imzasız güncelleme güvenli değildir. Yeni sürüm elle indirilip kurulur.
- Basılı tutmalı bas-konuş genel kısayolu yoktur, çünkü bu yerel bir modül gerektirir. Bas-konuş tuşu yalnızca pencere öndeyken çalışır. Genel kısayollar yalnızca mikrofonu aç/kapat ve sağırlaştır içindir.
- Linux'ta Wayland oturumlarında genel kısayolların çalışıp çalışmadığı doğrulanmadı.
- Electron belgelerine göre Windows bildirimleri Başlat menüsünde uygulama kısayolu gerektirir. Kurucu bu kısayolu oluşturur, taşınabilir sürümde bildirimler görünmeyebilir.
- AppImage çalıştırmak için önce `chmod +x Telsiz-<sürüm>-linux-x86_64.AppImage` gerekir. Bazı dağıtımlarda AppImage için FUSE desteği kurulmalıdır. Yetkisiz kullanıcı ad alanlarını AppArmor ile kısıtlayan dağıtımlarda (ör. Ubuntu 24.04) AppImage, Chromium korumalı alanı açılamadığı için başlamayabilir. Bu durumda .deb paketi kullanılır, paket gerekli AppArmor profilini kurar. Korumalı alanı kapatan `--no-sandbox` bayrağı önerilmez.
- Pencere arka plandayken ses etkinliği algılamasının sürmesi için Chromium'un arka plan zamanlayıcı kısması kapatılır (`disable-background-timer-throttling`). Sayfa görünürlüğü değişmez, bildirimler yine yalnızca pencere gizliyken çıkar.

## Sürekli entegrasyon

`.github/workflows/desktop.yml` çekme isteklerinde ve `main` gönderimlerinde birim testlerini çalıştırır, Linux ve Windows paketlerini derler ve duman testini paketlenmiş derlemeyle yapar (Linux'ta xvfb altında). Artifact adları `telsiz-desktop-windows` ve `telsiz-desktop-linux` olur. İş akışı `workflow_call` ile sürüm iş akışından da çağrılır ve kendisi yayın yapmaz.
