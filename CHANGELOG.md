# Değişiklik günlüğü

Telsiz'in sürümlerindeki önemli değişiklikler bu dosyada listelenir. Sürüm numaraları [Anlamsal Sürümleme](https://semver.org/lang/tr/) kurallarına uyar. İngilizcesi: [CHANGELOG.en.md](CHANGELOG.en.md).

## [2.0.0]

Telsiz'in ilk herkese açık sürümü: kendi sunucunuzda veya bir barındırma hizmetinde çalışan, uçtan uca şifreli, açık kaynak yazılı ve sesli iletişim sistemi. Tarayıcısı olan her cihazda çalışır, sunucunun çalışma zamanı bağımlılığı yoktur.

### Frekans düzeni

- Yeni arayüz düzeni: odalar ekranın üstündeki yatay frekans bandında istasyon olarak dizilir, açık konuşmayı bandın üstündeki ibre gösterir. İbre fareyle veya parmakla sürüklenip en yakın istasyona bırakılır. Okunmamış ve anma rozetleri istasyonların köşesindedir, içinde konuşan olan ses odası nabız gibi atar.
- Ortada tek bir konuşma sütunu, geniş ekranda sol bilgi sütunu ve diğer frekanslardaki okunmamışları toplayan Gelenler kartı.
- Ses odasına bağlanınca açılan telsiz kartı: odadakiler, konuşanın halesi, büyük Bas konuş düğmesi, Mikrofon, Sağırlaştır, Ekran ve Ayrıl düğmeleri.
- Özel mesajlar ve arkadaşlar bandın Kişisel grubunda, kişiler üst çubuktaki Yayındakiler şeridinden açılan sayfada, profil, durum ve ayarlar sağ üstteki avatar menüsünde.
- Bant klavyeyle (ok tuşları, Home, End, Enter), tekerlekle (yalnızca yatay kaydırma) ve oyun koluyla (L1 ve R1) kullanılır. Telefonda bant parmakla kayar, Tümü sayfası bütün istasyonları listeler, telsiz kartı ekranın altına yapışır. Televizyon genişliğinde yazılar büyür ve oyun kolu algılanınca ipucu çubuğu görünür.
- Avatarlar her temada yumuşak kenarlı karedir.

### Şifreleme ve gizlilik

- Yazı odası mesajları, dosyalar ve resimler, profil bilgileri (görünen ad, hakkımda, özel durum, profil resmi), sesli sohbet ve ekran paylaşımının bağlantı kurulum mesajları ve Telsiz DJ durumu tarayıcıda grup anahtarıyla şifrelenir (TweetNaCl-js, XSalsa20-Poly1305). Sunucu bu içerikleri yalnızca şifreli olarak saklar ve iletir.
- Özel mesajlar iki kişinin kişisel anahtarlarıyla (X25519) şifrelenir. Karşı tarafın anahtarı güvenlik numarasıyla doğrulanabilir, ilk görüşte sabitlenir ve anahtar değişince uyarı gösterilir.
- Parola sunucuya hiç gönderilmez. Tarayıcı paroladan scrypt ile bir kimlik doğrulama anahtarı türetir, sunucu bu anahtarın da scrypt karmasını saklar. Kişisel özel anahtar paroladan türetilen anahtarla sarılmış olarak saklanır.
- Grup anahtarı davet bağlantısının # işaretinden sonraki kısmında taşınır, tarayıcılar bu kısmı sunucuya göndermez. Anahtar elle de girilebilir.
- Yeni grup anahtarı oluşturulabilir, yeni anahtar sonraki mesajları korur. Eski mesajlar için anahtarlar cihazdaki anahtarlıkta tutulur.
- GIF dışındaki fotoğraflar gönderilmeden önce yeniden kodlanır, böylece konum bilgisi dahil üst veriler silinir.
- Mesajlarda arama ve @ anmaları tamamen tarayıcıda çalışır, sunucu aranan metni ve mesaj içeriğini görmez.

### Sunucu güvenliği

- Her uç noktada sunucu tarafında yetki denetimi, tüm girdilerde tür ve uzunluk denetimi, gövde, kuyruk ve sayı sınırları.
- Hesap ve IP adresi bazında hız sınırları (giriş, kayıt, mesaj, yükleme, yönetim işlemleri, arkadaşlık istekleri, yazıyor bildirimleri, ses sinyalleri, Telsiz DJ yazımları).
- Oturum anahtarları diskte yalnızca karma olarak saklanır, karşılaştırmalar sabit sürede yapılır.
- Katı içerik güvenliği politikası (CSP), güvenlik başlıkları, CORS başlığı yok. Çerçeve olarak yalnızca YouTube'un gömülü oynatıcısına (`youtube-nocookie.com`) izin verilir. Statik dosyalar yalnızca beyaz listeden sunulur, yol geçişi denemeleri reddedilir.
- Ters vekil arkasında istemci adresi yalnızca güvenilir vekillerden gelen başlıklardan okunur (`GUVENILIR_VEKIL` veya `TRUSTED_PROXY`).
- Veri dosyaları atomik yazılır. Bozuk bir `state.json` yedekten kurtarılırsa önce ayrı bir dosyaya kopyalanır, kurtarılamıyorsa sunucu başlamaz.

### Yazılı iletişim

- Birden çok yazı odası, kalıcı ve şifreli mesaj geçmişi (oda başına son 20000 mesaj), geçmişte sayfalama.
- Mesaj düzenleme ve silme.
- Dosya ve resim paylaşımı: mesaj başına en fazla 10 dosya, dosya başına varsayılan 25 MB sınır ve ayarlanabilir toplam kota, satır içi resimler, resim görüntüleyici, dosya kartları, yapıştırma ve sürükleyip bırakma.
- Emoji seçici: kategoriler, son kullanılanlar ve klavyeyle gezinme.
- @ ile anma ve öneri listesi. Sahip ve yöneticiler yazı odalarında herkesi anabilir.
- Okunmamış mesaj ve anma sayaçları.
- Yazıyor göstergesi. Kendi yazıyor bilginizi göndermeyi kapatabilirsiniz.
- Mesajlarda arama: bu odada veya konuşmada, tüm yazı odalarında veya özel mesajlarda, kişiye göre ve resim veya dosya içeren mesajlara göre süzme, sonuçtan mesajın bağlamına gitme.
- Masaüstü bildirimleri ve mesaj sesi, bildirim düzeyi (tüm mesajlar, yalnızca anmalar ve özel mesajlar veya hiçbiri).

### Sesli iletişim

- Birden çok ses odası, oda başına en fazla 8 kişi. Ses WebRTC ile kişiler arasında doğrudan akar (DTLS-SRTP), sunucudan geçmez.
- Konuşan göstergesi, mikrofonu kapatma, sağırlaştırma, kişi bazında ses seviyesi ve genel çıkış ses seviyesi.
- İki giriş modu: ses etkinliği (otomatik veya elle ayarlanan hassasiyet eşiği) ve bas konuş (bırakma gecikmesi ve ekrandaki Bas konuş düğmesiyle).
- Tuş atamaları: bas konuş, mikrofonu aç veya kapat ve sağırlaştır için klavye tuşu, fare yan tuşu veya oyun kolu düğmesi.
- Mikrofon seçimi ve testi, giriş seviyesi göstergesi, yankı engelleme, gürültü bastırma ve otomatik kazanç seçenekleri, odaya giriş ve çıkış sesleri.
- Bazı ağlar için kendi TURN sunucunuzu tanımlama (`TURN_URL`, `TURN_KULLANICI`, `TURN_SIFRE`).

### Ekran paylaşımı

- Ses odasında ekran, pencere veya sekme paylaşımı. Görüntü yalnızca İzle düğmesine basan kişilere gönderilir.
- Dört kalite (720p 15 kare varsayılan, 720p 30, 1080p 15, 1080p 30), akıcılık veya net metin önceliği ve tarayıcı sağlıyorsa mikrofondan ayrı paylaşım sesi.
- Yayın sahnesi: birden çok paylaşım arasında seçim, sığdırma ve doldurma, tam ekran, daraltılmış sohbet şeridi, paylaşan için önizleme ve her istasyonda görünen "Ekranınız yayında" çipi.
- Masaüstü uygulamasında küçük resimli kendi ekran ve pencere seçicisi, Windows'ta sistem sesini paylaşma seçeneği.

### Telsiz DJ

- Ses odalarında yerleşik müzik botu. Herkes parçayı aynı anda kendi cihazında dinler, konum sapması kendiliğinden düzeltilir.
- Parça ekleme: yazma alanında `/çal` ve bir YouTube bağlantısı veya mesajdaki ses dosyasında "DJ'de çal". Diğer komutlar `/geç`, `/duraklat`, `/devam`, `/kuyruk` ve `/dur`, İngilizce arayüzde `/play`, `/skip`, `/pause`, `/resume`, `/queue` ve `/stop`.
- DJ kartı: oynatıcı, konum çubuğu, kuyruk, kişisel ses seviyesi ve DJ'yi yalnızca kendi cihazınızda susturma.
- YouTube parçaları YouTube'un resmi gömülü oynatıcısıyla, yalnızca kişi bu cihazda onay verdikten sonra yüklenir. Onay Ayarlar > Gizlilik ve güvenlik bölümünden geri alınır. Paylaşılan ses dosyaları onaysız çalar.
- DJ durumu grup anahtarıyla şifrelidir ve sunucuda yalnızca bellekte tutulur. Sahip Telsiz DJ'yi veya yalnızca YouTube kaynağını Ayarlar > Genel bölümünden kapatabilir.

### Kişiler, profiller ve özel mesajlar

- Arkadaşlık istekleri (gönderme, kabul etme, reddetme, geri çekme), arkadaş listesi ve arkadaşlıktan çıkarma.
- Engelleme: engellenen kişinin yazı odası mesajları katlanır, sesi sizin tarafınızda kısılır, size özel mesaj gönderemez.
- Özel mesajlar: konuşma listesi ve okunmamış sayaçları. Sunucu üyelerinden özel mesaj kabul etmeyi kapatabilirsiniz.
- Profiller: görünen ad, hakkımda, profil rengi, kırpılabilen profil resmi, özel durum ve durum (çevrimiçi, boşta, rahatsız etmeyin, görünmez), profil kartı.

### Hesaplar ve yönetim

- Roller: sahip, yönetici ve üye. Sahip hesabı sunucu konsolunda gösterilen tek kullanımlık kurulum koduyla, diğer hesaplar davet koduyla oluşturulur.
- Oda oluşturma, yeniden adlandırma, sıralama ve silme. Son yazı odası silinemez.
- Sunucu adını değiştirme ve davet kodunu yenileme.
- Üye yönetimi: rol değiştirme, engelleme ve engeli kaldırma, geçici parolayla parola sıfırlama.
- Hesap ayarları: parola ve kullanıcı adı değiştirme, hesabı silme, etkin oturumları görme ve kapatma.
- Sahip parolasını unutursa sunucu kapalıyken komut satırından sıfırlama: `sifre-sifirla` veya `reset-password`.

### Görünüm ve diller

- Üç tema (Arcade, Gece Frekansı, Turkuaz ve Bakır), her birinde koyu ve açık mod ve sistem ayarını izleme.
- Tam ekran ayarlar görünümü, yazı boyutu, kompakt mesaj görünümü ve hareketi azaltma ayarları.
- Türkçe ve İngilizce arayüz. Sunucunun hata metinleri isteğin diline, konsol metinleri `DIL` ayarına veya sistemin diline göre Türkçe veya İngilizcedir.

### Kurulum ve çalıştırma

- Uygulama olarak yükleme (PWA): telefon, tablet ve bilgisayarda kendi penceresinde açılır (https gerekir).
- Gerçek zamanlı iletişim HTTP long-polling ile yapılır, WebSocket gerekmez.
- Sunucu Node.js 20 veya daha yeni bir sürümle çalışır, çalışma zamanı bağımlılığı yoktur, veriler JSON ve JSONL dosyalarında tutulur.
- npm paketi: `npx telsiz`. Veri klasörü, komutun çalıştırıldığı klasördeki `veri` klasörüdür.
- Tek dosya sunucu: Windows (x64) ve Linux (x64, arm64) için Node.js'i ve arayüz dosyalarını içinde taşıyan tek bir dosya. Veri klasörü dosyanın yanındaki `veri` klasörüdür, ayarlar yanındaki `telsiz.env` dosyasından da okunabilir. Başlatma hatasında pencere hemen kapanmaz.
- Docker imajı `ghcr.io/yerlifan/telsiz` (linux/amd64 ve linux/arm64): root olmayan kullanıcı, kalıcı veri birimi ve sağlık denetimi. Docker Compose, systemd, Caddy ve nginx örnekleri `deploy/` klasöründedir.
- Windows için `baslat.bat` ve `tunel.bat`, Linux ve macOS için `baslat.sh` ve `tunel.sh`. Tünel betikleri Cloudflare hızlı tüneliyle geçici bir https adresi açar.
- Yayın dosyalarının doğrulanması için `SHA256SUMS.txt`. GitHub Actions iş akışlarındaki üçüncü taraf eylemler commit SHA değeriyle sabitlenir.

### Masaüstü uygulaması

- Windows ve Linux için masaüstü uygulaması. Arayüz dosyaları uygulamanın içinde taşınır ve açılışta sha256 bildirimine göre doğrulanır, sunucudan indirilmez.
- Sunucu adresi yalnızca https olabilir (bu bilgisayardaki sunucu için http://localhost istisnası vardır). Sunucuya giden istekler uygulamanın ana sürecinden geçer.
- Yalnızca mikrofon, bildirim ve panoya yazma izinleri verilir, diğer izinler reddedilir. Ekran yakalama yalnızca uygulamanın seçicisiyle verilir. Çerçeve olarak yalnızca Telsiz DJ'nin YouTube oynatıcısı açılabilir.
- Mikrofonu aç veya kapat ve sağırlaştır için genel kısayollar, kapatınca sistem tepsisine küçültme seçeneği.

### Bilinen sınırlamalar

- Web sürümünde uygulama kodu sunucudan gelir. Sunucuyu veya HTTPS bağlantısını sonlandıran bir aracıyı ele geçiren etkin bir saldırgan değiştirilmiş kod sunabilir. Masaüstü uygulamasında arayüz kodu uygulamanın içinde geldiği için sunucu bu kodu değiştiremez.
- Sunucu üst veriyi görür: kimin, ne zaman, hangi odaya ve ne boyutta yazdığı, kimin çevrimiçi olduğu ve hangi ses odasında bulunduğu. Oda ve kullanıcı adları ile yazıyor bilgisi şifrelenmez.
- Kötü niyetli bir sunucu mesajları yeniden oynatabilir, gizleyebilir ve düzenlemeleri geri alabilir. Yazı odalarında gönderen imzası yoktur, grup anahtarına sahip biri başka bir üyenin adına mesaj üretebilir.
- Grup anahtarı sunucudaki herkes için ortaktır ve ileriye dönük gizlilik yoktur. Yeni anahtar yalnızca sonraki mesajları korur.
- Sesli sohbette ve ekran paylaşımında kişiler birbirinin IP adresini görebilir. Tam örgü yapısı küçük gruplar içindir.
- YouTube parçası için onay veren cihazın IP adresi ve izleme bilgisi Google'a gider.
- Sesli sohbet, ekran paylaşımı ve uygulama olarak yükleme https gerektirir (sunucunun çalıştığı bilgisayardaki localhost adresi hariç).
- Tek dosya sunucu ve masaüstü uygulaması imzasızdır, Windows ilk açılışta uyarı gösterebilir. Masaüstü uygulamasında otomatik güncelleme ve basılı tutularak kullanılan genel bas konuş kısayolu yoktur.
- macOS için tek dosya sunucu ve masaüstü paketi yayımlanmaz, macOS'ta `npx telsiz`, `baslat.sh` veya Docker kullanılabilir.
- Tüm sınırların listesi [docs/MIMARI.md](docs/MIMARI.md#sınırlar) dosyasındadır.
