#!/bin/sh
# Telsiz sunucusunu Linux ve macOS'ta başlatır.
# Starts the Telsiz server on Linux and macOS.
#
# Kullanım: ./baslat.sh (çalıştırma izni yoksa önce: chmod +x baslat.sh)
# Usage: ./baslat.sh (if it is not executable yet, first run: chmod +x baslat.sh)
# Verilen argümanlar sunucuya geçer, ör. ./baslat.sh sifre-sifirla <kullanıcı adı>
# Arguments are passed to the server, for example ./baslat.sh reset-password <username>
# Sunucu çalıştığı sürece bu terminal açık kalmalıdır. Durdurmak için Ctrl+C tuşlarına basın.
# Keep this terminal open while the server runs. Press Ctrl+C to stop it.

set -eu

# ------------------------------------------------------------------
# Ayarlar. Bir ayarı kullanmak için satırın başındaki # işaretini kaldırın ve değeri değiştirin.
# Settings. To use a setting, remove the # at the start of its line and change the value.
# Diğer ayarlar için README.md dosyasındaki Ayarlar bölümüne bakın.
# See the Settings section in README.md for the other settings.
# ------------------------------------------------------------------

# Sunucunun başlangıç adı. Yalnızca ilk kurulumda kullanılır, en fazla 40 karakter.
# The initial server name. Used only on first setup, at most 40 characters.
# export SUNUCU_ADI="Telsiz"

# Sunucunun dinleyeceği bağlantı noktası, varsayılan 3000. Değiştirirseniz tunel.sh için de aynı değeri verin.
# The port the server listens on, 3000 by default. If you change it, give tunel.sh the same value.
# export PORT=3000

# TURN sunucusu. Çoğu kullanımda gerekmez, bazı ağlarda sesli sohbet için gerekir.
# A TURN server. Not needed in most cases, some networks need it for voice chat.
# export TURN_URL="turn:turn.ornek.com:3478"
# export TURN_KULLANICI="kullanici"
# export TURN_SIFRE="parola"

# Betiğin bulunduğu klasöre geçilir, veri klasörü burada oluşur
# Change to the folder of this script, the data folder is created here
CDPATH='' cd -- "$(dirname -- "$0")"

if ! command -v node >/dev/null 2>&1
then
  echo "Node.js bulunamadı."
  echo "Node.js was not found."
  echo "Node.js 20 veya daha yeni bir sürümü https://nodejs.org adresinden ya da dağıtımınızın paket yöneticisiyle kurun."
  echo "Install Node.js 20 or newer from https://nodejs.org or with the package manager of your distribution."
  echo "Kurulumdan sonra bu betiği yeniden çalıştırın."
  echo "Run this script again after the installation."
  exit 1
fi

if ! node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >/dev/null 2>&1
then
  surum=$(node --version 2>/dev/null || echo "?")
  echo "Kurulu Node.js sürümü (${surum}) eski. Telsiz için Node.js 20 veya daha yeni bir sürüm gerekir."
  echo "The installed Node.js version (${surum}) is too old. Telsiz needs Node.js 20 or newer."
  echo "Yeni sürümü https://nodejs.org adresinden ya da dağıtımınızın paket yöneticisiyle kurun."
  echo "Install a newer version from https://nodejs.org or with the package manager of your distribution."
  exit 1
fi

echo "Sunucu başlatılıyor..."
echo "Starting the server..."
echo
exec node server.js "$@"
