# LIVE STUDIO

Ứng dụng desktop quản lý nội dung và phát trực tiếp trên nhiều nền tảng.
Chạy trên **macOS** và **Windows** từ cùng một mã nguồn.

## Công nghệ

- **Vỏ ứng dụng:** Tauri 2 (Rust), nhẹ, dùng WebView gốc của từng hệ điều hành
- **Giao diện:** React 18 + TypeScript + Vite
- **Thiết kế:** chuẩn Apple (macOS/iOS), token nằm ở `src/theme/tokens.css`
- **Ngôn ngữ giao diện:** tiếng Việt, chuỗi đặt tập trung ở `src/i18n/vi.ts`

## Yêu cầu

- Node.js 20 trở lên
- Rust (stable) — cài qua [rustup](https://rustup.rs)
- macOS: Xcode Command Line Tools (`xcode-select --install`)
- Windows: Microsoft C++ Build Tools và WebView2 (Windows 10/11 đã có sẵn)
- Linux (chỉ để thử): `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`

## Chạy thử

```bash
npm install
npm run tauri:dev      # mở cửa sổ ứng dụng với hot reload
npm run build          # kiểm tra kiểu và build giao diện
```

## Đóng gói

```bash
npm run tauri:build    # macOS: .dmg/.app · Windows: .msi/.exe
```

Bản build chính thức được tạo tự động bởi GitHub Actions (xem `.github/workflows/build.yml`).

## Cấu trúc

```
src/
  theme/        token màu, kích thước, font (tokens.css) và layout (base.css)
  i18n/         toàn bộ chuỗi giao diện (tiếng Việt)
  components/   vỏ ứng dụng, icon, trạng thái trống/tải/lỗi
  navigation.ts danh sách mục menu (dùng cho sidebar và tab bar)
  App.tsx       khung chính
src-tauri/
  src/lib.rs    lệnh phía backend (thêm tại đây)
  tauri.conf.json, capabilities/  cấu hình cửa sổ và quyền
docs/
  PLAN.md       kế hoạch và danh sách tính năng
```

## Quy ước

- Mọi màu và cỡ chữ lấy từ token, không viết trực tiếp.
- Mọi danh sách và trang phải có đủ 3 trạng thái: đang tải, trống, lỗi.
- Code platform riêng đặt sau `#[cfg(target_os = "...")]` để cả hai hệ điều hành cùng build được.
- Mỗi tab phải kiểm tra ở hai kích thước: desktop 1440×900 và điện thoại 390×844.
