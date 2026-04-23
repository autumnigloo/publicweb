/* -------------------------------------------------------------------------- */
/*                                 Constants                                  */
/* -------------------------------------------------------------------------- */
const MARKER_A = "🅰️";
const MARKER_B = "🅱️";
const MAX_HISTORY = 50;
const INACTIVITY_TIMEOUT_MS = 3 * 60 * 1000;

const DEFAULT_SYSTEM_PROMPT = `You are a helpful text editing assistant.
The user will provide the full document text with two cursor markers:
🅰️ (start of selection/cursor) and 🅱️ (end of selection/cursor).
If 🅰️ and 🅱️ are adjacent, it represents a caret position with no selection.
If they surround text, that text is currently selected.

Your task is to follow the user's instruction and return the COMPLETE modified document text.
You MUST include the 🅰️ and 🅱️ markers in your response to indicate where the cursor should be placed after the edit.
Place 🅰️ at the start of the cursor position and 🅱️ at the end (they can be adjacent for a simple caret, or surround text for a selection).

Do not include any explanations or markdown formatting unless requested.
Return ONLY the full modified document with cursor markers.

Examples:
- Input: "Hello 🅰️🅱️world" with instruction "insert 'beautiful '"
  Output: "Hello beautiful 🅰️🅱️world"
- Input: "Hello 🅰️world🅱️" with instruction "replace selection with 'universe'"
  Output: "Hello 🅰️universe🅱️"
- Input: "Hello 🅰️world🅱️" with instruction "delete selection"
  Output: "Hello 🅰️🅱️"

USER_INSTRUCTION:
`;

const DEFAULT_COMMAND_CONFIG = String.raw`1. Commands (start with #)
process|amsterdam=#process
execute=#execute
undo=#undo
redo=#redo
stop=#stop
discard|this card=#discard
copy=#copy
cut=#cut
paste=#paste
uppercase=#uppercase
lowercase=#lowercase
capitalize=#capitalize

2. Substitutions (use \n for newline)
number (zero|0)=0
number (one|1)=1
number (two|2)=2
number (three|3)=3
number (four|4)=4
number (five|5)=5
number (six|6)=6
number (seven|7)=7
number (eight|8)=8
number (nine|9)=9
plus=+
minus|dash=-
period|full stop=.
colon=:
semicolon=;
exclamation mark=!
question mark=?
comma=,
new line|enter|new paragraph=\n
(smile|smiling|smiley|happy) emoji=😊
heart emoji=❤️
laughing emoji=😂
crying emoji=😭
(like|thumbs up) emoji=👍
dislike emoji=👎
angry emoji=😠
sad emoji=😢
(open|left) (parenthesis|parents)=(
(close|right) (parenthesis|parents)=)
(open|left) bracket=[
(close|right) bracket=]
(open|left) brace={
(close|right) brace=}
double quote="
single quote='
backtick=\`
tilde=~
at sign=@
hashtag|hash|#=#
ampersand|and sign=&
asterisk|star=*
caret=^
underscore=_
pipe|vertical bar=|
backslash=\
forward slash=/
first|1st=1. 
second|2nd=2. 
third|3rd=3. 
fourth|4th=4. 
fifth|5th=5. 
sixth|6th=6. 
seventh|7th=7. 
eighth|8th=8. 
ninth|9th=9.
lower (alfa|alpha)=a
lower bravo=b
lower charlie=c
lower delta=d
lower echo=e
lower (foxtrot|fox trot)=f
lower golf=g
lower hotel=h
lower india=i
lower (juliet|juliett)=j
lower kilo=k
lower lima=l
lower mike=m
lower november=n
lower oscar=o
lower papa=p
lower (quebec|kebec)=q
lower romeo=r
lower sierra=s
lower tango=t
lower uniform=u
lower (victor|viktor)=v
lower (whiskey|whisky)=w
lower (x-ray|xray|x ray)=x
lower yankee=y
lower zulu=z
(alfa|alpha)=A
bravo=B
charlie=C
delta=D
echo=E
(foxtrot|fox trot)=F
golf=G
hotel=H
india=I
(juliet|juliett)=J
kilo=K
lima=L
mike=M
november=N
oscar=O
papa=P
(quebec|kebec)=Q
romeo=R
sierra=S
tango=T
uniform=U
(victor|viktor)=V
(whiskey|whisky)=W
(x-ray|xray|x ray)=X
yankee=Y
zulu=Z

3. Regex Operations (trigger=match_regex:::replacement)
select all=^([\s\S]*)🅰️([\s\S]*?)🅱️([\s\S]*)$:::🅰️$1$2$3🅱️
select word=(^|[\s\S]*?)(\S*?)🅰️([\s\S]*?)🅱️(\S*)([\s\S]*|$):::$1🅰️$2$3$4🅱️$5
select line=(^|[\s\S]*\n)([^\n]*)🅰️([\s\S]*?)🅱️([^\n]*)(\n[\s\S]*|$):::$1🅰️$2$3$4🅱️$5
select sentence=(^|[\s\S]*?[.!?\n]\s*)([^.!?\n]*)🅰️([\s\S]*?)🅱️([^.!?\n]*)([.!?\n]|$):::$1🅰️$2$3$4$5🅱️
space=🅰️[\s\S]*?🅱️::: 🅰️🅱️
backspace=[\s\S]?🅰️[\s\S]*?🅱️:::🅰️🅱️
delete=(\S+\s*)?🅰️[\s\S]*?🅱️:::🅰️🅱️
sentence delete=[^.!?\n]+[.!?\n]*\s*🅰️[\s\S]*?🅱️:::🅰️🅱️
line delete=(^|[\s\S]*\n)([^\n]*)🅰️([\s\S]*?)🅱️([^\n]*)(\n|$)([\s\S]*):::$1🅰️🅱️$6
next delete=🅰️([\s\S]*?)🅱️\s*\S+:::🅰️🅱️
selection delete=🅰️[\s\S]*?🅱️:::🅰️🅱️
clear all=[\s\S]*:::🅰️🅱️
clear space=[ \t]*🅰️([\s\S]*?)🅱️[ \t]*:::🅰️$1🅱️
(move|go) left=([\s\S])🅰️([\s\S]*?)🅱️:::🅰️🅱️$1$2
(move|go) right=🅰️([\s\S]*?)🅱️([\s\S]):::$1$2🅰️🅱️
(move|go) to start( of line)?=(^|[\s\S]*\n)([^\n]*)🅰️([\s\S]*?)🅱️([\s\S]*):::$1🅰️🅱️$2$3$4
(move|go) to end( of line)?=(^|[\s\S]*\n)([^\n]*)🅰️([\s\S]*?)🅱️([^\n]*)([\s\S]*):::$1$2$3$4🅰️🅱️$5
boldify|(make )?bold=🅰️([\s\S]*?)🅱️:::🅰️**$1**🅱️
italicize|(make )?italic=🅰️([\s\S]*?)🅱️:::🅰️*$1*🅱️
underline=🅰️([\s\S]*?)🅱️:::🅰️<u>$1</u>🅱️
strikethrough|strike=🅰️([\s\S]*?)🅱️:::🅰️~~$1~~🅱️
code|inline code=🅰️([\s\S]*?)🅱️:::🅰️\`$1\`🅱️
parenthesize=🅰️([\s\S]*?)🅱️:::🅰️($1)🅱️
bracketize=🅰️([\s\S]*?)🅱️:::🅰️[$1]🅱️
quote|quotify=🅰️([\s\S]*?)🅱️:::🅰️"$1"🅱️
bullet=\n?🅰️([\s\S]*?)🅱️:::\n- 🅰️🅱️
`;

/* -------------------------------------------------------------------------- */
/*                                DOM Elements                                */
/* -------------------------------------------------------------------------- */
const toggleButton = document.getElementById("toggleButton");
const processButton = document.getElementById("processButton");
const discardButton = document.getElementById("discardButton");
const executeButton = document.getElementById("executeButton");
const copyAllButton = document.getElementById("copyAllButton");
const settingsButton = document.getElementById("settingsButton");
const undoButton = document.getElementById("undoButton");
const redoButton = document.getElementById("redoButton");
const textBox = document.getElementById("textBox");
const previewSection = document.getElementById("previewSection");
const previewBox = document.getElementById("previewBox");
const toast = document.getElementById("toast");
const logBox = document.getElementById("logBox");
const sidebar = document.getElementById("sidebar");
const groqApiKeyInput = document.getElementById("groqApiKeyInput");
const geminiApiKeyInput = document.getElementById("geminiApiKeyInput");
const geminiSystemPromptInput = document.getElementById("geminiSystemPromptInput");
const geminiModelSelect = document.getElementById("geminiModelSelect");
const saveConfigButton = document.getElementById("saveConfigButton");
const commandsEnabledCheckbox = document.getElementById("commandsEnabledCheckbox");
const commandsConfigInput = document.getElementById("commandsConfigInput");
const commandsConfigSection = document.getElementById("commandsConfigSection");

/* -------------------------------------------------------------------------- */
/*                               Global State                                 */
/* -------------------------------------------------------------------------- */
let historyStack = [];
let historyIndex = -1;
let isRecording = false;
let mediaRecorder = null;
let currentAudioChunks = [];
let committedAudioBlobs = [];
let globalStream = null;
let groqApiKey = "";
let geminiApiKey = "";
let geminiModel = "gemini-2.5-flash-lite";
let geminiSystemPrompt = DEFAULT_SYSTEM_PROMPT;
let commandsEnabled = true;
let commandRules = [];
let isProcessing = false;
let inactivityTimer;
let savedSelection = { start: 0, end: 0 };
let toastTimer = null;
let recognition = null;
let recognitionRunning = false;
let suppressRecognitionRestart = false;
let localTranscript = "";
let ctrlShortcutPending = false;
let ctrlShortcutUsedWithOtherKey = false;
let segmentRotationInFlight = false;
let previewStableText = "";

/* -------------------------------------------------------------------------- */
/*                           Configuration / Persistence                      */
/* -------------------------------------------------------------------------- */
function loadConfig() {
  const groqKey = localStorage.getItem("webspeech_groq_key");
  if (groqKey) {
    groqApiKeyInput.value = groqKey;
    groqApiKey = groqKey;
  }

  const geminiKey = localStorage.getItem("webspeech_gemini_key");
  if (geminiKey) {
    geminiApiKeyInput.value = geminiKey;
    geminiApiKey = geminiKey;
  }

  const model = localStorage.getItem("webspeech_gemini_model");
  if (model) {
    geminiModelSelect.value = model;
    geminiModel = model;
  }

  const prompt = localStorage.getItem("webspeech_gemini_prompt");
  geminiSystemPromptInput.value = prompt || DEFAULT_SYSTEM_PROMPT;
  geminiSystemPrompt = geminiSystemPromptInput.value;

  const savedCommandsEnabled = localStorage.getItem("webspeech_commands_enabled");
  commandsEnabled = savedCommandsEnabled !== "false";
  commandsEnabledCheckbox.checked = commandsEnabled;

  const savedCommandConfig = localStorage.getItem("webspeech_command_config");
  commandsConfigInput.value = savedCommandConfig || DEFAULT_COMMAND_CONFIG;
  parseCommandConfig(commandsConfigInput.value);
  syncCommandsUi();
}

function saveConfig() {
  groqApiKey = groqApiKeyInput.value.trim();
  geminiApiKey = geminiApiKeyInput.value.trim();
  geminiModel = geminiModelSelect.value;
  geminiSystemPrompt = geminiSystemPromptInput.value.trim() || DEFAULT_SYSTEM_PROMPT;
  commandsEnabled = commandsEnabledCheckbox.checked;

  localStorage.setItem("webspeech_groq_key", groqApiKey);
  localStorage.setItem("webspeech_gemini_key", geminiApiKey);
  localStorage.setItem("webspeech_gemini_model", geminiModel);
  localStorage.setItem("webspeech_gemini_prompt", geminiSystemPrompt);
  localStorage.setItem("webspeech_commands_enabled", String(commandsEnabled));
  localStorage.setItem("webspeech_command_config", commandsConfigInput.value);

  parseCommandConfig(commandsConfigInput.value);
  syncCommandsUi();
  showToast("Settings saved.", 2500);
}

function syncCommandsUi() {
  commandsConfigSection.style.display = commandsEnabled ? "" : "none";
  previewSection.classList.toggle("hidden", !commandsEnabled);
  if (!commandsEnabled) {
    clearPreview();
  }
}

saveConfigButton.addEventListener("click", saveConfig);
commandsEnabledCheckbox.addEventListener("change", () => {
  commandsEnabled = commandsEnabledCheckbox.checked;
  localStorage.setItem("webspeech_commands_enabled", String(commandsEnabled));
  syncCommandsUi();
});

/* -------------------------------------------------------------------------- */
/*                              Command Parsing                               */
/* -------------------------------------------------------------------------- */
function parseCommandConfig(text) {
  commandRules = [];
  let currentSection = 1;

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const leftTrimmed = line.replace(/^\s+/, "");
    const sectionMatch = trimmed.match(/^(\d+)\./);
    if (sectionMatch) {
      currentSection = Number(sectionMatch[1]);
      continue;
    }
    if (!trimmed || trimmed.startsWith("#") || !leftTrimmed.includes("=")) {
      continue;
    }

    if (currentSection === 3) {
      const [trigger, rest] = leftTrimmed.split("=", 2);
      if (!trigger || !rest || !rest.includes(":::")) {
        continue;
      }
      const [matchRegex, replacement] = rest.split(":::", 2);
      commandRules.push({
        type: 3,
        trigger: trigger.trim(),
        matchRegex,
        replacement,
      });
      continue;
    }

    const parts = leftTrimmed.split("=");
    if (parts.length < 2) {
      continue;
    }
    commandRules.push({
      type: currentSection,
      trigger: parts[0].trim(),
      replacement: parts.slice(1).join("="),
      isCommand: currentSection === 1,
    });
  }
}

function normalizeSpeechText(rawText) {
  return rawText.replace(/\s+/g, " ").trim();
}

function buildMatchCandidates(rawText) {
  const normalized = normalizeSpeechText(rawText);
  const stripped = normalized.replace(/[\s.,!?;:]+$/g, "").trim();
  return stripped && stripped !== normalized ? [normalized, stripped] : [normalized];
}

function getFullTriggerMatch(rawText) {
  const candidates = buildMatchCandidates(rawText);
  for (const candidate of candidates) {
    for (const rule of commandRules) {
      try {
        const regex = new RegExp(`^(${rule.trigger})$`, "i");
        if (regex.test(candidate)) {
          return rule;
        }
      } catch {
        // Ignore invalid user regex rules.
      }
    }
  }
  return null;
}

function getLeadingCommandMatch(rawText) {
  const candidates = buildMatchCandidates(rawText);
  for (const candidate of candidates) {
    for (const rule of commandRules) {
      if (!rule.isCommand || ["#process", "#execute", "#discard"].includes(rule.replacement)) {
        continue;
      }
      try {
        const regex = new RegExp(`^(${rule.trigger})(?:\\b|[\\s.,!?;:]|$)`, "i");
        if (regex.test(candidate)) {
          return rule;
        }
      } catch {
        // Ignore invalid user regex rules.
      }
    }
  }
  return null;
}

function getExactModeCommand(rawText) {
  const exactRule = getFullTriggerMatch(rawText);
  if (
    exactRule &&
    exactRule.isCommand &&
    ["#process", "#execute", "#discard"].includes(exactRule.replacement)
  ) {
    return exactRule.replacement;
  }
  return null;
}

function extractTrailingModeCommand(rawText) {
  if (!commandsEnabled) {
    return { text: normalizeSpeechText(rawText), mode: null };
  }

  let cleaned = normalizeSpeechText(rawText);
  let mode = null;
  const modeCommands = ["#process", "#execute", "#discard"];

  for (const rule of commandRules) {
    if (!rule.isCommand || !modeCommands.includes(rule.replacement)) {
      continue;
    }
    try {
      const regex = new RegExp(`(?:^|\\s)(${rule.trigger})[\\s.,!?;:]*$`, "i");
      if (regex.test(cleaned)) {
        mode = rule.replacement;
        cleaned = cleaned.replace(regex, "").trim();
        break;
      }
    } catch {
      // Ignore invalid user regex rules.
    }
  }

  return { text: cleaned, mode };
}

function collectRecognitionTranscript(results) {
  const parts = [];
  for (let i = 0; i < results.length; i += 1) {
    const part = results[i][0]?.transcript ?? "";
    const normalizedPart = normalizeSpeechText(part);
    if (normalizedPart) {
      parts.push(normalizedPart);
    }
  }
  return normalizeSpeechText(parts.join(" "));
}

function collectRecognitionChunk(event) {
  const parts = [];
  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    const part = normalizeSpeechText(event.results[i][0]?.transcript ?? "");
    if (part) {
      parts.push(part);
    }
  }
  return normalizeSpeechText(parts.join(" "));
}

function collectFinalRecognitionChunk(event) {
  const parts = [];
  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    if (!event.results[i].isFinal) {
      continue;
    }
    const part = normalizeSpeechText(event.results[i][0]?.transcript ?? "");
    if (part) {
      parts.push(part);
    }
  }
  return normalizeSpeechText(parts.join(" "));
}

function collectLatestFinalRecognitionChunk(event) {
  for (let i = event.results.length - 1; i >= event.resultIndex; i -= 1) {
    if (!event.results[i].isFinal) {
      continue;
    }
    return normalizeSpeechText(event.results[i][0]?.transcript ?? "");
  }
  return "";
}

function collectInterimRecognitionChunk(event) {
  const parts = [];
  for (let i = event.resultIndex; i < event.results.length; i += 1) {
    if (event.results[i].isFinal) {
      continue;
    }
    const part = normalizeSpeechText(event.results[i][0]?.transcript ?? "");
    if (part) {
      parts.push(part);
    }
  }
  return normalizeSpeechText(parts.join(" "));
}

function updatePreview(interim = "") {
  previewBox.value = normalizeSpeechText([previewStableText, interim].filter(Boolean).join(" "));
}

function clearPreview() {
  previewStableText = "";
  localTranscript = "";
  previewBox.value = "";
}

/* -------------------------------------------------------------------------- */
/*                               Toast Helper                                 */
/* -------------------------------------------------------------------------- */
function showToast(msg, durationMs = 5000) {
  clearTimeout(toastTimer);
  toast.textContent = msg;
  toast.classList.remove("hidden");
  toastTimer = setTimeout(hideToast, durationMs);

  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  logBox.value += (logBox.value ? "\n" : "") + `[${time}] ${msg}`;
  logBox.scrollTop = logBox.scrollHeight;
}

function hideToast() {
  clearTimeout(toastTimer);
  toast.classList.add("hidden");
}

toast.addEventListener("click", hideToast);

/* -------------------------------------------------------------------------- */
/*                             Textarea Helpers                               */
/* -------------------------------------------------------------------------- */
function getTextContent() {
  return textBox.value;
}

function setTextContent(value) {
  textBox.value = value;
}

function getCursorPosition() {
  return { start: textBox.selectionStart, end: textBox.selectionEnd };
}

function setCursorPosition(start, end = start) {
  textBox.selectionStart = start;
  textBox.selectionEnd = end;
  textBox.focus({ preventScroll: true });
}

/* -------------------------------------------------------------------------- */
/*                             History Management                             */
/* -------------------------------------------------------------------------- */
function pushSnapshot() {
  const val = getTextContent();
  const selection = { ...savedSelection };
  if (historyIndex < historyStack.length - 1) {
    historyStack = historyStack.slice(0, historyIndex + 1);
  }
  if (historyIndex >= 0 && historyStack[historyIndex].text === val) {
    historyStack[historyIndex].selection = selection;
    return;
  }
  historyStack.push({ text: val, selection });
  if (historyStack.length > MAX_HISTORY) {
    historyStack.shift();
  } else {
    historyIndex += 1;
  }
  localStorage.setItem("webspeech_content", val);
}

function undo() {
  if (historyIndex <= 0) {
    return;
  }
  historyIndex -= 1;
  const state = historyStack[historyIndex];
  setTextContent(state.text);
  savedSelection = { ...state.selection };
  setCursorPosition(savedSelection.start, savedSelection.end);
  localStorage.setItem("webspeech_content", state.text);
}

function redo() {
  if (historyIndex >= historyStack.length - 1) {
    return;
  }
  historyIndex += 1;
  const state = historyStack[historyIndex];
  setTextContent(state.text);
  savedSelection = { ...state.selection };
  setCursorPosition(savedSelection.start, savedSelection.end);
  localStorage.setItem("webspeech_content", state.text);
}

function restoreFromStorage() {
  const saved = localStorage.getItem("webspeech_content");
  if (saved) {
    setTextContent(saved);
  }
}

/* -------------------------------------------------------------------------- */
/*                          Local Text Manipulation                           */
/* -------------------------------------------------------------------------- */
function insertTextAtCursor(text, { transformCase = true } = {}) {
  pushSnapshot();
  let start = savedSelection.start;
  let end = savedSelection.end;
  const current = getTextContent();
  const before = current.slice(0, start).replace(/[ \t]+$/, "");
  const lastChar = before.length > 0 ? before[before.length - 1] : "";
  const atSentenceStart =
    before.length === 0 || [".", "!", "?", "\n"].includes(lastChar);

  let insert = text;
  if (transformCase) {
    const firstAlpha = insert.match(/[a-zA-Z]/);
    if (firstAlpha) {
      const i = firstAlpha.index;
      insert =
        insert.slice(0, i) +
        (atSentenceStart ? insert[i].toUpperCase() : insert[i].toLowerCase()) +
        insert.slice(i + 1);
    }
  }

  const processedInsert = insert.replace(/\\n/g, "\n");
  const needsSpace =
    processedInsert &&
    !processedInsert.startsWith("\n") &&
    lastChar &&
    !["\n", " "].includes(lastChar);
  const finalInsert = (needsSpace ? " " : "") + processedInsert;
  const newText = current.slice(0, start) + finalInsert + current.slice(end);
  setTextContent(newText);
  const newPos = start + finalInsert.length;
  setCursorPosition(newPos);
  savedSelection = getCursorPosition();
  pushSnapshot();
}

function applyTextTransform(transformer, emptyMessage) {
  const { start, end } = savedSelection;
  if (start === end) {
    showToast(emptyMessage, 2500);
    return;
  }
  pushSnapshot();
  const text = getTextContent();
  const selected = text.slice(start, end);
  const replaced = transformer(selected);
  setTextContent(text.slice(0, start) + replaced + text.slice(end));
  setCursorPosition(start, start + replaced.length);
  savedSelection = getCursorPosition();
  pushSnapshot();
}

async function copySelection() {
  const { start, end } = savedSelection;
  if (start === end) {
    return;
  }
  const selected = getTextContent().slice(start, end);
  try {
    await navigator.clipboard.writeText(selected);
  } catch {
    textBox.focus();
    setCursorPosition(start, end);
    document.execCommand("copy");
  }
  showToast("Copied selection.", 2500);
}

async function cutSelection() {
  const { start, end } = savedSelection;
  if (start === end) {
    return;
  }
  const text = getTextContent();
  const selected = text.slice(start, end);
  try {
    await navigator.clipboard.writeText(selected);
  } catch {
    textBox.focus();
    setCursorPosition(start, end);
    document.execCommand("cut");
    pushSnapshot();
    savedSelection = getCursorPosition();
    return;
  }
  pushSnapshot();
  setTextContent(text.slice(0, start) + text.slice(end));
  setCursorPosition(start);
  savedSelection = getCursorPosition();
  pushSnapshot();
  showToast("Cut selection.", 2500);
}

async function pasteFromClipboard() {
  try {
    const pasted = await navigator.clipboard.readText();
    insertTextAtCursor(pasted);
    showToast("Pasted from clipboard.", 2500);
  } catch (error) {
    console.error("Paste failed:", error);
    showToast("Paste failed. Check clipboard permissions.");
  }
}

function uppercaseSelection() {
  applyTextTransform((selected) => selected.toUpperCase(), "Nothing selected.");
}

function lowercaseSelection() {
  applyTextTransform((selected) => selected.toLowerCase(), "Nothing selected.");
}

function capitalizeSelection() {
  applyTextTransform(
    (selected) => selected.replace(/\b\w/g, (char) => char.toUpperCase()),
    "Nothing selected."
  );
}

function buildMarkedDocument() {
  const docText = getTextContent();
  const { start, end } = savedSelection;
  return (
    docText.slice(0, start) +
    MARKER_A +
    docText.slice(start, end) +
    MARKER_B +
    docText.slice(end)
  );
}

function applyMarkedDocument(raw) {
  pushSnapshot();
  const aIdx = raw.indexOf(MARKER_A);
  const bIdx = raw.indexOf(MARKER_B);
  const clean = raw.replaceAll(MARKER_A, "").replaceAll(MARKER_B, "");

  let newStart = clean.length;
  let newEnd = clean.length;
  if (aIdx !== -1 && bIdx !== -1) {
    newStart = aIdx;
    newEnd = bIdx > aIdx ? bIdx - MARKER_A.length : bIdx;
  }

  setTextContent(clean);
  setCursorPosition(newStart, newEnd);
  savedSelection = getCursorPosition();
  pushSnapshot();
}

const commandRegistry = {
  "#undo": () => undo(),
  "#redo": () => redo(),
  "#stop": () => stopRecording(),
  "#discard": () => showToast("Discard command ignored without live parsing.", 2500),
  "#copy": () => copySelection(),
  "#cut": () => cutSelection(),
  "#paste": () => pasteFromClipboard(),
  "#uppercase": () => uppercaseSelection(),
  "#lowercase": () => lowercaseSelection(),
  "#capitalize": () => capitalizeSelection(),
};

async function runTextProcessing(rawTextInput) {
  const rawText = rawTextInput ? rawTextInput.trim() : "";
  if (!rawText) {
    return false;
  }
  if (!commandsEnabled) {
    insertTextAtCursor(rawText);
    return true;
  }

  const matchedRule = getFullTriggerMatch(rawText);
  if (!matchedRule) {
    insertTextAtCursor(rawText);
    return true;
  }

  if (matchedRule.type === 1) {
    const command = commandRegistry[matchedRule.replacement];
    if (command) {
      await command();
      return true;
    }
    return false;
  }

  if (matchedRule.type === 2) {
    insertTextAtCursor(matchedRule.replacement, { transformCase: false });
    return true;
  }

  if (matchedRule.type === 3) {
    try {
      const opRegex = new RegExp(matchedRule.matchRegex, "gm");
      const replacement = matchedRule.replacement.replace(/\\n/g, "\n");
      const newMarkedText = buildMarkedDocument().replace(opRegex, replacement);
      applyMarkedDocument(newMarkedText);
      return true;
    } catch (error) {
      console.error("Regex op failed:", error);
      showToast("Regex command failed.");
      return false;
    }
  }

  return false;
}

async function handleRecognizedText(rawText, requestedMode) {
  const trimmed = rawText?.trim();
  if (!trimmed) {
    return;
  }

  showToast(trimmed, 3000);

  if (requestedMode === "execute") {
    await executeWithGemini(trimmed);
  } else {
    insertTextAtCursor(trimmed);
  }
}

/* -------------------------------------------------------------------------- */
/*                        Local Speech Recognition                            */
/* -------------------------------------------------------------------------- */
function setupRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    recognitionRunning = true;
  };

  recognition.onend = () => {
    recognitionRunning = false;
    if (isRecording && commandsEnabled && !suppressRecognitionRestart) {
      startRecognition();
    }
    suppressRecognitionRestart = false;
  };

  recognition.onerror = (event) => {
    if (event.error === "no-speech" || event.error === "aborted") {
      return;
    }
    console.error("Speech recognition error:", event.error);
  };

  recognition.onresult = async (event) => {
    if (!commandsEnabled) {
      return;
    }

    resetInactivityTimer();
    localTranscript = collectRecognitionTranscript(event.results);
    const finalizedChunk = collectFinalRecognitionChunk(event);
    const latestFinalChunk = collectLatestFinalRecognitionChunk(event);
    const interimChunk = collectInterimRecognitionChunk(event);
    updatePreview(interimChunk);

    const modeCommand = extractTrailingModeCommand(latestFinalChunk).mode;
    if (modeCommand === "#discard") {
      await discardCurrentSegment({ keepBufferedAudio: false });
      return;
    }
    if (modeCommand === "#process") {
      await discardCurrentSegment({ keepBufferedAudio: false });
      await processRecording();
      return;
    }
    if (modeCommand === "#execute") {
      await discardCurrentSegment({ keepBufferedAudio: false });
      await executeRecording();
      return;
    }

    const leadingCommand = latestFinalChunk ? getLeadingCommandMatch(latestFinalChunk) : null;
    if (leadingCommand) {
      await runTextProcessing(latestFinalChunk);
      await discardLocalRecognitionSegment();
      return;
    }

    const exactRule = latestFinalChunk ? getFullTriggerMatch(latestFinalChunk) : null;
    if (exactRule && exactRule.type !== 1) {
      await runTextProcessing(latestFinalChunk);
      await discardLocalRecognitionSegment();
      return;
    }

    if (finalizedChunk) {
      previewStableText = normalizeSpeechText(
        [previewStableText, finalizedChunk].filter(Boolean).join(" ")
      );
      updatePreview();
      await commitCurrentAudioSegment();
    }
  };
}

function startRecognition() {
  if (!recognition || !commandsEnabled || recognitionRunning) {
    return;
  }
  try {
    recognition.start();
  } catch {
    // Ignore repeated start attempts from browser state churn.
  }
}

function stopRecognition() {
  if (!recognition || !recognitionRunning) {
    return;
  }
  suppressRecognitionRestart = true;
  try {
    recognition.stop();
  } catch {
    // Ignore browser stop errors.
  }
}

async function restartRecognitionSession() {
  stopRecognition();
  localTranscript = "";
  previewBox.value = "";
  await waitForRecognitionStop();
  suppressRecognitionRestart = false;
  startRecognition();
}

async function waitForRecognitionStop() {
  if (!recognitionRunning) {
    return;
  }
  await new Promise((resolve) => {
    const onEnd = () => {
      recognition.removeEventListener("end", onEnd);
      resolve();
    };
    recognition.addEventListener("end", onEnd, { once: true });
  });
}

async function discardLocalRecognitionSegment() {
  clearPreview();
  await restartRecognitionSession();
  if (isRecording) {
    await finalizeSegment();
    currentAudioChunks = [];
    beginNewSegment();
  }
}

async function discardCurrentSegment({ keepBufferedAudio }) {
  const currentBlob = await finalizeSegment();
  if (keepBufferedAudio && currentBlob && committedAudioBlobs.length === 0) {
    committedAudioBlobs.push(currentBlob);
  }
  currentAudioChunks = [];
  localTranscript = "";
  await restartRecognitionSession();
  if (isRecording) {
    beginNewSegment();
  }
}

async function commitCurrentAudioSegment() {
  if (!isRecording || isProcessing || segmentRotationInFlight) {
    return;
  }
  segmentRotationInFlight = true;
  const currentBlob = await finalizeSegment();
  if (currentBlob) {
    committedAudioBlobs.push(currentBlob);
  }
  if (isRecording) {
    beginNewSegment();
  }
  segmentRotationInFlight = false;
}

/* -------------------------------------------------------------------------- */
/*                             Recording Logic                                */
/* -------------------------------------------------------------------------- */
function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  inactivityTimer = setTimeout(() => {
    if (isRecording) {
      stopRecording();
    }
  }, INACTIVITY_TIMEOUT_MS);
}

async function startRecording() {
  if (isRecording || isProcessing) {
    return;
  }
  try {
    if (!globalStream) {
      globalStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }
    currentAudioChunks = [];
    committedAudioBlobs = [];
    mediaRecorder = new MediaRecorder(globalStream);
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        currentAudioChunks.push(event.data);
      }
    };
    mediaRecorder.start();
    isRecording = true;
    toggleButton.textContent = "Stop";
    toggleButton.classList.add("recording");
    clearPreview();
    startRecognition();
    resetInactivityTimer();
  } catch (error) {
    console.error("Mic error:", error);
    showToast("Mic error — check permissions");
  }
}

function stopRecording() {
  return new Promise((resolve) => {
    clearTimeout(inactivityTimer);
    isRecording = false;
    toggleButton.textContent = "Start";
    toggleButton.classList.remove("recording");
    stopRecognition();
    clearPreview();

    const finish = () => {
      if (globalStream) {
        globalStream.getTracks().forEach((track) => track.stop());
        globalStream = null;
      }
      resolve();
    };

    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      finish();
      return;
    }
    mediaRecorder.onstop = finish;
    mediaRecorder.stop();
  });
}

function finalizeSegment() {
  return new Promise((resolve) => {
    if (!mediaRecorder || mediaRecorder.state === "inactive") {
      resolve(null);
      return;
    }
    mediaRecorder.onstop = () => {
      const blob =
        currentAudioChunks.length > 0
          ? new Blob(currentAudioChunks, { type: "audio/webm" })
          : null;
      currentAudioChunks = [];
      resolve(blob);
    };
    mediaRecorder.stop();
  });
}

function beginNewSegment() {
  if (!globalStream || !isRecording) {
    return;
  }
  currentAudioChunks = [];
  mediaRecorder = new MediaRecorder(globalStream);
  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      currentAudioChunks.push(event.data);
    }
  };
  mediaRecorder.start();
}

/* -------------------------------------------------------------------------- */
/*                              Groq Whisper                                  */
/* -------------------------------------------------------------------------- */
async function transcribeWithGroq(audioBlob) {
  if (!groqApiKey) {
    showToast("Error: Groq API key not set.");
    return null;
  }
  if (!audioBlob) {
    return null;
  }

  const formData = new FormData();
  formData.append("file", audioBlob, "recording.webm");
  formData.append("model", "whisper-large-v3-turbo");
  formData.append("prompt", "Transcribe this speech accurately with proper punctuation.");

  try {
    const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${groqApiKey}` },
      body: formData,
    });
    if (!response.ok) {
      throw new Error(`Groq ${response.status}: ${await response.text()}`);
    }
    const data = await response.json();
    return data.text || "";
  } catch (error) {
    console.error("Groq error:", error);
    showToast("Groq error: " + error.message);
    return null;
  }
}

async function collectBufferedAudio({ includeCurrentSegment }) {
  const currentBlob = await finalizeSegment();
  const blobs = [...committedAudioBlobs];
  if (includeCurrentSegment && currentBlob) {
    blobs.push(currentBlob);
  }
  committedAudioBlobs = [];
  currentAudioChunks = [];
  return blobs.length > 0 ? new Blob(blobs, { type: "audio/webm" }) : null;
}

/* -------------------------------------------------------------------------- */
/*                            Gemini Execution                                */
/* -------------------------------------------------------------------------- */
async function executeWithGemini(instruction) {
  if (!instruction?.trim()) {
    return;
  }
  if (!geminiApiKey) {
    showToast("Error: Gemini API key not set.");
    return;
  }

  const payload = {
    contents: [{ parts: [{ text: buildMarkedDocument() }] }],
    system_instruction: {
      parts: [{ text: geminiSystemPrompt + instruction.trim() }],
    },
  };

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );
    if (!response.ok) {
      throw new Error(`Gemini ${response.status}: ${await response.text()}`);
    }
    const data = await response.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) {
      throw new Error("Empty Gemini response");
    }
    applyMarkedDocument(raw);
  } catch (error) {
    console.error("Gemini error:", error);
    showToast("Gemini error: " + error.message);
  }
}

/* -------------------------------------------------------------------------- */
/*                        Discard / Process / Execute                         */
/* -------------------------------------------------------------------------- */
function discardRecording() {
  finalizeSegment().then(() => {
    currentAudioChunks = [];
    committedAudioBlobs = [];
    clearPreview();
    restartRecognitionSession();
    beginNewSegment();
  });
}

async function processRecording() {
  if (isProcessing) {
    return;
  }
  isProcessing = true;
  const text = await transcribeWithGroq(
    await collectBufferedAudio({ includeCurrentSegment: true })
  );
  if (text !== null) {
    await handleRecognizedText(text, "process");
  }

  isProcessing = false;
  clearPreview();
  beginNewSegment();
}

async function executeRecording() {
  if (isProcessing) {
    return;
  }
  isProcessing = true;
  const text = await transcribeWithGroq(
    await collectBufferedAudio({ includeCurrentSegment: true })
  );
  if (text !== null) {
    await handleRecognizedText(text, "execute");
  }

  isProcessing = false;
  clearPreview();
  beginNewSegment();
}

/* -------------------------------------------------------------------------- */
/*                            Copy & Clear                                    */
/* -------------------------------------------------------------------------- */
async function copyAndClear() {
  const text = getTextContent();
  if (!text.trim()) {
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    textBox.select();
    document.execCommand("copy");
  }
  pushSnapshot();
  setTextContent("");
  savedSelection = { start: 0, end: 0 };
  pushSnapshot();
}

/* -------------------------------------------------------------------------- */
/*                              Button Listeners                              */
/* -------------------------------------------------------------------------- */
toggleButton.addEventListener("click", () => {
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});

processButton.addEventListener("click", processRecording);
discardButton.addEventListener("click", discardRecording);
executeButton.addEventListener("click", executeRecording);
copyAllButton.addEventListener("click", copyAndClear);
undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);

/* -------------------------------------------------------------------------- */
/*                          Sidebar / Outside Click                           */
/* -------------------------------------------------------------------------- */
function toggleSidebar(event) {
  if (event) {
    event.stopPropagation();
  }
  const wasCollapsed = sidebar.classList.contains("collapsed");
  sidebar.classList.toggle("collapsed");
  localStorage.setItem("webspeech_sidebar_collapsed", String(!wasCollapsed));
}

settingsButton.addEventListener("click", toggleSidebar);

document.addEventListener("click", (event) => {
  if (window.innerWidth > 700) {
    return;
  }
  if (
    !sidebar.classList.contains("collapsed") &&
    !sidebar.contains(event.target) &&
    event.target !== settingsButton
  ) {
    sidebar.classList.add("collapsed");
    localStorage.setItem("webspeech_sidebar_collapsed", "true");
  }
});

/* -------------------------------------------------------------------------- */
/*                          Selection Tracking                                */
/* -------------------------------------------------------------------------- */
textBox.addEventListener("select", () => {
  savedSelection = getCursorPosition();
});

textBox.addEventListener("click", () => {
  savedSelection = getCursorPosition();
});

textBox.addEventListener("keyup", () => {
  savedSelection = getCursorPosition();
});

textBox.addEventListener("input", () => {
  savedSelection = getCursorPosition();
  clearTimeout(textBox._saveTimer);
  textBox._saveTimer = setTimeout(pushSnapshot, 1000);
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Control" && !event.repeat) {
    ctrlShortcutPending = true;
    ctrlShortcutUsedWithOtherKey = false;
  } else if (ctrlShortcutPending && event.key !== "Control") {
    ctrlShortcutUsedWithOtherKey = true;
  }
  if (event.key === "Escape" && isRecording) {
    event.preventDefault();
    stopRecording();
  }
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key === "z") {
    event.preventDefault();
    undo();
  }
  if (
    (event.ctrlKey || event.metaKey) &&
    ((event.shiftKey && event.key === "z") || event.key === "y")
  ) {
    event.preventDefault();
    redo();
  }
});

document.addEventListener("keyup", (event) => {
  if (event.key !== "Control") {
    return;
  }
  if (ctrlShortcutPending && !ctrlShortcutUsedWithOtherKey) {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }
  ctrlShortcutPending = false;
  ctrlShortcutUsedWithOtherKey = false;
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" && isRecording) {
    stopRecording();
  }
});

window.addEventListener("blur", () => {
  if (isRecording) {
    stopRecording();
  }
});

/* -------------------------------------------------------------------------- */
/*                               Initialization                               */
/* -------------------------------------------------------------------------- */
loadConfig();
setupRecognition();
restoreFromStorage();
pushSnapshot();

const isMobileLayout = window.innerWidth <= 700;
const sidebarPref = localStorage.getItem("webspeech_sidebar_collapsed");
if (isMobileLayout || sidebarPref === "true") {
  sidebar.classList.add("collapsed");
}
