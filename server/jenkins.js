const REQUEST_TIMEOUT_MS = 15000;

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
function jenkinsFetch(url, username, password) {
  return fetch(url, {
    headers: getAuthHeader(username, password),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
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
  normalizeUrl
};
