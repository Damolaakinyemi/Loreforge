/**
 * app.js — Loreforge 2 main controller
 *
 * Features:
 *  1. Interview wizard — asks specific questions to build the world
 *  2. Map — interactive SVG with clickable regions and full detail modals
 *  3. Nova — civilization simulator that evolves the world over time
 *  4. Oracle — context-aware AI chat with conversation memory
 *  5. Lore panels — browsable entries for all categories
 *  6. Save / export / import
 */

import {
  AppState, INTERVIEW_STEPS, CATEGORIES, CATEGORY_KEYS,
  DETAIL_SECTIONS, MAP_ICONS, LOAD_PHRASES, INTERVENTION_OPTIONS,
  normalizeWorld, validateWorld, buildWorldContext,
  saveWorld, loadSavedWorld, saveApiKey, loadApiKey,
  hasWorld, getEntrySubLabel,
} from './state.js';

import { callApi, parseJsonResponse, ApiError } from './apiService.js';

import {
  initDiagnostics, diagLog, recordDiagError,
  runScan, executeRepairs, openDiag, closeDiag, toggleDiag,
} from './diagnostics.js';

import { renderIllustratedMap, renderMiniMap } from './map.js';

// ─── UTILITY ─────────────────────────────────────────────────
const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs={}) => {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, v));
  return el;
};

// ─── SCREEN ROUTING ───────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(`screen-${id}`)?.classList.add('active');
}

// ─── MAIN VIEW (sub-panels within screen-main) ───────────────
function setNav(navId) {
  AppState.activeNav = navId;
  document.querySelectorAll('.nav-btn[data-nav]').forEach(b =>
    b.classList.toggle('active', b.dataset.nav === navId)
  );

  // Switch the main view panel
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

  if (navId === 'map') {
    document.getElementById('view-map').classList.add('active');
    updatePanelForMap();
  } else if (navId === 'nova') {
    document.getElementById('view-nova').classList.add('active');
    updatePanelForNova();
  } else if (navId === 'oracle') {
    document.getElementById('view-oracle').classList.add('active');
    updatePanelForOracle();
  } else {
    // Lore category
    document.getElementById('view-lore').classList.add('active');
    updatePanelForCategory(navId);
  }
}

// ─────────────────────────────────────────────────────────────
// PANEL CONTENT MANAGEMENT
// ─────────────────────────────────────────────────────────────

function updatePanelForMap() {
  document.getElementById('panelTitle').textContent = 'World Overview';
  document.getElementById('panelSub').textContent   = AppState.world?.worldName || 'Your world';
  const scroll = document.getElementById('panelScroll');
  const footer = document.getElementById('panelFooter');

  if (!hasWorld()) { scroll.innerHTML = ''; footer.innerHTML = ''; return; }
  const W = AppState.world;

  scroll.innerHTML = `
    <div style="padding:.65rem 1rem;">
      <div style="font-family:var(--font-display);font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:.5rem">World</div>
      <div style="font-size:.88rem;color:var(--parchment-dim);line-height:1.6;margin-bottom:1rem">${esc(W.overview||'')}</div>
      ${W.centralConflict ? `
        <div style="font-family:var(--font-display);font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:.35rem">Central Conflict</div>
        <div style="font-size:.82rem;color:var(--text-muted);line-height:1.55;font-style:italic;margin-bottom:1rem">${esc(W.centralConflict)}</div>
      ` : ''}
      <div style="font-family:var(--font-display);font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:.35rem">Regions</div>
      ${(W.regions||[]).map(r => `
        <div class="lore-item" data-region="${esc(r.name)}" style="padding:.45rem .6rem;margin-bottom:.2rem;background:rgba(255,255,255,.02);border-radius:3px;cursor:pointer;border-left:2px solid ${r.color||'#4a6a8a'}">
          <div class="lore-item-name">${esc(r.name)}</div>
          <div class="lore-item-sub">${esc(r.type||'')}</div>
        </div>`).join('')}
    </div>`;

  scroll.querySelectorAll('[data-region]').forEach(el => {
    el.addEventListener('click', () => openRegionModal(el.dataset.region));
  });

  footer.innerHTML = `<button class="btn-add" id="btnStartSim">◎ Start Simulation</button>`;
  document.getElementById('btnStartSim').addEventListener('click', () => setNav('nova'));
}

function updatePanelForNova() {
  document.getElementById('panelTitle').textContent = 'Nova';
  document.getElementById('panelSub').textContent   = 'Civilization Simulator';
  const scroll = document.getElementById('panelScroll');
  const footer = document.getElementById('panelFooter');

  const W = AppState.world;
  if (!W) { scroll.innerHTML = ''; return; }

  const sim = AppState.nova;
  scroll.innerHTML = `
    <div style="padding:.65rem 1rem">
      <div style="font-family:var(--font-display);font-size:.58rem;letter-spacing:.15em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:.5rem">Simulation Status</div>
      <div style="font-family:var(--font-mono);font-size:.8rem;color:var(--nova);margin-bottom:.85rem">Year ${sim.year}</div>
      <div style="font-family:var(--font-display);font-size:.58rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:.35rem">Region Power</div>
      ${(W.regions||[]).map(r => {
        const rs = sim.regionState[r.name] || { power: 50, stability: 50 };
        return `
          <div style="margin-bottom:.55rem">
            <div style="font-size:.72rem;color:var(--parchment-dim);margin-bottom:.2rem">${esc(r.name)}</div>
            <div style="height:4px;background:var(--border-faint);border-radius:2px;margin-bottom:.12rem">
              <div style="height:100%;width:${rs.power}%;background:${r.color||'#4a6a8a'};border-radius:2px;transition:width .5s"></div>
            </div>
            <div style="font-size:.6rem;color:var(--text-faintest)">Power: ${rs.power}%  Stability: ${rs.stability}%</div>
          </div>`;
      }).join('')}
    </div>`;

  footer.innerHTML = `<button class="btn-add" id="btnExportTimeline">↓ Export Timeline</button>`;
  document.getElementById('btnExportTimeline').addEventListener('click', exportTimeline);
}

function updatePanelForOracle() {
  document.getElementById('panelTitle').textContent = 'The Oracle';
  document.getElementById('panelSub').textContent   = AppState.world?.worldName || '';
  document.getElementById('panelScroll').innerHTML  = '';
  document.getElementById('panelFooter').innerHTML  = '';
}

function updatePanelForCategory(cat) {
  const meta   = CATEGORIES[cat];
  if (!meta)   return;
  document.getElementById('panelTitle').textContent = meta.label;
  document.getElementById('panelSub').textContent   = meta.sub;

  const scroll = document.getElementById('panelScroll');
  const footer = document.getElementById('panelFooter');

  if (!hasWorld()) { scroll.innerHTML = ''; footer.innerHTML = ''; return; }

  const items = AppState.world[cat] ?? [];

  if (!items.length) {
    scroll.innerHTML = '<div class="placeholder-msg">No entries yet.</div>';
  } else {
    scroll.innerHTML = items.map((item, i) => {
      const isSel = AppState.selectedEntry?._idx === i && AppState.selectedEntry?._cat === cat;
      return `<div class="lore-item${isSel?' selected':''}" data-idx="${i}">
        <div class="lore-item-name">${esc(item.name)}</div>
        <div class="lore-item-sub">${esc(getEntrySubLabel(item))}</div>
      </div>`;
    }).join('');

    scroll.querySelectorAll('.lore-item').forEach(el => {
      el.addEventListener('click', () => selectLoreEntry(cat, parseInt(el.dataset.idx, 10)));
    });
  }

  footer.innerHTML = `<button class="btn-add" id="btnAddEntry">+ Add Entry</button>`;
  document.getElementById('btnAddEntry').addEventListener('click', () => openAddEntryModal(cat));
}

function selectLoreEntry(cat, idx) {
  const item = (AppState.world[cat] ?? [])[idx];
  if (!item) return;
  AppState.selectedEntry = { ...item, _idx: idx, _cat: cat };
  updatePanelForCategory(cat); // refresh selection state

  // Render in detail view
  const scroll = document.getElementById('loreDetailScroll');
  const footer = document.getElementById('loreDetailFooter');
  const badge  = getEntrySubLabel(item);

  let html = `<div class="detail-name">${esc(item.name)}</div>`;
  if (badge) html += `<div class="detail-badge">${esc(badge)}</div>`;
  html += `<div class="detail-body">${esc(item.description || 'No description.')}</div>`;
  DETAIL_SECTIONS.forEach(([key, label]) => {
    if (item[key]) html += `<div class="detail-section"><h4>${label}</h4><p>${esc(item[key])}</p></div>`;
  });
  scroll.innerHTML = html;

  footer.innerHTML = `<button class="btn-detail" data-oracle="${esc(item.name)}">Ask Oracle about ${esc(item.name.split(' ')[0])} →</button>`;
  footer.querySelector('[data-oracle]').addEventListener('click', e => oracleAbout(e.currentTarget.dataset.oracle));
}

// ─────────────────────────────────────────────────────────────
// INTERVIEW WIZARD
// ─────────────────────────────────────────────────────────────

function startInterview() {
  AppState.interview.step    = 0;
  AppState.interview.answers = {};
  showScreen('interview');
  renderInterviewStep();
}

function renderInterviewStep() {
  const stepIdx  = AppState.interview.step;
  const step     = INTERVIEW_STEPS[stepIdx];
  const total    = INTERVIEW_STEPS.length;
  const answers  = AppState.interview.answers;

  // Sidebar progress steps
  const progressEl = document.getElementById('interviewProgress');
  progressEl.innerHTML = INTERVIEW_STEPS.map((s, i) => {
    const done   = i < stepIdx;
    const active = i === stepIdx;
    return `
      <div class="interview-step${active?' active':''}${done?' done':''}">
        <div class="step-dot">${done ? '✓' : i+1}</div>
        <div class="step-info">
          <div class="step-name">${s.name}</div>
          <div class="step-desc">${s.desc}</div>
        </div>
      </div>`;
  }).join('');

  // Progress bar
  document.getElementById('progressBar').style.width = `${((stepIdx) / total) * 100}%`;
  document.getElementById('progressLabel').textContent = `Step ${stepIdx+1} of ${total}`;

  // Back button
  const backBtn = document.getElementById('btnInterviewBack');
  backBtn.style.visibility = stepIdx === 0 ? 'hidden' : 'visible';

  // Main content
  const content = document.getElementById('interviewContent');
  content.innerHTML = `
    <div class="interview-q-block">
      <div class="interview-q-step">${step.name}</div>
      <div class="interview-q-title">${step.title}</div>
      <div class="interview-q-desc">${step.intro}</div>
      <div class="interview-questions" id="stepFields"></div>
    </div>`;

  const fieldsEl = document.getElementById('stepFields');
  step.fields.forEach(field => renderField(field, fieldsEl, answers));
}

function renderField(field, container, answers) {
  const wrapper = document.createElement('div');
  wrapper.className = 'interview-field';

  if (field.type === 'tags') {
    const saved = answers[field.id] || '';
    wrapper.innerHTML = `
      <label>${field.label}</label>
      <div class="tag-select" id="tags-${field.id}">
        ${field.options.map(o => `
          <button class="tag-btn${saved === o ? ' selected' : ''}" data-val="${esc(o)}">${esc(o)}</button>
        `).join('')}
      </div>`;
    container.appendChild(wrapper);
    wrapper.querySelectorAll('.tag-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        wrapper.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        answers[field.id] = btn.dataset.val;
      });
    });

  } else if (field.type === 'repeater') {
    const items = answers[field.id] || [buildEmptyRepeaterItem(field)];
    if (!answers[field.id]) answers[field.id] = items;

    wrapper.innerHTML = `<label>${field.label}</label><div class="repeater-list" id="repeater-${field.id}"></div>
      <button class="btn-repeater-add" id="btnAdd-${field.id}">+ Add ${field.itemLabel}</button>`;
    container.appendChild(wrapper);

    const listEl = wrapper.querySelector(`#repeater-${field.id}`);
    items.forEach((item, i) => renderRepeaterItem(field, item, i, listEl, answers));

    wrapper.querySelector(`#btnAdd-${field.id}`).addEventListener('click', () => {
      const newItem = buildEmptyRepeaterItem(field);
      answers[field.id].push(newItem);
      renderRepeaterItem(field, newItem, answers[field.id].length - 1, listEl, answers);
    });

  } else {
    // text | textarea
    const tag  = field.type === 'textarea' ? 'textarea' : 'input';
    const val  = answers[field.id] || '';
    const rows = field.type === 'textarea' ? 'rows="3"' : '';
    wrapper.innerHTML = `
      <label>${field.label}</label>
      <${tag} id="field-${field.id}" placeholder="${esc(field.placeholder||'')}" ${rows}>${field.type==='textarea' ? esc(val) : ''}</${tag}>
      ${field.type !== 'textarea' ? '' : ''}`;

    if (field.type !== 'textarea') {
      wrapper.querySelector(`#field-${field.id}`).value = val;
    }
    container.appendChild(wrapper);

    wrapper.querySelector(`#field-${field.id}`).addEventListener('input', e => {
      answers[field.id] = e.target.value;
    });
  }
}

function buildEmptyRepeaterItem(field) {
  const obj = {};
  field.subfields.forEach(sf => { obj[sf.id] = ''; });
  return obj;
}

function renderRepeaterItem(field, item, idx, listEl, answers) {
  const div = document.createElement('div');
  div.className = 'repeater-item';
  div.dataset.idx = idx;

  const fieldsHtml = field.subfields.map(sf => {
    const tag = sf.type === 'textarea' ? 'textarea' : 'input';
    const val = item[sf.id] || '';
    return `<${tag} data-sf="${sf.id}" placeholder="${esc(sf.placeholder||'')}"${sf.type==='textarea'?' rows="2"':''}>${sf.type==='textarea'?esc(val):''}</${tag}>`;
  }).join('');

  div.innerHTML = `<div class="repeater-item-fields">${fieldsHtml}</div>
    <button class="repeater-remove" title="Remove">✕</button>`;

  if (field.subfields.some(sf => sf.type !== 'textarea')) {
    div.querySelectorAll('input').forEach(inp => { inp.value = item[inp.dataset.sf] || ''; });
  }

  div.querySelectorAll('input, textarea').forEach(el => {
    el.addEventListener('input', e => {
      answers[field.id][idx][e.target.dataset.sf] = e.target.value;
    });
  });

  div.querySelector('.repeater-remove').addEventListener('click', () => {
    if ((answers[field.id]?.length || 0) <= (field.minItems || 1)) {
      showToast(`Need at least ${field.minItems || 1} ${field.itemLabel}(s).`);
      return;
    }
    answers[field.id].splice(idx, 1);
    div.remove();
    // Re-index
    listEl.querySelectorAll('.repeater-item').forEach((el, i) => { el.dataset.idx = i; });
  });

  listEl.appendChild(div);
}

function collectStepAnswers() {
  const step    = INTERVIEW_STEPS[AppState.interview.step];
  const answers = AppState.interview.answers;

  for (const field of step.fields) {
    if (field.type === 'text' || field.type === 'textarea') {
      const el = document.getElementById(`field-${field.id}`);
      if (el) answers[field.id] = el.value.trim();
    }
    // tags and repeaters are updated live via event listeners
  }
}

function validateCurrentStep() {
  const step    = INTERVIEW_STEPS[AppState.interview.step];
  const answers = AppState.interview.answers;

  for (const field of step.fields) {
    if (field.id === 'worldName' && !answers[field.id]) {
      showToast('Give your world a name first.');
      return false;
    }
    if (field.id === 'genre' && !answers[field.id]) {
      showToast('Choose a genre to set the tone.');
      return false;
    }
    if (field.type === 'repeater') {
      const items = answers[field.id] || [];
      const hasContent = items.some(item =>
        Object.values(item).some(v => String(v).trim().length > 0)
      );
      if (!hasContent) {
        showToast(`Add at least one ${field.itemLabel}.`);
        return false;
      }
    }
  }
  return true;
}

async function advanceInterview() {
  collectStepAnswers();
  if (!validateCurrentStep()) return;

  const nextStep = AppState.interview.step + 1;

  if (nextStep >= INTERVIEW_STEPS.length) {
    // All steps done — forge the world
    await forgeWorldFromInterview();
  } else {
    AppState.interview.step = nextStep;
    renderInterviewStep();
  }
}

function retreatInterview() {
  if (AppState.interview.step > 0) {
    AppState.interview.step--;
    renderInterviewStep();
  }
}

// ─────────────────────────────────────────────────────────────
// WORLD FORGE (from interview answers)
// ─────────────────────────────────────────────────────────────

async function forgeWorldFromInterview() {
  const a = AppState.interview.answers;
  showScreen('loading');

  let phraseIdx = 0;
  const lt = document.getElementById('loadingText');
  const iv = setInterval(() => { lt.textContent = LOAD_PHRASES[phraseIdx++ % LOAD_PHRASES.length]; }, 2200);

  diagLog('info', `Forging world: "${a.worldName}" (${a.genre})`);

  try {
    // Step 1: Generate AI region coordinates and map data from user-provided regions
    document.getElementById('loadingSub').textContent = 'Placing regions on the map…';

    const userRegions = (a.regions || []).filter(r => r.name);
    const regionsPrompt = `You are a world-building AI. The user has defined these regions for their world "${a.worldName}":
${userRegions.map((r,i) => `${i+1}. ${r.name} — ${r.type||''}: ${r.description||''}`).join('\n')}

For each region, assign map coordinates and visual properties.
The map canvas is 800x560. Spread regions across the full canvas. Vary sizes. Use dark/muted fantasy colors.
Return ONLY a JSON array. Each element must match:
{"name":"exact region name from above","type":"terrain type","description":"description","secret":"hidden truth","x":300,"y":280,"radius":70,"color":"#4a6a8a","id":"r${0}"}
Return exactly ${userRegions.length} objects, one per region.`;

    const regRaw    = await callApi(regionsPrompt, { maxTokens: 800 });
    let regionsJson = [];
    try {
      const cleaned = regRaw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
      const arrStart = cleaned.indexOf('[');
      const arrEnd   = cleaned.lastIndexOf(']');
      regionsJson = JSON.parse(cleaned.slice(arrStart, arrEnd+1));
    } catch(_) {
      // If array parse fails, fall back to generating positions ourselves
      regionsJson = userRegions.map((r, i) => ({
        ...r,
        id: `r${i}`,
        x:  80 + (i % 4) * 170 + Math.random() * 60,
        y:  80 + Math.floor(i / 4) * 200 + Math.random() * 80,
        radius: 55 + Math.random() * 30,
        color: ['#4a6a8a','#5a4a6a','#4a6a4a','#6a4a4a','#4a5a6a','#6a5a4a','#5a6a4a'][i%7],
      }));
    }

    // Merge user descriptions with AI coordinates
    const finalRegions = regionsJson.map((r, i) => {
      const user = userRegions.find(u => u.name === r.name) || userRegions[i] || {};
      return {
        id:          r.id          || `r${i}`,
        name:        user.name     || r.name,
        type:        user.type     || r.type     || '',
        description: user.description || r.description || '',
        secret:      user.secret   || r.secret   || '',
        x:           parseFloat(r.x) || 200 + i*100,
        y:           parseFloat(r.y) || 200,
        radius:      parseFloat(r.radius) || 65,
        color:       r.color || '#4a6a8a',
      };
    });

    // Step 2: Assemble the world object from all interview answers
    document.getElementById('loadingSub').textContent = 'Assembling the codex…';

    const world = {
      worldName:      a.worldName     || 'Unknown World',
      genre:          a.genre         || 'Dark Fantasy',
      tagline:        a.tagline        || '',
      overview:       a.overview       || '',
      centralConflict: a.centralConflict || '',
      darkSecret:     a.darkSecret     || '',
      regions:        finalRegions,
      characters:     (a.characters || []).filter(c => c.name),
      factions:       (a.factions   || []).filter(f => f.name),
      powers:         [],
      history:        (a.history    || []).filter(h => h.name),
      prophecies:     [],
      artifacts:      [],
      // Power system as a category entry
      powerName:      a.powerName   || '',
      powerHow:       a.powerHow    || '',
      powerCost:      a.powerCost   || '',
      powerSecret:    a.powerSecret || '',
    };

    // Convert power system fields into a powers array entry
    if (a.powerName) {
      world.powers.push({
        name:        a.powerName,
        category:    'Core System',
        description: a.powerHow    || '',
        abilities:   a.powerHow    || '',
        secret:      a.powerSecret || '',
        history:     a.powerCost   || '',
      });
    }

    const { valid, errors } = validateWorld(world);
    if (!valid) throw new Error(errors.join('; '));

    clearInterval(iv);
    AppState.world = normalizeWorld(world);
    saveWorld();
    initWorld();
    diagLog('ok', `World "${AppState.world.worldName}" forged — ${AppState.world.regions.length} regions`);

  } catch (err) {
    clearInterval(iv);
    recordDiagError('world_forge', err.message);
    showScreen('interview');
    showToast(`World generation failed: ${err.message}`);
  }
}

function initWorld() {
  const W = AppState.world;
  document.getElementById('mapLabel').textContent       = `${W.worldName} — World Map`;
  document.getElementById('oracleSubtitle').textContent = `Oracle of ${W.worldName}`;
  document.getElementById('novaWorldName').textContent  = W.worldName;

  // Oracle greeting
  AppState.chatHistory = [];
  document.getElementById('chatMsgs').innerHTML =
    `<div class="msg-ai">I am the Oracle of <em>${esc(W.worldName)}</em>. ${esc(W.overview||'')} Ask me anything about your world.</div>`;

  // Init Nova region state
  AppState.nova = { year: 0, running: false, events: [], intervalId: null, regionState: {} };
  (W.regions || []).forEach(r => {
    AppState.nova.regionState[r.name] = {
      power:      40 + Math.floor(Math.random() * 40),
      stability:  40 + Math.floor(Math.random() * 40),
      population: 30 + Math.floor(Math.random() * 50),
    };
  });

  renderMap();
  renderNovaMap();
  renderNovaInterventions();
  document.getElementById('novaYear').textContent = 'Year 0';
  document.getElementById('novaLog').innerHTML = `<div class="nova-empty">Run the simulation to begin the chronicle.</div>`;

  showScreen('main');
  setNav('map');
  setTimeout(() => runScan(false), 800);
}

// ─────────────────────────────────────────────────────────────
// MAP RENDERING
// ─────────────────────────────────────────────────────────────

function renderMap() {
  if (!hasWorld()) return;
  renderIllustratedMap(
    'worldMap',
    AppState.world,
    AppState.nova,
    (regionName) => openRegionModal(regionName)
  );
}

function renderNovaMap() {
  if (!hasWorld()) return;
  renderMiniMap('novaMap', AppState.world, AppState.nova);
}

// ─────────────────────────────────────────────────────────────
// REGION MODAL
// ─────────────────────────────────────────────────────────────

function openRegionModal(regionName) {
  const W      = AppState.world;
  if (!W) return;
  const region = (W.regions || []).find(r => r.name === regionName);
  if (!region) return;

  const simState = AppState.nova.regionState[regionName];

  // Related characters and factions
  const chars    = (W.characters || []).filter(c => c.region && c.region.toLowerCase().includes(regionName.toLowerCase().split(' ')[0].slice(0,4)));
  const factions = (W.factions   || []).filter(f => f.region && f.region.toLowerCase().includes(regionName.toLowerCase().split(' ')[0].slice(0,4)));

  document.getElementById('regionModalHeader').innerHTML = `
    <h3 id="regionModalName">${esc(region.name)}</h3>
    <span class="region-type-badge">${esc(region.type||'')}</span>
    ${simState ? `<div style="margin-top:.5rem;font-family:var(--font-mono);font-size:.72rem;color:var(--nova)">Power: ${simState.power}%  ·  Stability: ${simState.stability}%  ·  Pop: ${simState.population}%</div>` : ''}`;

  let bodyHtml = `<p>${esc(region.description || 'No description.')}</p>`;
  if (region.secret)  bodyHtml += `<div class="detail-section"><h4>Hidden Truth</h4><p>${esc(region.secret)}</p></div>`;
  if (chars.length)   bodyHtml += `<div class="detail-section"><h4>Notable Figures</h4><p>${esc(chars.map(c=>c.name).join(', '))}</p></div>`;
  if (factions.length) bodyHtml += `<div class="detail-section"><h4>Factions Present</h4><p>${esc(factions.map(f=>f.name).join(', '))}</p></div>`;

  // Nova history for this region
  const regionEvents = (AppState.nova.events || []).filter(e => e.text.toLowerCase().includes(regionName.toLowerCase().split(' ')[0].slice(0,4)));
  if (regionEvents.length) {
    bodyHtml += `<div class="detail-section"><h4>Simulation History</h4>`;
    regionEvents.slice(-3).forEach(e => { bodyHtml += `<p style="margin-bottom:.25rem"><span style="font-family:var(--font-mono);font-size:.6rem;color:var(--nova)">Year ${e.year}</span> — ${esc(e.text)}</p>`; });
    bodyHtml += `</div>`;
  }

  document.getElementById('regionModalBody').innerHTML = bodyHtml;

  // Oracle button
  const oracleBtn = document.getElementById('btnRegionOracle');
  oracleBtn.onclick = () => {
    closeRegionModal();
    oracleAbout(region.name);
  };

  document.getElementById('regionModal').classList.add('open');
}

function closeRegionModal() {
  document.getElementById('regionModal').classList.remove('open');
}

// ─────────────────────────────────────────────────────────────
// ADD ENTRY MODAL (simple text-based for post-creation)
// ─────────────────────────────────────────────────────────────

function openAddEntryModal(cat) {
  const meta = CATEGORIES[cat];
  if (!meta) return;

  // Create a simple modal inline
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.id = 'addEntryModal';
  overlay.innerHTML = `
    <div class="modal">
      <h3>Add ${meta.label.replace(/s$/,'')}</h3>
      <div class="field"><label>Name</label><input id="addName" type="text" placeholder="${meta.nameL}…"/></div>
      <div class="field"><label>Type / Role</label><input id="addType" type="text" placeholder="${meta.typeL}…"/></div>
      <div class="field"><label>Description</label><textarea id="addDesc" style="min-height:70px" placeholder="Describe this ${meta.label.replace(/s$/,'').toLowerCase()}…"></textarea></div>
      <div class="field"><label>Hidden Truth / Secret (optional)</label><input id="addSecret" type="text" placeholder="What do most people not know?"/></div>
      <div class="modal-btns">
        <button class="btn-cancel" id="addCancelBtn">Cancel</button>
        <button class="btn-generate" id="addSaveBtn">Add to World</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.getElementById('addCancelBtn').addEventListener('click', () => overlay.remove());
  document.getElementById('addSaveBtn').addEventListener('click', () => {
    const name   = document.getElementById('addName').value.trim();
    const type   = document.getElementById('addType').value.trim();
    const desc   = document.getElementById('addDesc').value.trim();
    const secret = document.getElementById('addSecret').value.trim();
    if (!name) { showToast('Give it a name first.'); return; }

    const entry = { name, description: desc, secret };
    if (type) entry[cat === 'characters' ? 'role' : cat === 'history' ? 'era' : 'type'] = type;

    if (!AppState.world[cat]) AppState.world[cat] = [];
    AppState.world[cat].push(entry);
    saveWorld();
    renderMap();
    updatePanelForCategory(cat);
    overlay.remove();
    diagLog('ok', `Added ${cat}: "${name}"`);
    showToast(`${name} added to ${meta.label}.`);
  });

  setTimeout(() => document.getElementById('addName')?.focus(), 50);
}

// ─────────────────────────────────────────────────────────────
// MAP TOOLTIP
// ─────────────────────────────────────────────────────────────

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
// NOVA CIVILIZATION SIMULATOR
// ─────────────────────────────────────────────────────────────

function renderNovaInterventions() {
  const el = document.getElementById('novaOptions');
  if (!el) return;
  el.innerHTML = INTERVENTION_OPTIONS.map(opt =>
    `<button class="nova-option-btn" data-prompt="${esc(opt.prompt)}">${esc(opt.label)}</button>`
  ).join('');
  el.querySelectorAll('.nova-option-btn').forEach(btn => {
    btn.addEventListener('click', () => applyIntervention(btn.dataset.prompt));
  });
}

/**
 * Run one simulation tick — generates an AI event and updates region states.
 */
async function runSimStep() {
  if (!hasWorld()) return;

  const W   = AppState.world;
  const sim = AppState.nova;
  sim.year += Math.floor(5 + Math.random() * 20);

  document.getElementById('novaYear').textContent = `Year ${sim.year}`;

  // Build context for this tick
  const regionSummary = (W.regions || []).map(r => {
    const s = sim.regionState[r.name] || {};
    return `${r.name} (power:${s.power||50}%, stability:${s.stability||50}%)`;
  }).join(', ');

  const recentEvents = sim.events.slice(-3).map(e => `Year ${e.year}: ${e.text}`).join(' | ');

  try {
    const raw = await callApi(
      `You are simulating the civilization history of "${W.worldName}" (${W.genre}).
World context: ${buildWorldContext()}
Current year: ${sim.year}. Region status: ${regionSummary}.
Recent history: ${recentEvents || 'None yet — this is the beginning.'}.

Generate ONE significant historical event that just happened. It should feel organic, grounded in the world's lore.
Respond ONLY with a JSON object:
{"text":"One to two sentence description of the event","type":"conflict|alliance|discovery|disaster|golden|neutral","affectedRegion":"region name if specific","powerDelta":{"regionName":+/-10},"stabilityDelta":{"regionName":+/-10}}
The powerDelta and stabilityDelta are optional objects mapping region names to numeric changes.`,
      { maxTokens: 350 }
    );

    const event = parseJsonResponse(raw);
    if (!event.text) return;

    // Apply state changes
    if (event.powerDelta) {
      Object.entries(event.powerDelta).forEach(([region, delta]) => {
        if (sim.regionState[region]) {
          sim.regionState[region].power = Math.max(5, Math.min(100, sim.regionState[region].power + delta));
        }
      });
    }
    if (event.stabilityDelta) {
      Object.entries(event.stabilityDelta).forEach(([region, delta]) => {
        if (sim.regionState[region]) {
          sim.regionState[region].stability = Math.max(5, Math.min(100, sim.regionState[region].stability + delta));
        }
      });
    }

    // Log the event
    sim.events.push({ year: sim.year, text: event.text, type: event.type || 'neutral' });
    appendNovaEvent({ year: sim.year, text: event.text, type: event.type || 'neutral' });

    // Update visuals
    renderNovaMap();
    renderMap(); // refresh power bars on main map
    updatePanelForNova();

  } catch (err) {
    diagLog('warn', `Nova step failed: ${err.message}`);
    // Fallback local event
    const regions = W.regions || [];
    const r = regions[Math.floor(Math.random() * regions.length)];
    const fallbackEvents = [
      `A harsh winter grips ${r?.name||'the land'}, straining the population.`,
      `Bandits grow bold along the roads of ${r?.name||'the borderlands'}.`,
      `A traveling scholar arrives in ${r?.name||'the capital'} bearing forgotten texts.`,
    ];
    const fallbackText = fallbackEvents[Math.floor(Math.random() * fallbackEvents.length)];
    sim.events.push({ year: sim.year, text: fallbackText, type: 'neutral' });
    appendNovaEvent({ year: sim.year, text: fallbackText, type: 'neutral' });
    updatePanelForNova();
  }
}

function appendNovaEvent(event) {
  const log = document.getElementById('novaLog');
  if (!log) return;

  // Remove empty placeholder
  const empty = log.querySelector('.nova-empty');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = `nova-event ${event.type || 'neutral'}`;
  div.innerHTML = `<div class="nova-event-year">Year ${event.year}</div><div class="nova-event-text">${esc(event.text)}</div>`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

async function applyIntervention(prompt) {
  if (!hasWorld()) return;
  const sim = AppState.nova;
  const W   = AppState.world;

  sim.year += Math.floor(1 + Math.random() * 5);
  document.getElementById('novaYear').textContent = `Year ${sim.year}`;

  try {
    const raw = await callApi(
      `You are simulating the history of "${W.worldName}". The player (god-like entity) intervenes: "${prompt}"
World context: ${buildWorldContext()}
Current year: ${sim.year}.
Describe the immediate consequence of this intervention in the world.
Respond ONLY with JSON: {"text":"2-3 sentence consequence","type":"conflict|alliance|discovery|disaster|golden|neutral","powerDelta":{"regionName":+/-15},"stabilityDelta":{"regionName":+/-15}}`,
      { maxTokens: 300 }
    );

    const event = parseJsonResponse(raw);
    if (event.powerDelta) {
      Object.entries(event.powerDelta).forEach(([region, delta]) => {
        if (sim.regionState[region]) sim.regionState[region].power = Math.max(5, Math.min(100, sim.regionState[region].power + delta));
      });
    }
    if (event.stabilityDelta) {
      Object.entries(event.stabilityDelta).forEach(([region, delta]) => {
        if (sim.regionState[region]) sim.regionState[region].stability = Math.max(5, Math.min(100, sim.regionState[region].stability + delta));
      });
    }

    const text = event.text || prompt;
    sim.events.push({ year: sim.year, text: `[INTERVENTION] ${text}`, type: 'player' });
    appendNovaEvent({ year: sim.year, text: `[INTERVENTION] ${text}`, type: 'player' });

  } catch (err) {
    sim.events.push({ year: sim.year, text: `[INTERVENTION] ${prompt}`, type: 'player' });
    appendNovaEvent({ year: sim.year, text: `[INTERVENTION] ${prompt}`, type: 'player' });
  }

  renderNovaMap();
  renderMap();
  updatePanelForNova();
  saveWorld();
}

async function applyCustomIntervention() {
  const input = document.getElementById('novaCustomInput');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';
  await applyIntervention(text);
}

function startSimulation() {
  const sim = AppState.nova;
  if (sim.running) return;
  sim.running   = true;
  sim.intervalId = setInterval(async () => {
    if (!sim.running) return;
    await runSimStep();
  }, 4000);
  document.getElementById('btnSimPlay').textContent = '⏸ Pause';
  document.getElementById('btnSimPlay').onclick = stopSimulation;
}

function stopSimulation() {
  const sim = AppState.nova;
  sim.running = false;
  clearInterval(sim.intervalId);
  sim.intervalId = null;
  document.getElementById('btnSimPlay').textContent = '▷ Run';
  document.getElementById('btnSimPlay').onclick = startSimulation;
}

function resetSimulation() {
  stopSimulation();
  const W   = AppState.world;
  const sim = AppState.nova;
  sim.year   = 0;
  sim.events = [];
  sim.regionState = {};
  (W.regions || []).forEach(r => {
    sim.regionState[r.name] = {
      power:      40 + Math.floor(Math.random() * 40),
      stability:  40 + Math.floor(Math.random() * 40),
      population: 30 + Math.floor(Math.random() * 50),
    };
  });
  document.getElementById('novaYear').textContent = 'Year 0';
  document.getElementById('novaLog').innerHTML = `<div class="nova-empty">Simulation reset. Run again to begin a new history.</div>`;
  renderNovaMap();
  renderMap();
  updatePanelForNova();
}

function exportTimeline() {
  const events = AppState.nova.events;
  if (!events.length) { showToast('Run the simulation first.'); return; }
  const text   = events.map(e => `Year ${e.year}: ${e.text}`).join('\n\n');
  const blob   = new Blob([text], { type: 'text/plain' });
  const a      = document.createElement('a');
  a.href       = URL.createObjectURL(blob);
  a.download   = `${(AppState.world?.worldName||'world').replace(/\s+/g,'_')}_timeline.txt`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─────────────────────────────────────────────────────────────
// ORACLE
// ─────────────────────────────────────────────────────────────

async function sendChat() {
  const input = document.getElementById('chatInput');
  const msg   = input.value.trim();
  if (!msg || !hasWorld()) return;

  const msgs = document.getElementById('chatMsgs');
  const btn  = document.getElementById('chatSendBtn');
  msgs.innerHTML += `<div class="msg-user">${esc(msg)}</div>`;
  input.value = ''; btn.disabled = true;

  const typing = document.createElement('div');
  typing.className = 'msg-ai msg-typing';
  typing.textContent = 'The Oracle contemplates…';
  msgs.appendChild(typing);
  msgs.scrollTop = msgs.scrollHeight;

  AppState.chatHistory.push({ role: 'user', content: msg });
  const history = AppState.chatHistory.slice(-16);

  // Add sim context to Oracle if simulation has run
  const simContext = AppState.nova.events.length
    ? ` The world has been simulated to Year ${AppState.nova.year}. Recent events: ${AppState.nova.events.slice(-3).map(e=>`Year ${e.year}: ${e.text}`).join(' | ')}.`
    : '';

  try {
    const reply = await callApi(
      `Answer this question about the world of ${AppState.world.worldName}: ${msg}`,
      {
        maxTokens: 800,
        systemPrompt: `You are the Oracle — the wise, atmospheric keeper of lore for the world of ${AppState.world.worldName}.
Context: ${buildWorldContext()}${simContext}
Respond in rich immersive prose. Be specific, drawing on actual lore. Keep answers under 300 words unless depth is needed.`,
        conversationHistory: history.slice(0, -1),
      }
    );

    AppState.chatHistory.push({ role: 'assistant', content: reply });
    typing.remove();
    msgs.innerHTML += `<div class="msg-ai">${esc(reply)}</div>`;

  } catch (err) {
    typing.remove();
    msgs.innerHTML += `<div class="msg-ai">The Oracle's vision clouds. ${esc(err.message)}</div>`;
    recordDiagError('oracle', err.message);
  }

  btn.disabled = false;
  msgs.scrollTop = msgs.scrollHeight;
}

function oracleAbout(name) {
  document.getElementById('chatInput').value = `Tell me everything about ${name}.`;
  setNav('oracle');
  sendChat();
}

function clearChat() {
  AppState.chatHistory = [];
  const W = AppState.world;
  document.getElementById('chatMsgs').innerHTML = W
    ? `<div class="msg-ai">I am the Oracle of <em>${esc(W.worldName)}</em>. Ask me anything.</div>`
    : `<div class="msg-ai">Forge a world to awaken the Oracle.</div>`;
}

// ─────────────────────────────────────────────────────────────
// SAVE / EXPORT / IMPORT
// ─────────────────────────────────────────────────────────────

function exportJSON() {
  if (!hasWorld()) { showToast('No world to export.'); return; }
  const blob = new Blob([JSON.stringify(AppState.world, null, 2)], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `${(AppState.world.worldName||'loreforge').replace(/\s+/g,'_')}_codex.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  diagLog('ok', 'World exported');
}

function importWorld(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const raw  = JSON.parse(e.target.result);
      const { valid, errors } = validateWorld(raw);
      if (!valid) throw new Error(errors.join(', '));
      AppState.world = normalizeWorld(raw);
      saveWorld();
      initWorld();
      diagLog('ok', `World "${AppState.world.worldName}" imported`);
    } catch (err) {
      showToast(`Import failed: ${err.message}`);
      diagLog('err', `Import failed: ${err.message}`);
    }
  };
  reader.readAsText(file);
}

// ─────────────────────────────────────────────────────────────
// TOAST
// ─────────────────────────────────────────────────────────────
function showToast(msg) {
  let t = document.getElementById('lf-toast');
  if (!t) {
    t = document.createElement('div'); t.id = 'lf-toast';
    t.style.cssText = 'position:fixed;top:1rem;left:50%;transform:translateX(-50%);background:#100e0a;border:1px solid var(--border);border-radius:4px;padding:.6rem 1rem;font-family:var(--font-body);font-size:.88rem;color:var(--parchment-dim);z-index:500;box-shadow:0 4px 20px rgba(0,0,0,.6)';
    document.body.appendChild(t);
  }
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._t); t._t = setTimeout(() => { t.style.display = 'none'; }, 3500);
}

// ─────────────────────────────────────────────────────────────
// EVENT BINDING
// ─────────────────────────────────────────────────────────────
function bindEvents() {
  // Welcome screen
  document.getElementById('btnNewWorld').addEventListener('click', () => {
    const key = document.getElementById('apiKey').value.trim();
    if (!key) { showToast('Enter your Anthropic API key first.'); return; }
    saveApiKey(key);
    startInterview();
  });

  document.getElementById('btnLoadWorld').addEventListener('click', () => {
    const key = document.getElementById('apiKey').value.trim();
    if (key) saveApiKey(key);
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', e => {
    if (e.target.files[0]) importWorld(e.target.files[0]);
    e.target.value = '';
  });

  // Interview wizard
  document.getElementById('btnInterviewNext').addEventListener('click', advanceInterview);
  document.getElementById('btnInterviewBack').addEventListener('click', retreatInterview);

  // Nav rail
  document.querySelectorAll('.nav-btn[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!hasWorld() && btn.dataset.nav !== 'map') return;
      setNav(btn.dataset.nav);
    });
  });

  document.querySelectorAll('.nav-btn[data-screen]').forEach(btn => {
    btn.addEventListener('click', () => showScreen(btn.dataset.screen));
  });

  // Region modal close
  document.getElementById('btnRegionClose').addEventListener('click', closeRegionModal);
  document.getElementById('regionModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeRegionModal();
  });

  // Nova controls
  document.getElementById('btnSimPlay').addEventListener('click', startSimulation);
  document.getElementById('btnSimStep').addEventListener('click', runSimStep);
  document.getElementById('btnSimReset').addEventListener('click', resetSimulation);
  document.getElementById('btnSimToggle').addEventListener('click', () => setNav('nova'));
  document.getElementById('btnNovaCustom').addEventListener('click', applyCustomIntervention);
  document.getElementById('novaCustomInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') applyCustomIntervention();
  });

  // Oracle
  document.getElementById('chatSendBtn').addEventListener('click', sendChat);
  document.getElementById('chatInput').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  document.getElementById('btnClearChat').addEventListener('click', clearChat);
  document.querySelectorAll('.oracle-prompt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.getElementById('chatInput').value = btn.dataset.q;
      setNav('oracle');
      sendChat();
    });
  });

  // Export (toolbar)
  document.getElementById('btnExport').addEventListener('click', exportJSON);

  // Diagnostics
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
  initDiagnostics();
  bindEvents();

  const savedKey = loadApiKey();
  if (savedKey) document.getElementById('apiKey').value = savedKey;

  const { world, error } = loadSavedWorld();
  if (world) {
    AppState.world = world;
    // Re-init nova state if not saved
    if (!Object.keys(AppState.nova.regionState).length) {
      (world.regions || []).forEach(r => {
        AppState.nova.regionState[r.name] = { power:50, stability:50, population:50 };
      });
    }
    initWorld();
    diagLog('ok', `Restored: "${world.worldName}"`);
  } else {
    if (error) diagLog('warn', `Restore failed: ${error}`);
    else diagLog('info', 'No saved world — showing welcome screen');
  }

  setTimeout(() => runScan(false), 1200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
