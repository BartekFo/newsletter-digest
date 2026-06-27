# Newsletter Digest v0 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ręcznie odpalany skrypt Node, który ściąga newslettery z foldera IMAP Gmaila, streszcza je lokalną Ollamą i renderuje `digest.html`.

**Architecture:** Czyste moduły o jednej odpowiedzialności (store / parse / extract / summarize / render / imap), spięte cienkim orkiestratorem `digest.js`. Buduje się fazami od modułów testowalnych offline do tych z I/O (Gmail, Ollama), na końcu end-to-end.

**Tech Stack:** Node v22, `imapflow`, `mailparser`, `@postlight/parser`, `ollama`, `better-sqlite3`, `dotenv`. Test runner: `node:test` (wbudowany) + `node:assert`.

## Global Constraints

- Node v22 (już zainstalowany: v22.22.1). Zero TypeScript w v0 — czysty ESM (`"type": "module"`).
- Brak frameworka UI, brak bundlera. Jeden proces.
- LLM: Ollama lokalnie, model `qwen3.6:35b-a3b`. Brak fallbacku do API w v0.
- Źródło: Gmail IMAP, App Password, folder `Newsletters` (label ustawiony w Gmailu przez usera).
- Output: jeden plik `digest.html`, inline CSS, zero zewnętrznych assetów.
- Sekrety wyłącznie z `.env` (gitignore) — nigdy hardcode, nigdy do gita.
- Język summary: polski. Dedup: po `message_id`. Kursor: IMAP UID high-water-mark, bootstrap 7 dni.
- Każda faza kończy się działającym, weryfikowalnym artefaktem i commitem.

---

## Mapa plików

```
package.json          -- ESM, deps, skrypty
.env.example          -- szablon zmiennych (commitowany)
.env                  -- realne sekrety (gitignore)
src/
  config.js           -- ładuje env, waliduje, eksportuje config
  store.js            -- better-sqlite3: schema, items/state/runs, dedup, kursor
  parse.js            -- mailparser → {message_id, sender, subject, date, html}
  extract.js          -- readability → clean_text z html
  summarize.js        -- Ollama call + prompt → summary
  render.js           -- items[] → string HTML
  imap.js             -- połączenie IMAP, fetch wg kursora
  digest.js           -- orkiestracja (entry point)
test/
  fixtures/           -- przykładowe .eml + .html newsletterów
  store.test.js
  parse.test.js
  extract.test.js
  render.test.js
  summarize.test.js   -- integracyjny (wymaga Ollamy)
```

Mapowanie faza → sekcja speca: Faza 0=Konfiguracja, 1=Model danych+Kursor+Odporność, 2=Pipeline kroki 3-4, 3=Pipeline krok 1-2 (IMAP), 4=Format summary, 5=Render, 6=Pipeline spięty + Odpalanie.

---

## Task 0 — Faza 0: Scaffold & config

**Cel fazy:** projekt instaluje się i ładuje konfigurację. Fundament pod resztę.

**Files:** Create `package.json`, `.env.example`, `.gitignore` (już jest), `src/config.js`.

**Interfaces — Produces:**
- `config` (default export obiekt): `{ gmailUser, gmailAppPassword, imapFolder, bootstrapDays, ollamaModel, dbPath, outPath }`.
- `config.js` rzuca czytelnym błędem gdy brak wymaganego sekretu.

**Tasks:**
- [ ] `npm init`, ustaw `"type": "module"`, dodaj skrypty `test`, `start`.
- [ ] `npm i imapflow mailparser @postlight/parser ollama better-sqlite3 dotenv`.
- [ ] Napisz `.env.example` z kluczami z sekcji Global Constraints (puste wartości).
- [ ] TDD `config.js`: test sprawdza, że brak `GMAIL_APP_PASSWORD` → throw; komplet env → poprawny obiekt z domyślnymi `bootstrapDays=7`, `imapFolder='Newsletters'`.

**Weryfikacja fazy:** `npm test` (test config zielony); `node -e "import('./src/config.js')"` z wypełnionym `.env` nie rzuca.
**Commit:** `chore: scaffold project + config loader`.

---

## Task 1 — Faza 1: Storage layer (`store.js`)

**Cel fazy:** w pełni testowalna warstwa SQLite. Zero sieci. Najmocniejszy fundament TDD.

**Files:** Create `src/store.js`, `test/store.test.js`.

**Interfaces — Produces:**
- `openDb(path)` → `db`
- `initSchema(db)` → tworzy `items`, `state`, `runs` (idempotentne, `IF NOT EXISTS`)
- `getLastUid(db)` → `number | null`
- `setLastUid(db, uid)` → void
- `isKnown(db, messageId)` → `boolean`
- `insertItem(db, item)` → `boolean` (false jeśli duplikat; `INSERT OR IGNORE`). `item = {messageId, uid, sender, subject, date, cleanText, summary|null}`
- `setSummary(db, messageId, summary)` → void
- `recordRun(db, {fetched, newItems, durationMs, ok})` → void
- `getItemsByUids(db, uids)` → `item[]` (do renderu nowych pozycji runu)

**Tasks (TDD na tymczasowej bazie w pamięci `:memory:` lub temp file):**
- [ ] `initSchema` tworzy 3 tabele; ponowne wywołanie nie rzuca.
- [ ] `getLastUid` zwraca `null` na świeżej bazie; po `setLastUid(db, 42)` zwraca `42`.
- [ ] `insertItem` nowego → `true` + rekord w `items`; ten sam `messageId` ponownie → `false`, brak duplikatu.
- [ ] `isKnown` true/false zgodnie z zawartością.
- [ ] `setSummary` ustawia summary po `messageId`.
- [ ] `recordRun` dopisuje wiersz do `runs` z `ok`.

**Weryfikacja fazy:** `npm test` — wszystkie testy store zielone.
**Commit:** `feat: sqlite store with dedup, cursor and run log`.

---

## Task 2 — Faza 2: Mail parse & extract (`parse.js`, `extract.js`)

**Cel fazy:** surowy mail → czysty tekst. Czyste funkcje, testowane na fixture'ach offline. Tu mieszka najupierdliwsza część (różne szablony nadawców).

**Files:** Create `src/parse.js`, `src/extract.js`, `test/parse.test.js`, `test/extract.test.js`, `test/fixtures/*.eml`, `test/fixtures/*.html`.

**Interfaces — Produces:**
- `parseMail(raw)` → `{ messageId, sender, subject, date, html }` (`date` ISO string)
- `extractText(html)` → `cleanText` (string, bez nav/stopki/tracking)

**Tasks:**
- [ ] Zapisz 2-3 realne newslettery jako fixture (`.eml`) — różni nadawcy. (User dostarcza próbki albo bierzemy z foldera Newsletters ręcznie.)
- [ ] TDD `parseMail`: na fixture `.eml` zwraca poprawny `messageId`, `sender`, `subject`, niepusty `html`.
- [ ] TDD `extractText`: na fixture HTML zwraca tekst zawierający treść artykułu, NIE zawierający typowych śmieci (np. "Unsubscribe", linki stopki). Asercje na obecność/nieobecność fraz.
- [ ] Edge: pusty/zniekształcony HTML → `extractText` zwraca `''` zamiast rzucać.

**Weryfikacja fazy:** `npm test` — parse + extract zielone na fixture'ach.
**Commit:** `feat: mail parsing and readability extraction`.

---

## Task 3 — Faza 3: IMAP fetch (`imap.js`)

**Cel fazy:** pierwszy realny kontakt z Gmailem. Kursor: bootstrap vs przyrost.

**Files:** Create `src/imap.js`. Test: smoke integracyjny (wymaga `.env` + sieci), nieblokujący CI.

**Interfaces — Consumes:** `config`, `getLastUid` (z store). **Produces:**
- `fetchNewMessages(config, lastUid)` → `Promise<{ raw, uid }[]>`
  - `lastUid == null` → `SEARCH SINCE (today - bootstrapDays)` w folderze `config.imapFolder`
  - inaczej → `FETCH UID (lastUid+1):*`
  - zwraca surowe źródła maili + ich UID (raw idzie potem do `parseMail`)

**Tasks:**
- [ ] Implementacja połączenia `imapflow` (TLS, App Password), `mailboxOpen(imapFolder)`.
- [ ] Gałąź bootstrap (SINCE) i gałąź przyrostowa (UID range).
- [ ] Smoke: skrypt `node -e` / tymczasowy runner łączy się, drukuje liczbę i `subject` pierwszych N maili z `Newsletters`. **Milestone: "naprawdę gada z Gmailem".**
- [ ] Obsługa zamknięcia połączenia w `finally` (brak wiszących socketów).

**Weryfikacja fazy:** ręczny smoke run drukuje realne tematy z foldera; brak crasha gdy 0 nowych.
**Commit:** `feat: imap fetch with cursor + bootstrap window`.

---

## Task 4 — Faza 4: Summarize (`summarize.js`)

**Cel fazy:** clean_text → polskie summary z Ollamy. Drugi realny I/O.

**Files:** Create `src/summarize.js`, `test/summarize.test.js` (integracyjny, wymaga uruchomionej Ollamy + modelu).

**Interfaces — Consumes:** `config.ollamaModel`. **Produces:**
- `summarize(text, model)` → `Promise<string>` (2-3 zdania, PL)

**Tasks:**
- [ ] Prompt (z speca): "Streść poniższy newsletter po polsku w 2-3 zdaniach: co jest w środku i czy warto to czytać. Bez wstępu, sam konkret." + treść.
- [ ] Wywołanie `ollama` npm (`chat`/`generate`) na `config.ollamaModel`.
- [ ] Integracyjny test: krótki sample text → niepusty string, sensowna długość (np. < 600 znaków). Pomijany gdy Ollama nieosiągalna (graceful skip).
- [ ] Truncacja bardzo długiego `clean_text` przed wysłaniem (limit znaków do configu).

**Weryfikacja fazy:** `summarize("sample")` zwraca polskie streszczenie. **Milestone: "LLM działa".**
**Commit:** `feat: ollama summarization`.

---

## Task 5 — Faza 5: Render (`render.js`)

**Cel fazy:** items[] → `digest.html`. Czysta funkcja, testowalna offline.

**Files:** Create `src/render.js`, `test/render.test.js`.

**Interfaces — Consumes:** `item[]` (kształt z `store`). **Produces:**
- `renderHtml(items, meta)` → `string` (pełny dokument HTML, inline CSS). `meta = {ranAt, newCount}`.

**Tasks:**
- [ ] TDD: dla listy 2 itemów HTML zawiera oba `subject`, `sender`, `summary` i `href` linku; nagłówek z `newCount`.
- [ ] Sortowanie malejąco po `date`.
- [ ] Escape HTML w polach z maila (subject/sender) — test z `<script>` w subject nie przebija do outputu.
- [ ] Pusty `items` → strona z komunikatem "brak nowych" (nie crash).

**Weryfikacja fazy:** `npm test` render zielony; ręcznie otwórz wygenerowany plik z fixture'ów.
**Commit:** `feat: html digest renderer`.

---

## Task 6 — Faza 6: Orchestration (`digest.js`) + odpalanie

**Cel fazy:** spięcie wszystkiego w działający `node digest.js`. End-to-end na realnej skrzynce.

**Files:** Create `src/digest.js`. Modify `package.json` (`"start": "node src/digest.js"`).

**Interfaces — Consumes:** wszystkie powyższe moduły.

**Tasks (przepływ ze speca, sekcja Odporność = commit per-mail):**
- [ ] Otwórz db, `initSchema`, odczytaj `getLastUid`.
- [ ] `fetchNewMessages(config, lastUid)`.
- [ ] Dla każdego maila (sekwencyjnie): `parseMail` → `isKnown`? skip : (`extractText` → `insertItem` → `summarize` → `setSummary`). **Zapis po każdym mailu** (nie batch).
- [ ] `setLastUid(max(uid przerobionych))` **dopiero po pełnym przejściu pętli bez błędu**.
- [ ] `recordRun({fetched, newItems, durationMs, ok})` — także w `catch` z `ok=0`.
- [ ] `renderHtml(getItemsByUids(nowe uidy), meta)` → zapis `config.outPath` → `open` pliku (macOS `open`).
- [ ] Smoke end-to-end: pełny `node src/digest.js` na realnym folderze → powstaje `digest.html` z summary. **Milestone: v0 działa.**
- [ ] (Opcjonalnie, wzmianka nie implementacja) notka w README jak podpiąć launchd.

**Weryfikacja fazy:** `npm start` produkuje `digest.html`; drugi run = tylko przyrost (kursor działa); padnięcie symulowane (np. zła nazwa modelu) → `runs.ok=0`, brak utraty zapisanych wcześniej summary.
**Commit:** `feat: end-to-end digest orchestration`.

---

## Kolejność i zależności faz

```
0 scaffold ─► 1 store ─► 2 parse/extract ─┐
                          3 imap ──────────┤
                          4 summarize ─────┼─► 6 orchestrate (spina 1-5)
                          5 render ────────┘
```

Fazy 1, 2, 5 = czyste/offline (mocny TDD). 3, 4 = I/O, smoke integracyjny. 6 = end-to-end.
Fazy 2-5 są względem siebie niezależne po Fazie 1 — można robić w dowolnej kolejności / równolegle.

## Self-review (autor)

- **Pokrycie speca:** źródło IMAP+label→F3; filtr=folder→F3; Ollama→F4; output HTML→F5; storage items/state/runs→F1; kursor UID+bootstrap→F3/F1; odporność commit-per-mail→F6; format summary PL→F4; testy/fixtures→F2. Brak luk.
- **Placeholdery:** brak TBD/TODO w krokach; każda faza ma konkretny artefakt i commit.
- **Spójność typów:** `item` ma jeden kształt (`store` definiuje, `parse`/`render`/`digest` konsumują); `fetchNewMessages` zwraca `{raw, uid}[]` zgodnie z konsumpcją w F6.
