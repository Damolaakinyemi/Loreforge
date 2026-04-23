/**
 * app.js — Loreforge complete controller
 * Features: Login/register, world hub, interview + Surprise Me,
 * illustrated map, Nova sim with Oracle guidance,
 * D&D adventure mode, Oracle chat guide, save/load slots
 */
import {
  AppState,INTERVIEW_STEPS,CATEGORIES,CATEGORY_KEYS,
  DETAIL_SECTIONS,MAP_ICONS,LOAD_PHRASES,INTERVENTION_OPTIONS,
  normalizeWorld,validateWorld,buildWorldContext,
  getEntrySubLabel,hasWorld,
  registerUser,loginUser,logoutUser,restoreSession,
  saveApiKey,loadApiKey,
  getUserSaves,saveWorldSlot,loadWorldSlot,deleteWorldSlot,saveCurrentWorld,
} from './state.js';
import {callApi,parseJsonResponse,ApiError} from './apiService.js';
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
    const k=$('loginApiKey').value.trim();
    $('loginError').textContent='';
    if(!u||!p){$('loginError').textContent='Enter username and password.';return;}
    const r=loginUser(u,p);
    if(!r.ok){$('loginError').textContent=r.error;return;}
    if(k) saveApiKey(k);
    loadHub();
  });

  $('btnRegister').addEventListener('click',()=>{
    const u=$('regUsername').value.trim();
    const p=$('regPassword').value;
    const k=$('regApiKey').value.trim();
    $('registerError').textContent='';
    if(!u||!p){$('registerError').textContent='Choose a username and password.';return;}
    if(p.length<4){$('registerError').textContent='Password must be at least 4 characters.';return;}
    const r=registerUser(u,p);
    if(!r.ok){$('registerError').textContent=r.error;return;}
    loginUser(u,p);
    if(k) saveApiKey(k);
    loadHub();
  });
}

function loadHub() {
  const user=AppState.currentUser;
  if(!user){showScreen('login');return;}
  $('hubUsername').textContent=user.username;
  renderHubSaves();
  showScreen('hub');
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
    case 'dnd':    updatePanelDnd(); break;
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

function updatePanelDnd() {
  $('panelTitle').textContent='D&D Adventure';
  $('panelSub').textContent=`Turn ${AppState.dnd.turn}`;
  const dnd=AppState.dnd;
  $('panelScroll').innerHTML=`<div style="padding:.65rem 1rem">
    <div style="font-family:var(--fd);font-size:.58rem;letter-spacing:.15em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:.5rem">Player Stats</div>
    ${['reputation','power','knowledge'].map(stat=>`
      <div style="margin-bottom:.55rem">
        <div style="display:flex;justify-content:space-between;font-size:.72rem;color:var(--parch-dim);margin-bottom:.2rem"><span>${stat.charAt(0).toUpperCase()+stat.slice(1)}</span><span>${dnd.playerStats[stat]}</span></div>
        <div style="height:4px;background:var(--bord-f);border-radius:2px">
          <div style="height:100%;width:${dnd.playerStats[stat]}%;background:var(--dnd);border-radius:2px;transition:width .5s"></div>
        </div>
      </div>`).join('')}
    ${dnd.focusRegion?`<div style="margin-top:.85rem;font-family:var(--fd);font-size:.58rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold-dim);margin-bottom:.25rem">Current Location</div><div style="font-size:.8rem;color:var(--parch-dim)">${esc(dnd.focusRegion)}</div>`:''}
  </div>`;
  $('panelFooter').innerHTML='';
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
   INTERVIEW WIZARD + SURPRISE ME
════════════════════════════════════════════════ */
function startInterview() {
  AppState.interview={step:0,answers:{}};
  showScreen('interview');
  renderInterviewStep();
}

function renderInterviewStep() {
  const si=AppState.interview.step,step=INTERVIEW_STEPS[si],total=INTERVIEW_STEPS.length;
  $('interviewProgress').innerHTML=INTERVIEW_STEPS.map((s,i)=>`
    <div class="interview-step${i===si?' active':''}${i<si?' done':''}">
      <div class="step-dot">${i<si?'✓':i+1}</div>
      <div class="step-info"><div class="step-name">${s.name}</div><div class="step-desc">${s.desc}</div></div>
    </div>`).join('');
  $('progressBar').style.width=`${(si/total)*100}%`;
  $('progressLabel').textContent=`Step ${si+1} of ${total}`;
  $('btnInterviewBack').style.visibility=si===0?'hidden':'visible';
  $('interviewContent').innerHTML=`<div class="interview-q-block">
    <div class="interview-q-step">${step.name}</div>
    <div class="interview-q-title">${step.title}</div>
    <div class="interview-q-desc">${step.intro}</div>
    <div class="interview-questions" id="stepFields"></div>
  </div>`;
  step.fields.forEach(f=>renderField(f,$('stepFields'),AppState.interview.answers));
}

function renderField(field,container,answers) {
  const w=document.createElement('div'); w.className='interview-field';
  if(field.type==='tags') {
    const saved=answers[field.id]||'';
    w.innerHTML=`<label>${field.label}</label><div class="tag-select">${field.options.map(o=>`<button class="tag-btn${saved===o?' selected':''}" data-val="${esc(o)}">${esc(o)}</button>`).join('')}</div>`;
    container.appendChild(w);
    w.querySelectorAll('.tag-btn').forEach(btn=>btn.addEventListener('click',()=>{
      w.querySelectorAll('.tag-btn').forEach(b=>b.classList.remove('selected'));
      btn.classList.add('selected'); answers[field.id]=btn.dataset.val;
    }));
  } else if(field.type==='repeater') {
    if(!answers[field.id]) answers[field.id]=[buildEmptyItem(field)];
    w.innerHTML=`<label>${field.label}</label><div class="repeater-list" id="rep-${field.id}"></div><button class="btn-repeater-add" id="btnRepAdd-${field.id}">+ Add ${field.itemLabel}</button>`;
    container.appendChild(w);
    answers[field.id].forEach((item,i)=>renderRepItem(field,item,i,w.querySelector(`#rep-${field.id}`),answers));
    w.querySelector(`#btnRepAdd-${field.id}`).addEventListener('click',()=>{
      const ni=buildEmptyItem(field); answers[field.id].push(ni);
      renderRepItem(field,ni,answers[field.id].length-1,w.querySelector(`#rep-${field.id}`),answers);
    });
  } else {
    const tag=field.type==='textarea'?'textarea':'input';
    const val=answers[field.id]||'';
    w.innerHTML=`<label>${field.label}</label><${tag} id="f-${field.id}" placeholder="${esc(field.placeholder||'')}"${field.type==='textarea'?' rows="3"':''}>${field.type==='textarea'?esc(val):''}</${tag}>`;
    container.appendChild(w);
    if(field.type!=='textarea') w.querySelector(`#f-${field.id}`).value=val;
    w.querySelector(`#f-${field.id}`).addEventListener('input',e=>{answers[field.id]=e.target.value;});
  }
}

function buildEmptyItem(field) { const o={}; field.subfields.forEach(sf=>{o[sf.id]=''}); return o; }

function renderRepItem(field,item,idx,listEl,answers) {
  const div=document.createElement('div'); div.className='repeater-item'; div.dataset.idx=idx;
  div.innerHTML=`<div class="repeater-item-fields">${field.subfields.map(sf=>`<${sf.type==='textarea'?'textarea':'input'} data-sf="${sf.id}" placeholder="${esc(sf.placeholder||'')}"${sf.type==='textarea'?' rows="2"':''}>${sf.type==='textarea'?esc(item[sf.id]||''):''}</${sf.type==='textarea'?'textarea':'input'}>`).join('')}</div><button class="repeater-remove">✕</button>`;
  div.querySelectorAll('input').forEach(el=>{el.value=item[el.dataset.sf]||'';});
  div.querySelectorAll('input,textarea').forEach(el=>el.addEventListener('input',e=>{answers[field.id][idx][e.target.dataset.sf]=e.target.value;}));
  div.querySelector('.repeater-remove').addEventListener('click',()=>{
    if((answers[field.id]?.length||0)<=(field.minItems||1)){showToast(`Need at least ${field.minItems||1}.`);return;}
    answers[field.id].splice(idx,1); div.remove();
    listEl.querySelectorAll('.repeater-item').forEach((el,i)=>el.dataset.idx=i);
  });
  listEl.appendChild(div);
}

function collectStep() {
  const step=INTERVIEW_STEPS[AppState.interview.step],answers=AppState.interview.answers;
  step.fields.forEach(f=>{
    if(f.type==='text'||f.type==='textarea'){const el=$(`f-${f.id}`);if(el) answers[f.id]=el.value.trim();}
  });
}

function validateStep() {
  const step=INTERVIEW_STEPS[AppState.interview.step],a=AppState.interview.answers;
  for(const f of step.fields) {
    if(f.id==='worldName'&&!a[f.id]){showToast('Give your world a name first.');return false;}
    if(f.id==='genre'&&!a[f.id]){showToast('Choose a genre.');return false;}
    if(f.type==='repeater'){const items=a[f.id]||[];if(!items.some(item=>Object.values(item).some(v=>String(v).trim()))){showToast(`Add at least one ${f.itemLabel}.`);return false;}}
  }
  return true;
}

async function advanceInterview() {
  collectStep();
  if(!validateStep()) return;
  if(AppState.interview.step+1>=INTERVIEW_STEPS.length) {
    await forgeWorldFromInterview();
  } else {
    AppState.interview.step++;
    renderInterviewStep();
  }
}

function retreatInterview() {
  if(AppState.interview.step>0){AppState.interview.step--;renderInterviewStep();}
}

/** Surprise Me — AI fills the current step randomly */
async function surpriseStep() {
  const step=INTERVIEW_STEPS[AppState.interview.step];
  const btn=$('btnSurpriseStep');
  btn.disabled=true; btn.textContent='🎲 Generating…';

  try {
    const raw=await callApi(
      `You are a creative world-building AI. Generate random, original content for this world-building step.
Step: "${step.name}" — ${step.intro}
${AppState.interview.answers.worldName?`World name so far: "${AppState.interview.answers.worldName}"`:''}
${AppState.interview.answers.genre?`Genre: "${AppState.interview.answers.genre}"`:''}
Respond ONLY with a JSON object where keys match these field IDs: ${step.fields.map(f=>f.id).join(', ')}.
For tag fields (genre), pick one of: Dark Fantasy,High Fantasy,Grimdark,Mythic / Ancient,Cosmic Horror,Steampunk.
For repeater fields (regions,characters,factions,history), return an array of objects with keys: ${step.fields.filter(f=>f.type==='repeater').map(f=>f.subfields.map(s=>s.id).join(',')).join('; ')}.
Make everything creative, specific, and evocative. No generic placeholder text.`,
      {maxTokens:800}
    );

    const data=parseJsonResponse(raw);
    const answers=AppState.interview.answers;

    // Merge AI answers into state
    step.fields.forEach(f=>{
      if(data[f.id]!==undefined) {
        answers[f.id]=data[f.id];
      }
    });

    // Show a banner and re-render the step with the new values
    renderInterviewStep();

    // Insert surprise banner
    const banner=document.createElement('div');
    banner.className='surprise-banner';
    banner.innerHTML='🎲 The fates have decided — review and edit any answers below, then continue.';
    $('interviewContent').querySelector('.interview-q-block').insertBefore(banner,$('stepFields'));
    diagLog('ok',`Surprise Me filled: ${step.name}`);

  } catch(err) {
    showToast(`Surprise failed: ${err.message}`);
    recordDiagError('surprise',err.message);
  }
  btn.disabled=false; btn.textContent='🎲 Surprise Me';
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
  const W=AppState.world;
  AppState.nova={year:0,running:false,events:[],intervalId:null,regionState:{}};
  (W.regions||[]).forEach(r=>{
    AppState.nova.regionState[r.name]={
      power:40+Math.floor(Math.random()*40),
      stability:40+Math.floor(Math.random()*40),
      population:30+Math.floor(Math.random()*50),
    };
  });
}

function initWorld() {
  const W=AppState.world;
  $('mapLabel').textContent=`${W.worldName} — World Map`;
  $('oracleSubtitle').textContent=`Oracle of ${W.worldName}`;
  $('novaWorldName').textContent=W.worldName;
  AppState.chatHistory=[];
  $('chatMsgs').innerHTML=`<div class="msg-ai">I am the Oracle of <em>${esc(W.worldName)}</em>. ${esc(W.overview||'')} Ask me anything — I am your guide, narrator, and dungeon master.</div>`;
  $('novaLog').innerHTML='<div class="nova-empty">Run the simulation to begin the chronicle.</div>';
  $('novaYear').textContent='Year 0';
  renderMap(); renderMiniMapView();
  renderNovaInterventions();
  resetDnd();
  showScreen('main');
  setNav('map');
  setTimeout(()=>runScan(false),800);
}

/* ════════════════════════════════════════════════
   MAP
════════════════════════════════════════════════ */
function renderMap() {
  if(!hasWorld()) return;
  renderIllustratedMap('worldMap',AppState.world,AppState.nova,regionName=>openRegionModal(regionName));
}

function renderMiniMapView() {
  if(!hasWorld()) return;
  renderMiniMap('novaMap',AppState.world,AppState.nova);
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
  $('btnRegionDnd').onclick=()=>{closeModal('regionModal');startDndInRegion(region.name);};
  $('btnRegionClose').onclick=()=>closeModal('regionModal');
  openModal('regionModal');
}

/* ════════════════════════════════════════════════
   ADD ENTRY MODAL
════════════════════════════════════════════════ */
function openAddEntryModal(cat) {
  const meta=CATEGORIES[cat]; if(!meta) return;
  const overlay=document.createElement('div');
  overlay.className='modal-overlay open';
  overlay.innerHTML=`<div class="modal"><h3>Add ${meta.label.replace(/s$/,'')}</h3>
    <div class="field"><label>Name</label><input id="addName" type="text" placeholder="${meta.nameL}…"/></div>
    <div class="field"><label>Type / Role</label><input id="addType" type="text" placeholder="${meta.typeL}…"/></div>
    <div class="field"><label>Description</label><textarea id="addDesc" style="min-height:70px" placeholder="Describe this…"></textarea></div>
    <div class="field"><label>Secret (optional)</label><input id="addSecret" type="text" placeholder="What do most people not know?"/></div>
    <div class="modal-btns"><button class="btn-cancel" id="addCancelBtn">Cancel</button><button class="btn-generate" id="addSaveBtn">Add to World</button></div>
  </div>`;
  document.body.appendChild(overlay);
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  overlay.querySelector('#addCancelBtn').addEventListener('click',()=>overlay.remove());
  overlay.querySelector('#addSaveBtn').addEventListener('click',()=>{
    const name=$('addName').value.trim(); if(!name){showToast('Give it a name first.');return;}
    const type=$('addType').value.trim(),desc=$('addDesc').value.trim(),secret=$('addSecret').value.trim();
    const entry={name,description:desc,secret};
    if(type) entry[cat==='characters'?'role':cat==='history'?'era':'type']=type;
    if(!AppState.world[cat]) AppState.world[cat]=[];
    AppState.world[cat].push(entry);
    saveCurrentWorld(); renderMap(); updatePanelCategory(cat); overlay.remove();
    showToast(`${name} added to ${meta.label}.`);
  });
  setTimeout(()=>overlay.querySelector('#addName')?.focus(),50);
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
  if(!hasWorld()) return;
  const W=AppState.world,sim=AppState.nova;
  sim.year+=Math.floor(5+Math.random()*20);
  $('novaYear').textContent=`Year ${sim.year}`;

  const regionSummary=(W.regions||[]).map(r=>{const s=sim.regionState[r.name]||{};return `${r.name}(pwr:${s.power||50}%,stab:${s.stability||50}%)`;}).join(', ');
  const recentEvts=sim.events.slice(-3).map(e=>`Yr${e.year}:${e.text}`).join(' | ');

  try {
    const raw=await callApi(
      `You are simulating "${W.worldName}" (${W.genre}). Context: ${buildWorldContext()}
Year: ${sim.year}. Regions: ${regionSummary}. Recent: ${recentEvts||'none'}.
Generate ONE significant historical event. Return ONLY JSON:
{"text":"1-2 sentence event","type":"conflict|alliance|discovery|disaster|golden|neutral","powerDelta":{"regionName":10},"stabilityDelta":{"regionName":-5}}
powerDelta and stabilityDelta are optional and can be positive or negative integers.`,
      {maxTokens:300}
    );
    const ev=parseJsonResponse(raw); if(!ev.text) return;
    applySimDeltas(ev);
    sim.events.push({year:sim.year,text:ev.text,type:ev.type||'neutral'});
    appendNovaEvent({year:sim.year,text:ev.text,type:ev.type||'neutral'});
    // Oracle proactive guidance every 5 events
    if(sim.events.length%5===0) novaOracleCheck();
  } catch(_) {
    const r=(W.regions||[])[Math.floor(Math.random()*(W.regions||[]).length)];
    const fb=[`A harsh season grips ${r?.name||'the land'}.`,`Tensions rise along the borders of ${r?.name||'the realm'}.`,`A mysterious wanderer arrives in ${r?.name||'the capital'}.`];
    const text=fb[Math.floor(Math.random()*fb.length)];
    sim.events.push({year:sim.year,text,type:'neutral'});
    appendNovaEvent({year:sim.year,text,type:'neutral'});
  }
  renderMiniMapView(); renderMap(); updatePanelNova(); saveCurrentWorld();
}

function applySimDeltas(ev) {
  const sim=AppState.nova;
  if(ev.powerDelta) Object.entries(ev.powerDelta).forEach(([r,d])=>{if(sim.regionState[r]) sim.regionState[r].power=Math.max(5,Math.min(100,sim.regionState[r].power+d));});
  if(ev.stabilityDelta) Object.entries(ev.stabilityDelta).forEach(([r,d])=>{if(sim.regionState[r]) sim.regionState[r].stability=Math.max(5,Math.min(100,sim.regionState[r].stability+d));});
}

function appendNovaEvent(ev) {
  const log=$('novaLog'); if(!log) return;
  log.querySelector('.nova-empty')?.remove();
  const div=document.createElement('div');
  div.className=`nova-event ${ev.type||'neutral'}`;
  div.innerHTML=`<div class="nova-event-year">Year ${ev.year}</div><div class="nova-event-text">${esc(ev.text)}</div>`;
  log.appendChild(div); log.scrollTop=log.scrollHeight;
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
   D&D ADVENTURE MODE
════════════════════════════════════════════════ */
function resetDnd() {
  AppState.dnd={turn:0,active:false,history:[],currentScene:null,currentChoices:[],focusRegion:null,playerStats:{reputation:50,power:10,knowledge:5}};
  $('dndNarrative').innerHTML='<div class="dnd-empty">Press <strong>Begin Adventure</strong> to start. The Oracle will weave a story from your world\'s lore, presenting meaningful choices that shape events and feed back into the simulation.</div>';
  $('dndChoices').innerHTML='<button class="btn-forge dnd-start-btn" id="btnDndStart">⚄ Begin Adventure</button>';
  $('dndHistory').innerHTML='';
  $('dndTurnBadge').textContent='Turn 0';
  $('dndTitle').textContent='The Adventure Begins';
  $('dndSceneLabel').textContent='Awaiting adventure…';
  $('dndStats').innerHTML='';
  $('btnDndStart').addEventListener('click',beginDnd);
}

async function beginDnd(focusRegion) {
  if(!hasWorld()){showToast('Forge a world first.');return;}
  const W=AppState.world;
  const region=focusRegion||AppState.dnd.focusRegion||(W.regions||[])[0]?.name||'the realm';
  AppState.dnd.focusRegion=region;
  AppState.dnd.active=true;
  AppState.dnd.turn=1;
  await generateDndScene(`Begin a new adventure. The player starts in ${region}.`,'adventure_start');
}

function startDndInRegion(regionName) {
  AppState.dnd.focusRegion=regionName;
  setNav('dnd');
  beginDnd(regionName);
}

async function generateDndScene(context,sceneType) {
  const W=AppState.world,dnd=AppState.dnd;
  $('dndNarrative').innerHTML='<div class="msg-typing" style="padding:1rem;color:var(--faint);font-style:italic">The Oracle weaves your fate…</div>';
  $('dndChoices').innerHTML='';
  $('dndTurnBadge').textContent=`Turn ${dnd.turn}`;

  const histSummary=dnd.history.slice(-3).map(h=>`Turn ${h.turn}: Player chose "${h.choice}" — ${h.outcome}`).join(' | ');
  const statsStr=`Reputation:${dnd.playerStats.reputation}, Power:${dnd.playerStats.power}, Knowledge:${dnd.playerStats.knowledge}`;

  try {
    const raw=await callApi(
      `You are the Dungeon Master for "${W.worldName}" (${W.genre}). Context: ${buildWorldContext()}
Current region: ${dnd.focusRegion}. Player stats: ${statsStr}. Turn: ${dnd.turn}.
Recent history: ${histSummary||'Adventure just began.'}.
Scene context: ${context}.

Generate a vivid narrative scene and 3-4 meaningful choices for the player.
Return ONLY JSON:
{
  "title": "Short scene title",
  "narrative": "2-4 paragraphs of atmospheric narrative. Rich, specific, drawing on world lore.",
  "choices": [
    {"id":"a","text":"Choice description (action-focused, 1-2 sentences)","type":"normal|danger|wisdom"},
    {"id":"b","text":"...","type":"normal"},
    {"id":"c","text":"...","type":"danger"},
    {"id":"d","text":"...","type":"wisdom"}
  ],
  "statEffects": {"reputation":0,"power":0,"knowledge":0}
}`,
      {maxTokens:900}
    );

    const scene=parseJsonResponse(raw);
    dnd.currentScene=scene;
    dnd.currentChoices=scene.choices||[];

    $('dndTitle').textContent=scene.title||'The Adventure';
    $('dndSceneLabel').textContent=`${esc(dnd.focusRegion)} · Turn ${dnd.turn}`;
    $('dndNarrative').innerHTML=scene.narrative
      ?scene.narrative.split('\n').filter(p=>p.trim()).map(p=>`<p>${esc(p)}</p>`).join('')
      :'<div class="dnd-empty">The Oracle is silent.</div>';

    $('dndChoices').innerHTML=scene.choices?.map(c=>`
      <button class="dnd-choice-btn${c.type==='danger'?' danger':''}" data-choice-id="${esc(c.id)}">
        ${c.type==='wisdom'?'💡 ':c.type==='danger'?'⚠ ':'→ '}${esc(c.text)}
      </button>`).join('')||'';

    $('dndChoices').querySelectorAll('.dnd-choice-btn').forEach(btn=>{
      btn.addEventListener('click',()=>makeDndChoice(btn.dataset.choiceId));
    });

    // Update stats display
    updateDndStats();

  } catch(err) {
    $('dndNarrative').innerHTML=`<div class="dnd-empty">The Oracle's vision clouds. ${esc(err.message)}</div>`;
    recordDiagError('dnd',err.message);
  }
}

async function makeDndChoice(choiceId) {
  const dnd=AppState.dnd;
  const choice=dnd.currentChoices.find(c=>c.id===choiceId); if(!choice) return;
  dnd.turn++;

  // Log to history
  dnd.history.push({turn:dnd.turn-1,choice:choice.text,outcome:'…resolving…'});

  // Resolve the choice
  try {
    const raw=await callApi(
      `World "${AppState.world.worldName}". Player in ${dnd.focusRegion} chose: "${choice.text}"
Context: ${buildWorldContext()}
Player stats: Rep:${dnd.playerStats.reputation} Pwr:${dnd.playerStats.power} Know:${dnd.playerStats.knowledge}
Resolve this choice with consequences. Return ONLY JSON:
{
  "outcome": "2-3 sentence description of immediate consequence",
  "resultType": "success|failure|partial|revelation",
  "statChanges": {"reputation":5,"power":-2,"knowledge":3},
  "worldImpact": {"type":"conflict|alliance|discovery|neutral","text":"1 sentence world event if any","regionName":"affected region name if any"},
  "nextContext": "1 sentence setting up the next scene"
}`,
      {maxTokens:400}
    );

    const result=parseJsonResponse(raw);

    // Apply stat changes
    if(result.statChanges) {
      Object.entries(result.statChanges).forEach(([k,v])=>{
        if(dnd.playerStats[k]!==undefined) dnd.playerStats[k]=Math.max(0,Math.min(100,dnd.playerStats[k]+v));
      });
    }

    // Update history
    dnd.history[dnd.history.length-1].outcome=result.outcome||'The choice was made.';

    // Feed world impact into Nova
    if(result.worldImpact?.text) {
      const nova=AppState.nova;
      nova.year+=Math.floor(1+Math.random()*3);
      nova.events.push({year:nova.year,text:`[D&D] ${result.worldImpact.text}`,type:result.worldImpact.type||'dnd'});
      if(result.worldImpact.regionName&&nova.regionState[result.worldImpact.regionName]) {
        const delta=result.resultType==='success'?8:result.resultType==='failure'?-8:3;
        nova.regionState[result.worldImpact.regionName].stability=Math.max(5,Math.min(100,nova.regionState[result.worldImpact.regionName].stability+delta));
      }
      renderMiniMapView(); renderMap();
    }

    // Show result modal
    const icons={success:'✦',failure:'✕',partial:'◈',revelation:'☽'};
    $('dndResultIcon').textContent=icons[result.resultType]||'⚄';
    $('dndResultTitle').textContent=result.resultType?.charAt(0).toUpperCase()+result.resultType?.slice(1)||'Outcome';
    $('dndResultBody').innerHTML=`<p>${esc(result.outcome||'')}</p>`;
    $('btnDndContinue').onclick=()=>{
      closeModal('dndResultModal');
      // Add to history log
      const logEl=$('dndHistory');
      const entry=document.createElement('div'); entry.className='dnd-history-entry';
      entry.innerHTML=`<div class="dnd-he-turn">Turn ${dnd.turn-1}</div>${esc(choice.text)}`;
      logEl.appendChild(entry); logEl.scrollTop=logEl.scrollHeight;
      // Continue adventure
      generateDndScene(result.nextContext||'Continue the adventure.',result.resultType);
    };
    openModal('dndResultModal');
    updateDndStats();
    saveCurrentWorld();

  } catch(err) {
    recordDiagError('dnd_choice',err.message);
    showToast('Choice resolution failed — try again.');
  }
}

function updateDndStats() {
  const dnd=AppState.dnd;
  $('dndStats').innerHTML=['reputation','power','knowledge'].map(s=>`<span class="dnd-stat-badge">${s.slice(0,3).toUpperCase()} ${dnd.playerStats[s]}</span>`).join('');
  updatePanelDnd();
}

/* ════════════════════════════════════════════════
   ORACLE CHAT — GUIDE MODE
════════════════════════════════════════════════ */
async function sendChat() {
  const input=$('chatInput'),msg=input.value.trim();
  if(!msg||!hasWorld()) return;
  const msgs=$('chatMsgs'),btn=$('chatSendBtn');
  msgs.innerHTML+=`<div class="msg-user">${esc(msg)}</div>`;
  input.value=''; btn.disabled=true;
  const typing=document.createElement('div');
  typing.className='msg-ai msg-typing'; typing.textContent='The Oracle contemplates…';
  msgs.appendChild(typing); msgs.scrollTop=msgs.scrollHeight;
  AppState.chatHistory.push({role:'user',content:msg});
  const history=AppState.chatHistory.slice(-16);

  try {
    const reply=await callApi(
      `Answer: ${msg}`,
      {
        maxTokens:900,
        systemPrompt:`You are the Oracle — the wise, atmospheric guide, narrator, and dungeon master for "${AppState.world.worldName}".
Context: ${buildWorldContext()}
You serve multiple roles:
1. Lore guide — answer questions about the world
2. Simulation advisor — suggest what interventions to make and predict consequences
3. D&D dungeon master — help design encounters and narrate adventure
4. World-building coach — suggest what lore to add to make the world richer
Be immersive, specific, and draw on actual world lore. Keep responses under 300 words unless depth is needed.`,
        conversationHistory:history.slice(0,-1),
      }
    );
    AppState.chatHistory.push({role:'assistant',content:reply});
    typing.remove();
    msgs.innerHTML+=`<div class="msg-ai">${esc(reply)}</div>`;
  } catch(err) {
    typing.remove();
    msgs.innerHTML+=`<div class="msg-ai">The Oracle's vision clouds. ${esc(err.message)}</div>`;
    recordDiagError('oracle',err.message);
  }
  btn.disabled=false; msgs.scrollTop=msgs.scrollHeight;
}

async function oracleProactiveGreeting() {
  if(!hasWorld()) return;
  const W=AppState.world;
  try {
    const raw=await callApi(
      `You are the Oracle for "${W.worldName}". The world was just created. Give a 2-3 sentence atmospheric greeting that:
1. Acknowledges the world just came into being
2. Highlights one specific intriguing element from the lore (a faction, region secret, or power system detail)
3. Suggests one thing the player might want to do next (explore Nova simulation, start a D&D adventure, or add more lore)
Keep it immersive and specific to this world. Context: ${buildWorldContext()}`,
      {maxTokens:200}
    );
    setNav('oracle');
    const msgs=$('chatMsgs');
    msgs.innerHTML+=`<div class="msg-oracle-guide">${esc(raw)}</div>`;
    msgs.scrollTop=msgs.scrollHeight;
  } catch(_) {}
}

function oracleAbout(name) {
  $('chatInput').value=`Tell me everything about ${name}.`;
  setNav('oracle'); sendChat();
}

function clearChat() {
  AppState.chatHistory=[];
  const W=AppState.world;
  $('chatMsgs').innerHTML=W
    ?`<div class="msg-ai">I am the Oracle of <em>${esc(W.worldName)}</em>. Ask me anything — I am your guide, narrator, and dungeon master.</div>`
    :`<div class="msg-ai">Forge a world to awaken the Oracle.</div>`;
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

  // Login / register
  $('btnLogin').addEventListener('click',()=>{
    const u=$('loginUsername').value.trim(),p=$('loginPassword').value,k=$('loginApiKey').value.trim();
    $('loginError').textContent='';
    if(!u||!p){$('loginError').textContent='Enter username and password.';return;}
    const r=loginUser(u,p);
    if(!r.ok){$('loginError').textContent=r.error;return;}
    if(k) saveApiKey(k);
    loadHub();
  });
  $('btnRegister').addEventListener('click',()=>{
    const u=$('regUsername').value.trim(),p=$('regPassword').value,k=$('regApiKey').value.trim();
    $('registerError').textContent='';
    if(!u||!p){$('registerError').textContent='Enter username and password.';return;}
    if(p.length<4){$('registerError').textContent='Password needs 4+ characters.';return;}
    const r=registerUser(u,p);
    if(!r.ok){$('registerError').textContent=r.error;return;}
    loginUser(u,p); if(k) saveApiKey(k); loadHub();
  });
  // Enter key on login
  [$('loginUsername'),$('loginPassword'),$('loginApiKey')].forEach(el=>{
    el?.addEventListener('keydown',e=>{if(e.key==='Enter')$('btnLogin').click();});
  });

  // Hub
  $('btnLogout').addEventListener('click',()=>{logoutUser();showScreen('login');});
  $('btnNewWorld').addEventListener('click',()=>startInterview());
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

  // Region modal close
  $('btnRegionClose').addEventListener('click',()=>closeModal('regionModal'));
  $('regionModal').addEventListener('click',e=>{if(e.target===e.currentTarget)closeModal('regionModal');});

  // Nova
  $('btnSimPlay').addEventListener('click',startSimulation);
  $('btnSimStep').addEventListener('click',runSimStep);
  $('btnSimReset').addEventListener('click',resetSimulation);
  $('btnNovaCustom').addEventListener('click',applyCustomIntervention);
  $('novaCustomInput').addEventListener('keydown',e=>{if(e.key==='Enter')applyCustomIntervention();});

  // D&D
  $('btnDndNew').addEventListener('click',()=>{resetDnd();setNav('dnd');});
  $('btnDndStart').addEventListener('click',()=>beginDnd());

  // Oracle
  $('chatSendBtn').addEventListener('click',sendChat);
  $('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}});
  $('btnClearChat').addEventListener('click',clearChat);
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

  // Pre-fill API key if saved
  const savedKey=loadApiKey();
  if(savedKey){
    const el=$('loginApiKey'); if(el) el.value=savedKey;
  }

  // Try to restore session
  if(restoreSession()) {
    const user=AppState.currentUser;
    // Check if they had an active world
    const saves=getUserSaves(user.username);
    const recent=Object.entries(saves).sort((a,b)=>b[1].savedAt-a[1].savedAt)[0];
    if(recent){
      // Auto-load most recent world and go to hub
      loadHub();
    } else {
      loadHub();
    }
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
