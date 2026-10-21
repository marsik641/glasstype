// Repeatable anonymous typing workload. No real account or user profile is read.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { _electron } = createRequire(path.resolve(process.argv[2]))('playwright');
const root = path.resolve(__dirname, '..');
const label = process.argv[3] || 'current';
const override = process.argv[4];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const profileDir = path.join(root, '.test-profile', 'typing-performance');
  await fs.mkdir(profileDir, { recursive: true });
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  await fs.writeFile(path.join(profileDir, 'settings.json'), JSON.stringify({
    compact: true, hasLaunched: true, ink: 'light', toolbarVisible: false,
    bounds: { x: 650, y: 300, width: 1040, height: 580 }
  }));
  const env = { ...process.env, GLASSTYPE_TEST_PROFILE: profileDir };
  for (const key of Object.keys(env)) if (/^(ELECTRON_RUN_AS_NODE|NODE_OPTIONS)$/i.test(key)) delete env[key];
  let target = root;
  if (override) {
    target = path.join(root, 'artifacts', 'profile-bootstrap.cjs');
    await fs.writeFile(target, `const style = require('../src/monkey-style.cjs');\nstyle.monkeyStyle = () => require('node:fs').readFileSync(${JSON.stringify(path.resolve(override))}, 'utf8');\nrequire('../src/main.cjs');\n`);
  }
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [target], env });
  try {
    await app.firstWindow();
    let shell;
    for (let i = 0; i < 80; i++) {
      shell = app.context().pages().find(p => p.url().startsWith('file:') && p.url().endsWith('/shell.html'));
      if (shell) break;
      await delay(100);
    }
    await shell.waitForSelector('#connection');
    for (let i = 0; i < 120; i++) {
      const state = await shell.evaluate(() => window.glassType.ready());
      if (state.pageState === 'ready') break;
      if (state.pageState === 'error') throw new Error(state.lastError);
      await delay(250);
    }
    const site = app.context().pages().find(p => p.url().startsWith('https://monkeytype.com/'));
    await site.waitForSelector('#words .word');
    const reject = site.locator('button').filter({ hasText: /^reject non-essential$/ });
    if (await reject.count() === 1 && await reject.isVisible()) {
      await reject.click(); await reject.waitFor({ state: 'hidden' });
    }
    // Match continuous, smoothly scrolling tape without changing the real profile.
    await site.evaluate(() => {
      const config = JSON.parse(localStorage.getItem('config') || '{}');
      Object.assign(config, { tapeMode: 'letter', smoothLineScroll: true, smoothCaret: 'medium',
        mode: 'words', words: 1000, language: 'english', quickRestart: 'tab' });
      localStorage.setItem('config', JSON.stringify(config));
    });
    await site.reload();
    await site.waitForSelector('#words.tape .word');
    await delay(1800);
    await site.locator('#wordsWrapper').click({ force: true });
    const cdp = await app.context().newCDPSession(site);
    await cdp.send('Performance.enable');
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 2000 });
    await site.evaluate(() => {
      const stats = { frames: [], input: [], long: [], stopped: false, last: null, marginChanges: 0, lastMargin: '' };
      globalThis.__typingProfile = stats;
      stats.observer = new PerformanceObserver(list => {
        stats.long.push(...list.getEntries().map(entry => entry.duration));
      });
      stats.observer.observe({ type: 'longtask' });
      stats.key = event => {
        if (event.key.length !== 1) return;
        const start = performance.now();
        requestAnimationFrame(() => stats.input.push(performance.now() - start));
      };
      document.addEventListener('keydown', stats.key, true);
      requestAnimationFrame(function frame(time) {
        if (stats.stopped) return;
        if (stats.last !== null) stats.frames.push(time - stats.last);
        stats.last = time;
        const margin = document.getElementById('words')?.style.marginLeft;
        if (margin !== stats.lastMargin) stats.marginChanges++;
        stats.lastMargin = margin;
        requestAnimationFrame(frame);
      });
    });
    const before = await cdp.send('Performance.getMetrics');
    await cdp.send('Profiler.start');
    const start = Date.now();
    let characters = 0;
    // The site generates and removes words as the tape advances. Read the next
    // batch at word boundaries to keep typing correctly throughout the run.
    while (characters < 1200) {
      const batch = await site.evaluate(() => {
        const words = [...document.querySelectorAll('#words .word')];
        const active = words.findIndex(word => word.classList.contains('active'));
        return words.slice(Math.max(active, 0), Math.max(active, 0) + 25).map(word => word.textContent).join(' ') + ' ';
      });
      if (batch.length < 2) throw new Error('Tape has no next words');
      await site.keyboard.type(batch, { delay: 25 });
      characters += batch.length;
    }
    await delay(600);
    const elapsedMs = Date.now() - start;
    const after = await cdp.send('Performance.getMetrics');
    const { profile } = await cdp.send('Profiler.stop');
    const browser = await site.evaluate(() => {
      const stats = globalThis.__typingProfile;
      stats.stopped = true; stats.observer.disconnect();
      document.removeEventListener('keydown', stats.key, true);
      const summarize = values => {
        const sorted = [...values].sort((a, b) => a - b);
        const at = p => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] || 0;
        return { count: values.length, p50: at(.5), p95: at(.95), p99: at(.99), max: at(1), above50: values.filter(v => v > 50).length };
      };
      const config = JSON.parse(localStorage.getItem('config'));
      return { config: { tapeMode: config.tapeMode, smoothLineScroll: config.smoothLineScroll, smoothCaret: config.smoothCaret, mode: config.mode, words: config.words },
        frames: summarize(stats.frames), keyToFrame: summarize(stats.input),
        tapeAnimationFrames: stats.marginChanges,
        longTasks: summarize(stats.long), shadow: getComputedStyle(document.getElementById('words')).textShadow,
        correct: document.querySelectorAll('#words letter.correct').length,
        nodes: document.querySelectorAll('*').length };
    });
    const metrics = {};
    for (const name of ['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount']) {
      metrics[name] = (after.metrics.find(m => m.name === name)?.value || 0) - (before.metrics.find(m => m.name === name)?.value || 0);
    }
    const counts = new Map();
    for (const sample of profile.samples || []) counts.set(sample, (counts.get(sample) || 0) + 1);
    const cpu = profile.nodes.map(node => ({
      name: node.callFrame.functionName || '(anonymous)',
      source: node.callFrame.url ? new URL(node.callFrame.url).pathname.split('/').pop() : '',
      samples: counts.get(node.id) || 0
    })).sort((a, b) => b.samples - a.samples).slice(0, 12);
    const gpu = await app.evaluate(({ app }) => app.getGPUFeatureStatus());
    const report = { label, elapsedMs, characters, ...browser, metrics, cpu, gpu };
    await fs.writeFile(path.join(root, 'artifacts', `typing-${label}.json`), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
