import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarize,
  buildPrompt,
  MAX_CHARS,
  INSTRUCTION,
  type SummaryClient,
  type SummaryRequest,
} from '../src/summarize.js';

// ---------------------------------------------------------------------------
// Unit tests for buildPrompt (no network)
// ---------------------------------------------------------------------------

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
  // Prompt = instruction + exactly MAX_CHARS of capped text
  assert.equal(
    prompt.length,
    INSTRUCTION.length + MAX_CHARS,
    `Prompt must be instruction (${INSTRUCTION.length}) + capped text (${MAX_CHARS})`,
  );
  // And the over-cap input is genuinely shortened
  assert.ok(
    prompt.length < INSTRUCTION.length + longText.length,
    'Prompt must be shorter than instruction + untruncated input',
  );
});

test('summarize: uses an injected model client and trims its answer', async () => {
  let request: SummaryRequest | undefined;
  const client: SummaryClient = {
    async chat(params) {
      request = params;
      return { message: { content: '  Gotowe podsumowanie.  ' } };
    },
  };

  const summary = await summarize('Treść newslettera', 'test-model', client);

  assert.equal(summary, 'Gotowe podsumowanie.');
  assert.ok(request);
  assert.equal(request.model, 'test-model');
  assert.deepEqual(request.messages, [
    { role: 'user', content: `${INSTRUCTION}Treść newslettera` },
  ]);
  assert.deepEqual(request.options, { think: false });
});
