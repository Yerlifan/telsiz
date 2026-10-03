# Güvenlik politikası

PS5 + PC Sohbet uçtan uca şifreleme sunan bir sohbet uygulamasıdır. Güvenlik açıklarının sorumlu bir şekilde bildirilmesi, uygulamayı kullanan arkadaş gruplarını korumak için önemlidir. Bu belge hangi sürümlerin desteklendiğini, bir açığın nasıl bildirileceğini ve projenin bilinen, kabul edilmiş sınırlarını anlatır.

## Desteklenen sürümler

| Sürüm | Güvenlik düzeltmesi |
|---|---|
| `main` dalının son hâli | Evet |
| Daha eski commit'ler ve sürümler | Hayır |

Düzeltmeler yalnızca `main` dalına yapılır. Sunucu çalıştıranların düzeltmelerden yararlanmak için kendi kopyalarını `main` dalının son hâline güncellemesi gerekir.

## Bir açığı bildirme

Güvenlik açıklarını herkese açık bir issue, tartışma veya PR olarak bildirmeyin. Bunun yerine GitHub'ın özel güvenlik açığı bildirme özelliğini kullanın.

1. https://github.com/Yerlifan/ps5-pc-communication adresini açın.
2. Deponun Security sekmesine geçin.
3. Özel güvenlik açığı bildirme formunu açın.
4. Formu aşağıda anlatılan bilgilerle doldurun.
5. Bildirimi gönderin.

Bu özellik depo sahibi tarafından depo ayarlarından etkinleştirilmiş olmalıdır. Security sekmesinde bildirme seçeneğini göremiyorsanız açığın hiçbir ayrıntısını yazmadan bir issue açın ve depo sahibinden özel bir iletişim yolu isteyin.

Bildiriminizde etkilenen dosyayı veya bileşeni, açığı gördüğünüz commit'i, açığı yeniden oluşturma adımlarını, açığın etkisini (kimin neye erişebildiğini) ve varsa önerdiğiniz düzeltmeyi yazın. Gerçek kişilere ait mesajları, anahtar kodlarını, parolaları, davet bağlantılarını veya tünel adreslerini bildirime eklemeyin.

Proje gönüllü olarak sürdürüldüğü için belirli bir yanıt süresi garanti edilemez, ancak güvenlik bildirimleri öncelikli olarak incelenir. Doğrulanan açıklar için düzeltme hazırlanır. Düzeltme yayımlanana kadar ayrıntıları herkese açık olarak paylaşmamanızı rica ederiz. Projenin bir ödül programı yoktur.

## Kapsam

Kapsamdaki bileşenler sunucu kodu (`server.js` ve `src/`), istemci kodu (`public/`, `public/vendor/` hariç), şifreleme kütüphanesinin bu projede nasıl kullanıldığı, Windows betikleri (`baslat.bat`, `tunel.bat`) ve CI yapılandırmasıdır.

Bildirilmesi beklenen açıklara örnekler şunlardır: yetki denetiminin atlatılması, anahtarı bilmeyen birinin mesajları veya dosyaları okuyabilmesi, sunucunun düz metne veya şifreleme anahtarına ulaşabilmesi, uygulamada betik çalıştırılabilmesi (XSS), yol geçişiyle sunucudaki başka dosyaların okunabilmesi, boyut veya hız sınırlarının atlatılması, tek bir istekle sunucunun çökertilebilmesi ve ses sinyallerinin sunucu tarafından değiştirilebilmesi.

TweetNaCl-js kütüphanesinin kendisindeki açıklar kütüphanenin kendi projesine bildirilmelidir. Cloudflare, `cloudflared`, tarayıcılar ve PS5 sistem yazılımındaki açıklar bu projenin kapsamı dışındadır. Aşağıda anlatılan kabul edilmiş sınırlar da tek başlarına açık sayılmaz.

## Tehdit modelinin özeti

Uygulama, mesajların, fotoğrafların, dosyaların ve ses sinyalleşmesinin içeriğini sunucudan ve tünel sağlayıcısından gizlemeyi amaçlar. Sunucu yalnızca şifreli veriyi görür ve saklar, bu yüzden veri klasörünün çalınması içerikleri açığa çıkarmamalıdır. Hesaplar scrypt ile karma alınan parolalarla ve diskte yalnızca karması tutulan oturum belirteçleriyle korunur. Sunucu her istekte yetkiyi denetler, tüm girdileri doğrular ve boyut, sayı ve hız sınırları uygular.

Ayrıntılı açıklama için [README.md](README.md) dosyasındaki "Güvenlik ve şifreleme modeli" bölümüne ve [docs/MIMARI.md](docs/MIMARI.md) dosyasına bakın.

## Bilinen ve kabul edilmiş sınırlar

Aşağıdaki durumlar tasarımın bilinen sınırlarıdır ve tek başlarına güvenlik açığı sayılmaz. Bu sınırları azaltacak önerilerinizi normal bir issue olarak açabilirsiniz.

### Web tabanlı şifrelemede kod teslimi

Uygulamanın kodu her açılışta sunucudan gelir. Sunucuyu veya tüneli ele geçiren etkin bir saldırgan, tarayıcıya değiştirilmiş bir kod göndererek şifreleme anahtarını çalabilir. Cloudflare hızlı tüneli TLS bağlantısını Cloudflare tarafında sonlandırdığı için bu durum tünel sağlayıcısını da kapsar. Uçtan uca şifreleme bu nedenle sunucuyu çalıştıran kişiye veya tünel sağlayıcısına karşı ancak uygulama kodu değiştirilmediği sürece koruma sağlar.

### Üst veri

Sunucu kimin, ne zaman, hangi kanala yazdığını, mesajların ve dosyaların boyutlarını, kimin çevrimiçi olduğunu, kimin hangi ses kanalında bulunduğunu ve bağlanan cihazların IP adreslerini görür. Kanal adları ve kullanıcı adları şifrelenmez.

### Ortak grup anahtarı ve ileriye dönük gizlilik

Tüm grup tek bir ortak anahtar kullanır. Anahtarı bilen herkes, şifreli veriye ulaşabildiği sürece tüm mesajları okuyabilir. İleriye dönük gizlilik (forward secrecy) yoktur. Gruptan çıkarılan biri eski anahtarı bilmeye devam eder ve anahtar yenileme yalnızca bundan sonraki mesajları korur. Davet bağlantısı anahtarı içerdiği için bağlantıyı gören herkes anahtarı da öğrenir.

### Sesli sohbette IP adresleri

Ses kişiler arasında WebRTC ile doğrudan aktığı için sesli sohbetteki kişiler birbirinin IP adresini görebilir.

### Ev ağında https olmadan kullanım

Ev ağındaki `http://` adresiyle bağlanıldığında bağlantı TLS ile korunmaz. Mesaj içerikleri yine uçtan uca şifrelidir, ancak giriş parolası ve oturum bilgisi ağda şifresiz gider ve aynı ağdaki etkin bir saldırgan uygulama kodunu değiştirebilir.

### Cihazda saklanan anahtar

Şifreleme anahtarı ve oturum bilgisi cihazdaki tarayıcının yerel depolamasında saklanır. Cihaza veya tarayıcı profiline erişebilen biri bunlara da erişebilir.

### Paylaşılan dosyalar

Her türden dosya paylaşılabilir. Uygulama, program çalıştırabilen dosyaları işaretler ve indirmeden önce uyarır, ancak dosyaların zararsız olduğunu denetlemez. Sunucu dosyaların içeriğini göremediği için sunucu tarafında bir tür denetimi de yapılmaz.

### Denetim

Bu proje bağımsız bir güvenlik denetiminden geçmemiştir ve hiçbir yazılım için hiç açığı olmadığı garanti edilemez.
