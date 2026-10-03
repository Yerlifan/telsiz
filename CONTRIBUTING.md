# Katkıda bulunma rehberi

PS5 + PC Sohbet'e katkı yapmak istediğiniz için teşekkür ederiz. Proje, Discord'a erişemeyen arkadaş gruplarının bilgisayardan, PS5'ten, telefondan ve tabletten ortak kullanabileceği, uçtan uca şifreli bir sohbet uygulamasıdır. Hata bildirimleri, gerçek cihazlardan (özellikle PS5'ten) gelen deneme sonuçları, belge düzeltmeleri ve kod katkıları memnuniyetle karşılanır. Projenin dili Türkçedir. Issue'ları, PR açıklamalarını ve arayüz metinlerini Türkçe yazmanızı rica ederiz.

## Davranış ilkesi

Bu projede herkesin saygılı ve yapıcı bir ortamda katkı yapabilmesi beklenir. Farklı deneyim düzeylerindeki kişilere sabırla yaklaşın, eleştirinizi kişiye değil koda ve fikre yöneltin. Hakaret, taciz, ayrımcılık ve kişisel bilgilerin izinsiz paylaşılması kabul edilmez. Bu ilkelere uymayan yorumlar ve katkılar depo sahibi tarafından düzenlenebilir, kapatılabilir veya engellenebilir.

## Güvenlik açıkları

Güvenlik açıklarını herkese açık bir issue, tartışma veya PR olarak bildirmeyin. Bunun yerine [SECURITY.md](SECURITY.md) dosyasında anlatılan özel bildirim yolunu kullanın.

## Hata bildirimi ve özellik isteği

Hataları ve özellik isteklerini deponun GitHub sayfasındaki Issues sekmesinden, hazır hata bildirimi ve özellik isteği formlarıyla açın. Hata bildiriminde cihazı ve tarayıcıyı (PC, PS5, Android, iOS veya tablet), kullandığınız sürümü veya commit'i, hatayı yeniden oluşturma adımlarını, beklediğiniz davranışı ve gerçekleşen davranışı yazın. Açmadan önce aynı konuda başka bir issue olup olmadığına bakın.

Issue'lara mesaj içeriklerini, anahtar kodlarını, davet bağlantılarını, parolaları, tünel adreslerini veya `veri` klasöründen dosyaları eklemeyin. Ekran görüntülerinde de bu bilgilerin görünmediğinden emin olun.

## Geliştirme ortamı

Geliştirme için git ve Node.js 20 veya daha yeni bir sürüm gerekir. CI testleri Ubuntu ve Windows üzerinde Node.js 20, 22 ve 24 ile çalıştırır.

1. Depoyu GitHub'da kendi hesabınıza çatallayın (fork).
2. Çatalınızı bilgisayarınıza klonlayın.
3. Proje klasöründe `npm ci` komutunu çalıştırın.
4. `npm test` komutuyla testlerin geçtiğini doğrulayın.

`npm ci`, `package-lock.json` dosyasındaki sabit sürümlerle yalnızca geliştirme araçlarını (`acorn` ve `playwright`) kurar. Sunucuyu çalıştırmak için bu adım gerekmez.

| Komut | Görevi |
|---|---|
| `npm start` | Sunucuyu başlatır (`node server.js`) |
| `npm test` | `test/` klasöründeki birim ve sunucu testlerini çalıştırır |
| `npm run denetle` | Yazım, sözdizimi ve güvenlik kurallarını denetler (`scripts/denetle.js`) |
| `npm run lint` | `npm run denetle` ile aynı işi yapar |
| `npm run test:e2e` | `e2e/` klasöründeki uçtan uca testleri Chromium ile, sırayla çalıştırır |

Test komutları, `node:test` ile çalışan test dosyalarını `scripts/test-calistir.js` aracılığıyla bulur. Bu betik, Node.js sürümleri ve işletim sistemleri arasındaki klasör ve dosya kalıbı farklarını ortadan kaldırır.

Uçtan uca testler Playwright kütüphanesiyle gerçek bir Chromium tarayıcısı açar. Playwright'ın Chromium tarayıcısını `npx playwright install chromium` komutuyla indirebilirsiniz. Linux'ta tarayıcının sistem kütüphaneleri de gerekebilir, CI bunları `npx playwright install --with-deps chromium` komutuyla kurar. Başarısız olan testler ekran görüntülerini `e2e-sonuclar/` klasörüne yazar. Tarayıcının hangi seçeneklerle başlatıldığı `e2e/yardimci.js` dosyasında görülebilir.

Uygulamayı elle denerken gerçek verinizi korumak için sunucuyu ayrı bir veri klasörüyle başlatabilirsiniz. Linux ve macOS'ta:

```sh
VERI_KLASORU=/tmp/sohbet-deneme node server.js
```

Windows komut isteminde:

```bat
set "VERI_KLASORU=%TEMP%\sohbet-deneme"
node server.js
```

Birden çok kullanıcıyı aynı bilgisayarda denemek için `http://localhost:3000` adresini farklı tarayıcı profillerinde veya gizli pencerelerde açın. Tarayıcı giriş bilgisini ve anahtarı adrese göre sakladığı için aynı profildeki sekmeler aynı hesabı kullanır. Sesli sohbet yalnızca https adreslerinde ve `localhost` üzerinde çalışır.

## Mimari özet

Sunucu, hiçbir çalışma zamanı bağımlılığı olmayan bir Node.js uygulamasıdır ve verileri JSON ve JSONL dosyalarında saklar. Gerçek zamanlı iletişim yalnızca HTTP long-polling ile yapılır, PS5 tarayıcısındaki desteği doğrulanamadığı için WebSocket ve Server-Sent Events kullanılmaz. İstemci, derleme adımı olmayan düz script dosyalarından oluşur ve PS5 tarayıcısıyla uyum için en fazla ES2017 sözdizimiyle yazılır. Uçtan uca şifreleme istemcide TweetNaCl-js ile yapılır, sunucu yalnızca şifreli zarfları saklar ve iletir. Ses, WebRTC ile kişiler arasında tam örgü (mesh) olarak akar, sinyalleşme sunucu üzerinden grup anahtarıyla şifreli olarak taşınır.

Başlıca dosyalar:

| Dosya | Görevi |
|---|---|
| `server.js` | Giriş noktası: ortam değişkenleri, başlatma, banner, `sifre-sifirla` komutu, kapanış |
| `src/app.js` | `createChatServer(options)`, yönlendirme ve API uç noktaları |
| `src/store.js` | Kalıcılık: `state.json`, kanal başına JSONL mesaj dosyaları, yüklemeler |
| `src/auth.js` | Parola karması (scrypt), ad doğrulama, oturumlar, hız sınırlayıcı |
| `src/hub.js` | Çevrimiçi durumu, olay halkası, long-poll bekleyenleri, ses sinyal kuyrukları |
| `src/http-util.js` | Gövde okuma, JSON yanıtlar, güvenlik başlıkları, statik dosya sunumu |
| `public/app.js` | Arayüz, API istemcisi, poll döngüsü, mesajlar, yüklemeler, ayarlar, PWA |
| `public/crypto.js` | `window.E2EE`: anahtar kodu, anahtar türetme, zarf, dosya şifreleme |
| `public/voice.js` | `window.VoiceClient`: WebRTC ses istemcisi |
| `public/emoji.js` | Emoji seçicinin verisi |
| `public/sw.js` | Service worker, uygulama kabuğunun önbelleği |
| `public/vendor/` | TweetNaCl-js 1.0.3, değiştirilmez |
| `test/` | `node:test` ile birim ve sunucu testleri |
| `e2e/` | Playwright ile uçtan uca testler |
| `scripts/denetle.js` | Yazım ve güvenlik denetleyicisi |
| `scripts/test-calistir.js` | Test dosyalarını bulup `node --test` ile çalıştıran yardımcı betik |
| `baslat.bat`, `tunel.bat` | Windows betikleri |

HTTP API, long-poll protokolü, kalıcılık biçimleri, E2EE protokolü, ses mimarisi ve tehdit modeli [docs/MIMARI.md](docs/MIMARI.md) dosyasında ayrıntılı olarak anlatılır. Kullanıcıya yönelik belgeler [README.md](README.md) dosyasındadır.

## Kod kuralları

Bu kuralların çoğu `npm run denetle` tarafından otomatik olarak denetlenir ve CI'da zorunludur.

1. JavaScript dosyaları noktalı virgülsüz yazılır (StandardJS stili). Denetleyici, acorn ile ayrıştırılan dosyalarda noktalı virgül token'ına izin vermez. Satırlar açılış parantezi, açılış köşeli parantezi veya ters tırnakla başlatılmaz.
2. Girinti iki boşluktur ve dizgilerde tek tırnak kullanılır.
3. Hiçbir dosyada uzun tire (U+2014) ve kısa tire (U+2013) karakteri bulunmaz. Gerektiğinde normal kısa çizgi (-) kullanılır.
4. Düzyazıda, yani yorumlarda, arayüz metinlerinde, belgelerde ve `.bat` dosyalarında noktalı virgül kullanılmaz.
5. İstemci kodu (`public/*.js`) modülsüz, düz script olarak ve en fazla ES2017 sözdizimiyle yazılır. İsteğe bağlı zincirleme, boş birleştirme işleci, sınıf alanları, özel alanlar, üst düzey await, `import`, regex lookbehind ve `\p{}` regex kullanılmaz.
6. İstemcide ağ istekleri `fetch` yerine `XMLHttpRequest` ile yapılır. Tek istisna service worker'dır (`public/sw.js`). `replaceAll`, `structuredClone`, `Object.hasOwn` ve `Array.prototype.at` kullanılmaz.
7. Sayfaya yalnızca `createElement` ve `textContent` ile yazılır. `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` ve `Function` yapıcısı yasaktır. Kullanıcı verisi hiçbir zaman `href` veya `src` değeri olarak kullanılmaz. `index.html` içinde satır içi script, stil ve olay işleyicisi bulunmaz.
8. Gerçek zamanlı iletişim yalnızca long-polling ile yapılır. WebSocket veya Server-Sent Events eklenmez.
9. Çalışma zamanı bağımlılığı eklenmez, `package.json` içindeki `dependencies` boş kalır. Yeni bir geliştirme bağımlılığı gerekiyorsa önce bir issue'da tartışın. Sürümler aralık işareti olmadan tam olarak sabitlenir.
10. Arayüz metinleri, yorumlar ve belgeler Türkçe, resmi ve sade yazılır. Türkçe karakterler (ş, ğ, ı, İ, ç, ö, ü) doğrudan kullanılır. Yorumlar Türkçedir ve seyrek tutulur. Tanımlayıcılar, JSON alanları ve API yolları İngilizcedir.
11. `public/vendor/` altındaki dosyalar hiçbir zaman değiştirilmez. Denetleyici `nacl-fast.min.js` dosyasının sha256 değerini doğrular.
12. `.bat` dosyaları BOM'suz UTF-8 ve CRLF satır sonlarıyla kaydedilir ve `chcp 65001` satırını içerir.
13. Testler Windows'ta da geçmelidir. Yollar `path.join` ile birleştirilir, geçici klasörler `os.tmpdir()` altında açılır, satır sonları hakkında varsayım yapılmaz ve testler SIGINT gibi süreç sinyallerine dayanmaz.

## Güvenlik açısından hassas alanlar

Aşağıdaki alanlara dokunan değişiklikler ek inceleme gerektirir. Bu PR'larda değişikliğin güvenliğe etkisini açıklamanız, değişikliği testlerle desteklemeniz ve incelemenin daha uzun sürebileceğini hesaba katmanız beklenir.

| Alan | Neden hassas |
|---|---|
| `public/crypto.js` | Anahtar kodu, anahtar türetme, zarf biçimi ve dosya şifreleme. Biçim değişirse kayıtlı mesaj geçmişi okunamaz hâle gelebilir. |
| `public/voice.js` | Ses sinyallerinin şifrelenmesi ve gönderen ile alıcının doğrulanması |
| `src/auth.js` | Parola karması, oturumlar, hız sınırları |
| Yüklemeler (`src/app.js`, `src/store.js`, `public/app.js`) | Boyut ve kota sınırları, indirme yetkisi, dosya adı temizliği, fotoğraf üst verilerinin silinmesi, indirilen dosyaların sitenin içinde çalıştırılmaması |
| `src/http-util.js` | Güvenlik başlıkları, içerik güvenlik politikası, statik dosya beyaz listesi |
| `public/sw.js` | Önbelleğe alınan içerik ve `/api/` isteklerinin önbelleğe alınmaması |

Şifreleme protokolünü (anahtar kodu, anahtar türetme, zarf veya mesaj düz metni biçimi) değiştiren bir öneriyi kod yazmadan önce bir issue'da tartışın.

## Dal ve PR süreci

1. Çatalınızda `main` dalından yeni bir dal açın.
2. Değişikliği küçük ve tek bir konuya odaklı tutun.
3. Davranış değiştiyse testleri ekleyin veya güncelleyin.
4. `npm run denetle` komutunu çalıştırın.
5. `npm test` komutunu çalıştırın.
6. Arayüzü etkileyen değişikliklerde `npm run test:e2e` komutunu da çalıştırın.
7. PR'ı bu deponun `main` dalına açın.
8. PR şablonundaki bölümleri doldurun.
9. CI denetimlerinin başarılı olduğunu kontrol edin.
10. İnceleme yorumlarını yanıtlayın.

Birbirinden bağımsız değişiklikleri ayrı PR'lar olarak gönderin. Davranışı değiştiren bir değişiklikte `README.md` ve `docs/MIMARI.md` dosyalarını da güncelleyin. Commit mesajlarını kısa ve açıklayıcı yazın. Büyük bir değişikliğe başlamadan önce bir issue açıp yaklaşımı tartışmanız, emeğinizin boşa gitmemesi için önerilir.

## Lisans

Katkılarınız projenin MIT lisansı altında dağıtılır, ayrıntılar için [LICENSE](LICENSE) dosyasına bakın. `public/vendor/` altındaki TweetNaCl-js kendi lisansıyla (Unlicense) dağıtılır.
