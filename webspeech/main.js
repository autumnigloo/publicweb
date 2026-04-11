/* -------------------------------------------------------------------------- */
/*                                 Constants                                  */
/* -------------------------------------------------------------------------- */
const MARKER_A = '🅰️';
const MARKER_B = '🅱️';
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

/* -------------------------------------------------------------------------- */
/*                                DOM Elements                                */
/* -------------------------------------------------------------------------- */
const toggleButton   = document.getElementById('toggleButton');
const processButton  = document.getElementById('processButton');
const discardButton  = document.getElementById('discardButton');
const executeButton  = document.getElementById('executeButton');
const copyAllButton  = document.getElementById('copyAllButton');
const editModeButton = document.getElementById('editModeButton');
const undoButton     = document.getElementById('undoButton');
const redoButton     = document.getElementById('redoButton');
const textBox        = document.getElementById('textBox');
const toast          = document.getElementById('toast');
const sidebar        = document.getElementById('sidebar');
const sidebarToggle  = document.getElementById('sidebarToggle');
const groqApiKeyInput         = document.getElementById('groqApiKeyInput');
const geminiApiKeyInput       = document.getElementById('geminiApiKeyInput');
const geminiSystemPromptInput = document.getElementById('geminiSystemPromptInput');
const geminiModelSelect       = document.getElementById('geminiModelSelect');
const saveConfigButton        = document.getElementById('saveConfigButton');

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
let toastTimer    = null;

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
    groqApiKey     = groqApiKeyInput.value.trim();
    geminiApiKey   = geminiApiKeyInput.value.trim();
    geminiModel    = geminiModelSelect.value;
    geminiSystemPrompt = geminiSystemPromptInput.value.trim() || DEFAULT_SYSTEM_PROMPT;

    localStorage.setItem('webspeech_groq_key',     groqApiKey);
    localStorage.setItem('webspeech_gemini_key',   geminiApiKey);
    localStorage.setItem('webspeech_gemini_model', geminiModel);
    localStorage.setItem('webspeech_gemini_prompt',geminiSystemPrompt);

    showToast("Settings saved");
});

/* -------------------------------------------------------------------------- */
/*                               Toast Helper                                 */
/* -------------------------------------------------------------------------- */
function showToast(msg, durationMs = 5000) {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.classList.remove('hidden');
    toastTimer = setTimeout(hideToast, durationMs);
}
function hideToast() {
    clearTimeout(toastTimer);
    toast.classList.add('hidden');
}
toast.addEventListener('click', hideToast);

/* -------------------------------------------------------------------------- */
/*                             Textarea Helpers                               */
/* -------------------------------------------------------------------------- */
function getTextContent() { return textBox.value; }
function setTextContent(v) { textBox.value = v; }
function getCursorPosition() { return { start: textBox.selectionStart, end: textBox.selectionEnd }; }
function setCursorPosition(start, end = start) {
    textBox.selectionStart = start;
    textBox.selectionEnd   = end;
}

/* -------------------------------------------------------------------------- */
/*                             History Management                             */
/* -------------------------------------------------------------------------- */
// Always call pushSnapshot() BEFORE making a change so the old state is saved.
// saveState() de-dupes consecutive identical text.
function pushSnapshot() {
    const val = getTextContent();
    const sel = { ...savedSelection };
    // Truncate redo stack
    if (historyIndex < historyStack.length - 1) {
        historyStack = historyStack.slice(0, historyIndex + 1);
    }
    // De-dupe: don't push if text unchanged
    if (historyIndex >= 0 && historyStack[historyIndex].text === val) {
        historyStack[historyIndex].selection = sel;
        return;
    }
    historyStack.push({ text: val, selection: sel });
    if (historyStack.length > MAX_HISTORY) historyStack.shift();
    else historyIndex++;
    localStorage.setItem('webspeech_content', val);
}

function undo() {
    if (historyIndex <= 0) return;
    historyIndex--;
    const s = historyStack[historyIndex];
    setTextContent(s.text);
    savedSelection = { ...s.selection };
    setCursorPosition(savedSelection.start, savedSelection.end);
    localStorage.setItem('webspeech_content', s.text);
}

function redo() {
    if (historyIndex >= historyStack.length - 1) return;
    historyIndex++;
    const s = historyStack[historyIndex];
    setTextContent(s.text);
    savedSelection = { ...s.selection };
    setCursorPosition(savedSelection.start, savedSelection.end);
    localStorage.setItem('webspeech_content', s.text);
}

function restoreFromStorage() {
    const saved = localStorage.getItem('webspeech_content');
    if (saved) setTextContent(saved);
}

/* -------------------------------------------------------------------------- */
/*                              Text Insertion                                */
/* -------------------------------------------------------------------------- */
function insertTextAtCursor(text) {
    pushSnapshot(); // save pre-insert state
    let start = savedSelection.start;
    let end   = savedSelection.end;
    const current = getTextContent();

    // Auto-space + capitalize
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
    pushSnapshot(); // save post-insert state
}

/* -------------------------------------------------------------------------- */
/*                             Recording Logic                                */
/* -------------------------------------------------------------------------- */
function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
        if (isRecording) stopRecording();
    }, INACTIVITY_TIMEOUT_MS);
}

async function startRecording() {
    if (isRecording || isProcessing) return;
    try {
        // Always request a fresh stream so the mic indicator appears correctly
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
        resetInactivityTimer();
    } catch (err) {
        console.error("Mic error:", err);
        showToast("Mic error — check permissions");
    }
}

function stopRecording() {
    return new Promise(resolve => {
        clearTimeout(inactivityTimer);
        toggleButton.textContent = "Start";
        toggleButton.classList.remove('recording');

        const finish = () => {
            // Release the mic entirely so the system indicator goes away
            if (globalStream) {
                globalStream.getTracks().forEach(t => t.stop());
                globalStream = null;
            }
            isRecording = false;
            resolve();
        };

        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            finish();
            return;
        }
        mediaRecorder.onstop = finish;
        mediaRecorder.stop();
        isRecording = false; // update flag immediately for UI
    });
}

/* -------------------------------------------------------------------------- */
/*                              Groq Whisper                                  */
/* -------------------------------------------------------------------------- */
async function transcribeWithGroq() {
    if (!groqApiKey) {
        showToast("Enter your Groq API key in Settings first.");
        return null;
    }
    if (audioChunks.length === 0) {
        showToast("Nothing recorded.");
        return null;
    }

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
        showToast("Groq error: " + e.message);
        return null;
    }
}

/* -------------------------------------------------------------------------- */
/*                        Discard / Process / Execute                         */
/* -------------------------------------------------------------------------- */
function discardRecording() {
    stopRecording().then(() => {
        audioChunks = [];
        showToast("Recording discarded.");
        startRecording();
    });
}

async function processRecording() {
    if (isProcessing) return;
    isProcessing = true;
    await stopRecording();

    const text = await transcribeWithGroq();
    isProcessing = false;

    if (text !== null) {
        if (text.trim()) {
            insertTextAtCursor(text.trim());
            showToast(text.trim());
        } else {
            showToast("No speech detected.");
        }
    }
    startRecording();
}

async function executeRecording() {
    if (isProcessing) return;
    isProcessing = true;
    await stopRecording();

    const instruction = await transcribeWithGroq();
    if (instruction === null) { isProcessing = false; startRecording(); return; }
    if (!instruction.trim())  { showToast("No instruction heard."); isProcessing = false; startRecording(); return; }

    if (!geminiApiKey) {
        showToast("Enter your Gemini API key in Settings first.");
        isProcessing = false;
        startRecording();
        return;
    }

    showToast(`Sending to Gemini: "${instruction.trim()}"`, 30000);

    const docText = getTextContent();
    const { start: selStart, end: selEnd } = savedSelection;
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

        pushSnapshot(); // save before applying Gemini result
        const aIdx = raw.indexOf(MARKER_A);
        const bIdx = raw.indexOf(MARKER_B);
        const clean = raw.replace(new RegExp(MARKER_A, 'g'), '').replace(new RegExp(MARKER_B, 'g'), '');

        let newStart = clean.length, newEnd = clean.length;
        if (aIdx !== -1 && bIdx !== -1) {
            newStart = aIdx;
            newEnd   = bIdx > aIdx ? bIdx - MARKER_A.length : bIdx;
        }
        setTextContent(clean);
        setCursorPosition(newStart, newEnd);
        savedSelection = getCursorPosition();
        pushSnapshot(); // save after applying Gemini result
        showToast("Done.");
    } catch (e) {
        console.error("Gemini error:", e);
        showToast("Gemini error: " + e.message);
    }
    isProcessing = false;
    startRecording();
}

/* -------------------------------------------------------------------------- */
/*                            Copy & Clear                                    */
/* -------------------------------------------------------------------------- */
async function copyAndClear() {
    const text = getTextContent();
    if (!text.trim()) { showToast("Nothing to copy."); return; }
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        textBox.select();
        document.execCommand('copy');
    }
    pushSnapshot();
    setTextContent("");
    savedSelection = { start: 0, end: 0 };
    pushSnapshot();
    showToast("Copied & cleared.");
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
        textBox.focus();
        setCursorPosition(getTextContent().length);
        savedSelection = getCursorPosition();
    }
}

/* -------------------------------------------------------------------------- */
/*                              Button Listeners                              */
/* -------------------------------------------------------------------------- */
toggleButton.addEventListener('click', () => {
    if (isRecording) stopRecording();
    else startRecording();
});

processButton.addEventListener('click',  processRecording);
discardButton.addEventListener('click',  discardRecording);
executeButton.addEventListener('click',  executeRecording);
copyAllButton.addEventListener('click',  copyAndClear);
editModeButton.addEventListener('click', toggleEditMode);
undoButton.addEventListener('click', undo);
redoButton.addEventListener('click', redo);

/* -------------------------------------------------------------------------- */
/*                          Sidebar / Outside Click                           */
/* -------------------------------------------------------------------------- */
sidebarToggle.addEventListener('click', e => {
    e.stopPropagation();
    const wasCollapsed = sidebar.classList.contains('collapsed');
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('webspeech_sidebar_collapsed', !wasCollapsed);
});

// Close sidebar when clicking anywhere outside it on mobile
document.addEventListener('click', e => {
    if (window.innerWidth > 700) return;
    if (!sidebar.classList.contains('collapsed') &&
        !sidebar.contains(e.target) &&
        e.target !== sidebarToggle) {
        sidebar.classList.add('collapsed');
        localStorage.setItem('webspeech_sidebar_collapsed', 'true');
    }
});

/* -------------------------------------------------------------------------- */
/*                          Selection Tracking                                */
/* -------------------------------------------------------------------------- */
textBox.addEventListener('select', () => { savedSelection = getCursorPosition(); });
textBox.addEventListener('click',  () => { savedSelection = getCursorPosition(); });
textBox.addEventListener('keyup',  () => { savedSelection = getCursorPosition(); });
textBox.addEventListener('input',  () => {
    savedSelection = getCursorPosition();
    clearTimeout(textBox._saveTimer);
    textBox._saveTimer = setTimeout(pushSnapshot, 1000);
});

/* Keyboard shortcuts */
document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && isRecording) { e.preventDefault(); stopRecording(); }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z' && !isReadMode) { e.preventDefault(); undo(); }
    if ((e.ctrlKey || e.metaKey) && (e.shiftKey && e.key === 'z' || e.key === 'y') && !isReadMode) { e.preventDefault(); redo(); }
});

/* -------------------------------------------------------------------------- */
/*                               Initialization                               */
/* -------------------------------------------------------------------------- */
loadConfig();
restoreFromStorage();
pushSnapshot(); // seed the undo stack with the initial state

const isMobileLayout = window.innerWidth <= 700;
const sidebarPref = localStorage.getItem('webspeech_sidebar_collapsed');
if (isMobileLayout || sidebarPref === 'true') {
    sidebar.classList.add('collapsed');
}
