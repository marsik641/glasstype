const { app, BrowserWindow, WebContentsView, ipcMain, globalShortcut, Menu,
  Tray, nativeImage, shell, screen, dialog, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { HOME, isMonkeytype, isAuthUrl, isExternalUrl, clampBounds, sanitizeSettings } = require('./policy.cjs');
const { monkeyStyle } = require('./monkey-style.cjs');
const { BrowserLogin, isFirebaseSession, importFirebaseSession } = require('./browser-login.cjs');
const { installTypingShortcuts } = require('./typing-shortcuts.cjs');
const { openInChrome } = require('./chrome-opener.cjs');
const { configureProfile } = require('./profile.cjs');

app.setName('GlassType');
app.setAppUserModelId('local.glasstype.desktop');
configureProfile(app, process.env.GLASSTYPE_TEST_PROFILE);
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
let settings;
try { settings = sanitizeSettings(JSON.parse(fs.readFileSync(settingsFile, 'utf8'))); }
catch { settings = sanitizeSettings(null); }

let win, site, tray, cssKey, saveTimer, resizeStart, loadTimer;
let clickThrough = false;
let pageState = 'loading';
let lastError = '';
let helpOpen = !settings.hasLaunched;
let shortcuts = {};
let styleRevision = 0;
let browserLogin;
let loginStatus = { status: 'idle', detail: '' };
const authWindows = new Set();
const shellFile = path.join(__dirname, 'shell.html');
const shellUrl = pathToFileURL(shellFile).href;
const HEADER = 48;
const FOOTER = 10;

function persist() {
  clearTimeout(saveTimer);
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    const temp = settingsFile + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(settings, null, 2));
    fs.renameSync(temp, settingsFile);
  } catch (error) {
    console.error('Could not save window settings:', error.code);
  }
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(persist, 350); }

function state() {
  return { ...settings, toolbarShown: toolbarShown(), clickThrough, pageState, lastError, helpOpen, shortcuts, loginStatus };
}
function publish() {
  if (win && !win.isDestroyed()) win.webContents.send('glass:state', state());
  updateTray();
}

function layout() {
  if (!win || win.isDestroyed() || !site) return;
  const [width, height] = win.getContentSize();
  const visible = pageState === 'ready' && !helpOpen && !['waiting', 'importing', 'error'].includes(loginStatus.status);
  site.setVisible(visible);
  const top = toolbarShown() ? HEADER : 0;
  site.setBounds({ x: 0, y: top, width, height: Math.max(1, height - top - (toolbarShown() ? FOOTER : 0)) });
}

function toolbarShown() {
  return settings.toolbarVisible || helpOpen || pageState !== 'ready' || ['waiting', 'importing', 'error'].includes(loginStatus.status);
}

function startLoadTimeout() {
  clearTimeout(loadTimer);
  loadTimer = setTimeout(() => {
    if (pageState !== 'loading') return;
    pageState = 'error';
    lastError = 'Сайт не ответил за 30 секунд. Можно повторить подключение.';
    site.webContents.stop();
    publish(); layout();
  }, 30000);
}

async function restyle() {
  if (!site || site.webContents.isDestroyed() || !isMonkeytype(site.webContents.getURL())) return;
  const contents = site.webContents;
  const revision = ++styleRevision;
  const previous = cssKey;
  try {
    await updatePageAppearance();
    // Electron removes styles through Blink's author-origin API. Keep updates
    // in that origin so compact mode can be undone without reloading a test.
    const key = await contents.insertCSS(monkeyStyle(settings), { cssOrigin: 'author' });
    if (revision !== styleRevision || contents.isDestroyed()) {
      if (!contents.isDestroyed()) await contents.removeInsertedCSS(key);
      return;
    }
    cssKey = key;
    if (previous) await contents.removeInsertedCSS(previous);
  } catch (error) {
    if (process.env.GLASSTYPE_TEST_PROFILE) console.error('Style update failed:', error.message);
    /* A navigation can replace the document while a style is pending. */
  }
}

async function updatePageAppearance() {
  if (!site || site.webContents.isDestroyed() || !isMonkeytype(site.webContents.getURL())) return;
  try {
    // Monkeytype's test lives at /. Update once per navigation, so every tape
    // animation frame need not re-evaluate ancestor :has() selectors.
    await site.webContents.executeJavaScriptInIsolatedWorld(1001, [{
      code: "document.documentElement.toggleAttribute('data-glasstype-test', location.pathname === '/')"
    }]);
  } catch { /* Navigation can replace the document while this update is pending. */ }
}

function allDisplays() {
  const primary = screen.getPrimaryDisplay();
  return [primary, ...screen.getAllDisplays().filter(d => d.id !== primary.id)];
}

function togglePassthrough() {
  // Never make the only way back inaccessible if the global shortcut failed.
  if (!shortcuts.passthrough) return;
  clickThrough = !clickThrough;
  win.setIgnoreMouseEvents(clickThrough, { forward: true });
  if (clickThrough) win.blur();
  else { win.show(); site?.webContents.focus(); }
  publish();
}

function showWindow() {
  if (win.isMinimized()) win.restore();
  win.show();
  if (clickThrough) { clickThrough = false; win.setIgnoreMouseEvents(false); }
  if (pageState === 'ready' && !helpOpen) site.webContents.focus();
  publish();
}

function toggleWindow() {
  if (win.isVisible() && win.isFocused()) win.hide();
  else showWindow();
}

function updateTray() {
  if (!tray || !win || win.isDestroyed()) return;
  tray.setToolTip(clickThrough ? 'GlassType — клики проходят насквозь (Ctrl+Shift+X)' : 'GlassType — Monkeytype поверх окон');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Показать / вернуть управление', click: showWindow },
    { label: 'Скрыть окно', click: () => win.hide() },
    { type: 'separator' },
    { label: 'Поверх всех окон', type: 'checkbox', checked: settings.alwaysOnTop, click: () => action('pin') },
    { label: 'Только текст', type: 'checkbox', checked: settings.compact, click: () => action('compact') },
    { label: 'Панель управления (Ctrl+Shift+H)', type: 'checkbox', checked: settings.toolbarVisible, click: () => action('toolbar') },
    { label: 'Клики насквозь', type: 'checkbox', checked: clickThrough,
      enabled: !!shortcuts.passthrough, click: togglePassthrough },
    { type: 'separator' },
    { label: 'Как пользоваться', click: () => { showWindow(); action('help'); } },
    { label: 'Закрыть GlassType', click: () => app.quit() }
  ]));
}

function external(url) {
  if (isExternalUrl(url)) shell.openExternal(url).catch(() => {});
}

function secureContents(contents, auth = false) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isAuthUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 560, height: 720, minWidth: 420, minHeight: 500,
          parent: win, modal: false, frame: true, transparent: false,
          backgroundColor: '#181c25', autoHideMenuBar: true, show: true,
          webPreferences: { nodeIntegration: false, contextIsolation: true,
            sandbox: true, webSecurity: true, partition: 'persist:monkeytype' }
        }
      };
    }
    external(url);
    return { action: 'deny' };
  });
  const guard = (event, url) => {
    if (isMonkeytype(url) || (auth && isAuthUrl(url))) return;
    event.preventDefault();
    external(url);
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-attach-webview', event => event.preventDefault());
  contents.on('did-create-window', child => {
    authWindows.add(child);
    child.setMenu(null);
    child.setAlwaysOnTop(settings.alwaysOnTop);
    secureContents(child.webContents, true);
    child.on('closed', () => { authWindows.delete(child); });
  });
  contents.on('before-input-event', (event, input) => {
    if (auth || input.type !== 'keyDown') return;
    if (input.control && !input.alt && !input.shift && ['+', '=', '-', '0'].includes(input.key)) {
      event.preventDefault();
      if (input.key === '0') action('zoomReset');
      else action(input.key === '-' ? 'zoomOut' : 'zoomIn');
    }
    if (input.control && !input.shift && input.key.toLowerCase() === 'r') {
      event.preventDefault(); action('reload');
    }
  });
}

async function loadSite() {
  pageState = 'loading'; lastError = '';
  startLoadTimeout();
  publish(); layout();
  try { await site.webContents.loadURL(HOME); }
  catch { /* did-fail-load provides the retry UI; do not replace the remote origin. */ }
}

async function action(name) {
  switch (name) {
    case 'pin':
      settings.alwaysOnTop = !settings.alwaysOnTop;
      win.setAlwaysOnTop(settings.alwaysOnTop);
      for (const child of authWindows) child.setAlwaysOnTop(settings.alwaysOnTop);
      break;
    case 'compact': settings.compact = !settings.compact; await restyle(); break;
    case 'toolbar': settings.toolbarVisible = !settings.toolbarVisible; layout(); break;
    case 'ink': {
      const values = ['light', 'dark', 'theme'];
      settings.ink = values[(values.indexOf(settings.ink) + 1) % values.length];
      await restyle(); break;
    }
    case 'backdrop': {
      const values = [0, 0.2, 0.45, 0.8];
      settings.backdrop = values[(values.indexOf(settings.backdrop) + 1) % values.length];
      await restyle(); break;
    }
    case 'size': {
      const sizes = [[780, 420], [1040, 580], [1320, 760]];
      settings.sizeIndex = (settings.sizeIndex + 1) % sizes.length;
      const [width, height] = sizes[settings.sizeIndex];
      win.setBounds(clampBounds({ ...win.getBounds(), width, height }, allDisplays()));
      break;
    }
    case 'zoomIn': case 'zoomOut': case 'zoomReset':
      settings.zoom = name === 'zoomReset' ? 1 :
        Math.round(Math.min(1.6, Math.max(0.7, settings.zoom + (name === 'zoomIn' ? 0.1 : -0.1))) * 10) / 10;
      site.webContents.setZoomFactor(settings.zoom); break;
    case 'passthrough': togglePassthrough(); return state();
    case 'hide': win.hide(); return state();
    case 'close': app.quit(); return state();
    case 'reload': loadSite(); return state();
    case 'home':
      helpOpen = false;
      loadSite(); return state();
    case 'browser': external(HOME); return state();
    case 'extensionFolder':
      shell.openPath(app.isPackaged ? path.join(path.dirname(process.execPath), 'GlassType Connect') : path.join(__dirname, '../chrome-extension'));
      return state();
    case 'google':
      helpOpen = false;
      browserLogin.start();
      return state();
    case 'cancelLogin':
      await browserLogin.cancel();
      loginStatus = { status: 'idle', detail: '' };
      layout(); publish(); return state();
    case 'help': helpOpen = !helpOpen; layout(); break;
    case 'dismissHelp':
      helpOpen = false; settings.hasLaunched = true; layout();
      if (pageState === 'ready') site.webContents.focus();
      break;
    default: return state();
  }
  saveSoon(); publish();
  if (!helpOpen && pageState === 'ready') site.webContents.focus();
  return state();
}

function trusted(event) {
  return win && event.sender === win.webContents &&
    event.senderFrame === win.webContents.mainFrame && event.senderFrame.url === shellUrl;
}

function createWindow() {
  win = new BrowserWindow({
    ...clampBounds(settings.bounds, allDisplays()), title: 'GlassType',
    icon: path.join(__dirname, '../assets/icon.png'), frame: false,
    transparent: true, backgroundColor: '#00000000', hasShadow: false,
    resizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: settings.alwaysOnTop, show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'shell-preload.cjs'),
      sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true }
  });
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('will-attach-webview', event => event.preventDefault());

  const profile = session.fromPartition('persist:monkeytype');
  profile.setPermissionRequestHandler((contents, permission, callback) => {
    callback(isMonkeytype(contents.getURL()) && permission === 'clipboard-sanitized-write');
  });
  profile.setPermissionCheckHandler((contents, permission, origin) =>
    isMonkeytype(origin) && permission === 'clipboard-sanitized-write');

  site = new WebContentsView({ webPreferences: {
    partition: 'persist:monkeytype', sandbox: true, contextIsolation: true,
    nodeIntegration: false, webSecurity: true, spellcheck: false,
    backgroundThrottling: false
  } });
  site.setBackgroundColor('#00000000');
  site.webContents.setZoomFactor(settings.zoom);
  secureContents(site.webContents);
  win.contentView.addChildView(site);
  layout();
  browserLogin = new BrowserLogin({
    openBrowser: openInChrome,
    onState: (status, detail) => {
      loginStatus = { status, detail };
      if (status === 'success') { helpOpen = false; settings.hasLaunched = true; saveSoon(); }
      publish(); layout();
      if (status === 'success') showWindow();
    },
    importSession: async data => {
      if (!isFirebaseSession(data)) throw new Error('Invalid authentication session');
      if (pageState !== 'ready' || !isMonkeytype(site.webContents.getURL())) {
        await site.webContents.loadURL(HOME);
      }
      // Only the original Monkeytype origin receives its own session.
      await site.webContents.executeJavaScript(`(${importFirebaseSession.toString()})(${JSON.stringify(data)})`);
      await loadSite();
    }
  });

  site.webContents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => {
    if (isMainFrame && !inPlace) {
      ++styleRevision; cssKey = null;
      pageState = 'loading'; publish(); layout();
      startLoadTimeout();
    }
  });
  site.webContents.on('dom-ready', restyle);
  site.webContents.on('did-navigate-in-page', (_event, _url, isMainFrame) => {
    if (isMainFrame) updatePageAppearance();
  });
  site.webContents.on('did-finish-load', async () => {
    if (pageState === 'error' || !isMonkeytype(site.webContents.getURL())) return;
    await restyle();
    await site.webContents.executeJavaScriptInIsolatedWorld(1001, [{ code: `(${installTypingShortcuts.toString()})()` }]);
    clearTimeout(loadTimer);
    pageState = 'ready'; lastError = '';
    publish(); layout();
    if (!helpOpen && win.isFocused()) site.webContents.focus();
  });
  site.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (!isMainFrame || code === -3) return;
    clearTimeout(loadTimer);
    pageState = 'error'; lastError = description;
    publish(); layout();
  });
  site.webContents.on('render-process-gone', () => {
    clearTimeout(loadTimer);
    pageState = 'error'; lastError = 'Страница остановилась. Нажмите «Повторить».';
    publish(); layout();
  });

  win.on('resize', layout);
  const rememberBounds = () => { settings.bounds = win.getBounds(); saveSoon(); };
  win.on('move', rememberBounds);
  win.on('resize', rememberBounds);
  win.on('close', persist);
  win.on('closed', () => {
    clearTimeout(loadTimer);
    if (site && !site.webContents.isDestroyed()) site.webContents.close();
    win = null;
  });
  win.once('ready-to-show', () => win.show());
  win.loadFile(shellFile);
  loadSite();

  const register = (accelerator, callback) => {
    try { return globalShortcut.register(accelerator, callback); } catch { return false; }
  };
  shortcuts = {
    toggle: register('CommandOrControl+Shift+Space', toggleWindow),
    passthrough: register('CommandOrControl+Shift+X', togglePassthrough),
    compact: register('CommandOrControl+Shift+M', () => action('compact')),
    toolbar: register('CommandOrControl+Shift+H', () => action('toolbar'))
  };
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '../assets/icon.png')).resize({ width: 24, height: 24 }));
  tray.on('double-click', showWindow);
  updateTray(); publish();
  screen.on('display-removed', () => {
    if (win) win.setBounds(clampBounds(win.getBounds(), allDisplays()));
  });
}

ipcMain.handle('glass:state', event => trusted(event) ? state() : null);
ipcMain.handle('glass:action', (event, name) => {
  if (!trusted(event) || typeof name !== 'string') return null;
  return action(name);
});
ipcMain.on('glass:resize', (event, phase, point) => {
  if (!trusted(event)) return;
  if (phase === 'start') {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    resizeStart = { point, bounds: win.getBounds() };
  } else if (phase === 'end') { resizeStart = null; }
  else if (phase === 'move' && resizeStart && point && Number.isFinite(point.x) && Number.isFinite(point.y)) {
    const width = resizeStart.bounds.width + point.x - resizeStart.point.x;
    const height = resizeStart.bounds.height + point.y - resizeStart.point.y;
    win.setBounds(clampBounds({ ...resizeStart.bounds, width, height }, allDisplays()));
  }
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) showWindow(); });
  app.whenReady().then(createWindow).catch(error => {
    dialog.showErrorBox('GlassType', `Не удалось открыть приложение.\n${error.message}`);
    app.quit();
  });
}
app.on('window-all-closed', () => app.quit());
let quittingAfterLogin = false;
app.on('before-quit', event => {
  if (browserLogin?.active && !quittingAfterLogin) {
    event.preventDefault(); quittingAfterLogin = true;
    browserLogin.cancel().finally(() => app.quit());
  }
});
app.on('will-quit', () => { globalShortcut.unregisterAll(); tray?.destroy(); });
