import { test } from 'node:test';
import assert from 'node:assert/strict';

import { summarize } from '../../src/summarize.js';
import { isReachable } from './support.js';

const ollamaReachable = await isReachable('http://localhost:11434/api/tags', 2000);

test(
  'Ollama summarizes newsletter text',
  {
    skip: ollamaReachable ? false : 'Ollama not reachable — skipping smoke test',
    timeout: 120_000,
  },
  async (t) => {
    const sample =
      'This week: React 19 is out with new hooks for async state, ' +
      'TypeScript 5.5 ships satisfies improvements, and Bun 1.2 adds ' +
      'native S3 support. Plenty of tooling news worth catching up on.';

    let summary: string;
    try {
      summary = await summarize(sample, 'gemma4:12b');
    } catch (err) {
      if (err instanceof Error && err.message.includes('not found')) {
        t.skip(`Ollama model not installed: ${err.message}`);
        return;
      }
      throw err;
    }

    assert.ok(summary.length > 0, 'Summary must be non-empty');
    assert.ok(summary.length < 1000, `Summary suspiciously long (${summary.length} chars)`);
  },
);
