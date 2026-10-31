// Builds the sandbox as a static site that runs entirely in the browser: the real app code and fake Google services
// (tests/fakes.js), with each visitor's changes kept in their own browser. Nothing in it talks to Google.
//   npm run demo:build     -> writes .demo/ (open it with any static server)
//   npm run demo:publish   -> builds, then force-pushes .demo/ to the preview repo, which GitHub Pages serves
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { loadApp, readSources, sampleTabs } = require('../tests/harness');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.demo');
const REPO = 'benhastings/bakehouse-app-preview';

const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const git = (args, opts) => execFileSync('git', args, Object.assign({ cwd: ROOT, encoding: 'utf8' }, opts)).trim();

const HEAD = `<meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <link rel="icon" href="https://benhastings.github.io/hastings-bakehouse/fav/favicon-96x96.png">
  <script src="sandbox.js"></script>`;

const page = (title, script) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  ${HEAD}
  <title>${title}</title>
</head>
<body>
  <script>${script}</script>
</body>
</html>
`;

function build() {
  const files = readSources();
  const bundle = [
    read('tests/fakes.js'),
    read('tools/sandbox-core.js'),
    read('tools/inspector.js'),
    'const APP_FILES = ' + JSON.stringify(files) + ';',
    read('tools/demo-runtime.js'),
  ].join('\n;\n');

  // The app page is rendered once here, exactly as doGet() serves it from Apps Script.
  const app = loadApp(sampleTabs()).app.doGet().getContent();
  if (!app.includes('<base target="_top">')) throw new Error('Index.html changed: no <base target="_top"> to replace');
  const index = app
    .replace('<base target="_top">', HEAD + '\n  <title>Hastings Bakehouse (demo)</title>')
    .replace(/<body([^>]*)>/, m => m + '\n  <script>BakehouseDemo.addBanner();</script>');

  const commit = git(['rev-parse', '--short', 'HEAD']);
  const site = {
    'index.html': index,
    'inspect.html': page('Demo inspector', 'BakehouseDemo.showInspector();'),
    'file.html': page('Invoice file', 'BakehouseDemo.showFile(); addEventListener("hashchange", () => location.reload());'),
    'sandbox.js': bundle,
    'robots.txt': 'User-agent: *\nDisallow: /\n',
    '.nojekyll': '',
    'README.md': `# Hastings Bakehouse app preview

A demo of the Hastings Bakehouse production and invoicing app with made-up data. It runs entirely in the browser:
nothing is connected to Google, and whatever you enter stays in your own browser.

Generated from [benhastings/hastings-bakehouse](https://github.com/benhastings/hastings-bakehouse) at ${commit}
by \`npm run demo:publish\`. Don't edit here: every publish replaces this repo's contents.
`,
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.readdirSync(OUT).filter(f => f !== '.git').forEach(f => fs.rmSync(path.join(OUT, f), { recursive: true }));
  Object.entries(site).forEach(([name, content]) => fs.writeFileSync(path.join(OUT, name), content));
  console.log('Built .demo/ (' + Object.keys(site).join(', ') + ') from ' + commit);
  return commit;
}

/** One commit per publish, force-pushed: the preview repo only ever holds the latest build. */
function publish(commit) {
  const dirty = git(['status', '--porcelain', '--', 'apps-script', 'tests', 'tools']);
  if (dirty) console.warn('Note: publishing uncommitted changes in apps-script/tests/tools.');
  const inOut = args => git(args, { cwd: OUT, stdio: ['ignore', 'pipe', 'inherit'] });
  if (!fs.existsSync(path.join(OUT, '.git'))) {
    inOut(['init', '-q', '-b', 'main']);
    inOut(['remote', 'add', 'origin', 'https://github.com/' + REPO + '.git']);
  }
  inOut(['checkout', '-q', '--orphan', 'publish']);
  inOut(['add', '-A']);
  inOut(['commit', '-q', '-m', 'Preview build from hastings-bakehouse ' + commit + (dirty ? ' (with uncommitted changes)' : '')]);
  inOut(['branch', '-q', '-M', 'main']);
  inOut(['push', '-q', '--force', 'origin', 'main']);
  const [owner, name] = REPO.split('/');
  console.log('Pushed to ' + REPO + '. GitHub Pages updates in a minute or two: https://' + owner + '.github.io/' + name + '/');
}

const commit = build();
if (process.argv.includes('--publish')) publish(commit);
