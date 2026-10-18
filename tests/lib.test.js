'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, sampleTabs, TZ, formatIso } = require('./harness');

const { app } = loadApp(sampleTabs());
const fmt = d => formatIso(d, TZ);

test('normalizeDate_ handles Date cells, ISO, and typed m/d text', () => {
  assert.equal(app.normalizeDate_(new Date('2026-10-03T04:00:00Z'), '2026-10-08', fmt), '2026-10-03');
  assert.equal(app.normalizeDate_('2026-10-03', '2026-10-08', fmt), '2026-10-03');
  assert.equal(app.normalizeDate_('7/20', '2026-10-08', fmt), '2026-07-20');
  assert.equal(app.normalizeDate_('7/20/25', '2026-10-08', fmt), '2025-07-20');
  assert.equal(app.normalizeDate_(' 8/1/2026 ', '2026-10-08', fmt), '2026-08-01');
  assert.equal(app.normalizeDate_('', '2026-10-08', fmt), '');
  assert.equal(app.normalizeDate_('Date', '2026-10-08', fmt), '');
  assert.equal(app.normalizeDate_('13/40', '2026-10-08', fmt), '');
});

test('normalizeDate_ rolls year-less December dates back when read in January', () => {
  assert.equal(app.normalizeDate_('12/28', '2027-01-04', fmt), '2026-12-28');
  assert.equal(app.normalizeDate_('1/2', '2027-01-04', fmt), '2027-01-02');
  // Slightly in the future (e.g. entering tomorrow) stays in the current year.
  assert.equal(app.normalizeDate_('10/9', '2026-10-08', fmt), '2026-10-09');
});

test('weekMonday_ treats Sunday as the end of the previous Mon–Sat week', () => {
  assert.equal(app.weekMonday_('2026-10-05'), '2026-10-05'); // Monday
  assert.equal(app.weekMonday_('2026-10-10'), '2026-10-05'); // Saturday
  assert.equal(app.weekMonday_('2026-10-11'), '2026-10-05'); // Sunday
  assert.equal(app.weekMonday_('2026-10-12'), '2026-10-12');
  assert.deepEqual([...app.weekDays_('2026-12-28')],
    ['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
});

test('defaultInvoiceMonday_ picks the week just finished on Sat/Sun, else last week', () => {
  assert.equal(app.defaultInvoiceMonday_('2026-10-10'), '2026-10-05'); // Sat
  assert.equal(app.defaultInvoiceMonday_('2026-10-11'), '2026-10-05'); // Sun
  assert.equal(app.defaultInvoiceMonday_('2026-10-12'), '2026-10-05'); // Mon
  assert.equal(app.defaultInvoiceMonday_('2026-10-08'), '2026-09-28'); // Thu
});

test('formatWeekRange_ and formatUsDate_', () => {
  assert.equal(app.formatWeekRange_('2026-10-05'), 'Oct 5 – Oct 10, 2026');
  assert.equal(app.formatWeekRange_('2026-12-28'), 'Dec 28 – Jan 2, 2027');
  assert.equal(app.formatUsDate_('2026-08-01'), '8/1/2026');
});

test('nextInvoiceNumber_ increments per year and ignores other formats', () => {
  assert.equal(app.nextInvoiceNumber_([], 2026), '2026-001');
  assert.equal(app.nextInvoiceNumber_(['', '000123', '2026-009', '2026-010', '2025-044'], 2026), '2026-011');
  assert.equal(app.nextInvoiceNumber_(['2026-010'], 2027), '2027-001');
  assert.equal(app.nextInvoiceNumber_(['2026-999'], 2026), '2026-1000');
});

test('computeTotals_ rounds in cents', () => {
  const t = app.computeTotals_([
    { product: 'A', qty: 3, unitPrice: '0.10' },
    { product: 'B', qty: '27', unitPrice: 2.5 },
    { product: 'C', qty: 1, unitPrice: '$1,000.005' },
  ], '5');
  assert.deepEqual(t.lines.map(l => l.lineTotal), [0.3, 67.5, 1000.01]);
  assert.equal(t.subtotal, 1067.81);
  assert.equal(t.fees, 5);
  assert.equal(t.total, 1072.81);
});

test('formatMoney_ and fillTemplate_', () => {
  assert.equal(app.formatMoney_(1294.25), '$1,294.25');
  assert.equal(app.formatMoney_(-125), '-$125.00');
  assert.equal(app.fillTemplate_('Invoice {number} for {who} {missing}', { number: '2026-001', who: 'X' }),
    'Invoice 2026-001 for X {missing}');
});

test('productionInsertIndex_ keeps rows date-sorted with LOSS after the day', () => {
  const rows = [{ date: '2026-10-01' }, { date: '2026-10-03' }, { date: '2026-10-03' }, { date: '2026-10-06' }];
  assert.equal(app.productionInsertIndex_(rows, '2026-10-02', false), 1);
  assert.equal(app.productionInsertIndex_(rows, '2026-10-03', false), 1);
  assert.equal(app.productionInsertIndex_(rows, '2026-10-03', true), 3);
  assert.equal(app.productionInsertIndex_(rows, '2026-10-09', false), 4);
  assert.equal(app.productionInsertIndex_(rows, '2026-09-01', false), 0);
});

test('cleanQuantities_ drops blanks and applies sign', () => {
  const out = app.cleanQuantities_({ A: '3', B: '', C: 0, D: -4, X: 9 }, ['A', 'B', 'C', 'D'], -1);
  assert.deepEqual({ ...out }, { A: -3, D: -4 });
});
