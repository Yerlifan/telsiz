@echo off
chcp 65001 >nul
setlocal
title Sohbet tüneli
REM Cloudflare hızlı tünelini açar. Hesap açmak gerekmez.
REM Tünel sayesinde farklı evlerdeki arkadaşlarınız sohbete internet üzerinden bağlanabilir.
REM Önce baslat.bat ile sunucuyu başlatın, sonra bu dosyayı çift tıklayarak çalıştırın.
REM Tünel kullanıldığı sürece bu pencere açık kalmalıdır.

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
  echo Ardından tunel.bat dosyasını yeniden çalıştırın.
  echo.
  pause
  exit /b 1
)

REM Sunucunun bağlantı noktası. PORT ortam değişkeni tanımlıysa o kullanılır, tanımlı değilse 3000.
REM baslat.bat içinde PORT değerini değiştirdiyseniz aşağıdaki satırdaki 3000 sayısını da aynı değerle değiştirin.
if not defined PORT set "PORT=3000"

echo Tünel açılıyor. Hedef adres: http://localhost:%PORT%
echo.
echo Birkaç saniye içinde aşağıdaki çıktıda https://....trycloudflare.com biçiminde bir adres görünecek.
echo Bu adresi sohbete katılacak arkadaşlarınızla paylaşın.
echo Adres her çalıştırmada değişir. Tüneli yeniden açtığınızda yeni adresi tekrar paylaşmanız gerekir.
echo Adresi fareyle seçerek kopyalayın. Hiçbir metin seçili değilken Ctrl+C tuşlarına basmak tüneli kapatır.
echo Tüneli kapatmak için Ctrl+C tuşlarına basın veya bu pencereyi kapatın.
echo.

cloudflared tunnel --url http://localhost:%PORT%

echo.
echo Tünel kapandı.
pause
