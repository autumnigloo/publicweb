import "./styles.css";
import { load } from "js-yaml";

type SlideLayout = "single" | "split";

interface Deck {
  title: string;
  slides: Slide[];
}

interface Slide {
  title?: string;
  layout: SlideLayout;
  body?: string;
  left?: string;
  right?: string;
}

interface ListItemNode {
  text: string;
  children: ListItemNode[];
}

type ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: ListItemNode[] };

const SAMPLE_YAML = `title: Product Story
slides:
  - title: Opening
    body: |
      Build slides from YAML and share the whole deck with a URL.

      - Write plain text
      - Add **bold** or *italic*
      - Keep outlines simple

  - title: Split Layout
    layout: split
    left: |
      The left side can hold:

      - A short setup
      - Supporting bullets
        - With nesting
          - Up to three layers
    right: |
      The right side can hold:

      A normal paragraph with **emphasis**.

  - title: Closing
    body: |
      Shareable links store the full YAML deck in the URL.
`;

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root missing");
}

app.innerHTML = `
  <main class="page">
    <section class="editor-panel panel">
      <div class="panel-head">
        <div>
          <p class="eyebrow">YAML editor</p>
          <h1>YAML Slides</h1>
        </div>
        <button id="copy-link" class="accent">Copy Share Link</button>
      </div>
      <p class="hint">
        Schema: top-level <code>title</code> and <code>slides</code>. Each slide can use
        <code>body</code> or <code>layout: split</code> with <code>left</code> and <code>right</code>.
      </p>
      <textarea id="yaml-input" spellcheck="false"></textarea>
      <div class="status-row">
        <span id="status-text"></span>
        <span id="url-size"></span>
      </div>
    </section>
    <section class="preview-panel panel">
      <div class="preview-head">
        <div>
          <p class="eyebrow">Preview</p>
          <h2 id="deck-title"></h2>
        </div>
        <div class="nav-group">
          <button id="prev-slide">Prev</button>
          <span id="slide-count"></span>
          <button id="next-slide">Next</button>
        </div>
      </div>
      <article id="slide-frame" class="slide-frame"></article>
      <p class="hint keyboard-hint">Arrow keys move between slides when the editor is not focused.</p>
    </section>
  </main>
`;

const yamlInput = document.querySelector<HTMLTextAreaElement>("#yaml-input")!;
const statusText = document.querySelector<HTMLSpanElement>("#status-text")!;
const urlSize = document.querySelector<HTMLSpanElement>("#url-size")!;
const deckTitle = document.querySelector<HTMLHeadingElement>("#deck-title")!;
const slideCount = document.querySelector<HTMLSpanElement>("#slide-count")!;
const slideFrame = document.querySelector<HTMLElement>("#slide-frame")!;
const prevSlideButton = document.querySelector<HTMLButtonElement>("#prev-slide")!;
const nextSlideButton = document.querySelector<HTMLButtonElement>("#next-slide")!;
const copyLinkButton = document.querySelector<HTMLButtonElement>("#copy-link")!;

let currentDeck: Deck | null = null;
let currentSlideIndex = 0;
let shareUrl = window.location.href;
let shareTimer = 0;

void init();

async function init() {
  const params = new URLSearchParams(window.location.search);
  const encodedDeck = params.get("deck");
  const initialSlide = clampSlideIndex(Number(params.get("slide") ?? "1") - 1, 0);

  if (encodedDeck) {
    try {
      yamlInput.value = await decodeDeck(encodedDeck);
      currentSlideIndex = initialSlide;
    } catch (error) {
      yamlInput.value = SAMPLE_YAML;
      setStatus(`Could not decode shared deck: ${formatError(error)}`, true);
    }
  } else {
    yamlInput.value = SAMPLE_YAML;
  }

  bindEvents();
  void refreshFromEditor();
}

function bindEvents() {
  yamlInput.addEventListener("input", () => {
    window.clearTimeout(shareTimer);
    shareTimer = window.setTimeout(() => {
      void refreshFromEditor();
    }, 180);
  });

  prevSlideButton.addEventListener("click", () => {
    moveSlide(-1);
  });

  nextSlideButton.addEventListener("click", () => {
    moveSlide(1);
  });

  copyLinkButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus("Share link copied.", false);
    } catch {
      setStatus("Clipboard write failed. Copy the URL from the address bar.", true);
    }
  });

  window.addEventListener("keydown", (event) => {
    if (document.activeElement === yamlInput) {
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveSlide(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveSlide(1);
    }
  });
}

async function refreshFromEditor() {
  try {
    const parsed = parseDeck(yamlInput.value);
    currentDeck = parsed;
    currentSlideIndex = clampSlideIndex(currentSlideIndex, parsed.slides.length - 1);
    renderDeck(parsed);
    await updateShareUrl();
    setStatus("Deck parsed successfully.", false);
  } catch (error) {
    currentDeck = null;
    renderError(formatError(error));
    setStatus(formatError(error), true);
  }
}

function renderDeck(deck: Deck) {
  deckTitle.textContent = deck.title;
  slideCount.textContent = `${currentSlideIndex + 1} / ${deck.slides.length}`;
  prevSlideButton.disabled = currentSlideIndex <= 0;
  nextSlideButton.disabled = currentSlideIndex >= deck.slides.length - 1;

  const slide = deck.slides[currentSlideIndex];
  slideFrame.className = `slide-frame ${slide.layout === "split" ? "split" : "single"}`;
  slideFrame.replaceChildren();

  const title = document.createElement("header");
  title.className = "slide-title";

  const titleText = document.createElement("h3");
  titleText.textContent = slide.title || `Slide ${currentSlideIndex + 1}`;
  title.appendChild(titleText);
  slideFrame.appendChild(title);

  const body = document.createElement("section");
  body.className = "slide-body";

  if (slide.layout === "split") {
    body.classList.add("split-body");
    body.appendChild(buildContentColumn(slide.left ?? "", "Left"));
    body.appendChild(buildContentColumn(slide.right ?? "", "Right"));
  } else {
    body.appendChild(buildContentColumn(slide.body ?? "", ""));
  }

  slideFrame.appendChild(body);
}

function renderError(message: string) {
  deckTitle.textContent = "Preview unavailable";
  slideCount.textContent = "--";
  prevSlideButton.disabled = true;
  nextSlideButton.disabled = true;
  slideFrame.className = "slide-frame error";
  slideFrame.innerHTML = `
    <div class="error-card">
      <h3>YAML error</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function buildContentColumn(source: string, label: string) {
  const column = document.createElement("div");
  column.className = "content-column";

  if (label) {
    const marker = document.createElement("p");
    marker.className = "column-label";
    marker.textContent = label;
    column.appendChild(marker);
  }

  for (const block of parseRichText(source)) {
    if (block.type === "paragraph") {
      const paragraph = document.createElement("p");
      paragraph.appendChild(renderInline(block.text));
      column.appendChild(paragraph);
      continue;
    }

    column.appendChild(buildList(block.items, 1));
  }

  return column;
}

function buildList(items: ListItemNode[], depth: number): HTMLUListElement {
  const list = document.createElement("ul");
  list.dataset.depth = String(depth);

  for (const item of items) {
    const entry = document.createElement("li");
    const text = document.createElement("div");
    text.appendChild(renderInline(item.text));
    entry.appendChild(text);

    if (item.children.length) {
      entry.appendChild(buildList(item.children, depth + 1));
    }

    list.appendChild(entry);
  }

  return list;
}

function renderInline(text: string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let index = 0;

  while (index < text.length) {
    if (text.startsWith("**", index)) {
      const end = text.indexOf("**", index + 2);
      if (end > index + 2) {
        const strong = document.createElement("strong");
        strong.appendChild(renderInline(text.slice(index + 2, end)));
        fragment.appendChild(strong);
        index = end + 2;
        continue;
      }
    }

    if (text[index] === "*") {
      const end = text.indexOf("*", index + 1);
      if (end > index + 1) {
        const emphasis = document.createElement("em");
        emphasis.appendChild(renderInline(text.slice(index + 1, end)));
        fragment.appendChild(emphasis);
        index = end + 1;
        continue;
      }
    }

    fragment.append(text[index]);
    index += 1;
  }

  return fragment;
}

function parseRichText(source: string): ContentBlock[] {
  const normalized = source.replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return [];
  }

  const blocks: ContentBlock[] = [];
  const paragraphLines: string[] = [];
  let currentList: ListItemNode[] | null = null;
  const lastItemsByDepth: ListItemNode[] = [];

  const flushParagraph = () => {
    if (!paragraphLines.length) {
      return;
    }
    blocks.push({
      type: "paragraph",
      text: paragraphLines.join(" ").trim(),
    });
    paragraphLines.length = 0;
  };

  const resetList = () => {
    currentList = null;
    lastItemsByDepth.length = 0;
  };

  for (const line of normalized.split("\n")) {
    const trimmed = line.trimEnd();

    if (!trimmed.trim()) {
      flushParagraph();
      resetList();
      continue;
    }

    const bulletMatch = /^(\s*)- (.+)$/.exec(trimmed);
    if (bulletMatch) {
      flushParagraph();

      const depth = Math.floor(bulletMatch[1].length / 2);
      if (bulletMatch[1].length % 2 !== 0) {
        throw new Error("Bullet indentation must use multiples of two spaces.");
      }
      if (depth > 2) {
        throw new Error("Bullets support up to three layers only.");
      }

      if (!currentList) {
        currentList = [];
        blocks.push({ type: "list", items: currentList });
      }

      const item: ListItemNode = {
        text: bulletMatch[2].trim(),
        children: [],
      };

      if (depth === 0) {
        currentList.push(item);
      } else {
        const parent = lastItemsByDepth[depth - 1];
        if (!parent) {
          throw new Error("Nested bullets must start one level deeper than an existing bullet.");
        }
        parent.children.push(item);
      }

      lastItemsByDepth[depth] = item;
      lastItemsByDepth.length = depth + 1;
      continue;
    }

    resetList();
    paragraphLines.push(trimmed.trim());
  }

  flushParagraph();
  return blocks;
}

function parseDeck(source: string): Deck {
  const raw = load(source);

  if (!isPlainObject(raw)) {
    throw new Error("Top-level YAML must be a mapping.");
  }

  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : "Untitled deck";
  if (!Array.isArray(raw.slides) || raw.slides.length === 0) {
    throw new Error("Deck must contain a non-empty slides array.");
  }

  const slides = raw.slides.map((entry, index) => parseSlide(entry, index));
  return { title, slides };
}

function parseSlide(entry: unknown, index: number): Slide {
  if (!isPlainObject(entry)) {
    throw new Error(`Slide ${index + 1} must be a mapping.`);
  }

  const layout = entry.layout === "split" ? "split" : "single";
  const title = typeof entry.title === "string" ? entry.title : undefined;

  if (layout === "split") {
    if (typeof entry.left !== "string" || typeof entry.right !== "string") {
      throw new Error(`Slide ${index + 1} uses split layout and needs string left/right sections.`);
    }
    return {
      title,
      layout,
      left: entry.left,
      right: entry.right,
    };
  }

  if (typeof entry.body !== "string") {
    throw new Error(`Slide ${index + 1} needs a string body.`);
  }

  return {
    title,
    layout,
    body: entry.body,
  };
}

async function updateShareUrl() {
  const encoded = await encodeDeck(yamlInput.value);
  const url = new URL(window.location.href);
  url.searchParams.set("deck", encoded);
  url.searchParams.set("slide", String(currentSlideIndex + 1));
  shareUrl = url.toString();
  history.replaceState(null, "", url);
  urlSize.textContent = `${shareUrl.length.toLocaleString()} chars`;
}

async function encodeDeck(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const compressed = await compressBytes(bytes);
  return toBase64Url(compressed);
}

async function decodeDeck(encoded: string): Promise<string> {
  const compressed = fromBase64Url(encoded);
  const bytes = await decompressBytes(compressed);
  return new TextDecoder().decode(bytes);
}

async function compressBytes(input: Uint8Array): Promise<Uint8Array> {
  if (!("CompressionStream" in window)) {
    throw new Error("This browser does not support CompressionStream.");
  }

  const stream = new CompressionStream("gzip");
  const writer = stream.writable.getWriter();
  await writer.write(input);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function decompressBytes(input: Uint8Array): Promise<Uint8Array> {
  if (!("DecompressionStream" in window)) {
    throw new Error("This browser does not support DecompressionStream.");
  }

  const stream = new DecompressionStream("gzip");
  const writer = stream.writable.getWriter();
  await writer.write(input);
  await writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

function moveSlide(delta: number) {
  if (!currentDeck) {
    return;
  }
  const nextIndex = clampSlideIndex(currentSlideIndex + delta, currentDeck.slides.length - 1);
  if (nextIndex === currentSlideIndex) {
    return;
  }
  currentSlideIndex = nextIndex;
  renderDeck(currentDeck);
  void updateShareUrl();
}

function clampSlideIndex(index: number, max: number) {
  if (!Number.isFinite(index)) {
    return 0;
  }
  return Math.min(Math.max(index, 0), Math.max(max, 0));
}

function setStatus(message: string, isError: boolean) {
  statusText.textContent = message;
  statusText.classList.toggle("error-text", isError);
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function fromBase64Url(input: string) {
  const padded = input.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    output[index] = binary.charCodeAt(index);
  }
  return output;
}
