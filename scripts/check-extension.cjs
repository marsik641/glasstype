// Tests the real extension in a separate test browser using fake session data.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { BrowserLogin, exportFirebaseSession } = require('../src/browser-login.cjs');
const root = path.resolve(__dirname, '..');
process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(root, '.browser-cache');
const { chromium } = createRequire(path.resolve(process.argv[2]))('playwright');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const extension = path.join(root, 'chrome-extension');
  await fs.writeFile(path.join(extension, 'firebase-session.js'), `const exportFirebaseSession = ${exportFirebaseSession.toString()};\n`);
  const context = await chromium.launchPersistentContext(path.join(root, '.test-profile', 'extension-integration'), {
    headless: false, chromiumSandbox: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`]
  });
  const session = { key: 'firebase:authUser:fake-test-key:[DEFAULT]', value: {
    uid: 'fake-test-user', apiKey: 'fake-test-key', stsTokenManager: { refreshToken: 'fake-test-token' }
  } };
  let login;
  try {
    await context.route('https://monkeytype.com/**', route => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><body>Local extension test. No real credentials or account.</body></html>' }));
    await context.addInitScript(data => {
      if (location.origin === 'https://monkeytype.com') sessionStorage.setItem(data.key, JSON.stringify(data.value));
    }, session);
    const page = await context.newPage();
    const other = await context.newPage();
    let imported, status;
    login = new BrowserLogin({
      openBrowser: url => page.goto(url).then(() => {}),
      onState: value => { status = value; },
      importSession: async data => { imported = data; }
    });
    await login.start();
    for (let i = 0; i < 80 && status !== 'success'; i++) await delay(250);
    assert.equal(status, 'success');
    assert.deepEqual(imported, session);
    assert.equal(login.active, false);
    assert.equal(page.isClosed(), false);
    assert.equal(other.isClosed(), false);
    assert.equal(new URL(page.url()).hash, '');
    console.log('Real Chrome extension transferred the fake Monkeytype session through the authenticated local connection. Browser tabs remain open.');
  } finally { await login?.cancel(); await context.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
