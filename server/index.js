const express = require('express');
const path = require('path');
const store = require('./store');
const jenkins = require('./jenkins');
const scheduler = require('./scheduler');
const createRoutes = require('./routes');

const app = express();
const PORT = 4000;

app.use(express.json());
// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount API routes
const apiRouter = createRoutes(store, jenkins, scheduler);
app.use('/api', apiRouter);

// Start scheduler if Jenkins URL is configured
const jenkinsConfig = store.getJenkinsConfig();
if (jenkinsConfig && jenkinsConfig.url) {
  console.log('Jenkins config found, starting polling scheduler...');
  scheduler.startPolling(store, jenkins);
}

app.listen(PORT, () => {
  console.log(`Test Farm Dashboard server is running on http://localhost:${PORT}`);
});
