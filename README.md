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
- **Stock** — live stock on hand per product (counts down with every sale, back up on
  void), total inventory value at cost, and a red **restock now** list of every item at
  or below its alert level. A ⚠ appears on the tab itself whenever something is low.
- **Items** — add/edit/delete product lines: name, category, unit, **sell $** (workbook
  selling price = cost × 1.38), **cost $** (workbook buy price — drives profit and
  restock figures), **stock** (on hand — type the new figure when deliveries arrive),
  and **low @** (alert level; 0 = no alert). Typing a new category name creates a new
  tile on the sell screen. Names must match the Excel workbook's Products sheet EXACTLY.
- **Settings** — change PIN, receipt header/footer + printer setup, backup/restore all
  data (JSON), lock the office.

## Receipts & thermal printing

Every sale card in Reports has a **PRINT** button (reprints work too), and the green
confirmation screen has **PRINT RECEIPT**. Receipts are 58 mm / 32-column format with
the shop name, date/time, sale number, every line (kg × price), total and payment
method — set the header and footer text in Settings → Receipts.

Three printer modes in Settings → Receipts:

- **No printer (default)** — the print button opens the Android share sheet with the
  receipt text; send it to WhatsApp or any printer app.
- **Bluetooth thermal printer (direct)** — for Bluetooth-LE ESC/POS printers (most
  cheap 58 mm ones sold as "BLE" or "app printing"). Tap **Choose printer** once, then
  **Test print**. No extra app needed.
- **RawBT print app** — install the free RawBT app from the Play Store, connect the
  printer inside RawBT (works with classic Bluetooth, USB, even some WiFi models), and
  the POS hands each receipt to it. Use this if the direct option can't see your printer.

There is also a **Print automatically after every sale** switch once a printer is set up.

## Daily close (feeds the Excel control)

Reports → set both dates to today → enter each line's **Sold kg** into the workbook's
**Daily Stock → POS sold kg** column. **Cash** goes to Till Rec's cash column;
**EcoCash + Swipe together** go to the EcoCash/transfers column.

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
- One live till by design — devices don't sync; the Excel workbook is the master record.

## Known limits (deliberate, for now)

- No multi-device sync.
- Not ZIMRA-fiscalised — fine until VAT registration (~Feb–Mar 2027); revisit then.
