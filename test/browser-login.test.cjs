const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BrowserLogin } = require('../src/browser-login.cjs');

const session = { key: 'firebase:authUser:fake-key:[DEFAULT]', value: {
  uid: 'fake-user', apiKey: 'fake-key', displayName: 'Тестовый пользователь',
  stsTokenManager: { refreshToken: 'fake-token' }
} };

test('normal browser opens once; only the matching, single-use connection can import a session', async t => {
  const urls = [], imported = [], states = [];
  const login = new BrowserLogin({ openBrowser: async url => urls.push(url),
    onState: status => states.push(status), importSession: async value => imported.push(value) });
  t.after(() => login.cancel());
  await login.start();
  await login.start();
  assert.equal(urls.length, 1);
  const url = new URL(urls[0]);
  assert.equal(url.origin, 'https://monkeytype.com');
  const [port, nonce] = url.hash.slice('#glasstape-connect='.length).split('.');
  const endpoint = `http://127.0.0.1:${port}/session`;
  const post = (body, token = nonce, origin = 'chrome-extension://' + 'a'.repeat(32)) => fetch(endpoint, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: origin }, body: JSON.stringify(body)
  });
  assert.equal((await post(session, 'b'.repeat(64))).status, 403);
  assert.equal((await post(session, nonce, 'https://evil.example')).status, 403);
  assert.equal((await post({ key: 'unrelated-cookie', value: {} })).status, 400);
  assert.equal(imported.length, 0);
  const result = await post(session);
  assert.equal(result.status, 200);
  assert.deepEqual(imported, [session]);
  assert.deepEqual(states, ['waiting', 'importing', 'success']);
  assert.equal(login.active, false);
  await assert.rejects(fetch(endpoint, { method: 'POST' }));
});

test('cancel stops the local connection without touching the browser', async t => {
  let opened;
  const login = new BrowserLogin({ openBrowser: async url => { opened = new URL(url); },
    onState: () => {}, importSession: async () => assert.fail('cancelled connection imported data') });
  t.after(() => login.cancel());
  await login.start();
  const port = opened.hash.slice('#glasstape-connect='.length).split('.')[0];
  await login.cancel();
  assert.equal(login.active, false);
  await assert.rejects(fetch(`http://127.0.0.1:${port}/session`));
});
