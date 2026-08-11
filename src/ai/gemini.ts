import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { HttpError } from '../util/http.js';
import { sleep } from '../util/rate.js';

const log = createLogger('gemini');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini `responseSchema` uchun OpenAPI kichik to'plami. */
export interface GeminiSchema {
  type: 'OBJECT' | 'ARRAY' | 'STRING' | 'NUMBER' | 'INTEGER' | 'BOOLEAN';
  description?: string;
  properties?: Record<string, GeminiSchema>;
  required?: string[];
  items?: GeminiSchema;
  enum?: string[];
  propertyOrdering?: string[];
}

interface GenerateResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
}

export interface GenerateOptions {
  model: string;
  system: string;
  prompt: string;
  schema: GeminiSchema;
  temperature?: number;
  maxOutputTokens?: number;
}

/**
 * Strukturaviy JSON javob oladi.
 *
 * `responseMimeType: application/json` + `responseSchema` birgalikda javob
 * sxemaga mos bo'lishini kafolatlaydi — parse qilish uchun retry loop kerak emas.
 *
 * Bepul tarifda 429 (rate limit) normal hodisa: uzunroq kutib qayta urinamiz.
 */
export async function generateJson<T>(opts: GenerateOptions): Promise<T> {
  const url = `${BASE}/models/${opts.model}:generateContent`;
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: opts.schema,
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 8192,
    },
  });

  const maxAttempts = 4;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': config.gemini.apiKey,
        },
        body,
        signal: AbortSignal.timeout(90_000),
      });

      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, text, url);

      const parsed = JSON.parse(text) as GenerateResponse;

      if (parsed.promptFeedback?.blockReason) {
        throw new Error(`So'rov bloklandi: ${parsed.promptFeedback.blockReason}`);
      }

      const out = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!out) {
        throw new Error(
          `Bo'sh javob (finishReason=${parsed.candidates?.[0]?.finishReason ?? 'noma\'lum'})`,
        );
      }

      log.debug('javob olindi', {
        model: opts.model,
        tokens: parsed.usageMetadata?.totalTokenCount,
      });

      return JSON.parse(out) as T;
    } catch (err) {
      lastErr = err;

      // 429 = kunlik/daqiqalik limit. 5xx = vaqtinchalik.
      const status = err instanceof HttpError ? err.status : 0;
      const retryable = status === 429 || status >= 500 || status === 0;
      if (!retryable || attempt === maxAttempts - 1) break;

      // Rate limit uchun ancha uzoq kutamiz — bepul tarifda daqiqalik oyna.
      const waitMs = status === 429 ? 20_000 * (attempt + 1) : 1500 * 2 ** attempt;
      log.warn('qayta urinish', { attempt: attempt + 1, waitMs, status });
      await sleep(waitMs);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
