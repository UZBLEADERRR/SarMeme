import { withRetry } from './rate.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    url: string,
  ) {
    super(`HTTP ${status} — ${url}: ${body.slice(0, 300)}`);
    this.name = 'HttpError';
  }
}

/** Timeout va qayta urinish bilan JSON so'rov. */
export async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
  opts: { timeoutMs?: number; attempts?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 15_000;

  return withRetry(
    async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, { ...init, signal: ctrl.signal });
        const text = await res.text();
        if (!res.ok) throw new HttpError(res.status, text, url);
        return (text ? JSON.parse(text) : null) as T;
      } finally {
        clearTimeout(timer);
      }
    },
    { attempts: opts.attempts ?? 3, label: url },
  );
}
