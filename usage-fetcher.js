const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const CACHE_FILE = path.join(__dirname, '.usage-cache.json');
const HELPER_SCRIPT = path.join(__dirname, 'fetch-helper.js');

// Save fetched data to cache
function saveCache(data) {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch {}
}

// Load cached data
function loadCache() {
  try {
    const raw = fs.readFileSync(CACHE_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// Run the fetch-helper.js as a separate Node.js process
// (uses system Node.js, not Electron, so node-pty works without rebuild)
function fetchViaHelper() {
  return new Promise((resolve, reject) => {
    const cmd = `node "${HELPER_SCRIPT}"`;
    console.log('[usage-fetcher] Running helper script...');

    exec(cmd, {
      timeout: 30000,
      cwd: __dirname,
      env: { ...process.env },
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (stderr) console.log('[usage-fetcher] Helper stderr:', stderr);

      if (error) {
        return reject(new Error('Helper failed: ' + (error.message || 'unknown')));
      }

      try {
        const data = JSON.parse(stdout.trim());
        if (data.session || data.week) {
          resolve(data);
        } else {
          reject(new Error('Helper returned no usage data'));
        }
      } catch (e) {
        reject(new Error('Failed to parse helper output: ' + e.message));
      }
    });
  });
}

// Main fetch function
async function fetchUsage() {
  try {
    console.log('[usage-fetcher] Fetching via helper...');
    const data = await fetchViaHelper();
    console.log('[usage-fetcher] Success:', JSON.stringify(data).slice(0, 200));
    saveCache(data);
    return data;
  } catch (e) {
    console.log('[usage-fetcher] Helper failed:', e.message);
  }

  // Fallback: cached data
  console.log('[usage-fetcher] Falling back to cache...');
  const cached = loadCache();
  if (cached) {
    cached.fromCache = true;
    return cached;
  }

  return null;
}

module.exports = { fetchUsage, saveCache, loadCache };
