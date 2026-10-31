// A sandbox copy of the app: the real Apps Script code running on fake Google services (tests/fakes.js), plus a
// log of every change so the sandbox survives restarts and can undo or reset. Nothing here talks to Google.
//
// State is a list of actions ({ today, fn, args }). Loading replays them from the starting sheet, so the sheet,
// Drive files and Gmail drafts always come back exactly as they were.
//
// No Node APIs here: tools/sandbox.js runs it with a state file, and the static demo (tools/build-demo.js) runs it in
// a browser with localStorage.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BakehouseSandbox = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const STARTS = {
  sample: 'Sample data, sheet not set up yet',
  setup: 'Sample data, sheet already set up',
  blank: 'Empty sheet (headers only), not set up yet',
};

// Server functions that change something. Everything else the UI calls only reads, so it isn't logged.
const CHANGES = ['setupSheet', 'saveProductionDay', 'saveInvoice', 'saveAndDraftInvoice', 'createInvoiceDraft',
  'createInvoicePdf', 'setInvoiceStatus'];

const DEFAULT_TODAY = '2026-10-08';

/**
 * options: { loadApp(tabs, { today }), fakes (for sampleTabs/blankTabs), read() → saved state or null,
 *            write(state), start, today }
 */
function createSandbox(options) {
  const { loadApp, fakes } = options;
  let state = { start: 'sample', today: DEFAULT_TODAY, actions: [] };
  const saved = options.read && options.read();
  if (saved) state = Object.assign(state, saved);
  if (options && options.start) {
    if (!STARTS[options.start]) throw new Error('Unknown start "' + options.start + '". Use ' + Object.keys(STARTS).join(', '));
    if (options.start !== state.start) state = { start: options.start, today: state.today, actions: [] };
  }
  if (options && options.today) state.today = options.today;

  let env;
  let dropped = [];

  function fresh() {
    env = loadApp(state.start === 'blank' ? fakes.blankTabs() : fakes.sampleTabs(), { today: state.today });
    if (state.start === 'setup') env.app.setupSheet();
  }

  /**
   * Replay the log. If the app code changed so a logged change no longer works (a renamed function, say), keep
   * the changes before it, drop it and everything after, and report them in `dropped`.
   */
  function rebuild() {
    fresh();
    const kept = [];
    for (const a of state.actions) {
      try {
        if (typeof env.app[a.fn] !== 'function') throw new Error(a.fn + ' no longer exists');
        env.setToday(a.today);
        env.app[a.fn](...a.args);
        kept.push(a);
      } catch (e) {
        dropped = state.actions.slice(kept.length);
        dropped[0] = Object.assign({ error: e.message }, dropped[0]);
        state.actions = kept;
        fresh();
        kept.forEach(k => { env.setToday(k.today); env.app[k.fn](...k.args); });
        save();
        break;
      }
    }
    env.setToday(state.today);
  }

  function save() {
    if (options.write) options.write(state);
  }

  /** Run a server function the way google.script.run would, logging it if it changes anything. */
  function call(fn, args) {
    if (fn.endsWith('_') || typeof env.app[fn] !== 'function') throw new Error('Unknown function ' + fn);
    const changes = CHANGES.indexOf(fn) !== -1;
    let result;
    try {
      result = env.app[fn](...args);
    } catch (e) {
      // A failed change may have written part of its work; drop it so the sandbox matches the log.
      if (changes) rebuild();
      throw e;
    }
    if (changes) {
      state.actions.push({ today: state.today, at: new Date().toISOString(), fn, args });
      save();
    }
    // Round-trip through JSON like google.script.run does (Dates become strings, functions disappear).
    return result === undefined ? null : JSON.parse(JSON.stringify(result));
  }

  function undo() {
    const last = state.actions.pop();
    rebuild();
    save();
    return last;
  }

  function reset(start) {
    if (start && !STARTS[start]) throw new Error('Unknown start ' + start);
    state = { start: start || state.start, today: state.today, actions: [] };
    rebuild();
    save();
  }

  function setToday(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error('Use YYYY-MM-DD');
    state.today = iso;
    env.setToday(iso);
    save();
  }

  rebuild();
  return {
    call, undo, reset, setToday,
    get env() { return env; },
    get state() { return state; },
    get dropped() { return dropped; },
  };
}

return { createSandbox, STARTS, CHANGES, DEFAULT_TODAY };
});
