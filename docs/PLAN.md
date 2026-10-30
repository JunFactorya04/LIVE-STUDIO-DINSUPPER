# Kế hoạch LIVE STUDIO

Tài liệu chi tiết tính năng sẽ được bổ sung từ file `.md` của chủ dự án.
Phần dưới là khung ban đầu, sẽ cập nhật khi có yêu cầu chi tiết.

## Giai đoạn 1 — Nền tảng (hoàn thành)

- [x] Repo GitHub, cấu trúc Tauri 2 + React + TypeScript
- [x] Token thiết kế chuẩn Apple, sáng/tối
- [x] Vỏ ứng dụng: sidebar, toolbar, tab bar trên điện thoại
- [x] Chuỗi giao diện tiếng Việt tập trung
- [x] Trạng thái trống, đang tải, lỗi dùng chung
- [x] Build được cho macOS và Windows (CI)

## Giai đoạn 2 — Quản lý nội dung (chờ chi tiết)

- Thư viện nội dung: video, ảnh, tệp, thẻ phân loại
- Tìm kiếm, lọc, sắp xếp; bảng dữ liệu với inspector

## Giai đoạn 3 — Đa nền tảng (chờ chi tiết)

- Kết nối tài khoản các nền tảng live
- Đăng lịch và theo dõi trạng thái phát

## Giai đoạn 4 — Phát trực tiếp (chờ chi tiết)

- Quản lý phiên live, chỉ số theo thời gian thực

## Câu hỏi cần chốt

1. Danh sách nền tảng live cần hỗ trợ (YouTube, TikTok, Facebook, …)?
2. Dữ liệu lưu cục bộ hay đồng bộ đám mây?
3. Có cần đăng nhập/nhiều tài khoản không?
