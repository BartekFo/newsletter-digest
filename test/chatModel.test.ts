import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChatMessages,
  chatWithArticle,
  CHAT_MAX_CHARS,
  type OllamaChatClient,
} from '../src/chatModel.js';

test('buildChatMessages includes Polish system instructions, article text and question', () => {
  const messages = buildChatMessages({
    articleText: 'Tresc newslettera',
    question: 'Jakie sa glowne tezy?',
  });

  const systemMessage = messages[0];
  const questionMessage = messages.at(-1);
  assert.ok(systemMessage);
  assert.ok(questionMessage);
  assert.equal(systemMessage.role, 'system');
  assert.ok(systemMessage.content.includes('Odpowiadaj po polsku'));
  assert.ok(systemMessage.content.includes('wylacznie na podstawie'));
  assert.ok(questionMessage.content.includes('TEKST:\nTresc newslettera'));
  assert.ok(questionMessage.content.includes('PYTANIE:\nJakie sa glowne tezy?'));
});

test('buildChatMessages truncates long article text', () => {
  const longText = 'x'.repeat(CHAT_MAX_CHARS + 100);
  const messages = buildChatMessages({
    articleText: longText,
    question: 'Pytanie?',
  });

  const currentQuestion = messages.at(-1);
  assert.ok(currentQuestion);
  const userMessage = currentQuestion.content;
  assert.ok(userMessage.includes('x'.repeat(CHAT_MAX_CHARS)));
  assert.ok(!userMessage.includes('x'.repeat(CHAT_MAX_CHARS + 1)));
});

test('buildChatMessages includes optional history before the current question', () => {
  const messages = buildChatMessages({
    articleText: 'Tekst',
    question: 'Nowe pytanie?',
    history: [
      { role: 'user', content: 'Pierwsze pytanie' },
      { role: 'assistant', content: 'Pierwsza odpowiedz' },
    ],
  });

  assert.deepEqual(messages.map((message) => message.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(messages[1]?.content, 'Pierwsze pytanie');
  assert.equal(messages[2]?.content, 'Pierwsza odpowiedz');
});

test('chatWithArticle calls injected client and trims answer', async () => {
  let captured: Parameters<OllamaChatClient['chat']>[0] | undefined;
  const client: OllamaChatClient = {
    async chat(params) {
      captured = params;
      return { message: { content: '  Odpowiedz testowa.  ' } };
    },
  };

  const answer = await chatWithArticle({
    articleText: 'Tekst',
    question: 'Pytanie?',
    model: 'test-model',
    client,
  });

  assert.equal(answer, 'Odpowiedz testowa.');
  assert.ok(captured);
  assert.equal(captured.model, 'test-model');
  assert.ok(captured.options);
  assert.equal(captured.options.think, false);
  assert.equal(captured.messages.at(-1)?.role, 'user');
});
