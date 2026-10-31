'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, sampleTabs, TZ, formatIso } = require('./harness');

/** JSON round-trip, like google.script.run does (also strips vm-realm prototypes). */
const plain = v => JSON.parse(JSON.stringify(v));

function setUp(options) {
  const env = loadApp(sampleTabs(), options);
  env.app.setupSheet();
  return env;
}

const tab = (env, name) => env.spreadsheet.getSheetByName(name);
const iso = v => (v instanceof Date || Object.prototype.toString.call(v) === '[object Date]' ? formatIso(v, TZ) : v);
const prodRows = env => tab(env, 'Production').dump().slice(2).map(r => [iso(r[0])].concat(r.slice(1)));

test('getAppData reports setup needed on the untouched sheet', () => {
  const { app } = loadApp(sampleTabs());
  const data = plain(app.getAppData());
  assert.equal(data.setupNeeded, true);
  assert.equal(data.today, '2026-10-08');
  assert.equal(data.productionMonday, '2026-10-05');
  assert.equal(data.invoiceMonday, '2026-09-28');
});

test('setupSheet only adds: columns, tabs, settings, shared PDF folder; re-running is a no-op', () => {
  const env = loadApp(sampleTabs());
  const changes = env.app.setupSheet();
  assert.ok(changes.some(c => c.startsWith('Invoices: added columns Invoice #, Status')));
  const invoices = tab(env, 'Invoices').dump();
  assert.deepEqual(invoices[1].slice(0, 6), ['Date', '', 'Customer', 'Goods', 'Amount', 'Notes']);
  assert.deepEqual(invoices[1].slice(6), ['Invoice #', 'Status', 'Week Of', 'Fees', 'Email', 'PDF Link', 'Draft Id', 'Updated At']);
  assert.deepEqual(invoices[2].slice(2, 5), ['Demarest', 'Coffee Shop', 500]); // existing data untouched
  ['Invoice Items', 'Prices', 'Customers', 'Settings'].forEach(n => assert.ok(tab(env, n), n));

  const folderId = plain(env.app.readSettings_())['PDF Folder Id'];
  const folder = env.drive.folders[folderId];
  assert.equal(folder.name, 'Hastings Bakehouse Invoices');
  assert.deepEqual(folder.editors, ['partner@example.com']);
  assert.ok(env.rootParent.folders.includes(folder), 'created next to the spreadsheet');

  assert.deepEqual(plain(env.app.setupSheet()), ['Everything was already set up.']);
  assert.equal(plain(env.app.getAppData()).setupNeeded, false);
});

test('getAppData lists customers from past invoices and Production products', () => {
  const env = setUp();
  const data = plain(env.app.getAppData());
  assert.deepEqual(data.customers.map(c => c.name), ['Demarest', 'Jones', 'Smith']);
  assert.deepEqual(data.goods, ['Celebration Cake', 'Coffee Shop']);
  assert.equal(data.products.length, 5);
  assert.equal(data.weeklyCustomer, 'Demarest');
});

test('getProductionWeek nets LOSS/DAMAGE and reads text and Date cells', () => {
  const env = setUp();
  const week = plain(env.app.getProductionWeek('2026-09-30')); // any day → that Monday
  assert.equal(week.monday, '2026-09-28');
  assert.equal(week.label, 'Sep 28 – Oct 3, 2026');
  assert.deepEqual(week.days.map(d => d.date), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
  assert.deepEqual(week.days[1].made, { 'Coffee Cake Muffin': 10, 'Vanilla Cake Pop': 12, 'Chocolate Cake Pop': 12 });
  assert.deepEqual(week.days[1].loss, { 'Coffee Cake Muffin': 2, 'Chocolate Cake Pop': 1 });
  assert.deepEqual(week.totals, {
    'Coffee Cake Muffin': 48, 'Lemon Blueberry Muffin': 50, 'Vanilla Cake Pop': 12, 'Chocolate Cake Pop': 11, 'Gluten Free Cookie': 8,
  });
});

test('getProductionDay lists the day\'s items, or the last production day\'s when empty', () => {
  const env = setUp();
  const day = plain(env.app.getProductionDay('2026-09-29'));
  assert.deepEqual(day.items, ['Coffee Cake Muffin', 'Vanilla Cake Pop', 'Chocolate Cake Pop']);
  assert.deepEqual(day.made, { 'Coffee Cake Muffin': 10, 'Vanilla Cake Pop': 12, 'Chocolate Cake Pop': 12 });
  assert.deepEqual(day.loss, { 'Coffee Cake Muffin': 2, 'Chocolate Cake Pop': 1 });
  assert.equal(day.itemsFrom, '');
  assert.equal(day.week.monday, '2026-09-28');
  assert.deepEqual(day.week.days[1], { date: '2026-09-29', made: 34, loss: 3 });
  assert.equal(day.week.totals['Chocolate Cake Pop'], 11);

  const empty = plain(env.app.getProductionDay('2026-10-08'));
  assert.deepEqual(empty.made, {});
  assert.equal(empty.itemsFrom, '2026-10-06');
  assert.deepEqual(empty.items, ['Coffee Cake Muffin', 'Lemon Blueberry Muffin']);

  const first = plain(env.app.getProductionDay('2026-01-05'));
  assert.deepEqual([first.items, first.itemsFrom], [[], '']);
});

test('saveProductionDay updates in place, inserts sorted rows, and removes emptied LOSS rows', () => {
  const env = setUp();
  // Edit an existing text-dated row; Chocolate Cake Pop is left out, so it and the day's losses are cleared.
  env.app.saveProductionDay('2026-09-29', [
    { product: 'Coffee Cake Muffin', made: 11 },
    { product: 'Vanilla Cake Pop', made: '12', loss: '' },
  ]);
  // New day between existing rows, with a loss (entered as a positive number).
  const day = plain(env.app.saveProductionDay('2026-09-30', [{ product: 'Lemon Blueberry Muffin', made: '24', loss: '3' }]));
  assert.deepEqual(prodRows(env), [
    ['9/28', '', 20, 30],
    ['9/29', '', 11, '', 12],
    ['2026-09-30', '', '', 24],
    ['2026-09-30', 'LOSS/DAMAGE', '', -3],
    ['10/1', '', 15, 15, '', '', 8],
    ['2026-10-03', '', 5, 5],
    ['10/6', '', 40, 20],
  ]);
  assert.equal(tab(env, 'Production').formats['5:1'], 'm/d');
  assert.deepEqual(day.items, ['Lemon Blueberry Muffin']);
  assert.equal(day.week.totals['Coffee Cake Muffin'], 51);
  assert.equal(day.week.totals['Lemon Blueberry Muffin'], 71);
});

test('saveProductionDay appends a day after the last row, is idempotent, and clears a day', () => {
  const env = setUp();
  const entries = [{ product: 'Coffee Cake Muffin', made: 9, loss: 1 }];
  env.app.saveProductionDay('2026-10-07', entries);
  env.app.saveProductionDay('2026-10-07', entries);
  assert.deepEqual(prodRows(env).slice(-3), [
    ['10/6', '', 40, 20],
    ['2026-10-07', '', 9],
    ['2026-10-07', 'LOSS/DAMAGE', -1],
  ]);
  env.app.saveProductionDay('2026-10-07', []);
  assert.deepEqual(prodRows(env).slice(-1), [['10/6', '', 40, 20]]);
});

test('saveProductionDay adds a column for a new item and matches existing items ignoring case', () => {
  const env = setUp();
  const day = plain(env.app.saveProductionDay('2026-10-07', [
    { product: '  coffee cake   muffin ', made: 4 },
    { product: 'Coffee Cake Muffin', made: 2 },
    { product: 'Pumpkin Scone', made: 6 },
    { product: 'Never Made', made: '' },
  ]));
  const headers = tab(env, 'Production').dump()[1];
  assert.deepEqual(headers.slice(-2), ['Gluten Free Cookie', 'Pumpkin Scone']);
  assert.ok(!headers.includes('Never Made'), 'no column for an item with no count');
  assert.deepEqual(day.made, { 'Coffee Cake Muffin': 6, 'Pumpkin Scone': 6 });
  assert.ok(plain(env.app.getAppData()).products.includes('Pumpkin Scone'));
  assert.equal(plain(env.app.buildWeeklyInvoice('2026-10-05')).items.find(i => i.product === 'Pumpkin Scone').qty, 6);
});

test('saveProductionDay rejects bad dates and reserved names', () => {
  const env = setUp();
  assert.throws(() => env.app.saveProductionDay('10/7', []), /Invalid date/);
  assert.throws(() => env.app.saveProductionDay('2026-10-07', [{ product: 'Note', made: 1 }]), /can't be an item/);
});

test('weekly invoice: build from production, save, remember prices, guard duplicates, update', () => {
  const env = setUp();
  const draft = plain(env.app.buildWeeklyInvoice('2026-09-28'));
  assert.equal(draft.customer, 'Demarest');
  assert.equal(draft.date, '2026-10-03');
  assert.equal(draft.goods, 'Coffee Shop');
  assert.equal(draft.existingNumber, '');
  assert.deepEqual(draft.items.map(i => [i.product, i.qty, i.unitPrice]), [
    ['Coffee Cake Muffin', 48, ''], ['Lemon Blueberry Muffin', 50, ''], ['Vanilla Cake Pop', 12, ''],
    ['Chocolate Cake Pop', 11, ''], ['Gluten Free Cookie', 8, ''],
  ]);

  // Missing prices are rejected.
  assert.throws(() => env.app.saveInvoice(draft), /unit price for Coffee Cake Muffin/);

  draft.items.forEach(i => { i.unitPrice = '2.50'; });
  draft.items[4].unitPrice = 3;
  draft.email = 'orders@demarest.example';
  const saved = plain(env.app.saveInvoice(draft));
  assert.equal(saved.number, '2026-001');
  assert.equal(saved.total, 326.5); // (48+50+12+11)*2.5 + 8*3

  const row = tab(env, 'Invoices').dump()[saved.rowNumber - 1];
  assert.equal(saved.rowNumber, 7); // appended after the last existing row
  assert.equal(iso(row[0]), '2026-10-03');
  assert.deepEqual(row.slice(2, 5), ['Demarest', 'Coffee Shop', 326.5]);
  assert.deepEqual(row.slice(6, 8), ['2026-001', 'saved']);
  assert.equal(iso(row[8]), '2026-09-28');
  assert.equal(tab(env, 'Invoices').formats['7:7'], '@');

  assert.equal(tab(env, 'Invoice Items').dump().length, 6);
  const prices = plain(env.app.readPrices_().prices);
  assert.deepEqual(prices, {
    'Coffee Cake Muffin': 2.5, 'Lemon Blueberry Muffin': 2.5, 'Vanilla Cake Pop': 2.5, 'Chocolate Cake Pop': 2.5, 'Gluten Free Cookie': 3,
  });
  const customers = plain(env.app.readCustomers_().customers);
  assert.deepEqual(customers.map(c => [c.name, c.email, c.goods]), [['Demarest', 'orders@demarest.example', 'Coffee Shop']]);

  // Next build pre-fills saved prices and the customer's email, and flags the existing invoice.
  const again = plain(env.app.buildWeeklyInvoice('2026-09-28'));
  assert.equal(again.existingNumber, '2026-001');
  assert.equal(again.email, 'orders@demarest.example');
  assert.equal(again.items[0].unitPrice, 2.5);
  assert.throws(() => env.app.saveInvoice(again), /DUPLICATE_WEEK:2026-001/);

  // A changed price is only remembered when asked.
  const loaded = plain(env.app.getInvoice('2026-001'));
  assert.equal(loaded.items.length, 5);
  loaded.items[0].unitPrice = 2.75;
  loaded.items[1].unitPrice = 2.75;
  loaded.rememberPrices = ['Lemon Blueberry Muffin'];
  loaded.fees = '10';
  const updated = plain(env.app.saveInvoice(loaded));
  assert.equal(updated.number, '2026-001');
  assert.equal(updated.rowNumber, 7);
  assert.equal(updated.total, 361); // 326.5 + 0.25*(48+50) + 10
  assert.equal(tab(env, 'Invoices').dump().length, 7, 'updated in place, no new row');
  assert.equal(tab(env, 'Invoice Items').dump().length, 6, 'items replaced, not duplicated');
  const p2 = plain(env.app.readPrices_().prices);
  assert.equal(p2['Coffee Cake Muffin'], 2.5);
  assert.equal(p2['Lemon Blueberry Muffin'], 2.75);

  // Next number increments; a one-off invoice has no week.
  const cake = plain(env.app.saveInvoice({
    date: '2026-10-08', customer: 'Smith', goods: 'Celebration Cake', items: [{ product: 'Celebration Cake 8"', qty: 1, unitPrice: 60 }],
  }));
  assert.equal(cake.number, '2026-002');

  const list = plain(env.app.listInvoices(3));
  assert.deepEqual(list.map(i => i.number), ['2026-002', '2026-001', '']);
});

test('saveInvoice validates input', () => {
  const env = setUp();
  const base = { date: '2026-10-08', customer: 'X', items: [{ product: 'A', qty: 1, unitPrice: 1 }] };
  assert.throws(() => env.app.saveInvoice({ ...base, customer: ' ' }), /Customer is required/);
  assert.throws(() => env.app.saveInvoice({ ...base, date: '10/8/2026' }), /Invalid invoice date/);
  assert.throws(() => env.app.saveInvoice({ ...base, items: [{ product: '', qty: '' }] }), /at least one line item/);
  assert.throws(() => env.app.saveInvoice({ ...base, items: [{ product: '', qty: 2, unitPrice: 1 }] }), /needs a product/);
  assert.throws(() => env.app.saveInvoice({ ...base, email: 'nope' }), /doesn't look like an email/);
  assert.throws(() => env.app.getInvoice('2099-001'), /not found/);
  assert.throws(() => env.app.setInvoiceStatus('2026-001', 'lost'), /Unknown status/);
});

function savedWeekly(env) {
  const inv = plain(env.app.buildWeeklyInvoice('2026-09-28'));
  inv.items.forEach(i => { i.unitPrice = 2.5; });
  inv.email = 'orders@demarest.example';
  return inv;
}

test('saveAndDraftInvoice makes a PDF in the year folder and a Gmail draft with Reply-To', () => {
  const env = setUp();
  const result = plain(env.app.saveAndDraftInvoice(savedWeekly(env)));
  assert.equal(result.number, '2026-001');
  assert.equal(result.draftError, undefined);
  assert.equal(result.fromBusiness, false);
  assert.equal(result.from, 'ben@example.com');
  assert.match(result.draftUrl, /authuser=ben%40example\.com#drafts\?compose=msgr-draft-1$/);

  const d = env.gmail.drafts[0];
  assert.equal(d.to, 'orders@demarest.example');
  assert.equal(d.subject, 'Hastings Bakehouse Invoice 2026-001');
  assert.match(d.body, /invoice 2026-001 for the week of Sep 28 – Oct 3, 2026, totaling \$322\.50/);
  assert.equal(d.opts.replyTo, 'hastingsbakehouse@gmail.com');
  assert.equal(d.opts.from, undefined);
  assert.equal(d.opts.attachments[0].type, 'application/pdf');
  assert.equal(d.opts.attachments[0].name, 'Hastings Bakehouse Invoice 2026-001 - Demarest - 2026-10-03.pdf');

  const folderId = plain(env.app.readSettings_())['PDF Folder Id'];
  const year = env.drive.folders[folderId].folders.find(f => f.name === '2026');
  assert.equal(year.files.length, 1);
  const row = tab(env, 'Invoices').dump()[result.rowNumber - 1];
  assert.equal(row[7], 'drafted');
  assert.equal(row[11], result.pdfUrl);
  assert.equal(row[12], 'r-draft-1');

  // Re-drafting replaces the old PDF and draft rather than piling up.
  env.app.createInvoiceDraft('2026-001');
  assert.equal(env.gmail.drafts[0].deleted, true);
  assert.equal(year.files[0].trashed, true);
  assert.equal(year.files.length, 2);
  // Status survives once it's further along.
  env.app.setInvoiceStatus('2026-001', 'paid');
  env.app.createInvoiceDraft('2026-001');
  assert.equal(plain(env.app.getInvoice('2026-001')).status, 'paid');
});

test('drafts come from the business address when it is a Gmail alias', () => {
  const env = setUp({ aliases: ['HastingsBakehouse@gmail.com'] });
  const result = plain(env.app.saveAndDraftInvoice(savedWeekly(env)));
  assert.equal(result.fromBusiness, true);
  assert.equal(env.gmail.drafts[0].opts.from, 'hastingsbakehouse@gmail.com');
});

test('a failed draft still keeps the saved invoice', () => {
  const env = setUp();
  const inv = savedWeekly(env);
  inv.email = '';
  const result = plain(env.app.saveAndDraftInvoice(inv));
  assert.equal(result.number, '2026-001');
  assert.match(result.draftError, /Add an email address for Demarest/);
});

test('invoice HTML escapes content and shows week, fees and notes', () => {
  const env = setUp();
  const html = env.app.previewInvoiceHtml({
    date: '2026-10-03', weekOf: '2026-09-28', customer: 'Smith & <Co>', email: 's@example.com',
    items: [{ product: 'Muffin', qty: 2, unitPrice: 2.5 }], fees: 5, notes: 'Leave at back door',
  });
  assert.match(html, /Smith &amp; &lt;Co&gt;/);
  assert.match(html, /\(assigned on save\)/);
  assert.match(html, /Week of:<\/td><td class="value">Sep 28 – Oct 3, 2026/);
  assert.match(html, /<td>Muffin<\/td><td>\$2\.50<\/td><td>2<\/td><td>\$5\.00<\/td>/);
  assert.match(html, /Delivery \/ Fees:<\/td><td class="amount">\$5\.00/);
  assert.match(html, /Total Due:<\/td><td class="amount">\$10\.00/);
  assert.match(html, /Leave at back door/);
  assert.match(html, /src="data:image\/png;base64,/);
});

test('doGet renders the app shell with styles and client script inlined', () => {
  const env = setUp();
  const html = env.app.doGet().getContent();
  assert.match(html, /<style>/);
  assert.match(html, /google\.script\.run/);
  assert.doesNotMatch(html, /<\?/);
});
