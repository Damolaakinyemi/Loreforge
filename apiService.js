/**
 * apiService.js — Anthropic API abstraction layer
 *
 * Responsibilities:
 *  - All fetch calls to the Anthropic API go through this module
 *  - Handles retries with exponential backoff
 *  - Provides structured error messages
 *  - Parses JSON from AI responses robustly
 *  - Injects API key from state (never hardcoded)
 *  - Tracks latency for diagnostics
 */

import { loadApiKey } from './state.js';

// ─────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────

const API_URL   = 'https://api.anthropic.com/v1/messages';
const MODEL     = 'claude-sonnet-4-20250514'; // Swap here to change model
const MAX_RETRY = 2;                           // Retry up to 2× on transient failure

// ─────────────────────────────────────────────────────────────
// METRICS (read by diagnostics module)
// ─────────────────────────────────────────────────────────────

export const apiMetrics = {
  lastLatencyMs: 0,
  totalCalls:    0,
  failedCalls:   0,
};

// ─────────────────────────────────────────────────────────────
// CORE API CALL
// ─────────────────────────────────────────────────────────────

/**
 * Calls the Anthropic API with automatic retry on transient errors.
 *
 * @param {string} prompt - The user prompt to send
 * @param {object} [options]
 * @param {number} [options.maxTokens=1000] - Token limit
 * @param {string} [options.systemPrompt] - Optional system prompt
 * @param {Array}  [options.conversationHistory] - Prior messages [{ role, content }]
 * @returns {Promise<string>} The AI's text response
 */
export async function callApi(prompt, options = {}) {
  const {
    maxTokens          = 1000,
    systemPrompt       = null,
    conversationHistory = [],
  } = options;

  const apiKey = loadApiKey();
  if (!apiKey) {
    throw new ApiError(
      'No API key configured. Enter your Anthropic API key on the Create screen.',
      'NO_API_KEY'
    );
  }

  const messages = [
    ...conversationHistory,
    { role: 'user', content: prompt },
  ];

  const body = {
    model:      MODEL,
    max_tokens: maxTokens,
    messages,
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 1s, 2s between retries
      await sleep(1000 * attempt);
    }

    try {
      const t0       = Date.now();
      const response = await fetch(API_URL, {
        method:  'POST',
        headers: {
          'Content-Type':         'application/json',
          'x-api-key':             apiKey,
          'anthropic-version':    '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      });

      apiMetrics.lastLatencyMs = Date.now() - t0;
      apiMetrics.totalCalls++;

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        const code    = response.status;

        // Don't retry on client errors (4xx) except rate limit
        if (code !== 429 && code >= 400 && code < 500) {
          throw new ApiError(parseHttpError(code, errText), 'HTTP_' + code);
        }

        lastError = new ApiError(parseHttpError(code, errText), 'HTTP_' + code);
        continue; // retry
      }

      const data = await response.json();

      if (!data.content || !data.content[0] || !data.content[0].text) {
        throw new ApiError('Empty or malformed API response', 'EMPTY_RESPONSE');
      }

      return data.content[0].text;

    } catch (err) {
      if (err instanceof ApiError) throw err; // don't retry API logic errors

      // Network / fetch error — retry
      lastError = new ApiError(
        `Network error: ${err.message}`,
        'NETWORK_ERROR'
      );
    }
  }

  apiMetrics.failedCalls++;
  throw lastError || new ApiError('All retry attempts failed', 'MAX_RETRIES');
}

// ─────────────────────────────────────────────────────────────
// JSON PARSING
// ─────────────────────────────────────────────────────────────

/**
 * Parses a JSON object from an AI response string.
 * Handles markdown code fences and partial prefix/suffix text.
 *
 * @param {string} raw - Raw AI text response
 * @returns {object} Parsed JSON object
 * @throws {ApiError} If no valid JSON found
 */
export function parseJsonResponse(raw) {
  // Strip common markdown wrappers
  let text = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

  // Find outermost JSON object
  const start = text.indexOf('{');
  let end = text.lastIndexOf('}');

  if (start < 0) {
    throw new ApiError(
      'AI response did not contain a JSON object. Try again.',
      'PARSE_ERROR'
    );
  }

  // If no closing brace found, the response was truncated — attempt repair
  if (end < 0 || end < start) {
    text = attemptJsonRepair(text.slice(start));
    end = text.lastIndexOf('}');
    if (end < 0) {
      throw new ApiError(
        'AI response was truncated and could not be repaired. Try again.',
        'TRUNCATED_RESPONSE'
      );
    }
    try {
      return JSON.parse(text);
    } catch (e) {
      throw new ApiError(`Truncated JSON repair failed: ${e.message}`, 'PARSE_ERROR');
    }
  }

  const candidate = text.slice(start, end + 1);

  try {
    return JSON.parse(candidate);
  } catch (e) {
    // Attempt repair on malformed (but complete-looking) JSON
    const repaired = attemptJsonRepair(candidate);
    try {
      return JSON.parse(repaired);
    } catch (e2) {
      throw new ApiError(
        `Failed to parse AI JSON: ${e.message}. Try again — the response may have been cut off.`,
        'PARSE_ERROR'
      );
    }
  }
}

/**
 * Attempts to repair truncated or malformed JSON by closing open
 * arrays and objects. Handles the most common truncation patterns.
 * @param {string} partial - Potentially incomplete JSON string
 * @returns {string} Best-effort repaired JSON string
 */
function attemptJsonRepair(partial) {
  let s = partial.trimEnd();

  // Remove trailing comma before a closing bracket (common AI mistake)
  s = s.replace(/,\s*$/, '');

  // Count unclosed braces and brackets
  let braces = 0, brackets = 0;
  let inString = false, escaped = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\' && inString) { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') braces++;
    else if (ch === '}') braces--;
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }

  // If we're mid-string, close it
  if (inString) s += '"';

  // Remove any dangling incomplete field at the end
  // e.g. ..."color":"#3a  — remove the incomplete value
  s = s.replace(/,\s*"[^"]*"\s*:\s*"[^"]*$/, '');
  s = s.replace(/,\s*"[^"]*"\s*:\s*$/, '');
  s = s.replace(/,\s*"[^"]*"\s*$/, '');

  // Close open brackets then braces (order matters)
  for (let i = 0; i < brackets; i++) s += ']';
  for (let i = 0; i < braces; i++) s += '}';

  return s;
}

// ─────────────────────────────────────════════════════════════
// API CONNECTIVITY CHECK
// ─────────────────────────────────────────────────────────────

/**
 * Quick low-cost probe to check if the API is reachable.
 * Used by the diagnostics system.
 * @returns {Promise<{ ok: boolean, latencyMs?: number, error?: string }>}
 */
export async function probeApiConnectivity() {
  const apiKey = loadApiKey();
  if (!apiKey) return { ok: false, error: 'No API key set' };

  try {
    const t0 = Date.now();
    const r  = await fetch(API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':          apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model:      MODEL,
        max_tokens: 5,
        messages:   [{ role: 'user', content: 'hi' }],
      }),
    });

    const latencyMs = Date.now() - t0;
    if (!r.ok && r.status !== 400) {
      return { ok: false, latencyMs, error: `HTTP ${r.status}` };
    }
    // Even a 400 means the server is alive and key was recognized
    return { ok: true, latencyMs };
  } catch (e) {
    return { ok: false, error: `Network: ${e.message}` };
  }
}

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

/** Readable error messages for HTTP status codes */
function parseHttpError(status, body) {
  const bodySnip = body ? body.slice(0, 120) : '';
  switch (status) {
    case 401: return 'Invalid or missing API key (401). Check your key on the Create screen.';
    case 403: return 'Access forbidden (403). Your API key may lack permissions.';
    case 429: return 'Rate limit hit (429). Wait a moment and try again.';
    case 500: return 'Anthropic server error (500). Try again shortly.';
    case 529: return 'Anthropic overloaded (529). Try again in a minute.';
    default:  return `API error ${status}: ${bodySnip}`;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─────────────────────────────────────────────────────────────
// CUSTOM ERROR CLASS
// ─────────────────────────────────────────────────────────────

export class ApiError extends Error {
  /**
   * @param {string} message - Human-readable message
   * @param {string} code    - Machine-readable code for diagnostics
   */
  constructor(message, code = 'UNKNOWN') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}
