const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const store = require('../server/store');

test('reports a configuration write failure instead of returning unsaved settings', () => {
  const originalExistsSync = fs.existsSync;
  const originalWriteFileSync = fs.writeFileSync;
  const originalConsoleError = console.error;
  const errors = [];

  fs.existsSync = () => true;
  fs.writeFileSync = (filePath) => {
    const error = new Error(`EACCES: permission denied, open '${filePath}'`);
    error.code = 'EACCES';
    throw error;
  };
  console.error = (...args) => errors.push(args.join(' '));

  try {
    assert.throws(
      () => store.updateSettings({ gridSize: '3x3' }),
      /EACCES: permission denied/
    );
    assert.match(errors.join('\n'), /Error saving config file: EACCES/);
  } finally {
    fs.existsSync = originalExistsSync;
    fs.writeFileSync = originalWriteFileSync;
    console.error = originalConsoleError;
  }
});
