// Development-only checks. Run with the path to a local Playwright installation.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { exportFirebaseSession, importFirebaseSession } = require('../src/browser-login.cjs');
const { _electron } = createRequire(path.resolve(process.argv[2]))('playwright');
const root = path.resolve(__dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitState(shell, predicate, timeout = 35000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await shell.evaluate(() => window.glassTape.ready());
    if (predicate(value)) return value;
    await delay(300);
  }
  throw new Error('Expected application state was not reached');
}

const fixture = `<!doctype html><html><head><meta charset="utf-8"><style>
:root{--bg-color:#323437;--text-color:#d1d0c5;--sub-color:#646669;--main-color:#e2b714;--error-color:#ca4754}
*{box-sizing:border-box}html,body{margin:0;background:var(--bg-color);font-family:Consolas,monospace;color:var(--text-color)}
#app{display:grid;grid-template-rows:auto 1fr auto;min-height:100vh;padding:28px;gap:25px}header,footer{padding:10px}
main{display:grid}.pageTest{display:grid;grid-template-rows:1fr auto 1fr;height:100%}#typingTest{align-self:center}
#testConfig{text-align:center;padding:12px;background:#222}#words{font-size:30px;line-height:1.7;display:flex;flex-wrap:wrap;gap:12px}
#words .word letter{color:var(--sub-color)}#words .word letter.correct{color:var(--text-color)}#words .word letter.incorrect{color:var(--error-color)}
button{background:#202329;color:#ddd;border:0;padding:10px;cursor:pointer}#wordsInput{width:100%;background:transparent;color:var(--text-color);border:0;outline:0;font:inherit}
</style></head><body><div id="app"><header>ПРОВЕРОЧНЫЙ ЭКРАН · ЭТО НЕ MONKEYTYPE</header><main><div class="pageTest"><div id="testConfig">time · words · 15 · 30 · 60 · 120</div><div id="typingTest"><div id="wordsWrapper"><div id="words">${['прозрачный','текст','поверх','других','окон','один','два','три'].map(w=>'<div class="word">'+[...w].map(c=>'<letter>'+c+'</letter>').join('')+'</div>').join('')}</div><input id="wordsInput" aria-label="Проверочный ввод" autocomplete="off"></div></div><div></div></div></main><footer>Локальная проверка прозрачности и управления окном</footer></div></body></html>`;

async function main() {
  const artifacts = path.join(root, 'artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  const profile = path.join(root, '.test-profile', `desktop-${Date.now()}`);
  const env = { ...process.env, GLASSTAPE_TEST_PROFILE: profile };
  for (const key of Object.keys(env)) {
    if (/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS)$/i.test(key)) delete env[key];
  }
  const electron = await _electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [root], env, timeout: 30000
  });
  electron.process().stderr.on('data', data => {
    const text = data.toString();
    if (text.includes('Style ')) console.log(text.trim());
  });
  try {
    await electron.firstWindow();
    let shell;
    for (let i = 0; i < 50; i++) {
      shell = electron.context().pages().find(p => p.url().startsWith('file:') && p.url().endsWith('/shell.html'));
      if (shell) break;
      await delay(100);
    }
    assert.ok(shell);
    await shell.waitForSelector('#welcome:not([hidden])');
    const initial = await shell.evaluate(() => window.glassTape.ready());
    console.log('Launch:', JSON.stringify({ pageState: initial.pageState, shortcuts: initial.shortcuts }));
    const native = await electron.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { color: w.getBackgroundColor(), onTop: w.isAlwaysOnTop(), size: w.getSize() };
    });
    // Electron's getBackgroundColor returns RGB even for an alpha-zero window.
    assert.equal(native.color, '#000000');
    assert.equal(native.onTop, true);
    await shell.screenshot({ path: path.join(artifacts, 'welcome.png'), omitBackground: true });

    // Try the real service first. No credentials are read or entered.
    if (!process.argv.includes('--fixture-only')) await waitState(shell, s => s.pageState !== 'loading');
    const live = await shell.evaluate(() => window.glassTape.ready());
    console.log('Live site:', JSON.stringify({ pageState: live.pageState, error: live.lastError }));
    if (live.pageState === 'ready') {
      const remote = electron.context().pages().find(p => p.url().startsWith('https://monkeytype.com'));
      if (remote) console.log('Live DOM:', JSON.stringify(await remote.evaluate(() => ({ title: document.title, test: !!document.querySelector('.pageTest'), words: document.querySelectorAll('#words .word').length }))));
    }
    if (!process.argv.includes('--fixture-only')) await fs.writeFile(path.join(artifacts, 'live-check.json'), JSON.stringify({ date: new Date().toISOString(), pageState: live.pageState, error: live.lastError, accountLoginTested: false }, null, 2));

    // Isolate UI checks from the service's network availability.
    let simulateOffline = false;
    await electron.context().route('https://monkeytype.com/**', route => simulateOffline ? route.abort() : route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
    await shell.evaluate(() => window.glassTape.action('reload'));
    await waitState(shell, s => s.pageState === 'ready');
    await shell.getByRole('button', { name: 'Начать печатать' }).click();
    await shell.locator('.toolbar').waitFor({ state: 'hidden' });
    await shell.evaluate(() => window.glassTape.action('toolbar'));
    await shell.locator('.toolbar').waitFor({ state: 'visible' });
    const remote = electron.context().pages().find(p => p.url().startsWith('https://monkeytype.com'));
    assert.ok(remote, 'remote WebContentsView is available');
    const security = await remote.evaluate(() => ({ node: typeof require, bridge: typeof window.glassTape, color: getComputedStyle(document.body).backgroundColor }));
    assert.equal(security.node, 'undefined');
    assert.equal(security.bridge, 'undefined');
    assert.equal(security.color, 'rgba(12, 17, 26, 0)');
    await remote.locator('#wordsInput').fill('проверка ввода');
    assert.equal(await remote.locator('#wordsInput').inputValue(), 'проверка ввода');
    await remote.evaluate(() => {
      const modal = document.createElement('div');
      modal.className = 'modal'; modal.id = 'test-modal';
      modal.innerHTML = '<input id="modal-first"><input id="modal-second">';
      document.body.append(modal);
      document.getElementById('modal-first').focus();
    });
    await remote.keyboard.press('Tab');
    assert.equal(await remote.evaluate(() => document.activeElement.id), 'modal-second', 'Tab navigates forms normally');
    await remote.evaluate(() => document.getElementById('test-modal').remove());
    const fakeSession = { key: 'firebase:authUser:fake-test-api-key:[DEFAULT]', value: {
      uid: 'local-test-user', apiKey: 'fake-test-api-key', appName: '[DEFAULT]',
      stsTokenManager: { refreshToken: 'fake-local-test-token', accessToken: 'fake-access', expirationTime: 0 }
    } };
    await remote.evaluate(importFirebaseSession, fakeSession);
    assert.deepEqual(await remote.evaluate(exportFirebaseSession), fakeSession);
    assert.equal(await remote.evaluate(() => localStorage.getItem('firebasePersistence')), 'LOCAL');

    await shell.locator('#compact').click();
    await remote.locator('header').waitFor({ state: 'hidden' });
    assert.equal(await remote.locator('header').isVisible(), false);
    assert.equal(await remote.locator('#testConfig').isVisible(), false);
    assert.equal(await remote.locator('#words').isVisible(), true);
    const mainHeight = await remote.locator('main').evaluate(el => el.getBoundingClientRect().height);
    assert.ok(mainHeight > 200, 'compact layout still allocates height to the test');
    // Page appearance follows SPA navigation, independently of letter mutations.
    await remote.evaluate(() => history.pushState({}, '', '/settings'));
    await remote.waitForFunction(() => !document.documentElement.hasAttribute('data-glasstape-test') &&
      getComputedStyle(document.getElementById('app')).backgroundColor === 'rgb(50, 52, 55)');
    assert.ok(await remote.locator('header').isVisible(), 'menus remain accessible away from the test');
    await remote.evaluate(() => history.pushState({}, '', '/'));
    await remote.waitForFunction(() => document.documentElement.hasAttribute('data-glasstape-test') &&
      getComputedStyle(document.getElementById('app')).backgroundColor === 'rgba(0, 0, 0, 0)');
    await remote.locator('header').waitFor({ state: 'hidden' });
    await shell.locator('#ink').click();
    const darkInk = await remote.locator('#app').evaluate(el => getComputedStyle(el).getPropertyValue('--text-color').trim());
    assert.equal(darkInk, '#162131');
    await shell.locator('#backdrop').click();
    assert.equal(await remote.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(255, 255, 255, 0.2)');
    await shell.locator('#backdrop').click();
    await shell.locator('#backdrop').click();
    await shell.locator('#backdrop').click();
    assert.equal(await remote.locator('body').evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(255, 255, 255, 0)');
    await shell.locator('#pin').click();
    assert.equal(await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), false);
    await shell.locator('#pin').click();
    await shell.locator('[data-action="size"]').click();
    const newSize = await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
    assert.notDeepEqual(newSize, native.size);
    const grip = await shell.locator('#resizeGrip').boundingBox();
    await shell.mouse.move(grip.x + 5, grip.y + 5);
    await shell.mouse.down();
    await shell.mouse.move(grip.x - 95, grip.y - 45, { steps: 5 });
    await shell.mouse.up();
    const draggedSize = await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
    assert.ok(draggedSize[0] < newSize[0] && draggedSize[1] < newSize[1], 'resize grip changes the window dimensions');
    await shell.evaluate(() => window.glassTape.action('zoomIn'));
    const zoom = await electron.evaluate(({ webContents }) => webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://monkeytype.com')).getZoomFactor());
    assert.equal(zoom, 1.1);
    if (initial.shortcuts.passthrough) {
      await shell.evaluate(() => window.glassTape.action('passthrough'));
      assert.equal((await shell.evaluate(() => window.glassTape.ready())).clickThrough, true);
      await shell.evaluate(() => window.glassTape.action('passthrough'));
      assert.equal((await shell.evaluate(() => window.glassTape.ready())).clickThrough, false);
    }
    await shell.evaluate(() => window.glassTape.action('compact'));
    console.log('Compact off:', JSON.stringify(await shell.evaluate(() => window.glassTape.ready())));
    await remote.locator('header').waitFor({ state: 'visible', timeout: 5000 });
    assert.equal(await remote.locator('header').isVisible(), true);
    await shell.screenshot({ path: path.join(artifacts, 'shell-tested.png'), omitBackground: true });
    await remote.screenshot({ path: path.join(artifacts, 'transparent-fixture.png'), omitBackground: true });
    simulateOffline = true;
    await shell.evaluate(() => window.glassTape.action('reload'));
    await waitState(shell, s => s.pageState === 'error');
    await shell.locator('#error').waitFor({ state: 'visible' });
    simulateOffline = false;
    await shell.locator('#error [data-action="reload"]').click();
    await waitState(shell, s => s.pageState === 'ready');
    console.log('Desktop checks passed: transparency, typing, isolation, text mode, colors, backdrop, pin, size, zoom, click-through recovery.');
  } finally {
    await electron.close();
  }
  const saved = JSON.parse(await fs.readFile(path.join(profile, 'settings.json'), 'utf8'));
  assert.equal(saved.hasLaunched, true);
  assert.equal(saved.ink, 'dark');
  assert.equal(saved.compact, false);
  console.log('Preferences persisted.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
