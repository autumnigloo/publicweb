import "./styles.css";
import { gzipSync, gunzipSync } from "fflate";
import { load } from "js-yaml";
import { jsPDF } from "jspdf";

type SlideLayout = "single" | "split";

interface Deck {
  title: string;
  headerScale: number;
  contentScale: number;
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

const SAMPLE_YAML = `# Deck title shown above the slide preview
title: Product Story

# Optional multipliers for slide text sizing
header_scale: 1.0
content_scale: 1.0

slides:
  - title: YAML Slides
    body: |
      Edit this YAML and the full deck is kept in the URL as ?x=...

      - Use normal paragraphs
      - Add **bold** and *italic*
      - Write bullet lists
        - With a second layer
          - And a third layer

  - title: Split Layout
    layout: split
    left: |
      Add layout: split to divide a slide into two columns.

      - Put one outline on the left
      - Keep the structure simple
    right: |
      Put supporting text on the right.

      You can also change:

      - header_scale
      - content_scale

  - title: Title Only

  - title: Closing
    body: |
      If a slide has too much text, the extra content clips off the slide instead of changing its size.
`;
const SPLIT_STORAGE_KEY = "yaml-slides-split-v1";
const DEFAULT_EDITOR_FRACTION = 0.38;

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
      </div>
      <textarea id="yaml-input" spellcheck="false"></textarea>
      <div class="status-row">
        <span id="status-text"></span>
        <span id="url-size"></span>
      </div>
    </section>
    <div id="panel-divider" class="panel-divider" role="separator" aria-orientation="vertical" aria-label="Resize editor and preview"></div>
    <section class="preview-panel panel">
      <div class="preview-head">
        <div>
          <h2 id="deck-title"></h2>
        </div>
        <div class="nav-group">
          <button id="export-pdf">Export PDF</button>
          <button id="fullscreen-toggle">Fullscreen</button>
          <button id="prev-slide">Prev</button>
          <span id="slide-count"></span>
          <button id="next-slide">Next</button>
        </div>
      </div>
      <div id="slide-viewport" class="slide-viewport">
        <article id="slide-frame" class="slide-frame"></article>
      </div>
      <p class="hint keyboard-hint">Arrow keys move between slides when the editor is not focused.</p>
    </section>
  </main>
`;

const yamlInput = document.querySelector<HTMLTextAreaElement>("#yaml-input")!;
const statusText = document.querySelector<HTMLSpanElement>("#status-text")!;
const urlSize = document.querySelector<HTMLSpanElement>("#url-size")!;
const page = document.querySelector<HTMLElement>(".page")!;
const divider = document.querySelector<HTMLDivElement>("#panel-divider")!;
const deckTitle = document.querySelector<HTMLHeadingElement>("#deck-title")!;
const slideCount = document.querySelector<HTMLSpanElement>("#slide-count")!;
const slideViewport = document.querySelector<HTMLDivElement>("#slide-viewport")!;
const slideFrame = document.querySelector<HTMLElement>("#slide-frame")!;
const prevSlideButton = document.querySelector<HTMLButtonElement>("#prev-slide")!;
const nextSlideButton = document.querySelector<HTMLButtonElement>("#next-slide")!;
const exportPdfButton = document.querySelector<HTMLButtonElement>("#export-pdf")!;
const fullscreenButton = document.querySelector<HTMLButtonElement>("#fullscreen-toggle")!;
const previewPanel = document.querySelector<HTMLElement>(".preview-panel")!;

let currentDeck: Deck | null = null;
let currentSlideIndex = 0;
let shareUrl = window.location.href;
let shareTimer = 0;
let statusClearTimer = 0;
let editorFraction = loadSplitFraction();
let resizeSlideViewport = () => {};

void init();

async function init() {
  const params = new URLSearchParams(window.location.search);
  const encodedDeck = params.get("x") ?? params.get("deck");
  const initialSlide = clampSlideIndex(Number(params.get("s") ?? params.get("slide") ?? "1") - 1, 0);

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
  applyEditorFraction(editorFraction);
  updateFullscreenButton();
  bindSlideViewportSizing();
  void refreshFromEditor();
}

function bindEvents() {
  yamlInput.addEventListener("input", () => {
    void updateShareUrlForCurrentState();
    window.clearTimeout(shareTimer);
    shareTimer = window.setTimeout(() => {
      void refreshFromEditor();
    }, 180);
  });

  yamlInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }

    const selectionStart = yamlInput.selectionStart;
    const selectionEnd = yamlInput.selectionEnd;
    const lineStart = yamlInput.value.lastIndexOf("\n", selectionStart - 1) + 1;
    const line = yamlInput.value.slice(lineStart, selectionStart);
    const indent = (/^[ \t]*/.exec(line) ?? [""])[0];

    event.preventDefault();
    yamlInput.setRangeText(`\n${indent}`, selectionStart, selectionEnd, "end");
    void updateShareUrlForCurrentState();
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

  exportPdfButton.addEventListener("click", async () => {
    await exportDeckAsPdf();
  });

  fullscreenButton.addEventListener("click", async () => {
    await toggleFullscreen();
  });

  document.addEventListener("fullscreenchange", () => {
    updateFullscreenButton();
    window.requestAnimationFrame(() => {
      resizeSlideViewport();
    });
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

  divider.addEventListener("pointerdown", (event) => {
    if (window.innerWidth <= 980) {
      return;
    }
    event.preventDefault();
    divider.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-panels");
  });

  divider.addEventListener("pointermove", (event) => {
    if (!divider.hasPointerCapture(event.pointerId) || window.innerWidth <= 980) {
      return;
    }
    const nextFraction = clampEditorFraction(event.clientX / window.innerWidth);
    applyEditorFraction(nextFraction);
  });

  const releaseResize = (event: PointerEvent) => {
    if (!divider.hasPointerCapture(event.pointerId)) {
      return;
    }
    divider.releasePointerCapture(event.pointerId);
    document.body.classList.remove("resizing-panels");
    saveSplitFraction(editorFraction);
  };

  divider.addEventListener("pointerup", releaseResize);
  divider.addEventListener("pointercancel", releaseResize);
}

async function refreshFromEditor() {
  await updateShareUrlForCurrentState();
  try {
    const parsed = parseDeck(yamlInput.value);
    currentDeck = parsed;
    currentSlideIndex = clampSlideIndex(currentSlideIndex, parsed.slides.length - 1);
    renderDeck(parsed);
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
  exportPdfButton.disabled = false;
  slideFrame.style.setProperty("--header-scale", String(deck.headerScale));
  slideFrame.style.setProperty("--content-scale", String(deck.contentScale));

  const slide = deck.slides[currentSlideIndex];
  const hasBodyContent =
    slide.layout === "split"
      ? Boolean((slide.left ?? "").trim() || (slide.right ?? "").trim())
      : Boolean((slide.body ?? "").trim());
  slideFrame.className = `slide-frame ${slide.layout === "split" ? "split" : "single"}${!hasBodyContent ? " title-only" : ""}`;
  slideFrame.replaceChildren();

  if (slide.title?.trim()) {
    const title = document.createElement("header");
    title.className = "slide-title";

    const titleText = document.createElement("h3");
    titleText.textContent = slide.title;
    title.appendChild(titleText);
    slideFrame.appendChild(title);
  }

  if (hasBodyContent) {
    const body = document.createElement("section");
    body.className = "slide-body";

    if (slide.layout === "split") {
      body.classList.add("split-body");
      body.appendChild(buildContentColumn(slide.left ?? ""));
      body.appendChild(buildContentColumn(slide.right ?? ""));
    } else {
      body.appendChild(buildContentColumn(slide.body ?? ""));
    }

    slideFrame.appendChild(body);
  }
}

function renderError(message: string) {
  deckTitle.textContent = "Preview unavailable";
  slideCount.textContent = "--";
  prevSlideButton.disabled = true;
  nextSlideButton.disabled = true;
  exportPdfButton.disabled = true;
  slideFrame.className = "slide-frame error";
  slideFrame.innerHTML = `
    <div class="error-card">
      <h3>YAML error</h3>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function buildContentColumn(source: string) {
  const column = document.createElement("div");
  column.className = "content-column";

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
  const headerScale = parseScale(raw.header_scale, 1);
  const contentScale = parseScale(raw.content_scale, 1);
  if (!Array.isArray(raw.slides) || raw.slides.length === 0) {
    throw new Error("Deck must contain a non-empty slides array.");
  }

  const slides = raw.slides.map((entry, index) => parseSlide(entry, index));
  return { title, headerScale, contentScale, slides };
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

  if (entry.body != null && typeof entry.body !== "string") {
    throw new Error(`Slide ${index + 1} needs a string body when body is present.`);
  }

  return {
    title,
    layout,
    body: typeof entry.body === "string" ? entry.body : "",
  };
}

async function buildShareUrl(source: string, slideIndex: number) {
  const encoded = await encodeDeck(source);
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set("x", encoded);
  url.searchParams.set("s", String(slideIndex + 1));
  return url.toString();
}

function syncBrowserUrl(urlText: string) {
  const url = new URL(urlText);
  history.replaceState(null, "", url);
}

function updateUrlSize() {
  urlSize.textContent = `${shareUrl.length.toLocaleString()} chars`;
}

async function encodeDeck(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const compressed = gzipSync(bytes);
  return toBase64Url(compressed);
}

async function decodeDeck(encoded: string): Promise<string> {
  const compressed = fromBase64Url(encoded);
  const bytes = gunzipSync(compressed);
  return new TextDecoder().decode(bytes);
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
  void updateShareUrlForCurrentState();
}

function clampSlideIndex(index: number, max: number) {
  if (!Number.isFinite(index)) {
    return 0;
  }
  return Math.min(Math.max(index, 0), Math.max(max, 0));
}

function setStatus(message: string, isError: boolean) {
  window.clearTimeout(statusClearTimer);
  statusText.textContent = message;
  statusText.classList.toggle("error-text", isError);
}

function setTemporaryStatus(message: string, isError: boolean, durationMs: number) {
  setStatus(message, isError);
  statusClearTimer = window.setTimeout(() => {
    statusText.textContent = "";
    statusText.classList.remove("error-text");
  }, durationMs);
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

async function updateShareUrlForCurrentState() {
  shareUrl = await buildShareUrl(yamlInput.value, currentSlideIndex);
  syncBrowserUrl(shareUrl);
  updateUrlSize();
}

async function toggleFullscreen() {
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }

  await slideViewport.requestFullscreen();
}

function updateFullscreenButton() {
  fullscreenButton.textContent = document.fullscreenElement === slideViewport ? "Exit Fullscreen" : "Fullscreen";
}

async function exportDeckAsPdf() {
  if (!currentDeck) {
    setStatus("Fix YAML errors before exporting PDF.", true);
    return;
  }

  const pdf = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: [960, 540],
    compress: true,
  });

  currentDeck.slides.forEach((slide, index) => {
    if (index > 0) {
      pdf.addPage([960, 540], "landscape");
    }
    renderSlideToPdf(pdf, currentDeck, slide);
  });

  pdf.save(makePdfFilename(currentDeck.title));
  setTemporaryStatus("PDF downloaded.", false, 3000);
}

function renderSlideToPdf(pdf: jsPDF, deck: Deck, slide: Slide) {
  const pageWidth = 960;
  const pageHeight = 540;
  const pad = 28;
  const contentWidth = pageWidth - pad * 2;
  const contentHeight = pageHeight - pad * 2;
  const titleSize = 50.22 * deck.headerScale;
  const bodySize = 16.2 * deck.contentScale;
  const titleGap = 18;
  const columnGap = 24;
  const hasBodyContent =
    slide.layout === "split"
      ? Boolean((slide.left ?? "").trim() || (slide.right ?? "").trim())
      : Boolean((slide.body ?? "").trim());

  pdf.setFillColor(252, 248, 241);
  pdf.rect(0, 0, pageWidth, pageHeight, "F");
  pdf.setTextColor(37, 26, 18);

  if (!hasBodyContent) {
    if (slide.title?.trim()) {
      pdf.setFont("times", "bold");
      pdf.setFontSize(titleSize);
      pdf.text(stripInlineMarkup(slide.title), pageWidth / 2, pageHeight / 2, {
        align: "center",
        baseline: "middle",
        maxWidth: contentWidth,
      });
    }
    return;
  }

  let top = pad;
  if (slide.title?.trim()) {
    pdf.setFont("times", "bold");
    pdf.setFontSize(titleSize);
    const titleLines = pdf.splitTextToSize(stripInlineMarkup(slide.title), contentWidth);
    pdf.text(titleLines, pad, top + titleSize * 0.85);
    top += titleLines.length * titleSize * 0.95 + titleGap;
  }

  const bodyTop = top;
  const bodyBottom = pad + contentHeight;

  if (slide.layout === "split") {
    const columnWidth = (contentWidth - columnGap) / 2;
    drawContentBlocksToPdf(pdf, parseRichText(slide.left ?? ""), pad, bodyTop, columnWidth, bodyBottom, bodySize);
    drawContentBlocksToPdf(
      pdf,
      parseRichText(slide.right ?? ""),
      pad + columnWidth + columnGap,
      bodyTop,
      columnWidth,
      bodyBottom,
      bodySize,
    );
    return;
  }

  drawContentBlocksToPdf(pdf, parseRichText(slide.body ?? ""), pad, bodyTop, contentWidth, bodyBottom, bodySize);
}

function drawContentBlocksToPdf(
  pdf: jsPDF,
  blocks: ContentBlock[],
  left: number,
  top: number,
  width: number,
  bottom: number,
  fontSize: number,
) {
  let y = top;
  const paragraphGap = fontSize * 0.9;

  pdf.setFont("times", "normal");
  pdf.setFontSize(fontSize);

  for (const block of blocks) {
    if (y >= bottom) {
      break;
    }

    if (block.type === "paragraph") {
      y = drawWrappedText(pdf, stripInlineMarkup(block.text), left, y, width, bottom, fontSize);
      y += paragraphGap;
      continue;
    }

    y = drawPdfList(pdf, block.items, left, y, width, bottom, fontSize, 0);
    y += paragraphGap * 0.6;
  }
}

function drawPdfList(
  pdf: jsPDF,
  items: ListItemNode[],
  left: number,
  top: number,
  width: number,
  bottom: number,
  fontSize: number,
  depth: number,
) {
  let y = top;
  const indent = fontSize * 1.1;
  const bulletPad = fontSize * 0.7;

  for (const item of items) {
    if (y >= bottom) {
      break;
    }

    const currentLeft = left + depth * indent;
    const bullet = depth % 2 === 0 ? "\u2022" : "\u25E6";
    pdf.text(bullet, currentLeft, y + fontSize * 0.82);
    y = drawWrappedText(
      pdf,
      stripInlineMarkup(item.text),
      currentLeft + bulletPad,
      y,
      width - depth * indent - bulletPad,
      bottom,
      fontSize * Math.max(0.88, 1 - depth * 0.06),
    );
    y += fontSize * 0.35;

    if (item.children.length) {
      y = drawPdfList(pdf, item.children, left, y, width, bottom, fontSize, depth + 1);
    }
  }

  return y;
}

function drawWrappedText(
  pdf: jsPDF,
  text: string,
  left: number,
  top: number,
  width: number,
  bottom: number,
  fontSize: number,
) {
  pdf.setFontSize(fontSize);
  const lines = pdf.splitTextToSize(text, Math.max(width, fontSize * 4));
  const lineHeight = fontSize * 1.3;
  const maxLines = Math.max(0, Math.floor((bottom - top) / lineHeight));

  for (const line of lines.slice(0, maxLines)) {
    pdf.text(line, left, top + fontSize * 0.82);
    top += lineHeight;
  }

  return top;
}

function stripInlineMarkup(text: string) {
  return text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");
}

function makePdfFilename(title: string) {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `${slug || "slides"}.pdf`;
}

function bindSlideViewportSizing() {
  resizeSlideViewport = () => {
    const width = slideViewport.clientWidth;
    const height = slideViewport.clientHeight;
    if (!width || !height) {
      return;
    }

    const nextWidth = Math.min(width, height * (16 / 9));
    const nextHeight = nextWidth / (16 / 9);

    slideFrame.style.width = `${nextWidth}px`;
    slideFrame.style.height = `${nextHeight}px`;
    slideFrame.style.setProperty("--stage-height-px", `${nextHeight}px`);
  };

  const observer = new ResizeObserver(() => {
    resizeSlideViewport();
  });
  observer.observe(slideViewport);
  window.addEventListener("resize", resizeSlideViewport);
  resizeSlideViewport();
}

function parseScale(value: unknown, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function applyEditorFraction(fraction: number) {
  editorFraction = clampEditorFraction(fraction);
  page.style.setProperty("--editor-fr", editorFraction.toFixed(4));
}

function clampEditorFraction(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_EDITOR_FRACTION;
  }
  return Math.min(Math.max(value, 0.22), 0.78);
}

function loadSplitFraction() {
  try {
    const raw = localStorage.getItem(SPLIT_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_EDITOR_FRACTION;
    }
    return clampEditorFraction(Number(raw));
  } catch {
    return DEFAULT_EDITOR_FRACTION;
  }
}

function saveSplitFraction(fraction: number) {
  try {
    localStorage.setItem(SPLIT_STORAGE_KEY, String(clampEditorFraction(fraction)));
  } catch {
    // Ignore storage failures.
  }
}
