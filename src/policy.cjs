const HOME = 'https://monkeytype.com/';

function parseUrl(value) {
  try { return new URL(value); } catch { return null; }
}

function isMonkeytype(value) {
  const url = parseUrl(value);
  return !!url && url.protocol === 'https:' &&
    ['https://monkeytype.com', 'https://www.monkeytype.com'].includes(url.origin) &&
    !url.username && !url.password;
}

// Firebase popup + the providers used by the original site. No custom auth flow.
function isAuthUrl(value) {
  const url = parseUrl(value);
  if (!url || url.protocol !== 'https:' || url.port || url.username || url.password) return false;
  return ['accounts.google.com', 'appleid.apple.com',
    'monkey-type.firebaseapp.com', 'monkeytype.firebaseapp.com',
    'monkey-type.web.app', 'monkeytype.web.app'].includes(url.hostname) ||
    (url.hostname === 'github.com' && /^\/(login|session|sessions)(\/|$)/.test(url.pathname)) ||
    (isMonkeytype(value) && url.pathname.startsWith('/__/auth/'));
}

function isExternalUrl(value) {
  const url = parseUrl(value);
  return !!url && ['https:', 'http:', 'mailto:'].includes(url.protocol) &&
    !url.username && !url.password;
}

function clampBounds(saved, displays) {
  const primary = displays[0].workArea;
  const candidate = saved && ['x', 'y', 'width', 'height'].every(k =>
    Number.isFinite(saved[k])) ? saved : null;
  const area = candidate ? (displays.find(({ workArea: a }) =>
    candidate.x < a.x + a.width && candidate.x + candidate.width > a.x &&
    candidate.y < a.y + a.height && candidate.y + candidate.height > a.y)?.workArea || primary) : primary;
  const width = Math.round(Math.min(area.width, Math.max(680, candidate?.width || 1040)));
  const height = Math.round(Math.min(area.height, Math.max(320, candidate?.height || 580)));
  return {
    x: Math.round(Math.min(area.x + area.width - width, Math.max(area.x, candidate?.x ?? area.x + area.width - width - 24))),
    y: Math.round(Math.min(area.y + area.height - height, Math.max(area.y, candidate?.y ?? area.y + area.height - height - 24))),
    width, height
  };
}

const DEFAULTS = Object.freeze({
  alwaysOnTop: true, compact: false, backdrop: 0, ink: 'light', zoom: 1,
  sizeIndex: 1, bounds: null, hasLaunched: false, toolbarVisible: false
});

function sanitizeSettings(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    alwaysOnTop: typeof v.alwaysOnTop === 'boolean' ? v.alwaysOnTop : DEFAULTS.alwaysOnTop,
    compact: typeof v.compact === 'boolean' ? v.compact : DEFAULTS.compact,
    toolbarVisible: typeof v.toolbarVisible === 'boolean' ? v.toolbarVisible : DEFAULTS.toolbarVisible,
    backdrop: [0, 0.2, 0.45, 0.8].includes(v.backdrop) ? v.backdrop : DEFAULTS.backdrop,
    ink: ['light', 'dark', 'theme'].includes(v.ink) ? v.ink : DEFAULTS.ink,
    zoom: typeof v.zoom === 'number' && Number.isFinite(v.zoom) ? Math.min(1.6, Math.max(0.7, v.zoom)) : 1,
    sizeIndex: [0, 1, 2].includes(v.sizeIndex) ? v.sizeIndex : 1,
    bounds: v.bounds && typeof v.bounds === 'object' ? v.bounds : null,
    hasLaunched: v.hasLaunched === true
  };
}

module.exports = { HOME, isMonkeytype, isAuthUrl, isExternalUrl, clampBounds, sanitizeSettings, DEFAULTS };
