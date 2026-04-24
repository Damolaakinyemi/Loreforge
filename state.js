/**
 * state.js — Application state, schema, auth, and persistence
 */

export const INTERVIEW_STEPS = [
  { id:'basics', name:'World Basics', desc:'Name & genre', title:'What kind of world are you building?', intro:'Start with the foundation — a name and genre sets the tone for everything that follows.',
    fields:[
      {id:'worldName',type:'text',label:'World Name',placeholder:'e.g. Aethermoor, The Sunken Realms, Valdris…'},
      {id:'genre',type:'tags',label:'Genre / Vibe',options:['Dark Fantasy','High Fantasy','Grimdark','Mythic / Ancient','Cosmic Horror','Steampunk','Solarpunk','Post-Apocalyptic']},
      {id:'tagline',type:'text',label:'One-line tagline (optional)',placeholder:'e.g. "Where gods go to die"'},
    ]},
  { id:'premise', name:'Core Premise', desc:'History & conflict', title:'What is the soul of this world?', intro:"The premise is your world's beating heart — the great wound, the central tension that makes it unlike any other.",
    fields:[
      {id:'overview',type:'textarea',label:'World Overview',placeholder:"Describe the world's current state in 2-3 sentences. What do travelers see first?"},
      {id:'centralConflict',type:'textarea',label:'Central Conflict or Tension',placeholder:'What is the great struggle? A war? A dying magic? A returning god?'},
      {id:'darkSecret',type:'textarea',label:"The World's Hidden Truth",placeholder:'What do most people not know — the secret that would change everything if revealed?'},
    ]},
  { id:'regions', name:'Regions', desc:'Lands & territories', title:'What lands does your world contain?', intro:'Define the major territories — each a distinct place with its own character and secrets. Aim for 4–7.',
    fields:[{id:'regions',type:'repeater',label:'Regions',itemLabel:'Region',subfields:[
      {id:'name',placeholder:'Region name',type:'text'},
      {id:'type',placeholder:'Terrain / type (e.g. Frozen tundra, Merchant republic…)',type:'text'},
      {id:'description',placeholder:'Describe it in 1-2 sentences. What makes it memorable?',type:'textarea'},
      {id:'secret',placeholder:'Its hidden truth or dark secret…',type:'text'},
    ],minItems:3}]},
  { id:'characters', name:'Key Figures', desc:'Heroes & villains', title:'Who are the pivotal people of this world?', intro:"Name the characters who drive events — rulers, rebels, prophets, monsters. You don't need everyone, just the ones who matter.",
    fields:[{id:'characters',type:'repeater',label:'Key Characters',itemLabel:'Character',subfields:[
      {id:'name',placeholder:'Character name',type:'text'},
      {id:'role',placeholder:'Role / archetype (e.g. Fallen king, Shadow priest…)',type:'text'},
      {id:'description',placeholder:'Who are they? What drives them?',type:'textarea'},
      {id:'secret',placeholder:'Their hidden truth or agenda…',type:'text'},
    ],minItems:2}]},
  { id:'factions', name:'Factions', desc:'Powers & groups', title:'What powers compete for control?', intro:'Factions are the engines of conflict — kingdoms, cults, guilds, secret orders.',
    fields:[{id:'factions',type:'repeater',label:'Factions',itemLabel:'Faction',subfields:[
      {id:'name',placeholder:'Faction name',type:'text'},
      {id:'type',placeholder:"Type (e.g. Empire, Thieves' guild, Cult…)",type:'text'},
      {id:'motivation',placeholder:"What do they want? What's their ultimate goal?",type:'text'},
      {id:'secret',placeholder:'Their hidden agenda or dirty secret…',type:'text'},
    ],minItems:2}]},
  { id:'power', name:'Power System', desc:'Magic & abilities', title:'How does power and magic work here?', intro:'A compelling power system has rules, costs, and mysteries.',
    fields:[
      {id:'powerName',type:'text',label:'What is it called?',placeholder:'e.g. The Weave, Void-touch, Ironwork…'},
      {id:'powerHow',type:'textarea',label:'How does it work?',placeholder:'What can it do? Who can use it? What are its limits?'},
      {id:'powerCost',type:'textarea',label:'What does it cost or require?',placeholder:'Sacrifice? Years of life? Sanity? A rare material?'},
      {id:'powerSecret',type:'textarea',label:'What do most people not know about it?',placeholder:'Its true origin, hidden danger, or forbidden application…'},
    ]},
  { id:'history', name:'History', desc:'Ages & events', title:'What history shapes the present?', intro:'The past lives in ruins, in grudges, in forgotten prophecies.',
    fields:[{id:'history',type:'repeater',label:'Key Historical Events',itemLabel:'Event',subfields:[
      {id:'name',placeholder:'Event name or era',type:'text'},
      {id:'era',placeholder:'When? (e.g. 800 years ago, The First Age…)',type:'text'},
      {id:'description',placeholder:'What happened?',type:'textarea'},
      {id:'consequences',placeholder:'How does it still affect the world today?',type:'text'},
    ],minItems:2}]},
];

export const CATEGORIES = {
  regions:    {label:'Regions',sub:"Your world's lands",nameL:'Region Name',typeL:'Terrain / Type'},
  characters: {label:'Characters',sub:'Heroes & villains',nameL:'Character Name',typeL:'Role / Archetype'},
  factions:   {label:'Factions',sub:'Powers & organizations',nameL:'Faction Name',typeL:'Type'},
  powers:     {label:'Power Systems',sub:'Magic & abilities',nameL:'System Name',typeL:'Category'},
  history:    {label:'History',sub:'Ages & events',nameL:'Event / Era',typeL:'Era Type'},
  prophecies: {label:'Prophecies',sub:'Visions & omens',nameL:'Prophecy Name',typeL:'Source / Oracle'},
  artifacts:  {label:'Artifacts',sub:'Relics & weapons',nameL:'Artifact Name',typeL:'Type'},
};
export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export const DETAIL_SECTIONS = [
  ['secret','Hidden Truth'],['abilities','Abilities'],['motivation','Motivation'],
  ['consequences','Consequences'],['region','Region'],['text','The Prophecy'],
  ['power','Power / Effect'],['history','History'],['era','Era'],['powerCost','Cost'],
];

export const MAP_ICONS = {
  characters:{icon:'⚔',color:'#c9a84c'},
  factions:{icon:'⚑',color:'#c04040'},
  artifacts:{icon:'⚗',color:'#4a9aaa'},
};

export const LOAD_PHRASES = [
  'Consulting the ancient records…','Shaping the continents…',
  'Naming forgotten kingdoms…','Weaving threads of history…',
  'Waking the old gods…','Inscribing the first laws…',
  'Drawing the borders of fate…',
];

export const INTERVENTION_OPTIONS = [
  {label:'⚔ Start a war',prompt:'A major war breaks out between two factions.'},
  {label:'🤝 Forge an alliance',prompt:'Two rival factions form an unexpected alliance.'},
  {label:'💀 Kill a key figure',prompt:'A major character is assassinated or dies mysteriously.'},
  {label:'🌋 Natural disaster',prompt:'A devastating natural disaster strikes a major region.'},
  {label:'✨ Power discovered',prompt:'A new source of power or ancient artifact is unearthed.'},
  {label:'👑 Throne changes',prompt:'A major leadership change occurs in the most powerful faction.'},
  {label:'📜 Prophecy fulfilled',prompt:'An ancient prophecy begins to come true, causing upheaval.'},
  {label:'🌿 Golden Age',prompt:'A period of peace and prosperity begins.'},
];

// ═══ SURPRISE ME TASTE DIALS ═══
export const TASTE_DIALS = [
  { id:'tone',        label:'Tone',        left:'Dark',     right:'Hopeful',   default:50 },
  { id:'scale',       label:'Scale',       left:'Intimate', right:'Epic',      default:50 },
  { id:'familiarity', label:'Familiarity', left:'Classic',  right:'Weird',     default:50 },
  { id:'density',     label:'Density',     left:'Sparse',   right:'Rich',      default:50 },
  { id:'originality', label:'Originality', left:'Safe',     right:'Bold',      default:65 },
];

export const STYLE_PRESETS = [
  { id:'none',    label:'No preset',        description:'' },
  { id:'ghibli',  label:'✨ Studio Ghibli',  description:'Environmental themes, quiet villains, transformation motifs, spirit worlds, and hopeful melancholy.' },
  { id:'souls',   label:'🗡 Dark Souls',     description:'A world defined by what has already fallen. Tragic heroes, cryptic lore, rituals outliving meaning, beauty in decay.' },
  { id:'earthsea',label:'🌊 Earthsea',       description:'Archipelago geography, true-name magic, slow thoughtful prose, balance as cosmic principle.' },
  { id:'witcher', label:'⚔ The Witcher',     description:'Morally grey, folklore-rooted, political intrigue, monsters are metaphors, reluctant protagonists.' },
  { id:'borges',  label:'📚 Borges',         description:'Infinite libraries, mirrored labyrinths, philosophical paradoxes, reality as puzzle.' },
  { id:'miyazaki',label:'🌿 Miyazaki',       description:'Nature vs industry, child heroes, flying machines, kindness as strength, wonder without irony.' },
];

// ═══ ORACLE ROLES ═══
export const ORACLE_ROLES = {
  oracle: {
    label: '☽ The Oracle',
    description: 'Neutral narrator and guide',
    systemPrompt: 'You are the Oracle — a wise, atmospheric guide for this world. Be immersive and specific. Draw on the world lore provided.',
  },
  cartographer: {
    label: '◈ The Cartographer',
    description: 'Geography, terrain, travel',
    systemPrompt: 'You are the Cartographer — focused on the physical world. Answer in terms of terrain, routes, borders, distances, climates, and how places feel to travel through. Describe regions like someone who has walked them.',
  },
  historian: {
    label: '📜 The Historian',
    description: 'Timeline, causality, past events',
    systemPrompt: 'You are the Historian — focused on cause and effect across time. Frame answers in terms of "this happened because…" and "this led to…". Connect present events to past ones explicitly.',
  },
  devil: {
    label: '⚠ The Devil\'s Advocate',
    description: 'Challenges your choices',
    systemPrompt: 'You are the Devil\'s Advocate — you challenge the user\'s creative choices. Push back on clichés, identify weak logic in the lore, and suggest what would make this world stronger. Be direct but constructive, not mean.',
  },
  dm: {
    label: '⚄ The Dungeon Master',
    description: 'Scenarios, encounters, adventure',
    systemPrompt: 'You are the Dungeon Master — focused on making this world playable. Frame answers in terms of scenarios, encounters, NPCs, hooks, stakes, and adventure pacing. Think in scenes.',
  },
};

// ═══ WORLD PROPOSAL SYSTEM ═══
// When Oracle suggests adding something to the world, it returns a proposal object
// that the user can accept, edit, or reject
export const PROPOSAL_CATEGORIES = ['regions','characters','factions','powers','history','prophecies','artifacts'];

// ── APP STATE ────────────────────────────────────
export const AppState = {
  world: null,
  activeNav: 'map',
  selectedEntry: null,
  chatHistory: [],
  startTime: Date.now(),
  currentUser: null,

  // Interview — now with locked fields and per-field state
  interview: {
    step: 0,
    answers: {},
    locked: {},           // { fieldId: true } — locked fields survive re-rolls
    tasteDials: { tone:50, scale:50, familiarity:50, density:50, originality:65 },
    stylePreset: 'none',
    savedForResume: false, // true once user has abandoned mid-wizard
  },

  nova: {
    year: 0,
    running: false,
    events: [],            // [{year, text, type, affectedRegions, causedBy}]
    intervalId: null,
    regionState: {},       // { regionName: { power, stability, population, trend, lastChange } }
    factionState: {},      // { factionName: { influence, territory, reputation } }
    epoch: 'Age of Dawn',  // AI-named era that changes as world evolves
    epochEvents: 0,        // events in current epoch (triggers new epoch every ~15)
    pendingConsequences: [], // scheduled future effects from past events
    worldThemes: [],       // emergent themes the AI identifies over time
  },

  // Adventure inventory, health, achievements
  adventureInventory: {
    items: [],           // [{name, description, history, usefulFor, obtainedChapter, isStarter}]
    health: 100,
    maxHealth: 100,
    keyInsights: [],     // important lore the player has learned
    achievements: [],    // [{name, description, chapter}]
  },

  // UI state for polish features
  ui: {
    mapOverlay: 'illustrated',  // 'illustrated' | 'political' | 'stability'
    apiCallCount: 0,            // rough cost awareness
    lastSavedAt: null,
  },

  // Adventure Mode — lore-grounded choose-your-own-adventure
  adventure: {
    active:       false,
    chapter:      0,
    playerName:   '',
    playerFaction: null,
    playerOrigin:  null,
    playerBg:     '',

    // Archetype choice drives starting attribute distribution
    // Each archetype has the same 100 total points across 4 stats
    playerArchetype: null,  // { id, label, description, stats: {strength, intelligence, dexterity, speed} }

    factionStanding: {},

    currentRegion: null,
    history: [],
    currentChoices: [],
    worldImpacts: [],

    // Legacy tracking — when player dies, this captures their final state
    // so their heir can inherit part of it
    legacyChain: [],  // [{name, faction, origin, chapters, deathRegion, finalItems}]
  },

  // Oracle role selection and persistent chat memory
  oracle: {
    role: 'oracle',
    chatByWorld: {},
    pendingProposals: [],
  },
};

// ═══ ADVENTURE ARCHETYPES — stat distributions ═══
// Each archetype gets 100 total points across 4 attributes.
// The attributes form a shape when visualized on a diamond/radial chart.
export const ARCHETYPES = [
  {
    id:    'warrior',
    label: 'Warrior',
    icon:  '⚔',
    description: 'Born with a blade in hand. Physical prowess above all.',
    stats: { strength: 40, intelligence: 15, dexterity: 25, speed: 20 },
  },
  {
    id:    'scholar',
    label: 'Scholar',
    icon:  '📜',
    description: 'Raised among books and secrets. Knowledge is your weapon.',
    stats: { strength: 15, intelligence: 45, dexterity: 25, speed: 15 },
  },
  {
    id:    'rogue',
    label: 'Rogue',
    icon:  '🗡',
    description: 'Shadows are your cover. Dexterity and speed keep you alive.',
    stats: { strength: 20, intelligence: 20, dexterity: 35, speed: 25 },
  },
  {
    id:    'wanderer',
    label: 'Wanderer',
    icon:  '◎',
    description: 'Balanced in all things. A generalist who adapts to anything.',
    stats: { strength: 25, intelligence: 25, dexterity: 25, speed: 25 },
  },
  {
    id:    'ranger',
    label: 'Ranger',
    icon:  '🏹',
    description: 'Swift and observant. You see what others miss, and you move before they react.',
    stats: { strength: 20, intelligence: 25, dexterity: 25, speed: 30 },
  },
  {
    id:    'mystic',
    label: 'Mystic',
    icon:  '✦',
    description: 'Touched by the power system of your world. Wisdom beyond years.',
    stats: { strength: 15, intelligence: 40, dexterity: 20, speed: 25 },
  },
];

// ── WORLD HELPERS ────────────────────────────────
export function normalizeWorld(raw) {
  const world = {...raw};
  CATEGORY_KEYS.forEach(cat => { if (!Array.isArray(world[cat])) world[cat]=[]; });
  if (!Array.isArray(world.powers)) world.powers=[];
  if (world.powerName && !world.powers.length) {
    world.powers.push({name:world.powerName,category:'Core System',description:world.powerHow||'',abilities:world.powerHow||'',secret:world.powerSecret||'',history:world.powerCost||''});
  }
  return world;
}

export function validateWorld(world) {
  const errors=[];
  if (!world||typeof world!=='object') return {valid:false,errors:['Not an object']};
  if (!world.worldName) errors.push('Missing worldName');
  if (!Array.isArray(world.regions)||world.regions.length<1) errors.push('Missing regions');
  return {valid:errors.length===0,errors};
}

export function buildWorldContext() {
  const W = AppState.world;
  if (!W) return 'No world loaded.';
  let ctx = `World: "${W.worldName}" (${W.genre || 'Fantasy'}). ${W.overview || ''} `;
  if (W.centralConflict) ctx += `Central conflict: ${W.centralConflict} `;
  ctx += `Regions: ${(W.regions || []).map(r => r.name).join(', ')}. `;
  if ((W.characters || []).length) ctx += `Key figures: ${W.characters.map(c => `${c.name} (${c.role || ''})`).join(', ')}. `;
  if ((W.factions || []).length) ctx += `Factions: ${W.factions.map(f => f.name).join(', ')}. `;
  if (W.powerName) ctx += `Power system: ${W.powerName}. `;

  // Rich simulation memory — used by Oracle, Nova, and Adventure
  const sim = AppState.nova;
  if (sim.events.length) {
    ctx += `\n\n=== CURRENT WORLD STATE (Year ${sim.year}, ${sim.epoch}) ===\n`;

    // Region status with trends
    const regionStatus = Object.entries(sim.regionState || {}).map(([name, s]) => {
      const trendSym = s.trend === 'rising' ? '↑' : s.trend === 'falling' ? '↓' : '→';
      return `${name}: ${s.power}% ${trendSym}, stab ${s.stability}%`;
    }).join(' | ');
    if (regionStatus) ctx += `Regions: ${regionStatus}\n`;

    // Last 5 events for stronger continuity than before
    const recent = sim.events.slice(-5).map(e => `Yr ${e.year}: ${e.text}`).join(' | ');
    ctx += `Recent history: ${recent}\n`;

    if (sim.worldThemes?.length) {
      ctx += `Emerging themes: ${sim.worldThemes.slice(-3).join(', ')}\n`;
    }

    if (sim.pendingConsequences?.length) {
      ctx += `Brewing tensions: ${sim.pendingConsequences.map(c => c.description).join('; ')}\n`;
    }
  }

  return ctx.trim();
}

export function getEntrySubLabel(e) {
  return e.type||e.role||e.era||e.category||'';
}
export function hasWorld() { return AppState.world!==null; }

// ── AUTH & PERSISTENCE ───────────────────────────
const USERS_KEY  = 'lf_users_v3';
const SAVES_KEY  = 'lf_saves_v3';   // per-user save slots
const API_KEY_K  = 'lf_apikey';
const SESSION_K  = 'lf_session';

function getUsers()  { try{return JSON.parse(localStorage.getItem(USERS_KEY)||'{}')}catch{return{}} }
function getSaves()  { try{return JSON.parse(localStorage.getItem(SAVES_KEY)||'{}')}catch{return{}} }
function putSaves(s) { localStorage.setItem(SAVES_KEY,JSON.stringify(s)) }

export function registerUser(username,password) {
  const users=getUsers();
  if(users[username]) return {ok:false,error:'Username already taken.'};
  users[username]={pw:btoa(password),created:Date.now()};
  localStorage.setItem(USERS_KEY,JSON.stringify(users));
  return {ok:true};
}

export function loginUser(username,password) {
  const users=getUsers();
  const u=users[username];
  if(!u) return {ok:false,error:'Username not found.'};
  if(u.pw!==btoa(password)) return {ok:false,error:'Incorrect password.'};
  AppState.currentUser={username};
  localStorage.setItem(SESSION_K,username);
  return {ok:true};
}

export function restoreSession() {
  try{
    const u=localStorage.getItem(SESSION_K);
    if(u){AppState.currentUser={username:u};return true;}
  }catch{}
  return false;
}

export function logoutUser() {
  AppState.currentUser=null;
  AppState.world=null;
  localStorage.removeItem(SESSION_K);
}

export function saveApiKey(key) { try{localStorage.setItem(API_KEY_K,key)}catch{} }
export function loadApiKey()    { try{return localStorage.getItem(API_KEY_K)||''}catch{return''} }

// ── WORLD SAVE SLOTS ─────────────────────────────
export function getUserSaves(username) {
  const all=getSaves();
  return all[username]||{};
}

export function saveWorldSlot(username,slotId,world) {
  const all=getSaves();
  if(!all[username]) all[username]={};
  all[username][slotId]={
    world,
    name:world.worldName||'Unnamed',
    genre:world.genre||'',
    savedAt:Date.now(),
    novaYear:AppState.nova.year||0,
  };
  putSaves(all);
}

export function loadWorldSlot(username,slotId) {
  const all=getSaves();
  return all[username]?.[slotId]||null;
}

export function deleteWorldSlot(username,slotId) {
  const all=getSaves();
  if(all[username]) delete all[username][slotId];
  putSaves(all);
}

export function saveCurrentWorld() {
  if(!AppState.world||!AppState.currentUser) return {ok:false,error:'No world or user'};
  const slotId=AppState.world._slotId||('world_'+Date.now());
  AppState.world._slotId=slotId;
  saveWorldSlot(AppState.currentUser.username,slotId,AppState.world);
  return {ok:true};
}

// Alias for diagnostics compatibility
export function saveWorld() { return saveCurrentWorld(); }

// ═══════════════════════════════════════════════
// INTERVIEW RESUME — save/load mid-wizard progress
// ═══════════════════════════════════════════════
const RESUME_KEY = 'lf_interview_resume';

/** Save current interview progress for later resume */
export function saveInterviewProgress() {
  if (!AppState.currentUser) return;
  try {
    const key = `${RESUME_KEY}_${AppState.currentUser.username}`;
    localStorage.setItem(key, JSON.stringify({
      step:        AppState.interview.step,
      answers:     AppState.interview.answers,
      locked:      AppState.interview.locked,
      tasteDials:  AppState.interview.tasteDials,
      stylePreset: AppState.interview.stylePreset,
      savedAt:     Date.now(),
    }));
    AppState.interview.savedForResume = true;
  } catch (_) {}
}

/** Load saved interview progress, returns null if none */
export function loadInterviewProgress() {
  if (!AppState.currentUser) return null;
  try {
    const key = `${RESUME_KEY}_${AppState.currentUser.username}`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}

/** Clear saved interview progress (called after world is forged) */
export function clearInterviewProgress() {
  if (!AppState.currentUser) return;
  try {
    const key = `${RESUME_KEY}_${AppState.currentUser.username}`;
    localStorage.removeItem(key);
    AppState.interview.savedForResume = false;
  } catch (_) {}
}

// ═══════════════════════════════════════════════
// ORACLE CHAT MEMORY — persist per world
// ═══════════════════════════════════════════════
const CHAT_KEY = 'lf_oracle_chats';

function getAllChats() {
  try { return JSON.parse(localStorage.getItem(CHAT_KEY) || '{}'); }
  catch { return {}; }
}

/** Save current chat history for the active world */
export function saveOracleChat() {
  if (!AppState.world?._slotId || !AppState.currentUser) return;
  try {
    const all  = getAllChats();
    const key  = `${AppState.currentUser.username}_${AppState.world._slotId}`;
    all[key]   = AppState.chatHistory;
    localStorage.setItem(CHAT_KEY, JSON.stringify(all));
  } catch (_) {}
}

/** Load chat history for the active world */
export function loadOracleChat() {
  if (!AppState.world?._slotId || !AppState.currentUser) return [];
  try {
    const all = getAllChats();
    const key = `${AppState.currentUser.username}_${AppState.world._slotId}`;
    return all[key] || [];
  } catch { return []; }
}

/** Clear chat for current world */
export function clearOracleChat() {
  if (!AppState.world?._slotId || !AppState.currentUser) return;
  try {
    const all = getAllChats();
    const key = `${AppState.currentUser.username}_${AppState.world._slotId}`;
    delete all[key];
    localStorage.setItem(CHAT_KEY, JSON.stringify(all));
  } catch (_) {}
}

// ═══════════════════════════════════════════════
// ADVENTURE SAVE STATES — save/load mid-run
// Multiple save slots per world so player can bookmark key moments
// ═══════════════════════════════════════════════
const ADV_SAVES_KEY = 'lf_adv_saves';

function getAllAdvSaves() {
  try { return JSON.parse(localStorage.getItem(ADV_SAVES_KEY) || '{}'); }
  catch { return {}; }
}

/** Save current adventure run with a label */
export function saveAdventureState(label) {
  if (!AppState.world?._slotId || !AppState.currentUser) return { ok: false, error: 'No world' };
  if (!AppState.adventure.active) return { ok: false, error: 'No active adventure' };
  try {
    const all = getAllAdvSaves();
    const userKey  = `${AppState.currentUser.username}_${AppState.world._slotId}`;
    if (!all[userKey]) all[userKey] = [];
    all[userKey].push({
      label:      label || `Chapter ${AppState.adventure.chapter}`,
      savedAt:    Date.now(),
      adventure:  JSON.parse(JSON.stringify(AppState.adventure)),
      inventory:  JSON.parse(JSON.stringify(AppState.adventureInventory)),
    });
    // Keep at most 10 adventure saves per world
    if (all[userKey].length > 10) all[userKey].shift();
    localStorage.setItem(ADV_SAVES_KEY, JSON.stringify(all));
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

/** Get all adventure saves for the active world */
export function getAdventureSaves() {
  if (!AppState.world?._slotId || !AppState.currentUser) return [];
  const all = getAllAdvSaves();
  const userKey = `${AppState.currentUser.username}_${AppState.world._slotId}`;
  return all[userKey] || [];
}

/** Load an adventure save by its index */
export function loadAdventureSave(idx) {
  const saves = getAdventureSaves();
  const save  = saves[idx];
  if (!save) return { ok: false, error: 'Save not found' };
  AppState.adventure          = save.adventure;
  AppState.adventureInventory = save.inventory;
  return { ok: true };
}

/** Delete an adventure save */
export function deleteAdventureSave(idx) {
  if (!AppState.world?._slotId || !AppState.currentUser) return;
  const all = getAllAdvSaves();
  const userKey = `${AppState.currentUser.username}_${AppState.world._slotId}`;
  if (all[userKey] && all[userKey][idx] !== undefined) {
    all[userKey].splice(idx, 1);
    localStorage.setItem(ADV_SAVES_KEY, JSON.stringify(all));
  }
}
