#!/bin/sh
# Cloudflare hızlı tünelini açar. Hesap açmak gerekmez.
# Opens a Cloudflare quick tunnel. No account is needed.
#
# Tünel, sunucuyu https ile başlayan geçici bir adresle internete açar. Sesli sohbet ve
# uygulama olarak yükleme için https adresi gerekir. Önce baslat.sh ile sunucuyu başlatın,
# sonra başka bir terminalde bu betiği çalıştırın.
# The tunnel exposes the server to the internet at a temporary address that starts with https.
# Voice chat and installing the app need an https address. Start the server with baslat.sh
# first, then run this script in another terminal.
#
# Kullanım: ./tunel.sh (çalıştırma izni yoksa önce: chmod +x tunel.sh)
# Usage: ./tunel.sh (if it is not executable yet, first run: chmod +x tunel.sh)
# Sunucu 3000 dışında bir bağlantı noktasındaysa: PORT=4000 ./tunel.sh
# If the server uses a port other than 3000: PORT=4000 ./tunel.sh

set -eu

CDPATH='' cd -- "$(dirname -- "$0")"

if ! command -v cloudflared >/dev/null 2>&1
then
  echo "cloudflared programı bulunamadı."
  echo "The cloudflared program was not found."
  echo "Cloudflare'in resmi indirme sayfasından sisteminize uygun paketi kurun:"
  echo "Install the package for your system from the official Cloudflare download page:"
  echo "  https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/"
  echo "Sürümler ayrıca şu adreste yayımlanır:"
  echo "Releases are also published at:"
  echo "  https://github.com/cloudflare/cloudflared/releases"
  echo "Kurulumdan sonra bu betiği yeniden çalıştırın."
  echo "Run this script again after the installation."
  exit 1
fi

port="${PORT:-3000}"
if ! printf '%s\n' "${port}" | grep -Eq '^[0-9]{1,5}$'
then
  echo "PORT değeri geçersiz: ${port}"
  echo "The PORT value is invalid: ${port}"
  exit 1
fi

echo "Tünel açılıyor. Hedef adres: http://localhost:${port}"
echo "Opening the tunnel. Target address: http://localhost:${port}"
echo
echo "Birkaç saniye içinde aşağıdaki çıktıda https://....trycloudflare.com biçiminde bir adres görünecek."
echo "In a few seconds an address like https://....trycloudflare.com appears in the output below."
echo "Telsiz'i bu adresle açın ve davet bağlantısını bu adresteyken kopyalayıp paylaşın."
echo "Open Telsiz at that address and copy the invite link while you are on it."
echo "Adres her çalıştırmada değişir. Adres değişince herkesin yeni adresle yeniden giriş yapması gerekir."
echo "The address changes on every run. When it changes, everyone has to sign in again at the new address."
echo "Tüneli kapatmak için Ctrl+C tuşlarına basın."
echo "Press Ctrl+C to close the tunnel."
echo
exec cloudflared tunnel --url "http://localhost:${port}"
