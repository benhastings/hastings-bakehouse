// The sandbox's page chrome: the strip above the app, the inspector page, and link rewriting. Plain JavaScript with
// no requires, shared by tools/dev-server.js and the static demo (tools/build-demo.js).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BakehouseInspector = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const esc = v => String(v === undefined || v === null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Links the app would open in Google point at the sandbox's own copies instead.
 * links: { app, inspect, file(id) } are the sandbox's own URLs.
 */
const localLinks = (json, links) => json
  .replace(/https:\/\/drive\.google\.com\/file\/d\/([-\w]+)\/view/g, (_, id) => links.file(id))
  .replace(/https:\/\/mail\.google\.com\/mail\/[^"]*/g, links.inspect + '#outbox');

function banner(today, links) {
  // A plain strip above the app, so it never covers the app's own buttons.
  return `<div style="background:#8a3b12;color:#fff;font:600 12px/1.4 system-ui,sans-serif;padding:6px 12px;text-align:center">
  SANDBOX · not connected to Google · today is ${esc(today)} ·
  <a href="${links.inspect}" target="_blank" style="color:#fff">open inspector ↗</a></div>`;
}

/**
 * The sandbox's stand-in for a PDF viewer: the invoice file is the template's HTML, so on screen it gets the letter
 * page its @page rule gives the real PDF (8.5in wide, 0.4in margins) on a gray backdrop. Phones scale the whole page.
 */
const PAGE = `<meta name="viewport" content="width=880">
<style>@media screen {
  html { background: #525659; }
  body { box-sizing: border-box; width: 8.5in; min-height: 11in; margin: 24px auto !important; padding: 0.4in !important;
    background: #fff; box-shadow: 0 2px 12px rgba(0,0,0,.4); }
}</style>`;
const asPdfPage = html => html.replace('</head>', PAGE + '</head>');

const cellText = v => (Object.prototype.toString.call(v) === '[object Date]' ? v.toISOString().slice(0, 10) : v);

/**
 * The inspector page. The control forms post to /_today, /_undo and /_reset; the dev server handles those, and the
 * static demo catches the submits in the page instead. opts: { STARTS, links, saved: sentence about persistence }.
 */
function renderInspector(sandbox, opts) {
  const { env, state } = sandbox;
  const { STARTS, links } = opts;
  const tabs = env.spreadsheet.sheets.map(s => {
    const rows = s.dump();
    const width = Math.max(1, ...rows.map(r => r.length));
    const body = rows.map((r, i) => '<tr><th>' + (i + 1) + '</th>' +
      Array.from({ length: width }, (_, c) => '<td>' + esc(cellText(r[c])) + '</td>').join('') + '</tr>').join('');
    return `<details open><summary>${esc(s.name)} <span class="muted">(${rows.length} rows)</span></summary>
      <div class="scroll"><table class="grid">${body || '<tr><td class="muted">empty</td></tr>'}</table></div></details>`;
  }).join('');

  const files = Object.values(env.drive.files);
  const drafts = env.gmail.drafts.slice().reverse().map(d => {
    const att = (d.opts.attachments || []).map(b => {
      const f = files.find(x => x.blob === b);
      return f ? `<a href="${links.file(f.id)}" target="_blank">${esc(b.getName())}</a>` : esc(b.getName());
    }).join(', ');
    return `<article class="mail${d.deleted ? ' gone' : ''}">
      ${d.deleted ? '<p class="tag">Replaced by a newer draft (deleted)</p>' : ''}
      <dl><dt>To</dt><dd>${esc(d.to)}</dd>
      <dt>From</dt><dd>${esc(d.opts.from || 'the signed-in user (business address is not a Send-as alias)')}</dd>
      <dt>Reply-To</dt><dd>${esc(d.opts.replyTo)}</dd>
      <dt>Subject</dt><dd>${esc(d.subject)}</dd>
      <dt>Attachment</dt><dd>${att || '<span class="muted">none</span>'}</dd></dl>
      <pre>${esc(d.body)}</pre></article>`;
  }).join('') || '<p class="muted">No drafts yet. Save an invoice with “Save &amp; draft email”.</p>';

  const drive = files.map(f => `<li class="${f.trashed ? 'gone' : ''}"><a href="${links.file(f.id)}" target="_blank">${esc(f.name)}</a>${f.trashed ? ' <span class="tag">trashed (replaced)</span>' : ''}</li>`).join('')
    || '<li class="muted">No invoice files yet.</li>';

  const log = state.actions.map((a, i) => `<tr><td>${i + 1}</td><td>${esc(a.today)}</td><td><code>${esc(a.fn)}</code></td>
    <td class="args">${esc(JSON.stringify(a.args)).slice(0, 220)}</td></tr>`).reverse().join('')
    || '<tr><td colspan="4" class="muted">Nothing yet.</td></tr>';

  const startOptions = Object.entries(STARTS).map(([k, v]) => `<option value="${k}"${k === state.start ? ' selected' : ''}>${esc(v)}</option>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sandbox inspector</title>
<style>
  :root { --ink:#222; --muted:#6b6b6b; --line:#ddd; --accent:#8a3b12; --bg:#faf8f4; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 15px/1.45 system-ui, sans-serif; color: var(--ink); background: var(--bg); }
  header { background: var(--accent); color: #fff; padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; justify-content: space-between; }
  header h1 { font-size: 17px; margin: 0; }
  header a { color: #fff; }
  main { max-width: 1100px; margin: 0 auto; padding: 16px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; }
  section { min-width: 0; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 14px 16px; }
  h2 { font-size: 16px; margin: 0 0 10px; }
  .muted { color: var(--muted); }
  .controls { display: flex; flex-wrap: wrap; gap: 12px 24px; align-items: end; }
  .controls form { display: flex; gap: 8px; align-items: end; flex-wrap: wrap; }
  label { display: grid; gap: 4px; font-size: 13px; color: var(--muted); }
  input, select, button { font: inherit; padding: 7px 10px; border: 1px solid #bbb; border-radius: 6px; background: #fff; min-height: 38px; }
  button { background: var(--accent); color: #fff; border-color: var(--accent); cursor: pointer; }
  button.plain { background: #fff; color: var(--accent); }
  .scroll { overflow-x: auto; }
  table { border-collapse: collapse; font-size: 13px; }
  .grid th, .grid td { border: 1px solid var(--line); padding: 3px 7px; white-space: nowrap; }
  .grid th { background: #f1ede6; color: var(--muted); font-weight: 500; }
  details + details { margin-top: 10px; }
  summary { cursor: pointer; font-weight: 600; margin-bottom: 6px; }
  .log td { border-bottom: 1px solid var(--line); padding: 4px 8px; vertical-align: top; }
  .args { font-family: ui-monospace, monospace; font-size: 12px; color: var(--muted); word-break: break-all; }
  .mail { border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; margin-bottom: 10px; }
  .mail dl { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0 0 8px; }
  .mail dt { color: var(--muted); }
  .mail dd { margin: 0; }
  pre { white-space: pre-wrap; background: #f6f4ef; padding: 8px 10px; border-radius: 4px; margin: 0; font: 13px/1.4 ui-monospace, monospace; }
  .gone { opacity: 0.55; }
  .tag { display: inline-block; font-size: 12px; background: #eee; padding: 1px 8px; border-radius: 10px; margin: 0 0 6px; }
  .cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 18px; }
</style></head><body>
<header><h1>Sandbox inspector</h1><span>Nothing here is connected to Google · <a href="${links.app}">open the app</a></span></header>
<main>
  <section>
    <h2>Controls</h2>
    <div class="controls">
      <form method="post" action="/_today"><label>Pretend today is<input type="date" name="today" value="${esc(state.today)}" required></label><button>Set day</button></form>
      <form method="post" action="/_undo"><button class="plain"${state.actions.length ? '' : ' disabled'}>Undo last change</button></form>
      <form method="post" action="/_reset" onsubmit="return confirm('Throw away everything done in the sandbox?')"><label>Start over from<select name="start">${startOptions}</select></label><button class="plain">Reset</button></form>
    </div>
    <p class="muted" style="margin:10px 0 0">${state.actions.length} change(s) since “${esc(STARTS[state.start])}”. ${esc(opts.saved)} Reload this page after using the app.</p>
  </section>
  <div class="cols">
    <section id="outbox"><h2>Gmail drafts</h2>${drafts}</section>
    <section><h2>Drive: invoice files</h2><ul>${drive}</ul>
      <p class="muted">In the sandbox the “PDF” opens as a web page from the same template. Google’s real PDF converter is simpler; check real PDFs in stage 2.</p>
      <h2 style="margin-top:16px">Change log</h2><div class="scroll"><table class="log"><tbody>${log}</tbody></table></div></section>
  </div>
  <section><h2>Sheet</h2>${tabs}</section>
</main></body></html>`;
}

return { banner, renderInspector, localLinks, asPdfPage, esc };
});
