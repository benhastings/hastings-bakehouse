// Sandbox for the web app: serves doGet() and backs google.script.run with the real server code running on fake
// Google services (see tools/sandbox.js). Nothing touches the real sheet, Drive or Gmail.
//
//   npm run sandbox                  -> http://localhost:8787, keeps its state in .sandbox/state.json
//   npm run sandbox -- --lan         -> also reachable from phones on the same Wi-Fi
//   npm run sandbox -- --start=blank -> start over from an empty sheet (sample | setup | blank)
//   npm run dev                      -> throwaway session: nothing saved, every restart starts fresh
//   --today=YYYY-MM-DD               -> pretend it's another day (also settable on the inspector page)
//   --port=8787
'use strict';

const http = require('http');
const os = require('os');
const path = require('path');
const { createSandbox, STARTS } = require('./sandbox');

const args = process.argv.slice(2);
const flag = name => (args.find(a => a.startsWith('--' + name + '=')) || '').slice(name.length + 3) || undefined;
const port = Number(flag('port')) || 8787;
const lan = args.includes('--lan');
const keep = args.includes('--keep');
const stateFile = keep ? path.join(__dirname, '..', '.sandbox', 'state.json') : null;
const sandbox = createSandbox({ stateFile, start: flag('start') || (args.includes('--setup') ? 'setup' : undefined), today: flag('today') });
if (sandbox.dropped.length) {
  console.warn('The saved sandbox had ' + sandbox.dropped.length + ' change(s) the current app code can\'t replay (' +
    sandbox.dropped[0].error + '). Kept the ones before it; dropped: ' + sandbox.dropped.map(a => a.fn).join(', ') + '.');
}

const SHIM = `<meta name="viewport" content="width=device-width, initial-scale=1">
<script>
  // Sandbox stand-in for google.script.run: POSTs to the local server.
  window.google = { script: { run: (function make(ok, fail) {
    return new Proxy({}, { get(_, name) {
      if (name === 'withSuccessHandler') return fn => make(fn, fail);
      if (name === 'withFailureHandler') return fn => make(ok, fn);
      return (...args) => fetch('/api/' + name, { method: 'POST', body: JSON.stringify(args) })
        .then(r => r.json()).then(r => r.error ? fail && fail(new Error(r.error)) : ok && ok(r.result))
        .catch(e => fail && fail(e));
    } });
  })() } };
</script>`;

const esc = v => String(v === undefined || v === null ? '' : v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Links the app would open in Google point at the sandbox's own copies instead.
const localLinks = json => json
  .replace(/https:\/\/drive\.google\.com\/file\/d\/([-\w]+)\/view/g, '/_file/$1')
  .replace(/https:\/\/mail\.google\.com\/mail\/[^"]*/g, '/_inspect#outbox');

function banner() {
  // A plain strip above the app, so it never covers the app's own buttons.
  return `<div style="background:#8a3b12;color:#fff;font:600 12px/1.4 system-ui,sans-serif;padding:6px 12px;text-align:center">
  SANDBOX · not connected to Google · today is ${esc(sandbox.state.today)} ·
  <a href="/_inspect" target="_blank" style="color:#fff">open inspector ↗</a></div>`;
}

const cellText = v => (Object.prototype.toString.call(v) === '[object Date]' ? v.toISOString().slice(0, 10) : v);

function inspector() {
  const { env, state } = sandbox;
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
      return f ? `<a href="/_file/${f.id}" target="_blank">${esc(b.getName())}</a>` : esc(b.getName());
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

  const drive = files.map(f => `<li class="${f.trashed ? 'gone' : ''}"><a href="/_file/${f.id}" target="_blank">${esc(f.name)}</a>${f.trashed ? ' <span class="tag">trashed (replaced)</span>' : ''}</li>`).join('')
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
<header><h1>Sandbox inspector</h1><span>Nothing here is connected to Google · <a href="/">open the app</a></span></header>
<main>
  <section>
    <h2>Controls</h2>
    <div class="controls">
      <form method="post" action="/_today"><label>Pretend today is<input type="date" name="today" value="${esc(state.today)}" required></label><button>Set day</button></form>
      <form method="post" action="/_undo"><button class="plain"${state.actions.length ? '' : ' disabled'}>Undo last change</button></form>
      <form method="post" action="/_reset" onsubmit="return confirm('Throw away everything done in the sandbox?')"><label>Start over from<select name="start">${startOptions}</select></label><button class="plain">Reset</button></form>
    </div>
    <p class="muted" style="margin:10px 0 0">${state.actions.length} change(s) since “${esc(STARTS[state.start])}”. ${stateFile ? 'Saved in .sandbox/state.json, so it survives restarts.' : 'Not saved: restarting the server starts fresh (use npm run sandbox to keep it).'} Reload this page after using the app.</p>
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

function readBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => resolve(body));
  });
}

function redirect(res, to) {
  res.statusCode = 303;
  res.setHeader('Location', to);
  res.end();
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5);
      const body = await readBody(req);
      res.setHeader('Content-Type', 'application/json');
      try {
        const result = sandbox.call(name, JSON.parse(body || '[]'));
        res.end(localLinks(JSON.stringify({ result })));
      } catch (e) {
        res.end(JSON.stringify({ error: e.message }));
      }
      return;
    }
    if (req.method === 'POST' && ['/_today', '/_undo', '/_reset'].includes(url.pathname)) {
      const form = new URLSearchParams(await readBody(req));
      if (url.pathname === '/_today') sandbox.setToday(form.get('today'));
      if (url.pathname === '/_undo') sandbox.undo();
      if (url.pathname === '/_reset') sandbox.reset(form.get('start'));
      return redirect(res, '/_inspect');
    }
    if (url.pathname === '/') {
      const html = sandbox.env.app.doGet().getContent().replace('<base target="_top">', SHIM).replace(/<body([^>]*)>/, m => m + banner());
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(html);
    }
    if (url.pathname === '/_inspect') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(inspector());
    }
    if (url.pathname === '/favicon.ico') { res.statusCode = 204; return res.end(); }
    const file = url.pathname.match(/^\/_file\/([-\w]+)$/);
    if (file && sandbox.env.drive.files[file[1]]) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(sandbox.env.drive.files[file[1]].blob.content);
    }
    // Raw JSON, handy for scripts.
    if (url.pathname === '/_drafts' || url.pathname === '/_sheet') {
      const env = sandbox.env;
      const out = url.pathname === '/_drafts'
        ? env.gmail.drafts.map(d => ({ to: d.to, subject: d.subject, body: d.body, from: d.opts.from, replyTo: d.opts.replyTo, deleted: d.deleted }))
        : Object.fromEntries(env.spreadsheet.sheets.map(s => [s.name, s.dump()]));
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(out, null, 2));
    }
    res.statusCode = 404;
    res.end('Not found');
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(e.message);
  }
}).listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
  console.log('Sandbox app:       http://localhost:' + port);
  console.log('Sandbox inspector: http://localhost:' + port + '/_inspect');
  if (lan) {
    Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal)
      .forEach(i => console.log('On a phone (same Wi-Fi): http://' + i.address + ':' + port));
  }
  console.log('Today is ' + sandbox.state.today + '. ' + sandbox.state.actions.length + ' saved change(s). Ctrl+C to stop.');
});
