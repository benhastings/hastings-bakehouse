// The sandbox under Node: tools/sandbox-core.js with the app loaded by tests/harness.js and its log kept in a JSON
// file. Nothing here talks to Google.
'use strict';

const fs = require('fs');
const path = require('path');
const harness = require('../tests/harness');
const core = require('./sandbox-core');

/** options: { stateFile, start, today } */
function createSandbox(options) {
  const file = options && options.stateFile;
  return core.createSandbox(Object.assign({}, options, {
    loadApp: harness.loadApp,
    fakes: harness,
    read: () => (file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null),
    write: state => {
      if (!file) return;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
    },
  }));
}

module.exports = { createSandbox, STARTS: core.STARTS, CHANGES: core.CHANGES, DEFAULT_TODAY: core.DEFAULT_TODAY };
