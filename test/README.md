# Meat POS — invariant test suite

Drives the **real** app (`index.html`) in a headless browser, from a clean slate each
test, and checks the rules that must never break — the class of bug where the app lets an
impossible state exist silently (negative stock, double-counted movements, money that
doesn't balance).

## Run

```bash
node test/run.js
```

Exit code `0` = all green, `1` = at least one failure (so it can gate a deploy). Every
check prints `PASS`/`FAIL` with the actual numbers.

## What it needs

- **Here (this environment):** nothing — it borrows the global Playwright install and the
  pre-installed Chromium automatically.
- **On another machine:**
  ```bash
  npm i -D playwright && npx playwright install chromium
  ```
  Then either unset the Chromium path or point `PW_CHROME` at your browser:
  ```bash
  PW_CHROME=/path/to/chrome node test/run.js
  ```

## The 48 checks (9 suites)

| Suite | Guards |
|-------|--------|
| 1 · Stock conservation | Meat is only moved/sold/written off, never created; no silent negatives; over-issue and over-cut are refused |
| 2 · Cutting | Outputs ≤ input; split clamps to what was cut; cut-to-chiller needs a receiver; frozen cut stock is counted weekly |
| 3 · Selling | Empty chiller blocks; overselling **warns but allows** (by design); short cash refused; sales hit the chiller only |
| 4 · Void | Void returns exact kg; **double-void doesn't double stock**; part-paid account sales can't be voided |
| 5 · Goods In | Delivery lands in the freezer; short delivery claimed; pay-on-invoiced vs stock-on-weighed; overpay kept as credit |
| 6 · Debtors | Credit needs the owner PIN; balances track partial payments; bank money never touches the till |
| 7 · Cash-up | Close resets chiller to counts; double-close / double-collect refused; envelopes can't exceed cash; COGS = Σ(kg×cost) |
| 8 · Persistence | State survives reload/backup-restore; prune keeps open debts; corrupt data doesn't crash the app |
| 9 · Roles & audit | Supervisor can't reach owner screens; the audit log is append-only |

## Adding a test

Each check is one `check(name, condition, detail)` call inside a suite. Use the helpers at
the top of `run.js` (`stock`, `setStock`, `doCutSplit`, `sell`, `confirmYes`, `toastLike`,
`enterPin`, …) to drive the real app functions, then assert on the resulting state. Prefer
asserting an **invariant** (a rule that must always hold) over a specific screen's wording.
