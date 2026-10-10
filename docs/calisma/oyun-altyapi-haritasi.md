# Telsiz oyun altyapısı: birleşik uygulama haritası (Uno, sonra Pişti, Dört Taş, XOX)

Dört rapor birleştirildi. Raporlar arasında çelişen yerleri kodu okuyarak doğruladım. Hiçbir dosya değiştirilmedi.

## 0. Rapor çelişkileri ve doğrulanan sonuç

| Konu | Raporlarda geçen | Koddaki durum |
|---|---|---|
| Gizli el için sunucu değişikliği | duzen: "sunucuya yeni doğrulama ve uç nokta gerekir" | **Gerekmez.** Sunucu yalnız dış zarfın biçimine bakıyor: `ENVELOPE_RE` (src/app.js:150), `validEnvelope` (855-857), kullanım yeri 3322. `sealJson` istenen JSON'u şifreliyor (public/crypto.js:672-683). İçerideki `'2.'` dizesini sunucu göremez. |
| `maxVoicePerChannel` satırı | sinyal: app.js:61 | Doğrusu src/app.js:57 (8). Değer 2 ile 12 arasına sıkıştırılıyor (187-188, 756-758). |
| `clearVoice` satırı | 162-171 / 161-170 | Doğrusu src/hub.js:161-170. |
| Oyuncu ayrıldı olayını nereden yaymalı | sinyal: `closePeer` (2684-2687) | **Yanlış yer.** `closePeer(peer,'reconnect')` yeniden bağlanmada da çağrılıyor (voice.js:3110, 3171). Ayrılma yalnız `applyRoster` silme döngüsünden yayılmalı (5127-5136). Yeniden bağlanma "eşitleme bekleniyor" olarak ele alınmalı. |
| Kişisel şifreleme API'si | arayuz: crypto.js:818-825 | Doğrusu `dmSeal` crypto.js:1169, `dmOpen` 1187, dışa açılış `E2EE.dm` 1454. |
| Özel aramada oyun | sunucu: olur / arayuz: dışarıda bırak | Teknik olarak olur, `privateSeal` zaten çift anahtarı kullanıyor (voice.js:3263, 10-voice.js:261-292). İlk sürümde ürün kararı olarak dışarıda bırakmak öneriliyor (açık soru 5). |

## 1. İletim

**Hat.** Mevcut şifreli ses sinyali kullanılıyor: `sendSignal` (public/voice.js:3253) çağrılınca `POST /api/voice/signal` (src/app.js:3317-3330) üzerinden `hub.signal` (src/hub.js:788-797) çalışıyor. İleti alıcının long-poll yanıtında geliyor (05-poll.js:124-137) ve `voice.handleSignals` (voice.js:3381) ile işleniyor. Herkese birden gönderme yok. Her alıcıya ayrı bir POST gidiyor (`announceAll` kalıbı, 3672-3680).

**Şifreleme.**
- Dış katman `seal({v:1, from, to, d})`, yani grup anahtarı (voice.js:3265, 10-voice.js:26).
- Alıcı tarafta `verify` şunları denetliyor: kid, from/to bağı (3322), sid/n, tekrar koruması `fresh` (3339-3352). Sunucu bir iletiyi başka alıcıya yönlendiremez. Normal istemci başkasına yazılmış iletiyi zaten atar.

**Sınırlar.**
- Zarf en fazla 32000 karakter (app.js:62).
- Gönderen kullanıcı başına 120 sinyal / 10 sn (app.js:99-100, 3318). Bütçe WebRTC iletileriyle ve kullanıcının bütün oturumlarıyla ortak.
- 0, 429 ve 5xx yanıtlarında 3 kez yeniden deneniyor, beklemeler 1, 2 ve 4 sn (voice.js:69, 3296-3299). Sonunda da gitmezse `onFail` çağrılıyor.
- Sunucu kuyruğu 200 iletiyi aşınca en eskiler sessizce atılıyor (hub.js:25, 794). Bir poll en fazla 100 sinyal taşıyor (hub.js:24).
- Kuyruk kalıcı değil: sesten çıkınca, oda değişince, çevrimdışına düşünce ve sunucu yeniden başlayınca boşalıyor (hub.js:161-170, 187-194).

**Sıra.** Sıra eş başına korunuyor: gönderimde sıralı kuyruk (3276-3281), alımda seq sıralaması (3381-3394) ve `runOp` (2890-2899). Eşler arasında ortak bir sıra yok. Bu yüzden **yıldız düzeni** öneriliyor: kurpiyer bütün durumu tutar, her oyuncuyla tek ve sıralı bir kanal üzerinden konuşur.

**voice.js içinde değişmesi gerekenler.** Şu an tanınmayan türler atılıyor (voice.js:3328).
1. `GAME_KEYS` ve `MAX_GAME_CHARS` sabitleri (115 civarı).
2. Saf `validGameSignal`: `{type:'game', sid, n, g, k, p}`, alanlar `onlyKeys` (665) ile denetlenir, `p` uzunluğu sınırlı bir dizedir (762 yanına).
3. `verify` beyaz listesine eklenir, `fresh` çağrısından önce katı doğrulama yapılır (3325-3333).
4. `processSignal` içine `game` dalı: `peer && peer.sid === sid && peer.ready` denetlenir (3225-3235 yanına).
5. `opts.onGameEvent` (805 yanına) ve `screenEvent` kalıbında bir `gameEvent` (3405).
6. `sendGame(userId, msg)` ve `broadcastGame(msg)`. Her eşe yeni bir nesne verilmeli, çünkü `sendSignal` nesneye sid ve n yazıyor (3256-3258).
7. Yaşam döngüsü olayları: `peer-ready` (afterStable 3119-3121), `peer-leave` (yalnız applyRoster 5127-5136), `reset` (resetSession 5228). Ayrıca dönen nesneye (5584-5634) ve `gameUtils.validateSignal` olarak fabrika dönüşüne (5636-5668) eklenir.

voice.js yalnız taşıma yapmalı. `p` içeriğinin anlamı ve doğrulaması oyun modülünde olmalı. Böylece güvenliğe hassas yüzey küçük kalır.

**05-poll.js içinde ayrı bir dağıtıcı önerilmez.** Bu, `verify` ve `fresh` güvenlik mantığının kopyalanması demek olur.

**Sunucu:** ilk sürümde hiçbir değişiklik gerekmez. Özel aramada `'2.'` zarfı kendiliğinden kullanılıyor (app.js:3322).

**Bütçe hesabı (6 kişi).** Kurpiyer her hamlede diğer 5 kişiye birer POST gönderir. Oyuncu hamlesi kurpiyere 1 POST'tur. Dağıtımda her oyuncuya tek ileti gider, kart başına ileti gönderilmez. Eldeki kartlar kısa kodlarla yazılırsa iki kat base64 eklense bile ileti 32000 sınırının çok altında kalır. Sürükleme gibi sürekli akan iletilerden kaçınılmalı.

## 2. Gizli el: pratik seçenekler

**Neden ek katman gerekiyor.** Grup anahtarı frekanstaki bütün üyelerde var (`activeKid`). Sunucuyu işleten kişi aynı zamanda üyeyse, kuyruktaki zarfı (hub.js:793) alıp açabilir. Bu yüzden el içeriği `p` alanında ikinci bir katmanla taşınmalı:
- Kurpiyer `E2EE.dm.seal(obj, oyuncuPk, benimSk)` kullanır (crypto.js:1169).
- Oyuncu `E2EE.dm.open(p, [kurpiyerPk], benimSk)` ile açar (1187).
- Anahtarlar `dmSendState(userId)` (15-dm.js:184-200) ve `myIdentity()` (16-identity.js:207-223) üzerinden gelir. `joinCallRoom` ile aynı kalıp (10-voice.js:261-292).
- İç düz metin `{g, r, from, to}` alanlarını taşımalı. Böylece eski bir el başka bir oyunda yeniden oynatılamaz.

**A. Kurpiyer oyunu başlatan kişidir (ilk sürüm için önerilen).**
- Desteyi `nacl.randomBytes` ile karıştırır (crypto.js:5, 110). Her oyuncuya elini yalnız ona giden ve iç katmanla şifrelenmiş iletiyle yollar. Çekme destesini tutar, hamleleri doğrular.
- Güven sınırı: kurpiyer bütün elleri görür ve hile yapabilir. Sunucu ve diğer üyeler göremez.
- İç katmanın güveni özel mesajlarla aynıdır: grup anahtarıyla mühürlenmiş kimlik bağlaması ve ilk görüşte sabitleme (docs/MIMARI.md:98).
- Kurpiyerin elleri görmesi arayüzde açıkça yazmalı.

**B. A'ya ek olarak denetlenebilir karıştırma (sonraki sürüm).**
- Her oyuncu kendi tohumunun `nacl.hash` değerini herkese duyurur, tohumun kendisini yalnız kurpiyere iç katmanla yollar. Kurpiyer de kendi tohumunu önceden bağlar.
- Oyun sonunda bütün tohumlar açılır, herkes desteyi yeniden hesaplayıp aldığı kartları denetler.
- Kurpiyer elleri yine görür, ama desteyi seçemez ve oyun sırasında değiştiremez.

**C. Oynamayan bir kurpiyer.** Odadaki üçüncü bir kişi kurpiyerlik yapar. Bilgi üstünlüğü ortadan kalkar, ama her zaman böyle biri bulunmaz.

**D. Zihinsel poker: önerilmez.**
- BigInt sözdizimi ES2017 ayrıştırmasında hata veriyor (scripts/denetle.js:279-281).
- Çalışma zamanı bağımlılığı eklenemez (CONTRIBUTING.md:151).
- Çok turlu bir protokol hız bütçesini zorlar.

**Oyunlara göre durum.**
- XOX ve Dört Taş'ta gizli bilgi yok, iç katman gerekmez.
- Pişti, Uno ile aynı modelle (A) oynanabilir.

**İç katmanın kurulamadığı oyuncular.** `dmSendState` şu durumlarda `ok` dönmez: kimlik bu cihazda kilitli (`locked`), anahtar doğrulanmamış (`unverified`), kişi engellenmiş (`blocked`), anahtar değişmiş (`changed`). Bu oyunculara el gönderilemez. Oyun başlamadan denetlenmeli. Profiller `profilesEnsure` ile yüklenmeli (13-profile.js:114).

## 3. Arayüz yerleşimi

**Telsiz kartı.**
- Araç satırı `#radio-tools` (index.html:636) içine bir "Oyun" düğmesi konur. `#i-gamepad` simgesi hazır (index.html:151).
- Sıra kuralı: Büyüt düğmesi kendini başa koyuyor (10-voice.js:615), DJ düğmesi kendini sona taşıyor (23-dj.js:1003-1009). Oyun düğmesi bu ikisinin arasına girmeli.
- `renderVoiceAll` (10-voice.js:166-182) yalnız yapı anahtarı değişince çalışıyor ve bu anahtarda oyun durumu yok. Düğmeyi çizdirmek için `aramaRender` gibi `typeof` korumalı bir çağrı (181) ya da DJ'deki gibi bir MutationObserver (23-dj.js:1202-1207) kullanılabilir.
- Özel aramada düğme gizlenmeli (`s.private`, 10-voice.js:714-717).
- Davet rozeti oyun modülünden güncellenir. Davet bildirimi için 28-bildirim.js listesi uygun bir yer.

**Sahne (`#cast`).**
- Sahne başka bir modülden açık tutulamaz, çünkü kip yalnız `castSync` içinde seçiliyor (22-cast.js:238) ve kip boşsa sahne kapanıyor (596-601). `castSync` her ses yapısı değişiminde çağrılıyor (10-voice.js:179).
- Bu yüzden 22-cast.js'e `game` kipi eklenmeli. Değişecek yerler:
  - kip seçimi (238)
  - görünürlük satırları (621-631)
  - çizim dalı (637-643)
  - `castChatOpen` (867-870)
  - `castCloseStage`
  - sağ sütunu gizleyen seçici (frekans.css:1349-1358)
  - telefonda sahne yüksekliği: şu an 56.25vw (cast.css:1211-1215), bir el kart için kısa
  - sözleşme yorumları (22-cast.js:12-24, cast.css:2-8)
- Açma ve kapama `castToggleCams` ve `castCloseCams` örneğine göre yapılır (355-381). Oyuncu ses odasından ayrılınca oyun da kapanmalı.

**Konsol ve televizyon.** Bütün denetimler odaklanabilir düğme olmalı (`data-focus-key`). Esc ve oyun kolunun daire düğmesi tam ekrandan çıkarıyor (22-cast.js:26-28).

**CSS ve HTML kuralları.**
- `grid`, `gap`, `clamp`, `:is`, `:where`, `aspect-ratio` ve `inset` yasak. Ölçüler `rem` ile verilir (CONTRIBUTING.md:153).
- Renkler yalnız `var(--...)` ile. Kart zemin renkleri için tokens.css'e açık ve koyu mod belirteçleri eklenmeli.
- z-index 110'dan küçük olmalı (dj.css:647).
- `innerHTML` yasak. Öğeler `h()`, `icon()` ve `button()` ile kurulur (02-state-dom.js:132-170).

## 4. Kaydedilmesi gereken dosyalar ve listeler

**Yeni dosyalar.**
- `public/js/33-oyun.js`. Saf kurallar ve protokol ayrı bir dosyaya da alınabilir (ör. 34-...).
- `public/css/oyun.css`.
- `public/js/` ve `public/css/` altındaki dosyalar sunucuda ve masaüstünde otomatik sunuluyor (src/app.js:282-288, desktop/src/lib/static-files.js:58-59).
- Dosya kök dizine konursa şunlar da gerekir: `addStatic` (app.js:253-278), masaüstünde `addFixed`, test/server-http.test.js:42-43 beklentileri ve test/server-yardimci.js FIXTURE.

**Listeler.**
- `public/index.html`: CSS satırı 30'dan (tanitim.css) sonra, 31'den (skins) önce. Betik satırı 73'ten (32-arama.js) sonra. Statik bir kimlik eklenirse `ELEMENT_IDS` listesine de yazılır (02-state-dom.js:81-118).
- `public/sw.js` SHELL: CSS satırı 28'den, JS satırı 69'dan sonra. `CACHE_NAME` (satır 11) değiştirilmez.
- `public/i18n.js`: `game.*` anahtarları `tr` (24-1959) ve `en` (1961-3896) sözlüklerine birlikte eklenir. Kart adları da sözlüğe girer, çünkü istemci kodunda Türkçe harfli sabit metin yasak.
- Değişecek mevcut dosyalar: `public/voice.js` (bölüm 1'deki 7 nokta), `public/js/10-voice.js` (21-48 arasına `onGameEvent`), `public/js/22-cast.js`, `public/css/cast.css`, `public/css/frekans.css`, `tokens.css`.

## 5. Test ve belge yükümlülükleri

**Testler.**
- **Saf kurallar** (dağıtım, geçerli hamle, puan) için yeni bir test. Taşıma doğrulayıcısı için kamera.test.js:28'deki `loadVoice` kalıbıyla `gameUtils.validateSignal` testi.
- **Motor:** screenshare.test.js'teki sahte seal/open ile çok motorlu benzetim (yaklaşık 1202). Denenecek durumlar: `!peer.ready` ya da eski sid ile gelen iletinin atılması, oyuncu ayrılınca olay yayılması, `onFail`.
- **Gizli el:** music.test.js:44'teki `loadDevice` kalıbıyla gerçek nacl ve crypto.js yüklenir. Sınanacak şey: C oyuncusu B'nin elini açamamalı.
- **Arayüz:** ozel-arama-arayuz.test.js kalıbı (22-58, 373-387): index.html ve sw.js sırası, yasak CSS özellikleri, hareketi azalt bloğu. Bunu otomatik denetleyen genel bir test yok, yeni modül kendi testinde denetlemeli.
- **e2e:** `e2e/16-oyun.test.js`.
  - Boş port yuvaları 6, 12, 13, 18 ve 21+ (grep ile doğrulandı).
  - `browsers: h.MIC_BROWSERS` (yardimci.js:46).
  - 3'ten fazla oyuncu için `extraPeople`.
  - `joinVoice` (520) ve `assertCleanConsole` (471). Eksik i18n anahtarı konsola uyarı yazdığı için e2e'yi düşürür.
- **Komutlar:** `npm run denetle`, `npm test`, `npm run test:e2e`.

**Belgeler.**
- docs/MIMARI.md ve ARCHITECTURE.md: "## Telsiz DJ" (163) ile "## Masaüstü uygulaması" (175) arasına "## Oyunlar" ve "## Games". Ayrıca modül aralığı (:70) ve "## Sınırlar" (203+) içine kurpiyer güveni ve bütünlük paragrafı.
- README ve README.en Özellikler bölümü (13-45).
- CHANGELOG ve .en, Yayımlanmamış bölümü.
- CONTRIBUTING ve .en: modül tablosu (99-132) ve güvenliğe hassas alanlar tablosu (172-182).
- TASARIM ve DESIGN CSS tablosu.
- Belge çiftlerinde `## ` başlık sayısı eşit kalmalı. Uzun ve kısa tire kullanılmaz. Markdown düzyazısında noktalı virgül kullanılmaz.

## 6. Açık sorular ve riskler

1. **Kurpiyer güveni.** A modeli kabul ediliyor mu (kurpiyer bütün elleri görür)? B modeli ilk sürüme girecek mi?
2. **Kurpiyer ayrılırsa.** Öneri: oyun biter. Kurpiyerliği devretmek, desteyi ve elleri yeni kişiye açmak demek.
3. **Mikrofonsuz kişi oyuna katılamaz** (voice.js:2691, doJoin 5333-5341). İzleyici kipi de yok.
4. **İç katman kurulamayan oyuncu.** Kimliği kilitli, anahtarı doğrulanmamış ya da engellenmiş oyuncu oyuna alınmasın mı, yoksa grup anahtarıyla zayıf bir yedek mi kullanılsın?
5. **Özel arama.** İki kişilik XOX ve Dört Taş özel aramada da açılsın mı? İlk sürümde kapalı tutmak öneriliyor.
6. **Sahne kip önceliği.** Oyun açıkken ekran paylaşımı ya da kamera ızgarası açılırsa hangisi öne geçer?
7. **Kayıp ve eşitleme.**
   - Yeniden bağlanmada sid değişir ve yoldaki iletiler atılır (3107-3112).
   - Oyuncu sayfayı yenilerse yeni bir peerId alır. Koltuklar bu yüzden userId ile tutulmalı.
   - Tur numarası, `sync` isteği ve `peer-ready` olayında tam durumun yeniden gönderilmesi gerekir.
8. **Hız bütçesi.** 429 yanıtının 1, 2 ve 4 sn beklemesi oyunda gecikme olarak hissedilir. ICE adayları da aynı bütçeden düşüyor.
9. **Süreç.** voice.js güvenliğe hassas bir alan (CONTRIBUTING.md:175). Yeni bir düz metin türü eklemek "düz metin biçimi" değişikliği sayılır ve önce bir issue'da tartışılmalı (184).
10. **Sahip ayarı ve izin.** Oyunları açıp kapatma ayarı ya da `games` izni ilk sürümde yok. İstenirse music zincirindeki sunucu değişiklikleri gerekir: `ROLE_PERMS` (src/app.js:165 ve 03-auth.js:477) ile `handleSettings`.
11. **Telefon.** Araç satırında üç etiketli düğme sıkışabilir (radio.css 759 px altı). Bu tarayıcıda denenmedi.
12. **Belgedeki eski bilgi.** docs/MIMARI.md:14'teki şema hâlâ "01..29" diyor, ama modüller 32'ye kadar gidiyor.