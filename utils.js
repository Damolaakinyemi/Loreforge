/**
 * utils.js — Pure utility functions used across Loreforge.
 *
 * Stage 1 of the app.js split. Functions here have no module-level state;
 * they take their inputs explicitly. Safe to import from anywhere.
 *
 * Categories:
 *   - DOM helpers (esc, $, showScreen, openModal, closeModal, showToast)
 *   - Text formatting (addCitationLinks, formatAlternativePreview)
 *   - NPC helpers (normalizeNpcName, levenshtein, findOrCreateNpcKey, pruneStaleNpcs)
 *   - Adventure helpers (describeStatusContext, typeReuseHint)
 */

// ────────────────────────────────────────────────────────────
// DOM HELPERS
// ────────────────────────────────────────────────────────────

/** HTML-escape a value so it's safe to render inside element bodies. */
export const esc = s =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/** Shorthand for document.getElementById. */
export const $ = id => document.getElementById(id);

/** Show a top-level screen by ID, hiding all others. */
export const showScreen = id => {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  $(`screen-${id}`)?.classList.add('active');
};

/** Open a modal by element ID. */
export const openModal  = id => $(id)?.classList.add('open');

/** Close a modal by element ID. */
export const closeModal = id => $(id)?.classList.remove('open');

/**
 * Show a transient toast notification at the top of the screen.
 * Duration scales with message length unless overridden via opts.duration.
 *
 * @param {string} msg     The toast text
 * @param {object} [opts]  { wide?: boolean, duration?: number }
 */
export function showToast(msg, opts = {}) {
  let t = $('lf-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'lf-toast';
    t.style.cssText = 'position:fixed;top:1rem;left:50%;transform:translateX(-50%);background:#100e0a;border:1px solid var(--bord);border-radius:4px;padding:.6rem 1rem;font-family:var(--fb);font-size:.88rem;color:var(--parch-dim);z-index:500;box-shadow:0 4px 20px rgba(0,0,0,.6);text-align:center;line-height:1.45';
    document.body.appendChild(t);
  }
  // Widen toast for long messages so they don't wrap into a tiny vertical strip
  t.style.maxWidth = (msg.length > 80 || opts.wide) ? '520px' : '360px';
  t.textContent = msg;
  t.style.display = 'block';
  // Duration scales with message length: ~55ms per character, min 3s, max 12s
  const duration = opts.duration ?? Math.max(3000, Math.min(12000, msg.length * 55));
  clearTimeout(t._t);
  t._t = setTimeout(() => { t.style.display = 'none'; }, duration);
}

// ────────────────────────────────────────────────────────────
// TEXT FORMATTING
// ────────────────────────────────────────────────────────────

/**
 * Wrap any world-entry name found in `text` with a clickable citation span.
 * Used by both narrative rendering and Oracle chat to make lore terms clickable.
 *
 * @param {string} text  Raw text to scan
 * @param {object} world The current world (with characters, factions, regions, etc.)
 * @returns {string}     HTML-escaped string with <span class="oracle-citation"> wrappers
 */
export function addCitationLinks(text, world) {
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

/** Render a preview of an alternative-suggestion value for the alternatives modal. */
export function formatAlternativePreview(alt) {
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

// ────────────────────────────────────────────────────────────
// NPC HELPERS — name normalization, fuzzy matching, pruning
// ────────────────────────────────────────────────────────────

/**
 * Normalize an NPC name into a stable key.
 * Strips whitespace, lowercases, collapses internal spaces, removes trailing
 * titles that the LLM sometimes adds ("Elara the Merchant" → "elara").
 */
export function normalizeNpcName(name) {
  if (!name) return '';
  let s = String(name).trim().toLowerCase();
  // Collapse multiple spaces
  s = s.replace(/\s+/g, ' ');
  // Strip diacritics (so "Ēlara" → "elara")
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // Drop common title suffixes — "elara the merchant" → "elara"
  s = s.replace(/\s+(the|of|von|de|du|da)\s+.+$/i, '');
  // Drop trailing punctuation
  s = s.replace(/[.,;:!?'"`]+$/g, '');
  return s;
}

/**
 * Given an incoming NPC name, find a close-enough existing entry in the roster
 * or return a fresh normalized key. Uses an edit-distance check against existing
 * keys to catch typos like "Kaelin" vs "Kealin".
 */
export function findOrCreateNpcKey(roster, incomingName) {
  const norm = normalizeNpcName(incomingName);
  if (!norm) return 'unknown';

  // Exact match
  if (roster[norm]) return norm;

  // Fuzzy match — only for names of similar length (avoid "Kai" matching "Kairos")
  for (const existingKey of Object.keys(roster)) {
    if (Math.abs(existingKey.length - norm.length) > 2) continue;
    if (levenshtein(existingKey, norm) <= 1 && norm.length >= 4) {
      return existingKey;
    }
  }

  return norm;
}

/** Minimal Levenshtein distance — small inputs only, O(n*m). */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/**
 * Prune NPCs not seen in the last `maxAge` chapters — but always keep
 * strong allies or enemies (|disposition| >= 50) since they're story-relevant.
 *
 * Mutates the passed adventure object's npcs map.
 */
export function pruneStaleNpcs(adv, maxAge = 12) {
  if (!adv.npcs) return;
  const current = adv.chapter || 0;
  for (const key of Object.keys(adv.npcs)) {
    const n = adv.npcs[key];
    if (!n) continue;
    const lastSeen = n.lastSeenChapter || 0;
    const age = current - lastSeen;
    if (age <= maxAge) continue;
    if (Math.abs(n.disposition || 0) >= 50) continue;  // keep story-relevant
    if (n.alive === false) continue;                    // keep dead NPCs as memorials
    delete adv.npcs[key];
  }
}

// ────────────────────────────────────────────────────────────
// ADVENTURE HELPERS
// ────────────────────────────────────────────────────────────

/** Plain-language description of the current status context (for prompt + UI). */
export function describeStatusContext(adv) {
  if (!adv.statusContext) return '';
  if (adv.playerStatus === 'captured') {
    return `held by ${adv.statusContext.capturedBy || 'enemies'} since chapter ${adv.statusContext.sinceChapter || '?'}`;
  }
  if (adv.playerStatus === 'disgraced') {
    const list = (adv.statusContext.disgracedWith || []).join(', ') || 'multiple factions';
    return `${list} have turned against you over: ${adv.statusContext.cause || 'recent events'}`;
  }
  if (adv.playerStatus === 'exhausted') {
    return `collapsed since chapter ${adv.statusContext.sinceChapter || '?'}`;
  }
  return '';
}

/** Small hint for how a scavenged resource might be useful (by type). */
export function typeReuseHint(type) {
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
