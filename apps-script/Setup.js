/**
 * One-time (and safe to re-run) sheet setup. Only ever adds things: new
 * columns to the right of the Invoices tab, new tabs, and missing settings.
 */

function setupNeeded_() {
  const ss = ss_();
  const tabs = CONFIG.tabs;
  if ([tabs.items, tabs.prices, tabs.customers, tabs.settings].some(n => !ss.getSheetByName(n))) return true;
  const invoices = readTable_(sheet_(tabs.invoices), INV.date);
  if (INV.added.some(h => col_(invoices, h) === 0)) return true;
  return !readSettings_()['PDF Folder Id'];
}

/** Client- and menu-callable. Returns a list of what changed. */
function setupSheet() {
  return withLock_(() => {
    const changes = [];
    const tabs = CONFIG.tabs;

    const added = ensureHeaders_(readTable_(sheet_(tabs.invoices), INV.date), INV.added);
    if (added.length) changes.push('Invoices: added columns ' + added.join(', '));

    [[tabs.items, CONFIG.items], [tabs.prices, CONFIG.prices],
      [tabs.customers, CONFIG.customers], [tabs.settings, CONFIG.settings]].forEach(([name, headers]) => {
      if (ensureSheet_(name, headers).created) changes.push('Added tab ' + name);
    });

    const settingsTable = readTable_(sheet_(tabs.settings), 'Key');
    const existingKeys = settingsTable.rows.map(r => String(r.values[0]).trim());
    CONFIG.defaultSettings.forEach(([key, value]) => {
      if (existingKeys.indexOf(key) === -1) {
        appendRow_(settingsTable, { Key: key, Value: value });
        changes.push('Settings: added ' + key);
      }
    });

    if (!readSettings_()['PDF Folder Id']) {
      const folder = createPdfFolder_();
      writeSetting_('PDF Folder Id', folder.getId());
      changes.push('Created Drive folder "' + folder.getName() + '" for invoice PDFs and shared it with the sheet\'s editors');
    }

    const scriptTz = Session.getScriptTimeZone();
    if (scriptTz !== tz_()) {
      changes.push('Warning: script time zone (' + scriptTz + ') differs from the sheet (' + tz_() +
        '). Update timeZone in appsscript.json.');
    }
    return changes.length ? changes : ['Everything was already set up.'];
  });
}

/** Folder next to the spreadsheet (or in My Drive), shared with the sheet's editors. */
function createPdfFolder_() {
  const name = readSettings_()['Business Name'] + ' Invoices';
  let folder;
  try {
    const parents = DriveApp.getFileById(ss_().getId()).getParents();
    folder = parents.hasNext() ? parents.next().createFolder(name) : DriveApp.createFolder(name);
  } catch (e) {
    folder = DriveApp.createFolder(name);
  }
  const me = Session.getActiveUser().getEmail().toLowerCase();
  const editors = ss_().getEditors().map(u => u.getEmail()).filter(e => e && e.toLowerCase() !== me);
  if (editors.length) folder.addEditors(editors);
  return folder;
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Bakehouse')
    .addItem('Open invoicing app', 'showAppLink')
    .addItem('Set up sheet', 'runSetupFromMenu')
    .addToUi();
}

function runSetupFromMenu() {
  SpreadsheetApp.getUi().alert('Setup', setupSheet().join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}

function showAppLink() {
  const url = ScriptApp.getService().getUrl();
  const html = url
    ? '<p style="font-family:sans-serif"><a href="' + url + '" target="_blank">Open the invoicing app</a></p>'
    : '<p style="font-family:sans-serif">The web app hasn\'t been deployed yet. See the README.</p>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(300).setHeight(80), 'Bakehouse');
}
