# Telsiz

[Türkçe](README.md) | [English](README.en.md)

Telsiz, kendi sunucunuzda çalışan, açık kaynaklı (MIT) ve uçtan uca şifreli bir yazılı ve sesli iletişim uygulamasıdır. Sunucu gruptan bir kişinin bilgisayarında, bir ev sunucusunda veya kiralık bir sunucuda çalışır, herkes tarayıcıdan bağlanır. Bilgisayarda, Mac'te, Linux'ta, Android ve iOS telefonlarda, tabletlerde ve oyun konsollarının tarayıcılarında aynı arayüz açılır. İsteyen kişi Telsiz'i uygulama olarak yükleyebilir veya Windows ve Linux için hazırlanan masaüstü uygulamasını kullanabilir.

Mesajlar, dosyalar, profiller ve ses bağlantısının kurulum mesajları cihazda şifrelenir. Sunucu bu içerikleri yalnızca şifreli olarak saklar ve iletir. Sunucunun çalışma zamanı bağımlılığı yoktur, Node.js 20 veya daha yeni bir sürümle ya da Node.js gerektirmeyen tek dosyalık sürümle çalışır.

![Telsiz ana görünümü, Arcade teması, koyu mod](docs/img/ana-arcade-koyu.png)

## Özellikler

**Odalar ve frekans bandı.** Telsiz bir radyo kadranı gibi düzenlenir. Yazı odaları ve ses odaları ekranın üstündeki yatay frekans bandında birer istasyon olarak durur. Açık olan konuşmayı bandın üstündeki ibre gösterir, ibre fareyle veya parmakla sürüklenip bırakıldığında en yakın istasyona oturur. Okunmamış mesajlar ve anmalar istasyonların köşesinde rozet olarak görünür, içinde konuşan olan ses odası nabız gibi atar. Özel mesajlar ve arkadaşlar bandın solundaki Kişisel grupta, profil, durum ve ayarlar sağ üstteki avatar menüsündedir.

**Uçtan uca şifreli yazışma.** Yazı odalarındaki mesajlar, fotoğraflar ve dosyalar grup anahtarıyla, özel mesajlar ise iki kişinin kişisel anahtarlarıyla şifrelenir. GIF dışındaki fotoğraflar gönderilmeden önce cihazda yeniden kodlanır, böylece konum bilgisi dahil üst veriler silinir. Bir mesaja en fazla 10 dosya eklenebilir, bir dosya varsayılan olarak 25 MB'a kadar olabilir. Mesajlar düzenlenip silinebilir, emoji seçici, @ ile anma ve yazıyor göstergesi vardır. Özel mesajlarda karşı tarafın anahtarı güvenlik numarasıyla doğrulanabilir.

**Arkadaşlar ve özel mesajlar.** Kullanıcılar birbirine kullanıcı adıyla arkadaşlık isteği gönderebilir, kabul edebilir ve engelleyebilir. Engellenen kişinin yazı odalarındaki mesajları katlanır ve sesi sizin tarafınızda kısılır.

**Sesli sohbet.** Ses, kişiler arasında WebRTC ile doğrudan akar ve sunucudan geçmez. Ses etkinliği algılama (otomatik veya elle ayarlanan eşikle) ve bas konuş arasında seçim yapılır. Bas konuş, mikrofonu kapatma ve sağırlaştırma için klavye tuşu, fare yan tuşu veya oyun kolu düğmesi atanabilir. Ses odasına bağlanınca bir el telsizini andıran telsiz kartı açılır: odadakiler, konuşanın halesi, büyük Bas konuş düğmesi, mikrofon, sağırlaştırma, ekran paylaşımı ve ayrılma düğmeleri. Kişi bazında ses seviyesi ayarlanabilir. Bir ses odasına en fazla 8 kişi katılabilir.

**Ekran paylaşımı.** Ses odasındaki herkes ekranını, bir pencereyi veya bir sekmeyi paylaşabilir. Görüntü yalnızca İzle düğmesine basan kişilere gönderilir. Paylaşan kişi akıcılık veya net metin önceliğini, 720p ve 1080p arasında çözünürlüğü, 15 veya 30 kare hızını ve isteğe bağlı olarak sesi seçer.

**Telsiz DJ.** Ses odalarında yerleşik bir müzik botu vardır. Yazma alanına `/çal` ve bir YouTube bağlantısı yazmak veya mesajdaki bir ses dosyasında "DJ'de çal" düğmesine basmak parçayı kuyruğa ekler. Herkes parçayı aynı anda kendi cihazında dinler. YouTube parçaları YouTube'un resmi gömülü oynatıcısıyla ve yalnızca kişi bu cihazda onay verdikten sonra yüklenir. Paylaşılan ses dosyaları onaysız çalar. Sunucu sahibi Telsiz DJ'yi veya yalnızca YouTube kaynağını kapatabilir.

**Cihazda arama.** Mesajlarda arama tamamen cihazda yapılır. Sunucu aranan metni ve mesaj içeriğini görmez.

**Görünüm.** Üç tema vardır: Arcade, Gece Frekansı ve Turkuaz ve Bakır. Her birinin koyu ve açık modu vardır, mod istenirse sistem ayarını izler. Avatarlar her temada yumuşak kenarlı karedir. Yazı boyutu, kompakt mesaj görünümü ve hareketi azaltma seçenekleri vardır. Arayüz Türkçe ve İngilizcedir.

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

1. [Sürümler](https://github.com/Yerlifan/telsiz/releases) sayfasından `telsiz-<sürüm>-windows-x64.exe` dosyasını indirin.
2. Dosyayı kendine ait boş bir klasöre koyun.
3. Dosyaya çift tıklayın. Windows SmartScreen uyarı gösterirse "Ek bilgi" ve ardından "Yine de çalıştır" seçeneğini kullanın.

Veriler dosyanın yanındaki `veri` klasörüne yazılır. Ayarlar dosyanın yanına koyacağınız `telsiz.env` dosyasından okunur. Sunucu çalıştığı sürece pencere açık kalmalıdır.

### Linux için tek dosya

x64 ve arm64 (ör. Raspberry Pi) için ayrı dosyalar yayımlanır.

```sh
chmod +x telsiz-<sürüm>-linux-x64
./telsiz-<sürüm>-linux-x64
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

Sürümler sayfasında Windows için kurucu (`Telsiz-Kurulum-<sürüm>.exe`) ve taşınabilir sürüm (`Telsiz-<sürüm>-tasinabilir.exe`), Linux için AppImage ve .deb paketi yayımlanır. Masaüstü uygulaması bir sunucu değil, istemcidir. Arayüz uygulamanın içinde gelir ve sunucudan indirilmez. Ayrıntılar [desktop/README.md](desktop/README.md) dosyasındadır.

## İlk kurulum ve davet

1. Sunucuyu başlatın ve konsolda çerçeve içinde gösterilen kurulum kodunu not edin.
2. Tarayıcıda sunucunun adresini açın.
3. Kurulum ekranında kurulum kodunu, kullanıcı adınızı ve parolanızı girin. Bu hesap sunucunun sahibi olur.
4. Telsiz grup için bir şifreleme anahtarı oluşturur ve davet ekranını gösterir. Davet bağlantısını kopyalayıp arkadaşlarınızla paylaşın.

Davet bağlantısı davet kodunu ve şifreleme anahtarını adresin `#` işaretinden sonraki bölümünde taşır. Tarayıcılar bu bölümü sunucuya göndermez, ancak bağlantıyı gören herkes anahtarı da öğrenir. Bu yüzden bağlantıyı yalnızca güvendiğiniz kanallardan paylaşın. Anahtar kodu istenirse elle de yazılabilir. Davet kodu daha sonra Ayarlar > Davet bölümünden yenilenebilir.

Sahip ve yöneticiler odaları Ayarlar > Odalar bölümünden, üyeleri Ayarlar > Üyeler bölümünden yönetir. Sunucu adı ile Telsiz DJ ve YouTube kaynağı anahtarları Ayarlar > Genel bölümündedir ve yalnızca sahip tarafından değiştirilir.

## HTTPS ve internete açma

Tarayıcılar mikrofona ve ekran yakalamaya yalnızca güvenli adreslerde izin verir. Bu yüzden sesli sohbet, ekran paylaşımı ve uygulama olarak yükleme `https://` ile başlayan bir adres veya sunucunun çalıştığı bilgisayardaki `http://localhost` adresi gerektirir. Ev ağındaki `http://192.168...` gibi bir adreste yazışma çalışır, ancak ses çalışmaz.

İnternetteki arkadaşlar için üç yol vardır. Depoda bulunan `tunel.bat` (Windows) ve `tunel.sh` (Linux ve macOS) betikleri, hesap gerektirmeyen Cloudflare hızlı tüneliyle geçici bir https adresi açar. Bu adres her çalıştırmada değişir. Kalıcı bir adres için kendi alan adınızla [deploy/Caddyfile](deploy/Caddyfile) veya [deploy/nginx.conf](deploy/nginx.conf) örneğindeki gibi bir ters vekil kullanabilirsiniz. Docker Compose örneği Caddy'yi hazır olarak içerir. Ayrıntılar [docs/KURULUM.md](docs/KURULUM.md) dosyasındadır.

## Cihazlar

**Telefon, tablet ve bilgisayar.** Telsiz https adresinden açıldığında uygulama olarak yüklenebilir. Destekleyen tarayıcılarda Ayarlar > Uygulama bölümünde "Uygulamayı yükle" düğmesi görünür. iPhone ve iPad'de Safari'nin Paylaş menüsündeki "Ana Ekrana Ekle" seçeneği kullanılır. Yüklenen uygulama yüklendiği adrese bağlıdır.

**Masaüstü uygulaması.** Windows ve Linux için hazırlanan masaüstü uygulaması arayüzü kendi içinde taşır ve açılışta dosyaların bütünlüğünü doğrular. Mikrofonu aç veya kapat ve sağırlaştır için genel kısayollar ile sistem tepsisine küçültme seçeneği sunar.

**Televizyon ve oyun konsolları.** Arayüz geniş ekranda büyük yazı ve büyük düğmelerle açılır, yön tuşlarıyla gezilebilir. PS5'in resmi bir tarayıcı uygulaması yoktur ve konsol tarayıcılarında sesli sohbetin çalıştığı doğrulanmamıştır. Konsol başındaki kişi sesli sohbete aynı hesapla telefonundan katılabilir.

## Güvenlik özeti

Parola sunucuya hiç gönderilmez. Tarayıcı paroladan scrypt ile bir kimlik doğrulama anahtarı ve ayrı bir sarma anahtarı türetir. Grup içeriği TweetNaCl-js ile XSalsa20-Poly1305 kullanılarak, özel mesajlar X25519 ile kurulan ortak anahtarla şifrelenir. Sunucu her istekte yetkiyi denetler, girdileri doğrular, hız sınırları ve katı bir içerik güvenliği politikası uygular.

Uçtan uca şifreleme her şeyi gizlemez. Sunucu kimin çevrimiçi olduğunu, kimin hangi odada ve ses odasında bulunduğunu, mesajların zamanını ve boyutunu, oda adlarını, kullanıcı adlarını ve yazıyor bilgisini görür. Web sürümünde uygulama kodu sunucudan geldiği için sunucuyu ele geçiren etkin bir saldırgan değiştirilmiş kod sunabilir. Grup anahtarında ileriye dönük gizlilik yoktur. Sesli sohbette kişiler birbirinin IP adresini görebilir. Proje bağımsız bir güvenlik denetiminden geçmemiştir. Sınırların tam listesi [docs/MIMARI.md](docs/MIMARI.md#sınırlar) dosyasında, güvenlik açığı bildirme yolu [SECURITY.md](SECURITY.md) dosyasındadır.

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

Telsiz, Burak Aslancan Pak tarafından geliştirilmiştir ve [MIT lisansı](LICENSE) ile dağıtılır. `public/vendor/` altındaki TweetNaCl-js (Unlicense) ve scrypt-js (MIT) kendi lisanslarıyla dağıtılır. Yazı tipleri SIL Open Font License ile lisanslıdır, lisans metinleri `public/fonts/` klasöründedir.
