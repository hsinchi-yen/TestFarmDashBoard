function getAuthHeader(username, password) {
  if (!username || !password) return {};
  return {
    'Authorization': `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
  };
}

async function testConnection(url, username, password) {
  try {
    const response = await fetch(`${url}/api/json`, {
      headers: getAuthHeader(username, password)
    });
    if (response.ok) {
      return { success: true, message: 'Connection successful' };
    }
    return { success: false, message: `Failed with status ${response.status}` };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function fetchAllJobs(jenkinsConfig) {
  const { url, username, password } = jenkinsConfig;
  if (!url) return [];
  
  try {
    const response = await fetch(`${url}/api/json?tree=jobs[name,color,url]`, {
      headers: getAuthHeader(username, password)
    });
    if (response.ok) {
      const data = await response.json();
      return data.jobs || [];
    }
    console.error(`Failed to fetch jobs: ${response.status}`);
    return [];
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return [];
  }
}

async function fetchJobDetail(jenkinsConfig, jobName) {
  const { url, username, password } = jenkinsConfig;
  if (!url || !jobName) return null;

  try {
    const encodedJobName = encodeURIComponent(jobName);
    const apiUrl = `${url}/job/${encodedJobName}/api/json?tree=name,color,labelExpression,lastBuild[number,result,timestamp,duration,builtOn],lastSuccessfulBuild[number,timestamp],lastFailedBuild[number,timestamp],lastCompletedBuild[number,result,timestamp,duration],builds[number,result,timestamp,duration]{0,10}`;
    
    const response = await fetch(apiUrl, {
      headers: getAuthHeader(username, password)
    });

    if (response.ok) {
      const data = await response.json();
      return {
        name: data.name,
        status: data.color,
        labelExpression: data.labelExpression || null,
        lastBuild: data.lastBuild || null,
        lastSuccessful: data.lastSuccessfulBuild || null,
        lastFailed: data.lastFailedBuild || null,
        lastDuration: data.lastCompletedBuild ? data.lastCompletedBuild.duration : null,
        builds: data.builds || []
      };
    }
    console.error(`Failed to fetch job detail for ${jobName}: ${response.status}`);
    return null;
  } catch (error) {
    console.error(`Error fetching job detail for ${jobName}:`, error);
    return null;
  }
}

async function fetchNodesStatus(jenkinsConfig) {
  const { url, username, password } = jenkinsConfig;
  if (!url) return [];
  
  try {
    const response = await fetch(`${url}/computer/api/json?tree=computer[displayName,offline]`, {
      headers: getAuthHeader(username, password)
    });
    if (response.ok) {
      const data = await response.json();
      return data.computer || [];
    }
    return [];
  } catch (error) {
    console.error('Error fetching nodes status:', error);
    return [];
  }
}

module.exports = {
  testConnection,
  fetchAllJobs,
  fetchJobDetail,
  fetchNodesStatus
};
