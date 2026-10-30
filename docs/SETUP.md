# Cài đặt và đồng bộ giữa Windows và Mac

Repo GitHub là nguồn duy nhất. Code trên Windows và Mac đều được đẩy lên và kéo về qua GitHub.

Repo: https://github.com/JunFactorya04/LIVE-STUDIO-DINSUPPER

## 1. Cài công cụ (chỉ làm một lần mỗi máy)

**Chung:** Git, Node.js 20+, Rust (qua rustup).

**Mac:**
```bash
xcode-select --install
```

**Windows:** cài Microsoft C++ Build Tools (chọn "Desktop development with C++") và WebView2 (Windows 10/11 thường có sẵn).

## 2. Clone về máy

**Mac** (thư mục ví dụ `~/Developer`):
```bash
cd ~/Developer
git clone https://github.com/JunFactorya04/LIVE-STUDIO-DINSUPPER "LIVE STUDIO"
cd "LIVE STUDIO"
npm install
npm run tauri:dev
```

**Windows** (thư mục `C:\Users\nt.huan\Desktop\J\LIVE STUDIO` đã clone sẵn):
```powershell
cd "C:\Users\nt.huan\Desktop\J\LIVE STUDIO"
git config core.autocrlf true
npm install
npm run tauri:dev
```

## 3. Quy trình làm việc hằng ngày

Trước khi bắt đầu code, lấy bản mới nhất:
```bash
git pull
```

Khi xong một phần việc:
```bash
git add -A
git commit -m "Mô tả ngắn gọn thay đổi"
git push
```

Trên máy còn lại, chạy `git pull` trước khi code tiếp.

## 4. Quy tắc tránh xung đột

- Mỗi lần chuyển máy, luôn `git pull` trước và `git push` sau.
- Không sửa cùng một file trên hai máy cùng lúc. Nếu có, `git pull` sẽ báo xung đột; giải quyết trước khi code tiếp.
- Không commit thư mục `node_modules/`, `dist/`, `src-tauri/target/`. File `.gitignore` đã loại trừ các thư mục này.
- `package-lock.json` và `src-tauri/Cargo.lock` nên được commit để hai máy dùng cùng phiên bản thư viện.

## 5. Lưu ý riêng cho Windows

- Git trên Windows tự đổi xuống dòng (CRLF). Lệnh `git config core.autocrlf true` ở bước 2 đã xử lý việc này; cảnh báo "LF will be replaced by CRLF" là bình thường.
- Nếu git báo lỗi `File exists` cho file `.lock` trong thư mục `.git`, xóa file `.lock` đó rồi chạy lại lệnh.

## 6. Kiểm tra nhanh sau khi clone

```bash
npm run build          # phải thành công
cd src-tauri && cargo check   # phải thành công
```

## 7. Graphify: bản đồ tri thức của dự án

Graphify tạo bản đồ quan hệ giữa các file, hàm và module để hỏi nhanh thay vì đọc hết mã. Ưu tiên dùng Graphify trước khi tìm kiếm thủ công.

**Cài một lần mỗi máy** (cần Python 3.10+ và uv):
```bash
uv tool install graphifyy
graphify install        # đăng ký skill /graphify cho trợ lý AI
```

**Tạo hoặc cập nhật bản đồ** (chạy ở thư mục gốc dự án, không cần LLM với code):
```bash
graphify update .
```

**Truy vấn:**
```bash
graphify query "câu hỏi"         # tìm nhánh liên quan đến câu hỏi
graphify explain "TênHàm"        # giải thích một nút và các kết nối
graphify path "A" "B"            # đường đi ngắn nhất giữa hai nút
graphify god-nodes --top 10      # các nút trung tâm nhất
```

Kết quả nằm trong `graphify-out/` (`graph.html`, `GRAPH_REPORT.md`, `graph.json`). Thư mục này không được commit; sau khi `git pull` trên máy khác, chạy lại `graphify update .` để tạo bản đồ cho máy đó.
