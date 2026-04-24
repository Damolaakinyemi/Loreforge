/**
 * app.js — Loreforge complete controller
 * Features: Login/register, world hub, interview + Surprise Me,
 * illustrated map, Nova sim with Oracle guidance,
 * D&D adventure mode, Oracle chat guide, save/load slots
 */
import {
  AppState, INTERVIEW_STEPS, CATEGORIES, CATEGORY_KEYS,
  DETAIL_SECTIONS, MAP_ICONS, LOAD_PHRASES, INTERVENTION_OPTIONS,
  TASTE_DIALS, STYLE_PRESETS, ORACLE_ROLES, PROPOSAL_CATEGORIES,
  ARCHETYPES,
  normalizeWorld, validateWorld, buildWorldContext,
  getEntrySubLabel, hasWorld,
  registerUser, loginUser, logoutUser, restoreSession,
  saveApiKey, loadApiKey,
  getUserSaves, saveWorldSlot, loadWorldSlot, deleteWorldSlot, saveCurrentWorld,
  saveInterviewProgress, loadInterviewProgress, clearInterviewProgress,
  saveOracleChat, loadOracleChat, clearOracleChat,
  saveAdventureState, getAdventureSaves, loadAdventureSave, deleteAdventureSave,
} from './state.js';
import {callApi as _callApi, parseJsonResponse, ApiError} from './apiService.js';

/** Wrapped callApi that tracks invocation count for cost awareness */
async function callApi(prompt, options = {}) {
  AppState.ui.apiCallCount = (AppState.ui.apiCallCount || 0) + 1;
  updateApiBadge();
  try {
    return await _callApi(prompt, options);
  } catch (err) {
    // Don't decrement — failed calls still cost
    throw err;
  }
}

/** Update the API call counter badge in the toolbar */
function updateApiBadge() {
  const el = $('apiBadge');
  if (!el) return;
  const count = AppState.ui.apiCallCount || 0;
  el.textContent = `⚡ ${count}`;
  el.title = `${count} API calls this session (rough estimate of Anthropic usage)`;
}
import {initDiagnostics,diagLog,recordDiagError,runScan,executeRepairs,openDiag,closeDiag,toggleDiag} from './diagnostics.js';
import {renderIllustratedMap,renderMiniMap} from './map.js';

const esc=s=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const $=id=>document.getElementById(id);
const showScreen=id=>{document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));$(`screen-${id}`)?.classList.add('active')};
const openModal=id=>$(id)?.classList.add('open');
const closeModal=id=>$(id)?.classList.remove('open');

/* ════════════════════════════════════════════════
   AUTH — LOGIN / REGISTER / HUB
════════════════════════════════════════════════ */
function initLogin() {
  // Tab switcher
  document.querySelectorAll('.login-tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      document.querySelectorAll('.login-tab,.login-panel').forEach(e=>e.classList.remove('active'));
      tab.classList.add('active');
      $(`panel-${tab.dataset.tab}`)?.classList.add('active');
    });
  });

  $('btnLogin').addEventListener('click',()=>{
    const u=$('loginUsername').value.trim();
    const p=$('loginPassword').value;
    $('loginError').textContent='';
    if(!u||!p){$('loginError').textContent='Enter username and password.';return;}
    const r=loginUser(u,p);
    if(!r.ok){$('loginError').textContent=r.error;return;}
    loadHub();
  });

  $('btnRegister').addEventListener('click',()=>{
    const u=$('regUsername').value.trim();
    const p=$('regPassword').value;
    $('registerError').textContent='';
    if(!u||!p){$('registerError').textContent='Choose a username and password.';return;}
    if(p.length<4){$('registerError').textContent='Password must be at least 4 characters.';return;}
    const r=registerUser(u,p);
    if(!r.ok){$('registerError').textContent=r.error;return;}
    loginUser(u,p);
    loadHub();
  });
}

function loadHub() {
  const user=AppState.currentUser;
  if(!user){showScreen('login');return;}
  $('hubUsername').textContent=user.username;
  // Show API key banner if key is missing
  const banner = $('hubApiBanner');
  if (banner) banner.style.display = loadApiKey() ? 'none' : 'flex';
  renderHubSaves();
  showScreen('hub');
}

/** Open the API key settings modal */
function openApiKeyModal() {
  const input = $('apiKeyInput');
  const status = $('apiKeyStatus');
  if (!input) return;
  const existing = loadApiKey();
  input.value = existing || '';
  if (status) {
    status.textContent = existing
      ? 'Key is set. Replace it if you want to use a different one.'
      : 'No key saved yet. Paste yours here.';
  }
  openModal('apiKeyModal');
  setTimeout(() => input.focus(), 100);
}

function renderHubSaves() {
  const saves=getUserSaves(AppState.currentUser.username);
  const container=$('hubSaves');
  const entries=Object.entries(saves);
  if(!entries.length){
    container.innerHTML='<div class="hub-empty">No worlds yet — forge your first one above.</div>';
    return;
  }
  container.innerHTML=entries.sort((a,b)=>b[1].savedAt-a[1].savedAt).map(([slotId,slot])=>`
    <div class="save-slot">
      <div class="save-slot-name">${esc(slot.name)}</div>
      <div class="save-slot-genre">${esc(slot.genre)}</div>
      <div class="save-slot-meta">Year ${slot.novaYear||0} · Saved ${new Date(slot.savedAt).toLocaleDateString()}</div>
      <div class="save-slot-actions">
        <button class="save-slot-load" data-slot="${esc(slotId)}">▷ Load</button>
        <button class="save-slot-delete" data-slot="${esc(slotId)}" title="Delete world">✕</button>
      </div>
    </div>`).join('');

  container.querySelectorAll('.save-slot-load').forEach(btn=>{
    btn.addEventListener('click',()=>loadSlotWorld(btn.dataset.slot));
  });
  container.querySelectorAll('.save-slot-delete').forEach(btn=>{
    btn.addEventListener('click',()=>{
      if(confirm('Delete this world permanently?')){
        deleteWorldSlot(AppState.currentUser.username,btn.dataset.slot);
        renderHubSaves();
      }
    });
  });
}

function loadSlotWorld(slotId) {
  const slot=loadWorldSlot(AppState.currentUser.username,slotId);
  if(!slot){showToast('Could not load world.');return;}
  AppState.world=normalizeWorld(slot.world);
  AppState.world._slotId=slotId;
  initNovaState();
  initWorld();
}

/* ════════════════════════════════════════════════
   NAVIGATION
════════════════════════════════════════════════ */
function setNav(navId) {
  AppState.activeNav=navId;
  document.querySelectorAll('.nav-btn[data-nav]').forEach(b=>b.classList.toggle('active',b.dataset.nav===navId));
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));

  const viewMap={map:'view-map',nova:'view-nova',dnd:'view-dnd',oracle:'view-oracle'};
  if(viewMap[navId]) {
    $(viewMap[navId])?.classList.add('active');
  } else {
    $('view-lore')?.classList.add('active');
  }

  switch(navId) {
    case 'map':    updatePanelMap(); break;
    case 'nova':   updatePanelNova(); break;
    case 'dnd':
      if (!AppState.adventure.active) showAdventureSetup();
      updatePanelAdventure();
      break;
    case 'oracle': updatePanelOracle(); break;
    default:       updatePanelCategory(navId);
  }
}

/* ════════════════════════════════════════════════
   PANEL CONTENT
════════════════════════════════════════════════ */
function updatePanelMap() {
  $('panelTitle').textContent='World Overview';
  $('panelSub').textContent=AppState.world?.worldName||'Your world';
  const scroll=$('panelScroll'),footer=$('panelFooter');
  if(!hasWorld()){scroll.innerHTML='';footer.innerHTML='';return;}
  const W=AppState.world;
  scroll.innerHTML=`<div style="padding:.65rem 1rem">
    <div style="font-family:var(--fd);font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:.4rem">World</div>
    <div style="font-size:.85rem;color:var(--parch-dim);line-height:1.6;margin-bottom:.9rem">${esc(W.overview||'')}</div>
    ${W.centralConflict?`<div style="font-family:var(--fd);font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:.35rem">Conflict</div><div style="font-size:.82rem;color:var(--muted);font-style:italic;line-height:1.55;margin-bottom:.9rem">${esc(W.centralConflict)}</div>`:''}
    <div style="font-family:var(--fd);font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:.4rem">Regions</div>
    ${(W.regions||[]).map(r=>`<div class="lore-item" data-region="${esc(r.name)}" style="padding:.45rem .65rem;margin-bottom:.2rem;background:rgba(255,255,255,.02);border-radius:3px;border-left:2px solid ${r.color||'#4a6a8a'}">
      <div class="lore-item-name">${esc(r.name)}</div>
      <div class="lore-item-sub">${esc(r.type||'')}</div>
    </div>`).join('')}
  </div>`;
  scroll.querySelectorAll('[data-region]').forEach(el=>el.addEventListener('click',()=>openRegionModal(el.dataset.region)));
  footer.innerHTML=`<button class="btn-add" id="btnGotoSim">◎ Start Simulation</button>`;
  $('btnGotoSim').addEventListener('click',()=>setNav('nova'));
}

function updatePanelNova() {
  $('panelTitle').textContent='Nova Sim';
  $('panelSub').textContent=`Year ${AppState.nova.year}`;
  const W=AppState.world,sim=AppState.nova;
  if(!W){$('panelScroll').innerHTML='';$('panelFooter').innerHTML='';return;}
  $('panelScroll').innerHTML=`<div style="padding:.65rem 1rem">
    ${(W.regions||[]).map(r=>{
      const rs=sim.regionState[r.name]||{power:50,stability:50};
      return `<div style="margin-bottom:.65rem">
        <div style="font-size:.72rem;color:var(--parch-dim);margin-bottom:.2rem;font-family:var(--fd);font-size:.65rem">${esc(r.name)}</div>
        <div style="height:4px;background:var(--bord-f);border-radius:2px;margin-bottom:.1rem">
          <div style="height:100%;width:${rs.power}%;background:${r.color||'#4a6a8a'};border-radius:2px;transition:width .5s"></div>
        </div>
        <div style="font-size:.6rem;color:var(--faintest)">Power ${rs.power}%  ·  Stability ${rs.stability}%</div>
      </div>`;
    }).join('')}
  </div>`;
  $('panelFooter').innerHTML=`<button class="btn-add" id="btnExportTimeline">↓ Export Timeline</button>`;
  $('btnExportTimeline').addEventListener('click',exportTimeline);
}

function updatePanelOracle() {
  $('panelTitle').textContent='The Oracle';
  $('panelSub').textContent=AppState.world?.worldName||'';
  $('panelScroll').innerHTML='';$('panelFooter').innerHTML='';
}

function updatePanelCategory(cat) {
  const meta=CATEGORIES[cat]; if(!meta) return;
  $('panelTitle').textContent=meta.label;
  $('panelSub').textContent=meta.sub;
  if(!hasWorld()){$('panelScroll').innerHTML='';$('panelFooter').innerHTML='';return;}
  const items=AppState.world[cat]??[];
  $('panelScroll').innerHTML=items.length
    ?items.map((item,i)=>`<div class="lore-item${AppState.selectedEntry?._idx===i&&AppState.selectedEntry?._cat===cat?' selected':''}" data-idx="${i}">
        <div class="lore-item-name">${esc(item.name)}</div>
        <div class="lore-item-sub">${esc(getEntrySubLabel(item))}</div>
      </div>`).join('')
    :'<div class="placeholder-msg">No entries yet.</div>';
  $('panelScroll').querySelectorAll('.lore-item').forEach(el=>el.addEventListener('click',()=>selectLoreEntry(cat,parseInt(el.dataset.idx,10))));
  $('panelFooter').innerHTML=`<button class="btn-add" id="btnAddEntry">+ Add Entry</button>`;
  $('btnAddEntry').addEventListener('click',()=>openAddEntryModal(cat));
}

function selectLoreEntry(cat,idx) {
  const item=(AppState.world[cat]??[])[idx]; if(!item) return;
  AppState.selectedEntry={...item,_idx:idx,_cat:cat};
  updatePanelCategory(cat);
  const badge=getEntrySubLabel(item);
  let html=`<div class="detail-name">${esc(item.name)}</div>`;
  if(badge) html+=`<div class="detail-badge">${esc(badge)}</div>`;
  html+=`<div class="detail-body">${esc(item.description||'No description.')}</div>`;
  DETAIL_SECTIONS.forEach(([k,l])=>{ if(item[k]) html+=`<div class="detail-section"><h4>${l}</h4><p>${esc(item[k])}</p></div>`; });
  $('loreDetailScroll').innerHTML=html;
  $('loreDetailFooter').innerHTML=`<button class="btn-detail" data-oracle="${esc(item.name)}">Ask Oracle about ${esc(item.name.split(' ')[0])} →</button>`;
  $('loreDetailFooter').querySelector('[data-oracle]').addEventListener('click',e=>oracleAbout(e.currentTarget.dataset.oracle));
}

/* ════════════════════════════════════════════════
   INTERVIEW WIZARD v2 — with dials, locks, re-rolls
════════════════════════════════════════════════ */

/** Start fresh interview OR resume existing one if available */
function startInterview(forceFresh = false) {
  const resume = forceFresh ? null : loadInterviewProgress();

  if (resume && !forceFresh) {
    // Offer resume option
    const confirmed = confirm(`You have an unfinished world in progress (${resume.answers.worldName || 'unnamed'}). Continue where you left off?\n\nOK = Resume  |  Cancel = Start fresh`);
    if (confirmed) {
      AppState.interview = {
        step:        resume.step,
        answers:     resume.answers,
        locked:      resume.locked        || {},
        tasteDials:  resume.tasteDials    || { tone:50, scale:50, familiarity:50, density:50, originality:65 },
        stylePreset: resume.stylePreset   || 'none',
        savedForResume: true,
      };
      showScreen('interview');
      renderInterviewStep();
      return;
    } else {
      clearInterviewProgress();
    }
  }

  AppState.interview = {
    step: 0,
    answers: {},
    locked: {},
    tasteDials: { tone:50, scale:50, familiarity:50, density:50, originality:65 },
    stylePreset: 'none',
    savedForResume: false,
  };
  showScreen('interview');
  renderInterviewStep();
}

function renderInterviewStep() {
  const si    = AppState.interview.step;
  const step  = INTERVIEW_STEPS[si];
  const total = INTERVIEW_STEPS.length;

  // Progress sidebar
  $('interviewProgress').innerHTML = INTERVIEW_STEPS.map((s, i) => `
    <div class="interview-step${i === si ? ' active' : ''}${i < si ? ' done' : ''}">
      <div class="step-dot">${i < si ? '✓' : i + 1}</div>
      <div class="step-info"><div class="step-name">${s.name}</div><div class="step-desc">${s.desc}</div></div>
    </div>`).join('');

  $('progressBar').style.width = `${(si / total) * 100}%`;
  $('progressLabel').textContent = `Step ${si + 1} of ${total}`;
  $('btnInterviewBack').style.visibility = si === 0 ? 'hidden' : 'visible';

  // Main content area with taste panel
  $('interviewContent').innerHTML = `
    <div class="interview-q-block">
      <div class="interview-q-step">${step.name}</div>
      <div class="interview-q-title">${step.title}</div>
      <div class="interview-q-desc">${step.intro}</div>

      <details class="taste-panel" id="tastePanel">
        <summary>
          <span class="taste-summary-text">🎛 Tune the Surprise Me dials</span>
          <span class="taste-preset-badge" id="presetBadge">${STYLE_PRESETS.find(p => p.id === AppState.interview.stylePreset)?.label || 'No preset'}</span>
        </summary>
        <div class="taste-body">
          <div class="taste-dials" id="tasteDials"></div>
          <div class="taste-presets-wrap">
            <label class="taste-preset-label">Style preset</label>
            <div class="taste-presets" id="tastePresets"></div>
          </div>
        </div>
      </details>

      <div class="interview-questions" id="stepFields"></div>
    </div>`;

  renderTasteDials();
  renderStylePresets();

  step.fields.forEach(f => renderField(f, $('stepFields'), AppState.interview.answers));
}

/** Render the 5 taste dials */
function renderTasteDials() {
  const container = $('tasteDials');
  if (!container) return;

  container.innerHTML = TASTE_DIALS.map(dial => `
    <div class="taste-dial">
      <div class="taste-dial-labels">
        <span class="taste-dial-left">${dial.left}</span>
        <span class="taste-dial-name">${dial.label}</span>
        <span class="taste-dial-right">${dial.right}</span>
      </div>
      <input type="range" min="0" max="100" value="${AppState.interview.tasteDials[dial.id]}"
             class="taste-slider" data-dial="${dial.id}"/>
    </div>`).join('');

  container.querySelectorAll('.taste-slider').forEach(s => {
    s.addEventListener('input', e => {
      AppState.interview.tasteDials[e.target.dataset.dial] = parseInt(e.target.value, 10);
    });
  });
}

/** Render the style preset pills */
function renderStylePresets() {
  const container = $('tastePresets');
  if (!container) return;

  container.innerHTML = STYLE_PRESETS.map(p => `
    <button class="taste-preset-btn${AppState.interview.stylePreset === p.id ? ' selected' : ''}"
            data-preset="${esc(p.id)}" title="${esc(p.description)}">${esc(p.label)}</button>`).join('');

  container.querySelectorAll('.taste-preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.taste-preset-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      AppState.interview.stylePreset = btn.dataset.preset;
      const preset = STYLE_PRESETS.find(p => p.id === btn.dataset.preset);
      $('presetBadge').textContent = preset?.label || 'No preset';
    });
  });
}

/**
 * Render a single interview field with re-roll, lock, and alternatives controls.
 */
function renderField(field, container, answers) {
  const w = document.createElement('div');
  w.className = 'interview-field';

  const locked = AppState.interview.locked[field.id];

  // Per-field controls (re-roll, lock, alternatives)
  const controlsHtml = `
    <div class="field-controls">
      <button class="field-ctrl-btn" data-action="reroll" data-field="${field.id}" title="Re-roll just this field">🎲</button>
      <button class="field-ctrl-btn${locked ? ' active' : ''}" data-action="lock" data-field="${field.id}" title="${locked ? 'Locked — click to unlock' : 'Lock this answer'}">${locked ? '🔒' : '🔓'}</button>
      <button class="field-ctrl-btn" data-action="alternatives" data-field="${field.id}" title="Show 3 alternatives">🔀</button>
    </div>`;

  if (field.type === 'tags') {
    const saved = answers[field.id] || '';
    w.innerHTML = `
      <div class="field-label-row">
        <label>${field.label}</label>
        ${controlsHtml}
      </div>
      <div class="tag-select">${field.options.map(o =>
        `<button class="tag-btn${saved === o ? ' selected' : ''}" data-val="${esc(o)}">${esc(o)}</button>`
      ).join('')}</div>`;
    container.appendChild(w);

    w.querySelectorAll('.tag-btn').forEach(btn => btn.addEventListener('click', () => {
      if (locked) return;
      w.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      answers[field.id] = btn.dataset.val;
      saveInterviewProgress();
    }));

  } else if (field.type === 'repeater') {
    if (!answers[field.id]) answers[field.id] = [buildEmptyItem(field)];
    w.innerHTML = `
      <div class="field-label-row">
        <label>${field.label}</label>
        ${controlsHtml}
      </div>
      <div class="repeater-list" id="rep-${field.id}"></div>
      <button class="btn-repeater-add" id="btnRepAdd-${field.id}">+ Add ${field.itemLabel}</button>`;
    container.appendChild(w);

    answers[field.id].forEach((item, i) =>
      renderRepItem(field, item, i, w.querySelector(`#rep-${field.id}`), answers));

    w.querySelector(`#btnRepAdd-${field.id}`).addEventListener('click', () => {
      if (locked) return;
      const ni = buildEmptyItem(field);
      answers[field.id].push(ni);
      renderRepItem(field, ni, answers[field.id].length - 1, w.querySelector(`#rep-${field.id}`), answers);
    });

  } else {
    const tag = field.type === 'textarea' ? 'textarea' : 'input';
    const val = answers[field.id] || '';
    w.innerHTML = `
      <div class="field-label-row">
        <label>${field.label}</label>
        ${controlsHtml}
      </div>
      <${tag} id="f-${field.id}" placeholder="${esc(field.placeholder || '')}"${field.type === 'textarea' ? ' rows="3"' : ''}${locked ? ' readonly' : ''}>${field.type === 'textarea' ? esc(val) : ''}</${tag}>`;
    container.appendChild(w);
    if (field.type !== 'textarea') w.querySelector(`#f-${field.id}`).value = val;

    w.querySelector(`#f-${field.id}`).addEventListener('input', e => {
      if (locked) return;
      answers[field.id] = e.target.value;
      saveInterviewProgress();
    });
  }

  // Wire up per-field control buttons
  w.querySelectorAll('.field-ctrl-btn').forEach(btn => {
    btn.addEventListener('click', () => handleFieldAction(btn.dataset.action, btn.dataset.field));
  });

  if (locked) w.classList.add('field-locked');
}

/** Handle the three per-field actions */
async function handleFieldAction(action, fieldId) {
  const step = INTERVIEW_STEPS[AppState.interview.step];
  const field = step.fields.find(f => f.id === fieldId);
  if (!field) return;

  if (action === 'lock') {
    AppState.interview.locked[fieldId] = !AppState.interview.locked[fieldId];
    saveInterviewProgress();
    renderInterviewStep();
    return;
  }

  if (action === 'reroll') {
    if (AppState.interview.locked[fieldId]) {
      showToast('This field is locked. Unlock it first.');
      return;
    }
    await rerollSingleField(field);
    return;
  }

  if (action === 'alternatives') {
    if (AppState.interview.locked[fieldId]) {
      showToast('This field is locked. Unlock it first.');
      return;
    }
    await showFieldAlternatives(field);
    return;
  }
}

/**
 * Re-roll a single field using AI with current taste dials applied.
 */
async function rerollSingleField(field) {
  const btn = document.querySelector(`.field-ctrl-btn[data-action="reroll"][data-field="${field.id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  try {
    const raw = await callApi(buildFieldPrompt(field), { maxTokens: 600 });
    const data = parseJsonResponse(raw);
    if (data[field.id] !== undefined) {
      AppState.interview.answers[field.id] = data[field.id];
      saveInterviewProgress();
      renderInterviewStep();
      flashField(field.id);
    }
  } catch (err) {
    showToast(`Re-roll failed: ${err.message}`);
    recordDiagError('reroll', err.message);
    if (btn) { btn.disabled = false; btn.textContent = '🎲'; }
  }
}

/**
 * Show 3 alternatives in a modal; user picks one to apply.
 */
async function showFieldAlternatives(field) {
  showToast('Generating 3 alternatives…');
  try {
    const alternatives = [];
    // Run 3 generations in parallel
    const results = await Promise.all([1, 2, 3].map(() =>
      callApi(buildFieldPrompt(field, 'Make this DIFFERENT from typical choices. Take a less-obvious angle.'), { maxTokens: 500 })
        .then(parseJsonResponse)
        .catch(() => null)
    ));

    results.forEach(r => { if (r?.[field.id] !== undefined) alternatives.push(r[field.id]); });

    if (!alternatives.length) { showToast('Could not generate alternatives — try again.'); return; }

    openAlternativesModal(field, alternatives);
  } catch (err) {
    showToast(`Alternatives failed: ${err.message}`);
  }
}

function openAlternativesModal(field, alternatives) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.innerHTML = `
    <div class="modal modal-wide">
      <h3>Pick an Alternative for ${field.label || field.id}</h3>
      <p style="font-size:.85rem;color:var(--muted);margin-bottom:1rem;font-style:italic">The Oracle offers three different takes. Pick one, or close to keep your current answer.</p>
      <div class="alt-list">
        ${alternatives.map((alt, i) => `
          <div class="alt-card" data-idx="${i}">
            <div class="alt-card-label">Option ${i + 1}</div>
            <div class="alt-card-body">${formatAlternativePreview(alt)}</div>
          </div>
        `).join('')}
      </div>
      <div class="modal-btns">
        <button class="btn-cancel" id="altCancel">Close</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#altCancel').addEventListener('click', () => overlay.remove());
  overlay.querySelectorAll('.alt-card').forEach(card => {
    card.addEventListener('click', () => {
      const idx = parseInt(card.dataset.idx, 10);
      AppState.interview.answers[field.id] = alternatives[idx];
      saveInterviewProgress();
      overlay.remove();
      renderInterviewStep();
      flashField(field.id);
    });
  });
}

function formatAlternativePreview(alt) {
  if (typeof alt === 'string') return esc(alt);
  if (Array.isArray(alt)) {
    return alt.map(item => {
      if (typeof item === 'object' && item.name) {
        return `<strong>${esc(item.name)}</strong> — ${esc(item.description || item.role || item.type || '')}`;
      }
      return esc(JSON.stringify(item));
    }).join('<br>');
  }
  return esc(JSON.stringify(alt));
}

/** Briefly highlight a field after it changes */
function flashField(fieldId) {
  // Find the field wrapper and pulse it
  setTimeout(() => {
    const labels = document.querySelectorAll('.interview-field label');
    labels.forEach(lbl => {
      const ctrlField = lbl.closest('.interview-field')?.querySelector('[data-field]');
      if (ctrlField?.dataset.field === fieldId) {
        lbl.closest('.interview-field').classList.add('field-flash');
        setTimeout(() => lbl.closest('.interview-field').classList.remove('field-flash'), 1200);
      }
    });
  }, 50);
}

/** Build a tight prompt for generating one field, applying dials + preset */
function buildFieldPrompt(field, extraInstruction = '') {
  const a = AppState.interview.answers;
  const dials = AppState.interview.tasteDials;
  const preset = STYLE_PRESETS.find(p => p.id === AppState.interview.stylePreset);

  // Describe dials in plain English
  const dialDesc = [];
  if (dials.tone < 40) dialDesc.push('dark tone');
  else if (dials.tone > 60) dialDesc.push('hopeful tone');
  if (dials.scale < 40) dialDesc.push('intimate scale');
  else if (dials.scale > 60) dialDesc.push('epic scale');
  if (dials.familiarity < 40) dialDesc.push('classic familiar feel');
  else if (dials.familiarity > 60) dialDesc.push('weird unfamiliar feel');
  if (dials.density < 40) dialDesc.push('sparse spare details');
  else if (dials.density > 60) dialDesc.push('rich dense details');
  if (dials.originality < 40) dialDesc.push('safe recognizable choices');
  else if (dials.originality > 60) dialDesc.push('bold original choices');

  const dialStr = dialDesc.length ? `\nStylistic dials: ${dialDesc.join(', ')}.` : '';
  const presetStr = preset?.id !== 'none' && preset?.description ? `\nStyle preset: ${preset.label}. ${preset.description}` : '';

  // Describe what the field expects
  let schemaHint = '';
  if (field.type === 'tags') schemaHint = `"${field.id}": one of [${field.options.map(o => `"${o}"`).join(', ')}]`;
  else if (field.type === 'textarea') schemaHint = `"${field.id}": "plain text, NO newlines, NO quotes inside"`;
  else if (field.type === 'text') schemaHint = `"${field.id}": "short plain text"`;
  else if (field.type === 'repeater') {
    const sub = field.subfields.map(sf => `"${sf.id}":"plain text"`).join(', ');
    schemaHint = `"${field.id}": [{${sub}}, ... (${field.minItems || 2}-4 items)]`;
  }

  const existing = [];
  if (a.worldName) existing.push(`World name: "${a.worldName}"`);
  if (a.genre) existing.push(`Genre: "${a.genre}"`);
  if (a.overview) existing.push(`Overview: "${a.overview.slice(0, 200)}"`);

  return `Generate content for ONE field in a world-building wizard.
${existing.length ? `Context so far:\n${existing.join('\n')}` : ''}${dialStr}${presetStr}
${extraInstruction ? `\nExtra: ${extraInstruction}` : ''}

CRITICAL JSON RULES:
- Respond with ONLY valid JSON, no commentary
- NO newlines inside string values
- NO quotes inside string values (rephrase without them)
- Keep each string under 200 characters

Return this exact shape:
{ ${schemaHint} }`;
}

function buildEmptyItem(field) { const o = {}; field.subfields.forEach(sf => { o[sf.id] = ''; }); return o; }

function renderRepItem(field, item, idx, listEl, answers) {
  const locked = AppState.interview.locked[field.id];
  const div = document.createElement('div');
  div.className = 'repeater-item';
  div.dataset.idx = idx;
  div.innerHTML = `
    <div class="repeater-item-fields">${field.subfields.map(sf =>
      `<${sf.type === 'textarea' ? 'textarea' : 'input'} data-sf="${sf.id}" placeholder="${esc(sf.placeholder || '')}"${sf.type === 'textarea' ? ' rows="2"' : ''}${locked ? ' readonly' : ''}>${sf.type === 'textarea' ? esc(item[sf.id] || '') : ''}</${sf.type === 'textarea' ? 'textarea' : 'input'}>`
    ).join('')}</div>
    <button class="repeater-remove" ${locked ? 'disabled' : ''}>✕</button>`;

  div.querySelectorAll('input').forEach(el => { el.value = item[el.dataset.sf] || ''; });
  div.querySelectorAll('input,textarea').forEach(el => el.addEventListener('input', e => {
    if (locked) return;
    answers[field.id][idx][e.target.dataset.sf] = e.target.value;
    saveInterviewProgress();
  }));
  div.querySelector('.repeater-remove').addEventListener('click', () => {
    if (locked) return;
    if ((answers[field.id]?.length || 0) <= (field.minItems || 1)) {
      showToast(`Need at least ${field.minItems || 1}.`);
      return;
    }
    answers[field.id].splice(idx, 1);
    div.remove();
    listEl.querySelectorAll('.repeater-item').forEach((el, i) => el.dataset.idx = i);
    saveInterviewProgress();
  });
  listEl.appendChild(div);
}

function collectStep() {
  const step = INTERVIEW_STEPS[AppState.interview.step];
  const answers = AppState.interview.answers;
  step.fields.forEach(f => {
    if ((f.type === 'text' || f.type === 'textarea') && !AppState.interview.locked[f.id]) {
      const el = $(`f-${f.id}`);
      if (el) answers[f.id] = el.value.trim();
    }
  });
  saveInterviewProgress();
}

function validateStep() {
  const step = INTERVIEW_STEPS[AppState.interview.step];
  const a = AppState.interview.answers;
  for (const f of step.fields) {
    if (f.id === 'worldName' && !a[f.id]) { showToast('Give your world a name first.'); return false; }
    if (f.id === 'genre' && !a[f.id]) { showToast('Choose a genre.'); return false; }
    if (f.type === 'repeater') {
      const items = a[f.id] || [];
      if (!items.some(item => Object.values(item).some(v => String(v).trim()))) {
        showToast(`Add at least one ${f.itemLabel}.`);
        return false;
      }
    }
  }
  return true;
}

async function advanceInterview() {
  collectStep();
  if (!validateStep()) return;
  if (AppState.interview.step + 1 >= INTERVIEW_STEPS.length) {
    await forgeWorldFromInterview();
  } else {
    AppState.interview.step++;
    saveInterviewProgress();
    renderInterviewStep();
  }
}

function retreatInterview() {
  if (AppState.interview.step > 0) {
    AppState.interview.step--;
    saveInterviewProgress();
    renderInterviewStep();
  }
}

/** Surprise Me — fill entire step with AI using dials + preset, with retry */
async function surpriseStep() {
  const step = INTERVIEW_STEPS[AppState.interview.step];
  const btn = $('btnSurpriseStep');
  btn.disabled = true; btn.textContent = '🎲 Generating…';

  const schemaHints = step.fields.map(f => {
    // Skip locked fields
    if (AppState.interview.locked[f.id]) return null;
    if (f.type === 'tags') return `"${f.id}": one of [${f.options.map(o => `"${o}"`).join(',')}]`;
    if (f.type === 'textarea') return `"${f.id}": "plain text NO newlines NO quotes"`;
    if (f.type === 'text') return `"${f.id}": "short plain text"`;
    if (f.type === 'repeater') {
      const sub = f.subfields.map(sf => `"${sf.id}":"plain text"`).join(', ');
      return `"${f.id}": [{${sub}}, ... (${f.minItems || 2}-4 items)]`;
    }
    return null;
  }).filter(Boolean).join(',\n  ');

  if (!schemaHints) {
    showToast('All fields in this step are locked — nothing to surprise.');
    btn.disabled = false; btn.textContent = '🎲 Surprise Me';
    return;
  }

  const dials = AppState.interview.tasteDials;
  const preset = STYLE_PRESETS.find(p => p.id === AppState.interview.stylePreset);

  const dialDesc = [];
  if (dials.tone < 40) dialDesc.push('dark');
  else if (dials.tone > 60) dialDesc.push('hopeful');
  if (dials.scale < 40) dialDesc.push('intimate');
  else if (dials.scale > 60) dialDesc.push('epic');
  if (dials.familiarity > 60) dialDesc.push('weird');
  if (dials.density > 60) dialDesc.push('rich detail');
  if (dials.originality > 60) dialDesc.push('bold original');

  const existing = [];
  const a = AppState.interview.answers;
  if (a.worldName) existing.push(`World: "${a.worldName}"`);
  if (a.genre) existing.push(`Genre: "${a.genre}"`);
  if (a.overview) existing.push(`Overview: "${a.overview.slice(0, 200)}"`);
  if (a.centralConflict) existing.push(`Conflict: "${a.centralConflict.slice(0, 150)}"`);

  // Existing locked answers the AI should RESPECT
  const lockedContext = Object.entries(AppState.interview.locked).filter(([, v]) => v).map(([k]) => {
    const val = a[k];
    if (val) return `Locked ${k}: ${typeof val === 'string' ? val.slice(0, 100) : JSON.stringify(val).slice(0, 100)}`;
    return null;
  }).filter(Boolean).join('\n');

  const MAX = 2;
  let lastErr = null;

  for (let attempt = 0; attempt < MAX; attempt++) {
    try {
      const raw = await callApi(
        `Generate creative world-building content for step "${step.name}": ${step.intro}
${existing.length ? 'Context so far:\n' + existing.join('\n') : ''}
${lockedContext ? 'MUST RESPECT these locked elements:\n' + lockedContext : ''}
${dialDesc.length ? `Style dials: ${dialDesc.join(', ')}.` : ''}
${preset?.id !== 'none' && preset?.description ? `Style preset: ${preset.label}. ${preset.description}` : ''}

CRITICAL RULES:
- Respond with ONLY valid JSON
- NO newlines in strings (use spaces)
- NO quotes inside strings (rephrase)
- Keep each string under 200 chars
- Do NOT regenerate locked fields

Return this shape:
{
  ${schemaHints}
}`,
        { maxTokens: 1000 }
      );

      const data = parseJsonResponse(raw);
      step.fields.forEach(f => {
        if (!AppState.interview.locked[f.id] && data[f.id] !== undefined) {
          AppState.interview.answers[f.id] = data[f.id];
        }
      });

      saveInterviewProgress();
      renderInterviewStep();

      const banner = document.createElement('div');
      banner.className = 'surprise-banner';
      banner.innerHTML = `🎲 The fates have decided. Review below — use 🎲 to re-roll, 🔒 to lock, 🔀 for alternatives.`;
      $('interviewContent').querySelector('.interview-q-block').insertBefore(banner, $('stepFields'));

      diagLog('ok', `Surprise Me: ${step.name}`);
      btn.disabled = false; btn.textContent = '🎲 Surprise Me';
      return;

    } catch (err) {
      lastErr = err;
      diagLog('warn', `Surprise attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < MAX - 1) await new Promise(r => setTimeout(r, 800));
    }
  }

  showToast(`Surprise failed after ${MAX} tries. Try again or fill it in yourself.`);
  recordDiagError('surprise', lastErr?.message || 'Unknown');
  btn.disabled = false; btn.textContent = '🎲 Surprise Me';
}

/* ════════════════════════════════════════════════
   WORLD FORGE
════════════════════════════════════════════════ */
async function forgeWorldFromInterview() {
  const a=AppState.interview.answers;
  showScreen('loading');
  let pi=0;
  const lt=$('loadingText');
  const iv=setInterval(()=>{lt.textContent=LOAD_PHRASES[pi++%LOAD_PHRASES.length];},2200);

  try {
    $('loadingSub').textContent='Placing regions on the map…';
    const userRegions=(a.regions||[]).filter(r=>r.name);

    const regRaw=await callApi(
      `Assign map coordinates and visual properties for these regions in world "${a.worldName}" (${a.genre}).
Regions: ${userRegions.map((r,i)=>`${i+1}. ${r.name} — ${r.type||'unknown terrain'}`).join('; ')}
Canvas is 900x580. Spread regions across the full area with good spacing. Use dark muted fantasy hex colors.
Return ONLY a JSON array, one object per region: {"name":"exact name","x":300,"y":280,"radius":70,"color":"#4a6a8a","id":"r0"}`,
      {maxTokens:600}
    );

    let coords=[];
    try {
      const cl=regRaw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
      coords=JSON.parse(cl.slice(cl.indexOf('['),cl.lastIndexOf(']')+1));
    } catch(_) {}

    const finalRegions=userRegions.map((r,i)=>{
      const c=coords.find(x=>x.name===r.name)||coords[i]||{};
      return {
        id:c.id||`r${i}`,name:r.name,type:r.type||'',description:r.description||'',secret:r.secret||'',
        x:Math.max(80,Math.min(820,parseFloat(c.x)||100+i*120)),
        y:Math.max(80,Math.min(500,parseFloat(c.y)||200+((i%2)*160))),
        radius:Math.max(50,Math.min(100,parseFloat(c.radius)||70)),
        color:c.color||['#4a6a8a','#5a4a6a','#4a6a4a','#6a4a4a','#4a5a6a','#6a5a4a'][i%6],
      };
    });

    clearInterval(iv);
    $('loadingSub').textContent='Assembling the codex…';

    const world={
      worldName:a.worldName||'Unknown World',
      genre:a.genre||'Dark Fantasy',
      tagline:a.tagline||'',
      overview:a.overview||'',
      centralConflict:a.centralConflict||'',
      darkSecret:a.darkSecret||'',
      regions:finalRegions,
      characters:(a.characters||[]).filter(c=>c.name),
      factions:(a.factions||[]).filter(f=>f.name),
      powers:[],
      history:(a.history||[]).filter(h=>h.name),
      prophecies:[],artifacts:[],
      powerName:a.powerName||'',powerHow:a.powerHow||'',
      powerCost:a.powerCost||'',powerSecret:a.powerSecret||'',
    };
    if(a.powerName) world.powers.push({name:a.powerName,category:'Core System',description:a.powerHow||'',abilities:a.powerHow||'',secret:a.powerSecret||'',history:a.powerCost||''});

    const {valid,errors}=validateWorld(world);
    if(!valid) throw new Error(errors.join('; '));

    AppState.world=normalizeWorld(world);
    saveCurrentWorld();
    clearInterviewProgress();  // Wizard complete — clear resume data
    initNovaState();
    initWorld();
    diagLog('ok',`World "${AppState.world.worldName}" forged`);

    // Oracle greeting after world creation
    setTimeout(()=>oracleProactiveGreeting(),1500);

  } catch(err) {
    clearInterval(iv);
    recordDiagError('world_forge',err.message);
    showScreen('interview');
    showToast(`World generation failed: ${err.message}`);
  }
}

function initNovaState() {
  const W = AppState.world;
  AppState.nova = {
    year: 0,
    running: false,
    events: [],
    intervalId: null,
    regionState: {},
    factionState: {},
    epoch: 'Age of Dawn',
    epochEvents: 0,
    pendingConsequences: [],
    worldThemes: [],
  };
  (W.regions || []).forEach(r => {
    AppState.nova.regionState[r.name] = {
      power:      40 + Math.floor(Math.random() * 40),
      stability:  40 + Math.floor(Math.random() * 40),
      population: 30 + Math.floor(Math.random() * 50),
      trend:      'steady',   // 'rising' | 'falling' | 'steady'
      lastChange: 0,
    };
  });
  (W.factions || []).forEach(f => {
    AppState.nova.factionState[f.name] = {
      influence:  40 + Math.floor(Math.random() * 30),
      territory:  [],
      reputation: 50,
    };
  });
}

function initWorld() {
  const W = AppState.world;
  $('mapLabel').textContent = `${W.worldName} — World Map`;
  $('oracleSubtitle').textContent = ORACLE_ROLES[AppState.oracle.role]?.description || 'Your guide';
  $('novaWorldName').textContent = W.worldName;

  // Restore persisted Oracle chat or start fresh
  const savedHistory = loadOracleChat();
  if (savedHistory.length) {
    AppState.chatHistory = savedHistory;
    const msgs = $('chatMsgs');
    msgs.innerHTML = '';
    savedHistory.forEach(m => {
      if (m.role === 'user') {
        msgs.innerHTML += `<div class="msg-user">${esc(m.content)}</div>`;
      } else {
        const { cleanReply } = extractProposal(m.content);
        msgs.innerHTML += `<div class="msg-ai">${addCitationLinks(cleanReply, W)}</div>`;
      }
    });
    msgs.innerHTML += `<div class="msg-role-change">— Chat history restored —</div>`;
    msgs.scrollTop = msgs.scrollHeight;
  } else {
    AppState.chatHistory = [];
    $('chatMsgs').innerHTML = `<div class="msg-ai">I am the Oracle of <em>${esc(W.worldName)}</em>. ${esc(W.overview || '')} Ask me anything — I am your guide, narrator, and dungeon master.</div>`;
  }

  // Citation click delegation — one listener on the container
  const chatMsgs = $('chatMsgs');
  chatMsgs.removeEventListener('click', handleCitationClick);
  chatMsgs.addEventListener('click', handleCitationClick);

  $('novaLog').innerHTML = '<div class="nova-empty">Run the simulation to begin the chronicle.</div>';
  $('novaYear').textContent = 'Year 0';
  renderOracleRoleBar();
  renderMap();
  renderMiniMapView();
  renderNovaInterventions();
  resetAdventure();
  showScreen('main');
  setNav('map');
  setTimeout(() => runScan(false), 800);
}

function handleCitationClick(e) {
  const cite = e.target.closest('.oracle-citation');
  if (cite) oracleAbout(cite.dataset.entry);
}

/* ════════════════════════════════════════════════
   MAP
════════════════════════════════════════════════ */
function renderMap() {
  if (!hasWorld()) return;
  renderIllustratedMap(
    'worldMap',
    AppState.world,
    AppState.nova,
    regionName => openRegionModal(regionName),
    AppState.ui.mapOverlay || 'illustrated'
  );
}

function renderMiniMapView() {
  if (!hasWorld()) return;
  renderMiniMap('novaMap', AppState.world, AppState.nova);
}

/** Switch map overlay mode and re-render */
function setMapOverlay(mode) {
  if (!['illustrated', 'political', 'stability'].includes(mode)) return;
  AppState.ui.mapOverlay = mode;
  document.querySelectorAll('.map-pill').forEach(p => {
    p.classList.toggle('active', p.dataset.overlay === mode);
  });
  renderMap();
}

/* ════════════════════════════════════════════════
   REGION MODAL
════════════════════════════════════════════════ */
function openRegionModal(regionName) {
  const W=AppState.world; if(!W) return;
  const region=(W.regions||[]).find(r=>r.name===regionName); if(!region) return;
  const sim=AppState.nova.regionState[regionName];
  const chars=(W.characters||[]).filter(c=>c.region?.toLowerCase().includes(regionName.toLowerCase().split(' ')[0].slice(0,4)));
  const factions=(W.factions||[]).filter(f=>f.region?.toLowerCase().includes(regionName.toLowerCase().split(' ')[0].slice(0,4)));
  const regEvents=(AppState.nova.events||[]).filter(e=>e.text.toLowerCase().includes(regionName.toLowerCase().split(' ')[0].slice(0,4)));

  $('regionModalHeader').innerHTML=`<h3>${esc(region.name)}</h3><span class="region-type-badge">${esc(region.type||'')}</span>${sim?`<div style="margin-top:.5rem;font-family:var(--fm);font-size:.72rem;color:var(--nova)">Power: ${sim.power}% · Stability: ${sim.stability}%</div>`:''}`;
  let body=`<p>${esc(region.description||'No description.')}</p>`;
  if(region.secret) body+=`<div class="detail-section"><h4>Hidden Truth</h4><p>${esc(region.secret)}</p></div>`;
  if(chars.length) body+=`<div class="detail-section"><h4>Notable Figures</h4><p>${esc(chars.map(c=>c.name).join(', '))}</p></div>`;
  if(factions.length) body+=`<div class="detail-section"><h4>Factions Present</h4><p>${esc(factions.map(f=>f.name).join(', '))}</p></div>`;
  if(regEvents.length) {
    body+=`<div class="detail-section"><h4>Recent History</h4>${regEvents.slice(-3).map(e=>`<p style="margin-bottom:.25rem"><span style="font-family:var(--fm);font-size:.6rem;color:var(--nova)">Year ${e.year}</span> — ${esc(e.text)}</p>`).join('')}</div>`;
  }
  $('regionModalBody').innerHTML=body;
  $('btnRegionOracle').onclick=()=>{closeModal('regionModal');oracleAbout(region.name);};
  $('btnRegionDnd').onclick=()=>{
    closeModal('regionModal');
    AppState.adventure.playerOrigin  = region;
    AppState.adventure.currentRegion = region.name;
    setNav('dnd');
    // After setup renders, auto-select this region's card
    setTimeout(()=>{
      const grid = $('advRegionGrid');
      if (!grid) return;
      grid.querySelectorAll('.adv-select-card').forEach(c => {
        if (c.querySelector('.adv-card-name')?.textContent === region.name) {
          grid.querySelectorAll('.adv-select-card').forEach(x => x.classList.remove('selected'));
          c.classList.add('selected');
          // Trigger the refresh button state
          const btn = $('btnAdvBegin');
          const status = $('advSelectionStatus');
          if (AppState.adventure.playerFaction && btn) {
            btn.disabled = false;
            if (status) status.textContent = `${AppState.adventure.playerFaction.name} · ${region.name} — ready to begin`;
          } else if (status) {
            status.textContent = 'Now choose your faction';
          }
        }
      });
    }, 150);
  };
  $('btnRegionClose').onclick=()=>closeModal('regionModal');
  openModal('regionModal');
}

/* ════════════════════════════════════════════════
   ADD ENTRY MODAL
════════════════════════════════════════════════ */
function openAddEntryModal(cat, prefill = {}) {
  const meta = CATEGORIES[cat]; if (!meta) return;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay open';
  overlay.innerHTML = `<div class="modal">
    <h3>Add ${meta.label.replace(/s$/, '')}</h3>
    <div class="field"><label>Name</label><input id="addName" type="text" placeholder="${meta.nameL}…"/></div>
    <div class="field"><label>Type / Role</label><input id="addType" type="text" placeholder="${meta.typeL}…"/></div>
    <div class="field"><label>Description</label><textarea id="addDesc" style="min-height:70px" placeholder="Describe this…"></textarea></div>
    <div class="field"><label>Secret (optional)</label><input id="addSecret" type="text" placeholder="What do most people not know?"/></div>
    <div class="modal-btns">
      <button class="btn-cancel" id="addCancelBtn">Cancel</button>
      <button class="btn-generate" id="addSaveBtn">Add to World</button>
    </div>
  </div>`;
  document.body.appendChild(overlay);

  // Pre-fill from proposal if provided
  if (prefill.name)        overlay.querySelector('#addName').value        = prefill.name;
  if (prefill.description) overlay.querySelector('#addDesc').value        = prefill.description;
  if (prefill.secret)      overlay.querySelector('#addSecret').value      = prefill.secret;
  if (prefill.role||prefill.type) overlay.querySelector('#addType').value = prefill.role || prefill.type || '';

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('#addCancelBtn').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#addSaveBtn').addEventListener('click', () => {
    const name   = overlay.querySelector('#addName').value.trim();
    if (!name) { showToast('Give it a name first.'); return; }
    const type   = overlay.querySelector('#addType').value.trim();
    const desc   = overlay.querySelector('#addDesc').value.trim();
    const secret = overlay.querySelector('#addSecret').value.trim();
    const entry  = { name, description: desc, secret };
    if (type) entry[cat === 'characters' ? 'role' : cat === 'history' ? 'era' : 'type'] = type;
    if (!AppState.world[cat]) AppState.world[cat] = [];
    AppState.world[cat].push(entry);
    saveCurrentWorld(); renderMap(); updatePanelCategory(cat); overlay.remove();
    showToast(`${name} added to ${meta.label}.`);
  });
  setTimeout(() => overlay.querySelector('#addName')?.focus(), 50);
}

/* ════════════════════════════════════════════════
   NOVA SIMULATION
════════════════════════════════════════════════ */
function renderNovaInterventions() {
  const el=$('novaOptions'); if(!el) return;
  el.innerHTML=INTERVENTION_OPTIONS.map(opt=>`<button class="nova-option-btn" data-prompt="${esc(opt.prompt)}">${esc(opt.label)}</button>`).join('');
  el.querySelectorAll('.nova-option-btn').forEach(btn=>btn.addEventListener('click',()=>applyIntervention(btn.dataset.prompt)));
}

async function runSimStep() {
  if (!hasWorld()) return;
  const W = AppState.world, sim = AppState.nova;
  const yearsPassed = Math.floor(5 + Math.random() * 20);
  sim.year += yearsPassed;
  sim.epochEvents++;
  $('novaYear').textContent = `Year ${sim.year}`;

  // Build a rich state summary that tells the AI about momentum
  const regionDetails = (W.regions || []).map(r => {
    const s = sim.regionState[r.name] || {};
    const trend = s.trend === 'rising' ? 'RISING' : s.trend === 'falling' ? 'DECLINING' : 'stable';
    return `${r.name} [power:${s.power || 50}% ${trend}, stab:${s.stability || 50}%]`;
  }).join(', ');

  // Last 6 events for strong continuity
  const recentEvts = sim.events.slice(-6).map(e => `Yr${e.year}: ${e.text}`).join(' | ');

  // Identify the most at-risk region for targeted storytelling
  const weakestRegion = Object.entries(sim.regionState || {})
    .sort((a, b) => a[1].stability - b[1].stability)[0];
  const strongestRegion = Object.entries(sim.regionState || {})
    .sort((a, b) => b[1].power - a[1].power)[0];

  const focusHint = sim.epochEvents < 3
    ? `This is early in the ${sim.epoch} — establish tone and introduce lingering tensions.`
    : weakestRegion && weakestRegion[1].stability < 30
      ? `FOCUS: ${weakestRegion[0]} is near collapse (${weakestRegion[1].stability}% stability). Escalate its crisis.`
      : strongestRegion && strongestRegion[1].power > 80
        ? `FOCUS: ${strongestRegion[0]} is dominant (${strongestRegion[1].power}% power). Show the consequences of its rise.`
        : `Advance existing threads — the recent events MUST have consequences now.`;

  try {
    const raw = await callApi(
      `You are simulating the civilization history of "${W.worldName}" (${W.genre}).

WORLD LORE: ${buildWorldContext()}

SIMULATION STATE:
Year ${sim.year} of the ${sim.epoch}. ${sim.epochEvents} events in this epoch.
Region momentum: ${regionDetails}
Recent history (chronological): ${recentEvts || 'This is the beginning.'}
${sim.pendingConsequences?.length ? `Tension threads: ${sim.pendingConsequences.map(c => c.description).join(', ')}` : ''}

DIRECTIVE: ${focusHint}

RULES:
1. The new event MUST explicitly build on or respond to at least one recent event — reference it directly if possible. No isolated events.
2. Name specific factions, regions, or characters from the world lore. No generic "a kingdom" or "a warrior."
3. Power and stability changes must be realistic — usually 3-15 points, rarely more.
4. If recent events pointed toward war/plague/discovery, follow through now.

Return ONLY valid JSON:
{
  "text": "1-2 sentence event that references recent history",
  "type": "conflict|alliance|discovery|disaster|golden|neutral",
  "causedBy": "one phrase describing which recent event or trend led to this",
  "powerDelta": {"regionName": 10, "regionName2": -5},
  "stabilityDelta": {"regionName": -8},
  "newTheme": "optional: one-word emerging theme if this is a turning point (e.g. 'betrayal', 'decline', 'awakening') or empty string",
  "pendingConsequence": "optional: describe an event that should happen within 3-5 more steps as a result of this, or empty string"
}`,
      { maxTokens: 400 }
    );

    const ev = parseJsonResponse(raw);
    if (!ev.text) return;

    applySimDeltas(ev);
    updateRegionTrends();

    // Record event with metadata
    sim.events.push({
      year: sim.year,
      text: ev.text,
      type: ev.type || 'neutral',
      causedBy: ev.causedBy || null,
    });
    appendNovaEvent({ year: sim.year, text: ev.text, type: ev.type || 'neutral', causedBy: ev.causedBy });

    // Track emerging themes
    if (ev.newTheme && ev.newTheme.trim()) {
      sim.worldThemes.push(ev.newTheme.trim());
      if (sim.worldThemes.length > 8) sim.worldThemes.shift();
    }

    // Track pending consequences
    if (ev.pendingConsequence && ev.pendingConsequence.trim()) {
      sim.pendingConsequences.push({
        description: ev.pendingConsequence.trim(),
        createdYear: sim.year,
      });
      if (sim.pendingConsequences.length > 5) sim.pendingConsequences.shift();
    }

    // Clean up old pending consequences (over 100 years stale)
    sim.pendingConsequences = sim.pendingConsequences.filter(c => sim.year - c.createdYear < 100);

    // Epoch transition every ~15 events
    if (sim.epochEvents >= 15) {
      advanceEpoch();
    }

    if (sim.events.length % 5 === 0) novaOracleCheck();

  } catch (_) {
    const r = (W.regions || [])[Math.floor(Math.random() * (W.regions || []).length)];
    const fb = [
      `A harsh season grips ${r?.name || 'the land'}.`,
      `Tensions rise along the borders of ${r?.name || 'the realm'}.`,
      `A mysterious wanderer arrives in ${r?.name || 'the capital'}.`,
    ];
    const text = fb[Math.floor(Math.random() * fb.length)];
    sim.events.push({ year: sim.year, text, type: 'neutral' });
    appendNovaEvent({ year: sim.year, text, type: 'neutral' });
  }

  renderMiniMapView();
  renderMap();
  updatePanelNova();
  saveCurrentWorld();
}

/** Update each region's trend based on recent power changes */
function updateRegionTrends() {
  const sim = AppState.nova;
  const recentWindow = 3;

  Object.entries(sim.regionState).forEach(([name, state]) => {
    // Look at last N events affecting this region
    const impacts = sim.events
      .slice(-recentWindow)
      .filter(e => e.text.toLowerCase().includes(name.toLowerCase().split(' ')[0].slice(0, 5)));

    if (impacts.length >= 2) {
      const lastChange = state.lastChange || 0;
      state.trend = lastChange > 5 ? 'rising' : lastChange < -5 ? 'falling' : 'steady';
    } else {
      state.trend = 'steady';
    }
  });
}

/** Advance to next epoch when enough events have accumulated */
async function advanceEpoch() {
  const sim = AppState.nova;
  try {
    const raw = await callApi(
      `Name the next epoch of this world. Current: "${sim.epoch}". Recent themes: ${sim.worldThemes.slice(-5).join(', ') || 'none'}. Recent events: ${sim.events.slice(-5).map(e => e.text).join(' | ')}.
Return ONLY JSON: {"epochName":"The Age of X","reason":"one sentence why this era begins now"}`,
      { maxTokens: 150 }
    );
    const e = parseJsonResponse(raw);
    if (e.epochName) {
      sim.epoch = e.epochName;
      sim.epochEvents = 0;
      // Log the epoch transition as a special event
      sim.events.push({
        year: sim.year,
        text: `━━━ ${e.epochName} begins. ${e.reason || ''} ━━━`,
        type: 'golden',
      });
      appendNovaEvent({
        year: sim.year,
        text: `━━━ ${e.epochName} begins. ${e.reason || ''} ━━━`,
        type: 'golden',
      });
    }
  } catch (_) { /* silent fail, keep current epoch */ }
}

function applySimDeltas(ev) {
  const sim = AppState.nova;
  if (ev.powerDelta) {
    Object.entries(ev.powerDelta).forEach(([r, d]) => {
      if (sim.regionState[r]) {
        const delta = parseInt(d, 10) || 0;
        sim.regionState[r].power = Math.max(5, Math.min(100, sim.regionState[r].power + delta));
        sim.regionState[r].lastChange = delta;
      }
    });
  }
  if (ev.stabilityDelta) {
    Object.entries(ev.stabilityDelta).forEach(([r, d]) => {
      if (sim.regionState[r]) {
        const delta = parseInt(d, 10) || 0;
        sim.regionState[r].stability = Math.max(5, Math.min(100, sim.regionState[r].stability + delta));
      }
    });
  }
}

function appendNovaEvent(ev) {
  const log = $('novaLog');
  if (!log) return;
  log.querySelector('.nova-empty')?.remove();
  const div = document.createElement('div');
  div.className = `nova-event ${ev.type || 'neutral'}`;
  const causeHtml = ev.causedBy ? `<div class="nova-event-cause">↳ ${esc(ev.causedBy)}</div>` : '';
  div.innerHTML = `<div class="nova-event-year">Year ${ev.year}</div><div class="nova-event-text">${esc(ev.text)}</div>${causeHtml}`;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

/** Oracle proactively surfaces guidance during simulation */
async function novaOracleCheck() {
  const strip=$('novaOracleStrip'); if(!strip) return;
  const sim=AppState.nova,W=AppState.world;
  // Find most stressed region
  const stressed=Object.entries(sim.regionState).sort((a,b)=>a[1].stability-b[1].stability)[0];
  const msg=stressed&&stressed[1].stability<30
    ?`${stressed[0]} is on the brink — stability at ${stressed[1].stability}%. Intervene before it collapses.`
    :`Year ${sim.year}: ${sim.events.length} events have shaped your world. What will you do next?`;
  $('novaOracleMsg').textContent=msg;
  strip.style.display='flex';
  $('btnNovaOracleAsk').onclick=()=>{
    strip.style.display='none';
    setNav('oracle');
    document.getElementById('chatInput').value=`It's Year ${sim.year}. ${msg} What should I do?`;
    sendChat();
  };
}

async function applyIntervention(prompt) {
  if(!hasWorld()) return;
  const sim=AppState.nova,W=AppState.world;
  sim.year+=Math.floor(1+Math.random()*5);
  $('novaYear').textContent=`Year ${sim.year}`;
  try {
    const raw=await callApi(
      `World "${W.worldName}" — player intervenes: "${prompt}"
Context: ${buildWorldContext()} Year: ${sim.year}.
Describe the consequence. Return ONLY JSON:
{"text":"2-3 sentence consequence","type":"conflict|alliance|discovery|disaster|golden|neutral","powerDelta":{"regionName":15},"stabilityDelta":{"regionName":-10}}`,
      {maxTokens:300}
    );
    const ev=parseJsonResponse(raw);
    applySimDeltas(ev);
    const text=ev.text||prompt;
    sim.events.push({year:sim.year,text:`[INTERVENTION] ${text}`,type:'player'});
    appendNovaEvent({year:sim.year,text:`[INTERVENTION] ${text}`,type:'player'});
  } catch(_) {
    sim.events.push({year:sim.year,text:`[INTERVENTION] ${prompt}`,type:'player'});
    appendNovaEvent({year:sim.year,text:`[INTERVENTION] ${prompt}`,type:'player'});
  }
  renderMiniMapView(); renderMap(); updatePanelNova(); saveCurrentWorld();
}

async function applyCustomIntervention() {
  const input=$('novaCustomInput'),text=input.value.trim(); if(!text) return;
  input.value=''; await applyIntervention(text);
}

function startSimulation() {
  const sim=AppState.nova; if(sim.running) return;
  sim.running=true;
  sim.intervalId=setInterval(async()=>{if(!sim.running)return;await runSimStep();},4500);
  $('btnSimPlay').textContent='⏸ Pause';
  $('btnSimPlay').onclick=stopSimulation;
}

function stopSimulation() {
  const sim=AppState.nova; sim.running=false; clearInterval(sim.intervalId); sim.intervalId=null;
  $('btnSimPlay').textContent='▷ Run'; $('btnSimPlay').onclick=startSimulation;
}

function resetSimulation() {
  stopSimulation(); initNovaState();
  $('novaYear').textContent='Year 0';
  $('novaLog').innerHTML='<div class="nova-empty">Simulation reset. Run again to begin a new history.</div>';
  $('novaOracleStrip').style.display='none';
  renderMiniMapView(); renderMap(); updatePanelNova();
}

function exportTimeline() {
  const evts=AppState.nova.events;
  if(!evts.length){showToast('Run the simulation first.');return;}
  const text=evts.map(e=>`Year ${e.year}: ${e.text}`).join('\n\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type:'text/plain'}));
  a.download=`${(AppState.world?.worldName||'world').replace(/\s+/g,'_')}_timeline.txt`;
  a.click(); URL.revokeObjectURL(a.href);
}

/* ════════════════════════════════════════════════
   ADVENTURE MODE v2 — lore-grounded choose-your-story
════════════════════════════════════════════════ */

/**
 * Show the adventure setup screen — faction and origin selection.
 * Called when the user navigates to the adventure view.
 */
function showAdventureSetup() {
  const W = AppState.world;
  if (!W) return;

  // Show setup overlay, hide game
  const setup = $('advSetup'), game = $('advGame');
  if (setup) setup.style.display = 'block';
  if (game)  game.classList.remove('visible');

  // Helper: update begin button and status text
  function refreshBeginBtn() {
    const btn    = $('btnAdvBegin');
    const status = $('advSelectionStatus');
    const hasFac = !!AppState.adventure.playerFaction;
    const hasReg = !!AppState.adventure.playerOrigin;
    const hasArc = !!AppState.adventure.playerArchetype;

    if (btn) btn.disabled = !(hasFac && hasReg && hasArc);
    if (status) {
      const missing = [];
      if (!hasFac) missing.push('faction');
      if (!hasReg) missing.push('origin');
      if (!hasArc) missing.push('archetype');
      if (missing.length) {
        status.textContent = `Choose your ${missing.join(', ')} to begin`;
        status.style.color = 'var(--faint)';
      } else {
        const a = AppState.adventure;
        status.textContent = `✦ ${a.playerArchetype.label} · ${a.playerFaction.name} · from ${a.playerOrigin.name}`;
        status.style.color = 'var(--gold-dim)';
      }
    }
  }

  // Render faction cards
  const factions = W.factions || [];
  const factionGrid = $('advFactionGrid');
  if (factionGrid) {
    if (!factions.length) {
      factionGrid.innerHTML = '<div class="adv-empty-note">No factions defined. Add factions in the Factions lore panel first, then return here.</div>';
    } else {
      factionGrid.innerHTML = factions.map((f, i) => `
        <div class="adv-select-card${AppState.adventure.playerFaction?.name === f.name ? ' selected' : ''}" data-type="faction" data-idx="${i}">
          <div class="adv-card-name">${esc(f.name)}</div>
          <div class="adv-card-sub">${esc(f.type || '')}</div>
          <div class="adv-card-desc">${esc((f.motivation || f.description || '').slice(0, 110))}</div>
        </div>`).join('');

      factionGrid.querySelectorAll('.adv-select-card').forEach(card => {
        card.addEventListener('click', () => {
          factionGrid.querySelectorAll('.adv-select-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          AppState.adventure.playerFaction = factions[parseInt(card.dataset.idx, 10)];
          refreshBeginBtn();
        });
      });
    }
  }

  // Render region cards
  const regions = W.regions || [];
  const regionGrid = $('advRegionGrid');
  if (regionGrid) {
    if (!regions.length) {
      regionGrid.innerHTML = '<div class="adv-empty-note">No regions defined.</div>';
    } else {
      regionGrid.innerHTML = regions.map((r, i) => `
        <div class="adv-select-card${AppState.adventure.playerOrigin?.name === r.name ? ' selected' : ''}" data-type="region" data-idx="${i}" style="border-left-color:${r.color || 'var(--bord-f)'}">
          <div class="adv-card-name">${esc(r.name)}</div>
          <div class="adv-card-sub">${esc(r.type || '')}</div>
          <div class="adv-card-desc">${esc((r.description || '').slice(0, 110))}</div>
        </div>`).join('');

      regionGrid.querySelectorAll('.adv-select-card').forEach(card => {
        card.addEventListener('click', () => {
          regionGrid.querySelectorAll('.adv-select-card').forEach(c => c.classList.remove('selected'));
          card.classList.add('selected');
          const r = regions[parseInt(card.dataset.idx, 10)];
          AppState.adventure.playerOrigin  = r;
          AppState.adventure.currentRegion = r.name;
          refreshBeginBtn();
        });
      });
    }
  }

  // Render archetype cards
  const archetypeGrid = $('advArchetypeGrid');
  if (archetypeGrid) {
    archetypeGrid.innerHTML = ARCHETYPES.map((arch) => `
      <div class="adv-archetype-card${AppState.adventure.playerArchetype?.id === arch.id ? ' selected' : ''}" data-arch="${arch.id}">
        <div class="adv-arch-icon">${arch.icon}</div>
        <div class="adv-arch-name">${esc(arch.label)}</div>
        <div class="adv-arch-desc">${esc(arch.description)}</div>
      </div>`).join('');

    archetypeGrid.querySelectorAll('.adv-archetype-card').forEach(card => {
      card.addEventListener('click', () => {
        archetypeGrid.querySelectorAll('.adv-archetype-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        const arch = ARCHETYPES.find(a => a.id === card.dataset.arch);
        AppState.adventure.playerArchetype = arch;
        renderAttributeTriangle(arch);
        refreshBeginBtn();
      });
    });

    // If an archetype was already selected (e.g. resume), render the triangle
    if (AppState.adventure.playerArchetype) {
      renderAttributeTriangle(AppState.adventure.playerArchetype);
    }
  }

  refreshBeginBtn();
}

/**
 * Draw an attribute shape as an SVG polygon.
 * Four attributes = diamond (top, right, bottom, left).
 * Each attribute extends from center proportional to its value / 50.
 */
function renderAttributeTriangle(archetype) {
  const container = $('advAttributeDisplay');
  const svg       = $('advAttributeTriangle');
  const titleEl   = $('advAttributeTitle');
  if (!svg || !container) return;

  container.style.display = 'block';
  if (titleEl) titleEl.textContent = `${archetype.icon} ${archetype.label} — Attribute Shape`;

  const stats = archetype.stats;
  const cx = 110, cy = 110, maxR = 80;

  // Four cardinal points: top = strength, right = speed, bottom = intelligence, left = dexterity
  const pts = [
    { key: 'strength',     angle: -Math.PI / 2 },
    { key: 'speed',        angle: 0 },
    { key: 'intelligence', angle: Math.PI / 2 },
    { key: 'dexterity',    angle: Math.PI },
  ];

  const pathPoints = pts.map(p => {
    const v = stats[p.key] || 0;
    const r = (v / 50) * maxR;
    return [cx + Math.cos(p.angle) * r, cy + Math.sin(p.angle) * r];
  });

  const NS = 'http://www.w3.org/2000/svg';
  svg.innerHTML = '';

  // Background grid diamond (max reference shape at 50 each = perfectly balanced)
  const maxPts = pts.map(p => [cx + Math.cos(p.angle) * maxR, cy + Math.sin(p.angle) * maxR]);
  const maxPath = document.createElementNS(NS, 'polygon');
  maxPath.setAttribute('points', maxPts.map(p => p.join(',')).join(' '));
  maxPath.setAttribute('fill', 'rgba(201,168,76,0.04)');
  maxPath.setAttribute('stroke', 'rgba(201,168,76,0.2)');
  maxPath.setAttribute('stroke-width', '1');
  maxPath.setAttribute('stroke-dasharray', '3 3');
  svg.appendChild(maxPath);

  // Axis lines from center to each corner
  pts.forEach(p => {
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', cx);
    line.setAttribute('y1', cy);
    line.setAttribute('x2', cx + Math.cos(p.angle) * maxR);
    line.setAttribute('y2', cy + Math.sin(p.angle) * maxR);
    line.setAttribute('stroke', 'rgba(201,168,76,0.15)');
    line.setAttribute('stroke-width', '0.8');
    svg.appendChild(line);
  });

  // Stat shape — filled polygon
  const shape = document.createElementNS(NS, 'polygon');
  shape.setAttribute('points', pathPoints.map(p => p.join(',')).join(' '));
  shape.setAttribute('fill', 'rgba(201,168,76,0.25)');
  shape.setAttribute('stroke', 'var(--gold)');
  shape.setAttribute('stroke-width', '1.5');
  svg.appendChild(shape);

  // Stat labels and values
  pts.forEach((p, i) => {
    const lblR = maxR + 18;
    const lx = cx + Math.cos(p.angle) * lblR;
    const ly = cy + Math.sin(p.angle) * lblR;

    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', lx);
    label.setAttribute('y', ly - 5);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('fill', 'var(--gold-dim)');
    label.setAttribute('font-family', 'Cinzel, serif');
    label.setAttribute('font-size', '9');
    label.setAttribute('letter-spacing', '1');
    label.textContent = p.key.toUpperCase().slice(0, 3);
    svg.appendChild(label);

    const val = document.createElementNS(NS, 'text');
    val.setAttribute('x', lx);
    val.setAttribute('y', ly + 7);
    val.setAttribute('text-anchor', 'middle');
    val.setAttribute('fill', 'var(--gold)');
    val.setAttribute('font-family', 'Courier New, monospace');
    val.setAttribute('font-size', '11');
    val.setAttribute('font-weight', '600');
    val.textContent = stats[p.key];
    svg.appendChild(val);

    // Dot at actual point
    const dot = document.createElementNS(NS, 'circle');
    dot.setAttribute('cx', pathPoints[i][0]);
    dot.setAttribute('cy', pathPoints[i][1]);
    dot.setAttribute('r', '3');
    dot.setAttribute('fill', 'var(--gold)');
    svg.appendChild(dot);
  });
}

/** Reset adventure to setup state. Preserves legacyChain unless fullReset is true. */
function resetAdventure(fullReset = false) {
  const preservedLegacy = fullReset ? [] : (AppState.adventure.legacyChain || []);
  AppState.adventure = {
    active: false, chapter: 0, playerName: '', playerFaction: null,
    playerOrigin: null, playerBg: '', playerArchetype: null,
    factionStanding: {}, currentRegion: null, history: [],
    currentChoices: [], worldImpacts: [],
    npcs: {}, environment: {},
    legacyChain: preservedLegacy,
  };
  AppState.adventureInventory = {
    items: [], health: 100, maxHealth: 100, keyInsights: [], achievements: [],
  };
  const setup = $('advSetup'), game = $('advGame');
  if (setup) setup.style.display = 'block';
  if (game)  game.classList.remove('visible');
  if (hasWorld()) showAdventureSetup();
}

/** Begin the adventure after setup is complete */
async function beginAdventure() {
  const W   = AppState.world;
  const adv = AppState.adventure;

  if (!adv.playerFaction)   { showToast('Choose your faction first.'); return; }
  if (!adv.playerOrigin)    { showToast('Choose your origin region first.'); return; }
  if (!adv.playerArchetype) { showToast('Choose your archetype first.'); return; }

  // Collect name and background from inputs
  adv.playerName = $('advPlayerName')?.value.trim() || '';
  adv.playerBg   = $('advPlayerBg')?.value.trim()   || '';
  adv.active     = true;
  adv.chapter    = 1;

  // Initialize faction standings
  adv.factionStanding = {};
  (W.factions || []).forEach(f => {
    adv.factionStanding[f.name] = f.name === adv.playerFaction.name ? 25 : 0;
  });

  // Fresh NPC roster and environment cache for this run
  adv.npcs        = {};
  adv.environment = {};

  // Max health gets a small bonus from strength attribute
  const strengthBonus = Math.round((adv.playerArchetype.stats.strength - 25) / 2);
  const maxHealth = Math.max(50, Math.min(150, 100 + strengthBonus));
  AppState.adventureInventory = {
    items: [], health: maxHealth, maxHealth, keyInsights: [], achievements: [],
  };

  // Switch panels
  const setup = $('advSetup'), game = $('advGame');
  if (setup) setup.style.display = 'none';
  if (game)  game.classList.add('visible');

  renderAdventureCharacterCard();
  renderFactionStandings();
  renderAdventureHealth();
  renderAdventureInventory();
  renderAdventureNpcs();
  renderAdventureEnvironment();

  // Generate 2 starter items specific to this character before the story begins
  await generateStarterItems();

  // Then open the first scene
  await generateAdventureScene('OPENING', null);
}

/**
 * Ask the Oracle to create 2 starter items specific to archetype + faction + origin.
 * Each item includes description, history, and what it's useful for.
 */
async function generateStarterItems() {
  const W   = AppState.world;
  const adv = AppState.adventure;

  $('advNarrative').innerHTML = '<div class="adv-loading">The Oracle gathers what you carry into this story…</div>';

  try {
    const raw = await callApi(
      `For an adventure in "${W.worldName}" (${W.genre}), generate 2 STARTING items for this character:
Archetype: ${adv.playerArchetype.label} (${adv.playerArchetype.description})
Faction: ${adv.playerFaction.name} (${adv.playerFaction.type || 'unknown type'}) — motivation: ${adv.playerFaction.motivation || 'unknown'}
Origin: ${adv.playerOrigin.name} (${adv.playerOrigin.type || 'unknown terrain'})
${adv.playerBg ? `Personal detail: ${adv.playerBg}` : ''}

The items must be SPECIFIC to this character's background — not generic. Include one practical item and one meaningful/personal item.

Return ONLY valid JSON:
{
  "items": [
    {
      "name": "Specific named item (not generic)",
      "description": "1-2 sentences about what it looks like and its basic use",
      "history": "1-2 sentences about where it came from or what happened to its previous owner",
      "usefulFor": "1 sentence about specific situations where it helps"
    },
    {
      "name": "...",
      "description": "...",
      "history": "...",
      "usefulFor": "..."
    }
  ]
}`,
      { maxTokens: 600 }
    );

    const data = parseJsonResponse(raw);
    const items = Array.isArray(data.items) ? data.items : [];

    items.slice(0, 2).forEach((it) => {
      if (!it.name) return;
      AppState.adventureInventory.items.push({
        name:            String(it.name),
        description:     String(it.description || ''),
        history:         String(it.history || ''),
        usefulFor:       String(it.usefulFor || ''),
        obtainedChapter: 0,
        isStarter:       true,
      });
    });

    renderAdventureInventory();
  } catch (err) {
    // If item generation fails, insert generic fallbacks so game continues
    AppState.adventureInventory.items.push(
      { name: 'Traveler\'s Pack',  description: 'A worn leather pack with basic supplies.', history: 'You\'ve carried it since leaving home.', usefulFor: 'Long journeys and storing what you find.', obtainedChapter: 0, isStarter: true },
      { name: 'Personal Token',    description: 'A keepsake from your past.',                history: 'Given to you by someone who mattered.',   usefulFor: 'Reminding you who you are.',                   obtainedChapter: 0, isStarter: true }
    );
    renderAdventureInventory();
    diagLog('warn', `Starter items fallback used: ${err.message}`);
  }
}

/** Render the health bar */
function renderAdventureHealth() {
  const inv = AppState.adventureInventory;
  const container = $('advHealthBar');
  if (!container) return;
  const pct = Math.max(0, Math.min(100, (inv.health / inv.maxHealth) * 100));
  const color = pct > 60 ? 'var(--ok)' : pct > 30 ? 'var(--warn)' : 'var(--err)';
  const label = pct > 75 ? 'Strong' : pct > 50 ? 'Wounded' : pct > 25 ? 'Bleeding' : pct > 0 ? 'Dying' : 'Fallen';
  container.innerHTML = `
    <div class="adv-health-head">
      <span class="adv-health-label">Condition</span>
      <span class="adv-health-value" style="color:${color}">${label} · ${inv.health}/${inv.maxHealth}</span>
    </div>
    <div class="adv-health-track">
      <div class="adv-health-fill" style="width:${pct}%;background:${color}"></div>
    </div>`;
}

/** Render the inventory list — items are clickable to see full details */
function renderAdventureInventory() {
  const inv = AppState.adventureInventory;
  const container = $('advInventory');
  if (!container) return;

  const hasItems    = inv.items.length > 0;
  const hasInsights = inv.keyInsights.length > 0;

  if (!hasItems && !hasInsights) {
    container.innerHTML = '';
    return;
  }

  let html = '';
  if (hasItems) {
    html += `<div class="adv-inv-head">Inventory</div>`;
    html += `<div class="adv-inv-items">${inv.items.map((item, i) => `
      <div class="adv-inv-item" data-item-idx="${i}">
        <span class="adv-inv-icon">◆</span>
        <span class="adv-inv-name">${esc(item.name)}</span>
        <span class="adv-inv-chapter">${item.isStarter ? 'Starter' : `Ch.${item.obtainedChapter || '?'}`}</span>
      </div>`).join('')}</div>`;
  }
  if (hasInsights) {
    html += `<div class="adv-inv-head">Insights</div>`;
    html += `<div class="adv-inv-insights">${inv.keyInsights.slice(-4).map(ins => `
      <div class="adv-inv-insight" title="${esc(ins.text)}">☽ ${esc(ins.text)}</div>`).join('')}</div>`;
  }
  container.innerHTML = html;

  // Wire click handlers — show full item details in modal
  container.querySelectorAll('.adv-inv-item').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.dataset.itemIdx, 10);
      const item = inv.items[idx];
      if (item) showItemDetail(item, false);
    });
  });
}

/** Small hint for how a scavenged resource might be useful (by type). */
function typeReuseHint(type) {
  const m = {
    herb:     'Healing, antidotes, or barter with apothecaries.',
    tool:     'Solving practical problems — locks, traps, repairs.',
    currency: 'Spending, bribing, or buying passage.',
    document: 'Evidence, leverage, or lore not widely known.',
    curio:    'Gift, trade, or a curiosity with hidden meaning.',
    food:     'Restoring strength on the road.',
    weapon:   'Combat, intimidation, or ritual use.',
  };
  return m[type] || 'Something that may matter later.';
}

/**
 * Render NPC cards for everyone currently in the player's region.
 * Shows name, role, disposition bar, and lets the player tap for details.
 */
function renderAdventureNpcs() {
  const container = $('advNpcs');
  if (!container) return;
  const adv = AppState.adventure;
  const loc = adv.currentRegion || 'unknown';

  // Recently-seen NPCs here (last 3 chapters) — keeps the panel from drowning
  const recent = Object.values(adv.npcs || {}).filter(n =>
    n.alive !== false &&
    n.region === loc &&
    (adv.chapter - (n.lastSeenChapter || 0)) <= 2
  );

  if (!recent.length) {
    container.innerHTML = '';
    return;
  }

  const dispBar = v => {
    const pct = Math.round((v + 100) / 2); // -100..100 → 0..100
    const color = v > 30 ? 'var(--ok)' : v < -30 ? 'var(--err)' : 'var(--gold-dim)';
    return `<div class="adv-npc-disp-wrap"><div class="adv-npc-disp-bar" style="width:${pct}%;background:${color}"></div></div>`;
  };
  const label = v => v > 50 ? 'Ally' : v > 20 ? 'Warm' : v > -20 ? 'Neutral' : v > -50 ? 'Cold' : 'Hostile';

  container.innerHTML = `
    <div class="adv-npc-head">Nearby (${recent.length})</div>
    <div class="adv-npc-list">
      ${recent.map(n => `
        <div class="adv-npc-card" data-npc="${esc(n.id)}">
          <div class="adv-npc-row">
            <span class="adv-npc-name">${esc(n.name)}</span>
            <span class="adv-npc-label">${label(n.disposition || 0)}</span>
          </div>
          <div class="adv-npc-role">${esc(n.role || '')}${n.faction ? ` · ${esc(n.faction)}` : ''}</div>
          ${dispBar(n.disposition || 0)}
        </div>
      `).join('')}
    </div>`;

  // Click to show details
  container.querySelectorAll('.adv-npc-card').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.npc;
      const n  = adv.npcs[id];
      if (n) showNpcDetail(n);
    });
  });
}

/** Lightweight NPC detail popup — reuses the item detail modal for consistency. */
function showNpcDetail(npc) {
  const titleEl = $('itemDetailTitle');
  const subEl   = $('itemDetailSub');
  const bodyEl  = $('itemDetailBody');
  if (!titleEl || !bodyEl) return;
  titleEl.textContent = npc.name;
  subEl.textContent   = `${npc.role || 'Unknown'}${npc.faction ? ' · ' + npc.faction : ''}`;

  const sign = (npc.disposition || 0) > 0 ? '+' : '';
  const traits = Array.isArray(npc.traits) && npc.traits.length
    ? `<div class="item-modal-section"><div class="item-modal-label">Traits</div><p>${npc.traits.map(t => esc(t)).join(', ')}</p></div>`
    : '';
  const rel = npc.relationshipNote
    ? `<div class="item-modal-section"><div class="item-modal-label">Relationship</div><p>${esc(npc.relationshipNote)}</p></div>`
    : '';

  bodyEl.innerHTML = `
    ${npc.description ? `<div class="item-modal-section"><div class="item-modal-label">About</div><p>${esc(npc.description)}</p></div>` : ''}
    ${traits}
    <div class="item-modal-section">
      <div class="item-modal-label">Disposition</div>
      <p>${sign}${npc.disposition || 0} — last seen chapter ${npc.lastSeenChapter || '?'}</p>
    </div>
    ${rel}`;
  openModal('itemDetailModal');
}

/** Render the environmental resources panel — what's scavengeable here. */
function renderAdventureEnvironment() {
  const container = $('advEnvironment');
  if (!container) return;
  const adv = AppState.adventure;
  const loc = adv.currentRegion || 'unknown';
  const resources = (adv.environment?.[loc] || []).filter(r => r.takenInChapter == null);

  if (!resources.length) {
    container.innerHTML = '';
    return;
  }

  const icons = { herb:'❦', tool:'⚒', currency:'◎', document:'✎', curio:'❖', food:'◐', weapon:'†' };

  container.innerHTML = `
    <div class="adv-env-head">Here (${resources.length})</div>
    <div class="adv-env-list">
      ${resources.map(r => `
        <div class="adv-env-item" title="${esc(r.description || '')}">
          <span class="adv-env-icon">${icons[r.type] || '◈'}</span>
          <span class="adv-env-name">${esc(r.name)}</span>
          <span class="adv-env-type">${esc(r.type || 'curio')}</span>
        </div>
      `).join('')}
    </div>`;
}

/**
 * Show the full item detail modal.
 * @param {object} item - the inventory item
 * @param {boolean} isNewlyAcquired - true to show "Item Found" messaging
 */
function showItemDetail(item, isNewlyAcquired = false) {
  $('itemDetailTitle').textContent = isNewlyAcquired ? 'Item Found' : item.name;
  $('itemDetailSub').textContent   = isNewlyAcquired ? item.name : '';

  const body = $('itemDetailBody');
  let html = '';
  if (item.description) {
    html += `<div class="item-modal-section">
      <div class="item-modal-label">Description</div>
      <p>${esc(item.description)}</p>
    </div>`;
  }
  if (item.history) {
    html += `<div class="item-modal-section">
      <div class="item-modal-label">History</div>
      <p>${esc(item.history)}</p>
    </div>`;
  }
  if (item.usefulFor) {
    html += `<div class="item-modal-section">
      <div class="item-modal-label">Useful For</div>
      <p>${esc(item.usefulFor)}</p>
    </div>`;
  }
  if (!html) html = '<p class="adv-empty">No details recorded for this item.</p>';
  body.innerHTML = html;

  openModal('itemDetailModal');
}

/** Render the character identity card */
function renderAdventureCharacterCard() {
  const adv = AppState.adventure;
  const card = $('advCharacterCard');
  if (!card) return;
  card.innerHTML = `
    <div class="adv-char-name">${esc(adv.playerName || 'The Wanderer')}</div>
    <div class="adv-char-line">
      <span class="adv-char-faction" style="border-color:var(--gold)">
        ${esc(adv.playerFaction?.name || '—')}
      </span>
      <span class="adv-char-origin">from ${esc(adv.playerOrigin?.name || '—')}</span>
    </div>
    ${adv.playerBg ? `<div class="adv-char-bg">${esc(adv.playerBg)}</div>` : ''}`;
}

/** Render faction standing bars */
function renderFactionStandings() {
  const adv = AppState.adventure;
  const container = $('advStandingBars');
  if (!container) return;

  const standings = Object.entries(adv.factionStanding);
  if (!standings.length) { container.innerHTML = ''; return; }

  container.innerHTML = `
    <div class="adv-standing-title">Faction Relations</div>
    ${standings.map(([name, val]) => {
      const pct   = Math.round((val + 100) / 2); // -100..100 → 0..100%
      const color = val > 30 ? 'var(--ok)' : val < -30 ? 'var(--err)' : 'var(--gold-dim)';
      const label = val > 50 ? 'Ally' : val > 20 ? 'Friendly' : val > -20 ? 'Neutral' : val > -50 ? 'Hostile' : 'Enemy';
      return `
        <div class="adv-standing-row">
          <span class="adv-standing-name">${esc(name.slice(0, 18))}</span>
          <div class="adv-standing-bar-wrap">
            <div class="adv-standing-bar" style="width:${pct}%;background:${color}"></div>
          </div>
          <span class="adv-standing-label" style="color:${color}">${label}</span>
        </div>`;
    }).join('')}`;
}

/**
 * Core scene generator — builds rich, lore-specific narrative.
 * sceneType: 'OPENING' | 'CONTINUATION' | 'CONSEQUENCE'
 * prevChoice: the choice text that led to this scene (null for opening)
 */
async function generateAdventureScene(sceneType, prevChoice) {
  const W   = AppState.world;
  const adv = AppState.adventure;

  // Show loading state
  $('advNarrative').innerHTML = '<div class="adv-loading">The Oracle weaves your fate…</div>';
  $('advChoices').innerHTML   = '';
  $('advChapterBadge').textContent = `Chapter ${adv.chapter}`;
  $('advSceneLabel').textContent   = adv.currentRegion || adv.playerOrigin?.name || W.worldName;

  // Build the player context string
  const playerCtx = [
    `Name: ${adv.playerName || 'unknown'}`,
    `Faction: ${adv.playerFaction?.name} (${adv.playerFaction?.type || ''})`,
    `Origin: ${adv.playerOrigin?.name} (${adv.playerOrigin?.type || ''})`,
    `Currently in: ${adv.currentRegion || adv.playerOrigin?.name}`,
    adv.playerBg ? `Background: ${adv.playerBg}` : '',
  ].filter(Boolean).join('. ');

  // Faction standing summary
  const standingCtx = Object.entries(adv.factionStanding)
    .map(([n, v]) => `${n}: ${v > 0 ? '+' : ''}${v}`)
    .join(', ');

  // Recent history (last 3 chapters)
  const historyCtx = adv.history.slice(-3)
    .map(h => `Chapter ${h.chapter}: "${h.choiceText}" → ${h.outcome}`)
    .join(' | ');

  // Nova world state (compound what's happened in simulation)
  const simState = AppState.nova.events.length
    ? `The world is currently at Year ${AppState.nova.year}. Recent events: ${AppState.nova.events.slice(-3).map(e => e.text).join(' | ')}.`
    : '';

  // Scene-type-specific instruction
  const sceneInstruction = {
    OPENING:      `Write the opening scene. The player is ${adv.playerName || 'a traveler'} from ${adv.playerOrigin?.name}, a member of ${adv.playerFaction?.name}. Begin in medias res — something is already happening. Ground the scene in specific lore details from the world.`,
    CONTINUATION: `Continue the story. The player just chose: "${prevChoice}". Generate the next scene flowing naturally from that choice and its consequences.`,
    CONSEQUENCE:  `The player made a significant choice. Show the immediate aftermath before moving the story forward.`,
  }[sceneType] || 'Continue the story.';

  try {
    const inv = AppState.adventureInventory;
    const invSummary = inv.items.length ? inv.items.map(i => i.name).join(', ') : 'empty-handed';
    const healthStr  = `${inv.health}/${inv.maxHealth}`;
    const archStr    = adv.playerArchetype
      ? `${adv.playerArchetype.label} (Str:${adv.playerArchetype.stats.strength}, Int:${adv.playerArchetype.stats.intelligence}, Dex:${adv.playerArchetype.stats.dexterity}, Spd:${adv.playerArchetype.stats.speed})`
      : 'unknown';

    // Build current-region NPC roster context so recurring NPCs stay consistent
    const localNpcs = Object.values(adv.npcs || {}).filter(n =>
      n.alive !== false && n.region === adv.currentRegion
    );
    const npcCtx = localNpcs.length
      ? localNpcs.map(n => `${n.name} (${n.role}, disposition ${n.disposition >= 0 ? '+' : ''}${n.disposition}${n.relationshipNote ? ` — ${n.relationshipNote}` : ''})`).join('; ')
      : 'No recurring NPCs here yet — introduce one if it fits the scene.';

    // Scavenge context — what's already in the environment at this location
    const locKey = adv.currentRegion || 'unknown';
    const envHere = (adv.environment?.[locKey] || []).filter(e => e.takenInChapter == null);
    const envCtx = envHere.length
      ? `Available resources here: ${envHere.map(e => e.name).join(', ')}`
      : 'No known resources here yet — you may surface 1–2 if it fits the scene.';

    const raw = await callApi(
      `You are a narrator for "${W.worldName}" (${W.genre}).

WORLD LORE: ${buildWorldContext()}
${simState}

PLAYER: ${playerCtx}
ARCHETYPE: ${archStr}
HEALTH: ${healthStr}    INVENTORY: ${invSummary}
FACTION RELATIONS: ${standingCtx}
STORY HISTORY: ${historyCtx || 'This is the beginning.'}

LOCAL NPCS: ${npcCtx}
ENVIRONMENT: ${envCtx}

SCENE TYPE: ${sceneInstruction}

WRITING STYLE — CRITICAL:
- Use clear, accessible language. Short sentences. Active voice.
- Avoid flowery prose, obscure metaphors, and overwrought vocabulary.
- Keep paragraphs SHORT — 2-3 sentences each, max 4.
- If you use a lore term for the first time, briefly anchor it ("the Iron Throne — the ruling empire of the eastern lands").
- Make the scene READ EASILY. The player should understand what's happening without rereading.

SCENE POPULATION — REQUIRED:
- At LEAST one NPC should be present or reachable in nearly every scene — a stranger, merchant, guard, priest, wanderer, rival, informant, etc. They have names, opinions, and their own agenda.
- If an NPC from LOCAL NPCS fits, reuse them — keep personalities consistent. Otherwise introduce a new named person.
- At LEAST one environmental detail should be something the player could interact with: a half-open crate, an herb growing nearby, graffiti, a forgotten tool, coins in a gutter, a posted notice. Not every resource is useful — some are junk or flavor.

CONTENT RULES:
- Reference at least one named element from the world lore
- The player's archetype should shape choices (a Warrior sees different options than a Scholar)
- If the player has items that fit the situation, offer a choice that uses them
- At least one choice should involve interacting with an NPC (talk, barter, help, deceive, challenge) when NPCs are present
- Consider offering a "scavenge / search the area" choice when resources are present
- Choices should have clear consequences — the hint text tells the player what to expect

Return ONLY valid JSON:
{
  "sceneTitle": "Short title, 3-6 words",
  "narrative": "3-5 SHORT paragraphs separated by \\n\\n",
  "location": "region name",
  "npcsPresent": [
    {"name":"Name","role":"role/occupation","faction":"faction name or null","description":"1 short sentence","traits":["trait1","trait2"],"initialDisposition":0}
  ],
  "environmentalResources": [
    {"name":"what it is","type":"herb|tool|currency|document|curio|food|weapon","description":"1 short sentence"}
  ],
  "choices": [
    {"id":"a","text":"Clear action in plain language","consequence":"What might happen","affectsFaction":null,"standingChange":0,"healthChange":0,"itemGained":null,"itemLost":null,"insightGained":null,"npcInteraction":null,"npcDispositionChange":0,"scavengeTarget":null},
    {"id":"b","text":"...","consequence":"...","affectsFaction":null,"standingChange":0,"healthChange":0,"itemGained":null,"itemLost":null,"insightGained":null,"npcInteraction":null,"npcDispositionChange":0,"scavengeTarget":null},
    {"id":"c","text":"...","consequence":"...","affectsFaction":null,"standingChange":0,"healthChange":0,"itemGained":null,"itemLost":null,"insightGained":null,"npcInteraction":null,"npcDispositionChange":0,"scavengeTarget":null},
    {"id":"d","text":"...","consequence":"...","affectsFaction":null,"standingChange":0,"healthChange":0,"itemGained":null,"itemLost":null,"insightGained":null,"npcInteraction":null,"npcDispositionChange":0,"scavengeTarget":null}
  ],
  "worldPulse": "One sentence about wider world (optional)"
}

FIELD NOTES:
- npcsPresent: 1-3 entries. Reuse names from LOCAL NPCS when that NPC is still in the scene.
- environmentalResources: 0-3 entries. If nothing makes sense, use [].
- itemGained: null OR {"name":"specific name","description":"1-2 sentences","history":"1-2 sentences about its origin","usefulFor":"1 sentence on situations where it helps"}
- itemLost: null OR the name of an item already in inventory
- insightGained: null OR "a short piece of world knowledge"
- healthChange: integer from -30 to +20, or 0
- npcInteraction: null OR exact name of an NPC in npcsPresent — marks the choice as targeting that NPC
- npcDispositionChange: integer from -40 to +40 to shift how that NPC feels about the player (only matters with npcInteraction)
- scavengeTarget: null OR exact name of a resource in environmentalResources — picking this choice takes that resource into inventory`,
      { maxTokens: 1800 }
    );

    const scene = parseJsonResponse(raw);

    // Update location
    if (scene.location) adv.currentRegion = scene.location;
    adv.currentChoices = scene.choices || [];

    // Merge NPCs into the persistent roster
    const currentLoc = adv.currentRegion || 'unknown';
    if (Array.isArray(scene.npcsPresent)) {
      scene.npcsPresent.forEach(n => {
        if (!n || !n.name) return;
        const key = n.name.toLowerCase().trim();
        const existing = adv.npcs[key];
        if (existing) {
          // Update what we know — but keep disposition we've built up
          existing.role        = n.role || existing.role;
          existing.faction     = n.faction || existing.faction;
          existing.description = n.description || existing.description;
          existing.traits      = Array.isArray(n.traits) ? n.traits : existing.traits;
          existing.region      = currentLoc;
          existing.lastSeenChapter = adv.chapter;
        } else {
          adv.npcs[key] = {
            id:               key,
            name:             n.name,
            role:             n.role || 'stranger',
            faction:          n.faction || null,
            description:      n.description || '',
            traits:           Array.isArray(n.traits) ? n.traits.slice(0, 3) : [],
            disposition:      typeof n.initialDisposition === 'number'
                                ? Math.max(-100, Math.min(100, n.initialDisposition))
                                : 0,
            region:           currentLoc,
            firstMetChapter:  adv.chapter,
            lastSeenChapter:  adv.chapter,
            alive:            true,
            relationshipNote: '',
          };
        }
      });
    }

    // Merge environmental resources at this location
    if (Array.isArray(scene.environmentalResources)) {
      if (!adv.environment[currentLoc]) adv.environment[currentLoc] = [];
      const existingNames = new Set(adv.environment[currentLoc].map(e => e.name.toLowerCase()));
      scene.environmentalResources.forEach(r => {
        if (!r || !r.name) return;
        if (existingNames.has(r.name.toLowerCase())) return;
        adv.environment[currentLoc].push({
          name:           String(r.name),
          type:           String(r.type || 'curio'),
          description:    String(r.description || ''),
          takenInChapter: null,
        });
      });
    }

    // Render narrative
    const narHtml = (scene.narrative || '')
      .split('\n\n')
      .filter(p => p.trim())
      .map(p => `<p>${addCitationLinks(p, W)}</p>`)
      .join('');

    $('advNarrative').innerHTML = narHtml || '<div class="adv-empty">The Oracle is silent.</div>';
    $('advSceneLabel').textContent = scene.sceneTitle || adv.currentRegion || W.worldName;

    // Render choices — add NPC and scavenge visual flags
    $('advChoices').innerHTML = (scene.choices || []).map(c => {
      const hasEffect = c.affectsFaction && c.standingChange !== 0;
      const sign      = c.standingChange > 0 ? '+' : '';
      const effectTip = hasEffect ? ` · ${c.affectsFaction} ${sign}${c.standingChange}` : '';
      const npcTag    = c.npcInteraction ? `<span class="adv-choice-tag adv-choice-tag-npc">👤 ${esc(c.npcInteraction)}</span>` : '';
      const scavTag   = c.scavengeTarget ? `<span class="adv-choice-tag adv-choice-tag-scav">◈ take</span>` : '';
      return `
        <button class="adv-choice-btn" data-choice-id="${esc(c.id)}">
          <span class="adv-choice-text">→ ${esc(c.text)}</span>
          <span class="adv-choice-meta">${npcTag}${scavTag}</span>
          ${c.consequence ? `<span class="adv-choice-hint">${esc(c.consequence)}${effectTip}</span>` : ''}
        </button>`;
    }).join('');

    $('advChoices').querySelectorAll('.adv-choice-btn').forEach(btn => {
      btn.addEventListener('click', () => makeAdventureChoice(btn.dataset.choiceId));
    });

    // World pulse feeds into Nova
    if (scene.worldPulse) {
      const nova = AppState.nova;
      nova.year += Math.floor(1 + Math.random() * 4);
      nova.events.push({ year: nova.year, text: `[Adventure] ${scene.worldPulse}`, type: 'discovery' });
      renderMiniMapView();
    }

    // Render NPC cards and environment panel
    renderAdventureNpcs();
    renderAdventureEnvironment();
    updatePanelAdventure();

  } catch (err) {
    $('advNarrative').innerHTML = `<div class="adv-empty">The Oracle's vision clouds — ${esc(err.message)}<br><br><button class="btn-sm" onclick="generateAdventureScene('${sceneType}',null)">↺ Try again</button></div>`;
    recordDiagError('adventure', err.message);
  }
}

/** Player makes a choice — resolve consequence then generate next scene */
async function makeAdventureChoice(choiceId) {
  const adv    = AppState.adventure;
  const inv    = AppState.adventureInventory;
  const choice = adv.currentChoices.find(c => c.id === choiceId);
  if (!choice) return;

  adv.chapter++;

  // Apply faction standing change
  if (choice.affectsFaction && choice.standingChange !== 0) {
    const current = adv.factionStanding[choice.affectsFaction] ?? 0;
    adv.factionStanding[choice.affectsFaction] = Math.max(-100, Math.min(100, current + choice.standingChange));
  }

  // Apply inventory / health changes
  const toastLines = [];
  if (typeof choice.healthChange === 'number' && choice.healthChange !== 0) {
    inv.health = Math.max(0, Math.min(inv.maxHealth, inv.health + choice.healthChange));
    if (choice.healthChange < 0) toastLines.push(`${choice.healthChange} Health`);
    else                          toastLines.push(`+${choice.healthChange} Health`);
  }
  if (choice.itemGained && choice.itemGained.name) {
    const newItem = {
      name:            String(choice.itemGained.name),
      description:     String(choice.itemGained.description || ''),
      history:         String(choice.itemGained.history || ''),
      usefulFor:       String(choice.itemGained.usefulFor || ''),
      obtainedChapter: adv.chapter - 1,
      isStarter:       false,
    };
    inv.items.push(newItem);
    toastLines.push(`◆ Acquired: ${choice.itemGained.name}`);
    // Defer the item-found modal to after the scene transition so it feels like a reveal
    setTimeout(() => showItemDetail(newItem, true), 1200);
  }
  if (choice.itemLost && typeof choice.itemLost === 'string') {
    const idx = inv.items.findIndex(i => i.name === choice.itemLost);
    if (idx >= 0) {
      inv.items.splice(idx, 1);
      toastLines.push(`✕ Lost: ${choice.itemLost}`);
    }
  }
  if (choice.insightGained && typeof choice.insightGained === 'string') {
    inv.keyInsights.push({ text: choice.insightGained, chapter: adv.chapter - 1 });
    toastLines.push(`☽ Insight: ${choice.insightGained.slice(0, 40)}${choice.insightGained.length > 40 ? '…' : ''}`);
  }

  // NPC disposition shift
  if (choice.npcInteraction && typeof choice.npcDispositionChange === 'number' && choice.npcDispositionChange !== 0) {
    const key = String(choice.npcInteraction).toLowerCase().trim();
    const npc = adv.npcs[key];
    if (npc) {
      npc.disposition = Math.max(-100, Math.min(100, (npc.disposition || 0) + choice.npcDispositionChange));
      npc.lastSeenChapter = adv.chapter - 1;
      const sign = choice.npcDispositionChange > 0 ? '+' : '';
      toastLines.push(`👤 ${npc.name} ${sign}${choice.npcDispositionChange}`);
      // Note the interaction so future prompts keep tone consistent
      if (choice.npcDispositionChange >= 30) npc.relationshipNote = 'impressed by you';
      else if (choice.npcDispositionChange <= -30) npc.relationshipNote = 'wary of you';
    }
  }

  // Scavenge — take a listed environmental resource and convert to inventory item
  if (choice.scavengeTarget && typeof choice.scavengeTarget === 'string') {
    const loc = adv.currentRegion || 'unknown';
    const resources = adv.environment[loc] || [];
    const target = resources.find(r =>
      r.name.toLowerCase() === choice.scavengeTarget.toLowerCase() && r.takenInChapter == null
    );
    if (target) {
      target.takenInChapter = adv.chapter - 1;
      inv.items.push({
        name:            target.name,
        description:     target.description || `A ${target.type} found in ${loc}.`,
        history:         `Scavenged from ${loc} during chapter ${adv.chapter - 1}.`,
        usefulFor:       typeReuseHint(target.type),
        obtainedChapter: adv.chapter - 1,
        isStarter:       false,
      });
      toastLines.push(`◈ Scavenged: ${target.name}`);
    }
  }

  if (toastLines.length) showToast(toastLines.join(' · '));

  // Log to journey
  adv.history.push({
    chapter:    adv.chapter - 1,
    sceneTitle: $('advSceneLabel')?.textContent || '',
    choiceText: choice.text,
    outcome:    '…',
  });

  // Add to visible log
  const logEl = $('advLog');
  if (logEl) {
    const entry = document.createElement('div');
    entry.className = 'adv-log-entry';
    entry.innerHTML = `
      <div class="adv-log-chapter">Chapter ${adv.chapter - 1}</div>
      <div class="adv-log-choice">→ ${esc(choice.text)}</div>`;
    logEl.appendChild(entry);
    logEl.scrollTop = logEl.scrollHeight;
  }

  renderFactionStandings();
  renderAdventureHealth();
  renderAdventureInventory();
  renderAdventureNpcs();
  renderAdventureEnvironment();
  saveCurrentWorld();

  // Show choice was selected, brief moment before next scene
  $('advChoices').querySelectorAll('.adv-choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.choiceId === choiceId) btn.classList.add('selected');
  });

  // Check for death condition before generating next scene
  if (inv.health <= 0) {
    await new Promise(r => setTimeout(r, 800));
    handlePlayerDeath();
    return;
  }

  await new Promise(r => setTimeout(r, 600));
  await generateAdventureScene('CONTINUATION', choice.text);
}

/**
 * When health hits zero — show the choice modal: end story or continue as legacy character.
 * The old auto-epitaph is now only shown if the user picks "End the Story".
 */
async function handlePlayerDeath() {
  const adv = AppState.adventure;
  const sub = $('deathSubtitle');
  if (sub) {
    sub.textContent = `${adv.playerName || 'Your character'} has fallen in ${adv.currentRegion || 'an unknown place'} after ${adv.chapter - 1} chapter${adv.chapter - 1 === 1 ? '' : 's'}.`;
  }

  // Wire up the two death choice buttons
  $('btnDeathEnd').onclick    = () => { closeModal('deathChoiceModal'); showEndingEpitaph(); };
  $('btnDeathLegacy').onclick = () => { closeModal('deathChoiceModal'); startLegacyAdventure(); };

  openModal('deathChoiceModal');
}

/** The player chose to end the story — show the final epitaph */
async function showEndingEpitaph() {
  const W   = AppState.world;
  const adv = AppState.adventure;

  $('advNarrative').innerHTML = '<div class="adv-loading">Your story reaches its end…</div>';
  $('advChoices').innerHTML   = '';

  // Archive this character into the legacy chain for future reference
  adv.legacyChain = adv.legacyChain || [];
  adv.legacyChain.push({
    name:           adv.playerName || 'The Wanderer',
    faction:        adv.playerFaction?.name || '',
    origin:         adv.playerOrigin?.name || '',
    archetype:      adv.playerArchetype?.label || '',
    chapters:       adv.chapter - 1,
    deathRegion:    adv.currentRegion || '',
    finalItems:     (AppState.adventureInventory.items || []).map(i => i.name),
  });

  try {
    const recent = adv.history.slice(-3).map(h => h.choiceText).join(' → ');
    const raw = await callApi(
      `Write a 2-3 paragraph ending for ${adv.playerName || 'the wanderer'}'s story in "${W.worldName}".
They fell in ${adv.currentRegion}. A ${adv.playerArchetype?.label || 'traveler'} of ${adv.playerFaction?.name}, born in ${adv.playerOrigin?.name}.
Recent actions: ${recent || 'a short but meaningful journey'}.
Write in CLEAR, accessible language. Short sentences. Specific to the world's lore. Honor the character's arc.
Return ONLY plain text, no JSON.`,
      { maxTokens: 500 }
    );
    const epitaph = raw.split('\n\n').filter(p => p.trim()).map(p => `<p>${esc(p)}</p>`).join('');
    $('advNarrative').innerHTML = `
      <div class="adv-ending">
        <div class="adv-ending-badge">✦ End of Chapter ${adv.chapter - 1}</div>
        ${epitaph}
      </div>`;
  } catch (_) {
    $('advNarrative').innerHTML = `
      <div class="adv-ending">
        <div class="adv-ending-badge">✦ End</div>
        <p>And so ended the tale of ${esc(adv.playerName || 'the wanderer')}, who fell in ${esc(adv.currentRegion || 'the wilds')} after ${adv.chapter - 1} chapters. The world turns on.</p>
      </div>`;
  }

  $('advChoices').innerHTML = `<button class="btn-forge" id="btnAdvRestartFromEnd">✦ Begin a New Story</button>`;
  $('btnAdvRestartFromEnd')?.addEventListener('click', () => {
    resetAdventure(false);  // keep legacy chain
    setNav('dnd');
  });
  adv.active = false;
  saveCurrentWorld();
}

/**
 * The player chose to continue as a legacy character.
 * Their heir inherits: same faction, partial faction standings, one starter item
 * from the fallen predecessor. They start with a fresh archetype choice.
 */
function startLegacyAdventure() {
  const adv = AppState.adventure;
  const predecessor = {
    name:           adv.playerName || 'The Wanderer',
    faction:        adv.playerFaction?.name || '',
    origin:         adv.playerOrigin?.name || '',
    archetype:      adv.playerArchetype?.label || '',
    chapters:       adv.chapter - 1,
    deathRegion:    adv.currentRegion || '',
    finalItems:     (AppState.adventureInventory.items || []).slice(),
  };

  // Archive into legacy chain
  adv.legacyChain = adv.legacyChain || [];
  adv.legacyChain.push({
    name:         predecessor.name,
    faction:      predecessor.faction,
    origin:       predecessor.origin,
    archetype:    predecessor.archetype,
    chapters:     predecessor.chapters,
    deathRegion:  predecessor.deathRegion,
    finalItems:   predecessor.finalItems.map(i => i.name),
  });

  // Preserve the faction (the heir inherits it) and some faction standings at half strength
  const inheritedFaction   = adv.playerFaction;
  const inheritedStandings = {};
  Object.entries(adv.factionStanding || {}).forEach(([k, v]) => {
    inheritedStandings[k] = Math.round(v * 0.5);
  });

  // Inherit one random item from the predecessor (their "keepsake")
  const inheritedItem = predecessor.finalItems.length
    ? predecessor.finalItems[Math.floor(Math.random() * predecessor.finalItems.length)]
    : null;

  // Reset for new character but preserve inherited state
  const preservedLegacy = adv.legacyChain;
  AppState.adventure = {
    active: false, chapter: 0, playerName: '', playerFaction: inheritedFaction,
    playerOrigin: null, playerBg: '', playerArchetype: null,
    factionStanding: inheritedStandings,
    currentRegion: null, history: [], currentChoices: [], worldImpacts: [],
    npcs: {}, environment: {},
    legacyChain: preservedLegacy,
    // Legacy-specific fields — flagged so beginAdventure can reference them
    _inheritedFrom: predecessor.name,
    _inheritedItem: inheritedItem,
  };
  AppState.adventureInventory = {
    items:       inheritedItem ? [{ ...inheritedItem, obtainedChapter: 0, isStarter: true }] : [],
    health:      100,
    maxHealth:   100,
    keyInsights: [],
    achievements: [],
  };

  showToast(`${predecessor.name}'s legacy continues. You inherit their faction${inheritedItem ? ` and their ${inheritedItem.name}` : ''}.`);

  // Go back to setup — user picks new origin and archetype
  showAdventureSetup();
}

/** Panel content for adventure mode */
function updatePanelAdventure() {
  const adv = AppState.adventure;
  $('panelTitle').textContent = 'Adventure';
  $('panelSub').textContent   = `Chapter ${adv.chapter}`;

  if (!adv.active) {
    // If there's a legacy chain, show it as inspiration
    const legacy = adv.legacyChain || [];
    let html = '<div class="placeholder-msg">Set up your character to begin.</div>';
    if (legacy.length) {
      html += `<div style="padding:.85rem 1rem 0">
        <div style="font-family:var(--fd);font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:.4rem">Legacy Chain</div>
        ${legacy.slice(-5).reverse().map(l => `
          <div style="font-size:.75rem;color:var(--faint);padding:.35rem 0;border-bottom:1px solid var(--bord-f)">
            <div style="color:var(--parch-dim)">${esc(l.name)}</div>
            <div style="font-style:italic;margin-top:.1rem">${esc(l.archetype || '')} · ${l.chapters} chapters · fell in ${esc(l.deathRegion || 'unknown')}</div>
          </div>`).join('')}
      </div>`;
    }
    $('panelScroll').innerHTML = html;
    $('panelFooter').innerHTML = '';
    return;
  }

  const standings = Object.entries(adv.factionStanding);
  const arch = adv.playerArchetype;

  $('panelScroll').innerHTML = `
    <div style="padding:.65rem 1rem">
      <div style="font-family:var(--fd);font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:.4rem">Character</div>
      <div style="font-size:.85rem;color:var(--parch-dim);margin-bottom:.1rem">${esc(adv.playerName || 'The Wanderer')}</div>
      <div style="font-size:.72rem;color:var(--faint);font-style:italic;margin-bottom:.5rem">
        ${arch ? `${arch.icon} ${esc(arch.label)} · ` : ''}${esc(adv.playerFaction?.name || '')} · from ${esc(adv.playerOrigin?.name || '')}
      </div>
      ${adv._inheritedFrom ? `<div style="font-size:.7rem;color:var(--gold-dim);font-style:italic;margin-bottom:.5rem">☽ Heir of ${esc(adv._inheritedFrom)}</div>` : ''}

      ${arch ? `
        <div style="font-family:var(--fd);font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:.3rem">Attributes</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.2rem;font-size:.7rem;color:var(--parch-dim);margin-bottom:.85rem">
          <div>Str: <strong style="color:var(--gold)">${arch.stats.strength}</strong></div>
          <div>Int: <strong style="color:var(--gold)">${arch.stats.intelligence}</strong></div>
          <div>Dex: <strong style="color:var(--gold)">${arch.stats.dexterity}</strong></div>
          <div>Spd: <strong style="color:var(--gold)">${arch.stats.speed}</strong></div>
        </div>
      ` : ''}

      <div style="font-family:var(--fd);font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:.4rem">Location</div>
      <div style="font-size:.82rem;color:var(--parch-dim);margin-bottom:.85rem">${esc(adv.currentRegion || '—')}</div>

      ${standings.length ? `
        <div style="font-family:var(--fd);font-size:.6rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:.4rem">Relations</div>
        ${standings.map(([name, val]) => {
          const color = val > 20 ? 'var(--ok)' : val < -20 ? 'var(--err)' : 'var(--gold-dim)';
          return `<div style="display:flex;justify-content:space-between;font-size:.72rem;color:${color};margin-bottom:.2rem"><span>${esc(name.slice(0,16))}</span><span>${val > 0 ? '+' : ''}${val}</span></div>`;
        }).join('')}
      ` : ''}

      ${(adv.legacyChain || []).length ? `
        <div style="font-family:var(--fd);font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;color:var(--gold-dim);margin-top:.85rem;margin-bottom:.3rem">Legacy (${adv.legacyChain.length})</div>
        ${adv.legacyChain.slice(-3).reverse().map(l => `
          <div style="font-size:.68rem;color:var(--faint);padding:.2rem 0">◆ ${esc(l.name)} · ${l.chapters}ch</div>`).join('')}
      ` : ''}
    </div>`;

  $('panelFooter').innerHTML = `
    <button class="btn-add" id="btnAdvOracle">☽ Ask Oracle about my story</button>`;
  $('btnAdvOracle')?.addEventListener('click', () => {
    const recent = adv.history.slice(-1)[0];
    const q = recent
      ? `I'm playing as ${adv.playerName || 'a traveler'} (${adv.playerArchetype?.label || ''}) from ${adv.playerFaction?.name}. I just chose "${recent.choiceText}". What might happen next in ${adv.currentRegion}?`
      : `I'm playing as ${adv.playerName || 'a traveler'} (${adv.playerArchetype?.label || ''}) from ${adv.playerFaction?.name}, starting in ${adv.playerOrigin?.name}. What should I expect?`;
    $('chatInput').value = q;
    setNav('oracle');
    sendChat();
  });
}

/* ════════════════════════════════════════════════
   ORACLE CHAT — GUIDE MODE
════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════
   ORACLE v2 — roles, proposals, memory, citations
════════════════════════════════════════════════ */

/** Render the Oracle role switcher in the header */
function renderOracleRoleBar() {
  const bar = $('oracleRoleBar');
  if (!bar) return;
  const current = AppState.oracle.role;
  bar.innerHTML = Object.entries(ORACLE_ROLES).map(([id, role]) => `
    <button class="oracle-role-btn${id === current ? ' active' : ''}" data-role="${id}" title="${role.description}">
      ${role.label}
    </button>`).join('');
  bar.querySelectorAll('.oracle-role-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      AppState.oracle.role = btn.dataset.role;
      renderOracleRoleBar();
      // Update subtitle
      const role = ORACLE_ROLES[btn.dataset.role];
      $('oracleSubtitle').textContent = role ? role.description : 'Your guide';
      // Post a role-change note into chat
      const msgs = $('chatMsgs');
      if (msgs) {
        msgs.innerHTML += `<div class="msg-role-change">— ${role.label} —</div>`;
        msgs.scrollTop = msgs.scrollHeight;
      }
    });
  });
}

/**
 * Core chat function — now with:
 *  - Role-specific system prompts
 *  - Persistent chat history per world
 *  - Proposal detection and card rendering
 *  - Citation linking of lore entry names
 */
async function sendChat() {
  const input = $('chatInput'), msg = input.value.trim();
  if (!msg || !hasWorld()) return;

  const msgs = $('chatMsgs'), btn = $('chatSendBtn');
  msgs.innerHTML += `<div class="msg-user">${esc(msg)}</div>`;
  input.value = ''; btn.disabled = true;

  const typing = document.createElement('div');
  typing.className = 'msg-ai msg-typing';
  typing.textContent = `${ORACLE_ROLES[AppState.oracle.role]?.label || 'The Oracle'} contemplates…`;
  msgs.appendChild(typing);
  msgs.scrollTop = msgs.scrollHeight;

  // Track in persistent history
  AppState.chatHistory.push({ role: 'user', content: msg });
  const history = AppState.chatHistory.slice(-20);  // last 10 pairs

  // Build role-specific system prompt
  const roleConfig = ORACLE_ROLES[AppState.oracle.role] || ORACLE_ROLES.oracle;
  const W = AppState.world;
  const simNote = AppState.nova.events.length
    ? `\nSimulation year ${AppState.nova.year}. Recent events: ${AppState.nova.events.slice(-3).map(e => `Year ${e.year}: ${e.text}`).join(' | ')}.`
    : '';

  // Proposal instruction — Oracle can suggest additions to the world
  const proposalInstruction = `
If you want to suggest adding something new to the world (a character, faction, artifact, prophecy, etc.), include at the END of your response a proposal in this exact format on its own line:
[PROPOSE:{"category":"characters","entry":{"name":"X","role":"Y","description":"Z","secret":"W"}}]
Only include one proposal per message, and only when it genuinely enriches the world. Never propose regions (the map handles those).`;

  const systemPrompt = `${roleConfig.systemPrompt}

World: "${W.worldName}" (${W.genre || 'Fantasy'}).
${buildWorldContext()}${simNote}

Known lore entries the user can click: ${[
    ...(W.characters || []).map(c => c.name),
    ...(W.factions   || []).map(f => f.name),
    ...(W.regions    || []).map(r => r.name),
    ...(W.artifacts  || []).map(a => a.name),
    ...(W.powers     || []).map(p => p.name),
  ].filter(Boolean).join(', ')}.

${proposalInstruction}

Keep responses under 350 words unless the question genuinely needs depth. Be specific — use real names from the world.`;

  try {
    const reply = await callApi(
      msg,
      { maxTokens: 900, systemPrompt, conversationHistory: history.slice(0, -1) }
    );

    AppState.chatHistory.push({ role: 'assistant', content: reply });
    saveOracleChat();  // Persist after every exchange

    typing.remove();

    // Extract any proposal from reply
    const { cleanReply, proposal } = extractProposal(reply);

    // Render the response with clickable lore citations
    const cited = addCitationLinks(cleanReply, W);
    const bubble = document.createElement('div');
    bubble.className = 'msg-ai';
    bubble.innerHTML = cited;
    msgs.appendChild(bubble);

    // Render proposal card if one was found
    if (proposal) {
      renderProposalCard(proposal, msgs);
    }

  } catch (err) {
    typing.remove();
    msgs.innerHTML += `<div class="msg-ai">The Oracle's vision clouds. ${esc(err.message)}</div>`;
    recordDiagError('oracle', err.message);
  }

  btn.disabled = false;
  msgs.scrollTop = msgs.scrollHeight;
}

/**
 * Extract [PROPOSE:{...}] token from reply text.
 * Returns cleaned reply and parsed proposal (or null).
 */
function extractProposal(reply) {
  const match = reply.match(/\[PROPOSE:(\{.*?\})\]/s);
  if (!match) return { cleanReply: reply, proposal: null };

  let proposal = null;
  try { proposal = JSON.parse(match[1]); } catch (_) {}

  const cleanReply = reply.replace(/\[PROPOSE:.*?\]/s, '').trim();
  return { cleanReply, proposal };
}

/**
 * Replace known lore entry names in text with clickable spans.
 * Clicking a name opens the Oracle asking about that entry.
 */
function addCitationLinks(text, world) {
  if (!world) return esc(text);

  // Collect all named entries
  const entries = [
    ...(world.characters || []).map(e => ({ name: e.name, cat: 'characters' })),
    ...(world.factions   || []).map(e => ({ name: e.name, cat: 'factions'   })),
    ...(world.regions    || []).map(e => ({ name: e.name, cat: 'regions'    })),
    ...(world.artifacts  || []).map(e => ({ name: e.name, cat: 'artifacts'  })),
    ...(world.powers     || []).map(e => ({ name: e.name, cat: 'powers'     })),
    ...(world.history    || []).map(e => ({ name: e.name, cat: 'history'    })),
  ].filter(e => e.name && e.name.length > 2);

  // Sort longest names first so "Iron Throne" matches before "Iron"
  entries.sort((a, b) => b.name.length - a.name.length);

  // HTML-escape base text first
  let html = esc(text);

  // Replace each known name with a clickable citation link
  entries.forEach(entry => {
    const escaped = entry.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b(${escaped})\\b`, 'g');
    html = html.replace(regex, (match) =>
      `<span class="oracle-citation" data-entry="${esc(entry.name)}" data-cat="${entry.cat}" title="Click to ask about ${esc(entry.name)}">${esc(match)}</span>`
    );
  });

  return html;
}

/**
 * Render a proposal card — Oracle suggests adding an entry to the world.
 * User can Accept, Edit, or Reject.
 */
function renderProposalCard(proposal, msgs) {
  if (!proposal?.category || !proposal?.entry?.name) return;
  if (!PROPOSAL_CATEGORIES.includes(proposal.category)) return;

  const card = document.createElement('div');
  card.className = 'proposal-card';
  card.innerHTML = `
    <div class="proposal-header">
      <span class="proposal-icon">✦</span>
      <span class="proposal-title">Oracle proposes: Add a ${proposal.category.slice(0,-1)}</span>
    </div>
    <div class="proposal-body">
      <div class="proposal-name">${esc(proposal.entry.name)}</div>
      ${proposal.entry.role  ? `<div class="proposal-sub">${esc(proposal.entry.role)}</div>` : ''}
      ${proposal.entry.type  ? `<div class="proposal-sub">${esc(proposal.entry.type)}</div>` : ''}
      <div class="proposal-desc">${esc(proposal.entry.description || '')}</div>
      ${proposal.entry.secret ? `<div class="proposal-secret">🔒 ${esc(proposal.entry.secret)}</div>` : ''}
    </div>
    <div class="proposal-actions">
      <button class="proposal-btn accept" data-action="accept">✓ Add to World</button>
      <button class="proposal-btn edit"   data-action="edit">✏ Edit First</button>
      <button class="proposal-btn reject" data-action="reject">✕ Not Now</button>
    </div>`;

  msgs.appendChild(card);

  card.querySelector('[data-action="accept"]').addEventListener('click', () => {
    acceptProposal(proposal);
    card.innerHTML = `<div class="proposal-accepted">✦ ${esc(proposal.entry.name)} added to ${proposal.category}.</div>`;
  });

  card.querySelector('[data-action="edit"]').addEventListener('click', () => {
    card.remove();
    openAddEntryModal(proposal.category, proposal.entry);
  });

  card.querySelector('[data-action="reject"]').addEventListener('click', () => {
    card.innerHTML = `<div class="proposal-rejected">— Proposal dismissed —</div>`;
  });
}

/** Accept a proposal — add the entry directly to world data */
function acceptProposal(proposal) {
  if (!AppState.world) return;
  const cat = proposal.category;
  if (!Array.isArray(AppState.world[cat])) AppState.world[cat] = [];
  AppState.world[cat].push(proposal.entry);
  saveCurrentWorld();
  saveOracleChat();
  renderMap();
  showToast(`${proposal.entry.name} added to ${cat}.`);
  diagLog('ok', `Oracle proposal accepted: ${proposal.entry.name} → ${cat}`);
}

/** Proactive Oracle greeting when world is first created */
async function oracleProactiveGreeting() {
  if (!hasWorld()) return;
  const W = AppState.world;
  try {
    const raw = await callApi(
      `You are the Oracle for "${W.worldName}". The world was just created.
Give a short 2-3 sentence atmospheric greeting that:
1. Reflects something SPECIFIC from this world's lore (name a real region, faction, or secret)
2. Notes one thing that makes this world unusual or intriguing
3. Ends with one concrete suggestion for what to do next (simulate, add lore, start an adventure)
Do NOT be generic. Context: ${buildWorldContext()}`,
      { maxTokens: 200 }
    );
    setNav('oracle');
    renderOracleRoleBar();
    const msgs = $('chatMsgs');
    const cited = addCitationLinks(raw, W);
    msgs.innerHTML += `<div class="msg-oracle-guide">${cited}</div>`;
    msgs.scrollTop = msgs.scrollHeight;
    AppState.chatHistory.push({ role: 'assistant', content: raw });
    saveOracleChat();
  } catch (_) {}
}

/** Ask Oracle about a specific named entry — triggered from lore panel or map */
function oracleAbout(name) {
  $('chatInput').value = `Tell me everything about ${name} — their role, secrets, and how they connect to the rest of the world.`;
  setNav('oracle');
  sendChat();
}

/** Load persisted chat for this world and restore it to the UI */
function restoreOracleChat() {
  const history = loadOracleChat();
  if (!history.length) return;

  AppState.chatHistory = history;
  const msgs = $('chatMsgs');
  const W = AppState.world;

  // Rebuild the visible chat from history
  msgs.innerHTML = '';
  history.forEach(msg => {
    if (msg.role === 'user') {
      msgs.innerHTML += `<div class="msg-user">${esc(msg.content)}</div>`;
    } else {
      const { cleanReply, proposal } = extractProposal(msg.content);
      const cited = addCitationLinks(cleanReply, W);
      msgs.innerHTML += `<div class="msg-ai">${cited}</div>`;
      // Don't re-render old proposal cards — they've already been acted on
    }
  });

  if (history.length > 0) {
    msgs.innerHTML += `<div class="msg-role-change">— Chat history restored —</div>`;
  }
  msgs.scrollTop = msgs.scrollHeight;
}

function clearChat() {
  AppState.chatHistory = [];
  clearOracleChat();
  const W = AppState.world;
  $('chatMsgs').innerHTML = W
    ? `<div class="msg-ai">I am the Oracle of <em>${esc(W.worldName)}</em>. Ask me anything — I am your guide, narrator, and dungeon master.</div>`
    : `<div class="msg-ai">Forge a world to awaken the Oracle.</div>`;
}

/* ════════════════════════════════════════════════
   SAVE / EXPORT / IMPORT
════════════════════════════════════════════════ */
function doSave() {
  const r=saveCurrentWorld();
  if(r.ok) showToast('World saved!');
  else showToast(`Save failed: ${r.error}`);
}

function exportJSON() {
  if(!hasWorld()){showToast('No world to export.');return;}
  const blob=new Blob([JSON.stringify(AppState.world,null,2)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);
  a.download=`${(AppState.world.worldName||'world').replace(/\s+/g,'_')}_codex.json`;
  a.click(); URL.revokeObjectURL(a.href);
  diagLog('ok','World exported');
}

function importWorldFile(file) {
  if(!file) return;
  const reader=new FileReader();
  reader.onload=e=>{
    try {
      const raw=JSON.parse(e.target.result);
      const {valid,errors}=validateWorld(raw);
      if(!valid) throw new Error(errors.join(', '));
      AppState.world=normalizeWorld(raw);
      AppState.world._slotId='imported_'+Date.now();
      saveCurrentWorld();
      initNovaState(); initWorld();
      diagLog('ok',`World "${AppState.world.worldName}" imported`);
    } catch(err){showToast(`Import failed: ${err.message}`);diagLog('err',`Import failed: ${err.message}`);}
  };
  reader.readAsText(file);
}

/* ════════════════════════════════════════════════
   TOAST
════════════════════════════════════════════════ */
function showToast(msg) {
  let t=$('lf-toast');
  if(!t){t=document.createElement('div');t.id='lf-toast';t.style.cssText='position:fixed;top:1rem;left:50%;transform:translateX(-50%);background:#100e0a;border:1px solid var(--bord);border-radius:4px;padding:.6rem 1rem;font-family:var(--fb);font-size:.88rem;color:var(--parch-dim);z-index:500;box-shadow:0 4px 20px rgba(0,0,0,.6);max-width:360px;text-align:center';document.body.appendChild(t);}
  t.textContent=msg; t.style.display='block';
  clearTimeout(t._t); t._t=setTimeout(()=>{t.style.display='none';},3500);
}

/* ════════════════════════════════════════════════
   MAP TOOLTIP
════════════════════════════════════════════════ */
function showMapTooltip(e,text) {
  const tip=$('tooltip'),wrap=$('mapWrap'); if(!tip||!wrap) return;
  const rect=wrap.getBoundingClientRect();
  tip.textContent=text; tip.classList.add('visible');
  tip.style.left=`${e.clientX-rect.left+14}px`; tip.style.top=`${e.clientY-rect.top-12}px`;
}
function hideMapTooltip(){$('tooltip')?.classList.remove('visible');}

/* ════════════════════════════════════════════════
   EVENT BINDING
════════════════════════════════════════════════ */
function bindEvents() {
  // Login tabs
  document.querySelectorAll('.login-tab').forEach(tab=>{
    tab.addEventListener('click',()=>{
      document.querySelectorAll('.login-tab,.login-panel').forEach(e=>e.classList.remove('active'));
      tab.classList.add('active'); $(`panel-${tab.dataset.tab}`)?.classList.add('active');
    });
  });

  // Login button
  $('btnLogin').addEventListener('click',()=>{
    const u=$('loginUsername').value.trim();
    const p=$('loginPassword').value;
    $('loginError').textContent='';
    if(!u||!p){$('loginError').textContent='Enter username and password.';return;}
    const r=loginUser(u,p);
    if(!r.ok){$('loginError').textContent=r.error;return;}
    loadHub();
  });

  // Register button
  $('btnRegister').addEventListener('click',()=>{
    const u=$('regUsername').value.trim();
    const p=$('regPassword').value;
    $('registerError').textContent='';
    if(!u||!p){$('registerError').textContent='Choose a username and password.';return;}
    if(p.length<4){$('registerError').textContent='Password must be at least 4 characters.';return;}
    const r=registerUser(u,p);
    if(!r.ok){$('registerError').textContent=r.error;return;}
    loginUser(u,p);
    loadHub();
  });

  // Enter key on login form
  [$('loginUsername'),$('loginPassword')].forEach(el=>{
    el?.addEventListener('keydown',e=>{if(e.key==='Enter')$('btnLogin').click();});
  });
  [$('regUsername'),$('regPassword')].forEach(el=>{
    el?.addEventListener('keydown',e=>{if(e.key==='Enter')$('btnRegister').click();});
  });

  // API Key settings modal
  $('btnApiKeySettings')?.addEventListener('click', openApiKeyModal);
  $('btnApiKeyCancel')?.addEventListener('click', () => closeModal('apiKeyModal'));
  $('btnApiKeySave')?.addEventListener('click', () => {
    const val = $('apiKeyInput').value.trim();
    if (!val) { showToast('Enter a key or cancel.'); return; }
    if (!val.startsWith('sk-ant-')) {
      if (!confirm('That does not look like an Anthropic API key (sk-ant-…). Save it anyway?')) return;
    }
    saveApiKey(val);
    closeModal('apiKeyModal');
    // Hide hub banner
    const banner = $('hubApiBanner');
    if (banner) banner.style.display = 'none';
    showToast('API key saved.');
  });
  $('apiKeyInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btnApiKeySave')?.click();
  });

  // Hub
  $('btnLogout').addEventListener('click',()=>{logoutUser();showScreen('login');});
  $('btnNewWorld').addEventListener('click',()=>{
    // Require API key before world creation
    if (!loadApiKey()) { openApiKeyModal(); showToast('Set your API key first.'); return; }
    startInterview();
  });
  $('btnImportWorld').addEventListener('click',()=>$('importFile').click());
  $('importFile').addEventListener('change',e=>{if(e.target.files[0])importWorldFile(e.target.files[0]);e.target.value='';});

  // Interview
  $('btnInterviewNext').addEventListener('click',advanceInterview);
  $('btnInterviewBack').addEventListener('click',retreatInterview);
  $('btnSurpriseStep').addEventListener('click',surpriseStep);

  // Nav rail
  document.querySelectorAll('.nav-btn[data-nav]').forEach(btn=>{
    btn.addEventListener('click',()=>{if(!hasWorld()&&!['map'].includes(btn.dataset.nav))return;setNav(btn.dataset.nav);});
  });
  document.querySelectorAll('.nav-btn[data-screen]').forEach(btn=>{
    btn.addEventListener('click',()=>showScreen(btn.dataset.screen));
  });

  // Map toolbar
  $('btnSimToggle').addEventListener('click',()=>setNav('nova'));
  $('btnDndToggle').addEventListener('click',()=>setNav('dnd'));
  $('btnExport').addEventListener('click',exportJSON);
  $('btnSaveNow').addEventListener('click',doSave);

  // Map overlay pills
  document.querySelectorAll('.map-pill').forEach(pill => {
    pill.addEventListener('click', () => setMapOverlay(pill.dataset.overlay));
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    // Ignore if typing in an input/textarea
    const inField = ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName);

    // Esc closes any open modal
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
      return;
    }

    if (inField) return;

    // Only active when on main screen with a world loaded
    if (!hasWorld()) return;
    if (!$('screen-main')?.classList.contains('active')) return;

    // Cmd/Ctrl+K → Oracle
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setNav('oracle');
      setTimeout(() => $('chatInput')?.focus(), 50);
      return;
    }

    // Cmd/Ctrl+S → manual save
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      doSave();
      return;
    }

    // Bare keys: only when not holding modifiers
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;

    switch (e.key.toLowerCase()) {
      case 'm': setNav('map'); break;
      case 'n': setNav('nova'); break;
      case 'a': setNav('dnd'); break;
      case 'o': setNav('oracle'); setTimeout(() => $('chatInput')?.focus(), 50); break;
      case ' ':
        // Space → step Nova if on Nova view
        if (AppState.activeNav === 'nova') {
          e.preventDefault();
          runSimStep();
        }
        break;
      case '1': setMapOverlay('illustrated'); break;
      case '2': setMapOverlay('political'); break;
      case '3': setMapOverlay('stability'); break;
    }
  });

  // Region modal close
  $('btnRegionClose').addEventListener('click',()=>closeModal('regionModal'));
  $('regionModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal('regionModal');});

  // Nova
  $('btnSimPlay').addEventListener('click',startSimulation);
  $('btnSimStep').addEventListener('click',runSimStep);
  $('btnSimReset').addEventListener('click',resetSimulation);
  $('btnNovaCustom').addEventListener('click',applyCustomIntervention);
  $('novaCustomInput').addEventListener('keydown',e=>{if(e.key==='Enter')applyCustomIntervention();});

  // Adventure Mode
  $('btnDndToggle').addEventListener('click', () => setNav('dnd'));
  $('btnAdvBegin')?.addEventListener('click', beginAdventure);
  $('btnAdvRestart')?.addEventListener('click', () => { resetAdventure(true); setNav('dnd'); });

  // Adventure mid-run save
  $('btnAdvSave')?.addEventListener('click', () => {
    if (!AppState.adventure.active) { showToast('No active adventure to save.'); return; }
    const label = prompt('Name this save point (or leave blank):', `Chapter ${AppState.adventure.chapter}`);
    if (label === null) return;  // user cancelled
    const result = saveAdventureState(label.trim() || `Chapter ${AppState.adventure.chapter}`);
    showToast(result.ok ? `Saved: ${label || 'Chapter ' + AppState.adventure.chapter}` : `Save failed: ${result.error}`);
  });

  // Adventure load — show list modal
  $('btnAdvLoad')?.addEventListener('click', () => {
    const saves = getAdventureSaves();
    const list = $('advLoadList');
    if (!saves.length) {
      list.innerHTML = '<div class="adv-empty-note">No saved adventures for this world yet.</div>';
    } else {
      list.innerHTML = saves.map((s, i) => `
        <div class="adv-load-row">
          <div class="adv-load-info">
            <div class="adv-load-label">${esc(s.label)}</div>
            <div class="adv-load-meta">
              ${esc(s.adventure.playerName || 'Unnamed')} · ${esc(s.adventure.playerArchetype?.label || '')} ·
              Ch.${s.adventure.chapter} · ${new Date(s.savedAt).toLocaleString()}
            </div>
          </div>
          <div class="adv-load-actions">
            <button class="btn-sm adv-load-btn" data-load-idx="${i}">▷ Load</button>
            <button class="btn-sm adv-load-del" data-del-idx="${i}" title="Delete">✕</button>
          </div>
        </div>`).join('');

      list.querySelectorAll('.adv-load-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.loadIdx, 10);
          const r = loadAdventureSave(idx);
          if (r.ok) {
            closeModal('advLoadModal');
            const setup = $('advSetup'), game = $('advGame');
            if (setup) setup.style.display = 'none';
            if (game)  game.classList.add('visible');
            renderAdventureCharacterCard();
            renderFactionStandings();
            renderAdventureHealth();
            renderAdventureInventory();
            renderAdventureNpcs();
            renderAdventureEnvironment();
            $('advChapterBadge').textContent = `Chapter ${AppState.adventure.chapter}`;
            // Rebuild journey log
            const logEl = $('advLog');
            if (logEl) {
              logEl.innerHTML = (AppState.adventure.history || []).map(h => `
                <div class="adv-log-entry">
                  <div class="adv-log-chapter">Chapter ${h.chapter}</div>
                  <div class="adv-log-choice">→ ${esc(h.choiceText)}</div>
                </div>`).join('');
            }
            // Re-open the current scene by continuing from last choice
            const lastChoice = AppState.adventure.history.slice(-1)[0]?.choiceText;
            generateAdventureScene('CONTINUATION', lastChoice || 'The story resumes.');
            showToast('Adventure loaded.');
          } else {
            showToast(`Load failed: ${r.error}`);
          }
        });
      });

      list.querySelectorAll('.adv-load-del').forEach(btn => {
        btn.addEventListener('click', () => {
          if (!confirm('Delete this save?')) return;
          deleteAdventureSave(parseInt(btn.dataset.delIdx, 10));
          $('btnAdvLoad').click();  // refresh the list
        });
      });
    }
    openModal('advLoadModal');
  });
  $('btnAdvLoadClose')?.addEventListener('click', () => closeModal('advLoadModal'));

  // Item detail modal
  $('btnItemDetailClose')?.addEventListener('click', () => closeModal('itemDetailModal'));
  $('itemDetailModal')?.addEventListener('click', e => {
    if (e.target.id === 'itemDetailModal') closeModal('itemDetailModal');
  });

  // Oracle
  $('chatSendBtn').addEventListener('click',sendChat);
  $('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}});
  $('btnClearChat').addEventListener('click', clearChat);

  // Oracle "Suggest something to add" — triggers a proposal on demand
  $('btnOracleSuggest')?.addEventListener('click', async () => {
    if (!hasWorld()) { showToast('Forge a world first.'); return; }
    const btn = $('btnOracleSuggest');
    btn.disabled = true; btn.textContent = '…';
    try {
      const W   = AppState.world;
      const raw = await callApi(
        `You are the Oracle for "${W.worldName}". Analyze the current world and suggest ONE new lore entry that would meaningfully enrich it.
Context: ${buildWorldContext()}
Pick the category where the world feels most incomplete or where a new entry would create interesting tension.
Return ONLY JSON with a proposal:
[PROPOSE:{"category":"characters|factions|artifacts|prophecies|history","entry":{"name":"X","role or type":"Y","description":"Z","secret":"W"}}]
After the proposal token, write 1 sentence explaining why this addition would enrich the world.`,
        { maxTokens: 300 }
      );
      // Post to chat
      setNav('oracle');
      const msgs = $('chatMsgs');
      const { cleanReply, proposal } = extractProposal(raw);
      msgs.innerHTML += `<div class="msg-oracle-guide">${esc(cleanReply)}</div>`;
      if (proposal) renderProposalCard(proposal, msgs);
      msgs.scrollTop = msgs.scrollHeight;
      AppState.chatHistory.push({ role: 'assistant', content: raw });
      saveOracleChat();
    } catch (err) {
      showToast(`Suggest failed: ${err.message}`);
    }
    btn.disabled = false; btn.textContent = '✦ Suggest Addition';
  });
  document.querySelectorAll('.oracle-prompt-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{$('chatInput').value=btn.dataset.q;setNav('oracle');sendChat();});
  });

  // Diagnostics
  $('diagToggle').addEventListener('click',toggleDiag);
  $('diagClose').addEventListener('click',closeDiag);
  $('btnQuickScan').addEventListener('click',()=>runScan(false));
  $('btnDeepScan').addEventListener('click',()=>runScan(true));
  $('btnHeal').addEventListener('click',executeRepairs);
  $('btnClearLog').addEventListener('click',()=>{$('diagLog').innerHTML='';diagLog('info','Log cleared');});
}

/* ════════════════════════════════════════════════
   BOOT
════════════════════════════════════════════════ */
function boot() {
  initDiagnostics();
  bindEvents();

  // Try to restore session
  if(restoreSession()) {
    loadHub();
  } else {
    showScreen('login');
  }

  setTimeout(()=>runScan(false),1200);
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',boot);
} else {
  boot();
}
