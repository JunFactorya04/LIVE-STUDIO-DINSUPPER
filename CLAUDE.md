# LIVE STUDIO: notes for Claude

Tauri 2 desktop app (macOS + Windows) plus a phone UI served over the sharing link. React + TS
frontend in `src/`, Rust backend in `src-tauri/src/`. The owner speaks Vietnamese; answer in Vietnamese.

## Working rules (owner's standing instructions)

- Fix, test and **commit locally**. **Push to GitHub and create a release only when the owner says OK.**
  A stop hook asks to push unpushed commits; decline it until the owner says OK.
- Releases are **Mac only** for now (Windows is not needed yet). Before running CI, ask whether there
  is anything else to bundle into the same release.
- UI follows the Apple (macOS/iOS) standard (`apple-ui-standard` skill). Vietnamese is the default
  language; every string exists in both `src/i18n/vi.ts` and `src/i18n/zh-TW.ts` (`Messages = typeof zhTW`;
  a test checks the keys match).
- Surgical changes (karpathy-guidelines): touch only what the request needs.

## Checks and release

- `npm run check` = typecheck, lint, prettier check, vitest. Run `npx prettier --write src` first.
- Rust: `cd src-tauri && cargo fmt && cargo test`. `cargo clippy -D warnings` already fails on old code;
  only make sure new code adds no new warnings.
- Mac release: commit `Release: Mac build [skip ci]`, `git push origin main`, then
  `gh api -X POST repos/JunFactorya04/LIVE-STUDIO-DINSUPPER/actions/workflows/build.yml/dispatches -f ref=main -f "inputs[platforms]=mac"`
  (`platforms` = both / mac / windows). Follow the run with `gh api repos/.../actions/runs/<id>`.
  GraphQL `gh` commands (`gh run list`, `gh release list`, `gh release download`) are blocked here; use REST
  (`gh api repos/.../releases?per_page=1`). If the macOS job is "cancelled" because the hosted runner was
  not acquired, it is GitHub capacity: `POST .../actions/runs/<id>/rerun-failed-jobs`.

## Phone UI (sharing link, `isRemote()`)

- Phone pages: home, scan, settings (language/theme); tab bar = home, orders, scan (centre), ship, More.
- Phone CSS lives at the end of `src/theme/native.css` (loaded last). The owner wants phone screens
  **dense**: narrow side margins (~16px total to text), one-line header (title + status chip, no subtitle),
  compact cards (orders = 3-line cards, console stats as one tile row), small 36px buttons inside cards,
  no long notices on phone (`hide-phone`). The tab bar is **docked to the bottom edge** (z-index 40), never floating.
- `.page-enter` animation must keep `animation-fill-mode: backwards`; a forwards fill leaves a transform
  that pins `position: fixed` children (camera, sheets) inside the page.
- Screenshot check without a device: render with vitest + jsdom, dump `container.innerHTML`, wrap it with
  tokens/base/live/native CSS, shoot it with Playwright (Chromium preinstalled) at 390x844. Delete the temp test.

## Browser tab and outside sites

- `src-tauri/src/webview_tab.rs`: one child webview. Desktop layout by default; wide pages are scaled to
  fit by a fixed init script (`FIT_WIDTH_JS`), with − / + zoom (`browser_zoom`). App/store links are blocked.
- TikTok opens in the seller's own Chrome/Edge by default (`src/browser/route.ts` DEFAULT_MODE): inside
  the webview TikTok returns 403 and puzzle checks, and its mobile web has no Message button. Never try to
  bypass TikTok's checks.
- 7-ELEVEN store data (`ship_store_*` commands):
  - `mobilemap/Id/Data.aspx` searchKey finds only a **complete 6-digit store number**.
  - `EMapSDK.aspx` `commandid=SearchStore` takes city+town(+roadname) or `StoreName` (part of a name works).
  - `commandid=SearchRoad` with city+town lists roads.
  - A partial number is matched only against stores already known locally (`ship_stores` table, `ship_store_prefix`).
  - Address text is split into city/district/road by `src/ship/storeAddress.ts`.
- New Tauri commands the phone must reach also go into `share.rs` (ALLOWED list + dispatch).
