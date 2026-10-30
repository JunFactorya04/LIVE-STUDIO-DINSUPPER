@echo off
setlocal
cd /d "%~dp0"
title LIVE STUDIO

echo === LIVE STUDIO ===

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
  echo Dang cap nhat tu GitHub...
  git pull --ff-only
  if errorlevel 1 echo [!] Khong cap nhat duoc tu GitHub, dung ban dang co tren may.
)

echo Dang cai thu vien, lan dau co the mat vai phut...
call npm install
if errorlevel 1 (
  echo [!] npm install bi loi, xem thong bao phia tren.
  pause
  exit /b 1
)

echo Dang mo LIVE STUDIO. Lan dau bien dich Rust mat vai phut, cac lan sau nhanh hon.
call npm run tauri:dev
if errorlevel 1 (
  echo [!] LIVE STUDIO bi loi khi chay, xem thong bao phia tren.
  pause
)
