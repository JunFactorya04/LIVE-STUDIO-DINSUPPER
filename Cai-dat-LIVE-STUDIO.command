#!/bin/bash
# Double-click on macOS: installs what LIVE STUDIO needs (once per Mac).
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

stop() {
  echo "[!] $1"
  read -n 1 -s -r -p "Nhan phim bat ky de dong..."
  exit 1
}

echo "=== Cai dat cong cu cho LIVE STUDIO (chi can lam mot lan moi may) ==="

if ! xcode-select -p >/dev/null 2>&1; then
  echo "[1/4] Cai Xcode Command Line Tools (se hien hop thoai, bam Install)..."
  xcode-select --install
  stop "Cho cai xong Xcode Command Line Tools roi nhap dup file nay lan nua."
else echo "[1/4] Xcode Command Line Tools: da co"; fi

if ! command -v brew >/dev/null 2>&1 && ! command -v node >/dev/null 2>&1; then
  echo "[2/4] Cai Homebrew (can mat khau may Mac)..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" || stop "Cai Homebrew bi loi."
  [ -x /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
  [ -x /usr/local/bin/brew ] && eval "$(/usr/local/bin/brew shellenv)"
else echo "[2/4] Homebrew/Node: da co hoac khong can"; fi

if ! command -v node >/dev/null 2>&1; then
  echo "[3/4] Cai Node.js..."
  brew install node || stop "Cai Node.js bi loi."
else echo "[3/4] Node.js: da co"; fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "[4/4] Cai Rust..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y || stop "Cai Rust bi loi."
else echo "[4/4] Rust: da co"; fi

echo
echo "Xong. Nhap dup Chay-LIVE-STUDIO.command de mo LIVE STUDIO."
read -n 1 -s -r -p "Nhan phim bat ky de dong..."
