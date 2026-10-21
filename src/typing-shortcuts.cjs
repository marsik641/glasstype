// Runs in a renderer isolated world. It uses the site's existing restart button
// only when Monkeytype has not already handled Tab itself.
function installTypingShortcuts() {
  if (globalThis.__glassTypeTypingShortcuts) return;
  globalThis.__glassTypeTypingShortcuts = true;
  const visible = element => element?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  const modalOpen = () => [...document.querySelectorAll('.modal, [role="dialog"], dialog[open], #commandLine, #commandLineWrapper')].some(visible);
  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    const page = document.querySelector('.pageTest:not(.hidden)');
    if (!visible(page) || modalOpen()) return;
    const active = document.activeElement;
    const wordsInput = document.getElementById('wordsInput');
    if (active && active !== document.body && active !== document.documentElement && active !== wordsInput && !active.closest('#typingTest, .pageTest')) return;
    if (active !== wordsInput && active?.matches('input, textarea, select, [contenteditable="true"]')) return;
    const restart = page.querySelector('[data-ui-element="restartTestButton"], #restartTestButton');
    if (!restart || restart.disabled) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat) return;
    restart.click();
    requestAnimationFrame(() => {
      if (!modalOpen() && document.getElementById('wordsInput')) {
        document.getElementById('wordsInput').focus({ preventScroll: true });
      }
    });
  });
}

module.exports = { installTypingShortcuts };
