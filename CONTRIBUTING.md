# Katkıda bulunma rehberi

[Türkçe](CONTRIBUTING.md) | [English](CONTRIBUTING.en.md)

Telsiz'e katkı yapmak istediğiniz için teşekkür ederiz. Telsiz, kendi sunucunuzda çalışan, uçtan uca şifreli ve açık kaynaklı bir yazılı ve sesli iletişim uygulamasıdır. Hata bildirimleri, gerçek cihazlardan (telefon, tablet, televizyon ve oyun konsolu tarayıcıları dahil) gelen deneme sonuçları, çeviri ve belge düzeltmeleri ve kod katkıları memnuniyetle karşılanır. Proje Türkçe ve İngilizce olarak sürdürülür. Issue'ları ve PR açıklamalarını iki dilden birinde yazabilirsiniz, arayüz metinleri ve belgeler her zaman iki dilde birlikte güncellenir.

## Davranış ilkesi

Bu projede herkesin saygılı ve yapıcı bir ortamda katkı yapabilmesi beklenir. Farklı deneyim düzeylerindeki kişilere sabırla yaklaşın, eleştirinizi kişiye değil koda ve fikre yöneltin. Hakaret, taciz, ayrımcılık ve kişisel bilgilerin izinsiz paylaşılması kabul edilmez. Bu ilkelere uymayan yorumlar ve katkılar depo sahibi tarafından düzenlenebilir, kapatılabilir veya engellenebilir.

## Güvenlik açıkları

Güvenlik açıklarını herkese açık bir issue, tartışma veya PR olarak bildirmeyin. Bunun yerine [SECURITY.md](SECURITY.md) dosyasında anlatılan özel bildirim yolunu kullanın.

## Hata bildirimi ve özellik isteği

Hataları ve özellik isteklerini deponun GitHub sayfasındaki Issues sekmesinden, hazır hata bildirimi ve özellik isteği formlarıyla açın. Hata bildiriminde cihazı ve tarayıcıyı, kullandığınız sürümü veya commit'i, kurulum yolunu (npm, tek dosya, Docker, depo veya masaüstü uygulaması), hatayı yeniden oluşturma adımlarını, beklediğiniz davranışı ve gerçekleşen davranışı yazın. Açmadan önce aynı konuda başka bir issue olup olmadığına bakın.

Issue'lara mesaj içeriklerini, anahtar kodlarını, davet bağlantılarını, kurulum kodlarını, parolaları, tünel adreslerini veya veri klasöründen dosyaları eklemeyin. Ekran görüntülerinde de bu bilgilerin görünmediğinden emin olun.

## Geliştirme ortamı

Geliştirme için git ve Node.js 20 veya daha yeni bir sürüm gerekir. CI denetimi ve testleri Ubuntu ve Windows üzerinde Node.js 20, 22 ve 24 ile çalıştırır.

1. Depoyu GitHub'da kendi hesabınıza çatallayın (fork).
2. Çatalınızı bilgisayarınıza klonlayın.
3. Proje klasöründe `npm ci` komutunu çalıştırın.
4. `npm run denetle` ve `npm test` komutlarıyla her şeyin geçtiğini doğrulayın.

`npm ci`, `package-lock.json` dosyasındaki sabit sürümlerle yalnızca geliştirme araçlarını kurar: denetleyicinin kullandığı `acorn`, uçtan uca testlerin kullandığı `playwright` ve tek dosya derlemesinin kullandığı `postject`. Sunucuyu çalıştırmak için bu adım gerekmez.

Uygulamayı elle denerken gerçek verinizi korumak için sunucuyu ayrı bir veri klasörüyle başlatın. Linux ve macOS'ta:

```sh
VERI_KLASORU=/tmp/telsiz-deneme node server.js
```

Windows komut isteminde:

```bat
set "VERI_KLASORU=%TEMP%\telsiz-deneme"
node server.js
```

Birden çok kullanıcıyı aynı bilgisayarda denemek için `http://localhost:3000` adresini farklı tarayıcı profillerinde veya gizli pencerelerde açın. Tarayıcı oturumu ve anahtarı adrese göre sakladığı için aynı profildeki sekmeler aynı hesabı kullanır. Sesli sohbet ve ekran paylaşımı yalnızca https adreslerinde ve `localhost` üzerinde çalışır.

## Testler ve denetim

| Komut | Görevi |
| --- | --- |
| `npm start` | Sunucuyu başlatır (`node server.js`) |
| `npm run denetle` | Yazım, sözdizimi, güvenlik, i18n ve belge eşliği kurallarını denetler (`scripts/denetle.js`) |
| `npm run lint` | `npm run denetle` ile aynı işi yapar |
| `npm test` | `test/` klasöründeki birim ve sunucu testlerini çalıştırır |
| `npm run test:e2e` | `e2e/` klasöründeki uçtan uca testleri Chromium ile, sırayla çalıştırır |
| `npm run exe` | Bu sistem için tek dosyalık sunucuyu `dist/` altına derler (`scripts/sea-derle.js`) |
| `npm run exe:duman` | Derlenen tek dosyalık sunucunun duman testini yapar (`scripts/sea-duman.js`) |

Test komutları, `node:test` ile çalışan test dosyalarını `scripts/test-calistir.js` aracılığıyla bulur. Bu betik Node.js sürümleri ve işletim sistemleri arasındaki klasör ve dosya kalıbı farklarını ortadan kaldırır.

Uçtan uca testler Playwright ile gerçek bir Chromium tarayıcısı açar. Tarayıcıyı `npx playwright install chromium` komutuyla indirebilirsiniz. Linux'ta tarayıcının sistem kütüphaneleri de gerekebilir, CI bunları `npx playwright install --with-deps chromium` komutuyla kurar. Playwright kendi kurulumunu bulamıyorsa `TELSIZ_E2E_CHROMIUM` ortam değişkeni Chromium'un yolunu verir, diğer seçenekler `e2e/yardimci.js` dosyasının başında anlatılır. Başarısız olan testler ekran görüntülerini `e2e-sonuclar/` klasörüne yazar.

Masaüstü uygulamasının kendi bağımlılıkları ve testleri vardır. Komutlar `desktop/` klasöründe çalıştırılır: `npm ci`, birim testleri için `npm test` ve paketlenmiş veya geliştirme düzenindeki uygulamanın duman testi için `npm run test:duman` (Linux'ta `xvfb-run -a npm run test:duman`). Ayrıntılar [desktop/README.md](desktop/README.md) dosyasındadır.

CI ayrıca kabuk betiklerini ShellCheck ve POSIX sözdizimi denetimiyle sınar, Docker imajını derleyip kapsayıcıyı başlatır ve tek dosyalık sunucuyu Windows, Linux x64 ve Linux arm64 için derleyip duman testinden geçirir.

## Proje yapısı

Sunucu, hiçbir çalışma zamanı bağımlılığı olmayan bir Node.js uygulamasıdır ve verileri JSON ve JSONL dosyalarında saklar. Gerçek zamanlı iletişim yalnızca HTTP long-polling ile yapılır. İstemci derleme adımı olmayan düz betik dosyalarından oluşur ve eski WebKit tabanlı konsol tarayıcılarıyla uyum için en fazla ES2017 sözdizimiyle yazılır. Ayrıntılı mimari [docs/MIMARI.md](docs/MIMARI.md) dosyasındadır.

| Yol | Görevi |
| --- | --- |
| `server.js` | Giriş noktası: ortam değişkenleri, `telsiz.env`, başlatma, banner, `sifre-sifirla` komutu, kapanış |
| `src/app.js` | `createChatServer(options)`, yönlendirme, API uç noktaları, yetkiler, hız sınırları, yüklemeler |
| `src/store.js` | Kalıcılık: `state.json`, oda başına JSONL mesaj dosyaları, yüklemeler, kilit dosyası |
| `src/auth.js` | Parola karması, ad doğrulama, oturumlar, hız sınırlayıcı, güvenilir vekil |
| `src/hub.js` | Çevrimiçi durumu, olay halkası, long-poll bekleyenleri, ses kadroları ve sinyal kuyrukları, yazıyor bilgisi |
| `src/social.js` | Arkadaşlıklar, engellemeler ve özel mesaj kuralları |
| `src/music.js` | Telsiz DJ'nin bellekteki şifreli oda durumları |
| `src/http-util.js`, `src/static-source.js` | Güvenlik başlıkları, CSP, gövde okuma, statik dosya beyaz listesi |
| `src/i18n.js`, `src/runtime.js`, `src/env-file.js` | Sunucu metinleri, sürüm ve tek dosya bilgisi, `telsiz.env` okuyucusu |
| `public/index.html` | Tek sayfa işaretleme ve SVG simge kümesi |
| `public/crypto.js` | `window.E2EE`: anahtar kodu, zarflar, dosya şifreleme, kişisel anahtarlar, sabitleme |
| `public/voice.js` | `window.VoiceClient`: WebRTC ses ve ekran paylaşımı motoru |
| `public/music.js`, `public/dj/youtube.js` | Telsiz DJ motoru ve YouTube oynatıcı bağdaştırıcısı |
| `public/i18n.js` | İstemcinin Türkçe ve İngilizce sözlükleri |
| `public/theme-init.js`, `public/css/` | Tema ön yükleyicisi, belirteçler, düzen, bileşenler ve temalar ([docs/TASARIM.md](docs/TASARIM.md)) |
| `public/sw.js` | Service worker, uygulama kabuğunun önbelleği |
| `public/vendor/` | TweetNaCl-js 1.0.3 ve scrypt-js 3.0.1, değiştirilmez |
| `desktop/` | Electron masaüstü uygulaması |
| `deploy/` | Docker Compose, Caddy, nginx ve systemd örnekleri |
| `scripts/` | Denetleyici, test çalıştırıcı, tek dosya derlemesi, sürüm notları |
| `test/`, `e2e/` | Birim ve sunucu testleri, uçtan uca testler |

İstemci modülleri `public/js/` altında numaralı dosyalardır ve `index.html` içinde bu sırayla yüklenir. Hepsi aynı genel kapsamı paylaşır, sonraki modül öncekilerin işlevlerini kullanabilir.

| Modül | Görevi |
| --- | --- |
| `01-core.js` | Sabitler, depolama anahtarları, `t()`, sunucu istekleri, biçim yardımcıları |
| `02-state-dom.js` | Uygulama durumu, öğe önbelleği, DOM yardımcıları, katman yığını, bildirimler |
| `03-auth.js` | Açılış, kurulum, davet, giriş, kayıt ve anahtar ekranları |
| `04-meta.js` | Üst çubuk, frekans bandı, İstasyonlar listesi, oda bilgisi, Yayındakiler listesi, oda seçimi |
| `05-poll.js` | Long-poll döngüsü, olayların işlenmesi, bildirimler |
| `06-messages.js` | Mesaj çözme, mesaj düğümleri, sayfalama, düzenleme ve silme |
| `07-attachments.js` | Satır içi resimler, dosya kartları, resim görüntüleyici |
| `08-composer.js` | Yazma alanı, gönderme, ek hazırlama, yükleme kuyruğu |
| `09-emoji.js` | Emoji seçici |
| `10-voice.js` | Ses arayüzü ve telsiz kartı |
| `11-settings.js` | Tam ekran ayarlar görünümü |
| `12-init.js` | Sayfalar, pencere boyutu, PWA, olay bağlama ve başlatma |
| `13-profile.js` | Profiller, profil kartı, durum menüsü |
| `14-social.js` | Arkadaşlar, engelleme, görünüm modu |
| `15-dm.js` | Özel mesajlar ve güvenlik numarası |
| `16-identity.js` | Paroladan anahtar türetme ve kişisel kimlik anahtarı |
| `17-search.js` | Cihazda arama |
| `18-mentions.js` | @ ile anma ve öneri listesi |
| `19-typing.js` | Yazıyor göstergesi |
| `20-desktop.js` | Masaüstü uygulaması tümleştirmesi |
| `21-band.js` | Frekans bandının etkileşimi (ibre, klavye, tekerlek, oyun kolu) |
| `22-cast.js` | Ekran paylaşımı arayüzü |
| `23-dj.js` | Telsiz DJ arayüzü |
| `24-frekans.js` | Frekanslar: üst çubuktaki frekans değiştirici menüsü, Frekans ekle ve çıkar, tarayıcıda adres parçasıyla liste taşıma, masaüstünde ana süreç çağrıları |

Yeni bir istemci modülü eklenirse `index.html` içindeki betik listesine ve `public/sw.js` içindeki kabuk listesine de eklenir.

## Kod kuralları

Aşağıdaki kuralların çoğu `npm run denetle` tarafından otomatik olarak denetlenir ve CI'da zorunludur. Denetleyici git'te izlenen dosyaları ve `.gitignore` dışında kalan yeni dosyaları tarar, `node_modules`, `public/vendor/` ve derleme çıktılarını atlar.

1. Hiçbir metin dosyasında uzun tire (U+2014) ve kısa tire (U+2013) bulunmaz. Gerektiğinde normal kısa çizgi (-), virgül veya iki nokta kullanılır.
2. Görünmez ve metnin yönünü değiştiren karakterler (sıfır genişlikli karakterler, bölünmez boşluk, yön işaretleri, dosya içindeki BOM) kullanılmaz. Kodda gerekiyorsa `\u` kaçışıyla yazılır.
3. Sunucu, betikler, testler ve masaüstü uygulaması dahil bütün JavaScript dosyaları noktalı virgülsüz yazılır (StandardJS stili). Satırlar açılış parantezi, açılış köşeli parantezi veya ters tırnakla başlatılmaz, çünkü noktalı virgülsüz yazımda önceki satırla birleşebilir. Girinti iki boşluktur ve dizgilerde tek tırnak kullanılır.
4. `public/` altındaki istemci kodu modülsüz düz betiktir ve ES2017 sözdizimiyle ayrıştırılabilmelidir. İsteğe bağlı zincirleme, boş birleştirme işleci, sınıf alanları, `import` ve `\p{...}` düzenli ifade kaçışları kullanılmaz.
5. İstemcide `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `Function` yapıcısı, `structuredClone`, `.replaceAll`, `Object.hasOwn` ve `.at()` yasaktır. Sayfaya yalnızca `createElement` ve `textContent` ile yazılır. Ağ istekleri `XMLHttpRequest` ile yapılır, `fetch` yalnızca `public/sw.js` içinde serbesttir.
6. HTML dosyalarında `style` özniteliği, `on...` olay öznitelikleri, `<style>` öğesi ve gövdeli `<script>` bulunmaz, çünkü içerik güvenliği politikası bunları engeller.
7. `public/vendor/` altındaki dosyalar hiçbir zaman değiştirilmez. Denetleyici `nacl-fast.min.js` ve `scrypt.js` dosyalarının sha256 değerini doğrular.
8. `.bat` dosyaları BOM'suz ve CRLF satır sonlarıyla kaydedilir, hiçbir satırında noktalı virgül bulunmaz. `.sh` dosyaları BOM'suz ve yalnızca LF satır sonlarıyla kaydedilir ve git'te çalıştırılabilir kipte (100755) saklanır.
9. JSON dosyaları geçerli JSON olmalıdır.
10. Markdown belgelerinde düzyazıda noktalı virgül kullanılmaz. Kod örnekleri kod bloğuna veya satır içi koda yazılır.
11. Gerçek zamanlı iletişim yalnızca long-polling ile yapılır, WebSocket veya Server-Sent Events eklenmez.
12. Çalışma zamanı bağımlılığı eklenmez, `package.json` içinde `dependencies` alanı yoktur. Yeni bir geliştirme bağımlılığı gerekiyorsa önce bir issue'da tartışın. Sürümler aralık işareti olmadan tam olarak sabitlenir.
13. Yorumlar Türkçe ve seyrek yazılır. Tanımlayıcılar, JSON alanları ve API yolları İngilizcedir. Türkçe karakterler (ç, ğ, ı, İ, ö, ş, ü) doğrudan kullanılır.
14. Stil dosyaları eski WebKit tabanlı tarayıcılarda da çalışacak biçimde yazılır: düzen flexbox ve margin ile kurulur, `grid`, flex `gap`, `clamp()`, `:is()`, `:where()`, `aspect-ratio` ve `inset` kullanılmaz. Ayrıntılar [docs/TASARIM.md](docs/TASARIM.md) dosyasındadır.
15. Testler Windows'ta da geçmelidir. Yollar `path.join` ile birleştirilir, geçici klasörler `os.tmpdir()` altında açılır, satır sonları hakkında varsayım yapılmaz ve testler SIGINT gibi süreç sinyallerine dayanmaz.

## İki dil kuralları

Kullanıcıya görünen her metin Türkçe ve İngilizce sözlüklerde birlikte bulunur. İstemcinin sözlükleri `public/i18n.js`, sunucunun sözlükleri `src/i18n.js` içindedir. Denetleyici şunları zorunlu tutar:

1. İki dilin anahtar kümeleri birebir aynıdır ve hiçbir değer boş değildir.
2. Bir anahtarın `{ad}` biçimindeki parametreleri iki dilde aynıdır.
3. Çoğul metinler `_one` ve `_other` sonekli iki anahtarla birlikte tanımlanır.
4. `t('...')` çağrılarındaki ve `data-i18n` özniteliklerindeki anahtarlar sözlükte vardır.
5. İstemci kodunda ve `src/` altında Türkçeye özgü harf içeren sabit metin bulunmaz. Bu tür metinler sözlüğe eklenir ve `t()` ile kullanılır.

Belgeler de iki dilde tutulur. `scripts/denetle.js` içindeki `DOC_PAIRS` listesindeki her Türkçe belgenin İngilizce eşi bulunmalı ve iki belgedeki `## ` başlık sayısı eşit olmalıdır. Örneğin `README.md` ile `README.en.md`, `docs/MIMARI.md` ile `docs/ARCHITECTURE.md`. Bir belgeyi değiştiren PR eşini de aynı içerikle günceller.

## Güvenlik açısından hassas alanlar

Aşağıdaki alanlara dokunan değişiklikler ek inceleme gerektirir. Bu PR'larda değişikliğin güvenliğe etkisini açıklamanız, değişikliği testlerle desteklemeniz ve incelemenin daha uzun sürebileceğini hesaba katmanız beklenir.

| Alan | Neden hassas |
| --- | --- |
| `public/crypto.js`, `public/js/16-identity.js` | Anahtar kodu, anahtar türetme, zarf biçimleri, kişisel anahtarlar ve sabitleme. Biçim değişirse kayıtlı geçmiş okunamaz hâle gelebilir. |
| `public/voice.js` | Ses ve ekran paylaşımı sinyallerinin şifrelenmesi, gönderen ve alıcının doğrulanması, yeniden oynatma koruması |
| `public/music.js`, `public/dj/youtube.js` | Şifreli DJ durumunun doğrulanması, YouTube çerçevesinin yalıtılması ve onay kuralı |
| `src/auth.js`, `src/app.js` | Parola karması, oturumlar, yetkiler, hız sınırları, güvenilir vekil |
| Yüklemeler (`src/app.js`, `src/store.js`, `public/js/07-attachments.js`, `public/js/08-composer.js`) | Boyut ve kota sınırları, indirme yetkisi, dosya adı temizliği, fotoğraf üst verilerinin silinmesi |
| `src/http-util.js`, `src/static-source.js` | Güvenlik başlıkları, içerik güvenliği politikası, statik dosya beyaz listesi |
| `public/sw.js` | Önbelleğe alınan içerik ve `/api/` isteklerinin önbelleğe alınmaması |
| `desktop/src/` | Bütünlük doğrulaması, vekil, izinler, IPC ve gezinme kuralları, güncelleme denetimi (`desktop/src/lib/updates.js`) |
| `.github/workflows/release.yml`, `desktop/electron-builder.json` | Yayına giren dosyaların beyaz listesi, otomatik güncelleme bilgi dosyaları, npm yayınının kimlik doğrulaması |

Şifreleme protokolünü (anahtar kodu, anahtar türetme, zarf veya düz metin biçimi) değiştiren bir öneriyi kod yazmadan önce bir issue'da tartışın.

## Dal ve PR süreci

1. Çatalınızda `main` dalından yeni bir dal açın.
2. Değişikliği küçük ve tek bir konuya odaklı tutun.
3. Davranış değiştiyse testleri ekleyin veya güncelleyin.
4. `npm run denetle` komutunu çalıştırın.
5. `npm test` komutunu çalıştırın.
6. Arayüzü etkileyen değişikliklerde `npm run test:e2e` komutunu da çalıştırın.
7. Masaüstü uygulamasını etkileyen değişikliklerde `desktop/` klasöründe `npm test` komutunu çalıştırın.
8. PR'ı bu deponun `main` dalına açın ve PR şablonundaki bölümleri doldurun.
9. CI denetimlerinin başarılı olduğunu kontrol edin ve inceleme yorumlarını yanıtlayın.

Birbirinden bağımsız değişiklikleri ayrı PR'lar olarak gönderin. Kullanıcının gördüğü davranışı değiştiren bir değişiklikte README dosyalarını, mimariyi değiştiren bir değişiklikte `docs/MIMARI.md` ve `docs/ARCHITECTURE.md` dosyalarını, sürüme girecek önemli değişikliklerde iki CHANGELOG dosyasını da güncelleyin. Büyük bir değişikliğe başlamadan önce bir issue açıp yaklaşımı tartışmanız, emeğinizin boşa gitmemesi için önerilir.

## Sürüm yayını

Sürümü depo sahibi yayımlar: `package.json`, `desktop/package.json` ve iki CHANGELOG dosyası güncellenir, `main` dalındaki commit'e `v` ile başlayan bir etiket (ör. `v2.1.0`) gönderilir. `.github/workflows/release.yml` gerisini yapar:

- Denetim ve testlerden sonra sunucu ikilileri ve masaüstü paketleri derlenir. GitHub Release'e yalnızca beyaz listedeki dosyalar eklenir: sunucu ikilileri, masaüstü paketleri, otomatik güncelleme bilgileri (`latest.yml`, `latest-linux.yml`, `Telsiz-Kurulum-<sürüm>.exe.blockmap`) ve hepsinin `SHA256SUMS.txt` dosyası. `desktop/scripts/guncelleme-dosyalari.js` bilgi dosyalarında adı geçen paketlerin yayında aynı adla bulunduğunu ve sha512 değerlerinin tuttuğunu denetler.
- Docker imajı `ghcr.io/yerlifan/telsiz` olarak yayımlanır.
- npm paketi `telsiz` npm trusted publishing (OIDC) ile tokensız ve provenance bilgisiyle yayımlanır. npmjs.com'daki paket ayarlarında güvenilen yayıncı tanımlıdır: GitHub Actions, `Yerlifan/telsiz`, iş akışı dosyası `release.yml`, ortam yok. npm belgelerine göre bu yol npm CLI 11.5.1 veya sonrasını ve Node.js 22.14.0 veya sonrasını gerektirir, iş sabitlenmiş bir npm 11 sürümü kurar ve ikisini de denetler. `NPM_TOKEN` gizli değişkeni tanımlıysa yalnızca yedektir: npm önce OIDC'yi dener. İlk OIDC yayını başarılı olduktan sonra `NPM_TOKEN` silinebilir ve npmjs.com'da paket için token ile yayın kapatılabilir ("Require two-factor authentication and disallow tokens"). İş akışı dosyasının adı değişirse güvenilen yayıncı ayarı da değiştirilmelidir.

Masaüstü güncellemeleri imzasız olduğu için bütünlükleri GitHub hesabının ve deposunun güvenliğine dayanır. Depo sahibinin ve yazma yetkisi olan herkesin hesabında iki adımlı doğrulama (2FA) açık olmalıdır. Güncelleme denetimi depo herkese açıkken çalışır.

## Lisans

Katkılarınız projenin MIT lisansı altında dağıtılır, ayrıntılar için [LICENSE](LICENSE) dosyasına bakın. `public/vendor/` altındaki TweetNaCl-js (Unlicense) ve scrypt-js (MIT) ile `public/fonts/` altındaki yazı tipleri (SIL Open Font License) kendi lisanslarıyla dağıtılır.
