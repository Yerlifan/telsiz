# PS5 + PC Sohbet

PS5 + PC Sohbet, PS5'te, bilgisayarda ve telefonda bulunan arkadaşların aynı odada yazılı olarak sohbet etmesini sağlayan küçük bir web uygulamasıdır. Bir kısmı PS5'te, bir kısmı bilgisayarda oynayan ve Discord'a erişemeyen arkadaş grupları için hazırlanmıştır. Sunucu, gruptan bir kişinin bilgisayarında çalışır. Diğer herkes yalnızca bir tarayıcıyla bağlanır, PS5'e veya telefona ayrıca bir uygulama kurmak gerekmez. Aynı ev ağında kullanım için Windows'ta yapılması gereken tek şey Node.js'i kurup `baslat.bat` dosyasına çift tıklamaktır.

## Ne işe yarar ve neden web tabanlı

Türkiye'de Discord'a erişim kapalı olduğu için PS5 ve bilgisayar kullanan oyuncuların birlikte yazışabileceği ortak bir yere ihtiyaç duyuldu. PS5'e üçüncü taraf uygulama kurulamaz. PS5, bilgisayar ve telefonda ortak olarak bulunan tek araç web tarayıcısıdır. Bu nedenle sohbet, herkesin tarayıcıdan açtığı tek bir web sayfası olarak tasarlandı.

PS5'in resmi bir tarayıcı uygulaması yoktur. Sistemde gizli bir web tarayıcısı bulunur, ancak adres çubuğu yoktur ve yalnızca dolaylı yollarla, örneğin bir PSN mesajındaki bağlantı seçilerek açılabilir. Bu tarayıcının hangi web özelliklerini desteklediği belirsizdir. PS5 tarayıcısında WebSocket ve Server-Sent Events desteği doğrulanamadığı için uygulama yalnızca düz HTTP istekleriyle, long-polling yöntemiyle çalışır. Bu yöntemde tarayıcı sunucuya yeni mesaj olup olmadığını sorar, sunucu da yeni bir mesaj gelene kadar ya da en fazla 25 saniye boyunca yanıtı bekletir. Böylece mesajlar kısa bir gecikmeyle herkese ulaşır. Cloudflare hızlı tüneli yanıtları tamamlanana kadar tamponladığı için sürekli açık kalan akış bağlantıları tünel üzerinden çalışmaz. Long-polling yanıtları ise veri hazır olduğunda hemen tamamlandığı için bundan etkilenmez.

Uygulama yalnızca yazılı sohbet sunar, sesli sohbet yoktur. Tek bir sohbet odası vardır ve mesaj geçmişi yalnızca sunucunun belleğinde tutulur.

## Gereksinimler

Sunucuyu çalıştıracak kişinin bilgisayarında Node.js 18 veya daha yeni bir sürüm kurulu olmalıdır. Node.js'i https://nodejs.org adresinden indirebilirsiniz. Uygulamanın başka hiçbir bağımlılığı yoktur, `npm install` komutunu çalıştırmanız gerekmez.

İnternet üzerinden, yani farklı evlerden bağlanacak arkadaşlar varsa sunucuyu çalıştıran bilgisayarda Cloudflare'in `cloudflared` programı da gerekir. Kurulumu aşağıda anlatılmıştır.

Bağlanacak kişilerin yalnızca bir tarayıcıya ihtiyacı vardır. Bu, PS5'in gizli tarayıcısı, bilgisayardaki güncel bir tarayıcı veya telefon tarayıcısı olabilir.

## Sunucuyu başlatma

### Windows

1. https://nodejs.org adresinden Node.js'i indirin.
2. İndirdiğiniz kurulum dosyasıyla Node.js'i kurun.
3. Bu projenin dosyalarını bilgisayarınızda bir klasöre çıkarın.
4. `baslat.bat` dosyasına çift tıklayın.
5. Açılan pencerede listelenen adresleri not edin.
6. Sohbet sürdüğü sürece bu pencereyi açık bırakın.

Oda adını veya oda şifresini değiştirmek için `baslat.bat` dosyasını düzenleyin. Çift tıklamak dosyayı çalıştırır, düzenlemek için dosyayı Not Defteri ile açmanız gerekir.

1. Sunucu penceresi açıksa kapatın.
2. `baslat.bat` dosyasını Not Defteri ile açın.
3. `set "ODA_ADI=Sohbet"` satırında `Sohbet` kelimesinin yerine istediğiniz adı yazın.
4. Şifreyi `set "ODA_SIFRESI="` satırında eşittir işaretiyle kapanış tırnağının arasına yazın.
5. Dosyayı kaydedin.
6. `baslat.bat` dosyasına yeniden çift tıklayın.

Sohbeti internete açacaksanız şifre belirlemeyi atlamayın. Şifrede harf ve rakam kullanmanız önerilir, yüzde işareti ve çift tırnak işareti `baslat.bat` içinde sorun çıkarabilir.

İlk çalıştırmada Windows güvenlik duvarı, Node.js için ağ erişimi izni isteyebilir. Aynı ev ağındaki cihazların bağlanabilmesi için bu izni verin.

Node.js bulunamazsa `baslat.bat` bir uyarı gösterir. Bu durumda Node.js'i kurun, ardından `baslat.bat` dosyasını yeniden çalıştırın. Pencerede bağlantı noktasının zaten kullanımda olduğunu söyleyen bir hata görürseniz sunucu büyük olasılıkla başka bir pencerede zaten çalışıyordur.

Sunucuyu durdurmak için pencerede Ctrl+C tuşlarına basın veya pencereyi kapatın. Windows bir onay sorusu sorarsa onaylayın. Sunucu durduğunda tüm mesaj geçmişi silinir.

### macOS, Linux ve diğer sistemler

1. Node.js 18 veya daha yeni bir sürümü kurun.
2. Bir terminal açın.
3. Proje klasörüne geçin.
4. `node server.js` komutunu çalıştırın.

`npm start` komutu da aynı işi yapar. Ayarları ortam değişkenleriyle verebilirsiniz:

```sh
ODA_ADI="Cuma Akşamı" ODA_SIFRESI="kaplan42" node server.js
```

Windows'ta `baslat.bat` yerine PowerShell kullanmak isterseniz değişkenleri şu şekilde verebilirsiniz:

```powershell
$env:ODA_SIFRESI = "kaplan42"
node server.js
```

Sunucuyu durdurmak için terminalde Ctrl+C tuşlarına basın.

## Arkadaşların bağlanması

Sunucu başladığında pencerede oda adı, şifre durumu ve erişim adresleri yazılır. Sunucuyu çalıştıran kişi aynı bilgisayardan `http://localhost:3000` adresiyle katılabilir. Diğer kişilerin hangi adresi kullanacağı, aynı ev ağında olup olmadıklarına bağlıdır. Adresi açan herkes şu adımlarla sohbete katılır:

1. Tarayıcıda size verilen adresi açın.
2. "Takma ad" alanına bir ad yazın.
3. Oda şifresi soruluyorsa "Oda şifresi" alanını doldurun.
4. "Sohbete katıl" düğmesine basın.

Takma ad 2 ile 20 karakter arasında olmalı ve yalnızca harf, rakam, boşluk, nokta, alt çizgi veya kısa çizgi içermelidir. Büyük ve küçük harf farkı gözetilmez, örneğin "IŞIK" ve "ışık" aynı ad sayılır. Sohbetten ayrılmak için "Çık" düğmesini kullanın. Bağlantı geçici olarak koparsa sayfa kendiliğinden yeniden bağlanmayı dener.

### Aynı ev ağı

Sunucuyla aynı modeme bağlı cihazlar, kablolu veya kablosuz olması fark etmeksizin, sunucu penceresinde "Aynı ağdaki cihazlardan" satırında görünen yerel adresle bağlanabilir. Bu adres `http://192.168.1.20:3000` biçimindedir. Buradaki sayılar yalnızca örnektir, kendi pencerenizde görünen adresi kullanın. Pencerede birden fazla adres görünüyorsa bunları sırayla deneyin.

Bağlantı kurulamıyorsa sunucunun çalıştığından ve Windows güvenlik duvarının Node.js'e izin verdiğinden emin olun. PS5'te bu tür ham IP adreslerinin mesaj içinde tıklanabilir bağlantıya dönüşüp dönüşmediği doğrulanmadı. PS5 aynı evde olsa bile yerel adres işe yaramazsa bir sonraki bölümdeki tünel adresini kullanın.

### İnternet üzerinden: Cloudflare hızlı tüneli

Farklı evlerdeki arkadaşlar için önerilen yol, Cloudflare'in hızlı tünel hizmetidir (Quick Tunnel, TryCloudflare). Bu hizmet için hesap açmak gerekmez ve modemde bir ayar yapmanız gerekmez. `cloudflared tunnel --url http://localhost:3000` komutu, bilgisayarınızdaki sunucuyu rastgele bir `trycloudflare.com` alt alan adıyla internete açar. Windows'ta kurulum ve kullanım adımları şöyledir:

1. Başlat menüsünden bir komut istemi veya PowerShell penceresi açın.
2. `winget install --id Cloudflare.cloudflared` komutunu çalıştırın.
3. Kurulum bittiğinde açık olan tüm komut istemi ve PowerShell pencerelerini kapatın.
4. `baslat.bat` ile sunucuyu başlatın.
5. `tunel.bat` dosyasına çift tıklayın.
6. Çıktıda görünen `https://....trycloudflare.com` biçimindeki adresi fareyle seçin.
7. Seçili adresi kopyalayın.
8. Bu adresi arkadaşlarınızla paylaşın.
9. Sohbet sürdüğü sürece iki pencereyi de açık bırakın.

`cloudflared` zaten kuruluysa ilk üç adımı atlayın. Adresteki noktaların yerinde her seferinde rastgele oluşturulan bir ad bulunur. Adresi kopyalarken dikkatli olun, hiçbir metin seçili değilken Ctrl+C tuşlarına basmak tüneli kapatır. `winget` ilk kullanımda bir onay isterse kabul edin. `winget` çalışmazsa `cloudflared` programını Cloudflare'in kendi belgelerinde anlatılan yöntemle kurabilirsiniz. Diğer sistemlerde de `cloudflared` kurulduktan sonra, sunucu çalışırken ayrı bir terminalde yukarıdaki `cloudflared tunnel --url http://localhost:3000` komutunu çalıştırmanız yeterlidir.

`baslat.bat` içinde `PORT` değerini değiştirdiyseniz `tunel.bat` içindeki `3000` değerini de aynı sayıyla değiştirin. `tunel.bat`, `PORT` ortam değişkeni tanımlıysa onu, değilse 3000 değerini kullanır.

Hızlı tünelin bazı sınırları vardır. Adres her çalıştırmada değişir, bu yüzden tüneli her açtığınızda yeni adresi yeniden paylaşmanız gerekir. Hizmetin çalışma süresi için bir garanti verilmez. Eşzamanlı 200 istek sınırı vardır, bu sınır bu sohbet için yeterlidir. trycloudflare.com adresine Türkiye'den erişilip erişilemediği doğrulanmadı, kendi bağlantınızda denemeniz gerekir. Sohbeti tünelle internete açarken mutlaka bir oda şifresi belirleyin.

### Alternatif: modem port yönlendirme

Tünel kullanamıyorsanız modeminizin yönetim arayüzünden port yönlendirme yapabilirsiniz. Bu yöntemde modeme dışarıdan gelen TCP 3000 bağlantı noktası, sunucuyu çalıştıran bilgisayarın yerel IP adresine yönlendirilir ve arkadaşlarınız `http://<genel IP adresiniz>:3000` adresiyle bağlanır. Menü adları modem modeline göre değiştiği için burada adım verilmemiştir. Windows güvenlik duvarının da bu bağlantılara izin vermesi gerekir.

Bu yöntemin önemli sınırlamaları vardır. Bazı internet servis sağlayıcıları aboneleri CGNAT (operatör düzeyinde adres paylaşımı) arkasına yerleştirir. Bu durumda modeminizin kendine ait bir genel IP adresi yoktur ve port yönlendirme işe yaramaz. Modem arayüzünde görünen WAN adresi, IP adresinizi gösteren bir sitede görünen adresten farklıysa veya 100.64 ile 100.127 arasındaki bir sayıyla başlıyorsa büyük olasılıkla CGNAT arkasındasınız. Bu durumda hızlı tüneli kullanın.

Ayrıca bu yöntemde trafik şifrelenmeden, düz HTTP ile taşınır. Oda şifresi dahil her şey yolda okunabilir. Genel IP adresiniz zaman zaman değişebilir ve PS5'te ham IP adresli bağlantıların mesajda tıklanabilir olup olmadığı doğrulanmadı. Bu nedenlerle hızlı tünel daha uygun bir seçenektir.

## PS5'ten bağlanma

PS5'te resmi bir tarayıcı uygulaması yoktur. Sistemdeki gizli tarayıcı resmi olarak desteklenmeyen yollarla açılır ve bu yollar sistem yazılımı güncellemeleriyle değişebilir veya kapanabilir. Aşağıdaki yöntemler ikincil kaynaklarda bildirilmiştir ve bu proje kapsamında doğrulanmamıştır. Menü adları PS5'in İngilizce arayüzüne göre verilmiştir. Türkçe arayüzdeki etiketler doğrulanmadı ve farklı olabilir.

PS5'e gönderilecek adres olarak tünelin verdiği `https://....trycloudflare.com` adresini kullanmanız önerilir. Alan adı içeren bu adresin mesajda bağlantı olarak tanınma olasılığının, `http://192.168.1.20:3000` gibi ham IP adreslerinden daha yüksek olduğu varsayılmaktadır, ancak bu da doğrulanmadı.

### Birinci yöntem: Game Base üzerinden mesaj

Bildirilen yöntem, sohbet adresini Game Base üzerinden bir arkadaşa veya ikinci bir hesaba mesaj olarak göndermek ve mesajdaki bağlantıyı seçmektir.

1. PS5'te Game Base bölümünü açın.
2. Bir arkadaşınızı, bir grubu veya ikinci hesabınızı seçin.
3. Sohbet adresini mesaj olarak yazın.
4. Mesajı gönderin.
5. Konuşmada mesajdaki bağlantıyı seçin.
6. Açılan sayfada takma adınızı yazın.
7. "Sohbete katıl" düğmesine basın.

Adres mesajda seçilebilir bir bağlantı olarak görünmüyorsa PS5 adresi bağlantı olarak tanımamış olabilir. Bu durumda tünel adresini deneyin. Uzun adresi PS5'in ekran klavyesiyle yazmak zor olabilir. Telefonda PlayStation App yüklüyse mesajı oradan göndermek daha kolay olabilir, ancak bu yol da doğrulanmadı.

### İkinci yöntem: ağ ayarları

İkincil kaynaklarda, Settings > Network altındaki PlayStation Network hizmet durumunu gösteren sayfadan harici bir bağlantıya geçilerek tarayıcının açılabildiği de bildirilmiştir. Bu yolun tam adımları ve tarayıcı açıldıktan sonra sohbet adresine nasıl ulaşılacağı doğrulanmadı. Bu nedenle önce birinci yöntemi deneyin.

### PS5'te kullanım

Sayfa, televizyon ekranından okunabilmesi için büyük yazı ve büyük düğmelerle tasarlandı. Metin kutusu seçildiğinde PS5'in ekran klavyesinin açılması beklenir. PS5'e USB klavye bağlanabildiği bilinmektedir, ancak klavyenin gizli tarayıcıda çalışıp çalışmadığı doğrulanmadı.

Tarayıcıyı kapattıktan sonra sohbete dönmek için mesajdaki bağlantıyı yeniden seçin. Tarayıcı oturum bilgisini saklayabildiyse sohbete doğrudan dönersiniz, saklayamadıysa takma adınızı yeniden girmeniz gerekir. PS5 tarayıcısının bu bilgiyi saklayıp saklamadığı doğrulanmadı.

## Ayarlar

Sunucu aşağıdaki ortam değişkenlerini okur. Windows'ta bu değerler `baslat.bat` içindeki `set` satırlarından değiştirilir. `HOST` için `baslat.bat` içinde bir satır yoktur, gerekirse `set "HOST=127.0.0.1"` biçiminde bir satır eklenebilir.

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `ODA_ADI` | `Sohbet` | Giriş ekranında ve sohbet başlığında görünen oda adı. En fazla 40 karakter kullanılır, fazlası kırpılır. |
| `ODA_SIFRESI` | boş | Oda şifresi. Boş bırakılırsa oda şifresizdir. İnternete açarken mutlaka belirleyin. |
| `PORT` | `3000` | Sunucunun dinlediği bağlantı noktası. |
| `HOST` | `0.0.0.0` | Sunucunun dinlediği ağ adresi. Varsayılan değer tüm ağ arayüzlerini dinler. Yalnızca bu bilgisayardan erişim için `127.0.0.1` yazılabilir. |

Aşağıdaki sınırlar sabittir ve ortam değişkeniyle değiştirilemez.

| Sınır | Değer |
|---|---|
| Mesaj uzunluğu | En fazla 1000 karakter |
| Mesaj geçmişi | Son 200 mesaj |
| Takma ad uzunluğu | 2 ile 20 karakter arası |
| Katılma denemesi | IP adresi başına dakikada 10 |
| Mesaj gönderme hızı | Kişi başına 5 saniyede 5 mesaj |

## Güvenlik notları

Sohbeti tünel veya port yönlendirme ile internete açarken `ODA_SIFRESI` mutlaka belirlenmelidir. Şifre yoksa adresi bilen herkes sohbete katılabilir. Tünel adresinin rastgele olması tek başına koruma sağlamaz. Adresi ve şifreyi yalnızca güvendiğiniz kişilerle paylaşın.

Uygulamada uçtan uca şifreleme yoktur. Mesajlar sunucuyu çalıştıran kişinin bilgisayarından geçer ve onun belleğinde tutulur. Tünel kullanıldığında tarayıcı ile Cloudflare arasındaki bağlantı HTTPS ile şifrelenir, ancak trafik Cloudflare altyapısından geçer. Ev ağında ve port yönlendirmede bağlantı düz HTTP'dir, aynı ağdaki biri trafiği okuyabilir. Bu nedenle sohbette parola, ev adresi veya kimlik bilgisi gibi özel bilgiler paylaşmayın.

Sunucu kötüye kullanıma karşı bazı önlemler içerir. Katılma denemeleri IP adresi başına, mesaj gönderimi kişi başına sınırlıdır. Mesajlar HTML olarak yorumlanmaz, her zaman düz metin olarak gösterilir. Sunucu yalnızca uygulamanın kendi sayfa dosyalarını sunar, bilgisayarınızdaki diğer dosyalar web üzerinden açılamaz. Sohbet bittiğinde tünel ve sunucu pencerelerini kapatın.

## Bilinen sınırlamalar

Sesli sohbet yoktur. PS5 tarayıcısında mikrofon erişiminin mümkün olup olmadığı doğrulanmadı.

Yalnızca tek bir sohbet odası vardır. Mesaj geçmişi yalnızca sunucunun belleğinde tutulur, son 200 mesaj saklanır ve sunucu kapanınca hepsi silinir. Sunucuyu çalıştıran bilgisayar kapanır veya uyku moduna geçerse sohbet de durur.

PS5 tarayıcısı resmi olarak desteklenmez ve sistem yazılımı güncellemeleriyle değişebilir. İstemci eski tarayıcılarla uyumlu olacak şekilde yazıldı, ancak her PS5 sistem yazılımı sürümünde çalışacağı garanti edilemez.

Hızlı tünel adresi her çalıştırmada değişir, hizmetin çalışma süresi garanti edilmez ve trycloudflare.com adresinin Türkiye'den erişilebilirliği doğrulanmadı.

Sayfayı kapattıktan hemen sonra aynı takma adla yeniden katılmaya çalışırsanız "Bu takma ad şu anda kullanımda." uyarısını görebilirsiniz. Sunucu, bağlantısı kesilen kişiyi yaklaşık 40 saniye boyunca çevrimiçi saymaya devam eder. Bir dakika kadar bekleyip yeniden deneyin. "Çık" düğmesiyle ayrıldığınızda takma ad hemen serbest kalır.

## Geliştirme ve testler

Proje hiçbir npm bağımlılığı kullanmaz ve yalnızca Node.js'in yerleşik modülleriyle çalışır. Testler Node.js'in yerleşik test aracıyla yazılmıştır ve şu komutla çalıştırılır:

```sh
npm test
```

| Dosya | Görevi |
|---|---|
| `server.js` | HTTP sunucusu ve sohbet API'si. `createChatServer(options)` fonksiyonunu dışa aktarır. |
| `public/index.html`, `public/app.js`, `public/style.css`, `public/favicon.svg` | Tarayıcıda çalışan sohbet sayfası |
| `test/server.test.js` | Sunucu testleri |
| `baslat.bat` | Windows'ta sunucuyu başlatır |
| `tunel.bat` | Windows'ta Cloudflare hızlı tünelini açar |

Sunucu `/api/` altında JSON tabanlı küçük bir HTTP API sunar ve gerçek zamanlı iletişim için yalnızca long-polling kullanır. PS5 tarayıcısıyla uyumu korumak için istemci kodu en fazla ES2017 sözdizimiyle yazılır, `fetch` yerine `XMLHttpRequest` kullanır ve WebSocket ile Server-Sent Events kullanmaz. Değişiklik yaparken bu sınırlara uyun. JavaScript dosyaları noktalı virgül kullanmayan StandardJS stilinde yazılmıştır.

## Lisans

Burak Aslancan Pak tarafından hazırlanmıştır. MIT lisansı ile dağıtılır, ayrıntılar için LICENSE dosyasına bakınız.
