// Single source of UI language: Vietnamese.
// All visible text lives here so the whole app stays in one language and can
// be translated later by adding another file with the same shape.

export const vi = {
  app: {
    name: "LIVE STUDIO",
  },
  nav: {
    dashboard: "Tổng quan",
    live: "Phát trực tiếp",
    platforms: "Đa nền tảng",
    content: "Nội dung",
    schedule: "Lịch đăng",
    settings: "Cài đặt",
    sectionMain: "Làm việc",
    sectionManage: "Quản lý",
  },
  common: {
    search: "Tìm kiếm",
    add: "Thêm",
    save: "Lưu",
    cancel: "Hủy",
    confirm: "Xác nhận",
    delete: "Xóa",
    close: "Đóng",
    retry: "Thử lại",
    loading: "Đang tải…",
  },
  states: {
    emptyTitle: "Chưa có dữ liệu",
    emptyHint: "Thêm mục đầu tiên để bắt đầu.",
    errorTitle: "Không tải được dữ liệu",
    errorHint: "Kiểm tra kết nối rồi thử lại.",
  },
  pages: {
    dashboard: { title: "Tổng quan", subtitle: "Hôm nay" },
    live: { title: "Phát trực tiếp", subtitle: "Chưa có phiên nào" },
    platforms: { title: "Đa nền tảng", subtitle: "Kết nối tài khoản" },
    content: { title: "Nội dung", subtitle: "Thư viện" },
    schedule: { title: "Lịch đăng", subtitle: "Sắp tới" },
    settings: { title: "Cài đặt", subtitle: "Ứng dụng" },
  },
  inspector: {
    empty: "Chọn một mục để xem chi tiết",
  },
} as const;

export type Messages = typeof vi;
