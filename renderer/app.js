// DOM elements
const sessionBar = document.getElementById('sessionBar');
const sessionPercent = document.getElementById('sessionPercent');
const sessionReset = document.getElementById('sessionReset');
const weekBar = document.getElementById('weekBar');
const weekPercent = document.getElementById('weekPercent');
const weekReset = document.getElementById('weekReset');
const sonnetBar = document.getElementById('sonnetBar');
const sonnetPercent = document.getElementById('sonnetPercent');
const sonnetReset = document.getElementById('sonnetReset');
const extraBar = document.getElementById('extraBar');
const extraPercent = document.getElementById('extraPercent');
const extraReset = document.getElementById('extraReset');
const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const refreshBtn = document.getElementById('refreshBtn');
const overlay = document.getElementById('overlay');
const themeToggle = document.getElementById('themeToggle');
const toggleLabel = document.getElementById('toggleLabel');

// Theme state
const savedTheme = localStorage.getItem('cc-overlay-theme') || 'light';
overlay.className = 'overlay ' + savedTheme;
toggleLabel.textContent = savedTheme.toUpperCase();

themeToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  const isLight = overlay.classList.contains('light');
  const newTheme = isLight ? 'dark' : 'light';
  overlay.className = 'overlay ' + newTheme;
  toggleLabel.textContent = newTheme.toUpperCase();
  localStorage.setItem('cc-overlay-theme', newTheme);
});

// Drag state
let dragState = null;

function getBarClass(percent) {
  if (percent >= 90) return 'critical';
  if (percent >= 75) return 'danger';
  return '';
}

function updateSection(barEl, percentEl, resetEl, data, fillClass) {
  if (!data) return;
  const pct = data.percent;
  percentEl.textContent = pct + '% used';
  barEl.style.width = pct + '%';
  barEl.className = 'bar-fill ' + fillClass + ' ' + getBarClass(pct);
  if (data.resetTime) {
    resetEl.textContent = 'Resets ' + data.resetTime;
  }
  if (data.spent !== undefined && data.limit !== undefined) {
    resetEl.textContent = '$' + data.spent.toFixed(2) + '/$' + data.limit.toFixed(2) +
      (data.resetTime ? ' \u00b7 Resets ' + data.resetTime : '');
  }
}

function updateDisplay(data) {
  updateSection(sessionBar, sessionPercent, sessionReset, data.session, 'session-fill');
  updateSection(weekBar, weekPercent, weekReset, data.week, 'week-fill');
  updateSection(sonnetBar, sonnetPercent, sonnetReset, data.weekSonnet, 'sonnet-fill');
  updateSection(extraBar, extraPercent, extraReset, data.extra, 'extra-fill');

  // Hide sections with no data
  document.getElementById('sectionSonnet').style.display = data.weekSonnet ? 'block' : 'none';
  document.getElementById('sectionExtra').style.display = data.extra ? 'block' : 'none';

  if (data.fromCache) {
    setStatus('cached', 'Cached data');
  } else {
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    setStatus('live', 'Updated ' + time);
  }
}

function setStatus(state, text) {
  statusDot.className = 'status-dot ' + state;
  statusText.textContent = text;
  if (state !== 'fetching') {
    refreshBtn.classList.remove('spinning');
  }
}

// IPC listeners
window.overlayAPI.onUsageData((data) => {
  updateDisplay(data);
});

window.overlayAPI.onUsageStatus((status) => {
  if (status === 'fetching') {
    setStatus('fetching', 'Fetching (~20s)...');
    refreshBtn.classList.add('spinning');
  } else if (status === 'error') {
    setStatus('error', 'Failed to fetch');
    refreshBtn.classList.remove('spinning');
  }
});

// Refresh button
refreshBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.overlayAPI.refreshUsage();
});

// Dragging
overlay.addEventListener('mousedown', async (e) => {
  if (e.target === refreshBtn || e.target.closest('.refresh-btn') || e.target.closest('.theme-toggle')) return;
  const pos = await window.overlayAPI.getPosition();
  dragState = {
    startScreenX: e.screenX,
    startScreenY: e.screenY,
    windowX: pos.x,
    windowY: pos.y,
    dragged: false,
  };
});

document.addEventListener('mousemove', (e) => {
  if (!dragState) return;
  const dx = e.screenX - dragState.startScreenX;
  const dy = e.screenY - dragState.startScreenY;
  if (!dragState.dragged && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
    dragState.dragged = true;
  }
  if (dragState.dragged) {
    window.overlayAPI.setPosition(dragState.windowX + dx, dragState.windowY + dy);
  }
});

document.addEventListener('mouseup', () => {
  dragState = null;
});

// Right-click = refresh
overlay.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.overlayAPI.refreshUsage();
});
