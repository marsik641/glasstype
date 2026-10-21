const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { _electron } = createRequire(path.resolve(process.argv[2]))('playwright');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS|GLASSTAPE_TEST_PROFILE)$/i.test(key)) delete env[key];
  const app = await _electron.launch({ executablePath: path.join(root, 'dist/GlassTape-win32-x64/GlassTape.exe'), args: [], env });
  try {
    await app.firstWindow();
    let shell;
    for (let i = 0; i < 50; i++) {
      shell = app.context().pages().find(p => p.url().startsWith('file:') && p.url().endsWith('/shell.html'));
      if (shell) break;
      await delay(100);
    }
    assert.ok(shell);
    await shell.waitForSelector('#googleLogin', { state: 'attached' });
    assert.ok(await app.evaluate(({app}) => app.isPackaged));
    assert.equal(await app.evaluate(({app}) => app.getVersion()), require('../package.json').version);
    assert.ok((await shell.evaluate(()=>window.glassTape.ready())).shortcuts.toggle);
    for (let i = 0; i < 100; i++) {
      const state = await shell.evaluate(()=>window.glassTape.ready());
      if (state.pageState === 'ready') break;
      if (state.pageState === 'error') throw new Error(state.lastError);
      await delay(300);
    }
    assert.equal((await shell.evaluate(()=>window.glassTape.ready())).pageState, 'ready');
    const site = app.context().pages().find(p => p.url().startsWith('https://monkeytype.com/'));
    await site.waitForFunction(() => document.documentElement.hasAttribute('data-glasstape-test') &&
      document.getElementById('app') && getComputedStyle(document.getElementById('app')).backgroundColor === 'rgba(0, 0, 0, 0)');
    console.log('Packaged GlassTape.exe starts, loads the original site and exposes its controls.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
