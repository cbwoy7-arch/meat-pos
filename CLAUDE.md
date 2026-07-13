# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An offline-first point-of-sale PWA for a Zimbabwean butchery (Jack's Meat Centre). Sales are rung up by weight, with a full back office: goods-in, two-location stock (freezer → chiller), carcass cutting, daily open/close rituals, supplier and debtor credit books, cash book envelopes, reports/P&L, and a month-end CSV archive. It runs on one Android phone/tablet as the shop's system of record.

**The entire app lives in `index.html`** (~3,200 lines: CSS in one `<style>` block, all JS in one `<script>` block). There is no build step, no framework, no npm, no dependencies, no test suite, and no linter — deliberately. `sw.js` is the offline cache, `manifest.json` + icons are the Android install identity. `README.md` is the owner-facing manual and the authoritative feature spec.

## Development workflow

- **Run it:** open `index.html` in a browser (`python3 -m http.server` if you need the service worker active). No build.
- **Verify changes manually** — there are no tests. Exercise the affected flow in the browser; the sell flow and back office are all reachable from a fresh page (owner PIN `2026`, supervisor PIN `1234`).
- **Bump the service-worker cache version on every change to `index.html`** — increment `CACHE = 'meat-pos-vNN'` in `sw.js`. Every commit in history does this; installed phones only pick up a new version when the cache name changes.
- **Update `README.md` in the same change** when behaviour visible to the shop changes. The README is written for the shop owner, in the same voice — full sentences, concrete examples, the "why" behind each control.
- Deployment is GitHub Pages from `main`; users install it via Chrome's Add to Home screen (or a PWABuilder APK). Nothing else to deploy.

## Architecture

### State and persistence

All state is module-level `let` arrays/objects near the top of the `<script>` (`products`, `sales`, `deliveries`, `suppliers`, `payments`, `closes`, `opens`, `batches`, `adjustments`, `debtors`, `debtorPays`, `cashbook`, `envs`, `audit`, `shop`). Each persists to `localStorage` under an `mc_*` key:

- `load(k, d)` reads one key with a default; the single `save()` function writes them all (and triggers `syncPush()` + `maybeCloudBackup()`). Call `save()` after any mutation that must survive a reload.
- **Schema migrations happen in-place at load time**, right where each array is loaded — loop over old records and backfill new fields with defaults (see the `products` and `deliveries` migration loops). Never require users to reset data.
- `shop` holds all settings (PIN-adjacent config, tolerances, overheads, expense categories, printer, sync URL) and has its own `saveShop()`.

### Rendering

No virtual DOM — the app re-renders whole screens as HTML strings:

- `render()` is the single entry point; it routes on `tab` ('sell' | 'office'), `view`, and `office` (which back-office screen) and sets `#main.innerHTML` from view functions (`catsView()`, `chargeView()`, `reportsView()`, …).
- Event handlers are inline `onclick="..."` attributes calling global functions, usually mutating state then calling `render()`.
- **Always pass user-entered strings through `esc()`** when interpolating into HTML.
- Charts are hand-built inline SVG — no chart libraries.
- The file is organised by `// ---------------- SECTION ----------------` comment banners (data, SELL, receipts, BACK OFFICE, CUTTING, START OF DAY, DAILY CLOSE, supplier accounts, debtors, CASH BOOK, month-end, live view, cloud backup, …). Keep new code inside the right section and add a banner for a new module.

### Hard rules the code enforces (don't break these)

- **No browser popups** — never use `alert`/`confirm`/`prompt`; they don't work in the Android APK WebView. Use `pinAsk()`, the custom confirm modal, and `toast(msg, bad)`.
- **Two roles by PIN:** owner (`mc_pin`, default 2026) and supervisor (`mc_pin_sup`, default 1234). `canSee(office)` hides `reports`, `settings`, `audit`, `cashbook` from the supervisor. Credit sales (ON ACCOUNT) accept only the owner PIN and log refused supervisor attempts.
- **Append-only audit trail:** every sensitive action (deliveries, payments, stock adjustments, price/cost edits, voids, restores) calls `logAudit(type, detail, who)`. Records are struck through on void, never deleted.
- **Two stock locations:** `p.freezer` (main store, where deliveries land) and `p.chiller` (sales counter, the only pool selling and the daily Close touch). Carcass lines are `p.raw === true`, live only in the freezer, and must never appear on the sell screen, in issue-to-chiller, or in the chiller close count.
- **Locked records:** closes, opens, and cash-book collections lock permanently once saved; the close resets the chiller to counted figures ("physical truth wins").
- **Money is `round2`, weights are `round3`;** format currency with `fmt()`. Sell price convention: cost × 1.38.
- **Blind counts stay blind** — the Close and freezer stock-take must not reveal expected figures until after the count is saved.

### Live view / cloud

`?view` in the URL switches the whole app into a read-only owner dashboard (`viewMode`), which renders via `viewRender()` and reuses the till's own report code. The till pushes to a user-configured Firebase Realtime Database URL (`shop.sync`): `…/live` (dashboard feed), `…/data` (last 45 days of records), `…/backup` (weekly rotating full backups). One-way only: the till writes, viewers never write back. All of it is optional — the app must work fully with `shop.sync` empty.

## Conventions

- Vanilla ES in one script; short helper names (`fmt`, `esc`, `today`, `cats`); comments explain business "why", not mechanics — match that density and voice.
- Commit messages are imperative and user-facing ("Add the Cash Book: …", "Fix carcass lines vanishing after reload — seed was never persisted"); features have landed via PRs to `main`.
- Seed data changes need a versioned guard flag persisted immediately (see the `mc_rawSeeded` pattern and its comment about the v1 bug) — `save()` is not called on boot.
- Month-end pruning must never delete: products, current stock, the audit log, envelope balances, unpaid debtor sales, or the newest close.
