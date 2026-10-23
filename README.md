# Hastings Bakehouse

Production tracking and invoicing for Hastings Bakehouse, as a Google Apps Script web app attached to the
**Hastings Bakehouse Accounting** sheet.

- **Production**: enter each day's counts and loss/damage (Mon–Sat). Writes the `Production` tab in the same format it already uses.
- **Invoice**: build the week's invoice from production (net of loss/damage × saved prices) or enter a one-off invoice. Saving writes the `Invoices` tab (plus line items).
- **Save & create Gmail draft**: generates the PDF into a shared Drive folder and creates a Gmail draft to the customer with it attached. Review it in Gmail, then hit send.
- **History**: reopen, duplicate, or mark invoices sent/paid.

> **This repo is public.** Never commit the sheet's ID, `.clasp.json`, customer data, email addresses, or exported PDFs.
> Business settings (email text, business address, PDF folder) live in the sheet's `Settings` tab, not in code.

## How access works

The web app runs **as whoever opens it** (`executeAs: USER_ACCESSING`), so:

- Only people who can **edit the accounting sheet** can use it. Anyone else gets a permission error. Share the sheet to grant access.
- Each person approves the app's permissions once, the first time they open it. Google shows an "unverified app" warning because this is a private script. Click **Advanced → Go to … (unsafe)**.
- Gmail drafts land in **the mailbox of whoever clicked**. If that account has `hastingsbakehouse@gmail.com` set up as a
  **"Send mail as"** address (Gmail → Settings → Accounts), drafts are sent from it. Otherwise they come from the person's own
  address, with Reply-To set to the business address.

## Sheet changes

The first time the app opens, it offers **Set up sheet**, which is also under the sheet's **Bakehouse** menu. It only adds things:

| Where | What |
|---|---|
| `Invoices` | New columns to the right: Invoice #, Status, Week Of, Fees, Email, PDF Link, Draft Id, Updated At |
| `Invoice Items` (new) | One row per line item: Invoice #, Product, Qty, Unit Price, Line Total |
| `Prices` (new) | Starts empty. A product's price is saved the first time it's invoiced, then filled in automatically. |
| `Customers` (new) | Name, Email, Default Goods. Fills itself from invoices. |
| `Settings` (new) | Business email, weekly customer (`Demarest`), email subject/body templates, invoice footer, PDF folder |
| Drive | A "Hastings Bakehouse Invoices" folder next to the sheet, shared with the sheet's editors. PDFs go in per-year subfolders. |

Invoice numbers are `YYYY-NNN` (e.g. `2026-001`) and restart each year. Older invoice rows are left as they are and show in History as "entered before the app".

Production columns are read from the `Production` header row, so adding a product is just adding a column there.

## First-time setup

1. **Install clasp** (Google's Apps Script CLI) and log in with your own Google account:
   ```sh
   npm install -g @google/clasp
   clasp login
   ```
   Also turn on the Apps Script API: https://script.google.com/home/usersettings
2. **Create the script attached to the sheet.** Open the accounting sheet → **Extensions → Apps Script**. In the editor, go to
   **Project Settings** and copy the **Script ID**.
3. **Point clasp at it:**
   ```sh
   cp .clasp.json.example .clasp.json   # then paste the Script ID into it
   ```
4. **Check the time zone.** `apps-script/appsscript.json` uses `America/New_York`. If the sheet uses a different zone
   (File → Settings), change it to match. Setup warns if they differ.
5. **Push and deploy:**
   ```sh
   npm run push       # uploads apps-script/ to the project
   clasp deploy --description "first deploy"
   ```
   Or deploy from the editor (**Deploy → New deployment → Web app**). The settings come from `appsscript.json`: *Execute as: User accessing*, *Who has access: Anyone with a Google account*. Access is still limited to people who can edit the sheet.
6. Open the web app URL (also under **Bakehouse → Open invoicing app** in the sheet), approve permissions, and click **Set up sheet**.
7. On each phone, open the URL and **Add to Home Screen**.

## Updating

```sh
npm run deploy    # runs the tests, pushes, and updates the existing deployment
```

`npm run deploy` reads the deployment ID from `.deployment-id` (gitignored; `clasp deployments` lists IDs). Updating the
existing deployment keeps the same URL, so home-screen shortcuts keep working. Use `npm run push` to upload without deploying;
the editor's **Deploy → Test deployments** URL always runs the latest pushed code.

## Developing locally

```sh
npm test                 # unit + integration tests against an in-memory copy of the sheet
npm run dev              # http://localhost:8787 runs the real UI and server code on sample data
npm run dev -- --setup --today=2026-10-11
```

`tests/harness.js` loads the Apps Script files into Node with fake `SpreadsheetApp`, `DriveApp`, `GmailApp`, and so on. The dev
server uses the same fakes, so nothing touches the real sheet. `/_sheet` and `/_drafts` on the dev server show what was written.

The PDF is rendered by Google's HTML-to-PDF converter, which only supports simple CSS (tables, no flexbox, no web fonts), so
`InvoicePrint.html` sticks to those. Check a real PDF after changing it.

`apps-script/Logo.js` is generated from `bakehouse.png` by `tools/build-logo.sh`.

## Layout

```
apps-script/        deployed to Apps Script by clasp
  Code.js           doGet + getAppData
  Production.js     Production tab read/write
  Invoices.js       Invoices, Invoice Items, Prices, Customers
  Documents.js      PDF + Gmail draft
  Setup.js          sheet setup + Bakehouse menu
  Sheets.js         header-based sheet helpers
  Lib.js            pure date/money/number helpers (unit tested)
  Index.html, Styles.html, Client.html   the app UI
  InvoicePrint.html invoice PDF template
tests/              node --test suites + fake Google services
tools/              dev server, logo builder
index.html          public landing page (GitHub Pages)
img/, fonts/        site images (EXIF stripped) and self-hosted fonts
robots.txt, sitemap.xml, 404.html   search and error pages for the site
invoice-form.html   original static invoice page (GitHub Pages, noindex), to be retired once the app is live
```

## Website

The public site is served by GitHub Pages from `main`: a home page (`index.html`) and four section pages, each an
`index.html` in its own folder (`floral-bouquets/`, `wedding-cakes/`, `celebration-cakes/`, `coffee-house-treats/`).
It is plain HTML with one shared stylesheet (`css/site.css`) and one small script (`js/site.js`) that loads each photo
as it nears the screen and drives the featured-post row. There is no build step, so the header, footer and contact
block are repeated in each page; change them in all five.

- **Photos**: never commit camera originals. They carry GPS location in their EXIF data. Export web copies with the metadata stripped:
  `magick original.jpeg -auto-orient -resize 1800x -strip -quality 74 img/name-1800.jpg`, plus a `-900` size, and
  `.webp` versions of both (`magick img/name-1800.jpg -quality 70 img/name-1800.webp`). Tiles, galleries and the
  featured-post row use 600px squares: `magick original.jpeg -auto-orient -gravity center -resize 600x600^ -extent 600x600 -strip -quality 76 img/sq-name.jpg`, plus `.webp`.
  Phone photos that are only ~960px wide (like the celebration cakes, `img/cc-*`) are exported at 960 and 600 wide
  and shown three across in a photo band (`.tri`) so they stay sharp on wide screens.
- **Fonts**: Cormorant Garamond and Jost (SIL Open Font License), Latin subset, served from `fonts/`.
- **URLs**: the canonical link, Open Graph tags, JSON-LD, `robots.txt` and `sitemap.xml` on every page all use
  `https://benhastings.github.io/hastings-bakehouse/`. When `hastingsbakehouse.com` moves to GitHub Pages, update them
  all and change the absolute links in `404.html`.
