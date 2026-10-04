# Telsiz mimarisi

[Türkçe](MIMARI.md) | [English](ARCHITECTURE.md)

Bu belge Telsiz'in sunucusunu, istemcisini, şifreleme tasarımını, ses, ekran paylaşımı ve Telsiz DJ altyapısını, masaüstü uygulamasını ve yayın sürecini anlatır. Son bölüm sistemin neyi koruyup neyi korumadığını açıkça listeler. Kurulum için [KURULUM.md](KURULUM.md), görsel tasarım için [TASARIM.md](TASARIM.md) dosyasına bakın.

## Genel bakış

Telsiz üç parçadan oluşur: tek süreçli bir Node.js sunucusu, tarayıcıda çalışan ve derleme adımı olmayan bir web istemcisi ve aynı istemciyi kendi içinde taşıyan isteğe bağlı bir masaüstü uygulaması. Sunucu hesapları, odaları ve şifreli içerikleri saklar, istemciler arasında olayları dağıtır. Şifreleme ve şifre çözme yalnızca istemcide yapılır. Ses ve ekran görüntüsü kişiler arasında doğrudan akar, sunucu yalnızca bağlantı kurulumunun şifreli mesajlarını iletir.

```text
 Tarayıcı veya masaüstü uygulaması                 Telsiz sunucusu (Node.js)
 +----------------------------------+   HTTPS     +-----------------------------+
 | public/js/01..23, crypto.js      |  JSON API   | src/app.js   uç noktalar    |
 | anahtarlar yalnızca burada       |<----------->| src/hub.js   long-polling   |
 | şifreleme, çözme, arama          | long-poll   | src/store.js JSON ve JSONL  |
 +----------------------------------+             +-----------------------------+
        ^        WebRTC (DTLS-SRTP)
        |   ses ve ekran, kişiden kişiye
        v
 +----------------------------------+
 | diğer katılımcılar               |
 +----------------------------------+
```

## Sunucu

Sunucu Node.js 20 veya daha yeni bir sürümle çalışır ve yalnızca Node.js'in yerleşik modüllerini kullanır, `package.json` içinde çalışma zamanı bağımlılığı yoktur. Giriş noktası `server.js` ortam değişkenlerini okur ve doğrular, tek dosya olarak çalışıyorsa yanındaki `telsiz.env` dosyasını ortama ekler, `src/app.js` içindeki `createChatServer` ile HTTP sunucusunu kurar ve SIGINT veya SIGTERM geldiğinde bekleyen yazımları bitirip kapanır.

`src/app.js` bütün API uç noktalarını `/api/` altında tanımlar. Yetki her uç noktada sunucu tarafında denetlenir, gövdeler boyut sınırıyla okunur, her alan tür ve uzunluk denetiminden geçer. Hesap ve IP adresi bazında hız sınırları vardır (giriş, kayıt, mesaj, yükleme, yönetim işlemleri, arkadaşlık istekleri, yazıyor bildirimleri, ses sinyalleri ve DJ yazımları). Oturum belirteçleri `X-Token` başlığıyla gönderilir ve diskte yalnızca karmaları tutulur. Ters vekil arkasında istemci adresi yalnızca `GUVENILIR_VEKIL` listesindeki vekillerden gelen başlıklardan okunur.

Statik dosyalar yalnızca bir beyaz listeden sunulur: sabit dosyalar ve `js/`, `css/`, `css/skins/`, `fonts/` klasörlerinde adı belirli bir desene uyan dosyalar. Yol geçişi mümkün değildir. HTML sayfasının içerik güvenliği politikası betik, stil, yazı tipi ve bağlantılar için yalnızca kendi kökenine izin verir, çerçeve olarak yalnızca `https://www.youtube-nocookie.com` adresine izin verir ve sayfanın başka bir sitede çerçeve içinde açılmasını engeller. API yanıtları ve indirilen dosyalar betik çalıştıramayan ayrı politikalarla gönderilir. CORS başlığı yoktur.

API hata metinleri isteğin `Accept-Language` başlığına göre, konsol ve günlük metinleri `DIL` ayarına veya sistemin diline göre Türkçe ya da İngilizcedir (`src/i18n.js`). Tek dosyalık derlemede (`telsiz.exe` ve Linux ikilileri) arayüz dosyaları yürütülebilir dosyanın içine gömülüdür ve aynı beyaz listeyle `src/static-source.js` üzerinden okunur.

## Gerçek zamanlı iletişim

Gerçek zamanlı iletişim yalnızca düz HTTP istekleriyle, long-polling yöntemiyle yapılır. Bunun nedeni, oyun konsolu tarayıcıları gibi ortamlarda WebSocket ve Server-Sent Events desteğinin doğrulanamamasıdır. İstemci `GET /api/poll` isteği gönderir. Sunucu yeni bir şey varsa hemen yanıt verir, yoksa isteği yaklaşık 25 saniye bekletir ve süre dolunca boş yanıt döner.

`src/hub.js` bellekte şunları tutar: çevrimiçi durumu, son olayların halkası, meta sürümü (odalar, üyeler, roller), her kullanıcının kişiye özel meta sürümü (arkadaşlar, istekler, engeller, özel mesaj listesi), yazıyor durumu, ses kadroları ve ses sinyal kuyrukları. Poll isteği istemcinin bildiği sürümleri (`since`, `mv`, `pmv`, `tv`, `muv`, `sig`) ve sunucunun açılış kimliğini (`boot`) taşır. Sunucu yalnızca değişen kısımları gönderir. İstemci çok gerideyse veya sunucu yeniden başlamışsa yanıt bir yeniden eşitleme işareti taşır ve istemci durumu baştan alır.

Her olayın bir hedef kitlesi vardır: ya bütün üyeler ya da yalnızca belirli kullanıcılar. Özel mesaj olayları yalnızca konuşmanın iki üyesine gider, hedef kitlede olmayan bir kullanıcının poll yanıtına hiçbir zaman girmez. Görünmez durumdaki kullanıcı başkalarına çevrimdışı görünür. Engel ilişkisi olan iki kişi birbirinin yazıyor bilgisini görmez.

## Kalıcılık

`src/store.js` bütün verileri veri klasöründe düz dosyalarda tutar.

| Dosya | İçerik ve yazım biçimi |
| --- | --- |
| `state.json` | Hesaplar, oturum karmaları, odalar, roller, davet kodu, arkadaşlıklar, engeller, sunucu ayarları. Geçici dosyaya yazılıp yeniden adlandırılarak atomik yazılır, yazmadan önce geçerli sürüm `state.json.bak` olarak saklanır. Değişiklikler yaklaşık 200 ms toplanıp tek yazımda diske geçer. Güvenlikle ilgili işlemlerin (parola değişikliği ve sıfırlama, çıkış ve oturum kapatma, hesap silme, kişisel ve sunucudan engelleme, rol değişikliği, davet kodu yenileme, etkin grup anahtarı değişikliği) başarı yanıtı ise dosya diske yazılıp zorlandıktan (fsync) sonra gönderilir, aynı anda bekleyen istekler tek yazımı paylaşır. Yazım başarısız olursa istek 500 hatası alır, değişiklik bellekte kalır ve yeniden denemeyle sonradan yazılır. |
| `messages/<kimlik>.jsonl` | Her oda ve özel mesaj konuşması için satır başına bir şifreli mesaj kaydı. Oda başına son 20000 mesaj tutulur. Bütün konuşmalardaki toplam mesaj sayısı `MAKS_TOPLAM_MESAJ` (varsayılan 500000) ile sınırlıdır, aşılınca en çok mesajı olan konuşmaların en eski mesajları silinir ve günlüğe silme kaydı eklenir. Mesaj satırı hemen yazım kuyruğuna alınır, yanıt yazımı beklemez ve satırlar fsync ile diske zorlanmaz. |
| `uploads/<kimlik>.bin` | Şifreli dosyalar ve profil resimleri. Toplam boyut `YUKLEME_KOTASI_MB`, kullanıcı başına boyut `KULLANICI_YUKLEME_KOTASI_MB` ile sınırlıdır, bir mesaja bağlanmayan yüklemeler bir saat sonra silinir. |
| `.kilit` | Çalışan sürecin kilidi. Aynı veri klasörünü ikinci bir sürecin açmasını engeller. |

`state.json` bozuksa sunucu `state.json.bak` dosyasından kurtarmayı dener. Kurtarabilirse bozuk dosyayı önce `state.json.bozuk-<zaman>` adıyla saklar ve durumu günlüğe yazar, kurtaramazsa başlamayı reddeder. Mesaj gövdeleri sunucu için opak zarflardır ve hiçbir zaman günlüğe yazılmaz. Telsiz DJ durumları, çevrimiçi bilgisi, yazıyor bilgisi ve ses kadroları yalnızca bellektedir ve sunucu yeniden başlayınca sıfırlanır.

## İstemci

İstemci `public/` klasöründeki düz betik dosyalarından oluşur. Derleme adımı, paket yöneticisi veya çerçeve yoktur. Eski WebKit tabanlı konsol tarayıcılarıyla uyum için kod en fazla ES2017 sözdizimiyle yazılır ve ağ istekleri `XMLHttpRequest` ile yapılır. Sayfaya yalnızca `createElement` ve `textContent` ile yazılır, HTML dizesinden DOM üretilmez.

`index.html` tek sayfadır. Önce `theme-init.js` temayı ilk çizimden önce uygular, sonra şifreleme kütüphaneleri (`vendor/nacl-fast.min.js`, `vendor/scrypt.js`), sözlükler (`i18n.js`), şifreleme yardımcıları (`crypto.js`), emoji verisi, Telsiz DJ motoru (`music.js`, `dj/youtube.js`), ses motoru (`voice.js`) ve `public/js/01-core.js` ile `24-frekans.js` arasındaki numaralı modüller yüklenir. Modüllerin görev listesi [CONTRIBUTING.md](../CONTRIBUTING.md#proje-yapısı) dosyasındadır.

Arayüz Frekans düzenini kullanır: üst çubuk, odaların istasyon olarak dizildiği frekans bandı, ortada konuşma sütunu, geniş ekranda solda telsiz kartı ve oda bilgisi, sağda yazı ve ses odalarının listesi (İstasyonlar). Üst çubuktaki frekans adı kayıtlı frekanslar (her biri ayrı bir Telsiz sunucusu) arasında geçişi açar (`24-frekans.js`). Ayrıntılar [TASARIM.md](TASARIM.md) dosyasındadır. Service worker (`sw.js`) yalnızca uygulama kabuğunu önbelleğe alır ve `/api/` isteklerine hiçbir zaman dokunmaz.

Cihazda saklanan veriler tarayıcının yerel depolamasındadır: oturum belirteci, grup anahtarlığı (`telsiz.keys`), kişisel kimlik anahtarı, sabitlenmiş kişi anahtarları, tema ve ses ayarları, YouTube onayı. Arama dizini yalnızca oturumun belleğindedir ve diske yazılmaz.

## Şifreleme

Kriptografik ilkel olarak yalnızca TweetNaCl-js 1.0.3 kullanılır: simetrik şifreleme için `secretbox` (XSalsa20-Poly1305), özel mesajlar için `box` (X25519 ile ortak anahtar ve XSalsa20-Poly1305), karma için SHA-512 ve tarayıcının güvenli rastgele sayı üreteci. Paroladan anahtar türetme scrypt-js 3.0.1 ile yapılır. Her iki kütüphane `public/vendor/` altında değiştirilmemiş olarak durur ve denetleyici sha256 değerlerini doğrular.

### Grup anahtarı ve zarflar

Grup anahtarı 16 baytlık rastgele bir sırdır. Kullanıcılara 28 karakterlik bir anahtar kodu olarak gösterilir: Crockford base32 ile 26 veri karakteri ve iki sağlama karakteri, dörderli yedi grup halinde. Kod girilirken büyük ve küçük harf, tireler ve boşluklar fark etmez, sağlama yazım hatalarının büyük bölümünü yakalar. Sırdan alan ayrımlı SHA-512 ile iki değer türetilir: 8 baytlık anahtar kimliği (`kid`) ve 32 baytlık şifreleme anahtarı.

Yazı odası mesajları, profiller, kimlik bağlamaları, ses sinyalleri ve Telsiz DJ durumu aynı zarf biçimini kullanır: `1.<kid>.<nonce>.<şifreli metin>`. Nonce her zarf için 24 rastgele bayttır. Düz metin, içeriği bağlamına bağlayan alanlar taşır, örneğin bir mesajda yazar kimliği ve oda kimliği. İstemci çözdüğü zarfta bu alanları denetler, böylece sunucu bir zarfı başka bir odaya veya başka bir yazara taşıyamaz.

Dosyalar ve resimler her biri kendi rastgele anahtarı ve nonce'u ile şifrelenir. Dosya anahtarı, adı, türü ve boyutları mesajın şifreli düz metninde taşınır, sunucu yalnızca şifreli dosyanın boyutunu görür. GIF dışındaki fotoğraflar yüklenmeden önce canvas ile yeniden kodlanır, bu da konum dahil üst verileri siler.

Yeni bir grup anahtarı oluşturulabilir. Yeni anahtar etkin anahtar olur ve sonraki içerikleri korur, eski anahtarlar eski mesajları okumak için cihazdaki anahtarlıkta kalır. Grup anahtarı davet bağlantısının `#` işaretinden sonraki bölümünde taşınır, tarayıcılar bu bölümü sunucuya göndermez.

### Parola ve hesap

Parola sunucuya hiç gönderilmez. İstemci `scrypt(parola, tuz, N=16384, r=8, p=1)` ile 32 baytlık bir ana değer türetir ve bundan alan ayrımlı SHA-512 ile iki anahtar üretir: sunucuya gönderilen kimlik doğrulama anahtarı (`authKey`) ve hiçbir zaman cihazdan çıkmayan sarma anahtarı (`wrapKey`). Sunucu `authKey` değerini parola eşdeğeri sayar ve onun da scrypt karmasını saklar. Var olmayan bir kullanıcı adı için giriş öncesi uç noktası (`/api/prelogin`) sunucu sırrından türetilen sahte ama tutarlı bir tuz döner, böylece yanıt kullanıcının varlığını ele vermez.

### Kişisel anahtarlar ve özel mesajlar

Her kullanıcının X25519 kimlik anahtar çifti vardır. Özel anahtar `wrapKey` ile sarılmış olarak (`1w.` biçimi) sunucuda saklanır, böylece her cihazda parolayla açılır. Açılan anahtar yalnızca bellekte ve o cihazın yerel depolamasında durur.

Grup anahtarına sahip olmayan bir sunucunun kişisel anahtarları değiştirememesi için her kullanıcı açık anahtarını grup anahtarıyla mühürlenmiş bir kimlik bağlamasıyla yayımlar. İstemci bir kişinin anahtarını yalnızca bu bağlama açılıyorsa, kişi kimliği doğruysa ve anahtar sunucudakiyle aynıysa kullanır. Anahtarlar ilk görüşte sabitlenir. Bilinen anahtar değişirse konuşmada uyarı çıkar ve kullanıcı yeni anahtarı kabul edene kadar gönderme kapalı kalır. İki kişi, kimliklerinden ve açık anahtarlarından türetilen 60 haneli güvenlik numarasını karşılaştırarak birbirini doğrulayabilir.

Özel mesaj zarfı `2.<nonce>.<şifreli metin>` biçimindedir ve iki tarafın anahtarlarından `box.before` ile hesaplanan ortak anahtarla şifrelenir. Sunucu yazı odalarında yalnızca `1.`, özel mesaj konuşmalarında yalnızca `2.` biçimini kabul eder. Grup özel mesajı ve özel sesli arama yoktur.

Bir parola sahip, yönetici veya komut satırı tarafından sıfırlanırsa sunucu kişinin açık anahtarını, sarılmış anahtarını ve kimlik bağlamasını siler. Kişi sonraki girişte yeni bir anahtar çifti üretir ve eski özel mesajlarını artık okuyamaz. Parolasını kendisi değiştiren kişide aynı özel anahtar yeni parolayla yeniden sarılır, özel mesajlar okunmaya devam eder.

## Ses

Ses WebRTC ile tam örgü (full mesh) olarak akar: ses odasındaki her kişi diğer her kişiyle ayrı bir bağlantı kurar ve sesini her birine ayrı gönderir. Ses WebRTC'nin zorunlu şifrelemesiyle (DTLS-SRTP) korunur ve sunucudan geçmez. Bir ses odasına en fazla 8 kişi katılabilir.

Bağlantı kurulumu (SDP teklifleri, yanıtlar ve ICE adayları) `POST /api/voice/signal` ile gönderilir ve alıcının poll yanıtında gelir. Her sinyal grup anahtarıyla şifrelenir ve düz metninde gönderenin ve alıcının eş kimliğini, bağlantı kimliğini ve artan bir sıra numarasını taşır. Alıcı etkin anahtarı, gönderen ve alıcı eşleşmesini ve sıra numarasını denetler, eski veya tekrarlanan sinyalleri atar. Böylece grup anahtarına sahip olmayan bir sunucu bağlantı kurulumunu değiştiremez veya başka birine yönlendiremez. STUN ve TURN adresleri ses odasına katılırken sunucudan gelir.

Mikrofon sesi bir WebAudio hattından geçer. Algılama kolu sesi gecikmesiz ölçer, ses kolu kısa bir ileri bakış gecikmesiyle kapıdan geçer, böylece ses etkinliği modunda hece başları kesilmez. Bas konuş modunda mikrofon yalnızca atanan tuş, fare yan tuşu, oyun kolu düğmesi veya ekrandaki düğme basılıyken açılır. Konuşan kişinin tespiti her cihazda yerel ses seviyesinden yapılır. Mikrofonu kapatma ve sağırlaştırma durumu diğer kişilere gösterilmek üzere sunucuya bildirilir.

## Ekran paylaşımı

Ekran paylaşımı ses bağlantılarının üzerine kurulur. Paylaşan kişi `getDisplayMedia` ile ekran, pencere veya sekme seçer ve odaya şifreli bir paylaşım duyurusu gönderir. Görüntü parçası yalnızca İzle diyen kişilerle olan bağlantılara eklenir. İzleme isteği ve bırakma da şifreli sinyallerdir. Bağlantıya görüntü parçası eklemek veya çıkarmak WebRTC yeniden anlaşmasıyla yapılır.

Paylaşan kişi dört kaliteden birini seçer: 720p 15 kare (varsayılan), 720p 30 kare, 1080p 15 kare ve 1080p 30 kare. Akıcılık veya net metin önceliği tarayıcıya içerik ipucu olarak verilir. Tarayıcı sekme veya sistem sesi sağlıyorsa paylaşım sesi de mikrofondan ayrı bir parça olarak gönderilebilir. Tam örgüde paylaşanın yükleme hızı her izleyici için ayrı kullanılır. Masaüstü uygulamasında tarayıcının seçicisi yerine uygulamanın kendi ekran ve pencere seçicisi açılır.

## Telsiz DJ

Telsiz DJ her ses odası için tek bir müzik oturumu tutar: çalan parça, kuyruk, çalıyor veya duraklatıldı bilgisi ve ortak konumu hesaplamaya yarayan bir çapa (sunucu zamanı ve parça içindeki konum). Bu durumun tamamı grup anahtarıyla şifreli tek bir zarftır. Düz metin oda kimliğine ve müzik bağlamına bağlıdır ve çözüldükten sonra katı biçimde doğrulanır.

Sunucu (`src/music.js`) bu zarfı yalnızca bellekte tutar ve içeriğini göremez. Sunucunun bildiği şey sürüm sayacı, kabul zamanı, zarfın boyutu ve zarfı yazan kullanıcıların kimlikleridir. Yazımlar sürüm karşılaştırmalıdır: istemci beklediği sürümü gönderir, sürüm güncel değilse yazım yapılmaz ve güncel kayıt döner, istemci işlemi yeni durumun üzerine yeniden uygular. Yalnızca o ses odasında bulunan kişiler yazabilir. Boşalan odanın durumu 30 dakika sonra silinir.

Her cihaz müziği kendi oynatıcısında çalar ve konumu çapadan hesaplar. Sapma 1,5 saniyeyi aşarsa konum sessizce düzeltilir. Paylaşılan ses dosyaları mesaj ekleri gibi şifreli yüklemelerdir, cihazda çözülüp çalınır. YouTube parçaları YouTube'un resmi gömülü oynatıcısıyla `youtube-nocookie.com` kökeninden yalıtılmış bir çerçevede çalar. Uygulamanın kendi kökeninde Google kodu çalışmaz, YouTube'un API betikleri yüklenmez. Çerçeve, kişi o cihazda onay vermeden hiçbir zaman yüklenmez, onay Ayarlar > Gizlilik ve güvenlik bölümünden geri alınabilir.

Sunucu sahibi Telsiz DJ'yi kapatırsa sunucu DJ yazımlarını reddeder. YouTube kaynağı kapatılırsa sunucu şifreli durumu göremediği için kısıt üyelerin cihazlarında uygulanır.

## Masaüstü uygulaması

Masaüstü uygulaması (`desktop/`) Electron ile Windows ve Linux için hazırlanır. Web sürümünde arayüz kodu her açılışta sunucudan gelir. Masaüstü uygulamasında ise `public/` klasöründeki dosyalar derleme sırasında uygulamanın içine kopyalanır, her birinin sha256 değeri bir bütünlük bildirimine yazılır ve uygulama açılışta her dosyayı doğrular. Sayfa `telsiz://app/` ayrıcalıklı şemasından yüklenir ve sunucudan hiçbir arayüz dosyası indirilmez.

Sayfanın API istekleri ana süreçteki bir vekilden ayarlardaki sunucuya iletilir. Yalnızca gerekli başlıklar geçer, yönlendirmeler izlenmez, çerez ve önbellek kullanılmaz. Sunucu adresi yalnızca `https://` olabilir, tek istisna aynı bilgisayardaki sunucudur. Pencereler bağlam yalıtımı ve korumalı alan açık olarak çalışır. İzinler yalnızca mikrofon, bildirim ve panoya yazmayla sınırlıdır, ekran yakalama yalnızca uygulamanın kendi seçicisiyle verilir. Alt çerçeve olarak yalnızca Telsiz DJ'nin YouTube oynatıcısına izin verilir: uygulama penceresinin ana çerçevesinin doğrudan alt çerçevesi ve yalnızca `https://www.youtube-nocookie.com` kökeni. Bu çerçevenin içindeki çerçeveler ve diğer bütün alt çerçeveler engellenir. Paketlenmiş uygulamada Electron sigortaları Node.js kipini ve `NODE_OPTIONS` değişkenini kapatır. Ayrıntılı güvenlik mimarisi [desktop/README.md](../desktop/README.md) dosyasındadır.

Güncellemeler (`desktop/src/lib/updates.js`): Windows kurucusu ve Linux AppImage electron-updater ile GitHub sürümündeki `latest.yml` veya `latest-linux.yml` dosyasını okur, yeni sürümü arka planda indirir ve sha512 değeriyle doğrular. Kurulum yalnızca kullanıcı Yeniden başlat ve güncelle dediğinde yapılır. Taşınabilir exe ve .deb yalnızca GitHub API'sinden son kararlı sürümü okur ve sürüm sayfasını açan bir bildirim gösterir. Güncellemeleri otomatik denetle ayarı varsayılan açıktır, kapalıyken GitHub'a hiçbir istek gönderilmez. Sayfa IPC ile hiçbir adres veya dosya yolu veremez, sürüm sayfası yalnızca projenin GitHub sürüm adresleriyle açılır.

## Paketleme ve yayın

| Biçim | Nasıl üretilir |
| --- | --- |
| npm paketi `telsiz` | `package.json` içindeki `files` listesi yalnızca `server.js`, `src/`, `public/`, lisans ve belgeleri içerir. `bin` alanı `telsiz` komutunu `server.js` dosyasına bağlar. Yayın npm trusted publishing (OIDC) ile tokensız ve provenance ile yapılır. |
| Tek dosyalık sunucu | `scripts/sea-derle.js` sunucu kodunu `scripts/paketle.js` ile tek bir CommonJS dosyasında toplar, `public/` dosyalarını varlık olarak gömer ve Node.js tek dosya uygulaması (SEA) olarak derler. Hedefler `windows-x64`, `linux-x64` ve `linux-arm64`. `scripts/sea-duman.js` derlemeyi gerçek bir başlatmayla dener. |
| Docker imajı | `Dockerfile` resmi Node.js 22 Alpine imajını kullanır, yalnızca çalışma zamanı dosyalarını kopyalar ve root olmayan kullanıcıyla çalışır. `ghcr.io/yerlifan/telsiz` olarak linux/amd64 ve linux/arm64 için yayımlanır. |
| Masaüstü paketleri | electron-builder ile Windows NSIS kurucusu ve taşınabilir exe, Linux AppImage ve .deb. Aynı derleme otomatik güncelleme bilgilerini (`latest.yml`, kurucunun `.blockmap` dosyası, `latest-linux.yml`) üretir, electron-builder kendisi hiçbir şey yüklemez (`--publish never`). |

GitHub Actions iş akışları:

| İş akışı | Görevi |
| --- | --- |
| `ci.yml` | Denetleyici ve testler (Ubuntu ve Windows, Node.js 20, 22 ve 24), Chromium ile uçtan uca testler, kabuk betiği denetimi, Docker imajının derlenip çalıştırılması |
| `exe.yml` | Tek dosyalık sunucunun derlenmesi ve duman testi (linux-arm64 için QEMU ile) |
| `desktop.yml` | Masaüstü uygulamasının birim testleri, paketlenmesi ve paketlenmiş derlemenin duman testi |
| `release.yml` | `v` ile başlayan bir etiket gönderilince çalışır: etiketin `package.json` sürümüyle ve CHANGELOG dosyalarıyla uyumunu denetler, testleri çalıştırır, beyaz listedeki dosyaları (otomatik güncelleme bilgileri dahil, adları ve sha512 değerleri denetlenerek) ve birleşik `SHA256SUMS.txt` dosyasını GitHub Release'e ekler, Docker imajını ve npm trusted publishing (OIDC) ile npm paketini yayımlar (`NPM_TOKEN` yalnızca yedektir) |

İş akışlarındaki üçüncü taraf eylemler etiketle değil commit SHA değeriyle sabitlenir. Sürüm notları `scripts/surum-notlari.js` ile iki CHANGELOG dosyasından çıkarılır.

## Sınırlar

Telsiz içerikleri sunucudan gizlemek için tasarlanmıştır, ancak her şeyi gizlemez ve hiçbir yazılım gibi açıksız olduğu garanti edilemez. Proje bağımsız bir güvenlik denetiminden geçmemiştir. Bilinen sınırlar şunlardır.

**Sunucunun gördüğü üst veri.** Sunucu mesaj, dosya, profil ve DJ içeriklerini göremez, ancak şunları görür: hangi kullanıcının ne zaman çevrimiçi olduğu ve durumu (görünmez durumu dahil), kullanıcı adları, oda adları ve oda listesi, roller, kimin hangi odaya ve özel mesaj konuşmasına ne zaman ve hangi boyutta yazdığı, düzenleme ve silme olayları, yüklenen dosyaların boyutları, arkadaşlık ve engelleme ilişkileri, yazıyor bilgisi (kimin hangi konuşmada ne zaman yazdığı), ses odalarında kimin bulunduğu ve mikrofon ile sağırlaştırma durumu, ses sinyallerinin zamanı ve boyutu, hangi ses odalarında Telsiz DJ durumu bulunduğu, DJ zarfının boyutu ve onu kimin ne zaman güncellediği, tarayıcının kullanıcı aracısından türetilen oturum etiketleri (ör. tarayıcı ve işletim sistemi adı) ve bağlanan cihazların IP adresleri. Görünen ad, hakkımda, özel durum metni ve profil resmi şifrelidir.

**Web sürümünde kod teslimi.** Web sürümünde uygulama kodu her açılışta sunucudan gelir. Sunucuyu veya HTTPS bağlantısını sonlandıran bir aracıyı (ters vekil, tünel sağlayıcısı) ele geçiren etkin bir saldırgan değiştirilmiş kod sunarak anahtarları çalabilir. Tarayıcıda çalışan her uçtan uca şifreli uygulamanın bilinen sınırı budur. Masaüstü uygulaması arayüzü kendi içinde taşıdığı için bu riski ortadan kaldırır.

**Grup anahtarı.** Grup anahtarı sunucudaki herkes için ortaktır. Anahtarı bilen herkes, şifreli veriye ulaşabildiği sürece bütün grup içeriğini okuyabilir. İleriye dönük gizlilik yoktur. Gruptan çıkarılan biri eski anahtarı bilmeye devam eder, yeni anahtar yalnızca sonraki içerikleri korur. Davet bağlantısını gören herkes anahtarı öğrenir.

**Özel mesajlar.** Özel mesajlarda da ileriye dönük gizlilik yoktur, aynı kimlik anahtarları uzun süre kullanılır. Grup anahtarına sahip bir üye aynı zamanda sunucuyu da yönetiyorsa veya sunucuyla iş birliği yapıyorsa sahte bir kimlik bağlaması yayımlayabilir. İlk konuşmada anahtar henüz sabitlenmediği için bu ortadaki adam saldırısı fark edilmez. Sonradan yapılan bir değişiklik ilk görüşte sabitleme sayesinde uyarıyla, ilk konuşmadaki saldırı ise ancak güvenlik numarası karşılaştırmasıyla yakalanır. Bu yüzden önemli konuşmalarda güvenlik numarasını başka bir yoldan doğrulayın. Parola sıfırlanınca eski özel mesajlar okunamaz.

**Kötü niyetli bir sunucu ve bütünlük.** Sunucu zarfları açamaz, ancak sakladığı zarfları istediği gibi sunabilir. Mesajın düz metni yazar ve oda kimliğini taşır, ancak mesaj kimliği veya sürüm taşımaz. Bu yüzden kötü niyetli bir sunucu eski bir mesajı yeniden oynatabilir veya çoğaltabilir, mesajları gizleyebilir ve bir düzenlemeyi geri alarak mesajın eski hâlini gösterebilir. Yazı odalarında gönderen imzası yoktur, içerik yalnızca ortak grup anahtarıyla doğrulanır. Grup anahtarına sahip herhangi biri, örneğin sunucuyla iş birliği yapan bir üye, başka bir üyenin adına mesaj üretebilir.

**Anahtar yenileme ve üye çıkarma.** İstemci anahtarlığındaki her anahtarla mühürlenmiş içeriği kabul eder, yalnızca etkin anahtarla mühürlenmişi değil. Gruptan çıkarılan bir üye eski anahtarı bildiği için sunucunun yardımıyla eski anahtarla mühürlenmiş yeni içerik ekleyebilir ve eski anahtarla korunan geçmişi okuyabilir. Bir üye çıkarıldığında sonraki mesajları korumak için yeni bir grup anahtarı oluşturulmalı ve yeni davet bağlantısı yalnızca kalan üyelerle paylaşılmalıdır.

**Cihazda saklanan anahtarlar.** Grup anahtarları, kişisel kimlik anahtarı ve oturum belirteci tarayıcının yerel depolamasındadır. Cihaza veya tarayıcı profiline erişebilen biri bunlara da erişebilir.

**Ses ve ekran paylaşımı.** Ses ve görüntü kişiler arasında doğrudan aktığı için katılımcılar birbirinin IP adresini görebilir. Tam örgüde her kişi sesini ve paylaştığı görüntüyü her alıcıya ayrı gönderir. Bu yüzden yapı küçük gruplar içindir ve ses odası 8 kişiyle sınırlıdır. Varsayılan STUN sunucusu Google'a aittir, ses odasına katılan cihazlar onunla iletişim kurar. TURN yapılandırılırsa kullanıcı adı ve parola sabittir ve ses odasına katılan her oturum açmış kişiye gönderilir.

**Arama.** Arama yalnızca cihazda, sunucudan sayfa sayfa çekilip çözülen geçmiş üzerinde çalışır. Oda başına en fazla 20000 mesaj taranır, anahtarı cihazda olmayan mesajlar aranamaz ve büyük geçmişlerde tarama zaman alır.

**YouTube.** Bir YouTube parçası için onay verildiğinde oynatıcı Google'ın sunucularından yüklenir. Google o cihazın IP adresini ve hangi videonun izlendiğini görür, izleme bilgisi toplayabilir ve reklam gösterebilir. Onay vermeyen kişinin cihazı YouTube'a bağlanmaz. Dosya parçaları için Google'a hiçbir istek gitmez. Sunucu sahibinin YouTube kaynağını kapatması üyelerin cihazlarında uygulanır. DJ durumu şifreli olduğu için sunucu bu kısıtı içerik üzerinde denetleyemez, değiştirilmiş bir istemci kuyruğa yine YouTube parçası ekleyebilir.

**Telsiz DJ yazar bilgisi.** Kuyruktaki "ekleyen" bilgisi sunucunun bildirdiği yazar kayıtlarıyla doğrulanır. Kötü niyetli bir sunucu bu bilgiyi yanlış gösterebilir, ancak parçaların içeriğini değiştiremez.

**Erişilebilirlik ve hizmet.** Sunucu mesajları saklayamaz veya geciktirebilir, hesapları silebilir ve hizmeti durdurabilir. Uçtan uca şifreleme içeriğin gizliliğini korur, sunucunun çalışmaya devam etmesini garanti etmez.

**Kaynak kullanımı.** Yükleme kotası bütün sunucu için ortaktır, kullanıcı başına depolama kotası yoktur. Hız sınırları olsa da oturum açmış bir üye ortak kotayı ve sunucu kaynaklarını tüketebilir. Bu yüzden sunucu güvendiğiniz kişilerle paylaşılmalıdır.

**Paylaşılan dosyalar.** Her türden dosya paylaşılabilir. Sunucu dosyaların içeriğini göremediği için zararlı dosya denetimi yapılamaz.

**İmzasız ikililer.** Tek dosyalık sunucu ve masaüstü uygulaması kod imzalı değildir. Windows SmartScreen ilk açılışta uyarı gösterebilir. Dosyalar sürüm sayfasındaki `SHA256SUMS.txt` ile doğrulanabilir. Docker imajının Node.js taban imajı sürüm etiketiyle seçilir, özet değeriyle (digest) sabitlenmez. npm paketi npm trusted publishing (OIDC) ile, uzun ömürlü token olmadan ve provenance bilgisiyle yayımlanır. linux-arm64 derlemesinde kullanılan Node.js ikilisi nodejs.org'daki `SHASUMS256.txt` ile doğrulanır, GPG imzası denetlenmez. Masaüstü güncellemeleri de imzasızdır: electron-updater paketi sürümdeki `latest.yml` dosyasının sha512 değeriyle doğrular, ancak bu dosya da aynı GitHub sürümündedir. Güncellemenin bütünlüğü bu yüzden GitHub hesabının ve deposunun güvenliğine dayanır, depo sahibi ve yazma yetkisi olanlar iki adımlı doğrulama (2FA) kullanmalıdır. Güncelleme denetimi GitHub'a IP adresini ve uygulama sürümünü gösterir, ayarlardan kapatılabilir. Taşınabilir exe ve .deb kendiliğinden güncellenmez. macOS için tek dosyalık sunucu ve masaüstü paketi yayımlanmaz.

**Ev ağında https olmadan kullanım.** `http://` bağlantısında içerikler yine uçtan uca şifrelidir, ancak oturum bilgisi ağda şifresiz gider ve aynı ağdaki etkin bir saldırgan uygulama kodunu değiştirebilir.
