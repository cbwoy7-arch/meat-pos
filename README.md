# Meat Centre POS — own-build, offline, free

No dependencies, no subscription, no account. All data stays on the device.
Loyverse-style look: charcoal header, green charge button, colour-coded categories.

Files: `index.html` (the whole app) · `sw.js` (offline cache) · `manifest.json` +
`icon-192.png` / `icon-512.png` (Android install identity).

## How selling works

1. Opens on **category tiles** — Beef, Chicken, Pork, Processed (tiles appear/disappear
   automatically as you add categories in the back office).
2. Tap a category → its items with prices → tap an item → enter **weight** or **$ amount**
   (converts both ways at the set price).
3. Keep tapping items — every line lands on the same ticket (use ‹ back to switch
   categories). Green **CHARGE** bar shows the running ticket. Tap it → review lines →
   take payment: **CASH**, **ECOCASH**, or **SWIPE** (card machine).
4. Green **✓ confirmation screen** with the amount and payment method (plus a beep and
   vibration on the phone) and a **PRINT RECEIPT** button, then back to categories for
   the next customer. One ticket = one sale = one receipt, however many items are on it.

## Back office (the backend)

Bottom-right tab, guarded by an on-screen **PIN pad** (default PIN **2026** — change it in
Settings on day one). No browser pop-ups are used anywhere, so everything works inside an
Android app shell.

- **Reports** — any date range: total / cash / EcoCash / swipe split, plus **restock
  value** (what the goods sold cost to replace), **gross profit** and **margin %**;
  sales-by-item in kg, $ and profit; individual sales with **VOID** (voids stay on
  record, struck through — audit trail, never deletion). **Copy** gives a paste-ready
  summary; **CSV** exports per-day per-product figures including cost and profit.
  Then the **Day P&L**: gross profit less a daily share of the monthly overheads
  (set in Settings, absorbed per working day — closed days still carry overhead),
  less **cash expenses** (money paid out of the till, captured at the close) and
  **write-offs / waste at cost** (spoilage and downward stock corrections) =
  **net operating profit**, plus the **break-even sales/day** figure and, while the
  loan runs, an **"after loan"** line (financing shown separately, never mixed into
  operating profit). A per-day table shows every trading day's sales, GP, overhead
  and net — loss-making days go red.
  Below that sits the **controls dashboard** for the same date range:
  till gap across the closes, missing stock at retail, cutting yield and waste,
  cutting uplift, what's owing to suppliers right now, and the single number that
  matters — **Leakage** (missing stock + till shortfall), red whenever it isn't zero.
- **Goods In** — every delivery is received here: supplier, item, **invoiced qty vs
  your own scale's weighed qty**, cost per unit, paid or on account. The weighed qty
  goes into the **freezer** (main store) automatically and the item's cost price updates;
  you pay on the invoiced qty, and any shortage shows red — claim it from the supplier.
  Unpaid deliveries roll into an **Owing to suppliers** list (your creditors, live).
- **Stock — two locations: freezer → chiller.** Stock lives in the **freezer** (main
  store, where deliveries land) and the **chiller** (the sales counter, where the cashier
  is accountable). The tab shows freezer and chiller per product, total value at cost,
  and a red **restock now** list (fires on total on-hand at/below the alert level). Three
  buttons at the top:
  - **Issue to chiller** — move stock from the freezer to the chiller for selling. From
    that moment the cashier owns it, and it's what the daily Close counts.
  - **Cutting / break down** — weigh the side, cut, weigh every output: bulk comes **out
    of the freezer**, the cuts go **into the chiller**. Each batch records **yield %,
    waste kg, retail uplift**; below-95% flags red; outputs can never weigh more than the
    input (the app refuses).
  - **Freezer stock-take (weekly)** — a blind freezer count; the freezer resets to your
    counts and any shortfall is logged as a **write-off at cost** (shows in Reports).
  Sales, voids and the daily Close touch the **chiller only**; corrections go through the
  stock button on **Items** (pick freezer or chiller, reason required, logged).
- **Close** — the evening ritual, ~10 minutes: **blind chiller count** (weigh every line
  on the sales counter and enter the scale figure — the app hides what it expects, so the
  count is a measurement, not a confirmation; the freezer is counted weekly, separately),
  then **count the money** (till cash excluding any
  float, EcoCash, swipe) and list any **cash paid out of the till** that day (gas, bags,
  casual labour — each needs a reason). Only after saving does the app reveal the
  variances: per-line count-vs-expected in kg and $, and the till gap per payment
  method — with cash pay-outs added back so a legitimate expense never reads as a
  shortage, and captured as an expense in the Day P&L. The record locks
  permanently and the **chiller** resets to the counted figures — physical truth wins, every time.
  Lines off by more than the tolerance (default **0.2 kg**) and till gaps beyond **±2%**
  flag red. Past closes are listed on the tab; red-edged cards had problems.
- **Items** — add/edit/delete product lines: name, category, unit, **sell $** (cost ×
  1.38 rule), **cost $** (buy price — drives profit and restock figures), and **low @**
  (alert level; 0 = no alert). **Stock is read-only here** — deliveries add to it via
  Goods In; corrections go through the stock button, which demands a reason and logs the
  change. Price and cost edits are logged to the audit trail when you press SAVE.
- **Settings** — change PIN, receipt header/footer + printer setup, **Daily Close
  tolerances**, **monthly overheads & loan** (editable list ÷ working days = the
  daily rate; prefilled from the business plan; delete the equipment-hire line in
  month 13, zero the loan at month 12), the **month-end archive**, **audit log
  viewer**, backup/restore all data (JSON), lock the office.

## Month-end archive (the VAT / tax record base)

Settings → Month-end archive → pick the month → **DOWNLOAD MONTH PACK**: five CSVs
(sales line-by-line, deliveries, cutting batches, daily closes incl. cash paid out,
and stock adjustments / write-offs) plus one JSON of everything. Allow multiple
downloads when Chrome asks, and save all six files to a
Google Drive folder per month — that folder is the PBC's books and the VAT working
base when registration lands (~Feb–Mar 2027). Then **Clear records older than the
selected month** to keep the phone light: products, current stock and the audit log
are never touched, and the newest close is always kept.

## The audit trail

Every sensitive action writes an append-only entry the app itself cannot edit or delete:
deliveries, payments to suppliers, stock adjustments (with the reason), cash paid out
of the till, price and cost changes, voids, and backup restores. Settings → Audit log shows the last 100. If a number
looks wrong, the trail says who-did-what-when — that is the difference between a mistake
and a mystery.

## Receipts & thermal printing

Every sale card in Reports has a **PRINT** button (reprints work too), and the green
confirmation screen has **PRINT RECEIPT**. Receipts are 58 mm / 32-column format with
the shop name, date/time, sale number, every line (kg × price), total and payment
method — set the header and footer text in Settings → Receipts.

Three printer modes in Settings → Receipts:

- **No printer (default)** — the print button opens the Android share sheet with the
  receipt text; send it to WhatsApp or any printer app.
- **Save / share as PDF** — generates a till-slip PDF on the phone (fully offline) and
  opens the share sheet: WhatsApp it to the customer, save it to Drive, or print it
  from any printer app. Downloads the file if sharing isn't available.
- **Bluetooth thermal printer (direct)** — for Bluetooth-LE ESC/POS printers (most
  cheap 58 mm ones sold as "BLE" or "app printing"). Tap **Choose printer** once, then
  **Test print**. No extra app needed.
- **RawBT print app** — install the free RawBT app from the Play Store, connect the
  printer inside RawBT (works with classic Bluetooth, USB, even some WiFi models), and
  the POS hands each receipt to it. Use this if the direct option can't see your printer.

There is also a **Print automatically after every sale** switch once a printer is set up.

## Daily close — the rule that runs the shop

The Excel workbook is **retired** — this app is the system of record, and the **Close**
tab is its control account. Every kilogram counted in, counted out, and turned into money
we can see. Run it every single evening; the person selling never counts alone. Small
negative variances are drip and trim loss; a pattern on the same line or same shift is
not. Missing stock is valued at selling price — what it would have banked.

## Getting it on the phone

**Route A — install as an app from the browser (works today, 10 min):**
1. Host the folder once: free GitHub account → new public repo `meat-pos` → upload the
   files → Settings → Pages → deploy from main. App lives at
   `https://<username>.github.io/meat-pos/`.
2. On the phone: open that address in Chrome → menu ⋮ → **Add to Home screen / Install app**.
3. Open it once while online; after that it runs fully offline, full-screen, with its own
   icon — behaves exactly like an installed app.

**Route B — a real .apk file (adds ~15 min on top of Route A):**
1. After hosting, go to **pwabuilder.com**, paste the app's address, choose Android →
   download the signed APK package.
2. Copy the APK to the phone (WhatsApp/USB), tap it, allow "install unknown apps" once.
This gives a true APK you can pass phone-to-phone. Note it still needs Route A's hosting
to exist the first time; after install it is fully offline.

(A third option — building the APK locally with Android Studio/Capacitor — needs a ~3 GB
toolchain on the laptop and adds nothing for this app. Skip unless you want the hosting
dependency gone entirely; ask Claude to set it up if so.)

**After any app update:** close and reopen the app twice — the first open fetches the new
version in the background, the second one runs it.

## Data safety rules

- Data lives in the device's app storage. **Never clear the app's/Chrome's site data** —
  that is the sales record.
- **Backup weekly** (Settings → Backup) and before any phone repair/reset; save the file
  to Google Drive. Restore reloads it onto any device.
- One live till by design — devices don't sync. **This app is the master record** — the
  Excel workbook is retired, which makes the weekly backup non-negotiable.
- Testing before launch? Play freely, then Settings → **Clear test data** (PIN + confirm):
  wipes every record and zeroes stock but keeps your products, prices, overheads and
  settings — day one starts clean. **Full factory reset** (also PIN-gated) puts
  absolutely everything back to defaults.

## Live view — watch from a second phone

Settings → **Live view** lets you watch today's sales on your own phone without touching the
till. One-off: create a free Firebase Realtime Database, allow read + write on one path, and
paste that path's URL (ending in `.json`) into the till's Settings. Then tap **Copy link** and
open that owner link once on your phone (bookmark it). Your phone shows a read-only dashboard —
today's takings, payment split, latest sales and top items — refreshing every 15 seconds. It is
one-way: the till writes, phones only watch; the till stays the master record. Leave the field
blank to keep it off. The URL is the only key, so keep the owner link private.

## Known limits (deliberate, for now)

- One selling till only — the live view is read-only, not a second point of sale.
- Not ZIMRA-fiscalised — fine until VAT registration (~Feb–Mar 2027); revisit then.
