# Telsiz tasarım sistemi

[Türkçe](TASARIM.md) | [English](DESIGN.md)

Telsiz'in arayüzü tek bir HTML yapısı ve üç görsel tema üzerine kuruludur. Temalar yalnızca CSS belirteçlerini ve temaya özgü süsleri değiştirir, işaretleme hiçbir temada değişmez. Varsayılan tema Arcade'dir, ilk açılışta mod sistem tercihini izler (sistem tercihi bilinmiyorsa koyu). Bu belge belirteçleri, temaları, düzeni, bileşenleri, hesaplanmış kontrast oranlarını ve yeni bir tema eklemenin adımlarını anlatır.

## Dosyalar ve yükleme sırası

| Dosya | Görev |
| --- | --- |
| `public/theme-init.js` | `<head>` içinde `defer` olmadan, stil dosyalarından önce yüklenir. Cihazdaki tercihi okuyup kök öğenin özniteliklerini yazar, böylece sayfa ilk çizimde doğru temayla açılır. `window.TelsizTheme` arayüzünü tanımlar. |
| `public/css/tokens.css` | Tema bağımsız ölçekler (aralık, yazı, hedef boyutu, sütun genişlikleri, hareket) ve her tema ile mod için renk, yazı tipi ve biçim belirteçleri. Yazı boyutu kuralları da buradadır. |
| `public/css/base.css` | Yerel yazı tipleri (`@font-face`, `font-display: swap`), sıfırlama, gövde ve zemin ışığı, odak çerçevesi, kaydırma çubukları, simgeler, hareketi azalt kuralı. |
| `public/css/layout.css` | Uygulama düzeni: üye listesi, orta alan, kanallar sütunu, çekmeceler ve kırılma noktaları, kimlik ekranlarının iskeleti. |
| `public/css/components.css` | Tüm bileşenler: düğme, giriş, seçim, anahtar, kaydırıcı, kart, etiket, rozet, avatar ve durum işareti, menü, açılır panel, kalıcı pencere, alttan açılan panel, sekmeler, liste, boş durum, bildirim, tuş kapağı, yükleniyor, mesajlar, yazma alanı, emoji seçici, profil kartı, ana sayfa ve özel mesaj öğeleri. |
| `public/css/skins/arcade.css` | Arcade'e özgü biçimler: cam paneller, tuş kapağı dudakları, degrade kenarlar, konuşan hale, kabin düğmesi. |
| `public/css/skins/gece.css` | Gece Frekansı'na özgü biçimler: kadran ve ibre, frekans rozetleri, LED durum ışıkları, ekolayzır, kayıt defteri akışı. |
| `public/css/skins/turkuaz.css` | Turkuaz ve Bakır'a özgü biçimler: sekizgen avatarlar, elmas durumlar, yıldız hale, kuşak frizleri, kemer kartlar. |
| `public/fonts/` | Yerel woff2 yazı tipleri ve OFL lisans metinleri. |

`index.html` stil dosyalarını bu sırayla bağlar: tokens, base, layout, components, ardından üç tema dosyası. Tema dosyalarındaki her kural `:root[data-skin="..."]` ile başladığı için yalnızca etkin temanın kuralları uygulanır, üç dosyanın birlikte yüklenmesi tema değişimini sayfa yenilemeden anında yapar.

## Tema arayüzü

`theme-init.js` şu arayüzü sunar. Ayarlar > Görünüm sayfası ve uygulama yalnızca bu arayüzü kullanır.

| Üye | Açıklama |
| --- | --- |
| `TelsizTheme.get()` | `{ skin, scheme, resolvedScheme, fontSize, compact, reduceMotion, motionReduced }` döner. `scheme` kullanıcının seçimi (`dark`, `light`, `system`), `resolvedScheme` uygulanan mod (`dark` veya `light`), `motionReduced` hareketin şu an azaltılıp azaltılmadığıdır. |
| `TelsizTheme.set(partial)` | Verilen alanları doğrular, cihazda saklar, kök özniteliklerini günceller ve dinleyicileri çağırır. `reduceMotion` için `system`, `on`, `off` (veya `true`, `false`) kabul edilir. |
| `TelsizTheme.skins` | `['arcade', 'gece', 'turkuaz']` |
| `TelsizTheme.onChange(fn)` | Değişiklik dinleyicisi ekler, kaldırmak için bir fonksiyon döner. Sistem modu veya sistem hareket tercihi değişince de çağrılır (yalnızca "Sistem" seçiliyse). |

Kök öğe (`<html>`) öznitelikleri: `data-skin` (`arcade`, `gece`, `turkuaz`), `data-scheme` (`dark`, `light`), `data-font-size` (`auto`, `small`, `normal`, `large`, `tv`), `data-compact` (`true`, `false`), `data-reduce-motion` (`true`, `false`). `data-theme` adı kullanılmaz, çünkü gömülü önizleme çerçeveleri kök öğeye kendi `data-theme` özniteliğini yazar.

Cihazdaki anahtarlar: `telsiz.skin`, `telsiz.scheme`, `telsiz.fontSize`, `telsiz.compact`, `telsiz.reduceMotion`. Depolama kapalıysa (gizli pencere) seçim yalnızca o oturumda geçerlidir.

`12-init.js` tema her değiştiğinde `theme-color` meta etiketini etkin temanın `--theme-color` belirtecine, `color-scheme` meta etiketini uygulanan moda göre günceller. Giriş ekranındaki güneş ve ay düğmesi (`#auth-scheme`) koyu ile açık mod arasında geçiş yapar. Manifest `theme_color` ve `background_color` değerleri sunucuda Arcade koyu zemin rengidir (`#0f1015`).

Yazı boyutu: `auto` seçiliyken kök yazı boyutu 16 piksel, 1280 piksel ve üstü genişlikte 18 piksel, 1800 piksel ve üstünde (TV ve oyun konsolu) 22 pikseldir. `small` 14, `normal` 16, `large` 18, `tv` 22 pikseldir. Tüm ölçüler `rem` ile verildiği için arayüz yazı boyutuyla birlikte büyür. Kompakt görünümde mesajlarda avatar gizlenir, saat solda ve ad ile metin aynı satırdadır.

## Tasarım belirteçleri

Bileşenler renk değeri yazmaz, yalnızca aşağıdaki anlamsal belirteçleri kullanır. Her tema ve mod bu adların hepsini tanımlar.

Ölçekler (tema bağımsız):

| Belirteç | Değer | Kullanım |
| --- | --- | --- |
| `--space-1` ile `--space-8` | 0.25rem ile 2rem | Aralık ölçeği |
| `--target` | 2.75rem (16 piksel kökte 44 piksel) | En küçük dokunma ve imleç hedefi |
| `--text-xs` ile `--text-2xl` | 0.75rem ile 1.75rem | Yazı ölçeği |
| `--members-width`, `--sidebar-width`, `--drawer-width` | 16rem, 17rem, 20rem | Sütun ve çekmece genişlikleri |
| `--dur-fast`, `--dur-med`, `--dur-slow`, `--ease` | 0.14s, 0.24s, 1.8s, `cubic-bezier(0.2, 0.7, 0.2, 1)` | Hareket |

Yüzeyler ve çizgiler:

| Belirteç | Anlam |
| --- | --- |
| `--bg`, `--bg-glow-a`, `--bg-glow-b` | Sayfa zemini ve arkasındaki iki yumuşak ışık |
| `--surface-1` | Yan sütunlar (üyeler, kanallar) |
| `--surface-1-glass` | Arcade'in cam paneli (yalnızca `backdrop-filter` destekleniyorsa) |
| `--surface-2` | Orta alan, mesaj akışı |
| `--surface-3` | Yükseltilmiş yüzey: etkin satır, tuş kapağı, ikincil düğme |
| `--surface-alt` | Kartlar, dosya kartı, ses lobisi, mesaj üzerine gelme |
| `--surface-sunken` | Girdi, yazma alanı, ölçer yuvası |
| `--surface-hover`, `--surface-active` | Üzerine gelme ve seçili satır |
| `--surface-float` | Menü, açılır panel, profil kartı, iletişim kutusu |
| `--overlay`, `--viewer-bg` | Çekmece ve pencere perdesi, resim görüntüleyici zemini |
| `--line`, `--line-strong` | Süs ayırıcı ve kart kenarı |
| `--edge` | Etkileşimli öğe kenarı (en az 3:1) |

Metin, vurgu ve durum:

| Belirteç | Anlam |
| --- | --- |
| `--text`, `--text-2`, `--text-3` | Ana, ikincil ve soluk metin |
| `--link` | Bağlantı |
| `--accent`, `--accent-hover`, `--on-accent` | Birincil dolgu, üzerine gelme ve üstündeki yazı |
| `--accent-2` | İkinci vurgu (Arcade degradesinin ikinci ucu, Gece'de yayında yeşili, Turkuaz'da bakır) |
| `--accent-text`, `--accent-2-text` | Zemin üstünde vurgu rengi metin |
| `--accent-lip` | Birincil düğmenin alt dudağı veya halkası |
| `--accent-fill-a`, `--accent-fill-b` | Anahtar, ölçer ve ilerleme dolgusu |
| `--attention`, `--on-attention` | Anma sayısı ve ana sayfa toplam rozeti |
| `--mention-bg`, `--mention-text`, `--mention-line` | Anma rozeti ve beni anan mesaj vurgusu |
| `--focus`, `--focus-halo` | Odak çerçevesi ve haresi |
| `--ok`, `--idle`, `--dnd`, `--offline` | Durum işaretleri (bileşen, 3:1) |
| `--live`, `--live-bg`, `--speaking-bg` | Bağlı ses, konuşan kişi (metin olarak da kullanılır, 4.5:1) |
| `--danger`, `--danger-bg`, `--danger-fill`, `--on-danger` | Tehlike metni, zemini ve dolgusu |
| `--warn`, `--warn-bg`, `--warn-line` | Uyarı metni, zemini ve kenarı |
| `--av-0` ile `--av-7`, `--av-fg`, `--av-offline` | Sekiz avatar ve profil rengi, baş harf rengi, çevrimdışı avatar dolgusu. Gece temasında her renk kendi baş harf rengine sahiptir (`--av-fg-0` ile `--av-fg-7`). |
| `--theme-color` | Tarayıcı çubuğu rengi |

Biçim ve yazı (temaya göre değişir):

| Belirteç | Arcade | Gece Frekansı | Turkuaz ve Bakır |
| --- | --- | --- | --- |
| `--font-body` | Rubik | Manrope | Figtree |
| `--font-display` | Unbounded 700 | Manrope 800 | Young Serif 400 |
| `--font-label` | Unbounded, büyük harf | Martian Mono, büyük harf | Young Serif, normal harf |
| `--radius-panel` | 24px (yüzen paneller) | 0 (düz paneller) | 0 (düz paneller) |
| `--radius-card`, `--radius-control` | 18px, 14px | 14px, 12px | 1.125rem, 0.75rem |
| `--avatar-radius` | %32 (kartuş) | %50 (daire) | sekizgen karo (`clip-path`) |
| `--layout-pad`, `--column-gap` | 1rem, 0.875rem | 0, 0 | 0, 0 |

## Temalar

**Arcade (varsayılan).** Oyun salonu lobisi. Koyu kömür zeminde yüzen cam paneller, alt kenarında dudak taşıyan ve basınca içeri çöken tuş kapağı düğmeler, mor ile camgöbeği arası degrade yalnızca küçük ve anlamlı yüzeylerde (etkin satırın kenarı, rozetler, gönder, Bas konuş kubbesi, konuşan hale). Kartuş biçimli avatarlar, kabin düğmesi gibi kubbeli Bas konuş, segmentli seviye ölçer, odakta liste satırının solunda küçük bir "arcade imleci". Açık mod aynı biçim dilini lavanta griye taşır. Logo, favicon ve uygulama simgeleri Arcade kimliğini kullanır (el telsizi silüeti, gövdesi degrade, düğmesi arcade kabin düğmesi).

**Gece Frekansı.** Radyo istasyonu. Gece mavisi zemin, tek vurgu kehribar sinyal, yayında yeşili yalnızca canlı olan şeylerde. Kanal listesi ölçek çizgisi ve çentikleri olan bir kadrandır, her kanalın kimliğinden türetilen bir frekans rozeti vardır (yalnızca bu temada görünür, ekran okuyuculardan gizlidir), etkin kanalı kehribar bir ibre keser. Durumlar cihaz panelindeki LED'ler gibi üye satırının sağında hizalanır (dolu, yarım, çubuk, halka). Konuşan kişide yeşil halka ve ekolayzır çubukları, mesaj akışında saatler tek aralıklı bir sütun ve ince bir zaman çizgisi.

**Turkuaz ve Bakır.** Çini ve geometrik desen geleneği. Turkuaz "yer ve güven", bakır "sana yönelik dikkat ve ses" anlamı taşır. Avatarlar sekizgen karo, durum işaretleri elmas, konuşan kişide nefes alıp dönen sekiz köşeli yıldız, başlıkların altında kuşak frizi, giriş kartı ve profil kartında kemer biçimi, yazı kanallarında # yerine elmas karo, asimetrik bakır Bas konuş. Rakam içeren metinler Figtree ile yazılır, çünkü Young Serif'in rakamları eski üsluptur.

Konuşma göstergesi her temada farklı görünür ama hep aynı durum sınıfıyla (`.is-speaking`) tetiklenir. Hareketi azalt açıkken hale, ekolayzır ve yıldız tam görünür durağan karede kalır, bilgi kaybolmaz.

## Düzen

Geniş ekranda (1000 piksel ve üstü) soldan sağa üye listesi (`#members`), orta alan (`#main`) ve kanallar sütunu (`#sidebar`) bulunur. Kanallar sütunu yukarıdan aşağı sunucu kimliği, Ana sayfa girişi (`#home-entry`), özel mesajlar (`#dm-section`, `#dm-list`), yazı kanalları, ses kanalları ve kadroları, ses bağlantı paneli ve en altta kullanıcı paneliyle kontrolleri içerir.

Orta genişlikte (760 ile 999 piksel) kanallar sütunu sağda görünür kalır, üye listesi soldan açılan bir katman olur. Dar ekranda (760 pikselin altı) yalnızca orta alan görünür, üye çekmecesi soldan, kanal çekmecesi sağdan açılır. Başlıktaki düğmeler de buna göre yerleşir: sol üstte üyeler, sağ üstte kanallar. Dar ekranda ses bağlıyken yazma alanının üstünde, başparmak hizasında bir ses şeridi ve (bas konuş modunda) Bas konuş hapı görünür.

Düzen işaretleme sırasıyla kurulur, `dir` veya `flex-direction: row-reverse` kullanılmaz. Klavye ve ekran okuyucu sırası görsel sırayı izler. Ayarlar penceresinde kategori listesi solda kalır.

Diğer modüllerin içini doldurduğu kapsayıcılar: `#home-view` (ana sayfa görünümü), `#dm-header` (özel mesaj başlığı), `#key-warning` (anahtar değişti şeridi), `#profile-card`, `#status-menu`, `#dialog-root` (güvenlik numarası ve kimlik açma pencereleri), `#typing-line` (yazıyor satırı), `#btn-search` ve `#search-panel` (arama), `#mention-popover` (@ öneri listesi). Görünüm modu `#app-view[data-view]` özniteliğindedir (`channel`, `home`, `dm`).

## Bileşenler

| Bileşen | Sınıflar | Not |
| --- | --- | --- |
| Düğme | `.button`, `.button-secondary`, `.button-ghost`, `.button-danger`, `.button-small`, `.button-wide`, `.icon-button` | En az 44 piksel. Arcade'de tuş kapağı dudağı ve birincil degrade. `.icon-button.is-off` kapalı mikrofon ve sağırlaştırma. |
| Giriş ve seçim | `.input`, `.select`, `.label`, `.hint`, `.form-error`, `.form-msg`, `.field-status` | Kenar `--edge` (3:1). |
| Onay ve anahtar | `.check`, `.switch` (`input` + `.switch-track`), `.segmented` | Turkuaz'da elmas topuz. |
| Kaydırıcı ve ölçer | `.range`, `.meter`, `.meter-bar`, `.meter-threshold`, `.password-strength` | Arcade'de segmentli, Gece'de LED bölütlü, Turkuaz'da karo bölmeli. |
| Tuş kapağı | `.kbd` | Bas konuş tuşu ve atama gösterimi. |
| Rozet ve etiket | `.badge-owner`, `.badge-admin`, `.badge-active`, `.tag`, `.tag-ok`, `.tag-warn`, `.tag-danger` | |
| Okunmamış ve anma | `.unread-badge` (nokta), `.mention-badge` (sayı), `.entry-badge` (ana sayfa toplamı) | Anma ve toplam rozetleri `--attention` rengindedir. |
| Avatar | `.avatar`, `.avatar-face`, `.avatar-img`, `.avatar-c0` ile `.avatar-c7`, `.avatar-xs/-sm/-md/-lg/-xl` | Durum işareti `data-status` özniteliğiyle (`online`, `idle`, `dnd`, `offline`), konuşma `.is-speaking` ile. `.status-dot` bağımsız durum işaretidir. |
| Kart ve liste | `.card`, `.list-row`, `.list-main`, `.list-name`, `.list-sub`, `.empty-state`, `.empty-row` | |
| Yükleniyor | `.spinner`, `.typing-dots` | Üç nokta, hareketi azaltta durağan. |
| Sekmeler | `.tabs`, `.tab[aria-selected]` | |
| Bildirim | `.toast`, `.toast-error`, `.toast-ok`, `.conn-banner`, `.notice`, `.warning` | |
| Menü ve açılır panel | `.popup-menu`, `.menu-item`, `.menu-danger`, `.menu-separator`, `.popover`, `.status-option` | |
| Profil kartı | `.profile-card`, `.profile-card-band[data-color]`, `.profile-card-head`, `.profile-card-body`, `.profile-card-name`, `.profile-card-handle`, `.profile-card-status`, `.profile-card-section`, `.profile-card-bio`, `.profile-card-actions` | Renk bandı profil rengini izler. |
| Kalıcı pencere | `.modal`, `.modal-dialog`, `.app-dialog`, `.dialog`, `.dialog-actions`, `.sheet` | Dar ekranda tam ekran veya alttan açılan panel. |
| Kanallar sütunu | `.server-identity`, `.server-emblem`, `.home-entry`, `.channel-item`, `.dm-item`, `.voice-row`, `.voice-member`, `.voice-panel`, `.ptt-button`, `.user-panel` | Gece'de `.channel-freq` frekans rozeti. |
| Orta alan | `.channel-header`, `.channel-title`, `.dm-header`, `.key-warning`, `.search-panel`, `.home-view`, `.friend-row`, `.voice-strip`, `.ptt-pill` | |
| Mesajlar | `.msg`, `.msg-first`, `.msg-author`, `.msg-text`, `.jumbo`, `.mention`, `.msg.is-mentioned`, `.msg-blocked`, `.file-card`, `.msg-image` | Anahtarsız mesaj her temada kendi biçiminde (parazit dokusu, çukur kart, mühür). |
| Yazma alanı | `.composer`, `.composer-box`, `.tool-button`, `.send-button`, `.typing-line`, `.mention-popover`, `.mention-option` | Gönder simgesi temaya göre (oynat üçgeni, yukarı ok, kağıt uçak). |
| Emoji seçici | `.emoji-picker`, `.emoji-tabs`, `.emoji-tab`, `.emoji-grid`, `.emoji-button`, `.is-sheet` | Dar ekranda alttan açılan panel. |
| Güvenlik | `.safety-number`, `.safety-group`, `.fingerprint`, `.verified-icon` | |

Temaya özgü süs simgeleri işaretlemede `.skin-arcade`, `.skin-gece`, `.skin-turkuaz` sınıflarıyla durur ve yalnızca kendi temasında görünür.

## Durum sınıfları ve JavaScript sözleşmesi

Tüm modüller aynı durum adlarını kullanır: `.is-speaking`, `.is-unread`, `.is-mentioned`, `.is-active`, `.is-blocked`, `.is-own` ve `data-status`. Seçili öğe için ayrıca `aria-current`, `aria-selected`, `aria-pressed` ve `aria-checked` biçimlendirilir.

`02-state-dom.js` içindeki `avatar(userId, size)` avatarı çizer (`size`: `xs`, `sm`, `md`, `lg`, `xl`), `fillAvatar(node, userId, size)` var olan bir avatar öğesini yeniden çizer. Görünen ad, `@kullanıcı adı`, durum ve avatar bilgisi `13-profile.js`'teki `userDisplayName`, `userHandle`, `userStatus` ve `userAvatarInfo` yardımcılarından gelir, bunlar yoksa kullanıcı adı ve baş harf kullanılır. Avatar resmi yalnızca `blob:` adresiyse gösterilir. Kanal ve üye listeleri değişmediyse yeniden çizilmez, böylece klavye odağı ve odak çerçevesi korunur.

## Erişilebilirlik ve kontrast

Odak çerçevesi tasarımın parçasıdır: 3 piksel `--focus` çizgisi ve çevresinde yarı saydam bir hare. `:focus-visible` desteklemeyen eski tarayıcılarda aynı çerçeve `:focus` ile gelir. Bütün düğmeler ve alanlar en az 2.75rem (16 piksel kökte 44 piksel) yüksekliktedir. Durumlar yalnızca renkle değil biçimle de ayrılır (dolu, hilal, çubuk, halka, Turkuaz'da elmas). Hareketi azalt seçeneği tüm geçiş ve döngüleri durdurur, sistemin `prefers-reduced-motion` ayarını izleyebilir.

Aşağıdaki tablo her rol için o tema ve moddaki en düşük kontrast oranını gösterir. Oranlar `scripts/kontrast.js` betiğiyle `public/css/tokens.css` içindeki belirteçlerden WCAG 2.x göreli parlaklık formülüyle hesaplandı (metin 4.5:1, arayüz bileşeni 3:1). Yarı saydam yüzeyler altlarındaki zeminle birleştirilerek ölçüldü, Arcade'in cam paneli hem düz zemin hem de en parlak ışık noktası üzerinde ölçüldü. Toplam 626 ölçümün hepsi eşiği geçti.

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
| Dolgu ikinci uç | 3:1 | 9.10 | 3.39 | 9.89 | 3.92 | 6.63 | 4.36 |
| Avatar baş harfi (8 renk) | 4.5:1 | 8.64 | 8.64 | 7.26 | 6.62 | 5.49 | 5.49 |
| Çevrimdışı avatar baş harfi | 4.5:1 | 7.49 | 10.02 | 7.66 | 6.27 | 5.98 | 5.10 |

## Yeni tema ekleme

1. Temanın adını seçin (küçük harf, ör. `kumsal`) ve `public/theme-init.js` içindeki `SKINS` listesine ekleyin.
2. `public/css/tokens.css` dosyasına `:root[data-skin="kumsal"]` bloğunu (yazı tipleri, yarıçaplar, `--layout-pad`, `--column-gap`) ve `:root[data-skin="kumsal"][data-scheme="dark"]` ile `:root[data-skin="kumsal"][data-scheme="light"]` bloklarını ekleyin. "Tasarım belirteçleri" bölümündeki adların hepsini tanımlayın, eksik bir belirteç Arcade koyu değerine düşer.
3. Temaya özgü biçimler için `public/css/skins/kumsal.css` oluşturun. Her seçici `:root[data-skin="kumsal"]` ile başlamalı, işaretleme değiştirilmez. Konuşma göstergesini `.is-speaking`, durum işaretlerini `data-status` üzerinden çizin.
4. Dosyayı `index.html`'e diğer tema dosyalarından sonra bağlayın ve `public/sw.js` önbellek listesine ekleyin. Yeni bir yazı tipi gerekiyorsa woff2 dosyasını ve lisansını `public/fonts/` altına koyun (ad deseni `^[a-z0-9-]+\.woff2$`), `base.css`'e `@font-face` (`font-display: swap`, latin ve latin-ext için `unicode-range`) ekleyin. Toplam yazı tipi boyutu 300 KB'yi geçmemelidir.
5. Ayarlar > Görünüm'deki tema kartı için `public/i18n.js` dosyasına `theme.skin.kumsal` ve `theme.skinHint.kumsal` anahtarlarını Türkçe ve İngilizce ekleyin, `components.css` içinde `.theme-swatch-kumsal` önizleme renklerini tanımlayın.
6. Yeni temayı `scripts/kontrast.js` içindeki `SKINS` ve `SKIN_NAMES` listelerine ekleyip `node scripts/kontrast.js` çalıştırın. Başarısız çift kalmayana kadar renkleri ayarlayın, ardından bu belgedeki tabloyu `node scripts/kontrast.js --md` çıktısıyla güncelleyin.
7. Uygulamayı 1920x1080, 1280x800 ve 390x844 boyutlarında koyu ve açık modda açıp ana ekran, ses kanalı, emoji seçici, ayarlar ve giriş ekranını gözden geçirin. Yatay taşma, okunmayan metin ve görünmeyen odak çerçevesi olmamalıdır.

## Eski tarayıcı uyumu

Stil dosyaları oyun konsollarının eski WebKit tabanlı tarayıcılarında da çalışacak biçimde yazılır. Düzen yalnızca flexbox ve margin ile kurulur. `grid`, flex `gap`, `clamp()`, `:is()`, `:where()`, `aspect-ratio` ve `inset` kullanılmaz. Animasyon ve dönüşümler `-webkit-` önekleriyle de yazılır. `backdrop-filter` yalnızca `@supports` içinde ve `-webkit-backdrop-filter` ile birlikte kullanılır, desteklenmezse paneller opak `--surface-1` rengine düşer ve kontrast tablosu bu yedek için de geçerlidir. Satır içi stil ve betik yoktur (içerik güvenliği politikası bunları engeller), simgeler `index.html` içindeki SVG sprite'tan `<use>` ile (hem `href` hem `xlink:href`) alınır.
