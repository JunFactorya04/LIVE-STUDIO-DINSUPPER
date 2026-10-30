import React from "react";
import ReactDOM from "react-dom/client";
import "./theme/tokens.css";
import "./theme/base.css";
import "./theme/live.css";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { LiveSessionProvider } from "./live/useLiveSession";
import { createReportClient } from "./report/client";
import { isRemote } from "./platform/backend";
import { runRetention } from "./report/retention";
import { adoptComputerPrinter } from "./share/client";

// iOS Safari ignores user-scalable=no: stop the pinch gesture and the double-tap zoom explicitly.
for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(type, (e) => e.preventDefault());
}
let lastTouchEnd = 0;
document.addEventListener(
  "touchend",
  (e) => {
    const now = Date.now();
    if (now - lastTouchEnd < 300) e.preventDefault();
    lastTouchEnd = now;
  },
  { passive: false },
);

// Old sessions are removed before the last one is loaded, so the app never restores a deleted one.
// A phone never deletes old sessions (the computer does that); it only picks up the printer.
const boot = isRemote() ? adoptComputerPrinter() : runRetention(createReportClient());
void boot.finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <I18nProvider>
        <LiveSessionProvider>
          <App />
        </LiveSessionProvider>
      </I18nProvider>
    </React.StrictMode>,
  );
});
