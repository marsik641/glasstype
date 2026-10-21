const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function openInChrome(url) {
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean);
  const executable = roots.map(root => path.join(root, 'Google/Chrome/Application/chrome.exe')).find(file => fs.existsSync(file));
  if (!executable) return Promise.reject(new Error('Chrome не найден'));
  return new Promise((resolve, reject) => {
    // A plain URL: Chrome selects its existing profile and window normally.
    // Do not pass a data directory, profile name, debug flag or new-window flag.
    const child = spawn(executable, [url], { stdio: 'ignore', windowsHide: false, detached: true });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

module.exports = { openInChrome };
