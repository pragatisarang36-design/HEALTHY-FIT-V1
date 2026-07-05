import { supabase } from '@/lib/supabaseClient';

const BACKEND_API_URL = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:4000';
const DEFAULT_MODEL = 'llama-3.3-70b-versatile';
const DEFAULT_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const DEBOUNCE_MS = 400;
const RATE_LIMIT_COOLDOWN_MS = 6000;
const MAX_RETRIES = 2;

export const AI_FALLBACK_MESSAGE = "I'm having trouble reaching the AI service right now. Please try again in a moment.";

let requestLock = Promise.resolve();
let lastRequestAt = 0;
let cooldownUntil = 0;
const inFlightRequests = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getSessionToken = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || '';
};

const normalizeError = (error) => {
  if (error?.status === 429 || error?.code === 'rate_limit') {
    return { code: 'rate_limit', message: AI_FALLBACK_MESSAGE };
  }

  return {
    code: error?.code || 'ai_error',
    message: error?.message || AI_FALLBACK_MESSAGE,
  };
};

const parseErrorResponse = async (response) => {
  try {
    const data = await response.json();
    if (typeof data?.error === 'object') {
      return data.error.message || response.statusText;
    }
    return data?.error || data?.message || response.statusText;
  } catch {
    return response.statusText;
  }
};

const getRetryAfterMs = (response) => {
  const retryAfter = response.headers.get('retry-after');
  const seconds = Number(retryAfter);
  return Number.isFinite(seconds) && seconds > 0
    ? seconds * 1000
    : RATE_LIMIT_COOLDOWN_MS;
};

const requestKey = (request) => JSON.stringify({
  messages: request.messages,
  responseFormat: request.responseFormat || null,
});

export const groqTextModel = () => import.meta.env.VITE_GROQ_TEXT_MODEL || DEFAULT_MODEL;
export const groqVisionModel = () => import.meta.env.VITE_GROQ_VISION_MODEL || DEFAULT_VISION_MODEL;

const runGroqRequest = async ({ messages, responseFormat, model = groqTextModel() }) => {
  const token = await getSessionToken();

  if (!token) {
    throw { code: 'unauthorized', message: 'You must be logged in to use AI features.' };
  }

  const response = await fetch(`${BACKEND_API_URL}/api/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model,
      messages,
      responseFormat,
    }),
  });

  if (response.status === 429) {
    cooldownUntil = Date.now() + getRetryAfterMs(response);
    throw { code: 'rate_limit', status: 429, message: AI_FALLBACK_MESSAGE };
  }

  if (!response.ok) {
    throw {
      code: 'api_error',
      status: response.status,
      message: await parseErrorResponse(response),
    };
  }

  const data = await response.json();
  return data?.text || data?.message || '';
};

const executeRequest = async (request) => {
  const now = Date.now();
  if (now < cooldownUntil) {
    throw { code: 'rate_limit', status: 429, message: AI_FALLBACK_MESSAGE };
  }

  const elapsed = now - lastRequestAt;
  if (elapsed < DEBOUNCE_MS) {
    await sleep(DEBOUNCE_MS - elapsed);
  }

  lastRequestAt = Date.now();
  return runGroqRequest(request);
};

const executeWithRetry = async (request) => {
  let attempt = 0;
  let lastError;

  while (attempt <= MAX_RETRIES) {
    try {
      return await executeRequest(request);
    } catch (error) {
      lastError = error;
      const retryable = error?.status === 429 || error?.status >= 500 || error?.code === 'rate_limit';
      if (!retryable || attempt === MAX_RETRIES) break;

      const delay = error?.status === 429
        ? Math.max(cooldownUntil - Date.now(), RATE_LIMIT_COOLDOWN_MS)
        : 800 * 2 ** attempt;
      await sleep(delay);
      attempt += 1;
    }
  }

  throw lastError;
};

const withSingleRequestLock = (task) => {
  const next = requestLock.then(task, task);
  requestLock = next.catch(() => {});
  return next;
};

export async function requestAIText(request) {
  const key = requestKey(request);
  if (inFlightRequests.has(key)) {
    return inFlightRequests.get(key);
  }

  const task = (async () => {
    try {
      const text = await withSingleRequestLock(() => executeWithRetry(request));
      return { ok: true, text, message: text };
    } catch (error) {
      const normalized = normalizeError(error);
      console.error('Groq AI request failed:', normalized);
      return { ok: false, text: AI_FALLBACK_MESSAGE, message: AI_FALLBACK_MESSAGE, error: normalized };
    }
  })();

  inFlightRequests.set(key, task);
  task.finally(() => inFlightRequests.delete(key));
  return task;
}

const parseJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON object found');
    return JSON.parse(match[0]);
  }
};

export async function requestAIJson(request) {
  const result = await requestAIText({
    ...request,
    responseFormat: { type: 'json_object' },
  });

  if (!result.ok) {
    return { ok: false, data: null, message: result.message, error: result.error };
  }

  try {
    return { ok: true, data: parseJson(result.text), message: result.message };
  } catch (error) {
    console.error('Groq AI JSON parse failed:', error);
    return { ok: false, data: null, message: AI_FALLBACK_MESSAGE, error: normalizeError(error) };
  }
}
