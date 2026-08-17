/*
 * Meat POS — invariant test suite
 * -------------------------------------------------------------------------
 * Drives the REAL app code (index.html) in a headless browser, from a clean
 * slate each test, and checks the rules that must never break — the class of
 * bug where the app let an impossible state exist silently (negative stock,
 * double-counted movements, money that doesn't balance).
 *
 * Run:  node test/run.js
 * Exit: 0 if every check passes, 1 if any fail (usable in CI / pre-deploy).
 *
 * No npm install needed here: it borrows the globally-installed Playwright and
 * the pre-installed Chromium. On another machine run `npm i -D playwright` and
 * drop the executablePath override (or point it at your Chromium).
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// borrow global playwright + chromium if there's no local install
try { require.resolve('playwright'); }
catch (e) { process.env.NODE_PATH = execSync('npm root -g').toString().trim(); require('module').Module._initPaths(); }
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PORT = 8971;
const CHROME_CANDIDATES = [
  process.env.PW_CHROME,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
];
function findChrome() {
  for (const c of CHROME_CANDIDATES) if (c && fs.existsSync(c)) return c;
  return undefined; // let Playwright use its own download
}

// ---- tiny static server -------------------------------------------------
const MIME = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json',
               '.png':'image/png', '.jpg':'image/jpeg', '.webmanifest':'application/manifest+json' };
function serve() {
  return http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('nf'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain' });
    res.end(fs.readFileSync(file));
  });
}

// ---- result plumbing ----------------------------------------------------
const results = [];
let SUITE = '';
function suite(name) { SUITE = name; console.log('\n\x1b[1m' + name + '\x1b[0m'); }
function check(name, cond, detail) {
  results.push({ suite: SUITE, name, pass: !!cond });
  const tag = cond ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log('  ' + tag + '  ' + name + (detail ? '  \x1b[90m— ' + detail + '\x1b[0m' : ''));
}

(async () => {
  const server = serve();
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ executablePath: findChrome(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });   // needed on CI runners / small-/dev/shm containers
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  \x1b[31m[page error]\x1b[0m ' + e.message));
  await page.goto('http://localhost:' + PORT + '/index.html');

  // ---- helpers (node side) ---------------------------------------------
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const r3 = n => Math.round(n * 1000) / 1000;   // node-side rounder (page's round3 lives in the browser)

  async function resetApp() {
    await ev(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() =>
      typeof render === 'function' && Array.isArray(products) &&
      typeof doIssue === 'function' && typeof doCut === 'function');
    await ev(() => {
      window.__toasts = [];
      const o = window.toast;
      window.toast = (m, bad) => { window.__toasts.push({ m: String(m), bad: !!bad }); return o && o(m, bad); };
      shop.printer = 'off'; shop.auto = false; shop.sync = false;     // no printing / cloud side effects
      localStorage.setItem('mc_gateAck', today());                    // silence the "day not opened" gate
    });
  }
  const toasts    = () => ev(() => window.__toasts.slice());
  const clearToasts = () => ev(() => { window.__toasts = []; });
  const toastLike = async re => (await toasts()).some(t => re.test(t.m));
  const badToastLike = async re => (await toasts()).some(t => t.bad && re.test(t.m));
  const confirmYes  = () => ev(() => closeConfirm(true));
  const confirmOpen = () => ev(() => document.getElementById('confirm').classList.contains('open'));
  const stock = name => ev(n => { const p = products.find(x => x.name === n) || {};
    return { frz: round3(p.freezer || 0), chl: round3(p.chiller || 0), cost: p.cost || 0, price: p.price || 0 }; }, name);
  const setStock = (name, frz, chl) => ev(a => { const p = products.find(x => x.name === a.n);
    p.freezer = a.f; if (a.c != null) p.chiller = a.c; save(); }, { n: name, f: frz, c: chl });
  const auditTypes = () => ev(() => audit.map(a => a.type));
  async function enterPin(pin) {
    for (const ch of String(pin)) await ev(d => pinKey(Number(d)), ch);
    await wait(220);
  }
  // one carcass→cut→split move; chill = per-output kg to the chiller
  const doCutSplit = (src, inKg, cost, outs, chill, who) => ev(a => {
    cutDraft = { src: a.src, inKg: String(a.inKg), cost: String(a.cost),
                 outs: a.outs.map(o => ({ name: o.name, kg: String(o.kg) })) };
    cutToSplit();
    if (cutDraft.step === 'split') { cutDraft.chill = a.chill.map(String); if (a.who != null) cutDraft._who = a.who; doCut(); }
  }, { src, inKg, cost, outs, chill, who });
  const sell = (name, kg, price, cost) => ev(a => {
    ticket = [{ name: a.name, unit: 'kg', kg: a.kg, price: a.price, cost: a.cost, amt: round2(a.kg * a.price) }];
    pay('Cash', round2(a.kg * a.price));
  }, { name, kg, price, cost });
  const lastSale = () => ev(() => lastSaleId);

  // ===================================================================== //
  suite('Suite 1 — Stock conservation (the family the reported bug belongs to)');

  // 1. The meat ledger: received == sold + on-hand + cut-waste + write-offs
  await resetApp();
  await setStock('Beef Forequarter', 80, 0);
  await doCutSplit('Beef Forequarter', 80, 2,
    [{ name: 'Beef Super', kg: 55 }, { name: 'Beef Bones', kg: 15 }, { name: 'T-Bone Steak', kg: 8 }],
    [40, 0, 0], 'Test');                                   // 40kg Super→chiller, rest stays frozen; waste 2kg
  await confirmYes();
  await sell('Beef Super', 10, 6, 4.35);                   // sold 10 out of chiller
  await sell('Beef Super', 5, 6, 4.35);                    // sold another 5 ...
  const voidId = await lastSale();
  await ev(id => voidSale(id), voidId); await confirmYes(); // ... then voided it (net sold = 10)
  await ev(() => { adjIdx = products.findIndex(p => p.name === 'Beef Bones'); adjLoc = 'freezer';
    document.getElementById('adj-qty').value = '13'; document.getElementById('adj-why').value = 'spoilage test';
    adjSave(); });                                          // write off 2kg of bones (15→13)
  const totalOnHand = await ev(() => round3(products.reduce((s, p) => s + (p.freezer || 0) + (p.chiller || 0), 0)));
  const received = 80, soldKg = 10, cutWaste = 2, writeoff = 2;
  const ledger = r3(soldKg + totalOnHand + cutWaste + writeoff);
  check('The meat ledger balances to the gram', ledger === received,
    `received ${received} = sold ${soldKg} + on-hand ${totalOnHand} + waste ${cutWaste} + write-off ${writeoff} = ${ledger}`);

  // 2. Over-issue to the chiller is refused + prompts (regression)
  await resetApp(); await setStock('Beef Super', 10, 0);
  await clearToasts();
  await ev(() => { issueDraft = { _who: 'x', 'Beef Super': '20' }; doIssue(); });
  check('Over-issue is blocked (no confirm) and prompts', !(await confirmOpen()) && await badToastLike(/freezer holds/i),
    JSON.stringify(await stock('Beef Super')));

  // 3. Over-cut is refused + prompts (regression)
  await resetApp(); await setStock('Beef Forequarter', 10, 0); await clearToasts();
  await ev(() => { cutDraft = { src: 'Beef Forequarter', inKg: '20', cost: '2', outs: [{ name: 'Beef Super', kg: '19' }] }; cutToSplit(); });
  check('Over-cut is blocked (no advance) and prompts',
    (await ev(() => cutDraft && cutDraft.step)) !== 'split' && await badToastLike(/freezer holds only/i));

  // 4. Issue of EXACTLY the freezer amount is allowed (boundary)
  await resetApp(); await setStock('Beef Super', 10, 0);
  await ev(() => { issueDraft = { _who: 'x', 'Beef Super': '10' }; doIssue(); }); await confirmYes();
  { const s = await stock('Beef Super'); check('Issuing exactly what the freezer holds is allowed', s.frz === 0 && s.chl === 10, JSON.stringify(s)); }

  // 5. Blank / zero / negative issue amounts are rejected cleanly
  await resetApp(); await setStock('Beef Super', 10, 0);
  await clearToasts(); await ev(() => { issueDraft = { _who: '', 'Beef Super': '' }; doIssue(); });
  const noName = await badToastLike(/name of the person/i);
  await clearToasts(); await ev(() => { issueDraft = { _who: 'x', 'Beef Super': '-5' }; doIssue(); });
  const negBlocked = await badToastLike(/positive/i) && !(await confirmOpen());
  await clearToasts(); await ev(() => { issueDraft = { _who: 'x', 'Beef Super': '0' }; doIssue(); });
  const zeroBlocked = await badToastLike(/at least one amount/i) && !(await confirmOpen());
  check('Blank name, negative and zero issues are all rejected', noName && negBlocked && zeroBlocked,
    `name=${noName} neg=${negBlocked} zero=${zeroBlocked}`);

  // 6. A failed multi-line issue moves NOTHING (all-or-nothing)
  await resetApp(); await setStock('Beef Super', 10, 0); await setStock('Beef Bones', 10, 0);
  await ev(() => { issueDraft = { _who: 'x', 'Beef Super': '5', 'Beef Bones': '20' }; doIssue(); });
  { const a = await stock('Beef Super'), b = await stock('Beef Bones');
    check('One bad line blocks the whole issue — nothing moves',
      !(await confirmOpen()) && a.frz === 10 && a.chl === 0 && b.frz === 10 && b.chl === 0,
      `super=${JSON.stringify(a)} bones=${JSON.stringify(b)}`); }

  // 7. Freezer stock-take leaves blank lines untouched
  await resetApp(); await setStock('Beef Super', 10, 0); await setStock('Beef Bones', 20, 0);
  await ev(() => { ftakeDraft = { 'Beef Super': '8' }; doFtake(); });
  { const a = await stock('Beef Super'), b = await stock('Beef Bones');
    check('Stock-take resets counted lines, leaves blanks alone', a.frz === 8 && b.frz === 20,
      `super.frz=${a.frz} (→8) bones.frz=${b.frz} (untouched 20)`); }

  // 8. Stock correction requires a reason and logs it
  await resetApp(); await setStock('Beef Super', 0, 5); await clearToasts();
  await ev(() => { adjIdx = products.findIndex(p => p.name === 'Beef Super'); adjLoc = 'chiller';
    document.getElementById('adj-qty').value = '4'; document.getElementById('adj-why').value = ''; adjSave(); });
  const reasonReq = await badToastLike(/reason is required/i);
  await ev(() => { document.getElementById('adj-qty').value = '4'; document.getElementById('adj-why').value = 'recount'; adjSave(); });
  const logged = (await auditTypes()).includes('stock-adjust');
  const applied = (await stock('Beef Super')).chl === 4;
  check('Correction refuses without a reason, then applies + logs', reasonReq && logged && applied,
    `reasonReq=${reasonReq} logged=${logged} applied=${applied}`);

  // ===================================================================== //
  suite('Suite 2 — Cutting edge cases');

  // 9. Outputs weighing more than the input is refused
  await resetApp(); await setStock('Beef Forequarter', 50, 0); await clearToasts();
  await ev(() => { cutDraft = { src: 'Beef Forequarter', inKg: '10', cost: '2', outs: [{ name: 'Beef Super', kg: '12' }] }; cutToSplit(); });
  check('Outputs > input is refused', (await ev(() => cutDraft.step)) !== 'split' && await badToastLike(/more than the input/i));

  // 10. A cut with zero outputs is refused
  await resetApp(); await setStock('Beef Forequarter', 50, 0); await clearToasts();
  await ev(() => { cutDraft = { src: 'Beef Forequarter', inKg: '10', cost: '2', outs: [{ name: '', kg: '' }] }; cutToSplit(); });
  check('A cut with no outputs is refused', (await ev(() => cutDraft.step)) !== 'split' && await badToastLike(/at least one output/i));

  // 11. Yield below 95% flags + records abnormal loss at cost
  await resetApp(); await setStock('Beef Forequarter', 100, 0); await clearToasts();
  await doCutSplit('Beef Forequarter', 100, 2, [{ name: 'Beef Super', kg: 90 }], [0], null); await confirmYes();
  { const b = await ev(() => batches[batches.length - 1]);
    check('Sub-95% yield flags and books abnormal loss at cost',
      b.yield === 0.9 && b.abnCost === 10, `yield=${b.yield} abnCost=${b.abnCost} (10kg waste − 5kg norm = 5kg × $2)`); }

  // 12. Re-cutting a product into itself doesn't duplicate stock
  await resetApp(); await setStock('Beef Super', 20, 0);
  await doCutSplit('Beef Super', 20, 2, [{ name: 'Beef Super', kg: 19 }], [0], null); await confirmYes();
  { const s = await stock('Beef Super'); check('Re-cut into itself: stock not duplicated', r3(s.frz + s.chl) === 19,
      `on-hand ${r3(s.frz + s.chl)} (20 in, 1 waste → 19, not 39)`); }

  // 13. Split boxes can't exceed what was cut (clamped)
  await resetApp(); await setStock('Beef Forequarter', 50, 0);
  await doCutSplit('Beef Forequarter', 50, 2, [{ name: 'Beef Super', kg: 30 }], [40], 'X'); await confirmYes();
  { const s = await stock('Beef Super'); check('Split to chiller clamps to kg produced', s.chl === 30 && s.frz === 0,
      `chl=${s.chl} (asked 40, produced 30) frz=${s.frz}`); }

  // 14. Cut→chiller demands a name; freezer-only doesn't (regression)
  await resetApp(); await setStock('Beef Forequarter', 50, 0); await clearToasts();
  await ev(() => { cutDraft = { src: 'Beef Forequarter', inKg: '50', cost: '2', outs: [{ name: 'Beef Super', kg: '35' }] };
    cutToSplit(); cutDraft.chill = ['5']; cutDraft._who = ''; doCut(); });
  const needName = await badToastLike(/person receiving/i) && !(await confirmOpen());
  await resetApp(); await setStock('Beef Forequarter', 50, 0);
  await doCutSplit('Beef Forequarter', 50, 2, [{ name: 'Beef Super', kg: 35 }], [0], null);
  const freezerOnlyOk = await confirmOpen();  // proceeded to the save-confirm with no name needed
  if (freezerOnlyOk) await confirmYes();
  check('Cut→chiller needs a name; all-to-freezer does not', needName && freezerOnlyOk, `needName=${needName} freezerOnlyOk=${freezerOnlyOk}`);

  // 15. Cut stock left in the freezer shows up in the weekly freezer stock-take
  await resetApp(); await setStock('Beef Forequarter', 50, 0);
  await doCutSplit('Beef Forequarter', 50, 2, [{ name: 'Beef Super', kg: 35 }], [0], null); await confirmYes();
  await ev(() => { ftakeDraft = { 'Beef Super': '35' }; doFtake(); });
  { const line = await ev(() => (ftakeLast.lines.find(l => l.name === 'Beef Super') || null));
    check('Cut stock kept frozen is counted by the freezer stock-take', !!line && line.expected === 35,
      line ? `expected ${line.expected}` : 'no line'); }

  // ===================================================================== //
  suite('Suite 3 — Selling & the chiller');

  // 16. An empty chiller blocks the sale and points at the fix
  await resetApp(); await setStock('Beef Super', 0, 0);
  await ev(() => { const i = products.findIndex(p => p.name === 'Beef Super'); openModal(i); });
  check('Empty chiller blocks the sale (prompt shown, nothing ticketed)',
    await confirmOpen() && (await ev(() => ticket.length)) === 0);

  // 17. Overselling the chiller WARNS but ALLOWS (by design — kept as a warning)
  await resetApp(); await setStock('Beef Super', 0, 5); await clearToasts();
  await ev(() => { const i = products.findIndex(p => p.name === 'Beef Super'); openModal(i);
    document.getElementById('qty').value = '10'; setMode('kg'); addLine(); });
  check('Overselling warns but still allows the line (design choice)',
    (await ev(() => ticket.length)) === 1 && await badToastLike(/Chiller shows only/i));

  // 18. Cash tendered under the total is refused; change is computed right
  await resetApp(); await setStock('Beef Super', 0, 20); await clearToasts();
  await ev(() => { ticket = [{ name: 'Beef Super', unit: 'kg', kg: 10, price: 6, cost: 4.35, amt: 60 }];
    tenderTotal = 60; document.getElementById('t-amt').value = '50'; tenderDone(); });
  const shortRefused = (await ev(() => sales.length)) === 0 && await badToastLike(/less than the total/i);
  await ev(() => { document.getElementById('t-amt').value = '100'; tenderDone(); });
  const change = await ev(() => (sales[sales.length - 1] || {}).change);
  check('Short cash refused; correct change on a good tender', shortRefused && change === 40, `shortRefused=${shortRefused} change=${change}`);

  // 19. A sale deducts from the chiller only, never the freezer
  await resetApp(); await setStock('Beef Super', 30, 20);
  await sell('Beef Super', 5, 6, 4.35);
  { const s = await stock('Beef Super'); check('Sales come out of the chiller, freezer untouched', s.chl === 15 && s.frz === 30,
      `chl=${s.chl} (20→15) frz=${s.frz} (30)`); }

  // 20. Many lines of the same item deduct the total, not just the last
  await resetApp(); await setStock('Beef Super', 0, 20);
  await ev(() => { ticket = [
    { name: 'Beef Super', unit: 'kg', kg: 4, price: 6, cost: 4.35, amt: 24 },
    { name: 'Beef Super', unit: 'kg', kg: 3, price: 6, cost: 4.35, amt: 18 }]; pay('Cash', 42); });
  check('Repeated item lines deduct the sum (7kg), not the last (3kg)', (await stock('Beef Super')).chl === 13,
    `chl=${(await stock('Beef Super')).chl} (20 − 7)`);

  // ===================================================================== //
  suite('Suite 4 — Void & refund integrity');

  // 21. Voiding returns the exact kg to the chiller
  await resetApp(); await setStock('Beef Super', 0, 20);
  await sell('Beef Super', 6, 6, 4.35); { const id = await lastSale(); await ev(i => voidSale(i), id); await confirmYes(); }
  check('Void returns the exact kg', (await stock('Beef Super')).chl === 20, `chl=${(await stock('Beef Super')).chl}`);

  // 22. Voiding the SAME sale twice must not return stock twice
  await resetApp(); await setStock('Beef Super', 0, 20);
  await sell('Beef Super', 6, 6, 4.35);
  { const id = await lastSale();
    await ev(i => voidSale(i), id); await confirmYes();
    await ev(i => voidSale(i), id); await confirmYes(); }   // second attempt
  check('Double-void does NOT double the stock', (await stock('Beef Super')).chl === 20,
    `chl=${(await stock('Beef Super')).chl} (must be 20, not 26)`);

  // 23. An account sale with money already paid against it refuses to void
  await resetApp(); await setStock('Beef Super', 0, 20); await clearToasts();
  await ev(() => { ensureDebtor('Cust', ''); sales.push({ id: Date.now(), date: today(), time: '10:00',
    lines: [{ name: 'Beef Super', unit: 'kg', kg: 5, price: 6, cost: 4.35, amt: 30 }],
    pay: 'Account', debtor: 'Cust', acctPay: 5, total: 30, void: false }); save();
    voidSale(sales[sales.length - 1].id); });
  check('Part-paid account sale refuses to void', await badToastLike(/already has .* paid/i) && !(await confirmOpen()));

  // 24. Voided sales leave revenue + COGS totals
  await resetApp(); await setStock('Beef Super', 0, 40);
  await sell('Beef Super', 5, 6, 4.35);                     // $30 stays
  await sell('Beef Super', 5, 6, 4.35); { const id = await lastSale(); await ev(i => voidSale(i), id); await confirmYes(); } // $30 voided
  const rev = await ev(() => { repFrom = today(); repTo = today(); const a = agg();
    return round2(Object.values(a).reduce((s, x) => s + x.amt, 0)); });
  check('Voided sale is excluded from revenue totals', rev === 30, `revenue=$${rev} (only the un-voided $30)`);

  // ===================================================================== //
  suite('Suite 5 — Goods In & supplier money');
  const renderDeliveries = () => ev(() => { pinOK = true; role = 'owner'; tab = 'office'; office = 'goods'; render(); });
  const doDelivery = a => ev(x => {
    document.getElementById('d-sup').value = x.sup; document.getElementById('d-item').value = x.item;
    document.getElementById('d-inv').value = String(x.inv); document.getElementById('d-w').value = String(x.w);
    document.getElementById('d-cost').value = String(x.cost); document.getElementById('d-paid').checked = !!x.paid;
    document.getElementById('d-note').value = ''; addDelivery();
  }, a);

  // 25. A delivery lands in the freezer, never the chiller
  await resetApp(); await renderDeliveries();
  await doDelivery({ sup: 'Farm A', item: 'Beef Super', inv: 10, w: 10, cost: 2, paid: true });
  { const s = await stock('Beef Super'); check('Delivery lands in the freezer, not the chiller', s.frz === 10 && s.chl === 0, JSON.stringify(s)); }

  // 26 + 27. Short delivery warns; you pay on invoiced, stock moves on weighed
  await resetApp(); await renderDeliveries(); await clearToasts();
  await doDelivery({ sup: 'Farm A', item: 'Beef Super', inv: 10, w: 8, cost: 2, paid: false });
  const shortWarn = await toastLike(/SHORT/i);   // app raises this as a plain (info) toast, not an error
  const d = await ev(() => deliveries[deliveries.length - 1]);
  const owed = await ev(() => outstanding(deliveries[deliveries.length - 1]));
  check('Weighed-short raises the claim warning', shortWarn);
  check('Pay on invoiced ($20), stock on weighed (8kg) — shortage not lost',
    owed === 20 && d.wKg === 8 && d.invKg === 10 && (await stock('Beef Super')).frz === 8,
    `owed=$${owed} weighed=${d.wKg} invoiced=${d.invKg}`);

  // 28. A new cost on a delivery re-prices the line and logs a cost-change
  await resetApp(); await renderDeliveries();
  const costBefore = (await stock('Beef Super')).cost;
  await doDelivery({ sup: 'Farm A', item: 'Beef Super', inv: 5, w: 5, cost: 3, paid: true });
  check('Delivery re-prices the line + logs a cost-change',
    (await stock('Beef Super')).cost === 3 && (await auditTypes()).includes('cost-change'),
    `cost ${costBefore} → ${(await stock('Beef Super')).cost}`);

  // 29. Supplier overpayment prompts, then keeps the excess as credit
  await resetApp(); await renderDeliveries();
  await doDelivery({ sup: 'Farm B', item: 'Beef Super', inv: 10, w: 10, cost: 2, paid: false }); // owes $20
  await ev(() => { supSel = 'Farm B'; supPayDraft = { amt: '30', method: 'Cash', fromTill: false, note: '' }; doSupPay(); });
  const overPrompt = await confirmOpen(); await confirmYes();
  const pm = await ev(() => payments[payments.length - 1]);
  check('Supplier overpayment prompts, excess kept as credit', overPrompt && pm.credit === 10,
    `prompted=${overPrompt} credit=$${pm.credit}`);

  // 30. Paying from the till vs from the Restock envelope land in the right books
  await resetApp(); await renderDeliveries();
  await ev(() => { envs['Restock'] = 100; save(); });
  await doDelivery({ sup: 'Farm C', item: 'Beef Super', inv: 10, w: 10, cost: 2, paid: false });
  await ev(() => { supSel = 'Farm C'; role = 'owner'; supPayDraft = { amt: '20', method: 'Cash', fromTill: true, fromBox: true, note: '' }; doSupPay(); });
  const fromTillPay = await ev(() => payments[payments.length - 1].fromTill === true);
  const envDrew = await ev(() => envBal('Restock')) === 80;
  const cbSpend = await ev(() => cashbook.some(e => e.kind === 'spend' && e.env === 'Restock'));
  check('From-till flagged + Restock envelope drawn down + logged', fromTillPay && envDrew && cbSpend,
    `fromTill=${fromTillPay} restock→$${await ev(() => envBal('Restock'))} cbSpend=${cbSpend}`);

  // ===================================================================== //
  suite('Suite 6 — Debtors / credit');

  // 31. An on-account sale needs the OWNER pin; the supervisor pin is refused + logged
  await resetApp(); await setStock('Beef Super', 0, 20);
  await ev(() => { ticket = [{ name: 'Beef Super', unit: 'kg', kg: 5, price: 6, cost: 4.35, amt: 30 }]; acctStart(); });
  await enterPin('1234');                                   // supervisor — must be refused
  const supRefused = (await auditTypes()).includes('credit-refused') && (await ev(() => sales.length)) === 0;
  await ev(() => acctStart()); await enterPin('2026');      // owner — authorised
  await ev(() => { acctPick = { name: 'Cust', phone: '' }; doAcctSale(null); }); await confirmYes();
  const acctSaleMade = await ev(() => sales.some(s => s.pay === 'Account' && s.debtor === 'Cust'));
  const chillerHit = (await stock('Beef Super')).chl === 15;
  check('Supervisor PIN refused (+logged); owner PIN books the credit sale', supRefused && acctSaleMade && chillerHit,
    `supRefused=${supRefused} saleMade=${acctSaleMade} chiller=${(await stock('Beef Super')).chl}`);

  // 32. Debtor balance = sales − payments, across a partial payment
  await ev(() => applyDebtorPay('Cust', 10, 'Cash', ''));
  check('Debtor balance tracks partial payments', (await ev(() => owedByDebtor('Cust'))) === 20, `owes $${await ev(() => owedByDebtor('Cust'))} (30 − 10)`);

  // 33. Debtor overpayment prompts + shows as credit
  await clearToasts();
  await ev(() => { debSel = 'Cust'; debPayDraft = { amt: '999', method: 'Cash', note: '' }; doDebtPay(); });
  const debtOverPrompt = await confirmOpen(); await confirmYes();
  check('Debtor overpayment prompts + kept as credit', debtOverPrompt && (await ev(() => debtorPays[debtorPays.length - 1].credit)) > 0,
    `prompted=${debtOverPrompt} credit=$${await ev(() => debtorPays[debtorPays.length - 1].credit)}`);

  // 34. Bank payments never touch the till; cash ones do
  await resetApp();
  await ev(() => { ensureDebtor('Cust', ''); applyDebtorPay('Cust', 5, 'Bank', ''); applyDebtorPay('Cust', 7, 'Cash', ''); });
  const intoTill = await ev(() => debtorPays.filter(p => p.method !== 'Bank'));
  check('Cash debtor money hits the till, Bank money does not',
    intoTill.length === 1 && intoTill[0].method === 'Cash', `into-till count=${intoTill.length} method=${intoTill[0] && intoTill[0].method}`);

  // ===================================================================== //
  suite('Suite 7 — Cash-up: Open, Close, Cash Book');

  // 35. Close resets the chiller to counts; blank lines untouched
  await resetApp(); await setStock('Beef Super', 0, 20); await setStock('Beef Bones', 0, 10);
  await ev(() => { closeDraft = { counts: { 'Beef Super': '18' }, cash: '0', eco: '0', swipe: '0', note: '', payouts: [] }; doClose(); });
  { const a = await stock('Beef Super'), b = await stock('Beef Bones');
    check('Close resets counted chiller lines, leaves blanks', a.chl === 18 && b.chl === 10, `super.chl=${a.chl}→18 bones.chl=${b.chl} untouched`); }

  // 36. A double-close (re-submitting the same draft) is refused
  await clearToasts();
  const closesBefore = await ev(() => closes.length);
  await ev(() => doClose());
  check('Re-submitting the same close is refused (idempotent)',
    (await ev(() => closes.length)) === closesBefore && await badToastLike(/already saved/i), `closes stayed ${closesBefore}`);

  // 37. A cash pay-out with no reason blocks the close
  await resetApp(); await clearToasts();
  await ev(() => { closeDraft = { counts: {}, cash: '0', eco: '0', swipe: '0', note: '', payouts: [{ amt: '5', reason: '', cat: 'Stock / supplier' }] }; doClose(); });
  check('Pay-out without a reason blocks the close', (await ev(() => closes.length)) === 0 && await badToastLike(/needs a reason/i));

  // 38. The close names whoever signed for chiller stock — including from cutting
  await resetApp(); await setStock('Beef Forequarter', 50, 0);
  await doCutSplit('Beef Forequarter', 50, 2, [{ name: 'Beef Super', kg: 35 }], [10], 'Rudo'); await confirmYes();
  await ev(() => { closeDraft = { counts: {}, cash: '0', eco: '0', swipe: '0', note: '', payouts: [] }; doClose(); });
  check('Close credits the cutting receiver as accountable', (await ev(() => closes[closes.length - 1].recv || [])).includes('Rudo'),
    `recv=${JSON.stringify(await ev(() => closes[closes.length - 1].recv))}`);

  // 39. A close's cash can't be collected into envelopes twice
  await resetApp();
  await ev(() => { closeDraft = { counts: {}, cash: '100', eco: '0', swipe: '0', note: '', payouts: [] }; doClose();
    startCollect(closes[closes.length - 1].ts); doCollect(); }); await confirmYes();
  await ev(() => { cbDraft = null; startCollect(closes[closes.length - 1].ts); }); // second attempt
  const collectCount = await ev(() => cashbook.filter(e => e.kind === 'collect').length);
  const secondBlocked = (await ev(() => cbDraft)) === null;
  check('The same close cannot be collected twice', collectCount === 1 && secondBlocked, `collects=${collectCount} secondDraft=${secondBlocked}`);

  // 40. Envelope split can't exceed the cash collected
  await resetApp(); await clearToasts();
  await ev(() => { closeDraft = { counts: {}, cash: '50', eco: '0', swipe: '0', note: '', payouts: [] }; doClose();
    startCollect(closes[closes.length - 1].ts); cbDraft.alloc = { 'Restock': '999' }; doCollect(); });
  check('Over-allocating envelopes beyond the cash is blocked',
    (await ev(() => cashbook.filter(e => e.kind === 'collect').length)) === 0 && await badToastLike(/more than you collected/i));

  // 41. Envelope overspend prompts, then shows negative (not silent)
  await resetApp(); await clearToasts();
  await ev(() => { envs['Restock'] = 10; save();
    cbSpendDraft = { env: 'Restock', amt: '25', what: 'test', cat: 'Stock / supplier' }; doCbSpend(); });
  const spendPrompt = await confirmOpen(); await confirmYes();
  check('Envelope overspend prompts, then goes visibly negative', spendPrompt && (await ev(() => envBal('Restock'))) === -15,
    `prompted=${spendPrompt} Restock=$${await ev(() => envBal('Restock'))}`);

  // 42. COGS on a close = Σ(kg × cost) — the P&L's cost backbone
  await resetApp(); await setStock('Beef Super', 0, 40); await setStock('Beef Bones', 0, 40);
  await sell('Beef Super', 10, 6, 4.35);   // cost 43.50
  await sell('Beef Bones', 5, 4, 2.90);    // cost 14.50
  await ev(() => { closeDraft = { counts: {}, cash: '0', eco: '0', swipe: '0', note: '', payouts: [] }; doClose(); });
  check('Close COGS equals Σ(kg × cost)', (await ev(() => closes[closes.length - 1].cogs)) === 58,
    `cogs=$${await ev(() => closes[closes.length - 1].cogs)} (43.50 + 14.50)`);

  // ===================================================================== //
  suite('Suite 8 — Persistence & data safety');

  // 43. Everything survives a reload, including the new cut-split fields
  await resetApp(); await setStock('Beef Forequarter', 50, 0);
  await doCutSplit('Beef Forequarter', 50, 2, [{ name: 'Beef Super', kg: 35 }], [5], 'X'); await confirmYes();
  await page.reload();
  await page.waitForFunction(() => Array.isArray(products) && Array.isArray(batches));
  { const s = await stock('Beef Super');
    const split = await ev(() => { const b = batches[batches.length - 1]; const o = b.outs.find(x => x.name === 'Beef Super'); return o ? { chiller: o.chiller, freezer: o.freezer } : null; });
    check('Cut split + stock survive a full reload', s.chl === 5 && s.frz === 30 && split && split.chiller === 5,
      `stock=${JSON.stringify(s)} split=${JSON.stringify(split)}`); }

  // 44. Backup → wipe → restore reproduces identical state
  await resetApp(); await setStock('Beef Super', 12, 7);
  await sell('Beef Super', 2, 6, 4.35);
  const snapBefore = await ev(() => JSON.stringify({ products, salesN: sales.length, chl: products.find(p => p.name === 'Beef Super').chiller }));
  const backupObj = await ev(() => JSON.stringify({ products, sales, shop, deliveries, suppliers, payments, audit, closes, opens, batches, adjustments, debtors, debtorPays, cashbook, envs }));
  await ev(() => { products = []; sales = []; });                 // wipe in memory
  await ev(b => applyBackup(JSON.parse(b)), backupObj);           // restore
  const snapAfter = await ev(() => JSON.stringify({ products, salesN: sales.length, chl: products.find(p => p.name === 'Beef Super').chiller }));
  check('Backup → wipe → restore is lossless', snapBefore === snapAfter, snapBefore === snapAfter ? 'identical' : 'MISMATCH');

  // 45. Month prune keeps open debts + unpaid deliveries
  await resetApp();
  await ev(() => {
    deliveries.push({ id: 1, date: '2020-01-01', time: '09:00', supplier: 'Old', item: 'Beef Super', unit: 'kg', invKg: 10, wKg: 10, cost: 2, paid: false, pay: 0 });   // unpaid → keep
    deliveries.push({ id: 2, date: '2020-01-02', time: '09:00', supplier: 'Old', item: 'Beef Super', unit: 'kg', invKg: 10, wKg: 10, cost: 2, paid: true, pay: 20 });    // paid → prune
    sales.push({ id: 3, date: '2020-01-03', time: '09:00', lines: [{ name: 'Beef Super', kg: 5, price: 6, cost: 4.35, amt: 30 }], pay: 'Account', debtor: 'D', acctPay: 0, total: 30, void: false }); // owed → keep
    sales.push({ id: 4, date: '2020-01-04', time: '09:00', lines: [{ name: 'Beef Super', kg: 1, price: 6, cost: 4.35, amt: 6 }], pay: 'Cash', total: 6, void: false });   // old cash → prune
    save(); pruneOld();
  });
  await confirmYes();
  const kept = await ev(() => ({
    unpaidDeliv: deliveries.some(d => d.id === 1), paidDeliv: deliveries.some(d => d.id === 2),
    owedSale: sales.some(s => s.id === 3), oldCash: sales.some(s => s.id === 4) }));
  check('Prune keeps unpaid deliveries + open debts, drops settled old records',
    kept.unpaidDeliv && !kept.paidDeliv && kept.owedSale && !kept.oldCash, JSON.stringify(kept));

  // 46. Corrupt localStorage doesn't white-screen the app
  await ev(() => localStorage.setItem('mc_sales', '{ this is not json'));
  await page.reload();
  await page.waitForFunction(() => Array.isArray(products));
  check('Corrupt saved data falls back cleanly (no crash)',
    (await ev(() => Array.isArray(sales) && products.length > 0)), 'app still loaded with defaults');

  // ===================================================================== //
  suite('Suite 9 — Roles & audit');

  // 47. The supervisor can't reach owner-only screens
  await resetApp();
  const gate = await ev(() => { role = 'supervisor';
    return { reports: canSee('reports'), settings: canSee('settings'), cashbook: canSee('cashbook'),
             audit: canSee('audit'), goods: canSee('goods'), stock: canSee('stock') }; });
  check('Supervisor is blocked from Reports/Settings/Cash Book/Audit, allowed day-to-day',
    !gate.reports && !gate.settings && !gate.cashbook && !gate.audit && gate.goods && gate.stock, JSON.stringify(gate));

  // 48. The audit log is append-only from inside the app
  await resetApp();
  await setStock('Beef Super', 20, 0);
  await ev(() => { issueDraft = { _who: 'x', 'Beef Super': '5' }; doIssue(); }); await confirmYes();  // seed one entry
  const a0 = await ev(() => ({ len: audit.length, first: audit[0] ? JSON.stringify(audit[0]) : null }));
  await ev(() => { issueDraft = { _who: 'x', 'Beef Super': '5' }; doIssue(); }); await confirmYes();  // add another
  const a1 = await ev(() => ({ len: audit.length, first: audit[0] ? JSON.stringify(audit[0]) : null }));
  const noEditor = await ev(() => typeof window.editAudit === 'undefined' && typeof window.deleteAudit === 'undefined');
  check('Audit only grows; earlier entries are immutable; no in-app editor', a1.len > a0.len && a1.first === a0.first && noEditor,
    `len ${a0.len}→${a1.len}, firstUnchanged=${a1.first === a0.first}, noEditor=${noEditor}`);

  // ---- tally -----------------------------------------------------------
  await browser.close();
  server.close();
  const failed = results.filter(r => !r.pass);
  const bySuite = {};
  for (const r of results) { (bySuite[r.suite] = bySuite[r.suite] || { p: 0, n: 0 }); bySuite[r.suite].n++; if (r.pass) bySuite[r.suite].p++; }
  console.log('\n\x1b[1m==================== SUMMARY ====================\x1b[0m');
  for (const s in bySuite) console.log(`  ${bySuite[s].p}/${bySuite[s].n}  ${s}`);
  console.log(`\n  \x1b[1m${results.length - failed.length}/${results.length} checks passed\x1b[0m`);
  if (failed.length) { console.log('\n  \x1b[31mFAILED:\x1b[0m'); failed.forEach(f => console.log('   • ' + f.name)); }
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
