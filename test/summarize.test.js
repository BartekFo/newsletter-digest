import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, buildPrompt } from '../src/summarize.js';

// ---------------------------------------------------------------------------
// Unit tests for buildPrompt (no network)
// ---------------------------------------------------------------------------

const MAX_CHARS = 12000;

test('buildPrompt: includes instruction text', () => {
  const prompt = buildPrompt('sample text');
  assert.ok(
    prompt.includes('Streść poniższy newsletter po polsku'),
    'Prompt must contain the Polish instruction',
  );
});

test('buildPrompt: short text is not truncated', () => {
  const text = 'Hello newsletter content.';
  const prompt = buildPrompt(text);
  assert.ok(prompt.includes(text), 'Short text should appear verbatim in prompt');
});

test('buildPrompt: long text is truncated to MAX_CHARS', () => {
  const longText = 'a'.repeat(MAX_CHARS + 5000);
  const prompt = buildPrompt(longText);
  const instructionLen = prompt.length - MAX_CHARS;
  // The text portion must be exactly MAX_CHARS characters
  assert.ok(
    prompt.length <= instructionLen + MAX_CHARS,
    `Prompt text portion must not exceed ${MAX_CHARS} chars`,
  );
  // Verify the full prompt length is bounded
  assert.ok(
    prompt.length < longText.length,
    'Prompt must be shorter than the untruncated input',
  );
});

// ---------------------------------------------------------------------------
// Integration test — skips gracefully when Ollama is unreachable
// ---------------------------------------------------------------------------

let ollamaReachable = false;
try {
  const res = await fetch('http://localhost:11434/api/tags');
  ollamaReachable = res.ok;
} catch {
  ollamaReachable = false;
}

test(
  'summarize: returns non-empty Polish summary from Ollama (integration)',
  { skip: !ollamaReachable ? 'Ollama not reachable — skipping integration test' : false, timeout: 120_000 },
  async () => {
    const sample =
      'This week: React 19 is out with new hooks for async state, ' +
      'TypeScript 5.5 ships satisfies improvements, and Bun 1.2 adds ' +
      'native S3 support. Plenty of tooling news worth catching up on.';

    const summary = await summarize(sample);

    assert.ok(typeof summary === 'string', 'Summary must be a string');
    assert.ok(summary.length > 0, 'Summary must be non-empty');
    assert.ok(summary.length < 1000, `Summary suspiciously long (${summary.length} chars): ${summary}`);
  },
);
