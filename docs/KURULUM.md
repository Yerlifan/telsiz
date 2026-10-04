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
| `STUN_URL` | `stun:stun.l.google.com:19302` | Virgülle ayrılmış `stun:` veya `stuns:` adresleri. Değişken boş dizeyle tanımlanırsa STUN kullanılmaz. |
| `TURN_URL` | boş | Virgülle ayrılmış `turn:` veya `turns:` adresleri. |
| `TURN_KULLANICI` (`TURN_USERNAME`) | boş | TURN kullanıcı adı. |
| `TURN_SIFRE` (`TURN_PASSWORD`) | boş | TURN parolası. |
| `GUVENILIR_VEKIL` (`TRUSTED_PROXY`) | `loopback` | İstemci adresini `X-Forwarded-For` ve `CF-Connecting-IP` başlıklarından okumaya izin verilen vekiller. Değerler: `loopback`, `none`, IP adresi veya CIDR bloğu, virgülle ayrılmış, en fazla 64 girdi. |
| `DIL` (`TELSIZ_LANG`) | sistem dili | Konsol ve günlük metinlerinin dili: `tr` veya `en`. API hata metinleri her zaman isteğin diline göre seçilir. |

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
| Ayarlar > Genel | Sahip ve yönetici (bazı alanlar yalnızca sahip) | Frekans adı (yalnızca sahip), frekans özeti, Müzik botu bölümünde Telsiz DJ ve YouTube kaynağı anahtarları (yalnızca sahip) |
| Ayarlar > Odalar | Sahip ve yönetici | Yazı ve ses odası oluşturma, yeniden adlandırma, sıralama ve silme. Son yazı odası silinemez. |
| Ayarlar > Üyeler | Sahip ve yönetici | Rol değiştirme, engelleme ve engeli kaldırma, geçici parolayla parola sıfırlama |
| Ayarlar > Davet | Sahip ve yönetici | Davet bağlantısını kopyalama ve davet kodunu yenileme. Yenilenen kod eski bağlantıları geçersiz kılar. |
| Ayarlar > Gizlilik ve güvenlik > Şifreleme anahtarları | Sahip ve yönetici | Yeni grup anahtarı oluşturma |

Telsiz DJ ve YouTube kaynağı varsayılan olarak açıktır. YouTube kaynağı kapatılırsa yalnızca paylaşılan ses dosyaları çalınır. Sunucu şifreli DJ durumunu göremediği için bu kısıt üyelerin cihazlarında uygulanır. Telsiz DJ tamamen kapatılırsa sunucu DJ durum yazımlarını reddeder.

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

Ses ve ekran görüntüsü kişiler arasında WebRTC ile doğrudan akar. Cihazların birbirini bulması için varsayılan olarak Google'ın herkese açık STUN sunucusu (`stun:stun.l.google.com:19302`) kullanılır. Bu, sesli sohbete katılan cihazların o STUN sunucusuyla iletişim kurduğu anlamına gelir. `STUN_URL` ile kendi STUN sunucunuzu verebilir veya değişkeni boş dizeyle tanımlayarak STUN'u kapatabilirsiniz. STUN kapalıyken farklı ağlardaki cihazlar arasında bağlantı kurulamayabilir.

Bazı ağlarda doğrudan bağlantı kurulamaz ve bir TURN sunucusu gerekir. Sunucu açılışta TURN tanımlı olup olmadığını yazar. Kendi TURN sunucunuzu kurabilir veya bir TURN hizmeti kullanabilirsiniz:

```sh
TURN_URL=turn:turn.ornek.com:3478 TURN_KULLANICI=kullanici TURN_SIFRE=parola npx telsiz
```

TURN bilgileri ses odasına katılan her oturum açmış kişinin tarayıcısına gönderilir, çünkü bağlantıyı tarayıcı kurar. Bu yüzden yalnızca Telsiz için ayrılmış bir TURN hesabı kullanın. TURN üzerinden akan ses ve görüntü WebRTC'nin kendi şifrelemesiyle (DTLS-SRTP) korunur.

## Yedekleme

Bütün kalıcı veriler veri klasöründedir. Konsolun açılışta yazdığı "veri klasörü" satırı tam yolu gösterir.

| Yol | İçerik |
| --- | --- |
| `state.json` | Hesaplar (parola karmaları ve sarılmış kişisel anahtarlar), oturum karmaları, odalar, roller, davet kodu, arkadaşlıklar, sunucu ayarları |
| `state.json.bak` | Bir önceki geçerli `state.json` |
| `messages/<oda>.jsonl` | Her oda ve özel mesaj konuşması için şifreli mesaj zarfları |
| `uploads/<kimlik>.bin` | Şifreli dosyalar ve profil resimleri |
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
