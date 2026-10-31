'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSandbox } = require('../tools/sandbox');

const tmpState = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bakehouse-sandbox-')), 'state.json');
const sheet = sb => Object.fromEntries(sb.env.spreadsheet.sheets.map(s => [s.name, JSON.stringify(s.dump())]));

function weekOfWork(sb) {
  sb.call('setupSheet', []);
  sb.call('saveProductionDay', ['2026-10-07', [
    { product: 'Coffee Cake Muffin', made: 10, loss: 1 },
    { product: 'Lemon Blueberry Muffin', made: 6 },
  ]]);
  const inv = sb.call('buildWeeklyInvoice', ['2026-10-05']);
  inv.email = 'orders@example.com';
  inv.items.forEach(i => { i.unitPrice = 2.5; });
  return sb.call('saveAndDraftInvoice', [inv]);
}

test('changes are logged and replayed exactly after a restart', () => {
  const file = tmpState();
  const first = createSandbox({ stateFile: file });
  const saved = weekOfWork(first);
  assert.ok(saved.number, 'invoice number assigned');
  assert.equal(saved.draftError, undefined);
  assert.deepEqual(first.state.actions.map(a => a.fn), ['setupSheet', 'saveProductionDay', 'saveAndDraftInvoice']);

  const second = createSandbox({ stateFile: file });
  assert.deepEqual(sheet(second), sheet(first));
  assert.equal(second.env.gmail.drafts.length, 1);
  assert.match(second.env.gmail.drafts[0].subject, new RegExp(saved.number));
});

test('reads are not logged, undo drops the last change, reset starts over', () => {
  const sb = createSandbox({ stateFile: tmpState() });
  sb.call('getAppData', []);
  assert.equal(sb.state.actions.length, 0);

  weekOfWork(sb);
  sb.undo();
  assert.equal(sb.state.actions.length, 2);
  assert.equal(sb.env.gmail.drafts.length, 0);
  assert.equal(sb.call('listInvoices', [10]).filter(i => i.number).length, 0);

  sb.reset('blank');
  assert.equal(sb.state.actions.length, 0);
  assert.equal(sb.env.spreadsheet.getSheetByName('Production').dump().length, 2);
});

test('a failed change is not logged and leaves no partial writes', () => {
  const sb = createSandbox({});
  sb.call('setupSheet', []);
  const before = sheet(sb);
  assert.throws(() => sb.call('saveProductionDay', ['not-a-date', []]));
  assert.equal(sb.state.actions.length, 1);
  assert.deepEqual(sheet(sb), before);
});

test('a saved sandbox from older code keeps the changes that still replay', () => {
  const file = tmpState();
  fs.writeFileSync(file, JSON.stringify({ start: 'sample', today: '2026-10-08', actions: [
    { today: '2026-10-08', fn: 'setupSheet', args: [] },
    { today: '2026-10-08', fn: 'saveProductionWeek', args: ['2026-10-05', []] },
    { today: '2026-10-08', fn: 'setInvoiceStatus', args: ['2026-001', 'paid'] },
  ] }));
  const sb = createSandbox({ stateFile: file });
  assert.deepEqual(sb.state.actions.map(a => a.fn), ['setupSheet']);
  assert.equal(sb.dropped.length, 2);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).actions.length, 1);
});

test('the pretend day moves with setToday and is replayed per change', () => {
  const file = tmpState();
  const sb = createSandbox({ stateFile: file, today: '2026-10-11' });
  assert.equal(sb.call('getAppData', []).today, '2026-10-11');
  sb.call('setupSheet', []);
  sb.setToday('2027-01-04');
  assert.equal(sb.call('getAppData', []).today, '2027-01-04');
  const again = createSandbox({ stateFile: file });
  assert.equal(again.state.today, '2027-01-04');
  assert.equal(again.state.actions[0].today, '2026-10-11');
});
