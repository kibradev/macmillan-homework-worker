# StudyPilot — AI-Powered Homework Assistant

**StudyPilot** is a locally running, privacy-first Chrome Extension (Manifest V3) that assists students with online homework exercises, initially focusing on **Macmillan Education Everywhere / Language Hub**.

StudyPilot detects questions, extracts fields and options, generates AI suggestions with explanations, allows students to review and edit answers, and fills approved fields into the webpage upon explicit user approval.

---

## 🌟 Key Features

- **Local-First & Zero-Backend Architecture**: Runs 100% inside your browser. No middleman servers, no data logging, no accounts required.
- **BYO API Key (Bring Your Own Key)**:
  - **Google Gemini** (`gemini-1.5-flash`, `gemini-2.0-flash`, `gemini-1.5-pro`)
  - **OpenAI** (`gpt-4o-mini`, `gpt-4o`, `gpt-3.5-turbo`)
  - **Anthropic Claude** (`claude-3-5-haiku`, `claude-3-5-sonnet`)
- **Privacy & Security Focused**:
  - API keys are stored in `chrome.storage.session` by default (automatically erased when the browser session ends).
  - API keys are communicated directly to the respective AI provider endpoint.
- **Multi-Question Type Support**:
  - Multiple Choice (radio groups)
  - Fill in the Blanks (inline sentence text inputs)
  - Dropdown Selection (`<select>` menus)
  - True / False questions
  - Short answer / Textareas
- **Safety Guarantees**:
  - **Never automatically submits assignments**: Form submission buttons (`submit`, `hand in`, `finish test`, `turn in`) are strictly blocked by safety guards.
  - **Explicit Approval Required**: Only answers reviewed and checked by the student are filled.
  - **Synthetic Event Dispatch**: Triggers standard DOM events (`focus`, `input`, `change`, `blur`) and React value setter prototypes so reactive SPAs detect the changes.
- **Macmillan Platform Adapter**: Detects Macmillan domains and provides documented integration points for real-page DOM testing.
- **Included Interactive Mock Homework Page**: Enables full end-to-end local testing without needing a Macmillan login.

---

## 📁 Architecture Overview

```
studypilot/
├── dist/                      # Production-ready Chrome Extension build
├── mock/
│   └── homework-mock.html     # Interactive test homework page
├── public/
│   ├── icons/                 # Extension icons (16px, 48px, 128px)
│   └── manifest.json          # Chrome Manifest V3 configuration
├── src/
│   ├── ai/                    # AI Provider abstraction layer
│   │   ├── base.ts            # System prompt & structured JSON response validation
│   │   ├── gemini.ts          # Google Gemini REST implementation
│   │   ├── openai.ts          # OpenAI Chat Completions implementation
│   │   ├── anthropic.ts       # Anthropic Claude Messages implementation
│   │   └── index.ts           # Provider factory & registry
│   ├── extractor/             # DOM scanning and classification
│   │   ├── dom-scanner.ts     # Traverses page, links labels to fields, builds CSS selectors
│   │   └── question-classifier.ts # Categorizes questions by field types and options
│   ├── filler/                # Safe field filling & event simulation
│   │   ├── form-filler.ts     # Fills fields with React tracker compatibility & visual flash
│   │   └── safety-validator.ts# Blocks submit buttons and dangerous elements
│   ├── platform/              # Modular platform adapters
│   │   ├── registry.ts        # Platform detection and adapter selector
│   │   ├── generic.ts         # Standard web form adapter (test pages & LMSs)
│   │   └── macmillan.ts       # Dedicated Macmillan Education / Language Hub adapter
│   ├── storage/
│   │   └── settings.ts        # Session & local storage settings manager
│   ├── popup/                 # React UI (Popup window)
│   │   ├── components/        # Header, ScannerTab, SettingsTab, QuestionCard, StatusBanner
│   │   ├── App.tsx            # Main state coordinator
│   │   ├── index.css          # Modern dark & light mode styles
│   │   └── main.tsx           # React DOM root
│   ├── background/            # MV3 Service Worker
│   │   └── index.ts
│   └── content/               # Content Script injected into matching tabs
│       └── index.ts
└── tests/
    └── core.test.ts           # Automated tests for classification, parsing, and safety
```

---

## 🚀 Installation & Setup (Chrome Desktop)

### 1. Prerequisites
- **Node.js** (v18 or higher; v24 recommended)
- **npm** (v9 or higher)
- **Google Chrome** browser

### 2. Install & Build
In your terminal, navigate to the project directory and run:

```bash
# 1. Install dependencies
npm install

# 2. Typecheck TypeScript files
npm run typecheck

# 3. Run unit tests
npm test

# 4. Build extension bundle for production
npm run build
```

This generates the ready-to-load extension in the `dist/` directory.

### 3. Load the Unpacked Extension in Chrome

1. Open Google Chrome.
2. In the URL address bar, enter `chrome://extensions/` and press **Enter**.
3. In the top-right corner, toggle **Developer mode** to **ON**.
4. Click the **Load unpacked** button in the top-left corner.
5. In the file picker dialog, select the **`dist`** folder inside the `studypilot` directory:
   `c:\Users\Administrator\Desktop\studypilot\dist`
6. StudyPilot will appear in your extensions list. Pin it to the Chrome toolbar for easy access.

---

## 🧪 Testing with the Mock Homework Page

You can immediately test StudyPilot without an active Macmillan student account:

1. In Chrome, open the mock homework page:
   - Either navigate to: `file:///c:/Users/Administrator/Desktop/studypilot/mock/homework-mock.html`
   - *Tip:* In `chrome://extensions`, click **Details** on StudyPilot and enable **"Allow access to file URLs"** so content scripts run on local `file://` pages.
   - Alternatively, serve the mock page using any local HTTP server (e.g. `npx serve mock` or `http-server`).
2. Click the **StudyPilot** extension icon in your Chrome toolbar.
3. Switch to the **AI & Settings** tab:
   - Choose your provider (e.g. **Google Gemini**).
   - Enter your API key (get a free key from [Google AI Studio](https://aistudio.google.com/)).
   - Click **Test API Connection** to verify your key.
   - Click **Save Settings**.
4. Switch back to the **Assistant** tab:
   - Click **Scan Homework**. StudyPilot extracts all 5 questions (Multiple Choice, Fill in the Blank, Dropdown, True/False, and Short Answer).
   - Click **Suggestions** (or *Generate Suggestions*). The AI analyzes each question and provides suggested answers with step-by-step explanations and confidence ratings.
   - Review and tweak any suggested answer in the editable fields.
   - Check **Approve to fill** (or click *Approve All*).
   - Click **Fill Approved Answers**.
5. Observe each field on the homework page being safely populated with a green highlight outline!

---

## 🏫 Macmillan Integration & Real-Page Testing Points

The dedicated Macmillan adapter (`src/platform/macmillan.ts`) is designed for **Macmillan Education Everywhere** and **Language Hub**:

1. **Domain Detection**: Detects `*.macmillaneducationeverywhere.com`, `*.languagehub.macmillaneducation.com`, and `*.macmillanenglish.com`.
2. **Documented Integration Points**:
   - `[INTEGRATION POINT 1]`: Activity container selectors (`.activity-container`, `[data-activity-id]`, `.exercise-view`).
   - `[INTEGRATION POINT 2]`: Iframe activity handler for activities embedded inside same-origin frames.
   - `[INTEGRATION POINT 3]`: Proprietary question markup mapping for Language Hub gap-fills and clickable chips.
   - `[INTEGRATION POINT 4]`: Custom Angular/React event dispatching when answers are populated.

When testing on a live Macmillan account, inspect the activity DOM elements and update these documented hooks in `src/platform/macmillan.ts`.

---

## 🔒 Security & Privacy Notes

- **Client-Side Key Protection Limitations**: Browser extensions execute on the client machine. API keys stored in the browser cannot be cryptographically hidden from someone who inspects the local browser process.
- **Session-Only Storage**: By default, StudyPilot saves your API keys in `chrome.storage.session`, meaning keys are cleared when Chrome is closed.
- **Zero Logging**: API keys and homework questions are never logged to external monitoring services or central servers.
- **No Data Harvesting**: StudyPilot only interacts with interactive input elements in the active tab when requested by the user.

---

## 💻 Available Scripts

- `npm run dev` — Builds the extension in watch mode for development.
- `npm run build` — Runs TypeScript verification and builds the production bundle into `dist/`.
- `npm run typecheck` — Runs `tsc --noEmit` to validate all TypeScript types.
- `npm test` — Executes automated unit tests with `tsx --test`.

---

## ⚖️ Ethical Use & Safety Notice

StudyPilot is designed as an educational assistant to help students understand challenging exercises and check their reasoning.
- StudyPilot **never** submits assignments automatically.
- Users are solely responsible for verifying the accuracy of AI suggestions and complying with their academic institution's honor code and terms of service.
