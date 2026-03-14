"""
Three-way conversation between Alice, Bob, and Charlie using Gemini API.
Press Space to advance each turn. Press Q to quit.
"""

import os
import sys
import time
import random
import termios
import tty
from google import genai

API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    print("Error: GEMINI_API_KEY environment variable not set.")
    sys.exit(1)

client = genai.Client(api_key=API_KEY)
MODEL = "gemma-3-27b-it"
NAMES = ["Alice", "Bob", "Charlie"]
COLORS = {
    "Alice": "\033[38;5;213m",   # pink
    "Bob": "\033[38;5;117m",     # blue
    "Charlie": "\033[38;5;222m", # gold
}
RESET = "\033[0m"
DIM = "\033[2m"
BOLD = "\033[1m"

SYSTEM_PROMPT = (
    "You are in a three-person discussion with Alice, Bob, and Charlie. "
    "You are {name}. The other two participants are {others}. "
    "You are discussing the question: \"What's the best education system in the world?\" "
    "Be thoughtful, draw on specific examples and evidence, and engage with what the others say. "
    "Keep each response to 2-3 paragraphs. Be conversational and natural."
)

QUESTION = "What's the best education system in the world?"

# Each agent maintains its own conversation history
histories: dict[str, list[dict]] = {name: [] for name in NAMES}


def get_input():
    """Read user input: returns number of turns to run, 0 for quit."""
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    buf = ""
    try:
        tty.setraw(fd)
        while True:
            ch = sys.stdin.read(1)
            if ch.lower() == "q":
                return 0
            if ch == " ":
                return 1
            if ch in "0123456789":
                buf += ch
                # Echo the digit
                sys.stdout.write(ch)
                sys.stdout.flush()
            elif ch in ("\r", "\n") and buf:
                return int(buf)
            elif ch == "\x7f" and buf:  # backspace
                buf = buf[:-1]
                sys.stdout.write("\b \b")
                sys.stdout.flush()
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)


def call_gemini(name: str, max_retries: int = 5) -> str:
    """Call the Gemini API with retry and exponential backoff."""
    others = [n for n in NAMES if n != name]
    system = SYSTEM_PROMPT.format(name=name, others=" and ".join(others))

    contents = [{"role": "user", "parts": [{"text": system}]}]
    contents.append({"role": "model", "parts": [{"text": f"Understood. I am {name}. I'm ready to discuss."}]})

    for msg in histories[name]:
        if msg["speaker"] == name:
            contents.append({"role": "model", "parts": [{"text": msg["text"]}]})
        else:
            contents.append({"role": "user", "parts": [{"text": f"{msg['speaker']}: {msg['text']}"}]})

    # Final prompt to elicit response
    if not histories[name]:
        contents.append({"role": "user", "parts": [{"text": f"Please begin the discussion. The question is: \"{QUESTION}\""}]})
    else:
        contents.append({"role": "user", "parts": [{"text": f"It's your turn to respond, {name}."}]})

    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model=MODEL,
                contents=contents,
            )
            return response.text.strip()
        except Exception as e:
            if attempt == max_retries - 1:
                raise
            wait = (2 ** attempt) + random.uniform(0, 1)
            print(f"\n{DIM}  [API error: {e}, retrying in {wait:.1f}s...]{RESET}")
            time.sleep(wait)
    return ""


def add_to_all_histories(speaker: str, text: str):
    """Add a message to every agent's history."""
    msg = {"speaker": speaker, "text": text}
    for name in NAMES:
        histories[name].append(msg)


def main():
    print(f"\n{BOLD}{'=' * 60}")
    print(f"  Three-Way Discussion: {COLORS['Alice']}Alice{RESET}{BOLD}, {COLORS['Bob']}Bob{RESET}{BOLD}, {COLORS['Charlie']}Charlie{RESET}{BOLD}")
    print(f"{'=' * 60}{RESET}")
    print(f"\n{DIM}  Topic: \"{QUESTION}\"{RESET}")
    print(f"{DIM}  Model: {MODEL}{RESET}")
    print(f"{DIM}  SPACE = next turn, number + ENTER = that many turns, Q = quit{RESET}\n")
    print(f"{'─' * 60}\n")

    turn = 0
    remaining = 0
    while True:
        name = NAMES[turn % 3]
        color = COLORS[name]

        if remaining <= 0:
            print(f"{DIM}  [SPACE / number+ENTER / Q] next: {color}{name}{RESET}{DIM}...{RESET}", end="", flush=True)
            count = get_input()
            print(f"\r{' ' * 70}\r", end="")
            if count == 0:
                print(f"\n{DIM}  Conversation ended.{RESET}\n")
                return
            remaining = count

        print(f"  {color}{BOLD}{'▌'} {name}{RESET} {DIM}(turn {turn + 1}){RESET}\n")

        response = call_gemini(name)
        add_to_all_histories(name, response)

        for line in response.split("\n"):
            print(f"  {color}│{RESET} {line}")

        print(f"\n{'─' * 60}\n")
        turn += 1
        remaining -= 1


if __name__ == "__main__":
    main()
