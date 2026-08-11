/** Minimal strukturaviy logger — Railway loglarida o'qish uchun qulay. */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

function currentLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? 'info').toLowerCase();
  return LEVELS[raw as Level] ?? LEVELS.info;
}

function emit(level: Level, scope: string, msg: string, data?: unknown): void {
  if (LEVELS[level] < currentLevel()) return;
  const ts = new Date().toISOString();
  const head = `${ts} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  if (data === undefined) {
    console.log(head);
  } else {
    console.log(head, typeof data === 'string' ? data : JSON.stringify(data));
  }
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, data?: unknown) => emit('debug', scope, msg, data),
    info: (msg: string, data?: unknown) => emit('info', scope, msg, data),
    warn: (msg: string, data?: unknown) => emit('warn', scope, msg, data),
    error: (msg: string, data?: unknown) => emit('error', scope, msg, data),
  };
}

export type Logger = ReturnType<typeof createLogger>;
