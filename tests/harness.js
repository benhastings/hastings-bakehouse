// Loads the Apps Script sources into a Node vm context with in-memory fakes of
// the Google services they use, so server code can be tested without deploying.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'apps-script');
const TZ = 'America/New_York';

function formatIso(date, tz) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** A date as Sheets would store it: midnight in the sheet's zone (approximated as noon UTC). */
function sheetDate(iso) {
  return new Date(iso + 'T12:00:00Z');
}

class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    Object.assign(this, { sheet, row, col, rows, cols });
  }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const line = [];
      for (let c = 0; c < this.cols; c++) line.push(this.sheet.get(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  getValue() { return this.sheet.get(this.row, this.col); }
  setValues(values) {
    values.forEach((line, r) => line.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v)));
    return this;
  }
  setValue(v) { this.sheet.set(this.row, this.col, v); return this; }
  setNumberFormat(fmt) {
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) this.sheet.formats[(this.row + r) + ':' + (this.col + c)] = fmt;
    }
    return this;
  }
  setFontWeight() { return this; }
}

class FakeSheet {
  constructor(name, rows) {
    this.name = name;
    this.data = (rows || []).map(r => r.slice());
    this.formats = {};
  }
  getName() { return this.name; }
  get(row, col) {
    const line = this.data[row - 1];
    const v = line ? line[col - 1] : undefined;
    return v === undefined || v === null ? '' : v;
  }
  set(row, col, value) {
    while (this.data.length < row) this.data.push([]);
    const line = this.data[row - 1];
    while (line.length < col) line.push('');
    // Mimic Sheets parsing typed input: ISO date strings become dates unless the cell is plain text.
    if (typeof value === 'string' && this.formats[row + ':' + col] !== '@' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      value = sheetDate(value);
    }
    line[col - 1] = value;
  }
  getLastRow() {
    for (let i = this.data.length; i > 0; i--) {
      if (this.data[i - 1].some(v => v !== '' && v !== undefined && v !== null)) return i;
    }
    return 0;
  }
  getLastColumn() { return Math.max(0, ...this.data.map(r => r.length)); }
  getDataRange() { return new FakeRange(this, 1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  getRange(row, col, rows, cols) { return new FakeRange(this, row, col, rows || 1, cols || 1); }
  insertRowBefore(row) {
    this.data.splice(row - 1, 0, []);
    this.shiftFormats(row, 1);
  }
  deleteRow(row) {
    this.data.splice(row - 1, 1);
    this.shiftFormats(row + 1, -1);
  }
  shiftFormats(fromRow, delta) {
    const next = {};
    Object.entries(this.formats).forEach(([key, fmt]) => {
      const [r, c] = key.split(':').map(Number);
      if (delta < 0 && r === fromRow - 1) return;
      next[(r >= fromRow ? r + delta : r) + ':' + c] = fmt;
    });
    this.formats = next;
  }
  setFrozenRows() {}
  /** Test helper: rows as arrays with trailing blanks trimmed. */
  dump() { return this.data.map(r => { const c = r.slice(); while (c.length && (c[c.length - 1] === '' || c[c.length - 1] === undefined)) c.pop(); return c; }); }
}

class FakeSpreadsheet {
  constructor(tabs) {
    this.sheets = Object.entries(tabs).map(([name, rows]) => new FakeSheet(name, rows));
  }
  getSheetByName(name) { return this.sheets.find(s => s.name === name) || null; }
  insertSheet(name) { const s = new FakeSheet(name, []); this.sheets.push(s); return s; }
  getSpreadsheetTimeZone() { return TZ; }
  getId() { return 'SPREADSHEET_ID_0000000000000000'; }
  getEditors() { return [{ getEmail: () => 'ben@example.com' }, { getEmail: () => 'partner@example.com' }]; }
}

function iterator(list) {
  let i = 0;
  return { hasNext: () => i < list.length, next: () => list[i++] };
}

class FakeFolder {
  constructor(name) { this.name = name; this.folders = []; this.files = []; this.editors = []; }
  getId() { return this.id; }
  getName() { return this.name; }
  createFolder(name) { const f = new FakeFolder(name); this.folders.push(f); this.drive.register(f); return f; }
  getFoldersByName(name) { return iterator(this.folders.filter(f => f.name === name)); }
  createFile(blob) {
    const id = this.drive.newId('file');
    const file = { id, blob, trashed: false, name: blob.getName(), getId: () => id, getUrl: () => 'https://drive.google.com/file/d/' + id + '/view', setTrashed(t) { this.trashed = t; } };
    this.files.push(file);
    this.drive.files[id] = file;
    return file;
  }
  addEditors(emails) { this.editors.push(...emails); }
}

function makeServices(tabs, options) {
  const spreadsheet = new FakeSpreadsheet(tabs);
  const drive = {
    folders: {},
    files: {},
    // IDs count up per fake Drive, so replaying the same steps gives the same IDs.
    nextId: 1,
    newId(prefix) { return prefix + String(this.nextId++).padStart(28, '0'); },
    register(f) { f.drive = drive; f.id = drive.newId('folder'); this.folders[f.id] = f; return f; },
  };
  const rootParent = drive.register(new FakeFolder('Bakehouse'));
  const gmail = { drafts: [], aliases: (options && options.aliases) || [] };

  const blob = (content, type, name) => ({
    content, type, name,
    getName() { return this.name; },
    setName(n) { this.name = n; return this; },
    getAs(t) { return blob(this.content, t, this.name); },
  });

  return {
    spreadsheet, drive, gmail, rootParent,
    globals: {
      SpreadsheetApp: {
        getActiveSpreadsheet: () => spreadsheet,
        flush() {},
        getUi: () => { throw new Error('No UI in tests'); },
      },
      Utilities: {
        formatDate: (date, tz, fmt) => {
          if (fmt !== 'yyyy-MM-dd') throw new Error('Unsupported format ' + fmt);
          return formatIso(date, tz);
        },
        newBlob: blob,
      },
      LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
      Session: {
        getActiveUser: () => ({ getEmail: () => 'ben@example.com' }),
        getScriptTimeZone: () => TZ,
      },
      DriveApp: {
        getFolderById: id => { if (!drive.folders[id]) throw new Error('No folder ' + id); return drive.folders[id]; },
        getFileById: id => {
          if (id === spreadsheet.getId()) return { getParents: () => iterator([rootParent]) };
          if (!drive.files[id]) throw new Error('No file ' + id);
          return drive.files[id];
        },
        createFolder: name => drive.register(new FakeFolder(name)),
      },
      GmailApp: {
        getAliases: () => gmail.aliases,
        createDraft(to, subject, body, opts) {
          const id = 'r-draft-' + (gmail.drafts.length + 1);
          const draft = { id, to, subject, body, opts, deleted: false, getId: () => id, getMessage: () => ({ getId: () => 'msg' + id }), deleteDraft() { this.deleted = true; } };
          gmail.drafts.push(draft);
          return draft;
        },
        getDraft(id) { const d = gmail.drafts.find(x => x.id === id); if (!d) throw new Error('no draft'); return d; },
      },
      ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }) },
    },
  };
}

/** Compile an Apps Script HTML template (<? ?>, <?= ?>, <?!= ?>) into a function of its variables. */
function compileTemplate(source, context) {
  let code = 'let __out = "";\n';
  const re = /<\?(!?=)?([\s\S]*?)\?>/g;
  let last = 0;
  let m;
  while ((m = re.exec(source))) {
    code += '__out += ' + JSON.stringify(source.slice(last, m.index)) + ';\n';
    if (m[1] === '=') code += '__out += __esc(' + m[2] + ');\n';
    else if (m[1] === '!=') code += '__out += (' + m[2] + ');\n';
    else code += m[2] + '\n';
    last = re.lastIndex;
  }
  code += '__out += ' + JSON.stringify(source.slice(last)) + ';\nreturn __out;';
  return vm.runInContext('(function (__vars, __esc) { with (__vars) { ' + code + ' } })', context);
}

const escapeHtml = v => String(v === undefined || v === null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Create a fresh app instance.
 * tabs: { tabName: rows[][] }, today: 'YYYY-MM-DD'
 */
function loadApp(tabs, options) {
  const opts = Object.assign({}, options, { today: (options && options.today) || '2026-10-08' });
  const services = makeServices(tabs, opts);
  // "Now" is 3pm UTC (10–11am Eastern) on the chosen day; setToday() moves it.
  let fixedNow = new Date(opts.today + 'T15:00:00Z').getTime();
  class FixedDate extends Date {
    constructor(...args) { if (args.length) super(...args); else super(fixedNow); }
    static now() { return fixedNow; }
  }
  const context = vm.createContext(Object.assign({ console, Date: FixedDate }, services.globals));

  const readHtml = name => fs.readFileSync(path.join(SRC, name + '.html'), 'utf8');
  const output = content => {
    const o = { getContent: () => content };
    ['setTitle', 'addMetaTag', 'setFaviconUrl', 'setWidth', 'setHeight'].forEach(fn => { o[fn] = () => o; });
    return o;
  };
  context.HtmlService = {
    createHtmlOutputFromFile: name => output(readHtml(name)),
    createHtmlOutput: html => output(html),
    createTemplateFromFile(name) {
      const render = compileTemplate(readHtml(name), context);
      const template = { evaluate: () => output(render(template, escapeHtml)) };
      return template;
    },
  };

  // Same order clasp pushes them (see .clasp.json.example), then the rest alphabetically.
  const first = ['Lib.js', 'Config.js'];
  const files = first.concat(fs.readdirSync(SRC).filter(f => f.endsWith('.js') && first.indexOf(f) === -1).sort());
  const source = files.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n;\n');
  // Expose top-level function and const bindings on a single object for tests.
  const names = Array.from(source.matchAll(/^(?:function\s+(\w+)|const\s+(\w+)\s*=)/gm)).map(m => m[1] || m[2]);
  vm.runInContext(source + '\n;globalThis.__app = {' + names.join(',') + '};', context, { filename: 'apps-script' });
  const setToday = iso => { fixedNow = new Date(iso + 'T15:00:00Z').getTime(); };
  return Object.assign({ app: context.__app, context, setToday }, services);
}

/** A sheet shaped like the real one (row 1 blank, headers on row 2), with made-up data. */
function sampleTabs() {
  return {
    Invoices: [
      [],
      ['Date', '', 'Customer', 'Goods', 'Amount', 'Notes'],
      [sheetDate('2026-09-19'), '', 'Demarest', 'Coffee Shop', 500, ''],
      ['', '', 'Smith', 'Celebration Cake', 60, ''],
      [sheetDate('2026-09-26'), '', 'Demarest', 'Coffee Shop', 450.5, ''],
      ['', '', 'Jones', 'Celebration Cake', -25, 'PROMO/GIFT'],
    ],
    Production: [
      [],
      ['Date', 'Note', 'Coffee Cake Muffin', 'Lemon Blueberry Muffin', 'Vanilla Cake Pop', 'Chocolate Cake Pop', 'Gluten Free Cookie'],
      ['9/28', '', 20, 30, '', '', ''],
      ['9/29', '', 10, '', 12, 12, ''],
      ['9/29', 'LOSS/DAMAGE', -2, '', '', -1, ''],
      ['10/1', '', 15, 15, '', '', 8],
      [sheetDate('2026-10-03'), '', 5, 5, '', '', ''],
      ['10/6', '', 40, 20, '', '', ''],
    ],
    Expenses: [],
  };
}

/** The same sheet with headers only: what a fresh copy of the real sheet looks like with its rows cleared. */
function blankTabs() {
  const tabs = sampleTabs();
  return { Invoices: tabs.Invoices.slice(0, 2), Production: tabs.Production.slice(0, 2), Expenses: [] };
}

module.exports = { loadApp, sampleTabs, blankTabs, sheetDate, formatIso, compileTemplate, escapeHtml, TZ };
