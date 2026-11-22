import { firebaseConfig } from "./config.js?v=4";
import { initFirebase, isConfigured, checkOnDeviceAvailability, summarizeNotes, makeFlashcards } from "./ai.js?v=4";
import { validateNotes, cardsToTsv } from "./logic.js?v=4";

const $ = (id) => document.getElementById(id);
const notesEl = $("notes"), progressEl = $("progress"), errorEl = $("error");
let lastCards = [];

const SAMPLE = `Photosynthesis is the process by which green plants, algae, and some bacteria convert light energy into chemical energy stored in glucose. It takes place primarily in chloroplasts, organelles containing the pigment chlorophyll. The overall equation is 6CO2 + 6H2O + light energy -> C6H12O6 + 6O2. Photosynthesis has two stages: the light-dependent reactions, which occur in the thylakoid membranes and produce ATP and NADPH while releasing oxygen from water, and the Calvin cycle (light-independent reactions), which occurs in the stroma and uses ATP and NADPH to fix carbon dioxide into organic molecules. Factors affecting the rate of photosynthesis include light intensity, carbon dioxide concentration, and temperature. Photosynthesis is essential for nearly all life on Earth because it produces oxygen and forms the base of most food chains.`;

function setError(msg) { errorEl.hidden = !msg; errorEl.textContent = msg || ""; }
function setProgress(msg) { progressEl.hidden = !msg; progressEl.textContent = msg || ""; }
function busy(on) { $("btn-summarize").disabled = on; $("btn-flashcards").disabled = on; }

function updateCount() { $("charcount").textContent = `${notesEl.value.length} chars`; }
notesEl.addEventListener("input", () => { updateCount(); localStorage.setItem("notesnap-notes", notesEl.value); });

function download(name, content, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

async function run(kind) {
  setError(""); 
  const v = validateNotes(notesEl.value);
  if (!v.ok) { setError(v.error); return; }
  if (!isConfigured(firebaseConfig)) { setError("Firebase is not configured yet — copy config.example.js to config.js with your Firebase web config (see README)."); return; }
  busy(true); setProgress("Preparing model… (first on-device run may download Gemini Nano)");
  const onProgress = (pct) => setProgress(`Downloading on-device model… ${pct}%`);
  try {
    if (kind === "summarize") {
      const { text, mode } = await summarizeNotes(notesEl.value, $("private-mode").checked, onProgress);
      $("summary-out").textContent = text;
      $("summary-mode").textContent = `mode: ${mode}`;
      $("summary-card").hidden = false;
    } else {
      const { cards, mode } = await makeFlashcards(notesEl.value, $("private-mode").checked, 8, onProgress);
      lastCards = cards;
      $("cards-mode").textContent = `mode: ${mode}`;
      $("cards-out").innerHTML = "";
      cards.forEach((c, i) => {
        const div = document.createElement("div"); div.className = "flashcard";
        div.innerHTML = `<strong>Q${i + 1}.</strong> `;
        div.append(document.createTextNode(c.q));
        const a = document.createElement("div"); a.className = "a"; a.textContent = c.a; div.append(a);
        div.title = "Click to reveal answer";
        div.addEventListener("click", () => div.classList.toggle("open"));
        $("cards-out").append(div);
      });
      $("cards-card").hidden = false;
    }
    setProgress("");
  } catch (e) {
    setProgress("");
    setError(`AI request failed: ${e.message}. If Private mode is on, the on-device model may be unavailable in this browser — try Chrome 139+ desktop with the Prompt API flag enabled, or turn Private mode off to allow cloud fallback.`);
  } finally { busy(false); }
}

$("btn-summarize").addEventListener("click", () => run("summarize"));
$("btn-flashcards").addEventListener("click", () => run("flashcards"));
$("btn-sample").addEventListener("click", () => { notesEl.value = SAMPLE; updateCount(); });
$("btn-export-tsv").addEventListener("click", () => download("notesnap-flashcards.tsv", cardsToTsv(lastCards), "text/tab-separated-values"));
$("btn-export-json").addEventListener("click", () => download("notesnap-flashcards.json", JSON.stringify(lastCards, null, 2), "application/json"));

function netBadge() { $("net-badge").textContent = `Network: ${navigator.onLine ? "online" : "offline"}`; }
addEventListener("online", netBadge); addEventListener("offline", netBadge); netBadge();

(async () => {
  notesEl.value = localStorage.getItem("notesnap-notes") || ""; updateCount();
  if (isConfigured(firebaseConfig)) {
    try { initFirebase(firebaseConfig); $("config-badge").textContent = "Firebase: configured"; $("config-badge").className = "badge ok"; }
    catch (e) { $("config-badge").textContent = `Firebase: init failed (${e.message})`; }
  }
  const avail = await checkOnDeviceAvailability();
  const labels = { available: "available ✓", downloadable: "downloadable (will fetch on first use)", downloading: "downloading…", unavailable: "unavailable in this browser → cloud fallback" };
  $("device-badge").textContent = `On-device model: ${labels[avail] || avail}`;
  if (avail === "available") $("device-badge").className = "badge ok";
})();
