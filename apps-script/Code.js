/**
 * Web app entry point. The app runs as whoever opens it, so access is governed
 * by who can edit the accounting sheet: anyone else gets a permission error.
 *
 * Naming: functions ending in _ are private (not callable from the browser).
 */

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Hastings Bakehouse')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setFaviconUrl('https://benhastings.github.io/hastings-bakehouse/fav/favicon-96x96.png');
}

/** Inline another HTML file into a template: <?!= include_('Styles') ?> */
function include_(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** Everything the client needs on load. */
function getAppData() {
  const today = todayIso_();
  const base = {
    user: Session.getActiveUser().getEmail(),
    today: today,
    productionMonday: weekMonday_(today),
    invoiceMonday: defaultInvoiceMonday_(today),
  };
  if (setupNeeded_()) return Object.assign(base, { setupNeeded: true });

  const settings = readSettings_();
  const { prices } = readPrices_();
  const { customers } = readCustomers_();
  const invoices = allInvoices_().invoices;
  const products = readProduction_().products;

  // Customers: the Customers tab first, then any other names seen on past invoices.
  const byName = {};
  customers.forEach(c => { byName[c.name.toLowerCase()] = { name: c.name, email: c.email, goods: c.goods }; });
  invoices.forEach(i => {
    const key = i.customer.toLowerCase();
    if (!i.customer) return;
    if (!byName[key]) byName[key] = { name: i.customer, email: i.email, goods: i.goods };
    else {
      if (!byName[key].email && i.email) byName[key].email = i.email;
      if (!byName[key].goods && i.goods) byName[key].goods = i.goods;
    }
  });
  const goods = {};
  invoices.forEach(i => { if (i.goods) goods[i.goods] = true; });

  return Object.assign(base, {
    setupNeeded: false,
    weeklyCustomer: settings['Weekly Customer'],
    weeklyGoods: settings['Weekly Goods'],
    businessEmail: settings['Business Email'],
    products: products.concat(Object.keys(prices).filter(p => products.indexOf(p) === -1)),
    prices: prices,
    customers: Object.keys(byName).map(k => byName[k]).sort((a, b) => a.name.localeCompare(b.name)),
    goods: Object.keys(goods).sort(),
  });
}
