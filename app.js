/**
 * app.js — Main application controller (entry point)
 *
 * Responsibilities:
 *  - Boot sequence & screen routing
 *  - World creation & initialisation
 *  - Map rendering (SVG)
 *  - Lore panel rendering & entry selection
 *  - Oracle (AI chat)
 *  - Story generator
 *  - Save / export / import
 *  - Wiring all event listeners
 */

import {
  AppState, CATEGORIES, CATEGORY_KEYS, ENTRY_SCHEMAS,
  DETAIL_SECTIONS, MAP_ICONS, LOAD_PHRASES, STORY_MODES,
  normalizeWorld, validateWorld, buildWorldContext,
  saveWorld, loadSavedWorld, saveApiKey, loadApiKey,
  hasWorld, getEntrySubLabel,
} from './state.js';

import {
  callApi, parseJsonResponse, ApiError, apiMetrics,
} from './apiService.js';

import {
  initDiagnostics, diagLog, recordDiagError,
  runScan, executeRepairs, openDiag, closeDiag, toggleDiag,
} from './diagnostics.js';

// ─────────────────────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────────────────────

/** Escape HTML to prevent XSS in innerHTML */
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─────────────────────────────────────────────────────────────
// SCREEN ROUTING
// ─────────────────────────────────────────────────────────────

/**
 * Shows the requested screen by adding the .active class.
 * @param {string} screenId - e.g. 'create', 'main', 'oracle'
 */
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${screenId}`)?.classList.add('active');
  if (screenId === 'save') refreshSaveStatus();
}

// ─────────────────────────────────────────────────────────────
// NAVIGATION (left rail)
// ─────────────────────────────────────────────────────────────

function setNav(cat) {
  if (!CATEGORIES[cat]) return;
  AppState.activeNav     = cat;
  AppState.selectedEntry = null;

  // Update rail button states
  document.querySelectorAll('.nav-btn[data-nav]').forEach(b => {
    b.classList.toggle('active', b.dataset.nav === cat);
  });

  // Update panel header
  const meta = CATEGORIES[cat];
  document.getElementById('panelTitle').textContent = meta.label;
  document.getElementById('panelSub').textContent   = meta.sub;

  renderPanel();
  clearDetail();
}

// ─────────────────────────────────────────────────────────────
// LORE PANEL
// ─────────────────────────────────────────────────────────────

function renderPanel() {
  const scroll = document.getElementById('panelScroll');
  if (!scroll) return;

  if (!hasWorld()) {
    scroll.innerHTML = '';
    return;
  }

  const items = AppState.world[AppState.activeNav] ?? [];

  if (!items.length) {
    scroll.innerHTML = '<div class="placeholder-msg">No entries yet.<br>Click + Add Entry to begin.</div>';
    return;
  }

  scroll.innerHTML = items.map((item, i) => {
    const isSelected = AppState.selectedEntry
      && AppState.selectedEntry._idx === i
      && AppState.selectedEntry._cat === AppState.activeNav;

    return `
      <div class="lore-item${isSelected ? ' selected' : ''}" data-idx="${i}">
        <div class="lore-item-name">${esc(item.name)}</div>
        <div class="lore-item-sub">${esc(getEntrySubLabel(item))}</div>
      </div>`;
  }).join('');

  scroll.querySelectorAll('.lore-item').forEach(el => {
    el.addEventListener('click', () => selectEntry(parseInt(el.dataset.idx, 10)));
  });
}

function selectEntry(idx) {
  if (!hasWorld()) return;
  const item = (AppState.world[AppState.activeNav] ?? [])[idx];
  if (!item) return;

  AppState.selectedEntry = { ...item, _idx: idx, _cat: AppState.activeNav };
  renderPanel(); // re-render to update selected state
  renderDetail(item);
}

function clearDetail() {
  document.getElementById('detailScroll').innerHTML =
    '<div class="placeholder-msg">Select an entry to view its lore.</div>';
  document.getElementById('detailFooter').innerHTML = '';
}

function renderDetail(item) {
  const scroll = document.getElementById('detailScroll');
  const footer = document.getElementById('detailFooter');

  const badge = getEntrySubLabel(item);

  let html = `<div class="detail-name">${esc(item.name)}</div>`;
  if (badge) html += `<div class="detail-badge">${esc(badge)}</div>`;
  html += `<div class="detail-body">${esc(item.description || 'No description.')}</div>`;

  // Render additional detail sections (secret, abilities, etc.)
  DETAIL_SECTIONS.forEach(([key, label]) => {
    if (item[key]) {
      html += `
        <div class="detail-section">
          <h4>${label}</h4>
          <p>${esc(item[key])}</p>
        </div>`;
    }
  });

  scroll.innerHTML = html;

  // Footer — link to Oracle
  const firstName = item.name.split(' ')[0];
  footer.innerHTML = `
    <button class="btn-detail" data-oracle="${esc(item.name)}">
      Ask Oracle about ${esc(firstName)} →
    </button>`;

  footer.querySelector('[data-oracle]').addEventListener('click', e => {
    oracleAbout(e.currentTarget.dataset.oracle);
  });
}

// ─────────────────────────────────────────────────────────────
// ADD ENTRY MODAL
// ─────────────────────────────────────────────────────────────

function openAddModal() {
  const meta = CATEGORIES[AppState.activeNav];
  document.getElementById('modalTitle').textContent    = 'Add ' + meta.label.replace(/s$/, '');
  document.getElementById('modalNameLabel').textContent = meta.nameL;
  document.getElementById('modalTypeLabel').textContent = meta.typeL;

  ['modalName', 'modalType', 'modalSeed'].forEach(id => {
    document.getElementById(id).value = '';
  });

  const btn = document.getElementById('btnGenerate');
  btn.disabled    = false;
  btn.textContent = '⚒ Generate with AI';

  document.getElementById('addModal').classList.add('open');
  setTimeout(() => document.getElementById('modalName').focus(), 50);
}

function closeModal() {
  document.getElementById('addModal').classList.remove('open');
}

async function generateEntry() {
  const name = document.getElementById('modalName').value.trim();
  const type = document.getElementById('modalType').value.trim();
  const seed = document.getElementById('modalSeed').value.trim();

  if (!name) { showToast('Give it a name first.'); return; }

  const btn = document.getElementById('btnGenerate');
  btn.disabled    = true;
  btn.textContent = 'Forging…';

  const cat    = AppState.activeNav;
  const schema = ENTRY_SCHEMAS[cat];

  diagLog('info', `Generating ${cat}: "${name}"`);

  try {
    const raw = await callApi(
      `You are a world-building AI. Context: ${buildWorldContext()}
Generate a ${cat.replace(/s$/, '')} entry.
Name: ${name}. Type/Role: ${type || 'decide based on world context'}.
Seed: ${seed || 'invent something original and compelling'}.
Respond ONLY with a JSON object matching this schema: ${schema}`,
      { maxTokens: 600 }
    );

    const entry = parseJsonResponse(raw);
    if (!entry.name) entry.name = name; // fallback

    if (!AppState.world[cat]) AppState.world[cat] = [];
    AppState.world[cat].push(entry);

    saveWorld();
    closeModal();
    renderPanel();
    selectEntry(AppState.world[cat].length - 1);
    renderMap();
    updateStoryFocus();

    diagLog('ok', `"${name}" added to ${cat}`);

  } catch (err) {
    recordDiagError('entry_gen', err.message);
    showToast(`Generation failed: ${err.message}`);
  }

  btn.disabled    = false;
  btn.textContent = '⚒ Generate with AI';
}

// ─────────────────────────────────────────────────────────────
// WORLD FORGE
// ─────────────────────────────────────────────────────────────

async function forgeWorld() {
  const name    = document.getElementById('worldName').value.trim();
  const premise = document.getElementById('worldPremise').value.trim();
  const apiKey  = document.getElementById('apiKey').value.trim();

  if (!name)   { showToast('Give your world a name, Lorekeeper.'); return; }
  if (!AppState.selectedGenre) { showToast('Choose a genre to set the tone.'); return; }
  if (!apiKey) { showToast('Enter your Anthropic API key first.'); return; }

  // Persist API key for this session and future visits
  saveApiKey(apiKey);

  showScreen('loading');

  // Rotate loading phrases
  let phraseIdx = 0;
  const loadText = document.getElementById('loadingText');
  const phraseIv = setInterval(() => {
    loadText.textContent = LOAD_PHRASES[phraseIdx++ % LOAD_PHRASES.length];
  }, 2200);

  diagLog('info', `Forging world: "${name}" (${AppState.selectedGenre})`);

  try {
    const raw = await callApi(
      `You are a world-building AI. Generate a richly detailed world.
World Name: ${name}. Genre: ${AppState.selectedGenre}. Premise: ${premise || 'Invent something compelling and original.'}.
Respond ONLY with valid JSON (no markdown, no explanation). Required schema:
{"worldName":"string","genre":"string","tagline":"evocative one-liner","overview":"2-3 sentences describing the world","regions":[{"id":"r1","name":"string","type":"string","description":"2-3 sentences","secret":"hidden truth","x":200,"y":180,"radius":65,"color":"#hex"}]}
Requirements:
- Exactly 7 regions
- Spread x values 80–620, y values 60–440
- Vary radius 50–90 per region
- Colors must be dark/muted hex values: deep slates, forest greens, charcoal purples, blood reds — nothing bright or pastel`,
      { maxTokens: 1400 }
    );

    clearInterval(phraseIv);

    const world = parseJsonResponse(raw);
    const { valid, errors } = validateWorld(world);
    if (!valid) throw new Error(errors.join('; '));

    AppState.world = normalizeWorld(world);
    saveWorld();
    initWorld();

    diagLog('ok', `World "${AppState.world.worldName}" forged — ${AppState.world.regions.length} regions`);

  } catch (err) {
    clearInterval(phraseIv);
    recordDiagError('world_forge', err.message);
    showScreen('create');
    openDiag();
    setTimeout(() => runScan(false), 400);
    showToast(`World generation failed: ${err.message}`);
  }
}

/**
 * Initialises the main screen after a world is loaded or imported.
 */
function initWorld() {
  const W = AppState.world;

  // Seed chat with Oracle greeting
  AppState.chatHistory = [];
  document.getElementById('chatMsgs').innerHTML =
    `<div class="msg-ai">I am the Oracle of <em>${esc(W.worldName)}</em>. ${esc(W.overview || '')} Ask me anything about your world.</div>`;

  document.getElementById('mapLabel').textContent     = `${W.worldName} — World Map`;
  document.getElementById('oracleSubtitle').textContent = `Oracle of ${W.worldName}`;

  renderMap();
  renderPanel();
  updateStoryFocus();
  showScreen('main');

  setTimeout(() => runScan(false), 800);
}

// ─────────────────────────────────────────────────────────────
// MAP RENDERING
// ─────────────────────────────────────────────────────────────

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Creates an SVG element with multiple attributes in one call */
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function renderMap() {
  const svg = document.getElementById('worldMap');
  if (!svg) return;

  svg.innerHTML = '';

  // Background grid pattern definition
  const defs = document.createElementNS(SVG_NS, 'defs');
  defs.innerHTML = `
    <pattern id="grid" width="35" height="35" patternUnits="userSpaceOnUse">
      <path d="M 35 0 L 0 0 0 35" fill="none" stroke="rgba(201,168,76,0.04)" stroke-width="0.5"/>
    </pattern>
    <filter id="glow">
      <feGaussianBlur stdDeviation="2" result="blur"/>
      <feComposite in="SourceGraphic" in2="blur" operator="over"/>
    </filter>`;
  svg.appendChild(defs);

  // Base fills
  svg.appendChild(svgEl('rect', { width: 700, height: 500, fill: '#0a0806' }));
  svg.appendChild(svgEl('rect', { width: 700, height: 500, fill: 'url(#grid)' }));
  svg.appendChild(svgEl('rect', { x: 6, y: 6, width: 688, height: 488, fill: 'none', stroke: 'rgba(201,168,76,0.15)', 'stroke-width': 1 }));

  if (!hasWorld() || !AppState.world.regions?.length) {
    const msg = svgEl('text', { x: 350, y: 250, 'text-anchor': 'middle', fill: 'rgba(201,168,76,0.2)', 'font-family': 'Cinzel,serif', 'font-size': 12, 'letter-spacing': 3 });
    msg.textContent = 'FORGE A WORLD TO SEE THE MAP';
    svg.appendChild(msg);
    return;
  }

  const regions = AppState.world.regions;

  // Draw faint connecting lines between nearby regions
  regions.forEach((r, i) => {
    regions.forEach((r2, j) => {
      if (j <= i) return;
      const dist = Math.hypot(r.x - r2.x, r.y - r2.y);
      if (dist < 230) {
        svg.appendChild(svgEl('line', {
          x1: r.x, y1: r.y, x2: r2.x, y2: r2.y,
          stroke: 'rgba(201,168,76,0.07)',
          'stroke-width': 1,
          'stroke-dasharray': '4 6',
        }));
      }
    });
  });

  // Draw each region
  regions.forEach(region => {
    const rx  = parseFloat(region.x) || 300;
    const ry  = parseFloat(region.y) || 250;
    const rr  = parseFloat(region.radius) || 65;
    const col = region.color || '#4a6a8a';

    const g = document.createElementNS(SVG_NS, 'g');
    g.classList.add('map-region');
    g.style.cursor = 'pointer';
    g.setAttribute('role', 'button');
    g.setAttribute('aria-label', region.name);

    // Outer glow halo
    g.appendChild(svgEl('circle', { cx: rx, cy: ry, r: rr + 12, fill: col, 'fill-opacity': 0.05 }));
    // Main region circle
    g.appendChild(svgEl('circle', { cx: rx, cy: ry, r: rr, fill: col, 'fill-opacity': 0.2, stroke: col, 'stroke-width': 1.5, 'stroke-opacity': 0.5 }));
    // Centre dot
    g.appendChild(svgEl('circle', { cx: rx, cy: ry, r: 5, fill: col, 'fill-opacity': 0.9 }));

    // Region label
    const label = svgEl('text', {
      x: rx, y: ry + rr + 15,
      'text-anchor': 'middle', fill: '#c8b89a',
      'font-family': 'Cinzel,serif', 'font-size': 9, 'letter-spacing': 1,
    });
    label.textContent = (region.name || 'Unknown').toUpperCase();
    g.appendChild(label);

    // Interactions
    g.addEventListener('mouseenter', e => showMapTooltip(e, `${region.name}  —  ${region.type || ''}`));
    g.addEventListener('mouseleave', hideMapTooltip);
    g.addEventListener('click', () => {
      setNav('regions');
      const idx = AppState.world.regions.findIndex(r => r.id === region.id);
      if (idx >= 0) selectEntry(idx);
    });

    svg.appendChild(g);
  });

  // Overlay pins for characters, factions, artifacts
  Object.entries(MAP_ICONS).forEach(([cat, { icon, color }]) => {
    (AppState.world[cat] ?? []).forEach(item => {
      // Find the region this item belongs to
      const ref = (AppState.world.regions || []).find(r =>
        item.region && r.name &&
        r.name.toLowerCase().includes((item.region || '').toLowerCase().split(' ')[0].slice(0, 4))
      );
      if (!ref) return;

      const px = parseFloat(ref.x) + (Math.random() * 28 - 14);
      const py = parseFloat(ref.y) + (Math.random() * 28 - 14);

      const pin = svgEl('text', {
        x: px, y: py,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': 10, fill: color,
      });
      pin.textContent = icon;
      pin.style.cursor = 'pointer';

      pin.addEventListener('mouseenter', e => showMapTooltip(e, `${item.name} (${cat.replace(/s$/, '')})`));
      pin.addEventListener('mouseleave', hideMapTooltip);

      svg.appendChild(pin);
    });
  });

  // World watermark label
  const watermark = svgEl('text', {
    x: 350, y: 493,
    'text-anchor': 'middle',
    fill: 'rgba(201,168,76,0.18)',
    'font-family': 'Cinzel,serif', 'font-size': 8, 'letter-spacing': 3,
  });
  watermark.textContent = `${AppState.world.worldName.toUpperCase()} ✦ ${AppState.world.genre.toUpperCase()}`;
  svg.appendChild(watermark);
}

function showMapTooltip(e, text) {
  const tip  = document.getElementById('tooltip');
  const wrap = document.getElementById('mapWrap');
  if (!tip || !wrap) return;

  const rect = wrap.getBoundingClientRect();
  tip.textContent = text;
  tip.classList.add('visible');
  tip.style.left = `${e.clientX - rect.left + 14}px`;
  tip.style.top  = `${e.clientY - rect.top  - 12}px`;
}

function hideMapTooltip() {
  document.getElementById('tooltip')?.classList.remove('visible');
}

// ─────────────────────────────────────────────────────────────
// ORACLE (AI CHAT)
// ─────────────────────────────────────────────────────────────

async function sendChat() {
  const input = document.getElementById('chatInput');
  const msg   = input.value.trim();
  if (!msg) return;

  if (!hasWorld()) {
    showToast('Forge a world first to consult the Oracle.');
    return;
  }

  const msgs = document.getElementById('chatMsgs');
  const btn  = document.getElementById('chatSendBtn');

  // Append user message
  msgs.innerHTML += `<div class="msg-user">${esc(msg)}</div>`;
  input.value = '';
  btn.disabled = true;

  // Typing indicator
  const typing = document.createElement('div');
  typing.className = 'msg-ai msg-typing';
  typing.textContent = 'The Oracle contemplates…';
  msgs.appendChild(typing);
  msgs.scrollTop = msgs.scrollHeight;

  // Build conversation history (last 8 exchanges for context)
  AppState.chatHistory.push({ role: 'user', content: msg });
  const history = AppState.chatHistory.slice(-16); // keep last 8 pairs

  try {
    const reply = await callApi(
      `Answer the following question about the world of ${AppState.world.worldName}. Question: ${msg}`,
      {
        maxTokens: 800,
        systemPrompt: `You are the Oracle — a wise, atmospheric, slightly archaic keeper of lore for the world of ${AppState.world.worldName}. 
Context: ${buildWorldContext()}
Respond in rich immersive prose. Be specific, drawing on the actual lore provided. Keep answers under 300 words unless the question warrants more depth.`,
        conversationHistory: history.slice(0, -1), // exclude the last user msg (it's in the prompt)
      }
    );

    AppState.chatHistory.push({ role: 'assistant', content: reply });
    typing.remove();
    msgs.innerHTML += `<div class="msg-ai">${esc(reply)}</div>`;

  } catch (err) {
    typing.remove();
    msgs.innerHTML += `<div class="msg-ai">The Oracle's vision is clouded. ${esc(err.message)}</div>`;
    recordDiagError('oracle', err.message);
  }

  btn.disabled = false;
  msgs.scrollTop = msgs.scrollHeight;
}

function oracleAbout(name) {
  document.getElementById('chatInput').value = `Tell me everything about ${name}.`;
  showScreen('oracle');
  sendChat();
}

function clearChat() {
  AppState.chatHistory = [];
  const msgs = document.getElementById('chatMsgs');
  if (!msgs) return;
  const W = AppState.world;
  msgs.innerHTML = W
    ? `<div class="msg-ai">I am the Oracle of <em>${esc(W.worldName)}</em>. ${esc(W.overview || '')} Ask me anything about your world.</div>`
    : `<div class="msg-ai">Forge a world to awaken the Oracle.</div>`;
}

// ─────────────────────────────────────────────────────────────
// STORY GENERATOR
// ─────────────────────────────────────────────────────────────

/**
 * Populates the "Focus On" dropdown with all world entities.
 */
function updateStoryFocus() {
  const sel = document.getElementById('storyFocus');
  if (!sel || !hasWorld()) return;

  const W = AppState.world;
  const opts = [
    'The whole world',
    ...(W.regions    ?? []).map(r => r.name),
    ...(W.characters ?? []).map(c => c.name),
    ...(W.factions   ?? []).map(f => f.name),
  ];

  sel.innerHTML = opts
    .map(o => `<option value="${esc(o)}">${esc(o)}</option>`)
    .join('');
}

async function generateStory() {
  if (!hasWorld()) { showToast('Forge a world first.'); return; }

  const seed    = document.getElementById('storySeed').value.trim();
  const focus   = document.getElementById('storyFocus').value;
  const out     = document.getElementById('storyOutput');
  const modeKey = AppState.storyMode;
  const modeInstructions = STORY_MODES[modeKey];

  out.innerHTML = '<div class="story-placeholder" style="animation:pulse 1.5s infinite">The Oracle weaves your tale…</div>';

  try {
    const text = await callApi(
      `You are a master storyteller for the world of ${AppState.world.worldName}.
Context: ${buildWorldContext()}
Focus: ${focus}.
Seed: ${seed || 'Draw on the most interesting existing lore.'}
${modeInstructions}
Write only the story content — no preamble, no meta-commentary.`,
      { maxTokens: 1200 }
    );

    out.innerHTML = `<div class="story-text">${esc(text)}</div>`;
    diagLog('ok', `Story generated (${modeKey}, focus: ${focus})`);

  } catch (err) {
    out.innerHTML = '<div class="story-placeholder">Story generation failed. Please try again.</div>';
    recordDiagError('story', err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// SAVE / EXPORT / IMPORT
// ─────────────────────────────────────────────────────────────

function doAutoSave() {
  const result = saveWorld();
  const el     = document.getElementById('autoSaveStatus');
  if (el) {
    el.textContent = result.ok
      ? `Last saved: ${new Date().toLocaleTimeString()}`
      : `Save failed: ${result.error}`;
  }
  if (!result.ok) diagLog('err', `Auto-save failed: ${result.error}`);
}

function refreshSaveStatus() {
  const el = document.getElementById('autoSaveStatus');
  if (!el) return;
  try {
    const saved = localStorage.getItem('loreforge_world');
    el.textContent = saved ? 'World saved in browser storage.' : 'No saved world found.';
  } catch {
    el.textContent = 'Storage unavailable.';
  }
}

function exportJSON() {
  if (!hasWorld()) { showToast('No world to export.'); return; }
  const blob = new Blob(
    [JSON.stringify(AppState.world, null, 2)],
    { type: 'application/json' }
  );
  const a     = document.createElement('a');
  a.href      = URL.createObjectURL(blob);
  a.download  = (AppState.world.worldName || 'loreforge').replace(/\s+/g, '_') + '_codex.json';
  a.click();
  URL.revokeObjectURL(a.href);
  diagLog('ok', 'World exported as JSON codex');
}

function importWorld() {
  const input = document.getElementById('importFile');
  const errEl = document.getElementById('importError');

  if (errEl) errEl.style.display = 'none';

  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const raw    = JSON.parse(e.target.result);
        const { valid, errors } = validateWorld(raw);
        if (!valid) throw new Error(errors.join(', '));

        AppState.world = normalizeWorld(raw);
        saveWorld();
        initWorld();
        diagLog('ok', `World "${AppState.world.worldName}" imported`);

      } catch (err) {
        const msg = `Import failed: ${err.message}`;
        if (errEl) {
          errEl.textContent    = msg;
          errEl.style.display  = 'block';
        }
        diagLog('err', msg);
      }
    };

    reader.readAsText(file);
    // Reset so the same file can be re-imported if needed
    input.value = '';
  };

  input.click();
}

function generateShareLink() {
  if (!hasWorld()) { showToast('No world to share.'); return; }
  try {
    const json    = JSON.stringify(AppState.world);
    const encoded = btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, p1) => String.fromCharCode(parseInt(p1, 16))));
    const preview = encoded.substring(0, 300);
    const box     = document.getElementById('shareBox');

    if (box) {
      box.style.display = 'block';
      box.textContent   = encoded.length > 300
        ? `${preview}… (truncated — use Export JSON for full sharing)`
        : encoded;
    }

    diagLog('ok', 'Share link generated');
  } catch (err) {
    showToast(`Share failed: ${err.message}`);
  }
}

// ─────────────────────────────────────────────────────────────
// TOAST NOTIFICATIONS
// ─────────────────────────────────────────────────────────────

/**
 * Shows a brief non-blocking toast message.
 * Avoids intrusive alert() calls.
 */
function showToast(message) {
  // Reuse existing or create new
  let toast = document.getElementById('lf-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'lf-toast';
    toast.style.cssText = `
      position: fixed; top: 1rem; left: 50%; transform: translateX(-50%);
      background: #100e0a; border: 1px solid var(--border);
      border-radius: 4px; padding: 0.6rem 1rem;
      font-family: var(--font-body); font-size: 0.88rem;
      color: var(--parchment-dim); z-index: 400;
      animation: screenIn 0.2s ease;
      box-shadow: 0 4px 20px rgba(0,0,0,0.6);
    `;
    document.body.appendChild(toast);
  }

  toast.textContent = message;
  toast.style.display = 'block';

  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.style.display = 'none';
  }, 3500);
}

// ─────────────────────────────────────────────────────────────
// EVENT LISTENERS
// ─────────────────────────────────────────────────────────────

function bindEvents() {
  // ── Create screen ─────────────────────────────────────────
  document.getElementById('btnForge').addEventListener('click', forgeWorld);

  document.querySelectorAll('.genre-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      AppState.selectedGenre = btn.dataset.genre;
    });
  });

  // ── Navigation rail ───────────────────────────────────────
  document.querySelectorAll('.nav-btn[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => setNav(btn.dataset.nav));
  });

  document.querySelectorAll('[data-screen]').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });

  // ── Lore entry modal ──────────────────────────────────────
  document.getElementById('btnAdd').addEventListener('click', openAddModal);
  document.getElementById('btnCancel').addEventListener('click', closeModal);
  document.getElementById('btnGenerate').addEventListener('click', generateEntry);

  // Close modal on overlay click
  document.getElementById('addModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // ── Oracle ────────────────────────────────────────────────
  document.getElementById('chatSendBtn').addEventListener('click', sendChat);
  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  document.getElementById('btnClearChat')?.addEventListener('click', clearChat);

  document.querySelectorAll('.oracle-prompt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('chatInput').value = btn.dataset.q;
      showScreen('oracle');
      sendChat();
    });
  });

  // ── Story mode ────────────────────────────────────────────
  document.querySelectorAll('.story-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.story-mode-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      AppState.storyMode = btn.dataset.mode;
    });
  });

  document.getElementById('btnGenerateStory').addEventListener('click', generateStory);

  // ── Save / export / import ────────────────────────────────
  document.getElementById('btnExport').addEventListener('click', exportJSON);
  document.getElementById('btnImport').addEventListener('click', importWorld);
  document.getElementById('btnShare').addEventListener('click', generateShareLink);

  // ── Diagnostics ───────────────────────────────────────────
  document.getElementById('diagToggle').addEventListener('click', toggleDiag);
  document.getElementById('diagClose').addEventListener('click', closeDiag);
  document.getElementById('btnQuickScan').addEventListener('click', () => runScan(false));
  document.getElementById('btnDeepScan').addEventListener('click', () => runScan(true));
  document.getElementById('btnHeal').addEventListener('click', executeRepairs);
  document.getElementById('btnClearLog').addEventListener('click', () => {
    document.getElementById('diagLog').innerHTML = '';
    diagLog('info', 'Log cleared');
  });
}

// ─────────────────────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────────────────────

function boot() {
  // Initialize diagnostics system
  initDiagnostics();

  // Bind all UI events
  bindEvents();

  // Restore API key to input field
  const savedKey = loadApiKey();
  if (savedKey) {
    document.getElementById('apiKey').value = savedKey;
  }

  // Attempt to restore a saved world
  const { world, error } = loadSavedWorld();

  if (world) {
    AppState.world = world;
    initWorld();
    diagLog('ok', `Restored saved world: "${world.worldName}"`);
  } else if (error) {
    diagLog('warn', `Could not restore saved world: ${error}`);
  } else {
    diagLog('info', 'No saved world — showing create screen');
  }

  // Run initial quick scan after DOM settles
  setTimeout(() => runScan(false), 1000);
}

// Start the app once the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
