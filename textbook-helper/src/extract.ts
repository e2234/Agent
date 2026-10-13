export interface FrameText {
  title: string;
  url: string;
  text: string;
  selection: string;
}

// Injected into every frame of the tab via chrome.scripting.executeScript, so it
// must be fully self-contained (no imports, no closures over module scope).
export function extractFrameText(): FrameText {
  const selection = window.getSelection()?.toString().trim() ?? "";
  const body = document.body;
  if (!body) return { title: document.title, url: location.href, text: "", selection };

  // Prefer the main content region when the page marks one and it holds most of
  // the text; otherwise fall back to the whole body.
  const fullText = body.innerText ?? "";
  const main = document.querySelector<HTMLElement>("main, [role=main], article");
  const mainText = main?.innerText ?? "";
  const text = mainText.length > fullText.length * 0.5 ? mainText : fullText;

  return {
    title: document.title,
    url: location.href,
    text: text.replace(/\n{3,}/g, "\n\n").trim(),
    selection,
  };
}
