const { packager } = require('@electron/packager');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFileSync } = require('node:child_process');
const { exportFirebaseSession } = require('../src/browser-login.cjs');

(async () => {
  const root = path.resolve(__dirname, '..');
  const dist = path.join(root, 'dist');
  const output = path.resolve(root, process.argv[2] || 'dist');
  if (output !== dist && !output.startsWith(dist + path.sep)) {
    throw new Error('Build output must stay inside dist/');
  }
  await fs.writeFile(path.join(root, 'chrome-extension/firebase-session.js'), `// Generated from the shared Monkeytype session reader.\nconst exportFirebaseSession = ${exportFirebaseSession.toString()};\n`);
  // Always package from a new, dedicated directory. Old diagnostics or files
  // from a previous staging directory must never enter a public release.
  const artifacts = path.join(root, 'artifacts');
  await fs.mkdir(artifacts, { recursive: true });
  const stage = await fs.mkdtemp(path.join(artifacts, 'package-'));
  try {
    for (const folder of ['src', 'assets']) {
      await fs.cp(path.join(root, folder), path.join(stage, folder), { recursive: true });
    }
    const manifest = { ...require('../package.json') };
    delete manifest.devDependencies;
    delete manifest.scripts;
    await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify(manifest, null, 2));
    await fs.copyFile(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'));
    const paths = await packager({
      dir: stage, name: 'GlassTape', executableName: 'GlassTape', prune: false,
      platform: 'win32', arch: 'x64', electronVersion: require('electron/package.json').version,
      download: { cacheRoot: path.join(root, '.electron-cache'), checksums: require('electron/checksums.json') },
      out: output, overwrite: true, asar: true,
      icon: path.join(root, 'assets/icon.ico'),
      appCopyright: 'GlassTape contributors',
      win32metadata: { CompanyName: 'GlassTape', FileDescription: 'GlassTape — transparent Monkeytype client', ProductName: 'GlassTape' },
      // Use only the application files; never include local profiles or checks.
      ignore: [/^\/(?:research|test|scripts|artifacts|\.test-profile|dist)(?:\/|$)/,
        /^\/\./, /^\/(?:README\.md|pnpm-lock\.yaml|pnpm-workspace\.yaml|.*\.cmd)$/]
    });
    for (const folder of paths) {
      // Standard read access for Chromium's sandbox to its public runtime files.
      // User profiles are stored elsewhere and are not affected.
      if (process.platform === 'win32') execFileSync('icacls', [folder, '/grant', '*S-1-15-2-1:(OI)(CI)(RX)'], { windowsHide: true, stdio: 'ignore' });
      await fs.copyFile(path.join(root, 'README.md'), path.join(folder, 'КАК ПОЛЬЗОВАТЬСЯ.txt'));
      await fs.copyFile(path.join(root, 'LICENSE'), path.join(folder, 'LICENSE-GlassTape.txt'));
      await fs.cp(path.join(root, 'chrome-extension'), path.join(folder, 'GlassTape Connect'), { recursive: true });
      console.log(path.join(folder, 'GlassTape.exe'));
    }
  } finally {
    // This is the absolute temporary directory just created inside artifacts/.
    if (path.dirname(stage) !== artifacts) throw new Error('Unexpected staging directory');
    await fs.rm(stage, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
