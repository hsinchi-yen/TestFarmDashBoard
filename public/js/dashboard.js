document.addEventListener('DOMContentLoaded', init);

let settings = { gridSize: '4x4' };
let allCards = [];
let currentPage = 1;
let pageInterval;
let dataInterval;
let rotationTimeout;
let isRotating = true;

const dom = {
  grid: document.getElementById('card-grid'),
  gridBtns: document.querySelectorAll('.grid-btn'),
  pageCurrent: document.querySelector('.page-current'),
  pageTotal: document.querySelector('.page-total'),
  lastUpdated: document.querySelector('.last-updated'),
  themeToggle: document.getElementById('theme-toggle'),
  offHoursOverlay: document.getElementById('off-hours-overlay'),
  offHoursTime: document.querySelector('.off-hours-time'),
  currentDate: document.getElementById('current-date')
};

async function init() {
  initTheme();
  dom.themeToggle.addEventListener('click', toggleTheme);
  
  dom.gridBtns.forEach(btn => {
    btn.addEventListener('click', (e) => setGridSize(e.target.dataset.grid));
  });
  
  document.addEventListener('mousemove', resetRotationDelay);
  document.addEventListener('keydown', resetRotationDelay);
  
  await loadSettings();
  applyGridSize(settings.gridSize);
  
  if (isWorkHours()) {
    await fetchDashboardData();
    dataInterval = setInterval(fetchDashboardData, 60000);
    startRotation();
  } else {
    showOffHours();
  }
  
  updateDateDisplay();
  setInterval(checkWorkHours, 60000);
  setInterval(updateDateDisplay, 60000); // update date every minute
}

function updateDateDisplay() {
  if (dom.currentDate) {
    const now = new Date();
    const options = { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' };
    dom.currentDate.textContent = now.toLocaleDateString('zh-TW', options);
  }
}

function initTheme() {
  const theme = localStorage.getItem('theme');
  if (theme === 'dark') {
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
}

async function loadSettings() {
  try {
    const res = await fetch('/api/settings');
    if (res.ok) {
      const data = await res.json();
      if (data.gridSize) settings.gridSize = data.gridSize;
    }
  } catch (e) {
    console.error('Error loading settings', e);
  }
}

async function setGridSize(size) {
  applyGridSize(size);
  try {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gridSize: size })
    });
  } catch (e) {
    console.error('Error saving grid size', e);
  }
}

function applyGridSize(size) {
  settings.gridSize = size;
  dom.gridBtns.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.grid === size);
  });
  dom.grid.className = `card-grid grid-${size}`;
  renderPage(1);
}

function isWorkHours() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 6=Sat
  const hour = now.getHours();
  return day >= 1 && day <= 5 && hour >= 9 && hour < 18;
}

function checkWorkHours() {
  if (isWorkHours()) {
    if (dom.offHoursOverlay.style.display !== 'none') {
      dom.offHoursOverlay.style.display = 'none';
      fetchDashboardData();
      dataInterval = setInterval(fetchDashboardData, 60000);
      startRotation();
    }
  } else {
    showOffHours();
    clearInterval(dataInterval);
    stopRotation();
  }
}

function showOffHours() {
  dom.offHoursOverlay.style.display = 'flex';
  const now = new Date();
  dom.offHoursTime.textContent = now.toLocaleTimeString('zh-TW');
}

async function fetchDashboardData() {
  try {
    const [dataRes, cardsRes] = await Promise.all([
      fetch('/api/dashboard/data'),
      fetch('/api/cards')
    ]);
    
    const data = dataRes.ok ? await dataRes.json() : {};
    const cards = cardsRes.ok ? await cardsRes.json() : [];
    
    allCards = cards.map(card => {
      const jobData = data[card.jobName] || {};
      return { ...card, ...jobData };
    });
    
    dom.lastUpdated.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
    renderPage(currentPage);
  } catch (e) {
    console.error('Error fetching dashboard data', e);
  }
}

function getPageSize() {
  const [cols, rows] = settings.gridSize.split('x').map(Number);
  return cols * rows;
}

function renderPage(pageNum) {
  const pageSize = getPageSize();
  const totalPages = Math.max(1, Math.ceil(allCards.length / pageSize));
  
  if (pageNum > totalPages) pageNum = 1;
  currentPage = pageNum;
  
  dom.pageCurrent.textContent = currentPage;
  dom.pageTotal.textContent = totalPages;
  
  const start = (currentPage - 1) * pageSize;
  const pageCards = allCards.slice(start, start + pageSize);
  
  dom.grid.innerHTML = '';
  pageCards.forEach((card, index) => {
    dom.grid.appendChild(createCardElement(card, index));
  });
}

function startRotation() {
  stopRotation();
  if (isRotating) {
    pageInterval = setInterval(() => {
      renderPage(currentPage + 1);
    }, 30000);
  }
}

function stopRotation() {
  clearInterval(pageInterval);
}

function resetRotationDelay() {
  stopRotation();
  clearTimeout(rotationTimeout);
  rotationTimeout = setTimeout(startRotation, 60000);
}

function getStatusClass(color) {
  if (!color) return 'not-built';
  if (color.includes('blue')) return 'success';
  if (color.includes('red')) return 'failure';
  if (color.includes('yellow') || color.includes('anime')) return 'building';
  return 'not-built';
}

function getStatusLabel(color) {
  if (!color) return 'NOT BUILT';
  if (color.includes('blue')) return 'SUCCESS';
  if (color.includes('red')) return 'FAILURE';
  if (color.includes('yellow') || color.includes('anime')) return 'BUILDING';
  return 'NOT BUILT';
}

function formatDuration(ms) {
  if (!ms) return 'N/A';
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
}

function formatRelativeTime(timestamp) {
  if (!timestamp) return 'N/A';
  const diff = Date.now() - timestamp;
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m} 分鐘前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小時前`;
  return `${Math.floor(h / 24)} 天前`;
}

function createCardElement(card, index) {
  const statusClass = getStatusClass(card.color);
  const statusLabel = getStatusLabel(card.color);
  const buildNum = card.lastBuild ? `#${card.lastBuild.number}` : '#-';
  
  const isOffline = card.nodeOffline;
  const offlineClass = isOffline ? ' card--offline' : '';
  const nodeIcon = isOffline ? '🔌🔴' : '🔌🟢';
  const nodeStatusText = isOffline ? 'Offline' : 'Online';
  
  const el = document.createElement('div');
  el.className = `card card--${statusClass}${offlineClass}`;
  el.style.animationDelay = `${index * 0.05}s`;
  
  el.innerHTML = `
    <div class="card__status-bar"></div>
    <div class="card__body" style="position: relative;">
      <div class="card__header">
        <span class="card__name" title="${card.alias || card.jobName}">${card.alias || card.jobName}</span>
        <span class="card__build-number">${buildNum}</span>
      </div>
      <div class="card__status-label">${statusLabel}</div>
      <div class="card__info">
        <div class="card__info-item">
          <span class="label">✅ 上次成功</span>
          <span class="value">${card.lastSuccessful ? `<strong style="font-size:1.1em; color:var(--color-success);">#${card.lastSuccessful.number}</strong> <span style="font-size:0.85em; opacity:0.8;">(${formatRelativeTime(card.lastSuccessful.timestamp)})</span>` : 'N/A'}</span>
        </div>
        <div class="card__info-item">
          <span class="label">❌ 上次失敗</span>
          <span class="value">${card.lastFailed ? `<strong style="font-size:1.1em; color:var(--color-failure);">#${card.lastFailed.number}</strong> <span style="font-size:0.85em; opacity:0.8;">(${formatRelativeTime(card.lastFailed.timestamp)})</span>` : 'N/A'}</span>
        </div>
        <div class="card__info-item">
          <span class="label">⏱ 上次費時</span>
          <span class="value">${formatDuration(card.lastBuild?.duration)}</span>
        </div>
      </div>
      <div class="card__trend">
        <canvas class="trend-canvas" width="200" height="50"></canvas>
      </div>
      <div style="position: absolute; bottom: var(--spacing-md); right: var(--spacing-md); font-size: 0.75rem; color: ${isOffline ? 'var(--color-failure)' : 'var(--color-text-secondary)'}; font-weight: ${isOffline ? '600' : 'normal'}; display: flex; align-items: center; gap: 4px; background: var(--color-surface); padding-left: 8px;">
        ${nodeIcon} ${nodeStatusText}
      </div>
    </div>
  `;
  
  // Draw mini trend chart if builds exist
  if (card.builds && card.builds.length > 0) {
    const canvas = el.querySelector('canvas');
    drawTrendChart(canvas, card.builds.slice(0, 10).reverse());
  }
  
  return el;
}

function drawTrendChart(canvas, builds) {
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  
  ctx.clearRect(0, 0, width, height);
  
  if (builds.length === 0) return;
  
  const maxDuration = Math.max(...builds.map(b => b.duration || 0), 1);
  const barWidth = (width / 10) - 2;
  
  builds.forEach((build, i) => {
    const x = i * (width / 10) + 1;
    let barHeight = ((build.duration || 0) / maxDuration) * height;
    if (barHeight < 2) barHeight = 2; // minimum height
    const y = height - barHeight;
    
    if (build.result === 'SUCCESS') {
      ctx.fillStyle = 'hsl(142, 71%, 45%)';
    } else if (build.result === 'FAILURE') {
      ctx.fillStyle = 'hsl(0, 84%, 60%)';
    } else {
      ctx.fillStyle = 'hsl(220, 10%, 65%)';
    }
    
    ctx.fillRect(x, y, barWidth, barHeight);
  });
}
