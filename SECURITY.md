# Güvenlik politikası / Security policy

[Türkçe](#türkçe) | [English](#english)

## Türkçe

Telsiz uçtan uca şifreleme sunan, kendi sunucunuzda çalışan bir iletişim uygulamasıdır. Güvenlik açıklarının sorumlu bir şekilde bildirilmesi, Telsiz kullanan grupları korumak için önemlidir. Bu bölüm hangi sürümlerin desteklendiğini, bir açığın nasıl bildirileceğini ve projenin bilinen, kabul edilmiş sınırlarını anlatır.

### Desteklenen sürümler

| Sürüm | Güvenlik düzeltmesi |
| --- | --- |
| Son yayımlanan sürüm ve `main` dalı | Evet |
| Daha eski sürümler ve commit'ler | Hayır |

Düzeltmeler `main` dalına yapılır ve yeni bir sürümle yayımlanır. Sunucu çalıştıranların düzeltmelerden yararlanmak için son sürüme güncellemesi gerekir ([docs/KURULUM.md](docs/KURULUM.md#güncelleme)). Masaüstü uygulamasının kurucusu ve AppImage sürümü yeni sürümü arka planda indirir ve kullanıcı onaylayınca kurar, taşınabilir exe ve .deb yalnızca yeni sürümü bildirir ([desktop/README.md](desktop/README.md#güncellemeler)).

### Bir açığı bildirme

Güvenlik açıklarını herkese açık bir issue, tartışma veya PR olarak bildirmeyin. Bunun yerine GitHub'ın özel güvenlik açığı bildirme özelliğini (GitHub Security Advisories) kullanın.

1. Deponun GitHub sayfasında Security sekmesini açın.
2. "Report a vulnerability" düğmesine basın.
3. Formu aşağıda anlatılan bilgilerle doldurun ve gönderin.

Bildirim yalnızca depo sahibi tarafından görülür. Security sekmesinde bildirme seçeneğini göremiyorsanız açığın hiçbir ayrıntısını yazmadan bir issue açın ve depo sahibinden özel bir iletişim yolu isteyin.

Bildiriminizde etkilenen dosyayı veya bileşeni, açığı gördüğünüz sürümü veya commit'i, kurulum yolunu, açığı yeniden oluşturma adımlarını, açığın etkisini (kimin neye erişebildiğini) ve varsa önerdiğiniz düzeltmeyi yazın. Gerçek kişilere ait mesajları, anahtar kodlarını, parolaları, davet bağlantılarını, kurulum kodlarını veya tünel adreslerini bildirime eklemeyin.

Proje gönüllü olarak sürdürüldüğü için belirli bir yanıt süresi garanti edilemez, ancak güvenlik bildirimleri öncelikli olarak incelenir. Doğrulanan açıklar için düzeltme hazırlanır ve sürüm notlarında belirtilir. Düzeltme yayımlanana kadar ayrıntıları herkese açık olarak paylaşmamanızı rica ederiz. Projenin bir ödül programı yoktur.

### Kapsam

Kapsamdaki bileşenler: sunucu kodu (`server.js`, `src/`), istemci kodu (`public/`, `public/vendor/` hariç), şifreleme kütüphanelerinin bu projede nasıl kullanıldığı, masaüstü uygulaması (`desktop/`), başlatma ve tünel betikleri, `Dockerfile`, `deploy/` örnekleri ve GitHub Actions iş akışları.

Bildirilmesi beklenen açıklara örnekler: yetki denetiminin atlatılması, anahtarı bilmeyen birinin mesajları, dosyaları, profilleri veya Telsiz DJ durumunu okuyabilmesi, sunucunun düz metne, parolaya veya şifreleme anahtarlarına ulaşabilmesi, grup anahtarı olmayan bir sunucunun ses veya ekran paylaşımı sinyallerini değiştirebilmesi, uygulamada betik çalıştırılabilmesi (XSS), içerik güvenliği politikasının veya YouTube çerçevesi yalıtımının aşılması, yol geçişiyle sunucudaki başka dosyaların okunabilmesi, boyut veya hız sınırlarının atlatılması, tek bir istekle sunucunun çökertilebilmesi ve masaüstü uygulamasının bütünlük denetiminin veya izin kurallarının aşılması.

TweetNaCl-js ve scrypt-js kütüphanelerinin kendisindeki açıklar kendi projelerine bildirilmelidir. Tarayıcılar, Electron, Node.js, Cloudflare, `cloudflared`, YouTube ve işletim sistemlerindeki açıklar bu projenin kapsamı dışındadır. Aşağıda anlatılan kabul edilmiş sınırlar da tek başlarına açık sayılmaz.

### Tehdit modelinin özeti

Telsiz, mesajların, dosyaların, profillerin, Telsiz DJ durumunun ve ses ile ekran paylaşımı sinyalleşmesinin içeriğini sunucudan, barındırma sağlayıcısından ve tünel sağlayıcısından gizlemeyi amaçlar. Sunucu yalnızca şifreli veriyi görür ve saklar, bu yüzden veri klasörünün çalınması içerikleri açığa çıkarmamalıdır. Parola sunucuya hiç gönderilmez. Sunucu her istekte yetkiyi denetler, girdileri doğrular ve boyut, sayı ve hız sınırları uygular. Ayrıntılı tasarım [docs/MIMARI.md](docs/MIMARI.md) dosyasındadır.

### Bilinen ve kabul edilmiş sınırlar

Aşağıdaki durumlar tasarımın bilinen sınırlarıdır ve tek başlarına güvenlik açığı sayılmaz. Tam açıklama [docs/MIMARI.md](docs/MIMARI.md#sınırlar) dosyasının "Sınırlar" bölümündedir. Bu sınırları azaltacak önerilerinizi normal bir issue olarak açabilirsiniz.

1. **Üst veri.** Sunucu kimin ne zaman çevrimiçi olduğunu, kullanıcı ve oda adlarını, kimin hangi konuşmaya ne zaman ve hangi boyutta yazdığını, yazıyor bilgisini, ses odası üyeliğini ve mikrofon durumunu, Telsiz DJ bulunan odaları ve DJ zarflarının boyutunu, yazanların kullanıcı kimliklerini, kullanıcı aracısından türetilen oturum etiketlerini ve IP adreslerini görür.
2. **Web sürümünde kod teslimi.** Uygulama kodu her açılışta sunucudan gelir. Sunucuyu veya TLS'yi sonlandıran bir aracıyı (ters vekil, tünel sağlayıcısı) ele geçiren etkin bir saldırgan değiştirilmiş kod sunabilir. Masaüstü uygulaması arayüzü kendi içinde taşır.
3. **Kötü niyetli sunucu ve bütünlük.** Sunucu mesajları yeniden oynatabilir, çoğaltabilir, gizleyebilir ve düzenlemeleri geri alabilir. Yazı odalarında gönderen imzası yoktur, grup anahtarına sahip biri (ör. sunucuyla iş birliği yapan bir üye) başka bir üyenin adına mesaj üretebilir.
4. **Grup anahtarı.** Grup anahtarı herkes için ortaktır, ileriye dönük gizlilik yoktur. İstemci anahtarlıktaki eski anahtarlarla mühürlenmiş içeriği de kabul eder, bu yüzden çıkarılan bir üye sunucunun yardımıyla içerik ekleyebilir. Bir üye çıkarıldığında yeni grup anahtarı oluşturulmalıdır.
5. **Özel mesajlar.** İleriye dönük gizlilik yoktur. İlk konuşmada kimlik, grup anahtarına sahip ve sunucuyla iş birliği yapan birinin ortadaki adam saldırısına açıktır. Sonraki değişiklikleri ilk görüşte sabitleme, ilk konuşmayı ise güvenlik numarası karşılaştırması yakalar.
6. **Ses ve ekran paylaşımı.** Katılımcılar birbirinin IP adresini görebilir. Varsayılan STUN sunucusu Google'a aittir. TURN yapılandırılırsa kimlik bilgileri sabittir ve ses odasına katılan her oturum açmış kişiye gönderilir.
7. **YouTube.** Onay veren cihazın IP adresi ve izleme bilgisi Google'a gider. YouTube kaynağını kapatma ayarı istemcilerde uygulanır, DJ durumu şifreli olduğu için sunucu içeriği denetleyemez.
8. **Cihazda saklanan anahtarlar.** Anahtarlar ve oturum bilgisi tarayıcının yerel depolamasındadır. Cihaza erişebilen biri bunlara da erişebilir.
9. **Ev ağında https olmadan kullanım.** `http://` bağlantısında oturum bilgisi ağda şifresiz gider ve aynı ağdaki etkin bir saldırgan uygulama kodunu değiştirebilir.
10. **Kaynak kullanımı.** Yükleme kotası sunucu genelinde ortaktır, kullanıcı başına depolama kotası yoktur. Oturum açmış bir üye ortak kaynakları tüketebilir, bu yüzden sunucu güvenilen kişilerle paylaşılmalıdır.
11. **Paylaşılan dosyalar.** Her türden dosya paylaşılabilir ve sunucu içerikleri göremediği için zararlı dosya denetimi yapılamaz.
12. **Paketleme.** Tek dosyalık sunucu ve masaüstü uygulaması imzasızdır. Docker taban imajı özet değeriyle sabitlenmez. npm paketi npm trusted publishing (OIDC) ile, uzun ömürlü token olmadan ve provenance bilgisiyle yayımlanır. linux-arm64 derlemesindeki Node.js ikilisi `SHASUMS256.txt` ile doğrulanır, GPG imzası denetlenmez. Yayın dosyaları `SHA256SUMS.txt` ile doğrulanabilir.
13. **Masaüstü güncellemeleri.** Güncellemeler kod imzalı değildir. electron-updater indirilen paketi sürümdeki `latest.yml` veya `latest-linux.yml` dosyasındaki sha512 değeriyle doğrular, ancak bu dosyalar da aynı GitHub sürümündedir. Güncellemenin bütünlüğü bu yüzden GitHub hesabının ve deposunun güvenliğine dayanır, depo sahibi ve yazma yetkisi olanlar iki adımlı doğrulama (2FA) kullanmalıdır. Güncelleme denetimi GitHub'a bağlanır, GitHub IP adresini ve uygulama sürümünü görebilir. Denetim ayarlardan kapatılabilir, kapalıyken hiçbir istek gönderilmez.
14. **Denetim.** Bu proje bağımsız bir güvenlik denetiminden geçmemiştir ve hiçbir yazılım için hiç açığı olmadığı garanti edilemez. scrypt-js yaygın olarak kullanılır, ancak resmi bir güvenlik denetimi bilinmemektedir.

## English

Telsiz is a self-hosted communication app that offers end-to-end encryption. Responsible disclosure of security vulnerabilities is important to protect the groups that use Telsiz. This section explains which versions are supported, how to report a vulnerability and the known, accepted limits of the project.

### Supported versions

| Version | Security fixes |
| --- | --- |
| The latest release and the `main` branch | Yes |
| Older releases and commits | No |

Fixes are made on the `main` branch and published in a new release. Server operators need to update to the latest release to benefit from fixes ([docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#updating)). The installer and the AppImage of the desktop app download a new version in the background and install it when the user confirms, the portable exe and the .deb only announce a new version ([desktop/README.en.md](desktop/README.en.md#updates)).

### Reporting a vulnerability

Do not report security vulnerabilities as a public issue, discussion or pull request. Use GitHub's private vulnerability reporting (GitHub Security Advisories) instead.

1. Open the Security tab on the GitHub page of the repository.
2. Press the "Report a vulnerability" button.
3. Fill in the form with the information described below and submit it.

Only the repository owner sees the report. If you cannot see the reporting option in the Security tab, open an issue without any details of the vulnerability and ask the repository owner for a private contact channel.

In your report, describe the affected file or component, the version or commit where you saw the vulnerability, the installation path, the steps to reproduce it, its impact (who can access what) and, if you have one, a suggested fix. Do not include messages of real people, key codes, passwords, invite links, setup codes or tunnel addresses in the report.

Because the project is maintained by volunteers, no specific response time can be guaranteed, but security reports are reviewed with priority. Fixes are prepared for confirmed vulnerabilities and mentioned in the release notes. Please do not share details publicly until a fix is released. The project has no bug bounty program.

### Scope

In scope: the server code (`server.js`, `src/`), the client code (`public/`, except `public/vendor/`), how the encryption libraries are used in this project, the desktop app (`desktop/`), the start and tunnel scripts, the `Dockerfile`, the `deploy/` examples and the GitHub Actions workflows.

Examples of vulnerabilities we want to hear about: bypassing authorization checks, someone without the key being able to read messages, files, profiles or the Telsiz DJ state, the server being able to reach plaintext, passwords or encryption keys, a server without the group key being able to change voice or screen sharing signals, running scripts in the app (XSS), bypassing the Content Security Policy or the isolation of the YouTube frame, reading other files on the server through path traversal, bypassing size or rate limits, crashing the server with a single request, and bypassing the integrity check or the permission rules of the desktop app.

Vulnerabilities in the TweetNaCl-js and scrypt-js libraries themselves should be reported to their own projects. Vulnerabilities in browsers, Electron, Node.js, Cloudflare, `cloudflared`, YouTube and operating systems are out of scope. The accepted limits below are not vulnerabilities on their own.

### Threat model summary

Telsiz aims to hide the content of messages, files, profiles, the Telsiz DJ state and the signaling of voice and screen sharing from the server, the hosting provider and the tunnel provider. The server only sees and stores encrypted data, so a stolen data folder should not reveal content. The password is never sent to the server. The server checks authorization on every request, validates input and applies size, count and rate limits. The detailed design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Known and accepted limits

The following are known limits of the design and are not vulnerabilities on their own. The full explanation is in the "Limits" section of [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#limits). You can open suggestions that reduce these limits as normal issues.

1. **Metadata.** The server sees who is online and when, user and room names, who writes to which conversation when and with what size, typing status, voice room membership and microphone state, rooms with a Telsiz DJ state and the size of DJ envelopes, the user ids of writers, session labels derived from the user agent, and IP addresses.
2. **Code delivery in the web version.** The app code comes from the server on every visit. An active attacker who takes over the server or an intermediary that terminates TLS (a reverse proxy or a tunnel provider) could serve modified code. The desktop app carries the interface inside itself.
3. **A malicious server and integrity.** The server can replay, duplicate and hide messages and roll back edits. Text rooms have no sender signatures, so anyone with the group key (for example a member colluding with the server) can create messages in another member's name.
4. **The group key.** The group key is shared by everyone and has no forward secrecy. The client also accepts content sealed with older keys in the keyring, so a removed member can add content with the server's help. Create a new group key when a member is removed.
5. **Direct messages.** There is no forward secrecy. On the first conversation, identity is open to a man in the middle attack by someone who has the group key and colludes with the server. Pinning on first sight catches later changes, and comparing safety numbers catches the first conversation.
6. **Voice and screen sharing.** Participants can see each other's IP address. The default STUN server belongs to Google. If TURN is configured, its credentials are static and are sent to every signed in person who joins a voice room.
7. **YouTube.** The IP address and tracking data of a device that gives consent go to Google. Turning off the YouTube source is enforced on clients, and the server cannot check the content because the DJ state is encrypted.
8. **Keys stored on the device.** Keys and session information are in the browser's local storage. Anyone with access to the device can access them too.
9. **Use on a home network without https.** On an `http://` connection, session information travels unencrypted on the network, and an active attacker on the same network could modify the app code.
10. **Resource use.** The upload quota is shared by the whole server, and there is no per user storage quota. A signed in member can use up shared resources, so share the server only with people you trust.
11. **Shared files.** Files of any type can be shared, and since the server cannot see their contents, no malware scanning is possible.
12. **Packaging.** The single file server and the desktop app are not code signed. The Docker base image is not pinned by digest. The npm package is published through npm trusted publishing (OIDC), without a long lived token and with provenance. The Node.js binary in the linux-arm64 build is verified with `SHASUMS256.txt`, and no GPG signature is checked. Release files can be verified with `SHA256SUMS.txt`.
13. **Desktop updates.** Updates are not code signed. electron-updater verifies the downloaded package against the sha512 in `latest.yml` or `latest-linux.yml` of the release, but these files are in the same GitHub release. The integrity of updates therefore rests on the security of the GitHub account and repository, and the repository owner and everyone with write access should use two factor authentication (2FA). Update checks connect to GitHub, which can see the IP address and the app version. Checks can be turned off in the settings, and while they are off no request is sent.
14. **Audit.** This project has not had an independent security audit, and no software can be guaranteed to be free of vulnerabilities. scrypt-js is widely used, but no formal security audit of it is known.
