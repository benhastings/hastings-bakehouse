/**
 * Pure helpers with no Google service calls, so they can be unit tested in Node.
 * Dates cross the client/server boundary as ISO strings ('YYYY-MM-DD') because
 * google.script.run cannot return Date objects.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function pad2_(n) {
  return String(n).padStart(2, '0');
}

/** Build an ISO date string from numeric parts. */
function isoFromParts_(year, month, day) {
  return year + '-' + pad2_(month) + '-' + pad2_(day);
}

/** Parse 'YYYY-MM-DD' into a UTC Date, used only for calendar arithmetic. */
function utcFromIso_(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function isoFromUtc_(date) {
  return isoFromParts_(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function addDays_(iso, days) {
  return isoFromUtc_(new Date(utcFromIso_(iso).getTime() + days * DAY_MS));
}

/** 0 = Sunday ... 6 = Saturday */
function dayOfWeek_(iso) {
  return utcFromIso_(iso).getUTCDay();
}

/**
 * Normalize a Production/Invoices date cell to ISO.
 * Handles Date objects (via formatDate, which applies the sheet's time zone),
 * ISO strings, and typed text like '7/20' or '7/20/26'. Text without a year is
 * assumed to be this year, unless that puts it more than 60 days in the future
 * (e.g. reading '12/28' in January), in which case it is last year.
 * Returns '' when the cell is not a date.
 */
function normalizeDate_(value, todayIso, formatDate) {
  if (value === '' || value === null || value === undefined) return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return isNaN(value.getTime()) ? '' : formatDate(value);
  }
  const text = String(value).trim();
  let m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return isoFromParts_(Number(m[1]), Number(m[2]), Number(m[3]));
  m = text.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/);
  if (!m) return '';
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  if (m[3]) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return isoFromParts_(year, month, day);
  }
  const todayYear = Number(todayIso.slice(0, 4));
  const guess = isoFromParts_(todayYear, month, day);
  return guess > addDays_(todayIso, 60) ? isoFromParts_(todayYear - 1, month, day) : guess;
}

/** Monday of the Mon–Sat week containing iso. Sunday belongs to the week that just ended. */
function weekMonday_(iso) {
  const dow = dayOfWeek_(iso);
  return addDays_(iso, dow === 0 ? -6 : 1 - dow);
}

/** The six working days (Mon–Sat) starting at monday. */
function weekDays_(monday) {
  return [0, 1, 2, 3, 4, 5].map(i => addDays_(monday, i));
}

/**
 * Week to invoice by default: on Saturday or Sunday it is the week ending that
 * Saturday; earlier in the week it is the previous (completed) week.
 */
function defaultInvoiceMonday_(todayIso) {
  const dow = dayOfWeek_(todayIso);
  const monday = weekMonday_(todayIso);
  return dow === 6 || dow === 0 ? monday : addDays_(monday, -7);
}

/** 'Oct 5 – Oct 10, 2026' */
function formatWeekRange_(monday) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmt = iso => months[Number(iso.slice(5, 7)) - 1] + ' ' + Number(iso.slice(8, 10));
  const saturday = addDays_(monday, 5);
  return fmt(monday) + ' – ' + fmt(saturday) + ', ' + saturday.slice(0, 4);
}

/** 'M/D/YYYY' for display on invoices. */
function formatUsDate_(iso) {
  if (!iso) return '';
  return Number(iso.slice(5, 7)) + '/' + Number(iso.slice(8, 10)) + '/' + iso.slice(0, 4);
}

/** Next 'YYYY-NNN' invoice number given every existing number in the sheet. */
function nextInvoiceNumber_(existing, year) {
  const prefix = String(year) + '-';
  let max = 0;
  existing.forEach(n => {
    const text = String(n || '').trim();
    if (text.indexOf(prefix) === 0) {
      const seq = parseInt(text.slice(prefix.length), 10);
      if (!isNaN(seq) && seq > max) max = seq;
    }
  });
  return prefix + String(max + 1).padStart(3, '0');
}

function toCents_(value) {
  const n = typeof value === 'number' ? value : parseFloat(String(value || '').replace(/[$,]/g, ''));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

function toNumber_(value) {
  if (value === '' || value === null || value === undefined) return 0;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(/[$,]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** Line totals, subtotal and total, computed in cents to avoid float drift. */
function computeTotals_(items, fees) {
  let subtotalCents = 0;
  const lines = items.map(item => {
    const qty = toNumber_(item.qty);
    const lineCents = Math.round(toCents_(item.unitPrice) * qty);
    subtotalCents += lineCents;
    return { product: item.product, qty: qty, unitPrice: toCents_(item.unitPrice) / 100, lineTotal: lineCents / 100 };
  });
  const feesCents = toCents_(fees);
  return {
    lines: lines,
    subtotal: subtotalCents / 100,
    fees: feesCents / 100,
    total: (subtotalCents + feesCents) / 100,
  };
}

function formatMoney_(value) {
  const n = Number(value) || 0;
  const sign = n < 0 ? '-' : '';
  const [whole, cents] = Math.abs(n).toFixed(2).split('.');
  return sign + '$' + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + cents;
}

/** Replace {key} placeholders; unknown keys are left as-is. */
function fillTemplate_(template, vars) {
  return String(template || '').replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : match);
}

/**
 * Net quantity per product across rows dated within [fromIso, toIso].
 * rows: [{ date: iso, values: { product: number } }] — LOSS/DAMAGE rows carry
 * negative values, so the sum is already net.
 */
function sumProduction_(rows, products, fromIso, toIso) {
  const totals = {};
  products.forEach(p => { totals[p] = 0; });
  rows.forEach(row => {
    if (!row.date || row.date < fromIso || row.date > toIso) return;
    products.forEach(p => { totals[p] += toNumber_(row.values[p]); });
  });
  return totals;
}

/**
 * Where a new Production row for (date, isLoss) belongs, as an index into rows
 * (insert before rows[index]; rows.length means append). Rows stay date-sorted,
 * and a day's LOSS/DAMAGE row sits after its production row.
 */
function productionInsertIndex_(rows, date, isLoss) {
  let index = 0;
  for (let i = 0; i < rows.length; i++) {
    const d = rows[i].date;
    if (!d) continue;
    if (d < date || (isLoss && d === date)) index = i + 1;
  }
  return index;
}

/** Remove empty/zero quantities and sanitize a product → qty map from the client. */
function cleanQuantities_(map, products, sign) {
  const out = {};
  products.forEach(p => {
    const n = Math.abs(toNumber_(map && map[p]));
    if (n) out[p] = sign * n;
  });
  return out;
}
