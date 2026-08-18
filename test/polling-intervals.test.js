const test = require('node:test');
const assert = require('node:assert/strict');
const {
  POLL_INTERVAL_MS,
  CONSOLE_POLL_INTERVAL_MS
} = require('../server/scheduler');

test('uses the balanced Jenkins polling intervals', () => {
  assert.equal(POLL_INTERVAL_MS, 60000);
  assert.equal(CONSOLE_POLL_INTERVAL_MS, 10000);
});

test('dashboard refreshes its cache every 10 seconds', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'dashboard.js'),
    'utf8'
  );

  assert.match(source, /const DATA_REFRESH_MS = 10000;/);
});
