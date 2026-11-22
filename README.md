# NoteSnap Hybrid

Paste lecture notes → get an exam-ready summary and flashcards. The AI runs
**on-device** (Gemini Nano in Chrome — private, offline, free) when available and
falls back to **cloud** Gemini otherwise, through a single SDK:
[Firebase AI Logic hybrid inference](https://firebase.google.com/docs/ai-logic/hybrid/web/get-started).

Built for **#BuildHybridAI 2026** (Web / Chrome platform).

## How hybrid inference is used

| Feature | Inference mode | Why |
|---|---|---|
| Summarize (short/medium notes) | `PREFER_ON_DEVICE` | Private, offline, zero cost |
| Summarize (long notes > ~3k tokens) | `PREFER_IN_CLOUD` | Bigger context/quality for long documents |
| Flashcards (structured JSON) | `PREFER_IN_CLOUD` | Reliable structured output, on-device fallback |
| Private mode toggle | `ONLY_ON_DEVICE` | Sensitive notes never leave the device; errors instead of silently using cloud |

All AI inference goes through Firebase AI Logic (`firebase/ai`, `GoogleAIBackend`,
`InferenceMode`) with Firebase App Check enforced. No other model APIs are called.
The UI shows live badges for on-device model availability (Chrome Prompt API
`LanguageModel.availability()`) and network state, plus the mode used for each result.

## Run it

Requirements: Chrome 139+ on desktop for on-device inference (cloud fallback works
in any modern browser), and a Firebase project on the free Spark plan.

1. Create a Firebase project → **AI Services > AI Logic > Get started**
   (choose the **Gemini Developer API** provider — free tier, no billing needed).
2. Register a Web app and copy its config into `config.js`
   (start from `config.example.js`).
3. Register the app in **App Check** with reCAPTCHA Enterprise; put the site key in
   `config.js` as `appCheckSiteKey`. For localhost, the app enables the App Check
   debug provider — copy the debug token from the browser console and register it
   under App Check > Apps > Manage debug tokens. **Never commit a debug token.**
4. For on-device inference: enable `chrome://flags/#prompt-api-for-gemini-nano-multimodal-input`
   and restart Chrome. The model downloads on first use (progress is shown in the UI).
5. Serve the folder: `python3 -m http.server 8000` → open `http://localhost:8000`.
   Click **Load sample notes**, then **Summarize** / **Make flashcards**.

## Tests

```bash
node --test tests/logic.test.mjs
```

Pure logic (prompt building, mode selection, flashcard JSON parsing, Anki TSV
export, input validation) lives in `logic.js` and is covered by unit tests.

## Structure

- `index.html` / `styles.css` / `app.js` — UI (no build step, ES modules via CDN import map)
- `ai.js` — Firebase AI Logic wrapper (App Check, hybrid models, `initializeDeviceModel`)
- `logic.js` — pure, tested logic
- `config.example.js` — template; `config.js` — your project config (placeholder by default)

## Privacy

Notes and history stay in the browser (`localStorage`). In Private mode
(`ONLY_ON_DEVICE`) note text is never sent to the cloud.

## License

MIT — see `LICENSE`.
