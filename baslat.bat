@echo off
chcp 65001 >nul
setlocal
title Sohbet sunucusu
REM PS5 + PC Sohbet sunucusunu başlatır.
REM Bu dosyayı server.js ile aynı klasörde tutun ve çift tıklayarak çalıştırın.
REM Sohbet sürdüğü sürece bu pencere açık kalmalıdır.
REM Sunucuyu durdurmak için bu pencerede Ctrl+C tuşlarına basın.

REM Betiğin bulunduğu klasöre geçilir.
cd /d "%~dp0"

REM Node.js kurulu mu kontrol edilir.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadı.
  echo Lütfen https://nodejs.org adresinden Node.js 20 veya daha yeni bir sürüm kurun.
  echo Kurulum bittikten sonra bu pencereyi kapatıp baslat.bat dosyasına yeniden çift tıklayın.
  echo.
  pause
  exit /b 1
)

REM ------------------------------------------------------------------
REM Ayarlar. Değerleri yalnızca tırnak işaretlerinin içinde değiştirin.
REM Değerlerde yüzde işareti ve çift tırnak kullanmayın, sorun çıkarabilir.
REM Diğer ayarlar için README.md dosyasındaki Ayarlar bölümüne bakın.
REM ------------------------------------------------------------------

REM Sunucunun başlangıç adı. Yalnızca ilk kurulumda kullanılır, en fazla 40 karakter.
REM Kurulumdan sonra sahip, sunucu adını uygulamadaki Ayarlar penceresinin Sunucu sekmesinden değiştirir.
set "SUNUCU_ADI=Sohbet"

REM Sunucunun dinleyeceği bağlantı noktası.
REM Bu değeri değiştirirseniz tunel.bat dosyasındaki 3000 değerini de aynı sayıyla değiştirin.
set "PORT=3000"

REM TURN sunucusu ayarları. Çoğu kullanımda boş bırakılabilir.
REM Bazı ağlarda sesli sohbet bağlantısı kurulamaz ve bir TURN sunucusu gerekir.
REM Kendi TURN sunucunuz veya kullandığınız bir TURN hizmeti varsa bilgilerini aşağıya yazın.
REM TURN_URL sunucunun adresidir ve turn: ile başlar.
REM TURN_KULLANICI ve TURN_SIFRE o sunucunun kullanıcı adı ve parolasıdır.
set "TURN_URL="
set "TURN_KULLANICI="
set "TURN_SIFRE="

echo Sunucu başlatılıyor...
echo.
node server.js

echo.
echo Sunucu durdu.
pause
