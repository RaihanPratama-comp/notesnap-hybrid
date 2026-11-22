// Pure logic for NoteSnap Hybrid — no DOM, no Firebase. Unit-tested in Node.

export const MAX_NOTES_CHARS = 20000;
export const MIN_NOTES_CHARS = 80;

// Rough token estimate (~4 chars/token for English/Indonesian mixed text).
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function wordCount(text) {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

// Decide which inference mode a feature should use.
// - privateMode: user demands on-device only (sensitive notes).
// - summarize: short/medium notes prefer on-device; very long notes prefer cloud.
// - flashcards: structured generation prefers cloud, falls back on-device.
export function chooseMode(feature, notesText, privateMode) {
  if (privateMode) return "ONLY_ON_DEVICE";
  const tokens = estimateTokens(notesText || "");
  if (feature === "summarize") {
    return tokens > 3000 ? "PREFER_IN_CLOUD" : "PREFER_ON_DEVICE";
  }
  if (feature === "flashcards") {
    return "PREFER_IN_CLOUD";
  }
  return "PREFER_ON_DEVICE";
}

// Resolve the mode actually handed to the SDK given on-device availability.
// When Gemini Nano / the Chrome Prompt API cannot run at all
// (availability === "unavailable"), EVERY PREFER_* mode must be pinned to
// ONLY_IN_CLOUD: otherwise the SDK's own on-device attempt dies inside
// generateContent() with Chrome Prompt API errors (e.g. "model.initializeDeviceModel
// is not a function", "The feature flag gating model execution was disabled")
// instead of falling back to cloud. ONLY_ON_DEVICE (Private mode) is never
// rewritten — private notes must not leave the device.
export function effectiveMode(modeName, availability) {
  if (modeName === "ONLY_ON_DEVICE") return "ONLY_ON_DEVICE";
  if (availability === "unavailable" && String(modeName).startsWith("PREFER_")) {
    return "ONLY_IN_CLOUD";
  }
  return modeName;
}

// True when an error came from the Chrome Prompt API / on-device path rather
// than the cloud backend. Used to decide when a cloud-pinned retry is honest.
export function isOnDeviceError(e) {
  const msg = String(e?.message || e || "");
  return /initializeDeviceModel|feature flag|gating|LanguageModel|Prompt API|on-device|not available in this environment/i.test(msg);
}

export function buildSummaryPrompt(notesText) {
  return [
    "You are a study assistant. Summarize the lecture notes below for a student revising before an exam.",
    "Respond in the same language as the notes.",
    "Format exactly:",
    "## Summary",
    "(3-5 sentences)",
    "## Key points",
    "- (5-8 bullet points, one line each)",
    "## Terms to remember",
    "- term: one-line definition (up to 6)",
    "",
    "NOTES:",
    notesText.trim(),
  ].join("\n");
}

export function buildFlashcardPrompt(notesText, count = 8) {
  return [
    `Create exactly ${count} flashcards from the notes below.`,
    "Each card: a short question (front) and a concise answer (back, max 25 words).",
    "Cover the most exam-relevant facts. Use the same language as the notes.",
    'Respond with JSON only: [{"q":"...","a":"..."}]',
    "",
    "NOTES:",
    notesText.trim(),
  ].join("\n");
}

// Parse flashcards from model output. Tolerates code fences and stray text.
// Returns { cards: [{q,a}], error: string|null }.
export function parseFlashcards(raw) {
  if (!raw || !raw.trim()) return { cards: [], error: "empty response" };
  let text = raw.trim();
  // Strip markdown code fences.
  text = text.replace(/```(?:json)?/gi, "").trim();
  // Find the outermost JSON array if extra prose surrounds it.
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) text = text.slice(start, end + 1);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { cards: [], error: "response was not valid JSON" };
  }
  if (!Array.isArray(parsed)) return { cards: [], error: "response was not an array" };
  const cards = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const q = String(item.q ?? item.question ?? item.front ?? "").trim();
    const a = String(item.a ?? item.answer ?? item.back ?? "").trim();
    if (q && a) cards.push({ q, a });
  }
  if (cards.length === 0) return { cards: [], error: "no valid flashcards in response" };
  return { cards, error: null };
}

// Anki-compatible TSV export (front \t back), with tabs/newlines sanitized.
export function cardsToTsv(cards) {
  return cards
    .map((c) => `${c.q.replace(/[\t\r\n]+/g, " ")}\t${c.a.replace(/[\t\r\n]+/g, " ")}`)
    .join("\n");
}

export function validateNotes(text) {
  const t = (text || "").trim();
  if (t.length < MIN_NOTES_CHARS) {
    return { ok: false, error: `Notes are too short (min ${MIN_NOTES_CHARS} characters).` };
  }
  if (t.length > MAX_NOTES_CHARS) {
    return { ok: false, error: `Notes are too long (max ${MAX_NOTES_CHARS} characters).` };
  }
  return { ok: true, error: null };
}
