const path = require('node:path');

function configureProfile(app, testProfile) {
  // Keep the original on-disk name: renaming it would lose the existing
  // account, settings and Chromium's encrypted session while the old client
  // may still be running. Product names and new builds use GlassType.
  const directory = testProfile && !app.isPackaged
    ? path.resolve(testProfile)
    : path.join(app.getPath('appData'), 'GlassTape');
  app.setPath('userData', directory);
  app.setPath('sessionData', directory);
  return directory;
}

module.exports = { configureProfile };
