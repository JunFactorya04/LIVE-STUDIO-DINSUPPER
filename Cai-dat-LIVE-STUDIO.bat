@echo off
setlocal
cd /d "%~dp0"
title LIVE STUDIO - cai dat cong cu

echo === Cai dat cong cu cho LIVE STUDIO (chi can lam mot lan moi may) ===
echo Se cai neu chua co: Git, Node.js LTS, Rust, Microsoft C++ Build Tools.
echo Windows co the hoi quyen quan tri (bam Yes). Co the mat 10-20 phut.
echo.

where winget >nul 2>nul
if errorlevel 1 (
  echo [!] May chua co winget ^(Windows 10/11 cap nhat day du thi co^).
  echo     Cai tay: https://git-scm.com  https://nodejs.org  https://rustup.rs
  echo     va Microsoft C++ Build Tools, roi chay Chay-LIVE-STUDIO.bat.
  pause
  exit /b 1
)

where git >nul 2>nul
if errorlevel 1 (
  echo [1/4] Cai Git...
  winget install --id Git.Git -e --silent --accept-package-agreements --accept-source-agreements
) else (echo [1/4] Git: da co)

where node >nul 2>nul
if errorlevel 1 (
  echo [2/4] Cai Node.js LTS...
  winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
) else (echo [2/4] Node.js: da co)

where cargo >nul 2>nul
if errorlevel 1 (
  echo [3/4] Cai Rust...
  winget install --id Rustlang.Rustup -e --silent --accept-package-agreements --accept-source-agreements
) else (echo [3/4] Rust: da co)

set "VSW=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "HAS_VC="
if exist "%VSW%" for /f "usebackq delims=" %%i in (`"%VSW%" -products * -latest -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "HAS_VC=%%i"
if defined HAS_VC (
  echo [4/4] Microsoft C++ Build Tools: da co
) else (
  echo [4/4] Cai Microsoft C++ Build Tools ^(lon, cho mot luc^)...
  winget install --id Microsoft.VisualStudio.2022.BuildTools -e --accept-package-agreements --accept-source-agreements --override "--passive --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
)

echo.
echo Xong. Dong cua so nay, roi nhap dup Chay-LIVE-STUDIO.bat ^(mo cua so moi de nhan cong cu vua cai^).
pause
