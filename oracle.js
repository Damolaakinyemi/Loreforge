/**
 * oracle.js — Oracle chat module (Guide / Narrator / DM mode)
 *
 * Stage 5 of the app.js split. Owns Oracle chat including role switching,
 * structured proposals (Oracle suggests new entries to add to the world),
 * citation rendering (clickable lore terms in chat), and chat history
 * persistence.
 *
 * Entry points (called from app.js wiring):
 *   - renderOracleRoleBar()       — the role switcher pill row
 *   - sendChat()                  — submit message and stream reply
 *   - oracleProactiveGreeting()   — Oracle introduces itself after world creation
 *   - oracleAbout(name)           — open Oracle on a specific entry
 *   - restoreOracleChat()         — repaint chat from saved history
 *   - clearChat()                 — wipe chat
 *   - handleCitationClick(e)      — click delegate for inline lore citations
 *   - initOracleHooks(hooks)      — wire side-effect callbacks
 *
 * Hooks expected: { setNav, renderMap, openAddEntryModal }.
 * Note: sendChat is exported by this module — other modules can import it
 * directly. We do NOT need it as a hook into oracle.js.
 */

import {
  AppState, ORACLE_ROLES, PROPOSAL_CATEGORIES,
  hasWorld, buildWorldContext, saveCurrentWorld,
  saveOracleChat, loadOracleChat, clearOracleChat,
} from './state.js';
import { callApi } from './apiService.js';
import { recordDiagError, diagLog } from './diagnostics.js';
import { $, esc, showToast, addCitationLinks } from './utils.js';

let _hooks = {
  setNav: null,
  renderMap: null,
  openAddEntryModal: null,
};

/** Wire side-effect callbacks. Call once at app startup. */
export function initOracleHooks(hooks) {
  _hooks = { ..._hooks, ...hooks };
}

/** Click delegate for clickable lore citations inside Oracle chat messages. */
export function handleCitationClick(e) {
  const cite = e.target.closest('.oracle-citation');
  if (cite) oracleAbout(cite.dataset.entry);
}

/* ════════════════════════════════════════════════
   ORACLE CHAT — GUIDE MODE
════════════════════════════════════════════════ */
/* ════════════════════════════════════════════════
   ORACLE v2 — roles, proposals, memory, citations
════════════════════════════════════════════════ */

/** Render the Oracle role switcher in the header */
export function renderOracleRoleBar() {
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
export async function sendChat() {
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
export function extractProposal(reply) {
  const match = reply.match(/\[PROPOSE:(\{.*?\})\]/s);
  if (!match) return { cleanReply: reply, proposal: null };

  let proposal = null;
  try { proposal = JSON.parse(match[1]); } catch (_) {}

  const cleanReply = reply.replace(/\[PROPOSE:.*?\]/s, '').trim();
  return { cleanReply, proposal };
}

/**
 * Render a proposal card — Oracle suggests adding an entry to the world.
 * User can Accept, Edit, or Reject.
 */
export function renderProposalCard(proposal, msgs) {
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
    _hooks.openAddEntryModal?.(proposal.category, proposal.entry);
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
  _hooks.renderMap?.();
  showToast(`${proposal.entry.name} added to ${cat}.`);
  diagLog('ok', `Oracle proposal accepted: ${proposal.entry.name} → ${cat}`);
}

/** Proactive Oracle greeting when world is first created */
export async function oracleProactiveGreeting() {
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
    _hooks.setNav?.('oracle');
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
export function oracleAbout(name) {
  $('chatInput').value = `Tell me everything about ${name} — their role, secrets, and how they connect to the rest of the world.`;
  _hooks.setNav?.('oracle');
  sendChat();
}

/** Load persisted chat for this world and restore it to the UI */
export function restoreOracleChat() {
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

export function clearChat() {
  AppState.chatHistory = [];
  clearOracleChat();
  const W = AppState.world;
  $('chatMsgs').innerHTML = W
    ? `<div class="msg-ai">I am the Oracle of <em>${esc(W.worldName)}</em>. Ask me anything — I am your guide, narrator, and dungeon master.</div>`
    : `<div class="msg-ai">Forge a world to awaken the Oracle.</div>`;
}

