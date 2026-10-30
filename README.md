# LIVE STUDIO

Ứng dụng desktop **Local Shop Assistant — TikTok LIVE Assistant**: hỗ trợ người bán xử lý bình luận
livestream, đề xuất trả lời và tạo đơn nháp. Chạy trên **macOS** và **Windows** từ cùng một mã nguồn.

Yêu cầu sản phẩm: [`docs/TIKTOK_LIVE_ASSISTANT.md`](docs/TIKTOK_LIVE_ASSISTANT.md).
Kế hoạch và quyết định kiến trúc: [`docs/IMPLEMENTATION_PLAN_TIKTOK_LIVE.md`](docs/IMPLEMENTATION_PLAN_TIKTOK_LIVE.md).

## Trạng thái

| Phase | Nội dung                                       | Trạng thái                          |
| ----- | ---------------------------------------------- | ----------------------------------- |
| 0     | Khảo sát repo, kế hoạch                        | Xong                                |
| 1     | Giao diện Live Setup/Console + Demo provider   | **Xong**                            |
| 2a    | SQLite, dán chat thủ công, khôi phục, khóa API | **Xong**                            |
| 2b    | Catalog SKU + đọc đơn bằng luật                | **Xong**                            |
| 3     | AI phân loại + đơn nháp                        | Chưa                                |
| 4     | Gợi ý trả lời + overlay                        | Chưa                                |
| 5     | Provider live thật                             | Chờ xác minh nguồn bình luận hợp lệ |
| 6     | Hardening                                      | Chưa                                |

**TikTok không có API chính thức để đọc bình luận LIVE.** App có ba cách lấy bình luận:

| Cách                         | Nhãn                   | Ghi chú                                                                                                                 |
| ---------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Dán thủ công                 | `MANUAL`               | Sao chép chat từ màn hình live của bạn. Không cần tài khoản.                                                            |
| Demo                         | `DEMO`                 | Bình luận giả để thử giao diện.                                                                                         |
| Tự động qua **Euler Stream** | `UNOFFICIAL_CONNECTOR` | Dịch vụ bên thứ ba, **không phải TikTok**; cần khóa API của bạn; có thể ngừng hoạt động hoặc vi phạm điều khoản TikTok. |

App chỉ hiện `Connected` khi dịch vụ xác nhận (tin `tiktok.connect`, `room.status: connected` hoặc có bình luận thật);
không có khóa, ở trình duyệt thường, hoặc khi mất kết nối thì hiện lý do cụ thể. Chưa kiểm thử với Euler Stream thật
(môi trường phát triển không gọi được dịch vụ này), xem `docs/IMPLEMENTATION_PLAN_TIKTOK_LIVE.md`, mục 7.

**Đơn nháp (2b):** mỗi bình luận được đọc bằng luật cố định (không AI) và ghép vào đơn nháp của đúng khách. Chỉ khớp với
**danh mục sản phẩm** bạn nhập (tab "商品目錄", hoặc dán từ Excel/CSV). Đơn thiếu màu/size/số lượng, mã không có trong
danh mục, nhiều mã trong một bình luận hoặc số lượng bất thường đều thành **待確認** kèm lý do, và không thể xác nhận
trực tiếp. App không tự tạo đơn, không tự trả lời, không bao giờ tự điền tên/số điện thoại/địa chỉ; người bán bấm Xác nhận
hoặc Hủy cho từng đơn.

Dữ liệu được lưu trong SQLite trên máy (`live-studio.db` ở thư mục dữ liệu của app) và tự nạp lại khi mở app.
Khóa API (Claude, OpenAI, Gemini, Euler Stream) do người dùng tự nhập ở **Cài đặt**, lưu trong Keychain / Credential
Manager; app không bao giờ đọc ngược hay hiển thị khóa, và kết nối Euler Stream chạy ở Rust nên khóa không rời Rust.

## Công nghệ

- **Vỏ ứng dụng:** Tauri 2 (Rust), dùng WebView gốc của từng hệ điều hành
- **Giao diện:** React 18 + TypeScript + Vite
- **Thiết kế:** chuẩn Apple (macOS/iOS), token ở `src/theme/tokens.css`
- **Ngôn ngữ giao diện:** zh-TW (mặc định) và Tiếng Việt, chọn ở mục Cài đặt; chuỗi nằm ở `src/i18n/`
- **Kiểm thử:** Vitest + Testing Library; **lint/format:** ESLint + Prettier

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
npm run dev            # chỉ giao diện, mở trong trình duyệt (cổng 1420)
```

Thử nhanh không cần tài khoản: **Thiết lập Live** → **Dán thủ công** → **Kết nối** → **Bắt đầu**, rồi dán chat vào
ô ở **Bảng điều khiển** (mỗi dòng một bình luận, dạng `tên: nội dung`). Hoặc chọn **Demo** để xem dữ liệu giả.
Dữ liệu và khóa API chỉ lưu được khi chạy bằng `npm run tauri:dev`; chạy `npm run dev` trên trình duyệt thì dữ liệu nằm trong bộ nhớ.

## Kiểm tra trước khi commit

```bash
npm run check          # typecheck + lint + kiểm tra định dạng + test
npm run format         # tự định dạng
npm run build          # build giao diện
cargo test --manifest-path src-tauri/Cargo.toml   # test Rust (SQLite, kho khóa)
```

## Đóng gói

```bash
npm run tauri:build    # macOS: .dmg/.app · Windows: .msi/.exe
```

Bản build chính thức do GitHub Actions tạo (`.github/workflows/build.yml`).

## Cấu trúc

```
src/
  live/         lõi Live: types, LiveCommentProvider, Demo / Manual / Euler provider,
                kiểm tra URL/username, ManualPasteProvider + paste.ts, LiveRepository (SQLite/bộ nhớ),
                LiveSessionStore (chống trùng, giới hạn 1000 bình luận, lưu và khôi phục)
  orders/       danh mục, parser bình luận → trường đơn (parser.ts), engine ghép đơn nháp theo khách (engine.ts),
                nhập CSV (catalogCsv.ts), OrderRepository (SQLite/bộ nhớ)
  secrets/      client khóa API (chỉ ghi / kiểm tra có chưa / xóa, không đọc lại)
  pages/        Live Setup, Live Console, Đơn hàng (đơn nháp + danh mục), Cài đặt, trang giữ chỗ cho phase sau
  components/   vỏ ứng dụng, icon, StatusChip, trạng thái trống/tải/lỗi
  i18n/         zh-TW.ts (khóa gốc), vi.ts, bộ chọn ngôn ngữ
  theme/        tokens.css (token Apple), base.css (khung), live.css (màn Live)
src-tauri/      backend Rust: db.rs (SQLite + migration), live.rs, orders.rs (danh mục + đơn nháp), secrets.rs (keyring), euler.rs (WebSocket Euler Stream), commands.rs
docs/           yêu cầu, kế hoạch, hướng dẫn cài đặt đồng bộ Windows/Mac
```

## Quy ước

- Mọi màu và cỡ chữ lấy từ token; chỉ dùng `#fff` cho chữ trên nền xanh hệ thống.
- Mọi danh sách và trang phải có trạng thái trống, đang tải, lỗi (`components/States.tsx`).
- Thêm ngôn ngữ: thêm file cùng cấu trúc `Messages`; thiếu khóa là lỗi kiểu dữ liệu.
- Code riêng từng hệ điều hành đặt sau `#[cfg(target_os = "...")]` để Mac và Windows cùng build.
- Mỗi màn hình kiểm tra ở hai kích thước (desktop 1440×900, điện thoại 390×844) và cả sáng/tối.
- Không đưa secret vào frontend, repo hoặc log; không tự gửi bình luận lên TikTok.

Hướng dẫn cài công cụ, đồng bộ giữa Windows và Mac, và dùng Graphify: [`docs/SETUP.md`](docs/SETUP.md).
