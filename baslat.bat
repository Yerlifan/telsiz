@echo off
chcp 65001 >nul
setlocal
title Sohbet sunucusu
REM PS5 + PC Sohbet sunucusunu başlatır.
REM Bu dosyayı server.js ile aynı klasörde tutun ve çift tıklayarak çalıştırın.
REM Sohbet sürdüğü sürece bu pencere açık kalmalıdır.

REM Betiğin bulunduğu klasöre geçilir.
cd /d "%~dp0"

REM Node.js kurulu mu kontrol edilir.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadı.
  echo Lütfen https://nodejs.org adresinden Node.js 18 veya daha yeni bir sürüm kurun.
  echo Kurulum bittikten sonra bu pencereyi kapatıp baslat.bat dosyasını yeniden çalıştırın.
  echo.
  pause
  exit /b 1
)

REM ------------------------------------------------------------------
REM Ayarlar. Değerleri yalnızca tırnak işaretlerinin içinde değiştirin.
REM ------------------------------------------------------------------

REM Sohbet odasının adı. En fazla 40 karakter kullanılır.
set "ODA_ADI=Sohbet"

REM Oda şifresi. Boş bırakılırsa oda şifresiz olur ve adresi bilen herkes katılabilir.
REM Sohbeti tünel veya port yönlendirme ile internete açacaksanız mutlaka bir şifre yazın.
REM Örnek: set "ODA_SIFRESI=kaplan42"
REM Şifrede harf ve rakam kullanmanız önerilir. Yüzde işareti ve çift tırnak sorun çıkarabilir.
set "ODA_SIFRESI="

REM Sunucunun dinleyeceği bağlantı noktası.
REM Bu değeri değiştirirseniz tunel.bat dosyasındaki 3000 değerini de aynı sayıyla değiştirin.
set "PORT=3000"

echo Sunucu başlatılıyor...
echo.
node server.js

echo.
echo Sunucu durdu.
pause
