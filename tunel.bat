@echo off
chcp 65001 >nul
setlocal
title Telsiz tüneli
REM Cloudflare hızlı tünelini açar. Hesap açmak gerekmez.
REM Opens a Cloudflare quick tunnel. No account is needed.
REM Tünel, sunucuyu https ile başlayan geçici bir adresle internete açar.
REM The tunnel makes the server reachable on the internet with a temporary https address.
REM Sesli sohbet ve uygulama olarak yükleme için https adresi gerekir.
REM Voice chat and installing as an app need an https address.
REM Önce baslat.bat ile sunucuyu başlatın, sonra bu dosyaya çift tıklayın.
REM First start the server with baslat.bat, then double click this file.
REM Tünel kullanıldığı sürece bu pencere açık kalmalıdır.
REM Keep this window open while the tunnel is in use.

REM Betiğin bulunduğu klasöre geçilir.
REM Change to the folder of this script.
cd /d "%~dp0"

REM cloudflared kurulu mu kontrol edilir.
REM Check that cloudflared is installed.
where cloudflared >nul 2>nul
if errorlevel 1 goto cfyok

REM Sunucunun bağlantı noktası. PORT ortam değişkeni tanımlı değilse 3000 kullanılır.
REM baslat.bat içinde PORT değerini değiştirdiyseniz aşağıdaki satırdaki 3000 sayısını da aynı değerle değiştirin.
REM The port of the server. 3000 is used when the PORT environment variable is not set.
REM If you changed PORT in baslat.bat, change 3000 on the next line to the same value.
if not defined PORT set "PORT=3000"

echo Tünel açılıyor. Hedef adres: http://localhost:%PORT%
echo Opening the tunnel. Target address: http://localhost:%PORT%
echo.
echo Birkaç saniye içinde aşağıdaki çıktıda https://....trycloudflare.com biçiminde bir adres görünecek.
echo In a few seconds an address like https://....trycloudflare.com appears in the output below.
echo Telsiz'i bu adresle açın ve davet bağlantısını bu adresteyken kopyalayıp arkadaşlarınızla paylaşın.
echo Open Telsiz with this address and copy the invite link while on this address to share it with your friends.
echo Adres her çalıştırmada değişir. Adres değişince herkesin yeniden giriş yapması ve yeni davet bağlantısını açması gerekir.
echo The address changes on every run. When it changes everyone has to sign in again and open the new invite link.
echo Uygulama olarak yüklenmiş Telsiz eski adrese bağlı kalır, yeni adresten yeniden yükleyin.
echo An installed Telsiz app stays bound to the old address, install it again from the new address.
echo Adresi fareyle seçip kopyalayın. Hiçbir metin seçili değilken Ctrl+C tuşlarına basmak tüneli kapatır.
echo Select the address with the mouse to copy it. Pressing Ctrl+C with no text selected closes the tunnel.
echo Tüneli kapatmak için Ctrl+C tuşlarına basın veya bu pencereyi kapatın.
echo To close the tunnel press Ctrl+C or close this window.
echo.

cloudflared tunnel --url http://localhost:%PORT%

echo.
echo Tünel kapandı.
echo The tunnel closed.
pause
exit /b 0

:cfyok
echo cloudflared programı bulunamadı.
echo The cloudflared program was not found.
echo.
echo Kurmak için Başlat menüsünden bir komut istemi veya PowerShell penceresi açıp şu komutu çalıştırın:
echo To install it, open a Command Prompt or PowerShell window from the Start menu and run:
echo.
echo     winget install --id Cloudflare.cloudflared
echo.
echo Kurulum bittikten sonra açık olan tüm komut istemi ve PowerShell pencerelerini kapatın, ardından tunel.bat dosyasına yeniden çift tıklayın.
echo After the installation close all open Command Prompt and PowerShell windows, then double click tunel.bat again.
echo Program yine bulunamazsa bilgisayarı yeniden başlatıp tekrar deneyin.
echo If the program is still not found, restart the computer and try again.
echo.
pause
exit /b 1
