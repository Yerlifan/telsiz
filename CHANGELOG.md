# Değişiklik günlüğü

Telsiz'in sürümlerindeki önemli değişiklikler bu dosyada listelenir. Sürüm numaraları [Anlamsal Sürümleme](https://semver.org/lang/tr/) kurallarına uyar. İngilizcesi: [CHANGELOG.en.md](CHANGELOG.en.md).

## [Yayımlanmamış]

### Yeni özellikler

- Kamerayı Çevir: kamera açıkken cihazda birden çok kamera varsa telsiz kartındaki kamera göstergesinin yanında ve özel mesaj aramasının denetimlerinde Kamerayı Çevir düğmesi çıkar. Telefonda ön ve arka kamera arasında, bilgisayarda sıradaki kameraya geçer. Görüntü yeniden anlaşma olmadan yeni kameraya geçer. Aynı anda iki kamerayı açamayan cihazda eski kamera bırakılıp yeni kamera açılır, yeni kamera açılamazsa eski kamera yeniden açılır. Kamera kapatılıp açılınca sayfa açık kaldıkça son seçilen kamera istenir. Arka kameranın görüntüsü aynalanmaz.

### Değişiklikler

- Kamera ilk açılışta ön kamerayı ister. Önceden telefonda tarayıcının seçtiği kamera, çoğunlukla arka kamera açılıyordu.
- Kamera ızgarasındaki ve izlenen ekran paylaşımındaki Sığdır ve Doldur seçenekleri dar ekranda ve telefonda da görünür (yalnızca simge). Doldur artık Tam Ekran'dan ayrı bir simge kullanır.

### Düzeltmeler

- Kamerayı Çevir bazı telefonlarda ilk basıştan sonra devre dışı kalıyordu: telefon ikinci kamera isteğini ilk kamera açıkken yanıtsız bekletiyordu. İstek 2,5 saniyede yanıtlanmazsa eski kamera bırakılıp yeniden denenir, böyle bir telefonda sonraki geçişler eski kamerayı baştan bırakır. Kamera bırakıldıktan sonraki istek de en fazla 10 saniye bekler, değiştirme hiçbir durumda yarıda takılı kalmaz.

## [2.4.0]

### Yeni özellikler

- Özel mesajda sesli ve görüntülü arama: iki arkadaş konuşmanın başlığındaki Sesli Ara veya Görüntülü Ara düğmesiyle birbirini arayabilir. Aranan kişinin açık cihazlarında 2 saniyelik zil sesi çalar ve Kabul Et ile Reddet düğmeli gelen arama kartı açılır, görüntülü aramada Kamerasız Kabul Et de vardır (Rahatsız etmeyin durumunda zil çalmaz). Arama sırasında konuşmanın üst bölümünde iki kişinin kamerası veya profil fotoğrafı, altta yazışma görünür. Aramanın kurulum iletileri iki kişinin kişisel anahtarlarıyla şifrelenir, arama bilgisi herkese açık metaya girmez. Arama yalnızca arkadaşlar arasında ve karşı tarafın anahtarı doğrulanmışken yapılabilir. Ses odası denetimi ve sunucu susturması özel aramaya uzanmaz, sahibin kamera ayarı geçerlidir. Engelleme, arkadaşlıktan çıkarma, yasaklama ve hesap silme aramayı bitirir. Yeni sunucu ayarları: `callRingMs`, `callLimit`, `callWindowMs`.

### Değişiklikler

- Ekran paylaşımında ses seçeneği tek yerde çıkar. Telsiz'in paylaşım penceresindeki Sesi de paylaş anahtarı kaldırıldı, ses her zaman istenir ve paylaşılıp paylaşılmayacağı kaynağın seçildiği pencerede seçilir: tarayıcıda tarayıcının kendi seçicisindeki ses seçeneği, masaüstü uygulamasında uygulamanın seçicisindeki Sistem sesini de paylaş kutusu (yalnızca Windows). Bu kutu artık başta işaretlidir: tam ekran paylaşımında bilgisayarın bütün sesi paylaşılır, Telsiz'in kendi sesleri (konuşmalar, bildirimler, Telsiz DJ) paylaşıma katılmaz, böylece konuşanların sesi yankı yapıp geri dönmez. Önceden masaüstü uygulamasında sesin gitmesi için iki seçeneğin birlikte açık olması gerekiyordu.

### Düzeltmeler

- Ağ yokken önbellekte olmayan bir dosya istendiğinde (ör. sayfa yenilenirken kesilen favicon isteği) Service Worker tarayıcı konsoluna hata yazıyordu. Sayfa dışındaki dosyalar artık sıradan bir 504 yanıtı alır.
- Paylaşım sürerken Kaynağı değiştir yeni kaynağı sessiz istiyordu, sesli başlayan bir paylaşımın sesi kaynak değişince kayboluyordu. Kaynak değişiminde de ses istenir.

### Güvenlik

- Parola sıfırlandıktan sonra yeni kişisel anahtar ancak parola değiştirilirken, aynı istekte oluşturulur ve yeni parolayla sarılır. Hesap geçici paroladayken sunucu anahtar çifti kaydetmez, böylece geçici parolayı bilen biri kişinin yeni anahtarını seçemez veya açamaz. Geçici parolayı kişiden önce o kullanırsa kişi geçici parolayla artık giremez ve durumu fark eder. Eski bir sekmenin isteği reddedilir, sekme sunucudaki güncel anahtarları yeniden okur.
- Giriş kilitleme saldırısına karşı giriş cihazı işareti: başarılı girişte cihaza parolanın karmasına bağlı bir işaret verilir. Hesap adı başına başarısız giriş sınırı (bütün adresler toplamı 20 / 15 dakika) dolduğunda yalnızca işaretsiz girişler durur, daha önce giriş yapmış cihaz denemeye devam eder. Parola değişince eski işaretler geçersiz olur.
- Hız sınırı tabloları dolduğunda yeni istemcileri reddetmek yerine en uzun süredir kullanılmayan kaydı düşürür. Çok sayıda farklı istemciyle dolan bir tabloda eski sayaçlar bu yüzden sıfırlanabilir.
- Parola karmaları aynı anda en fazla `hashConcurrency` (2) tane hesaplanır, en fazla `hashQueueMax` (32) istek bekler, fazlası 503 `server_busy` alır. Çok sayıda giriş denemesi disk işlemlerini durduramaz.
- Yükleme yerleri: bir hesap ve bir adres aynı anda en fazla 2 yükleme sürdürür, son boş yer yalnızca hiç yer tutmayan hesap ve adrese verilir (ikisinde de yanıt `busy_reserved`). Yükleme en az `uploadMinBytesPerSec` (32 KB/sn) ortalama hızla sürmelidir, hız aynı hesabın veya aynı adresin eşzamanlı yüklemeleri arasında paylaşılır. Varsayılan `maxConcurrentUploads` 4 yerine 6. İstemci `busy_reserved` yanıtında bekleyip yeniden dener, yükleme sınırına (429) takılınca bir kez bir dakika bekler. Bir dosyanın reddedilen istekleri ortak bir bütçeden sayılır, boşa giden veri küçük dosyada 8 MiB ile, büyük dosyada dosya boyutunun dört katıyla sınırlıdır.
- Saklanan mesaj gövdelerinin toplamı `maxTotalMessages` çarpı 1500 karakterle sınırlıdır. Sınır aşılınca en çok gövde saklayan kişinin en eski mesajları düşer, başkalarının mesajları onun yüzünden silinmez.
- Telsiz DJ yazımlarının herkese gönderilen boyutu kullanıcı başına sınırlıdır, ses odası durum değişiklikleri ayrı ve daha sıkı bir sınıra (`voiceLimit`, 30 / 10 sn) tabidir.
- Grup anahtarının geri çevrilmesine karşı koruma: bir cihazda yerine yenisi geçmiş anahtar emekliye ayrılır ve onunla bir daha şifrelenmez. Sunucunun bildirdiği bilinmeyen bir anahtar kimliği hiçbir anahtarı emekliye ayıramaz.
- Bağlantıdaki `#frekanslar=` parçası frekans listesine tanıdık bir adla sahte frekans ekleyemez: listedeki başka bir frekansın veya açık frekansın adını taşıyan yeni frekans adsız eklenir, yeni frekanslar listenin sonuna eklenir ve kişiye adresleriyle bildirilir.
- Özel mesaj aramasında kamera yalnızca kişinin kendi seçimiyle açılır (Kamerasız Kabul Et). Aranan kişinin reddi zil süresi dolana kadar arayana görünmez, arayan reddi cevapsız kalmaktan ayıramaz.
- Ek dosya adının baştaki ve sondaki nokta ile boşluklarının kırpılması doğrusal sürede çalışır (uzun adlarla düzenli ifade yavaşlaması giderildi).
- Veri klasörü kilidi aynı birimi paylaşan konteynerler arasında da geçerlidir, çalışan sunucu kilidi düzenli olarak yeniler.
- Docker: örnek komutlar ve Compose dosyası Docker ağ geçidini `GUVENILIR_VEKIL` listesine yazar. Önceden `docker run` ile ve Compose'da ana makinedeki bir vekil veya tünel üzerinden gelen bütün istemciler tek adres sayılıyordu. Güvenilmeyen yerel bir adresten yönlendirme başlığı gelirse sunucu bir kez uyarı yazar. Yedek komutları arşivi yalnızca sahibinin okuyabileceği biçimde oluşturur (`umask 077`).
- Paroladan anahtar türetme dört kat güçlendi: yeni hesaplar ve parola değişiklikleri scrypt N=65536 kullanır (önce 16384). Önceki sürümlerde oluşturulan hesaplar girişten sonra arka planda, aynı parola ve aynı özel anahtarla bir kez yükseltilir (`POST /api/me/kdf`), diğer oturumlar kapanmaz ve diğer cihazların giriş işaretleri geçerli kalır. Var olmayan adlar için ön giriş yanıtı eski ve yeni N'yi sunucudaki hesapların dağılımına göre verir. Sunucunun ele geçirilmesi hâlinde parolaları çevrim dışı tahmin etmek dört kat pahalıdır. Giriş masaüstünde yaklaşık bir saniye sürer.
- Bağlantıyla eklenen frekansın adı yalnızca Latin ve Türkçe harfler, rakamlar, boşluk ve temel noktalamadan oluşabilir, aksi halde ad alınmaz ve adres görünür. Ad karşılaştırılırken rakamlar (1 ve 0), büyük I ile küçük l, aksan işaretleri, boşluk ve noktalama farkı yok sayılır: tanıdık bir ad başka alfabeden harflerle, görünmez karakterlerle veya benzer görünen simgelerle taklit edilemez.
- Var olan hesapların başarısız giriş sayaçları (hesap adı başına giriş sayacı ve hesap işlemlerinin sayacı) hiç düşürülmeyen ayrı tablolarda tutulur: hız sınırı tablosunu çok sayıda farklı adla veya adresle doldurmak bir hesabın sayacını sıfırlamaz. Diğer tablolar dolduğunda o an sınırda olan sayaçlar öncelikle korunur.

## [2.3.0]

### Yeni özellikler

- Bildirimler: sol sütunda telsiz kartının üstünde kısa bir olay listesi. Aynı ses odasında biri ekranını paylaşmaya başlayınca İzle düğmesiyle yazılır, paylaşım bitince kalkar. Ses odalarına katılma ve ayrılma da yazılır.
- İstasyonlar listesinde her ses odasının altında odadaki kişiler görünür: avatar, ad, susturma ve kamera simgesi, konuşan kişinin avatarında halka.
- Kamera ızgarasında Sığdır ve Doldur düğmeleri. Seçim ekran paylaşımından ayrı saklanır, varsayılan Doldur.
- Yazı boyutu Ayarlar > Görünüm'deki kaydırıcıyla 12 ile 28 piksel arasında elle ayarlanabilir (Özel).
- Telsiz kartının kadrosunda ekran paylaşan kişinin üstüne gelince Yayına katıl düğmesi çıkar (dokunmatik ekranda her zaman görünür).
- Mikrofon düğmesine sağ tıklayınca (klavyede Shift+F10) Bas konuş ile Ses etkinliği arasında geçilir.
- Frekanstan atma: Ayarlar > Üyeler sayfasındaki Frekanstan at düğmesi, onaydan sonra kişinin hesabını siler (`POST /api/users/kick`). Oturumları kapanır ve açık uygulaması frekanstan çıkarıldığını söyler, kullanıcı adı serbest kalır, mesajları kalır ve yazarı silinmiş görünür. Geri dönmek için davet koduyla yeniden kayıt olmak gerekir. İzin ve rütbe kuralı engellemeyle aynıdır (Üyeleri engelle izni atmayı da kapsar), sahip hiçbir zaman atılamaz.
- Ses odası denetiminde Kamerasını kapat: Ses odasını denetle izni olan biri, kişi ses kartından veya profil kartından alt sıradaki birinin açık kamerasını kapatabilir (`POST /api/voice/moderate`, `camera-off` eylemi). Düğme yalnızca kişinin kamerası açıkken görünür. Kapatma tek seferliktir, kişinin uygulaması kamerayı durdurup bunu bildirir, kişi kamerasını yeniden açabilir.
- Gelişmiş gürültü engelleme (RNNoise): klavye tıkırtısı ve uğultu gibi konuşma dışı sesler karşı tarafa gitmeden cihazda bastırılır. Ayarlar > Ses ve görüntü > Ses işleme bölümünde, tarayıcının gürültü bastırması anahtarının yanındadır, varsayılan olarak açıktır ve mikrofonu yeniden başlatmadan açılıp kapanır. RNNoise'un WebAssembly derlemesi (`@shiguredo/rnnoise-wasm` 2022.2.0, BSD-3-Clause ve Apache-2.0) uygulamayla birlikte gelir ve AudioWorklet içinde çalışır. Tarayıcı AudioWorklet veya WebAssembly desteklemiyorsa ya da dosyalar yüklenemezse ses kesilmeden tarayıcının kendi işlemesiyle sürer. Sayfanın içerik güvenliği politikasına yalnızca WebAssembly derlemesine izin veren `'wasm-unsafe-eval'` eklendi (sunucu ve masaüstü uygulaması). Ters vekil bu başlığı kendisi yazıyorsa aynı anahtar eklenmelidir.
- Masaüstü uygulamasında Telsiz arka plandayken (ör. bir oyun açıkken) bas konuş: Ayarlar > Tuş atamaları sayfasındaki genel kısayollara bas konuş satırı eklendi. Varsayılan "Bas aç, bas kapat" kipinde bir kez basınca konuşma başlar, tekrar basınca biter ve kısa bir ses çalar. İsteğe bağlı "Basılı tut (tuş kancası)" seçeneği açılırsa seçilen tuş basılıyken konuşulur, bırakınca susulur. Kanca yalnızca bir ses odasında bas konuş modundayken çalışır, sistemdeki bütün tuş olaylarını görür ama yalnızca seçilen tuşu işler, tuş kodları sayfaya veya günlüğe gitmez. Ses etkinliği modunda kısayol mikrofonu açıp kapatır. Masaüstü uygulamasına uiohook-napi 1.5.5 bağımlılığı eklendi.
- Masaüstü uygulamasında (Windows ve Linux) yerel başlık çubuğu ve menü çubuğu yerine tema renginde ince bir başlık şeridi: küçült, ekranı boyutla ve kapat düğmeleri temanın zemin ve yazı rengini alır, tema değişince renkleri de değişir. Uygulama menüleri (Telsiz, Düzen, Görünüm, Yardım) şeridin solundaki düğmelerle açılır, menü kısayolları çalışmaya devam eder. Tam ekranda şerit kalkar.
- Ses odasındaki kişilerin sesi %200'e kadar yükseltilebilir: kişi ses kartındaki ve profil kartındaki Ses seviyesi kaydırıcısı 0 ile 200 arasındadır. %100'e kadar ses eskisi gibi ses öğesinden çalar, üstünde o kişinin sesi ses bağlamında bir kazanç düğümüyle yükseltilir ve sert kırpılmayı yumuşatan bir sınırlayıcıdan geçer. Hoparlörle kullanırken Chromium'un yankı engellemesi yükseltilmiş sesi hesaba katmayabilir.
- Sesli bildirimler: ses odasına biri katılınca veya ayrılınca, biri ekran yayını başlatınca, özel mesaj veya arkadaşlık isteği gelince ve ses odasından düşünce her biri kendine özgü, 2 saniyelik bir ses çalar (`public/js/31-sesler.js`). Sesler dosyadan çalınmaz, Web Audio ile sentezlenir (çan, marimba ve cam tınılı kısa melodiler). Ayarlar > Bildirimler'de bütün bildirim seslerinin düzeyi için kaydırıcı (varsayılan %40, alçak) ve her sesi dinleme düğmeleri vardır. Ses odası sesleri Ses odası sesleri ayarına uyar ve sağırlaştırılmışken başkalarının hareketlerinde çalmaz. Özel mesaj ve arkadaşlık isteği sesleri Mesaj ve istek sesleri ayarına ve Rahatsız etmeyin durumuna uyar. Odaya girdiğinizde zaten süren bir ekran yayını ses çalmaz. Masaüstü uygulamasının arka plan pencereleri ses çalmaz.

### Değişiklikler

- Varsayılan yazı boyutu 16 yerine 15 pikseldir (Normal). Bütün ölçüler yazı boyutuyla birlikte küçülür.
- Üst çubuk: Yayındakiler çipinin adı Çevrimiçi oldu ve frekans bilgisinin hemen sağına geçti, Ara tam ortada, Özel mesajlar ve Arkadaşlar profil düğmesinin hemen solunda.
- Frekans bandı 4rem yerine 3.5rem yüksekliğindedir, ibrenin topuzu küçüldü.
- Geniş ekranda sol alttaki Ayarlı istasyon kartı kaldırıldı (oda adı ve şifreleme durumu konuşmanın başlığında, Şifreleme ayrıntıları ve Odayı yönet Ayarlar'da). Telsiz kartı sol sütunun en altındadır.
- Telsiz kartının düğmeleri iki satırdadır: üstte Kamera, Mikrofon ve Sağırlaştır, altta Ekran ve Ayrıl. Her düğmenin kendi rengi vardır.
- Büyüt ve Telsiz DJ kadronun sonundaki öğeler yerine kadronun altındaki ayrı bir satırda, geniş ve etiketli düğmelerdir. Büyüt açık kamera sayısını gösterir.
- Ses etkinliği şeridi tek satırdır, yüksekliği yarıya indi.
- Telsiz kartının kadrosundaki avatarlar 2.75rem yerine 3.125rem, kamera kutuları 4.25rem yerine 4.75rem boyutundadır.
- Kamera ızgarası açıkken sağ sütun (İstasyonlar) yerinde kalır, sahne yalnızca konuşma sütununu kaplar ve son mesajlar sahnenin altında açık durur.
- Telsiz DJ çalarken İstasyonlar listesi sağ sütunun üstünde, DJ kartı altındadır.
- Ayarlar geniş ekranda kenar çubuğu ve içerikle birlikte ortalanır, hafif sola yatık durur.
- Geniş ekranda ekran paylaşımı bildirimi sağ üstte ayrıca açılmaz, Bildirimler listesindedir.
- Rol adları büyük harfle başlar: Sahip, Yönetici, Üye.
- Düğme, menü öğesi, sekme ve çip etiketlerinde her kelime büyük harfle başlar (ör. Özel Mesajlar, Tekrar Dene, Odadan Çıkar). Türkçede ve, ile, veya gibi bağlaçlar küçük kalır. Üst bilgi satırları da aynı biçimdedir: "Frekans · 9 Üye · Şifreli", "Açık · 4 Çevrimiçi", "Yazı Odası" ve "Uçtan Uca Şifreli".
- Başkasının ekran paylaşımı üst çubukta gösterilmez ("X yayında · İzle" çipi kaldırıldı). Kendi paylaşımınızın "Ekranınız yayında · Durdur" çipi kalır.
- Telsiz kartının kadrosu ortalanır, kamera açıkken üç kişi tek satıra sığar.
- Ses ve Görüntü'deki Giriş ve çıkış sesleri ayarının adı Ses odası sesleri oldu, Bildirimler'deki Mesaj sesi bölümü Bildirim sesleri oldu. Katılma ve ayrılma sesleri artık ses odasından çıkınca yarıda kesilmez, ses odasından düşünce ayrılma sesi yerine düşme sesi çalar.

### Düzeltmeler

- Masaüstü uygulamasında yayın sahnesinin Tam ekran düğmesi bütün ekranı kaplamıyordu (uygulama tam ekran iznini reddediyordu). Tam ekran izni yalnızca uygulamanın ana çerçevesine verilir, YouTube oynatıcısı tam ekran olamaz.

- Ekran paylaşımında sistem sesi paylaşılırken Telsiz'deki konuşmalar da paylaşılan sese giriyor, dinleyenler kendi seslerini geri duyuyordu. Paylaşım sesi artık `restrictOwnAudio` kısıtıyla istenir: masaüstü uygulaması ve bunu destekleyen tarayıcılar Telsiz'in kendi çaldığı sesleri (konuşmalar, bildirim sesleri, Telsiz DJ) paylaşılan sesten çıkarır. Bu ayrımı desteklemeyen eski Windows sürümlerinde bütün sistem sesi paylaşılmaya devam eder.

## [2.2.0]

### Yeni özellikler

- Özel roller: sahip Ayarlar > Roller sayfasından istediği adla ve sekiz renkten biriyle rol oluşturur (en çok 20), izinlerini tek tek açar ve rolleri sıralar. Rol üyelere Ayarlar > Üyeler sayfasından verilir, bir üyenin tek rolü olabilir. Rolün adı profil kartında ve Yayındakiler listesinde rozet olarak görünür.
- Rol izinleri: mesajları silme, üyeleri engelleme, ses odasını denetleme, odaları yönetme ve Telsiz DJ kuyruğunu yönetme. Sahip ve yöneticiler her izne sahiptir. Listede üstteki rol daha yetkilidir, engelleme ve ses odası denetimi yalnızca alt sıradakilere uygulanabilir.
- Ses odası denetimi: izinli kişi kadrodan veya profil kartından birini herkes için susturabilir ya da ses odasından çıkarabilir. Susturma kişi odadan çıkıp girse de sürer. Ses kişiler arasında doğrudan aktığı için susturmayı istemciler uygular: susturulan kişinin mikrofonu kapanır, diğerlerinin cihazında o kişinin sesi çalınmaz.
- Telsiz DJ kısıtlı kipi: sahip açarsa, odada DJ izni olan biri varken kuyruğu yalnızca DJ izni olanlar yönetir, diğerleri dinler. Odada böyle biri yoksa herkes yönetebilir. Kural sunucuda uygulanır.
- Masaüstü uygulamasının Telsiz > Frekanslar menüsünde Listeden çıkar alt menüsü: frekans onay penceresiyle listeden çıkarılır, istenirse bu cihazdaki oturumu ve verisi de silinir.

### Değişiklikler

- Sağ sütun (İstasyonlar ve Telsiz DJ kartı) 14,5rem yerine 17rem genişliğindedir.
- Telsiz DJ kartındaki "Sizin için" ses kaydırıcısı, YouTube oynatıcısının kendi denetimleriyle değiştirilen ses düzeyini ve susturmayı gösterir. Oynatıcıdan kısılan ses kaydırıcıdan yeniden açılabilir.

### Düzeltmeler

- Şifreleme anahtarı girişten sonra eklendiğinde (ör. masaüstü uygulamasında ilk girişte) Telsiz DJ "şifreleme anahtarı bu cihazda yok" uyarısında kalıyordu. Müzik durumu anahtar eklenince yeniden açılır.

## [2.1.0]

### Yeni özellikler

- Çok frekans: her Telsiz sunucusu bir frekanstır ve birden çok frekansa katılınabilir. Üst bant katılınan frekansları dizer: açık mı kapalı mı, çevrimiçi kişi sayısı, okunmamış ve anma sayıları. Yazı ve ses odaları sağdaki İstasyonlar listesindedir. Frekanslar sayfası frekans eklemeyi ve listeden çıkarmayı sağlar.
- Masaüstü uygulaması kayıtlı frekansları kendi oturum bölümlerinde açar ve açık olmayan en fazla 8 frekansın okunmamış ve anma sayılarını arka planda sayar. Bu frekanslardaki anma ve özel mesajlar için bildirim gösterilebilir.
- Masaüstü uygulaması GitHub sürümlerinden güncellenir. Windows yükleyicisi ve AppImage güncellemeyi indirip kurar, taşınabilir sürüm ve .deb paketi yeni sürümü bildirir. Ayarlardan kapatılabilir.
- Frekans tanıtım sayfası: oturum açmamış ziyaretçi frekansın adını, sahibin tanıtım metnini, Telsiz'in özelliklerini, masaüstü indirme bağlantısını ve VPS ile alan adı kurulum rehberini görür. Sahip tanıtım metnini Ayarlar > Genel'den yazar. Metin herkese açıktır ve şifrelenmez.
- Frekans fotoğrafı: sahip her frekansa bir fotoğraf yükleyebilir (PNG, JPEG veya WebP, en çok 1 MB). Fotoğraf frekans düğmesinde, bantta, Frekanslar sayfasında, giriş ekranında ve tanıtımda baş harf ambleminin yerine görünür. Masaüstü uygulaması diğer frekansların fotoğraflarını da gösterir. Fotoğraf herkese açıktır ve şifrelenmez.
- Telsiz DJ: `/çal` ile kuyruğa eklenen parça komutun yazıldığı yazı odasında duyurulur. Duyuru uçtan uca şifrelidir.
- Telsiz DJ köşedeki oynatıcı: Ayarlar veya başka bir pencere açıkken, ya da dar ekranda DJ sayfası kapalıyken YouTube oynatıcısı köşede görünür kalır ve müzik kesilmez. Müzik ses odasından ayrılınca, DJ kapatılınca veya kuyruk bitince durur.
- Ses odalarında kamera: herkes kendi kamerasını açabilir (varsayılan kapalı, 360p ve 15 kare/sn). Kamerası açık kişinin kadrodaki avatarı canlı görüntüye dönüşür, Büyüt ile bütün kameralar ızgarada görülür. Kendi kameranız açıkken her zaman görünen bir gösterge vardır. Görüntü kişiler arasında DTLS-SRTP ile şifreli akar, Telsiz sunucusundan geçmez. Sunucu yalnızca kimin kamerasının açık olduğunu bilir ve sınırı uygular.
- Sahip ses odası kapasitesini (2 ile 12 kişi, varsayılan 8), kameraların açık olup olmadığını ve bir odada aynı anda açık kamera sayısını (varsayılan 4) Ayarlar > Genel'den değiştirebilir.
- Sunucu bilgileri ve öneri: Ayarlar > Genel'de sahip ve yöneticiler işlemci, bellek (kapsayıcı sınırı dahil), disk, kullanım ve TURN durumunu görür. Üyelerin tipik yükleme hızına göre önerilen oda kapasitesi ve kamera sınırı hesaplanır, değerlerin tahmin olduğu ekranda yazar.
- Giriş sayfasında ortak alt bilgi (masaüstü uygulaması, GitHub bağlantısı, lisans ve sürüm) ve telsiz temalı karalama desenli arka plan.
- Kullanıcı başına yükleme kotası (`KULLANICI_YUKLEME_KOTASI_MB`, varsayılan 512 MB) ve tüm odalardaki toplam mesaj sınırı (`MAKS_TOPLAM_MESAJ`, varsayılan 500000). Toplam sınır aşılınca en kalabalık odaların en eski mesajları silinir.

### Değişiklikler

- Parola değişimi, oturum kapatma, hesap silme, engelleme, rol değişimi, davet kodu yenileme ve grup anahtarı değişimi gibi güvenlikle ilgili işlemlerde yanıt, değişiklik diske yazılıp fsync edildikten sonra gider.
- Varsayılan yazı boyutu 16 pikseldir. Daha önce seçilmiş boyut korunur.
- Telsiz DJ çalarken DJ kartı sağ sütunun üstüne yerleşir, İstasyonlar listesi altında görünür kalır.
- npm paketi token yerine GitHub OIDC güvenilir yayın ile ve kaynak kanıtıyla (provenance) yayımlanır.
- Uçtan uca testler Chromium'un yanında Firefox ve WebKit'te de çalışır. Playwright 1.63.0'a yükseltildi.

### Düzeltmeler

- Sohbet sütunu geniş ekranda 46rem ile sınırlı kalıyordu, çünkü sınırı kaldıran kural sınırı koyan kuraldan önce yazılmıştı. Sütun artık yan sütunlar dışındaki bütün genişliği alır.
- 16 piksel yazı boyutunda DJ sütunu daralınca YouTube oynatıcısı 200 pikselin altına inip duraklıyordu. Oynatıcı alanı artık her yazı boyutunda en az 200x200 kalır.

## [2.0.1]

### Düzeltmeler

- Masaüstü uygulamasında Telsiz DJ'nin YouTube videoları "Hata 153: Video oynatıcı yapılandırma hatası" veriyordu. Uygulama artık YouTube oynatıcısının çerçeve isteğine sunucunun kökenini Referer olarak ekler. Web sürümündeki davranışla aynı bilgi gider.
- Kullanıcı bir dosya yüklerken engellenir, çıkış yapar, oturumu kapatılır veya hesabını silerse yükleme artık kaydedilmez. Oturum yükleme bitince yeniden denetlenir, kapanan oturumun süren yüklemeleri kesilir.
- Yanıtı kaybolan bir mesaj yeniden gönderilince ikinci bir mesaj oluşmaz. Her gönderim bir istemci kimliği (`clientMessageId`) taşır, sunucu yinelenen gönderimde ilk mesajı döner. Ekli mesajlarda yineleme artık `bad_uploads` hatası vermez.
- Hesabı silinen kişilerle yapılan özel konuşmalar geçmiş olarak kalır ama etkin konuşma üst sınırına sayılmaz.
- Aynı veri klasöründe neredeyse aynı anda başlatılan iki sunucu sürecinden yalnız biri veri kilidini alır, diğeri açılmaz.
- Service worker yalnız Telsiz'in eski önbelleklerini siler, aynı kökendeki başka uygulamaların önbelleklerine dokunmaz.

### Değişiklikler

- Sunucu ikilileri sürüm sayfasında masaüstü uygulamasından kolay ayrılsın diye `telsiz-<sürüm>-server-windows-x64.exe`, `telsiz-<sürüm>-server-linux-x64` ve `telsiz-<sürüm>-server-linux-arm64` adını taşır.
- CI ve sürüm iş akışlarındaki GitHub eylemleri Node.js 24 ile çalışan sürümlere yükseltildi.

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
