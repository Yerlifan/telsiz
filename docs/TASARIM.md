# Telsiz tasarım sistemi

[Türkçe](TASARIM.md) | [English](DESIGN.md)

Telsiz'in arayüzü tek bir HTML yapısı, Frekans adlı bir düzen ve on görsel tema üzerine kuruludur. Düzen uygulamayı bir radyo kadranı gibi kurar: katıldığınız frekanslar (her biri bir Telsiz sunucusu) yatay bir frekans bandında istasyon olarak dizilir, açık frekansın yazı ve ses odaları sağdaki İstasyonlar listesindedir, ortada tek bir konuşma sütunu durur, ses odasına bağlanınca bir el telsizini andıran telsiz kartı açılır. Temalar yalnızca CSS belirteçlerini ve temaya özgü süsleri değiştirir, işaretleme hiçbir temada değişmez. Varsayılan tema Arcade'dir, ilk açılışta mod sistem tercihini izler (bilinmiyorsa koyu). Bu belge dosyaları, düzeni, kesme noktalarını, belirteçleri, temaları, bileşenleri, kontrast ölçümlerini ve yeni bir tema eklemenin adımlarını anlatır.

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
| `public/css/skins/*.css` | Temaya özgü biçimler, her tema için bir dosya: `arcade`, `gece`, `turkuaz`, `saha`, `lamba`, `fosfor`, `kutup`, `plak`, `kokpit`, `kontrast`. |
| `public/fonts/` | Yerel woff2 yazı tipleri ve OFL lisans metinleri. |

`index.html` stil dosyalarını şu sırayla bağlar: tokens, base, frekans, components, settings, chat-plus, convo, radio, people, cast, dj, arama, tanitim, ardından tema dosyaları (`theme-init.js` listesindeki sırayla). Tema dosyalarındaki her kural `:root[data-skin="..."]` ile başladığı için yalnızca etkin temanın kuralları uygulanır. Bütün tema dosyalarının birlikte yüklenmesi tema değişimini sayfa yenilemeden anında yapar.

## Tema arayüzü

`theme-init.js` şu arayüzü sunar. Ayarlar > Görünüm sayfası ve uygulama yalnızca bu arayüzü kullanır.

| Üye | Açıklama |
| --- | --- |
| `TelsizTheme.get()` | Geçerli tercihleri döner: tema (`skin`), seçilen mod (`scheme`: `dark`, `light`, `system`), uygulanan mod (`resolvedScheme`), yazı boyutu, kompakt görünüm ve hareketi azaltma. |
| `TelsizTheme.set(partial)` | Verilen alanları doğrular, cihazda saklar, kök özniteliklerini günceller ve dinleyicileri çağırır. |
| `TelsizTheme.skins` | `['arcade', 'gece', 'turkuaz', 'saha', 'lamba', 'fosfor', 'kutup', 'plak', 'kokpit', 'kontrast']`. Tema listesinin tek kaynağıdır, Ayarlar > Görünüm kartları bu listeden çizilir. |
| `TelsizTheme.contrastSkin` | `'kontrast'`: Erişilebilirlik teması. Ayarlar > Görünüm'de ayrı grupta listelenir, sistem yüksek karşıtlık istiyorsa ilk açılışta seçilir. |
| `TelsizTheme.onChange(fn)` | Değişiklik dinleyicisi ekler, kaldırmak için bir fonksiyon döner. "Sistem" seçiliyse sistem modu değişince de çağrılır. |

Kök öğe (`<html>`) öznitelikleri: `data-skin` (tema listesindeki kimliklerden biri), `data-scheme` (`dark`, `light`), `data-font-size` (`auto`, `small`, `normal`, `large`, `tv`), `data-compact` ve `data-reduce-motion` (`true`, `false`). Cihazdaki anahtarlar `telsiz.skin`, `telsiz.scheme`, `telsiz.fontSize`, `telsiz.compact` ve `telsiz.reduceMotion` adlarını taşır. Depolama kapalıysa seçim yalnızca o oturumda geçerlidir.

Cihazda saklı (geçerli) bir tema tercihi yoksa ve sistem yüksek karşıtlık istiyorsa (`prefers-contrast: more` veya Windows Yüksek Karşıtlık gibi zorlanmış renkler, `forced-colors: active`) sayfa Yüksek Kontrast temasıyla açılır, yoksa Arcade ile. Bu seçim saklanmaz: kişi Ayarlar'dan bir tema seçene kadar her açılışta sistem ayarına bakılır, seçilen tema saklanır ve sistem ayarının önüne geçer. Bu medya sorgularını tanımayan eski tarayıcılarda varsayılan Arcade kalır.

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

Bileşenler renk değeri yazmaz, yalnızca anlamsal belirteçleri kullanır. Her tema ve mod renk belirteçlerinin hepsini tanımlar. Frekans düzeninin belirteçleri yalnızca tema belirteçlerine başvurur, bu yüzden her temada ve iki modda kendiliğinden doğru renk alır.

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
| `--role-red` ile `--role-pink` | Sekiz özel rol rengi (rol rozetinin yazısı, Ayarlar > Roller). Koyu ve açık mod için ortak tonlar her yüzeyde en az 4.5:1 verir, zemini bunlara uymayan tema (Fosfor açık, Yüksek Kontrast) sekiz rengi kendi bloğunda ezer. |
| `--tone-camera`, `--tone-mic`, `--tone-deafen`, `--tone-screen` | Telsiz kartındaki Kamera, Mikrofon, Sağırlaştır ve Ekran düğmelerinin simge ve kenar rengi (`radio.css` `tone-*`). Varsayılanları mavi, yeşil, mor ve turuncu rol renkleridir, bir tema yalnızca tonları da ezebilir. |
| `--av-0` ile `--av-7`, `--av-fg`, `--av-offline` | Sekiz avatar ve profil rengi, baş harf rengi, çevrimdışı avatar dolgusu. Gece temasında her renk kendi baş harf rengine sahiptir (`--av-fg-0` ile `--av-fg-7`). |
| `--theme-color` | Tarayıcı çubuğu rengi |

Biçim ve yazı (temaya göre değişir, köşeler sırasıyla `--radius-panel`, `--radius-card` ve `--radius-control`):

| Tema | Gövde (`--font-body`) | Başlık (`--font-display`) | Etiket (`--font-label`) | Köşeler | Kenar (`--border-width`) |
| --- | --- | --- | --- | --- | --- |
| Arcade | Rubik | Unbounded 700 | Unbounded | 24px (yüzen paneller), 18px, 14px | 1px |
| Gece Frekansı | Manrope | Manrope 800 | Martian Mono | 0 (düz paneller), 14px, 12px | 1px |
| Turkuaz ve Bakır | Figtree | Young Serif 400 | Young Serif | 0, 1.125rem, 0.75rem | 1px |
| Saha Telsizi | Manrope | Martian Mono 500 | Martian Mono | 0, 6px, 4px | 1px |
| Lambalı Radyo | Manrope | Young Serif 400 | Young Serif | 0, 1rem, 0.625rem | 1px |
| Fosfor | Manrope | Martian Mono 500 | Martian Mono | 0, 3px, 2px | 1px |
| Kutup İstasyonu | Figtree | Unbounded 700 | Martian Mono | 14px, 12px, 10px | 1px |
| Plak | Rubik | Young Serif 400 | Rubik | 22px, 16px, 14px | 1px |
| Kokpit | Manrope | Martian Mono 500 | Martian Mono | 0, 8px, 6px | 1px |
| Yüksek Kontrast | Figtree | Figtree 800 | Figtree | 0, 6px, 6px | 2px |

Yeni temalar yeni yazı tipi getirmez, var olan altı ailenin (Rubik, Unbounded, Manrope, Martian Mono, Figtree, Young Serif) başka birleşimlerini kullanır. Martian Mono yalnızca 500 kalınlıkta paketlenmiştir.

## Temalar

**Arcade (varsayılan).** Oyun salonu lobisi. Koyu kömür zeminde yüzen cam paneller, alt kenarında dudak taşıyan ve basınca içeri çöken tuş kapağı düğmeler, mor ile camgöbeği arası degrade yalnızca küçük ve anlamlı yüzeylerde (ayarlı istasyonun kenarı, rozetler, Gönder, Bas konuş kubbesi, konuşan hale). Kabin düğmesi gibi kubbeli Bas konuş, segmentli seviye ölçer, odakta liste satırının solunda küçük bir "arcade imleci". Açık mod aynı biçim dilini lavanta griye taşır. Logo, favicon ve uygulama simgeleri Arcade kimliğini kullanır.

**Gece Frekansı.** Radyo istasyonu. Gece mavisi zemin, tek vurgu kehribar sinyal, yayında yeşili yalnızca canlı olan şeylerde. Düz paneller ve ince ayırıcılar, telsiz kartı konsol zemininde. İstasyonlar listesindeki odaların yanında oda kimliğinden türetilen bir frekans rozeti (yalnızca bu temada görünür). Durum noktaları cihaz panelindeki LED'ler gibidir. Konuşan kişide yeşil halka ve ekolayzır çubukları, mesaj akışında saatler tek aralıklı bir sütun, tırtıklı yuvarlak Bas konuş ve YAYINDA lambası.

**Turkuaz ve Bakır.** Çini ve geometrik desen geleneği. Turkuaz "yer ve güven", bakır "size yönelik dikkat ve ses" anlamı taşır. Başlıkların altında elmas zincirli kuşak frizi, kemer biçimli amblem ve kartlar, elmas desenli durum dolguları, konuşan kişide nefes alan yeşil hale, asimetrik bakır Bas konuş, bakır mühürlü şifreli mesaj kartı. Desen yalnızca kenarlarda ve boş alanlarda durur, metin her zaman düz zemindedir. Rakam içeren metinler Figtree ile yazılır, çünkü Young Serif'in rakamları eski üsluptur.

**Saha Telsizi.** Askerî sahra telsizi. Zeytin yeşili gövde, turuncu sinyal, tek aralıklı şablon etiketler ve saatler. Kesik çizgili şerit ayırıcılar, kare LED'ler, ince dokulu mat kauçuk Bas konuş ve kare köşeli telsiz gövdesi. Odalar İstasyonlar listesinde ve bantta kanal frekansıyla görünür.

**Lambalı Radyo.** 1950'ler lambalı radyosu. Ceviz kasa, fildişi kadran ve pirinç yazılar. Koyu modda telsiz gövdesinde ince ceviz damarı, bantta ve telsiz ekranında kadran camı parlaması, tırtıklı topuz gibi Bas konuş kubbesi ve bağlıyken "sihirli göz" yeşiliyle ışıyan ayar lambası.

**Fosfor.** Tarayıcı telsizi ve katot ışınlı ekran. Yeşil fosfor, size yönelik şeyler (anma, dikkat) kehribar fosfor. Tarama çizgileri yalnızca bantta, telsiz ekranında ve üst çubukta durur, koyu modda ayarlı istasyon ve oda adı hafifçe parlar. Açık mod bir LCD ekrandır, bant ve telsiz ekranı ince hücrelidir. Odalar frekansıyla görünür, köşeler neredeyse keskindir.

**Kutup İstasyonu.** Kutup araştırma istasyonu. Buzul mavisi ve buz beyazı, dikkat rengi parka turuncusu. Zeminde ince harita ızgarası, bant, konuşma sütunu ve sütun kartları buzlu cam (yalnızca `backdrop-filter` destekleniyorsa, bu temanın `--surface-1-glass` belirteci yarı saydamdır, telefonda paneller opaktır). Telsiz gövdesinin üstünde turuncu şerit. Açık mod öncelikli tasarlandı.

**Plak.** Gece yarısı plak yayını. Patlıcan moru zemin, gül pembesi plak etiketi ve altın yaldız bölüm yazıları. Bas konuş kubbesinde ve Telsiz DJ kartının köşesinde ince plak yivleri, hap biçimli Bas konuş, yuvarlak hatlı paneller.

**Kokpit.** Cam kokpit. Grafit gövde, macenta etkin rota (ibre), camgöbeği seçim, kehribar dikkat. Telsiz gövdesinin ve bandın köşelerinde çerçeve vidaları, telsiz kartı düğmeleri çok işlevli ekranın yumuşak tuşları gibi, saatler tek aralıklı gösterge yazısıyla.

**Yüksek Kontrast (Erişilebilirlik).** En yüksek okunurluk için. Metin rolleri en az 7:1 (WCAG AAA), 2 piksel kenarlar, degrade, gölge, parıltı ve zemin ışığı yok. Bağlantılar altı çizili, odak çerçevesi 4 piksel. Devre dışı düğmeler soluklaşmaz (saydamlık yazının kontrastını düşürür), boş yazma alanındaki Gönder dahil kesik kenar ve ikincil metin rengiyle ayrılır. Ayarlar > Görünüm'de Erişilebilirlik grubundadır ve sistem yüksek karşıtlık istiyorsa ilk açılışta seçilir.

Konuşma göstergesi her temada farklı görünür ama hep aynı durum sınıfıyla (`.is-speaking`) tetiklenir. Hareketi azalt açıkken hale, nabız, ekolayzır ve yazıyor noktaları durağan kalır, bilgi kaybolmaz. Temaya özgü süs simgeleri işaretlemede `.skin-arcade`, `.skin-gece` ve `.skin-turkuaz` sınıflarıyla durur ve yalnızca kendi temasında görünür, örneğin Gönder düğmesinin simgesi. Yeni temalar bu üç simgeden birini kendi süs dosyasında gösterir (Saha Telsizi, Fosfor ve Kokpit yukarı ok, Lambalı Radyo, Kutup İstasyonu ve Yüksek Kontrast kâğıt uçak, Plak oynat üçgeni), böylece telefonda etiket gizlenince Gönder düğmesinde her temada bir simge kalır.

## Avatar ve durum şekli

Bütün avatarlar her temada yumuşak kenarlı karedir, daire değildir: mesaj akışı, telsiz kartının kadrosu, Çevrimiçi şeridi ve sayfası, profil kartı, avatar menüsü, arkadaşlar, özel mesajlar, öneri listeleri ve arama sonuçları. Köşe yarıçapı `--avatar-radius: 28%` ile verilir. Değer yüzde olduğu için küçük yığın avatarında da büyük profil avatarında da oran aynıdır.

Durum noktası ve köşe işaretleri (susturulmuş, sağırlaştırılmış, ekran paylaşıyor) aynı aileden yumuşak karedir (`--dot-radius: 32%`), avatarın sağ alt köşesine oturur ve zemin renginde bir kenarla ayrılır. Konuşma halesi `box-shadow` ile çizildiği için kare çerçevenin dışını izler. Telsiz DJ gerçek bir kullanıcı değildir: avatarı kesik çizgili kenarlı bir nota simgesidir ve "bot" etiketi taşır. Kamera kutusu avatarın kendisidir ve aynı yumuşak kare biçimi korur, kadrodaki Büyüt öğesi Telsiz DJ gibi kesik çizgili kenarlı bir simgedir. Daire olarak kalanlar avatar değildir: ibre topuzu, nabız noktası, LED, Bas konuş kubbesi ve radyo seçim noktası.

## Kamera

Kamera telsiz kartında başlar ve aynı Frekans biçim dilini kullanır. Düğme sırasındaki Kamera düğmesi (`#btn-camera`) üst satırın başındadır, varsayılan olarak kapalıdır, açıkken Ekran düğmesinin yayında görünümünü (`.is-live`, `--live`) alır, cihaz desteklemiyorsa veya sahip kameraları kapattıysa kesik kenarlı ve devre dışıdır ve nedeni altında yazar (`#radio-camera-note`). Kameranız açıkken Bas konuş veya ses etkinliği satırının üstünde kayıt lambalı bir gösterge (`#radio-cam-live`, `--danger`, `--danger-bg` ve `--danger-edge`, "Kameranız açık, odadaki herkes görüyor") her düzende, telefonda da görünür.

Gösterge kamera çubuğunun (`#radio-cam-bar`) içindedir. Birden çok kamerası olan cihazda (telefonda ön ve arka kamera, bilgisayarda takılı ikinci kamera) kamera açıkken yanında etiketli Kamerayı Çevir düğmesi (`#btn-camera-flip`, `.radio-cam-flip`) durur, ipucu sıradaki kameraya geçtiğini söyler. Kamera değiştirilirken düğme odağı korumak için `disabled` yerine `aria-disabled="true"` alır, soluklaşır ve imleç `progress` olur. Çubuk satır kırabilir: göstergenin taban genişliği 11rem'dir, ikisi yan yana sığmazsa (760 piksel ve üstündeki dar kart) Kamerayı Çevir alt satıra iner, telefonda ikisi tek satırdadır. Aralığı öğelerin kenar boşluğu ve kabın eksi kenar boşluğu verir. Özel aramada denetim satırında Kamera ile Aramayı Bitir arasında Çevir düğmesi durur (`.call-control.is-flip`, erişilebilir adı Kamerayı Çevir, değiştirilirken `aria-disabled`). Dört düğmeli satır `.has-flip` alır ve yazılar 540 piksel ve altında ve 760 ile 899 piksel arasında da gizlenir, böylece satır tek kalır. Erişilebilir ad ve ipucu (`title`) kalır.

Kamerası açık kişinin kadro öğesi aynı yumuşak kare avatar biçiminde (`--avatar-radius`) daha büyük bir canlı görüntü kutusuna döner (`.crew-avatar.has-camera`, geniş ekranda 4.75rem, orta ekranda 3.75rem, telefonda 2.75rem). Görüntü (`.cam-video`, `object-fit: cover`) ilk kare gelene kadar saydamdır, altındaki avatar görünür. Kendi görüntünüz aynalıdır (`.is-mirrored`), arka kamerada (yön `environment`) aynalanmaz. Köşe işaretleri ve konuşma halesi görüntünün üstünde kalır. Kadro ortalanır. Ekran paylaşan kişinin öğesinde üstüne gelince veya odaklanınca (fare olmayan cihazlarda her zaman) Yayına katıl düğmesi (`.crew-watch`) çıkar ve paylaşımı izlemeye başlar. Başkasının paylaşımı üst çubukta gösterilmez. Mikrofon düğmesine sağ tıklamak veya Shift+F10 Bas konuş ile Ses etkinliği arasında seçim yapan küçük bir menü açar (`#mic-menu`, `29-mikrofon.js`). Odada kamera varsa kadronun altındaki araç satırında, Telsiz DJ düğmesinden önce kesik çizgili kenarlı ve kamera sayısını gösteren Büyüt düğmesi (`.cams-tool`, `#radio-cams`) durur. Basınca kameralar yayın sahnesinde ızgara olarak açılır (`#cast[data-mode="cams"]`, `.cast-cams`, `.cam-tile`). Izgara açıkken sağ sütun yerinde kalır, sahne yalnızca konuşma sütununu kaplar ve son mesajlar sahnenin altında açık durur. Başlıktaki Sığdır ve Doldur düğmeleri kameraların görünümünü seçer, seçim ekran paylaşımından ayrı saklanır (varsayılan Doldur). Başlık düğmelerinin ipucu (`title`) görünür etiketle aynıdır ve dil değişince yenilenir, 999 piksel ve altında Sığdır, Doldur ve Tam Ekran yalnızca simge olduğunda da fareyle okunur. Tam ekranda Tam Ekran düğmesi Tam Ekrandan Çık olur ve içe dönük köşeli `i-compress` simgesini alır, böylece yanındaki Küçült'ün X'iyle (`i-close`) karışmaz. Izgara kamera sayısına göre 1, 2x1, 2x2, 3x2, 3x3 veya 4x3 eşit kutuya bölünür, kutular kart köşelidir, ad etiketi görüntünün üstünde koyu zeminde durur ve konuşan kişinin kutusunda canlı renkli çerçeve belirir. İzlenen bir ekran paylaşımı ızgaranın önüne geçer, son kamera kapanınca ızgara kendiliğinden kapanır.

Ayarlar > Genel sayfasında iki bölüm vardır. Ses odaları ve kameralar bölümü (`#set-voice-limits-section`) sayı alanlarıyla (`.settings-number`) ses odası kapasitesini ve kamera sınırını, bir anahtarla kameraları gösterir. Yönetici alanları devre dışı görür. Sunucu bilgileri bölümü (`#set-server-info-section`) etiket ve değer satırlarını (`.settings-facts`, `.settings-fact`), altında öneriyi (`.settings-rec`: yükleme hızı alanı, sonuç satırları `.settings-rec-item`, formül açıklaması, ipuçları `.settings-rec-hint` ve Öneriyi uygula düğmesi) gösterir. Uyarılar `--warn`, `--warn-bg` ve `--warn-line` belirteçleriyle, olumlu ipucu `--live` kenarıyla çizilir. Telefonda etiket değerin üstüne iner.

## Bileşenler

| Bileşen | Sınıflar | Not |
| --- | --- | --- |
| Düğme | `.button`, `.button-secondary`, `.button-ghost`, `.button-danger`, `.button-small`, `.button-wide`, `.icon-button` | En az 44 piksel. Arcade'de tuş kapağı dudağı ve birincil degrade. |
| Giriş ve seçim | `.input`, `.select`, `.label`, `.hint`, `.form-error`, `.form-msg`, `.field-status` | Kenar `--edge` (3:1). |
| Onay ve anahtar | `.check`, `.switch`, `.segmented` | Turkuaz'da elmas topuz. |
| Kaydırıcı ve ölçer | `.range`, `.meter`, `.meter-bar`, `.meter-threshold` | Arcade'de segmentli, Gece'de LED bölütlü, Turkuaz'da karo bölmeli. |
| Tuş kapağı | `.kbd` | Bas konuş tuşu ve atama gösterimi. |
| Rozet ve etiket | `.badge-owner`, `.badge-admin`, `.badge-member`, `.badge-custom`, `.tag`, `.unread-badge`, `.mention-badge` | Anma rozeti `--attention` rengindedir. Soluk Üye rozeti (`.badge-member`) yalnızca profil kartında, Ayarlar önizlemesinde ve avatar menüsünde çıkar, mesaj akışında ve Çevrimiçi listesinde düz üyenin rozeti yoktur. |
| Avatar | `.avatar`, `.avatar-face`, `.avatar-img`, `.avatar-c0` ile `.avatar-c7`, `.avatar-xs`, `.avatar-sm`, `.avatar-md`, `.avatar-lg`, `.avatar-xl` | Durum `data-status` özniteliğiyle (`online`, `idle`, `dnd`, `offline`), konuşma `.is-speaking` ile. |
| Üst çubuk | `.top-bar`, `.top-side`, `.top-side-start`, `.top-brand-button`, `.top-personal`, `.top-personal-button`, `.top-chip`, `.top-me`, `.top-stack` | Frekans değiştirici, Çevrimiçi, Ara, kişisel düğmeler ve avatar çipi. Sol bölüm kısalabilir, frekans adı üç noktayla kısalır. |
| Frekans menüsü | `.frekans-menu`, `.frekans-row`, `.frekans-item`, `.frekans-emblem`, `.frekans-remove`, `.frekans-add` | Açık frekans `.is-active` ve `aria-checked="true"`. |
| Frekans fotoğrafı | `.frekans-photo`, `.emblem-letter`, `.has-photo`, `.auth-photo`, `.tanitim-photo`, `.settings-photo-emblem` | Fotoğraf amblemin içinde baş harfin üstünü örter ve amblemin köşe biçimini alır (`border-radius: inherit`, `object-fit: cover`), temaların amblem süsleri fotoğrafın üstüne çizilmez. Fotoğraf yoksa veya yüklenemezse öğe kaldırılır, `.has-photo` düşer ve baş harf görünür. Giriş ekranında ve tanıtım sayfasında fotoğraf adın solundadır, yoksa ekran eski görünümündedir. |
| Frekans bandı | `.band-track`, `.band-step`, `.band-all`, `.station`, `.station-frekans`, `.station-emblem`, `.frekans-dot`, `.station-meta`, `.needle`, `.frekans-sheet-row` | İstasyon durumları: `.is-tuned`, `.is-target`, `.is-unread`, `.is-mentioned` ve frekans durumu `.is-open`, `.is-online`, `.is-offline`, `.is-login`, `.is-unknown`. İbre: `.is-dragging`. |
| Sol sütun ve İstasyonlar | `.side-left`, `.info-bottom`, `.radio-slot`, `.facts`, `.hints`, `.hints-pop`, `.dm-section`, `.inbox`, `.inbox-head`, `.rooms-list`, `.room-row`, `.top-rooms` | Satır durumları: `.is-current`, `.is-unread`, ses için `.is-connected`, `.is-joining`, `.is-live`. |
| Konuşma sütunu | `.convo`, `.convo-head`, `.convo-title`, `.msg`, `.msg-skeleton`, `.channel-start`, `.typing-line`, `.mention-popover`, `.search-panel` | Beni anan mesaj `--mention-bg` zemin ve sol çizgiyle. |
| Telsiz kartı | `.radio`, `.radio-screen`, `.crew-item`, `.crew-badge`, `.crew-avatar.has-camera`, `.cam-video`, `.radio-tools`, `.cams-tool`, `.radio-talk`, `.radio-ptt`, `.radio-vad`, `.radio-cam-bar`, `.radio-cam-live`, `.radio-cam-flip`, `.radio-button` | Kadro öğesinde `.is-speaking` ve `.has-camera`, düğmelerde `aria-pressed`, kendi görüntüde `.is-mirrored` (arka kamera hariç), Kamerayı Çevir değiştirilirken `aria-disabled`. |
| Profil kartı | `.profile-card`, `.profile-card-band`, `.profile-card-head`, `.profile-card-body`, `.profile-identity`, `.profile-identity-name`, `.profile-identity-badges`, `.profile-identity-handle` | Avatar renk bandına biner. Görünen ad avatarın sağında, rol rozetleri (temel rol ve varsa özel rol) adın hemen yanında, @kullanıcı adı adın altındadır (`13-profile.js buildProfileIdentity`). Ad uzunsa rozetler alt satıra kayar, kart 18rem'den darsa ad, rozetler ve @kullanıcı adı avatarın altına iner. Ayarlar'daki iki önizleme kartı ve avatar menüsünün başı aynı düzeni kullanır. Kişinin kapak fotoğrafı varsa bandın içinde durur (`.profile-card-band.has-cover`, `.profile-card-cover`, `object-fit: cover`), banda binen avatar (`.avatar-wrap`, `position: relative`) ağaçta banttan sonra geldiği için kapağın üstünde çizilir. Turkuaz'da bant ve kapak kemer biçimini korur. |
| Avatar menüsü | `.avatar-menu` | Durum seçenekleri `menuitemradio`. Baş kısımda adın yanında rol rozetleri, altında @kullanıcı adı. |
| Kişiler | `.member`, `.home-view`, `.home-tab`, `.dm-header`, `.people-card` | Çevrimiçi sayfası, Arkadaşlar istasyonu, özel mesaj başlığı. |
| Giriş kartı | `.auth-card`, `.auth-dial`, `.auth-needle` | Telsiz gövdesi biçiminde kart. |
| Ekran paylaşımı ve kameralar ızgarası | `.cast-panel`, `.cast-head`, `.cast-chip`, `.cast-video`, `.cast-cams`, `.cam-tile`, `.cast-dock-toggle`, `.top-cast-chip`, `.cast-preset` | Sahne açıkken `body[data-cast="live"]`, ızgarada `#cast[data-mode="cams"]`. |
| Telsiz DJ | `.dj-card`, `.dj-yt`, `.dj-dock`, `.dj-wave`, `.dj-ctrl`, `.dj-vol`, `.crew-dj` | YouTube oynatıcı alanı (`.dj-yt`) yazı boyutundan bağımsız olarak her zaman en az 200x200 CSS pikselidir ve üstüne hiçbir şey bindirilmez. Kart görünmezken veya örtülürken oynatıcı köşeye sabitlenir, altında `.dj-dock` çubuğu durur. |
| Ayarlar | `.settings-view`, `.settings-cat`, `.settings-section`, `.settings-theme-cards`, `.settings-theme-group`, `.settings-theme-list`, `.settings-theme-card`, `.settings-switch`, `.settings-number`, `.settings-facts`, `.settings-rec` | Seçili kategori ibre renginde sol çizgiyle işaretlenir. Tema kartları tek radyo grubudur ve Telsiz Temaları ile Erişilebilirlik başlıklı iki grupta durur. Önizleme şeridi 2rem, açıklama yalnızca seçili kartta görünür (öteki kartlarda `aria-describedby` ile okunur). |
| Katmanlar | `.popup-menu`, `.popover`, `.modal`, `.sheet`, `.toast`, `.conn-banner` | Dar ekranda katmanlar alttan açılır. |

## Durum sınıfları ve JavaScript sözleşmesi

Bütün modüller aynı durum adlarını kullanır: `.is-speaking`, `.is-unread`, `.is-mentioned`, `.is-active`, `.is-blocked`, `.is-own` ve `data-status`. Seçili öğe için ayrıca `aria-current`, `aria-selected`, `aria-pressed` ve `aria-checked` biçimlendirilir. Bölge durumları öznitelikle taşınır: `#app-view[data-layout]`, `#app-view[data-view]`, `#radio[data-state]`, `body[data-cast]` ve `body[data-cast-chat]`. Oyun kolu algılanınca `#app-view` öğesine `.has-gamepad` sınıfı eklenir.

`02-state-dom.js` içindeki `avatar(userId, size)` avatarı çizer (`size`: `xs`, `sm`, `md`, `lg`, `xl`), `fillAvatar(node, userId, size)` var olan bir avatar öğesini yeniden çizer. Görünen ad, `@kullanıcı adı`, durum ve avatar bilgisi `13-profile.js` yardımcılarından gelir. Avatar resmi yalnızca `blob:` adresiyse gösterilir. Bandı `04-meta.js` çizer (istasyonları `24-frekans.js` üretir), etkileşimini `21-band.js` bağlar. Değişmeyen listeler yeniden çizilmez, böylece klavye odağı korunur. Katmanlar `02-state-dom.js` içindeki katman yığınını kullanır: açılınca odak ilk anlamlı öğeye gider, Esc ve dışarı tıklama kapatır, odak açan düğmeye döner. Yığın değişince `watchLayers(fn)` ile kaydolan işlevler çağrılır.

**Köşedeki oynatıcı.** YouTube'un gömülü oynatıcı kuralları oynatıcının en az 200x200 piksel ve görünür olmasını, üstüne hiçbir şey konmamasını ve oynatıcı gizlenip sesin arka planda çalınmamasını ister. Motor bu yüzden görünmeyen YouTube oynatıcısını bu cihazda duraklatır (`music.js syncPlayer`, ölçüm `dj/youtube.js visible`). Ayarlar açılınca, DJ sayfası dışında kartı örten bir katman açılınca (başka bir sayfa, pencere, görüntüleyici, kartın üstüne gelen menü) veya sayfa kipinde DJ sayfası kapalıyken (1280 pikselin altı, ekran paylaşımı yayında) müzik bu yüzden susmaz: `23-dj.js` `#dj` öğesine `.is-docked` koyar, oynatıcı alanı sağ alt köşeye sabitlenir ve altında parça adı, duraklat veya devam (gerekiyorsa dokunarak başlat) ve DJ kartını açan düğmelerin olduğu `.dj-dock` çubuğu durur. Kutu her katmanın, Ayarlar'ın ve kısa bildirimlerin üstündedir, çerçeve en az 200x200 kalır, çubuk çerçevenin dışındadır. Telefonda kutu yazma alanının üstünde durur, bir katman açıkken ekranın altına iner, güvenli alanlara uyar. Çerçeve ve ataları DOM'da hiç taşınmaz (taşınan çerçeve yeniden yüklenir), yalnızca sınıflar değişir: kart `visibility: hidden` ile gizlenir (kapalı sayfada `.is-dock-only` ile yer kaplamaz, sütunda yerini korur), oynatıcı ve çubuk görünür kalır, köşedeyken atalarda `overflow` görünür olur, `transform`, `filter`, `backdrop-filter`, `contain` ve `will-change` bulunmaz, gövdedeki `has-dj-dock` sınıfıyla `#app-view` kendi yığın bağlamını kaldırır, kısa bildirimler kutunun üstüne çıkar. Karar ölçülen görünürlüğe değil katman yığınına, sayfa kipine ve pencere boyutuna bağlıdır, böylece köşeye alma titremez. Dosya parçalarının görünürlük koşulu yoktur, müzik yalnızca ses odasından ayrılınca, DJ kapatılınca veya kuyruk bitince durur.

## Erişilebilirlik ve kontrast

Odak çerçevesi tasarımın parçasıdır: 3 piksel `--focus` çizgisi ve çevresinde yarı saydam bir hare, televizyon genişliğinde daha kalın. `:focus-visible` desteklemeyen eski tarayıcılarda aynı çerçeve `:focus` ile gelir. Bütün düğmeler ve alanlar en az 2.75rem (16 piksel kökte 44 piksel) yüksekliktedir. Durumlar yalnızca renkle değil biçimle ve metinle de ayrılır, istasyonların ve kadro öğelerinin erişilebilir adları okunmamış sayısını, bağlantı ve konuşma durumunu içerir. Hareketi azalt seçeneği geçişleri ve döngüleri durdurur ve sistemin `prefers-reduced-motion` ayarını izleyebilir.

Zorlanmış renk kipinde (Windows Yüksek Karşıtlık gibi) tarayıcı renkleri sistem renkleriyle değiştirir ve gölgeleri kaldırır. Bu kipte seçili ve ayarlı öğeler (ayarlı istasyon ve oda, açık özel mesaj, üst çubukta seçili kişisel düğme, seçili ayar kategorisi ve tema kartı) sistem vurgusu renginde kenar alır, ibre ve ayarlı odanın çizgisi de bu renktedir. Zemini sistem rengine dönen Bas konuş ve Gönder düğmeleri kenarla çizilir, odak çerçevesi 4 piksele çıkar, durum noktası, telsiz lambası, okunmamış noktası ve tema önizlemesi kendi renklerini korur (`base.css`, `@media (forced-colors: active)`). `base.css` bileşen ve tema dosyalarından önce yüklendiği için bu kurallar `!important` ile yazılır, böylece sonraki dosyaların aynı ya da daha özgül kuralları onları ezmez. `e2e/04-ayarlar.test.js` sonucu her tema ve modda ölçer.

Aşağıdaki tablo her tema ve modda ana rollerin ve en düşük metin ile bileşen rolünün kontrast oranını gösterir. Oranlar `public/css/tokens.css` içindeki belirteçlerden WCAG 2.x göreli parlaklık formülüyle `scripts/kontrast.js` tarafından hesaplanır, `node scripts/kontrast.js` bu tabloyu yazar (`--en` İngilizcesini). Her rol dokuz yüzeyin hepsinde (zemin, `--surface-1`, `--surface-2`, `--surface-3`, `--surface-alt`, `--surface-sunken`, üzerine gelme, seçili ve yüzen yüzey) ölçülür, yarı saydam zeminler altlarındaki yüzeyle birleştirilir. Metin rolleri ana, ikincil ve soluk metin, vurgu ve ikinci vurgu metni, bağlantı, canlı (kendi saydam zeminlerinde de), tehlike ve uyarı metni (kendi zeminlerinde de), anma metni, dolgu üstü yazılar (vurgu, dolgu düğme degradesinin iki ucu, dikkat rozeti, tehlike dolgusu), avatar baş harfleri ve sekiz özel rol rengidir. Bileşen rolleri girdi ve kart kenarı, odak çerçevesi, dört durum işareti, dolgunun iki ucu, canlı ve tehlike kenarı (kendi saydam zeminlerinde de) ve telsiz kartı düğme tonlarıdır. Eşikler metin için 4.5:1, Yüksek Kontrast temasında 7:1, arayüz bileşeni için 3:1. `test/tema.test.js` her tema ve modda her rolün eşiği geçtiğini denetler. Tablodaki bütün değerler eşiği geçer.

| Tema ve mod | Ana metin | İkincil metin | Soluk metin | Rol renkleri | En düşük metin rolü | En düşük bileşen |
| --- | --- | --- | --- | --- | --- | --- |
| Arcade koyu | 13.00 | 7.89 | 5.57 | 6.20 | 5.20 (Tehlike metni) | 3.01 (Girdi ve kart kenarı) |
| Arcade açık | 15.22 | 8.01 | 5.76 | 5.54 | 4.55 (Canlı) | 3.21 (Tehlike kenarı) |
| Gece Frekansı koyu | 13.16 | 7.34 | 5.49 | 6.46 | 5.49 (Soluk metin) | 3.04 (Girdi ve kart kenarı) |
| Gece Frekansı açık | 12.60 | 6.08 | 4.82 | 4.82 | 4.80 (Vurgu metni) | 3.02 (Girdi ve kart kenarı) |
| Turkuaz ve Bakır koyu | 10.07 | 6.61 | 4.84 | 4.86 | 4.55 (Tehlike metni) | 3.05 (Girdi ve kart kenarı) |
| Turkuaz ve Bakır açık | 11.29 | 6.53 | 4.80 | 4.76 | 4.51 (Uyarı metni) | 3.09 (Girdi ve kart kenarı) |
| Saha Telsizi koyu | 11.48 | 7.73 | 5.85 | 5.63 | 5.63 (Rol renkleri) | 3.16 (Tehlike kenarı) |
| Saha Telsizi açık | 11.81 | 6.76 | 5.42 | 4.60 | 4.60 (Rol renkleri) | 3.31 (Canlı kenarı) |
| Lambalı Radyo koyu | 11.66 | 8.21 | 5.96 | 5.81 | 5.81 (Rol renkleri) | 3.33 (Tehlike kenarı) |
| Lambalı Radyo açık | 12.71 | 7.54 | 6.26 | 4.80 | 4.80 (Rol renkleri) | 3.07 (Canlı kenarı) |
| Fosfor koyu | 11.93 | 8.84 | 6.48 | 6.02 | 6.02 (Rol renkleri) | 3.18 (Tehlike kenarı) |
| Fosfor açık | 10.16 | 7.05 | 5.91 | 4.81 | 4.81 (Rol renkleri) | 3.57 (Canlı kenarı) |
| Kutup İstasyonu koyu | 11.87 | 7.80 | 5.72 | 5.70 | 5.60 (Anma metni) | 3.19 (Tehlike kenarı) |
| Kutup İstasyonu açık | 14.44 | 7.17 | 5.67 | 5.22 | 5.01 (Canlı) | 3.39 (Canlı kenarı) |
| Plak koyu | 12.49 | 8.63 | 6.48 | 6.19 | 5.90 (Avatar baş harfi) | 3.54 (Tehlike kenarı) |
| Plak açık | 14.00 | 8.36 | 6.80 | 5.03 | 4.83 (Canlı) | 3.27 (Canlı kenarı) |
| Kokpit koyu | 13.44 | 8.69 | 6.23 | 6.30 | 6.23 (Soluk metin) | 3.32 (Tehlike kenarı) |
| Kokpit açık | 14.79 | 8.06 | 6.18 | 5.08 | 4.87 (Canlı) | 3.30 (Canlı kenarı) |
| Yüksek Kontrast koyu | 15.13 | 12.81 | 10.20 | 7.94 | 7.45 (Tehlike metni) | 5.99 (Durum: rahatsız etmeyin) |
| Yüksek Kontrast açık | 16.82 | 13.94 | 10.88 | 7.61 | 7.14 (Tehlike metni) | 5.38 (Durum: çevrimiçi) |

## Yeni tema ekleme

1. Temanın adını seçin (küçük harf, ör. `kumsal`) ve `public/theme-init.js` içindeki `SKINS` listesine ekleyin. Ayarlar > Görünüm kartları bu listeden çizilir, başka bir yerde liste tutulmaz.
2. `public/css/tokens.css` dosyasına `:root[data-skin="kumsal"]` bloğunu (yazı tipleri, yarıçaplar, `--layout-pad`, `--column-gap`) ve `:root[data-skin="kumsal"][data-scheme="dark"]` ile `:root[data-skin="kumsal"][data-scheme="light"]` bloklarını ekleyin. "Tasarım belirteçleri" bölümündeki renk adlarının hepsini, `--on-accent-fill` dahil, tanımlayın. Eksik bir belirteç Arcade koyu değerine düşer. Zemini ortak rol renklerine uymayan tema `--role-*` belirteçlerini, gerekirse `--tone-*` belirteçlerini kendi bloğunda ezer. Frekans belirteçlerini ve `--avatar-radius` değerini değiştirmeyin.
3. Temaya özgü biçimler için `public/css/skins/kumsal.css` oluşturun. Her seçici `:root[data-skin="kumsal"]` ile başlamalı, işaretleme değiştirilmez. Konuşma göstergesini `.is-speaking`, durum işaretlerini `data-status` üzerinden çizin, avatar şeklini koruyun. Gönder düğmesinde bir simge görünmesi için `.skin-arcade`, `.skin-gece` veya `.skin-turkuaz` simgelerinden birini kendi temanızda görünür yapın (telefonda etiket gizlenir). `backdrop-filter` yalnızca `@supports` içinde kullanılır, `conic-gradient` kullanılmaz.
4. Dosyayı `index.html` içinde diğer tema dosyalarından sonra bağlayın ve `public/sw.js` önbellek listesine ekleyin. Yeni bir yazı tipi gerekiyorsa woff2 dosyasını ve lisansını `public/fonts/` altına koyun (dosya adı küçük harf, rakam ve tire), `base.css` içine `@font-face` (`font-display: swap`) ekleyin.
5. Ayarlar > Görünüm'deki tema kartı için `public/i18n.js` dosyasına `theme.skin.kumsal` ve `theme.skinHint.kumsal` anahtarlarını Türkçe ve İngilizce ekleyin, `components.css` içinde `.theme-swatch-kumsal` önizleme renklerini tanımlayın.
6. Kontrastı `node scripts/kontrast.js` ile ölçün ve yukarıdaki tabloya yeni satırları ekleyin. Eşiğin altında kalan çift kalmamalıdır. `npm test` içindeki `test/tema.test.js` bunu ve kayıt adımlarını (üç blok, bağlantı ve önbellek sırası, iki dilde metinler, önizleme renkleri, süs dosyasının seçicileri ve yasaklı CSS) denetler.
7. Uygulamayı 1920x1080, 1440x900, 1280x800, 900x800 ve 390x844 boyutlarında koyu ve açık modda açıp bant, ses odası, ekran paylaşımı, Telsiz DJ, emoji seçici, ayarlar ve giriş ekranını gözden geçirin. Yatay taşma, okunmayan metin ve görünmeyen odak çerçevesi olmamalıdır.

## Eski tarayıcı uyumu

Stil dosyaları oyun konsollarının eski WebKit tabanlı tarayıcılarında da çalışacak biçimde yazılır. Düzen yalnızca flexbox ve margin ile kurulur. `grid`, flex `gap`, `clamp()`, `:is()`, `:where()`, `aspect-ratio` ve `inset` kullanılmaz. Animasyon ve dönüşümler `-webkit-` önekleriyle de yazılır. `backdrop-filter` yalnızca `@supports` içinde ve `-webkit-backdrop-filter` ile birlikte kullanılır, desteklenmezse paneller opak `--surface-1` rengine düşer. Bandın ölçek çizgileri `background-attachment: local` ile kayar, bunu desteklemeyen tarayıcıda yalnızca süs kaybolur. `prefers-contrast` ve `forced-colors` medya sorgularını tanımayan tarayıcılar ilk açılışta Yüksek Kontrast'ı kendiliğinden seçmez ve zorlanmış renk kurallarını yok sayar, tema Ayarlar'dan yine seçilebilir. Satır içi stil ve betik yoktur (içerik güvenliği politikası bunları engeller), simgeler `index.html` içindeki SVG kümesinden `<use>` ile (hem `href` hem `xlink:href`) alınır.
