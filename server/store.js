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

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error reading config file:', error);
  }
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

function saveConfig(config) {
  try {
    ensureDir();
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Error saving config file:', error);
    return false;
  }
}

function getJenkinsConfig() {
  return getConfig().jenkins || DEFAULT_CONFIG.jenkins;
}

function saveJenkinsConfig({ url, username, password }) {
  const config = getConfig();
  config.jenkins = { url, username, password };
  saveConfig(config);
}

function getCards() {
  return getConfig().cards || [];
}

function addCard({ jobName }) {
  const config = getConfig();
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
  config.cards = config.cards.filter(c => c.id !== id);
  saveConfig(config);
}

function updateCard(id, updates) {
  const config = getConfig();
  const cardIndex = config.cards.findIndex(c => c.id === id);
  if (cardIndex !== -1) {
    config.cards[cardIndex] = { ...config.cards[cardIndex], ...updates };
    saveConfig(config);
    return config.cards[cardIndex];
  }
  return null;
}

function reorderCards(cardIds) {
  const config = getConfig();
  const newCards = [];
  cardIds.forEach((id, index) => {
    const card = config.cards.find(c => c.id === id);
    if (card) {
      card.order = index;
      newCards.push(card);
    }
  });
  // Add remaining cards that were not in the array
  config.cards.forEach(c => {
    if (!newCards.find(nc => nc.id === c.id)) {
      c.order = newCards.length;
      newCards.push(c);
    }
  });
  config.cards = newCards;
  saveConfig(config);
}

function getSettings() {
  return getConfig().settings || DEFAULT_CONFIG.settings;
}

function updateSettings(settings) {
  const config = getConfig();
  config.settings = { ...config.settings, ...settings };
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
