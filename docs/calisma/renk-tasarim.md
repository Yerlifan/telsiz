# Renk: uygulama belgesi

Bu belge tek başına yeterli olacak biçimde yazıldı. Uygulayıcı yalnız bu belgeyle işi bitirebilmeli. Depoda hiçbir dosya değiştirilmedi.

Satır numaraları HEAD `ff8784e` üzerinde okundu. Çalışma ağacında başkasına ait iki kaydedilmemiş değişiklik var (`e2e/10-kamera.test.js`, `test/ozel-arama-arayuz.test.js`). `public/` ve `src/` altında kaydedilmemiş değişiklik yok, bu yüzden aşağıdaki satır numaraları geçerli. Eleştirideki "33 ile 72 satır kayma" bulgusu doğru çıktı. Protokol tasarımındaki eski numaralar burada kullanılmadı.

Etiketler:
- **[D]**: kod okunarak doğrulandı (dosya:satır).
- **[K]**: bu belgenin kararı. Uygulayıcı değiştirmeden uygular.
- **[V]**: varsayım. Tarayıcıda ya da cihazda denenmedi, uygulama sırasında doğrulanmalı.

Yollar depo köküne göredir: `/home/user/ps5-pc-communication`.

---

## 1. Kararlar ve gerekçeleri

### 1.1 Kullanıcı kararlarının koda yansıması

| # | Karar | Koddaki karşılığı |
|---|---|---|
| 1 | Ad "Renk", marka adı hiçbir yerde geçmez | Uygulama kimliği `'renk'`, global `TelsizRenk`, i18n `game.renk.*`. `test/oyun-arayuz.test.js` marka adını karakter kodlarıyla kurup yeni dosyalarda, i18n değerlerinde ve belgelerde arar (8.6) |
| 2 | Ses odasında, 2 ile 8 oyuncu, sunucuda değişiklik yok | Koltuk sınırı `TelsizGame.MAX_SEATS = 8` ve uygulamanın `MAX_PLAYERS` değeri. Oda kapasitesi 12'ye çıkarılabilir [D] src/app.js:187-188. Fazla kişiler "Masa Dolu" görür. Taşıma mevcut `POST /api/voice/signal` üzerinden yapılır. Sunucu yalnız dış zarfın biçimine bakar [D] src/app.js:3317-3330, 150-151, 855-861 |
| 3 | Kurpiyer başlatan kişidir ve bütün elleri bilir | Kurpiyer `seats[0]` koltuğunda oturur ve oynar. Deste kurpiyerin cihazında `nacl.randomBytes` ile karıştırılır. Güven metni lobide Katıl düğmesinin hemen üstünde, masada da çip olarak görünür. Denetlenebilir karıştırma yok |
| 4 | Kural setini kurpiyer seçer | `rules: 'official' \| 'stack'`. Seçim lobide yapılır ve Başlat'a kadar değiştirilebilir. Seçim her durum iletisinde oyunculara gider |
| 5 | Kurpiyer ayrılırsa oyun biter, oyuncu ayrılırsa kartları desteye döner | Kurpiyerin peerId'si için gelen `peer-leave` ya da kurpiyerden gelen `close` masayı bitirir. Oyuncunun `peer-leave` olayı ya da `leave` iletisi `removePlayer` çağırır. Kalan koltuk sayısı 2'nin altına düşerse sonuç `too_few` olur |
| 6 | İç katman kurulamayan kişi oyuna alınmaz, nedeni gösterilir | Her iki taraf da `dmSendState` denetimini yapar [D] 15-dm.js:184-200. Neden `game.reason.*` anahtarlarıyla gösterilir. Bu kural Pişti, Dört Taş ve XOX için de geçerlidir (1.2, Y7) |
| 7 | Özel aramada oyun yok | `snap().private` iken ya da `inCallRoom(s)` doğruyken Oyun düğmesi gizlenir ve gelen bütün oyun olayları atılır. voice.js genel kalır |
| 8 | Taşıma ve sahne kipi oyundan bağımsız | voice.js yalnız opak `p` taşır. Masa yöneticisi (`34-oyun-masa.js`) uygulamayı bir sözleşme üzerinden çağırır (5.1). Sahne kipinin adı `game`. Renk ilk ve tek kayıtlı uygulamadır |

### 1.2 Tasarım kararları [K]

| Konu | Karar | Gerekçe |
|---|---|---|
| Topoloji | Yıldız düzeni. Kurpiyer tek otoritedir, oyuncular yalnız kurpiyerle konuşur | Eşler arasında ortak bir ileti sırası yok, sıra yalnız eş başına korunur [D] voice.js:3286-3316 kuyruğu, 3414-3428 seq sıralaması, 2923-2932 `runOp` |
| Durum iletisi | Her `state` tam durumdur: herkese açık görünüm, alıcının eli ve son hamlesinin sonucu tek iç zarfta gider. Fark gönderilmez | Kaybolan ileti bir sonrakiyle onarılır. Herkese açık durum ve el birbiriyle çelişemez. Yayın uç noktası olmadığı için her alıcıya zaten ayrı POST gider |
| Bütünlük | Oyun durumunu değiştiren ya da okuyan her ileti, **her oyunda** iki kişinin kimlik anahtarlarıyla mühürlü iç zarfla (`E2EE.dm`) gider. Düz ileti yalnız davet, ret ve kapanıştır | Grup anahtarını bilen ve sunucuyu işleten kişi (S3) dış zarfta `from` değerini sahteleyebilir. Uygulamanın "gizli el" bayrağı yalnız güven metnini seçer, güvenlik modelini değiştirmez (eleştiri Y7 kabul) |
| Dış alanlar | `{type:'game', sid, n, p}`. Dışta `g` ya da `k` yok | `g` ve tür zaten düz JSON'un ya da iç metnin içinde. voice.js'in güvenliğe hassas yüzeyi küçülür. Dış `k` S3'e ek bilgi vermez (eleştiri Düşük 3 kabul, `g` de kaldırıldı) |
| Kimlikler | userId dize olarak taşınır, biçim `/^[1-9][0-9]{0,15}$/`. Kadrodaki `normId` dize döner [D] voice.js:416-421 | Kural motorundaki "pozitif tamsayı" kimliği kadroyla uyuşmuyordu (eleştiri K3) |
| Kart kodu | İki karakter: renk `R Y G B` ve değer `0-9`, `S` (Engel), `V` (Yön), `D` (+2). Jokerler `WW` ve `WF` (Joker +4) | Prototipte `W4` ile `R4` aynı değeri (`'4'`) döndürüyor, bu da eşleştirmeyi ve puanı bozuyor (eleştiri K1 kabul). +4 kısıtı kart koduyla (`code === 'WF'`) denetlenir |
| Sürüm ve bayatlık | Masada `r` (her durum değişikliğinde artar) ve `rd` (el numarası). Kişi başına `seq` sayacı (`act`, `sync`, `leave`). Motorda `step` (her tur hamlesinde artar). Protokoldeki `tn` ve motordaki `ver` kaldırıldı | İki ayrı "stale" sayacı vardı (eleştiri Orta 1). Genel katman sırayı bilmez, bu karar 8 ile de uyumlu |
| Tazelik | Her davet alıcıya özel rastgele `ni` taşır. `join` bunu geri yollar, kurpiyer her `ni` değerini bir kez kabul eder. Her `state` alıcının kabul edilmiş `ni` değerini yansıtır. Oyuncu `ni` değeri eşleşmeyen durumu kabul etmez | Eski `join`, `leave` ve eski `state` yeniden oynatılamaz. Yenilenmiş sayfa eski durumu kabul etmez (eleştiri Y1 ve Y2 kabul, Y2'deki ayrı `jn` alanı yerine `ni` yansıtılır) |
| Sayaç alanının adı | `seq`. `c` adı kullanılmaz. İç metin `ctx:'game'` taşır | Özel mesaj denetimi `v.a` ve `v.c` alanlarına bakıyor [D] 15-dm.js:263. Aynı box anahtarıyla mühürlü iki düz metin türü arasında alan çakışması olmasın (eleştiri Orta 4 kabul) |
| Gönderim | `voice.sendGame(peerId, p, done)`. Masa yöneticisi koltuk başına en çok bir uçuştaki ileti tutar, arada gelen değişiklikler koltuğu yalnız "kirli" işaretler | 429 yanıtında eş kuyruğu yaklaşık 7 sn bekler [D] voice.js:3330-3333. Bekleyen eski tam durumların bütçeyi yemesi önlenir (eleştiri Y4 kabul) |
| Kısma | Koltuğa özel yanıtlar (reddedilen hamle, aynı `seq` tekrarı) koltuk başına 1 sn'de bir, `sync` yanıtı 5 sn'de bir, `reject` ve `close {why:'gone'}` kişi başına 5 sn'de bir | Tek uçuş kuralı hızı gidiş dönüş süresiyle sınırlar. Yerel ağda bu saniyede 10'dan fazla olabilir, bütçe 120 / 10 sn. Bu yüzden eleştirinin "kısmalar gereksiz" yargısının bu kısmı reddedildi. `GAME_SEND_CAP` ise kaldırıldı (1.3) |
| Canlılık | Kurpiyer 15 sn boyunca bir koltuğa hiçbir şey göndermediyse son durumu yeniden gönderir. Oyuncu 25 sn boyunca kurpiyerden geçerli durum almazsa `sync` gönderir, 45 sn olunca masayı `dealer_lost` nedeniyle bitirir | Yenilenen sayfa ses odasında "hayalet" olarak kalır, `peer-leave` gelmez (eleştiri K2 kabul, 4.11). Alıcıda sessizce atılan ileti sırayı kilitleyebilir (eleştiri Y5 kabul) |
| Yeniden bağlanma | Kurpiyer, koltuktaki kişinin her `peer-ready` olayında önce o kişiye düz `invite` (yeni `ni`, `ph` güncel), sonra `state` gönderir. Masası olan sayfa daveti yok sayar, yenilenmiş sayfa "Oyuna Dön" teklifi gösterir | Yenilenen sayfa aynı peerId ile döner (4.11) |
| Bilinmeyen masa | Kurpiyer, kendisinde olmayan bir `g` için açılabilen her iç iletiye düz `close {why:'gone'}` ile yanıt verir | Kurpiyer sayfayı yenilerse oyuncular sonsuza kadar beklemesin (eleştiri K2 düzeltme 1) |
| Hareketsiz oyuncu | Kurpiyer her koltuk için "Koltuktan Çıkar" düğmesini görür. Sırası 60 sn'yi aşan koltukta "Uzakta" çipi çıkar. Otomatik çıkarma ve "Sırayı Geç" yok | Hayalet koltuk ancak böyle çözülür. "Sırayı Geç" yeni bir hamle türü ister |
| Engelleme | Kurpiyer engellediği kişiye davet göndermez ve ondan gelen `join` iletisine yanıt vermez. Oyuncu, engellediği kurpiyerin davetini göstermez. "Engellediniz" çipi yalnız kurpiyerin ekranında görünür | Engellenen kişi bildirim almasın, engellendiğini de çıkaramasın (eleştiri Y3 kabul) |
| Anahtar `loading` | Kurpiyer `loading` durumundaki kişinin `join` iletisini kişi başına bir tane olmak üzere 10 sn bekletir ve profil gelince yeniden işler. Süre dolarsa sessizce düşürür | `loading` geçici bir durumdur [D] 15-dm.js:190. Profil gelince `profilesChanged` `renderVoiceAll` çağırır [D] 13-profile.js:355-358, o da `gameRender` çağırır (eleştiri Y9 kabul) |
| Oyun sırasında anahtar sorunu | Kurpiyer bir koltuk için mühürleyemiyorsa koltuk "Anahtar Sorunu" olarak işaretlenir ve ona ileti gitmez. Kurpiyer koltuğu çıkarabilir. Oyuncu kurpiyerin anahtarını kullanamıyorsa masayı `keys` nedeniyle yerelde bitirir. `KEY_GRACE_MS` yok | Eleştiri Düşük 4 kabul |
| `peer-leave` alanları | Olayda yalnız `peerId` ve `userId` var, `gone` yok. Cihaz değiştiren kişi koltuğunu kaybeder ve kartları desteye döner | Sayfa yenileme peerId'yi değiştirmiyor (4.11). `gone` yalnız cihaz değişiminde anlamlıydı (eleştiri Düşük 4 kabul) |
| Yeni el | `over` aşamasından lobiye dönülür ("Yeni El"). Oturanlar yerinde kalır, oturmayanlar yeniden davet alır. Başlat yeni bir `newGame` çağırır. `rematch` yok | Üç tasarım bu konuda çelişiyordu (eleştiri Orta 3 kabul) |
| El sonu | Kalan eller açılmaz. Sonuçta yalnız kart sayısı ve puan görünür | Güven metni "eliniz yalnız size gönderilir" diyor (eleştiri Y8 kabul) |
| Puanlama | Her el ayrıdır. Kazanan diğer ellerdeki puanların toplamını alır. Eller arası toplam yok | Basit ve tutarlı. "Toplam" satırı kaldırıldı |
| +4 kısıtı | Motor otomatik denetler, itiraz adımı yok | Kurpiyerin cihazı bütün elleri zaten biliyor (karar 3). İtiraz yeni bir aşama, zaman aşımı ve el gösterme iletisi gerektirirdi |
| Tek! kuralı | **İki kural setinde de geçerli.** Tek bir sabitle kapatılabilir: `LAST_CARD = { official: true, stack: true }` | Karar 4, Tek! cezasını Resmî setin tanımında sayıyor. "Üst üste ekleme" setini Resmî kurallar ile eklemenin birleşimi olarak yorumladım. Kullanıcıya doğrulatılacak tek kural noktası budur. Metin (`stackHint`) bunu açıkça yazar |
| Çekilen kart | Oynanabilirse sıra oyuncuda kalır (çekilen kartı oyna ya da Pas Geç). Oynanamıyorsa sıra kendiliğinden geçer | Fazladan bir tık ve ileti gerekmez. Diğerlerinin "bekliyor" görünce kartın oynanabilir olduğunu anlaması küçük bir sızıntı, kabul edildi. `publicView` içinde `drawn` aşaması `play` olarak gösterilir |
| Kurpiyerin hız üstünlüğü | Kurpiyerin kendi `last` ve `catch` hamleleri 300 ms gecikmeyle işlenir. Belgeye de yazılır | Kurpiyerin hamlesi ağdan geçmiyordu (eleştiri Orta 14 kabul) |
| Kip önceliği | `watch > cams > game > own`. Oyunu açmak izlemeyi bırakır ve ızgarayı kapatır. Oyun asla kendiliğinden kapanmaz, üstteki kip kapanınca masa geri gelir | Mevcut yığının aynı kalıbı: izleme ızgaranın önüne geçiyor [D] 22-cast.js:238, ızgara açılınca izleme bırakılıyor [D] 22-cast.js:359-369 |
| Tek masa | Yumuşak kural. Davet görmüş kişi yeni masa açamaz, Oyun düğmesi "Masaya Bak" olur. İki lobi aynı anda açılırsa `g` değeri küçük olan kalır, `ph:'play'` olan masa lobiye karşı her zaman kalır | İki taraf aynı veriden aynı sonucu hesaplar (eleştiri Y6 kabul). Engelleme yüzünden iki masa aynı odada sürebilir. Her masa kendi `g` değeriyle yalıtıldığı için bu teknik bir sorun değildir |
| Hitap | Oyun metinlerinde "siz": "Sıra Sizde", "Eliniz" | Uygulamanın geri kalanı "siz" kullanıyor ("Ekranınız yayında") |
| Kart adları | tr: Engel, Yön, +2, Joker, Joker +4. en: Skip, Reverse, +2, Wild, Wild +4. Eylem: "Pas Geç" / "Pass". Tek! / Last Card! | Kartın adı ("Engel") eylemle ("Pas Geç") karışmasın. İngilizcede resmî oyunun "Draw Two" ve "Wild Draw Four" adlarından uzak durulur (eleştiri Orta 9) |
| Ses | İlk sürümde yeni ses türü yok | `TelsizSesler.KINDS` testlerle sabitlenmiş durumda [D] test/bildirim-sesleri.test.js:121, 150 |
| Yüzen davet bildirimi | İlk sürümde yok. Davet Oyun düğmesinin durumuyla, Bildirimler listesinde ve ekran okuyucu duyurusuyla bildirilir | Kapsam küçülür |

### 1.3 Eleştiri bulguları: kabul ve ret

| Bulgu | Karar | Gerekçe (kod okunarak) |
|---|---|---|
| K1 değer çakışması | Kabul | 1.2 kart kodu. Ek olarak `canPlay` işlevine karşı bağımsız bir kâhin testi yazılır (8.4) |
| K2 sayfa yenileme | Kabul | Oturum belirteci localStorage'da tutuluyor. peerId yalnız oturum yeniden etkinleşince değişiyor [D] src/hub.js:139-150. Aynı odaya yeniden katılmak `voiceSince` değerini değiştirmiyor [D] src/hub.js:630-634. Sayfa kapanırken sesten ayrılma isteği gitmiyor, `pagehide` yalnız ekran paylaşımı içindir [D] voice.js:3823. `handleState` ses üyeliğine dokunmuyor [D] src/app.js:1807-1830 |
| K3 birleştirilemez modeller | Kabul | Bu belgedeki tek sözleşme |
| Y1 tazelik | Kabul | `ni`, `seq` ve `act` içinde `rd` |
| Y2 yenilenmiş sayfa | Kabul, farklı yolla | Ayrı bir `jn` alanı yerine `state` iletisi kabul edilmiş `ni` değerini yansıtır |
| Y3 engelleme | Kabul | `isBlocked` [D] 14-social.js:109 |
| Y4 tamamlanma bilgisi | Kısmen kabul | `done` geri çağrısı ve tek uçuş kuralı alındı. `GAME_SEND_CAP` ve ayrı geri çekilme çizelgesi kaldırıldı. Koltuğa özel yanıt kısması ve `sync` kısması ise kalır (1.2 Kısma) |
| Y5 sessiz düşme | Kabul | Medya bağlantısı ICE hatasıyla düşse de eş kapanmıyor, `ready` true kalıyor [D] voice.js:2904-2920. Canlılık kuralı (1.2) |
| Y6 eşzamanlı masa | Kabul | 4.12 |
| Y7 bütünlük | Kabul | Karar 6 zaten genel bir kural, kullanıcıya ayrıca sormak gerekmiyor |
| Y8 ellerin açılması | Kabul | 1.2 |
| Y9 `loading` | Kabul | 1.2 |
| Y10 her ses değişiminde yeniden çizim | Kabul | `voiceStructureKey` `JSON.stringify(state.meta.voice)` içeriyor [D] 10-voice.js:156. `castSync` her `renderVoiceAll` çağrısında çalışıyor [D] 10-voice.js:179. `gameRenderStage` kendi anahtarını tutar (6.4) |
| Y11 ilk kart Joker | Kabul | `color` hamlesi ve "Renk Seç" düğmesi. e2e yardımcısı bu dalı da ele alır |
| Orta 1-4 | Kabul | 1.2 |
| Orta 5 davet gürültüsü | Kabul | Alıcı aynı kurpiyerden 30 sn içinde en çok bir davet bildirimi gösterir |
| Orta 6 `sync` kısması | Kabul | 5 sn |
| Orta 7 lobi durumları | Kabul | Durum çipleri yalnız kurpiyerde görünür. Oyuncular yalnız oturanların adlarını görür (`invite.seats`, `state.b.seats`) |
| Orta 8 adlar | Kabul | Tanımlayıcılar ve JSON alanları İngilizcedir [D] CONTRIBUTING.md:152. `TelsizGame`, `TelsizGameDesk`, `TelsizRenk`, `game*`, `renk*` (Renk özel ad, `arama*` emsali), `last` (Tek!), `t:'last'` |
| Orta 9 metin tutarlılığı | Kabul | 1.2. Seçicide ●▲■◆ karakterleri kullanılmaz, SVG simgeler kullanılır |
| Orta 10 `game.end` | Kabul | Düğme `game.endGame`, nedenler `game.ended.<neden>` |
| Orta 11 CSS ve API | Kabul | `-webkit-inline-box` kullanılmaz. `openLayer` içinde `initialFocus` bir işlevdir [D] 02-state-dom.js:371 |
| Orta 12 ağ benzetimi | Kabul | `test/oyun-ag.test.js`. Bunu mümkün kılmak için masa durum makinesi DOM'suz ayrı bir dosyaya alındı (`34-oyun-masa.js`) |
| Orta 13 sızıntı denetimi | Kabul | Nesne yürüyüşüyle yapılır (8.5) |
| Orta 14 kurpiyer üstünlüğü | Kabul | 300 ms |
| Orta 15 e2e oynatıcısı | Kabul | 8.7 |
| Düşük 1 satırlar | Kabul | Bu belgedeki numaralar güncel |
| Düşük 2 `broadcastGame`, `gamePeerOf` | Kabul | Kaldırıldı. Masa `seat.peerId` tutuyor. Oda üyeleri `snapshot().peers[userId].peerId` alanından okunur [D] voice.js:1292-1310 |
| Düşük 3 dış `k` | Kabul, daha ileri | `g` de dışarıdan kaldırıldı |
| Düşük 4 `gone`, `KEY_GRACE_MS` | Kabul | 1.2 |
| Düşük 5 marka testi | Kabul | Arayüz tasarımının "test yazılmasın" önerisi reddedildi: `String.fromCharCode` ile kurulan desen adı kaynağa sokmaz |
| Düşük 6 belge çiftleri | Kabul | 9. bölüm |
| "İlk sürümde kesilebilecekler" | Çoğu kabul | `dealing` aşaması, 30 sn "Yanıt Vermedi" zamanlayıcısı, "Yeniden Davet Et" düğmesi, yüzen bildirim, sistem bildirimi, yeni ses türü, koltukta kamera görüntüsü, tekerleği yatay kaydırmaya çevirme, telefonda yazma alanını gizleme ve televizyon e2e testi kesildi. Reddeden kişi lobi sürdüğü sürece Masaya Bak ile yeniden katılabilir, bu yüzden "Yeniden Davet Et" gerekmez |

---

## 2. Dosya planı

### 2.1 Yeni dosyalar

| Dosya | Global | Saf mı | Görev |
|---|---|---|---|
| `public/js/33-oyun-protokol.js` | `window.TelsizGame` | evet, DOM, saat ve `t()` yok | Sabitler, düz ileti doğrulayıcıları, iç zarf (`sealInner`, `openInner`, `checkInner`), sayaç kuralları (`seqOrder`, `acceptState`), genel `state.b` doğrulayıcısı, rastgelelik (`byteSource`, `randomBelow`, `shuffle`), `ring`, `onlyKeys`, `isId`, `fail` |
| `public/js/34-oyun-masa.js` | `window.TelsizGameDesk` | evet. Zaman `env.now()` ile, ağ `env.send` ile gelir | Masa yöneticisi `create(env)`: kurpiyer ve oyuncu durum makineleri, davetler, koltuklar, gönderim kuyruğu, kısma, canlılık, yönlendirme. Uygulamayı 5.1'deki sözleşmeyle çağırır |
| `public/js/35-renk-kural.js` | `window.TelsizRenk` | evet | Renk kural motoru (5. bölüm) |
| `public/js/36-oyun.js` | `game*` işlevleri | hayır | Yapıştırıcı ve genel arayüz: voice olaylarını masa yöneticisine iletir, Oyun düğmesi, Masa Kur, lobi, sonuç çerçevesi, onay satırı, güven notu, sahne kancaları, canlı bölgeler, Bildirimler kaydı, uygulama arayüzü kaydı `gameUiRegister` |
| `public/js/37-renk.js` | `renk*` işlevleri | hayır | Renk masası çizimi: rakip şeridi, deste, atılan kart, aktif renk, eylem satırı, el, Joker renk seçici, Renk'e özgü duyurular. Yüklenirken `gameUiRegister` ile kaydolur |
| `public/css/oyun.css` | | | Oyun düğmesi durumları, Masa Kur, lobi, koltuk listesi, çipler, güven notu, onay satırı, sonuçlar, durum satırı, eşitleme şeridi, telefonda sahne yüksekliği |
| `public/css/renk.css` | | | Kartlar, kart arkası, deste, atılan kart, rakip şeridi, el, renk seçici |
| `test/oyun-tasima.test.js` | | | voice.js `game` sinyali |
| `test/oyun-protokol.test.js` | | | `TelsizGame`, gerçek nacl ve crypto.js ile |
| `test/oyun-masa.test.js` | | | `TelsizGameDesk`, tek cihazda sahte ortamla |
| `test/renk-kural.test.js` | | | `TelsizRenk` |
| `test/oyun-ag.test.js` | | | Dört cihazlı ağ benzetimi, gerçek kripto, kayıp, tekrar ve yenileme |
| `test/oyun-arayuz.test.js` | | | Bağlantılar, CSS kuralları, belirteçler, i18n kapsamı, marka denetimi, arayüz mantığı |
| `e2e/16-oyun.test.js` | | | Uçtan uca, `h.MIC_BROWSERS`, yuva 21 |

Dosya adları `^[0-9a-z-]+\.js$` ve `.css` desenine uyduğu için sunucu ve masaüstü bunları kendiliğinden sunar [D] src/app.js:282-288, desktop/src/lib/static-files.js:58-59. Kökte dosya eklenmez.

Yükleme bağımlılıkları: 34 ve 35 yüklenirken `TelsizGame` değerini bağlar, bu yüzden 33'ten sonra gelmeleri gerekir. 37 yüklenirken 36'daki `gameUiRegister` işlevini çağırır. `defer` betikleri belge sırasıyla çalıştığı için bu sıra kendiliğinden sağlanır. 36, `TelsizRenk` değerine yalnız çalışma anında `gameApp('renk')` ile ulaşır.

### 2.2 Değişen mevcut dosyalar

| Dosya | Yer [D] | Değişiklik |
|---|---|---|
| `public/voice.js` | 116 `CAMERA_KEYS` sonrası | `GAME_KEYS`, `GAME_TEXT_RE`, `MAX_GAME_CHARS` (3.1) |
| | 795-801 `validCameraSignal` sonrası | `validGameSignal` (3.2) |
| | 838 `onCameraEvent` sonrası | `var onGameEvent = ...` (3.6) |
| | 3153 `peer.ready = true` sonrası | `peer-ready` olayı (3.6) |
| | 3264-3267 kamera dalı sonrası | `game` dalı (3.4) |
| | 3286-3316 `sendSignal` | Dördüncü parametre `onDone` ve boolean dönüş (3.5) |
| | 3359-3367 `verify` | Beyaz liste ve katı doğrulama (3.3) |
| | 3438-3447 `screenEvent` sonrası | `gameEvent` ve `sendGame` (3.5, 3.6) |
| | 5200-5208 `applyRoster` silme döngüsü | `peer-leave` olayı (3.6) |
| | 5300-5322 `resetSession` sonu | `reset` olayı (3.6) |
| | 5656-5703 dönen nesne | `sendGame: sendGame` |
| | 5705-5742 fabrika dönüşü | `gameUtils` (3.7) |
| `public/js/10-voice.js` | 14-15 başlık yorumu | Araç satırı sırası: Büyüt, Oyun, Telsiz DJ |
| | 21-48 `createVoice` | `onGameEvent` (3.8) |
| | 181 `aramaRender` satırından sonra | `if (typeof gameRender === 'function') gameRender()` |
| `public/js/22-cast.js` | 12-24 sözleşme yorumu, 220-243 `castSync`, 238 kip satırı, 387-390 `castFocusAfterClose`, 394-572 `castBuildStage`, 599-653 `castRenderStage`, 816-837 `castCloseStage`, 871-874 `castChatOpen` | `game` kipi (6.4) |
| `public/js/28-bildirim.js` | 3-11 başlık yorumu, 59-76 `activityShare` kalıbı, 88-93 `activityText`, 95-121 `renderActivity` | `kind: 'game'` kaydı, `activityGame`, `activityClearGames` (6.10) |
| `public/css/cast.css` | 1-9 başlık yorumu | `#cast[data-mode="game"]` sözleşmesi |
| `public/css/tokens.css` | 741 rol renkleri bloğundan sonra | Kart belirteçleri (6.9) |
| `public/index.html` | 30 (tanitim.css) ile 31 (skins/arcade.css) arası | `oyun.css`, `renk.css` |
| | 73 (32-arama.js) sonrası | 33, 34, 35, 36, 37 betikleri |
| | 151 `i-gamepad` sonrası | `i-reverse`, `i-suit-circle`, `i-suit-triangle`, `i-suit-square`, `i-suit-diamond` sembolleri |
| `public/sw.js` | 28 (`tanitim.css`) sonrası, 69 (`32-arama.js`) sonrası | Aynı yedi dosya. `CACHE_NAME` (11) değişmez |
| `public/i18n.js` | tr 24-1959, en 1961-3896 | 7. bölüm. Her iki sözlükte aynı sırayla, `activity.*` anahtarlarının ardından (tr 679-683, en 2616-...) |
| Belgeler | 9. bölüm | |

### 2.3 Değişmeyenler

- Sunucu (`src/`), `05-poll.js`, `desktop/`. `05-poll.js` içinde ayrı bir dağıtıcı yazılmaz, bu `verify` ve `fresh` mantığını kopyalamak olurdu.
- `frekans.css`. Geniş ekranda sahne açıkken sağ sütunu gizleyen kural yalnız `cams` kipini dışarıda bırakıyor [D] frekans.css:1357, 1362. Bu yüzden oyunda sağ sütun zaten gizlenir.
- `ELEMENT_IDS` [D] 02-state-dom.js:81-118. Bütün oyun öğeleri çalışma anında kurulur.
- `test/settings.test.js:20-25` dosya listesi. Yeni çağrıların hepsi `typeof` korumalıdır.

---

## 3. voice.js genel oyun taşıması

voice.js yalnız taşıma yapar. `p` yükünün anlamı voice.js için bilinmez. Oyun adı, kural ya da tür bilgisi voice.js'e girmez.

### 3.1 Sabitler (116'dan sonra)

```js
  // Oyun sinyali (genel taşıma): p oyun modülünün yüküdür (düz JSON veya iç zarf), burada yalnızca biçim ve
  // boyut denetlenir. Yazdırılabilir ASCII: JSON kaçışıyla en çok iki kat büyür, zarf sınırı kesin hesaplanır.
  var GAME_KEYS = ['type', 'sid', 'n', 'p']
  var GAME_TEXT_RE = /^[ -~]+$/
  var MAX_GAME_CHARS = 11000
```

**Boyut hesabı [D].** Sunucu sınırı 32000 karakter [D] src/app.js:62. Dış düz metin `{"v":1,"from":"<16>","to":"<16>","d":{"type":"game","sid":"<16>","n":<=10 hane,"p":"..."}}` yaklaşık 110 karakter artı kaçışlı `p` uzunluğudur. En kötü durumda `p` 22000 karaktere çıkar. JSON uzunluğu J = 22110 olur, zarf `52 + ceil((J + 16) * 4 / 3)` = 29554 karakter tutar. Özel arama zarfı (`'2.'` öneki 35 karakter, düz metinde `c` alanı) da sınırın altında kalır. İç zarf base64url olduğu için kaçış gerektirmez. Gerçek büyüklük: 8 kişilik bir Renk durumunun iç düz metni yaklaşık 1,3 KB, `p` olarak yaklaşık 1,8 bin karakter.

### 3.2 Saf doğrulayıcı (801'den sonra)

```js
  // Oyun sinyali. Dönüş: { type: 'game', p } veya null. sid ve n ortak doğrulamadadır.
  function validGameSignal (d) {
    if (!d || typeof d !== 'object' || Array.isArray(d) || d.type !== 'game') return null
    if (!onlyKeys(d, GAME_KEYS)) return null
    if (typeof d.p !== 'string' || !d.p.length || d.p.length > MAX_GAME_CHARS || !GAME_TEXT_RE.test(d.p)) return null
    return { type: 'game', p: d.p }
  }
```

### 3.3 `verify` (3359-3367)

```js
      var screenType = d.type === 'screen' || d.type === 'watch'
      var cameraType = d.type === 'camera'
      var gameType = d.type === 'game'
      if (d.type !== 'offer' && d.type !== 'answer' && d.type !== 'candidate' && !screenType && !cameraType && !gameType) return null
      // sid ve n denetimi aynen kalır
      if (screenType && !validScreenSignal(d)) return null
      if (cameraType && !validCameraSignal(d)) return null
      if (gameType && !validGameSignal(d)) return null
      if (!fresh(from, d.sid, d.n)) return null
```

Geçersiz oyun sinyali, ekran ve kamera sinyalinde olduğu gibi sıra numarası tüketmeden atılır.

### 3.4 `processSignal` dalı (3267'den sonra, `candidate` dalından önce)

```js
      } else if (d.type === 'game') {
        // Yalnızca ilk anlaşması tamamlanmış ve aynı bağlantıdan (sid) gelen oyun iletisi oyun modülüne gider
        if (!peer || peer.sid !== sid || !peer.ready) return
        var gm = validGameSignal(d)
        if (gm) gameEvent({ type: 'message', peerId: from, userId: st.roster[from].userId, p: gm.p })
```

`st.roster[from]` bu noktada vardır, çünkü `processSignal` ilk satırda bunu denetliyor [D] 3178. Dalda `await` yok. İletiler `runOp` ile eş başına sırayla gelir [D] 2923-2932.

### 3.5 `sendSignal` değişikliği ve `sendGame`

`sendSignal(peer, d, onFail, onDone)`:
- Erken dönüşler (`!st.inVoice || !st.myPeerId || peer.closed`, mühürleme hatası) `return false` olur.
- Sona `return true` eklenir.
- Mevcut çağıranlar dönüş değerini kullanmadığı için davranış değişmez.
- Kuyruk sonucu şöyle işlenir:

```js
      }).then(function (res) {
        if (gen !== st.gen || res === undefined) return
        if (res !== true && onFail) onFail(res)
        if (onDone) onDone(res)
      }).catch(noop)
```

Bu yazım eski `if (res !== true && res !== undefined && onFail && gen === st.gen) onFail(res)` satırıyla aynı anlamı taşır.

`sendGame` (`screenEvent` sonrasına):

```js
    // Oyun iletisi tek eşe. done(true) iletildi, done(sayı) yeniden denemelerden sonra da iletilemedi (HTTP
    // durumu, ağ hatasında 0). Oturum değişirse done çağrılmaz, ardından 'reset' olayı gelir.
    // Dönüş: 'ok', 'not_in_voice', 'no_peer', 'not_ready' (ilk anlaşma bitmedi), 'bad_message', 'no_key'
    function sendGame (peerId, p, done) {
      if (!st.inVoice || !st.myPeerId) return 'not_in_voice'
      var d = { type: 'game', p: p }
      if (!validGameSignal(d)) return 'bad_message'
      if (!isPeerId(peerId) || !st.roster[peerId]) return 'no_peer'
      var peer = st.peers[peerId]
      if (!peer || peer.closed) return 'no_peer'
      if (!peer.ready) return 'not_ready'
      return sendSignal(peer, d, null, typeof done === 'function' ? done : null) ? 'ok' : 'no_key'
    }
```

`done(status)` durumlarının anlamı: 429, 0 ve 5xx üç yeniden denemeden sonra gelir (1, 2 ve 4 sn) [D] 3330-3333. 404 alıcının artık etkin olmadığını, 403 kendi oturumumun seste olmadığını, 400 boyut ya da biçim hatasını (yazılım hatası) gösterir.

### 3.6 Olaylar

`create` içinde 838'den sonra:

```js
    var onGameEvent = typeof opts.onGameEvent === 'function' ? opts.onGameEvent : null
```

`screenEvent` kalıbında [D] 3438-3447:

```js
    // Oyun olayları mikro görevde ve sırayla bildirilir, dinleyici hatası motoru bozmaz
    function gameEvent (evt) {
      if (!onGameEvent) return
      Promise.resolve().then(function () {
        try {
          onGameEvent(evt)
        } catch (e) {
          setTimeout(function () { throw e }, 0)
        }
      })
    }
```

| Olay | Yer | Alanlar | Anlamı |
|---|---|---|---|
| `message` | `processSignal` oyun dalı | `peerId, userId, p` | Doğrulanmış, taze, aynı sid'den gelen oyun yükü |
| `peer-ready` | `afterStable`, 3153 `peer.ready = true` satırından hemen sonra: `var rr = st.roster[peer.peerId]` ve `if (rr) gameEvent({ type: 'peer-ready', peerId: peer.peerId, userId: rr.userId })` | `peerId, userId` | Her (peerId, sid) çifti için bir kez. İlk bağlantıda, ICE ya da yeniden kurulumda (yeni sid) ve aynı peerId ile yenilenip dönen sayfada gelir |
| `peer-leave` | Yalnız `applyRoster` silme döngüsü, 5207 `delete st.camBlocked[pid]` satırından sonra: `gameEvent({ type: 'peer-leave', peerId: pid, userId: st.roster[pid].userId })` | `peerId, userId` | Kişi bu peerId ile kadrodan çıktı. `st.roster = next` 5209'dan önce okunur |
| `reset` | `resetSession` sonu (5321'den sonra) | yok | Ses oturumu bitti, oda değişti ya da katılım başlıyor (`doJoin` başında da çağrılır) |

`closePeer(peer, 'reconnect')` hiçbir olay yaymaz [D] 3143, 3204. Yeniden bağlanma ardından gelen `peer-ready` ile ele alınır.

### 3.7 Dışa açma

- Dönen nesneye (5702 `uplinkEstimate` satırından sonra): `sendGame: sendGame`.
- Fabrika dönüşüne (5742'den önce): `gameUtils: { validateSignal: validGameSignal, maxChars: MAX_GAME_CHARS }`.

### 3.8 `10-voice.js` bağlantısı

`createVoice` içinde `onCameraEvent` girdisinden sonra (32-36):

```js
      // Oyun olayları (ileti, eş hazır, eş ayrıldı, oturum sıfırlandı) 36-oyun.js masa yöneticisine gider
      onGameEvent: (evt) => {
        if (typeof gameOnVoiceEvent === 'function') gameOnVoiceEvent(evt)
      },
```

`renderVoiceAll` içinde 181'den sonra: `if (typeof gameRender === 'function') gameRender()`.

### 3.9 Süreç

voice.js güvenliğe hassas bir alandır [D] CONTRIBUTING.md:175. Yeni bir düz metin türü "düz metin biçimi" değişikliği sayılır ve kod yazılmadan önce bir issue'da tartışılır [D] CONTRIBUTING.md:184. Uygulama sırasının 0. adımı budur. PR açıklaması 3.1'deki boyut hesabını ve 4.15'teki tehdit tablosunu içermelidir.

---

## 4. Oyun protokolü

### 4.1 Katmanlar ve `p` biçimi

- **Dış katman (voice.js):** grup anahtarlı `'1.'` zarfı. `from` değerini sunucu atar [D] src/hub.js:793. Dış `from` ve `to` bağı denetlenir [D] voice.js:3357. Tekrar koruması `fresh` ile yapılır [D] 3372-3385.
- **`p` yükü:**
  - `'{'` ile başlıyorsa düz JSON'dur.
  - `'2.'` ile başlıyorsa iç zarftır (`E2EE.dm.seal`, crypto.js:1169-1183).
  - Başka bir şeyle başlıyorsa atılır.
- **Her türün biçimi sabittir (4.3).** Yanlış biçimde gelen ileti atılır, böylece biçim düşürme saldırısı olmaz.
- Düz JSON gönderilmeden önce `TelsizGame.encodePlain` ile kodlanır. Bu işlev `JSON.stringify` çıktısının `GAME_TEXT_RE` desenine uyduğunu ve 11000 karakteri aşmadığını denetler. Yükte ad yoktur, yalnız sayısal kimlikler ve kodlar vardır.

### 4.2 İç zarf

Ortak alanlar: `{v: 1, ctx: 'game', k, g, ch, from, to}`.

| Alan | Bağ | Ne önler |
|---|---|---|
| `ctx` | `'game'` | Özel mesaj ya da özel arama düz metniyle karışma (aynı box anahtarı) |
| `k` | tür | Bir türün başka tür yerine kullanılması |
| `g` | masa kimliği, 16 hex | Başka ya da eski masanın iletisi |
| `ch` | `String(snap().channelId)` | Başka odadan taşınan ileti |
| `from` | gönderenin kadrodaki userId'si | Başkası adına ileti |
| `to` | alıcının userId'si | Yansıtma: ortak anahtar `box.before` ile iki yönde aynıdır [D] crypto.js:1150-1166. Kurpiyerin B'ye gönderdiği zarf kurpiyere geri yollanırsa açılır, ama `from` alanı kurpiyerin kendisini gösterdiği için reddedilir |
| `ni` | davet tek kullanımlık değeri | Eski `join` iletisinin yeniden oynatılması. Yenilenmiş sayfaya eski durum dayatılması |
| `seq` | kişi sayacı | Eski `act`, `sync` ya da `leave` iletisinin yeniden oynatılması |
| `rd` | el numarası | Önceki elden kalan hamle |
| `r` | masa sürümü | Eski durumun yeniden oynatılması |

Türe göre izinli alanlar (`onlyKeys` ile denetlenir ve hepsi zorunludur):

```js
  const BASE = ['v', 'ctx', 'k', 'g', 'ch', 'from', 'to']
  const INNER_KEYS = {
    join: BASE.concat(['app', 'ni']),
    act: BASE.concat(['seq', 'rd', 'b']),
    sync: BASE.concat(['seq']),
    leave: BASE.concat(['seq']),
    state: BASE.concat(['r', 'ni', 'b'])
  }
```

Saf işlevler (`TelsizGame`). `dm` parametresi dışarıdan verilir (tarayıcıda `window.E2EE.dm`, testte vm bağlamındaki gerçek crypto.js):

```js
  // Mühürleme. Sonuç MAX_P sınırını aşarsa veya mühürlenemezse null
  function sealInner (dm, obj, pk, sk) {
    let env = null
    try {
      env = dm.seal(obj, pk, sk)
    } catch (e) {
      return null
    }
    return typeof env === 'string' && env.length <= MAX_P ? env : null
  }

  // Açma: yalnızca verilen tek açık anahtar denenir (karşı tarafın güncel doğrulanmış anahtarı)
  function openInner (dm, p, pk, sk) {
    if (typeof p !== 'string' || p.indexOf('2.') !== 0) return null
    let res = null
    try {
      res = dm.open(p, [pk], sk)
    } catch (e) {
      return null
    }
    const x = res && res.ok === true ? res.value : null
    return isPlain(x) && x.v === VERSION && x.ctx === CTX && typeof x.k === 'string' ? x : null
  }

  // Bağ denetimi: tür alan kümesi, masa, oda, gönderen ve alıcı
  function checkInner (x, expect) {
    const keys = INNER_KEYS[x.k]
    if (!keys || !onlyKeys(x, keys) || keys.some((key) => x[key] === undefined)) return null
    if (!isHex16(x.g) || x.ch !== expect.ch || x.from !== expect.from || x.to !== expect.to) return null
    if (expect.g !== undefined && x.g !== expect.g) return null
    if (x.seq !== undefined && !(isCount(x.seq) && x.seq >= 1)) return null
    if (x.rd !== undefined && !isCount(x.rd)) return null
    if (x.r !== undefined && !(isCount(x.r) && x.r >= 1)) return null
    if (x.ni !== undefined && !isHex16(x.ni)) return null
    if (x.app !== undefined && !APP_RE.test(x.app)) return null
    return x
  }
```

- `isCount(n)`: `Number.isInteger(n) && n >= 0 && n <= 1e9`.
- `isHex16`: `/^[0-9a-f]{16}$/`.
- `APP_RE`: `/^[a-z]{1,16}$/`.
- `isId`: `/^[1-9][0-9]{0,15}$/`.
- `CH_RE`: `/^[A-Za-z0-9_-]{1,64}$/` (voice.js `ID_RE` ile aynı, [D] voice.js:133).

**Anahtarlar** (`36-oyun.js`, `joinCallRoom` kalıbı [D] 10-voice.js:261-292). Her mühürleme ve açma işleminde yeniden çağrılır:

```js
// İç katman anahtarları: kişinin güncel doğrulanmış açık anahtarı ve bu cihazdaki kimlik anahtarı
function gameKeys (userId) {
  const st = dmSendState(userId)
  if (!st.ok) return { ok: false, reason: st.reason }
  const pair = myIdentity()
  if (!pair) return { ok: false, reason: 'locked' }
  return { ok: true, pk: st.pk, sk: pair.secretKey }
}
```

Eski anahtarlar (`pins.knownKeys`) denenmez.

### 4.3 İleti tablosu

K = kurpiyer, O = oyuncu. Hepsi dışta `{type:'game', sid, n, p}` içinde taşınır.

| k | Yön | Biçim | Alanlar | Alıcının denetimi |
|---|---|---|---|---|
| `invite` | K -> her oturmamış oda üyesine ayrı ayrı. Koltuktaki kişiye yalnız `peer-ready` olayında | düz | `{v, ctx, k, g, ch, app, dealer, ph, rules, seats, max, ni, key}` | `dealer` gönderenin kadrodaki userId'si. `ch` benim odam. `app` kayıtlı. `ph` `lobby`, `play` ya da `over`. `seats` 1 ile `max` arası benzersiz kimlik, `seats[0] === dealer`. `max` 8'den büyük değil. `ni` 16 hex. `key` null ya da `unverified`, `changed`, `gone` ya da `loading` (kurpiyerin bu alıcı için gördüğü anahtar durumu). Özel aramada atılır. Kurpiyeri engellediysem atılır. Bir `g` ilk davetten sonra o `dealer` değerine sabitlenir |
| `decline` | O -> K | düz | `{v, ctx, k, g, ch, ni, why, key}` | `why` `user` ya da `keys`. `key` null ya da `locked`, `unverified`, `changed`, `loading`, `gone`. `blocked` hiçbir zaman gönderilmez. K yalnız lobide ve davet edilmiş kişiden kabul eder, yalnız lobi çipini değiştirir |
| `reject` | K -> O | düz | `{v, ctx, k, g, ch, why}` | `why` `full`, `started`, `closed` ya da `keys`. O yalnız `joining` durumundayken ve gönderen davetteki kurpiyerse kabul eder. Kişi başına 5 sn'de bir gönderilir |
| `close` | K -> koltuklar ve davet edilenler. `why:'gone'` ise tek kişiye | düz | `{v, ctx, k, g, ch, why}` | `why` `dealer`, `superseded` ya da `gone`. Alıcı yalnız (`userId === masa.dealer` ve `peerId === masa.dealerPeer`) ise ya da saklı davetin kurpiyerinden geliyorsa kabul eder |
| `join` | O -> K | iç | `+ app, ni` | 4.8 |
| `act` | O -> K | iç | `+ seq, rd, b` (`b` uygulamanın hamle nesnesi) | 4.8 |
| `sync` | O -> K | iç | `+ seq` | 4.8 |
| `leave` | O -> K | iç | `+ seq` | 4.8 |
| `state` | K -> her koltuk | iç | `+ r, ni, b` (4.4) | 4.7 |

Rol tablosunda olmayan her ileti sessizce atılır. Örneğin kurpiyere gelen `state` ya da oyuncuya gelen `act`.

### 4.4 `state.b` gövdesi

```
{
  ph: 'lobby' | 'play' | 'over',
  app: 'renk',
  rules: 'official' | 'stack',        // uygulamanın RULES listesinden
  seats: ['5', '12', ...],            // 1..8, seats[0] kurpiyer, sıra katılım sırası
  rd: 0..1e6,                         // el numarası, ilk lobide 0
  ack: { seq, ok, code? },            // bu alıcının işlenen son sayaçlı iletisi, yoksa { seq: lastSeq, ok: true }
  view: null | uygulama publicView,   // lobide null
  mine: null | uygulama privateView,  // view null ise null
  ev: [{ r, ...olay }],               // en çok 8, olayın gerçekleştiği r ile
  away: ['12']                        // kurpiyerin "Uzakta" saydığı koltuklar (seats alt kümesi)
}
```

`TelsizGame.validStateBody(b, ctx)` genel denetimi yapar:
- `onlyKeys` ve alan türleri.
- `seats[0] === ctx.dealer` ve `seats.indexOf(ctx.me) >= 0`. Ben yoksam bu durum değil, "çıkarıldım" bilgisidir (4.7).
- `ph === 'lobby'` iff `view === null`.
- `ev[i].r <= r`.
- `code` deseni `/^[a-z_]{1,32}$/`.

Ardından uygulamanın `validateView(view, seats)` ve `validatePrivate(mine, view, me)` işlevleri çağrılır. Herhangi biri null dönerse durum atılır ve konsola bir kez `console.warn` yazılmaz. Sessiz atılır, çünkü S3 kaynaklı olabilir.

### 4.5 Masa yöneticisi: `TelsizGameDesk.create(env)`

`env` (36-oyun.js kurar, testler taklit eder):

```
{
  me: () => '5' | null,                       // String(state.me.id)
  channel: () => '3' | null,                  // seste değilse null
  isPrivate: () => bool,                      // snap().private
  roomPeers: () => [{ userId, peerId }],      // snap().peers (kendim hariç)
  send: (peerId, p, done) => kod,             // voice.sendGame
  keys: (userId) => { ok, pk, sk } | { ok: false, reason },   // gameKeys
  dm: { seal, open },                         // window.E2EE.dm
  rng: (n) => bayt dizisi,                    // (n) => window.nacl.randomBytes(n)
  now: () => ms,
  isBlocked: (userId) => bool,
  apps: { renk: TelsizRenk },
  onChange: () => void,                       // modelin değiştiğini bildirir
  onNotice: (kind, data) => void              // 'invite', 'turn', 'ended', 'events', 'joined', 'left', 'declined', 'error'
}
```

Yöntemler (hepsi eşzamanlıdır, iç değişikliklerden sonra `flush()` ve `env.onChange()` çağrılır):

| Yöntem | Kim | Anlamı |
|---|---|---|
| `onVoiceEvent(evt)` | ikisi | 3.6'daki olaylar |
| `tick()` | ikisi | 36-oyun.js masa etkinken 250 ms'de bir çağırır. Zaman aşımları, canlılık, geri çekilme ve kurpiyerin gecikmeli kendi hamleleri burada işlenir |
| `recheck()` | ikisi | Anahtar ya da profil değişti. Bekletilen `join` iletilerini ve lobi anahtar çiplerini yeniden değerlendirir |
| `openSetup(app)`, `cancelSetup()` | K | Yerel Masa Kur ekranı, ileti gitmez |
| `openTable(rules)` | K | Masayı lobide açar, davetleri gönderir |
| `setRules(rules)` | K | Yalnız lobide |
| `start()` | K | Lobiden oyuna. 2 ile `min(8, app.MAX_PLAYERS)` koltuk gerekir |
| `endGame()` | K | Oyundan `over` aşamasına (`app.endGame`) |
| `newRound()` | K | `over` aşamasından `lobby` aşamasına |
| `closeTable()` | K | Masayı kapatır, `close {why:'dealer'}` gönderir |
| `removeSeat(uid)` | K | Kişiyi koltuktan çıkarır (`leave` ile aynı etki) |
| `join()`, `decline()` | O | Davete yanıt. `join` aynı zamanda "Oyuna Dön" teklifini kabul eder |
| `leave()` | O | Masadan ayrılır |
| `act(move)` | ikisi | Uygulama hamlesi. Kurpiyerde yerel olarak uygulanır |
| `dismiss()` | ikisi | Bitti ya da ret ekranını kapatır |
| `model()` | ikisi | Arayüz görünüm modeli (6.1) |

### 4.6 Kurpiyer durum makinesi

```
none --openSetup--> setup (yerel)
setup --openTable(rules)--> lobby
    g = 8 rastgele bayttan hex, r = 1, rd = 0, seats = [ben], dealerPeer = benim peerId
    her oda üyesine (engelliler hariç) invite (alıcıya özel ni). 'not_ready' dönenlere peer-ready'de gider
lobby --geçerli join--> lobby (koltuk eklenir, r++)
lobby --leave | peer-leave(koltuk) | removeSeat--> lobby (koltuk çıkar, r++)
lobby --start--> play
    rd++, game = app.newGame({ rules, players: seatIds, dealSeat: (rd - 1) % seats.length }, rng), r++
    oturmamış oda üyelerine invite (ph:'play')
play --kabul edilen act--> play (r++) | over (app.isOver)
play --koltuk çıktı--> play | over (kalan < 2 ise too_few)
play --endGame--> over
over --newRound--> lobby (r++, oturmamışlara invite ph:'lobby', yeni ni)
lobby | play | over --closeTable--> none (close {why:'dealer'} koltuklara ve davetlilere)
her durum --reset | myIdentity() null--> none (yerel. Kimlik kilitlendiyse ve hâlâ seste isem düz close gönderilir)
```

Masa kaydı:

```
table = {
  app, g, ch, dealer, dealerPeer, ph, rules, rd, r,
  seats: [{ id, peerId, ni, keyIssue, dirty, onlySelf, inflight, lastSendAt, lastReplyAt, lastSyncReplyAt,
            backoffIdx, retryAt, ack: { seq, ok, code }, turnSince }],
  lastSeq: { uid: n },             // masanın ömrü boyunca, koltuktan çıkan kişi için de tutulur
  invites: { uid: { ni, peerId, status, key, at } },   // status: waiting | declined | cannot | full
  held: { uid: { p, peerId, at } },                     // anahtarı loading olan join
  game, events: [{ r, ...olay }], plainAt: { uid: ms }, selfQueue: [{ move, due }]
}
```

### 4.7 Oyuncu durum makinesi

```
none --geçerli invite (ph lobby, kurpiyer engelli değil)--> invited (saklanır, bildirim kısmalı)
none --geçerli invite (ph play|over, seats içinde ben)--> rejoin ("Oyuna Dön")
none --geçerli invite (ph play|over, seats içinde ben değil)--> busy ("Oyun Sürüyor", saklanır)
invited | rejoin --join(), gameKeys(dealer) ok ve invite.key null ya da loading--> joining
    iç join { app, ni }, JOIN_TIMEOUT 10 sn
invited --join(), anahtar sorunu--> invited (neden gösterilir, bir kez decline {why:'keys', key})
invited --decline()--> none (decline {why:'user'}. Saklı davet kalır, Masaya Bak ile yeniden açılabilir)
joining --state (seats içinde ben, ni eşleşir)--> seated (model aşaması b.ph)
joining --reject--> rejected(why) --dismiss--> invited | none
joining --zaman aşımı--> invited (game.joinTimeout)
seated --state--> güncelleme (4.9 sürüm kuralı)
seated --state (seats içinde ben yok)--> ended('removed')
seated --leave()--> none (iç leave {seq}, yanıt beklenmez)
seated --close | peer-leave(dealerPeer) | canlılık sonu | anahtar sorunu--> ended(neden) --dismiss--> none
her durum --reset--> none (masa bilgisi silinir, stage kapanır)
```

Bitiş nedenleri: `dealer_left` (`peer-leave` ya da `close {why:'gone'}`), `closed` (`close {why:'dealer'}`), `superseded`, `dealer_lost` (canlılık), `removed`, `keys`, `reset`.

### 4.8 İleti kabul sırası

Hepsi tek JavaScript görevinde eşzamanlı yürür (`dm.open` nacl ile eşzamanlıdır). Farklı eşlerin iletileri arasında yarış olmaz.

**Ortak ön adımlar (36-oyun.js `gameOnVoiceEvent`):**
1. `snap().private` ise ya da `env.channel()` null ise olay atılır.
2. `desk.onVoiceEvent(evt)` çağrılır.

**Masa yöneticisinde `message`:**
1. `p[0] === '{'`: `parsePlain(p)`. Biçim ya da tür geçersizse atılır. Rol tablosu uygulanır: kurpiyer yalnız `decline`, oyuncu yalnız `invite`, `reject` ve `close` alır. Masası olmayan kişi `invite` alır.
2. `p` `'2.'` ile başlıyorsa:
   - `keys = env.keys(userId)`.
   - Kurpiyerde `keys.reason === 'loading'` ise `held[userId] = { p, peerId, at }` olur (kişi başına bir tane, üzerine yazılır) ve çıkılır.
   - Kurpiyerde `keys.reason === 'blocked'` ise iletiyi atar.
   - Başka bir `keys` sorunu varsa atılır. Gönderen koltuktaysa `seat.keyIssue = reason` olur. Oyuncu tarafında gönderen kurpiyerse masa `keys` nedeniyle biter.
   - `x = openInner(env.dm, p, keys.pk, keys.sk)` null dönerse atılır.
   - `checkInner(x, { ch, from: userId, to: me })` null dönerse atılır. `g` burada beklenmez.
3. **Kurpiyerde iç ileti:**
   - `k` `join`, `act`, `sync` ya da `leave` değilse atılır.
   - Masa yoksa ya da `x.g !== table.g` ise ve `plainAt[userId]` 5 sn'den eskiyse, o kişiye `close {g: x.g, why:'gone'}` gider.
   - `join`:
     - `table.invites[userId]` var olmalı ve `x.ni === invites[uid].ni` olmalı. Değilse atılır.
     - `x.app === table.app` olmalı.
     - `ph === 'lobby'`: koltuk sayısı 8 ya da `app.MAX_PLAYERS` değerine ulaştıysa `reject {why:'full'}` gider. Değilse koltuk eklenir (`{ id, peerId, ni: x.ni }`), `invites[uid]` silinir, `r++` olur ve bütün koltuklar kirli işaretlenir.
     - `ph !== 'lobby'`: koltuk varsa (geri dönüş) `seat.peerId = peerId`, `seat.ni = x.ni`, `keyIssue = null` olur ve yalnız o koltuk kirli işaretlenir. Koltuk yoksa `reject {why:'started'}` gider.
   - `act`, `sync`, `leave`:
     - Koltuk var olmalı ve `seat.peerId === peerId` olmalı.
     - `o = TelsizGame.seqOrder(lastSeq[uid] || 0, x.seq)`. `'old'` ise atılır. `'repeat'` ise koltuk yalnız kendine özel yanıt için kirli işaretlenir (`onlySelf`) ve çıkılır. `'new'` ise `lastSeq[uid] = x.seq` olur.
     - `leave`: koltuk kaldırılır (4.10.4).
     - `sync`: `seat.ack = { seq, ok: true }`. Yanıt `SYNC_REPLY_MIN_MS` kısmasıyla gider.
     - `act`: aşağıdaki adımlar.
4. **`act` işleme:**
   - `ph !== 'play'` ise `ack {ok:false, code:'game_over'}`.
   - `x.rd !== table.rd` ise `'stale'`.
   - `move = app.validateMove(x.b)` null dönerse `'bad_move'`.
   - Sonra `try { res = app.applyMove(game, uid, move, rng) }`:
     - Başarılıysa `game = res.state`, olaylar `r` ile damgalanıp eklenir (son 8 tutulur), `r++`, `ack {seq, ok:true}`, bütün koltuklar kirli. `app.isOver(game)` ise `ph = 'over'`.
     - `err.code` fırlatırsa `ack {seq, ok:false, code}` olur ve yalnız o koltuk kirli işaretlenir. `r` değişmez.
5. **Oyuncuda `state`:**
   - `userId === table.dealer` ve `peerId === table.dealerPeer` olmalı. Değilse atılır.
   - `x.g === table.g` olmalı. Bilinmeyen `g` atılır, böylece davetsiz koltuk dayatılamaz.
   - `x.ni === my.ni` olmalı.
   - Sürüm kuralı (4.9) uygulanır.
   - `validStateBody` ve uygulama doğrulayıcıları geçmeli.
   - Kabul edilince `lastR = x.r`, `lastAckSeq = b.ack.seq` olur. `mySeq = max(mySeq, b.ack.seq)` olur, yenilenmiş sayfa sayacına buradan devam eder. `pending.seq === b.ack.seq` ise bekleyen hamle sonuçlanır (`ok` değilse `onNotice('error', code)`). `ev` içinde `r > lastSeenEvR` olanlar `onNotice('events')` ile duyurulur.

**`peer-ready`:**
- Kurpiyerde koltuktaki kişi için (`seat.id === userId`):
  1. O peerId'ye `invite` gider (yeni `ni` `invites[uid]` içine yazılır, `ph` güncel).
  2. Koltuk kirli işaretlenir. `seat.peerId === peerId` değilse değişmez, çünkü geri dönüş ancak `join` ile olur.
  3. `retryAt` sıfırlanır.
- Kurpiyerde koltukta olmayan kişi için: engelli değilse `invite` gider.
- Oyuncuda `peerId === table.dealerPeer` ise: bekleyen hamle varsa aynı `seq` ile hemen yeniden gönderilir, yoksa `sync` gider.

**`peer-leave`:**
- Kurpiyerde: `seat.peerId === peerId` ise koltuk kaldırılır. `invites[uid].peerId === peerId` ise davet silinir.
- Oyuncuda: `peerId === table.dealerPeer` ise `ended('dealer_left')`. Saklı davetin kurpiyeri ayrıldıysa davet silinir.

**`reset`:** her şey `none` olur, zamanlayıcılar temizlenir.

### 4.9 Sürümler ve sayaçlar (saf)

```js
  // Kişi sayacı: yeni, tekrar (sonuç yeniden gönderilir) veya eski (atılır)
  function seqOrder (last, seq) {
    if (seq > last) return 'new'
    return seq === last ? 'repeat' : 'old'
  }

  // Oyuncu tarafı: daha eski sürüm atılır, aynı sürüm yalnızca daha yeni bir sayaç sonucu taşıyorsa alınır
  function acceptState (lastR, lastAckSeq, r, ackSeq) {
    if (r > lastR) return true
    return r === lastR && ackSeq > lastAckSeq
  }
```

**Oyuncu sayaç kuralı:** bekleyen bir `act` varken `sync` gönderilmez, yalnız aynı `act` aynı `seq` ile yeniden gönderilir. Aksi hâlde kaybolan `act` daha büyük `seq` taşıyan `sync` ile "işlendi" görünürdü.

`r` şu durumlarda artar: katılma, ayrılma, başlatma, kabul edilen hamle, aşama değişimi, kural seçimi değişimi. Reddedilen hamle `r` değerini değiştirmez.

### 4.10 Gönderim, kısma, canlılık ve sabitler

**4.10.1 Boşaltma (kurpiyer, her yöntemin sonunda `flush()`):** Her kirli koltuk için sırayla:
1. Kurpiyerin kendi koltuğuysa ağ kullanılmaz, yerel model güncellenir.
2. `seat.inflight` doğruysa ya da `now < seat.retryAt` ise beklenir.
3. `seat.onlySelf` doğruysa ve `now - seat.lastReplyAt < SEAT_REPLY_MIN_MS` ise beklenir. Kısma `tick` içinde yeniden denenir.
4. `keys = env.keys(seat.id)` ok değilse `seat.keyIssue = reason` olur ve atlanır.
5. `b` kurulur: `view = app.publicView(game)`, `mine = app.privateView(game, seat.id)`, `ev` son 8 olay.
6. `p = sealInner(dm, {v, ctx, k:'state', g, ch, from: me, to: seat.id, r, ni: seat.ni, b}, keys.pk, keys.sk)`.
7. `code = env.send(seat.peerId, p, done)`:
   - `'ok'`: `inflight = true`, `dirty = false`, `onlySelf = false`, `lastSendAt = now`.
   - `'not_ready'` ya da `'no_peer'`: kirli kalır, koltuk modelde "Bağlantı Bekleniyor" olur.
   - Diğerleri: kirli kalır.
8. `done(res)`:
   - `inflight = false`.
   - `true`: `backoffIdx = 0`.
   - 429, 0 ya da 5xx: `dirty = true`, `retryAt = now + BACKOFF_MS[min(idx, 4)]`, `idx++`.
   - 404: kirli kalır ve `peer-ready` ya da `peer-leave` beklenir.
   - 403: hiçbir şey yapılmaz, ardından `reset` gelir.
   - 400: `onNotice('error', 'send')` bir kez. Kirli kalmaz.
   - Sonra yeniden `flush()`.

Oyuncunun gönderimleri de aynı tek uçuş kuralıyla gider. Oyuncuda tek alıcı vardır.

**4.10.2 Canlılık:**
- Kurpiyer `tick`: oyundaki her koltuk için `now - lastSendAt > KEEPALIVE_MS` ise koltuk kirli işaretlenir.
- Oyuncu `tick`:
  - Bekleyen `act` varsa her `ACK_RESEND_MS` aralığında aynı `seq` ile yeniden gönderilir. `now - pending.at > SLOW_MS` ise modelde `slow = true` olur.
  - `now - lastStateAt > SILENT_SYNC_MS` ise ve bekleyen hamle yoksa `sync` gider (en sık `SYNC_MIN_MS` aralığıyla).
  - `now - lastStateAt > SILENT_END_MS` ise `ended('dealer_lost')`.
  - `joining` durumunda `JOIN_TIMEOUT_MS` aşılırsa `invited` olur.
- Kurpiyer, koltuk sırasının süresi `AWAY_MS` değerini aşınca koltuğu `away` listesine ekler. Bu bir `r` değişikliği sayılmaz, bir sonraki gönderimle gider.

**4.10.3 Kurpiyerin kendi hamleleri:** `act(move)` çağrısı `seq` gerektirmez. `t` değeri `last` ya da `catch` ise `selfQueue` içine `due = now + SELF_DELAY_MS` ile konur ve `tick` içinde uygulanır. Diğerleri hemen 4.8 adım 4 ile uygulanır. Başarısızsa `onNotice('error', code)` çağrılır.

**4.10.4 Koltuk kaldırma (`leave`, `peer-leave`, `removeSeat`):**
- `ph === 'play'` ise `res = app.removePlayer(game, uid, rng)`, olaylar eklenir.
- Koltuk listeden çıkar. `r++` olur. Bütün koltuklar kirli işaretlenir.
- `app.isOver(game)` ise `ph = 'over'`.
- Lobide yalnız koltuk çıkar.
- `lastSeq[uid]` silinmez.

**4.10.5 Sabitler (`TelsizGameDesk` içinde, testler için `TIMES` olarak dışa açılır):**

| Sabit | Değer | Gerekçe |
|---|---|---|
| `JOIN_TIMEOUT_MS` | 10000 | Katılım yanıtı |
| `ACK_RESEND_MS` | 10000 | Taşımanın yaklaşık 7 sn'lik yeniden denemesinden uzun |
| `SLOW_MS` | 8000 | "Kurpiyere ulaşılamıyor" göstergesi |
| `KEEPALIVE_MS` | 15000 | Kurpiyerin boşta tazeleme aralığı |
| `SILENT_SYNC_MS` | 25000 | Bir tazeleme ve pay |
| `SYNC_MIN_MS` | 10000 | Oyuncunun art arda iki `sync` arası |
| `SILENT_END_MS` | 45000 | İki tazeleme ve iki `sync` kaçtıktan sonra |
| `SEAT_REPLY_MIN_MS` | 1000 | Koltuğa özel yanıt |
| `SYNC_REPLY_MIN_MS` | 5000 | `sync` yanıtı |
| `PLAIN_REPLY_MIN_MS` | 5000 | `reject` ve `close {why:'gone'}`, kişi başına |
| `HOLD_JOIN_MS` | 10000 | `loading` anahtarlı `join` |
| `AWAY_MS` | 60000 | "Uzakta" çipi |
| `BACKOFF_MS` | `[2000, 4000, 8000, 16000, 30000]` | 429 sonrası |
| `INVITE_NOTIFY_MIN_MS` | 30000 | Aynı kurpiyerden davet bildirimi |
| `SELF_DELAY_MS` | 300 | Kurpiyerin kendi `last` ve `catch` hamlesi |
| `MAX_EVENTS` | 8 | `state.b.ev` |

### 4.11 Yeniden bağlanma ve yenileme senaryoları

| Senaryo | Kodda ne olur [D] | Protokolün yanıtı |
|---|---|---|
| ICE yeniden başlatma, aynı sid | Eş kapanmaz, sinyal yolu sunucudan geçmeye devam eder | Etkisi yok |
| Yeni bağlantı, aynı peerId, yeni sid | `closePeer(peer, 'reconnect')`, yeni eş, `afterStable` içinde `peer-ready` [D] 3140-3145, 3203-3207 | Eski sid ile yolda kalan iletiler atılır. `peer-ready` olayında kurpiyer `invite` ve `state` gönderir, oyuncu bekleyen hamlesini ya da `sync` gönderir |
| Oyuncu sayfayı yeniler ve ses odasına yeniden katılır | Aynı oturum, aynı peerId, `voiceJoin` hiçbir şeyi değiştirmez [D] src/hub.js:630-634. Katılan taraf herkese teklif gönderir [D] voice.js:5453. Diğerlerinde yeni sid ve `peer-ready` olur | Kurpiyer `invite {ph:'play', seats içinde o kişi, ni}` gönderir. Yeni sayfada "Oyuna Dön" çıkar. Kişi onaylarsa `join {ni}` gider, kurpiyer `seat.ni` değerini günceller ve tam durumu yollar. `ack.seq` değeri yeni sayfanın sayacını taşır |
| Oyuncu yeniler ama ses odasına dönmez | Kişi kadroda "hayalet" olarak kalır, `peer-leave` gelmez. Yeni sayfa sinyalleri atar, çünkü seste değildir [D] voice.js:3424 | Sıra ondaysa 60 sn sonra "Uzakta" çipi çıkar. Kurpiyer "Koltuktan Çıkar" ile kaldırır |
| Kurpiyer yeniler ve ses odasına döner | Oyuncularda kurpiyer peerId'si için `peer-ready` olur | Oyuncu `sync` ya da bekleyen hamlesini gönderir. Yeni kurpiyer sayfasında masa yoktur, `close {why:'gone'}` ile yanıt verir. Oyuncu `ended('dealer_left')` gösterir |
| Kurpiyer yeniler ve dönmez | Hayalet | Oyuncu 25 sn sonra `sync` gönderir, 45 sn sonra `ended('dealer_lost')` olur |
| Cihaz değişimi (aynı kişi başka cihazdan katılır) | Eski oturum sesten çıkarılır [D] src/hub.js:624-628. Diğerlerinde eski peerId için `peer-leave` olur | Oyuncuysa koltuğu kalkar, kartları desteye döner. Kurpiyerse oyun biter |
| 40 sn sessiz düşme | Oturum etkin sayılmaz [D] src/hub.js:99-101, sesten çıkar [D] src/hub.js:187-194 | `peer-leave` |
| Sunucu yeniden başlar | Herkes sesten düşer | `reset` |
| Sunucu kuyruğu taşar | En eski iletiler atılır [D] src/hub.js:794 | Tam durum ve canlılık kuralları kaybı onarır |

### 4.12 Tek masa kuralı

- Oyuncu bir başka masanın davetini saklar (`desk.seen`: odadaki her kurpiyer için son geçerli davet). Saklı ve canlı bir davet varken Oyun düğmesi "Masa Kur" açmaz, "Masaya Bak" ya da "Oyun Sürüyor" olur.
- Kurpiyer lobideyken başka bir kurpiyerden `invite` alırsa:
  - Gelen davet `ph:'play'` ya da `ph:'over'` taşıyorsa, veya
  - ikisi de lobideyse ve `gelen.g < benim.g` ise:
  - kendi masasını `close {why:'superseded'}` ile kapatır ve gelen daveti `invited` olarak gösterir.
- Oyundaki bir kurpiyer başka davetleri saklar ama hiçbir şey yapmaz.
- `superseded` ile masası kapanan oyuncu, saklı bir davet varsa onu gösterir.

### 4.13 Hata ve neden kodları

| Kod kümesi | Değerler | i18n |
|---|---|---|
| Hamle sonucu (`ack.code`) | Uygulamanın `ERRORS` listesi, ayrıca masa düzeyinde `game_over`, `stale`, `bad_move` (bunlar Renk `ERRORS` listesinde de var) | `game.renk.err.<kod>` |
| Anahtar nedeni | `locked`, `blocked`, `gone`, `loading`, `unverified`, `changed` [D] 15-dm.js:184-200 | `game.reason.<neden>` |
| Kurpiyerin gördüğü alıcı anahtar sorunu (`invite.key`) | `unverified`, `changed`, `gone`, `loading` | `game.reason.peer_<neden>` |
| `reject.why` | `full`, `started`, `closed`, `keys` | `game.reject.<why>` |
| Masa bitişi | `dealer_left`, `closed`, `superseded`, `dealer_lost`, `removed`, `keys`, `reset` | `game.ended.<neden>` |
| Lobi çipi (yalnız kurpiyer) | `dealer`, `waiting`, `joined`, `declined`, `cannot`, `blocked`, `full`, `away`, `offline`, `keys` | `game.status.<durum>` |

### 4.14 Hız bütçesi

Kullanıcı başına 120 istek / 10 sn, WebRTC ile ortak [D] src/app.js:99-100, 3318. Reddedilen istek bütçeden düşmez [D] src/auth.js:624-629. N = 8 koltuk, M = odadaki kişi sayısı.

| Olay | Kurpiyerin gönderdiği | Oyuncunun gönderdiği |
|---|---|---|
| Masa açma | M-1 davet | yok |
| Katılım (her biri) | Koltuk sayısı - 1 kadar durum | 1 `join` |
| Başlatma | 7 durum + M-8 davet | yok |
| Hamle (kurpiyerin kendisi dahil) | 7 durum | 1 `act` |
| Reddedilen hamle | 1 durum (koltuk başına 1 sn kısmalı) | 1 |
| Boşta tazeleme | koltuk başına 15 sn'de 1, en çok 4,7 / 10 sn | yok |
| Yeniden bağlanma | eş başına 1 davet ve 1 durum | 1 `sync` ya da hamle |

- Olağan oyun (3 sn'de bir hamle): yaklaşık 23 / 10 sn.
- Hızlı oyun (saniyede bir hamle): yaklaşık 70 / 10 sn.
- Tek uçuş kuralı her koltuğa en çok bir bekleyen istek bırakır. 429 yanıtında kurpiyer kendiliğinden yavaşlar ve ara durumlar atlanır. Olaylar `ev` listesiyle yine duyurulur.
- En kötü an: kurpiyerin 7 bağlantısı yeniden kurulursa yaklaşık 7 teklif, 70 ICE adayı, 7 davet ve 7 durum, toplam yaklaşık 91 istek eder. Sınırın altında ama dar. Risk olarak yazıldı (11. bölüm).

### 4.15 Tehdit tablosu

| Saldırgan | Yapabildiği | Koruma |
|---|---|---|
| S1: odada, dürüst olmayan üye | Kendi adına ileti | Kurpiyer her hamleyi motorla doğrular. `seq`, `rd`, `step` bayat ve tekrarlanan hamleyi düşürür. Kısmalar bütçe saldırısını sınırlar |
| S2: frekans üyesi, odada değil | Hiçbir şey (`not_in_voice`) | Sunucu [D] src/hub.js:788-797 |
| S3: sunucuyu işleten ve grup anahtarını bilen üye | Dış zarfı açar, `from` ve kadroyu sahteler, ileti düşürür, düz iletileri (`invite`, `decline`, `reject`, `close`) uydurur, eski iç zarfları yeniden oynatır | İç zarf: S3 elleri okuyamaz ve hamle uyduramaz. `ni`, `seq`, `rd`, `r`, `from`, `to`, `g`, `ch` bağları yeniden oynatmayı önler. Düz iletilerin sahtesi hizmet engeli kadar etki yapar. İlk görüşte sabitlenen anahtarlara karşı ortadaki adam saldırısı yalnız güvenlik numarası karşılaştırmasıyla yakalanır [D] docs/MIMARI.md "## Sınırlar" Özel mesajlar paragrafı |
| Kurpiyer | Bütün elleri bilir ve hile yapabilir | Önlenmez (karar 3). Arayüzde yazılır. Oyuncunun cihazı yalnız tutarlılığı denetler (toplam 108, kendi el sayısı, alan biçimleri) |

---

## 5. Kural motoru (`35-renk-kural.js`, `window.TelsizRenk`)

### 5.1 Genel uygulama sözleşmesi

`34-oyun-masa.js` her uygulamayı bu yüzle çağırır. Pişti, Dört Taş ve XOX aynı yüzü uygular.

```
id: 'renk', VERSION: 1, MIN_PLAYERS: 2, MAX_PLAYERS: 8
RULES: ['official', 'stack'], DEFAULT_RULES: 'official'
HIDDEN: true                      // yalnız güven metnini seçer (Y7)
ERRORS: [...], EVENTS: [...]
newGame({ rules, players, dealSeat }, rng) -> { state, events }      // err.code fırlatabilir
validateMove(raw) -> move | null
applyMove(state, id, move, rng) -> { state, events }                 // err.code fırlatır, girdiyi değiştirmez
removePlayer(state, id, rng) -> { state, events }
endGame(state) -> { state, events }
isOver(state) -> bool
turnOf(state) -> id | null
publicView(state) -> view
privateView(state, id) -> mine | null
validateView(view, seatIds) -> view | null
validatePrivate(mine, view, id) -> mine | null
legalMoves(view, mine, id) -> seçenekler
```

Ek olarak Renk'e özgü olanlar: `buildDeck`, `isCard`, `parseCards`, `cardColor`, `cardValue`, `isWild`, `points`, `canPlay`, `validateState`, `dealFrom(opts, deck, rng)` (test kancası).

Saflık kuralları:
- DOM, ağ, saat, `t()`, `Math.random`, `Date`, `setTimeout` ve `structuredClone` kullanılmaz.
- Kopyalama elle yazılır.
- Kullanıcıya görünen metin üretilmez.
- Rastgelelik yalnız `rng(n)` ile gelir. Kurpiyerde bu `window.nacl.randomBytes` olur. nacl [D] index.html:34 satırında yüklenir.
- `rng` çıktısı dizi benzeri kabul edilir (`length`, 0-255 tamsayılar), `instanceof Uint8Array` kullanılmaz (vm bölge farkı).

Dosya iskeleti:

```js
'use strict'

// Renk kural motoru (window.TelsizRenk). DOM, ağ, saat ve sözlük kullanmaz, kullanıcıya görünen metin üretmez.
// Hatalar err.code ile, olaylar kodla verilir, arayüz game.renk.* anahtarlarıyla çevirir.
window.TelsizRenk = (function (G) {
  const VERSION = 1
  // ...
  return Object.freeze({ /* 5.1 */ })
})(window.TelsizGame)
```

### 5.2 Kartlar

- `CARD_RE = /^(?:[RYGB][0-9SVD]|W[WF])$/`
- Değer harfleri:
  - `0`-`9` sayı.
  - `S` Engel (sonraki atlanır).
  - `V` Yön (yön döner).
  - `D` +2.
  - `WW` Joker.
  - `WF` Joker +4.
- `cardColor(c)`: `'R'`, `'Y'`, `'G'`, `'B'`, Jokerlerde `null`.
- `cardValue(c)`: `c[1]`. Değerler benzersizdir: `0-9 S V D W F`.
- `points(c)`: sayı kendi değeri, `S`, `V` ve `D` için 20, `WW` ve `WF` için 50.
- `parseCards(list)`: dizi, en çok 108 öğe, her öğe `isCard`. Değilse `null`.

### 5.3 Deste ve rastgelelik

**`buildDeck()` kanonik sırası:**
1. `R, Y, G, B` sırasıyla her renk için: `C0`, sonra `C1 C1 C2 C2 ... C9 C9`, sonra `CS CS CV CV CD CD`. Renk başına 25 kart.
2. Ardından 4 `WW` ve 4 `WF`.
3. Toplam 108.

Bu sıra sabittir, çünkü ileride denetlenebilir karıştırmada herkes desteyi yeniden hesaplayacak.

**`TelsizGame` içindeki rastgelelik yardımcıları:**
- `byteSource(rng)`:
  - 64 baytlık parçalar ister.
  - Uzunluk 64 değilse ya da bir öğe 0-255 tamsayısı değilse `bad_random` fırlatır.
  - `rng` hata fırlatırsa `no_random` fırlatır.
- `randomBelow(next, m)`, `1 <= m <= 65536`:
  - Uzay `m <= 256` ise 256, değilse 65536 (iki bayt).
  - `limit = uzay - uzay % m`.
  - `v < limit` ise `v % m` döner, değilse yeniden okunur.
  - 1000 ardışık red olursa `bad_random` fırlatır.
- `shuffle(list, rng)`: Durstenfeld biçiminde Fisher-Yates. Girdiyi değiştirmez.
- `ring(n, from, dir, steps)`: `((from + dir * steps) % n + n) % n`.

Karıştırmanın gerektiği yerler: yeni el, ilk kart `WF` çıkınca, çekme destesi bitince, oyuncu ayrılınca.

### 5.4 Tam durum (yalnız kurpiyerde)

```js
{
  v: 1,
  rules: 'official',              // 'official' | 'stack'
  seats: [{ id: '12', hand: ['R5', 'WW'] }],   // masanın koltuk sırası
  dealSeat: 0,                    // dağıtan koltuğun dizini
  turn: 1,                        // sırası gelen koltuk dizini, over iken -1
  dir: 1,                         // 1 koltuk sırası, -1 ters
  deck: ['G3'],                   // çekme destesi, üst = son öğe
  discard: ['R1'],                // atılanlar, üst = son öğe
  color: 'R',                     // etkin renk, yalnız phase 'color' iken null
  phase: 'play',                  // 'color' | 'play' | 'drawn' | 'over'
  drawn: null,                    // phase 'drawn' iken çekilen kart
  pending: null,                  // yalnız 'stack': { k: 'D' | 'F', n: 6 }
  last: null,                     // { p: '12', safe: false } açık Tek! penceresi
  step: 0,                        // her geçerli tur hamlesinde artar
  result: null                    // 5.13
}
```

**Değişmezler** (`validateState` denetler, testler her adımda çağırır):
- Ellerin, destenin ve atılanların toplamı her zaman 108.
- `phase !== 'over'` iken:
  - Her elde en az 1 kart.
  - `discard` boş değil.
  - `0 <= turn < seats.length`.
  - `2 <= seats.length <= 8`.
- `color === null` ancak `phase === 'color'` ise.
- `pending` yalnız `rules === 'stack'` iken dolu olabilir.
- `drawn` yalnız `phase === 'drawn'` iken doludur ve sıradaki elde bulunur.

### 5.5 Yeni el

**`validateOptions`:**
- `rules` `RULES` içinde.
- `players` 2-8 benzersiz `isId`.
- `dealSeat` 0 ile `players.length - 1` arası tamsayı.
- Değilse `bad_options`.

**Dağıtım:**
- `deck = shuffle(buildDeck(), rng)`.
- 7 tur boyunca `ring(n, dealSeat, 1, 1)` koltuğundan başlanır, koltuk sırasıyla her oyuncuya `deck.pop()` verilir.
- `left = ring(n, dealSeat, 1, 1)`.

**İlk kart:** `deck.pop()`, `discard.push`.

| İlk kart | Sonuç |
|---|---|
| Sayı | `turn = left` |
| `S` | `left` atlanır: `turn = ring(n, dealSeat, 1, 2)`, `skip` olayı |
| `V`, n >= 3 | `dir = -1`, `turn = dealSeat`, `reverse` olayı |
| `V`, n = 2 | Engel gibi davranır: `turn = dealSeat`, `dir` 1 kalır |
| `D` | `left` 2 kart çeker ve atlanır: `turn = ring(n, dealSeat, 1, 2)`. İki sette de aynıdır, bu karta ekleme yapılmaz |
| `WW` | `phase = 'color'`, `color = null`, `turn = left` |
| `WF` | Desteye geri konur, bütün deste karıştırılır, yeni kart açılır, `reflip` olayı. En çok 16 kez, sonra `bad_random` |

Dönüş `{state, events}`. `step` 0'dır.

### 5.6 Hamleler ve denetim sırası

`validateMove` (`onlyKeys` ile katı):

| `t` | Alanlar | Tür |
|---|---|---|
| `play` | `c` (kart), `col` (yalnız `WW` ve `WF` ile izinli), `last` (true, isteğe bağlı), `step` | tur |
| `draw` | `step` | tur |
| `pass` | `step` | tur |
| `color` | `col`, `step` | tur |
| `last` | yok | sıra dışı |
| `catch` | `p` (yakalanan kimlik) | sıra dışı |

Ek kurallar: `col` `R`, `Y`, `G` ya da `B` olmalı. Joker olmayan kartla `col` gönderilirse `null` döner (`bad_move`). `last` alanı yalnız `true` olabilir.

**`applyMove` denetim sırası.** Testler bu önceliğe dayanır:
1. `phase === 'over'`: `game_over`.
2. `validateMove(move)` null dönerse: `bad_move`.
3. `id` koltuklarda yoksa: `bad_player`.
4. `last`: `state.last && state.last.p === id && !state.last.safe` değilse `no_last`.
5. `catch`: önce `move.p === id` ise `self_catch`. Sonra `!(state.last && state.last.p === move.p && !state.last.safe)` ise `not_catchable`.
6. Tur hamleleri:
   - Sıra bu oyuncuda değilse: `not_your_turn`.
   - `move.step !== state.step`: `stale`.
   - `color`: `phase !== 'color'` ise `bad_move`.
   - `pass`: `phase !== 'drawn'` ise `cannot_pass`.
   - `draw`: `phase === 'color'` ise `choose_color`, `phase === 'drawn'` ise `already_drawn`.
   - `play`, sırasıyla:
     - `phase === 'color'`: `choose_color`.
     - Kart elde değil: `not_in_hand`.
     - `phase === 'drawn'` ve `c !== drawn`: `only_drawn`.
     - Ceza bekliyor ve kart eklenemez: `must_stack`.
     - Eşleşmiyor: `not_playable`.
     - `c === 'WF'`, ceza beklemiyor ve elde `cardColor === color` olan kart var: `wild4_has_color`.
     - Joker, elde kart kalacak ve `col` yok: `need_color`.
7. Hamle geçerliyse:
   - Tur hamlesinde önce `last = null` olur, sonra hamle uygulanır, `step++` olur.
   - Sıra dışı hamlelerde `step` değişmez. Böylece o sırada gönderilmiş bir tur hamlesi bayatlamaz.

İşlem kopya üzerinde yapılır. Hata fırlatılınca girdi değişmez.

**`canPlay(view, mine, id, code)`** (6. adımdaki `play` kurallarının görünüm üzerinde çalışan hâli):
- Kurpiyer `applyMove` içinde `canPlay(publicView(s), privateView(s, id), id, code)` çağırır. Oyuncunun arayüzü de aynı işlevi kullanır. Tek doğruluk kaynağı budur.
- Görünümde `drawn` aşaması `play` olarak göründüğü için `canPlay` aşamayı `mine.drawn` alanından okur.
- Bağımsız bir kâhin test bu işlevi denetler (8.4).

### 5.7 Etkiler

| Kart | Resmî | Üst üste ekleme |
|---|---|---|
| Sayı, `WW` | `turn = ring(n, turn, dir, 1)` | aynı |
| `S` | Sonraki atlanır: `ring(..., 2)`, `skip` olayı | aynı |
| `V`, n >= 3 | `dir *= -1`, sonra `ring(..., 1)`, `reverse` olayı | aynı |
| `V`, n = 2 | Engel gibi: `ring(..., 2)`, yani oynayan yeniden oynar. `dir` değişmez | aynı |
| `D` | Sonraki 2 kart çeker ve atlanır (`penalty` `why:'D'` ve `skip`). `pending` boş kalır | `pending = {k:'D', n: önceki + 2}`, `turn = ring(..., 1)` |
| `WF` | `color = col`, sonraki 4 kart çeker ve atlanır (`penalty` `why:'F'` ve `skip`) | `pending = {k:'F', n: önceki + 4}`, `color = col`, `turn = ring(..., 1)` |

Joker oynanınca `color = col` olur. Renkli kart oynanınca `color = cardColor(c)` olur. "2 kişide Yön, Engel gibi davranır" kuralı o anki koltuk sayısına göre uygulanır.

### 5.8 Çekme

- **Ceza beklemezken `draw`:**
  - 1 kart çekilir. `draw` olayı yalnız sayıyı taşır.
  - Kart `canPlay` ile oynanabilirse (çekilen kart da elde sayılır) `phase = 'drawn'`, `drawn = kart` olur, sıra oyuncuda kalır.
  - Oynanamıyorsa `turn = ring(..., 1)` olur.
- **`pass`:** `phase = 'play'`, `drawn = null`, `turn = ring(..., 1)`, `pass` olayı.
- **Elde oynanabilir kart varken çekmek serbesttir.**
- **Deste boşsa:**
  - Atılanlardan üstteki ayrılır, kalanlar `shuffle` ile deste olur, `reshuffle {n}` olayı.
  - İkisi de boşsa `draw` "pas" sayılır, `nodraw` olayı yayılır ve sıra geçer.
  - Ceza çekimlerinde var olan kadar kart verilir. `penalty` olayında `n` (verilen) ve `want` (istenen) birlikte gider.
- **Kilitlenme olmaz:**
  - Deste ve atılanlar boşsa, üstteki kart dışındaki 107 kartın hepsi eldedir. Bu durumda Joker hep oynanabilir.
  - Ceza bekleyen oyuncu `draw` ile cezayı kapatır.

### 5.9 Üst üste ekleme

- `pending` dolu ve sıra o oyuncudaysa yalnız iki şey yapılabilir:
  - Aynı türü eklemek: `k:'D'` iken herhangi bir `xD`, `k:'F'` iken `WF` ve `col`. `WF` eklerken renk kısıtı aranmaz, çünkü ceza beklerken renkli kart zaten oynanamaz.
  - `draw`: toplam çekilir (`penalty` `why:'stack'`), `pending = null`, sıra geçer. `drawn` aşaması açılmaz.
- Başka her kart `must_stack` döndürür. `D` üstüne `WF` ve `F` üstüne `D` de `must_stack` döndürür.
- Resmî sette `pending` hiç dolmaz.

### 5.10 Tek! (`last`)

- `LAST_CARD = { official: true, stack: true }`. Bir set için `false` olursa pencere hiç açılmaz ve `last` ile `catch` hamleleri `no_last` ya da `not_catchable` döner.
- **Açılış:** bir `play` sonrası oynayanın elinde 1 kart kalırsa `last = { p: id, safe: move.last === true }` olur. `move.last` başka durumlarda yok sayılır. Yersiz bildirime ceza yoktur.
- **Geç bildirim:** `{t:'last'}` hamlesi `safe = true` yapar, `last` olayı `late: true` ile yayılır.
- **Yakalama:** `{t:'catch', p}`:
  - `p` dışındaki herkes gönderebilir, sırası olmasa da.
  - `p` 2 kart çeker (`caught {p, by}` ve `penalty` `why:'last'`), `last = null` olur.
  - Yanlış yakalamaya ceza yoktur.
- **Kapanış:** sıradaki ilk geçerli tur hamlesiyle pencere kapanır, hamleyi kim yaparsa yapsın.
  - Resmî +2 ile tek karta düşen oyuncu için pencere, atlanan oyuncudan sonraki oyuncunun hamlesine kadar açık kalır.
  - 2 kişide Engel ile tek karta düşenin penceresini kendi sonraki hamlesi kapatır. Bu belgeye yazılır.
- **Yarış:** Tek! ve Yakala kurpiyere varış sırasıyla değerlendirilir. Kurpiyerin kendi hamlesi 300 ms gecikmeyle işlenir (4.10.3).

### 5.11 Joker +4 kısıtı

- Ceza beklenmiyorsa ve elde `cardColor(c) === view.color` olan bir kart varsa `WF` oynanamaz (`wild4_has_color`).
- Başka renkteki aynı sayı ya da simge bu kısıtı tetiklemez. Eldeki `WW` da tetiklemez.
- Son kart `WF` ise her zaman oynanabilir.
- Üst üste eklemede ceza `F` iken kısıt aranmaz.
- **İtiraz adımı yoktur.** Kurallar panelinde `game.renk.wild4Rule` metni gösterilir.

### 5.12 Oyuncu ayrılınca: `removePlayer(state, id, rng)`

Ayrılan koltuk `k`, kalan oyuncu sayısı `n'` olsun.

| Konu | Davranış |
|---|---|
| Kartlar | Çekme destesine eklenir ve **bütün deste yeniden karıştırılır**, `leave {p, n}` olayı. Kartlar alta eklenseydi bilinen bir sırayla gelirdi |
| `k < turn` | `turn -= 1` |
| `k > turn` | değişmez |
| `k === turn`, `dir 1` | `turn = k % n'` |
| `k === turn`, `dir -1` | `turn = (k - 1 + n') % n'` |
| `k === turn` | `drawn` boşaltılır. Aşama `color` ise `color` aşaması sürer ve renk seçimi sıradakine geçer, değilse aşama `play` olur. `pending` düşer (`pending_dropped {n}`). `step++` |
| `k !== turn` ve `pending` dolu | `pending` sıradaki kişiye ait olduğu için korunur |
| `last.p === id` | Pencere kapanır |
| `dealSeat` | `k < dealSeat` ise 1 azalır. `k === dealSeat` ise yöne göre sonraki koltuk olur |
| `n' < 2` | `phase = 'over'`, `result = { reason: 'too_few', winner: null, ... }` |
| Oyun bitmişse | Koltuk silinir, kartlara dokunulmaz. `result.ranks` değişmez (sıralamada artık koltukta olmayan kimlik bulunabilir) |

### 5.13 Bitiş ve puan

- `play` oyuncunun elini boşaltırsa:
  1. Son kart `D` ya da `WF` ise sıradaki oyuncu önce çeker. Resmî sette 2 ya da 4, eklemede `pending.n + 2` ya da `+ 4`.
  2. `phase = 'over'`, `turn = -1` olur.
  3. `result` hesaplanır.
- `endGame(state)` (kurpiyerin Oyunu Bitir düğmesi): `reason: 'ended'`, `winner: null`.

```js
result: {
  reason: 'out',     // 'out' | 'too_few' | 'ended'
  winner: '12',      // 'out' değilse null
  total: 113,        // kazananın aldığı puan, 'out' değilse 0
  ranks: [{ id: '12', n: 0, points: 0, rank: 1 }, { id: '7', n: 2, points: 10, rank: 2 }]
}
```

- Kazanan birinci sıradadır. Diğerleri puana göre artan sırada dizilir, eşit puan aynı sırayı alır (1, 2, 2, 4).
- Eldeki kartlar sonuçta yer almaz.

### 5.14 Görünümler

`publicView(s)`:

```js
{ v, rules, seats: [{ id, n }], turn: id | null, dir, top: 'R1', color, deck: 40, discard: 3,
  phase: 'color' | 'play' | 'over',    // 'drawn' burada 'play' görünür
  pending, last, step, result }
```

`privateView(s, id)`: `{ cards: [...], drawn: kod | null }`. `drawn` yalnız o kişi `drawn` aşamasındaysa doludur.

`validateView(v, seatIds)`:
- Yalnız bilinen alanlar.
- `seats` kimlikleri `seatIds` ile aynı ve aynı sırada.
- `n` 0-108 aralığında.
- `turn` koltuklardan biri ya da `over` iken null.
- `top` geçerli kart.
- `color` `R`, `Y`, `G`, `B` ya da (`phase === 'color'` iken) null.
- `pending` yalnız `stack` setinde, `n` 2 ile 108 arası çift sayı, `k` `D` ya da `F`.
- `last.p` koltuklardan biri.
- `sum(n) + deck + discard === 108`.
- `result` biçimi doğru.

`validatePrivate(m, v, id)`:
- `cards.length` görünümdeki kendi `n` değerine eşit.
- Her kart `isCard`.
- `drawn` null ya da `cards` içinde.
- `top` kendi elimde olabilir, çünkü aynı koddan iki kart bulunur. Bu yüzden "üst kart elde değil" denetimi yapılmaz.

### 5.15 `legalMoves(view, mine, id)`

```js
{
  turn: true,                 // sıra bende
  phase: 'play' | 'color' | 'over',
  drawn: 'G7' | null,
  play: ['R5', 'WW'],         // oynanabilir benzersiz kodlar
  blocked: { WF: 'wild4_has_color', B7: 'not_playable' },   // her elde olup oynanamayan kod için neden
  draw: true,                 // Kart Çek ya da {count} Kart Al
  take: 0,                    // biriken ceza (yalnız eklemede)
  pass: false,
  color: false,               // ilk kart Joker: Renk Seç
  armLast: false,             // sıra bende, 2 kartım var ve en az biri oynanabilir
  last: false,                // geç Tek! yapılabilir
  catch: null                 // Yakala hedefi (kimlik)
}
```

Joker oynanacaksa ve `mine.cards.length > 1` ise renk seçici açılır.

### 5.16 Olaylar

Hepsi `{ e, ... }` biçimindedir. Çekilen kartın kodu hiçbir olayda geçmez.

| `e` | Alanlar |
|---|---|
| `play` | `p`, `c`, `col` |
| `draw` | `p`, `n` |
| `nodraw` | `p` |
| `pass` | `p` |
| `color` | `p`, `col` |
| `skip` | `p` (atlanan) |
| `reverse` | `dir` |
| `penalty` | `p`, `n`, `want`, `why` (`'D'`, `'F'`, `'stack'`, `'last'`) |
| `last` | `p`, `late` |
| `caught` | `p`, `by` |
| `reshuffle` | `n` |
| `reflip` | yok |
| `leave` | `p`, `n` |
| `pending_dropped` | `n` |
| `end` | `winner`, `total`, `reason` |

### 5.17 Hata kodları

`ERRORS` = `bad_options`, `bad_random`, `no_random`, `bad_move`, `bad_player`, `game_over`, `not_your_turn`, `stale`, `choose_color`, `not_in_hand`, `only_drawn`, `must_stack`, `not_playable`, `wild4_has_color`, `need_color`, `already_drawn`, `cannot_pass`, `no_last`, `self_catch`, `not_catchable`.

Arayüzün davranışı:

| Kodlar | Davranış |
|---|---|
| `bad_move`, `bad_player`, `game_over`, `not_your_turn`, `stale`, `not_in_hand`, `already_drawn`, `cannot_pass`, `no_last`, `self_catch` | Sessiz. Gelen yeni durum arayüzü düzeltir |
| `choose_color`, `only_drawn`, `must_stack`, `not_playable`, `wild4_has_color`, `not_catchable` | Panel içi durum satırında kısa metin ve polite duyuru |
| `need_color` | Renk seçici açılır |
| `bad_options`, `bad_random`, `no_random` | Kurpiyerde "Oyun Başlatılamadı" ve metin |

---

## 6. Arayüz

### 6.1 Görünüm modeli (`desk.model()`)

```
{
  rev,                         // her değişiklikte artar (çizim anahtarı)
  role: 'none' | 'dealer' | 'player',
  stage: 'none' | 'setup' | 'invited' | 'rejoin' | 'busy' | 'joining' | 'lobby' | 'play' | 'over' | 'rejected' | 'ended',
  app: 'renk', g, dealer, me, rules, rd,
  seats: [{ id, away, offline, keyIssue }],     // keyIssue yalnız kurpiyerde
  room: [{ id, status, key }],                  // yalnız kurpiyerde (Masa Kur ve lobi)
  invite: { dealer, ph, rules, seats, key, myKey } | null,
  pending: { seq, at } | null, slow: bool, syncing: bool,
  view, mine, legal,           // legal = app.legalMoves(view, mine, me)
  ack, newEvents: [...],       // bu modelden beri gelen olaylar
  ended: { reason } | null, rejected: { why } | null, error: kod | null
}
```

### 6.2 Telsiz kartındaki Oyun düğmesi (`gameRenderTool`, 36-oyun.js)

- **Öğe:** `button#radio-game.radio-tool.game-tool[data-focus-key="tool-game"][aria-controls="cast"]`. İçinde `icon('i-gamepad', 'radio-tool-icon')` [D] index.html:151, `span.radio-tool-label` ve gerekirse `span.radio-tool-count` rozeti bulunur. Biçim mevcut `.radio-tool` sınıfından gelir.
- **Yer:** `box.insertBefore(btn, box.querySelector('.crew-dj'))`. `.crew-dj` yoksa `appendChild` kullanılır. Düğme yalnız yanlış yerdeyse taşınır, taşınırken odaktaysa odak geri verilir.
  - Büyüt kendini başa koyar [D] 10-voice.js:615.
  - DJ kendini sona taşır [D] 23-dj.js:1005-1009.
  - Sıra kendiliğinden Büyüt, Oyun, DJ olur.
  - e2e/05:63 ve e2e/06:131 DJ'nin son öğe olmasını bekliyor, bu da korunur.
- **Gizlenir:**
  - Seste değilken ya da bağlanırken.
  - `s.private` ya da `inCallRoom(s)` doğruyken [D] 10-voice.js:239.
  - `voice.sendGame` yoksa.
  - Kayıtlı uygulama arayüzü yoksa. Uygulama sırasının 6. adımında düğme bu sayede görünmez kalır.
- **Durumlar:**

| Koşul | Etiket | Erişilebilir ad | Sınıf |
|---|---|---|---|
| Masa ve davet yok | `game.tool` | `game.toolLabel` | |
| Davet var (`invited`, `rejoin`) | `game.toolInvite` | `game.toolInviteLabel` | `.is-invited`, rozet "1" |
| Başka masa sürüyor (`busy`) | `game.toolBusy` | `game.toolBusyLabel` | `.is-busy`, `aria-disabled="true"` ama odaklanabilir. Basınca bilgi lobisi açılır |
| Masadayım, sahne kapalı ya da küçük | `game.toolBack` | aynı | |
| Masadayım, sıra bende, sahne görünmüyor | `game.toolTurn` | aynı | `.is-turn`, rozet "!" |
| Sahne açık ve oyun kipinde | `game.minimize` | `game.minimizeLabel` | `aria-expanded="true"` |

- Dar ekranda (759 px altı) etiket görsel olarak gizlenir (klip kalıbı), simge ve rozet kalır [V].

### 6.3 Akış

**Kurpiyer:**
1. Oyun düğmesine basar. `desk.openSetup('renk')` ve `gameOpenStage(true)` çağrılır.
2. **Masa Kur** ekranında şunlar bulunur:
   - Oyun adı ve kısa açıklama.
   - "Kurallar" `role="radiogroup"`, `castChoiceGroup` kalıbıyla [D] 22-cast.js:1208. Varsayılan Resmî, her seçeneğin altında açıklama metni.
   - "Odadakiler" listesi: `voiceRoster(channelId)` sırasıyla [D] 10-voice.js:184-189. Her kişi için `profilesEnsure` çağrılır, `dmSendState` değerlendirilir ve çip gösterilir (Engellediniz, Katılamaz ve nedeni, Yükleniyor).
   - Güven notu (`game.trustDealer`).
   - [İptal] ve [Masa Aç] düğmeleri.
   - Kurpiyerin kendi kimliği kilitliyse Masa Aç pasiftir ve `game.setupLocked` yazar.
3. **Masa Aç**: lobi görünümüne geçilir. Başlık `game.lobbyTitle`, üst bilgi "Kurpiyer Sizsiniz · 3 Oyuncu". Kural seçimi düzenlenebilir kalır.
4. Koltuk listesi ve her satırda çip bulunur. Koltuktaki diğer kişilerin satırında "Koltuktan Çıkar" düğmesi vardır.
5. Altta güven notu, `game.startHint` (2 kişiden azsa), [Masayı Kapat] [Başlat].
6. **Başlat**: masa görünümüne geçilir.
7. **`over`**: Sonuçlar görünür. Kurpiyerde [Masayı Kapat] [Yeni El], oyuncuda [Masadan Ayrıl] ve `game.waitNewRound`.

**Oyuncu:**
1. Davet gelince Oyun düğmesi "Davet" olur, Bildirimler listesine `kind:'game'` kaydı düşer ve polite duyuru yapılır (`game.sr.invited`). Bunların hepsi `INVITE_NOTIFY_MIN_MS` ile kısılır. Odak alınmaz.
2. Masaya Bak ya da düğme ile sahne açılır. Görünenler:
   - `game.inviteText`.
   - Kural seti ve açıklaması.
   - Oturanların adları.
   - Güven notu (`game.trustPlayer`), Katıl düğmesinin hemen üstünde ve her zaman görünür.
   - [Reddet] [Katıl].
3. Anahtar sorunu varsa (kendi `dmSendState(dealer)` sonucu ya da `invite.key`) Katıl yerine `i-alert` simgesi ve neden metni görünür, yalnız [Kapat] bulunur.
4. Katıl'dan sonra `game.waitingStart`. Reddet'ten sonra sahne kapanır. Lobi sürdükçe düğme "Davet" kalır ve yeniden açılabilir.
5. "Oyuna Dön" (`rejoin`): `game.rejoinText` ve [Kapat] [Oyuna Dön].

**Bitiş ekranları:**
- `ended`: neden metni ve [Kapat]. Kapat'a basınca sahne kapanır, odak `#radio-game` düğmesine gider.
- `reset`: sahne sessizce kapanır. Tam ekran değilse `toast(t('game.ended.reset'))` gösterilir.

### 6.4 Sahne kipi (`22-cast.js`)

1. **Kip seçimi (238):**

```js
  const game = inVoice && !s.private && typeof gameStageWanted === 'function' && gameStageWanted()
  const mode = castModeFor({ watching: castState.watching, cams: castState.cams, game: game, sharing: sharing })
```

```js
// Sahne kipi önceliği: izlenen paylaşım, kamera ızgarası, oyun masası, kendi paylaşımının önizlemesi
function castModeFor (o) {
  return o.watching ? 'watch' : o.cams ? 'cams' : o.game ? 'game' : o.sharing ? 'own' : null
}
```

2. **`castBuildStage`:**
   - 504'teki `n.cams` öğesinin yanına `n.game = h('div', 'cast-game')` eklenir, `hidden` olarak başlar.
   - Başlığa 460'tan sonra `n.gameMin = castHeadButton('cast-game-min', 'i-close', () => t('game.minimize'))` eklenir. `data-focus-key="cast-game-min"`, tıklanınca `castMinimizeGame()`.
3. **`castRenderStage`:**
   - `const game = mode === 'game'`.
   - `n.panel.classList.toggle('is-game', game)`.
   - Görünürlük (625-635): `fitGroup`, `unwatch` ve `foot` oyunda gizli. `full` görünür. `camsClose` gizli. `gameMin` yalnız oyunda. `video` gizli. `n.game.hidden = !game`.
   - Oyunda `castRenderPick` seçiciyi gizler.
   - Çizim dalına (641-647) `else if (game) castRenderGame(n)` eklenir:

```js
function castRenderGame (n) {
  castBindVideo(n, null)
  n.waiting.hidden = true
  n.failed.hidden = true
  n.tag.hidden = true
  n.panel.setAttribute('aria-labelledby', 'cast-title')
  setLive(n.title, () => gameStageTitle())
  setLive(n.sub, () => gameStageSub())
  if (typeof gameRenderStage === 'function') gameRenderStage(n.game)
}
```

   - Kökün `aria-label` değeri oyunda `t('game.stage')` olur.
4. **`castChatOpen` (871-874):** kip `game` ise varsayılan `false` (geniş ve dar ekranda). Kişinin seçimi `castState.chatOpen` içinde saklanır.
5. **`castCloseStage` (816-837):** `clear(castState.nodes.game)` ve `if (typeof gameStageClosed === 'function') gameStageClosed()`.
6. **`castFocusAfterClose` (387-390):** son kip oyunsa ve `#radio-game` görünürse odak oraya gider.
7. **Yeni işlevler:**
   - `castOpenGame(moveFocus)`:
     - İzleme varsa `castCall('unwatchScreen', [castState.watching])` ve `castState.watching = null`.
     - `castState.cams = false`.
     - `castSync()` ve `renderVoiceAll()`.
     - `moveFocus` doğruysa odak `gameFirstFocus()` öğesine gider.
   - `castMinimizeGame()`: `gameSetMinimized(true)`, `castSync()`, odak `#radio-game`.
8. **Sözleşme yorumları** (12-24 ve cast.css:1-9): `game` kipi ve önceliği eklenir.

**36-oyun.js tarafı:**
- `gameStageWanted()`: `stage !== 'none'` ve küçültülmemiş.
- `gameOpenStage(focus)`: küçültmeyi kaldırır ve `castOpenGame(focus)` çağırır.
- `gameRenderStage(container)`: anahtar `[model.rev, I18N.lang, minimized, picker, confirm, isNarrow()].join('|')`. Anahtar değişmediyse hiçbir şeye dokunmaz (Y10).
- Desk `onChange` geldiğinde:
  - `gameStageWanted()` değeri değiştiyse `castSync()` çağrılır.
  - Değişmediyse ve sahne oyun kipindeyse doğrudan `gameRenderStage(castState.nodes.game)` çağrılır.
  - Her durumda `gameRenderTool()` çağrılır.
- Sahnenin içi `h()`, `icon()` ve `button()` ile kurulur. Yeniden çizimde odak `activeFocusKey` ve `restoreFocusKey` ile korunur [D] 04-meta.js:719-729.

**Telefon:** `oyun.css` içinde 759 px altında şu kural, cast.css:1215-1220'deki 56.25vw kuralını ezer. Özgüllük eşittir ve dosya sonra yüklenir:

```css
body[data-cast="live"][data-cast-mode="game"] .cast-screen {
  height: auto;
  flex: 1 1 auto;
  min-height: 20rem;
}
```

**Geniş ekran:** oyunda sağ sütun gizlenir (mevcut kural). Telsiz DJ sahne açıkken sayfa kipine iner [D] 23-dj.js:244-262.

### 6.5 Masa ekranı yerleşimi (`37-renk.js`, DOM sırası = odak sırası)

1. **Başlık (22-cast.js):** "Renk". Alt satır `game.renk.rulesLine.<rules>` · `game.players` · `game.dealerLine`. Düğmeler: Tam Ekran, Küçült.
2. **Durum satırı** `.game-status`:
   - `game.turnYou` ya da `game.upNext`.
   - Yön çipi `game.renk.dir.cw` ya da `ccw`.
   - Ekran paylaşımım sürüyorsa `game.shareWarn`.
   - `pending` varsa `game.sending`, `slow` ise `game.sendSlow`, eşitleniyorsa `game.syncing`.
3. **Rakip şeridi** `ul.renk-opponents` (`aria-label` `game.seatsTitle`). Sıra benden sonraki koltuktan başlar. Her `li` odaklanamaz ve şunları içerir:
   - `avatar(id, 'sm')`, ad, `game.cards`, Tek! çipi, kurpiyerde `i-crown`, "Sırada" ya da "Uzakta" çipi.
   - Erişilebilir ad tek cümledir (`game.renk.seatLabel`).
4. **Masa ortası** `.renk-center`:
   - Deste düğmesi `button.renk-deck[data-focus-key="game-draw"]`. Etiket `game.renk.draw`, cezada `game.renk.take`. Erişilebilir adı `game.renk.drawLabel`.
   - Atılan kart `.renk-pile`.
   - Aktif renk göstergesi `.renk-color`: şekil, harf ve ad.
   - Birikmiş ceza çipi `game.renk.stacked`.
5. **Eylem satırı** `.renk-actions`:
   - [Renk Seç] yalnız `legal.color` doğruysa.
   - [Pas Geç] yalnız `legal.pass`.
   - [Tek!] `aria-pressed`, `armLast` ya da `last` doğruyken etkin.
   - [Yakala] `legal.catch` doluyken etkin, erişilebilir adı `game.renk.catchLabel`.
   - `pending` varken bütün eylemler `aria-disabled` olur.
6. **El:**
   - Üst bilgi `game.renk.hand`.
   - `div.renk-hand[role="group"]`, `aria-label` `game.renk.handLabel`.
   - Yatay kayar (`overflow-x: auto`, `touch-action: pan-x`).
   - Kartlar renk sırasına (R, Y, G, B, Joker) ve değere göre dizilir. Çekilen kart "Yeni" işareti taşır.
7. **Alt satır:**
   - Güven çipi `.game-trust` (`i-eye`, `game.trustChip`) ve [Ayrıntı]. Ayrıntı tam metni panel içinde açar.
   - Kurallar bağlantısı: `game.renk.wild4Rule` ve `game.renk.lastRule` metinleri ayrıntıda.
   - Kurpiyerde [Oyunu Bitir] ve [Masayı Kapat], oyuncuda [Masadan Ayrıl]. Bunlar `button-danger` sınıfındadır ve panel içinde onay satırı açar.
8. **Canlı bölgeler** (panel içinde): `p.sr-only[role="status"][aria-live="polite"]` ve `p.sr-only[aria-live="assertive"]`. Sahne kapalıyken duyurular, gövdeye bir kez eklenen gizli `#game-live` bölgesine gider.

Kurpiyerin ekranında başkalarının elleri hiç çizilmez.

### 6.6 Kart görünümü

```
button.renk-card[data-color="R|Y|G|B|W"][data-value="0..9|S|V|D|W|F"][data-focus-key="game-card-<kod>-<k>"]
  span.renk-card-corner (aria-hidden)  svg #i-suit-<şekil> + b değer
  span.renk-card-value  (aria-hidden)  "7" | svg #i-block | svg #i-reverse | "+2" | "+4"
  span.renk-card-tag    (aria-hidden)  dile göre harf (game.renk.letter.<C>)
Joker: .renk-card-value içinde dört küçük renk karesi, her biri kendi şekliyle
Kart arkası: span.renk-back (deste ve rakip sayısı)
```

- `<k>`: sıralı elde o kodun kaçıncı kopyası olduğu (0'dan başlar). Elde aynı koddan iki kart olabileceği için bu gereklidir (eleştiri K3).
- Erişilebilir ad `renkCardLabel(code)` ile üretilir (`game.renk.card.*`). Ardından durum gelir: oynanabilirse `game.renk.card.playable`, değilse `game.renk.err.<blocked kodu>`, yeni çekildiyse `game.renk.card.new`.
- Renk körlüğü için her rengin bir şekli ve bir harfi var:

| Renk | Şekil sembolü | tr harf | en harf |
|---|---|---|---|
| R | `i-suit-circle` | K | R |
| Y | `i-suit-triangle` | S | Y |
| G | `i-suit-square` | Y | G |
| B | `i-suit-diamond` | M | B |

- Yeni sprite sembolleri (index.html, 151'den sonra). `i-block` ve `i-crown` zaten var [D] index.html:120, 131.

```html
    <symbol id="i-reverse" viewBox="0 0 24 24"><path d="M4 9h13l-3.5-3.5M20 15H7l3.5 3.5"/></symbol>
    <symbol id="i-suit-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/></symbol>
    <symbol id="i-suit-triangle" viewBox="0 0 24 24"><path d="M12 4.5l8 14H4z"/></symbol>
    <symbol id="i-suit-square" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="1.5"/></symbol>
    <symbol id="i-suit-diamond" viewBox="0 0 24 24"><path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/></symbol>
```

- Marka uzaklığı: ortada eğik beyaz oval yüz deseni ve logo biçimi kullanılmaz. Yüz düz renktir.

### 6.7 Etkileşim

- **Kart:** tek dokunuşla oynanır.
  - Oynanamayan kart `aria-disabled="true"` taşır, odaklanabilir kalır, çizgili örtü alır.
  - Oynanabilir kart `.is-playable` alır (0.375rem yukarı ve alt kenarda `--accent` çizgisi).
- **Hamle gönderimi:** `desk.act({ t: 'play', c, step: view.step })`. `armLast` basılıysa `last: true` eklenir. Joker için önce seçici açılır.
- **Renk seçici** `.renk-picker` (panelin içinde, böylece tam ekranda görünür):
  - `openLayer({ name: 'game-color', el, trigger: kart, level: 2, trap: true, initialFocus: () => ilkDüğme, onClose })` [D] 02-state-dom.js:364-375.
  - Dört düğmede SVG şekil, harf ve ad bulunur. Ayrıca İptal düğmesi vardır.
  - Esc ve kolun daire düğmesi yalnız seçiciyi kapatır, kart oynanmaz.
  - İlk kart Joker iken aynı seçici "Renk Seç" düğmesinden açılır ve `{t:'color', col, step}` gönderir.
- **Onay satırı** (panel içinde): `game.leaveAsk`, `game.endAsk`, `game.closeAsk`, `game.removeAsk`. Odak Vazgeç'e gider, Esc onay satırını kapatır. `window.confirm` kullanılmaz.
- **Sıra gelince:** odak paneldeyse ya da gövdedeyse ilk oynanabilir karta taşınır. Yazma alanındaki kişinin odağı alınmaz (`isTypingTarget`, [D] 17-search.js:1260). Assertive duyuru yapılır.
- **Kısayol yok:** bas konuş tuşu atamalarıyla çakışmasın [D] voice.js:2331-2334.

### 6.8 Odak, klavye ve kol

- Odak sırası: Tam Ekran, Küçült, Deste, eylemler, kartlar, Ayrıntı, ayrılma ve bitirme düğmeleri.
- Elde ve eylem satırında Sol ve Sağ ok komşuya, Home ve End baştaki ve sondaki öğeye gider. Yukarı ok elden Deste'ye gider. Yalnız işlenen tuşta `preventDefault` çağrılır.
- Gezici `tabindex` kullanılmaz.
- Kolun yön tuşlarının PS5 tarayıcısında nasıl davrandığı cihazda denenmeli [V].
- `data-focus-key` listesi:
  - `tool-game`, `cast-game-min`
  - `game-rule-official`, `game-rule-stack`, `game-open`, `game-setup-cancel`, `game-start`, `game-close-table`, `game-new-round`, `game-remove-<id>`
  - `game-join`, `game-decline`, `game-rejoin`, `game-dismiss`
  - `game-draw`, `game-pass`, `game-last`, `game-catch`, `game-choose-color`, `game-card-<kod>-<k>`, `game-color-<C>`, `game-color-cancel`, `game-trust-more`
  - `game-leave`, `game-end`, `game-confirm-yes`, `game-confirm-no`
- Dokunma hedefleri en az `var(--target)`. Kart 3.25rem genişlikten küçük olmaz. Renk düğmeleri en az 3.5rem yüksekliktedir.

### 6.9 Erişilebilirlik ve CSS belirteçleri

- Durumlar yalnız renkle verilmez: sırada halka ve "Sırada" yazısı, oynanamaz kartta desen, Tek! çipi bulunur.
- Duyuru birleştirme: 400 ms içinde gelen olaylar tek cümlede birleşir (`newEvents` her olay için `game.renk.ev.<e>`).
- Başkasının çektiği kartın içeriği okunmaz.
- **tokens.css (741'den sonra).** Kontrast oranları bu oturumda yeniden hesaplandı: beyaz ve kırmızı 5.31, beyaz ve yeşil 4.98, beyaz ve mavi 5.45, beyaz ve Joker 15.26, koyu yazı ve sarı 10.38 [D]. Tekrar etmek için hesap betiği: `/tmp/claude-0/-home-user-ps5-pc-communication/4f00f15f-448b-547a-84d4-7dd1552adf2f/scratchpad/kontrast-dogrula.js`.

```css
/*
  Kart oyunları (Renk, ileride Pişti): yüzler iki modda aynı, kenar, gölge ve kart arkası moda göre.
  Joker yüzü koyu temalarda, sarı yüz açık temalarda zeminden ayrışmadığı için kenar zorunludur.
*/
:root {
  --card-edge: #f2f2f7;
  --card-shadow: 0 0.25rem 0.75rem rgba(0, 0, 0, 0.45);
  --card-back-a: #2b2d6e;
  --card-back-b: #15163d;
  --card-hatch: rgba(0, 0, 0, 0.35);
  --renk-red: #c8322f;
  --renk-yellow: #f2c12e;
  --renk-green: #16804a;
  --renk-blue: #2563d8;
  --renk-wild: #24252c;
  --renk-ink: #ffffff;
  --renk-ink-yellow: #221800;
}

:root[data-scheme="light"] {
  --card-edge: #2a2b33;
  --card-shadow: 0 0.25rem 0.75rem rgba(20, 20, 40, 0.2);
  --card-back-a: #3b3fa8;
  --card-back-b: #1e2160;
  --card-hatch: rgba(255, 255, 255, 0.45);
}
```

- **renk.css ve oyun.css kuralları:**
  - Renkler yalnız `var(--...)`, dosyada hex ya da `rgba(` geçmez.
  - `grid`, `gap`, `clamp`, `:is`, `:where`, `aspect-ratio` ve `inset` kullanılmaz. Konum için `top`, `right`, `bottom`, `left`, aralık için `margin` yazılır.
  - Ölçüler `rem`.
  - `-webkit-inline-box` kullanılmaz, `display: inline-flex` ve önekli `-webkit-flex` yeterlidir.
  - z-index en çok 3 (seçici panel içinde `position: absolute`). Var olan en yüksek değer olan 110'un altında kalır [D] music.test.js:3096-3104.
  - Her iki dosyada `@media (prefers-reduced-motion: reduce)` bloğu bulunur. `:root[data-reduce-motion="true"]` için genel kural zaten var [D] base.css:342-344.
  - JS tarafında `gameReducedMotion()` hem medya sorgusuna hem `document.documentElement.getAttribute('data-reduce-motion') === 'true'` değerine bakar.
- **Boyutlar:**

| Düzen | El kartı | Atılan ve deste |
|---|---|---|
| Telefon (759 px ve altı) | 3.25 x 4.75rem | 3.75 x 5.5rem |
| 760 px ve üstü | 3.5 x 5rem | 4.5 x 6.5rem |

### 6.10 Bildirimler listesi (`28-bildirim.js`)

- `activityGame(dealerId, on)`: aynı kurpiyerin eski `game` kaydını kaldırır, `on` doğruysa `activityAdd({ kind: 'game', userId: String(dealerId), channelId: null })` çağırır. Kalıp `activityShare` ile aynıdır [D] 59-68.
- `activityClearGames()`: `kind === 'game'` kayıtlarını siler. Masa kapanınca, davet geçersiz olunca, Katıl'a basınca ve sesten çıkınca çağrılır.
- `activityText`: `game` için `t('game.activityInvite', { name, game: t('game.renk.title') })`.
- `renderActivity`: `game` için `button('button button-small activity-watch', t('game.view'), 'i-gamepad', t('game.toolInviteLabel', ...))` eklenir, tıklanınca `gameOpenInvite(item.userId)` çağrılır.
- Başlık yorumuna üçüncü tür eklenir.

---

## 7. i18n

Anahtarlar `public/i18n.js` içinde tr ve en sözlüklerine aynı sırayla eklenir. Çoğul anahtarlar `_one` ve `_other` eşiyle yazılır, parametreler iki dilde aynıdır.

Başlık kuralı [D] CHANGELOG.md:83: düğme, çip, sekme ve üst bilgi satırlarında her kelime büyük harfle başlar. Türkçede "ve", "ile", "veya" küçük kalır. Cümleler ve erişilebilir adlar normal yazılır.

Yeniden kullanılan anahtarlar: `common.close` (Kapat) ve `common.cancel` (İptal) [D] i18n.js:259-260, 2196-2197.

### 7.1 `game.*` (genel)

| Anahtar | tr | en |
|---|---|---|
| game.tool | Oyun | Game |
| game.toolLabel | Oyun masası kurun | Set up a game table |
| game.toolInvite | Davet | Invite |
| game.toolInviteLabel | {name} sizi {game} oyununa davet ediyor, masaya bakın | {name} is inviting you to play {game}, view the table |
| game.toolBusy | Oyun Sürüyor | Game in Progress |
| game.toolBusyLabel | Bu odada bir oyun sürüyor, sonraki elde katılabilirsiniz | A game is in progress in this room, you can join the next round |
| game.toolBack | Masaya Dön | Back to Table |
| game.toolTurn | Sıra Sizde | Your Turn |
| game.stage | Oyun masası | Game table |
| game.minimize | Küçült | Minimize |
| game.minimizeLabel | Masayı küçültün, oyun sürer | Minimize the table, the game goes on |
| game.setupTitle | Masa Kur | Set Up a Table |
| game.setupLocked | Masa kurmak için güvenlik anahtarınızın bu cihazda açık olması gerekir. | To set up a table, your security key must be unlocked on this device. |
| game.lobbyTitle | {game} Masası | {game} Table |
| game.rulesTitle | Kurallar | Rules |
| game.seatsTitle | Oyuncular | Players |
| game.roomTitle | Odadakiler | In the Room |
| game.players_one | {count} Oyuncu | {count} Player |
| game.players_other | {count} Oyuncu | {count} Players |
| game.dealerLine | Kurpiyer {name} | Dealer {name} |
| game.dealerYou | Kurpiyer Sizsiniz | You Are the Dealer |
| game.openTable | Masa Aç | Open Table |
| game.start | Başlat | Start |
| game.startHint | Başlatmak için en az bir oyuncunun daha katılması gerekir. | At least one more player must join before you can start. |
| game.closeTable | Masayı Kapat | Close Table |
| game.newRound | Yeni El | New Round |
| game.waitNewRound | Kurpiyer yeni el açarsa masada kalırsınız. | If the dealer opens a new round, you stay at the table. |
| game.join | Katıl | Join |
| game.decline | Reddet | Decline |
| game.rejoin | Oyuna Dön | Return to Game |
| game.rejoinText | Bu masada koltuğunuz duruyor. Oyuna dönmek ister misiniz? | Your seat at this table is still there. Do you want to return to the game? |
| game.view | Masaya Bak | View Table |
| game.inviteText | {name} sizi {game} oyununa davet ediyor. | {name} is inviting you to play {game}. |
| game.activityInvite | {name}, {game} masası açtı | {name} opened a {game} table |
| game.leave | Masadan Ayrıl | Leave Table |
| game.endGame | Oyunu Bitir | End Game |
| game.removeSeat | Koltuktan Çıkar | Remove from Seat |
| game.leaveAsk | Ayrılırsanız kartlarınız desteye döner. | If you leave, your cards go back to the deck. |
| game.endAsk | Oyun herkes için biter. | The game ends for everyone. |
| game.closeAsk | Masa herkes için kapanır. | The table closes for everyone. |
| game.removeAsk | {name} masadan çıkarılır, kartları desteye döner. | {name} is removed from the table and their cards go back to the deck. |
| game.confirmLeave | Ayrıl | Leave |
| game.confirmEnd | Bitir | End |
| game.confirmClose | Kapat | Close |
| game.confirmRemove | Çıkar | Remove |
| game.confirmStay | Vazgeç | Go Back |
| game.status.dealer | Kurpiyer | Dealer |
| game.status.waiting | Yanıt Bekleniyor | Waiting for Reply |
| game.status.joined | Katıldı | Joined |
| game.status.declined | Reddetti | Declined |
| game.status.cannot | Katılamaz | Cannot Join |
| game.status.blocked | Engellediniz | Blocked |
| game.status.full | Masa Dolu | Table Full |
| game.status.away | Uzakta | Away |
| game.status.offline | Bağlantı Bekleniyor | Reconnecting |
| game.status.keys | Anahtar Sorunu | Key Problem |
| game.reason.locked | Güvenlik anahtarınız bu cihazda açık değil, bu yüzden katılamazsınız. | Your security key is not unlocked on this device, so you cannot join. |
| game.reason.blocked | Bu kişiyi engellediniz. | You have blocked this person. |
| game.reason.gone | Bu hesap artık kullanılamıyor. | This account is no longer available. |
| game.reason.loading | Güvenlik anahtarı yükleniyor. | Loading the security key. |
| game.reason.unverified | {name} kişisinin güvenlik anahtarı doğrulanmadı. | The security key of {name} is not verified. |
| game.reason.changed | {name} kişisinin güvenlik anahtarı değişti ve henüz kabul edilmedi. | The security key of {name} changed and has not been accepted yet. |
| game.reason.peer_unverified | Kurpiyerin cihazı güvenlik anahtarınızı doğrulayamadı. | The dealer's device could not verify your security key. |
| game.reason.peer_changed | Güvenlik anahtarınız kurpiyerin cihazında değişmiş görünüyor ve henüz kabul edilmedi. | Your security key looks changed on the dealer's device and has not been accepted yet. |
| game.reason.peer_gone | Kurpiyerin cihazı hesabınızı göremiyor. | The dealer's device cannot see your account. |
| game.reason.peer_loading | Kurpiyerin cihazı güvenlik anahtarınızı yüklüyor. | The dealer's device is loading your security key. |
| game.reject.full | Masa dolu. | The table is full. |
| game.reject.started | Oyun başladı. Sonraki elde katılabilirsiniz. | The game has started. You can join the next round. |
| game.reject.closed | Masa kapandı. | The table is closed. |
| game.reject.keys | Kurpiyerin cihazı güvenlik anahtarınızı kullanamıyor, bu yüzden katılamazsınız. | The dealer's device cannot use your security key, so you cannot join. |
| game.joinTimeout | Kurpiyerden yanıt gelmedi. Yeniden deneyebilirsiniz. | The dealer did not reply. You can try again. |
| game.trustDealer | Kurpiyer sizsiniz. Desteyi bu cihaz karıştırır ve bütün elleri teknik olarak bilir. Başkalarının elleri bu ekranda gösterilmez. Oyunculara bu durum yazılır. | You are the dealer. This device shuffles the deck and technically knows every hand. Other hands are not shown on this screen. Players are told about this. |
| game.trustPlayer | Kurpiyer {name}. Desteyi onun cihazı karıştırır ve bütün elleri teknik olarak bilir. Eliniz yalnız size şifreli gönderilir, sunucu ve diğer oyuncular göremez. El bitince yalnız kart sayıları ve puanlar gösterilir. | {name} is the dealer. Their device shuffles the deck and technically knows every hand. Your hand is sent encrypted only to you, and the server and other players cannot see it. When the round ends, only card counts and points are shown. |
| game.trustChip | Kurpiyer Elleri Bilir | Dealer Knows All Hands |
| game.trustMore | Ayrıntı | Details |
| game.trustLess | Ayrıntıyı Gizle | Hide Details |
| game.shareWarn | Ekranınız yayında: eliniz izleyenlere görünebilir. | Your screen is live: viewers may see your hand. |
| game.waitingStart | Kurpiyerin başlatması bekleniyor. | Waiting for the dealer to start. |
| game.syncing | Masa eşitleniyor | Syncing the table |
| game.sending | Hamle gönderiliyor | Sending your move |
| game.sendSlow | Kurpiyere ulaşılamıyor, yeniden deneniyor | Cannot reach the dealer, retrying |
| game.sendFailed | Masaya ileti gönderilemedi. | A message could not be sent to the table. |
| game.turnYou | Sıra Sizde | Your Turn |
| game.upNext | Sıradaki: {name} | Up Next: {name} |
| game.ended.dealer_left | Kurpiyer ses odasından ayrıldı, oyun bitti. | The dealer left the voice room. The game is over. |
| game.ended.closed | Kurpiyer masayı kapattı. | The dealer closed the table. |
| game.ended.superseded | Bu masa kapandı, odada başka bir masa açık. | This table was closed. Another table is open in the room. |
| game.ended.dealer_lost | Kurpiyere uzun süredir ulaşılamıyor, oyun bitti. | The dealer has been unreachable for a while. The game is over. |
| game.ended.removed | Kurpiyer sizi masadan çıkardı. | The dealer removed you from the table. |
| game.ended.keys | Kurpiyerle şifreli bağlantı kurulamıyor, oyun bitti. | An encrypted connection with the dealer cannot be set up. The game is over. |
| game.ended.left | Masadan ayrıldınız. | You left the table. |
| game.ended.reset | Ses odasından ayrıldınız, masa kapandı. | You left the voice room. The table was closed. |
| game.resultsTitle | Sonuçlar | Results |
| game.resultWinner | Kazanan {name} · {points} | Winner {name} · {points} |
| game.resultNone | Kazanan Yok | No Winner |
| game.resultReason.too_few | Masada tek oyuncu kaldı. | Only one player is left at the table. |
| game.resultReason.ended | Kurpiyer oyunu bitirdi. | The dealer ended the game. |
| game.cards_one | {count} Kart | {count} Card |
| game.cards_other | {count} Kart | {count} Cards |
| game.points_one | {count} Puan | {count} Point |
| game.points_other | {count} Puan | {count} Points |
| game.resultLabel | {rank}. sıra {name}: {cards}, {points} | Place {rank}, {name}: {cards}, {points} |
| game.sr.invited | {name} sizi {game} oyununa davet ediyor. | {name} is inviting you to play {game}. |
| game.sr.yourTurn | Sıra sizde. | It is your turn. |
| game.sr.next | Sıradaki oyuncu {name}. | Next player: {name}. |
| game.sr.joined | {name} masaya katıldı. | {name} joined the table. |
| game.sr.left | {name} masadan ayrıldı. | {name} left the table. |
| game.sr.declined | {name} daveti reddetti. | {name} declined the invite. |
| game.sr.started | Oyun başladı. | The game has started. |

### 7.2 `game.renk.*`

| Anahtar | tr | en |
|---|---|---|
| game.renk.title | Renk | Renk |
| game.renk.tagline | Renk ve sayı eşleştirmeli kart oyunu | A color and number matching card game |
| game.renk.rules.official | Resmî | Official |
| game.renk.rules.officialHint | +2 ve +4 üst üste konmaz. Son kartınıza düşerken Tek! demezseniz ve biri sizi yakalarsa 2 kart çekersiniz. | +2 and +4 cannot be stacked. If you drop to one card without calling Last Card and someone catches you, you draw 2 cards. |
| game.renk.rules.stack | Üst Üste Ekleme | Stacking |
| game.renk.rules.stackHint | +2 üstüne +2, +4 üstüne +4 konabilir. Ceza birikir, ekleyemeyen oyuncu hepsini alır. Tek! kuralı burada da geçerlidir. | A +2 can go on a +2 and a +4 on a +4. The penalty adds up and the player who cannot add takes it all. The Last Card rule applies here too. |
| game.renk.rulesLine.official | Resmî Kurallar | Official Rules |
| game.renk.rulesLine.stack | Üst Üste Ekleme | Stacking Rules |
| game.renk.color.R | Kırmızı | Red |
| game.renk.color.Y | Sarı | Yellow |
| game.renk.color.G | Yeşil | Green |
| game.renk.color.B | Mavi | Blue |
| game.renk.letter.R | K | R |
| game.renk.letter.Y | S | Y |
| game.renk.letter.G | Y | G |
| game.renk.letter.B | M | B |
| game.renk.card.num | {color} {number} | {color} {number} |
| game.renk.card.S | {color} Engel | {color} Skip |
| game.renk.card.V | {color} Yön | {color} Reverse |
| game.renk.card.D | {color} +2 | {color} +2 |
| game.renk.card.WW | Joker | Wild |
| game.renk.card.WF | Joker +4 | Wild +4 |
| game.renk.card.chosen | {card}, {color} seçildi | {card}, {color} chosen |
| game.renk.card.playable | oynanabilir | playable |
| game.renk.card.new | yeni çekildi | just drawn |
| game.renk.seatLabel | {name}, {cards}{state} | {name}, {cards}{state} |
| game.renk.seatTurn | , sırada | , their turn |
| game.renk.seatLast | , Tek! dedi | , called Last Card |
| game.renk.hand_one | Eliniz · {count} Kart | Your Hand · {count} Card |
| game.renk.hand_other | Eliniz · {count} Kart | Your Hand · {count} Cards |
| game.renk.handLabel_one | Eliniz, {count} kart | Your hand, {count} card |
| game.renk.handLabel_other | Eliniz, {count} kart | Your hand, {count} cards |
| game.renk.deck | Deste | Deck |
| game.renk.deckLeft_one | {count} kart kaldı | {count} card left |
| game.renk.deckLeft_other | {count} kart kaldı | {count} cards left |
| game.renk.discard | Atılan Kart | Discard Pile |
| game.renk.activeColor | Aktif Renk | Active Color |
| game.renk.dir.cw | Saat Yönü | Clockwise |
| game.renk.dir.ccw | Ters Yön | Counterclockwise |
| game.renk.stacked | +{count} Birikti | +{count} Stacked |
| game.renk.draw | Kart Çek | Draw Card |
| game.renk.take_one | {count} Kart Al | Take {count} Card |
| game.renk.take_other | {count} Kart Al | Take {count} Cards |
| game.renk.drawLabel | Desteden kart çekin, {left} | Draw a card from the deck, {left} |
| game.renk.pass | Pas Geç | Pass |
| game.renk.chooseColor | Renk Seç | Choose Color |
| game.renk.last | Tek! | Last Card! |
| game.renk.lastLabel | Tek! deyin: son kartınıza düşüyorsunuz | Call Last Card: you are down to your last card |
| game.renk.lastArmed | Tek! Denecek | Last Card Armed |
| game.renk.lastDone | Tek! Dedi | Called Last Card |
| game.renk.catch | Yakala | Catch |
| game.renk.catchLabel | {name} Tek! demedi, yakalayın | {name} did not call Last Card, catch them |
| game.renk.pickTitle | Renk Seç | Choose a Color |
| game.renk.pickSub | Joker hangi renk olsun? | Which color should the wild card be? |
| game.renk.firstSeat | İlk Sıra: {name} | First Turn: {name} |
| game.renk.scoring | Puanlar: sayılı kart kendi değeri, Engel, Yön ve +2 20 puan, Joker ve Joker +4 50 puan. Kazanan diğerlerinin elindeki puanları alır. | Scoring: number cards count their value, Skip, Reverse and +2 count 20, Wild and Wild +4 count 50. The winner scores the points left in the other hands. |
| game.renk.wild4Rule | Joker +4 yalnız elinizde aktif renkte kart yokken oynanabilir. Bunu oyun kendisi denetler, bu yüzden itiraz adımı yoktur. | Wild +4 can only be played when you hold no card of the active color. The game checks this itself, so there is no challenge step. |
| game.renk.lastRule | Tek! ve Yakala basışları kurpiyere ulaştıkları sırayla değerlendirilir. | Last Card and Catch presses are judged in the order they reach the dealer. |
| game.renk.sr.yourTurn_one | Sıra sizde. Atılan kart {card}. {count} kartınız oynanabilir. | It is your turn. The discard is {card}. {count} of your cards can be played. |
| game.renk.sr.yourTurn_other | Sıra sizde. Atılan kart {card}. {count} kartınız oynanabilir. | It is your turn. The discard is {card}. {count} of your cards can be played. |
| game.renk.sr.yourTurnNone | Sıra sizde. Oynanabilir kartınız yok, kart çekin. | It is your turn. You have no playable card, draw one. |
| game.renk.sr.mustTake | Sıra sizde. {count} kartlık ceza birikti: ekleyin ya da kartları alın. | It is your turn. A {count} card penalty is stacked: add to it or take the cards. |
| game.renk.sr.chooseColor | Sıra sizde. İlk kart Joker, önce renk seçin. | It is your turn. The first card is a wild, choose a color first. |

Olaylar (`game.renk.ev.<e>`, 5.16'daki her olay için):

| Anahtar | tr | en |
|---|---|---|
| game.renk.ev.play | {name} {card} oynadı. | {name} played {card}. |
| game.renk.ev.draw_one | {name} {count} kart çekti. | {name} drew {count} card. |
| game.renk.ev.draw_other | {name} {count} kart çekti. | {name} drew {count} cards. |
| game.renk.ev.nodraw | {name} çekecek kart bulamadı, sıra geçti. | {name} found no card to draw, the turn passed. |
| game.renk.ev.pass | {name} pas geçti. | {name} passed. |
| game.renk.ev.color | {name} rengi {color} seçti. | {name} chose {color}. |
| game.renk.ev.skip | {name} sırasını kaybetti. | {name} lost their turn. |
| game.renk.ev.reverse | Yön değişti: {dir}. | Direction changed: {dir}. |
| game.renk.ev.penalty_one | {name} ceza olarak {count} kart çekti. | {name} drew {count} card as a penalty. |
| game.renk.ev.penalty_other | {name} ceza olarak {count} kart çekti. | {name} drew {count} cards as a penalty. |
| game.renk.ev.last | {name} Tek! dedi. | {name} called Last Card. |
| game.renk.ev.caught | {name} yakalandı ve 2 kart çekti. | {name} was caught and drew 2 cards. |
| game.renk.ev.reshuffle | Atılan kartlar karıştırılıp desteye kondu. | The discard pile was shuffled into the deck. |
| game.renk.ev.reflip | İlk kart desteye geri kondu, yeni kart açıldı. | The first card went back into the deck and a new card was turned up. |
| game.renk.ev.leave_one | {name} ayrıldı, {count} kartı desteye döndü. | {name} left and {count} card went back to the deck. |
| game.renk.ev.leave_other | {name} ayrıldı, {count} kartı desteye döndü. | {name} left and {count} cards went back to the deck. |
| game.renk.ev.pending_dropped_one | Biriken {count} kartlık ceza düştü. | The stacked {count} card penalty was dropped. |
| game.renk.ev.pending_dropped_other | Biriken {count} kartlık ceza düştü. | The stacked {count} card penalty was dropped. |
| game.renk.ev.end | {name} kazandı. | {name} won. |

Hatalar (`game.renk.err.<kod>`, 5.17'deki her kod için):

| Kod | tr | en |
|---|---|---|
| bad_options | Oyun bu ayarlarla başlatılamadı. | The game could not be started with these settings. |
| bad_random | Güvenli rastgele sayı üretilemedi. | Secure random numbers could not be generated. |
| no_random | Bu cihazda güvenli rastgele sayı üretilemiyor. | This device cannot generate secure random numbers. |
| bad_move | Bu hamle geçersiz. | This move is not valid. |
| bad_player | Bu oyunda değilsiniz. | You are not in this game. |
| game_over | Oyun sürmüyor. | The game is not running. |
| not_your_turn | Sıra sizde değil. | It is not your turn. |
| stale | Masa değişti, hamleniz uygulanmadı. | The table changed, your move was not applied. |
| choose_color | Önce renk seçin. | Choose a color first. |
| not_in_hand | Bu kart elinizde değil. | This card is not in your hand. |
| only_drawn | Yalnız çektiğiniz kartı oynayabilirsiniz. | You can only play the card you drew. |
| must_stack | Aynı ceza kartını ekleyin ya da kartları alın. | Add the same penalty card or take the cards. |
| not_playable | Atılan kartla rengi ya da işareti eşleşmiyor. | It does not match the color or symbol of the discard. |
| wild4_has_color | Elinizde aktif renkte kart varken Joker +4 oynanamaz. | You cannot play Wild +4 while you hold a card of the active color. |
| need_color | Joker için renk seçin. | Choose a color for the wild card. |
| already_drawn | Bu turda zaten kart çektiniz. | You already drew a card this turn. |
| cannot_pass | Pas geçmek için önce kart çekin. | Draw a card before you pass. |
| no_last | Şu anda Tek! diyemezsiniz. | You cannot call Last Card right now. |
| self_catch | Kendinizi yakalayamazsınız. | You cannot catch yourself. |
| not_catchable | Geç kaldınız, yakalanamadı. | Too late, nobody was caught. |

Dinamik anahtarlarda denetleyici yalnız öneki denetler [D] scripts/denetle.js:969-1023. Anahtarların tam olduğunu `test/oyun-arayuz.test.js` zorunlu kılar (8.6).

---

## 8. Testler

Bütün test adları Türkçedir ve marka adı geçmez. vm bağlamından dönen nesneler JSON kopyasıyla karşılaştırılır [D] music.test.js `same` kalıbı.

### 8.1 `test/oyun-tasima.test.js` (voice.js)

**Saf kısım** (`loadVoice` kalıbı [D] kamera.test.js:28-60), `VC.gameUtils.validateSignal`:
- `{type:'game', sid, n, p:'{"v":1}'}` kabul edilir, dönüşte yalnız `{type, p}` bulunur.
- `p` iç zarf biçiminde (`'2.' + 32 + '.' + 24+` karakter) kabul edilir.
- Reddedilenler:
  - Fazla alan (`g`, `k`, `x`).
  - `p` boş ya da 11001 karakter.
  - `p` içinde `\n` ya da Türkçe harf.
  - `p` sayı, dizi ya da `null`.
  - `type` yanlış.
- `maxChars === 11000`.

**Motor kısmı** (`test/screenshare.test.js:582` `makeRoom` çok motorlu oda kalıbı [D]):
1. İki motor el sıkışınca A'da `peer-ready` bir kez gelir, `userId` doğrudur.
2. `A.sendGame(peerB, p, done)` `'ok'` döner. B'de `{type:'message', peerId: A, userId, p}` olayı gelir. A'da `done(true)` çağrılır.
3. `sendGame` dönüş kodları: seste değilken `'not_in_voice'`, bilinmeyen peerId ile `'no_peer'`, el sıkışma bitmeden `'not_ready'`, geçersiz `p` ile `'bad_message'`.
4. Fazla alanlı bir oyun sinyali atılır ve aynı `n` değerini tüketmez: ardından aynı `n` ile gelen geçerli sinyal kabul edilir.
5. Eski sid ile gelen oyun sinyali atılır.
6. `rebuildPeer` yeni sid ve yeni `peer-ready` üretir, `peer-leave` üretmez.
7. Metadan kişi çıkınca `peer-leave {peerId, userId}` gelir.
8. `leave()` sonrası `reset` gelir.
9. Sahte sunucu art arda 429 dönerse, zamanlayıcılar 1, 2 ve 4 sn ilerletilince `done(429)` bir kez çağrılır.
10. Oturum değişince (`leave` sırasında uçuşta olan ileti) `done` çağrılmaz.
11. Dinleyici hata fırlatırsa motor çalışmaya devam eder.

### 8.2 `test/oyun-protokol.test.js` (`TelsizGame`, gerçek nacl ve crypto.js)

Yükleme `loadDevice` kalıbıyla yapılır [D] music.test.js:44-62. Her cihaz kendi vm bağlamıdır, kimlik anahtarları `E2EE.identity.generate()` ile üretilir.
1. `sealInner` ve `openInner` gidiş dönüşü. `checkInner` bütün türleri kabul eder.
2. **C, B'nin durumunu açamaz:** K'nin B'ye mühürlediği `state` iletisi C'nin anahtarlarıyla `null` döner.
3. **Yansıtma:** K'nin B'ye gönderdiği zarf K'nin kendisinde açılır (simetrik anahtar), ama `checkInner(x, {from: B, to: K})` null döner.
4. **Bağ alanları:** `g`, `ch`, `from` ya da `to` farklı olan, fazla alan taşıyan, eksik alanlı ya da `ctx` değeri yanlış olan iç metin reddedilir.
5. **Özel mesajla karışmama:**
   - `{v:1, a:'5', c:'9', t:'x'}` biçimli bir özel mesaj düz metni `openInner` sonrası reddedilir (`ctx` yok).
   - Oyun düz metninde `a` ve `c` alanları yoktur. 15-dm.js:263 denetimi `sameId(v.a, m.authorId)` istediği için oyun zarfı özel mesaj olarak kabul edilmez. Test bu koşulu, oyun düz metninde `a` alanının bulunmadığını doğrulayarak sınar.
6. `seqOrder` ve `acceptState` tabloları.
7. Düz ileti doğrulayıcıları: `invite`, `decline`, `reject` ve `close` için kabul ve red durumları. `invite.seats[0] !== dealer` reddedilir. `max > 8` reddedilir. `key: 'blocked'` reddedilir.
8. `encodePlain`: ASCII dışı karakter ya da 11000'i aşan çıktı `null` döner.
9. `validStateBody`: lobide `view` dolu, oyunda `view` boş, `ev.r > r`, bilinmeyen alan ve `away` dışı kimlik reddedilir.
10. **Rastgelelik:**
    - `fixed([255, 4])` ve `m=3` için 1 döner.
    - `fixed([216, 215])` ve `m=108` için 107 döner.
    - Her zaman 255 veren kaynak `bad_random` verir.
    - `rng` hata fırlatırsa `no_random`.
    - Kısa dizi `bad_random`.
    - Node `Uint8Array` kabul edilir.
    - `shuffle` girdiyi değiştirmez, aynı çoklu kümeyi verir.
    - 3 öğenin 6 permütasyonu 60000 denemede ki-kare 25'in altında kalır.
11. **Boyut:** 8 kişilik, en büyük el 60 kartlık bir Renk durumunun mühürlenmiş `p` değeri 11000'in altında kalır.

### 8.3 `test/oyun-masa.test.js` (`TelsizGameDesk`, tek cihaz)

Sahte ortam:
- `send` gönderimleri bir listeye yazar ve `done` geri çağrılarını elle tetiklemeyi sağlar.
- `keys` tablo ile çalışır (her kişi için ok ya da neden).
- `dm` sahte zarftır: `'2.' + base64(JSON)` ve iki taraf kimliği. Gerçek kripto 8.2 ve 8.5'te sınanır.
- `now` elle ilerletilir.
- Genelliği göstermek için yalnız testte tanımlı küçük bir **"sayaç" uygulaması** kullanılır. Bu uygulamada her oyuncu sırayla `{t:'add', step}` gönderir, toplam 10 olunca biter.

Durumlar:
1. `openTable` oda üyelerine alıcıya özel `ni` ile davet gönderir. Engelli kişiye davet gitmez. Kendi kimliği kilitliyken masa açılmaz.
2. `join`: doğru `ni` koltuk ekler ve `r` artar. Yanlış ya da eski `ni` atılır. Aynı `join` ikinci kez atılır. 9. kişi `reject {why:'full'}` alır. Oyun başladıktan sonra koltuğu olmayan kişi `reject {why:'started'}` alır.
3. Engelli kişiden gelen `join` yanıtsız kalır.
4. `loading`: `join` bekletilir, `recheck()` sonrası işlenir. 10 sn sonra sessizce düşer.
5. Tek uçuş: uçuşta ileti varken gelen üç değişiklik tek bir sonraki gönderime toplanır ve en yeni `r` değerini taşır.
6. 429 sonrası geri çekilme 2, 4, 8 sn. `peer-ready` beklemeyi sıfırlar.
7. Reddedilen hamle yalnız o koltuğa gider, 1 sn kısmalıdır, `r` değişmez.
8. `seq`: tekrar yalnız sonucu yeniden gönderir, eski atılır.
9. `sync` 5 sn'de en çok bir yanıt alır.
10. `rd` uyuşmazlığında `stale` döner.
11. `peer-leave(koltuk)` koltuğu kaldırır, `removePlayer` çağrılır, 2'nin altına düşülürse aşama `over` olur.
12. Oyuncu: kurpiyerin `peerId` değeri için gelen `peer-leave` `ended('dealer_left')` yapar. `close {why:'gone'}` aynı sonucu verir. Başkasından gelen `close` atılır.
13. Oyuncu: `ni` uyuşmayan durum atılır (Y2). Eski `r` atılır. Aynı `r` ile daha yeni `ack` kabul edilir.
14. Oyuncu: bekleyen hamle varken `sync` gönderilmez, aynı `seq` yeniden gönderilir.
15. Canlılık: 25 sn'de `sync` gider, 45 sn'de `dealer_lost` olur. Kurpiyer 15 sn'de bir tazeleme yollar.
16. Kurpiyer bilinmeyen `g` için gelen iç iletiye `close {why:'gone'}` ile yanıt verir. Aynı kişiye 5 sn'de en çok bir kez.
17. Tek masa: iki lobi karşılaşınca küçük `g` kalır, `play` lobiye karşı kalır. Kaybeden `close {why:'superseded'}` gönderir.
18. Kurpiyerin kendi `catch` hamlesi 300 ms sonra işlenir. Bu sürede gelen bir oyuncunun `last` hamlesi önce işlenir.
19. Özel arama: `isPrivate` doğruyken bütün olaylar atılır.
20. Davet bildirimi aynı kurpiyerden 30 sn'de en çok bir kez gelir.
21. `peer-ready` olayında koltuktaki kişiye önce `invite`, sonra `state` gider. Masası olan oyuncu bu daveti yok sayar. Masası olmayan oyuncu `rejoin` aşamasına geçer.
22. Tazelik (Y1): eski `leave` zarfı yeniden gönderilince (`seq <= lastSeq`) atılır.

### 8.4 `test/renk-kural.test.js` (`TelsizRenk`)

Belirlenimci kaynaklar `seeded(seed)` (xorshift32) ve `fixed(bytes)` düz `Array` döndürür. `table({rules, hands, top, color, deckTop})` yardımcısı `buildDeck()` içinden kartları çıkarıp tam durum kurar ve `validateState` ile doğrular.

1. **Deste:**
   - 108 kart, renk başına 25 kart.
   - `0` birer, `1`-`9` ikişer, `S`, `V` ve `D` ikişer, `WW` 4, `WF` 4.
   - Kanonik dizenin başı (`R0R1R1R2`) ve sonu (`WWWWWWWWWFWFWFWF`) sabit.
2. **`isCard`:** `R0`, `BD`, `YV`, `WW` ve `WF` doğru. `W4`, `R4x`, `X5`, `r5`, `RRR` ve dize olmayanlar yanlış. `parseCards` 109 öğeyi reddeder.
3. **`cardValue` benzersizliği (K1 regresyonu):**
   - `cardValue('WF') !== cardValue('R4')`.
   - `points('R4') === 4`.
   - Yalnız `R4` olan oyuncu Kırmızı 9 üstüne `R4` oynayabilir.
   - Kırmızı seçilmiş `WF` üstüne `B4` oynanamaz.
   - Bekleyen `F` cezasına `G4` eklenemez.
4. **Bağımsız kâhin:** test içinde ayrı yazılmış `oracle(top, color, card, hand, pending)` işlevi, bütün 108x108 (üst kart, oynanan kart) çiftleri için `canPlay` ile aynı sonucu verir. Ek olarak ceza durumlu sürüm ve `WF` kısıtı için elde etkin renk olan ve olmayan iki el denenir.
5. **Seçenekler:** 1 ve 9 oyuncu, yinelenen kimlik, bilinmeyen kural, sayısal kimlik ve sınır dışı `dealSeat` `bad_options` döner.
6. **Dağıtım:** 2-8 oyuncunun her biri 7 kart alır, deste `108 - 7n - 1` kart tutar. Dağıtım `dealSeat + 1` koltuğundan başlar.
7. **İlk kart tablosu** (5.5): her satır `dealFrom` ile sınanır. `WF` yeniden açılır. Bozuk kaynakla 16 denemeden sonra `bad_random` döner. İlk kart Joker iken `color` hamlesi beklenir, `play` ve `draw` `choose_color` döner.
8. **Hata önceliği** 5.6'daki sırayla tutar. Örnekler: `drawn` aşamasında oynanamayan başka kart `only_drawn` döner, `not_playable` değil. Oyun bitince her hamle `game_over` döner.
9. **Etkiler** (5.7): Engel, 3 ve 2 kişide Yön, 3 kişiden 2'ye düşünce Yön, Resmî +2 ve +4.
10. **Çekme** (5.8):
    - Oynanabilir çekilen kartta `drawn` aşaması açılır, `publicView.phase === 'play'` görünür.
    - Oynanamayan kartta sıra geçer.
    - Çekilen `WF`, elde etkin renk varken oynanamaz.
    - Deste boşalınca yeniden karıştırılır, ikisi de boşsa `nodraw` olur, ceza çekiminde `want !== n`.
11. **Üst üste ekleme** (5.9):
    - `RD BD YD` sonrası `pending.n === 6`, ardından `draw` 6 kart verir.
    - `D` üstüne `WF` `must_stack` döner.
    - `WF` üstüne `WF`, elde etkin renk olsa bile geçerlidir.
    - Resmî sette +2 üstüne +2 konamaz.
    - Son kart +2 ve birikmiş 4 varsa sıradaki 6 kart çeker.
12. **Tek!** (5.10):
    - Korunan oyuncu yakalanamaz.
    - Korunmayan oyuncu yakalanır ve 2 kart çeker, `step` değişmez.
    - Geç bildirim korur.
    - `self_catch` ve yanlış `p` ile yakalama çalışmaz.
    - Sonraki tur hamlesinden sonra yakalama `not_catchable` döner.
    - Resmî +2 ile tek karta düşen oyuncunun penceresi doğru zamanda kapanır.
    - 2 kişide Engel ile tek karta düşenin penceresini kendi hamlesi kapatır.
    - 2 karta düşüren oyunda `last:true` yok sayılır.
    - `LAST_CARD.stack` false yapılan bir kopyada pencere açılmaz.
13. **Ayrılma** (5.12): tablodaki her satır sınanır. Toplam 108 kalır ve aynı tohumla sonuç belirlenimcidir.
14. **Sonuç** (5.13): sıralama ve eşit puan, son +2, `endGame`, `ranks` içinde `cards` alanı yok.
15. **Görünümler:**
    - `publicView` JSON metninde hiçbir elin kartı yok. Bu nesne yürüyüşüyle denetlenir: her koltuğun eli için `view` içindeki her dize ve dizi alanı gezilir. Yalnız `top` ve `play` olaylarındaki `c` bir kart kodu olabilir.
    - `validateView` ve `validatePrivate` için kabul ve red durumları.
16. **Özellik testi:** belirli tohumlarla 200 oyun oynanır (2-8 oyuncu, iki set, rastgele ayrılma, yakalama, geç Tek!, "oynamak yerine çek").
    - Her adımda `validateState` geçer.
    - `validateView(publicView)` geçer.
    - İlk 40 oyunda her adımda, eldeki her benzersiz kart için `legalMoves.play` içinde olmak ile `applyMove` başarısı aynı sonucu verir.
    - Her oyun 20000 adımdan önce biter.
17. **Saflık:**
    - Modül boş vm bağlamında yüklenir.
    - Kaynakta `document`, `XMLHttpRequest`, `Math.random`, `Date`, `setTimeout` ve `t(` geçmez.
    - Dışa açılan nesne dondurulmuştur.
    - Derin dondurulmuş durumla `applyMove` hata vermez.
    - Kaynaktaki her `fail('...')` kodu `ERRORS` içindedir.

### 8.5 `test/oyun-ag.test.js` (dört cihaz, gerçek kripto)

Her cihaz bir vm bağlamıdır: nacl, crypto.js, 33, 34 ve 35 yüklenir. Bellekte bir "sunucu" yazılır: peerId'ler, eş başına sıralı teslim, `sid` ve `peer.ready` benzetimi. Tohumlu ağ koşulları:
- %10 kayıp.
- %5 çift teslim. Çift teslimde iletinin aynısı gider. voice.js'deki `fresh` bunu keser, bu yüzden benzetim de çifti dış katmanda keser. Ayrıca iç katmanın kendi koruması için kopya bir `p` yeni `n` ile de gönderilir (S3 benzetimi).
- 0-500 ms gecikme.

Senaryolar:
1. Dört kişi masaya oturur. Resmî ve eklemeli birer oyun bitene kadar oynanır (oyuncu yardımcısı: oynanabilir ilk kart, yoksa çek, Joker'de ilk renk).
2. Her adımdan sonra, ağ sakinleşince her oyuncunun son `view` ve `mine` değerleri kurpiyerin `publicView` ve `privateView` çıktısıyla aynıdır.
3. Hiçbir oyuncunun aldığı hiçbir iletinin açılmış düz metninde başka birinin eli bulunmaz (nesne yürüyüşü).
4. **Yeniden bağlanma:** aynı peerId ve yeni sid ile yolda kalan iletiler atılır, `peer-ready` sonrası oyun sürer.
5. **Oyuncu yenilemesi:** cihaz yeni bir vm ile, aynı peerId ile döner. "Oyuna Dön" kabul edilir. Sayaç `ack.seq` değerinden devam eder. Eski `state` (S3 yeniden oynatması) yeni sayfada `ni` yüzünden reddedilir.
6. **Kurpiyer yenilemesi:** oyuncular `close {why:'gone'}` alır ve `dealer_left` ile biter.
7. **Hayalet kurpiyer:** kurpiyerin bağlamı silinir, ağ iletileri yutar. Oyuncular 45 sn'de `dealer_lost` ile biter.
8. **S3 yeniden oynatması:** kaydedilmiş eski `act`, `leave` ve `join` zarfları yeni `n` ile yeniden gönderilir. Durum değişmez, kimse masadan atılmaz.

### 8.6 `test/oyun-arayuz.test.js`

Kalıp `test/ozel-arama-arayuz.test.js:22-58` ve 373-387 [D].

1. **index.html:**
   - `oyun.css` ve `renk.css` `tanitim.css` satırından sonra, `skins/arcade.css` satırından önce.
   - 33, 34, 35, 36, 37 bu sırayla ve `32-arama.js` satırından sonra.
   - Beş yeni sembol sprite'ta.
2. **sw.js:** yedi dosyanın hepsi listede.
3. **oyun.css ve renk.css** (yorumlar çıkarılarak):
   - Mevcut yasak özellik düzenli ifadesi eşleşmez.
   - Hex ve `rgba(` yok.
   - `@media (prefers-reduced-motion: reduce)` var.
   - `-webkit-inline-box` yok.
4. **tokens.css:** `--card-*` ve `--renk-*` belirteçleri. Kontrast testte hesaplanır, beş çiftin her biri 4.5:1'in üstünde.
5. **i18n kapsamı** (gerçek `i18n.js` ile, `I18N.setLang` kalıbı [D] music.test.js:1882-1907):
   - `TelsizRenk.ERRORS` içindeki her kod için `game.renk.err.<kod>`.
   - `EVENTS` içindeki her olay için `game.renk.ev.<e>` ya da `_one` ve `_other` eşi.
   - Her renk için `color` ve `letter` anahtarı. Harfler her dilde tekildir.
   - Her kural seti için `rules.<id>`, `rules.<id>Hint` ve `rulesLine.<id>`.
   - Her `game.reason.*`, `game.reject.*`, `game.ended.*` ve `game.status.*` anahtarı.
   - Bütün kontroller iki dilde yapılır.
6. **Marka denetimi:**
   - Desen `new RegExp('\\b' + String.fromCharCode(117, 110, 111) + '\\b', 'i')`.
   - Taranan yerler: yeni yedi JS ve CSS dosyası, bütün i18n değerleri, test ve e2e dosyaları, değişen belgeler.
   - Depoda bugün eşleşme yok [D] (`git grep -niw` ile denendi).
7. **Arayüz mantığı** (36 ve 37, `t`, `snap`, `voice`, `dmSendState`, `castSync` taklitleriyle vm içinde):
   - `renkCardLabel` iki dilde gerçek sözlükle (`'Kırmızı 7'`, `'Joker +4'`, `'Wild +4'`).
   - `gameToolState` (6.2 tablosu ve özel aramada gizlenme).
   - Duyuru yönlendirmesi: "Sıra sizde" assertive bölgeye, diğerleri polite bölgeye.
   - `gameRenderStage` aynı anahtarla ikinci kez çağrılınca DOM'a dokunmaz.
8. **22-cast.js kaynak denetimi:** `castModeFor` işlevi ve öncelik dizesi `watch`, `cams`, `game`, `own` sırasıyla bulunur.

### 8.7 `e2e/16-oyun.test.js`

```js
const test = h.makeTest(__filename, () => (W.w ? W.w.pages : []), { browsers: h.MIC_BROWSERS, reason: 'sahte mikrofon yok' })
// before: W.w = await h.setupWorld({ slot: 21, extraPeople: { aylin: 'Aylin' } })
```

Kullanılan yuvalar 1, 2, 3, 4, 5, 7, 9, 11, 14, 15, 17, 19, 20 [D]. 21 boştur.

**Kurulum:**
- Deniz 1440x900, Ece 1440x900, Mert 360x740, Aylin.
- Deniz Aylin'i engeller (`/api/blocks/add`).
- Dördü de `h.joinVoice(page, lobi.id)` ile katılır [D] e2e/yardimci.js:534.

**Oynatıcı yardımcısı `playOneTurn(page)`:**
- Sırası gelen sayfa (`.renk-table[data-turn="me"]`) için:
  - "Renk Seç" görünüyorsa ilk rengi seçer.
  - Yoksa `.renk-card.is-playable` varsa ona basar, seçici açılırsa ilk rengi seçer.
  - Yoksa Deste'ye basar, sonra "Pas Geç" etkinse ona basar.
- Bu yardımcı kural ayrıntısını sınamaz.

**Adımlar:**
1. `#radio-game` var. `.crew-dj` varsa son öğedir.
2. Deniz Oyun düğmesine basar.
   - `#cast[data-mode="game"]` görünür.
   - Resmî `aria-checked="true"`.
   - Aylin satırında "Engellediniz".
   - Masa Aç'a basılır.
3. Ece'de `#radio-game.is-invited` ve `#activity .activity-item.is-game` görünür. Mert'te `#radio-game.is-invited` görünür. Aylin'de 3 sn içinde davet görünmez.
4. Ece Masaya Bak'a basar, güven notunda "Kurpiyer Deniz" yazar, Katıl'a basar. Mert Reddet'e basar, Deniz'de Mert "Reddetti" olur. Mert düğmeden yeniden açıp Katıl'a basar.
5. Deniz Başlat'a basar.
   - Üç sayfada `.renk-hand .renk-card` sayısı 7.
   - Deniz'de `.renk-card` sayısı 8 (el ve atılan kart).
6. Altı tur `playOneTurn` oynanır. Her turdan sonra üç sayfada `.renk-pile` erişilebilir adı ve "Sıradaki" satırı aynıdır.
7. Mert'te `h.overflowX(page) <= 0` [D] e2e/yardimci.js:507 ve `.renk-hand` kendi içinde yatay kayar.
8. Mert `#voice-leave` ile ayrılır. Deniz ve Ece'de koltuk sayısı 2 olur, deste sayısı Mert'in el sayısı kadar artar.
9. Deniz sesten ayrılır. Ece'de "Kurpiyer ses odasından ayrıldı, oyun bitti." ve Kapat görünür. Kapat'a basınca sahne gizlenir, odak `#radio-game` düğmesine gider.
10. `h.assertCleanConsole(W.w.logs, W.w.srv.errors)` [D] e2e/yardimci.js:471. Eksik i18n anahtarı konsola uyarı yazdığı için testi düşürür [D] i18n.js:3999-4004.

Test için tohum kancası eklenmez, bir arka kapıya dönüşür.

---

## 9. Belgeler (TR ve EN çiftleri aynı commit'te)

| Belge çifti | Yer | İçerik |
|---|---|---|
| docs/MIMARI.md ve docs/ARCHITECTURE.md | "## Telsiz DJ" (163) ile "## Masaüstü uygulaması" / "## Desktop app" (175) arasına **"## Oyunlar" / "## Games"** | Yıldız düzeni, `game` sinyali, iç zarf, kurpiyer güveni, sürüm ve sayaçlar, canlılık, sunucu değişikliği olmadığı, Joker +4'ün otomatik denetimi. Cümle: "Kurallar kurpiyerin cihazında denetlenir. Joker +4 kısıtı bu yüzden otomatik uygulanır ve itiraz adımı yoktur." |
| | `## İstemci` (66), satır 70'teki modül aralığı | "`01-core.js` ile `37-renk.js`" |
| | "## Sınırlar" (203) içine kalın başlıklı paragraf | **Oyunlar ve kurpiyer.** Kurpiyerin bütün elleri bildiği, ilk görüş sınırı, S3'ün düz iletilerle hizmet engeli yapabildiği, Tek! yarışını varış sırasının belirlediği ve kurpiyer hamlelerinin 300 ms gecikmesi, sayfa yenilemede ses üyeliğinin kalması (hayalet) |
| docs/TASARIM.md ve docs/DESIGN.md | CSS tablosu (9-26) ve sıra cümlesi (26) | `oyun.css` ve `renk.css` satırları. Sıra cümlesine "tanitim, oyun, renk" eklenir |
| | "## Kamera" (169) ile "## Bileşenler" (179) arasına **"## Oyun masası" / "## Game table"** | Sahne kipi önceliği, kart yapısı, renk körlüğü üçlüsü (şekil, harf, ad), kart belirteçleri ve kontrast oranları, odak sırası, dokunma ölçüleri |
| README.md ve README.en.md | "## Özellikler" (13-45), DJ paragrafı kalıbıyla | **Oyunlar.** / **Games.** paragrafı: Renk, 2-8 oyuncu, kurpiyer güveni, kural setleri |
| CHANGELOG.md ve CHANGELOG.en.md | "## [Yayımlanmamış]" altında "### Yeni özellikler" / "## [Unreleased]" altında "### New features" | Tek madde |
| CONTRIBUTING.md ve CONTRIBUTING.en.md | Modül tablosu (99-132) | 33-37 satırları |
| | Güvenliğe hassas alanlar tablosu (172-182) | `public/js/33-oyun-protokol.js`, `public/js/34-oyun-masa.js`: iç zarf, bağ alanları, sayaçlar, tekrar koruması |

Her belge çiftinde "## " başlık sayıları eşit kalır [D] scripts/denetle.js:105-114, 1075-1101. MIMARI ve ARCHITECTURE birer, TASARIM ve DESIGN birer başlık kazanır. Düzyazıda noktalı virgül, uzun tire ve kısa tire kullanılmaz.

---

## 10. Uygulama sırası

Her adımın sonunda `npm run denetle` ve `npm test` geçer. Her adım ayrı bir commit'tir.

0. **Issue:** voice.js'e `game` düz metin türünün eklenmesi önerilir (CONTRIBUTING.md:184). Issue 3. bölümü, 3.1'deki boyut hesabını ve 4.15'teki tehdit tablosunu içerir. Onay gelmeden 1. adıma geçilmez.
1. **Taşıma:**
   - `public/voice.js` (3. bölümün tamamı).
   - `public/js/10-voice.js` `onGameEvent` (işleyici henüz yok, `typeof` koruması sayesinde zararsız) ve `gameRender` çağrısı.
   - `test/oyun-tasima.test.js`.
   - Görünür bir davranış değişikliği yoktur.
2. **Protokol çekirdeği:**
   - `33-oyun-protokol.js`.
   - index.html ve sw.js satırı.
   - `test/oyun-protokol.test.js`. Bağlantı denetiminin bu adımdaki kısmı aynı dosyaya yazılır, 6. adımda `oyun-arayuz` testine taşınır.
3. **Masa yöneticisi:** `34-oyun-masa.js`, liste satırları, `test/oyun-masa.test.js` (sayaç uygulamasıyla).
4. **Kural motoru:** `35-renk-kural.js`, liste satırları, `test/renk-kural.test.js`.
5. **Ağ benzetimi:** `test/oyun-ag.test.js`. Bu adımda bulunan hatalar 2, 3 ya da 4. adımın dosyalarında düzeltilir.
6. **Yapıştırıcı ve genel arayüz:**
   - `36-oyun.js`, `oyun.css`, tokens.css belirteçleri.
   - 22-cast.js `game` kipi, 28-bildirim.js, cast.css yorumu.
   - Bu adımın kullandığı bütün `game.*` i18n anahtarları.
   - `test/oyun-arayuz.test.js` (henüz Renk arayüzü olmadan).
   - Kayıtlı uygulama arayüzü olmadığı için Oyun düğmesi görünmez.
7. **Renk arayüzü:**
   - `37-renk.js`, `renk.css`, sprite sembolleri, `game.renk.*` anahtarları.
   - `oyun-arayuz` testinin Renk kısmı.
   - Özellik bu adımda görünür olur. Elle deneme: iki tarayıcı penceresiyle `npm start`, telefon genişliği, tam ekran, Joker seçici, ilk kart Joker.
8. **e2e:** `e2e/16-oyun.test.js`. `npm run test:e2e` Chromium ve Firefox ile çalıştırılır.
9. **Belgeler:** 9. bölümün tamamı tek commit'te.

---

## 11. Kalan riskler ve bilerek dışarıda bırakılanlar

### Kalan riskler

1. **Kurpiyer güveni (karar 3).** Kurpiyer elleri bilir ve hile yapabilir. Denetlenebilir karıştırma için kanonik deste ve dağıtım sırası şimdiden sabitlendi. Sonraki sürümde `rng` yerine tohumdan türetilen bir kaynak verilmesi yeterli olacak.
2. **Hayalet üyelik.** Sayfayı yenileyip ses odasına dönmeyen kişi kadroda kalır. Bu, ses motorunun mevcut bir davranışıdır [D] (4.11) ve ayrı bir iş olarak ele alınmalıdır. Oyunda "Uzakta" çipi ve "Koltuktan Çıkar" ile hafifletilir. Kurpiyer hayalet olursa oyuncular 45 sn bekler.
3. **Hız bütçesi.** Kurpiyerin bütün bağlantıları aynı anda yeniden kurulursa yaklaşık 91 istek olur. Bu sınırın altında ama dar. voice.js ortak penceredeki sayıyı dışarı vermiyor.
4. **Tek! yarışı.** Varış sırasına bağlıdır. Kurpiyerin 300 ms gecikmesi üstünlüğü azaltır ama sıfırlamaz [V].
5. **İlk görüşte sabitleme.** İç zarfın güveni özel mesajlarla aynıdır. Ortadaki adam saldırısı ancak güvenlik numarası karşılaştırmasıyla yakalanır.
6. **Çekilen kartla ilgili küçük bilgi sızıntısı** (1.2).
7. **Telefon yerleşimi [V].** 640 piksel yükseklikte masa, sohbet şeridi ve telsiz kartının birlikte sığması tarayıcıda denenmeli. Gerekirse Tam Ekran önerilir.
8. **Kolun yön tuşları [V].** PS5 tarayıcısında yön tuşlarının nasıl davrandığı cihazda denenmeli.
9. **Cihaz değişimi.** Aynı kişi başka cihazdan katılırsa koltuğunu kaybeder. Bu bilinçli bir basitleştirmedir.
10. **Tek! kuralının ekleme setinde de geçerli olması.** Kullanıcı kararının yorumudur, kullanıcıya doğrulatılmalı. Değişiklik tek bir sabittir (`LAST_CARD`) ve bir metindir (`stackHint`).

### Bilerek dışarıda bırakılanlar

- Özel aramada oyun (karar 7).
- Denetlenebilir karıştırma (karar 3).
- Kurpiyerliği devretme (karar 5).
- +4 itiraz adımı.
- "Sırayı Geç" ve otomatik koltuktan çıkarma.
- Eller arası toplam puan.
- El sonunda kalan elleri açma.
- İzleyici kipi: seste olmayan kişi sinyal alamaz [D] src/hub.js:788-797.
- Mikrofonsuz katılım: ses odasına girmek mikrofon ister [D] voice.js:2723 `createPeer`.
- Yeni ses türü, yüzen davet bildirimi, sistem bildirimi, koltukta kamera görüntüsü, tekerleği yatay kaydırmaya çevirme, telefonda yazma alanını gizleme, "Yeniden Davet Et" düğmesi, `dealing` aşaması, 30 sn "Yanıt Vermedi" zamanlayıcısı.
- Sahip ayarı ya da `games` izni. Gerekirse `ROLE_PERMS` (src/app.js:165 ve 03-auth.js:477) zinciri ve sunucu değişikliği ister.
- Pişti, Dört Taş ve XOX. Hepsi 5.1'deki sözleşmeyle `TelsizGameDesk` üzerinden eklenecek.

---

**İlgili dosyalar (mutlak yollar):**
- Harita ve raporlar: `/tmp/claude-0/-home-user-ps5-pc-communication/4f00f15f-448b-547a-84d4-7dd1552adf2f/scratchpad/oyun-harita.md`, `/tmp/claude-0/-home-user-ps5-pc-communication/4f00f15f-448b-547a-84d4-7dd1552adf2f/scratchpad/oyun-raporlar.md`
- Kontrast doğrulama betiği: `/tmp/claude-0/-home-user-ps5-pc-communication/4f00f15f-448b-547a-84d4-7dd1552adf2f/scratchpad/kontrast-dogrula.js`
- Kural prototipi (eski kart kodlarıyla, yalnız referans): `/tmp/claude-0/-home-user-ps5-pc-communication/4f00f15f-448b-547a-84d4-7dd1552adf2f/scratchpad/renk-proto/`
- Değişecek kaynaklar:
  - `/home/user/ps5-pc-communication/public/voice.js`
  - `/home/user/ps5-pc-communication/public/js/10-voice.js`
  - `/home/user/ps5-pc-communication/public/js/22-cast.js`
  - `/home/user/ps5-pc-communication/public/js/28-bildirim.js`
  - `/home/user/ps5-pc-communication/public/css/tokens.css`
  - `/home/user/ps5-pc-communication/public/css/cast.css`
  - `/home/user/ps5-pc-communication/public/index.html`
  - `/home/user/ps5-pc-communication/public/sw.js`
  - `/home/user/ps5-pc-communication/public/i18n.js`