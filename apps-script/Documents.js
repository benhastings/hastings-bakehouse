/**
 * Invoice PDF (rendered from InvoicePrint.html) and the Gmail draft.
 */

/** Everything InvoicePrint.html needs, preformatted. */
function invoiceView_(inv, settings, preview) {
  const totals = computeTotals_(inv.items, inv.fees);
  return {
    businessName: settings['Business Name'],
    businessEmail: settings['Business Email'],
    footer: settings['Invoice Footer'],
    logo: LOGO_DATA_URI,
    number: inv.number,
    date: formatUsDate_(inv.date),
    weekLabel: inv.weekOf ? formatWeekRange_(inv.weekOf) : '',
    customer: inv.customer,
    email: inv.email,
    notes: inv.notes,
    lines: totals.lines.map(l => ({
      product: l.product,
      qty: l.qty,
      unitPrice: formatMoney_(l.unitPrice),
      lineTotal: formatMoney_(l.lineTotal),
    })),
    subtotal: formatMoney_(totals.subtotal),
    fees: formatMoney_(totals.fees),
    total: formatMoney_(totals.total),
    preview: Boolean(preview),
  };
}

/** preview: on screen there are no @page margins, so the page draws its own. */
function renderInvoiceHtml_(inv, settings, preview) {
  const template = HtmlService.createTemplateFromFile('InvoicePrint');
  template.data = invoiceView_(inv, settings, preview);
  return template.evaluate().getContent();
}

function pdfName_(inv, settings) {
  const safe = s => String(s).replace(/[\\/:*?"<>|]/g, '-');
  return safe(settings['Business Name'] + ' Invoice ' + inv.number + ' - ' + inv.customer + ' - ' + inv.date) + '.pdf';
}

function driveIdFromUrl_(url) {
  const m = String(url || '').match(/[-\w]{25,}/);
  return m ? m[0] : '';
}

/** <PDF folder>/<year>, creating the year folder on first use. */
function invoiceFolder_(year, settings) {
  const id = settings['PDF Folder Id'];
  if (!id) throw new Error('No PDF folder configured. Run Bakehouse → Set up sheet.');
  let root;
  try {
    root = DriveApp.getFolderById(id);
  } catch (e) {
    throw new Error('Can\'t open the invoice PDF folder. Ask whoever ran setup to share it with you.');
  }
  const existing = root.getFoldersByName(String(year));
  return existing.hasNext() ? existing.next() : root.createFolder(String(year));
}

/** (Re)generate the PDF for a saved invoice, replacing any previous one. */
function createInvoicePdf_(inv, settings) {
  const html = renderInvoiceHtml_(inv, settings);
  const name = pdfName_(inv, settings);
  const pdf = Utilities.newBlob(html, 'text/html', name.replace(/\.pdf$/, '.html'))
    .getAs('application/pdf').setName(name);
  const oldId = driveIdFromUrl_(inv.pdfUrl);
  if (oldId) {
    try { DriveApp.getFileById(oldId).setTrashed(true); } catch (e) { /* already gone or not ours */ }
  }
  const file = invoiceFolder_(inv.date.slice(0, 4), settings).createFile(pdf);
  const { table } = allInvoices_();
  writeCells_(table, inv.rowNumber, { 'PDF Link': file.getUrl() });
  return { blob: pdf, url: file.getUrl() };
}

/** Client-callable: regenerate just the PDF. */
function createInvoicePdf(number) {
  const settings = readSettings_();
  return { pdfUrl: createInvoicePdf_(getInvoice(number), settings).url };
}

/** Preview HTML for the client (same template as the PDF). */
function previewInvoiceHtml(raw) {
  const inv = cleanInvoice_(raw);
  inv.number = inv.number || '(assigned on save)';
  return renderInvoiceHtml_(inv, readSettings_(), true);
}

/**
 * Generate the PDF and create a Gmail draft to the customer in the current
 * user's mailbox. Sent from the business address when it's set up as a
 * "Send mail as" alias; Reply-To is always the business address.
 */
function createInvoiceDraft(number) {
  const settings = readSettings_();
  const inv = getInvoice(number);
  if (!inv.email) throw new Error('Add an email address for ' + inv.customer + ' first.');
  const pdf = createInvoicePdf_(inv, settings);
  const vars = {
    number: inv.number,
    customer: inv.customer,
    date: formatUsDate_(inv.date),
    total: formatMoney_(inv.amount),
    week: inv.weekOf ? formatWeekRange_(inv.weekOf) : '',
    description: inv.weekOf ? 'the week of ' + formatWeekRange_(inv.weekOf) : (inv.goods || 'your order').toLowerCase(),
  };
  const businessEmail = settings['Business Email'];
  const options = {
    attachments: [pdf.blob],
    name: settings['Business Name'],
    replyTo: businessEmail,
  };
  const fromBusiness = GmailApp.getAliases().some(a => a.toLowerCase() === businessEmail.toLowerCase());
  if (fromBusiness) options.from = businessEmail;

  if (inv.draftId) {
    try { GmailApp.getDraft(inv.draftId).deleteDraft(); } catch (e) { /* sent or deleted already */ }
  }
  const draft = GmailApp.createDraft(inv.email, fillTemplate_(settings['Email Subject'], vars),
    fillTemplate_(settings['Email Body'], vars), options);

  const { table } = allInvoices_();
  const status = inv.status === 'sent' || inv.status === 'paid' ? inv.status : 'drafted';
  writeCells_(table, inv.rowNumber, { 'Draft Id': draft.getId(), Status: status, 'Updated At': new Date() });

  const user = Session.getActiveUser().getEmail();
  return {
    number: inv.number,
    pdfUrl: pdf.url,
    draftUrl: 'https://mail.google.com/mail/?authuser=' + encodeURIComponent(user) +
      '#drafts?compose=' + draft.getMessage().getId(),
    from: fromBusiness ? businessEmail : user,
    fromBusiness: fromBusiness,
  };
}

/** Save, then make the PDF and draft. A save that succeeds is never lost if the draft step fails. */
function saveAndDraftInvoice(raw) {
  const saved = saveInvoice(raw);
  try {
    return Object.assign(saved, createInvoiceDraft(saved.number));
  } catch (e) {
    return Object.assign(saved, { draftError: e.message });
  }
}
