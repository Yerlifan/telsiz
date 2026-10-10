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
| 18 isteğin araştırması ve planı | Bitti | `istek-plani.md` |
| İstek grupları G0 ile G16 (Hexball hariç) | Sürüyor | yerel `istek/a` ve `istek/b` dalları, yamaları `yamalar/a` ve `yamalar/b` altında |
| Hexball (G17), Renk'ten sonra | Bekliyor | |

Grupların sırası: önce G0 (`istek/a` üzerinde), sonra iki zincir paralel. Zincir A (`/home/user/wt/a`, dal `istek/a`): G2, G6, G7, G12, G14, G9, G10, G13. Zincir B (`/home/user/wt/b`, dal `istek/b`, G0'dan ayrılır): G1, G3, G4, G5, G8, G11, G16, G15. En sonda `istek/b` dalı `istek/a` dalına birleştirilir. Her grup uygulama, bağımsız inceleme ve düzeltme adımlarından geçer. Commit başlıkları "G<n>: ..." biçimindedir.

## Kaldığı yerden devam

1. `git log --oneline` ile hangi adımların commit'lendiğine bakılır. Tablodaki commit başlığı varsa adım bitmiştir.
2. Renk için `akislar/renk-uygulama.js.txt` betiği iş akışı olarak yeniden çalıştırılır. Aynı makinede iş akışı günlüğü duruyorsa `resumeFromRunId` ile biten adımlar önbellekten gelir. Günlük yoksa betikteki biten adımlar çıkarılıp kalan adımlar başlatılır.
3. Renk'in ayrıntılı tasarımı `renk-tasarim.md`, oyun altyapısının kod haritası `oyun-altyapi-haritasi.md` dosyasındadır.
4. 18 istek için araştırma betiği `akislar/istek-arastirma.js.txt`, sonucu bitince `istek-plani.md` dosyasına yazılır.
5. İstek grupları için: yerel dallar kaybolduysa `git worktree add /home/user/wt/a -b istek/a f5e202d` ve `git -C /home/user/wt/a am <depo>/docs/calisma/yamalar/a/*.patch` ile geri kurulur (`b` için aynısı, taban yine `f5e202d`, yamalar G0'ı da içerir). `yamalar/<x>/UC` dalın son commit'idir. Sonra `akislar/istek-uygulama.js.txt` iş akışı olarak yeniden çalıştırılır. Ajanlar biten grup commit'lerini görüp atlar.
6. Koruma döngüsü `akislar/dongu2.sh.txt` (raporları ve yamaları 5 dakikada bir commit'leyip gönderir) ve `akislar/rapor-dok.py.txt` betikleridir.
7. Commit'lenmemiş yarım iş varsa `git status` ile görülür. Yarım adım baştan yapılır, testlerden geçmeden commit'lenmez.
