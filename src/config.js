import 'dotenv/config';

/**
 * Build a validated config object from the given environment.
 * Throws a clear error if any required variable is missing.
 *
 * @param {NodeJS.ProcessEnv} env - environment variables to read from
 * @returns {{ gmailUser: string, gmailAppPassword: string, imapFolder: string,
 *             bootstrapDays: number, ollamaModel: string, dbPath: string, outPath: string }}
 */
export function loadConfig(env = process.env) {
  if (!env.GMAIL_USER) {
    throw new Error('Missing required environment variable: GMAIL_USER');
  }
  if (!env.GMAIL_APP_PASSWORD) {
    throw new Error('Missing required environment variable: GMAIL_APP_PASSWORD');
  }

  return {
    gmailUser: env.GMAIL_USER,
    gmailAppPassword: env.GMAIL_APP_PASSWORD,
    imapFolder: env.IMAP_FOLDER ?? 'Newsletters',
    bootstrapDays: env.BOOTSTRAP_DAYS ? Number(env.BOOTSTRAP_DAYS) : 7,
    ollamaModel: env.OLLAMA_MODEL ?? 'qwen3.6:35b-a3b',
    dbPath: env.DB_PATH ?? './digest.db',
    outPath: env.OUT_PATH ?? './digest.html',
  };
}

// Default export: config loaded from the actual process environment.
// Other modules should import this; tests should use loadConfig() directly.
export default loadConfig;
