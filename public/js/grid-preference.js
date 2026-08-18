(function exposeGridPreference(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.GridPreference = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createGridPreference() {
  const GRID_SIZE_STORAGE_KEY = 'testFarmDashboard.gridSize';
  const VALID_GRID_SIZES = ['3x3', '4x4', '5x5'];

  function isValidGridSize(value) {
    return VALID_GRID_SIZES.includes(value);
  }

  function loadGridSize(storage) {
    try {
      const value = storage.getItem(GRID_SIZE_STORAGE_KEY);
      return isValidGridSize(value) ? value : null;
    } catch (error) {
      return null;
    }
  }

  function saveGridSize(storage, gridSize) {
    if (!isValidGridSize(gridSize)) return false;
    try {
      storage.setItem(GRID_SIZE_STORAGE_KEY, gridSize);
      return true;
    } catch (error) {
      return false;
    }
  }

  function resolveGridSize(savedGridSize, serverGridSize, fallback = '4x4') {
    if (isValidGridSize(savedGridSize)) return savedGridSize;
    if (isValidGridSize(serverGridSize)) return serverGridSize;
    return isValidGridSize(fallback) ? fallback : '4x4';
  }

  return {
    GRID_SIZE_STORAGE_KEY,
    isValidGridSize,
    loadGridSize,
    resolveGridSize,
    saveGridSize
  };
}));
