# Newsletter Digest

A private, local Gmail newsletter reader. It fetches new messages labelled
`Newsletters`, extracts their content, summarizes it in Polish with a local Ollama model,
and presents the results in a browser as a personal digest.

It does not send newsletter content to a paid AI API.

## Features

- Fetches only new newsletters from a chosen Gmail folder.
- Remembers previously processed messages, so later runs do not create duplicates.
- Creates short Polish summaries with a model running on your computer.
- Opens a local reader at `http://localhost:3789`.
- Keeps a history of previous digests.
- Can email each new digest through Gmail so it is available away from the local reader.
- Lets you ask the local model questions about an individual newsletter.
- Adds current weather and top Hacker News stories when those public services are available.

## Before you start

You will need:

- a computer with [Node.js 22 or newer](https://nodejs.org/);
- [Ollama](https://ollama.com/) installed and running;
- a Gmail account with IMAP enabled and an **App Password** created;
- a few minutes to set up one Gmail filter for each new newsletter sender.

App Passwords are available after enabling two-step verification on your Google Account.
An organization administrator can disable them for work accounts.

## Getting started

### 1. Clone the project and install dependencies

```bash
git clone https://github.com/BartekFo/newsletter-digest.git
cd newsletter-digest
npm install
npm run build
```

### 2. Prepare a local AI model

Install Ollama and then download a model. The project defaults to `gemma4:12b`:

```bash
ollama pull gemma4:12b
```

To use another model, set its name in `OLLAMA_MODEL` in the `.env` file described in
the next step. Because the model runs locally, hardware requirements depend on the model
you choose.

### 3. Create a Google App Password

In your Google Account security settings:

1. Enable two-step verification if it is not already enabled.
2. Create an **App Password** for a mail app.
3. Copy the generated password — it is needed only in the local `.env` file.

Do not use your regular Google Account password, and never commit the `.env` file to the
repository.

### 4. Label newsletters in Gmail

The project reads messages only from the `Newsletters` label.

1. Open a newsletter from the sender you want to follow in Gmail.
2. From the message menu, select **Filter messages like these**.
3. Create a filter that applies the `Newsletters` label. Gmail creates it if it does not
   already exist.
4. Repeat this only for each new newsletter sender.

This is intentional: the application does not guess which messages are newsletters, so it
does not accidentally analyze personal or work correspondence.

### 5. Configure the project

Create a file named `.env` in the project root and fill it in:

```dotenv
# Required
GMAIL_USER=your.address@gmail.com
GMAIL_APP_PASSWORD=paste_your_app_password_here

# Optional — these are the default values
IMAP_FOLDER=Newsletters
BOOTSTRAP_DAYS=7
OLLAMA_MODEL=gemma4:12b
WEATHER_CITY=Warsaw
PORT=3789

# Email each new, non-empty digest through Gmail SMTP
SEND_DIGEST_EMAIL=false
# Defaults to GMAIL_USER when omitted
DIGEST_EMAIL_TO=your.address@gmail.com
```

On its first run, the application fetches newsletters from the previous seven days.
After that, it fetches only messages that arrived since the last successful run.

### 6. Start the reader

```bash
npm start
```

On macOS, your browser should open `http://localhost:3789` automatically. On Linux and
Windows, open that address manually. At startup, the application checks for new
newsletters, saves a digest, and displays the latest non-empty view.

To open the last saved digest without fetching mail or generating a new one:

```bash
npm run open
```

Same as `node dist/src/server.js --no-refresh` (also accepts `--open`). You can still use
**Pobierz nowe** in the UI later.

Stop the server with `Ctrl+C` in the terminal.

## Using the reader

- Use **Pobierz nowe** (Fetch new) to check your inbox manually.
- Open **Historia** (History) to return to earlier digests.
- Select **Chat** on any newsletter to ask a question about its contents.
- When a newsletter arrives from a new sender, add its Gmail filter. Future messages will
  receive the label automatically.
- Set `SEND_DIGEST_EMAIL=true` to send every new, non-empty digest by email. The message
  contains an email-safe version of the summaries and links; local-only controls such as
  chat and refresh are intentionally omitted.

## Privacy and costs

Newsletter content, the database, and conversations about newsletters remain on your
computer. Ollama runs locally, so the tool does not charge for tokens or require an AI
service API key.

The application connects to Gmail and retrieves weather and top Hacker News stories from
public services. If the weather service or Hacker News is unavailable, the digest still
works; it simply omits that section. Gmail access reads the newsletter folder and, only
when `SEND_DIGEST_EMAIL=true`, sends the generated digest through Gmail SMTP. A delivery
failure does not remove or invalidate the locally saved digest.

## Local files

The following Git-ignored files will appear in the project directory:

- `.env` — Gmail credentials;
- `digest.db` — the local newsletter database and digest history;
- `dist/` — the compiled application.

To generate a one-off static HTML file instead of using the reader, run:

```bash
npm run digest:export
```

This creates `digest.html`, a static export of the view.

## Development

```bash
npm test
```

The default suite is fast and deterministic: it does not contact Gmail, Ollama, Open-Meteo,
or Hacker News. Run the explicit integration smoke tests separately:

```bash
npm run test:smoke
```

The Gmail smoke test runs only when `GMAIL_USER` and `GMAIL_APP_PASSWORD` are set. The
remaining smoke tests require their local or public services to be reachable and skip when
they are unavailable.

## License

This project is available under the [MIT License](LICENSE). You may use, copy, modify, and
distribute the code, including for commercial purposes, as long as you retain the copyright
and license notices.
