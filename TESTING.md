# Testing the invoicing app

Three stages, each one closer to the real thing. Move on only when the stage before it feels right.

| Stage | Where it runs | Touches Google? | What it proves |
|---|---|---|---|
| 1. Sandbox | Your computer (`npm run sandbox`) | No | The flow: screens, steps, numbers, invoice wording |
| 2. Practice sheet | Google, on a made-up copy of the sheet | Yes, but nothing real | PDFs, Gmail drafts, Drive, permissions, phones, two users |
| 3. Real sheet | Google, on the accounting sheet | Yes | Real weeks, side by side with the old way, then the switch |

## Stage 1: Sandbox (no Google)

The sandbox runs the real app code, but the Google services (Sheets, Drive, Gmail) are stand-ins on your computer.
Nothing is sent anywhere.

```sh
npm run sandbox                    # app: http://localhost:8787   inspector: http://localhost:8787/_inspect
npm run sandbox -- --lan           # also prints an address to open on a phone on the same Wi-Fi
npm run sandbox -- --start=blank   # start over from an empty sheet (sample | setup | blank)
```

- The **app** looks and works like the real one, with a brown strip on top saying it's the sandbox.
- The **inspector** (`/_inspect`) shows what the app did: every tab of the sheet, the Gmail drafts it would have created
  (to, from, subject, body, attachment), and the invoice files it would have saved to Drive. Reload it after using the app.
- **Pretend today is…** on the inspector changes the date the app thinks it is, for testing Sundays, year ends and so on.
- **Undo last change** and **Reset** let you try something, look, and take it back.
- Everything is saved in `.sandbox/state.json` (not committed), so you can stop and pick up later. `npm run dev` is the
  same thing without saving.

The sample sheet is made up: past Demarest, Smith and Jones invoices and a few weeks of production.

### Checklist

Work through these on a computer first, then on a phone with `--lan`. Write down anything confusing or wrong (a note,
a screenshot, or a GitHub issue) and we fix it in the sandbox before stage 2.

**A. First run**
- [ ] The app opens on "One-time setup" and says what it will add. Click **Set up sheet**.
- [ ] Inspector: the Invoices tab has new columns on the right; new tabs Invoice Items, Prices, Customers, Settings exist;
      nothing old changed.

**B. A week of production**
- [ ] Enter made and loss/damage numbers on a few days. The week total is made minus loss.
- [ ] Save. Inspector: one row per day, plus a `LOSS/DAMAGE` row only on days with losses.
- [ ] Change a day you already saved and save again. The row is updated, not duplicated.
- [ ] Clear a loss you entered. Its `LOSS/DAMAGE` row disappears.
- [ ] Step back to an earlier week. Its numbers match the sheet.

**C. The weekly Demarest invoice**
- [ ] **Create invoice for this week**: the quantities match the week totals.
- [ ] Prices are empty the first time. Enter them, add Demarest's email, **Save & draft email**.
- [ ] The invoice number is `2026-001`, then `2026-002` and so on.
- [ ] Inspector: one Invoices row, its line items, the prices remembered, Demarest in Customers, a draft with the invoice
      attached. Open the attachment: is the invoice right? Is the email wording what you'd send?
- [ ] Next week: prices and email fill in by themselves.
- [ ] Create the same week's invoice again. The app warns that one exists and offers to open it.
- [ ] Open an invoice from History, change a price, **Save & draft email** again. The old draft and file are replaced
      (the inspector shows them as replaced).
- [ ] Add a delivery fee. The total and the email's total include it.

**D. A one-off order**
- [ ] On **Invoice**, clear the week, enter a new customer, goods "Celebration Cake", a line item and a price. Save.
- [ ] The customer and goods are suggested next time.

**E. History**
- [ ] Recent invoices show newest first. Old rows show as "entered before the app".
- [ ] Mark one sent, then paid. Inspector: the Status column changes.
- [ ] **Duplicate** an invoice: a new unsaved copy opens with a new number on save.

**F. Dates**
- [ ] Pretend today is a **Sunday** (e.g. 2026-10-11). The invoice defaults to the week that just ended, dated Saturday.
- [ ] Pretend today is **2027-01-04**. The next invoice is `2027-001`.

**G. Mistakes**
- [ ] **Save & draft** with no email: the invoice is still saved and the app says what's missing.
- [ ] Type letters or negative numbers where quantities go. Nothing strange reaches the sheet.

**H. Both of you, on phones**
- [ ] Run with `--lan`, open the printed address on each phone. Is everything reachable with a thumb? Is anything too small?

## Stage 2: Practice sheet in Google

Same app, now on real Google services, but on a sheet full of made-up data. It's where we check what the sandbox can't:
the real PDF, real Gmail drafts, the Drive folder, permissions, and both of you on your own accounts.

### One-time setup (about 15 minutes)

1. Make the practice sheet file:
   ```sh
   npm run sandbox:sheet     # writes .sandbox/Bakehouse Sandbox.xlsx (add -- --blank for headers only)
   ```
2. Upload it to Google Drive, open it, then **File → Save as Google Sheets**. Name it **Bakehouse Sandbox** and trash
   the uploaded .xlsx. Check **File → Settings → Time zone** is *(GMT-05:00) Eastern Time*.
3. In the practice sheet: **Extensions → Apps Script**. In the editor, **Project Settings → Script ID → Copy**.
4. Point a second clasp project file at it (gitignored, separate from the real one in `.clasp.json`):
   ```sh
   cp .clasp.json.example .clasp.sandbox.json   # paste the practice Script ID into it
   npm run sandbox:push
   ```
5. In the Apps Script editor: **Deploy → Test deployments → Web app**, and copy the URL (it ends in `/dev`). This URL
   always runs the latest pushed code and only works for people who can edit the practice sheet.
6. Open the URL, approve the permissions (click **Advanced → Go to … (unsafe)** on the "unverified app" warning; it's
   your own script), and click **Set up sheet**.
7. Share the practice sheet with your wife as an **Editor** and send her the `/dev` URL.

Use **your own email addresses** as customer emails in the practice sheet, so a draft can never go to a real customer.

### Checklist

- [ ] Repeat stage 1's A–G. The practice sheet should change the same way the inspector showed.
- [ ] **PDF**: open it from the "Hastings Bakehouse Invoices" Drive folder. The logo shows, the table lines up, totals
      are right. (The sandbox can't show this: Google's PDF converter is pickier than a browser.)
- [ ] **Gmail**: the draft is in *your* Drafts with the PDF attached. From is the business address only if it's set up
      as a "Send mail as" address in your Gmail; Reply-To is always the business address. Send one to yourself.
- [ ] **Drive**: the invoice folder sits next to the sheet, has a 2026 subfolder, and is shared with your wife.
- [ ] **Dates**: dates written to the sheet are the right day (no day-early or day-late).
- [ ] **Your wife**: on her phone, she approves permissions, enters a day of production, and drafts an invoice. The draft
      lands in *her* Gmail.
- [ ] **Speed**: each save takes a couple of seconds at most on a phone.
- [ ] In the sheet, the **Bakehouse** menu appears after a reload.

After any later code change, `npm run sandbox:push` and re-check here before touching the real sheet. Keep the practice
sheet for that.

## Stage 3: The real sheet

1. **Bookmark a restore point.** In the accounting sheet: **File → Version history → Name current version** →
   "Before invoicing app". Setup only adds columns and tabs, but this makes undoing anything one click.
2. **Push and open:** `npm run push`, then use the real project's **Test deployments** URL. Click **Set up sheet**
   (it's harmless if it already ran).
3. **Run in parallel for one or two weeks.** Keep invoicing Demarest the old way, and also enter production and build
   the invoice in the app. Compare the totals. Send the old one.
4. **Switch.** When they match: `npm run deploy` (keeps the same URL), add the URL to both phones' home screens, and
   retire `invoice-form.html`.

To back out at any point: stop using the app. The added columns and tabs don't affect anything else, and the named
version restores the sheet exactly.
