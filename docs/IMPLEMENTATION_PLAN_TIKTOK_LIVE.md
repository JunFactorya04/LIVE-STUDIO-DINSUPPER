# Kế hoạch triển khai TikTok LIVE Assistant (Phase 0)

Nguồn yêu cầu: [`TIKTOK_LIVE_ASSISTANT.md`](./TIKTOK_LIVE_ASSISTANT.md) (v1.0, 2026-10-30).
Ngày khảo sát: 2026-10-30. Khảo sát bằng Graphify (`graphify update .`, `graphify query`).

## 1. Hiện trạng repo

| Hạng mục      | Hiện có                                                   | Ghi chú                                          |
| ------------- | --------------------------------------------------------- | ------------------------------------------------ |
| Vỏ ứng dụng   | Tauri 2 (Rust)                                            | `src-tauri/src/lib.rs` chỉ có lệnh `app_info`    |
| Giao diện     | React 18 + TypeScript + Vite                              | 13 file nguồn, 171 nút trong đồ thị              |
| Thiết kế      | Token Apple (`src/theme/tokens.css`), layout (`base.css`) | Sáng/tối, sidebar + toolbar + tab bar điện thoại |
| Ngôn ngữ      | `src/i18n/vi.ts` (chỉ tiếng Việt)                         | Chưa có cơ chế đổi ngôn ngữ                      |
| Điều hướng    | `src/navigation.ts`                                       | 6 mục chung chung, chưa gắn nghiệp vụ            |
| Backend local | Không có                                                  | Không có FastAPI, không có server                |
| Cơ sở dữ liệu | Không có                                                  | Không có SQLite, migration                       |
| AI            | Không có                                                  | Không có lớp provider, BYOK, credits             |
| Catalog SKU   | Không có                                                  | Cần cho Phase 3                                  |
| Test / lint   | Không có                                                  | Thêm ở Phase 1                                   |
| CI            | `.github/workflows/build.yml`                             | Build macOS (arm64, x64) và Windows              |

Kết luận: không có module nào để tái sử dụng cho Live Assistant, và cũng không có hệ thống thứ hai nào có nguy cơ bị tạo trùng. Toàn bộ tính năng Live là phần mới, đặt cạnh khung hiện có.

## 2. Quyết định kiến trúc

Tài liệu gốc ghi "FastAPI nếu backend local đã được thiết lập". Repo chưa có, nên cần chọn. Các quyết định dưới đây là đề xuất, có thể đổi trước Phase 2.

| Vấn đề             | Quyết định                                                          | Lý do                                                                                                                |
| ------------------ | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Backend local      | Rust (Tauri), không dùng Python sidecar                             | Một tiến trình, đóng gói được cho Mac + Windows mà không kèm Python; hợp với yêu cầu coding chạy cả hai hệ điều hành |
| Cơ sở dữ liệu      | SQLite qua Rust (Phase 2)                                           | Local-first; ghi sự kiện trước khi chạy AI                                                                           |
| Kênh realtime      | Sự kiện Tauri (Rust → giao diện)                                    | Không cần WebSocket/SSE khi không có server riêng cho giao diện; tài liệu cũng dặn không dùng nhiều cơ chế cùng lúc  |
| Overlay            | HTTP server cục bộ trong Rust (Phase 4)                             | Browser Source của phần mềm phát cần URL; chỉ phục vụ dữ liệu đã chọn, không có PII                                  |
| AI                 | Gọi từ Rust, khóa lưu trong Keychain / Credential Manager (Phase 3) | Không để secret ở frontend (mục 0.9 của tài liệu gốc)                                                                |
| Nguồn bình luận    | Interface `LiveCommentProvider`, thay được                          | Mục 3 của tài liệu gốc                                                                                               |
| Ngôn ngữ giao diện | zh-TW mặc định, có tiếng Việt, mở rộng được                         | Mục "Ngôn ngữ giao diện" của tài liệu gốc                                                                            |

Điểm lệch so với tài liệu gốc: chưa dùng FastAPI và chưa dùng WebSocket/SSE, vì repo không có backend sẵn. Nếu bạn muốn giữ Python (ví dụ để dùng lại mã từ tool bán hàng cũ), cần quyết định trước Phase 2.

## 3. Các phase

### Phase 1 — UI + Demo provider (xong)

Tạo mới:

- `src/live/` : kiểu dữ liệu, `LiveCommentProvider`, `DemoLiveCommentProvider`, `NoSourceProvider`, kiểm tra cấu hình URL/username, `LiveSessionStore` (chống trùng, giới hạn số bình luận).
- `src/i18n/` : cơ chế đổi ngôn ngữ, `zh-TW.ts`, `vi.ts`.
- `src/pages/` : Live Setup, Live Console, các trang còn lại ở dạng trống có ghi rõ phase.
- Thử nghiệm: `vitest`, `@testing-library/react`, `jsdom`.
- Lint/format: `eslint`, `prettier`.

Sửa:

- `src/navigation.ts`, `src/App.tsx`, `src/components/Shell.tsx`, `src/components/Icons.tsx` : menu 7 mục thay cho 6 mục chung chung.
- `src/theme/base.css` giữ nguyên; thêm `src/theme/live.css`.
- `package.json`, `vite.config.ts`, `README.md`.

Nghiệm thu: chạy app thấy feed Demo, mọi bình luận giả đều gắn nhãn DEMO; không có nguồn thật thì hiển thị "Chưa có nguồn bình luận được kết nối", không bao giờ hiện Connected.

### Phase 2 — Lưu trữ + event bus

SQLite (bảng `live_sessions`, `live_comments`), chỉ mục unique `(session_id, provider_event_id)`, sự kiện Tauri, kết nối lại và lỗi provider.

### Phase 3 — AI + đơn nháp

Lớp AI provider (BYOK / AI Credits), phân loại ý định, catalog SKU, `live_order_drafts` + bằng chứng, màn Needs Review. Không gọi API vận chuyển.

### Phase 4 — Gợi ý trả lời + overlay

`live_reply_suggestions` (`COPIED` ≠ `SENT`), overlay cục bộ không PII.

### Phase 5 — Provider thật

Chỉ bắt đầu khi đã xác minh nguồn sự kiện hợp lệ, xác thực, điều khoản TikTok. Chưa thể làm tới lúc đó.

### Phase 6 — Hardening

Mất mạng, rate limit, AI timeout, xóa dữ liệu, audit log, hiệu năng, đóng gói trên Mac và Windows thật.

## 4. Câu hỏi còn mở

1. Chấp nhận Rust thay cho FastAPI ở backend local không?
2. Đã có nguồn bình luận hợp lệ chưa (API chính thức, nhà cung cấp được duyệt)? Nếu chưa, sản phẩm chạy ở chế độ Demo cho tới Phase 5.
3. Catalog SKU lấy từ đâu (nhập tay, import Excel, từ tool bán hàng 7-11 hiện có)?
4. Tool 7-11 (Lên Đơn Nhanh / seller-order-tool) và LIVE STUDIO là một sản phẩm hay hai? Tài liệu gốc ghi "Local Shop Assistant" và nhắc Order Manager / Shipping Adapter; repo này hiện chưa có các phần đó.

## 5. Kết quả Phase 1

Đã chạy: `npm run check` (typecheck, ESLint, Prettier, 25 test) và `npm run build`; ảnh chụp ở 1440×900 và 390×844, sáng/tối, zh-TW và Tiếng Việt, không tràn ngang, không lỗi console.

Bộ test bắt buộc (mục 12 của tài liệu gốc):

- Đã có test: 1 (URL rỗng/sai), 2 (URL hợp lệ nhưng không có provider đọc chat), 5 (bình luận gửi lặp), 6 (tiếng Hoa phồn thể, tiếng Việt, emoji, ký tự đặc biệt), 17 (tải nhiều bình luận liên tục), 18 (chạy Demo không cần credentials).
- Một phần: 3 (mới kiểm tra `CONNECTING` → `DEMO`; chưa có provider thật nên chưa thể tới `CONNECTED`), 4 (store đặt `ERROR` khi `connect` ném lỗi nhưng chưa có test riêng).
- Chưa làm: 7–13, 15, 16 thuộc Phase 2–4; 14 chưa áp dụng vì chưa có nút Copy.

Giới hạn còn lại:

- Dữ liệu chỉ nằm trong bộ nhớ; tắt app là mất (Phase 2).
- Nút "Mở TikTok LIVE Studio" mới hiện hướng dẫn mở thủ công, chưa mở được ứng dụng (Phase 6).
- Bộ lọc theo loại bình luận cần AI nên hiện chỉ ghi "cần Phase 3".
- `LoadingState`/`ErrorState` đã có nhưng chưa dùng ở trang nào vì chưa có dữ liệu bất đồng bộ.
- Chưa chạy `tauri dev` trên Mac và Windows thật; mới kiểm tra giao diện bằng trình duyệt và `cargo check` trên Linux.
