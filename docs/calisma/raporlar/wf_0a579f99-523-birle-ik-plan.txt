# Telsiz: 18 isteğin uygulama planı

Bu plan sekiz araştırma raporundan derlendi. Depoda hiçbir dosya değiştirilmedi. Satır numaraları HEAD `9a87e7d` içindir. Renk iş akışı ilerledikçe satırlar kayar, bu yüzden uygulayıcı yeri satır numarasıyla değil işlev adıyla bulmalı.

**Raporlardan sapan bir kullanıcı kararı var.** DJ raporu istek 5 için Data API anahtarı önermişti. `docs/calisma/README.md` ("Kullanıcı kararları") ise kullanıcının 10 Ekim 2026'da **anahtarsız yolu** seçtiğini söylüyor. Bu yolda arama sunucuda yapılır ve istemcinin IP adresi YouTube'a gitmez. Teknik notlar `docs/calisma/youtube-arama-notlari.md` dosyasında. Plan kullanıcının kararını uygular, Hizmet Şartları riskini 2. bölümde açıkça yazar.

**Bu planın kendi kararları:**
- Kod çakışmasını azaltmak için bir iskele grubu (G0) en başa konur. Bu grup `10-voice.js` içine kanca kaydı ve `i18n.js` içine grup işaretleri ekler.
- Masaüstündeki pencere durumu ve boşta süresi kanalları ayrı küçük bir gruba (G1) alınır.
- Yeni modül numaraları, e2e dosya numaraları ve port yuvaları baştan dağıtılır. Dört rapor da 38 numarasını istiyordu.

---

## 1. Özet tablo

| No | Kısa ad | Tür | Büyüklük | Önerilen varsayılan | Dış kısıt | Grup |
|---|---|---|---|---|---|---|
| 1 | Android Google Play uygulaması | özellik | XL | Arayüz APK içinde gelir ama sayfa sunucunun kendi adresinde açılır (raporda seçenek a3). Kotlin, minSdk 26, hedef API 36, yalnızca Play'de dağıtım | Play'in hedef API, AAB, ön plan hizmeti beyanı, kapalı test, gizlilik politikası ve hesap silme, kullanıcı içeriği (UGC) şartları var. WebView'da `getDisplayMedia` ve `Notification` yok | G15 (G16 önkoşul) |
| 2 | Otomatik boşta | özellik | L | Açık, 10 dakika. Ses odasındayken boşta sayılmaz, elle seçilen durumlara dokunulmaz | Idle Detection API kullanılamaz. Gizli sekmede karar yaklaşık 1 dakika gecikebilir | G8 |
| 3 | Profil değişikliği her yere yansımıyor | hata | M | Başarısız istekler yeniden denenir. Önbellek anahtarlarına bir sayaç (epoch) eklenir. Bildirimler güncel adı gösterir | yok | G6 |
| 4 | Hexball | özellik | XL | Ad "Hexball". Ev sahibi ile koltuklar arasında eşten eşe veri kanalı. Varsayılan ön ayar `classic` | Ad ve marka durumu doğrulanamadı. PS5 desteği doğrulanamadı | G17 (Renk bitince) |
| 5 | `/çal şarkı adı` ile YouTube araması | özellik | L | Kullanıcı kararıyla anahtarsız sunucu araması. Sahip Ayarlar'dan açar, varsayılan kapalı. İlk sonuç doğrudan eklenir | YouTube Hizmet Şartları otomatik erişimi yasaklıyor. Canlı doğrulanmadı | G4 |
| 6 | Ekleyenin ve şarkının adı sohbette yok | hata | M | Başlık için en çok 8 saniye beklenir. Bildirimler listesine de kayıt düşer | yok | G3 |
| 7 | Simge durumunda yüzen kameralar veya avatarlar | özellik | L | Masaüstünde simge durumu ve tepsiye gizleme anında otomatik açılır. Tarayıcıda düğmeyle, Chrome ve Edge'de sekme değişince de açılır | Belge PiP Safari ve Android'de yok. Tarayıcı simge durumuna küçültülünce otomatik açılmaz. Wayland'de pencere üstte kalmaz | G11 |
| 8 | Kapak fotoğrafı | özellik | L | 3:1 oran, 1200x400. Kapak yalnızca kart açılınca indirilir. 1 MB sınırı | Şifreli düz metin biçimi değişiyor, CONTRIBUTING:184 issue istiyor | G7 |
| 9 | Profil kartında ad ve rol düzeni | özellik | M | Ad avatarın sağında, rol adın yanında. Düz üyede de "Üye" rozeti çıkar | yok | G6 |
| 10 | Discord'a benzemeyen özgün tasarım | özellik | XL | "Telsiz yönü": Kayıt defteri mesaj düzeni varsayılan, Klasik seçenek olarak kalır. "Sağırlaştır" yerine "Hoparlör", durum LED'i, QSL profil kartı | yok | G13 |
| 11 | Daha fazla tema | özellik | L | 7 yeni tema. Arcade varsayılan kalır. Yüksek Kontrast, `prefers-contrast` açıksa yalnızca ilk açılışta seçilir | Eski WebKit'te CSS sınırları | G12 |
| 12 | Arkadaş ekle yer tutucusu | özellik (metin) | S | "Kullanıcı adı giriniz" | yok | G0 |
| 13 | DJ şarkısı diğer üyelerde hemen başlamıyor | hata | L | Arka plandaki çizim düzeltilir. YouTube başlangıç payı 3000 ms. Rıza erken sorulur. Kalıcı çerçeve ayrı PR olur | Chrome gizli sayfada rAF'ı durdurur. Mobilde kullanıcı dokunuşu kısıtı doğrulanamadı | G3, G5 |
| 14 | Şifremi unuttum | özellik | L | 128 bitlik kurtarma kodu. E-posta yok. Kodu olmayan için sahibe yönlendirme | Kodu olmayan kişi eski özel mesajlarını kurtaramaz | G14 |
| 15 | DJ oynatıcısı taşınabilir olsun, görünmeden çalsın | özellik | M-L | Dört köşeye oturur, Taşı düğmesi var. Küçültülünce YouTube yalnızca bu cihazda duraklar | YouTube: en az 200x200 alan şartı ve görüntüsüz çalma yasağı. İsteğin "görünmeden çalsın" kısmı YouTube için yapılamaz | G3 |
| 16 | Ekran yayınını küçültme ve yüzdürme | özellik | M | Önizleme tamamen gizlenir, üstte çip kalır. Yayıncının yüzen penceresi odayı gösterir | Linux'ta ve tarayıcıda yüzen pencere tam ekran paylaşımına girer | G11 |
| 17 | Yazı kanallarında ve sohbetlerde gezinme | hata ve özellik | XL | Geçmişe kayıt yazılır ama adres değişmez. Okunmamış ayracı, yeni mesaj kapsülü, özel mesaj grubu, kısayollar | yok | G2, G9, G10 |
| 18 | Uygulama arka plandayken müzik duruyor | hata | M | Dosya parçaları çalar. Masaüstünde küçültülünce YouTube duraklar. Media Session eklenir | YouTube arka planda oynatmayı yasaklıyor | G3 |

---

## 2. Kullanıcıya bildirilmesi gereken kısıtlar

### 2.1 Doğrulanmış dış kısıtlar ve tam yapılamayan kısımlar

**1. YouTube "görünmeden" ya da "arka planda" çalmaz (istek 15'in bir kısmı, istek 18'in bir kısmı).**
- YouTube oynatıcısı en az 200x200 piksel alan ister ve üstüne katman konamaz.
- Ses ile görüntü ayrılamaz. Pencere kapalı veya küçültülmüşken çalmaya izin vermek, politika rehberinde yasak örnekler arasında.
- Bu yüzden şunlar yapılmayacak: YouTube parçasının video görünmezken çalması, masaüstünde tepsiye alınınca çalmaya devam etmesi, telefonda ekran kapalıyken çalması.
- Yapılabilecekler:
  - Dosya parçaları (yüklenen ses) arka planda çalar.
  - YouTube küçültülünce yalnızca o cihazda duraklar. Pencere açılınca odayla eşitlenip devam eder.
- Kaynaklar:
  - https://developers.google.com/youtube/terms/required-minimum-functionality ve https://developers.google.com/youtube/player_parameters (arama özeti, resmî sayfa açılamadı)
  - https://developers.google.com/youtube/terms/developer-policies-guide ve https://developers.google.com/youtube/terms/developer-policies (arama özeti)
  - Katman yasağı yalnızca üçüncü taraf alıntısında görüldü: https://optiview.dolby.com/docs/theoplayer/faq/is-youtube-supported/ (kısmen doğrulandı)
- YouTube 2026 başından beri üçüncü taraf mobil tarayıcılarda Premium olmayanlar için arka plan oynatmayı engelliyor (haber kaynakları):
  - https://www.androidauthority.com/youtube-background-playback-browsers-fix-3636806/
  - https://9to5google.com/2026/02/02/youtube-background-playback-workarounds-not-working-third-party-browsers/
  - Bunun gömülü oynatıcıyı nasıl etkilediği doğrulanamadı.

**2. Şarkı adıyla arama (istek 5): anahtarsız yol Hizmet Şartlarına aykırı.**
- YouTube Hizmet Şartları otomatik erişimi ("robots, botnets or scrapers") yasaklıyor. İstisnalar yalnızca robots.txt'ye uyan herkese açık arama motorları ve YouTube'un önceden verdiği yazılı izin. 2022 kopyalarında "yasanın izin verdiği durumlar" istisnası da vardı, güncel metinde olup olmadığı doğrulanamadı.
  - Kaynaklar: https://www.youtube.com/terms (arama özeti), arşiv kopyası https://webcf.waybackmachine.org/web/20220423214446/https://www.youtube.com/t/terms
- Kullanıcı bu riski bilerek anahtarsız yolu seçti (`docs/calisma/README.md`). Plan bu kararı uygular, ayrıca:
  - Özellik sunucu başına bir sahip anahtarıyla açılır ve **varsayılan kapalıdır**. Açılırken uyarı metni gösterilir. Gerekçe: bu depoyu kuran başka sunucu sahipleri riski bilmeden üstlenmesin.
- Kalan riskler:
  - YouTube yanıt biçimini değiştirirse arama sessizce bozulur. Plan bu durumda aramayı kapatır, bağlantıyla ekleme çalışmaya devam eder.
  - Sunucunun IP adresi YouTube tarafından engellenebilir.
  - Bu kapsayıcı youtube.com'a erişemiyor. Arama hiç canlı denenmedi, ilk canlı doğrulamayı sunucu sahibi yapacak (notlar 9. bölüm).
- Arama metni sunucuya düz metin olarak gider. Bugün DJ durumu sunucudan gizli (şifreli zarf). Bu istisna belgelenecek.
- IFrame API'deki `listType=search` 15 Kasım 2020'de kaldırıldı, oynatıcının kendi aramasıyla yapılamaz: https://developers.google.com/youtube/iframe_api_revision_history (arama özeti).

**3. Android uygulaması (istek 1).**
- **Bu ortamda derlenemez.** dl.google.com vekilde 403 veriyor, Android SDK ve AGP indirilemiyor. APK ve AAB yalnızca GitHub Actions'ta derlenir. Saf Kotlin çekirdeği burada test edilebilir.
- Play şartları:
  - Ağustos 2026'dan beri hedef API 36: https://developer.android.com/google/play/requirements/target-sdk
  - App Bundle (AAB) zorunlu: https://developer.android.com/guide/app-bundle
  - Ön plan hizmeti (mikrofon) için Play Console beyanı ve video: https://developer.android.com/develop/background-work/services/fgs/service-types (beyan videosu yalnızca arama özetinde: https://support.google.com/googleplay/android-developer/answer/13392821)
  - 13 Kasım 2023'ten sonra açılan kişisel hesaplar üretime çıkmadan önce **en az 12 test kullanıcısıyla 14 gün kesintisiz kapalı test** yapmalı: https://support.google.com/googleplay/android-developer/answer/14151465 (arama özeti, resmî sayfa açılamadı)
  - Gizlilik politikası URL'si ve hesap silme web bağlantısı: https://support.google.com/googleplay/android-developer/answer/10144311 ve https://support.google.com/googleplay/android-developer/answer/13327111 (arama özetleri)
  - Kullanıcı içeriği olan uygulamada uygulama içinden şikâyet etme şartı: https://support.google.com/googleplay/android-developer/answer/9876937 (arama özeti, doğrulanamadı). Telsiz'de engelleme var, şikâyet yok, bu yüzden G16 eklendi.
- Android WebView'da `getDisplayMedia` ve `Notification` yok, **ekran paylaşımı başlatılamaz** (izlenebilir). Kaynak: https://github.com/mdn/browser-compat-data (`api/MediaDevices.json`, `api/Notification.json`)
- Push altyapısı olmadığı için uygulama kapalıyken bildirim gelmez. Bildirim yalnızca uygulama açıkken veya ses odasındayken gelir.
- Kullanıcının kendisinin yapması gerekenler (Claude yapamaz):
  - Play Console hesabı açmak (25 USD olduğu ikincil kaynakta geçiyor, doğrulanamadı)
  - Yükleme anahtarı üretmek
  - Mağaza kaydını ve Data safety formunu doldurmak
  - İnceleyiciler için demo sunucu sağlamak
  - Beyan videosunu çekmek
  - 12 test kullanıcısı bulmak

**4. Yüzen pencereler (istek 7 ve 16).**
- Belge PiP desteği: Chrome ve Edge 116 ve üstü, Firefox masaüstü 151 ve üstü. Safari, Android Chrome ve Android WebView'da yok.
  - Kaynak: https://github.com/mdn/browser-compat-data/blob/main/api/DocumentPictureInPicture.json
- Tarayıcı simge durumuna küçültülünce otomatik açılmaz. Chrome yalnızca sekme değişiminde otomatik PiP açar, simge durumunda (`kHidden`) bilerek bir şey yapmaz.
  - Kaynaklar: https://developer.chrome.com/blog/automatic-picture-in-picture ve Chromium kaynağı `auto_picture_in_picture_tab_helper.cc`
- Masaüstü uygulamasında belge PiP çalışmıyor (Electron 44'te denendi). Bu yüzden kendi pencere yolu kullanılacak.
- Wayland'de `alwaysOnTop` yok, pencere üstte kalmaz.
- Linux'ta ve tarayıcıda yüzen pencere ekran yakalamasından gizlenemez. Windows ve macOS'ta `setContentProtection` gizler.
  - Kaynak: https://www.electronjs.org/docs/latest/api/browser-window (kaynak dosyası okundu)
- Android Chrome'da yalnızca video PiP ile etkileşimsiz bir görünüm mümkün. iOS'ta tuvalden üretilen akışla video PiP doğrulanamadı.

**5. Otomatik boşta (istek 2).**
- Idle Detection API yalnızca Chromium'da var ve izin istiyor, kullanılmayacak: https://developer.mozilla.org/docs/Web/API/Idle_Detection_API
- Hareketsizlik girdi olaylarından ölçülür. Chrome gizli sekmede zamanlayıcıları kısıtladığı için karar en çok yaklaşık 1 dakika gecikebilir: https://developer.chrome.com/blog/timer-throttling-in-chrome-88
- Sunucu ve üyeler kişinin ne zaman hareketsiz kaldığını öğrenir. Ayar kapatılabilir.

**6. Şifremi unuttum (istek 14).**
- E-posta ile sıfırlama yapılmayacak. Hesaplarda e-posta yok, SMTP için bağımlılık gerekir ve ev bağlantılarından gönderilen e-posta çoğu zaman reddedilir.
  - Kaynaklar: https://support.google.com/a/answer/81126 ve https://www.spamhaus.org/faq/section/Spamhaus%20PBL
- Kurtarma kodu yalnızca kodu kaydetmiş kişiyi kurtarır. Bugünkü hesapların kod oluşturması gerekir.
- Kodu olmayan kişi sahibin sıfırlamasına döner ve **eski özel mesajlarını kaybeder** (bugünkü davranış).
- NIST'in kurtarma kodu önerileri doğrulanamadı: https://pages.nist.gov/800-63-4/sp800-63b/events/

**7. Hexball (istek 4).**
- "Hexball" adı Rezzil'in bir VR oyununda kullanılıyor: https://www.meta.com/experiences/hexball-starter-pack/1373213540596628/
- HaxBall adına ses benzerliği var: https://en.everybodywiki.com/HaxBall
- İki adın da tescil durumu doğrulanamadı.
- PS5 tarayıcısında WebRTC veri kanalı ve oyun kolu desteği doğrulanamadı. PS5 desteği iddia edilmeyecek.
- Tarayıcıda ev sahibinin sekmesi arka plana geçerse maç duraklar.

**8. Diğer.**
- Gezinmede okundu sayacı artık en alta inince düşecek. Bu bilinçli bir davranış değişikliği.
- Okundu bilgisinin cihazlar arasında eşitlenmesi bu turda yapılmıyor.
- Yeni temalarla toplam CSS yaklaşık yüzde 20 büyür.
- Kapak fotoğrafı kart açılınca indirildiği için sunucu kimin kimin kartını açtığını görebilir. Bu yeni bir üst veri sızıntısı, belgelenecek.

### 2.2 Proje kuralı gereği önce issue açılacak işler

CONTRIBUTING:184 şifreleme protokolünü veya düz metin biçimini değiştiren işler için kod yazılmadan önce issue ister. Bu işler:
- G7 kapak fotoğrafı (profil zarfında yeni alan)
- G14 kurtarma kodu (yeni kod biçimi ve türetme etiketleri)
- G17 Hexball (`voice.js` veri kanalı)
- G15 Android (bağımlılık politikası açıklaması)

Varsayılan: issue tasarımla birlikte açılır ve kullanıcı "hepsini yap" dediği için tartışma beklenmeden uygulamaya başlanır. Issue'ya itiraz gelirse PR birleştirilmeden bekletilir.

---

## 3. Uygulama grupları

### 3.1 Numara ve yuva dağıtımı (bütün gruplar buna uyar)

| Kaynak | Sahibi |
|---|---|
| `public/js/36-oyun.js`, `37-renk.js`, `css/oyun.css`, `renk.css`, `e2e/16-oyun.test.js` (yuva 21) | Renk (ayrı iş akışı) |
| `public/js/38-gezinme.js` | G9 (G10 genişletir) |
| `public/js/39-yuzen.js`, `public/css/yuzen.css` | G11 |
| `public/js/40-bosta.js` | G8 |
| `public/js/41-kurtarma.js` | G14 |
| `public/js/42-android.js` | G15 |
| `public/js/43-hexball-kural.js`, `44-hexball-fizik.js`, `45-hexball-ag.js`, `46-hexball.js`, `css/hexball.css` | G17 |
| `e2e/17-profil.test.js` yuva 23 | G6 (G7 genişletir) |
| `e2e/18-otomatik-bosta.test.js` yuva 25 | G8 |
| `e2e/19-gezinme.test.js` yuva 27 | G2 kurar, G9 ve G10 genişletir |
| `e2e/20-yuzen.test.js` yuva 29 | G11 |
| `e2e/21-kurtarma.test.js` yuva 31 | G14 |
| `e2e/22-telsiz-duzen.test.js` yuva 33 | G13 |
| `e2e/23-android-kopru.test.js` yuva 35 | G15 |
| `e2e/24-hexball.test.js` yuva 37 | G17 |
| `e2e/25-dj-senkron.test.js` yuva 39 | G3 (G5 genişletir) |
| `e2e/06-dj.test.js` (var olan) | G3, G4, G5 |
| `e2e/04-ayarlar.test.js` (var olan) | G12 |

Yuvalar tek sayılardan seçildi, çünkü bazı dosyalar iki port kullanıyor (06 yuva 5 ile 6). Script satırları `index.html` ve `sw.js` içinde numara sırasıyla eklenir. Bu iki dosyadaki rebase çakışmaları beklenir, numara sırası korunarak çözülür. `CACHE_NAME` yalnızca sürüm yayınında artar.

### 3.2 Gruplar (her grup bir PR ve bir git worktree)

| Grup | İstekler | Değişecek dosyalar | Yeni dosyalar | Testler | Belgeler |
|---|---|---|---|---|---|
| **G0** İskele ve hızlı düzeltmeler | 12, ayrıca tasarım raporunun A ve D bulguları | `public/i18n.js` (12, grup işaretleri), `public/css/tokens.css` (kenar belirteçleri), `public/js/10-voice.js` (kanca kaydı), `public/css/components.css:2007`, `scripts/denetle.js` (CSS kuralı) | `test/tema.test.js` (ilk hâli) | `test/denetle.test.js`, `test/tema.test.js`, `e2e/03-sosyal` yer tutucu | CONTRIBUTING×2 (kural 14 artık denetleniyor), CHANGELOG×2 |
| **G1** Masaüstü pencere ve boşta kanalları | 7, 13, 18 ve 2 için altyapı | `desktop/src/main.js`, `preload.js`, `lib/channels.js` | yok | `desktop/test/preload.test.js`, yeni `desktop/test/pencere-durumu.test.js` | desktop/README×2 API tablosu |
| **G2** Taslak ve ek sızıntısı (P0) | 17 S1 | `08-composer.js`, `04-meta.js` (`selectChannel`), `15-dm.js` (`showDm`), `14-social.js` (`showHome`), `03-auth.js:787` | `e2e/19-gezinme.test.js` | yeni `test/taslak.test.js`, e2e | CHANGELOG×2 |
| **G3** Telsiz DJ çekirdeği | 13 (1. aşama), 18, 6, 15 | `public/music.js`, `public/js/23-dj.js`, `public/css/dj.css`, `public/css/frekans.css` (yalnızca DJ sütunu grid bloğu), `06-messages.js` (DJ duyurusu), `08-composer.js` (`postSideMessage`), `28-bildirim.js` (dj kaydı), `11-settings.js` (gizlilik anahtarı), `i18n.js`, `scripts/denetle.js` (istisnayı kaldırır) | `e2e/25-dj-senkron.test.js` | `test/music.test.js`, `e2e/06-dj`, `e2e/25` | README×2, MIMARI/ARCHITECTURE, desktop/README×2, CHANGELOG×2 |
| **G4** Telsiz DJ araması | 5 | `src/app.js`, `src/i18n.js`, `public/music.js` (`parseCommand`), `23-dj.js` (`djCommand`), `11-settings.js` (sahip anahtarı), `i18n.js` | `src/youtube-search.js`, `test/fixtures/yt-arama/*.json`, `test/youtube-search.test.js`, `test/server-music-search.test.js` | birim, sunucu, `e2e/06-dj` | README×2, MIMARI/ARCHITECTURE, KURULUM/DEPLOYMENT, CHANGELOG×2 |
| **G5** Kalıcı YouTube çerçevesi | 13 (2. aşama) | `public/dj/youtube.js`, `public/music.js`, `e2e/sahte-youtube.js` | yok | `test/music.test.js`, `e2e/25` | MIMARI/ARCHITECTURE |
| **G6** Profil eşitlemesi ve kart düzeni | 3, 9 | `13-profile.js`, `22-cast.js` (yalnızca anahtar satırları), `23-dj.js:771` (tek satır), `28-bildirim.js` (en son adım), `11-settings.js` (`buildPreviewCard`), `components.css`, `settings.css`, `radio.css`, `skins/turkuaz.css` | `e2e/17-profil.test.js` | `test/social.test.js`, e2e | TASARIM/DESIGN, CHANGELOG×2 |
| **G7** Kapak fotoğrafı | 8 | `src/app.js`, `src/i18n.js`, `13-profile.js`, `11-settings.js`, `components.css`, `skins/turkuaz.css`, `i18n.js` | yok | `test/server-profile.test.js`, `e2e/17` | README×2, MIMARI/ARCHITECTURE, CHANGELOG×2 |
| **G8** Otomatik boşta | 2 | `src/hub.js`, `src/app.js` (`handlePoll`), `05-poll.js`, `25-arka-plan.js`, `13-profile.js` (`userStatus`), `10-voice.js` (`myStatusLine`), `11-settings.js` (Gizlilik), `index.html`, `sw.js`, `i18n.js` | `40-bosta.js`, `test/server-bosta.test.js`, `e2e/18` | birim, e2e | README×2, MIMARI/ARCHITECTURE, desktop/README×2, CHANGELOG×2 |
| **G9** Gezinme 1 | 17 (S2, S3, S4, S5, S12) | `04-meta.js`, `05-poll.js`, `06-messages.js`, `12-init.js`, `14-social.js`, `15-dm.js`, `21-band.js`, `02-state-dom.js`, `frekans.css`, `convo.css`, `people.css`, `index.html`, `sw.js`, `i18n.js` | `38-gezinme.js`, `test/gezinme.test.js` | birim, `e2e/19`, `e2e/02-frekans` güncellemesi | CONTRIBUTING×2, MIMARI/ARCHITECTURE, TASARIM/DESIGN, README×2, CHANGELOG×2 |
| **G10** Gezinme 2 | 17 (S6 ile S11, S13 ile S15) | `06-messages.js`, `05-poll.js`, `17-search.js`, `10-voice.js` (S13), `index.html` (`#hints-card`, 630), `frekans.css`, `arama.css`, `people.css`, `i18n.js` | yok | birim, `e2e/19` | aynı çiftler |
| **G11** Yüzen pencereler | 7, 16 | `desktop/src/main.js`, `preload.js`, `lib/channels.js`, `permissions.js`, `navigation.js`, `settings-store.js`, `strings.js`, `22-cast.js`, `cast.css`, `11-settings.js`, `index.html`, `sw.js`, `i18n.js` | `39-yuzen.js`, `yuzen.css`, `desktop/src/lib/float-window.js`, `test/yuzen.test.js`, `desktop/test/float-window.test.js`, `e2e/20` | birim, masaüstü, e2e, `e2e/05-ses-yayin` | README×2, desktop/README×2, MIMARI/ARCHITECTURE, CONTRIBUTING×2, CHANGELOG×2 |
| **G12** Yeni temalar | 11, ayrıca tasarımın F0 ton belirteçleri | `theme-init.js`, `tokens.css`, `components.css:3878-3901`, `settings.css:1066-1100`, `base.css`, `radio.css:813-836`, `11-settings.js:58, 2973-3013`, `index.html:31-33`, `sw.js:29-31`, `i18n.js` | `css/skins/{saha,lamba,fosfor,kutup,plak,kokpit,kontrast}.css` | `test/tema.test.js`, `test/settings.test.js`, `e2e/04-ayarlar` | TASARIM/DESIGN, README×2, CHANGELOG×2 |
| **G13** Özgün tasarım | 10 | `06-messages.js`, `13-profile.js`, `components.css`, `frekans.css`, `convo.css`, `radio.css`, `theme-init.js`, `11-settings.js`, `index.html`, `i18n.js`, `skins/*.css` | `e2e/22` | `test/settings.test.js`, `test/tema.test.js`, e2e | TASARIM/DESIGN, README×2, desktop/README×2, CHANGELOG×2 |
| **G14** Kurtarma kodu | 14 | `public/crypto.js`, `16-identity.js`, `03-auth.js`, `02-state-dom.js`, `11-settings.js`, `src/app.js`, `src/auth.js`, `src/i18n.js`, `server.js`, `index.html`, `sw.js`, `i18n.js`, CSS | `41-kurtarma.js`, `test/server-kurtarma.test.js`, `test/kurtarma-istemci.test.js`, `e2e/21` | birim, e2e | MIMARI/ARCHITECTURE, KURULUM/DEPLOYMENT, README×2, CONTRIBUTING×2, CHANGELOG×2, SECURITY |
| **G15** Android | 1 | `24-frekans.js`, `07-attachments.js`, `11-settings.js`, `index.html`, `sw.js`, `i18n.js`, `scripts/denetle.js`, `.gitignore`, `.github/workflows/release.yml`, `desktop/test/server-url.test.js` | `android/**`, `42-android.js`, `.github/workflows/android.yml`, `test/fixtures/sunucu-adresleri.json`, `test/android-kopru.test.js`, `e2e/23`, `docs/GIZLILIK.md`, `docs/PRIVACY.md` | JVM, Node, e2e, emülatör | android/README×2, README×2, MIMARI/ARCHITECTURE, CONTRIBUTING×2, SECURITY, CHANGELOG×2 |
| **G16** İçerik şikâyeti (Play önkoşulu) | 1 (Play kullanıcı içeriği şartı) | `src/app.js`, `src/i18n.js`, `06-messages.js` (araç çubuğu), `13-profile.js` (kart), `11-settings.js` (Üyeler), `i18n.js` | `test/server-sikayet.test.js` | sunucu, e2e (`e2e/11-roller` genişletilir) | README×2, MIMARI/ARCHITECTURE, CHANGELOG×2 |
| **G17** Hexball | 4 | `public/voice.js`, `10-voice.js`, `36-oyun.js` (Renk'ten sonra), `34-oyun-masa.js`, `21-band.js`, `index.html`, `sw.js`, `tokens.css`, `i18n.js` | `43` ile `46` arası modüller, `hexball.css`, beş birim testi, `e2e/24` | birim, e2e | README×2, MIMARI/ARCHITECTURE, TASARIM/DESIGN, CONTRIBUTING×2, CHANGELOG×2 |

### 3.3 Çakışma matrisi

İşaretler: ● çok değiştirir, ○ küçük değişiklik (birkaç satır), boş hücre dokunmaz.

**Kayıt dosyaları, sunucu ve masaüstü**

| Grup | i18n.js | index.html | sw.js | tokens.css | voice.js | src/app.js | src/i18n.js | server.js | src/hub.js | desktop/src | denetle.js | belgeler |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Renk | ● | ● | ● | ○ | ● | | | | | | | ● |
| G0 | ○ | | | ○ | | | | | | | ● | ○ |
| G1 | | | | | | | | | | ● | | ○ |
| G2 | | | | | | | | | | | | ○ |
| G3 | ● | | | | | | | | | | ○ | ● |
| G4 | ● | | | | | ● | ○ | | | | | ● |
| G5 | | | | | | | | | | | | ○ |
| G6 | | | | | | | | | | | | ○ |
| G7 | ● | | | | | ● | ○ | | | | | ● |
| G8 | ● | ○ | ○ | | | ○ | | | ● | | | ● |
| G9 | ● | ○ | ○ | | | | | | | | | ● |
| G10 | ● | ○ | | | | | | | | | | ● |
| G11 | ● | ○ | ○ | | | | | | | ● | | ● |
| G12 | ● | ○ | ○ | ● | | | | | | | | ● |
| G13 | ● | ○ | | ○ | | | | | | | | ● |
| G14 | ● | ○ | ○ | | | ● | ○ | ○ | | | | ● |
| G15 | ● | ○ | ○ | | | | | | | | ● | ● |
| G16 | ● | | | | | ● | ○ | | | | | ○ |
| G17 | ● | ○ | ○ | ○ | ● | | | | | | | ● |

**İstemci modülleri ve CSS**

| Grup | 10-voice | 11-settings | 13-profile | 22-cast | 23-dj | music.js | 06-messages | 08-composer | 28-bildirim | 04-meta | 21-band | frekans.css | components.css |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Renk | ● (bitti) | | | ● | | | | | ● | | | | |
| G0 | ○ | | | | | | | | | | | | ○ |
| G2 | | | | | | | | ● | | ○ | | | |
| G3 | | ○ | | | ● | ● | ○ | ○ | ○ | | | ○ | |
| G4 | | ○ | | | ○ | ○ | | | | | | | |
| G5 | | | | | | ● | | | | | | | |
| G6 | | ○ | ● | ○ | ○ | | | | ○ | | | | ● |
| G7 | | ● | ● | | | | | | | | | | ○ |
| G8 | ○ | ○ | ○ | | | | | | | | | | |
| G9 | | | | | | | ● | | | ● | ○ | ○ | |
| G10 | ○ | | | | | | ● | | | | | ● | |
| G11 | | ○ | | ● | | | | | | | | | |
| G12 | | ○ | | | | | | | | | | | ○ |
| G13 | | ○ | ● | | | | ● | | | ○ | | ● | ● |
| G14 | | ○ | | | | | | | | | | | |
| G15 | | ○ | | | | | | | | | | | |
| G16 | | ○ | ○ | | | | ○ | | | | | | |
| G17 | ○ | | | | | | | | | | ○ | | |

**Çakışmayı azaltan kurallar**
1. **i18n işaretleri.** G0, `tr` ve `en` sözlüklerinin başına (`const tr = {` ve `const en = {` satırlarının hemen altına) her grup için bir yorum satırı koyar. Örnek: `// G3 Telsiz DJ çekirdeği (istek 6, 13, 15, 18)`. Her grup yeni anahtarlarını yalnızca kendi işaretinin altına, sonunda virgül olacak biçimde ekler. Böylece paralel eklemeler git'te çakışmaz. Var olan değerlerin değiştirilmesi (ör. Hoparlör) yerinde yapılır.
2. **10-voice.js kanca kaydı.** G0 `voiceHook(kind, fn)` işlevini ekler. G6, G11 ve G15 ses değişikliklerine bu kayıtla bağlanır, `10-voice.js` dosyasını düzenlemez.
3. **Masaüstü kanalları.** G1 pencere durumu ve boşta süresi kanallarını bir kez kurar. G3 ve G8 `desktop/` dosyalarına dokunmaz. G11 yalnızca kendi pencere istisnasını ekler.
4. **Renk'in dosyaları.** `22-cast.js` ve `28-bildirim.js` dosyalarındaki küçük adımlar (G6'nın son adımı ve G11'in 16 kısmı) Renk'in 6. ve 7. adımları birleştikten sonra yapılır. Bu sürede bu adımlar dışındaki her şey ilerleyebilir. `voice.js`, `33` ile `37` arası dosyalar, `oyun.css` ve `renk.css` hiçbir grup tarafından Renk bitmeden değiştirilmez.
5. **Belgeler.** README ve CHANGELOG çakışmaları birleştirme sırasında çözülür. Her grup CHANGELOG girdisini "Yayımlanmamış" altında kendi madde paragrafı olarak yazar.

---

## 4. Sıra

**Dalga 0 (hemen, ilk birleşenler, birkaç saat):**
- G0 ve G1. İkisi de küçük. Diğer gruplar dallarını bunlar birleştikten sonra açar.
- G2 de hemen başlar ve öncelikle birleşir, çünkü P0 gizlilik hatası.

**Dalga 1 (G0 ve G1 birleşince paralel başlar):**
- G3 Telsiz DJ çekirdeği
- G4 yalnızca sunucu tarafı: `src/youtube-search.js`, uç, testler
- G6 profil. `28-bildirim.js` adımı Renk sonrasına kalır.
- G8 otomatik boşta
- G11 yüzen pencere: masaüstü, `39-yuzen.js` ve 7. istek. `22-cast.js` kısmı (16) Renk'in `22-cast.js` adımı birleşince yapılır.
- G12 yeni temalar
- G14 kurtarma kodu (issue açıldıktan hemen sonra)
- G15 Android: `:cekirdek`, Gradle iskeleti, CI, `42-android.js`

**Dalga 2:**
- G4 istemci tarafı, G3 birleşince (ikisi de `djCommand` ve duyuruya dokunuyor)
- G5, G3 birleşince
- G7, G6 birleşince ve issue açılınca
- G9, G2 birleşince

**Dalga 3:**
- G10, G9 birleşince
- G13, G6, G7, G10 ve G12 birleşince. F6 söz ve simge adımı istenirse daha erken ayrı commit olarak gelebilir.
- G16, G15'in Play'e üretim başvurusundan önce (geliştirmesi Dalga 1'de başlayabilir)
- G17, Renk'in 9 adımı ve `voice.js` işi birleşince

**Önerilen birleştirme sırası:** G0, G1, G2, G12, G6, G3, G8, G14, G11, G4, G9, G5, G7, G10, G16, G15, G13, G17.

**Renk iş akışına şimdi iletilmesi gerekenler (36-oyun.js yazılmadan önce):**
1. Genel `game.*` metinleri kart oyununa özgü olmasın ("Kurpiyer" yerine "Ev Sahibi", "Yeni El" yerine "Yeni Tur"). Ya da `game.<uygulama>.<anahtar>` önce aranacak biçimde değiştirilebilir olsun.
2. `34-oyun-masa.js:36` `DELAYED_MOVES` uygulamaya özel olsun (`A.DELAYED_MOVES`).

`34-oyun-masa.js` başka bir iş akışında değişiyor. Bu planın hiçbir grubu ona Renk bitmeden dokunmaz.

---

## 5. Grupların iş tanımları

Bütün gruplar için ortak kurallar:
- CONTRIBUTING kuralları geçerli: ES2017, `innerHTML` yok, noktalı virgülsüz kod, flexbox ve margin (grid ve gap yok), uzun ve kısa tire yok, Markdown düzyazısında noktalı virgül yok.
- Düğme etiketlerinde her kelimenin baş harfi büyük yazılır.
- Her grup bitişte `npm run denetle`, `npm test` ve kendi e2e dosyalarını çalıştırır.
- e2e testleri `e2e/yardimci.js` içindeki `setupWorld` kalıbını ve 3.1'deki yuvayı kullanır.

### G0 İskele ve hızlı düzeltmeler (S-M, 7 adım)

1. **İstek 12.** `public/i18n.js:449` değerini `'Kullanıcı adı giriniz'`, `:2386` değerini `'Enter a username'` yap. `e2e/03-sosyal.test.js` içine yer tutucuyu doğrulayan bir satır ekle.
2. **Kenar belirteçleri (tasarım bulgusu A).**
   - `tokens.css` içinde `:root, :root[data-skin="arcade"][data-scheme="dark"]` bloğuna (92-275 arası) ve Arcade açık bloğuna `--live-edge` ve `--danger-edge` ekle.
   - Değerler `--live` ve `--danger` renklerinin kenar sürümleridir. 3:1 kenar kontrastını ölç. Gece değerleri (`#2f7e58`, `#c2554b`) başlangıç noktası olabilir.
   - Turkuaz bloklarına da (483-662) açık değer yaz.
   - `test/tema.test.js` her tema ve mod bileşiminde iki belirtecin çözüldüğünü denetlesin.
   - Kabul: Arcade ve Turkuaz'da `.radio-cam-live` için `border-top-style: solid` çıkmalı.
3. **CSS kuralı denetimi (bulgu D).**
   - `scripts/denetle.js` içine `public/css/**` için yorumlar çıkarıldıktan sonra çalışan bir tarayıcı ekle. Yasaklananlar: `display:\s*(inline-)?grid`, `(^|[;{\s])(row-|column-)?gap\s*:`, `clamp(`, `:is(`, `:where(`, `aspect-ratio`, `(^|[;{\s])inset\s*:`.
   - `CSS_ISTISNALARI` listesi tek kayıt içersin: `frekans.css` içindeki `.app-view[data-dj-col="on"] .stage` bloğu (1318-1324), not olarak "G3 kaldırır".
   - `components.css:2007` `.msg-dj` gap kuralını çocuklarda margin ile yeniden yaz.
   - `test/denetle.test.js` içine yakalama ve istisna testleri ekle.
4. **Kanca kaydı (`10-voice.js`).**
   - Şu kodu ekle:
     ```js
     const voiceHooks = { change: [], render: [] }
     function voiceHook (kind, fn) { if (voiceHooks[kind] && typeof fn === 'function') voiceHooks[kind].push(fn) }
     function runVoiceHooks (kind, arg) { voiceHooks[kind].forEach((fn) => { try { fn(arg) } catch (err) { window.console.error(err) } }) }
     ```
   - `onVoiceChange` içinde `aramaOnVoice` satırından sonra, `voiceRenderQueued` korumasından önce `runVoiceHooks('change', state.voiceSnap)` çağır.
   - `renderVoiceAll` sonunda `gameRender` satırından sonra `runVoiceHooks('render')` çağır.
   - `test/settings.test.js` vm düzeneğinde işlevin varlığını denetle.
5. **i18n grup işaretleri.** İki sözlüğün başına aynı sırayla şu yorum satırlarını koy: `// G3 Telsiz DJ çekirdeği`, `// G4 Telsiz DJ araması`, `// G7 Kapak fotoğrafı`, `// G8 Otomatik boşta`, `// G9 ve G10 Gezinme`, `// G11 Yüzen pencereler`, `// G12 Temalar`, `// G13 Özgün tasarım`, `// G14 Kurtarma kodu`, `// G15 Android`, `// G16 Şikâyet`, `// G17 Hexball`.
6. CONTRIBUTING×2 kural 14'e "denetleyici zorunlu tutar" ifadesini ekle. CHANGELOG×2'ye yazılacaklar: yer tutucu, kamera göstergesi kenarı.
7. **Kabul:** denetleyici temiz, testler yeşil, konsol temiz.

### G1 Masaüstü pencere ve boşta kanalları (S, 5 adım)

1. **`desktop/src/main.js` `openMainWindow` (536-610).**
   - `minimize`, `restore`, `hide`, `show` olaylarında ana pencerenin webContents'ine `telsiz:window-state` kanalıyla `'minimized' | 'restored' | 'hidden' | 'shown'` gönder.
   - Tepsiden geri gelişte de `shown` gitsin.
2. **Yeni invoke kanalı `telsiz:idle-seconds`.** `requireSender` ile `'app'` ve `'background'` bağlamlarına açık. `Math.floor(powerMonitor.getSystemIdleTime())` döndürür. Kaynak: https://electronjs.org/docs/latest/api/power-monitor
3. **`desktop/src/lib/channels.js` ve `preload.js:186`.**
   - `telsizDesktop` içine `onWindowState(cb)` ekle. Birden çok dinleyici olabilir, gelen değer beyaz listeden geçer. Abonelikten çıkış işlevi döner.
   - `telsizDesktop` içine `idleSeconds()` ekle (Promise, tamsayı).
   - `telsizArkaPlan` nesnelerine (324, 342) `idleSeconds()` ekle.
4. **Testler.** `desktop/test/preload.test.js` kanal eşitliği. Yeni `pencere-durumu.test.js`: olay eşlemesi, beyaz liste dışı değerin düşmesi, gönderen denetimi.
5. desktop/README×2 API tablosunu güncelle.

**Kabul:** sayfada `telsizDesktop.onWindowState` küçültmede `minimized`, tepsiye gizlemede `hidden` alıyor.

### G2 Taslak ve ek sızıntısı (S, 5 adım, P0)

**Kök neden:** `selectChannel` (`04-meta.js:1114-1144`) ve `showDm` (`15-dm.js:157-180`) yazma alanına dokunmuyor. Ekler konuşmaya bağlı değil (`08-composer.js:152, 184`).

1. **`08-composer.js` içinde taslak yapısı.**
   - Bellekte `drafts: Map` tut. Anahtar `'c:' + kanalId` veya `'d:' + dmId`. Değer `{ text, attachments, editId }`.
   - `composerKey()` yaz.
   - `composerLeave()` metni ve ekleri kaydeder, yazma alanını boşaltır, düzenleme kipini ve yazıyor göstergesini bitirir.
   - `composerEnter()` hedef konuşmanın taslağını yükler.
2. **Ekleri konuşmaya bağla.** `addFiles` her eke `convKey` verir. Yüklemesi süren ek kendi taslağında tamamlanır. `sendMessage` yalnızca `convKey === composerKey()` olan ekleri gönderir.
3. **Çağrılar.** `selectChannel`, `showDm` ve `showHome` durumu değiştirmeden önce `composerLeave()`, değiştirdikten sonra `composerEnter()` çağırır.
4. **Temizlik.** Çıkışta (`03-auth.js:787`), engellemede, konuşma silinince ve frekans değişince `drafts` silinir. Taslak diske yazılmaz.
5. **Testler.**
   - `test/taslak.test.js` (vm): anahtarlar, ek bağlama, gönderim süzgeci.
   - `e2e/19-gezinme.test.js` yuva 27: özel mesajda metin ve fotoğraf, `genel` odasına geç, yazma alanı boş ve Gönder pasif olmalı. Geri dön, taslak ve ek yerinde olmalı. Aynısı iki oda arasında. Beş genişlikte (360, 412, 768, 1024, 1440) yatay taşma 0.

**Kabul:** bir konuşmanın metni veya eki başka bir konuşmanın yazma alanında hiçbir genişlikte görünmüyor ve gönderilemiyor.

### G3 Telsiz DJ çekirdeği (XL, yaklaşık 22 adım, sunucu değişikliği yok)

**A. Arka planda çizim (ortak bulgu A, istek 13 ve 18)**
1. `23-dj.js:493-500` `djRenderSoon`: `document.visibilityState === 'hidden'` ise `requestAnimationFrame` yerine `setTimeout(fn, 0)` kullan.
2. Motorun `track` ve `change` olaylarında `djApplyLayout` rAF beklemeden çalışsın. 1225-1233'teki saniyelik denetim `djShouldShow()` doğruysa her zaman çizsin.
3. Kabul: rAF durdurulmuş ve `visibilityState` hidden benzetilmiş B sekmesinde çerçeve en az 200x200 boyutunda köşeye çizilir ve A ile en çok ±250 ms farkla başlar (`olcum13.js` s8 senaryosunun karşılığı).

**B. Başlangıç payı ve erken rıza (istek 13)**
4. `music.js:43` `START_LEAD_MS` türe göre ayrılsın: YouTube 3000 ms, dosya 1500 ms. Kullanıldığı yerler 563-570 ve 609-613.
5. Devam ettirmede (651-655) `anchorAt = now + lead` olsun.
6. `test/music.test.js` `applyOp` beklentilerini güncelle.
7. Rıza vermemiş üye ses odasındayken odada YouTube oturumu varsa veya odaya katılınca kalıcı uyarı göster: `music.consent.roomHasYoutube` metni ve "YouTube Oynatıcısını Yükle" düğmesi (119-121 kalıbı). Kart görünürken kısa bildirim de çıksın.

**C. Ekleme duyurusu (istek 6)**
8. **`06-messages.js:52-72` `cleanDjNotice` ve `buildDjNotice`.** `d.title` alanı isteğe bağlı olsun: `cleanText`, en çok 120 kod noktası, denetim karakteri yok. Başlık varsa `dj.notice.youtubeTitle` veya `dj.notice.fileTitle` gösterilir. Eski istemciler bu alanı yok sayar. DJ duyurusunda "düzenlendi" etiketi gösterilmez.
9. **`08-composer.js:226-243` `postSideMessage`.** Mesaj kimliğini Promise ile döndürsün.
10. **`23-dj.js:1095-1126` `djCommand` ve `djAnnounce`.**
    - `addYouTube` sonucundaki `trackId` için kuyruk en çok 8 saniye izlenir, başlık gelince duyuru başlıkla gider.
    - Süre dolarsa duyuru başlıksız gider. Başlık sonradan gelince `/api/messages/edit` ile ekleyenin kendi mesajı düzenlenir.
11. **`djPlayFile` (1180-1191).** Dosyanın bulunduğu yazı odasına (`m.channelId`) başlıklı duyuru gönderir.
12. **`djOnNotice` (818-826).** `trackId` tutulur, başlık motorun kuyruğundan canlı okunur.
13. **`28-bildirim.js`.** Aynı ses odası için `kind: 'dj'` kaydı, metin `activity.djAdd`. Motorun `notice` olayından beslenir. Renk bu dosyada `activity*` bölgesini değiştiriyor. Bu adımı en sona bırak, gerekirse Renk'in 28-bildirim adımı birleşince rebase et.

**D. Taşınabilir oynatıcı (istek 15)**
14. **Sürükleme yardımcısı `dockDrag(box, handle, opts)` (`23-dj.js` içinde ayrı işlev, G11 de kullanabilir).**
    - Pointer events kullanır, tutamakta `touch-action: none`.
    - Bırakınca en yakın dört köşeden birine oturur.
    - Kutu her zaman görünüm alanında kalır, en az 200x200, kırpılmaz.
    - Köşe `localStorage` `telsiz.djDock` anahtarında saklanır (`'tl' | 'tr' | 'bl' | 'br'`, try/catch ile).
    - Pencere boyutu değişince yeniden sınırlanır.
15. **Çubuk düğmeleri.**
    - "Taşı" basıldıkça köşeler arasında döner.
    - "Küçült" ve "Göster": dosya parçasında yalnızca çubuk kalır. YouTube parçasında motorun yerel bekletmesi kullanılır. Yerel bekletme yoksa `music.js` içine `setLocalHold(reason, on)` eklenir, oda durumunu değiştirmez. Açınca eşitlenip devam eder.
    - "Yüzen Oynatıcı" anahtarı, `telsiz.djFloat`.
16. **Akıllı varsayılan köşe.** Telsiz kartı düğmeleri ve yazma alanıyla kesişmeyen köşe. 760 ile 1279 px arasında sağ üst, bandın altında.
17. **`dj.css:625-716` ve DJ sütunu.** `frekans.css:1318-1324` DJ sütunu gridini flexbox ve margin ile yeniden yaz. G0'ın denetleyici istisnasını kaldır.

**E. Arka plan ve Media Session (istek 18)**
18. **Tek `<audio>` öğesi.** `music.js:928-933` motor boyunca tek öğe kullansın, parça değişince yalnızca `src` değişsin.
19. **Media Session (`23-dj.js`).**
    - `navigator.mediaSession.metadata`: başlık, sanatçı alanı `dj.mediaSession.artist`.
    - `play` ve `pause` işleyicileri yalnızca yerel bekletmeyi yönetir, odayı değiştirmez.
    - `setPositionState` ile konum bildirilir.
    - Odadan çıkınca metadata `null` olur.
    - Gizlilik ayarı: `11-settings.js` Gizlilik sayfasında `telsiz.djMediaSession`, varsayılan açık.
    - Not: G11 aynı nesneye yalnızca kendi eylem işleyicilerini (`enterpictureinpicture`, `togglemicrophone`, `hangup`) kaydeder. Metadata'yı yalnızca DJ yazar.
20. **Masaüstü.** `telsizDesktop.onWindowState` (G1) ile `minimized` veya `hidden` gelince YouTube yerel bekletmeye alınır, `restored` veya `shown` gelince bırakılır. Kartta `music.player.backgroundYoutube` notu gösterilir.

**F. Testler ve belgeler**
21. Testler:
    - `test/music.test.js`: pay, devam ettirme, tek öğe, yerel bekletme.
    - Yeni `e2e/25-dj-senkron.test.js` yuva 39: iki istemci ±250 ms, gizli sayfa benzetimi, rıza uyarısı.
    - `e2e/06-dj.test.js`:
      - 152. satırdaki beklenti "Deniz … ekledi: Fake video D120aaaaaaa" olur.
      - "DJ'de çal" duyurusu ve Bildirimler kaydı.
      - 1100x800'de köşe değişince ses düğmeleri `h.reachable` olmalı.
      - Sürüklenen köşe yeniden yüklemeden sonra korunmalı. Küçültünce dosya çalmaya devam eder, YouTube duraklar.
      - İki dosya arka planda art arda çalar ve `createAudio` bir kez çağrılır. `mediaSession.metadata.title` doğru.
      - Sahte `onWindowState` ile YouTube'un bekletilmesi.
22. Belgeler: README×2 DJ paragrafı, MIMARI/ARCHITECTURE (duyuru biçimi, Media Session gizlilik notu), desktop/README×2, CHANGELOG×2.

**i18n (tr | en)**

| Anahtar | tr | en |
|---|---|---|
| `music.consent.roomHasYoutube` | Bu ses odasında Telsiz DJ YouTube parçası çalıyor. Dinlemek için oynatıcıyı yükleyin. | Telsiz DJ is playing a YouTube track in this voice room. Load the player to listen. |
| `music.player.waitingVisible` | YouTube parçası pencere görünür olunca başlar. | The YouTube track starts when the window is visible. |
| `music.player.backgroundYoutube` | YouTube parçaları uygulama arka plandayken çalmaz, ses dosyaları çalar. | YouTube tracks don't play while the app is in the background. Audio files do. |
| `music.player.minimizedYoutube` | YouTube küçültülünce duraklar. Açınca odayla eşitlenip devam eder. | YouTube pauses while minimized. It resumes in sync with the room when you restore it. |
| `dj.dock.move` | Taşı | Move |
| `dj.dock.moveLabel` | Oynatıcıyı sonraki köşeye taşı | Move the player to the next corner |
| `dj.dock.minimize` | Küçült | Minimize |
| `dj.dock.restore` | Göster | Show |
| `dj.dock.float` | Yüzen Oynatıcı | Floating Player |
| `dj.notice.youtubeTitle` | Telsiz DJ kuyruğuna ekledi: {title} | Added to the Telsiz DJ queue: {title} |
| `dj.notice.fileTitle` | Telsiz DJ kuyruğuna dosya ekledi: {title} | Added a file to the Telsiz DJ queue: {title} |
| `activity.djAdd` | {name} Telsiz DJ kuyruğuna ekledi: {title} | {name} added to the Telsiz DJ queue: {title} |
| `dj.mediaSession.artist` | Telsiz DJ · {room} | Telsiz DJ · {room} |
| `settings.privacy.mediaSession` | Kilit ekranında parça adını göster | Show the track name on the lock screen |
| `settings.privacy.mediaSessionHint` | Açıkken çalan parçanın adı işletim sisteminin medya denetimlerinde ve kilit ekranında görünür. Ad uçtan uca şifreli DJ durumundan gelir ve böylece uygulamanın dışına çıkar. | When on, the playing track's name appears in your system's media controls and on the lock screen. The name comes from the end-to-end encrypted DJ state and so leaves the app. |

**Kabul ölçütleri:**
- B sekmesi arka plandayken (benzetim) parça A ile ±250 ms içinde başlar.
- Sohbet duyurusu 8 saniye içinde şarkı adını taşır.
- Oynatıcı hiçbir köşede ses düğmelerini örtmez.
- Dosya parçaları arka planda art arda çalar.
- Masaüstünde küçültülünce YouTube duraklar, geri gelince eşitlenir.
- 200x200 kuralı her durumda korunur.

### G4 Telsiz DJ araması: anahtarsız, kullanıcı kararı (L, yaklaşık 14 adım)

1. **`src/youtube-search.js`.** Bağımlılık eklenmez, yalnızca `node:https` kullanılır. Bölüm 1, 2, 3 ve 6 için `docs/calisma/youtube-arama-notlari.md` dosyasına bak, taslak `docs/calisma/yt-arama/taslak.js.txt`.
   - Birincil istek: `POST https://www.youtube.com/youtubei/v1/search?prettyPrint=false`
     - Gövde: `{ context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US', utcOffsetMinutes: 0 }, user: {} }, query, params: 'EgIQAQ%3D%3D' }`
     - Başlıklar: `Content-Type: application/json`, `Accept: */*`, `Accept-Language: en-US,en`, `X-Youtube-Client-Name: 1`, `X-Youtube-Client-Version`, `Origin` ve `Referer` (https://www.youtube.com), masaüstü `User-Agent`, `Cookie: SOCS=CAI`
     - `key` gönderilmez.
   - Yedek: `GET https://www.youtube.com/results?search_query=…&sp=EgIQAQ%3D%3D&hl=en&gl=US`. İçinden `var ytInitialData = ` JSON'u süslü parantez sayacıyla çıkarılır.
   - Sınırlar: 8 saniye zaman aşımı, yönlendirme izlenmez (consent yönlendirmesi başarısızlık sayılır), JSON en çok 4 MB, HTML en çok 6 MB, en çok 200000 düğüm.
   - Ayrıştırıcı:
     - Yalnızca `videoRenderer` (`videoId`) ve `lockupViewModel` (`contentId`, `LOCKUP_CONTENT_TYPE_VIDEO`) düğümlerini toplar.
     - Reklam alt ağaçlarına (`adSlotRenderer`, `searchPyvRenderer`, `promoted*`), raflara ve oynatma listelerine inmez.
     - Süresi ayrıştırılamayan öğe (canlı yayın) atlanır.
     - `videoId` şu ifadeye uymalı: `/^[A-Za-z0-9_-]{11}$/`. Aynı kimlik tekrar ederse atılır.
     - Başlık ve kanal adı 120 kod noktası, denetim karakterleri temizlenir.
   - `clientVersion`: sabit varsayılan `2.20260720.04.00`. HTML yedeği çalıştığında sayfadan okunan değer bellekte güncellenir.
   - Devre kesici: art arda 3 ayrıştırma hatasından sonra arama 1 saat kapanır, `search_failed` döner ve sunucu günlüğüne tek satır yazılır.
2. **`src/app.js` uç noktası.**
   - `MUSIC_SETTING_KEYS` (198) içine `'search'` ekle. `state.music.search` varsayılan `false`. Ayar ucu var olan doğrulamayla (3001) kullanılır.
   - Yeni uç `POST /api/music/search`, gövde `{ channelId, q }`:
     - Denetimler `/api/music/state` ile aynı: DJ açık, `music.youtube` açık, kişi ses odasında, kısıtlı kip kuralı.
     - `q` 1 ile 200 kod noktası arası.
     - Hız sınırı: kullanıcı başına 10 istek/dk. Sunucu geneli günlük tavan 300 (YouTube'un IP engellemesine karşı, kota için değil).
     - 10 dakikalık bellek önbelleği. Anahtar `q.normalize('NFC').toLowerCase()`.
     - Sorgu günlüklere yazılmaz.
   - Yanıt: `200 { results: [{ videoId, title, channel, durationS }] }` en çok 5 sonuç.
   - Hatalar: `503 search_unavailable`, `502 search_failed`, `429 rate_limited`, `400 bad_query`.
   - `meta.music.search = state.music.enabled && state.music.youtube && state.music.search` (1110 civarı).
   - Testler için `createChatServer` seçeneklerine enjekte edilebilen `youtubeSearch` işlevi.
3. **`src/i18n.js`.** `detail.musicSearchOff`, `detail.musicSearchRate`, `detail.musicSearchFailed` (tr ve en).
4. **`public/music.js:319-350` `parseCommand`.**
   - Bağlantıya benzemeyen argüman `{ name: 'play', query }` döner.
   - Bağlantıya benzeyip geçersiz olan `bad_url` olarak kalır.
   - Boş `/çal` `play_needs_source` döner.
   - `runCommand` (1903-1924) sorguyu arayüze bırakır.
5. **`23-dj.js` `djCommand` (G3'ten sonra).**
   - Sorgu varsa ve `meta.music.search` doğruysa "aranıyor" durumunu göster, `api('POST','/api/music/search')` çağır, ilk sonucu `addYouTube(videoId, { title })` ile ekle.
   - Duyuru G3'ün yolundan hemen başlıkla gider.
   - Arama kapalıysa hata metni ve kartta `https://www.youtube.com/results?search_query=…` bağlantısı gösterilir. Bağlantı yeni sekmede, `rel="noopener noreferrer"` ile açılır. Sahip bu durumda ayarın yerini de görür.
6. **`11-settings.js` sahip ayarı.** Telsiz DJ bölümünde "Şarkı adıyla YouTube araması" anahtarı ve risk açıklaması. Açarken onay penceresi çıkar.
7. **Test verisi.** `docs/calisma/yt-arama/*.json` dosyalarını `test/fixtures/yt-arama/` altına taşı.
8. **Testler.**
   - `test/youtube-search.test.js`:
     - İki örnek dosyadan yalnızca `TLSZornek01` ve `TLSZornek02` çıkmalı.
     - Reklam, canlı yayın, raf ve oynatma listesi atlanmalı.
     - Boyut ve düğüm sınırları, bozuk JSON, HTML çıkarımı, kaçışlı `</script>` ve devre kesici sınanmalı.
   - `test/server-music-search.test.js`:
     - Ayar kapalıyken 503.
     - Sahte arayıcıyla temizlenmiş sonuç, geçersiz kimliğin elenmesi.
     - 429 ve günlük tavan, önbellek isabeti.
     - Oturum, ses odası ve kısıtlı kip şartları.
     - Sorgunun günlüğe düşmemesi.
   - `test/music.test.js` 534 ve 597-607 güncellenir.
   - `e2e/06-dj`: `youtubeSearch` taklidiyle `/çal lobi şarkısı` doğru parçayı başlığıyla ekler, sohbet duyurusu başlığı taşır.
9. **Belgeler.**
   - README×2: kullanım ve sahip uyarısı.
   - MIMARI/ARCHITECTURE: "Sunucunun gördüğü üst veri" listesine arama metni ekle. YouTube gizlilik paragrafı. Arama Hizmet Şartlarına aykırıdır ve biçim değişince kapanır.
   - KURULUM/DEPLOYMENT: sunucunun dışarıya HTTPS isteği attığı. `node:https` sistem vekilini kullanmaz.
   - CHANGELOG×2.
10. **Elle canlı doğrulama (sunucu sahibi yapar).** Notların 9. bölümündeki 9 madde. Sonuçlara göre sınırlar daraltılır, kimlikleri değiştirilmiş gerçek yanıt kesitleri test verisine eklenir.

**i18n**

| Anahtar | tr | en |
|---|---|---|
| `music.errors.search_unavailable` | Şarkı adıyla arama bu sunucuda kapalı. YouTube bağlantısını yapıştırın. | Search by song name is off on this server. Paste a YouTube link. |
| `music.errors.search_failed` | YouTube araması şu anda yapılamadı. Biraz sonra yeniden deneyin ya da bağlantıyı yapıştırın. | The YouTube search failed. Try again later or paste a link. |
| `music.errors.search_no_results` | "{query}" için çalınabilir bir sonuç bulunamadı. | No playable result found for "{query}". |
| `music.errors.search_rate` | Çok sık arama yapıldı. Bir dakika sonra yeniden deneyin. | Too many searches. Try again in a minute. |
| `music.searching` | YouTube'da aranıyor: {query} | Searching YouTube: {query} |
| `music.ok.addedTitle` | Kuyruğa eklendi: {title} | Added to the queue: {title} |
| `dj.searchOnYoutube` | YouTube'da Ara | Search on YouTube |
| `settings.dj.search` | Şarkı adıyla YouTube araması | YouTube search by song name |
| `settings.dj.searchHint` | Açıkken sunucu /çal komutundaki şarkı adını YouTube'da kendisi arar. Arama metni sunucuya, sunucunun IP adresiyle de YouTube'a gider. Bu yol resmî YouTube API'sini kullanmaz. YouTube Hizmet Şartları otomatik erişimi yasaklar ve YouTube biçimini değiştirirse arama kapanır. Bağlantıyla ekleme her durumda çalışır. | When on, the server searches YouTube itself for the song name in the /play command. The search text goes to the server and, from the server's IP address, to YouTube. This does not use the official YouTube API. YouTube's Terms of Service prohibit automated access, and the search turns off if YouTube changes its format. Adding by link always works. |
| `settings.dj.searchConfirm` | Riskleri okudum, aramayı aç | I have read the risks, turn on search |
| `music.errors.bad_url` (değişir) | Bağlantı geçersiz. YouTube bağlantısı ya da şarkı adı yazın. | Invalid link. Enter a YouTube link or a song name. |
| `dj.cmdDesc.play` (değişir) | YouTube bağlantısı ya da şarkı adıyla parça ekler | Adds a track by YouTube link or song name |
| `dj.addHint` (değişir) | YouTube bağlantısı ya da şarkı adı | YouTube link or song name |

`music.errors.play_needs_source` metni de "bağlantı ya da şarkı adı" diyecek biçimde güncellenir.

**Kabul ölçütleri:**
- Ayar açıkken sahte arayıcıyla `/çal ad` ilk sonucu başlığıyla ekliyor.
- Ayar kapalıyken açık bir hata metni ve YouTube bağlantısı çıkıyor.
- İstemciden hiçbir YouTube isteği gitmiyor ve CSP değişmiyor.
- Sorgu günlüklere düşmüyor.

### G5 Kalıcı YouTube çerçevesi (M-L, 6 adım)

1. **`public/dj/youtube.js` (124, 298-299).** Odadaki oturum boyunca tek çerçeve tutulur. Parça değişince `loadVideoById` gönderilir, ön yükleme için `cueVideoById`.
   - Bu IFrame API işlevlerinin resmî belgesi bu ortamdan açılamadı, doğrulanamadı: https://developers.google.com/youtube/iframe_api_reference
2. **`music.js:2405-2442`.** Parça değişiminde `destroy` yerine `load` çağrılır. Oturum bitince, rıza geri alınınca ve ses odası kapanınca çerçeve yok edilir.
3. **`e2e/sahte-youtube.js`.** Bu komutları öğrenir, `framesTotal` sayar.
4. **Testler.** İkinci parçada `framesTotal === 1`. Bir parçadan sonra iki istemci yine ±250 ms içinde başlar. Rıza geri alınınca çerçeve kalkar.
5. **Elle deneme.** Gerçek YouTube ile iki masaüstü ve bir telefon. Mobilde dokunuş izninin ikinci parçada korunduğuna bakılır.
6. MIMARI/ARCHITECTURE notu.

**Kabul:** parça geçişinde yeni çerçeve kurulmuyor, güvenlik denetimleri (köken ve onay kuralı) değişmiyor.

### G6 Profil eşitlemesi ve kart düzeni (M-L, 13 adım, sunucu değişikliği yok)

**İstek 3**
1. **`13-profile.js:136-150` `fetchProfiles`.** Hata alınınca grup kuyruğa geri konur. Yeniden deneme 2, 5, 15 ve 60 saniye sonra. Her başarılı poll'dan sonra `pv` farkları ucuz bir yolla yeniden denetlenir.
2. **`loadAvatar` (305).** Kayıt `{ state: 'failed', at, tries }` olur. 10 saniye, 30 saniye ve 2 dakika aralıklarla en çok 4 deneme. 404 kalıcı sayılır.
3. **Epoch sayacı.** `profileState.epoch` ve genel `profileEpoch()` işlevi. Her profil değişikliğinde ve metadaki ad değişikliğinde (`applyMeta`) artar.
4. **Önbellek anahtarları.** `22-cast.js:670-672` `camsKey`, `:703-705` `viewersKey`, `:784-787` `pickKey` ve `23-dj.js:771` kuyruk anahtarı `profileEpoch()` değerini içerir (birer satır).
5. **`profilesChanged` (355-369).** Ek olarak `castSync`, `djRenderSoon` ve `renderActivity` çağrılır. Açık kişi kartı (`popoverUserId`) için `#peer-name` güncellenir. Bunun için `10-voice.js` değiştirilmez, gerekirse `voiceHook('render')` kullanılır.
6. **`28-bildirim.js`.** Kayıt ad yerine `userId` tutar, ad ve avatar çizim anında okunur. **Renk'in 28-bildirim adımı birleşince yapılır.**

**İstek 9**
7. **`buildProfileIdentity(avatarNode, name, handle, badges)` yardımcısı.** Avatar solda. Sağda iki satırlı sütun: üstte görünen ad ve hemen yanında rol rozetleri (`flex-wrap`), altta `@kullanıcı`.
8. **Yardımcının kullanıldığı yerler.**
   - `buildProfileCard` (614-645).
   - Avatar menüsü (858): rol adın yanına taşınır, özel rol de eklenir.
   - `11-settings.js:821-855` `buildPreviewCard`: özel rol rozeti eklenir.
   - Düz üyeye soluk "Üye" rozeti (`roles.member`). Bunun için `roleBadge` boş dönmek yerine soluk bir değişken kullanır.
9. **CSS.**
   - `components.css:3166-3171` ve `.profile-card-head`: metin sütunu. 18 rem'in altında ad ve rol alt satıra kayar.
   - `settings.css`, `radio.css:1014-1047`, `skins/turkuaz.css:191-205` (kemer korunur).

**Testler**
10. `test/social.test.js` (vm, `t.mock.timers`): yeniden deneme, avatar yeniden denemesi, 404'te durma.
11. `e2e/17-profil.test.js` yuva 23:
    - Deniz adını ve resmini değiştirir. Ece'de kameralar ızgarası, kişi kartı ve Bildirimler `SHORT` süresi içinde güncellenir.
    - `/api/profiles` ve `/api/uploads` için `route.abort` ile toparlanma.
    - Kart ölçümleri: adın sol kenarı avatarın sağ kenarından büyük, rozet adla aynı satırda, üye kartında "Üye" yazar, 360 px'te `overflowX` 0.
12. Üç temada ekran görüntüsü.
13. TASARIM/DESIGN kart satırı, CHANGELOG×2.

**Kabul:** bütün yüzeyler, ağ hatasından sonra bile, 60 saniye içinde güncelleniyor. Kart düzeni üç temada isteğe uyuyor.

### G7 Kapak fotoğrafı (L, 14 adım, önce issue)

1. **Issue.** Profil zarfına `cover: { u, k, n, m, w, h }` alanı eklenir. Eski istemciler bilinmeyen alanı yok sayar (`decodeProfile` 247-265).
2. **`src/app.js`.**
   - `coverUploadId` alanı: `normalizeUserFields` 490-497, kayıt varsayılanı 1719-1723, `handleProfiles` 2082-2089.
   - `handleMyProfile` (2104-2129) bu alanı kabul eder. Gönderilmezse `null` sayılır.
   - `normalizeAvatars` yerine `normalizeProfileImages` (523), `isAvatarRecord` yerine `isProfileImageRecord` (2685-2702).
   - Sahipsiz yükleme taraması (3680), mesaja ekleme yasağı (2333) ve hesap silme temizliği (2014-2020) kapağı da kapsar.
   - Boyut sınırı `avatarMaxBytes` ile aynı. Hata kodları `bad_cover` ve `cover_too_large`.
3. **`src/i18n.js`.** İki hata için tr ve en metinleri.
4. **`13-profile.js`.**
   - `cleanCoverRef` yazılır, `storeProfileEntry` ve `decodeProfile` kapağı okur.
   - `uploadCover`: ortadan 3:1 kırpma, 1200x400, JPEG. Kalite önce 0.85, sınır aşılırsa 0.7 ve 0.55. Kapak kendi dosya anahtarıyla şifrelenir.
   - `loadCover` tembeldir, kart açılınca indirilir ve G6'nın yeniden deneme yolunu kullanır.
   - `saveProfile(..., coverFile)`.
5. **`11-settings.js` Profil sayfası.** Kapak seçme, kaldırma ve önizleme. Taslakta `coverMode`. `buildPreviewCard` bandın içinde `<img>` gösterir.
6. **CSS.** `.profile-card-band` için `position: relative` ve `overflow: hidden`. İçindeki resim `object-fit: cover`. `skins/turkuaz.css` kemer biçimi korunur.
7. **Testler.**
   - `test/server-profile.test.js`:
     - Kapak bağlama, başkasının yüklemesini ve mesaja bağlı yüklemeyi reddetme.
     - Boyut sınırı, indirme yetkisi.
     - Değiştirme ve silmede eski dosyanın kaldırılması, kotaya sayılması.
     - Alan gönderilmezse kapağın kalkması.
   - Birim: kırpma ve kalite sırası.
   - `e2e/17`: kapak yüklenir ve diğer kullanıcının kartında görünür. `h.readDataDir` ile bakılınca diskte düz resim baytları yoktur.
8. **Belgeler.** MIMARI/ARCHITECTURE: yüklemeler bölümü ve "kart açılınca kapak indirilir, sunucu bunu görür" notu. README×2, CHANGELOG×2.

**i18n**

| Anahtar | tr | en |
|---|---|---|
| `settings.profile.coverTitle` | Kapak Fotoğrafı | Cover Photo |
| `settings.profile.coverPick` | Kapak Seç | Choose Cover |
| `settings.profile.coverRemove` | Kapağı Kaldır | Remove Cover |
| `settings.profile.coverHint` | Kapak 3:1 oranında ortadan kırpılır (1200x400). Uçtan uca şifrelenir, yalnızca bu frekanstakiler görebilir. | The cover is center-cropped to 3:1 (1200x400). It is end-to-end encrypted and only members of this frequency can see it. |
| `settings.profile.coverReading` | Kapak hazırlanıyor... | Preparing the cover... |
| `settings.profile.coverReady` | Kapak hazır, kaydedince yüklenir. | Cover ready. It uploads when you save. |
| `settings.profile.coverRemoved` | Kapak kaydedince kaldırılır. | The cover is removed when you save. |
| `settings.profile.coverTooBig` | Kapak 1 MB sınırına sığdırılamadı. Daha küçük bir resim seçin. | The cover could not fit the 1 MB limit. Choose a smaller image. |
| `profile.coverInvalid` | Kapak resmi okunamadı. | The cover image could not be read. |
| `profile.coverUploadFailed` | Kapak yüklenemedi. | The cover could not be uploaded. |
| `errors.bad_cover` | Kapak fotoğrafı geçersiz. | The cover photo is invalid. |
| `errors.cover_too_large` | Kapak fotoğrafı çok büyük. | The cover photo is too large. |

**Kabul:** kapak iki dilde yüklenip görünüyor, diskte düz baytı yok, eski istemcinin kaydı kapağı tutarlı biçimde kaldırıyor.

### G8 Otomatik boşta (L, 12 adım)

1. **`src/hub.js`.**
   - Oturum kaydına `rt.idle` alanı ekle. `poll()` içinde `params.idle === '1'` okunur ve `setIdle(rt, bool)` çağrılır. Oturum başına en sık 5 saniyede bir geçiş kabul edilir.
   - `userAutoIdle(userId)`: kişinin etkin oturumlarının hepsi boştaysa doğru döner.
   - `presenceView` (263-275): `status: online ? (u.status === 'online' && userAutoIdle(u.id) ? 'idle' : u.status) : 'offline'`.
   - Toplu durum değişince `bumpMeta` çağrılır. Görünmez kişide hiç çağrılmaz. `touch` ve `deactivate` toplu durumu değiştirirse de çağrılır.
2. **`src/app.js:1839-1842` `handlePoll`.** `idle: q.get('idle')` hub'a geçirilir. Diske hiçbir şey yazılmaz.
3. **`public/js/40-bosta.js`.**
   - Dinlenen girdiler: `pointerdown`, `pointermove` (zaman damgasıyla kısılmış), `keydown`, `wheel`, `touchstart` ve sayfanın görünür olması.
   - Oyun kolu: 2 saniyede bir `navigator.getGamepads()` zaman damgaları karşılaştırılır. Böylece `21-band.js` değişmez.
   - Masaüstü: `telsizDesktop.idleSeconds()` (G1).
   - Karar `Date.now()` farkına dayanır. Ses odasındayken boşta sayılmaz.
   - Durum değişince `startPoll()` ile poll yeniden başlatılır.
4. **Poll parametresi.** `05-poll.js:36-44` ve `25-arka-plan.js:282` sorguya `&idle=0|1` ekler. Arka plan frekansları `telsizArkaPlan.idleSeconds()` kullanır.
5. **Kendi durum gösterimi.** `13-profile.js:416` `userStatus` ve `10-voice.js:969` `myStatusLine`: elle durum `online` iken meta `idle` diyorsa "Boşta (otomatik)" gösterilir.
6. **Ayarlar.** `11-settings.js` Gizlilik sayfası: anahtar ve süre seçimi (5, 10, 15, 30, 60 dakika). `SETTINGS_KEYS` (43) içine `autoIdle` (varsayılan açık) ve `autoIdleMinutes` (varsayılan 10) eklenir. Ayar cihaza özeldir.
7. **Kayıt.** `index.html` ve `sw.js` içine `40-bosta.js`.
8. **Testler.**
   - `test/server-bosta.test.js`:
     - İki oturumdan biri boştaysa kişi `online`, ikisi de boştaysa `idle` görünür.
     - `dnd` ve `invisible` korunur, oturum düşünce durum yeniden hesaplanır.
     - Geçersiz değer yok sayılır, sık geçiş sınırı uygulanır.
   - `e2e/18-otomatik-bosta.test.js` yuva 25, `page.clock.fastForward` ile:
     - 10 dakika ileri alınınca diğer kişide durum "idle" olur.
     - Tıklayınca geri döner.
     - Ses odasındayken boşta olunmaz.
     - Ayar kapalıyken hiç boşta olunmaz.
9. **Belgeler.** README×2 durumlar. MIMARI/ARCHITECTURE: poll parametresi ve "hareketsiz kalma zamanı" üst verisi. desktop/README×2, CHANGELOG×2.

**i18n**

| Anahtar | tr | en |
|---|---|---|
| `settings.privacy.idleTitle` | Otomatik Boşta | Automatic Idle |
| `settings.privacy.autoIdle` | Hareketsiz kalınca durumumu Boşta göster | Show me as Idle when I'm inactive |
| `settings.privacy.autoIdleHint` | Bu cihazda seçilen süre boyunca fare, klavye, dokunma veya oyun kolu kullanılmazsa durumunuz başkalarına Boşta görünür. Ses odasındayken boşta sayılmazsınız. Sunucu ve üyeler ne zaman hareketsiz kaldığınızı görebilir. Elle seçtiğiniz durumlar değişmez. | If you don't use the mouse, keyboard, touch or a gamepad on this device for the chosen time, others see you as Idle. You are never idle while in a voice room. The server and members can see when you went inactive. Statuses you set yourself are not changed. |
| `settings.privacy.autoIdleAfter` | Süre | After |
| `settings.privacy.autoIdleMinutes_one` | {count} dakika | {count} minute |
| `settings.privacy.autoIdleMinutes_other` | {count} dakika | {count} minutes |
| `status.autoIdle` | Boşta (otomatik) | Idle (automatic) |

**Kabul:** iki cihazlı senaryoda durum yalnızca iki cihaz da boştayken değişiyor. Hiçbir geçiş diske yazılmıyor.

### G9 Gezinme 1 (L, 9 adım)

1. **`38-gezinme.js` geçmiş yığını (S2).**
   - Açılışta `history.replaceState({ telsiz: { v: 1, u: meId, d: 0, view, id } }, '')`.
   - Kullanıcı eylemiyle konuşma değişince `pushState`. Adres ve `#` bölümü değişmez.
   - `popstate` gelince açık katman varsa önce o kapanır. Yoksa ilgili işlev `{ fromHistory: true }` ile çağrılır: `selectChannel`, `showDm` veya `showHome`.
   - Kayıttaki kullanıcı kimliği uyuşmazsa veya kişi uygulamada değilse olay yok sayılır.
   - Katmanlar (sayfa, arama, ayarlar, resim görüntüleyici, profil kartı) her genişlikte geçmişe yazılır: `{ telsiz: { v: 1, u, overlay } }`. Bu iş `watchLayers` (`02-state-dom.js:350`) ile yapılır ve `12-init.js:101, 154-180` içindeki telefona özel yığının yerini alır.
   - Kök kayıttan geri basılınca uygulamadan çıkılır, tuzak kurulmaz.
2. **Okunmamış ayracı (S3).**
   - `06-messages.js:536-600` `loadChannel` yüklemeden önceki `lastRead` değerini saklar.
   - İlk okunmamış sayfadaysa önüne "Yeni mesajlar" ayracı konur (`role="separator"`) ve ayraç görünür alanın üst üçte birine kaydırılır.
   - İlk okunmamış sayfada yoksa `around=lastRead` ile yüklenir (`src/app.js:2300-2320` zaten destekliyor) ve `hasNewer` ile `loadNewer` kullanılır.
   - Üstte şerit: sayı, [Okunmamışa Git] ve [Okundu İşaretle].
3. **Okundu kuralı (S4).**
   - `04-meta.js:1062-1085` `markRead` yalnızca kullanıcı alttayken çalışır (`isNearBottom && !hasNewer`). `04-meta.js:1135` ve `05-poll.js:171-172` bu kurala bağlanır.
   - `insertMessage` (378-406): kullanıcı yukarıdayken kaydırma yapılmaz ve "N yeni mesaj" kapsülü görünür.
4. **Özel mesaj grubu (S5).**
   - `fillRoomList` (`04-meta.js:620`) sağ karta ve İstasyonlar sayfasına "Özel Mesajlar" grubu ekler: okunmamışlar üstte, en çok 6 satır ve "Tüm Özel Mesajlar".
   - Satırlar `data-dm-id` taşır (`21-band.js:507` bunları zaten işliyor).
   - 1280 px altında Özel düğmesi listeyi açar. Geniş ekranda okunmamışı olan en yeni konuşmayı açar.
   - "Oda bilgisi" sayfasından `dm-section` kaldırılır.
5. **Görünümün hatırlanması (S12).** `userKey('view')` içinde `{ mode, id }` saklanır. `openApp` özel mesaj ve Arkadaşlar görünümünü de geri yükler.
6. **Kayıt.** `index.html` ve `sw.js` içine `38-gezinme.js`.
7. **Testler.**
   - `test/gezinme.test.js` (vm): yığın sırası, ayraç yeri, sonraki okunmamış sırası.
   - `e2e/19`:
     - Geri tuşu sırası. Telefonda sayfa, arama ve ayarlar geri tuşuyla kapanır. 768 px'te sayfa açıkken geri tuşu sayfayı kapatır.
     - Ayraç görünür alanda. Sayaç ancak alta inilince düşer. 120 okunmamışta `around` yolu çalışır.
     - Yukarıdayken gelen mesajda kapsül "1 yeni mesaj" der ve `lastRead` değişmez.
     - 360, 768 ve 1024 px'te özel mesaj grubu görünür.
     - Özel mesajdayken sayfa yenilenince özel mesaja dönülür.
   - `e2e/02-frekans.test.js:369` ve `:405` güncellenir. Testler Firefox ve WebKit'te de çalıştırılır.
8. **Belgeler.** CONTRIBUTING×2 modül tablosu, MIMARI (geçmiş ve okundu kuralı), TASARIM (ayraç, şerit, kapsül), README×2, CHANGELOG×2.

**i18n**

| Anahtar | tr | en |
|---|---|---|
| `nav.newDivider` | Yeni mesajlar | New messages |
| `nav.unreadBar_one` | {count} yeni mesaj | {count} new message |
| `nav.unreadBar_other` | {count} yeni mesaj | {count} new messages |
| `nav.unreadSince` | {time} saatinden beri | since {time} |
| `nav.jumpToUnread` | Okunmamışa Git | Jump to Unread |
| `nav.markRead` | Okundu İşaretle | Mark as Read |
| `nav.newBelow_one` | Aşağıda {count} yeni mesaj | {count} new message below |
| `nav.newBelow_other` | Aşağıda {count} yeni mesaj | {count} new messages below |
| `nav.newBelowLabel` | Yeni mesajlara in | Go down to new messages |
| `nav.jumpToBottom` | En Alta Git | Jump to Bottom |
| `rooms.dmGroup` | Özel Mesajlar | Direct Messages |
| `rooms.dmAll` | Tüm Özel Mesajlar | All Direct Messages |

**Kabul:** geri tuşu hiçbir genişlikte ilk basışta uygulamadan çıkarmıyor. İlk okunmamış mesaj görünür alanda. Yukarıdayken gelen mesaj okundu sayılmıyor.

### G10 Gezinme 2 (L, 7 adım)

1. **Konum ve önbellek (S6).**
   - Son 8 konuşma bellekte tutulur: şifreli zarflar, `hasMore`, `hasNewer`, çapa (ilk görünen mesajın kimliği ve kayması), `stick`, `newBelow`.
   - Geri dönünce iskelet göstermeden çizilir ve çapaya kaydırılır. Ardından en yeni sayfa arka planda alınıp birleştirilir.
   - Önbellekteki konuşmalara gelen poll olayları önbelleğe de uygulanır (`05-poll.js`).
   - Yeniden eşitlemede, çıkışta ve anahtar değişince önbellek silinir.
2. **Eski mesajların kendiliğinden yüklenmesi (S7).** `#load-older-wrap` üzerinde `IntersectionObserver` (üst rootMargin 800 px). Desteklenmeyen tarayıcıda `onMessagesScroll` içinde `scrollTop < 400` denetimi. Düğme kalır.
3. **Orta genişlik ve dar başlık (S8, S9).**
   - S8: 760 ile 1279 px arasında `.inbox` sağ sütunda telsiz kartının üstünde görünür (`frekans.css`).
   - S9: özel mesaj başlığındaki düğmeler `ResizeObserver` ve `is-tight` sınıfıyla yalnızca simgeye döner. `.dm-header-text` en az 6rem, ⋯ düğmesi `flex: none` (`arama.css`, `people.css`).
4. **Kısayollar ve hızlı geçiş (S10).**
   - Alt+Yukarı/Aşağı: önceki veya sonraki konuşma. Alt+Shift+Yukarı/Aşağı: sonraki okunmamış, anmalar önce. Esc (açık katman yokken): okundu say ve en alta in.
   - Bas konuş atamasıyla çakışırsa kısayol devre dışı kalır (`commaBound` kalıbı).
   - Ctrl+K paneline (`17-search.js`) yerel "Odalar ve Kişiler" sonuçları eklenir.
   - `#hints-card` içine kısayol satırları eklenir.
5. **Küçük düzeltmeler (S11, S13, S14, S15).**
   - S11: sayfa doluysa ve `hasMore` doğruysa okunmamış sayısı "50+" gösterilir.
   - S13: `index.html:630` telefonda kapalı ses çubuğu, ses grubunu açan 44 px'lik "Ses Odaları" düğmesi olur (`10-voice.js` içinde küçük değişiklik).
   - S14: `@media (pointer: coarse)` altında satırlar ve üst düğmeler en az 44 px.
   - S15: alt sayfanın tutamacından 80 px aşağı sürükleyince sayfa kapanır.
6. **Testler.** `e2e/19`:
   - Dönüşte ilk görünen mesaj korunur ve çizimden önce istek gitmez.
   - En üste kaydırınca eski mesajlar kendiliğinden gelir.
   - Kısayollar ve Ctrl+K'de oda sonucu çalışır.
   - 1024 ile 1280 px arasında başlıktaki ad en az 80 px görünür.
   - "50+" gösterimi, yatay taşma yok, konsol temiz.
7. Belgeler (aynı çiftler).

**i18n**

| Anahtar | tr | en |
|---|---|---|
| `search.quickTitle` | Odalar ve Kişiler | Rooms and People |
| `search.quickOpen` | {name} aç | Open {name} |
| `hints.altArrows` | Alt + Yukarı/Aşağı: önceki veya sonraki konuşma | Alt + Up/Down: previous or next conversation |
| `hints.altShiftArrows` | Alt + Shift + Yukarı/Aşağı: sonraki okunmamış | Alt + Shift + Up/Down: next unread |
| `hints.esc` | Esc: okundu işaretle ve en alta in | Esc: mark as read and jump to bottom |
| `radio.pickButton` | Ses Odaları | Voice Rooms |
| `count.more` | {count}+ | {count}+ |

### G11 Yüzen pencereler (L+M, yaklaşık 20 adım, sunucu değişikliği yok)

**Masaüstü (hemen başlar)**
1. **`desktop/src/lib/float-window.js`.**
   - Jeton: `arm()` ve `take(name)`. Tek kullanımlık, ömrü yaklaşık 3 saniye, biçimi `telsiz-yuzen-<32 hex>`.
   - `options(bounds)` şunu döndürür: `{ show:false, frame:false, alwaysOnTop:true, skipTaskbar:true, minimizable:false, maximizable:false, fullscreenable:false, resizable:true, minWidth:200, minHeight:120, webPreferences:{ preload:'' } }`.
   - `cleanBounds(raw, workArea)`.
2. **`main.js:1458-1462` `setWindowOpenHandler` dar istisnası.** Hepsi birlikte gerekir:
   - bağlam `'app'`
   - gönderen ana pencere
   - adres `about:blank`
   - `floatGate.take(details.frameName)` başarılı
3. **`did-create-window`.**
   - Önce `child.webContents.opener === mainWindow.webContents.mainFrame` denetlenir, değilse `destroy()`.
   - Sonra bağlam `'float'` olarak kaydedilir, `setAlwaysOnTop(true, 'floating')`, `setVisibleOnAllWorkspaces(true)`, `setContentProtection(true)` uygulanır. Pencere ana pencerenin ekranında sağ altta `showInactive()` ile açılır.
   - Ana pencere kapanınca veya sayfa yenilenince yüzen pencere kapanır.
4. **Yeni IPC.** `telsiz:float-arm` (invoke, yalnızca `'app'`) ve `telsiz:float-show-main`.
5. **Diğer masaüstü dosyaları.**
   - `preload.js` ve `channels.js`: `telsizDesktop.float = { arm(), showMain() }`. Pencere durumu G1'den gelir.
   - `permissions.js`: `deniedFor('float', *)` her izni reddeder.
   - `navigation.js`: `float` bağlamında her gezinme reddedilir.
   - `settings-store.js`: `floatBounds`.
   - `strings.js`: `float.windowTitle`.

**İstemci**
6. **`39-yuzen.js`.**
   - `floatMode()`: önce `'desktop'` denetlenir, sonra `'document'`, `'video'` ya da `null`.
   - `floatPlan(s)`: saf işlev, `{ kind: 'share' | 'cams' | 'avatars', tiles, more }` döner. En çok 4 kamera ve 8 avatar.
   - `floatOpen(reason)` ve `floatClose(reason)`.
   - Çizim yüzen belgenin kendi `requestAnimationFrame` döngüsüyle yapılır.
   - Görüntüler `cameraVideoFor('float-' + id)`, temizlik `pruneCameraVideos('float-')`.
   - Stil: açan sayfanın stylesheet bağlantıları ve kök öznitelikleri kopyalanır.
   - Kontroller: Mikrofon, Uygulamaya Dön, Kapat. Ayrıl düğmesi yok.
   - `voiceHook('change', floatOnVoice)` ve `voiceHook('render', floatRender)` (G0). `10-voice.js` değişmez.
   - Masaüstünde `onWindowState` ile `minimized` veya `hidden` gelince ve ses odasında veya özel aramadaysa ve `telsiz.floatAuto` açıksa açılır. `restored` veya `shown` gelince kapanır.
   - Tarayıcıda `mediaSession.setActionHandler('enterpictureinpicture')` ses odasındayken kaydedilir. Belge PiP'in kapanışı `pagehide` ile yakalanır.
   - Video yedeği: 480x270 tuval, `setInterval` ile 15 kare/sn, `captureStream`, `requestPictureInPicture`. İstekten hemen önce `disablePictureInPicture` kaldırılır.
   - "Yüzen Pencere" düğmesi `#radio-tools` içine eklenir.
7. **`yuzen.css`.** Flexbox ve margin. Masaüstünde başlık için `-webkit-app-region: drag`. Konuşma halkası `--live` belirteciyle.
8. **`11-settings.js` Ses ve Görüntü.** Anahtar `telsiz.floatAuto` (varsayılan açık) ve platforma göre açıklama.
9. **Kayıt.** `index.html`: betik, CSS, `i-pip` ve `i-minimize` simgeleri. `sw.js`.

**İstek 16 (Renk'in 22-cast adımı birleştikten sonra)**
10. **`22-cast.js`.**
    - `castState.ownMin` ve `telsiz.castOwnMin`. 238. satır `sharing && !ownMin ? 'own' : null` olur.
    - Kendi yayınının başlığına "Küçült" ve "Yüzen Pencere" düğmeleri. İkincisi `floatOpen('share-own')` çağırır.
    - `castRenderTop` içine küçültülmüşken "Önizlemeyi Göster" düğmesi.
    - İzleme kipine "Yüzen Pencere" düğmesi, `floatPlan` türü `share`.
11. **`cast.css`.**

**Testler ve belgeler**
12. Testler:
    - `test/yuzen.test.js`: `floatPlan` durumları, `floatMode` önceliği, i18n, `index.html` ve `sw.js` bağlantıları.
    - Masaüstü birim: jeton, seçenekler, `cleanBounds`, `deniedFor`, `preload` kanalları. `guvenlik.test.js` ve `kararlar.test.js` yeni istisnaya göre güncellenir.
    - `e2e/20-yuzen.test.js` yuva 29 (Chromium):
      - Belge PiP içinde Mert'in görüntüsü oynar.
      - Kamera kapanınca kutu avatara döner, konuşunca halka görünür.
      - Kapat'a basınca `float-` görüntüleri temizlenir.
    - `e2e/05-ses-yayin` genişletmesi:
      - Küçült'e basınca yayın sürer, çipteki Göster sahneyi geri getirir.
      - Yüzen pencerede Durdur var.
      - İzleyicinin yüzen penceresinde yayın oynar.
    - Masaüstü duman testi: jetonsuz `window.open` hâlâ `null` döner.
13. Belgeler: README×2, desktop/README×2 ("yeni pencere engellenir" ifadesine istisna), MIMARI/ARCHITECTURE, CONTRIBUTING×2 modül tablosu, CHANGELOG×2.

**i18n**

| Anahtar | tr | en |
|---|---|---|
| `float.open` | Yüzen Pencere | Floating Window |
| `float.openLabel` | Ses odasını yüzen pencerede aç | Open the voice room in a floating window |
| `float.backToApp` | Uygulamaya Dön | Back to App |
| `float.close` | Yüzen Pencereyi Kapat | Close Floating Window |
| `float.title` | {room} · Telsiz | {room} · Telsiz |
| `float.more_one` | +{count} kişi | +{count} person |
| `float.more_other` | +{count} kişi | +{count} people |
| `float.unsupported` | Bu tarayıcı yüzen pencereyi desteklemiyor. | This browser doesn't support floating windows. |
| `float.failed` | Yüzen pencere açılamadı. | The floating window could not be opened. |
| `settings.voice.floatTitle` | Yüzen Pencere | Floating Window |
| `settings.voice.floatAuto` | Uygulama küçültülünce yüzen pencereyi aç | Open the floating window when the app is minimized |
| `settings.voice.floatHintDesktop` | Ses odasındayken pencere küçültülür ya da tepsiye gizlenirse kameralar veya profil fotoğrafları her zaman üstte kalan küçük bir pencerede görünür. Windows ve macOS'ta bu pencere ekran paylaşımına girmez. | While you're in a voice room, minimizing the window or hiding it to the tray shows cameras or profile photos in a small always-on-top window. On Windows and macOS this window is excluded from screen sharing. |
| `settings.voice.floatHintBrowser` | Chrome ve Edge'de ses odasındayken başka sekmeye geçince açılır. Tarayıcı simge durumuna küçültülünce kendiliğinden açılmaz, Yüzen Pencere düğmesini kullanın. | In Chrome and Edge it opens when you switch tabs while in a voice room. It doesn't open by itself when the browser is minimized. Use the Floating Window button. |
| `settings.voice.floatHintWayland` | Wayland oturumunda pencere her zaman üstte kalamaz ve ekran paylaşımına girebilir. | In a Wayland session the window can't stay on top and may appear in screen shares. |
| `cast.minimize` | Küçült | Minimize |
| `cast.minimizeLabel` | Önizlemeyi küçült, paylaşım sürer | Minimize the preview, sharing continues |
| `cast.showPreview` | Önizlemeyi Göster | Show Preview |
| `cast.float` | Yüzen Pencere | Floating Window |
| `cast.floatLabel` | Yayını yüzen pencerede izle | Watch the stream in a floating window |
| `cast.floatLinuxNote` | Linux'ta ve tarayıcıda yüzen pencere tam ekran paylaşımında görünür, izleyenler arkadaşlarınızın görüntüsünü de görebilir. | On Linux and in the browser the floating window shows up in full-screen shares, so viewers may see your friends' video too. |

**Kabul ölçütleri:**
- Masaüstünde küçültünce kameralar varsa kameralar, yoksa avatarlar ve konuşma halkası çıkıyor. Pencere geri gelince yüzen pencere kapanıyor.
- Jetonsuz ve YouTube çerçevesinden gelen `window.open` hâlâ reddediliyor.
- Yayın küçültülüyor ve geri getiriliyor.

### G12 Yeni temalar (L, 16 adım)

1. **Tek kaynaklı tema listesi.** `theme-init.js:11` `SKINS` listesine `saha, lamba, fosfor, kutup, plak, kokpit, kontrast` eklenir. `11-settings.js:58` `SKIN_CHOICES` kendi kopyasını bırakıp `window.TelsizTheme.skins` kullanır.
2. **`tokens.css`.**
   - Her tema için `:root[data-skin="x"]`, `[data-scheme="dark"]` ve `[data-scheme="light"]` blokları, belirteçlerin tamamıyla. Kaynak: `scratchpad/arastirma/tasarim/yeni-temalar.css`. Bu dosya geçici klasörde, uygulayıcı ilk adımda depoya almalı. Kaybolduysa renk tablosu tasarım raporunda.
   - Fosfor açık, Kontrast açık ve Kontrast koyu için ölçülmüş rol rengi değerleri.
3. **Ton belirteçleri.** Yeni `--tone-camera`, `--tone-mic`, `--tone-deafen`, `--tone-screen`, varsayılanları `var(--role-*)`. `radio.css:813-836` bunları kullanır.
4. **Süs dosyaları.** `public/css/skins/<id>.css` (7 dosya). Her seçici `:root[data-skin="<id>"]` ile başlar. `conic-gradient` yok, `backdrop-filter` yalnızca `@supports` içinde. Kontrast temasında boş yazma alanındaki soluk Gönder düğmesi düzeltilir.
5. **Önizlemeler ve kartlar.**
   - `components.css:3901` sonrasına `.theme-swatch-<id>`.
   - `settings.css:1066-1100`: önizleme 2rem, açıklama yalnızca seçili kartta, `aria-describedby` korunur. Gruplar "Telsiz Temaları" ve "Erişilebilirlik".
6. **Yüksek Kontrast ilk açılışta.** `theme-init.js`: saklı tercih yoksa ve `(prefers-contrast: more)` veya `(forced-colors: active)` doğruysa `kontrast` seçilir. `base.css` içine küçük bir `@media (forced-colors: active)` bölümü.
   - Destek: https://caniuse.com/wf-prefers-contrast ve https://caniuse.com/wf-forced-colors
7. **Kayıt.** `index.html:33` sonrasına 7 `<link>`, `sw.js:31` sonrasına 7 yol.
8. **Testler.**
   - `test/tema.test.js`:
     - Her tema için üç blok var. Arcade koyudaki her belirteç her temada tanımlı.
     - WCAG kontrastı: metin 4.5, bileşen 3, Kontrast teması 7. Ölçüm `kontrast.js` mantığının taşınmasıyla yapılır.
     - Bağlantılar, i18n ve yasaklı CSS yok.
   - `test/settings.test.js:595, 914-939`.
   - `e2e/04-ayarlar`: 10 kartın her biri tıklanır, `data-skin` değişir, seçim yeniden yüklemede korunur. 390 ve 1440 px'te taşma yok. `prefers-contrast` öykünmesi (Playwright desteği denetlenmeli).
9. **Belgeler.** TASARIM/DESIGN: tema tanımları ve kontrast tablosu (satırlar tema, sütunlar rol). README×2, CHANGELOG×2.

**i18n** (`theme.skin.<id>` ad, `theme.skinHint.<id>` açıklama)

| id | Ad tr | Ad en | Açıklama tr | Açıklama en |
|---|---|---|---|---|
| saha | Saha Telsizi | Field Radio | Zeytin yeşili sahra telsizi, turuncu sinyal ve şablon etiketler. | An olive field radio with orange signals and stencil labels. |
| lamba | Lambalı Radyo | Tube Radio | Ceviz kasa, fildişi kadran ve pirinç yazılarla 1950'ler radyosu. | A 1950s tube radio with a walnut case, ivory dial and brass lettering. |
| fosfor | Fosfor | Phosphor | Yeşil fosforlu tarayıcı ekranı, açık modda LCD. | A green phosphor scanner screen, LCD in light mode. |
| kutup | Kutup İstasyonu | Polar Station | Buzul mavisi ve parka turuncusu araştırma istasyonu. | A research station in glacier blue and parka orange. |
| plak | Plak | Vinyl | Patlıcan moru, gül pembesi ve altın yaldızlı gece plak yayını. | A late-night vinyl show in aubergine, rose and gold. |
| kokpit | Kokpit | Cockpit | Grafit cam kokpit, macenta rota ve camgöbeği seçim. | A graphite glass cockpit with a magenta route and cyan selection. |
| kontrast | Yüksek Kontrast | High Contrast | En yüksek okunurluk: 7:1 metin, kalın kenarlar, süs yok. | Maximum legibility: 7:1 text, bold borders, no decoration. |

Ayrıca `theme.groupRadio` "Telsiz Temaları" / "Radio Themes" ve `theme.groupAccess` "Erişilebilirlik" / "Accessibility".

**Kabul:** 20 görünümün (10 tema, 2 mod) hepsi kontrast testinden geçiyor, iki boyutta taşma yok, konsol temiz.

### G13 Özgün tasarım "Telsiz yönü" (XL, yaklaşık 30 adım)

1. **F0 kalanı.** `--layout-pad` ve `--column-gap` `frekans.css:1128-1146` içinde gerçekten kullanılır. Gece ve Turkuaz değerleri `TASARIM.md:151` ile tutarlı hâle gelir.
2. **F1 Kayıt defteri (`06-messages.js:196-300` `buildMessageNode`).**
   - `.msg-head` içinde `msg-call`: 1.5rem avatar ve ad.
   - Düğüme `data-av="cN"` (yayın çizgisinin rengi).
   - `aria-hidden="true"` yön etiketi `msg-dir` (TX veya RX). `msg-sr` ekran okuyucu metni değişmez.
   - Saat solda tek aralıklı sütunda.
   - `theme-init.js` içinde yeni tercih `msgLayout`: `kayit` veya `klasik`, anahtar `telsiz.msgLayout`, kök özniteliği `data-msg-layout`, varsayılan `kayit`.
   - Ayarlar > Görünüm'de yeni radyo grubu. Kompakt anahtarı iki düzende de çalışır.
   - CSS `:root[data-msg-layout="kayit"]` altında (`convo.css`, `components.css:1873-1972`).
3. **F2 İstasyonlar.**
   - Frekans okuması her temada görünür (`components.css:1425`).
   - Büyük harfli kategori başlıkları yerine kadran çizgili başlık (`frekans.css:1686`).
   - Ses odasındakiler yan yana çipler olur (`frekans.css:1852-1900`). Adlar görünür kalır, `ul` ve `li` yapısı değişmez.
4. **F3 Sol sütun.**
   - 1280 px ve üstünde telsiz kartı sütunun kalanını kaplar, Bildirimler üstte kalır.
   - Kapalı telsizde ses odaları Katıl düğmeleriyle görünür (`frekans.css:1164`, `:1367-1369`).
   - Hoparlör ızgarası süsü. Bu adım yalnızca CSS.
5. **F4 Durum LED çubuğu.** `components.css:660-705`: avatarın alt kenarında kısa çubuk. Biçim kodu korunur, 3:1 kontrast. xs avatarda nokta kalır.
6. **F5 QSL kartı.** G6'nın kimlik yardımcısı üzerine kurulur. Büyük tek aralıklı `@kullanıcı`, üst bantta frekans adı ve frekans okuması, köşede "QSL" damgası. G7'nin kapağı resim alanı olur.
7. **F6 Söz ve simge.**
   - `channel.welcome` değişir.
   - `index.html:465` simgesi `i-hash` yerine `i-dial`.
   - "Sağırlaştır" yerine "Hoparlör": `i18n.js` 135, 750, 774, 931, 1118, 1119, 1444, 1597, 1605 ve EN eşleri. Anahtar adları değişmez.
   - Yeni SVG sembolü `i-speaker-off`.
8. **F7 Ayarlar.** Grup başlıkları tema etiket yazısıyla, büyük harf yok.
9. **Testler.**
   - `test/settings.test.js`: `msgLayout`.
   - `test/tema.test.js`: ton belirteçleri.
   - `e2e/22-telsiz-duzen.test.js` yuva 33:
     - Her mesajda saat görünür, kendi mesajında TX, başlıkta avatar.
     - Klasik düzen eski görünümü geri getirir.
     - 1440x900'de kartın üst kenarı Bildirimler'in hemen altında.
     - Kapalı telsizde Katıl düğmeleri `h.reachable` olmalı.
     - 390 px'te taşma 0.
   - Ekran görüntüsü betiği kalıcı yapılır.
10. **Belgeler.** TASARIM/DESIGN (frekans düzeni, bileşenler, düzen belirteçleri), README×2, desktop/README×2 ("Sağırlaştır" geçen yerler), CHANGELOG×2.

**i18n**

| Anahtar | tr | en |
|---|---|---|
| `theme.msgLayout` | Mesaj Düzeni | Message Layout |
| `theme.msgLayout.kayit` | Kayıt Defteri | Logbook |
| `theme.msgLayout.klasik` | Klasik | Classic |
| `theme.msgLayoutHint` | Kayıt defterinde saat her mesajın solunda görünür, gönderdikleriniz TX, gelenler RX ile işaretlenir. | In the logbook the time is shown left of every message, and messages you send are marked TX, received ones RX. |
| `msg.dirOut` | TX | TX |
| `msg.dirIn` | RX | RX |
| `channel.welcome` (değişir) | Kayıt başı: {name} | Log start: {name} |
| `radio.deafen`, `user.deafen` (değişir) | Hoparlörü Kapat | Speaker Off |
| `radio.deafened` (değişir) | Hoparlör kapalı | Speaker off |
| `voice.deafenedTitle` (değişir) | Hoparlör Kapalı | Speaker Off |
| `voice.deafenedState` (değişir) | hoparlör kapalı | speaker off |
| `desktop.shortcuts.toggleDeafen`, `settings.keybinds.toggleDeafen` (değişir) | Hoparlörü Aç/Kapat | Toggle Speaker |

1444 ve 1605 satırlarındaki açıklamalarda "sağırlaştır" sözcüğü "hoparlörü kapat" olarak değişir.

**Kabul:** Klasik düzen bugünkü görünümü birebir koruyor. Erişilebilirlik (okuma sırası, `role="log"`) değişmiyor. Üç tema ve yeni temalar için ekran görüntüleri gözden geçirildi.

### G14 Kurtarma kodu (L, 17 adım, önce issue)

1. **Issue.** Taslak başlık: "Kurtarma kodu: 128 bitlik kodla parolayı kendin sıfırla, kimlik anahtarı korunur". İçerik: biçim, uçlar ve tehdit modeli.
2. **`public/crypto.js` `E2EE.recovery`.**
   - `generate()`: 16 rastgele bayt. Var olan 28 karakterlik Crockford biçimi kullanılır, sağlama etiketi farklıdır: `telsiz-recovery-v1/check`.
   - `parse(code)` hata kodları: `empty`, `bad_length`, `bad_char`, `bad_padding`, `bad_checksum`, `group_key_code`.
   - `derive(s)`:
     - `authKey = hex(SHA512('telsiz-recovery-v1/auth' ‖ s)[0..32])`
     - `wrapKey = SHA512('telsiz-recovery-v1/wrap' ‖ s)[0..32]`
     - İstemcide scrypt kullanılmaz.
   - Sarma var olan `identity.wrap` ve `unwrap` ile yapılır.
3. **`src/auth.js`.** `cleanRecoverySetup` ve `isRecoveryRecord`.
4. **Kullanıcı kaydı.** `recovery: { v:1, hash:'scrypt$…', wrappedKey:'1w.…', createdAt, label } | null`. `hash` alanı `hashPassword(recoveryAuthKey, config.scryptN)` ile üretilir.
5. **`src/app.js` var olan uçlar.**
   - `normalizeUserFields` (471).
   - `handleRegister` (1682): isteğe bağlı `recovery` alanı, kayıtla birlikte saklanır.
   - `handleState` (1807): yalnızca kişinin kendisine `{ createdAt, label }` döner.
6. **`POST /api/me/recovery`.**
   - Gövde: `{ authKey, recovery: { authKey, wrappedKey } | null }`. `null` kodu kaldırır.
   - Yanıtlar: 401 `bad_credentials`, 409 `no_keys` veya `password_change_required`.
   - `accountFailLimiter 'p:'` kullanılır. `await` sonrası `passHash` ve `publicKey` yeniden denetlenir.
7. **Oturumsuz uçlar.**
   - `POST /api/recover/keys { name, recoveryAuthKey }` yanıtı `{ publicKey, wrappedKey }`.
     - Hesap yok, kod yok veya kod yanlış: hep aynı 401 `bad_recovery`. Süre de aynı tutulur (`dummyHash` doğrulaması).
   - `POST /api/recover { name, recoveryAuthKey, publicKey, newAuthKey, kdf, wrappedKey, recovery, device? }`:
     - Kod yeniden doğrulanır. `publicKey` farklıysa 409, hesap engelliyse 403.
     - `passHash`, `credEpoch`, `kdf` ve `wrappedKey` yenilenir. Kurtarma kodu zorunlu olarak yenisiyle değişir.
     - `resetPending=false`, bütün oturumlar kapanır, giriş sayaçları sıfırlanır.
     - Yanıt: `{ token, user, keys, device, recovery }`.
   - Hız sınırları: `authLimiter` ve ayrı `r:` sayaçları, giriş sayaçlarından ayrı.
8. **Temizlik.** `applyCredentials` (1614), `deleteAccount` (2000) ve `server.js:440-450` komut satırı sıfırlaması `recovery=null` yapar.
9. **`src/i18n.js`.** `bad_recovery` ve `keys_changed`.
10. **`16-identity.js`.** `buildAccountKeys` kodu da üretir. Yeni işlevler `createRecoveryRequest(password)` ve `recoverAccount(name, code, newPassword, onPercent)`.
11. **`41-kurtarma.js`.**
    - "Parolamı Unuttum" kartı ve kod görünümü: Kopyala, İndir, "kaydettim" onayı.
    - Ayarlar > Hesabım içindeki bölümün kurucusu.
    - Mevcut hesaplara girişte bir kez hatırlatma, `localStorage` bayrağıyla.
12. **`03-auth.js`.**
    - `AUTH_CARDS` (22) içine `'forgot'` ve `'recovery'`.
    - `index.html:380-387` giriş formuna bağlantı.
    - Sıralar: kurulum, kod kartı, davet. Kayıt, kod kartı, profil.
    - Sahip sıfırlamasından sonra `openResetPassword` başarılı olunca kod otomatik üretilir.
13. **`11-settings.js`.** `buildAccountPage` (866) içine bölüm. `resetConfirm` ve `tempHint` metinlerine "kurtarma kodu da silinir" eklenir. Parola değiştirme formuna "kurtarma kodunu da yenile" kutusu, varsayılan kapalı.
14. **Testler.**
    - `test/server-kurtarma.test.js`: rapordaki bütün durumlar.
    - `test/crypto.test.js`: Python `hashlib` ile bağımsız hesaplanmış test vektörleri.
    - `test/kurtarma-istemci.test.js` (vm).
    - `e2e/21-kurtarma.test.js` yuva 31: özel mesaj kurtarmadan sonra okunur, karşı tarafta anahtar uyarısı çıkmaz. Kodu olmayan kişi yönlendirme metnini görür. Ayarlardan oluşturma, yenileme ve kaldırma. Telefon genişliği.
15. **Belgeler.** MIMARI/ARCHITECTURE (ve 102. satırdaki "yönetici" hatası), KURULUM:354 ve DEPLOYMENT, README×2, CONTRIBUTING×2, SECURITY, CHANGELOG×2.

**i18n**

| Anahtar | tr | en |
|---|---|---|
| `auth.forgot` | Parolamı Unuttum | Forgot My Password |
| `auth.forgotTitle` | Kurtarma Koduyla Parolayı Sıfırla | Reset Your Password with a Recovery Code |
| `auth.forgotLead` | Kayıt olurken ya da Ayarlar > Hesabım'dan aldığınız kurtarma koduyla yeni parola belirleyin. Özel mesajlarınız korunur. | Set a new password with the recovery code you got at sign-up or from Settings > My Account. Your direct messages are kept. |
| `auth.forgotSubmit` | Parolayı Sıfırla | Reset Password |
| `auth.forgotBack` | Girişe Dön | Back to Sign In |
| `auth.recoveryCode` | Kurtarma kodu | Recovery code |
| `auth.recoveryCodeHint` | Dörderli gruplar hâlinde 28 karakter. Büyük küçük harf fark etmez. | 28 characters in groups of four. Case doesn't matter. |
| `auth.recoveryGroupKey` | Bu bir frekans anahtarı, kurtarma kodu değil. | This is a frequency key, not a recovery code. |
| `auth.forgotNoCodeTitle` | Kurtarma kodum yok | I don't have a recovery code |
| `auth.forgotNoCodeText` | Frekansın sahibine uygulama dışından ulaşın. Sahip Ayarlar > Üyeler > Parola Sıfırla ile size geçici parola verebilir. Bu yolla eski özel mesajlarınız okunamaz. | Contact the frequency owner outside the app. The owner can give you a temporary password in Settings > Members > Reset Password. Your old direct messages can't be read after that. |
| `auth.forgotOwnerText` | Sahip sizseniz sunucuda şu komutu çalıştırın: {command} | If you are the owner, run this on the server: {command} |
| `recovery.title` | Kurtarma Kodunuz | Your Recovery Code |
| `recovery.lead` | Parolanızı unutursanız bu kodla yeni parola belirleyebilirsiniz. Kod yalnızca bir kez gösterilir. | If you forget your password, you can set a new one with this code. It is shown only once. |
| `recovery.warning` | Kodu bilen herkes parolanızı değiştirip özel mesajlarınızı okuyabilir. Güvenli bir yere yazın, panoda veya bulutta bırakmayın. | Anyone with this code can change your password and read your direct messages. Write it down somewhere safe and don't leave it in the clipboard or the cloud. |
| `recovery.copy` | Kopyala | Copy |
| `recovery.download` | Dosya Olarak İndir | Download as File |
| `recovery.fileName` | telsiz-kurtarma-kodu.txt | telsiz-recovery-code.txt |
| `recovery.fileText` | Telsiz kurtarma kodu\nSunucu: {server}\nKullanıcı: {name}\nKod: {code}\nTarih: {date}\nBu kodu kimseyle paylaşmayın. | Telsiz recovery code\nServer: {server}\nUser: {name}\nCode: {code}\nDate: {date}\nDon't share this code with anyone. |
| `recovery.saved` | Kodu güvenli bir yere kaydettim | I saved the code somewhere safe |
| `recovery.continue` | Devam | Continue |
| `recovery.rotated` | Parolanız değişti. Eski kurtarma kodu artık geçersiz, yenisi aşağıda. | Your password changed. The old recovery code no longer works, the new one is below. |
| `recovery.remind` | Hesabınızın kurtarma kodu yok. Parolanızı unutursanız özel mesajlarınızı kaybedersiniz. | Your account has no recovery code. If you forget your password, you lose your direct messages. |
| `settings.account.recoveryTitle` | Kurtarma Kodu | Recovery Code |
| `settings.account.recoveryNone` | Kurtarma kodu yok. | No recovery code. |
| `settings.account.recoveryCreated` | {date} tarihinde {device} cihazında oluşturuldu. | Created on {date} on {device}. |
| `settings.account.recoveryCreate` | Kod Oluştur | Create Code |
| `settings.account.recoveryRenew` | Yeni Kod Oluştur | Create New Code |
| `settings.account.recoveryRemove` | Kodu Kaldır | Remove Code |
| `settings.account.recoveryRemoveConfirm` | Kurtarma kodu silinsin mi? Parolanızı unutursanız özel mesajlarınızı kurtaramazsınız. | Delete the recovery code? If you forget your password you can't recover your direct messages. |
| `settings.account.recoveryFailed` | Kurtarma kodu kaydedilemedi. | The recovery code could not be saved. |
| `settings.account.recoveryRemoved` | Kurtarma kodu kaldırıldı. | The recovery code was removed. |
| `settings.account.recoveryRenewWithPassword` | Kurtarma kodunu da yenile | Also renew the recovery code |
| `identity.error.recovery_empty` | Kurtarma kodunu yazın. | Enter the recovery code. |
| `identity.error.recovery_bad_length` | Kod 28 karakter olmalı. | The code must be 28 characters. |
| `identity.error.recovery_bad_char` | Kodda geçersiz karakter var. | The code has an invalid character. |
| `identity.error.recovery_bad_padding` | Kod hatalı yazılmış. | The code is mistyped. |
| `identity.error.recovery_bad_checksum` | Kod hatalı yazılmış, denetim tutmadı. | The code is mistyped, the check failed. |
| `errors.bad_recovery` (sunucu) | Kullanıcı adı veya kurtarma kodu hatalı. | Wrong username or recovery code. |
| `errors.keys_changed` (sunucu) | Hesabın anahtarları değişti, yeniden deneyin. | The account's keys changed. Try again. |

**Kabul:** kodla kurtarmadan sonra açık anahtar aynı kalıyor, eski özel mesajlar okunuyor, eski kod geçersiz. Ad taraması mümkün değil (aynı yanıt, aynı süre).

### G15 Android uygulaması (XL, yaklaşık 29 adım)

Ayrıntılı tasarım Android raporunun 4. bölümündedir. Uygulayıcı oradaki tabloları aynen kullanır. Bu bölüm sırayı ve sabitleri verir.

1. **Issue.** Kural 12'nin yalnızca kök paket için geçerli olduğu açıklanır, Android bağımlılık listesi tartışılır.
2. **Sürümler ve iskelet.**
   - AGP 9.4.0, Gradle 9.8.1 (`distributionSha256Sum` elle eklenir), JDK 17, Kotlin 2.4.21, compileSdk ve targetSdk 36, minSdk 26.
   - Tek çalışma zamanı bağımlılığı `androidx.webkit` 1.17.1.
   - `gradle/verification-metadata.xml` (sha256 doğrulaması).
   - Uygulama kimliği `io.github.yerlifan.telsiz`.
3. **`:cekirdek` modülü (saf Kotlin/JVM, bu kapsayıcıda test edilir).** `SunucuAdresi`, `Frekanslar`, `VarlikListesi`, `Csp`, `IstekKarari`, `KopruIletisi`, `IzinKarari`.
4. **`android/scripts/hazirla.js`.** Varlıkları üretir ve `desktop/src/lib/static-files.js` `resolveStatic` işlevini kullanır. Manifest `{ path, file, type, sha256 }`.
5. **`:app` modülü.**
   - Etkinlikler: `AnaEtkinlik`, `BaglanEtkinligi`.
   - Sınıflar: `TelsizWebViewClient` (istek kesme kararları), `TelsizChromeClient` (izinler yalnızca `getOrigin()==O`), `Kopru` (`addWebMessageListener`, yalnızca köken O ve ana çerçeve), `SesHizmeti` (`FOREGROUND_SERVICE_TYPE_MICROPHONE`), `Bildirimler`, `DosyaKaydet` (SAF), `SesYonu`.
   - Ayarlar:
     - `allowBackup=false` ve `dataExtractionRules` ile bütün yedeklemeler kapalı.
     - `usesCleartextTraffic=false`. `onReceivedSslError` her zaman `cancel()`.
     - Debug derlemesinde yalnızca `10.0.2.2` için http izni.
6. **`public/js/42-android.js`.**
   - Yalnızca `window.telsizAndroidBridge` varsa etkinleşir.
   - `window.telsizAndroid` nesnesi, imzaları masaüstüyle aynı.
   - `window.Notification` yoksa onun yerine geçen küçük bir uyarlama.
   - `TelsizAndroidUI` nesnesi: `saveBytes`, `renderAppSettings`, `onBack`.
   - `voiceHook('change', …)` ile `{ t: 'voice', … }` iletisi.
   - Geri hareketi sırası: önce `topLayer` ve `closeLayer`, sonra G9'un geçmiş yığını, en son `handled:false`.
7. **Var olan dosyalardaki küçük kancalar.**
   - `24-frekans.js:450-454` `frekansDesktop()` `telsizAndroid` nesnesini de kabul eder.
   - `07-attachments.js:185` `saveBytes` önce Android kancasını dener.
   - `11-settings.js:3107` Android bölümü.
   - `index.html` ve `sw.js` kaydı.
8. **Denetleyici.** `scripts/denetle.js`:
   - `BINARY_EXTS` içine `.jar`.
   - `GENERATED_DIRS` içine `android/app/build/`, `android/build/`, `android/.gradle/`.
   - `DOC_PAIRS` içine `android/README` çifti.
   - `android/gradlew.bat` için kural 8 (noktalı virgül) istisnası.
   - `values/strings.xml` ile `values-tr/strings.xml` eşliği.
   - `.gitignore`: `*.jks`, `*.keystore`, `android/local.properties`.
9. **CI.**
   - `.github/workflows/android.yml`: `:cekirdek:test :app:testDebugUnitTest :app:lintRelease :app:bundleRelease`. İsteğe bağlı API 36 emülatör işi.
   - `release.yml`: `android` işi, `needs: check`, environment `android-yayin`, gizli değişkenler `ANDROID_UPLOAD_KEYSTORE_B64`, `_PASSWORD`, `_KEY_ALIAS`, `_KEY_PASSWORD`. Çıktı AAB ve `mapping.txt`, workflow artifact olarak. GitHub Release beyaz listesi değişmez.
10. **Testler.**
    - JVM birim testleri.
    - Ortak `test/fixtures/sunucu-adresleri.json`, `desktop/test/server-url.test.js` de okur.
    - `test/android-kopru.test.js`.
    - `e2e/23-android-kopru.test.js` yuva 35 (sahte köprüyle).
    - Emülatör: varlık ve ağ ayrımı, `/api/x` ana çerçevede açılmaz.
11. **Belgeler.** android/README×2, `docs/GIZLILIK.md` ve `docs/PRIVACY.md` (Play'e verilecek URL), README×2, MIMARI/ARCHITECTURE, CONTRIBUTING×2, SECURITY, CHANGELOG×2. Mağaza metinleri TR ve EN.

**i18n**

| Anahtar | tr | en |
|---|---|---|
| `android.settings.title` | Android Uygulaması | Android App |
| `android.settings.notifications` | Bildirimler | Notifications |
| `android.settings.notificationsDenied` | Bildirim izni kapalı. | Notification permission is off. |
| `android.settings.notificationsOpen` | Bildirim Ayarlarını Aç | Open Notification Settings |
| `android.settings.backgroundVoice` | Ses odasındayken ekran kapansa da bağlantı sürer. Bildirimde Sustur ve Ayrıl düğmeleri görünür. | While you're in a voice room the connection stays on with the screen off. The notification shows Mute and Leave. |
| `android.settings.battery` | Pil Ayarlarını Aç | Open Battery Settings |
| `android.settings.version` | Uygulama sürümü {version} | App version {version} |
| `android.settings.privacy` | Gizlilik Politikası | Privacy Policy |
| `android.save.done` | Dosya kaydedildi. | File saved. |
| `android.save.failed` | Dosya kaydedilemedi. | The file could not be saved. |
| `android.screenShareUnavailable` | Android uygulamasında ekran paylaşımı başlatılamaz, başkalarının paylaşımını izleyebilirsiniz. | Screen sharing can't be started in the Android app, but you can watch others' shares. |
| `android.frequency.removeData` | Bu frekansın cihazdaki verisini de sil (anahtarlar dahil) | Also delete this frequency's data on this device (including keys) |

**Kabul ölçütleri:**
- CI imzalı bir AAB üretiyor.
- Emülatörde sunucuya bağlanılıyor, ses odasına girilip arka plana geçilince ses sürüyor.
- Arayüz APK'dan, API ağdan geliyor.
- YouTube çerçevesi köprüye erişemiyor.

**Play yayını kullanıcının adımlarına bağlı**, bkz. 2.1 madde 3.

### G16 İçerik şikâyeti (M, 8 adım, Play önkoşulu, varsayılan: yapılır)

1. **`src/app.js`.**
   - `POST /api/reports`, gövde `{ kind: 'message' | 'user', channelId?, messageId?, targetUserId, reason: 'spam' | 'harassment' | 'illegal' | 'other', note? }`.
     - `note` grup anahtarıyla mühürlüdür, en çok 2000 karakter. Özel mesaj şikâyetinde kişi mesajın çözülmüş alıntısını bilerek bu nota koyar.
     - Hız sınırı kullanıcı başına saatte 10.
   - `state.reports` alanı, en çok 500 kayıt.
   - `GET /api/reports` ve `POST /api/reports/:id/resolve` yalnızca sahip ve yönetici içindir.
2. **İstemci.**
   - `06-messages.js` araç çubuğuna "Bildir".
   - `13-profile.js` kartına "Kişiyi Bildir".
   - `11-settings.js` Üyeler > Şikâyetler listesi. Not mühürlü olduğu için grup anahtarıyla çözülür.
3. **i18n.**

| Anahtar | tr | en |
|---|---|---|
| `report.message` | Mesajı Bildir | Report Message |
| `report.user` | Kişiyi Bildir | Report User |
| `report.reason` | Neden | Reason |
| `report.reason.spam` | İstenmeyen içerik | Spam |
| `report.reason.harassment` | Taciz | Harassment |
| `report.reason.illegal` | Yasa dışı içerik | Illegal content |
| `report.reason.other` | Diğer | Other |
| `report.note` | Not (isteğe bağlı) | Note (optional) |
| `report.send` | Gönder | Send |
| `report.sent` | Şikâyetiniz frekans sahibine ve yöneticilere iletildi. | Your report was sent to the frequency owner and admins. |
| `settings.reports.title` | Şikâyetler | Reports |
| `settings.reports.resolve` | Çözüldü İşaretle | Mark Resolved |

   Sunucu hata metinleri `src/i18n.js` içine.
4. **Testler.** `test/server-sikayet.test.js` (yetki, hız sınırı, mühürlü notun düz metin içermemesi). `e2e/11-roller` genişletilir.
5. **Belgeler.** README×2, MIMARI/ARCHITECTURE (sunucunun gördüğü üst veri: kim, kimi, hangi neden), CHANGELOG×2.

**Kabul:** üye bir mesajı bildiriyor, sahip listede görüp çözüyor. Not sunucuda düz metin değil.

### G17 Hexball (XL, yaklaşık 15 adım, Renk bittikten sonra)

1. **Önkoşullar.** Renk'in 9 adımı ve `voice.js` işi birleşmiş olmalı. `voice.js` değişikliği için issue açılır.
2. **`voice.js` oyun bağı.**
   - Sabitler: `GAME_LINK_LABEL='telsiz-game'`, `MAX_GAME_DATA=512`, `GAME_DATA_RATE=240`, `GAME_LINK_BUFFER=16384`.
   - İşlevler: `openGameLink`, `closeGameLink`, `gameLinkState`, `sendGameData`. Olaylar `link-open`, `link-close`, `link-failed`. Gelen veri `opts.onGameData` ile verilir.
   - Değişen yerler:
     - `createPeer` (2738): `ondatachannel` kabul kuralı (etiket, `ordered:false`, `maxRetransmits:0`, eş başına tek kanal, özel aramada yok).
     - `needsNegotiation` (3550): kanal varsa ve uzak tanımda `m=application` yoksa doğru döner.
     - `mlineCount` (3121): yalnızca ses ve görüntü satırlarını sayar.
     - `answerFailed` ve `offerFailed`: yalnızca `m=application` eklenmişse `linkBlocked` kurulur.
     - `closePeer`.
3. **`10-voice.js`.** `createVoice` seçeneklerine `onGameData`, `gameOnData` yönlendirmesiyle.
4. **Kural motoru `43-hexball-kural.js`.** 5.1 sözleşmesi.
   - Görünüm durumu: `{ v, rules, ph: 'teams' | 'match' | 'result', teams, slots, score, kick, mt, epoch, golden, goals, result }`.
   - Hamleler: `team`, `set`, `kickoff`, `goal`, `time`, `stop`.
   - Hamle adları `last` ve `catch` olamaz.
5. **Fizik `44-hexball-fizik.js`.** 60 Hz, 2 alt adım. Saha ön ayarları:

   | Ön ayar | Saha | Kale | Süre | Gol |
   |---|---|---|---|---|
   | quick | 720×360 | 120 | 3 dk | 3 |
   | classic | 880×440 | 140 | 5 dk | 5 |
   | long | 1040×520 | 160 | 10 dk | sınırsız |

   Değerler oynanarak ayarlanır, HaxBall'dan kopyalanmaz.
6. **Ağ `45-hexball-ag.js`.**
   - İkili iletiler: HELLO, HELLO_ACK, INPUT, SNAP. Biçimler raporun 4.5 tablosunda.
   - Ev sahibi otoriterdir. Fizik `setTimeout` zinciriyle yürür. İki adım arası 250 ms'yi aşarsa maç duraklar.
   - Ev sahibinin kendi girdisi en çok 80 ms bekletilir.
   - Oyuncular 2 anlık görüntülük tamponla ara değerleme yapar.
7. **Arayüz `46-hexball.js` ve `hexball.css`.**
   - Tuval, klavye, dokunmatik çubuk ve oyun kolu.
   - Maç sürerken `21-band.js padPoll` L1 ve R1 ile frekans değiştirmez (`gameOwnsPad()`).
8. **`36-oyun.js`.** "Oyun Seç" adımı ve tarafsız metinler.
9. **`34-oyun-masa.js`.** Uygulamaya özel `DELAYED_MOVES`.
10. **Kayıt ve belirteçler.** `index.html`, `sw.js`, `tokens.css` (saha ve takım belirteçleri).
11. **Testler.**
    - Beş birim test dosyası: veri kanalı, fizik, kural, ağ, arayüz. Arayüz testi HaxBall adının hiçbir yerde geçmediğini de denetler.
    - `e2e/24-hexball.test.js` yuva 37, `h.MIC_BROWSERS` ile.
12. **Belgeler.** README×2, MIMARI/ARCHITECTURE (oyun veri kanalı, ses ve kanalda sunucuyla araya girme riski), TASARIM/DESIGN, CONTRIBUTING×2 (kural 11 eşten eşe WebRTC'yi kapsamaz), CHANGELOG×2.

**i18n çekirdeği** (yaklaşık 60 anahtarın kalanı aynı kalıpla yazılır)

| Anahtar | tr | en |
|---|---|---|
| `game.hexball.name` | Hexball | Hexball |
| `game.hexball.desc` | Ses odasındakilerle üstten görünümlü gerçek zamanlı futbol. | Real-time top-down football with your voice room. |
| `game.hexball.rules.quick` | Hızlı | Quick |
| `game.hexball.rules.classic` | Klasik | Classic |
| `game.hexball.rules.long` | Uzun | Long |
| `game.hexball.team.red` | Kırmızı | Red |
| `game.hexball.team.blue` | Mavi | Blue |
| `game.hexball.team.spec` | İzleyici | Spectator |
| `game.hexball.kickoff` | Maçı Başlat | Start Match |
| `game.hexball.again` | Tekrar Oyna | Play Again |
| `game.hexball.toLobby` | Lobiye Dön | Back to Lobby |
| `game.hexball.golden` | Altın gol | Golden goal |
| `game.hexball.paused` | Ev sahibinin sekmesi arka planda, maç duraklatıldı. | The host's tab is in the background, the match is paused. |
| `game.hexball.goal` | Gol! {name} | Goal! {name} |
| `game.hexball.ownGoal` | Kendi kalesine: {name} | Own goal: {name} |
| `game.hexball.win` | {team} kazandı | {team} wins |
| `game.hexball.link.waiting` | Bağlantı bekleniyor | Waiting for connection |
| `game.hexball.link.failed` | Bağlantı Yok | No Connection |
| `game.hexball.controls.keys` | Oklar veya WASD ile hareket, X veya Boşluk ile vuruş | Arrows or WASD to move, X or Space to kick |
| `game.hexball.kick` | Vur | Kick |
| `game.hexball.trustHost` | Fiziği ev sahibi hesaplar, ev sahibi hile yapabilir. | The host runs the physics and could cheat. |

**Kabul ölçütleri:**
- 3 kişi Chromium ve Firefox'ta takım seçip maç oynuyor, gol ve skor her yerde aynı.
- Eski istemci ya da engellenmiş bağ "Bağlantı Yok" gösteriyor.
- Ses ve ekran paylaşımı yeniden anlaşması bozulmuyor.

---

## 6. Açık riskler

1. **İstek 5 hukuki ve operasyonel risk taşıyor.** Anahtarsız arama Hizmet Şartlarına aykırı, canlı hiç doğrulanmadı ve biçim değişince bozulur. Sahip anahtarı varsayılan kapalı ve devre kesici var. İlk canlı deneme sunucuda yapılmadan özellik "çalışıyor" sayılmamalı.
2. **Renk iş akışıyla çakışma.**
   - `22-cast.js`, `28-bildirim.js` ve `i18n.js` üzerinde. G6'nın son adımı ve G11'in 16 kısmı Renk'e bağlı.
   - `34-oyun-masa.js` şu anda başka bir iş akışında değişiyor.
   - G17 Renk'in genel metinlerinin tarafsız olmasına ve `DELAYED_MOVES`'un uygulamaya özel olmasına bağlı. Bunlar 36-oyun.js yazılmadan Renk'e iletilmezse G17 Renk'in dosyalarını yeniden açmak zorunda kalır.
3. **`10-voice.js` kanca kaydı.** G0 merkezî bir değişiklik yapıyor. Kanca içindeki hata ses arayüzünü bozmasın diye her çağrı try/catch içinde. Sıranın önemli olduğu durumlarda (yüzen pencere, korumadan önce) çağrı yeri G0'da sabitlendi.
4. **Masaüstü pencere istisnası (G11).** Güvenlikte hassas bir alan. YouTube çerçevesi kullanıcı hareketi olmadan `window.open` çağırabiliyor. Jeton, `opener` denetimi, yalnızca `about:blank`, ön yükleme betiğinin olmaması ve `float` bağlamında her şeyin reddedilmesi birlikte gerekli. `sandbox:true` ile elle doğrulanmadı.
5. **YouTube başlangıç payını 3000 ms'ye çıkarmak** her başlangıcı 1,5 sn geciktirir. Gerçek YouTube yükleme süreleri ölçülemedi. G5'ten sonra pay yeniden ölçülüp düşürülebilir.
6. **Media Session gizliliği.** Şifreli DJ durumundaki parça adı kilit ekranına ve işletim sistemine çıkar. Kapatma ayarı var, varsayılanı açık. Kullanıcı isterse varsayılan kapalıya çevrilebilir.
7. **Otomatik boşta, kapak fotoğrafı ve şikâyet yeni üst veri üretiyor.** Hareketsizlik zamanı, kimin kimin kapağını açtığı, şikâyet kayıtları. Üçü de MIMARI'nin üst veri listesine yazılmalı.
8. **Kurtarma kodu parolaya eşdeğer.** Kodu ele geçiren hesabı ve özel mesajları alır. Parolayı öğrenen biri kalıcı arka kapı olarak kod üretebilir. Önlemler: kod oluşturmak için parola şart, oluşturan cihaz gösterilir, parola değişiminde yenileme seçeneği.
9. **Android.**
   - Bu ortamda derlenemiyor, ilk derleme CI'da başarısız olabilir.
   - WebView'da ses etkinliği zamanlayıcısının kısılması doğrulanamadı.
   - Play incelemesi "yalnızca web sarmalayıcı" diye reddedebilir. Yerel değer: paketli arayüz, ön plan hizmeti, bildirimler, sunucu seçimi.
   - Kişisel hesapta 12 test kullanıcısı ve 14 gün şartı takvimi uzatır.
   - Play App Signing'de imza anahtarını Google tutar. Bu, uçtan uca şifreli uygulamalar için bilinen bir şeffaflık sorunu.
10. **Görsel gerileme yüzeyi büyük (G12, G13).** 20 tema görünümü ve yeni mesaj düzeni var. Kontrast birim testi ve ekran görüntüsü betiği olmadan birleştirilmemeli. Kullanıcılar mesaj düzeni değişikliğine alışmakta zorlanırsa Klasik seçeneği var.
11. **Gezinmede okundu kuralının değişmesi** sayaçların geç düşmesine yol açar ve şikâyet alabilir. Bilinçli bir değişiklik olarak belgelenmeli.
12. **Ad riski (G17).** "Hexball" başka bir ürünün adı ve HaxBall'a benziyor. Tescil durumu doğrulanamadı. Ad yalnızca i18n'de geçiyor, değiştirmek ucuz.
13. **Geçici dosyalar.** Kanıt dosyaları scratchpad'de ve oturumla silinebilir. Uygulamada gereken iki dosya (`yeni-temalar.css`, `telsiz-yonu-prototip.css`) G12 ve G13'ün ilk adımında depoya alınmalı. YouTube örnek yanıtları zaten `docs/calisma/yt-arama/` altında.

Kaynaklar (bu planda yeniden denetlendi):
- [YouTube Terms of Service](https://www.youtube.com/terms)
- [YouTube Terms of Service, 2022 arşiv kopyası](https://webcf.waybackmachine.org/web/20220423214446/https://www.youtube.com/t/terms)
- [Google Play Console Yardım: yeni kişisel hesaplar için test şartları](https://support.google.com/googleplay/android-developer/answer/14151465?hl=en-GB)
- [Android Authority: Google Play test şartı](https://androidauthority.com/google-play-app-testing-requirement-3510580)
- [Choicely: 12 test kullanıcısı kuralı](https://www.choicely.com/blog/google-play-12-tester-rule)

Diğer bütün dış kaynaklar ve doğrulama durumları sekiz araştırma raporunun kaynak bölümlerinden aynen alındı, 2. bölümde ilgili iddiaların yanında verildi.
