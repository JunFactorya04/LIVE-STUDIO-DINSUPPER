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

## 2b. Chạy bằng một cú nhấp đúp

Sau khi clone (hoặc `git pull`) có sẵn hai file ở thư mục gốc:

- **Windows:** nhấp đúp `Chay-LIVE-STUDIO.bat`
- **Mac:** nhấp đúp `Chay-LIVE-STUDIO.command`

File sẽ kiểm tra Node, Rust (và Xcode CLT trên Mac), kéo bản mới từ GitHub, cài thư viện rồi mở app. Lần đầu mất vài phút vì biên dịch Rust. Nếu thiếu công cụ, nó nói rõ thiếu gì và dừng lại.
Mac: nếu nhấp đúp không chạy, mở Terminal một lần: `chmod +x Chay-LIVE-STUDIO.command`.

Muốn tạo bộ cài để cài như app thường: `npm run tauri:build` (kết quả trong `src-tauri/target/release/bundle`).

## 2b-1. Máy mới chưa có gì: chạy một file là đủ

Sau `git clone`, nhấp đúp `Cai-dat-LIVE-STUDIO.bat` (Windows) hoặc `Cai-dat-LIVE-STUDIO.command` (Mac). File tự cài phần còn thiếu: Git, Node.js, Rust, Microsoft C++ Build Tools (Windows, dùng winget) hoặc Xcode Command Line Tools, Homebrew, Node, Rust (Mac). Cái nào đã có thì bỏ qua. Cài xong mở cửa sổ mới rồi nhấp đúp `Chay-LIVE-STUDIO`. `Chay-LIVE-STUDIO` cũng tự gọi file cài đặt nếu thấy thiếu Node hoặc Rust. Chưa thử trên máy Windows/Mac sạch thật; Windows sẽ hỏi quyền quản trị khi cài C++ Build Tools. Muốn không cài gì: dùng file .exe tạo sẵn (mục 2c).

## 2c. File .exe cho Windows

Có hai cách để có file chạy luôn, không cần mở terminal:

1. **Tải từ GitHub (không cần cài gì):** trên GitHub vào tab **Actions**, chọn lần chạy "Build" mới nhất, mục **Artifacts** tải `LIVE-STUDIO-windows-exe`. Trong đó có `LIVE-STUDIO.exe` (nhấp đúp là chạy) và `LIVE STUDIO_..._x64-setup.exe` (bộ cài, cài cho người dùng hiện tại, không cần quyền admin). Muốn có trang tải cố định: tạo tag `v0.1.0` (`git tag v0.1.0 && git push origin v0.1.0`), hai file này sẽ nằm ở **Releases**.
2. **Tự tạo trên máy Windows:** nhấp đúp `Build-LIVE-STUDIO-WINDOWS.bat` (cần Node, Rust và Microsoft C++ Build Tools). Lần đầu 10–20 phút; kết quả trong thư mục `release-exe`.

`LIVE-STUDIO.exe` cần WebView2 (Windows 10/11 đã có sẵn). Windows SmartScreen có thể cảnh báo "unknown publisher" vì file chưa ký số: bấm **More info → Run anyway**. Ký số cần chứng chỉ code signing, chưa có.

## 2d. Xử lý sự cố thường gặp

| Hiện tượng | Nguyên nhân và cách xử lý |
| --- | --- |
| GitHub Actions báo "account is locked due to a billing issue", job thất bại sau vài giây | Tài khoản GitHub bị khóa vì thanh toán, không phải lỗi code. Vào Settings → Billing and plans xử lý, rồi Actions → Re-run all jobs. Trong lúc chờ vẫn chạy được bằng file `Chay-LIVE-STUDIO` hoặc `Build-LIVE-STUDIO-WINDOWS.bat`. |
| Báo cáo, xuất, sao lưu, xóa nói "chỉ dùng được trong app desktop" | Đang mở bằng `npm run dev` trên trình duyệt. Dùng `npm run tauri:dev` hoặc file .exe/.app. |
| Không lưu được khóa API | Keychain (Mac) hoặc Credential Manager (Windows) bị khóa hoặc bị chặn; mở khóa rồi thử lại. App không ghi khóa ra file. |
| AI báo AUTH / QUOTA / RATE_LIMIT / TIMEOUT | Khóa sai, hết hạn mức, gọi quá nhanh, hoặc mạng chậm. Xem Cài đặt → AI → Kiểm tra kết nối. Tên model mặc định chưa được kiểm chứng; có thể đổi ở ô Model. |
| Overlay không hiện trong phần mềm phát | Dán đúng địa chỉ ở trang Overlay vào Browser Source; cổng 17891 bị chiếm thì app dùng cổng kế tiếp và địa chỉ trên trang sẽ đổi. |
| Không thấy file xuất | Nằm trong thư mục Tải xuống (đường dẫn hiện ngay sau khi xuất). Nếu không có thư mục này app dùng thư mục dữ liệu của app. |
| In thử báo UNREACHABLE / TIMEOUT | Máy in và máy tính phải cùng mạng; kiểm tra IP trên tem hoặc trang tự in của máy in, cổng thường là 9100. Máy in chỉ dùng ZPL/TSPL (tem vận chuyển) có thể không nhận ESC/POS. |
| Windows SmartScreen cảnh báo | File chưa ký số: More info → Run anyway. |

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
