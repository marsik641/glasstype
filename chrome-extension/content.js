// No storage is read until the user starts a connection from GlassTape.
(async () => {
  if (location.origin !== 'https://monkeytype.com') return;
  const key = 'glasstape.pending-connection';
  const match = /^#glasstape-connect=(\d{4,5})\.([a-f0-9]{64})$/.exec(location.hash);
  let flow;
  try {
    if (match) {
      flow = { port: Number(match[1]), nonce: match[2], expires: Date.now() + 300000 };
      sessionStorage.setItem(key, JSON.stringify(flow));
      history.replaceState(history.state, '', location.pathname + location.search);
    } else {
      flow = JSON.parse(sessionStorage.getItem(key) || 'null');
    }
  } catch { return; }
  if (!flow || flow.port < 1024 || flow.port > 65535 || !/^[a-f0-9]{64}$/.test(flow.nonce)) return;
  while (Date.now() < flow.expires) {
    try {
      const session = await exportFirebaseSession();
      if (session) {
        const result = await chrome.runtime.sendMessage({ kind: 'glasstape-session', port: flow.port, nonce: flow.nonce, session });
        if (result?.ok) {
          sessionStorage.removeItem(key);
          return;
        }
      }
    } catch { /* Login navigation or a closed client can interrupt the connection. */ }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  sessionStorage.removeItem(key);
})();
