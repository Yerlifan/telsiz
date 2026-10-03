# PS5 + PC Sohbet

PS5 + PC Sohbet, Discord'a erişemeyen arkadaş gruplarının bilgisayardan, PS5'ten, telefondan ve tabletten ortak kullanabileceği, yazı ve ses kanallarına sahip, uçtan uca şifreli bir sohbet uygulamasıdır. Sunucu gruptan bir kişinin bilgisayarında çalışır, diğer herkes tarayıcıdan bağlanır ve isteyen kişi uygulamayı telefonuna, tabletine veya bilgisayarına yükleyebilir. Mesajlar, fotoğraflar ve dosyalar tarayıcıda şifrelenir, sunucu yalnızca şifreli veriyi saklar. Windows'ta sunucuyu başlatmak için Node.js'i kurup `baslat.bat` dosyasına çift tıklamak yeterlidir. İnternetteki arkadaşlar için `tunel.bat` geçici bir https adresi açar.

## Özellikler

Uygulamanın düzeni Discord'a benzer. Solda yazı ve ses kanalları, ortada seçili kanalın mesajları, geniş ekranlarda sağda çevrimiçi ve çevrimdışı üyeler görünür. Birden çok yazı kanalı ve ses kanalı açılabilir. Hesaplar, kanallar ve mesaj geçmişi sunucu yeniden başlatıldığında da korunur. Mesajlar düzenlenip silinebilir, okunmamış mesajlar kanal listesinde sayıyla gösterilir ve isteğe bağlı olarak tarayıcı bildirimi alınabilir.

Yazma alanındaki "Fotoğraf", "Dosya" ve "Emoji" düğmeleriyle fotoğraf, her türden dosya ve emoji gönderilebilir. Fotoğraflar gönderilmeden önce tarayıcıda yeniden kodlanır ve konum bilgisi dahil üst verileri silinir. Bir dosya 25 MB'a kadar olabilir ve bir mesaja en fazla 10 ek eklenebilir.

Ses kanallarında konuşan kişi yeşil bir halkayla gösterilir. Mikrofonu kapatma, sağırlaştırma, kişi bazlı ses seviyesi, bir kişiyi yalnızca kendi cihazında susturma, bas-konuş ve mikrofon seçimi desteklenir. Ses kanalı başına en fazla 8 kişi katılabilir.

Sunucuda sahip, yönetici ve üye rolleri vardır. Yeni kişiler yalnızca davet koduyla kayıt olabilir. Sahip ve yöneticiler kanalları yönetebilir ve kişileri engelleyebilir. Sahip, parolasını unutan kişilerin parolasını sıfırlayabilir.

Arayüz bilgisayarda, telefonda, tablette ve televizyona bağlı PS5'te kullanılabilecek şekilde tasarlandı. Geniş ekranlarda yazılar büyür ve tüm düğmeler büyük tıklama alanlarına sahiptir. Sunucunun hiçbir npm bağımlılığı yoktur, çalıştırmak için `npm install` gerekmez.

## Neden web tabanlı

Türkiye'de Discord erişime kapalı olduğu için PS5, bilgisayar ve telefon kullanan oyuncuların birlikte yazışıp konuşabileceği ortak bir yere ihtiyaç duyuldu. PS5'e üçüncü taraf uygulama kurulamaz, ancak sistemde gizli bir web tarayıcısı bulunur. Bu yüzden uygulama, herkesin tarayıcıdan açtığı bir web uygulaması olarak tasarlandı. Aynı web uygulaması telefon, tablet ve bilgisayarda bir uygulama mağazasına gerek kalmadan ana ekrana veya masaüstüne yüklenebilir (PWA).

PS5 tarayıcısında WebSocket ve Server-Sent Events desteği doğrulanamadığı için uygulama gerçek zamanlı iletişimde yalnızca düz HTTP istekleriyle çalışan long-polling yöntemini kullanır. Bu yöntemde tarayıcı sunucuya yeni bir şey olup olmadığını sorar, sunucu da yeni bir olay gelene kadar veya en fazla 25 saniye boyunca yanıtı bekletir. Cloudflare hızlı tüneli yanıtları tamamlanana kadar tamponladığı için sürekli açık kalan akış bağlantıları tünel üzerinden çalışmaz. Long-polling yanıtları ise veri hazır olduğunda hemen tamamlandığı için bundan etkilenmez.

Şifreleme için tarayıcının yerleşik WebCrypto arayüzü yerine TweetNaCl-js kütüphanesi kullanılır. WebCrypto'nun şifreleme işlevleri yalnızca güvenli bağlamda, yani https ile veya `localhost` üzerinden açılan sayfalarda kullanılabilir. PS5 ise ev ağındaki sunucuya https olmadan bağlanabilir. TweetNaCl-js 2017'de Cure53 tarafından denetlenmiştir ve kamu malıdır.

## Güvenlik ve şifreleme modeli

Bu bölüm uygulamanın neyi koruduğunu ve neyi korumadığını açıkça anlatır. Protokolün ayrıntılı tanımı [docs/MIMARI.md](docs/MIMARI.md) dosyasında, güvenlik açığı bildirme yolu [SECURITY.md](SECURITY.md) dosyasındadır.

### Neler şifrelenir

Yazı kanallarındaki mesajlar, fotoğraflar, dosyalar (adları ve türleri dahil) ve sesli sohbetin bağlantı kurulum bilgileri, gönderenin tarayıcısında ortak bir grup anahtarıyla şifrelenir (XSalsa20-Poly1305). Anahtar sunucuya hiçbir zaman gönderilmez. Sunucu ve tünel yalnızca şifreli veriyi görür. Sunucunun veri klasörü çalınsa bile mesaj ve dosya içerikleri anahtar olmadan okunamaz.

Ses, WebRTC ile kişiler arasında doğrudan akar ve sohbet sunucusundan geçmez. WebRTC sesi DTLS-SRTP ile şifreler. Ses bağlantısının kurulum bilgileri grup anahtarıyla şifrelenip doğrulandığı için sunucu bu bilgileri değiştirerek araya giremez. Bir TURN sunucusu kullanılıyorsa ses o sunucu üzerinden aktarılır, ancak yine DTLS-SRTP ile şifreli kalır.

Davet bağlantısı anahtarı, adresin `#` işaretinden sonraki bölümünde taşır. Tarayıcılar bu bölümü sunucuya göndermez, uygulama da anahtarı okuduktan sonra bu bölümü adres çubuğundan siler. Anahtar her cihazda tarayıcının yerel depolamasında saklanır.

### Sunucunun ve tünelin görebildikleri

| Bilgi | Sunucu ve tünel görebilir mi |
|---|---|
| Mesaj metinleri | Hayır, şifrelidir |
| Fotoğraf ve dosyaların içerikleri, adları ve türleri | Hayır, şifrelidir |
| Ses | Hayır, ses sunucudan geçmez ve DTLS-SRTP ile şifrelidir |
| Kanal adları, kullanıcı adları ve roller | Evet, şifrelenmez |
| Kimin, ne zaman, hangi kanala yazdığı | Evet |
| Mesajların ve dosyaların boyutları | Evet |
| Kimin çevrimiçi olduğu ve hangi ses kanalında bulunduğu | Evet |
| Bağlanan cihazların IP adresleri | Evet |
| Parolalar | Giriş sırasında sunucuya ulaşır, diskte yalnızca scrypt karması saklanır |

### Sınırlar

Web tabanlı uçtan uca şifrelemenin temel bir sınırı vardır. Uygulamanın kodu her açılışta sunucudan gelir. Sunucuyu veya tüneli ele geçiren etkin bir saldırgan, tarayıcıya değiştirilmiş bir kod göndererek anahtarı çalabilir. Cloudflare hızlı tüneli TLS bağlantısını Cloudflare tarafında sonlandırdığı için bu durum tünel sağlayıcısını da kapsar. Şifreleme bu yüzden içerikleri veri klasörünün çalınmasına ve trafiği yalnızca izleyen birine karşı korur. Sunucuyu çalıştıran kişiye, sunucuyu ele geçiren birine veya tünel sağlayıcısına karşı ise ancak uygulama kodu değiştirilmediği sürece koruma sağlar.

Sunucu yukarıdaki tabloda görülen üst verileri görür. Kanal adları ve kullanıcı adları şifrelenmez, bu adlara özel bilgi yazmayın.

Grup anahtarı ortaktır. Anahtarı bilen herkes, şifreli veriye ulaşabildiği sürece tüm mesajları okuyabilir. İleriye dönük gizlilik (forward secrecy) yoktur, anahtar bir gün ele geçirilirse o anahtarla şifrelenmiş eski mesajlar da okunabilir. Gruptan çıkarılan veya engellenen biri eski anahtarı bilmeye devam eder ve şifreli veriye bir yolla ulaşırsa eski mesajları okuyabilir. Anahtar yenileme yalnızca bundan sonraki mesajları korur.

Sesli sohbette kişiler birbirine doğrudan bağlandığı için birbirinin IP adresini görebilir.

Ev ağında `http://` ile başlayan adresle bağlanıldığında bağlantı TLS ile korunmaz. Mesaj içerikleri yine uçtan uca şifrelidir, ancak giriş parolası ve oturum bilgisi ağda şifresiz gider. Aynı ağdaki biri bunları görebilir ve uygulama kodunu değiştirebilir. Ev ağı adresini yalnızca güvendiğiniz bir ağda kullanın.

Anahtar ve oturum bilgisi cihazdaki tarayıcıda saklanır. Cihaza veya tarayıcı profiline erişebilen biri bunlara da erişebilir. Ortak kullanılan bir cihazda işiniz bitince çıkış yapın ve gerekirse tarayıcının bu siteye ait verilerini silin.

Davet bağlantısı anahtarı içerdiği için bağlantıyı gören herkes mesajları okuyabilecek duruma gelir. Bağlantıyı yalnızca güvendiğiniz kişilere, mümkünse uçtan uca şifreli bir mesajlaşma uygulamasıyla gönderin.

Bu proje bağımsız bir güvenlik denetiminden geçmemiştir ve hiçbir yazılım için hiç açığı olmadığı garanti edilemez. Bir açık bulursanız lütfen [SECURITY.md](SECURITY.md) dosyasındaki yolu izleyin.

### Uygulanan önlemler

Parolalar scrypt ile karma alınarak saklanır, oturum belirteçleri (token) diskte yalnızca karma olarak tutulur. Kayıt, giriş, mesaj gönderme, dosya yükleme ve yönetim işlemlerinde hız sınırları vardır. Sahip hesabı yalnızca sunucu penceresinde görünen kurulum koduyla, diğer hesaplar yalnızca davet koduyla oluşturulabilir. Sunucu yetkileri her istekte kendisi denetler, yalnızca uygulamanın kendi dosyalarını sunar ve mesaj içeriklerini, parolaları ve oturum belirteçlerini kayda geçirmez. Tarayıcı tarafında katı bir içerik güvenlik politikası (CSP) uygulanır ve kullanıcı verisi hiçbir zaman HTML olarak yorumlanmaz. İndirilen dosyalar sitenin içinde açılmaz, yalnızca cihaza kaydedilir.

## Gereksinimler

Sunucuyu çalıştıracak bilgisayarda Node.js 20 veya daha yeni bir sürüm kurulu olmalıdır. Node.js https://nodejs.org adresinden indirilebilir. Sunucunun başka bağımlılığı yoktur, `npm install` çalıştırmanız gerekmez. Sunucu bilgisayarı Windows, macOS veya Linux olabilir, Windows için hazır `baslat.bat` ve `tunel.bat` betikleri vardır. Otomatik testler Windows ve Linux üzerinde çalıştırılır, macOS'ta otomatik test yapılmaz.

İnternetteki arkadaşların bağlanabilmesi için sunucu bilgisayarında Cloudflare'in `cloudflared` programı da gerekir. Kurulumu aşağıdaki "İnternete açma" bölümünde anlatılmıştır.

Bağlanacak kişilerin yalnızca güncel bir web tarayıcısına ihtiyacı vardır. Sesli sohbet ve uygulama olarak yükleme için adresin https ile açılması gerekir. Sunucuyu çalıştıran bilgisayar sohbet süresince açık kalmalı ve uyku moduna geçmemelidir.

## İlk kurulum

### Projeyi indirme

1. https://nodejs.org adresini açın.
2. Node.js'in 20 veya daha yeni bir sürümünü indirin.
3. İndirdiğiniz dosyayla Node.js'i kurun.
4. Projeyi https://github.com/Yerlifan/ps5-pc-communication sayfasından ZIP dosyası olarak indirin.
5. ZIP dosyasını bilgisayarınızda bir klasöre çıkarın.

Git kullananlar projeyi `git clone https://github.com/Yerlifan/ps5-pc-communication` komutuyla da indirebilir.

### Sunucuyu başlatma

Windows'ta:

1. Proje klasöründeki `baslat.bat` dosyasına çift tıklayın.
2. Windows güvenlik duvarı Node.js için izin isterse izin verin.
3. Açılan pencerede yazan kurulum kodunu not edin.
4. Sohbet sürdüğü sürece bu pencereyi açık bırakın.

macOS ve Linux'ta:

1. Bir terminal açın.
2. Proje klasörüne geçin.
3. `node server.js` komutunu çalıştırın.

Kurulum kodu sunucu penceresinde `Kurulum kodu: ABCDE-FGHJK` biçiminde görünür. Kod yalnızca sahip hesabı oluşturulana kadar geçerlidir ve sunucu her başlatıldığında yenilenir. Pencerede ayrıca sunucunun adresleri, veri klasörü ve sesli sohbet için https gerektiği bilgisi yer alır. Güvenlik duvarı izni yalnızca aynı ev ağındaki cihazların bağlanması için gereklidir.

Sunucuyu durdurmak için pencerede Ctrl+C tuşlarına basın. Windows toplu işin sonlandırılmasını onaylamanızı isterse onaylayın. Ctrl+C ile durdurmak, bekleyen kayıtların diske yazılmasını sağlar. Hesaplar, kanallar ve mesajlar `veri` klasöründe saklanır ve sunucu yeniden başlatıldığında korunur. Pencerede bağlantı noktasının kullanımda olduğunu bildiren bir hata görürseniz sunucu büyük olasılıkla başka bir pencerede zaten çalışıyordur.

### Hangi adresi kullanacağınızı seçme

Sunucuya üç tür adresle ulaşılabilir. Tarayıcı her adresi ayrı bir site olarak görür, giriş bilgisi ve şifreleme anahtarı her adres için ayrı saklanır.

| Adres | Kimler kullanabilir | Sesli sohbet ve uygulama yükleme |
|---|---|---|
| `http://localhost:3000` | Yalnızca sunucuyu çalıştıran bilgisayar | Sesli sohbet çalışır |
| Ev ağı adresi, ör. `http://192.168.1.20:3000` | Aynı modeme bağlı cihazlar | Çalışmaz, yalnızca yazılı sohbet |
| Tünel adresi, `https://....trycloudflare.com` | İnternete bağlı herkes | Çalışır |

Ev ağı adresindeki sayılar yalnızca örnektir, kendi adresiniz sunucu penceresinde yazar.

Davet bağlantısı, uygulamayı açtığınız adresi içerir. Bu yüzden sahip hesabını arkadaşlarınızın kullanacağı adresten oluşturun. İnternetteki arkadaşlar katılacaksa önce aşağıdaki "İnternete açma" bölümüne göre tüneli açın ve kurulumu tünel adresinden yapın.

### Sahip hesabını oluşturma

1. Arkadaşlarınızın kullanacağı adresi tarayıcıda açın.
2. Kurulum ekranında kullanıcı adınızı yazın.
3. Parolanızı yazın.
4. Parolanızı tekrar yazın.
5. Sunucu penceresindeki kurulum kodunu yazın.
6. Formu onaylayın.

Kullanıcı adı 2 ile 20 karakter arasında olmalı ve yalnızca harf, rakam, boşluk, nokta, alt çizgi veya kısa çizgi içermelidir. Büyük ve küçük harf farkı gözetilmez, örneğin "IŞIK" ve "ışık" aynı ad sayılır. Parola 8 ile 128 karakter arasında olmalıdır.

### Şifreleme anahtarı ve davet bağlantısı

Sahip hesabı oluşunca tarayıcınız sunucu için bir şifreleme anahtarı üretir ve davet ekranını gösterir. Bu ekranda davet bağlantısı ve anahtar kodu bulunur.

1. Anahtar kodunu kopyalayın.
2. Anahtar kodunu bir parola yöneticisi gibi güvenli bir yerde saklayın.
3. Davet bağlantısını kopyalayın.
4. "Devam" düğmesine basın.

Anahtar kodu `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` biçiminde 28 karakterdir. Anahtar sunucuya hiç gönderilmez. Anahtar kaybolursa şifreli mesaj geçmişi hiçbir yolla okunamaz, bu yüzden anahtar kodunu mutlaka saklayın. Tünel adresi değiştiğinde de anahtar koduna ihtiyacınız olacak.

Davet bağlantısı `https://....trycloudflare.com/#davet=XXXXX-XXXXX&anahtar=XXXX-...` biçimindedir ve hem davet kodunu hem anahtarı içerir. Bağlantıyı bir parola gibi koruyun. Davet bağlantısına ve anahtar koduna daha sonra Ayarlar penceresinin "Şifreleme" sekmesinden de ulaşabilirsiniz. Ayarlar penceresi, sol sütunun altındaki kullanıcı panelinde bulunan dişli düğmesiyle açılır. Dar ekranlarda kullanıcı paneli, kanal listesiyle birlikte sol çekmecededir.

## İnternete açma

### Cloudflare hızlı tüneli

Farklı evlerdeki arkadaşlar için önerilen yol Cloudflare'in hızlı tünel hizmetidir (Quick Tunnel). Hesap açmak ve modemde ayar yapmak gerekmez. `cloudflared tunnel --url http://localhost:3000` komutu sunucuyu rastgele bir `trycloudflare.com` adresiyle internete açar ve bu adres https ile çalışır. `tunel.bat` bu komutu sizin yerinize çalıştırır.

Windows'ta:

1. Başlat menüsünden bir komut istemi veya PowerShell penceresi açın.
2. `winget install --id Cloudflare.cloudflared` komutunu çalıştırın.
3. Kurulum bitince açık olan tüm komut istemi ve PowerShell pencerelerini kapatın.
4. `baslat.bat` ile sunucuyu başlatın.
5. `tunel.bat` dosyasına çift tıklayın.
6. Çıktıda görünen `https://....trycloudflare.com` biçimindeki adresi fareyle seçin.
7. Seçili adresi kopyalayın.
8. Sohbet sürdüğü sürece iki pencereyi de açık bırakın.

`cloudflared` zaten kuruluysa ilk üç adımı atlayın. `winget` ilk kullanımda bir onay isterse kabul edin. Adresi kopyalarken dikkatli olun, hiçbir metin seçili değilken Ctrl+C tuşlarına basmak tüneli kapatır. `baslat.bat` içinde `PORT` değerini değiştirdiyseniz `tunel.bat` içindeki 3000 değerini de aynı sayıyla değiştirin. Diğer sistemlerde `cloudflared` programını Cloudflare'in kendi belgelerinde anlatılan yöntemle kurun ve sunucu çalışırken ayrı bir terminalde yukarıdaki komutu çalıştırın.

Hızlı tünelin sınırları vardır. Adres her çalıştırmada değişir. Hizmetin çalışma süresi için garanti verilmez. Eşzamanlı 200 istek sınırı vardır. Uygulama her bağlı cihaz için sunucuda sürekli bekleyen bir istek tuttuğu için çok sayıda cihaz aynı anda bağlıyken bu sınıra yaklaşılabilir. trycloudflare.com adresine Türkiye'den erişilip erişilemediği doğrulanmadı, kendi bağlantınızda denemeniz gerekir. Tünelin TLS bağlantısını Cloudflare tarafında sonlandırmasının güvenliğe etkisi "Güvenlik ve şifreleme modeli" bölümünde anlatılmıştır.

### Adres değişince yapılacaklar

Tarayıcı giriş bilgisini ve şifreleme anahtarını adrese göre sakladığı için tünel adresi değişince herkesin yeniden giriş yapması ve anahtarı yeniden eklemesi gerekir. Hesaplar, kanallar ve mesajlar sunucuda kaldığı için hiçbir şey kaybolmaz. En kolay yol, sahibin veya bir yöneticinin yeni adresi içeren yeni bir davet bağlantısı göndermesidir.

Sahip veya yönetici:

1. Yeni tünel adresini tarayıcıda açın.
2. "Giriş yap" sekmesinden giriş yapın.
3. Anahtar ekranında sakladığınız anahtar kodunu yazın.
4. "Ekle" düğmesine basın.
5. Ayarlar penceresini açın.
6. "Şifreleme" sekmesinde "Davet bağlantısını kopyala" düğmesine basın.
7. Yeni bağlantıyı herkese gönderin.

Diğer herkes:

1. Yeni davet bağlantısını açın.
2. "Giriş yap" sekmesinden mevcut hesabınızla giriş yapın.

Telefona veya bilgisayara uygulama olarak yüklenmiş sohbet, yüklendiği eski adrese bağlı kalır ve adres değişince çalışmaz. Eski uygulamayı kaldırıp yeni adresten yeniden yükleyin.

### Kalıcı adres

Adresin her seferinde değişmesini istemiyorsanız iki seçenek vardır. Birincisi, kendi alan adınızla ve bir Cloudflare hesabıyla adlandırılmış bir tünel (named tunnel) kurmaktır. İkincisi, sunucuyu sürekli açık duran bir sanal sunucuda (VPS) kendi alan adınız ve https ile çalıştırmaktır. Her iki yolun ayrıntıları bu belgenin kapsamı dışındadır, Cloudflare'in veya kullandığınız sağlayıcının belgelerine bakın. Kalıcı bir adreste yukarıdaki yeniden giriş ve yeni bağlantı adımlarına gerek kalmaz.

### Ev ağında kullanım

Sunucuyla aynı modeme bağlı cihazlar, sunucu penceresinde listelenen ev ağı adresiyle tünel olmadan bağlanabilir. Bu adreste yazılı sohbet ve şifreleme çalışır, ancak sesli sohbet ve uygulama olarak yükleme https gerektirdiği için çalışmaz. Bu adreste parola ve oturum bilgisi ağda şifresiz gider, bu yüzden adresi yalnızca güvendiğiniz bir ev ağında kullanın. Bağlantı kurulamıyorsa sunucunun çalıştığından ve Windows güvenlik duvarının Node.js'e izin verdiğinden emin olun.

Modemde port yönlendirme yaparak `http://` adresini internete açmak önerilmez. Bu durumda parolalar internet üzerinde şifresiz taşınır ve sesli sohbet çalışmaz.

## Arkadaşların katılması

Yeni bir kişiyi davet etmek için sahip veya bir yönetici davet bağlantısını gönderir. Davet kodunu yalnızca sahip ve yöneticiler görebildiği için üyelerin kopyaladığı bağlantı yalnızca anahtarı içerir ve yeni hesap açmaya yetmez.

Davet eden kişi:

1. Ayarlar penceresinin "Şifreleme" sekmesinde "Davet bağlantısını kopyala" düğmesine basın.
2. Bağlantıyı uçtan uca şifreli bir mesajlaşma uygulamasıyla gönderin.

Katılan kişi:

1. Bağlantıyı tarayıcıda açın.
2. "Kayıt ol" sekmesini seçin.
3. Kullanıcı adınızı yazın.
4. Parolanızı yazın.
5. Parolanızı tekrar yazın.
6. Davet kodu alanının dolu olduğunu kontrol edin.
7. Formu onaylayın.

Bağlantıyı açtığınızda anahtar tarayıcıya otomatik olarak eklenir ve adres çubuğundan silinir. Sonraki ziyaretlerde "Giriş yap" sekmesini kullanın.

Başka bir cihazdan bağlandığınızda o cihazda anahtar bulunmaz. Bu durumda aynı bağlantıyı o cihazda yeniden açıp "Giriş yap" sekmesinden giriş yapın. Bağlantı elinizde değilse giriş yaptıktan sonra anahtar ekranında anahtar kodunu elle yazabilirsiniz. Anahtar olmadan da uygulamaya girilebilir, ancak bu durumda mesajlar "[Şifreli mesaj, anahtar yok]" olarak görünür ve mesaj gönderilemez.

Giriş sırasında "Kullanıcı adı veya parola hatalı." uyarısını alırsanız bilgilerinizi kontrol edin. Çok sayıda hatalı denemeden sonra bir süre beklemeniz gerekir. Parolanızı unutursanız sahipten parolanızı sıfırlamasını isteyin.

## Mesajlaşma, fotoğraf ve dosya paylaşımı

Mesaj yazma alanında Enter tuşu mesajı gönderir, Shift+Enter yeni satır açar. Bir mesaj en fazla 2000 karakter olabilir. Her mesajın yanındaki "..." düğmesiyle açılan menüden kendi mesajınızı düzenleyebilir veya silebilirsiniz. Sahip ve yöneticiler herkesin mesajını silebilir. Eski mesajlar için listenin üstündeki "Daha eski mesajları yükle" düğmesini kullanın. Mesajlardaki bağlantılar güvenlik nedeniyle tıklanabilir değildir, düz metin olarak görünür.

"Fotoğraf" düğmesi telefonlarda kamerayı veya galeriyi açar. Bilgisayarda resim yapıştırarak veya sürükleyip bırakarak da gönderebilirsiniz. Fotoğraflar gönderilmeden önce tarayıcıda yeniden kodlanır. Bu işlem konum (GPS) bilgisi dahil tüm üst verileri siler ve en uzun kenarı 2560 pikseli aşan fotoğrafları küçültür. PNG resimler PNG olarak kalır, diğer fotoğraflar JPEG olarak gönderilir. GIF dosyaları animasyonları korunsun diye yeniden kodlanmadan, olduğu gibi gönderilir. Bir JPEG fotoğraf tarayıcıda işlenemezse konum bilgisi sızmasın diye özgün hâliyle gönderilmez ve "Fotoğraf işlenemedi." uyarısı görünür. Tarayıcının açamadığı resim türleri fotoğraf olarak işlenemez, dosya olarak ve üst verileri silinmeden gönderilir.

"Dosya" düğmesiyle her türden dosya gönderilebilir. Bir dosya en fazla 25 MB olabilir ve bir mesaja en fazla 10 ek eklenebilir. Dosyanın içeriği gibi adı ve türü de şifrelenir, sunucu yalnızca şifreli dosyanın boyutunu görür. Dosyalar mesajda kart olarak görünür ve "İndir" düğmesiyle cihaza kaydedilir, tarayıcıda açılmaz. Program çalıştırabilen dosyalar (ör. `.exe`, `.bat`, `.apk`) "Çalıştırılabilir dosya" uyarısıyla işaretlenir ve indirmeden önce onay istenir. Bu tür dosyaları yalnızca gönderene güveniyorsanız indirin. Tüm yüklemelerin toplam boyutu varsayılan olarak 2048 MB ile sınırlıdır.

"Emoji" düğmesi kategorilere ayrılmış bir emoji seçici açar. İlk sekmede o cihazda son kullandığınız emojiler bulunur. Yalnızca emojiden oluşan kısa mesajlar büyük gösterilir. Emojilerin görünümü cihazın yazı tiplerine bağlıdır.

Okunmamış mesajlar kanal listesinde kalın yazı ve sayıyla gösterilir. Ayarlar penceresinin "Hesap" sekmesinden tarayıcı bildirimlerini açabilirsiniz. Bildirimler yalnızca uygulama bir sekmede veya pencerede açıkken gelir.

## PS5'ten kullanım

PS5'in resmi bir tarayıcı uygulaması yoktur. Sistemdeki gizli tarayıcı resmi olmayan yollarla açılır ve bu yollar sistem yazılımı güncellemeleriyle değişebilir veya kapanabilir. Aşağıdaki yöntem ikincil kaynaklarda bildirilmiştir ve bu proje kapsamında doğrulanmamıştır. Menü adları PS5'in İngilizce arayüzüne göre verilmiştir, Türkçe arayüzdeki adlar doğrulanmadı.

Bildirilen yöntem, sohbet adresini Game Base üzerinden bir arkadaşa veya ikinci bir hesaba mesaj olarak göndermek ve mesajdaki bağlantıyı seçmektir.

1. PS5'te Game Base bölümünü açın.
2. Bir arkadaşınızı, bir grubu veya ikinci hesabınızı seçin.
3. Sohbet adresini mesaj olarak gönderin.
4. Konuşmadaki bağlantıyı seçin.

Adres mesajda seçilebilir bir bağlantı olarak görünmüyorsa PS5 adresi bağlantı olarak tanımamış olabilir. Tünel adresi gibi alan adı içeren adreslerin, ev ağındaki sayısal adreslere göre bağlantı olarak tanınma olasılığının daha yüksek olduğu varsayılmaktadır, ancak bu da doğrulanmadı.

Davet bağlantısını PSN mesajıyla göndermek, şifreleme anahtarının Sony'nin sunucularından geçmesi demektir. Bunu istemiyorsanız mesajla yalnızca adresi, yani `#` işaretinden önceki bölümü gönderin ve kodları PS5'te elle yazın.

1. Hesabınız yoksa "Kayıt ol" sekmesinde davet kodunu elle yazarak kayıt olun.
2. Hesabınız varsa "Giriş yap" sekmesinden giriş yapın.
3. Anahtar ekranında anahtar kodunu elle yazın.
4. "Ekle" düğmesine basın.

Anahtar kodunu yazarken büyük ve küçük harf fark etmez, tireleri ve boşlukları yazmanız gerekmez. O harfi sıfır, I ve L harfleri bir olarak okunur. Kodun son iki karakteri bir sağlama değeri olduğu için yazım hatalarının büyük çoğunluğu yakalanır.

PS5 tarayıcısının giriş bilgisini ve anahtarı kalıcı olarak saklayıp saklamadığı doğrulanmadı. Saklamıyorsa her açılışta giriş yapmanız ve anahtarı yeniden eklemeniz gerekir. Tünel adresi değiştiğinde yeni adresi PS5'e yeniden göndermeniz gerekir.

Yazılı sohbet ve şifreleme, PS5 tarayıcısında https olmadan da çalışacak şekilde tasarlandı. PS5 tarayıcısında sesli sohbetin, fotoğraf ve dosya seçmenin ve dosya indirmenin çalışıp çalışmadığı doğrulanmadı. Arayüz televizyonda okunabilmesi için geniş ekranlarda büyük yazı ve büyük düğmelerle gösterilir. Metin kutusu seçildiğinde PS5'in ekran klavyesinin açılması beklenir.

PS5 oyuncusu oyun sırasında sesli sohbete telefonunun tarayıcısından katılabilir. Telefonda da aynı hesapla giriş yapılır ve anahtar eklenir.

## Telefon, tablet ve bilgisayara uygulama olarak yükleme

Uygulama telefon, tablet ve bilgisayarda bir uygulama gibi yüklenebilir (PWA). Yükleme için adresin https ile açılması gerekir, bu yüzden tünel adresini veya kendi https adresinizi kullanın. Ev ağındaki `http://` adresinden yükleme yapılamaz.

| Cihaz ve tarayıcı | Yükleme yolu |
|---|---|
| Bilgisayarda Chrome veya Edge | Adres çubuğundaki yükleme simgesi veya tarayıcı menüsündeki uygulama yükleme seçeneği |
| Android'de Chrome | Tarayıcı menüsündeki ana ekrana ekleme veya yükleme seçeneği |
| iPhone ve iPad'de Safari | Paylaş menüsünden Ana Ekrana Ekle |

Destekleyen tarayıcılarda Ayarlar penceresinin "Hesap" sekmesinde "Uygulamayı yükle" düğmesi de görünür. iOS'ta aynı sekmede Safari için kısa bir ipucu gösterilir. Menü adları tarayıcının sürümüne ve diline göre farklı olabilir.

Yüklenen uygulama yüklendiği adrese bağlıdır. Hızlı tünel adresi değişince eski uygulamayı kaldırıp yeni adresten yeniden yükleyin.

## Sesli sohbet

1. Uygulamayı https adresinden açın.
2. Sol sütunda bir ses kanalına tıklayın.
3. Tarayıcı mikrofon izni isterse izin verin.
4. Ayrılmak için "Bağlantıyı kes" düğmesine basın.

Sunucu bilgisayarında `http://localhost:3000` adresinden de sesli sohbete katılabilirsiniz. Ev ağı adresinde sesli sohbet çalışmaz, çünkü tarayıcılar mikrofona yalnızca güvenli adreslerde izin verir. Başka bir ses kanalına tıklamak sizi o kanala taşır. Dar ekranlarda ses kanalları ve kullanıcı paneli sol çekmecededir. Sesli sohbet için şifreleme anahtarı gerekir.

Kullanıcı panelindeki mikrofon düğmesi mikrofonunuzu kapatır, kulaklık düğmesi sizi sağırlaştırır. Sağırlaştırıldığınızda kimseyi duymazsınız ve mikrofonunuz da kapanır. Konuşan kişilerin çevresinde yeşil bir halka görünür. Ses kanalındaki bir kişiye tıklayınca açılan panelden o kişinin ses seviyesini değiştirebilir veya onu yalnızca kendiniz için susturabilirsiniz. Kişi bazlı ses seviyesi en fazla %100'dür, yani bir kişinin sesi kısılabilir ama yükseltilemez. Tarayıcı sesi kendiliğinden başlatmayı engellerse "Sesi başlat" düğmesine basın.

Ayarlar penceresinin "Ses" sekmesinde mikrofon seçebilir ve bas-konuşu açabilirsiniz. Bas-konuş açıkken mikrofonunuz yalnızca seçtiğiniz tuşu basılı tuttuğunuz sürece açıktır. Varsayılan tuş V'dir ve "Tuşu değiştir" düğmesiyle değiştirilebilir. Dokunmatik ekranlarda basılı tutulacak büyük bir "Bas konuş" düğmesi görünür.

Ses kişiler arasında doğrudan akar ve sohbet sunucusundan geçmez. Her kişi sesini kanaldaki diğer herkese ayrı ayrı gönderdiği için kalabalık kanallarda internet kullanımı artar. Ses kanalı başına en fazla 8 kişi katılabilir. Yankıyı önlemek için kulaklık kullanmanız önerilir. Sesli sohbette kişiler birbirinin IP adresini görebilir.

Doğrudan bağlantı kurmak için Google'ın herkese açık STUN sunucusu kullanılır. Bazı ağlarda, örneğin bazı mobil hatlarda veya CGNAT arkasında, doğrudan bağlantı kurulamayabilir (bu doğrulanmadı). Bu durumda uygulama bazı kişilerle ses bağlantısı kurulamadığını bildirir ve bir TURN sunucusu gerekir. Kendi TURN sunucunuzu (ör. coturn) kurabilir veya bir TURN hizmeti kullanabilirsiniz. TURN sunucusunun adresini ve bilgilerini `baslat.bat` içindeki `TURN_URL`, `TURN_KULLANICI` ve `TURN_SIFRE` satırlarına yazın.

Telefonda tarayıcı arka plana alındığında veya ekran kilitlendiğinde sesin sürüp sürmediği işletim sistemine ve tarayıcıya göre değişebilir, bu doğrulanmadı. Destekleyen tarayıcılarda seste iken ekranın kendiliğinden kapanması engellenir.

Kod gerektirmeyen bir alternatif olarak, PlayStation'ın resmi destek sayfasına göre PS5 parti sesli sohbeti PlayStation konsolları ve PlayStation App ile çalışır: https://www.playstation.com/en-us/support/games/ps5-party-voice-chat/

## Yönetim

### Roller

| İşlem | Sahip | Yönetici | Üye |
|---|---|---|---|
| Kanal oluşturma, yeniden adlandırma, sıralama ve silme | Evet | Evet | Hayır |
| Başkasının mesajını silme | Evet | Evet | Hayır |
| Kendi mesajını düzenleme ve silme | Evet | Evet | Evet |
| Davet kodunu görme ve yenileme | Evet | Evet | Hayır |
| Yeni şifreleme anahtarı oluşturma | Evet | Evet | Hayır |
| Sunucu adını değiştirme | Evet | Hayır | Hayır |
| Yönetici yapma ve üyeliğe indirme | Evet | Hayır | Hayır |
| Engelleme ve engeli kaldırma | Kendisi dışında herkesi | Yalnızca üyeleri | Hayır |
| Başkasının parolasını sıfırlama | Evet | Hayır | Hayır |

Sahip tektir, kurulumda oluşturulan hesaptır, rolü değiştirilemez ve engellenemez.

### Kanallar

Sahip ve yöneticiler Ayarlar penceresinin "Sunucu" sekmesinden yazı ve ses kanalı oluşturabilir, kanalları yeniden adlandırabilir, yukarı veya aşağı taşıyabilir ve silebilir. Bir kanal silinince içindeki tüm mesajlar ve dosyalar da silinir. En az bir yazı kanalı her zaman kalır. Kanal adları şifrelenmez. İlk kurulumda `genel` ve `oyun` yazı kanalları ile `Ses 1` ve `Ses 2` ses kanalları oluşturulur. Sunucu adını yalnızca sahip aynı sekmeden değiştirebilir.

### Davet kodu

Davet kodu "Sunucu" sekmesinde görüntülenebilir ve yenilenebilir. Kod yenilenince eski davet bağlantılarıyla yeni hesap açılamaz, mevcut hesaplar bundan etkilenmez.

### Üyeler, engelleme ve parola sıfırlama

"Üyeler" sekmesinde kullanıcılar, rolleri ve çevrimiçi durumları görünür. Sahip bir üyeyi yönetici yapabilir veya bir yöneticiyi üyeliğe indirebilir. Engellenen kişinin tüm oturumları kapanır ve bu kişi yeniden giriş yapamaz. Engellenen kişi davet kodunu ve şifreleme anahtarını bildiği için engellemeden sonra davet kodunu yenilemeniz ve gerekiyorsa yeni bir anahtar oluşturmanız önerilir.

Sahip, parolasını unutan bir kişinin parolasını "Üyeler" sekmesinden sıfırlayabilir. Geçici parola yalnızca bir kez gösterilir. Bu parolayı kişiye güvenli bir yolla iletin. Kişi giriş yaptıktan sonra "Hesap" sekmesinden parolasını değiştirmelidir.

### Sahip parolasını sıfırlama

Sahip kendi parolasını unutursa tek kurtarma yolu, parolayı sunucu bilgisayarında komut satırından sıfırlamaktır. Bu komut sunucu çalışmıyorken kullanılmalıdır.

Windows'ta:

1. Sunucu penceresinde Ctrl+C tuşlarına basarak sunucuyu durdurun.
2. Proje klasörünü Dosya Gezgini'nde açın.
3. Adres çubuğuna `cmd` yazıp Enter tuşuna basın.
4. Açılan pencerede `node server.js sifre-sifirla KullanıcıAdı` komutunu çalıştırın.
5. Ekranda görünen geçici parolayı not edin.
6. `baslat.bat` ile sunucuyu yeniden başlatın.
7. Geçici parolayla giriş yapın.
8. Ayarlar penceresinin "Hesap" sekmesinden yeni bir parola belirleyin.

Komuttaki `KullanıcıAdı` yerine kendi kullanıcı adınızı yazın. Ad boşluk içeriyorsa tırnak içine alın, örneğin `node server.js sifre-sifirla "Ali Veli"`. Komut, geçici parolayı ayarlarken hesabın tüm oturumlarını da kapatır. Sunucu çalışırken kullanılırsa komut reddedilir. `baslat.bat` içinde `VERI_KLASORU` ayarı eklediyseniz komuttan önce aynı pencerede aynı değeri `set "VERI_KLASORU=..."` biçiminde verin. macOS ve Linux'ta aynı komut proje klasöründe bir terminalde çalıştırılır.

### Anahtarı yenileme

Davet bağlantısı istenmeyen birinin eline geçtiyse veya birini gruptan çıkardıysanız yeni bir şifreleme anahtarı oluşturun. Bu işlemi sahip ve yöneticiler yapabilir.

1. Ayarlar penceresini açın.
2. "Şifreleme" sekmesine geçin.
3. "Yeni anahtar oluştur" düğmesine basın.
4. Görünen uyarıyı okuyun.
5. Yeni anahtar kodunu görüntüleyip güvenli bir yerde saklayın.
6. "Davet bağlantısını kopyala" düğmesiyle yeni bağlantıyı alın.
7. Yeni bağlantıyı gruptaki herkese gönderin.

Yeni anahtar yalnızca bundan sonraki mesajları korur. Eski anahtarı silmeyin, eski mesajlar onunla okunur. Gruptan çıkardığınız kişi eski anahtarı bildiği için o anahtarla şifrelenmiş eski mesajları okuyabilir. Anahtar yenilendikten sonra katılan kişilerin bağlantısında yalnızca yeni anahtar bulunur ve bu kişiler eski mesajları okuyamaz. Eski mesajları okuması gereken birine eski anahtar kodunu ayrıca iletebilirsiniz.

## Yedekleme

Hesaplar, kanallar, şifreli mesajlar ve şifreli dosyalar `server.js` ile aynı klasördeki `veri` klasöründe saklanır. Mesaj geçmişi kanal başına son 20000 mesajla sınırlıdır, daha eski mesajlar ve ekleri silinir.

Yedek almak için:

1. Sunucuyu Ctrl+C ile durdurun.
2. `veri` klasörünü başka bir yere kopyalayın.
3. Sunucuyu yeniden başlatın.

Yedeği geri yüklemek için:

1. Sunucuyu Ctrl+C ile durdurun.
2. Mevcut `veri` klasörünün yerine yedeği koyun.
3. Sunucuyu yeniden başlatın.

Şifreleme anahtarı `veri` klasöründe bulunmaz ve ayrıca saklanmalıdır. Anahtar kaybolursa yedekteki geçmiş de okunamaz ve bunun bir kurtarma yolu yoktur. Yedek, parolaların scrypt karmalarını ve davet kodunu içerdiği için yedeği de özenle saklayın. Yedeği ve anahtar kodunu aynı yerde tutmayın. Sunucuyu başka bir bilgisayara taşımak için proje dosyalarını ve `veri` klasörünü birlikte kopyalamanız yeterlidir.

## Ayarlar

Sunucu aşağıdaki ortam değişkenlerini okur. Windows'ta bu değerler `baslat.bat` içindeki `set` satırlarıyla verilir. `baslat.bat` içinde satırı olmayan bir ayar için `node server.js` satırından önce `set "HOST=127.0.0.1"` biçiminde yeni bir satır ekleyebilirsiniz.

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `3000` | Sunucunun dinlediği bağlantı noktası. Değiştirirseniz `tunel.bat` içindeki değeri de değiştirin. |
| `HOST` | `0.0.0.0` | Sunucunun dinlediği ağ adresi. Varsayılan değer tüm ağ arayüzlerini dinler. Yalnızca bu bilgisayardan erişim için `127.0.0.1` yazılabilir. |
| `SUNUCU_ADI` | `Sohbet` | Yalnızca ilk kurulumda kullanılan başlangıç adı, en fazla 40 karakter. Kurulumdan sonra sahip, adı Ayarlar penceresinin "Sunucu" sekmesinden değiştirir. |
| `VERI_KLASORU` | `server.js` ile aynı klasördeki `veri` | Hesapların, mesajların ve yüklemelerin saklandığı klasör |
| `MAKS_YUKLEME_MB` | `25` | Tek bir dosyanın en büyük boyutu (MB) |
| `YUKLEME_KOTASI_MB` | `2048` | Tüm yüklemelerin toplam üst sınırı (MB) |
| `STUN_URL` | `stun:stun.l.google.com:19302` | Sesli sohbette kullanılan STUN sunucusu. Virgülle ayrılmış birden çok adres yazılabilir. |
| `TURN_URL` | boş | TURN sunucusunun adresi. Doluysa sesli sohbette kullanılır. |
| `TURN_KULLANICI` | boş | TURN sunucusunun kullanıcı adı |
| `TURN_SIFRE` | boş | TURN sunucusunun parolası |

`baslat.bat` dosyasını düzenlemek için:

1. Sunucu penceresini kapatın.
2. `baslat.bat` dosyasını Not Defteri ile açın.
3. İlgili `set` satırında tırnak içindeki değeri değiştirin.
4. Dosyayı kaydedin.
5. `baslat.bat` dosyasına yeniden çift tıklayın.

Çift tıklamak dosyayı çalıştırır, düzenlemek için dosyayı Not Defteri ile açmanız gerekir. Değerlerde yüzde işareti ve çift tırnak kullanmayın, bunlar `baslat.bat` içinde sorun çıkarabilir. Diğer sistemlerde değişkenleri komutun önüne yazabilirsiniz:

```sh
PORT=4000 SUNUCU_ADI="Cuma Akşamı" node server.js
```

Aşağıdaki sınırlar sunucunun kodunda tanımlıdır ve ortam değişkeniyle değiştirilemez.

| Sınır | Değer |
|---|---|
| Mesaj uzunluğu | En fazla 2000 karakter |
| Mesaj başına ek | En fazla 10 |
| Aynı anda işlenen yükleme | 4, fazlası kısa bir süre sonra yeniden denenir |
| Kullanıcı adı | 2 ile 20 karakter arası |
| Parola | 8 ile 128 karakter arası |
| Kanal adı | En fazla 30 karakter |
| Kanal sayısı | En fazla 50 |
| Ses kanalı başına kişi | En fazla 8 |
| Kullanıcı sayısı | En fazla 500 |
| Kanal başına saklanan mesaj | Son 20000 mesaj |
| Oturum süresi | Son kullanımdan itibaren 90 gün |
| Kullanıcı başına oturum | En fazla 10, fazlasında en eski oturum kapanır |
| Mesaj gönderme ve düzenleme hızı | Kişi başına 5 saniyede 5 |
| Dosya yükleme hızı | Kişi başına dakikada 10 |
| Kayıt ve giriş denemesi | IP adresi başına 10 dakikada 20 |
| Başarısız giriş | Hesap başına 15 dakikada 10 |

## Bilinen sınırlamalar

PS5 tarayıcısı resmi olarak desteklenmez ve sistem yazılımı güncellemeleriyle değişebilir. PS5'te tarayıcıyı açma yolu, sesli sohbet, fotoğraf ve dosya seçme, dosya indirme ve tarayıcının giriş bilgisini ve anahtarı kalıcı olarak saklaması doğrulanmadı. Türkçe PS5 menü adları da doğrulanmadı.

Hızlı tünel adresi her çalıştırmada değişir, hizmetin çalışma süresi garanti edilmez ve eşzamanlı 200 istek sınırı vardır. trycloudflare.com adresinin Türkiye'den erişilebilirliği doğrulanmadı. Adres değişince herkesin yeniden giriş yapması ve yeni davet bağlantısını açması gerekir.

Sesli sohbet yalnızca https adresinde ve sunucu bilgisayarındaki `http://localhost:3000` adresinde çalışır. Ses kanalı başına en fazla 8 kişi katılabilir. Bazı ağlarda TURN sunucusu gerekebilir. Sesli sohbette kişiler birbirinin IP adresini görebilir.

Şifreleme modelinin sınırları "Güvenlik ve şifreleme modeli" bölümünde anlatılmıştır. Özetle uygulama kodu sunucudan geldiği için sunucuya ve tünele güvenmek gerekir, üst veriler şifrelenmez, grup anahtarı ortaktır ve ileriye dönük gizlilik yoktur. Şifreleme anahtarı kaybolursa geçmiş okunamaz.

Mesaj geçmişi kanal başına son 20000 mesajla sınırlıdır. Sunucuyu çalıştıran bilgisayar kapanır veya uyku moduna geçerse sohbet de durur. Bildirimler yalnızca uygulama açıkken gelir, uygulama kapalıyken bildirim gönderen bir hizmet yoktur.

Özel mesaj, mesaj tepkileri, yanıt zinciri, bahsetme, arama, birden çok sunucu, görüntülü görüşme, ekran paylaşımı, mesaj sabitleme ve profil resmi yükleme bu projenin kapsamı dışındadır.

## Geliştirme ve testler

Sunucu yalnızca Node.js'in yerleşik modülleriyle çalışır. Geliştirme araçları (`acorn` ve `playwright`) yalnızca geliştirme bağımlılığıdır ve sürümleri sabittir.

```sh
npm ci
npm test
npm run denetle
npm run test:e2e
```

`npm test` birim ve sunucu testlerini, `npm run denetle` yazım, sözdizimi ve güvenlik kurallarını, `npm run test:e2e` gerçek bir Chromium tarayıcısıyla uçtan uca testleri çalıştırır. Uçtan uca testler için Playwright'ın Chromium tarayıcısı gerekir. Geliştirme ortamı, kod kuralları ve katkı süreci [CONTRIBUTING.md](CONTRIBUTING.md) dosyasında, mimari ve protokol ayrıntıları [docs/MIMARI.md](docs/MIMARI.md) dosyasındadır.

## Katkıda bulunma

![CI durumu](https://github.com/Yerlifan/ps5-pc-communication/actions/workflows/ci.yml/badge.svg)

Hata bildirimleri, özellik önerileri, belge düzeltmeleri ve kod katkıları memnuniyetle karşılanır. Özellikle PS5 tarayıcısında doğrulanmamış davranışlar (sesli sohbet, dosya seçme, dosya indirme, kalıcı depolama) hakkında gerçek cihazlardan gelen bildirimler çok değerlidir. Katkı yapmadan önce [CONTRIBUTING.md](CONTRIBUTING.md) dosyasını okuyun. Güvenlik açıklarını herkese açık bir issue olarak değil, [SECURITY.md](SECURITY.md) dosyasında anlatılan yolla bildirin. Deponun adresi https://github.com/Yerlifan/ps5-pc-communication şeklindedir.

## Lisans

Proje Burak Aslancan Pak tarafından hazırlanmıştır ve MIT lisansıyla dağıtılır, ayrıntılar için [LICENSE](LICENSE) dosyasına bakın. `public/vendor/nacl-fast.min.js` dosyası TweetNaCl-js 1.0.3 kütüphanesinin değiştirilmemiş bir kopyasıdır ve Unlicense ile kamu malı olarak dağıtılır. Bu kütüphanenin lisans metni `public/vendor/TWEETNACL-LICENSE.txt` dosyasındadır.
