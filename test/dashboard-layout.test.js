const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const css = fs.readFileSync(path.join(publicDir, 'css', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');

test('loads trend ordering before dashboard rendering', () => {
  assert.ok(
    html.indexOf('/js/trend-history.js') < html.indexOf('/js/dashboard.js'),
    'trend-history.js must load before dashboard.js'
  );
});

test('shows completed-build trends only in the 3x3 layout', () => {
  assert.match(css, /\.grid-3x3\s+\.card__trend\s*{[^}]*display:\s*block;/s);
  assert.match(
    css,
    /\.grid-4x4\s+\.card__trend\s*,\s*\.grid-5x5\s+\.card__trend\s*{[^}]*display:\s*none;/s
  );
});

test('wraps the complete live TEST CASE instead of truncating it', () => {
  const consoleTextRule = css.match(/\.card__console-text\s*{([^}]*)}/s);
  assert.ok(consoleTextRule, 'card__console-text rule is required');
  assert.match(consoleTextRule[1], /overflow-wrap:\s*anywhere;/);
  assert.match(consoleTextRule[1], /white-space:\s*normal;/);
  assert.doesNotMatch(consoleTextRule[1], /text-overflow:\s*ellipsis;/);
});
