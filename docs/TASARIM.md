# Telsiz tasarım sistemi

[Türkçe](TASARIM.md) | [English](DESIGN.md)

Telsiz'in arayüzü tek bir HTML yapısı, Frekans adlı bir düzen ve üç görsel tema üzerine kuruludur. Düzen uygulamayı bir radyo kadranı gibi kurar: katıldığınız frekanslar (her biri bir Telsiz sunucusu) yatay bir frekans bandında istasyon olarak dizilir, açık frekansın yazı ve ses odaları sağdaki İstasyonlar listesindedir, ortada tek bir konuşma sütunu durur, ses odasına bağlanınca bir el telsizini andıran telsiz kartı açılır. Temalar yalnızca CSS belirteçlerini ve temaya özgü süsleri değiştirir, işaretleme hiçbir temada değişmez. Varsayılan tema Arcade'dir, ilk açılışta mod sistem tercihini izler (bilinmiyorsa koyu). Bu belge dosyaları, düzeni, kesme noktalarını, belirteçleri, temaları, kamerayı ve oyun masasını, bileşenleri, kontrast ölçümlerini ve yeni bir tema eklemenin adımlarını anlatır.

## Dosyalar ve yükleme sırası

| Dosya | Görev |
| --- | --- |
| `public/theme-init.js` | `<head>` içinde `defer` olmadan, stil dosyalarından önce yüklenir. Cihazdaki tercihi okuyup kök öğenin özniteliklerini yazar, böylece sayfa ilk çizimde doğru temayla açılır. `window.TelsizTheme` arayüzünü tanımlar. |
| `public/css/tokens.css` | Tema bağımsız ölçekler (aralık, yazı, hedef boyutu, hareket), Frekans düzeninin ölçüleri, avatar şekli, her tema ve mod için renk, yazı tipi ve biçim belirteçleri, yazı boyutu kuralları. |
| `public/css/base.css` | Yerel yazı tipleri (`@font-face`, `font-display: swap`), sıfırlama, gövde ve zemin ışığı, odak çerçevesi, kaydırma çubukları, simgeler, hareketi azalt kuralı. |
| `public/css/frekans.css` | Çekirdek yerleşim: açılış ve kimlik ekranlarının kabuğu, üst çubuk, frekans bandı ve frekans istasyonları, sahne (sol bilgi sütunu, konuşma sütunu, DJ sütunu, sağ sütun), İstasyonlar listesi, telsiz kartı kabı, frekans menüsü, yan ve alt sayfalar, televizyon ipucu çubuğu, kesme noktaları. |
| `public/css/components.css` | Genel bileşenler: düğme, giriş, seçim, anahtar, kaydırıcı, kart, etiket, rozet, avatar ve durum işareti, menü, açılır panel, kalıcı pencere, sekmeler, liste, bildirim, tuş kapağı, yükleniyor, mesaj, emoji seçici, profil kartı. |
| `public/css/settings.css` | Tam ekran ayarlar görünümü, ses odası ayarları, sunucu bilgileri ve kapasite önerisi. |
| `public/css/chat-plus.css` | Arama paneli, @ anma rozetleri ve öneri listesi, yazıyor satırı. |
| `public/css/convo.css` | Konuşma sütunu: başlık, mesaj akışı, boş, yükleniyor ve hata durumları, yazma alanı, öneri listesi, arama katmanı. |
| `public/css/radio.css` | Telsiz kartı (ekran, kadro, kamera kutuları, Bas konuş, kamera göstergesi, düğme sırası), kişi ses ayarı katmanı ve avatar menüsü. |
| `public/css/people.css` | Giriş kartı, Çevrimiçi sayfası ve şeridi, özel mesaj listesi ve kişisel kartlar, özel mesaj başlığı, Arkadaşlar istasyonu. |
| `public/css/cast.css` | Ekran paylaşımı: yayında çipi, paylaşım bildirimi, yayın sahnesi, kameralar ızgarası, daraltılmış sohbet şeridi, paylaşım başlatma penceresi. |
| `public/css/dj.css` | Telsiz DJ kartı, köşedeki oynatıcı, telsiz kartının araç satırındaki Telsiz DJ düğmesi, mesajdaki "DJ'de çal" düğmesi. |
| `public/css/arama.css` | Özel mesaj araması: başlıktaki Sesli Ara ve Görüntülü Ara düğmeleri, konuşmanın üstündeki arama bölümü (kutular, durum satırı, denetimler), gelen arama kartı. |
| `public/css/tanitim.css` | Oturum açmamış ziyaretçinin gördüğü frekans tanıtım sayfası. |
| `public/css/oyun.css` | Oyun masası: telsiz kartındaki Oyun düğmesi ve durumları, yayın sahnesinin `game` kipinde Masa Kur, lobi, davet, kişi listeleri ve durum çipleri, güven notu, onay satırı, sonuçlar, durum satırı, telefonda sahne yüksekliği, birden çok oyun kayıtlıyken Oyun Seç listesi. |
| `public/css/renk.css` | Renk masası: rakip şeridi, deste ve kart arkası, atılan kart, aktif renk, eylem satırı, el, kart yüzleri, Joker renk seçici. |
| `public/css/hexball.css` | Hexball masası: Takımlar ve sonuç ekranı (takım sütunları, takım rozeti, bağ çipi, sonuç ve goller), maç ekranının skor tablosu ve saati, saha tuvali ve üstündeki yazı, maçtaki oyuncuların açıklaması, telefonda dokunmatik çubuk ve Vur düğmesi. |
| `public/css/skins/arcade.css`, `gece.css`, `turkuaz.css` | Temaya özgü biçimler. |
| `public/fonts/` | Yerel woff2 yazı tipleri ve OFL lisans metinleri. |

`index.html` stil dosyalarını şu sırayla bağlar: tokens, base, frekans, components, settings, chat-plus, convo, radio, people, cast, dj, arama, tanitim, oyun, renk, hexball, ardından üç tema dosyası. Tema dosyalarındaki her kural `:root[data-skin="..."]` ile başladığı için yalnızca etkin temanın kuralları uygulanır. Üç dosyanın birlikte yüklenmesi tema değişimini sayfa yenilemeden anında yapar.

## Tema arayüzü

`theme-init.js` şu arayüzü sunar. Ayarlar > Görünüm sayfası ve uygulama yalnızca bu arayüzü kullanır.

| Üye | Açıklama |
| --- | --- |
| `TelsizTheme.get()` | Geçerli tercihleri döner: tema (`skin`), seçilen mod (`scheme`: `dark`, `light`, `system`), uygulanan mod (`resolvedScheme`), yazı boyutu, kompakt görünüm ve hareketi azaltma. |
| `TelsizTheme.set(partial)` | Verilen alanları doğrular, cihazda saklar, kök özniteliklerini günceller ve dinleyicileri çağırır. |
| `TelsizTheme.skins` | `['arcade', 'gece', 'turkuaz']` |
| `TelsizTheme.onChange(fn)` | Değişiklik dinleyicisi ekler, kaldırmak için bir fonksiyon döner. "Sistem" seçiliyse sistem modu değişince de çağrılır. |

Kök öğe (`<html>`) öznitelikleri: `data-skin` (`arcade`, `gece`, `turkuaz`), `data-scheme` (`dark`, `light`), `data-font-size` (`auto`, `small`, `normal`, `large`, `tv`), `data-compact` ve `data-reduce-motion` (`true`, `false`). Cihazdaki anahtarlar `telsiz.skin`, `telsiz.scheme`, `telsiz.fontSize`, `telsiz.compact` ve `telsiz.reduceMotion` adlarını taşır. Depolama kapalıysa seçim yalnızca o oturumda geçerlidir.

`12-init.js` tema her değiştiğinde `theme-color` meta etiketini etkin temanın `--theme-color` belirtecine, `color-scheme` meta etiketini uygulanan moda göre günceller. Varsayılan yazı boyutu `normal` (15 piksel). Yazı boyutu `auto` seçiliyken kök yazı boyutu 15 piksel, 1280 piksel ve üstü genişlikte 18 piksel, 1800 piksel ve üstünde 22 pikseldir. `small` 14, `normal` 15, `large` 18, `tv` 22 pikseldir. `custom` seçiliyken boyut Ayarlar > Görünüm'deki kaydırıcıyla 12 ile 28 piksel arasında elle ayarlanır, `theme-init.js` değeri kök öğenin `--font-px` değişkenine yazar. Bütün ölçüler `rem` ile verildiği için arayüz yazı boyutuyla birlikte büyür.

## Frekans düzeni

Uygulama ekranı (`#app-view`) yukarıdan aşağı şu bölgelerden oluşur:

1. **Üst çubuk (`#top`).** Sol üstte frekans değiştirici (`#frekans-button`: amblem (frekans fotoğrafı, yoksa baş harf), frekans adı ve aşağı ok, alt satırda "Frekans · üye sayısı" ve şifreli notu). Basınca kayıtlı frekansların menüsü (`#frekans-menu`, `24-frekans.js`) açılır: açık frekans başta ve işaretli, diğerine geçme, Frekans ekle, Listeden çıkar. Frekans değiştiricinin hemen sağında Çevrimiçi şeridi (çevrimiçi kişilerin küçük avatarları, basınca kişi listesi). Tam ortada Ara çipi: iki yan bölüm (`.top-side`) aynı oranda esner, yer daralınca bölümler üst üste binmez, Ara biraz kayar. Sol bölüm (`.top-side-start`, `min-width: 0`) içeriğinin altına inebilir: uzun frekans adı üç noktayla kısalır, sağdaki düğmeler ve avatar çipi ekran dışına itilmez. Sağda ekran paylaşırken her istasyonda görünen "Ekranınız yayında" çipi (`#top-cast`, 1439 piksel ve altında yalnızca kırmızı lamba ve Durdur, 760 pikselin altında hiç yoktur ve paylaşım telsiz kartının Ekran düğmesinden ya da sahne başlığındaki Durdur'dan durdurulur), sağ sütun görünmediğinde İstasyonlar düğmesi, Özel mesajlar ve Arkadaşlar düğmeleri (`#top-personal`, okunmamış özel mesaj ve bekleyen istek rozetleriyle) ve en sağda avatar çipi (`#me-button`, basınca avatar menüsü: durum, özel durum, profil, ayarlar, görünüm, dil, çıkış). Bağlantı koptuğunda üst çubuğun altında bir şerit (`#conn-banner`) çıkar. Masaüstü uygulamasında (Windows ve Linux) üst çubuğun üstünde pencere düğmeleri kadar yüksek (32 piksel) bir başlık şeridi (`#titlebar`, `30-pencere.js`) vardır: solda Telsiz simgesi ve uygulama menüleri, ortada pencere başlığı, sağda işletim sisteminin çizdiği küçült, ekranı boyutla ve kapat düğmeleri. Şeridin zemini saydamdır, düğmelerin zemini ve simge rengi temanın zemin (`--bg`) ve metin (`--text`) renginden gelir, böylece şerit üst çubukla tek parça görünür. Menü düğmesinin üstüne gelince ve menü açıkken `--surface-hover` zemini, klavye odağında `--focus` halkası görünür. Yükseklik sistemden geldiği için şeridin yazısı ve boşlukları piksel cinsindendir. Tam ekranda şerit kalkar.
2. **Frekans bandı (`#band`, `#band-track`).** Katıldığınız frekanslar tek satırda, "Frekanslar" etiketi grubun başında (`24-frekans.js` üretir, `04-meta.js renderBand` çizer). Her istasyon bir frekanstır: frekans fotoğrafı veya adının baş harfiyle amblem ve köşesinde durum noktası (açık frekans ibre renginde, çevrimiçi yeşil, çevrimdışı kırmızı, giriş gerekli sarı, bilinmiyor boş halka), ad (bilinmiyorsa adres), alt satırda durum, çevrimiçi kişi sayısı veya adres, satır içinde okunmamış rozeti ve köşede anma rozeti (`@sayı`). Okunmamış sayısı odaların ve özel mesajların, anma sayısı sizi anan mesajlar ile özel mesajların toplamıdır. Bant tek satırlıktır (`--band-h` 3.5rem): üstte ölçek şeridi ve ibrenin topuzu, altında 44 piksellik istasyonlar. Ölçek çizgileri içerikle birlikte kayar, açık frekansı istasyonun üstündeki ibre gösterir. Başka bir istasyona basmak, ibreyi sürükleyip başka bir istasyona bırakmak, uç düğmeleri ve oyun kolunun L1 ve R1 düğmeleri o frekansa geçer, ses odasındayken önce onay istenir. Bandın uçlarında önceki ve sonraki frekans düğmeleri, Frekans ekle düğmesi (+), frekans değiştirme rehberini küçük bir açılır pencerede gösteren ? düğmesi (`#band-help`, `#hints-card`) ve Frekanslar sayfasını açan Tümü düğmesi bulunur. Bant klavyede tek bir sekme durağıdır (ok tuşları odağı gezdirir, Home, End, Enter geçer), tekerlek bandı yalnızca yatay kaydırır ve hiçbir zaman frekans değiştirmez. Masaüstü uygulamasında açık olmayan frekansların durumu ve okunmamış sayıları da görünür (arka plan sayımı, [desktop/README.md](../desktop/README.md)). Tarayıcıda her frekans ayrı bir köken olduğu için yalnızca açık frekansın durumu ve sayıları gösterilir, diğer istasyonların ipucu ve erişilebilir adı bunu söyler. Tarayıcıda bant sırası adres parçasıyla taşınır, böylece her frekansta aynıdır.
3. **Sahne (`#stage`).** Geniş ekranda soldan sağa: dar ve sabit sol sütun (`#info-col`, `--side-left-w`: Özel görünümünde konuşma listesi ve kişisel kartlar, sütunun en altında telsiz kartı `#radio` ve hemen üstünde Bildirimler `#activity`: aynı ses odasında başlayan ekran paylaşımı İzle düğmesiyle, ses odalarına katılma ve ayrılma. Ayarlı istasyonun kartı yalnızca 1280 pikselin altında Oda bilgisi sayfasında görünür), kalan alanı alan konuşma sütunu (`#main`: başlık, mesajlar, yazıyor satırı, yazma alanı) ve dar ve sabit sağ sütun (`#side-right`, `--side-right-w`: yazı ve ses odalarının listesi İstasyonlar `#inbox`, okunmamış ve anma rozetleri, ses odasında kişi sayısı ve odanın altında odadaki kişiler (avatar, ad, susturma ve kamera simgesi, konuşan kişinin halkası), konuşan göstergesi ve Telsiz DJ notası, başlıkta oda yönetme izni olanlar (sahip, yönetici ve izinli roller) için Oda ekle düğmesi `#inbox-add`). Yazı odasına basmak onu ayarlar, ses odasına basmak o odaya katılır. Sağ sütun görünmediğinde (999 pikselin altı, alçak ekranda 1280 pikselin altı veya ekran paylaşımı yayındayken, kamera ızgarasında sağ sütun yerinde kalır) üst çubuktaki İstasyonlar düğmesi (`#btn-rooms`, toplam okunmamış rozetiyle) aynı listeyi İstasyonlar sayfasında açar. Telsiz DJ çalarken İstasyonlar listesi sağ sütunun üstünde kalır, DJ kartı (`#dj`) altına yerleşir (liste en az 12rem, kart sığmazsa kendi içinde kayar), ekran paylaşımı yayındayken sağ sütun gizlenir. 1280 pikselin altında telsiz kartı sağ sütuna taşınır (`12-init.js placeRadio`).
4. **Yayın sahnesi (`#cast`).** Ekran paylaşımı izlenirken, kişi kendi paylaşımının önizlemesine bakarken veya kameralar ızgarası açıkken sol ve orta bölge birleşir, sohbet altta daraltılmış bir şeride iner.
5. **Sayfalar.** Frekanslar (`#frekans-sheet`, bandın Tümü düğmesi: frekanslar durum ve sayılarıyla, listeden çıkarma ve Frekans ekle), İstasyonlar (`#stations-sheet`, yazı ve ses odaları, başlıkta Oda ekle), Çevrimiçi (`#people-sheet`) ve 1280 pikselin altında Oda bilgisi geniş ekranda sağdan açılan yan sayfa, telefonda alttan açılan sayfadır. Sayfadaki satırlar arasında yukarı ve aşağı ok, Home ve End gezer. Aynı anda tek sayfa açıktır, ortak örtü `#drawer-backdrop`'tur.
6. **Televizyon ipucu çubuğu (`#tvbar`).** 1800 piksel ve üstünde, oyun kolu algılandığında altta görünür.

Telsiz kartının durumu `#radio[data-state]` özniteliğindedir: `off` (ses odasında değil, ekranda ses odaları ve Katıl düğmeleri), `joining` (bağlanıyor), `on` (bağlı: oda adı, kadro, konuşma satırı, kamera açıkken kamera göstergesi, kameralar varken Büyüt ve Telsiz DJ düğmelerinin bulunduğu araç satırı `#radio-tools`, Bas konuş veya tek satırlık ses etkinliği şeridi, iki satırlı düğme sırası: üstte Kamera, Mikrofon ve Sağırlaştır, altta Ekran ve Ayrıl, her düğme kendi renginde, `tone-*`). Görünüm modu `#app-view[data-view]` özniteliğindedir (`channel`, `home`, `dm`).

Düzen işaretleme sırasıyla kurulur, `dir` veya `flex-direction: row-reverse` kullanılmaz. Klavye ve ekran okuyucu sırası görsel sırayı izler: üst çubuk, bant, sol sütun, konuşma, sağ sütun.

## Kesme noktaları

`12-init.js` pencere genişliğine göre `#app-view[data-layout]` özniteliğini yazar (`tv`, `wide`, `wide-narrow`, `medium`, `narrow`) ve düzen sınıfı değişince açık sayfaları kapatır. CSS aynı sınırları medya sorgularıyla uygular.

| Ad | Koşul | Değişen |
| --- | --- | --- |
| Televizyon | `min-width: 1800px` | Kök yazı 22 piksel (otomatik yazı boyutunda), büyük odak halkası, oyun kolu varsa ipucu çubuğu, telsiz kartının başlık satırı gizli |
| Geniş | `min-width: 1280px` | Üç bölgeli sahne: solda telsiz kartı ve oda bilgisi, ortada genişleyen konuşma, sağda İstasyonlar veya DJ kartı |
| Geniş dar | 1000 ile 1279 piksel | Sol sütun gizli, telsiz kartı sağ sütunda, üst çubuktaki kişisel düğmeler simge, oda bilgisi başlıktaki düğmeyle yan sayfada, DJ kartı telsiz kartındaki Telsiz DJ düğmesinden açılan sayfada |
| Orta | `max-width: 999px` | Telsiz kartı 17rem, düğmeler iki satırda, İstasyonlar kartı gizli, üst çubukta İstasyonlar düğmesi (yan sayfa), yayın sahnesi başlığında Sığdır, Doldur (`i-fill` simgesi) ve Tam Ekran yalnızca simgedir (erişilebilir ad ve görünür etiketle aynı ipucu kalır) |
| Dar (telefon) | `max-width: 759px` | Bant kenardan kenara ve parmakla kayar, Tümü düğmesi, frekans düğmesinde yalnızca amblem (ad bantta), konuşma tam genişlik, telsiz kartı ekranın altına yapışır, katmanlar (İstasyonlar dahil) alttan açılır, üst çubukta paylaşım çipi yoktur, telsiz kartının araç satırı (Büyüt ve Telsiz DJ) sığmazsa oda adının altına iner |
| Alçak | `max-height: 860px` ve 1280 pikselin altı | İstasyonlar kartı gizli, üst çubukta İstasyonlar düğmesi |

Düzen sınıfına bağlı olmayan iki eşik daha vardır. 1439 piksel ve altında üst çubuktaki kendi paylaşım çipinin yazısı gizlenir. Özel aramada Kamerayı Çevir varken (`.dm-call-controls.has-flip`) denetim düğmelerinin yazıları 540 piksel ve altında ve 760 ile 899 piksel arasında da gizlenir, üç düğmeli satırda yalnızca 420 piksel ve altında.

## Tasarım belirteçleri

Bileşenler renk değeri yazmaz, yalnızca anlamsal belirteçleri kullanır. Her tema ve mod renk belirteçlerinin hepsini tanımlar. Frekans düzeninin belirteçleri yalnızca tema belirteçlerine başvurur, bu yüzden üç temada ve iki modda kendiliğinden doğru renk alır.

Ölçekler ve düzen (tema bağımsız):

| Belirteç | Değer | Kullanım |
| --- | --- | --- |
| `--space-1` ile `--space-8` | 0.25rem ile 2rem | Aralık ölçeği |
| `--target` | 2.75rem (varsayılan 15 piksel kökte 41,25 piksel, 16 piksel kökte 44 piksel) | En küçük dokunma ve imleç hedefi |
| `--text-xs` ile `--text-2xl` | 0.75rem ile 1.75rem | Yazı ölçeği |
| `--dur-fast`, `--dur-med`, `--dur-slow`, `--ease` | 0.14s, 0.24s, 1.8s, `cubic-bezier(0.2, 0.7, 0.2, 1)` | Hareket |
| `--top-h` | 3.75rem (dar 3.5rem) | Üst çubuk yüksekliği |
| `--band-h`, `--band-pad`, `--dial-top` | 3.5rem, 0.25rem, 0.125rem | Frekans bandı yüksekliği, alt boşluğu, ölçek çizgisinin üstten uzaklığı |
| `--station-h` | 2.75rem | İstasyon yüksekliği |
| `--side-w` | 17.5rem | Yan sayfadaki DJ kartı |
| `--side-left-w`, `--side-right-w` | 19.5rem, 17rem | Geniş ekranda sol sütun (telsiz kartı, oda bilgisi) ve sağ sütun (İstasyonlar, DJ kartı) |
| `--radio-w` | 21rem (orta 17rem) | 1280 pikselin altında sağ sütun ve telsiz kartı |
| `--sheet-w` | 25rem | Yan sayfa genişliği |
| `--avatar-radius` | `28%` | Avatar köşe yarıçapı, bütün temalarda |
| `--dot-radius` | `32%` | Durum noktası ve köşe işaretleri |

Frekans renk belirteçleri:

| Belirteç | Değer | Anlam |
| --- | --- | --- |
| `--needle`, `--needle-knob` | `var(--accent)` | İbre çizgisi ve topuzu |
| `--needle-ring` | `var(--surface-1)` | Topuz halkası |
| `--tick`, `--tick-major` | `var(--line-strong)`, `var(--edge)` | Ölçek çizgileri |
| `--band-bg` | `var(--surface-1)` | Bant zemini |
| `--station-tuned-bg` | `var(--surface-3)` | Ayarlı istasyon |
| `--station-target` | `var(--focus-halo)` | İbre sürüklenirken hedef istasyon |
| `--radio-bg`, `--screen-bg` | `var(--surface-2)`, `var(--surface-sunken)` | Telsiz gövdesi ve ekranı |

Yüzeyler ve çizgiler:

| Belirteç | Anlam |
| --- | --- |
| `--bg`, `--bg-glow-a`, `--bg-glow-b` | Sayfa zemini ve arkasındaki iki yumuşak ışık |
| `--surface-1`, `--surface-1-glass` | Bant, sütun kartları ve Arcade'in cam paneli (yalnızca `backdrop-filter` destekleniyorsa) |
| `--surface-2` | Konuşma sütunu ve telsiz gövdesi |
| `--surface-3` | Yükseltilmiş yüzey: ayarlı istasyon, tuş kapağı, ikincil düğme |
| `--surface-alt` | Kartlar, dosya kartı, mesaj üzerine gelme |
| `--surface-sunken` | Girdi, yazma alanı, telsiz ekranı, ölçer yuvası |
| `--surface-hover`, `--surface-active` | Üzerine gelme ve seçili satır |
| `--surface-float` | Menü, açılır panel, profil kartı, iletişim kutusu |
| `--overlay`, `--viewer-bg` | Sayfa ve pencere örtüsü, resim görüntüleyici zemini |
| `--line`, `--line-strong` | Süs ayırıcı ve kart kenarı |
| `--edge` | Etkileşimli öğe kenarı (en az 3:1) |

Metin, vurgu ve durum:

| Belirteç | Anlam |
| --- | --- |
| `--text`, `--text-2`, `--text-3`, `--text-strong` | Ana, ikincil, soluk ve vurgulu metin |
| `--link` | Bağlantı |
| `--accent`, `--accent-hover`, `--on-accent` | Birincil vurgu, üzerine gelme ve vurgu üstündeki yazı |
| `--accent-fill-a`, `--accent-fill-b`, `--on-accent-fill` | Gönder, Bas konuş ve birincil dolgu düğmelerinin degradesi ve üstündeki yazı. Koyu modlarda `--on-accent`, açık modlarda beyazdır. |
| `--accent-2`, `--accent-text`, `--accent-2-text`, `--accent-lip` | İkinci vurgu (Arcade degradesinin ikinci ucu, Gece'de yayında yeşili, Turkuaz'da bakır), zemin üstünde vurgu metni, birincil düğmenin dudağı |
| `--attention`, `--on-attention` | Anma sayısı rozeti |
| `--mention-bg`, `--mention-text`, `--mention-line` | Anma rozeti ve beni anan mesaj vurgusu |
| `--focus`, `--focus-halo` | Odak çerçevesi ve haresi |
| `--ok`, `--idle`, `--dnd`, `--offline` | Durum işaretleri (bileşen, 3:1) |
| `--live`, `--live-bg`, `--live-edge`, `--speaking-bg`, `--halo-1`, `--halo-2` | Bağlı ses, canlı bileşenin kenarı (3:1), konuşan kişi ve konuşma halesi |
| `--danger`, `--danger-bg`, `--danger-edge`, `--danger-fill`, `--on-danger` | Tehlike metni, zemini, kenarı (3:1) ve dolgusu |
| `--warn`, `--warn-bg`, `--warn-line` | Uyarı metni, zemini ve kenarı |
| `--av-0` ile `--av-7`, `--av-fg`, `--av-offline` | Sekiz avatar ve profil rengi, baş harf rengi, çevrimdışı avatar dolgusu. Gece temasında her renk kendi baş harf rengine sahiptir (`--av-fg-0` ile `--av-fg-7`). |
| `--theme-color` | Tarayıcı çubuğu rengi |

Biçim ve yazı (temaya göre değişir):

| Belirteç | Arcade | Gece Frekansı | Turkuaz ve Bakır |
| --- | --- | --- | --- |
| `--font-body` | Rubik | Manrope | Figtree |
| `--font-display` | Unbounded 700 | Manrope 800 | Young Serif 400 |
| `--font-label` | Unbounded | Martian Mono | Young Serif |
| `--radius-panel` | 24px (yüzen paneller) | 0 (düz paneller) | 0 (düz paneller) |
| `--radius-card`, `--radius-control` | 18px, 14px | 14px, 12px | 1.125rem, 0.75rem |
| `--layout-pad`, `--column-gap` | 1rem, 0.875rem | 0, 0 | 0, 0 |

## Temalar

**Arcade (varsayılan).** Oyun salonu lobisi. Koyu kömür zeminde yüzen cam paneller, alt kenarında dudak taşıyan ve basınca içeri çöken tuş kapağı düğmeler, mor ile camgöbeği arası degrade yalnızca küçük ve anlamlı yüzeylerde (ayarlı istasyonun kenarı, rozetler, Gönder, Bas konuş kubbesi, konuşan hale). Kabin düğmesi gibi kubbeli Bas konuş, segmentli seviye ölçer, odakta liste satırının solunda küçük bir "arcade imleci". Açık mod aynı biçim dilini lavanta griye taşır. Logo, favicon ve uygulama simgeleri Arcade kimliğini kullanır.

**Gece Frekansı.** Radyo istasyonu. Gece mavisi zemin, tek vurgu kehribar sinyal, yayında yeşili yalnızca canlı olan şeylerde. Düz paneller ve ince ayırıcılar, telsiz kartı konsol zemininde. İstasyonlar listesindeki odaların yanında oda kimliğinden türetilen bir frekans rozeti (yalnızca bu temada görünür). Durum noktaları cihaz panelindeki LED'ler gibidir. Konuşan kişide yeşil halka ve ekolayzır çubukları, mesaj akışında saatler tek aralıklı bir sütun, tırtıklı yuvarlak Bas konuş ve YAYINDA lambası.

**Turkuaz ve Bakır.** Çini ve geometrik desen geleneği. Turkuaz "yer ve güven", bakır "size yönelik dikkat ve ses" anlamı taşır. Başlıkların altında elmas zincirli kuşak frizi, kemer biçimli amblem ve kartlar, elmas desenli durum dolguları, konuşan kişide nefes alan yeşil hale, asimetrik bakır Bas konuş, bakır mühürlü şifreli mesaj kartı. Desen yalnızca kenarlarda ve boş alanlarda durur, metin her zaman düz zemindedir. Rakam içeren metinler Figtree ile yazılır, çünkü Young Serif'in rakamları eski üsluptur.

Konuşma göstergesi her temada farklı görünür ama hep aynı durum sınıfıyla (`.is-speaking`) tetiklenir. Hareketi azalt açıkken hale, nabız, ekolayzır ve yazıyor noktaları durağan kalır, bilgi kaybolmaz. Temaya özgü süs simgeleri işaretlemede `.skin-arcade`, `.skin-gece` ve `.skin-turkuaz` sınıflarıyla durur ve yalnızca kendi temasında görünür, örneğin Gönder düğmesinin simgesi.

## Avatar ve durum şekli

Bütün avatarlar üç temada da yumuşak kenarlı karedir, daire değildir: mesaj akışı, telsiz kartının kadrosu, Çevrimiçi şeridi ve sayfası, profil kartı, avatar menüsü, arkadaşlar, özel mesajlar, öneri listeleri ve arama sonuçları. Köşe yarıçapı `--avatar-radius: 28%` ile verilir. Değer yüzde olduğu için küçük yığın avatarında da büyük profil avatarında da oran aynıdır.

Durum noktası ve köşe işaretleri (susturulmuş, sağırlaştırılmış, ekran paylaşıyor) aynı aileden yumuşak karedir (`--dot-radius: 32%`), avatarın sağ alt köşesine oturur ve zemin renginde bir kenarla ayrılır. Konuşma halesi `box-shadow` ile çizildiği için kare çerçevenin dışını izler. Telsiz DJ gerçek bir kullanıcı değildir: avatarı kesik çizgili kenarlı bir nota simgesidir ve "bot" etiketi taşır. Kamera kutusu avatarın kendisidir ve aynı yumuşak kare biçimi korur, kadrodaki Büyüt öğesi Telsiz DJ gibi kesik çizgili kenarlı bir simgedir. Daire olarak kalanlar avatar değildir: ibre topuzu, nabız noktası, LED, Bas konuş kubbesi ve radyo seçim noktası.

## Kamera

Kamera telsiz kartında başlar ve aynı Frekans biçim dilini kullanır. Düğme sırasındaki Kamera düğmesi (`#btn-camera`) üst satırın başındadır, varsayılan olarak kapalıdır, açıkken Ekran düğmesinin yayında görünümünü (`.is-live`, `--live`) alır, cihaz desteklemiyorsa veya sahip kameraları kapattıysa kesik kenarlı ve devre dışıdır ve nedeni altında yazar (`#radio-camera-note`). Kameranız açıkken Bas konuş veya ses etkinliği satırının üstünde kayıt lambalı bir gösterge (`#radio-cam-live`, `--danger`, `--danger-bg` ve `--danger-edge`, "Kameranız açık, odadaki herkes görüyor") her düzende, telefonda da görünür.

Gösterge kamera çubuğunun (`#radio-cam-bar`) içindedir. Birden çok kamerası olan cihazda (telefonda ön ve arka kamera, bilgisayarda takılı ikinci kamera) kamera açıkken yanında etiketli Kamerayı Çevir düğmesi (`#btn-camera-flip`, `.radio-cam-flip`) durur, ipucu sıradaki kameraya geçtiğini söyler. Kamera değiştirilirken düğme odağı korumak için `disabled` yerine `aria-disabled="true"` alır, soluklaşır ve imleç `progress` olur. Çubuk satır kırabilir: göstergenin taban genişliği 11rem'dir, ikisi yan yana sığmazsa (760 piksel ve üstündeki dar kart) Kamerayı Çevir alt satıra iner, telefonda ikisi tek satırdadır. Aralığı öğelerin kenar boşluğu ve kabın eksi kenar boşluğu verir. Özel aramada denetim satırında Kamera ile Aramayı Bitir arasında Çevir düğmesi durur (`.call-control.is-flip`, erişilebilir adı Kamerayı Çevir, değiştirilirken `aria-disabled`). Dört düğmeli satır `.has-flip` alır ve yazılar 540 piksel ve altında ve 760 ile 899 piksel arasında da gizlenir, böylece satır tek kalır. Erişilebilir ad ve ipucu (`title`) kalır.

Kamerası açık kişinin kadro öğesi aynı yumuşak kare avatar biçiminde (`--avatar-radius`) daha büyük bir canlı görüntü kutusuna döner (`.crew-avatar.has-camera`, geniş ekranda 4.75rem, orta ekranda 3.75rem, telefonda 2.75rem). Görüntü (`.cam-video`, `object-fit: cover`) ilk kare gelene kadar saydamdır, altındaki avatar görünür. Kendi görüntünüz aynalıdır (`.is-mirrored`), arka kamerada (yön `environment`) aynalanmaz. Köşe işaretleri ve konuşma halesi görüntünün üstünde kalır. Kadro ortalanır. Ekran paylaşan kişinin öğesinde üstüne gelince veya odaklanınca (fare olmayan cihazlarda her zaman) Yayına katıl düğmesi (`.crew-watch`) çıkar ve paylaşımı izlemeye başlar. Başkasının paylaşımı üst çubukta gösterilmez. Mikrofon düğmesine sağ tıklamak veya Shift+F10 Bas konuş ile Ses etkinliği arasında seçim yapan küçük bir menü açar (`#mic-menu`, `29-mikrofon.js`). Odada kamera varsa kadronun altındaki araç satırında, Telsiz DJ düğmesinden önce kesik çizgili kenarlı ve kamera sayısını gösteren Büyüt düğmesi (`.cams-tool`, `#radio-cams`) durur. Basınca kameralar yayın sahnesinde ızgara olarak açılır (`#cast[data-mode="cams"]`, `.cast-cams`, `.cam-tile`). Izgara açıkken sağ sütun yerinde kalır, sahne yalnızca konuşma sütununu kaplar ve son mesajlar sahnenin altında açık durur. Başlıktaki Sığdır ve Doldur düğmeleri kameraların görünümünü seçer, seçim ekran paylaşımından ayrı saklanır (varsayılan Doldur). Başlık düğmelerinin ipucu (`title`) görünür etiketle aynıdır ve dil değişince yenilenir, 999 piksel ve altında Sığdır, Doldur ve Tam Ekran yalnızca simge olduğunda da fareyle okunur. Tam ekranda Tam Ekran düğmesi Tam Ekrandan Çık olur ve içe dönük köşeli `i-compress` simgesini alır, böylece yanındaki Küçült'ün X'iyle (`i-close`) karışmaz. Izgara kamera sayısına göre 1, 2x1, 2x2, 3x2, 3x3 veya 4x3 eşit kutuya bölünür, kutular kart köşelidir, ad etiketi görüntünün üstünde koyu zeminde durur ve konuşan kişinin kutusunda canlı renkli çerçeve belirir. İzlenen bir ekran paylaşımı ızgaranın önüne geçer, son kamera kapanınca ızgara kendiliğinden kapanır.

Ayarlar > Genel sayfasında iki bölüm vardır. Ses odaları ve kameralar bölümü (`#set-voice-limits-section`) sayı alanlarıyla (`.settings-number`) ses odası kapasitesini ve kamera sınırını, bir anahtarla kameraları gösterir. Yönetici alanları devre dışı görür. Sunucu bilgileri bölümü (`#set-server-info-section`) etiket ve değer satırlarını (`.settings-facts`, `.settings-fact`), altında öneriyi (`.settings-rec`: yükleme hızı alanı, sonuç satırları `.settings-rec-item`, formül açıklaması, ipuçları `.settings-rec-hint` ve Öneriyi uygula düğmesi) gösterir. Uyarılar `--warn`, `--warn-bg` ve `--warn-line` belirteçleriyle, olumlu ipucu `--live` kenarıyla çizilir. Telefonda etiket değerin üstüne iner.

## Oyun masası

Telsiz kartının araç satırında Büyüt ile Telsiz DJ arasında Oyun düğmesi (`#radio-game`, `.game-tool`, durumu `data-state` özniteliğinde) durur. Seste değilken, bağlanırken ve özel aramada görünmez. Etiketi duruma göre Oyun, Davet (`.is-invited`, "1" rozeti), Oyun Sürüyor (`.is-busy`), Masaya Dön ve Sıra Sizde (`.is-turn`, "!" rozeti) olur, sahne açıkken Küçült olur ve `aria-expanded="true"` alır. Oyun Sürüyor `disabled` yerine `aria-disabled="true"` taşır, odaklanabilir kalır ve basınca bilgi ekranını açar. 759 piksel ve altında etiket görsel olarak gizlenir, simge ve rozet kalır ve düğme büyümez, yalnızca simgesi kadar yer alır. Araç satırının düğmeleri içerikleri kadar yer alıp kalan genişliği paylaşır, satıra sığmazlarsa satır sarılır, görünen etiketler kesilmez. Oyun düğmesinin, Masaya Bak'ın ve masadaki Deste, Tek! ve Yakala düğmelerinin erişilebilir adı görünen etiketle başlar, böylece sesle kumanda görünen adı bulur (WCAG 2.5.3). Örnekler: "Davet: Deniz sizi Renk oyununa davet ediyor", "Kart Çek, 93 kart kaldı". Gelen davet sahneyi açmaz, Bildirimler listesinde Masaya Bak düğmeli bir kayıt (`.activity-item.is-game`) çıkar. Liste görünürken davet ayrıca duyurulmaz, çünkü liste kendisi kibar canlı bölgedir.

Masa yayın sahnesinin `game` kipinde açılır (`#cast[data-mode="game"]`, `.cast-game`). Kip önceliği izlenen paylaşım, kamera ızgarası, oyun masası, kendi paylaşımının önizlemesidir (`22-cast.js castModeFor`). Oyunu açmak izlemeyi bırakır ve ızgarayı kapatır. Oyun hiçbir zaman kendiliğinden kapanmaz, üstteki kip kapanınca masa geri gelir. Başlıkta Tam Ekran ve Küçült durur, Küçült sahneyi kapatır ama oyun sürer. Oyunda paylaşan seçicisi gizlidir, sohbet şeridi varsayılan olarak daraltılmıştır ve geniş ekranda sağ sütun gizlenir. Telefonda (759 piksel ve altı) sohbet daraltılmışken sahne 16:9 yüksekliği yerine kalan yüksekliği alır (en az 8rem) ve masa `.cast-game` içinde kayar. Böylece başlık (Tam Ekran, Küçült) 375 x 667 gibi küçük ekranlarda ve büyük yazıda da görünür kalır. Sahne yeniden çizilince kişinin kaydırdığı yer korunur: sahnenin dikey kaydırması ve `data-scroll-key` taşıyan öğelerin (elin yatay kaydırması) konumu geri yazılır, aynı denetime geri verilen odak sahneyi kaydırmaz. Masa Kur, lobi, davet, bitiş ve sonuç ekranları, durum satırı, güven notu ve onay satırı `oyun.css`, masanın ortası Renk'te `renk.css`, Hexball'da `hexball.css` içindedir. Masanın alt satırında (`.game-trust-row`) her zaman güven çipi (`.game-trust-chip`, Renk'te "Kurpiyer Elleri Bilir", Hexball'da "Oyunu Ev Sahibi Yürütür") ve tam metni açan Ayrıntı düğmesi bulunur. Kurpiyerde yanlarında Koltuklar düğmesi (`.game-seats-more`) durur, koltuk listesini (`#game-seats-detail`, varsayılan olarak kapalı) açar: uzakta kalan ya da sayfasını yenileyip dönmeyen oyuncu oyun sürerken buradan Koltuktan Çıkar ile kaldırılır. Masa Kur, lobi ve davet ekranlarında güven notu (`.game-trust`) Katıl düğmesinin hemen üstündedir. Oyunu bitirme ve masayı kapatma her zaman, masadan ayrılma ve koltuktan çıkarma oyun sürerken `window.confirm` yerine panelin içinde bir onay satırı (`.game-confirm`) açar, odak Vazgeç'e gider ve Esc satırı kapatır. Lobide ve sonuç ekranında ayrılma ve koltuktan çıkarma onaysız uygulanır.

Kart bir düğmedir (`button.renk-card[data-color][data-value]`): köşede rengin şekli ve değer, ortada büyük değer (sayı, Engel için `i-block`, Yön için `i-reverse`, +2), altta dile göre rengin harfi. Joker ve Joker +4 yüzünün ortasında dört küçük renk karesi her biri kendi şekliyle durur ve renk harfi yoktur: Joker +4'ün köşesinde ve altında +4 yazar, Joker'in köşesi ve altı boştur. Yüzler düz renktir, ortada eğik oval veya logo yoktur. Kart arkası (`.renk-back`) çizgili desenlidir ve destede ve rakiplerin kart sayısında görünür. Sıra kişideyken oynanabilir kart `.is-playable` alır (0.375rem yukarı kalkar, alt kenarında `--accent` çizgisi belirir), oynanamayan kart `.is-blocked` ile çizgili örtü alır. O an oynanamayan her kart `disabled` yerine `aria-disabled="true"` taşır ve odaklanabilir kalır. Yeni çekilen kart (`.is-new`) "Yeni" işareti taşır. El (`.renk-hand`) renk sırasına (Kırmızı, Sarı, Yeşil, Mavi, Joker) ve değere göre dizilir, sığmazsa kendi içinde yatay kayar. Kurpiyerin ekranında başkalarının elleri hiç çizilmez.

Renk hiçbir yerde tek başına anlam taşımaz. Her rengin bir şekli, bir harfi ve adı vardır:

| Renk | Şekil | Türkçe harf | İngilizce harf |
| --- | --- | --- | --- |
| Kırmızı | daire (`i-suit-circle`) | K | R |
| Sarı | üçgen (`i-suit-triangle`) | S | Y |
| Yeşil | kare (`i-suit-square`) | Y | G |
| Mavi | karo (`i-suit-diamond`) | M | B |

Aktif renk göstergesi (`.renk-color`) ve Joker renk seçicinin (`.renk-picker`) dört düğmesi şekli, harfi ve adı birlikte gösterir. Sırası gelen rakipte halka ve "Sırada" yazısı, Tek! diyen oyuncuda çip vardır. Kartın erişilebilir adı tam addır (ör. "Kırmızı 7", "Joker +4"), ardından oynanıp oynanamayacağı ve yeni çekildiyse bu bilgi gelir. Başkasının çektiği kartın içeriği okunmaz. Duyurular panelin içindeki kibar bölgeye, "Sıra sizde" ısrarlı bölgeye gider, 400 ms içinde gelen olaylar tek cümlede birleşir.

Kart belirteçleri `tokens.css` sonundadır. Kenar, gölge, kart arkası ve örtü (`--card-edge`, `--card-shadow`, `--card-back-a`, `--card-back-b`, `--card-hatch`) moda göre değişir. Yüz renkleri (`--renk-red`, `--renk-yellow`, `--renk-green`, `--renk-blue`, `--renk-wild`) ve yazı renkleri (`--renk-ink`, `--renk-ink-yellow`) iki modda aynıdır. Joker yüzü koyu temalarda, sarı yüz açık temalarda zeminden ayrışmadığı için kenar zorunludur. Kart yazısının yüzle kontrastı:

| Yüz | Yazı | Oran |
| --- | --- | --- |
| Kırmızı `#c8322f` | beyaz | 5.31:1 |
| Sarı `#f2c12e` | koyu `#221800` | 10.38:1 |
| Yeşil `#16804a` | beyaz | 4.98:1 |
| Mavi `#2563d8` | beyaz | 5.45:1 |
| Joker `#24252c` | beyaz | 15.26:1 |

`test/oyun-arayuz.test.js` oranları yeniden hesaplar ve her birinin 4.5:1'in üstünde kaldığını denetler. `oyun.css`, `renk.css` ve `hexball.css` içinde renkler yalnızca `var(--...)` ile verilir, z-index en çok 3'tür (renk seçici).

DOM sırası odak sırasıdır: Tam Ekran, Küçült, Deste, eylem satırı (Renk Seç, Pas Geç, Tek!, Yakala), el, Ayrıntı, ayrılma ve bitirme düğmeleri. Elde ve eylem satırında Sol ve Sağ ok komşuya, Home ve End uçlara gider, Yukarı ok elden Deste'ye, Aşağı ok Deste'den ve eylem satırından ele iner. Gezici `tabindex` ve kısayol tuşu yoktur, böylece bas konuş atamalarıyla çakışma olmaz. Sıra gelince odak, kişi yazma alanında değilse ilk oynanabilir karta taşınır. Masa yalnızca kendi anahtarı değişince yeniden çizilir ve odak `data-focus-key` ile korunur. Joker renk seçici panelin içinde bir katmandır, böylece tam ekranda da görünür: odak içinde kalır, Esc ve kolun daire düğmesi yalnızca seçiciyi kapatır, kart oynanmaz. Ölçüler:

| Düzen | El kartı | Atılan kart ve deste |
| --- | --- | --- |
| Telefon (759 piksel ve altı) | 3.25 x 4.75rem | 3.75 x 5.5rem |
| 760 piksel ve üstü | 3.5 x 5rem | 4.5 x 6.5rem |

Dokunma hedefleri en az `--target` boyutundadır, renk seçicinin düğmeleri en az 3.5rem yüksekliktedir ve seçici telefonda iki sütun olur. Hareketi azalt açıkken kart geçişleri ve eşitleme noktası durur: `renk.css` ve `oyun.css` içindeki `prefers-reduced-motion` kuralları sistem ayarına, `base.css` içindeki `:root[data-reduce-motion="true"]` kuralı Ayarlar > Görünüm seçimine bakar.

Birden çok oyun kayıtlıyken Oyun düğmesi önce yerel bir Oyun Seç ekranı açar. Her oyun simgesi, adı ve kısa açıklamasıyla bir düğmedir (`.game-picks`, `.game-pick`, açıklama `aria-describedby` ile bağlıdır), altta İptal durur. Seçim yalnızca bu cihazdadır ve Masa Kur'a geçer.

Hexball masası (`.hex-table`, aşaması `data-ph` özniteliğinde) da `.game-app` kutusunun içindedir. Takımlar ekranında üç sütun (`.hex-team[data-side]`, `red`, `blue`, `spec`) Kırmızı, Mavi ve İzleyici takımlarını gösterir. Başlıkta takım rozeti, adı ve sayısı (ör. 2/4), altında kişiler (numara rozeti, avatar, ad, ev sahibinin yanında taç) ve sütunun altında kişinin kendi takım düğmesi (Kırmızıya Geç, Maviye Geç, İzleyici Ol) durur. Ev sahibi her kişinin satırında öbür iki takıma alma düğmelerini (Kırmızıya Al, Maviye Al, İzleyicilere Al) görür. Bu düğmelerin erişilebilir adı görünen etiketle başlar ve kişinin adını içerir (ör. "Maviye Al: Mert"), dolu takıma alma `aria-disabled="true"` taşır. Ev sahibi oyun bağı hazır olmayan kişinin yanında kesik çerçeveli "Bağlantı bekleniyor" ya da tehlike renginde "Bağlantı Yok" çipini (`.hex-chip`, `.is-waiting`, `.is-failed`) görür, çipte her zaman yazı vardır. Maçı Başlat bir takım boşken ya da takımdaki birinin bağı hazır değilken `aria-disabled="true"` taşır, nedeni üstündeki notta yazar. Telefonda (759 piksel ve altı) sütunlar alt alta dizilir. Maç bitince aynı ekranın üstünde sonuç (`.hex-result`: kazanan, neden, skor ve goller) görünür, ev sahibinin düğmeleri Lobiye Dön ve Tekrar Oyna olur.

Maç ekranı yukarıdan aşağıya skor tablosu (`.hex-board`: takım rozeti, adı ve skoru, ortada saat), saha tuvali (`.hex-canvas`), telefonda dokunmatik denetimler (`.hex-touch`), maçtaki oyuncuların açıklaması (`.hex-legend`, kendi satırınız `.is-me` ile vurgu renginde kenarlı), denetim ipucu ve ev sahibinde Maçı Durdur'dur. Maçı Durdur panelin içinde onay satırı açar. Saat `role="timer"` taşır ve canlı bölge değildir, süre bitip skor eşitse "Altın gol" yazar (`.is-golden`). Oyuncuda en yeni anlık görüntü 400 ms'den eskiyse saatin altında "Bağlantı Yavaş" çipi çıkar. Telefonda skor tablosundaki takım adları görsel olarak gizlenir (ekran okuyucu skoru takım adıyla okur), rozet ve skor kalır. Skor tablosu, tuval ve dokunmatik denetimler maç boyunca aynı öğelerdir: gol ya da bağ değişince yeniden çizilen ekran onları yeniden yerleştirir, tuval boşalmaz ve basılı çubuk bırakılmaz. Gol, başlama vuruşu, duraklama ve bağlantı yazısı (`.hex-overlay`, türü `data-kind` özniteliğinde) sahanın üst kenarında ortalanır, küçük sahada da diskleri örtmez ve dokunmayı engellemez.

Tuval 2D'dir ve `devicePixelRatio` en çok 2 alınır. Sahanın en boy oranını korur: genişliği kutuyu, yüksekliği sahnenin görünen yüksekliğinde tuvalin altına kalan yeri aşmaz, telefonda dokunmatik denetimler de görünür kalır. Telefonda Tam Ekran'da skor tablosu, tuval, çubuk ve Vur düğmesi kaydırmadan birlikte görünür. Saha düz renktir, üstünde ince bir altıgen deseni vardır. Saha, çizgiler, orta yuvarlak, kale fileleri ve direkler ayrı bir tuvalde bir kez çizilir, ölçü, ön ayar ya da renkler değişince yenilenir. Diskte takımın harfi ve takım içindeki numarası yazar (Türkçede K1, M2, İngilizcede R1, B2), takımlar yalnızca renkle ayrılmaz. Kendi diskinizin çevresinde bir halka, vuruş tutulurken dış bir halka vardır. Tuvalin erişilebilir adı skoru içerir ("Saha. Kırmızı 1, Mavi 0."). Sarsıntı efekti, geçiş ve canlandırma yoktur, bu yüzden hareketi azalt seçeneği bu ekranda bir şey değiştirmez.

Klavyede oklar veya WASD ile hareket edilir, X veya Boşluk ile vurulur. Tuşlar yalnızca maçta yuvası olan kişide, sahne oyun kipinde görünürken, odak yazı alanında değilken ve tam ekran dışında açık bir katman yokken dinlenir. Ok tuşları ve Boşluk o sırada sayfayı kaydırmaz ve odaktaki düğmeyi çalıştırmaz. Ses atamalarının tuşları (bas konuş, varsayılan V) oyunda kullanılmaz, ses motoruna kalır. Pencere odağı gidince, sekme gizlenince ya da sahne küçültülünce basılı tuşlar bırakılır. Oyun kolunda sol çubuk veya yön tuşları hareket, alt yüz düğmesi (Çarpı veya A) vuruştur. Ses atamalarındaki (bas konuş, sustur, sağırlaştır) kol düğmeleri ve yön tuşları oyunda kullanılmaz, basışı ses motoru alır: alt yüz düğmesi atanmışsa sol yüz düğmesi (Kare veya X), o da atanmışsa üst yüz düğmesi (Üçgen veya Y) vurur, üçü de atanmışsa kolda vuruş yoktur. Maç sürerken L1 ve R1 frekans değiştirmez, daire düğmesi yine üstteki katmanı (ör. tam ekranı) kapatır. Dokunmatik denetimler kaba işaretçili cihazda ya da sahaya ilk dokunuşta görünür: solda Pointer Events ve işaretçi yakalamayla çalışan sanal çubuk (`.hex-stick`, 8rem, telefonda 7rem ama en çok ekran genişliğinin yüzde 34'ü), sağda Vur düğmesi (`.hex-kick`, 6rem, telefonda 5.5rem ama en çok ekran genişliğinin yüzde 28'i). Telefondaki üst sınır büyük yazı boyutunda da iki denetimin ekrana sığmasını sağlar. Basılan işaretçinin hareketi ve bırakılması pencere düzeyinde izlenir. Tuvalde, çubukta ve Vur düğmesinde `touch-action: none` vardır, sayfa kaymaz. Vur düğmesi klavyeyle etkinleştirilince kısa bir vuruş yapar. Sahne açılınca odak Takımlar ekranında ev sahibinde Maçı Başlat'a, oyuncuda ilk takım düğmesine, maçta görünüyorsa Vur'a, değilse ev sahibinde Maçı Durdur'a gider. Goller, skor, başlama vuruşu, süre, altın gol, sonuç ve maçın duraklaması panelin kibar canlı bölgesinden duyurulur. Gerçek zamanlı maç ekran okuyucuyla oynanamaz, bu not güven satırının Ayrıntı bölümündedir.

Saha ve takım belirteçleri `tokens.css` içinde kart oyunlarının bloğundan önce, ortak koyu (`:root`) ve açık (`:root[data-scheme="light"]`) bloklardadır. Bu yüzden her temada aynıdır ve her tema ile modda çözülür. Tuval renkleri kök öğede çözülüp okunur, tema ya da mod değişince yeniden okunur.

| Belirteç | Koyu | Açık | Kullanım |
| --- | --- | --- | --- |
| `--hex-field` | `#1d5446` | `#d6efe2` | Saha zemini |
| `--hex-pattern` | `rgba(255, 255, 255, 0.06)` | `rgba(28, 74, 59, 0.09)` | Altıgen deseni |
| `--hex-out` | `#123a30` | `#bfe0cf` | Saha dışı ve tuvalin zemini |
| `--hex-line` | `#e6f2ec` | `#1c4a3b` | Saha çizgileri, orta yuvarlak, kale çerçevesi |
| `--hex-net` | `#2a6656` | `#c3e2d2` | Kale filesi |
| `--hex-post` | `#f4f6f5` | `#1c4a3b` | Direkler |
| `--hex-red`, `--hex-blue` | `#c9303f`, `#2d5fd3` | aynı | Disk, takım rozeti, takım sütununun üst kenarı, gol listesinin sol kenarı |
| `--hex-ink` | `#ffffff` | aynı | Disk ve rozet yazısı |
| `--hex-disc-edge` | `#f4f6f5` | `#10241d` | Disk kenarı |
| `--hex-ball`, `--hex-ball-edge` | `#ffffff`, `#0f1a16` | `#ffffff`, `#10241d` | Top ve kenarı |
| `--hex-me` | `#ffd447` | `#6a2fd0` | Kendi diskinizin halkası |
| `--hex-kick` | `#7fe6ff` | `#a1440a` | Vuruş tutulurken dış halka |

Kontrast oranları (`test/hexball-arayuz.test.js` her tema ve modda yeniden hesaplar):

| Çift | Eşik | Koyu | Açık |
| --- | --- | --- | --- |
| Yazı ve Kırmızı | 4.5:1 | 5.28 | 5.28 |
| Yazı ve Mavi | 4.5:1 | 5.69 | 5.69 |
| Saha çizgisi ve saha | 3:1 | 7.59 | 8.27 |
| Saha çizgisi ve saha dışı | 3:1 | 10.92 | 7.06 |
| Direk ve saha | 3:1 | 8.03 | 8.27 |
| Disk kenarı ve saha | 3:1 | 8.03 | 13.39 |
| Top ve saha (dolgu ya da kenar) | 3:1 | 8.72 | 13.39 |
| Top kenarı ve top | 3:1 | 17.80 | 16.25 |
| Kendi diskinizin halkası ve saha | 3:1 | 6.13 | 5.91 |
| Vuruş halkası ve saha | 3:1 | 6.09 | 5.17 |

## Bileşenler

| Bileşen | Sınıflar | Not |
| --- | --- | --- |
| Düğme | `.button`, `.button-secondary`, `.button-ghost`, `.button-danger`, `.button-small`, `.button-wide`, `.icon-button` | En az 44 piksel. Arcade'de tuş kapağı dudağı ve birincil degrade. |
| Giriş ve seçim | `.input`, `.select`, `.label`, `.hint`, `.form-error`, `.form-msg`, `.field-status` | Kenar `--edge` (3:1). |
| Onay ve anahtar | `.check`, `.switch`, `.segmented` | Turkuaz'da elmas topuz. |
| Kaydırıcı ve ölçer | `.range`, `.meter`, `.meter-bar`, `.meter-threshold` | Arcade'de segmentli, Gece'de LED bölütlü, Turkuaz'da karo bölmeli. |
| Tuş kapağı | `.kbd` | Bas konuş tuşu ve atama gösterimi. |
| Rozet ve etiket | `.badge-owner`, `.badge-admin`, `.tag`, `.unread-badge`, `.mention-badge` | Anma rozeti `--attention` rengindedir. |
| Avatar | `.avatar`, `.avatar-face`, `.avatar-img`, `.avatar-c0` ile `.avatar-c7`, `.avatar-xs`, `.avatar-sm`, `.avatar-md`, `.avatar-lg`, `.avatar-xl` | Durum `data-status` özniteliğiyle (`online`, `idle`, `dnd`, `offline`), konuşma `.is-speaking` ile. |
| Üst çubuk | `.top-bar`, `.top-side`, `.top-side-start`, `.top-brand-button`, `.top-personal`, `.top-personal-button`, `.top-chip`, `.top-me`, `.top-stack` | Frekans değiştirici, Çevrimiçi, Ara, kişisel düğmeler ve avatar çipi. Sol bölüm kısalabilir, frekans adı üç noktayla kısalır. |
| Frekans menüsü | `.frekans-menu`, `.frekans-row`, `.frekans-item`, `.frekans-emblem`, `.frekans-remove`, `.frekans-add` | Açık frekans `.is-active` ve `aria-checked="true"`. |
| Frekans fotoğrafı | `.frekans-photo`, `.emblem-letter`, `.has-photo`, `.auth-photo`, `.tanitim-photo`, `.settings-photo-emblem` | Fotoğraf amblemin içinde baş harfin üstünü örter ve amblemin köşe biçimini alır (`border-radius: inherit`, `object-fit: cover`), temaların amblem süsleri fotoğrafın üstüne çizilmez. Fotoğraf yoksa veya yüklenemezse öğe kaldırılır, `.has-photo` düşer ve baş harf görünür. Giriş ekranında ve tanıtım sayfasında fotoğraf adın solundadır, yoksa ekran eski görünümündedir. |
| Frekans bandı | `.band-track`, `.band-step`, `.band-all`, `.station`, `.station-frekans`, `.station-emblem`, `.frekans-dot`, `.station-meta`, `.needle`, `.frekans-sheet-row` | İstasyon durumları: `.is-tuned`, `.is-target`, `.is-unread`, `.is-mentioned` ve frekans durumu `.is-open`, `.is-online`, `.is-offline`, `.is-login`, `.is-unknown`. İbre: `.is-dragging`. |
| Sol sütun ve İstasyonlar | `.side-left`, `.info-bottom`, `.radio-slot`, `.facts`, `.hints`, `.hints-pop`, `.dm-section`, `.inbox`, `.inbox-head`, `.rooms-list`, `.room-row`, `.top-rooms` | Satır durumları: `.is-current`, `.is-unread`, ses için `.is-connected`, `.is-joining`, `.is-live`. |
| Konuşma sütunu | `.convo`, `.convo-head`, `.convo-title`, `.msg`, `.msg-skeleton`, `.channel-start`, `.typing-line`, `.mention-popover`, `.search-panel` | Beni anan mesaj `--mention-bg` zemin ve sol çizgiyle. |
| Telsiz kartı | `.radio`, `.radio-screen`, `.crew-item`, `.crew-badge`, `.crew-avatar.has-camera`, `.cam-video`, `.radio-tools`, `.cams-tool`, `.radio-talk`, `.radio-ptt`, `.radio-vad`, `.radio-cam-bar`, `.radio-cam-live`, `.radio-cam-flip`, `.radio-button` | Kadro öğesinde `.is-speaking` ve `.has-camera`, düğmelerde `aria-pressed`, kendi görüntüde `.is-mirrored` (arka kamera hariç), Kamerayı Çevir değiştirilirken `aria-disabled`. |
| Avatar menüsü | `.avatar-menu` | Durum seçenekleri `menuitemradio`. |
| Kişiler | `.member`, `.home-view`, `.home-tab`, `.dm-header`, `.people-card` | Çevrimiçi sayfası, Arkadaşlar istasyonu, özel mesaj başlığı. |
| Giriş kartı | `.auth-card`, `.auth-dial`, `.auth-needle` | Telsiz gövdesi biçiminde kart. |
| Ekran paylaşımı ve kameralar ızgarası | `.cast-panel`, `.cast-head`, `.cast-chip`, `.cast-video`, `.cast-cams`, `.cam-tile`, `.cast-dock-toggle`, `.top-cast-chip`, `.cast-preset` | Sahne açıkken `body[data-cast="live"]`, ızgarada `#cast[data-mode="cams"]`. |
| Oyun masası | `.game-tool`, `.cast-game`, `.game-body`, `.game-app`, `.game-status`, `.game-trust`, `.game-trust-row`, `.game-trust-chip`, `.game-seats-more`, `.game-seats-detail`, `.game-confirm`, `.game-picks`, `.game-pick`, `.renk-table`, `.renk-opp`, `.renk-deck`, `.renk-pile`, `.renk-color`, `.renk-actions`, `.renk-hand`, `.renk-card`, `.renk-back`, `.renk-picker` | Sahnede `#cast[data-mode="game"]`, Oyun düğmesinde `.is-invited`, `.is-busy`, `.is-turn`, masada `data-turn`, kartta `.is-playable`, `.is-blocked`, `.is-new`. |
| Hexball | `.hex-table`, `.hex-teams`, `.hex-team`, `.hex-roster`, `.hex-person`, `.hex-badge`, `.hex-chip`, `.hex-join`, `.hex-set`, `.hex-result`, `.hex-goals`, `.hex-board`, `.hex-clock`, `.hex-field`, `.hex-canvas`, `.hex-overlay`, `.hex-legend`, `.hex-touch`, `.hex-stick`, `.hex-kick` | Masada `data-ph`, takımda, rozette ve golde `data-side` (`red`, `blue`, `spec`), bağ çipinde `.is-waiting` ve `.is-failed`, saatte `.is-golden`, yazıda `data-kind` (`goal`, `kickoff`, `paused`, `link`, `over`), kişide ve açıklamada `.is-me`. |
| Telsiz DJ | `.dj-card`, `.dj-float`, `.dj-yt`, `.dj-dock`, `.dj-wave`, `.dj-ctrl`, `.dj-vol`, `.crew-dj`, `.radio-dj-consent` | YouTube oynatıcı alanı (`.dj-yt`) yazı boyutundan bağımsız olarak her zaman en az 200x200 CSS pikselidir ve üstüne hiçbir şey bindirilmez. Kart görünmezken, örtülürken veya Yüzen Oynatıcı açıkken oynatıcı yüzen kutuyla (`.dj-float`) dört köşeden birine sabitlenir, altında `.dj-dock` çubuğu durur. Henüz izin vermemiş kişide odada YouTube parçası çalarken telsiz kartında `.radio-dj-consent` uyarısı durur. |
| Ayarlar | `.settings-view`, `.settings-cat`, `.settings-section`, `.settings-theme-card`, `.settings-switch`, `.settings-number`, `.settings-facts`, `.settings-rec` | Seçili kategori ibre renginde sol çizgiyle işaretlenir. |
| Katmanlar | `.popup-menu`, `.popover`, `.modal`, `.sheet`, `.toast`, `.conn-banner` | Dar ekranda katmanlar alttan açılır. |

## Durum sınıfları ve JavaScript sözleşmesi

Bütün modüller aynı durum adlarını kullanır: `.is-speaking`, `.is-unread`, `.is-mentioned`, `.is-active`, `.is-blocked`, `.is-own` ve `data-status`. Seçili öğe için ayrıca `aria-current`, `aria-selected`, `aria-pressed` ve `aria-checked` biçimlendirilir. Bölge durumları öznitelikle taşınır: `#app-view[data-layout]`, `#app-view[data-view]`, `#radio[data-state]`, `body[data-cast]` ve `body[data-cast-chat]`. Oyun kolu algılanınca `#app-view` öğesine `.has-gamepad` sınıfı eklenir.

`02-state-dom.js` içindeki `avatar(userId, size)` avatarı çizer (`size`: `xs`, `sm`, `md`, `lg`, `xl`), `fillAvatar(node, userId, size)` var olan bir avatar öğesini yeniden çizer. Görünen ad, `@kullanıcı adı`, durum ve avatar bilgisi `13-profile.js` yardımcılarından gelir. Avatar resmi yalnızca `blob:` adresiyse gösterilir. Bandı `04-meta.js` çizer (istasyonları `24-frekans.js` üretir), etkileşimini `21-band.js` bağlar. Değişmeyen listeler yeniden çizilmez, böylece klavye odağı korunur. Katmanlar `02-state-dom.js` içindeki katman yığınını kullanır: açılınca odak ilk anlamlı öğeye gider, Esc ve dışarı tıklama kapatır, odak açan düğmeye döner. Yığın değişince `watchLayers(fn)` ile kaydolan işlevler çağrılır.

**Köşedeki oynatıcı.** YouTube'un gömülü oynatıcı kuralları oynatıcının en az 200x200 piksel ve görünür olmasını, üstüne hiçbir şey konmamasını ve oynatıcı gizlenip sesin arka planda çalınmamasını ister. Motor bu yüzden görünmeyen YouTube oynatıcısını bu cihazda duraklatır (`music.js syncPlayer`, ölçüm `dj/youtube.js visible`). Ayarlar açılınca, DJ sayfası dışında kartı örten bir katman açılınca (başka bir sayfa, pencere, görüntüleyici, kartın üstüne gelen menü) veya sayfa kipinde DJ sayfası kapalıyken (1280 pikselin altı, ekran paylaşımı yayında) müzik bu yüzden susmaz: `23-dj.js` `#dj` öğesine `.is-docked` koyar, yüzen kutu (`.dj-float`: oynatıcı alanı ve altında parça adı, duraklat veya devam (gerekiyorsa dokunarak başlat), Taşı, Küçült ve DJ kartını açan düğmelerin olduğu `.dj-dock` çubuğu) `data-dock` özniteliğiyle seçilen köşeye sabitlenir. Kutu çubuğundan sürüklenip en yakın köşeye bırakılır (`dockDrag`, çubukta `touch-action: none`), Taşı düğmesi köşeleri sırayla dolaşır, köşe cihazda saklanır (`telsiz.djDock`) ve 760 ile 1279 piksel arasında varsayılan köşe sağ üsttür. Küçültülen kutuda (`.is-dock-min`) yalnızca çubuk kalır. Yüzen Oynatıcı (`telsiz.djFloat`, `.is-dock-float`) kartı görünür bırakıp oynatıcıyı köşeye alır, dosya parçası da dalga biçimi ve çubukla köşede görünür. Kutu her katmanın, Ayarlar'ın ve kısa bildirimlerin üstündedir, çerçeve en az 200x200 kalır, çubuk çerçevenin dışındadır. Üst köşede kutu bandın altında durur. Alt köşede yer yettiği sürece aynı yandaki yazma alanının ve telsiz kartının üstüne çıkar, bir katman açıkken ekranın köşesine iner, güvenli alanlara uyar. Çerçeve ve ataları DOM'da hiç taşınmaz (taşınan çerçeve yeniden yüklenir), yalnızca sınıflar değişir: kart `visibility: hidden` ile gizlenir (kapalı sayfada `.is-dock-only` ile yer kaplamaz, sütunda yerini korur), oynatıcı ve çubuk görünür kalır, köşedeyken atalarda `overflow` görünür olur, `transform`, `filter`, `backdrop-filter`, `contain` ve `will-change` bulunmaz, gövdedeki `has-dj-dock` sınıfıyla `#app-view` kendi yığın bağlamını kaldırır, kısa bildirimler kutunun üstüne çıkar. Karar ölçülen görünürlüğe değil katman yığınına, sayfa kipine ve pencere boyutuna bağlıdır, böylece köşeye alma titremez. Dosya parçalarının görünürlük koşulu yoktur, müzik yalnızca ses odasından ayrılınca, DJ kapatılınca veya kuyruk bitince durur.

## Erişilebilirlik ve kontrast

Odak çerçevesi tasarımın parçasıdır: 3 piksel `--focus` çizgisi ve çevresinde yarı saydam bir hare, televizyon genişliğinde daha kalın. `:focus-visible` desteklemeyen eski tarayıcılarda aynı çerçeve `:focus` ile gelir. Bütün düğmeler ve alanlar en az 2.75rem (16 piksel kökte 44 piksel) yüksekliktedir. Durumlar yalnızca renkle değil biçimle ve metinle de ayrılır, istasyonların ve kadro öğelerinin erişilebilir adları okunmamış sayısını, bağlantı ve konuşma durumunu içerir. Hareketi azalt seçeneği geçişleri ve döngüleri durdurur ve sistemin `prefers-reduced-motion` ayarını izleyebilir.

Aşağıdaki tablo her rol için o tema ve moddaki en düşük kontrast oranını gösterir. Oranlar `public/css/tokens.css` içindeki belirteçlerden WCAG 2.x göreli parlaklık formülüyle hesaplandı (metin 4.5:1, arayüz bileşeni 3:1). Yarı saydam yüzeyler altlarındaki zeminle birleştirilerek ölçüldü, Arcade'in cam paneli hem düz zemin hem de en parlak ışık noktası üzerinde ölçüldü. Dolgu düğme yazısı (`--on-accent-fill`) degradenin iki ucu (`--accent-fill-a` ve `--accent-fill-b`) üzerinde ölçüldü. Canlı ve tehlike kenarı bütün yüzeylerde (üzerine gelme ve seçili zeminler dahil) ve kendi saydam zemininde ölçüldü, `test/tema.test.js` bu iki belirtecin her temada tanımlı olduğunu ve 3:1 eşiğini denetler. Tablodaki bütün değerler eşiği geçer.

| Rol | Eşik | Arcade koyu | Arcade açık | Gece Frekansı koyu | Gece Frekansı açık | Turkuaz ve Bakır koyu | Turkuaz ve Bakır açık |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ana metin | 4.5:1 | 12.92 | 15.23 | 13.16 | 12.60 | 10.08 | 11.27 |
| İkincil metin | 4.5:1 | 7.90 | 8.02 | 7.35 | 6.09 | 6.61 | 6.53 |
| Soluk metin (saat, etiket, yer tutucu) | 4.5:1 | 5.57 | 5.76 | 5.50 | 4.83 | 4.85 | 4.81 |
| Vurgu metni | 4.5:1 | 5.68 | 5.78 | 8.65 | 4.95 | 6.67 | 4.66 |
| İkinci vurgu metni | 4.5:1 | 9.06 | 4.86 | 9.36 | 5.03 | 5.33 | 4.97 |
| Bağlantı | 4.5:1 | 10.40 | 5.78 | 9.56 | 5.48 | 7.95 | 5.20 |
| Canlı (bağlı, konuşan) | 4.5:1 | 7.89 | 5.36 | 9.82 | 5.56 | 7.26 | 4.91 |
| Tehlike metni | 4.5:1 | 5.09 | 5.00 | 6.64 | 5.02 | 4.71 | 4.72 |
| Uyarı metni | 4.5:1 | 7.91 | 5.63 | 9.33 | 5.35 | 8.57 | 5.31 |
| Anma metni | 4.5:1 | 8.14 | 7.58 | 9.33 | 5.35 | 6.60 | 5.64 |
| Vurgu dolgusu üstü metin | 4.5:1 | 5.25 | 5.25 | 10.47 | 9.21 | 7.11 | 5.41 |
| Dolgu düğme yazısı | 4.5:1 | 5.25 | 4.82 | 10.47 | 5.01 | 7.11 | 5.41 |
| Degrade ikinci uç üstü metin (yalnız Arcade) | 4.5:1 | 10.48 | 10.48 | yok | yok | yok | yok |
| Dikkat rozeti metni | 4.5:1 | 5.25 | 5.25 | 10.47 | 9.21 | 6.65 | 4.82 |
| Tehlike dolgusu üstü metin | 4.5:1 | 8.37 | 6.67 | 8.49 | 6.66 | 7.06 | 6.53 |
| Girdi ve kart kenarı | 3:1 | 3.26 | 4.08 | 3.36 | 3.23 | 3.59 | 3.45 |
| Canlı kenarı | 3:1 | 3.24 | 3.23 | 3.07 | 3.48 | 3.22 | 3.23 |
| Tehlike kenarı | 3:1 | 3.22 | 3.21 | 3.39 | 3.53 | 3.20 | 3.21 |
| Odak çerçevesi | 3:1 | 10.63 | 6.37 | 15.65 | 12.60 | 9.24 | 6.95 |
| Durum: çevrimiçi | 3:1 | 9.47 | 6.21 | 10.35 | 3.41 | 7.83 | 5.65 |
| Durum: boşta | 3:1 | 9.50 | 4.60 | 9.56 | 3.32 | 8.58 | 5.03 |
| Durum: rahatsız etmeyin | 3:1 | 5.96 | 4.87 | 6.05 | 4.28 | 5.62 | 5.27 |
| Durum: çevrimdışı | 3:1 | 5.18 | 4.46 | 4.85 | 3.88 | 4.73 | 3.59 |
| Dolgu (gönder, anahtar, ölçer) | 3:1 | 4.56 | 4.88 | 9.89 | 3.92 | 6.63 | 4.36 |
| Dolgu ikinci uç | 3:1 | 9.10 | 4.28 | 9.89 | 3.92 | 6.63 | 4.36 |
| Avatar baş harfi (8 renk) | 4.5:1 | 8.64 | 8.64 | 7.26 | 6.62 | 5.49 | 5.49 |
| Çevrimdışı avatar baş harfi | 4.5:1 | 7.49 | 10.02 | 7.66 | 6.27 | 5.98 | 5.10 |

## Yeni tema ekleme

1. Temanın adını seçin (küçük harf, ör. `kumsal`) ve `public/theme-init.js` içindeki `SKINS` listesine ekleyin.
2. `public/css/tokens.css` dosyasına `:root[data-skin="kumsal"]` bloğunu (yazı tipleri, yarıçaplar, `--layout-pad`, `--column-gap`) ve `:root[data-skin="kumsal"][data-scheme="dark"]` ile `:root[data-skin="kumsal"][data-scheme="light"]` bloklarını ekleyin. "Tasarım belirteçleri" bölümündeki renk adlarının hepsini, `--on-accent-fill` dahil, tanımlayın. Eksik bir belirteç Arcade koyu değerine düşer. Frekans belirteçlerini ve `--avatar-radius` değerini değiştirmeyin.
3. Temaya özgü biçimler için `public/css/skins/kumsal.css` oluşturun. Her seçici `:root[data-skin="kumsal"]` ile başlamalı, işaretleme değiştirilmez. Konuşma göstergesini `.is-speaking`, durum işaretlerini `data-status` üzerinden çizin, avatar şeklini koruyun.
4. Dosyayı `index.html` içinde diğer tema dosyalarından sonra bağlayın ve `public/sw.js` önbellek listesine ekleyin. Yeni bir yazı tipi gerekiyorsa woff2 dosyasını ve lisansını `public/fonts/` altına koyun (dosya adı küçük harf, rakam ve tire), `base.css` içine `@font-face` (`font-display: swap`) ekleyin.
5. Ayarlar > Görünüm'deki tema kartı için `public/i18n.js` dosyasına `theme.skin.kumsal` ve `theme.skinHint.kumsal` anahtarlarını Türkçe ve İngilizce ekleyin, `components.css` içinde `.theme-swatch-kumsal` önizleme renklerini tanımlayın.
6. Bütün metin ve bileşen çiftlerinin kontrastını WCAG 2.x formülüyle ölçün ve yukarıdaki tabloya yeni sütunları ekleyin. Eşiğin altında kalan çift kalmamalıdır.
7. Uygulamayı 1920x1080, 1440x900, 1280x800, 900x800 ve 390x844 boyutlarında koyu ve açık modda açıp bant, ses odası, ekran paylaşımı, Telsiz DJ, emoji seçici, ayarlar ve giriş ekranını gözden geçirin. Yatay taşma, okunmayan metin ve görünmeyen odak çerçevesi olmamalıdır.

## Eski tarayıcı uyumu

Stil dosyaları oyun konsollarının eski WebKit tabanlı tarayıcılarında da çalışacak biçimde yazılır. Düzen yalnızca flexbox ve margin ile kurulur. `grid`, flex `gap`, `clamp()`, `:is()`, `:where()`, `aspect-ratio` ve `inset` kullanılmaz. Animasyon ve dönüşümler `-webkit-` önekleriyle de yazılır. `backdrop-filter` yalnızca `@supports` içinde ve `-webkit-backdrop-filter` ile birlikte kullanılır, desteklenmezse paneller opak `--surface-1` rengine düşer. Bandın ölçek çizgileri `background-attachment: local` ile kayar, bunu desteklemeyen tarayıcıda yalnızca süs kaybolur. Satır içi stil ve betik yoktur (içerik güvenliği politikası bunları engeller), simgeler `index.html` içindeki SVG kümesinden `<use>` ile (hem `href` hem `xlink:href`) alınır.
