/**
 * Oddiy token-bucket cheklagich.
 * Bepul RPC/API tariflarini oshirib yubormaslik uchun ishlatiladi.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill = Date.now();

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst = Math.max(1, Math.ceil(ratePerSecond)),
  ) {
    this.tokens = this.burst;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.burst, this.tokens + elapsed * this.ratePerSecond);
    this.lastRefill = now;
  }

  /** Ruxsat kelguncha kutadi. */
  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const deficit = 1 - this.tokens;
      await sleep(Math.max(20, Math.ceil((deficit / this.ratePerSecond) * 1000)));
    }
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Ketma-ket urinishlar orasida eksponensial kutish bilan qayta chaqirish. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseMs = opts.baseMs ?? 500;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      await sleep(baseMs * 2 ** i + Math.random() * 200);
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`${opts.label ?? 'operatsiya'} muvaffaqiyatsiz: ${String(lastErr)}`);
}

/** Massivni bo'laklarga bo'ladi. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
