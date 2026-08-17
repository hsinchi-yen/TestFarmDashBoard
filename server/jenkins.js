const REQUEST_TIMEOUT_MS = 15000;
const MAX_CONSOLE_TAIL_BYTES = 64 * 1024;
const ANSI_ESCAPE_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;
const CONSOLE_RESULT_PATTERN = /\|\s*(PASS|FAIL|SKIP|NOT RUN)\s*\|?\s*$/i;
const STANDALONE_RESULT_PATTERN = /^\|\s*(PASS|FAIL|SKIP|NOT RUN)\s*\|?\s*$/i;

function getAuthHeader(username, password) {
  if (!username || !password) return {};
  return {
    'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  };
}

// Strip trailing slashes so `${url}/api/json` never becomes `//api/json`
function normalizeUrl(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

// Every Jenkins call goes through here so a hung/unreachable controller can never
// stall the polling loop forever.
function jenkinsFetch(url, username, password, options = {}) {
  const { headers = {}, ...fetchOptions } = options;
  return fetch(url, {
    ...fetchOptions,
    headers: { ...getAuthHeader(username, password), ...headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
}

function cleanConsoleLine(line) {
  return line.replace(ANSI_ESCAPE_PATTERN, '').trimEnd();
}

function getConsoleResult(line) {
  const match = line.match(CONSOLE_RESULT_PATTERN);
  return match ? match[1].toLowerCase().replace(/\s+/g, '-') : null;
}

function isStandaloneConsoleResult(line) {
  return typeof line === 'string' && STANDALONE_RESULT_PATTERN.test(line.trim());
}

function isMeaningfulConsoleLine(line) {
  const trimmed = line.trim();
  return !!trimmed && !/^[\-=]{5,}$/.test(trimmed);
}

// Jenkins progressiveText can end halfway through a UTF-8/logical line. Keep
// that fragment for the next request and only promote complete lines to the UI.
function parseConsoleChunk(chunk, previous = {}) {
  const combined = `${previous.fragment || ''}${chunk || ''}`;
  const parts = combined.split(/\r?\n/);
  const endsWithNewline = /(?:\r?\n)$/.test(combined);
  const fragment = endsWithNewline ? '' : (parts.pop() || '');
  const lines = parts.map(cleanConsoleLine).filter(isMeaningfulConsoleLine);

  const latestResultLine = [...lines].reverse().find(line => getConsoleResult(line));
  const fallbackLine = [...lines].reverse().find(isMeaningfulConsoleLine);
  const standaloneResult = isStandaloneConsoleResult(latestResultLine);
  let text = latestResultLine || previous.text || fallbackLine || '';

  // Robot Framework can emit the TEST CASE description and its final status in
  // separate progressiveText chunks. Do not let a bare "| PASS |" replace the
  // description that was already cached.
  if (standaloneResult && previous.text) {
    text = getConsoleResult(previous.text)
      ? previous.text
      : `${previous.text.trimEnd()} ${latestResultLine.trim()}`;
  }

  return {
    text,
    result: latestResultLine ? getConsoleResult(latestResultLine) : (previous.result || null),
    fragment,
    standaloneResult
  };
}

async function fetchConsoleStatus(jenkinsConfig, jobName, buildNumber, previous = {}) {
  const { username, password } = jenkinsConfig;
  const base = normalizeUrl(jenkinsConfig.url);
  if (!base || !jobName || !buildNumber) return null;

  const encodedJobName = encodeURIComponent(jobName);
  const consoleUrl = `${base}/job/${encodedJobName}/${buildNumber}/logText/progressiveText`;
  const sameBuild = previous.buildNumber === buildNumber;
  let start = sameBuild && Number.isFinite(previous.offset) ? previous.offset : null;

  // On first sight of a build, use Jenkins' size header to cap the initial read.
  // Subsequent calls continue exactly at X-Text-Size and only fetch new output.
  if (start === null) {
    try {
      const head = await jenkinsFetch(`${consoleUrl}?start=0`, username, password, { method: 'HEAD' });
      const size = Number(head.headers.get('x-text-size'));
      start = Number.isFinite(size) ? Math.max(0, size - MAX_CONSOLE_TAIL_BYTES) : 0;
    } catch (error) {
      start = 0;
    }
  }

  let response = await jenkinsFetch(`${consoleUrl}?start=${start}`, username, password);
  // Jenkins may reject an offset after a log rotation. Restart safely if so.
  if (response.status === 416 && start !== 0) {
    start = 0;
    response = await jenkinsFetch(`${consoleUrl}?start=0`, username, password);
  }
  if (!response.ok) {
    throw new Error(`Console fetch failed with status ${response.status}`);
  }

  const chunk = await response.text();
  let parsed = parseConsoleChunk(chunk, sameBuild ? previous : {});
  const headerOffset = Number(response.headers.get('x-text-size'));
  let offset = Number.isFinite(headerOffset)
    ? headerOffset
    : start + Buffer.byteLength(chunk, 'utf8');

  // If Jenkins only returned the trailing result token, re-read the bounded
  // tail. Jenkins' consolidated text contains the description and result on
  // one line, so this recovers the exact TEST CASE without downloading a large
  // log or guessing which earlier cached line it belongs to.
  if (parsed.standaloneResult) {
    const recoveryStart = Math.max(0, offset - MAX_CONSOLE_TAIL_BYTES);
    const recoveryResponse = await jenkinsFetch(
      `${consoleUrl}?start=${recoveryStart}`,
      username,
      password
    );
    if (recoveryResponse.ok) {
      const recoveryChunk = await recoveryResponse.text();
      const recovered = parseConsoleChunk(recoveryChunk);
      if (recovered.text && !recovered.standaloneResult) {
        parsed = recovered;
        const recoveryOffset = Number(recoveryResponse.headers.get('x-text-size'));
        offset = Number.isFinite(recoveryOffset)
          ? recoveryOffset
          : recoveryStart + Buffer.byteLength(recoveryChunk, 'utf8');
      }
    }
  }

  return {
    buildNumber,
    offset,
    fragment: parsed.fragment,
    text: parsed.text,
    result: parsed.result,
    updatedAt: Date.now()
  };
}

async function testConnection(url, username, password) {
  const base = normalizeUrl(url);
  if (!base) return { success: false, message: 'URL is required' };
  try {
    const response = await jenkinsFetch(`${base}/api/json`, username, password);
    if (response.ok) {
      return { success: true, message: 'Connection successful' };
    }
    return { success: false, message: `Failed with status ${response.status}` };
  } catch (error) {
    return { success: false, message: error.name === 'TimeoutError' ? 'Connection timed out' : error.message };
  }
}

async function fetchAllJobs(jenkinsConfig) {
  const { username, password } = jenkinsConfig;
  const base = normalizeUrl(jenkinsConfig.url);
  if (!base) return [];

  try {
    const response = await jenkinsFetch(`${base}/api/json?tree=jobs[name,color,url]`, username, password);
    if (response.ok) {
      const data = await response.json();
      return data.jobs || [];
    }
    console.error(`Failed to fetch jobs: ${response.status}`);
    return [];
  } catch (error) {
    console.error('Error fetching jobs:', error.message);
    return [];
  }
}

async function fetchJobDetail(jenkinsConfig, jobName) {
  const { username, password } = jenkinsConfig;
  const base = normalizeUrl(jenkinsConfig.url);
  if (!base || !jobName) return null;

  try {
    const encodedJobName = encodeURIComponent(jobName);
    const tree = [
      'name',
      'color',
      'labelExpression',
      'lastBuild[number,result,timestamp,duration,building,builtOn]',
      'lastSuccessfulBuild[number,timestamp]',
      'lastFailedBuild[number,timestamp]',
      'lastCompletedBuild[number,result,timestamp,duration]',
      'builds[number,result,timestamp,duration]{0,10}'
    ].join(',');
    const apiUrl = `${base}/job/${encodedJobName}/api/json?tree=${tree}`;

    const response = await jenkinsFetch(apiUrl, username, password);

    if (response.ok) {
      const data = await response.json();
      return {
        name: data.name,
        status: data.color,
        labelExpression: data.labelExpression || null,
        lastBuild: data.lastBuild || null,
        lastSuccessful: data.lastSuccessfulBuild || null,
        lastFailed: data.lastFailedBuild || null,
        // The most recent *finished* build - drives both the duration display and
        // the "recently completed" highlight on the dashboard.
        lastCompleted: data.lastCompletedBuild || null,
        lastDuration: data.lastCompletedBuild ? data.lastCompletedBuild.duration : null,
        builds: data.builds || []
      };
    }
    console.error(`Failed to fetch job detail for ${jobName}: ${response.status}`);
    return null;
  } catch (error) {
    console.error(`Error fetching job detail for ${jobName}:`, error.message);
    return null;
  }
}

async function fetchNodesStatus(jenkinsConfig) {
  const { username, password } = jenkinsConfig;
  const base = normalizeUrl(jenkinsConfig.url);
  if (!base) return [];

  try {
    const response = await jenkinsFetch(`${base}/computer/api/json?tree=computer[displayName,offline]`, username, password);
    if (response.ok) {
      const data = await response.json();
      return data.computer || [];
    }
    console.error(`Failed to fetch nodes status: ${response.status}`);
    return [];
  } catch (error) {
    console.error('Error fetching nodes status:', error.message);
    return [];
  }
}

module.exports = {
  testConnection,
  fetchAllJobs,
  fetchJobDetail,
  fetchNodesStatus,
  fetchConsoleStatus,
  parseConsoleChunk,
  normalizeUrl
};
