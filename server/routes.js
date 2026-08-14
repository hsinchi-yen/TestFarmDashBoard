const express = require('express');

module.exports = function(store, jenkins, scheduler) {
  const router = express.Router();

  router.post('/jenkins/test', async (req, res) => {
    try {
      const { url, username, password } = req.body;
      const result = await jenkins.testConnection(url, username, password);
      res.json(result);
    } catch (err) {
      console.error('Test connection error:', err);
      res.json({ success: false, message: err.message });
    }
  });

  router.post('/jenkins/save', async (req, res) => {
    try {
      const { url, username, password } = req.body;
      // Preserve existing password if not provided
      const existing = store.getJenkinsConfig();
      const configToSave = {
        url: url || existing.url,
        username: username || existing.username,
        password: password || existing.password
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
      password: config.password ? '****' : '',
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
    const data = scheduler.getCachedData();
    res.json(data);
  });

  router.post('/cards', async (req, res) => {
    const { jobName } = req.body;
    if (!jobName) {
      return res.status(400).json({ error: 'jobName is required' });
    }
    const newCard = store.addCard({ jobName });
    
    // Trigger immediate poll for that job
    const config = store.getJenkinsConfig();
    if (config.url) {
      jenkins.fetchJobDetail(config, jobName).then(detail => {
        if (detail) {
          const cache = scheduler.getCachedData();
          cache[jobName] = detail;
        }
      }).catch(err => console.error('Immediate poll failed for new card', err));
    }

    res.json(newCard);
  });

  router.delete('/cards/:id', (req, res) => {
    store.removeCard(req.params.id);
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
    const updated = store.updateSettings(req.body);
    res.json(updated);
  });

  router.get('/cards', (req, res) => {
    res.json(store.getCards());
  });

  return router;
};
