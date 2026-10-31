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
const { banner, renderInspector, localLinks, asPdfPage } = require('./inspector');

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

const LINKS = { app: '/', inspect: '/_inspect', file: id => '/_file/' + id };

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
        res.end(localLinks(JSON.stringify({ result }), LINKS));
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
      const html = sandbox.env.app.doGet().getContent().replace('<base target="_top">', SHIM).replace(/<body([^>]*)>/, m => m + banner(sandbox.state.today, LINKS));
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(html);
    }
    if (url.pathname === '/_inspect') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(renderInspector(sandbox, {
        STARTS,
        links: LINKS,
        saved: stateFile ? 'Saved in .sandbox/state.json, so it survives restarts.'
          : 'Not saved: restarting the server starts fresh (use npm run sandbox to keep it).',
      }));
    }
    if (url.pathname === '/favicon.ico') { res.statusCode = 204; return res.end(); }
    const file = url.pathname.match(/^\/_file\/([-\w]+)$/);
    if (file && sandbox.env.drive.files[file[1]]) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(asPdfPage(sandbox.env.drive.files[file[1]].blob.content));
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
