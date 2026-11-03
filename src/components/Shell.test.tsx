// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider } from "../i18n";
import { zhTW } from "../i18n/zh-TW";
import { LiveSessionStore } from "../live/sessionStore";
import { LiveSessionProvider } from "../live/useLiveSession";
import type { PageId } from "../navigation";
import { TabBar } from "./Shell";

afterEach(cleanup);

function Harness() {
  const [page, setPage] = useState<PageId>("orders");
  return (
    <>
      <p data-testid="page">{page}</p>
      <TabBar current={page} onSelect={setPage} />
    </>
  );
}

describe("TabBar More menu", () => {
  it("closes on a tap outside it and when the page changes", () => {
    render(
      <I18nProvider initial="zh-TW">
        <LiveSessionProvider store={new LiveSessionStore()}>
          <Harness />
        </LiveSessionProvider>
      </I18nProvider>,
    );
    const more = screen.getByRole("button", { name: new RegExp(zhTW.nav.more) });
    fireEvent.click(more);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(screen.getByTestId("page"));
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(more);
    fireEvent.click(screen.getAllByRole("menuitem")[0]);
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(more);
    // another tab: the menu does not stay over the next screen
    fireEvent.click(
      screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-current") !== "page" && b !== more)!,
    );
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
