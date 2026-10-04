# Telsiz kurulum rehberi

[Türkçe](KURULUM.md) | [English](DEPLOYMENT.md)

Bu belge Telsiz sunucusunu kendi bilgisayarınızda veya bir sunucuda çalıştırmayı, internete açmayı, yedeklemeyi ve güncellemeyi anlatır. Kısa bir tanıtım ve hızlı başlangıç için [README.md](../README.md), sistemin nasıl çalıştığı için [MIMARI.md](MIMARI.md) dosyasına bakın.

Arayüzde her Telsiz sunucusu bir **frekans** olarak görünür: kurduğunuz sunucu, kendi adı, odaları ve üyeleriyle bir frekanstır. Kullanıcılar birden çok frekansa katılabilir ve aralarında üst çubuktaki frekans adından geçer. Bu belgede "sunucu" programı ve onu çalıştıran makineyi anlatır.

## Gereksinimler

Sunucu tek bir süreçtir ve çalışma zamanı bağımlılığı yoktur. Hangi kurulum yolunun neye ihtiyaç duyduğu aşağıdaki tabloda özetlenir.

| Kurulum yolu | Gereken |
| --- | --- |
| npm paketi | Node.js 20 veya daha yeni |
| Depodan (`baslat.bat`, `baslat.sh`, systemd) | git veya depo arşivi, Node.js 20 veya daha yeni |
| Windows tek dosya | Windows x64, Node.js gerekmez |
| Linux tek dosya | Linux x64 veya arm64, Node.js gerekmez |
| Docker | Docker, isteğe bağlı olarak Docker Compose |

macOS için tek dosyalık sunucu yayımlanmaz. macOS'ta npm paketi, `baslat.sh` veya Docker kullanılır. Sunucuyu internete açmak için ayrıca bir https adresi gerekir (bkz. [HTTPS](#https)). Kullanıcı tarafında güncel bir tarayıcı yeterlidir.

## Kurulum yolları

Sunucu hangi yolla başlatılırsa başlatılsın açılışta sürümü, sunucu adını, veri klasörünün tam yolunu, sahip hesabı henüz yoksa kurulum kodunu ve erişim adreslerini konsola yazar. Varsayılan bağlantı noktası 3000'dir.

### npm paketi

```sh
npx telsiz
```

Kalıcı kurulum için:

```sh
npm install -g telsiz
telsiz
```

Veri klasörü komutun çalıştırıldığı klasördeki `veri` klasörüdür, npm paketinin kurulduğu `node_modules` klasörüne hiçbir şey yazılmaz. Komutu her zaman aynı klasörde çalıştırın veya `VERI_KLASORU` ile sabit bir yol verin:

```sh
VERI_KLASORU=/srv/telsiz-veri npx telsiz
```

### Windows tek dosya

1. GitHub'daki [Sürümler](https://github.com/Yerlifan/telsiz/releases) sayfasından `telsiz-<sürüm>-server-windows-x64.exe` dosyasını ve `SHA256SUMS.txt` dosyasını indirin.
2. Dosyayı kendine ait boş bir klasöre koyun, örneğin `C:\Telsiz`.
3. Dosyaya çift tıklayın. Dosya imzalı olmadığı için Windows SmartScreen uyarı gösterebilir. Bu durumda "Ek bilgi" ve ardından "Yine de çalıştır" seçilir.
4. Açılan pencere sunucunun kendisidir ve Telsiz kullanıldığı sürece açık kalmalıdır. Durdurmak için pencerede Ctrl+C tuşlarına basın.

Veri klasörü dosyanın yanındaki `veri` klasörüdür. Başlatma bir hatayla durursa pencere hemen kapanmaz, hata okunduktan sonra Enter tuşuyla kapanır. Ayarlar için dosyanın yanına bir `telsiz.env` dosyası koyabilirsiniz (bkz. [Ayarlar](#ayarlar)).

### Linux tek dosya

x64 için `telsiz-<sürüm>-server-linux-x64`, arm64 (ör. Raspberry Pi) için `telsiz-<sürüm>-server-linux-arm64` dosyasını indirin.

```sh
chmod +x telsiz-<sürüm>-server-linux-x64
./telsiz-<sürüm>-server-linux-x64
```

Veri klasörü ve `telsiz.env` dosyası Windows sürümünde olduğu gibi yürütülebilir dosyanın yanındadır.

### Depodan

```sh
git clone https://github.com/Yerlifan/telsiz.git
cd telsiz
./baslat.sh
```

`baslat.sh` (Linux ve macOS) ve `baslat.bat` (Windows) Node.js'in kurulu ve en az 20 sürümü olduğunu denetler, betiğin bulunduğu klasöre geçer ve `node server.js` komutunu çalıştırır. Veri klasörü depo klasöründeki `veri` klasörüdür. Betiklerin başında sık kullanılan ayarlar (`SUNUCU_ADI`, `PORT` ve TURN ayarları) hazır satırlar olarak bulunur. `baslat.bat` dosyasına çift tıklamak yeterlidir, pencere sunucu çalıştığı sürece açık kalmalıdır. Betiğe verilen argümanlar sunucuya geçer, örneğin `./baslat.sh sifre-sifirla deniz`.

Doğrudan `node server.js` veya `npm start` komutu da kullanılabilir.

### Docker

Yayımlanan imaj `ghcr.io/yerlifan/telsiz` adıyla linux/amd64 ve linux/arm64 için hazırlanır, sürüm etiketi (ör. `2.0.0`) ve `latest` etiketi taşır.

```sh
docker run -d --name telsiz --restart unless-stopped -p 127.0.0.1:3000:3000 -v telsiz-veri:/data ghcr.io/yerlifan/telsiz:latest
docker logs telsiz
```

İmaj root olmayan `node` kullanıcısıyla çalışır, veriyi `/data` biriminde tutar ve `/api/info` adresini yoklayan bir sağlık denetimi içerir. Yukarıdaki komut bağlantı noktasını yalnızca bu makineye açar, internete bir ters vekil veya tünel açar. İmajı depodan kendiniz de derleyebilirsiniz:

```sh
docker build -t telsiz .
```

### Docker Compose

[deploy/docker-compose.yml](../deploy/docker-compose.yml) imajı depodan derler ve kök dosya sistemi salt okunur, tüm yetkileri bırakılmış bir kapsayıcı başlatır. Yalnızca Telsiz için:

```sh
docker compose -f deploy/docker-compose.yml up -d
docker compose -f deploy/docker-compose.yml logs telsiz
```

Alan adınızın DNS kaydı bu sunucuyu gösteriyorsa ve 80 ile 443 bağlantı noktaları açıksa, aynı dosya otomatik HTTPS için Caddy'yi de başlatabilir:

```sh
TELSIZ_ALAN_ADI=telsiz.ornek.com docker compose -f deploy/docker-compose.yml --profile caddy up -d
```

Compose dosyası Caddy kapsayıcısına sabit bir adres verir ve `GUVENILIR_VEKIL` ayarına bu adresi yazar. Caddy kullanmıyor, kendi ters vekilinizi sunucunun kendisinde çalıştırıyorsanız dosyadaki açıklamaya göre Docker ağ geçidi adresini yazın.

### systemd

[deploy/telsiz.service](../deploy/telsiz.service) kodu `/opt/telsiz`, veriyi `/var/lib/telsiz` altında tutan ve sunucuyu yalnızca `127.0.0.1:3000` adresinde dinleten, sertleştirilmiş bir birim dosyasıdır. Kurulum adımları dosyanın başında yazılıdır:

```sh
sudo git clone https://github.com/Yerlifan/telsiz.git /opt/telsiz
sudo useradd --system --home /var/lib/telsiz --shell /usr/sbin/nologin telsiz
sudo cp /opt/telsiz/deploy/telsiz.service /etc/systemd/system/telsiz.service
sudo systemctl daemon-reload
sudo systemctl enable --now telsiz
sudo journalctl -u telsiz
```

Birim dosyası Node.js'i `/usr/bin/node` yolunda bekler. Yolu `command -v node` ile doğrulayın. İnternete Caddy veya nginx gibi bir ters vekil açar.

## VPS ve alan adıyla adım adım

Bu bölüm kiralık bir sanal sunucuda (VPS) kendi alan adınızla, otomatik HTTPS ile çalışan bir frekans kurmayı baştan sona anlatır. Aynı rehberin kısa hali, oturum açmamış ziyaretçinin gördüğü tanıtım sayfasında "Kendi frekansını kur" başlığı altında da bulunur.

1. **VPS kiralayın.** Ubuntu 24.04 ve 1 ile 2 GB bellek yeterlidir. KVM sanallaştırma, sabit bir IPv4 adresi ve açık 80 ile 443 bağlantı noktaları olan bir paket seçin.
2. **Alan adını VPS'e bağlayın.** Alan adı panelinde bir A kaydı ekleyin: Ad `@` (veya `telsiz` gibi bir alt alan adı), Değer VPS'in IP adresi. Cloudflare kullanıyorsanız kayıt "DNS only" (gri bulut) olmalıdır, aksi halde Caddy sertifika alamaz. Kaydın yayıldığını kontrol edin, yanıtta VPS'in IP adresi görünmelidir:

   ```sh
   nslookup alanadin.com
   ```

3. **VPS'e bağlanın.** Sağlayıcının verdiği IP adresi ve şifreyle bağlanın, ilk iş şifreyi değiştirin:

   ```sh
   ssh root@IP
   passwd
   ```

4. **Telsiz'i kurun.** Docker'ı kurun, depoyu indirin ve Telsiz'i Caddy ile başlatın. Caddy HTTPS sertifikasını kendisi alır ve yeniler:

   ```sh
   curl -fsSL https://get.docker.com | sh
   git clone https://github.com/Yerlifan/telsiz.git && cd telsiz
   TELSIZ_ALAN_ADI=alanadin.com docker compose -f deploy/docker-compose.yml --profile caddy up -d
   ```

5. **Sahip hesabını oluşturun.** Kurulum kodunu günlükte görün, `https://alanadin.com` adresini açın ve sahip hesabını oluşturun. Ardından Ayarlar > Genel bölümünden frekans tanıtımını yazın ve davet bağlantısını paylaşın:

   ```sh
   docker compose -f deploy/docker-compose.yml logs telsiz
   ```

Başka yollar: kiralık sunucu istemiyorsanız [Windows tek dosya](#windows-tek-dosya) veya [Linux tek dosya](#linux-tek-dosya) sunucusunu ya da [npm paketini](#npm-paketi) (`npx telsiz`) kullanabilirsiniz. Bunlar yerel ağda veya bir [tünel](#tünel) üzerinden denemek için uygundur. Güncelleme ve yedekleme için [Güncelleme](#güncelleme) ve [Yedekleme](#yedekleme) bölümlerine bakın.

## Ayarlar

Sunucu ortam değişkenleriyle ayarlanır. Her ayarın Türkçe adı ve İngilizce takma adı vardır, ikisi birden verilirse Türkçe ad geçerlidir. Hatalı bir değer verilirse sunucu başlamaz ve hangi ayarın hatalı olduğunu konsola yazar.

| Ayar | Varsayılan | Açıklama |
| --- | --- | --- |
| `PORT` | `3000` | Dinlenen bağlantı noktası (1 ile 65535). |
| `HOST` | `0.0.0.0` | Dinlenen adres. Ters vekil aynı makinedeyse `127.0.0.1` önerilir. Kapsayıcı içinde `0.0.0.0` gerekir. |
| `SUNUCU_ADI` (`SERVER_NAME`) | `Telsiz` | Yalnızca ilk kurulumda kullanılan başlangıç adı, en fazla 40 karakter. |
| `VERI_KLASORU` (`DATA_DIR`) | `veri` | Veri klasörü. Varsayılan, çalışma klasöründeki veya tek dosyalık sunucuda dosyanın yanındaki `veri` klasörüdür. |
| `MAKS_YUKLEME_MB` (`MAX_UPLOAD_MB`) | `25` | Tek dosya boyut sınırı (MB), en fazla 1024. |
| `YUKLEME_KOTASI_MB` (`UPLOAD_QUOTA_MB`) | `2048` | Tüm yüklemelerin toplam sınırı (MB). Tek dosya sınırından küçük olamaz. |
| `KULLANICI_YUKLEME_KOTASI_MB` (`USER_UPLOAD_QUOTA_MB`) | `512` | Bir kullanıcının hâlâ kayıtlı yüklemelerinin (mesaj ekleri, profil resmi, henüz gönderilmemiş dosyalar) toplam sınırı (MB). Dolunca yükleme 507 hatasıyla reddedilir, kişi dosyalı eski mesajlarını silerek yer açar. Tek dosya sınırından küçük olamaz, verilmezse tek dosya sınırına yükseltilir. |
| `MAKS_TOPLAM_MESAJ` (`MAX_TOTAL_MESSAGES`) | `500000` | Bütün odalar ve özel mesaj konuşmalarında saklanan toplam mesaj sınırı (1 ile 100000000), sunucunun belleğini korur. Aşılınca yeni mesaj reddedilmez, en çok mesajı olan konuşmaların en eski mesajları ve ekleri silinir. Oda başına 20000 mesaj sınırı ayrıca geçerlidir. |
| `STUN_URL` | `stun:stun.l.google.com:19302` | Virgülle ayrılmış `stun:` veya `stuns:` adresleri. Değişken boş dizeyle tanımlanırsa STUN kullanılmaz. |
| `TURN_URL` | boş | Virgülle ayrılmış `turn:` veya `turns:` adresleri. |
| `TURN_KULLANICI` (`TURN_USERNAME`) | boş | TURN kullanıcı adı. |
| `TURN_SIFRE` (`TURN_PASSWORD`) | boş | TURN parolası. |
| `GUVENILIR_VEKIL` (`TRUSTED_PROXY`) | `loopback` | İstemci adresini `X-Forwarded-For` ve `CF-Connecting-IP` başlıklarından okumaya izin verilen vekiller. Değerler: `loopback`, `none`, IP adresi veya CIDR bloğu, virgülle ayrılmış, en fazla 64 girdi. |
| `DIL` (`TELSIZ_LANG`) | sistem dili | Konsol ve günlük metinlerinin dili: `tr` veya `en`. API hata metinleri her zaman isteğin diline göre seçilir. |

Oda sayısı (yazı ve ses birlikte 50), kişi başına özel mesaj konuşması (500) ve hesap sayısı (500) sabit sınırlardır, ortam değişkeniyle değiştirilmez.

### telsiz.env

Tek dosyalık sunucu (Windows ve Linux) yürütülebilir dosyanın yanındaki `telsiz.env` dosyasını okur. Dosya Not Defteri gibi bir düzenleyiciyle yazılabilir. Her satıra `AD=değer` yazılır, `#` ile başlayan satırlar yorumdur. Değerin çevresindeki boşluklar ve eşleşen tırnaklar atılır, satır sonu yorumu yoktur. Yalnızca yukarıdaki tablodaki ayarlar okunur, bilinmeyen adlar uyarıyla yok sayılır. Aynı ayar ortam değişkeni olarak da tanımlıysa ortam değişkeni geçerli olur. Dosya en fazla 16 KB olabilir.

```ini
# Telsiz ayarları
SUNUCU_ADI=Cuma Akşamı
PORT=3000
DIL=tr
```

npm paketi, depo kopyası ve Docker imajı `telsiz.env` dosyasını okumaz, bu kurulumlarda ayarlar ortam değişkeni olarak verilir.

## İlk çalıştırma

1. Sunucuyu başlatın. Sahip hesabı henüz yoksa konsolda eşittir işaretlerinden oluşan bir çerçeve içinde kurulum kodu görünür. Docker'da `docker logs telsiz`, systemd'de `journalctl -u telsiz` komutuyla görülür.
2. Tarayıcıda sunucunun adresini açın. Sunucunun çalıştığı bilgisayarda bu adres `http://localhost:3000` olur, konsol aynı ağdaki adresleri de listeler.
3. Kurulum ekranında kurulum kodunu, kullanıcı adınızı ve parolanızı girin. Kullanıcı adı küçük İngilizce harf, rakam, alt çizgi ve nokta içerebilir. Bu hesap sunucunun, yani bu frekansın sahibidir.
4. Telsiz grup için bir şifreleme anahtarı oluşturur ve davet ekranını gösterir. Davet bağlantısını kopyalayın. Gerekirse anahtar kodunu ayrıca not edin.
5. Davet bağlantısını arkadaşlarınıza gönderin. Bağlantıyı açan kişi kendi kullanıcı adı ve parolasıyla kayıt olur, anahtar tarayıcısına kendiliğinden eklenir.

Kurulum kodu yalnızca sahip hesabı oluşturulana kadar geçerlidir ve sunucu her başladığında yenilenir. Davet bağlantısı davet kodunu ve grup anahtarını adresin `#` işaretinden sonraki bölümünde taşır. Tarayıcılar bu bölümü sunucuya göndermez, ancak bağlantıyı gören herkes anahtarı da öğrenir. Davet bağlantısını tünel veya kalıcı https adresi üzerindeyken kopyalayın, çünkü bağlantı o anda açık olan adresi kullanır.

## Sahip ve yönetici ayarları

Frekansın (sunucunun) ayarları uygulamadaki tam ekran ayarlar görünümünün "Frekans ayarları" grubundadır. Ayarlar sağ üstteki avatar menüsünden açılır.

| Yer | Kim | İçerik |
| --- | --- | --- |
| Ayarlar > Genel | Sahip ve yönetici (bazı alanlar yalnızca sahip) | Frekans adı (yalnızca sahip), frekans fotoğrafı (yalnızca sahip, yönetici önizlemeyi görür), frekans tanıtımı (yalnızca sahip, yönetici salt okunur görür), frekans özeti, Müzik botu bölümünde Telsiz DJ, YouTube kaynağı ve kısıtlı kip anahtarları (yalnızca sahip), Ses odaları ve kameralar bölümünde ses odası kapasitesi, kameralar ve oda başına kamera sınırı (yalnızca sahip, yönetici salt okunur görür), Sunucu bilgileri bölümünde makine ve kullanım bilgileri ile kapasite önerisi |
| Ayarlar > Odalar | Sahip, yönetici ve oda yönetme izni olan roller | Yazı ve ses odası oluşturma, yeniden adlandırma, sıralama ve silme. Son yazı odası silinemez. |
| Ayarlar > Üyeler | Sahip, yönetici ve engelleme izni olan roller | Rol değiştirme ve üyeye özel rol verme (yalnızca sahip), alt sıradakileri engelleme, engellerini kaldırma ve frekanstan atma, geçici parolayla parola sıfırlama (yalnızca sahip) |
| Ayarlar > Roller | Yalnızca sahip | Özel rol oluşturma, adlandırma, renk seçme, izinleri açıp kapatma, sıralama ve silme |
| Ayarlar > Davet | Sahip ve yönetici | Davet bağlantısını kopyalama ve davet kodunu yenileme. Yenilenen kod eski bağlantıları geçersiz kılar. |
| Ayarlar > Gizlilik ve güvenlik > Şifreleme anahtarları | Sahip ve yönetici | Yeni grup anahtarı oluşturma |

Frekans tanıtımı en fazla 600 karakter ve 6 satırlık düz bir metindir. Oturum açmamış biri frekansın adresini tarayıcıda açınca önce tanıtım sayfasını görür: frekans adı, bu metin, Telsiz'in kısa anlatımı, masaüstü uygulamasını indirme ve kendi frekansını kurma bağlantıları, Giriş yap ve Davetin varsa katıl düğmeleri. Bu metin herkese açıktır ve şifrelenmez (`GET /api/info` yanıtında `about` alanı), gizli bilgi yazmayın. Davet bağlantısıyla gelenler, kurulmamış sunucu, masaüstü uygulaması ve bu tarayıcıda daha önce giriş yapmış olanlar tanıtım sayfasını atlar.

Frekans fotoğrafı PNG, JPEG veya WebP olabilir (sunucu dosya imzasına bakar, SVG kabul etmez) ve profil resmiyle aynı boyut sınırına tabidir (varsayılan 1 MB). Uygulama seçilen resmi yüklemeden önce ortasından kare kırpar ve 256x256 boyutuna küçültür. Fotoğraf frekans adı gibi herkese açıktır ve şifrelenmez: oturumsuz `GET /api/server-icon` adresinden sunulur, karması `GET /api/info` yanıtında `serverIcon` alanındadır. Diğer frekansların fotoğrafını yalnızca masaüstü uygulaması gösterir, tarayıcıda diğer frekansların istasyonunda baş harf kalır. Fotoğraf veri klasöründe `server-icon/` altında durur ve yedeğe girer.

Telsiz DJ ve YouTube kaynağı varsayılan olarak açıktır. YouTube kaynağı kapatılırsa yalnızca paylaşılan ses dosyaları çalınır. Sunucu şifreli DJ durumunu göremediği için bu kısıt üyelerin cihazlarında uygulanır. Telsiz DJ tamamen kapatılırsa sunucu DJ durum yazımlarını reddeder. Kısıtlı kip açıksa, odada DJ izni olan biri (sahip, yönetici veya DJ izinli rol) varken sunucu diğerlerinin DJ durum yazımlarını reddeder, odada böyle biri yoksa herkes yazabilir.

### Özel roller

Sahip ve yönetici rollerinin yanında sahip Ayarlar > Roller sayfasından en çok 20 özel rol oluşturabilir. Her rolün adı (en fazla 24 karakter), sekiz renkten biri ve aşağıdaki izinlerden seçilenler vardır. Bir üyenin tek özel rolü olabilir, rolü Ayarlar > Üyeler sayfasından sahip verir. Sahip ve yöneticiler her izne zaten sahiptir.

| İzin | Verdiği yetki |
| --- | --- |
| Mesajları sil | Yazı odalarında başkalarının mesajlarını silme (özel mesajlarda kimse başkasının mesajını silemez) |
| Üyeleri engelle | Alt sıradaki üyeleri engelleme, engellerini kaldırma ve frekanstan atma |
| Ses odasını denetle | Alt sıradaki birini herkes için susturma, kamerasını kapatma veya ses odasından çıkarma |
| Odaları yönet | Yazı ve ses odası oluşturma, yeniden adlandırma, sıralama ve silme |
| Telsiz DJ kuyruğunu yönet | Kısıtlı kip açıkken odada bulunduğunda kuyruğu yönetme, bu sırada izni olmayanlar yalnızca dinler |

Rütbe sırası sahip, yönetici, Ayarlar > Roller listesindeki sırayla özel roller ve en altta rolsüz üyelerdir. Engelleme, frekanstan atma ve ses odası denetimi yalnızca kendinden alt sıradaki birine uygulanabilir, sahip hiçbir zaman atılamaz. Herkes için susturma hesaba yazılır, kişi odadan çıkıp girse de sunucu yeniden başlasa da sürer. Ses kişiler arasında doğrudan aktığı için susturmayı istemciler uygular: susturulan kişinin uygulaması mikrofonunu kapalı tutar, diğerlerinin uygulaması o kişinin sesini çalmaz. Değiştirilmiş bir istemci kullanan kişi bu kuralı kendi cihazında atlayabilir. Kamerasını kapat düğmesi kişi ses kartında ve profil kartında yalnızca kişinin kamerası açıkken görünür. Kapatma tek seferliktir, kişinin uygulaması kamerayı durdurur ve bunu bildirir, kişi kamerasını yeniden açabilir. Odadan çıkarılan kişi yeniden katılabilir, kalıcı olarak uzaklaştırmak için engelleme kullanılır.

Frekanstan atma (Ayarlar > Üyeler > Frekanstan at) hesabı siler: kişinin bütün oturumları kapanır ve açık uygulaması frekanstan çıkarıldığını söyler, kullanıcı adı serbest kalır, mesajları kalır ve yazarı silinmiş görünür. Kişi ancak davet koduyla yeniden kayıt olarak, yeni bir hesapla dönebilir. Kişiyi uzak tutmak için engelleme kullanılır. Atılan veya engellenen kişi grup şifreleme anahtarını bilmeye devam eder, yeni mesajları korumak için Ayarlar > Gizlilik ve güvenlik > Şifreleme anahtarları bölümünden yeni anahtar oluşturun.

Ses odaları ve kameralar bölümündeki üç ayar her ses odasına ayrı uygulanır ve sunucuda saklanır (`state.json`, `voice` alanı). Ses odası kapasitesi varsayılan olarak 8'dir ve 2 ile 12 kişi arasında seçilir. Düşürülen kapasite yalnızca yeni katılımlara uygulanır, odadaki kimse çıkarılmaz. Kameralar varsayılan olarak açıktır, kapatılınca açık kameralar da kapanır. Oda başına aynı anda açık kamera sayısı varsayılan olarak 4'tür, 1 ile 12 arasında seçilir ve kapasiteden büyük olamaz. Değişiklik kaydedilince açık uygulamalara hemen ulaşır. Ses ve görüntü kişiler arasında doğrudan aktığı için bu sınırlar sunucunun değil üyelerin yükleme hızının korunması içindir: tam örgüde kamerası açık olan herkes görüntüsünü odadaki diğer her kişiye ayrı gönderir.

Sunucu bilgileri bölümünü sahip ve yöneticiler görür (`GET /api/server-info`): işlemci modeli ve çekirdek sayısı, yük ortalaması, toplam ve boş bellek, kapsayıcıda çalışıyorsa cgroup bellek sınırı, veri klasörünün bulunduğu diskin boş ve toplam alanı, Node.js sürümü, platform, çalışma süresi, yükleme ve mesaj kullanımı, çevrimiçi kişi, seste ve kamerası açık kişi sayısı ve TURN durumu. Öneri üyelerin tipik yükleme hızından hesaplanır (varsayılan 5 Mbps, yalnızca sahibin tarayıcısında saklanır) ve arayüzde tahmin olduğu yazar. Formüller [MIMARI.md](MIMARI.md#ses-odası-sınırları-ve-sunucu-bilgileri) dosyasındadır. İpuçları boş diskin yükleme kotasının kalanından az olmasını, mesaj sınırının bellekte tutacağı yerin kullanılabilir belleğin yarısını aşmasını, yüksek yük ortalamasını ve TURN durumunu gösterir. Öneriyi uygula düğmesi değerleri forma yazar, kaydetmek sahibe kalır.

Yeni grup anahtarı yalnızca bundan sonraki mesajları korur. Eski anahtar cihazlardaki anahtarlıkta kalmalıdır, çünkü eski mesajlar onunla okunur. Yeni anahtardan sonra herkese yeni davet bağlantısının gönderilmesi gerekir.

## HTTPS

Tarayıcılar mikrofon, ekran yakalama, service worker ve uygulama olarak yükleme gibi özellikleri yalnızca güvenli bağlamda açar. Güvenli bağlam `https://` ile başlayan adreslerdir, ayrıca `http://localhost` ve `http://127.0.0.1` de güvenli sayılır. Bu yüzden:

1. Sunucunun çalıştığı bilgisayarda `http://localhost:3000` adresinde her şey çalışır.
2. Aynı ağdaki başka bir cihazdan `http://192.168.1.20:3000` gibi bir adresle bağlanıldığında yazışma, dosya paylaşımı ve şifreleme çalışır, ancak sesli sohbet, ekran paylaşımı ve uygulama olarak yükleme çalışmaz.
3. Diğer bütün kullanımlar için https adresi gerekir: ters vekil ile kendi alan adınız veya bir tünel.

Ev ağındaki `http://` bağlantısında içerikler yine uçtan uca şifrelidir, ancak oturum bilgisi ağda şifresiz gider ve aynı ağdaki etkin bir saldırgan uygulama kodunu değiştirebilir.

## Ters vekil

Kalıcı bir adres için sunucuyu `HOST=127.0.0.1` ile yalnızca yerel olarak dinletin ve önüne TLS sonlandıran bir ters vekil koyun. Depodaki iki örnek doğrudan kullanılabilir:

| Dosya | Açıklama |
| --- | --- |
| [deploy/Caddyfile](../deploy/Caddyfile) | Caddy sertifikayı kendisi alır ve yeniler. `telsiz.ornek.com` yerine kendi alan adınızı yazın. |
| [deploy/nginx.conf](../deploy/nginx.conf) | HTTP'yi HTTPS'e yönlendiren ve Certbot sertifikalarını kullanan nginx sunucu bloğu. |

Hangi vekili kullanırsanız kullanın şu noktalara dikkat edin:

1. **Uzun süreli istekler.** Sunucu yeni olay yoksa bir isteği yaklaşık 25 saniye bekletir (long-polling). Vekilin okuma zaman aşımı bunun üstünde olmalıdır. nginx örneği 75 saniye kullanır, Caddy bu istekleri zaman aşımına uğratmaz.
2. **Yükleme boyutu.** Vekilin istek gövdesi sınırı `MAKS_YUKLEME_MB` değerinin biraz üstünde olmalıdır. İki örnek de varsayılan 25 MB için 30 MB kullanır.
3. **İstemci adresi.** Hız sınırları istemci IP'sine göre uygulanır. Sunucu `X-Forwarded-For` ve `CF-Connecting-IP` başlıklarına yalnızca `GUVENILIR_VEKIL` listesindeki adreslerden gelen bağlantılarda güvenir. Varsayılan `loopback` değeri aynı makinedeki bir vekil için doğrudur. Vekil istemcinin gönderdiği bu başlıkları silmeli veya ezmelidir, iki örnek de bunu yapar.
4. **HSTS.** İki örnek de `Strict-Transport-Security` başlığı ekler. Alan adını daha sonra https olmadan kullanmayı düşünüyorsanız bu satırı kaldırın.

## Tünel

Alan adı veya açık bağlantı noktası olmadan hızlı bir https adresi için Cloudflare hızlı tüneli kullanılabilir. Hesap gerekmez, ancak bunun için `cloudflared` programı kurulu olmalıdır.

1. Sunucuyu başlatın.
2. Başka bir pencerede depodaki `tunel.bat` (Windows) veya `tunel.sh` (Linux ve macOS) betiğini çalıştırın. Betik `cloudflared` yoksa nasıl kurulacağını yazar. Windows'ta önerilen komut `winget install --id Cloudflare.cloudflared` komutudur.
3. Birkaç saniye içinde çıktıda `https://....trycloudflare.com` biçiminde bir adres görünür. Telsiz'i bu adresle açın ve davet bağlantısını bu adresteyken kopyalayın.

npm paketiyle veya tek dosyalık sunucuyla çalışıyorsanız betikler yanınızda yoktur. Bu durumda sunucunun konsolda yazdığı komutu çalıştırın:

```sh
cloudflared tunnel --url http://localhost:3000
```

Sunucu 3000 dışında bir bağlantı noktasındaysa tünele de aynı değer verilir, örneğin `PORT=4000 ./tunel.sh`. Hızlı tünelin adresi her çalıştırmada değişir. Adres değişince herkesin yeni adresle yeniden giriş yapması gerekir, uygulama olarak yüklenmiş Telsiz eski adrese bağlı kalır. Tünel sağlayıcısı TLS bağlantısını kendi tarafında sonlandırır. İçerikler uçtan uca şifreli kalır, ancak web sürümünde uygulama kodu tünelden geçtiği için sağlayıcı da kod tesliminin güvenilen bir parçası olur.

## Ses bağlantısı: STUN ve TURN

Ses, ekran görüntüsü ve kamera görüntüsü kişiler arasında WebRTC ile doğrudan akar. Cihazların birbirini bulması için varsayılan olarak Google'ın herkese açık STUN sunucusu (`stun:stun.l.google.com:19302`) kullanılır. Bu, sesli sohbete katılan cihazların o STUN sunucusuyla iletişim kurduğu anlamına gelir. `STUN_URL` ile kendi STUN sunucunuzu verebilir veya değişkeni boş dizeyle tanımlayarak STUN'u kapatabilirsiniz. STUN kapalıyken farklı ağlardaki cihazlar arasında bağlantı kurulamayabilir.

Bazı ağlarda doğrudan bağlantı kurulamaz ve bir TURN sunucusu gerekir. Sunucu açılışta TURN tanımlı olup olmadığını yazar. Kendi TURN sunucunuzu kurabilir veya bir TURN hizmeti kullanabilirsiniz:

```sh
TURN_URL=turn:turn.ornek.com:3478 TURN_KULLANICI=kullanici TURN_SIFRE=parola npx telsiz
```

TURN bilgileri ses odasına katılan her oturum açmış kişinin tarayıcısına gönderilir, çünkü bağlantıyı tarayıcı kurar. Bu yüzden yalnızca Telsiz için ayrılmış bir TURN hesabı kullanın. TURN üzerinden akan ses ve görüntü WebRTC'nin kendi şifrelemesiyle (DTLS-SRTP) korunur. TURN sunucusu Telsiz ile aynı makinedeyse aktarılan ses ve kamera görüntüsü bu makinenin bağlantısından geçer, bu durumda kapasite sunucunun yükleme hızına da bağlıdır.

## Yedekleme

Bütün kalıcı veriler veri klasöründedir. Konsolun açılışta yazdığı "veri klasörü" satırı tam yolu gösterir.

| Yol | İçerik |
| --- | --- |
| `state.json` | Hesaplar (parola karmaları ve sarılmış kişisel anahtarlar), oturum karmaları, odalar, roller, davet kodu, arkadaşlıklar, sunucu ayarları |
| `state.json.bak` | Bir önceki geçerli `state.json` |
| `messages/<oda>.jsonl` | Her oda ve özel mesaj konuşması için şifreli mesaj zarfları |
| `uploads/<kimlik>.bin` | Şifreli dosyalar ve profil resimleri |
| `server-icon/<karma>.bin` | Frekans fotoğrafı (şifresiz, herkese açık) |
| `.kilit` | Çalışan sürecin kilidi, yedeğe gerekmez |

Mesaj ve dosya içerikleri şifrelidir, ancak hesap bilgileri ve üst veri düz metindir. Yedeği veri klasörü kadar dikkatli saklayın. Şifreleme anahtarları sunucuda değil kullanıcıların cihazlarındadır. Yedek, anahtarı bilmeyen birine mesajları açmaz, ancak anahtarı kaybeden bir grup da yedekten mesajlarını kurtaramaz.

Tutarlı bir yedek için sunucuyu durdurun, klasörün tamamını kopyalayın ve sunucuyu yeniden başlatın. Linux'ta örneğin:

```sh
tar czf telsiz-yedek.tgz -C /var/lib/telsiz .
```

Docker biriminde:

```sh
docker stop telsiz
docker run --rm -v telsiz-veri:/data:ro -v "$(pwd)":/yedek alpine tar czf /yedek/telsiz-yedek.tgz -C /data .
docker start telsiz
```

Geri yüklemek için sunucu durmuşken klasörün içeriğini yedekle değiştirin. Docker biriminde dosyaların sahibi kapsayıcıdaki `node` kullanıcısı olmalıdır:

```sh
docker run --rm -v telsiz-veri:/data -v "$(pwd)":/yedek alpine sh -c "tar xzf /yedek/telsiz-yedek.tgz -C /data && chown -R 1000:1000 /data"
```

## Güncelleme

Güncellemeden önce veri klasörünü yedekleyin ve sürüm notlarını ([CHANGELOG.md](../CHANGELOG.md)) okuyun.

| Kurulum | Güncelleme |
| --- | --- |
| npm (`npx`) | `npx telsiz@latest` |
| npm (genel kurulum) | `npm install -g telsiz@latest` ve sunucuyu yeniden başlatma |
| Tek dosya | Sunucuyu durdurma, yürütülebilir dosyayı yeni sürümle değiştirme, `veri` klasörüne ve `telsiz.env` dosyasına dokunmama |
| Depo | `git pull` ve sunucuyu yeniden başlatma |
| Docker | `docker pull ghcr.io/yerlifan/telsiz:latest`, eski kapsayıcıyı silip aynı birimle yeniden başlatma |
| Docker Compose | `git pull` ve `docker compose -f deploy/docker-compose.yml up -d --build` |
| systemd | `cd /opt/telsiz`, `sudo git pull` ve `sudo systemctl restart telsiz` |
| Masaüstü uygulaması (kurucu, AppImage) | Uygulama yeni sürümü kendisi indirir, Yeniden başlat ve güncelle ile kurulur |
| Masaüstü uygulaması (taşınabilir, .deb) | Uygulamanın gösterdiği sürüm sayfasından yeni dosyayı indirip eskisinin yerine koyma veya kurma |

Sürüm sayfasındaki her dosyanın SHA-256 değeri `SHA256SUMS.txt` dosyasındadır. Linux'ta `sha256sum -c SHA256SUMS.txt --ignore-missing`, Windows PowerShell'de `Get-FileHash telsiz-<sürüm>-server-windows-x64.exe` komutuyla doğrulanabilir. Uygulamadaki Ayarlar > Uygulama bölümü sunucunun sürümünü gösterir.

## Parola sıfırlama ve sorun giderme

**Bir üyenin parolası.** Sahip veya yönetici Ayarlar > Üyeler bölümünden geçici bir parola üretir. Kişinin oturumları kapanır.

**Sahibin parolası.** Sunucuyu durdurun ve aynı veri klasörüyle sıfırlama komutunu çalıştırın. Komut geçici bir parola yazar.

```sh
npx telsiz sifre-sifirla <kullanıcı adı>
node server.js reset-password <kullanıcı adı>
./telsiz-<sürüm>-server-linux-x64 sifre-sifirla <kullanıcı adı>
sudo -u telsiz env VERI_KLASORU=/var/lib/telsiz node /opt/telsiz/server.js sifre-sifirla <kullanıcı adı>
```

Parola sıfırlama kişinin kişisel güvenlik anahtarını da sıfırlar. Kişi sonraki girişte yeni bir anahtar oluşturur, eski özel mesajlarını artık okuyamaz ve konuştuğu kişiler anahtarın değiştiği uyarısını görür.

**Bağlantı noktası kullanımda.** Sunucu başka bir pencerede zaten çalışıyor olabilir. O pencereyi kapatın veya `PORT` ile başka bir bağlantı noktası seçin.

**Veri klasörü kullanımda.** Aynı veri klasörünü iki süreç kullanamaz. Sunucu çalışmıyorken bu hata görünüyorsa, hata metninde adı geçen `.kilit` dosyasını silip yeniden deneyin.

**Ses bağlanmıyor.** Adresin https veya localhost olduğunu, tarayıcının mikrofon izninin verildiğini ve gerekiyorsa bir TURN sunucusunun tanımlı olduğunu denetleyin.

**Kamera açılmıyor.** Kamera da yalnızca https veya localhost üzerinde çalışır ve tarayıcının kamera izni gerekir. Sunucunun güvenlik başlığı (`Permissions-Policy: camera=(self)`) kamerayı yalnızca Telsiz'in kendi sayfasına açar. Ters vekil bu başlığı değiştiriyorsa kamera engellenir. Sahip kameraları kapattıysa veya odadaki kamera sınırı dolduysa düğme bunu yazar.
