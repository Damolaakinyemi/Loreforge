/**
 * apiService.js — Anthropic API abstraction layer
 * Handles retries, key injection, structured errors, and JSON parsing.
 */

import { loadApiKey } from './state.js';

const API_URL   = 'https://api.anthropic.com/v1/messages';
const MODEL     = 'claude-sonnet-4-20250514';
const MAX_RETRY = 2;

export const apiMetrics = {
  lastLatencyMs: 0,
  totalCalls:    0,
  failedCalls:   0,
};

/**
 * Core API call with retry + backoff.
 * @param {string} prompt
 * @param {object} options - { maxTokens, systemPrompt, conversationHistory }
 */
export async function callApi(prompt, options = {}) {
  const { maxTokens = 1000, systemPrompt = null, conversationHistory = [] } = options;

  const apiKey = loadApiKey();
  if (!apiKey) throw new ApiError('No API key. Enter it on the home screen.', 'NO_API_KEY');

  const messages = [...conversationHistory, { role: 'user', content: prompt }];
  const body = { model: MODEL, max_tokens: maxTokens, messages };
  if (systemPrompt) body.system = systemPrompt;

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    if (attempt > 0) await sleep(1000 * attempt);
    try {
      const t0 = Date.now();
      const response = await fetch(API_URL, {
        method:  'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':          apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(body),
      });
      apiMetrics.lastLatencyMs = Date.now() - t0;
      apiMetrics.totalCalls++;

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        const code = response.status;
        if (code !== 429 && code >= 400 && code < 500)
          throw new ApiError(parseHttpError(code, errText), 'HTTP_' + code);
        lastError = new ApiError(parseHttpError(code, errText), 'HTTP_' + code);
        continue;
      }

      const data = await response.json();
      if (!data.content?.[0]?.text) throw new ApiError('Empty API response', 'EMPTY');
      return data.content[0].text;

    } catch (err) {
      if (err instanceof ApiError) throw err;
      lastError = new ApiError(`Network error: ${err.message}`, 'NETWORK');
    }
  }
  apiMetrics.failedCalls++;
  throw lastError || new ApiError('All retries failed', 'MAX_RETRIES');
}

/**
 * Parses a JSON object out of an AI response string.
 */
export function parseJsonResponse(raw) {
  const text  = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = text.indexOf('{');
  const end   = text.lastIndexOf('}');
  if (start < 0 || end < 0) throw new ApiError('No JSON in response', 'PARSE_ERROR');
  try { return JSON.parse(text.slice(start, end + 1)); }
  catch (e) { throw new ApiError(`JSON parse failed: ${e.message}`, 'PARSE_ERROR'); }
}

/**
 * Low-cost API probe for the diagnostics system.
 */
export async function probeApiConnectivity() {
  const apiKey = loadApiKey();
  if (!apiKey) return { ok: false, error: 'No API key set' };
  try {
    const t0 = Date.now();
    const r  = await fetch(API_URL, {
      method:  'POST',
      headers: { 'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true' },
      body:    JSON.stringify({ model: MODEL, max_tokens: 5, messages: [{ role:'user', content:'hi' }] }),
    });
    return { ok: r.ok || r.status === 400, latencyMs: Date.now() - t0 };
  } catch (e) {
    return { ok: false, error: `Network: ${e.message}` };
  }
}

function parseHttpError(status, body) {
  const snip = (body || '').slice(0, 100);
  const map  = { 401: 'Invalid API key (401).', 403: 'Access forbidden (403).', 429: 'Rate limited (429) — wait a moment.', 500: 'Server error (500).', 529: 'Overloaded (529) — try again.' };
  return map[status] || `API error ${status}: ${snip}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export class ApiError extends Error {
  constructor(message, code = 'UNKNOWN') { super(message); this.name = 'ApiError'; this.code = code; }
}
