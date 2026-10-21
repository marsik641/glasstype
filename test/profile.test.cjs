const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { configureProfile } = require('../src/profile.cjs');

test('the renamed client reuses existing settings and site data; packaged builds ignore test overrides', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'glasstype-profile-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const legacy = path.join(root, 'GlassTape');
  const partition = path.join(legacy, 'Partitions', 'monkeytype');
  await fs.mkdir(partition, { recursive: true });
  await fs.writeFile(path.join(legacy, 'settings.json'), '{"hasLaunched":true,"ink":"dark"}');
  await fs.writeFile(path.join(partition, 'test-marker'), 'fake-existing-session');
  const paths = {};
  configureProfile({ isPackaged: true, getPath: () => root,
    setPath: (name, value) => { paths[name] = value; } }, path.join(root, 'unused-override'));
  assert.equal(JSON.parse(await fs.readFile(path.join(paths.userData, 'settings.json'))).ink, 'dark');
  assert.equal(await fs.readFile(path.join(paths.sessionData, 'Partitions', 'monkeytype', 'test-marker'), 'utf8'), 'fake-existing-session');
  assert.equal((await fs.readdir(root)).includes('GlassType'), false, 'no replacement profile is created');
});

test('development checks keep account data and browser sessions in their isolated test directory', () => {
  const isolated = path.resolve('.test-profile', 'profile-contract');
  const paths = {};
  configureProfile({ isPackaged: false, getPath: () => { throw new Error('Do not use the real profile'); },
    setPath: (name, value) => { paths[name] = value; } }, isolated);
  assert.equal(paths.userData, isolated);
  assert.equal(paths.sessionData, isolated);
});
