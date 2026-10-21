const fs = require('node:fs');
const path = require('node:path');
const base = fs.readFileSync(path.join(__dirname, 'monkey.css'), 'utf8');

function monkeyStyle(settings) {
  const dark = settings.ink === 'dark';
  const foreground = dark ? '#162131' : '#f5f7fb';
  const muted = dark ? '#536176' : '#b9c2d0';
  const accent = dark ? '#714000' : '#ffd580';
  const bg = dark ? '255, 255, 255' : '12, 17, 26';
  const palette = settings.ink === 'theme' ? '' : `
    html[data-glasstape-test] #app {
      --text-color: ${foreground} !important;
      --sub-color: ${muted} !important;
      --main-color: ${accent} !important;
      --caret-color: ${accent} !important;
      --error-color: ${dark ? '#bd1642' : '#ff7a91'} !important;
      --error-extra-color: ${dark ? '#8c1838' : '#ff4868'} !important;
    }
    #words { text-shadow: ${dark ? '0 1px 1px #ffffffb3' : '0 1px 1px #000c'}; }
  `;
  return base + `
    :root { --gt-backdrop: rgba(${bg}, ${settings.backdrop}); }
    ${palette}
    ${settings.compact ? `
      html[data-glasstape-test] header,
      html[data-glasstape-test] #header,
      html[data-glasstape-test] footer,
      html[data-glasstape-test] #footer,
      .pageTest #testConfig,
      .pageTest [data-ui-element="testConfig"],
      .pageTest [data-ui-element="testConfig"] + button,
      html[data-glasstape-test] body > div.fixed.z-1000,
      html[data-glasstape-test] #commandLineMobileButton { display: none !important; }
      html[data-glasstape-test] #app {
        padding: 16px 0 !important;
        gap: 0 !important;
        grid-template-rows: minmax(0, 1fr) !important;
      }
      html[data-glasstape-test] #app > main { grid-row: 1 !important; }
      .pageTest { margin-top: 0 !important; }
    ` : ''}
  `;
}

module.exports = { monkeyStyle };
