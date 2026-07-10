# Newsletter Digest

Prywatny, lokalny czytnik newsletterów z Gmaila. Pobiera nowe wiadomości oznaczone
etykietą `Newsletters`, oczyszcza ich treść, streszcza je po polsku lokalnym modelem
Ollama i pokazuje w przeglądarce jako osobisty digest.

Nie wysyła treści newsletterów do płatnego API AI.

## Co potrafi

- pobiera wyłącznie nowe newslettery z wybranego folderu Gmaila;
- zapamiętuje już przeczytane wiadomości, więc kolejne uruchomienia nie dublują treści;
- tworzy krótkie streszczenia po polsku przy użyciu modelu działającego na Twoim komputerze;
- otwiera lokalny reader pod `http://localhost:3789`;
- zachowuje historię poprzednich digestów;
- pozwala dopytać lokalny model o konkretny newsletter;
- dodaje aktualną pogodę i najpopularniejsze wpisy z Hacker News, jeśli te publiczne usługi są dostępne.

## Zanim zaczniesz

Potrzebujesz:

- komputera z [Node.js 22 lub nowszym](https://nodejs.org/);
- zainstalowanego i uruchomionego [Ollama](https://ollama.com/);
- konta Gmail z włączonym IMAP-em i utworzonym **hasłem do aplikacji**;
- kilku minut na ustawienie jednego filtra Gmaila dla każdego nowego newslettera.

Hasła do aplikacji są dostępne, gdy konto Google ma włączoną weryfikację dwuetapową.
Na kontach firmowych administrator może je wyłączyć.

## Uruchomienie krok po kroku

### 1. Pobierz projekt i zainstaluj zależności

```bash
git clone https://github.com/BartekFo/newsletter-digest.git
cd newsletter-digest
npm install
npm run build
```

### 2. Przygotuj lokalny model AI

Zainstaluj Ollama, a następnie pobierz model. Domyślna konfiguracja projektu używa
modelu `gemma4:12b`:

```bash
ollama pull gemma4:12b
```

Jeśli chcesz użyć innego modelu, wpisz jego nazwę w `OLLAMA_MODEL` w pliku `.env`
(opisanym w kolejnym kroku). Model działa lokalnie, więc jego wymagania sprzętowe
zależą od wybranego wariantu.

### 3. Utwórz hasło do aplikacji Google

W ustawieniach bezpieczeństwa konta Google:

1. Włącz weryfikację dwuetapową, jeśli nie jest jeszcze włączona.
2. Utwórz **hasło do aplikacji** dla aplikacji pocztowej.
3. Skopiuj wygenerowane hasło — będzie potrzebne tylko w pliku `.env` na Twoim komputerze.

Nie używaj zwykłego hasła do konta Google i nigdy nie dodawaj pliku `.env` do repozytorium.

### 4. Oznacz newslettery w Gmailu

Projekt czyta wyłącznie wiadomości z etykietą `Newsletters`.

1. W Gmailu otwórz newsletter od wybranego nadawcy.
2. Z menu wiadomości wybierz **Filtruj wiadomości podobne do tych**.
3. Utwórz filtr, który nadaje etykietę `Newsletters` (Gmail utworzy ją, jeśli jeszcze nie istnieje).
4. Powtórz to tylko dla każdego nowego nadawcy newslettera.

To celowe: aplikacja nie zgaduje, które maile są newsletterami, więc nie powinna
przypadkowo analizować prywatnej lub służbowej korespondencji.

### 5. Skonfiguruj projekt

Utwórz w głównym katalogu projektu plik o nazwie `.env` i uzupełnij go:

```dotenv
# Wymagane
GMAIL_USER=twoj.adres@gmail.com
GMAIL_APP_PASSWORD=wklej_tutaj_haslo_do_aplikacji

# Opcjonalne — poniższe wartości są domyślne
IMAP_FOLDER=Newsletters
BOOTSTRAP_DAYS=7
OLLAMA_MODEL=gemma4:12b
WEATHER_CITY=Warsaw
PORT=3789
```

Przy pierwszym uruchomieniu aplikacja pobierze newslettery z ostatnich 7 dni.
Później pobiera już tylko wiadomości, które pojawiły się od ostatniego udanego przebiegu.

### 6. Włącz reader

```bash
npm start
```

Na macOS przeglądarka powinna otworzyć adres `http://localhost:3789` automatycznie.
Na Linuxie i Windowsie otwórz ten adres ręcznie. Przy starcie aplikacja sprawdzi nowe
newslettery, zapisze digest i pokaże ostatni niepusty widok.

Zatrzymaj serwer w terminalu skrótem `Ctrl+C`.

## Jak używać

- Użyj przycisku **Pobierz nowe / Odśwież**, aby ręcznie sprawdzić skrzynkę.
- Otwórz **Historię digestów**, aby wrócić do wcześniejszych zestawów.
- Przy dowolnym newsletterze wybierz **Chat**, aby zadać pytanie o jego treść.
- Gdy pojawi się newsletter od nowego nadawcy, dodaj mu filtr w Gmailu — przy kolejnych
wiadomościach etykieta zostanie nadana automatycznie.

## Prywatność i koszty

Treść newsletterów, baza danych i rozmowy z newsletterami pozostają na Twoim komputerze.
Model Ollama działa lokalnie, dlatego narzędzie nie nalicza opłat za tokeny ani nie wymaga
klucza do usługi AI.

Aplikacja łączy się z Gmailem oraz pobiera pogodę i najpopularniejsze wpisy z Hacker
News z publicznych usług. Jeśli usługa pogody lub Hacker News jest niedostępna, digest
nadal działa — po prostu nie pokaże tej sekcji. Dostęp do Gmaila służy wyłącznie do
odczytu folderu z newsletterami.

## Dane lokalne

W katalogu projektu powstaną pliki ignorowane przez Git:

- `.env` — dane dostępowe do Gmaila;
- `digest.db` — lokalna baza newsletterów i historii digestów;
- `dist/` — skompilowana wersja aplikacji.

Jeśli zamiast readera chcesz wygenerować jednorazowy plik HTML, użyj:

```bash
npm run digest:export
```

Plik `digest.html` będzie wtedy statycznym eksportem widoku.

## Rozwój projektu

```bash
npm test
```

Testy nie wymagają dostępu do Twojej skrzynki Gmail. Test integracyjny IMAP uruchomi się
dopiero, gdy w środowisku są ustawione dane dostępowe.

## Licencja

Projekt ma obecnie status `UNLICENSED`. Jeżeli ma być używany lub rozwijany przez inne
osoby, przed publicznym udostępnieniem warto wybrać i dodać licencję.
