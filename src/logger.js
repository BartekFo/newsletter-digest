import pino from 'pino';
import pretty from 'pino-pretty';

/**
 * Build a human-readable logger for interactive CLI runs.
 *
 * pino-pretty is wired as a synchronous destination (not a worker-thread
 * transport) so every line is flushed before this short-lived process exits —
 * a transport worker can drop buffered logs on a fast exit.
 *
 * @param {string} [level='info'] - pino level; use 'silent' in tests
 * @returns {import('pino').Logger}
 */
export function createLogger(level = process.env.LOG_LEVEL ?? 'info') {
  if (level === 'silent') {
    return pino({ level });
  }

  return pino(
    { level },
    pretty({
      colorize: true,
      translateTime: 'HH:MM:ss',
      ignore: 'pid,hostname',
    }),
  );
}

/** Silent logger — default for callers (e.g. tests) that inject no logger. */
export const silentLogger = pino({ level: 'silent' });
