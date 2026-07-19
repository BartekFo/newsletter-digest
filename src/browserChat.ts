export interface BrowserChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface BrowserChatRequest {
  newsletterId: string;
  question: string;
  history: BrowserChatMessage[];
}

export interface BrowserChatView {
  reset(subject: string): void;
  addMessage(role: 'user' | 'assistant' | 'loading' | 'error', content: string): { remove(): void };
  setSending(sending: boolean): void;
  clearQuestion(): void;
  focusQuestion(): void;
}

export interface BrowserChatRuntime {
  createAbortController(): AbortController;
  setTimeout(callback: () => void, timeoutMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(timeout: ReturnType<typeof setTimeout>): void;
}

export interface BrowserChatSession {
  open(newsletterId: string, subject: string): boolean;
  submit(question: string): Promise<boolean>;
}

export function createBrowserChatSession(options: {
  view: BrowserChatView;
  send(request: BrowserChatRequest, signal: AbortSignal): Promise<string>;
  timeoutMs: number;
  runtime?: BrowserChatRuntime;
}): BrowserChatSession {
  const runtime = options.runtime ?? {
    createAbortController: () => new AbortController(),
    setTimeout: (callback, timeoutMs) => setTimeout(callback, timeoutMs),
    clearTimeout: (timeout) => clearTimeout(timeout),
  };
  let newsletterId: string | null = null;
  let history: BrowserChatMessage[] = [];
  let sending = false;

  return {
    open(nextNewsletterId, subject) {
      if (sending) return false;
      newsletterId = nextNewsletterId;
      history = [];
      options.view.reset(subject || 'Chat');
      options.view.setSending(false);
      options.view.focusQuestion();
      return true;
    },

    async submit(question) {
      const text = question.trim();
      if (!text || !newsletterId || sending) return false;

      const currentNewsletterId = newsletterId;
      const requestHistory = [...history];
      options.view.clearQuestion();
      options.view.addMessage('user', text);
      sending = true;
      options.view.setSending(true);
      const loading = options.view.addMessage('loading', 'Czekam na odpowiedź modelu… To może potrwać kilka minut.');
      const controller = runtime.createAbortController();
      const timeout = runtime.setTimeout(() => controller.abort(), options.timeoutMs);

      try {
        const answer = await options.send({
          newsletterId: currentNewsletterId,
          question: text,
          history: requestHistory,
        }, controller.signal);
        loading.remove();
        options.view.addMessage('assistant', answer);
        history.push(
          { role: 'user', content: text },
          { role: 'assistant', content: answer },
        );
      } catch (error) {
        loading.remove();
        const message = error instanceof Error && error.name === 'AbortError'
          ? 'Odpowiedź trwa zbyt długo. Sprawdź, czy Ollama działa i model jest gotowy.'
          : error instanceof Error ? error.message : String(error);
        options.view.addMessage('error', message);
      } finally {
        runtime.clearTimeout(timeout);
        sending = false;
        options.view.setSending(false);
        options.view.focusQuestion();
      }

      return true;
    },
  };
}

/** Inline browser adapter; the state machine is the same function exercised by unit tests. */
export function renderBrowserChatScript(): string {
  return `<script>
(() => {
  const createSession = ${createBrowserChatSession.toString()};
  const panel = document.getElementById('chat-panel');
  const title = document.getElementById('chat-title');
  const log = document.getElementById('chat-log');
  const form = document.getElementById('chat-form');
  const question = document.getElementById('chat-question');
  const close = document.querySelector('.chat-close');
  const sendButton = form.querySelector('button[type="submit"]');

  const view = {
    reset(subject) {
      log.textContent = '';
      title.textContent = subject;
      panel.hidden = false;
    },
    addMessage(role, content) {
      const element = document.createElement('div');
      element.className = 'chat-message ' + role;
      element.textContent = content;
      log.appendChild(element);
      log.scrollTop = log.scrollHeight;
      return { remove: () => element.remove() };
    },
    setSending(sending) {
      question.disabled = sending;
      sendButton.disabled = sending;
      sendButton.textContent = sending ? 'Czekam…' : 'Wyślij';
    },
    clearQuestion() { question.value = ''; },
    focusQuestion() { question.focus(); },
  };

  const session = createSession({
    view,
    timeoutMs: 305_000,
    async send(request, signal) {
      const response = await fetch('/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
        signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Chat nie odpowiedział.');
      return data.answer;
    },
  });

  document.querySelectorAll('.chat-button').forEach((button) => {
    button.addEventListener('click', () => {
      session.open(button.dataset.newsletterId, button.dataset.subject || 'Chat');
    });
  });
  close.addEventListener('click', () => { panel.hidden = true; });
  panel.addEventListener('click', (event) => {
    if (event.target === panel) panel.hidden = true;
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void session.submit(question.value);
  });
})();
</script>`;
}
