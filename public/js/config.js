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
  dom.deleteModal.querySelector('.modal__backdrop').addEventListener('click', closeDeleteModal);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && dom.deleteModal.style.display !== 'none') closeDeleteModal();
  });
  
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

// Jenkins job names may contain quotes, & or < - interpolating them straight
// into innerHTML breaks the markup (and is an injection vector).
function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
      dom.pass.value = '';
      dom.pass.placeholder = config.hasPassword ? 'Password is set; leave blank to keep it' : 'No password configured';
    }
  } catch (e) {
    console.error('Failed to load jenkins config', e);
  }
}

async function testConnection() {
  dom.connStatus.textContent = 'Testing...';
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
      dom.connStatus.textContent = '✅ Connection successful!';
      dom.connStatus.className = 'connection-status success';
    } else {
      dom.connStatus.textContent = `❌ Connection failed: ${data.message || 'Unknown error'}`;
      dom.connStatus.className = 'connection-status error';
    }
  } catch (e) {
    dom.connStatus.textContent = `❌ Connection failed: ${e.message}`;
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
      showToast('Settings saved');
      dom.pass.value = '';
      dom.pass.placeholder = 'Password is set; leave blank to keep it';
      // Auto-reload jobs after saving config
      await fetchJobs();
    } else {
      showToast('Failed to save settings', 'error');
    }
  } catch (e) {
    showToast('Failed to save settings', 'error');
  }
}

// Job Dropdown
async function fetchJobs() {
  try {
    dom.refreshJobsBtn.disabled = true;
    dom.refreshJobsBtn.textContent = '⏳ Loading...';
    dom.jobStatus.textContent = 'Loading jobs from Jenkins...';
    
    const res = await fetch('/api/jenkins/jobs');
    if (res.ok) {
      const data = await res.json();
      allJobs = Array.isArray(data) ? data : (data.jobs || []);
      updateJobDropdown();
      
      if (allJobs.length === 0) {
        dom.jobStatus.textContent = '⚠️ No jobs found. Configure the Jenkins connection first.';
      } else {
        const available = getAvailableJobs();
        dom.jobStatus.textContent = `${allJobs.length} jobs found; ${available.length} available to add`;
      }
    } else {
      dom.jobStatus.textContent = '❌ Unable to retrieve the job list';
      showToast('Unable to retrieve the job list', 'error');
    }
  } catch (e) {
    console.error('fetchJobs error:', e);
    dom.jobStatus.textContent = '❌ Loading failed: ' + e.message;
    showToast('Unable to retrieve the job list: ' + e.message, 'error');
  } finally {
    dom.refreshJobsBtn.disabled = false;
    dom.refreshJobsBtn.textContent = '🔄 Reload Jobs';
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
    opt.textContent = allJobs.length === 0 ? '-- No jobs available --' : '-- All jobs are already monitored --';
    dom.jobSelect.appendChild(opt);
    dom.jobSelect.disabled = true;
    dom.addJobBtn.disabled = true;
  } else {
    // Default placeholder
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = `-- Select a job (${available.length} available) --`;
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
  dom.addJobBtn.textContent = 'Adding...';
  
  try {
    const res = await fetch('/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobName })
    });
    
    if (res.ok) {
      showToast(`✅ Added "${jobName}"`);
      await loadCards();       // Refresh card manager
      updateJobDropdown();     // Remove from dropdown
      
      const available = getAvailableJobs();
      dom.jobStatus.textContent = `${allJobs.length} jobs found; ${available.length} available to add`;
    } else {
      showToast('Failed to add job', 'error');
    }
  } catch (e) {
    showToast('Failed to add job: ' + e.message, 'error');
  } finally {
    dom.addJobBtn.textContent = '＋ Add';
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
    dom.cardManager.innerHTML = '<p style="color: var(--color-text-secondary); text-align: center; padding: 24px;">No monitored jobs yet. Select one from the list above.</p>';
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
        <input type="text" class="manage-card__alias" value="${escapeHtml(card.alias || card.jobName)}" data-id="${escapeHtml(card.id)}" maxlength="120">
        <span class="manage-card__job">${escapeHtml(card.jobName)}</span>
      </div>
      <button class="icon-btn btn-delete" data-id="${escapeHtml(card.id)}" title="Remove">🗑️</button>
    `;
    
    // Drag events
    el.addEventListener('dragstart', handleDragStart);
    el.addEventListener('dragover', handleDragOver);
    el.addEventListener('drop', handleDrop);
    el.addEventListener('dragend', handleDragEnd);
    
    // Alias edit event - only save when the value actually changed, otherwise
    // every click away triggers a PUT and a re-render that steals focus.
    const input = el.querySelector('.manage-card__alias');
    const originalAlias = card.alias || card.jobName;
    input.addEventListener('blur', (e) => {
      const value = e.target.value.trim();
      if (!value) {
        e.target.value = originalAlias;
        return;
      }
      if (value !== originalAlias) updateAlias(card.id, value);
    });
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
    showToast('Failed to save job order', 'error');
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
    showToast('Failed to update alias', 'error');
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
      showToast('Job removed');
      await loadCards();
      updateJobDropdown(); // Re-add to dropdown as available
      
      const available = getAvailableJobs();
      dom.jobStatus.textContent = `${allJobs.length} jobs found; ${available.length} available to add`;
    } else {
      showToast('Failed to remove job', 'error');
    }
  } catch (e) {
    showToast('Failed to remove job', 'error');
  } finally {
    closeDeleteModal();
  }
}
