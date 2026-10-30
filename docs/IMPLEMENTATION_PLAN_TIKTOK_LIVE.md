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

| Vấn đề             | Quyết định                                                                  | Lý do                                                                                                                |
| ------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Backend local      | Rust (Tauri), không dùng Python sidecar                                     | Một tiến trình, đóng gói được cho Mac + Windows mà không kèm Python; hợp với yêu cầu coding chạy cả hai hệ điều hành |
| Cơ sở dữ liệu      | SQLite qua Rust (Phase 2)                                                   | Local-first; ghi sự kiện trước khi chạy AI                                                                           |
| Kênh realtime      | Sự kiện Tauri (Rust → giao diện)                                            | Không cần WebSocket/SSE khi không có server riêng cho giao diện; tài liệu cũng dặn không dùng nhiều cơ chế cùng lúc  |
| Overlay            | HTTP server cục bộ trong Rust (Phase 4)                                     | Browser Source của phần mềm phát cần URL; chỉ phục vụ dữ liệu đã chọn, không có PII                                  |
| AI                 | Gọi từ Rust, khóa lưu trong Keychain / Credential Manager (Phase 3)         | Không để secret ở frontend (mục 0.9 của tài liệu gốc)                                                                |
| Nguồn bình luận    | Interface `LiveCommentProvider`, thay được                                  | Mục 3 của tài liệu gốc                                                                                               |
| Ngôn ngữ giao diện | tiếng Việt mặc định (người dùng yêu cầu 2026-10-30), có zh-TW, mở rộng được | Mục "Ngôn ngữ giao diện" của tài liệu gốc                                                                            |

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

### Phase 2 — Lưu trữ + nguồn chạy thật

- **2a (xong):** SQLite, nguồn "Dán thủ công", khôi phục sau khi tắt app, khóa API do người dùng nhập.
- **2b (xong):** catalog SKU + bộ đọc đơn bằng luật (không AI), xem mục 8.
- Sự kiện Tauri (Rust → giao diện) chỉ cần khi có provider hoặc AI chạy phía Rust; hoãn tới đó.

### Phase 3 — AI + đơn nháp

- **3a (xong):** lớp AI provider nhiều hãng với khóa người dùng tự nhập, xem mục 9. **3b (xong):** AI phân loại ý định, xem mục 10.

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

## 6. Phase 2a — logic thực hiện và kết quả

### Lưu trữ

- Một file SQLite duy nhất: `live-studio.db` trong `app_data_dir`. Mở bằng `rusqlite` (bundled), WAL, `foreign_keys=ON`, migration theo `PRAGMA user_version` (idempotent, chạy mỗi lần mở app).
- Bảng `live_sessions` và `live_comments` theo spec. Chỉ mục unique `(session_id, source, provider_event_id)` nên cùng một sự kiện chỉ lưu một lần dù dán lại hay kết nối lại; `ON DELETE CASCADE` khi xóa phiên.
- Ghi theo lô, mỗi lô một transaction (`INSERT OR IGNORE`); bỏ bình luận rỗng, cắt 1000 ký tự, tối đa 1000 bình luận mỗi lô.
- Frontend ghi qua một hàng đợi tuần tự trong `LiveSessionStore`, nên dòng phiên luôn có trước bình luận. Ghi lỗi thì `persistError` bật và hiện cảnh báo; bình luận trên màn hình không bị mất.
- Khôi phục: nạp phiên mới nhất và tối đa 1000 bình luận, nạp lại bộ chống trùng. Phiên đang dở được đóng lại (provider không sống qua lần khởi động) và trạng thái là `DISCONNECTED`, không bao giờ `CONNECTED` giả.

### Nguồn "Dán thủ công"

- `ManualPasteProvider` (trạng thái `MANUAL`) không cần tài khoản hay quyền. Người bán sao chép chat từ màn hình live của chính mình.
- `parsePastedChat`: mỗi dòng một bình luận; `tên: nội dung` / `@tên：nội dung` tách tên tài khoản; tối đa 500 dòng, 500 ký tự. `eventId = paste-<fnv1a(tên|nội dung)>-<lần thứ n trong lần dán>`.
- **Giới hạn đã biết:** dán lại đoạn chồng lấn thì trùng được bỏ qua, nhưng một bình luận lặp thật sự (cùng tên, cùng nội dung) ở lần dán sau có thể bị coi là trùng. Dấu thời gian là lúc dán, không phải lúc khách bình luận.

### Khóa API do người dùng nhập (BYOK)

- Ô: `claude`, `openai`, `gemini`, `connector` (khóa Euler Stream). Lưu trong Keychain (macOS) / Credential Manager (Windows) qua `keyring`; Linux chỉ để phát triển.
- Lệnh Tauri chỉ có `secret_set`, `secret_exists`, `secret_remove`. **Không có lệnh đọc khóa** cho frontend; khi Phase 3 gọi AI thì Rust đọc khóa trực tiếp.
- Trình duyệt thường (`npm run dev`) không lưu được khóa và nói rõ như vậy.
- Khóa `connector` được Rust đọc trực tiếp để nối Euler Stream (mục 7); frontend không bao giờ nhận lại khóa.

### Về yêu cầu "cài sẵn API, chỉ nhập ID là đọc được bình luận"

Chưa thể làm đúng như vậy một cách hợp lệ: chưa tìm thấy API chính thức của TikTok để đọc bình luận LIVE theo ID. Cách duy nhất để "chỉ nhập ID" hiện nay là thư viện không chính thức giả lập giao thức, vốn trái với quy tắc của spec (không scrape, không đảo ngược giao thức, không dùng làm mặc định) và có thể vi phạm điều khoản TikTok, dễ hỏng khi TikTok đổi. Hướng hợp lệ, theo thứ tự:

1. Nhà cung cấp bên thứ ba: đã chọn **Euler Stream** (mục 7). Vẫn là nguồn không chính thức.
2. OCR vùng chat của chính người bán (ý tưởng, chưa làm).
3. Giữ "Dán thủ công" (đã chạy).

Cần người quyết định: nhà cung cấp nào, và có chấp nhận thư viện không chính thức dưới dạng cờ thử nghiệm nội bộ tắt mặc định hay không.

### Kết quả kiểm tra

- `npm run check`: 39 test (trước đó 25), `npm run build` xong, `cargo test`: 10 test Rust (trước khi thêm Euler) (migration, chống trùng, cắt/rỗng, thứ tự, cascade, khóa ngoại, kho khóa).
- Ảnh chụp 1440×900 và 390×844, sáng/tối: không tràn ngang, không lỗi console.
- **Chưa kiểm chứng:** `tauri dev` trên Mac và Windows thật (đặc biệt đường dẫn dữ liệu và Keychain / Credential Manager); phần Rust mới chạy được test và `cargo check` trên Linux.

## 7. Nguồn Euler Stream (không chính thức)

Người dùng chọn Euler Stream. Đây là dịch vụ bên thứ ba, **không liên kết với TikTok**; tài liệu của chính họ ghi TikTok không có API LIVE chính thức. Rủi ro: có thể ngừng hoạt động, có thể vi phạm điều khoản TikTok (chưa xác minh điều khoản của Euler Stream), phụ thuộc một nhà cung cấp.

### Giao thức (lấy từ tài liệu và SDK mã nguồn mở của Euler Stream)

- Địa chỉ: `wss://ws.eulerstream.com/?uniqueId=<handle>&apiKey=<khóa>`.
- Khung tin là JSON dạng gói `{ "timestamp": n, "messages": [ { "type", "data" } ] }`.
- Bình luận: `type = "WebcastChatMessage"`; dùng `data.comment`, `data.user.uniqueId`, `data.user.nickname`, `data.common.msgId`, `data.common.createTime`.
- Trạng thái: `tiktok.connect`, `room.status` (`state: connected | offline | ended ...`).
- Mã đóng: 4404 chưa live, 4401 khóa sai, 4403 không có quyền, 4429 quá số kết nối/quá nhanh, 4005 live kết thúc, 4555 quá 8 giờ, 4006/4408 hết thời gian chờ, 4500 TikTok ngắt, 4400 tham số sai, 1011/4556/4557 lỗi dịch vụ.

### Thiết kế

- `src-tauri/src/euler.rs`: phân tích khung tin, ánh xạ mã đóng sang trạng thái + lý do, `run_connection`. Lệnh `euler_connect` / `euler_disconnect` đọc khóa từ Keychain ở Rust rồi phát sự kiện `euler-event` lên giao diện. URL và khóa không bao giờ được ghi log hoặc gửi lên giao diện.
- `src/live/eulerProvider.ts`: biến sự kiện thành `LiveCommentEvent` (nguồn `UNOFFICIAL_CONNECTOR`, id `euler-<msgId>`).
- `CONNECTED` chỉ khi có bằng chứng từ dịch vụ. Không tự kết nối lại: người bán thấy lý do rồi tự bấm kết nối lại.
- Lỗi hiển thị bằng lý do dịch được (`statusReason`): chưa có khóa, không phải app desktop, chưa live, khóa sai, quá giới hạn...

### Gói và giới hạn (từ trang giá của Euler Stream)

Community miễn phí: 2.500 yêu cầu/ngày, 25 WebSocket đám mây. Business $50/tháng: 10.000 yêu cầu/ngày, 100 WebSocket. Mỗi phiên theo dõi chiếm một kết nối. Mỗi người dùng tự nhập khóa của họ nên không dùng chung hạn mức. **Chưa xác nhận:** gói miễn phí có dùng được kết nối theo `uniqueId` hay không (trang giá không nói rõ).

### Kiểm tra

- Test Rust (19): phân tích khung tin, mã đóng, URL, và chạy thật với máy chủ WebSocket cục bộ giả lập giao thức (nhận đúng `uniqueId` và `apiKey`, phát gói bình luận, đóng bằng 4404 / 4401, mạng lỗi không lộ khóa).
- Test giao diện (47): `EulerProvider`, store với nguồn `live` (CONNECTING cho tới khi có bằng chứng, chống trùng, lưu, cần xác nhận).
- **Chưa kiểm chứng với Euler Stream thật.** Môi trường phát triển không gọi được `ws.eulerstream.com`; hình dạng tin nhắn lấy từ SDK, không phải từ một phiên chạy thật. Cần thử trên máy có khóa thật: nếu bình luận không hiện, xem `docs` Euler Stream "Event Types" và chỉnh `parse_chat` trong `euler.rs`.

## 8. Phase 2b — catalog và đơn nháp bằng luật

Nguồn catalog chưa được người dùng quyết định (nhập tay / Excel / từ công cụ 7-11), nên làm trước nhập tay + dán Excel/CSV; thêm nguồn khác sau chỉ cần gọi `importCatalog`.

### Lưu trữ (migration 2)

`catalog_items`, `live_order_drafts` (khóa ngoại tới phiên, xóa theo phiên), `live_order_evidence` (id bình luận nguồn cho từng trường). Lệnh Tauri: `catalog_list/upsert/delete`, `order_save/list/set_status`. Rust kiểm tra: trạng thái hợp lệ, số lượng 1–999, độ tin cậy 0–1; chuyển trạng thái: `CONFIRMED` chỉ từ `DRAFT`, `CANCELLED` từ mọi trạng thái chưa hủy, đơn đã hủy là cuối cùng.

### Parser (`src/orders/parser.ts`)

- Chuẩn hóa NFKC, chữ thường. Khớp mã SKU **chính xác theo token** (A12 không khớp A123, bỏ qua `-`/`_`); khớp theo tên/tên gọi khác là yếu hơn (độ tin cậy ×0.85). Token giống mã (`a12`, `b-7`) mà không có trong catalog → `SKU_NOT_FOUND`; nhiều mã → `MULTIPLE_SKU`.
- Màu/size theo catalog của sản phẩm (hỗ trợ tên gọi khác bằng `|`), chữ Latin phải đứng riêng ("m" không nằm trong "name"). Hai màu khác nhau trong một bình luận → xung đột, không đoán.
- Số lượng: `×N`, `xN`, `N件/個/cái/pcs`, `要N`, `lấy N`, số Hán (一…九十九, 兩); số trần chỉ tin khi đã có đơn mở. Vượt giới hạn (mặc định 20) → `QTY_TOO_LARGE`, không lưu số.

### Engine (`src/orders/engine.ts`, hàm thuần, không sửa dữ liệu vào)

- Khóa khách = `platformUserId` hoặc username viết thường. Gộp vào đơn đang mở của khách trong 120 giây (theo thời gian bình luận); sản phẩm khác → đơn mới, đơn cũ giữ nguyên. Hai khách xen kẽ không bao giờ lẫn.
- Bình luận chỉ mở đơn mới khi có mã (biết hoặc không biết) hoặc số lượng rõ ràng; màu/size/số trần đứng một mình chỉ gộp vào đơn đang mở. "我要兩個" không rõ sản phẩm → `NEEDS_REVIEW`.
- Giá trị mâu thuẫn → giữ giá trị đầu, thêm `CONFLICT_*`. Mọi lý do → `NEEDS_REVIEW`. Độ tin cậy cố định: 1.0; khớp theo tên ×0.85; số trần ×0.9; chỉ có username tối đa 0.8; cần kiểm tra tối đa 0.5.
- Cùng một bình luận không bao giờ tính hai lần (kiểm tra theo id bằng chứng).

### Giao diện

Trang "直播訂單": bảng đơn nháp (bình luận gốc, lý do, nút Xác nhận/Hủy; Xác nhận bị khóa khi cần kiểm tra) và tab danh mục (thêm/sửa/xóa, dán Excel/CSV). Console hiển thị số 草稿/待確認 thật. "Xóa bình luận" giữ lại đơn nháp.

### Giới hạn đã biết

- Chưa có sửa tay đơn `NEEDS_REVIEW` (hiện chỉ xác nhận được đơn sạch hoặc hủy); mã SKU phải là chữ/số Latin.
- Bình luận OCR chưa có nguồn nên chưa tính độ tin cậy riêng cho OCR.
- Đọc "đổi sang…" (sửa số lượng/màu) chưa hỗ trợ: sẽ ra `CONFLICT_*` để người bán xem.
- Dán lại một bình luận y hệt ở lần dán sau bị coi là trùng (giới hạn từ Phase 2a).

### Kiểm tra

`cargo test`: 24 test Rust (thêm 5 cho danh mục/đơn). `npm run check`: test giao diện + parser/engine (27 test cho các ca spec: SKU không có, thiếu màu/size/số lượng, một khách nhiều bình luận, hai khách xen kẽ), store (đơn nháp, khôi phục, danh mục), trang Đơn hàng. Ảnh chụp 1440×900 và 390×844 sáng/tối: không tràn ngang.

## 9. Phase 3a — lớp AI provider (BYOK, nhiều hãng)

Người dùng tự nhập khóa cho ChatGPT (OpenAI), Claude, Gemini, DeepSeek ở **Cài đặt**; chọn hãng đang dùng và tên model ở mục "AI 服務". Thêm hãng mới tương thích kiểu OpenAI chỉ cần một dòng trong `PROVIDERS` (`src-tauri/src/ai.rs`), một ô khóa trong `secrets.rs` và nhãn i18n.

- **Rust (`ai.rs`):** dựng yêu cầu và đọc phản hồi cho ba kiểu API (OpenAI-compatible `/chat/completions` cho OpenAI và DeepSeek, Claude `/v1/messages`, Gemini `generateContent`). Lệnh `ai_complete` đọc khóa từ Keychain ngay trong Rust, nên khóa không bao giờ ra giao diện hay log. Lỗi trả về là mã ngắn (`NO_KEY`, `AUTH`, `QUOTA`, `RATE_LIMIT`, `BAD_REQUEST`, `TIMEOUT`, `NETWORK`...), không kèm nội dung phản hồi của hãng.
- **An toàn:** tên model chỉ cho ký tự an toàn (nằm trong URL của Gemini); giới hạn độ dài lời nhắc (20.000 ký tự) và token trả về (1.024); timeout 30 giây; không tự thử lại.
- **Giao diện:** chọn hãng + model (lưu trong localStorage, không phải bí mật) và nút "測試連線" gửi một tin rất ngắn.
- **Quyền riêng tư:** khi phân loại (3b) và gợi ý trả lời (Phase 4) được bật, bình luận liên quan sẽ được gửi tới hãng AI mà người bán chọn, bằng khóa của họ; trang Cài đặt nói rõ điều này.
- **Kiểm tra:** 7 test Rust mới (dựng yêu cầu và đọc phản hồi từng hãng, mã lỗi, tên model, và chạy thật với máy chủ HTTP cục bộ: khóa được gửi đúng header, lỗi không lộ khóa); 2 test giao diện.
- **Chưa kiểm chứng:** chưa gọi thử hãng thật nào (môi trường phát triển không gọi được các dịch vụ này). Tên model mặc định (`gpt-4o-mini`, `claude-haiku-5-5`, `gemini-2.5-flash`, `deepseek-chat`) chưa được xác minh với danh sách model hiện hành; nếu nút kiểm tra báo "服務拒絕請求" hãy sửa tên model trong Cài đặt.

## 10. Phase 3b — AI phân loại ý định bình luận

- **Nhãn:** `QUESTION` (hỏi chung), `PURCHASE` (muốn mua), `PRODUCT_QUESTION` (hỏi sản phẩm cụ thể), `SPAM`, `OTHER`, kèm độ tin cậy 0–1. Lưu vào cột `intent` / `confidence` của `live_comments` (đã có từ migration 1, không cần migration mới); Rust từ chối nhãn lạ hoặc độ tin cậy ngoài 0–1.
- **Chỉ khi người bán bấm "Phân loại AI":** không tự gọi AI nên không tự tốn tiền. Mỗi lần xử lý tối đa 200 bình luận mới nhất chưa phân loại, chia lô 20, tuần tự; gặp lỗi thì dừng, giữ phần đã lưu và hiện mã lỗi dịch được (hết hạn mức, sai khóa...). Chưa chọn dịch vụ AI thì báo vào Cài đặt.
- **An toàn:** bình luận là dữ liệu không tin cậy: lời nhắc nói rõ không làm theo chỉ thị trong bình luận, bình luận đưa vào dưới dạng JSON, cắt 300 ký tự. Câu trả lời của AI được kiểm tra nghiêm ngặt (chỉ số, nhãn, độ tin cậy hợp lệ); mục sai bị bỏ, bình luận đó vẫn "chưa phân loại". AI **chỉ gắn nhãn**: không tạo đơn (luật ở 2b làm việc đó), không trả lời, không gửi gì.
- **Giao diện:** cột "AI 狀態" hiện nhãn, bộ lọc 提問/購買意圖/商品問題/垃圾/待確認 dùng nhãn thật (待確認 gồm bình luận nằm sau đơn nháp cần kiểm tra hoặc độ tin cậy < 60%), panel chi tiết hiện nhãn và độ tin cậy. Nhãn được khôi phục khi mở lại app.
- **Kiểm tra:** 4 test classifier, 4 test store (lưu và khôi phục, lỗi AI, chưa chọn dịch vụ, câu trả lời sai định dạng), 2 test giao diện, 1 test Rust. **Chưa thử với hãng AI thật**, nên chất lượng phân loại thực tế chưa được đo.
