# Telsiz tasarım sistemi

[Türkçe](TASARIM.md) | [English](DESIGN.md)

Telsiz'in arayüzü tek bir HTML yapısı, Frekans adlı bir düzen ve üç görsel tema üzerine kuruludur. Düzen uygulamayı bir radyo kadranı gibi kurar: katıldığınız frekanslar (her biri bir Telsiz sunucusu) yatay bir frekans bandında istasyon olarak dizilir, açık frekansın yazı ve ses odaları sağdaki İstasyonlar listesindedir, ortada tek bir konuşma sütunu durur, ses odasına bağlanınca bir el telsizini andıran telsiz kartı açılır. Temalar yalnızca CSS belirteçlerini ve temaya özgü süsleri değiştirir, işaretleme hiçbir temada değişmez. Varsayılan tema Arcade'dir, ilk açılışta mod sistem tercihini izler (bilinmiyorsa koyu). Bu belge dosyaları, düzeni, kesme noktalarını, belirteçleri, temaları, bileşenleri, kontrast ölçümlerini ve yeni bir tema eklemenin adımlarını anlatır.

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
| `public/css/people.css` | Giriş kartı, Yayındakiler sayfası ve şeridi, özel mesaj listesi ve kişisel kartlar, özel mesaj başlığı, Arkadaşlar istasyonu. |
| `public/css/cast.css` | Ekran paylaşımı: yayında çipi, paylaşım bildirimi, yayın sahnesi, kameralar ızgarası, daraltılmış sohbet şeridi, paylaşım başlatma penceresi. |
| `public/css/dj.css` | Telsiz DJ kartı, köşedeki oynatıcı, kadrodaki Telsiz DJ öğesi, mesajdaki "DJ'de çal" düğmesi. |
| `public/css/skins/arcade.css`, `gece.css`, `turkuaz.css` | Temaya özgü biçimler. |
| `public/fonts/` | Yerel woff2 yazı tipleri ve OFL lisans metinleri. |

`index.html` stil dosyalarını şu sırayla bağlar: tokens, base, frekans, components, settings, chat-plus, convo, radio, people, cast, dj, ardından üç tema dosyası. Tema dosyalarındaki her kural `:root[data-skin="..."]` ile başladığı için yalnızca etkin temanın kuralları uygulanır. Üç dosyanın birlikte yüklenmesi tema değişimini sayfa yenilemeden anında yapar.

## Tema arayüzü

`theme-init.js` şu arayüzü sunar. Ayarlar > Görünüm sayfası ve uygulama yalnızca bu arayüzü kullanır.

| Üye | Açıklama |
| --- | --- |
| `TelsizTheme.get()` | Geçerli tercihleri döner: tema (`skin`), seçilen mod (`scheme`: `dark`, `light`, `system`), uygulanan mod (`resolvedScheme`), yazı boyutu, kompakt görünüm ve hareketi azaltma. |
| `TelsizTheme.set(partial)` | Verilen alanları doğrular, cihazda saklar, kök özniteliklerini günceller ve dinleyicileri çağırır. |
| `TelsizTheme.skins` | `['arcade', 'gece', 'turkuaz']` |
| `TelsizTheme.onChange(fn)` | Değişiklik dinleyicisi ekler, kaldırmak için bir fonksiyon döner. "Sistem" seçiliyse sistem modu değişince de çağrılır. |

Kök öğe (`<html>`) öznitelikleri: `data-skin` (`arcade`, `gece`, `turkuaz`), `data-scheme` (`dark`, `light`), `data-font-size` (`auto`, `small`, `normal`, `large`, `tv`), `data-compact` ve `data-reduce-motion` (`true`, `false`). Cihazdaki anahtarlar `telsiz.skin`, `telsiz.scheme`, `telsiz.fontSize`, `telsiz.compact` ve `telsiz.reduceMotion` adlarını taşır. Depolama kapalıysa seçim yalnızca o oturumda geçerlidir.

`12-init.js` tema her değiştiğinde `theme-color` meta etiketini etkin temanın `--theme-color` belirtecine, `color-scheme` meta etiketini uygulanan moda göre günceller. Varsayılan yazı boyutu `normal` (16 piksel). Yazı boyutu `auto` seçiliyken kök yazı boyutu 16 piksel, 1280 piksel ve üstü genişlikte 18 piksel, 1800 piksel ve üstünde 22 pikseldir. `small` 14, `normal` 16, `large` 18, `tv` 22 pikseldir. Bütün ölçüler `rem` ile verildiği için arayüz yazı boyutuyla birlikte büyür.

## Frekans düzeni

Uygulama ekranı (`#app-view`) yukarıdan aşağı şu bölgelerden oluşur:

1. **Üst çubuk (`#top`).** Sol üstte frekans değiştirici (`#frekans-button`: amblem (frekans fotoğrafı, yoksa baş harf), frekans adı ve aşağı ok, alt satırda "Frekans · üye sayısı" ve şifreli notu). Basınca kayıtlı frekansların menüsü (`#frekans-menu`, `24-frekans.js`) açılır: açık frekans başta ve işaretli, diğerine geçme, Frekans ekle, Listeden çıkar. Ortada Özel mesajlar ve Arkadaşlar düğmeleri (`#top-personal`, okunmamış özel mesaj ve bekleyen istek rozetleriyle). Sağda Ara çipi, Yayındakiler şeridi (çevrimiçi kişilerin küçük avatarları, basınca kişi listesi) ve avatar çipi (`#me-button`, basınca avatar menüsü: durum, özel durum, profil, ayarlar, görünüm, dil, çıkış). Ekran paylaşırken her istasyonda görünen "Ekranınız yayında" çipi (`#top-cast`) de buradadır. Bağlantı koptuğunda üst çubuğun altında bir şerit (`#conn-banner`) çıkar.
2. **Frekans bandı (`#band`, `#band-track`).** Katıldığınız frekanslar tek satırda, "Frekanslar" etiketi grubun başında (`24-frekans.js` üretir, `04-meta.js renderBand` çizer). Her istasyon bir frekanstır: frekans fotoğrafı veya adının baş harfiyle amblem ve köşesinde durum noktası (açık frekans ibre renginde, çevrimiçi yeşil, çevrimdışı kırmızı, giriş gerekli sarı, bilinmiyor boş halka), ad (bilinmiyorsa adres), alt satırda durum, çevrimiçi kişi sayısı veya adres, satır içinde okunmamış rozeti ve köşede anma rozeti (`@sayı`). Okunmamış sayısı odaların ve özel mesajların, anma sayısı sizi anan mesajlar ile özel mesajların toplamıdır. Bant tek satırlıktır (`--band-h` 4rem): üstte ölçek şeridi ve ibrenin topuzu, altında 44 piksellik istasyonlar. Ölçek çizgileri içerikle birlikte kayar, açık frekansı istasyonun üstündeki ibre gösterir. Başka bir istasyona basmak, ibreyi sürükleyip başka bir istasyona bırakmak, uç düğmeleri ve oyun kolunun L1 ve R1 düğmeleri o frekansa geçer, ses odasındayken önce onay istenir. Bandın uçlarında önceki ve sonraki frekans düğmeleri, Frekans ekle düğmesi (+), frekans değiştirme rehberini küçük bir açılır pencerede gösteren ? düğmesi (`#band-help`, `#hints-card`) ve Frekanslar sayfasını açan Tümü düğmesi bulunur. Bant klavyede tek bir sekme durağıdır (ok tuşları odağı gezdirir, Home, End, Enter geçer), tekerlek bandı yalnızca yatay kaydırır ve hiçbir zaman frekans değiştirmez. Masaüstü uygulamasında açık olmayan frekansların durumu ve okunmamış sayıları da görünür (arka plan sayımı, [desktop/README.md](../desktop/README.md)). Tarayıcıda her frekans ayrı bir köken olduğu için yalnızca açık frekansın durumu ve sayıları gösterilir, diğer istasyonların ipucu ve erişilebilir adı bunu söyler. Tarayıcıda bant sırası adres parçasıyla taşınır, böylece her frekansta aynıdır.
3. **Sahne (`#stage`).** Geniş ekranda soldan sağa: dar ve sabit sol sütun (`#info-col`, `--side-left-w`: Özel görünümünde konuşma listesi ve kişisel kartlar, sütunun altında telsiz kartı `#radio` ve hemen altında ayarlı istasyonun kartı), kalan alanı alan konuşma sütunu (`#main`: başlık, mesajlar, yazıyor satırı, yazma alanı) ve dar ve sabit sağ sütun (`#side-right`, `--side-right-w`: yazı ve ses odalarının listesi İstasyonlar `#inbox`, okunmamış ve anma rozetleri, ses odasında kişi sayısı, konuşan göstergesi ve Telsiz DJ notası, başlıkta oda yönetme izni olanlar (sahip, yönetici ve izinli roller) için Oda ekle düğmesi `#inbox-add`). Yazı odasına basmak onu ayarlar, ses odasına basmak o odaya katılır. Sağ sütun görünmediğinde (999 pikselin altı, alçak ekranda 1280 pikselin altı veya ekran paylaşımı yayındayken) üst çubuktaki İstasyonlar düğmesi (`#btn-rooms`, toplam okunmamış rozetiyle) aynı listeyi İstasyonlar sayfasında açar. Telsiz DJ çalarken DJ kartı (`#dj`) sağ sütunun üstüne yerleşir ve İstasyonlar listesi altında görünür kalır (liste en az 12rem, kart sığmazsa kendi içinde kayar), ekran paylaşımı yayındayken sağ sütun gizlenir. 1280 pikselin altında telsiz kartı sağ sütuna taşınır (`12-init.js placeRadio`).
4. **Yayın sahnesi (`#cast`).** Ekran paylaşımı izlenirken, kişi kendi paylaşımının önizlemesine bakarken veya kameralar ızgarası açıkken sol ve orta bölge birleşir, sohbet altta daraltılmış bir şeride iner.
5. **Sayfalar.** Frekanslar (`#frekans-sheet`, bandın Tümü düğmesi: frekanslar durum ve sayılarıyla, listeden çıkarma ve Frekans ekle), İstasyonlar (`#stations-sheet`, yazı ve ses odaları, başlıkta Oda ekle), Yayındakiler (`#people-sheet`) ve 1280 pikselin altında Oda bilgisi geniş ekranda sağdan açılan yan sayfa, telefonda alttan açılan sayfadır. Sayfadaki satırlar arasında yukarı ve aşağı ok, Home ve End gezer. Aynı anda tek sayfa açıktır, ortak örtü `#drawer-backdrop`'tur.
6. **Televizyon ipucu çubuğu (`#tvbar`).** 1800 piksel ve üstünde, oyun kolu algılandığında altta görünür.

Telsiz kartının durumu `#radio[data-state]` özniteliğindedir: `off` (ses odasında değil, ekranda ses odaları ve Katıl düğmeleri), `joining` (bağlanıyor), `on` (bağlı: oda adı, kadro, konuşma satırı, kamera açıkken kamera göstergesi, Bas konuş veya ses etkinliği seviye çubuğu, Mikrofon, Sağırlaştır, Ekran, Kamera ve Ayrıl düğmeleri). Görünüm modu `#app-view[data-view]` özniteliğindedir (`channel`, `home`, `dm`).

Düzen işaretleme sırasıyla kurulur, `dir` veya `flex-direction: row-reverse` kullanılmaz. Klavye ve ekran okuyucu sırası görsel sırayı izler: üst çubuk, bant, sol sütun, konuşma, sağ sütun.

## Kesme noktaları

`12-init.js` pencere genişliğine göre `#app-view[data-layout]` özniteliğini yazar (`tv`, `wide`, `wide-narrow`, `medium`, `narrow`) ve düzen sınıfı değişince açık sayfaları kapatır. CSS aynı sınırları medya sorgularıyla uygular.

| Ad | Koşul | Değişen |
| --- | --- | --- |
| Televizyon | `min-width: 1800px` | Kök yazı 22 piksel (otomatik yazı boyutunda), büyük odak halkası, oyun kolu varsa ipucu çubuğu, telsiz kartının başlık satırı gizli |
| Geniş | `min-width: 1280px` | Üç bölgeli sahne: solda telsiz kartı ve oda bilgisi, ortada genişleyen konuşma, sağda İstasyonlar veya DJ kartı |
| Geniş dar | 1000 ile 1279 piksel | Sol sütun gizli, telsiz kartı sağ sütunda, üst çubuktaki kişisel düğmeler simge, oda bilgisi başlıktaki düğmeyle yan sayfada, DJ kartı kadrodaki Telsiz DJ öğesinden açılan sayfada |
| Orta | `max-width: 999px` | Telsiz kartı 17rem, düğmeler iki satırda, İstasyonlar kartı gizli, üst çubukta İstasyonlar düğmesi (yan sayfa) |
| Dar (telefon) | `max-width: 759px` | Bant kenardan kenara ve parmakla kayar, Tümü düğmesi, frekans düğmesinde yalnızca amblem (ad bantta), konuşma tam genişlik, telsiz kartı ekranın altına yapışır, katmanlar (İstasyonlar dahil) alttan açılır |
| Alçak | `max-height: 860px` ve 1280 pikselin altı | İstasyonlar kartı gizli, üst çubukta İstasyonlar düğmesi |

## Tasarım belirteçleri

Bileşenler renk değeri yazmaz, yalnızca anlamsal belirteçleri kullanır. Her tema ve mod renk belirteçlerinin hepsini tanımlar. Frekans düzeninin belirteçleri yalnızca tema belirteçlerine başvurur, bu yüzden üç temada ve iki modda kendiliğinden doğru renk alır.

Ölçekler ve düzen (tema bağımsız):

| Belirteç | Değer | Kullanım |
| --- | --- | --- |
| `--space-1` ile `--space-8` | 0.25rem ile 2rem | Aralık ölçeği |
| `--target` | 2.75rem (16 piksel kökte 44 piksel) | En küçük dokunma ve imleç hedefi |
| `--text-xs` ile `--text-2xl` | 0.75rem ile 1.75rem | Yazı ölçeği |
| `--dur-fast`, `--dur-med`, `--dur-slow`, `--ease` | 0.14s, 0.24s, 1.8s, `cubic-bezier(0.2, 0.7, 0.2, 1)` | Hareket |
| `--top-h` | 3.75rem (dar 3.5rem) | Üst çubuk yüksekliği |
| `--band-h`, `--band-pad`, `--dial-top` | 4rem, 0.25rem, 0.125rem | Frekans bandı yüksekliği, alt boşluğu, ölçek çizgisinin üstten uzaklığı |
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
| `--live`, `--live-bg`, `--speaking-bg`, `--halo-1`, `--halo-2` | Bağlı ses, konuşan kişi ve konuşma halesi |
| `--danger`, `--danger-bg`, `--danger-fill`, `--on-danger` | Tehlike metni, zemini ve dolgusu |
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

Bütün avatarlar üç temada da yumuşak kenarlı karedir, daire değildir: mesaj akışı, telsiz kartının kadrosu, Yayındakiler şeridi ve sayfası, profil kartı, avatar menüsü, arkadaşlar, özel mesajlar, öneri listeleri ve arama sonuçları. Köşe yarıçapı `--avatar-radius: 28%` ile verilir. Değer yüzde olduğu için küçük yığın avatarında da büyük profil avatarında da oran aynıdır.

Durum noktası ve köşe işaretleri (susturulmuş, sağırlaştırılmış, ekran paylaşıyor) aynı aileden yumuşak karedir (`--dot-radius: 32%`), avatarın sağ alt köşesine oturur ve zemin renginde bir kenarla ayrılır. Konuşma halesi `box-shadow` ile çizildiği için kare çerçevenin dışını izler. Telsiz DJ gerçek bir kullanıcı değildir: avatarı kesik çizgili kenarlı bir nota simgesidir ve "bot" etiketi taşır. Kamera kutusu avatarın kendisidir ve aynı yumuşak kare biçimi korur, kadrodaki Büyüt öğesi Telsiz DJ gibi kesik çizgili kenarlı bir simgedir. Daire olarak kalanlar avatar değildir: ibre topuzu, nabız noktası, LED, Bas konuş kubbesi ve radyo seçim noktası.

## Kamera

Kamera telsiz kartında başlar ve aynı Frekans biçim dilini kullanır. Düğme sırasındaki Kamera düğmesi (`#btn-camera`) Ekran ile Ayrıl arasındadır, varsayılan olarak kapalıdır, açıkken Ekran düğmesinin yayında görünümünü (`.is-live`, `--live`) alır, cihaz desteklemiyorsa veya sahip kameraları kapattıysa kesik kenarlı ve devre dışıdır ve nedeni altında yazar (`#radio-camera-note`). Kameranız açıkken Bas konuş veya ses etkinliği satırının üstünde kayıt lambalı bir gösterge (`#radio-cam-live`, `--danger` ve `--danger-bg`, "Kameranız açık, odadaki herkes görüyor") her düzende, telefonda da görünür.

Kamerası açık kişinin kadro öğesi aynı yumuşak kare avatar biçiminde (`--avatar-radius`) daha büyük bir canlı görüntü kutusuna döner (`.crew-avatar.has-camera`, geniş ekranda 4.25rem, orta ekranda 3.75rem, telefonda 2.75rem). Görüntü (`.cam-video`, `object-fit: cover`) ilk kare gelene kadar saydamdır, altındaki avatar görünür. Kendi görüntünüz aynalıdır (`.is-mirrored`). Köşe işaretleri ve konuşma halesi görüntünün üstünde kalır. Odada kamera varsa kadronun sonunda, Telsiz DJ öğesinden önce kesik çizgili kenarlı bir ızgara simgesi olan Büyüt öğesi (`.crew-cams`, `#radio-cams`) durur. Telsiz DJ gibi gerçek bir kişi değildir, basınca kameralar yayın sahnesinde ızgara olarak açılır (`#cast[data-mode="cams"]`, `.cast-cams`, `.cam-tile`). Izgara kamera sayısına göre 1, 2x1, 2x2, 3x2, 3x3 veya 4x3 eşit kutuya bölünür, kutular kart köşelidir, ad etiketi görüntünün üstünde koyu zeminde durur ve konuşan kişinin kutusunda canlı renkli çerçeve belirir. İzlenen bir ekran paylaşımı ızgaranın önüne geçer, son kamera kapanınca ızgara kendiliğinden kapanır.

Ayarlar > Genel sayfasında iki bölüm vardır. Ses odaları ve kameralar bölümü (`#set-voice-limits-section`) sayı alanlarıyla (`.settings-number`) ses odası kapasitesini ve kamera sınırını, bir anahtarla kameraları gösterir. Yönetici alanları devre dışı görür. Sunucu bilgileri bölümü (`#set-server-info-section`) etiket ve değer satırlarını (`.settings-facts`, `.settings-fact`), altında öneriyi (`.settings-rec`: yükleme hızı alanı, sonuç satırları `.settings-rec-item`, formül açıklaması, ipuçları `.settings-rec-hint` ve Öneriyi uygula düğmesi) gösterir. Uyarılar `--warn`, `--warn-bg` ve `--warn-line` belirteçleriyle, olumlu ipucu `--live` kenarıyla çizilir. Telefonda etiket değerin üstüne iner.

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
| Üst çubuk | `.top-bar`, `.top-brand-button`, `.top-personal`, `.top-personal-button`, `.top-chip`, `.top-me`, `.top-stack` | Frekans değiştirici, kişisel düğmeler, Ara, Yayındakiler ve avatar çipleri. |
| Frekans menüsü | `.frekans-menu`, `.frekans-row`, `.frekans-item`, `.frekans-emblem`, `.frekans-remove`, `.frekans-add` | Açık frekans `.is-active` ve `aria-checked="true"`. |
| Frekans fotoğrafı | `.frekans-photo`, `.emblem-letter`, `.has-photo`, `.auth-photo`, `.tanitim-photo`, `.settings-photo-emblem` | Fotoğraf amblemin içinde baş harfin üstünü örter ve amblemin köşe biçimini alır (`border-radius: inherit`, `object-fit: cover`), temaların amblem süsleri fotoğrafın üstüne çizilmez. Fotoğraf yoksa veya yüklenemezse öğe kaldırılır, `.has-photo` düşer ve baş harf görünür. Giriş ekranında ve tanıtım sayfasında fotoğraf adın solundadır, yoksa ekran eski görünümündedir. |
| Frekans bandı | `.band-track`, `.band-step`, `.band-all`, `.station`, `.station-frekans`, `.station-emblem`, `.frekans-dot`, `.station-meta`, `.needle`, `.frekans-sheet-row` | İstasyon durumları: `.is-tuned`, `.is-target`, `.is-unread`, `.is-mentioned` ve frekans durumu `.is-open`, `.is-online`, `.is-offline`, `.is-login`, `.is-unknown`. İbre: `.is-dragging`. |
| Sol sütun ve İstasyonlar | `.side-left`, `.info-bottom`, `.radio-slot`, `.facts`, `.hints`, `.hints-pop`, `.dm-section`, `.inbox`, `.inbox-head`, `.rooms-list`, `.room-row`, `.top-rooms` | Satır durumları: `.is-current`, `.is-unread`, ses için `.is-connected`, `.is-joining`, `.is-live`. |
| Konuşma sütunu | `.convo`, `.convo-head`, `.convo-title`, `.msg`, `.msg-skeleton`, `.channel-start`, `.typing-line`, `.mention-popover`, `.search-panel` | Beni anan mesaj `--mention-bg` zemin ve sol çizgiyle. |
| Telsiz kartı | `.radio`, `.radio-screen`, `.crew-item`, `.crew-badge`, `.crew-avatar.has-camera`, `.cam-video`, `.crew-cams`, `.radio-talk`, `.radio-ptt`, `.radio-vad`, `.radio-cam-live`, `.radio-button` | Kadro öğesinde `.is-speaking` ve `.has-camera`, düğmelerde `aria-pressed`, kendi görüntüde `.is-mirrored`. |
| Avatar menüsü | `.avatar-menu` | Durum seçenekleri `menuitemradio`. |
| Kişiler | `.member`, `.home-view`, `.home-tab`, `.dm-header`, `.people-card` | Yayındakiler sayfası, Arkadaşlar istasyonu, özel mesaj başlığı. |
| Giriş kartı | `.auth-card`, `.auth-dial`, `.auth-needle` | Telsiz gövdesi biçiminde kart. |
| Ekran paylaşımı ve kameralar ızgarası | `.cast-panel`, `.cast-head`, `.cast-chip`, `.cast-video`, `.cast-cams`, `.cam-tile`, `.cast-dock-toggle`, `.top-cast-chip`, `.cast-preset` | Sahne açıkken `body[data-cast="live"]`, ızgarada `#cast[data-mode="cams"]`. |
| Telsiz DJ | `.dj-card`, `.dj-yt`, `.dj-dock`, `.dj-wave`, `.dj-ctrl`, `.dj-vol`, `.crew-dj` | YouTube oynatıcı alanı (`.dj-yt`) yazı boyutundan bağımsız olarak her zaman en az 200x200 CSS pikselidir ve üstüne hiçbir şey bindirilmez. Kart görünmezken veya örtülürken oynatıcı köşeye sabitlenir, altında `.dj-dock` çubuğu durur. |
| Ayarlar | `.settings-view`, `.settings-cat`, `.settings-section`, `.settings-theme-card`, `.settings-switch`, `.settings-number`, `.settings-facts`, `.settings-rec` | Seçili kategori ibre renginde sol çizgiyle işaretlenir. |
| Katmanlar | `.popup-menu`, `.popover`, `.modal`, `.sheet`, `.toast`, `.conn-banner` | Dar ekranda katmanlar alttan açılır. |

## Durum sınıfları ve JavaScript sözleşmesi

Bütün modüller aynı durum adlarını kullanır: `.is-speaking`, `.is-unread`, `.is-mentioned`, `.is-active`, `.is-blocked`, `.is-own` ve `data-status`. Seçili öğe için ayrıca `aria-current`, `aria-selected`, `aria-pressed` ve `aria-checked` biçimlendirilir. Bölge durumları öznitelikle taşınır: `#app-view[data-layout]`, `#app-view[data-view]`, `#radio[data-state]`, `body[data-cast]` ve `body[data-cast-chat]`. Oyun kolu algılanınca `#app-view` öğesine `.has-gamepad` sınıfı eklenir.

`02-state-dom.js` içindeki `avatar(userId, size)` avatarı çizer (`size`: `xs`, `sm`, `md`, `lg`, `xl`), `fillAvatar(node, userId, size)` var olan bir avatar öğesini yeniden çizer. Görünen ad, `@kullanıcı adı`, durum ve avatar bilgisi `13-profile.js` yardımcılarından gelir. Avatar resmi yalnızca `blob:` adresiyse gösterilir. Bandı `04-meta.js` çizer (istasyonları `24-frekans.js` üretir), etkileşimini `21-band.js` bağlar. Değişmeyen listeler yeniden çizilmez, böylece klavye odağı korunur. Katmanlar `02-state-dom.js` içindeki katman yığınını kullanır: açılınca odak ilk anlamlı öğeye gider, Esc ve dışarı tıklama kapatır, odak açan düğmeye döner. Yığın değişince `watchLayers(fn)` ile kaydolan işlevler çağrılır.

**Köşedeki oynatıcı.** YouTube'un gömülü oynatıcı kuralları oynatıcının en az 200x200 piksel ve görünür olmasını, üstüne hiçbir şey konmamasını ve oynatıcı gizlenip sesin arka planda çalınmamasını ister. Motor bu yüzden görünmeyen YouTube oynatıcısını bu cihazda duraklatır (`music.js syncPlayer`, ölçüm `dj/youtube.js visible`). Ayarlar açılınca, DJ sayfası dışında kartı örten bir katman açılınca (başka bir sayfa, pencere, görüntüleyici, kartın üstüne gelen menü) veya sayfa kipinde DJ sayfası kapalıyken (1280 pikselin altı, ekran paylaşımı yayında) müzik bu yüzden susmaz: `23-dj.js` `#dj` öğesine `.is-docked` koyar, oynatıcı alanı sağ alt köşeye sabitlenir ve altında parça adı, duraklat veya devam (gerekiyorsa dokunarak başlat) ve DJ kartını açan düğmelerin olduğu `.dj-dock` çubuğu durur. Kutu her katmanın, Ayarlar'ın ve kısa bildirimlerin üstündedir, çerçeve en az 200x200 kalır, çubuk çerçevenin dışındadır. Telefonda kutu yazma alanının üstünde durur, bir katman açıkken ekranın altına iner, güvenli alanlara uyar. Çerçeve ve ataları DOM'da hiç taşınmaz (taşınan çerçeve yeniden yüklenir), yalnızca sınıflar değişir: kart `visibility: hidden` ile gizlenir (kapalı sayfada `.is-dock-only` ile yer kaplamaz, sütunda yerini korur), oynatıcı ve çubuk görünür kalır, köşedeyken atalarda `overflow` görünür olur, `transform`, `filter`, `backdrop-filter`, `contain` ve `will-change` bulunmaz, gövdedeki `has-dj-dock` sınıfıyla `#app-view` kendi yığın bağlamını kaldırır, kısa bildirimler kutunun üstüne çıkar. Karar ölçülen görünürlüğe değil katman yığınına, sayfa kipine ve pencere boyutuna bağlıdır, böylece köşeye alma titremez. Dosya parçalarının görünürlük koşulu yoktur, müzik yalnızca ses odasından ayrılınca, DJ kapatılınca veya kuyruk bitince durur.

## Erişilebilirlik ve kontrast

Odak çerçevesi tasarımın parçasıdır: 3 piksel `--focus` çizgisi ve çevresinde yarı saydam bir hare, televizyon genişliğinde daha kalın. `:focus-visible` desteklemeyen eski tarayıcılarda aynı çerçeve `:focus` ile gelir. Bütün düğmeler ve alanlar en az 2.75rem (16 piksel kökte 44 piksel) yüksekliktedir. Durumlar yalnızca renkle değil biçimle ve metinle de ayrılır, istasyonların ve kadro öğelerinin erişilebilir adları okunmamış sayısını, bağlantı ve konuşma durumunu içerir. Hareketi azalt seçeneği geçişleri ve döngüleri durdurur ve sistemin `prefers-reduced-motion` ayarını izleyebilir.

Aşağıdaki tablo her rol için o tema ve moddaki en düşük kontrast oranını gösterir. Oranlar `public/css/tokens.css` içindeki belirteçlerden WCAG 2.x göreli parlaklık formülüyle hesaplandı (metin 4.5:1, arayüz bileşeni 3:1). Yarı saydam yüzeyler altlarındaki zeminle birleştirilerek ölçüldü, Arcade'in cam paneli hem düz zemin hem de en parlak ışık noktası üzerinde ölçüldü. Dolgu düğme yazısı (`--on-accent-fill`) degradenin iki ucu (`--accent-fill-a` ve `--accent-fill-b`) üzerinde ölçüldü. Tablodaki bütün değerler eşiği geçer.

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
