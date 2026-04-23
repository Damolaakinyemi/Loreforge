/**
 * state.js — Application state, world schema, and persistence
 */

// ─── INTERVIEW STEPS ─────────────────────────────────────────
/**
 * Each step defines one screen in the creation wizard.
 * fields[] = the questions asked on that step.
 * Field types: text | textarea | tags | repeater
 */
export const INTERVIEW_STEPS = [
  {
    id:    'basics',
    name:  'World Basics',
    desc:  'Name & genre',
    title: 'What kind of world are you building?',
    intro: 'Start with the foundation — a name and a genre sets the tone for everything that follows.',
    fields: [
      { id: 'worldName',  type: 'text',     label: 'World Name',                   placeholder: 'e.g. Aethermoor, The Sunken Realms, Valdris…' },
      { id: 'genre',      type: 'tags',     label: 'Genre / Vibe',                 options: ['Dark Fantasy','High Fantasy','Grimdark','Mythic / Ancient','Cosmic Horror','Steampunk','Solarpunk','Post-Apocalyptic'] },
      { id: 'tagline',    type: 'text',     label: 'One-line tagline (optional)',   placeholder: 'e.g. "Where gods go to die"' },
    ],
  },
  {
    id:    'premise',
    name:  'Core Premise',
    desc:  'History & conflict',
    title: 'What is the soul of this world?',
    intro: 'The premise is the world\'s beating heart — the great wound, the central tension, the thing that makes it unlike any other.',
    fields: [
      { id: 'overview',       type: 'textarea', label: 'World Overview',                 placeholder: 'Describe the world\'s current state in 2-3 sentences. What do travelers see first? What hangs in the air?' },
      { id: 'centralConflict',type: 'textarea', label: 'Central Conflict or Tension',    placeholder: 'What is the great struggle? A war? A dying magic? A returning god? An empire crumbling?' },
      { id: 'darkSecret',     type: 'textarea', label: 'The World\'s Hidden Truth',      placeholder: 'What do most people not know — the secret that, if revealed, would change everything?' },
    ],
  },
  {
    id:    'regions',
    name:  'Regions',
    desc:  'Lands & territories',
    title: 'What lands does your world contain?',
    intro: 'Define the major territories — each one a distinct place with its own character, people, and secrets. Aim for 4–7.',
    fields: [
      {
        id:   'regions',
        type: 'repeater',
        label: 'Regions',
        itemLabel: 'Region',
        subfields: [
          { id: 'name',        placeholder: 'Region name',                        type: 'text' },
          { id: 'type',        placeholder: 'Terrain / type (e.g. Frozen tundra, Merchant republic…)', type: 'text' },
          { id: 'description', placeholder: 'Describe it in 1-2 sentences. What makes it memorable?',  type: 'textarea' },
          { id: 'secret',      placeholder: 'Its hidden truth or dark secret…',   type: 'text' },
        ],
        minItems: 3,
      },
    ],
  },
  {
    id:    'characters',
    name:  'Key Figures',
    desc:  'Heroes & villains',
    title: 'Who are the pivotal people of this world?',
    intro: 'Name the characters who drive events — rulers, rebels, prophets, monsters. You don\'t need everyone, just the ones who matter.',
    fields: [
      {
        id:   'characters',
        type: 'repeater',
        label: 'Key Characters',
        itemLabel: 'Character',
        subfields: [
          { id: 'name',        placeholder: 'Character name',                     type: 'text' },
          { id: 'role',        placeholder: 'Role / archetype (e.g. Fallen king, Shadow priest…)', type: 'text' },
          { id: 'description', placeholder: 'Who are they? What drives them?',    type: 'textarea' },
          { id: 'secret',      placeholder: 'Their hidden truth or agenda…',      type: 'text' },
        ],
        minItems: 2,
      },
    ],
  },
  {
    id:    'factions',
    name:  'Factions',
    desc:  'Powers & groups',
    title: 'What powers compete for control?',
    intro: 'Factions are the engines of conflict — kingdoms, cults, guilds, secret orders. What groups shape the world\'s events?',
    fields: [
      {
        id:   'factions',
        type: 'repeater',
        label: 'Factions',
        itemLabel: 'Faction',
        subfields: [
          { id: 'name',        placeholder: 'Faction name',                       type: 'text' },
          { id: 'type',        placeholder: 'Type (e.g. Empire, Thieves\' guild, Cult…)', type: 'text' },
          { id: 'motivation',  placeholder: 'What do they want? What\'s their ultimate goal?', type: 'text' },
          { id: 'secret',      placeholder: 'Their hidden agenda or dirty secret…', type: 'text' },
        ],
        minItems: 2,
      },
    ],
  },
  {
    id:    'power',
    name:  'Power System',
    desc:  'Magic & abilities',
    title: 'How does power and magic work here?',
    intro: 'A compelling power system has rules, costs, and mysteries. What can people do in this world that they can\'t do in ours?',
    fields: [
      { id: 'powerName',    type: 'text',     label: 'What is it called?',          placeholder: 'e.g. The Weave, Void-touch, Ironwork…' },
      { id: 'powerHow',     type: 'textarea', label: 'How does it work?',            placeholder: 'What can it do? Who can use it? What are its limits or rules?' },
      { id: 'powerCost',    type: 'textarea', label: 'What does it cost or require?', placeholder: 'Sacrifice? Years of life? Sanity? A rare material? A pact?' },
      { id: 'powerSecret',  type: 'textarea', label: 'What do most people not know about it?', placeholder: 'Its true origin, hidden danger, or forbidden application…' },
    ],
  },
  {
    id:    'history',
    name:  'History',
    desc:  'Ages & events',
    title: 'What history shapes the present?',
    intro: 'The past lives in ruins, in grudges, in forgotten prophecies. What happened — and what do people think happened?',
    fields: [
      {
        id:   'history',
        type: 'repeater',
        label: 'Key Historical Events',
        itemLabel: 'Event',
        subfields: [
          { id: 'name',         placeholder: 'Event name or era',                 type: 'text' },
          { id: 'era',          placeholder: 'When? (e.g. 800 years ago, The First Age…)', type: 'text' },
          { id: 'description',  placeholder: 'What happened?',                   type: 'textarea' },
          { id: 'consequences', placeholder: 'How does it still affect the world today?', type: 'text' },
        ],
        minItems: 2,
      },
    ],
  },
];

// ─── CATEGORY METADATA ───────────────────────────────────────
export const CATEGORIES = {
  regions:    { label: 'Regions',       sub: "Your world's lands",     nameL: 'Region Name',    typeL: 'Terrain / Type' },
  characters: { label: 'Characters',    sub: 'Heroes & villains',      nameL: 'Character Name', typeL: 'Role / Archetype' },
  factions:   { label: 'Factions',      sub: 'Powers & organizations', nameL: 'Faction Name',   typeL: 'Type' },
  powers:     { label: 'Power Systems', sub: 'Magic & abilities',      nameL: 'System Name',    typeL: 'Category' },
  history:    { label: 'History',       sub: 'Ages & events',          nameL: 'Event / Era',    typeL: 'Era Type' },
  prophecies: { label: 'Prophecies',    sub: 'Visions & omens',        nameL: 'Prophecy Name',  typeL: 'Source / Oracle' },
  artifacts:  { label: 'Artifacts',     sub: 'Relics & weapons',       nameL: 'Artifact Name',  typeL: 'Type' },
};
export const CATEGORY_KEYS = Object.keys(CATEGORIES);

export const DETAIL_SECTIONS = [
  ['secret',       'Hidden Truth'],
  ['abilities',    'Abilities'],
  ['motivation',   'Motivation'],
  ['consequences', 'Consequences'],
  ['region',       'Region'],
  ['text',         'The Prophecy'],
  ['power',        'Power / Effect'],
  ['history',      'History'],
  ['era',          'Era'],
  ['powerCost',    'Cost / Requirements'],
];

export const MAP_ICONS = {
  characters: { icon: '⚔', color: '#c9a84c' },
  factions:   { icon: '⚑', color: '#c04040' },
  artifacts:  { icon: '⚗', color: '#4a9aaa' },
};

export const LOAD_PHRASES = [
  'Consulting the ancient records…',
  'Shaping the continents…',
  'Naming forgotten kingdoms…',
  'Weaving threads of history…',
  'Waking the old gods…',
  'Inscribing the first laws…',
  'Drawing the borders of fate…',
];

// ─── SIMULATION CONFIG ────────────────────────────────────────
/** Nova sim: types of events the simulation can generate */
export const SIM_EVENT_TYPES = ['conflict','alliance','discovery','disaster','golden','neutral'];

/** Pre-built intervention options shown in the Nova panel */
export const INTERVENTION_OPTIONS = [
  { label: '⚔ Start a war',           prompt: 'A major war breaks out between two factions.' },
  { label: '🤝 Forge an alliance',     prompt: 'Two rival factions form an unexpected alliance.' },
  { label: '💀 Kill a key figure',     prompt: 'A major character is assassinated or dies under mysterious circumstances.' },
  { label: '🌋 Natural disaster',      prompt: 'A devastating natural disaster strikes a major region.' },
  { label: '✨ Discovery of power',    prompt: 'A new source of power or ancient artifact is discovered, shifting the balance.' },
  { label: '👑 A throne changes hands', prompt: 'A major leadership change occurs in the most powerful faction.' },
  { label: '📜 Prophecy fulfilled',    prompt: 'An ancient prophecy begins to come true, causing panic and upheaval.' },
  { label: '🌿 Golden Age',            prompt: 'A period of peace and prosperity begins, allowing culture and knowledge to flourish.' },
];

// ─── APPLICATION STATE ────────────────────────────────────────
export const AppState = {
  world:          null,
  activeNav:      'map',
  selectedEntry:  null,
  chatHistory:    [],
  startTime:      Date.now(),

  // Interview wizard state
  interview: {
    step:    0,
    answers: {}, // { fieldId: value }
  },

  // Nova simulation state
  nova: {
    year:       0,
    running:    false,
    events:     [],     // [{ year, text, type }]
    intervalId: null,
    regionState: {},    // { regionName: { power, stability, population } }
  },
};

// ─── WORLD HELPERS ────────────────────────────────────────────
export function normalizeWorld(raw) {
  const world = { ...raw };
  CATEGORY_KEYS.forEach(cat => { if (!Array.isArray(world[cat])) world[cat] = []; });
  // Ensure power system is an array
  if (!Array.isArray(world.powers)) world.powers = [];
  if (world.powerName && !world.powers.length) {
    world.powers.push({
      name:        world.powerName,
      category:    'Core System',
      description: world.powerHow  || '',
      abilities:   world.powerHow  || '',
      secret:      world.powerSecret || '',
      history:     world.powerCost  || '',
    });
  }
  return world;
}

export function validateWorld(world) {
  const errors = [];
  if (!world || typeof world !== 'object') return { valid: false, errors: ['Not an object'] };
  if (!world.worldName) errors.push('Missing worldName');
  if (!Array.isArray(world.regions) || world.regions.length < 1) errors.push('Missing regions');
  return { valid: errors.length === 0, errors };
}

/**
 * Builds a compact world context string for AI prompts.
 */
export function buildWorldContext() {
  const W = AppState.world;
  if (!W) return 'No world loaded.';
  let ctx = `World: "${W.worldName}" (${W.genre || 'Fantasy'}). ${W.overview || ''} `;
  if (W.centralConflict) ctx += `Central conflict: ${W.centralConflict} `;
  ctx += `Regions: ${(W.regions || []).map(r => r.name).join(', ')}. `;
  if ((W.characters || []).length) ctx += `Key figures: ${W.characters.map(c => `${c.name} (${c.role||''})`).join(', ')}. `;
  if ((W.factions  || []).length)  ctx += `Factions: ${W.factions.map(f => f.name).join(', ')}. `;
  if (W.powerName) ctx += `Power system: ${W.powerName}. `;
  return ctx.trim();
}

export function getEntrySubLabel(entry) {
  return entry.type || entry.role || entry.era || entry.category || '';
}

export function hasWorld() { return AppState.world !== null; }

// ─── PERSISTENCE ─────────────────────────────────────────────
const STORAGE_KEY    = 'loreforge_world_v2';
const API_KEY_STORE  = 'loreforge_apikey';

export function saveWorld() {
  if (!AppState.world) return { ok: false, error: 'No world' };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(AppState.world));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function loadSavedWorld() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { world: null };
    const parsed = JSON.parse(raw);
    const { valid, errors } = validateWorld(parsed);
    if (!valid) return { world: null, error: errors.join(', ') };
    return { world: normalizeWorld(parsed) };
  } catch (e) {
    return { world: null, error: e.message };
  }
}

export function saveApiKey(key)  { try { localStorage.setItem(API_KEY_STORE, key); } catch(_){} }
export function loadApiKey()     { try { return localStorage.getItem(API_KEY_STORE) || ''; } catch(_){ return ''; } }
