# Thiết lập tab Quảng cáo (TikTok / Meta / Google)

Tab **Quảng cáo** trong LIVE STUDIO dùng API quảng cáo **chính thức** của từng nền tảng — khác
hoàn toàn với Euler Stream (nguồn bình luận live). Đây là tài khoản quảng cáo thật của bạn, API
đọc dữ liệu và một vài hành động cơ bản, không phải một dịch vụ không chính thức.

## Phạm vi hiện tại (đọc kỹ trước khi dùng)

- **Đã làm:** xem chi tiêu/hiển thị/click/chuyển đổi 7 ngày gần nhất; xem danh sách chiến dịch
  đang có; tắt (pause) hoặc mở lại (enable) một chiến dịch **đã tồn tại**.
- **Chưa làm:** tạo chiến dịch mới (ngân sách, đối tượng, nội dung quảng cáo thật trên nền tảng).
  Việc này cần được làm cẩn thận, kiểm thử kỹ với từng nền tảng trước khi đụng tới tiền thật, nên
  chưa nằm trong phạm vi lần này.
- **Chưa được thử với tài khoản thật:** khi viết phần này không có sẵn tài khoản quảng cáo thật
  để kiểm thử. Code đi theo đúng tài liệu API chính thức của từng nền tảng, nhưng **hãy kiểm tra
  kỹ, thử với ngân sách nhỏ**, trước khi tin tưởng nút tắt/mở chiến dịch trên một chiến dịch đang
  chạy thật.
- Khóa API lưu trong kho khóa của hệ điều hành (Keychain trên Mac, Credential Manager trên
  Windows). App chỉ ghi hoặc xóa, không đọc lại được — giống hệt cách AI key và khóa hãng vận
  chuyển đang được lưu.

## 1. TikTok for Business Marketing API

1. Vào <https://ads.tiktok.com/marketing_api/homepage>, đăng nhập bằng tài khoản TikTok Ads của
   bạn và đăng ký làm Developer (khác tài khoản TikTok cá nhân dùng để live).
2. Tạo một **App** mới trong Developer Portal, lấy `App ID` và `Secret`.
3. Lấy **Access Token**: TikTok yêu cầu luồng OAuth (ủy quyền App truy cập Advertiser của bạn).
   App này không có server để nhận callback OAuth, nên cách đơn giản nhất cho một người bán dùng
   một mình là xin cấp quyền App truy cập trực tiếp Advertiser ID của bạn trong phần quản lý App
   (TikTok gọi là "Authorized Advertiser"), sau đó lấy Access Token qua bước ủy quyền một lần.
   Bước này TikTok có thể thay đổi cách làm theo thời gian — luôn theo hướng dẫn mới nhất tại
   trang Developer Portal.
4. **Advertiser ID**: vào TikTok Ads Manager → biểu tượng tài khoản → "Advertiser ID" (dãy số).
5. Trong LIVE STUDIO: tab Quảng cáo → thẻ TikTok → "Kết nối" → nhập Access Token + Advertiser ID
   → Lưu → "Kiểm tra kết nối".

## 2. Meta Marketing API (Facebook/Instagram)

1. Vào <https://developers.facebook.com/apps/>, tạo App mới, loại **Business**.
2. Trong App, thêm sản phẩm **Marketing API**.
3. Cách lấy token ổn định nhất cho một người dùng một mình là qua **System User**:
   Business Settings → Users → System Users → tạo một System User → Add Assets → gán tài khoản
   quảng cáo (Ad Account) của bạn với quyền `ads_management` → "Generate New Token" → chọn App ở
   bước 2, chọn quyền `ads_management`, `ads_read` → token sinh ra không có hạn tự hết (trừ khi
   bạn thu hồi).
4. Quảng cáo ở quy mô lớn cần **xác minh doanh nghiệp (Business Verification)** mới được Meta
   duyệt quyền `ads_management` cho mọi tài khoản; quy mô nhỏ/tài khoản của chính bạn thường dùng
   được ngay ở chế độ phát triển (Development Mode) mà không cần duyệt công khai.
5. **Ad Account ID**: Ads Manager → góc trên bên phải, dạng số (vào `act_123456789` thì chỉ cần
   nhập phần số, app tự thêm `act_`).
6. Trong LIVE STUDIO: thẻ Meta → "Kết nối" → nhập Access Token + Ad Account ID → Lưu → "Kiểm tra
   kết nối".

## 3. Google Ads API

Phần phức tạp nhất vì Google dùng OAuth2 đầy đủ cộng Developer Token riêng.

1. **Developer Token**: vào <https://ads.google.com/aw/apicenter> (cần một tài khoản Google Ads
   đang hoạt động) → xin Developer Token. Token mới luôn ở mức **Test Account** (chỉ gọi được với
   tài khoản thử), muốn dùng với tài khoản Ads thật phải gửi đơn xin lên mức **Basic/Standard**
   (Google duyệt, có thể mất vài ngày).
2. **OAuth Client ID/Secret**: vào Google Cloud Console → tạo project (hoặc dùng project có sẵn)
   → bật **Google Ads API** (APIs & Services → Library) → Credentials → Create Credentials →
   OAuth client ID → loại "Desktop app" → lấy Client ID và Client Secret.
3. **Refresh Token**: cần ủy quyền một lần cho OAuth Client ở bước 2 truy cập Google Ads, phạm vi
   `https://www.googleapis.com/auth/adwords`. Cách đơn giản nhất là dùng
   [Google OAuth 2.0 Playground](https://developers.google.com/oauthplayground): ở bánh răng cài
   đặt, tick "Use your own OAuth credentials", dán Client ID/Secret ở bước 2, chọn scope
   `https://www.googleapis.com/auth/adwords`, đăng nhập bằng tài khoản Google quản lý Ads của bạn,
   bước cuối "Exchange authorization code for tokens" sẽ cho ra **Refresh Token** — token này
   dùng lâu dài, app tự đổi thành Access Token ngắn hạn mỗi lần gọi.
4. **Customer ID**: mã tài khoản Google Ads (10 chữ số, có thể có gạch ngang như `123-456-7890` —
   nhập sao cũng được, app tự bỏ dấu gạch).
5. Trong LIVE STUDIO: thẻ Google → "Kết nối" → nhập đủ 5 trường (Developer Token, Client ID,
   Client Secret, Refresh Token, Customer ID) → Lưu → "Kiểm tra kết nối".

## Xử lý lỗi khi "Kiểm tra kết nối" báo lỗi

| Mã lỗi | Nghĩa là gì | Nên làm gì |
|---|---|---|
| Chưa nhập đủ thông tin API | Thiếu một trường bắt buộc | Mở "Kết nối" và nhập đủ các trường |
| Nền tảng từ chối khóa API hoặc token đã hết hạn | Token sai, hết hạn, hoặc App chưa được gán quyền vào đúng tài khoản | Tạo lại token theo đúng bước ở trên; với Meta kiểm tra System User còn quyền `ads_management` trên đúng Ad Account |
| Nền tảng tạm chặn do gọi quá nhiều | Giới hạn tốc độ gọi API (rate limit) | Thử lại sau vài phút |
| Không kết nối được tới nền tảng | Mạng hoặc tường lửa chặn | Kiểm tra Internet, thử lại |
| Nền tảng trả lời nhưng không đọc được dữ liệu | Định dạng trả về khác với app mong đợi — có thể nền tảng đã đổi API | Báo lại cho người phát triển app kèm thời điểm xảy ra |

## Vì sao chưa có nút "Tạo chiến dịch mới"

Tạo một chiến dịch quảng cáo thật (chọn ngân sách, đối tượng, vị trí hiển thị, nội dung) là hành
động trực tiếp tốn tiền thật và rất khác nhau giữa ba nền tảng. Việc này cần được thiết kế và
kiểm thử riêng, kỹ hơn nhiều so với việc chỉ đọc số liệu hoặc tắt/mở một chiến dịch đã có — nên
chủ động để lại cho một lần làm sau, thay vì làm vội mà rủi ro tạo quảng cáo sai ý người bán.
