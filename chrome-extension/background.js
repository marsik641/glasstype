chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || sender.frameId !== 0 ||
    !sender.url?.startsWith('https://monkeytype.com/') || message?.kind !== 'glasstape-session' ||
    !Number.isInteger(message.port) || message.port < 1024 || message.port > 65535 ||
    !/^[a-f0-9]{64}$/.test(message.nonce)) return;
  fetch(`http://127.0.0.1:${message.port}/session`, {
    method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${message.nonce}` },
    body: JSON.stringify(message.session), signal: AbortSignal.timeout(35000)
  }).then(response => respond({ ok: response.ok })).catch(() => respond({ ok: false }));
  return true;
});
