# LIVE STUDIO

Ứng dụng desktop **Local Shop Assistant — TikTok LIVE Assistant**: hỗ trợ người bán xử lý bình luận
livestream, đề xuất trả lời và tạo đơn nháp. Chạy trên **macOS** và **Windows** từ cùng một mã nguồn.

Yêu cầu sản phẩm: [`docs/TIKTOK_LIVE_ASSISTANT.md`](docs/TIKTOK_LIVE_ASSISTANT.md).
Kế hoạch và quyết định kiến trúc: [`docs/IMPLEMENTATION_PLAN_TIKTOK_LIVE.md`](docs/IMPLEMENTATION_PLAN_TIKTOK_LIVE.md).

## Trạng thái

| Phase | Nội dung                                                               | Trạng thái                           |
| ----- | ---------------------------------------------------------------------- | ------------------------------------ |
| 0     | Khảo sát repo, kế hoạch                                                | Xong                                 |
| 1     | Giao diện Live Setup/Console + Demo provider                           | **Xong**                             |
| 2a    | SQLite, dán chat thủ công, khôi phục, khóa API                         | **Xong**                             |
| 2b    | Catalog SKU + đọc đơn bằng luật                                        | **Xong**                             |
| 3a    | Lớp AI nhiều hãng (OpenAI/Claude/Gemini/DeepSeek), khóa của người dùng | **Xong**                             |
| 3b    | AI phân loại ý định                                                    | **Xong**                             |
| 4a/4b | Gợi ý trả lời (người bán duyệt) + overlay Browser Source               | **Xong**                             |
| 5     | Provider live thật                                                     | Chờ xác minh nguồn bình luận hợp lệ  |
| 6     | Hardening: báo cáo, xuất, thời hạn lưu, sao lưu, xóa, nhật ký          | **Xong** (phần không cần nguồn live) |

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

**In phiếu:** Cài đặt → Máy in mạng (IP, cổng, khổ giấy), nút "In thử", "In phiếu tạm" cho từng đơn nháp và tùy chọn tự in khi có đơn nháp mới (mặc định tắt). Chưa thử trên máy in thật.

**Tổng quan:** trang đầu của mục Quản lý cho xem số liệu phiên hiện tại, việc cần xử lý và so sánh các phiên.

**Báo cáo và dữ liệu (Phase 6):** trang "Báo cáo phiên" cho xem số liệu từng phiên, xuất JSON/CSV vào thư mục Tải xuống, đặt thời hạn lưu (mặc định 90 ngày), sao lưu cơ sở dữ liệu, xóa một phiên hoặc toàn bộ, và xem nhật ký thao tác (chỉ mã và số lượng, không có bình luận hay khóa).

Dữ liệu được lưu trong SQLite trên máy (`live-studio.db` ở thư mục dữ liệu của app) và tự nạp lại khi mở app.
Khóa API (ChatGPT/OpenAI, Claude, Gemini, DeepSeek, Euler Stream) do người dùng tự nhập ở **Cài đặt**, lưu trong Keychain / Credential
Manager; app không bao giờ đọc ngược hay hiển thị khóa, và kết nối Euler Stream chạy ở Rust nên khóa không rời Rust.

## Công nghệ

- **Vỏ ứng dụng:** Tauri 2 (Rust), dùng WebView gốc của từng hệ điều hành
- **Giao diện:** React 18 + TypeScript + Vite
- **Thiết kế:** chuẩn Apple (macOS/iOS), token ở `src/theme/tokens.css`
- **Ngôn ngữ giao diện:** Tiếng Việt (mặc định) và zh-TW, chọn ở mục Cài đặt; chuỗi nằm ở `src/i18n/`
- **Kiểm thử:** Vitest + Testing Library; **lint/format:** ESLint + Prettier

## Yêu cầu

- Node.js 20 trở lên
- Rust (stable) — cài qua [rustup](https://rustup.rs)
- macOS: Xcode Command Line Tools (`xcode-select --install`)
- Windows: Microsoft C++ Build Tools và WebView2 (Windows 10/11 đã có sẵn)
- Linux (chỉ để thử): `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `librsvg2-dev`

## Chạy thử

Cách nhanh nhất: sau `git clone` / `git pull`, nhấp đúp `Chay-LIVE-STUDIO.bat` (Windows) hoặc `Chay-LIVE-STUDIO.command` (Mac), xem `docs/SETUP.md` mục 2b. Hoặc chạy tay:

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
  ai/           cấu hình hãng AI + client gọi AI qua Rust (AiClient)
  secrets/      client khóa API (chỉ ghi / kiểm tra có chưa / xóa, không đọc lại)
  report/       client báo cáo/xuất/xóa/sao lưu + thời hạn lưu (retention.ts)
  pages/        Live Setup, Live Console, Đơn hàng (đơn nháp + danh mục), Gợi ý trả lời, Overlay, Báo cáo phiên, Cài đặt
  components/   vỏ ứng dụng, icon, StatusChip, trạng thái trống/tải/lỗi
  i18n/         zh-TW.ts (khóa gốc), vi.ts, bộ chọn ngôn ngữ
  theme/        tokens.css (token Apple), base.css (khung), live.css (màn Live)
src-tauri/      backend Rust: db.rs (SQLite + migration), live.rs, orders.rs (danh mục + đơn nháp), replies.rs, data.rs (nhật ký, xuất, thời hạn lưu, sao lưu), overlay.rs (máy chủ overlay 127.0.0.1), ai.rs (gọi AI nhiều hãng), secrets.rs (keyring), euler.rs (WebSocket Euler Stream), commands.rs
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

## Đơn ship 7-ELEVEN

Mục **Đơn ship**: danh sách khách (tự thêm TikTok ID khi chốt đơn), form tạo đơn, tra mã cửa hàng 7-ELEVEN, in phiếu ship, xuất Excel theo mẫu 賣貨便 v1.5. Chi tiết: `docs/IMPLEMENTATION_PLAN_TIKTOK_LIVE.md` §16.

## Chia sẻ cho điện thoại

Cài đặt → **Chia sẻ cho điện thoại** → Bật chia sẻ → quét QR bằng điện thoại cùng Wi-Fi. Điện thoại thao tác thật trên dữ liệu của máy tính (đơn, tin nhắn, đơn ship) và in qua máy in cài trên máy tính; chặn zoom và cuộn trang. Chỉ bật trên Wi-Fi riêng; link có mã bí mật đổi mỗi lần bật. Chi tiết: `docs/IMPLEMENTATION_PLAN_TIKTOK_LIVE.md` §18.

## Hãng vận chuyển và thu chi

Mục **Hãng vận chuyển** có logo 7 hãng đóng gói sẵn. ECPay là hãng duy nhất app gọi API trực tiếp (kiểm tra khóa, tạo vận đơn 7-ELEVEN/FamilyMart ở môi trường thử hoặc thật); các hãng khác mở trang đăng nhập/tra đơn chính thức. Mục **Kho & chi phí** có 13 nhóm chi phí và khoản tính theo % doanh thu; thu nhập thực tế trừ hết các khoản này.

## Kho mã vạch

Tab **Kho mã vạch**: nhập hàng → in tem (chỉ giá bán; có tuỳ chọn số tem, căn lề, cỡ chữ), quét xuất để in biên nhận và trừ kho, kiểm kê, **Phân tích** kho (ABC-XYZ, điểm đặt hàng, tuổi hàng). Mã quét xuất được tính vào lợi nhuận ở Tổng quan. Điện thoại ở cùng Wi-Fi có thể quét và gửi mã lên PC theo thời gian thực (tab "Quét gửi PC"). Chi tiết: `docs/IMPLEMENTATION_PLAN_TIKTOK_LIVE.md` §25.
