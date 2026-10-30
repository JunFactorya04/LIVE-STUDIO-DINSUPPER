@echo off
setlocal
cd /d "%~dp0"
title LIVE STUDIO - tao file exe

echo === Tao file exe cho Windows ===

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Chua cai Node.js 20 tro len. Tai tai https://nodejs.org roi chay lai file nay.
  pause
  exit /b 1
)
where cargo >nul 2>nul
if errorlevel 1 (
  echo [!] Chua cai Rust. Tai tai https://rustup.rs, cai Microsoft C++ Build Tools, roi chay lai file nay.
  pause
  exit /b 1
)

where git >nul 2>nul
if not errorlevel 1 (
  git pull --ff-only
  if errorlevel 1 echo [!] Khong cap nhat duoc tu GitHub, dung ban dang co tren may.
)

call npm install
if errorlevel 1 (
  echo [!] npm install bi loi, xem thong bao phia tren.
  pause
  exit /b 1
)

echo Dang bien dich ban phat hanh, lan dau mat 10 den 20 phut...
call npm run tauri:build
if errorlevel 1 (
  echo [!] Bien dich bi loi, xem thong bao phia tren.
  pause
  exit /b 1
)

if not exist release-exe mkdir release-exe
copy /y "src-tauri\target\release\live-studio.exe" "release-exe\LIVE-STUDIO.exe" >nul
copy /y "src-tauri\target\release\bundle\nsis\*-setup.exe" "release-exe\" >nul 2>nul

echo.
echo Xong. Nhap dup release-exe\LIVE-STUDIO.exe de chay, hoac chay file *-setup.exe de cai dat.
start "" explorer "release-exe"
pause
