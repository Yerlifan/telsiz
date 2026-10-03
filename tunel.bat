@echo off
chcp 65001 >nul
setlocal
title Sohbet tüneli
REM Cloudflare hızlı tünelini açar. Hesap açmak gerekmez.
REM Tünel, sunucuyu https ile başlayan geçici bir adresle internete açar.
REM Sesli sohbet ve uygulama olarak yükleme için https adresi gerekir.
REM Önce baslat.bat ile sunucuyu başlatın, sonra bu dosyaya çift tıklayın.
REM Tünel kullanıldığı sürece bu pencere açık kalmalıdır.

REM Betiğin bulunduğu klasöre geçilir.
cd /d "%~dp0"

REM cloudflared kurulu mu kontrol edilir.
where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared programı bulunamadı.
  echo.
  echo Kurmak için Başlat menüsünden bir komut istemi veya PowerShell penceresi açıp şu komutu çalıştırın:
  echo.
  echo     winget install --id Cloudflare.cloudflared
  echo.
  echo Kurulum bittikten sonra açık olan tüm komut istemi ve PowerShell pencerelerini kapatın.
  echo Ardından tunel.bat dosyasına yeniden çift tıklayın.
  echo Program yine bulunamazsa bilgisayarı yeniden başlatıp tekrar deneyin.
  echo.
  pause
  exit /b 1
)

REM Sunucunun bağlantı noktası. PORT ortam değişkeni tanımlı değilse 3000 kullanılır.
REM baslat.bat içinde PORT değerini değiştirdiyseniz aşağıdaki satırdaki 3000 sayısını da aynı değerle değiştirin.
if not defined PORT set "PORT=3000"

echo Tünel açılıyor. Hedef adres: http://localhost:%PORT%
echo.
echo Birkaç saniye içinde aşağıdaki çıktıda https://....trycloudflare.com biçiminde bir adres görünecek.
echo Sohbeti bu adresle açın ve davet bağlantısını bu adresteyken kopyalayıp arkadaşlarınızla paylaşın.
echo Adres her çalıştırmada değişir.
echo Adres değişince herkesin yeniden giriş yapması ve yeni davet bağlantısını açması gerekir.
echo Uygulama olarak yüklenmiş sohbet eski adrese bağlı kalır, yeni adresten yeniden yükleyin.
echo Adresi fareyle seçip kopyalayın. Hiçbir metin seçili değilken Ctrl+C tuşlarına basmak tüneli kapatır.
echo Tüneli kapatmak için Ctrl+C tuşlarına basın veya bu pencereyi kapatın.
echo.

cloudflared tunnel --url http://localhost:%PORT%

echo.
echo Tünel kapandı.
pause
