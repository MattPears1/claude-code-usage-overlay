const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { fetchUsage } = require('./usage-fetcher');

const POS_FILE = path.join(__dirname, '.overlay-position.json');
const ICON_FILE = path.join(__dirname, '.tray-icon.png');
const POLL_INTERVAL = 10 * 1000; // 10 seconds (fetches take ~18s, guard prevents overlap)

let mainWindow = null;
let tray = null;
let pollTimer = null;
let isFetching = false;

function loadPosition() {
  try {
    return JSON.parse(fs.readFileSync(POS_FILE, 'utf-8'));
  } catch {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    return { x: width - 370, y: height - 180 };
  }
}

function savePosition() {
  if (!mainWindow) return;
  const [x, y] = mainWindow.getPosition();
  try {
    fs.writeFileSync(POS_FILE, JSON.stringify({ x, y }));
  } catch {}
}

// CRC32 lookup table for PNG chunk checksums
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function makePngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeB, data]));
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

function generateTrayIconPng() {
  const size = 16;
  // Build raw filtered pixel data (filter byte 0 + RGBA per pixel, per row)
  const raw = [];
  for (let y = 0; y < size; y++) {
    raw.push(0); // filter: none
    for (let x = 0; x < size; x++) {
      const dx = x - 7.5, dy = y - 7.5;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 6.5) {
        raw.push(0xe8, 0x92, 0x2a, 0xff); // orange
      } else if (dist < 7.5) {
        // anti-aliased edge
        const alpha = Math.max(0, Math.min(255, Math.round((7.5 - dist) * 255)));
        raw.push(0xe8, 0x92, 0x2a, alpha);
      } else {
        raw.push(0, 0, 0, 0); // transparent
      }
    }
  }

  const compressed = zlib.deflateSync(Buffer.from(raw));

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);  // width
  ihdr.writeUInt32BE(size, 4);  // height
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createTrayIcon() {
  try {
    // Generate PNG and save to disk (Tray works best with file path on Windows)
    const pngData = generateTrayIconPng();
    fs.writeFileSync(ICON_FILE, pngData);
    tray = new Tray(ICON_FILE);
  } catch (e) {
    console.error('Tray icon error:', e.message);
    tray = new Tray(nativeImage.createEmpty());
  }

  tray.setToolTip('Claude Code Usage');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Overlay', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'Refresh Now', click: () => refreshUsage() },
    { type: 'separator' },
    { label: 'Opacity', submenu: [
      { label: '100%', click: () => mainWindow?.setOpacity(1.0) },
      { label: '80%', click: () => mainWindow?.setOpacity(0.8) },
      { label: '60%', click: () => mainWindow?.setOpacity(0.6) },
      { label: '40%', click: () => mainWindow?.setOpacity(0.4) },
    ]},
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

function createWindow() {
  const pos = loadPosition();

  mainWindow = new BrowserWindow({
    width: 360,
    height: 280,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setVisibleOnAllWorkspaces(true);
  mainWindow.setAlwaysOnTop(true, 'screen-saver');

  mainWindow.on('blur', () => {
    if (mainWindow) mainWindow.setAlwaysOnTop(true, 'screen-saver');
  });

  mainWindow.on('moved', () => savePosition());

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

async function refreshUsage() {
  if (isFetching) return;
  isFetching = true;
  try {
    mainWindow?.webContents.send('usage-status', 'fetching');
    const data = await fetchUsage();
    if (data) {
      mainWindow?.webContents.send('usage-data', data);
    } else {
      mainWindow?.webContents.send('usage-status', 'error');
    }
  } catch (err) {
    console.error('Failed to fetch usage:', err.message);
    mainWindow?.webContents.send('usage-status', 'error');
  } finally {
    isFetching = false;
  }
}

// IPC handlers
ipcMain.handle('get-position', () => {
  if (!mainWindow) return { x: 0, y: 0 };
  const [x, y] = mainWindow.getPosition();
  return { x, y };
});

ipcMain.on('set-position', (_, x, y) => {
  mainWindow?.setPosition(Math.round(x), Math.round(y));
});

ipcMain.on('refresh-usage', () => refreshUsage());

ipcMain.on('set-opacity', (_, val) => {
  mainWindow?.setOpacity(val);
});

ipcMain.on('set-size', (_, width, height) => {
  if (!mainWindow) return;
  mainWindow.setSize(Math.round(width), Math.round(height));
  // Keep window on screen
  const [x, y] = mainWindow.getPosition();
  const { width: screenW, height: screenH } = screen.getPrimaryDisplay().workAreaSize;
  const newX = Math.max(0, Math.min(x, screenW - width));
  const newY = Math.max(0, Math.min(y, screenH - height));
  if (newX !== x || newY !== y) {
    mainWindow.setPosition(Math.round(newX), Math.round(newY));
  }
});

// Suppress EPIPE errors from console.log when pipes close
process.stdout?.on('error', () => {});
process.stderr?.on('error', () => {});

// App lifecycle
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    createTrayIcon();
    createWindow();
    setTimeout(() => refreshUsage(), 1500);
    pollTimer = setInterval(() => refreshUsage(), POLL_INTERVAL);
  });

  app.on('window-all-closed', (e) => {
    e.preventDefault?.();
  });

  app.on('before-quit', () => {
    if (pollTimer) clearInterval(pollTimer);
    savePosition();
  });
}
