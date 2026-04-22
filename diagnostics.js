/**
 * diagnostics.js — Diagnostics & self-healing panel
 *
 * Responsibilities:
 *  - Run health checks on API, world data, and UI elements
 *  - Display results as check pills in the panel
 *  - Log messages with severity levels
 *  - Attempt auto-repair of fixable issues
 *  - Track metrics (uptime, scan count, error count, healed count)
 */

import { AppState, hasWorld, normalizeWorld, saveWorld } from './state.js';
import { probeApiConnectivity, apiMetrics } from './apiService.js';

// ─────────────────────────────────────────────────────────────
// INTERNAL STATE
// ─────────────────────────────────────────────────────────────

const diagState = {
  phase:        'idle',   // idle | detecting | ok | err | repairing
  isOpen:       false,
  startTime:    Date.now(),
  scanCount:    0,
  errorCount:   0,
  healedCount:  0,
  scanInProgress: false,
  pendingRepairs: [],     // check IDs that have auto-repair available
};

// ─────────────────────────────────────────────────────────────
// CHECK DEFINITIONS
// ─────────────────────────────────────────────────────────────

/**
 * Each check has:
 *  id           — unique key
 *  label        — display name in pills
 *  test()       — async fn returning status string or throwing Error
 *  repair()     — async fn that fixes the issue (optional)
 *  canRepair    — whether auto-repair is possible
 */
const CHECKS = [
  {
    id:       'api',
    label:    'API',
    canRepair: false,
    test: async () => {
      const { ok, latencyMs, error } = await probeApiConnectivity();
      if (!ok) throw new Error(error || 'Unreachable');
      return `Reachable (${latencyMs}ms)`;
    },
  },
  {
    id:       'world_data',
    label:    'World Data',
    canRepair: true,
    test: async () => {
      if (!hasWorld()) return 'No world loaded (expected on fresh start)';
      const W = AppState.world;
      if (!W.worldName)  throw new Error('worldName missing');
      if (!W.genre)      throw new Error('genre missing');
      if (!W.overview)   throw new Error('overview missing');
      return `"${W.worldName}" OK`;
    },
    repair: async () => {
      if (!hasWorld()) return 'No world to repair';
      const W = AppState.world;
      let fixed = [];
      if (!W.worldName) { W.worldName = 'Unknown World'; fixed.push('worldName'); }
      if (!W.genre)     { W.genre = 'Dark Fantasy';      fixed.push('genre'); }
      if (!W.overview)  { W.overview = 'A world of ancient mystery and forgotten power.'; fixed.push('overview'); }
      saveWorld();
      return fixed.length ? `Patched: ${fixed.join(', ')}` : 'No changes needed';
    },
  },
  {
    id:       'categories',
    label:    'Categories',
    canRepair: true,
    test: async () => {
      if (!hasWorld()) return 'No world loaded';
      const W = AppState.world;
      const cats = ['characters','factions','powers','history','prophecies','artifacts'];
      const missing = cats.filter(c => !Array.isArray(W[c]));
      if (missing.length) throw new Error(`Missing arrays: ${missing.join(', ')}`);
      return 'All arrays present';
    },
    repair: async () => {
      if (!hasWorld()) return 'No world to repair';
      AppState.world = normalizeWorld(AppState.world);
      saveWorld();
      return 'Initialized missing category arrays';
    },
  },
  {
    id:       'regions',
    label:    'Regions',
    canRepair: false,
    test: async () => {
      if (!hasWorld()) return 'No world loaded';
      const regions = AppState.world.regions || [];
      if (!regions.length) throw new Error('No regions defined');
      const invalid = regions.filter(r => !r.name || typeof r.x === 'undefined');
      if (invalid.length) throw new Error(`${invalid.length} region(s) missing name or coordinates`);
      return `${regions.length} regions OK`;
    },
  },
  {
    id:       'storage',
    label:    'Storage',
    canRepair: false,
    test: async () => {
      try {
        localStorage.setItem('loreforge_test', '1');
        localStorage.removeItem('loreforge_test');
        return 'localStorage available';
      } catch (e) {
        throw new Error('localStorage unavailable: ' + e.message);
      }
    },
  },
  {
    id:       'dom',
    label:    'DOM',
    canRepair: false,
    test: async () => {
      const required = ['worldMap','chatMsgs','panelScroll','detailScroll','storyOutput'];
      const missing  = required.filter(id => !document.getElementById(id));
      if (missing.length) throw new Error(`Missing elements: ${missing.join(', ')}`);
      return 'Core DOM elements present';
    },
  },
];

// ─────────────────────────────────────────────────────────────
// LOGGING
// ─────────────────────────────────────────────────────────────

/**
 * Appends a timestamped entry to the diagnostics log.
 * @param {'ok'|'err'|'warn'|'info'|'fix'|'heal'} level
 * @param {string} message
 */
export function diagLog(level, message) {
  const log = document.getElementById('diagLog');
  if (!log) return;

  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  const line = document.createElement('div');
  line.className = `ll ll-${level}`;
  line.textContent = `[${time}] ${message}`;
  log.appendChild(line);

  // Keep last 100 lines
  while (log.children.length > 100) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

/**
 * Records an error for metrics tracking.
 */
export function recordDiagError(context, message) {
  diagState.errorCount++;
  diagLog('err', `[${context}] ${message}`);
  updateMetrics();
}

// ─────────────────────────────────────────────────────────────
// SCAN ENGINE
// ─────────────────────────────────────────────────────────────

/**
 * Runs all health checks (or just fast ones).
 * @param {boolean} deep - If true, includes API connectivity probe
 */
export async function runScan(deep = false) {
  if (diagState.scanInProgress) return;
  diagState.scanInProgress = true;
  diagState.pendingRepairs  = [];

  setPhase('detecting');
  diagLog('info', `${deep ? 'Deep' : 'Quick'} scan started`);

  const checks = deep ? CHECKS : CHECKS.filter(c => c.id !== 'api');

  // Render all as "running"
  checks.forEach(c => setPillState(c.id, 'run'));

  let failures = 0;

  for (const check of checks) {
    try {
      const msg = await check.test();
      setPillState(check.id, 'ok', msg);
    } catch (err) {
      failures++;
      const severity = check.id === 'api' ? 'warn' : 'err';
      setPillState(check.id, 'fail', err.message);
      diagLog(severity, `[${check.id}] ${err.message}`);

      if (check.canRepair) {
        diagState.pendingRepairs.push(check.id);
      }
    }
  }

  diagState.scanCount++;

  // Update API latency metric if deep scan ran
  if (deep) {
    const el = document.getElementById('m-apiok');
    if (el) el.textContent = apiMetrics.lastLatencyMs ? `${apiMetrics.lastLatencyMs}ms` : '—';
  }

  const summary = failures === 0
    ? `All ${checks.length} checks passed`
    : `${failures} issue(s) detected`;

  setPhase(failures > 0 ? 'err' : 'ok');
  diagLog(failures > 0 ? 'warn' : 'ok', `Scan complete: ${summary}`);

  const summaryEl = document.getElementById('diagSummary');
  if (summaryEl) summaryEl.textContent = summary;

  // Show heal button if repairs are available
  const healBtn = document.getElementById('btnHeal');
  if (healBtn) {
    healBtn.style.display = diagState.pendingRepairs.length > 0 ? 'inline-flex' : 'none';
  }

  updateMetrics();
  diagState.scanInProgress = false;
}

// ─────────────────────────────────────────────────────────────
// REPAIR ENGINE
// ─────────────────────────────────────────────────────────────

/**
 * Attempts auto-repair for all pending fixable issues.
 */
export async function executeRepairs() {
  if (!diagState.pendingRepairs.length) {
    diagLog('info', 'No repairs queued');
    return;
  }

  setPhase('repairing');
  diagLog('heal', `Attempting ${diagState.pendingRepairs.length} repair(s)…`);

  for (const checkId of diagState.pendingRepairs) {
    const check = CHECKS.find(c => c.id === checkId);
    if (!check || !check.repair) continue;

    setPillState(checkId, 'heal');
    try {
      const result = await check.repair();
      setPillState(checkId, 'fixed', result);
      diagLog('heal', `[${checkId}] Fixed: ${result}`);
      diagState.healedCount++;
    } catch (err) {
      setPillState(checkId, 'fail', err.message);
      diagLog('err', `[${checkId}] Repair failed: ${err.message}`);
    }
  }

  diagState.pendingRepairs = [];
  updateMetrics();

  // Re-scan to verify
  setTimeout(() => runScan(false), 500);
}

// ─────────────────────────────────────────────────────────────
// UI HELPERS
// ─────────────────────────────────────────────────────────────

function setPhase(phase) {
  diagState.phase = phase;

  const el     = document.getElementById('diagPhase');
  const toggle = document.getElementById('diagToggle');
  if (!el) return;

  const PHASE_MAP = {
    idle:      { label: 'IDLE',      cls: 'phase-idle',      dot: ''       },
    detecting: { label: 'SCANNING',  cls: 'phase-detecting', dot: 'warn'   },
    ok:        { label: 'OK',        cls: 'phase-ok',        dot: 'ok'     },
    err:       { label: 'ISSUES',    cls: 'phase-err',       dot: 'err'    },
    repairing: { label: 'REPAIRING', cls: 'phase-repairing', dot: 'heal'   },
  };

  const config = PHASE_MAP[phase] || PHASE_MAP.idle;
  el.textContent = config.label;
  el.className   = `diag-phase ${config.cls}`;

  if (toggle) {
    toggle.className = config.dot ? `state-${config.dot}` : '';
    toggle.setAttribute('aria-expanded', String(diagState.isOpen));
  }
}

/**
 * Renders a check pill or updates its state.
 * Creates the pill element if it doesn't exist yet.
 */
function setPillState(id, state, title = '') {
  const container = document.getElementById('checks-row');
  if (!container) return;

  let pill = container.querySelector(`[data-check="${id}"]`);
  if (!pill) {
    pill = document.createElement('span');
    pill.dataset.check = id;
    const check = CHECKS.find(c => c.id === id);
    pill.textContent = check ? check.label : id;
    container.appendChild(pill);
  }

  pill.className = `cp cp-${state}`;
  if (title) pill.title = title;
}

function updateMetrics() {
  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  const uptimeSecs = Math.floor((Date.now() - diagState.startTime) / 1000);
  const uptimeStr  = uptimeSecs < 60  ? `${uptimeSecs}s`
                   : uptimeSecs < 3600 ? `${Math.floor(uptimeSecs/60)}m`
                   : `${Math.floor(uptimeSecs/3600)}h`;

  set('m-uptime',  uptimeStr);
  set('m-checks',  diagState.scanCount);
  set('m-healed',  diagState.healedCount);
  set('m-errors',  diagState.errorCount);
}

// ─────────────────────────────────────────────────────────────
// PANEL TOGGLE
// ─────────────────────────────────────────────────────────────

export function openDiag() {
  diagState.isOpen = true;
  document.getElementById('diagBar')?.classList.add('open');
  document.getElementById('diagToggle')?.setAttribute('aria-expanded', 'true');
}

export function closeDiag() {
  diagState.isOpen = false;
  document.getElementById('diagBar')?.classList.remove('open');
  document.getElementById('diagToggle')?.setAttribute('aria-expanded', 'false');
}

export function toggleDiag() {
  diagState.isOpen ? closeDiag() : openDiag();
}

// ─────────────────────────────────────────────────────────────
// INIT
// ─────────────────────────────────────────────────────────────

/** Called once on app startup */
export function initDiagnostics() {
  // Render initial idle pills
  CHECKS.forEach(c => setPillState(c.id, 'idle'));

  // Update uptime every 15s
  setInterval(updateMetrics, 15_000);

  diagLog('info', 'Diagnostics system initialized');
}
