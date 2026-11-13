# Ek siteler

Docker Compose örneğindeki Caddy, Telsiz'in yanında aynı sunucuda başka siteleri de sunabilir. Örneğin Telsiz `telsiz.ornek.com` adresindeyken ana alan adı `ornek.com` kişisel bir sayfayı gösterebilir. Bu klasördeki her `.caddy` dosyası bir site tanımıdır. Klasör kapsayıcıda `/srv/siteler` olarak salt okunur bağlanır ve [Caddyfile](../Caddyfile) bu dosyaları `import /srv/siteler/*.caddy` satırıyla yükler. Klasör boşsa Caddy yalnızca bir uyarı yazar.

Bu klasöre koyduğunuz dosyalar sunucuya özeldir ve depoya girmez (`.gitignore`). Bu yüzden `git pull` onlara dokunmaz.

## Örnek: durağan bir sayfa

Klasör yapısı:

```text
deploy/siteler/
  ornek.caddy
  ornek/
    index.html
```

`ornek.caddy`:

```caddy
ornek.com {
	root * /srv/siteler/ornek
	file_server
}
```

Sitenin alan adının DNS kaydı bu sunucuyu göstermelidir. Caddy sertifikayı Telsiz'in sertifikası gibi kendisi alır ve yeniler. Dosyaları ekledikten veya değiştirdikten sonra Caddy'nin yapılandırmasını yeniden yükleyin:

```sh
docker compose -f deploy/docker-compose.yml --profile caddy exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Caddy yeni yapılandırmayı uygulamadan önce denetler. Bir site tanımında hata varsa komut hatayı yazar ve Caddy eski yapılandırmayla çalışmaya devam eder, Telsiz etkilenmez. Yeniden başlatma (`restart`) bu güvenceyi vermez. Yapılandırma hatalıysa Caddy başlamaz ve Telsiz'e de ulaşılamaz. Sertifikanın alınıp alınmadığını günlükten izleyin:

```sh
docker compose -f deploy/docker-compose.yml --profile caddy logs caddy
```

Bu klasör desteğinden önce kurulmuş bir sunucuda Caddy kapsayıcısı klasörü ancak yeniden oluşturulunca görür. Güncellemeden sonra bir kez şu komutu çalıştırın:

```sh
docker compose -f deploy/docker-compose.yml --profile caddy up -d
```

## Telsiz'i alt alan adına taşımak

Bir site dosyası `TELSIZ_ALAN_ADI` ile aynı alan adını tanımlayamaz. Caddy bu durumu `ambiguous site definition` hatasıyla reddeder. Telsiz ana alan adında çalışıyorsa ve ana alan adında başka bir sayfa göstermek istiyorsanız önce `deploy/.env` dosyasındaki `TELSIZ_ALAN_ADI` değerini yeni alt alan adıyla değiştirin, sonra ana alan adının site dosyasını ekleyin. Ortam değişkeni yalnızca kapsayıcı yeniden oluşturulunca değiştiği için bu durumda `reload` yerine yukarıdaki `up -d` komutunu kullanın. Alt alan adının DNS kaydı önceden hazır olmalıdır, yoksa Caddy o alan adı için sertifika alamaz.

Caddy'yi Docker olmadan kullanıyorsanız site dosyalarını sunucuda `/srv/siteler/` klasörüne koyabilir veya `deploy/Caddyfile` içindeki `import` satırını kendi yolunuza göre değiştirebilirsiniz.

# Additional sites

The Caddy in the Docker Compose example can serve other sites on the same server next to Telsiz. For example, while Telsiz runs at `telsiz.example.com`, the main domain `example.com` can show a personal page. Each `.caddy` file in this folder is a site definition. The folder is mounted read-only as `/srv/siteler` in the container, and the [Caddyfile](../Caddyfile) loads these files with the line `import /srv/siteler/*.caddy`. If the folder is empty, Caddy only logs a warning.

The files you put in this folder belong to your server and do not enter the repository (`.gitignore`), so `git pull` leaves them alone.

## Example: a static page

Folder layout:

```text
deploy/siteler/
  example.caddy
  example/
    index.html
```

`example.caddy`:

```caddy
example.com {
	root * /srv/siteler/example
	file_server
}
```

The site's DNS record must point to this server. Caddy obtains and renews its certificate by itself, like Telsiz's. Reload Caddy's configuration after adding or changing files:

```sh
docker compose -f deploy/docker-compose.yml --profile caddy exec caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Caddy checks the new configuration before applying it. If a site definition has an error, the command prints it and Caddy keeps running with the previous configuration, so Telsiz is not affected. A restart (`restart`) gives no such guarantee. With a faulty configuration Caddy does not start and Telsiz becomes unreachable too. Follow the certificate issuance in the log:

```sh
docker compose -f deploy/docker-compose.yml --profile caddy logs caddy
```

On a server set up before this folder was supported, the Caddy container sees the folder only after it is recreated. Run this command once after updating:

```sh
docker compose -f deploy/docker-compose.yml --profile caddy up -d
```

## Moving Telsiz to a subdomain

A site file cannot define the same domain as `TELSIZ_ALAN_ADI`. Caddy rejects this with an `ambiguous site definition` error. If Telsiz runs on the main domain and you want another page there, first change `TELSIZ_ALAN_ADI` in `deploy/.env` to the new subdomain, then add the main domain's site file. Because the environment variable changes only when the container is recreated, use the `up -d` command above instead of `reload` in this case. The subdomain's DNS record must be ready beforehand, otherwise Caddy cannot obtain a certificate for it.

If you run Caddy without Docker, put the site files in the `/srv/siteler/` folder on the server or change the `import` line in `deploy/Caddyfile` to your own path.
