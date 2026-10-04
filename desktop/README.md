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
- Sayfada çerçeve olarak yalnızca Telsiz DJ'nin YouTube oynatıcısı açılabilir: uygulama penceresinin ana çerçevesinin doğrudan alt çerçevesi ve yalnızca `https://www.youtube-nocookie.com` kökeni (`src/lib/navigation.js`, CSP'de `frame-src`). Bu çerçevenin içindeki çerçeveler ve diğer bütün alt çerçeveler engellenir. Web uygulaması bu çerçeveyi kişi onay vermeden yüklemez. YouTube, Referer başlığı olmayan oynatıcı isteğini 153 hatasıyla reddettiği ve `telsiz://app` kökeninden Referer gitmediği için uygulama yalnız bu çerçevenin belge isteğine sunucunun kökenini (ör. `https://telsiz.ornek.com/`) Referer olarak ekler. Web sürümünde tarayıcı da YouTube'a aynı bilgiyi, sayfanın kökenini gönderir.
- Sunucu adresi yalnızca `https://` olabilir. Tek istisna bu bilgisayardaki sunucudur (`http://localhost` ve `http://127.0.0.1`). Sertifika hataları hiçbir zaman yok sayılır. Sunucu adresi ekranı sunucunun `/api/info` yanıtını denetler, sunucunun ana sürümü uygulamanınkinden farklıysa veya sunucu sürümünü bildirmiyorsa uyarı gösterir, kullanıcı yine de bağlanabilir.
- Her sunucu kendi oturum bölümünü kullanır. Bir sunucunun oturum anahtarı ve yerel verisi başka bir sunucuya gönderilemez.
- Pencereler `contextIsolation`, `sandbox` ve `webSecurity` açık, `nodeIntegration` kapalı olarak açılır. Şema dışı gezinme ve yeni pencere engellenir, `https://` bağlantılar varsayılan tarayıcıda açılır. Webview yoktur. Service worker bu şemada kaydedilemez. Geliştirici araçları yalnızca geliştirme düzeninde (paketlenmemiş) açılır.
- İzinler yalnızca `telsiz://app` kökeninin ana çerçevesine verilir: mikrofon (yalnızca ses), sistem bildirimleri ve panoya yazma. Kamera, konum, pano okuma, HID, USB ve diğerleri reddedilir. Ekran yakalama yalnızca aşağıdaki ekran seçiciyle verilir.
- Ön yükleme betiği sayfaya yalnızca dar bir API açar (`window.telsizDesktop`). IPC kanalları sabit adlıdır, her çağrının hangi pencereden ve kökenden geldiği ve her girdi ana süreçte denetlenir.
- Paketlenmiş uygulamada Electron sigortaları ayarlıdır: `ELECTRON_RUN_AS_NODE` ve `NODE_OPTIONS` yok sayılır, uygulama yalnızca `app.asar` içinden yüklenir ve Windows'ta asar bütünlüğü doğrulanır. `--inspect` bayrağı bilerek açık bırakılır. Duman testi Playwright ile yayımlanan derlemenin kendisi üzerinde bu bayrakla çalışır. Aynı kullanıcı haklarına sahip yerel bir program uygulama verisine zaten doğrudan erişebildiği için bu bayrak ek bir yetki vermez.

## Frekanslar

Arayüzde her Telsiz sunucusu bir frekanstır. Uygulama birden çok frekansı hatırlar ve kullanıcı aralarında geçer. Sunucu tarafı ve şifreleme modeli değişmez: her frekans ayrı bir sunucu, ayrı hesap ve ayrı anahtardır.

- Liste `ayarlar.json` içinde `frequencies` alanında tutulur: `[{ origin, name, lastUsed }]`, etkin frekans `server` alanıdır (`src/lib/frequencies.js`, `src/lib/settings-store.js`). Her köken `server-url.js` kurallarıyla doğrulanır, liste en fazla 50 frekanstır. Eski sürümün tek sunucu adresi ilk açılışta listeye eklenir, oturum bölümleri zaten kökene göre olduğu için girişler kaybolmaz.
- Görünen ad bağlantı penceresinin denetlediği `/api/info` yanıtındaki sunucu adıdır. Web uygulaması adı sonradan öğrenirse (sunucu adı değişince) `setFrequencyName` ile bildirir, ad yalnızca pencerenin açık olduğu frekansa yazılır. Ad yoksa ana bilgisayar adı gösterilir.
- Üstteki frekans bandı (`public/js/24-frekans.js`) listeyi kayıt sırasıyla gösterir: açık frekans işaretli (ibre), başka bir istasyona basınca, ibre sürüklenince, uç düğmeleriyle veya kolun L1 ve R1 düğmeleriyle geçilir. Bandın Tümü düğmesi aynı listeyi Frekanslar sayfasında açar. Geçişte uygulama penceresi o frekansın oturum bölümüyle yeniden açılır ve eski pencere kapanır (ses bağlantısı da kapanır). Frekans ekle (bandın + düğmesi) frekans adresi penceresini ekleme kipinde açar, başarılı bağlantıda yeni frekans listeye eklenir ve etkin olur. Frekanslar sayfasındaki Listeden çıkar onay ister. O frekansın bu cihazdaki oturum verisi (giriş, yerel depo, önbellek) yalnızca onay penceresindeki kutu işaretlenirse silinir, varsayılan korumaktır. Etkin frekans çıkarılırsa en son kullanılan diğer frekansa geçilir, liste boşalırsa adres penceresi açılır.
- Uygulama menüsündeki ve tepsideki Frekanslar alt menüsü de listeyi gösterir ve aynı geçişi yapar.
- Sayfadan gelen her köken ve ad ana süreçte yeniden doğrulanır: köken dize, uzunluğu sınırlı, geçerli ve listede kayıtlı olmalıdır. IPC işleyicileri diğerleri gibi çağrının uygulama penceresinin ana çerçevesinden ve `telsiz://app` kökeninden geldiğini denetler.

Sınırlar: geçişte ses bağlantısı kesilir (ses odasındayken önce sorulur). Liste cihazlar arasında eşitlenmez. Açık olmayan frekansların sayıları aşağıdaki arka plan sayımıyla gösterilir.

## Arka plan sayımı

Üstteki frekans bandı açık olmayan frekansların da durumunu ve okunmamış sayılarını gösterir. Bunun için ana süreç (`src/lib/background.js`, `src/main.js createBackgroundWindow`) açık olmayan her kayıtlı frekans için o frekansın kendi oturum bölümünde gizli bir arka plan penceresi çalıştırır.

- Üst sınır 8 pencere: en son kullanılan 8 frekans (`lastUsed`, açık frekans hariç). Bellek ve ağ yükü sınırlı kalsın diye pencereler açılıştan 3 saniye sonra ve 1,5 saniye arayla teker teker açılır. Sınırın dışındaki frekansların yalnızca erişilebilirliği gösterilir.
- Pencere aynı uygulama paketini, aynı ön yükleme betiğini, korumalı alanı ve CSP'yi kullanır. Görünmezdir, görev çubuğunda yoktur, sesi kapalıdır, görseller yüklenmez ve otomatik oynatma kullanıcı etkileşimi ister. Yalnızca bildirim izni vardır (mikrofon dahil diğer izinler reddedilir), YouTube çerçevesi açılamaz.
- Ön yükleme betiği arka plan kipini yalnızca ana sürecin eklediği `--telsiz-background=<köken>` argümanıyla açar ve sayfaya `window.telsizArkaPlan` nesnesini verir. Sayfa içeriği bu argümanı değiştiremez. İstemcinin arka plan kipi (`public/js/25-arka-plan.js`) arayüzü çizmez, ses, ekran paylaşımı, Telsiz DJ ve mesaj sesi başlatmaz, o frekansın kayıtlı oturumuyla long-poll yapar, okunmamışları ve anmaları normal istemcinin kuralıyla sayar (anma tespiti için mesajı bu cihazdaki anahtarla çözer) ve son okunan bilgisini yazmaz.
- Pencere durumu (`origin`, `state`, `unread`, `mention`, `online`, `lastError`, `name`, `onlineUsers`) `telsiz:bg-report` kanalıyla en fazla saniyede bir bildirir. Ana süreç raporu yalnızca kayıtlı bir arka plan penceresinin ana çerçevesinden ve `telsiz://app` kökeninden kabul eder, köken o pencerenin frekansı olmalıdır, her alan türü ve sınırıyla denetlenir, bilinmeyen alan içeren rapor reddedilir. Toplanan durum `telsiz:bg-state` olayıyla uygulama penceresine gönderilir (`window.telsizArkaPlan.onState`, `getState()`).
- Oturumu olmayan veya geçersiz frekans "giriş gerekli" bildirir: pencere kapanır ve o frekans bir kez açılana kadar yeniden açılmaz. Oturum bilgisine dokunulmaz. Çöken pencere 30 saniye sonra, art arda çökmede seyrelerek yeniden açılır.
- Erişilebilirlik (çevrimiçi ve çevrimdışı noktası) için ana süreç her kayıtlı frekansa (sınırın dışındakiler dahil) kalıcı olmayan ayrı bir oturumla `GET <köken>/api/info` isteği gönderir: 8 saniye zaman aşımı, başarıda yaklaşık 60 saniyede bir, hatada katlanarak 10 dakikaya kadar seyrelir.
- Bir frekansa geçince onun arka plan penceresi uygulama penceresi yüklenmeden kapanır (aynı oturumla iki istemci çalışmaz), önceki frekansın penceresi 3 saniye sonra açılır. Uygulama penceresi kapanınca ve uygulamadan çıkınca bütün arka plan pencereleri kapanır. Pencere tepsiye küçültülmüşken arka plan pencereleri çalışmaya devam eder.
- O frekansta Ayarlar > Bildirimler'den masaüstü bildirimleri açıksa sizi anan mesaj ve özel mesaj için sessiz bir sistem bildirimi gösterilir (bildirim düzeyi ve Rahatsız etmeyin kuralı geçerlidir). Bildirime basınca o frekansa geçilir.

Gizlilik: her arka plan penceresi o sunucuya oturumunuzla bağlı kalır. Sunucu sizi çevrimiçi görür ve poll isteklerini alır, diğer üyeler de sizi çevrimiçi görür. Arka plan penceresi mesaj göndermez, okundu bilgisi yazmaz.

Sayılar oturuma özeldir: istemci okunmamışları sunucuda değil bu cihazda sayar. Uygulama yeniden açılınca arka plan pencereleri son okunan bilgisinden (oda ve özel konuşma başına son 50 mesaja kadar) yeniden sayar.

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
| `src/connect/`, `src/connect-preload.js` | Frekans adresi ekranı (ilk frekans ve Frekans ekle) |
| `src/picker/`, `src/picker-preload.js` | Ekran paylaşımı seçicisi |
| `src/lib/` | Electron'dan bağımsız saf modüller: adres doğrulama, frekans listesi, arka plan sayımı, kısayol doğrulama, beyaz liste, iletme, CSP, gezinme, izinler, ekran paylaşımı kararları, bütünlük, ayarlar, metinler, tanı günlüğü, otomasyon kapısı |
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
- `window.TelsizDesktopUI.renderShortcutSettings(kapsayici)` genel kısayol bölümünü, `window.TelsizDesktopUI.renderAppSettings(kapsayici)` etkin frekans ve tepsiye küçültme bölümünü çizer.
- Frekans bandı ve menüsü (`public/js/24-frekans.js`) masaüstünde listeyi tarayıcının yerel deposu yerine aşağıdaki frekans çağrılarıyla yönetir, açık olmayan frekansların durumunu `window.telsizArkaPlan` ile alır.

`window.telsizDesktop` API'si:

| Üye | Açıklama |
| --- | --- |
| `version`, `platform` | Uygulama sürümü ve işletim sistemi (`win32`, `linux`) |
| `getServer()` | Ayarlardaki sunucu kökeni |
| `changeServer()` | Frekans adresi penceresini açar (Frekans ekle) |
| `getSettings()` | `server`, `closeToTray`, `trayAvailable`, `shortcuts`, `registered` |
| `setShortcuts(map)` | `{ toggleMute, toggleDeafen }`, değerler Electron kısayol dizgesi veya `null` |
| `onShortcut(cb)` | `cb('toggleMute' veya 'toggleDeafen')`, dönen işlev aboneliği kaldırır |
| `setCloseToTray(bool)` | Pencere kapatılınca tepsiye küçültme |
| `listFrequencies()` | `{ active, items: [{ origin, name, host, active, order }] }`, etkin frekans başta, `order` kayıt sırası (bant bu sırayla dizer) |
| `switchFrequency(origin)` | Listedeki frekansa geçer, `{ ok }` |
| `addFrequency()` | Frekans adresi penceresini ekleme kipinde açar |
| `removeFrequency(origin, clearData)` | Frekansı listeden çıkarır, `clearData` yalnızca `true` ise oturum verisini siler |
| `setFrequencyName(name)` | Açık frekansın sunucudan öğrenilen adı |

`window.telsizArkaPlan` (ayrı nesne): uygulama penceresinde `{ background: false, getState(), onState(cb) }`, durum `{ items: [{ origin, active, state, unread, mention, online, onlineUsers }] }` biçimindedir. Arka plan penceresinde `{ background: true, origin, report(rapor), open() }`.

Kısayollarda değiştiricisiz harf, rakam veya noktalama ile yalnızca Shift'li harf, rakam veya noktalama kabul edilmez, çünkü genel kısayol o tuşu bütün uygulamalardan alır. F1 ile F24 arası tuşlar ile ses ve medya tuşları tek başına kullanılabilir.

## Ayarlar ve veriler

Masaüstü ayarları (etkin frekans, frekans listesi, tepsiye küçültme, kısayollar) uygulama verisi klasöründeki `ayarlar.json` dosyasındadır (biçim 2, biçim 1 okunurken listeye çevrilir). Bu klasör Windows'ta `%APPDATA%\Telsiz`, Linux'ta `~/.config/Telsiz` olur. Web uygulamasının yerel verisi aynı klasörde, her frekans (sunucu) için ayrı bir oturum bölümündedir.

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
