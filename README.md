# Telsiz

[Türkçe](README.md) | [English](README.en.md)

Telsiz, kendi sunucunuzda çalışan, açık kaynaklı (MIT) ve uçtan uca şifreli bir yazılı ve sesli iletişim uygulamasıdır. Sunucu gruptan bir kişinin bilgisayarında, bir ev sunucusunda veya kiralık bir sunucuda çalışır, herkes tarayıcıdan bağlanır. Bilgisayarda, Mac'te, Linux'ta, Android ve iOS telefonlarda, tabletlerde ve oyun konsollarının tarayıcılarında aynı arayüz açılır. İsteyen kişi Telsiz'i uygulama olarak yükleyebilir veya Windows ve Linux için hazırlanan masaüstü uygulamasını kullanabilir.

Her Telsiz sunucusu bir **frekanstır**: kendi adı, odaları, üyeleri ve şifreleme anahtarı olan bir topluluk. Bir kişi birden çok frekansa katılabilir, katıldığı frekanslar ekranın üstündeki frekans bandında dizilir.

Mesajlar, dosyalar, profiller ve ses bağlantısının kurulum mesajları cihazda şifrelenir. Sunucu bu içerikleri yalnızca şifreli olarak saklar ve iletir. Sunucunun çalışma zamanı bağımlılığı yoktur, Node.js 20 veya daha yeni bir sürümle ya da Node.js gerektirmeyen tek dosyalık sürümle çalışır.

![Telsiz ana görünümü, Arcade teması, koyu mod](docs/img/ana-arcade-koyu.png)

## Özellikler

**Frekans bandı ve odalar.** Telsiz bir radyo kadranı gibi düzenlenir. Katıldığınız frekanslar ekranın üstündeki yatay frekans bandında birer istasyon olarak durur. Açık frekansı bandın üstündeki ibre gösterir, başka bir istasyona basmak veya ibreyi fareyle ya da parmakla sürükleyip bırakmak o frekansa geçer. Her istasyonda frekansın durumu (açık, çevrimiçi, çevrimdışı, giriş gerekli) ile okunmamış ve anma sayıları görünür. Açık frekansın yazı ve ses odaları sağ sütundaki İstasyonlar listesindedir: okunmamış ve anma rozetleri, ses odasındaki kişi sayısı ve odanın altında odadaki kişiler (avatar, ad, susturma ve kamera simgesi, konuşan kişinin halkası), konuşan göstergesi ve Telsiz DJ notası, oda yönetme izni olanlar için Oda ekle düğmesi. Telsiz DJ çalarken liste sağ sütunun üstünde kalır, DJ kartı listenin altına yerleşir. Dar ekranda ve telefonda liste üst çubuktaki İstasyonlar düğmesiyle açılır. Geniş ekranda sol sütunun en altında telsiz kartı, onun üstünde Bildirimler listesi, ortada geniş konuşma sütunu durur. Bildirimler listesinde bulunduğunuz ses odasında başlayan ekran paylaşımları İzle düğmesiyle, ses odalarına katılanlar ve ayrılanlar da kısa birer satırla görünür. Üst çubuğun solunda frekans adı ve hemen sağında Çevrimiçi düğmesi, tam ortasında Ara, sağında Özel mesajlar ve Arkadaşlar düğmeleri ile avatar menüsü bulunur. Profil, durum ve ayarlar avatar menüsündedir. Bandın sonundaki ? düğmesi frekans değiştirme rehberini açar.

**Birden çok frekans.** Bandın + düğmesi yeni bir frekans adresi ekler (`https://` veya bu bilgisayardaki sunucu için `http://localhost`), Tümü düğmesi frekansları durumları ve sayılarıyla bir sayfada listeler, oradan listeden çıkarılabilirler. Üst çubuğun solundaki frekans adı açık frekansın bilgisini ve ayar kısayollarını gösterir. Masaüstü uygulamasında her frekansın girişi ayrı saklanır, geçiş aynı pencerede olur ve en son kullanılan 8 frekansa arka planda bağlı kalınarak okunmamış sayıları ve anmaları gösterilir. Tarayıcıda her frekans ayrı bir sitedir: liste o tarayıcıda tutulur, başka frekansa geçince sekme o adrese gider ve liste adresin `#` bölümünde (yalnızca adresler ve adlar, anahtar yok) karşı frekansa taşınır. Tarayıcıda açık olmayan frekansların durumu, bildirimleri ve okunmamış sayıları gösterilmez. Geçişte ses bağlantısı kesilir (ses odasındayken önce sorulur), liste cihazlar arasında eşitlenmez.

**Uçtan uca şifreli yazışma.** Yazı odalarındaki mesajlar, fotoğraflar ve dosyalar grup anahtarıyla, özel mesajlar ise iki kişinin kişisel anahtarlarıyla şifrelenir. GIF dışındaki fotoğraflar gönderilmeden önce cihazda yeniden kodlanır, böylece konum bilgisi dahil üst veriler silinir. Bir mesaja en fazla 10 dosya eklenebilir, bir dosya varsayılan olarak 25 MB'a kadar olabilir. Mesajlar düzenlenip silinebilir, emoji seçici, @ ile anma ve yazıyor göstergesi vardır. Özel mesajlarda karşı tarafın anahtarı güvenlik numarasıyla doğrulanabilir.

**Arkadaşlar ve özel mesajlar.** Kullanıcılar birbirine kullanıcı adıyla arkadaşlık isteği gönderebilir, kabul edebilir ve engelleyebilir. Engellenen kişinin yazı odalarındaki mesajları katlanır ve sesi sizin tarafınızda kısılır.

**Sesli sohbet.** Ses, kişiler arasında WebRTC ile doğrudan akar ve sunucudan geçmez. Ses etkinliği algılama (otomatik veya elle ayarlanan eşikle) ve bas konuş arasında seçim yapılır. Bu seçim mikrofon düğmesine sağ tıklayınca (klavyede Shift+F10) açılan küçük menüden de yapılabilir. Bas konuş, mikrofonu kapatma ve sağırlaştırma için klavye tuşu, fare yan tuşu veya oyun kolu düğmesi atanabilir. Ses odasına bağlanınca bir el telsizini andıran telsiz kartı açılır: odadakiler, konuşanın halesi, büyük Bas konuş düğmesi ve iki satırda, her biri kendi renginde düğmeler (üstte Kamera, Mikrofon ve Sağırlaştır, altta Ekran ve Ayrıl, telefonda tek satırda yalnızca simgeler). Kişi bazında ses seviyesi %0 ile %200 arasında ayarlanabilir, %100'ün üstü o kişinin sesini cihazda yükseltir. Yükseltilmiş ses tarayıcının ses bağlamından çaldığı için Chromium'un yankı engellemesi bu sesi hesaba katmayabilir, hoparlörle kullanırken karşı tarafa yankı gidebilir, kulaklıkla bu sorun olmaz. Ses odasına biri katılınca veya ayrılınca, biri ekran yayını başlatınca, özel mesaj veya arkadaşlık isteği gelince ve ses odasından düşünce her biri kendine özgü, 2 saniyelik bir bildirim sesi çalar. Sesler dosyadan çalınmaz, cihazda sentezlenir. Düzeyleri Ayarlar > Bildirimler'deki kaydırıcıyla ayarlanır (varsayılan %40), aynı yerde her ses dinlenebilir. Gelişmiş gürültü engelleme (RNNoise) klavye tıkırtısı gibi konuşma dışı sesleri karşı tarafa gitmeden cihazda bastırır, varsayılan olarak açıktır. Bir ses odasına varsayılan olarak en fazla 8 kişi katılabilir, frekansın sahibi bu sınırı Ayarlar > Genel bölümünden 2 ile 12 kişi arasında değiştirebilir.

**Ekran paylaşımı.** Ses odasındaki herkes ekranını, bir pencereyi veya bir sekmeyi paylaşabilir. Paylaşım başlayınca aynı ses odasındakilerin Bildirimler listesinde İzle düğmesiyle görünür, telsiz kartının kadrosunda paylaşan kişinin üstüne gelince de Yayına katıl düğmesi çıkar (dokunmatik ekranda her zaman görünür). Görüntü yalnızca izlemeye başlayan kişilere gönderilir. Paylaşan kişi akıcılık veya net metin önceliğini, 720p ve 1080p arasında çözünürlüğü, 15 veya 30 kare hızını seçer. Sesin paylaşılıp paylaşılmayacağı yalnızca kaynağın seçildiği pencerede seçilir (tarayıcının seçicisi, masaüstü uygulamasında uygulamanın seçicisi). Ses, Telsiz'in kendi seslerini dışarıda bırakan `restrictOwnAudio` kısıtıyla istenir: masaüstü uygulaması ve bunu destekleyen tarayıcılar Telsiz'de çalan konuşmaları, bildirim seslerini ve Telsiz DJ'yi paylaşılan sesten çıkarır. Bu ayrımı desteklemeyen eski Windows sürümlerinde bütün sistem sesi paylaşılır.

**Kamera.** Ses odasındaki herkes telsiz kartındaki Kamera düğmesiyle kendi kamerasını açabilir, kamera varsayılan olarak kapalıdır ve düğmeye basılmadan istenmez. Görüntü 640x360 ve 15 kare olarak, ses gibi kişiler arasında doğrudan ve WebRTC'nin DTLS-SRTP şifrelemesiyle gider, Telsiz sunucusu görüntüyü görmez. Kamerası açık kişinin kadrodaki avatarı aynı yumuşak kare biçimde canlı görüntüye döner, kendi görüntünüz aynalıdır ve kameranız açıkken telsiz kartında her zaman görünen bir gösterge durur. Kadronun altındaki Büyüt düğmesi açık kamera sayısını gösterir ve kameraları büyük bir ızgarada açar. Izgarada Sığdır ile Doldur arasında seçim yapılır (varsayılan Doldur, seçim ekran paylaşımından ayrı saklanır). Izgara açıkken sağ sütundaki İstasyonlar yerinde kalır ve son mesajlar ızgaranın altında açık durur. Sahip kameraları kapatabilir ve bir ses odasında aynı anda açık olabilecek kamera sayısını (varsayılan 4) belirler. Ses odasını denetleme izni olan biri, alt sıradaki birinin açık kamerasını kişi ses kartından veya profil kartından kapatabilir. Kapatma tek seferliktir, kişi kamerasını yeniden açabilir. Tam örgüde kamerası açık olan herkes görüntüsünü odadaki diğer her kişiye ayrı gönderir, bu yüzden kişi ve kamera sayısı arttıkça üyelerin yükleme hızı yetmeyebilir.

**Sunucu bilgileri ve kapasite önerisi.** Sahip ve yöneticiler Ayarlar > Genel bölümünde sunucunun işlemcisini, yük ortalamasını, belleğini, veri klasörünün diskini, kullanım bilgilerini ve TURN durumunu görür. Üyelerin tipik yükleme hızından ses odası kapasitesi ve kamera sınırı için açıkça tahmin olduğu belirtilen bir öneri ve sunucu bilgilerinden ipuçları hesaplanır, Öneriyi uygula düğmesi değerleri forma yazar.

**Telsiz DJ.** Ses odalarında yerleşik bir müzik botu vardır. Yazma alanına `/çal` ve bir YouTube bağlantısı yazmak veya mesajdaki bir ses dosyasında "DJ'de çal" düğmesine basmak parçayı kuyruğa ekler. Herkes parçayı aynı anda kendi cihazında dinler. YouTube parçaları YouTube'un resmi gömülü oynatıcısıyla ve yalnızca kişi bu cihazda onay verdikten sonra yüklenir. Paylaşılan ses dosyaları onaysız çalar. Frekansın sahibi Telsiz DJ'yi veya yalnızca YouTube kaynağını kapatabilir.

**Cihazda arama.** Mesajlarda arama tamamen cihazda yapılır. Sunucu aranan metni ve mesaj içeriğini görmez.

**Frekans tanıtımı.** Oturum açmamış biri frekansın adresini açınca önce tanıtım sayfasını görür: frekans adı, sahibin Ayarlar > Genel bölümünden yazdığı herkese açık tanıtım metni, Telsiz'in kısa anlatımı, masaüstü uygulamasını indirme bağlantısı ve kendi frekansını kurmak için adım adım rehber. Davet bağlantısıyla gelenler doğrudan kayıt formuna geçer.

**Frekans fotoğrafı.** Her frekansın kendi fotoğrafı olabilir. Sahip Ayarlar > Genel bölümünden bir resim seçer, resim ortasından kare kırpılıp 256x256 boyutuna küçültülür. Fotoğraf üst çubuktaki frekans düğmesinde, frekans bandında, Frekanslar sayfasında, giriş ekranında ve tanıtım sayfasında baş harfin yerine görünür. Masaüstü uygulamasında bantta diğer frekansların fotoğrafları da görünür. Frekans fotoğrafı frekans adı gibi herkese açıktır ve şifrelenmez.

**Görünüm.** Üç tema vardır: Arcade, Gece Frekansı ve Turkuaz ve Bakır. Her birinin koyu ve açık modu vardır, mod istenirse sistem ayarını izler. Avatarlar her temada yumuşak kenarlı karedir. Yazı boyutu (varsayılan Normal, 15 piksel), kompakt mesaj görünümü ve hareketi azaltma seçenekleri vardır. Yazı boyutu Ayarlar > Görünüm bölümündeki Özel boyut kaydırıcısıyla 12 ile 28 piksel arasında elle de ayarlanabilir. Arayüz Türkçe ve İngilizcedir.

**Her cihazda.** Arayüz fare, klavye, dokunmatik ekran ve oyun kolu ile kullanılabilir. Televizyon genişliğinde (1800 piksel ve üstü) yazılar ve odak halkası büyür, oyun kolu algılanınca altta kontrolcü ipucu çubuğu görünür. Telsiz telefon, tablet ve bilgisayara uygulama olarak (PWA) yüklenebilir.

**Kurulum seçenekleri.** npm paketi (`npx telsiz`), Windows ve Linux için Node.js gerektirmeyen tek dosyalık sunucu, GitHub Container Registry üzerinde Docker imajı, Windows ve Linux için masaüstü uygulaması ve depodan başlatma betikleri.

## Ekran görüntüleri

| | |
| --- | --- |
| ![Gece Frekansı teması, açık mod](docs/img/ana-gece-acik.png) | ![Turkuaz ve Bakır teması, koyu mod](docs/img/ana-turkuaz-koyu.png) |
| Gece Frekansı, açık mod | Turkuaz ve Bakır, koyu mod |
| ![Ses odasında telsiz kartı](docs/img/telsiz-karti.png) | ![Tam ekran ayarlar](docs/img/ayarlar.png) |
| Ses odasında telsiz kartı | Tam ekran ayarlar |
| ![İngilizce arayüz](docs/img/ingilizce.png) | ![Telefon görünümü](docs/img/telefon.png) |
| İngilizce arayüz | Telefon görünümü |

## Hızlı başlangıç

Hangi yolu seçerseniz seçin, sunucu ilk açılışta konsola tek kullanımlık bir kurulum kodu yazar. Ardından tarayıcıda sunucunun adresini açıp bu kodla sahip hesabını oluşturursunuz (bkz. [İlk kurulum ve davet](#ilk-kurulum-ve-davet)). Sunucu varsayılan olarak 3000 numaralı bağlantı noktasını dinler, sunucunun çalıştığı bilgisayardaki adres `http://localhost:3000` olur. Ayrıntılı kurulum anlatımı [docs/KURULUM.md](docs/KURULUM.md) dosyasındadır.

### npm ile

Node.js 20 veya daha yeni bir sürüm gerekir.

```sh
npx telsiz
```

Kalıcı kurulum için `npm install -g telsiz` komutundan sonra `telsiz` komutunu çalıştırın. Veriler komutun çalıştırıldığı klasördeki `veri` klasörüne yazılır, bu yüzden komutu her seferinde aynı klasörde çalıştırın veya `VERI_KLASORU` ayarıyla sabit bir klasör verin.

### Windows için tek dosya

1. [Sürümler](https://github.com/Yerlifan/telsiz/releases) sayfasından `telsiz-<sürüm>-server-windows-x64.exe` dosyasını indirin.
2. Dosyayı kendine ait boş bir klasöre koyun.
3. Dosyaya çift tıklayın. Windows SmartScreen uyarı gösterirse "Ek bilgi" ve ardından "Yine de çalıştır" seçeneğini kullanın.

Veriler dosyanın yanındaki `veri` klasörüne yazılır. Ayarlar dosyanın yanına koyacağınız `telsiz.env` dosyasından okunur. Sunucu çalıştığı sürece pencere açık kalmalıdır.

### Linux için tek dosya

x64 ve arm64 (ör. Raspberry Pi) için ayrı dosyalar yayımlanır.

```sh
chmod +x telsiz-<sürüm>-server-linux-x64
./telsiz-<sürüm>-server-linux-x64
```

### Depodan çalıştırma

Node.js 20 veya daha yeni bir sürüm gerekir.

```sh
git clone https://github.com/Yerlifan/telsiz.git
cd telsiz
./baslat.sh
```

Windows'ta depoyu indirdikten sonra `baslat.bat` dosyasına çift tıklayın. macOS'ta `baslat.sh` kullanılır.

### Docker ile

```sh
docker run -d --name telsiz -p 127.0.0.1:3000:3000 -v telsiz-veri:/data ghcr.io/yerlifan/telsiz:latest
docker logs telsiz
```

İkinci komut kurulum kodunu gösterir. Depodaki [deploy/docker-compose.yml](deploy/docker-compose.yml) dosyası Telsiz'i isteğe bağlı olarak otomatik HTTPS sağlayan Caddy ile birlikte başlatır.

### Masaüstü uygulaması

Sürümler sayfasında Windows için kurucu (`Telsiz-Kurulum-<sürüm>.exe`) ve taşınabilir sürüm (`Telsiz-<sürüm>-tasinabilir.exe`), Linux için AppImage ve .deb paketi yayımlanır. Masaüstü uygulaması bir sunucu değil, istemcidir. Arayüz uygulamanın içinde gelir ve sunucudan indirilmez. Kurucu ve AppImage yeni sürümü arka planda indirir ve siz Yeniden başlat ve güncelle deyince kurar, taşınabilir sürüm ve .deb yalnızca yeni sürümü bildirir. Denetim GitHub'a bağlanır ve Ayarlar > Uygulama bölümünden kapatılabilir. Ayrıntılar [desktop/README.md](desktop/README.md) dosyasındadır.

## İlk kurulum ve davet

1. Sunucuyu başlatın ve konsolda çerçeve içinde gösterilen kurulum kodunu not edin.
2. Tarayıcıda sunucunun adresini açın.
3. Kurulum ekranında kurulum kodunu, kullanıcı adınızı ve parolanızı girin. Bu hesap frekansın (bu sunucunun) sahibi olur.
4. Telsiz grup için bir şifreleme anahtarı oluşturur ve davet ekranını gösterir. Davet bağlantısını kopyalayıp arkadaşlarınızla paylaşın.

Davet bağlantısı davet kodunu ve şifreleme anahtarını adresin `#` işaretinden sonraki bölümünde taşır. Tarayıcılar bu bölümü sunucuya göndermez, ancak bağlantıyı gören herkes anahtarı da öğrenir. Bu yüzden bağlantıyı yalnızca güvendiğiniz kanallardan paylaşın. Anahtar kodu istenirse elle de yazılabilir. Davet kodu daha sonra Ayarlar > Davet bölümünden yenilenebilir.

Sahip ve yöneticiler odaları Ayarlar > Odalar bölümünden, üyeleri Ayarlar > Üyeler bölümünden yönetir. Sahip Ayarlar > Roller bölümünden moderatör gibi özel roller oluşturup mesaj silme, engelleme, ses odası denetimi, oda yönetimi ve Telsiz DJ izinlerini tek tek verebilir. Engelleme izni, alt sıradaki bir üyeyi Ayarlar > Üyeler bölümündeki Frekanstan at düğmesiyle atmayı da kapsar: kişinin hesabı silinir, oturumları kapanır, mesajları kalır ve kişi ancak davet koduyla yeniden kayıt olarak dönebilir. Sahip hiçbir zaman atılamaz. Ses odası denetimi izni, alt sıradaki birini herkes için susturmayı, kamerasını kapatmayı ve ses odasından çıkarmayı kapsar. Frekans adı ile Telsiz DJ, YouTube kaynağı ve DJ kısıtlı kipi anahtarları Ayarlar > Genel bölümündedir ve yalnızca sahip tarafından değiştirilir.

## HTTPS ve internete açma

Tarayıcılar mikrofona ve ekran yakalamaya yalnızca güvenli adreslerde izin verir. Bu yüzden sesli sohbet, ekran paylaşımı ve uygulama olarak yükleme `https://` ile başlayan bir adres veya sunucunun çalıştığı bilgisayardaki `http://localhost` adresi gerektirir. Ev ağındaki `http://192.168...` gibi bir adreste yazışma çalışır, ancak ses çalışmaz.

İnternetteki arkadaşlar için üç yol vardır. Depoda bulunan `tunel.bat` (Windows) ve `tunel.sh` (Linux ve macOS) betikleri, hesap gerektirmeyen Cloudflare hızlı tüneliyle geçici bir https adresi açar. Bu adres her çalıştırmada değişir. Kalıcı bir adres için kendi alan adınızla [deploy/Caddyfile](deploy/Caddyfile) veya [deploy/nginx.conf](deploy/nginx.conf) örneğindeki gibi bir ters vekil kullanabilirsiniz. Docker Compose örneği Caddy'yi hazır olarak içerir. Ayrıntılar [docs/KURULUM.md](docs/KURULUM.md) dosyasındadır.

## Cihazlar

**Telefon, tablet ve bilgisayar.** Telsiz https adresinden açıldığında uygulama olarak yüklenebilir. Destekleyen tarayıcılarda Ayarlar > Uygulama bölümünde "Uygulamayı yükle" düğmesi görünür. iPhone ve iPad'de Safari'nin Paylaş menüsündeki "Ana Ekrana Ekle" seçeneği kullanılır. Yüklenen uygulama yüklendiği adrese bağlıdır.

**Masaüstü uygulaması.** Windows ve Linux için hazırlanan masaüstü uygulaması arayüzü kendi içinde taşır ve açılışta dosyaların bütünlüğünü doğrular. Birden çok frekansı (adres ve giriş) hatırlar, aralarında aynı pencerede geçer ve açık olmayan frekansların okunmamış sayılarını arka planda sayar. Mikrofonu aç veya kapat, sağırlaştır ve uygulama arka plandayken de çalışan bas konuş (bas aç, bas kapat veya isteğe bağlı tuş kancasıyla basılı tut) için genel kısayollar ile sistem tepsisine küçültme seçeneği sunar.

**Televizyon ve oyun konsolları.** Arayüz geniş ekranda büyük yazı ve büyük düğmelerle açılır, yön tuşlarıyla gezilebilir. PS5'in resmi bir tarayıcı uygulaması yoktur ve konsol tarayıcılarında sesli sohbetin çalıştığı doğrulanmamıştır. Konsol başındaki kişi sesli sohbete aynı hesapla telefonundan katılabilir.

## Güvenlik özeti

Parola sunucuya hiç gönderilmez. Tarayıcı paroladan scrypt ile bir kimlik doğrulama anahtarı ve ayrı bir sarma anahtarı türetir. Grup içeriği TweetNaCl-js ile XSalsa20-Poly1305 kullanılarak, özel mesajlar X25519 ile kurulan ortak anahtarla şifrelenir. Sunucu her istekte yetkiyi denetler, girdileri doğrular, hız sınırları ve katı bir içerik güvenliği politikası uygular.

Uçtan uca şifreleme her şeyi gizlemez. Sunucu kimin çevrimiçi olduğunu, kimin hangi odada ve ses odasında bulunduğunu, mesajların zamanını ve boyutunu, oda adlarını, kullanıcı adlarını ve yazıyor bilgisini görür. Web sürümünde uygulama kodu sunucudan geldiği için sunucuyu ele geçiren etkin bir saldırgan değiştirilmiş kod sunabilir. Grup anahtarında ileriye dönük gizlilik yoktur. Sesli ve görüntülü sohbette kişiler birbirinin IP adresini görebilir. Proje bağımsız bir güvenlik denetiminden geçmemiştir. Sınırların tam listesi [docs/MIMARI.md](docs/MIMARI.md#sınırlar) dosyasında, güvenlik açığı bildirme yolu [SECURITY.md](SECURITY.md) dosyasındadır.

## Ayarlar

Sunucu ortam değişkenleriyle ayarlanır. Her ayarın Türkçe adı ve İngilizce takma adı vardır, ikisi birden verilirse Türkçe ad geçerlidir. Tek dosyalık sunucu aynı ayarları yanındaki `telsiz.env` dosyasından da okur (her satırda `AD=değer`), ortam değişkenleri bu dosyadan önceliklidir.

| Ayar | Varsayılan | Açıklama |
| --- | --- | --- |
| `PORT` | `3000` | Dinlenen bağlantı noktası. Değiştirirseniz tünel betiğine de aynı değeri verin. |
| `HOST` | `0.0.0.0` | Dinlenen adres. Yalnızca bu bilgisayardan erişim için `127.0.0.1`. |
| `SUNUCU_ADI` (`SERVER_NAME`) | `Telsiz` | Yalnızca ilk kurulumda kullanılan başlangıç adı, en fazla 40 karakter. Sonra Ayarlar > Genel bölümünden değiştirilir. |
| `VERI_KLASORU` (`DATA_DIR`) | çalışma klasöründeki `veri` | Verilerin yazıldığı klasör. Tek dosyalık sunucuda dosyanın yanındaki `veri` klasörüdür. |
| `MAKS_YUKLEME_MB` (`MAX_UPLOAD_MB`) | `25` | Tek bir dosyanın en büyük boyutu (MB), en fazla 1024. |
| `YUKLEME_KOTASI_MB` (`UPLOAD_QUOTA_MB`) | `2048` | Tüm yüklemelerin toplam üst sınırı (MB). |
| `KULLANICI_YUKLEME_KOTASI_MB` (`USER_UPLOAD_QUOTA_MB`) | `512` | Bir kullanıcının kayıtlı yüklemelerinin toplam üst sınırı (MB). |
| `MAKS_TOPLAM_MESAJ` (`MAX_TOTAL_MESSAGES`) | `500000` | Bütün konuşmalarda saklanan toplam mesaj sınırı. Aşılınca en büyük konuşmaların en eski mesajları silinir. |
| `STUN_URL` | `stun:stun.l.google.com:19302` | Virgülle ayrılmış STUN adresleri. Boş bırakılırsa STUN kullanılmaz. |
| `TURN_URL` | boş | Virgülle ayrılmış TURN adresleri (`turn:` veya `turns:`). Bazı ağlarda ses için gerekir. |
| `TURN_KULLANICI` (`TURN_USERNAME`) | boş | TURN kullanıcı adı. |
| `TURN_SIFRE` (`TURN_PASSWORD`) | boş | TURN parolası. |
| `GUVENILIR_VEKIL` (`TRUSTED_PROXY`) | `loopback` | `X-Forwarded-For` ve `CF-Connecting-IP` başlıklarına güvenilen vekil adresleri: `loopback`, `none`, IP adresleri veya CIDR blokları, virgülle ayrılmış. |
| `DIL` (`TELSIZ_LANG`) | sistem dili | Konsol metinlerinin dili: `tr` veya `en`. |

Sahip parolasını unutursa sunucu durdurulduktan sonra `sifre-sifirla <kullanıcı adı>` (İngilizcesi `reset-password`) komutu geçici bir parola üretir, örneğin `npx telsiz sifre-sifirla deniz` veya `node server.js sifre-sifirla deniz`. Bu işlem kişinin güvenlik anahtarını sıfırlar, eski özel mesajları artık okunamaz.

## Belgeler

| Belge | İçerik |
| --- | --- |
| [docs/KURULUM.md](docs/KURULUM.md) | Kendi sunucunuzda kurulum: npm, tek dosya, Docker, ters vekil, tünel, TURN, yedekleme ve güncelleme |
| [docs/MIMARI.md](docs/MIMARI.md) | Sunucu, istemci, şifreleme, ses, ekran paylaşımı, Telsiz DJ, masaüstü uygulaması ve sınırlar |
| [docs/TASARIM.md](docs/TASARIM.md) | Frekans düzeni, tasarım belirteçleri, temalar ve erişilebilirlik |
| [desktop/README.md](desktop/README.md) | Masaüstü uygulamasının güvenlik mimarisi ve geliştirme komutları |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Katkıda bulunma rehberi ve kod kuralları |
| [SECURITY.md](SECURITY.md) | Güvenlik politikası ve açık bildirme |
| [CHANGELOG.md](CHANGELOG.md) | Sürüm notları |

## Katkı ve lisans

Hata bildirimleri, gerçek cihazlardan deneme sonuçları, çeviri düzeltmeleri ve kod katkıları memnuniyetle karşılanır. Başlamadan önce [CONTRIBUTING.md](CONTRIBUTING.md) dosyasını okuyun.

Telsiz, Burak Aslancan Pak tarafından geliştirilmiştir ve [MIT lisansı](LICENSE) ile dağıtılır. `public/vendor/` altındaki TweetNaCl-js (Unlicense), scrypt-js (MIT) ve RNNoise'un WebAssembly derlemesi (`@shiguredo/rnnoise-wasm` 2022.2.0, RNNoise BSD-3-Clause, paket Apache-2.0) kendi lisanslarıyla dağıtılır. Yazı tipleri SIL Open Font License ile lisanslıdır, lisans metinleri `public/fonts/` klasöründedir.
