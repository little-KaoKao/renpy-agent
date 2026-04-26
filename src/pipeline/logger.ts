// File-backed structured logger.
//
// `runtime/games/<story>/logs/<ISO-timestamp>.jsonl` — one JSON event per line.
// Every event is `{ ts, type, ... }`. Known `type`s: stage_start / stage_end /
// llm_call / tool_use / tool_result / error, plus info / warn for free-text
// sugar from legacy callers that only produce strings.
//
// The logger is dual-interface on purpose so one instance satisfies both:
//   - v0.2 pipeline's PipelineLogger (info / error taking a string)
//   - v0.6 V5 CommonToolLogger (info / warn / error with optional meta)
// Callers that have structured payloads should prefer `emit(event)` directly.
//
// Writes are serialized through an internal queue so parallel `.info()` calls
// can't interleave JSON lines. Write failures degrade to `console.error` and
// never throw back into the caller — logging must not crash a pipeline.

import { mkdir, appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export type LogEventType =
  | 'stage_start'
  | 'stage_end'
  | 'llm_call'
  | 'tool_use'
  | 'tool_result'
  | 'error'
  | 'info'
  | 'warn';

export interface LogEvent {
  readonly type: LogEventType;
  readonly stage?: string;
  readonly message?: string;
  readonly data?: unknown;
}

export interface FileLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  emit(event: LogEvent): void;
  /** Wait for every queued line to land on disk. */
  flush(): Promise<void>;
  /** Absolute path of the .jsonl file this logger is appending to. */
  readonly filePath: string;
}

export interface CreateFileLoggerOptions {
  /** Also mirror to console (info→log, warn→warn, error→error). Defaults to true. */
  readonly alsoConsole?: boolean;
  /** Override the timestamp used in the filename (tests only). */
  readonly now?: Date;
}

function isoTimestampForFilename(d: Date): string {
  return d.toISOString().replace(/[:.]/g, '-');
}

function safeStringify(event: Record<string, unknown>): string {
  try {
    return JSON.stringify(event);
  } catch {
    // Circular refs / BigInt: fall back to a best-effort representation.
    return JSON.stringify({
      ts: event.ts,
      type: event.type,
      message: String(event.message ?? ''),
      _stringifyError: true,
    });
  }
}

/**
 * Create a logger that appends JSONL events to
 * `<logDir>/<ISO-timestamp>.jsonl`. The directory is created on first write;
 * callers don't need to pre-create it. Safe to call from async contexts — all
 * writes go through an internal promise queue.
 */
export function createFileLogger(
  logDir: string,
  options: CreateFileLoggerOptions = {},
): FileLogger {
  const alsoConsole = options.alsoConsole ?? true;
  const stamp = isoTimestampForFilename(options.now ?? new Date());
  const filePath = resolve(logDir, `${stamp}.jsonl`);

  let queue: Promise<void> = mkdir(logDir, { recursive: true }).then(
    () => undefined,
    (err) => {
      console.error(`[logger] failed to create logDir ${logDir}: ${String((err as Error).message)}`);
    },
  );

  const enqueue = (record: Record<string, unknown>): void => {
    const line = safeStringify(record) + '\n';
    queue = queue.then(() =>
      appendFile(filePath, line, 'utf8').catch((err: Error) => {
        // Don't swallow silently: the whole point of file logs is to survive
        // terminal scrollback loss, so if we can't write, at least tell the
        // operator so they know logs are incomplete.
        console.error(`[logger] append failed (${filePath}): ${String(err.message)}`);
      }),
    );
  };

  const mirror = (level: 'info' | 'warn' | 'error', message: string): void => {
    if (!alsoConsole) return;
    if (level === 'error') console.error(message);
    else if (level === 'warn') console.warn(message);
    else console.log(message);
  };

  const recordFor = (event: LogEvent): Record<string, unknown> => {
    const out: Record<string, unknown> = { ts: new Date().toISOString(), type: event.type };
    if (event.stage !== undefined) out.stage = event.stage;
    if (event.message !== undefined) out.message = event.message;
    if (event.data !== undefined) out.data = event.data;
    return out;
  };

  return {
    filePath,
    info(message, meta) {
      mirror('info', message);
      const ev: LogEvent = meta === undefined
        ? { type: 'info', message }
        : { type: 'info', message, data: meta };
      enqueue(recordFor(ev));
    },
    warn(message, meta) {
      mirror('warn', message);
      const ev: LogEvent = meta === undefined
        ? { type: 'warn', message }
        : { type: 'warn', message, data: meta };
      enqueue(recordFor(ev));
    },
    error(message, meta) {
      mirror('error', message);
      const ev: LogEvent = meta === undefined
        ? { type: 'error', message }
        : { type: 'error', message, data: meta };
      enqueue(recordFor(ev));
    },
    emit(event) {
      if (alsoConsole && event.message) {
        const level: 'info' | 'warn' | 'error' =
          event.type === 'error' ? 'error' : event.type === 'warn' ? 'warn' : 'info';
        mirror(level, event.message);
      }
      enqueue(recordFor(event));
    },
    async flush() {
      await queue;
    },
  };
}

/**
 * Default log directory for a given gameDir (`<gameRoot>/game`). Mirrors the
 * `workspace/` sibling layout: `<gameRoot>/logs/`.
 */
export function logsDirForGame(gameDir: string): string {
  return resolve(gameDir, '..', 'logs');
}