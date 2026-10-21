const api = window.glassType;
let current;
function render(state) {
  if (!state) return;
  current = state;
  const login = state.loginStatus || { status: 'idle', detail: '' };
  const loginVisible = ['waiting', 'importing', 'error'].includes(login.status);
  document.querySelector('.toolbar').hidden = !state.toolbarShown;
  document.getElementById('resizeGrip').hidden = !state.toolbarShown;
  document.getElementById('welcome').hidden = !state.helpOpen || loginVisible;
  document.getElementById('loading').hidden = state.helpOpen || loginVisible || state.pageState !== 'loading';
  document.getElementById('error').hidden = state.helpOpen || loginVisible || state.pageState !== 'error';
  document.getElementById('loginPanel').hidden = !loginVisible;
  document.getElementById('loginTitle').textContent = login.status === 'error' ? 'Вход не завершён' : login.status === 'importing' ? 'Подключаем аккаунт' : 'Подключение вашего браузера';
  document.getElementById('loginDetail').textContent = login.detail;
  document.getElementById('retryLogin').hidden = login.status !== 'error';
  document.getElementById('googleLogin').disabled = ['waiting', 'importing'].includes(login.status);
  document.getElementById('errorDetail').textContent = state.lastError;
  const connection = document.getElementById('connection');
  connection.className = `dot ${state.pageState}`;
  connection.title = { loading: 'Подключаемся к monkeytype.com', ready: 'Оригинальный monkeytype.com', error: 'Нет подключения к Monkeytype' }[state.pageState];
  document.getElementById('compact').setAttribute('aria-pressed', String(state.compact));
  document.getElementById('pin').setAttribute('aria-pressed', String(state.alwaysOnTop));
  document.getElementById('passthrough').setAttribute('aria-pressed', String(state.clickThrough));
  document.getElementById('passthrough').disabled = !state.shortcuts.passthrough;
  document.getElementById('backdrop').querySelector('span').textContent = `${Math.round(state.backdrop * 100)}%`;
  document.getElementById('ink').title = `Цвет текста: ${{ light: 'светлый', dark: 'тёмный', theme: 'из темы Monkeytype' }[state.ink]}. Нажмите для смены`;
  document.getElementById('ink').style.color = { light: '#f1f5fa', dark: '#9fbbdb', theme: '#e4bd75' }[state.ink];
  document.getElementById('shortcutWarning').hidden = Object.values(state.shortcuts).every(Boolean);
  document.getElementById('helpButton').setAttribute('aria-pressed', String(state.helpOpen));
  document.getElementById('passthroughHint').hidden = !state.clickThrough;
  document.body.classList.toggle('passthrough', state.clickThrough);
}
api.onState(render);
api.ready().then(render);
document.addEventListener('click', async event => {
  const button = event.target.closest('button[data-action]');
  if (!button || button.disabled) return;
  try { render(await api.action(button.dataset.action)); }
  catch { /* Closing the application can close the IPC channel before it replies. */ }
  if (button.dataset.action !== 'help') button.blur();
});
const grip = document.getElementById('resizeGrip');
grip.addEventListener('pointerdown', event => {
  if (event.button !== 0) return;
  grip.setPointerCapture(event.pointerId);
  api.resize('start', { x: event.screenX, y: event.screenY });
});
grip.addEventListener('pointermove', event => {
  if (grip.hasPointerCapture(event.pointerId)) api.resize('move', { x: event.screenX, y: event.screenY });
});
for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  grip.addEventListener(name, () => api.resize('end'));
}
