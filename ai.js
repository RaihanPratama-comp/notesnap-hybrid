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

// SDK 12.5.0 (pinned in index.html importmap) has NO initializeDeviceModel():
// its Chrome adapter downloads/creates the on-device session internally on the
// first generateContent(). Newer SDKs document initializeDeviceModel(cb) after a
// user gesture — call it only if present, and never let it block cloud fallback.
export async function ensureDeviceModel(onProgress) {
  if (deviceReady) return;
  try {
    const model = modelFor("PREFER_ON_DEVICE");
    if (typeof model.initializeDeviceModel === "function") {
      await model.initializeDeviceModel((val) => {
        if (onProgress) onProgress(Math.round(val * 100));
      });
    }
  } catch {
    // On-device init failed (e.g. Prompt API flag off). PREFER_* modes must
    // still reach the cloud path; ONLY_ON_DEVICE surfaces its own error below.
  }
  deviceReady = true;
}

// Errors thrown by the Chrome Prompt API / on-device path (as opposed to real
// cloud errors). Used to decide when a cloud-pinned retry is honest.
function isOnDeviceError(e) {
  const msg = String(e?.message || e || "");
  return /feature flag|LanguageModel|Prompt API|on-device|not available in this environment/i.test(msg);
}

async function generate(modeName, prompt, onProgress) {
  let effectiveMode = modeName;

  if (modeName === "ONLY_ON_DEVICE") {
    // Private mode: never touch the cloud. Fail honestly up front when the
    // on-device model cannot run in this browser.
    const avail = await checkOnDeviceAvailability();
    if (avail === "unavailable") {
      throw new Error("Private mode requires the on-device model, but Gemini Nano / the Chrome Prompt API is unavailable in this browser. Use Chrome 139+ desktop with the Prompt API flag enabled, or turn Private mode off to allow cloud inference.");
    }
    await ensureDeviceModel(onProgress);
  } else {
    if (modeName === "PREFER_ON_DEVICE") await ensureDeviceModel(onProgress);
    // When on-device cannot run at all, PREFER_IN_CLOUD's SDK fallback would
    // try the device after a cloud error and mask the real cloud error with a
    // Chrome Prompt API error ("feature flag gating model execution was
    // disabled"). Pin to cloud so the cloud result/error is the real one.
    if (modeName === "PREFER_IN_CLOUD") {
      const avail = await checkOnDeviceAvailability();
      if (avail === "unavailable") effectiveMode = "ONLY_IN_CLOUD";
    }
  }

  try {
    const model = modelFor(effectiveMode);
    const result = await model.generateContent(prompt);
    return { text: result.response.text(), mode: effectiveMode };
  } catch (e) {
    // Last-resort honesty: if a PREFER_* request died inside the on-device
    // path (availability looked OK but session creation hit the Chrome
    // feature-flag gate), retry once pinned to cloud. ONLY_ON_DEVICE never
    // retries — private notes must not leave the device.
    if (modeName !== "ONLY_ON_DEVICE" && effectiveMode !== "ONLY_IN_CLOUD" && isOnDeviceError(e)) {
      const model = modelFor("ONLY_IN_CLOUD");
      const result = await model.generateContent(prompt);
      return { text: result.response.text(), mode: "ONLY_IN_CLOUD" };
    }
    throw e;
  }
}

export async function summarizeNotes(notesText, privateMode, onProgress) {
  const mode = chooseMode("summarize", notesText, privateMode);
  const { text, mode: effectiveMode } = await generate(mode, buildSummaryPrompt(notesText), onProgress);
  return { text, mode: effectiveMode };
}

export async function makeFlashcards(notesText, privateMode, count = 8, onProgress) {
  const mode = chooseMode("flashcards", notesText, privateMode);
  const { text: raw, mode: effectiveMode } = await generate(mode, buildFlashcardPrompt(notesText, count), onProgress);
  const { cards, error } = parseFlashcards(raw);
  if (error) throw new Error(`Flashcard parsing failed: ${error}`);
  return { cards, mode: effectiveMode };
}
