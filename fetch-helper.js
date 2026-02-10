#!/usr/bin/env node
// Runs as a SEPARATE Node.js process (not inside Electron).
// Spawns claude in a PTY, sends /usage, parses output, prints JSON to stdout.

const pty = require('node-pty');
const { execSync } = require('child_process');
const os = require('os');
const path = require('path');

// Locate claude binary automatically
function findClaude() {
  // Check common install locations
  const isWin = os.platform() === 'win32';
  const home = os.homedir();

  const candidates = isWin
    ? [
        path.join(home, '.local', 'bin', 'claude.exe'),
        path.join(home, 'AppData', 'Local', 'Programs', 'claude', 'claude.exe'),
      ]
    : [
        path.join(home, '.local', 'bin', 'claude'),
        '/usr/local/bin/claude',
        '/opt/homebrew/bin/claude',
      ];

  for (const p of candidates) {
    try { require('fs').accessSync(p); return p; } catch {}
  }

  // Fallback: ask the system PATH
  try {
    const cmd = isWin ? 'where claude' : 'which claude';
    return execSync(cmd, { encoding: 'utf-8' }).trim().split('\n')[0];
  } catch {}

  throw new Error('Could not find claude binary. Make sure Claude Code CLI is installed.');
}

const CLAUDE_PATH = findClaude();
// Use a temp directory as the trusted CWD (any directory works for /usage)
const TRUSTED_DIR = os.tmpdir();

function cleanOutput(raw) {
  // Replace cursor-right movements with space
  let s = raw.replace(/\x1b\[\d*C/g, ' ');
  // Replace cursor positioning with newline
  s = s.replace(/\x1b\[\d+;\d+H/g, '\n');
  // Strip all remaining ANSI escape codes
  s = s.replace(/\x1b\[[^A-Za-z]*[A-Za-z]/g, '');
  // Strip OSC sequences
  s = s.replace(/\x1b\][^\x07]*\x07/g, '');
  // Clean up block characters (progress bars)
  s = s.replace(/[█▉▊▋▌▍▎▏░▒▓▐▛▜▝▘▗▖▞▟]/g, '');
  // Replace tabs with spaces
  s = s.replace(/\t/g, ' ');
  // Collapse multiple spaces into single
  s = s.replace(/ {2,}/g, ' ');
  // Clean lines
  s = s.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
  return s;
}

function parseUsage(text) {
  const result = {
    session: null,
    week: null,
    weekSonnet: null,
    extra: null,
    timestamp: Date.now(),
  };

  // Find all "NN% used" occurrences
  const pctMatches = [...text.matchAll(/(\d+)\s*%\s*used/gi)];

  // Find all reset patterns - match "Rese" followed by any chars then timezone in parens
  const resetMatches = [...text.matchAll(/Rese\w*\s+([\w\d,: ]+\([\w\/]+\))/gi)];

  // Find spend pattern
  const spendMatch = text.match(/\$(\d+\.?\d*)\s*\/\s*\$(\d+\.?\d*)\s*spent/i);

  // Assign by order: session, week-all, week-sonnet, extra
  const sections = ['session', 'week', 'weekSonnet', 'extra'];

  for (let idx = 0; idx < Math.min(pctMatches.length, 4); idx++) {
    const key = sections[idx];
    result[key] = { percent: parseInt(pctMatches[idx][1], 10) };
    if (resetMatches[idx]) {
      result[key].resetTime = resetMatches[idx][1]
        .trim()
        .replace(/^[a-z]{1,2}\s+/i, '')  // Strip garbled "Resets" artifacts (e.g. "s " from "Rese s")
        .replace(/\s+/g, ' ');
    }
  }

  // Add spend info to extra if present
  if (result.extra && spendMatch) {
    result.extra.spent = parseFloat(spendMatch[1]);
    result.extra.limit = parseFloat(spendMatch[2]);
  }

  return result;
}

function fetchUsage() {
  return new Promise((resolve, reject) => {
    let output = '';
    let exited = false;

    const shell = pty.spawn(CLAUDE_PATH, [
      '--dangerously-skip-permissions'
    ], {
      name: 'xterm-256color',
      cols: 120,
      rows: 80,
      cwd: TRUSTED_DIR,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });

    shell.onData((data) => {
      output += data;
    });

    setTimeout(() => { shell.write('/usage'); }, 5000);
    setTimeout(() => { shell.write('\r'); }, 6000);
    setTimeout(() => { shell.write('\r'); }, 7000);

    setTimeout(() => {
      shell.write('/exit\r');
    }, 15000);

    setTimeout(() => {
      if (!exited) {
        exited = true;
        try { shell.kill(); } catch (e) {}
        const cleaned = cleanOutput(output);
        const data = parseUsage(cleaned);
        resolve(data);
      }
    }, 18000);

    shell.onExit(() => {
      if (!exited) {
        exited = true;
        const cleaned = cleanOutput(output);
        const data = parseUsage(cleaned);
        resolve(data);
      }
    });
  });
}

fetchUsage()
  .then((data) => {
    process.stdout.write(JSON.stringify(data));
    process.exit(0);
  })
  .catch((err) => {
    process.stderr.write('Error: ' + err.message);
    process.exit(1);
  });
