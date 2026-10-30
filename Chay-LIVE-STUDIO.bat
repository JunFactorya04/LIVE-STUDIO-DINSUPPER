@echo off
setlocal
cd /d "%~dp0"
title LIVE STUDIO

echo === LIVE STUDIO ===

set "PATH=%PATH%;%ProgramFiles%\nodejs;%USERPROFILE%\.cargo\bin;%ProgramFiles%\Git\cmd"
where node >nul 2>nul
if errorlevel 1 goto :need_tools
where cargo >nul 2>nul
if errorlevel 1 goto :need_tools
goto :tools_ok

:need_tools
echo [!] May chua du cong cu (Node.js, Rust, C++ Build Tools). Dang mo trinh cai dat...
call "%~dp0Cai-dat-LIVE-STUDIO.bat"
exit /b 0

:tools_ok

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
