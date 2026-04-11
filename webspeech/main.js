/* -------------------------------------------------------------------------- */
/*                                 Constants                                  */
/* -------------------------------------------------------------------------- */
const MARKER_A = '🅰️';
const MARKER_B = '🅱️';
const MAX_HISTORY = 30;
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

/* -------------------------------------------------------------------------- */
/*                                DOM Elements                                */
/* -------------------------------------------------------------------------- */
const toggleButton   = document.getElementById('toggleButton');
const processButton  = document.getElementById('processButton');
const discardButton  = document.getElementById('discardButton');
const executeButton  = document.getElementById('executeButton');
const copyAllButton  = document.getElementById('copyAllButton');
const editModeButton = document.getElementById('editModeButton');
const textBox        = document.getElementById('textBox');
const statusDiv      = document.getElementById('status');
const sidebar        = document.getElementById('sidebar');
const sidebarToggle  = document.getElementById('sidebarToggle');
const groqApiKeyInput        = document.getElementById('groqApiKeyInput');
const geminiApiKeyInput      = document.getElementById('geminiApiKeyInput');
const geminiSystemPromptInput= document.getElementById('geminiSystemPromptInput');
const geminiModelSelect      = document.getElementById('geminiModelSelect');
const saveConfigButton       = document.getElementById('saveConfigButton');

/* -------------------------------------------------------------------------- */
/*                               Global State                                 */
/* -------------------------------------------------------------------------- */
let historyStack = [];
let historyIndex = -1;
let isRecording   = false;
let mediaRecorder = null;
let audioChunks   = [];
let globalStream  = null;
let groqApiKey    = "";
let geminiApiKey  = "";
let geminiModel   = "gemini-2.5-flash-lite";
let geminiSystemPrompt = DEFAULT_SYSTEM_PROMPT;
let isProcessing  = false;
let isReadMode    = false;
let inactivityTimer;
let savedSelection = { start: 0, end: 0 };

/* -------------------------------------------------------------------------- */
/*                           Configuration / Persistence                      */
/* -------------------------------------------------------------------------- */
function loadConfig() {
    const groqKey = localStorage.getItem('webspeech_groq_key');
    if (groqKey) { groqApiKeyInput.value = groqKey; groqApiKey = groqKey; }

    const geminiKey = localStorage.getItem('webspeech_gemini_key');
    if (geminiKey) { geminiApiKeyInput.value = geminiKey; geminiApiKey = geminiKey; }

    const model = localStorage.getItem('webspeech_gemini_model');
    if (model) { geminiModelSelect.value = model; geminiModel = model; }

    const prompt = localStorage.getItem('webspeech_gemini_prompt');
    geminiSystemPromptInput.value = prompt || DEFAULT_SYSTEM_PROMPT;
    geminiSystemPrompt = geminiSystemPromptInput.value;
}

saveConfigButton.addEventListener('click', () => {
    groqApiKey = groqApiKeyInput.value.trim();
    geminiApiKey = geminiApiKeyInput.value.trim();
    geminiModel = geminiModelSelect.value;
    geminiSystemPrompt = geminiSystemPromptInput.value.trim() || DEFAULT_SYSTEM_PROMPT;

    localStorage.setItem('webspeech_groq_key', groqApiKey);
    localStorage.setItem('webspeech_gemini_key', geminiApiKey);
    localStorage.setItem('webspeech_gemini_model', geminiModel);
    localStorage.setItem('webspeech_gemini_prompt', geminiSystemPrompt);

    setStatus("Settings saved", "ok");
    setTimeout(() => setStatus("Ready"), 2000);
});

/* -------------------------------------------------------------------------- */
/*                               Status Helper                                */
/* -------------------------------------------------------------------------- */
function setStatus(text, cls = "") {
    statusDiv.textContent = text;
    statusDiv.className = cls;
}

/* -------------------------------------------------------------------------- */
/*                             Textarea Helpers                               */
/* -------------------------------------------------------------------------- */
function getTextContent() { return textBox.value; }
function setTextContent(text) { textBox.value = text; }
function getCursorPosition() { return { start: textBox.selectionStart, end: textBox.selectionEnd }; }
function setCursorPosition(start, end = start) {
    textBox.selectionStart = start;
    textBox.selectionEnd = end;
}

function insertTextAtCursor(text) {
    saveState();
    let start = savedSelection.start;
    let end   = savedSelection.end;
    const current = getTextContent();

    // Auto-space and capitalize like a real dictation app
    const before = current.slice(0, start).replace(/[ \t]+$/, '');
    const lastChar = before.length > 0 ? before[before.length - 1] : "";
    const atSentenceStart = before.length === 0 || ['.', '!', '?', '\n'].includes(lastChar);

    let insert = text;
    const firstAlpha = insert.match(/[a-zA-Z]/);
    if (firstAlpha) {
        const i = firstAlpha.index;
        insert = insert.slice(0, i)
            + (atSentenceStart ? insert[i].toUpperCase() : insert[i].toLowerCase())
            + insert.slice(i + 1);
    }

    const needsSpace = lastChar && !['\n', ' '].includes(lastChar);
    const finalInsert = (needsSpace ? " " : "") + insert;

    const newText = current.slice(0, start) + finalInsert + current.slice(end);
    setTextContent(newText);
    const newPos = start + finalInsert.length;
    setCursorPosition(newPos);
    savedSelection = getCursorPosition();
    saveState();
}

/* -------------------------------------------------------------------------- */
/*                             History Management                             */
/* -------------------------------------------------------------------------- */
function saveState() {
    const val = getTextContent();
    localStorage.setItem('webspeech_content', val);
    const state = { text: val, selection: { ...savedSelection } };
    if (historyIndex >= 0 && historyStack[historyIndex].text === val) {
        historyStack[historyIndex].selection = state.selection;
        return;
    }
    if (historyIndex < historyStack.length - 1) historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(state);
    if (historyStack.length > MAX_HISTORY) historyStack.shift();
    else historyIndex++;
}

function restoreState() {
    const saved = localStorage.getItem('webspeech_content');
    if (saved) setTextContent(saved);
}

function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        const s = historyStack[historyIndex];
        setTextContent(s.text);
        savedSelection = { ...s.selection };
        setCursorPosition(savedSelection.start, savedSelection.end);
        localStorage.setItem('webspeech_content', s.text);
    }
}

/* -------------------------------------------------------------------------- */
/*                             Recording Logic                                */
/* -------------------------------------------------------------------------- */
function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
        if (isRecording) {
            stopRecording();
            setStatus("Stopped (inactivity)");
        }
    }, INACTIVITY_TIMEOUT_MS);
}

async function startRecording() {
    if (isRecording || isProcessing) return;
    try {
        if (!globalStream) {
            globalStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        audioChunks = [];
        mediaRecorder = new MediaRecorder(globalStream);
        mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
        mediaRecorder.start();
        isRecording = true;
        toggleButton.textContent = "Stop";
        toggleButton.classList.add('recording');
        setStatus("Listening…", "listening");
        resetInactivityTimer();
    } catch (err) {
        console.error("Mic error:", err);
        setStatus("Mic error — check permissions");
    }
}

function stopRecording() {
    return new Promise(resolve => {
        clearTimeout(inactivityTimer);
        if (!isRecording || !mediaRecorder) {
            isRecording = false;
            toggleButton.textContent = "Start";
            toggleButton.classList.remove('recording');
            resolve();
            return;
        }
        mediaRecorder.onstop = () => resolve();
        mediaRecorder.stop();
        isRecording = false;
        toggleButton.textContent = "Start";
        toggleButton.classList.remove('recording');
    });
}

function discardRecording() {
    stopRecording().then(() => {
        audioChunks = [];
        setStatus("Discarded");
        setTimeout(() => startRecording(), 800);
    });
}

/* -------------------------------------------------------------------------- */
/*                              Groq Whisper                                  */
/* -------------------------------------------------------------------------- */
async function transcribeWithGroq() {
    if (!groqApiKey) {
        alert("Enter your Groq API key in Settings first.");
        return null;
    }
    if (audioChunks.length === 0) {
        setStatus("Nothing recorded");
        return null;
    }

    setStatus("Transcribing…", "processing");
    const blob = new Blob(audioChunks, { type: 'audio/webm' });
    audioChunks = [];

    const formData = new FormData();
    formData.append('file', blob, 'recording.webm');
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('prompt', 'Transcribe this speech accurately with proper punctuation.');

    try {
        const res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${groqApiKey}` },
            body: formData
        });
        if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
        const data = await res.json();
        return data.text || "";
    } catch (e) {
        console.error("Groq error:", e);
        setStatus("Groq error: " + e.message);
        return null;
    }
}

/* -------------------------------------------------------------------------- */
/*                             Process (Whisper → insert)                     */
/* -------------------------------------------------------------------------- */
async function processRecording() {
    if (isProcessing) return;
    isProcessing = true;
    await stopRecording();

    const text = await transcribeWithGroq();
    if (text !== null) {
        if (text.trim()) {
            insertTextAtCursor(text.trim());
            setStatus(`Inserted: "${text.trim().slice(0, 60)}${text.trim().length > 60 ? '…' : ''}"`, "ok");
        } else {
            setStatus("No speech detected");
        }
    }
    isProcessing = false;
    startRecording();
}

/* -------------------------------------------------------------------------- */
/*                            Execute (Whisper → Gemini)                      */
/* -------------------------------------------------------------------------- */
async function executeRecording() {
    if (isProcessing) return;
    isProcessing = true;
    await stopRecording();

    const instruction = await transcribeWithGroq();
    if (instruction === null) { isProcessing = false; return; }
    if (!instruction.trim()) { setStatus("No instruction heard"); isProcessing = false; return; }

    if (!geminiApiKey) {
        alert("Enter your Gemini API key in Settings first.");
        isProcessing = false;
        return;
    }

    setStatus(`Sending to Gemini: "${instruction.trim()}"`, "processing");

    // Build marked-up document text
    let docText = getTextContent();
    let { start: selStart, end: selEnd } = savedSelection;
    const markedText = docText.slice(0, selStart) + MARKER_A + docText.slice(selStart, selEnd) + MARKER_B + docText.slice(selEnd);

    const payload = {
        contents: [{ parts: [{ text: markedText }] }],
        system_instruction: { parts: [{ text: geminiSystemPrompt + instruction.trim() }] }
    };

    try {
        const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
        );
        if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
        const data = await res.json();

        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!raw) throw new Error("Empty Gemini response");

        saveState();
        const aIdx = raw.indexOf(MARKER_A);
        const bIdx = raw.indexOf(MARKER_B);
        const clean = raw.replace(new RegExp(MARKER_A, 'g'), '').replace(new RegExp(MARKER_B, 'g'), '');

        let newStart = clean.length, newEnd = clean.length;
        if (aIdx !== -1 && bIdx !== -1) {
            newStart = aIdx;
            newEnd = bIdx > aIdx ? bIdx - MARKER_A.length : bIdx;
        }

        setTextContent(clean);
        setCursorPosition(newStart, newEnd);
        savedSelection = getCursorPosition();
        saveState();
        setStatus("Done", "ok");
    } catch (e) {
        console.error("Gemini error:", e);
        setStatus("Gemini error: " + e.message);
    }
    isProcessing = false;
    startRecording();
}

/* -------------------------------------------------------------------------- */
/*                            Copy & Clear                                    */
/* -------------------------------------------------------------------------- */
async function copyAndClear() {
    const text = getTextContent();
    if (!text.trim()) { setStatus("Nothing to copy"); return; }
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        // Fallback for browsers that block clipboard without user gesture
        textBox.select();
        document.execCommand('copy');
    }
    saveState();
    setTextContent("");
    savedSelection = { start: 0, end: 0 };
    saveState();
    setStatus("Copied & cleared", "ok");
    setTimeout(() => setStatus("Ready"), 2000);
}

/* -------------------------------------------------------------------------- */
/*                            Edit / Read Mode                                */
/* -------------------------------------------------------------------------- */
function toggleEditMode() {
    isReadMode = !isReadMode;
    textBox.readOnly = isReadMode;
    editModeButton.textContent = isReadMode ? "Edit Mode" : "Read Mode";
    editModeButton.classList.toggle('active', isReadMode);
    if (!isReadMode) {
        // Restore focus so keyboard appears immediately on re-enabling edit mode
        textBox.focus();
        const pos = getTextContent().length;
        setCursorPosition(pos);
        savedSelection = getCursorPosition();
    }
}

/* -------------------------------------------------------------------------- */
/*                              Button Listeners                              */
/* -------------------------------------------------------------------------- */
toggleButton.addEventListener('click', () => {
    if (isRecording) stopRecording().then(() => setStatus("Stopped"));
    else startRecording();
});

processButton.addEventListener('click', processRecording);
discardButton.addEventListener('click', discardRecording);
executeButton.addEventListener('click', executeRecording);
copyAllButton.addEventListener('click', copyAndClear);
editModeButton.addEventListener('click', toggleEditMode);

sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('webspeech_sidebar_collapsed', sidebar.classList.contains('collapsed'));
});

/* -------------------------------------------------------------------------- */
/*                          Selection Tracking                                */
/* -------------------------------------------------------------------------- */
textBox.addEventListener('select',  () => { savedSelection = getCursorPosition(); });
textBox.addEventListener('click',   () => { savedSelection = getCursorPosition(); });
textBox.addEventListener('keyup',   () => { savedSelection = getCursorPosition(); });
textBox.addEventListener('input',   () => {
    savedSelection = getCursorPosition();
    clearTimeout(textBox._saveTimer);
    textBox._saveTimer = setTimeout(saveState, 1000);
});

/* Keyboard: Ctrl+Z undo, Escape stops recording */
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isRecording) { e.preventDefault(); stopRecording().then(() => setStatus("Stopped")); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !isReadMode) { e.preventDefault(); undo(); }
});

/* -------------------------------------------------------------------------- */
/*                               Initialization                               */
/* -------------------------------------------------------------------------- */
loadConfig();
restoreState();
saveState();

// On narrow screens always start with sidebar hidden so it doesn't overflow
const isMobileLayout = window.innerWidth <= 700;
const sidebarPref = localStorage.getItem('webspeech_sidebar_collapsed');
if (isMobileLayout || sidebarPref === 'true') {
    sidebar.classList.add('collapsed');
}
