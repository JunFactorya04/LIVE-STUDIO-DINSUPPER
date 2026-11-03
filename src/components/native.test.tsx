// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Sheet, useConfirm } from "./Sheet";
import { ToastHost, toast } from "./Toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Opener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        open
      </button>
      {open && (
        <Sheet title="Tem" closeLabel="Đóng" onClose={() => setOpen(false)}>
          <input aria-label="inside" />
        </Sheet>
      )}
    </>
  );
}

describe("Sheet", () => {
  it("takes focus, closes on Esc with a short fade, and gives focus back", async () => {
    render(<Opener />);
    const opener = screen.getByRole("button", { name: "open" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Tem" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(screen.getByLabelText("inside"), { key: "Escape" });
    expect(dialog.closest(".sheet-scrim")).toHaveClass("is-leaving");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("asks a question and answers it", async () => {
    let answer: Promise<boolean> | undefined;
    function Asker() {
      const [node, ask] = useConfirm();
      return (
        <>
          {node}
          <button
            type="button"
            onClick={() => (answer = ask({ title: "Tạo thật?", ok: "Tạo", cancel: "Hủy" }))}
          >
            go
          </button>
        </>
      );
    }
    render(<Asker />);
    fireEvent.click(screen.getByRole("button", { name: "go" }));
    expect(screen.getByRole("alertdialog", { name: "Tạo thật?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tạo" }));
    await expect(answer).resolves.toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("toast", () => {
  it("says nothing without a toast area, so the page keeps its own message", () => {
    expect(toast("Đã in")).toBe(false);
  });

  it("shows, folds a repeat into one, and goes away by itself", () => {
    vi.useFakeTimers();
    render(<ToastHost closeLabel="Đóng" />);
    act(() => {
      expect(toast("Đã in 3 tem")).toBe(true);
      toast("Đã in 3 tem");
    });
    expect(screen.getAllByText("Đã in 3 tem")).toHaveLength(1);
    let ran = false;
    act(() => {
      toast("Đã lưu file", { action: { label: "Xem file", run: () => (ran = true) } });
    });
    fireEvent.click(screen.getByRole("button", { name: "Xem file" }));
    expect(ran).toBe(true);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText("Đã in 3 tem")).toBeNull();
  });
});
