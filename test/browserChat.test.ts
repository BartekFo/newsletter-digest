import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createBrowserChatSession,
  type BrowserChatMessage,
  type BrowserChatRequest,
  type BrowserChatRuntime,
  type BrowserChatView,
} from '../src/browserChat.js';

interface ViewEvent {
  type: string;
  value?: string | boolean;
}

function createView(): BrowserChatView & { events: ViewEvent[] } {
  const events: ViewEvent[] = [];
  return {
    events,
    reset: (subject) => events.push({ type: 'reset', value: subject }),
    addMessage: (role, content) => {
      const event = { type: role, value: content };
      events.push(event);
      return { remove: () => events.push({ type: 'remove', value: role }) };
    },
    setSending: (sending) => events.push({ type: 'sending', value: sending }),
    clearQuestion: () => events.push({ type: 'clear' }),
    focusQuestion: () => events.push({ type: 'focus' }),
  };
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

test('first send shows waiting state and blocks a duplicate', async () => {
  const view = createView();
  const answer = deferred<string>();
  let calls = 0;
  const chat = createBrowserChatSession({
    view,
    timeoutMs: 1_000,
    send: async () => { calls++; return answer.promise; },
  });

  chat.open('newsletter-1', 'Newsletter one');
  const first = chat.submit('Pierwsze pytanie');
  const duplicate = await chat.submit('Duplikat');

  assert.equal(duplicate, false);
  assert.equal(calls, 1);
  assert.ok(view.events.some((event) => event.type === 'sending' && event.value === true));
  assert.ok(view.events.some((event) => event.type === 'loading'));

  answer.resolve('Odpowiedź');
  await first;
});

test('success appends the answer and sends history with the next question', async () => {
  const view = createView();
  const requests: BrowserChatRequest[] = [];
  const answers = ['Pierwsza odpowiedź', 'Druga odpowiedź'];
  const chat = createBrowserChatSession({
    view,
    timeoutMs: 1_000,
    send: async (request) => {
      requests.push(request);
      return answers[requests.length - 1] ?? 'Brak';
    },
  });

  chat.open('newsletter-1', 'Newsletter one');
  await chat.submit('Pierwsze pytanie');
  await chat.submit('Drugie pytanie');

  assert.ok(view.events.some((event) => event.type === 'assistant' && event.value === 'Pierwsza odpowiedź'));
  assert.deepEqual(requests[1]?.history, [
    { role: 'user', content: 'Pierwsze pytanie' },
    { role: 'assistant', content: 'Pierwsza odpowiedź' },
  ] satisfies BrowserChatMessage[]);
});

test('timeout shows a readable error and unlocks the form', async () => {
  const view = createView();
  let timeoutCallback: (() => void) | undefined;
  const runtime: BrowserChatRuntime = {
    createAbortController: () => new AbortController(),
    setTimeout: (callback) => {
      timeoutCallback = callback;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: () => undefined,
  };
  const chat = createBrowserChatSession({
    view,
    timeoutMs: 10,
    runtime,
    send: async (_request, signal) => new Promise<string>((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });

  chat.open('newsletter-1', 'Newsletter one');
  const pending = chat.submit('Czy odpowiesz?');
  assert.ok(timeoutCallback);
  timeoutCallback();
  await pending;

  assert.ok(view.events.some((event) => event.type === 'error' && String(event.value).includes('Odpowiedź trwa zbyt długo')));
  assert.deepEqual(view.events.filter((event) => event.type === 'sending').at(-1), { type: 'sending', value: false });
});

test('server error is visible and unlocks the form', async () => {
  const view = createView();
  const chat = createBrowserChatSession({
    view,
    timeoutMs: 1_000,
    send: async () => { throw new Error('Serwer jest niedostępny'); },
  });

  chat.open('newsletter-1', 'Newsletter one');
  await chat.submit('Pytanie');

  assert.ok(view.events.some((event) => event.type === 'error' && event.value === 'Serwer jest niedostępny'));
  assert.deepEqual(view.events.filter((event) => event.type === 'sending').at(-1), { type: 'sending', value: false });
});
