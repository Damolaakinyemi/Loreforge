/**
 * adventure.js — Loreforge text-adventure mode
 *
 * Stage 3 of the app.js split. Owns the entire adventure pipeline:
 *   - Setup (faction/origin/archetype selection)
 *   - Scene generation (parallel narrative + structured calls)
 *   - Choice resolution and consequence application
 *   - NPC roster management, environmental scavenging
 *   - Objective tracking with win/loss conditions
 *   - Failure states (captured / disgraced / exhausted / dead)
 *   - Legacy chain continuation
 *   - The right-hand panel content for the dnd nav
 *
 * Entry points (called from app.js wiring):
 *   - showAdventureSetup()       — show setup screen
 *   - resetAdventure(fullReset)  — clear adventure state
 *   - beginAdventure()           — start a new run after setup
 *   - generateAdventureScene(...) — used by save-restore
 *   - updatePanelAdventure()     — render the side panel
 *   - restoreAdventureFromSave() — full UI restore after loading a save
 *   - initAdventureHooks(hooks)  — wire setNav + sendChat callbacks
 *
 * The module exposes a few render helpers too because the load-save flow
 * in app.js needs to repaint the screen.
 */

import {
  AppState, ARCHETYPES, normalizeWorld, hasWorld,
  buildWorldContext, saveCurrentWorld,
} from './state.js';
import { callApi, parseJsonResponse, ApiError } from './apiService.js';
import { diagLog, recordDiagError } from './diagnostics.js';
import {
  $, esc, showToast, openModal, closeModal,
  addCitationLinks, describeStatusContext, typeReuseHint,
  findOrCreateNpcKey, pruneStaleNpcs,
} from './utils.js';
import { renderMiniMap } from './map.js';

// Side-effect callbacks set by app.js at startup time. Stored in a module-private
// closure so the adventure functions don't need to thread them through every call.
let _hooks = { setNav: null, sendChat: null };

/** Wire the side-effect hooks. Call once at app startup. */
export function initAdventureHooks(hooks) {
  _hooks = { ..._hooks, ...hooks };
}

/* ════════════════════════════════════════════════
   ADVENTURE MODE v2 — lore-grounded choose-your-story
════════════════════════════════════════════════ */

/**
 * Show the adventure setup screen — faction and origin selection.
 * Called when the user navigates to the adventure view.
 */
export function showAdventureSetup() {
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
export function resetAdventure(fullReset = false) {
  const preservedLegacy = fullReset ? [] : (AppState.adventure.legacyChain || []);
  AppState.adventure = {
    active: false, chapter: 0, playerName: '', playerFaction: null,
    playerOrigin: null, playerBg: '', playerArchetype: null,
    factionStanding: {}, currentRegion: null, history: [],
    currentChoices: [], worldImpacts: [],
    npcs: {}, environment: {},
    objectives: [], playerStatus: 'active', statusContext: null,
    legacyChain: preservedLegacy,
  };
  AppState.adventureInventory = {
    items: [], health: 100, maxHealth: 100,
    exhaustion: 0, maxExhaustion: 100,
    suspicion: 0,  maxSuspicion: 100,
    keyInsights: [], achievements: [],
  };
  const setup = $('advSetup'), game = $('advGame');
  if (setup) setup.style.display = 'block';
  if (game)  game.classList.remove('visible');
  if (hasWorld()) showAdventureSetup();
}

/** Begin the adventure after setup is complete */
export async function beginAdventure() {
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

  // Fresh NPC roster, environment cache, and objectives for this run
  adv.npcs        = {};
  adv.environment = {};
  adv.objectives  = [];

  // Max health gets a small bonus from strength attribute
  const strengthBonus = Math.round((adv.playerArchetype.stats.strength - 25) / 2);
  const maxHealth = Math.max(50, Math.min(150, 100 + strengthBonus));
  // Endurance bonus to exhaustion ceiling — scholarly types tire faster
  const endurance = Math.max(80, Math.min(140, 100 + strengthBonus));
  AppState.adventureInventory = {
    items: [], health: maxHealth, maxHealth,
    exhaustion: 0, maxExhaustion: endurance,
    suspicion: 0,  maxSuspicion: 100,
    keyInsights: [], achievements: [],
  };
  // Reset to active — legacy continuation may have set this elsewhere
  adv.playerStatus = 'active';
  adv.statusContext = null;

  // Switch panels
  const setup = $('advSetup'), game = $('advGame');
  if (setup) setup.style.display = 'none';
  if (game)  game.classList.add('visible');

  renderAdventureCharacterCard();
  renderFactionStandings();
  renderAdventureHealth();
  renderAdventurePressure();
  renderAdventureStatusBanner();
  renderAdventureInventory();
  renderAdventureNpcs();
  renderAdventureEnvironment();
  renderObjectives();

  // Generate 2 starter items specific to this character before the story begins
  await generateStarterItems();

  // Generate three objectives that will define this run's win condition
  await generateObjectives();

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

/**
 * Generate three lore-grounded objectives for the adventure.
 * Each has a title, description, completionHint (so the LLM can later
 * recognize completion), and difficulty. Stored in adv.objectives.
 */
async function generateObjectives() {
  const W   = AppState.world;
  const adv = AppState.adventure;

  $('advNarrative').innerHTML = '<div class="adv-loading">The Oracle reveals what your story must become…</div>';

  try {
    const factionList = (W.factions || []).slice(0, 5).map(f => `${f.name} (${f.type || 'unknown'})`).join('; ') || 'no factions';
    const regionList  = (W.regions  || []).slice(0, 6).map(r => `${r.name} (${r.type || 'unknown'})`).join('; ') || 'no regions';
    const tensionList = (W.history  || []).slice(0, 3).map(h => h.event || h.name || '').filter(Boolean).join('; ') || '';

    const raw = await callApi(
      `Generate THREE objectives for an adventure in "${W.worldName}" (${W.genre}).

PLAYER: ${adv.playerName || 'a traveler'} from ${adv.playerOrigin?.name || 'unknown'}, member of ${adv.playerFaction?.name || 'no faction'}.
${adv.playerBg ? `BACKGROUND: ${adv.playerBg}` : ''}

WORLD CONTEXT:
- Factions: ${factionList}
- Regions: ${regionList}
${tensionList ? `- Recent history: ${tensionList}` : ''}

OBJECTIVE RULES — CRITICAL:
- All three must be GROUNDED in the world's specific lore. No generic "save the kingdom" — name actual factions, regions, conflicts, items.
- The three should feel different in shape: one INVESTIGATIVE (find truth, recover knowledge), one RELATIONAL (deal with a person or faction), one PHYSICAL (reach a place, recover an object, survive an event).
- Each must be COMPLETABLE in 10-25 chapters. Not too easy, not impossible.
- Difficulty: assign "low", "moderate", or "high" honestly based on the obstacles named.
- The completionHint MUST describe a concrete event that the system can recognize: e.g., "Player reaches the [region X]" or "Player recovers an item described as a [thing]" or "Player wins faction [Y] standing of +50 or higher".

Return ONLY valid JSON:
{
  "objectives": [
    {
      "title": "Short title (4-7 words)",
      "description": "1-2 sentences explaining the goal in plain language, grounded in this world's lore",
      "completionHint": "Specific completable event (e.g., 'Reach the Verdant Reach' or 'Recover the Crystalline Shard' or 'Earn +50 standing with the Iron Throne')",
      "difficulty": "low|moderate|high"
    },
    {"title": "...", "description": "...", "completionHint": "...", "difficulty": "..."},
    {"title": "...", "description": "...", "completionHint": "...", "difficulty": "..."}
  ]
}`,
      { maxTokens: 800 }
    );

    const data = parseJsonResponse(raw);
    const list = Array.isArray(data.objectives) ? data.objectives.slice(0, 3) : [];
    if (list.length < 3) throw new Error(`Only ${list.length} objectives returned`);

    adv.objectives = list.map((o, i) => ({
      id:               `obj_${i}`,
      title:            String(o.title || `Objective ${i + 1}`),
      description:      String(o.description || ''),
      completionHint:   String(o.completionHint || ''),
      difficulty:       ['low','moderate','high'].includes(o.difficulty) ? o.difficulty : 'moderate',
      status:           'active',
      progress:         0,
      completedChapter: null,
    }));

    renderObjectives();
  } catch (err) {
    diagLog('warn', `Objective generation failed, using fallbacks: ${err.message}`);
    // Fallback — generic but world-flavored objectives so the game still has stakes
    const W = AppState.world;
    const firstRegion  = W.regions?.[0]?.name  || 'an unknown land';
    const firstFaction = W.factions?.[0]?.name || 'a hostile faction';
    adv.objectives = [
      { id:'obj_0', title:'Discover the Truth', description:`Uncover what's really happening in ${W.worldName}.`, completionHint:'Player gains a major insight about the world', difficulty:'moderate', status:'active', progress:0, completedChapter:null },
      { id:'obj_1', title:'Forge an Alliance',  description:`Earn the trust of ${firstFaction} or another major power.`, completionHint:`Earn +50 standing with any faction`, difficulty:'moderate', status:'active', progress:0, completedChapter:null },
      { id:'obj_2', title:'Reach the Heart',    description:`Travel to ${firstRegion} and survive what waits there.`, completionHint:`Player reaches ${firstRegion}`, difficulty:'high', status:'active', progress:0, completedChapter:null },
    ];
    renderObjectives();
  }
}

/** Render the persistent objectives panel above the narrative. */
function renderObjectives() {
  const adv = AppState.adventure;
  const container = $('advObjectives');
  if (!container) return;
  const objs = adv.objectives || [];
  if (!objs.length) {
    container.innerHTML = '';
    container.style.display = 'none';
    return;
  }
  container.style.display = '';

  const completedCount = objs.filter(o => o.status === 'completed').length;
  const failedCount    = objs.filter(o => o.status === 'failed').length;

  const icon = (s) => s === 'completed' ? '✓' : s === 'failed' ? '✕' : '◇';
  const diffSwatch = (d) => `<span class="adv-obj-diff adv-obj-diff-${d}">${d}</span>`;

  container.innerHTML = `
    <div class="adv-obj-head">
      <span class="adv-obj-title">Objectives</span>
      <span class="adv-obj-count">${completedCount} of ${objs.length} complete${failedCount ? ` · ${failedCount} failed` : ''}</span>
      <button class="adv-obj-toggle" id="advObjToggle" aria-label="Collapse">−</button>
    </div>
    <div class="adv-obj-list" id="advObjList">
      ${objs.map(o => `
        <div class="adv-obj-card adv-obj-${o.status}">
          <div class="adv-obj-row">
            <span class="adv-obj-icon">${icon(o.status)}</span>
            <span class="adv-obj-name">${esc(o.title)}</span>
            ${diffSwatch(o.difficulty)}
          </div>
          <div class="adv-obj-desc">${esc(o.description)}</div>
          ${o.status === 'active' && o.progress > 0 ? `<div class="adv-obj-prog"><div class="adv-obj-prog-fill" style="width:${o.progress}%"></div></div>` : ''}
        </div>`).join('')}
    </div>`;

  $('advObjToggle')?.addEventListener('click', () => {
    const list = $('advObjList');
    const btn  = $('advObjToggle');
    if (!list || !btn) return;
    if (list.style.display === 'none') {
      list.style.display = '';
      btn.textContent = '−';
    } else {
      list.style.display = 'none';
      btn.textContent = '+';
    }
  });
}

/**
 * Apply a progress/status update to an objective. Returns true if the call
 * resulted in win or loss (game over) so the caller can branch.
 */
function applyObjectiveUpdate(update) {
  if (!update || !update.id) return false;
  const adv = AppState.adventure;
  const obj = (adv.objectives || []).find(o => o.id === update.id);
  if (!obj || obj.status !== 'active') return false;

  if (update.status === 'advanced' && typeof update.progress === 'number') {
    obj.progress = Math.max(obj.progress, Math.min(100, update.progress));
    showToast(`◇ Progress: ${obj.title}`);
  } else if (update.status === 'completed') {
    obj.status = 'completed';
    obj.progress = 100;
    obj.completedChapter = adv.chapter;
    showToast(`✓ Objective complete: ${obj.title}`);
  } else if (update.status === 'failed') {
    obj.status = 'failed';
    obj.completedChapter = adv.chapter;
    showToast(`✕ Objective failed: ${obj.title}`);
  }

  renderObjectives();
  return checkObjectiveEndGame();
}

/** Check if all objectives complete (win) or any failed (lose). */
function checkObjectiveEndGame() {
  const adv = AppState.adventure;
  const objs = adv.objectives || [];
  if (!objs.length) return false;

  const allComplete = objs.every(o => o.status === 'completed');
  const anyFailed   = objs.some(o => o.status === 'failed');

  if (allComplete) {
    handleAdventureVictory();
    return true;
  }
  if (anyFailed) {
    handleAdventureLoss('An objective was lost beyond recovery.');
    return true;
  }
  return false;
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

/**
 * Render the two pressure meters (exhaustion + suspicion) — sit beneath the
 * health bar and replace it as the primary feel of "danger."
 */
function renderAdventurePressure() {
  const inv = AppState.adventureInventory;
  const container = $('advPressure');
  if (!container) return;

  const exPct = Math.round(100 * (inv.exhaustion || 0) / (inv.maxExhaustion || 100));
  const exColor = exPct >= 85 ? 'var(--err)' : exPct >= 65 ? 'var(--heal)' : exPct >= 35 ? 'var(--warn)' : 'var(--gold-dim)';
  const exLabel = exPct >= 85 ? 'Collapsing' : exPct >= 65 ? 'Worn' : exPct >= 35 ? 'Tired' : 'Fresh';

  const suPct = Math.round(100 * (inv.suspicion || 0) / (inv.maxSuspicion || 100));
  const suColor = suPct >= 75 ? 'var(--err)' : suPct >= 50 ? 'var(--heal)' : suPct >= 25 ? 'var(--warn)' : 'var(--gold-dim)';
  const suLabel = suPct >= 75 ? 'Wanted' : suPct >= 50 ? 'Watched' : suPct >= 25 ? 'Whispered' : 'Unseen';

  container.innerHTML = `
    <div class="adv-pressure-row">
      <div class="adv-pressure-label">Exhaustion</div>
      <div class="adv-pressure-track"><div class="adv-pressure-fill" style="width:${exPct}%;background:${exColor}"></div></div>
      <div class="adv-pressure-value" style="color:${exColor}">${exLabel}</div>
    </div>
    <div class="adv-pressure-row">
      <div class="adv-pressure-label">Suspicion</div>
      <div class="adv-pressure-track"><div class="adv-pressure-fill" style="width:${suPct}%;background:${suColor}"></div></div>
      <div class="adv-pressure-value" style="color:${suColor}">${suLabel}</div>
    </div>`;
}

/**
 * Status banner — shown above choices when the player is captured, disgraced,
 * or exhausted. Tells them what's happening and offers context.
 */
function renderAdventureStatusBanner() {
  const adv = AppState.adventure;
  const el  = $('advStatusBanner');
  if (!el) return;
  if (!adv.playerStatus || adv.playerStatus === 'active') {
    el.innerHTML = '';
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';
  const ctxText = describeStatusContext(adv);
  const map = {
    captured:  { icon: '⛓', label: 'CAPTURED',  cls: 'adv-status-captured' },
    disgraced: { icon: '✕', label: 'DISGRACED', cls: 'adv-status-disgraced' },
    exhausted: { icon: '☽', label: 'EXHAUSTED', cls: 'adv-status-exhausted' },
  };
  const cfg = map[adv.playerStatus] || { icon: '·', label: adv.playerStatus.toUpperCase(), cls: '' };
  el.className = `adv-status-banner ${cfg.cls}`;
  el.innerHTML = `
    <span class="adv-status-icon">${cfg.icon}</span>
    <span class="adv-status-text">
      <strong>${cfg.label}</strong>
      <span class="adv-status-detail">${esc(ctxText)}</span>
    </span>`;
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
    html += `<div class="adv-inv-head">Inventory <span class="adv-inv-count">(${inv.items.length})</span></div>`;
    html += `<div class="adv-inv-items">${inv.items.map((item, i) => {
      const cls = `adv-inv-item${item.used ? ' adv-inv-used' : ''}${item.cursed ? ' adv-inv-cursed' : ''}`;
      const badge = item.used ? '<span class="adv-inv-badge adv-inv-badge-used">used</span>'
                  : item.cursed ? '<span class="adv-inv-badge adv-inv-badge-cursed">cursed</span>'
                  : '';
      return `
      <div class="${cls}" data-item-idx="${i}">
        <span class="adv-inv-icon">◆</span>
        <span class="adv-inv-name">${esc(item.name)}</span>
        ${badge}
        <span class="adv-inv-chapter">${item.isStarter ? 'Starter' : `Ch.${item.obtainedChapter || '?'}`}</span>
      </div>`;
    }).join('')}</div>`;
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
      ${resources.map(r => {
        const risk = r.risk || 'safe';
        return `
        <div class="adv-env-item adv-env-risk-${risk}" title="${esc(r.description || '')}${risk !== 'safe' ? ` · risk: ${risk}` : ''}">
          <span class="adv-env-icon">${icons[r.type] || '◈'}</span>
          <span class="adv-env-name">${esc(r.name)}</span>
          <span class="adv-env-type">${esc(r.type || 'curio')}</span>
          ${risk !== 'safe' ? `<span class="adv-env-risk-badge">${risk}</span>` : ''}
        </div>`;
      }).join('')}
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
  if (item.cursed) {
    html += `<div class="item-modal-cursed">⚠ This item carries a curse.</div>`;
  }
  if (item.used) {
    html += `<div class="item-modal-used">This item has already been used.</div>`;
  }
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

  // Wire the Use button — only enabled when adventure is active and item isn't already used
  const useBtn = $('btnItemUse');
  if (useBtn) {
    const adv = AppState.adventure;
    const canUse = adv.active && !item.used && !isNewlyAcquired;
    useBtn.style.display = canUse ? 'inline-flex' : 'none';
    useBtn.onclick = () => useInventoryItem(item);
  }

  openModal('itemDetailModal');
}

/**
 * Use an inventory item — feeds the use into the next scene as a player action.
 * The Oracle resolves what happens narratively.
 *
 * Item is marked as "used" but kept in inventory (greyed out) unless it's
 * a consumable type (food, herb), in which case it's removed.
 */
async function useInventoryItem(item) {
  const adv = AppState.adventure;
  const inv = AppState.adventureInventory;
  if (!adv.active || item.used) return;

  closeModal('itemDetailModal');

  // Mark as used; consumables get removed from inventory
  const consumableTypes = ['food', 'herb'];
  const isConsumable = consumableTypes.some(t =>
    (item.usefulFor || '').toLowerCase().includes(t) ||
    (item.description || '').toLowerCase().includes(t)
  );

  if (isConsumable) {
    const idx = inv.items.findIndex(i => i.name === item.name);
    if (idx >= 0) inv.items.splice(idx, 1);
    showToast(`◆ Consumed: ${item.name}`);
  } else {
    item.used = true;
    showToast(`◆ Used: ${item.name}`);
  }

  renderAdventureInventory();
  saveCurrentWorld();

  // Synthetic choice that feeds into scene continuation as the player's action
  const useAction = `Uses the ${item.name} — ${item.usefulFor || 'with hopes it will help'}.`;
  await generateAdventureScene('CONTINUATION', useAction);
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
export async function generateAdventureScene(sceneType, prevChoice, retryAttempt = 0) {
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
    CAPTURED:     `The player has been captured by ${adv.statusContext?.capturedBy || 'their enemies'} after: "${prevChoice}". They are imprisoned, restrained, or held under guard. Describe the captivity. Choices should focus on: persuading captors, finding weakness in security, biding time, or attempting escape (mark canCapture=false but escapeAttempt=true on escape options). At least one choice must be a non-escape that builds toward freedom (gather info, win sympathy, exploit something).`,
    DISGRACED:    `The player is disgraced — ${(adv.statusContext?.disgracedWith || []).join(', ') || 'a faction'} actively wants them punished. The cause: "${adv.statusContext?.cause}". They are an outcast. Choices should focus on: rebuilding standing through service, fleeing the region entirely, finding an unlikely ally, or seeking redemption through a meaningful act.`,
    REST:         `The player has collapsed from exhaustion after: "${prevChoice}". This is a quiet recovery scene. They are resting somewhere — a barn, an inn, the open road, a stranger's hearth. The scene should be reflective and low-stakes. Choices reflect what the player notices, thinks about, or whom they meet quietly. ALL choices should have exhaustionChange of -10 to -25. NO physical danger.`,
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

    // Pressure-meter context — gives the LLM the data it needs to scale tension
    const exhaustionPct = Math.round(100 * inv.exhaustion / inv.maxExhaustion);
    const suspicionPct  = Math.round(100 * inv.suspicion / inv.maxSuspicion);
    const exhaustionLabel =
      exhaustionPct >= 85 ? 'CRITICAL — about to collapse'
      : exhaustionPct >= 65 ? 'high — physical actions feel costly'
      : exhaustionPct >= 35 ? 'moderate'
      : 'fresh';
    const suspicionLabel =
      suspicionPct >= 75 ? 'WANTED — strangers may report or detain'
      : suspicionPct >= 50 ? 'high — guards take notice'
      : suspicionPct >= 25 ? 'moderate — whispers follow you'
      : 'unnoticed';
    const statusLine = adv.playerStatus && adv.playerStatus !== 'active'
      ? `\nPLAYER STATUS: ${adv.playerStatus.toUpperCase()} — ${describeStatusContext(adv)}`
      : '';

    // Active objectives — what the LLM should pull the story toward
    const activeObjs = (adv.objectives || []).filter(o => o.status === 'active');
    const objectivesCtx = activeObjs.length
      ? activeObjs.map(o => `[${o.id}] ${o.title} — ${o.description} (completes when: ${o.completionHint}; progress ${o.progress}/100)`).join('\n')
      : 'No active objectives — focus on closure.';

    // Shared context block used by both calls — single source of truth
    const sharedCtx = `WORLD: "${W.worldName}" (${W.genre})
WORLD LORE: ${buildWorldContext()}
${simState}

PLAYER: ${playerCtx}
ARCHETYPE: ${archStr}
HEALTH: ${healthStr}    INVENTORY: ${invSummary}
EXHAUSTION: ${inv.exhaustion}/${inv.maxExhaustion} (${exhaustionLabel})
SUSPICION: ${inv.suspicion}/${inv.maxSuspicion} (${suspicionLabel})${statusLine}
FACTION RELATIONS: ${standingCtx}
STORY HISTORY: ${historyCtx || 'This is the beginning.'}

ACTIVE OBJECTIVES:
${objectivesCtx}

LOCAL NPCS: ${npcCtx}
ENVIRONMENT: ${envCtx}

SCENE TYPE: ${sceneInstruction}`;

    // ─── CALL A: Narrative prose (short, plain text — no JSON) ──────
    // Smaller token budget, single well-scoped job: write the scene.
    const narrativePromise = callApi(
      `You are a narrator for a text adventure. Based on the context below, write ONLY the scene narrative — no JSON, no lists, no meta-commentary.

${sharedCtx}

WRITING STYLE — CRITICAL:
- Clear, accessible language. Short sentences. Active voice.
- Avoid flowery prose, obscure metaphors, overwrought vocabulary.
- 3-5 SHORT paragraphs separated by blank lines. 2-3 sentences each, max 4.
- If you use a lore term for the first time, briefly anchor it ("the Iron Throne — the ruling empire of the eastern lands").
- Reference at least one named element from the world lore.
- At least one NPC should be present or mentioned (use LOCAL NPCS if they fit — otherwise introduce a new named person with agency).
- At least one environmental detail should be something the player could interact with (a crate, graffiti, an herb, a posted notice, etc).

OBJECTIVE-DRIVEN STORY — IMPORTANT:
- The story must MOVE the player toward their active objectives, not just present unrelated atmospheric scenes.
- Every scene should relate to at least one active objective: a clue, an obstacle, an ally who can help, an enemy who blocks the way, or a real opportunity to make progress.
- Do NOT remind the player of their objectives in narration — show, don't list.
- Avoid meandering exposition. Things should HAPPEN in this scene.

Output only the narrative prose. Start writing now.`,
      { maxTokens: 800 }
    );

    // ─── CALL B: Structured scene data (title, NPCs, resources, choices) ──
    // Runs in parallel with Call A. Smaller tokens since no prose.
    const structuredPromise = callApi(
      `You are generating the structured data for a text-adventure scene. Given the context below, return ONLY valid JSON matching the schema exactly.

${sharedCtx}

SCHEMA RULES:
- Produce 1-3 NPCs who are present in this scene. Reuse names from LOCAL NPCS when fitting; otherwise invent. Each has a role, optional faction, 1-sentence description, 2-3 traits, and initial disposition (-100..100).
- Produce 0-3 environmental resources. Each has a RISK level reflecting what taking it would cost:
    "safe"     — free for the taking, no consequence
    "watched"  — someone is nearby; taking it raises suspicion (+10..+25)
    "guarded"  — taking it angers a faction (negative standingChange) AND raises suspicion
    "cursed"   — looks valuable but is dangerous (negative healthChange or grants a "cursed" item)
- Produce EXACTLY 4 choices. The player's archetype should shape options.
- At least one choice should involve an NPC interaction when NPCs are present.
- Consider a "search / scavenge" choice when resources are present — its outcome must reflect the resource's risk.
- IF EXHAUSTION ≥ 65: at least one choice should be "rest" or non-physical.
- IF EXHAUSTION ≥ 85: physically demanding choices should have higher exhaustionChange or healthChange to reflect the danger.
- IF SUSPICION ≥ 75: at least one choice should risk capture; capture-risk choices set canCapture=true.
- Each choice's "consequence" hint should TELEGRAPH risk in plain language (e.g., "Risky — the guards may notice", "Safe but slow"). This restores agency.
- Each choice has a "riskLevel" field: "low", "moderate", "high", or "deadly".

OBJECTIVE PROGRESSION — REQUIRED:
- The active objectives in context have IDs. If a choice would advance, complete, or fail an objective, mark it via objectiveProgress.
- AT LEAST ONE choice per scene should have an objectiveProgress field that advances or completes an objective. Otherwise the story stalls.
- Use status="advanced" with a progress increment (0..100) for partial progress (typical: 15-30 points).
- Use status="completed" only when the choice DEFINITIVELY meets the objective's completionHint.
- Use status="failed" only when the choice irrecoverably loses the objective (a key NPC dies, the McGuffin is destroyed, etc.).
- Do NOT mark progress on every choice — only where it makes narrative sense.

PLAYER STATUS RULES:
- If player status is "captured", choices should focus on escape, persuasion, or waiting; one should attempt freedom (escapeAttempt=true).
- If "disgraced", choices should center on rebuilding standing or fleeing.
- If "exhausted", produce a single REST scene — choices reflect what the player notices or thinks while resting; almost no exhaustion gain.

Return ONLY this JSON:
{
  "sceneTitle": "…",
  "location": "…",
  "npcsPresent": [
    {"name":"…","role":"…","faction":"… or null","description":"1 sentence","traits":["…","…"],"initialDisposition":0}
  ],
  "environmentalResources": [
    {"name":"…","type":"herb|tool|currency|document|curio|food|weapon","risk":"safe|watched|guarded|cursed","description":"1 sentence"}
  ],
  "choices": [
    {"id":"a","text":"…","consequence":"…","riskLevel":"low|moderate|high|deadly","affectsFaction":null,"standingChange":0,"healthChange":0,"exhaustionChange":0,"suspicionChange":0,"itemGained":null,"itemLost":null,"insightGained":null,"npcInteraction":null,"npcDispositionChange":0,"scavengeTarget":null,"canCapture":false,"escapeAttempt":false,"objectiveProgress":null},
    {"id":"b","text":"…","consequence":"…","riskLevel":"low","affectsFaction":null,"standingChange":0,"healthChange":0,"exhaustionChange":0,"suspicionChange":0,"itemGained":null,"itemLost":null,"insightGained":null,"npcInteraction":null,"npcDispositionChange":0,"scavengeTarget":null,"canCapture":false,"escapeAttempt":false,"objectiveProgress":null},
    {"id":"c","text":"…","consequence":"…","riskLevel":"low","affectsFaction":null,"standingChange":0,"healthChange":0,"exhaustionChange":0,"suspicionChange":0,"itemGained":null,"itemLost":null,"insightGained":null,"npcInteraction":null,"npcDispositionChange":0,"scavengeTarget":null,"canCapture":false,"escapeAttempt":false,"objectiveProgress":null},
    {"id":"d","text":"…","consequence":"…","riskLevel":"low","affectsFaction":null,"standingChange":0,"healthChange":0,"exhaustionChange":0,"suspicionChange":0,"itemGained":null,"itemLost":null,"insightGained":null,"npcInteraction":null,"npcDispositionChange":0,"scavengeTarget":null,"canCapture":false,"escapeAttempt":false,"objectiveProgress":null}
  ],
  "worldPulse": "One sentence about wider world, or null"
}

FIELD NOTES:
- itemGained: null OR {"name":"…","description":"1-2 sentences","history":"1-2 sentences","usefulFor":"1 sentence","cursed":false}
- itemLost: null OR name of an item already in inventory
- healthChange: -30..+20 (rare; usually 0). Use 0 unless the choice is clearly violent or healing.
- exhaustionChange: -20..+30. Physical/stressful choices add 5-20; rest subtracts. Most choices: 0..+5.
- suspicionChange: -10..+30. Shady/illegal choices add 10-25; lying low subtracts.
- canCapture: true only if SUSPICION is high AND choice is risky around guards/factions
- escapeAttempt: true for captured-state choices that try to break free
- npcInteraction: null OR exact name from npcsPresent
- npcDispositionChange: integer from -40 to +40 (only with npcInteraction)
- scavengeTarget: null OR exact name from environmentalResources
- objectiveProgress: null OR {"id":"obj_X","status":"advanced|completed|failed","progress":15} where id matches an active objective. Use "advanced" with progress 15-30 for partial steps; "completed" only when truly done; "failed" only when irrecoverably lost.`,
      { maxTokens: 1800 }
    );

    // Wait for both in parallel — wall time is max(A, B) not A+B
    const [narrativeRaw, structuredRaw] = await Promise.all([narrativePromise, structuredPromise]);

    const scene = parseJsonResponse(structuredRaw);
    // Attach the narrative back into the scene object so downstream code stays the same
    scene.narrative = (narrativeRaw || '').trim();

    // Sanity-check the parsed scene — a scene with no choices is unplayable
    // and triggers the silent retry rather than leaving the user stuck.
    if (!Array.isArray(scene.choices) || scene.choices.length === 0) {
      throw new Error('Scene returned no choices');
    }

    // Update location
    if (scene.location) adv.currentRegion = scene.location;
    adv.currentChoices = scene.choices || [];

    // Merge NPCs into the persistent roster
    const currentLoc = adv.currentRegion || 'unknown';
    if (Array.isArray(scene.npcsPresent)) {
      scene.npcsPresent.forEach(n => {
        if (!n || !n.name) return;
        const key = findOrCreateNpcKey(adv.npcs, n.name);
        const existing = adv.npcs[key];
        if (existing) {
          // Update what we know — but keep disposition we've built up
          existing.role        = n.role || existing.role;
          existing.faction     = n.faction || existing.faction;
          existing.description = n.description || existing.description;
          existing.traits      = Array.isArray(n.traits) ? n.traits : existing.traits;
          existing.region      = currentLoc;
          existing.lastSeenChapter = adv.chapter;
          // Track alternate spellings we've seen so the roster prompt can include them
          if (!existing.aliases) existing.aliases = [];
          if (n.name !== existing.name && !existing.aliases.includes(n.name)) {
            existing.aliases.push(n.name);
          }
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
            aliases:          [],
          };
        }
      });
    }

    // Prune stale NPCs — drops anyone not seen in the last 12 chapters
    // who isn't an ally or enemy (|disposition| >= 50). Keeps the prompt lean.
    pruneStaleNpcs(adv, 12);

    // Merge environmental resources at this location
    if (Array.isArray(scene.environmentalResources)) {
      if (!adv.environment[currentLoc]) adv.environment[currentLoc] = [];
      const existingNames = new Set(adv.environment[currentLoc].map(e => e.name.toLowerCase()));
      scene.environmentalResources.forEach(r => {
        if (!r || !r.name) return;
        if (existingNames.has(r.name.toLowerCase())) return;
        const validRisks = ['safe', 'watched', 'guarded', 'cursed'];
        const risk = validRisks.includes(r.risk) ? r.risk : 'safe';
        adv.environment[currentLoc].push({
          name:           String(r.name),
          type:           String(r.type || 'curio'),
          risk,
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

    // Render choices — add NPC, scavenge, and risk visual flags
    const riskGlyph = { low:'·', moderate:'!', high:'!!', deadly:'☠' };
    const riskLabel = { low:'Low risk', moderate:'Moderate risk', high:'High risk', deadly:'Deadly' };

    $('advChoices').innerHTML = (scene.choices || []).map(c => {
      const hasEffect = c.affectsFaction && c.standingChange !== 0;
      const sign      = c.standingChange > 0 ? '+' : '';
      const effectTip = hasEffect ? ` · ${c.affectsFaction} ${sign}${c.standingChange}` : '';
      const npcTag    = c.npcInteraction ? `<span class="adv-choice-tag adv-choice-tag-npc">👤 ${esc(c.npcInteraction)}</span>` : '';

      // Scavenge tag carries the resource's risk so the player can see what they're getting into
      let scavTag = '';
      if (c.scavengeTarget) {
        const loc = adv.currentRegion || 'unknown';
        const target = (adv.environment?.[loc] || []).find(r =>
          r.name.toLowerCase() === String(c.scavengeTarget).toLowerCase() && r.takenInChapter == null
        );
        const rk = target?.risk || 'safe';
        scavTag = `<span class="adv-choice-tag adv-choice-tag-scav adv-scav-${rk}">◈ take · ${rk}</span>`;
      }

      const captureTag = c.canCapture ? `<span class="adv-choice-tag adv-choice-tag-capture">⚠ capture risk</span>` : '';
      const escapeTag  = c.escapeAttempt ? `<span class="adv-choice-tag adv-choice-tag-escape">⛓ escape</span>` : '';

      // Risk telegraph — shows on every choice so the player can read the danger
      const rl = c.riskLevel || 'low';
      const riskTag = `<span class="adv-choice-risk adv-choice-risk-${rl}" title="${riskLabel[rl] || 'Low risk'}">${riskGlyph[rl] || '·'}</span>`;

      return `
        <button class="adv-choice-btn adv-choice-risk-${rl}" data-choice-id="${esc(c.id)}">
          <span class="adv-choice-text">${riskTag} ${esc(c.text)}</span>
          <span class="adv-choice-meta">${npcTag}${scavTag}${captureTag}${escapeTag}</span>
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
      // Inline renderMiniMapView equivalent — adventure scenes can move the year
      if (hasWorld()) renderMiniMap('novaMap', AppState.world, AppState.nova);
    }

    // Render NPC cards and environment panel
    renderAdventureNpcs();
    renderAdventureEnvironment();
    updatePanelAdventure();

  } catch (err) {
    // Silently retry once on parse failures or empty/incomplete responses —
    // these usually self-resolve on a fresh roll because the LLM is non-deterministic.
    if (retryAttempt < 1 && /parse|JSON|empty|no choices/i.test(err.message)) {
      diagLog('warn', `Scene parse failed, retrying silently: ${err.message}`);
      await new Promise(r => setTimeout(r, 400));
      return generateAdventureScene(sceneType, prevChoice, retryAttempt + 1);
    }
    // After silent retry, show a friendly error with manual retry button
    $('advNarrative').innerHTML = `<div class="adv-empty">The Oracle's vision clouds for a moment.<br><br><button class="btn-sm" onclick="generateAdventureScene('${sceneType}',null)">↺ Try Again</button></div>`;
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

  // Apply exhaustion change (physical/mental wear)
  if (typeof choice.exhaustionChange === 'number' && choice.exhaustionChange !== 0) {
    inv.exhaustion = Math.max(0, Math.min(inv.maxExhaustion, inv.exhaustion + choice.exhaustionChange));
    if (choice.exhaustionChange > 0) toastLines.push(`+${choice.exhaustionChange} Exhaustion`);
    else                              toastLines.push(`${choice.exhaustionChange} Exhaustion`);
  }

  // Apply suspicion change (how watched/wanted you are)
  if (typeof choice.suspicionChange === 'number' && choice.suspicionChange !== 0) {
    inv.suspicion = Math.max(0, Math.min(inv.maxSuspicion, inv.suspicion + choice.suspicionChange));
    if (choice.suspicionChange > 0) toastLines.push(`+${choice.suspicionChange} Suspicion`);
    else                             toastLines.push(`${choice.suspicionChange} Suspicion`);
  }

  // NPC disposition shift
  if (choice.npcInteraction && typeof choice.npcDispositionChange === 'number' && choice.npcDispositionChange !== 0) {
    const key = findOrCreateNpcKey(adv.npcs, choice.npcInteraction);
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

  // Scavenge — take a listed environmental resource and convert to inventory item.
  // Risk level drives consequences beyond just acquiring the item.
  if (choice.scavengeTarget && typeof choice.scavengeTarget === 'string') {
    const loc = adv.currentRegion || 'unknown';
    const resources = adv.environment[loc] || [];
    const target = resources.find(r =>
      r.name.toLowerCase() === choice.scavengeTarget.toLowerCase() && r.takenInChapter == null
    );
    if (target) {
      target.takenInChapter = adv.chapter - 1;
      const cursed = target.risk === 'cursed';
      inv.items.push({
        name:            target.name,
        description:     target.description || `A ${target.type} found in ${loc}.`,
        history:         `Scavenged from ${loc} during chapter ${adv.chapter - 1}${cursed ? ' — its origin is troubling.' : '.'}`,
        usefulFor:       cursed
                          ? 'Useful, perhaps — but it carries something that gnaws at you.'
                          : typeReuseHint(target.type),
        obtainedChapter: adv.chapter - 1,
        isStarter:       false,
        cursed,
      });
      toastLines.push(`◈ Scavenged: ${target.name}`);

      // Risk-based consequences (these stack with explicit choice deltas above)
      const riskApply = {
        safe:    () => {},
        watched: () => {
          inv.suspicion = Math.max(0, Math.min(inv.maxSuspicion, inv.suspicion + 15));
          toastLines.push('👁 +15 Suspicion (you were noticed)');
        },
        guarded: () => {
          inv.suspicion = Math.max(0, Math.min(inv.maxSuspicion, inv.suspicion + 25));
          toastLines.push('👁 +25 Suspicion (taken from a guarded place)');
        },
        cursed: () => {
          inv.health = Math.max(0, Math.min(inv.maxHealth, inv.health - 10));
          toastLines.push('☠ -10 Health (the curse touches you)');
        },
      };
      (riskApply[target.risk] || riskApply.safe)();
    }
  }

  if (toastLines.length) showToast(toastLines.join(' · '));

  // Apply any objective progression the LLM marked on this choice
  let objectiveTriggeredEnd = false;
  if (choice.objectiveProgress && choice.objectiveProgress.id) {
    objectiveTriggeredEnd = applyObjectiveUpdate(choice.objectiveProgress);
  }

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
  renderAdventurePressure();
  renderAdventureStatusBanner();
  saveCurrentWorld();

  // Show choice was selected, brief moment before next scene
  $('advChoices').querySelectorAll('.adv-choice-btn').forEach(btn => {
    btn.disabled = true;
    if (btn.dataset.choiceId === choiceId) btn.classList.add('selected');
  });

  // ── FAILURE-STATE TRANSITIONS — checked in priority order ──
  // 0. Objective triggered win/loss — already handled above, just exit
  // 1. Death (health 0) — irrecoverable, triggers legacy modal
  // 2. Capture (suspicion ≥ maxSuspicion OR explicit canCapture roll)
  // 3. Disgrace (any major faction standing ≤ -75)
  // 4. Exhaustion (exhaustion ≥ maxExhaustion)
  if (objectiveTriggeredEnd) return;

  const triggeredFailure = checkFailureStates(choice);
  if (triggeredFailure) {
    await new Promise(r => setTimeout(r, 800));
    if (triggeredFailure === 'dead')      { handlePlayerDeath(); return; }
    if (triggeredFailure === 'captured')  { await enterCapturedState(choice); return; }
    if (triggeredFailure === 'disgraced') { await enterDisgracedState(choice); return; }
    if (triggeredFailure === 'exhausted') { await enterExhaustedState(choice); return; }
  }

  // ── Status-aware scene type for next scene ──
  let nextSceneType = 'CONTINUATION';
  if (adv.playerStatus === 'captured')  nextSceneType = 'CAPTURED';
  if (adv.playerStatus === 'disgraced') nextSceneType = 'DISGRACED';
  if (adv.playerStatus === 'exhausted') nextSceneType = 'REST';

  // Check for escape resolution (player was captured, attempted escape, succeeded?)
  if (adv.playerStatus === 'captured' && choice.escapeAttempt) {
    // Escape succeeds if exhaustion is low enough — high exhaustion = can't pull it off
    const escapeChance = inv.exhaustion < 50 ? 0.7 : inv.exhaustion < 75 ? 0.4 : 0.15;
    if (Math.random() < escapeChance) {
      adv.playerStatus = 'active';
      adv.statusContext = null;
      inv.suspicion = Math.max(40, inv.suspicion - 20); // freedom but still hunted
      showToast('⛓ You broke free.');
      nextSceneType = 'CONTINUATION';
    } else {
      // Failed escape — exhaustion penalty
      inv.exhaustion = Math.min(inv.maxExhaustion, inv.exhaustion + 20);
      showToast('⛓ Escape failed. You collapse, exhausted.');
    }
  }

  await new Promise(r => setTimeout(r, 600));
  await generateAdventureScene(nextSceneType, choice.text);
}

/**
 * Determine if any failure state should trigger from this choice.
 * Returns null if play continues, or a status string to enter.
 */
function checkFailureStates(choice) {
  const adv = AppState.adventure;
  const inv = AppState.adventureInventory;

  // Death is final and overrides everything else
  if (inv.health <= 0) return 'dead';

  // Don't re-enter a failure state we're already in
  if (adv.playerStatus !== 'active') return null;

  // Capture — suspicion overflow OR an explicit canCapture choice when suspicion is already high
  if (inv.suspicion >= inv.maxSuspicion) return 'captured';
  if (choice.canCapture && inv.suspicion >= 60 && Math.random() < 0.55) return 'captured';

  // Disgrace — any active faction has crashed below -75
  for (const [name, val] of Object.entries(adv.factionStanding || {})) {
    if (val <= -75) return 'disgraced';
  }

  // Exhaustion — only if no other failure took precedence
  if (inv.exhaustion >= inv.maxExhaustion) return 'exhausted';

  return null;
}

/** Move into captured state — limit choices, queue an escape-themed scene next. */
async function enterCapturedState(choice) {
  const adv = AppState.adventure;
  // Pick a captor — preference order: faction the choice angered, lowest-standing faction, or "unknown"
  let captor = choice.affectsFaction || null;
  if (!captor) {
    let worst = null, worstVal = 0;
    for (const [name, val] of Object.entries(adv.factionStanding || {})) {
      if (val < worstVal) { worst = name; worstVal = val; }
    }
    captor = worst || 'unknown captors';
  }
  adv.playerStatus = 'captured';
  adv.statusContext = {
    capturedBy:    captor,
    capturedReason: choice.text,
    sinceChapter:  adv.chapter,
  };
  showToast(`⛓ You've been captured by ${captor}.`);
  renderAdventureStatusBanner();
  await generateAdventureScene('CAPTURED', choice.text);
}

/** Move into disgraced state — at least one faction has turned hostile. */
async function enterDisgracedState(choice) {
  const adv = AppState.adventure;
  const disgracedWith = Object.entries(adv.factionStanding || {})
    .filter(([_, v]) => v <= -75)
    .map(([n]) => n);
  adv.playerStatus  = 'disgraced';
  adv.statusContext = {
    disgracedWith,
    cause:         choice.text,
    sinceChapter:  adv.chapter,
  };
  showToast(`✕ Disgraced — ${disgracedWith.join(', ')} want you punished.`);
  renderAdventureStatusBanner();
  await generateAdventureScene('DISGRACED', choice.text);
}

/** Move into exhausted state — forced rest scene next. */
async function enterExhaustedState(choice) {
  const adv = AppState.adventure;
  const inv = AppState.adventureInventory;
  adv.playerStatus  = 'exhausted';
  adv.statusContext = { sinceChapter: adv.chapter };
  showToast('☽ You collapse from exhaustion.');
  renderAdventureStatusBanner();
  // Forced rest scene; restoration applied when player makes any choice in REST
  await generateAdventureScene('REST', choice.text);
  // After rest scene generates, apply restoration immediately — REST scenes restore most exhaustion
  inv.exhaustion = Math.max(0, Math.floor(inv.exhaustion * 0.3));
  if (adv.playerStatus === 'exhausted') {
    adv.playerStatus  = 'active';
    adv.statusContext = null;
    renderAdventureStatusBanner();
    renderAdventurePressure();
  }
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

/**
 * Triggered when all 3 objectives are completed — the win condition.
 * Generates a triumphant ending epitaph and offers the "begin a new story" option.
 */
async function handleAdventureVictory() {
  const W   = AppState.world;
  const adv = AppState.adventure;

  $('advNarrative').innerHTML = '<div class="adv-loading">Your story reaches its triumphant end…</div>';
  $('advChoices').innerHTML   = '';
  // Disable any pending choice clicks
  $('advChoices').querySelectorAll('button').forEach(b => b.disabled = true);

  try {
    const objSummary = (adv.objectives || []).map(o => `- ${o.title}: ${o.description}`).join('\n');
    const raw = await callApi(
      `Write a triumphant ending for ${adv.playerName || 'this hero'} in "${W.worldName}".

They completed all three of their objectives:
${objSummary}

After ${adv.chapter} chapters in ${adv.currentRegion || 'the world'}, with their faction ${adv.playerFaction?.name || 'unaffiliated'}.

Write 3-4 SHORT paragraphs:
1. The moment of completion — what victory looks like
2. The cost or change it brought
3. What this character chooses to do next, or what becomes of them
4. A final image or line that lands

Style: Clear, plain language. Earned, not melodramatic. End on a satisfying note.`,
      { maxTokens: 700 }
    );

    const html = (raw || '').split('\n\n').filter(p => p.trim()).map(p => `<p>${esc(p)}</p>`).join('');
    $('advNarrative').innerHTML = `
      <div class="adv-victory-banner">✓ VICTORY — All Objectives Complete</div>
      ${html}`;
  } catch (err) {
    $('advNarrative').innerHTML = `
      <div class="adv-victory-banner">✓ VICTORY — All Objectives Complete</div>
      <p>${esc(adv.playerName || 'You')} completed every goal that mattered. The story closes here, on your own terms.</p>`;
  }

  // Archive into legacy chain so a future run can reference this triumph
  adv.legacyChain = adv.legacyChain || [];
  adv.legacyChain.push({
    name:         adv.playerName || 'The Triumphant',
    faction:      adv.playerFaction?.name || null,
    origin:       adv.playerOrigin?.name  || null,
    chapters:     adv.chapter,
    deathRegion:  adv.currentRegion || null,
    finalItems:   AppState.adventureInventory.items.slice(0, 3),
    outcome:      'victory',
  });
  adv.active = false;
  saveCurrentWorld();

  $('advChoices').innerHTML = `<button class="btn-forge" id="btnAdvRestartFromEnd">✦ Begin a New Story</button>`;
  $('btnAdvRestartFromEnd')?.addEventListener('click', () => { resetAdventure(false); });
}

/**
 * Triggered when an objective fails irrecoverably — the lose condition that
 * isn't death. Treats this as the end of THIS character's story; offers legacy.
 */
async function handleAdventureLoss(reason) {
  const W   = AppState.world;
  const adv = AppState.adventure;

  $('advNarrative').innerHTML = '<div class="adv-loading">The story turns dark…</div>';
  $('advChoices').innerHTML   = '';
  $('advChoices').querySelectorAll('button').forEach(b => b.disabled = true);

  try {
    const failedObj = (adv.objectives || []).find(o => o.status === 'failed');
    const raw = await callApi(
      `Write a somber ending for ${adv.playerName || 'this character'} in "${W.worldName}".

The story ends because ${failedObj ? `they failed: "${failedObj.title}" — ${failedObj.description}` : reason}.

Write 3 SHORT paragraphs:
1. The moment of the irreversible loss
2. What that means for ${adv.playerName || 'them'} — withdrawal, regret, departure
3. A final image that doesn't sugarcoat it

Style: Plain language. Honest. Don't lecture. End with what happens next, or where they end up.`,
      { maxTokens: 600 }
    );

    const html = (raw || '').split('\n\n').filter(p => p.trim()).map(p => `<p>${esc(p)}</p>`).join('');
    $('advNarrative').innerHTML = `
      <div class="adv-loss-banner">✕ STORY ENDS — Objective Lost</div>
      ${html}`;
  } catch (err) {
    $('advNarrative').innerHTML = `
      <div class="adv-loss-banner">✕ STORY ENDS — Objective Lost</div>
      <p>${esc(reason || 'Some doors, once closed, cannot be reopened.')}</p>`;
  }

  adv.legacyChain = adv.legacyChain || [];
  adv.legacyChain.push({
    name:         adv.playerName || 'The Lost',
    faction:      adv.playerFaction?.name || null,
    origin:       adv.playerOrigin?.name  || null,
    chapters:     adv.chapter,
    deathRegion:  adv.currentRegion || null,
    finalItems:   AppState.adventureInventory.items.slice(0, 3),
    outcome:      'failed_objective',
  });
  adv.active = false;
  saveCurrentWorld();

  // Offer both: end the story OR continue as legacy character
  $('advChoices').innerHTML = `
    <button class="btn-forge" id="btnAdvLossLegacy">↺ Continue as Legacy Heir</button>
    <button class="btn-secondary" id="btnAdvLossEnd">End the Story</button>`;
  $('btnAdvLossLegacy')?.addEventListener('click', () => startLegacyAdventure());
  $('btnAdvLossEnd')?.addEventListener('click', () => { resetAdventure(false); });
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
    _hooks.setNav?.('dnd');
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
    objectives: [], playerStatus: 'active', statusContext: null,
    legacyChain: preservedLegacy,
    // Legacy-specific fields — flagged so beginAdventure can reference them
    _inheritedFrom: predecessor.name,
    _inheritedItem: inheritedItem,
  };
  AppState.adventureInventory = {
    items:        inheritedItem ? [{ ...inheritedItem, obtainedChapter: 0, isStarter: true }] : [],
    health:       100,
    maxHealth:    100,
    exhaustion:   0, maxExhaustion: 100,
    suspicion:    0, maxSuspicion: 100,
    keyInsights:  [],
    achievements: [],
  };

  showToast(`${predecessor.name}'s legacy continues. You inherit their faction${inheritedItem ? ` and their ${inheritedItem.name}` : ''}.`);

  // Go back to setup — user picks new origin and archetype
  showAdventureSetup();
}

/** Panel content for adventure mode */
export function updatePanelAdventure() {
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
    _hooks.setNav?.('oracle');
    _hooks.sendChat?.();
  });
}

/**
 * Restore the adventure UI after a save load. Repaints all panels and
 * re-opens the current scene by continuing from the last choice.
 *
 * Called from app.js after loadAdventureSave() succeeds — replaces the
 * old inline restoration code that had to call 9 internal renders.
 */
export async function restoreAdventureFromSave() {
  const setup = $('advSetup'), game = $('advGame');
  if (setup) setup.style.display = 'none';
  if (game)  game.classList.add('visible');
  renderAdventureCharacterCard();
  renderFactionStandings();
  renderAdventureHealth();
  renderAdventurePressure();
  renderAdventureStatusBanner();
  renderAdventureInventory();
  renderAdventureNpcs();
  renderAdventureEnvironment();
  renderObjectives();
  const adv = AppState.adventure;
  $('advChapterBadge').textContent = `Chapter ${adv.chapter}`;
  // Rebuild journey log
  const logEl = $('advLog');
  if (logEl) {
    logEl.innerHTML = (adv.history || []).map(h => `
      <div class="adv-log-entry">
        <div class="adv-log-chapter">Chapter ${h.chapter}</div>
        <div class="adv-log-choice">→ ${esc(h.choiceText)}</div>
      </div>`).join('');
  }
  // Re-open current scene by continuing from last choice
  const lastChoice = adv.history.slice(-1)[0]?.choiceText;
  await generateAdventureScene('CONTINUATION', lastChoice || 'The story resumes.');
}
