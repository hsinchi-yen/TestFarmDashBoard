document.addEventListener('DOMContentLoaded', init);

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */
const DATA_REFRESH_MS = 5000;       // keep live console text responsive while builds run
const TICK_MS = 30000;              // refresh of relative times / highlight state
const IDLE_RESUME_MS = 60000;       // resume auto-rotation this long after user input
const DEFAULT_ROTATE_SEC = 30;
const RECENT_HIGHLIGHT_MS = 8 * 60 * 60 * 1000;  // blink the newest finished test for 8h
const STALE_DATA_MS = 5 * 60 * 1000;             // warn when the poller stops updating

const WORK_DAYS = [1, 2, 3, 4, 5];
const WORK_START_HOUR = 9;
const WORK_END_HOUR = 18;

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */
let settings = { gridSize: '4x4', autoRotateInterval: DEFAULT_ROTATE_SEC };
let allCards = [];
let currentPage = 1;
let clockOffset = 0;          // serverTime - browser time, corrects a skewed kiosk clock
let lastPollAt = null;
let latestCardId = null;      // card holding the most recently finished build
let latestFinishedAt = null;

let pageInterval = null;
let dataInterval = null;
let tickInterval = null;
let rotationTimeout = null;
let resizeTimeout = null;
let idleRaf = 0;

// id -> { el, refs } so refreshes update text in place instead of rebuilding the grid
const cardNodes = new Map();

const dom = {
  grid: document.getElementById('card-grid'),
  gridBtns: document.querySelectorAll('.grid-btn'),
  pageCurrent: document.querySelector('.page-current'),
  pageTotal: document.querySelector('.page-total'),
  lastUpdated: document.querySelector('.last-updated'),
  themeToggle: document.getElementById('theme-toggle'),
  offHoursOverlay: document.getElementById('off-hours-overlay'),
  offHoursTime: document.querySelector('.off-hours-time'),
  currentDate: document.getElementById('current-date'),
  latestChip: document.getElementById('latest-chip')
};

function now() {
  return Date.now() + clockOffset;
}

/* ------------------------------------------------------------------ *
 * Bootstrap
 * ------------------------------------------------------------------ */
async function init() {
  initTheme();
  dom.themeToggle.addEventListener('click', toggleTheme);

  dom.gridBtns.forEach(btn => {
    btn.addEventListener('click', (e) => setGridSize(e.currentTarget.dataset.grid));
  });

  // mousemove fires per pixel; coalesce into one call per animation frame
  document.addEventListener('mousemove', onUserActivity, { passive: true });
  document.addEventListener('keydown', onUserActivity);
  document.addEventListener('touchstart', onUserActivity, { passive: true });
  window.addEventListener('resize', onWindowResize);
  document.addEventListener('visibilitychange', onVisibilityChange);

  applyGridSize(settings.gridSize, { persist: false });

  updateDateDisplay();
  tickInterval = setInterval(tick, TICK_MS);
  setInterval(checkWorkHours, 60000);

  if (isWorkHours()) {
    await startLiveMode();
  } else {
    showOffHours();
  }
}

async function startLiveMode() {
  dom.offHoursOverlay.style.display = 'none';
  await fetchDashboardData();
  clearInterval(dataInterval);
  dataInterval = setInterval(fetchDashboardData, DATA_REFRESH_MS);
  startRotation();
}

function stopLiveMode() {
  clearInterval(dataInterval);
  dataInterval = null;
  stopRotation();
}

/* ------------------------------------------------------------------ *
 * Theme / chrome
 * ------------------------------------------------------------------ */
function initTheme() {
  if (localStorage.getItem('theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
  }
  // Trend bars are painted with theme colours, so repaint them
  redrawAllCharts();
}

function updateDateDisplay() {
  if (!dom.currentDate) return;
  const options = { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' };
  dom.currentDate.textContent = new Date(now()).toLocaleDateString('zh-TW', options);
}

/* ------------------------------------------------------------------ *
 * Grid size
 * ------------------------------------------------------------------ */
async function setGridSize(size) {
  if (!size || size === settings.gridSize) return;
  applyGridSize(size);
}

function applyGridSize(size, { persist = true } = {}) {
  settings.gridSize = size;
  dom.gridBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.grid === size);
  });
  dom.grid.className = `card-grid grid-${size}`;
  renderPage(1, { rebuild: true });
  // The page count just changed: 5x5 may have been a single page while 3x3 needs
  // rotation (or vice versa), so re-evaluate rather than waiting for the next tick.
  if (dataInterval) startRotation();

  if (!persist) return;
  fetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ gridSize: size })
  }).catch(e => console.error('Error saving grid size', e));
}

function getPageSize() {
  const [cols, rows] = settings.gridSize.split('x').map(Number);
  return (cols || 4) * (rows || 4);
}

/* ------------------------------------------------------------------ *
 * Work hours
 * ------------------------------------------------------------------ */
function isWorkHours() {
  const d = new Date(now());
  return WORK_DAYS.includes(d.getDay()) && d.getHours() >= WORK_START_HOUR && d.getHours() < WORK_END_HOUR;
}

function checkWorkHours() {
  const working = isWorkHours();
  const overlayVisible = dom.offHoursOverlay.style.display !== 'none';

  if (working && overlayVisible) {
    startLiveMode();
  } else if (!working) {
    if (!overlayVisible) stopLiveMode();
    showOffHours();
  }
}

function showOffHours() {
  dom.offHoursOverlay.style.display = 'flex';
  dom.offHoursTime.textContent = new Date(now()).toLocaleTimeString('zh-TW');
}

/* ------------------------------------------------------------------ *
 * Data
 * ------------------------------------------------------------------ */
async function fetchDashboardData() {
  try {
    const res = await fetch('/api/dashboard/state', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const state = await res.json();

    if (state.serverTime) clockOffset = state.serverTime - Date.now();
    lastPollAt = state.lastPollAt || null;
    let gridChanged = false;
    if (state.settings && state.settings.gridSize) {
      gridChanged = settings.gridSize !== state.settings.gridSize;
      settings.gridSize = state.settings.gridSize;
      if (gridChanged) {
        dom.gridBtns.forEach(btn => {
          btn.classList.toggle('active', btn.dataset.grid === settings.gridSize);
        });
        dom.grid.className = `card-grid grid-${settings.gridSize}`;
        currentPage = 1;
      }
    }
    if (state.settings && state.settings.autoRotateInterval) {
      const changed = settings.autoRotateInterval !== state.settings.autoRotateInterval;
      settings.autoRotateInterval = state.settings.autoRotateInterval;
      if (changed) startRotation();
    }

    const jobs = state.jobs || {};
    const previousIds = allCards.map(c => c.id).join('|');
    allCards = (state.cards || []).map(card => ({ ...card, ...(jobs[card.jobName] || {}) }));

    computeLatestFinished();
    // Card set changed (added/removed/reordered) -> the grid needs new nodes
    const rebuild = gridChanged || previousIds !== allCards.map(c => c.id).join('|');
    renderPage(currentPage, { rebuild });
    if (gridChanged) startRotation();
    updateFreshnessLabel();
  } catch (e) {
    console.error('Error fetching dashboard data', e);
    updateFreshnessLabel(e.message);
  }
}

function updateFreshnessLabel(errorMessage) {
  if (!dom.lastUpdated) return;
  const stale = lastPollAt && (now() - lastPollAt) > STALE_DATA_MS;

  if (errorMessage) {
    dom.lastUpdated.textContent = `⚠️ 連線失敗 (${errorMessage})`;
    dom.lastUpdated.classList.add('last-updated--stale');
  } else if (stale) {
    dom.lastUpdated.textContent = `⚠️ 資料過舊 · ${formatRelativeTime(lastPollAt)}`;
    dom.lastUpdated.classList.add('last-updated--stale');
  } else {
    dom.lastUpdated.textContent = `Last updated: ${new Date(now()).toLocaleTimeString('zh-TW')}`;
    dom.lastUpdated.classList.remove('last-updated--stale');
  }
}

/* ------------------------------------------------------------------ *
 * "Most recently finished test" highlight
 * ------------------------------------------------------------------ */

// Jenkins `timestamp` is the build START time, so the finish time is
// timestamp + duration. A still-running build has no finish time yet.
function getFinishedAt(card) {
  const b = card.lastCompleted;
  if (b && b.timestamp) return b.timestamp + (b.duration || 0);
  const lb = card.lastBuild;
  if (lb && lb.timestamp && lb.result && !lb.building) return lb.timestamp + (lb.duration || 0);
  return null;
}

function computeLatestFinished() {
  latestCardId = null;
  latestFinishedAt = null;

  allCards.forEach(card => {
    const finishedAt = getFinishedAt(card);
    if (finishedAt && (latestFinishedAt === null || finishedAt > latestFinishedAt)) {
      latestFinishedAt = finishedAt;
      latestCardId = card.id;
    }
  });

  // Only highlight while it is still fresh
  if (latestFinishedAt === null || (now() - latestFinishedAt) > RECENT_HIGHLIGHT_MS) {
    latestCardId = null;
    latestFinishedAt = null;
  }
  updateLatestChip();
}

function isHighlighted(card) {
  return latestCardId !== null && card.id === latestCardId;
}

// The highlighted card may sit on a page that is not currently shown, so mirror
// it in the toolbar.
function updateLatestChip() {
  if (!dom.latestChip) return;
  if (!latestCardId) {
    dom.latestChip.style.display = 'none';
    return;
  }
  const card = allCards.find(c => c.id === latestCardId);
  if (!card) {
    dom.latestChip.style.display = 'none';
    return;
  }
  const result = (card.lastCompleted && card.lastCompleted.result) || (card.lastBuild && card.lastBuild.result) || '';
  dom.latestChip.style.display = 'inline-flex';
  dom.latestChip.dataset.result = result.toLowerCase();
  dom.latestChip.textContent = `🆕 最新完成：${card.alias || card.jobName} · ${formatRelativeTime(latestFinishedAt)}`;
  dom.latestChip.title = `完成於 ${new Date(latestFinishedAt).toLocaleString('zh-TW')}`;
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */
function renderPage(pageNum, { rebuild = false } = {}) {
  const pageSize = getPageSize();
  const totalPages = Math.max(1, Math.ceil(allCards.length / pageSize));

  if (pageNum > totalPages || pageNum < 1) pageNum = 1;
  const pageChanged = pageNum !== currentPage;
  currentPage = pageNum;

  dom.pageCurrent.textContent = currentPage;
  dom.pageTotal.textContent = totalPages;

  const start = (currentPage - 1) * pageSize;
  const pageCards = allCards.slice(start, start + pageSize);
  const wantIds = pageCards.map(c => c.id);
  const haveIds = [...dom.grid.children].map(el => el.dataset.id);
  const structureChanged = rebuild || pageChanged || wantIds.join('|') !== haveIds.join('|');

  if (structureChanged) {
    // Drop nodes for cards that no longer exist at all
    const liveIds = new Set(allCards.map(c => c.id));
    [...cardNodes.keys()].forEach(id => { if (!liveIds.has(id)) cardNodes.delete(id); });

    const fragment = document.createDocumentFragment();
    pageCards.forEach((card, index) => {
      let node = cardNodes.get(card.id);
      if (!node) {
        node = createCardNode(card);
        cardNodes.set(card.id, node);
      }
      node.el.style.animationDelay = `${Math.min(index, 12) * 0.04}s`;
      node.el.classList.remove('card--entering');
      fragment.appendChild(node.el);
    });
    dom.grid.replaceChildren(fragment);
  }

  // Content is refreshed in place either way - no flicker on a plain data refresh
  pageCards.forEach(card => updateCardNode(cardNodes.get(card.id), card));

  if (structureChanged) {
    // One forced reflow for the whole grid, then re-arm the entry animation
    void dom.grid.offsetWidth;
    pageCards.forEach(card => cardNodes.get(card.id).el.classList.add('card--entering'));
  }

  const palette = readChartPalette();
  pageCards.forEach(card => {
    const node = cardNodes.get(card.id);
    drawTrendChart(node.canvas, (card.builds || []).slice(0, 10).reverse(), palette);
  });
}

function createCardNode(card) {
  const el = document.createElement('div');
  el.className = 'card';
  el.dataset.id = card.id;
  el.innerHTML = `
    <div class="card__status-bar"></div>
    <div class="card__body">
      <div class="card__header">
        <span class="card__name"></span>
        <span class="card__build-number"></span>
      </div>
      <div class="card__status-row">
        <span class="card__status-label"></span>
        <span class="card__latest-badge">🆕 剛完成</span>
      </div>
      <div class="card__console" data-ref="console" hidden>
        <span class="card__console-prompt">&gt;_</span>
        <span class="card__console-text"></span>
        <span class="card__console-result"></span>
      </div>
      <div class="card__info">
        <div class="card__info-item">
          <span class="label">✅ 上次成功</span>
          <span class="value" data-ref="success"></span>
        </div>
        <div class="card__info-item">
          <span class="label">❌ 上次失敗</span>
          <span class="value" data-ref="failure"></span>
        </div>
        <div class="card__info-item card__info-item--duration">
          <span class="label">⏱ 上次費時</span>
          <span class="value" data-ref="duration"></span>
        </div>
      </div>
      <div class="card__node-row">
        <span class="card__node"></span>
      </div>
      <div class="card__trend">
        <canvas class="trend-canvas"></canvas>
      </div>
    </div>
  `;

  return {
    el,
    canvas: el.querySelector('.trend-canvas'),
    name: el.querySelector('.card__name'),
    buildNumber: el.querySelector('.card__build-number'),
    statusLabel: el.querySelector('.card__status-label'),
    console: el.querySelector('[data-ref="console"]'),
    consoleText: el.querySelector('.card__console-text'),
    consoleResult: el.querySelector('.card__console-result'),
    success: el.querySelector('[data-ref="success"]'),
    failure: el.querySelector('[data-ref="failure"]'),
    duration: el.querySelector('[data-ref="duration"]'),
    node: el.querySelector('.card__node')
  };
}

function updateCardNode(node, card) {
  if (!node) return;
  const statusClass = getStatusClass(card);
  const isOffline = !!card.nodeOffline;
  const highlighted = isHighlighted(card);

  node.el.className = `card card--${statusClass}` +
    (isOffline ? ' card--offline' : '') +
    (highlighted ? ' card--latest' : '') +
    (node.el.classList.contains('card--entering') ? ' card--entering' : '');
  node.el.dataset.id = card.id;
  node.el.dataset.activity = isBuildRunning(card) ? 'building' : 'idle';

  const displayName = card.alias || card.jobName || '(未命名)';
  setText(node.name, displayName);
  node.name.title = card.jobName || displayName;

  setText(node.buildNumber, card.lastBuild ? `#${card.lastBuild.number}` : '#-');
  setText(node.statusLabel, getStatusLabel(card));

  const consoleStatus = isBuildRunning(card) && card.consoleStatus;
  const consoleText = consoleStatus && consoleStatus.text ? consoleStatus.text : '';
  const resultMatch = consoleText.match(/\|\s*(PASS|FAIL|SKIP|NOT RUN)\s*\|?\s*$/i);
  const consoleMessage = resultMatch
    ? consoleText.slice(0, resultMatch.index).trimEnd()
    : consoleText;
  const consoleResult = resultMatch ? `| ${resultMatch[1].toUpperCase()} |` : '';
  node.console.hidden = !consoleText;
  node.console.dataset.result = consoleStatus && consoleStatus.result ? consoleStatus.result : '';
  setText(node.consoleText, consoleMessage);
  setText(node.consoleResult, consoleResult);
  node.consoleResult.hidden = !consoleResult;
  node.console.title = consoleText;

  setText(node.success, card.lastSuccessful
    ? `#${card.lastSuccessful.number} (${formatRelativeTime(card.lastSuccessful.timestamp)})`
    : 'N/A');
  node.success.title = card.lastSuccessful ? new Date(card.lastSuccessful.timestamp).toLocaleString('zh-TW') : '';

  setText(node.failure, card.lastFailed
    ? `#${card.lastFailed.number} (${formatRelativeTime(card.lastFailed.timestamp)})`
    : 'N/A');
  node.failure.title = card.lastFailed ? new Date(card.lastFailed.timestamp).toLocaleString('zh-TW') : '';

  setText(node.duration, formatDuration(getDisplayDuration(card)));

  const nodeLabel = card.nodeName && card.nodeName !== 'Unknown' ? card.nodeName : '';
  setText(node.node, `${isOffline ? '🔌🔴' : '🔌🟢'} ${isOffline ? 'Offline' : 'Online'}${nodeLabel ? ' · ' + nodeLabel : ''}`);
  node.node.classList.toggle('card__node--offline', isOffline);
}

function setText(el, value) {
  if (el.textContent !== value) el.textContent = value;
}

// While a build is running, lastBuild.duration is 0 - fall back to the last
// finished build so the card does not flip to "N/A" mid-run.
function getDisplayDuration(card) {
  if (card.lastBuild && !card.lastBuild.building && card.lastBuild.duration) {
    return card.lastBuild.duration;
  }
  return card.lastDuration || (card.lastCompleted && card.lastCompleted.duration) || null;
}

/* ------------------------------------------------------------------ *
 * Status mapping (Jenkins ball colours)
 * ------------------------------------------------------------------ */
function getStatusClass(card) {
  const color = card.status || '';
  if (card.lastBuild && card.lastBuild.building) return 'building';
  if (!color) return 'not-built';
  if (color.endsWith('_anime')) return 'building';   // must be checked before the base colour
  if (color.startsWith('blue')) return 'success';
  if (color.startsWith('red')) return 'failure';
  if (color.startsWith('yellow')) return 'unstable'; // yellow = unstable in Jenkins, not running
  if (color === 'aborted') return 'aborted';
  if (color === 'disabled') return 'disabled';
  return 'not-built';
}

function isBuildRunning(card) {
  return !!(card.lastBuild && card.lastBuild.building);
}

function getStatusLabel(card) {
  return isBuildRunning(card) ? 'BUILDING' : 'IDLE';
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */
function formatDuration(ms) {
  if (!ms || ms < 0) return 'N/A';
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'N/A';
  const diff = now() - timestamp;
  if (diff < 60000) return '剛剛';
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  return `${Math.floor(h / 24)} 天前`;
}

/* ------------------------------------------------------------------ *
 * Trend chart
 * ------------------------------------------------------------------ */
let chartPalette = null;

// getComputedStyle is expensive; read the theme colours once per render pass
function readChartPalette() {
  if (chartPalette) return chartPalette;
  const styles = getComputedStyle(document.documentElement);
  const pick = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  chartPalette = {
    SUCCESS: pick('--color-success', 'hsl(142, 71%, 45%)'),
    FAILURE: pick('--color-failure', 'hsl(0, 84%, 60%)'),
    UNSTABLE: pick('--color-building', 'hsl(45, 93%, 47%)'),
    ABORTED: pick('--color-not-built', 'hsl(220, 10%, 65%)'),
    OTHER: pick('--color-not-built', 'hsl(220, 10%, 65%)')
  };
  return chartPalette;
}

function drawTrendChart(canvas, builds, palette) {
  if (!canvas) return;
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  if (!cssWidth || !cssHeight) return;

  // Match the backing store to the device pixel ratio, otherwise the chart is
  // blurry on the HiDPI panels these boards are usually shown on.
  const dpr = window.devicePixelRatio || 1;
  const targetW = Math.round(cssWidth * dpr);
  const targetH = Math.round(cssHeight * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  if (!builds || builds.length === 0) return;

  const colors = palette || readChartPalette();
  const slots = 10;
  const maxDuration = Math.max(...builds.map(b => b.duration || 0), 1);
  const slotWidth = cssWidth / slots;
  const barWidth = Math.max(2, slotWidth - 3);
  // Right-align: with fewer than 10 builds the empty slots belong on the left so
  // the newest build always sits at the right edge.
  const offset = Math.max(0, slots - builds.length);

  builds.forEach((build, i) => {
    if (i >= slots) return;
    const x = (i + offset) * slotWidth + (slotWidth - barWidth) / 2;
    const barHeight = Math.max(2, ((build.duration || 0) / maxDuration) * cssHeight);
    const y = cssHeight - barHeight;

    ctx.fillStyle = colors[build.result] || colors.OTHER;
    ctx.globalAlpha = build.result ? 1 : 0.45;  // running build
    ctx.fillRect(x, y, barWidth, barHeight);
  });
  ctx.globalAlpha = 1;
}

function redrawAllCharts() {
  chartPalette = null;   // theme may have changed
  const palette = readChartPalette();
  const pageSize = getPageSize();
  const start = (currentPage - 1) * pageSize;
  allCards.slice(start, start + pageSize).forEach(card => {
    const node = cardNodes.get(card.id);
    if (node) drawTrendChart(node.canvas, (card.builds || []).slice(0, 10).reverse(), palette);
  });
}

/* ------------------------------------------------------------------ *
 * Rotation + idle handling
 * ------------------------------------------------------------------ */
function startRotation() {
  stopRotation();
  const totalPages = Math.ceil(allCards.length / getPageSize());
  if (totalPages <= 1) return;   // nothing to rotate through - don't churn the DOM

  const intervalMs = Math.max(5, settings.autoRotateInterval || DEFAULT_ROTATE_SEC) * 1000;
  pageInterval = setInterval(() => {
    renderPage(currentPage + 1);
  }, intervalMs);
}

function stopRotation() {
  clearInterval(pageInterval);
  pageInterval = null;
}

function onUserActivity() {
  if (idleRaf) return;
  idleRaf = requestAnimationFrame(() => {
    idleRaf = 0;
    stopRotation();
    clearTimeout(rotationTimeout);
    rotationTimeout = setTimeout(() => {
      if (isWorkHours()) startRotation();
    }, IDLE_RESUME_MS);
  });
}

function onWindowResize() {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(redrawAllCharts, 200);
}

// A hidden tab throttles timers; refresh immediately when it comes back
function onVisibilityChange() {
  if (document.visibilityState === 'visible' && isWorkHours()) {
    fetchDashboardData();
  }
}

// Keeps relative times and the 8-hour highlight accurate between data refreshes
function tick() {
  updateDateDisplay();
  if (document.visibilityState !== 'visible') return;

  if (!isWorkHours()) {
    showOffHours();
    return;
  }
  computeLatestFinished();
  const pageSize = getPageSize();
  const start = (currentPage - 1) * pageSize;
  allCards.slice(start, start + pageSize).forEach(card => {
    updateCardNode(cardNodes.get(card.id), card);
  });
  updateFreshnessLabel();
}
