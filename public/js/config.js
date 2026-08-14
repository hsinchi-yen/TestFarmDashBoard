document.addEventListener('DOMContentLoaded', init);

let allJobs = [];
let trackedCards = [];
let currentDeleteId = null;
let draggedItem = null;

const dom = {
  form: document.getElementById('jenkins-form'),
  url: document.getElementById('jenkins-url'),
  user: document.getElementById('jenkins-user'),
  pass: document.getElementById('jenkins-pass'),
  testBtn: document.getElementById('test-btn'),
  connStatus: document.getElementById('connection-status'),
  
  refreshJobsBtn: document.getElementById('refresh-jobs'),
  jobSelect: document.getElementById('job-select'),
  addJobBtn: document.getElementById('add-job-btn'),
  jobStatus: document.getElementById('job-status'),
  
  cardManager: document.getElementById('card-manager'),
  cardCount: document.getElementById('card-count'),
  
  deleteModal: document.getElementById('delete-modal'),
  cancelDeleteBtn: document.getElementById('cancel-delete'),
  confirmDeleteBtn: document.getElementById('confirm-delete'),
  deleteJobName: document.getElementById('delete-job-name'),
  
  toast: document.getElementById('toast'),
  themeToggle: document.getElementById('theme-toggle')
};

async function init() {
  initTheme();
  dom.themeToggle.addEventListener('click', toggleTheme);
  
  dom.form.addEventListener('submit', saveJenkinsConfig);
  dom.testBtn.addEventListener('click', testConnection);
  dom.refreshJobsBtn.addEventListener('click', fetchJobs);
  dom.addJobBtn.addEventListener('click', addSelectedJob);
  dom.jobSelect.addEventListener('change', onJobSelectChange);
  
  dom.cancelDeleteBtn.addEventListener('click', () => closeDeleteModal());
  dom.confirmDeleteBtn.addEventListener('click', confirmDelete);
  
  await loadJenkinsConfig();
  await loadCards();
  await fetchJobs();
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

function showToast(message, type = 'success') {
  dom.toast.textContent = message;
  dom.toast.className = `toast toast--${type} show`;
  setTimeout(() => {
    dom.toast.classList.remove('show');
  }, 3000);
}

// Jenkins Config
async function loadJenkinsConfig() {
  try {
    const res = await fetch('/api/jenkins/config');
    if (res.ok) {
      const config = await res.json();
      dom.url.value = config.url || '';
      dom.user.value = config.username || '';
      if (config.hasPassword) {
        dom.pass.placeholder = '已設定，若不修改請留空';
      }
    }
  } catch (e) {
    console.error('Failed to load jenkins config', e);
  }
}

async function testConnection() {
  dom.connStatus.textContent = '測試中...';
  dom.connStatus.className = 'connection-status';
  
  try {
    const payload = {
      url: dom.url.value,
      username: dom.user.value,
      password: dom.pass.value
    };
    
    const res = await fetch('/api/jenkins/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    if (data.success) {
      dom.connStatus.textContent = '✅ 連線成功！';
      dom.connStatus.className = 'connection-status success';
    } else {
      dom.connStatus.textContent = `❌ 連線失敗: ${data.message || '未知錯誤'}`;
      dom.connStatus.className = 'connection-status error';
    }
  } catch (e) {
    dom.connStatus.textContent = `❌ 連線失敗: ${e.message}`;
    dom.connStatus.className = 'connection-status error';
  }
}

async function saveJenkinsConfig(e) {
  e.preventDefault();
  try {
    const payload = {
      url: dom.url.value,
      username: dom.user.value
    };
    if (dom.pass.value) {
      payload.password = dom.pass.value;
    }
    
    const res = await fetch('/api/jenkins/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (res.ok) {
      showToast('設定已儲存');
      dom.pass.value = '';
      dom.pass.placeholder = '已設定，若不修改請留空';
      // Auto-reload jobs after saving config
      await fetchJobs();
    } else {
      showToast('儲存失敗', 'error');
    }
  } catch (e) {
    showToast('儲存失敗', 'error');
  }
}

// Job Dropdown
async function fetchJobs() {
  try {
    dom.refreshJobsBtn.disabled = true;
    dom.refreshJobsBtn.textContent = '⏳ 載入中...';
    dom.jobStatus.textContent = '正在從 Jenkins 載入...';
    
    const res = await fetch('/api/jenkins/jobs');
    if (res.ok) {
      const data = await res.json();
      allJobs = Array.isArray(data) ? data : (data.jobs || []);
      updateJobDropdown();
      
      if (allJobs.length === 0) {
        dom.jobStatus.textContent = '⚠️ 未找到任何 Job，請先設定 Jenkins 連線';
      } else {
        const available = getAvailableJobs();
        dom.jobStatus.textContent = `共 ${allJobs.length} 個 Jobs，${available.length} 個可新增`;
      }
    } else {
      dom.jobStatus.textContent = '❌ 無法取得 Jobs 列表';
      showToast('無法取得 Jobs 列表', 'error');
    }
  } catch (e) {
    console.error('fetchJobs error:', e);
    dom.jobStatus.textContent = '❌ 載入失敗: ' + e.message;
    showToast('無法取得 Jobs 列表: ' + e.message, 'error');
  } finally {
    dom.refreshJobsBtn.disabled = false;
    dom.refreshJobsBtn.textContent = '🔄 重新載入 Jobs';
  }
}

function getAvailableJobs() {
  const trackedJobNames = trackedCards.map(c => c.jobName);
  return allJobs.filter(job => !trackedJobNames.includes(job.name));
}

function updateJobDropdown() {
  const available = getAvailableJobs();
  
  dom.jobSelect.innerHTML = '';
  
  if (available.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = allJobs.length === 0 ? '-- 無可用 Jobs --' : '-- 所有 Jobs 已加入 --';
    dom.jobSelect.appendChild(opt);
    dom.jobSelect.disabled = true;
    dom.addJobBtn.disabled = true;
  } else {
    // Default placeholder
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = `-- 請選擇 Job (${available.length} 個可新增) --`;
    dom.jobSelect.appendChild(placeholder);
    
    // Add available jobs sorted alphabetically
    available
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach(job => {
        const opt = document.createElement('option');
        opt.value = job.name;
        // Show status color indicator
        const statusIcon = getJobStatusIcon(job.color);
        opt.textContent = `${statusIcon} ${job.name}`;
        dom.jobSelect.appendChild(opt);
      });
    
    dom.jobSelect.disabled = false;
    dom.addJobBtn.disabled = true; // Until user selects one
  }
}

function getJobStatusIcon(color) {
  if (!color) return '⚪';
  if (color.includes('blue')) return '🟢';
  if (color.includes('red')) return '🔴';
  if (color.includes('yellow') || color.includes('anime')) return '🟡';
  if (color.includes('aborted')) return '⚫';
  return '⚪';
}

function onJobSelectChange() {
  dom.addJobBtn.disabled = !dom.jobSelect.value;
}

async function addSelectedJob() {
  const jobName = dom.jobSelect.value;
  if (!jobName) return;
  
  dom.addJobBtn.disabled = true;
  dom.addJobBtn.textContent = '新增中...';
  
  try {
    const res = await fetch('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobName })
    });
    
    if (res.ok) {
      showToast(`✅ 已新增 "${jobName}"`);
      await loadCards();       // Refresh card manager
      updateJobDropdown();     // Remove from dropdown
      
      const available = getAvailableJobs();
      dom.jobStatus.textContent = `共 ${allJobs.length} 個 Jobs，${available.length} 個可新增`;
    } else {
      showToast('新增失敗', 'error');
    }
  } catch (e) {
    showToast('新增失敗: ' + e.message, 'error');
  } finally {
    dom.addJobBtn.textContent = '＋ 新增';
  }
}

// Card Management
async function loadCards() {
  try {
    const res = await fetch('/api/cards');
    if (res.ok) {
      trackedCards = await res.json();
      renderCards();
      dom.cardCount.textContent = trackedCards.length;
    }
  } catch (e) {
    console.error('Failed to load cards', e);
  }
}

function renderCards() {
  dom.cardManager.innerHTML = '';
  
  if (trackedCards.length === 0) {
    dom.cardManager.innerHTML = '<p style="color: var(--color-text-secondary); text-align: center; padding: 24px;">尚未新增任何監控 Job，請從上方下拉選單選擇</p>';
    return;
  }
  
  trackedCards.forEach(card => {
    const el = document.createElement('div');
    el.className = 'manage-card';
    el.draggable = true;
    el.dataset.id = card.id;
    
    el.innerHTML = `
      <div class="manage-card__handle">⠿</div>
      <div class="manage-card__content">
        <input type="text" class="manage-card__alias" value="${card.alias || card.jobName}" data-id="${card.id}">
        <span class="manage-card__job">${card.jobName}</span>
      </div>
      <button class="icon-btn btn-delete" data-id="${card.id}" data-name="${card.jobName}">🗑️</button>
    `;
    
    // Drag events
    el.addEventListener('dragstart', handleDragStart);
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('drop', handleDrop);
    el.addEventListener('dragend', handleDragEnd);
    
    // Alias edit event
    const input = el.querySelector('.manage-card__alias');
    input.addEventListener('blur', (e) => updateAlias(card.id, e.target.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        input.blur();
      }
    });
    
    // Delete event
    el.querySelector('.btn-delete').addEventListener('click', (e) => {
      openDeleteModal(card.id, card.jobName);
    });
    
    dom.cardManager.appendChild(el);
  });
}

// Drag & Drop Reorder
function handleDragStart(e) {
  draggedItem = this;
  setTimeout(() => this.classList.add('dragging'), 0);
  e.dataTransfer.effectAllowed = 'move';
}

function handleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  
  const target = e.target.closest('.manage-card');
  if (target && target !== draggedItem) {
    const rect = target.getBoundingClientRect();
    const next = (e.clientY - rect.top) / (rect.bottom - rect.top) > 0.5;
    dom.cardManager.insertBefore(draggedItem, next ? target.nextSibling : target);
  }
}

function handleDrop(e) {
  e.stopPropagation();
}

function handleDragEnd() {
  this.classList.remove('dragging');
  draggedItem = null;
  saveReorder();
}

async function saveReorder() {
  const cardItems = [...dom.cardManager.querySelectorAll('.manage-card')];
  const reorderedIds = cardItems.map(item => item.dataset.id);
  
  try {
    await fetch('/api/cards/reorder', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cardIds: reorderedIds })
    });
    loadCards(); // refresh
  } catch (e) {
    showToast('排序儲存失敗', 'error');
  }
}

// Alias Update
async function updateAlias(id, alias) {
  try {
    await fetch(`/api/cards/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alias })
    });
    loadCards();
  } catch (e) {
    showToast('更新失敗', 'error');
  }
}

// Delete Modal
function openDeleteModal(id, name) {
  currentDeleteId = id;
  dom.deleteJobName.textContent = name;
  dom.deleteModal.style.display = 'flex';
}

function closeDeleteModal() {
  dom.deleteModal.style.display = 'none';
  currentDeleteId = null;
}

async function confirmDelete() {
  if (!currentDeleteId) return;
  
  try {
    const res = await fetch(`/api/cards/${currentDeleteId}`, {
      method: 'DELETE'
    });
    if (res.ok) {
      showToast('已刪除');
      await loadCards();
      updateJobDropdown(); // Re-add to dropdown as available
      
      const available = getAvailableJobs();
      dom.jobStatus.textContent = `共 ${allJobs.length} 個 Jobs，${available.length} 個可新增`;
    } else {
      showToast('刪除失敗', 'error');
    }
  } catch (e) {
    showToast('刪除失敗', 'error');
  } finally {
    closeDeleteModal();
  }
}
