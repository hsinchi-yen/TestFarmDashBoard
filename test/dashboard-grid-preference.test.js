const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GRID_SIZE_STORAGE_KEY,
  getGridCapacity,
  loadGridSize,
  resolveGridSize,
  saveGridSize
} = require('../public/js/grid-preference');

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    }
  };
}

test('keeps every selected grid size across reloads and stale server refreshes', () => {
  for (const gridSize of ['3x3', '4x4', '5x5']) {
    const storage = createStorage();
    saveGridSize(storage, gridSize);

    const savedGridSize = loadGridSize(storage);
    assert.equal(savedGridSize, gridSize);
    assert.equal(resolveGridSize(savedGridSize, '5x5'), gridSize);
    assert.equal(resolveGridSize(savedGridSize, '3x3'), gridSize);
  }
});

test('uses the server grid as the initial default when no browser preference exists', () => {
  const storage = createStorage();

  assert.equal(loadGridSize(storage), null);
  assert.equal(resolveGridSize(null, '3x3'), '3x3');
  assert.equal(resolveGridSize(null, '4x4'), '4x4');
  assert.equal(resolveGridSize(null, '5x5'), '5x5');
});

test('ignores invalid stored values', () => {
  const storage = createStorage({ [GRID_SIZE_STORAGE_KEY]: '9x9' });

  assert.equal(loadGridSize(storage), null);
  assert.equal(resolveGridSize(null, '5x5'), '5x5');
});

test('uses the exact card capacity for every grid density', () => {
  assert.equal(getGridCapacity('3x3'), 9);
  assert.equal(getGridCapacity('4x4'), 16);
  assert.equal(getGridCapacity('5x5'), 25);
  assert.equal(getGridCapacity('invalid'), 16);
});
