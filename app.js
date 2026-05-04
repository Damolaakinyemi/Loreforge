/**
 * app.js — Loreforge complete controller
 * Features: Login/register, world hub, interview + Surprise Me,
 * illustrated map, Nova sim with Oracle guidance,
 * D&D adventure mode, Oracle chat guide, save/load slots
 */
import {
  AppState, CATEGORIES,
  DETAIL_SECTIONS,
  ORACLE_ROLES,
  normalizeWorld, validateWorld, buildWorldContext,
  getEntrySubLabel, hasWorld,
  registerUser, loginUser, logoutUser, restoreSession,
  saveApiKey, loadApiKey,
  saveGeminiKey, loadGeminiKey,
  getUserSaves, loadWorldSlot, deleteWorldSlot, saveCurrentWorld,
  saveOracleChat, loadOracleChat,
  saveAdventureState, getAdventureSaves, loadAdventureSave, deleteAdventureSave,
} from './state.js';
import {callApi, generateMapArtwork, apiMetrics} from './apiService.js';
import {initDiagnostics,diagLog,recordDiagError,runScan,executeRepairs,openDiag,closeDiag,toggleDiag} from './diagnostics.js';
import {renderIllustratedMap} from './map.js';
import {
  esc, $, showScreen, openModal, closeModal, showToast,
  addCitationLinks,
} from './utils.js';
import {
  startInterview, advanceInterview, retreatInterview, surpriseStep,
} from './interview.js';
import {
  showAdventureSetup, resetAdventure, beginAdventure, updatePanelAdventure,
  restoreAdventureFromSave, initAdventureHooks,
} from './adventure.js';
import {
  renderOracleRoleBar, sendChat, oracleProactiveGreeting,
  oracleAbout, restoreOracleChat, clearChat, handleCitationClick, initOracleHooks,
  extractProposal, renderProposalCard,
} from './oracle.js';

/* ════════════════════════════════════════════════
   API BADGE — listens for api-call events and updates the toolbar counter
════════════════════════════════════════════════ */
function updateApiBadge() {
  const el = $('apiBadge');
  if (!el) return;
  const count = apiMetrics.totalCalls || 0;
  el.textContent = `⚡ ${count}`;
  el.title = `${count} API calls this session (rough estimate of usage)`;
}
// Refresh the badge whenever apiService fires a call event
window.addEventListener('lf:api-call', updateApiBadge);

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
      : 'Get a key at console.anthropic.com';
  }
  // Populate Gemini key too (optional)
  const gemInput  = $('geminiKeyInput');
  const gemStatus = $('geminiKeyStatus');
  if (gemInput) {
    const gem = loadGeminiKey();
    gemInput.value = gem || '';
    if (gemStatus) {
      gemStatus.textContent = gem
        ? 'Gemini key is set — map artwork is enabled.'
        : 'Optional. Get a free key at aistudio.google.com';
    }
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

  const viewMap={map:'view-map',dnd:'view-dnd',oracle:'view-oracle'};
  if(viewMap[navId]) {
    $(viewMap[navId])?.classList.add('active');
  } else {
    $('view-lore')?.classList.add('active');
  }

  switch(navId) {
    case 'map':    updatePanelMap(); break;
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
  footer.innerHTML=`<button class="btn-add" id="btnGotoDnd">✦ Start Adventure</button>`;
  $('btnGotoDnd').addEventListener('click',()=>setNav('dnd'));
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

/* Interview wizard moved to interview.js */

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

  // Restore persisted Oracle chat or start fresh
  const savedHistory = loadOracleChat();
  if (savedHistory.length) {
    restoreOracleChat();
  } else {
    AppState.chatHistory = [];
    $('chatMsgs').innerHTML = `<div class="msg-ai">I am the Oracle of <em>${esc(W.worldName)}</em>. ${esc(W.overview || '')} Ask me anything — I am your guide, narrator, and dungeon master.</div>`;
  }

  // Citation click delegation — one listener on the container
  const chatMsgs = $('chatMsgs');
  chatMsgs.removeEventListener('click', handleCitationClick);
  chatMsgs.addEventListener('click', handleCitationClick);

  renderOracleRoleBar();
  renderMap();
  resetAdventure();
  showScreen('main');
  setNav('map');
  setTimeout(() => runScan(false), 800);
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
  refreshMapArtButtonVisibility();
}

/** Show the "Clear Art" button only when the world has artwork to clear. */
function refreshMapArtButtonVisibility() {
  const btn = $('btnClearMapArt');
  if (!btn) return;
  const has = !!(AppState.world && AppState.world.mapArtwork);
  btn.style.display = has ? '' : 'none';
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

/* Nova simulation engine moved to nova.js */

/* Adventure mode moved to adventure.js */

/* Oracle chat moved to oracle.js */

/* ════════════════════════════════════════════════
   SAVE / EXPORT / IMPORT
════════════════════════════════════════════════ */
function doSave() {
  const r=saveCurrentWorld();
  if(r.ok) showToast('World saved!');
  else showToast(`Save failed: ${r.error}`);
}

/**
 * Generate AI-painted map artwork for the current world via Gemini.
 * Stores the result as a data URL on world.mapArtwork and re-renders the map.
 *
 * Flow:
 * 1. Validate Gemini key is set (otherwise prompt user to add one)
 * 2. Confirm if artwork already exists (regen costs another API call)
 * 3. Build a descriptive prompt from the world's lore
 * 4. Call Gemini, store result, save, re-render
 */
async function generateMapArtworkForCurrentWorld() {
  if (!hasWorld()) { showToast('No world loaded.'); return; }
  if (!loadGeminiKey()) {
    showToast('Add a Gemini API key first.');
    openApiKeyModal();
    return;
  }
  // Respect cooldown if a previous generation hit a rate limit
  if (window._artworkCooldownUntil && Date.now() < window._artworkCooldownUntil) {
    const sec = Math.ceil((window._artworkCooldownUntil - Date.now()) / 1000);
    const display = sec > 60 ? `${Math.ceil(sec/60)} minutes` : `${sec} seconds`;
    showToast(`🎨 Still on cooldown — wait ${display}, or use 📁 Upload Map instead.`, { wide: true });
    return;
  }

  const W = AppState.world;
  if (W.mapArtwork) {
    if (!confirm('Replace the existing map artwork? This costs another Gemini API call (~$0.04).')) return;
  } else {
    if (!confirm('Generate a Gemini-painted map backdrop?\n\nThis takes 10-20 seconds and costs roughly $0.04 in Gemini API usage. The free tier covers many generations before you pay anything.')) return;
  }

  const btn = $('btnGenerateArtwork');
  const oldText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '🎨 Painting…'; }

  try {
    // Build a rich descriptive prompt from the world's lore
    const regions = (W.regions || []).slice(0, 6).map(r => `${r.name} (${r.type || 'unknown terrain'})`).join(', ');
    const factions = (W.factions || []).slice(0, 4).map(f => f.name).join(', ');
    const tone = W.genre || 'fantasy';

    const prompt = `Paint a beautiful old-world illustrated fantasy map in the style of vintage 1500s-1700s cartography — aged parchment, hand-drawn ink linework, sepia and muted earth tones, decorative scrollwork.

The map depicts the world of "${W.worldName}" (${tone}).
Key regions to suggest visually: ${regions || 'varied terrain'}.
${factions ? `Notable factions in this world: ${factions}.` : ''}
${W.overview ? `Atmosphere: ${W.overview.slice(0, 200)}` : ''}

Include: textured aged parchment background with tea-stained edges, rolling landmasses with hand-drawn coastlines, mountains as small triangle clusters, forests as tree pictograms, rivers as wavy lines, a few sailing ships in the open ocean, a sea monster or two, a compass rose, and decorative scrollwork around the edges. NO text labels — leave space for labels to be added later. Wide aspect ratio, atmospheric and painterly, NOT photographic. Top-down map perspective with slight isometric tilt for terrain features. Background dominated by warm cream parchment color (#f0e6d0).`;

    showToast('Generating map artwork — this may take 10-20 seconds…');

    const dataUrl = await generateMapArtwork(prompt);

    W.mapArtwork = dataUrl;
    saveCurrentWorld();

    // Re-render the map with the new backdrop
    renderMap();
    showToast('✓ Map artwork generated. Toggle overlays to see it through different views.');
    diagLog('ok', 'Map artwork generated via Gemini');

  } catch (err) {
    // Show a wider, longer toast for quota errors since they include guidance
    const isQuota = err.code === 'GEMINI_QUOTA_DAY' ||
                    err.code === 'GEMINI_QUOTA_MINUTE' ||
                    err.code === 'GEMINI_QUOTA';
    if (isQuota) {
      showToast(err.message, { wide: true });
    } else {
      showToast(`Artwork generation failed: ${err.message}`);
    }
    recordDiagError('artwork', err.message);

    // If the rate limit is per-day, keep the button disabled for the rest of
    // the session so the user can't keep trying and burning their attention
    // on the same error. Per-minute hits get a shorter cooldown.
    if (err.code === 'GEMINI_QUOTA_DAY') {
      window._artworkCooldownUntil = Date.now() + 60 * 60 * 1000; // 1 hour
      startArtworkCooldownDisplay();
    } else if (err.code === 'GEMINI_QUOTA_MINUTE' || err.code === 'GEMINI_QUOTA') {
      // Try to honor the suggested retry-after if Google included one
      const m = err.message.match(/Suggested wait: (\d+)s/);
      const seconds = m ? parseInt(m[1], 10) : 60;
      window._artworkCooldownUntil = Date.now() + seconds * 1000;
      startArtworkCooldownDisplay();
    }
  } finally {
    if (btn && !window._artworkCooldownUntil) {
      btn.disabled = false;
      btn.textContent = oldText;
    }
  }
}

/**
 * After a rate-limit error, keep the artwork button disabled with a live
 * countdown so the user can see when they can try again. Auto-restores the
 * button label when the cooldown expires.
 */
function startArtworkCooldownDisplay() {
  const btn = $('btnGenerateArtwork');
  if (!btn) return;
  const tick = () => {
    const remaining = (window._artworkCooldownUntil || 0) - Date.now();
    if (remaining <= 0) {
      window._artworkCooldownUntil = null;
      btn.disabled = false;
      btn.textContent = '🎨 Artwork';
      return;
    }
    btn.disabled = true;
    if (remaining > 60_000) {
      const mins = Math.ceil(remaining / 60_000);
      btn.textContent = `🎨 Wait ${mins}m`;
    } else {
      btn.textContent = `🎨 Wait ${Math.ceil(remaining / 1000)}s`;
    }
    setTimeout(tick, 1000);
  };
  tick();
}

/**
 * Upload a user-supplied map image (PNG/JPG/WebP) and use it as the world's
 * map artwork backdrop. Same render pipeline as the Gemini-generated artwork.
 *
 * The user can use any external tool (Azgaar's Fantasy Map Generator, Inkarnate,
 * Wonderdraft, etc.) to create the map, then upload the export here.
 *
 * Validation:
 *   - File must be image/png, image/jpeg, or image/webp
 *   - File size capped at 4MB to keep localStorage saves manageable
 *   - Stored as data URL on world.mapArtwork (same field Gemini uses)
 */
function uploadMapArtworkFromFile(file) {
  if (!hasWorld()) { showToast('No world loaded.'); return; }
  if (!file) return;

  const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (!validTypes.includes(file.type)) {
    showToast(`Unsupported file type (${file.type}). Use PNG, JPG, or WebP.`);
    return;
  }

  // 4MB ceiling — base64 inflation pushes ~5.5MB into localStorage
  const MAX_BYTES = 4 * 1024 * 1024;
  if (file.size > MAX_BYTES) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    showToast(`Image too large (${sizeMB}MB). Maximum is 4MB. Try resizing it first.`);
    return;
  }

  const W = AppState.world;
  if (W.mapArtwork) {
    if (!confirm('Replace the existing map artwork with this upload?')) return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const dataUrl = e.target.result;
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
        throw new Error('File could not be read as an image.');
      }
      W.mapArtwork = dataUrl;
      saveCurrentWorld();
      renderMap();
      const sizeKB = Math.round(file.size / 1024);
      showToast(`✓ Map uploaded (${sizeKB}KB). Toggle overlays to see it through different views.`);
      diagLog('ok', `Map artwork uploaded: ${file.name} (${sizeKB}KB)`);
    } catch (err) {
      showToast(`Upload failed: ${err.message}`);
      recordDiagError('upload', err.message);
    }
  };
  reader.onerror = () => {
    showToast('Failed to read the file.');
    recordDiagError('upload', 'FileReader error');
  };
  reader.readAsDataURL(file);
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
    const anthVal = $('apiKeyInput').value.trim();
    const gemVal  = $('geminiKeyInput')?.value.trim() || '';

    if (!anthVal && !gemVal) { showToast('Enter at least one key or cancel.'); return; }

    // Validate Anthropic key shape if provided
    if (anthVal && !anthVal.startsWith('sk-ant-')) {
      if (!confirm('That does not look like an Anthropic API key (sk-ant-…). Save it anyway?')) return;
    }
    // Gemini keys typically start with "AIza"; warn if not, don't block
    if (gemVal && !gemVal.startsWith('AIza')) {
      if (!confirm('That does not look like a Gemini API key (AIza…). Save it anyway?')) return;
    }

    if (anthVal) saveApiKey(anthVal);
    if (gemVal)  saveGeminiKey(gemVal);

    closeModal('apiKeyModal');
    const banner = $('hubApiBanner');
    if (banner && anthVal) banner.style.display = 'none';

    const parts = [];
    if (anthVal) parts.push('Anthropic');
    if (gemVal)  parts.push('Gemini');
    showToast(`${parts.join(' & ')} key${parts.length > 1 ? 's' : ''} saved.`);
  });
  $('apiKeyInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') $('btnApiKeySave')?.click();
  });
  $('geminiKeyInput')?.addEventListener('keydown', e => {
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

  // Interview — pass side-effect hooks so the module can finish world-forge
  const interviewHooks = { initNovaState, initWorld, oracleProactiveGreeting };
  $('btnInterviewNext').addEventListener('click', () => advanceInterview(interviewHooks));
  $('btnInterviewBack').addEventListener('click', retreatInterview);
  $('btnSurpriseStep').addEventListener('click', surpriseStep);

  // Nav rail
  document.querySelectorAll('.nav-btn[data-nav]').forEach(btn=>{
    btn.addEventListener('click',()=>{if(!hasWorld()&&!['map'].includes(btn.dataset.nav))return;setNav(btn.dataset.nav);});
  });
  document.querySelectorAll('.nav-btn[data-screen]').forEach(btn=>{
    btn.addEventListener('click',()=>showScreen(btn.dataset.screen));
  });

  // Map toolbar
  $('btnDndToggle').addEventListener('click',()=>setNav('dnd'));
  $('btnGenerateArtwork')?.addEventListener('click', generateMapArtworkForCurrentWorld);
  $('btnUploadMapArt')?.addEventListener('click', () => {
    const W = AppState.world;
    if (W && W.mapArtwork) {
      if (!confirm('Replace the existing map artwork with a new upload?')) return;
    }
    const input = $('uploadMapArtInput');
    if (input) { input.value = ''; input.click(); }
  });
  $('btnClearMapArt')?.addEventListener('click', () => {
    const W = AppState.world;
    if (!W || !W.mapArtwork) return;
    if (!confirm('Remove the map artwork backdrop?')) return;
    W.mapArtwork = null;
    saveCurrentWorld();
    renderMap();
    showToast('Map artwork cleared.');
    refreshMapArtButtonVisibility();
  });
  $('uploadMapArtInput')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) uploadMapArtworkFromFile(file);
  });
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
      case 'a': setNav('dnd'); break;
      case 'o': setNav('oracle'); setTimeout(() => $('chatInput')?.focus(), 50); break;
      case '1': setMapOverlay('illustrated'); break;
      case '2': setMapOverlay('political'); break;
      case '3': setMapOverlay('stability'); break;
    }
  });

  // Region modal close
  $('btnRegionClose').addEventListener('click',()=>closeModal('regionModal'));
  $('regionModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal('regionModal');});

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
        btn.addEventListener('click', async () => {
          const idx = parseInt(btn.dataset.loadIdx, 10);
          const r = loadAdventureSave(idx);
          if (r.ok) {
            closeModal('advLoadModal');
            await restoreAdventureFromSave();
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
  // Wire adventure module's side-effect callbacks before any user interaction
  initAdventureHooks({ setNav, sendChat });
  // Wire oracle module's side-effect callbacks
  initOracleHooks({ setNav, renderMap, openAddEntryModal });
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
