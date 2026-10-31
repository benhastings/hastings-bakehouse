// Loads the Apps Script sources into a Node vm context with the in-memory fakes of the Google services from
// tests/fakes.js, so server code can be tested without deploying.
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fakes = require('./fakes');

const SRC = path.join(__dirname, '..', 'apps-script');

/** The Apps Script project's files by name ({ 'Code.js': source, 'Index.html': source, ... }). */
function readSources() {
  const files = {};
  fs.readdirSync(SRC).filter(f => /\.(js|html)$/.test(f)).forEach(f => { files[f] = fs.readFileSync(path.join(SRC, f), 'utf8'); });
  return files;
}

/** Run the sources in their own vm context, so they can't lean on Node globals by accident. */
function evaluateInVm(source, names, globals) {
  const context = vm.createContext(Object.assign({ console }, globals));
  vm.runInContext(source + '\n;globalThis.__app = {' + names.join(',') + '};', context, { filename: 'apps-script' });
  return { app: context.__app, compile: code => vm.runInContext(code, context) };
}

/**
 * Create a fresh app instance.
 * tabs: { tabName: rows[][] }, today: 'YYYY-MM-DD'
 */
function loadApp(tabs, options) {
  return fakes.createApp(tabs, options, readSources(), evaluateInVm);
}

module.exports = Object.assign({ loadApp, readSources }, fakes);
