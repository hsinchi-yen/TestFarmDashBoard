const test = require('node:test');
const assert = require('node:assert/strict');
const { prepareTrendBuilds } = require('../public/js/trend-history');

test('orders completed trend results by build number without grouping statuses', () => {
  const builds = [
    { number: 14, result: 'SUCCESS', duration: 1400 },
    { number: 11, result: 'FAILURE', duration: 1100 },
    { number: 13, result: null, duration: 0, building: true },
    { number: 12, result: 'ABORTED', duration: 1200 },
    { number: 10, result: 'SUCCESS', duration: 1000 }
  ];

  const trend = prepareTrendBuilds(builds);

  assert.deepEqual(trend.map(build => build.number), [10, 11, 12, 14]);
  assert.deepEqual(trend.map(build => build.result), [
    'SUCCESS',
    'FAILURE',
    'ABORTED',
    'SUCCESS'
  ]);
});

test('keeps the latest ten completed build numbers in chronological order', () => {
  const builds = Array.from({ length: 14 }, (_, index) => ({
    number: index + 1,
    result: index % 2 ? 'FAILURE' : 'SUCCESS',
    duration: 1000 + index
  })).reverse();

  assert.deepEqual(
    prepareTrendBuilds(builds).map(build => build.number),
    [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
  );
});
