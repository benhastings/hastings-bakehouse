/**
 * Thin layer over SpreadsheetApp: find a tab's header row, look up columns by
 * name, and write individual cells so existing formulas in other columns are
 * never overwritten.
 */

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function tz_() {
  return ss_().getSpreadsheetTimeZone();
}

function todayIso_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

/** Formatter for Date cells, using the spreadsheet's own time zone. */
function sheetDateFormatter_() {
  const tz = tz_();
  return date => Utilities.formatDate(date, tz, 'yyyy-MM-dd');
}

function sheet_(name) {
  const sheet = ss_().getSheetByName(name);
  if (!sheet) throw new Error('Missing tab "' + name + '". Run Bakehouse → Set up sheet.');
  return sheet;
}

/**
 * Read a tab as { sheet, headerRow, headers, rows }. The header row is the first
 * of the top 10 rows containing requiredHeader. Each row is
 * { rowNumber, values } with values as the raw array.
 */
function readTable_(sheet, requiredHeader) {
  const values = sheet.getDataRange().getValues();
  let headerIndex = -1;
  for (let i = 0; i < Math.min(values.length, 10); i++) {
    if (values[i].some(cell => String(cell).trim() === requiredHeader)) {
      headerIndex = i;
      break;
    }
  }
  if (headerIndex === -1) {
    throw new Error('Could not find a "' + requiredHeader + '" header on the ' + sheet.getName() + ' tab.');
  }
  const headers = values[headerIndex].map(h => String(h).trim());
  const rows = [];
  for (let i = headerIndex + 1; i < values.length; i++) {
    rows.push({ rowNumber: i + 1, values: values[i] });
  }
  return { sheet: sheet, headerRow: headerIndex + 1, headers: headers, rows: rows };
}

/** 1-based column for a header, or 0 if absent. */
function col_(table, name) {
  return table.headers.indexOf(name) + 1;
}

function cell_(table, row, name) {
  const c = col_(table, name);
  return c ? row.values[c - 1] : '';
}

function isBlankRow_(row) {
  return row.values.every(v => v === '' || v === null);
}

/** Last row number holding any data (or the header row if none). */
function lastDataRow_(table) {
  let last = table.headerRow;
  table.rows.forEach(r => { if (!isBlankRow_(r)) last = r.rowNumber; });
  return last;
}

/**
 * Write { header: value } into rowNumber, one cell at a time. Unknown headers
 * are an error so typos never silently drop data. Values of the form
 * { value, format } also set a number format.
 */
function writeCells_(table, rowNumber, data) {
  Object.keys(data).forEach(name => {
    const c = col_(table, name);
    if (!c) throw new Error('Column "' + name + '" not found on the ' + table.sheet.getName() + ' tab.');
    const entry = data[name];
    const range = table.sheet.getRange(rowNumber, c);
    if (entry && typeof entry === 'object' && 'value' in entry) {
      // Format first, so '@' (plain text) keeps values like '2026-001' from being parsed.
      if (entry.format) range.setNumberFormat(entry.format);
      range.setValue(entry.value);
    } else {
      range.setValue(entry);
    }
  });
}

function appendRow_(table, data) {
  const rowNumber = lastDataRow_(table) + 1;
  writeCells_(table, rowNumber, data);
  table.rows.push({ rowNumber: rowNumber, values: table.headers.map(h => (h in data ? data[h] : '')) });
  return rowNumber;
}

/** Add any missing headers to the right of the existing ones. Returns names added. */
function ensureHeaders_(table, names) {
  const missing = names.filter(n => table.headers.indexOf(n) === -1);
  if (!missing.length) return [];
  let lastCol = 0;
  table.headers.forEach((h, i) => { if (h) lastCol = i + 1; });
  table.sheet.getRange(table.headerRow, lastCol + 1, 1, missing.length).setValues([missing])
    .setFontWeight('bold');
  missing.forEach((name, i) => { table.headers[lastCol + i] = name; });
  return missing;
}

/** Get a tab, creating it with a bold, frozen header row if it doesn't exist. */
function ensureSheet_(name, headers) {
  const ss = ss_();
  let sheet = ss.getSheetByName(name);
  if (sheet) {
    ensureHeaders_(readTable_(sheet, headers[0]), headers);
    return { sheet: sheet, created: false };
  }
  sheet = ss.insertSheet(name);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  sheet.setFrozenRows(1);
  return { sheet: sheet, created: true };
}

function readSettings_() {
  const sheet = ss_().getSheetByName(CONFIG.tabs.settings);
  const settings = {};
  CONFIG.defaultSettings.forEach(([key, value]) => { settings[key] = value; });
  if (!sheet) return settings;
  readTable_(sheet, 'Key').rows.forEach(row => {
    const key = String(row.values[0]).trim();
    if (key) settings[key] = String(row.values[1]);
  });
  return settings;
}

function writeSetting_(key, value) {
  const table = readTable_(sheet_(CONFIG.tabs.settings), 'Key');
  const row = table.rows.find(r => String(r.values[0]).trim() === key);
  if (row) writeCells_(table, row.rowNumber, { Value: value });
  else appendRow_(table, { Key: key, Value: value });
}

/** Run fn while holding the script lock so concurrent saves can't collide. */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Someone else is saving right now — try again in a moment.');
  try {
    return fn();
  } finally {
    SpreadsheetApp.flush();
    lock.releaseLock();
  }
}
