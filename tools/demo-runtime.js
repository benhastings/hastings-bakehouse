// Browser side of the static demo (tools/build-demo.js): runs the sandbox in the page instead of on a server.
// The app's google.script.run calls go straight to the in-page sandbox, and its log of changes is kept in this
// browser's localStorage, so every visitor has their own copy and nothing is sent anywhere.
/* global BakehouseFakes, BakehouseSandbox, BakehouseInspector, APP_FILES */
(function () {
  'use strict';

  const KEY = 'bakehouse-demo-state';
  const LINKS = { app: './', inspect: 'inspect.html', file: id => 'file.html#' + id };

  /**
   * Run the Apps Script sources with the fake services in scope. The function is built in sloppy mode on purpose:
   * templates use `with`, and the direct eval in compile() sees the app's top-level functions.
   */
  function evaluateInBrowser(source, names, globals) {
    const keys = Object.keys(globals);
    // eslint-disable-next-line no-new-func
    const make = new Function(keys.join(','),
      source + '\n;return { app: {' + names.join(',') + '}, compile: function (__code) { return eval(__code); } };');
    return make.apply(null, keys.map(k => globals[k]));
  }

  // Storage can be missing or blocked (private windows, some previews); the demo then just doesn't remember.
  const storage = {
    read() {
      try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; }
    },
    write(state) {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* not remembered */ }
    },
  };

  const saved = storage.read();
  const sandbox = BakehouseSandbox.createSandbox({
    loadApp: (tabs, options) => BakehouseFakes.createApp(tabs, options, APP_FILES, evaluateInBrowser),
    fakes: BakehouseFakes,
    read: storage.read,
    write: storage.write,
    // A first visit skips the one-time setup screen; Reset in the inspector can bring it back.
    start: saved ? undefined : 'setup',
  });

  // Like google.script.run: async, arguments and results round-trip through JSON, failures go to the handler.
  function makeRun(ok, fail) {
    return new Proxy({}, {
      get(_, name) {
        if (name === 'withSuccessHandler') return fn => makeRun(fn, fail);
        if (name === 'withFailureHandler') return fn => makeRun(ok, fn);
        return (...args) => setTimeout(() => {
          let result;
          try {
            result = sandbox.call(name, JSON.parse(JSON.stringify(args)));
          } catch (e) {
            if (fail) fail(new Error(e.message));
            return;
          }
          const json = BakehouseInspector.localLinks(JSON.stringify(result === undefined ? null : result), LINKS);
          if (ok) ok(JSON.parse(json));
        }, 200);
      },
    });
  }
  window.google = { script: { run: makeRun() } };

  /** Swap this page's content for a whole HTML document. */
  function showDocument(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    document.title = doc.title;
    document.head.replaceChildren(...Array.from(doc.head.childNodes).map(n => document.importNode(n, true)));
    document.body.replaceWith(document.importNode(doc.body, true));
  }

  const SAVED_NOTE = 'Kept in this browser only (nothing is sent anywhere), so each phone or computer has its own copy.';

  function showInspector() {
    showDocument(BakehouseInspector.renderInspector(sandbox, { STARTS: BakehouseSandbox.STARTS, links: LINKS, saved: SAVED_NOTE }));
    if (location.hash) {
      const target = document.getElementById(location.hash.slice(1));
      if (target) target.scrollIntoView();
    }
  }

  // The inspector's control forms post to /_today, /_undo and /_reset on the dev server; here they run in the page.
  document.addEventListener('submit', e => {
    const action = e.target.getAttribute('action');
    if (!/^\/_(today|undo|reset)$/.test(action || '')) return;
    e.preventDefault();
    const form = new FormData(e.target);
    if (action === '/_today') sandbox.setToday(form.get('today'));
    if (action === '/_undo') sandbox.undo();
    if (action === '/_reset') sandbox.reset(form.get('start'));
    showInspector();
  });

  function showFile() {
    const file = sandbox.env.drive.files[location.hash.slice(1)];
    if (file) showDocument(file.blob.content);
    else document.body.textContent = 'That file isn’t in this browser’s copy of the demo (it may have been reset).';
  }

  function addBanner() {
    document.body.insertAdjacentHTML('afterbegin', BakehouseInspector.banner(sandbox.state.today, LINKS)
      .replace('SANDBOX ·', 'DEMO ·'));
  }

  // Another tab (the app or the inspector) changed the demo: reload so this one isn't working from stale data.
  window.addEventListener('storage', e => { if (e.key === KEY) location.reload(); });

  window.BakehouseDemo = { sandbox, showInspector, showFile, addBanner };
})();
