(function exposeTrendHistory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.TrendHistory = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createTrendHistory() {
  function prepareTrendBuilds(builds, limit = 10) {
    const completed = (Array.isArray(builds) ? builds : [])
      .filter(build => build && build.result && Number.isFinite(Number(build.number)))
      .sort((left, right) => Number(left.number) - Number(right.number));

    return completed.slice(-Math.max(0, limit));
  }

  return { prepareTrendBuilds };
}));
