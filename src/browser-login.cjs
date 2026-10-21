// Uses a normal Chrome URL launch. The Chrome companion
// sends only Monkeytype's session to a short-lived, authenticated loopback URL.
const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');

function isFirebaseSession(data) {
  if (!data || typeof data !== 'object' || !data.value || typeof data.key !== 'string') return false;
  const user = data.value;
  return /^firebase:authUser:[A-Za-z0-9_-]+:\[DEFAULT\]$/.test(data.key) &&
    typeof user.uid === 'string' && user.uid.length > 0 &&
    typeof user.apiKey === 'string' && data.key === `firebase:authUser:${user.apiKey}:[DEFAULT]` &&
    typeof user.stsTokenManager?.refreshToken === 'string' && user.stsTokenManager.refreshToken.length > 0 &&
    JSON.stringify(data).length < 262144;
}

async function exportFirebaseSession() {
  if (location.origin !== 'https://monkeytype.com') return null;
  const found = [];
  for (const storage of [sessionStorage, localStorage]) {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (!key?.startsWith('firebase:authUser:')) continue;
      try { found.push({ key, value: JSON.parse(storage.getItem(key)) }); } catch { /* Not an auth record. */ }
    }
  }
  const databases = await indexedDB.databases();
  if (databases.some(db => db.name === 'firebaseLocalStorageDb')) {
    const records = await new Promise((resolve, reject) => {
      const request = indexedDB.open('firebaseLocalStorageDb');
      request.onerror = () => reject(new Error('Cannot open login storage'));
      request.onsuccess = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); resolve([]); return; }
        const transaction = db.transaction('firebaseLocalStorage', 'readonly');
        const read = transaction.objectStore('firebaseLocalStorage').getAll();
        read.onerror = () => { db.close(); reject(new Error('Cannot read login storage')); };
        read.onsuccess = () => { resolve(read.result); db.close(); };
      };
    });
    for (const record of records) found.push({ key: record.fbase_key, value: record.value });
  }
  return found.find(record => typeof record.key === 'string' &&
    record.key.startsWith('firebase:authUser:') && record.value?.uid &&
    record.value?.stsTokenManager?.refreshToken) || null;
}

async function importFirebaseSession(data) {
  if (location.origin !== 'https://monkeytype.com') throw new Error('Unexpected login origin');
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('firebaseLocalStorageDb', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('firebaseLocalStorage')) {
        db.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
      }
    };
    request.onerror = () => reject(new Error('Cannot open login storage'));
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('firebaseLocalStorage', 'readwrite');
      transaction.objectStore('firebaseLocalStorage').put({ fbase_key: data.key, value: data.value });
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(new Error('Cannot save login')); };
      transaction.onabort = () => { db.close(); reject(new Error('Login storage interrupted')); };
    };
  });
  // The original site's Firebase initialization reads this preference.
  localStorage.setItem('firebasePersistence', 'LOCAL');
  sessionStorage.removeItem(data.key);
  return true;
}

function reply(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
}

class BrowserLogin {
  constructor({ openBrowser, onState, importSession }) {
    this.openBrowser = openBrowser; this.onState = onState; this.importSession = importSession;
    this.flow = null;
  }
  get active() { return !!this.flow; }
  async cancel() {
    const flow = this.flow;
    this.flow = null;
    if (!flow) return;
    clearTimeout(flow.timer);
    await new Promise(resolve => {
      flow.server.close(resolve);
      flow.server.closeAllConnections();
    });
  }
  async start() {
    if (this.active) return;
    const flow = { nonce: randomBytes(32).toString('hex'), processing: false };
    this.flow = flow;
    flow.server = http.createServer((request, response) => this.receive(flow, request, response));
    flow.server.requestTimeout = 15000;
    flow.server.headersTimeout = 10000;
    flow.server.keepAliveTimeout = 500;
    try {
      await new Promise((resolve, reject) => {
        flow.server.once('error', reject);
        flow.server.listen(0, '127.0.0.1', resolve);
      });
      if (this.flow !== flow) { flow.server.close(); return; }
      flow.port = flow.server.address().port;
      flow.timer = setTimeout(() => {
        if (this.flow !== flow) return;
        this.cancel();
        this.onState('error', 'Нет ответа от расширения. Добавьте GlassTape Connect в свой Chrome и повторите вход.');
      }, 300000);
      this.onState('waiting', 'Monkeytype открыт в обычном браузере с вашим профилем. Если вы уже вошли, расширение GlassTape Connect подключит аккаунт автоматически.');
      await this.openBrowser('https://monkeytype.com/login#glasstape-connect=' + flow.port + '.' + flow.nonce);
    } catch {
      if (this.flow === flow) {
        await this.cancel();
        this.onState('error', 'Не удалось открыть браузер. Повторите подключение.');
      }
    }
  }
  async receive(flow, request, response) {
    if (this.flow !== flow) { reply(response, 410, { ok: false }); return; }
    const authorization = request.headers.authorization || '';
    const expected = 'Bearer ' + flow.nonce;
    const actualBytes = Buffer.from(authorization);
    const expectedBytes = Buffer.from(expected);
    const origin = request.headers.origin;
    const allowedOrigin = !origin || /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
    if (request.method !== 'POST' || request.url !== '/session' ||
      request.headers.host !== '127.0.0.1:' + flow.port || !allowedOrigin ||
      actualBytes.length !== expectedBytes.length ||
      !timingSafeEqual(actualBytes, expectedBytes)) {
      reply(response, 403, { ok: false }); return;
    }
    if (flow.processing) { reply(response, 409, { ok: false }); return; }
    const chunks = [];
    let size = 0;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 262144) { reply(response, 413, { ok: false }); return; }
        chunks.push(chunk);
      }
      let data;
      try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { reply(response, 400, { ok: false }); return; }
      if (!isFirebaseSession(data)) { reply(response, 400, { ok: false }); return; }
      if (this.flow !== flow) { reply(response, 410, { ok: false }); return; }
      flow.processing = true;
      this.onState('importing', 'Подключаем ваш аккаунт к GlassTape…');
      await this.importSession(data);
      if (this.flow !== flow) { reply(response, 410, { ok: false }); return; }
      reply(response, 200, { ok: true });
      this.flow = null;
      clearTimeout(flow.timer);
      flow.server.close();
      flow.server.closeIdleConnections();
      this.onState('success', 'Аккаунт подключён. Вход сохранён в GlassTape.');
    } catch {
      flow.processing = false;
      if (!response.headersSent) reply(response, 500, { ok: false });
      if (this.flow === flow) {
        await this.cancel();
        this.onState('error', 'Не удалось сохранить вход в GlassTape. Повторите подключение.');
      }
    }
  }
}

module.exports = { BrowserLogin, isFirebaseSession, exportFirebaseSession, importFirebaseSession };
