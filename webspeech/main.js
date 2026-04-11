/* -------------------------------------------------------------------------- */
/*                                 Constants                                  */
/* -------------------------------------------------------------------------- */
const MARKER_A = '🅰️'; // Cursor Selection Start
const MARKER_B = '🅱️'; // Cursor Selection End
const MAX_HISTORY = 30;
const CURSOR_SYMBOL = '◉';
const INACTIVITY_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

// Detect mobile devices (Android/iOS) — used to tune recognition behavior
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

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

const DEFAULT_CONFIG = String.raw`1. Commands (start with #)
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
url=TODO_ADD_LINK_HERE_LATER
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
# NATO Phonetic Alphabet (uppercase)
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
# NATO Phonetic Alphabet (lowercase)
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

3. Regex Operations (trigger=match_regex:::replacement)
# Use 🅰️ for Cursor Start and 🅱️ for Cursor End
select all=^([\s\S]*)🅰️([\s\S]*?)🅱️([\s\S]*)$:::🅰️$1$2$3🅱️
select word=(^|[\s\S]*?)(\S*?)🅰️([\s\S]*?)🅱️(\S*)([\s\S]*|$):::$1🅰️$2$3$4🅱️$5
select line=(^|[\s\S]*\n)([^\n]*)🅰️([\s\S]*?)🅱️([^\n]*)(\n[\s\S]*|$):::$1🅰️$2$3$4🅱️$5
# Select paragraph (text between blank lines)
select paragraph=(^|[\s\S]*?\n\n)([^\n]*(?:\n(?!\n)[^\n]*)*)🅰️([\s\S]*?)🅱️([^\n]*(?:\n(?!\n)[^\n]*)*)(\n\n|$):::$1🅰️$2$3$4🅱️$5
# Select sentence (text between .!? or newline, does not cross newlines)
select sentence=(^|[\s\S]*?[.!?\n]\s*)([^.!?\n]*)🅰️([\s\S]*?)🅱️([^.!?\n]*)([.!?\n]|$):::$1🅰️$2$3$4$5🅱️
space=🅰️[\s\S]*?🅱️::: 🅰️🅱️
# Deletes previous character
backspace=[\s\S]?🅰️[\s\S]*?🅱️:::🅰️🅱️
# Deletes previous word
delete=(\S+\s*)?🅰️[\s\S]*?🅱️:::🅰️🅱️
# Deletes previous sentence segment (does not cross newlines)
sentence delete=[^.!?\n]+[.!?\n]*\s*🅰️[\s\S]*?🅱️:::🅰️🅱️
# Delete entire line (including newline)
line delete=(^|[\s\S]*\n)([^\n]*)🅰️([\s\S]*?)🅱️([^\n]*)(\n|$)([\s\S]*):::$1🅰️🅱️$6
# Delete word forward (after cursor)
next delete=🅰️([\s\S]*?)🅱️\s*\S+:::🅰️🅱️
# Deletes selection
selection delete=🅰️[\s\S]*?🅱️:::🅰️🅱️
# Clears the entire document
clear all=[\s\S]*:::🅰️🅱️
# Clear spaces before cursor
clear space=[ \t]*🅰️([\s\S]*?)🅱️[ \t]*:::🅰️$1🅱️

# Move one position to the left (collapses selection)
(move|go) left=([\s\S])🅰️([\s\S]*?)🅱️:::🅰️🅱️$1$2
# Move one position to the right (collapses selection)
(move|go) right=🅰️([\s\S]*?)🅱️([\s\S]):::$1$2🅰️🅱️
# Move Up (to start of previous line)
(move|go) up=(^|[\s\S]*\n)([^\n]*)\n([^\n]*)🅰️([\s\S]*?)🅱️([^\n]*)([\s\S]*):::$1🅰️🅱️$2\n$3$4$5$6
# Move Down (to start of next line)
(move|go) down=(^|[\s\S]*\n)([^\n]*)🅰️([\s\S]*?)🅱️([^\n]*)\n([^\n]*)([\s\S]*):::$1$2$3$4\n🅰️🅱️$5$6
# Move to Start of Line
(move|go) to start( of line)?=(^|[\s\S]*\n)([^\n]*)🅰️([\s\S]*?)🅱️([\s\S]*):::$1🅰️🅱️$2$3$4
# Move to End of Line
(move|go) to end( of line)?=(^|[\s\S]*\n)([^\n]*)🅰️([\s\S]*?)🅱️([^\n]*)([\s\S]*):::$1$2$3$4🅰️🅱️$5
# Move to Top (Start of Text)
(move|go) to top=^([\s\S]*)🅰️([\s\S]*?)🅱️([\s\S]*)$:::🅰️🅱️$1$2$3
# Move to Bottom (End of Text)
(move|go) to bottom=^([\s\S]*)🅰️([\s\S]*?)🅱️([\s\S]*)$:::$1$2$3🅰️🅱️
# Duplicate current line
duplicate line=(^|[\s\S]*\n)([^\n]*)🅰️([\s\S]*?)🅱️([^\n]*)(\n|$)([\s\S]*):::$1$2$3$4$5$2$3$4🅰️🅱️$5$6
# Text formatting (wrap selection with markdown)
boldify|(make )?bold=🅰️([\s\S]*?)🅱️:::🅰️**$1**🅱️
italicize|(make )?italic=🅰️([\s\S]*?)🅱️:::🅰️*$1*🅱️
underline=🅰️([\s\S]*?)🅱️:::🅰️<u>$1</u>🅱️
strikethrough|strike=🅰️([\s\S]*?)🅱️:::🅰️~~$1~~🅱️
code|inline code=🅰️([\s\S]*?)🅱️:::🅰️\`$1\`🅱️
# Wrap selection with brackets/parentheses
parenthesize=🅰️([\s\S]*?)🅱️:::🅰️($1)🅱️
bracketize=🅰️([\s\S]*?)🅱️:::🅰️[$1]🅱️
quote|quotify=🅰️([\s\S]*?)🅱️:::🅰️"$1"🅱️
# Insert bullet point (- ), adding newline first if not at start of line
bullet=\n?🅰️([\s\S]*?)🅱️:::\n- 🅰️🅱️
`;

/* -------------------------------------------------------------------------- */
/*                                DOM Elements                                */
/* -------------------------------------------------------------------------- */
const toggleButton = document.getElementById('toggleButton');
const processButton = document.getElementById('processButton');
const executeButton = document.getElementById('executeButton');
const discardButton = document.getElementById('discardButton');
const undoButton = document.getElementById('undoButton');
const redoButton = document.getElementById('redoButton');
const textBox = document.getElementById('textBox');
const pendingTextSpan = document.getElementById('pendingText');
const statusDiv = document.getElementById('status');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebarToggle');
const configEditor = document.getElementById('configEditor');
const saveConfigButton = document.getElementById('saveConfigButton');
const resetConfigButton = document.getElementById('resetConfigButton');
const groqApiKeyInput = document.getElementById('groqApiKeyInput');
const geminiApiKeyInput = document.getElementById('geminiApiKeyInput');
const geminiSystemPromptInput = document.getElementById('geminiSystemPromptInput');
const geminiModelSelect = document.getElementById('geminiModelSelect');
const keyboardShortcutsCheckbox = document.getElementById('keyboardShortcutsCheckbox');

/* -------------------------------------------------------------------------- */
/*                               Global State                                 */
/* -------------------------------------------------------------------------- */
let historyStack = [];
let historyIndex = -1;
let configRules = [];
let recognition;
let isRecognizing = false;
let ignoreResults = false;
let currentTranscript = "";
let debounceTimer;
let mediaRecorder;
let audioChunks = [];
let groqApiKey = "";
let geminiApiKey = "";
let geminiSystemPrompt = "";
let geminiModel = "gemini-2.5-flash-lite";
let isProcessing = false;
let shouldKeepListening = false;
let globalStream = null;
let savedSelection = { start: 0, end: 0 };
let inactivityTimer;
let keyboardShortcutsEnabled = true;
// Tracks consecutive recognition failures to implement backoff
let recognitionFailCount = 0;

/* -------------------------------------------------------------------------- */
/*                           Configuration Logic                              */
/* -------------------------------------------------------------------------- */
function loadConfig() {
    const savedConfig = localStorage.getItem('webspeech_config');
    const configText = savedConfig || DEFAULT_CONFIG;
    configEditor.value = configText;
    parseConfig(configText);

    const savedKey = localStorage.getItem('webspeech_groq_key');
    if (savedKey) {
        groqApiKeyInput.value = savedKey;
        groqApiKey = savedKey;
    }

    const savedGeminiKey = localStorage.getItem('webspeech_gemini_key');
    if (savedGeminiKey) {
        geminiApiKeyInput.value = savedGeminiKey;
        geminiApiKey = savedGeminiKey;
    }

    const savedPrompt = localStorage.getItem('webspeech_gemini_prompt');
    if (savedPrompt) {
        geminiSystemPromptInput.value = savedPrompt;
        geminiSystemPrompt = savedPrompt;
    } else {
        geminiSystemPromptInput.value = DEFAULT_SYSTEM_PROMPT;
        geminiSystemPrompt = DEFAULT_SYSTEM_PROMPT;
    }

    const savedModel = localStorage.getItem('webspeech_gemini_model');
    if (savedModel) {
        geminiModel = savedModel;
        geminiModelSelect.value = savedModel;
    }

    const savedShortcutsPref = localStorage.getItem('webspeech_keyboard_shortcuts_enabled');
    if (savedShortcutsPref !== null) {
        keyboardShortcutsEnabled = savedShortcutsPref === 'true';
        keyboardShortcutsCheckbox.checked = keyboardShortcutsEnabled;
    } else {
        keyboardShortcutsEnabled = true;
        keyboardShortcutsCheckbox.checked = true;
    }
}

function parseConfig(text) {
    configRules = [];
    let currentSection = 1;

    const lines = text.split('\n');
    for (let line of lines) {
        // Only trim leading whitespace to preserve trailing spaces in replacements
        const trimmedLine = line.trim();
        const leftTrimmedLine = line.replace(/^\s+/, '');

        // Check for section headers: "1."
        const sectionMatch = trimmedLine.match(/^(\d+)\./);
        if (sectionMatch) {
            currentSection = parseInt(sectionMatch[1], 10);
            continue;
        }

        if (!trimmedLine || trimmedLine.startsWith('#') || !trimmedLine.includes('=')) continue;

        if (currentSection === 3) {
            // Regex Operations
            const firstEqSplit = leftTrimmedLine.split('=', 2);
            if (firstEqSplit.length < 2) {
                console.warn("Invalid Section 3 rule:", leftTrimmedLine);
                continue;
            }
            const trigger = firstEqSplit[0].trim();
            const restAfterTrigger = firstEqSplit[1];

            const tripleColonSplit = restAfterTrigger.split(':::', 2);
            if (tripleColonSplit.length < 2) {
                console.warn("Invalid Section 3 rule:", leftTrimmedLine);
                continue;
            }
            const matchRegexStr = tripleColonSplit[0];
            const replacement = tripleColonSplit[1];

            configRules.push({
                trigger: trigger,
                matchRegex: matchRegexStr,
                replacement: replacement,
                type: 3
            });
        } else {
            // Section 1 & 2
            const parts = leftTrimmedLine.split('=');
            if (parts.length < 2) {
                console.warn(`Invalid Section ${currentSection} rule:`, leftTrimmedLine);
                continue;
            }
            const trigger = parts[0].trim();
            const replacement = parts.slice(1).join('=');

            configRules.push({
                trigger: trigger,
                replacement: replacement,
                type: currentSection,
                isCommand: currentSection === 1
            });
        }
    }
    console.log("Parsed config rules:", configRules);
}

/* -------------------------------------------------------------------------- */
/*                        Textarea Helper Functions                           */
/* -------------------------------------------------------------------------- */
function getTextContent() {
    return textBox.value;
}

function setTextContent(text) {
    textBox.value = text;
}

function getCursorPosition() {
    return { start: textBox.selectionStart, end: textBox.selectionEnd };
}

function setCursorPosition(start, end = start) {
    textBox.selectionStart = start;
    textBox.selectionEnd = end;
}

/* -------------------------------------------------------------------------- */
/*                             network Execution                              */
/* -------------------------------------------------------------------------- */
async function executeWithGemini(instruction) {
    statusDiv.textContent = `Status: Waiting for Gemini to process: "${instruction}"`;
    if (!geminiApiKey) {
        alert("Please set your Gemini API Key in configuration.");
        statusDiv.textContent = "Status: Missing Gemini Key";
        return;
    }

    // Get current text and selection
    let currentText = getTextContent().replace(new RegExp(CURSOR_SYMBOL, 'g'), '');
    let { start: selStart, end: selEnd } = savedSelection;

    // Check if cursor symbol was in the original text
    const originalText = getTextContent();
    if (originalText.includes(CURSOR_SYMBOL)) {
        const idx = originalText.indexOf(CURSOR_SYMBOL);
        selStart = idx;
        selEnd = idx;
    }

    // Build full text with markers around the selection
    const markedText = currentText.slice(0, selStart) + MARKER_A + currentText.slice(selStart, selEnd) + MARKER_B + currentText.slice(selEnd);

    const payload = {
        "contents": [{
            "parts": [{"text": markedText}]
        }],
        "system_instruction": {
            "parts": [{ "text": geminiSystemPrompt + instruction}]
        }
    };

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Gemini API Error: ${response.status} - ${errText}`);
        }

        const data = await response.json();
        if (data.candidates && data.candidates.length > 0 && data.candidates[0].content && data.candidates[0].content.parts) {
            let llmResult = data.candidates[0].content.parts[0].text;
            console.log("Gemini Response:", llmResult);

            saveState();

            // Extract cursor position from markers in the response
            const markerAIndex = llmResult.indexOf(MARKER_A);
            const markerBIndex = llmResult.indexOf(MARKER_B);

            // Remove markers from the result to get clean text
            let cleanText = llmResult.replace(new RegExp(MARKER_A, 'g'), '').replace(new RegExp(MARKER_B, 'g'), '');

            // Calculate cursor positions (accounting for marker removal)
            let newSelectionStart, newSelectionEnd;
            if (markerAIndex !== -1 && markerBIndex !== -1) {
                // Both markers found - use them for cursor position
                newSelectionStart = markerAIndex;
                // Adjust for MARKER_A being removed before MARKER_B
                newSelectionEnd = markerBIndex > markerAIndex ? markerBIndex - MARKER_A.length : markerBIndex;
            } else {
                // No markers in response - place cursor at end
                newSelectionStart = cleanText.length;
                newSelectionEnd = cleanText.length;
            }

            // Replace entire text with LLM result
            setTextContent(cleanText);
            setCursorPosition(newSelectionStart, newSelectionEnd);

            saveState();
            scrollToCursor();
            statusDiv.textContent = "Status: Execution Complete";
        }
    } catch (e) {
        console.error("Gemini Execute Failed:", e);
        statusDiv.textContent = "Status: Gemini Error";
        alert("Gemini Execution Failed: " + e.message);
    }
}


async function processWithGroq(mode = 'process') {
    if (isProcessing) return;
    isProcessing = true;
    statusDiv.textContent = "Status: Processing...";

    const wasListening = shouldKeepListening;
    shouldKeepListening = false;

    try {
        // 1. Stop Recording to finalize chunks
        if (isRecognizing || (mediaRecorder && mediaRecorder.state === "recording")) {
            await new Promise(resolve => {
                if (!mediaRecorder || mediaRecorder.state === "inactive") {
                    resolve();
                    return;
                }
                mediaRecorder.onstop = () => resolve();
                mediaRecorder.stop();
            });

            if (isRecognizing) recognition.stop();
        }

        // 2. Prepare Audio Blob
        if (groqApiKey && audioChunks.length > 0) {
            statusDiv.textContent = "Status: Sending to Groq...";
            const blob = new Blob(audioChunks, { type: 'audio/webm' });

            // 3. Send to Groq
            try {
                const formData = new FormData();
                formData.append('file', blob, 'recording.webm');
                formData.append('model', 'whisper-large-v3-turbo');
                formData.append('prompt', 'Hello. This is a dictation with proper punctuation, including periods at the end of sentences.');

                const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${groqApiKey}`
                    },
                    body: formData
                });

                if (!response.ok) {
                    const errText = await response.text();
                    throw new Error(`Groq API Error: ${response.status} - ${errText}`);
                }

                const data = await response.json();
                let groqText = data.text;
                console.log("Groq Transcription Raw:", groqText);

                let isExecuteCommand = mode === 'execute';

                // Clean command words
                const processRules = configRules.filter(r => r.type === 1 && ['#process', '#execute'].includes(r.replacement));

                for (const rule of processRules) {
                    try {
                        const regex = new RegExp(`(?:^|\\s)(${rule.trigger})[\\s.,!?;:]*$`, 'i');
                        if (regex.test(groqText)) {
                            if (rule.replacement === '#execute') isExecuteCommand = true;
                            groqText = groqText.replace(regex, "").trim();
                        }
                    } catch (e) { } // Ignore regex errors
                }

                console.log("Groq Transcription Cleaned:", groqText, "Mode:", isExecuteCommand ? "Execute" : "Process");

                if (isExecuteCommand) {
                    await executeWithGemini(groqText);
                } else {
                    runTextProcessing(groqText);
                }

                if (!statusDiv.textContent.includes("Error")) {
                    statusDiv.textContent = "Status: Ready";
                }

            } catch (e) {
                console.error("Groq Processing Failed:", e);
                statusDiv.textContent = "Status: Groq Error (Falling back to WebSpeech)";
                // Fallback
                runTextProcessing(currentTranscript);
            }
        } else {
            if (!groqApiKey) console.log("No Groq API Key provided, using WebSpeech.");
            else console.log("No audio chunks captured.");
            runTextProcessing(currentTranscript);
            statusDiv.textContent = "Status: Ready";
        }
    } finally {
        // Cleanup
        audioChunks = [];
        currentTranscript = "";
        pendingTextSpan.textContent = "";
        ignoreResults = true;
        isProcessing = false;

        if (wasListening) {
            startDictation();
        }
    }
}

/* -------------------------------------------------------------------------- */
/*                           Audio Processing Logic                           */
/* -------------------------------------------------------------------------- */

function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
        if (isRecognizing || shouldKeepListening) {
            console.log("Stopping due to inactivity");
            stopDictation();
            statusDiv.textContent = "Status: Stopped (Inactivity Timeout)";
        }
    }, INACTIVITY_TIMEOUT_MS);
}

function restartForNewSegment() {
    // Flags to stop processing current events but keep listening intent
    ignoreResults = true;

    // Stop current capture - onend will handle restart because shouldKeepListening is true
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    if (isRecognizing) {
        recognition.stop();
    }
}

function discardText() {
    console.log("Discarding text");
    currentTranscript = "";
    pendingTextSpan.textContent = "";
    restartForNewSegment();
}

function stopDictation() {
    shouldKeepListening = false;
    clearTimeout(inactivityTimer);
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
    }
    recognition.stop();

    // Stop all microphone tracks to fully release the microphone
    if (globalStream) {
        globalStream.getTracks().forEach(track => track.stop());
        globalStream = null;
    }
}

async function startDictation() {
    shouldKeepListening = true;
    recognitionFailCount = 0;
    resetInactivityTimer();
    audioChunks = [];

    // Init MediaRecorder for Groq
    try {
        if (!globalStream) {
            globalStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        }

        mediaRecorder = new MediaRecorder(globalStream);
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };
        mediaRecorder.start();
    } catch (err) {
        console.error("Error accessing microphone:", err);
        statusDiv.textContent = "Status: Mic Error (Check permissions)";
        shouldKeepListening = false;
        return;
    }

    try {
        recognition.start();
    } catch(e) {
        // Already started — ignore
        console.warn("recognition.start() threw:", e.message);
    }
}

/* -------------------------------------------------------------------------- */
/*                         Speech Recognition Setup                           */
/* -------------------------------------------------------------------------- */
if (window.SpeechRecognition || window.webkitSpeechRecognition) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();

    // On Android Chrome, continuous=true is unreliable: the session auto-stops
    // after a short silence regardless. Setting it to false and restarting on
    // onend gives more consistent behaviour across platforms.
    recognition.continuous = !isMobile;
    // Interim results are buggy on Android (partial results fire as finals,
    // sessions get "stuck"). Disable them on mobile — we only need finals.
    recognition.interimResults = !isMobile;
    recognition.lang = 'en-US';
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        isRecognizing = true;
        ignoreResults = false;
        currentTranscript = "";
        pendingTextSpan.textContent = "";
        toggleButton.textContent = 'Stop Dictation';
        toggleButton.classList.add('recording');
        statusDiv.textContent = "Status: Listening...";
        recognitionFailCount = 0;
    };

    recognition.onerror = (event) => {
        if (event.error === 'no-speech') {
            // No-speech is benign — recognition will end and restart via onend
            console.log("No speech detected.");
            return;
        }
        console.error("Speech recognition error:", event.error);
        isRecognizing = false;

        if (event.error === 'network') {
            // On Android, Google's speech servers are occasionally unreachable.
            // This is the most common cause of browser STT "not working" on mobile.
            // Show a clear message and retry after a backoff delay.
            recognitionFailCount++;
            const delay = Math.min(1000 * recognitionFailCount, 8000);
            statusDiv.textContent = `Status: Network error (retry in ${delay/1000}s) — check internet / use Groq instead`;
            if (shouldKeepListening) {
                setTimeout(() => {
                    if (shouldKeepListening) scheduleRestart();
                }, delay);
            }
            return;
        }

        if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
            // Microphone or speech service blocked — don't retry automatically
            shouldKeepListening = false;
            statusDiv.textContent = "Status: Mic/speech permission denied — check browser & OS settings";
            toggleButton.textContent = 'Start Dictation';
            toggleButton.classList.remove('recording');
            return;
        }

        // For other errors (aborted, audio-capture, etc.) just update the status
        statusDiv.textContent = "Status: Error - " + event.error;
        toggleButton.textContent = 'Start Dictation';
        toggleButton.classList.remove('recording');
    };

    recognition.onend = () => {
        isRecognizing = false;

        if (shouldKeepListening && !isProcessing) {
            // On mobile we always restart here (continuous=false, so every session ends).
            // Add a short debounce to avoid rapid-fire restart loops when the
            // recognition service is failing immediately on Android.
            scheduleRestart();
        } else {
            // Only update UI if we are NOT processing (to prevent flickering)
            if (!isProcessing) {
                toggleButton.textContent = 'Start Dictation';
                toggleButton.classList.remove('recording');
                if (!statusDiv.textContent.includes("Processing")) {
                    statusDiv.textContent = "Status: Stopped";
                }
            }
        }
    };

    recognition.onresult = (event) => {
        resetInactivityTimer();
        recognitionFailCount = 0; // Successful result resets fail counter
        if (ignoreResults) return;

        let final = "";
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
                final += event.results[i][0].transcript;
            }
        }

        // On mobile with interimResults=false every result is final, so we
        // accumulate them into currentTranscript manually.
        if (isMobile) {
            if (final) currentTranscript += (currentTranscript ? " " : "") + final;
        } else {
            const fullTranscript = Array.from(event.results)
                .map(res => res[0].transcript)
                .join('');
            currentTranscript = fullTranscript;
        }

        const trimmedTranscript = currentTranscript.trim();

        // 1. Find triggers for #process and #discard from config
        let processTriggerRegex = null;
        let executeTriggerRegex = null;
        let discardTriggerRegex = null;

        for (const rule of configRules) {
            if (rule.type === 1) { // Command
                try {
                    const regex = new RegExp(`(?:^|\\s)(${rule.trigger})[\\s.,!?;:]*$`, 'i');
                    if (regex.test(currentTranscript)) {
                        if (rule.replacement === '#process') processTriggerRegex = regex;
                        if (rule.replacement === '#execute') executeTriggerRegex = regex;
                        if (rule.replacement === '#discard') discardTriggerRegex = regex;
                    }
                } catch (e) {}
            }
        }

        // 2. Standard Auto-match (only if not process/execute/discard)
        let autoMatchedRule = null;
        if (!processTriggerRegex && !executeTriggerRegex && !discardTriggerRegex) {
            for (const rule of configRules) {
                if (rule.type === 1 || rule.type === 2 || rule.type === 3) {
                    try {
                        const regex = new RegExp(`^(${rule.trigger})$`, 'i');
                        if (regex.test(trimmedTranscript)) {
                            autoMatchedRule = rule;
                            break;
                        }
                    } catch (e) {}
                }
            }
        }

        if (processTriggerRegex) {
            const match = currentTranscript.match(processTriggerRegex);
            if (match) {
                currentTranscript = currentTranscript.substring(0, match.index);
                processWithGroq('process');
            }
        } else if (executeTriggerRegex) {
            const match = currentTranscript.match(executeTriggerRegex);
            if (match) {
                currentTranscript = currentTranscript.substring(0, match.index);
                processWithGroq('execute');
            }
        } else if (discardTriggerRegex) {
            discardText();
        } else if (autoMatchedRule) {
            // Standard commands execute immediately on local transcript
            currentTranscript = "";
            pendingTextSpan.textContent = "";
            runTextProcessing(trimmedTranscript);
            restartForNewSegment();
        } else {
            pendingTextSpan.textContent = currentTranscript;
        }
    };

} else {
    toggleButton.disabled = true;
    processButton.disabled = true;
    statusDiv.textContent = 'Speech recognition is not supported in this browser.';
}

/**
 * Schedules a recognition restart with debouncing.
 * On mobile, if recognition fails repeatedly (rapid onend without results),
 * we back off exponentially to avoid hammering the Android speech service.
 */
function scheduleRestart() {
    // Base delay: small on desktop, longer on mobile to avoid rapid looping
    const baseDelay = isMobile ? 400 : 80;
    // Extra backoff for consecutive failures (recognitionFailCount tracks these)
    const backoff = Math.min(recognitionFailCount * 500, 4000);
    const delay = baseDelay + backoff;

    setTimeout(() => {
        if (shouldKeepListening && !isProcessing && !isRecognizing) {
            // Re-init media recorder for the new segment
            audioChunks = [];
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }
            if (globalStream) {
                mediaRecorder = new MediaRecorder(globalStream);
                mediaRecorder.ondataavailable = (event) => {
                    if (event.data.size > 0) audioChunks.push(event.data);
                };
                mediaRecorder.start();
            }
            try {
                recognition.start();
            } catch(e) {
                console.warn("Restart recognition threw:", e.message);
            }
        }
    }, delay);
}


/* -------------------------------------------------------------------------- */
/*                             History Management                             */
/* -------------------------------------------------------------------------- */
function saveState() {
    // Clean symbol before saving
    const currentVal = getTextContent().replace(new RegExp(CURSOR_SYMBOL, 'g'), '');
    localStorage.setItem('webspeech_content', currentVal);

    const currentSelection = { ...savedSelection };
    const currentState = { text: currentVal, selection: currentSelection };

    // Check if text is the same as previous state
    if (historyIndex >= 0 && historyStack[historyIndex].text === currentVal) {
        // Update selection in existing state
        historyStack[historyIndex].selection = currentSelection;
        return;
    }

    if (historyIndex < historyStack.length - 1) {
        historyStack = historyStack.slice(0, historyIndex + 1);
    }
    historyStack.push(currentState);
    if (historyStack.length > MAX_HISTORY) {
        historyStack.shift();
    } else {
        historyIndex++;
    }
}

function restoreState() {
    const savedContent = localStorage.getItem('webspeech_content');
    if (savedContent) {
        setTextContent(savedContent.replace(new RegExp(CURSOR_SYMBOL, 'g'), ''));
    }
}

function undo() {
    if (historyIndex > 0) {
        historyIndex--;
        const state = historyStack[historyIndex];
        setTextContent(state.text);
        savedSelection = { ...state.selection };
        setCursorPosition(savedSelection.start, savedSelection.end);
        localStorage.setItem('webspeech_content', state.text);
        statusDiv.textContent = "Undo";
    } else {
        statusDiv.textContent = "Nothing to undo";
    }
}

function redo() {
    if (historyIndex < historyStack.length - 1) {
        historyIndex++;
        const state = historyStack[historyIndex];
        setTextContent(state.text);
        savedSelection = { ...state.selection };
        setCursorPosition(savedSelection.start, savedSelection.end);
        localStorage.setItem('webspeech_content', state.text);
        statusDiv.textContent = "Redo";
    } else {
        statusDiv.textContent = "Nothing to redo";
    }
}

// Create mirror div for cursor position calculation
const mirrorDiv = document.createElement('div');
mirrorDiv.style.cssText = `
    position: absolute;
    top: -9999px;
    left: -9999px;
    visibility: hidden;
    white-space: pre-wrap;
    word-wrap: break-word;
`;
document.body.appendChild(mirrorDiv);

function scrollToCursor() {
    // Copy textarea styles to mirror div
    const computed = getComputedStyle(textBox);
    mirrorDiv.style.width = computed.width;
    mirrorDiv.style.padding = computed.padding;
    mirrorDiv.style.fontSize = computed.fontSize;
    mirrorDiv.style.lineHeight = computed.lineHeight;
    mirrorDiv.style.fontFamily = computed.fontFamily;

    // Get text up to cursor position
    const text = getTextContent();
    const cursorPos = savedSelection.end;
    const textBeforeCursor = text.substring(0, cursorPos);

    // Set mirror content and measure
    mirrorDiv.textContent = textBeforeCursor;
    // Add a character to ensure we get the line height even if cursor is at line start
    const span = document.createElement('span');
    span.textContent = '|';
    mirrorDiv.appendChild(span);

    const cursorTop = span.offsetTop;
    const lineHeight = parseInt(computed.lineHeight) || 24;

    // Calculate if cursor is out of view and scroll if needed
    const scrollTop = textBox.scrollTop;
    const clientHeight = textBox.clientHeight;
    const paddingTop = parseInt(computed.paddingTop) || 0;

    const cursorRelativeTop = cursorTop + paddingTop;

    // If cursor is below visible area
    if (cursorRelativeTop + lineHeight > scrollTop + clientHeight) {
        textBox.scrollTop = cursorRelativeTop + lineHeight - clientHeight + lineHeight;
    }
    // If cursor is above visible area
    else if (cursorRelativeTop < scrollTop) {
        textBox.scrollTop = cursorRelativeTop - lineHeight;
    }

    textBox.focus();
}

/* -------------------------------------------------------------------------- */
/*                            Cursor & Text Logic                             */
/* -------------------------------------------------------------------------- */
function insertTextAtCursor(text) {
    saveState();

    // Determine target range
    let start, end;
    const currentText = getTextContent();
    const symbolIndex = currentText.indexOf(CURSOR_SYMBOL);

    if (symbolIndex !== -1) {
        start = symbolIndex;
        end = symbolIndex + CURSOR_SYMBOL.length;
    } else {
        start = savedSelection.start;
        end = savedSelection.end;
    }

    // Process text (escape sequences: \n for newline, \s for space)
    const processedText = text.replace(/\\n/g, '\n').replace(/\\s/g, ' ');

    // Simple string manipulation for textarea
    const newText = currentText.slice(0, start) + processedText + currentText.slice(end);
    setTextContent(newText);

    // Move cursor to end of inserted text
    const newCursorPos = start + processedText.length;
    setCursorPosition(newCursorPos);

    // Update state
    savedSelection = getCursorPosition();

    saveState();
    scrollToCursor();
}

/* -------------------------------------------------------------------------- */
/*                             Command Registry                               */
/* -------------------------------------------------------------------------- */
async function copySelection() {
    const { start, end } = savedSelection;
    const text = getTextContent().slice(start, end);
    try {
        await navigator.clipboard.writeText(text);
        statusDiv.textContent = "Status: Copied to clipboard";
    } catch (err) {
        // Fallback to execCommand
        textBox.focus();
        setCursorPosition(start, end);
        document.execCommand('copy');
        statusDiv.textContent = "Status: Copied to clipboard";
    }
}

async function cutSelection() {
    saveState();
    const { start, end } = savedSelection;
    const text = getTextContent();
    const selectedText = text.slice(start, end);
    try {
        await navigator.clipboard.writeText(selectedText);
        // Remove selected text
        setTextContent(text.slice(0, start) + text.slice(end));
        setCursorPosition(start);
        savedSelection = getCursorPosition();
        saveState();
        statusDiv.textContent = "Status: Cut to clipboard";
    } catch (err) {
        // Fallback to execCommand
        textBox.focus();
        setCursorPosition(start, end);
        document.execCommand('cut');
        saveState();
        statusDiv.textContent = "Status: Cut to clipboard";
    }
}

async function pasteFromClipboard() {
    try {
        const text = await navigator.clipboard.readText();
        insertTextAtCursor(text);
        statusDiv.textContent = "Status: Pasted from clipboard";
    } catch (err) {
        console.error("Paste failed", err);
        statusDiv.textContent = "Status: Paste failed (Check permissions)";
    }
}

function uppercase() {
    saveState();
    const { start, end } = savedSelection;
    const text = getTextContent();
    const selectedText = text.slice(start, end);
    const newText = text.slice(0, start) + selectedText.toUpperCase() + text.slice(end);
    setTextContent(newText);
    setCursorPosition(start, start + selectedText.length);
    saveState();
    statusDiv.textContent = "Status: Converted to uppercase";
}

function lowercase() {
    saveState();
    const { start, end } = savedSelection;
    const text = getTextContent();
    const selectedText = text.slice(start, end);
    const newText = text.slice(0, start) + selectedText.toLowerCase() + text.slice(end);
    setTextContent(newText);
    setCursorPosition(start, start + selectedText.length);
    saveState();
    statusDiv.textContent = "Status: Converted to lowercase";
}

function capitalize() {
    saveState();
    const { start, end } = savedSelection;
    const text = getTextContent();
    const selectedText = text.slice(start, end);
    const capitalizedText = selectedText.replace(/\b\w/g, char => char.toUpperCase());
    const newText = text.slice(0, start) + capitalizedText + text.slice(end);
    setTextContent(newText);
    setCursorPosition(start, start + capitalizedText.length);
    saveState();
    statusDiv.textContent = "Status: Capitalized";
}

const commandRegistry = {
    '#undo': undo,
    '#redo': redo,
    '#stop': stopDictation,
    '#discard': discardText,
    '#copy': copySelection,
    '#cut': cutSelection,
    '#paste': pasteFromClipboard,
    '#uppercase': uppercase,
    '#lowercase': lowercase,
    '#capitalize': capitalize,
};

function runTextProcessing(rawTextInput) {
    const rawText = rawTextInput ? rawTextInput.trim() : "";
    if (!rawText) return;

    console.log("Processing:", rawText);
    let actionTaken = false;
    let matchedRule = null;

    // Find matching rule
    for (const rule of configRules) {
        try {
            const regex = new RegExp(`^(${rule.trigger})$`, 'i');
            if (regex.test(rawText)) {
                matchedRule = rule;
                break;
            }
        } catch (e) {
            console.warn("Bad regex in rule:", rule.trigger);
        }
    }

    if (matchedRule) {
        if (matchedRule.type === 1) { // Command
            const cmdFunc = commandRegistry[matchedRule.replacement];
            if (cmdFunc) {
                if (!['#undo', '#redo', '#stop', '#discard'].includes(matchedRule.replacement)) {
                    saveState();
                }
                cmdFunc();
                if (!['#undo', '#redo', '#stop', '#discard'].includes(matchedRule.replacement)) {
                    saveState();
                }
                actionTaken = true;
            } else {
                console.warn("Unknown command:", matchedRule.replacement);
            }
        } else if (matchedRule.type === 3) { // Regex Operation
            saveState();

            // Remove all cursor symbols for clean processing
            let currentText = getTextContent().replace(new RegExp(CURSOR_SYMBOL, 'g'), '');

            let { start: selStart, end: selEnd } = savedSelection;

            // Check if cursor symbol was in the original text
            const originalText = getTextContent();
            if (originalText.includes(CURSOR_SYMBOL)) {
                const idx = originalText.indexOf(CURSOR_SYMBOL);
                selStart = idx;
                selEnd = idx;
            }

            // Construct marked text
            const markedText = currentText.slice(0, selStart) + MARKER_A + currentText.slice(selStart, selEnd) + MARKER_B + currentText.slice(selEnd);

            try {
                const opRegex = new RegExp(matchedRule.matchRegex, 'gm');
                let replacementStr = matchedRule.replacement.replace(/\\n/g, '\n');
                const newMarkedText = markedText.replace(opRegex, replacementStr);

                const newAIndex = newMarkedText.indexOf(MARKER_A);
                const newBIndex = newMarkedText.indexOf(MARKER_B);

                let finalCleanText = newMarkedText.replace(new RegExp(MARKER_A, 'g'), '').replace(new RegExp(MARKER_B, 'g'), '');
                setTextContent(finalCleanText);

                if (newAIndex !== -1 && newBIndex !== -1) {
                    let newStart = newAIndex;
                    let newEnd = newBIndex;
                    if (newStart < newEnd) {
                        newEnd -= MARKER_A.length;
                    } else {
                        newStart -= MARKER_B.length;
                    }
                    setCursorPosition(newStart, newEnd);
                } else if (newAIndex !== -1) {
                    setCursorPosition(newAIndex, newAIndex);
                }

                savedSelection = getCursorPosition();
                actionTaken = true;
                saveState();
                scrollToCursor();
            } catch (e) {
                console.error("Regex Op Failed", e);
            }
        } else { // Substitution
            insertTextAtCursor(matchedRule.replacement);
            actionTaken = true;
        }
    } else {
        // Append Logic
        const currentVal = getTextContent();
        let insertionPos = savedSelection.start;
        if (currentVal.includes(CURSOR_SYMBOL)) {
            insertionPos = currentVal.indexOf(CURSOR_SYMBOL);
        }

        // Don't trim newlines, only spaces and tabs for proper sentence/line detection
        const textBefore = currentVal.substring(0, insertionPos).replace(/[ \t]+$/, '');
        const lastChar = textBefore.length > 0 ? textBefore.charAt(textBefore.length - 1) : "";
        const isSentenceStart = textBefore.length === 0 || [".", "!", "?", "\n"].includes(lastChar);

        // Check if there's any alphabetic character on the current line
        const lastNewlineIndex = textBefore.lastIndexOf('\n');
        const currentLineText = lastNewlineIndex >= 0
            ? textBefore.substring(lastNewlineIndex + 1)
            : textBefore;
        const hasAlphaOnLine = /[a-zA-Z]/.test(currentLineText);

        let textToAppend = rawText;
        if (textToAppend.length > 0) {
            // Capitalize if at sentence start OR if current line has no alphabetic characters yet
            const shouldCapitalize = isSentenceStart || !hasAlphaOnLine;

            // Find the first alphabetic character
            const alphaMatch = textToAppend.match(/[a-zA-Z]/);
            if (alphaMatch) {
                const index = alphaMatch.index;
                if (shouldCapitalize) {
                    textToAppend = textToAppend.substring(0, index) +
                                  textToAppend.charAt(index).toUpperCase() +
                                  textToAppend.substring(index + 1);
                } else {
                    textToAppend = textToAppend.substring(0, index) +
                                  textToAppend.charAt(index).toLowerCase() +
                                  textToAppend.substring(index + 1);
                }
            }
        }

        const charBeforeCursor = currentVal.length > 0 && insertionPos > 0 ? currentVal.charAt(insertionPos - 1) : "";
        const needsSpace = charBeforeCursor && !["\n", " "].includes(charBeforeCursor);

        insertTextAtCursor((needsSpace ? " " : "") + textToAppend);
        actionTaken = true;
    }
}

/* -------------------------------------------------------------------------- */
/*                             UI Event Listeners                             */
/* -------------------------------------------------------------------------- */
// Sidebar Logic
sidebarToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
    localStorage.setItem('webspeech_sidebar_collapsed', sidebar.classList.contains('collapsed'));
});

// Restore Sidebar State
if (localStorage.getItem('webspeech_sidebar_collapsed') === 'true') {
    sidebar.classList.add('collapsed');
} else {
    sidebar.classList.remove('collapsed');
}

saveConfigButton.addEventListener('click', () => {
    const text = configEditor.value;
    localStorage.setItem('webspeech_config', text);
    parseConfig(text);

    const key = groqApiKeyInput.value.trim();
    groqApiKey = key;
    localStorage.setItem('webspeech_groq_key', key);

    const geminiKey = geminiApiKeyInput.value.trim();
    geminiApiKey = geminiKey;
    localStorage.setItem('webspeech_gemini_key', geminiKey);

    const prompt = geminiSystemPromptInput.value.trim();
    geminiSystemPrompt = prompt;
    localStorage.setItem('webspeech_gemini_prompt', prompt);

    const model = geminiModelSelect.value;
    geminiModel = model;
    localStorage.setItem('webspeech_gemini_model', model);

    const shortcutsEnabled = keyboardShortcutsCheckbox.checked;
    keyboardShortcutsEnabled = shortcutsEnabled;
    localStorage.setItem('webspeech_keyboard_shortcuts_enabled', shortcutsEnabled.toString());

    alert("Configuration & Keys saved!");
});

resetConfigButton.addEventListener('click', () => {
    if (confirm("Are you sure you want to reset configuration to defaults?")) {
        configEditor.value = DEFAULT_CONFIG;
        geminiSystemPromptInput.value = DEFAULT_SYSTEM_PROMPT;
        geminiModelSelect.value = "gemini-2.5-flash-lite";
        localStorage.removeItem('webspeech_config');
        localStorage.removeItem('webspeech_gemini_prompt');
        localStorage.removeItem('webspeech_gemini_model');
        parseConfig(DEFAULT_CONFIG);
        geminiSystemPrompt = DEFAULT_SYSTEM_PROMPT;
        geminiModel = "gemini-2.5-flash-lite";
        keyboardShortcutsCheckbox.checked = true;
        keyboardShortcutsEnabled = true;
        localStorage.removeItem('webspeech_keyboard_shortcuts_enabled');
        alert("Configuration reset to defaults. (Not saved to storage until you click Save)");
    }
});

keyboardShortcutsCheckbox.addEventListener('change', () => {
    keyboardShortcutsEnabled = keyboardShortcutsCheckbox.checked;
});

toggleButton.addEventListener('click', () => {
    if (isRecognizing) {
        stopDictation();
    } else {
        startDictation();
    }
});

processButton.addEventListener('click', () => processWithGroq('process'));
executeButton.addEventListener('click', () => processWithGroq('execute'));
undoButton.addEventListener('click', undo);
redoButton.addEventListener('click', redo);
discardButton.addEventListener('click', discardText);

// Visibility Change
document.addEventListener('visibilitychange', () => {
    if (document.hidden && (isRecognizing || shouldKeepListening)) {
        stopDictation();
        statusDiv.textContent = "Status: Stopped (Tab Hidden)";
    }
});

// Keyboard Control
document.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const activeElement = document.activeElement;
    const isInputFieldActive = (
        activeElement === textBox ||
        activeElement === groqApiKeyInput ||
        activeElement === geminiApiKeyInput ||
        activeElement === geminiSystemPromptInput ||
        activeElement === configEditor
    );

    // Escape key: Stop dictation
    if (event.key === 'Escape') {
        if (isRecognizing) {
            event.preventDefault();
            stopDictation();
        }
        return;
    }

    // Only process keyboard shortcuts if enabled
    if (keyboardShortcutsEnabled) {
        if (event.key === 'Control' || (event.key === ' ' && !isInputFieldActive)) {
            if (event.key === ' ') {
                event.preventDefault();
            }
            if (!isRecognizing) {
                startDictation();
            } else {
                processWithGroq('process');
            }
        }
    }
});

// Track selection changes in textarea
textBox.addEventListener('select', () => {
    savedSelection = getCursorPosition();
});

textBox.addEventListener('click', () => {
    savedSelection = getCursorPosition();
});

textBox.addEventListener('keyup', () => {
    savedSelection = getCursorPosition();
});

// Textbox Events (Symbol handling & State)
textBox.addEventListener('blur', () => {
    savedSelection = getCursorPosition();
    const val = getTextContent();
    // Only add cursor symbol if it doesn't already exist and selection is collapsed
    if (!val.includes(CURSOR_SYMBOL)) {
        if (savedSelection.start === savedSelection.end) {
            setTextContent(val.slice(0, savedSelection.start) + CURSOR_SYMBOL + val.slice(savedSelection.start));
        }
    }
});

textBox.addEventListener('focus', () => {
    const val = getTextContent();
    const pos = val.indexOf(CURSOR_SYMBOL);
    if (pos !== -1) {
        setTextContent(val.replace(new RegExp(CURSOR_SYMBOL, 'g'), ''));
        setCursorPosition(pos, pos);
    }
});

// Textarea handles Enter and paste natively - no custom handlers needed

textBox.addEventListener('input', () => {
    savedSelection = getCursorPosition();
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        saveState();
    }, 1000);
});

// Initialization
loadConfig();
restoreState();
saveState(); // Initial stack push
