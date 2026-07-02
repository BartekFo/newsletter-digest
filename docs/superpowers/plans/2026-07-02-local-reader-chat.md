# Plan: Lokalny Reader Digestow + Chat z Newsletterem

## Cel

Zamienic obecny jednorazowy `digest.html` w lokalna aplikacje readera uruchamiana jedna komenda.

Docelowo:

```bash
npm start
```

powinno:

1. uruchomic lokalny serwer,
2. pobrac nowe newslettery,
3. zapisac je do SQLite,
4. utworzyc nowy snapshot digestu, jesli sa nowe itemy,
5. otworzyc reader w przegladarce,
6. umozliwic przechodzenie miedzy historycznymi digestami,
7. umozliwic chat z kazdym newsletterem przez lokalny model Ollama.

## Obecny Stan

Projekt juz ma:

- ekstrakcje tekstu newslettera do `cleanText`,
- zapis itemow w SQLite,
- streszczenia przez lokalna Ollame,
- renderowanie statycznego HTML-a,
- tabele `runs`,
- model konfigurowany przez `ollamaModel`.

Obecny problem:

- `npm start` generuje statyczny `digest.html` i go otwiera,
- chat wymagalby dodatkowego serwera,
- kolejne uruchomienie moze nadpisac widok pustym digestem,
- nie ma sposobu zarzadzania historycznymi snapshotami.

## Rekomendowana Architektura

Glownym produktem powinna byc lokalna aplikacja readera pod `localhost`, nie samotny plik `file://`.

Statyczny HTML moze zostac jako opcjonalny eksport, ale codzienny flow powinien byc serwerowy.

## Docelowy UX

### Komenda glowna

```bash
npm start
```

Efekt:

- startuje lokalny serwer, np. `http://localhost:3789`,
- wykonywany jest fetch nowych newsletterow,
- jesli znaleziono nowe newslettery, tworzony jest nowy snapshot digestu,
- jesli nie znaleziono nowych newsletterow, pokazywany jest ostatni niepusty digest,
- przegladarka otwiera reader.

### Reader UI

Reader powinien miec:

- widok najnowszego niepustego digestu,
- liste historycznych digestow,
- mozliwosc wejscia w konkretny snapshot,
- przycisk `Pobierz nowe` / `Odswiez`,
- przycisk `Chat` przy kazdym newsletterze,
- modal albo panel czatu,
- obsluge bledow, np. gdy Ollama nie dziala.

### Przykladowe URL-e

```text
/
```

Ostatni niepusty digest.

```text
/runs
```

Lista snapshotow digestow.

```text
/runs/:id
```

Konkretny snapshot.

```text
/chat
```

Endpoint API do rozmowy z newsletterem.

Opcjonalnie pozniej:

```text
/items/:messageId
```

Widok pojedynczego newslettera.

## Model Danych

### Istniejaca tabela `items`

Zostaje jako zrodlo prawdy dla newsletterow.

Istotne pola:

```sql
message_id TEXT PRIMARY KEY
uid        INTEGER
sender     TEXT
subject    TEXT
date       TEXT
clean_text TEXT
summary    TEXT
link       TEXT
created_at TEXT
```

### Istniejaca tabela `runs`

Zostaje jako tabela przebiegow.

Obecnie zawiera m.in.:

```sql
id          INTEGER PRIMARY KEY AUTOINCREMENT
ran_at      TEXT
fetched     INTEGER
new_items   INTEGER
duration_ms INTEGER
ok          INTEGER
```

### Nowa tabela `run_items`

Dodac relacje snapshot -> item:

```sql
CREATE TABLE IF NOT EXISTS run_items (
  run_id     INTEGER NOT NULL,
  message_id TEXT NOT NULL,
  PRIMARY KEY (run_id, message_id),
  FOREIGN KEY (run_id) REFERENCES runs(id),
  FOREIGN KEY (message_id) REFERENCES items(message_id)
);
```

Sens:

- item istnieje raz w `items`,
- snapshot digestu zawiera liste itemow przez `run_items`,
- stare digesty nie znikaja po kolejnych uruchomieniach,
- run z `0` nowych itemow nie musi byc widoczny jako pusty digest.

## Zmiany W Store

W `src/store.ts` dodac funkcje:

```ts
getItemByMessageId(db, messageId): DigestItem | null
```

Do endpointu `/chat`.

```ts
recordRun(...): number
```

Zamiast `void`, powinno zwracac `runId`.

```ts
addRunItem(db, runId, messageId): void
```

Albo batch:

```ts
addRunItems(db, runId, messageIds): void
```

Do zapisania snapshotu.

```ts
getRunSummaries(db): RunSummary[]
```

Do listy digestow.

Przykladowy typ:

```ts
interface RunSummary {
  id: number;
  ranAt: string;
  newItems: number;
  itemCount: number;
}
```

```ts
getLatestNonEmptyRun(db): RunSummary | null
```

Dla `/`.

```ts
getItemsByRunId(db, runId): DigestItem[]
```

Dla `/runs/:id`.

## Zmiany W Orkiestracji Digestu

Obecne `runDigest()` powinno nadal pobierac nowe wiadomosci, parsowac, ekstrahowac i streszczac.

Zmiana:

- po utworzeniu runa zapisac relacje `run_items`,
- zwracac `runId`,
- nie traktowac `digest.html` jako jedynego rezultatu.

Proponowany result:

```ts
{
  fetched: number;
  newItems: number;
  runId: number | null;
}
```

Decyzja produktowa:

- jesli sa nowe itemy, tworzymy snapshot widoczny w historii,
- jesli nie ma nowych itemow, mozemy nadal zapisac techniczny run w `runs`, ale nie pokazywac go jako digest,
- `/` powinno pokazywac ostatni run z itemami.

## Lokalny Serwer

Dodac nowy entrypoint, np.:

```text
src/server.ts
```

Odpowiedzialnosci:

- ladowanie configu,
- otwieranie SQLite,
- inicjalizacja schematu,
- uruchomienie lokalnego HTTP servera,
- wykonanie fetchu przy starcie,
- otwarcie przegladarki,
- serwowanie widokow HTML,
- obsluga API chatu.

Mozna uzyc natywnego `node:http`, zeby nie dodawac frameworka.

Jesli kod zacznie puchnac, mozna pozniej rozwazyc Fastify, ale MVP nie wymaga dependency.

### Endpointy

#### `GET /`

Renderuje ostatni niepusty digest.

Jesli nie ma zadnych digestow:

- pokazuje pusty stan,
- daje przycisk `Pobierz nowe`.

#### `GET /runs`

Renderuje liste historycznych snapshotow.

#### `GET /runs/:id`

Renderuje konkretny snapshot.

#### `POST /refresh`

Uruchamia fetch nowych newsletterow.

Zachowanie:

- jesli sa nowe, tworzy nowy snapshot i przekierowuje do `/runs/:id`,
- jesli nie ma nowych, wraca do ostatniego niepustego digestu z komunikatem.

Na MVP moze byc klasyczny formularz POST bez SPA.

#### `POST /chat`

Payload:

```json
{
  "messageId": "...",
  "question": "Jakie sa glowne tezy?",
  "history": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

Response:

```json
{
  "answer": "..."
}
```

Walidacja:

- `messageId` wymagany,
- `question` wymagane,
- `history` opcjonalne,
- jesli item nie istnieje: `404`,
- jesli `cleanText` jest puste: sensowny blad,
- jesli Ollama nie odpowiada: `502` albo `500` z czytelnym komunikatem.

## Chat Model

Dodac plik:

```text
src/chatModel.ts
```

Interfejs:

```ts
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function chatWithArticle(params: {
  articleText: string;
  question: string;
  history?: ChatMessage[];
  model: string;
}): Promise<string>
```

Prompt systemowy:

```text
Jestes asystentem do rozmowy z trescia newslettera lub artykulu.
Odpowiadaj po polsku.
Odpowiadaj wylacznie na podstawie podanego tekstu.
Jesli tekst nie zawiera odpowiedzi, powiedz to jasno.
Nie zmyslaj i nie dopowiadaj faktow spoza tekstu.
```

Kontekst uzytkownika:

```text
TEKST:
...

PYTANIE:
...
```

Limity:

- nie wysylac calej nieskonczonej tresci,
- na MVP mozna uzyc limitu podobnego do `summarize.ts`, np. `12000` lub `16000` znakow,
- pozniej mozna dodac chunking/RAG.

Implementacja:

- uzyc obecnej biblioteki `ollama`,
- nie dodawac AI SDK na MVP,
- ukryc Ollame w funkcji/modulowym adapterze, zeby pozniejsza migracja byla latwa.

## Renderowanie HTML

Obecny `src/render.ts` mozna rozwinac albo podzielic.

Docelowo przyda sie:

```ts
renderDigestPage(items, meta)
renderRunsPage(runs, meta)
renderLayout(content, meta)
```

Na MVP mozna utrzymac jedna funkcje, ale warto unikac dalszego rozrastania jednego ogromnego template stringa.

### Digest Page

Kazdy item powinien miec:

- tytul,
- sender,
- date,
- link do Gmaila,
- link do artykulu, jesli istnieje,
- streszczenie,
- przycisk `Chat`.

Przycisk:

```html
<button type="button" class="chat-button" data-message-id="...">
  Chat
</button>
```

W HTML nie wkladac `cleanText`.

### Chat UI

MVP:

- jeden modal/panel wspoldzielony przez strone,
- po kliknieciu `Chat` panel dostaje `messageId`,
- wiadomosci trzymane w stanie JS w przegladarce,
- `fetch('/chat')`,
- prosty loading state,
- prosty error state.

Nie trzeba zapisywac historii rozmowy w SQLite na MVP.

## Package Scripts

Zmieniony docelowy uklad:

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/src/server.js",
    "digest:export": "node dist/src/digest.js",
    "test": "npm run build && node --test \"dist/test/*.test.js\""
  }
}
```

Znaczenie:

- `npm start` = lokalny reader z chatem,
- `npm run digest:export` = stary tryb generowania statycznego HTML-a, jesli chcemy go zachowac.

## Testy

### `store.test.ts`

Dodac testy dla:

- `getItemByMessageId`,
- `recordRun` zwraca ID,
- `addRunItems`,
- `getItemsByRunId`,
- `getLatestNonEmptyRun`,
- `getRunSummaries`.

### `chatModel.test.ts`

Testowac bez realnej Ollamy.

Najlepiej wstrzyknac klienta albo wydzielic budowanie messages.

Testy:

- prompt zawiera instrukcje po polsku,
- prompt zawiera tekst artykulu,
- prompt zawiera pytanie,
- za dlugi tekst jest ucinany,
- historia jest dolaczana,
- pusta historia nie psuje payloadu.

### `render.test.ts`

Testy:

- render zawiera przycisk `Chat`,
- render zawiera `data-message-id`,
- render nie zawiera `cleanText`,
- render listy runow zawiera linki do `/runs/:id`,
- pusty stan nie crashuje.

### `server.test.ts`

Jesli nie bedzie zbyt kosztowne:

- `POST /chat` bez `messageId` -> `400`,
- `POST /chat` bez `question` -> `400`,
- nieistniejacy item -> `404`,
- poprawny request -> `200` i JSON z `answer`,
- `GET /` bez runow pokazuje pusty stan,
- `GET /runs/:id` dla nieistniejacego runa -> `404`.

## Kolejnosc Implementacji

1. Rozszerzyc schemat bazy o `run_items`.
2. Dodac funkcje store dla runow i itemow.
3. Zmienic `recordRun`, zeby zwracalo `runId`.
4. Zmienic `runDigest()`, zeby zapisywal relacje `run_items`.
5. Dodac `chatModel.ts`.
6. Dodac lokalny `server.ts`.
7. Przeniesc `npm start` na server.
8. Zostawic stary flow jako `npm run digest:export`.
9. Rozwinac renderowanie o:
   - liste runow,
   - nawigacje miedzy snapshotami,
   - przyciski chat,
   - modal/panel chatu.
10. Dodac testy.
11. Recznie sprawdzic flow z dzialajaca Ollama.

## Wazne Decyzje

### Czy chat jest z newsletterem czy pelnym artykulem?

MVP: chat z `cleanText`, czyli trescia wyciagnieta z newslettera.

Nie nazywac tego zbyt szeroko "chat z artykulem", jesli nie pobieramy pelnej strony spod linka.

Lepsze copy:

```text
Zapytaj o ten newsletter
```

albo:

```text
Chat
```

Pozniejszy etap:

- pobierac pelny artykul z `link`,
- zapisywac `article_text`,
- pozwolic chatowac z pelnym tekstem artykulu.

### Czy zapisywac historie rozmowy?

MVP: nie.

Historia moze zyc w stanie frontendowym podczas otwartej strony.

Pozniej mozna dodac:

```sql
chat_sessions
chat_messages
```

### Czy uzywac AI SDK?

MVP: nie.

Uzyc obecnej biblioteki `ollama`, bo projekt juz jej uzywa i przypadek uzycia jest prosty.

Zaprojektowac modul tak, zeby pozniej mozna bylo dodac adapter AI SDK.

## Etap 2

Po MVP mozna dodac:

- streaming odpowiedzi token po tokenie,
- zapisywanie historii rozmow,
- pelne pobieranie artykulu z URL-a,
- `article_text` w bazie,
- chunking/RAG dla dlugich tekstow,
- wyszukiwanie po archiwum newsletterow,
- tagowanie tematow,
- adapter AI SDK dla wielu providerow.
