const POLL_INTERVAL_MS = 60000;
const CONSOLE_POLL_INTERVAL_MS = 5000;
const MAX_CONCURRENT_JOBS = 5;

let cache = {};
let pollingInterval = null;
let consolePollingInterval = null;
let pollInFlight = false;
let consolePollInFlight = false;
let lastPollAt = null;
const consoleStates = new Map();

// Run `worker` over `items` with a bounded number of in-flight requests, so a
// board with 25 cards does not fire 25 simultaneous requests at Jenkins, nor
// crawl through them one at a time.
async function mapWithConcurrency(items, limit, worker) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function pollOnce(store, jenkins) {
  // A slow Jenkins can make one poll outlast the 60s interval; skip rather than pile up.
  if (pollInFlight) {
    console.log('Previous poll still running, skipping this tick.');
    return;
  }

  const jenkinsConfig = store.getJenkinsConfig();
  if (!jenkinsConfig.url) {
    console.log('No Jenkins URL configured, skipping poll.');
    return;
  }

  pollInFlight = true;
  const startedAt = Date.now();
  try {
    console.log(`[${new Date().toISOString()}] Polling Jenkins...`);

    // Fetch nodes status first
    const nodes = await jenkins.fetchNodesStatus(jenkinsConfig);
    const nodeStatusMap = {};
    nodes.forEach(n => {
      nodeStatusMap[n.displayName] = n.offline;
    });

    const cards = store.getCards();
    const jobNames = [...new Set(cards.map(c => c.jobName).filter(Boolean))];

    await mapWithConcurrency(jobNames, MAX_CONCURRENT_JOBS, async (jobName) => {
      try {
        const detail = await jenkins.fetchJobDetail(jenkinsConfig, jobName);
        if (!detail) return;

        // Determine the node name: prefer builtOn from the last build, fallback to labelExpression.
        // builtOn is an empty string for the built-in node, so check for a non-empty value.
        const builtOn = detail.lastBuild && detail.lastBuild.builtOn;
        const nodeName = builtOn || detail.labelExpression;

        if (nodeName) {
          detail.nodeName = nodeName;
          detail.nodeOffline = nodeStatusMap[nodeName] !== undefined ? nodeStatusMap[nodeName] : false;
        } else {
          detail.nodeName = 'Unknown';
          detail.nodeOffline = false;
        }

        const previous = cache[jobName];
        if (detail.lastBuild && detail.lastBuild.building &&
            previous && previous.lastBuild &&
            previous.lastBuild.number === detail.lastBuild.number &&
            previous.consoleStatus) {
          detail.consoleStatus = previous.consoleStatus;
        }
        cache[jobName] = detail;
      } catch (err) {
        console.error(`Error polling job ${jobName}:`, err.message);
      }
    });

    // Drop cached entries for jobs that are no longer tracked, otherwise the
    // cache grows forever and deleted-then-re-added cards show stale data.
    pruneCache(jobNames);

    lastPollAt = Date.now();
    console.log(`Poll finished in ${lastPollAt - startedAt}ms (${jobNames.length} jobs).`);
  } finally {
    pollInFlight = false;
  }
}

async function pollConsoleOnce(store, jenkins) {
  if (consolePollInFlight) return;

  const jenkinsConfig = store.getJenkinsConfig();
  if (!jenkinsConfig.url) return;

  const buildingJobs = Object.entries(cache).filter(([, detail]) =>
    detail && detail.lastBuild && detail.lastBuild.building
  );
  const activeJobs = new Set(buildingJobs.map(([jobName]) => jobName));

  // Clear console state as soon as the normal poll observes completion/removal.
  for (const jobName of consoleStates.keys()) {
    if (!activeJobs.has(jobName)) consoleStates.delete(jobName);
  }
  Object.entries(cache).forEach(([jobName, detail]) => {
    if (!activeJobs.has(jobName) && detail) delete detail.consoleStatus;
  });
  if (!buildingJobs.length) return;

  consolePollInFlight = true;
  try {
    await mapWithConcurrency(buildingJobs, MAX_CONCURRENT_JOBS, async ([jobName, detail]) => {
      const buildNumber = detail.lastBuild.number;
      const previous = consoleStates.get(jobName) || {};
      try {
        const next = await jenkins.fetchConsoleStatus(
          jenkinsConfig,
          jobName,
          buildNumber,
          previous
        );
        if (!next) return;

        consoleStates.set(jobName, next);
        const current = cache[jobName];
        if (current && current.lastBuild &&
            current.lastBuild.building && current.lastBuild.number === buildNumber) {
          current.consoleStatus = next.text ? {
            text: next.text,
            result: next.result,
            updatedAt: next.updatedAt
          } : null;
        }
      } catch (err) {
        console.error(`Error polling console for ${jobName}:`, err.message);
      }
    });
  } finally {
    consolePollInFlight = false;
  }
}

function pruneCache(validJobNames) {
  const keep = new Set(validJobNames);
  Object.keys(cache).forEach(jobName => {
    if (!keep.has(jobName)) {
      delete cache[jobName];
      consoleStates.delete(jobName);
    }
  });
}

function startPolling(store, jenkins) {
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
  if (consolePollingInterval) {
    clearInterval(consolePollingInterval);
  }
  consoleStates.clear();

  // Initial poll
  pollOnce(store, jenkins)
    .then(() => pollConsoleOnce(store, jenkins))
    .catch(err => console.error('Initial poll failed:', err));

  pollingInterval = setInterval(() => {
    pollOnce(store, jenkins).catch(err => console.error('Poll failed:', err));
  }, POLL_INTERVAL_MS);

  consolePollingInterval = setInterval(() => {
    pollConsoleOnce(store, jenkins).catch(err => console.error('Console poll failed:', err));
  }, CONSOLE_POLL_INTERVAL_MS);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
  if (consolePollingInterval) {
    clearInterval(consolePollingInterval);
    consolePollingInterval = null;
  }
}

function getCachedData() {
  return cache;
}

function setCachedJob(jobName, detail) {
  if (jobName && detail) cache[jobName] = detail;
}

function removeCachedJob(jobName) {
  if (jobName) {
    delete cache[jobName];
    consoleStates.delete(jobName);
  }
}

function getLastPollAt() {
  return lastPollAt;
}

module.exports = {
  startPolling,
  pollOnce,
  getCachedData,
  setCachedJob,
  removeCachedJob,
  getLastPollAt,
  stopPolling
};
