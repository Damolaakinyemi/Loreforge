/**
 * state.js — Centralized application state & world data schema
 *
 * Responsibilities:
 *  - Define and validate the World data schema
 *  - Hold all mutable app state in one place
 *  - Provide clean read/write helpers
 *  - Manage localStorage persistence
 */

// ─────────────────────────────────────────────────────────────
// WORLD SCHEMA CONSTANTS
// ─────────────────────────────────────────────────────────────

/** All lore categories with display metadata */
export const CATEGORIES = {
  regions: {
    label:   'Regions',
    sub:     "Your world's lands",
    nameL:   'Region Name',
    typeL:   'Terrain / Type',
  },
  characters: {
    label:   'Characters',
    sub:     'Heroes & villains',
    nameL:   'Character Name',
    typeL:   'Role / Archetype',
  },
  factions: {
    label:   'Factions',
    sub:     'Powers & organizations',
    nameL:   'Faction Name',
    typeL:   'Type (e.g. Kingdom, Cult)',
  },
  powers: {
    label:   'Power Systems',
    sub:     'Magic & abilities',
    nameL:   'System Name',
    typeL:   'Category',
  },
  history: {
    label:   'History',
    sub:     'Ages & events',
    nameL:   'Event / Era',
    typeL:   'Era Type',
  },
  prophecies: {
    label:   'Prophecies',
    sub:     'Visions & omens',
    nameL:   'Prophecy Name',
    typeL:   'Source / Oracle',
  },
  artifacts: {
    label:   'Artifacts',
    sub:     'Relics & weapons',
    nameL:   'Artifact Name',
    typeL:   'Type',
  },
};

/** Category keys in display order */
export const CATEGORY_KEYS = Object.keys(CATEGORIES);

/**
 * JSON schema templates used in AI generation prompts.
 * Each template tells the AI exactly what shape to return.
 */
export const ENTRY_SCHEMAS = {
  regions:    '{"id":"r1","name":"RegionName","type":"TerrainType","description":"2-3 sentences about this region","secret":"a hidden truth","x":300,"y":250,"radius":65,"color":"#4a6a8a"}',
  characters: '{"name":"CharName","role":"Role","description":"2-3 sentences","motivation":"what drives them","abilities":"their powers","secret":"hidden truth","region":"region name they inhabit"}',
  factions:   '{"name":"FactionName","type":"FactionType","description":"2-3 sentences","secret":"hidden agenda","motivation":"their goal","region":"primary territory"}',
  powers:     '{"name":"SystemName","category":"Category","description":"2-3 sentences","abilities":"what it enables","secret":"hidden cost or danger","history":"its origin"}',
  history:    '{"name":"EventName","era":"Era","description":"2-3 sentences","consequences":"lasting impact on the world","secret":"what was covered up"}',
  prophecies: '{"name":"ProphecyName","source":"Source","description":"one sentence summary","text":"the full prophecy in poetic form","secret":"its true hidden meaning"}',
  artifacts:  '{"name":"ArtifactName","type":"Type","description":"2-3 sentences","power":"what it does","history":"its origin story","secret":"hidden danger or truth"}',
};

/** Detail sections shown in the right panel for each entry */
export const DETAIL_SECTIONS = [
  ['secret',       'Hidden Truth'],
  ['abilities',    'Abilities'],
  ['motivation',   'Motivation'],
  ['region',       'Region'],
  ['text',         'The Prophecy'],
  ['power',        'Power / Effect'],
  ['history',      'History'],
  ['consequences', 'Consequences'],
];

/** Map overlay icons for non-region categories */
export const MAP_ICONS = {
  characters: { icon: '⚔', color: '#c9a84c' },
  factions:   { icon: '⚑', color: '#c04040' },
  artifacts:  { icon: '⚗', color: '#4a9aaa' },
};

/** Loading screen rotation phrases */
export const LOAD_PHRASES = [
  'Consulting the ancient records…',
  'Shaping the continents…',
  'Naming forgotten kingdoms…',
  'Weaving threads of history…',
  'Waking the old gods…',
  'Inscribing the first laws…',
  'Drawing the borders of fate…',
];

/** Available genre options */
export const GENRES = [
  'Dark Fantasy',
  'High Fantasy',
  'Grimdark',
  'Mythic / Ancient',
  'Cosmic Horror',
  'Steampunk',
];

// ─────────────────────────────────────────────────────────────
// STORY MODE DEFINITIONS
// ─────────────────────────────────────────────────────────────

export const STORY_MODES = {
  novel:    'Write a rich atmospheric novel chapter (600-800 words) in third-person prose with vivid description, character voice, and tension.',
  quest:    'Create 3 distinct RPG quest hooks (150 words each). For each: Quest Name, Hook, Objective, Complication, Reward.',
  campaign: 'Design a complete D&D one-shot: Setting, Inciting Incident, 3 Acts with encounters, Final Boss, 2 possible endings.',
};

// ─────────────────────────────────────────────────────────────
// APPLICATION STATE
// ─────────────────────────────────────────────────────────────

/**
 * The single mutable app state object.
 * All modules import this and mutate it directly.
 * UI functions read from it on each render.
 */
export const AppState = {
  /** Current loaded world (null if none) */
  world:         null,

  /** Active lore category key */
  activeNav:     'regions',

  /** The currently selected entry { ...entry, _idx, _cat } or null */
  selectedEntry: null,

  /** Active story mode key */
  storyMode:     'novel',

  /** Selected genre on the create screen */
  selectedGenre: '',

  /** Oracle conversation history [{ role, content }] */
  chatHistory:   [],

  /** Timestamps & meta */
  startTime:     Date.now(),
};

// ─────────────────────────────────────────────────────────────
// WORLD HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Creates a fresh world object from AI output,
 * ensuring all required category arrays exist.
 * @param {object} raw - Raw parsed JSON from AI
 * @returns {object} Normalized world object
 */
export function normalizeWorld(raw) {
  const world = { ...raw };
  CATEGORY_KEYS.forEach(cat => {
    if (!Array.isArray(world[cat])) world[cat] = [];
  });
  return world;
}

/**
 * Validates a world object has the minimum required fields.
 * @param {object} world
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateWorld(world) {
  const errors = [];
  if (!world || typeof world !== 'object') {
    return { valid: false, errors: ['World is not an object'] };
  }
  if (!world.worldName) errors.push('Missing worldName');
  if (!world.genre)     errors.push('Missing genre');
  if (!Array.isArray(world.regions) || world.regions.length < 1) {
    errors.push('Missing or empty regions array');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Builds a compact world context string for AI prompts.
 * Keeps it short to avoid wasting tokens.
 * @returns {string}
 */
export function buildWorldContext() {
  const W = AppState.world;
  if (!W) return 'No world loaded.';

  let ctx = `World: ${W.worldName} (${W.genre}). ${W.overview || ''}`;
  ctx += ` Regions: ${(W.regions || []).map(r => r.name).join(', ')}.`;

  CATEGORY_KEYS
    .filter(cat => cat !== 'regions')
    .forEach(cat => {
      const items = W[cat] || [];
      if (items.length > 0) {
        ctx += ` ${cat}: ${items.map(i => i.name).join(', ')}.`;
      }
    });

  return ctx;
}

// ─────────────────────────────────────────────────────────────
// PERSISTENCE
// ─────────────────────────────────────────────────────────────

const STORAGE_KEY  = 'loreforge_world';
const API_KEY_STORAGE = 'loreforge_apikey';

/**
 * Saves the current world to localStorage.
 * @returns {{ ok: boolean, error?: string }}
 */
export function saveWorld() {
  if (!AppState.world) return { ok: false, error: 'No world to save' };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(AppState.world));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Loads the world from localStorage.
 * @returns {{ world: object|null, error?: string }}
 */
export function loadSavedWorld() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { world: null };
    const parsed = JSON.parse(raw);
    const { valid, errors } = validateWorld(parsed);
    if (!valid) return { world: null, error: 'Invalid save: ' + errors.join(', ') };
    return { world: normalizeWorld(parsed) };
  } catch (e) {
    return { world: null, error: e.message };
  }
}

/**
 * Persists the API key to localStorage (never logs it).
 */
export function saveApiKey(key) {
  try {
    localStorage.setItem(API_KEY_STORAGE, key);
  } catch (_) { /* ignore */ }
}

/**
 * Retrieves the saved API key.
 * @returns {string}
 */
export function loadApiKey() {
  try {
    return localStorage.getItem(API_KEY_STORAGE) || '';
  } catch (_) {
    return '';
  }
}

/**
 * Whether a world is currently loaded.
 */
export function hasWorld() {
  return AppState.world !== null;
}

/**
 * Gets the sub-label for an entry (used in list + detail views).
 */
export function getEntrySubLabel(entry) {
  return entry.type || entry.role || entry.era || entry.category || '';
}
