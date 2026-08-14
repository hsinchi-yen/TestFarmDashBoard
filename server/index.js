const express = require('express');
const path = require('path');
const store = require('./store');
const jenkins = require('./jenkins');
const scheduler = require('./scheduler');
const createRoutes = require('./routes');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json({ limit: '256kb' }));
// Serve static files from the public directory
app.use(express.static(path.join(__dirname, '..', 'public'), {
  // The dashboard runs unattended for days; never let a stale JS/CSS copy stick.
  maxAge: 0,
  etag: true
}));

// Mount API routes
const apiRouter = createRoutes(store, jenkins, scheduler);
app.use('/api', apiRouter);

// Any error escaping a route returns JSON instead of Express' HTML error page
app.use('/api', (err, req, res, next) => {
  console.error('Unhandled API error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// Start scheduler if Jenkins URL is configured
const jenkinsConfig = store.getJenkinsConfig();
if (jenkinsConfig && jenkinsConfig.url) {
  console.log('Jenkins config found, starting polling scheduler...');
  scheduler.startPolling(store, jenkins);
}

const server = app.listen(PORT, () => {
  console.log(`Test Farm Dashboard server is running on http://localhost:${PORT}`);
});

// Let `docker stop` shut down cleanly instead of waiting out the 10s kill timer
['SIGTERM', 'SIGINT'].forEach(signal => {
  process.on(signal, () => {
    console.log(`Received ${signal}, shutting down...`);
    scheduler.stopPolling();
    server.close(() => process.exit(0));
  });
});
