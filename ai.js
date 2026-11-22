// Firebase AI Logic wrapper — ALL AI inference in this app goes through here.
// Hybrid inference: on-device (Gemini Nano via Chrome Prompt API) when available,
// cloud-hosted Gemini otherwise, per-feature via InferenceMode.
// Docs: https://firebase.google.com/docs/ai-logic/hybrid/web/get-started
import { initializeApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode } from "firebase/ai";
import { buildSummaryPrompt, buildFlashcardPrompt, parseFlashcards, chooseMode } from "./logic.js";

let app = null;
let ai = null;
let deviceReady = false;

export function isConfigured(config) {
  return Boolean(config && config.apiKey && !String(config.apiKey).startsWith("REPLACE_"));
}

export function initFirebase(config) {
  app = initializeApp(config);
  // App Check is required by Firebase AI Logic. On localhost use the debug provider
  // (token printed to console; register it in Firebase console > App Check).
  // Never commit a real debug token.
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
    self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  if (config.appCheckSiteKey && !String(config.appCheckSiteKey).startsWith("REPLACE_")) {
    initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(config.appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
  ai = getAI(app, { backend: new GoogleAIBackend() });
  return app;
}

// Check Chrome Prompt API / Gemini Nano availability without Firebase.
export async function checkOnDeviceAvailability() {
  try {
    if (typeof LanguageModel === "undefined") return "unavailable";
    return await LanguageModel.availability(); // "available" | "downloadable" | "downloading" | "unavailable"
  } catch {
    return "unavailable";
  }
}

function modelFor(modeName) {
  if (!ai) throw new Error("Firebase not initialized");
  return getGenerativeModel(ai, { mode: InferenceMode[modeName] });
}

// Must be called from a user gesture before the first prompt (Chrome requirement).
export async function ensureDeviceModel(onProgress) {
  if (deviceReady) return;
  const model = modelFor("PREFER_ON_DEVICE");
  await model.initializeDeviceModel((val) => {
    if (onProgress) onProgress(Math.round(val * 100));
  });
  deviceReady = true;
}

async function generate(modeName, prompt, onProgress) {
  if (modeName === "PREFER_ON_DEVICE" || modeName === "ONLY_ON_DEVICE") {
    await ensureDeviceModel(onProgress);
  }
  const model = modelFor(modeName);
  const result = await model.generateContent(prompt);
  return result.response.text();
}

export async function summarizeNotes(notesText, privateMode, onProgress) {
  const mode = chooseMode("summarize", notesText, privateMode);
  const text = await generate(mode, buildSummaryPrompt(notesText), onProgress);
  return { text, mode };
}

export async function makeFlashcards(notesText, privateMode, count = 8, onProgress) {
  const mode = chooseMode("flashcards", notesText, privateMode);
  const raw = await generate(mode, buildFlashcardPrompt(notesText, count), onProgress);
  const { cards, error } = parseFlashcards(raw);
  if (error) throw new Error(`Flashcard parsing failed: ${error}`);
  return { cards, mode };
}
