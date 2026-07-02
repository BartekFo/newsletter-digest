import ollama from 'ollama';

export const CHAT_MAX_CHARS = 16000;
export const CHAT_SYSTEM_PROMPT =
  'Jestes asystentem do rozmowy z trescia newslettera lub artykulu.\n' +
  'Odpowiadaj po polsku.\n' +
  'Odpowiadaj wylacznie na podstawie podanego tekstu.\n' +
  'Jesli tekst nie zawiera odpowiedzi, powiedz to jasno.\n' +
  'Nie zmyslaj i nie dopowiadaj faktow spoza tekstu.';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatClient {
  chat(params: {
    model: string;
    messages: OllamaChatMessage[];
    options?: Record<string, unknown>;
  }): Promise<{ message: { content: string } }>;
}

export function buildChatMessages(params: {
  articleText: string;
  question: string;
  history?: ChatMessage[];
}): OllamaChatMessage[] {
  const history = params.history ?? [];
  const articleText = params.articleText.slice(0, CHAT_MAX_CHARS);

  return [
    { role: 'system', content: CHAT_SYSTEM_PROMPT },
    ...history.map((message) => ({ role: message.role, content: message.content })),
    {
      role: 'user',
      content: `TEKST:\n${articleText}\n\nPYTANIE:\n${params.question}`,
    },
  ];
}

export async function chatWithArticle(params: {
  articleText: string;
  question: string;
  history?: ChatMessage[];
  model: string;
  client?: OllamaChatClient;
}): Promise<string> {
  const client = params.client ?? ollama;
  const response = await client.chat({
    model: params.model,
    messages: buildChatMessages(params),
    options: { think: false },
  });

  return response.message.content.trim();
}
