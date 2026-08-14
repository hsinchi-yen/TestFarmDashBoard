const express = require('express');

module.exports = function(store, jenkins, scheduler) {
  const router = express.Router();

  router.post('/jenkins/test', async (req, res) => {
    try {
      const { url, username, password } = req.body;
      // A blank password field means "keep the saved one" - test with that,
      // otherwise "測試連線" fails for a user who only wants to verify the URL.
      const existing = store.getJenkinsConfig();
      const result = await jenkins.testConnection(url, username, password || existing.password);
      res.json(result);
    } catch (err) {
      console.error('Test connection error:', err);
      res.json({ success: false, message: err.message });
    }
  });

  router.post('/jenkins/save', async (req, res) => {
    try {
      const { url, username, password } = req.body;
      const existing = store.getJenkinsConfig();
      // url/username are always sent by the form, so take them as-is (allowing
      // them to be cleared). The password field is blank when unchanged.
      const configToSave = {
        url: jenkins.normalizeUrl(url !== undefined ? url : existing.url),
        username: username !== undefined ? username : existing.username,
        password: password ? password : existing.password
      };
      store.saveJenkinsConfig(configToSave);
      scheduler.startPolling(store, jenkins);
      res.json({ success: true });
    } catch (err) {
      console.error('Save jenkins config error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/jenkins/config', (req, res) => {
    const config = store.getJenkinsConfig();
    res.json({
      url: config.url,
      username: config.username,
      password: '',
      hasPassword: !!config.password
    });
  });

  router.get('/jenkins/jobs', async (req, res) => {
    try {
      const config = store.getJenkinsConfig();
      if (!config.url) {
        return res.json([]);
      }
      const jobs = await jenkins.fetchAllJobs(config);
      res.json(jobs);
    } catch (err) {
      console.error('Fetch jobs error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/dashboard/data', (req, res) => {
    res.json(scheduler.getCachedData());
  });

  // Single round-trip for the dashboard: cards + build data + settings + clock.
  // serverTime lets the browser correct for a skewed kiosk clock when it renders
  // relative times and the "recently completed" highlight.
  router.get('/dashboard/state', (req, res) => {
    res.json({
      cards: store.getCards(),
      jobs: scheduler.getCachedData(),
      settings: store.getSettings(),
      lastPollAt: scheduler.getLastPollAt(),
      serverTime: Date.now()
    });
  });

  router.post('/cards', async (req, res) => {
    const jobName = typeof req.body.jobName === 'string' ? req.body.jobName.trim() : '';
    if (!jobName) {
      return res.status(400).json({ error: 'jobName is required' });
    }
    const newCard = store.addCard({ jobName });

    // Trigger an immediate poll so the new card is not blank until the next tick
    const config = store.getJenkinsConfig();
    if (config.url) {
      jenkins.fetchJobDetail(config, jobName)
        .then(detail => scheduler.setCachedJob(jobName, detail))
        .catch(err => console.error('Immediate poll failed for new card:', err.message));
    }

    res.json(newCard);
  });

  router.delete('/cards/:id', (req, res) => {
    const removed = store.removeCard(req.params.id);
    if (removed) scheduler.removeCachedJob(removed.jobName);
    res.json({ success: true });
  });

  router.put('/cards/reorder', (req, res) => {
    const { cardIds } = req.body;
    if (Array.isArray(cardIds)) {
      store.reorderCards(cardIds);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'cardIds array is required' });
    }
  });

  router.put('/cards/:id', (req, res) => {
    const updatedCard = store.updateCard(req.params.id, req.body);
    if (updatedCard) {
      res.json(updatedCard);
    } else {
      res.status(404).json({ error: 'Card not found' });
    }
  });

  router.get('/settings', (req, res) => {
    res.json(store.getSettings());
  });

  router.put('/settings', (req, res) => {
    res.json(store.updateSettings(req.body));
  });

  router.get('/cards', (req, res) => {
    res.json(store.getCards());
  });

  return router;
};
