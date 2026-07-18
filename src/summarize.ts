import ollama from 'ollama';

export const MAX_CHARS = 12000;
export const INSTRUCTION =
  'Streść poniższy newsletter po polsku w 2-3 zdaniach: co jest w środku i czy warto to czytać. Bez wstępu, sam konkret.\n\n';

export interface SummaryRequest {
  model: string;
  messages: Array<{ role: 'user'; content: string }>;
  options: Record<string, unknown>;
}

export interface SummaryClient {
  chat(params: SummaryRequest): Promise<{ message: { content: string } }>;
}

/**
 * Build the prompt string for summarization.
 * Applies the MAX_CHARS cap before concatenating with the instruction.
 * @param {string} text
 * @returns {string}
 */
export function buildPrompt(text: string): string {
  const truncated = text.slice(0, MAX_CHARS);
  return INSTRUCTION + truncated;
}

/**
 * Summarize newsletter text using a local Ollama model.
 * Returns a 2–3 sentence Polish summary.
 * @param {string} text
 * @param {string} [model='gemma4:12b']
 * @param {SummaryClient} [client] - injectable model client for deterministic tests
 * @returns {Promise<string>}
 */
export async function summarize(
  text: string,
  model = 'gemma4:12b',
  client: SummaryClient = ollama,
): Promise<string> {
  const prompt = buildPrompt(text);

  const response = await client.chat({
    model,
    messages: [{ role: 'user', content: prompt }],
    options: { think: false },
  });

  return response.message.content.trim();
}
