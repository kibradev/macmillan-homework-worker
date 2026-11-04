# StudyPilot — AI Homework Assistant

StudyPilot is a Chrome extension (Manifest V3) that reads online English-course exercises, asks an AI model for the answers, and fills them into the page. It is built mainly for **Macmillan Education Everywhere / Language Hub** and also works on simple generic HTML forms.

It runs entirely in your browser. There is no backend and no account: you bring your own API key and the extension talks directly to the AI provider.

## Features

- **Quick Solve** — one click on the in-page button scans the activity, asks the AI and fills in the answers.
- **Review mode** — the popup lists every detected question with the AI's suggested answer and explanation. You can edit answers and approve them before they are filled in.
- **Auto-advance (optional)** — "Solve All" solves an activity, presses *Next*, waits for the next one and repeats. It asks for confirmation first, has a Stop button, never presses Check/Submit, and stops at the first problem.
- **Macmillan question types** — radio and checkbox lists, dropdowns, typed gaps, drag-and-drop gaps, word ordering, sentence builders, "locating" tasks, listening activities and multi-frame pages.
- **Bring your own key** — Google Gemini, OpenAI and Anthropic Claude are supported.
- **Diagnostics** — *Diagnostic Report* and *Copy HTML* buttons help you report pages the extension does not understand yet.
- **Safety guard** — submit / hand-in / finish / grade buttons are blocked from being clicked by the extension.

## Project layout

```
src/
  ai/          AI providers (Gemini, OpenAI, Anthropic) and the shared prompt/response parser
  background/  Service worker: orchestrates scan -> solve -> fill across frames
  content/     Content script injected into pages (scanner, filler, in-page panel)
  core/        Auto-pilot pipeline, "Solve All" series runner, panel commands
  extractor/   DOM scanner, question classifier, Next-button finder
  filler/      Fills answers into the page (drag-and-drop, dropdowns, inputs...) + safety validator
  platform/    Platform adapters (Macmillan, generic)
  popup/       React popup / side panel UI
  storage/     Settings and key storage
  ui/          In-page floating panel (shadow DOM)
tests/         Unit tests + saved Macmillan HTML fixtures
e2e/           End-to-end test in a real Chrome (puppeteer)
mock/          Local mock homework page for testing without an account
```

## Installation

**Requirements:** [Node.js](https://nodejs.org/) 18+ and Google Chrome (or another Chromium browser).

1. **Get the code and install dependencies**

   ```bash
   git clone https://github.com/<your-username>/studypilot.git
   cd studypilot
   npm install
   ```

2. **Build the extension**

   ```bash
   npm run build
   ```

   This creates the `dist/` folder.

3. **Load it in Chrome**

   1. Open `chrome://extensions`.
   2. Turn on **Developer mode** (top right).
   3. Click **Load unpacked** and select the `dist/` folder.
   4. Pin StudyPilot to the toolbar.

4. **Add an API key**

   1. Click the StudyPilot icon and open the **AI & Settings** tab.
   2. Choose a provider and paste your key (for example a free key from [Google AI Studio](https://aistudio.google.com/)).
   3. Click **Test API Connection**, then **Save Settings**.

After changing the code, run `npm run build` again and click the reload icon on the extension card in `chrome://extensions`, then refresh the homework page.

## Usage

1. Open an activity on Macmillan (or the mock page, see below).
2. Click the floating **Quick Solve** button at the bottom of the page — or use the popup's **Auto-Pilot** button.
3. To review answers first, use **Scan** → **Solve** → **Fill** in the in-page panel (open it with the arrow next to the button), or **Scan Only** → **Suggestions** → **Fill Approved Answers** in the popup.
4. Always check the page and press Check/Submit yourself.

**Solve All:** open the panel, set *Max activities* and *Delay*, click **Solve All** and confirm. If the extension cannot find the right *Next* button, paste its CSS selector under *Next button selector* in Settings.

### Try it without an account

Open `mock/homework-mock.html` in Chrome (enable **Allow access to file URLs** for the extension in `chrome://extensions` → Details), or serve it with `npx serve mock`.

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Rebuild on every change |
| `npm run build` | Typecheck and build to `dist/` |
| `npm run typecheck` | TypeScript check only |
| `npm test` | Unit tests (jsdom + saved Macmillan fixtures) |
| `npm run e2e` | End-to-end test in a real Chrome with the built extension (needs a local Chrome install and `npm run build` first) |

## Privacy & security

- No backend, no analytics. Page content is sent only to the AI provider you selected, using your own key.
- API keys are kept in `chrome.storage.local` by default; tick the session-only option in Settings to keep them in `chrome.storage.session` (erased when the browser closes). Browser extensions cannot fully hide a key from someone with access to your machine, so use a key with a spending limit.
- Keys are never logged.

## Responsible use

StudyPilot is a personal automation and study tool. Using it on graded or teacher-assigned work may break your school's academic-integrity rules or the platform's terms of service. You are responsible for how you use it. The project is not affiliated with or endorsed by Macmillan Education.

## License

No license has been chosen yet. Add a `LICENSE` file (for example MIT) before publishing if you want others to be able to reuse the code.
