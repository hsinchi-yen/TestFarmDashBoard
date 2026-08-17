const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchConsoleStatus, parseConsoleChunk } = require('../server/jenkins');

test('selects the latest Robot Framework result line', () => {
  const parsed = parseConsoleChunk([
    'TS02 CPU Benchmark :: CPU Benchmark | PASS |',
    '------------------------------------------------------------------------------',
    'TS03 GPU Benchmark(list GPU Library version) :: GPU Benchmark(list... | FAIL |',
    ''
  ].join('\n'));

  assert.equal(
    parsed.text,
    'TS03 GPU Benchmark(list GPU Library version) :: GPU Benchmark(list... | FAIL |'
  );
  assert.equal(parsed.result, 'fail');
});

test('joins a result line split across progressive chunks', () => {
  const first = parseConsoleChunk('TS03 GPU Benchmark :: GPU Benchmark | PA');
  const second = parseConsoleChunk('SS |\n', first);

  assert.equal(second.text, 'TS03 GPU Benchmark :: GPU Benchmark | PASS |');
  assert.equal(second.result, 'pass');
  assert.equal(second.fragment, '');
});

test('strips ANSI colour codes and preserves the last result during separators', () => {
  const first = parseConsoleChunk('\u001b[32mTS04 SDCARD Test :: SDCARD Test | PASS |\u001b[0m\n');
  const second = parseConsoleChunk('------------------------------------------------------------------------------\n', first);

  assert.equal(second.text, 'TS04 SDCARD Test :: SDCARD Test | PASS |');
  assert.equal(second.result, 'pass');
});

test('recognizes every supported Robot Framework result', () => {
  const expected = new Map([
    ['PASS', 'pass'],
    ['FAIL', 'fail'],
    ['SKIP', 'skip'],
    ['NOT RUN', 'not-run']
  ]);

  for (const [label, result] of expected) {
    const parsed = parseConsoleChunk(`TS01 Example :: Example | ${label} |\n`);
    assert.equal(parsed.text, `TS01 Example :: Example | ${label} |`);
    assert.equal(parsed.result, result);
  }
});

test('keeps the TEST CASE description when a progressive chunk only contains the result', () => {
  const previous = {
    text: 'TS02 System Boot Time Test :: System Boot Time Test',
    result: null,
    fragment: ''
  };

  const parsed = parseConsoleChunk('| PASS |\r\n', previous);

  assert.equal(
    parsed.text,
    'TS02 System Boot Time Test :: System Boot Time Test | PASS |'
  );
  assert.equal(parsed.result, 'pass');
});

test('recovers the complete TEST CASE from the bounded tail after a standalone result', async () => {
  const originalFetch = global.fetch;
  const calls = [];

  global.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return new Response('| PASS |\r\n', {
        status: 200,
        headers: { 'x-text-size': '110' }
      });
    }
    return new Response(
      'TS02 System Boot Time Test :: System Boot Time Test | PASS |\r\n',
      { status: 200, headers: { 'x-text-size': '110' } }
    );
  };

  try {
    const status = await fetchConsoleStatus(
      { url: 'http://jenkins.example', username: 'user', password: 'token' },
      'Robot Test',
      37,
      {
        buildNumber: 37,
        offset: 100,
        text: 'TS01 Previous Test :: Previous Test | PASS |',
        result: 'pass',
        fragment: ''
      }
    );

    assert.equal(calls.length, 2);
    assert.match(calls[0], /progressiveText\?start=100$/);
    assert.match(calls[1], /progressiveText\?start=0$/);
    assert.equal(
      status.text,
      'TS02 System Boot Time Test :: System Boot Time Test | PASS |'
    );
    assert.equal(status.result, 'pass');
  } finally {
    global.fetch = originalFetch;
  }
});
