let cache = {};
let pollingInterval = null;

async function pollOnce(store, jenkins) {
  console.log(`[${new Date().toISOString()}] Polling Jenkins...`);
  const jenkinsConfig = store.getJenkinsConfig();
  if (!jenkinsConfig.url) {
    console.log('No Jenkins URL configured, skipping poll.');
    return;
  }

  // Fetch nodes status first
  const nodes = await jenkins.fetchNodesStatus(jenkinsConfig);
  const nodeStatusMap = {};
  nodes.forEach(n => {
    nodeStatusMap[n.displayName] = n.offline;
  });

  const cards = store.getCards();
  for (const card of cards) {
    if (card.jobName) {
      try {
        const detail = await jenkins.fetchJobDetail(jenkinsConfig, card.jobName);
        if (detail) {
          // Determine the node name: prefer builtOn from the last build, fallback to labelExpression
          const nodeName = (detail.lastBuild && detail.lastBuild.builtOn) ? detail.lastBuild.builtOn : detail.labelExpression;
          
          if (nodeName) {
            detail.nodeName = nodeName;
            // If the node name is Built-In Node but label is something else, or if node doesn't exist, handle it safely
            detail.nodeOffline = nodeStatusMap[nodeName] !== undefined ? nodeStatusMap[nodeName] : false;
          } else {
            detail.nodeName = 'Unknown';
            detail.nodeOffline = false;
          }
          
          cache[card.jobName] = detail;
        }
      } catch (err) {
        console.error(`Error polling job ${card.jobName}:`, err);
      }
    }
  }
}

function startPolling(store, jenkins) {
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
  
  // Initial poll
  pollOnce(store, jenkins);
  
  // Schedule every 60 seconds
  pollingInterval = setInterval(() => {
    pollOnce(store, jenkins);
  }, 60000);
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}

function getCachedData() {
  return cache;
}

module.exports = {
  startPolling,
  pollOnce,
  getCachedData,
  stopPolling
};
