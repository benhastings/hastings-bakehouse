/**
 * Production tab: one row per day (blank Note) plus an optional LOSS/DAMAGE row
 * with negative counts. Product columns are every header except Date and Note.
 */

function readProduction_() {
  const table = readTable_(sheet_(CONFIG.tabs.production), CONFIG.production.date);
  const reserved = [CONFIG.production.date, CONFIG.production.note];
  const products = table.headers.filter(h => h && reserved.indexOf(h) === -1);
  const formatDate = sheetDateFormatter_();
  const today = todayIso_();
  const rows = table.rows.map(row => {
    const values = {};
    products.forEach(p => { values[p] = cell_(table, row, p); });
    return {
      rowNumber: row.rowNumber,
      date: normalizeDate_(cell_(table, row, CONFIG.production.date), today, formatDate),
      note: String(cell_(table, row, CONFIG.production.note) || '').trim(),
      values: values,
      raw: row,
    };
  });
  return { table: table, products: products, rows: rows };
}

function assertIsoDate_(iso, label) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) throw new Error('Invalid ' + label + ': ' + iso);
}

/** Sum of a set of rows per product, as a map of nonzero numbers. */
function sumRows_(rows, products) {
  const out = {};
  products.forEach(p => {
    const total = rows.reduce((sum, r) => sum + toNumber_(r.values[p]), 0);
    if (total) out[p] = total;
  });
  return out;
}

/** Everything the week view needs: per-day made/loss counts and net weekly totals. */
function getProductionWeek(monday) {
  assertIsoDate_(monday, 'week');
  monday = weekMonday_(monday);
  const prod = readProduction_();
  const lossNote = CONFIG.production.lossNote;
  const days = weekDays_(monday).map(date => {
    const dayRows = prod.rows.filter(r => r.date === date);
    const loss = sumRows_(dayRows.filter(r => r.note === lossNote), prod.products);
    Object.keys(loss).forEach(p => { loss[p] = Math.abs(loss[p]); });
    return {
      date: date,
      made: sumRows_(dayRows.filter(r => r.note === ''), prod.products),
      loss: loss,
      // Rows with other notes still count toward the week's totals but aren't editable here.
      otherNotes: dayRows.filter(r => r.note && r.note !== lossNote).map(r => r.note),
    };
  });
  return {
    monday: monday,
    label: formatWeekRange_(monday),
    products: prod.products,
    days: days,
    totals: sumProduction_(prod.rows, prod.products, monday, addDays_(monday, 5)),
  };
}

/** Most recent day before `date` with production, or '' if none. */
function previousProductionDay_(rows, date) {
  let best = '';
  rows.forEach(r => {
    if (r.date && r.date < date && r.date > best && r.note === '' && r.values &&
      Object.keys(r.values).some(p => toNumber_(r.values[p]))) best = r.date;
  });
  return best;
}

/**
 * One day for the entry screen: its made/loss counts, the items to list (the
 * day's own, or else the last production day's so a typical day is just typing
 * numbers), and a summary of its Mon–Sat week.
 */
function getProductionDay(date) {
  assertIsoDate_(date, 'date');
  const prod = readProduction_();
  const dayRows = prod.rows.filter(r => r.date === date);
  const lossNote = CONFIG.production.lossNote;
  const made = sumRows_(dayRows.filter(r => r.note === ''), prod.products);
  const loss = sumRows_(dayRows.filter(r => r.note === lossNote), prod.products);
  Object.keys(loss).forEach(p => { loss[p] = Math.abs(loss[p]); });

  let items = prod.products.filter(p => made[p] || loss[p]);
  let itemsFrom = '';
  if (!items.length) {
    itemsFrom = previousProductionDay_(prod.rows, date);
    if (itemsFrom) {
      const before = sumRows_(prod.rows.filter(r => r.date === itemsFrom && r.note === ''), prod.products);
      items = prod.products.filter(p => before[p]);
    }
  }

  const monday = weekMonday_(date);
  const week = weekDays_(monday).map(d => {
    const rows = prod.rows.filter(r => r.date === d);
    const sum = note => rows.filter(r => r.note === note)
      .reduce((s, r) => s + prod.products.reduce((t, p) => t + Math.abs(toNumber_(r.values[p])), 0), 0);
    return { date: d, made: sum(''), loss: sum(lossNote) };
  });
  return {
    date: date,
    products: prod.products,
    made: made,
    loss: loss,
    items: items,
    itemsFrom: itemsFrom,
    // Rows with other notes still count toward the week's totals but aren't editable here.
    otherNotes: dayRows.filter(r => r.note && r.note !== lossNote).map(r => r.note),
    week: {
      monday: monday,
      label: formatWeekRange_(monday),
      days: week,
      totals: sumProduction_(prod.rows, prod.products, monday, addDays_(monday, 5)),
    },
  };
}

/**
 * Replace one day's production. entries: [{ product, made, loss }] with loss as
 * a positive number; products left out are cleared for that day. A product not
 * yet on the Production tab gets a new column. Returns the refreshed day.
 */
function saveProductionDay(date, entries) {
  assertIsoDate_(date, 'date');
  withLock_(() => {
    const prod = readProduction_();
    const made = {};
    const loss = {};
    const added = [];
    (entries || []).forEach(e => {
      const name = String((e && e.product) || '').replace(/\s+/g, ' ').trim();
      if (!name) return;
      if (name.length > 60) throw new Error('Item name is too long: ' + name);
      if ([CONFIG.production.date, CONFIG.production.note].indexOf(name) !== -1) throw new Error('"' + name + '" can\'t be an item name.');
      // Match existing columns ignoring case, so "coffee cake muffin" doesn't make a second column.
      const known = prod.products.concat(added);
      const product = known.find(p => p.toLowerCase() === name.toLowerCase()) || name;
      if (known.indexOf(product) === -1) added.push(product);
      made[product] = (made[product] || 0) + Math.abs(toNumber_(e.made));
      loss[product] = (loss[product] || 0) + Math.abs(toNumber_(e.loss));
    });
    // Only add a column for a new item that actually has a count.
    const needed = added.filter(p => made[p] || loss[p]);
    if (needed.length) ensureHeaders_(prod.table, needed);
    const products = prod.products.concat(needed);
    upsertProductionRow_(date, '', cleanQuantities_(made, products, 1));
    upsertProductionRow_(date, CONFIG.production.lossNote, cleanQuantities_(loss, products, -1));
  });
  return getProductionDay(date);
}

/**
 * Make the sheet hold exactly `values` for (date, note). Updates the existing
 * row in place, inserts a new date-sorted row when needed, and removes a row
 * that ends up empty. If a day has several rows with the same note, the first
 * receives the total and the rest are cleared so the day's sum is unchanged.
 */
function upsertProductionRow_(date, note, values) {
  const prod = readProduction_();
  const table = prod.table;
  const matches = prod.rows.filter(r => r.date === date && r.note === note);
  const isEmpty = Object.keys(values).length === 0;
  const productCells = which => {
    const data = {};
    prod.products.forEach(p => { data[p] = which(p); });
    return data;
  };

  if (!matches.length) {
    if (isEmpty) return;
    const dated = prod.rows.filter(r => r.date);
    const index = productionInsertIndex_(dated, date, note === CONFIG.production.lossNote);
    let rowNumber;
    if (index < dated.length) {
      rowNumber = dated[index].rowNumber;
      table.sheet.insertRowBefore(rowNumber);
    } else {
      rowNumber = lastDataRow_(table) + 1;
    }
    const data = productCells(p => (p in values ? values[p] : ''));
    data[CONFIG.production.date] = { value: date, format: 'm/d' };
    data[CONFIG.production.note] = note;
    writeCells_(table, rowNumber, data);
    return;
  }

  writeCells_(table, matches[0].rowNumber, productCells(p => (p in values ? values[p] : '')));
  matches.slice(1).forEach(r => writeCells_(table, r.rowNumber, productCells(() => '')));

  // Delete rows left with nothing but a date and note, bottom-up so row numbers stay valid.
  const reserved = [CONFIG.production.date, CONFIG.production.note].concat(prod.products);
  const hasOtherData = r => table.headers.some((h, i) =>
    reserved.indexOf(h) === -1 && r.raw.values[i] !== '' && r.raw.values[i] !== null);
  const deletable = matches.filter((r, i) => (i > 0 || isEmpty) && !hasOtherData(r));
  deletable.sort((a, b) => b.rowNumber - a.rowNumber).forEach(r => table.sheet.deleteRow(r.rowNumber));
}
