const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  jenkins: { url: "", username: "", password: "" },
  cards: [],
  settings: { gridSize: "4x4", autoRotateInterval: 30 }
};

// The dashboard hits /api/cards and /api/settings once a minute per viewer, and
// the poller reads the config for every tick. Keep the parsed config in memory
// and only re-read when the file actually changed on disk.
let cached = null;
let cachedMtimeMs = 0;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function withDefaults(config) {
  return {
    jenkins: { ...DEFAULT_CONFIG.jenkins, ...(config.jenkins || {}) },
    cards: Array.isArray(config.cards) ? config.cards : [],
    settings: { ...DEFAULT_CONFIG.settings, ...(config.settings || {}) }
  };
}

function readConfigFromDisk() {
  try {
    const stat = fs.statSync(CONFIG_FILE);
    if (cached && stat.mtimeMs === cachedMtimeMs) {
      return cached;
    }
    const data = fs.readFileSync(CONFIG_FILE, 'utf8');
    cached = withDefaults(JSON.parse(data));
    cachedMtimeMs = stat.mtimeMs;
    return cached;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error reading config file:', error.message);
    }
  }
  cached = null;
  cachedMtimeMs = 0;
  return withDefaults({});
}

function getConfig() {
  // Hand out a copy so callers cannot mutate the cache by accident.
  return JSON.parse(JSON.stringify(readConfigFromDisk()));
}

function saveConfig(config) {
  try {
    ensureDir();
    const normalized = withDefaults(config);
    // Write to a temp file and rename so a crash mid-write cannot leave a
    // truncated config.json behind.
    const tmpFile = `${CONFIG_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(normalized, null, 2), 'utf8');
    fs.renameSync(tmpFile, CONFIG_FILE);
    cached = normalized;
    cachedMtimeMs = fs.statSync(CONFIG_FILE).mtimeMs;
    return true;
  } catch (error) {
    console.error('Error saving config file:', error.message);
    throw error;
  }
}

function getJenkinsConfig() {
  return getConfig().jenkins;
}

function saveJenkinsConfig({ url, username, password }) {
  const config = getConfig();
  config.jenkins = { url, username, password };
  saveConfig(config);
}

function getCards() {
  return getConfig().cards;
}

function addCard({ jobName }) {
  const config = getConfig();
  // Adding the same job twice would render two identical cards fed by one cache entry.
  const existing = config.cards.find(c => c.jobName === jobName);
  if (existing) return existing;

  const newCard = {
    id: uuidv4(),
    jobName,
    alias: jobName,
    order: config.cards.length
  };
  config.cards.push(newCard);
  saveConfig(config);
  return newCard;
}

function removeCard(id) {
  const config = getConfig();
  const removed = config.cards.find(c => c.id === id) || null;
  config.cards = config.cards.filter(c => c.id !== id);
  config.cards.forEach((c, i) => { c.order = i; });
  saveConfig(config);
  return removed;
}

const EDITABLE_CARD_FIELDS = ['alias'];

function updateCard(id, updates) {
  const config = getConfig();
  const cardIndex = config.cards.findIndex(c => c.id === id);
  if (cardIndex === -1) return null;

  // Only allow known fields through - a raw spread would let a request rewrite
  // the card's id or jobName.
  EDITABLE_CARD_FIELDS.forEach(field => {
    if (updates[field] !== undefined) {
      config.cards[cardIndex][field] = String(updates[field]).slice(0, 120);
    }
  });
  saveConfig(config);
  return config.cards[cardIndex];
}

function reorderCards(cardIds) {
  const config = getConfig();
  const newCards = [];
  const seen = new Set();

  cardIds.forEach((id) => {
    if (seen.has(id)) return;
    const card = config.cards.find(c => c.id === id);
    if (card) {
      seen.add(id);
      newCards.push(card);
    }
  });
  // Append any cards that were not in the incoming list
  config.cards.forEach(c => {
    if (!seen.has(c.id)) newCards.push(c);
  });

  newCards.forEach((c, i) => { c.order = i; });
  config.cards = newCards;
  saveConfig(config);
}

function getSettings() {
  return getConfig().settings;
}

const VALID_GRID_SIZES = ['3x3', '4x4', '5x5'];

function updateSettings(settings) {
  const config = getConfig();
  if (VALID_GRID_SIZES.includes(settings.gridSize)) {
    config.settings.gridSize = settings.gridSize;
  }
  const interval = Number(settings.autoRotateInterval);
  if (Number.isFinite(interval) && interval >= 5 && interval <= 600) {
    config.settings.autoRotateInterval = interval;
  }
  saveConfig(config);
  return config.settings;
}

module.exports = {
  getConfig,
  saveConfig,
  getJenkinsConfig,
  saveJenkinsConfig,
  getCards,
  addCard,
  removeCard,
  updateCard,
  reorderCards,
  getSettings,
  updateSettings
};
