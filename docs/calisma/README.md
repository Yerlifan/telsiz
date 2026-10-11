# Çalışma kontrol noktası (geçici)

Bu klasör yalnızca çalışma dalında durur. Kota biter veya oturumun makinesi kapanırsa işin baştan başlamaması için planlar, tasarım belgeleri ve iş akışı betikleri burada saklanır. Bir PR birleştirilmeden önce bu klasör dalın son hâlinden çıkarılır, birleştirmeden sonra yeni dala geri konur.

## Kullanıcı kararları

- Kart oyununun adı Renk. Kurpiyer oyunu başlatan kişidir ve bütün elleri teknik olarak bilir (basit model). Kural setini kurpiyer seçer: Resmî veya Üst Üste Ekleme.
- Tek! kuralı iki kural setinde de geçerli (varsayılan, kullanıcı itiraz etmedi). Kapatmak tek bir sabittir.
- Kullanıcı 18 yeni isteğin hepsinin yapılmasını istedi ("Hepsini yap").
- Şarkı adıyla arama (istek 5) anahtarsız yoldan yapılacak. Kullanıcı Data API anahtarı yerine anahtarsız yolu seçti (10 Ekim 2026). Sunucu YouTube arama sonuçlarını kendisi alır, istemcinin IP adresi YouTube'a gitmez. Yanıt yapısı ağaçta özyinelemeli aranır, biçim değişirse arama kapanır ve bağlantıyla ekleme çalışmaya devam eder. Bu kapsayıcı youtube.com adresine erişemediği için canlı doğrulama sunucuda yapılacak.
- Proje kuralının istediği issue kayıtları açıldı: kapak fotoğrafı Yerlifan/telsiz#34, kurtarma kodu Yerlifan/telsiz#35, Android Yerlifan/telsiz#36. Hexball için issue G17 başlarken açılacak.
- Kullanıcı kota bitince işin baştan başlamamasını istedi. Her adım ayrı commit olur ve birkaç dakikada bir uzak dala gönderilir.

## İşler ve durum

| İş | Durum | Kontrol noktası |
| --- | --- | --- |
| Renk 1: ses odası sinyalinde genel oyun taşıması | Bitti | commit "Oyun: ses odası sinyalinde genel oyun taşıması" |
| Renk 2: protokol çekirdeği | Bitti | commit "Oyun: protokol çekirdeği" |
| Renk 3: kural motoru | Bitti | commit "Renk: kural motoru" |
| Renk 4: masa yöneticisi | Bitti | commit "Oyun: masa yöneticisi" |
| Renk 5: dört cihazlı ağ benzetimi | Bitti | commit "Oyun: dört cihazlı ağ benzetimi" |
| Renk 6: genel arayüz ve sahne kipi | Bitti | commit "Oyun: genel arayüz ve sahne kipi" |
| Renk 7: masa arayüzü | Bitti | commit "Renk: masa arayüzü" |
| Renk 8: uçtan uca test | Bitti | commit "Renk: uçtan uca test" |
| Renk 9: belgeler | Bitti | commit "Renk: belgeler" |
| Renk 10: bağımsız inceleme, düzeltme, PR | Bitti, Yerlifan/telsiz#43 birleşti | issue Yerlifan/telsiz#42, commit "Renk: inceleme düzeltmeleri" |
| 18 isteğin araştırması ve planı | Bitti | `istek-plani.md` |
| İstek grupları G0 ile G16 (Hexball hariç) | Sürüyor | yerel `istek/a` ve `istek/b` dalları, yamaları `yamalar/a` ve `yamalar/b` altında |
| Hexball (G17) | Sürüyor | yerel `istek/c` dalı (`/home/user/wt/c`, taban 9034306), yamaları `yamalar/c`, iş akışı `akislar/hexball-uygulama.js.txt`, issue Yerlifan/telsiz#44 |

Grupların sırası: önce G0 (`istek/a` üzerinde), sonra iki zincir paralel. Zincir A (`/home/user/wt/a`, dal `istek/a`): G2, G6, G7, G12, G14, G9, G10, G13. Zincir B (`/home/user/wt/b`, dal `istek/b`, G0'dan ayrılır): G1, G3, G4, G5, G8, G11, G16 (G15 Android kullanıcı kararıyla ertelendi, aşağıya bakın). En sonda `istek/b` dalı `istek/a` dalına birleştirilir. Her grup uygulama, bağımsız inceleme ve düzeltme adımlarından geçer. Commit başlıkları "G<n>: ..." biçimindedir.

İstek grupları 11 Ekim 13:00 UTC itibarıyla iki ayrı sıralı iş akışıyla sürüyor (`akislar/istek-zincir.js.txt`, args `{"zincir":"A"}` run wf_fba57d7a-84b ve `{"zincir":"B"}` run wf_8aeb66c2-fda). Bitenler: G0, G1, G2, G3, G4 (son düzeltme tamamlanıyor), G5 (inceleme bekliyor), G6, G7, G12. Kalanlar: A zincirinde G14 (belgeler), G9, G10, G13. B zincirinde G8, G11, G16. İki zincir bitince istek/b dalı istek/a dalına elle birleştirilir.

11 Ekim 13:15 UTC: Kullanıcı "Android kısmını şimdilik bir kenara bırakalım, diğerleri olsun" dedi. G15 B zincirinden çıkarıldı (zincir aynı run kimliğiyle sürdürüldü, G4 tamamlama sonucu önbellekten geldi). G16 içerik şikâyeti yine yapılır, Android koduna bağlı değildir. Yerlifan/telsiz#36 açık kalır, plandaki G15 bölümü sonraki bir oturum için geçerlidir.

11 Ekim 14:07 UTC: Kota %92 olduğu için Zincir A ve Zincir B bilerek durduruldu, kalan kota Hexball düzeltmesine bırakıldı. Zincir A'da G14 tamamen bitti, G9 uygulaması yarıda kaldı (1. adım 0f1f768, yarım 2 ve 3. adımlar ara kayıt 68ccaa6, betikte G9 devam notu var). Zincir B'de G5 ve G8 uygulaması bitti, sırada G8 incelemesi var. Kota 16:50 UTC civarında sıfırlanır, 16:55 UTC'de "Kota sonrası devam" kontrolü üç iş akışını aynı run kimlikleriyle sürdürür.

## Kaldığı yerden devam

1. `git log --oneline` ile hangi adımların commit'lendiğine bakılır. Tablodaki commit başlığı varsa adım bitmiştir.
2. Renk için `akislar/renk-uygulama.js.txt` betiği iş akışı olarak yeniden çalıştırılır. Aynı makinede iş akışı günlüğü duruyorsa `resumeFromRunId` ile biten adımlar önbellekten gelir. Günlük yoksa betikteki biten adımlar çıkarılıp kalan adımlar başlatılır.
3. Renk'in ayrıntılı tasarımı `renk-tasarim.md`, oyun altyapısının kod haritası `oyun-altyapi-haritasi.md` dosyasındadır.
4. 18 istek için araştırma betiği `akislar/istek-arastirma.js.txt`, sonucu bitince `istek-plani.md` dosyasına yazılır.
5. İstek grupları için: yerel dallar kaybolduysa `git worktree add /home/user/wt/a -b istek/a f5e202d` ve `git -C /home/user/wt/a am <depo>/docs/calisma/yamalar/a/*.patch` ile geri kurulur (`b` için aynısı, taban yine `f5e202d`, yamalar G0'ı da içerir). `yamalar/<x>/UC` dalın son commit'idir. Sonra `akislar/istek-uygulama.js.txt` iş akışı olarak yeniden çalıştırılır. Ajanlar biten grup commit'lerini görüp atlar.
6. Koruma döngüsü `akislar/dongu2.sh.txt` (raporları ve yamaları 5 dakikada bir commit'leyip gönderir) ve `akislar/rapor-dok.py.txt` betikleridir.
7. Commit'lenmemiş yarım iş varsa `git status` ile görülür. Yarım adım baştan yapılır, testlerden geçmeden commit'lenmez.

11 Ekim 17:31 UTC: Hexball Yerlifan/telsiz#45 ile main'e birleştirildi (merge cea35a2, #44 kapandı). CI'ın ilk turunda iki sorun düzeltildi: Windows'ta CRLF yüzünden düşen iki saflık testi (354c966) ve başsız Firefox'un tarayıcı tam ekranını 1280x720 açması yüzünden düşen telefon tam ekran denetimi (653f497, sayfa içi tam ekranda .app-view artık kırpılır). Çalışma dalı yeni main'den yeniden kuruldu. İstek zincirleri (istek/a ve istek/b, taban f5e202d) sonunda main'e (Renk ve Hexball dahil) birleştirilecek: i18n.js, index.html, sw.js, 10-voice.js, 22-cast.js, 36-oyun.js ve voice.js çakışma adayıdır.

11 Ekim 19:35 UTC: Zincir B bitti (G4 tamamlama, G5 inceleme ve düzeltme, G8, G11, G16, toplam 18 doğrulanmış bulgu düzeltildi). Kapanışın ilk yarısı başladı: /home/user/wt/d çalışma kopyasında origin/main'den (cea35a2) açılan yerel istek/birlesim dalına istek/b birleştiriliyor (iş akışı `akislar/birlesim-b.js.txt`, run wf_66c0a6f7-d20, birleştirme, üç alanlı inceleme, düzeltme). istek/birlesim uzak depoya gönderilmez, yalnızca yerel diskte durur. Kaybolursa aynı iş akışı yeniden çalıştırılır. Zincir A bitince istek/a da istek/birlesim'e birleştirilecek, sonra istek/birlesim çalışma dalına alınıp PR açılacak.
