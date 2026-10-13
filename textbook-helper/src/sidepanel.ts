import { askClaude, DEFAULT_SETTINGS, describeError, type Settings, type Source } from "./claude";
import { extractFrameText, type FrameText } from "./extract";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const els = {
  settings: $<HTMLElement>("settings"),
  apiKey: $<HTMLInputElement>("api-key"),
  model: $<HTMLInputElement>("model"),
  effort: $<HTMLSelectElement>("effort"),
  sources: $<HTMLUListElement>("sources"),
  readingTotal: $<HTMLSpanElement>("reading-total"),
  pasteBox: $<HTMLDivElement>("paste-box"),
  pasteTitle: $<HTMLInputElement>("paste-title"),
  pasteText: $<HTMLTextAreaElement>("paste-text"),
  question: $<HTMLTextAreaElement>("question"),
  useScreenshot: $<HTMLInputElement>("use-screenshot"),
  ask: $<HTMLButtonElement>("ask"),
  stop: $<HTMLButtonElement>("stop"),
  answerSection: $<HTMLElement>("answer-section"),
  answer: $<HTMLDivElement>("answer"),
  status: $<HTMLParagraphElement>("status"),
};

let settings: Settings = { ...DEFAULT_SETTINGS };
let sources: Source[] = [];
let controller: AbortController | null = null;

// ---------- storage ----------

async function load() {
  const stored = await chrome.storage.local.get(["settings", "sources"]);
  settings = { ...DEFAULT_SETTINGS, ...((stored.settings as Partial<Settings> | undefined) ?? {}) };
  sources = (stored.sources as Source[] | undefined) ?? [];
  els.apiKey.value = settings.apiKey;
  els.model.value = settings.model;
  els.effort.value = settings.effort;
  if (!settings.apiKey) els.settings.hidden = false;
  renderSources();
}

async function saveSources() {
  await chrome.storage.local.set({ sources });
  renderSources();
}

// ---------- UI helpers ----------

function setStatus(msg: string, isError = false) {
  els.status.textContent = msg;
  els.status.classList.toggle("error", isError);
}

function formatChars(n: number) {
  // ~4 chars per token is a rough guide for English prose.
  const tokens = Math.round(n / 4);
  return tokens >= 1000 ? `~${Math.round(tokens / 1000)}k tokens` : `~${tokens} tokens`;
}

function renderSources() {
  els.sources.replaceChildren(
    ...sources.map((s) => {
      const li = document.createElement("li");
      const meta = document.createElement("div");
      meta.className = "meta";
      const title = document.createElement("div");
      title.className = "title";
      title.textContent = s.title;
      title.title = s.url ?? s.title;
      const size = document.createElement("div");
      size.className = "size";
      size.textContent = s.kind === "pdf" ? `PDF · ${Math.round(s.chars / 1024)} KB` : formatChars(s.chars);
      meta.append(title, size);
      const remove = document.createElement("button");
      remove.className = "secondary";
      remove.textContent = "✕";
      remove.title = "Remove";
      remove.onclick = () => {
        sources = sources.filter((x) => x.id !== s.id);
        void saveSources();
      };
      li.append(meta, remove);
      return li;
    }),
  );
  const textChars = sources.filter((s) => s.kind === "text").reduce((n, s) => n + s.chars, 0);
  els.readingTotal.textContent = sources.length
    ? `· ${sources.length} source${sources.length > 1 ? "s" : ""}, ${formatChars(textChars)}${
        sources.some((s) => s.kind === "pdf") ? " + PDFs" : ""
      }`
    : "· none yet";
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// Minimal, safe markdown: escape first, then bold/italics, blockquotes, paragraphs.
function renderMarkdown(md: string) {
  const inline = (s: string) =>
    escapeHtml(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*(?!\s)(.+?)\*/g, "$1<em>$2</em>")
      .replace(/_(.+?)_/g, "<em>$1</em>");
  const out: string[] = [];
  let quote: string[] = [];
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${quote.join("<br>")}</blockquote>`);
    quote = [];
  };
  for (const line of md.split("\n")) {
    if (line.startsWith(">")) {
      quote.push(inline(line.replace(/^>\s?/, "")));
      continue;
    }
    flushQuote();
    if (line.trim()) out.push(`<p>${inline(line)}</p>`);
  }
  flushQuote();
  return out.join("");
}

// ---------- page access ----------

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("No active tab.");
  return tab;
}

async function readActiveTab(): Promise<{ tab: chrome.tabs.Tab; frames: FrameText[] }> {
  const tab = await activeTab();
  if (tab.url?.startsWith("chrome") || tab.url?.startsWith("edge:")) {
    throw new Error("Chrome doesn't let extensions read this page.");
  }
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id!, allFrames: true },
      func: extractFrameText,
    });
  } catch (err) {
    throw new Error(
      `Couldn't read this page (${err instanceof Error ? err.message : err}). ` +
        "If it's a PDF open in Chrome, use “Upload PDF” instead.",
    );
  }
  // Main frame first, then iframes (many textbook readers render inside iframes).
  const frames = results
    .sort((a, b) => (a.frameId === 0 ? -1 : b.frameId === 0 ? 1 : 0))
    .map((r) => r.result)
    .filter((r): r is FrameText => !!r);
  return { tab, frames };
}

function addTextSource(title: string, text: string, url?: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("No text found to add.");
  // Replace an earlier copy of the same page rather than duplicating it.
  if (url) sources = sources.filter((s) => s.url !== url);
  sources.push({
    id: crypto.randomUUID(),
    title: title || "Untitled",
    url,
    kind: "text",
    text: trimmed,
    chars: trimmed.length,
    addedAt: Date.now(),
  });
}

// ---------- actions ----------

async function run(label: string, fn: () => Promise<void>) {
  try {
    setStatus(label);
    await fn();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), true);
  }
}

$("settings-toggle").onclick = () => (els.settings.hidden = !els.settings.hidden);

$("save-settings").onclick = () =>
  run("Saving…", async () => {
    settings = {
      apiKey: els.apiKey.value.trim(),
      model: els.model.value.trim() || DEFAULT_SETTINGS.model,
      effort: els.effort.value as Settings["effort"],
    };
    await chrome.storage.local.set({ settings });
    els.settings.hidden = true;
    setStatus("Settings saved.");
  });

$("add-page").onclick = () =>
  run("Reading page…", async () => {
    const { tab, frames } = await readActiveTab();
    const text = frames
      .map((f) => f.text)
      .filter((t) => t.length > 0)
      .join("\n\n");
    if (text.length < 200) {
      throw new Error(
        "Found almost no text on this page. The reader may draw text as images; try selecting text, pasting it, or uploading the PDF.",
      );
    }
    addTextSource(tab.title ?? frames[0]?.title ?? "Page", text, tab.url);
    await saveSources();
    setStatus(`Added “${tab.title}”.`);
  });

$("add-selection").onclick = () =>
  run("Reading selection…", async () => {
    const { tab, frames } = await readActiveTab();
    const selection = frames.map((f) => f.selection).filter(Boolean).join("\n\n");
    if (!selection) throw new Error("Select some text on the page first.");
    addTextSource(`${tab.title ?? "Selection"} (selection)`, selection);
    await saveSources();
    setStatus("Added selected text.");
  });

$("toggle-paste").onclick = () => (els.pasteBox.hidden = !els.pasteBox.hidden);

$("add-paste").onclick = () =>
  run("Adding…", async () => {
    addTextSource(els.pasteTitle.value.trim() || "Pasted reading", els.pasteText.value);
    els.pasteTitle.value = "";
    els.pasteText.value = "";
    els.pasteBox.hidden = true;
    await saveSources();
    setStatus("Added pasted text.");
  });

$<HTMLInputElement>("add-file").onchange = (e) =>
  run("Loading file…", async () => {
    const input = e.target as HTMLInputElement;
    for (const file of Array.from(input.files ?? [])) {
      if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
        if (file.size > 30 * 1024 * 1024) throw new Error(`${file.name} is over the 32 MB API limit.`);
        const buf = new Uint8Array(await file.arrayBuffer());
        let bin = "";
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        sources.push({
          id: crypto.randomUUID(),
          title: file.name,
          kind: "pdf",
          data: btoa(bin),
          chars: file.size,
          addedAt: Date.now(),
        });
      } else {
        addTextSource(file.name, await file.text());
      }
    }
    input.value = "";
    await saveSources();
    setStatus("File added.");
  });

$("grab-question").onclick = () =>
  run("Reading question…", async () => {
    const { frames } = await readActiveTab();
    const selection = frames.map((f) => f.selection).filter(Boolean).join("\n\n");
    if (selection) {
      els.question.value = selection;
      setStatus("Grabbed the selected question.");
    } else {
      // No selection: send the visible page text and let Claude find the question.
      const text = frames.map((f) => f.text).filter(Boolean).join("\n\n");
      els.question.value =
        "Find the question currently shown on this page and answer it.\n\nPage text:\n" + text.slice(0, 20000);
      setStatus("No text selected, so grabbed the whole page. Selecting just the question works better.");
    }
  });

els.ask.onclick = () =>
  run("Asking Claude…", async () => {
    if (!settings.apiKey) {
      els.settings.hidden = false;
      throw new Error("Add your Anthropic API key in Settings first.");
    }
    const question = els.question.value.trim();
    if (!question && !els.useScreenshot.checked) throw new Error("Enter or grab a question first.");

    let screenshotDataUrl: string | undefined;
    if (els.useScreenshot.checked) {
      const tab = await activeTab();
      screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
    }

    controller = new AbortController();
    els.ask.disabled = true;
    els.stop.hidden = false;
    els.answerSection.hidden = false;
    els.answer.innerHTML = "";
    try {
      await askClaude({
        settings,
        sources,
        question: question || "Answer the question shown in the screenshot.",
        screenshotDataUrl,
        signal: controller.signal,
        onText: (text) => (els.answer.innerHTML = renderMarkdown(text)),
      });
      setStatus("");
    } catch (err) {
      if (!els.answer.textContent) els.answerSection.hidden = true;
      throw new Error(describeError(err));
    } finally {
      controller = null;
      els.ask.disabled = false;
      els.stop.hidden = true;
    }
  });

els.stop.onclick = () => controller?.abort();

void load();
