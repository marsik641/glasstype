const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { _electron } = createRequire(path.resolve(process.argv[2]))('playwright');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const env = { ...process.env, GLASSTYPE_TEST_PROFILE: path.join(root, '.test-profile', `live-${Date.now()}`) };
  for (const key of Object.keys(env)) if (/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS)$/i.test(key)) delete env[key];
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root], env });
  try {
    await app.firstWindow();
    let shell;
    for (let i = 0; i < 50; i++) {
      shell = app.context().pages().find(p => p.url().startsWith('file:') && p.url().endsWith('/shell.html'));
      if (shell) break;
      await delay(100);
    }
    assert.ok(shell);
    await shell.waitForSelector('#connection');
    await shell.evaluate(async () => {
      const s = await window.glassType.ready();
      if (s.helpOpen) await window.glassType.action('dismissHelp');
    });
    let state;
    for (let i = 0; i < 100; i++) {
      state = await shell.evaluate(() => window.glassType.ready());
      if (state.pageState !== 'loading') break;
      await delay(350);
    }
    console.log('State:', JSON.stringify(state));
    assert.equal(state.pageState, 'ready');
    const site = app.context().pages().find(p => p.url().startsWith('https://monkeytype.com'));
    await site.waitForSelector('#words .word');
    console.log('Visible page text:', (await site.locator('body').innerText()).slice(0,5000));
    console.log('Buttons:', JSON.stringify(await site.getByRole('button').allTextContents()));
    await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
    await site.screenshot({ path: path.join(root, 'artifacts', 'live-before.png'), omitBackground: true });
    const reject = site.getByRole('button', { name: /reject.*non|only.*essential/i });
    if (await reject.count() === 1) {
      await reject.click();
      await reject.waitFor({ state: 'hidden' });
    }
    console.log('DOM structure:', JSON.stringify(await site.evaluate(() => {
      const describe = el => el ? {tag:el.tagName,id:el.id,cls:el.className,parent:el.parentElement?.id,parentClass:el.parentElement?.className} : null;
      return { config:describe(document.getElementById('testConfig')), test:describe(document.querySelector('.pageTest')),
        appChildren:[...document.getElementById('app').children].map(describe),
        bodyChildren:[...document.body.children].filter(el=>el.tagName!=='SCRIPT').map(describe)};
    })));
    const cookieModal = site.locator('.modal:visible');
    console.log('Modal count:', await cookieModal.count());
    if (await cookieModal.count() > 0) console.log('Modal text:', (await cookieModal.allTextContents()).join('\n').slice(0,4000));
    const styles = await site.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      app: getComputedStyle(document.getElementById('app')).backgroundColor,
      test: getComputedStyle(document.querySelector('.pageTest')).backgroundColor,
      node: typeof require, bridge: typeof window.glassType,
      words: document.querySelectorAll('#words .word').length
    }));
    assert.equal(styles.body, 'rgba(12, 17, 26, 0)');
    assert.equal(styles.app, 'rgba(0, 0, 0, 0)');
    assert.equal(styles.node, 'undefined');
    assert.equal(styles.bridge, 'undefined');
    console.log('Original-site styles:', JSON.stringify(styles));
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.show(); window.focus();
      window.contentView.children.find(view => view.webContents?.getURL().startsWith('https://monkeytype.com/'))?.webContents.focus();
    });
    await site.locator('#wordsInput').focus();
    await site.waitForFunction(() => document.activeElement?.id === 'wordsInput' &&
      !document.getElementById('words').classList.contains('blurred'));
    const firstWord = await site.locator('#words .word').first().innerText();
    await site.keyboard.type(firstWord + ' ', { delay: 70 });
    const correct = await site.locator('#words letter.correct').count();
    assert.ok(correct >= firstWord.length, 'original Monkeytype accepts typed characters');
    console.log('Original typing verified:', correct, 'correct characters');
    await site.keyboard.press('Tab');
    for (let i = 0; i < 30 && await site.locator('#words letter.correct').count(); i++) await delay(100);
    assert.equal(await site.locator('#words letter.correct').count(), 0, 'Tab restarts the real test');
    assert.equal(await site.evaluate(() => document.activeElement?.id), 'wordsInput');
    console.log('Tab restarts the original test and returns typing focus.');
    await shell.locator('.toolbar').waitFor({ state: 'hidden' });
    const hiddenBounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.find(view=>view.webContents?.getURL().startsWith('https://monkeytype.com')).getBounds());
    assert.equal(hiddenBounds.y, 0);
    await shell.evaluate(() => window.glassType.action('toolbar'));
    await shell.locator('.toolbar').waitFor({ state: 'visible' });
    await shell.evaluate(() => window.glassType.action('toolbar'));
    await shell.locator('.toolbar').waitFor({ state: 'hidden' });
    console.log('Toolbar fully hides, reopens and releases its space.');
    // Do not enter account credentials. Inspect that original login exists.
    await site.screenshot({ path: path.join(root, 'artifacts', 'live-site.png'), omitBackground: true });
    await shell.evaluate(() => window.glassType.action('compact'));
    await site.locator('header').waitFor({ state: 'hidden' });
    await site.locator('[data-ui-element="testConfig"]').waitFor({ state: 'hidden' });
    await site.locator('body > div.fixed.z-1000').waitFor({ state: 'hidden' });
    assert.ok(await site.locator('#words').isVisible());
    await site.screenshot({ path: path.join(root, 'artifacts', 'live-compact.png'), omitBackground: true });
    await shell.evaluate(() => window.glassType.action('compact'));
    await site.locator('header').waitFor({ state: 'visible' });
    // The site's top announcement can overlap navigation at narrow widths.
    // Follow the real links with Enter so it cannot intercept the pointer.
    await site.locator('a[href="/settings"]').first().press('Enter');
    await site.waitForURL('https://monkeytype.com/settings');
    await site.waitForFunction(() => !document.documentElement.hasAttribute('data-glasstype-test') &&
      getComputedStyle(document.getElementById('app')).backgroundColor !== 'rgba(0, 0, 0, 0)');
    await site.locator('header a[href="/"]').first().press('Enter');
    await site.waitForURL('https://monkeytype.com/');
    await site.waitForFunction(() => document.documentElement.hasAttribute('data-glasstype-test') &&
      getComputedStyle(document.getElementById('app')).backgroundColor === 'rgba(0, 0, 0, 0)');
    await site.waitForSelector('#words .word');
    await fs.writeFile(path.join(root, 'artifacts', 'live-check.json'), JSON.stringify({ date: new Date().toISOString(), originalSiteLoaded: true, styles, compactRoundTrip: true, tabRestart: true, toolbarRoundTrip: true, navigationRoundTrip: true, accountLoginTested: false }, null, 2));
    console.log('Original Monkeytype loaded; transparent background and compact round trip verified.');
    if (process.argv.includes('--keep-open')) { console.log('Keeping verification window open for visual inspection.'); await delay(55000); }
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
