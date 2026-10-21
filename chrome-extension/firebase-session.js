// Generated from the shared Monkeytype session reader.
const exportFirebaseSession = async function exportFirebaseSession() {
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
};
