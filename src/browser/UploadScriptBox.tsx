import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { invoke } from "../platform/backend";

// Dev box in the Browser tab: a script the seller (or a developer helping them) keeps here and
// runs on the MyShip page that is open, with the Excel file exported last from "Đơn ship" ready to
// put into the page's file picker. The app only runs it when asked, and only on 7-ELEVEN pages
// (webview_tab.rs browser_run_script); MyShip's own buttons decide what happens after.

const KEY = "live-studio.myship-upload-script";

export const DEFAULT_UPLOAD_SCRIPT = `// Chạy trên trang 訂單匯入: https://myship.7-11.com.tw/seller/order (đã đăng nhập).
// __LS.file        file Excel vừa xuất ở "Đơn ship" (tên: __LS.file.name)
// __LS.attach(sel) gắn file vào ô chọn file của trang, trả về true nếu được
// __LS.click(/chữ/) bấm nút có chữ khớp; __LS.wait(ms) chờ; __LS.log(...) hiện ghi chú
if (!__LS.attach('input[type="file"]')) {
  __LS.log("Không thấy ô chọn file trên trang này. Mở trang 訂單匯入 rồi chạy lại.");
  return;
}
__LS.log("Đã gắn file " + __LS.file.name);
// Bước tiếp theo tùy nút trên trang. Bỏ dấu // để script tự bấm:
// await __LS.wait(800);
// if (__LS.click(/驗證|檢核/)) __LS.log("Đã bấm kiểm tra");
// await __LS.wait(1500);
// if (__LS.click(/確認匯入|匯入|上傳/)) __LS.log("Đã bấm nhập đơn");
`;

function load(): string {
  try {
    return localStorage.getItem(KEY) ?? DEFAULT_UPLOAD_SCRIPT;
  } catch {
    return DEFAULT_UPLOAD_SCRIPT;
  }
}

export function UploadScriptBox({
  pageOpen,
  describeError,
}: {
  pageOpen: boolean;
  describeError: (code: unknown) => string;
}) {
  const { t, fmt } = useI18n();
  const d = t.browser.dev;
  const [script, setScript] = useState(load);
  const [attach, setAttach] = useState(true);
  const [file, setFile] = useState<string | null>();
  const [note, setNote] = useState<{ text: string; error: boolean }>();

  const refreshFile = () =>
    void invoke<string | null>("browser_last_export").then(setFile, () => setFile(null));
  useEffect(refreshFile, []);

  const save = (v: string) => {
    setScript(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // kept for this run only
    }
  };

  const run = async () => {
    setNote(undefined);
    try {
      await invoke("browser_run_script", { script, attach });
      setNote({ text: d.ran, error: false });
    } catch (e) {
      setNote({ text: describeError(e), error: true });
    }
  };

  return (
    <details className="browser__dev" onToggle={refreshFile}>
      <summary>{d.title}</summary>
      <p className="caption">{d.help}</p>
      <textarea
        className="input input--area mono"
        rows={10}
        spellCheck={false}
        aria-label={d.title}
        value={script}
        onChange={(e) => save(e.target.value)}
      />
      <div className="actions">
        <label className="browser__mobile">
          <input type="checkbox" checked={attach} onChange={() => setAttach((a) => !a)} />
          {file ? fmt(d.attach, { name: file }) : d.noFile}
        </label>
        <span className="toolbar__spacer" />
        <button type="button" className="btn" onClick={() => save(DEFAULT_UPLOAD_SCRIPT)}>
          {d.reset}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!pageOpen || (attach && !file)}
          onClick={() => void run()}
        >
          {d.run}
        </button>
      </div>
      {note && (
        <p className={`caption${note.error ? " note--error" : ""}`} role="status">
          {note.text}
        </p>
      )}
    </details>
  );
}
