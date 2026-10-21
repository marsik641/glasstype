const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isMonkeytype, isAuthUrl, isExternalUrl, clampBounds, sanitizeSettings } = require('../src/policy.cjs');
const { monkeyStyle } = require('../src/monkey-style.cjs');
const { isFirebaseSession } = require('../src/browser-login.cjs');

test('remote navigation cannot escape the exact Monkeytype HTTPS origins', () => {
  assert.ok(isMonkeytype('https://monkeytype.com/account'));
  assert.ok(isMonkeytype('https://www.monkeytype.com/'));
  for (const value of [
    'https://monkeytype.com.evil.example/', 'https://monkeytype.com@evil.example/',
    'https://evil.example@monkeytype.com/', 'http://monkeytype.com/',
    'https://monkeytype.com:8443/',
    'javascript:alert(1)', 'file:///C:/Windows/win.ini', 'not a url'
  ]) assert.equal(isMonkeytype(value), false, value);
});

test('auth windows only allow known identity providers; external links exclude executable schemes', () => {
  assert.ok(isAuthUrl('https://monkey-type.firebaseapp.com/__/auth/handler'));
  assert.ok(isAuthUrl('https://accounts.google.com/o/oauth2/auth'));
  assert.ok(isAuthUrl('https://github.com/login/oauth/authorize'));
  assert.equal(isAuthUrl('https://evil.firebaseapp.com/__/auth/handler'), false);
  assert.equal(isAuthUrl('https://github.com/someone/repository'), false);
  assert.equal(isAuthUrl('https://accounts.google.com.evil.example/'), false);
  assert.ok(isExternalUrl('https://monkeytype.com/about'));
  assert.ok(isExternalUrl('mailto:contact@monkeytype.com'));
  for (const value of ['file:///C:/private', 'ms-settings:privacy', 'javascript:alert(1)', 'data:text/html,test']) {
    assert.equal(isExternalUrl(value), false, value);
  }
});

test('window is recovered after a monitor is disconnected, with negative-coordinate displays supported', () => {
  const primary = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  const secondary = { workArea: { x: -1280, y: 0, width: 1280, height: 984 } };
  const saved = { x: -1200, y: 100, width: 1040, height: 580 };
  assert.deepEqual(clampBounds(saved, [primary, secondary]), saved);
  const recovered = clampBounds(saved, [primary]);
  assert.ok(recovered.x >= 0 && recovered.y >= 0);
  assert.ok(recovered.x + recovered.width <= 1920);
  const giant = clampBounds({ x: 9000, y: 9000, width: 999999, height: 999999 }, [primary]);
  assert.deepEqual(giant, { x: 0, y: 0, width: 1920, height: 1040 });
  const corrupt = clampBounds({ x: NaN, y: Infinity, width: -5, height: 0 }, [primary]);
  assert.ok(Object.values(corrupt).every(Number.isFinite));
});

test('corrupt saved preferences fall back to visible, usable settings', () => {
  const value = sanitizeSettings({ ink: 'transparent', backdrop: -1, zoom: Infinity,
    alwaysOnTop: 'false', compact: null, sizeIndex: 100, hasLaunched: false });
  assert.equal(value.ink, 'light');
  assert.equal(value.backdrop, 0);
  assert.equal(value.zoom, 1);
  assert.equal(value.compact, false);
  assert.equal(value.alwaysOnTop, true);
  assert.equal(sanitizeSettings({ zoom: 999 }).zoom, 1.6);
});

test('transparent overlay preserves native test modes and opaque dialogs', () => {
  const css = monkeyStyle(sanitizeSettings({ ink: 'dark', compact: true, backdrop: 0 }));
  assert.match(css, /rgba\(255, 255, 255, 0\)/);
  assert.match(css, /html\[data-glasstape-test\]/);
  assert.doesNotMatch(css, /letter\.correct\s*\{/);
  assert.doesNotMatch(css, /--bg-color:\s*transparent/);
  assert.doesNotMatch(css, /#words\.blurred\s*\{/);
  const theme = monkeyStyle(sanitizeSettings({ ink: 'theme' }));
  assert.doesNotMatch(theme, /--text-color:\s*#/);
});

test('browser login imports only a complete Monkeytype Firebase auth record', () => {
  const value = { uid: 'example', apiKey: 'fake-key', stsTokenManager: { refreshToken: 'fake-token' } };
  assert.ok(isFirebaseSession({ key: 'firebase:authUser:fake-key:[DEFAULT]', value }));
  assert.equal(isFirebaseSession({ key: 'firebase:authUser:wrong-key:[DEFAULT]', value }), false);
  assert.equal(isFirebaseSession({ key: 'google-cookie', value }), false);
  assert.equal(isFirebaseSession({ key: 'firebase:authUser:fake-key:[DEFAULT]', value: { uid: 'example' } }), false);
  assert.equal(isFirebaseSession(null), false);
});
