/**
 * interview.js — World creation interview wizard
 *
 * Stage 2 of the app.js split. Owns the multi-step interview flow that
 * gathers user input and forges a world from it. Self-contained except
 * for three side-effect hooks the caller passes in (initNovaState,
 * initWorld, oracleProactiveGreeting) — those belong to other modules
 * and are wired in by app.js when it calls advanceInterview.
 *
 * Entry points (called from app.js event handlers):
 *   - startInterview(forceFresh)
 *   - advanceInterview(hooks)
 *   - retreatInterview()
 *   - surpriseStep()
 *
 * The hooks parameter for advanceInterview is forwarded to forgeWorldFromInterview
 * on the final step. Shape: { initNovaState, initWorld, oracleProactiveGreeting }.
 */

import {
  AppState, INTERVIEW_STEPS, TASTE_DIALS, STYLE_PRESETS, LOAD_PHRASES,
  normalizeWorld, validateWorld,
  saveInterviewProgress, loadInterviewProgress, clearInterviewProgress,
  saveCurrentWorld,
} from './state.js';
import { callApi, parseJsonResponse } from './apiService.js';
import { diagLog, recordDiagError } from './diagnostics.js';
import {
  $, esc, showScreen, showToast, openModal, closeModal,
  formatAlternativePreview,
} from './utils.js';


/* ════════════════════════════════════════════════
   INTERVIEW WIZARD v2 — with dials, locks, re-rolls
════════════════════════════════════════════════ */

/** Start fresh interview OR resume existing one if available */
export function startInterview(forceFresh = false) {
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

export async function advanceInterview(hooks) {
  collectStep();
  if (!validateStep()) return;
  if (AppState.interview.step + 1 >= INTERVIEW_STEPS.length) {
    await forgeWorldFromInterview(hooks);
  } else {
    AppState.interview.step++;
    saveInterviewProgress();
    renderInterviewStep();
  }
}

export function retreatInterview() {
  if (AppState.interview.step > 0) {
    AppState.interview.step--;
    saveInterviewProgress();
    renderInterviewStep();
  }
}

/** Surprise Me — fill entire step with AI using dials + preset, with retry */
export async function surpriseStep() {
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
async function forgeWorldFromInterview(hooks = {}) {
  const a=AppState.interview.answers;
  showScreen('loading');
  let pi=0;
  const lt=$('loadingText');
  const iv=setInterval(()=>{lt.textContent=LOAD_PHRASES[pi++%LOAD_PHRASES.length];},2200);

  try {
    $('loadingSub').textContent='Placing regions on the map…';
    const userRegions=(a.regions||[]).filter(r=>r.name);
    const userFactions=(a.factions||[]).filter(f=>f.name);

    // Build faction context for the placement prompt — let the LLM choose
    // which faction controls each region instead of relying on later guesswork
    const factionList = userFactions.length
      ? userFactions.map(f => `${f.name}${f.region ? ` (based in ${f.region})` : ''}`).join('; ')
      : 'no factions defined';

    const regRaw=await callApi(
      `Assign map coordinates and a controlling faction for each region in world "${a.worldName}" (${a.genre}).

Regions: ${userRegions.map((r,i)=>`${i+1}. ${r.name} — ${r.type||'unknown terrain'}`).join('; ')}
Factions: ${factionList}

For each region:
- Place x,y on a 900x580 canvas, spread evenly with good spacing
- Pick a muted fantasy hex color
- Assign the most plausible controllingFaction by name (use one of the faction names listed above, or null if no faction fits — e.g., wilderness, neutral zones, contested borderlands)

Return ONLY a JSON array, one object per region: {"name":"exact name","x":300,"y":280,"radius":70,"color":"#4a6a8a","id":"r0","controllingFaction":"faction name or null"}`,
      {maxTokens:700}
    );

    let coords=[];
    try {
      const cl=regRaw.replace(/```json\s*/gi,'').replace(/```\s*/g,'').trim();
      coords=JSON.parse(cl.slice(cl.indexOf('['),cl.lastIndexOf(']')+1));
    } catch(_) {}

    // Build a faction-name lookup so we can validate the LLM's choice
    const factionNames = new Set(userFactions.map(f => f.name.toLowerCase()));

    const finalRegions=userRegions.map((r,i)=>{
      const c=coords.find(x=>x.name===r.name)||coords[i]||{};
      // Validate the controllingFaction — only accept a real faction name
      let cf = null;
      if (c.controllingFaction && typeof c.controllingFaction === 'string') {
        const proposed = c.controllingFaction.trim();
        if (factionNames.has(proposed.toLowerCase())) {
          cf = userFactions.find(f => f.name.toLowerCase() === proposed.toLowerCase()).name;
        }
      }
      return {
        id:c.id||`r${i}`,name:r.name,type:r.type||'',description:r.description||'',secret:r.secret||'',
        x:Math.max(80,Math.min(820,parseFloat(c.x)||100+i*120)),
        y:Math.max(80,Math.min(500,parseFloat(c.y)||200+((i%2)*160))),
        radius:Math.max(50,Math.min(100,parseFloat(c.radius)||70)),
        color:c.color||['#4a6a8a','#5a4a6a','#4a6a4a','#6a4a4a','#4a5a6a','#6a5a4a'][i%6],
        controllingFaction: cf,
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
    hooks.initNovaState?.();
    hooks.initWorld?.();
    diagLog('ok',`World "${AppState.world.worldName}" forged`);

    // Oracle greeting after world creation
    setTimeout(()=>hooks.oracleProactiveGreeting?.(),1500);

  } catch(err) {
    clearInterval(iv);
    recordDiagError('world_forge',err.message);
    showScreen('interview');
    showToast(`World generation failed: ${err.message}`);
  }
}
