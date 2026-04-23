/**
 * diagnostics.js — Health checks, logging, and self-healing
 */

import { AppState, hasWorld, normalizeWorld, saveWorld } from './state.js';
import { probeApiConnectivity, apiMetrics } from './apiService.js';

const diagState = {
  phase: 'idle', isOpen: false, startTime: Date.now(),
  scanCount: 0, errorCount: 0, healedCount: 0,
  scanInProgress: false, pendingRepairs: [],
};

const CHECKS = [
  {
    id: 'api', label: 'API', canRepair: false,
    test: async () => {
      const { ok, latencyMs, error } = await probeApiConnectivity();
      if (!ok) throw new Error(error || 'Unreachable');
      return `Reachable (${latencyMs}ms)`;
    },
  },
  {
    id: 'world_data', label: 'World Data', canRepair: true,
    test: async () => {
      if (!hasWorld()) return 'No world loaded (expected)';
      const W = AppState.world;
      if (!W.worldName) throw new Error('worldName missing');
      if (!W.genre)     throw new Error('genre missing');
      return `"${W.worldName}" OK`;
    },
    repair: async () => {
      if (!hasWorld()) return 'No world';
      const W = AppState.world;
      let fixed = [];
      if (!W.worldName) { W.worldName = 'Unknown World'; fixed.push('worldName'); }
      if (!W.genre)     { W.genre = 'Dark Fantasy';      fixed.push('genre'); }
      saveWorld();
      return fixed.length ? `Patched: ${fixed.join(', ')}` : 'No changes';
    },
  },
  {
    id: 'categories', label: 'Categories', canRepair: true,
    test: async () => {
      if (!hasWorld()) return 'No world';
      const cats = ['characters','factions','powers','history','prophecies','artifacts'];
      const missing = cats.filter(c => !Array.isArray(AppState.world[c]));
      if (missing.length) throw new Error(`Missing: ${missing.join(', ')}`);
      return 'All arrays present';
    },
    repair: async () => {
      AppState.world = normalizeWorld(AppState.world);
      saveWorld();
      return 'Initialized missing arrays';
    },
  },
  {
    id: 'regions', label: 'Regions', canRepair: false,
    test: async () => {
      if (!hasWorld()) return 'No world';
      const r = AppState.world.regions || [];
      if (!r.length) throw new Error('No regions defined');
      return `${r.length} regions OK`;
    },
  },
  {
    id: 'storage', label: 'Storage', canRepair: false,
    test: async () => {
      localStorage.setItem('lf_test','1'); localStorage.removeItem('lf_test');
      return 'Available';
    },
  },
  {
    id: 'dom', label: 'DOM', canRepair: false,
    test: async () => {
      const required = ['worldMap','chatMsgs','panelScroll','novaLog'];
      const missing  = required.filter(id => !document.getElementById(id));
      if (missing.length) throw new Error(`Missing: ${missing.join(', ')}`);
      return 'Core DOM OK';
    },
  },
];

export function diagLog(level, message) {
  const log = document.getElementById('diagLog');
  if (!log) return;
  const time = new Date().toLocaleTimeString('en-US', { hour12: false });
  const line = document.createElement('div');
  line.className = `ll ll-${level}`;
  line.textContent = `[${time}] ${message}`;
  log.appendChild(line);
  while (log.children.length > 100) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

export function recordDiagError(context, message) {
  diagState.errorCount++;
  diagLog('err', `[${context}] ${message}`);
  updateMetrics();
}

export async function runScan(deep = false) {
  if (diagState.scanInProgress) return;
  diagState.scanInProgress = true;
  diagState.pendingRepairs  = [];
  setPhase('detecting');
  diagLog('info', `${deep ? 'Deep' : 'Quick'} scan started`);

  const checks = deep ? CHECKS : CHECKS.filter(c => c.id !== 'api');
  checks.forEach(c => setPillState(c.id, 'run'));

  let failures = 0;
  for (const check of checks) {
    try {
      const msg = await check.test();
      setPillState(check.id, 'ok', msg);
    } catch (err) {
      failures++;
      setPillState(check.id, 'fail', err.message);
      diagLog(check.id === 'api' ? 'warn' : 'err', `[${check.id}] ${err.message}`);
      if (check.canRepair) diagState.pendingRepairs.push(check.id);
    }
  }

  diagState.scanCount++;
  if (deep && apiMetrics.lastLatencyMs) {
    const el = document.getElementById('m-apiok');
    if (el) el.textContent = `${apiMetrics.lastLatencyMs}ms`;
  }

  const summary = failures === 0 ? `All ${checks.length} checks passed` : `${failures} issue(s)`;
  setPhase(failures > 0 ? 'err' : 'ok');
  diagLog(failures > 0 ? 'warn' : 'ok', `Scan complete: ${summary}`);
  const summaryEl = document.getElementById('diagSummary');
  if (summaryEl) summaryEl.textContent = summary;

  const healBtn = document.getElementById('btnHeal');
  if (healBtn) healBtn.style.display = diagState.pendingRepairs.length > 0 ? 'inline-flex' : 'none';

  updateMetrics();
  diagState.scanInProgress = false;
}

export async function executeRepairs() {
  if (!diagState.pendingRepairs.length) return;
  setPhase('repairing');
  for (const id of diagState.pendingRepairs) {
    const check = CHECKS.find(c => c.id === id);
    if (!check?.repair) continue;
    setPillState(id, 'heal');
    try {
      const result = await check.repair();
      setPillState(id, 'fixed', result);
      diagState.healedCount++;
      diagLog('heal', `[${id}] Fixed: ${result}`);
    } catch (err) {
      setPillState(id, 'fail', err.message);
      diagLog('err', `[${id}] Repair failed: ${err.message}`);
    }
  }
  diagState.pendingRepairs = [];
  updateMetrics();
  setTimeout(() => runScan(false), 500);
}

function setPhase(phase) {
  diagState.phase = phase;
  const el = document.getElementById('diagPhase');
  const toggle = document.getElementById('diagToggle');
  const map = {
    idle:      { label:'IDLE',     cls:'phase-idle',      dot:'' },
    detecting: { label:'SCANNING', cls:'phase-detecting', dot:'warn' },
    ok:        { label:'OK',       cls:'phase-ok',        dot:'ok' },
    err:       { label:'ISSUES',   cls:'phase-err',       dot:'err' },
    repairing: { label:'REPAIRING',cls:'phase-repairing', dot:'heal' },
  };
  const cfg = map[phase] || map.idle;
  if (el) { el.textContent = cfg.label; el.className = `diag-phase ${cfg.cls}`; }
  if (toggle) toggle.className = cfg.dot ? `state-${cfg.dot}` : '';
}

function setPillState(id, state, title = '') {
  const container = document.getElementById('checks-row');
  if (!container) return;
  let pill = container.querySelector(`[data-check="${id}"]`);
  if (!pill) {
    pill = document.createElement('span');
    pill.dataset.check = id;
    const check = CHECKS.find(c => c.id === id);
    pill.textContent = check?.label || id;
    container.appendChild(pill);
  }
  pill.className = `cp cp-${state}`;
  if (title) pill.title = title;
}

function updateMetrics() {
  const secs = Math.floor((Date.now() - diagState.startTime) / 1000);
  const up   = secs < 60 ? `${secs}s` : secs < 3600 ? `${Math.floor(secs/60)}m` : `${Math.floor(secs/3600)}h`;
  const set  = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('m-uptime', up);
  set('m-checks', diagState.scanCount);
  set('m-healed', diagState.healedCount);
  set('m-errors', diagState.errorCount);
}

export function openDiag()   { diagState.isOpen = true;  document.getElementById('diagBar')?.classList.add('open'); }
export function closeDiag()  { diagState.isOpen = false; document.getElementById('diagBar')?.classList.remove('open'); }
export function toggleDiag() { diagState.isOpen ? closeDiag() : openDiag(); }

export function initDiagnostics() {
  CHECKS.forEach(c => setPillState(c.id, 'idle'));
  setInterval(updateMetrics, 15_000);
  diagLog('info', 'Diagnostics initialized');
}
