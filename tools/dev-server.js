// Local preview of the web app: serves doGet() and backs google.script.run with
// the real server code running against an in-memory copy of the sheet.
//   npm run dev            -> http://localhost:8787 (sheet before setup)
//   npm run dev -- --setup -> sheet already set up
//   --today=YYYY-MM-DD     -> pretend it's another day
'use strict';

const http = require('http');
const { loadApp, sampleTabs } = require('../tests/harness');

const args = process.argv.slice(2);
const today = (args.find(a => a.startsWith('--today=')) || '').slice(8) || undefined;
const port = Number((args.find(a => a.startsWith('--port=')) || '').slice(7)) || 8787;
const env = loadApp(sampleTabs(), { today });
if (args.includes('--setup')) env.app.setupSheet();

const SHIM = `<meta name="viewport" content="width=device-width, initial-scale=1">
<script>
  // Dev stand-in for google.script.run: POSTs to the local server.
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

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url.startsWith('/api/')) {
    const name = req.url.slice(5);
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      try {
        if (name.endsWith('_') || typeof env.app[name] !== 'function') throw new Error('Unknown function ' + name);
        const result = env.app[name](...JSON.parse(body || '[]'));
        res.end(JSON.stringify({ result: result === undefined ? null : JSON.parse(JSON.stringify(result)) }));
      } catch (e) {
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }
  if (req.url === '/' || req.url.startsWith('/?')) {
    const html = env.app.doGet().getContent().replace('<base target="_top">', SHIM);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(html);
    return;
  }
  if (req.url === '/_drafts') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(env.gmail.drafts.map(d => ({ to: d.to, subject: d.subject, body: d.body, from: d.opts.from, replyTo: d.opts.replyTo })), null, 2));
    return;
  }
  if (req.url === '/_sheet') {
    res.setHeader('Content-Type', 'application/json');
    const out = {};
    env.spreadsheet.sheets.forEach(s => { out[s.name] = s.dump(); });
    res.end(JSON.stringify(out, null, 2));
    return;
  }
  res.statusCode = 404;
  res.end('Not found');
}).listen(port, () => console.log('Dev server on http://localhost:' + port + (today ? ' (today = ' + today + ')' : '')));
