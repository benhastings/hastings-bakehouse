/**
 * Invoices tab (one row per invoice, existing columns kept as-is) plus the
 * Invoice Items, Prices and Customers tabs this app maintains.
 */

const INV = CONFIG.invoices;

function readInvoices_() {
  const table = readTable_(sheet_(CONFIG.tabs.invoices), INV.date);
  const missing = INV.added.filter(h => col_(table, h) === 0);
  if (missing.length) throw new Error('The Invoices tab is missing ' + missing.join(', ') + '. Run Bakehouse → Set up sheet.');
  return table;
}

/** Plain-object view of an Invoices row, safe to return to the client. */
function invoiceFromRow_(table, row, formatDate, today) {
  const get = name => cell_(table, row, name);
  return {
    rowNumber: row.rowNumber,
    number: String(get('Invoice #') || ''),
    date: normalizeDate_(get(INV.date), today, formatDate),
    customer: String(get(INV.customer) || ''),
    goods: String(get(INV.goods) || ''),
    amount: toNumber_(get(INV.amount)),
    notes: String(get(INV.notes) || ''),
    status: String(get('Status') || ''),
    weekOf: normalizeDate_(get('Week Of'), today, formatDate),
    fees: toNumber_(get('Fees')),
    email: String(get('Email') || ''),
    pdfUrl: String(get('PDF Link') || ''),
    draftId: String(get('Draft Id') || ''),
  };
}

function allInvoices_() {
  const table = readInvoices_();
  const formatDate = sheetDateFormatter_();
  const today = todayIso_();
  const invoices = table.rows.filter(r => !isBlankRow_(r)).map(r => invoiceFromRow_(table, r, formatDate, today));
  return { table: table, invoices: invoices };
}

/** Most recently entered invoices first (the sheet isn't kept in date order). */
function listInvoices(limit) {
  return allInvoices_().invoices.filter(i => i.customer || i.amount).reverse().slice(0, limit || 25);
}

function readItems_() {
  return readTable_(sheet_(CONFIG.tabs.items), 'Invoice #');
}

function getInvoice(number) {
  const found = allInvoices_().invoices.find(i => i.number === number);
  if (!found) throw new Error('Invoice ' + number + ' not found.');
  const items = readItems_();
  found.items = items.rows
    .filter(r => String(cell_(items, r, 'Invoice #')) === number)
    .map(r => ({
      product: String(cell_(items, r, 'Product')),
      qty: toNumber_(cell_(items, r, 'Qty')),
      unitPrice: toNumber_(cell_(items, r, 'Unit Price')),
    }));
  return found;
}

function readPrices_() {
  const table = readTable_(sheet_(CONFIG.tabs.prices), 'Product');
  const prices = {};
  table.rows.forEach(r => {
    const product = String(cell_(table, r, 'Product')).trim();
    const price = cell_(table, r, 'Unit Price');
    if (product && price !== '') prices[product] = toNumber_(price);
  });
  return { table: table, prices: prices };
}

function setPrice_(product, price) {
  const { table } = readPrices_();
  const row = table.rows.find(r => String(cell_(table, r, 'Product')).trim() === product);
  const data = { 'Unit Price': { value: price, format: '$#,##0.00' }, 'Updated At': new Date() };
  if (row) writeCells_(table, row.rowNumber, data);
  else appendRow_(table, Object.assign({ Product: product }, data));
}

function readCustomers_() {
  const table = readTable_(sheet_(CONFIG.tabs.customers), 'Name');
  const customers = table.rows
    .map(r => ({
      rowNumber: r.rowNumber,
      name: String(cell_(table, r, 'Name')).trim(),
      email: String(cell_(table, r, 'Email')).trim(),
      goods: String(cell_(table, r, 'Default Goods')).trim(),
    }))
    .filter(c => c.name);
  return { table: table, customers: customers };
}

function upsertCustomer_(name, email, goods) {
  const { table, customers } = readCustomers_();
  const existing = customers.find(c => c.name.toLowerCase() === name.toLowerCase());
  const data = {};
  if (email) data.Email = email;
  if (goods) data['Default Goods'] = goods;
  if (existing) {
    if (Object.keys(data).length) writeCells_(table, existing.rowNumber, data);
  } else {
    appendRow_(table, Object.assign({ Name: name }, data));
  }
}

/** Validate and normalize an invoice from the client. */
function cleanInvoice_(inv) {
  if (!inv || typeof inv !== 'object') throw new Error('No invoice data received.');
  const customer = String(inv.customer || '').trim();
  if (!customer) throw new Error('Customer is required.');
  assertIsoDate_(inv.date, 'invoice date');
  if (inv.weekOf) assertIsoDate_(inv.weekOf, 'week');
  const email = String(inv.email || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('"' + email + '" doesn\'t look like an email address.');
  const items = (inv.items || [])
    .map(i => ({ product: String(i.product || '').trim(), qty: toNumber_(i.qty), unitPrice: i.unitPrice }))
    .filter(i => i.product || i.qty);
  if (!items.length) throw new Error('Add at least one line item.');
  items.forEach(i => {
    if (!i.product) throw new Error('Every line item needs a product.');
    if (i.unitPrice === '' || i.unitPrice === null || i.unitPrice === undefined || isNaN(Number(i.unitPrice))) {
      throw new Error('Enter a unit price for ' + i.product + '.');
    }
  });
  return {
    number: String(inv.number || '').trim(),
    date: inv.date,
    weekOf: inv.weekOf || '',
    customer: customer,
    email: email,
    goods: String(inv.goods || '').trim(),
    notes: String(inv.notes || '').trim(),
    items: items,
    fees: inv.fees,
    rememberPrices: inv.rememberPrices || [],
    allowDuplicateWeek: Boolean(inv.allowDuplicateWeek),
  };
}

/** Save (create or update) an invoice. Returns { number, total, rowNumber }. */
function saveInvoice(raw) {
  const inv = cleanInvoice_(raw);
  return withLock_(() => saveInvoiceLocked_(inv));
}

function saveInvoiceLocked_(inv) {
  const { table, invoices } = allInvoices_();
  const totals = computeTotals_(inv.items, inv.fees);
  let existing = null;
  if (inv.number) {
    existing = invoices.find(i => i.number === inv.number);
    if (!existing) throw new Error('Invoice ' + inv.number + ' not found.');
  } else if (inv.weekOf && !inv.allowDuplicateWeek) {
    const dup = invoices.find(i => i.weekOf === inv.weekOf && i.customer.toLowerCase() === inv.customer.toLowerCase());
    if (dup) throw new Error('DUPLICATE_WEEK:' + dup.number);
  }
  const number = inv.number || nextInvoiceNumber_(invoices.map(i => i.number), inv.date.slice(0, 4));

  const data = {};
  data[INV.date] = { value: inv.date, format: 'm/d/yyyy' };
  data[INV.customer] = inv.customer;
  data[INV.goods] = inv.goods;
  data[INV.amount] = { value: totals.total, format: '$#,##0.00' };
  data[INV.notes] = inv.notes;
  data['Invoice #'] = { value: number, format: '@' };
  data['Week Of'] = inv.weekOf ? { value: inv.weekOf, format: 'm/d/yyyy' } : '';
  data.Fees = { value: totals.fees, format: '$#,##0.00' };
  data.Email = inv.email;
  data['Updated At'] = new Date();
  if (!existing) data.Status = 'saved';
  const rowNumber = existing ? existing.rowNumber : lastDataRow_(table) + 1;
  writeCells_(table, rowNumber, data);

  // Replace this invoice's line items.
  const items = readItems_();
  items.rows
    .filter(r => String(cell_(items, r, 'Invoice #')) === number)
    .sort((a, b) => b.rowNumber - a.rowNumber)
    .forEach(r => items.sheet.deleteRow(r.rowNumber));
  const freshItems = readItems_();
  totals.lines.forEach(line => appendRow_(freshItems, {
    'Invoice #': { value: number, format: '@' },
    Product: line.product,
    Qty: line.qty,
    'Unit Price': { value: line.unitPrice, format: '$#,##0.00' },
    'Line Total': { value: line.lineTotal, format: '$#,##0.00' },
  }));

  // Remember prices: always for products without one yet, otherwise only when asked.
  const { prices } = readPrices_();
  totals.lines.forEach(line => {
    if (!(line.product in prices) || inv.rememberPrices.indexOf(line.product) !== -1) {
      setPrice_(line.product, line.unitPrice);
      prices[line.product] = line.unitPrice;
    }
  });

  upsertCustomer_(inv.customer, inv.email, inv.goods);
  return { number: number, total: totals.total, rowNumber: rowNumber };
}

function setInvoiceStatus(number, status) {
  if (CONFIG.statuses.indexOf(status) === -1) throw new Error('Unknown status ' + status);
  return withLock_(() => {
    const { table, invoices } = allInvoices_();
    const inv = invoices.find(i => i.number === number);
    if (!inv) throw new Error('Invoice ' + number + ' not found.');
    writeCells_(table, inv.rowNumber, { Status: status, 'Updated At': new Date() });
    return status;
  });
}

/** Draft invoice for a Mon–Sat week, built from that week's net production. */
function buildWeeklyInvoice(monday) {
  assertIsoDate_(monday, 'week');
  monday = weekMonday_(monday);
  const settings = readSettings_();
  const week = getProductionWeek(monday);
  const { prices } = readPrices_();
  const customerName = settings['Weekly Customer'];
  const customer = readCustomers_().customers.find(c => c.name.toLowerCase() === customerName.toLowerCase());
  const existing = allInvoices_().invoices.find(i =>
    i.weekOf === monday && i.customer.toLowerCase() === customerName.toLowerCase());
  return {
    number: '',
    date: addDays_(monday, 5),
    weekOf: monday,
    weekLabel: week.label,
    customer: customerName,
    email: customer ? customer.email : '',
    goods: (customer && customer.goods) || settings['Weekly Goods'],
    notes: '',
    fees: 0,
    items: week.products
      .filter(p => week.totals[p])
      .map(p => ({ product: p, qty: week.totals[p], unitPrice: p in prices ? prices[p] : '' })),
    existingNumber: existing ? existing.number : '',
  };
}
