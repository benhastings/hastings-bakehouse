/**
 * Sheet layout. Columns are always looked up by header name, so the tabs can be
 * reordered or have columns added without code changes.
 */
const CONFIG = {
  tabs: {
    invoices: 'Invoices',
    items: 'Invoice Items',
    production: 'Production',
    prices: 'Prices',
    customers: 'Customers',
    settings: 'Settings',
  },

  invoices: {
    // Existing columns (header row is found by looking for 'Date').
    date: 'Date',
    customer: 'Customer',
    goods: 'Goods',
    amount: 'Amount',
    notes: 'Notes',
    // Columns this app adds to the right of the existing ones.
    added: ['Invoice #', 'Status', 'Week Of', 'Fees', 'Email', 'PDF Link', 'Draft Id', 'Updated At'],
  },

  items: ['Invoice #', 'Product', 'Qty', 'Unit Price', 'Line Total'],
  prices: ['Product', 'Unit Price', 'Updated At'],
  customers: ['Name', 'Email', 'Default Goods'],
  settings: ['Key', 'Value'],

  production: {
    date: 'Date',
    note: 'Note',
    lossNote: 'LOSS/DAMAGE',
  },

  statuses: ['saved', 'drafted', 'sent', 'paid'],

  // Written to the Settings tab on setup; edit them there, not here.
  defaultSettings: [
    ['Business Name', 'Hastings Bakehouse'],
    ['Business Email', 'hastingsbakehouse@gmail.com'],
    ['Weekly Customer', 'Demarest'],
    ['Weekly Goods', 'Coffee Shop'],
    ['Email Subject', 'Hastings Bakehouse Invoice {number}'],
    ['Email Body',
      'Hi,\n\nAttached is invoice {number} for {description}, totaling {total}.\n\nThank you!\nHastings Bakehouse'],
    ['Invoice Footer', 'Thank you for your business!'],
    ['PDF Folder Id', ''],
  ],
};
