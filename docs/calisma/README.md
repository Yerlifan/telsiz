# Çalışma kontrol noktası (geçici)

Bu klasör yalnızca çalışma dalında durur. Kota biter veya oturumun makinesi kapanırsa işin baştan başlamaması için planlar, tasarım belgeleri ve iş akışı betikleri burada saklanır. Bir PR birleştirilmeden önce bu klasör dalın son hâlinden çıkarılır, birleştirmeden sonra yeni dala geri konur.

## Kullanıcı kararları

- Kart oyununun adı Renk. Kurpiyer oyunu başlatan kişidir ve bütün elleri teknik olarak bilir (basit model). Kural setini kurpiyer seçer: Resmî veya Üst Üste Ekleme.
- Tek! kuralı iki kural setinde de geçerli (varsayılan, kullanıcı itiraz etmedi). Kapatmak tek bir sabittir.
- Kullanıcı 18 yeni isteğin hepsinin yapılmasını istedi ("Hepsini yap").
- Şarkı adıyla arama (istek 5) anahtarsız yoldan yapılacak. Kullanıcı Data API anahtarı yerine anahtarsız yolu seçti (10 Ekim 2026). Sunucu YouTube arama sonuçlarını kendisi alır, istemcinin IP adresi YouTube'a gitmez. Yanıt yapısı ağaçta özyinelemeli aranır, biçim değişirse arama kapanır ve bağlantıyla ekleme çalışmaya devam eder. Bu kapsayıcı youtube.com adresine erişemediği için canlı doğrulama sunucuda yapılacak.
- Kullanıcı kota bitince işin baştan başlamamasını istedi. Her adım ayrı commit olur ve birkaç dakikada bir uzak dala gönderilir.

## İşler ve durum

| İş | Durum | Kontrol noktası |
| --- | --- | --- |
| Renk 1: ses odası sinyalinde genel oyun taşıması | Bitti | commit "Oyun: ses odası sinyalinde genel oyun taşıması" |
| Renk 2: protokol çekirdeği | Bitti | commit "Oyun: protokol çekirdeği" |
| Renk 3: kural motoru | Bitti | commit "Renk: kural motoru" |
| Renk 4: masa yöneticisi | Sürüyor | commit "Oyun: masa yöneticisi" |
| Renk 5: dört cihazlı ağ benzetimi | Bekliyor | commit "Oyun: dört cihazlı ağ benzetimi" |
| Renk 6: genel arayüz ve sahne kipi | Bekliyor | commit "Oyun: genel arayüz ve sahne kipi" |
| Renk 7: masa arayüzü | Bekliyor | commit "Renk: masa arayüzü" |
| Renk 8: uçtan uca test | Bekliyor | commit "Renk: uçtan uca test" |
| Renk 9: belgeler | Bekliyor | commit "Renk: belgeler" |
| 18 isteğin araştırması ve planı | Sürüyor | `istek-plani.md` (bitince eklenecek) |
| Telsiz DJ (istek 5, 6, 13, 15, 18) | Bekliyor | |
| Profil ve durum (istek 2, 3, 8, 9, 12) | Bekliyor | |
| Yüzen pencereler (istek 7, 16) | Bekliyor | |
| Gezinme (istek 17) | Bekliyor | |
| Özgün tasarım ve temalar (istek 10, 11) | Bekliyor | |
| Şifremi unuttum (istek 14) | Bekliyor | |
| Hexball (istek 4), Renk'ten sonra | Bekliyor | |
| Android uygulaması (istek 1) | Bekliyor | |

## Kaldığı yerden devam

1. `git log --oneline` ile hangi adımların commit'lendiğine bakılır. Tablodaki commit başlığı varsa adım bitmiştir.
2. Renk için `akislar/renk-uygulama.js.txt` betiği iş akışı olarak yeniden çalıştırılır. Aynı makinede iş akışı günlüğü duruyorsa `resumeFromRunId` ile biten adımlar önbellekten gelir. Günlük yoksa betikteki biten adımlar çıkarılıp kalan adımlar başlatılır.
3. Renk'in ayrıntılı tasarımı `renk-tasarim.md`, oyun altyapısının kod haritası `oyun-altyapi-haritasi.md` dosyasındadır.
4. 18 istek için araştırma betiği `akislar/istek-arastirma.js.txt`, sonucu bitince `istek-plani.md` dosyasına yazılır.
5. Commit'lenmemiş yarım iş varsa `git status` ile görülür. Yarım adım baştan yapılır, testlerden geçmeden commit'lenmez.
