import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";

// One field for scanning. A USB or Bluetooth barcode scanner types the code and presses Enter,
// so it works here untouched; the code can also be typed by hand. Focus returns to the field
// after every scan so the next code can follow at once.

export function ScanBox({
  onScan,
  placeholder,
  label,
  extra,
}: {
  onScan: (code: string) => void;
  placeholder: string;
  label: string;
  /** For example the camera button. */
  extra?: ReactNode;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = value.trim();
    if (!code) return;
    setValue("");
    onScan(code);
    ref.current?.focus();
  };
  return (
    <form className="scanbox" onSubmit={submit}>
      <input
        ref={ref}
        className="input scanbox__input"
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        inputMode="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="btn btn--primary">
        OK
      </button>
      {extra}
    </form>
  );
}
