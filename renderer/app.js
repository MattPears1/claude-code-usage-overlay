// DOM elements - Full mode
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

// DOM elements - Mode controls
const dotBtn = document.getElementById('dotBtn');
const miniInfo = document.getElementById('miniInfo');
const miniLabel = document.getElementById('miniLabel');
const miniPercent = document.getElementById('miniPercent');
const miniBarFill = document.getElementById('miniBarFill');
const miniExpandBtn = document.getElementById('miniExpandBtn');
const miniDotBtn = document.getElementById('miniDotBtn');
const dotCircle = document.getElementById('dotCircle');

// Window sizes for each mode
const MODE_SIZES = {
  full: { width: 360, height: 280 },
  mini: { width: 360, height: 40 },
  dot:  { width: 28,  height: 28 },
};

// Section configuration
const SECTION_CONFIG = {
  session: { label: 'Session', fillClass: 'session-fill', dataKey: 'session' },
  week:    { label: 'Week',    fillClass: 'week-fill',    dataKey: 'week' },
  sonnet:  { label: 'Sonnet',  fillClass: 'sonnet-fill',  dataKey: 'weekSonnet' },
  extra:   { label: 'Extra',   fillClass: 'extra-fill',   dataKey: 'extra' },
};

const SECTION_ORDER = ['session', 'week', 'sonnet', 'extra'];

// State
let latestData = null;
let displayMode = localStorage.getItem('cc-overlay-mode') || 'full';
let miniSection = localStorage.getItem('cc-overlay-mini-section') || 'session';
let dragState = null;
let savedDotPosition = null; // Remembers where the dot was before expanding

// Theme state
const savedTheme = localStorage.getItem('cc-overlay-theme') || 'light';
overlay.className = 'overlay ' + savedTheme + ' mode-' + displayMode;
toggleLabel.textContent = savedTheme.toUpperCase();

themeToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  const isLight = overlay.classList.contains('light');
  const newTheme = isLight ? 'dark' : 'light';
  overlay.className = 'overlay ' + newTheme + ' mode-' + displayMode;
  toggleLabel.textContent = newTheme.toUpperCase();
  localStorage.setItem('cc-overlay-theme', newTheme);
});

// === Display mode management ===

async function setDisplayMode(mode, section) {
  // Save dot position before leaving dot mode so we can restore it later
  if (displayMode === 'dot' && mode !== 'dot') {
    savedDotPosition = await window.overlayAPI.getPosition();
  }

  displayMode = mode;
  localStorage.setItem('cc-overlay-mode', mode);

  if (section) {
    miniSection = section;
    localStorage.setItem('cc-overlay-mini-section', section);
  }

  // Update CSS classes (preserve theme)
  const theme = overlay.classList.contains('dark') ? 'dark' : 'light';
  overlay.className = 'overlay ' + theme + ' mode-' + mode;

  // Resize window
  const size = MODE_SIZES[mode];
  window.overlayAPI.setSize(size.width, size.height);

  // Restore dot position when going back to dot mode
  if (mode === 'dot' && savedDotPosition) {
    window.overlayAPI.setPosition(savedDotPosition.x, savedDotPosition.y);
  }

  // Update sub-displays
  if (mode === 'mini' && latestData) updateMiniDisplay();
  if (mode === 'dot' && latestData) updateDotDisplay();
}

function getVisibleSections() {
  return SECTION_ORDER.filter(s => {
    if (s === 'session' || s === 'week') return true;
    if (s === 'sonnet') return !!latestData?.weekSonnet;
    if (s === 'extra') return !!latestData?.extra;
    return false;
  });
}

function cycleSection() {
  const visible = getVisibleSections();
  const idx = visible.indexOf(miniSection);
  miniSection = visible[(idx + 1) % visible.length];
  localStorage.setItem('cc-overlay-mini-section', miniSection);
  updateMiniDisplay();
}

function updateMiniDisplay() {
  if (!latestData) return;

  // Fall back to session if current section has no data
  let config = SECTION_CONFIG[miniSection];
  let data = latestData[config.dataKey];

  if (!data) {
    miniSection = 'session';
    config = SECTION_CONFIG.session;
    data = latestData.session;
    localStorage.setItem('cc-overlay-mini-section', 'session');
  }

  miniLabel.textContent = config.label;

  if (data) {
    const pct = data.percent;
    miniPercent.textContent = pct + '%';
    miniBarFill.style.width = pct + '%';
    miniBarFill.className = 'bar-fill ' + config.fillClass + ' ' + getBarClass(pct);
  } else {
    miniPercent.textContent = '--%';
    miniBarFill.style.width = '0%';
    miniBarFill.className = 'bar-fill ' + config.fillClass;
  }
}

function updateDotDisplay() {
  if (!latestData) return;

  // Dot color reflects the most critical usage level
  let maxClass = '';
  for (const key of SECTION_ORDER) {
    const config = SECTION_CONFIG[key];
    const data = latestData[config.dataKey];
    if (data) {
      const cls = getBarClass(data.percent);
      if (cls === 'critical') { maxClass = 'critical'; break; }
      if (cls === 'danger' && maxClass !== 'critical') maxClass = 'danger';
    }
  }
  dotCircle.className = 'dot-circle' + (maxClass ? ' dot-' + maxClass : '');

  // Tooltip with session info
  const session = latestData.session;
  if (session) {
    dotCircle.title = 'Session: ' + session.percent + '% used\nClick to expand';
  }
}

// === Bar display ===

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
  latestData = data;

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

  // Keep mini and dot in sync
  updateMiniDisplay();
  updateDotDisplay();
}

function setStatus(state, text) {
  statusDot.className = 'status-dot ' + state;
  statusText.textContent = text;
  if (state !== 'fetching') {
    refreshBtn.classList.remove('spinning');
  }
}

// === IPC listeners ===

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

// === Button handlers ===

refreshBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  window.overlayAPI.refreshUsage();
});

dotBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setDisplayMode('dot');
});

miniExpandBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setDisplayMode('full');
});

miniDotBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  setDisplayMode('dot');
});

miniInfo.addEventListener('click', (e) => {
  e.stopPropagation();
  cycleSection();
});

// === Dragging ===

overlay.addEventListener('mousedown', async (e) => {
  if (e.target.closest('button') || e.target.closest('.mini-info')) return;
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

document.addEventListener('mouseup', (e) => {
  if (!dragState) return;
  const wasDragged = dragState.dragged;
  dragState = null;

  if (wasDragged) return;

  // Handle non-drag clicks by mode
  if (displayMode === 'dot') {
    setDisplayMode('full');
    return;
  }

  if (displayMode === 'mini') {
    // Click on mini bar area (not buttons/info) expands to full
    setDisplayMode('full');
    return;
  }

  if (displayMode === 'full') {
    // Click on a usage section enters mini mode for that section
    const section = e.target.closest('.usage-section');
    if (section && section.dataset.section) {
      setDisplayMode('mini', section.dataset.section);
    }
  }
});

// Right-click behaviour
overlay.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (displayMode === 'full') {
    window.overlayAPI.refreshUsage();
  } else {
    // In mini or dot mode, right-click expands to full
    setDisplayMode('full');
  }
});

// === Initialize mode on load ===
if (displayMode !== 'full') {
  const size = MODE_SIZES[displayMode];
  window.overlayAPI.setSize(size.width, size.height);
}
