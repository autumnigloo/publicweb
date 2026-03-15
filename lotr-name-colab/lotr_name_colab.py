"""
Colab-friendly Tolkien-style name generator.

Recommendation:
- Do not train a transformer from scratch on a few hundred names.
- For name generation specifically, a character n-gram model usually works
- For name generation specifically, a character n-gram model usually works
  better with small datasets, is cheap to run, and is easier to control.
- If you later want richer outputs like "Gandalf the White", combine a
  generated base name with a small title/epithet system.
- If you eventually need broader fantasy text generation, do LoRA fine-tuning
  on an existing model rather than full training from scratch.

This file is intentionally self-contained so you can drop it into Google Colab
and run it as-is.
"""

from __future__ import annotations

import math
import random
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Dict, Iterable, List, Tuple


RANDOM_SEED = 7
random.seed(RANDOM_SEED)


SEED_GROUPS: Dict[str, List[str]] = {
    "elf": [
        "Aegnor",
        "Amarie",
        "Arwen",
        "Beleg",
        "Celebrimbor",
        "Celeborn",
        "Celebrian",
        "Cirdan",
        "Daeron",
        "Earwen",
        "Ecthelion",
        "Elbereth",
        "Elenwe",
        "Elladan",
        "Elrohir",
        "Elrond",
        "Enelye",
        "Feanor",
        "Finarfin",
        "Fingolfin",
        "Finrod",
        "Finduilas",
        "Galadriel",
        "Gilgalad",
        "Glorfindel",
        "Idril",
        "Legolas",
        "Lindir",
        "Luthien",
        "Maedhros",
        "Maglor",
        "Melian",
        "Mirdania",
        "Nerdanel",
        "Nimrodel",
        "Oropher",
        "Saeros",
        "Thingol",
        "Thranduil",
        "Turgon",
    ],
    "dwarf": [
        "Azaghal",
        "Balin",
        "Bifur",
        "Bofur",
        "Bombur",
        "Dain",
        "Dis",
        "Dori",
        "Durin",
        "Dwalin",
        "Farin",
        "Floki",
        "Frar",
        "Frerin",
        "Fundin",
        "Gamil",
        "Gimli",
        "Gloin",
        "Groin",
        "Gror",
        "Kili",
        "Nain",
        "Nali",
        "Narvi",
        "Oin",
        "Ori",
        "Telchar",
        "Thorin",
        "Thrain",
        "Thror",
    ],
    "hobbit": [
        "Adalgrim",
        "Belladonna",
        "Bilbo",
        "Bingo",
        "Daisy",
        "Dina",
        "Drogo",
        "Esmeralda",
        "Estella",
        "Fosco",
        "Fredegar",
        "Frodo",
        "Gorbadoc",
        "Hamfast",
        "Lobelia",
        "Meriadoc",
        "Odo",
        "Paladin",
        "Peregrin",
        "Pimpernel",
        "Primula",
        "Rosie",
        "Ruby",
        "Samwise",
        "Tolman",
    ],
    "gondor": [
        "Anarion",
        "Arador",
        "Aragorn",
        "Arathorn",
        "Beren",
        "Boromir",
        "Denethor",
        "Earnur",
        "Ecthelion",
        "Faramir",
        "Forlong",
        "Hador",
        "Hurin",
        "Imrahil",
        "Isildur",
        "Mablung",
        "Malbeth",
        "Orodreth",
        "Thorongil",
        "Tuor",
    ],
    "rohan": [
        "Aldor",
        "Brego",
        "Ceorl",
        "Deor",
        "Dernhelm",
        "Eadig",
        "Eofor",
        "Eomer",
        "Eomund",
        "Eorl",
        "Eowyn",
        "Erkenbrand",
        "Fastred",
        "Folca",
        "Folcred",
        "Freca",
        "Gamling",
        "Grima",
        "Haleth",
        "Helm",
        "Leof",
        "Theoden",
        "Theodred",
        "Wulf",
    ],
    "wizard_dark": [
        "Alatar",
        "Curumo",
        "Gandalf",
        "Mairon",
        "Melkor",
        "Mithrandir",
        "Pallando",
        "Radagast",
        "Saruman",
        "Sauron",
    ],
}


EPITHETS: Dict[str, List[str]] = {
    "elf": [
        "the Fair",
        "of the Golden Wood",
        "Star-brow",
        "of the West",
        "Moon-voiced",
        "the Luminous",
    ],
    "dwarf": [
        "Stonehand",
        "the Iron-browed",
        "of the Deep Halls",
        "Hammer-son",
        "the Black Anvil",
        "Oakshield",
    ],
    "hobbit": [
        "of Bywater",
        "from the Green Hills",
        "the Cheerful",
        "Apple-cheek",
        "of the Shire",
        "the Well-Fed",
    ],
    "gondor": [
        "of the White Tower",
        "the Steadfast",
        "son of the West",
        "of the Silver Guard",
        "the Watchful",
        "of Ithilien",
    ],
    "rohan": [
        "Horse-lord",
        "of the Mark",
        "the Wind-rider",
        "Golden-hair",
        "Shield-thane",
        "the Swift",
    ],
    "wizard_dark": [
        "the White",
        "the Grey",
        "the Deceiver",
        "of Many Colours",
        "the Shadowed",
        "Fire-bearer",
    ],
}


START = "^"
END = "$"
VOWELS = set("aeiouy")


@dataclass
class NGramModel:
    order: int
    transitions: Dict[str, Counter]
    corpus: List[str]


def normalize(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z'-]", "", name).strip("-'")
    return cleaned.title()


def padded(name: str, order: int) -> str:
    return START * (order - 1) + name.lower() + END


def build_ngram_model(names: Iterable[str], order: int = 4) -> NGramModel:
    transitions: Dict[str, Counter] = defaultdict(Counter)
    corpus = [normalize(name) for name in names if normalize(name)]
    for name in corpus:
        token = padded(name, order)
        for i in range(len(token) - order + 1):
            prefix = token[i : i + order - 1]
            nxt = token[i + order - 1]
            transitions[prefix][nxt] += 1
    return NGramModel(order=order, transitions=dict(transitions), corpus=corpus)


def weighted_choice(counter: Counter, temperature: float = 1.0) -> str:
    items = list(counter.items())
    if not items:
        return END
    chars, weights = zip(*items)
    adjusted = [max(weight, 1e-9) ** (1.0 / temperature) for weight in weights]
    return random.choices(chars, weights=adjusted, k=1)[0]


def generate_raw_name(
    model: NGramModel,
    min_len: int = 4,
    max_len: int = 12,
    temperature: float = 0.95,
) -> str:
    prefix = START * (model.order - 1)
    out: List[str] = []
    steps = 0
    step_limit = max_len * 3
    while steps < step_limit:
        steps += 1
        nxt = weighted_choice(model.transitions.get(prefix, Counter({END: 1})), temperature)
        if nxt == END:
            if len(out) >= min_len:
                break
            return ""
        out.append(nxt)
        if len(out) >= max_len:
            break
        prefix = (prefix + nxt)[-(model.order - 1) :]
    return "".join(out).title()


def vowel_ratio(name: str) -> float:
    letters = [ch for ch in name.lower() if ch.isalpha()]
    if not letters:
        return 0.0
    return sum(ch in VOWELS for ch in letters) / len(letters)


def has_bad_runs(name: str) -> bool:
    lower = name.lower()
    for i in range(len(lower) - 3):
        chunk = lower[i : i + 4]
        if all(ch in VOWELS for ch in chunk):
            return True
        if all(ch.isalpha() and ch not in VOWELS for ch in chunk):
            return True
    return False


def similarity_to_corpus(name: str, corpus: Iterable[str]) -> float:
    return max(
        SequenceMatcher(a=name.lower(), b=entry.lower()).ratio() for entry in corpus
    )


def acceptable_name(name: str, corpus: Iterable[str]) -> bool:
    if len(name) < 4 or len(name) > 13:
        return False
    if has_bad_runs(name):
        return False
    if not re.fullmatch(r"[A-Z][a-z]+(?:-[A-Z][a-z]+)?", name):
        return False
    ratio = vowel_ratio(name)
    if ratio < 0.20 or ratio > 0.65:
        return False
    sim = similarity_to_corpus(name, corpus)
    if sim > 0.88:
        return False
    if sim < 0.30:
        return False
    return True


def make_epithet(style: str) -> str:
    return random.choice(EPITHETS[style])


def generate_name(
    model: NGramModel,
    style: str,
    with_epithet: bool = False,
    tries: int = 25,
) -> str:
    for _ in range(tries):
        candidate = generate_raw_name(model)
        if acceptable_name(candidate, model.corpus):
            if with_epithet:
                return f"{candidate} {make_epithet(style)}"
            return candidate
    raise RuntimeError(f"Could not generate a clean name for style={style}")


def generate_batch(
    models: Dict[str, NGramModel],
    style: str,
    count: int = 12,
    with_epithet: bool = False,
) -> List[str]:
    seen = set()
    output: List[str] = []
    attempts = 0
    max_attempts = count * 10
    while len(output) < count and attempts < max_attempts:
        attempts += 1
        try:
            name = generate_name(models[style], style=style, with_epithet=with_epithet)
        except RuntimeError:
            break
        base = name.split(" ", 1)[0]
        if base in seen:
            continue
        seen.add(base)
        output.append(name)
    return output


def rank_candidates(names: Iterable[str], seed_names: Iterable[str]) -> List[Tuple[float, str]]:
    seed_list = list(seed_names)
    ranked = []
    for name in names:
        score = similarity_to_corpus(name.split(" ", 1)[0], seed_list)
        diversity_bonus = 1.0 - abs(vowel_ratio(name) - 0.42)
        ranked.append((score + 0.25 * diversity_bonus, name))
    return sorted(ranked, reverse=True)


def print_examples(models: Dict[str, NGramModel], with_epithet: bool) -> None:
    for style in SEED_GROUPS:
        print(f"\n[{style}]")
        sample_count = 4
        candidates = generate_batch(
            models, style, count=sample_count, with_epithet=with_epithet
        )
        if not candidates:
            print(" - No candidates. Add more seed names for this style.")
            continue
        for _, name in rank_candidates(candidates, SEED_GROUPS[style]):
            print(" -", name)


def interactive_loop(models: Dict[str, NGramModel]) -> None:
    styles = ", ".join(SEED_GROUPS.keys())
    print("\nInteractive mode. Enter a style or 'quit'.")
    print("Available styles:", styles)
    while True:
        style = input("\nStyle: ").strip().lower()
        if style in {"quit", "exit"}:
            return
        if style not in models:
            print("Unknown style.")
            continue
        count_text = input("How many names? [8] ").strip() or "8"
        with_epithet = input("Add epithets? [y/N] ").strip().lower() == "y"
        count = max(1, min(50, int(count_text)))
        batch = generate_batch(models, style, count=count, with_epithet=with_epithet)
        print()
        for _, name in rank_candidates(batch, SEED_GROUPS[style]):
            print(" -", name)


def explain_choice() -> None:
    print(
        """
Why this approach:
 - A few hundred names is too little to justify training a transformer from scratch.
 - Full fine-tuning is also unnecessary for short strings like names.
 - Character n-grams learn the phonetic shape of Tolkien-style names well.
 - Epithets are better handled with templates than by hoping a tiny model learns them.

If you later want to upgrade:
 1. Expand the seed list to 500-2000 names split by culture.
 2. Keep this generator as a baseline.
 3. Only then try LoRA fine-tuning on a small instruct model for richer outputs.
"""
    )


def build_all_models(order: int = 3) -> Dict[str, NGramModel]:
    models: Dict[str, NGramModel] = {}
    for style, names in SEED_GROUPS.items():
        style_order = order
        if len(names) < 15:
            style_order = 2
        elif len(names) < 25:
            style_order = min(order, 3)
        models[style] = build_ngram_model(names, order=style_order)
    return models


def main() -> None:
    explain_choice()
    models = build_all_models(order=3)

    print("\nSample plain names:")
    print_examples(models, with_epithet=False)

    print("\nSample titled names:")
    print_examples(models, with_epithet=True)

    # Set to True in Colab if you want an input loop after sample output.
    RUN_INTERACTIVE_LOOP = False
    if RUN_INTERACTIVE_LOOP:
        interactive_loop(models)


if __name__ == "__main__":
    main()
