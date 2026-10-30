#!/bin/bash
# Double-click on macOS: updates from GitHub, installs packages and opens LIVE STUDIO.
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

stop() {
  echo "[!] $1"
  read -n 1 -s -r -p "Nhan phim bat ky de dong..."
  exit 1
}

echo "=== LIVE STUDIO ==="
if ! command -v node >/dev/null 2>&1 || ! command -v cargo >/dev/null 2>&1 || ! xcode-select -p >/dev/null 2>&1; then
  echo "[!] May chua du cong cu (Node.js, Rust, Xcode CLT). Dang mo trinh cai dat..."
  exec bash "$(dirname "$0")/Cai-dat-LIVE-STUDIO.command"
fi

if command -v git >/dev/null 2>&1; then
  echo "Dang cap nhat tu GitHub..."
  git pull --ff-only || echo "[!] Khong cap nhat duoc tu GitHub, dung ban dang co tren may."
fi

echo "Dang cai thu vien, lan dau co the mat vai phut..."
npm install || stop "npm install bi loi, xem thong bao phia tren."

echo "Dang mo LIVE STUDIO. Lan dau bien dich Rust mat vai phut, cac lan sau nhanh hon."
npm run tauri:dev || stop "LIVE STUDIO bi loi khi chay, xem thong bao phia tren."
