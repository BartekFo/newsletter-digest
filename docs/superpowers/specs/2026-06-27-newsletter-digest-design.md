# Newsletter Digest v0 — design

**Data:** 2026-06-27
**Status:** zatwierdzony, następny krok = plan implementacji
**Forma:** osobiste narzędzie (nie produkt), free + lokalne, anti-lock-in

## Cel

Ręcznie odpalany skrypt Node, który ściąga newslettery z Gmaila, streszcza je
lokalnym modelem (Ollama) i renderuje lokalną stronę `digest.html` z listą:
tytuł + źródło + data + AI summary + link do oryginału.

To pierwszy kamień (`v0`) większego pomysłu. Świadomie BEZ Electrona/UI frameworka —
najpierw udowadniamy trudną część (parsowanie maili + jakość streszczeń z Ollamy),
potem ewentualnie owijamy tę samą logikę w Electron (main process = pipeline,
renderer = React). Nic z v0 nie jest wyrzucane przy przejściu do v1.

## Decyzje zatwierdzone (kontekst, nie re-litygować)

- **Źródło treści (v0):** Gmail przez IMAP, autoryzacja App Password (to własne konto,
  zero OAuth). RSS/Substack dopiero w v1.
- **Filtr newsletterów:** dedykowany **label `Newsletters`** w Gmailu (user ustawia
  regułę w Gmailu). Skrypt czyta przez IMAP **tylko ten folder** → wszystko w nim =
  newsletter, brak heurystyki. (Odrzucono: osobne konto na newslettery — user nie chce
  kolejnej skrzynki; odrzucono: heurystyka List-Unsubscribe — niepotrzebny false-positive
  na czystym folderze.)
- **LLM:** Ollama lokalnie, model `qwen3.6:35b-a3b` (już zainstalowany; MoE ~3B active,
  szybki + dobra jakość). Sprzęt: MacBook Pro M3 Pro, 36 GB RAM.
- **Output (v0):** lokalna strona **HTML** (`digest.html`), otwierana w przeglądarce.
  (Odrzucono self-email — nie chce więcej maili; nodemailer+SMTP zbędne.)
- **Stack:** Node v22. Bez frameworka UI, bez bundlera.
- **Toolchain:** Node v22.22.1, Ollama 0.24.0 (zainstalowane).

## Architektura

Jeden skrypt (`digest.js`) + kilka modułów o jednej odpowiedzialności każdy.
Granice tak, by każdy moduł dało się zrozumieć i przetestować osobno:

```
digest.js            -- orkiestracja: spina kroki, obsługa run/log
  imap.js            -- połączenie IMAP, wybór folderu, fetch wg kursora
  parse.js           -- mailparser → {sender, subject, date, html}
  extract.js         -- readability → czysty tekst z html
  summarize.js       -- wywołanie Ollama, prompt, zwrot summary
  store.js           -- better-sqlite3: items / state / runs, dedup
  render.js          -- czysty tekst+summary → digest.html
  config.js          -- env: credentiale, BOOTSTRAP_DAYS, model, ścieżki
```

## Pipeline (przepływ danych)

```
1. IMAP login (Gmail App Password), SELECT folder "Newsletters"
2. ustal zakres wg kursora:
     first run (state.last_uid == null) → SEARCH SINCE (today - BOOTSTRAP_DAYS)
     kolejne runy                       → FETCH UID last_uid+1:*
3. mailparser   → { message_id, sender, subject, date, html }
4. readability  → clean_text (wycina nav/stopkę/tracking)
5. dedup        → INSERT OR IGNORE po message_id; znane pomijamy
6. Ollama       → summary dla nowych (sekwencyjnie)
7. zapis        → SQLite (commit per-mail, patrz Odporność)
8. render       → digest.html, `open digest.html`
9. po sukcesie  → state.last_uid = max(uid przerobionych), wpis do runs
```

## Model danych (SQLite `digest.db`)

```sql
items(
  message_id  TEXT PRIMARY KEY,   -- dedup
  uid         INTEGER,            -- IMAP UID (kursor)
  sender      TEXT,
  subject     TEXT,
  date        TEXT,               -- ISO
  clean_text  TEXT,
  summary     TEXT,               -- NULL dopóki Ollama nie skończy
  created_at  TEXT
);

state(key TEXT PRIMARY KEY, value TEXT);   -- last_uid
runs(
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at      TEXT,
  fetched     INTEGER,   -- ile maili pobrano
  new_items   INTEGER,   -- ile nowych (po dedup)
  duration_ms INTEGER,
  ok          INTEGER    -- 0/1
);
```

## Kursor pobierania (high-water-mark)

- IMAP nadaje rosnące UID per-folder → trzymamy najwyższy przerobiony `last_uid`.
- **First run:** brak kursora → `SEARCH SINCE (today - BOOTSTRAP_DAYS)`, `BOOTSTRAP_DAYS=7`.
  Łapie tydzień wstecz zamiast całej historii skrzynki.
- **Kolejne runy:** `FETCH UID last_uid+1:*` → tylko przyrost.
- **Pominięte dni nie gubią maili:** run w czwartek, brak piątek/sobota, run w niedzielę →
  kursor sprawia, że niedzielny run łapie Thu→Sun. Próg 7 dni dotyczy tylko first runu.

## Odporność (run padnie w połowie)

- **Commit per-mail:** summary zapisywane do SQLite od razu po przerobieniu danego maila
  (nie batch na końcu). Padnięcie na 5. mailu nie traci 4 poprzednich.
- **`last_uid` aktualizowany dopiero gdy mail w pełni przetworzony i zapisany.** Następny
  run dokończy resztę od pierwszego nieprzerobionego UID — brak dziur.
- **Dedup po `message_id`** jako siatka bezpieczeństwa: nawet jeśli zakresy się nałożą,
  `INSERT OR IGNORE` wyrzuca duplikaty.
- Wpis do `runs` z `ok=0` przy błędzie → log użycia pokazuje nieudane przebiegi.

## Format summary

- 2-3 zdania, czysty tekst, **po polsku**. Bez tagów/kategorii w v0.
- Prompt (szkic, do dopracowania w implementacji):
  > "Streść poniższy newsletter po polsku w 2-3 zdaniach: co jest w środku i czy warto
  > to czytać. Bez wstępu, sam konkret."
- Wejście do modelu = `clean_text` (po readability), nie surowy HTML.

## Render (`digest.html`)

- Statyczny HTML generowany przez skrypt, jeden plik, inline CSS (zero zależności).
- Lista **nowych pozycji z bieżącego runu** posortowana malejąco po dacie:
  **tytuł (subject) · źródło (sender) · data · summary · link do oryginału**.
- Na górze nagłówek z datą runu i liczbą nowych pozycji.

## Konfiguracja (`config.js` / env)

```
GMAIL_USER            -- adres
GMAIL_APP_PASSWORD    -- App Password (IMAP)
IMAP_FOLDER=Newsletters
BOOTSTRAP_DAYS=7
OLLAMA_MODEL=qwen3.6:35b-a3b
DB_PATH=./digest.db
OUT_PATH=./digest.html
```

Sekrety przez plik `.env` (gitignore), nie hardcode.

## Odpalanie

- `node digest.js` ręcznie.
- Później opcjonalnie launchd (poza zakresem v0; wzmianka, nie implementacja).

## Poza zakresem v0 (świadomie — YAGNI)

Dwie zakładki (Daily / Skrzynka), progressive rendering, RSS/Substack, Electron/React UI,
tagi/kategorie, retencja, graf subskrypcji, tray/autostart. To v1+ z handoffu.

## Testowanie

- Moduły czyste (`parse`, `extract`, `render`, `store`) testowalne na fixture'ach
  (zapisane przykładowe `.eml` / HTML newsletterów) bez sieci.
- `imap` i `summarize` (I/O zewnętrzne) za interfejsem → w testach mock/fake.
- Najupierdliwsza część = `extract` (różne szablony nadawców): zestaw fixture'ów z kilku
  realnych newsletterów jako regresja.
