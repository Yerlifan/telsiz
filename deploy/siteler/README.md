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

Sitenin alan adının DNS kaydı bu sunucuyu göstermelidir. Caddy sertifikayı Telsiz'in sertifikası gibi kendisi alır ve yeniler. Dosyaları ekledikten veya değiştirdikten sonra Caddy'yi yeniden başlatın:

```sh
docker compose -f deploy/docker-compose.yml --profile caddy restart caddy
```

Bir site tanımında hata varsa Caddy başlamaz ve Telsiz'e de ulaşılamaz. Yeniden başlattıktan sonra günlüğe bakın:

```sh
docker compose -f deploy/docker-compose.yml logs caddy
```

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

The site's DNS record must point to this server. Caddy obtains and renews its certificate by itself, like Telsiz's. Restart Caddy after adding or changing files:

```sh
docker compose -f deploy/docker-compose.yml --profile caddy restart caddy
```

If a site definition has an error, Caddy does not start and Telsiz becomes unreachable too. Check the log after restarting:

```sh
docker compose -f deploy/docker-compose.yml logs caddy
```

If you run Caddy without Docker, put the site files in the `/srv/siteler/` folder on the server or change the `import` line in `deploy/Caddyfile` to your own path.
