# Local Shop Assistant — TikTok LIVE Assistant
## Thành phần, kiến trúc và kế hoạch triển khai cho Claude Code

- **Tài liệu:** `TIKTOK_LIVE_ASSISTANT.md`
- **Phiên bản:** 1.0
- **Ngày:** 2026-10-30
- **Sản phẩm:** Local Shop Assistant Taiwan
- **Nền tảng mục tiêu:** Windows và macOS Apple Silicon
- **Ngôn ngữ giao diện:** Traditional Chinese (zh-TW) mặc định; có thể mở rộng tiếng Việt/English
- **Mục tiêu:** Hỗ trợ người bán xử lý bình luận livestream, đề xuất trả lời bằng AI, phát hiện ý định mua hàng và tạo đơn nháp.

---

## 0. Chỉ thị dành cho Claude Code

Đọc toàn bộ tài liệu này trước khi sửa mã nguồn.

**Không bắt đầu bằng cách xây lại toàn bộ ứng dụng.** Trước tiên hãy kiểm tra repository hiện có, xác định stack, cấu trúc thư mục, conventions, test, cấu hình và các tính năng đã tồn tại. Sau đó:

1. Tạo kế hoạch triển khai theo các phase bên dưới.
2. Tái sử dụng các module hiện có; tránh tạo hệ thống thứ hai cho cùng một chức năng.
3. Nếu repository hiện chưa có app, tạo cấu trúc tối thiểu tương thích với kiến trúc được chốt.
4. Triển khai từng phase thành các thay đổi nhỏ, có test và hướng dẫn chạy.
5. Không giả vờ rằng TikTok đã kết nối thật khi chưa có credentials, quyền API và nguồn sự kiện hợp lệ.
6. Không tự động gửi bình luận/tin nhắn lên TikTok trong bản đầu tiên. Bản đầu tiên chỉ đề xuất nội dung; người bán phải duyệt và gửi thủ công hoặc qua API được chính thức cho phép.
7. Không dùng mật khẩu TikTok, cookie phiên đăng nhập, browser scraping hoặc giao thức reverse-engineered như nền tảng production mặc định.
8. Nếu thiếu quyền API LIVE realtime, triển khai một interface `LiveCommentProvider` và trạng thái `UNAVAILABLE`/`DEMO`; không giả lập dữ liệu thật.
9. Không đưa secrets vào frontend, repository, log hoặc file cấu hình được commit.
10. Sau mỗi phase: chạy formatter, lint, typecheck, tests và cập nhật README.

### Tiêu chí hoàn thành tổng thể

- App có trang Live Assistant.
- Người dùng có thể lưu URL LIVE hoặc username làm thông tin tham chiếu.
- UI hiển thị rõ trạng thái nguồn bình luận: Connected / Connecting / Unavailable / Demo.
- Bình luận nhận được được chuẩn hóa và đưa vào một luồng xử lý duy nhất.
- AI phân loại câu hỏi, ý định mua hàng và dữ liệu sản phẩm; không tự bịa SKU hoặc thông tin cá nhân.
- Đơn hàng mới luôn là **draft** cho tới khi dữ liệu được xác thực.
- Không gửi trả lời tự động nếu chưa có provider gửi tin nhắn hợp lệ và người bán bật tính năng đó rõ ràng.
- Có deduplication, logging không chứa dữ liệu nhạy cảm, và tests cho các luồng chính.

---

## 1. Phạm vi sản phẩm

Local Shop Assistant là desktop app local-first hỗ trợ shop Đài Loan. TikTok LIVE Assistant là một module bổ sung, không thay thế TikTok LIVE Studio.

### Trong phạm vi

- Mở TikTok LIVE Studio bằng thao tác do người dùng chủ động.
- Lưu link LIVE và/hoặc username để tham chiếu phiên livestream.
- Kết nối với nguồn bình luận thông qua provider được triển khai.
- Chuẩn hóa bình luận thành một schema thống nhất.
- Hiển thị luồng bình luận gần realtime.
- AI phân loại câu hỏi, phản hồi sản phẩm, và ý định mua.
- Trích xuất SKU, màu, size, số lượng chỉ khi có bằng chứng trong nội dung hoặc catalog đã cấu hình.
- Ghép nhiều bình luận của cùng một tài khoản trong cùng phiên LIVE, với giới hạn thời gian và khả năng sửa/xác nhận.
- Tạo đơn nháp.
- Soạn câu trả lời đề xuất để người bán duyệt.
- Tạo overlay cục bộ để hiển thị bảng giá/mã sản phẩm trong phần mềm livestream hỗ trợ Browser Source.
- Thống kê phiên LIVE và các đơn nháp.
- Lưu lịch sử local và cho phép xuất dữ liệu.

### Không thuộc phạm vi của MVP

- Không phát livestream trực tiếp bên trong Local Shop Assistant.
- Không nhúng cửa sổ TikTok LIVE Studio vào giao diện app.
- Không giả định link LIVE có thể cung cấp quyền đọc chat.
- Không giả định có API chính thức phổ thông để đọc mọi bình luận TikTok LIVE realtime.
- Không tự động nhắn tin riêng cho người bình luận.
- Không tự thu thập số điện thoại, địa chỉ hoặc danh tính từ nguồn ngoài.
- Không tạo vận đơn nếu chưa đủ và chưa xác nhận thông tin giao hàng.
- Không dùng API TikTok Shop Seller làm nguồn bình luận LIVE; luồng này độc lập với Seller API.

---

## 2. Kiến trúc tổng thể

### 2.1 Nguyên tắc

- **Desktop:** Tauri + React + TypeScript, nếu đây là stack đã chọn trong repository.
- **Local Core:** Python + FastAPI nếu backend local đã được thiết lập.
- **Local database:** SQLite.
- **Realtime UI:** WebSocket hoặc Server-Sent Events giữa Local Core và frontend.
- **AI:** Adapter/provider layer; hỗ trợ BYOK hoặc AI Credits theo cấu hình sản phẩm hiện tại.
- **Live input:** Provider interface có thể thay thế; chỉ provider đã kiểm chứng mới được bật trong production.
- **LIVE Studio:** chạy như ứng dụng riêng. Local app chỉ mở ứng dụng hoặc cung cấp hướng dẫn; không giả định có API điều khiển chính thức.
- **Overlay:** local HTTP page chỉ phục vụ dữ liệu overlay đã được người dùng chọn; không đưa PII lên overlay.
- **Cloud:** không bắt buộc cho xử lý local; chỉ dùng khi cần AI cloud, API chính thức hoặc các dịch vụ online.

### 2.2 Sơ đồ dữ liệu

```text
TikTok LIVE / nguồn sự kiện được hỗ trợ
                 |
                 v
       LiveCommentProvider
                 |
                 v
       Normalization + Dedup
                 |
                 v
          Live Event Bus
            /        \\
           v          v
     Live Chat UI   AI Classifier
                        |
              +---------+----------+
              |                    |
              v                    v
       Suggested Reply       Order Intent Parser
              |                    |
              v                    v
       Human Approval          Order Draft
              |                    |
              v                    v
       Supported Sender      Validation / Review
                                   |
                                   v
                             Order Manager
                                   |
                                   v
                           Shipping Adapter later
```

### 2.3 Các module cần có

```text
apps/
  desktop/                  # Tauri + React + TypeScript, nếu repo dùng cấu trúc này
services/
  local-core/               # FastAPI, nếu repo đã dùng backend riêng
packages/
  shared-types/             # Shared event and order schemas nếu phù hợp
docs/
  TIKTOK_LIVE_ASSISTANT.md
```

Không ép cấu trúc này nếu repository đang có conventions tốt hơn. Claude phải khảo sát repo trước khi quyết định.

---

## 3. LiveCommentProvider — lớp trừu tượng bắt buộc

Không gắn logic UI trực tiếp với một thư viện TikTok không chính thức. Tạo interface để có thể thay nguồn sự kiện mà không viết lại app.

### 3.1 Trạng thái provider

```ts
type LiveProviderStatus =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "UNAVAILABLE"
  | "DEMO"
  | "ERROR";
```

### 3.2 Interface tham khảo

```ts
type LiveSessionConfig = {
  sessionId: string;
  liveUrl?: string;
  username?: string;
};

type LiveCommentEvent = {
  eventId: string;
  platform: "tiktok";
  sessionId: string;
  platformUserId?: string;
  username?: string;
  displayName?: string;
  commentText: string;
  commentTimestamp: string;
  receivedAt: string;
  source: "OFFICIAL_API" | "APPROVED_CONNECTOR" | "OCR" | "DEMO";
  sourceConfidence?: number;
  rawPayloadRef?: string;
};

interface LiveCommentProvider {
  getStatus(): Promise<LiveProviderStatus>;
  connect(config: LiveSessionConfig): Promise<void>;
  disconnect(sessionId: string): Promise<void>;
  onComment(handler: (event: LiveCommentEvent) => void): () => void;
}
```

Có thể điều chỉnh type theo conventions của repo, nhưng phải giữ rõ trạng thái, nguồn sự kiện và ID để deduplication.

### 3.3 Các provider triển khai

1. `DemoLiveCommentProvider`: chỉ cho development/test; luôn gắn nhãn DEMO.
2. `OfficialLiveCommentProvider`: chỉ triển khai khi có tài liệu, credentials, quyền và xác minh chữ ký/ủy quyền phù hợp.
3. `ApprovedConnectorProvider`: chỉ khi nhà cung cấp bên thứ ba có điều khoản và quyền sử dụng phù hợp.
4. `OcrLiveCommentProvider`: phương án dự phòng nghiên cứu. Phải nêu rõ có thể bỏ sót, không có stable user ID, và không được giả định OCR có thể gửi trả lời.

Không triển khai reverse-engineered Webcast protocol làm mặc định production. Nếu thử nghiệm nội bộ với một connector không chính thức, đặt sau feature flag, tách package, không lưu session cookies, không bật trong build thương mại mặc định và ghi rõ rủi ro/điều khoản.

### 3.4 URL LIVE không phải credential

- URL chỉ dùng để tham chiếu phiên hoặc mở trang LIVE.
- Không coi URL là token truy cập.
- Không cho rằng chỉ dán URL là nhận được bình luận.
- Nếu provider không hỗ trợ lấy dữ liệu từ URL, UI phải giải thích rõ và yêu cầu phương thức kết nối khác.

---

## 4. UI/UX — Live Assistant

### 4.1 Vị trí menu

Thêm mục sidebar: `Live Assistant` hoặc `直播助手`.

Các màn hình:

1. Live Setup
2. Live Console
3. Live Orders
4. Reply Suggestions
5. Product Overlay
6. Session Report
7. Live Settings

### 4.2 Live Setup

Các thành phần:

- Input `LIVE URL` (optional).
- Input `TikTok username` (optional).
- Button `Open LIVE Studio`.
- Button `Connect source`.
- Provider status và mô tả trạng thái.
- Checkbox xác nhận quyền và phương thức kết nối.
- Nút `Start session` chỉ hoạt động khi cấu hình đủ.
- Không hiện trạng thái “Connected” cho đến khi provider thực sự xác nhận kết nối.

Nếu không có provider live thật, hiển thị `Chưa có nguồn bình luận được kết nối` chứ không hiển thị bình luận giả như dữ liệu thực.

### 4.3 Live Console

Bố cục desktop 3 cột:

- **Cột trái:** trạng thái phiên LIVE, thời gian chạy, tổng bình luận, đơn nháp, cần kiểm tra.
- **Cột giữa:** feed bình luận theo thời gian; tìm kiếm; filter theo loại; dấu thời gian; trạng thái xử lý.
- **Cột phải:** AI insight, câu trả lời đề xuất, chi tiết ý định mua và thao tác người bán.

Bộ lọc:
- All
- Questions
- Purchase intent
- Product questions
- Spam/irrelevant
- Needs review

Mỗi comment row hiển thị:
- username nếu provider cung cấp;
- nội dung nguyên bản;
- thời điểm;
- nguồn (API/OCR/DEMO);
- trạng thái AI;
- confidence;
- hành động xem chi tiết.

### 4.4 Reply Suggestions

- Hiển thị bình luận gốc và câu trả lời đề xuất.
- Có `Edit`, `Copy`, và `Send` chỉ khi có sender provider hỗ trợ và được bật.
- MVP: `Copy` là mặc định, người bán gửi qua giao diện TikTok.
- Không được giả vờ rằng `Copy` đã gửi câu trả lời.
- Tự động gửi chỉ là feature flag tắt mặc định và cần quyền API đã xác minh, kiểm tra rate limit và audit log.

### 4.5 Live Orders

Bảng đơn nháp gồm:
- Customer/platform user reference.
- SKU.
- Variant (màu/size).
- Quantity.
- Độ tin cậy AI.
- Bình luận nguồn.
- Trạng thái `DRAFT`, `NEEDS_REVIEW`, `CONFIRMED`, `CANCELLED`.
- Lý do cần kiểm tra.

Không tự sinh tên, điện thoại hoặc địa chỉ. Chỉ ghi thông tin giao hàng khi khách cung cấp trong nội dung được phép xử lý hoặc người bán nhập thủ công theo quy trình hợp lệ.

### 4.6 Overlay

Tạo trang local overlay (ví dụ route `/overlay/live-product`) để hiển thị:
- tên sản phẩm;
- SKU;
- giá đã cấu hình;
- màu/size;
- thông tin khuyến mại do shop nhập.

Overlay:
- không hiển thị thông tin cá nhân;
- không tự động đưa bình luận khách lên màn hình;
- có nút ẩn/hiện và preview;
- chỉ đưa URL vào Browser Source nếu phần mềm phát có hỗ trợ;
- không tự động điều khiển LIVE Studio khi không có API chính thức.

---

## 5. AI pipeline

### 5.1 Phân loại bình luận

Các loại:

```ts
type CommentIntent =
  | "PRODUCT_QUESTION"
  | "PURCHASE_INTENT"
  | "PRICE_QUESTION"
  | "SHIPPING_QUESTION"
  | "STOCK_QUESTION"
  | "GENERAL_QUESTION"
  | "SPAM"
  | "UNKNOWN";
```

### 5.2 Trích xuất đặt hàng

Schema tham khảo:

```ts
type OrderIntentDraft = {
  sku?: string;
  productName?: string;
  color?: string;
  size?: string;
  quantity?: number;
  evidenceText: string[];
  confidence: number;
  missingFields: string[];
  needsHumanReview: boolean;
};
```

### 5.3 Quy tắc an toàn và chính xác

- SKU phải khớp catalog của shop.
- Màu/size phải khớp các variant hợp lệ.
- Số lượng phải là số nguyên dương trong giới hạn cấu hình.
- Nếu khách nói “我要兩個” nhưng không có ngữ cảnh sản phẩm đủ rõ, không tạo đơn tự động; đánh dấu cần kiểm tra.
- Không suy luận địa chỉ/số điện thoại/tên thật từ username.
- Không coi việc bình luận mã sản phẩm là đồng ý với mọi điều kiện mua hàng.
- Lưu `sourceEventId` cho mỗi field/đơn để truy xuất bằng chứng.
- Khi confidence thấp hoặc có mâu thuẫn, chuyển sang `NEEDS_REVIEW`.
- AI chỉ trả JSON theo schema đã định; validate server-side trước khi lưu.
- AI không được gọi API vận chuyển trực tiếp. AI chỉ tạo draft; nghiệp vụ và shipping adapter quyết định sau xác nhận.

### 5.4 Gom nhiều bình luận

Một người có thể gửi nhiều comment liên tiếp, ví dụ:
- `A12`
- `黑色 M`
- `兩件`

Có thể gom vào một candidate order trong cùng phiên LIVE dựa trên platform user ID khi có. Nếu chỉ có username hoặc OCR, đánh dấu mức tin cậy thấp và yêu cầu người bán xác nhận. Dùng cửa sổ gom bình luận có thể cấu hình, tránh nhập nhầm bình luận của các phiên hoặc khách khác nhau.

---

## 6. Realtime event handling

### 6.1 Chuẩn hóa event

Mỗi sự kiện cần:
- `eventId` hoặc khóa dedup ổn định;
- `sessionId`;
- `receivedAt`;
- `commentTimestamp`;
- `source`;
- `commentText`;
- user reference nếu provider thực sự cung cấp.

### 6.2 Deduplication và độ bền

- Có unique constraint cho `(provider, eventId)` hoặc dedup key thích hợp.
- Không xử lý một sự kiện hai lần sau reconnect.
- Lưu event trước khi chạy AI để tránh mất dữ liệu nếu AI lỗi.
- Xử lý AI bất đồng bộ; UI không bị block.
- Retry có exponential backoff và giới hạn số lần.
- Dead-letter/error state cho sự kiện lỗi liên tục.
- Không ghi raw payload chứa dữ liệu nhạy cảm vào log thông thường.

### 6.3 Giao tiếp backend/frontend

Ưu tiên WebSocket nếu app đã có nền tảng realtime; nếu chưa, chọn SSE cho luồng một chiều và REST cho thao tác. Không triển khai đồng thời nhiều cơ chế nếu không cần thiết.

Các event frontend có thể dùng:
- `live.status_changed`
- `live.comment_received`
- `live.comment_classified`
- `live.reply_suggested`
- `live.order_draft_created`
- `live.processing_error`

---

## 7. Data model / SQLite

Tích hợp vào schema hiện có nếu có; không tạo database thứ hai chỉ cho LIVE.

Bảng gợi ý:

### `live_sessions`
- `id`
- `platform`
- `live_url`
- `username`
- `provider_type`
- `status`
- `started_at`
- `ended_at`
- `created_at`

### `live_comments`
- `id`
- `session_id`
- `provider_event_id`
- `platform_user_id` nullable
- `username` nullable
- `comment_text`
- `comment_timestamp`
- `received_at`
- `source`
- `processing_status`
- `intent`
- `confidence`
- `created_at`

Unique index chống trùng cho `session_id + provider_event_id` khi event ID có sẵn.

### `live_reply_suggestions`
- `id`
- `comment_id`
- `suggested_text`
- `model_provider`
- `model_name`
- `status` (`DRAFT`, `COPIED`, `SENT`, `REJECTED`)
- `approved_by_user`
- `created_at`
- `sent_at` nullable

### `live_order_drafts`
- `id`
- `session_id`
- `platform_user_id` nullable
- `username` nullable
- `sku` nullable
- `variant_json`
- `quantity` nullable
- `confidence`
- `status`
- `review_reason`
- `created_at`
- `updated_at`

### `live_order_evidence`
- `id`
- `order_draft_id`
- `comment_id`
- `field_name`
- `evidence_text`

Không lưu API keys, cookies hoặc access tokens TikTok trong SQLite trừ khi kiến trúc bảo mật đã được thiết kế rõ; nếu phải giữ credential local, dùng OS keychain/credential manager.

---

## 8. API nội bộ đề xuất

Điều chỉnh prefix theo API conventions hiện có.

- `POST /api/live/sessions` — tạo phiên cấu hình.
- `GET /api/live/sessions` — danh sách phiên.
- `GET /api/live/sessions/{id}` — chi tiết phiên.
- `POST /api/live/sessions/{id}/connect` — yêu cầu provider kết nối.
- `POST /api/live/sessions/{id}/disconnect` — ngắt provider.
- `GET /api/live/sessions/{id}/comments` — feed bình luận.
- `POST /api/live/comments/{id}/classify` — yêu cầu phân loại.
- `POST /api/live/comments/{id}/suggest-reply` — tạo câu trả lời đề xuất.
- `POST /api/live/replies/{id}/copy` — đánh dấu đã copy; không gửi lên TikTok.
- `POST /api/live/order-drafts` — tạo draft.
- `PATCH /api/live/order-drafts/{id}` — sửa draft.
- `POST /api/live/order-drafts/{id}/confirm` — xác nhận qua UI người bán.
- `GET /api/live/metrics` — số liệu phiên.
- `GET /overlay/live-product` — trang overlay (nếu dùng route này).

Các endpoint phải kiểm tra session, schema, trạng thái và quyền. Không tin dữ liệu do frontend gửi lên nếu cần xác minh lại trong backend.

---

## 9. Mở TikTok LIVE Studio

- Cho phép người dùng cấu hình đường dẫn ứng dụng hoặc chọn mở thủ công.
- Không hardcode đường dẫn cài đặt cho mọi máy.
- Trên Windows, kiểm tra file tồn tại và xử lý lỗi thân thiện.
- Trên macOS, mở ứng dụng qua cơ chế hệ điều hành phù hợp và kiểm tra app được cài đặt.
- Không giả định LIVE Studio có mặt trên macOS hoặc có feature parity trên hai OS; kiểm tra hỗ trợ hiện hành trước khi đưa ra tuyên bố.
- Không inject code, đọc memory, lấy cookies hay tự điều khiển giao diện TikTok để vượt cơ chế quyền.
- Nếu app không tìm thấy LIVE Studio, hiển thị hướng dẫn mở thủ công.

---

## 10. Security, privacy và compliance

- Không thu thập thông tin cá nhân ngoài những gì cần cho yêu cầu của shop.
- Không suy đoán thông tin khách từ username.
- Không gửi nội dung bình luận tới AI cloud nếu cấu hình AI đang tắt hoặc người dùng chưa được thông báo.
- Cho phép người dùng chọn BYOK hoặc AI Credits theo cấu hình chung của sản phẩm.
- Không log API keys, tokens, cookies, địa chỉ hoặc số điện thoại ở dạng rõ.
- Có nút xóa dữ liệu phiên LIVE và thời hạn lưu rõ ràng.
- Giới hạn số lượng event và kích thước comment.
- Giới hạn AI concurrency và chi phí.
- Không gửi reply tự động mặc định.
- Bất kỳ tính năng gửi tự động nào cũng phải có provider gửi hợp lệ, quyền phù hợp, rate limit, opt-in rõ ràng và audit log.
- Tuân thủ điều khoản TikTok và quyền API đã được cấp. Nếu chưa xác minh được tính hợp lệ của connector, không bật trong build production.
- Không hứa realtime 100%; UI cần hiển thị độ trễ/trạng thái nguồn khi có thể.

---

## 11. Kế hoạch triển khai theo phase

### Phase 0 — Repo audit

- Khảo sát repository, stack, build scripts, tests và database hiện tại.
- Tóm tắt cấu trúc đang có.
- Xác định nơi đặt module Live Assistant.
- Chưa thêm dependency mới trước khi đánh giá cần thiết.
- Viết plan ngắn trong `docs/IMPLEMENTATION_PLAN_TIKTOK_LIVE.md`.

**Nghiệm thu:** không làm hỏng chức năng hiện có; plan chỉ rõ file sẽ sửa/tạo.

### Phase 1 — UI + Demo provider

- Tạo trang Live Setup và Live Console.
- Tạo `LiveCommentProvider` interface.
- Tạo `DemoLiveCommentProvider` cho local development.
- Hiển thị rõ DEMO ở mọi comment giả.
- Thêm mock stream có thể bật/tắt.
- Tạo tests cho trạng thái và rendering.

**Nghiệm thu:** chạy app thấy feed demo; không nhầm demo với live thật.

### Phase 2 — Local persistence + event bus

- Thêm migration cho live sessions/comments.
- Thêm deduplication.
- Đưa event vào WebSocket/SSE theo stack hiện có.
- Xử lý reconnect và lỗi provider.
- Thêm tests duplicate, reconnect và event order.

**Nghiệm thu:** một event không tạo hai comment hoặc hai đơn; UI vẫn responsive.

### Phase 3 — AI classification + order drafts

- Dùng AI provider abstraction đang có.
- Thêm intent classification và schema validation.
- Đối chiếu catalog SKU/variant.
- Tạo order draft có evidence.
- Thêm màn hình Needs Review.
- Không gọi shipping API ở phase này.

**Nghiệm thu:** dữ liệu mơ hồ không được tự động xác nhận; mọi field được trích xuất đều truy về comment nguồn.

### Phase 4 — Reply suggestions + overlay

- Soạn reply dựa trên catalog và policy của shop.
- Nút chỉnh sửa/copy.
- Ghi nhận `COPIED`, không ghi `SENT` khi chỉ copy.
- Tạo local overlay an toàn, có preview.
- Kiểm thử overlay không hiển thị PII.

**Nghiệm thu:** người bán kiểm soát nội dung trước khi gửi; overlay chỉ hiển thị dữ liệu được chọn.

### Phase 5 — Live provider thực tế

Chỉ bắt đầu khi đã xác minh:
- nguồn sự kiện hợp pháp và có thể dùng;
- phương thức xác thực;
- khả năng lấy comment realtime;
- hạn chế theo account/region;
- phương thức gửi reply (nếu có);
- điều khoản sử dụng và yêu cầu xét duyệt.

Sau đó:
- triển khai provider riêng;
- không sửa AI pipeline/UI core để phù hợp một connector duy nhất;
- thêm integration tests và health/status reporting;
- giữ demo provider cho regression tests.

**Nghiệm thu:** chỉ hiển thị Connected khi provider thực sự nhận được sự kiện từ phiên đã cấu hình.

### Phase 6 — Hardening

- Test mất mạng, provider disconnect, rate limit và AI timeout.
- Backup/retention và xóa dữ liệu.
- Audit log.
- Kiểm tra hiệu năng khi nhiều comment đến liên tục.
- Đóng gói và test trên các OS thực sự hỗ trợ.
- Viết hướng dẫn cấu hình, quyền và troubleshooting.

---

## 12. Bộ test bắt buộc

1. Dán URL rỗng hoặc sai định dạng.
2. URL hợp lệ nhưng provider không hỗ trợ đọc chat.
3. Provider chuyển `CONNECTING` → `CONNECTED`.
4. Provider lỗi hoặc mất kết nối.
5. Một comment được gửi lặp.
6. Comment tiếng Hoa phồn thể, tiếng Việt, emoji và ký tự đặc biệt.
7. SKU không tồn tại.
8. Thiếu màu/size/số lượng.
9. Cùng khách gửi nhiều comment để hoàn thiện một đơn.
10. Hai khách gửi comment xen kẽ; không ghép nhầm.
11. AI trả JSON sai schema.
12. AI timeout hoặc hết credit.
13. Người bán sửa câu trả lời rồi copy.
14. Copy reply không được ghi nhận là đã gửi.
15. Overlay không chứa PII.
16. Restart app không làm mất session/comment đã lưu.
17. Chạy nhiều comment liên tục mà UI không treo.
18. Không có credentials vẫn chạy được demo mode.

---

## 13. Definition of Done

Một phase chỉ được coi là hoàn thành khi:

- Code chạy được trong repository.
- Có tests phù hợp và tests pass.
- Không có secret trong source hoặc log.
- Typecheck/lint/format pass theo scripts hiện có.
- UI thể hiện đúng trạng thái thật/demo/error.
- Không phá chức năng hiện có.
- README hoặc docs được cập nhật.
- Claude báo rõ file đã tạo/sửa, lệnh test đã chạy, kết quả và giới hạn chưa giải quyết.

### Thứ tự ưu tiên

1. Repo audit.
2. UI + Demo provider.
3. Persistence + realtime event bus.
4. AI classification + order draft.
5. Reply suggestions + overlay.
6. Live provider thật sau khi xác minh quyền.
7. Tích hợp Order Manager/shipping theo luồng xác nhận hiện có.

**Nguyên tắc cuối:** xây dựng hệ thống theo hướng provider-based. Không khóa sản phẩm vào một giao thức TikTok không chính thức; không tuyên bố tích hợp thật khi chưa có nguồn bình luận hợp lệ; và luôn để người bán kiểm soát việc gửi câu trả lời và xác nhận đơn.
