import { test } from "node:test";
import assert from "node:assert/strict";
import {
  estimateTokens, wordCount, chooseMode, effectiveMode, isOnDeviceError,
  buildSummaryPrompt, buildFlashcardPrompt,
  parseFlashcards, cardsToTsv, validateNotes, MIN_NOTES_CHARS, MAX_NOTES_CHARS,
} from "../logic.js";

test("estimateTokens & wordCount", () => {
  assert.equal(estimateTokens(""), 0);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(wordCount("  a b  c "), 3);
  assert.equal(wordCount(""), 0);
});

test("chooseMode: private mode forces ONLY_ON_DEVICE", () => {
  assert.equal(chooseMode("summarize", "x".repeat(20000), true), "ONLY_ON_DEVICE");
  assert.equal(chooseMode("flashcards", "short", true), "ONLY_ON_DEVICE");
});

test("chooseMode: summarize prefers on-device, long notes prefer cloud", () => {
  assert.equal(chooseMode("summarize", "short notes", false), "PREFER_ON_DEVICE");
  assert.equal(chooseMode("summarize", "x".repeat(13000), false), "PREFER_IN_CLOUD");
  assert.equal(chooseMode("flashcards", "any", false), "PREFER_IN_CLOUD");
});

test("effectiveMode: unavailable on-device pins every PREFER_* to cloud", () => {
  assert.equal(effectiveMode("PREFER_ON_DEVICE", "unavailable"), "ONLY_IN_CLOUD");
  assert.equal(effectiveMode("PREFER_IN_CLOUD", "unavailable"), "ONLY_IN_CLOUD");
  assert.equal(effectiveMode("PREFER_ON_DEVICE", "available"), "PREFER_ON_DEVICE");
  assert.equal(effectiveMode("PREFER_IN_CLOUD", "downloadable"), "PREFER_IN_CLOUD");
  // Private mode is never rewritten, even when on-device is unavailable.
  assert.equal(effectiveMode("ONLY_ON_DEVICE", "unavailable"), "ONLY_ON_DEVICE");
  assert.equal(effectiveMode("ONLY_IN_CLOUD", "available"), "ONLY_IN_CLOUD");
});

test("isOnDeviceError recognizes Chrome Prompt API failures", () => {
  assert.ok(isOnDeviceError(new Error("model.initializeDeviceModel is not a function")));
  assert.ok(isOnDeviceError(new Error("The feature flag gating model execution was disabled.")));
  assert.ok(isOnDeviceError(new Error("LanguageModel is not defined")));
  assert.equal(isOnDeviceError(new Error("quota exceeded")), false);
  assert.equal(isOnDeviceError(new Error("network error")), false);
});

test("prompts embed the notes and required format", () => {
  const s = buildSummaryPrompt("  my notes  ");
  assert.ok(s.includes("my notes") && s.includes("## Summary") && s.includes("## Key points"));
  const f = buildFlashcardPrompt("abc", 5);
  assert.ok(f.includes("exactly 5") && f.includes('"q"'));
});

test("parseFlashcards: clean JSON", () => {
  const { cards, error } = parseFlashcards('[{"q":"Q1","a":"A1"},{"q":"Q2","a":"A2"}]');
  assert.equal(error, null);
  assert.deepEqual(cards, [{ q: "Q1", a: "A1" }, { q: "Q2", a: "A2" }]);
});

test("parseFlashcards: code fences + prose around JSON", () => {
  const raw = 'Here you go:\n```json\n[{"question":"Q","answer":"A"}]\n```\nDone!';
  const { cards, error } = parseFlashcards(raw);
  assert.equal(error, null);
  assert.deepEqual(cards, [{ q: "Q", a: "A" }]);
});

test("parseFlashcards: rejects garbage and empty", () => {
  assert.ok(parseFlashcards("").error);
  assert.ok(parseFlashcards("not json").error);
  assert.ok(parseFlashcards('[{"q":"only q"}]').error);
});

test("cardsToTsv sanitizes tabs/newlines", () => {
  assert.equal(cardsToTsv([{ q: "a\tb", a: "c\nd" }]), "a b\tc d");
});

test("validateNotes bounds", () => {
  assert.equal(validateNotes("x".repeat(MIN_NOTES_CHARS)).ok, true);
  assert.equal(validateNotes("short").ok, false);
  assert.equal(validateNotes("x".repeat(MAX_NOTES_CHARS + 1)).ok, false);
});
