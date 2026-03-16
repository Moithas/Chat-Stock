// Structured Logger — lightweight wrapper around console with timestamps, levels, and optional file output
const fs = require('fs');
const path = require('path');

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const LOG_DIR = './logs';

let minLevel = LOG_LEVELS.info;
let fileOutput = true;
let currentStream = null;
let currentDate = null;

function getDateString() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function getTimestamp() {
  return new Date().toISOString();
}

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function getStream() {
  const today = getDateString();
  if (currentStream && currentDate === today) return currentStream;

  // Close old stream
  if (currentStream) {
    currentStream.end();
  }

  ensureLogDir();
  currentDate = today;
  currentStream = fs.createWriteStream(path.join(LOG_DIR, `${today}.log`), { flags: 'a' });
  return currentStream;
}

function formatMessage(level, msg, meta) {
  const ts = getTimestamp();
  const metaStr = meta !== undefined ? ` ${JSON.stringify(meta)}` : '';
  return `[${ts}] [${level.toUpperCase()}] ${msg}${metaStr}`;
}

function log(level, msg, meta) {
  if (LOG_LEVELS[level] === undefined || LOG_LEVELS[level] < minLevel) return;

  const formatted = formatMessage(level, msg, meta);

  // Console output
  if (level === 'error') {
    console.error(formatted);
  } else if (level === 'warn') {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }

  // File output
  if (fileOutput) {
    try {
      const stream = getStream();
      stream.write(formatted + '\n');
    } catch (e) {
      // Silently fail file writes — don't break the bot over logging
    }
  }
}

function pruneOldLogs(maxDays = 14) {
  try {
    ensureLogDir();
    const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log')).sort();
    while (files.length > maxDays) {
      const old = files.shift();
      fs.unlinkSync(path.join(LOG_DIR, old));
    }
  } catch (e) {
    // Best-effort cleanup
  }
}

// Run pruning once on load
pruneOldLogs();

module.exports = {
  debug: (msg, meta) => log('debug', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  error: (msg, meta) => log('error', msg, meta),

  /** Set minimum log level: 'debug' | 'info' | 'warn' | 'error' */
  setLevel(level) {
    if (LOG_LEVELS[level] !== undefined) minLevel = LOG_LEVELS[level];
  },

  /** Enable or disable file output */
  setFileOutput(enabled) {
    fileOutput = !!enabled;
  },

  pruneOldLogs
};
