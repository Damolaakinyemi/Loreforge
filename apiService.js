/**
 * apiService.js — Anthropic API abstraction layer
 * Handles retries, key injection, structured errors, and JSON parsing.
 */

import { loadApiKey, loadGeminiKey } from './state.js';

const API_URL   = 'https://api.anthropic.com/v1/messages';
const MODEL     = 'claude-sonnet-4-20250514';
const MAX_RETRY = 2;

// Gemini Imagen — used only for optional map artwork generation.
// Endpoint and model are stable as of late 2025. The model returns base64 image
// data inline as part of the generateContent response.
const GEMINI_URL   = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent';

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
/**
 * Robust JSON parser — handles common AI output issues.
 */
export function parseJsonResponse(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new ApiError('Empty response', 'PARSE_ERROR');
  }

  // Strategy 1: Strip markdown fences
  let text = raw.replace(/```(?:json)?\s*/gi, '').replace(/```\s*$/g, '').trim();

  // Strategy 2: Normalize smart punctuation that can break JSON
  text = text
    .replace(/[\u2018\u2019]/g, "'")          // smart single quotes → '
    .replace(/[\u201C\u201D]/g, '"')          // smart double quotes → "
    .replace(/[\u2013\u2014]/g, '-');         // em/en dashes → -

  // Strategy 3: Find the outermost JSON structure (object OR array)
  const firstBrace   = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  const lastBrace    = text.lastIndexOf('}');
  const lastBracket  = text.lastIndexOf(']');

  let start, end, isArray;
  if (firstBracket >= 0 && (firstBrace < 0 || firstBracket < firstBrace)) {
    start   = firstBracket;
    end     = lastBracket;
    isArray = true;
  } else if (firstBrace >= 0) {
    start   = firstBrace;
    end     = lastBrace;
    isArray = false;
  } else {
    throw new ApiError('No JSON found in response', 'PARSE_ERROR');
  }

  if (end < 0 || end <= start) {
    throw new ApiError('Malformed JSON (incomplete)', 'PARSE_ERROR');
  }

  let candidate = text.slice(start, end + 1);

  // Strategy 4: try parsing directly
  try { return JSON.parse(candidate); } catch (_) {}

  // Strategy 5: Remove trailing commas (e.g. {"a":1,} or [1,2,])
  let cleaned = candidate.replace(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(cleaned); } catch (_) {}

  // Strategy 6: Escape literal newlines and tabs inside string values
  //  — AI often outputs raw newlines inside JSON strings which is invalid
  cleaned = cleaned.replace(/"((?:[^"\\]|\\.)*?)"/gs, (match, inner) => {
    const safe = inner
      .replace(/\\/g, '\\\\')    // double-escape backslashes first
      .replace(/"/g, '\\"')      // escape any remaining quotes
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
    return `"${safe}"`;
  });
  try { return JSON.parse(cleaned); } catch (_) {}

  // Strategy 7: Last resort — try to extract a simpler valid chunk
  // Progressively trim from the end until it parses
  for (let trim = 50; trim < candidate.length / 2; trim += 50) {
    const shorter = candidate.slice(0, -trim);
    const lastClose = Math.max(shorter.lastIndexOf('}'), shorter.lastIndexOf(']'));
    if (lastClose < 0) continue;
    const shortened = shorter.slice(0, lastClose + 1).replace(/,(\s*[}\]])/g, '$1');
    try { return JSON.parse(shortened); } catch (_) {}
  }

  throw new ApiError('JSON parse failed after multiple strategies', 'PARSE_ERROR');
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

/**
 * Generate map artwork using Gemini's Nano Banana image generation.
 * Returns a data URL (data:image/png;base64,...) that can be used directly
 * as an SVG image href or background-image. Caller stores it in world state.
 *
 * Throws ApiError on missing key, network failure, or empty response.
 *
 * @param {string} prompt — the descriptive prompt for the map
 * @returns {Promise<string>} data URL of the generated PNG
 */
export async function generateMapArtwork(prompt) {
  const key = loadGeminiKey();
  if (!key) throw new ApiError('No Gemini API key set. Add it in the API Keys modal.', 'NO_GEMINI_KEY');

  const body = {
    contents: [{
      parts: [{ text: prompt }],
    }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  };

  const t0 = Date.now();
  let response;
  try {
    response = await fetch(GEMINI_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new ApiError(`Network error reaching Gemini: ${err.message}`, 'GEMINI_NETWORK');
  }
  apiMetrics.lastLatencyMs = Date.now() - t0;

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    const code    = response.status;
    let msg = `Gemini error ${code}`;
    if (code === 401 || code === 403) msg = 'Gemini API key rejected. Double-check the key.';
    else if (code === 429)            msg = 'Gemini rate limit hit. Wait and retry.';
    else if (code >= 500)             msg = `Gemini server error ${code}. Try again later.`;
    else                              msg = `${msg}: ${errText.slice(0, 100)}`;
    throw new ApiError(msg, 'GEMINI_HTTP_' + code);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    throw new ApiError('Gemini returned non-JSON response.', 'GEMINI_PARSE');
  }

  // The image comes back as inline_data inside the candidate's parts array
  const candidates = data.candidates || [];
  for (const candidate of candidates) {
    const parts = candidate?.content?.parts || [];
    for (const part of parts) {
      const inline = part.inline_data || part.inlineData;  // both spellings have appeared
      if (inline && inline.data) {
        const mimeType = inline.mime_type || inline.mimeType || 'image/png';
        return `data:${mimeType};base64,${inline.data}`;
      }
    }
  }

  // If we get here Gemini gave us text but no image — surface that text in the error
  const textBack = candidates[0]?.content?.parts?.[0]?.text || '';
  throw new ApiError(
    textBack
      ? `Gemini returned text instead of an image: ${textBack.slice(0, 120)}`
      : 'Gemini returned no image data.',
    'GEMINI_NO_IMAGE'
  );
}

export class ApiError extends Error {
  constructor(message, code = 'UNKNOWN') { super(message); this.name = 'ApiError'; this.code = code; }
}
