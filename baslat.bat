@echo off
chcp 65001 >nul
setlocal
title Telsiz
REM Telsiz sunucusunu Windows'ta başlatır.
REM Starts the Telsiz server on Windows.
REM Bu dosyayı server.js ile aynı klasörde tutun ve çift tıklayarak çalıştırın.
REM Keep this file in the same folder as server.js and double click it.
REM Telsiz kullanıldığı sürece bu pencere açık kalmalıdır. Durdurmak için bu pencerede Ctrl+C tuşlarına basın.
REM Keep this window open while Telsiz is in use. Press Ctrl+C in this window to stop the server.
REM Verilen argümanlar sunucuya geçer, ör. baslat.bat sifre-sifirla kullaniciadi
REM Arguments are passed to the server, for example baslat.bat reset-password username

REM Betiğin bulunduğu klasöre geçilir, veri klasörü burada oluşur.
REM Change to the folder of this script, the data folder is created here.
cd /d "%~dp0"

REM Node.js kurulu mu ve sürümü 20 veya üstü mü kontrol edilir.
REM Check that Node.js is installed and its version is 20 or newer.
where node >nul 2>nul
if errorlevel 1 goto nodeyok
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 20 ? 0 : 1)" >nul 2>nul
if errorlevel 1 goto nodeeski

REM ------------------------------------------------------------------
REM Ayarlar. Değerleri yalnızca tırnak işaretlerinin içinde değiştirin.
REM Settings. Change the values only inside the quotation marks.
REM Değerlerde yüzde işareti ve çift tırnak kullanmayın, sorun çıkarabilir.
REM Do not use percent signs or double quotes in the values, they can cause problems.
REM Diğer ayarlar için README.md dosyasındaki Ayarlar bölümüne bakın.
REM See the Settings section in README.en.md for the other settings.
REM ------------------------------------------------------------------

REM Sunucunun başlangıç adı. Yalnızca ilk kurulumda kullanılır, en fazla 40 karakter.
REM Kurulumdan sonra sahip, sunucu adını uygulamadaki Ayarlar bölümünden değiştirir.
REM The initial server name. Used only on first setup, at most 40 characters.
REM After setup the owner changes the server name in the Settings of the app.
set "SUNUCU_ADI=Telsiz"

REM Sunucunun dinleyeceği bağlantı noktası.
REM Bu değeri değiştirirseniz tunel.bat dosyasındaki 3000 değerini de aynı sayıyla değiştirin.
REM The port the server listens on.
REM If you change it, change the value 3000 in tunel.bat to the same number.
set "PORT=3000"

REM TURN sunucusu ayarları. Çoğu kullanımda boş bırakılabilir.
REM Bazı ağlarda sesli sohbet bağlantısı kurulamaz ve bir TURN sunucusu gerekir.
REM TURN_URL sunucunun adresidir ve turn: ile başlar.
REM TURN_KULLANICI ve TURN_SIFRE o sunucunun kullanıcı adı ve parolasıdır.
REM TURN server settings. They can stay empty in most cases.
REM On some networks voice chat cannot connect without a TURN server.
REM TURN_URL is the address of the server and starts with turn:
REM TURN_KULLANICI and TURN_SIFRE are the user name and password for that server.
set "TURN_URL="
set "TURN_KULLANICI="
set "TURN_SIFRE="

echo Sunucu başlatılıyor...
echo Starting the server...
echo.
node server.js %*

echo.
echo Sunucu durdu.
echo The server stopped.
pause
exit /b 0

:nodeyok
echo Node.js bulunamadı.
echo Node.js was not found.
echo Lütfen https://nodejs.org adresinden Node.js 20 veya daha yeni bir sürüm kurun.
echo Please install Node.js 20 or newer from https://nodejs.org
echo Kurulum bittikten sonra bu pencereyi kapatıp baslat.bat dosyasına yeniden çift tıklayın.
echo After the installation close this window and double click baslat.bat again.
echo.
pause
exit /b 1

:nodeeski
set "SURUM=?"
for /f "delims=" %%v in ('node --version 2^>nul') do set "SURUM=%%v"
echo Kurulu Node.js sürümü (%SURUM%) eski. Telsiz için Node.js 20 veya daha yeni bir sürüm gerekir.
echo The installed Node.js version (%SURUM%) is too old. Telsiz needs Node.js 20 or newer.
echo Yeni sürümü https://nodejs.org adresinden kurun.
echo Install a newer version from https://nodejs.org
echo.
pause
exit /b 1
