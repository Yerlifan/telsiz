# YouTube anahtarsız arama notları (Telsiz DJ, istek 5)

Tarih: 10 Ekim 2026. Bu dosya kontrol noktasıdır. `çal <şarkı adı>` komutunun sunucu tarafındaki anahtarsız YouTube aramasını yazacak uygulama ajanı içindir.

Bağlam: Sunucu sahibi Data API anahtarı yerine anahtarsız yolu bilerek seçti, Hizmet Şartları riski kendisine bildirildi (bkz. `docs/calisma/README.md`, "Kullanıcı kararları"). Arama sunucuda yapılır, istemcinin IP adresi YouTube'a gitmez. Bu kapsayıcı youtube.com adresine erişemiyor (vekil 403), bu yüzden aşağıdaki her şey kütüphanelerin kaynak kodundan çıkarıldı. Canlı YouTube davranışı burada hiç sınanmadı. Canlı doğrulama sunucuda yapılacak (bkz. bölüm 9).

## Özet: en önemli 10 bulgu

1. İstek: `POST https://www.youtube.com/youtubei/v1/search?prettyPrint=false`, JSON gövde `{ context: { client: { clientName: "WEB", clientVersion, hl, gl } }, query, params }`.
2. `key` sorgu parametresi gerekmiyor görünüyor: en güncel iki bakımlı kütüphane (youtubei.js 18.1.0 ve @distube/ytsr 2.0.4) göndermiyor. Gönderen kütüphanelerin kullandığı değer Data API anahtarı değil, YouTube web sayfasına gömülü genel web istemci anahtarı.
3. Yalnızca video süzgeci: protobuf `{2: {2: 1}}`, baytlar `12 02 10 01`, base64 `EgIQAQ==`. youtubei.js bunu gövdeye URL kodlanmış hâliyle `EgIQAQ%3D%3D` olarak koyuyor. Kütüphaneler bu değerin üç farklı kodlamasını kullanıyor, sunucunun hangisini kabul ettiği doğrulanamadı.
4. Sonuçlar `contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents[].itemSectionRenderer.contents[]` altında. Devam sayfası `onResponseReceivedCommands[0].appendContinuationItemsAction.continuationItems` altında.
5. İki video biçimi var: eski `videoRenderer` (alan: `videoId`) ve yeni `lockupViewModel` (alan: `contentId`, tür `contentType: "LOCKUP_CONTENT_TYPE_VIDEO"`). Yeni biçimde `videoId` anahtarı öğenin kökünde yok. Ayrıştırıcı ikisini de tanımalı.
6. Canlı yayın işareti: `videoRenderer` içinde `badges[].metadataBadgeRenderer.style == "BADGE_STYLE_TYPE_LIVE_NOW"` veya `thumbnailOverlays[].thumbnailOverlayTimeStatusRenderer.style == "LIVE"`. `lockupViewModel` içinde süre rozetinin `icon.sources[0].clientResource.imageName == "LIVE"`. En sağlam kural: süresi ayrıştırılamayan öğe çalınmaz.
7. Ağaçta düz `videoId` araması tehlikeli: reklamlar (`adSlotRenderer`, `searchPyvRenderer`, `promotedSparklesWebRenderer` ...), raflar (`shelfRenderer`), oynatma listelerinin ilk videosu ve aynı videonun gezinti uç noktası (tekrar) da `videoId` taşır. Özyinelemeli arama yalnızca tanınan video düğümlerini toplamalı ve reklam alt ağaçlarına inmemeli.
8. HTML yedeği: `GET https://www.youtube.com/results?search_query=...&hl=en&gl=US` sayfasındaki `var ytInitialData = ` ataması aynı JSON yapısını taşır. En sağlam çıkarma, dizgi ve kaçış karakterini bilen süslü parantez sayacıdır (ytsr `cutAfterJSON`).
9. AB onay çerezi: incelenen kütüphanelerden yalnızca @distube/ytsr çerez gönderiyor ve değeri `SOCS=CAI` (hem HTML GET hem InnerTube POST). `CONSENT=YES+...` biçimi hiçbir kütüphanede yok, doğrulanamadı.
10. clientVersion: youtubei.js her oturumda `https://www.youtube.com/sw.js_data` yanıtından okuyor, olmazsa sabit `2.20260623.01.00`. youtubei sabit `2.20260720.04.00` kullanıp her sürümde güncelliyor. @distube/ytsr ve ytsr sonuç sayfasından okuyor. Öneri: güncel sabit varsayılan, HTML yedeği çalıştığında sayfadan öğrenip bellekte güncelleme.

## Kaynaklar ve sürümler

İndirmeler npm kayıt defterinden tarball olarak alındı, `npm install` çalıştırılmadı, hiçbir betik çalışmadı. Her tarball'ın sha512 değeri kayıt defterindeki `dist.integrity` ile eşleşti. Dosyalar şu klasördedir (geçici scratchpad, oturum bitince silinebilir, aynı tarball adresinden yeniden indirilebilir):

`/tmp/claude-0/-home-user-ps5-pc-communication/4f00f15f-448b-547a-84d4-7dd1552adf2f/scratchpad/yt-arama/`

| Kısaltma | Paket ve sürüm | npm yayın tarihi | Durum | Kaynak kök klasörü |
| --- | --- | --- | --- | --- |
| YJS | youtubei.js 18.1.0 | 22 Eylül 2026 | Etkin bakım (InnerTube istemcisi) | `youtubei.js-18.1.0/package/dist/src/` |
| YJSP | youtubei.js 18.1.0 protobuf | aynı | aynı | `youtubei.js-18.1.0/package/dist/protos/generated/misc/params.js` |
| YI | youtubei 1.8.17 | 7 Ekim 2026 | Etkin bakım | `youtubei-1.8.17/package/dist/esm/` |
| DY | @distube/ytsr 2.0.4 | 12 Haziran 2024 | Son sürüm eski | `distube-ytsr-2.0.4/package/lib/` |
| YT | ytsr 3.8.4 | 11 Ağustos 2023 | npm'de kullanımdan kaldırıldı ("Package no longer supported") | `ytsr-3.8.4/package/lib/` |
| YSR | youtube-sr 4.3.12 | 3 Temmuz 2025 | Bakımda | `youtube-sr-4.3.12/package/dist/mod.js` |
| YS | yt-search 2.13.1 | 2 Mayıs 2025 | Bakımda (yalnızca HTML kazıma) | `yt-search-2.13.1/package/dist/yt-search.js` |
| YSA | youtube-search-api 2.0.1 | 6 Ağustos 2025 | Bakımda (HTML kazıma) | `youtube-search-api-2.0.1/package/dist/index.js` |

Kaynak gösterimi `KISALTMA dosya:satır` biçimindedir. Örnek: `YJS core/Session.js:258` şu dosyanın 258. satırıdır: `.../yt-arama/youtubei.js-18.1.0/package/dist/src/core/Session.js`. YJS ve YI dağıtım (dist) dosyalarıdır, satır numaraları o dosyalara göredir.

Tarball adresleri: `https://registry.npmjs.org/youtubei.js/-/youtubei.js-18.1.0.tgz`, `https://registry.npmjs.org/youtubei/-/youtubei-1.8.17.tgz`, `https://registry.npmjs.org/@distube/ytsr/-/ytsr-2.0.4.tgz`, `https://registry.npmjs.org/ytsr/-/ytsr-3.8.4.tgz`, `https://registry.npmjs.org/youtube-sr/-/youtube-sr-4.3.12.tgz`, `https://registry.npmjs.org/yt-search/-/yt-search-2.13.1.tgz`, `https://registry.npmjs.org/youtube-search-api/-/youtube-search-api-2.0.1.tgz`.

Uygulama için kütüphane eklenmesi önerilmez. Projenin hiç çalışma zamanı bağımlılığı yok (`package.json`), DJ araştırma raporu da ek bağımlılıksız `node:https` öneriyor (`docs/calisma/raporlar/wf_0a579f99-523-ara-t-rma-dj.txt:79`). youtubei.js ayrıca oturum açılışında `sw.js_data`, `/youtubei/v1/config` ve oynatıcı betiğini de çekiyor (`YJS core/Session.js:155`, `:189`, `:63`), bu bizim için gereksiz yük.

## 1. InnerTube arama isteği

### 1.1 Adres

- youtubei.js: taban `https://www.youtube.com/youtubei/` (`YJS utils/Constants.js:8`) ile sürüm `v1` (`:37`) birleşir (`YJS utils/HTTPClient.js:17`). Arama uç yolu `search` (`YJS parser/classes/endpoints/SearchEndpoint.js:2`, `YJS parser/classes/NavigationEndpoint.js:80-81`). Her isteğe `prettyPrint=false` ve `alt=json` eklenir (`YJS utils/HTTPClient.js:28-29`).
- @distube/ytsr: `https://www.youtube.com/youtubei/v1/search`, sorgu yalnızca `prettyPrint=false` (`DY main.js:6`, `:70-82`).
- youtubei: `https://www.youtube.com/youtubei/v1/search?key=...&prettyPrint=false` (`YI youtube/constants.js:4-5`, `YI common/shared/HTTP/HTTP.js:117`, `:168`).
- youtube-sr: `https://youtube.com/youtubei/v1/search?key=...` (www olmadan, `YSR mod.js:1060`).

Sonuç: `https://www.youtube.com/youtubei/v1/search?prettyPrint=false` kullanılmalı.

### 1.2 Gövde

Bütün kütüphanelerde ortak çekirdek: `context.client.clientName`, `context.client.clientVersion`, `context.client.hl`, `context.client.gl`, kök düzeyde `query` ve isteğe bağlı `params`.

- youtubei.js arama gövdesi: `query` ve `params` (`YJS parser/classes/endpoints/SearchEndpoint.js:13-24`, `YJS Innertube.js:186-192`). `context` oturumdan kopyalanır (`YJS utils/HTTPClient.js:36-38`, `:102-110`). Oturum bağlamı `YJS core/Session.js:274-318` içinde kurulur: `hl` (varsayılan `en`), `gl` (varsayılan `US`), `clientName`, `clientVersion`, `visitorData`, `userAgent`, `platform`, `timeZone`, `utcOffsetMinutes`, `originalUrl` ve başka alanlar. `context.user.enableSafetyMode` (`:310-313`).
- @distube/ytsr: en küçük bağlam `{ client: { utcOffsetMinutes: -300, gl: "US", hl: "en", clientName: "WEB", clientVersion }, user: {} }` (`DY util.js:8-17`, `:63-73`). Gövde `{ context, query }` (`DY main.js:78-81`), yani `params` bile göndermiyor ve türü istemci tarafında süzüyor (`DY main.js:99-102`).
- youtubei: `context.client` içinde `clientName`, `clientVersion`, `visitorData`, `hl: "en"`, `gl: "US"` (`YI common/shared/HTTP/HTTP.js:117-119`, `YI youtube/Client/Client.js:76`). Gövde `{ query, params }` (`YI youtube/SearchResult/SearchResult.js:169-174`).
- youtube-sr: `{ context: { client: { utcOffsetMinutes: 0, gl: "US", hl: "en", clientName: "WEB", clientVersion: "1.20220406.00.00", originalUrl } }, params, query }` (`YSR mod.js:1067-1078`, `:1107-1116`).

Önerilen gövde (en küçük ortak küme):

```json
{
  "context": {
    "client": {
      "clientName": "WEB",
      "clientVersion": "2.20260720.04.00",
      "hl": "en",
      "gl": "US",
      "utcOffsetMinutes": 0
    },
    "user": {}
  },
  "query": "gece şarkısı",
  "params": "EgIQAQ%3D%3D"
}
```

`clientVersion` değeri burada youtubei 1.8.17 sabitidir (`YI youtube/constants.js:2`), bölüm 4'e bakın. `gl: "TR"` ile Türkiye sonuçlarının değişip değişmediği doğrulanamadı.

### 1.3 Başlıklar

- youtubei.js her isteğe `Accept: */*`, `Accept-Language: *`, `X-Goog-Visitor-Id`, `X-Youtube-Client-Version`, `X-Youtube-Client-Name` (WEB için `1`, `YJS utils/Constants.js:116-118`) ve sunucuda `User-Agent` ile `Origin` koyar (`YJS utils/HTTPClient.js:124-137`, `:40-45`). `Content-Type: application/json` (`YJS core/Actions.js:65-73`). `User-Agent` rastgele bir masaüstü tarayıcı dizesidir (`YJS utils/Utils.js:76-80`, liste `YJS utils/user-agents.js`). `Referer` göndermez.
- youtubei: `x-youtube-client-version`, `x-youtube-client-name: 1`, `content-type: application/json`, `accept-encoding: gzip, deflate, br`, `cookie`, `referer: https://www.youtube.com/` (`YI common/shared/HTTP/HTTP.js:89-94`, `:139`).
- youtube-sr: `Content-Type`, `Host: www.youtube.com`, `Referer: https://www.youtube.com` ve sabit bir Firefox `User-Agent` (`YSR mod.js:1062-1066`, `:590`).
- @distube/ytsr: kodda yalnızca `cookie: SOCS=CAI` başlığı var, `Content-Type` başlığı eklenmiyor (`DY util.js:82-87`, `:114-119`).

Sonuç: zorunlu başlık kümesi doğrulanamadı. @distube/ytsr çok az başlıkla çalıştığını varsayıyor. Önerilen küme: `Content-Type: application/json`, `Accept: */*`, `Accept-Language: en-US,en`, `X-Youtube-Client-Name: 1`, `X-Youtube-Client-Version: <gövdedeki clientVersion>`, `Origin: https://www.youtube.com`, `Referer: https://www.youtube.com/`, güncel bir masaüstü tarayıcı `User-Agent` dizesi (YJS `user-agents.js` listesindeki gibi) ve `Cookie: SOCS=CAI`.

### 1.4 `key` parametresi

- Göndermeyenler: youtubei.js 18.1.0. Oturum `api_key` değerini saklıyor (`YJS core/Session.js:133`, `:156`, `:248`) ama `HTTPClient` istek adresine yalnızca `prettyPrint` ve `alt` ekliyor, `api_key` hiçbir istekte kullanılmıyor (`YJS utils/HTTPClient.js:28-29`, kaynakta başka kullanım yok). @distube/ytsr 2.0.4 anahtarı bilerek yoruma almış (`DY main.js:8`, `:14-15`, `:57`, `:74`, `:145`).
- Gönderenler: youtubei (`YI common/shared/HTTP/HTTP.js:117`, değer `YI youtube/constants.js:3`), youtube-sr (sayfadaki `INNERTUBE_API_KEY` ya da sabit yedek, `YSR mod.js:512`, `:568-575`, `:1059-1060`), ytsr (sayfadan, `YT main.js:7`, `YT utils.js:53`).
- Değer `AIzaSy` ile başlayan genel web istemci anahtarıdır ve YouTube'un kendi sayfasında `INNERTUBE_API_KEY` olarak durur (`YJS utils/Constants.js:36`, `YSR mod.js:572`). Sunucu sahibinden alınan bir Data API anahtarı değildir. Bu notta tam değer bilerek yazılmadı, çünkü depo gizli anahtar taramaları `AIza` biçimini anahtar sanabilir.

Öneri: `key` gönderilmesin. Canlı denemede `key` olmadan 400 veya 403 gelirse yedek olarak sayfadaki `INNERTUBE_API_KEY` okunup eklenebilir. Anahtarsız çalışıp çalışmadığı canlı doğrulanamadı.

### 1.5 Yalnızca video süzgeci (`params`)

youtubei.js süzgeci protobuf olarak kodluyor:

- `SearchFilter` iletisinde `filters` alanı 2 numaralı, kablo etiketi `18` (`YJSP:84-93`).
- `Filters` içinde `type` alanı 2 numaralı, kablo etiketi `16` (`YJSP:148-150`). `VIDEO = 1`, `CHANNEL = 2`, `PLAYLIST = 3`, `MOVIE = 4`, `SHORTS = 9` (`YJSP:22-30`).
- Kodlanmış bayt dizisi base64 yapılıp `encodeURIComponent` ile URL kodlanıyor ve gövdedeki `params` alanına konuyor (`YJS Innertube.js:139-141`, `:186-191`).

Hesap (bu oturumda Node ile doğrulandı): `{filters: {type: 1}}` için baytlar `12 02 10 01`, base64 `EgIQAQ==`, URL kodlu `EgIQAQ%3D%3D`. Süzgeçsiz aramada bile youtubei.js boş `filters` gönderir: baytlar `12 00`, `params` değeri `EgA%3D` (`YJS Innertube.js:129-132`, `:189`, `filters` varsayılanı boş nesne olduğu için koşul hep doğru).

Kütüphaneler arasında kodlama farkı:

| Kütüphane | Gövdedeki `params` | Kaynak |
| --- | --- | --- |
| youtubei.js | `EgIQAQ%3D%3D` (tek URL kodlama) | `YJS Innertube.js:189` |
| youtubei | `EgIQAQ==` (ham base64) | `YI youtube/SearchResult/SearchResult.js:168-172`, proto `YI youtube/SearchResult/proto/index.js:15`, `:25-30` |
| youtube-sr | `EgIQAQ%253D%253D` (çift URL kodlama) | `YSR mod.js:1021-1033`, `:1106-1110` |
| @distube/ytsr | göndermiyor | `DY main.js:78-81` |

HTML adresindeki `sp` sorgu değeri için: youtube-search-api `sp=EgIQAQ%3D%3D` (`YSA index.js:174-176`), youtube-sr `sp=EgIQAQ%253D%253D` (`YSR mod.js:1119-1120`). Kanal, oynatma listesi ve film için aynı desen: `EgIQAg`, `EgIQAw`, `EgIQBA` (`YSA index.js:177-185`, `YSR mod.js:1023-1030`).

Öneri: gövdede youtubei.js biçimi `EgIQAQ%3D%3D`. HTML adresinde `URLSearchParams` ile `sp` değeri `EgIQAQ==` verilir (çıktı `sp=EgIQAQ%3D%3D` olur). Süzgecin uygulandığına güvenilmez, ayrıştırıcı yine türe göre süzer. YouTube sunucusunun bu üç kodlamadan hangisini süzgeç olarak uyguladığı doğrulanamadı.

## 2. Yanıt yapısı

### 2.1 Sonuçların yolu

```text
contents
  twoColumnSearchResultsRenderer
    primaryContents
      sectionListRenderer
        contents[]
          itemSectionRenderer
            contents[]            <- sonuç öğeleri burada
          continuationItemRenderer
            continuationEndpoint.continuationCommand.token
    secondaryContents              <- yan sütun, sonuç değil
estimatedResults                   <- dizgi olarak sayı
refinements[]                      <- önerilen aramalar (dizgi)
responseContext.serviceTrackingParams[].params[]  <- key "cver" ile istemci sürümü
```

Kaynaklar:

- Ana yol: `YSR mod.js:1117` (`contents[0].itemSectionRenderer.contents`), `YI youtube/SearchResult/SearchResultParser.js:20-21`, `DY util.js:212-214`, `YT utils.js:165-168`.
- Birden çok `itemSectionRenderer` olabilir. youtubei sonuncusunu alıyor (`YI youtube/SearchResult/SearchResultParser.js:36-38`), @distube/ytsr ve ytsr ilkini alıyor (`DY util.js:213`, `YT utils.js:166-168`), youtube-sr ilk dizinden okuyor (`YSR mod.js:1117`). youtubei.js hepsini birleştiriyor (`YJS parser/youtube/Search.js:33`). Öneri: hepsi sırayla gezilmeli.
- Yeni biçim olasılığı: `primaryContents.richGridRenderer.contents[].richItemRenderer.content` (veya `richSectionRenderer.content`) (`DY util.js:218-225`, `YT utils.js:171-177`). youtubei.js de birincil içerik olarak `RichGrid` kabul ediyor (`YJS parser/classes/TwoColumnSearchResults.js:15`).
- Yan sütun: `secondaryContents`, youtubei.js bunu `SecondarySearchContainer` olarak ayrıştırıyor (`YJS parser/classes/TwoColumnSearchResults.js:16`). youtubei.js evrensel izleme kartını (`UniversalWatchCard`) sonuçlardan ayrı bir alan olarak tutuyor (`YJS parser/youtube/Search.js:38`). Yan sütunun içeriği doğrulanamadı. Sonuç olarak kullanılmamalı.
- Devam: `continuationItemRenderer.continuationEndpoint.continuationCommand.token` (`DY main.js:111`). İkinci sayfa yanıtı `onResponseReceivedCommands[0].appendContinuationItemsAction.continuationItems` (`DY main.js:157`, `YI youtube/SearchResult/SearchResultParser.js:28`, `YSA index.js:258`), gövde `{ context, continuation: token }` (`DY main.js:149`). DJ için ikinci sayfa gerekmez.
- `estimatedResults` kökte dizgi (`YJS parser/parser.js:253`, `DY main.js:108`, `YI youtube/SearchResult/SearchResult.js:177`). `refinements` kökte (`YJS parser/parser.js:249-251`).
- `responseContext.serviceTrackingParams[].params[]` içinde `key: "cver"` (`DY util.js:31-44`). Hangi `service` girdisinde durduğu doğrulanamadı.

youtubei.js düğüm adlarını sınıf adına şöyle çeviriyor: ilk harf büyür, `Renderer` ve `Model` silinir (`YJS parser/parser.js:112-116`). Yani `videoRenderer` Video, `lockupViewModel` LockupView, `adSlotRenderer` AdSlot olur. Bu, aşağıdaki "kütüphane tanıyor" iddialarının dayanağıdır.

### 2.2 Öğe türleri (itemSectionRenderer.contents[] doğrudan çocukları)

| Düğüm | Anlamı | DJ için | Kaynak |
| --- | --- | --- | --- |
| `videoRenderer` | Eski biçim video | Al | `YSR mod.js:683-715`, `DY parseItem.js:8-9`, `YI .../SearchResultParser.js:45-46`, `YJS parser/classes/Video.js:42-43` |
| `lockupViewModel` | Yeni biçim. `contentType` ile video, oynatma listesi ve başkaları | Yalnız `LOCKUP_CONTENT_TYPE_VIDEO` al | `YI .../SearchResultParser.js:49-57`, `YJS parser/classes/LockupView.js:16-20` |
| `channelRenderer` | Kanal | Atla | `YSR mod.js:662-678`, `YT parseItem.js:15-16`, `YJS parser/classes/Channel.js:21-33` |
| `playlistRenderer`, `radioRenderer` | Liste ve karışım | Atla | `YT parseItem.js:17-20`, `DY parseItem.js:10-11` |
| `shelfRenderer`, `richShelfRenderer`, `reelShelfRenderer` | Raf, içinde başka öğeler | Atla (öneri) | `YT parseItem.js:29-32`, iç yapı `YT parseItem.js:408-416` |
| `reelItemRenderer`, `shortsLockupViewModel` | Shorts | Atla (öneri) | `YT parseItem.js:27-28`, `YJS parser/classes/ReelItem.js:16-17`, `YJS parser/classes/ShortsLockupView.js:21-37` |
| `gridVideoRenderer` | Izgara video | `videoRenderer` gibi okunabilir | `DY parseItem.js:12-13`, `YT parseItem.js:23-24` |
| `compactVideoRenderer` | Dar video (genelde izleme sayfası önerileri) | `videoRenderer` gibi okunabilir | `YJS parser/classes/CompactVideo.js:34-61`, `YS yt-search.js:422` |
| `movieRenderer`, `gridMovieRenderer`, `showRenderer` | Film ve dizi | Atla | `YT parseItem.js:21-26`, `:33-34` |
| `didYouMeanRenderer`, `showingResultsForRenderer`, `includingResultsForRenderer`, `messageRenderer`, `backgroundPromoRenderer`, `clarificationRenderer`, `emergencyOneboxRenderer`, `chipCloudRenderer`, `horizontalCardListRenderer` | Bilgi ve öneri kutuları | Atla | `YT parseItem.js:36-75` |
| Reklamlar (bkz. 2.5) | Reklam | Atla, içine inme | `YT parseItem.js:58-67`, `YJS parser/parser.js:28-45` |

youtubei.js'nin video saydığı türler: `Video`, `GridVideo`, `ReelItem`, `ShortsLockupView`, `CompactVideo`, `LockupView` (yalnızca `content_type` `VIDEO`, `MOVIE`, `SHORT` veya `STATION` ise), `PlaylistVideo`, `PlaylistPanelVideo`, `WatchCardCompactVideo` (`YJS core/mixins/Feed.js:62-64`). Oynatma listesi saydığı lockup türleri `PLAYLIST`, `ALBUM`, `PODCAST`, `SHOW` (`YJS core/mixins/Feed.js:68-73`). `content_type` değeri `contentType` alanından `LOCKUP_CONTENT_TYPE_` öneki silinerek elde ediliyor (`YJS parser/classes/LockupView.js:19`).

### 2.3 `videoRenderer` alanları

| Bilgi | Yol (öğe kökünden) | Kaynak |
| --- | --- | --- |
| videoId | `videoId` | `YJS parser/classes/Video.js:43`, `YSR mod.js:688`, `DY parseItem.js:29` |
| Başlık | `title.runs[].text` birleştirilir, yoksa `title.simpleText` | `YJS parser/classes/misc/Text.js:40-46`, `DY util.js:76-77`, `YI youtube/VideoCompact/VideoCompactParser.js:10-12`, `YSR mod.js:690` (yalnız ilk run) |
| Süre | `lengthText.simpleText` (ör. `3:33`, `1:02:03`), yoksa `thumbnailOverlays[].thumbnailOverlayTimeStatusRenderer.text` | `YSR mod.js:692-693`, `DY parseItem.js:23-24`, `YJS parser/classes/Video.js:121-128`, `YI .../VideoCompactParser.js:17-19` |
| Kanal adı | `ownerText.runs[0].text`, yoksa `longBylineText` ya da `shortBylineText` | `YSR mod.js:702`, `DY parseItem.js:57`, `:63`, `YI .../VideoCompactParser.js:26`, `:32`, `YS yt-search.js:450` |
| Kanal kimliği | `ownerText.runs[0].navigationEndpoint.browseEndpoint.browseId` | `YSR mod.js:701`, `DY parseItem.js:64`, `YJS parser/classes/misc/Author.js:32` |
| Canlı | `badges[].metadataBadgeRenderer.style == "BADGE_STYLE_TYPE_LIVE_NOW"` veya etiket `LIVE` ya da `LIVE NOW`. Ayrıca `thumbnailOverlays[].thumbnailOverlayTimeStatusRenderer.style == "LIVE"` | `YJS parser/classes/Video.js:100-105`, `YI .../VideoCompactParser.js:20-22`, `YSA index.js:426-442`, `DY parseItem.js:20-21`, `YT parseItem.js:130-131` |
| Yaklaşan yayın | `upcomingEventData.startTime` (Unix saniye) veya örtü `style == "UPCOMING"` | `YJS parser/classes/Video.js:71-72`, `DY parseItem.js:22`, `YS yt-search.js:427-430`, `:603` |
| İzleyici sayısı (canlı) | `viewCountText.runs` içinde `watching` geçer | `YS yt-search.js:426`, `:431` |
| Görüntülenme | `viewCountText.simpleText` | `YSR mod.js:712`, `DY parseItem.js:43` |
| Yayın zamanı | `publishedTimeText.simpleText` | `YSR mod.js:711`, `DY parseItem.js:47` |
| Küçük resim | `thumbnail.thumbnails[]` (`url`, `width`, `height`) | `YSR mod.js:694-699`, `DY parseItem.js:31-32` |
| Shorts işareti | örtü `style == "SHORTS"` | `YI .../VideoCompactParser.js:23-24` |

Notlar: Canlı yayında `lengthText` gelmez (`DY parseItem.js:44` yorumu). Rozet etiketi dile bağlı, `style` değerine güvenilmeli. `channelRenderer` için `subscriberCountText` artık kanal tutamacını (`@ad`), `videoCountText` abone sayısını taşıyor (`YJS parser/classes/Channel.js:26`).

### 2.4 `lockupViewModel` alanları

| Bilgi | Yol (öğe kökünden) | Kaynak |
| --- | --- | --- |
| Tür | `contentType`, video için `LOCKUP_CONTENT_TYPE_VIDEO`, liste için `LOCKUP_CONTENT_TYPE_PLAYLIST` | `YI .../SearchResultParser.js:51-57`, `YJS parser/classes/LockupView.js:19` |
| videoId | `contentId` | `YI .../VideoCompactParser.js:85`, `YJS parser/classes/LockupView.js:18` |
| Başlık | `metadata.lockupMetadataViewModel.title.content` | `YI .../VideoCompactParser.js:42`, `:86`, `YJS parser/classes/LockupMetadataView.js:16` |
| Kanal adı | `metadata.lockupMetadataViewModel.metadata.contentMetadataViewModel.metadataRows[0].metadataParts[0].text.content` | `YI .../VideoCompactParser.js:48`, `:54`, `YJS parser/classes/ContentMetadataView.js:12-17` |
| Kanal kimliği (tek kanal) | `metadata.lockupMetadataViewModel.image.decoratedAvatarViewModel.rendererContext.commandContext.onTap.innertubeCommand.browseEndpoint.browseId` | `YI .../VideoCompactParser.js:43`, `:50-58` |
| Ortak yapım (çok kanal) | `...image.avatarStackViewModel.rendererContext.commandContext.onTap.innertubeCommand.showDialogCommand.panelLoadingStrategy.inlineContent.dialogViewModel.customContent.listViewModel.listItems[].listItemViewModel` (`title.content`, `rendererContext...browseEndpoint.browseId`) | `YI .../VideoCompactParser.js:60-81` |
| Kanal kimliği (metin çalıştırmasından) | `metadataParts[0].text.commandRuns[0].onTap.innertubeCommand.browseEndpoint.browseId` | `YI youtube/PlaylistCompact/PlaylistCompactParser.js:28-37` |
| Süre | `contentImage.thumbnailViewModel.overlays[0]` içinde `thumbnailBottomOverlayViewModel.badges[0].thumbnailBadgeViewModel.text` ya da `thumbnailOverlayBadgeViewModel.thumbnailBadges[0].thumbnailBadgeViewModel.text` | `YI .../VideoCompactParser.js:45-47`, `:88`, `YJS parser/classes/ThumbnailBottomOverlayView.js:12`, `YJS parser/classes/ThumbnailOverlayBadgeView.js:10`, `YJS parser/classes/ThumbnailBadgeView.js:10` |
| Canlı | Aynı rozette `icon.sources[0].clientResource.imageName == "LIVE"` | `YI .../VideoCompactParser.js:83`, `:87`, `YJS parser/classes/ThumbnailBadgeView.js:18-20` |
| Görüntülenme ve tarih | `metadataRows[1].metadataParts[0].text.content` ve aynı satırın son parçası | `YI .../VideoCompactParser.js:90-93` |
| Küçük resim | `contentImage.thumbnailViewModel.image.sources[]` | `YI .../VideoCompactParser.js:89`, `YJS parser/classes/misc/Thumbnail.js:17-22` |
| Liste küçük resmi | `contentImage.collectionThumbnailViewModel.primaryThumbnail.thumbnailViewModel` | `YI .../PlaylistCompactParser.js:29`, `YJS parser/classes/CollectionThumbnailView.js:10` |
| Erişilebilirlik etiketi | `rendererContext.accessibilityContext.label` | `YJS parser/classes/misc/RendererContext.js:12-13`, `YJS parser/classes/misc/AccessibilityContext.js:4` |

Notlar:

- Metin alanları "attributed text" biçimindedir: `{ content, commandRuns, styleRuns, attachmentRuns }`, çalıştırmalar `startIndex` ve `length` taşır (`YJS parser/classes/misc/Text.js:77-105`).
- youtubei canlı yayında süre ve yükleme tarihini okumuyor (`YI .../VideoCompactParser.js:88`, `:91-93`).
- youtubei rozeti yalnız `overlays[0]` içinde arıyor (`YI .../VideoCompactParser.js:45`). Sağlam ayrıştırıcı bütün `overlays` dizisini gezmeli.
- youtubei.js `ThumbnailBadgeView` içinde `badgeStyle` alanını okuyor (`YJS parser/classes/ThumbnailBadgeView.js:11`) ama hiçbir kütüphane değerini karşılaştırmıyor. `THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE` gibi değerler doğrulanamadı.
- Video lockup öğesinde `rendererContext.commandContext.onTap.innertubeCommand.watchEndpoint.videoId` yolu doğrulanamadı. Desen (`onTap.innertubeCommand.<ad>Endpoint`) kanal için doğrulandı (`YI .../VideoCompactParser.js:55-56`) ve youtubei.js bu deseni genel olarak çözüyor (`YJS parser/classes/NavigationEndpoint.js:24-34`). videoId için yalnızca `contentId` kullanılmalı.
- `shortsLockupViewModel` öğesinde videoId doğrudan alan değil, `onTap` komutunun içinde. youtubei.js yalnızca `entityId`, `onTap`, `overlayMetadata.primaryText` okuyor (`YJS parser/classes/ShortsLockupView.js:21-31`). İçteki tam yol doğrulanamadı.

### 2.5 Reklamlar ve atlanacak düğümler

Doğrulanan reklam düğüm adları:

- ytsr: `adSlotRenderer`, `carouselAdRenderer`, `searchPyvRenderer`, `promotedVideoRenderer`, `promotedSparklesTextSearchRenderer`, `compactPromotedItemRenderer`, `promotedSparklesWebRenderer`, ayrıca `reelPlayerHeaderRenderer` (`YT parseItem.js:58-67`).
- youtubei.js yok sayma listesi (sınıf adı olarak): `AdSlot`, `DisplayAd`, `SearchPyv`, `MealbarPromo`, `PrimetimePromo`, `PromotedSparklesWeb`, `CompactPromotedVideo`, `BrandVideoShelf`, `BrandVideoSingleton`, `StatementBanner`, `GuideSigninPromo`, `AdsEngagementPanelContent`, `MiniGameCardView`, `GenAiFeedbackFormView`, `PlayerInterstitial`, `InterstitialView` (`YJS parser/parser.js:28-45`). Asıl düğüm adı bunlara `Renderer` ya da `ViewModel` eklenmiş hâlidir (`YJS parser/parser.js:112-116`).

Reklam düğümlerinin iç yapısı hiçbir kütüphanede okunmuyor, doğrulanamadı. Örnek dosyalardaki reklam öğesinin iç yapısı yalnızca "reklamın içine inme" davranışını sınamak içindir.

`videoId` taşıyan ama sonuç olmayan yerler (düz özyinelemeli aramayı yanıltır):

- Aynı videonun `navigationEndpoint.watchEndpoint.videoId` alanı (tekrar, `YT parseItem.js:200` deseni).
- Oynatma listesi öğesinin ilk videosu: `playlistRenderer.navigationEndpoint.watchEndpoint.videoId` ve `videos[].childVideoRenderer` (`YT parseItem.js:199-203`).
- Raf içindeki videolar: `shelfRenderer.content.verticalListRenderer.items[]` (`YT parseItem.js:415`).
- Reklam alt ağaçları.
- Yan sütun `secondaryContents`.

## 3. HTML sonuç sayfası yedeği

### 3.1 İstek

- @distube/ytsr: `GET https://www.youtube.com/results` sorgu `search_query`, `gl=US`, `hl=en` (`DY main.js:5`, `:46`, `DY util.js:7`, `:135`, `:141-143`). Bu kütüphanede HTML birincil yol, POST yalnızca HTML'den JSON çıkmazsa ya da güvenli aramada kullanılıyor (`DY main.js:40-49`, `:68-86`).
- ytsr: `https://www.youtube.com/results?` ve `querystring` ile aynı sorgu (`YT main.js:6`, `:14-15`).
- yt-search: `https://www.youtube.com/results?search_query=...&hl=en&gl=US`, başlıklar `accept: text/html`, `accept-encoding: gzip`, `accept-language: en-US`, `user-agent` Googlebot içeren sabit dize (`YS yt-search.js:43-51`, `:235-286`). Yorumda bu dizenin "tarayıcınızı güncelleyin" uyarısız sayfa verdiği yazıyor (`YS yt-search.js:46-49`).
- youtube-sr: InnerTube başarısız olursa `https://youtube.com/results?search_query=...&hl=en&sp=...` (`YSR mod.js:1118-1122`).

### 3.2 `ytInitialData` çıkarma yolları

| Kütüphane | Yöntem | Kaynak |
| --- | --- | --- |
| ytsr | `var ytInitialData = ` sonrasını dizgi ve kaçış karakterini bilen süslü parantez sayacıyla keser, sonra `JSON.parse` | `YT utils.js:49`, `:213-222`, `:253-305` |
| @distube/ytsr | Sırayla dört deneme: `var ytInitialData = ` ile kapanış süslü parantezi ve noktalı virgül arası (sonuna `}` ekleyerek), aynısı `window["ytInitialData"] = ` için, sonra her iki işaret için `</script>` etiketinden hemen önceki noktalı virgüle kadar | `DY util.js:46-51`, `:20-29` |
| youtube-sr | Önce `ytInitialData = JSON.parse('...')` biçimi (`\xNN` kaçışlarını çözer), sonra metinde `{"itemSectionRenderer":{"contents":` parçasını keser | `YSR mod.js:630-657` |
| yt-search | cheerio ile `div#initial-data` ya da `ytInitialData` geçen betik satırında açgözlü `/{.*}/` düzenli ifadesi | `YS yt-search.js:376-403` |
| youtube-search-api | `split("var ytInitialData =")` sonrası `</script>` öncesi, son karakter atılır | `YSA index.js:106-108` |

Çıkan JSON, InnerTube yanıtıyla aynı yapıdadır: @distube/ytsr HTML'den gelen JSON'u InnerTube yanıtıyla aynı `parseWrapper` ile işliyor (`DY main.js:46-48`, `:94-96`). youtube-search-api da `initdata.contents.twoColumnSearchResultsRenderer.primaryContents` yolunu kullanıyor (`YSA index.js:189-190`).

Aynı sayfadan istemci sürümü: `INNERTUBE_CONTEXT_CLIENT_VERSION":"` sonrası (`YT utils.js:54-55`, `DY util.js:56-57`, `YSR mod.js:796`) veya `ytInitialData.responseContext.serviceTrackingParams` içindeki `cver` (`DY util.js:31-44`, `:55`). Anahtar: `INNERTUBE_API_KEY":"` sonrası (`YT utils.js:53`).

Öneri: ytsr yaklaşımı. `var ytInitialData = ` ve `window["ytInitialData"] = ` işaretlerinden ilk bulunanın hemen ardındaki `{` karakterinden başlayıp dizgi içi ve kaçış durumunu izleyen bir sayaçla eşleşen `}` karakterine kadar kesilir, en çok N bayt taranır. Bu oturumda örnek dosya bir HTML içine gömülüp başlığa `}"{`, kapanış süslü parantezi ile noktalı virgül ve `</script>` konarak denendi, doğru çıkarıldı (`scratchpad/betikler/html-dene.js`). `JSON.parse('...')` biçimli eski sayfa (`YSR mod.js:637-640`) desteklenmeyebilir, bu durumda arama kapanır.

### 3.3 AB onay yönlendirmesi ve çerez

- Tek doğrulanan: @distube/ytsr `CONSENT_COOKIE = 'SOCS=CAI'` (`DY util.js:18`). İstekte çerez yoksa bunu koyuyor, varsa ve `SOCS=` içermiyorsa sonuna ekliyor (`DY util.js:114-119`). Aynı `requestOptions` hem HTML GET hem InnerTube POST için kullanıldığından (`DY main.js:46`, `:70-76`) çerez ikisine de gidiyor.
- youtubei.js, youtubei, youtube-sr, ytsr, yt-search ve youtube-search-api onay çerezi göndermiyor (kaynakta `SOCS` ve `CONSENT=` yalnızca `DY util.js` içinde geçiyor). youtubei.js yalnızca `sw.js_data` isteğinde `PREF` (saat dilimi) ve `VISITOR_INFO1_LIVE` çerezleri gönderiyor (`YJS core/Session.js:237`). youtubei sunucudan dönen `set-cookie` değerini sonraki isteklerde geri yolluyor (`YI common/shared/HTTP/HTTP.js:182`, `:188-192`).
- `CONSENT=YES+...` biçimi: doğrulanamadı (incelenen hiçbir kütüphanede yok).
- `SOCS=CAI` değerinin anlamı ve AB içi bir sunucuda yönlendirmeyi gerçekten önlediği: doğrulanamadı. Değişken adı (`CONSENT_COOKIE`) amacın onay sayfasını aşmak olduğunu gösteriyor.
- Güvenli arama çerezi (DJ için gerekmez): `PREF=f2=8000000` (`YSR mod.js:1089`, `YT utils.js:119-124`), InnerTube tarafında `context.user.enableSafetyMode = true` (`DY util.js:71`, `YT utils.js:63`).

Öneri: her iki isteğe `Cookie: SOCS=CAI`. Yönlendirme izlenmez. Yanıt 3xx ise ya da `Location` başlığı `consent.youtube.com` içeriyorsa arama "onay gerekli" hatasıyla başarısız sayılır ve günlüğe bir kez yazılır.

## 4. clientVersion güncelliği

| Kütüphane | Yöntem | Sabit değer | Kaynak |
| --- | --- | --- | --- |
| youtubei.js 18.1.0 | Her oturumda `GET https://www.youtube.com/sw.js_data`. Yanıt `)]}'` önekiyle başlar, 5 karakter atlanıp `JSON.parse`, `data[0][2]` ytcfg dizisi, `[[device_info], api_key]`. WEB için `clientVersion = device_info[16]`, `visitorData = device_info[13]`, `hl = device_info[0]`, `gl = device_info[1]`. Başarısız olursa sabit değer ve yerelde üretilmiş `visitorData` | `2.20260623.01.00` | `YJS core/Session.js:110-165`, `:226-273`, sabit `YJS utils/Constants.js:33-40`, yerel visitorData `YJS core/Session.js:140`, `YJS utils/ProtoUtils.js:3-6` |
| youtubei 1.8.17 | Sabit, seçenekle değiştirilebilir. Her sürümde güncelleniyor | `2.20260720.04.00` | `YI youtube/constants.js:2`, `YI youtube/Client/Client.js:76` |
| @distube/ytsr 2.0.4 | Sonuç sayfasından okur: önce `responseContext.serviceTrackingParams` içindeki `cver`, sonra `INNERTUBE_CONTEXT_CLIENT_VERSION`. Bellekte önbellek, yeniden denemede önbelleği siler | `2.20240606.06.00` (önbellek başlangıcı) | `DY util.js:31-44`, `:54-58`, `DY main.js:7-11`, `:13-25`, `:30-34` |
| ytsr 3.8.4 | Sonuç sayfasından `INNERTUBE_CONTEXT_CLIENT_VERSION` | yok | `YT utils.js:54-58` |
| youtube-sr 4.3.12 | Arama için sabit, 2022 tarihli. Hata olursa HTML yedeğine düştüğü için eski sürümün reddedilip reddedilmediği dışarıdan görünmez | `1.20220406.00.00` | `YSR mod.js:1074`, `:1118-1122` |

Eski bir `clientVersion` değerinin reddedilip reddedilmediği doğrulanamadı.

Öneri:

1. Kodda güncel bir sabit varsayılan dursun (şimdilik `2.20260720.04.00`).
2. HTML yedeği her çalıştığında sayfadaki `INNERTUBE_CONTEXT_CLIENT_VERSION` ya da `cver` okunur, `^\d+\.\d{8}\.\d{2}\.\d{2}$` desenine uyuyorsa bellekteki sürüm güncellenir (en çok günde bir kez).
3. InnerTube 400 dönerse bir kez HTML yedeği denenir, sürüm oradan öğrenilir.
4. İsteğe bağlı: youtubei.js gibi `sw.js_data` okumak. Dizi dizinleri (`[0][2][0][0][16]`) belgelenmemiş ve kırılgandır.

## 5. Kırılganlık noktaları

- Biçim geçişi: aynı aramada `videoRenderer` ile `lockupViewModel` karışık gelebilir. youtubei bu yüzden ikisini de okuyor (`YI .../SearchResultParser.js:43-57`, yorum `:50` "new data structure for search result"). yt-search lockup biçimini yalnız oynatma listesi için tanıyor (`YS yt-search.js:415`), yani bu kütüphane yeni biçim videoları kaçırabilir.
- `richGridRenderer` yolu ileride arama sonuçlarına gelebilir (`DY util.js:218-225`).
- Konumsal varsayımlar: youtubei `overlays[0]`, `metadataRows[0]`, `metadataRows[1]` ve `badges[0]` gibi sabit dizinler kullanıyor (`YI .../VideoCompactParser.js:21`, `:45`, `:54`, `:90`). Sağlam ayrıştırıcı diziyi gezmeli.
- Dile bağlı metinler: `LIVE`, `LIVE NOW`, `watching`, `views` dile göre değişir. Yalnızca `style`, `imageName` ve `contentType` gibi sabit değerlere ve `H:MM:SS` süre desenine güvenilmeli.
- `params` kodlaması: kütüphaneler üç farklı kodlama kullanıyor (bölüm 1.5). Sunucu birini yok sayarsa sonuçlara kanal ve listeler karışır, ayrıştırıcı zaten süzdüğü için yalnız sonuç sayısı düşer.
- İstemci sürümü eskirse YouTube yanıtı değiştirebilir ya da reddedebilir (doğrulanamadı).
- Onay sayfası, bot denetimi ve oran sınırı: 429, 403, onay yönlendirmesi ya da JSON yerine HTML gelmesi. Hepsi "arama kullanılamıyor" sayılmalı. Bağlantıyla ekleme etkilenmez.
- Hizmet Şartları: YouTube erişimi kesebilir. Sahip riski kabul etti, kod bunu sessizce aşmaya çalışmamalı (dönen IP, sahte tarayıcı parmak izi gibi yollar önerilmez).
- HTML kaçışları: `ytInitialData` içinde `</script>` gibi dizgilerin nasıl kaçışlandığı doğrulanamadı. Süslü parantez sayacı dizgi içini atladığı için etkilenmez.

## 6. Önerilen savunmacı ayrıştırma

README kararı "yanıt yapısı ağaçta özyinelemeli aranır, biçim değişirse arama kapanır" şeklinde. Bu karar şöyle uygulanabilir:

1. Kök: önce `contents.twoColumnSearchResultsRenderer.primaryContents` denenir. Yoksa yanıtın tamamı kök alınır ama `secondaryContents` anahtarına inilmez.
2. Gezinti: özyineleme yerine açık yığın (yığın taşmasını önler). Her düğümde ziyaret sayacı artar.
   - En çok düğüm: 200 000 (aşılırsa hata, arama başarısız). Örnek dosyalar yaklaşık 25 KB ve 400 düğüm. Gerçek yanıt boyutu ve düğüm sayısı ölçülemedi, sınır canlı ölçümle ayarlanmalı.
   - En çok derinlik: 64. Örneklerdeki en derin yol (ortak yapım lockup içindeki ikinci kanalın kimliği) kökten 33 düzey (`scratchpad/betikler/derinlik.js` ile ölçüldü).
3. Anahtar kuralları:
   - Reklam anahtarları (bölüm 2.5 listesi) görülünce o alt ağaca inilmez. Reklam denetimi için anahtardan `Renderer` ve `Model` silinip youtubei.js listesindeki sınıf adlarıyla karşılaştırmak (`YJS parser/parser.js:112-116` ile aynı kural) hem `Renderer` hem `ViewModel` ekini kapsar.
   - Atlanacak kapsayıcılar (`shelfRenderer`, `richShelfRenderer`, `reelShelfRenderer`, `horizontalCardListRenderer`, `playlistRenderer`, `radioRenderer`, `channelRenderer`, `universalWatchCardRenderer`, `secondaryContents`) görülünce o alt ağaca inilmez.
   - `videoRenderer`, `compactVideoRenderer`, `gridVideoRenderer` görülünce öğe bölüm 2.3'e göre okunur, alt ağacına inilmez.
   - `lockupViewModel` görülünce `contentType` yalnızca `LOCKUP_CONTENT_TYPE_VIDEO` ise bölüm 2.4'e göre okunur, değilse atlanır. Alt ağacına inilmez.
   - Diğer anahtarlarda gezinti sürer (bilinmeyen yeni sarmalayıcılar böylece aşılır).
4. Öğe doğrulama:
   - videoId `^[A-Za-z0-9_-]{11}$` desenine uymalı (DJ raporu ile aynı).
   - Süre metni `^\d{1,3}(:\d{1,2}){1,2}$` desenine uymalı ve saniyeye çevrilmeli. Süresi olmayan, canlı ya da yaklaşan yayın işaretli öğe çalınmaz. Canlı yayında süre gelmez, yaklaşan yayında bazen gelmez, normal videoda da ara sıra gelmeyebilir (`DY parseItem.js:44` yorumu). Bu yüzden süre kuralı canlı işaretinin yerine geçmez, ikisi birlikte denetlenir. Süresi gelmeyen normal video atlanır, sıradaki sonuç denenir.
   - Başlık ve kanal adı: denetim karakterleri silinir, boşluk sadeleşir, uzunluk sınırlanır (ör. 200 kod noktası). Değerler istemciye yalnız metin olarak gider.
   - Aynı videoId bir kez alınır, ilk görülme sırası korunur.
5. Sonuç: ilk geçerli öğe çalınır. Hiç öğe yoksa "sonuç yok". Yapı hiç tanınmadıysa (ne `itemSectionRenderer` ne bilinen video düğümü bulundu) bu "biçim değişti" sayılır.
6. Devre kesici: art arda 3 "biçim değişti" ya da ağ hatası olursa arama 15 dakika kapanır, günlüğe bir kez yazılır, istemciye `search_unavailable` döner. Bağlantıyla ekleme çalışmaya devam eder.

Ağ sınırları (öneri, ölçülmedi):

- Yalnızca sabit adres: `https://www.youtube.com/youtubei/v1/search` ve `https://www.youtube.com/results`. Yönlendirme izlenmez.
- Zaman aşımı: bağlantı ve yanıtın tamamı için 6 saniye, HTML yedeği dahil toplam 10 saniye. DJ raporundaki Data API planı 8 saniye öneriyordu.
- Yanıt boyutu sınırı: InnerTube JSON için 4 MB, HTML için 6 MB, açılmış (sıkıştırması çözülmüş) bayt olarak sayılır. Sınır aşılınca bağlantı kesilir. Gerçek boyutlar ölçülemedi. İlk canlı denemede günlüğe yazılıp sınır daraltılmalı.
- `Accept-Encoding` gönderilirse `node:zlib` ile çözülürken de bayt sınırı uygulanmalı. Göndermemek en basit yol, ama YouTube'un sıkıştırmasız yanıt verip vermediği doğrulanamadı.
- Sorgu: 1 ile 200 kod noktası arası, satır sonları boşluğa çevrilir. Kullanıcı başına ve sunucu geneli hız sınırı, 10 dakikalık sorgu önbelleği (DJ raporundaki plan ile aynı).

Başvuru taslağı (bu oturumda iki örnek dosya ve uç durumlarla denendi: `scratchpad/betikler/taslak.js`, deneme betiği `scratchpad/betikler/taslak-dene.js`):

```js
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const SURE = /^\d{1,3}(:\d{1,2}){1,2}$/
const SINIR = { dugum: 200000, derinlik: 64 }
const REKLAM_SINIFLARI = new Set(['AdSlot', 'DisplayAd', 'SearchPyv', 'MealbarPromo', 'PrimetimePromo',
  'PromotedSparklesWeb', 'CompactPromotedVideo', 'BrandVideoShelf', 'BrandVideoSingleton', 'StatementBanner',
  'GuideSigninPromo', 'AdsEngagementPanelContent', 'MiniGameCardView', 'GenAiFeedbackFormView',
  'PlayerInterstitial', 'InterstitialView', 'CarouselAd', 'PromotedVideo', 'PromotedSparklesTextSearch',
  'CompactPromotedItem'])
const KAPSAYICI_ATLA = new Set(['shelfRenderer', 'richShelfRenderer', 'reelShelfRenderer',
  'horizontalCardListRenderer', 'playlistRenderer', 'radioRenderer', 'channelRenderer',
  'universalWatchCardRenderer', 'secondaryContents'])
const VIDEO_DUGUMU = new Set(['videoRenderer', 'compactVideoRenderer', 'gridVideoRenderer'])

function sinifAdi(k) {
  return (k.charAt(0).toUpperCase() + k.slice(1)).replace(/Renderer|Model/g, '')
}

function metin(t) {
  if (!t || typeof t !== 'object') return ''
  if (typeof t.simpleText === 'string') return t.simpleText
  if (Array.isArray(t.runs)) return t.runs.map(r => (r && typeof r.text === 'string') ? r.text : '').join('')
  if (typeof t.content === 'string') return t.content
  return ''
}

function saniye(s) {
  if (typeof s !== 'string' || !SURE.test(s.trim())) return null
  return s.trim().split(':').reduce((t, p) => t * 60 + Number(p), 0)
}

function videoRendererOku(v) {
  if (!v || typeof v !== 'object' || !VIDEO_ID.test(String(v.videoId))) return null
  const ortuler = (Array.isArray(v.thumbnailOverlays) ? v.thumbnailOverlays : [])
    .map(o => o && o.thumbnailOverlayTimeStatusRenderer).filter(Boolean)
  const rozetler = Array.isArray(v.badges) ? v.badges : []
  const canli = rozetler.some(b => b && b.metadataBadgeRenderer && b.metadataBadgeRenderer.style === 'BADGE_STYLE_TYPE_LIVE_NOW') ||
    ortuler.some(o => o.style === 'LIVE' || o.style === 'UPCOMING') ||
    Boolean(v.upcomingEventData)
  const sure = saniye(metin(v.lengthText) || (ortuler[0] ? metin(ortuler[0].text) : ''))
  return {
    videoId: v.videoId,
    baslik: metin(v.title),
    kanal: metin(v.ownerText) || metin(v.longBylineText) || metin(v.shortBylineText),
    sure: canli ? null : sure,
    canli
  }
}

function lockupOku(l) {
  if (!l || typeof l !== 'object') return null
  if (l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || !VIDEO_ID.test(String(l.contentId))) return null
  const meta = l.metadata && l.metadata.lockupMetadataViewModel
  const cmv = meta && meta.metadata && meta.metadata.contentMetadataViewModel
  const satirlar = cmv && Array.isArray(cmv.metadataRows) ? cmv.metadataRows : []
  const tvm = l.contentImage && l.contentImage.thumbnailViewModel
  const rozetler = []
  for (const o of (tvm && Array.isArray(tvm.overlays) ? tvm.overlays : [])) {
    const a = o && o.thumbnailBottomOverlayViewModel && o.thumbnailBottomOverlayViewModel.badges
    const b = o && o.thumbnailOverlayBadgeViewModel && o.thumbnailOverlayBadgeViewModel.thumbnailBadges
    for (const r of [].concat(Array.isArray(a) ? a : [], Array.isArray(b) ? b : [])) {
      if (r && r.thumbnailBadgeViewModel) rozetler.push(r.thumbnailBadgeViewModel)
    }
  }
  const canli = rozetler.some(r => {
    const kaynak = r.icon && Array.isArray(r.icon.sources) ? r.icon.sources[0] : null
    return Boolean(kaynak && kaynak.clientResource && kaynak.clientResource.imageName === 'LIVE')
  })
  const sure = rozetler.map(r => saniye(r.text)).find(x => x !== null)
  const ilk = satirlar[0] && Array.isArray(satirlar[0].metadataParts) ? satirlar[0].metadataParts[0] : null
  return {
    videoId: l.contentId,
    baslik: meta ? metin(meta.title) : '',
    kanal: ilk ? metin(ilk.text) : '',
    sure: canli || sure === undefined ? null : sure,
    canli
  }
}

function videolariTopla(kok) {
  const sonuc = []
  const gorulen = new Set()
  const yigin = [[kok, 0]]
  let dugum = 0
  while (yigin.length > 0) {
    const [d, derinlik] = yigin.pop()
    dugum += 1
    if (dugum > SINIR.dugum) throw new Error('dugum_siniri')
    if (!d || typeof d !== 'object' || derinlik > SINIR.derinlik) continue
    const ciftler = Array.isArray(d) ? d.map(v => ['', v]) : Object.entries(d)
    for (const [k, v] of ciftler.reverse()) {
      if (k && (REKLAM_SINIFLARI.has(sinifAdi(k)) || KAPSAYICI_ATLA.has(k))) continue
      const videoMu = VIDEO_DUGUMU.has(k) || k === 'lockupViewModel'
      if (!videoMu) {
        yigin.push([v, derinlik + 1])
        continue
      }
      const oge = k === 'lockupViewModel' ? lockupOku(v) : videoRendererOku(v)
      if (oge && !gorulen.has(oge.videoId)) {
        gorulen.add(oge.videoId)
        sonuc.push(oge)
      }
    }
  }
  return sonuc
}

function ilkCalinabilir(yanit) {
  const tc = yanit && yanit.contents && yanit.contents.twoColumnSearchResultsRenderer
  const kok = tc && tc.primaryContents ? tc.primaryContents : yanit
  return videolariTopla(kok).find(s => !s.canli && s.sure !== null && s.sure > 0) || null
}
```

Deneme sonucu: iki örnekte de sıra `TLSZcanli03` (canlı, süre yok), `TLSZornek01` (213 sn), `TLSZornek02` (3723 sn), ilk çalınabilir `TLSZornek01`. Reklam (`TLSZreklam4`), raf (`TLSZraf0005`), kanal ve oynatma listesi (ilk videosu `TLSZraf0005`) alınmadı. 100 düzey iç içe nesne derinlik sınırında boş sonuç verdi, 300 000 elemanlı dizi `dugum_siniri` hatası verdi, geçersiz videoId reddedildi. Taslak bilerek kanal kimliği, küçük resim ve sayaçları okumuyor, DJ için gerekmiyor.

## 7. Örnek dosyalar

Klasör: `/tmp/claude-0/-home-user-ps5-pc-communication/4f00f15f-448b-547a-84d4-7dd1552adf2f/scratchpad/yt-arama/`

| Dosya | İçerik | Beklenen çalınabilir sonuç |
| --- | --- | --- |
| `ornek-videorenderer.json` | `itemSectionRenderer` içinde sırayla: `adSlotRenderer` (içinde `searchPyvRenderer` ve `promotedVideoRenderer`, videoId `TLSZreklam4`), `channelRenderer`, canlı `videoRenderer` (`TLSZcanli03`, `BADGE_STYLE_TYPE_LIVE_NOW`, örtü `LIVE`, `watching`), normal `videoRenderer` `TLSZornek01` (3:33, iki parçalı `runs` başlık, Türkçe karakter), normal `videoRenderer` `TLSZornek02` (1:02:03, başlıkta `&`), `shelfRenderer` içinde `verticalListRenderer.items[].videoRenderer` (`TLSZraf0005`). Ayrıca `continuationItemRenderer`, `estimatedResults`, `refinements`, `responseContext.serviceTrackingParams` (`cver`) | `TLSZornek01`, `TLSZornek02` |
| `ornek-lockupviewmodel.json` | Aynı reklam ve kanal, canlı lockup (`TLSZcanli03`, rozet `icon...imageName: "LIVE"`), normal lockup `TLSZornek01` (süre `thumbnailBottomOverlayViewModel` içinde, tek kanal `decoratedAvatarViewModel`), normal lockup `TLSZornek02` (süre `thumbnailOverlayBadgeViewModel` içinde, ortak yapım `avatarStackViewModel`), oynatma listesi lockup (`LOCKUP_CONTENT_TYPE_PLAYLIST`, `collectionThumbnailViewModel`, `onTap` içinde ilk video `TLSZraf0005`) | `TLSZornek01`, `TLSZornek02` |

Örnekler elle hazırlandı, gerçek yanıt değildir. Kimlikler uydurmadır ama biçimleri gerçektir (videoId 11 karakter, kanal kimliği `UC` ile 22 karakter). Her dosyanın kökündeki `_aciklama` alanı bunu söyler. Testlere kopyalanırken `test/` altına alınması önerilir, çünkü scratchpad geçicidir.

Örneklerde kullanılan ama değeri doğrulanamayan şeyler: `badgeStyle` değerleri (`THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE`, `THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT`), canlı rozetin `text: "LIVE"` değeri, `position` değeri, lockup `onTap.innertubeCommand.watchEndpoint` yolu, reklamın iç yapısı, `serviceTrackingParams` içindeki `service: "CSI"` adı, `avatarImageSize` değeri, raf başlığı, `a11yLabel` ve `accessibilityContext.label` metinleri, rozet `tooltip` metni, sayaç ve tarih metinleri (`views`, `watching`, `ago`). Alan adlarının kendisi bölüm 2'deki satırlarla doğrulandı.

Yardımcı betikler (yalnızca deneme, depoya girmedi, hepsi `scratchpad/betikler/` altında): `taslak.js` (bölüm 6 taslağının aynısı), `taslak-dene.js` (taslağı örneklerle ve uç durumlarla dener), `ayristir-dene.js` (ilk prototip), `html-dene.js` (HTML çıkarma denemesi), `derinlik.js` (örnek derinliği ve düğüm sayısı), `temizle.js` (örnekten doğrulanamayan süs alanlarını çıkarır), `yasak.js` (yazım denetimi).

## 8. Doğrulanamayanlar (toplu liste)

- Bu kapsayıcıdan hiçbir canlı YouTube isteği yapılamadı. Aşağıdakilerin hepsi sunucuda sınanmalı.
- `key` olmadan isteğin kabul edildiği (iki bakımlı kütüphanenin davranışından çıkarım).
- Zorunlu başlık kümesi ve `User-Agent` gerekip gerekmediği.
- `params` alanının hangi kodlamasının (`EgIQAQ==`, `EgIQAQ%3D%3D`, `EgIQAQ%253D%253D`) süzgeç olarak uygulandığı.
- Eski `clientVersion` değerinin reddedilip reddedilmediği.
- `SOCS=CAI` çerezinin AB içinden onay yönlendirmesini önlediği ve anlamı. `CONSENT=YES+` biçimi hiç bulunamadı.
- Gerçek yanıt boyutları (JSON ve HTML) ve gerçek derinlik.
- Lockup canlı rozetinin `badgeStyle` ve `text` değerleri, lockup video `onTap` içindeki `watchEndpoint.videoId` yolu, `shortsLockupViewModel` içindeki videoId yolu.
- Reklam düğümlerinin iç yapısı.
- `ytInitialData` içinde `</script>` benzeri dizgilerin kaçış biçimi, `Accept-Encoding` gönderilmezse sıkıştırmasız yanıt gelip gelmediği.
- `gl=TR` ile sonuçların değişmesi.

## 9. Sunucuda ilk canlı denemede bakılacaklar

1. Önerilen gövde ve başlıklarla, `key` olmadan, `params: "EgIQAQ%3D%3D"` ile bir POST: durum kodu, `Content-Type`, gövde boyutu, kökteki anahtarlar.
2. `itemSectionRenderer.contents[]` doğrudan çocuklarının anahtar adları ve sayıları (videoRenderer mı lockupViewModel mı, hangi reklam düğümleri).
3. Aynı istek `params` olmadan ve `EgIQAQ==` ile: kanal ve liste öğeleri kayboluyor mu.
4. `clientVersion` olarak `1.20220406.00.00` ile: hata mı, farklı yanıt mı.
5. `Cookie: SOCS=CAI` olmadan HTML GET: 3xx ve `consent.youtube.com` yönlendirmesi geliyor mu. Sunucunun bulunduğu ülke not edilmeli.
6. HTML sayfasında `var ytInitialData = ` işaretinin varlığı ve `INNERTUBE_CONTEXT_CLIENT_VERSION` değeri.
7. Bir canlı yayın ve bir yaklaşan yayın sorgusu: rozet ve örtü değerleri.
8. Ölçülen boyutlara göre 4 MB ve 6 MB sınırlarının ve 200 000 düğüm sınırının daraltılması.
9. Gerçek yanıtlardan birer kesit, kimlikler değiştirilip `test/` altına sabit veri olarak eklenebilir (kişisel veri ve izleme jetonları silinerek).

## Kopyalar

Örnek yanıtlar ve ayrıştırıcı taslağı geçici çalışma alanından bu klasöre kopyalandı: `docs/calisma/yt-arama/ornek-videorenderer.json`, `docs/calisma/yt-arama/ornek-lockupviewmodel.json` ve `docs/calisma/yt-arama/taslak.js.txt`. Uygulama sırasında örnekler `test/` altına taşınır.
