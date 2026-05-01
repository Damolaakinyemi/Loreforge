/**
 * nova.js — Nova Sim engine
 *
 * Stage 4 of the app.js split. Owns the simulation loop and intervention
 * pipeline. Self-contained except for five side-effect hooks (setNav,
 * sendChat, renderMap, renderMiniMapView, updatePanelNova) which are
 * wired in by app.js at boot.
 *
 * Entry points (called from app.js wiring):
 *   - renderNovaInterventions()  — repaints the intervention button row
 *   - runSimStep()               — advance one epoch
 *   - applyCustomIntervention()  — handle the user's typed intervention
 *   - startSimulation() / stopSimulation()  — toggle auto-run
 *   - resetSimulation()          — wipe events & restart
 *   - exportTimeline()           — download events as text
 *   - initNovaHooks(hooks)       — wire side-effect callbacks
 */

import {
  AppState, INTERVENTION_OPTIONS,
  hasWorld, buildWorldContext, saveCurrentWorld,
} from './state.js';
import { callApi, parseJsonResponse } from './apiService.js';
import { $, esc, showToast } from './utils.js';

let _hooks = {
  setNav: null,
  sendChat: null,
  renderMap: null,
  renderMiniMapView: null,
  updatePanelNova: null,
  initNovaState: null,
};

/** Wire side-effect callbacks. Call once at app startup. */
export function initNovaHooks(hooks) {
  _hooks = { ..._hooks, ...hooks };
}

/* ════════════════════════════════════════════════
   NOVA SIMULATION
════════════════════════════════════════════════ */
export function renderNovaInterventions() {
  const el=$('novaOptions'); if(!el) return;
  el.innerHTML=INTERVENTION_OPTIONS.map(opt=>`<button class="nova-option-btn" data-prompt="${esc(opt.prompt)}">${esc(opt.label)}</button>`).join('');
  el.querySelectorAll('.nova-option-btn').forEach(btn=>btn.addEventListener('click',()=>applyIntervention(btn.dataset.prompt)));
}

export async function runSimStep() {
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

  _hooks.renderMiniMapView?.();
  _hooks.renderMap?.();
  _hooks.updatePanelNova?.();
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
    _hooks.setNav?.('oracle');
    document.getElementById('chatInput').value=`It's Year ${sim.year}. ${msg} What should I do?`;
    _hooks.sendChat?.();
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
  _hooks.renderMiniMapView?.(); _hooks.renderMap?.(); _hooks.updatePanelNova?.(); saveCurrentWorld();
}

export async function applyCustomIntervention() {
  const input=$('novaCustomInput'),text=input.value.trim(); if(!text) return;
  input.value=''; await applyIntervention(text);
}

export function startSimulation() {
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

export function resetSimulation() {
  stopSimulation();
  _hooks.initNovaState?.();
  $('novaYear').textContent='Year 0';
  $('novaLog').innerHTML='<div class="nova-empty">Simulation reset. Run again to begin a new history.</div>';
  $('novaOracleStrip').style.display='none';
  _hooks.renderMiniMapView?.(); _hooks.renderMap?.(); _hooks.updatePanelNova?.();
}

export function exportTimeline() {
  const evts=AppState.nova.events;
  if(!evts.length){showToast('Run the simulation first.');return;}
  const text=evts.map(e=>`Year ${e.year}: ${e.text}`).join('\n\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type:'text/plain'}));
  a.download=`${(AppState.world?.worldName||'world').replace(/\s+/g,'_')}_timeline.txt`;
  a.click(); URL.revokeObjectURL(a.href);
}
