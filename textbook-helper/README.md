# Textbook Helper (Chrome extension)

A Chrome side-panel extension that reads your textbook pages and answers
questions from that reading with Claude. Each answer comes with a short
explanation and a quote from the reading that backs it up, so you can check it
and learn from it.

## How it works

1. **Build the reading.** Open a textbook page and click **Add this page**. The
   extension pulls the text from the page, including text inside iframes, which
   many e-textbook readers use. You can add as many pages or chapters as you
   like. You can also:
   - **Add selected text** to save only what you've highlighted.
   - **Upload PDF / .txt** to add a textbook PDF. Claude reads PDFs directly,
     including figures.
   - **Paste text** when a page can't be read (for example, a reader that draws
     text as images).
2. **Get the question.** Highlight the question and its answer choices on the
   page, then click **Grab from page**. You can also type or paste it. Tick
   **Include screenshot** when the question relies on a diagram, a chart or its
   layout.
3. **Click Answer.** Claude replies with:
   - **Answer**: the option, term or list
   - **Why**: a short explanation
   - **From the reading**: a supporting quote and the name of its source

   If the reading doesn't cover the question, Claude says so before falling back
   on general knowledge.

The reading is saved in the extension's local storage and stays there between
sessions until you remove it (✕). It's sent with prompt caching, so the second
and later questions on the same reading are faster and cost much less.

## Install

You'll need Node 18 or newer and an Anthropic API key from
<https://console.anthropic.com/>.

```bash
cd textbook-helper
npm install
npm run build        # writes the unpacked extension to dist/
```

Then in Chrome:

1. Go to `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and pick the `textbook-helper/dist` folder.
3. Pin the extension and click its icon (or press `Ctrl+Shift+Y` / `⌘⇧Y`) to
   open the side panel.
4. Open **⚙ Settings**, paste your API key and click **Save**.

After you change the code, run `npm run build` again (or `npm run watch`), then
click the reload icon on the extension's card in `chrome://extensions`.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Model | `claude-opus-5-5` | You can enter any Claude model ID. `claude-sonnet-5-5` and `claude-haiku-5-5` cost less. |
| Effort | `medium` | Use `low` for quick recall questions and `high` for multi-step reasoning. |

If Claude's safety filters decline a request, the extension has the API retry
it on a recommended fallback model (`fallbacks: "default"`).

## Privacy

- Your API key and saved reading stay in this browser's extension storage.
- The extension sends data only to `api.anthropic.com`, and only when you click
  **Answer**.
- Page text is read only when you click **Add this page**, **Add selected text**
  or **Grab from page**. The extension asks for access to all sites so it can do
  that on any textbook site and inside the reader's iframes.

## Limitations

- Chrome blocks extensions from reading `chrome://` pages and the built-in PDF
  viewer. Use **Upload PDF** for PDFs.
- Some readers render each page as an image or canvas. If **Add this page**
  finds almost no text, use **Include screenshot** for the question and paste or
  upload the reading.
- Check answers against the quoted passage. Claude can make mistakes, and your
  course's academic-integrity rules still apply.

## Layout

```
static/manifest.json   MV3 manifest (side panel, scripting, storage)
static/sidepanel.*     side panel markup and styles
src/background.ts      opens the side panel when the toolbar icon is clicked
src/sidepanel.ts       UI: managing the reading, grabbing questions, rendering answers
src/extract.ts         function injected into each frame to pull page text and selection
src/claude.ts          Claude API call (Anthropic TypeScript SDK, streaming, prompt caching)
build.mjs              esbuild bundling into dist/
```
