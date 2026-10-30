import React from "react";
import ReactDOM from "react-dom/client";
import "./theme/tokens.css";
import "./theme/base.css";
import "./theme/live.css";
import { App } from "./App";
import { I18nProvider } from "./i18n";
import { LiveSessionProvider } from "./live/useLiveSession";
import { createReportClient } from "./report/client";
import { runRetention } from "./report/retention";

// Old sessions are removed before the last one is loaded, so the app never restores a deleted one.
void runRetention(createReportClient()).finally(() => {
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
