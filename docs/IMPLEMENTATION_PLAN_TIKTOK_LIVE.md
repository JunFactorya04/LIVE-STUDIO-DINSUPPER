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

## 11. Phase 4a — gợi ý trả lời (người bán duyệt, không tự gửi)

- **Không có đường gửi:** app không có provider gửi tin nên **không có nút Send** và trạng thái `SENT` không thể đặt từ app (Rust từ chối). `Copy` chỉ ghi `COPIED` (`approved_by_user = 1`); sửa lại văn bản đưa về `DRAFT`. Có ghi chú rõ "đã sao chép không có nghĩa là đã gửi" trong giao diện.
- **Lưu trữ (migration 3):** `live_reply_suggestions` (xóa theo phiên). Rust: `reply_create` (luôn bắt đầu `DRAFT`, chưa duyệt, dù người gọi truyền gì), `reply_list`, `reply_update` (chỉ `DRAFT/COPIED/REJECTED`, cắt 500 ký tự).
- **AI soạn nháp:** lời nhắc dùng danh mục sản phẩm + "quy định shop" do người bán nhập (lưu localStorage) và bình luận khách ở dạng chuỗi JSON (dữ liệu không tin cậy). Dặn: chỉ dùng thông tin đã cho, không biết thì nói người bán sẽ xác nhận, tối đa 2 câu, không xin số điện thoại/địa chỉ/thanh toán ở chat công khai, không link. Bộ lọc sau cùng loại bỏ câu trả lời có link hoặc dãy số dài (số điện thoại/tài khoản) và cắt 300 ký tự.
- **Giao diện:** thẻ trả lời ở panel chi tiết của Console và trang "回覆建議" (danh sách + ô quy định shop): Gợi ý, Sửa, Sao chép, Không dùng, Gợi ý lại.
- **Kiểm tra:** 5 test Rust mới, test prompt/bộ lọc/repository, test store (sửa-sao chép-khôi phục, câu trả lời không an toàn bị loại), test giao diện (sao chép không thành "đã gửi", không có nút gửi).

## 12. Phase 4b — overlay cục bộ (không có thông tin cá nhân)

- **Máy chủ (`overlay.rs`):** HTTP nhỏ chỉ lắng nghe `127.0.0.1` (cổng 17891, thử 10 cổng kế tiếp nếu bận). Chỉ có hai đường: `/overlay/live-product` (trang HTML trong suốt cho Browser Source, chỉ dùng `textContent`) và `/overlay/data.json`. Kiểm tra `Host` (chặn DNS rebinding), chỉ `GET/HEAD`, header `no-store`, `nosniff`, CSP chặt, giới hạn kích thước yêu cầu, timeout đọc 5 giây.
- **Không thể lộ PII theo cấu trúc:** trạng thái overlay chỉ có `visible, name, sku, priceText, colors, sizes, promo`; không có trường nào chứa bình luận hay tài khoản. Lệnh `overlay_set` làm sạch (bỏ ký tự điều khiển, cắt độ dài, tối đa 12 màu/size). Khi ẩn, `data.json` chỉ trả `{"visible":false}`.
- **Người bán kiểm soát:** chọn sản phẩm từ danh mục, sửa chữ giá và chữ khuyến mại, xem trước, rồi bấm "Hiện trên overlay" / "Cập nhật" / "Ẩn". Mỗi lần mở app overlay bắt đầu ở trạng thái ẩn. App không tự điều khiển phần mềm livestream; người bán tự dán địa chỉ vào Browser Source.
- **Kiểm tra:** 5 test Rust (làm sạch, định tuyến + Host, `data.json` chỉ có đúng 7 khóa, trang không dùng `innerHTML`, máy chủ thật qua socket loopback) và 2 test giao diện (payload đúng 7 khóa, ẩn lại, trình duyệt thường chỉ xem trước).
- **Chưa kiểm chứng:** chưa thử trong OBS hay TikTok LIVE Studio thật; chưa biết TikTok LIVE Studio có hỗ trợ Browser Source hay không (người bán cần tự xác nhận).

## 13. Phase 6 — hardening (phần làm được khi chưa có nguồn bình luận hợp lệ)

- **Nhật ký thao tác (`data.rs`, bảng `audit_log`, migration 4):** chỉ ghi _việc đã làm_ bằng mã cố định (`ORDER_CONFIRMED`, `REPLY_COPIED`, `AI_CALL_ERROR`, `SECRET_SET`, `EXPORT`, `DELETE_ALL`…), tối đa 1000 dòng (xóa dòng cũ nhất). `detail` bị lọc về ký tự ASCII chữ/số và `_:.,=-`, dài tối đa 120, nên không thể mang câu bình luận, tên khách (chữ Hán/Việt có dấu bị loại), số điện thoại dài kèm lời hay nội dung AI. Khóa API: chỉ ghi tên ô (`slot=openai`), không bao giờ ghi giá trị. AI: chỉ ghi hãng và mã lỗi, không ghi prompt hay câu trả lời. Mọi ghi nhật ký là "cố gắng hết sức": lỗi nhật ký không chặn thao tác.
- **Báo cáo phiên (trang `report`):** mỗi phiên có số bình luận, đơn theo trạng thái (đã xác nhận / cần kiểm tra / nháp / đã hủy), gợi ý trả lời đã sao chép. Số liệu lấy từ SQLite bằng một truy vấn, không tính ở giao diện. Trên trình duyệt thường (không có dữ liệu lưu) trang nói rõ cần app desktop, không bịa số.
- **Xuất:** JSON đầy đủ của một phiên (tóm tắt, bình luận, đơn kèm bằng chứng, gợi ý trả lời) và CSV chỉ đơn (UTF-8 có BOM để Excel đọc đúng tiếng Việt/Hoa). Ô CSV bắt đầu bằng `= + - @` hoặc tab được thêm dấu `'` phía trước để bảng tính không chạy bình luận như công thức. File ghi vào thư mục Tải xuống (không ghi đè, tên có mã phiên và dấu thời gian); giao diện hiện đường dẫn.
- **Thời hạn lưu:** mặc định 90 ngày, chọn 30/90/180/365 hoặc "Mãi mãi"; xóa phiên quá hạn (cùng bình luận, đơn, gợi ý nhờ `ON DELETE CASCADE`) khi mở app, _trước_ khi nạp phiên gần nhất, và có nút xóa ngay. Danh mục sản phẩm không bị xóa theo thời hạn.
- **Sao lưu:** `VACUUM INTO` tạo bản sao nhất quán của cả cơ sở dữ liệu vào Tải xuống; không ghi đè file có sẵn. Bản sao chứa bình luận và tài khoản khách nên giao diện cảnh báo.
- **Xóa dữ liệu:** xóa một phiên hoặc mọi phiên (tùy chọn kèm danh mục), luôn hỏi xác nhận hai bước. Nếu xóa phiên đang mở, nguồn bình luận bị ngắt và app về phiên trống để không còn tham chiếu tới dòng đã mất. Khóa API vẫn xóa riêng ở Cài đặt.
- **Kiểm tra:** 9 test Rust mới (lọc nhật ký, giới hạn 1000 dòng, đếm theo phiên, chống công thức CSV, xuất đúng một phiên, quá hạn và "0 = giữ mãi", xóa tất cả giữ/xóa danh mục, sao lưu đọc lại được và không ghi đè, **10.000 bình luận** nạp từng đợt 1000, nạp lại không trùng, tổng hợp và xuất dưới 20 giây) và 10 test giao diện.
- **Chưa làm / chưa kiểm chứng:** mất mạng, ngắt nối, giới hạn tốc độ và hết thời gian của AI đã được phân loại thành mã lỗi từ Phase 3a và hiện lý do trong giao diện, nhưng chưa thử với dịch vụ thật. Tải 10.000 bình luận chỉ đo ở lớp SQLite, chưa đo giao diện React khi hàng nghìn dòng đến liên tục (giao diện giới hạn 1000 bình luận hiển thị). Chưa đóng gói và thử trên Mac/Windows thật. Nhật ký không có nút xóa riêng: nó chỉ tự cắt ở 1000 dòng và không bị xóa bởi "Xóa dữ liệu" (để còn dấu vết việc xóa).

## 14. Dashboard "Tổng quan" và chỉnh giao diện theo chuẩn Apple

- **Dashboard (`pages/DashboardPage.tsx`, `dashboard/metrics.ts`):** thẻ số liệu phiên hiện tại (bình luận, đơn cần kiểm tra, đơn đã xác nhận, trả lời đã sao chép), danh sách "Cần xử lý" (đơn cần kiểm tra, chưa có nguồn bình luận, chưa có danh mục, bình luận chưa phân loại chỉ khi đã chọn AI, AI báo lỗi gần đây) kèm nút mở đúng trang, thống kê tất cả các phiên, biểu đồ cột phẳng một màu "đơn đã xác nhận theo phiên", 5 phiên gần đây. Lịch sử lấy từ SQLite qua cùng client với trang Báo cáo; trên trình duyệt thường trang nói rõ cần app desktop, không bịa số. Phép tính là hàm thuần có test.
- **Chuẩn Apple:** màu và cỡ chữ của overlay xem trước chuyển thành token (`--overlay-*`); số đếm trong sidebar (bình luận, đơn cần kiểm tra); ô tìm kiếm ở danh sách đơn; Cmd/Ctrl+F ở cả Bảng điều khiển và Đơn; gợi ý phím tắt ở tooltip.
- **Chưa làm:** in phiếu (đơn tạm khi có bình luận mua; phiếu ship sau khi người bán nhập địa chỉ/SĐT). Chờ trả lời loại máy in, kiểu kết nối, và mẫu phiếu. App không tự nhắn người mua; chỉ soạn sẵn tin xin thông tin để người bán sao chép và tự gửi.

## 15. In phiếu qua máy in mạng (phiếu tạm)

- **Kết nối (`printer.rs`):** TCP thô tới IP của máy in (mặc định cổng 9100) và gửi ảnh ESC/POS (`GS v 0`, chia dải 128 dòng, cắt giấy cuối phiếu). Chỉ chấp nhận IP nội bộ (10/8, 172.16/12, 192.168/16, link-local, loopback); tên miền và IP công cộng bị từ chối (`BAD_HOST`) để app không thể dùng làm đường đẩy dữ liệu ra internet. Timeout kết nối 4 giây, ghi 15 giây. Mã lỗi: `BAD_HOST, BAD_SIZE, UNREACHABLE, TIMEOUT, WRITE`.
- **Vẽ phiếu bằng ảnh (`print/raster.ts`):** phiếu được vẽ bằng canvas của webview rồi chuyển thành bitmap 1 bit, nên chữ Hán, tiếng Việt có dấu in được mà không phụ thuộc bảng mã của máy in. Khổ 58 mm (384 điểm) hoặc 80 mm (576 điểm).
- **Phiếu tạm (`print/slip.ts`):** tiêu đề "PHIẾU TẠM / CHƯA XÁC NHẬN", ID TikTok, giờ, nội dung các bình luận làm bằng chứng, và dòng sản phẩm app tự đọc (ghi rõ "chưa kiểm tra"). Không có tên, số điện thoại, địa chỉ.
- **Khi nào in:** nút "In phiếu tạm" trên từng đơn nháp, và tùy chọn tự in (mặc định tắt) một lần cho mỗi đơn nháp mới tạo sau khi mở app (đơn khôi phục từ lần trước không in lại; bình luận bổ sung sau đó không in lại).
- **Hàng đợi (`print/service.ts`):** in tuần tự từng phiếu, giữ mã lỗi cuối để hiện ở Cài đặt và trang Đơn (lỗi không bị nuốt). Nhật ký thao tác ghi `PRINT_OK` / `PRINT_ERROR` kèm mã, không ghi nội dung phiếu.
- **Kiểm tra:** 6 test Rust (chỉ IP nội bộ, tiêu đề lệnh ESC/POS, chia dải, kích thước sai, gửi đúng từng byte qua socket loopback, cổng đóng) và 14 test giao diện (nội dung phiếu, ngắt dòng CJK, đóng gói bit, hàng đợi, lỗi).
- **Chưa kiểm chứng (quan trọng):** chưa thử trên máy in thật. Giả định máy in nhận RAW TCP cổng 9100 và lệnh ESC/POS raster `GS v 0` (đa số máy in nhiệt có cổng mạng đều hỗ trợ; máy dùng ngôn ngữ riêng như ZPL/TSPL/CPCL thì không in được). Chưa có việc vẽ canvas được kiểm thử tự động (jsdom không có canvas).
- **Chưa làm:** phiếu ship (cần địa chỉ, SĐT, đơn vị vận chuyển do người bán nhập tay) và tin nhắn xin thông tin soạn sẵn. Đang chờ ảnh form tạo đơn và file mẫu 7-11 từ tool taodonnhanh.com, vì tài liệu yêu cầu hiện chỉ ghi "Shipping Adapter later" và không liệt kê đơn vị vận chuyển hay định dạng phiếu.

## 16. Đơn ship 7-ELEVEN (賣貨便) và danh sách khách

Học theo taodonnhanh.com, làm đúng theo file mẫu `訂單匯入` v1.5 của 7-ELEVEN (đã lưu trong `src-tauri/resources/`).

- **Khách hàng**: khi chốt đơn ở "Đơn từ Live", TikTok ID của người mua tự vào danh sách khách (chỉ ID; tên/SĐT/cửa hàng do bạn nhập sau). Tab Khách hàng có nút "Copy tin nhắn xin thông tin" (bạn tự dán vào TikTok; app không tự gửi) và "Tạo đơn ship".
- **Đơn ship**: form như taodonnhanh (SĐT, tên, nhiệt độ, mã cửa hàng, sản phẩm, ghi chú, tiền hàng, phí ship mặc định 38, COD = tiền hàng + phí, TikTok ID). Luật theo file mẫu: tên 2–10 ký tự không số/ký hiệu; SĐT 10 số; mã cửa hàng 6 số; tiền hàng 0–20.000; phí ship 0–100; COD tối thiểu 58 (taodonnhanh; file mẫu ghi 55), tối đa 20.000; ghi chú/sản phẩm ≤ 200.
- **Mã cửa hàng**: tra theo mã/tên/địa chỉ qua trang bản đồ công khai của 7-ELEVEN (`emap.pcsc.com.tw/mobilemap/Id/Data.aspx`, cùng request của ô chọn cửa hàng của họ; không phải API có cam kết). Chỉ gọi khi người dùng bấm tìm hoặc nhập đủ 6 số; kết quả dùng được được lưu cục bộ để lần sau offline. Có thể nhập danh sách cửa hàng từ CSV.
- **Xuất Excel**: điền thẳng vào file mẫu (giữ sheet 填寫說明 và số phiên bản), ô dạng văn bản, tối đa 500 dòng, lưu vào Downloads, tùy chọn tự đánh dấu "đã xuất".
- **In phiếu ship** qua máy in mạng; dữ liệu cá nhân (tên/SĐT) nằm trong bảng `ship_*`, tuân theo thời hạn lưu giữ và nút xóa tất cả. Migration 5.
- Chưa kiểm chứng: file Excel đã qua bước "驗證" thật trên trang 賣貨便 chưa (cần bạn thử tải lên).

## 17. Quy trình A–Z, thẻ bình luận, báo cáo công việc

- **Live Console**: mỗi bình luận là một thẻ (avatar màu, User ID, giờ, nội dung, nguồn, AI) với nút **Tạo đơn** (tạo đơn nháp từ chính bình luận đó, chỉ có người mua + bình luận, không tự điền tên/SĐT/địa chỉ) và **In tem tạm** (cần máy in IP ở Cài đặt).
- **Quy trình A–Z** (`pages/WorkflowPage.tsx`, logic thuần `ship/flow.ts`): mỗi người mua có 5 bước: đã chốt đơn → đã in tem tạm → đã xin thông tin → đã có thông tin → đã tạo đơn ship, và một nút cho bước kế tiếp. Các mốc "đã in" / "đã copy tin nhắn" lưu trong bảng `buyer_flow` (migration 6, chỉ TikTok ID + thời điểm; chịu thời hạn lưu giữ và nút xóa tất cả).
- **Không tự gửi tin nhắn**: app chỉ soạn sẵn và copy; người bán tự dán vào TikTok (spec: không lưu mật khẩu/cookie TikTok, không tự gửi).
- **Báo cáo công việc** (Tổng quan): số đơn đã chốt, tem tạm đã in, đã xin/nhận thông tin, đơn ship tạo/xuất hôm nay, đơn chưa xuất và COD; nút Copy báo cáo.
- **Khóa zoom** trên điện thoại: viewport `user-scalable=no`, chặn gesture pinch / double-tap, `overscroll-behavior`.

## 18. Chia sẻ cho điện thoại cùng Wi-Fi

- **Cách hoạt động:** Cài đặt → "Chia sẻ cho điện thoại" bật máy chủ HTTP nhúng (`src-tauri/src/share.rs`). Điện thoại mở link/QR, tải đúng giao diện của app và gọi cùng các lệnh Rust qua `POST /api/invoke`. Dữ liệu luôn nằm trên máy tính.
- **An toàn:** mặc định tắt, tắt khi đóng app; chỉ nhận máy trong mạng nội bộ (10/8, 172.16/12, 192.168/16, link-local); Host phải là IP/localhost (chống DNS rebinding); mã 48 hex ngẫu nhiên mỗi lần bật, gửi qua header `X-Token`, so sánh hằng thời gian, khóa sau 30 lần sai; danh sách lệnh cho phép đóng (không có khóa API, xóa dữ liệu, ghi file, cấu hình AI/nguồn bình luận). In từ điện thoại luôn dùng máy in đã cài trên máy tính (không nhận host từ điện thoại). HTTP thuần trong LAN, nên cảnh báo trong UI.
- **Frontend:** `platform/backend.ts` (Tauri invoke hoặc fetch), `live/sessionStore` có `refreshFromDb` (điện thoại đọc theo máy tính mỗi 2,5 s) và `mergeFromDb` (máy tính nhận đơn/tin nhắn do điện thoại lưu, bản `updatedAt` mới hơn thắng). Điện thoại không khôi phục/đóng phiên, không chạy dọn dữ liệu, chỉ có các trang: Console, Báo cáo công việc, Đơn, Quy trình, Đơn ship, Tin nhắn, Báo cáo.
- **Chưa làm:** AI gọi từ điện thoại; máy in BLE; HTTPS cho LAN; thử trên mạng thật (cần Windows Firewall cho mạng riêng).

## 19. Mẫu tem dán sản phẩm, tìm cửa hàng thông minh, Cài đặt theo nhóm

- **Tem (`print/sticker.ts`, Cài đặt → Máy in & tem):** mỗi đơn trên Live in một tem dán sản phẩm: số đơn, ngày giờ, bình luận, (sản phẩm đọc tự động), TikTok ID, tên, SĐT, ghi chú cố định. Mỗi dòng bật/tắt và chỉnh cỡ 14–72 chấm, có xem trước theo khổ giấy. Tên/SĐT chỉ in khi khách đã lưu ở Đơn ship, không tự tạo. Sau đó mới nhắn TikTok ID để lấy thông tin (bước "ask" của quy trình A–Z).
- **Tìm cửa hàng (`ship/storeQuery.ts`, `pages/StoreSearch.tsx`):** nhập mã, tiếng Trung, tiếng Anh hoặc pinyin (bỏ dấu thanh, Wade-Giles); từ điển tỉnh/quận/đường/địa danh đổi sang tiếng Trung trước khi hỏi bản đồ 7-ELEVEN; gợi ý sổ xuống khi gõ (debounce 350 ms, ↑↓ Enter), tô đậm phần khớp, xếp theo mức khớp, cửa hàng tạm ngưng để mờ.
- **Cài đặt:** chia 4 nhóm: Chung, Máy in & tem, Điện thoại, AI & khóa.
- **Chưa làm:** kết nối hãng vận chuyển khác (FamilyMart, Shopee, T-Cat, Hsinchu, Chunghwa Post; cần hợp đồng/API key của người bán).

## 20. Giao diện sáng / tối

Cài đặt → Chung: Theo hệ thống (mặc định) / Sáng / Tối, nhớ trên thiết bị (`theme/theme.ts`, thuộc tính `data-theme` trên `<html>`, áp dụng trước khi vẽ giao diện nên không nháy). Trên điện thoại chế độ tối dùng nền đen thật với thẻ `#1c1c1e` như app hệ thống iOS; trên máy tính dùng bảng màu xám macOS.

## 21. Báo cáo tài chính (Tổng quan)

`dashboard/finance.ts` + `pages/FinancePanel.tsx`: từ các đơn ship đã lưu, theo Ngày (14 kỳ) / Tuần (12 tuần, bắt đầu thứ Hai) / Tháng (12 tháng): thẻ KPI (doanh thu = tiền hàng, số đơn, thu hộ COD = tiền hàng + phí, giá trị TB/đơn) kèm % so với kỳ trước, biểu đồ cột doanh thu, vòng tròn đã/chưa xuất Excel, bảng chi tiết có tổng (copy dán Excel), top khách mua. Không có đơn thì hiện trạng thái trống, không tự bịa số. Chưa có: chi phí/lợi nhuận, doanh thu theo phiên Live, hoàn/hủy đơn (app chưa theo dõi các số này).

## 22. Sổ sách: kho, nhập hàng, chi phí, lợi nhuận

- **Dữ liệu (migration 7, `src-tauri/src/biz.rs`):** `biz_stock` (giá vốn TB, tồn, mức báo sắp hết), `biz_purchases` (nhập hàng: tăng tồn, tính lại giá vốn bình quân gia quyền; xóa một lần nhập thì trừ lại), `biz_expenses` (hằng tháng `FIXED` hoặc một lần `ONCE`). `ship_orders` có thêm `sku`, `qty`, `unit_cost`: chọn sản phẩm trong danh mục khi tạo đơn ship thì tồn kho tự trừ (sửa/xóa đơn thì cộng lại) và lưu giá vốn tại thời điểm bán.
- **Báo cáo (`biz/ledger.ts`, `pages/ProfitPanel.tsx`):** lợi nhuận gộp = doanh thu − giá vốn; thu nhập thực tế = lợi nhuận gộp − chi phí; dòng tiền = doanh thu − tiền nhập hàng − chi phí. Chi phí hằng tháng chia đều theo ngày của tháng nên ngày/tuần/tháng khớp nhau. Hàng bán chạy (số lượng, lãi), giá trị tồn, sắp hết/âm kho, hàng tồn chưa bán. Đơn chưa gắn sản phẩm không có giá vốn và được báo rõ.
- **Giao diện:** mục "Kho & chi phí" (Kho hàng / Nhập hàng / Chi phí). Điện thoại chỉ đọc sổ sách (3 lệnh `biz_*_list` trong danh sách cho phép); sửa sổ ở máy tính.
- **Chưa có:** hoàn/hủy hàng, thuế, phí nền tảng theo %, nhiều kho.

## 23. Hãng vận chuyển

`carriers/registry.ts`, `pages/CarriersPage.tsx`: ECPay (cổng gộp 7-11/全家/萊爾富/OK/黑貓/郵局), 7-ELEVEN 賣貨便, 全家 好賣+, 蝦皮店到店, 黑貓宅急便, 新竹物流, 中華郵政. Mỗi hãng khai báo cách kết nối (Excel/API/đăng nhập) và các trường cần có; thông tin lưu trong kho khóa hệ điều hành theo ô `carrier-<hãng>-<trường>` (chỉ ghi/xóa, không đọc lại). Trạng thái chỉ là "Chưa kết nối / Còn thiếu / Đã lưu thông tin / Xuất Excel sẵn sàng", không bao giờ "Đã kết nối" khi chưa kiểm tra thật với hãng. Logo là nhãn hiệu của hãng nên app dùng ký hiệu trung tính; người bán thêm file logo chính thức vào từng thẻ. **Chưa làm:** gọi API từng hãng để tạo vận đơn (cần tài khoản/hợp đồng và khóa thật để thử).

## 24. Điện thoại, logo, kết nối hãng thật, thu chi

- **Giao diện điện thoại:** khối "iOS refinement" cuối `theme/live.css`: toolbar không cắt tiêu đề, ô nhập 17px/44pt (không bị zoom), select kiểu iOS, nhóm tab dạng segmented toàn chiều rộng, lưới form 2 cột `minmax(0,1fr)`, bảng rộng cuộn trong thẻ, không tràn ngang.
- **Logo:** 7 file do người bán cung cấp nằm trong `src/assets/carriers/` và được đóng gói (`carriers/logos.ts`). Đã bỏ việc tải logo từ web (`logo.rs`, lệnh `carrier_logo`, phụ thuộc `base64`) và các nút thêm/đổi/bỏ logo.
- **Kết nối thật:** chỉ ECPay có API mà app gọi trực tiếp (`src-tauri/src/ecpay.rs`): chữ ký CheckMacValue (MD5, theo tài liệu logistics của ECPay), `ecpay_check` (hỏi ECPay về một mã đơn không tồn tại: khóa đúng thì trả lời "không có đơn", khóa sai thì báo lỗi chữ ký/merchant), `ecpay_create` (vận đơn C2C 7-ELEVEN/FamilyMart; lưu `carrier`, `trade_no`, `tracking` vào đơn; migration 8), `ecpay_query`. Khóa đọc từ kho khóa ngay trong Rust, không về giao diện. Môi trường mặc định là **thử nghiệm** (stage); chuyển sang thật phải bấm và mỗi vận đơn thật hỏi xác nhận. Mã giao dịch lấy từ mã đơn nên bấm hai lần không tạo hai vận đơn. "Đã xác thực" chỉ hiện khi ECPay trả lời nhận khóa. Các hãng còn lại không có API cho người bán cá nhân (hoặc chỉ cấp theo hợp đồng): app mở trang đăng nhập/tra đơn chính thức bằng `open_carrier_page` (chỉ https, danh sách tên miền cố định, không tự điền mật khẩu). Điện thoại không gọi được các lệnh này. **Chưa thử với ECPay thật** (môi trường dev không ra được mạng của hãng, chưa có khóa): chữ ký và cách đọc phản hồi theo tài liệu, có test đơn vị nhưng chưa có vector chuẩn từ ECPay.
- **Thu chi (migration 8):** `biz_expenses` thêm `category` (13 nhóm cố định: thuê, lương, phí sàn, thanh toán, quảng cáo, vận chuyển, bao bì, điện nước, phần mềm, thuế, khấu hao, hoàn/hủy, khác) và loại `PERCENT` (tỷ lệ % doanh thu, lưu bằng basis points; tính theo từng đơn từ ngày bắt đầu). Thu nhập thực tế = lợi nhuận gộp − chi phí hằng tháng − chi phí một lần − chi phí theo %. Báo cáo có bảng chi phí theo nhóm. Form chi phí có các khoản mẫu của doanh nghiệp (bấm để điền sẵn tên/nhóm/cách tính); app không tự đặt tỷ lệ phí sàn hay thuế. **Chưa có:** khoản thu khác ngoài doanh thu đơn ship.

## 25. Kho mã vạch, phân loại kho, lợi nhuận từ hàng đã quét xuất (build sau 35)

- **Mô hình:** mỗi món có một mã riêng `<SKU>-<6 số>` (bảng `wh_units`, `wh_moves`; migration 9). Nhập kho (`wh_receive`) tạo đủ số mã và ghi luôn vào sổ nhập hàng/giá vốn trung bình; xuất (`wh_ship`) là tất cả-hoặc-không, chuyển trạng thái IN_STOCK → SHIPPED và không trừ tồn hai lần (`stock_handled`); chuyển kệ, hủy, nhập lại, kiểm kê (mã không quét trong phạm vi bị đánh dấu VOID, mã lạ chỉ báo). Mỗi thao tác có nhật ký.
- **Tem:** mã vạch Code 128-B tự viết (`barcode/code128.ts`, đã kiểm tra bằng giải mã `@zxing/library`), in ESC/POS raster qua máy in thứ hai ở Cài đặt (TSPL/ZPL-only chưa hỗ trợ). **Tem chỉ in giá bán**; giá vốn chỉ nằm trong sổ cho báo cáo tài chính. Tuỳ chọn in (`print/labelOptions.ts`, lưu cục bộ): số tem mỗi mã (1/2/5/10 hoặc tự nhập 1–99), căn trái/giữa, cỡ chữ giá, cao mã vạch, bật/tắt SKU, số dưới mã, vị trí kệ.
- **Phân tích kho** (`warehouse/analysis.ts`, tab "Phân tích", giao diện tối kiểu phòng điều khiển): ABC (Pareto theo doanh thu), XYZ (hệ số biến thiên theo tuần), vòng quay, ngày tồn, điểm đặt hàng = cầu/ngày × thời gian giao + 1,65σ√thời gian giao (95%), tuổi hàng, bản đồ nhiệt kệ, đề xuất số lượng đặt. Ước tính từ đơn đã bán, mã ít dữ liệu có thể phân nhóm chưa chuẩn.
- **Dashboard:** mã quét xuất không gắn với đơn ship nào được tính là một lần bán (doanh thu = giá trên tem, giá vốn = giá vốn lúc nhập) rồi trừ chi phí cố định/một lần/theo % để ra lợi nhuận. Mã gắn với đơn ship đã có thì không tính hai lần.
- **Điện thoại → PC realtime:** điện thoại mở link chia sẻ, tab "Quét gửi PC" gọi `scan_push`; Rust phát sự kiện `remote-scan` tới cửa sổ PC, tab Xuất kho/Kiểm kê đang mở xử lý ngay (tab khác chỉ báo mã vừa nhận, không tự chuyển tab). Điện thoại không gọi được `wh_receive`, `wh_void`, `wh_restock`. Máy quét USB/Bluetooth (gõ phím + Enter) dùng được ở mọi ô quét.
- **Camera điện thoại (giai đoạn 2):** `camera/CameraScanner.tsx`. Ảnh mờ quanh một khung quét, thanh quét chạy trong khung, chỉ giải mã đúng vùng khung (`camera/decode.ts`, zxing, chỉ Code 128) nên mã khác xung quanh hoặc đè bên dưới không lẫn vào; một mã chỉ được nhận sau khi giữ ổn định 3 giây (`camera/dwell.ts`, chịu được 1 khung hình mờ, mã khác chen vào thì đếm lại, nhận xong phải rời khung mới nhận lại) và chỉ nhận mã dạng `<SKU>-<6 số>` của app. Đã chạy thử trong Chromium với camera giả phát một mã `A12-000001`: nhận đúng sau 3 giây. Chưa thử trên iPhone thật.
- **HTTPS và chứng chỉ iOS:** `src-tauri/src/cert.rs`. App tự tạo CA cục bộ (lưu trong thư mục dữ liệu app, khóa chỉ chủ sở hữu đọc được trên Unix) với NameConstraints chỉ cho địa chỉ mạng nội bộ (10/8, 172.16/12, 192.168/16, link-local, loopback), và mỗi lần bật chia sẻ tạo chứng chỉ máy chủ 800 ngày cho IP của máy (iOS từ chối quá 825 ngày). Cổng HTTPS 47900+ chạy song song cổng HTTP (rustls, ring), cùng bộ lệnh; chỉ máy trong mạng nội bộ mới được bắt tay TLS. `/ca.mobileconfig` (hồ sơ iOS, chưa ký nên iOS báo "Chưa được ký") và `/ca.crt` (Android) là chứng chỉ công khai, không cần mã bí mật. Cài đặt → Điện thoại hiện QR chứng chỉ, QR link HTTPS và 4 bước cài/tin cậy. Có test bắt tay TLS thật với client chỉ tin CA này. Nếu tạo chứng chỉ lỗi thì link HTTP thường vẫn chạy.
- **Máy in từ iPhone:** Safari không có TCP thô nên không nối thẳng máy in; điện thoại in qua máy tính (`printer_print`). Máy chủ chia sẻ giờ giữ hai máy in (hóa đơn và tem, `Printers`), lệnh `printer_print`/`printer_config` nhận `kind`; điện thoại nhận cả hai cấu hình khi mở, tem in sang máy in tem thay vì nhầm sang máy hóa đơn. Tab "Quét gửi PC" có khung hiển thị hai máy in và nút in thử.
- **Chưa thử trên thiết bị thật:** in tem trên máy in thật, chia sẻ/HTTPS qua mạng LAN thật, cài chứng chỉ trên iPhone thật.


## 26. Bản phát hành macOS trên GitHub Actions

`.github/workflows/build.yml`: job `build` build cả 3 nền tảng như trước (macOS Apple Silicon,
macOS Intel, Windows) nhưng không tự publish nữa — mỗi nền tảng chỉ gom file cài đặt của mình
(`release-files/`: `.dmg` đổi tên theo target cho macOS, `.exe`/`-setup.exe` cho Windows) rồi
upload làm artifact `LIVE-STUDIO-release-<target>`. Một job `release` riêng (chạy sau, trên
`ubuntu-latest`) tải tất cả artifact đó và gọi `softprops/action-gh-release` **một lần duy nhất**,
nên chỉ có một bản phát hành cho mỗi lần push, đủ cả 3 file — trước đó chỉ job Windows publish nên
bản phát hành không có file Mac; để 3 job macOS/Windows tự publish song song từng job rủi ro tranh
chấp tạo release cùng lúc nên gộp vào một job riêng. Ứng dụng macOS chưa ký (không có Apple
Developer certificate trả phí) nên người dùng phải tự gỡ cách ly Gatekeeper lần đầu (chuột phải →
Mở, hoặc `xattr -cr`).

## 27. Sửa bản phát hành macOS: build "universal" thay vì build chéo Intel riêng

Lỗi: Mac Intel thật báo `"LIVE STUDIO" is not supported on this Mac` khi mở file
`LIVE-STUDIO-x86_64-apple-darwin.dmg`. Nguyên nhân tìm được: GitHub đã ngừng máy Mac Intel thật
cho runner `macos-15-intel` (log CI cho thấy `Image: macos-15`, tức là chạy trên máy Apple Silicon
giống hệt job còn lại), nên "build cho Intel" thực chất là build chéo trên máy ARM. Kiểm tra trực
tiếp file Mach-O trong `.dmg` đã build (tải về, giải nén bằng `7z`, đọc load command bằng Python)
cho thấy kiến trúc đúng là `x86_64` nhưng **hoàn toàn không có `LC_CODE_SIGNATURE`** — không hề
được ký, kể cả ký ad-hoc. Build chéo kiểu `--target x86_64-apple-darwin` trên máy ARM không tự ký
giống như Xcode build xuôi (native) vẫn làm.

Sửa: `.github/workflows/build.yml` đổi job macOS còn một job duy nhất trên `macos-latest`, build
`--target universal-apple-darwin` (cài cả hai Rust target `aarch64-apple-darwin` và
`x86_64-apple-darwin` qua `dtolnay/rust-toolchain`). Đây là cách Tauri tự hỗ trợ: build cả hai
kiến trúc rồi gộp bằng `lipo` và ký trong cùng một lệnh `tauri build`, cho ra một file `.dmg` duy
nhất (`LIVE-STUDIO-macOS.dmg`) chạy được trên cả Apple Silicon và Intel — cũng đỡ người dùng phải
phân biệt tải file nào. Bỏ job `macos-15-intel` (vốn không chạy trên máy Intel thật).